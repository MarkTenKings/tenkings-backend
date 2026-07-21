const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} = require("../../shared/dist");
const {
  FIXED_RIG_PRINTED_BORDER_SOURCE_DETECTOR_V1_VERSION,
  buildFixedRigPrintedBorderCenteringSideV1,
  detectFixedRigPrintedBorderSourceV1,
} = require("../dist/drivers/fixedRigPrintedBorderDetectorV1");

const SHA = "a".repeat(64);
const WIDTH = 120;
const HEIGHT = 160;

function plane(valueOrFactory) {
  const data = new Float32Array(WIDTH * HEIGHT);
  for (let index = 0; index < data.length; index += 1) {
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    data[index] = typeof valueOrFactory === "function"
      ? valueOrFactory(x, y, index)
      : valueOrFactory;
  }
  return { width: WIDTH, height: HEIGHT, data };
}

function outerCutContour() {
  return [
    { x: 0, y: 0 },
    { x: WIDTH - 1, y: 0 },
    { x: WIDTH - 1, y: HEIGHT - 1 },
    { x: 0, y: HEIGHT - 1 },
  ];
}

function evidence() {
  return [{
    assetId: "front-flat-field-normalized-all-on",
    sha256: SHA,
    side: "front",
    role: "all_on",
    regionId: "printed-border-source",
  }];
}

function detectorInput(sourcePlane) {
  return {
    side: "front",
    flatFieldNormalizedAllOnLuminance: sourcePlane,
    outerCutContour: outerCutContour(),
    evidence: evidence(),
  };
}

function acceptedCalibration() {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance;
  return {
    schemaVersion: MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
    profileId: "printed-border-calibration",
    calibrationVersion: "printed-border-calibration-v1",
    rigId: "fixed-rig-v1",
    isCalibrated: true,
    status: "finalized",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: "printed-border-calibration-artifact",
    artifactSha256: SHA,
    finalizedAt: "2026-07-18T12:00:00.000Z",
    normalizedWidthPx: WIDTH,
    normalizedHeightPx: HEIGHT,
    mmPerPixelX: 0.1,
    mmPerPixelY: 0.1,
    scaleRelativeU95: 0,
    scaleSampleCount: policy.minimumScaleSamples,
    lensCalibrationViewCount: policy.minimumLensCalibrationViews,
    lensResidualPx: 0,
    normalizationRegistrationResidualPx: 0,
    normalizationRegistrationSampleCount: policy.minimumNormalizationRegistrations,
    repeatedPlacementCount: policy.minimumRepeatedPlacements,
    repeatedPlacementU95Mm: 0,
    segmentationBoundaryU95Px: 0,
    segmentationBoundarySampleCount: policy.minimumSegmentationBoundarySamples,
    measurementRepeatability: {
      linearMm: { sampleCount: policy.minimumMeasurementRepeatabilitySamplesPerClass, u95: 0 },
      areaMm2: { sampleCount: policy.minimumMeasurementRepeatabilitySamplesPerClass, u95: 0 },
      reliefIndex: { sampleCount: policy.minimumMeasurementRepeatabilitySamplesPerClass, u95: 0 },
      roughnessIndex: { sampleCount: policy.minimumMeasurementRepeatabilitySamplesPerClass, u95: 0 },
      colorDeltaE: { sampleCount: policy.minimumMeasurementRepeatabilitySamplesPerClass, u95: 0 },
    },
    channels: Array.from({ length: policy.requiredChannelCount }, (_, index) => {
      const angle = 2 * Math.PI * index / policy.requiredChannelCount;
      return {
        channelIndex: index + 1,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        directionConfidence: 1,
        directionMeasurementSampleCount: policy.minimumChannelDirectionMeasurementSamples,
        directionAngularU95Degrees: 0,
        directionSourceRadiusMm: 10,
        directionPointU95Mm: 0.1,
        flatFieldArtifactId: `flat-field-${index + 1}`,
        flatFieldArtifactSha256: SHA,
        flatFieldFrameCount: policy.minimumFlatFieldFramesPerChannel,
        darkControlFrameCount: policy.minimumDarkControlFramesPerChannel,
        maxFlatFieldDeviationFraction: 0,
        illuminationPatternArtifactId: `illumination-pattern-${index + 1}`,
        illuminationPatternArtifactSha256: SHA,
        illuminationPatternFrameCount: policy.minimumIlluminationPatternFramesPerChannel,
        responseScale: 1,
      };
    }),
  };
}

