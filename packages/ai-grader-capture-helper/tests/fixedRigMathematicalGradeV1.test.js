const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  buildMathematicalMeasurementV1,
  calculateApplicableSevereDefectCapV1,
  calculateFindingDeductionV1,
  roundMathematicalScoreV1,
} = require("../../shared/dist");
const {
  buildFixedRigPhysicalCalibrationV1,
} = require("../dist/drivers/fixedRigPhysicalCalibrationV1");
const {
  buildFixedRigCenteringSideV1,
  fuseFixedRigCenteringFrontBackV1,
} = require("../dist/drivers/fixedRigCenteringV1");
const {
  aggregateFixedRigCornersV1,
  aggregateFixedRigEdgesV1,
  measureFixedRigCornerObservationV1,
  measureFixedRigEdgeObservationV1,
} = require("../dist/drivers/fixedRigCornerEdgeV1");
const {
  buildFixedRigMathematicalGradeV1,
} = require("../dist/drivers/fixedRigMathematicalGradeV1");

const SHA = "a".repeat(64);
const ZERO_U95 = {
  pixelMmScale: 0,
  lensDistortion: 0,
  normalizationRegistration: 0,
  repeatedPlacement: 0,
  segmentationBoundary: 0,
  measurementRepeatability: 0,
  lightingChannelConfidence: 0,
};

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

function calibrationEvidence(role, suffix) {
  return {
    evidenceId: `calibration-${suffix}`,
    sha256: SHA,
    role,
  };
}

