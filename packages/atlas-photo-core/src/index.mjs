import { createHash } from 'node:crypto';

// Descriptor validation is not byte inspection, storage verification or decoding.
// Observations below must come from the server's exact-object verifier/decoder.
const RASTER_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const ORIGINAL_MIMES = [...RASTER_MIMES, 'image/heic'];
const SIDES = ['FRONT', 'BACK'];
const PURPOSES = ['preview', 'identification', 'snap', 'rectified', 'inspection', 'reveal', 'detail'];

export class PhotoContractError extends Error {
  constructor(code) { super(code); this.name = 'PhotoContractError'; this.code = code; }
}
function requireThat(ok, code = 'PHOTO_INVALID') {
  if (!ok) throw new PhotoContractError(code);
}
function object(value, keys) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
  return value;
}
function text(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 512
    && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value));
}
function integer(value, minimum = 1) {
  requireThat(Number.isSafeInteger(value) && value >= minimum);
}
function sha(value) { requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); }
function oneOf(value, values) { requireThat(values.includes(value)); }
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function copy(value) { return freeze(structuredClone(value)); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function equal(a, b) { return canonical(a) === canonical(b); }
function binding(value) {
  object(value, ['cardId', 'pairId', 'side', 'version']);
  text(value.cardId); text(value.pairId); oneOf(value.side, SIDES); integer(value.version);
}
function storage(value) {
  object(value, ['key', 'versionId']); text(value.key);
  // Stable controlled-storage key, never a URL or a path traversal.
  requireThat(!value.key.includes('://') && !/[?#\\]/.test(value.key)
    && value.key.split('/').every(part => part && part !== '.' && part !== '..'));
  if (value.versionId !== null) text(value.versionId);
}
function content(value, mimes) {
  object(value, ['mime', 'sha256', 'byteCount']);
  oneOf(value.mime, mimes); sha(value.sha256); integer(value.byteCount);
}
function dimensions(value) {
  object(value, ['width', 'height']); integer(value.width, 2); integer(value.height, 2);
  requireThat(Number.isSafeInteger(value.width * value.height));
}
function metadata(value, mime) {
  object(value, ['encoded', 'orientation', 'orientationSource', 'crop', 'selection', 'bitDepth', 'iccSha256', 'colorSpace', 'dynamicRange']);
  dimensions(value.encoded); integer(value.orientation); requireThat(value.orientation <= 8);
  oneOf(value.orientationSource, ['identity', 'exif', 'heif-properties']);
  if (value.orientationSource === 'identity') requireThat(value.orientation === 1);
  if (mime === 'image/heic') {
    oneOf(value.orientationSource, ['identity', 'heif-properties']);
    object(value.selection, ['kind', 'itemId']);
    requireThat(value.selection.kind === 'primary-still-image'); text(value.selection.itemId);
  } else {
    requireThat(value.orientationSource !== 'heif-properties');
    object(value.selection, ['kind']); requireThat(value.selection.kind === 'single-frame');
  }
  if (value.bitDepth !== null) { integer(value.bitDepth); requireThat(value.bitDepth <= 32); }
  if (value.iccSha256 !== null) sha(value.iccSha256);
  if (value.colorSpace !== null) text(value.colorSpace);
  oneOf(value.dynamicRange, [null, 'SDR', 'HDR']);
  orientationTransform(value.encoded.width, value.encoded.height, value.orientation, value.crop);
}

/** Pixel-center coordinates: [0,width-1] × [0,height-1]. Crop, then orient once.
 * The decoder resolves HEIF item properties/EXIF into the effective 1–8 code.
 * This helper does not interpret HEIF metadata or reapply EXIF to decoded pixels.
 */
export function orientationTransform(width, height, orientation, crop = null) {
  dimensions({ width, height }); integer(orientation); requireThat(orientation <= 8);
  let x = 0, y = 0, w = width, h = height;
  if (crop !== null) {
    object(crop, ['x', 'y', 'width', 'height']); integer(crop.x, 0); integer(crop.y, 0);
    dimensions({ width: crop.width, height: crop.height });
    requireThat(crop.x + crop.width <= width && crop.y + crop.height <= height);
    ({ x, y, width: w, height: h } = crop);
  }
  const [a, b, c, d, e, f] = [
    null, [1, 0, 0, 0, 1, 0], [-1, 0, w - 1, 0, 1, 0],
    [-1, 0, w - 1, 0, -1, h - 1], [1, 0, 0, 0, -1, h - 1],
    [0, 1, 0, 1, 0, 0], [0, -1, h - 1, 1, 0, 0],
    [0, -1, h - 1, -1, 0, w - 1], [0, 1, 0, -1, 0, w - 1],
  ][orientation];
  return copy({ width: orientation >= 5 ? h : w, height: orientation >= 5 ? w : h,
    matrix: [a, b, c - a * x - b * y, d, e, f - d * x - e * y, 0, 0, 1] });
}
function matrix(value) {
  requireThat(Array.isArray(value) && value.length === 9 && value.every(Number.isFinite));
  const [a, b, c, d, e, f, g, h, i] = value;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  requireThat(Number.isFinite(determinant) && determinant !== 0);
}
export function transformPoint(transform, point) {
  matrix(transform); object(point, ['x', 'y']);
  requireThat(Number.isFinite(point.x) && Number.isFinite(point.y));
  const [a, b, c, d, e, f, g, h, i] = transform;
  const denominator = g * point.x + h * point.y + i;
  requireThat(Number.isFinite(denominator) && denominator !== 0);
  const x = (a * point.x + b * point.y + c) / denominator;
  const y = (d * point.x + e * point.y + f) / denominator;
  requireThat(Number.isFinite(x) && Number.isFinite(y));
  return copy({ x, y });
}

export function parseUploadPlan(value) {
  object(value, ['schemaVersion', 'uploadId', 'binding', 'object', 'expected']);
  requireThat(value.schemaVersion === 1); text(value.uploadId); binding(value.binding); storage(value.object);
  // Provider version is unknown before the first create-only PUT.
  requireThat(value.object.versionId === null);
  object(value.expected, ['sha256', 'byteCount']); sha(value.expected.sha256); integer(value.expected.byteCount);
  return copy(value);
}
export function parseOriginal(value) {
  object(value, ['schemaVersion', 'kind', 'uploadId', 'binding', 'object', 'content', 'metadata']);
  requireThat(value.schemaVersion === 1 && value.kind === 'original');
  text(value.uploadId); binding(value.binding); storage(value.object); content(value.content, ORIGINAL_MIMES);
  if (value.metadata !== null) metadata(value.metadata, value.content.mime);
  return copy(value);
}
function matchesPlan(plan, original) {
  requireThat(original.uploadId === plan.uploadId && equal(original.binding, plan.binding)
    && original.object.key === plan.object.key && original.content.sha256 === plan.expected.sha256
    && original.content.byteCount === plan.expected.byteCount, 'PHOTO_UPLOAD_CONFLICT');
}

/** Reconcile verified exact-object observations. Persist the plan first, then
 * atomically store the first receipt; subsequent identical completion returns it.
 * No mutable ETag or client MIME is an observation accepted by this contract.
 */
export function completeUpload(planValue, observedValue, existingValue = null) {
  const plan = parseUploadPlan(planValue), observed = parseOriginal(observedValue);
  matchesPlan(plan, observed);
  if (existingValue === null) return observed;
  const existing = parseOriginal(existingValue); matchesPlan(plan, existing);
  requireThat(equal(existing, observed), 'PHOTO_UPLOAD_CONFLICT');
  return existing;
}

/** The caller supplies a fresh exact-upload lookup result, not browser belief.
 * An unknown reply, stale signed URL or create-only 412 always starts at LOOKUP.
 */
export function nextUploadStep(planValue, lookup) {
  const plan = parseUploadPlan(planValue);
  object(lookup, ['uploadId', 'objectKey', 'state', 'receipt']);
  requireThat(lookup.uploadId === plan.uploadId && lookup.objectKey === plan.object.key, 'PHOTO_UPLOAD_CONFLICT');
  oneOf(lookup.state, ['UNKNOWN', 'ABSENT', 'PRESENT', 'ACCEPTED', 'CONFLICT']);
  requireThat(lookup.state !== 'CONFLICT', 'PHOTO_UPLOAD_CONFLICT');
  if (lookup.state === 'ACCEPTED') {
    const receipt = parseOriginal(lookup.receipt); matchesPlan(plan, receipt);
    return copy({ next: 'DONE', receipt });
  }
  requireThat(lookup.receipt === null);
  return copy({ next: { UNKNOWN: 'LOOKUP', ABSENT: 'UPLOAD_CREATE_ONLY', PRESENT: 'VERIFY_EXISTING' }[lookup.state] });
}

function limits(value) {
  object(value, ['maxInputBytes', 'maxPixels', 'maxRasterBytes', 'maxOutputBytes', 'timeoutMs']);
  Object.values(value).forEach(number => integer(number));
}
/** The header probe must run under the same limits before allocating pixels.
 * A runtime must enforce timeout/memory itself; this package runs no decoder.
 */
export function planDecode(originalValue, observedMetadata, decodeLimits) {
  const original = parseOriginal(originalValue); metadata(observedMetadata, original.content.mime); limits(decodeLimits);
  if (original.metadata !== null) {
    const unknownAllowed = ['bitDepth', 'iccSha256', 'colorSpace', 'dynamicRange'];
    requireThat(Object.keys(original.metadata).every(key =>
      (unknownAllowed.includes(key) && original.metadata[key] === null)
      || equal(original.metadata[key], observedMetadata[key])), 'PHOTO_SOURCE_MISMATCH');
  }
  const { width, height } = observedMetadata.encoded;
  requireThat(original.content.byteCount <= decodeLimits.maxInputBytes
    && width * height <= decodeLimits.maxPixels
    // Budget the full source, even if a later crop is small. The seam supports
    // up to RGBA16 output; codec working memory still needs a runtime bound.
    && Number.isSafeInteger(width * height * 8)
    && width * height * 8 <= decodeLimits.maxRasterBytes, 'PHOTO_DECODE_LIMIT');
  return copy({ schemaVersion: 1, originalDescriptorSha256: hash(original), metadata: observedMetadata,
    geometry: orientationTransform(width, height, observedMetadata.orientation, observedMetadata.crop),
    limits: decodeLimits });
}
function validateDecodePlan(plan, original) {
  object(plan, ['schemaVersion', 'originalDescriptorSha256', 'metadata', 'geometry', 'limits']);
  const expected = planDecode(original, plan.metadata, plan.limits);
  requireThat(equal(expected, plan), 'PHOTO_SOURCE_MISMATCH');
}
function raster(value) {
  object(value, ['object', 'content', 'dimensions']); storage(value.object);
  content(value.content, RASTER_MIMES); dimensions(value.dimensions);
}
function treatment(value) {
  object(value, ['decoder', 'version', 'policyVersion', 'channels', 'bitDepth', 'colorSpace', 'colorTreatment', 'hdrTreatment']);
  text(value.decoder); text(value.version); text(value.policyVersion);
  oneOf(value.channels, [3, 4]); oneOf(value.bitDepth, [8, 16]);
  if (value.colorSpace !== null) text(value.colorSpace);
  oneOf(value.colorTreatment, ['preserved', 'converted', 'unmanaged']);
  oneOf(value.hdrTreatment, ['not-present', 'preserved', 'tone-mapped', 'unknown']);
  if (value.colorTreatment === 'converted') requireThat(value.colorSpace !== null);
}
function decodedShape(value) {
  object(value, ['schemaVersion', 'kind', 'id', 'originalDescriptorSha256', 'decodePlanSha256', 'raster', 'sourceToFrame', 'treatment']);
  requireThat(value.schemaVersion === 1 && value.kind === 'decoded-frame'); text(value.id);
  sha(value.originalDescriptorSha256); sha(value.decodePlanSha256); raster(value.raster);
  matrix(value.sourceToFrame); treatment(value.treatment);
}
export function parseDecodedFrame(value, originalValue, decodePlan) {
  const original = parseOriginal(originalValue); validateDecodePlan(decodePlan, original); decodedShape(value);
  requireThat(value.originalDescriptorSha256 === hash(original) && value.decodePlanSha256 === hash(decodePlan)
    && value.raster.dimensions.width === decodePlan.geometry.width
    && value.raster.dimensions.height === decodePlan.geometry.height
    && equal(value.sourceToFrame, decodePlan.geometry.matrix), 'PHOTO_SOURCE_MISMATCH');
  requireThat(value.raster.object.key !== original.object.key, 'PHOTO_ORIGINAL_OVERWRITE');
  const rasterBytes = decodePlan.geometry.width * decodePlan.geometry.height * value.treatment.channels * value.treatment.bitDepth / 8;
  requireThat(Number.isSafeInteger(rasterBytes) && rasterBytes <= decodePlan.limits.maxRasterBytes
    && value.raster.content.byteCount <= decodePlan.limits.maxOutputBytes, 'PHOTO_DECODE_LIMIT');
  if (decodePlan.metadata.dynamicRange !== 'SDR') requireThat(value.treatment.hdrTreatment !== 'not-present');
  return copy(value);
}

/** Transform is the complete oriented decoded-frame → derivative homography.
 * Crops may map source points outside the derivative. No second orientation.
 */
export function parseDerivative(value, frameValue, originalValue, decodePlan) {
  const frame = parseDecodedFrame(frameValue, originalValue, decodePlan);
  object(value, ['schemaVersion', 'kind', 'id', 'purpose', 'originalDescriptorSha256', 'frameDescriptorSha256', 'raster', 'frameToDerivative', 'encoder']);
  requireThat(value.schemaVersion === 1 && value.kind === 'derivative');
  text(value.id); oneOf(value.purpose, PURPOSES); raster(value.raster); matrix(value.frameToDerivative);
  object(value.encoder, ['name', 'version', 'settingsSha256']);
  text(value.encoder.name); text(value.encoder.version); sha(value.encoder.settingsSha256);
  requireThat(value.originalDescriptorSha256 === frame.originalDescriptorSha256
    && value.frameDescriptorSha256 === hash(frame), 'PHOTO_SOURCE_MISMATCH');
  requireThat(value.raster.object.key !== originalValue.object.key && value.raster.object.key !== frame.raster.object.key,
    'PHOTO_ORIGINAL_OVERWRITE');
  const { width, height } = frame.raster.dimensions;
  const [g, h, i] = value.frameToDerivative.slice(6);
  const denominators = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]
    .map(([x, y]) => g * x + h * y + i);
  requireThat(denominators.every(n => Number.isFinite(n) && n > 0)
    || denominators.every(n => Number.isFinite(n) && n < 0));
  return copy(value);
}

/** Hash only a validated JSON descriptor/plan. Stable key ordering is part of v1. */
export function descriptorSha256(value) {
  // Keep this generic helper bounded to JSON data; no credentials/bytes are read.
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype);
  const serialized = JSON.stringify(value, (_key, entry) => {
    requireThat(entry === null || ['string', 'boolean', 'number', 'object'].includes(typeof entry));
    if (typeof entry === 'number') requireThat(Number.isFinite(entry));
    return entry;
  });
  requireThat(typeof serialized === 'string' && serialized.length <= 32_768);
  const json = JSON.parse(serialized);
  requireThat(equal(value, json));
  return hash(json);
}

