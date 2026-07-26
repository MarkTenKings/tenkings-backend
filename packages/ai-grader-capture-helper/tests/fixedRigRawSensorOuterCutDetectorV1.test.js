const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { test } = require("node:test");

const drivers = require("../dist/drivers");
const {
  CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1,
  buildFixedRigStandardTradingCardBoundaryV1,
  sealFixedRigCanonicalObservedOuterCutV1,
  verifyFixedRigRawBoundObservedOuterCutArtifactV1,
} = drivers;

const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonicalHash = (value) => hash(Buffer.from(JSON.stringify(value), "utf8"));

function transformFor(rawSha256) {
  const crop = { leftPx: 100, topPx: 140, widthPx: 800, heightPx: 1120 };
  const scaleX = 1200 / crop.widthPx;
  const scaleY = 1680 / crop.heightPx;
  const payload = {
    schemaVersion: CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1,
    sourceSha256: rawSha256,
    sourceCoordinateFrame: "auto_oriented_raw_image_pixels",
    sourceWidthPx: 1000,
    sourceHeightPx: 1400,
    autoOrientApplied: true,
    deskewClockwiseDegrees: 0,
    rotatedWidthPx: 1000,
    rotatedHeightPx: 1400,
    crop,
    outputCoordinateFrame: "normalized_card_portrait_pixels",
    outputWidthPx: 1200,
    outputHeightPx: 1680,
    matrix: [
      scaleX, 0, -scaleX * crop.leftPx,
      0, scaleY, -scaleY * crop.topPx,
      0, 0, 1,
    ],
  };
  return { ...payload, transformSha256: canonicalHash(payload) };
}

function detectorInput(rawAllOnRgb) {
  const rawSha256 = hash(Buffer.from("exact-raw-all-on-file"));
  return {
    rawAllOnRgb,
    rawAllOnAssetId: "front-raw-all-on",
    rawAllOnAssetSha256: rawSha256,
    normalizedAllOnAssetId: "front-normalized-all-on",
    normalizedAllOnAssetSha256: hash(Buffer.from("exact-normalized-all-on-file")),
    rawToNormalizedTransform: transformFor(rawSha256),
    calibrationProfileId: "fixed-rig-profile-v1",
    calibrationVersion: "calibration-v1",
    calibrationSha256: hash(Buffer.from("finalized-calibration-profile")),
    intendedBoundary: buildFixedRigStandardTradingCardBoundaryV1({
      normalizedWidthPx: 1200,
      normalizedHeightPx: 1680,
    }),
    pixelsPerMmX: 1200 / 63.5,
    pixelsPerMmY: 1680 / 88.9,
    segmentationBoundaryU95Px: 1,
  };
}

function canonicalObservedContour(input, rawPoints, strongSupportFraction = 0.1) {
  const rawPayload = {
    sourceAssetSha256: input.rawAllOnAssetSha256,
    coordinateFrame: "source_image_pixels",
    points: rawPoints,
  };
  const raw = {
    schemaVersion: "ten-kings-card-geometry-observed-dense-contour-v1",
    coordinateFrame: "source_image_pixels",
    sourceAssetSha256: input.rawAllOnAssetSha256,
    points: rawPoints,
    pointCount: rawPoints.length,
    contourSha256: canonicalHash(rawPayload),
    strongSupportFraction,
    evidenceQuality: strongSupportFraction >= 0.65 ? "strong" : "limited",
    measurementsPx: {
      width: 800,
      height: 1120,
      perimeter: 3000,
      enclosedArea: 700000,
      angleDegrees: 0,
      circularArcs: [],
    },
  };
  const [a, b, c, d, e, f] = input.rawToNormalizedTransform.matrix;
  const normalizedPoints = rawPoints.map(({ x, y }) => ({
    x: Number((a * x + b * y + c).toFixed(6)),
    y: Number((d * x + e * y + f).toFixed(6)),
  }));
  const normalizedPayload = {
    sourceContourSha256: raw.contourSha256,
    rawToNormalizedTransformSha256: input.rawToNormalizedTransform.transformSha256,
    coordinateFrame: "normalized_card_portrait_pixels",
    points: normalizedPoints,
  };
  const normalized = {
    schemaVersion: "ten-kings-normalized-dense-contour-v1",
    coordinateFrame: "normalized_card_portrait_pixels",
    sourceContourSha256: raw.contourSha256,
    rawToNormalizedTransformSha256: input.rawToNormalizedTransform.transformSha256,
    points: normalizedPoints,
    pointCount: normalizedPoints.length,
    contourSha256: canonicalHash(normalizedPayload),
  };
  return { raw, normalized };
}