function buildCalibration() {
  const result = buildFixedRigPhysicalCalibrationV1({
    profileId: "composer-calibration-profile",
    calibrationVersion: "composer-calibration-v1.0.0",
    rigId: "ten-kings-fixed-rig-v1",
    artifactId: "composer-calibration-artifact",
    finalizedAt: "2026-07-18T12:00:00.000Z",
    normalizedWidthPx: 1000,
    normalizedHeightPx: 1400,
    scaleSamples: [
      ...Array.from({ length: 10 }, (_, index) => ({
        ...calibrationEvidence("scale_x", `scale-x-${index}`),
        axis: "x",
        physicalSpanMm: 100,
        physicalSpanU95Mm: 0.1,
        pixelSpan: 1000,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        ...calibrationEvidence("scale_y", `scale-y-${index}`),
        axis: "y",
        physicalSpanMm: 100,
        physicalSpanU95Mm: 0.1,
        pixelSpan: 1000,
      })),
    ],
    targetPrintScaleSamples: [
      { ...calibrationEvidence("print_scale", "print-scale-x"), axis: "x",
        nominalSpanMm: 100, measuredSpanMm: 100, measurementU95Mm: 0.1 },
      { ...calibrationEvidence("print_scale", "print-scale-y"), axis: "y",
        nominalSpanMm: 200, measuredSpanMm: 200, measurementU95Mm: 0.1 },
    ],
    targetCutDimensionSamples: [
      { ...calibrationEvidence("target_cut", "target-cut-x"), axis: "x",
        nominalDimensionMm: 63.5, measuredDimensionMm: 63.5, measurementU95Mm: 0.1 },
      { ...calibrationEvidence("target_cut", "target-cut-y"), axis: "y",
        nominalDimensionMm: 88.9, measuredDimensionMm: 88.9, measurementU95Mm: 0.1 },
    ],
    lensResidualSamples: Array.from({ length: 10 }, (_, index) => ({
      ...calibrationEvidence("lens_view", `lens-${index}`),
      residualPx: 0.1,
    })),
    normalizationResidualSamples: Array.from({ length: 10 }, (_, index) => ({
      ...calibrationEvidence("normalization", `normalization-${index}`),
      residualPx: 0.2,
    })),
    repeatedPlacementSamples: Array.from({ length: 10 }, (_, index) => ({
      ...calibrationEvidence("placement", `placement-${index}`),
      displacementXMm: index % 2 ? 0.005 : -0.005,
      displacementYMm: index % 2 ? -0.004 : 0.004,
    })),
    segmentationBoundarySamples: Array.from({ length: 10 }, (_, index) => ({
      ...calibrationEvidence("boundary", `boundary-${index}`),
      outerContourFitResidualPx: index % 2 ? 0.12 : 0.1,
    })),
    measurementRepeatabilitySamples: [
      ["linear_mm", 2, 0.002],
      ["area_mm2", 1, 0.004],
      ["relief_index", 0.4, 0.001],
      ["roughness_index", 0.2, 0.001],
      ["color_delta_e", 2, 0.005],
    ].flatMap(([measurementClass, baseline, step]) =>
      Array.from({ length: 10 }, (_, index) => ({
        ...calibrationEvidence(
          "measurement_repeatability",
          `${measurementClass}-${index}`,
        ),
        measurementClass,
        referenceFeatureId: `fixture-${measurementClass}`,
        measuredValue: baseline + (index - 4.5) * step,
      }))),
    lensModel: {
      model: "opencv_brown_conrady_v1",
      sourceWidthPx: 4096,
      sourceHeightPx: 3000,
      cameraMatrix: [3000, 0, 2048, 0, 3000, 1500, 0, 0, 1],
      distortionCoefficients: [0.01, -0.005, 0, 0, 0],
      calibrationRmsPx: 0.1,
      perViewResidualPx: Array(10).fill(0.1),
    },
    normalizationModel: {
      model: "undistort_outer_cut_homography_with_fixed_holdout_repeatability_v1",
      sampleResidualPx: Array(10).fill(0.2),
    },
    channels: Array.from({ length: 8 }, (_, index) => {
      const angle = index * Math.PI / 4;
      return {
        channelIndex: index + 1,
        directionMeasurementSamples: Array.from({ length: 3 }, (_, sample) => ({
          ...calibrationEvidence(
            "direction_measurement",
            `direction-${index + 1}-${sample}`,
          ),
          measurementMethod: "fixed_ring_segment_geometry_with_ruler_v1",
          sourcePointMm: { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) },
          cardCenterPointMm: { x: 0, y: 0 },
          pointU95Mm: 0.1,
        })),
        directionValidationAngularErrorsDegrees: [0.1, 0.1, 0.1],
        relativeResponse: new Float32Array([1, 1, 1, 1]),
        responseScale: 1,
        flatFieldArtifactId: `flat-field-${index + 1}`,
        flatFieldArtifactSha256: SHA,
        flatFieldFrames: Array.from({ length: 3 }, (_, frame) => ({
          ...calibrationEvidence("flat_field", `flat-${index + 1}-${frame}`),
        })),
        darkControlFrames: Array.from({ length: 3 }, (_, frame) => ({
          ...calibrationEvidence("dark_control", `dark-${index + 1}-${frame}`),
        })),
        illuminationPatternArtifactId: "illumination-pattern-v1",
        illuminationPatternArtifactSha256: SHA,
        illuminationPatternFrames: Array.from({ length: 3 }, (_, frame) => ({
          ...calibrationEvidence(
            "illumination_pattern",
            `pattern-${index + 1}-${frame}`,
          ),
        })),
        illuminationPatternGridWidth: 2,
        illuminationPatternGridHeight: 2,
        expectedDirectionalResidual: new Float32Array([0, 0, 0, 0]),
      };
    }),
    targetEvidence: [calibrationEvidence("target", "target")],
    operatorId: "calibration-operator",
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256: SHA,
  });
  assert.equal(result.status, "finalized");
  return result.profile;
}

function measurementEvidence(side, regionId) {
  return [{
    assetId: `${side}-normalized-card`,
    sha256: SHA,
    side,
    role: "normalized_card",
    regionId,
  }];
}

function lineSamples(axis, coordinate) {
  return Array.from({ length: 24 }, (_, index) => axis === "x"
    ? { x: coordinate, y: 50 + index * 50 }
    : { x: 50 + index * 35, y: coordinate });
}

