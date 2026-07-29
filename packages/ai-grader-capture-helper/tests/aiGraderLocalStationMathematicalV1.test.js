const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  AiGraderLocalStationBridgeService,
  buildAiGraderLocalStationBridgeConfig,
  createAiGraderLocalStationBridgeHttpServer,
} = require("../dist/drivers/aiGraderLocalStationBridge");
const {
  FixedRigMathematicalStationWorkerPoolV1,
} = require("../dist/drivers/fixedRigMathematicalStationWorkerV1");
const {
  assertFixedRigMathematicalWarmSideCaptureProfileV1,
  FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION,
} = require("../dist/drivers/fixedRigMathematicalStationAdapterV1");
const {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
  FIXED_RIG_MATHEMATICAL_FINDING_REVIEW_REQUEST_V1_VERSION,
} = require("../dist/drivers/fixedRigMathematicalCalibrationOrchestratorV1");
const {
  FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID,
} = require("../dist/drivers/fixedRigStandardCardFormatV1");
const {
  FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
  buildFixedRigOperatorResolutionRequestV1,
  hashFixedRigOperatorResolutionValueV1,
} = require("../dist/drivers/fixedRigOperatorResolutionAuthorityV1");
const {
  AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_DOMAIN_V1,
  AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_V1,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
  canonicalJsonV1,
} = require("@tenkings/shared");

const BUNDLE_SHA256 = "a".repeat(64);
const CALIBRATION_ARTIFACT_SHA256 = "c".repeat(64);
const REVIEW_REQUEST_SHA256 = "d".repeat(64);
const OPERATOR_AUTH_HMAC_KEY = "operator-resolution-test-hmac-key-material-0001";
const OPERATOR_AUTH_HMAC_KEY_ID = "operator-resolution-test-key-v1";
const RAW_ROLES = [
  "dark_control",
  "all_on",
  "accepted_profile",
  ...Array.from({ length: 8 }, (_, index) => `channel_${index + 1}`),
];
const OCR_FIELDS = [
  "category", "playerName", "cardName", "year", "manufacturer", "sport", "game",
  "productSet", "cardNumber", "parallel", "insert", "numbered", "autograph", "memorabilia",
];

test("Mathematical ingestion accepts only the one production-fast full-forensic TIFF side contract", () => {
  const exact = {
    status: "completed",
    executionPath: "warm_full_forensic_runner",
    captureProfile: "production_fast",
    evidenceSide: "front",
    captureProfilePlan: {
      rawEvidenceFormat: "tiff",
      evidenceRoles: "full_forensic",
      productionFastOptIn: true,
    },
  };
  assert.doesNotThrow(() =>
    assertFixedRigMathematicalWarmSideCaptureProfileV1(exact, "front"));
  for (const drift of [
    { captureProfile: "full_forensic" },
    { executionPath: "cold_command_fallback" },
    { captureProfilePlan: { ...exact.captureProfilePlan, rawEvidenceFormat: "png" } },
    { captureProfilePlan: { ...exact.captureProfilePlan, evidenceRoles: "reduced" } },
    { captureProfilePlan: { ...exact.captureProfilePlan, productionFastOptIn: false } },
  ]) {
    assert.throws(
      () => assertFixedRigMathematicalWarmSideCaptureProfileV1({
        ...exact,
        ...drift,
      }, "front"),
      /production-fast package with full-forensic TIFF evidence/,
    );
  }
});

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

const CARD_FORMAT_HMAC_KEY = "test-only-bridge-card-format-hmac-key-0001";
const CARD_FORMAT_HMAC_KEY_ID = "bridge-card-format-v1";

function pokemonAuthority() {
  const cardIdentity = {
    title: "Trusted Pokemon station fixture",
    sideCount: 2,
    tenantId: "tenant-fixture",
    setId: "pokemon-set-fixture",
    programId: "pokemon",
    cardNumber: "25-102",
    variantId: null,
    parallelId: null,
  };
  const artifact = {
    resolverVersion: "ten-kings-hosted-card-format-resolver-v1",
    cardIdentity,
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
      recordId: "hosted-pokemon-card-25",
      recordUpdatedAt: "2026-07-21T12:00:00.000Z",
      recordSha256: "1".repeat(64),
    },
    identitySourceArtifact: {
      artifactType: "set_taxonomy_source",
      artifactId: "pokemon-taxonomy-source",
      artifactSha256: "2".repeat(64),
      trustStatus: "trusted",
    },
    provenance: {
      authority: "ten_kings_hosted_immutable_card_identity",
      physicalFormatAuthority: "ten_kings_owner_approved_card_format_record",
      browserSelfDeclarationAccepted: false,
    },
  };
  const bytes = canonicalJsonV1(artifact);
  return {
    schemaVersion: FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION,
    cardIdentity,
    cardFormatId: "pokemon_tcg_standard",
    trustedCardFormatAuthority: {
      schemaVersion: "ten-kings-trusted-card-format-authority-v1",
      artifact,
      artifactSha256: sha256(Buffer.from(bytes, "utf8")),
      authentication: {
        algorithm: "hmac-sha256",
        keyId: CARD_FORMAT_HMAC_KEY_ID,
        signature: crypto.createHmac("sha256", CARD_FORMAT_HMAC_KEY)
          .update(bytes, "utf8")
          .digest("hex"),
      },
    },
    sides: {
      front: { centering: { profile: "printed_border_v1" } },
      back: { centering: { profile: "printed_border_v1" } },
    },
  };
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

function createService(
  outputDir,
  builder,
  configOverrides = {},
  dependencyOverrides = {},
) {
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 47652,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir,
    captureProfile: "production_fast",
    publicBasePath: "https://collect.tenkings.co/ai-grader/reports",
    mathematicalCalibrationRigId: "fixture-rig",
    mathematicalCalibrationBundlePath: path.join(
      outputDir,
      "fixed-rig-mathematical-calibration-bundle-v1.json",
    ),
    mathematicalCalibrationBundleSha256: BUNDLE_SHA256,
    cardFormatAuthorityHmacKey: OPERATOR_AUTH_HMAC_KEY,
    cardFormatAuthorityHmacKeyId: OPERATOR_AUTH_HMAC_KEY_ID,
    ...configOverrides,
  });
  return new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    loadMathematicalCalibrationBundle: calibrationLoader,
    buildMathematicalStationPackage: builder,
    // Mathematical fixtures share the Dell host with Production and must not
    // scan for or terminate its live Basler preview process.
    stopOrphanedPreviewStreamsUntilReleased: async () => 0,
    ...dependencyOverrides,
  });
}

async function startMathematicalSession(service, authority = printedAuthority(), reportId = "math-report-fixture") {
  return service.action("start-session", {
    reportId,
    captureProfile: "production_fast",
    gradingContract: "mathematical_calibration_v1",
    mathematicalGradingAuthority: authority,
  });
}

test("a delayed local start remains singular and exposes a definitive lifecycle for timeout reconciliation", async (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-delayed-start-lifecycle-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const service = createService(outputDir, async () => {
    throw new Error("report builder is not used during Start New Card");
  });
  const originalCreateFreshSession = service.createFreshSession.bind(service);
  let releaseStart;
  const startRelease = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let markEntered;
  const startEntered = new Promise((resolve) => {
    markEntered = resolve;
  });
  let createCount = 0;
  service.createFreshSession = async (...args) => {
    createCount += 1;
    markEntered();
    await startRelease;
    return originalCreateFreshSession(...args);
  };

  const authorityA = printedAuthority();
  const authorityASha256 = sha256(canonicalJsonV1(authorityA));
  const firstStart = startMathematicalSession(
    service,
    authorityA,
    "delayed-start-report",
  );
  await startEntered;
  assert.deepEqual(service.status().startSessionLifecycle, {
    state: "pending",
    operation: {
      reportId: "delayed-start-report",
      mathematicalAuthoritySha256: authorityASha256,
    },
  });
  await assert.rejects(
    startMathematicalSession(
      service,
      printedAuthority(),
      "overlapping-start-report",
    ),
    /already pending|definitive persisted outcome/i,
  );
  assert.equal(createCount, 1);

  releaseStart();
  const completed = await firstStart;
  assert.deepEqual(completed.startSessionLifecycle, {
    state: "idle",
    operation: {
      reportId: "delayed-start-report",
      gradingSessionId: completed.sessionManifest.gradingSessionId,
      mathematicalAuthoritySha256: authorityASha256,
    },
  });
  assert.equal(completed.currentStep, "capture_front");
  assert.equal(completed.reportId, "delayed-start-report");
  assert.equal(createCount, 1);
  const persistedSessions = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("ai-grader-browser-station-session-"));
  assert.equal(persistedSessions.length, 1);
  const persisted = JSON.parse(fs.readFileSync(
    path.join(outputDir, persistedSessions[0].name, "station-session.json"),
    "utf8",
  ));
  assert.deepEqual(persisted.startOperationIdentity, {
    reportId: "delayed-start-report",
    gradingSessionId: completed.sessionManifest.gradingSessionId,
    mathematicalAuthoritySha256: authorityASha256,
  });
  assert.equal(
    JSON.stringify(persisted).includes("overlapping-start-report"),
    false,
    "card B never reaches persisted staging or cache identity",
  );
});

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

function rawRoles(seed) {
  return RAW_ROLES.map((role, index) => ({
    role,
    sha256: crypto.createHash("sha256").update(`${seed}:${role}:${index}`).digest("hex"),
    byteSize: 1000 + index,
    mimeType: "image/tiff",
  }));
}

function capturePayload(manifest, side, seed) {
  const packageId = `${seed}-${side}-package`;
  const entries = Object.fromEntries(rawRoles(`${seed}:${side}`).map((role) => [role.role, {
    role: role.role,
    capture: {
      mimeType: "image/tiff",
      savedImageFormat: "TIFF",
      sha256: role.sha256,
      byteSize: role.byteSize,
    },
  }]));
  return {
    captureProfile: "production_fast",
    rawEvidenceFormat: "tiff",
    packageId,
    warmBatch: {
      side,
      captures: {
        darkControl: entries.dark_control,
        allOn: entries.all_on,
        acceptedProfile: entries.accepted_profile,
        channels: Array.from({ length: 8 }, (_, index) => entries[`channel_${index + 1}`]),
      },
    },
    sideProcessingJob: {
      requestId: `${seed}-${side}-processing-request`,
      sessionId: manifest.sessionId,
      side,
      packageId,
      acceptedAt: new Date().toISOString(),
    },
  };
}

function bindReadyPreview(service, side, suffix) {
  const manifest = service.manifest;
  const frameId = `${side}-frame-${suffix}`;
  const timestamp = new Date().toISOString();
  const box = { x: 198, y: 277.5, width: 504, height: 705 };
  const corners = {
    topLeft: { x: box.x, y: box.y },
    topRight: { x: box.x + box.width, y: box.y },
    bottomRight: { x: box.x + box.width, y: box.y + box.height },
    bottomLeft: { x: box.x, y: box.y + box.height },
  };
  const points = [];
  for (let index = 0; index < 8; index += 1) {
    const fraction = index / 8;
    points.push({ x: box.x + box.width * fraction, y: box.y });
    points.push({ x: box.x + box.width, y: box.y + box.height * fraction });
    points.push({ x: box.x + box.width * (1 - fraction), y: box.y + box.height });
    points.push({ x: box.x, y: box.y + box.height * (1 - fraction) });
  }
  const sourceAssetSha256 = crypto.createHash("sha256")
    .update(`preview-${side}-${suffix}`)
    .digest("hex");
  const contourSha256 = crypto.createHash("sha256").update(JSON.stringify({
    sourceAssetSha256,
    coordinateFrame: "source_image_pixels",
    points,
  })).digest("hex");
  const physicalMeasurementPayload = {
    calibration: {
      profileId: "fixture-sensor-plane",
      calibrationVersion: "fixture-v1",
      calibrationArtifactSha256: crypto.createHash("sha256").update("fixture-calibration").digest("hex"),
      bundleManifestSha256: crypto.createHash("sha256").update("fixture-bundle").digest("hex"),
      sourceWidthPx: 900,
      sourceHeightPx: 1260,
      effectiveMmPerPixelX: 63.5 / box.width,
      effectiveMmPerPixelY: 88.9 / box.height,
    },
    width: 63.5,
    height: 88.9,
    perimeter: 304.8,
    enclosedArea: 5645.15,
    angleDegrees: 0,
    circularArcs: [],
    privateUncertaintyU95: {
      widthMm: 0.08,
      heightMm: 0.08,
      radiusMm: 0.05,
      basis: "calibrated_scale_boundary_and_repeatability_rss",
    },
  };
  const observedDenseContour = {
    schemaVersion: "ten-kings-card-geometry-observed-dense-contour-v1",
    coordinateFrame: "source_image_pixels",
    sourceAssetSha256,
    points,
    pointCount: points.length,
    contourSha256,
    strongSupportFraction: 0.92,
    evidenceQuality: "strong",
    measurementsPx: {
      width: box.width,
      height: box.height,
      perimeter: 2 * (box.width + box.height),
      enclosedArea: box.width * box.height,
      angleDegrees: 0,
      circularArcs: [],
    },
    measurementsMm: {
      ...physicalMeasurementPayload,
      measurementAuthoritySha256: crypto.createHash("sha256").update(JSON.stringify({
        contourSha256,
        ...physicalMeasurementPayload,
      })).digest("hex"),
    },
  };
  const geometry = {
    version: "ten-kings-card-geometry-v1",
    detectionPolicy: "live_preview_fast",
    side,
    placementState: "ready",
    adjustmentReason: null,
    geometrySource: "detected",
    captureMode: "automatic_detection",
    confidenceBasis: "automatic_detection",
    detectionUsed: true,
    manualOverrideUsed: false,
    corners,
    detectedCorners: corners,
    observedDenseContour,
    boundingBox: box,
    rotationDegrees: 0,
    skewDegrees: 0,
    confidence: 0.96,
    sourceImageId: `preview-${side}`,
    sourceFrameId: frameId,
    timestamp,
    sessionId: manifest.sessionId,
    sideEpoch: manifest.previewStatus.sideEpoch,
    image: { width: 900, height: 1260, coordinateFrame: "source_image_pixels" },
    semanticOrientation: { canonicalOrientation: "portrait", basis: "operator_top_toward_preview_top", contentUprightVerified: false },
    placement: {
      centerOffsetPixels: { x: 0, y: 0, distance: 0, maxAxis: 0 },
      centerOffsetInches: { x: 0, y: 0, distance: 0, maxAxis: 0 },
      estimatedPixelsPerInch: 201.6,
      maxCenterOffsetInches: 0.5,
      maxSkewDegrees: 10,
      maxNormalizationSkewDegrees: 35,
      minReadyConfidence: 0.72,
      withinCenterTolerance: true,
      withinSkewTolerance: true,
      withinNormalizationSkewTolerance: true,
      withinAspectTolerance: true,
      withinFrame: true,
      confidenceReady: true,
    },
    detection: {
      method: "adaptive_border_contrast_connected_component_pca_v1",
      backgroundLuma: 20,
      contrastRange: 180,
      foregroundThreshold: 54,
      foregroundPixelFraction: 0.3133,
      componentPixelFraction: 0.3133,
      measuredAspectRatio: 1.3988,
      relativeAspectError: 0.0009,
      expectedAspectRatio: 1.4,
      analysisWidth: 731,
      analysisHeight: 1024,
    },
    warnings: [],
  };
  manifest.previewStatus.status = "live";
  manifest.previewStatus.cameraOwnership = "preview_stream";
  manifest.previewStatus.sessionId = manifest.sessionId;
  manifest.previewStatus.activeSide = side;
  manifest.previewStatus.latestFrameId = frameId;
  manifest.previewStatus.lastFrameAt = timestamp;
  manifest.previewStatus.positioningLightReady = true;
  manifest.previewStatus.cardGeometry[side] = geometry;
  service.retainPreviewObservation(
    { sessionId: manifest.sessionId, side, sideEpoch: manifest.previewStatus.sideEpoch },
    frameId,
    timestamp,
  );
  service.retainPreviewGeometryObservation(geometry);
  if (side === "back") {
    manifest.liveLighting.backPositioning = {
      ...manifest.liveLighting.backPositioning,
      status: "ready",
      captureReady: true,
      sessionId: manifest.sessionId,
      sideEpoch: manifest.previewStatus.sideEpoch,
      profileIdentity: service.durableAcceptedCaptureProfile().identity,
    };
  }
  return {
    idempotencyKey: `atomic-${side}-${suffix}-mathematical-idempotency`,
    expectedSessionId: manifest.sessionId,
    expectedReportId: manifest.reportId,
    expectedSide: side,
    expectedSideEpoch: manifest.previewStatus.sideEpoch,
    expectedFrameId: frameId,
    geometryCaptureMode: "detected_geometry",
    captureTriggerMode: "operator",
    captureTriggerAt: new Date().toISOString(),
  };
}

