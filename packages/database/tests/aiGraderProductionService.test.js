const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAiGraderLabelPreviewHtml,
  buildAiGraderCompsSearchQuery,
  buildAiGraderProductionStoragePlan,
  aiGraderSha256,
  computeAiGraderValuationStatus,
  persistAiGraderSlabbedPhotoAsset,
  persistAiGraderProductionRelease,
  persistAiGraderValuationResult,
  normalizeAiGraderPublicGeometryCaptureDecisions,
  sanitizeAiGraderPublicJson,
  sanitizeAiGraderPublicReportBundleForRead,
} = require("../dist/database/src/aiGraderProductionService");

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
    cardIdentity: {
      title: "1996 Test Card #1",
      cardAssetId: "card-asset-1",
      itemId: "item-1",
      sideCount: 2,
    },
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
        placementState: "not_detected",
        geometrySource: "manual_override",
        captureMode: "manual_capture",
        confidence: 0,
        detectionUsed: false,
        manualOverrideUsed: true,
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
        mode: "manual_capture",
        placementState: "not_detected",
        timestamp: "2026-07-02T12:00:01.000Z",
        explicitOperatorAction: true,
        detectionUsed: false,
        manualOverrideUsed: true,
        manualBoundaryRect: {
          x: 100,
          y: 140,
          width: 300,
          height: 420,
          coordinateFrame: "basler_sensor_pixels",
        },
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
      status: "contract_ready",
      cardAssetId: "card-asset-1",
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

