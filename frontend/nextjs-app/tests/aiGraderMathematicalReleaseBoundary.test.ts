import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AI_GRADER_DEFECT_FINDING_V2_VERSION,
  AI_GRADER_REPORT_BUNDLE_V03_VERSION,
  MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
  MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION,
  MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  aiGraderReportBundleV03Schema,
  type AiGraderReportBundleV03,
} from "@tenkings/shared";
import {
  assertAiGraderConfirmCardReady,
  assertAiGraderPublishBundleBoundary,
} from "../lib/server/aiGraderProductionApi";
import { fetchAiGraderStationReportBundle } from "../lib/aiGraderStationBridgeClient";
import { resolveAiGraderAuthoritativeProductionPackage } from "../lib/aiGraderReleaseAuthority";
import { productionAssetManifest } from "../lib/aiGraderProductionAssetManifest";
import { buildAiGraderPublishReadiness } from "../lib/aiGraderOperatorWorkflow";

const SHA = "c".repeat(64);
const confidence = { score: 0.98, band: "high", validEvidenceCoverage: 0.99, warnings: [] };

function canonical(value: unknown): unknown {
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
      fileName: `flat-field-channel-${index + 1}-v1.json`,
      sha256: SHA,
    })),
    { role: "illumination_pattern", fileName: "illumination-pattern-v1.json", sha256: SHA },
  ];
  return {
    schemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
    bundleManifestSha256: SHA,
    sourceCaptureManifestSha256: SHA,
    memberLedgerSha256: createHash("sha256")
      .update(JSON.stringify(canonical(members)), "utf8")
      .digest("hex"),
    members,
  };
}

function asset(id: string, side: "front" | "back", evidenceRole: string, normalized = false) {
  return {
    id,
    kind: "report-image",
    fileName: id.split("/").at(-1),
    contentType: "image/png",
    publicUrl: `/ai-grader/reports/math-v1/assets/${id.replaceAll("/", "-")}`,
    sha256: SHA,
    byteSize: 1000,
    side,
    evidenceRole,
    ...(normalized ? { widthPx: 1200, heightPx: 1680 } : {}),
  };
}

function calibrationProfile() {
  return {
    schemaVersion: MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
    profileId: "calibration-profile-v1",
    calibrationVersion: "calibration-2026-07-18",
    rigId: "fixed-rig-1",
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
    mmPerPixelX: 0.05,
    mmPerPixelY: 0.05,
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
      const angle = 2 * Math.PI * index / 8;
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
  };
}

function axis(axisName: "horizontal" | "vertical") {
  return {
    axis: axisName,
    marginAName: axisName === "horizontal" ? "left" : "top",
    marginBName: axisName === "horizontal" ? "right" : "bottom",
    marginAPx: 100,
    marginBPx: 100,
    marginAMm: 5,
    marginBMm: 5,
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
    grade10ToleranceMm: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.grade10Tolerance.marginDifferenceMm,
    balanceRatio: 100,
    score: 10,
  };
}

function centeringSide(side: "front" | "back") {
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
    rawAllOnAssetSha256: SHA,
    rawAllOnScalarPlaneSha256: SHA,
    rawWidthPx: 1200,
    rawHeightPx: 1680,
    normalizedAllOnAssetId,
    normalizedAllOnAssetSha256: SHA,
    normalizedWidthPx: 1200,
    normalizedHeightPx: 1680,
    rawToNormalizedTransformSha256: SHA,
    calibrationProfileId: "calibration-profile-v1",
    calibrationVersion: "calibration-2026-07-18",
    calibrationSha256: SHA,
    pixelsPerMmX: 20,
    pixelsPerMmY: 20,
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
    horizontal: axis("horizontal"),
    vertical: axis("vertical"),
    outerCutContourAssetId: `${side}/outer.png`,
    printedDesignContourAssetId: `${side}/print.png`,
    measurementOverlayAssetId: `${side}/center.png`,
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
      normalizedAllOnAssetId,
      normalizedAllOnAssetSha256: SHA,
      boundaryConfidence: 0.95,
      boundaryU95Mm: 0.05,
      observedArtifact,
    },
    evidenceAssetIds: [
      `${side}/outer.png`,
      `${side}/print.png`,
      `${side}/center.png`,
      rawAllOnAssetId,
      normalizedAllOnAssetId,
    ],
  };
}

function location(side: "front" | "back", name: string) {
  return { side, location: name, score: 10, penalty: 0, findingIds: [], confidence };
}

