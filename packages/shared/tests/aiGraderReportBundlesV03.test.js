const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  AI_GRADER_DEFECT_FINDING_V2_VERSION,
  AI_GRADER_REPORT_BUNDLE_V01_VERSION,
  AI_GRADER_REPORT_BUNDLE_V03_VERSION,
  MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
  MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION,
  MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  MATHEMATICAL_FINDING_V1_SCHEMA_VERSION,
  POKEMON_TCG_STANDARD_CORNER_PROFILE,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
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
  canonicalProductOwnerOperationalAcceptanceIssueLedgerV1,
  canonicalProductOwnerOperationalAcceptancePayloadV1,
  validateMathematicalCalibrationProfileV1,
} = require("../dist");

const SHA = "c".repeat(64);

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

function confidence() {
  return {
    score: 0.98,
    band: "high",
    validEvidenceCoverage: 0.99,
    warnings: [],
  };
}

function calibrationProfile(overrides = {}) {
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
      linearMm: { sampleCount: 20, u95: 0.02 },
      areaMm2: { sampleCount: 20, u95: 0.04 },
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
        directionSourceRadiusMm: 100,
        directionPointU95Mm: 0.1,
        flatFieldArtifactId: `flat-field-${index + 1}`,
        flatFieldArtifactSha256: SHA,
        flatFieldFrameCount: 5,
        darkControlFrameCount: 3,
        maxFlatFieldDeviationFraction: 0.02,
        illuminationPatternArtifactId: `illumination-pattern-${index + 1}`,
        illuminationPatternArtifactSha256: SHA,
        illuminationPatternFrameCount: 5,
        responseScale: 1,
      };
    }),
    ...overrides,
  };
}

function centeringAxis(axis) {
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

function centeringSide(side) {
  const allOnAssetId = `${side}/all-on.png`;
  const rawAllOnAssetId = `${side}/raw-all-on.png`;
  const contour = Array.from({ length: 256 }, (_, index) => {
    const corner = [
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
      { x: 1200, y: 1680 },
      { x: 0, y: 1680 },
    ][index % 4];
    return { ...corner };
  });
  const observedArtifact = {
    schemaVersion: "fixed-rig-raw-bound-observed-outer-cut-artifact-v1",
    detectorId: "fixed_rig_raw_outer_cut_detector_v1",
    detectorVersion: "fixed_rig_raw_outer_cut_detector_v1.0.0",
    rawCoordinateFrame: "auto_oriented_raw_image_pixels",
    normalizedCoordinateFrame: "normalized_card_portrait_pixels",
    rawAllOnAssetId,
    rawAllOnAssetSha256: SHA,
    rawAllOnScalarPlaneSha256: SHA,
    rawWidthPx: 1200,
    rawHeightPx: 1680,
    normalizedAllOnAssetId: allOnAssetId,
    normalizedAllOnAssetSha256: SHA,
    normalizedWidthPx: 1200,
    normalizedHeightPx: 1680,
    rawToNormalizedTransformSha256: SHA,
    calibrationProfileId: "fixed-rig-calibration-v1",
    calibrationVersion: "fixed-rig-calibration-2026-07-18",
    calibrationSha256: SHA,
    pixelsPerMmX: 1200 / 63.5,
    pixelsPerMmY: 1680 / 88.9,
    segmentationBoundaryU95Px: 0.8,
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
    confidence: 0.95,
    u95ComponentsMm: {
      calibratedSegmentationBoundary: 0.04,
      rawDetectorLocalization: 0.03,
    },
    u95Mm: 0.05,
    artifactSha256: SHA,
  };
  return {
    side,
    profile: "printed_border_v1",
    score: 10,
    horizontal: centeringAxis("horizontal"),
    vertical: centeringAxis("vertical"),
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
    outerCutGeometryEvidence: {
      coordinateFrame: "normalized_card_portrait_pixels",
      observedContourSha256: SHA,
      intendedContourSha256: SHA,
      intendedBoundaryProfileId: "standard_sports_card_63_50x88_90_r3_18_v1",
      intendedBoundaryProfileVersion: "1.0.0",
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
      boundaryConfidence: 0.95,
      boundaryU95Mm: 0.05,
      observedArtifact,
    },
    evidenceAssetIds: [
      `${side}/outer-cut-contour.png`,
      `${side}/printed-design-contour.png`,
      `${side}/centering-overlay.png`,
      rawAllOnAssetId,
      allOnAssetId,
    ],
  };
}

function location(side, name) {
  return {
    side,
    location: name,
    score: 10,
    penalty: 0,
    findingIds: [],
    confidence: confidence(),
  };
}

function elementScore(element, locationScores = []) {
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
    confidence: confidence(),
    formula: formulas[element],
    explanation: "No condition defect measured beyond U95 and the published Grade-10 tolerance.",
  };
}