function createMockDelegate(name, calls, id, findUniqueValue) {
  return {
    async upsert(args) {
      calls.push({ delegate: name, method: "upsert", args });
      return {
        id,
        ...(args.create ?? {}),
        ...(args.update ?? {}),
      };
    },
    async findUnique(args) {
      calls.push({ delegate: name, method: "findUnique", args });
      if (findUniqueValue !== undefined) {
        return typeof findUniqueValue === "function" ? findUniqueValue(args) : findUniqueValue;
      }
      if (name === "aiGraderReport") {
        return {
          id: "db-report-1",
          tenantId: "tenant-1",
          sessionId: "db-session-1",
          reportId: args.where?.reportId ?? "report-1",
          cardAssetId: "card-asset-1",
          itemId: "item-1",
        };
      }
      if (name === "item") {
        return {
          id: "item-1",
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
      calls.push({ delegate: name, method: "findMany", args });
      if (name === "aiGraderLabel" && findUniqueValue !== undefined) {
        const value = typeof findUniqueValue === "function" ? findUniqueValue(args) : findUniqueValue;
        return value ? [value] : [];
      }
      return [];
    },
    async updateMany(args) {
      calls.push({ delegate: name, method: "updateMany", args });
      return { count: 1 };
    },
  };
}

function createMockProductionDb(options = {}) {
  const calls = [];
  const tx = {
    async $queryRaw() {
      calls.push({ delegate: "$queryRaw", method: "$queryRaw" });
      return [];
    },
    aiGraderSession: createMockDelegate("aiGraderSession", calls, "db-session-1"),
    aiGraderReport: createMockDelegate("aiGraderReport", calls, "db-report-1"),
    aiGraderEvidenceAsset: createMockDelegate("aiGraderEvidenceAsset", calls, "db-evidence-1"),
    aiGraderGrade: createMockDelegate("aiGraderGrade", calls, "db-grade-1"),
    aiGraderLabel: createMockDelegate("aiGraderLabel", calls, "db-label-1", options.existingLabel),
    aiGraderPublication: createMockDelegate("aiGraderPublication", calls, "db-publication-1"),
    aiGraderValuation: createMockDelegate("aiGraderValuation", calls, "db-valuation-1", options.existingValuation),
    cardAsset: createMockDelegate("cardAsset", calls, "card-asset-1"),
    item: createMockDelegate("item", calls, "item-1"),
  };
  return {
    calls,
    db: {
      ...tx,
      async $transaction(callback) {
        calls.push({ delegate: "$transaction", method: "$transaction" });
        return callback(tx);
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

test("production report keeps explicit manual geometry decisions while removing all private station data", () => {
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
  });
  const reportBundleArtifact = plan.artifacts.find((artifact) => artifact.kind === "report-bundle.json");
  const publicBundle = JSON.parse(reportBundleArtifact?.body ?? "{}");
  const frontGeometry = publicBundle.geometry.front;
  const frontDecision = publicBundle.geometryCaptureDecisions.front;

  assert.equal(frontGeometry.geometrySource, "manual_override");
  assert.equal(frontGeometry.captureMode, "manual_capture");
  assert.equal(frontGeometry.detectionUsed, false);
  assert.equal(frontGeometry.manualOverrideUsed, true);
  assert.equal(frontGeometry.marginLeftMm, undefined);
  assert.equal(frontGeometry.dimensions, undefined);
  assert.equal(frontDecision.mode, "manual_capture");
  assert.equal(frontDecision.geometrySource, "manual_override");
  assert.equal(frontDecision.captureMode, "manual_capture");
  assert.equal(frontDecision.placementState, "not_detected");
  assert.equal(frontDecision.explicitOperatorAction, true);
  assert.equal(frontDecision.detectionUsed, false);
  assert.equal(frontDecision.manualOverrideUsed, true);
  assert.deepEqual(frontDecision.manualBoundaryRect, {
    x: 100,
    y: 140,
    width: 300,
    height: 420,
    coordinateFrame: "basler_sensor_pixels",
  });
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
    /unsafe public image asset ID/,
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
    /duplicate public image asset IDs/,
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
  assert.equal(publicBundle.ocrPrefill.fields.playerName.reviewRequired, true);
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

test("production release persistence upserts durable records and optional card linkage", async () => {
  const { db, calls } = createMockProductionDb();
  const plan = buildAiGraderProductionStoragePlan({
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    publicReportBaseUrl: "https://collect.tenkings.co",
  });

  const result = await persistAiGraderProductionRelease(db, {
    tenantId: "tenant-1",
    reportBundle: sampleBundle(),
    productionRelease: sampleRelease(),
    storagePlan: plan,
    operatorUserId: "user-1",
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    persistedAt: "2026-07-02T12:30:00.000Z",
  });

  assert.equal(result.reportId, "report-1");
  assert.equal(result.publicationStatus, "published");
  assert.equal(result.evidenceAssetCount, plan.artifacts.length);
  assert.equal(result.cardAssetUpdatedCount, 1);
  assert.equal(result.itemUpdatedCount, 1);
  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`).slice(0, 11),
    [
      "$transaction.$transaction",
      "$queryRaw.$queryRaw",
      "aiGraderSession.upsert",
      "aiGraderReport.upsert",
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
  const sessionUpsert = calls.find((call) => call.delegate === "aiGraderSession" && call.method === "upsert");
  assert.equal(sessionUpsert.args.create.captureSummary.geometry.front.placementState, "not_detected");
  assert.equal(sessionUpsert.args.create.captureSummary.geometry.front.geometrySource, "manual_override");
  assert.equal(sessionUpsert.args.create.captureSummary.geometry.front.captureMode, "manual_capture");
  assert.equal(sessionUpsert.args.create.captureSummary.geometryCaptureDecisions.front.mode, "manual_capture");
  assert.equal(sessionUpsert.args.create.captureSummary.geometryCaptureDecisions.front.geometrySource, "manual_override");
  assert.equal(sessionUpsert.args.create.captureSummary.geometryCaptureDecisions.front.explicitOperatorAction, true);
  assert.equal(sessionUpsert.args.create.captureSummary.geometryCaptureDecisions.front.detectionUsed, false);
  assert.equal(sessionUpsert.args.create.captureSummary.geometryCaptureDecisions.front.manualOverrideUsed, true);
  assert.deepEqual(sessionUpsert.args.create.captureSummary.geometryCaptureDecisions.front.manualBoundaryRect, {
    x: 100,
    y: 140,
    width: 300,
    height: 420,
    coordinateFrame: "basler_sensor_pixels",
  });
  assert.doesNotMatch(
    JSON.stringify(sessionUpsert.args.create.captureSummary),
    /C:\\TenKings|127\.0\.0\.1|must-not-survive|data:image|X-Amz-Signature|stationToken|bridgeUrl|uploadUrl|hardwareControls|leimacOn/
  );
  assert.equal(sessionUpsert.args.create.captureSummary.captureTiming.summary.totalFrontMs, 4700);
  assert.equal(sessionUpsert.args.create.captureSummary.captureTiming.target.fiveSecondsPerSideProven, false);
  assert.equal(sessionUpsert.args.create.captureSummary.ocrPrefill.humanConfirmationRequired, true);
  assert.equal(sessionUpsert.args.create.captureSummary.ocrPrefill.fields.playerName.value, "Test Player");
  const cardUpdate = calls.find((call) => call.delegate === "cardAsset" && call.method === "updateMany");
  assert.equal(cardUpdate.args.data.aiGradeFinal, 8.6);
  assert.equal(cardUpdate.args.data.aiGradeLabel, "8.6");
  const itemUpdate = calls.find((call) => call.delegate === "item" && call.method === "updateMany");
  assert.equal(calls.some((call) => call.delegate === "item" && call.method === "findUnique"), true);
  assert.equal(itemUpdate.args.data.detailsJson.existingItemDetail, "keep-me");
  assert.deepEqual(itemUpdate.args.data.detailsJson.nestedItemDetail, { preserved: true });
  assert.equal(itemUpdate.args.data.detailsJson.aiGraderReportId, "report-1");
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

  const sessionUpsert = calls.find((call) => call.delegate === "aiGraderSession" && call.method === "upsert");
  assert.deepEqual(sessionUpsert.args.create.safetySummary.actorAudit, expectedAudit);

  const reportUpsert = calls.find((call) => call.delegate === "aiGraderReport" && call.method === "upsert");
  assert.deepEqual(reportUpsert.args.create.checksumSummary.actorAudit, expectedAudit);

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