function centeringSide(side, calibration, boundaries = {
  left: 100,
  right: 900,
  top: 100,
  bottom: 1300,
}) {
  return buildFixedRigCenteringSideV1({
    side,
    calibration,
    outerCutContour: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1400 },
      { x: 0, y: 1400 },
    ],
    profileInput: {
      profile: "printed_border_v1",
      printBoundarySamples: {
        left: lineSamples("x", boundaries.left),
        right: lineSamples("x", boundaries.right),
        top: lineSamples("y", boundaries.top),
        bottom: lineSamples("y", boundaries.bottom),
      },
    },
    marginDifferenceU95Mm: { horizontal: 0, vertical: 0 },
    evidence: measurementEvidence(side, `${side}-centering`),
  });
}

function conditionCalibration(calibration) {
  return {
    profile: calibration,
    calibrationProfileId: calibration.profileId,
    calibrationVersion: calibration.calibrationVersion,
    calibrationSha256: calibration.artifactSha256,
    pixelsPerMmX: 10,
    pixelsPerMmY: 10,
  };
}

function cornerObservation(side, location, calibration, whitening = false) {
  const width = 10;
  const height = 10;
  const regionId = `${side}-${location}-corner`;
  return measureFixedRigCornerObservationV1({
    side,
    location,
    regionId,
    detectorId: "composer-corner-detector",
    detectorVersion: "corner-detector-v1.0.0",
    algorithmVersion: "corner-measurement-v1.0.0",
    calibration: conditionCalibration(calibration),
    validEvidenceMask: plane(width, height, 1),
    usableDirectionalChannelCount: 3,
    confidence: 0.95,
    evidence: measurementEvidence(side, regionId),
    whiteningMask: whitening
      ? plane(width, height, (x, y) => x < 2 && y < 2 ? 1 : 0)
      : plane(width, height, 0),
    missingMaterialMask: plane(width, height, 0),
    shapeDeviationMask: plane(width, height, 0),
    shapeDeviationPx: plane(width, height, 0),
    deformationMask: plane(width, height, 0),
    delaminationMask: plane(width, height, 0),
    directionalReliefIndex: plane(width, height, 0),
    directionalReliefMask: plane(width, height, 0),
  });
}

function edgeObservation(side, location, calibration, damaged = false, mirrorDamage = false) {
  const width = 20;
  const height = 5;
  const regionId = `${side}-${location}-edge`;
  const damageMinimumX = mirrorDamage ? 8 : 2;
  const damageMaximumX = mirrorDamage ? 18 : 12;
  const chipX = mirrorDamage ? 14 : 5;
  return measureFixedRigEdgeObservationV1({
    side,
    location,
    regionId,
    detectorId: "composer-edge-detector",
    detectorVersion: "edge-detector-v1.0.0",
    algorithmVersion: "edge-measurement-v1.0.0",
    calibration: conditionCalibration(calibration),
    validEvidenceMask: plane(width, height, 1),
    usableDirectionalChannelCount: 3,
    confidence: 0.95,
    evidence: measurementEvidence(side, regionId),
    damageMask: plane(width, height, (x, y) =>
      damaged && y === 1 && x >= damageMinimumX && x < damageMaximumX ? 1 : 0
    ),
    chipMask: plane(width, height, (x, y) => damaged && x === chipX && y === 1 ? 1 : 0),
    chipDepthMm: plane(width, height, (x, y) => damaged && x === chipX && y === 1 ? 0.3 : 0),
    whiteningMask: plane(width, height, 0),
    roughnessMask: plane(width, height, 0),
    roughnessIndex: plane(width, height, 0),
    frayingMask: plane(width, height, 0),
    delaminationMask: plane(width, height, 0),
    deformationMask: plane(width, height, 0),
    directionalReliefIndex: plane(width, height, 0),
    directionalReliefMask: plane(width, height, 0),
  });
}

