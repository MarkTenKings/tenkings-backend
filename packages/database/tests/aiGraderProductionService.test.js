const test = require("node:test");
const assert = require("node:assert/strict");
const { deflateSync } = require("node:zlib");
const {
  AI_GRADER_PUBLISH_AUTHORITY_EXCLUDED_RUNTIME_FIELDS,
  buildAiGraderConfirmCardReferencePlan,
  buildAiGraderLabelPreviewHtml,
  buildAiGraderCompsSearchQuery,
  buildAiGraderPublishAuthorityRecord,
  buildAiGraderProductionStoragePlan,
  aiGraderSha256,
  computeAiGraderValuationStatus,
  persistAiGraderSlabbedPhotoAsset,
  persistAiGraderProductionRelease: persistAiGraderProductionReleaseRaw,
  persistAiGraderValuationResult,
  normalizeAiGraderPublicGeometryCaptureDecisions,
  normalizeAiGraderPublicOcrPrefill,
  sanitizeAiGraderPublicJson,
  sanitizeAiGraderPublicReportBundleForRead,
  readAiGraderMathematicalCalibrationReadiness,
} = require("../dist/database/src/aiGraderProductionService");
const {
  AI_GRADER_DEFECT_FINDING_V2_VERSION,
  MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
  MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION,
  MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  aiGraderReportBundleV03Schema,
} = require("@tenkings/shared");

const V03_ASSET_SHA = "c".repeat(64);

function designReferencePng(width, height) {
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const value of bytes) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const typeBytes = Buffer.from(type, "ascii");
    const output = Buffer.alloc(12 + data.length);
    output.writeUInt32BE(data.length, 0);
    typeBytes.copy(output, 4);
    data.copy(output, 8);
    output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
    return output;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function sampleV03Confidence() {
  return { score: 0.98, band: "high", validEvidenceCoverage: 0.99, warnings: [] };
}

function sampleV03CalibrationProfile() {
  return {
    schemaVersion: MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
    profileId: "fixed-rig-calibration-v1",
    calibrationVersion: "fixed-rig-calibration-2026-07-18",
    rigId: "dell-fixed-rig-1",
    isCalibrated: true,
    status: "finalized",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: "calibration-artifact-v1",
    artifactSha256: V03_ASSET_SHA,
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
      areaMm2: { sampleCount: 20, u95: 0.01 },
      reliefIndex: { sampleCount: 20, u95: 0.01 },
      roughnessIndex: { sampleCount: 20, u95: 0.01 },
      colorDeltaE: { sampleCount: 20, u95: 0.1 },
    },
    channels: Array.from({ length: 8 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 8;
      return {
        channelIndex: index + 1,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        directionConfidence: 0.95,
        directionMeasurementSampleCount: 5,
        directionAngularU95Degrees: 1.125,
        directionSourceRadiusMm: 75,
        directionPointU95Mm: 0.1,
        flatFieldArtifactId: `flat-field-${index + 1}`,
        flatFieldArtifactSha256: V03_ASSET_SHA,
        flatFieldFrameCount: 5,
        darkControlFrameCount: 5,
        maxFlatFieldDeviationFraction: 0.02,
        illuminationPatternArtifactId: `illumination-pattern-${index + 1}`,
        illuminationPatternArtifactSha256: V03_ASSET_SHA,
        illuminationPatternFrameCount: 5,
        responseScale: 1,
      };
    }),
  };
}

function sampleV03CenteringAxis(axis) {
  return {
    axis,
    marginAName: axis === "horizontal" ? "left" : "top",
    marginBName: axis === "horizontal" ? "right" : "bottom",
    marginAPx: 100,
    marginBPx: 100,
    marginAMm: 5.2917,
    marginBMm: 5.2917,
    measuredDifferenceMm: 0,
    u95Mm: 0.02,
    u95Components: {
      pixelMmScale: 0,
      lensDistortion: 0,
      normalizationRegistration: 0,
      repeatedPlacement: 0.02,
      segmentationBoundary: 0,
      measurementRepeatability: 0,
      lightingChannelConfidence: 0,
    },
    effectiveDifferenceMm: 0,
    grade10ToleranceMm: 0.05,
    balanceRatio: 100,
    score: 10,
  };
}

function sampleV03OuterCutGeometry(side) {
  const rawAllOnAssetId = `${side}/raw-all-on.png`;
  const normalizedAllOnAssetId = `${side}/all-on.png`;
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
    rawAllOnAssetSha256: V03_ASSET_SHA,
    rawAllOnScalarPlaneSha256: V03_ASSET_SHA,
    rawWidthPx: 1200,
    rawHeightPx: 1680,
    normalizedAllOnAssetId,
    normalizedAllOnAssetSha256: V03_ASSET_SHA,
    normalizedWidthPx: 1200,
    normalizedHeightPx: 1680,
    rawToNormalizedTransformSha256: V03_ASSET_SHA,
    calibrationProfileId: "fixed-rig-calibration-v1",
    calibrationVersion: "fixed-rig-calibration-2026-07-18",
    calibrationSha256: V03_ASSET_SHA,
    pixelsPerMmX: 1200 / 63.5,
    pixelsPerMmY: 1680 / 88.9,
    segmentationBoundaryU95Px: 0.8,
    intendedBoundaryArtifactSha256: V03_ASSET_SHA,
    intendedBoundaryProfileId: "standard_sports_card_63_50x88_90_r3_18_v1",
    intendedBoundaryProfileVersion: "1.0.0",
    rawContour: contour,
    normalizedContour: contour,
    crossSectionCount: 256,
    supportedCrossSectionCount: 256,
    minimumGradientDigitalUnits: 8,
    meanDetectedGradientDigitalUnits: 40,
    minimumDetectedGradientDigitalUnits: 30,
    confidence: 0.95,
    u95ComponentsMm: { calibratedSegmentationBoundary: 0.04, rawDetectorLocalization: 0.03 },
    u95Mm: 0.05,
    artifactSha256: V03_ASSET_SHA,
  };
  return {
    coordinateFrame: "normalized_card_portrait_pixels",
    observedContourSha256: V03_ASSET_SHA,
    intendedContourSha256: V03_ASSET_SHA,
    intendedBoundaryProfileId: observedArtifact.intendedBoundaryProfileId,
    intendedBoundaryProfileVersion: observedArtifact.intendedBoundaryProfileVersion,
    observedContourPointCount: 256,
    intendedContourPointCount: 4,
    observedContourDetectorId: observedArtifact.detectorId,
    observedContourDetectorVersion: observedArtifact.detectorVersion,
    rawAllOnAssetId,
    rawAllOnAssetSha256: V03_ASSET_SHA,
    rawAllOnScalarPlaneSha256: V03_ASSET_SHA,
    rawToNormalizedTransformSha256: V03_ASSET_SHA,
    normalizedAllOnAssetId,
    normalizedAllOnAssetSha256: V03_ASSET_SHA,
    boundaryConfidence: 0.95,
    boundaryU95Mm: 0.05,
    observedArtifact,
  };
}

function sampleV03CenteringSide(side) {
  return {
    side,
    profile: "printed_border_v1",
    score: 10,
    horizontal: sampleV03CenteringAxis("horizontal"),
    vertical: sampleV03CenteringAxis("vertical"),
    outerCutContourAssetId: `${side}/outer-cut-contour.png`,
    printedDesignContourAssetId: `${side}/printed-design-contour.png`,
    measurementOverlayAssetId: `${side}/centering-overlay.png`,
    registration: {
      profile: "printed_border_v1",
      transformType: "robust_line_fit",
      transformMatrix: [1, 0, 0, 0, 1, 0],
      registrationResidualPx: 0.4,
      inlierCount: 100,
      inlierFraction: 0.9,
      confidence: 0.95,
    },
    outerCutGeometryEvidence: sampleV03OuterCutGeometry(side),
    evidenceAssetIds: [
      `${side}/outer-cut-contour.png`,
      `${side}/printed-design-contour.png`,
      `${side}/centering-overlay.png`,
      `${side}/raw-all-on.png`,
      `${side}/all-on.png`,
    ],
  };
}

function sampleV03Location(side, location) {
  return {
    side,
    location,
    score: 10,
    penalty: 0,
    findingIds: [],
    confidence: sampleV03Confidence(),
  };
}

function sampleV03Element(element, locationScores = []) {
  const formulas = {
    centering: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula,
    corners: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.formula,
    edges: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.formula,
    surface: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surface.formula,
  };
  return {
    score: 10,
    startingScore: 10,
    frontScore: 10,
    backScore: 10,
    aggregatePenalty: 0,
    locationScores,
    findingIds: [],
    confidence: sampleV03Confidence(),
    formula: formulas[element],
    explanation: "No condition defect measured beyond U95 and the published Grade-10 tolerance.",
  };
}

function sampleV03Asset(id, side, evidenceRole) {
  return {
    id,
    kind: "report-image",
    fileName: id.split("/").at(-1),
    contentType: "image/png",
    publicUrl: `/api/ai-grader/reports/report-v03-clean/assets/${id.replaceAll("/", "-")}`,
    byteSize: 1,
    checksumSha256: V03_ASSET_SHA,
    side,
    evidenceRole,
  };
}

function sampleV03ObservationAssetId(element, side, location, role) {
  return `${side}/${element}/${location}/${role}.png`;
}