function publicAsset(id, side, evidenceRole) {
  return {
    id,
    kind: "report-image",
    fileName: id.split("/").at(-1),
    publicUrl: `/api/ai-grader/reports/report-v03/assets/${id.replaceAll("/", "-")}`,
    sha256: SHA,
    side,
    evidenceRole,
  };
}

function observationAssetId(element, side, location, role) {
  return `${side}/${element}/${location}/${role}.png`;
}

function conditionObservation(element, side, location) {
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
    roiAssetId: observationAssetId(element, side, location, "roi"),
    segmentationMaskAssetId: observationAssetId(element, side, location, "segmentation"),
    confidenceMaskAssetId: observationAssetId(element, side, location, "confidence"),
    illuminationMaskAssetId: observationAssetId(element, side, location, "illumination"),
    channelAssetIds: Array.from(
      { length: 8 },
      (_, index) => `${side}/channels/channel-${index + 1}.png`,
    ),
  };
}

function cleanV03Bundle(overrides = {}) {
  const cornerLocations = ["top_left", "top_right", "bottom_right", "bottom_left"];
  const edgeLocations = ["top", "right", "bottom", "left"];
  const observations = {
    corners: ["front", "back"].flatMap((side) =>
      cornerLocations.map((location) => conditionObservation("corners", side, location))),
    edges: ["front", "back"].flatMap((side) =>
      edgeLocations.map((location) => conditionObservation("edges", side, location))),
  };
  const publicAssets = ["front", "back"].flatMap((side) => [
    publicAsset(`${side}/outer-cut-contour.png`, side, "outer_cut_contour"),
    publicAsset(`${side}/printed-design-contour.png`, side, "printed_design_contour"),
    publicAsset(`${side}/centering-overlay.png`, side, "centering_overlay"),
    publicAsset(`${side}/raw-all-on.png`, side, "other_evidence"),
    publicAsset(`${side}/all-on.png`, side, "other_evidence"),
    ...Array.from(
      { length: 8 },
      (_, index) => publicAsset(`${side}/channels/channel-${index + 1}.png`, side, "directional_channel"),
    ),
    ...[...cornerLocations.map((location) => ["corners", location]), ...edgeLocations.map((location) => ["edges", location])]
      .flatMap(([element, location]) => [
        publicAsset(observationAssetId(element, side, location, "roi"), side, "roi_crop"),
        publicAsset(observationAssetId(element, side, location, "segmentation"), side, "segmentation_mask"),
        publicAsset(observationAssetId(element, side, location, "confidence"), side, "confidence_mask"),
        publicAsset(observationAssetId(element, side, location, "illumination"), side, "illumination_mask"),
      ]),
  ]);
  return {
    schemaVersion: AI_GRADER_REPORT_BUNDLE_V03_VERSION,
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
          centering: elementScore("centering"),
          corners: elementScore("corners", ["front", "back"].flatMap((side) => cornerLocations.map((name) => location(side, name)))),
          edges: elementScore("edges", ["front", "back"].flatMap((side) => edgeLocations.map((name) => location(side, name)))),
          surface: elementScore("surface"),
        },
        confidence: confidence(),
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
    calibrationProfile: calibrationProfile(),
    calibrationBundleAuthority: calibrationBundleAuthority(),
    designReferences: [],
    centeringEvidence: {
      front: centeringSide("front"),
      back: centeringSide("back"),
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
    ...overrides,
  };
}

