const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AI_GRADER_DEFECT_FINDING_VERSION,
  AI_GRADER_REPORT_BUNDLE_V01_VERSION,
  AI_GRADER_REPORT_BUNDLE_V02_VERSION,
  aiGraderLegacyReportBundleV02ReadSchema,
  aiGraderPublishedAssetSchema,
  aiGraderReportBundleSchema,
  aiGraderReportBundleV02Schema,
  isAiGraderHumanConfirmedReviewStatus,
} = require("../dist");

function publishedFinding(overrides = {}) {
  return {
    schemaVersion: AI_GRADER_DEFECT_FINDING_VERSION,
    findingId: "front-surface-001",
    side: "front",
    category: "surface_anomaly",
    detector: { id: "surface-intelligence", version: "v1", captureProfileVersion: "capture-v1" },
    severity: { band: "medium" },
    confidence: 0.82,
    review: { status: "unreviewed" },
    geometry: {
      coordinateFrame: "normalized_card",
      units: "fraction",
      shape: { kind: "box", x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    },
    evidence: {
      trueViewAssetId: "front/front-normalized-card.png",
      heatmapAssetId: "report/front-surface-findings-heatmap.png",
      channelAssetIds: [],
      roiAssetIds: [],
    },
    explanation: "AI-detected provisional surface finding.",
    ...overrides,
  };
}

function v02Bundle(overrides = {}) {
  return {
    schemaVersion: AI_GRADER_REPORT_BUNDLE_V02_VERSION,
    generatedAt: "2026-07-10T15:00:00.000Z",
    reportId: "report-001",
    certifiedClaim: false,
    cardIdentity: { title: "Published card", sideCount: 2 },
    productionRelease: {
      finalGrade: {
        overall: 8.5,
        elements: {
          centering: { score: 8.5, confidence: "medium", explanation: "Centering analysis complete." },
          corners: { score: 8.5, confidence: "medium", explanation: "Corner analysis complete." },
          edges: { score: 8.5, confidence: "medium", explanation: "Edge analysis complete." },
          surface: { score: 8.5, confidence: "medium", explanation: "Surface analysis complete." },
        },
        confidence: { score: 0.82, band: "medium" },
        gradeImpactReasons: [{
          id: "surface-impact-001",
          category: "surface",
          side: "front",
          severity: "medium",
          confidence: "medium",
          explanation: "Published finding affects the surface assessment.",
          findingIds: ["front-surface-001"],
        }],
      },
      label: {
        certId: "TK-report-001",
        labelGradeText: "8.5",
        publicReportUrl: "/ai-grader/reports/report-001",
        qrPayloadUrl: "/ai-grader/reports/report-001",
      },
      publication: { publicReportUrl: "/ai-grader/reports/report-001" },
    },
    defectFindings: [publishedFinding()],
    publicAssets: [
      {
        id: "front/front-normalized-card.png",
        kind: "report-image",
        fileName: "front-normalized-card.png",
        publicUrl: "/api/ai-grader/reports/report-001/assets/front-normalized-card.png",
        widthPx: 1200,
        heightPx: 1680,
        side: "front",
        evidenceRole: "normalized_card",
      },
      {
        id: "report/front-surface-findings-heatmap.png",
        kind: "report-image",
        fileName: "front-surface-findings-heatmap.png",
        publicUrl: "/api/ai-grader/reports/report-001/assets/front-surface-findings-heatmap.png",
        side: "front",
        evidenceRole: "surface_heatmap",
      },
    ],
    ...overrides,
  };
}

test("v0.1 bundles remain accepted without changing their legacy payload", () => {
  const legacy = {
    schemaVersion: AI_GRADER_REPORT_BUNDLE_V01_VERSION,
    generatedAt: "2026-07-10T15:00:00.000Z",
    reportId: "legacy-report",
    certifiedClaim: false,
    localReportFolder: "C:\\private\\legacy-report",
  };
  const parsed = aiGraderReportBundleSchema.safeParse(legacy);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.localReportFolder, legacy.localReportFolder);
});

test("v0.2 accepts a non-certified public bundle with top-level published findings", () => {
  const parsed = aiGraderReportBundleV02Schema.safeParse(v02Bundle());
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.defectFindings[0].geometry.shape.kind, "box");
  assert.equal(parsed.data.publicAssets[0].widthPx, 1200);
});

