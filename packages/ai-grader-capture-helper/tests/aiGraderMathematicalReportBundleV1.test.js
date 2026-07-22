const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  AI_GRADER_REPORT_BUNDLE_V01_VERSION,
  MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
  MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION,
  MATHEMATICAL_FINDING_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_AUTHORITY_ID,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_CONTRACT_VERSION,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_HASH_POLICY,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_NAME,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_ORGANIZATION,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_REASON,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_SCHEMA_VERSION,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS,
  aiGraderReportBundleSchema,
  aiGraderReportBundleV03Schema,
  buildMathematicalMeasurementV1,
  calculateFindingDeductionV1,
  calculateOverallGradeV1,
  canonicalProductOwnerOperationalAcceptanceIssueLedgerV1,
  canonicalProductOwnerOperationalAcceptancePayloadV1,
  roundMathematicalScoreV1,
  validateMathematicalCalibrationProfileV1,
} = require("../../shared/dist");
const {
  AI_GRADER_MATHEMATICAL_REPORT_ADAPTER_V1_VERSION,
  buildAiGraderMathematicalReportBundleV1,
} = require("../dist/drivers/aiGraderMathematicalReportBundleV1");
const {
  AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE,
  AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_V1_VERSION,
  buildAiGraderMathematicalReportEnvelopeV1,
  readAiGraderMathematicalReportPackageV1,
  writeAiGraderMathematicalProductionReleaseV1,
  writeAiGraderMathematicalReportPackageV1,
} = require("../dist/drivers/aiGraderMathematicalReportPackageV1");
const {
  AiGraderLocalStationBridgeService,
  buildAiGraderLocalStationBridgeConfig,
} = require("../dist/drivers/aiGraderLocalStationBridge");
const {
  buildFixedRigCenteringSideV1,
  fuseFixedRigCenteringFrontBackV1,
} = require("../dist/drivers/fixedRigCenteringV1");
const {
  projectApprovedFixedRigDesignReferenceV1,
} = require("../dist/drivers/fixedRigDesignReferenceV1");

const TEST_PIXEL = Buffer.from([1]);
const SHA = crypto.createHash("sha256").update(TEST_PIXEL).digest("hex");
const GENERATED_AT = "2026-07-18T19:00:00.000Z";
const ZERO_U95 = {
  pixelMmScale: 0,
  lensDistortion: 0,
  normalizationRegistration: 0,
  repeatedPlacement: 0,
  segmentationBoundary: 0,
  measurementRepeatability: 0,
  lightingChannelConfidence: 0,
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function calibrationBundleAuthority() {
  const members = [
    { role: "calibration_profile", fileName: "mathematical-calibration-profile-v1.json", sha256: SHA },
    { role: "physical_calibration_artifact", fileName: "mathematical-calibration-artifact-v1.json", sha256: SHA },
    { role: "calibration_acceptance", fileName: "mathematical-calibration-acceptance-v1.json", sha256: SHA },
    ...Array.from({ length: 8 }, (_, index) => ({
      role: "flat_field",
      channelIndex: index + 1,
      fileName: "flat-field-channel-" + (index + 1) + "-v1.json",
      sha256: SHA,
    })),
    { role: "illumination_pattern", fileName: "illumination-pattern-v1.json", sha256: SHA },
  ];
  return {
    schemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
    bundleManifestSha256: SHA,
    sourceCaptureManifestSha256: SHA,
    memberLedgerSha256: crypto.createHash("sha256")
      .update(JSON.stringify(canonical(members)), "utf8")
      .digest("hex"),
    members,
  };
}

function calibrationProfile() {
  return {
    schemaVersion: MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
    profileId: "report-calibration-v1",
    calibrationVersion: "report-calibration-2026-07-18",
    rigId: "fixed-rig-1",
    isCalibrated: true,
    status: "finalized",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: "report-calibration-artifact-v1",
    artifactSha256: SHA,
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
      linearMm: { sampleCount: 20, u95: 0.01 },
      areaMm2: { sampleCount: 20, u95: 0.01 },
      reliefIndex: { sampleCount: 20, u95: 0.01 },
      roughnessIndex: { sampleCount: 20, u95: 0.01 },
      colorDeltaE: { sampleCount: 20, u95: 0.01 },
    },
    channels: Array.from({ length: 8 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 8;
      return {
        channelIndex: index + 1,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        directionConfidence: 0.95,
        directionMeasurementSampleCount: 5,
        directionAngularU95Degrees: 1.125,
        directionSourceRadiusMm: 100,
        directionPointU95Mm: 0.1,
        flatFieldArtifactId: `flat-field-${index + 1}`,
        flatFieldArtifactSha256: SHA,
        flatFieldFrameCount: 5,
        darkControlFrameCount: 5,
        maxFlatFieldDeviationFraction: 0.02,
        illuminationPatternArtifactId: `illumination-pattern-${index + 1}`,
        illuminationPatternArtifactSha256: SHA,
        illuminationPatternFrameCount: 5,
        responseScale: 1,
      };
    }),
  };
}

function axis(axisName, calibration) {
  const mmPerPixel = axisName === "horizontal"
    ? calibration.mmPerPixelX
    : calibration.mmPerPixelY;
  const margin = 100 * mmPerPixel;
  return {
    marginA: margin,
    marginB: margin,
    measuredDifference: 0,
    differenceU95: 0.02,
    grade10Buffer: 0.05,
    effectiveDifference: 0,
    balanceRatio: 100,
    score: 10,
  };
}

function centeringSide(side, calibration) {
  const horizontal = axis("horizontal", calibration);
  const vertical = axis("vertical", calibration);
  return {
    version: "fixed_rig_centering_v1",
    status: "computed",
    side,
    profile: "printed_border_v1",
    score: 10,
    startingScore: 10,
    centeringDeduction: 0,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibrationProfileId: calibration.profileId,
    calibrationVersion: calibration.calibrationVersion,
    calibrationArtifactSha256: calibration.artifactSha256,
    outerCutContour: [
      { x: 0, y: 0 }, { x: 1200, y: 0 },
      { x: 1200, y: 1680 }, { x: 0, y: 1680 },
    ],
    printedDesignContour: [
      { x: 100, y: 100 }, { x: 1100, y: 100 },
      { x: 1100, y: 1580 }, { x: 100, y: 1580 },
    ],
    observedMargins: {
      left: { px: 100, mm: 100 * calibration.mmPerPixelX },
      right: { px: 100, mm: 100 * calibration.mmPerPixelX },
      top: { px: 100, mm: 100 * calibration.mmPerPixelY },
      bottom: { px: 100, mm: 100 * calibration.mmPerPixelY },
    },
    horizontal,
    vertical,
    u95Mm: { horizontal: 0.02, vertical: 0.02 },
    u95ComponentsMm: {
      calibratedMarginDifference: { horizontal: 0.02, vertical: 0.02 },
      calibratedMarginDifferenceComponents: {
        horizontal: { ...ZERO_U95, repeatedPlacement: 0.02 },
        vertical: { ...ZERO_U95, repeatedPlacement: 0.02 },
      },
    },
    grade10ToleranceMm: 0.05,
    registration: {
      profile: "printed_border_v1",
      transformType: "robust_line_fit",
      transformMatrix: [1, 0, 100, 0, 1, 100],
      registrationResidualPx: 0.4,
      inlierCount: 100,
      inlierFraction: 0.9,
      confidence: 0.95,
    },
    measurementLines: [
      { id: "centering-margin-left", side: "left", start: { x: 0, y: 840 }, end: { x: 100, y: 840 }, pixels: 100, millimeters: 100 * calibration.mmPerPixelX },
      { id: "centering-margin-right", side: "right", start: { x: 1100, y: 840 }, end: { x: 1200, y: 840 }, pixels: 100, millimeters: 100 * calibration.mmPerPixelX },
      { id: "centering-margin-top", side: "top", start: { x: 600, y: 0 }, end: { x: 600, y: 100 }, pixels: 100, millimeters: 100 * calibration.mmPerPixelY },
      { id: "centering-margin-bottom", side: "bottom", start: { x: 600, y: 1580 }, end: { x: 600, y: 1680 }, pixels: 100, millimeters: 100 * calibration.mmPerPixelY },
    ],
    evidence: [{
      assetId: `${side}/normalized-card.png`,
      sha256: SHA,
      side,
      role: "normalized_card",
      regionId: `${side}-centering`,
    }],
    formula: "sideScore = min(horizontalAxisScore, verticalAxisScore)",
  };
}