function ownerAcceptedV03Bundle() {
  const bundle = cleanV03Bundle();
  const profile = {
    ...bundle.calibrationProfile,
    rigId: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.rigId,
    artifactSha256: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.physicalArtifactSha256,
    isCalibrated: false,
    status: "rejected",
    lensResidualPx: 0.8,
  };
  bundle.centeringEvidence.front.outerCutGeometryEvidence.observedArtifact.calibrationSha256 =
    profile.artifactSha256;
  bundle.centeringEvidence.back.outerCutGeometryEvidence.observedArtifact.calibrationSha256 =
    profile.artifactSha256;
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
    decisionAt: "2026-07-22T12:05:00.000Z",
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
  const authority = { ...withoutHash, authoritySha256: "0".repeat(64) };
  authority.authoritySha256 = crypto.createHash("sha256")
    .update(canonicalProductOwnerOperationalAcceptancePayloadV1(authority), "utf8")
    .digest("hex");
  profile.operationalAcceptance = authority;
  bundle.calibrationProfile = profile;
  bundle.calibrationBundleAuthority.members.splice(3, 0, {
    role: "product_owner_operational_acceptance",
    fileName: "product-owner-operational-acceptance-v1.json",
    sha256: crypto.createHash("sha256").update(JSON.stringify(authority), "utf8").digest("hex"),
  });
  bundle.calibrationBundleAuthority.memberLedgerSha256 = crypto.createHash("sha256")
    .update(JSON.stringify(canonical(bundle.calibrationBundleAuthority.members)), "utf8")
    .digest("hex");
  bundle.calibrationActivationAuthority = {
    schemaVersion: "ten-kings-ai-grader-calibration-activation-authority-v1",
    authorityPhase: "ACTIVE",
    activationId: "owner-accepted-activation-v1",
    activationHash: "1".repeat(64),
    activationRevision: "2".repeat(64),
    snapshotId: "owner-accepted-snapshot-v1",
    rigId: profile.rigId,
    bundleManifestSha256: bundle.calibrationBundleAuthority.bundleManifestSha256,
    memberLedgerSha256: bundle.calibrationBundleAuthority.memberLedgerSha256,
    runtimeContextHash: "3".repeat(64),
    rigCharacterizationSha256: profile.artifactSha256,
    operatingContextHash: "4".repeat(64),
    workstationReceiptSha256: "5".repeat(64),
    activatedAt: "2026-07-22T13:00:00.000Z",
    hostedAuthorityKeyId: "6".repeat(64),
    hostedAuthoritySignatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
    hostedAuthorityIssuedAt: "2026-07-22T13:00:00.000Z",
    hostedAuthorityExpiresAt: "2026-07-23T13:00:00.000Z",
    hostedAuthoritySignature: "A".repeat(86),
  };
  return bundle;
}

function pokemonStandardV03Bundle() {
  const bundle = cleanV03Bundle();
  for (const side of ["front", "back"]) {
    const geometry = bundle.centeringEvidence[side].outerCutGeometryEvidence;
    geometry.intendedBoundaryProfileId = "pokemon_tcg_standard";
    geometry.intendedBoundaryProfileVersion = "1.0.0";
    geometry.observedArtifact.intendedBoundaryProfileId = "pokemon_tcg_standard";
    geometry.observedArtifact.intendedBoundaryProfileVersion = "1.0.0";
  }
  const trustedCardFormatAuthority = {
    schemaVersion: "ten-kings-trusted-card-format-authority-v1",
    artifact: {
      resolverVersion: "ten-kings-hosted-card-format-resolver-v1",
      cardIdentity: {
        title: bundle.cardIdentity.title,
        sideCount: 2,
        tenantId: bundle.cardIdentity.tenantId,
        setId: bundle.cardIdentity.setId,
        programId: bundle.cardIdentity.programId,
        cardNumber: bundle.cardIdentity.cardNumber,
        variantId: null,
        parallelId: null,
      },
      formatSelection: {
        game: "pokemon_tcg",
        physicalFormat: "standard",
        widthMm: 63.5,
        heightMm: 88.9,
        profileId: "pokemon_tcg_standard",
        profileVersion: "1.0.0",
        profileArtifactSha256: POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
      },
      sourceRecord: {
        recordType: "hosted_set_card",
        recordId: "hosted-card-42",
        recordUpdatedAt: "2026-07-18T18:30:00.000Z",
        recordSha256: "a".repeat(64),
      },
      identitySourceArtifact: {
        artifactType: "set_taxonomy_source",
        artifactId: "taxonomy-source-42",
        artifactSha256: "b".repeat(64),
        trustStatus: "trusted",
      },
      provenance: {
        authority: "ten_kings_hosted_immutable_card_identity",
        physicalFormatAuthority: "ten_kings_owner_approved_card_format_record",
        browserSelfDeclarationAccepted: false,
      },
    },
    artifactSha256: "d".repeat(64),
    authentication: {
      algorithm: "hmac-sha256",
      keyId: "pokemon-authority-v1",
      signature: "e".repeat(64),
    },
  };
  const tolerance = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST
    .findings.corner_shape_deviation.grade10Tolerance;
  const measurements = ["front", "back"].flatMap((side) =>
    ["top_left", "top_right", "bottom_right", "bottom_left"].map((corner) => ({
      side,
      location: corner,
      profileId: "pokemon_tcg_standard",
      profileVersion: "1.0.0",
      profileArtifactSha256: POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
      expectedRadiusMm: 3.18,
      measuredContourDeviationMm: 0,
      calibratedU95Mm: 0.02,
      effectiveContourDeviationMm: 0,
      grade10ToleranceMm: tolerance,
      thresholdDecision: "within_grade_10_buffer",
      thresholdDeduction: 0,
      appliedContourDeduction: 0,
      measurementId: `${side}-${corner}-contour-deviation`,
      sourceImageAssetId: `${side}/raw-all-on.png`,
      sourceImageSha256: SHA,
      observedContourSha256: SHA,
      intendedContourSha256: SHA,
      contourFindingIds: [],
      damageFindingIds: {
        whitening: [],
        chippingOrMaterialLoss: [],
        deformation: [],
        delamination: [],
        otherVisibleDamage: [],
      },
    })),
  );
  bundle.pokemonStandardCornerAuthority = {
    profile: structuredClone(POKEMON_TCG_STANDARD_CORNER_PROFILE),
    profileArtifactSha256: POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
    trustedCardFormatAuthority,
    productionMeasurementAuthority: {
      schemaVersion: "ten-kings-pokemon-standard-corner-measurement-authority-v1",
      artifact: {
        gradingSessionId: "grading-session-pokemon-42",
        reportId: bundle.reportId,
        analyzerVersions: {
          conditionSegmentation: "fixed_rig_condition_segmentation_v1.2.0",
          cornerMeasurement: "fixed_rig_corner_edge_v1",
          stationAdapter: "fixed_rig_mathematical_station_adapter_v1",
        },
        thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
        thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
        calibration: {
          profileId: bundle.calibrationProfile.profileId,
          version: bundle.calibrationProfile.calibrationVersion,
          artifactSha256: bundle.calibrationProfile.artifactSha256,
          bundleManifestSha256: bundle.calibrationBundleAuthority.bundleManifestSha256,
          sourceCaptureManifestSha256: bundle.calibrationBundleAuthority.sourceCaptureManifestSha256,
          memberLedgerSha256: bundle.calibrationBundleAuthority.memberLedgerSha256,
        },
        callerCreatedProfilesAccepted: false,
        callerCreatedMeasurementsAccepted: false,
        measurements,
      },
      artifactSha256: "f".repeat(64),
      authentication: {
        algorithm: "hmac-sha256",
        keyId: "pokemon-authority-v1",
        signature: "9".repeat(64),
      },
    },
  };
  return bundle;
}