function allCorners(calibration, damageFirst = false) {
  const locations = ["top_left", "top_right", "bottom_right", "bottom_left"];
  return ["front", "back"].flatMap((side) =>
    locations.map((location) =>
      cornerObservation(
        side,
        location,
        calibration,
        damageFirst && side === "front" && location === "top_left",
      ),
    ),
  );
}

function allEdges(calibration, matchedFrontBackDamage = false) {
  const locations = ["top", "right", "bottom", "left"];
  return ["front", "back"].flatMap((side) =>
    locations.map((location) => edgeObservation(
      side,
      location,
      calibration,
      matchedFrontBackDamage && location === "top",
      matchedFrontBackDamage && side === "back" && location === "top",
    )),
  );
}

function surfaceFinding({
  side,
  calibration,
  id,
  category = "scratch",
  measuredMeasurement = 2,
  physicalDefectId = `physical-${id}`,
}) {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[category];
  const measurement = buildMathematicalMeasurementV1({
    measurementId: `measurement-${id}`,
    kind: policy.primaryMeasurementKind,
    unit: policy.unit,
    measuredMeasurement,
    uncertaintyComponentsU95: ZERO_U95,
    explicitGrade10Tolerance: policy.grade10Tolerance,
    calibrationProfileId: calibration.profileId,
    calibrationVersion: calibration.calibrationVersion,
    algorithmVersion: "surface-measurement-v1.0.0",
    evidence: [{
      assetId: `${side}-segmentation-${id}`,
      sha256: SHA,
      side,
      role: "segmentation_mask",
      regionId: `${side}-surface-${id}`,
    }],
    validEvidenceCoverage: 1,
    usableDirectionalChannelCount: 3,
  });
  const calculation = calculateFindingDeductionV1({
    category,
    measuredMeasurement,
    u95: measurement.u95,
  });
  const measurements = [measurement];
  const severeDefectCap =
    calculateApplicableSevereDefectCapV1(category, measurements);
  return {
    findingId: `surface-${side}-finding-${id}`,
    physicalDefectId,
    side,
    category,
    secondaryEvidenceCategories: [],
    detectorIds: ["surface-detector-v1"],
    detectorVersions: ["surface-detector-v1.0.0"],
    sourceSeedIds: [`seed-${id}`],
    regionId: `${side}-surface-${id}`,
    overlay: {
      coordinateFrame: "normalized_card_portrait_pixels",
      boundingBoxPx: { x: 0, y: 0, width: 10, height: 1 },
      normalizedBoundingBox: { x: 0, y: 0, width: 0.01, height: 0.001 },
      validPixelIndices: [0],
      invalidPixelIndices: [],
    },
    pixelMeasurements: {
      detectedPixelCount: 1,
      validPixelCount: 1,
      lengthPx: 10,
      widthPx: 1,
      areaPx2: 10,
    },
    measurements,
    deductionBasisMeasurementId: measurement.measurementId,
    deductionCalculation: calculation,
    deduction: calculation.deduction,
    evidenceQuality: "sufficient",
    validEvidenceCoverage: 1,
    glareOrIlluminationOverlapFraction: 0,
    calibratedPatternOverlapFraction: 0,
    corroboratingChannels: [1, 2, 3],
    alternateChannelRecoveryUsed: false,
    ...(severeDefectCap === undefined ? {} : { severeDefectCap }),
    explanation:
      `${category} measured ${measuredMeasurement} ${policy.unit}; exact deduction ${calculation.deduction.toFixed(2)}.`,
  };
}