function centering(calibration) {
  return {
    version: "fixed_rig_centering_v1",
    status: "computed",
    score: 10,
    startingScore: 10,
    centeringDeduction: 0,
    frontScore: 10,
    backScore: 10,
    front: centeringSide("front", calibration),
    back: centeringSide("back", calibration),
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula,
  };
}

function registeredProjection(side) {
  const correspondences = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const x = 100 + column * 190;
      const y = 120 + row * 350;
      correspondences.push({
        correspondenceId: `${side}-control-${String(correspondences.length + 1).padStart(2, "0")}`,
        designReferencePointPx: { x, y },
        normalizedSourcePointPx: { x, y },
      });
    }
  }
  return projectApprovedFixedRigDesignReferenceV1({
    approvedReference: {
      referenceId: `${side}-design-reference-v1`,
      profile: "registered_design_template_v1",
      status: "approved",
      tenantId: "tenant-1",
      setId: "set-1",
      programId: "program-1",
      cardNumber: "42",
      variantId: null,
      parallelId: null,
      side,
      version: 1,
      artifactSha256: SHA,
      artifactWidthPx: 1200,
      artifactHeightPx: 1680,
      intendedDesignBoundary: {
        schemaVersion: "ai-grader-intended-design-boundary-v1",
        coordinateFrame: "design_reference_pixels",
        contour: [[100, 100], [1100, 100], [1100, 1580], [100, 1580]],
      },
      approvedByUserId: "approver-1",
      approvedAt: new Date(GENERATED_AT),
    },
    artifactEvidence: {
      assetId: `${side}-approved-design-reference.png`,
      sha256: SHA,
      bytes: TEST_PIXEL,
    },
    normalizedSourceEvidence: {
      assetId: `${side}-registered-normalized-card.png`,
      sha256: SHA,
      bytes: TEST_PIXEL,
      side,
      coordinateFrame: "normalized_card_portrait_pixels",
      widthPx: 1200,
      heightPx: 1680,
    },
    transformType: "affine",
    correspondences,
  });
}

function registeredCentering(calibration) {
  const buildSide = (side) => {
    const projection = registeredProjection(side);
    const result = buildFixedRigCenteringSideV1({
      side,
      calibration,
      outerCutContour: [
        { x: 0, y: 0 }, { x: 1200, y: 0 },
        { x: 1200, y: 1680 }, { x: 0, y: 1680 },
      ],
      profileInput: projection.centeringProfileInput,
      evidence: [
        {
          assetId: `${side}-registered-normalized-card.png`,
          sha256: SHA,
          side,
          role: "normalized_card",
          regionId: `${side}-centering`,
        },
        {
          assetId: `${side}-approved-design-reference.png`,
          sha256: SHA,
          side,
          role: "design_reference",
          regionId: `${side}-centering`,
        },
      ],
    });
    assert.equal(result.status, "computed", result.reasons?.join("; "));
    return { result, projection };
  };
  const front = buildSide("front");
  const back = buildSide("back");
  const fused = fuseFixedRigCenteringFrontBackV1(front.result, back.result);
  assert.equal(fused.status, "computed", fused.reasons?.join("; "));
  return { centering: fused, projections: [front.projection, back.projection] };
}

function conditionResult(element, findingWrapper) {
  const names = element === "corners"
    ? ["top_left", "top_right", "bottom_right", "bottom_left"]
    : ["top", "right", "bottom", "left"];
  const observations = ["front", "back"].flatMap((side) => names.map((location) => {
    const findings = findingWrapper && side === "front" && location === "top_left"
      ? [findingWrapper]
      : [];
    return {
      version: "fixed_rig_corner_edge_v1",
      status: "computed",
      element,
      side,
      location,
      regionId: `${side}-${location}-${element}`,
      calibrationProfileId: "report-calibration-v1",
      calibrationVersion: "report-calibration-2026-07-18",
      calibrationSha256: SHA,
      penalty: findings.reduce((sum, finding) => sum + finding.deduction, 0),
      findings,
      validEvidenceCoverage: 1,
      usableDirectionalChannelCount: 3,
      noDoubleDeduction: true,
    };
  }));
  const penalties = observations.map((observation) => observation.penalty);
  const worstWeight = element === "corners" ? 0.65 : 0.6;
  const averageWeight = element === "corners" ? 0.35 : 0.4;
  const aggregatePenalty = worstWeight * Math.max(...penalties) +
    averageWeight * penalties.reduce((sum, value) => sum + value, 0) / penalties.length;
  const score = roundMathematicalScoreV1(10 - aggregatePenalty);
  return {
    version: "fixed_rig_corner_edge_v1",
    status: "computed",
    element,
    score,
    aggregatePenalty,
    aggregation: {
      score,
      aggregatePenalty,
      worstPenalty: Math.max(...penalties),
      averagePenalty: penalties.reduce((sum, value) => sum + value, 0) / penalties.length,
      observationPenalties: penalties,
      formula: element === "corners"
        ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.formula
        : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.formula,
    },
    observations,
    locationSubscores: observations.map((observation) => ({
      side: observation.side,
      location: observation.location,
      penalty: observation.penalty,
      score: roundMathematicalScoreV1(10 - observation.penalty),
    })),
    crossSideDeduplication: [],
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    noDoubleDeduction: true,
  };
}

