import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptorSha256, parseDecodedFrame, parseOriginal, planDecode } from '../src/index.mjs';

const hash = 'a'.repeat(64), clone = structuredClone;
function fixture({ width = 4032, height = 3024, byteCount = 19_166_170 } = {}) {
  const original = parseOriginal({ schemaVersion: 1, kind: 'original', uploadId: 'upload-front',
    binding: { cardId: 'card', pairId: 'pair', side: 'FRONT', version: 1 },
    object: { key: 'test/originals/photo.jpg', versionId: 'v1' }, content: { mime: 'image/jpeg', sha256: hash, byteCount }, metadata: null });
  const decodePlan = planDecode(original, { encoded: { width, height }, orientation: 6, orientationSource: 'exif', crop: null,
    selection: { kind: 'single-frame' }, bitDepth: 8, iccSha256: null, colorSpace: 'sRGB', dynamicRange: 'SDR' },
  { maxInputBytes: 256 * 1024 * 1024, maxPixels: 52_000_000, maxRasterBytes: 512 * 1024 * 1024, maxOutputBytes: 256 * 1024 * 1024, timeoutMs: 90000 });
  const source = parseDecodedFrame({ schemaVersion: 1, kind: 'decoded-frame', id: 'normalized-source',
    originalDescriptorSha256: descriptorSha256(original), decodePlanSha256: descriptorSha256(decodePlan),
    raster: { object: { key: 'test/derived/source.png', versionId: 'v2' }, content: { mime: 'image/png', sha256: 'b'.repeat(64), byteCount },
      dimensions: { width: height, height: width } }, sourceToFrame: decodePlan.geometry.matrix,
    treatment: { decoder: 'fixture', version: '1', policyVersion: 'fixture', channels: 3, bitDepth: 8,
      colorSpace: 'sRGB', colorTreatment: 'preserved', hdrTreatment: 'not-present' } }, original, decodePlan);
  const transparent = Math.ceil(width * height * 0.01), visible = width * height - transparent;
  const frame = { schemaVersion: 4, kind: 'decoded-frame', id: 'cleaned-source',
    originalDescriptorSha256: descriptorSha256(original), decodePlanSha256: descriptorSha256(decodePlan),
    raster: { object: { key: 'test/derived/cleaned.png', versionId: 'v3' }, content: { mime: 'image/png', sha256: 'c'.repeat(64), byteCount },
      dimensions: source.raster.dimensions }, sourceToFrame: source.sourceToFrame,
    treatment: { decoder: 'photoroom-plus-hd-background-removal', version: 'plus-hd-auto', policyVersion: 'atlas-background-removal-grading-image-v1',
      channels: 4, bitDepth: 8, colorSpace: 'sRGB', colorTreatment: 'preserved', hdrTreatment: 'not-present' },
    segmentation: { sourceFrame: source, recipeHash: 'd'.repeat(64), provider: 'PHOTOROOM_PLUS', endpoint: 'https://image-api.photoroom.com/v2/edit',
      foregroundRGB: { validation: 'bounded-edge-rgb-v1', visiblePixels: visible, opaquePixels: visible - 10, fractionalPixels: 10,
        comparedChannels: 3, mismatchedPixels: 0, mismatchedChannels: 0, opaqueMismatchedPixels: 0, minChannelDelta: 0, maxChannelDelta: 0 },
      alphaBoundary: { validation: 'exterior-alpha-band-v1', connectivity: 4, distanceMetric: 'manhattan', maxFractionalDistance: 2,
        enclosedTransparentPixels: 0, enclosedFractionalPixels: 0 } } };
  return { original, decodePlan, source, frame };
}

test('full-resolution removal retains exact normalized dimensions and original orientation transform', () => {
  const f = fixture(), parsed = parseDecodedFrame(f.frame, f.original, f.decodePlan);
  assert.deepEqual(parsed.raster.dimensions, { width: 3024, height: 4032 });
  assert.deepEqual(parsed.sourceToFrame, f.decodePlan.geometry.matrix);
  assert.equal(parsed.raster.content.byteCount, 19_166_170);
  assert.equal(parsed.generation, undefined); assert.equal(parsed.segmentation.provider, 'PHOTOROOM_PLUS');
});