function pairShape(value) {
  object(value, ['cardId', 'pairId', 'front', 'back']); text(value.cardId); text(value.pairId);
  for (const side of SIDES) {
    const original = value[side.toLowerCase()];
    if (original === null) continue;
    parseOriginal(original);
    requireThat(original.binding.cardId === value.cardId && original.binding.pairId === value.pairId
      && original.binding.side === side, 'PHOTO_SOURCE_MISMATCH');
  }
  if (value.front && value.back) requireThat(value.front.uploadId !== value.back.uploadId
    && value.front.object.key !== value.back.object.key, 'PHOTO_UPLOAD_CONFLICT');
}
/** Pure adoption/invalidation description; caller commits it atomically with
 * its actual dependent records. Old originals and accepted reports are retained.
 */
export function replaceOriginal(pairValue, originalValue) {
  pairShape(pairValue); const original = parseOriginal(originalValue);
  requireThat(original.binding.cardId === pairValue.cardId && original.binding.pairId === pairValue.pairId, 'PHOTO_SOURCE_MISMATCH');
  const side = original.binding.side, slot = side.toLowerCase(), previous = pairValue[slot];
  if (previous && equal(previous, original)) return copy({ pair: pairValue, invalidated: { sides: [], pair: [], report: false } });
  requireThat(original.binding.version === (previous?.binding.version ?? 0) + 1, 'PHOTO_REPLACEMENT_CONFLICT');
  if (previous) requireThat(previous.uploadId !== original.uploadId && previous.object.key !== original.object.key,
    'PHOTO_ORIGINAL_OVERWRITE');
  const pair = { ...pairValue, [slot]: original }; pairShape(pair);
  return copy({ pair, invalidated: { sides: [side], pair: ['identity', 'research'], report: true } });
}
