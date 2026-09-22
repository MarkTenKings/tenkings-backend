import test from 'node:test';
import assert from 'node:assert/strict';
import { completeUpload, descriptorSha256, nextUploadStep, orientationTransform, parseDecodedFrame,
  parseDerivative, parseOriginal, parseUploadPlan, PhotoContractError, planDecode, replaceOriginal,
  transformPoint } from '../src/index.mjs';

const digest = char => char.repeat(64);
const clone = value => structuredClone(value);
const rejects = (fn, code = 'PHOTO_INVALID') => assert.throws(fn, error => error instanceof PhotoContractError && error.code === code);
const decodeLimits = { maxInputBytes: 1000, maxPixels: 100, maxRasterBytes: 800, maxOutputBytes: 1000, timeoutMs: 100 };
function original(side = 'FRONT', version = 1, pairId = 'pair-1') {
  return parseOriginal({ schemaVersion: 1, kind: 'original', uploadId: `${pairId}-${side}-${version}`,
    binding: { cardId: 'card-1', pairId, side, version },
    object: { key: `native/${pairId}/${side}/${version}`, versionId: 'provider-v1' },
    content: { mime: 'image/heic', sha256: digest('a'), byteCount: 100 }, metadata: null });
}
function uploadPlan(source = original()) {
  return parseUploadPlan({ schemaVersion: 1, uploadId: source.uploadId, binding: source.binding,
    object: { key: source.object.key, versionId: null },
    expected: { sha256: source.content.sha256, byteCount: source.content.byteCount } });
}
function header() {
  return { encoded: { width: 4, height: 3 }, orientation: 6, orientationSource: 'heif-properties', crop: null,
    selection: { kind: 'primary-still-image', itemId: '49' }, bitDepth: null,
    iccSha256: null, colorSpace: null, dynamicRange: null };
}
function frameFixture(source = original(), meta = header(), limit = decodeLimits) {
  const decodePlan = planDecode(source, meta, limit);
  const frame = { schemaVersion: 1, kind: 'decoded-frame', id: 'oriented-1',
    originalDescriptorSha256: descriptorSha256(source), decodePlanSha256: descriptorSha256(decodePlan),
    raster: { object: { key: 'derived/oriented-1.png', versionId: null },
      content: { mime: 'image/png', sha256: digest('b'), byteCount: 200 },
      dimensions: { width: decodePlan.geometry.width, height: decodePlan.geometry.height } },
    sourceToFrame: decodePlan.geometry.matrix,
    treatment: { decoder: 'synthetic-contract-fixture', version: '1', policyVersion: 'fixture-v1',
      channels: 4, bitDepth: 8, colorSpace: 'srgb', colorTreatment: 'converted', hdrTreatment: 'unknown' } };
  return { source, decodePlan, frame: parseDecodedFrame(frame, source, decodePlan) };
}
function derivative(frame) {
  return { schemaVersion: 1, kind: 'derivative', id: 'preview-1', purpose: 'preview',
    originalDescriptorSha256: frame.originalDescriptorSha256, frameDescriptorSha256: descriptorSha256(frame),
    raster: { object: { key: 'derived/preview-1.webp', versionId: null },
      content: { mime: 'image/webp', sha256: digest('c'), byteCount: 50 }, dimensions: { width: 2, height: 2 } },
    frameToDerivative: [0.5, 0, 0, 0, 1 / 3, 0, 0, 0, 1],
    encoder: { name: 'fixture-encoder', version: '1', settingsSha256: digest('d') } };
}

test('all eight effective orientations map independently specified pixel corners exactly', () => {
  const expected = [
    [[0, 0], [3, 0], [3, 2], [0, 2]],
    [[3, 0], [0, 0], [0, 2], [3, 2]],
    [[3, 2], [0, 2], [0, 0], [3, 0]],
    [[0, 2], [3, 2], [3, 0], [0, 0]],
    [[0, 0], [0, 3], [2, 3], [2, 0]],
    [[2, 0], [2, 3], [0, 3], [0, 0]],
    [[2, 3], [2, 0], [0, 0], [0, 3]],
    [[0, 3], [0, 0], [2, 0], [2, 3]],
  ];
  const sourceCorners = [[0, 0], [3, 0], [3, 2], [0, 2]];
  for (let orientation = 1; orientation <= 8; orientation++) {
    const transform = orientationTransform(4, 3, orientation);
    assert.deepEqual([transform.width, transform.height], orientation >= 5 ? [3, 4] : [4, 3]);
    assert.deepEqual(sourceCorners.map(([x, y]) => transformPoint(transform.matrix, { x, y })),
      expected[orientation - 1].map(([x, y]) => ({ x, y })), `orientation ${orientation}`);
  }
});