function addReviewedZeroDeductionSurfaceFinding(bundle) {
  const findingId = "surface-clean-buffer-finding-1";
  const physicalDefectId = "surface-clean-buffer-physical-1";
  const measurementId = "surface-clean-buffer-measurement-1";
  const regionId = "front-surface-center";
  const algorithmVersion = "surface_measurement_v1.0.0";
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings.scratch;
  const trueViewAssetId = "front/finding/normalized-card.png";
  const overlayAssetId = "front/finding/deduction-overlay.png";
  const segmentationMaskAssetId = "front/finding/segmentation-mask.png";
  const confidenceMaskAssetId = "front/finding/confidence-mask.png";
  const illuminationMaskAssetId = "front/finding/illumination-mask.png";
  const roiAssetId = "front/finding/roi.png";
  const channelAssetIds = Array.from(
    { length: 8 },
    (_, index) => `front/channels/channel-${index + 1}.png`,
  );
  bundle.publicAssets.push(
    publicAsset(trueViewAssetId, "front", "normalized_card"),
    publicAsset(overlayAssetId, "front", "deduction_overlay"),
    publicAsset(segmentationMaskAssetId, "front", "segmentation_mask"),
    publicAsset(confidenceMaskAssetId, "front", "confidence_mask"),
    publicAsset(illuminationMaskAssetId, "front", "illumination_mask"),
    publicAsset(roiAssetId, "front", "roi_crop"),
  );
  const measurement = buildMathematicalMeasurementV1({
    measurementId,
    kind: policy.primaryMeasurementKind,
    unit: policy.unit,
    measuredMeasurement: 0,
    uncertaintyComponentsU95: {
      pixelMmScale: 0,
      lensDistortion: 0,
      normalizationRegistration: 0,
      repeatedPlacement: 0,
      segmentationBoundary: 0,
      measurementRepeatability: 0.02,
      lightingChannelConfidence: 0,
    },
    explicitGrade10Tolerance: policy.grade10Tolerance,
    calibrationProfileId: bundle.calibrationProfile.profileId,
    calibrationVersion: bundle.calibrationProfile.calibrationVersion,
    algorithmVersion,
    evidence: [{
      assetId: channelAssetIds[0],
      sha256: SHA,
      side: "front",
      role: "directional_channel",
      regionId,
      channelIndex: 1,
    }],
    validEvidenceCoverage: 0.99,
    usableDirectionalChannelCount: 8,
  });
  const calculation = calculateFindingDeductionV1({
    category: "scratch",
    measuredMeasurement: measurement.measuredMeasurement,
    u95: measurement.u95,
  });
  bundle.defectFindings.push({
    schemaVersion: AI_GRADER_DEFECT_FINDING_V2_VERSION,
    mathematicalSchemaVersion: MATHEMATICAL_FINDING_V1_SCHEMA_VERSION,
    findingId,
    physicalDefectId,
    side: "front",
    category: "scratch",
    primaryElement: "surface",
    location: "center",
    regionId,
    detector: {
      id: "surface_measurement_v1",
      version: "1.0.0",
      captureProfileVersion: "fixed_rig_full_forensic_v1",
      algorithmVersion,
    },
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibrationProfileId: bundle.calibrationProfile.profileId,
    calibrationVersion: bundle.calibrationProfile.calibrationVersion,
    severity: { normalized: calculation.normalizedSeverity, band: "low" },
    confidence: 0.99,
    evidenceQuality: "sufficient",
    geometry: {
      coordinateFrame: "normalized_card",
      units: "fraction",
      shape: { kind: "box", x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    },
    evidence: {
      trueViewAssetId,
      overlayAssetId,
      segmentationMaskAssetId,
      confidenceMaskAssetId,
      illuminationMaskAssetId,
      channelAssetIds,
      roiAssetIds: [roiAssetId],
    },
    measurements: [measurement],
    deductionBasisMeasurementId: measurementId,
    deduction: calculation.deduction,
    secondaryEvidenceCategories: [],
    explanation: "A candidate remained inside the certified Grade-10 buffer and deducts zero.",
    review: { status: "confirmed", reviewedAt: "2026-07-18T19:05:00.000Z" },
  });
  bundle.deductionLedger.entries.push({
    findingId,
    physicalDefectId,
    element: "surface",
    category: "scratch",
    measurementId,
    measuredMeasurement: measurement.measuredMeasurement,
    unit: measurement.unit,
    u95: measurement.u95,
    grade10Tolerance: policy.grade10Tolerance,
    effectiveMeasurement: measurement.effectiveMeasurement,
    referenceMeasurement: policy.referenceMeasurement,
    maximumDeduction: policy.maximumDeduction,
    curve: calculation.curve,
    formula: calculation.formula,
    normalizedSeverity: calculation.normalizedSeverity,
    deduction: calculation.deduction,
    evidenceAssetIds: measurement.evidence.map((entry) => entry.assetId),
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    algorithmVersion,
    calibrationProfileId: bundle.calibrationProfile.profileId,
    calibrationVersion: bundle.calibrationProfile.calibrationVersion,
  });
  bundle.productionRelease.finalGrade.elements.surface.findingIds = [findingId];
  return bundle;
}

function registeredAxis(axisName) {
  const horizontal = axisName === "horizontal";
  const marginPx = horizontal ? 600 : 840;
  const marginMm = horizontal ? 31.75 : 44.45;
  const physicalAxisSpanMm = horizontal ? 63.5 : 88.9;
  return {
    ...centeringAxis(axisName),
    marginAPx: marginPx,
    marginBPx: marginPx,
    marginAMm: marginMm,
    marginBMm: marginMm,
    observedMarginAMm: 5,
    observedMarginBMm: 5,
    expectedMarginAMm: 5,
    expectedMarginBMm: 5,
    physicalAxisSpanMm,
    axisErrorMm: 0,
  };
}

function registerFrontDesignReference(bundle) {
  const reference = {
    schemaVersion: MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
    designReferenceId: "approved-front-design-reference-v1",
    profile: "registered_design_template_v1",
    tenantId: bundle.cardIdentity.tenantId,
    setId: bundle.cardIdentity.setId,
    programId: bundle.cardIdentity.programId,
    cardNumber: bundle.cardIdentity.cardNumber,
    variantId: bundle.cardIdentity.variantId,
    parallelId: bundle.cardIdentity.parallelId,
    side: "front",
    artifactId: "approved-front-design-artifact-v1",
    artifactSha256: SHA,
    version: 3,
    widthPx: 1200,
    heightPx: 1680,
    intendedPrintBoundary: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
    approvedBy: "design-approver-1",
    approvedAt: "2026-07-18T18:30:00.000Z",
  };
  const correspondenceLedgerAssetId = "front/registered/correspondence-ledger.json";
  const designReferenceAssetId = "front/registered/approved-design-reference.png";
  const inlierCorrespondenceIds = Array.from(
    { length: 24 },
    (_, index) => `front-correspondence-${index + 1}`,
  );
  const front = bundle.centeringEvidence.front;
  front.profile = "registered_design_template_v1";
  front.horizontal = registeredAxis("horizontal");
  front.vertical = registeredAxis("vertical");
  front.registration = {
    profile: "registered_design_template_v1",
    designReferenceId: reference.designReferenceId,
    designReferenceSha256: reference.artifactSha256,
    transformType: "affine",
    transformMatrix: [1, 0, 0, 0, 1, 0],
    registrationResidualPx: 0.4,
    inlierCount: inlierCorrespondenceIds.length,
    inlierFraction: 1,
    confidence: 0.95,
  };
  front.registrationEvidence = {
    designReferenceId: reference.designReferenceId,
    designReferenceVersion: reference.version,
    designReferenceSha256: reference.artifactSha256,
    normalizedSourceEvidenceId: "front/all-on.png",
    normalizedSourceEvidenceSha256: SHA,
    registrationAlgorithmVersion: "registered_design_registration_v1.0.0",
    correspondenceCount: inlierCorrespondenceIds.length,
    inlierCorrespondenceIds,
    correspondenceLedgerSha256: SHA,
    correspondenceLedgerAssetId,
    registrationSha256: SHA,
  };
  front.evidenceAssetIds.push(correspondenceLedgerAssetId, designReferenceAssetId);
  bundle.designReferences.push(reference);
  bundle.publicAssets.push(
    {
      ...publicAsset(correspondenceLedgerAssetId, "front", "other_evidence"),
      contentType: "application/json",
    },
    publicAsset(designReferenceAssetId, "front", "design_reference"),
  );
  return bundle;
}

test("calibrated v0.3 requires all four exact element scores and complete overlay evidence", () => {
  const bundle = cleanV03Bundle();
  const parsed = aiGraderReportBundleV03Schema.safeParse(bundle);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  assert.equal(aiGraderReportBundleSchema.safeParse(bundle).success, true, "versioned union accepts calibrated v0.3");

  const missingElement = cleanV03Bundle();
  delete missingElement.productionRelease.finalGrade.elements.centering;
  assert.equal(aiGraderReportBundleV03Schema.safeParse(missingElement).success, false);

  const zeroElement = cleanV03Bundle();
  zeroElement.productionRelease.finalGrade.elements.surface.score = 0;
  assert.equal(aiGraderReportBundleV03Schema.safeParse(zeroElement).success, false);

  const missingOverlay = cleanV03Bundle();
  missingOverlay.publicAssets = missingOverlay.publicAssets.filter((asset) => asset.id !== "front/centering-overlay.png");
  assert.equal(aiGraderReportBundleV03Schema.safeParse(missingOverlay).success, false);

  const duplicateCorner = cleanV03Bundle();
  duplicateCorner.productionRelease.finalGrade.elements.corners.locationScores[1].location = "top_left";
  assert.equal(aiGraderReportBundleV03Schema.safeParse(duplicateCorner).success, false);

  const sourceTamper = structuredClone(bundle);
  sourceTamper.centeringEvidence.front.outerCutGeometryEvidence
    .observedArtifact.normalizedAllOnAssetSha256 = "d".repeat(64);
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(sourceTamper).success,
    false,
    "outer-cut source hash tampering must fail closed",
  );

  const calibrationTamper = structuredClone(bundle);
  calibrationTamper.centeringEvidence.back.outerCutGeometryEvidence
    .observedArtifact.calibrationSha256 = "d".repeat(64);
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(calibrationTamper).success,
    false,
    "outer-cut calibration linkage tampering must fail closed",
  );

  const authorityOrderTamper = structuredClone(bundle);
  [
    authorityOrderTamper.calibrationBundleAuthority.members[0],
    authorityOrderTamper.calibrationBundleAuthority.members[1],
  ] = [
    authorityOrderTamper.calibrationBundleAuthority.members[1],
    authorityOrderTamper.calibrationBundleAuthority.members[0],
  ];
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(authorityOrderTamper).success,
    false,
    "calibration bundle authority must retain its exact verified member order",
  );

  const authorityMemberTamper = structuredClone(bundle);
  authorityMemberTamper.calibrationBundleAuthority.members[3].sha256 = "d".repeat(64);
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(authorityMemberTamper).success,
    false,
    "calibration bundle member hashes must remain bound to the finalized profile",
  );
});

