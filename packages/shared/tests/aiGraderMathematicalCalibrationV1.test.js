const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const shared = require("../dist");

const {
  AI_GRADER_DEFECT_FINDING_V2_VERSION,
  MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION,
  MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
  MATHEMATICAL_FINDING_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  MATHEMATICAL_MEASUREMENT_V1_SCHEMA_VERSION,
  aggregateCornerScoreV1,
  aggregateEdgeScoreV1,
  aiGraderPublishedDefectFindingV2Schema,
  buildMathematicalMeasurementV1,
  calculateApplicableSevereDefectCapV1,
  calculateCenteringAxisV1,
  calculateFindingDeductionV1,
  calculateOverallGradeV1,
  calculateRegisteredDesignTemplateAxisV1,
  canonicalizeMathematicalGradingManifestV1,
  clampMathematicalGradeV1,
  combineMeasurementUncertaintyU95,
  effectiveMeasurementV1,
  formatMathematicalScoreV1,
  fuseCenteringFrontBackV1,
  fuseCenteringSideAxesV1,
  grade10BufferV1,
  mathematicalCalibrationProfileV1Schema,
  mathematicalDeductionLedgerV1Schema,
  mathematicalDesignReferenceV1Schema,
  mathematicalLabelGradeV1Schema,
  mathematicalScoreV1Schema,
  parseAiGraderPublishedDefectFindingsV2,
  roundMathematicalLabelGradeV1,
  roundMathematicalScoreV1,
  scoreCenteringRatioV1,
  validateMathematicalCalibrationProfileV1,
  validateMathematicalDesignReferencePixelContourV1,
  validateNoDoubleDeductionV1,
  validateFusionAction,
  validateMacroPipelineOutput,
  validateStandardFusionOutput,
} = shared;

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function calibratedChannels(overrides = {}) {
  return Array.from({ length: 8 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 8;
    return {
      channelIndex: index + 1,
      direction: { x: Math.cos(angle), y: Math.sin(angle) },
      directionConfidence: 0.95,
      directionMeasurementSampleCount: 5,
      directionAngularU95Degrees: 1.125,
      directionSourceRadiusMm: 100,
      directionPointU95Mm: 0.1,
      flatFieldArtifactId: `flat-field-${index + 1}`,
      flatFieldArtifactSha256: SHA_A,
      flatFieldFrameCount: 5,
      darkControlFrameCount: 3,
      maxFlatFieldDeviationFraction: 0.02,
      illuminationPatternArtifactId: `illumination-pattern-${index + 1}`,
      illuminationPatternArtifactSha256: SHA_B,
      illuminationPatternFrameCount: 5,
      responseScale: 1,
      ...overrides,
    };
  });
}

function calibrationProfile(overrides = {}) {
  return {
    schemaVersion: "ai-grader-mathematical-calibration-profile-v1",
    profileId: "fixed-rig-calibration-v1",
    calibrationVersion: "fixed-rig-calibration-2026-07-18",
    rigId: "dell-fixed-rig-1",
    isCalibrated: true,
    status: "finalized",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: "calibration-artifact-v1",
    artifactSha256: SHA_A,
    finalizedAt: "2026-07-18T18:00:00.000Z",
    normalizedWidthPx: 1200,
    normalizedHeightPx: 1680,
    mmPerPixelX: 63.5 / 1200,
    mmPerPixelY: 88.9 / 1680,
    scaleRelativeU95: 0.002,
    scaleSampleCount: 20,
    lensCalibrationViewCount: 20,
    lensResidualPx: 0.2,
    normalizationRegistrationResidualPx: 0.4,
    normalizationRegistrationSampleCount: 20,
    repeatedPlacementCount: 20,
    repeatedPlacementU95Mm: 0.02,
    segmentationBoundaryU95Px: 0.8,
    segmentationBoundarySampleCount: 20,
    measurementRepeatability: {
      linearMm: { sampleCount: 20, u95: 0.02 },
      areaMm2: { sampleCount: 20, u95: 0.04 },
      reliefIndex: { sampleCount: 20, u95: 0.01 },
      roughnessIndex: { sampleCount: 20, u95: 0.01 },
      colorDeltaE: { sampleCount: 20, u95: 0.1 },
    },
    channels: calibratedChannels(),
    ...overrides,
  };
}

