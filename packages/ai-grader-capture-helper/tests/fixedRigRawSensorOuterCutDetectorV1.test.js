const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');

const {
  CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1,
  buildFixedRigStandardTradingCardBoundaryV1,
  detectFixedRigRawBoundObservedOuterCutV1,
  verifyFixedRigRawBoundObservedOuterCutArtifactV1,
} = require('../dist/drivers');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const canonicalHash = (value) => hash(Buffer.from(JSON.stringify(value), 'utf8'));

function transformFor(rawSha256, crop = {
  leftPx: 100,
  topPx: 140,
  widthPx: 800,
  heightPx: 1120,
}) {
  const scaleX = 1200 / crop.widthPx;
  const scaleY = 1680 / crop.heightPx;
  const payload = {
    schemaVersion: CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1,
    sourceSha256: rawSha256,
    sourceCoordinateFrame: 'auto_oriented_raw_image_pixels',
    sourceWidthPx: 1000,
    sourceHeightPx: 1400,
    autoOrientApplied: true,
    deskewClockwiseDegrees: 0,
    rotatedWidthPx: 1000,
    rotatedHeightPx: 1400,
    crop,
    outputCoordinateFrame: 'normalized_card_portrait_pixels',
    outputWidthPx: 1200,
    outputHeightPx: 1680,
    matrix: [
      scaleX,
      0,
      -scaleX * crop.leftPx,
      0,
      scaleY,
      -scaleY * crop.topPx,
      0,
      0,
      1,
    ],
  };
  return { ...payload, transformSha256: canonicalHash(payload) };
}

function rawCardPlane(radius = 40, halfWidth = 400) {
  const width = 1000;
  const height = 1400;
  const data = new Float32Array(width * height * 3);
  const centerX = 500;
  const centerY = 700;
  const halfHeight = 560;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const qx = Math.abs(x + 0.5 - centerX) - (halfWidth - radius);
      const qy = Math.abs(y + 0.5 - centerY) - (halfHeight - radius);
      const signedDistance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0) - radius;
      const value = 1 / (1 + Math.exp(signedDistance * 2));
      const offset = (y * width + x) * 3;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
  return { width, height, data };
}

function detectorInput(rawAllOnRgb, crop) {
  const rawSha256 = hash(Buffer.from('exact-raw-all-on-file'));
  return {
    rawAllOnRgb,
    rawAllOnAssetId: 'front-raw-all-on',
    rawAllOnAssetSha256: rawSha256,
    normalizedAllOnAssetId: 'front-normalized-all-on',
    normalizedAllOnAssetSha256: hash(Buffer.from('exact-normalized-all-on-file')),
    rawToNormalizedTransform: transformFor(rawSha256, crop),
    calibrationProfileId: 'fixed-rig-profile-v1',
    calibrationVersion: 'calibration-v1',
    calibrationSha256: hash(Buffer.from('finalized-calibration-profile')),
    intendedBoundary: buildFixedRigStandardTradingCardBoundaryV1({
      normalizedWidthPx: 1200,
      normalizedHeightPx: 1680,
    }),
    pixelsPerMmX: 1200 / 63.5,
    pixelsPerMmY: 1680 / 88.9,
    segmentationBoundaryU95Px: 1,
  };
}

test('raw sensor outer-cut detector searches raw exterior pixels and emits a transform-bound contour', () => {
  const input = detectorInput(rawCardPlane());
  const result = detectFixedRigRawBoundObservedOuterCutV1(input);
  assert.equal(result.status, 'computed');
  assert.equal(verifyFixedRigRawBoundObservedOuterCutArtifactV1(result.artifact), true);
  assert.equal(result.artifact.rawAllOnAssetSha256, input.rawAllOnAssetSha256);
  assert.equal(
    result.artifact.rawToNormalizedTransformSha256,
    input.rawToNormalizedTransform.transformSha256,
  );
  assert.equal(result.artifact.crossSectionCount, 192);
  assert.equal(result.artifact.supportedCrossSectionCount, 192);
  assert.equal(result.artifact.rawContour.length, 192);
  assert.equal(result.artifact.normalizedContour.length, 192);
  assert.ok(result.artifact.u95ComponentsMm.rawDetectorLocalization > 0);
  assert.ok(result.artifact.u95Mm >
    result.artifact.u95ComponentsMm.calibratedSegmentationBoundary);
});