test("v0.3 accepts the exact V1.2 calibration authority only as an all-or-nothing contract", () => {
  const bundle = cleanV03Bundle();
  Object.assign(bundle.calibrationBundleAuthority, {
    captureContractVersion: "1.2.0",
    runtimeContextSha256: "d".repeat(64),
    rigCharacterizationSha256: "e".repeat(64),
  });
  const accepted = aiGraderReportBundleV03Schema.safeParse(bundle);
  assert.equal(accepted.success, true, accepted.success ? "" : JSON.stringify(accepted.error.issues));

  for (const field of ["runtimeContextSha256", "rigCharacterizationSha256"]) {
    const partial = structuredClone(bundle);
    delete partial.calibrationBundleAuthority[field];
    assert.equal(
      aiGraderReportBundleV03Schema.safeParse(partial).success,
      false,
      "V1.2 authority missing " + field + " must fail closed",
    );
  }
  const wrongContract = structuredClone(bundle);
  wrongContract.calibrationBundleAuthority.captureContractVersion = "1.1.0";
  assert.equal(aiGraderReportBundleV03Schema.safeParse(wrongContract).success, false);
});

test("v0.3 exposes owner acceptance and the complete mathematical exception ledger", () => {
  const bundle = ownerAcceptedV03Bundle();
  const parsed = aiGraderReportBundleV03Schema.safeParse(bundle);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  assert.equal(parsed.data.calibrationProfile.isCalibrated, false);
  assert.equal(parsed.data.calibrationProfile.status, "rejected");
  assert.equal(
    parsed.data.calibrationProfile.operationalAcceptance.authorityStatus,
    "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS",
  );
  assert.equal(parsed.data.calibrationProfile.operationalAcceptance.exceptionLedger.length, 36);
  assert.equal(
    parsed.data.calibrationBundleAuthority.members[3].role,
    "product_owner_operational_acceptance",
  );
  assert.equal(parsed.data.calibrationActivationAuthority.authorityPhase, "ACTIVE");

  const missingActivation = structuredClone(bundle);
  delete missingActivation.calibrationActivationAuthority;
  assert.equal(aiGraderReportBundleV03Schema.safeParse(missingActivation).success, false);

  for (const [field, value] of [
    ["bundleManifestSha256", "7".repeat(64)],
    ["memberLedgerSha256", "8".repeat(64)],
    ["rigCharacterizationSha256", "9".repeat(64)],
    ["rigId", "another-rig"],
  ]) {
    const mismatchedActivation = structuredClone(bundle);
    mismatchedActivation.calibrationActivationAuthority[field] = value;
    assert.equal(
      aiGraderReportBundleV03Schema.safeParse(mismatchedActivation).success,
      false,
      `owner activation ${field} mismatch must fail closed`,
    );
  }

  const missingIssue = structuredClone(bundle);
  missingIssue.calibrationProfile.operationalAcceptance.exceptionLedger.pop();
  assert.equal(aiGraderReportBundleV03Schema.safeParse(missingIssue).success, false);

  const missingAuthorityMember = structuredClone(bundle);
  missingAuthorityMember.calibrationBundleAuthority.members.splice(3, 1);
  assert.equal(aiGraderReportBundleV03Schema.safeParse(missingAuthorityMember).success, false);

  const substitutedTwelveMember = structuredClone(bundle);
  substitutedTwelveMember.calibrationBundleAuthority = cleanV03Bundle().calibrationBundleAuthority;
  substitutedTwelveMember.calibrationActivationAuthority.bundleManifestSha256 =
    substitutedTwelveMember.calibrationBundleAuthority.bundleManifestSha256;
  substitutedTwelveMember.calibrationActivationAuthority.memberLedgerSha256 =
    substitutedTwelveMember.calibrationBundleAuthority.memberLedgerSha256;
  assert.equal(aiGraderReportBundleV03Schema.safeParse(substitutedTwelveMember).success, false);

  const replayed = structuredClone(bundle);
  replayed.calibrationProfile.profileId = "another-profile";
  assert.equal(aiGraderReportBundleV03Schema.safeParse(replayed).success, false);
});