function surfaceFinding(calibration) {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings.scratch;
  const measurement = buildMathematicalMeasurementV1({
    measurementId: "front-scratch-length",
    kind: policy.primaryMeasurementKind,
    unit: policy.unit,
    measuredMeasurement: 2,
    uncertaintyComponentsU95: ZERO_U95,
    explicitGrade10Tolerance: policy.grade10Tolerance,
    calibrationProfileId: calibration.profileId,
    calibrationVersion: calibration.calibrationVersion,
    algorithmVersion: "surface-measurement-v1.0.0",
    evidence: [{
      assetId: "front/segmentation-mask.png",
      sha256: SHA,
      side: "front",
      role: "segmentation_mask",
      regionId: "front-scratch-region",
    }, {
      assetId: "front/approved-design-reference.png",
      sha256: SHA,
      side: "front",
      role: "design_reference",
      regionId: "front-scratch-region",
    }],
    validEvidenceCoverage: 1,
    usableDirectionalChannelCount: 3,
  });
  const calculation = calculateFindingDeductionV1({
    category: "scratch",
    measuredMeasurement: measurement.measuredMeasurement,
    u95: measurement.u95,
  });
  return {
    findingId: "surface-front-finding-scratch",
    physicalDefectId: "surface-front-physical-scratch",
    side: "front",
    category: "scratch",
    secondaryEvidenceCategories: [],
    detectorIds: ["surface-detector-v1"],
    detectorVersions: ["surface-detector-v1.0.0"],
    sourceSeedIds: ["scratch-seed-1"],
    regionId: "front-scratch-region",
    overlay: {
      coordinateFrame: "normalized_card_portrait_pixels",
      boundingBoxPx: { x: 120, y: 240, width: 240, height: 20 },
      normalizedBoundingBox: { x: 0.1, y: 1 / 7, width: 0.2, height: 1 / 84 },
      validPixelIndices: [0, 1, 2],
      invalidPixelIndices: [],
    },
    pixelMeasurements: {
      detectedPixelCount: 3,
      validPixelCount: 3,
      lengthPx: 240,
      widthPx: 20,
      areaPx2: 4800,
    },
    measurements: [measurement],
    deductionBasisMeasurementId: measurement.measurementId,
    deductionCalculation: calculation,
    deduction: calculation.deduction,
    evidenceQuality: "sufficient",
    validEvidenceCoverage: 1,
    glareOrIlluminationOverlapFraction: 0,
    calibratedPatternOverlapFraction: 0,
    corroboratingChannels: [1, 2, 3],
    alternateChannelRecoveryUsed: true,
    explanation: "scratch measured 2 mm; U95 0, effective 2, exact deduction 0.40.",
  };
}

