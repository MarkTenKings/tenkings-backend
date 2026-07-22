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
  POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
  canonicalJsonV1,
} = require("@tenkings/shared");

const BUNDLE_SHA256 = "a".repeat(64);
const CALIBRATION_ARTIFACT_SHA256 = "c".repeat(64);
const REVIEW_REQUEST_SHA256 = "d".repeat(64);
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
    cardNumber: "25/102",
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

function createService(outputDir, builder, configOverrides = {}) {
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
    ...configOverrides,
  });
  return new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    loadMathematicalCalibrationBundle: calibrationLoader,
    buildMathematicalStationPackage: builder,
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
    captureTriggerAt: timestamp,
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
    warnings: [],
  };
}

function installMathematicalReleaseStub(service) {
  service.writeProductionReleaseForManifest = async (manifest) => {
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
    };
    fs.writeFileSync(productionReleasePath, JSON.stringify(release, null, 2));
    fs.writeFileSync(labelDataPath, JSON.stringify(release.label, null, 2));
    manifest.outputs.productionReleasePath = productionReleasePath;
    manifest.outputs.labelDataPath = labelDataPath;
    manifest.productionRelease = release;
    return release;
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
  const item = service.status().rapidCaptureQueue.items.find((candidate) => candidate.reportId === reportId);
  assert.ok(item, `Expected durable queue item for ${reportId}.`);
  assert.equal(item.sessionId, gradingSessionId);
  return {
    item,
    identity: {
      queueItemId: item.queueItemId,
      gradingSessionId: item.sessionId,
      reportId: item.reportId,
    },
    manifest: service.queuedManifests.get(item.queueItemId),
  };
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
  const unavailable = new AiGraderLocalStationBridgeService(unavailableConfig);
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

test("finding review persists and serves exact True View, directional, ROI, segmentation, confidence, and illumination evidence before deterministic rerun", async () => {
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
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