function scratchMeasurement(overrides = {}) {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings.scratch;
  return buildMathematicalMeasurementV1({
    measurementId: "scratch-length-1",
    kind: policy.primaryMeasurementKind,
    unit: policy.unit,
    measuredMeasurement: 5,
    uncertaintyComponentsU95: {
      pixelMmScale: 0.01,
      lensDistortion: 0.01,
      normalizationRegistration: 0.01,
      repeatedPlacement: 0.01,
      segmentationBoundary: 0.01,
      measurementRepeatability: 0.01,
      lightingChannelConfidence: 0.01,
    },
    explicitGrade10Tolerance: policy.grade10Tolerance,
    calibrationProfileId: "fixed-rig-calibration-v1",
    calibrationVersion: "fixed-rig-calibration-2026-07-18",
    algorithmVersion: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.algorithmVersion,
    evidence: [
      {
        assetId: "front/front-normalized-card.png",
        sha256: SHA_A,
        side: "front",
        role: "normalized_card",
        regionId: "front-scratch-region-1",
      },
      {
        assetId: "front/channel-1.png",
        sha256: SHA_B,
        side: "front",
        role: "directional_channel",
        regionId: "front-scratch-region-1",
        channelIndex: 1,
      },
    ],
    validEvidenceCoverage: 0.9,
    usableDirectionalChannelCount: 6,
    ...overrides,
  });
}

function publishedScratch(overrides = {}) {
  const measurement = scratchMeasurement();
  const calculation = calculateFindingDeductionV1({
    category: "scratch",
    measuredMeasurement: measurement.measuredMeasurement,
    u95: measurement.u95,
  });
  return {
    schemaVersion: AI_GRADER_DEFECT_FINDING_V2_VERSION,
    mathematicalSchemaVersion: MATHEMATICAL_FINDING_V1_SCHEMA_VERSION,
    findingId: "front-scratch-001",
    physicalDefectId: "physical-scratch-001",
    side: "front",
    category: "scratch",
    primaryElement: "surface",
    location: "front_center",
    regionId: "front-scratch-region-1",
    detector: {
      id: "surface-v1",
      version: "1.0.0",
      captureProfileVersion: "fixed-rig-v1",
      algorithmVersion: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.algorithmVersion,
    },
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibrationProfileId: measurement.calibrationProfileId,
    calibrationVersion: measurement.calibrationVersion,
    severity: { normalized: calculation.normalizedSeverity, band: "low" },
    confidence: 0.9,
    evidenceQuality: "sufficient",
    review: { status: "unreviewed" },
    geometry: {
      coordinateFrame: "normalized_card",
      units: "fraction",
      shape: { kind: "box", x: 0.2, y: 0.3, width: 0.2, height: 0.01 },
    },
    evidence: {
      trueViewAssetId: "front/front-normalized-card.png",
      overlayAssetId: "report/front-scratch-overlay.png",
      segmentationMaskAssetId: "report/front-scratch-mask.png",
      confidenceMaskAssetId: "report/front-confidence-mask.png",
      illuminationMaskAssetId: "report/front-illumination-mask.png",
      channelAssetIds: ["front/channel-1.png"],
      roiAssetIds: ["front/front-scratch-roi.png"],
    },
    measurements: [measurement],
    deductionBasisMeasurementId: measurement.measurementId,
    deduction: calculation.deduction,
    secondaryEvidenceCategories: ["scratch_width"],
    explanation: "A directional scratch was measured from calibrated non-glare evidence.",
    ...overrides,
  };
}

test("threshold manifest is deeply immutable and its canonical SHA-256 is stable", () => {
  assert.equal(Object.isFrozen(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST), true);
  assert.equal(Object.isFrozen(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surfaceEvidence), true);
  assert.equal(Object.isFrozen(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings.scratch), true);
  const actual = crypto
    .createHash("sha256")
    .update(canonicalizeMathematicalGradingManifestV1())
    .digest("hex");
  assert.equal(actual, MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH);
  assert.equal(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.sourceHash, actual);
  assert.equal(
    MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION,
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.maximum -
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.minimum,
  );
  assert.equal(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.coverageFactor, 1.96);
  assert.equal(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount, 8);
  assert.equal(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.minimumIlluminationPatternFramesPerChannel,
    3,
  );
  assert.equal(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.minimumChannelDirectionMeasurementSamples,
    3,
  );
  assert.equal(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.maxChannelDirectionAngularU95Degrees,
    4,
  );
  assert.equal(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.channelDirectionConfidenceSectorScaleDegrees,
    22.5,
  );
  assert.equal(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.conditionSegmentation.invalidPixelsMayBecomePhysicalDefects,
    false,
  );
  assert.deepEqual(
    [
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.printedBorder.sourceDetector
        .insetSearchMinimumFractionOfAxis,
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.printedBorder.sourceDetector
        .insetSearchMaximumFractionOfAxis,
    ],
    [0.01, 0.2],
  );
});

