import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inspectContainer } from './container.mjs';
import { PhotoRuntimeError } from './process.mjs';
import { qualifyHeifIcc } from './heif-metadata.mjs';
import { LOSSLESS_PNG, IDENTITY_WORKING_POLICY, IDENTITY_SOURCE_POLICIES } from './png-policy.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, code = 'PHOTO_SOURCE_MISMATCH') => { if (!ok) throw new PhotoRuntimeError(code); };

// Runs only inside the disposable photo child. Sharp 0.33.5 uses ICC perceptual
// intent through libvips/lcms; the embedded profile is interpreted, not relabelled.
// There is no resize, crop, sharpen, denoise, auto-orient or gain-map application.
export async function decodeSdrWorking(bytes, request, sharp) {
  const { raster, treatment, decodePlan, outputPath, limits } = request;
  need(bytes.length === raster.content.byteCount && sha(bytes) === raster.content.sha256);
  const container = inspectContainer(bytes);
  need(container.mime === 'image/png' && container.bitDepth === treatment.bitDepth);
  const options = { limitInputPixels: limits.maxPixels, failOn: 'warning', sequentialRead: true };
  const meta = await sharp(bytes, options).metadata();
  need(meta.width === raster.dimensions.width && meta.height === raster.dimensions.height
    && meta.channels === 3 && meta.orientation === undefined && (meta.pages ?? 1) === 1);
  if (treatment.colorTreatment === 'preserved') need(meta.icc && sha(meta.icc) === decodePlan.metadata.iccSha256
    && qualifyHeifIcc(meta.icc) === treatment.colorSpace);
  if (treatment.colorTreatment === 'converted') need(treatment.colorSpace === 'sRGB');
  const version = `${sharp.versions.sharp}/${sharp.versions.vips}`;
  const identity = treatment.decoder === 'sharp/libvips' && treatment.version === version
    && IDENTITY_SOURCE_POLICIES.includes(treatment.policyVersion)
    && treatment.bitDepth === 8 && treatment.channels === 3
    && treatment.colorSpace === 'sRGB' && treatment.colorTreatment === 'converted'
    && meta.icc && sha(meta.icc) === 'c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353';
  const policyVersion = identity ? IDENTITY_WORKING_POLICY : 'atlas-sdr-working-srgb8-v2';
  let count = 0;
  const bound = new Transform({ transform(data, _encoding, done) {
    count += data.length; done(count > limits.maxOutputBytes ? new PhotoRuntimeError('PHOTO_DECODE_LIMIT') : null,
      count > limits.maxOutputBytes ? undefined : data);
  } });
  if (identity) {
    // Metadata/hash validation alone cannot detect a malformed entropy stream.
    // Fully decode into a bounded discard sink, then preserve the already
    // qualified PNG exactly. No second ICC conversion or PNG encoding occurs.
    need(bytes.length <= limits.maxOutputBytes, 'PHOTO_DECODE_LIMIT');
    const expected = meta.width * meta.height * 3; let decoded = 0;
    await pipeline(sharp(bytes, { ...options, ignoreIcc: true }).raw(), new Writable({ write(data, _encoding, done) {
      decoded += data.length; done(decoded <= expected ? null : new PhotoRuntimeError('PHOTO_SOURCE_MISMATCH'));
    } }));
    need(decoded === expected);
    await writeFile(outputPath, bytes, { flag: 'wx', mode: 0o600 }); count = bytes.length;
  } else {
    await pipeline(sharp(bytes, options).pipelineColourspace('srgb').withIccProfile('srgb').toColourspace('srgb')
      .png(LOSSLESS_PNG), bound, createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }));
  }
  const size = (await stat(outputPath)).size;
  need(size > 0 && size <= limits.maxOutputBytes && size === count, 'PHOTO_DECODE_LIMIT');
  const png = await readFile(outputPath), outputMeta = await sharp(png, options).metadata();
  need(inspectContainer(png).bitDepth === 8 && outputMeta.width === meta.width && outputMeta.height === meta.height
    && outputMeta.channels === 3 && outputMeta.orientation === undefined && outputMeta.icc
    && sha(outputMeta.icc) === 'c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353');
  return { ok: true,
    raster: { content: { mime: 'image/png', byteCount: size, sha256: sha(png) }, dimensions: raster.dimensions },
    treatment: { decoder: 'sharp/libvips', version,
      policyVersion, channels: 3, bitDepth: 8,
      colorSpace: 'sRGB', colorTreatment: 'converted', hdrTreatment: treatment.hdrTreatment },
    workingImage: { policyVersion, sourceRaster: raster, sourceTreatment: treatment,
      outputIccSha256: sha(outputMeta.icc), geometryTreatment: 'identity-no-resampling' } };
}
