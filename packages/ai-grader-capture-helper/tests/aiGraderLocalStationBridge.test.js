const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  AiGraderPreviewJpegFrameAssembler,
  AiGraderLocalStationBridgeService,
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
  buildAiGraderLocalStationBridgeConfig,
  retainAiGraderRapidCaptureQueueItems,
} = require("../dist/drivers/aiGraderLocalStationBridge");

const sourceRoot = path.resolve(__dirname, "../src");
const bridgeSource = fs.readFileSync(path.join(sourceRoot, "drivers/aiGraderLocalStationBridge.ts"), "utf8");
const RAW_ROLES = ["dark_control", "all_on", "accepted_profile", ...Array.from({ length: 8 }, (_, index) => `channel_${index + 1}`)];
const OCR_FIELDS = [
  "category", "playerName", "cardName", "year", "manufacturer", "sport", "game",
  "productSet", "cardNumber", "parallel", "insert", "numbered", "autograph", "memorabilia",
];

function configFor(outputDir, dependencies = {}, overrides = {}, warmRunner) {
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 47652,
    allowedOrigins: ["https://collect.tenkings.co"],
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir,
    captureProfile: "production_fast",
    ...overrides,
  });
  return { config, service: new AiGraderLocalStationBridgeService(config, undefined, warmRunner, dependencies) };
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

function prepareExactCapturedCard(service, seed) {
  const manifest = service.manifest;
  const frontDir = path.join(manifest.outputs.sessionDir, "front-package");
  const backDir = path.join(manifest.outputs.sessionDir, "back-package");
  fs.mkdirSync(frontDir, { recursive: true });
  fs.mkdirSync(backDir, { recursive: true });
  manifest.outputs.frontPackageDir = frontDir;
  manifest.outputs.backPackageDir = backDir;
  manifest.commandResults.push(
    { stepId: "capture_front", ok: true, exitCode: 0, payload: capturePayload(manifest, "front", seed) },
    { stepId: "capture_back", ok: true, exitCode: 0, payload: capturePayload(manifest, "back", seed) },
  );
  return manifest;
}