function elementScore(formula: string, locationScores: ReturnType<typeof location>[] = []) {
  return {
    score: 10,
    startingScore: 10,
    frontScore: 10,
    backScore: 10,
    aggregatePenalty: 0,
    locationScores,
    findingIds: [],
    confidence,
    formula,
    explanation: "No condition defect measured beyond U95 and the published Grade-10 tolerance.",
  };
}

function observationAssetId(element: "corners" | "edges", side: "front" | "back", locationName: string, role: string) {
  return `${side}/${element}/${locationName}/${role}.png`;
}

function conditionObservation(element: "corners" | "edges", side: "front" | "back", locationName: string) {
  return {
    element,
    side,
    location: locationName,
    regionId: `${side}-${element}-${locationName}`,
    score: 10,
    penalty: 0,
    validEvidenceCoverage: 0.99,
    usableDirectionalChannelCount: 8,
    findingIds: [],
    measurementIds: [],
    roiAssetId: observationAssetId(element, side, locationName, "roi"),
    segmentationMaskAssetId: observationAssetId(element, side, locationName, "segmentation"),
    confidenceMaskAssetId: observationAssetId(element, side, locationName, "confidence"),
    illuminationMaskAssetId: observationAssetId(element, side, locationName, "illumination"),
    channelAssetIds: Array.from({ length: 8 }, (_, index) => `${side}/channels/channel-${index + 1}.png`),
  };
}

function strictBundle(): AiGraderReportBundleV03 {
  const corners = ["top_left", "top_right", "bottom_right", "bottom_left"];
  const edges = ["top", "right", "bottom", "left"];
  const observations = {
    corners: (["front", "back"] as const).flatMap((side) => corners.map((name) => conditionObservation("corners", side, name))),
    edges: (["front", "back"] as const).flatMap((side) => edges.map((name) => conditionObservation("edges", side, name))),
  };
  const publicAssets = (["front", "back"] as const).flatMap((side) => [
    asset(`${side}/normalized.png`, side, "normalized_card", true),
    asset(`${side}/outer.png`, side, "outer_cut_contour"),
    asset(`${side}/print.png`, side, "printed_design_contour"),
    asset(`${side}/center.png`, side, "centering_overlay"),
    asset(`${side}/raw-all-on.png`, side, "other_evidence"),
    asset(`${side}/all-on.png`, side, "other_evidence"),
    ...Array.from({ length: 8 }, (_, index) => asset(`${side}/channels/channel-${index + 1}.png`, side, "directional_channel")),
    ...[
      ...corners.map((name) => ["corners", name] as const),
      ...edges.map((name) => ["edges", name] as const),
    ].flatMap(([element, name]) => [
      asset(observationAssetId(element, side, name, "roi"), side, "roi_crop"),
      asset(observationAssetId(element, side, name, "segmentation"), side, "segmentation_mask"),
      asset(observationAssetId(element, side, name, "confidence"), side, "confidence_mask"),
      asset(observationAssetId(element, side, name, "illumination"), side, "illumination_mask"),
    ]),
  ]);
  return {
    schemaVersion: AI_GRADER_REPORT_BUNDLE_V03_VERSION,
    generatedAt: "2026-07-18T19:00:00.000Z",
    reportId: "math-v1-release-test",
    certifiedClaim: false,
    cardIdentity: { title: "Controlled test card", sideCount: 2, tenantId: "tenant-1", setId: "set-1", programId: "program-1", cardNumber: "1", variantId: null, parallelId: null },
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
          centering: elementScore(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula),
          corners: elementScore(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.formula, (["front", "back"] as const).flatMap((side) => corners.map((name) => location(side, name)))),
          edges: elementScore(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.formula, (["front", "back"] as const).flatMap((side) => edges.map((name) => location(side, name)))),
          surface: elementScore(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surface.formula),
        },
        confidence,
        formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.finalFormula,
        whyNot10: [],
      },
      label: { certId: "CERT-MATH-V1", labelGradeText: "10.0", publicReportUrl: "/ai-grader/reports/math-v1-release-test", qrPayloadUrl: "/ai-grader/reports/math-v1-release-test" },
      publication: { publicReportUrl: "/ai-grader/reports/math-v1-release-test" },
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
    deductionLedger: { schemaVersion: MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION, thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID, thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH, startingScores: { centering: 10, corners: 10, edges: 10, surface: 10 }, entries: [] },
    evidenceQualityLimitations: [],
    publicAssets,
  } as unknown as AiGraderReportBundleV03;
}