async function processedMathematicalSide(side, packageDir, includeReviewSources) {
  fs.mkdirSync(packageDir, { recursive: true });
  const reviewSource = {};
  let diskManifest = {};
  if (includeReviewSources) {
    const acceptedBytes = Buffer.from(side + "-accepted-profile-source");
    const acceptedPath = path.join(packageDir, side + "-accepted-profile.png");
    fs.writeFileSync(acceptedPath, acceptedBytes);
    reviewSource.trueView = assetMetadata(
      side + "-accepted-profile",
      "normalized_card",
      acceptedBytes,
      path.basename(acceptedPath),
      1200,
      1680,
    );
    reviewSource.directionalChannels = [];
    const channelEntries = [];
    for (let channel = 1; channel <= 8; channel += 1) {
      const channelBytes = Buffer.from(side + "-directional-channel-" + channel + "-source");
      const channelPath = path.join(packageDir, side + "-directional-channel-" + channel + ".png");
      fs.writeFileSync(channelPath, channelBytes);
      reviewSource.directionalChannels.push(assetMetadata(
        side + "-directional-channel-" + channel,
        "directional_channel",
        channelBytes,
        path.basename(channelPath),
        1200,
        1680,
      ));
      channelEntries.push({
        channel,
        analysisArtifact: { localOutputPath: channelPath, sha256: sha256(channelBytes) },
      });
    }
    diskManifest = {
      [side]: {
        acceptedProfile: {
          analysisArtifact: { localOutputPath: acceptedPath, sha256: sha256(acceptedBytes) },
        },
        channels: channelEntries,
      },
    };
  }
  fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify(diskManifest, null, 2));
  const normalizedDir = path.join(packageDir, side, "normalized");
  fs.mkdirSync(normalizedDir, { recursive: true });
  const normalizedPath = path.join(normalizedDir, `${side}-normalized-card.png`);
  await sharp({
    create: {
      width: 1200,
      height: 1680,
      channels: 3,
      background: side === "front" ? "#203040" : "#405060",
    },
  }).png().toFile(normalizedPath);
  const normalizedBytes = fs.readFileSync(normalizedPath);
  return {
    reviewSource,
    processed: {
      manifest: {
        evidenceSide: side,
        [side]: {
          normalizedCard: {
            normalizedArtifact: {
              mimeType: "image/png",
              imageWidth: 1200,
              imageHeight: 1680,
              sha256: sha256(normalizedBytes),
              byteSize: normalizedBytes.byteLength,
              localOutputPath: normalizedPath,
            },
          },
        },
      },
    },
  };
}

function installSimulatedMathematicalCapture(service, includeReviewSources = false) {
  const warmSources = {};
  let invocation = 0;
  service.runWarmSideCapture = async (side) => {
    invocation += 1;
    const manifest = service.manifest;
    const seed = `${manifest.reportId}-${invocation}`;
    const packageDir = path.join(manifest.outputs.sessionDir, `${side}-package`);
    const payload = { ...capturePayload(manifest, side, seed), packageDir };
    const result = {
      stepId: `capture_${side}`,
      ok: true,
      exitCode: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      payload,
    };
    manifest.commandResults.push(result);
    const processing = processedMathematicalSide(side, packageDir, includeReviewSources)
      .then((fixture) => {
        if (includeReviewSources) warmSources[side] = fixture.reviewSource;
        service.recordProcessedNormalizedOcrImage(manifest, side, fixture.processed);
        manifest.warmRunnerStatus.phases.push({
          id: `process_${side}_artifacts`,
          label: `${side} processing`,
          status: "completed",
          side,
          backend: "warm_full_forensic_runner",
          executionPath: "warm_full_forensic_runner",
        });
        return fixture.processed;
      });
    service.warmProcessingJobs.set(`${manifest.sessionId}:${side}`, processing);
    void processing.catch(() => {});
    await Promise.resolve();
    await Promise.resolve();
    return result;
  };
  return warmSources;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function unavailableEyesReceipt(item) {
  const imageBindings = [...item.ocr.images]
    .sort((left, right) => left.side === "front" ? -1 : 1)
    .map((image) => ({
      side: image.side,
      checksumSha256: image.checksumSha256,
      evidenceRef: `image.${image.side}`,
    }));
  const requestSha256 = crypto.createHash("sha256").update(canonicalJson({
    schemaVersion: "ai_grader_eyes_semantic_observer_v1",
    imageBindings,
    semanticElements: ["centering", "corners", "edges", "surface"],
    metricAuthority: "deterministic_calibrated_pixels_only",
  }), "utf8").digest("hex");
  return {
    schemaVersion: "ai_grader_eyes_semantic_observer_v1",
    status: "unavailable",
    requestSha256,
    imageBindings,
    observations: [],
    reviewElements: [],
    metricAuthority: "deterministic_calibrated_pixels_only",
    wholeCardFailureAuthority: false,
    reason: "not_configured",
  };
}

function observedEyesReceipt(item, reviewElements = []) {
  const { reason: _reason, ...base } = unavailableEyesReceipt(item);
  const observations = ["centering", "corners", "edges", "surface"].map((element) => ({
    element,
    semanticState: element === "centering"
      ? "printed_border_supported"
      : "no_visible_physical_concern",
    challengeDeterministicInterpretation: reviewElements.includes(element),
    requiresOperatorReview: reviewElements.includes(element),
    confidence: 0.95,
    evidenceRefs: ["image.front", "image.back"],
    rationale: reviewElements.includes(element)
      ? `Exact ${element} images require a human semantic decision.`
      : `No semantic ${element} challenge was observed in the exact images.`,
  }));
  return {
    ...base,
    status: "observed",
    requestedModel: "gpt-5.6-sol",
    actualModel: "gpt-5.6-sol",
    observations,
    reviewElements,
    providerElapsedMs: 1200,
  };
}

function safeOcrResult(item) {
  return {
    queueItemId: item.queueItemId,
    gradingSessionId: item.sessionId,
    reportId: item.reportId,
    status: "prefill_ready",
    humanConfirmationRequired: true,
    inventoryMutationPerformed: false,
    publishMutationPerformed: false,
    sourceSides: ["front", "back"],
    fields: Object.fromEntries(OCR_FIELDS.map((name) => [name, {
      state: "unknown",
      value: null,
      confidence: 0,
      reviewRequired: true,
      evidenceRefs: [],
    }])),
    reviewFieldNames: [...OCR_FIELDS],
    provenance: {
      ocrEngine: "google_vision_document_text_detection_url_only",
      attributeExtractor: "@tenkings/shared/extractCardAttributes",
      structuredExtractor: "openai_responses_strict_json_schema",
      structuredExtractionModel: "gpt-4.1-mini",
      setLookupUsed: false,
      setIdentificationUsed: false,
    },
    eyes: unavailableEyesReceipt(item),
    warnings: [],
  };
}

function installMathematicalReleaseStub(service) {
  let callCount = 0;
  service.writeProductionReleaseForManifest = async (
    manifest,
    _request,
    options = {},
  ) => {
    callCount += 1;
    const packageDir = path.dirname(manifest.outputs.reportBundlePath);
    fs.mkdirSync(packageDir, { recursive: true });
    const productionReleasePath = path.join(packageDir, "production-release.json");
    const labelDataPath = path.join(packageDir, "label-data.json");
    const release = {
      schemaVersion: "ai-grader-mathematical-production-release-v1",
      reportId: manifest.reportId,
      gradingSessionId: manifest.sessionId,
      reportStatus: "final_ai_grader_report_v1",
      finalGradeComputed: true,
      labelDataGenerated: true,
      qrPayloadGenerated: true,
      label: { status: "label_data_ready" },
      operatorFinalization: {
        finalizedAt: options.mathematicalFinalizedAt ?? new Date().toISOString(),
      },
    };
    fs.writeFileSync(productionReleasePath, JSON.stringify(release, null, 2));
    fs.writeFileSync(labelDataPath, JSON.stringify(release.label, null, 2));
    manifest.outputs.productionReleasePath = productionReleasePath;
    manifest.outputs.labelDataPath = labelDataPath;
    manifest.productionRelease = release;
    return release;
  };
  return {
    get callCount() {
      return callCount;
    },
  };
}

async function captureMathematicalCard(service, authority, reportId, suffix) {
  await startMathematicalSession(service, authority, reportId);
  const gradingSessionId = service.status().sessionId;
  await service.action("capture-front", bindReadyPreview(service, "front", suffix));
  const released = await service.action("capture-back", bindReadyPreview(service, "back", suffix));
  assert.equal(released.currentStep, "start_new_card");
  assert.equal(released.sessionId, undefined);
  await service.reportWorker;
  await service.rapidMutationChain;
  const mutableItem = service.rapidQueue.items.find((candidate) => candidate.reportId === reportId);
  assert.ok(mutableItem, `Expected durable queue item for ${reportId}.`);
  assert.equal(mutableItem.sessionId, gradingSessionId);
  assert.deepEqual(mutableItem.ocr.images?.map((image) => image.side), ["front", "back"]);
  const manifest = service.queuedManifests.get(mutableItem.queueItemId);
  const item = service.status().rapidCaptureQueue.items.find((candidate) => candidate.reportId === reportId);
  return {
    item,
    identity: {
      queueItemId: item.queueItemId,
      gradingSessionId: item.sessionId,
      reportId: item.reportId,
    },
    manifest,
  };
}

async function completeFixtureOcr(service, queued, suffix, reviewElements) {
  const mutableItem = service.rapidQueue.items.find(
    (item) => item.queueItemId === queued.item.queueItemId,
  );
  const result = safeOcrResult(mutableItem);
  if (reviewElements !== undefined) {
    result.eyes = observedEyesReceipt(mutableItem, reviewElements);
  }
  const attempt = {
    ...queued.identity,
    attemptOwnerId: `fixture-eyes-${suffix}`,
  };
  await service.action("begin-queued-ocr", attempt);
  const completed = await service.action("complete-queued-ocr", {
    ...attempt,
    result,
  });
  return completed.rapidCaptureQueue.items.find(
    (item) => item.queueItemId === queued.item.queueItemId,
  );
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

function completedResult(input, operatorResolutionRequest) {
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
    ...(operatorResolutionRequest ? { operatorResolutionRequest } : {}),
  };
}

function operatorAuthentication(action, operatorId = "authenticated-owner-1", now = new Date()) {
  const payload = {
    schemaVersion: AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_V1,
    operatorId,
    operatorRole: "ai_grader_admin",
    queueItemId: action.queueItemId,
    gradingSessionId: action.gradingSessionId,
    reportId: action.reportId,
    requestSha256: action.operatorResolutionSubmission.requestSha256,
    submissionSha256: hashFixedRigOperatorResolutionValueV1(
      action.operatorResolutionSubmission,
    ),
    idempotencyKey: action.idempotencyKey,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.valueOf() + 60_000).toISOString(),
  };
  const payloadBytes = canonicalJsonV1(payload);
  return {
    schemaVersion: AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_V1,
    payload,
    payloadSha256: sha256(Buffer.from(payloadBytes, "utf8")),
    authentication: {
      algorithm: "hmac-sha256",
      keyId: OPERATOR_AUTH_HMAC_KEY_ID,
      signature: crypto.createHmac("sha256", OPERATOR_AUTH_HMAC_KEY)
        .update(AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_DOMAIN_V1 + "\n", "utf8")
        .update(payloadBytes, "utf8")
        .digest("hex"),
    },
  };
}