function bindReadyPreview(service, side, frameSuffix) {
  const manifest = service.manifest;
  const frameId = `${side}-frame-${frameSuffix}`;
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
  service.retainPreviewObservation({ sessionId: manifest.sessionId, side, sideEpoch: manifest.previewStatus.sideEpoch }, frameId, timestamp);
  service.retainPreviewGeometryObservation(geometry);
  if (side === "back") {
    const profileIdentity = service.durableAcceptedCaptureProfile().identity;
    manifest.liveLighting.backPositioning = {
      ...manifest.liveLighting.backPositioning,
      status: "ready",
      captureReady: true,
      sessionId: manifest.sessionId,
      sideEpoch: manifest.previewStatus.sideEpoch,
      profileIdentity,
    };
  }
  return {
    idempotencyKey: `atomic-${side}-${frameSuffix}-idempotency`,
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

function bindLiveFrontPreview(service) {
  const manifest = service.manifest;
  manifest.previewStatus.status = "live";
  manifest.previewStatus.cameraOwnership = "preview_stream";
  manifest.previewStatus.sessionId = manifest.sessionId;
  manifest.previewStatus.activeSide = "front";
  return service.status();
}

function installSimulatedPublicCapture(service, behavior = {}) {
  const invocations = { front: 0, back: 0 };
  service.runWarmSideCapture = async (side) => {
    invocations[side] += 1;
    const manifest = service.manifest;
    const seed = `${manifest.reportId}-${invocations[side]}`;
    const packageDir = path.join(manifest.outputs.sessionDir, `${side}-package`);
    fs.mkdirSync(packageDir, { recursive: true });
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
    const supplied = behavior.processing?.(side, manifest, packageDir, payload.sideProcessingJob);
    if (supplied) {
      const job = Promise.resolve(supplied).then(async (processed) => {
        service.recordProcessedNormalizedOcrImage(manifest, side, processed);
        manifest.warmRunnerStatus.phases.push({
          id: `process_${side}_artifacts`, label: `${side} processing`, status: "completed", side,
          backend: "warm_full_forensic_runner", executionPath: "warm_full_forensic_runner",
        });
        return processed;
      });
      service.warmProcessingJobs.set(`${manifest.sessionId}:${side}`, job);
      void job.catch(() => {});
      await Promise.resolve();
      await Promise.resolve();
    }
    return result;
  };
  return invocations;
}

function queueItemFor(manifest, overrides = {}) {
  const queueItemId = overrides.queueItemId ?? `${manifest.sessionId}-rapid-card`;
  const now = overrides.updatedAt ?? new Date().toISOString();
  const state = overrides.state ?? "finalizing";
  const captured = Object.fromEntries(["front", "back"].map((side) => [side,
    [...manifest.commandResults].reverse().find((result) => result.stepId === `capture_${side}` && result.ok)?.payload,
  ]));
  const rawEvidence = {
    format: "tiff",
    sides: ["front", "back"].map((side) => {
      const payload = captured[side];
      if (!payload) return {
        side,
        packageId: `${manifest.sessionId}-${side}-package`,
        roles: rawRoles(`${manifest.sessionId}:${side}`),
      };
      const captures = payload.warmBatch.captures;
      return {
        side,
        packageId: payload.packageId,
        roles: [captures.darkControl, captures.allOn, captures.acceptedProfile, ...captures.channels].map((entry) => ({
          role: entry.role,
          sha256: entry.capture.sha256,
          byteSize: entry.capture.byteSize,
          mimeType: "image/tiff",
        })),
      };
    }),
  };
  const sideProcessingJobs = Object.fromEntries(["front", "back"].map((side) => [side, {
    ...(captured[side]?.sideProcessingJob ?? {
      requestId: `${manifest.sessionId}-${side}-request`,
      sessionId: manifest.sessionId,
      side,
      packageId: `${manifest.sessionId}-${side}-package`,
      acceptedAt: now,
    }),
  }]));
  return {
    queueItemId,
    sessionId: manifest.sessionId,
    reportId: manifest.reportId,
    state,
    queuedAt: now,
    updatedAt: now,
    history: [{ state, at: now, detail: `Exact ${state} fixture.` }],
    humanConfirmationRequired: true,
    autoConfirmed: false,
    autoPublished: false,
    rawEvidence,
    sideProcessingJobs,
    ocr: overrides.ocr ?? { state: "waiting_for_normalized", updatedAt: now, attemptCount: 0 },
    manifestPath: manifest.outputs.manifestPath,
    ...(overrides.error ? { error: overrides.error } : {}),
  };
}

async function normalizedImage(side, packageDir, color) {
  const localPath = path.join(packageDir, `${side}-normalized-card.png`);
  await sharp({ create: { width: 1200, height: 1680, channels: 3, background: color } }).png().toFile(localPath);
  const bytes = fs.readFileSync(localPath);
  return {
    side,
    artifactRole: "normalized_card",
    fileName: `${side}-normalized-card.png`,
    mimeType: "image/png",
    checksumSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength,
    widthPx: 1200,
    heightPx: 1680,
    localPath,
  };
}

async function processedNormalizedSide(side, packageDir, color = side === "front" ? "#203040" : "#405060") {
  const normalizedDir = path.join(packageDir, side, "normalized");
  fs.mkdirSync(normalizedDir, { recursive: true });
  const image = await normalizedImage(side, normalizedDir, color);
  return {
    manifest: {
      evidenceSide: side,
      [side]: {
        normalizedCard: {
          normalizedArtifact: {
            mimeType: "image/png",
            imageWidth: image.widthPx,
            imageHeight: image.heightPx,
            sha256: image.checksumSha256,
            byteSize: image.byteSize,
            localOutputPath: image.localPath,
          },
        },
      },
    },
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
    warnings: [],
  };
}

async function createEligibleQueuedFixture(outputDir, seed = "ocr", configOverrides = {}) {
  const { config, service } = configFor(outputDir, {}, configOverrides);
  await new Promise((resolve) => setImmediate(resolve));
  await service.rapidMutationChain;
  await service.action("start-session", { captureProfile: "production_fast", reportId: `${seed}-report` });
  const queuedManifest = service.manifest;
  prepareExactCapturedCard(service, seed);
  const frontDir = queuedManifest.outputs.frontPackageDir;
  const backDir = queuedManifest.outputs.backPackageDir;
  const images = [
    await normalizedImage("front", frontDir, "#102030"),
    await normalizedImage("back", backDir, "#304050"),
  ];
  const now = new Date().toISOString();
  const item = queueItemFor(queuedManifest, {
    ocr: { state: "eligible", updatedAt: now, attemptCount: 0, eligibleAt: now, images },
  });
  queuedManifest.rapidCapture.enabled = true;
  queuedManifest.rapidCapture.queueItemId = item.queueItemId;
  queuedManifest.rapidCapture.safelyQueuedAt = now;
  queuedManifest.rapidCapture.workflowState = "finalizing";
  queuedManifest.rapidCapture.workflowHistory = item.history;
  queuedManifest.rapidCapture.ocr = { ...item.ocr, images: item.ocr.images.map(({ localPath, ...image }) => image) };
  service.rapidQueue = { schemaVersion: "ten-kings-ai-grader-rapid-capture-queue-v2", updatedAt: now, rapidCaptureEnabled: true, items: [item] };
  service.committedRapidQueue = structuredClone(service.rapidQueue);
  service.queuedManifests.set(item.queueItemId, queuedManifest);
  service.manifest = service.cleanStartNewCardManifest(queuedManifest);
  return { config, service, item, queuedManifest, images };
}

test("station bridge is one loopback production_fast road and exposes no removed selector/actions", () => {
  const outputDir = path.join(os.tmpdir(), "tenkings-station-contract");
  const { config } = configFor(outputDir);
  assert.equal(config.host, "127.0.0.1");
  assert.deepEqual(config.allowedOrigins, ["https://collect.tenkings.co"]);
  assert.equal(config.stationToken, "StationTokenStationTokenStationToken1234");
  assert.equal(config.captureProfile, "production_fast");
  assert.equal(AI_GRADER_LOCAL_STATION_BRIDGE_VERSION, "ai-grader-local-station-bridge-v0.10");
  assert.throws(() => buildAiGraderLocalStationBridgeConfig({ ...config, host: "0.0.0.0" }), /loopback/i);
  assert.throws(() => buildAiGraderLocalStationBridgeConfig({ ...config, captureProfile: "full_forensic" }), /one required capture profile/i);
  for (const removed of ["configure-rapid-capture", "queue-current-card", 'captureProfile ?? "full_forensic"']) {
    assert.equal(bridgeSource.includes(removed), false, `removed production path remains: ${removed}`);
  }
  assert.match(bridgeSource, /oneRoadProductionFastRequired: true/);
  assert.doesNotMatch(bridgeSource, /productionFastOptIn/);
  assert.equal(bridgeSource.includes("writeProductionReleaseForManifest(manifest, request)"), false, "Approve & Publish must reuse immutable background release");
});

test("station launcher passes the exact production_fast capture profile pair", () => {
  const launcherSource = fs.readFileSync(
    path.resolve(__dirname, "../../../scripts/ai-grader/start-local-station-bridge.ps1"),
    "utf8",
  );
  assert.equal(
    launcherSource.includes('"--capture-profile", "production_fast"'),
    true,
  );
});

test("Start New Card applies configured lighting and returns Capture Front lighting-ready", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-start-lighting-"));
  try {
    const { service } = configFor(outputDir);
    const started = await service.action("start-session", { captureProfile: "production_fast", reportId: "lighting-ready-report" });
    assert.equal(started.liveLighting.status, "on");
    assert.equal(started.liveLighting.physicalState.state, "positioning_light_verified");
    assert.equal(started.liveLighting.applied.verificationComplete, true);
    assert.equal(started.liveLighting.applied.expectedWriteCount, started.liveLighting.applied.acknowledgedWriteCount);
    assert.equal(started.liveLighting.profile.acceptedForCapture, true);
    assert.equal(started.acceptedProfile.source, "bridge_operator");
    assert.equal(bindLiveFrontPreview(service).frontCaptureReadiness.ready, true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("failed configured lighting durably rolls back to sessionless Start New Card and a later retry succeeds", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-start-lighting-retry-"));
  let writeCall = 0;
  try {
    const { config, service } = configFor(outputDir, {
      writeLightingFrames: async (frames) => {
        writeCall += 1;
        const acknowledged = writeCall === 1 ? frames.slice(0, -1) : frames;
        return acknowledged.map(() => ({ responseKind: "mock", ok: true }));
      },
    });
    await assert.rejects(
      service.action("start-session", { captureProfile: "production_fast", reportId: "lighting-failed-report" }),
      /Retry Start New Card/,
    );
    const failed = service.status();
    assert.equal(failed.sessionId, undefined);
    assert.equal(failed.currentStep, "start_new_card");
    assert.equal(failed.liveLighting.physicalState.state, "safe_off_verified");
    const persistedClean = JSON.parse(fs.readFileSync(failed.outputs.manifestPath, "utf8"));
    assert.equal(persistedClean.sessionId, undefined);
    assert.equal(persistedClean.currentStep, "start_new_card");
    assert.equal(new AiGraderLocalStationBridgeService(config).status().currentStep, "start_new_card");
    const retried = await service.action("start-session", { captureProfile: "production_fast", reportId: "lighting-retried-report" });
    assert.equal(retried.liveLighting.physicalState.state, "positioning_light_verified");
    assert.equal(bindLiveFrontPreview(service).frontCaptureReadiness.ready, true);
    assert.ok(writeCall >= 3);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("atomic Back queue commit persists exact TIFF hashes and queue before capture ownership can release", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-atomic-queue-"));
  const observations = [];
  try {
    const { service } = configFor(outputDir, {
      writeRapidQueueAtomic: async (filePath, value) => {
        const item = value.items[0];
        const persistedManifest = JSON.parse(fs.readFileSync(item.manifestPath, "utf8"));
        observations.push({
          lockHeld: Boolean(service.captureLock),
          safelyQueuedAt: persistedManifest.rapidCapture.safelyQueuedAt,
          backFormat: item.rawEvidence.format,
          backRoles: item.rawEvidence.sides.find((side) => side.side === "back").roles.length,
          jobs: Object.keys(item.sideProcessingJobs).sort(),
        });
        fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
      },
    });
    service.enqueueRapidFinalization = () => {};
    await service.action("start-session", { captureProfile: "production_fast", reportId: "atomic-order-report" });
    prepareExactCapturedCard(service, "atomic-order");
    service.acquireCaptureLock("atomic-test-owner");
    await service.commitCurrentCardToRapidQueueUnderCaptureLock("atomic-test-owner");
    assert.deepEqual(observations, [{ lockHeld: true, safelyQueuedAt: service.manifest.rapidCapture.safelyQueuedAt, backFormat: "tiff", backRoles: 11, jobs: ["back", "front"] }]);
    assert.equal(service.status().rapidCaptureQueue.items[0].rawEvidence.format, "tiff");
    assert.equal(service.captureLock.owner, "atomic-test-owner", "queue commit never releases capture ownership itself");
    service.releaseCaptureLock("atomic-test-owner");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("atomic Back waits for both exact warm-side admissions before queue commit and capture release", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-atomic-admission-"));
  const admissionControls = new Map();
  const admissionResolved = new Set();
  const releaseObservations = [];
  let queueWriteCount = 0;
  let service;
  const warmRunner = {
    async captureSide(input) {
      const payload = capturePayload(service.manifest, input.side, `real-admission-${input.side}`);
      const packageDir = path.join(service.manifest.outputs.sessionDir, `${input.side}-admission-package`);
      const sideDir = path.join(packageDir, input.side);
      fs.mkdirSync(sideDir, { recursive: true });
      return {
        executionPath: "warm_full_forensic_runner",
        packageId: payload.packageId,
        packageDir,
        sideDir,
        side: input.side,
        captureProfile: "production_fast",
        rawEvidenceFormat: "tiff",
        hardwareMeasurement: false,
        batch: {
          executionPath: "warm_full_forensic_runner",
          fallbackUsed: false,
          side: input.side,
          outputDir: sideDir,
          captures: payload.warmBatch.captures,
          timing: {},
          safety: { safeOffBefore: true, safeOffAfter: true },
        },
      };
    },
    processSide(batch, identity) {
      let resolveAdmission;
      const admission = new Promise((resolve) => {
        resolveAdmission = resolve;
      });
      const result = new Promise(() => {});
      result.admission = admission;
      admissionControls.set(batch.side, {
        identity,
        batch,
        resolve() {
          admissionResolved.add(batch.side);
          resolveAdmission({
            status: "accepted",
            requestId: identity.requestId,
            sessionId: identity.sessionId,
            side: batch.side,
            packageId: batch.packageId,
            acceptedAt: new Date().toISOString(),
            validationBoundary: "structural_snapshot_only",
            sourceIntegrity: "pending_worker_validation",
          });
        },
      });
      return result;
    },
    async cancelSession() {},
    async shutdownProcessingWorker() {},
    processingWorkerStatus() {
      return { active: false, pending: 0, maxPending: 20, maxConcurrency: 1, closed: false };
    },
  };
  const waitForAdmission = async (side) => {
    for (let attempt = 0; attempt < 500 && !admissionControls.has(side); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(admissionControls.has(side), true, `${side} processing reached its admission boundary`);
    return admissionControls.get(side);
  };
  try {
    const created = configFor(
      outputDir,
      {
        writeRapidQueueAtomic: async (filePath, value) => {
          const item = value.items[0];
          if (!item) {
            fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
            return;
          }
          queueWriteCount += 1;
          assert.equal(admissionResolved.has("front"), true);
          assert.equal(admissionResolved.has("back"), true);
          assert.deepEqual(Object.keys(item.sideProcessingJobs).sort(), ["back", "front"]);
          fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
        },
      },
      {},
      warmRunner,
    );
    service = created.service;
    service.enqueueRapidFinalization = () => {};
    const originalRunWarmSideCapture = service.runWarmSideCapture.bind(service);
    service.runWarmSideCapture = async (side) => {
      const priorMode = service.config.mode;
      service.config.mode = "real";
      try {
        return await originalRunWarmSideCapture(side);
      } finally {
        service.config.mode = priorMode;
      }
    };
    const originalReleaseCaptureLock = service.releaseCaptureLock.bind(service);
    service.releaseCaptureLock = (owner) => {
      if (owner.startsWith("atomic-capture-")) {
        releaseObservations.push({
          owner,
          frontAdmitted: admissionResolved.has("front"),
          backAdmitted: admissionResolved.has("back"),
          queueWriteCount,
          queueLength: service.status().rapidCaptureQueue.items.length,
        });
      }
      return originalReleaseCaptureLock(owner);
    };

    await service.action("start-session", {
      captureProfile: "production_fast",
      reportId: "atomic-admission-report",
    });
    const frontRequest = bindReadyPreview(service, "front", "admission");
    let frontSettled = false;
    const frontAction = service.action("capture-front", frontRequest).finally(() => {
      frontSettled = true;
    });
    const frontAdmission = await waitForAdmission("front");
    assert.equal(frontSettled, false);
    assert.match(service.captureLock.owner, /^atomic-capture-front:/);
    assert.equal(queueWriteCount, 0);
    frontAdmission.resolve();
    const front = await frontAction;
    assert.equal(front.currentStep, "prompt_flip_card");
    assert.deepEqual(
      releaseObservations.filter((entry) => entry.owner.startsWith("atomic-capture-front:")),
      [{
        owner: `atomic-capture-front:${frontRequest.idempotencyKey}`,
        frontAdmitted: true,
        backAdmitted: false,
        queueWriteCount: 0,
        queueLength: 0,
      }],
    );

    const backRequest = bindReadyPreview(service, "back", "admission");
    let backSettled = false;
    const backAction = service.action("capture-back", backRequest).finally(() => {
      backSettled = true;
    });
    const backAdmission = await waitForAdmission("back");
    assert.equal(backSettled, false);
    assert.match(service.captureLock.owner, /^atomic-capture-back:/);
    assert.equal(service.status().rapidCaptureQueue.items.length, 0);
    assert.equal(queueWriteCount, 0);
    assert.equal(
      releaseObservations.some((entry) => entry.owner.startsWith("atomic-capture-back:")),
      false,
    );

    backAdmission.resolve();
    const back = await backAction;
    assert.equal(back.currentStep, "start_new_card");
    assert.equal(back.sessionId, undefined);
    assert.equal(queueWriteCount, 1);
    assert.equal(back.rapidCaptureQueue.items.length, 1);
    assert.deepEqual(
      releaseObservations.filter((entry) => entry.owner.startsWith("atomic-capture-back:")),
      [{
        owner: `atomic-capture-back:${backRequest.idempotencyKey}`,
        frontAdmitted: true,
        backAdmitted: true,
        queueWriteCount: 1,
        queueLength: 1,
      }],
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("queue persistence failure rolls back exact card commit and cannot report capture release success", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-atomic-rollback-"));
  try {
    const { service } = configFor(outputDir, { writeRapidQueueAtomic: async () => { throw new Error("intentional queue disk failure"); } });
    service.enqueueRapidFinalization = () => {};
    await service.action("start-session", { captureProfile: "production_fast", reportId: "rollback-report" });
    prepareExactCapturedCard(service, "rollback");
    service.acquireCaptureLock("rollback-owner");
    await assert.rejects(service.commitCurrentCardToRapidQueueUnderCaptureLock("rollback-owner"), /capture ownership was not released/i);
    assert.equal(service.status().rapidCaptureQueue.items.length, 0);
    assert.equal(service.manifest.rapidCapture.safelyQueuedAt, undefined);
    assert.equal(service.captureLock.owner, "rollback-owner");
    service.releaseCaptureLock("rollback-owner");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("ten public Start New Card -> Front -> Back actions create ten identities and twenty side jobs while Card 1 background is held", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-ten-card-"));
  try {
    const { service } = configFor(outputDir);
    const held = [];
    service.enqueueRapidFinalization = (queueItemId) => held.push({
      queueItemId,
      lockHeld: Boolean(service.captureLock),
      sessionId: service.manifest.sessionId,
      currentStep: service.manifest.currentStep,
    });
    for (let index = 0; index < 10; index += 1) {
      const started = await service.action("start-session", { captureProfile: "production_fast", reportId: `ten-card-report-${index}` });
      assert.equal(started.currentStep, "capture_front", `Card ${index + 1} starts while older background items are held`);
      const frontRequest = bindReadyPreview(service, "front", index);
      const front = await service.action("capture-front", frontRequest);
      assert.equal(front.currentStep, "prompt_flip_card");
      await assert.rejects(
        service.action("start-session", { captureProfile: "production_fast", reportId: `illegal-replacement-${index}` }),
        /clean sessionless start_new_card/i,
      );
      const backRequest = bindReadyPreview(service, "back", index);
      const back = await service.action("capture-back", backRequest);
      assert.equal(back.currentStep, "start_new_card");
      assert.equal(back.sessionId, undefined);
    }
    const items = service.status().rapidCaptureQueue.items;
    assert.equal(items.length, 10);
    assert.equal(new Set(items.map((item) => item.queueItemId)).size, 10);
    assert.equal(new Set(items.map((item) => item.sessionId)).size, 10);
    assert.equal(new Set(items.map((item) => item.reportId)).size, 10);
    assert.equal(items.reduce((count, item) => count + Object.keys(item.sideProcessingJobs).length, 0), 20);
    assert.equal(held.length, 10);
    assert.ok(held.every((entry) => !entry.lockHeld && entry.sessionId === undefined && entry.currentStep === "start_new_card"),
      "background finalization begins only after safe-off, clean swap, and capture-lock release");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("Card 2 reaches Capture Front while Card 1 exact TIFF-to-PNG promises are deliberately held", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-card2-held-processing-"));
  const held = {};
  try {
    const { service } = configFor(outputDir);
    service.enqueueRapidFinalization = () => {};
    installSimulatedPublicCapture(service, {
      processing: (side, _manifest, packageDir) => new Promise((resolve) => {
        held[side] = async () => resolve(await processedNormalizedSide(side, packageDir));
      }),
    });
    await service.action("start-session", { captureProfile: "production_fast", reportId: "held-card-1" });
    await service.action("capture-front", bindReadyPreview(service, "front", "held-1"));
    await service.action("capture-back", bindReadyPreview(service, "back", "held-1"));
    assert.equal(service.status().currentStep, "start_new_card");
    assert.ok(service.rapidOcrEligibilityObservers.size > 0, "Card 1 normalized-pair observer remains pending");
    const card2 = await service.action("start-session", { captureProfile: "production_fast", reportId: "held-card-2" });
    assert.equal(card2.currentStep, "capture_front");
    assert.equal(card2.reportId, "held-card-2");
    await held.front();
    await held.back();
    await Promise.allSettled([...service.rapidOcrEligibilityObservers.values()]);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("Front-before-Back and immediate Back processing failures fail only the exact queued item and never block next capture", async () => {
  for (const failedSide of ["front", "back"]) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `tenkings-${failedSide}-processing-failure-`));
    try {
      const { service } = configFor(outputDir);
      service.enqueueRapidFinalization = () => {};
      installSimulatedPublicCapture(service, {
        processing: (side, _manifest, packageDir) => side === failedSide
          ? Promise.reject(new Error(`intentional ${side} TIFF-to-PNG failure`))
          : processedNormalizedSide(side, packageDir),
      });
      await service.action("start-session", { captureProfile: "production_fast", reportId: `${failedSide}-failure-card` });
      await service.action("capture-front", bindReadyPreview(service, "front", `${failedSide}-failure`));
      assert.equal(service.manifest.captureFailure, undefined, "background side processing never owns capture validity");
      await service.action("capture-back", bindReadyPreview(service, "back", `${failedSide}-failure`));
      await Promise.allSettled([...service.rapidOcrEligibilityObservers.values()]);
      const failed = service.status().rapidCaptureQueue.items[0];
      assert.equal(failed.state, "failed");
      assert.match(failed.error, new RegExp(`intentional ${failedSide}`, "i"));
      assert.equal(service.status().sessionId, undefined);
      const next = await service.action("start-session", { captureProfile: "production_fast", reportId: `${failedSide}-next-card` });
      assert.equal(next.currentStep, "capture_front");
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }
});

test("Rapid OCR eligibility reconstructs normalized PNG paths from the production side directory", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-production-normalized-path-"));
  let releaseBackProcessing;
  try {
    const { service } = configFor(outputDir);
    service.enqueueRapidFinalization = () => {};
    installSimulatedPublicCapture(service, {
      processing: (side, _manifest, packageDir) => side === "front"
        ? processedNormalizedSide(side, packageDir)
        : new Promise((resolve) => {
          releaseBackProcessing = async () => resolve(await processedNormalizedSide(side, packageDir));
        }),
    });
    await service.action("start-session", { captureProfile: "production_fast", reportId: "production-normalized-path-card" });
    await service.action("capture-front", bindReadyPreview(service, "front", "production-normalized-path"));
    await Promise.all([...service.warmProcessingJobs.values()]);
    await service.action("capture-back", bindReadyPreview(service, "back", "production-normalized-path"));

    const waiting = service.rapidQueue.items[0];
    const queuedManifest = service.queuedManifests.get(waiting.queueItemId);
    assert.equal(waiting.ocr.state, "waiting_for_normalized");
    assert.deepEqual(waiting.ocr.images.map((image) => image.localPath), [
      path.join(queuedManifest.outputs.frontPackageDir, "front", "normalized", "front-normalized-card.png"),
    ]);

    assert.equal(typeof releaseBackProcessing, "function");
    await releaseBackProcessing();
    await Promise.allSettled([...service.rapidOcrEligibilityObservers.values()]);

    const item = service.rapidQueue.items[0];
    assert.equal(item.ocr.state, "eligible");
    assert.deepEqual(
      item.ocr.images.map((image) => image.localPath),
      [
        path.join(queuedManifest.outputs.frontPackageDir, "front", "normalized", "front-normalized-card.png"),
        path.join(queuedManifest.outputs.backPackageDir, "back", "normalized", "back-normalized-card.png"),
      ],
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("front/back TIFF-to-PNG run exactly once and reload reuses durable normalized descriptors without rerun", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-processing-reload-once-"));
  const processingCalls = { front: 0, back: 0 };
  try {
    const { config, service } = configFor(outputDir);
    service.startRapidBackgroundForReleasedCard = () => {};
    installSimulatedPublicCapture(service, {
      processing: async (side, _manifest, packageDir) => {
        processingCalls[side] += 1;
        return processedNormalizedSide(side, packageDir);
      },
    });
    await service.action("start-session", { captureProfile: "production_fast", reportId: "reload-once-card" });
    await service.action("capture-front", bindReadyPreview(service, "front", "reload-once"));
    await service.action("capture-back", bindReadyPreview(service, "back", "reload-once"));
    await Promise.all([...service.warmProcessingJobs.values()]);
    const queuedManifest = [...service.queuedManifests.values()][0];
    fs.writeFileSync(queuedManifest.outputs.manifestPath, `${JSON.stringify(queuedManifest, null, 2)}\n`);
    const queueItem = service.rapidQueue.items[0];
    const persistedDescriptors = service.persistedNormalizedOcrImagesFromManifest(queuedManifest);
    queueItem.ocr = { state: "waiting_for_normalized", updatedAt: queueItem.queuedAt, attemptCount: 0, images: [persistedDescriptors[0]] };
    service.committedRapidQueue = structuredClone(service.rapidQueue);
    fs.writeFileSync(path.join(outputDir, "rapid-capture-queue.json"), `${JSON.stringify(service.rapidQueue, null, 2)}\n`);
    assert.deepEqual(processingCalls, { front: 1, back: 1 });
    const persistedBeforeReload = service.status().rapidCaptureQueue.items[0];
    assert.equal(persistedBeforeReload.ocr.state, "waiting_for_normalized");
    assert.deepEqual(persistedBeforeReload.ocr.images.map((image) => image.side), ["front"], "queue intentionally models the one-side crash window");
    assert.deepEqual(queuedManifest.rapidCapture.ocr.images.map((image) => image.fileName), ["front-normalized-card.png", "back-normalized-card.png"]);

    const reloaded = new AiGraderLocalStationBridgeService(config);
    reloaded.enqueueRapidFinalization = () => {};
    for (let index = 0; index < 100 && reloaded.status().rapidCaptureQueue.items[0]?.ocr.state !== "eligible"; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const eligible = reloaded.status().rapidCaptureQueue.items[0];
    assert.equal(eligible.ocr.state, "eligible");
    assert.deepEqual(processingCalls, { front: 1, back: 1 });
    await reloaded.recoverPersistedRapidFinalization();
    assert.deepEqual(processingCalls, { front: 1, back: 1 }, "reload recovery never invokes TIFF-to-PNG again");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("queued OCR executes once, enforces exact request/result identity, and complete freshly verifies PNG bytes", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-ocr-once-"));
  try {
    const { service, item } = await createEligibleQueuedFixture(outputDir, "once");
    const identity = { queueItemId: item.queueItemId, gradingSessionId: item.sessionId, reportId: item.reportId };
    const attempt = { ...identity, attemptOwnerId: "ocr-attempt-owner-once" };
    await assert.rejects(service.action("begin-queued-ocr", { ...attempt, reportId: "wrong-report" }), /does not match/i);
    await service.action("begin-queued-ocr", attempt);
    await assert.rejects(service.action("begin-queued-ocr", attempt), /one allowed execution/i);
    const wrongResult = safeOcrResult(item);
    wrongResult.reportId = "wrong-report";
    await assert.rejects(service.action("complete-queued-ocr", { ...attempt, result: wrongResult }), /identity/i);
    const failed = service.status().rapidCaptureQueue.items[0];
    assert.equal(failed.state, "failed");
    assert.equal(failed.ocr.state, "failed");
    assert.equal(failed.ocr.attemptCount, 1);
    await assert.rejects(service.action("complete-queued-ocr", { ...attempt, result: safeOcrResult(item) }), /cannot rerun/i);
    const next = await service.action("start-session", { captureProfile: "production_fast", reportId: "next-after-ocr-failure" });
    assert.equal(next.currentStep, "capture_front", "one item OCR failure never blocks new capture");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("only the exact durable OCR attempt owner can complete or fail its in-flight item", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-ocr-attempt-owner-"));
  try {
    const { service, item } = await createEligibleQueuedFixture(outputDir, "attempt-owner");
    const identity = { queueItemId: item.queueItemId, gradingSessionId: item.sessionId, reportId: item.reportId };
    const firstOwner = { ...identity, attemptOwnerId: "ocr-attempt-owner-first" };
    const secondOwner = { ...identity, attemptOwnerId: "ocr-attempt-owner-second" };
    await service.action("begin-queued-ocr", firstOwner);
    assert.equal(service.status().rapidCaptureQueue.items[0].ocr.attemptOwnerId, firstOwner.attemptOwnerId);
    await assert.rejects(
      service.action("complete-queued-ocr", { ...secondOwner, result: safeOcrResult(item) }),
      /attemptOwnerId does not match the exact in-flight owner/i,
    );
    await assert.rejects(
      service.action("fail-queued-ocr", {
        ...secondOwner,
        failure: { code: "AI_GRADER_OCR_INTERNAL_FAILED", message: "Second owner must not terminate this attempt." },
      }),
      /attemptOwnerId does not match the exact in-flight owner/i,
    );
    const stillOwned = service.status().rapidCaptureQueue.items[0].ocr;
    assert.equal(stillOwned.state, "in_flight");
    assert.equal(stillOwned.attemptOwnerId, firstOwner.attemptOwnerId);
    await service.action("complete-queued-ocr", { ...firstOwner, result: safeOcrResult(item) });
    const completed = service.status().rapidCaptureQueue.items[0].ocr;
    assert.equal(completed.state, "succeeded");
    assert.equal(completed.attemptOwnerId, firstOwner.attemptOwnerId);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("normalized evidence changed after begin becomes one terminal item failure", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-ocr-reverify-"));
  try {
    const { service, item, images } = await createEligibleQueuedFixture(outputDir, "reverify");
    const identity = { queueItemId: item.queueItemId, gradingSessionId: item.sessionId, reportId: item.reportId };
    const attempt = { ...identity, attemptOwnerId: "ocr-attempt-owner-reverify" };
    await service.action("begin-queued-ocr", attempt);
    await sharp({ create: { width: 1200, height: 1680, channels: 3, background: "#ffffff" } }).png().toFile(images[0].localPath);
    await assert.rejects(service.action("complete-queued-ocr", { ...attempt, result: safeOcrResult(item) }), /failed fresh hash/i);
    const failed = service.status().rapidCaptureQueue.items[0];
    assert.equal(failed.state, "failed");
    assert.equal(failed.ocr.failure.code, "AI_GRADER_OCR_NORMALIZED_EVIDENCE_INVALID");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("successful exact OCR survives reload as succeeded and cannot be claimed again", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-ocr-success-reload-"));
  try {
    const { service, item } = await createEligibleQueuedFixture(outputDir, "success-reload");
    const identity = { queueItemId: item.queueItemId, gradingSessionId: item.sessionId, reportId: item.reportId };
    const attempt = { ...identity, attemptOwnerId: "ocr-attempt-owner-reload" };
    await service.action("begin-queued-ocr", attempt);
    await service.action("complete-queued-ocr", { ...attempt, result: safeOcrResult(item) });
    assert.equal(service.status().rapidCaptureQueue.items[0].ocr.state, "succeeded");
    const reloaded = new AiGraderLocalStationBridgeService(service.config);
    assert.equal(reloaded.status().rapidCaptureQueue.items[0].ocr.state, "succeeded");
    await assert.rejects(reloaded.action("begin-queued-ocr", attempt), /one allowed execution/i);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("runtime OCR eligibility rejects any normalized artifact basename except the exact side name", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-ocr-name-"));
  try {
    const { service } = configFor(outputDir);
    assert.throws(() => service.normalizedOcrImage({
      manifest: {
        evidenceSide: "front",
        front: { normalizedCard: { normalizedArtifact: {
          mimeType: "image/png", imageWidth: 1200, imageHeight: 1680,
          sha256: "a".repeat(64), byteSize: 1,
          localOutputPath: path.join(outputDir, "wrong-name.png"),
        } } },
      },
    }, "front"), /missing or invalid/i);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("reload parser allowlists exact OCR and converts interrupted or forged-ready state to terminal failure without retry", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-ocr-reload-"));
  try {
    const { service, item, queuedManifest } = await createEligibleQueuedFixture(outputDir, "reload");
    const now = new Date().toISOString();
    const interrupted = structuredClone(item);
    interrupted.ocr = {
      ...interrupted.ocr,
      state: "in_flight",
      attemptCount: 1,
      attemptOwnerId: "ocr-attempt-owner-interrupted",
      startedAt: now,
      updatedAt: now,
    };
    fs.writeFileSync(path.join(outputDir, "rapid-capture-queue.json"), JSON.stringify({
      schemaVersion: "ten-kings-ai-grader-rapid-capture-queue-v2",
      updatedAt: now,
      rapidCaptureEnabled: true,
      items: [interrupted],
    }, null, 2));
    fs.writeFileSync(queuedManifest.outputs.manifestPath, JSON.stringify(queuedManifest, null, 2));
    const reloaded = new AiGraderLocalStationBridgeService(service.config);
    const failed = reloaded.status().rapidCaptureQueue.items[0];
    assert.equal(failed.state, "failed");
    assert.equal(failed.ocr.state, "failed");
    assert.equal(failed.ocr.failure.code, "AI_GRADER_OCR_INTERRUPTED");
    assert.equal(failed.ocr.attemptOwnerId, "ocr-attempt-owner-interrupted");
    const forged = structuredClone(item);
    forged.state = "report_ready_needs_confirm";
    forged.history = [{ state: forged.state, at: now, detail: "Forged ready fixture." }];
    forged.ocr = { state: "waiting_for_normalized", updatedAt: now, attemptCount: 0 };
    fs.writeFileSync(path.join(outputDir, "rapid-capture-queue.json"), JSON.stringify({
      schemaVersion: "ten-kings-ai-grader-rapid-capture-queue-v2",
      updatedAt: now,
      rapidCaptureEnabled: true,
      items: [forged],
    }, null, 2));
    const forgedReload = new AiGraderLocalStationBridgeService(service.config);
    assert.equal(forgedReload.status().rapidCaptureQueue.items[0].state, "failed");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("nonempty protected v1 Rapid queue stops rollout and remains byte-for-byte unchanged", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-legacy-v1-preserved-"));
  try {
    const now = "2026-07-17T12:00:00.000Z";
    const queuePath = path.join(outputDir, "rapid-capture-queue.json");
    const legacyBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: "ten-kings-ai-grader-rapid-capture-queue-v1",
      updatedAt: now,
      rapidCaptureEnabled: true,
      items: [{
        queueItemId: "legacy-session-rapid-card",
        sessionId: "legacy-session",
        reportId: "legacy-report",
        state: "report_ready_needs_confirm",
        queuedAt: now,
        updatedAt: now,
        history: [{ state: "report_ready_needs_confirm", at: now, detail: "Protected v1 item." }],
        humanConfirmationRequired: true,
        autoConfirmed: false,
        autoPublished: false,
        manifestPath: path.join(outputDir, "legacy-session", "station-session.json"),
      }],
    }, null, 3)}\r\n`, "utf8");
    fs.writeFileSync(queuePath, legacyBytes);
    const config = buildAiGraderLocalStationBridgeConfig({
      enabled: true, mode: "mock", host: "127.0.0.1", port: 47652,
      stationToken: "StationTokenStationTokenStationToken1234", outputDir,
      captureProfile: "production_fast",
    });
    assert.throws(
      () => new AiGraderLocalStationBridgeService(config),
      /rollout stopped.*legacy v1 queue contains 1 item.*no legacy item was parsed or rewritten/i,
    );
    assert.deepEqual(fs.readFileSync(queuePath), legacyBytes);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("empty protected v1 Rapid queue safely initializes the exact v2 queue", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-empty-v1-initialize-"));
  try {
    const queuePath = path.join(outputDir, "rapid-capture-queue.json");
    fs.writeFileSync(queuePath, JSON.stringify({
      schemaVersion: "ten-kings-ai-grader-rapid-capture-queue-v1",
      updatedAt: "2026-07-17T12:00:00.000Z",
      rapidCaptureEnabled: false,
      items: [],
    }));
    const config = buildAiGraderLocalStationBridgeConfig({
      enabled: true, mode: "mock", host: "127.0.0.1", port: 47652,
      stationToken: "StationTokenStationTokenStationToken1234", outputDir,
      captureProfile: "production_fast",
    });
    const service = new AiGraderLocalStationBridgeService(config);
    await service.rapidMutationChain;
    const initialized = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    assert.equal(initialized.schemaVersion, "ten-kings-ai-grader-rapid-capture-queue-v2");
    assert.equal(initialized.rapidCaptureEnabled, true);
    assert.deepEqual(initialized.items, []);
    assert.equal(service.status().currentStep, "start_new_card");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("corrupt authoritative queue refuses bridge startup instead of hiding durable items as empty", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-corrupt-queue-"));
  try {
    fs.writeFileSync(path.join(outputDir, "rapid-capture-queue.json"), "{not-json");
    const config = buildAiGraderLocalStationBridgeConfig({
      enabled: true, mode: "mock", host: "127.0.0.1", port: 47652,
      stationToken: "StationTokenStationTokenStationToken1234", outputDir,
      captureProfile: "production_fast",
    });
    assert.throws(() => new AiGraderLocalStationBridgeService(config), /refuses to hide its items/i);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("syntactically valid queue with a truncated item identity refuses startup instead of filtering the card", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-truncated-queue-item-"));
  try {
    fs.writeFileSync(path.join(outputDir, "rapid-capture-queue.json"), JSON.stringify({
      schemaVersion: "ten-kings-ai-grader-rapid-capture-queue-v2",
      updatedAt: new Date().toISOString(),
      rapidCaptureEnabled: true,
      items: [{ queueItemId: "truncated-card", state: "finalizing" }],
    }));
    const config = buildAiGraderLocalStationBridgeConfig({
      enabled: true, mode: "mock", host: "127.0.0.1", port: 47652,
      stationToken: "StationTokenStationTokenStationToken1234", outputDir,
      captureProfile: "production_fast",
    });
    assert.throws(() => new AiGraderLocalStationBridgeService(config), /cannot retain an exact|refuses to hide/i);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("restart refuses an orphaned queued claim or unqueued Back failure but ignores unrelated legacy noise", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-orphan-session-"));
  try {
    const { config, service } = configFor(outputDir);
    await service.action("start-session", { captureProfile: "production_fast", reportId: "orphan-report" });
    const manifest = prepareExactCapturedCard(service, "orphan");
    fs.writeFileSync(manifest.outputs.manifestPath, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(outputDir, "rapid-capture-queue.json"), JSON.stringify({
      schemaVersion: "ten-kings-ai-grader-rapid-capture-queue-v2", updatedAt: new Date().toISOString(), rapidCaptureEnabled: true, items: [],
    }));
    assert.throws(() => new AiGraderLocalStationBridgeService(config), /Back evidence without a complete durable Rapid queue claim|quarantine/i);
    manifest.captureFailure = { side: "back", stage: "queue_commit", message: "queue write failed", at: new Date().toISOString() };
    fs.writeFileSync(manifest.outputs.manifestPath, JSON.stringify(manifest, null, 2));
    assert.throws(() => new AiGraderLocalStationBridgeService(config), /terminal queue_commit failure|quarantine/i);

    fs.rmSync(manifest.outputs.sessionDir, { recursive: true, force: true });
    const legacyDir = path.join(outputDir, "legacy-v09-noise");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "station-session.json"), '{"schemaVersion":"ai-grader-local-station-bridge-v0.9","queueItemId":');
    assert.equal(new AiGraderLocalStationBridgeService(config).status().currentStep, "start_new_card");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("queue TIFF hashes and side-processing jobs must match the exact session manifest", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-queue-linkage-"));
  try {
    const { service, item } = await createEligibleQueuedFixture(outputDir, "linkage");
    const originalHash = item.rawEvidence.sides[0].roles[0].sha256;
    item.rawEvidence.sides[0].roles[0].sha256 = "f".repeat(64);
    await assert.rejects(service.exactQueuedManifest(item), /do not match the exact session manifest/i);
    item.rawEvidence.sides[0].roles[0].sha256 = originalHash;
    const originalRequestId = item.sideProcessingJobs.back.requestId;
    item.sideProcessingJobs.back.requestId = "tampered-back-request";
    await assert.rejects(service.exactQueuedManifest(item), /do not match the exact session manifest/i);
    item.sideProcessingJobs.back.requestId = originalRequestId;
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("Approve & Publish accepts the exact configured sibling report-bundle root and rejects an adjacent path", async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-sibling-report-root-"));
  const outputDir = path.join(fixtureRoot, "ai-grader-station");
  const reportBundleOutputDir = path.join(fixtureRoot, "ai-grader-report-bundles");
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    const { service, item, queuedManifest } = await createEligibleQueuedFixture(
      outputDir,
      "sibling-root",
      { reportBundleOutputDir },
    );
    const identity = { queueItemId: item.queueItemId, gradingSessionId: item.sessionId, reportId: item.reportId };
    const attempt = { ...identity, attemptOwnerId: "ocr-attempt-owner-publish" };
    await service.action("begin-queued-ocr", attempt);
    await service.action("complete-queued-ocr", { ...attempt, result: safeOcrResult(item) });
    const mutableItem = service.exactMutableQueuedItem(identity);
    const now = new Date().toISOString();
    mutableItem.state = "report_ready_needs_confirm";
    mutableItem.updatedAt = now;
    mutableItem.history = [...mutableItem.history, { state: mutableItem.state, at: now, detail: "Sibling report-root fixture ready." }];
    queuedManifest.rapidCapture.workflowState = mutableItem.state;
    queuedManifest.rapidCapture.workflowHistory = [...mutableItem.history];
    queuedManifest.currentStep = "label_data_ready";
    queuedManifest.reportBundle = {
      schemaVersion: "ai-grader-report-bundle-v0.1",
      reportId: item.reportId,
      gradingSessionId: item.sessionId,
    };
    queuedManifest.productionRelease = {
      schemaVersion: "ai-grader-production-release-v0.1",
      reportId: item.reportId,
      gradingSessionId: item.sessionId,
      finalGradeComputed: true,
      labelDataGenerated: true,
      qrPayloadGenerated: true,
      label: { status: "label_data_ready" },
    };
    const packageDir = path.join(reportBundleOutputDir, item.reportId);
    fs.mkdirSync(packageDir, { recursive: true });
    const bundlePath = path.join(packageDir, "report-bundle.json");
    const releasePath = path.join(packageDir, "production-release.json");
    const labelPath = path.join(packageDir, "label-data.json");
    fs.writeFileSync(bundlePath, JSON.stringify(queuedManifest.reportBundle));
    fs.writeFileSync(releasePath, JSON.stringify(queuedManifest.productionRelease));
    fs.writeFileSync(labelPath, JSON.stringify(queuedManifest.productionRelease.label));
    queuedManifest.outputs.productionReleasePath = releasePath;
    queuedManifest.outputs.labelDataPath = labelPath;
    queuedManifest.outputs.reportBundlePath = path.join(outputDir, "adjacent", "report-bundle.json");
    service.committedRapidQueue = structuredClone(service.rapidQueue);
    service.activeQueueItemId = item.queueItemId;
    const publication = { ...identity, publicationStatus: "published", publishedAt: now };
    assert.equal(service.exactQueuedItem(identity).state, "report_ready_needs_confirm");
    assert.equal(service.exactQueuedItem(identity).ocr.state, "succeeded");
    await assert.rejects(
      service.action("publish-report", { ...identity, publication }),
      /outside the exact allowlisted report package/i,
    );
    queuedManifest.outputs.reportBundlePath = bundlePath;
    await service.action("publish-report", { ...identity, publication });
    assert.equal(service.status().rapidCaptureQueue.items[0].state, "published");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Atomic Back rejects malformed private assertion identities before capture consumption", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-back-request-validation-"));
  try {
    const { service } = configFor(outputDir);
    await service.action("start-session", { captureProfile: "production_fast", reportId: "back-validation-report" });
    await service.action("capture-front", bindReadyPreview(service, "front", "validation"));
    const request = bindReadyPreview(service, "back", "validation");
    request.idempotencyKey = "../private-assertion";
    await assert.rejects(service.action("capture-back", request), /idempotency|bounded|private/i);
    assert.equal(service.manifest.outputs.backPackageDir, undefined);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("active review projection strips every local Path/Dir/Folder and filesystem-shaped string", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-review-redaction-"));
  try {
    const { service } = configFor(outputDir);
    await service.action("start-session", { captureProfile: "production_fast", reportId: "review-report" });
    const manifest = service.manifest;
    const now = new Date().toISOString();
    const succeededOcr = {
      state: "succeeded", updatedAt: now, attemptCount: 1, eligibleAt: now, startedAt: now, completedAt: now,
      images: [], result: {},
    };
    const item = queueItemFor(manifest, { state: "report_ready_needs_confirm", ocr: succeededOcr });
    manifest.rapidCapture.queueItemId = item.queueItemId;
    manifest.outputs.unifiedReportPath = path.join(outputDir, "private-report.html");
    manifest.reportBundle = {
      reportId: item.reportId,
      gradingSessionId: item.sessionId,
      evidenceReferences: { frontPackageDir: path.join(outputDir, "front-secret"), publicViewerRoute: "/ai-grader/reports/review-report" },
      localReportFolder: path.join(outputDir, "report-secret"),
      nested: {
        localPath: "C:\\secret\\card.tiff",
        innocentValue: path.join(outputDir, "leak"),
        stationToken: "hidden-token",
        opaque: "https://127.0.0.1:47652/private?X-Amz-Signature=secret",
        encoded: "data:image/png;base64,hidden",
      },
    };
    manifest.productionRelease = {
      reportId: item.reportId,
      gradingSessionId: item.sessionId,
      publicReportUrl: "/ai-grader/reports/review-report",
      label: { frontPackageDir: "\\\\Dell\\private\\front" },
    };
    service.rapidQueue.items = [item];
    service.committedRapidQueue = structuredClone(service.rapidQueue);
    service.queuedManifests.set(item.queueItemId, manifest);
    service.activeQueueItemId = item.queueItemId;
    const active = service.status().rapidCaptureQueue.activeReview;
    const serialized = JSON.stringify(active);
    assert.ok(active);
    assert.deepEqual(
      active.manifest.reportBundle.productionRelease,
      active.manifest.productionRelease,
      'the browser review bundle must embed the exact same release required by hosted Confirm/Publish',
    );
    assert.equal(serialized.includes(outputDir), false);
    assert.equal(serialized.includes("C:\\\\secret"), false);
    assert.equal(serialized.includes("Dell\\\\private"), false);
    assert.equal(serialized.includes("hidden-token"), false);
    assert.equal(serialized.includes("X-Amz"), false);
    assert.equal(serialized.includes("data:image"), false);
    assert.equal("frontPackageDir" in active.manifest.reportBundle.evidenceReferences, false);
    assert.equal(active.manifest.reportBundle.evidenceReferences.publicViewerRoute, "/ai-grader/reports/review-report");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("Rapid queue retention preserves all unfinished items and only trims terminal history", () => {
  const pending = Array.from({ length: 26 }, (_, index) => ({ queueItemId: `pending-${index}`, state: "finalizing" }));
  const terminal = Array.from({ length: 8 }, (_, index) => ({ queueItemId: `published-${index}`, state: "published" }));
  assert.deepEqual(retainAiGraderRapidCaptureQueueItems([...pending, ...terminal]).map((item) => item.queueItemId), pending.map((item) => item.queueItemId));
});

test("preview-to-capture handoff waits through the Basler GigE lease after forced preview exit", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-preview-camera-release-"));
  let leaseTimer;
  try {
    const events = [];
    let cameraLeaseHeld = true;
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.pid = 4242;
    child.stdin = { end() {} };
    child.stdout = {};
    child.stderr = {};
    child.kill = () => {
      child.exitCode = 1;
      return true;
    };

    const { service } = configFor(outputDir, {
      stopPreviewProcessTree(stoppedChild) {
        events.push("forced-process-stop");
        stoppedChild.exitCode = 1;
        leaseTimer = setTimeout(() => {
          cameraLeaseHeld = false;
          events.push("gigE-lease-released");
        }, 3_100);
        queueMicrotask(() => {
          stoppedChild.emit("exit", 1, null);
          stoppedChild.emit("close", 1, null);
        });
      },
      stopOrphanedPreviewStreamsUntilReleased: async () => 0,
    });
    service.previewProcess = child;
    service.previewStop = () => {};

    await service.stopPreviewStream("atomic Front capture handoff", {
      waitForRelease: true,
      requireRelease: true,
      captureOwner: true,
    });
    assert.equal(cameraLeaseHeld, false, "capture must not open while the killed preview still owns the GigE lease");
    events.push("capture-camera-open-eligible");

    assert.deepEqual(events, ["forced-process-stop", "gigE-lease-released", "capture-camera-open-eligible"]);
    assert.equal(service.manifest.previewStatus.cameraOwnership, "capture_action");
  } finally {
    clearTimeout(leaseTimer);
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("retained bridge invariants and bounded Leimac conversion remain explicit", () => {
  for (const retained of [
    "captureLock", "serialized lifecycle", "watchdog", "safeOffLiveLighting",
    "expectedSessionId", "expectedReportId", "expectedSideEpoch", "expectedFrameId",
    "stopOrphanedPreviewStreamsUntilReleased", "allowedOrigins", "persistedReportPackagePath",
  ]) assert.equal(bridgeSource.includes(retained), true, `missing retained invariant ${retained}`);
  assert.equal(bridgeSource.includes("maxDutyPercent: 5"), false);
  assert.equal(bridgeSource.includes("LEIMAC_IDMU_MAX_DUTY_PERCENT"), true);
  assert.equal(bridgeSource.includes("Start Grading"), false);
});

test("preview multipart assembler remains bounded", () => {
  const assembler = new AiGraderPreviewJpegFrameAssembler();
  const frame = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const frames = assembler.push(Buffer.concat([Buffer.from("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 7\r\n\r\n"), frame, Buffer.from("\r\n")]));
  assert.deepEqual(frames, [frame]);
  assembler.push(Buffer.alloc(2_000_000));
  assert.ok(assembler.bufferedByteLength < 2_000_000);
});

test('Start New Card rejects an active caller-supplied report identity before changing the exact active session', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenkings-active-duplicate-report-'));
  try {
    const { service } = configFor(outputDir);
    await service.action('start-session', { captureProfile: 'production_fast', reportId: 'active-live-report' });
    const activeManifest = service.manifest;
    const activeSnapshot = structuredClone(activeManifest);
    const persistedManifestBytes = fs.readFileSync(activeManifest.outputs.manifestPath);
    const outputEntries = fs.readdirSync(outputDir).sort();

    await assert.rejects(
      service.action('start-session', { captureProfile: 'production_fast', reportId: 'ACTIVE-LIVE-REPORT' }),
      /rejects caller-supplied report ID.*active station session.*already owns it/i,
    );

    assert.equal(service.manifest, activeManifest);
    assert.deepEqual(service.manifest, activeSnapshot);
    assert.equal(service.manifest.sessionId, activeSnapshot.sessionId);
    assert.equal(service.manifest.reportId, activeSnapshot.reportId);
    assert.deepEqual(fs.readFileSync(activeManifest.outputs.manifestPath), persistedManifestBytes);
    assert.deepEqual(fs.readdirSync(outputDir).sort(), outputEntries);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('Start New Card rejects a duplicate caller-supplied report identity before creating another session', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenkings-duplicate-report-'));
  try {
    const { service } = configFor(outputDir);
    await service.action('start-session', { captureProfile: 'production_fast', reportId: 'duplicate-live-report' });
    const firstManifest = service.manifest;
    const firstItem = queueItemFor(firstManifest);
    service.rapidQueue.items = [firstItem];
    service.committedRapidQueue = structuredClone(service.rapidQueue);
    service.manifest = service.cleanStartNewCardManifest(firstManifest);
    await assert.rejects(
      service.action('start-session', { captureProfile: 'production_fast', reportId: 'DUPLICATE-LIVE-REPORT' }),
      /rejects caller-supplied report ID.*already belongs to exact queue item/i,
    );
    assert.equal(service.status().currentStep, 'start_new_card');
    assert.equal(service.status().sessionId, undefined);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