test('raw sensor outer-cut detector recovers exact strong edges from bounded normalization geometry mismatch', () => {
  const input = detectorInput(rawCardPlane(), {
    leftPx: 80,
    topPx: 140,
    widthPx: 840,
    heightPx: 1120,
  });
  const result = detectFixedRigRawBoundObservedOuterCutV1(input);
  assert.equal(result.status, 'computed');
  assert.equal(result.artifact.supportedCrossSectionCount, 192);
  assert.ok(result.artifact.minimumDetectedGradientDigitalUnits >= 4);
});

test('raw sensor outer-cut detector applies only the narrow rounded-corner recovery margin', () => {
  const result = detectFixedRigRawBoundObservedOuterCutV1(
    detectorInput(rawCardPlane(75)),
  );
  assert.equal(result.status, 'computed', JSON.stringify(result));
  assert.equal(result.artifact.supportedCrossSectionCount, 192);
  assert.ok(result.artifact.minimumDetectedGradientDigitalUnits >= 4);
});

test('raw sensor outer-cut detector does not apply the corner margin to straight edges', () => {
  const result = detectFixedRigRawBoundObservedOuterCutV1(
    detectorInput(rawCardPlane(40, 420)),
  );
  assert.equal(result.status, 'insufficient_evidence');
  assert.match(result.reasons.join(' '), /gradient/i);
});

test('raw sensor outer-cut detector rejects normalization mismatch beyond its bounded recovery envelope', () => {
  const result = detectFixedRigRawBoundObservedOuterCutV1(
    detectorInput(rawCardPlane(), {
      leftPx: 50,
      topPx: 350,
      widthPx: 900,
      heightPx: 700,
    }),
  );
  assert.equal(result.status, 'insufficient_evidence');
  assert.match(result.reasons.join(' '), /bounded outer-cut recovery envelope/i);
});

test('raw sensor outer-cut detector fails closed when raw exterior evidence is absent or transform identity is changed', () => {
  const input = detectorInput(rawCardPlane());
  const empty = {
    width: input.rawAllOnRgb.width,
    height: input.rawAllOnRgb.height,
    data: new Float32Array(input.rawAllOnRgb.data.length).fill(0.5),
  };
  const noBoundary = detectFixedRigRawBoundObservedOuterCutV1({
    ...input,
    rawAllOnRgb: empty,
  });
  assert.equal(noBoundary.status, 'insufficient_evidence');
  assert.match(noBoundary.reasons.join(' '), /gradient/i);

  const weakBoundary = rawCardPlane();
  for (let index = 0; index < weakBoundary.data.length; index += 1) {
    weakBoundary.data[index] = 0.5 + (weakBoundary.data[index] - 0.5) * 0.02;
  }
  const weakResult = detectFixedRigRawBoundObservedOuterCutV1({
    ...detectorInput(weakBoundary, {
      leftPx: 80,
      topPx: 140,
      widthPx: 840,
      heightPx: 1120,
    }),
  });
  assert.equal(weakResult.status, 'insufficient_evidence');
  assert.match(weakResult.reasons.join(' '), /gradient/i);

  const changedIdentity = detectFixedRigRawBoundObservedOuterCutV1({
    ...input,
    rawAllOnAssetSha256: hash(Buffer.from('different-raw-file')),
  });
  assert.equal(changedIdentity.status, 'insufficient_evidence');
  assert.match(changedIdentity.reasons.join(' '), /transform/i);
});
