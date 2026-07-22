import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiGraderReportBundleV03 } from "@tenkings/shared";
import AiGraderMathematicalReportV1 from "../components/ai-grader/AiGraderMathematicalReportV1";
import { parseAiGraderMathematicalReportV1 } from "../lib/aiGraderMathematicalReportV1";
import { buildAiGraderReportEditorialRevisionV1 } from "../lib/aiGraderReportRevision";

const confidence = { score: 0.98, band: "high", validEvidenceCoverage: 0.99, warnings: [] };
const location = { side: "front", location: "top_left", score: 9.75, penalty: 0.25, findingIds: [], confidence };
const element = {
  score: 9.75,
  startingScore: 10,
  frontScore: 9.75,
  backScore: 10,
  aggregatePenalty: 0.25,
  locationScores: [location],
  findingIds: [],
  confidence,
  formula: "score = clamp(10 - measurement deductions, 1, 10)",
  explanation: "Deterministic physical measurement.",
};
const axis = {
  axis: "horizontal",
  marginAName: "left",
  marginBName: "right",
  marginAPx: 100,
  marginBPx: 102,
  marginAMm: 5,
  marginBMm: 5.1,
  measuredDifferenceMm: 0.1,
  u95Mm: 0.05,
  u95Components: {
    pixelMmScale: 0,
    lensDistortion: 0,
    normalizationRegistration: 0,
    repeatedPlacement: 0.05,
    segmentationBoundary: 0,
    measurementRepeatability: 0,
    lightingChannelConfidence: 0,
  },
  effectiveDifferenceMm: 0.05,
  grade10ToleranceMm: 0.08,
  balanceRatio: 99,
  score: 9.8,
};
const sha = (character: string) => character.repeat(64);
const observedCut = (name: "front" | "back") => ({
  schemaVersion: "fixed-rig-raw-bound-observed-outer-cut-artifact-v1",
  detectorId: "fixed_rig_raw_sensor_outer_cut_detector_v1",
  detectorVersion: "fixed_rig_raw_sensor_outer_cut_detector_v1.0.0",
  rawCoordinateFrame: "auto_oriented_raw_image_pixels",
  normalizedCoordinateFrame: "normalized_card_portrait_pixels",
  rawAllOnAssetId: `${name}/raw-all-on.png`,
  rawAllOnAssetSha256: sha(name === "front" ? "1" : "2"),
  rawAllOnScalarPlaneSha256: sha("3"),
  rawWidthPx: 1200,
  rawHeightPx: 1680,
  normalizedAllOnAssetId: `${name}/normalized-all-on.png`,
  normalizedAllOnAssetSha256: sha(name === "front" ? "4" : "5"),
  normalizedWidthPx: 1000,
  normalizedHeightPx: 1400,
  rawToNormalizedTransformSha256: sha("6"),
  calibrationProfileId: "cal-profile-1",
  calibrationVersion: "cal-v1",
  calibrationSha256: sha("b"),
  pixelsPerMmX: 20,
  pixelsPerMmY: 20,
  segmentationBoundaryU95Px: 1,
  intendedBoundaryArtifactSha256: sha("7"),
  intendedBoundaryProfileId: "standard_trading_card_63_50x88_90_r3_18_v1",
  intendedBoundaryProfileVersion: "standard_trading_card_63_50x88_90_r3_18_v1.0.0",
  rawContour: [{ x: 10, y: 10 }, { x: 1190, y: 10 }, { x: 1190, y: 1670 }, { x: 10, y: 1670 }],
  normalizedContour: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1400 }, { x: 0, y: 1400 }],
  crossSectionCount: 192,
  supportedCrossSectionCount: 192,
  minimumGradientDigitalUnits: 5,
  meanDetectedGradientDigitalUnits: 20,
  minimumDetectedGradientDigitalUnits: 10,
  confidence: 0.98,
  u95ComponentsMm: { calibratedSegmentationBoundary: 0.05, rawDetectorLocalization: 0.02 },
  u95Mm: 0.054,
  artifactSha256: sha("8"),
});
const outerCutGeometry = (name: "front" | "back") => {
  const observedArtifact = observedCut(name);
  return {
    coordinateFrame: "normalized_card_portrait_pixels",
    observedContourSha256: observedArtifact.artifactSha256,
    intendedContourSha256: observedArtifact.intendedBoundaryArtifactSha256,
    intendedBoundaryProfileId: observedArtifact.intendedBoundaryProfileId,
    intendedBoundaryProfileVersion: observedArtifact.intendedBoundaryProfileVersion,
    observedContourPointCount: observedArtifact.normalizedContour.length,
    intendedContourPointCount: 4,
    observedContourDetectorId: observedArtifact.detectorId,
    observedContourDetectorVersion: observedArtifact.detectorVersion,
    rawAllOnAssetId: observedArtifact.rawAllOnAssetId,
    rawAllOnAssetSha256: observedArtifact.rawAllOnAssetSha256,
    rawAllOnScalarPlaneSha256: observedArtifact.rawAllOnScalarPlaneSha256,
    rawToNormalizedTransformSha256: observedArtifact.rawToNormalizedTransformSha256,
    normalizedAllOnAssetId: observedArtifact.normalizedAllOnAssetId,
    normalizedAllOnAssetSha256: observedArtifact.normalizedAllOnAssetSha256,
    boundaryConfidence: observedArtifact.confidence,
    boundaryU95Mm: observedArtifact.u95Mm,
    observedArtifact,
  };
};
const side = (name: "front" | "back") => ({
  side: name,
  profile: "printed_border_v1",
  score: 9.8,
  horizontal: axis,
  vertical: { ...axis, axis: "vertical", marginAName: "top", marginBName: "bottom" },
  outerCutContourAssetId: `${name}/outer.png`,
  printedDesignContourAssetId: `${name}/print.png`,
  measurementOverlayAssetId: `${name}/center.png`,
  registration: { profile: "printed_border_v1", transformType: "robust_line_fit", transformMatrix: [1, 0, 0, 1, 0, 0], registrationResidualPx: 0.2, inlierCount: 50, inlierFraction: 0.95, confidence: 0.98 },
  outerCutGeometryEvidence: outerCutGeometry(name),
  evidenceAssetIds: [`${name}/center.png`],
});