function sampleV03ConditionObservation(element, side, location) {
  return {
    element,
    side,
    location,
    regionId: `${side}-${element}-${location}`,
    score: 10,
    penalty: 0,
    validEvidenceCoverage: 0.99,
    usableDirectionalChannelCount: 8,
    findingIds: [],
    measurementIds: [],
    roiAssetId: sampleV03ObservationAssetId(element, side, location, "roi"),
    segmentationMaskAssetId: sampleV03ObservationAssetId(element, side, location, "segmentation"),
    confidenceMaskAssetId: sampleV03ObservationAssetId(element, side, location, "confidence"),
    illuminationMaskAssetId: sampleV03ObservationAssetId(element, side, location, "illumination"),
    channelAssetIds: Array.from({ length: 8 }, (_, index) =>
      `${side}/channels/channel-${index + 1}.png`),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  return value;
}

function sampleV03CalibrationBundleAuthority(profile) {
  const members = [
    { role: "calibration_profile", fileName: "mathematical-calibration-profile-v1.json", sha256: "1".repeat(64) },
    { role: "physical_calibration_artifact", fileName: "mathematical-calibration-artifact-v1.json", sha256: "2".repeat(64) },
    { role: "calibration_acceptance", fileName: "mathematical-calibration-acceptance-v1.json", sha256: "3".repeat(64) },
    ...profile.channels.map((channel) => ({
      role: "flat_field",
      channelIndex: channel.channelIndex,
      fileName: `flat-field-channel-${channel.channelIndex}-v1.json`,
      sha256: channel.flatFieldArtifactSha256,
    })),
    { role: "illumination_pattern", fileName: "illumination-pattern-v1.json", sha256: profile.channels[0].illuminationPatternArtifactSha256 },
  ];
  return {
    schemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
    bundleManifestSha256: "4".repeat(64),
    sourceCaptureManifestSha256: "5".repeat(64),
    memberLedgerSha256: aiGraderSha256(Buffer.from(JSON.stringify(canonicalJson(members)))),
    members,
  };
}

function sampleV03ActivationAuthority(profile, bundleAuthority, overrides = {}) {
  return {
    schemaVersion: "ten-kings-ai-grader-calibration-activation-authority-v1",
    authorityPhase: "ACTIVE",
    activationId: "calibration-activation-v03",
    activationHash: "6".repeat(64),
    activationRevision: "7".repeat(64),
    snapshotId: "calibration-snapshot-v03",
    rigId: profile.rigId,
    bundleManifestSha256: bundleAuthority.bundleManifestSha256,
    memberLedgerSha256: bundleAuthority.memberLedgerSha256,
    runtimeContextHash: "8".repeat(64),
    rigCharacterizationSha256: profile.artifactSha256,
    operatingContextHash: "9".repeat(64),
    workstationReceiptSha256: "a".repeat(64),
    activatedAt: "2026-07-18T18:45:00.000Z",
    hostedAuthorityKeyId: "c".repeat(64),
    hostedAuthoritySignatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
    hostedAuthorityIssuedAt: "2026-07-18T18:45:30.000Z",
    hostedAuthorityExpiresAt: "2026-07-18T18:47:30.000Z",
    hostedAuthoritySignature: "A".repeat(86),
    ...overrides,
  };
}

function activatedV03CalibrationActivation(bundle, overrides = {}) {
  const authority = bundle.calibrationActivationAuthority;
  return {
    id: authority.activationId,
    activationHash: authority.activationHash,
    calibrationSnapshotId: authority.snapshotId,
    rigId: authority.rigId,
    bundleManifestSha256: authority.bundleManifestSha256,
    memberLedgerSha256: authority.memberLedgerSha256,
    runtimeContextHash: authority.runtimeContextHash,
    rigCharacterizationSha256: authority.rigCharacterizationSha256,
    operatingContextHash: authority.operatingContextHash,
    events: [{
      eventType: "ACTIVATED",
      eventHash: authority.activationRevision,
      workstationReceiptSha256: authority.workstationReceiptSha256,
      occurredAt: new Date(authority.activatedAt),
    }],
    ...overrides,
  };

}
function sampleV03Bundle() {
  const cornerNames = ["top_left", "top_right", "bottom_right", "bottom_left"];
  const edgeNames = ["top", "right", "bottom", "left"];
  const observations = {
    corners: ["front", "back"].flatMap((side) =>
      cornerNames.map((location) => sampleV03ConditionObservation("corners", side, location))),
    edges: ["front", "back"].flatMap((side) =>
      edgeNames.map((location) => sampleV03ConditionObservation("edges", side, location))),
  };
  const publicAssets = ["front", "back"].flatMap((side) => [
    {
      ...sampleV03Asset(`${side}/normalized-card.png`, side, "normalized_card"),
      widthPx: 1200,
      heightPx: 1680,
    },
    sampleV03Asset(`${side}/outer-cut-contour.png`, side, "outer_cut_contour"),
    sampleV03Asset(`${side}/printed-design-contour.png`, side, "printed_design_contour"),
    sampleV03Asset(`${side}/centering-overlay.png`, side, "centering_overlay"),
    sampleV03Asset(`${side}/raw-all-on.png`, side, "other_evidence"),
    sampleV03Asset(`${side}/all-on.png`, side, "other_evidence"),
    ...Array.from({ length: 8 }, (_, index) =>
      sampleV03Asset(`${side}/channels/channel-${index + 1}.png`, side, "directional_channel")),
    ...[...cornerNames.map((location) => ["corners", location]), ...edgeNames.map((location) => ["edges", location])]
      .flatMap(([element, location]) => [
        sampleV03Asset(sampleV03ObservationAssetId(element, side, location, "roi"), side, "roi_crop"),
        sampleV03Asset(sampleV03ObservationAssetId(element, side, location, "segmentation"), side, "segmentation_mask"),
        sampleV03Asset(sampleV03ObservationAssetId(element, side, location, "confidence"), side, "confidence_mask"),
        sampleV03Asset(sampleV03ObservationAssetId(element, side, location, "illumination"), side, "illumination_mask"),
      ]),
  ]);
  const calibrationProfile = sampleV03CalibrationProfile();
  const calibrationBundleAuthority = sampleV03CalibrationBundleAuthority(calibrationProfile);
  return {
    schemaVersion: "ai-grader-report-bundle-v0.3",
    generatedAt: "2026-07-18T19:00:00.000Z",
    reportId: "report-v03-clean",
    certifiedClaim: false,
    cardIdentity: {
      title: "Calibration test card",
      sideCount: 2,
      tenantId: "tenant-1",
      setId: "set-1",
      programId: "program-1",
      set: "Calibration Set",
      cardNumber: "42",
      variantId: null,
      parallelId: null,
    },
    gradingStandard: {
      id: "mathematical_calibration_v1",
      thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
      thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
      algorithmVersion: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.algorithmVersion,
      defectFindingSchemaVersion: AI_GRADER_DEFECT_FINDING_V2_VERSION,
      designReferenceSchemaVersion: MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
    },
    productionRelease: {
      finalGrade: {
        status: "final_mathematical_grade_v1",
        overall: 10,
        labelGrade: 10,
        weightedGrade: 10,
        weakestElement: "centering",
        weakestScore: 10,
        weakestElementCap: 10,
        weights: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weights,
        weightedFormula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weightedFormula,
        elements: {
          centering: sampleV03Element("centering"),
          corners: sampleV03Element("corners", ["front", "back"].flatMap((side) =>
            cornerNames.map((name) => sampleV03Location(side, name)))),
          edges: sampleV03Element("edges", ["front", "back"].flatMap((side) =>
            edgeNames.map((name) => sampleV03Location(side, name)))),
          surface: sampleV03Element("surface"),
        },
        confidence: sampleV03Confidence(),
        formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.finalFormula,
        whyNot10: [],
      },
      label: {
        certId: "TK-report-v03-clean",
        labelGradeText: "10.0",
        publicReportUrl: "/ai-grader/reports/report-v03-clean",
        qrPayloadUrl: "/ai-grader/reports/report-v03-clean",
      },
      publication: { publicReportUrl: "/ai-grader/reports/report-v03-clean" },
    },
    calibrationProfile,
    calibrationBundleAuthority,
    calibrationActivationAuthority: sampleV03ActivationAuthority(calibrationProfile, calibrationBundleAuthority),
    designReferences: [],
    centeringEvidence: {
      front: sampleV03CenteringSide("front"),
      back: sampleV03CenteringSide("back"),
      fusedScore: 10,
      deduction: 0,
      formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula,
      balanceCurve: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.balanceCurve,
    },
    conditionObservationEvidence: observations,
    defectFindings: [],
    deductionLedger: {
      schemaVersion: MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION,
      thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
      thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
      startingScores: { centering: 10, corners: 10, edges: 10, surface: 10 },
      entries: [],
    },
    evidenceQualityLimitations: [],
    publicAssets,
  };
}

function sampleV03BundleWithDesignReference() {
  const bundle = sampleV03Bundle();
  const bytes = designReferencePng(2, 2);
  const artifactSha256 = aiGraderSha256(bytes);
  const artifactId = "front-design-reference-v1.png";
  const reference = {
    schemaVersion: MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
    designReferenceId: "design-reference-row-v1",
    profile: "registered_design_template_v1",
    tenantId: bundle.cardIdentity.tenantId,
    setId: bundle.cardIdentity.setId,
    programId: bundle.cardIdentity.programId,
    cardNumber: bundle.cardIdentity.cardNumber,
    variantId: bundle.cardIdentity.variantId,
    parallelId: bundle.cardIdentity.parallelId,
    side: "front",
    artifactId,
    artifactSha256,
    version: 1,
    widthPx: 2,
    heightPx: 2,
    intendedPrintBoundary: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    approvedBy: "design-approver-1",
    approvedAt: "2026-07-18T17:30:00.000Z",
  };
  bundle.designReferences = [reference];
  bundle.publicAssets.push({
    ...sampleV03Asset(artifactId, "front", "other_evidence"),
    checksumSha256: artifactSha256,
    widthPx: 2,
    heightPx: 2,
  });
  const row = {
    id: reference.designReferenceId,
    tenantId: reference.tenantId,
    setId: reference.setId,
    programId: reference.programId,
    cardNumber: reference.cardNumber,
    variantId: null,
    variantKey: "",
    parallelId: null,
    parallelKey: "",
    side: reference.side,
    profile: reference.profile,
    version: reference.version,
    status: "approved",
    artifactStorageKey: "ai-grader/design-references/set-1/card-42/front-v1.png",
    artifactSha256,
    artifactMimeType: "image/png",
    artifactWidthPx: 2,
    artifactHeightPx: 2,
    intendedDesignBoundary: {
      schemaVersion: "ai-grader-intended-design-boundary-v1",
      coordinateFrame: "design_reference_pixels",
      contour: [[0, 0], [2, 0], [2, 2], [0, 2]],
    },
    provenance: {
      schemaVersion: "ai-grader-design-reference-provenance-v1",
      sourceKind: "ten_kings_controlled_reference",
      approvedForPrecisionReference: true,
    },
    transformAcceptanceMetadata: {
      schemaVersion: "ai-grader-design-reference-transform-acceptance-v1",
      registrationAlgorithmVersion: "registered-design-registration-v1",
      maxResidualPx: 1,
      minInlierFraction: 0.9,
    },
    createdByUserId: "design-creator-1",
    approvedByUserId: reference.approvedBy,
    approvedAt: new Date(reference.approvedAt),
    retiredByUserId: null,
    retiredAt: null,
    retirementReason: null,
    createdAt: new Date("2026-07-18T17:00:00.000Z"),
    updatedAt: new Date(reference.approvedAt),
  };
  return { bundle, reference, row, bytes };
}

function sampleV03ProductionRelease(bundle) {
  const elementScores = Object.fromEntries(
    Object.entries(bundle.productionRelease.finalGrade.elements).map(([element, value]) => [
      element,
      value.score,
    ]),
  );
  return {
    schemaVersion: "ai-grader-mathematical-production-release-v1",
    generatedAt: bundle.generatedAt,
    gradingSessionId: "station-session-v03",
    reportId: bundle.reportId,
    reportStatus: "final_ai_grader_report_v1",
    finalStatus: "final_grade_computed",
    finalGradeComputed: true,
    certifiedClaim: false,
    certificateGenerated: false,
    labelDataGenerated: true,
    qrPayloadGenerated: true,
    gates: [{
      id: "strict_mathematical_v1_contract",
      status: "pass",
      reason: "Strict Mathematical V1 report validated.",
      evidenceRefs: bundle.publicAssets.map((asset) => asset.id),
    }],
    finalGrade: structuredClone(bundle.productionRelease.finalGrade),
    operatorFinalization: {
      operatorId: "operator-v03",
      finalizedAt: bundle.generatedAt,
      warningsAccepted: false,
      acceptedWarningGateIds: [],
    },
    publication: {
      status: "local_bundle_ready",
      reportId: bundle.reportId,
      publicReportUrl: bundle.productionRelease.label.publicReportUrl,
      qrPayloadUrl: bundle.productionRelease.label.qrPayloadUrl,
    },
    label: {
      ...structuredClone(bundle.productionRelease.label),
      status: "label_data_ready",
      labelVersion: "ten-kings-ai-grader-label-v1",
      reportId: bundle.reportId,
      certificateStatus: "report_id_issued_not_certified",
      elementScores,
      cardIdentity: structuredClone(bundle.cardIdentity),
      certifiedClaim: false,
    },
    cardIdentity: structuredClone(bundle.cardIdentity),
  };
}

function trustedV03CalibrationSnapshot(bundle, overrides = {}) {
  const profile = bundle.calibrationProfile;
  return {
    id: "calibration-snapshot-v03",
    rigId: profile.rigId,
    calibrationType: "MATHEMATICAL_GRADING_V1",
    mathematicalProfileId: profile.profileId,
    mathematicalCalibrationVersion: profile.calibrationVersion,
    mathematicalProfileFinalizedAt: new Date(profile.finalizedAt),
    mathematicalArtifactId: profile.artifactId,
    mathematicalArtifactSha256: profile.artifactSha256,
    mathematicalThresholdSetId: bundle.gradingStandard.thresholdSetId,
    mathematicalThresholdSetHash: bundle.gradingStandard.thresholdSetHash,
    mathematicalBundleSchemaVersion: bundle.calibrationBundleAuthority.schemaVersion,
    mathematicalBundleManifestSha256: bundle.calibrationBundleAuthority.bundleManifestSha256,
    mathematicalSourceCaptureManifestSha256:
      bundle.calibrationBundleAuthority.sourceCaptureManifestSha256,
    mathematicalMemberLedgerSha256: bundle.calibrationBundleAuthority.memberLedgerSha256,
    artifactChecksums: {
      calibrationBundleAuthority: structuredClone(bundle.calibrationBundleAuthority),
    },
    trustStatus: "TRUSTED",
    trustedAt: new Date("2026-07-18T18:30:00.000Z"),
    validityStartsAt: new Date(profile.finalizedAt),
    validityEndsAt: null,
    supersededById: null,
    rig: { tenantId: "tenant-1", status: "ACTIVE" },
    ...overrides,
  };
}

const RAPID_QUEUE_IDENTITY = Object.freeze({
  queueItemId: "queue-card-1",
  gradingSessionId: "station-session-1",
  reportId: "report-1",
});

function persistAiGraderProductionRelease(db, input, options) {
  return persistAiGraderProductionReleaseRaw(db, {
    queueItemId: RAPID_QUEUE_IDENTITY.queueItemId,
    ...input,
  }, options);
}

function publicStorageLocatorPaths(value, path = "$") {
  if (Array.isArray(value)) return value.flatMap((entry, index) => publicStorageLocatorPaths(entry, `${path}[${index}]`));
  if (typeof value === "string") {
    const trimmed = value.trim();
    return (
      /^(?:s3|gs|az|swift):\/\//i.test(trimmed) ||
      /^ai-grader\/reports\/[^/?#]+(?:\/|$)/i.test(trimmed) ||
      /(^|[\s('"=:])(\/Users\/|\/home\/|\/root\/|\/tmp\/|\/var\/|\/app\/|\/workspace\/|\/mnt\/|\/opt\/|\/srv\/|\/etc\/|\/private\/|\/run\/|\/usr\/|\/bin\/|\/sbin\/|\/lib\/|\/lib64\/|\/dev\/|\/proc\/|\/sys\/|\/System\/|\/Library\/|\/Volumes\/)/i.test(trimmed) ||
      /^(?:(?:authorization\s*:\s*)?(?:bearer|basic)\s+\S{8,}|(?:x[-_]?api[-_]?key|api[-_]?key)\s*[:=]\s*\S{8,})$/i.test(trimmed) ||
      /^eyJ[a-z0-9_-]*\.[a-z0-9_-]+\.[a-z0-9_-]+$/i.test(trimmed) ||
      /^(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR|SUkq|TU0A)/.test(trimmed)
    ) ? [path] : [];
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    const compact = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const forbidden =
      compact.endsWith("base64") ||
      compact.endsWith("payload") ||
      compact.includes("encoded") ||
      compact.endsWith("body") ||
      compact.includes("binary") ||
      compact.includes("presigned") ||
      compact.includes("bridge") ||
      compact.includes("cookie") ||
      compact.includes("header") ||
      compact === "jwt" ||
      compact.endsWith("jwt") ||
      compact.endsWith("endpoint") ||
      compact === "sourceurl" ||
      [
        "artifactkey",
        "artifactkeys",
        "artifactlocator",
        "artifactlocators",
        "signedurl",
        "signeduri",
        "downloadurl",
        "downloaduri",
        "privateurl",
        "privateuri",
        "internalurl",
        "internaluri",
      ].includes(compact) ||
      compact.includes("provider") ||
      compact.includes("openai") ||
      compact.includes("googlevision") ||
      compact.includes("serpapi") ||
      compact.includes("storagekey") ||
      compact.includes("storageprefix") ||
      compact.includes("storagepath") ||
      compact.includes("storagereference") ||
      compact.includes("storagelocator") ||
      compact.includes("privatestorage") ||
      compact.includes("internalstorage") ||
      compact.includes("privateobject") ||
      compact.includes("internalobject") ||
      [
        "labelpreviewkey",
        "reportbundlekey",
        "productionreleasekey",
        "labeldatakey",
        "assetmanifestkey",
        "reporthtmlkey",
        "publicationmanifestkey",
        "integrationcontractkey",
      ].includes(compact) ||
      (compact.startsWith("storage") &&
        /(?:key|prefix|path|reference|ref|locator|url|uri|object|objectid|bucket|bucketname|blob|blobid)$/.test(compact)) ||
      /(?:object|blob|bucket|s3|spaces)(?:key|path|prefix|reference|ref|locator|id|uri|url|name|handle)$/.test(compact) ||
      compact === "sourcekey";
    return [
      ...(forbidden ? [`${path}.${key}`] : []),
      ...publicStorageLocatorPaths(entry, `${path}.${key}`),
    ];
  });
}

function sampleDefectFinding(overrides = {}) {
  return {
    schemaVersion: "ai-grader-defect-finding-v1",
    findingId: "dfv1_1234567890abcdef12345678",
    side: "back",
    category: "surface_anomaly",
    detector: {
      id: "preliminary_surface_intelligence_v0",
      version: "preliminary_surface_intelligence_v0",
      captureProfileVersion: "fixed-rig-v1",
    },
    severity: { score: 72.5, band: "high" },
    confidence: 0.78,
    review: { status: "unreviewed" },
    geometry: {
      coordinateFrame: "normalized_card",
      units: "fraction",
      shape: { type: "box", x: 0.1, y: 0.2, width: 0.25, height: 0.125 },
    },
    evidence: {
      trueViewAssetId: "report/back/back-normalized-card.png",
      heatmapAssetId: "report/back/back-heatmap.png",
      channelAssetIds: [],
      roiAssetIds: [],
    },
    explanation: "AI-detected provisional surface finding. Review the linked evidence before relying on this finding.",
    ...overrides,
  };
}

function visionLabWithFindings(findings) {
  return {
    defectFindings: findings,
    findingValidation: {
      status: "valid",
      sourceCandidateCount: findings.length,
      publishedFindingCount: findings.length,
      issues: [],
    },
  };
}

function sampleBundle(overrides = {}) {
  return {
    schemaVersion: "ai-grader-report-bundle-v0.1",
    gradingSessionId: "station-session-1",
    reportId: "report-1",
    generatedAt: "2026-07-02T12:00:00.000Z",
    reportStatus: "final_ai_grader_report_v0",
    certifiedClaim: false,
    certificateGenerated: false,
    localReportFolder: "C:\\TenKings\\capture-data\\ai-grader-station\\report-1",
    reportHtmlPath: "C:\\TenKings\\capture-data\\ai-grader-station\\report-1\\provisional-diagnostic-report.html",
    cardIdentity: sampleConfirmedIdentity(),
    provisionalGrade: {
      gradeStory: {
        strongestPositiveFinding: "Centering is strong.",
      },
    },
    evidenceReferences: {
      frontPackageDir: "C:\\TenKings\\capture-data\\front",
      backPackageDir: "C:\\TenKings\\capture-data\\back",
    },
    visionLab: {
      heatmapRefs: ["front heatmap"],
      surfaceVisionRefs: ["front surface vision"],
      findingValidation: {
        status: "valid",
        sourceCandidateCount: 0,
        publishedFindingCount: 0,
        issues: [],
      },
    },
    calibrationProfile: {
      referenceType: "fixed_metric_rulers",
      isCalibrated: false,
      mmPerPixelX: 0.047,
      mmPerPixelY: 0.047,
    },
    lightingProfile: {
      dutyPercent: 1.4,
      exposureUs: 45000,
    },
    geometry: {
      front: {
        side: "front",
        placementState: "ready",
        geometrySource: "detected",
        captureMode: "detected_geometry",
        confidence: 0.91,
        detectionUsed: true,
        manualOverrideUsed: false,
        sourceFrameId: "front-frame-safe-1",
        localOutputPath: "C:\\TenKings\\capture-data\\front-normalized.png",
        previewImage: "data:image/png;base64,must-not-survive",
        marginLeftMm: 1.25,
        dimensions: { widthInches: 2.5, heightInches: 3.5 },
      },
      back: {
        side: "back",
        placementState: "ready",
        confidence: 0.92,
        sourceFrameId: "back-frame-safe-1",
      },
    },
    geometryCaptureDecisions: {
      front: {
        mode: "detected_geometry",
        placementState: "ready",
        timestamp: "2026-07-02T12:00:01.000Z",
        explicitOperatorAction: false,
        detectionUsed: true,
        manualOverrideUsed: false,
        sourceFrameId: "front-frame-safe-1",
        localManifestPath: "C:\\TenKings\\capture-data\\station-session.json",
        bridgeUrl: "http://127.0.0.1:47652/status",
        stationToken: "must-not-survive",
        uploadUrl: "https://storage.example.test/front.png?X-Amz-Signature=must-not-survive",
        hardwareControls: { leimacOn: true },
      },
      back: {
        mode: "detected_geometry",
        placementState: "ready",
        timestamp: "2026-07-02T12:00:02.000Z",
        explicitOperatorAction: false,
        detectionUsed: true,
        manualOverrideUsed: false,
        sourceFrameId: "back-frame-safe-1",
      },
    },
    captureTiming: {
      schemaVersion: "ten-kings-ai-grader-capture-timing-v1",
      captureProfile: "production_fast",
      hardwareMeasurement: false,
      summary: {
        totalFrontMs: 4700,
        totalBackMs: 4800,
        frontProcessingDuringFlipMs: 900,
        totalCardMs: 11800,
      },
      target: {
        fiveSecondsPerSideProven: false,
        hardwareMeasurementRequired: true,
      },
    },
    ocrPrefill: {
      humanConfirmationRequired: true,
      inventoryMutationPerformed: false,
      publishMutationPerformed: false,
      fields: {
        playerName: { value: "Test Player", confidence: 0.91, reviewRequired: false },
      },
    },
    warnings: ["fixture calibration is local"],
    ...overrides,
  };
}

function sampleRelease(overrides = {}) {
  return {
    gradingSessionId: "station-session-1",
    reportId: "report-1",
    reportStatus: "final_ai_grader_report_v0",
    finalStatus: "final_grade_computed",
    finalGradeComputed: true,
    certifiedClaim: false,
    certificateGenerated: false,
    finalGrade: {
      status: "final_ai_grader_grade_v0",
      overall: 8.6,
      elements: {
        centering: { score: 9.7, confidence: "high", explanation: "Centering evidence supports this score." },
        corners: { score: 8.8, confidence: "medium", explanation: "Corner evidence supports this score." },
        edges: { score: 8.7, confidence: "medium", explanation: "Edge evidence supports this score." },
        surface: { score: 7.8, confidence: "medium", explanation: "Surface evidence supports this score." },
      },
      confidence: {
        score: 0.72,
        band: "medium",
      },
      gradeImpactReasons: [
        {
          id: "surface-1",
          category: "surface",
          side: "front",
          severity: "medium",
          confidence: "medium",
          explanation: "Surface evidence reduced the final score.",
          evidenceRefs: ["heatmap.front"],
        },
      ],
      whyNot10: [
        {
          id: "surface-warning",
          title: "Surface warning",
          explanation: "Surface candidate reduced the score.",
          evidenceRefs: ["heatmap.front"],
        },
      ],
    },
    label: {
      status: "label_data_ready",
      certId: "TK-AIG-REPORT1",
      reportId: "report-1",
      labelGradeText: "8.6",
      qrPayloadUrl: "http://127.0.0.1:3020/ai-grader/reports/report-1",
      publicReportUrl: "http://127.0.0.1:3020/ai-grader/reports/report-1",
      certificateStatus: "report_id_issued_not_certified",
      cardIdentity: sampleConfirmedIdentity(),
    },
    publication: {
      status: "local_bundle_ready",
      publicReportUrl: "http://127.0.0.1:3020/ai-grader/reports/report-1",
      storageMode: "local_artifact_only",
    },
    operatorFinalization: {
      operatorId: "operator-1",
      warningsAccepted: true,
      overrideReason: "V0 accepted warning gates.",
    },
    gates: [{ id: "ruler_calibration", status: "pass" }],
    warnings: ["V0 final report is not certified."],
    ebayCompsContract: {
      status: "not_run",
      compsRefs: [],
    },
    cardInventoryLinkage: {
      status: "linked",
      cardAssetId: "card-asset-1",
      itemId: "item-1",
    },
    ...overrides,
  };
}

function sampleActorAudit(overrides = {}) {
  return {
    actorType: "service_account",
    action: "publish",
    requestedAt: "2026-07-03T12:00:00.000Z",
    serviceAccountId: "ai-grader-smoke-service",
    role: "ai_grader_service",
    ...overrides,
  };
}

function sampleConfirmedIdentity(overrides = {}) {
  return {
    category: "sport",
    title: "1996 Topps Michael Jordan #23",
    playerName: "Michael Jordan",
    year: "1996",
    manufacturer: "Topps",
    sport: "basketball",
    productSet: "Topps",
    set: "Topps",
    cardNumber: "23",
    autograph: false,
    memorabilia: false,
    source: "card_asset",
    status: "linked",
    sideCount: 2,
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    ...overrides,
  };
}

function confirmedProductionSession(overrides = {}) {
  return {
    id: "db-session-1",
    tenantId: "tenant-1",
    gradingSessionId: "station-session-1",
    reportId: "report-1",
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    status: "card_created",
    cardIdentity: sampleConfirmedIdentity({ rapidQueueIdentity: RAPID_QUEUE_IDENTITY }),
    ...overrides,
  };
}

function confirmedProductionReport(overrides = {}) {
  return {
    id: "db-report-1",
    tenantId: "tenant-1",
    sessionId: "db-session-1",
    reportId: "report-1",
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    publicationStatus: "draft",
    finalOverallGrade: 8.6,
    ...overrides,
  };
}

function confirmedV03PublishAuthority(reportBundle, productionRelease) {
  const rapidQueueIdentity = {
    queueItemId: RAPID_QUEUE_IDENTITY.queueItemId,
    gradingSessionId: productionRelease.gradingSessionId,
    reportId: reportBundle.reportId,
  };
  const publishAuthority = buildAiGraderPublishAuthorityRecord({ reportBundle, productionRelease });
  return {
    session: confirmedProductionSession({
      gradingSessionId: productionRelease.gradingSessionId,
      reportId: reportBundle.reportId,
      cardIdentity: sampleConfirmedIdentity({ rapidQueueIdentity }),
    }),
    cardAsset: {
      id: "card-asset-1",
      batchId: "batch-1",
      aiGradeFinal: productionRelease.finalGrade.overall,
      classificationSourcesJson: {
        rapidQueueIdentity,
        aiGraderPublishAuthority: publishAuthority,
      },
      aiGradingJson: {
        rapidQueueIdentity,
        publishAuthority,
      },
    },
  };
}

function createMockDelegate(name, calls, id, findUniqueValue, updateManyValue) {
  const record = (method, args) => calls.push({
    delegate: name,
    method,
    args,
    inTransaction: calls.transactionDepth > 0,
  });
  return {
    async create(args) {
      record("create", args);
      return { id, ...(args.data ?? {}) };
    },
    async upsert(args) {
      record("upsert", args);
      return {
        id,
        ...(args.create ?? {}),
        ...(args.update ?? {}),
      };
    },
    async findUnique(args) {
      record("findUnique", args);
      if (findUniqueValue !== undefined) {
        return typeof findUniqueValue === "function" ? findUniqueValue(args) : findUniqueValue;
      }
      if (name === "aiGraderSession") {
        return confirmedProductionSession({
          gradingSessionId: args.where?.gradingSessionId ?? "station-session-1",
        });
      }
      if (name === "aiGraderReport") {
        return confirmedProductionReport({
          reportId: args.where?.reportId ?? "report-1",
        });
      }
      if (name === "cardAsset") {
        return {
          id: "card-asset-1",
          batchId: "batch-1",
        };
      }
      if (name === "item") {
        return {
          id: "item-1",
          number: "card-asset-1",
          detailsJson: {
            existingItemDetail: "keep-me",
            nestedItemDetail: { preserved: true },
            aiGraderReportId: "old-report",
          },
        };
      }
      return null;
    },
    async findMany(args) {
      record("findMany", args);
      if (name === "calibrationSnapshot" && findUniqueValue !== undefined) {
        const value = typeof findUniqueValue === "function" ? findUniqueValue(args) : findUniqueValue;
        if (Array.isArray(value)) return value;
        return value ? [value] : [];
      }
      if (name === "aiGraderLabel" && findUniqueValue !== undefined) {
        const value = typeof findUniqueValue === "function" ? findUniqueValue(args) : findUniqueValue;
        return value ? [value] : [];
      }
      return [];
    },
    async updateMany(args) {
      record("updateMany", args);
      if (updateManyValue !== undefined) {
        return typeof updateManyValue === "function" ? updateManyValue(args) : updateManyValue;
      }
      return { count: 1 };
    },
  };
}

function createMockProductionDb(options = {}) {
  const calls = [];
  calls.transactionDepth = 0;
  const publishAuthority = buildAiGraderPublishAuthorityRecord({
    reportBundle: options.reportBundle ?? sampleBundle(),
    productionRelease: options.productionRelease ?? sampleRelease(),
  });
  const cardAssetOverride = options.cardAsset ?? {};
  const confirmedCardAsset = {
    id: "card-asset-1",
    batchId: "batch-1",
    aiGradeFinal: 8.6,
    ...cardAssetOverride,
    classificationSourcesJson: {
      rapidQueueIdentity: RAPID_QUEUE_IDENTITY,
      ...(options.cardAsset ? cardAssetOverride.classificationSourcesJson ?? {} : { aiGraderPublishAuthority: publishAuthority }),
    },
    aiGradingJson: {
      rapidQueueIdentity: RAPID_QUEUE_IDENTITY,
      ...(options.cardAsset ? cardAssetOverride.aiGradingJson ?? {} : { publishAuthority }),
    },
  };
  const calibrationActivationRow = Object.prototype.hasOwnProperty.call(options, "calibrationActivationRow")
    ? options.calibrationActivationRow
    : options.reportBundle?.calibrationActivationAuthority
      ? activatedV03CalibrationActivation(options.reportBundle)
      : undefined;
  const tx = {
    async $queryRaw() {
      calls.push({
        delegate: "$queryRaw",
        method: "$queryRaw",
        inTransaction: calls.transactionDepth > 0,
      });
      return [];
    },
    aiGraderSession: createMockDelegate(
      "aiGraderSession",
      calls,
      "db-session-1",
      options.session,
      options.sessionUpdateMany,
    ),
    aiGraderReport: createMockDelegate(
      "aiGraderReport",
      calls,
      "db-report-1",
      options.report,
      options.reportUpdateMany,
    ),
    aiGraderEvidenceAsset: createMockDelegate("aiGraderEvidenceAsset", calls, "db-evidence-1"),
    aiGraderGrade: createMockDelegate("aiGraderGrade", calls, "db-grade-1"),
    aiGraderLabel: createMockDelegate("aiGraderLabel", calls, "db-label-1", options.existingLabel),
    aiGraderPublication: createMockDelegate("aiGraderPublication", calls, "db-publication-1"),
    aiGraderValuation: createMockDelegate("aiGraderValuation", calls, "db-valuation-1", options.existingValuation),
    ...(Object.prototype.hasOwnProperty.call(options, "calibrationSnapshotRows")
      ? {
          calibrationSnapshot: createMockDelegate(
            "calibrationSnapshot", calls, "calibration-snapshot-v03", options.calibrationSnapshotRows,
          ),
        }
      : {}),
    mathematicalCalibrationActivation: createMockDelegate(
      "mathematicalCalibrationActivation",
      calls,
      "calibration-activation-v03",
      calibrationActivationRow,
    ),
    ...(Object.prototype.hasOwnProperty.call(options, "designReferenceRow")
      ? {
          aiGraderDesignReference: {
            async findFirst(args) {
              calls.push({ delegate: "aiGraderDesignReference", method: "findFirst", args });
              return typeof options.designReferenceRow === "function"
                ? options.designReferenceRow(args)
                : options.designReferenceRow;
            },
          },
        }
      : {}),
    cardAsset: createMockDelegate("cardAsset", calls, "card-asset-1", confirmedCardAsset),
    item: createMockDelegate("item", calls, "item-1", options.item),
  };
  return {
    calls,
    db: {
      ...tx,
      async $transaction(callback) {
        calls.push({ delegate: "$transaction", method: "$transaction", inTransaction: false });
        calls.transactionDepth += 1;
        try {
          return await callback(tx);
        } finally {
          calls.transactionDepth -= 1;
        }
      },
    },
  };
}

test("production storage plan sanitizes local Dell paths and loopback URLs", () => {
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
  });

  assert.equal(plan.publicReportUrl, "https://collect.tenkings.co/ai-grader/reports/report-1");
  assert.equal(plan.qrPayloadUrl, plan.publicReportUrl);
  assert.equal(plan.artifacts.some((artifact) => artifact.kind === "report-bundle.json"), true);
  assert.equal(plan.artifacts.some((artifact) => artifact.kind === "label-preview.html"), true);
  assert.equal(plan.artifacts.some((artifact) => artifact.kind === "asset-manifest.json"), true);
  const combinedBodies = plan.artifacts.map((artifact) => artifact.body).join("\n");
  assert.doesNotMatch(combinedBodies, /C:\\TenKings/);
  assert.doesNotMatch(combinedBodies, /127\.0\.0\.1/);
  assert.match(combinedBodies, /"publicReportUrl": "https:\/\/collect\.tenkings\.co\/ai-grader\/reports\/report-1"/);
});

test("production report keeps only detected geometry decisions while removing all private station data", () => {
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const reportBundleArtifact = plan.artifacts.find((artifact) => artifact.kind === "report-bundle.json");
  const publicBundle = JSON.parse(reportBundleArtifact?.body ?? "{}");
  const frontGeometry = publicBundle.geometry.front;
  const frontDecision = publicBundle.geometryCaptureDecisions.front;

  assert.equal(frontGeometry.geometrySource, "detected");
  assert.equal(frontGeometry.captureMode, "detected_geometry");
  assert.equal(frontGeometry.detectionUsed, true);
  assert.equal(frontGeometry.manualOverrideUsed, false);
  assert.equal(frontGeometry.marginLeftMm, undefined);
  assert.equal(frontGeometry.dimensions, undefined);
  assert.equal(frontDecision.mode, "detected_geometry");
  assert.equal(frontDecision.geometrySource, "detected");
  assert.equal(frontDecision.captureMode, "automatic_detection");
  assert.equal(frontDecision.placementState, "ready");
  assert.equal(frontDecision.explicitOperatorAction, false);
  assert.equal(frontDecision.detectionUsed, true);
  assert.equal(frontDecision.manualOverrideUsed, false);
  assert.equal(frontDecision.manualBoundaryRect, undefined);
  assert.equal(publicBundle.geometryCaptureDecisions.back.mode, "detected_geometry");
  assert.equal(publicBundle.geometryCaptureDecisions.back.geometrySource, "detected");

  const serialized = JSON.stringify(publicBundle);
  assert.doesNotMatch(
    serialized,
    /C:\\TenKings|127\.0\.0\.1|must-not-survive|data:image|X-Amz-Signature|stationToken|bridgeUrl|uploadUrl|hardwareControls|leimacOn/
  );

  assert.equal(
    normalizeAiGraderPublicGeometryCaptureDecisions({
      front: {
        mode: "manual_capture",
        placementState: "ready",
        explicitOperatorAction: false,
        detectionUsed: true,
        manualOverrideUsed: false,
        manualBoundaryRect: {
          x: 100,
          y: 140,
          width: 300,
          height: 420,
          coordinateFrame: "basler_sensor_pixels",
        },
      },
    }),
    undefined
  );
});

test("production storage plan uploads AI Grader evidence image assets with public URLs", () => {
  const imageBytes = Buffer.from("front-image");
  const imageChecksum = aiGraderSha256(imageBytes);
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle({
      assets: [
        {
          id: "front/front-all-on-portrait-display.png",
          kind: "image",
          fileName: "front-all-on-portrait-display.png",
          localPath: "C:\\TenKings\\capture-data\\front\\front-all-on-portrait-display.png",
          contentType: "image/png",
          checksumSha256: imageChecksum,
          byteSize: imageBytes.length,
        },
      ],
    }),
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
  });

  const imageArtifact = plan.artifacts.find((artifact) => artifact.artifactClass === "report_asset");
  assert.equal(imageArtifact?.kind, "report-image");
  assert.equal(imageArtifact?.contentType, "image/png");
  assert.equal(imageArtifact?.bodyEncoding, undefined);
  assert.equal(imageArtifact?.body, undefined);
  assert.equal(imageArtifact?.checksumSha256, imageChecksum);
  assert.equal(imageArtifact?.byteSize, imageBytes.length);
  assert.equal(imageArtifact?.sourceAssetId, "front/front-all-on-portrait-display.png");
  assert.match(imageArtifact?.storageKey ?? "", /ai-grader\/reports\/report-1\/assets\/001-front-all-on-portrait-display\.png/);
  assert.equal(imageArtifact?.publicUrl, `https://cdn.tenkings.test/${imageArtifact?.storageKey}`);
  assert.equal(plan.artifacts.some((artifact) => artifact.kind === "checksums.json"), true);

  const reportBundleArtifact = plan.artifacts.find((artifact) => artifact.kind === "report-bundle.json");
  const publicBundle = JSON.parse(reportBundleArtifact?.body ?? "{}");
  assert.equal(publicBundle.publicAssets[0].publicUrl, imageArtifact?.publicUrl);
  assert.equal(publicBundle.publicAssets[0].id, "front/front-all-on-portrait-display.png");
  assert.equal(publicBundle.assets[0].contentType, "image/png");
  assert.equal(publicBundle.assets[0].bodyBase64, undefined);
  assert.equal(publicBundle.assets[0].localPath, undefined);
  assert.doesNotMatch(reportBundleArtifact?.body ?? "", /C:\\TenKings/);
});

