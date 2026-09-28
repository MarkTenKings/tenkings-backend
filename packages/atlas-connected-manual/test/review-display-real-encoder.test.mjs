import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame } from '@atlas/photo-runtime';
import { parseDerivative } from '@atlas/photo-core';
import { createReviewDisplayReader } from '../src/review-display.mjs';

test('real isolated encoder integrates with immutable display storage and renewed grants', async () => {
  const sha = value => createHash('sha256').update(value).digest('hex');
  const originalBytes = await readFile(new URL('../../atlas-photo-runtime/test/fixtures/browser-canvas/opaque-p3.png', import.meta.url));
  const object = { key: 'test/originals/front', versionId: null };
  const limits = { maxInputBytes: 2_000_000, maxPixels: 1_000_000,
    maxRasterBytes: 8_000_000, maxOutputBytes: 4_000_000, timeoutMs: 5000 };
  const working = await deriveSdrWorkingPhoto(await verifyAndDecodePhoto({ bytes: originalBytes, limits,
    observedObject: object, uploadPlan: { schemaVersion: 1, uploadId: 'real-display-test-upload',
      binding: { cardId: 'real-display-test-card', pairId: 'pair', side: 'FRONT', version: 1 },
      object, expected: { byteCount: originalBytes.length, sha256: sha(originalBytes) } } }));
  const photo = { original: working.original, decodePlan: working.decodePlan,
    workingFrame: describeDecodedFrame(working, { id: 'working', object: { key: 'test/derived/working.png', versionId: null } }) };
  const before = { photo: structuredClone(photo), original: sha(originalBytes), working: sha(working.png) };
  const stored = new Map(); let grants = 0, sourceReads = 0;
  const reader = createReviewDisplayReader({ keyPrefix: 'test', limited: operation => operation(), storage: {
    async readDecodedFrame({ frame }) {
      assert.deepEqual(frame, photo.workingFrame); sourceReads++; return { bytes: working.png };
    },
    async writeDerivative({ descriptor, bytes, frame, original, decodePlan }) {
      const valid = parseDerivative(descriptor, frame, original, decodePlan);
      assert.equal(sha(bytes), valid.raster.content.sha256);
      assert.equal(bytes.length, valid.raster.content.byteCount);
      assert.notEqual(valid.raster.object.key, original.object.key);
      assert.notEqual(valid.raster.object.key, frame.raster.object.key);
      assert.equal(stored.has(valid.raster.object.key), false);
      stored.set(valid.raster.object.key, { bytes, descriptor: valid }); return valid;
    },
    async createDerivativeRead({ descriptor, frame, original, decodePlan }) {
      const valid = parseDerivative(descriptor, frame, original, decodePlan), entry = stored.get(valid.raster.object.key);
      assert(entry); assert.equal(sha(entry.bytes), valid.raster.content.sha256);
      return { ...valid.raster.content, url: `https://storage.invalid/test-read-${++grants}` };
    },
  } });
  const first = await reader(photo), second = await reader(photo);
  assert(first && second); assert.equal(first.policyVersion, 'atlas-review-display-lossless-v1');
  assert.equal(first.sourceSha256, photo.workingFrame.raster.content.sha256);
  assert.equal(first.mime, 'image/webp'); assert.equal(first.preview.mime, 'image/jpeg');
  assert.equal(sourceReads, 1); assert.equal(stored.size, 2); assert.equal(grants, 4);
  assert.notEqual(first.url, second.url); assert.equal(first.sha256, second.sha256);
  const full = [...stored.values()].find(entry => entry.descriptor.raster.content.mime === 'image/webp');
  assert.deepEqual(await sharp(full.bytes, { ignoreIcc: true }).raw().toBuffer(),
    await sharp(working.png, { ignoreIcc: true }).raw().toBuffer());
  assert.deepEqual(photo, before.photo); assert.equal(sha(originalBytes), before.original); assert.equal(sha(working.png), before.working);
});