test('explicit source crop precedes orientation and preserves original coordinates', () => {
  const geometry = orientationTransform(10, 8, 6, { x: 3, y: 2, width: 4, height: 3 });
  assert.deepEqual([geometry.width, geometry.height], [3, 4]);
  assert.deepEqual(transformPoint(geometry.matrix, { x: 3, y: 2 }), { x: 2, y: 0 });
  assert.deepEqual(transformPoint(geometry.matrix, { x: 6, y: 4 }), { x: 0, y: 3 });
  rejects(() => orientationTransform(10, 8, 6, { x: 8, y: 2, width: 4, height: 3 }));
  rejects(() => orientationTransform(10, 8, 6, { x: 0.5, y: 2, width: 4, height: 3 }));
});

test('unknown upload metadata remains unknown; descriptors are immutable detached copies', () => {
  const source = clone(original()); const accepted = parseOriginal(source);
  assert.equal(accepted.metadata, null);
  source.binding.side = 'BACK'; assert.equal(accepted.binding.side, 'FRONT');
  assert.throws(() => { accepted.content.mime = 'image/png'; }, TypeError);
  const observed = { ...original(), metadata: header() };
  assert.equal(parseOriginal(observed).metadata.bitDepth, null);
});

test('native HEIC cannot be used as a browser raster or mislabeled derived original', () => {
  const { source, decodePlan, frame } = frameFixture();
  assert.equal(source.content.mime, 'image/heic');
  assert.equal(frame.raster.content.mime, 'image/png');
  const changed = clone(frame); changed.raster.content.mime = 'image/heic';
  rejects(() => parseDecodedFrame(changed, source, decodePlan));
  for (const mime of ['image/heif', 'image/dng', 'image/x-adobe-dng', 'image/avif', 'image/heic-sequence']) {
    rejects(() => parseOriginal({ ...source, content: { ...source.content, mime } }));
  }
  rejects(() => parseOriginal({ ...source, kind: 'derivative' }));
});

test('native observations cannot acquire verification from ETag, URL, name or an extra flag', () => {
  const source = original();
  for (const field of ['etag', 'verified', 'signedUrl', 'fileName']) rejects(() => parseOriginal({ ...source, [field]: 'client-claim' }));
  for (const key of ['https://store.example/photo', '/absolute/path', '../photo', 'photo?signature=1']) {
    rejects(() => parseOriginal({ ...source, object: { ...source.object, key } }));
  }
  rejects(() => parseOriginal({ ...source, content: { ...source.content, sha256: 'etag-not-sha256' } }));
});

test('same completion after reply loss returns the same immutable receipt; changed evidence conflicts', () => {
  const source = original(), plan = uploadPlan(source);
  const first = completeUpload(plan, source);
  assert.deepEqual(completeUpload(plan, source, first), first);
  for (const changed of [
    { ...source, content: { ...source.content, sha256: digest('f') } },
    { ...source, content: { ...source.content, byteCount: 101 } },
    { ...source, object: { ...source.object, versionId: 'overwritten-version' } },
    { ...source, metadata: header() },
    { ...source, binding: { ...source.binding, side: 'BACK' } },
  ]) rejects(() => completeUpload(plan, changed, first), 'PHOTO_UPLOAD_CONFLICT');
});

test('unknown/lost reply and 412 reconcile; only verified absence permits same-key create', () => {
  const source = original(), plan = uploadPlan(source);
  const lookup = { uploadId: plan.uploadId, objectKey: plan.object.key, state: 'UNKNOWN', receipt: null };
  assert.deepEqual(nextUploadStep(plan, lookup), { next: 'LOOKUP' });
  assert.deepEqual(nextUploadStep(plan, { ...lookup, state: 'PRESENT' }), { next: 'VERIFY_EXISTING' });
  assert.deepEqual(nextUploadStep(plan, { ...lookup, state: 'ABSENT' }), { next: 'UPLOAD_CREATE_ONLY' });
  assert.deepEqual(nextUploadStep(plan, { ...lookup, state: 'ACCEPTED', receipt: source }), { next: 'DONE', receipt: source });
  rejects(() => nextUploadStep(plan, { ...lookup, state: 'CONFLICT' }), 'PHOTO_UPLOAD_CONFLICT');
  rejects(() => nextUploadStep(plan, { ...lookup, objectKey: 'another/key' }), 'PHOTO_UPLOAD_CONFLICT');
  rejects(() => nextUploadStep(plan, { ...lookup, state: 'ACCEPTED', receipt: original('BACK') }), 'PHOTO_UPLOAD_CONFLICT');
});