test("production storage plan preserves exact finding asset IDs and rejects detector internals", () => {
  const normalizedBytes = Buffer.from("normalized-card");
  const heatmapBytes = Buffer.from("heatmap");
  const finding = sampleDefectFinding();
  const release = sampleRelease();
  release.finalGrade.gradeImpactReasons[0].findingIds = [finding.findingId];
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle({
      provisionalGrade: {
        gradeImpactCandidates: [{ id: "surface-1", findingIds: [finding.findingId] }],
      },
      visionLab: visionLabWithFindings([finding]),
      assets: [
        {
          id: "report/back/back-normalized-card.png",
          kind: "image",
          fileName: "back-normalized-card.png",
          contentType: "image/png",
          checksumSha256: aiGraderSha256(normalizedBytes),
          byteSize: normalizedBytes.length,
          side: "back",
          evidenceRole: "normalized_card",
        },
        {
          id: "report/back/back-heatmap.png",
          kind: "image",
          fileName: "back-heatmap.png",
          contentType: "image/png",
          checksumSha256: aiGraderSha256(heatmapBytes),
          byteSize: heatmapBytes.length,
          side: "back",
          evidenceRole: "surface_heatmap",
        },
      ],
    }),
    productionRelease: release,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });

  const artifact = plan.artifacts.find((entry) => entry.kind === "report-bundle.json");
  const publicBundle = JSON.parse(artifact?.body ?? "{}");
  assert.deepEqual(publicBundle.publicAssets.map((asset) => asset.id), [
    "report/back/back-normalized-card.png",
    "report/back/back-heatmap.png",
  ]);
  assert.equal(publicBundle.schemaVersion, "ai-grader-report-bundle-v0.2");
  assert.equal(publicBundle.defectFindings[0].findingId, finding.findingId);
  assert.equal(publicBundle.defectFindings[0].evidence.trueViewAssetId, "report/back/back-normalized-card.png");
  assert.equal(publicBundle.defectFindings[0].geometry.shape.kind, "box");
  assert.equal(publicBundle.defectFindings[0].review.status, "unreviewed");

  const privateFinding = {
    ...finding,
    rawRect: { x: 100, y: 200, width: 40, height: 50 },
    privateDetectorState: { threshold: 0.341, stationToken: "must-not-survive" },
  };
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({
        visionLab: visionLabWithFindings([privateFinding]),
        assets: [
          {
            id: "report/back/back-normalized-card.png",
            kind: "image",
            fileName: "back-normalized-card.png",
            contentType: "image/png",
            checksumSha256: aiGraderSha256(normalizedBytes),
            byteSize: normalizedBytes.length,
            side: "back",
            evidenceRole: "normalized_card",
          },
          {
            id: "report/back/back-heatmap.png",
            kind: "image",
            fileName: "back-heatmap.png",
            contentType: "image/png",
            checksumSha256: aiGraderSha256(heatmapBytes),
            byteSize: heatmapBytes.length,
            side: "back",
            evidenceRole: "surface_heatmap",
          },
        ],
      }),
      productionRelease: release,
    }),
    /stored defect finding/,
  );
});

test("production storage plan rejects dangling findings and unsafe or duplicate asset IDs", () => {
  const bytes = Buffer.from("image");
  const baseAsset = {
    kind: "image",
    fileName: "image.png",
    contentType: "image/png",
    checksumSha256: aiGraderSha256(bytes),
    byteSize: bytes.length,
  };
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({
        visionLab: visionLabWithFindings([sampleDefectFinding()]),
        assets: [{ ...baseAsset, id: "report/back/back-normalized-card.png", side: "back", evidenceRole: "normalized_card" }],
      }),
      productionRelease: sampleRelease(),
    }),
    /invalid public defect findings/,
  );
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({ assets: [{ ...baseAsset, id: "C:\\capture\\image.png" }] }),
      productionRelease: sampleRelease(),
    }),
    /unsafe public (?:image|evidence) asset ID/,
  );
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({
        assets: [
          { ...baseAsset, id: "report/back/image.png" },
          { ...baseAsset, id: "REPORT/BACK/IMAGE.PNG" },
        ],
      }),
      productionRelease: sampleRelease(),
    }),
    /duplicate public (?:image|evidence) asset IDs/,
  );
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({
        assets: [{ ...baseAsset, id: "report/back/active.svg", contentType: "image/svg+xml" }],
      }),
      productionRelease: sampleRelease(),
    }),
    /approved raster image type/,
  );
});

test("public report read sanitizer revalidates findings and drops dangling or private fields", () => {
  const bytes = Buffer.from("image");
  const checksumSha256 = aiGraderSha256(bytes);
  const valid = sampleDefectFinding({ rawRect: { x: 1, y: 2, width: 3, height: 4 }, detectorSecret: "private" });
  const dangling = sampleDefectFinding({
    findingId: "dfv1_abcdef1234567890abcdef12",
    evidence: {
      trueViewAssetId: "report/back/missing.png",
      channelAssetIds: [],
      roiAssetIds: [],
    },
  });
  const sanitized = sanitizeAiGraderPublicReportBundleForRead({
    schemaVersion: "ai-grader-report-bundle-v0.1",
    reportId: "report-1",
    generatedAt: "2026-07-02T12:00:00.000Z",
    certifiedClaim: false,
    assets: [
      {
        id: "report/back/back-normalized-card.png",
        contentType: "image/png",
        checksumSha256,
        byteSize: bytes.length,
        storageKey: "ai-grader/reports/report-1/assets/001-back-normalized-card.png",
        publicUrl: "https://cdn.tenkings.test/ai-grader/reports/report-1/assets/001-back-normalized-card.png",
        side: "back",
        evidenceRole: "normalized_card",
      },
      {
        id: "report/back/back-heatmap.png",
        contentType: "image/png",
        checksumSha256,
        byteSize: bytes.length,
        storageKey: "ai-grader/reports/report-1/assets/002-back-heatmap.png",
        publicUrl: "https://cdn.tenkings.test/ai-grader/reports/report-1/assets/002-back-heatmap.png",
        side: "back",
        evidenceRole: "surface_heatmap",
      },
    ],
    provisionalGrade: {
      gradeImpactCandidates: [
        { id: "valid-reference", findingIds: [valid.findingId, "dfv1_ffffffffffffffffffffffff"] },
        { id: "malformed-reference", findingIds: valid.findingId },
      ],
    },
    productionRelease: {
      finalGrade: { gradeImpactReasons: [{ id: "malformed-final-reference", findingIds: { id: valid.findingId } }] },
    },
    visionLab: visionLabWithFindings([valid, dangling]),
  });

  assert.equal(sanitized?.visionLab.defectFindings.length, 1);
  assert.equal(sanitized?.visionLab.defectFindings[0].findingId, valid.findingId);
  assert.equal(sanitized?.visionLab.defectFindings[0].rawRect, undefined);
  assert.equal(sanitized?.visionLab.defectFindings[0].detectorSecret, undefined);
  assert.equal(sanitized?.visionLab.defectFindings[0].review.status, "unreviewed");
  assert.deepEqual(sanitized?.provisionalGrade.gradeImpactCandidates[0].findingIds, [valid.findingId]);
  assert.equal(sanitized?.provisionalGrade.gradeImpactCandidates[1].findingIds, undefined);
  assert.equal(sanitized?.productionRelease.finalGrade.gradeImpactReasons[0].findingIds, undefined);
});

test("finding publication enforces evidence side and role and cannot forge human review", () => {
  const bytes = Buffer.from("image");
  const asset = {
    id: "report/back/back-normalized-card.png",
    kind: "image",
    fileName: "back-normalized-card.png",
    contentType: "image/png",
    checksumSha256: aiGraderSha256(bytes),
    byteSize: bytes.length,
    side: "back",
    evidenceRole: "normalized_card",
  };
  const confirmed = sampleDefectFinding({
    review: { status: "confirmed", reviewedAt: "2026-07-10T12:00:00.000Z" },
    evidence: {
      trueViewAssetId: "report/back/back-normalized-card.png",
      channelAssetIds: [],
      roiAssetIds: [],
    },
  });
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({ visionLab: visionLabWithFindings([confirmed]), assets: [asset] }),
      productionRelease: sampleRelease(),
    }),
    /stored defect finding/,
  );

  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({
        visionLab: visionLabWithFindings([{ ...confirmed, review: { status: "unreviewed" } }]),
        assets: [{ ...asset, side: "front" }],
      }),
      productionRelease: sampleRelease(),
    }),
    /invalid public defect findings/,
  );
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({
        visionLab: visionLabWithFindings([{ ...confirmed, review: { status: "unreviewed" } }]),
        assets: [{ ...asset, evidenceRole: "surface_heatmap" }],
      }),
      productionRelease: sampleRelease(),
    }),
    /invalid public defect findings/,
  );
});