test("Pokemon standard reports preserve the exact profile, eight independent contours, and source hashes", () => {
  const bundle = pokemonStandardV03Bundle();
  const parsed = aiGraderReportBundleV03Schema.safeParse(bundle);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  assert.equal(parsed.data.pokemonStandardCornerAuthority.profile.cornerRadiusMm, 3.18);
  assert.deepEqual(
    parsed.data.pokemonStandardCornerAuthority.profile.physicalDimensionsMm,
    { height: 88.9, width: 63.5 },
  );
  assert.equal(
    parsed.data.pokemonStandardCornerAuthority.profile.provenance.claimBoundary,
    "not_an_official_pokemon_manufacturer_specification",
  );
  const measurements = parsed.data.pokemonStandardCornerAuthority
    .productionMeasurementAuthority.artifact.measurements;
  assert.equal(new Set(measurements.map((entry) => `${entry.side}:${entry.location}`)).size, 8);
  assert.equal(measurements.every((entry) => entry.sourceImageSha256 === SHA), true);

  const callerProfile = pokemonStandardV03Bundle();
  callerProfile.pokemonStandardCornerAuthority.profile.cornerRadiusMm = 4;
  assert.equal(aiGraderReportBundleV03Schema.safeParse(callerProfile).success, false);

  const callerMeasurement = pokemonStandardV03Bundle();
  callerMeasurement.pokemonStandardCornerAuthority.productionMeasurementAuthority
    .artifact.measurements[0].effectiveContourDeviationMm = 1;
  assert.equal(aiGraderReportBundleV03Schema.safeParse(callerMeasurement).success, false);
});