test("known printed border produces robust many-cross-section evidence and feeds centering directly", () => {
  const source = plane((x, y) =>
    x >= 10 && x <= 109 && y >= 12 && y <= 147 ? 0.85 : 0.15);
  const result = detectFixedRigPrintedBorderSourceV1(detectorInput(source));

  assert.equal(result.status, "computed", JSON.stringify(result));
  assert.equal(result.version, FIXED_RIG_PRINTED_BORDER_SOURCE_DETECTOR_V1_VERSION);
  assert.equal(result.sourcePlane, "flat_field_normalized_all_on_luminance");
  assert.equal(result.thresholds.gradientPolarity, "absolute_luminance_gradient");
  assert.equal(result.thresholds.minimumNormalizedGradient, 0.02);
  assert.deepEqual(result.detectedPrintContour, [
    { x: 9.5, y: 11.5 },
    { x: 109.5, y: 11.5 },
    { x: 109.5, y: 147.5 },
    { x: 9.5, y: 147.5 },
  ]);
  assert.equal(result.profileInput.profile, "printed_border_v1");
  assert.equal(result.profileInput.printBoundarySamples.left.length, 136);
  assert.equal(result.profileInput.printBoundarySamples.top.length, 100);
  assert.equal(result.boundaryEvidence.left.attemptedCrossSectionCount, 159);
  assert.equal(result.boundaryEvidence.left.supportedCrossSectionCount, 136);
  assert.equal(result.boundaryEvidence.left.supportFraction, 0.855346);
  assert.equal(result.boundaryEvidence.left.fitResidualPx, 0);
  assert.equal(result.boundaryEvidence.left.samples[0].absoluteNormalizedGradient, 0.7);
  assert.equal(result.boundaryEvidence.left.samples[0].adaptiveGradientThreshold, 0.02);
  assert.equal(result.boundaryEvidence.left.accepted, true);
  assert.equal(result.boundaryEvidence.left.viableClusterCount, 1);
  assert.deepEqual(result.evidence, evidence());
  assert.equal(result.conditionDeduction, 0);

  const built = buildFixedRigPrintedBorderCenteringSideV1({
    side: "front",
    calibration: acceptedCalibration(),
    outerCutContour: outerCutContour(),
    flatFieldNormalizedAllOnLuminance: source,
    marginDifferenceU95Mm: { horizontal: 0, vertical: 0 },
    evidence: evidence(),
  });
  assert.equal(built.detector.status, "computed");
  assert.equal(built.centering.status, "computed", JSON.stringify(built.centering));
  assert.equal(built.centering.profile, "printed_border_v1");
  assert.equal(built.centering.score, 10);
  assert.deepEqual(built.centering.printedDesignContour, result.detectedPrintContour);
});

