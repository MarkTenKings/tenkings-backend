const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AiGraderLocalStationBridgeService,
  buildAiGraderLocalStationBridgeConfig,
  createAiGraderLocalStationBridgeHttpServer,
} = require("../dist/drivers/aiGraderLocalStationBridge");
const {
  FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION,
} = require("../dist/drivers/fixedRigMathematicalStationAdapterV1");
const {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
  FIXED_RIG_MATHEMATICAL_FINDING_REVIEW_REQUEST_V1_VERSION,
} = require("../dist/drivers/fixedRigMathematicalCalibrationOrchestratorV1");
const {
  FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID,
} = require("../dist/drivers/fixedRigStandardCardFormatV1");

const BUNDLE_SHA256 = "a".repeat(64);
const CALIBRATION_ARTIFACT_SHA256 = "c".repeat(64);
const REVIEW_REQUEST_SHA256 = "d".repeat(64);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function printedAuthority() {
  return {
    schemaVersion: FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION,
    cardIdentity: {
      title: "Mathematical station fixture",
      sideCount: 2,
      tenantId: "tenant-fixture",
      setId: "set-fixture",
      programId: "program-fixture",
      cardNumber: "42",
      variantId: null,
      parallelId: null,
    },
    cardFormatId: FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID,
    sides: {
      front: { centering: { profile: "printed_border_v1" } },
      back: { centering: { profile: "printed_border_v1" } },
    },
  };
}

function registeredAuthority(referenceBytes, includeCallerPath = false) {
  const authority = printedAuthority();
  const artifactSha256 = sha256(referenceBytes);
  const approvedDesignArtifact = {
    assetId: "approved-front-design-reference",
    fileName: "approved-front-design-reference.png",
    contentType: "image/png",
    sha256: artifactSha256,
    ...(includeCallerPath ? { filePath: "C:\\caller-controlled\\reference.png" } : {}),
  };
  authority.sides.front.centering = {
    profile: "registered_design_template_v1",
    approvedReference: {
      tenantId: authority.cardIdentity.tenantId,
      setId: authority.cardIdentity.setId,
      programId: authority.cardIdentity.programId,
      cardNumber: authority.cardIdentity.cardNumber,
      variantId: authority.cardIdentity.variantId,
      parallelId: authority.cardIdentity.parallelId,
      referenceId: "approved-front-reference-v1",
      profile: "registered_design_template_v1",
      status: "approved",
      side: "front",
      version: "reference-v1",
      artifactSha256,
      artifactWidthPx: 1200,
      artifactHeightPx: 1680,
      intendedDesignBoundary: {
        coordinateFrame: "design_reference_pixels",
        contour: [[20, 20], [1180, 20], [1180, 1660], [20, 1660]],
      },
      approvedByUserId: "operator-fixture",
      approvedAt: "2026-07-19T12:00:00.000Z",
    },
    approvedDesignArtifact,
  };
  return authority;
}

function calibrationLoader() {
  return {
    bundlePath: "fixture-bundle",
    bundleSha256: BUNDLE_SHA256,
    bundle: {},
    profile: {
      profileId: "fixture-calibration-profile",
      calibrationVersion: "fixture-calibration-v1",
      rigId: "fixture-rig",
      artifactSha256: CALIBRATION_ARTIFACT_SHA256,
    },
    physicalArtifact: {},
    acceptance: {},
    authority: {},
    files: {},
  };
}

function createService(outputDir, builder) {
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 47652,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir,
    publicBasePath: "https://collect.tenkings.co/ai-grader/reports",
    mathematicalCalibrationRigId: "fixture-rig",
    mathematicalCalibrationBundlePath: path.join(
      outputDir,
      "fixed-rig-mathematical-calibration-bundle-v1.json",
    ),
    mathematicalCalibrationBundleSha256: BUNDLE_SHA256,
  });
  return new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    loadMathematicalCalibrationBundle: calibrationLoader,
    buildMathematicalStationPackage: builder,
  });
}

async function startMathematicalSession(service, authority = printedAuthority(), reportId = "math-report-fixture") {
  return service.action("start-session", {
    reportId,
    captureProfile: "full_forensic",
    gradingContract: "mathematical_calibration_v1",
    mathematicalGradingAuthority: authority,
  });
}