function surfaceResult(side, calibration, finding) {
  const findings = finding ? [finding] : [];
  const deduction = findings.reduce((sum, entry) => sum + entry.deduction, 0);
  return {
    version: "fixed_rig_surface_v1",
    photometricEvidenceVersion: "fixed_rig_photometric_evidence_v1",
    status: "computed",
    side,
    score: roundMathematicalScoreV1(10 - deduction),
    startingScore: 10,
    totalDeduction: deduction,
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surface.formula,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibrationProfileId: calibration.profileId,
    calibrationVersion: calibration.calibrationVersion,
    calibrationSha256: calibration.artifactSha256,
    sourceEvidence: Array.from({ length: 8 }, (_, index) => ({
      assetId: `${side}/directional-${index + 1}.png`,
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
    applicableSevereDefectCaps: [],
    noDoubleDeduction: true,
  };
}

function confidence() {
  return { score: 0.98, band: "high", validEvidenceCoverage: 0.99, warnings: [] };
}

function locationScores(element, finding) {
  const names = element === "corners"
    ? ["top_left", "top_right", "bottom_right", "bottom_left"]
    : ["top", "right", "bottom", "left"];
  return ["front", "back"].flatMap((side) => names.map((location) => {
    const active = finding && finding.element === element && side === finding.side && location === finding.location;
    const penalty = active ? finding.deduction : 0;
    return {
      side,
      location,
      score: roundMathematicalScoreV1(10 - penalty),
      scoreText: roundMathematicalScoreV1(10 - penalty).toFixed(2),
      penalty,
      findingIds: active ? [finding.findingId] : [],
    };
  }));
}

function gradeElement(element, score, options = {}) {
  const formulas = {
    centering: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula,
    corners: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.formula,
    edges: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.formula,
    surface: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surface.formula,
  };
  return {
    score,
    scoreText: score.toFixed(2),
    startingScore: 10,
    frontScore: options.frontScore ?? score,
    frontScoreText: (options.frontScore ?? score).toFixed(2),
    backScore: options.backScore ?? score,
    backScoreText: (options.backScore ?? score).toFixed(2),
    aggregatePenalty: options.aggregatePenalty ?? 0,
    locationScores: options.locationScores ?? [],
    findingIds: options.findingIds ?? [],
    formula: formulas[element],
    explanation: options.explanation ?? "No card-condition defect measured beyond U95 and the published Grade-10 tolerance.",
  };
}

function gradeResult(calibration, sourceFinding) {
  const findings = sourceFinding ? [{
    source: "surface",
    findingId: sourceFinding.findingId,
    physicalDefectId: sourceFinding.physicalDefectId,
    originalPhysicalDefectId: sourceFinding.physicalDefectId,
    element: "surface",
    category: sourceFinding.category,
    side: sourceFinding.side,
    location: "full_surface",
    regionId: sourceFinding.regionId,
    algorithmVersion: sourceFinding.measurements[0].algorithmVersion,
    calibrationProfileId: calibration.profileId,
    calibrationVersion: calibration.calibrationVersion,
    measurements: sourceFinding.measurements,
    deductionBasisMeasurementId: sourceFinding.deductionBasisMeasurementId,
    normalizedSeverity: sourceFinding.deductionCalculation.normalizedSeverity,
    deduction: sourceFinding.deduction,
    evidenceAssetIds: sourceFinding.measurements
      .find((measurement) => measurement.measurementId === sourceFinding.deductionBasisMeasurementId)
      .evidence.map((evidence) => evidence.assetId),
    explanation: sourceFinding.explanation,
  }] : [];
  const surfaceDeduction = sourceFinding?.deduction ?? 0;
  const surfaceScore = roundMathematicalScoreV1(10 - surfaceDeduction);
  const overall = calculateOverallGradeV1({
    centering: 10,
    corners: 10,
    edges: 10,
    surface: surfaceScore,
  });
  const surfaceLocations = [
    {
      side: "front",
      location: "full_surface",
      score: surfaceScore,
      scoreText: surfaceScore.toFixed(2),
      penalty: surfaceDeduction,
      findingIds: sourceFinding ? [sourceFinding.findingId] : [],
    },
    {
      side: "back",
      location: "full_surface",
      score: 10,
      scoreText: "10.00",
      penalty: 0,
      findingIds: [],
    },
  ];
  const deductionLedger = {
    schemaVersion: MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    startingScores: { centering: 10, corners: 10, edges: 10, surface: 10 },
    entries: findings.map((finding) => {
      const measurement = finding.measurements[0];
      const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[finding.category];
      const calculation = calculateFindingDeductionV1({
        category: finding.category,
        measuredMeasurement: measurement.measuredMeasurement,
        u95: measurement.u95,
      });
      return {
        findingId: finding.findingId,
        physicalDefectId: finding.physicalDefectId,
        element: finding.element,
        category: finding.category,
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
        normalizedSeverity: finding.normalizedSeverity,
        deduction: finding.deduction,
        evidenceAssetIds: finding.evidenceAssetIds,
        thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
        thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
        algorithmVersion: finding.algorithmVersion,
        calibrationProfileId: calibration.profileId,
        calibrationVersion: calibration.calibrationVersion,
      };
    }),
  };
  return {
    version: "fixed_rig_mathematical_grade_composer_v1",
    status: "final_mathematical_grade_v1",
    scoringContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibration: {
      profileId: calibration.profileId,
      version: calibration.calibrationVersion,
      artifactSha256: calibration.artifactSha256,
      status: "finalized",
      isCalibrated: true,
    },
    overall: overall.overall,
    overallText: overall.overall.toFixed(2),
    labelGrade: overall.labelGrade,
    labelGradeText: overall.labelGrade.toFixed(1),
    weightedGrade: overall.weightedGrade,
    weightedGradeText: overall.weightedGrade.toFixed(2),
    weakestElement: overall.weakestElement,
    weakestScore: overall.weakestScore,
    weakestElementCap: overall.weakestElementCap,
    elements: {
      centering: gradeElement("centering", 10, {
        locationScores: ["front", "back"].map((side) => ({
          side,
          location: "printed_design",
          score: 10,
          scoreText: "10.00",
          penalty: 0,
          findingIds: [],
        })),
      }),
      corners: gradeElement("corners", 10, { locationScores: locationScores("corners") }),
      edges: gradeElement("edges", 10, { locationScores: locationScores("edges") }),
      surface: gradeElement("surface", surfaceScore, {
        frontScore: surfaceScore,
        backScore: 10,
        aggregatePenalty: surfaceDeduction,
        locationScores: surfaceLocations,
        findingIds: sourceFinding ? [sourceFinding.findingId] : [],
        explanation: sourceFinding
          ? "Surface starts at 10.00 and subtracts one unique measurement-derived physical finding totaling 0.40."
          : undefined,
      }),
    },
    weightedFormula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weightedFormula,
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.finalFormula,
    deductionLedger,
    findings,
    deduplication: [],
    surfaceSourceEvidence: Object.fromEntries(["front", "back"].map((side) => [
      side,
      Array.from({ length: 8 }, (_, index) => ({
        assetId: `${side}/directional-${index + 1}.png`,
        sha256: SHA,
        side,
        role: "directional_channel",
        regionId: `${side}-full-surface`,
        channelIndex: index + 1,
      })),
    ])),
    whyNot10: sourceFinding ? [{
      id: `why-not-10-${sourceFinding.findingId}`,
      element: "surface",
      findingIds: [sourceFinding.findingId],
      evidenceAssetIds: ["front/segmentation-mask.png"],
      deduction: sourceFinding.deduction,
      explanation: "Front scratch measured 2 mm; U95 0, Grade-10 tolerance 0.1, effective measurement 2, exact deduction 0.40.",
    }] : [],
    whyNot10Summary: sourceFinding
      ? "One exact physical deduction prevents a 10.00."
      : "No card-condition defect was measured beyond certified resolution and tolerance.",
    noDoubleDeduction: true,
  };
}

function binding(id, side, evidenceRole) {
  return {
    id,
    side,
    evidenceRole,
    fileName: id.split("/").at(-1),
    contentType: "image/png",
    sha256: SHA,
    byteSize: 1,
    bytes: TEST_PIXEL,
    widthPx: 1200,
    heightPx: 1680,
  };
}

function observationAssetId(element, side, location, role) {
  return `${side}/observations/${element}/${location}/${role}.png`;
}

function conditionObservationPresentations(...results) {
  return results.flatMap((result) => result.observations.map((observation) => ({
    element: result.element,
    side: observation.side,
    location: observation.location,
    regionId: observation.regionId,
    score: roundMathematicalScoreV1(10 - observation.penalty),
    penalty: observation.penalty,
    validEvidenceCoverage: observation.validEvidenceCoverage,
    usableDirectionalChannelCount: observation.usableDirectionalChannelCount,
    findingIds: observation.findings.map((finding) => finding.findingId),
    measurementIds: observation.findings.flatMap((finding) =>
      finding.measurements.map((measurement) => measurement.measurementId)),
    roiAssetId: observationAssetId(result.element, observation.side, observation.location, "roi"),
    segmentationMaskAssetId: observationAssetId(result.element, observation.side, observation.location, "segmentation"),
    confidenceMaskAssetId: observationAssetId(result.element, observation.side, observation.location, "confidence"),
    illuminationMaskAssetId: observationAssetId(result.element, observation.side, observation.location, "illumination"),
    channelAssetIds: Array.from(
      { length: 8 },
      (_, index) => `${observation.side}/directional-${index + 1}.png`,
    ),
  })));
}

function outerCutGeometryEvidence(calibration) {
  const sideEvidence = (side) => {
    const allOnAssetId = `${side}/all-on.png`;
    const rawAllOnAssetId = `${side}/raw-all-on.png`;
    const contour = Array.from({ length: 256 }, (_, index) => ({
      ...[
        { x: 0, y: 0 },
        { x: 1200, y: 0 },
        { x: 1200, y: 1680 },
        { x: 0, y: 1680 },
      ][index % 4],
    }));
    const observedArtifact = {
      schemaVersion: "fixed-rig-raw-bound-observed-outer-cut-artifact-v1",
      detectorId: "fixed_rig_raw_outer_cut_detector_v1",
      detectorVersion: "fixed_rig_raw_outer_cut_detector_v1.0.0",
      rawCoordinateFrame: "auto_oriented_raw_image_pixels",
      normalizedCoordinateFrame: "normalized_card_portrait_pixels",
      rawAllOnAssetId,
      rawAllOnAssetSha256: SHA,
      rawAllOnScalarPlaneSha256: SHA,
      rawWidthPx: calibration.normalizedWidthPx,
      rawHeightPx: calibration.normalizedHeightPx,
      normalizedAllOnAssetId: allOnAssetId,
      normalizedAllOnAssetSha256: SHA,
      normalizedWidthPx: calibration.normalizedWidthPx,
      normalizedHeightPx: calibration.normalizedHeightPx,
      rawToNormalizedTransformSha256: SHA,
      calibrationProfileId: calibration.profileId,
      calibrationVersion: calibration.calibrationVersion,
      calibrationSha256: calibration.artifactSha256,
      pixelsPerMmX: 1 / calibration.mmPerPixelX,
      pixelsPerMmY: 1 / calibration.mmPerPixelY,
      segmentationBoundaryU95Px: calibration.segmentationBoundaryU95Px,
      intendedBoundaryArtifactSha256: SHA,
      intendedBoundaryProfileId: "standard_sports_card_63_50x88_90_r3_18_v1",
      intendedBoundaryProfileVersion: "1.0.0",
      rawContour: contour,
      normalizedContour: contour,
      crossSectionCount: 256,
      supportedCrossSectionCount: 256,
      minimumGradientDigitalUnits: 8,
      meanDetectedGradientDigitalUnits: 40,
      minimumDetectedGradientDigitalUnits: 30,
      confidence: 0.99,
      u95ComponentsMm: {
        calibratedSegmentationBoundary: 0.04,
        rawDetectorLocalization: 0.03,
      },
      u95Mm: 0.05,
      artifactSha256: SHA,
    };
    return {
    coordinateFrame: "normalized_card_portrait_pixels",
    observedContourSha256: SHA,
    intendedContourSha256: SHA,
    intendedBoundaryProfileId: observedArtifact.intendedBoundaryProfileId,
    intendedBoundaryProfileVersion: observedArtifact.intendedBoundaryProfileVersion,
    observedContourPointCount: 256,
    intendedContourPointCount: 4,
    observedContourDetectorId: observedArtifact.detectorId,
    observedContourDetectorVersion: observedArtifact.detectorVersion,
    rawAllOnAssetId,
    rawAllOnAssetSha256: SHA,
    rawAllOnScalarPlaneSha256: SHA,
    rawToNormalizedTransformSha256: SHA,
    normalizedAllOnAssetId: allOnAssetId,
    normalizedAllOnAssetSha256: SHA,
    boundaryConfidence: 0.99,
    boundaryU95Mm: 0.05,
    observedArtifact,
    };
  };
  return { front: sideEvidence("front"), back: sideEvidence("back") };
}

function reportInput({
  scratch = false,
  publication,
  calibration: suppliedCalibration,
  calibrationAuthority,
  activationAuthority,
} = {}) {
  const calibration = suppliedCalibration ?? calibrationProfile();
  const sourceFinding = scratch ? surfaceFinding(calibration) : undefined;
  const grade = gradeResult(calibration, sourceFinding);
  const corners = conditionResult("corners");
  const edges = conditionResult("edges");
  const observationPresentations = conditionObservationPresentations(corners, edges);
  const assets = [
    binding("front/normalized-card.png", "front", "normalized_card"),
    binding("back/normalized-card.png", "back", "normalized_card"),
    binding("front/raw-all-on.png", "front", "other_evidence"),
    binding("back/raw-all-on.png", "back", "other_evidence"),
    binding("front/all-on.png", "front", "other_evidence"),
    binding("back/all-on.png", "back", "other_evidence"),
    ...["front", "back"].flatMap((side) =>
      Array.from({ length: 8 }, (_, index) =>
        binding(`${side}/directional-${index + 1}.png`, side, "directional_channel"))),
    ...observationPresentations.flatMap((observation) => [
      binding(observation.roiAssetId, observation.side, "roi_crop"),
      binding(observation.segmentationMaskAssetId, observation.side, "segmentation_mask"),
      binding(observation.confidenceMaskAssetId, observation.side, "confidence_mask"),
      binding(observation.illuminationMaskAssetId, observation.side, "illumination_mask"),
    ]),
  ];
  if (scratch) {
    assets.push(
      binding("front/segmentation-mask.png", "front", "segmentation_mask"),
      binding("front/confidence-mask.png", "front", "confidence_mask"),
      binding("front/illumination-mask.png", "front", "illumination_mask"),
      binding("front/common-mode-response.png", "front", "common_mode_response"),
      binding("front/scratch-roi.png", "front", "roi_crop"),
      binding("front/approved-design-reference.png", "front", "design_reference"),
    );
  }
  return {
    generatedAt: GENERATED_AT,
    reportId: scratch ? "report-v03-scratch" : "report-v03-clean",
    cardIdentity: {
      title: "Non-production calibration test card",
      sideCount: 2,
      tenantId: "tenant-1",
      setId: "set-1",
      programId: "program-1",
      set: "Calibration Set",
      cardNumber: "42",
      variantId: null,
      parallelId: null,
    },
    calibrationProfile: calibration,
    calibrationBundleAuthority: calibrationAuthority ?? calibrationBundleAuthority(),
    ...(activationAuthority ? { calibrationActivationAuthority: activationAuthority } : {}),
    designReferences: [],
    centering: centering(calibration),
    corners,
    edges,
    surface: {
      front: surfaceResult("front", calibration, sourceFinding),
      back: surfaceResult("back", calibration),
    },
    grade,
    outerCutGeometryEvidence: outerCutGeometryEvidence(calibration),
    publication: publication ?? {
      certId: scratch ? "TK-REPORT-SCRATCH" : "TK-REPORT-CLEAN",
      publicReportUrl: `/ai-grader/reports/${scratch ? "report-v03-scratch" : "report-v03-clean"}`,
      qrPayloadUrl: `/ai-grader/reports/${scratch ? "report-v03-scratch" : "report-v03-clean"}`,
    },
    confidence: {
      overall: confidence(),
      elements: {
        centering: confidence(), corners: confidence(), edges: confidence(), surface: confidence(),
      },
    },
    findingPresentations: sourceFinding ? [{
      findingId: sourceFinding.findingId,
      geometry: { kind: "box", ...sourceFinding.overlay.normalizedBoundingBox },
      detector: {
        id: "surface-detector-v1",
        version: "surface-detector-v1.0.0",
        captureProfileVersion: "ten-kings-fixed-rig-calibrated-v1",
      },
      confidence: 0.98,
      evidenceQuality: "sufficient",
      trueViewAssetId: "front/normalized-card.png",
      segmentationMaskAssetId: "front/segmentation-mask.png",
      confidenceMaskAssetId: "front/confidence-mask.png",
      illuminationMaskAssetId: "front/illumination-mask.png",
      channelAssetIds: [
        "front/directional-1.png", "front/directional-2.png", "front/directional-3.png",
      ],
      roiAssetIds: ["front/scratch-roi.png"],
      additionalEvidenceAssetIds: ["front/approved-design-reference.png"],
      secondaryEvidenceCategories: [],
      review: { status: "confirmed", reviewedAt: GENERATED_AT },
    }] : [],
    conditionObservationPresentations: observationPresentations,
    assetBindings: assets,
    evidenceQualityLimitations: scratch ? [{
      limitationId: "front-ring-response-resolved",
      side: "front",
      regionId: "front-ring-region",
      classification: "common_mode_specular_glare",
      validEvidenceCoverage: 0.92,
      excludedPixelFraction: 0.08,
      recoveredFromAlternateChannels: true,
      recaptureRequired: false,
      evidenceAssetIds: [
        "front/common-mode-response.png",
        "front/illumination-mask.png",
        "front/confidence-mask.png",
      ],
      explanation: "The calibrated illumination response was excluded and valid alternate directional channels resolved this region without a condition deduction.",
    }] : [],
  };
}

function ownerAcceptedReportInput() {
  const profile = {
    ...calibrationProfile(),
    rigId: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.rigId,
    artifactSha256: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.physicalArtifactSha256,
    isCalibrated: false,
    status: "rejected",
    lensResidualPx: 100,
  };
  const mathematical = validateMathematicalCalibrationProfileV1({
    ...profile,
    isCalibrated: true,
    status: "finalized",
  });
  assert.equal(mathematical.valid, false);
  const exceptionLedger = [
    ...Array.from({ length: 36 - mathematical.issues.length }, (_, index) => ({
      path: `certifiedAnalysis.exception${index + 1}`,
      message: `Recorded certified-analysis exception ${index + 1}.`,
    })),
    ...mathematical.issues,
  ];
  const subject = {
    ...PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT,
    mathematicalAcceptanceStatus: "rejected",
    mathematicalIsCalibrated: false,
    profileId: profile.profileId,
    calibrationVersion: profile.calibrationVersion,
    finalizedAt: profile.finalizedAt,
    artifactId: profile.artifactId,
  };
  delete subject.exceptionCount;
  const withoutHash = {
    schemaVersion: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_SCHEMA_VERSION,
    authorityId: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_AUTHORITY_ID,
    authorityStatus: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS,
    hashPolicy: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_HASH_POLICY,
    owner: {
      name: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_NAME,
      organization: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_ORGANIZATION,
      role: "product_owner",
    },
    decisionAt: "2026-07-22T14:00:00.000Z",
    reason: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_REASON,
    subject,
    exceptionLedger,
    exceptionLedgerSha256: crypto.createHash("sha256")
      .update(canonicalProductOwnerOperationalAcceptanceIssueLedgerV1(exceptionLedger), "utf8")
      .digest("hex"),
    implementation: {
      contractVersion: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_CONTRACT_VERSION,
      implementationGitSha: "1".repeat(40),
      finalizerSha256: "2".repeat(64),
      authorityProducerSha256: "3".repeat(64),
      nodeRuntimeVersion: process.version,
    },
    lifecycle: {
      sequence: 1,
      priorAuthoritySha256: null,
      revokedByAuthoritySha256: null,
      supersededByAuthoritySha256: null,
    },
  };
  const ownerAuthority = { ...withoutHash, authoritySha256: "0".repeat(64) };
  ownerAuthority.authoritySha256 = crypto.createHash("sha256")
    .update(canonicalProductOwnerOperationalAcceptancePayloadV1(ownerAuthority), "utf8")
    .digest("hex");
  profile.operationalAcceptance = ownerAuthority;

  const bundleAuthority = calibrationBundleAuthority();
  bundleAuthority.members.splice(3, 0, {
    role: "product_owner_operational_acceptance",
    fileName: "product-owner-operational-acceptance-v1.json",
    sha256: crypto.createHash("sha256").update(JSON.stringify(ownerAuthority), "utf8").digest("hex"),
  });
  bundleAuthority.memberLedgerSha256 = crypto.createHash("sha256")
    .update(JSON.stringify(canonical(bundleAuthority.members)), "utf8")
    .digest("hex");
  const activationAuthority = {
    schemaVersion: "ten-kings-ai-grader-calibration-activation-authority-v1",
    authorityPhase: "ACTIVE",
    activationId: "owner-report-activation-v1",
    activationHash: "4".repeat(64),
    activationRevision: "5".repeat(64),
    snapshotId: "owner-report-snapshot-v1",
    rigId: profile.rigId,
    bundleManifestSha256: bundleAuthority.bundleManifestSha256,
    memberLedgerSha256: bundleAuthority.memberLedgerSha256,
    runtimeContextHash: "6".repeat(64),
    rigCharacterizationSha256: profile.artifactSha256,
    operatingContextHash: "7".repeat(64),
    workstationReceiptSha256: "8".repeat(64),
    activatedAt: "2026-07-22T14:05:00.000Z",
    hostedAuthorityKeyId: "9".repeat(64),
    hostedAuthoritySignatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
    hostedAuthorityIssuedAt: "2026-07-22T14:05:00.000Z",
    hostedAuthorityExpiresAt: "2026-07-23T14:05:00.000Z",
    hostedAuthoritySignature: "A".repeat(86),
  };
  return reportInput({
    calibration: profile,
    calibrationAuthority: bundleAuthority,
    activationAuthority,
  });
}

function stationConfig(outputDir, { mathematicalReady = false } = {}) {
  const input = {
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 47652,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir,
  };
  if (mathematicalReady) {
    const profile = calibrationProfile();
    const profilePath = path.join(outputDir, "finalized-mathematical-calibration-v1.json");
    const bytes = Buffer.from(JSON.stringify(profile));
    fs.writeFileSync(profilePath, bytes);
    input.mathematicalCalibrationProfilePath = profilePath;
    input.mathematicalCalibrationProfileSha256 =
      crypto.createHash("sha256").update(bytes).digest("hex");
    input.mathematicalCalibrationRigId = profile.rigId;
    input.mathematicalCalibrationBundlePath = path.join(
      outputDir,
      "mathematical-calibration-bundle-v1.json",
    );
    input.mathematicalCalibrationBundleSha256 = "a".repeat(64);
  }
  return buildAiGraderLocalStationBridgeConfig(input);
}

function stationCalibrationBundleLoader(input) {
  const profile = calibrationProfile();
  return {
    bundlePath: input.bundlePath,
    bundleSha256: input.bundleSha256,
    bundle: {},
    profile,
    physicalArtifact: {},
    acceptance: {},
    authority: calibrationBundleAuthority(),
    files: {},
  };
}

test("strict V0.3 adapter generates deterministic centering evidence without a V0 fallback", async () => {
  const artifact = await buildAiGraderMathematicalReportBundleV1(reportInput());
  assert.equal(artifact.adapterVersion, AI_GRADER_MATHEMATICAL_REPORT_ADAPTER_V1_VERSION);
  assert.equal(artifact.bundle.schemaVersion, "ai-grader-report-bundle-v0.3");
  assert.equal(artifact.bundle.productionRelease.finalGrade.status, "final_mathematical_grade_v1");
  assert.equal(artifact.bundle.productionRelease.finalGrade.overall, 10);
  assert.equal(artifact.bundle.productionRelease.label.labelGradeText, "10.0");
  assert.equal(aiGraderReportBundleV03Schema.safeParse(artifact.bundle).success, true);
  assert.equal(artifact.assetPayloads.length, 92, "all immutable raw/normalized source and observation assets plus three deterministic centering PNGs per side");
  assert.deepEqual(
    artifact.assetPayloads.map((asset) => asset.id).filter((id) => id.includes("/mathematical-v1/")),
    [
      "back/mathematical-v1/centering-overlay.png",
      "back/mathematical-v1/outer-cut-contour.png",
      "back/mathematical-v1/printed-design-contour.png",
      "front/mathematical-v1/centering-overlay.png",
      "front/mathematical-v1/outer-cut-contour.png",
      "front/mathematical-v1/printed-design-contour.png",
    ],
  );
  const first = await buildAiGraderMathematicalReportBundleV1(reportInput());
  assert.deepEqual(
    first.assetPayloads.map(({ id, sha256 }) => ({ id, sha256 })),
    artifact.assetPayloads.map(({ id, sha256 }) => ({ id, sha256 })),
    "measurement overlay hashes are deterministic",
  );
});

test("owner-accepted report builder requires the exact signed ACTIVE 13-member activation binding", async (t) => {
  const accepted = await buildAiGraderMathematicalReportBundleV1(ownerAcceptedReportInput());
  assert.equal(
    accepted.bundle.calibrationProfile.operationalAcceptance.authorityStatus,
    "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS",
  );
  assert.equal(accepted.bundle.calibrationActivationAuthority.authorityPhase, "ACTIVE");
  assert.equal(accepted.bundle.calibrationBundleAuthority.members.length, 13);

  const cases = [
    ["missing activation", (input) => { delete input.calibrationActivationAuthority; }],
    ["wrong bundle", (input) => { input.calibrationActivationAuthority.bundleManifestSha256 = "a".repeat(64); }],
    ["wrong member ledger", (input) => { input.calibrationActivationAuthority.memberLedgerSha256 = "b".repeat(64); }],
    ["wrong rig", (input) => { input.calibrationActivationAuthority.rigId = "another-rig"; }],
    ["wrong artifact", (input) => { input.calibrationActivationAuthority.rigCharacterizationSha256 = "d".repeat(64); }],
    ["fake twelve-member substitution", (input) => {
      input.calibrationBundleAuthority.members.splice(3, 1);
      input.calibrationBundleAuthority.memberLedgerSha256 = crypto.createHash("sha256")
        .update(JSON.stringify(canonical(input.calibrationBundleAuthority.members)), "utf8")
        .digest("hex");
      input.calibrationActivationAuthority.memberLedgerSha256 =
        input.calibrationBundleAuthority.memberLedgerSha256;
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const input = ownerAcceptedReportInput();
      mutate(input);
      await assert.rejects(
        () => buildAiGraderMathematicalReportBundleV1(input),
        /signed ACTIVE hosted activation|product-owner authority/i,
      );
    });
  }
});

test("report confidence bands are derived from centralized thresholds rather than caller labels", async () => {
  const input = reportInput();
  input.confidence.overall = {
    score: 0.6,
    band: "high",
    validEvidenceCoverage: 0.99,
    warnings: [],
  };
  input.confidence.elements.corners = {
    score: 0.8,
    band: "low",
    validEvidenceCoverage: 0.99,
    warnings: [],
  };
  input.conditionObservationPresentations[0].validEvidenceCoverage = 0.7;

  const artifact = await buildAiGraderMathematicalReportBundleV1(input);
  assert.equal(artifact.bundle.productionRelease.finalGrade.confidence.band, "low");
  assert.equal(artifact.bundle.productionRelease.finalGrade.elements.corners.confidence.band, "medium");
  assert.equal(
    artifact.bundle.productionRelease.finalGrade.elements.corners.locationScores[0].confidence.band,
    "low",
    "location confidence uses the lower of element confidence and exact valid-pixel coverage",
  );
});

test("registered centering publishes the full hash-bound correspondence ledgers", async () => {
  const input = reportInput();
  const registered = registeredCentering(input.calibrationProfile);
  input.centering = registered.centering;
  input.designReferences = registered.projections.map((projection) => projection.designReference);
  input.assetBindings.push(
    binding("front-approved-design-reference.png", "front", "design_reference"),
    binding("back-approved-design-reference.png", "back", "design_reference"),
    binding("front-registered-normalized-card.png", "front", "normalized_card"),
    binding("back-registered-normalized-card.png", "back", "normalized_card"),
  );

  const artifact = await buildAiGraderMathematicalReportBundleV1(input);
  assert.equal(aiGraderReportBundleV03Schema.safeParse(artifact.bundle).success, true);
  for (const side of [artifact.bundle.centeringEvidence.front, artifact.bundle.centeringEvidence.back]) {
    assert.ok(side.registrationEvidence);
    const ledgerAsset = artifact.bundle.publicAssets.find((asset) =>
      asset.id === side.registrationEvidence.correspondenceLedgerAssetId);
    const ledgerPayload = artifact.assetPayloads.find((asset) => asset.id === ledgerAsset.id);
    assert.equal(ledgerAsset.kind, "report-evidence");
    assert.equal(ledgerAsset.contentType, "application/json");
    assert.equal(ledgerAsset.sha256, side.registrationEvidence.correspondenceLedgerSha256);
    assert.equal(ledgerPayload.sha256, side.registrationEvidence.correspondenceLedgerSha256);
    const ledger = JSON.parse(ledgerPayload.bytes.toString("utf8"));
    assert.equal(ledger.correspondences.length, 30);
    assert.equal(ledger.normalizedSourceWidthPx, 1200);
    assert.equal(ledger.normalizedSourceHeightPx, 1680);
  }

  const tampered = structuredClone(artifact.bundle);
  tampered.centeringEvidence.front.registrationEvidence.correspondenceLedgerSha256 =
    "d".repeat(64);
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(tampered).success,
    false,
    "ledger hash tampering must fail closed",
  );

  const masqueradingDesignArtifact = structuredClone(artifact.bundle);
  masqueradingDesignArtifact.publicAssets
    .find((asset) => asset.evidenceRole === "design_reference")
    .evidenceRole = "other_evidence";
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(masqueradingDesignArtifact).success,
    false,
    "an approved design artifact cannot masquerade as a capture or generic evidence role",
  );
});

test("one physical scratch publishes one ledger entry, exact overlay linkage, and separate glare limitation", async () => {
  const artifact = await buildAiGraderMathematicalReportBundleV1(reportInput({ scratch: true }));
  const { bundle } = artifact;
  assert.equal(aiGraderReportBundleV03Schema.safeParse(bundle).success, true);
  assert.equal(bundle.defectFindings.length, 1);
  assert.equal(bundle.deductionLedger.entries.length, 1);
  assert.equal(bundle.deductionLedger.entries[0].deduction, 0.4);
  assert.equal(bundle.productionRelease.finalGrade.elements.surface.score, 9.6);
  assert.equal(bundle.productionRelease.finalGrade.overall, 9.92);
  assert.equal(bundle.productionRelease.label.labelGradeText, "9.9");
  const finding = bundle.defectFindings[0];
  assert.deepEqual(
    finding.evidence.additionalEvidenceAssetIds,
    ["front/approved-design-reference.png"],
    "deduction basis exposes the exact approved-design evidence beyond the primary channel/ROI fields",
  );
  assert.equal(finding.evidence.overlayAssetId, "front/mathematical-v1/findings/surface-front-finding-scratch/deduction-overlay.png");
  assert.equal(
    bundle.productionRelease.finalGrade.whyNot10[0].overlayAssetIds[0],
    finding.evidence.overlayAssetId,
  );
  assert.match(bundle.productionRelease.finalGrade.whyNot10[0].explanation, /exact deduction 0\.40/);
  assert.equal(bundle.evidenceQualityLimitations.length, 1);
  assert.equal(bundle.evidenceQualityLimitations[0].classification, "common_mode_specular_glare");
  assert.equal(bundle.evidenceQualityLimitations[0].deduction, 0);
  assert.equal(bundle.evidenceQualityLimitations[0].recoveredFromAlternateChannels, true);
  assert.equal(artifact.assetPayloads.length, 99, "all immutable raw/normalized source and observation assets, six centering PNGs, and one deduction overlay");
});

test("immutable evidence tampering and incomplete-grade fallback attempts are rejected", async () => {
  const tampered = reportInput({ scratch: true });
  tampered.assetBindings.find((asset) => asset.id === "front/segmentation-mask.png").sha256 = "d".repeat(64);
  await assert.rejects(
    () => buildAiGraderMathematicalReportBundleV1(tampered),
    /immutable evidence (?:hash mismatch|binding)/i,
  );

  const hiddenBasisEvidence = reportInput({ scratch: true });
  delete hiddenBasisEvidence.findingPresentations[0].additionalEvidenceAssetIds;
  await assert.rejects(
    () => buildAiGraderMathematicalReportBundleV1(hiddenBasisEvidence),
    /deduction-basis.*(?:not exposed|source asset)|must expose/i,
  );

  const tamperedAdditionalEvidence = reportInput({ scratch: true });
  tamperedAdditionalEvidence.assetBindings
    .find((asset) => asset.id === "front/approved-design-reference.png")
    .sha256 = "e".repeat(64);
  await assert.rejects(
    () => buildAiGraderMathematicalReportBundleV1(tamperedAdditionalEvidence),
    /immutable evidence (?:hash mismatch|binding)/i,
  );

  const incomplete = reportInput();
  incomplete.grade = {
    version: "fixed_rig_mathematical_grade_composer_v1",
    status: "insufficient_evidence",
    scoringContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    overall: null,
    labelGrade: null,
    elements: { centering: null, corners: null, edges: null, surface: null },
    issues: [{ code: "recapture_required", element: "surface", message: "Evidence is obscured." }],
    requiresRecapture: true,
    requiresApprovedDesignReference: false,
    requiresCalibration: false,
    requiresImplementationCorrection: false,
    noConditionDeductionFromInvalidEvidence: true,
  };
  await assert.rejects(
    () => buildAiGraderMathematicalReportBundleV1(incomplete),
    /no V0 or manual-grade fallback is permitted/,
  );
});

test("historical V0 reports remain readable after adding the helper V0.3 adapter", () => {
  const legacy = {
    schemaVersion: AI_GRADER_REPORT_BUNDLE_V01_VERSION,
    generatedAt: "2026-07-10T15:00:00.000Z",
    reportId: "historical-v0-report",
    certifiedClaim: false,
    localReportFolder: "C:\\private\\historical-report",
    productionRelease: { historicalShape: true },
  };
  const parsed = aiGraderReportBundleSchema.safeParse(legacy);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.localReportFolder, legacy.localReportFolder);
  assert.deepEqual(parsed.data.productionRelease, legacy.productionRelease);
});

