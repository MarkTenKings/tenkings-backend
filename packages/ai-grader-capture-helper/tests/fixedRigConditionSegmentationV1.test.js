const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} = require("../../shared/dist");
const {
  buildFixedRigConditionSegmentationV1,
  FIXED_RIG_CONDITION_SEGMENTATION_V1_VERSION,
} = require("../dist/drivers/fixedRigConditionSegmentationV1");
const {
  measureFixedRigCornerObservationV1,
  measureFixedRigEdgeObservationV1,
} = require("../dist/drivers/fixedRigCornerEdgeV1");
const { buildFixedRigSurfaceV1 } = require("../dist/drivers/fixedRigSurfaceV1");

const WIDTH = 80;
const HEIGHT = 120;
const PIXELS_PER_MM = 4;
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function plane(width, height, valueOrFactory = 0) {
  const data = new Float32Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    data[index] = typeof valueOrFactory === "function"
      ? valueOrFactory(x, y, index)
      : valueOrFactory;
  }
  return { width, height, data };
}

function setRect(target, left, top, width, height, value) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      target.data[y * target.width + x] = value;
    }
  }
}

function photometric(side, options = {}) {
  const invalid = new Set(options.invalid ?? []);
  const glare = new Set(options.glare ?? []);
  const residual = options.directionalResidual ?? (() => 0.12);
  const channels = Array.from({ length: 8 }, (_, index) => ({
    channel: index + 1,
    sourceEvidenceId: `${side}-channel-${index + 1}`,
    sourceSha256: SHA_A,
    flatFieldSourceEvidenceId: `flat-${index + 1}`,
    flatFieldSourceSha256: SHA_A,
    correctedResponse: new Float32Array(WIDTH * HEIGHT).fill(0.5),
    directionalResidual: plane(WIDTH, HEIGHT, (x, y, pixelIndex) =>
      index < 4 ? residual(x, y, pixelIndex) : 0,
    ).data,
    validDirectionalObservationMask: plane(WIDTH, HEIGHT, (_x, _y, pixelIndex) =>
      invalid.has(pixelIndex) ? 0 : 1,
    ).data,
    saturationMask: new Uint8Array(WIDTH * HEIGHT),
    underexposureMask: new Uint8Array(WIDTH * HEIGHT),
    lowConfidenceMask: new Uint8Array(WIDTH * HEIGHT),
  }));
  const invalidMask = plane(WIDTH, HEIGHT, (_x, _y, index) => invalid.has(index) ? 1 : 0).data;
  const glareMask = plane(WIDTH, HEIGHT, (_x, _y, index) => glare.has(index) ? 1 : 0).data;
  return {
    version: "fixed_rig_photometric_evidence_v1",
    status: "computed",
    coordinateFrame: "normalized_card_portrait_pixels",
    width: WIDTH,
    height: HEIGHT,
    channelCount: 8,
    calibration: {
      profileId: "condition-calibration-v1",
      version: "condition-calibration-v1.0.0",
      sha256: SHA_A,
      sourceEvidenceIds: ["physical-calibration-artifact"],
      finalizedAndCalibrated: true,
    },
    thresholdSetVersion: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    flatFieldCorrectionApplied: true,
    channels,
    commonModeResponse: new Float32Array(WIDTH * HEIGHT).fill(0.5),
    calibratedPatternScale: new Float32Array(WIDTH * HEIGHT),
    calibratedPatternSimilarity: new Float32Array(WIDTH * HEIGHT),
    usableDirectionalObservationCount: plane(WIDTH, HEIGHT, (_x, _y, index) =>
      invalid.has(index) ? 0 : 8,
    ).data,
    clippingMask: new Uint8Array(WIDTH * HEIGHT),
    commonModeSpecularMask: glareMask,
    calibratedIlluminationPatternMask: new Uint8Array(WIDTH * HEIGHT),
    specularOrIlluminationMask: glareMask,
    lowConfidenceMask: new Uint8Array(WIDTH * HEIGHT),
    insufficientDirectionalObservationsMask: invalidMask,
    invalidIlluminationMask: invalidMask,
    coverage: {
      validPixelCount: WIDTH * HEIGHT - invalid.size,
      totalPixelCount: WIDTH * HEIGHT,
      validPixelFraction: (WIDTH * HEIGHT - invalid.size) / (WIDTH * HEIGHT),
      clippedPixelFraction: 0,
      commonModeSpecularPixelFraction: glare.size / (WIDTH * HEIGHT),
      calibratedPatternPixelFraction: 0,
      invalidPixelFraction: invalid.size / (WIDTH * HEIGHT),
    },
    evidenceLimitations: [],
  };
}