test("finding measurements are derived only from a calibrated versioned publish projection", () => {
  const bytes = Buffer.from("normalized-card");
  const finding = sampleDefectFinding({
    evidence: {
      trueViewAssetId: "report/back/back-normalized-card.png",
      channelAssetIds: [],
      roiAssetIds: [],
    },
  });
  const asset = {
    id: "report/back/back-normalized-card.png",
    kind: "image",
    fileName: "back-normalized-card.png",
    contentType: "image/png",
    checksumSha256: aiGraderSha256(bytes),
    byteSize: bytes.length,
    side: "back",
    evidenceRole: "normalized_card",
    widthPx: 1000,
    heightPx: 2000,
  };
  const release = sampleRelease();
  release.finalGrade.gradeImpactReasons[0].findingIds = [finding.findingId];
  const baseBundle = sampleBundle({
    visionLab: visionLabWithFindings([finding]),
    assets: [asset],
  });

  const uncalibrated = buildAiGraderProductionStoragePlan({
    reportBundle: baseBundle,
    productionRelease: release,
  });
  const uncalibratedBundle = JSON.parse(
    uncalibrated.artifacts.find((entry) => entry.kind === "report-bundle.json")?.body ?? "{}",
  );
  assert.deepEqual(uncalibratedBundle.calibrationProfile, { isCalibrated: false });
  assert.equal(uncalibratedBundle.defectFindings[0].measurements, undefined);

  const publishWithCalibration = (calibrationVersion, mmPerPixelX, mmPerPixelY) => {
    const plan = buildAiGraderProductionStoragePlan({
      reportBundle: {
        ...baseBundle,
        calibrationProfile: {
          isCalibrated: true,
          calibrationVersion,
          coordinateFrame: "normalized_card_portrait_pixels",
          mmPerPixelX,
          mmPerPixelY,
        },
      },
      productionRelease: release,
    });
    return JSON.parse(plan.artifacts.find((entry) => entry.kind === "report-bundle.json")?.body ?? "{}");
  };

  const first = publishWithCalibration("cal-v1", 0.01, 0.02);
  assert.deepEqual(first.defectFindings[0].measurements, {
    lengthMm: 5,
    widthMm: 2.5,
    calibrationVersion: "cal-v1",
  });
  assert.equal(first.publicAssets[0].widthPx, 1000);
  assert.equal(first.publicAssets[0].heightPx, 2000);

  const recalibrated = publishWithCalibration("cal-v2", 0.02, 0.03);
  assert.deepEqual(recalibrated.defectFindings[0].measurements, {
    lengthMm: 7.5,
    widthMm: 5,
    calibrationVersion: "cal-v2",
  });
  assert.equal(finding.measurements, undefined, "the stored fraction-only finding is not mutated");
});

test("v0.2 republish keeps top-level findings and re-derives measurements for the current calibration", () => {
  const bytes = Buffer.from("normalized-card");
  const finding = sampleDefectFinding({
    evidence: {
      trueViewAssetId: "report/back/back-normalized-card.png",
      channelAssetIds: [],
      roiAssetIds: [],
    },
  });
  const release = sampleRelease();
  release.finalGrade.gradeImpactReasons[0].findingIds = [finding.findingId];
  const firstPlan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle({
      calibrationProfile: {
        isCalibrated: true,
        calibrationVersion: "cal-v1",
        coordinateFrame: "normalized_card_portrait_pixels",
        mmPerPixelX: 0.01,
        mmPerPixelY: 0.02,
      },
      visionLab: visionLabWithFindings([finding]),
      assets: [{
        id: "report/back/back-normalized-card.png",
        kind: "image",
        fileName: "back-normalized-card.png",
        contentType: "image/png",
        checksumSha256: aiGraderSha256(bytes),
        byteSize: bytes.length,
        side: "back",
        evidenceRole: "normalized_card",
        widthPx: 1000,
        heightPx: 2000,
      }],
    }),
    productionRelease: release,
  });
  const first = JSON.parse(firstPlan.artifacts.find((entry) => entry.kind === "report-bundle.json")?.body ?? "{}");
  const originalMeasurements = structuredClone(first.defectFindings[0].measurements);

  const republishedPlan = buildAiGraderProductionStoragePlan({
    reportBundle: {
      ...first,
      calibrationProfile: {
        isCalibrated: true,
        calibrationVersion: "cal-v2",
        coordinateFrame: "normalized_card_portrait_pixels",
        mmPerPixelX: 0.02,
        mmPerPixelY: 0.03,
      },
    },
    productionRelease: release,
  });
  const republished = JSON.parse(
    republishedPlan.artifacts.find((entry) => entry.kind === "report-bundle.json")?.body ?? "{}",
  );
  assert.equal(republished.defectFindings.length, 1);
  assert.equal(republished.defectFindings[0].findingId, finding.findingId);
  assert.deepEqual(republished.defectFindings[0].measurements, {
    lengthMm: 7.5,
    widthMm: 5,
    calibrationVersion: "cal-v2",
  });
  assert.deepEqual(first.defectFindings[0].measurements, originalMeasurements, "the prior projection is not mutated");

  const validRead = sanitizeAiGraderPublicReportBundleForRead(republished, {
    expectedReportId: "report-1",
    publicUrlFor: (storageKey) => `https://collect.tenkings.co/storage/${storageKey}`,
  });
  assert.equal(validRead?.defectFindings[0].measurements.calibrationVersion, "cal-v2");
  republished.defectFindings[0].measurements.lengthMm = 7.4;
  assert.equal(
    sanitizeAiGraderPublicReportBundleForRead(republished, {
      expectedReportId: "report-1",
      publicUrlFor: (storageKey) => `https://collect.tenkings.co/storage/${storageKey}`,
    }),
    undefined,
  );
});

test("production projection omits unavailable grading elements instead of inventing values", () => {
  const release = sampleRelease();
  release.finalGrade.elements = { surface: release.finalGrade.elements.surface };
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle(),
    productionRelease: release,
  });
  const published = JSON.parse(plan.artifacts.find((entry) => entry.kind === "report-bundle.json")?.body ?? "{}");
  assert.deepEqual(Object.keys(published.productionRelease.finalGrade.elements), ["surface"]);
  assert.equal(published.productionRelease.finalGrade.elements.centering, undefined);
});

test("calibrated finding publication fails closed without a complete stamp or pixel frame", () => {
  const bytes = Buffer.from("normalized-card");
  const finding = sampleDefectFinding({
    evidence: {
      trueViewAssetId: "report/back/back-normalized-card.png",
      channelAssetIds: [],
      roiAssetIds: [],
    },
  });
  const release = sampleRelease();
  release.finalGrade.gradeImpactReasons[0].findingIds = [finding.findingId];
  const asset = {
    id: "report/back/back-normalized-card.png",
    kind: "image",
    fileName: "back-normalized-card.png",
    contentType: "image/png",
    checksumSha256: aiGraderSha256(bytes),
    byteSize: bytes.length,
    side: "back",
    evidenceRole: "normalized_card",
  };
  const reportBundle = sampleBundle({
    calibrationProfile: {
      isCalibrated: true,
      calibrationVersion: "cal-v1",
      coordinateFrame: "normalized_card_portrait_pixels",
      mmPerPixelX: 0.01,
      mmPerPixelY: 0.01,
    },
    visionLab: visionLabWithFindings([finding]),
    assets: [asset],
  });
  assert.throws(
    () => buildAiGraderProductionStoragePlan({ reportBundle, productionRelease: release }),
    /normalized image dimensions/,
  );
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: {
        ...reportBundle,
        calibrationProfile: { isCalibrated: true, mmPerPixelX: 0.01, mmPerPixelY: 0.01 },
      },
      productionRelease: release,
    }),
    /complete versioned normalized-card calibration profile/,
  );
});

test("publication rejects unauthorized claims and failed finding extraction", () => {
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({ certifiedClaim: true }),
      productionRelease: sampleRelease(),
    }),
    /certification claims are not authorized/,
  );
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle(),
      productionRelease: sampleRelease({ certificateGenerated: true }),
    }),
    /certification claims are not authorized/,
  );
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({
        visionLab: {
          findingValidation: {
            status: "invalid",
            sourceCandidateCount: 1,
            publishedFindingCount: 0,
            issues: [{ path: "visionLab.candidates[0].geometry", message: "fraction is outside the card" }],
          },
        },
      }),
      productionRelease: sampleRelease(),
    }),
    /extraction did not complete cleanly/,
  );
});

test("publication requires extraction validation for versioned finding producers and preserves legacy v0.1", () => {
  const missingValidationShapes = [
    { visionLab: { defectFindings: [] } },
    { visionLab: { findingContractVersion: "ai-grader-defect-finding-v1" } },
    { visionLab: {}, defectFindings: [] },
  ];

  for (const overrides of missingValidationShapes) {
    assert.throws(
      () => buildAiGraderProductionStoragePlan({
        reportBundle: sampleBundle(overrides),
        productionRelease: sampleRelease(),
      }),
      /require a valid extraction status/,
    );
  }

  assert.doesNotThrow(() => buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle({ visionLab: {} }),
    productionRelease: sampleRelease(),
  }));
  assert.doesNotThrow(() => buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle({
      visionLab: {
        candidateCount: 3,
        candidates: [{ id: "legacy-surface-candidate" }],
        gradeImpactCandidates: [{ id: "legacy-grade-impact" }],
        sides: { front: { candidates: [{ id: "legacy-front-candidate" }] } },
      },
      surfaceIntelligence: { back: { candidates: [{ id: "legacy-back-candidate" }] } },
      provisionalGrade: { gradeImpactCandidates: [{ id: "legacy-grade-impact-without-finding-contract" }] },
    }),
    productionRelease: sampleRelease(),
  }));
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: sampleBundle({ schemaVersion: undefined, visionLab: {} }),
      productionRelease: sampleRelease(),
    }),
    /require a valid extraction status/,
  );
});

test("public report read sanitizer returns only integrity-checked storage assets with narrow legacy support", () => {
  const bytes = Buffer.from("image");
  const checksumSha256 = aiGraderSha256(bytes);
  const base = {
    contentType: "image/png",
    checksumSha256,
    byteSize: bytes.length,
    storageKey: "ai-grader/reports/report-1/assets/001-image.png",
    publicUrl: "https://cdn.tenkings.test/ai-grader/reports/report-1/assets/001-image.png",
  };
  const sanitized = sanitizeAiGraderPublicReportBundleForRead({
    schemaVersion: "ai-grader-report-bundle-v0.1",
    reportId: "report-1",
    generatedAt: "2026-07-02T12:00:00.000Z",
    certifiedClaim: false,
    assets: [
      { ...base, id: "front-image:1" },
      { ...base, id: "C:\\capture\\image.png" },
      { ...base, id: "safe-but-wrong-url.png", publicUrl: "https://tracker.example.test/pixel.png" },
      {
        ...base,
        id: "reconstructed-url.png",
        storageKey: "ai-grader/reports/report-1/assets/002-image.png",
        publicUrl: "https://tracker.example.test/ai-grader/reports/report-1/assets/002-image.png",
      },
      {
        ...base,
        id: "cross-report.png",
        storageKey: "ai-grader/reports/report-2/assets/001-image.png",
        publicUrl: "https://cdn.tenkings.test/ai-grader/reports/report-2/assets/001-image.png",
      },
      { ...base, id: "missing-integrity.png", checksumSha256: undefined },
    ],
    visionLab: {},
  });
  assert.deepEqual(sanitized?.publicAssets.map((asset) => asset.id), ["front-image:1", "reconstructed-url.png"]);
  assert.equal(sanitized?.publicAssets[1].publicUrl, "/storage/ai-grader/reports/report-1/assets/002-image.png");
  assert.deepEqual(sanitized?.assets, sanitized?.publicAssets);
  assert.equal(
    sanitizeAiGraderPublicReportBundleForRead(
      { reportId: "report-2", assets: [], visionLab: {} },
      { expectedReportId: "report-1" },
    ),
    undefined,
  );
});

test("public report read validates canonical storage locators, then recursively removes them without mutating v0.2 or legacy packages", () => {
  const bytes = Buffer.from("public-read-normalized-card");
  const reportBundle = sampleBundle({
    assets: [{
      id: "report/front/normalized-card.png",
      kind: "image",
      fileName: "normalized-card.png",
      contentType: "image/png",
      checksumSha256: aiGraderSha256(bytes),
      byteSize: bytes.length,
      side: "front",
      evidenceRole: "normalized_card",
    }],
    geometry: {
      front: {
        placementState: "ready",
        storageKey: "internal-front-geometry-object",
        storage_key: "internal-front-geometry-object-variant",
        storageUrl: "https://private-storage.example.test/front",
        storageObjectId: "internal-front-object-id",
        storageBucket: "internal-private-bucket",
        storageBlob: "internal-front-blob",
        artifactKeys: ["internal-front-artifact-key"],
        signedUrl: "https://private-storage.example.test/front?signature=private",
        downloadUrl: "https://private-storage.example.test/download/front",
        providerPrivateIdentifier: "internal-provider-private-id",
        serpApiSearchId: "internal-serp-search-id",
        openAiOperationName: "internal-openai-operation",
        providerId: "internal-provider-id",
        helperBridgeUrl: "https://internal-bridge.example.test/session",
        requestHeaders: {
          cookie: "internal-cookie",
          authorization: "internal-authorization-header",
        },
        opaquePayload: "cHJpdmF0ZS1vcGFxdWUtcGF5bG9hZA==",
        encodedImage: "cHJpdmF0ZS1lbmNvZGVkLWltYWdl",
        rawStorageReference: "ai-grader/reports/report-1/assets/private-hidden-object.png",
        headerMap: { cookie: "internal-header-cookie" },
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJpbnRlcm5hbCJ9.internal-signature",
        openAiResponseHandle: "internal-openai-handle",
        serpApiSearchReference: "internal-serp-reference",
        source: "s3://internal-bucket/hidden.png",
        objectHandle: "gs://internal-bucket/hidden.png",
        sourceKey: "ai-grader/reports/report-1/assets/internal-source-key.png",
        sourceUrl: "https://internal-bridge.example.test/status",
        opaqueSource: "ai-grader/reports/report-1/report-bundle.json",
        reference: "ai-grader/reports/report-1/production-release.json",
        unixOpaque: "/etc/internal-private-report.json",
        opaqueEnvironmentValues: {
          first: "/var/internal-private-report.json",
          second: "/usr/internal-private-report.json",
          third: "/proc/internal-private-report.json",
          fourth: "/dev/internal-private-report.json",
          fifth: "/bin/internal-private-report.json",
        },
        opaqueTransportValues: {
          first: "Bearer synthetic-internal-bearer-value",
          second: "Basic c3ludGhldGljLWludGVybmFsLWJhc2ljLXZhbHVl",
          third: "x-api-key: synthetic-internal-api-key-value",
        },
        imageContent: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        opaqueData: "aW50ZXJuYWwtb3BhcXVlLWVuY29kZWQtYmluYXJ5LXBheWxvYWQtZm9yLXJlYWRib3VuZGFyeS10ZXN0aW5nLW9ubHk=",
        nested: {
          reportBundleStorageKey: "internal-report-bundle-object",
          privateObjectReference: "internal-private-object-reference",
          objectUri: "s3://internal-bucket/private-object",
          imageBase64: "internal-image-body",
          rawBase64: "internal-raw-body",
          previewBase64: "internal-preview-body",
        },
      },
    },
  });
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease: sampleRelease(),
  });
  const persistedV02 = JSON.parse(plan.artifacts.find((entry) => entry.kind === "report-bundle.json")?.body ?? "{}");
  const persistedV02BeforeRead = JSON.parse(JSON.stringify(persistedV02));
  assert.match(persistedV02.publicAssets[0].storageKey, /^ai-grader\/reports\/report-1\/assets\//);

  const publicV02 = sanitizeAiGraderPublicReportBundleForRead(persistedV02, {
    expectedReportId: "report-1",
    publicUrlFor: (storageKey) => `https://collect.tenkings.co/storage/${storageKey}`,
  });
  assert.equal(publicV02?.schemaVersion, "ai-grader-report-bundle-v0.2");
  assert.equal(Object.hasOwn(publicV02?.publicAssets[0] ?? {}, "storageKey"), false);
  assert.equal(
    publicV02?.publicAssets[0].publicUrl,
    "https://collect.tenkings.co/storage/ai-grader/reports/report-1/assets/001-normalized-card.png",
  );
  const publicV02Serialized = JSON.stringify(publicV02);
  assert.deepEqual(publicStorageLocatorPaths(JSON.parse(publicV02Serialized)), []);
  assert.doesNotMatch(publicV02Serialized, /internal-front-|internal-report-bundle|internal-private-object|internal-openai-operation|internal-provider-id|internal-bridge|internal-cookie|internal-authorization-header|cHJpdmF0ZS1vcGFxdWUtcGF5bG9hZA|cHJpdmF0ZS1lbmNvZGVkLWltYWdl|private-hidden-object|internal-header-cookie|internal-openai-handle|internal-serp-reference|internal-bucket|internal-source-key|report-bundle\.json|production-release\.json|\/(?:etc|var|usr|proc|dev|bin)\/internal-private|synthetic-internal-(?:bearer|api-key)-value|c3ludGhldGljLWludGVybmFsLWJhc2ljLXZhbHVl|iVBORw0KGgo|aW50ZXJuYWwtb3BhcXVlLWVuY29kZWQ/);
  assert.deepEqual(persistedV02, persistedV02BeforeRead, "the canonical persisted bundle remains byte-for-byte equivalent JSON");

  const historicalScoreV02 = structuredClone(persistedV02);
  historicalScoreV02.productionRelease.finalGrade.overall = 0;
  historicalScoreV02.productionRelease.finalGrade.elements.surface.score = 0.5;
  const historicalScoreRead = sanitizeAiGraderPublicReportBundleForRead(historicalScoreV02, {
    expectedReportId: "report-1",
    publicUrlFor: (storageKey) => `https://collect.tenkings.co/storage/${storageKey}`,
  });
  assert.equal(historicalScoreRead?.productionRelease.finalGrade.overall, 0);
  assert.equal(historicalScoreRead?.productionRelease.finalGrade.elements.surface.score, 0.5);

  const legacyAsset = {
    id: "legacy/front.png",
    kind: "report-image",
    fileName: "front.png",
    contentType: "image/png",
    storageKey: "ai-grader/reports/legacy-report/assets/001-front.png",
    checksumSha256: aiGraderSha256(bytes),
    byteSize: bytes.length,
  };
  const legacyBundle = {
    schemaVersion: "ai-grader-report-bundle-v0.1",
    reportId: "legacy-report",
    generatedAt: "2026-07-13T12:00:00.000Z",
    certifiedClaim: false,
    assets: [legacyAsset],
    reportBundleStorageKey: "legacy-internal-report-bundle",
    storageKeyPrefix: "legacy-internal-prefix",
    productionRelease: {
      productionReleaseStorageKey: "legacy-internal-production-release",
      label: {
        labelDataStorageKey: "legacy-internal-label-data",
        labelPreviewKey: "legacy-internal-label-preview",
        nested: { assetManifestStorageKey: "legacy-internal-manifest" },
      },
      slabbedPhotoContract: {
        photos: [{
          storageKey: "legacy-internal-slab",
          privateObjectReference: "legacy-internal-slab-reference",
          publicUrl: "https://collect.tenkings.co/storage/ai-grader/reports/legacy-report/slabbed/front.png",
        }],
      },
    },
    defectEvidence: {
      storagePath: "legacy-internal-defect-path",
      storageObjectId: "legacy-internal-defect-object-id",
      storageBucket: "legacy-internal-defect-bucket",
      storageBlob: "legacy-internal-defect-blob",
      artifactKeys: ["legacy-internal-defect-artifact-key"],
      signedUrl: "https://private-storage.example.test/defect?signature=private",
      downloadUrl: "https://private-storage.example.test/download/defect",
      objectReference: "legacy-internal-defect-reference",
      googleVisionOperationName: "legacy-internal-google-vision-operation",
      providerId: "legacy-internal-provider-id",
      bridgeEndpoint: "https://legacy-internal-bridge.example.test/session",
      headers: { cookie: "legacy-internal-cookie" },
      opaquePayload: "bGVnYWN5LWludGVybmFsLXBheWxvYWQ=",
      encodedImage: "bGVnYWN5LWludGVybmFsLWVuY29kZWQtaW1hZ2U=",
    },
    visionLab: { defectFindings: [] },
  };
  const legacyBeforeRead = JSON.parse(JSON.stringify(legacyBundle));
  for (const versionedBundle of [legacyBundle, (() => {
    const unversioned = JSON.parse(JSON.stringify(legacyBundle));
    delete unversioned.schemaVersion;
    return unversioned;
  })()]) {
    const publicLegacy = sanitizeAiGraderPublicReportBundleForRead(versionedBundle, {
      expectedReportId: "legacy-report",
      publicUrlFor: (storageKey) => `https://collect.tenkings.co/storage/${storageKey}`,
    });
    assert.ok(publicLegacy);
    assert.equal(Object.hasOwn(publicLegacy?.publicAssets[0] ?? {}, "storageKey"), false);
    assert.equal(
      publicLegacy?.publicAssets[0].publicUrl,
      "https://collect.tenkings.co/storage/ai-grader/reports/legacy-report/assets/001-front.png",
    );
    const publicLegacySerialized = JSON.stringify(publicLegacy);
    assert.deepEqual(publicStorageLocatorPaths(JSON.parse(publicLegacySerialized)), []);
    assert.doesNotMatch(publicLegacySerialized, /legacy-internal-|bGVnYWN5LWludGVybmFsLXBheWxvYWQ|bGVnYWN5LWludGVybmFsLWVuY29kZWQ/);
  }
  assert.deepEqual(legacyBundle, legacyBeforeRead, "legacy source data remains untouched by the public projection");
});