const observation = (elementName: "corners" | "edges", locationName: string) => ({
  element: elementName,
  side: "front",
  location: locationName,
  regionId: `${elementName}-front-${locationName}`,
  score: 10,
  penalty: 0,
  validEvidenceCoverage: 0.99,
  usableDirectionalChannelCount: 8,
  findingIds: [],
  measurementIds: [],
  roiAssetId: `front/${elementName}-${locationName}-roi.png`,
  segmentationMaskAssetId: `front/${elementName}-${locationName}-segmentation.png`,
  confidenceMaskAssetId: `front/${elementName}-${locationName}-confidence.png`,
  illuminationMaskAssetId: `front/${elementName}-${locationName}-illumination.png`,
  channelAssetIds: ["front/channel-1.png"],
});

function displayBundle() {
  const findingId = "surface-scratch-front-1";
  const measurementId = "surface-scratch-length-front-1";
  const trueViewAssetId = "front/finding/true-view.png";
  const overlayAssetId = "front/finding/deduction-overlay.png";
  const segmentationMaskAssetId = "front/finding/segmentation-mask.png";
  const exactDeductionFormula = "normalizedSeverity = clamp(effectiveMeasurement / referenceMeasurement, 0, 1); deduction = maximumDeduction * normalizedSeverity";
  return {
    schemaVersion: "ai-grader-report-bundle-v0.3",
    generatedAt: "2026-07-18T15:00:00.000Z",
    reportId: "math-v1-display",
    certifiedClaim: false,
    cardIdentity: { title: "Controlled Test Card", sideCount: 2 },
    gradingStandard: {
      id: "mathematical_calibration_v1",
      thresholdSetId: "ten-kings-mathematical-grading-v1.0.1",
      thresholdSetHash: "a".repeat(64),
      algorithmVersion: "mathematical-grading-v1.0.0",
      defectFindingSchemaVersion: "ai-grader-defect-finding-v2",
      designReferenceSchemaVersion: "mathematical-design-reference-v1",
    },
    productionRelease: {
      finalGrade: {
        status: "final_mathematical_grade_v1",
        overall: 9.58,
        labelGrade: 9.6,
        weightedGrade: 9.58,
        weakestElement: "corners",
        weakestScore: 9.75,
        weakestElementCap: 10,
        weights: { centering: 0.3, corners: 0.25, edges: 0.25, surface: 0.2 },
        weightedFormula: "0.30 * centering + 0.25 * corners + 0.25 * edges + 0.20 * surface",
        elements: { centering: { ...element, score: 9.8 }, corners: element, edges: { ...element, score: 9.9 }, surface: { ...element, score: 9.6 } },
        confidence,
        formula: "min(weighted grade, weakest element + 0.50, severe caps)",
        whyNot10: [],
      },
      label: { certId: "CERT-1", labelGradeText: "9.6", publicReportUrl: "/r/math-v1-display", qrPayloadUrl: "/r/math-v1-display" },
      publication: { publicReportUrl: "/r/math-v1-display" },
    },
    calibrationProfile: {
      profileId: "cal-profile-1",
      calibrationVersion: "cal-v1",
      artifactSha256: "b".repeat(64),
      mmPerPixelX: 0.05,
      mmPerPixelY: 0.05,
      normalizationRegistrationResidualPx: 0.2,
      repeatedPlacementU95Mm: 0.04,
      lensResidualPx: 0.2,
      segmentationBoundaryU95Px: 1,
      measurementRepeatability: {
        linearMm: { u95: 0.02 },
        areaMm2: { u95: 0.02 },
        reliefIndex: { u95: 0.02 },
        roughnessIndex: { u95: 0.02 },
        colorDeltaE: { u95: 0.02 },
      },
    },
    calibrationBundleAuthority: {
      schemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
      bundleManifestSha256: sha("c"),
      sourceCaptureManifestSha256: sha("d"),
      memberLedgerSha256: sha("e"),
      members: [{ role: "calibration_profile", fileName: "mathematical-calibration-profile-v1.json", sha256: sha("f") }],
    },
    designReferences: [],
    centeringEvidence: {
      front: side("front"),
      back: side("back"),
      fusedScore: 9.8,
      deduction: 0.2,
      formula: "worst plus average",
      balanceCurve: [{ ratio: 70, score: 5 }, { ratio: 95, score: 10 }],
    },
    conditionObservationEvidence: {
      corners: [observation("corners", "top_left")],
      edges: [observation("edges", "top")],
    },
    defectFindings: [{
      findingId,
      physicalDefectId: "physical-scratch-front-1",
      side: "front",
      category: "scratch",
      primaryElement: "surface",
      location: "center",
      regionId: "front-surface-center",
      severity: { normalized: 0.25, band: "low" },
      confidence: 0.96,
      evidenceQuality: "sufficient",
      geometry: { coordinateFrame: "normalized_card", units: "fraction", shape: { kind: "box", x: 0.4, y: 0.4, width: 0.2, height: 0.1 } },
      evidence: {
        trueViewAssetId,
        overlayAssetId,
        segmentationMaskAssetId,
        channelAssetIds: ["front/channel-1.png"],
        roiAssetIds: ["front/finding/roi.png"],
      },
      measurements: [{
        measurementId,
        kind: "scratch_length",
        unit: "mm",
        measuredMeasurement: 0.55,
        u95: 0.05,
        effectiveMeasurement: 0.5,
        grade10Buffer: 0.08,
        validEvidenceCoverage: 0.98,
        usableDirectionalChannelCount: 7,
        uncertaintyComponentsU95: {
          pixelMmScale: 0.01,
          lensDistortion: 0.01,
          normalizationRegistration: 0.01,
          repeatedPlacement: 0.01,
          segmentationBoundary: 0.04,
          measurementRepeatability: 0.02,
          lightingChannelConfidence: 0,
        },
      }],
      secondaryEvidenceCategories: [],
      explanation: "A measured scratch deducts from the surface element.",
      review: { status: "confirmed", reviewedAt: "2026-07-18T15:10:00.000Z" },
    }],
    deductionLedger: {
      startingScores: { centering: 10, corners: 10, edges: 10, surface: 10 },
      entries: [{
        findingId,
        physicalDefectId: "physical-scratch-front-1",
        element: "surface",
        category: "scratch",
        measurementId,
        measuredMeasurement: 0.55,
        unit: "mm",
        u95: 0.05,
        grade10Tolerance: 0.08,
        effectiveMeasurement: 0.5,
        referenceMeasurement: 2,
        maximumDeduction: 4,
        curve: "linear_clamped",
        formula: exactDeductionFormula,
        normalizedSeverity: 0.25,
        deduction: 1,
        evidenceAssetIds: ["front/channel-1.png"],
        calibrationProfileId: "cal-profile-1",
        calibrationVersion: "cal-v1",
        algorithmVersion: "surface-measurement-v1.0.0",
        thresholdSetId: "ten-kings-mathematical-grading-v1.0.1",
      }],
    },
    evidenceQualityLimitations: [{ limitationId: "glare-1", side: "front", regionId: "region-1", classification: "common_mode_specular_glare", validEvidenceCoverage: 0.85, excludedPixelFraction: 0.15, recoveredFromAlternateChannels: true, recaptureRequired: false, deduction: 0, evidenceAssetIds: ["front/glare.png"], explanation: "Specular pixels were excluded and alternate channels retained valid evidence." }],
    publicAssets: [
      { id: trueViewAssetId, kind: "report-image", fileName: "true-view.png", publicUrl: "/api/evidence/true-view", sha256: sha("1"), side: "front", evidenceRole: "normalized_card", contentType: "image/png" },
      { id: overlayAssetId, kind: "report-image", fileName: "deduction-overlay.png", publicUrl: "/api/evidence/deduction-overlay", sha256: sha("2"), side: "front", evidenceRole: "deduction_overlay", contentType: "image/png" },
      { id: segmentationMaskAssetId, kind: "report-image", fileName: "segmentation-mask.png", publicUrl: "/api/evidence/segmentation-mask", sha256: sha("3"), side: "front", evidenceRole: "segmentation_mask", contentType: "image/png" },
    ],
  } as unknown as AiGraderReportBundleV03;
}

