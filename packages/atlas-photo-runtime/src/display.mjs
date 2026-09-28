import { createHash, webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDecodedFrame } from '@atlas/photo-core';
import { isAborted, PhotoRuntimeError, runDecoderProcess } from './process.mjs';

export const REVIEW_DISPLAY_POLICY = 'atlas-review-display-lossless-v1';
const worker = fileURLToPath(new URL('./display-worker.mjs', import.meta.url));
const need = (ok, code = 'PHOTO_SOURCE_MISMATCH') => { if (!ok) throw new PhotoRuntimeError(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function hash(bytes) {
  return bytes.length < 1024 * 1024 ? sha(bytes)
    : Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
}
function checkLimits(value) {
  const keys = ['maxInputBytes', 'maxPixels', 'maxRasterBytes', 'maxOutputBytes', 'timeoutMs'];
  need(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length
    && keys.every(key => Number.isSafeInteger(value[key]) && value[key] > 0)
    && value.timeoutMs <= 2_147_483_647, 'PHOTO_DECODE_LIMIT');
  return { ...value };
}

/** Create separate display assets from an exact verified working frame. The
 * full image is lossless and pixel-equivalent; the small JPEG is context only.
 * No storage writes, source replacement or grading authority is performed. */
export async function createReviewDisplay({ bytes, frame, original, decodePlan, limits: limitValue, signal } = {}) {
  need(!isAborted(signal), 'PHOTO_DECODE_CANCELLED');
  const limits = checkLimits(limitValue), source = parseDecodedFrame(frame, original, decodePlan);
  need(bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer);
  need(bytes.length > 0 && bytes.length <= limits.maxInputBytes, 'PHOTO_DECODE_LIMIT');
  need(source.raster.content.mime === 'image/png' && source.treatment.channels === 3
    && source.treatment.bitDepth === 8 && source.treatment.colorSpace === 'sRGB'
    && source.treatment.colorTreatment === 'converted', 'PHOTO_COLOR_UNSUPPORTED');
  const { width, height } = source.raster.dimensions;
  need(width <= 16383 && height <= 16383 && width * height <= limits.maxPixels
    && width * height * 8 <= limits.maxRasterBytes, 'PHOTO_DECODE_LIMIT');
  const input = Buffer.from(bytes);
  need(input.length === source.raster.content.byteCount && await hash(input) === source.raster.content.sha256);
  need(!isAborted(signal), 'PHOTO_DECODE_CANCELLED');
  const directory = await mkdtemp(join(tmpdir(), 'atlas-review-display-'));
  try {
    const inputPath = join(directory, 'source.png'), fullPath = join(directory, 'full.webp'), previewPath = join(directory, 'preview.jpg');
    await writeFile(inputPath, input, { flag: 'wx', mode: 0o600 });
    const result = await runDecoderProcess(worker, { inputPath, fullPath, previewPath,
      source: { content: source.raster.content, dimensions: source.raster.dimensions }, limits },
    { timeoutMs: limits.timeoutMs, signal });
    need(result.policyVersion === REVIEW_DISPLAY_POLICY && result.sourceSha256 === source.raster.content.sha256);
    const paths = { full: fullPath, preview: previewPath }, outputs = {};
    let outputBytes = 0;
    for (const kind of ['full', 'preview']) {
      const expected = result[kind], size = (await stat(paths[kind])).size;
      outputBytes += size;
      need(size > 0 && outputBytes <= limits.maxOutputBytes, 'PHOTO_DECODE_LIMIT');
      need(expected.content.byteCount === size
        && expected.content.mime === (kind === 'full' ? 'image/webp' : 'image/jpeg'));
      const data = await readFile(paths[kind]);
      need(data.length === size && await hash(data) === expected.content.sha256);
      const dimensions = expected.dimensions;
      need(Number.isInteger(dimensions.width) && dimensions.width >= 2 && Number.isInteger(dimensions.height) && dimensions.height >= 2);
      if (kind === 'full') need(dimensions.width === width && dimensions.height === height);
      else need(dimensions.width <= Math.min(width, 768) && dimensions.height <= Math.min(height, 768));
      outputs[kind] = { bytes: data, content: { ...expected.content }, dimensions: { ...dimensions } };
    }
    need(!isAborted(signal), 'PHOTO_DECODE_CANCELLED');
    return { ...outputs, sourceSha256: source.raster.content.sha256, policyVersion: REVIEW_DISPLAY_POLICY };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