test("v0.2 accepts partial element results so unsupported elements remain absent", () => {
  const bundle = v02Bundle();
  bundle.productionRelease.finalGrade.elements = {
    surface: bundle.productionRelease.finalGrade.elements.surface,
  };
  const parsed = aiGraderReportBundleV02Schema.safeParse(bundle);
  assert.equal(parsed.success, true);
  assert.deepEqual(Object.keys(parsed.data.productionRelease.finalGrade.elements), ["surface"]);
});

test("v0.2 new-write schema enforces 1.00-10.00 while explicit legacy reads preserve historical scores", () => {
  for (const invalidScore of [0, 0.99, -0.01, 10.01]) {
    const overall = v02Bundle();
    overall.productionRelease.finalGrade.overall = invalidScore;
    assert.equal(aiGraderReportBundleV02Schema.safeParse(overall).success, false);

    const element = v02Bundle();
    element.productionRelease.finalGrade.elements.surface.score = invalidScore;
    assert.equal(aiGraderReportBundleV02Schema.safeParse(element).success, false);
  }

  const historical = v02Bundle();
  historical.productionRelease.finalGrade.overall = 0;
  historical.productionRelease.finalGrade.elements.surface.score = 0.5;
  const legacyRead = aiGraderLegacyReportBundleV02ReadSchema.safeParse(historical);
  assert.equal(legacyRead.success, true);
  assert.equal(legacyRead.data.productionRelease.finalGrade.overall, 0);
  assert.equal(legacyRead.data.productionRelease.finalGrade.elements.surface.score, 0.5);
  assert.equal(aiGraderReportBundleSchema.safeParse(historical).success, false);

  const corruptHistorical = v02Bundle();
  corruptHistorical.productionRelease.finalGrade.overall = -0.01;
  assert.equal(aiGraderLegacyReportBundleV02ReadSchema.safeParse(corruptHistorical).success, false);
});

test("v0.2 rejects certification claims, unknown assets, and dangling finding references", () => {
  assert.equal(aiGraderReportBundleV02Schema.safeParse(v02Bundle({ certifiedClaim: true })).success, false);

  const unknownAsset = v02Bundle({
    defectFindings: [publishedFinding({
      evidence: {
        trueViewAssetId: "front/missing.png",
        channelAssetIds: [],
        roiAssetIds: [],
      },
    })],
  });
  const unknownResult = aiGraderReportBundleV02Schema.safeParse(unknownAsset);
  assert.equal(unknownResult.success, false);
  assert.match(unknownResult.error.issues.map((issue) => issue.message).join(" "), /bundle\.publicAssets/);

  const dangling = v02Bundle();
  dangling.productionRelease.finalGrade.gradeImpactReasons[0].findingIds = ["finding-that-does-not-exist"];
  const danglingResult = aiGraderReportBundleV02Schema.safeParse(dangling);
  assert.equal(danglingResult.success, false);
  assert.match(danglingResult.error.issues.map((issue) => issue.message).join(" "), /existing published findingId/);
});

test("publicAssets takes precedence over assets for finding evidence", () => {
  const bundle = v02Bundle({
    publicAssets: [],
    assets: [
      { id: "front/front-normalized-card.png" },
      { id: "report/front-surface-findings-heatmap.png" },
    ],
  });
  assert.equal(aiGraderReportBundleV02Schema.safeParse(bundle).success, false);
});

test("physical measurements require the matching finalized calibration version and derived value", () => {
  const measurement = { lengthMm: 6.72, calibrationVersion: "cal-v1" };
  const uncalibrated = v02Bundle({
    calibrationProfile: { isCalibrated: false },
    defectFindings: [publishedFinding({ measurements: measurement })],
  });
  assert.equal(aiGraderReportBundleV02Schema.safeParse(uncalibrated).success, false);
  assert.equal(
    aiGraderReportBundleV02Schema.safeParse(v02Bundle({
      calibrationProfile: { isCalibrated: false, mmPerPixelX: 0.01, mmPerPixelY: 0.01 },
    })).success,
    false,
  );

  const mismatched = v02Bundle({
    calibrationProfile: {
      isCalibrated: true,
      coordinateFrame: "normalized_card_portrait_pixels",
      calibrationVersion: "cal-v2",
      mmPerPixelX: 0.01,
      mmPerPixelY: 0.01,
    },
    defectFindings: [publishedFinding({ measurements: measurement })],
  });
  assert.equal(aiGraderReportBundleV02Schema.safeParse(mismatched).success, false);

  const calibrated = v02Bundle({
    calibrationProfile: {
      isCalibrated: true,
      coordinateFrame: "normalized_card_portrait_pixels",
      calibrationVersion: "cal-v1",
      mmPerPixelX: 0.01,
      mmPerPixelY: 0.01,
    },
    defectFindings: [publishedFinding({ measurements: measurement })],
  });
  assert.equal(aiGraderReportBundleV02Schema.safeParse(calibrated).success, true);

  const tampered = v02Bundle({
    calibrationProfile: {
      isCalibrated: true,
      coordinateFrame: "normalized_card_portrait_pixels",
      calibrationVersion: "cal-v1",
      mmPerPixelX: 0.01,
      mmPerPixelY: 0.01,
    },
    defectFindings: [publishedFinding({
      measurements: { lengthMm: 6.71, calibrationVersion: "cal-v1" },
    })],
  });
  assert.equal(aiGraderReportBundleV02Schema.safeParse(tampered).success, false);
});