function ownerAcceptedDisplayBundle() {
  const bundle = displayBundle() as any;
  const exceptionLedger = Array.from({ length: 36 }, (_, index) => ({
    path: `certifiedAnalysis.exception${index + 1}`,
    message: `Recorded mathematical exception message ${index + 1}.`,
  }));
  bundle.calibrationProfile = {
    ...bundle.calibrationProfile,
    rigId: "fixed-rig-dell-v1",
    isCalibrated: false,
    status: "rejected",
    operationalAcceptance: {
      authorityId: "ten-kings-owner-operational-acceptance-math-cal-v1-20260722-4cfa410c-01-v1",
      authorityStatus: "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS",
      authoritySha256: sha("a"),
      owner: { name: "Mark", organization: "Ten Kings", role: "product_owner" },
      decisionAt: "2026-07-22T14:00:00.000Z",
      reason: "Product owner directs operational use of the preserved calibration exactly as captured; all measurements, threshold exceptions, evidence hashes, and provenance must remain unchanged and visible.",
      exceptionLedger,
      exceptionLedgerSha256: sha("b"),
    },
  };
  bundle.calibrationBundleAuthority.bundleManifestSha256 = sha("c");
  bundle.calibrationBundleAuthority.memberLedgerSha256 = sha("d");
  bundle.calibrationBundleAuthority.members = [
    { role: "calibration_profile", fileName: "mathematical-calibration-profile-v1.json", sha256: sha("1") },
    { role: "physical_calibration_artifact", fileName: "mathematical-calibration-artifact-v1.json", sha256: sha("2") },
    { role: "calibration_acceptance", fileName: "mathematical-calibration-acceptance-v1.json", sha256: sha("3") },
    { role: "product_owner_operational_acceptance", fileName: "product-owner-operational-acceptance-v1.json", sha256: sha("4") },
    ...Array.from({ length: 8 }, (_, index) => ({
      role: "flat_field",
      channelIndex: index + 1,
      fileName: `flat-field-channel-${index + 1}-v1.json`,
      sha256: sha("5"),
    })),
    { role: "illumination_pattern", fileName: "illumination-pattern-v1.json", sha256: sha("6") },
  ];
  bundle.calibrationActivationAuthority = {
    authorityPhase: "ACTIVE",
    activationId: "owner-accepted-activation-v1",
    activationHash: sha("7"),
    activationRevision: sha("8"),
    rigId: "fixed-rig-dell-v1",
    bundleManifestSha256: sha("c"),
    memberLedgerSha256: sha("d"),
    runtimeContextHash: sha("e"),
    rigCharacterizationSha256: bundle.calibrationProfile.artifactSha256,
    operatingContextHash: sha("f"),
    workstationReceiptSha256: sha("0"),
    hostedAuthorityKeyId: sha("9"),
    hostedAuthoritySignatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
    hostedAuthorityIssuedAt: "2026-07-22T14:05:00.000Z",
    hostedAuthorityExpiresAt: "2026-07-23T14:05:00.000Z",
    hostedAuthoritySignature: "A".repeat(86),
  };
  return bundle as AiGraderReportBundleV03;
}