test('segmentation cannot claim resizing, recoloring, another provider, original overwrite or changed source lineage', () => {
  const f = fixture();
  for (const change of [
    v => { v.raster.dimensions.width--; }, v => { v.sourceToFrame = [1,0,0,0,1,0,0,0,1]; },
    v => { v.treatment.colorTreatment = 'converted'; }, v => { v.treatment.colorSpace = 'Display-P3'; },
    v => { v.treatment.decoder = 'openai-images-edit'; }, v => { v.treatment.policyVersion = 'atlas-generated-grading-image-v1'; },
    v => { v.segmentation.provider = 'PHOTOROOM_BASIC'; }, v => { v.segmentation.endpoint = 'https://sdk.photoroom.com/v1/segment'; },
    v => { v.segmentation.foregroundRGB.mismatchedPixels = 1; }, v => { v.segmentation.foregroundRGB.comparedChannels = 1; },
    v => { v.segmentation.foregroundRGB.visiblePixels = 0; }, v => { v.segmentation.foregroundRGB.visiblePixels = 3024 * 4032; },
    v => { v.segmentation.foregroundRGB.validation = 'exact-visible-rgb-v1'; },
    v => { v.segmentation.foregroundRGB.opaqueMismatchedPixels = 1; }, v => { v.segmentation.foregroundRGB.minChannelDelta = -2; },
    v => { v.segmentation.foregroundRGB.maxChannelDelta = 1; }, v => { v.segmentation.foregroundRGB.mismatchedChannels = 1; },
    v => { v.segmentation.foregroundRGB.fractionalPixels = 0; }, v => { v.segmentation.foregroundRGB.opaquePixels--; },
    v => { v.segmentation.alphaBoundary.maxFractionalDistance = 17; }, v => { v.segmentation.alphaBoundary.maxFractionalDistance = 0; },
    v => { v.segmentation.alphaBoundary.connectivity = 8; }, v => { v.segmentation.alphaBoundary.distanceMetric = 'chebyshev'; },
    v => { v.segmentation.alphaBoundary.enclosedTransparentPixels = 1; }, v => { v.segmentation.alphaBoundary.enclosedFractionalPixels = 1; },
    v => { v.segmentation.sourceFrame.raster.dimensions.width--; }, v => { v.raster.object = f.original.object; },
    v => { v.raster.object = f.source.raster.object; }, v => { v.originalDescriptorSha256 = 'e'.repeat(64); },
  ]) { const changed = clone(f.frame); change(changed); assert.throws(() => parseDecodedFrame(changed, f.original, f.decodePlan)); }
});

test('Photoroom frame limits are bounded independently from wider intake limits', () => {
  const f = fixture();
  const large = clone(f.frame); large.raster.content.byteCount = 101 * 1024 * 1024 + 1;
  assert.throws(() => parseDecodedFrame(large, f.original, f.decodePlan), { code: 'PHOTO_DECODE_LIMIT' });
  const wide = fixture({ width: 5001, height: 2 });
  assert.throws(() => parseDecodedFrame(wide.frame, wide.original, wide.decodePlan), { code: 'PHOTO_DECODE_LIMIT' });
});

test('bounded edge provenance admits only coherent measured counts and approved deltas', () => {
  const f = fixture(), rgb = f.frame.segmentation.foregroundRGB;
  Object.assign(rgb, { mismatchedPixels: 2, mismatchedChannels: 3, minChannelDelta: -1 });
  assert.deepEqual(parseDecodedFrame(f.frame, f.original, f.decodePlan).segmentation.foregroundRGB, rgb);
  for (const change of [
    v => { v.mismatchedChannels = 1; }, v => { v.mismatchedChannels = 7; }, v => { v.mismatchedPixels = 11; },
    v => { v.fractionalPixels = Math.ceil(v.visiblePixels * 0.03); v.opaquePixels = v.visiblePixels - v.fractionalPixels; },
    v => { v.mismatchedPixels = Math.ceil(v.visiblePixels * 0.002) + 1; v.mismatchedChannels = v.mismatchedPixels;
      v.fractionalPixels = v.mismatchedPixels; v.opaquePixels = v.visiblePixels - v.fractionalPixels; },
  ]) { const value = clone(f.frame); change(value.segmentation.foregroundRGB); assert.throws(() => parseDecodedFrame(value, f.original, f.decodePlan)); }
});