function measurementCalibration() {
  const profile = {
    schemaVersion: "ai-grader-mathematical-calibration-profile-v1",
    profileId: "condition-calibration-v1",
    calibrationVersion: "condition-calibration-v1.0.0",
    rigId: "condition-test-rig-v1",
    isCalibrated: true,
    status: "finalized",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: "condition-calibration-artifact-v1",
    artifactSha256: SHA_A,
    finalizedAt: "2026-07-18T12:00:00.000Z",
    normalizedWidthPx: WIDTH,
    normalizedHeightPx: HEIGHT,
    mmPerPixelX: 1 / PIXELS_PER_MM,
    mmPerPixelY: 1 / PIXELS_PER_MM,
    scaleRelativeU95: 0.001,
    scaleSampleCount: 10,
    lensCalibrationViewCount: 10,
    lensResidualPx: 0.1,
    normalizationRegistrationResidualPx: 0.2,
    normalizationRegistrationSampleCount: 10,
    repeatedPlacementCount: 10,
    repeatedPlacementU95Mm: 0.01,
    segmentationBoundaryU95Px: 0.2,
    segmentationBoundarySampleCount: 10,
    measurementRepeatability: {
      linearMm: { sampleCount: 10, u95: 0.01 },
      areaMm2: { sampleCount: 10, u95: 0.02 },
      reliefIndex: { sampleCount: 10, u95: 0.01 },
      roughnessIndex: { sampleCount: 10, u95: 0.01 },
      colorDeltaE: { sampleCount: 10, u95: 0.1 },
    },
    channels: Array.from({ length: 8 }, (_, index) => ({
      channelIndex: index + 1,
      direction: { x: Math.cos(index * Math.PI / 4), y: Math.sin(index * Math.PI / 4) },
      directionConfidence: 1,
      directionMeasurementSampleCount: 3,
      directionAngularU95Degrees: 0,
      directionSourceRadiusMm: 100,
      directionPointU95Mm: 0.1,
      flatFieldArtifactId: `flat-${index + 1}`,
      flatFieldArtifactSha256: SHA_A,
      flatFieldFrameCount: 3,
      darkControlFrameCount: 3,
      maxFlatFieldDeviationFraction: 0,
      illuminationPatternArtifactId: "pattern-v1",
      illuminationPatternArtifactSha256: SHA_A,
      illuminationPatternFrameCount: 3,
      responseScale: 1,
    })),
  };
  return {
    profile,
    calibrationProfileId: "condition-calibration-v1",
    calibrationVersion: "condition-calibration-v1.0.0",
    calibrationSha256: SHA_A,
    pixelsPerMmX: PIXELS_PER_MM,
    pixelsPerMmY: PIXELS_PER_MM,
  };
}

