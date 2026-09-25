import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { webcrypto } from 'node:crypto';
import sharp from 'sharp';
import { verifyAndDecodePhoto, describeDecodedFrame, describeDecodedFrameAsync, deriveSdrWorkingPhoto } from '../src/index.mjs';
import { request, sha256, code } from './helpers.mjs';

let encoded, decoded;
before(async () => {
  const pixels = Buffer.alloc(700 * 700 * 3); let state = 0x12345678;
  for (let i = 0; i < pixels.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; pixels[i] = state & 255; }
  encoded = await sharp(pixels, { raw: { width: 700, height: 700, channels: 3 } }).png().toBuffer();
  assert.ok(encoded.length >= 1024 * 1024);
  decoded = await verifyAndDecodePhoto(request(encoded));
  assert.ok(decoded.png.length >= 1024 * 1024);
});

test('large decode hashes match SHA-256 and own every caller input before asynchronous hashing', async t => {
  const digest = webcrypto.subtle.digest.bind(webcrypto.subtle), calls = [];
  t.mock.method(webcrypto.subtle, 'digest', (...args) => { calls.push(args[1].byteLength); return digest(...args); });
  const input = request(Buffer.from(encoded)), expected = sha256(encoded), pending = verifyAndDecodePhoto(input);
  input.bytes.fill(0); input.observedObject.key = 'changed'; input.uploadPlan.expected.sha256 = '0'.repeat(64);
  const actual = await pending;
  assert.equal(actual.original.content.sha256, expected);
  assert.equal(actual.original.object.key, 'originals/front');
  assert.equal(actual.raster.content.sha256, sha256(actual.png));
  assert.deepEqual(actual.png, decoded.png);
  assert.ok(calls.filter(size => size >= 1024 * 1024).length >= 2);
});

test('async frame description matches the synchronous contract and snapshots bytes, metadata, destination', async () => {
  const input = structuredClone(decoded), destination = { id: 'frame', object: { key: 'derived/frame', versionId: 'one' } };
  const expected = describeDecodedFrame(input, destination), pending = describeDecodedFrameAsync(input, destination);
  input.png.fill(0); input.raster.content.sha256 = '0'.repeat(64); input.decodePlan.geometry.matrix[2] = 400;
  destination.object.key = 'changed';
  assert.deepEqual(await pending, expected);
  const bad = structuredClone(decoded); bad.png[bad.png.length - 1] ^= 1;
  await assert.rejects(describeDecodedFrameAsync(bad, destination), code('PHOTO_SOURCE_MISMATCH'));
});

test('abort during large digest cannot return a photo or frame; working conversion uses the owned source', async () => {
  const target = { id: 'frame', object: { key: 'derived/frame', versionId: null } };
  for (const operation of [signal => verifyAndDecodePhoto(request(encoded, { signal })),
    signal => describeDecodedFrameAsync(decoded, { ...target, signal }),
    signal => deriveSdrWorkingPhoto(decoded, { signal })]) {
    const controller = new AbortController(), pending = operation(controller.signal); controller.abort();
    await assert.rejects(pending, code('PHOTO_DECODE_CANCELLED'));
  }
  const input = structuredClone(decoded), pending = deriveSdrWorkingPhoto(input);
  input.png.fill(0); input.raster.content.sha256 = '0'.repeat(64); input.original.object.key = 'changed';
  const actual = await pending;
  assert.deepEqual(actual.original, decoded.original);
  assert.equal(actual.workingImage.sourceRaster.content.sha256, decoded.raster.content.sha256);
  assert.equal(actual.raster.content.sha256, sha256(actual.png));
});
