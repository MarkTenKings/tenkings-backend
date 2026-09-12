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
  existingOriginal = null, signal, heicHdrPolicy = null } = {}) {
  requireThat(!isAborted(signal), 'PHOTO_DECODE_CANCELLED');
  requireThat(heicHdrPolicy === null || heicHdrPolicy === 'retain-hdr-use-sdr-base', 'PHOTO_HDR_UNSUPPORTED');
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
      limits, existingOriginal: existing, heicHdrPolicy }, { timeoutMs: limits.timeoutMs, signal });
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
  return parseDecodedFrame({ schemaVersion: decoded.workingImage ? 2 : 1, kind: 'decoded-frame', id,
    originalDescriptorSha256: descriptorSha256(decoded.original),
    decodePlanSha256: descriptorSha256(decoded.decodePlan),
    raster: { ...decoded.raster, object }, sourceToFrame: decoded.decodePlan.geometry.matrix,
    treatment: decoded.treatment, ...(decoded.workingImage ? { workingImage: decoded.workingImage } : {}),
  }, decoded.original, decoded.decodePlan);
}

/** Derive a full-dimension sRGB RGB8 working image from the richer decoded PNG.
 * It keeps exact original/plan identity and records the source PNG/treatment.
 * The returned image is a separate artifact; caller retains original and source.
 * Limits default to the already checked decode plan, never a quality reduction. */
export async function deriveSdrWorkingPhoto(decoded, { limits: limitValue = decoded?.decodePlan?.limits, signal } = {}) {
  requireThat(!isAborted(signal), 'PHOTO_DECODE_CANCELLED');
  const limits = checkedLimits(limitValue);
  requireThat(!decoded?.workingImage, 'PHOTO_SOURCE_MISMATCH');
  requireThat(decoded?.png instanceof Uint8Array && decoded.png.buffer instanceof ArrayBuffer);
  requireThat(decoded.png.byteLength > 0 && decoded.png.byteLength <= limits.maxInputBytes, 'PHOTO_DECODE_LIMIT');
  // Copy all byte/descriptor/limit inputs before the first await.
  const input = Buffer.from(decoded.png), snapshot = structuredClone({ original: decoded.original,
    decodePlan: decoded.decodePlan, raster: decoded.raster, treatment: decoded.treatment });
  const source = { ...snapshot, png: input };
  const key = snapshot.original.object.key === 'working-validation' ? 'working-validation-2' : 'working-validation';
  const sourceFrame = describeDecodedFrame(source, { id: 'working-validation', object: { key, versionId: null } });
  const { width, height } = sourceFrame.raster.dimensions;
  requireThat(width * height <= limits.maxPixels && width * height * 8 <= limits.maxRasterBytes, 'PHOTO_DECODE_LIMIT');
  requireThat(sourceFrame.treatment.channels === 3 && sourceFrame.treatment.colorTreatment !== 'unmanaged'
    && ['sRGB', 'Display P3'].includes(sourceFrame.treatment.colorSpace), 'PHOTO_COLOR_UNSUPPORTED');
  requireThat(['not-present', 'sdr-base', 'unknown'].includes(sourceFrame.treatment.hdrTreatment)
    && (snapshot.decodePlan.metadata.dynamicRange !== 'HDR' || sourceFrame.treatment.hdrTreatment === 'sdr-base'), 'PHOTO_HDR_UNSUPPORTED');
  const directory = await mkdtemp(join(tmpdir(), 'atlas-photo-working-'));
  try {
    const inputPath = join(directory, 'decoded.png'), outputPath = join(directory, 'working.png');
    await writeFile(inputPath, input, { flag: 'wx', mode: 0o600 });
    const result = await runDecoderProcess(worker, { mode: 'sdr-working', inputPath, outputPath,
      ...snapshot, limits }, { timeoutMs: limits.timeoutMs, signal });
    requireThat((await stat(outputPath)).size <= limits.maxOutputBytes, 'PHOTO_DECODE_LIMIT');
    const png = await readFile(outputPath);
    const working = { original: snapshot.original, decodePlan: snapshot.decodePlan, png,
      raster: result.raster, treatment: result.treatment, workingImage: result.workingImage };
    requireThat(descriptorSha256(working.workingImage.sourceRaster) === descriptorSha256(snapshot.raster)
      && descriptorSha256(working.workingImage.sourceTreatment) === descriptorSha256(snapshot.treatment), 'PHOTO_SOURCE_MISMATCH');
    describeDecodedFrame(working, { id: 'working-validation', object: { key, versionId: null } });
    requireThat(!isAborted(signal), 'PHOTO_DECODE_CANCELLED');
    return working;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