function basePlanes() {
  return {
    normalizedLuminance: plane(WIDTH, HEIGHT, 0.5),
    expectedOuterCardMask: plane(WIDTH, HEIGHT, 1),
    materialPresenceConfidence: plane(WIDTH, HEIGHT, 1),
    segmentationConfidence: plane(WIDTH, HEIGHT, 1),
    boundaryConfidence: plane(WIDTH, HEIGHT, 1),
    exposedFiberResponse: plane(WIDTH, HEIGHT, 0),
    boundaryDeviationMm: plane(WIDTH, HEIGHT, 0),
    deformationResponse: plane(WIDTH, HEIGHT, 0),
    delaminationResponse: plane(WIDTH, HEIGHT, 0),
    edgeRoughnessIndex: plane(WIDTH, HEIGHT, 0),
    frayingResponse: plane(WIDTH, HEIGHT, 0),
    scratchLineResponse: plane(WIDTH, HEIGHT, 0),
    scuffTextureResponse: plane(WIDTH, HEIGHT, 0),
    creaseLineResponse: plane(WIDTH, HEIGHT, 0),
    chipDepthMm: plane(WIDTH, HEIGHT, 0),
    reliefIndex: plane(WIDTH, HEIGHT, 0),
    depthMm: plane(WIDTH, HEIGHT, 0),
    registeredColorDeltaE: plane(WIDTH, HEIGHT, 0),
    registeredPrintDeltaE: plane(WIDTH, HEIGHT, 0),
    registeredResidueDeltaE: plane(WIDTH, HEIGHT, 0),
  };
}

function buildInput(side = "front", overrides = {}) {
  const designReference = {
    schemaVersion: "ai-grader-design-reference-v1",
    designReferenceId: `${side}-design-reference-v1`,
    profile: "registered_design_template_v1",
    tenantId: "tenant-1",
    setId: "set-1",
    programId: "program-1",
    cardNumber: "42",
    variantId: "base",
    parallelId: null,
    side,
    artifactId: `${side}-design-artifact-v1`,
    artifactSha256: SHA_B,
    version: 1,
    widthPx: WIDTH,
    heightPx: HEIGHT,
    intendedPrintBoundary: [
      { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 },
    ],
    approvedBy: "admin-1",
    approvedAt: "2026-07-18T18:00:00.000Z",
  };
  return {
    side,
    cardIdentity: {
      tenantId: "tenant-1",
      setId: "set-1",
      programId: "program-1",
      cardNumber: "42",
      variantId: "base",
      parallelId: null,
    },
    designReference,
    designRegistration: {
      designReferenceId: designReference.designReferenceId,
      designReferenceSha256: designReference.artifactSha256,
      transformType: "affine",
      transformMatrix: [1, 0, 0, 0, 1, 0],
      registrationResidualPx: 0.2,
      inlierCount: 40,
      inlierFraction: 0.9,
      confidence: 0.95,
    },
    photometricEvidence: photometric(side),
    measurementCalibration: measurementCalibration(),
    algorithmVersion: "mathematical-condition-v1.0.0",
    sourceEvidence: [
      {
        assetId: `${side}-normalized-card`, sha256: SHA_A, side,
        role: "normalized_card", regionId: `${side}-full-card`,
      },
      {
        assetId: `${side}-accepted-design`, sha256: SHA_B, side,
        role: "design_reference", regionId: `${side}-full-card`,
      },
    ],
    planes: basePlanes(),
    ...overrides,
  };
}

test("condition detector identity and every source threshold are centralized", () => {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.conditionSegmentation;
  assert.equal(FIXED_RIG_CONDITION_SEGMENTATION_V1_VERSION, policy.detectorVersion);
  assert.equal(policy.regionGeometry.cornerRoiSizeMm, 6);
  assert.equal(policy.regionGeometry.edgeRoiDepthMm, 2);
  assert.equal(policy.evidenceThresholds.minimumScratchLineResponse, 0.6);
  assert.equal(policy.invalidPixelsMayBecomePhysicalDefects, false);
  assert.equal(
    policy.excludedEvidenceCoveragePolicy.minimumFullCardValidPixelCoverage,
    0.7,
  );
  assert.equal(
    policy.excludedEvidenceCoveragePolicy.minimumContiguousUngradableRegionPixels,
    12,
  );
  assert.equal(policy.excludedEvidenceCoveragePolicy.recoveredEvidenceMayProceed, true);
  assert.equal(policy.arbitrarySymmetryOrInternetReferenceAllowed, false);
});

