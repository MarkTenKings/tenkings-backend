import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { completeUpload, planDecode } from '@atlas/photo-core';
import { inspectContainer } from './container.mjs';
import { PhotoRuntimeError } from './process.mjs';
import { decodeHeif } from './heif.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = code => { throw new PhotoRuntimeError(code); };

async function decode(request) {
  const { inputPath, outputPath, plan, observedObject, limits, existingOriginal } = request;
  if ((await stat(inputPath)).size > limits.maxInputBytes) reject('PHOTO_DECODE_LIMIT');
  const bytes = await readFile(inputPath);
  if (bytes.length !== plan.expected.byteCount || sha256(bytes) !== plan.expected.sha256) reject('PHOTO_SOURCE_MISMATCH');
  const container = inspectContainer(bytes);
  let sharp;
  try { sharp = (await import('sharp')).default; } catch { reject('PHOTO_DECODER_UNAVAILABLE'); }
  if (sharp.versions.sharp !== '0.33.5') reject('PHOTO_DECODER_UNAVAILABLE');
  sharp.cache(false);
  sharp.concurrency(1);
  const options = { limitInputPixels: limits.maxPixels, failOn: 'warning', sequentialRead: true };
  if (container.format === 'heif') {
    const decoded = await decodeHeif(bytes, request);
    const size = (await stat(outputPath)).size;
    if (size < 1 || size > limits.maxOutputBytes || size !== decoded.output.byteCount) reject('PHOTO_DECODE_LIMIT');
    const output = await readFile(outputPath), outputContainer = inspectContainer(output);
    const meta = await sharp(output, options).metadata();
    if (outputContainer.bitDepth !== decoded.treatment.bitDepth || meta.orientation !== undefined
      || meta.width !== decoded.decodePlan.geometry.width || meta.height !== decoded.decodePlan.geometry.height
      || meta.channels !== 3) reject('PHOTO_SOURCE_MISMATCH');
    if (decoded.treatment.colorTreatment === 'preserved'
      && (!meta.icc || sha256(meta.icc) !== decoded.decodePlan.metadata.iccSha256)) reject('PHOTO_SOURCE_MISMATCH');
    return { ok: true, original: decoded.original, decodePlan: decoded.decodePlan,
      raster: { content: { mime: 'image/png', byteCount: size, sha256: sha256(output) },
        dimensions: { width: meta.width, height: meta.height } }, treatment: decoded.treatment };
  }
  let meta;
  // metadata() reads headers without decoding compressed pixels. Plan the full
  // RGBA16 allocation from these dimensions before invoking the pixel pipeline.
  try { meta = await sharp(bytes, { ...options, limitInputPixels: false }).metadata(); } catch { reject('PHOTO_DECODE_INVALID'); }
  if (meta.format !== container.format) reject('PHOTO_DECODE_INVALID');
  if ((meta.pages ?? 1) !== 1) reject('PHOTO_MULTIFRAME_UNSUPPORTED');
  if (!Number.isInteger(meta.width) || !Number.isInteger(meta.height)
    || meta.width < 2 || meta.height < 2) reject('PHOTO_DECODE_INVALID');
  if (![1, 2, 4, 8, 16].includes(container.bitDepth)) reject('PHOTO_BIT_DEPTH_UNSUPPORTED');
  const metadata = {
    encoded: { width: meta.width, height: meta.height },
    orientation: meta.orientation ?? 1,
    orientationSource: meta.orientation === undefined ? 'identity' : 'exif',
    crop: null, selection: { kind: 'single-frame' }, bitDepth: container.bitDepth,
    iccSha256: meta.icc ? sha256(meta.icc) : null,
    colorSpace: meta.space ?? null,
    // An 8-bit header or ordinary ICC profile does not prove absence of HDR.
    // Preserve an independently verified prior observation on the exact same
    // bytes; absence of a new observation is not contradictory source evidence.
    dynamicRange: existingOriginal?.metadata?.dynamicRange ?? null,
  };
  const original = completeUpload(plan, {
    schemaVersion: 1, kind: 'original', uploadId: plan.uploadId,
    binding: plan.binding, object: observedObject,
    content: { mime: container.mime, byteCount: bytes.length, sha256: plan.expected.sha256 },
    // Preserve a previously accepted unknown-metadata receipt exactly.
    metadata: existingOriginal ? existingOriginal.metadata : metadata,
  }, existingOriginal);
  const decodePlan = planDecode(original, metadata, limits);
  const bitDepth = container.bitDepth === 16 ? 16 : 8;
  const colorSpace = bitDepth === 16 ? 'rgb16' : 'srgb';
  let encodedBytes = 0;
  const bound = new Transform({
    transform(chunk, _encoding, callback) {
      encodedBytes += chunk.length;
      callback(encodedBytes > limits.maxOutputBytes ? new PhotoRuntimeError('PHOTO_DECODE_LIMIT') : null,
        encodedBytes > limits.maxOutputBytes ? undefined : chunk);
    },
  });
  try {
    await pipeline(sharp(bytes, options).rotate().pipelineColourspace(colorSpace)
      .withIccProfile('srgb').toColourspace(colorSpace)
      .png({ compressionLevel: 6, adaptiveFiltering: false, palette: false }),
    bound, createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }));
  } catch (error) {
    reject(error.code === 'PHOTO_DECODE_LIMIT' ? error.code : 'PHOTO_DECODE_INVALID');
  }
  const outputSize = (await stat(outputPath)).size;
  if (outputSize < 1 || outputSize > limits.maxOutputBytes || outputSize !== encodedBytes) reject('PHOTO_DECODE_LIMIT');
  const output = await readFile(outputPath);
  const outputContainer = inspectContainer(output);
  const outputMeta = await sharp(output, options).metadata();
  if (outputContainer.mime !== 'image/png' || outputContainer.bitDepth !== bitDepth
    || outputMeta.width !== decodePlan.geometry.width || outputMeta.height !== decodePlan.geometry.height
    || outputMeta.orientation !== undefined || ![3, 4].includes(outputMeta.channels)) reject('PHOTO_SOURCE_MISMATCH');
  return {
    ok: true, original, decodePlan,
    raster: {
      content: { mime: 'image/png', byteCount: outputSize, sha256: sha256(output) },
      dimensions: { width: outputMeta.width, height: outputMeta.height },
    },
    treatment: {
      decoder: 'sharp/libvips', version: `${sharp.versions.sharp}/${sharp.versions.vips}`,
      policyVersion: 'atlas-native-raster-srgb-v1', channels: outputMeta.channels,
      bitDepth, colorSpace: 'sRGB', colorTreatment: 'converted', hdrTreatment: 'unknown',
    },
  };
}

try {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk.toString('utf8');
    if (Buffer.byteLength(raw) > 32_768) reject('PHOTO_DECODE_INVALID');
  }
  const result = await decode(JSON.parse(raw));
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false,
    code: error.code === 'PHOTO_INVALID' ? 'PHOTO_DECODE_INVALID' : error.code ?? 'PHOTO_DECODE_INVALID' }));
}
