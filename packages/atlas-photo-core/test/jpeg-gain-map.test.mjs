import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptorSha256, parseDecodedFrame, parseOriginal, planDecode } from '../src/index.mjs';
const hash = c => c.repeat(64);
const limits = { maxInputBytes: 1000, maxPixels: 100, maxRasterBytes: 800, maxOutputBytes: 1000, timeoutMs: 1000 };
function fixture() {
  const metadata = { encoded: { width: 4, height: 3 }, orientation: 6, orientationSource: 'exif', crop: null,
    selection: { kind: 'primary-jpeg-sdr-base', primaryByteCount: 80, gainMapByteCount: 20,
      gainMapSha256: hash('b'), metadataSha256: hash('c') }, bitDepth: 8,
    iccSha256: '20789fdbea9835251a4f0796c8bf45cbd964896044886540da21ffc7457af0ab', colorSpace: 'srgb', dynamicRange: 'HDR' };
  const original = { schemaVersion: 1, kind: 'original', uploadId: 'synthetic-upload',
    binding: { cardId: 'synthetic-card', pairId: 'pair', side: 'FRONT', version: 1 },
    object: { key: 'original/front', versionId: '1' }, content: { mime: 'image/jpeg', sha256: hash('a'), byteCount: 100 }, metadata };
  const plan = planDecode(original, metadata, limits);
  const frame = { schemaVersion: 1, kind: 'decoded-frame', id: 'synthetic-frame', originalDescriptorSha256: descriptorSha256(original),
    decodePlanSha256: descriptorSha256(plan), raster: { object: { key: 'decoded/front', versionId: '1' },
      content: { mime: 'image/png', sha256: hash('d'), byteCount: 90 }, dimensions: { width: 3, height: 4 } },
    sourceToFrame: plan.geometry.matrix, treatment: { decoder: 'synthetic-contract-fixture', version: '1',
      policyVersion: 'atlas-jpeg-apple-sdr-base-srgb-v1', channels: 3, bitDepth: 8, colorSpace: 'sRGB',
      colorTreatment: 'converted', hdrTreatment: 'sdr-base' } };
  return { original, plan, frame };
}
test('JPEG HDR provenance binds full original, gain map, metadata, SDR base treatment and transform', () => {
  const { original, plan, frame } = fixture();
  assert.deepEqual(parseOriginal(original), original);
  assert.deepEqual(parseDecodedFrame(frame, original, plan), frame);
  const unknown = { ...original, metadata: null };
  assert.equal(planDecode(unknown, original.metadata, limits).metadata.selection.kind, 'primary-jpeg-sdr-base');
  for (const mutate of [m => m.selection.primaryByteCount++, m => m.selection.gainMapByteCount++,
    m => m.selection.gainMapSha256 = 'bad', m => m.selection.metadataSha256 = 'bad',
    m => m.selection.extra = true, m => m.iccSha256 = hash('e'), m => m.dynamicRange = 'SDR', m => m.bitDepth = 10]) {
    const metadata = structuredClone(original.metadata); mutate(metadata);
    assert.throws(() => planDecode(unknown, metadata, limits));
  }
  for (const mutate of [v => v.treatment.policyVersion = 'atlas-heif-apple-sdr-base-v1',
    v => v.treatment.colorSpace = 'Display P3', v => v.treatment.colorTreatment = 'preserved',
    v => v.treatment.bitDepth = 16, v => v.treatment.channels = 4, v => v.sourceToFrame[0]++]) {
    const value = structuredClone(frame); mutate(value); assert.throws(() => parseDecodedFrame(value, original, plan));
  }
  for (const mime of ['image/png', 'image/webp', 'image/heic']) assert.throws(() => parseOriginal({
    ...original, content: { ...original.content, mime } }));
});