function releaseEnvelope(bundle: ReturnType<typeof strictBundle>) {
  const publicReportUrl = bundle.productionRelease.label.publicReportUrl;
  const qrPayloadUrl = bundle.productionRelease.label.qrPayloadUrl;
  return {
    schemaVersion: "ai-grader-mathematical-production-release-v1",
    reportId: bundle.reportId,
    gradingSessionId: "grading-session-1",
    generatedAt: bundle.generatedAt,
    reportStatus: "final_ai_grader_report_v1",
    finalStatus: "final_grade_computed",
    finalGradeComputed: true,
    certifiedClaim: false,
    certificateGenerated: false,
    finalGrade: bundle.productionRelease.finalGrade,
    gates: [{ id: "mathematical-v1", status: "pass", reason: "Strict V1 validation passed.", evidenceRefs: ["calibration-artifact-v1"] }],
    operatorFinalization: { operatorId: "operator-1", finalizedAt: "2026-07-18T19:10:00.000Z", warningsAccepted: false, acceptedWarningGateIds: [] },
    label: {
      ...bundle.productionRelease.label,
      labelVersion: "ten-kings-ai-grader-label-v1",
      reportId: bundle.reportId,
      status: "label_data_ready",
      certificateStatus: "report_id_issued_not_certified",
      elementScores: Object.fromEntries(
        Object.entries(bundle.productionRelease.finalGrade.elements).map(
          ([element, result]) => [element, result.score],
        ),
      ),
      cardIdentity: structuredClone(bundle.cardIdentity),
      certifiedClaim: false,
      publicReportUrl,
      qrPayloadUrl,
    },
    publication: {
      status: "local_bundle_ready",
      reportId: bundle.reportId,
      publicReportUrl,
      qrPayloadUrl,
      storageMode: "local_artifact_only",
      dbWritesPerformed: false,
      migrationsRun: false,
      uploadPerformed: false,
    },
    cardIdentity: structuredClone(bundle.cardIdentity),
    calibrationProfile: structuredClone(bundle.calibrationProfile),
    labelDataGenerated: true,
    qrPayloadGenerated: true,
  };
}

test("strict V0.3 publish and Confirm Card use the mathematical report as authority", () => {
  const bundle = strictBundle();
  assert.equal(aiGraderReportBundleV03Schema.safeParse(bundle).success, true);
  const release = releaseEnvelope(bundle);
  assert.doesNotThrow(() => assertAiGraderPublishBundleBoundary(bundle as any, release as any));
  assert.doesNotThrow(() => assertAiGraderConfirmCardReady({ publicationStatus: "finalized", reportBundle: bundle as any, productionRelease: release as any }));
});

test("V0.3 cannot fall back to V0 when a formula or release grade is altered", () => {
  const bundle = strictBundle();
  const invalidBundle = structuredClone(bundle);
  invalidBundle.productionRelease.finalGrade.elements.centering.score = 9;
  assert.throws(() => assertAiGraderPublishBundleBoundary(invalidBundle as any, releaseEnvelope(bundle) as any), /Mathematical Grading V1 validation failed/);
  const wrongRelease = releaseEnvelope(bundle) as any;
  wrongRelease.finalGrade = { ...wrongRelease.finalGrade, status: "final_ai_grader_grade_v0" };
  assert.throws(() => assertAiGraderConfirmCardReady({ publicationStatus: "finalized", reportBundle: bundle as any, productionRelease: wrongRelease }), /must exactly equal/);
});

test("strict V0.3 Confirm Card requires immutable normalized evidence on both sides", () => {
  const bundle = strictBundle();
  bundle.publicAssets = bundle.publicAssets.filter((entry) => !(entry.side === "back" && entry.evidenceRole === "normalized_card"));
  assert.throws(() => assertAiGraderConfirmCardReady({ publicationStatus: "finalized", reportBundle: bundle as any, productionRelease: releaseEnvelope(strictBundle()) as any }), /Mathematical Grading V1 validation failed|normalized PNG/);
});

