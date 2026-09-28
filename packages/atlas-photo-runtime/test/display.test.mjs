import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame, createReviewDisplay,
  REVIEW_DISPLAY_POLICY } from '../src/index.mjs';
import { request, code, sha256 } from './helpers.mjs';

const fixture = await readFile(new URL('./fixtures/browser-canvas/opaque-p3.png', import.meta.url));
const limits = { maxInputBytes: 8_000_000, maxPixels: 4_000_000,
  maxRasterBytes: 32_000_000, maxOutputBytes: 8_000_000, timeoutMs: 10_000 };
const working = async bytes => deriveSdrWorkingPhoto(await verifyAndDecodePhoto(request(bytes, { limits })));
function input(decoded, overrides = {}) {
  return { bytes: decoded.png, frame: describeDecodedFrame(decoded, { id: 'display-source',
    object: { key: 'working/source.png', versionId: '1' } }), original: decoded.original,
  decodePlan: decoded.decodePlan, limits, ...overrides };
}

test('isolated display encoding preserves every full-resolution RGB sample, ICC and source byte', async () => {
  const source = await working(fixture), original = Buffer.from(source.png), args = input(source);
  const result = await createReviewDisplay(args);
  assert.equal(result.policyVersion, REVIEW_DISPLAY_POLICY);
  assert.equal(result.sourceSha256, source.raster.content.sha256);
  assert.deepEqual(source.png, original);
  assert.equal(result.full.content.mime, 'image/webp');
  assert.equal(result.preview.content.mime, 'image/jpeg');
  for (const kind of ['full', 'preview']) {
    assert.equal(result[kind].content.sha256, sha256(result[kind].bytes));
    assert.equal(result[kind].content.byteCount, result[kind].bytes.length);
    const meta = await sharp(result[kind].bytes).metadata();
    assert.equal(sha256(meta.icc), 'c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353');
    assert.equal(meta.orientation, undefined); assert.equal(meta.channels, 3); assert.equal(meta.hasAlpha, false);
  }
  assert.deepEqual(result.full.dimensions, source.raster.dimensions);
  assert.deepEqual(await sharp(result.full.bytes, { ignoreIcc: true }).raw().toBuffer(),
    await sharp(source.png, { ignoreIcc: true }).raw().toBuffer());
  assert.equal(result.preview.dimensions.width, 48); assert.equal(result.preview.dimensions.height, 64);
  const again = await createReviewDisplay(args);
  assert.deepEqual(again.full.content, result.full.content); assert.deepEqual(again.preview.content, result.preview.content);
});

test('context preview fits inside 768 pixels while the verified full image keeps its exact geometry', async () => {
  const png = await sharp(fixture).resize(960, 1280).removeAlpha().png().toBuffer();
  const source = await working(png), result = await createReviewDisplay(input(source));
  assert.deepEqual(result.full.dimensions, { width: 960, height: 1280 });
  assert.deepEqual(result.preview.dimensions, { width: 576, height: 768 });
});

test('display encoding rejects source-byte drift, wrong dimensions, alpha and unqualified color', async () => {
  const source = await working(fixture), args = input(source);
  const bad = Buffer.from(args.bytes); bad[bad.length - 1] ^= 1;
  await assert.rejects(createReviewDisplay({ ...args, bytes: bad }), code('PHOTO_SOURCE_MISMATCH'));
  const wrong = structuredClone(args); wrong.frame.raster.dimensions.width++;
  await assert.rejects(createReviewDisplay(wrong), code('PHOTO_SOURCE_MISMATCH'));
  const transparent = await verifyAndDecodePhoto(request(await readFile(new URL('./fixtures/browser-canvas/one-translucent-pixel.png', import.meta.url))));
  await assert.rejects(createReviewDisplay(input(transparent)), code('PHOTO_COLOR_UNSUPPORTED'));
  const unprofiled = await sharp(source.png).png().toBuffer(), unqualified = structuredClone(args);
  unqualified.bytes = unprofiled;
  unqualified.frame.raster.content = { mime: 'image/png', byteCount: unprofiled.length, sha256: sha256(unprofiled) };
  await assert.rejects(createReviewDisplay(unqualified), code('PHOTO_COLOR_UNSUPPORTED'));
});

test('display input, pixel, raster, combined output and timeout budgets are enforced', async () => {
  const source = await working(fixture), args = input(source), result = await createReviewDisplay(args);
  for (const change of [{ maxInputBytes: args.bytes.length - 1 }, { maxPixels: 10 },
    { maxRasterBytes: 10 }, { maxOutputBytes: 10 },
    { maxOutputBytes: result.full.bytes.length + result.preview.bytes.length - 1 }]) {
    await assert.rejects(createReviewDisplay({ ...args, limits: { ...limits, ...change } }), code('PHOTO_DECODE_LIMIT'));
  }
  await assert.rejects(createReviewDisplay({ ...args, limits: { ...limits, timeoutMs: 1 } }), code('PHOTO_DECODE_TIMEOUT'));
  await assert.rejects(createReviewDisplay({ ...args, limits: { ...limits, timeoutMs: 2 ** 32 } }), code('PHOTO_DECODE_LIMIT'));
});

test('display work honors cancellation and owns its source snapshot across async encoding', async () => {
  const source = await working(fixture), args = input(source);
  await assert.rejects(createReviewDisplay({ ...args, signal: AbortSignal.abort() }), code('PHOTO_DECODE_CANCELLED'));
  const aborter = new AbortController(), cancelled = createReviewDisplay({ ...args, signal: aborter.signal });
  setTimeout(() => aborter.abort(), 20);
  await assert.rejects(cancelled, code('PHOTO_DECODE_CANCELLED'));
  const mutable = structuredClone(args), expected = await createReviewDisplay(args), pending = createReviewDisplay(mutable);
  mutable.bytes.fill(0); mutable.frame.raster.content.sha256 = '0'.repeat(64); mutable.limits.maxOutputBytes = 1;
  const actual = await pending;
  assert.deepEqual(actual.full.content, expected.full.content); assert.deepEqual(actual.preview.content, expected.preview.content);
});
