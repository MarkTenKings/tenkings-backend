import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createDefectImageEffects } from '../src/defect-images.mjs';
import { createManualArtifactStore } from '@atlas/manual-service/artifacts';
import { digest } from '@atlas/manual-service/contract';
import { encodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { reviewedCropTransform } from '@atlas/defect-memory/lessons';

async function setup() {
  const card = { cardId: randomUUID() }, objects = new Map();
  const artifacts = createManualArtifactStore({ transport: {
    async putIfAbsent(value) { if (!objects.has(value.key)) objects.set(value.key, value); },
    async read({ key }) { return objects.get(key); },
  } });
  const prepared = {};
  for (const [kind, width, height] of [['inspection', 1350, 1858], ['rectified', 1270, 1778]]) {
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3; raw[i] = x % 251; raw[i + 1] = y % 253; raw[i + 2] = (x + y) % 249;
    }
    prepared[kind] = await sharp(raw, { raw: { width, height, channels: 3 } }).webp({ lossless: true }).toBuffer();
  }
  const frame = { inspectionImageSha256: digest(prepared.inspection), rectifiedImageSha256: digest(prepared.rectified) };
  const effects = createDefectImageEffects({ artifacts, readPrepared: async (_staff, c, side, kind) => {
    assert.equal(c.cardId, card.cardId); assert(['FRONT', 'BACK'].includes(side)); return { bytes: prepared[kind] };
  } });
  return { card, objects, artifacts, prepared, frame, effects };
}
test('actual PNG crops preserve every source pixel and separately bind prepared WebP bytes', async () => {
  const f = await setup(), binding = { sides: { FRONT: { frame: f.frame }, BACK: { frame: f.frame } } };
  const images = await f.effects.currentImages({}, f.card, binding);
  for (const image of images) {
    assert.equal(image.whole.sourceSha256, f.frame.inspectionImageSha256);
    assert.notEqual(image.whole.sha256, image.whole.sourceSha256);
    assert.deepEqual(await sharp(image.whole.bytes).raw().toBuffer(), await sharp(f.prepared.inspection).raw().toBuffer());
    for (const crop of image.crops) {
      const expected = await sharp(f.prepared.inspection).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height }).raw().toBuffer();
      assert.deepEqual(await sharp(crop.bytes).raw().toBuffer(), expected);
      assert.equal(digest(crop.bytes), crop.sha256);
    }
  }
  const wrong = structuredClone(binding); wrong.sides.FRONT.frame.inspectionImageSha256 = '0'.repeat(64);
  await assert.rejects(f.effects.currentImages({}, f.card, wrong), { code: 'DEFECT_IMAGE_STALE' });
});
test('reviewed crop and exact disconnected mask survive immutable storage; overlay marks only selected pixels', async () => {
  const f = await setup(), mask = new Uint8Array(1270 * 1778);
  mask[800 * 1270 + 500] = 1; mask[802 * 1270 + 502] = 1;
  const trace = encodeSpeedsterTraceRleV1(mask), cropTransform = reviewedCropTransform(trace, f.frame);
  const exemplar = await f.effects.createExemplar({ staff: {}, card: f.card, side: 'FRONT', frame: f.frame, trace, cropTransform });
  const lesson = { id: digest('reviewed lesson'), source: { cardId: f.card.cardId }, exemplar };
  const [image] = await f.effects.lessonImages({ lessons: [lesson] });
  assert.equal(image.traceOverlay.traceSha256, trace.sha256);
  assert.equal(digest(image.traceOverlay.bytes), image.traceOverlay.sha256);
  const original = await sharp(image.bytes).ensureAlpha().raw().toBuffer();
  const overlay = await sharp(image.traceOverlay.bytes).ensureAlpha().raw().toBuffer();
  let changed = 0;
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    if (!original.subarray(pixel * 4, pixel * 4 + 4).equals(overlay.subarray(pixel * 4, pixel * 4 + 4))) changed++;
  }
  assert.equal(changed, 2);
  const corrupted = structuredClone(lesson); corrupted.exemplar.trace.sha256 = '0'.repeat(64);
  await assert.rejects(f.effects.lessonImages({ lessons: [corrupted] }), { code: 'DEFECT_LESSON_UNVERIFIED' });
});
