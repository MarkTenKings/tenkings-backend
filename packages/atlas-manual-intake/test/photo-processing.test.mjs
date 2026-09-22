import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPhotoProcessor } from '../src/photo-processing.mjs';
import { processedPhoto } from '../src/contract.mjs';
import { rgb16Png } from '../../atlas-photo-runtime/test/helpers.mjs';
import { memoryPhotoStorage, sha } from './helpers.mjs';

test('actual native decoder and SDR worker keep original and both separate full-size frames', async () => {
  const { storage, objects } = memoryPhotoStorage(), bytes = rgb16Png(12, 16), uploadId = randomUUID(), cardId = randomUUID();
  const plan = { schemaVersion: 1, uploadId, binding: { cardId, pairId: randomUUID(), side: 'FRONT', version: 1 },
    object: { key: `intake/originals/${uploadId}`, versionId: null }, expected: { sha256: sha(bytes), byteCount: bytes.length } };
  const found = await storage.writeOriginal({ uploadPlan: plan, bytes });
  const verification = { object: found.object, sha256: found.sha256, byteCount: found.byteCount, contentType: found.contentType };
  const process = createPhotoProcessor({ storage, keyPrefix: 'intake', decodeLimits: {
    maxInputBytes: 96000000, maxPixels: 48000000, maxRasterBytes: 384000000, maxOutputBytes: 96000000, timeoutMs: 10000 } });
  const photo = await process({ uploadPlan: plan, verification, bytes });
  assert.deepEqual(photo.decodedFrame.raster.dimensions, { width: 12, height: 16 });
  assert.deepEqual(photo.workingFrame.raster.dimensions, photo.decodedFrame.raster.dimensions);
  assert.equal(photo.workingFrame.schemaVersion, 2); assert.equal(photo.workingFrame.treatment.colorSpace, 'sRGB');
  assert.equal(photo.workingFrame.treatment.bitDepth, 8); assert.equal(photo.decodedFrame.treatment.bitDepth, 16);
  assert.equal(objects.size, 3); assert.deepEqual((await storage.readOriginal({ uploadPlan: plan, object: photo.original.object })).bytes, bytes);
  assert.deepEqual(await process({ uploadPlan: plan, verification, bytes }), photo); assert.equal(objects.size, 3);
  await storage.readDecodedFrame({ frame: photo.workingFrame, original: photo.original, decodePlan: photo.decodePlan });
  const changed = structuredClone(photo); changed.workingFrame.workingImage.sourceRaster.content.sha256 = 'f'.repeat(64);
  assert.throws(() => processedPhoto(changed, plan, verification));
});
