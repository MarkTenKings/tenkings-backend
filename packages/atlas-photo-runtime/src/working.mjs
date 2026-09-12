import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inspectContainer } from './container.mjs';
import { PhotoRuntimeError } from './process.mjs';
import { qualifyHeifIcc } from './heif-metadata.mjs';

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
  let count = 0;
  const bound = new Transform({ transform(data, _encoding, done) {
    count += data.length; done(count > limits.maxOutputBytes ? new PhotoRuntimeError('PHOTO_DECODE_LIMIT') : null,
      count > limits.maxOutputBytes ? undefined : data);
  } });
  await pipeline(sharp(bytes, options).pipelineColourspace('srgb').withIccProfile('srgb').toColourspace('srgb')
    .png({ compressionLevel: 6, adaptiveFiltering: false, palette: false }),
  bound, createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }));
  const size = (await stat(outputPath)).size;
  need(size > 0 && size <= limits.maxOutputBytes && size === count, 'PHOTO_DECODE_LIMIT');
  const png = await readFile(outputPath), outputMeta = await sharp(png, options).metadata();
  need(inspectContainer(png).bitDepth === 8 && outputMeta.width === meta.width && outputMeta.height === meta.height
    && outputMeta.channels === 3 && outputMeta.orientation === undefined && outputMeta.icc
    && sha(outputMeta.icc) === 'c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353');
  return { ok: true,
    raster: { content: { mime: 'image/png', byteCount: size, sha256: sha(png) }, dimensions: raster.dimensions },
    treatment: { decoder: 'sharp/libvips', version: `${sharp.versions.sharp}/${sharp.versions.vips}`,
      policyVersion: 'atlas-sdr-working-srgb8-v1', channels: 3, bitDepth: 8,
      colorSpace: 'sRGB', colorTreatment: 'converted', hdrTreatment: treatment.hdrTreatment },
    workingImage: { policyVersion: 'atlas-sdr-working-srgb8-v1', sourceRaster: raster, sourceTreatment: treatment,
      outputIccSha256: sha(outputMeta.icc), geometryTreatment: 'identity-no-resampling' } };
}