function assetMetadata(assetId, evidenceRole, bytes, fileName, widthPx = 24, heightPx = 32) {
  return {
    assetId,
    evidenceRole,
    sha256: sha256(bytes),
    fileName,
    contentType: "image/png",
    byteSize: bytes.byteLength,
    widthPx,
    heightPx,
  };
}

function attachWarmManifests(service, includeReviewSources = false) {
  const manifest = service.manifest;
  const sources = {};
  for (const side of ["front", "back"]) {
    const packageDir = path.join(manifest.outputs.sessionDir, side + "-warm-package");
    fs.mkdirSync(packageDir, { recursive: true });
    manifest.outputs[side + "PackageDir"] = packageDir;
    if (!includeReviewSources) {
      fs.writeFileSync(path.join(packageDir, "manifest.json"), "{}\n");
      continue;
    }
    const acceptedBytes = Buffer.from(side + "-accepted-profile-source");
    const acceptedPath = path.join(packageDir, side + "-accepted-profile.png");
    fs.writeFileSync(acceptedPath, acceptedBytes);
    const trueView = assetMetadata(
      side + "-accepted-profile",
      "normalized_card",
      acceptedBytes,
      path.basename(acceptedPath),
      1200,
      1680,
    );
    const directionalChannels = [];
    const channelEntries = [];
    for (let channel = 1; channel <= 8; channel += 1) {
      const channelBytes = Buffer.from(side + "-directional-channel-" + channel + "-source");
      const channelPath = path.join(packageDir, side + "-directional-channel-" + channel + ".png");
      fs.writeFileSync(channelPath, channelBytes);
      directionalChannels.push(assetMetadata(
        side + "-directional-channel-" + channel,
        "directional_channel",
        channelBytes,
        path.basename(channelPath),
        1200,
        1680,
      ));
      channelEntries.push({
        channel,
        analysisArtifact: {
          localOutputPath: channelPath,
          sha256: sha256(channelBytes),
        },
      });
    }
    fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify({
      [side]: {
        acceptedProfile: {
          analysisArtifact: {
            localOutputPath: acceptedPath,
            sha256: sha256(acceptedBytes),
          },
        },
        channels: channelEntries,
      },
    }, null, 2));
    sources[side] = { trueView, directionalChannels };
  }
  return sources;
}

function fakeGrade() {
  const element = (score) => ({ score });
  return {
    status: "final_mathematical_grade_v1",
    overall: 9.25,
    labelGrade: 9.3,
    elements: {
      centering: element(9.4),
      corners: element(9.2),
      edges: element(9.1),
      surface: element(9.3),
    },
    findings: [],
    confidence: { warnings: [] },
  };
}

function fakeSummary() {
  return {
    calibration: {
      profileId: "fixture-calibration-profile",
      version: "fixture-calibration-v1",
      artifactSha256: CALIBRATION_ARTIFACT_SHA256,
    },
    sides: {},
    scores: {
      centering: 9.4,
      corners: 9.2,
      edges: 9.1,
      surface: 9.3,
      overall: 9.25,
      label: 9.3,
    },
  };
}

function completedResult(input) {
  const outputDir = input.outputDir;
  return {
    version: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
    status: "completed",
    gradingContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    reportArtifact: {},
    reportPackage: {
      outputDir,
      bundlePath: path.join(outputDir, "report-bundle-v0.3.json"),
      envelopePath: path.join(outputDir, "mathematical-report-envelope-v1.json"),
      assetManifestPath: path.join(outputDir, "asset-manifest.json"),
      checksumsPath: path.join(outputDir, "checksums.json"),
      envelope: {
        schemaVersion: "ai-grader-mathematical-report-envelope-v1",
        gradingSessionId: input.gradingSessionId,
        reportBundle: {
          schemaVersion: "ai-grader-report-bundle-v0.3",
          reportId: input.reportId,
        },
      },
      assetManifest: {},
      checksums: {},
    },
    stationInput: {
      gradingContract: "mathematical_calibration_v1",
      mathematicalReportPackagePath: outputDir,
    },
    grade: fakeGrade(),
    orchestrationTraceSha256: "e".repeat(64),
    summary: fakeSummary(),
  };
}