function operatorResolutionRequestFixture(input) {
  const sideBinding = (side) => {
    const nativeRoles = Array.from({ length: 35 }, (_, index) => ({
      captureRole: `${side}-native-role-${String(index + 1).padStart(2, "0")}`,
      sha256: hashFixedRigOperatorResolutionValueV1(
        `${side}-native-role-${index + 1}`,
      ),
    }));
    return {
      rawAllOnAssetId: `${side}-raw-all-on`,
      rawAllOnSha256: hashFixedRigOperatorResolutionValueV1(`${side}-raw-all-on`),
      normalizedAllOnAssetId: `${side}-normalized-all-on`,
      normalizedAllOnSha256: hashFixedRigOperatorResolutionValueV1(
        `${side}-normalized-all-on`,
      ),
      rawToNormalizedTransformSha256: hashFixedRigOperatorResolutionValueV1(
        `${side}-transform`,
      ),
      authenticatedOuterCutArtifactSha256: hashFixedRigOperatorResolutionValueV1(
        `${side}-outer-cut`,
      ),
      warmManifestSha256: hashFixedRigOperatorResolutionValueV1(
        `${side}-warm-manifest`,
      ),
      nativeRoles,
      nativeRoleLedgerSha256: hashFixedRigOperatorResolutionValueV1(nativeRoles),
    };
  };
  return buildFixedRigOperatorResolutionRequestV1({
    generatedAt: input.generatedAt,
    binding: {
      queueItemId: input.queueItemId,
      gradingSessionId: input.gradingSessionId,
      reportId: input.reportId,
      cardIdentitySha256: hashFixedRigOperatorResolutionValueV1(input.authority.cardIdentity),
      calibrationProfileId: "fixture-calibration-profile",
      calibrationVersion: "fixture-calibration-v1",
      calibrationArtifactSha256: CALIBRATION_ARTIFACT_SHA256,
      calibrationBundleManifestSha256: BUNDLE_SHA256,
      thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
      thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
      sides: { front: sideBinding("front"), back: sideBinding("back") },
    },
    originalElements: Object.fromEntries(
      ["centering", "corners", "edges", "surface"].map((element) => [
        element,
        {
          status: element === "centering" ? "insufficient_evidence" : "computed",
          score: element === "centering" ? null : 10,
          explanation: element === "centering" ? null : `Automatic ${element} result.`,
          failureReasons: element === "centering"
            ? ["Printed border fit could not resolve the exact margins."]
            : [],
          resultSha256: hashFixedRigOperatorResolutionValueV1(`result-${element}`),
        },
      ]),
    ),
  });
}