test("public report read keeps v0.1 compatibility and rejects corrupt v0.2 projections", () => {
  const legacy = sanitizeAiGraderPublicReportBundleForRead({
    schemaVersion: "ai-grader-report-bundle-v0.1",
    reportId: "legacy-report",
    generatedAt: "2026-07-02T12:00:00.000Z",
    certifiedClaim: false,
    assets: [],
    visionLab: {},
  });
  assert.equal(legacy?.schemaVersion, "ai-grader-report-bundle-v0.1");
  assert.deepEqual(legacy?.visionLab.defectFindings, []);
  assert.equal(
    sanitizeAiGraderPublicReportBundleForRead({
      schemaVersion: "ai-grader-report-bundle-v9.9",
      reportId: "legacy-report",
      generatedAt: "2026-07-02T12:00:00.000Z",
      certifiedClaim: false,
      assets: [],
    }),
    undefined,
  );
  const unversionedLegacy = sanitizeAiGraderPublicReportBundleForRead({
    reportId: "legacy-report",
    assets: [],
    visionLab: {},
  });
  assert.equal(unversionedLegacy?.schemaVersion, undefined);
  assert.equal(unversionedLegacy?.generatedAt, undefined);
  assert.equal(unversionedLegacy?.certifiedClaim, undefined);
  assert.deepEqual(unversionedLegacy?.visionLab.defectFindings, []);
  assert.equal(
    sanitizeAiGraderPublicReportBundleForRead({
      schemaVersion: "ai-grader-report-bundle-v0.1",
      reportId: "legacy-report",
      generatedAt: "2026-07-02T12:00:00.000Z",
      certifiedClaim: true,
      assets: [],
      visionLab: {},
    }),
    undefined,
  );

  const bytes = Buffer.from("normalized-card");
  const finding = sampleDefectFinding({
    evidence: {
      trueViewAssetId: "report/back/back-normalized-card.png",
      channelAssetIds: [],
      roiAssetIds: [],
    },
  });
  const release = sampleRelease();
  release.finalGrade.gradeImpactReasons[0].findingIds = [finding.findingId];
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle({
      visionLab: visionLabWithFindings([finding]),
      assets: [{
        id: "report/back/back-normalized-card.png",
        kind: "image",
        fileName: "back-normalized-card.png",
        contentType: "image/png",
        checksumSha256: aiGraderSha256(bytes),
        byteSize: bytes.length,
        side: "back",
        evidenceRole: "normalized_card",
      }],
    }),
    productionRelease: release,
  });
  const published = JSON.parse(plan.artifacts.find((entry) => entry.kind === "report-bundle.json")?.body ?? "{}");
  const valid = sanitizeAiGraderPublicReportBundleForRead(published, {
    expectedReportId: "report-1",
    publicUrlFor: (storageKey) => `https://collect.tenkings.co/storage/${storageKey}`,
  });
  assert.equal(valid?.schemaVersion, "ai-grader-report-bundle-v0.2");
  assert.equal(valid?.defectFindings[0].geometry.shape.kind, "box");

  published.defectFindings[0].geometry.shape.x = 1.2;
  assert.equal(
    sanitizeAiGraderPublicReportBundleForRead(published, {
      expectedReportId: "report-1",
      publicUrlFor: (storageKey) => `https://collect.tenkings.co/storage/${storageKey}`,
    }),
    undefined,
  );
});

test("strict calibrated v0.3 storage and public reads preserve the complete mathematical bundle", () => {
  const source = sampleV03Bundle();
  const parsedSource = aiGraderReportBundleV03Schema.safeParse(source);
  assert.equal(
    parsedSource.success,
    true,
    "fixture must stay coordinated with the shared strict v0.3 contract",
  );
  assert.deepEqual(
    sampleV03ProductionRelease(source).finalGrade,
    parsedSource.success ? parsedSource.data.productionRelease.finalGrade : undefined,
    "the separate release fixture must preserve the strict parsed Mathematical V1 grade",
  );
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: source,
    productionRelease: sampleV03ProductionRelease(source),
  });
  const stored = JSON.parse(
    plan.artifacts.find((entry) => entry.artifactClass === "report_bundle")?.body ?? "null",
  );

  assert.equal(stored.schemaVersion, "ai-grader-report-bundle-v0.3");
  assert.equal(stored.productionRelease.finalGrade.status, "final_mathematical_grade_v1");
  assert.deepEqual(stored.gradingStandard, source.gradingStandard);
  assert.deepEqual(stored.calibrationProfile, source.calibrationProfile);
  assert.deepEqual(stored.centeringEvidence, source.centeringEvidence);
  assert.deepEqual(stored.defectFindings, source.defectFindings);
  assert.deepEqual(stored.deductionLedger, source.deductionLedger);
  assert.deepEqual(stored.evidenceQualityLimitations, source.evidenceQualityLimitations);
  assert.equal(Object.hasOwn(stored, "assets"), false, "calibrated V1 is never projected into the v0.2 assets alias");
  assert.equal(aiGraderReportBundleV03Schema.safeParse(stored).success, true);

  const confirmPlan = buildAiGraderConfirmCardReferencePlan({
    reportBundle: source,
    productionRelease: sampleV03ProductionRelease(source),
  });
  assert.deepEqual(
    confirmPlan.imageReferences.map((reference) => reference.sourceAssetSide),
    ["front", "back"],
  );

  const publicRead = sanitizeAiGraderPublicReportBundleForRead(stored, {
    expectedReportId: source.reportId,
    publicUrlFor: (storageKey) => `https://collect.tenkings.co/storage/${storageKey}`,
  });
  assert.equal(publicRead?.schemaVersion, "ai-grader-report-bundle-v0.3");
  assert.equal(publicRead?.productionRelease.finalGrade.overall, 10);
  assert.deepEqual(publicRead?.deductionLedger, source.deductionLedger);
  assert.deepEqual(publicRead?.centeringEvidence, source.centeringEvidence);
  assert.equal(publicRead?.publicAssets.length, source.publicAssets.length);
  assert.equal(
    publicRead?.publicAssets.every((asset) => !Object.hasOwn(asset, "storageKey")),
    true,
    "public reads preserve logical evidence while removing private storage locators",
  );
  assert.equal(aiGraderReportBundleV03Schema.safeParse(publicRead).success, true);
});

test("calibrated v0.3 corruption is rejected instead of silently falling back to V0", () => {
  const corruptSource = sampleV03Bundle();
  corruptSource.productionRelease.finalGrade.elements.surface.score = 0;
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: corruptSource,
      productionRelease: sampleV03ProductionRelease(corruptSource),
    }),
    /v0\.3 validation failed/,
  );

  const validSource = sampleV03Bundle();
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: validSource,
    productionRelease: sampleV03ProductionRelease(validSource),
  });
  const corruptStored = JSON.parse(
    plan.artifacts.find((entry) => entry.artifactClass === "report_bundle")?.body ?? "null",
  );
  corruptStored.productionRelease.finalGrade.elements.surface.score = 0;
  assert.equal(
    sanitizeAiGraderPublicReportBundleForRead(corruptStored, {
      expectedReportId: validSource.reportId,
      publicUrlFor: (storageKey) => `https://collect.tenkings.co/storage/${storageKey}`,
    }),
    undefined,
  );

  const mismatchedRelease = sampleV03ProductionRelease(validSource);
  mismatchedRelease.finalGrade.elements.surface.score = 9;
  assert.throws(
    () => buildAiGraderProductionStoragePlan({
      reportBundle: validSource,
      productionRelease: mismatchedRelease,
    }),
    /exact Mathematical V1 release/,
  );
});

test("calibrated V1 release boundary rejects mixed schemas, statuses, labels, and public links", () => {
  const reportBundle = sampleV03Bundle();
  const cases = [
    ["legacy release schema", (release) => { release.schemaVersion = "ai-grader-production-release-v0.1"; }],
    ["wrong final status", (release) => { release.finalStatus = "insufficient_evidence"; }],
    ["wrong Label V1 version", (release) => { release.label.labelVersion = "ten-kings-ai-grader-label-v0"; }],
    ["wrong label report URL", (release) => { release.label.publicReportUrl = "/ai-grader/reports/other"; }],
    ["wrong publication QR URL", (release) => { release.publication.qrPayloadUrl = "/ai-grader/reports/other"; }],
  ];
  for (const [name, mutate] of cases) {
    const release = sampleV03ProductionRelease(reportBundle);
    mutate(release);
    assert.throws(
      () => buildAiGraderProductionStoragePlan({ reportBundle, productionRelease: release }),
      /exact Mathematical V1 release/,
      name,
    );
  }
});

test("immutable Publish authority seals the complete Mathematical V1 calibration and condition evidence", () => {
  const reportBundle = sampleV03Bundle();
  const productionRelease = sampleV03ProductionRelease(reportBundle);
  const authority = buildAiGraderPublishAuthorityRecord({ reportBundle, productionRelease });

  const changedCalibrationAuthority = structuredClone(reportBundle);
  changedCalibrationAuthority.calibrationBundleAuthority.bundleManifestSha256 = "a".repeat(64);
  const calibrationMutationAuthority = buildAiGraderPublishAuthorityRecord({
    reportBundle: changedCalibrationAuthority,
    productionRelease,
  });
  assert.notEqual(calibrationMutationAuthority.digestSha256, authority.digestSha256);

  const changedConditionEvidence = structuredClone(reportBundle);
  changedConditionEvidence.conditionObservationEvidence.corners[0].validEvidenceCoverage = 0.98;
  const conditionMutationAuthority = buildAiGraderPublishAuthorityRecord({
    reportBundle: changedConditionEvidence,
    productionRelease,
  });
  assert.notEqual(conditionMutationAuthority.digestSha256, authority.digestSha256);
  assert.deepEqual(
    authority.projection.report.calibrationBundleAuthority,
    reportBundle.calibrationBundleAuthority,
  );
  assert.deepEqual(
    authority.projection.report.conditionObservationEvidence,
    reportBundle.conditionObservationEvidence,
  );
});

test("calibrated V1 persistence rejects a valid stored report body that differs from the in-memory report", async () => {
  const reportBundle = sampleV03Bundle();
  const productionRelease = sampleV03ProductionRelease(reportBundle);
  const storedBundle = structuredClone(reportBundle);
  storedBundle.conditionObservationEvidence.edges[0].validEvidenceCoverage = 0.98;
  const storagePlan = buildAiGraderProductionStoragePlan({
    reportBundle: storedBundle,
    productionRelease: sampleV03ProductionRelease(storedBundle),
  });
  const { db, calls } = createMockProductionDb();

  await assert.rejects(
    () => persistAiGraderProductionRelease(db, {
      tenantId: "tenant-1",
      reportBundle,
      productionRelease,
      storagePlan,
      cardAssetId: "card-asset-1",
      itemId: "item-1",
      persistedAt: "2026-07-18T19:00:00.000Z",
    }),
    (error) => error?.code === "AI_GRADER_PUBLISH_LINKAGE_MISMATCH",
  );
  assert.equal(calls.some((call) => call.method === "upsert" || call.method === "updateMany"), false);
});

test("Mathematical V1 calibration readiness is not required for historical bundles", async () => {
  let queried = false;
  const readiness = await readAiGraderMathematicalCalibrationReadiness({
    calibrationSnapshot: {
      async findMany() {
        queried = true;
        return [];
      },
    },
  }, {
    tenantId: "tenant-1",
    reportBundle: sampleBundle(),
    at: "2026-07-18T19:00:00.000Z",
  });

  assert.deepEqual(readiness, { required: false, ready: true, code: "not_required" });
  assert.equal(queried, false, "historical V0 readability must not depend on the new snapshot schema");
});

test("Mathematical V1 calibration readiness requires one exact current trusted snapshot", async () => {
  const bundle = sampleV03Bundle();
  const at = new Date("2026-07-18T19:00:00.000Z");
  let query;
  const readiness = await readAiGraderMathematicalCalibrationReadiness({
    calibrationSnapshot: {
      async findMany(args) {
        query = args;
        return [trustedV03CalibrationSnapshot(bundle)];
      },
    },
  }, {
    tenantId: "tenant-1",
    reportBundle: bundle,
    at,
  });

  assert.equal(readiness.required, true);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.code, "ready");
  assert.equal(readiness.snapshotId, "calibration-snapshot-v03");
  assert.deepEqual(readiness.identity, {
    rigId: bundle.calibrationProfile.rigId,
    profileId: bundle.calibrationProfile.profileId,
    calibrationVersion: bundle.calibrationProfile.calibrationVersion,
    profileFinalizedAt: new Date(bundle.calibrationProfile.finalizedAt),
    artifactId: bundle.calibrationProfile.artifactId,
    artifactSha256: bundle.calibrationProfile.artifactSha256,
    thresholdSetId: bundle.gradingStandard.thresholdSetId,
    thresholdSetHash: bundle.gradingStandard.thresholdSetHash,
    bundleSchemaVersion: bundle.calibrationBundleAuthority.schemaVersion,
    bundleManifestSha256: bundle.calibrationBundleAuthority.bundleManifestSha256,
    sourceCaptureManifestSha256: bundle.calibrationBundleAuthority.sourceCaptureManifestSha256,
    memberLedgerSha256: bundle.calibrationBundleAuthority.memberLedgerSha256,
    calibrationBundleAuthority: bundle.calibrationBundleAuthority,
  });
  assert.equal(query.where.rigId, bundle.calibrationProfile.rigId);
  assert.equal(query.where.calibrationType, "MATHEMATICAL_GRADING_V1");
  assert.equal(query.where.mathematicalProfileId, bundle.calibrationProfile.profileId);
  assert.equal(query.where.mathematicalCalibrationVersion, bundle.calibrationProfile.calibrationVersion);
  assert.deepEqual(query.where.mathematicalProfileFinalizedAt, new Date(bundle.calibrationProfile.finalizedAt));
  assert.equal(query.where.mathematicalArtifactId, bundle.calibrationProfile.artifactId);
  assert.equal(query.where.mathematicalArtifactSha256, bundle.calibrationProfile.artifactSha256);
  assert.equal(query.where.mathematicalThresholdSetId, bundle.gradingStandard.thresholdSetId);
  assert.equal(query.where.mathematicalThresholdSetHash, bundle.gradingStandard.thresholdSetHash);
  assert.equal(query.where.mathematicalBundleSchemaVersion, bundle.calibrationBundleAuthority.schemaVersion);
  assert.equal(query.where.mathematicalBundleManifestSha256, bundle.calibrationBundleAuthority.bundleManifestSha256);
  assert.equal(query.where.mathematicalSourceCaptureManifestSha256, bundle.calibrationBundleAuthority.sourceCaptureManifestSha256);
  assert.equal(query.where.mathematicalMemberLedgerSha256, bundle.calibrationBundleAuthority.memberLedgerSha256);
  assert.equal(query.where.trustStatus, "TRUSTED");
  assert.deepEqual(query.where.rig, { is: { tenantId: "tenant-1", status: "ACTIVE" } });
  assert.deepEqual(query.where.OR, [{ validityEndsAt: null }, { validityEndsAt: { gt: at } }]);
  assert.equal(query.where.supersededById, null);
  assert.equal(query.take, 2, "a duplicate exact match must be detected, never selected silently");
});

test("Mathematical V1 calibration readiness fails closed for invalid, absent, ambiguous, or contradictory evidence", async () => {
  const bundle = sampleV03Bundle();
  const at = "2026-07-18T19:00:00.000Z";
  const invalid = structuredClone(bundle);
  invalid.calibrationProfile.artifactSha256 = "not-a-sha256";
  let invalidQueryCount = 0;
  const invalidResult = await readAiGraderMathematicalCalibrationReadiness({
    calibrationSnapshot: {
      async findMany() {
        invalidQueryCount += 1;
        return [];
      },
    },
  }, { tenantId: "tenant-1", reportBundle: invalid, at });
  assert.equal(invalidResult.code, "invalid_report_bundle");
  assert.equal(invalidQueryCount, 0);

  const cases = [
    ["schema_unavailable", undefined],
    ["trusted_snapshot_missing", []],
    ["trusted_snapshot_ambiguous", [
      trustedV03CalibrationSnapshot(bundle),
      trustedV03CalibrationSnapshot(bundle, { id: "calibration-snapshot-v03-duplicate" }),
    ]],
  ];
  for (const [expectedCode, rows] of cases) {
    const db = rows === undefined ? {} : {
      calibrationSnapshot: { async findMany() { return rows; } },
    };
    const result = await readAiGraderMathematicalCalibrationReadiness(
      db,
      { tenantId: "tenant-1", reportBundle: bundle, at },
    );
    assert.equal(result.code, expectedCode);
  }

  const contradictions = [
    { mathematicalArtifactSha256: "d".repeat(64) },
    { mathematicalThresholdSetHash: "e".repeat(64) },
    { mathematicalBundleManifestSha256: "e".repeat(64) },
    { mathematicalMemberLedgerSha256: "e".repeat(64) },
    { artifactChecksums: { calibrationBundleAuthority: {
      ...bundle.calibrationBundleAuthority,
      sourceCaptureManifestSha256: "e".repeat(64),
    } } },
    { trustStatus: "DRAFT", trustedAt: null },
    { validityEndsAt: new Date("2026-07-18T18:59:59.999Z") },
    { supersededById: "newer-snapshot" },
    { rig: { tenantId: "other-tenant", status: "ACTIVE" } },
    { rig: { tenantId: "tenant-1", status: "INACTIVE" } },
  ];
  for (const overrides of contradictions) {
    const result = await readAiGraderMathematicalCalibrationReadiness({
      calibrationSnapshot: {
        async findMany() { return [trustedV03CalibrationSnapshot(bundle, overrides)]; },
      },
    }, { tenantId: "tenant-1", reportBundle: bundle, at });
    assert.equal(result.code, "trusted_snapshot_integrity_mismatch", JSON.stringify(overrides));
  }
});