test("strict score contract clamps, rounds, formats, and rejects zero or excess precision", () => {
  assert.equal(clampMathematicalGradeV1(-5), 1);
  assert.equal(clampMathematicalGradeV1(15), 10);
  assert.equal(roundMathematicalScoreV1(7.235), 7.24);
  assert.equal(roundMathematicalLabelGradeV1(7.25), 7.3);
  assert.equal(formatMathematicalScoreV1(9), "9.00");
  assert.equal(mathematicalScoreV1Schema.safeParse(1).success, true);
  assert.equal(mathematicalScoreV1Schema.safeParse(10).success, true);
  assert.equal(mathematicalScoreV1Schema.safeParse(0).success, false);
  assert.equal(mathematicalScoreV1Schema.safeParse(10.01).success, false);
  assert.equal(mathematicalScoreV1Schema.safeParse(9.999).success, false);
  assert.equal(mathematicalLabelGradeV1Schema.safeParse(8.5).success, true);
  assert.equal(mathematicalLabelGradeV1Schema.safeParse(8.55).success, false);
  assert.throws(() => clampMathematicalGradeV1(Number.NaN), /finite/);
});

test("U95 is root-sum-square and drives effective measurement and Grade-10 buffer", () => {
  assert.equal(combineMeasurementUncertaintyU95([3, 4]), 5);
  assert.equal(combineMeasurementUncertaintyU95({
    pixelMmScale: 0.01,
    lensDistortion: 0.02,
    normalizationRegistration: 0,
    repeatedPlacement: 0,
    segmentationBoundary: 0,
    measurementRepeatability: 0,
    lightingChannelConfidence: 0,
  }), 0.022361);
  assert.equal(effectiveMeasurementV1(0.2, 0.08), 0.12);
  assert.equal(effectiveMeasurementV1(0.05, 0.08), 0);
  assert.equal(grade10BufferV1(0.08, 0.1), 0.1);
  assert.equal(grade10BufferV1(0.12, 0.1), 0.12);
});

test("centering uses the continuous published curve and U95 margin deadband", () => {
  const points = new Map([
    [0, 1], [70, 5], [75, 6], [80, 7], [85, 8], [90, 9], [95, 10], [100, 10],
  ]);
  for (const [ratio, expected] of points) assert.equal(scoreCenteringRatioV1(ratio), expected);
  assert.equal(scoreCenteringRatioV1(72.5), 5.5);
  assert.equal(scoreCenteringRatioV1(92.5), 9.5);

  const insideDeadband = calculateCenteringAxisV1(2, 2.2, 0.2);
  assert.equal(insideDeadband.effectiveDifference, 0);
  assert.equal(insideDeadband.balanceRatio, 100);
  assert.equal(insideDeadband.score, 10);
  const insideExplicitTolerance = calculateCenteringAxisV1(2, 2.04, 0);
  assert.equal(insideExplicitTolerance.grade10Buffer, 0.05);
  assert.equal(insideExplicitTolerance.effectiveDifference, 0);
  assert.equal(fuseCenteringSideAxesV1(9.5, 8.5), 8.5);
  assert.equal(fuseCenteringFrontBackV1(10, 8), 8.3);
});

test("registered design templates score error from approved expected margins, not intentional asymmetry", () => {
  const intentionalAsymmetry = calculateRegisteredDesignTemplateAxisV1({
    observedMarginA: 2,
    observedMarginB: 6,
    expectedMarginA: 2,
    expectedMarginB: 6,
    physicalAxisSpan: 60,
    differenceU95: 0.05,
  });
  assert.equal(intentionalAsymmetry.axisError, 0);
  assert.equal(intentionalAsymmetry.balanceRatio, 100);
  assert.equal(intentionalAsymmetry.score, 10);

  const shifted = calculateRegisteredDesignTemplateAxisV1({
    observedMarginA: 3,
    observedMarginB: 5,
    expectedMarginA: 2,
    expectedMarginB: 6,
    physicalAxisSpan: 60,
    differenceU95: 0,
  });
  assert.equal(shifted.axisError, 1);
  assert.ok(shifted.balanceRatio < 100);
  assert.equal(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate.arbitrarySymmetryInferenceAllowed,
    false,
  );
});