test("tilted printed border is retained as four robust 2-D lines and exact side-line intersections", () => {
  const source = plane((x, y) => {
    const left = 7 + 0.02 * y;
    const right = 108 + 0.02 * y;
    const top = 11 - 0.015 * x;
    const bottom = 148 - 0.015 * x;
    return x >= left && x <= right && y >= top && y <= bottom ? 0.85 : 0.15;
  });
  const result = detectFixedRigPrintedBorderSourceV1(detectorInput(source));
  assert.equal(result.status, "computed", JSON.stringify(result));
  assert.equal(result.boundaryEvidence.left.fittedModel, "robust_2d_line");
  assert.ok(Math.abs(result.boundaryEvidence.left.lineSlope - 0.02) < 0.005);
  assert.ok(Math.abs(result.boundaryEvidence.top.lineSlope + 0.015) < 0.005);
  assert.ok(result.boundaryEvidence.left.positionU95Px > 0);
  assert.notEqual(result.detectedPrintContour[0].x, result.detectedPrintContour[3].x);
  assert.notEqual(result.detectedPrintContour[0].y, result.detectedPrintContour[1].y);
  assert.match(result.formula, /robust 2-D line fit; side-line intersections/);

  const built = buildFixedRigPrintedBorderCenteringSideV1({
    side: "front",
    calibration: acceptedCalibration(),
    outerCutContour: outerCutContour(),
    flatFieldNormalizedAllOnLuminance: source,
    marginDifferenceU95Mm: { horizontal: 0, vertical: 0 },
    evidence: evidence(),
  });
  assert.equal(built.centering.status, "computed");
  assert.deepEqual(built.centering.printedDesignContour, result.detectedPrintContour);
  assert.ok(built.centering.u95ComponentsMm.printedBoundaryFit.horizontal > 0);
});

test("absent border returns explicit insufficient evidence and never a condition deduction", () => {
  const result = detectFixedRigPrintedBorderSourceV1(detectorInput(plane(0.5)));
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.profileInput, null);
  assert.deepEqual(result.detectedPrintContour, []);
  assert.equal(result.conditionDeduction, 0);
  assert.equal(result.requiresRecaptureOrRegisteredDesignReference, true);
  assert.equal(result.reasons.length, 4);
  assert.equal(result.reasons.every((reason) => reason.code === "no_threshold_qualified_gradient"), true);

  const built = buildFixedRigPrintedBorderCenteringSideV1({
    side: "front",
    calibration: acceptedCalibration(),
    outerCutContour: outerCutContour(),
    flatFieldNormalizedAllOnLuminance: plane(0.5),
    marginDifferenceU95Mm: { horizontal: 0, vertical: 0 },
    evidence: evidence(),
  });
  assert.equal(built.centering.status, "insufficient_evidence");
  assert.equal(built.centering.score, null);
  assert.equal(built.centering.cardDefectDeduction, 0);
});

test("spatially incoherent noisy artwork cannot masquerade as a printed border", () => {
  const source = plane(0.4);
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    source.data[y * WIDTH + 3 + (y * 7) % 20] = 0.95;
    source.data[y * WIDTH + WIDTH - 4 - (y * 11) % 20] = 0.95;
  }
  for (let x = 1; x < WIDTH - 1; x += 1) {
    source.data[(3 + (x * 13) % 25) * WIDTH + x] = 0.95;
    source.data[(HEIGHT - 4 - (x * 17) % 25) * WIDTH + x] = 0.95;
  }
  const result = detectFixedRigPrintedBorderSourceV1(detectorInput(source));
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.profileInput, null);
  assert.equal(result.conditionDeduction, 0);
  assert.equal(result.reasons.some((reason) =>
    reason.code === "insufficient_cross_section_support" ||
    reason.code === "no_threshold_qualified_gradient"), true);
  assert.equal(Object.values(result.boundaryEvidence).some((entry) => entry.accepted), false);
});

test("multiple fully supported nested boundaries are reported as ambiguous instead of guessed", () => {
  const source = plane((x, y) => {
    if (x >= 11 && x <= 108 && y >= 12 && y <= 147) return 0.9;
    if (x >= 7 && x <= 112 && y >= 8 && y <= 151) return 0.5;
    return 0.1;
  });
  const result = detectFixedRigPrintedBorderSourceV1(detectorInput(source));
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.profileInput, null);
  assert.equal(result.reasons.some((reason) =>
    reason.code === "ambiguous_multiple_supported_boundaries"), true);
  assert.equal(result.boundaryEvidence.left.viableClusterCount, 2);
  assert.deepEqual(result.boundaryEvidence.left.viableClusterCoordinatesPx, [6.5, 10.5]);
  assert.equal(result.conditionDeduction, 0);
});