function operatorResolutionRequiredResult(input, request) {
  const exactSlots = {
    centering: ["front:full_card", "back:full_card"],
    corners: [
      "front:top_left", "front:top_right", "front:bottom_right", "front:bottom_left",
      "back:top_left", "back:top_right", "back:bottom_right", "back:bottom_left",
    ],
    edges: [
      "front:top", "front:right", "front:bottom", "front:left",
      "back:top", "back:right", "back:bottom", "back:left",
    ],
    surface: ["front:full_card", "back:full_card"],
  };
  const evidenceRoles = {
    centering: "centering_measurement_overlay",
    corners: "corner_measurement_overlay",
    edges: "edge_measurement_overlay",
    surface: "surface_condition_overlay",
  };
  const workspaceAssets = Object.entries(exactSlots).flatMap(([element, slots]) =>
    slots.map((slot) => {
      const [side, location] = slot.split(":");
      const bytes = Buffer.from(`exact-operator-${element}-${side}-${location}-overlay`);
      return {
        assetId: `operator-workspace.${element}.${side}.${location}`,
        element,
        side,
        location,
        evidenceRole: evidenceRoles[element],
        sha256: sha256(bytes),
        fileName: `${element}-${side}-${location}.png`,
        contentType: "image/png",
        byteSize: bytes.byteLength,
        widthPx: 1200,
        heightPx: 1680,
        measurementSummary: [
          element === "centering"
            ? "L 2.100 · R 2.200 mm"
            : "Exact slot is present for operator inspection.",
        ],
        bytes,
      };
    }),
  );
  const workspacePayload = {
    schemaVersion: "fixed_rig_operator_resolution_workspace_v1",
    requestSha256: request.requestSha256,
    galleries: Object.fromEntries(Object.keys(exactSlots).map((element) => [
      element,
      workspaceAssets
        .filter((asset) => asset.element === element)
        .map(({ bytes: _bytes, ...metadata }) => metadata),
    ])),
    hashPolicy: "sha256-canonical-json-with-workspaceSha256-omitted",
  };
  return {
    version: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
    status: "operator_resolution_required",
    gradingContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    failedStage: "operator_resolution",
    request,
    workspace: {
      ...workspacePayload,
      workspaceSha256: sha256(
        Buffer.from(canonicalJsonV1(workspacePayload) + "\n", "utf8"),
      ),
    },
    workspaceAssets,
    unresolvedElements: ["centering"],
    reportPackage: null,
    stationInput: null,
    analysisCheckpoint: {
      fixture: "exact-first-pass-analysis",
      requestSha256: request.requestSha256,
    },
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
      "front/mathematical-v1/findings/surface-fixture-finding/" +
        (source.role === "roi_crop"
          ? "roi.png"
          : source.role.replaceAll("_", "-") + ".png"),
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

function postStationAction(server, action, body) {
  const address = server.address();
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: `/actions/${encodeURIComponent(action)}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(bytes.byteLength),
        "X-AI-Grader-Station-Token":
          "StationTokenStationTokenStationToken1234",
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: response.statusCode,
          body: JSON.parse(text),
        });
      });
    });
    request.on("error", reject);
    request.end(bytes);
  });
}

test("local station accepts only the exact hosted-signed Pokemon profile authority", async (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ten-kings-pokemon-authority-"));
  const services = [];
  t.after(async () => {
    await Promise.allSettled(services.map((service) =>
      service.shutdown("Pokemon authority parser test complete")));
    fs.rmSync(outputDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const config = {
    cardFormatAuthorityHmacKey: CARD_FORMAT_HMAC_KEY,
    cardFormatAuthorityHmacKeyId: CARD_FORMAT_HMAC_KEY_ID,
  };
  const validService = createService(path.join(outputDir, "valid"), async () => {
    throw new Error("not invoked");
  }, config);
  services.push(validService);
  await startMathematicalSession(validService, pokemonAuthority(), "pokemon-authority-valid");
  assert.equal(
    validService.manifest.mathematicalV1.gradingAuthority.cardFormatId,
    "pokemon_tcg_standard",
  );

  const forged = pokemonAuthority();
  forged.trustedCardFormatAuthority.authentication.signature = "0".repeat(64);
  const forgedService = createService(path.join(outputDir, "forged"), async () => {
    throw new Error("not invoked");
  }, config);
  services.push(forgedService);
  await assert.rejects(
    () => startMathematicalSession(forgedService, forged, "pokemon-authority-forged"),
    /signature is invalid/,
  );

  const callerMeasured = { ...pokemonAuthority(), measurements: [] };
  const callerService = createService(path.join(outputDir, "caller"), async () => {
    throw new Error("not invoked");
  }, config);
  services.push(callerService);
  await assert.rejects(
    () => startMathematicalSession(callerService, callerMeasured, "pokemon-authority-caller"),
    /exact station contract/,
  );
});

test("Production Start New Card accepts only an explicit ready Mathematical V1 contract", async (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-only-start-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const service = createService(path.join(outputDir, "ready"), completedResult);
  t.after(() => service.shutdown("mathematical-only start test complete"));

  assert.equal(service.status().gradingContract, "mathematical_calibration_v1");
  assert.deepEqual(service.status().bridgeContract.gradingContracts, ["mathematical_calibration_v1"]);
  await assert.rejects(
    () => service.action("start-session", {
      reportId: "omitted-contract-report",
      captureProfile: "production_fast",
    }),
    /requires the explicit mathematical_calibration_v1 grading contract.*omitted grading contract.*prohibited/i,
  );
  await assert.rejects(
    () => service.action("start-session", {
      reportId: "legacy-contract-report",
      captureProfile: "production_fast",
      gradingContract: "legacy_v0",
    }),
    /requires the explicit mathematical_calibration_v1 grading contract.*Legacy V0.*prohibited/i,
  );
  assert.equal(service.manifest.sessionId, undefined);
  assert.equal(service.manifest.currentStep, "start_new_card");
  assert.equal(service.manifest.gradingContract, "mathematical_calibration_v1");

  const unavailableConfig = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 47652,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: path.join(outputDir, "unavailable"),
    captureProfile: "production_fast",
  });
  const unavailable = new AiGraderLocalStationBridgeService(
    unavailableConfig,
    undefined,
    undefined,
    { stopOrphanedPreviewStreamsUntilReleased: async () => 0 },
  );
  t.after(() => unavailable.shutdown("mathematical unavailable start test complete"));
  await assert.rejects(
    () => unavailable.action("start-session", {
      reportId: "unavailable-contract-report",
      captureProfile: "production_fast",
      gradingContract: "mathematical_calibration_v1",
      mathematicalGradingAuthority: printedAuthority(),
    }),
    /Mathematical Calibration V1 is not ready:.*No V0 fallback is permitted/i,
  );
  assert.equal(unavailable.manifest.sessionId, undefined);
  assert.equal(unavailable.manifest.currentStep, "start_new_card");
  assert.equal(unavailable.manifest.gradingContract, "mathematical_calibration_v1");

  const runtimeContext = { schemaVersion: "fast-mathematical-calibration-runtime-context-v1.2", marker: "exact-live-context" };
  const mismatchConfig = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 47652,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: path.join(outputDir, "context-mismatch"),
    captureProfile: "production_fast",
    mathematicalCalibrationRigId: "fixture-rig",
    mathematicalCalibrationBundlePath: path.join(outputDir, "context-mismatch", "mathematical-calibration-bundle-v1.json"),
    mathematicalCalibrationBundleSha256: BUNDLE_SHA256,
    mathematicalCalibrationRuntimeContext: runtimeContext,
  });
  const mismatch = new AiGraderLocalStationBridgeService(mismatchConfig, undefined, undefined, {
    stopOrphanedPreviewStreamsUntilReleased: async () => 0,
    loadMathematicalCalibrationBundle(input) {
      assert.deepEqual(input.expectedRuntimeContext, runtimeContext);
      throw new Error("Live camera, rig, controller, wiring, settings, target, component, algorithm, location, or lighting context differs from the active calibration.");
    },
  });
  t.after(() => mismatch.shutdown("mathematical context mismatch test complete"));
  await assert.rejects(
    () => mismatch.action("start-session", {
      reportId: "context-mismatch-report",
      captureProfile: "production_fast",
      gradingContract: "mathematical_calibration_v1",
      mathematicalGradingAuthority: printedAuthority(),
    }),
    /Mathematical Calibration V1 is not ready:.*Live camera, rig, controller.*No V0 fallback is permitted/i,
  );
  assert.equal(mismatch.manifest.sessionId, undefined);
});

test("Mathematical identity rejects unsafe public identifiers before capture or report adaptation", async (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-safe-identity-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const service = createService(outputDir, completedResult);
  t.after(() => service.shutdown("safe mathematical identity test complete"));
  const unsafe = printedAuthority();
  unsafe.cardIdentity.setId = "2023 Panini Prizm";
  unsafe.cardIdentity.programId = "Base Set";
  unsafe.cardIdentity.parallelId = "Silver Prizm";
  await assert.rejects(
    () => startMathematicalSession(service, unsafe, "unsafe-public-identity"),
    /setId must be a safe public identifier/i,
  );
  assert.equal(service.status().currentStep, "start_new_card");
});

test("ordinary Mathematical V1 no-finding completion uses station-derived publication and no V0 fallback", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-station-complete-"));
  const calls = [];
  try {
    const service = createService(outputDir, async (input) => {
      calls.push(input);
      return completedResult(input);
    });
    installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service);
    const browserAuthority = printedAuthority();
    const queued = await captureMathematicalCard(
      service,
      browserAuthority,
      "ordinary-math-report",
      "ordinary",
    );
    assert.equal(queued.manifest.mathematicalV1.execution.status, "completed");
    assert.equal(queued.manifest.mathematicalV1.execution.v0FallbackUsed, false);
    assert.equal(queued.item.mathematicalV1.status, "completed");
    assert.equal(queued.item.state, "finalizing", "completed grading remains separate from pending queued OCR");
    assert.equal(queued.item.rawEvidence.format, "tiff");
    assert.equal(queued.item.rawEvidence.sides.length, 2);
    assert.deepEqual(Object.keys(queued.item.sideProcessingJobs).sort(), ["back", "front"]);
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
    assert.equal(queued.manifest.outputs.unifiedReportPath.endsWith("report-bundle-v0.3.json"), true);
    assert.equal(queued.manifest.outputs.unifiedReportPath.includes("mock-unified-report"), false);

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

test("OCR-first printed-border capture blocks grading until exact identity confirmation, then resumes deterministic grading once", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-ocr-first-"));
  const calls = [];
  try {
    const service = createService(outputDir, async (input) => {
      calls.push(input);
      return completedResult(input);
    });
    installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service);

    const started = await service.action("start-session", {
      reportId: "ocr-first-math-report",
      captureProfile: "production_fast",
      gradingContract: "mathematical_calibration_v1",
      ocrFirstIdentityBinding: "printed_border_v1",
      calibrationActivationAuthority: {
        bundleManifestSha256: BUNDLE_SHA256,
      },
    });
    assert.equal(started.currentStep, "capture_front");
    assert.equal(service.manifest.mathematicalV1, undefined);
    assert.equal(
      service.manifest.pendingOcrIdentityV1?.schemaVersion,
      "ten-kings-ai-grader-ocr-first-printed-border-v1",
    );

    const gradingSessionId = service.status().sessionId;
    await service.action(
      "capture-front",
      bindReadyPreview(service, "front", "ocr-first"),
    );
    await service.action(
      "capture-back",
      bindReadyPreview(service, "back", "ocr-first"),
    );
    await service.reportWorker;
    await service.rapidMutationChain;

    const mutableItem = service.rapidQueue.items.find(
      (candidate) => candidate.reportId === "ocr-first-math-report",
    );
    assert.ok(mutableItem);
    assert.equal(mutableItem.sessionId, gradingSessionId);
    assert.equal(mutableItem.ocr.state, "eligible");
    assert.equal(calls.length, 0, "no grading runs before OCR identity confirmation");

    const identity = {
      queueItemId: mutableItem.queueItemId,
      gradingSessionId: mutableItem.sessionId,
      reportId: mutableItem.reportId,
    };
    const attempt = {
      ...identity,
      attemptOwnerId: "ocr-first-exact-owner",
    };
    await service.action("begin-queued-ocr", attempt);
    const ocrCompleted = await service.action("complete-queued-ocr", {
      ...attempt,
      result: safeOcrResult(mutableItem),
    });
    const identityItem = ocrCompleted.rapidCaptureQueue.items.find(
      (candidate) => candidate.queueItemId === mutableItem.queueItemId,
    );
    assert.equal(identityItem.state, "identity_resolution_required");
    assert.equal(calls.length, 0);

    await service.action("activate-queue-item", identity);
    assert.equal(
      service.status().rapidCaptureQueue.activeQueueItemId,
      mutableItem.queueItemId,
    );
    const bindingStatus = await service.action("bind-mathematical-grading-authority", {
      ...identity,
      mathematicalGradingAuthority: printedAuthority(),
    });
    assert.equal(
      bindingStatus.rapidCaptureQueue.activeQueueItemId,
      undefined,
      "a persisted exact bind releases the review selector before grading finishes",
    );
    assert.equal(
      bindingStatus.rapidCaptureQueue.items.find(
        (candidate) => candidate.queueItemId === mutableItem.queueItemId,
      ).state,
      "finalizing",
    );
    await service.reportWorker;
    await service.rapidMutationChain;

    const ready = service.status().rapidCaptureQueue.items.find(
      (candidate) => candidate.queueItemId === mutableItem.queueItemId,
    );
    assert.equal(calls.length, 1);
    assert.equal(ready.ocr.state, "succeeded");
    assert.equal(ready.state, "report_ready_needs_confirm");
    const manifest = service.queuedManifests.get(mutableItem.queueItemId);
    assert.equal(manifest.pendingOcrIdentityV1, undefined);
    assert.equal(
      manifest.mathematicalV1.gradingAuthority.cardIdentity.title,
      "Mathematical station fixture",
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("independent OCR-first review binds release immediately and overlap deterministic finalization", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-parallel-review-"));
  const calls = [];
  const releases = [];
  let service;
  try {
    service = createService(outputDir, (input) =>
      new Promise((resolve) => {
        calls.push(input);
        releases.push(() => resolve(completedResult(input)));
      }));
    installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service);

    const captureOcrFirst = async (reportId, suffix) => {
      await service.action("start-session", {
        reportId,
        captureProfile: "production_fast",
        gradingContract: "mathematical_calibration_v1",
        ocrFirstIdentityBinding: "printed_border_v1",
        calibrationActivationAuthority: {
          bundleManifestSha256: BUNDLE_SHA256,
        },
      });
      await service.action(
        "capture-front",
        bindReadyPreview(service, "front", suffix),
      );
      await service.action(
        "capture-back",
        bindReadyPreview(service, "back", suffix),
      );
      await service.reportWorker;
      await service.rapidMutationChain;
      const item = service.rapidQueue.items.find(
        (candidate) => candidate.reportId === reportId,
      );
      assert.ok(item);
      const identity = {
        queueItemId: item.queueItemId,
        gradingSessionId: item.sessionId,
        reportId: item.reportId,
      };
      const attempt = {
        ...identity,
        attemptOwnerId: `parallel-review-owner-${suffix}`,
      };
      await service.action("begin-queued-ocr", attempt);
      await service.action("complete-queued-ocr", {
        ...attempt,
        result: safeOcrResult(item),
      });
      return identity;
    };

    const first = await captureOcrFirst(
      "parallel-review-report-1",
      "parallel-1",
    );
    const second = await captureOcrFirst(
      "parallel-review-report-2",
      "parallel-2",
    );

    await service.action("activate-queue-item", first);
    await service.action("bind-mathematical-grading-authority", {
      ...first,
      mathematicalGradingAuthority: printedAuthority(),
    });
    assert.equal(service.status().rapidCaptureQueue.activeQueueItemId, undefined);

    await service.action("activate-queue-item", second);
    await service.action("bind-mathematical-grading-authority", {
      ...second,
      mathematicalGradingAuthority: printedAuthority(),
    });
    assert.equal(service.status().rapidCaptureQueue.activeQueueItemId, undefined);

    for (let attempt = 0; attempt < 500 && calls.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      calls.length,
      2,
      "Card 2 deterministic grading must start while Card 1 remains held",
    );
    const inFlight = service.status().rapidCaptureQueue;
    assert.equal(inFlight.reportWorkerSerialized, false);
    assert.deepEqual(inFlight.backgroundConcurrency, {
      limit: 25,
      active: 2,
      queued: 0,
    });

    releases.forEach((release) => release());
    let workerTimeout;
    await Promise.race([
      service.reportWorker,
      new Promise((_, reject) => {
        workerTimeout = setTimeout(() => reject(new Error(
          `Parallel finalization did not settle: calls=${calls.length}, releases=${releases.length}, jobs=${service.rapidFinalizationJobs.size}, active=${service.rapidFinalizationActive}, states=${service.status().rapidCaptureQueue.items.map((item) => `${item.reportId}:${item.state}`).join(",")}`,
        )), 5_000);
      }),
    ]).finally(() => clearTimeout(workerTimeout));
    await service.rapidMutationChain;
    const states = service.status().rapidCaptureQueue.items
      .filter((item) =>
        item.reportId === first.reportId ||
        item.reportId === second.reportId)
      .map((item) => item.state);
    assert.deepEqual(states, [
      "report_ready_needs_confirm",
      "report_ready_needs_confirm",
    ]);
  } finally {
    releases.forEach((release) => release());
    if (service) {
      await service.reportWorker.catch(() => {});
      await service.rapidMutationChain.catch(() => {});
      await new Promise((resolve) => setImmediate(resolve));
    }
    fs.rmSync(outputDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

test("real bind-route worker jobs leave HTTP review and Start New Card responsive", async () => {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tenkings-math-worker-http-responsive-"),
  );
  let pendingOperatorRequest;
  let server;
  try {
    const fixtureService = createService(
      outputDir,
      async (input) => {
        if (input.reportId === "http-responsive-card-c") {
          pendingOperatorRequest ??= operatorResolutionRequestFixture(input);
          return operatorResolutionRequiredResult(
            input,
            pendingOperatorRequest,
          );
        }
        return insufficientResult();
      },
      {},
      {
        stopOrphanedPreviewStreamsUntilReleased: async () => 0,
        writeLightingFrames: async (frames) =>
          frames.map(() => ({ responseKind: "mock", ok: true })),
      },
    );
    installSimulatedMathematicalCapture(fixtureService, true);
    const captureOcrFirst = async (reportId, suffix) => {
      await fixtureService.action("start-session", {
        reportId,
        captureProfile: "production_fast",
        gradingContract: "mathematical_calibration_v1",
        ocrFirstIdentityBinding: "printed_border_v1",
        calibrationActivationAuthority: {
          bundleManifestSha256: BUNDLE_SHA256,
        },
      });
      await fixtureService.action(
        "capture-front",
        bindReadyPreview(fixtureService, "front", suffix),
      );
      await fixtureService.action(
        "capture-back",
        bindReadyPreview(fixtureService, "back", suffix),
      );
      await fixtureService.reportWorker;
      await fixtureService.rapidMutationChain;
      const item = fixtureService.status().rapidCaptureQueue.items.find(
        (candidate) => candidate.reportId === reportId,
      );
      assert.ok(item);
      const queued = {
        item,
        identity: {
          queueItemId: item.queueItemId,
          gradingSessionId: item.sessionId,
          reportId: item.reportId,
        },
      };
      const completed = await completeFixtureOcr(
        fixtureService,
        queued,
        suffix,
      );
      assert.equal(completed.state, "identity_resolution_required");
      return queued;
    };
    const cardA = await captureOcrFirst(
      "http-responsive-card-a-hold-long",
      "http-responsive-a",
    );
    const cardB = await captureOcrFirst(
      "http-responsive-card-b-hold-long",
      "http-responsive-b",
    );
    const cardC = await captureMathematicalCard(
      fixtureService,
      printedAuthority(),
      "http-responsive-card-c",
      "http-responsive-c",
    );
    assert.equal(cardC.item.state, "operator_resolution_required");

    const workerPool = new FixedRigMathematicalStationWorkerPoolV1({
      workerPath: path.resolve(
        __dirname,
        "fixtures/fixedRigMathematicalStationWorkerFixture.js",
      ),
      timeoutMs: 5_000,
      maxConcurrency: 2,
      maxAdmitted: 25,
    });
    let hardwareBoundaries = 0;
    server = createAiGraderLocalStationBridgeHttpServer({
      enabled: true,
      mode: "mock",
      host: "127.0.0.1",
      port: 47652,
      stationToken: "StationTokenStationTokenStationToken1234",
      outputDir,
      captureProfile: "production_fast",
      publicBasePath: "https://collect.tenkings.co/ai-grader/reports",
      mathematicalCalibrationRigId: "fixture-rig",
      mathematicalCalibrationBundlePath: path.join(
        outputDir,
        "fixed-rig-mathematical-calibration-bundle-v1.json",
      ),
      mathematicalCalibrationBundleSha256: BUNDLE_SHA256,
    }, process.env, undefined, undefined, {
      loadMathematicalCalibrationBundle: calibrationLoader,
      mathematicalStationWorkerPool: workerPool,
      onRealHardwareBoundary: () => {
        hardwareBoundaries += 1;
      },
      stopOrphanedPreviewStreamsUntilReleased: async () => 0,
      writeLightingFrames: async (frames) =>
        frames.map(() => ({ responseKind: "mock", ok: true })),
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const requestWhileWorkersHeld = async (action, body) => {
      const startedAt = Date.now();
      const response = await postStationAction(server, action, body);
      assert.equal(response.statusCode, 200, JSON.stringify(response.body));
      assert.equal(
        Date.now() - startedAt < 750,
        true,
        `${action} must return before either two-second worker fixture can finish.`,
      );
      assert.equal(workerPool.status().active, 2);
      return response.body.result;
    };

    const openedA = await postStationAction(
      server,
      "activate-queue-item",
      cardA.identity,
    );
    assert.equal(openedA.statusCode, 200, JSON.stringify(openedA.body));
    const boundAStartedAt = Date.now();
    const boundA = await postStationAction(
      server,
      "bind-mathematical-grading-authority",
      {
        ...cardA.identity,
        mathematicalGradingAuthority: printedAuthority(),
      },
    );
    assert.equal(boundA.statusCode, 200, JSON.stringify(boundA.body));
    assert.equal(Date.now() - boundAStartedAt < 750, true);

    const openedB = await postStationAction(
      server,
      "activate-queue-item",
      cardB.identity,
    );
    assert.equal(openedB.statusCode, 200, JSON.stringify(openedB.body));
    assert.equal(
      openedB.body.result.rapidCaptureQueue.activeReview.queueItemId,
      cardB.identity.queueItemId,
    );
    const boundBStartedAt = Date.now();
    const boundB = await postStationAction(
      server,
      "bind-mathematical-grading-authority",
      {
        ...cardB.identity,
        mathematicalGradingAuthority: printedAuthority(),
      },
    );
    assert.equal(boundB.statusCode, 200, JSON.stringify(boundB.body));
    assert.equal(Date.now() - boundBStartedAt < 750, true);

    for (
      let attempt = 0;
      attempt < 100 && workerPool.status().active < 2;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(workerPool.status(), {
      limit: 2,
      active: 2,
      queued: 0,
      admitted: 2,
      admittedLimit: 25,
    });
    assert.deepEqual(
      new Set(workerPool.admittedIdentities),
      new Set([cardA, cardB].map((card) => [
        card.identity.queueItemId,
        card.identity.gradingSessionId,
        card.identity.reportId,
      ].join("\u0000"))),
      "both bind routes must admit their own immutable exact-card job",
    );

    const liveStatus = await requestWhileWorkersHeld("status", {});
    assert.equal(liveStatus.rapidCaptureQueue.backgroundConcurrency.active, 2);

    const openedC = await requestWhileWorkersHeld(
      "activate-queue-item",
      cardC.identity,
    );
    assert.equal(
      openedC.rapidCaptureQueue.activeReview.queueItemId,
      cardC.identity.queueItemId,
    );
    assert.equal(
      openedC.rapidCaptureQueue.items.find(
        (item) => item.queueItemId === cardC.identity.queueItemId,
      ).state,
      "operator_resolution_required",
    );

    const started = await requestWhileWorkersHeld("start-session", {
      reportId: "http-responsive-new-card",
      captureProfile: "production_fast",
      gradingContract: "mathematical_calibration_v1",
      mathematicalGradingAuthority: printedAuthority(),
    });
    assert.equal(started.currentStep, "capture_front");
    assert.equal(hardwareBoundaries, 0);

    for (
      let attempt = 0;
      attempt < 500 && workerPool.status().admitted > 0;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(workerPool.status().admitted, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    fs.rmSync(outputDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

test("EYES reject-all cannot silently keep centering; it forces one deterministic centering review pass and refreshes release state", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-eyes-reject-"));
  const calls = [];
  try {
    const service = createService(outputDir, async (input) => {
      calls.push(input);
      return completedResult(input);
    });
    const release = installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "eyes-reject-math-report",
      "eyes-reject",
    );
    await completeFixtureOcr(service, queued, "eyes-reject");

    const item = service.rapidQueue.items.find(
      (candidate) => candidate.queueItemId === queued.item.queueItemId,
    );
    const manifest = service.queuedManifests.get(item.queueItemId);
    const edges = ["left", "right", "top", "bottom"];
    const candidates = ["front", "back"].flatMap((side, sideIndex) =>
      edges.map((edge, edgeIndex) => {
        const index = sideIndex * edges.length + edgeIndex;
        return {
          side,
          edge,
          candidateId: `${side}-${edge}-default`,
          sha256: (index + 1).toString(16).repeat(64),
          deterministicInputSha256: (index + 9).toString(16).repeat(64),
          selectedByDefault: true,
        };
      }),
    );
    manifest.mathematicalV1.eyesCenteringCandidateLedger = {
      schemaVersion: "fixed_rig_eyes_centering_candidate_ledger_v1",
      candidates,
      ledgerSha256: "c".repeat(64),
      metricAuthority: "deterministic_calibrated_pixels_only",
      coordinateAuthority: false,
      maximumRemeasurementPasses: 2,
    };
    const sourceImageBindings = ["front", "back"].map((side) => ({
      side,
      checksumSha256: item.ocr.images.find((image) => image.side === side)
        .checksumSha256,
    }));
    const candidateBindings = [...candidates]
      .sort((left, right) =>
        left.side.localeCompare(right.side) ||
        edges.indexOf(left.edge) - edges.indexOf(right.edge) ||
        left.candidateId.localeCompare(right.candidateId))
      .map((candidate) => ({
        side: candidate.side,
        edge: candidate.edge,
        candidateId: candidate.candidateId,
        checksumSha256: candidate.sha256,
        deterministicInputSha256: candidate.deterministicInputSha256,
      }));
    const requestSha256 = sha256(Buffer.from(canonicalJson({
      schemaVersion: "ai_grader_eyes_centering_edge_candidate_selection_v1",
      sourceImageBindings,
      candidateBindings,
      metricAuthority: "deterministic_calibrated_pixels_only",
      coordinateAuthority: false,
      maximumRemeasurementPasses: 2,
    }), "utf8"));
    const receipt = {
      schemaVersion: "ai_grader_eyes_centering_edge_candidate_selection_v1",
      status: "observed",
      requestedModel: "gpt-5.6-sol",
      actualModel: "gpt-5.6-sol-2026-07-01",
      requestSha256,
      sourceImageBindings,
      candidateBindings,
      decisions: ["front", "back"].flatMap((side) => edges.map((edge) => ({
        side,
        edge,
        decision: "reject_all",
        candidateId: null,
        confidence: 0.9,
        rationale: "No supplied contour follows the true printed border.",
      }))),
      metricAuthority: "deterministic_calibrated_pixels_only",
      coordinateAuthority: false,
      maximumRemeasurementPasses: 2,
      providerElapsedMs: 250,
    };

    await service.applyQueuedEyesCenteringSelection(item, manifest, receipt);

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].forcedOperatorReviewElements, ["centering"]);
    assert.equal(
      manifest.mathematicalV1.eyesCenteringRemeasurementPassCount,
      2,
    );
    assert.equal(item.state, "report_ready_needs_confirm");
    assert.equal(release.callCount, 2);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("a late named EYES challenge reopens an already completed exact item for operator resolution", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-late-eyes-resolution-"));
  const calls = [];
  try {
    const service = createService(outputDir, async (input) => {
      calls.push(input);
      if (!input.forcedOperatorReviewElements?.length) return completedResult(input);
      const request = operatorResolutionRequestFixture(input);
      return {
        ...operatorResolutionRequiredResult(input, request),
        unresolvedElements: [...input.forcedOperatorReviewElements],
      };
    });
    installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "late-eyes-resolution-report",
      "late-eyes-resolution",
    );
    assert.equal(queued.manifest.mathematicalV1.execution.status, "completed");
    assert.equal(queued.item.state, "finalizing");

    const completedOcrItem = await completeFixtureOcr(
      service,
      queued,
      "late-eyes-resolution",
      ["edges"],
    );

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].forcedOperatorReviewElements, ["edges"]);
    assert.equal(completedOcrItem.state, "operator_resolution_required");
    assert.equal(completedOcrItem.mathematicalV1.status, "operator_resolution_required");
    const exactManifest = service.queuedManifests.get(queued.item.queueItemId);
    assert.equal(exactManifest.mathematicalV1.execution.status, "operator_resolution_required");
    assert.deepEqual(exactManifest.mathematicalV1.execution.unresolvedElements, ["edges"]);
    assert.equal(
      Object.keys(exactManifest.mathematicalV1.operatorResolutionWorkspaceAssets).length,
      20,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("a named EYES semantic challenge requires that exact element while EYES remains non-metric", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-eyes-resolution-"));
  let pendingRequest;
  try {
    const service = createService(outputDir, async (input) => {
      pendingRequest ??= operatorResolutionRequestFixture(input);
      return operatorResolutionRequiredResult(input, pendingRequest);
    });
    installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "eyes-resolution-report",
      "eyes-resolution",
    );
    await completeFixtureOcr(service, queued, "eyes-resolution", ["edges"]);
    await service.action("activate-queue-item", queued.identity);

    const centeringResolution = {
      element: "centering",
      publicExplanation: "Printed borders are evenly balanced on both sides.",
      internalReason: "The exact bound centering images were reviewed.",
      measurements: {
        unit: "mm",
        order: ["left", "right", "top", "bottom"],
        front: [2.1, 2.2, 2.3, 2.4],
        back: [2.4, 2.3, 2.2, 2.1],
      },
    };
    const missing = {
      ...queued.identity,
      idempotencyKey: "eyes-resolution-missing-edges",
      operatorResolutionSubmission: {
        schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
        requestSha256: pendingRequest.requestSha256,
        operatorConfirmed: true,
        resolutions: [centeringResolution],
      },
      operatorAuthentication: null,
    };
    await assert.rejects(
      service.action("submit-operator-resolutions", missing),
      /named EYES semantic review element\(s\): edges/i,
    );

    const includesChallenge = structuredClone(missing);
    includesChallenge.idempotencyKey = "eyes-resolution-includes-edges";
    includesChallenge.operatorResolutionSubmission.resolutions.push({
      element: "edges",
      score: 8.75,
      publicExplanation: "The exact edge images show light handling wear.",
      internalReason: "The human resolved the EYES edge challenge against the hash-bound images.",
    });
    await assert.rejects(
      service.action("submit-operator-resolutions", includesChallenge),
      /expected object, received null/i,
      "including the named element must pass EYES validation and reach authentication",
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("operator element resolution is authenticated, durable, fail-closed, and idempotently resumes the same queue item", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-operator-resolution-"));
  let pendingRequest;
  let adapterCalls = 0;
  try {
    const service = createService(outputDir, async (input) => {
      adapterCalls += 1;
      pendingRequest ??= operatorResolutionRequestFixture(input);
      if (!input.operatorResolutionAuthorities?.length) {
        return operatorResolutionRequiredResult(input, pendingRequest);
      }
      assert.equal(input.operatorResolutionAuthorities.length, 1);
      assert.equal(
        input.operatorResolutionAuthorities[0].requestSha256,
        pendingRequest.requestSha256,
      );
      return completedResult(input, pendingRequest);
    });
    installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "operator-resolution-report",
      "operator-resolution",
    );
    assert.equal(queued.item.state, "operator_resolution_required");
    assert.equal(
      queued.manifest.mathematicalV1.execution.request.requestSha256,
      pendingRequest.requestSha256,
    );
    await completeFixtureOcr(
      service,
      queued,
      "operator-resolution",
      ["corners"],
    );
    await service.action("activate-queue-item", queued.identity);

    const validSubmission = {
      schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
      requestSha256: pendingRequest.requestSha256,
      operatorConfirmed: true,
      resolutions: [{
        element: "centering",
        publicExplanation: "Printed borders are evenly balanced on both sides.",
        internalReason: "The original automated fit was insufficient; exact bound measurements were supplied.",
        measurements: {
          unit: "mm",
          order: ["left", "right", "top", "bottom"],
          front: [2.1, 2.2, 2.3, 2.4],
          back: [2.4, 2.3, 2.2, 2.1],
        },
      }, {
        element: "corners",
        score: 8.03,
        publicExplanation: "Corners show slight wear at the upper left.",
        internalReason: "The exact corner evidence was reconciled by the owner.",
      }, {
        element: "surface",
        score: 9.25,
        publicExplanation: "The surface shows light handling wear.",
        internalReason: "The exact surface evidence was reconciled by the owner.",
      }],
    };
    const action = {
      ...queued.identity,
      idempotencyKey: "operator-resolution-idempotency-1",
      operatorResolutionSubmission: validSubmission,
    };
    action.operatorAuthentication = operatorAuthentication(
      action,
      "authenticated-owner-1",
      new Date(Date.now() + 4_000),
    );

    const forbidden = structuredClone(action);
    forbidden.operatorResolutionSubmission.resolutions[0].publicExplanation =
      "Human exception accepted.";
    await assert.rejects(
      service.action("submit-operator-resolutions", forbidden),
      /prohibited workflow or disclosure term/,
    );
    assert.equal(
      service.queuedManifests.get(queued.item.queueItemId)
        .mathematicalV1.operatorResolutionReceipts,
      undefined,
      "invalid public text must reject before durable queue mutation",
    );

    const directOverall = structuredClone(action);
    directOverall.operatorResolutionSubmission.overall = 10;
    await assert.rejects(
      service.action("submit-operator-resolutions", directOverall),
      /must contain exactly/,
    );
    const forgedAuthentication = structuredClone(action);
    forgedAuthentication.operatorAuthentication.payload.operatorId =
      "forged-browser-operator";
    await assert.rejects(
      service.action("submit-operator-resolutions", forgedAuthentication),
      /signature is invalid/,
    );
    assert.equal(
      service.queuedManifests.get(queued.item.queueItemId)
        .mathematicalV1.operatorResolutionReceipts,
      undefined,
    );

    const runMathematicalStationPackage =
      service.runMathematicalStationPackage.bind(service);
    let failAfterReceiptPersistence = true;
    service.runMathematicalStationPackage = async (...args) => {
      if (failAfterReceiptPersistence) {
        failAfterReceiptPersistence = false;
        throw new Error("failpoint after operator receipt persistence");
      }
      return runMathematicalStationPackage(...args);
    };
    await assert.rejects(
      service.action("submit-operator-resolutions", action),
      /failpoint after operator receipt persistence/,
    );
    const persistedAfterCrash = service.queuedManifests.get(queued.item.queueItemId);
    assert.equal(
      persistedAfterCrash.mathematicalV1.operatorResolutionReceipts.length,
      1,
    );
    assert.equal(
      persistedAfterCrash.mathematicalV1.operatorResolutionReceipts[0].phase,
      "authority_committed",
    );
    assert.ok(
      Date.parse(
        persistedAfterCrash.mathematicalV1.operatorResolutionReceipts[0]
          .rerunClaim.claimedAt,
      ) >= Date.parse(
        persistedAfterCrash.mathematicalV1.operatorResolutionReceipts[0]
          .authority.authenticatedAt,
      ),
    );
    assert.equal(adapterCalls, 1, "failpoint must run after receipt persistence but before rerun");
    const conflictingRevisionDuringResume = {
      ...structuredClone(action),
      idempotencyKey: "operator-resolution-idempotency-2",
    };
    conflictingRevisionDuringResume.operatorAuthentication =
      operatorAuthentication(conflictingRevisionDuringResume);
    await assert.rejects(
      service.action(
        "submit-operator-resolutions",
        conflictingRevisionDuringResume,
      ),
      /previously committed operator resolution receipt must finish/i,
    );
    const persistedManifestPath = persistedAfterCrash.outputs.manifestPath;
    const persistedAfterCrashBytes = fs.readFileSync(persistedManifestPath);

    const recomputeAuthoritySelfHash = (authority) => {
      const { authoritySha256, ...payload } = authority;
      authority.authoritySha256 = hashFixedRigOperatorResolutionValueV1(payload);
    };
    const assertPersistedTamperRejected = async (mutate, pattern) => {
      const tampered = JSON.parse(persistedAfterCrashBytes.toString("utf8"));
      mutate(tampered.mathematicalV1.operatorResolutionReceipts[0]);
      fs.writeFileSync(persistedManifestPath, JSON.stringify(tampered, null, 2));
      const restarted = createService(outputDir, async (input) => {
        adapterCalls += 1;
        return completedResult(input, pendingRequest);
      });
      installMathematicalReleaseStub(restarted);
      await assert.rejects(
        async () => {
          await restarted.action("activate-queue-item", queued.identity);
          await restarted.action("submit-operator-resolutions", action);
        },
        pattern,
      );
      assert.equal(adapterCalls, 1, "tampered persisted receipt must fail before rerun");
    };
    await assertPersistedTamperRejected(
      (receipt) => {
        receipt.operatorAuthentication.authentication.signature = "0".repeat(64);
      },
      /authentication signature is invalid/i,
    );
    await assertPersistedTamperRejected(
      (receipt) => {
        receipt.operatorAuthentication.authentication.keyId = "wrong-key";
      },
      /authentication key identity mismatch/i,
    );
    await assertPersistedTamperRejected(
      (receipt) => {
        const authentication = receipt.operatorAuthentication;
        authentication.payload.expiresAt = authentication.payload.issuedAt;
        const payloadBytes = canonicalJsonV1(authentication.payload);
        authentication.payloadSha256 = sha256(Buffer.from(payloadBytes, "utf8"));
        authentication.authentication.signature = crypto
          .createHmac("sha256", OPERATOR_AUTH_HMAC_KEY)
          .update(
            AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_DOMAIN_V1 + "\n",
            "utf8",
          )
          .update(payloadBytes, "utf8")
          .digest("hex");
      },
      /expired or has invalid timing/i,
    );
    await assertPersistedTamperRejected(
      (receipt) => {
        receipt.authority.resolutions.find((entry) => entry.element === "corners").score = 1.11;
        recomputeAuthoritySelfHash(receipt.authority);
      },
      /submission sha-256|authenticated submission/i,
    );
    await assertPersistedTamperRejected(
      (receipt) => {
        receipt.authority.operatorId = "tampered-owner";
        recomputeAuthoritySelfHash(receipt.authority);
      },
      /operator identity|authenticated operator/i,
    );
    await assertPersistedTamperRejected(
      (receipt) => {
        receipt.authority.resolutions
          .find((entry) => entry.element === "surface").original.score = 1;
        recomputeAuthoritySelfHash(receipt.authority);
      },
      /original|stale|malformed|different evidence/i,
    );
    fs.writeFileSync(persistedManifestPath, persistedAfterCrashBytes);

    const resumedService = createService(outputDir, async (input) => {
      adapterCalls += 1;
      assert.equal(input.operatorResolutionAuthorities.length, 1);
      return completedResult(input, pendingRequest);
    });
    const releaseTracker = installMathematicalReleaseStub(resumedService);
    await resumedService.action("activate-queue-item", queued.identity);
    const exactPersistedRetry = structuredClone(action);
    exactPersistedRetry.operatorAuthentication = null;
    const completed = await resumedService.action(
      "submit-operator-resolutions",
      exactPersistedRetry,
    );
    const completedItem = completed.rapidCaptureQueue.items.find(
      (item) => item.queueItemId === queued.item.queueItemId,
    );
    assert.equal(
      completedItem.state,
      "report_ready_needs_confirm",
      "a completed mathematical rerun with its exact OCR/EYES receipt is ready for owner confirmation",
    );
    assert.equal(completedItem.mathematicalV1.status, "completed");
    assert.equal(adapterCalls, 2);
    assert.equal(releaseTracker.callCount, 1);
    const receipt = resumedService.queuedManifests.get(queued.item.queueItemId)
      .mathematicalV1.operatorResolutionReceipts[0];
    assert.equal(receipt.idempotencyKey, action.idempotencyKey);
    assert.equal(receipt.authority.operatorId, "authenticated-owner-1");
    assert.equal(
      receipt.operatorAuthentication.payload.operatorId,
      "authenticated-owner-1",
    );
    assert.equal(
      receipt.authority.resolutions[0].publicExplanation,
      "Printed borders are evenly balanced on both sides.",
    );
    assert.match(receipt.authority.resolutions[0].internalReason, /insufficient/);
    assert.equal(receipt.authority.binding.sides.front.nativeRoles.length, 35);
    assert.equal(receipt.phase, "rerun_completed");
    assert.match(receipt.completedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(
      Date.parse(receipt.rerunClaim.claimedAt) >=
        Date.parse(receipt.authority.authenticatedAt),
    );
    assert.ok(
      Date.parse(receipt.releasePlan.finalizedAt) >=
        Date.parse(receipt.rerunClaim.claimedAt),
    );
    assert.ok(
      Date.parse(receipt.completedAt) >=
        Date.parse(receipt.releasePlan.finalizedAt),
    );

    const completedManifest =
      resumedService.queuedManifests.get(queued.item.queueItemId);
    const completedArtifactPaths = [
      completedManifest.outputs.manifestPath,
      path.join(outputDir, "rapid-capture-queue.json"),
      completedManifest.outputs.productionReleasePath,
      completedManifest.outputs.labelDataPath,
    ];
    const completedArtifactBytes = new Map(
      completedArtifactPaths.map((filePath) => [filePath, fs.readFileSync(filePath)]),
    );
    await resumedService.action("submit-operator-resolutions", action);
    assert.equal(adapterCalls, 2, "same idempotent retry must not rerun or append");
    assert.equal(releaseTracker.callCount, 1, "same retry must not duplicate the report release");
    assert.equal(
      resumedService.queuedManifests.get(queued.item.queueItemId)
        .mathematicalV1.operatorResolutionReceipts.length,
      1,
    );
    for (const [filePath, before] of completedArtifactBytes) {
      assert.deepEqual(
        fs.readFileSync(filePath),
        before,
        `completed serial duplicate must leave ${path.basename(filePath)} byte-identical`,
      );
    }

    const conflict = structuredClone(action);
    conflict.operatorResolutionSubmission.resolutions[0].publicExplanation =
      "Printed borders show a slight left-to-right imbalance.";
    conflict.operatorAuthentication = operatorAuthentication(conflict);
    await assert.rejects(
      resumedService.action("submit-operator-resolutions", conflict),
      /idempotency key conflicts/,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("operator element resolution serves only the active exact item's verified normalized Front and Back evidence", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-operator-evidence-"));
  let pendingRequest;
  try {
    const service = createService(outputDir, async (input) => {
      pendingRequest ??= operatorResolutionRequestFixture(input);
      return operatorResolutionRequiredResult(input, pendingRequest);
    });
    installSimulatedMathematicalCapture(service);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "operator-evidence-report",
      "operator-evidence",
    );
    await service.action("activate-queue-item", queued.identity);
    const attempt = { ...queued.identity, attemptOwnerId: "operator-evidence-ocr-owner" };
    await service.action("begin-queued-ocr", attempt);
    const completedOcr = await service.action("complete-queued-ocr", {
      ...attempt,
      result: safeOcrResult(queued.item),
    });
    const exactItem = completedOcr.rapidCaptureQueue.items.find(
      (item) => item.queueItemId === queued.item.queueItemId,
    );
    assert.equal(exactItem.state, "operator_resolution_required");
    assert.equal(exactItem.ocr.state, "succeeded");

    for (const side of ["front", "back"]) {
      const expected = exactItem.ocr.images.find((image) => image.side === side);
      const served = await service.operatorResolutionEvidenceAsset(queued.identity, side);
      assert.equal(served.item.queueItemId, queued.item.queueItemId);
      assert.equal(served.item.sessionId, queued.item.sessionId);
      assert.equal(served.item.reportId, queued.item.reportId);
      assert.equal(served.image.artifactRole, "normalized_card");
      assert.equal(served.image.widthPx, 1200);
      assert.equal(served.image.heightPx, 1680);
      assert.equal(served.image.checksumSha256, expected.checksumSha256);
      assert.equal(served.bytes.byteLength, expected.byteSize);
      assert.equal(sha256(served.bytes), expected.checksumSha256);
    }
    const workspaceAssetId = pendingRequest
      ? "operator-workspace.centering.front.full_card"
      : null;
    assert.ok(workspaceAssetId);
    const workspaceServed = await service.operatorResolutionEvidenceAsset(
      queued.identity,
      undefined,
      workspaceAssetId,
    );
    assert.equal(workspaceServed.item.queueItemId, queued.item.queueItemId);
    assert.equal(workspaceServed.workspaceAsset.assetId, workspaceAssetId);
    assert.equal(
      workspaceServed.workspaceAsset.requestSha256,
      pendingRequest.requestSha256,
    );
    assert.equal(workspaceServed.workspaceAsset.evidenceRole, "centering_measurement_overlay");
    assert.equal(workspaceServed.workspaceAsset.widthPx, 1200);
    assert.equal(workspaceServed.workspaceAsset.heightPx, 1680);
    assert.equal(
      sha256(workspaceServed.bytes),
      workspaceServed.workspaceAsset.sha256,
    );
    await assert.rejects(
      service.operatorResolutionEvidenceAsset(
        queued.identity,
        undefined,
        "operator-workspace.centering.front.not-exact",
      ),
      /not an exact hash-bound asset/i,
    );
    await assert.rejects(
      service.operatorResolutionEvidenceAsset(
        { ...queued.identity, reportId: "wrong-report" },
        "front",
      ),
      /does not match the exact persisted queue\/session\/report triple/i,
    );
    const released = await service.action("release-queue-item", queued.identity);
    assert.equal(released.rapidCaptureQueue.activeQueueItemId, undefined);
    assert.equal(released.rapidCaptureQueue.activeReview, undefined);
    assert.equal(
      released.rapidCaptureQueue.items.find(
        (item) => item.queueItemId === queued.item.queueItemId,
      ).state,
      "operator_resolution_required",
      "review release must not mutate the persisted Finish Cards queue item",
    );
    await assert.rejects(
      service.operatorResolutionEvidenceAsset(queued.identity, "front"),
      /currently activated queue\/session\/report triple/i,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("valid positive-skew operator authentication completes with nondecreasing durable event times", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-operator-positive-skew-"));
  let pendingRequest;
  let adapterCalls = 0;
  try {
    const service = createService(outputDir, async (input) => {
      adapterCalls += 1;
      pendingRequest ??= operatorResolutionRequestFixture(input);
      if (!input.operatorResolutionAuthorities?.length) {
        return operatorResolutionRequiredResult(input, pendingRequest);
      }
      assert.equal(
        input.analysisCheckpoint?.requestSha256,
        pendingRequest.requestSha256,
        "same-process operator resolution must resume the exact first-pass analysis checkpoint",
      );
      return completedResult(input, pendingRequest);
    });
    const releaseTracker = installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "operator-positive-skew-report",
      "operator-positive-skew",
    );
    await completeFixtureOcr(service, queued, "operator-positive-skew");
    await service.action("activate-queue-item", queued.identity);
    const action = {
      ...queued.identity,
      idempotencyKey: "operator-positive-skew-key",
      operatorResolutionSubmission: {
        schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
        requestSha256: pendingRequest.requestSha256,
        operatorConfirmed: true,
        resolutions: [{
          element: "corners",
          score: 8.03,
          publicExplanation: "Corners show slight wear at the upper left.",
          internalReason: "Valid positive authentication clock skew regression.",
        }],
      },
    };
    action.operatorAuthentication = operatorAuthentication(
      action,
      "authenticated-owner-1",
      new Date(Date.now() + 4_000),
    );

    await service.action("submit-operator-resolutions", action);
    assert.equal(adapterCalls, 2);
    assert.equal(releaseTracker.callCount, 1);
    const receipt = service.queuedManifests.get(queued.item.queueItemId)
      .mathematicalV1.operatorResolutionReceipts[0];
    assert.equal(receipt.phase, "rerun_completed");
    assert.ok(
      Date.parse(receipt.rerunClaim.claimedAt) >=
        Date.parse(receipt.authority.authenticatedAt),
    );
    assert.ok(
      Date.parse(receipt.releasePlan.finalizedAt) >=
        Date.parse(receipt.rerunClaim.claimedAt),
    );
    assert.ok(
      Date.parse(receipt.completedAt) >=
        Date.parse(receipt.releasePlan.finalizedAt),
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("operator rerun insufficient evidence reaches a durable terminal state without reopening the consumed request", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-operator-insufficient-"));
  let pendingRequest;
  try {
    const service = createService(outputDir, async (input) => {
      pendingRequest ??= operatorResolutionRequestFixture(input);
      if (!input.operatorResolutionAuthorities?.length) {
        return operatorResolutionRequiredResult(input, pendingRequest);
      }
      assert.equal(
        input.analysisCheckpoint?.requestSha256,
        pendingRequest.requestSha256,
      );
      return {
        version: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
        status: "insufficient_evidence",
        gradingContract: "mathematical_calibration_v1",
        v0FallbackUsed: false,
        failedStage: "report_adaptation",
        reasons: ["Exact report adaptation could not complete."],
        requiresRecapture: false,
        requiresApprovedDesignReference: false,
        requiresCalibration: false,
        requiresImplementationCorrection: true,
        reportPackage: null,
        stationInput: null,
      };
    });
    installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "operator-insufficient-report",
      "operator-insufficient",
    );
    await completeFixtureOcr(service, queued, "operator-insufficient");
    await service.action("activate-queue-item", queued.identity);
    const action = {
      ...queued.identity,
      idempotencyKey: "operator-insufficient-key",
      operatorResolutionSubmission: {
        schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
        requestSha256: pendingRequest.requestSha256,
        operatorConfirmed: true,
        resolutions: [{
          element: "corners",
          score: 8.03,
          publicExplanation: "Corners show slight wear at the upper left.",
          internalReason: "Exact insufficient-evidence finalization regression.",
        }],
      },
    };
    action.operatorAuthentication = operatorAuthentication(
      action,
      "authenticated-owner-1",
      new Date(Date.now() + 4_000),
    );

    const completed = await service.action("submit-operator-resolutions", action);
    const item = completed.rapidCaptureQueue.items.find(
      (candidate) => candidate.queueItemId === queued.item.queueItemId,
    );
    assert.equal(item.state, "insufficient_evidence");
    const manifest = service.queuedManifests.get(queued.item.queueItemId);
    assert.equal(manifest.mathematicalV1.execution.status, "insufficient_evidence");
    assert.equal(
      manifest.mathematicalV1.execution.operatorResolutionRequest.requestSha256,
      pendingRequest.requestSha256,
    );
    assert.equal(
      manifest.mathematicalV1.operatorResolutionReceipts[0].phase,
      "rerun_completed",
    );
    assert.match(
      manifest.mathematicalV1.operatorResolutionReceipts[0].completedAt,
      /^\d{4}-\d{2}-\d{2}T/,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("concurrent exact operator-resolution duplicates have one durable rerun claimant", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-operator-concurrent-same-"));
  let pendingRequest;
  let adapterCalls = 0;
  let releaseRerun;
  let firstRerunEntered;
  let secondRerunEntered;
  const rerunGate = new Promise((resolve) => {
    releaseRerun = resolve;
  });
  const firstRerun = new Promise((resolve) => {
    firstRerunEntered = resolve;
  });
  const secondRerun = new Promise((resolve) => {
    secondRerunEntered = resolve;
  });
  try {
    const service = createService(outputDir, async (input) => {
      adapterCalls += 1;
      pendingRequest ??= operatorResolutionRequestFixture(input);
      if (!input.operatorResolutionAuthorities?.length) {
        return operatorResolutionRequiredResult(input, pendingRequest);
      }
      return completedResult(input, pendingRequest);
    });
    const releaseTracker = installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "operator-concurrent-same-report",
      "operator-concurrent-same",
    );
    await completeFixtureOcr(service, queued, "operator-concurrent-same");
    await service.action("activate-queue-item", queued.identity);
    const action = {
      ...queued.identity,
      idempotencyKey: "operator-concurrent-same-key",
      operatorResolutionSubmission: {
        schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
        requestSha256: pendingRequest.requestSha256,
        operatorConfirmed: true,
        resolutions: [{
          element: "corners",
          score: 8.03,
          publicExplanation: "Corners show slight wear at the upper left.",
          internalReason: "Concurrent exact-duplicate claimant regression.",
        }],
      },
    };
    action.operatorAuthentication = operatorAuthentication(
      action,
      "authenticated-owner-1",
      new Date(Date.now() + 4_000),
    );

    const runMathematicalStationPackage =
      service.runMathematicalStationPackage.bind(service);
    let rerunCalls = 0;
    service.runMathematicalStationPackage = async (...args) => {
      rerunCalls += 1;
      if (rerunCalls === 1) firstRerunEntered();
      if (rerunCalls === 2) secondRerunEntered();
      await rerunGate;
      return runMathematicalStationPackage(...args);
    };

    const first = service.action("submit-operator-resolutions", structuredClone(action));
    await firstRerun;
    const duplicate = service.action("submit-operator-resolutions", structuredClone(action));
    let boundaryTimeout;
    await Promise.race([
      duplicate.then(() => "duplicate_settled", () => "duplicate_settled"),
      secondRerun.then(() => "second_rerun_entered"),
      new Promise((_, reject) => {
        boundaryTimeout = setTimeout(
          () => reject(new Error("concurrent duplicate did not reach a deterministic claim boundary")),
          2_000,
        );
      }),
    ]);
    clearTimeout(boundaryTimeout);
    releaseRerun();
    const outcomes = await Promise.allSettled([first, duplicate]);

    assert.equal(outcomes.every((outcome) => outcome.status === "fulfilled"), true);
    assert.equal(rerunCalls, 1, "one exact authority may have only one expensive rerun claimant");
    assert.equal(adapterCalls, 2, "initial grading plus exactly one authority rerun are allowed");
    assert.equal(releaseTracker.callCount, 1, "one exact authority may release exactly once");
    assert.equal(
      service.queuedManifests.get(queued.item.queueItemId)
        .mathematicalV1.operatorResolutionReceipts.length,
      1,
    );
    const receipt = service.queuedManifests.get(queued.item.queueItemId)
      .mathematicalV1.operatorResolutionReceipts[0];
    assert.ok(
      Date.parse(receipt.rerunClaim.claimedAt) >=
        Date.parse(receipt.authority.authenticatedAt),
    );
    assert.ok(
      Date.parse(receipt.releasePlan.finalizedAt) >=
        Date.parse(receipt.rerunClaim.claimedAt),
    );
    assert.ok(
      Date.parse(receipt.completedAt) >=
        Date.parse(receipt.releasePlan.finalizedAt),
    );
  } finally {
    releaseRerun();
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("intentional shutdown restores a resumable operator receipt without false grading evidence or later writes", async () => {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tenkings-math-operator-shutdown-resume-"),
  );
  let pendingRequest;
  let service;
  try {
    service = createService(outputDir, async (input) => {
      pendingRequest ??= operatorResolutionRequestFixture(input);
      return operatorResolutionRequiredResult(input, pendingRequest);
    });
    installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "operator-shutdown-resume-hold-long",
      "operator-shutdown-resume",
    );
    await completeFixtureOcr(
      service,
      queued,
      "operator-shutdown-resume",
    );
    await service.action("activate-queue-item", queued.identity);

    const workerPool = new FixedRigMathematicalStationWorkerPoolV1({
      workerPath: path.resolve(
        __dirname,
        "fixtures/fixedRigMathematicalStationWorkerFixture.js",
      ),
      timeoutMs: 5_000,
      maxConcurrency: 2,
      maxAdmitted: 25,
    });
    delete service.dependencies.buildMathematicalStationPackage;
    service.mathematicalStationWorkerPool = workerPool;

    const action = {
      ...queued.identity,
      idempotencyKey: "operator-shutdown-resume-key",
      operatorResolutionSubmission: {
        schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
        requestSha256: pendingRequest.requestSha256,
        operatorConfirmed: true,
        resolutions: [{
          element: "corners",
          score: 8.03,
          publicExplanation: "Corners show slight wear at the upper left.",
          internalReason: "Intentional helper shutdown resumability regression.",
        }],
      },
    };
    action.operatorAuthentication = operatorAuthentication(
      action,
      "authenticated-owner-1",
      new Date(Date.now() + 4_000),
    );

    const submitting = service.action(
      "submit-operator-resolutions",
      action,
    );
    for (
      let attempt = 0;
      attempt < 100 && workerPool.status().active < 1;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(workerPool.status().active, 1);
    const shuttingDown = service.shutdown(
      "intentional mathematical operator-resume test shutdown",
    );
    await assert.rejects(submitting, /intentional helper shutdown/i);
    await shuttingDown;

    assert.deepEqual(workerPool.status(), {
      limit: 2,
      active: 0,
      queued: 0,
      admitted: 0,
      admittedLimit: 25,
    });
    assert.equal(service.mathematicalStationJobs.size, 0);
    assert.equal(service.mathematicalActionJobs.size, 0);
    const manifest = service.queuedManifests.get(queued.item.queueItemId);
    assert.equal(
      manifest.mathematicalV1.execution.status,
      "operator_resolution_required",
    );
    assert.equal(manifest.rapidCapture.workflowState, "operator_resolution_required");
    assert.equal(manifest.mathematicalV1.operatorResolutionReceipts.length, 1);
    const receipt = manifest.mathematicalV1.operatorResolutionReceipts[0];
    assert.equal(receipt.phase, "authority_committed");
    assert.equal(receipt.releasePlan, null);
    assert.equal(receipt.completedAt, null);
    assert.equal(
      service.status().rapidCaptureQueue.items.find(
        (item) => item.queueItemId === queued.item.queueItemId,
      ).state,
      "operator_resolution_required",
    );

    const manifestPath = manifest.outputs.manifestPath;
    const queuePath = path.join(outputDir, "rapid-capture-queue.json");
    const manifestAfterShutdown = fs.readFileSync(manifestPath);
    const queueAfterShutdown = fs.readFileSync(queuePath);
    const persisted = JSON.parse(manifestAfterShutdown.toString("utf8"));
    assert.equal(
      persisted.mathematicalV1.execution.status,
      "operator_resolution_required",
    );
    assert.equal(
      persisted.mathematicalV1.operatorResolutionReceipts[0].phase,
      "authority_committed",
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(
      fs.readFileSync(manifestPath),
      manifestAfterShutdown,
      "no mathematical finalizer may write after shutdown returns",
    );
    assert.deepEqual(
      fs.readFileSync(queuePath),
      queueAfterShutdown,
      "no queue mutation may write after shutdown returns",
    );
  } finally {
    if (service && !service.closing) {
      await service.shutdown("operator shutdown-resume test cleanup");
    }
    fs.rmSync(outputDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

test("concurrent different operator-resolution authorities cannot append behind an unfinished receipt", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-operator-concurrent-different-"));
  let pendingRequest;
  try {
    const service = createService(outputDir, async (input) => {
      pendingRequest ??= operatorResolutionRequestFixture(input);
      if (!input.operatorResolutionAuthorities?.length) {
        return operatorResolutionRequiredResult(input, pendingRequest);
      }
      return completedResult(input, pendingRequest);
    });
    installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "operator-concurrent-different-report",
      "operator-concurrent-different",
    );
    await completeFixtureOcr(service, queued, "operator-concurrent-different");
    await service.action("activate-queue-item", queued.identity);
    const first = {
      ...queued.identity,
      idempotencyKey: "operator-concurrent-different-key-1",
      operatorResolutionSubmission: {
        schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
        requestSha256: pendingRequest.requestSha256,
        operatorConfirmed: true,
        resolutions: [{
          element: "corners",
          score: 8.03,
          publicExplanation: "Corners show slight wear at the upper left.",
          internalReason: "First concurrent authority.",
        }],
      },
    };
    const skewedAuthenticatedAt = new Date(Date.now() + 4_000);
    first.operatorAuthentication = operatorAuthentication(
      first,
      "authenticated-owner-1",
      skewedAuthenticatedAt,
    );
    const contender = structuredClone(first);
    contender.idempotencyKey = "operator-concurrent-different-key-2";
    contender.operatorResolutionSubmission.resolutions[0].score = 8.11;
    contender.operatorResolutionSubmission.resolutions[0].publicExplanation =
      "Corners show slight balanced wear.";
    contender.operatorResolutionSubmission.resolutions[0].internalReason =
      "Conflicting concurrent authority.";
    contender.operatorAuthentication = operatorAuthentication(
      contender,
      "authenticated-owner-1",
      skewedAuthenticatedAt,
    );

    const runRapidQueueMutation = service.runRapidQueueMutation.bind(service);
    let mutationEntrants = 0;
    let releaseMutationEntrants;
    const bothMutationEntrants = new Promise((resolve) => {
      releaseMutationEntrants = resolve;
    });
    service.runRapidQueueMutation = async (...args) => {
      mutationEntrants += 1;
      if (mutationEntrants === 2) releaseMutationEntrants();
      if (mutationEntrants <= 2) await bothMutationEntrants;
      return runRapidQueueMutation(...args);
    };
    service.runMathematicalStationPackage = async () => {
      throw new Error("failpoint after concurrent operator receipt persistence");
    };

    const outcomes = await Promise.allSettled([
      service.action("submit-operator-resolutions", first),
      service.action("submit-operator-resolutions", contender),
    ]);
    const receipts = service.queuedManifests.get(queued.item.queueItemId)
      .mathematicalV1.operatorResolutionReceipts;
    assert.equal(receipts.length, 1, "an unfinished authority must block a second revision inside the queue lock");
    assert.equal(receipts[0].idempotencyKey, first.idempotencyKey);
    assert.ok(
      Date.parse(receipts[0].rerunClaim.claimedAt) >=
        Date.parse(receipts[0].authority.authenticatedAt),
    );
    assert.equal(outcomes[0].status, "rejected");
    assert.match(outcomes[0].reason.message, /failpoint after concurrent operator receipt persistence/);
    assert.equal(outcomes[1].status, "rejected");
    assert.match(outcomes[1].reason.message, /unfinished|conflict|stale|must finish/i);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("a crash immediately after release write resumes from one deterministic byte-identical release plan", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-operator-release-crash-"));
  let pendingRequest;
  let adapterCalls = 0;
  try {
    const service = createService(outputDir, async (input) => {
      adapterCalls += 1;
      pendingRequest ??= operatorResolutionRequestFixture(input);
      if (!input.operatorResolutionAuthorities?.length) {
        return operatorResolutionRequiredResult(input, pendingRequest);
      }
      return completedResult(input, pendingRequest);
    });
    const firstReleaseTracker = installMathematicalReleaseStub(service);
    installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "operator-release-crash-report",
      "operator-release-crash",
    );
    await completeFixtureOcr(service, queued, "operator-release-crash");
    await service.action("activate-queue-item", queued.identity);
    const action = {
      ...queued.identity,
      idempotencyKey: "operator-release-crash-key",
      operatorResolutionSubmission: {
        schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
        requestSha256: pendingRequest.requestSha256,
        operatorConfirmed: true,
        resolutions: [{
          element: "corners",
          score: 8.03,
          publicExplanation: "Corners show slight wear at the upper left.",
          internalReason: "Post-release crash convergence regression.",
        }],
      },
    };
    action.operatorAuthentication = operatorAuthentication(
      action,
      "authenticated-owner-1",
      new Date(Date.now() + 4_000),
    );

    const writeProductionReleaseForManifest =
      service.writeProductionReleaseForManifest.bind(service);
    let failAfterReleaseWrite = true;
    let firstReleasePaths;
    service.writeProductionReleaseForManifest = async (...args) => {
      const release = await writeProductionReleaseForManifest(...args);
      firstReleasePaths = {
        productionReleasePath: args[0].outputs.productionReleasePath,
        labelDataPath: args[0].outputs.labelDataPath,
      };
      if (failAfterReleaseWrite) {
        failAfterReleaseWrite = false;
        throw new Error("failpoint immediately after operator release write");
      }
      return release;
    };
    await assert.rejects(
      service.action("submit-operator-resolutions", action),
      /failpoint immediately after operator release write/,
    );
    assert.equal(adapterCalls, 2);
    assert.equal(firstReleaseTracker.callCount, 1);
    assert.ok(firstReleasePaths);
    const firstReleaseBytes = new Map([
      [
        firstReleasePaths.productionReleasePath,
        fs.readFileSync(firstReleasePaths.productionReleasePath),
      ],
      [
        firstReleasePaths.labelDataPath,
        fs.readFileSync(firstReleasePaths.labelDataPath),
      ],
    ]);
    const crashedReceipt = service.queuedManifests.get(queued.item.queueItemId)
      .mathematicalV1.operatorResolutionReceipts[0];
    assert.equal(crashedReceipt.phase, "authority_committed");
    assert.equal(crashedReceipt.completedAt, null);
    assert.match(crashedReceipt.releasePlan.finalizedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(crashedReceipt.releasePlan.executionSha256, /^[a-f0-9]{64}$/);
    assert.ok(
      Date.parse(crashedReceipt.rerunClaim.claimedAt) >=
        Date.parse(crashedReceipt.authority.authenticatedAt),
    );
    assert.ok(
      Date.parse(crashedReceipt.releasePlan.finalizedAt) >=
        Date.parse(crashedReceipt.rerunClaim.claimedAt),
    );

    const restarted = createService(outputDir, async () => {
      adapterCalls += 1;
      throw new Error("durable release-plan recovery must not rerun the report builder");
    });
    const resumedReleaseTracker = installMathematicalReleaseStub(restarted);
    await restarted.action("activate-queue-item", queued.identity);
    const retry = structuredClone(action);
    retry.operatorAuthentication = null;
    await restarted.action("submit-operator-resolutions", retry);

    assert.equal(adapterCalls, 2, "release-plan recovery must reuse the exact completed rerun");
    assert.equal(resumedReleaseTracker.callCount, 1);
    const completedManifest =
      restarted.queuedManifests.get(queued.item.queueItemId);
    assert.equal(
      completedManifest.mathematicalV1.operatorResolutionReceipts.length,
      1,
    );
    assert.equal(
      completedManifest.mathematicalV1.operatorResolutionReceipts[0].phase,
      "rerun_completed",
    );
    const completedReceipt =
      completedManifest.mathematicalV1.operatorResolutionReceipts[0];
    assert.ok(
      Date.parse(completedReceipt.releasePlan.finalizedAt) >=
        Date.parse(completedReceipt.rerunClaim.claimedAt),
    );
    assert.ok(
      Date.parse(completedReceipt.completedAt) >=
        Date.parse(completedReceipt.releasePlan.finalizedAt),
    );
    for (const [filePath, before] of firstReleaseBytes) {
      assert.deepEqual(
        fs.readFileSync(filePath),
        before,
        `${path.basename(filePath)} must converge byte-identically after restart`,
      );
    }
    const finalArtifactBytes = new Map(
      [
        completedManifest.outputs.manifestPath,
        path.join(outputDir, "rapid-capture-queue.json"),
        completedManifest.outputs.productionReleasePath,
        completedManifest.outputs.labelDataPath,
      ].map((filePath) => [filePath, fs.readFileSync(filePath)]),
    );
    await restarted.action("submit-operator-resolutions", action);
    assert.equal(resumedReleaseTracker.callCount, 1);
    for (const [filePath, before] of finalArtifactBytes) {
      assert.deepEqual(
        fs.readFileSync(filePath),
        before,
        `completed retry must leave ${path.basename(filePath)} byte-identical`,
      );
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("Production-shaped hierarchical finding review persists and serves exact hash-bound ROI and mask evidence", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-station-review-"));
  const calls = [];
  let reviewFixture;
  try {
    let warmSources;
    const service = createService(outputDir, async (input) => {
      calls.push(input);
      if (!input.findingReviews) {
        reviewFixture = findingReviewFixture(input, warmSources);
        return findingRequiredResult(input, reviewFixture);
      }
      return completedResult(input);
    });
    installMathematicalReleaseStub(service);
    warmSources = installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "finding-review-report",
      "finding-review",
    );
    const pending = queued.manifest;
    assert.equal(pending.mathematicalV1.execution.status, "finding_review_required");
    assert.equal(
      pending.mathematicalV1.execution.reviewRequest.artifactSha256,
      REVIEW_REQUEST_SHA256,
    );
    assert.equal(queued.item.state, "finding_review_required");
    assert.equal(queued.item.mathematicalV1.status, "finding_review_required");
    assert.equal(Object.keys(pending.mathematicalV1.reviewAssets).length, 13);
    const persisted = JSON.parse(fs.readFileSync(pending.outputs.manifestPath, "utf8"));
    assert.equal(
      persisted.mathematicalV1.execution.reviewRequest.artifactSha256,
      REVIEW_REQUEST_SHA256,
    );
    assert.equal(Object.keys(persisted.mathematicalV1.reviewAssets).length, 13);

    await service.action("activate-queue-item", queued.identity);
    const active = service.status().rapidCaptureQueue.activeReview;
    assert.equal(active.queueItemId, queued.item.queueItemId);
    assert.equal(active.manifest.mathematicalV1.execution.status, "finding_review_required");
    assert.equal(JSON.stringify(active.manifest.mathematicalV1).includes("filePath"), false);

    const requestFinding = pending.mathematicalV1.execution.reviewRequest.findings[0];
    assert.deepEqual(
      Object.values(requestFinding.reviewEvidence).map((asset) => asset.assetId),
      [
        "front/mathematical-v1/findings/surface-fixture-finding/roi.png",
        "front/mathematical-v1/findings/surface-fixture-finding/segmentation-mask.png",
        "front/mathematical-v1/findings/surface-fixture-finding/confidence-mask.png",
        "front/mathematical-v1/findings/surface-fixture-finding/illumination-mask.png",
      ],
    );
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
        queued.identity,
        metadata.assetId,
      );
      assert.equal(served.queueItemId, queued.item.queueItemId);
      assert.equal(served.gradingSessionId, queued.item.sessionId);
      assert.equal(served.reportId, queued.item.reportId);
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
      queued.identity,
      requestFinding.reviewEvidence.roi.assetId,
    );
    assert.deepEqual(roiServed.bytes, reviewFixture.rawBytes.roi);
    await assert.rejects(
      service.mathematicalReviewAsset(
        { ...queued.identity, gradingSessionId: "wrong-grading-session" },
        requestFinding.reviewEvidence.roi.assetId,
      ),
      /does not match the exact persisted queue\/session\/report triple/i,
    );

    const baseReview = {
      findingId: requestFinding.findingId,
      reviewRequestSha256: REVIEW_REQUEST_SHA256,
      status: "confirmed",
      reviewedAt: "2026-07-19T13:00:00.000Z",
    };
    await assert.rejects(
      service.action("submit-mathematical-finding-reviews", {
        ...queued.identity,
        mathematicalReviewRequestSha256: REVIEW_REQUEST_SHA256,
        mathematicalFindingReviews: [{ ...baseReview, confidence: 1 }],
      }),
      /fields do not match|confidence/i,
    );
    await assert.rejects(
      service.action("submit-mathematical-finding-reviews", {
        ...queued.identity,
        mathematicalReviewRequestSha256: "f".repeat(64),
        mathematicalFindingReviews: [baseReview],
      }),
      /exact pending request SHA-256/i,
    );

    const completed = await service.action("submit-mathematical-finding-reviews", {
      ...queued.identity,
      mathematicalReviewRequestSha256: REVIEW_REQUEST_SHA256,
      mathematicalFindingReviews: [baseReview],
    });
    const completedManifest = service.queuedManifests.get(queued.item.queueItemId);
    assert.equal(completedManifest.mathematicalV1.execution.status, "completed");
    assert.equal(completedManifest.mathematicalV1.execution.attempt, 2);
    assert.equal(completedManifest.mathematicalV1.reviewAssets, undefined);
    assert.equal(
      completed.rapidCaptureQueue.items.find((item) => item.queueItemId === queued.item.queueItemId).state,
      "finalizing",
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].findingReviews, [baseReview]);
    assert.equal("confidence" in calls[1].findingReviews[0], false);
    assert.equal(calls[0].generatedAt, calls[1].generatedAt);

    const attempt = { ...queued.identity, attemptOwnerId: "mathematical-review-ocr-owner" };
    await service.action("begin-queued-ocr", attempt);
    const ready = await service.action("complete-queued-ocr", {
      ...attempt,
      result: safeOcrResult(queued.item),
    });
    const readyItem = ready.rapidCaptureQueue.items.find(
      (item) => item.queueItemId === queued.item.queueItemId,
    );
    assert.equal(readyItem.state, "report_ready_needs_confirm");
    assert.equal(readyItem.ocr.state, "succeeded");
    assert.equal(readyItem.autoConfirmed, false);
    assert.equal(readyItem.autoPublished, false);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("insufficient Mathematical evidence persists exact stage, reasons, flags, and cannot publish or fall back", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-station-insufficient-"));
  try {
    const service = createService(outputDir, async () => insufficientResult());
    installSimulatedMathematicalCapture(service);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "insufficient-math-report",
      "insufficient",
    );
    assert.deepEqual(queued.manifest.mathematicalV1.execution, {
      status: "insufficient_evidence",
      completedAt: queued.manifest.mathematicalV1.execution.completedAt,
      attempt: 1,
      v0FallbackUsed: false,
      failedStage: "surface_measurement",
      reasons: ["Front center is fully obscured in every usable directional channel."],
      requiresRecapture: true,
      requiresApprovedDesignReference: false,
      requiresCalibration: false,
      requiresImplementationCorrection: false,
    });
    assert.equal(queued.item.state, "insufficient_evidence");
    assert.deepEqual(queued.item.mathematicalV1, {
      status: "insufficient_evidence",
      failedStage: "surface_measurement",
      reasons: ["Front center is fully obscured in every usable directional channel."],
      requiresRecapture: true,
      requiresApprovedDesignReference: false,
      requiresCalibration: false,
      requiresImplementationCorrection: false,
    });
    assert.equal(queued.manifest.outputs.reportBundlePath, undefined);
    assert.equal(queued.manifest.productionRelease, undefined);

    const inspected = await service.action("activate-queue-item", queued.identity);
    assert.equal(
      inspected.rapidCaptureQueue.activeReview.manifest.mathematicalV1.execution.status,
      "insufficient_evidence",
    );
    await assert.rejects(
      service.action("publish-report", {
        ...queued.identity,
        publication: {
          queueItemId: queued.identity.queueItemId,
          gradingSessionId: queued.identity.gradingSessionId,
          reportId: queued.identity.reportId,
          publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/insufficient-math-report",
          publishedAt: "2026-07-19T14:30:00.000Z",
        },
      }),
      /review-ready item/i,
    );
    await service.shutdown("insufficient-evidence persistence reload");
    const reloaded = createService(outputDir, async () => insufficientResult());
    try {
      const persisted = reloaded.status().rapidCaptureQueue.items.find(
        (item) => item.queueItemId === queued.item.queueItemId,
      );
      assert.equal(persisted.state, "insufficient_evidence");
      assert.equal(persisted.history.at(-1).state, "insufficient_evidence");
      assert.equal(persisted.mathematicalV1.status, "insufficient_evidence");
      assert.equal(persisted.ocr.state, queued.item.ocr.state);
    } finally {
      await reloaded.shutdown("insufficient-evidence persistence reload complete");
    }
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
  }, process.env, undefined, undefined, {
    stopOrphanedPreviewStreamsUntilReleased: async () => 0,
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const response = await postWithoutToken(server, Buffer.alloc(24, 7));
    assert.equal(response.statusCode, 401);
    assert.match(response.body, /STATION_BRIDGE_UNAUTHORIZED/);
    const bridgeSource = fs.readFileSync(
      path.resolve(__dirname, "../src/drivers/aiGraderLocalStationBridge.ts"),
      "utf8",
    );
    assert.match(bridgeSource, /url\.searchParams\.size !== 4/);
    for (const identityHeader of [
      "X-AI-Grader-Queue-Item-Id",
      "X-AI-Grader-Grading-Session-Id",
      "X-AI-Grader-Report-Id",
    ]) {
      assert.equal(bridgeSource.includes(`"${identityHeader}": asset.`), true);
    }
  } finally {
    if (server.listening) await closeServer(server);
    // Constructor recovery persists the empty authoritative queue
    // asynchronously; let that final atomic rename leave the Windows handle
    // before removing this HTTP fixture's root.
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
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
    installMathematicalReleaseStub(service);
    warmSources = installSimulatedMathematicalCapture(service, true);
    const queued = await captureMathematicalCard(
      service,
      printedAuthority(),
      "rapid-math-review-report",
      "rapid-review",
    );
    assert.equal(queued.item.state, "finding_review_required");
    assert.equal(queued.item.mathematicalV1.status, "finding_review_required");
    assert.equal(queued.item.mathematicalV1.reviewRequestSha256, REVIEW_REQUEST_SHA256);
    assert.equal(queued.item.autoConfirmed, false);
    assert.equal(queued.item.autoPublished, false);
    assert.equal(queued.item.error, undefined);

    const next = await startMathematicalSession(
      service,
      printedAuthority(),
      "rapid-next-card-report",
    );
    assert.equal(next.currentStep, "capture_front");
    const nextSessionId = next.sessionId;

    const activated = await service.action("activate-queue-item", queued.identity);
    assert.equal(activated.sessionId, nextSessionId);
    assert.equal(activated.currentStep, "capture_front");
    assert.equal(activated.latestReport.exists, false);
    assert.equal(activated.rapidCaptureQueue.activeReview.queueItemId, queued.item.queueItemId);
    assert.equal(
      activated.rapidCaptureQueue.activeReview.manifest.mathematicalV1.execution.status,
      "finding_review_required",
    );
    assert.equal(
      JSON.stringify(activated.rapidCaptureQueue.activeReview.manifest.mathematicalV1).includes("filePath"),
      false,
    );

    const attempt = { ...queued.identity, attemptOwnerId: "rapid-mathematical-ocr-owner" };
    await service.action("begin-queued-ocr", attempt);
    const ocrComplete = await service.action("complete-queued-ocr", {
      ...attempt,
      result: safeOcrResult(queued.item),
    });
    const ocrItem = ocrComplete.rapidCaptureQueue.items.find(
      (item) => item.queueItemId === queued.item.queueItemId,
    );
    assert.equal(ocrItem.ocr.state, "succeeded");
    assert.equal(ocrItem.state, "finding_review_required");

    const finding = ocrComplete.rapidCaptureQueue.activeReview
      .manifest.mathematicalV1.execution.reviewRequest.findings[0];
    const review = {
      findingId: finding.findingId,
      reviewRequestSha256: REVIEW_REQUEST_SHA256,
      status: "confirmed",
      reviewedAt: "2026-07-19T14:00:00.000Z",
    };
    const ready = await service.action("submit-mathematical-finding-reviews", {
      ...queued.identity,
      mathematicalReviewRequestSha256: REVIEW_REQUEST_SHA256,
      mathematicalFindingReviews: [review],
      operatorId: "rapid-review-operator",
      warningsAccepted: true,
    });
    const completedQueueItem = ready.rapidCaptureQueue.items.find(
      (item) => item.queueItemId === queued.item.queueItemId,
    );
    assert.equal(completedQueueItem.state, "report_ready_needs_confirm");
    assert.equal(completedQueueItem.mathematicalV1.status, "completed");
    assert.equal(completedQueueItem.autoConfirmed, false);
    assert.equal(completedQueueItem.autoPublished, false);
    assert.equal(
      ready.rapidCaptureQueue.activeReview.manifest.mathematicalV1.execution.v0FallbackUsed,
      false,
    );
    assert.equal(ready.rapidCaptureQueue.activeReview.manifest.currentStep, "label_data_ready");
    assert.equal(ready.sessionId, nextSessionId);
    assert.equal(ready.currentStep, "capture_front");
    assert.equal(adapterCallCount, 2);

    const mutableItem = service.exactMutableQueuedItem(queued.identity);
    mutableItem.state = "published";
    service.committedRapidQueue = structuredClone(service.rapidQueue);
    await assert.rejects(
      service.action("activate-queue-item", queued.identity),
      /not ready for review \(state published\)/i,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