test("calibrated V1 publication stops before authority reads or mutations without a trusted snapshot", async () => {
  const reportBundle = sampleV03Bundle();
  const productionRelease = sampleV03ProductionRelease(reportBundle);
  const storagePlan = buildAiGraderProductionStoragePlan({ reportBundle, productionRelease });
  const { db, calls } = createMockProductionDb({
    reportBundle,
    productionRelease,
    calibrationSnapshotRows: [],
  });

  await assert.rejects(
    () => persistAiGraderProductionRelease(db, {
      tenantId: "tenant-1",
      reportBundle,
      productionRelease,
      storagePlan,
      cardAssetId: "card-asset-1",
      itemId: "item-1",
      persistedAt: "2026-07-18T19:00:00.000Z",
    }),
    (error) => error?.code === "AI_GRADER_MATHEMATICAL_CALIBRATION_NOT_READY" && error?.statusCode === 409,
  );
  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "$queryRaw.$queryRaw", "calibrationSnapshot.findMany"],
  );
  assert.equal(calls.some((call) => call.method === "findUnique"), false);
  assert.equal(calls.some((call) => call.method === "updateMany" || call.method === "upsert"), false);
});

test("calibrated V1 publication links the exact trusted snapshot to the durable report", async () => {
  const reportBundle = sampleV03Bundle();
  const productionRelease = sampleV03ProductionRelease(reportBundle);
  const storagePlan = buildAiGraderProductionStoragePlan({ reportBundle, productionRelease });
  const durableAuthority = confirmedV03PublishAuthority(reportBundle, productionRelease);
  const { db, calls } = createMockProductionDb({
    reportBundle,
    productionRelease,
    calibrationSnapshotRows: [trustedV03CalibrationSnapshot(reportBundle)],
    ...durableAuthority,
    report: confirmedProductionReport({
      reportId: reportBundle.reportId,
      finalOverallGrade: 10,
    }),
  });

  const result = await persistAiGraderProductionRelease(db, {
    tenantId: "tenant-1",
    reportBundle,
    productionRelease,
    storagePlan,
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    persistedAt: "2026-07-18T19:00:00.000Z",
  });

  assert.equal(result.reportId, reportBundle.reportId);
  const reportUpdate = calls.find(
    (call) => call.delegate === "aiGraderReport" && call.method === "updateMany",
  );
  assert.equal(reportUpdate.args.data.calibrationSnapshotId, "calibration-snapshot-v03");
  const snapshotQuery = calls.find(
    (call) => call.delegate === "calibrationSnapshot" && call.method === "findMany",
  );
  assert.equal(
    snapshotQuery.args.where.mathematicalArtifactSha256,
    reportBundle.calibrationProfile.artifactSha256,
  );
  assert.equal(
    snapshotQuery.args.where.mathematicalThresholdSetHash,
    reportBundle.gradingStandard.thresholdSetHash,
  );
  assert.equal(reportUpdate.args.data.calibrationActivationId, reportBundle.calibrationActivationAuthority.activationId);
  const sessionUpdate = calls.find(
    (call) => call.delegate === "aiGraderSession" && call.method === "updateMany",
  );
  assert.equal(sessionUpdate.args.data.calibrationActivationId, reportBundle.calibrationActivationAuthority.activationId);
  const activationQuery = calls.find(
    (call) => call.delegate === "mathematicalCalibrationActivation" && call.method === "findUnique",
  );
  assert.deepEqual(activationQuery.args.where, { id: reportBundle.calibrationActivationAuthority.activationId });
});

test("new Mathematical V1 persistence requires activation authority while historical stored reports remain readable", async () => {
  const reportBundle = sampleV03Bundle();
  delete reportBundle.calibrationActivationAuthority;
  const parsedHistorical = aiGraderReportBundleV03Schema.safeParse(reportBundle);
  assert.equal(parsedHistorical.success, true, parsedHistorical.success ? "" : JSON.stringify(parsedHistorical.error.issues));
  const productionRelease = sampleV03ProductionRelease(reportBundle);
  const storagePlan = buildAiGraderProductionStoragePlan({ reportBundle, productionRelease });
  const storedHistorical = JSON.parse(
    storagePlan.artifacts.find((artifact) => artifact.kind === "report-bundle.json").body,
  );
  const historicalRead = sanitizeAiGraderPublicReportBundleForRead(storedHistorical, {
    expectedReportId: reportBundle.reportId,
  });
  assert.equal(historicalRead?.schemaVersion, "ai-grader-report-bundle-v0.3");
  assert.equal(historicalRead?.calibrationActivationAuthority, undefined);
  const { db, calls } = createMockProductionDb({
    reportBundle,
    productionRelease,
    calibrationSnapshotRows: [trustedV03CalibrationSnapshot(reportBundle)],
    ...confirmedV03PublishAuthority(reportBundle, productionRelease),
    report: confirmedProductionReport({ reportId: reportBundle.reportId, finalOverallGrade: 10 }),
  });
  await assert.rejects(
    () => persistAiGraderProductionRelease(db, {
      tenantId: "tenant-1",
      reportBundle,
      productionRelease,
      storagePlan,
      cardAssetId: "card-asset-1",
      itemId: "item-1",
      persistedAt: "2026-07-18T19:00:00.000Z",
    }),
    (error) => error?.code === "AI_GRADER_CALIBRATION_ACTIVATION_REQUIRED" && error?.statusCode === 409,
  );
  assert.equal(
    calls.some((call) => call.method === "updateMany" || call.method === "upsert" || call.method === "create"),
    false,
  );
});

test("new Mathematical V1 persistence rejects mismatched and cross-snapshot activation authority", async () => {
  for (const mismatch of ["activation-hash", "cross-snapshot"]) {
    const reportBundle = sampleV03Bundle();
    const exactActivationRow = activatedV03CalibrationActivation(reportBundle);
    if (mismatch === "activation-hash") {
      reportBundle.calibrationActivationAuthority.activationHash = "b".repeat(64);
    } else {
      reportBundle.calibrationActivationAuthority.snapshotId = "different-calibration-snapshot";
    }
    const productionRelease = sampleV03ProductionRelease(reportBundle);
    const storagePlan = buildAiGraderProductionStoragePlan({ reportBundle, productionRelease });
    const { db, calls } = createMockProductionDb({
      reportBundle,
      productionRelease,
      calibrationSnapshotRows: [trustedV03CalibrationSnapshot(reportBundle)],
      calibrationActivationRow: exactActivationRow,
      ...confirmedV03PublishAuthority(reportBundle, productionRelease),
      report: confirmedProductionReport({ reportId: reportBundle.reportId, finalOverallGrade: 10 }),
    });
    await assert.rejects(
      () => persistAiGraderProductionRelease(db, {
        tenantId: "tenant-1",
        reportBundle,
        productionRelease,
        storagePlan,
        cardAssetId: "card-asset-1",
        itemId: "item-1",
        persistedAt: "2026-07-18T19:00:00.000Z",
      }),
      (error) => error?.code === "AI_GRADER_CALIBRATION_ACTIVATION_BINDING_MISMATCH" &&
        error?.statusCode === 409,
      mismatch,
    );
    assert.equal(
      calls.some((call) => call.method === "updateMany" || call.method === "upsert" || call.method === "create"),
      false,
      mismatch,
    );
  }
});
test("calibrated V1 publication rereads and exactly resolves every APPROVED design-reference artifact before mutation", async () => {
  const fixture = sampleV03BundleWithDesignReference();
  const reportBundle = fixture.bundle;
  const productionRelease = sampleV03ProductionRelease(reportBundle);
  const parsedDesignBundle = aiGraderReportBundleV03Schema.safeParse(reportBundle);
  assert.equal(
    parsedDesignBundle.success,
    true,
    parsedDesignBundle.success ? "" : JSON.stringify(parsedDesignBundle.error.issues),
  );
  const storagePlan = buildAiGraderProductionStoragePlan({ reportBundle, productionRelease });
  const common = {
    reportBundle,
    productionRelease,
    calibrationSnapshotRows: [trustedV03CalibrationSnapshot(reportBundle)],
    designReferenceRow: fixture.row,
    ...confirmedV03PublishAuthority(reportBundle, productionRelease),
    report: confirmedProductionReport({ reportId: reportBundle.reportId, finalOverallGrade: 10 }),
  };
  const passing = createMockProductionDb(common);
  const result = await persistAiGraderProductionRelease(passing.db, {
    tenantId: "tenant-1",
    reportBundle,
    productionRelease,
    storagePlan,
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    persistedAt: "2026-07-18T19:00:00.000Z",
  }, {
    readDesignReferenceArtifactBytes: async (key) => {
      assert.equal(key, fixture.row.artifactStorageKey);
      return fixture.bytes;
    },
  });
  assert.equal(result.reportId, reportBundle.reportId);
  const exactQuery = passing.calls.find((call) =>
    call.delegate === "aiGraderDesignReference" && call.method === "findFirst");
  assert.deepEqual(exactQuery.args.where, {
    tenantId: fixture.reference.tenantId,
    setId: fixture.reference.setId,
    programId: fixture.reference.programId,
    cardNumber: fixture.reference.cardNumber,
    variantId: null,
    variantKey: "",
    parallelId: null,
    parallelKey: "",
    side: "front",
    profile: "registered_design_template_v1",
    version: 1,
    artifactSha256: fixture.reference.artifactSha256,
    status: "approved",
  });

  const failing = createMockProductionDb(common);
  await assert.rejects(
    () => persistAiGraderProductionRelease(failing.db, {
      tenantId: "tenant-1",
      reportBundle,
      productionRelease,
      storagePlan,
      cardAssetId: "card-asset-1",
      itemId: "item-1",
      persistedAt: "2026-07-18T19:00:00.000Z",
    }, {
      readDesignReferenceArtifactBytes: async () =>
        Buffer.concat([fixture.bytes, Buffer.from([0])]),
    }),
    (error) => error?.code === "AI_GRADER_DESIGN_REFERENCE_NOT_READY" &&
      error?.statusCode === 409,
  );
  assert.equal(
    failing.calls.some((call) =>
      call.delegate === "aiGraderSession" &&
      (call.method === "findUnique" || call.method === "updateMany")),
    false,
    "changed design-reference bytes must stop publication before durable Confirm reads or mutations",
  );
});

test("production storage plan cannot publish caller-forged hardware timing or OCR mutation claims", () => {
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle({
      captureTiming: {
        schemaVersion: "ten-kings-ai-grader-capture-timing-v1",
        captureProfile: "production_fast",
        targetSideMs: 5000,
        hardwareMeasurement: true,
        events: [],
        phases: [],
        summary: {
          totalFrontMs: 100,
          totalBackMs: 200,
          totalCardMs: 500,
          frontProcessingOverlappedFlip: true,
        },
        target: {
          frontWithinTarget: true,
          backWithinTarget: true,
          fiveSecondsPerSideProven: true,
          hardwareMeasurementRequired: false,
          note: "caller-forged proof",
        },
      },
      ocrPrefill: {
        reportId: "report-1",
        status: "prefill_ready",
        humanConfirmationRequired: false,
        inventoryMutationPerformed: true,
        publishMutationPerformed: true,
        sourceSides: ["front", "back"],
        fields: {
          playerName: {
            value: "Test Player",
            confidence: 0.99,
            reviewRequired: false,
            sources: ["front_ocr"],
          },
        },
        reviewFieldNames: [],
        provenance: {
          ocrEngine: "google_vision_document_text_detection",
          attributeExtractor: "@tenkings/shared/extractCardAttributes",
          setLookupUsed: true,
          setIdentificationUsed: true,
        },
        warnings: [],
      },
    }),
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const bundleArtifact = plan.artifacts.find((artifact) => artifact.kind === "report-bundle.json");
  const publicBundle = JSON.parse(bundleArtifact?.body ?? "{}");

  assert.equal(publicBundle.captureTiming.summary.totalFrontMs, 100);
  assert.equal(publicBundle.captureTiming.summary.totalBackMs, 200);
  assert.equal(publicBundle.captureTiming.hardwareMeasurement, false);
  assert.equal(publicBundle.captureTiming.target.fiveSecondsPerSideProven, false);
  assert.equal(publicBundle.captureTiming.target.hardwareMeasurementRequired, true);
  assert.doesNotMatch(publicBundle.captureTiming.target.note, /caller-forged/);
  assert.equal(publicBundle.ocrPrefill.humanConfirmationRequired, true);
  assert.equal(publicBundle.ocrPrefill.inventoryMutationPerformed, false);
  assert.equal(publicBundle.ocrPrefill.publishMutationPerformed, false);
  assert.equal(publicBundle.ocrPrefill.fields.playerName.reviewRequired, false);
});

test("current AI Grader OCR public contract round-trips every field and bounded provenance", () => {
  const supported = (value, evidenceRef = "google.front.text") => ({
    state: "supported",
    value,
    confidence: 0.9234,
    reviewRequired: false,
    evidenceRefs: [evidenceRef, evidenceRef, "https://unsafe.example/path", ...Array.from({ length: 30 }, (_, index) => `google.front.token.${index}`)],
  });
  const unknown = { state: "unknown", value: null, confidence: 0.2, reviewRequired: true, evidenceRefs: [] };
  const input = {
    reportId: "current-ocr-report",
    status: "prefill_ready",
    sourceSides: ["front", "back", "front"],
    fields: {
      category: supported("sport", "image.front"),
      playerName: supported("Michael Jordan"),
      cardName: unknown,
      year: supported("1996"),
      manufacturer: supported("Fleer"),
      sport: supported("basketball"),
      game: unknown,
      productSet: supported("1996 Fleer Basketball"),
      cardNumber: supported("23"),
      parallel: supported("Base"),
      insert: unknown,
      numbered: supported("12/99"),
      autograph: supported(false, "image.front"),
      memorabilia: supported(true, "image.front"),
    },
    reviewFieldNames: ["cardName", "game", "insert"],
    provenance: {
      ocrEngine: "google_vision_document_text_detection_url_only",
      attributeExtractor: "@tenkings/shared/extractCardAttributes",
      structuredExtractor: "openai_responses_strict_json_schema",
      structuredExtractionModel: "gpt-5.6-sol-2026-07-01",
      setLookupUsed: true,
      setIdentificationUsed: true,
      responseId: "provider-id-must-not-survive",
      totalProviderElapsedMs: 1234,
    },
    warnings: [],
  };

  const normalized = normalizeAiGraderPublicOcrPrefill(input);
  assert.deepEqual(Object.keys(normalized.fields).sort(), Object.keys(input.fields).sort());
  for (const name of Object.keys(input.fields)) {
    assert.equal(normalized.fields[name].state, input.fields[name].state);
    assert.equal(normalized.fields[name].value, input.fields[name].value);
    assert.equal(normalized.fields[name].confidence, Math.round(input.fields[name].confidence * 1000) / 1000);
    assert.equal(normalized.fields[name].reviewRequired, input.fields[name].reviewRequired);
    assert.equal(Array.isArray(normalized.fields[name].evidenceRefs), true);
    assert.equal(normalized.fields[name].evidenceRefs.length <= 24, true);
    assert.equal(normalized.fields[name].evidenceRefs.some((entry) => entry.includes("http")), false);
  }
  assert.deepEqual(normalized.sourceSides, ["front", "back"]);
  assert.deepEqual(normalized.reviewFieldNames, ["cardName", "game", "insert"]);
  assert.equal(normalized.provenance.structuredExtractor, "openai_responses_strict_json_schema");
  assert.equal(normalized.provenance.structuredExtractionModel, "gpt-5.6-sol-2026-07-01");
  assert.equal("responseId" in normalized.provenance, false);
  assert.equal("totalProviderElapsedMs" in normalized.provenance, false);

  const unsafeProvenance = normalizeAiGraderPublicOcrPrefill({
    fields: {},
    provenance: {
      ocrEngine: "data:image/png;base64,private",
      attributeExtractor: "C:\\private\\extractor",
      structuredExtractor: "https://provider.example/private",
      structuredExtractionModel: "../private-model",
    },
  });
  assert.equal(unsafeProvenance.provenance.ocrEngine, "existing_ten_kings_ocr");
  assert.equal(unsafeProvenance.provenance.attributeExtractor, "@tenkings/shared/extractCardAttributes");
  assert.equal("structuredExtractor" in unsafeProvenance.provenance, false);
  assert.equal("structuredExtractionModel" in unsafeProvenance.provenance, false);
});

test("legacy auto and mem OCR fields translate explicitly to autograph and memorabilia", () => {
  const normalized = normalizeAiGraderPublicOcrPrefill({
    fields: {
      auto: { value: true, confidence: 0.8, reviewRequired: false, sources: ["front_ocr"] },
      mem: { value: null, confidence: 0, reviewRequired: true, sources: [] },
    },
    reviewFieldNames: ["mem"],
    provenance: {},
  });
  assert.equal("auto" in normalized.fields, false);
  assert.equal("mem" in normalized.fields, false);
  assert.deepEqual(normalized.fields.autograph, {
    state: "supported",
    value: true,
    confidence: 0.8,
    reviewRequired: false,
    evidenceRefs: ["front_ocr"],
  });
  assert.equal(normalized.fields.memorabilia.state, "unknown");
  assert.deepEqual(normalized.reviewFieldNames, ["memorabilia"]);
});

test("public JSON sanitizer removes local path and loopback fields without dropping evidence refs", () => {
  const sanitized = sanitizeAiGraderPublicJson({
    localReportFolder: "C:\\TenKings\\capture-data\\report",
    reportHtmlPath: "C:\\TenKings\\capture-data\\report\\report.html",
    publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/report-1",
    evidenceRefs: ["front", "back"],
  });

  assert.equal("localReportFolder" in sanitized, false);
  assert.equal("reportHtmlPath" in sanitized, false);
  assert.equal(sanitized.publicReportUrl, "https://collect.tenkings.co/ai-grader/reports/report-1");
  assert.deepEqual(sanitized.evidenceRefs, ["front", "back"]);
});