test('source and plan hashes prevent reuse across side, pair, version, metadata and runtime limits', () => {
  const { source, decodePlan, frame } = frameFixture();
  for (const changed of [original('BACK'), original('FRONT', 2), original('FRONT', 1, 'pair-2')]) {
    rejects(() => parseDecodedFrame(frame, changed, decodePlan), 'PHOTO_SOURCE_MISMATCH');
  }
  const differentPolicy = planDecode(source, header(), { ...decodeLimits, timeoutMs: 200 });
  rejects(() => parseDecodedFrame(frame, source, differentPolicy), 'PHOTO_SOURCE_MISMATCH');
  const wrongMetadata = clone(decodePlan); wrongMetadata.metadata.orientation = 8;
  rejects(() => parseDecodedFrame(frame, source, wrongMetadata), 'PHOTO_SOURCE_MISMATCH');
  const partiallyKnownOriginal = { ...source, metadata: header() };
  assert.equal(planDecode(partiallyKnownOriginal, { ...header(), bitDepth: 10 }, decodeLimits).metadata.bitDepth, 10);
  assert.equal(partiallyKnownOriginal.metadata.bitDepth, null);
  const knownOriginal = { ...source, metadata: { ...header(), bitDepth: 8 } };
  rejects(() => planDecode(knownOriginal, { ...header(), bitDepth: 10 }, decodeLimits), 'PHOTO_SOURCE_MISMATCH');
});

test('single still HEIC primary is explicit; EXIF reapplication and sequence selection rejected', () => {
  const source = original();
  rejects(() => planDecode(source, { ...header(), orientationSource: 'exif' }, decodeLimits));
  rejects(() => planDecode(source, { ...header(), selection: { kind: 'single-frame' } }, decodeLimits));
  rejects(() => planDecode(source, { ...header(), selection: { kind: 'sequence', itemId: '49' } }, decodeLimits));
  const { decodePlan, frame } = frameFixture();
  const doubleRotated = clone(frame); doubleRotated.raster.dimensions = { width: 4, height: 3 };
  rejects(() => parseDecodedFrame(doubleRotated, source, decodePlan), 'PHOTO_SOURCE_MISMATCH');
});

test('raster metadata uses one frame and known effective orientation without pretending HEIF', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
    const source = { ...original(), content: { ...original().content, mime } };
    const meta = { ...header(), orientationSource: 'exif', selection: { kind: 'single-frame' } };
    const fixture = frameFixture(source, meta);
    assert.equal(fixture.frame.raster.dimensions.width, 3);
    rejects(() => planDecode(source, header(), decodeLimits));
  }
});

test('decode allocation is bounded before crop; oversized and malformed output cannot be accepted', () => {
  const source = original();
  for (const limit of [
    { ...decodeLimits, maxInputBytes: 99 }, { ...decodeLimits, maxPixels: 11 },
    { ...decodeLimits, maxRasterBytes: 95 },
  ]) rejects(() => planDecode(source, header(), limit), 'PHOTO_DECODE_LIMIT');
  rejects(() => planDecode(source, { ...header(), crop: { x: 0, y: 0, width: 2, height: 2 } },
    { ...decodeLimits, maxRasterBytes: 32 }), 'PHOTO_DECODE_LIMIT');
  rejects(() => planDecode(source, header(), { ...decodeLimits, timeoutMs: Infinity }));
  const { decodePlan, frame } = frameFixture();
  const huge = clone(frame); huge.raster.content.byteCount = 1001;
  rejects(() => parseDecodedFrame(huge, source, decodePlan), 'PHOTO_DECODE_LIMIT');
});

test('output cannot overwrite native object or make unknown HDR metadata a no-HDR fact', () => {
  const { source, decodePlan, frame } = frameFixture();
  const overwrite = clone(frame); overwrite.raster.object.key = source.object.key;
  rejects(() => parseDecodedFrame(overwrite, source, decodePlan), 'PHOTO_ORIGINAL_OVERWRITE');
  const invented = clone(frame); invented.treatment.hdrTreatment = 'not-present';
  rejects(() => parseDecodedFrame(invented, source, decodePlan));
});