test("known-size corner whitening, chip, shape, deformation, delamination, and relief stay location-independent", () => {
  const input = buildInput();
  setRect(input.planes.exposedFiberResponse, 2, 2, 4, 4, 0.8);
  setRect(input.planes.materialPresenceConfidence, 10, 2, 2, 2, 0.1);
  setRect(input.planes.chipDepthMm, 10, 2, 2, 2, 0.5);
  setRect(input.planes.boundaryDeviationMm, 14, 2, 2, 2, 0.25);
  setRect(input.planes.deformationResponse, 18, 2, 2, 2, 0.5);
  setRect(input.planes.delaminationResponse, 18, 6, 2, 2, 0.5);
  setRect(input.planes.reliefIndex, 18, 10, 2, 2, 0.5);

  const segmented = buildFixedRigConditionSegmentationV1(input);
  assert.equal(segmented.status, "computed");
  const topLeft = segmented.cornerObservations.find((entry) => entry.location === "top_left");
  const topRight = segmented.cornerObservations.find((entry) => entry.location === "top_right");
  assert.equal([...topLeft.whiteningMask.data].reduce((sum, value) => sum + value, 0), 16);
  assert.equal([...topRight.whiteningMask.data].reduce((sum, value) => sum + value, 0), 0);
  assert.equal(
    [...segmented.edgeObservations.find((entry) => entry.location === "top").damageMask.data]
      .reduce((sum, value) => sum + value, 0),
    0,
    "corner-owned pixels do not leak into the independent top-edge ROI",
  );

  const measured = measureFixedRigCornerObservationV1(topLeft);
  assert.equal(measured.status, "computed");
  const whitening = measured.findings.find((entry) =>
    entry.measurements.some((measurement) => measurement.kind === "area_mm2" && measurement.measuredMeasurement === 1),
  );
  assert.ok(whitening, "4x4 pixels at 4 px/mm measures exactly 1.00 mm2");
  assert.ok(measured.findings.some((entry) => entry.featurePixelCounts.missingMaterial === 4));
  assert.ok(measured.findings.some((entry) => entry.featurePixelCounts.shapeDeviation === 4));
  assert.ok(measured.findings.some((entry) => entry.featurePixelCounts.deformation === 4));
  assert.ok(measured.findings.some((entry) => entry.featurePixelCounts.delamination === 4));
  assert.ok(measured.findings.some((entry) => entry.featurePixelCounts.directionalRelief === 4));
  const allMeasurements = measured.findings.flatMap((entry) => entry.measurements);
  assert.ok(allMeasurements.some((entry) => entry.kind === "area_mm2" && entry.measuredMeasurement === 0.25));
  assert.ok(allMeasurements.some((entry) => entry.kind === "length_mm" && entry.measuredMeasurement === 0.5));
  assert.ok(allMeasurements.some((entry) => entry.kind === "shape_deviation_mm" && entry.measuredMeasurement === 0.25));
  assert.ok(allMeasurements.some((entry) => entry.kind === "deformation_area_mm2" && entry.measuredMeasurement === 0.25));
  assert.ok(allMeasurements.some((entry) => entry.kind === "relief_index" && entry.measuredMeasurement === 0.5));
});