function surfaceResult(side, calibration, findings = []) {
  const totalDeduction = Math.round(
    findings.reduce((sum, finding) => sum + finding.deduction, 0) * 100,
  ) / 100;
  return {
    version: "fixed_rig_surface_v1",
    photometricEvidenceVersion: "fixed_rig_photometric_evidence_v1",
    status: "computed",
    side,
    score: roundMathematicalScoreV1(10 - totalDeduction),
    startingScore: 10,
    totalDeduction,
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surface.formula,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibrationProfileId: calibration.profileId,
    calibrationVersion: calibration.calibrationVersion,
    calibrationSha256: calibration.artifactSha256,
    sourceEvidence: Array.from({ length: 8 }, (_, index) => ({
      assetId: `${side}-directional-channel-${index + 1}`,
      sha256: SHA,
      side,
      role: "directional_channel",
      regionId: `${side}-full-surface`,
      channelIndex: index + 1,
    })),
    findings,
    suppressedCandidates: [],
    evidenceQualityLimitations: [],
    heatmap: {
      role: "visualization_only",
      source: "valid_directional_residuals",
      usedAsIndependentGradingEvidence: false,
      response: new Float32Array(1),
    },
    connectedComponentCount: findings.length,
    uniquePhysicalFindingCount: findings.length,
    applicableSevereDefectCaps: findings.flatMap((finding) =>
      finding.severeDefectCap === undefined ? [] : [finding.severeDefectCap],
    ),
    noDoubleDeduction: true,
  };
}

function composedInput(options = {}) {
  const calibration = options.calibration ?? buildCalibration();
  const frontSurfaceFindings = options.frontSurfaceFindings ?? [];
  const backSurfaceFindings = options.backSurfaceFindings ?? [];
  return {
    calibration,
    centering: fuseFixedRigCenteringFrontBackV1(
      centeringSide("front", calibration, options.frontCentering),
      centeringSide("back", calibration, options.backCentering),
    ),
    corners: aggregateFixedRigCornersV1(
      allCorners(calibration, options.cornerDamage),
    ),
    edges: aggregateFixedRigEdgesV1(allEdges(calibration, options.edgePhysicalMatch)),
    surface: {
      front: surfaceResult("front", calibration, frontSurfaceFindings),
      back: surfaceResult("back", calibration, backSurfaceFindings),
    },
    ...(options.physicalDefectDeduplication
      ? { physicalDefectDeduplication: options.physicalDefectDeduplication }
      : {}),
  };
}

test("clean calibrated front/back evidence produces four exact 10.00 elements and Label 10.0", () => {
  const result = buildFixedRigMathematicalGradeV1(composedInput());
  assert.equal(result.status, "final_mathematical_grade_v1");
  assert.equal(result.v0FallbackUsed, false);
  assert.equal(result.overall, 10);
  assert.equal(result.overallText, "10.00");
  assert.equal(result.weightedGrade, 10);
  assert.equal(result.labelGrade, 10);
  assert.equal(result.labelGradeText, "10.0");
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.elements).map(([key, value]) => [key, value.scoreText])),
    { centering: "10.00", corners: "10.00", edges: "10.00", surface: "10.00" },
  );
  assert.equal(result.elements.corners.locationScores.length, 8);
  assert.equal(result.elements.edges.locationScores.length, 8);
  assert.equal(result.deductionLedger.entries.length, 0);
  assert.equal(result.surfaceSourceEvidence.front.length, 8);
  assert.equal(result.surfaceSourceEvidence.back.length, 8);
  assert.equal(result.noDoubleDeduction, true);
  assert.match(result.whyNot10Summary, /No card-condition defect was measured/);
});

test("overall uses exact weights, weakest plus 0.50, and the lowest severe-defect cap", () => {
  const calibration = buildCalibration();
  const crease = surfaceFinding({
    side: "front",
    calibration,
    id: "major-crease",
    category: "crease",
    measuredMeasurement: 20,
  });
  const result = buildFixedRigMathematicalGradeV1(composedInput({
    calibration,
    frontSurfaceFindings: [crease],
  }));
  assert.equal(result.status, "final_mathematical_grade_v1");
  assert.equal(result.elements.surface.score, 4.86);
  assert.equal(result.weightedGrade, 8.97);
  assert.equal(result.weakestElement, "surface");
  assert.equal(result.weakestElementCap, 5.36);
  assert.equal(result.applicableSevereDefectCap, 5);
  assert.equal(result.overall, 5);
  assert.equal(result.overallText, "5.00");
  assert.equal(result.labelGradeText, "5.0");
  assert.equal(
    result.weightedFormula,
    "0.30 * centering + 0.25 * corners + 0.25 * edges + 0.20 * surface",
  );
  assert.equal(
    result.formula,
    "min(weightedGrade, weakestElement + 0.50, applicableSevereDefectCaps)",
  );
  assert.equal(result.deductionLedger.entries[0].deduction, 5.14);
  assert.equal(result.whyNot10[0].findingIds[0], crease.findingId);
  assert.match(result.whyNot10[0].explanation, /U95 0.*exact deduction 5\.14/);
});