test("V1 report renders exact scores, subscores, formulas, and evidence limitations separately", () => {
  const html = renderToStaticMarkup(createElement(AiGraderMathematicalReportV1, { bundle: displayBundle() }));
  assert.match(html, /9\.58/);
  assert.match(html, /Label 9\.6/);
  assert.match(html, /Starting score|Start/);
  assert.match(html, /Front, back, and location subscores/);
  assert.match(html, /top left/);
  assert.match(html, /Evidence-quality limitations/);
  assert.match(html, /deduction 0\.00/);
  assert.match(html, /common mode specular glare/);
  assert.match(html, /Published evidence replay/);
  assert.match(html, /Immutable grading provenance/);
  assert.match(html, /Exact deduction formula/);
  assert.match(html, /linear clamped/);
  assert.match(html, /0\.55 &lt;= max\(0\.05, 0\.08\)/);
  assert.match(html, /Human finding review/);
  assert.match(html, /Exact immutable deduction overlay for finding surface-scratch-front-1/);
  assert.match(html, /href="\/api\/evidence\/deduction-overlay"/);
  assert.match(html, /Exact immutable segmentation mask for finding surface-scratch-front-1/);
  assert.match(html, /href="\/api\/evidence\/segmentation-mask"/);
  assert.match(html, /Calibration bundle manifest/);
  assert.match(html, /Exact calibration bundle members/);
});