test("Mathematical V1 package writes body, external session envelope, assets, and checksums atomically without overwrite", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-package-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const outputDir = path.join(tempDir, "mathematical-v1");
  const artifact = await buildAiGraderMathematicalReportBundleV1(reportInput());
  const gradingSessionId = "grading-session-math-v1";
  const written = await writeAiGraderMathematicalReportPackageV1({
    gradingSessionId,
    artifact,
    outputDir,
  });
  assert.equal(written.envelope.schemaVersion, AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_V1_VERSION);
  assert.equal(written.envelope.gradingSessionId, gradingSessionId);
  assert.equal(written.envelope.reportBundle.schemaVersion, "ai-grader-report-bundle-v0.3");
  assert.equal(path.basename(written.bundlePath), AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE);
  assert.equal(written.assetManifest.assets.length, artifact.bundle.publicAssets.length);
  assert.equal(written.checksums.files.length, artifact.bundle.publicAssets.length + 3);
  assert.equal(fs.existsSync(path.join(outputDir, "report-bundle.json")), false, "legacy V0 package body was not fabricated");

  const idempotent = await writeAiGraderMathematicalReportPackageV1({
    gradingSessionId,
    artifact,
    outputDir,
  });
  assert.equal(idempotent.checksumsPath, written.checksumsPath);
  assert.deepEqual(idempotent.envelope.reportBundle, artifact.bundle);

  const different = await buildAiGraderMathematicalReportBundleV1(reportInput({ scratch: true }));
  await assert.rejects(
    () => writeAiGraderMathematicalReportPackageV1({ gradingSessionId, artifact: different, outputDir }),
    /Refusing to overwrite/,
  );

  const firstAsset = written.assetManifest.assets[0];
  fs.writeFileSync(path.join(outputDir, ...firstAsset.relativePath.split("/")), Buffer.from([2]));
  await assert.rejects(
    () => readAiGraderMathematicalReportPackageV1(outputDir),
    /package integrity failed/,
  );
});