test("v0.3 final findings require confirmed or adjusted review and an exact deduction formula", () => {
  const reviewed = addReviewedZeroDeductionSurfaceFinding(cleanV03Bundle());
  const parsed = aiGraderReportBundleV03Schema.safeParse(reviewed);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));

  for (const status of ["unreviewed", "rejected"]) {
    const invalid = structuredClone(reviewed);
    invalid.defectFindings[0].review = status === "unreviewed"
      ? { status }
      : { status, reviewedAt: "2026-07-18T19:06:00.000Z" };
    assert.equal(
      aiGraderReportBundleV03Schema.safeParse(invalid).success,
      false,
      `${status} findings cannot enter a final calibrated report`,
    );
  }

  const adjusted = structuredClone(reviewed);
  adjusted.defectFindings[0].review = {
    status: "adjusted",
    reviewedAt: "2026-07-18T19:07:00.000Z",
  };
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(adjusted).success,
    true,
    "an explicitly adjusted and timestamped finding remains eligible",
  );

  const formulaTamper = structuredClone(reviewed);
  formulaTamper.deductionLedger.entries[0].formula = "deduction = maximumDeduction";
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(formulaTamper).success,
    false,
    "the immutable ledger must retain the exact published deduction formula",
  );
});

test("v0.3 registered-template centering binds exact identity, version, and correspondence evidence", () => {
  const registered = registerFrontDesignReference(cleanV03Bundle());
  const parsed = aiGraderReportBundleV03Schema.safeParse(registered);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));

  const missingIdentity = structuredClone(registered);
  delete missingIdentity.cardIdentity.variantId;
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(missingIdentity).success,
    false,
    "registered-template reports require a complete exact card identity key",
  );

  const versionTamper = structuredClone(registered);
  versionTamper.centeringEvidence.front.registrationEvidence.designReferenceVersion += 1;
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(versionTamper).success,
    false,
    "registration evidence must identify the exact approved reference version",
  );

  const correspondenceTamper = structuredClone(registered);
  correspondenceTamper.centeringEvidence.front.registrationEvidence.inlierCorrespondenceIds.pop();
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(correspondenceTamper).success,
    false,
    "the inlier count, fraction, and immutable correspondence ledger must agree",
  );
});