test("owner-accepted report visibly preserves rejection, all exceptions, and signed activation provenance", () => {
  const html = renderToStaticMarkup(createElement(AiGraderMathematicalReportV1, {
    bundle: ownerAcceptedDisplayBundle(),
  }));
  assert.match(html, /Owner accepted with recorded exceptions/);
  assert.match(html, /Mathematical status REJECTED/);
  assert.match(html, /isCalibrated=false/);
  assert.match(html, /This is not a mathematical threshold pass/);
  assert.match(html, /Mark \/ Ten Kings/);
  assert.match(html, /Product owner directs operational use of the preserved calibration exactly as captured/);
  assert.match(html, /Complete mathematical exception ledger \(36\)/);
  assert.equal((html.match(/Recorded mathematical exception message/g) ?? []).length, 36);
  assert.match(html, /certifiedAnalysis\.exception36/);
  assert.match(html, /owner-accepted-activation-v1 \/ ACTIVE/);
  assert.match(html, /ecdsa-p256-sha256-ieee-p1363/);
  assert.match(html, new RegExp("A".repeat(86)));
  assert.match(html, /Bundle manifest binding/);
  assert.match(html, /Member-ledger binding/);
  assert.match(html, /Runtime \/ operating-context binding/);
});

test("V1 report renders human-reviewed values as effective while retaining immutable machine values", () => {
  const bundle = displayBundle();
  const editorialRevision = buildAiGraderReportEditorialRevisionV1({
    reportId: bundle.reportId,
    sourceReportSchemaVersion: bundle.schemaVersion,
    sourceBundleSha256: sha("a"),
    revision: 2,
    editedAt: "2026-07-21T18:00:00.000Z",
    scores: { centering: 8.25, corners: 8.5, edges: 8.75, surface: 9 },
    content: {
      cardTitle: "Human Reviewed Display Card",
      reportSummary: "An administrator reviewed every required grading element.",
      cornersExplanation: "Corner evidence was adjudicated at 8.50.",
      whyNot10: "The effective reviewed report records visible corner wear.",
    },
    adjudicatedMachineFailures: ["MACHINE_CORNER_REVIEW_REQUIRED"],
  });

  const html = renderToStaticMarkup(createElement(AiGraderMathematicalReportV1, {
    bundle,
    editorialRevision,
  }));
  assert.match(html, /Human Reviewed Display Card/);
  assert.match(html, /Completed — human reviewed\/admin adjudicated · revision 2/);
  assert.match(html, new RegExp(editorialRevision.calculation.overall.toFixed(2)));
  assert.match(html, /Immutable machine overall: 9\.58/);
  assert.match(html, /Human reviewed · machine 9\.75/);
  assert.match(html, /Corner evidence was adjudicated at 8\.50/);
  assert.match(html, /Effective human-reviewed explanation/);
  assert.match(html, /visible corner wear/);
  assert.match(html, /Adjudicated machine failures: MACHINE_CORNER_REVIEW_REQUIRED/);
});