test("public JSON sanitizer removes private OCR, geometry, signed upload, embedded image, and hardware fields", () => {
  const sanitized = sanitizeAiGraderPublicJson({
    geometry: {
      sourceFrameId: "front-frame-42",
      localOutputPath: "C:\\TenKings\\capture-data\\front-normalized.png",
      corners: { topLeft: { x: 10, y: 20 } },
    },
    captureTiming: { totalCardMs: 12345 },
    ocrPrefill: {
      humanConfirmationRequired: true,
      uploadUrl: "https://storage.example.test/object?X-Amz-Signature=secret",
      bodyBase64: "data:image/png;base64,abc",
      token: "generic-token-must-not-survive",
      nestedCredentials: {
        accessToken: "access-token-must-not-survive",
        apiKey: "api-key-must-not-survive",
        password: "password-must-not-survive",
      },
    },
    hardwareMeasurement: true,
    hardwareControls: { turnOnLeimac: true },
    leimacHost: "10.0.0.4",
    baslerBridgeScript: "C:\\TenKings\\private.ps1",
    stationToken: "local-station-secret",
    bridgeUrl: "http://127.0.0.1:47652",
    namedBridge: "http://dell.local:47652/status",
    internalBridge: "http://grader.internal:47652/status",
    wildcardBridge: "http://0.0.0.0:47652/status",
    ipv6Bridge: "http://[fe80::1]:47652/status",
    privateUrl: "http://169.254.10.20/frame",
    signedSource: "https://storage.example.test/object?X-Amz-Signature=must-not-survive",
    googleSignedSource: "https://storage.example.test/object?X-Goog-Credential=must-not-survive",
    azureSignedSource: "https://storage.example.test/object?sig=must-not-survive",
    embeddedBridgeWarning: "Bridge failed at http://127.0.0.1:3020/status?token=must-not-survive; retry locally.",
    embeddedSignedWarning: "Upload source https://storage.example.test/object?X-Amz-Signature=must-not-survive was rejected.",
    embeddedWindowsPath: "Runner failed while reading C:\\TenKings\\capture-data\\private\\manifest.json.",
    embeddedUnixPath: "Runner failed while reading /var/tmp/ai-grader/private.json.",
    schemeLessLoopback: "Dell bridge 127.0.0.1:3020 did not answer.",
    schemeLessPrivateIp: "Leimac 10.0.0.4:5000 did not answer.",
    schemeLessLocalName: "Station grader.local:47652 did not answer.",
    safePublicWarning: "Public report https://collect.tenkings.co/ai-grader/reports/report-1 is ready.",
    publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/report-1",
  });

  const serialized = JSON.stringify(sanitized);
  assert.match(serialized, /front-frame-42/);
  assert.match(serialized, /totalCardMs/);
  assert.match(serialized, /humanConfirmationRequired/);
  assert.match(serialized, /hardwareMeasurement/);
  assert.doesNotMatch(serialized, /TenKings|\/var\/tmp|X-Amz|X-Goog|must-not-survive|data:image|station-secret|hardwareControls|leimacHost|baslerBridgeScript|127\.0\.0\.1|10\.0\.0\.4|169\.254|dell\.local|grader\.local|grader\.internal|0\.0\.0\.0|fe80/);
  assert.match(serialized, /Public report https:\/\/collect\.tenkings\.co/);
  assert.equal(sanitized.publicReportUrl, "https://collect.tenkings.co/ai-grader/reports/report-1");
});

test("valuation readiness requires final grade and card identity", () => {
  assert.equal(
    computeAiGraderValuationStatus({
      reportBundle: sampleBundle(),
      productionRelease: sampleRelease({ finalGradeComputed: false }),
    }),
    "not_ready_missing_grade"
  );
  assert.equal(
    computeAiGraderValuationStatus({
      reportBundle: sampleBundle({ cardIdentity: {} }),
      productionRelease: sampleRelease(),
    }),
    "not_ready_missing_identity"
  );
  assert.equal(
    computeAiGraderValuationStatus({
      reportBundle: sampleBundle(),
      productionRelease: sampleRelease(),
    }),
    "ready"
  );
});

test("label preview is print-ready HTML with certification claim disabled", () => {
  const html = buildAiGraderLabelPreviewHtml(sampleRelease());
  assert.match(html, /Ten Kings AI Grader/);
  assert.match(html, /8\.6/);
  assert.match(html, /TK-AIG-REPORT1/);
  assert.match(html, /Certification claim disabled/);
  assert.doesNotMatch(html, /Certified Grade/);
});