test('derivatives require the exact original and decoded frame and never reuse their keys', () => {
  const { source, decodePlan, frame } = frameFixture();
  const derived = derivative(frame);
  assert.equal(parseDerivative(derived, frame, source, decodePlan).purpose, 'preview');
  for (const field of ['originalDescriptorSha256', 'frameDescriptorSha256']) {
    rejects(() => parseDerivative({ ...derived, [field]: digest('f') }, frame, source, decodePlan), 'PHOTO_SOURCE_MISMATCH');
  }
  for (const key of [source.object.key, frame.raster.object.key]) {
    const changed = clone(derived); changed.raster.object.key = key;
    rejects(() => parseDerivative(changed, frame, source, decodePlan), 'PHOTO_ORIGINAL_OVERWRITE');
  }
  const changed = clone(frame); changed.treatment.version = '2';
  rejects(() => parseDerivative(derived, changed, source, decodePlan), 'PHOTO_SOURCE_MISMATCH');
});

test('derivative matrix rejects collapsed/nonfinite/horizon transforms; crop mapping remains explicit', () => {
  const { source, decodePlan, frame } = frameFixture();
  const derived = derivative(frame);
  for (const transform of [
    [0, 0, 0, 0, 0, 0, 0, 0, 1], [NaN, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1, 0, 1, 0, -1],
  ]) rejects(() => parseDerivative({ ...derived, frameToDerivative: transform }, frame, source, decodePlan));
  const detail = { ...derived, purpose: 'detail', frameToDerivative: [1, 0, -1, 0, 1, -2, 0, 0, 1] };
  assert.deepEqual(transformPoint(parseDerivative(detail, frame, source, decodePlan).frameToDerivative, { x: 1, y: 2 }), { x: 0, y: 0 });
});

test('Front replacement invalidates Front and pair work while preserving exact Back bytes and descriptor', () => {
  const pair = { cardId: 'card-1', pairId: 'pair-1', front: original(), back: original('BACK') };
  const beforeBack = descriptorSha256(pair.back), beforeFront = descriptorSha256(pair.front);
  const result = replaceOriginal(pair, original('FRONT', 2));
  assert.deepEqual(result.invalidated, { sides: ['FRONT'], pair: ['identity', 'research'], report: true });
  assert.equal(descriptorSha256(result.pair.back), beforeBack);
  assert.equal(descriptorSha256(pair.front), beforeFront);
  assert.equal(result.pair.front.binding.version, 2);
  assert.deepEqual(replaceOriginal(result.pair, result.pair.front).invalidated, { sides: [], pair: [], report: false });
  const backReplacement = replaceOriginal(result.pair, original('BACK', 2));
  assert.equal(descriptorSha256(backReplacement.pair.front), descriptorSha256(result.pair.front));
  assert.deepEqual(backReplacement.invalidated.sides, ['BACK']);
});

test('missing Back does not block Front; competing replacements, wrong pair and same-key replacement conflict', () => {
  const empty = { cardId: 'card-1', pairId: 'pair-1', front: null, back: null };
  const first = replaceOriginal(empty, original()).pair;
  assert.equal(first.back, null);
  assert.equal(replaceOriginal(first, original('BACK')).pair.front.uploadId, first.front.uploadId);
  rejects(() => replaceOriginal(first, original('FRONT', 3)), 'PHOTO_REPLACEMENT_CONFLICT');
  rejects(() => replaceOriginal(first, original('FRONT', 2, 'pair-2')), 'PHOTO_SOURCE_MISMATCH');
  const overwrite = { ...original('FRONT', 2), object: first.front.object };
  rejects(() => replaceOriginal(first, overwrite), 'PHOTO_ORIGINAL_OVERWRITE');
  const second = replaceOriginal(first, original('FRONT', 2)).pair;
  const competing = { ...second.front, content: { ...second.front.content, sha256: digest('f') } };
  rejects(() => replaceOriginal(second, competing), 'PHOTO_REPLACEMENT_CONFLICT');
});

test('descriptor digest is stable under key order and changes with complete orientation/color lineage', () => {
  const source = original();
  assert.equal(descriptorSha256(source), descriptorSha256(Object.fromEntries(Object.entries(source).reverse())));
  const { frame } = frameFixture(); const changed = clone(frame); changed.treatment.colorSpace = 'display-p3';
  assert.notEqual(descriptorSha256(frame), descriptorSha256(changed));
  for (const value of [NaN, Infinity, undefined, 1n]) rejects(() => descriptorSha256({ value }));
});