test("Mathematical V1 release preserves the exact strict grade and one-decimal label without V0 policy", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-release-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const artifact = await buildAiGraderMathematicalReportBundleV1(reportInput({ scratch: true }));
  const reportPackage = await writeAiGraderMathematicalReportPackageV1({
    gradingSessionId: "grading-session-release-v1",
    artifact,
    outputDir: path.join(tempDir, "mathematical-v1"),
  });
  const result = await writeAiGraderMathematicalProductionReleaseV1({
    packagePath: reportPackage.envelopePath,
    operatorId: "calibration-operator",
    warningsAccepted: true,
  });
  assert.equal(result.productionRelease.generatedAt, artifact.bundle.generatedAt);
  assert.equal(result.productionRelease.reportStatus, "final_ai_grader_report_v1");
  assert.equal(result.productionRelease.finalGrade.status, "final_mathematical_grade_v1");
  assert.deepEqual(result.productionRelease.finalGrade, artifact.bundle.productionRelease.finalGrade);
  assert.equal(result.productionRelease.finalGrade.overall, 9.92);
  assert.equal(result.productionRelease.label.labelGradeText, "9.9");
  assert.equal(result.productionRelease.label.labelVersion, "ten-kings-ai-grader-label-v1");
  assert.equal(result.productionRelease.label.elementScores.centering, 10);
  assert.equal(result.productionRelease.gates.every((gate) => gate.status === "pass"), true);
  assert.equal(
    result.productionRelease.warnings.some((warning) => /Production Release V0|redistribut|9\.0 cap|manual grade/i.test(warning)),
    false,
  );
  assert.equal(fs.existsSync(result.releaseChecksumsPath), true);
});