test("production release persistence updates verified durable records and optional card linkage", async () => {
  const imageBytes = Buffer.from("front");
  const reportBundle = sampleBundle({
    assets: [{
      id: "report/front/front-normalized-card.png",
      kind: "image",
      fileName: "front-normalized-card.png",
      contentType: "image/png",
      checksumSha256: aiGraderSha256(imageBytes),
      byteSize: imageBytes.length,
      widthPx: 1200,
      heightPx: 1680,
      side: "front",
      evidenceRole: "normalized_card",
    }],
  });
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const productionRelease = sampleRelease();
  const { db, calls } = createMockProductionDb({ reportBundle, productionRelease });

  const result = await persistAiGraderProductionRelease(db, {
    tenantId: "tenant-1",
    reportBundle,
    productionRelease: sampleRelease(),
    storagePlan: plan,
    operatorUserId: "user-1",
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    persistedAt: "2026-07-02T12:30:00.000Z",
  });

  assert.equal(result.reportId, "report-1");
  assert.equal(result.queueItemId, RAPID_QUEUE_IDENTITY.queueItemId);
  assert.equal(result.publicationStatus, "published");
  assert.equal(result.evidenceAssetCount, plan.artifacts.length);
  assert.equal(result.cardAssetUpdatedCount, 1);
  assert.equal(result.itemUpdatedCount, 1);
  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`).slice(0, 16),
    [
      "$transaction.$transaction",
      "$queryRaw.$queryRaw",
      "aiGraderSession.findUnique",
      "aiGraderReport.findUnique",
      "cardAsset.findUnique",
      "item.findUnique",
      "aiGraderSession.updateMany",
      "aiGraderReport.findUnique",
      "aiGraderReport.updateMany",
      "aiGraderGrade.upsert",
      "$queryRaw.$queryRaw",
      "aiGraderLabel.findMany",
      "aiGraderLabel.findUnique",
      "aiGraderLabel.upsert",
      "aiGraderPublication.upsert",
      "aiGraderEvidenceAsset.upsert",
    ]
  );
  assert.ok(calls.some((call) => call.delegate === "aiGraderValuation" && call.method === "upsert"));
  const sessionUpdate = calls.find((call) => call.delegate === "aiGraderSession" && call.method === "updateMany");
  for (const field of ["tenantId", "gradingSessionId", "reportId", "cardAssetId", "itemId", "cardIdentity"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(sessionUpdate.args.data, field), false);
  }
  assert.equal(sessionUpdate.args.data.captureSummary.geometry.front.placementState, "ready");
  assert.equal(sessionUpdate.args.data.captureSummary.geometry.front.geometrySource, "detected");
  assert.equal(sessionUpdate.args.data.captureSummary.geometry.front.captureMode, "detected_geometry");
  assert.equal(sessionUpdate.args.data.captureSummary.geometryCaptureDecisions.front.mode, "detected_geometry");
  assert.equal(sessionUpdate.args.data.captureSummary.geometryCaptureDecisions.front.geometrySource, "detected");
  assert.equal(sessionUpdate.args.data.captureSummary.geometryCaptureDecisions.front.captureMode, "automatic_detection");
  assert.equal(sessionUpdate.args.data.captureSummary.geometryCaptureDecisions.front.explicitOperatorAction, false);
  assert.equal(sessionUpdate.args.data.captureSummary.geometryCaptureDecisions.front.detectionUsed, true);
  assert.equal(sessionUpdate.args.data.captureSummary.geometryCaptureDecisions.front.manualOverrideUsed, false);
  assert.equal(sessionUpdate.args.data.captureSummary.geometryCaptureDecisions.front.manualBoundaryRect, undefined);
  assert.doesNotMatch(
    JSON.stringify(sessionUpdate.args.data.captureSummary),
    /C:\\TenKings|127\.0\.0\.1|must-not-survive|data:image|X-Amz-Signature|stationToken|bridgeUrl|uploadUrl|hardwareControls|leimacOn/
  );
  assert.equal(sessionUpdate.args.data.captureSummary.captureTiming.summary.totalFrontMs, 4700);
  assert.equal(sessionUpdate.args.data.captureSummary.captureTiming.target.fiveSecondsPerSideProven, false);
  assert.equal(sessionUpdate.args.data.captureSummary.ocrPrefill.humanConfirmationRequired, true);
  assert.equal(sessionUpdate.args.data.captureSummary.ocrPrefill.fields.playerName.value, "Test Player");
  const cardUpdate = calls.find((call) => call.delegate === "cardAsset" && call.method === "updateMany");
  assert.equal(cardUpdate.args.data.aiGradeFinal, 8.6);
  assert.equal(cardUpdate.args.data.aiGradeLabel, "8.6");
  assert.equal(cardUpdate.args.data.status, "READY");
  assert.equal(cardUpdate.args.data.storageKey, plan.artifacts.find((artifact) => artifact.artifactClass === "report_asset").storageKey);
  assert.equal(cardUpdate.args.data.imageUrl, plan.artifacts.find((artifact) => artifact.artifactClass === "report_asset").publicUrl);
  assert.deepEqual(
    cardUpdate.args.data.aiGradingJson.publishAuthority,
    buildAiGraderPublishAuthorityRecord({ reportBundle, productionRelease }),
  );
  assert.deepEqual(cardUpdate.args.data.aiGradingJson.rapidQueueIdentity, RAPID_QUEUE_IDENTITY);
  const itemUpdate = calls.find((call) => call.delegate === "item" && call.method === "updateMany");
  assert.equal(calls.some((call) => call.delegate === "item" && call.method === "findUnique"), true);
  assert.equal(itemUpdate.args.data.detailsJson.existingItemDetail, "keep-me");
  assert.deepEqual(itemUpdate.args.data.detailsJson.nestedItemDetail, { preserved: true });
  assert.equal(itemUpdate.args.data.detailsJson.aiGraderReportId, "report-1");
  assert.deepEqual(itemUpdate.args.data.detailsJson.aiGraderRapidQueueIdentity, RAPID_QUEUE_IDENTITY);
  assert.equal(itemUpdate.args.data.imageUrl, cardUpdate.args.data.imageUrl);
});

test("atomic publish creates the first hosted report and Finish valuation only after durable CardAsset linkage", async () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const { db, calls } = createMockProductionDb({
    report: null,
    reportBundle,
    productionRelease,
  });

  const result = await persistAiGraderProductionRelease(db, {
    tenantId: "tenant-1",
    reportBundle,
    productionRelease,
    storagePlan: plan,
    operatorUserId: "user-1",
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    persistedAt: "2026-07-18T12:30:00.000Z",
  });

  const hostedReportCreate = calls.find((call) => call.delegate === "aiGraderReport" && call.method === "create");
  assert.equal(result.publicationStatus, "published");
  assert.equal(result.queueItemId, RAPID_QUEUE_IDENTITY.queueItemId);
  assert.equal(hostedReportCreate.args.data.reportId, "report-1");
  assert.equal(hostedReportCreate.args.data.publicationStatus, "published");
  assert.deepEqual(hostedReportCreate.args.data.checksumSummary.rapidQueueIdentity, RAPID_QUEUE_IDENTITY);
  assert.equal(calls.some((call) => call.delegate === "aiGraderReport" && call.method === "updateMany"), false);
  const reportCreateIndex = calls.indexOf(hostedReportCreate);
  const valuationIndex = calls.findIndex((call) => call.delegate === "aiGraderValuation" && call.method === "upsert");
  const labelIndex = calls.findIndex((call) => call.delegate === "aiGraderLabel" && call.method === "upsert");
  assert.ok(reportCreateIndex > calls.findIndex((call) => call.delegate === "aiGraderSession" && call.method === "updateMany"));
  assert.ok(valuationIndex > reportCreateIndex);
  assert.ok(labelIndex > reportCreateIndex);
  const atomicWrites = calls.filter((call) => ["create", "upsert", "updateMany"].includes(call.method));
  assert.ok(atomicWrites.length > 0);
  assert.equal(
    atomicWrites.every((call) => call.inTransaction === true),
    true,
    "the first hosted report, publication, Finish valuation, and linked updates share one transaction",
  );
});

test("republish preserves an active operator revision and Coming Soon only for the identical source bundle", async () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const sourceBundleSha256 = plan.artifacts.find(
    (artifact) => artifact.kind === "report-bundle.json",
  ).checksumSha256;
  const manualReportRevision = { sourceBundleSha256, revision: 1 };
  const manualReportRevisionAudit = { sourceBundleSha256, sequence: 1 };
  const { db, calls } = createMockProductionDb({
    reportBundle,
    productionRelease,
    report: confirmedProductionReport({
      visibilityStatus: "coming_soon",
      gradeStory: { manualReportRevision, manualReportRevisionAudit },
    }),
  });

  await persistAiGraderProductionRelease(db, {
    tenantId: "tenant-1",
    reportBundle,
    productionRelease,
    storagePlan: plan,
    operatorUserId: "user-1",
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    persistedAt: "2026-07-21T20:00:00.000Z",
  });

  const reportUpdate = calls.find(
    (call) => call.delegate === "aiGraderReport" && call.method === "updateMany",
  );
  assert.equal(reportUpdate.args.data.visibilityStatus, "coming_soon");
  assert.deepEqual(reportUpdate.args.data.gradeStory.manualReportRevision, manualReportRevision);
  assert.deepEqual(
    reportUpdate.args.data.gradeStory.manualReportRevisionAudit,
    manualReportRevisionAudit,
  );
});

test("republish hard-stops when it would orphan an active operator revision", async () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const staleSha256 = "f".repeat(64);
  const { db } = createMockProductionDb({
    reportBundle,
    productionRelease,
    report: confirmedProductionReport({
      visibilityStatus: "public",
      gradeStory: {
        manualReportRevision: { sourceBundleSha256: staleSha256, revision: 1 },
        manualReportRevisionAudit: { sourceBundleSha256: staleSha256, sequence: 1 },
      },
    }),
  });

  await assert.rejects(
    () => persistAiGraderProductionRelease(db, {
      tenantId: "tenant-1",
      reportBundle,
      productionRelease,
      storagePlan: plan,
      operatorUserId: "user-1",
      cardAssetId: "card-asset-1",
      itemId: "item-1",
      persistedAt: "2026-07-21T20:00:00.000Z",
    }),
    /new operator review is required/i,
  );
});

test("atomic publish rejects a cross-queue identity before hosted report or Finish writes", async () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const { db, calls } = createMockProductionDb({
    report: null,
    reportBundle,
    productionRelease,
  });

  await assert.rejects(
    () => persistAiGraderProductionRelease(db, {
      queueItemId: "queue-card-2",
      tenantId: "tenant-1",
      reportBundle,
      productionRelease,
      storagePlan: plan,
      cardAssetId: "card-asset-1",
      itemId: "item-1",
    }),
    /queue identity does not match the durable confirmed queue/i,
  );
  assert.equal(
    calls.some((call) => call.method === "create" || call.method === "upsert" || call.method === "updateMany"),
    false,
  );
});

test("publish authority requires the same stored queue/session/report triple in every existing JSON mirror", async () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const publishAuthority = buildAiGraderPublishAuthorityRecord({ reportBundle, productionRelease });
  const plan = buildAiGraderProductionStoragePlan({ reportBundle, productionRelease });
  const baseCard = {
    id: "card-asset-1",
    batchId: "batch-1",
    aiGradeFinal: 8.6,
    classificationSourcesJson: {
      rapidQueueIdentity: RAPID_QUEUE_IDENTITY,
      aiGraderPublishAuthority: publishAuthority,
    },
    aiGradingJson: {
      rapidQueueIdentity: RAPID_QUEUE_IDENTITY,
      publishAuthority,
    },
  };
  const scenarios = [
    {
      name: "session mirror queue drift",
      options: {
        session: confirmedProductionSession({
          cardIdentity: sampleConfirmedIdentity({
            rapidQueueIdentity: { ...RAPID_QUEUE_IDENTITY, queueItemId: "queue-card-2" },
          }),
        }),
      },
    },
    {
      name: "classification mirror session drift",
      options: {
        cardAsset: {
          ...baseCard,
          classificationSourcesJson: {
            ...baseCard.classificationSourcesJson,
            rapidQueueIdentity: { ...RAPID_QUEUE_IDENTITY, gradingSessionId: "other-session" },
          },
        },
      },
    },
    {
      name: "grading mirror report drift",
      options: {
        cardAsset: {
          ...baseCard,
          aiGradingJson: {
            ...baseCard.aiGradingJson,
            rapidQueueIdentity: { ...RAPID_QUEUE_IDENTITY, reportId: "other-report" },
          },
        },
      },
    },
  ];

  for (const scenario of scenarios) {
    const { db, calls } = createMockProductionDb({
      report: null,
      reportBundle,
      productionRelease,
      ...scenario.options,
    });
    await assert.rejects(
      () => persistAiGraderProductionRelease(db, {
        tenantId: "tenant-1",
        reportBundle,
        productionRelease,
        storagePlan: plan,
        cardAssetId: "card-asset-1",
        itemId: "item-1",
      }),
      /queue identity does not match the durable confirmed queue/i,
      scenario.name,
    );
    assert.equal(
      calls.some((call) => call.method === "create" || call.method === "upsert" || call.method === "updateMany"),
      false,
      scenario.name,
    );
  }
});

test("production persistence rejects cross-tenant or mismatched Confirm authority before publication writes", async () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const cases = [
    { name: "cross tenant session", options: { session: confirmedProductionSession({ tenantId: "other-tenant" }) } },
    { name: "mismatched report session", options: { report: confirmedProductionReport({ sessionId: "other-session-row" }) } },
    { name: "mismatched CardAsset", options: { report: confirmedProductionReport({ cardAssetId: "other-card" }) } },
    { name: "mismatched Item", options: { report: confirmedProductionReport({ itemId: "other-item" }) } },
  ];
  for (const scenario of cases) {
    const { db, calls } = createMockProductionDb(scenario.options);
    await assert.rejects(
      () => persistAiGraderProductionRelease(db, {
        tenantId: "tenant-1",
        reportBundle,
        productionRelease,
        storagePlan: plan,
        cardAssetId: "card-asset-1",
        itemId: "item-1",
      }),
      /durable confirmed report, session, CardAsset, and Item authority/,
      scenario.name,
    );
    assert.equal(calls.some((call) => call.method === "upsert" || call.method === "updateMany"), false, scenario.name);
  }
});

test("immutable Publish authority seals included report fields and ignores only fixed runtime exclusions", () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const authority = buildAiGraderPublishAuthorityRecord({ reportBundle, productionRelease });
  const excludedRuntimeMutation = buildAiGraderPublishAuthorityRecord({
    reportBundle: {
      ...reportBundle,
      cardIdentity: { title: "Runtime identity is controlled separately" },
      productionRelease: { browserOnly: true },
    },
    productionRelease: {
      ...productionRelease,
      cardIdentity: { title: "Runtime identity is controlled separately" },
      label: {
        ...productionRelease.label,
        cardIdentity: { title: "Runtime identity is controlled separately" },
        publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/runtime-only",
        qrPayloadUrl: "https://collect.tenkings.co/ai-grader/reports/runtime-only",
      },
      publication: { status: "published", storageKeyPrefix: "runtime-only/" },
      ebayCompsContract: { status: "completed", compsRefs: [{ id: "runtime-comp" }] },
      slabbedPhotoContract: { status: "complete" },
      cardInventoryLinkage: { status: "inventory_ready" },
    },
  });
  assert.equal(excludedRuntimeMutation.digestSha256, authority.digestSha256);

  const includedMutation = buildAiGraderPublishAuthorityRecord({
    reportBundle,
    productionRelease: {
      ...productionRelease,
      label: { ...productionRelease.label, certId: "TK-AIG-CHANGED" },
    },
  });
  assert.notEqual(includedMutation.digestSha256, authority.digestSha256);
  assert.match(authority.digestSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(AI_GRADER_PUBLISH_AUTHORITY_EXCLUDED_RUNTIME_FIELDS, [
    "report.cardIdentity",
    "report.productionRelease",
    "report.localReportFolder",
    "report.reportHtmlPath",
    "report.manifestPath",
    "report.analysisPath",
    "report.publicPathPlaceholders",
    "report.publicAssets",
    "report.assets[*].localPath",
    "report.assets[*].publicPathPlaceholder",
    "report.assets[*].bodyEncoding",
    "report.assets[*].bodyBase64",
    "report.assets[*].publicUrl",
    "report.assets[*].storageKey",
    "report.assets[*].uploadedAt",
    "release.cardIdentity",
    "release.label.cardIdentity",
    "release.label.publicReportUrl",
    "release.label.qrPayloadUrl",
    "release.label.labelPreviewUrl",
    "release.label.labelDataStorageKey",
    "release.label.labelPreviewKey",
    "release.label.physicalPrintStatus",
    "release.label.labelSheet",
    "release.label.physicalPrint",
    "release.publication",
    "release.databaseIntegration",
    "release.storageIntegration",
    "release.slabbedPhotoContract",
    "release.ebayCompsContract",
    "release.cardInventoryLinkage",
  ]);
  const serialized = JSON.stringify(authority);
  assert.doesNotMatch(serialized, /C:\\TenKings|127\.0\.0\.1|runtime-only|storageKeyPrefix|compsRefs/);
  assert.match(serialized, /finalGrade|operatorFinalization|findingValidation|ocrPrefill|captureTiming/);

  const mixedIds = ["z/asset.png", "A/asset.png", "a-/asset.png", "a_/asset.png", "é/asset.png"];
  const ordered = buildAiGraderPublishAuthorityRecord({
    reportBundle: {
      ...reportBundle,
      assets: mixedIds.map((id) => ({ id, contentType: "image/png", checksumSha256: "a".repeat(64), byteSize: 1 })),
    },
    productionRelease,
  }).projection.report.assets.map((asset) => asset.id);
  assert.deepEqual(ordered, [...mixedIds].sort());
});

test("locked production persistence rejects an immutable package mismatch before publication writes", async () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const { db, calls } = createMockProductionDb();
  await assert.rejects(
    () => persistAiGraderProductionRelease(db, {
      tenantId: "tenant-1",
      reportBundle: {
        ...reportBundle,
        warnings: [...reportBundle.warnings, "Changed after Confirm Card"],
      },
      productionRelease,
      storagePlan: plan,
      cardAssetId: "card-asset-1",
      itemId: "item-1",
    }),
    (error) => error?.code === "AI_GRADER_PUBLISH_PACKAGE_AUTHORITY_MISMATCH",
  );
  assert.equal(
    calls.some((call) => call.method === "upsert" || call.method === "updateMany"),
    false,
  );
});

test("locked production persistence rejects a corrupt stored authority digest before publication writes", async () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const publishAuthority = buildAiGraderPublishAuthorityRecord({ reportBundle, productionRelease });
  const corruptAuthority = { ...publishAuthority, digestSha256: "0".repeat(64) };
  const { db, calls } = createMockProductionDb({
    reportBundle,
    productionRelease,
    cardAsset: {
      id: "card-asset-1",
      batchId: "batch-1",
      classificationSourcesJson: { aiGraderPublishAuthority: corruptAuthority },
      aiGradingJson: { publishAuthority },
    },
  });
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  await assert.rejects(
    () => persistAiGraderProductionRelease(db, {
      tenantId: "tenant-1",
      reportBundle,
      productionRelease,
      storagePlan: plan,
      cardAssetId: "card-asset-1",
      itemId: "item-1",
    }),
    (error) => error?.code === "AI_GRADER_PUBLISH_AUTHORITY_DIGEST_MISMATCH",
  );
  assert.equal(
    calls.some((call) => call.method === "upsert" || call.method === "updateMany"),
    false,
  );
});

test("locked production persistence rejects missing, malformed, or contradictory stored authority", async () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const publishAuthority = buildAiGraderPublishAuthorityRecord({ reportBundle, productionRelease });
  const otherAuthority = buildAiGraderPublishAuthorityRecord({
    reportBundle: { ...reportBundle, warnings: [...reportBundle.warnings, "Contradictory authority"] },
    productionRelease,
  });
  const cases = [
    {
      name: "missing",
      cardAsset: { id: "card-asset-1", batchId: "batch-1", classificationSourcesJson: {}, aiGradingJson: {} },
      code: "AI_GRADER_PUBLISH_AUTHORITY_MISSING",
    },
    {
      name: "malformed",
      cardAsset: {
        id: "card-asset-1",
        batchId: "batch-1",
        classificationSourcesJson: { aiGraderPublishAuthority: { schemaVersion: "wrong" } },
        aiGradingJson: { publishAuthority },
      },
      code: "AI_GRADER_PUBLISH_AUTHORITY_MALFORMED",
    },
    {
      name: "contradictory",
      cardAsset: {
        id: "card-asset-1",
        batchId: "batch-1",
        classificationSourcesJson: { aiGraderPublishAuthority: publishAuthority },
        aiGradingJson: { publishAuthority: otherAuthority },
      },
      code: "AI_GRADER_PUBLISH_AUTHORITY_CONTRADICTORY",
    },
  ];
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  for (const scenario of cases) {
    const { db, calls } = createMockProductionDb({ reportBundle, productionRelease, cardAsset: scenario.cardAsset });
    await assert.rejects(
      () => persistAiGraderProductionRelease(db, {
        tenantId: "tenant-1",
        reportBundle,
        productionRelease,
        storagePlan: plan,
        cardAssetId: "card-asset-1",
        itemId: "item-1",
      }),
      (error) => error?.code === scenario.code,
      scenario.name,
    );
    assert.equal(
      calls.some((call) => call.method === "upsert" || call.method === "updateMany"),
      false,
      scenario.name,
    );
  }
});

test("production persistence never recreates Confirm rows that disappear or rebind after authority resolution", async () => {
  const reportBundle = sampleBundle();
  const productionRelease = sampleRelease();
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle,
    productionRelease,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const cases = [
    {
      name: "session disappeared",
      options: { sessionUpdateMany: { count: 0 } },
      expectedUpdateDelegates: ["aiGraderSession"],
    },
    {
      name: "report rebound",
      options: { reportUpdateMany: { count: 0 } },
      expectedUpdateDelegates: ["aiGraderSession", "aiGraderReport"],
    },
  ];
  for (const scenario of cases) {
    const { db, calls } = createMockProductionDb(scenario.options);
    await assert.rejects(
      () => persistAiGraderProductionRelease(db, {
        tenantId: "tenant-1",
        reportBundle,
        productionRelease,
        storagePlan: plan,
        cardAssetId: "card-asset-1",
        itemId: "item-1",
      }),
      /linkage changed after durable Confirm authority was verified/,
      scenario.name,
    );
    assert.equal(calls.some((call) => call.method === "upsert"), false, scenario.name);
    assert.deepEqual(
      calls.filter((call) => call.method === "updateMany").map((call) => call.delegate),
      scenario.expectedUpdateDelegates,
      scenario.name,
    );
    assert.equal(
      calls.some((call) =>
        ["aiGraderGrade", "aiGraderLabel", "aiGraderPublication", "aiGraderEvidenceAsset", "aiGraderValuation"]
          .includes(call.delegate)
      ),
      false,
      scenario.name,
    );
  }
});

test("production persistence replaces stale browser identity with locked durable Confirm authority", async () => {
  const tampered = "TAMPERED_DB_IDENTITY";
  const reportBundle = sampleBundle({
    cardIdentity: {
      title: tampered,
      set: tampered,
      cardNumber: "999",
      cardAssetId: "card-asset-1",
      itemId: "item-1",
      sideCount: 2,
    },
  });
  const productionRelease = sampleRelease({
    label: {
      ...sampleRelease().label,
      cardIdentity: {
        title: tampered,
        playerName: tampered,
        productSet: tampered,
        cardNumber: "999",
        cardAssetId: "card-asset-1",
        itemId: "item-1",
      },
    },
    cardInventoryLinkage: {
      status: "linked",
      cardAssetId: "card-asset-1",
      itemId: "item-1",
    },
  });
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle(),
    productionRelease,
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const { db, calls } = createMockProductionDb();
  await persistAiGraderProductionRelease(db, {
    tenantId: "tenant-1",
    reportBundle,
    productionRelease,
    storagePlan: plan,
    cardAssetId: "card-asset-1",
    itemId: "item-1",
  });
  const labelUpsert = calls.find((call) => call.delegate === "aiGraderLabel" && call.method === "upsert");
  assert.equal(labelUpsert.args.update.payload.cardIdentity.playerName, "Michael Jordan");
  assert.equal(labelUpsert.args.update.payload.cardIdentity.productSet, "Topps");
  assert.equal(labelUpsert.args.update.payload.cardIdentity.cardNumber, "23");
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(tampered));
});

test("production publish preserves label sheet, print audit, and progressed runtime valuation", async () => {
  const labelSheet = {
    schemaVersion: "ai-grader-label-sheet-v1",
    sheetId: "ai-grader-label-sheet-000012",
    sheetNumber: 12,
    slot: 4,
    capacity: 16,
    assignedAt: "2026-07-09T12:00:00.000Z",
    assignedByUserId: "operator-1",
  };
  const physicalPrint = {
    status: "printed",
    printedAt: "2026-07-09T12:30:00.000Z",
    operatorUserId: "operator-2",
  };
  const { db, calls } = createMockProductionDb({
    existingLabel: {
      payload: {
        labelGradeText: "PENDING",
        retainedOperationalDetail: "keep-me",
        labelSheet,
        physicalPrint,
      },
    },
    existingValuation: {
      status: "completed",
      source: "ebay_sold",
      searchQuery: "1996 Test Card sold",
      valuationMinor: 12500,
      valuationCurrency: "USD",
      compsRefs: [{ id: "selected-comp-1", price: "$125.00" }],
      resultSummary: { selectedCount: 1 },
      requestedByUserId: "operator-2",
      requestedAt: new Date("2026-07-09T12:10:00.000Z"),
      completedAt: new Date("2026-07-09T12:20:00.000Z"),
      errorCode: null,
    },
  });
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
  });

  await persistAiGraderProductionRelease(db, {
    tenantId: "tenant-1",
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    storagePlan: plan,
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    persistedAt: "2026-07-09T13:00:00.000Z",
  });

  const labelUpsert = calls.find((call) => call.delegate === "aiGraderLabel" && call.method === "upsert");
  assert.deepEqual(labelUpsert.args.update.payload.labelSheet, labelSheet);
  assert.deepEqual(labelUpsert.args.update.payload.physicalPrint, physicalPrint);
  assert.equal(labelUpsert.args.update.payload.retainedOperationalDetail, "keep-me");
  assert.equal(labelUpsert.args.update.payload.labelGradeText, "8.6");

  const valuationUpsert = calls.find((call) => call.delegate === "aiGraderValuation" && call.method === "upsert");
  assert.deepEqual(valuationUpsert.args.update, {
    tenantId: "tenant-1",
    sessionId: "db-session-1",
  });
  assert.equal(valuationUpsert.args.create.status, "ready");
});

test("production publish invalidates printed status when printable label content changes", async () => {
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const { db, calls } = createMockProductionDb({
    existingLabel: {
      physicalPrintStatus: "printed",
      labelGradeText: "PENDING",
      qrPayloadUrl: plan.qrPayloadUrl,
      publicReportUrl: plan.publicReportUrl,
      payload: {
        labelSheet: {
          schemaVersion: "ai-grader-label-sheet-v1",
          sheetId: "ai-grader-label-sheet-000012",
          sheetNumber: 12,
          slot: 4,
          capacity: 16,
          assignedAt: "2026-07-09T12:00:00.000Z",
          sealedAt: "2026-07-09T12:20:00.000Z",
          printedAt: "2026-07-09T12:30:00.000Z",
          printedByUserId: "operator-2",
        },
        physicalPrint: {
          status: "printed",
          printedAt: "2026-07-09T12:30:00.000Z",
          operatorUserId: "operator-2",
        },
      },
    },
  });

  await persistAiGraderProductionRelease(db, {
    tenantId: "tenant-1",
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    storagePlan: plan,
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    persistedAt: "2026-07-09T13:00:00.000Z",
  });

  const labelUpsert = calls.find((call) => call.delegate === "aiGraderLabel" && call.method === "upsert");
  assert.equal(labelUpsert.args.update.physicalPrintStatus, "not_printed");
  assert.equal(labelUpsert.args.update.payload.labelSheet.sealedAt, "2026-07-09T12:20:00.000Z");
  assert.equal(labelUpsert.args.update.payload.labelSheet.printedAt, undefined);
  assert.equal(labelUpsert.args.update.payload.labelSheet.printedByUserId, undefined);
  assert.equal(labelUpsert.args.update.payload.physicalPrint.status, "not_printed");
  assert.equal(labelUpsert.args.update.payload.physicalPrint.reason, "printable_label_content_changed");
});

test("production publish preserves a queued ready valuation before background comps starts", async () => {
  const { db, calls } = createMockProductionDb({
    existingValuation: {
      status: "ready",
      source: "ebay_sold",
      searchQuery: "confirmed identity query",
      valuationMinor: null,
      valuationCurrency: "USD",
      compsRefs: null,
      resultSummary: { workflowStatus: "queued", queuedAt: "2026-07-09T12:00:00.000Z" },
      requestedByUserId: "operator-1",
      requestedAt: new Date("2026-07-09T12:00:00.000Z"),
      completedAt: null,
      errorCode: null,
    },
  });
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
  });

  await persistAiGraderProductionRelease(db, {
    tenantId: "tenant-1",
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    storagePlan: plan,
    persistedAt: "2026-07-09T12:01:00.000Z",
  });

  const valuationUpsert = calls.find((call) => call.delegate === "aiGraderValuation" && call.method === "upsert");
  assert.deepEqual(valuationUpsert.args.update, {
    tenantId: "tenant-1",
    sessionId: "db-session-1",
  });
});

test("production release persistence stores actor audit in existing JSON surfaces", async () => {
  const { db, calls } = createMockProductionDb();
  const actorAudit = sampleActorAudit();
  const expectedAudit = {
    actorType: "service_account",
    action: "publish",
    requestedAt: "2026-07-03T12:00:00.000Z",
    userId: null,
    serviceAccountId: "ai-grader-smoke-service",
    role: "ai_grader_service",
  };
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
  });

  await persistAiGraderProductionRelease(db, {
    tenantId: "tenant-1",
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    storagePlan: plan,
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    actorAudit,
    persistedAt: "2026-07-02T12:30:00.000Z",
  });

  const sessionUpdate = calls.find((call) => call.delegate === "aiGraderSession" && call.method === "updateMany");
  assert.deepEqual(sessionUpdate.args.data.safetySummary.actorAudit, expectedAudit);

  const reportUpdate = calls.find((call) => call.delegate === "aiGraderReport" && call.method === "updateMany");
  assert.deepEqual(reportUpdate.args.data.checksumSummary.actorAudit, expectedAudit);

  const gradeUpsert = calls.find((call) => call.delegate === "aiGraderGrade" && call.method === "upsert");
  assert.deepEqual(gradeUpsert.args.create.operatorFinalization.actorAudit, expectedAudit);

  const publicationUpsert = calls.find((call) => call.delegate === "aiGraderPublication" && call.method === "upsert");
  assert.deepEqual(publicationUpsert.args.create.publicationManifest.actorAudit, expectedAudit);

  const evidenceUpsert = calls.find((call) => call.delegate === "aiGraderEvidenceAsset" && call.method === "upsert");
  assert.deepEqual(evidenceUpsert.args.create.metadata.actorAudit, expectedAudit);

  const valuationUpsert = calls.find((call) => call.delegate === "aiGraderValuation" && call.method === "upsert");
  assert.deepEqual(valuationUpsert.args.create.resultSummary.actorAudit, expectedAudit);

  const cardUpdate = calls.find((call) => call.delegate === "cardAsset" && call.method === "updateMany");
  assert.deepEqual(cardUpdate.args.data.aiGradingJson.actorAudit, expectedAudit);

  const itemUpdate = calls.find((call) => call.delegate === "item" && call.method === "updateMany");
  assert.deepEqual(itemUpdate.args.data.detailsJson.aiGraderActorAudit, expectedAudit);
});

test("comps query builder uses selected card identity and final grade", () => {
  const query = buildAiGraderCompsSearchQuery({
    reportBundle: sampleBundle({ cardIdentity: { title: "Fallback Card" } }),
    productionRelease: sampleRelease(),
    selection: {
      source: "item",
      itemId: "item-1",
      title: "1996 Finest Michael Jordan",
      set: "Topps Finest",
      cardNumber: "291",
    },
  });

  assert.match(query, /1996 Finest Michael Jordan/);
  assert.match(query, /#291/);
  assert.match(query, /AI Grade 8\.6/);
});

test("slabbed color photo persistence upserts a separate evidence asset", async () => {
  const { db, calls } = createMockProductionDb();

  const result = await persistAiGraderSlabbedPhotoAsset(db, {
    tenantId: "tenant-1",
    reportId: "report-1",
    side: "front",
    storageKey: "ai-grader/reports/report-1/slabbed/front.png",
    publicUrl: "https://cdn.tenkings.test/ai-grader/reports/report-1/slabbed/front.png",
    mimeType: "image/png",
    byteSize: 1234,
    checksumSha256: "abc123",
    operatorUserId: "admin-1",
    actorAudit: sampleActorAudit({
      actorType: "human_operator",
      action: "upload-slab-photo",
      userId: "admin-1",
      serviceAccountId: null,
      role: "ai_grader_admin",
    }),
    uploadedAt: "2026-07-02T13:00:00.000Z",
  });

  assert.equal(result.reportId, "report-1");
  assert.equal(result.side, "front");
  const evidenceUpsert = calls.find((call) => call.delegate === "aiGraderEvidenceAsset" && call.method === "upsert");
  assert.equal(evidenceUpsert.args.create.artifactClass, "slabbed_photo");
  assert.equal(evidenceUpsert.args.create.kind, "slabbed_front_color_photo");
  assert.equal(evidenceUpsert.args.create.side, "front");
  assert.equal(evidenceUpsert.args.create.publicUrl, "https://cdn.tenkings.test/ai-grader/reports/report-1/slabbed/front.png");
  assert.deepEqual(evidenceUpsert.args.create.metadata.actorAudit, {
    actorType: "human_operator",
    action: "upload-slab-photo",
    requestedAt: "2026-07-03T12:00:00.000Z",
    userId: "admin-1",
    serviceAccountId: null,
    role: "ai_grader_admin",
  });
});

test("valuation persistence records operator-triggered eBay comps result", async () => {
  const { db, calls } = createMockProductionDb();

  const result = await persistAiGraderValuationResult(db, {
    tenantId: "tenant-1",
    reportId: "report-1",
    status: "completed",
    source: "ebay_sold",
    searchQuery: "1996 Finest Michael Jordan #291 AI Grade 8.6",
    compsRefs: [{ id: "comp-1", price: "$100.00" }],
    resultSummary: { valuationMinor: 10000, valuationCurrency: "USD" },
    valuationMinor: 10000,
    valuationCurrency: "USD",
    requestedByUserId: "admin-1",
    actorAudit: sampleActorAudit({
      actorType: "human_operator",
      action: "run-comps",
      userId: "admin-1",
      serviceAccountId: null,
      role: "ai_grader_admin",
    }),
    requestedAt: "2026-07-02T13:05:00.000Z",
    completedAt: "2026-07-02T13:06:00.000Z",
  });

  assert.equal(result.status, "completed");
  const valuationUpsert = calls.find((call) => call.delegate === "aiGraderValuation" && call.method === "upsert");
  assert.equal(valuationUpsert.args.create.status, "completed");
  assert.equal(valuationUpsert.args.create.searchQuery, "1996 Finest Michael Jordan #291 AI Grade 8.6");
  assert.equal(valuationUpsert.args.create.valuationMinor, 10000);
  assert.deepEqual(valuationUpsert.args.create.resultSummary.actorAudit, {
    actorType: "human_operator",
    action: "run-comps",
    requestedAt: "2026-07-03T12:00:00.000Z",
    userId: "admin-1",
    serviceAccountId: null,
    role: "ai_grader_admin",
  });
});