test("known-size top-edge damage measures exact length/depth without corner overlap", () => {
  const input = buildInput();
  setRect(input.planes.materialPresenceConfidence, 30, 0, 20, 2, 0.1);
  setRect(input.planes.chipDepthMm, 30, 0, 20, 2, 0.25);
  setRect(input.planes.exposedFiberResponse, 30, 0, 20, 2, 0.5);
  setRect(input.planes.edgeRoughnessIndex, 30, 0, 20, 2, 0.4);
  setRect(input.planes.frayingResponse, 30, 0, 20, 2, 0.5);
  setRect(input.planes.delaminationResponse, 30, 0, 20, 2, 0.5);
  setRect(input.planes.deformationResponse, 30, 0, 20, 2, 0.5);
  const segmented = buildFixedRigConditionSegmentationV1(input);
  assert.equal(segmented.status, "computed");
  const top = segmented.edgeObservations.find((entry) => entry.location === "top");
  const measured = measureFixedRigEdgeObservationV1(top);
  assert.equal(measured.status, "computed");
  assert.equal(measured.findings.length, 1, "overlapping evidence is one physical component");
  assert.ok(measured.findings[0].measurements.some((entry) =>
    entry.kind === "length_mm" && entry.measuredMeasurement === 5,
  ));
  assert.ok(measured.findings[0].measurements.some((entry) =>
    entry.kind === "depth_mm" && entry.measuredMeasurement === 0.25,
  ));
  assert.ok(measured.findings[0].measurements.some((entry) =>
    entry.kind === "roughness_index" && entry.measuredMeasurement === 0.4,
  ));
  assert.equal(measured.findings[0].featurePixelCounts.fraying, 40);
  assert.equal(measured.findings[0].featurePixelCounts.delamination, 40);
  assert.equal(measured.findings[0].featurePixelCounts.deformation, 40);
  assert.equal(
    [...segmented.cornerObservations[0].missingMaterialMask.data].reduce((sum, value) => sum + value, 0),
    0,
  );
});

test("surface source planes create measured scratch/scuff/dent/crease/stain/print/residue seeds and real deductions", () => {
  const input = buildInput();
  input.unavailableModalities = ["metric_depth"];
  setRect(input.planes.scratchLineResponse, 20, 60, 40, 1, 0.9);
  setRect(input.planes.scuffTextureResponse, 10, 40, 4, 4, 0.8);
  setRect(input.planes.deformationResponse, 20, 40, 4, 4, 0.5);
  setRect(input.planes.reliefIndex, 20, 40, 4, 4, 0.2);
  setRect(input.planes.creaseLineResponse, 30, 80, 20, 1, 0.9);
  setRect(input.planes.reliefIndex, 30, 80, 20, 1, 0.2);
  setRect(input.planes.registeredColorDeltaE, 50, 20, 4, 4, 4);
  setRect(input.planes.registeredPrintDeltaE, 60, 30, 4, 4, 4);
  setRect(input.planes.registeredResidueDeltaE, 60, 50, 4, 4, 5);
  const segmented = buildFixedRigConditionSegmentationV1(input);
  assert.equal(segmented.status, "computed");
  assert.equal(segmented.surfaceDepthMm, undefined);
  for (const seed of segmented.surfaceCandidateSeeds) {
    assert.ok([...seed.candidateMask.data].some((value) => value === 1), `${seed.category} seed exists`);
  }
  const surface = buildFixedRigSurfaceV1({
    side: "front",
    photometricEvidence: input.photometricEvidence,
    calibration: input.measurementCalibration,
    algorithmVersion: input.algorithmVersion,
    candidateSeeds: segmented.surfaceCandidateSeeds,
    depthMm: segmented.surfaceDepthMm,
    reliefIndex: segmented.surfaceReliefIndex,
  });
  assert.equal(surface.status, "computed");
  assert.deepEqual(
    [...surface.findings.map((finding) => finding.category)].sort(),
    ["crease", "dent", "foreign_material", "print_defect", "scratch", "scuff", "stain"].sort(),
  );
  const scratch = surface.findings.find((finding) => finding.category === "scratch");
  assert.ok(scratch.deduction > 0);
  assert.ok(scratch.measurements.some((measurement) =>
    measurement.kind === "length_mm" && measurement.measuredMeasurement === 10,
  ));
  assert.ok(surface.findings.find((finding) => finding.category === "scuff").measurements.some(
    (measurement) => measurement.kind === "area_mm2" && measurement.measuredMeasurement === 1,
  ));
  assert.ok(surface.findings.find((finding) => finding.category === "dent").measurements.some(
    (measurement) => measurement.kind === "deformation_area_mm2" && measurement.measuredMeasurement === 1,
  ));
  assert.equal(surface.findings.find((finding) => finding.category === "dent").measurements.some(
    (measurement) => measurement.kind === "depth_mm",
  ), false);
  assert.ok(surface.score < 10, "real source evidence still deducts");
});