test("station Mathematical V1 path returns strict body with external session identity and fails closed when inputs are absent", async (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-station-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const config = stationConfig(outputDir, { mathematicalReady: true });
  const stationReportId = "report-v03-scratch";
  const stationPublicReportUrl = `https://collect.tenkings.co/ai-grader/reports/${stationReportId}`;
  const stationCertId = "TK-AIG-" + crypto.createHash("sha1")
    .update(stationReportId)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  const artifact = await buildAiGraderMathematicalReportBundleV1(reportInput({
    scratch: true,
    publication: {
      certId: stationCertId,
      publicReportUrl: stationPublicReportUrl,
      qrPayloadUrl: stationPublicReportUrl,
    },
  }));
  const service = new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    loadMathematicalCalibrationBundle: stationCalibrationBundleLoader,
  });
  t.after(() => service.shutdown("mathematical station test complete"));
  const started = await service.action("start-session", {
    reportId: artifact.bundle.reportId,
    captureProfile: "production_fast",
    gradingContract: "mathematical_calibration_v1",
    mathematicalGradingAuthority: {
      schemaVersion: "fixed_rig_mathematical_station_grading_authority_v1",
      cardIdentity: artifact.bundle.cardIdentity,
      cardFormatId: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.cardFormats.standardTradingCard.profileId,
      sides: {
        front: { centering: { profile: "printed_border_v1" } },
        back: { centering: { profile: "printed_border_v1" } },
      },
    },
  });
  const gradingSessionId = started.sessionId;
  const envelope = buildAiGraderMathematicalReportEnvelopeV1({
    gradingSessionId,
    reportBundle: artifact.bundle,
  });
  const reportPackage = await writeAiGraderMathematicalReportPackageV1({
    gradingSessionId,
    artifact: {
      adapterVersion: AI_GRADER_MATHEMATICAL_REPORT_ADAPTER_V1_VERSION,
      bundle: envelope.reportBundle,
      assetPayloads: artifact.assetPayloads,
    },
    outputDir: path.join(outputDir, "report-bundles", artifact.bundle.reportId, "mathematical-v1"),
  });
  assert.equal(fs.existsSync(reportPackage.envelopePath), true);
  const response = await service.reportBundle(artifact.bundle.reportId);
  assert.equal(response.gradingContract, "mathematical_calibration_v1");
  assert.equal(response.gradingSessionId, gradingSessionId);
  assert.equal(response.bundle.schemaVersion, "ai-grader-report-bundle-v0.3");
  assert.equal(response.bundle.gradingSessionId, undefined, "workflow identity remains outside the strict public body");
  assert.deepEqual(response.bundle, artifact.bundle);

  const unavailable = new AiGraderLocalStationBridgeService(
    stationConfig(path.join(outputDir, "unavailable")),
  );
  t.after(() => unavailable.shutdown("mathematical station unavailable test complete"));
  await assert.rejects(
    () => unavailable.action("start-session", {
      reportId: "mathematical-v1-not-ready",
      captureProfile: "production_fast",
      gradingContract: "mathematical_calibration_v1",
    }),
    /Mathematical Calibration V1 is not ready:.*No V0 fallback is permitted/i,
  );
  assert.equal(unavailable.manifest.reportBundle, undefined);
  assert.equal(unavailable.manifest.safety.finalGradeComputed, false);
});

test("explicit Mathematical V1 Rapid background preparation fails not-ready instead of generating a V0 report", async (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-rapid-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const config = stationConfig(outputDir);
  const service = new AiGraderLocalStationBridgeService(config);
  t.after(() => service.shutdown("mathematical rapid test complete"));
  await assert.rejects(
    () => service.action("start-session", {
      reportId: "mathematical-v1-rapid-not-ready",
      captureProfile: "production_fast",
      gradingContract: "mathematical_calibration_v1",
    }),
    /Mathematical Calibration V1 is not ready:.*No V0 fallback is permitted/i,
  );
  assert.equal(service.manifest.gradingContract, "mathematical_calibration_v1");
  assert.equal(service.manifest.reportBundle, undefined);
  assert.equal(service.manifest.safety.finalGradeComputed, false);
  assert.equal(service.manifest.rapidCapture.autoPublish, false);
  assert.equal(service.manifest.rapidCapture.humanConfirmationRequired, true);
});