test("v0.3 confidence bands follow the centralized report thresholds", () => {
  const cases = [
    { score: 0.9, band: "high" },
    { score: 0.75, band: "medium" },
    { score: 0.749999, band: "low" },
  ];
  for (const confidence of cases) {
    const bundle = cleanV03Bundle();
    bundle.productionRelease.finalGrade.elements.corners.locationScores[0].confidence = {
      ...confidence,
      validEvidenceCoverage: 0.99,
      warnings: [],
    };
    const parsed = aiGraderReportBundleV03Schema.safeParse(bundle);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  }

  const wrongBand = cleanV03Bundle();
  wrongBand.productionRelease.finalGrade.elements.corners.locationScores[0].confidence = {
    score: 0.6,
    band: "high",
    validEvidenceCoverage: 0.99,
    warnings: [],
  };
  assert.equal(
    aiGraderReportBundleV03Schema.safeParse(wrongBand).success,
    false,
    "report confidence labels cannot drift from centralized policy",
  );
});

test("v0.3 rejects a fake calibration unlock and a weighted/label formula mismatch", () => {
  const fakeCalibration = cleanV03Bundle({
    calibrationProfile: calibrationProfile({ lensResidualPx: 0.8 }),
  });
  assert.equal(aiGraderReportBundleV03Schema.safeParse(fakeCalibration).success, false);

  const formulaMismatch = cleanV03Bundle();
  formulaMismatch.productionRelease.finalGrade.overall = 9.5;
  formulaMismatch.productionRelease.finalGrade.labelGrade = 9.5;
  formulaMismatch.productionRelease.label.labelGradeText = "9.5";
  assert.equal(aiGraderReportBundleV03Schema.safeParse(formulaMismatch).success, false);

  const ungradable = cleanV03Bundle({
    evidenceQualityLimitations: [{
      limitationId: "fully-obscured-1",
      side: "front",
      regionId: "front-center",
      classification: "ungradable",
      validEvidenceCoverage: 0.2,
      excludedPixelFraction: 0.8,
      recoveredFromAlternateChannels: false,
      recaptureRequired: true,
      deduction: 0,
      evidenceAssetIds: ["front/centering-overlay.png"],
      explanation: "Every usable channel is obscured in this region and recapture is required.",
    }],
  });
  assert.equal(aiGraderReportBundleV03Schema.safeParse(ungradable).success, false, "fully obscured evidence cannot receive a false final 10");
});

test("v0.1 historical report readability remains unchanged after adding v0.3", () => {
  const legacy = {
    schemaVersion: AI_GRADER_REPORT_BUNDLE_V01_VERSION,
    generatedAt: "2026-07-10T15:00:00.000Z",
    reportId: "legacy-private-path-report",
    certifiedClaim: false,
    localReportFolder: "C:\\private\\historical-report",
    productionRelease: { oldShape: true },
  };
  const parsed = aiGraderReportBundleSchema.safeParse(legacy);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.localReportFolder, legacy.localReportFolder);
  assert.deepEqual(parsed.data.productionRelease, legacy.productionRelease);
});