function findingReviewFixture(input, warmSources) {
  const generated = {
    roi: {
      bytes: Buffer.from("exact-review-roi"),
      role: "roi_crop",
      fileName: "surface-fixture-roi.png",
    },
    segmentationMask: {
      bytes: Buffer.from("exact-review-segmentation"),
      role: "segmentation_mask",
      fileName: "surface-fixture-segmentation.png",
    },
    confidenceMask: {
      bytes: Buffer.from("exact-review-confidence"),
      role: "confidence_mask",
      fileName: "surface-fixture-confidence.png",
    },
    illuminationMask: {
      bytes: Buffer.from("exact-review-illumination"),
      role: "illumination_mask",
      fileName: "surface-fixture-illumination.png",
    },
  };
  const reviewEvidence = {};
  const reviewAssets = [];
  for (const [name, source] of Object.entries(generated)) {
    const metadata = assetMetadata(
      "surface-fixture-" + source.role,
      source.role,
      source.bytes,
      source.fileName,
      40,
      50,
    );
    reviewEvidence[name] = metadata;
    reviewAssets.push({ ...metadata, bytes: source.bytes });
  }
  const finding = {
    findingId: "surface-fixture-finding",
    physicalDefectId: "surface-fixture-physical-defect",
    element: "surface",
    category: "scratch",
    side: "front",
    location: "front surface center",
    regionId: "front-surface-center",
    geometry: {
      coordinateFrame: "normalized_card",
      kind: "box",
      x: 0.2,
      y: 0.3,
      width: 0.1,
      height: 0.08,
    },
    detector: { id: "fixture-scratch-detector", version: "v1" },
    measuredDeduction: 0.42,
    measurements: [],
    evidenceAssetIds: [
      warmSources.front.trueView.assetId,
      ...warmSources.front.directionalChannels.map((asset) => asset.assetId),
      ...Object.values(reviewEvidence).map((asset) => asset.assetId),
    ],
    trueView: warmSources.front.trueView,
    directionalChannels: warmSources.front.directionalChannels,
    reviewEvidence,
    explanation: "One measured scratch requires an explicit disposition.",
  };
  return {
    request: {
      schemaVersion: FIXED_RIG_MATHEMATICAL_FINDING_REVIEW_REQUEST_V1_VERSION,
      gradingContract: "mathematical_calibration_v1",
      gradingSessionId: input.gradingSessionId,
      reportId: input.reportId,
      generatedAt: input.generatedAt,
      calibration: {
        profileId: "fixture-calibration-profile",
        calibrationVersion: "fixture-calibration-v1",
        artifactSha256: CALIBRATION_ARTIFACT_SHA256,
      },
      findings: [finding],
      hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
      artifactSha256: REVIEW_REQUEST_SHA256,
    },
    reviewAssets,
    rawBytes: Object.fromEntries(
      Object.entries(generated).map(([name, value]) => [name, value.bytes]),
    ),
  };
}

function findingRequiredResult(input, fixture) {
  return {
    version: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
    status: "finding_review_required",
    gradingContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    failedStage: "finding_review",
    reviewRequest: fixture.request,
    reviewAssets: fixture.reviewAssets,
    reviewIssues: ["Finding surface-fixture-finding requires explicit operator review."],
    grade: fakeGrade(),
    summary: fakeSummary(),
    reportPackage: null,
    stationInput: null,
  };
}