test("caller-provided front/back registration cannot suppress two opposite-surface deductions", () => {
  const calibration = buildCalibration();
  const front = surfaceFinding({
    side: "front",
    calibration,
    id: "through-scratch-front",
    measuredMeasurement: 2,
  });
  const back = surfaceFinding({
    side: "back",
    calibration,
    id: "through-scratch-back",
    measuredMeasurement: 2,
  });
  const canonicalPhysicalDefectId = "registered-through-scratch";
  const result = buildFixedRigMathematicalGradeV1(composedInput({
    calibration,
    frontSurfaceFindings: [front],
    backSurfaceFindings: [back],
    physicalDefectDeduplication: [{
      canonicalPhysicalDefectId,
      retainedFindingId: back.findingId,
      linkedFindingIds: [front.findingId, back.findingId],
      reason: "Calibrated registration proves both sides show one physical defect.",
    }],
  }));
  assert.equal(result.status, "final_mathematical_grade_v1");
  assert.equal(result.findings.length, 2);
  assert.equal(result.deduplication.length, 0);
  assert.equal(result.deductionLedger.entries.length, 2);
  assert.ok(result.findings.every((finding) => finding.physicalDefectId !== canonicalPhysicalDefectId));
  assert.equal(new Set(result.findings.map((finding) => finding.physicalDefectId)).size, 2);
  assert.equal(result.elements.surface.frontScore, 9.6);
  assert.equal(result.elements.surface.backScore, 9.6);
  assert.equal(result.elements.surface.score, 9.2);
});

test("a repeated caller physicalDefectId is inert and cannot suppress a deduction", () => {
  const calibration = buildCalibration();
  const physicalDefectId = "same-unlinked-defect";
  const front = surfaceFinding({
    side: "front",
    calibration,
    id: "duplicate-front",
    physicalDefectId,
  });
  const back = surfaceFinding({
    side: "back",
    calibration,
    id: "duplicate-back",
    physicalDefectId,
  });
  const result = buildFixedRigMathematicalGradeV1(composedInput({
    calibration,
    frontSurfaceFindings: [front],
    backSurfaceFindings: [back],
  }));
  assert.equal(result.status, "final_mathematical_grade_v1");
  assert.equal(result.v0FallbackUsed, false);
  assert.equal(result.findings.length, 2);
  assert.equal(result.deductionLedger.entries.length, 2);
  assert.equal(new Set(result.findings.map((finding) => finding.physicalDefectId)).size, 2);
  assert.ok(result.findings.every((finding) => finding.originalPhysicalDefectId === physicalDefectId));
  assert.equal(result.elements.surface.score, 9.2);
});

test("grade composer independently retains one mirrored edge deduction from calibrated geometry", () => {
  const result = buildFixedRigMathematicalGradeV1(composedInput({
    edgePhysicalMatch: true,
  }));
  assert.equal(result.status, "final_mathematical_grade_v1");
  const edgeFindings = result.findings.filter((finding) => finding.element === "edges");
  const edgeLinks = result.deduplication.filter((link) =>
    link.canonicalPhysicalDefectId.startsWith("mathematical-edges-front-back-")
  );
  assert.equal(edgeFindings.length, 1);
  assert.equal(edgeLinks.length, 1);
  assert.equal(edgeLinks[0].linkedFindingIds.length, 2);
  assert.equal(result.deductionLedger.entries.filter((entry) => entry.element === "edges").length, 1);
  assert.match(edgeLinks[0].reason, /normalized ROI box IoU 1/);
});