test("corner and edge scores use the exact required worst-plus-average formulas", () => {
  const corners = aggregateCornerScoreV1([4, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(corners.worstPenalty, 4);
  assert.equal(corners.averagePenalty, 0.5);
  assert.equal(corners.aggregatePenalty, 2.775);
  assert.equal(corners.score, 7.23);

  const edges = aggregateEdgeScoreV1([4, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(edges.aggregatePenalty, 2.6);
  assert.equal(edges.score, 7.4);
  assert.throws(() => aggregateCornerScoreV1([0, 0]), /Exactly 8/);
  assert.throws(() => aggregateEdgeScoreV1([0, 0, 0, 0, 0, 0, 0, -1]), /nonnegative/);
});

test("overall V1 uses exact weights, weakest-plus-0.50, and explicit severe caps", () => {
  const result = calculateOverallGradeV1({ centering: 10, corners: 9, edges: 8, surface: 9 });
  assert.equal(result.weightedGrade, 9.05);
  assert.equal(result.weakestElement, "edges");
  assert.equal(result.weakestElementCap, 8.5);
  assert.equal(result.overall, 8.5);
  assert.equal(result.labelGrade, 8.5);

  const severe = calculateOverallGradeV1({ centering: 10, corners: 9, edges: 8, surface: 9 }, [7, 6]);
  assert.equal(severe.applicableSevereDefectCap, 6);
  assert.equal(severe.overall, 6);
  assert.throws(
    () => calculateOverallGradeV1({ centering: 10, corners: 9, edges: 0, surface: 9 }),
    /greater than or equal to 1|Too small/,
  );
});

test("calibration acceptance requires physical evidence and every versioned limit", () => {
  const validProfile = calibrationProfile();
  assert.equal(mathematicalCalibrationProfileV1Schema.safeParse(validProfile).success, true);
  const accepted = validateMathematicalCalibrationProfileV1(validProfile);
  assert.equal(accepted.valid, true);
  assert.equal(accepted.isCalibrated, true);

  const failed = validateMathematicalCalibrationProfileV1(calibrationProfile({
    scaleRelativeU95: 0.006,
    lensResidualPx: 0.6,
    repeatedPlacementU95Mm: 0.06,
    channels: calibratedChannels({ directionConfidence: 0.7 }),
  }));
  assert.equal(failed.valid, false);
  assert.equal(failed.isCalibrated, false);
  assert.match(failed.issues.map((issue) => issue.path).join(" "), /scaleRelativeU95/);
  assert.match(failed.issues.map((issue) => issue.path).join(" "), /directionConfidence/);

  const insufficientPatternEvidence = validateMathematicalCalibrationProfileV1(calibrationProfile({
    channels: calibratedChannels({ illuminationPatternFrameCount: 2 }),
  }));
  assert.equal(insufficientPatternEvidence.valid, false);
  assert.match(
    insufficientPatternEvidence.issues.map((issue) => issue.path).join(" "),
    /illuminationPatternFrameCount/,
  );

  const insufficientDirectionEvidence = validateMathematicalCalibrationProfileV1(calibrationProfile({
    channels: calibratedChannels({
      directionMeasurementSampleCount: 2,
      directionAngularU95Degrees: 5,
      directionConfidence: 0.777778,
    }),
  }));
  assert.equal(insufficientDirectionEvidence.valid, false);
  assert.match(
    insufficientDirectionEvidence.issues.map((issue) => issue.path).join(" "),
    /directionMeasurementSampleCount.*directionAngularU95Degrees/,
  );

  const channelWithoutPatternArtifact = calibratedChannels()[0];
  delete channelWithoutPatternArtifact.illuminationPatternArtifactSha256;
  assert.equal(mathematicalCalibrationProfileV1Schema.safeParse(calibrationProfile({
    channels: [channelWithoutPatternArtifact, ...calibratedChannels().slice(1)],
  })).success, false, "every finalized channel requires an immutable illumination-pattern artifact hash");

  const fakeUnlock = { ...validProfile, isCalibrated: false };
  assert.equal(validateMathematicalCalibrationProfileV1(fakeUnlock).valid, false);
});

test("approved registered-design references are exact identity- and hash-bound artifacts", () => {
  const reference = {
    schemaVersion: MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
    designReferenceId: "design-reference-1",
    profile: "registered_design_template_v1",
    tenantId: "tenant-1",
    setId: "set-1",
    programId: "program-1",
    cardNumber: "42",
    variantId: null,
    parallelId: null,
    side: "front",
    artifactId: "approved-design-artifact-1",
    artifactSha256: SHA_A,
    version: 1,
    widthPx: 1200,
    heightPx: 1680,
    intendedPrintBoundary: [
      { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 },
    ],
    approvedBy: "admin-1",
    approvedAt: "2026-07-18T18:00:00.000Z",
  };
  assert.equal(mathematicalDesignReferenceV1Schema.safeParse(reference).success, true);
  assert.equal(mathematicalDesignReferenceV1Schema.safeParse({ ...reference, artifactSha256: "not-a-hash" }).success, false);
  assert.equal(mathematicalDesignReferenceV1Schema.safeParse({ ...reference, version: 0 }).success, false);
});

test("design-reference pixel contours are finite, bounded, nondegenerate simple polygons", () => {
  const valid = validateMathematicalDesignReferencePixelContourV1(
    [[0, 0], [1200, 0], [1200, 1680], [0, 1680]],
    1200,
    1680,
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.signedDoubleArea, 4_032_000);
  for (const contour of [
    [[0, 0], [100, 0], [100, 100]],
    [[0, 0], [1201, 0], [1200, 100], [0, 100]],
    [[0, 0], [100, 0], [100, 0], [0, 100]],
    [[0, 0], [100, 0], [200, 0], [300, 0]],
    [[0, 0], [100, 100], [0, 100], [100, 0]],
  ]) {
    assert.equal(validateMathematicalDesignReferencePixelContourV1(contour, 1200, 1680).valid, false);
  }
});

test("measurement and deduction schemas derive exact U95, deadband, severity, and deduction", () => {
  const measurement = scratchMeasurement();
  assert.equal(measurement.schemaVersion, MATHEMATICAL_MEASUREMENT_V1_SCHEMA_VERSION);
  assert.equal(measurement.effectiveMeasurement, effectiveMeasurementV1(measurement.measuredMeasurement, measurement.u95));
  const calculation = calculateFindingDeductionV1({
    category: "scratch",
    measuredMeasurement: measurement.measuredMeasurement,
    u95: measurement.u95,
  });
  assert.equal(calculation.deduction, 0.99);
  assert.equal(calculation.maximumDeduction, 4);

  const withinBuffer = calculateFindingDeductionV1({ category: "scratch", measuredMeasurement: 0.1, u95: 0.02 });
  assert.equal(withinBuffer.grade10Buffer, 0.1);
  assert.equal(withinBuffer.deduction, 0);

  assert.equal(calculateApplicableSevereDefectCapV1("crease", [
    { kind: "length_mm", measuredMeasurement: 25, u95: 1 },
  ]), 5);
  assert.equal(calculateApplicableSevereDefectCapV1("crease", [
    { kind: "length_mm", measuredMeasurement: 20, u95: 1 },
  ]), undefined, "the severe cap uses the U95-adjusted effective measurement");
  assert.equal(calculateApplicableSevereDefectCapV1("scratch", [
    { kind: "length_mm", measuredMeasurement: 100, u95: 0 },
  ]), undefined);
});

test("finding V2 links exact measurements, overlays, source hashes, calibration, and deduction", () => {
  const finding = publishedScratch();
  const parsed = aiGraderPublishedDefectFindingV2Schema.safeParse(finding);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));

  assert.equal(aiGraderPublishedDefectFindingV2Schema.safeParse({
    ...finding,
    deduction: finding.deduction + 0.1,
  }).success, false);
  assert.equal(aiGraderPublishedDefectFindingV2Schema.safeParse({
    ...finding,
    evidenceQuality: "insufficient",
  }).success, false, "insufficient evidence cannot retain a physical deduction");
  assert.equal(aiGraderPublishedDefectFindingV2Schema.safeParse({
    ...finding,
    evidenceQuality: "insufficient",
    deduction: 0,
  }).success, true, "development evidence can be explicit insufficient without calling glare damage or perfection");
  assert.equal(aiGraderPublishedDefectFindingV2Schema.safeParse({
    ...finding,
    evidence: { ...finding.evidence, overlayAssetId: undefined },
  }).success, false);
  assert.equal(aiGraderPublishedDefectFindingV2Schema.safeParse({
    ...finding,
    severeDefectCap: 5,
  }).success, false, "a finding cannot invent a severe-defect cap");
});

test("no-double-deduction rejects duplicate physical defects across findings and ledger entries", () => {
  const finding = publishedScratch();
  const duplicate = { ...finding, findingId: "front-scratch-002" };
  const noDouble = validateNoDoubleDeductionV1([finding, duplicate]);
  assert.equal(noDouble.valid, false);
  assert.deepEqual(noDouble.duplicatePhysicalDefectIds, [finding.physicalDefectId]);

  const parsedCollection = parseAiGraderPublishedDefectFindingsV2([finding, duplicate]);
  assert.equal(parsedCollection.success, false);
  assert.match(parsedCollection.issues.map((issue) => issue.message).join(" "), /physical defect may deduct only once/);

  const measurement = finding.measurements[0];
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings.scratch;
  const calculation = calculateFindingDeductionV1({
    category: "scratch",
    measuredMeasurement: measurement.measuredMeasurement,
    u95: measurement.u95,
  });
  const entry = {
    findingId: finding.findingId,
    physicalDefectId: finding.physicalDefectId,
    element: "surface",
    category: "scratch",
    measurementId: measurement.measurementId,
    measuredMeasurement: measurement.measuredMeasurement,
    unit: measurement.unit,
    u95: measurement.u95,
    grade10Tolerance: policy.grade10Tolerance,
    effectiveMeasurement: measurement.effectiveMeasurement,
    referenceMeasurement: policy.referenceMeasurement,
    maximumDeduction: policy.maximumDeduction,
    curve: calculation.curve,
    formula: calculation.formula,
    normalizedSeverity: finding.severity.normalized,
    deduction: finding.deduction,
    evidenceAssetIds: measurement.evidence.map((entry) => entry.assetId),
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    algorithmVersion: finding.detector.algorithmVersion,
    calibrationProfileId: finding.calibrationProfileId,
    calibrationVersion: finding.calibrationVersion,
  };
  const ledger = {
    schemaVersion: MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    startingScores: { centering: 10, corners: 10, edges: 10, surface: 10 },
    entries: [entry],
  };
  assert.equal(mathematicalDeductionLedgerV1Schema.safeParse(ledger).success, true);
  assert.equal(mathematicalDeductionLedgerV1Schema.safeParse({
    ...ledger,
    entries: [entry, { ...entry, findingId: "other-finding" }],
  }).success, false);
});

test("legacy shared provisional/fusion boundaries now enforce the same strict 1.00-10.00 contract", () => {
  const macro = {
    sessionId: "session-1",
    side: "FRONT",
    captureManifestId: "manifest-1",
    algorithmVersionId: "algorithm-1",
    thresholdSetVersionId: "threshold-1",
    centeringMeasurement: {},
    provisionalGrades: { centering: 10, corners: 9, edges: 8, surface: 7.25 },
    macroMeasurements: {},
    suspectRegions: [],
    physicalGateResults: [],
    evidenceArtifacts: [],
  };
  assert.equal(validateMacroPipelineOutput(macro).valid, true);
  for (const invalid of [0, 10.01, 7.255]) {
    const result = validateMacroPipelineOutput({
      ...macro,
      provisionalGrades: { ...macro.provisionalGrades, surface: invalid },
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.code === "INVALID_SCORE"));
  }

  const fusion = {
    action: "HOLD",
    element: "CORNERS",
    side: "FRONT",
    spotPackageId: "spot-1",
    macroMeasurement: {},
    microMeasurement: {},
    gradeBefore: 9,
    gradeAfter: 9,
    algorithmVersionId: "algorithm-1",
    thresholdSetVersionId: "threshold-1",
    reasonCodes: ["NO_CHANGE"],
  };
  assert.equal(validateFusionAction(fusion).valid, true);
  assert.equal(validateFusionAction({ ...fusion, gradeAfter: 0 }).valid, false);

  const standardOutput = {
    gradeRunDraft: {
      macroMeasurements: {},
      microMeasurements: {},
      fusionActions: [],
      finalGrades: { centering: 10, corners: 9, edges: 8, surface: 7.25 },
      warnings: [],
    },
  };
  assert.equal(validateStandardFusionOutput(standardOutput).valid, true);
  assert.equal(validateStandardFusionOutput({
    gradeRunDraft: { ...standardOutput.gradeRunDraft, finalGrades: { surface: 0 } },
  }).valid, false);
});