function insufficientResult() {
  return {
    version: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
    status: "insufficient_evidence",
    gradingContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    failedStage: "surface_measurement",
    reasons: ["Front center is fully obscured in every usable directional channel."],
    requiresRecapture: true,
    requiresApprovedDesignReference: false,
    requiresCalibration: false,
    requiresImplementationCorrection: false,
    reportPackage: null,
    stationInput: null,
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function postWithoutToken(server, body) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: "/mathematical-v1/design-reference-artifacts/front",
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(body.byteLength),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("ordinary Mathematical V1 no-finding completion uses station-derived publication and no V0 fallback", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-station-complete-"));
  const calls = [];
  try {
    const service = createService(outputDir, async (input) => {
      calls.push(input);
      return completedResult(input);
    });
    const browserAuthority = printedAuthority();
    await startMathematicalSession(service, browserAuthority, "ordinary-math-report");
    attachWarmManifests(service);
    const result = await service.action("run-diagnostics");
    assert.equal(result.mathematicalV1.execution.status, "completed");
    assert.equal(result.mathematicalV1.execution.v0FallbackUsed, false);
    assert.equal(calls.length, 1);
    assert.equal("publication" in browserAuthority, false);
    const expectedUrl = "https://collect.tenkings.co/ai-grader/reports/ordinary-math-report";
    const expectedCert = "TK-AIG-" + crypto.createHash("sha1")
      .update("ordinary-math-report")
      .digest("hex")
      .slice(0, 8)
      .toUpperCase();
    assert.deepEqual(calls[0].authority.publication, {
      certId: expectedCert,
      publicReportUrl: expectedUrl,
      qrPayloadUrl: expectedUrl,
    });
    assert.equal(calls[0].findingReviews, undefined);
    assert.equal(result.outputs.unifiedReportPath.endsWith("report-bundle-v0.3.json"), true);
    assert.equal(result.outputs.unifiedReportPath.includes("mock-unified-report"), false);

    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/drivers/aiGraderLocalStationBridge.ts"),
      "utf8",
    );
    const mathematicalReleaseBranch = source.slice(
      source.indexOf('if (gradingContractFor(manifest) === "mathematical_calibration_v1")'),
      source.indexOf("private async writeLegacyProductionReleaseForManifest"),
    );
    assert.equal(
      mathematicalReleaseBranch.includes("writeAiGraderMathematicalProductionReleaseV1"),
      true,
    );
    assert.equal(
      mathematicalReleaseBranch.includes("AI_GRADER_MATHEMATICAL_PRODUCTION_RELEASE_V1_VERSION"),
      true,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("finding review persists and serves exact True View, directional, ROI, segmentation, confidence, and illumination evidence before deterministic rerun", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-station-review-"));
  const calls = [];
  let reviewFixture;
  try {
    const service = createService(outputDir, async (input) => {
      calls.push(input);
      if (!input.findingReviews) {
        reviewFixture = findingReviewFixture(input, warmSources);
        return findingRequiredResult(input, reviewFixture);
      }
      return completedResult(input);
    });
    await startMathematicalSession(service, printedAuthority(), "finding-review-report");
    const warmSources = attachWarmManifests(service, true);
    const pending = await service.action("run-diagnostics");
    assert.equal(pending.mathematicalV1.execution.status, "finding_review_required");
    assert.equal(
      pending.mathematicalV1.execution.reviewRequest.artifactSha256,
      REVIEW_REQUEST_SHA256,
    );
    assert.equal(Object.keys(pending.mathematicalV1.reviewAssets).length, 13);
    const persisted = JSON.parse(fs.readFileSync(pending.outputs.manifestPath, "utf8"));
    assert.equal(
      persisted.mathematicalV1.execution.reviewRequest.artifactSha256,
      REVIEW_REQUEST_SHA256,
    );
    assert.equal(Object.keys(persisted.mathematicalV1.reviewAssets).length, 13);

    const requestFinding = pending.mathematicalV1.execution.reviewRequest.findings[0];
    const expectedRoles = new Set([
      "normalized_card",
      "directional_channel",
      "roi_crop",
      "segmentation_mask",
      "confidence_mask",
      "illumination_mask",
    ]);
    const allRequestedMetadata = [
      requestFinding.trueView,
      ...requestFinding.directionalChannels,
      requestFinding.reviewEvidence.roi,
      requestFinding.reviewEvidence.segmentationMask,
      requestFinding.reviewEvidence.confidenceMask,
      requestFinding.reviewEvidence.illuminationMask,
    ];
    for (const metadata of allRequestedMetadata) {
      const served = await service.mathematicalReviewAsset(
        "finding-review-report",
        metadata.assetId,
      );
      assert.equal(served.sha256, metadata.sha256);
      assert.equal(sha256(served.bytes), metadata.sha256);
      assert.equal(served.evidenceRole, metadata.evidenceRole);
      assert.equal(served.widthPx, metadata.widthPx);
      assert.equal(served.heightPx, metadata.heightPx);
      assert.equal(expectedRoles.has(served.evidenceRole), true);
      assert.equal(
        path.resolve(pending.mathematicalV1.reviewAssets[metadata.assetId].filePath)
          .startsWith(path.resolve(pending.outputs.sessionDir)),
        true,
      );
    }
    const roiServed = await service.mathematicalReviewAsset(
      "finding-review-report",
      requestFinding.reviewEvidence.roi.assetId,
    );
    assert.deepEqual(roiServed.bytes, reviewFixture.rawBytes.roi);

    const baseReview = {
      findingId: requestFinding.findingId,
      reviewRequestSha256: REVIEW_REQUEST_SHA256,
      status: "confirmed",
      reviewedAt: "2026-07-19T13:00:00.000Z",
    };
    await assert.rejects(
      service.action("submit-mathematical-finding-reviews", {
        mathematicalReviewRequestSha256: REVIEW_REQUEST_SHA256,
        mathematicalFindingReviews: [{ ...baseReview, confidence: 1 }],
      }),
      /fields do not match|confidence/i,
    );
    await assert.rejects(
      service.action("submit-mathematical-finding-reviews", {
        mathematicalReviewRequestSha256: "f".repeat(64),
        mathematicalFindingReviews: [baseReview],
      }),
      /exact pending request SHA-256/i,
    );

    const completed = await service.action("submit-mathematical-finding-reviews", {
      mathematicalReviewRequestSha256: REVIEW_REQUEST_SHA256,
      mathematicalFindingReviews: [baseReview],
    });
    assert.equal(completed.mathematicalV1.execution.status, "completed");
    assert.equal(completed.mathematicalV1.execution.attempt, 2);
    assert.equal(completed.mathematicalV1.reviewAssets, undefined);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].findingReviews, [baseReview]);
    assert.equal("confidence" in calls[1].findingReviews[0], false);
    assert.equal(calls[0].generatedAt, calls[1].generatedAt);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("insufficient Mathematical evidence persists exact stage, reasons, flags, and rejects V0 export fallback", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-station-insufficient-"));
  try {
    const service = createService(outputDir, async () => insufficientResult());
    await startMathematicalSession(service, printedAuthority(), "insufficient-math-report");
    attachWarmManifests(service);
    const result = await service.action("run-diagnostics");
    assert.deepEqual(result.mathematicalV1.execution, {
      status: "insufficient_evidence",
      completedAt: result.mathematicalV1.execution.completedAt,
      attempt: 1,
      v0FallbackUsed: false,
      failedStage: "surface_measurement",
      reasons: ["Front center is fully obscured in every usable directional channel."],
      requiresRecapture: true,
      requiresApprovedDesignReference: false,
      requiresCalibration: false,
      requiresImplementationCorrection: false,
    });
    assert.equal(result.outputs.reportBundlePath, undefined);
    assert.equal(result.productionRelease, undefined);
    await assert.rejects(
      service.action("export-report-bundle"),
      /not ready|V0\/manual fallback is prohibited/i,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("registered design-reference staging is bounded, session-bound, create-new, path-free at the caller boundary, and tamper-evident", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-reference-stage-"));
  const referenceBytes = Buffer.from("exact approved printable design reference fixture bytes");
  try {
    const service = createService(outputDir, async (input) => completedResult(input));
    await assert.rejects(
      startMathematicalSession(
        service,
        registeredAuthority(referenceBytes, true),
        "caller-path-rejected-report",
      ),
      /fields do not match the exact station contract/i,
    );
    const authority = registeredAuthority(referenceBytes);
    await startMathematicalSession(service, authority, "registered-reference-report");
    const sessionId = service.status().sessionId;
    const headers = {
      sessionId,
      side: "front",
      referenceId: authority.sides.front.centering.approvedReference.referenceId,
      sha256: sha256(referenceBytes),
      contentType: "image/png",
    };
    assert.throws(
      () => service.assertMathematicalDesignReferenceStageRequest({
        ...headers,
        sessionId: "wrong-session",
      }),
      /exact active Mathematical V1 session/i,
    );
    await assert.rejects(
      service.stageMathematicalDesignReference({
        ...headers,
        declaredByteSize: 64 * 1024 * 1024 + 1,
        bytes: referenceBytes,
      }),
      /Content-Length.*bounded bytes/i,
    );
    const staged = await service.stageMathematicalDesignReference({
      ...headers,
      declaredByteSize: referenceBytes.byteLength,
      bytes: referenceBytes,
    });
    assert.equal(staged.sha256, sha256(referenceBytes));
    assert.equal(staged.byteSize, referenceBytes.byteLength);
    assert.equal(path.resolve(staged.filePath).startsWith(path.resolve(outputDir)), true);
    await assert.rejects(
      service.stageMathematicalDesignReference({
        ...headers,
        declaredByteSize: referenceBytes.byteLength,
        bytes: referenceBytes,
      }),
      /already has an immutable staged design reference|cannot overwrite/i,
    );
    fs.writeFileSync(staged.filePath, Buffer.from("tampered"));
    await assert.rejects(
      service.action("capture-front"),
      /changed after staging/i,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("Mathematical binary staging HTTP endpoint rejects unauthenticated bodies before staging", async () => {
  const outputDir = path.join(
    os.tmpdir(),
    "tenkings-math-reference-http-" + crypto.randomUUID(),
  );
  const server = createAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 47652,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir,
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const response = await postWithoutToken(server, Buffer.alloc(24, 7));
    assert.equal(response.statusCode, 401);
    assert.match(response.body, /STATION_BRIDGE_UNAUTHORIZED/);
  } finally {
    if (server.listening) await closeServer(server);
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }
});

test("Rapid Mathematical finding review stays reviewable while next-card capture continues, then reaches strict release-ready without auto-confirm or fallback", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-rapid-review-"));
  let warmSources;
  let reviewFixture;
  let adapterCallCount = 0;
  try {
    const service = createService(outputDir, async (input) => {
      adapterCallCount += 1;
      if (!input.findingReviews) {
        reviewFixture = findingReviewFixture(input, warmSources);
        return findingRequiredResult(input, reviewFixture);
      }
      return completedResult(input);
    });
    await service.action("configure-rapid-capture", { rapidCaptureEnabled: true });
    await startMathematicalSession(service, printedAuthority(), "rapid-math-review-report");
    const detachedSessionId = service.status().sessionId;
    warmSources = attachWarmManifests(service, true);
    const continued = await service.action("queue-current-card");
    assert.notEqual(continued.sessionId, detachedSessionId);
    assert.equal(continued.gradingContract, "mathematical_calibration_v1");
    assert.equal(continued.mathematicalV1, undefined);
    assert.equal(continued.frontCaptureReadiness.code, "mathematical_authority_required");

    let queued;
    for (let index = 0; index < 100; index += 1) {
      queued = service.status().rapidCaptureQueue.items.find(
        (item) => item.reportId === "rapid-math-review-report",
      );
      if (queued?.state === "finding_review_required") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(queued.state, "finding_review_required");
    assert.equal(queued.mathematicalV1.status, "finding_review_required");
    assert.equal(queued.mathematicalV1.reviewRequestSha256, REVIEW_REQUEST_SHA256);
    assert.equal(queued.autoConfirmed, false);
    assert.equal(queued.autoPublished, false);
    assert.equal(queued.error, undefined);

    await service.action("activate-queue-item", { queueItemId: queued.queueItemId });
    service.writeProductionReleaseForManifest = async (manifest) => {
      manifest.outputs.productionReleasePath = path.join(
        manifest.outputs.sessionDir,
        "production-release.json",
      );
      manifest.outputs.labelDataPath = path.join(manifest.outputs.sessionDir, "label-data.json");
      return {
        schemaVersion: "ai-grader-mathematical-production-release-v1",
        reportId: manifest.reportId,
        gradingSessionId: manifest.sessionId,
        finalGradeComputed: true,
        labelDataGenerated: true,
        qrPayloadGenerated: true,
        label: { status: "label_data_ready" },
      };
    };
    const finding = service.status().mathematicalV1.execution.reviewRequest.findings[0];
    const review = {
      findingId: finding.findingId,
      reviewRequestSha256: REVIEW_REQUEST_SHA256,
      status: "confirmed",
      reviewedAt: "2026-07-19T14:00:00.000Z",
    };
    const ready = await service.action("submit-mathematical-finding-reviews", {
      mathematicalReviewRequestSha256: REVIEW_REQUEST_SHA256,
      mathematicalFindingReviews: [review],
      operatorId: "rapid-review-operator",
      warningsAccepted: true,
    });
    const completedQueueItem = ready.rapidCaptureQueue.items.find(
      (item) => item.queueItemId === queued.queueItemId,
    );
    assert.equal(completedQueueItem.state, "report_ready_needs_confirm");
    assert.equal(completedQueueItem.mathematicalV1.status, "completed");
    assert.equal(completedQueueItem.autoConfirmed, false);
    assert.equal(completedQueueItem.autoPublished, false);
    assert.equal(ready.mathematicalV1.execution.v0FallbackUsed, false);
    assert.equal(ready.currentStep, "label_data_ready");
    assert.equal(adapterCallCount, 2);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