test("the expected-profile search detector is physically absent from the runtime export", () => {
  assert.equal(drivers.detectFixedRigRawBoundObservedOuterCutV1, undefined);
});

test("canonical contour sealing measures foggy visible geometry without an expected-profile gate", () => {
  const fog = {
    width: 1000,
    height: 1400,
    data: new Float32Array(1000 * 1400 * 3).fill(0.5),
  };
  const input = detectorInput(fog);
  const rawPoints = Array.from({ length: 96 }, (_, index) => {
    const angle = index * Math.PI * 2 / 96;
    return {
      x: Number((500 + Math.cos(angle) * 360).toFixed(6)),
      y: Number((700 + Math.sin(angle) * 500).toFixed(6)),
    };
  });
  const contour = canonicalObservedContour(input, rawPoints, 0.08);
  const result = sealFixedRigCanonicalObservedOuterCutV1({
    ...input,
    observedRawContour: contour.raw,
    observedNormalizedContour: contour.normalized,
  });

  assert.equal(result.status, "computed", JSON.stringify(result));
  assert.equal(result.artifact.contourAuthority, "canonical_pixel_derived_dense_contour");
  assert.equal(result.artifact.canonicalRawContourSha256, contour.raw.contourSha256);
  assert.equal(
    result.artifact.canonicalNormalizedContourSha256,
    contour.normalized.contourSha256,
  );
  assert.deepEqual(result.artifact.rawContour, rawPoints);
  assert.equal(result.artifact.supportedCrossSectionCount, 0);
  assert.ok(result.artifact.confidence > 0);
  assert.ok(result.artifact.u95Mm > 0);
  assert.equal(verifyFixedRigRawBoundObservedOuterCutArtifactV1(result.artifact), true);
});

test("canonical contour sealing rejects transform or contour mutation instead of re-detecting", () => {
  const plane = {
    width: 1000,
    height: 1400,
    data: new Float32Array(1000 * 1400 * 3).fill(0.5),
  };
  const input = detectorInput(plane);
  const rawPoints = [
    { x: 100, y: 140 },
    { x: 900, y: 140 },
    { x: 900, y: 1260 },
    { x: 100, y: 1260 },
  ];
  const contour = canonicalObservedContour(input, rawPoints, 1);
  const result = sealFixedRigCanonicalObservedOuterCutV1({
    ...input,
    observedRawContour: contour.raw,
    observedNormalizedContour: {
      ...contour.normalized,
      points: contour.normalized.points.map((point, index) =>
        index === 0 ? { ...point, x: point.x + 1 } : point),
    },
  });

  assert.equal(result.status, "insufficient_evidence");
  assert.match(result.reasons.join(" "), /hash-bound through normalization/i);
});

test("even a checksum-resealed legacy expected-profile artifact is rejected", () => {
  const plane = {
    width: 1000,
    height: 1400,
    data: new Float32Array(1000 * 1400 * 3).fill(0.5),
  };
  const input = detectorInput(plane);
  const contour = canonicalObservedContour(input, [
    { x: 100, y: 140 },
    { x: 900, y: 140 },
    { x: 900, y: 1260 },
    { x: 100, y: 1260 },
  ], 1);
  const sealed = sealFixedRigCanonicalObservedOuterCutV1({
    ...input,
    observedRawContour: contour.raw,
    observedNormalizedContour: contour.normalized,
  });
  assert.equal(sealed.status, "computed");
  const { artifactSha256: _oldHash, ...canonicalPayload } = sealed.artifact;
  const legacyPayload = {
    ...canonicalPayload,
    contourAuthority: "legacy_expected_profile_search",
  };
  const legacy = {
    ...legacyPayload,
    artifactSha256: canonicalHash(legacyPayload),
  };
  assert.equal(verifyFixedRigRawBoundObservedOuterCutArtifactV1(legacy), false);
});