test("finding evidence must match the finding side and the required evidence role", () => {
  const wrongSide = v02Bundle();
  wrongSide.publicAssets[0].side = "back";
  assert.equal(aiGraderReportBundleV02Schema.safeParse(wrongSide).success, false);

  const wrongRole = v02Bundle();
  wrongRole.publicAssets[1].evidenceRole = "normalized_card";
  assert.equal(aiGraderReportBundleV02Schema.safeParse(wrongRole).success, false);
});

test("v0.2 fails closed for out-of-range fractions and unsafe public asset fields", () => {
  const outside = v02Bundle({
    defectFindings: [publishedFinding({
      geometry: {
        coordinateFrame: "normalized_card",
        units: "fraction",
        shape: { kind: "box", x: 0.9, y: 0.2, width: 0.2, height: 0.4 },
      },
    })],
  });
  assert.equal(aiGraderReportBundleV02Schema.safeParse(outside).success, false);

  assert.equal(aiGraderPublishedAssetSchema.safeParse({
    id: "front/card.png",
    localPath: "C:\\private\\card.png",
  }).success, false);
  assert.equal(aiGraderPublishedAssetSchema.safeParse({
    id: "front/card.png",
    publicUrl: "https://storage.invalid/card.png?X-Amz-Signature=secret",
  }).success, false);
  assert.equal(aiGraderPublishedAssetSchema.safeParse({
    id: "front/card.png",
    publicUrl: "http://127.0.0.1:4319/assets/card.png",
  }).success, false);
  for (const publicUrl of [
    "https://10.0.0.5/card.png",
    "https://172.20.1.5/card.png",
    "https://192.168.1.5/card.png",
    "https://169.254.1.5/card.png",
    "https://[::1]/card.png",
    "https://[0:0:0:0:0:0:0:1]/card.png",
    "https://[::ffff:127.0.0.1]/card.png",
    "https://[fd00::1]/card.png",
    "https://grader.internal/card.png",
    "https://grader.localhost/card.png",
    "https://grader.lan/card.png",
    "/api/reports/presigned/card.png",
    "/api/reports/card.png%3FX-Amz-Signature%3Dsecret",
    "/api/reports/card.png%253FX-Amz-Signature%253Dsecret",
  ]) {
    assert.equal(
      aiGraderPublishedAssetSchema.safeParse({ id: "front/card.png", publicUrl }).success,
      false,
      `expected unsafe public URL to be rejected: ${publicUrl}`,
    );
  }
  assert.equal(aiGraderPublishedAssetSchema.safeParse({
    id: "front/card.png",
    publicUrl: "https://cdn.tenkings.test/reports/card.png",
  }).success, true);
  assert.equal(aiGraderPublishedAssetSchema.safeParse({
    id: "front/card.png",
    publicUrl: "/api/ai-grader/reports/report-001/assets/card.png",
  }).success, true);
  assert.equal(aiGraderPublishedAssetSchema.safeParse({
    id: "front/card.png",
    widthPx: 1200,
  }).success, false);
});

test("only confirmed and adjusted review states are human-confirmed", () => {
  assert.equal(isAiGraderHumanConfirmedReviewStatus("confirmed"), true);
  assert.equal(isAiGraderHumanConfirmedReviewStatus("adjusted"), true);
  assert.equal(isAiGraderHumanConfirmedReviewStatus("unreviewed"), false);
  assert.equal(isAiGraderHumanConfirmedReviewStatus("rejected"), false);
});