test("invalid evidence becomes neither a corner defect nor clean Grade-10 proof", () => {
  const invalidPixel = 2 * WIDTH + 2;
  const input = buildInput("front", { photometricEvidence: photometric("front", { invalid: [invalidPixel] }) });
  input.planes.exposedFiberResponse.data[invalidPixel] = 1;
  const segmented = buildFixedRigConditionSegmentationV1(input);
  assert.equal(segmented.status, "computed");
  assert.equal(segmented.evidenceQualityLimitations.length, 1);
  assert.equal(segmented.validEvidenceCoverage, 0.999896);
  assert.equal(segmented.excludedExpectedPixelFraction, 0.000104);
  assert.equal(segmented.evidenceQualityLimitations[0].requiresRecapture, false);
  const topLeft = segmented.cornerObservations.find((entry) => entry.location === "top_left");
  assert.equal(topLeft.whiteningMask.data[2 * topLeft.whiteningMask.width + 2], 0);
  const measured = measureFixedRigCornerObservationV1(topLeft);
  assert.equal(measured.status, "insufficient_evidence");
  assert.equal(measured.cardDefectDeduction, 0);
  assert.match(measured.reasons.join(" "), /clean Grade-10.*complete valid-pixel coverage/i);
});

test("manifest coverage policy permits small excluded evidence but fails a contiguous ungradable region", () => {
  const small = buildInput();
  setRect(small.planes.segmentationConfidence, 30, 40, 11, 1, 0);
  const recovered = buildFixedRigConditionSegmentationV1(small);
  assert.equal(recovered.status, "computed");
  assert.equal(recovered.validEvidenceCoverage, 0.998854);
  assert.equal(recovered.evidenceQualityLimitations[0].requiresRecapture, false);
  assert.equal(recovered.invalidPixelsBecameDefects, false);
  assert.equal(recovered.invalidPixelsProvedClean, false);

  const obscured = buildInput();
  setRect(obscured.planes.segmentationConfidence, 30, 40, 4, 3, 0);
  const insufficient = buildFixedRigConditionSegmentationV1(obscured);
  assert.equal(insufficient.status, "insufficient_evidence");
  assert.equal(insufficient.requiresRecapture, true);
  assert.equal(insufficient.cardDefectDeduction, 0);
  assert.match(
    insufficient.reasons.join(" "),
    /contiguous expected-card region.*12-pixel ungradable threshold/i,
  );
});

test("printed-border condition can proceed without design-relative color while identity mismatch fails", () => {
  const noReference = buildFixedRigConditionSegmentationV1(buildInput("front", {
    designReference: undefined,
    designRegistration: undefined,
    unavailableModalities: ["design_relative_color", "metric_depth", "polarized_residue"],
    sourceEvidence: [{
      assetId: "front-normalized-card", sha256: SHA_A, side: "front",
      role: "normalized_card", regionId: "front-full-card",
    }],
  }));
  assert.equal(noReference.status, "computed");
  assert.equal(noReference.designReferenceId, undefined);
  assert.equal(noReference.evidenceQualityLimitations.some((limitation) =>
    limitation.code === "design_dependent_condition_evidence_unavailable" &&
    limitation.requiresRecapture === false), true);

  const mismatchInput = buildInput();
  mismatchInput.measurementCalibration = {
    ...mismatchInput.measurementCalibration,
    calibrationVersion: "wrong-calibration-v1",
  };
  const mismatch = buildFixedRigConditionSegmentationV1(mismatchInput);
  assert.equal(mismatch.status, "insufficient_evidence");
  assert.match(mismatch.reasons.join(" "), /identities do not match/i);
});