test("registered-template centering renders exact approved reference and correspondence provenance", () => {
  const bundle = displayBundle() as any;
  bundle.cardIdentity = {
    ...bundle.cardIdentity,
    tenantId: "tenant-display",
    setId: "set-display",
    programId: "program-display",
    cardNumber: "42",
    variantId: null,
    parallelId: "parallel-display",
  };
  const referenceSha256 = sha("9");
  bundle.designReferences = [{
    designReferenceId: "approved-front-reference-v3",
    profile: "registered_design_template_v1",
    tenantId: "tenant-display",
    setId: "set-display",
    programId: "program-display",
    cardNumber: "42",
    variantId: null,
    parallelId: "parallel-display",
    side: "front",
    artifactId: "approved-front-artifact-v3",
    artifactSha256: referenceSha256,
    version: 3,
    widthPx: 1200,
    heightPx: 1680,
    approvedBy: "design-approver",
    approvedAt: "2026-07-18T14:00:00.000Z",
  }];
  bundle.centeringEvidence.front.profile = "registered_design_template_v1";
  bundle.centeringEvidence.front.registration = {
    profile: "registered_design_template_v1",
    designReferenceId: "approved-front-reference-v3",
    designReferenceSha256: referenceSha256,
    transformType: "affine",
    transformMatrix: [1, 0, 0.25, 0, 1, -0.5],
    registrationResidualPx: 0.4,
    inlierCount: 24,
    inlierFraction: 1,
    confidence: 0.96,
  };
  bundle.centeringEvidence.front.registrationEvidence = {
    designReferenceId: "approved-front-reference-v3",
    designReferenceVersion: 3,
    designReferenceSha256: referenceSha256,
    normalizedSourceEvidenceId: "front/normalized-all-on.png",
    normalizedSourceEvidenceSha256: sha("4"),
    registrationAlgorithmVersion: "registered-design-registration-v1.0.0",
    correspondenceCount: 24,
    inlierCorrespondenceIds: Array.from({ length: 24 }, (_, index) => `correspondence-${index + 1}`),
    correspondenceLedgerSha256: sha("8"),
    correspondenceLedgerAssetId: "front/registered/correspondence-ledger.json",
    registrationSha256: sha("7"),
  };
  bundle.publicAssets.push(
    { id: "front/registered/correspondence-ledger.json", kind: "report-data", fileName: "correspondence-ledger.json", publicUrl: "/api/evidence/correspondence-ledger", sha256: sha("8"), side: "front", evidenceRole: "other_evidence", contentType: "application/json" },
    { id: "front/center.png", kind: "report-image", fileName: "centering-overlay.png", publicUrl: "/api/evidence/centering-overlay", sha256: sha("6"), side: "front", evidenceRole: "centering_overlay", contentType: "image/png", widthPx: 1000, heightPx: 1400 },
    { id: bundle.centeringEvidence.front.outerCutGeometryEvidence.normalizedAllOnAssetId, kind: "report-image", fileName: "normalized-all-on.png", publicUrl: "/api/evidence/normalized-all-on", sha256: bundle.centeringEvidence.front.outerCutGeometryEvidence.normalizedAllOnAssetSha256, side: "front", evidenceRole: "normalized_card", contentType: "image/png", widthPx: 1000, heightPx: 1400 },
    { id: "front/registered/design-reference.png", kind: "report-image", fileName: "design-reference.png", publicUrl: "/api/evidence/design-reference", sha256: referenceSha256, side: "front", evidenceRole: "design_reference", contentType: "image/png" },
  );

  const html = renderToStaticMarkup(createElement(AiGraderMathematicalReportV1, { bundle }));
  assert.match(html, /Approved design reference/);
  assert.match(html, /approved-front-reference-v3/);
  assert.match(html, /Reference identity/);
  assert.match(html, /tenant-display/);
  assert.match(html, /Reference artifact/);
  assert.match(html, /approved-front-artifact-v3/);
  assert.match(html, /Reference approval/);
  assert.match(html, /design-approver/);
  assert.match(html, /Transform matrix/);
  assert.match(html, /Correspondence ledger/);
  assert.match(html, /href="\/api\/evidence\/correspondence-ledger"/);
  assert.match(html, /src="\/api\/evidence\/normalized-all-on"/);
  assert.match(html, /src="\/api\/evidence\/centering-overlay"/);
  assert.match(html, /approved-design orientation/);
  assert.match(html, /expected-to-observed landmark residual vector/);
});

test("an incomplete v0.3 payload is rejected instead of silently displayed as V0", () => {
  assert.equal(parseAiGraderMathematicalReportV1({ schemaVersion: "ai-grader-report-bundle-v0.3", reportId: "incomplete" }), null);
});
