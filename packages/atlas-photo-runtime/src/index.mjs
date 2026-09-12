import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeUpload, descriptorSha256, parseDecodedFrame, parseOriginal,
  parseUploadPlan, planDecode } from '@atlas/photo-core';
import { isAborted, PhotoRuntimeError, runDecoderProcess } from './process.mjs';

export { PhotoRuntimeError };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const requireThat = (value, code = 'PHOTO_DECODE_INVALID') => { if (!value) throw new PhotoRuntimeError(code); };

function checkedLimits(value) {
  const keys = ['maxInputBytes', 'maxPixels', 'maxRasterBytes', 'maxOutputBytes', 'timeoutMs'];
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length
    && keys.every(key => Number.isSafeInteger(value[key]) && value[key] > 0), 'PHOTO_DECODE_LIMIT');
  // Node timers truncate larger intervals into a 1ms timeout.
  requireThat(value.timeoutMs <= 2_147_483_647, 'PHOTO_DECODE_LIMIT');
  return { ...value };
}

/** Verify one server-read byte snapshot and decode it in a disposable process.
 * The adapter supplies an exact storage-object observation, never a client URL,
 * MIME or filename. This function does not fetch, write or authenticate storage.
 * Resource settings are required, with no product/card/spending allowance. */
export async function verifyAndDecodePhoto({ uploadPlan, observedObject, bytes, limits: limitValue,
  existingOriginal = null, signal } = {}) {
  requireThat(!isAborted(signal), 'PHOTO_DECODE_CANCELLED');
  const plan = parseUploadPlan(uploadPlan), limits = checkedLimits(limitValue);
  requireThat(bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer);
  requireThat(bytes.byteLength > 0 && bytes.byteLength <= limits.maxInputBytes, 'PHOTO_DECODE_LIMIT');
  requireThat(bytes.byteLength === plan.expected.byteCount, 'PHOTO_SOURCE_MISMATCH');
  // A detached owned snapshot prevents caller mutation across async file writes.
  const input = Buffer.from(bytes);
  requireThat(sha256(input) === plan.expected.sha256, 'PHOTO_SOURCE_MISMATCH');
  const observed = structuredClone(observedObject);
  // Validate provider key/version shape without assigning a MIME from this dummy
  // shape check. Actual original media type comes only from the child probe.
  parseOriginal({ schemaVersion: 1, kind: 'original', uploadId: plan.uploadId,
    binding: plan.binding, object: observed,
    content: { mime: 'image/png', ...plan.expected }, metadata: null });
  requireThat(observed.key === plan.object.key, 'PHOTO_SOURCE_MISMATCH');
  const existing = existingOriginal === null ? null : parseOriginal(existingOriginal);
  if (existing) completeUpload(plan, existing, existing);
  requireThat(!isAborted(signal), 'PHOTO_DECODE_CANCELLED');
  const directory = await mkdtemp(join(tmpdir(), 'atlas-photo-'));
  try {
    const inputPath = join(directory, 'original'), outputPath = join(directory, 'frame.png');
    await writeFile(inputPath, input, { flag: 'wx', mode: 0o600 });
    const result = await runDecoderProcess(worker, { inputPath, outputPath, plan, observedObject: observed,
      limits, existingOriginal: existing }, { timeoutMs: limits.timeoutMs, signal });
    const original = completeUpload(plan, result.original, existing);
    const decodePlan = planDecode(original, result.decodePlan.metadata, limits);
    requireThat(descriptorSha256(decodePlan) === descriptorSha256(result.decodePlan), 'PHOTO_SOURCE_MISMATCH');
    requireThat((await stat(outputPath)).size <= limits.maxOutputBytes, 'PHOTO_DECODE_LIMIT');
    const png = await readFile(outputPath);
    requireThat(png.length === result.raster.content.byteCount
      && sha256(png) === result.raster.content.sha256, 'PHOTO_SOURCE_MISMATCH');
    // Validate every observation with photo-core before returning bytes. This
    // private placeholder is never returned or presented as a stored object.
    const validationKey = original.object.key === 'decoded-validation' ? 'decoded-validation-2' : 'decoded-validation';
    parseDecodedFrame({ schemaVersion: 1, kind: 'decoded-frame', id: 'byte-validation',
      originalDescriptorSha256: descriptorSha256(original), decodePlanSha256: descriptorSha256(decodePlan),
      raster: { ...result.raster, object: { key: validationKey, versionId: null } },
      sourceToFrame: decodePlan.geometry.matrix, treatment: result.treatment }, original, decodePlan);
    requireThat(!isAborted(signal), 'PHOTO_DECODE_CANCELLED');
    return { original, decodePlan, png,
      raster: structuredClone(result.raster), treatment: structuredClone(result.treatment) };
  } finally {
    // Only files in this invocation's newly-created directory are removed.
    // No caller-owned original/storage object is touched on failure or success.
    await rm(directory, { recursive: true, force: true });
  }
}

/** Bind the actual decoded output to a destination observed by the storage
 * adapter. A valid descriptor does not prove that the caller stored the object. */
export function describeDecodedFrame(decoded, { id, object }) {
  requireThat(decoded?.png instanceof Uint8Array
    && decoded.png.byteLength === decoded.raster?.content?.byteCount
    && sha256(decoded.png) === decoded.raster.content.sha256, 'PHOTO_SOURCE_MISMATCH');
  return parseDecodedFrame({ schemaVersion: 1, kind: 'decoded-frame', id,
    originalDescriptorSha256: descriptorSha256(decoded.original),
    decodePlanSha256: descriptorSha256(decoded.decodePlan),
    raster: { ...decoded.raster, object }, sourceToFrame: decoded.decodePlan.geometry.matrix,
    treatment: decoded.treatment,
  }, decoded.original, decoded.decodePlan);
}