test("any calibration artifact hash mismatch withholds the grade", () => {
  const input = composedInput();
  input.surface.front.calibrationSha256 = "b".repeat(64);
  const result = buildFixedRigMathematicalGradeV1(input);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.overall, null);
  assert.equal(result.labelGrade, null);
  assert.equal(result.requiresCalibration, true);
  assert.ok(result.issues.some((issue) =>
    issue.code === "calibration_identity_mismatch" && issue.element === "surface",
  ));
});

test("insufficient valid surface evidence requires recapture and never falls back to V0", () => {
  const input = composedInput();
  input.surface.back = {
    ...input.surface.back,
    status: "insufficient_evidence",
    score: null,
    evidenceQualityLimitations: [{
      code: "surface_fully_obscured",
      regionId: "back-full-surface",
      requiresRecapture: true,
      message: "Every usable channel is obscured.",
    }],
  };
  const result = buildFixedRigMathematicalGradeV1(input);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.requiresRecapture, true);
  assert.equal(result.v0FallbackUsed, false);
  assert.deepEqual(result.elements, {
    centering: null,
    corners: null,
    edges: null,
    surface: null,
  });
  assert.match(result.issues[0].message, /Every usable channel is obscured/);
});

for (const [name, mutate] of [
  ["missing", (evidence) => evidence.pop()],
  ["duplicate", (evidence) => {
    evidence[1] = { ...evidence[1], channelIndex: evidence[0].channelIndex };
  }],
  ["mismatched-side", (evidence) => {
    evidence[0] = { ...evidence[0], side: "back" };
  }],
]) {
  test(`${name} clean-surface channel provenance is insufficient rather than a false 10`, () => {
    const input = composedInput();
    mutate(input.surface.front.sourceEvidence);
    const result = buildFixedRigMathematicalGradeV1(input);
    assert.equal(result.status, "insufficient_evidence");
    assert.equal(result.overall, null);
    assert.equal(result.v0FallbackUsed, false);
    assert.equal(result.requiresRecapture, true);
    assert.ok(result.issues.some((issue) =>
      issue.code === "recapture_required" &&
      issue.element === "surface" &&
      /exactly one immutable source asset/.test(issue.message),
    ));
  });
}

test("centering deduction remains physical-design evidence and activates weakest-element cap", () => {
  const result = buildFixedRigMathematicalGradeV1(composedInput({
    frontCentering: { left: 100, right: 800, top: 100, bottom: 1300 },
  }));
  assert.equal(result.status, "final_mathematical_grade_v1");
  assert.equal(result.elements.centering.frontScore, 3.86);
  assert.equal(result.elements.centering.backScore, 10);
  assert.equal(result.elements.centering.score, 4.78);
  assert.equal(result.weakestElement, "centering");
  assert.equal(result.weakestElementCap, 5.28);
  assert.equal(result.overall, 5.28);
  assert.equal(result.deductionLedger.entries.length, 0);
  assert.equal(result.whyNot10[0].element, "centering");
  assert.match(result.whyNot10[0].explanation, /balance 50\.08%.*U95 0\.03121 mm/);
});

test("all eight corner locations contribute by exact worst-plus-average aggregation", () => {
  const result = buildFixedRigMathematicalGradeV1(composedInput({
    cornerDamage: true,
  }));
  assert.equal(result.status, "final_mathematical_grade_v1");
  assert.equal(result.elements.corners.locationScores.length, 8);
  assert.equal(result.elements.corners.locationScores[0].penalty, 0.03);
  assert.equal(result.elements.corners.score, 9.98);
  assert.equal(
    result.elements.corners.formula,
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.formula,
  );
  assert.equal(result.deductionLedger.entries.length, 1);
  assert.equal(result.deductionLedger.entries[0].element, "corners");
});