test("station transport accepts only a complete strict V0.3 body and preserves public evidence metadata", async () => {
  const bundle = strictBundle();
  const fetchImpl = async () => new Response(JSON.stringify({
    ok: true,
    result: { reportId: bundle.reportId, bundle, source: "immutable-report-package" },
  }), { status: 200, headers: { "content-type": "application/json" } });
  const fetched = await fetchAiGraderStationReportBundle({
    baseUrl: "http://127.0.0.1:47652",
    stationToken: "station-token",
    reportId: bundle.reportId,
  }, fetchImpl as typeof fetch);
  assert.equal(fetched.schemaVersion, AI_GRADER_REPORT_BUNDLE_V03_VERSION);
  assert.equal(productionAssetManifest(fetched).filter((entry) => entry.evidenceRole === "normalized_card").length, 2);

  const malformed = structuredClone(bundle) as any;
  malformed.productionRelease.finalGrade.formula = "legacy weighted fallback";
  const invalidFetch = async () => new Response(JSON.stringify({
    ok: true,
    result: { reportId: bundle.reportId, bundle: malformed, source: "immutable-report-package" },
  }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    fetchAiGraderStationReportBundle({
      baseUrl: "http://127.0.0.1:47652",
      stationToken: "station-token",
      reportId: bundle.reportId,
    }, invalidFetch as typeof fetch),
    /malformed Mathematical Grading V1|V0 fallback is prohibited/,
  );
});

test("station release authority keeps the external grading-session envelope separate from strict V1", async () => {
  const bundle = strictBundle();
  const envelope = releaseEnvelope(bundle);
  const status = {
    reportBundle: bundle,
    productionRelease: envelope,
    latestReport: { reportId: bundle.reportId },
  };
  const resolved = await resolveAiGraderAuthoritativeProductionPackage({
    initialStatus: status as any,
    fetchBridgeBundle: async () => bundle,
    explicitlyFinalize: async () => {
      throw new Error("already finalized");
    },
  });
  assert.equal(resolved.productionRelease, envelope);
  assert.equal("gradingSessionId" in resolved.sourceBundle!, false);
  assert.equal(resolved.sourceBundle?.schemaVersion, AI_GRADER_REPORT_BUNDLE_V03_VERSION);
  if (resolved.sourceBundle?.schemaVersion !== AI_GRADER_REPORT_BUNDLE_V03_VERSION) {
    throw new Error("expected strict V1 bundle");
  }
  assert.equal(resolved.sourceBundle?.productionRelease.finalGrade.status, "final_mathematical_grade_v1");
});

test("station publish readiness fails closed when a V1 envelope is missing or mixed", () => {
  const bundle = strictBundle();
  const envelope = releaseEnvelope(bundle);
  assert.equal(buildAiGraderPublishReadiness({ bundle, productionRelease: envelope as any }).status, "ready");
  const mixed = structuredClone(envelope) as any;
  mixed.finalGrade.overall = 9;
  const readiness = buildAiGraderPublishReadiness({ bundle, productionRelease: mixed });
  assert.equal(readiness.ready, false);
  assert.match(readiness.message, /must exactly equal/);
});

test("strict V1 publication rejects legacy label metadata, altered links, and non-final status", () => {
  const bundle = strictBundle();

  const legacyRelease = releaseEnvelope(bundle) as any;
  legacyRelease.schemaVersion = "ai-grader-production-release-v0.1";
  legacyRelease.label.labelVersion = "ten-kings-ai-grader-label-v0";
  assert.throws(
    () => assertAiGraderPublishBundleBoundary(bundle as any, legacyRelease),
    /Mathematical Grading V1 release schema|legacy release metadata/,
  );

  const wrongLink = releaseEnvelope(bundle) as any;
  wrongLink.label.publicReportUrl = "/ai-grader/reports/a-different-report";
  assert.throws(
    () => assertAiGraderPublishBundleBoundary(bundle as any, wrongLink),
    /exact Label V1 version, identity, element scores, one-decimal grade, and report\/QR links/,
  );

  const nonFinal = releaseEnvelope(bundle) as any;
  nonFinal.finalStatus = "insufficient_evidence";
  assert.throws(
    () => assertAiGraderPublishBundleBoundary(bundle as any, nonFinal),
    /final Mathematical Grading V1 report and grade statuses/,
  );

  const calibrationTamper = releaseEnvelope(bundle) as any;
  calibrationTamper.calibrationProfile.artifactSha256 = "d".repeat(64);
  assert.throws(
    () => assertAiGraderPublishBundleBoundary(bundle as any, calibrationTamper),
    /exact Mathematical V1 card identity and finalized calibration profile/,
  );

  const mutationClaim = releaseEnvelope(bundle) as any;
  mutationClaim.publication.uploadPerformed = true;
  assert.throws(
    () => assertAiGraderPublishBundleBoundary(bundle as any, mutationClaim),
    /local-artifact status.*no-mutation flags/,
  );
});
