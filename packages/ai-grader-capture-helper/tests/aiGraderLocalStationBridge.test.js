const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { Worker } = require("node:worker_threads");
const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  AiGraderLocalStationBridgeService: RealAiGraderLocalStationBridgeService,
  AiGraderPreviewJpegFrameAssembler,
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
  buildAiGraderLocalStationBridgeConfig,
  retainAiGraderRapidCaptureQueueItems,
  startAiGraderLocalStationBridgeHttpServer: realStartAiGraderLocalStationBridgeHttpServer,
} = require("../dist/drivers/aiGraderLocalStationBridge");
const { buildAiGraderStationRealCommandPlan } = require("../dist/drivers/aiGraderStationWorkflow");
const { buildAiGraderReportBundle } = require("../dist/drivers/aiGraderReportBundle");
const { buildAiGraderProductionRelease } = require("../dist/drivers/aiGraderProductionRelease");
const { createStableAiGraderDefectFindingId } = require("../dist/drivers/aiGraderDefectFindings");
const {
  AI_GRADER_REPORT_RECOVERY_GUIDANCE,
  readAiGraderReportPackageReleaseEvidence,
} = require("../dist/drivers/aiGraderReportPackageRecovery");
const { runCaptureHelperCli } = require("../dist/cli");

const hardwareIsolation = {
  fakeLightingWrites: 0,
  fakeOrphanScans: 0,
  fakePreviewStarts: 0,
  fakePreviewStops: 0,
  realBoundaryCalls: 0,
  unexpectedCommandRunnerCalls: 0,
  unexpectedWarmRunnerCalls: 0,
};

const inertCommandRunner = {
  async run(step) {
    hardwareIsolation.unexpectedCommandRunnerCalls += 1;
    throw new Error(`Inert command-runner fake: test did not inject behavior for ${step?.id ?? "unknown"}.`);
  },
};

const inertWarmRunner = {
  async captureSide(input) {
    hardwareIsolation.unexpectedWarmRunnerCalls += 1;
    throw new Error(`Inert warm-runner fake: test did not inject capture behavior for ${input?.side ?? "unknown"}.`);
  },
  async processSide(batch) {
    hardwareIsolation.unexpectedWarmRunnerCalls += 1;
    throw new Error(`Inert warm-runner fake: test did not inject processing behavior for ${batch?.side ?? "unknown"}.`);
  },
};

function inertBridgeDependencies(overrides = {}) {
  return {
    async writeLightingFrames(frames) {
      hardwareIsolation.fakeLightingWrites += 1;
      return frames.map(() => ({ responseKind: "ack", ok: true }));
    },
    async stopOrphanedPreviewStreamsUntilReleased() {
      hardwareIsolation.fakeOrphanScans += 1;
      return 0;
    },
    stopPreviewProcessTree() {
      hardwareIsolation.fakePreviewStops += 1;
    },
    startPreviewProcess() {
      hardwareIsolation.fakePreviewStarts += 1;
      throw new Error("Inert preview process fake: tests cannot start a real camera process.");
    },
    onRealHardwareBoundary(boundary) {
      hardwareIsolation.realBoundaryCalls += 1;
      throw new Error(`Test crossed forbidden real hardware boundary: ${boundary}`);
    },
    ...overrides,
  };
}

function AiGraderLocalStationBridgeService(config, runner, warmRunner, dependencies = {}) {
  return new RealAiGraderLocalStationBridgeService(
    config,
    runner ?? inertCommandRunner,
    warmRunner ?? inertWarmRunner,
    inertBridgeDependencies(dependencies),
  );
}

function startAiGraderLocalStationBridgeHttpServer(input, env, runner, warmRunner, dependencies = {}) {
  return realStartAiGraderLocalStationBridgeHttpServer(
    input,
    env,
    runner ?? inertCommandRunner,
    warmRunner ?? inertWarmRunner,
    inertBridgeDependencies(dependencies),
  );
}

test.after(() => {
  assert.equal(hardwareIsolation.realBoundaryCalls, 0, "bridge tests must cross zero real hardware/network/process boundaries");
  assert.equal(hardwareIsolation.unexpectedCommandRunnerCalls, 0, "bridge tests must inject every command-runner behavior before construction");
  assert.equal(hardwareIsolation.unexpectedWarmRunnerCalls, 0, "bridge tests must inject every warm-runner behavior before construction");
});

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const PNG_SHA256 = require("node:crypto").createHash("sha256").update(PNG_BYTES).digest("hex");

function outputDir(label) {
  return path.join(os.tmpdir(), `tenkings-ai-grader-station-bridge-${label}`);
}

function mockConfig(overrides = {}) {
  return buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    stationToken: "local-dev-token",
    outputDir: outputDir("mock"),
    ...overrides,
  });
}

function realConfig(overrides = {}) {
  return buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "real",
    stationToken: "1234567890abcdef",
    outputDir: outputDir("real"),
    apply: true,
    markPresent: true,
    wiringConfirmed: true,
    leimacStatusGreen: true,
    leimacHost: "169.254.191.156",
    leimacPort: 1000,
    ...overrides,
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function fullEvidenceRoleIds() {
  return [
    "dark_control",
    "all_on",
    "accepted_profile",
    "channel_1",
    "channel_2",
    "channel_3",
    "channel_4",
    "channel_5",
    "channel_6",
    "channel_7",
    "channel_8",
  ];
}

function createCandidateRecoveryReport(rootDir, reportId, gradingSessionId) {
  const reportDir = path.join(rootDir, reportId + "-unified-report");
  const frontDir = path.join(reportDir, "front");
  const backDir = path.join(reportDir, "back");
  fs.mkdirSync(frontDir, { recursive: true });
  fs.mkdirSync(backDir, { recursive: true });
  const normalized = {
    front: path.join(frontDir, "front-normalized-card.png"),
    back: path.join(backDir, "back-normalized-card.png"),
  };
  fs.writeFileSync(normalized.front, PNG_BYTES);
  fs.writeFileSync(normalized.back, PNG_BYTES);
  const heatmapPath = path.join(backDir, "back-surface-heatmap.png");
  fs.writeFileSync(heatmapPath, PNG_BYTES);
  for (const side of ["front", "back"]) {
    fs.writeFileSync(path.join(reportDir, side, "manifest.json"), JSON.stringify({
      captureProfile: "production_fast",
      [side]: {
        normalizedCard: {
          geometry: { placementState: "ready", normalizedWidth: 1200, normalizedHeight: 1680 },
          normalizedArtifact: { localOutputPath: normalized[side], sourceSha256: PNG_SHA256 },
        },
      },
    }, null, 2));
  }
  fs.writeFileSync(path.join(reportDir, "manifest.json"), JSON.stringify({
    reportId,
    gradingSessionId,
    frontPackageDir: frontDir,
    backPackageDir: backDir,
  }, null, 2));

  fs.writeFileSync(path.join(reportDir, "analysis.json"), JSON.stringify({
    reportId,
    gradingSessionId,
    provisionalGradeStory: {
      status: "provisional_diagnostic_grade",
      provisionalOverallGrade: 8.4,
      confidence: { score: 0.8, band: "high", warnings: [] },
      gradeImpactCandidates: [{
        id: "back-candidate-001",
        side: "back",
        category: "surface",
        severity: "medium",
        confidence: 0.8,
        confidenceBand: "high",
        evidenceRefs: ["back-surface-heatmap.png"],
        explanation: "Evidence-linked candidate.",
      }],
      whyNot10: [],
      elementScores: {},
    },
    surfaceIntelligence: {
      detectorId: "preliminary_surface_intelligence_v0",
      front: {
        version: "preliminary_surface_intelligence_v0",
        candidates: [],
      },
      back: {
        version: "preliminary_surface_intelligence_v0",
        confidence: { score: 0.8 },
        heatmap: { outputFilePath: heatmapPath },
        candidates: [{
          candidateId: "back-candidate-001",
          side: "back",
          category: "surface",
          severityBand: "medium",
          confidence: 0.8,
          analysisGeometry: {
            coordinateFrame: "normalized_card",
            units: "fraction",
            sourceSha256: PNG_SHA256,
            normalizedArtifactSha256: PNG_SHA256,
            shape: { type: "box", x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
          },
        }],
      },
    },
    visionLab: {},
  }, null, 2));
  const reportHtmlPath = path.join(reportDir, "provisional-diagnostic-report.html");
  fs.writeFileSync(reportHtmlPath, '<html><body><img src="' + normalized.front + '"><img src="' + normalized.back + '"></body></html>');
  return { reportDir, reportHtmlPath };
}

async function installStaleCandidatePackage(service, config, reportId, options = {}) {
  await service.action("start-session", { reportId, captureProfile: "production_fast" });
  const manifest = service.manifest;
  const gradingSessionId = manifest.sessionId;
  const source = createCandidateRecoveryReport(config.outputDir, reportId, gradingSessionId);
  const current = await buildAiGraderReportBundle({
    reportDir: source.reportDir,
    reportId,
    gradingSessionId,
    captureTiming: manifest.captureTiming,
  });
  assert.equal(current.visionLab.findingValidation.status, "valid");
  const stale = structuredClone(current);
  delete stale.reportProducer;
  delete stale.visionLab.findingValidation;
  const finding = stale.visionLab.defectFindings[0];
  const legacyDetector = { id: finding.detector.id, version: finding.detector.version };
  const legacyFindingId = createStableAiGraderDefectFindingId({
    side: finding.side,
    category: finding.category,
    detector: legacyDetector,
    geometry: finding.geometry,
  });
  finding.findingId = legacyFindingId;
  finding.detector = legacyDetector;
  stale.provisionalGrade.gradeImpactCandidates[0].findingIds = [legacyFindingId];
  for (const asset of stale.assets) {
    if (asset.kind === "image") {
      delete asset.widthPx;
      delete asset.heightPx;
    }
  }
  const previousRelease = buildAiGraderProductionRelease({
    bundle: stale,
    generatedAt: "2026-07-11T12:00:00.000Z",
    operatorId: "mark",
    warningsAccepted: true,
    overrideReason: "Confirmed report recovery test",
  });
  assert.equal(previousRelease.finalGradeComputed, true);
  const canonicalDir = path.join(config.reportBundleOutputDir, reportId);
  fs.mkdirSync(canonicalDir, { recursive: true });
  fs.writeFileSync(path.join(canonicalDir, "report-bundle.json"), JSON.stringify(stale, null, 2));
  const includeRelease = options.includeRelease !== false;
  if (includeRelease) {
    fs.writeFileSync(path.join(canonicalDir, "production-release.json"), JSON.stringify(previousRelease, null, 2));
  }
  Object.assign(manifest.outputs, {
    unifiedReportDir: source.reportDir,
    unifiedReportPath: source.reportHtmlPath,
    publishPackageDir: canonicalDir,
    reportBundlePath: path.join(canonicalDir, "report-bundle.json"),
    productionReleasePath: path.join(canonicalDir, "production-release.json"),
  });
  manifest.reportBundle = stale;
  manifest.productionRelease = includeRelease || options.embedRelease ? previousRelease : undefined;
  manifest.rapidCapture.workflowState = includeRelease ? "confirmed_needs_publish" : "report_ready_needs_confirm";
  manifest.rapidCapture.workflowHistory = [{
    state: includeRelease ? "confirmed_needs_publish" : "report_ready_needs_confirm",
    at: "2026-07-11T12:00:00.000Z",
    detail: includeRelease
      ? "Human confirmation completed; publish remains required."
      : "Report is ready; explicit operator finalization remains required.",
  }];
  fs.writeFileSync(manifest.outputs.manifestPath, JSON.stringify(manifest, null, 2));
  return { canonicalDir, gradingSessionId, legacyFindingId, manifest, previousRelease, source, stale };
}

function assertEmbeddedImageBodiesMatchCanonical(bundle, canonicalBundle) {
  const canonicalImages = canonicalBundle.assets.filter((asset) => asset.kind === "image");
  assert.ok(canonicalImages.length > 0);
  for (const canonicalAsset of canonicalImages) {
    const returnedAsset = bundle.assets.find((asset) => asset.id === canonicalAsset.id);
    assert.ok(returnedAsset, canonicalAsset.id);
    assert.equal(returnedAsset.sha256, canonicalAsset.sha256, canonicalAsset.id);
    assert.equal(returnedAsset.byteSize, canonicalAsset.byteSize, canonicalAsset.id);
    assert.equal(returnedAsset.contentType, canonicalAsset.contentType, canonicalAsset.id);
    assert.equal(returnedAsset.bodyEncoding, "base64", canonicalAsset.id);
    assert.equal(typeof returnedAsset.bodyBase64, "string", canonicalAsset.id);
    const body = Buffer.from(returnedAsset.bodyBase64, "base64");
    assert.equal(body.byteLength, canonicalAsset.byteSize, canonicalAsset.id);
    assert.equal(
      require("node:crypto").createHash("sha256").update(body).digest("hex"),
      canonicalAsset.sha256,
      canonicalAsset.id,
    );
  }
}

async function assertFinalizedBodyBundleMatchesCanonical(resolved, canonicalDir) {
  const canonicalBundlePath = path.join(canonicalDir, "report-bundle.json");
  const canonicalBundleBytes = fs.readFileSync(canonicalBundlePath, "utf8");
  const canonicalBundle = JSON.parse(canonicalBundleBytes);
  const canonicalRelease = JSON.parse(fs.readFileSync(path.join(canonicalDir, "production-release.json"), "utf8"));
  const verifiedRelease = await readAiGraderReportPackageReleaseEvidence({
    packageDir: canonicalDir,
    bundle: canonicalBundle,
  });

  assert.deepEqual(verifiedRelease, canonicalRelease);
  assert.deepEqual(JSON.parse(JSON.stringify(resolved.bundle.productionRelease)), canonicalRelease);
  assert.deepEqual(JSON.parse(JSON.stringify(resolved.bundle.visionLab)), canonicalBundle.visionLab);
  assert.equal(resolved.bundle.finalGradeComputed, true);
  assert.equal(resolved.bundle.finalStatus, canonicalRelease.finalStatus);
  assert.equal(canonicalRelease.reportStatus, "final_ai_grader_report_v0");
  assert.equal(canonicalRelease.finalStatus, "final_grade_computed");
  assert.equal(canonicalRelease.finalGradeComputed, true);
  assert.equal(canonicalRelease.finalGrade.finalGradeComputed, true);
  assert.equal(typeof canonicalRelease.finalGrade.overall, "number");
  assert.ok(canonicalRelease.gates.length > 0);
  assert.ok(canonicalRelease.label.certId);
  assert.ok(canonicalRelease.label.qrPayloadUrl);
  assertEmbeddedImageBodiesMatchCanonical(resolved.bundle, canonicalBundle);
  assert.equal(canonicalBundleBytes.includes("bodyBase64"), false);
}

function makeFakeWarmRunner(options = {}) {
  const calls = [];
  const lifecycleCalls = [];
  const lifecycle = {
    active: 0,
    pending: 0,
    maxPending: 0,
    maxConcurrency: 1,
    closed: false,
  };
  const runner = {
      async captureSide(input) {
        calls.push({ type: "capture", side: input.side, input });
        if (options.onCaptureStarted) options.onCaptureStarted(input);
        if (options.captureDelay) await options.captureDelay(input);
        if (options.captureError) throw options.captureError;
        return {
          executionPath: "warm_full_forensic_runner",
          fallbackUsed: false,
          packageId: `${input.side}-package`,
          packageDir: `${input.side}-package`,
          sideDir: `${input.side}-package/${input.side}`,
          side: input.side,
          hardwareMeasurement: options.hardwareMeasurement === true,
          activeLightingProfile: input.activeLightingProfile,
          batch: {
            executionPath: "warm_full_forensic_runner",
            fallbackUsed: false,
            side: input.side,
            outputDir: `${input.side}-package/${input.side}`,
            cameraIndex: input.cameraIndex ?? 0,
            persistentBaslerSession: true,
            persistentLeimacSession: true,
            selectedChannels: input.activeLightingProfile.selectedChannels,
            dutyTenthsPercent: Math.round(input.activeLightingProfile.selectedDutyPercent * 10),
            captures: {},
          },
          exposureUs: input.exposureUs,
          gain: input.gain,
          manualGeometryOverride: input.manualGeometryOverride,
        };
      },
      async processSide(batch, context) {
        calls.push({ type: "process", side: batch.side, batch, context });
        lifecycle.active += 1;
        try {
          if (options.processDelay) await options.processDelay(batch, context);
          if (options.processError && (!options.processErrorSide || options.processErrorSide === batch.side)) throw options.processError;
          const defaultIdentity = {
            protocolVersion: "fixed-rig-geometry-processing-worker-v1",
            requestId: context.requestId,
            sessionId: context.sessionId,
            packageId: batch.packageId,
            side: batch.side,
            mode: batch.manualGeometryOverride ? "explicit_manual_capture" : "captured_evidence_worker",
            ...(batch.manualGeometryOverride ? {} : { sourceSetSha256: "a".repeat(64) }),
          };
          const processingWorker = options.processingWorkerIdentity
            ? options.processingWorkerIdentity(defaultIdentity, batch, context)
            : defaultIdentity;
          return {
            executionPath: "warm_full_forensic_runner",
            fallbackUsed: false,
            packageId: options.processedPackageId ?? batch.packageId,
            packageDir: options.processedPackageDir ?? batch.packageDir,
            manifestPath: path.join(batch.packageDir, "manifest.json"),
            analysisPath: path.join(batch.packageDir, "analysis.json"),
            previewReportPath: path.join(batch.packageDir, "preview-report.html"),
            processingWorker,
            manifest: {
              executionPath: "warm_full_forensic_runner",
              fallbackUsed: false,
              evidenceSide: options.processedSide ?? batch.side,
              geometryPolicy: {
                mode: batch.manualGeometryOverride ? "manual_capture" : "automatic_detection",
                manualOverride: batch.manualGeometryOverride,
              },
              captureTiming: {
                hardwareMeasurement: options.processedHardwareMeasurement === true || options.hardwareMeasurement === true,
                lightingProfileChanges: { write: { durationMs: 11 } },
                frameCaptureMs: 120,
                fileWritesMs: 230,
                fileHashMs: 18,
                gradingForensicRunnerMs: 430,
              },
              processingTiming: {
                totalDurationMs: 75,
                phases: { cropDeskew: { durationMs: 15 } },
              },
            },
          };
        } finally {
          lifecycle.active -= 1;
        }
      },
      async cancelSession(sessionId, reason) {
        lifecycleCalls.push({ type: "cancel-session", sessionId, reason });
        if (options.cancelSession) await options.cancelSession(sessionId, reason);
      },
      async shutdownProcessingWorker(reason) {
        lifecycleCalls.push({ type: "shutdown", reason });
        lifecycle.closed = true;
        if (options.shutdownProcessingWorker) await options.shutdownProcessingWorker(reason);
      },
      processingWorkerStatus() {
        return { ...lifecycle };
      },
    };
  return {
    calls,
    lifecycleCalls,
    lifecycle,
    runner,
  };
}

const MANUAL_GEOMETRY_RECT = {
  x: 100,
  y: 100,
  width: 1000,
  height: 1400,
  imageWidth: 1200,
  imageHeight: 1680,
  coordinateFrame: "portrait_preview_pixels",
};

function detectedPreviewGeometry(input, placementState = "ready") {
  const detected = placementState !== "not_detected";
  const corners = detected ? {
    topLeft: { x: 100, y: 100 },
    topRight: { x: 1100, y: 100 },
    bottomRight: { x: 1100, y: 1500 },
    bottomLeft: { x: 100, y: 1500 },
  } : null;
  return {
    version: "ten-kings-card-geometry-v1",
    detectionPolicy: input.detectionPolicy,
    side: input.side,
    placementState,
    adjustmentReason: placementState === "ready" ? null : "not_detected",
    geometrySource: detected ? "detected" : "none",
    captureMode: detected ? "automatic_detection" : "none",
    confidenceBasis: detected ? "automatic_detection" : "none",
    detectionUsed: detected,
    manualOverrideUsed: false,
    corners,
    detectedCorners: corners,
    boundingBox: detected ? { x: 100, y: 100, width: 1000, height: 1400 } : null,
    rotationDegrees: detected ? 0 : null,
    skewDegrees: detected ? 0 : null,
    confidence: detected ? 0.95 : 0,
    sourceImageId: input.sourceImageId,
    sourceFrameId: input.sourceFrameId,
    timestamp: input.timestamp,
    image: { width: 1200, height: 1680, coordinateFrame: "source_image_pixels" },
    semanticOrientation: {
      canonicalOrientation: "portrait",
      basis: "operator_top_toward_preview_top",
      contentUprightVerified: false,
    },
    placement: {
      centerOffsetPixels: detected ? { x: 0, y: 0, distance: 0, maxAxis: 0 } : undefined,
      centerOffsetInches: detected ? { x: 0, y: 0, distance: 0, maxAxis: 0 } : undefined,
      estimatedPixelsPerInch: detected ? 200 : undefined,
      maxCenterOffsetInches: 0.5,
      maxSkewDegrees: 10,
      maxNormalizationSkewDegrees: 35,
      minReadyConfidence: 0.72,
      withinCenterTolerance: detected,
      withinSkewTolerance: detected,
      withinNormalizationSkewTolerance: detected,
      withinFrame: detected,
      ready: placementState === "ready",
    },
  };
}

function manualCaptureRequest(overrides = {}) {
  return {
    captureTriggerMode: "operator",
    geometryCaptureMode: "manual_capture",
    manualGeometryRect: MANUAL_GEOMETRY_RECT,
    ...overrides,
  };
}

function markReadyGeometry(service, side) {
  const status = service.status();
  const geometry = {
    side,
    sessionId: status.sessionId,
    sideEpoch: status.previewStatus.sideEpoch,
    placementState: "ready",
    geometrySource: "detected",
    detectionUsed: true,
    manualOverrideUsed: false,
    corners: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 1100, y: 100 },
      bottomRight: { x: 1100, y: 1500 },
      bottomLeft: { x: 100, y: 1500 },
    },
    detectedCorners: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 1100, y: 100 },
      bottomRight: { x: 1100, y: 1500 },
      bottomLeft: { x: 100, y: 1500 },
    },
    boundingBox: { x: 100, y: 100, width: 1000, height: 1400 },
    image: { width: 1200, height: 1680 },
    sourceFrameId: side === "back" && status.previewStatus.latestFrameId
      ? status.previewStatus.latestFrameId
      : `test-${side}-ready`,
    timestamp: new Date().toISOString(),
  };
  service.manifest.previewStatus.cardGeometry[side] = geometry;
  if (side === "back" && status.previewStatus.latestFrameId) {
    assert.equal(service.retainPreviewGeometryObservation(geometry), true);
  }
  return geometry;
}

function noteFreshBackPreviewFrame(service, frameIndex = 1) {
  const status = service.status();
  assert.equal(status.previewStatus.activeSide, "back");
  assert.ok(status.sessionId);
  const frameId = `test-back-frame-${frameIndex}`;
  const accepted = service.notePreviewFrame(frameIndex, {
    sessionId: status.sessionId,
    side: "back",
    sideEpoch: status.previewStatus.sideEpoch,
  }, frameId);
  assert.equal(accepted, true);
  const geometry = {
    side: "back",
    sessionId: status.sessionId,
    sideEpoch: status.previewStatus.sideEpoch,
    placementState: "not_detected",
    geometrySource: "none",
    detectionUsed: false,
    manualOverrideUsed: false,
    image: { width: 1200, height: 1680 },
    sourceFrameId: frameId,
    timestamp: new Date().toISOString(),
  };
  service.manifest.previewStatus.cardGeometry.back = geometry;
  assert.equal(service.retainPreviewGeometryObservation(geometry), true);
  assert.equal(service.status().previewStatus.positioningLightReady, true);
  return frameId;
}

let atomicBackCaptureSequence = 0;

function atomicBackCaptureRequest(service, overrides = {}) {
  const status = service.status();
  const geometryCaptureMode = overrides.geometryCaptureMode ?? "manual_capture";
  const geometryFrameId = status.previewStatus.cardGeometry?.back?.sourceFrameId;
  return {
    idempotencyKey: `atomic-back-capture-${++atomicBackCaptureSequence}`,
    expectedSessionId: status.sessionId,
    expectedReportId: status.reportId,
    expectedSide: "back",
    expectedSideEpoch: status.previewStatus.sideEpoch,
    expectedFrameId: overrides.expectedFrameId
      ?? (geometryCaptureMode === "detected_geometry" ? geometryFrameId : status.previewStatus.latestFrameId),
    geometryCaptureMode,
    captureTriggerMode: geometryCaptureMode === "manual_capture" ? "operator" : "auto",
    ...overrides,
  };
}

function backPositioningRetryAssertions(service) {
  const status = service.status();
  return {
    sessionId: status.sessionId,
    side: "back",
    sideEpoch: status.previewStatus.sideEpoch,
  };
}

async function prepareBackPositioning(service) {
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await service.action("capture-front", manualCaptureRequest());
  noteFreshBackPreviewFrame(service);
  return service.status();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function waitForAsync(predicate, message, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

test("preview JPEG assembler handles split multipart frames and bounds incomplete input", () => {
  const first = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const second = Buffer.from([0xff, 0xd8, 4, 5, 6, 0xff, 0xd9]);
  const multipart = Buffer.concat([
    Buffer.from("--frame\r\nContent-Type: image/jpeg\r\n\r\n"),
    first,
    Buffer.from("\r\n--frame\r\nContent-Type: image/jpeg\r\n\r\n"),
    second,
    Buffer.from("\r\n"),
  ]);
  const assembler = new AiGraderPreviewJpegFrameAssembler();
  const frames = [];
  for (const split of [multipart.subarray(0, 3), multipart.subarray(3, 47), multipart.subarray(47, 56), multipart.subarray(56)]) {
    frames.push(...assembler.push(split));
  }
  assert.deepEqual(frames, [first, second]);
  assert.equal(assembler.bufferedByteLength <= 1, true);

  const incomplete = new AiGraderPreviewJpegFrameAssembler();
  incomplete.push(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(12 * 1024 * 1024 + 100)]));
  assert.equal(incomplete.bufferedByteLength <= 12 * 1024 * 1024, true);
});

test("preview JPEG assembler preserves captured-at metadata across split multipart headers and has a receipt-time fallback", () => {
  const capturedAt = "2026-07-10T15:16:17.123Z";
  const jpeg = Buffer.from([0xff, 0xd8, 9, 8, 7, 0xff, 0xd9]);
  const multipart = Buffer.concat([
    Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nX-AI-Grader-Frame-Index: 42\r\nX-AI-Grader-Captured-At: ${capturedAt}\r\n\r\n`),
    jpeg,
    Buffer.from("\r\n"),
  ]);
  const assembler = new AiGraderPreviewJpegFrameAssembler();
  const frames = [];
  for (const split of [multipart.subarray(0, 7), multipart.subarray(7, 61), multipart.subarray(61, -3), multipart.subarray(-3)]) {
    frames.push(...assembler.pushWithMetadata(split));
  }
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].bytes, jpeg);
  assert.equal(frames[0].capturedAt, capturedAt);
  assert.equal(frames[0].frameIndex, 42);
  assert.equal(frames[0].timestampSource, "preview_capture_header");
  assert.ok(Number.isFinite(Date.parse(frames[0].receivedAt)));

  const fallback = new AiGraderPreviewJpegFrameAssembler().pushWithMetadata(jpeg);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].capturedAt, undefined);
  assert.equal(fallback[0].timestampSource, "bridge_received");
  assert.ok(Number.isFinite(Date.parse(fallback[0].receivedAt)));
});

test("preview geometry timestamps the result from the frame header instead of detector start time", async () => {
  const dir = outputDir(`preview-captured-at-${Date.now()}`);
  const warm = makeFakeWarmRunner();
  const service = new AiGraderLocalStationBridgeService(realConfig({ outputDir: dir }), {
    async run(step) {
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  }, warm.runner);
  await service.action("start-session", { captureProfile: "full_forensic" });
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1260">
      <rect width="900" height="1260" fill="#17191d"/>
      <rect x="198" y="277" width="504" height="706" rx="4" fill="#f2f0e9"/>
    </svg>
  `);
  const jpeg = await sharp(svg).jpeg({ quality: 90 }).toBuffer();
  const capturedAt = new Date(Date.now() - 250).toISOString();
  const binding = {
    sessionId: service.status().sessionId,
    side: "front",
    sideEpoch: service.status().previewStatus.sideEpoch,
  };
  service.queuePreviewGeometryAnalysis(jpeg, 42, capturedAt, "preview_capture_header", "test-front-frame-42", binding);
  const status = await waitFor(
    () => service.status().previewStatus.cardGeometry.front?.sourceFrameId === "test-front-frame-42"
      ? service.status()
      : undefined,
    "preview geometry did not analyze the synthetic captured-at frame"
  );
  assert.equal(status.previewStatus.cardGeometry.front.timestamp, capturedAt);
  assert.equal(status.previewStatus.cardGeometry.analysis.lastFrameCapturedAt, capturedAt);
  assert.equal(status.previewStatus.cardGeometry.analysis.lastFrameTimestampSource, "preview_capture_header");
  assert.notEqual(status.previewStatus.cardGeometry.analysis.lastStartedAt, capturedAt);
});

test("rapid queue retention never evicts unreviewed backlog beyond the recent-item cap", () => {
  const finalizing = Array.from({ length: 26 }, (_, index) => ({ queueItemId: `pending-${index}`, state: "finalizing" }));
  const terminal = Array.from({ length: 8 }, (_, index) => ({ queueItemId: `published-${index}`, state: "published" }));
  const retained = retainAiGraderRapidCaptureQueueItems([...finalizing, ...terminal]);
  assert.equal(retained.filter((item) => item.state === "finalizing").length, 26);
  assert.equal(retained.filter((item) => item.state === "published").length, 0);
  assert.deepEqual(retained.map((item) => item.queueItemId), finalizing.map((item) => item.queueItemId));

  const mixed = retainAiGraderRapidCaptureQueueItems([
    ...Array.from({ length: 20 }, (_, index) => ({ queueItemId: `review-${index}`, state: "report_ready_needs_confirm" })),
    ...terminal,
  ]);
  assert.equal(mixed.filter((item) => item.state === "report_ready_needs_confirm").length, 20);
  assert.equal(mixed.filter((item) => item.state === "published").length, 5);
});

test("station bridge config is explicit, local-only, and real mode is gated", () => {
  assert.throws(
    () => buildAiGraderLocalStationBridgeConfig({ mode: "mock", outputDir: outputDir("disabled") }, {}),
    /enable-local-station/
  );
  assert.throws(
    () => buildAiGraderLocalStationBridgeConfig({ enabled: true, host: "0.0.0.0", outputDir: outputDir("bad-host") }, {}),
    /loopback/
  );
  assert.throws(
    () => buildAiGraderLocalStationBridgeConfig({ enabled: true, mode: "real", stationToken: "short", outputDir: outputDir("short-token") }, {}),
    /token/
  );
  assert.throws(
    () => buildAiGraderLocalStationBridgeConfig({ enabled: true, mode: "real", stationToken: "1234567890abcdef", outputDir: outputDir("no-apply") }, {}),
    /--apply/
  );

  const config = realConfig();
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 47652);
  assert.equal(config.localOnly, true);
  assert.equal(config.mode, "real");
  assert.throws(
    () => realConfig({ warmRunnerDisabled: true, captureProfile: "production_fast" }),
    /production_fast.*cold debug/i
  );
});

test("external start-session requires an explicit capture profile", async () => {
  const service = new AiGraderLocalStationBridgeService(mockConfig({ outputDir: outputDir(`profile-required-${Date.now()}`) }));
  await assert.rejects(() => service.action("start-session"), /requires an explicit captureProfile/i);
  assert.equal(service.status().sessionId, undefined);
});

test("station bridge config accepts separate pairing code and keeps it distinct from station token", () => {
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "real",
    outputDir: outputDir("pairing-config"),
    apply: true,
    markPresent: true,
    wiringConfirmed: true,
    leimacStatusGreen: true,
    leimacHost: "169.254.191.156",
  }, {
    AI_GRADER_STATION_BRIDGE_TOKEN: "1234567890abcdef",
    AI_GRADER_STATION_PAIRING_CODE: "pairing-code-123456",
    AI_GRADER_STATION_PAIRING_EXPIRES_AT: "2099-01-01T00:00:00.000Z",
  });

  assert.equal(config.stationToken, "1234567890abcdef");
  assert.equal(config.stationPairingCode, "pairing-code-123456");
  assert.notEqual(config.stationPairingCode, config.stationToken);
  assert.equal(config.stationPairingExpiresAt, "2099-01-01T00:00:00.000Z");
  assert.throws(
    () => buildAiGraderLocalStationBridgeConfig({ enabled: true, mode: "mock", stationPairingCode: "short", outputDir: outputDir("short-pairing") }, {}),
    /pairing code/
  );
});

test("station bridge HTTP health and pairing support production web auto-connect without production service token", async () => {
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: "local-station-token-123",
    stationPairingCode: "pairing-code-123456",
    stationPairingExpiresAt: "2099-01-01T00:00:00.000Z",
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: outputDir(`http-pairing-${Date.now()}`),
  });
  try {
    const health = await fetch(`${started.url}/health`, {
      headers: {
        Origin: "https://collect.tenkings.co",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), "https://collect.tenkings.co");
    assert.equal(health.headers.get("access-control-allow-private-network"), "true");
    const healthBody = await health.json();
    assert.equal(healthBody.bridgeVersion, "ai-grader-local-station-bridge-v0.8");
    assert.equal(healthBody.reportProducerContractVersion, "ai-grader-report-producer-v0.2");
    assert.equal(healthBody.pairingAvailable, true);
    assert.equal(healthBody.tokenRequired, true);
    assert.equal(healthBody.stationToken, undefined);

    const rejected = await fetch(`${started.url}/pair`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: "wrong-pairing-code" }),
    });
    assert.equal(rejected.status, 403);

    const paired = await fetch(`${started.url}/pair`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: "pairing-code-123456" }),
    });
    assert.equal(paired.status, 200);
    const pairedBody = await paired.json();
    assert.equal(pairedBody.result.stationToken, "local-station-token-123");
    assert.equal(pairedBody.result.tokenStorage, "browser_localStorage_only");

    const secondPair = await fetch(`${started.url}/pair`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: "pairing-code-123456" }),
    });
    assert.equal(secondPair.status, 403);

    const status = await fetch(`${started.url}/status`, {
      headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": "local-station-token-123" },
    });
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.result.localOnly, true);
    assert.equal(statusBody.result.safety.databaseWrites, false);
  } finally {
    await closeServer(started.server);
  }
});

test("station bridge preview status and stream are token-gated and local-only", async () => {
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: "local-station-token-456",
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: outputDir(`http-preview-${Date.now()}`),
  });
  try {
    const unauthorizedStatus = await fetch(`${started.url}/preview/status`, {
      headers: { Origin: "https://collect.tenkings.co" },
    });
    assert.equal(unauthorizedStatus.status, 401);
    await unauthorizedStatus.text();

    const status = await fetch(`${started.url}/preview/status`, {
      headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": "local-station-token-456" },
    });
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.result.localOnly, true);
    assert.equal(statusBody.result.browserEmbedded, true);
    assert.equal(statusBody.result.tokenRequired, true);
    assert.equal(statusBody.result.safety.publicRouteExposed, false);
    assert.equal(statusBody.result.safety.productionServiceTokenUsed, false);

    const unauthorizedStream = await fetch(`${started.url}/preview/stream`, {
      headers: { Origin: "https://collect.tenkings.co" },
    });
    assert.equal(unauthorizedStream.status, 401);
    await unauthorizedStream.text();

    const unauthorizedStop = await fetch(`${started.url}/preview/stop`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "content-type": "application/json" },
      body: JSON.stringify({ reason: "test unauthorized stop" }),
    });
    assert.equal(unauthorizedStop.status, 401);
    await unauthorizedStop.text();

    const startSession = await fetch(`${started.url}/actions/start-session`, {
      method: "POST",
      headers: {
        Origin: "https://collect.tenkings.co",
        "x-ai-grader-station-token": "local-station-token-456",
        "content-type": "application/json",
      },
      body: JSON.stringify({ captureProfile: "full_forensic" }),
    });
    assert.equal(startSession.status, 200);
    await startSession.text();

    const streamChunk = await new Promise((resolve, reject) => {
      let settled = false;
      const req = http.request(`${started.url}/preview/stream`, {
        headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": "local-station-token-456" },
      }, (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(res.headers["content-type"] ?? "", /multipart\/x-mixed-replace/);
        res.once("data", (chunk) => {
          settled = true;
          res.destroy();
          req.destroy();
          resolve(Buffer.from(chunk));
        });
      });
      req.on("error", (error) => {
        if (!settled) reject(error);
      });
      req.setTimeout(5000, () => {
        if (settled) return;
        settled = true;
        req.destroy();
        reject(new Error("Preview stream did not return a frame."));
      });
      req.end();
    });
    assert.match(streamChunk.toString("utf8"), /tenkings-ai-grader-preview/);
    await new Promise((resolve) => setTimeout(resolve, 25));

    let activeReq;
    const activeStreamClosed = new Promise((resolve, reject) => {
      let sawFrame = false;
      activeReq = http.request(`${started.url}/preview/stream`, {
        headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": "local-station-token-456" },
      }, (res) => {
        assert.equal(res.statusCode, 200);
        res.once("data", () => {
          sawFrame = true;
        });
        res.once("close", () => {
          if (!sawFrame) reject(new Error("Preview stop closed stream before any frame was observed."));
          else resolve();
        });
      });
      activeReq.on("error", (error) => {
        if (!sawFrame) reject(error);
      });
      activeReq.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stop = await fetch(`${started.url}/preview/stop`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": "local-station-token-456", "content-type": "application/json" },
      body: JSON.stringify({ reason: "operator starting front full forensic capture" }),
    });
    assert.equal(stop.status, 200);
    const stopBody = await stop.json();
    assert.equal(stopBody.operation, "preview-stop");
    assert.equal(stopBody.result.cameraOwnership, "released");
    await activeStreamClosed;
    activeReq.destroy();
  } finally {
    if (typeof started.server.closeAllConnections === "function") {
      started.server.closeAllConnections();
    }
    await closeServer(started.server);
  }
});

test("mock live preview reports deterministic path-free front and back geometry states", async () => {
  const dir = outputDir(`preview-geometry-${Date.now()}`);
  const token = "local-station-token-preview-geometry";
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: token,
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: dir,
  });
  const headers = {
    Origin: "https://collect.tenkings.co",
    "x-ai-grader-station-token": token,
    "content-type": "application/json",
  };
  const post = async (action, body = {}) => {
    const response = await fetch(`${started.url}/actions/${action}`, { method: "POST", headers, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message);
    return payload.result;
  };
  const geometry = async () => {
    const response = await fetch(`${started.url}/preview/status`, { headers });
    return (await response.json()).result.cardGeometry;
  };
  const openStream = () => {
    let sawFrame = false;
    const req = http.request(`${started.url}/preview/stream`, { headers }, (res) => {
      assert.equal(res.statusCode, 200);
      res.once("data", () => { sawFrame = true; });
    });
    req.on("error", () => {});
    req.end();
    return req;
  };
  let frontStream;
  let backStream;
  try {
    const startedSession = await post("start-session", { captureProfile: "full_forensic" });
    assert.equal(startedSession.previewStatus.cardGeometry.activeSide, "front");
    assert.equal(startedSession.previewStatus.cardGeometry.analysis.throttleMs, 125);
    assert.equal(startedSession.previewStatus.cardGeometry.front, undefined);
    assert.equal(startedSession.previewStatus.cardGeometry.back, undefined);
    await post("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
    await post("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });

    frontStream = openStream();
    const notDetectedFront = await waitForAsync(async () => {
      const value = await geometry();
      return value.front?.placementState === "not_detected" ? value : undefined;
    }, "front preview never reported not_detected");
    assert.equal(notDetectedFront.explicitManualOverlayAvailable, true);
    assert.equal(Object.prototype.hasOwnProperty.call(notDetectedFront, "manualOverlayFallbackAvailable"), false);
    await waitForAsync(async () => (await geometry()).front?.placementState === "adjust_card", "front preview never reported adjust_card");
    const readyFront = await waitForAsync(async () => {
      const value = await geometry();
      return value.front?.placementState === "ready" ? value : undefined;
    }, "front preview never reported ready");
    assert.equal(readyFront.front.side, "front");
    assert.equal(readyFront.previewFramesPersisted, false);

    const afterFront = await post("capture-front");
    assert.equal(afterFront.previewStatus.cardGeometry.activeSide, "back");
    assert.equal(afterFront.previewStatus.cardGeometry.front.placementState, "ready");
    const frontManifest = JSON.parse(fs.readFileSync(afterFront.outputs.manifestPath, "utf8"));
    assert.equal(frontManifest.previewStatus.cardGeometry.front.placementState, "ready");
    assert.equal(frontManifest.previewStatus.cardGeometry.activeSide, "back");
    assert.deepEqual(frontManifest.geometryCaptureDecisions.front, {
      mode: "detected_geometry",
      placementState: "ready",
      timestamp: frontManifest.geometryCaptureDecisions.front.timestamp,
      explicitOperatorAction: false,
      detectionUsed: true,
      manualOverrideUsed: false,
      sourceFrameId: frontManifest.previewStatus.cardGeometry.front.sourceFrameId,
    });

    backStream = openStream();
    await waitForAsync(async () => (await geometry()).back?.placementState === "not_detected", "back preview never reported not_detected");
    await waitForAsync(async () => (await geometry()).back?.placementState === "adjust_card", "back preview never reported adjust_card");
    const readyBack = await waitForAsync(async () => {
      const value = await geometry();
      return value.back?.placementState === "ready" ? value : undefined;
    }, "back preview never reported ready");
    assert.equal(readyBack.activeSide, "back");
    assert.equal(readyBack.front.placementState, "ready");
    assert.equal(readyBack.back.side, "back");
    assert.equal(readyBack.analysis.source, "mock_deterministic");

    const geometryJson = JSON.stringify(readyBack);
    assert.equal(geometryJson.includes(dir), false);
    assert.equal(geometryJson.includes(token), false);
    assert.equal(/data:image|presigned|127\.0\.0\.1|localhost/i.test(geometryJson), false);

    const afterBack = await post("capture-back", {
      idempotencyKey: `http-detected-back-${Date.now()}`,
      expectedSessionId: afterFront.sessionId,
      expectedReportId: afterFront.reportId,
      expectedSide: "back",
      expectedSideEpoch: readyBack.back.sideEpoch,
      expectedFrameId: readyBack.back.sourceFrameId,
      geometryCaptureMode: "detected_geometry",
      captureTriggerMode: "auto",
    });
    assert.equal(afterBack.geometryCaptureDecisions.back.mode, "detected_geometry");
    assert.equal(afterBack.geometryCaptureDecisions.back.placementState, "ready");
    assert.equal(afterBack.geometryCaptureDecisions.back.detectionUsed, true);
    assert.equal(afterBack.geometryCaptureDecisions.back.manualOverrideUsed, false);
    const capturedManifest = JSON.parse(fs.readFileSync(afterBack.outputs.manifestPath, "utf8"));
    assert.equal(capturedManifest.geometryCaptureDecisions.front.mode, "detected_geometry");
    assert.equal(capturedManifest.geometryCaptureDecisions.back.mode, "detected_geometry");
  } finally {
    frontStream?.destroy();
    backStream?.destroy();
    if (typeof started.server.closeAllConnections === "function") started.server.closeAllConnections();
    await closeServer(started.server);
  }
});

test("capture geometry gating rejects contradictory Ready state and passes explicit manual overlay geometry to processing", async () => {
  const dir = outputDir(`geometry-capture-contract-${Date.now()}`);
  const warm = makeFakeWarmRunner();
  const service = new AiGraderLocalStationBridgeService(realConfig({ outputDir: dir }), {
    async run(step) {
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  }, warm.runner);
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });

  await assert.rejects(() => service.action("capture-front"), /valid Ready detected-geometry.*not_detected/i);
  assert.equal(service.status().geometryCaptureDecisions.front, undefined);
  markReadyGeometry(service, "front");
  service.manifest.previewStatus.cardGeometry.front.geometrySource = "manual_override";
  service.manifest.previewStatus.cardGeometry.front.detectionUsed = false;
  service.manifest.previewStatus.cardGeometry.front.manualOverrideUsed = true;
  await assert.rejects(() => service.action("capture-front"), /valid Ready detected-geometry/i);
  assert.equal(service.status().geometryCaptureDecisions.front, undefined);
  await assert.rejects(
    () => service.action("capture-front", manualCaptureRequest({ captureTriggerMode: "auto" })),
    /auto-capture cannot use manual_capture/i
  );
  assert.equal(service.status().geometryCaptureDecisions.front, undefined);

  const status = await service.action("capture-front", manualCaptureRequest());
  assert.deepEqual(status.geometryCaptureDecisions.front.manualBoundaryRect, {
    x: 100,
    y: 100,
    width: 1400,
    height: 1000,
    coordinateFrame: "basler_sensor_pixels",
  });
  assert.deepEqual(status.geometryCaptureDecisions.front.manualGeometrySource, {
    coordinateFrame: "portrait_preview_pixels",
    imageWidth: 1200,
    imageHeight: 1680,
  });
  assert.equal(status.geometryCaptureDecisions.front.explicitOperatorAction, true);
  assert.equal(status.geometryCaptureDecisions.front.detectionUsed, false);
  assert.equal(status.geometryCaptureDecisions.front.manualOverrideUsed, true);
  const captureInput = warm.calls.find((call) => call.type === "capture" && call.side === "front")?.input;
  assert.deepEqual(captureInput.manualGeometryOverride, {
    action: "manual_capture",
    confirmed: true,
    rect: { x: 100, y: 100, width: 1400, height: 1000 },
  });
  const processingBatch = warm.calls.find((call) => call.type === "process" && call.side === "front")?.batch;
  assert.deepEqual(processingBatch.manualGeometryOverride, captureInput.manualGeometryOverride);
  const persisted = JSON.parse(fs.readFileSync(status.outputs.manifestPath, "utf8"));
  assert.deepEqual(persisted.geometryCaptureDecisions.front.manualBoundaryRect, status.geometryCaptureDecisions.front.manualBoundaryRect);
  const serialized = JSON.stringify(persisted.geometryCaptureDecisions);
  assert.equal(serialized.includes(dir), false);
  assert.equal(/token|data:image|presigned|https?:\/\//i.test(serialized), false);
});

test("capture geometry gating rejects a stale Ready frame instead of reusing old corners", async () => {
  const dir = outputDir(`stale-ready-geometry-${Date.now()}`);
  const warm = makeFakeWarmRunner();
  const service = new AiGraderLocalStationBridgeService(realConfig({ outputDir: dir }), {
    async run(step) {
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  }, warm.runner);
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  markReadyGeometry(service, "front");
  service.manifest.previewStatus.cardGeometry.front.timestamp = new Date(Date.now() - 3000).toISOString();

  await assert.rejects(
    () => service.action("capture-front"),
    /latest detected frame is stale/i,
  );
  assert.equal(warm.calls.some((call) => call.type === "capture"), false);
  assert.equal(service.status().geometryCaptureDecisions.front, undefined);
});

test("capture geometry freshness is frozen at a recent operator click during bounded preview handoff", async () => {
  const dir = outputDir(`click-time-ready-geometry-${Date.now()}`);
  const warm = makeFakeWarmRunner();
  const service = new AiGraderLocalStationBridgeService(realConfig({ outputDir: dir }), {
    async run(step) {
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  }, warm.runner);
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  markReadyGeometry(service, "front");
  const clickAt = new Date(Date.now() - 6000).toISOString();
  service.manifest.previewStatus.cardGeometry.front.timestamp = new Date(Date.parse(clickAt) - 500).toISOString();

  const status = await service.action("capture-front", {
    captureTriggerMode: "operator",
    geometryCaptureMode: "detected_geometry",
    captureTriggerAt: clickAt,
  });

  assert.equal(status.geometryCaptureDecisions.front.timestamp, clickAt);
  assert.equal(warm.calls.some((call) => call.type === "capture" && call.side === "front"), true);
});

test("station bridge live lighting endpoints are token-gated and validate duty and channels", async () => {
  const token = "local-station-token-lighting";
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: token,
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: outputDir(`http-lighting-${Date.now()}`),
  });
  const headers = {
    Origin: "https://collect.tenkings.co",
    "x-ai-grader-station-token": token,
    "content-type": "application/json",
  };
  try {
    const unauthorizedStatus = await fetch(`${started.url}/lighting/status`, {
      headers: { Origin: "https://collect.tenkings.co" },
    });
    assert.equal(unauthorizedStatus.status, 401);
    await unauthorizedStatus.text();

    const unauthorizedApply = await fetch(`${started.url}/lighting/apply`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, dutyPercent: 1.2, channels: [1] }),
    });
    assert.equal(unauthorizedApply.status, 401);
    await unauthorizedApply.text();

    const status = await fetch(`${started.url}/lighting/status`, { headers });
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.result.localOnly, true);
    assert.equal(statusBody.result.tokenRequired, true);
    assert.equal(statusBody.result.safety.publicRouteExposed, false);
    assert.equal(statusBody.result.safety.productionServiceTokenUsed, false);
    assert.equal(statusBody.result.safety.maxDutyPercent, 5);

    const applyBeforeSession = await fetch(`${started.url}/lighting/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true, dutyPercent: 1.2, channels: [1, 2] }),
    });
    assert.equal(applyBeforeSession.status, 400);

    const startSession = await fetch(`${started.url}/actions/start-session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ captureProfile: "full_forensic" }),
    });
    assert.equal(startSession.status, 200);

    const highDuty = await fetch(`${started.url}/lighting/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true, dutyPercent: 5.1, channels: [1, 2] }),
    });
    assert.equal(highDuty.status, 400);
    assert.match(await highDuty.text(), /0 to 5 percent/);

    const badChannels = await fetch(`${started.url}/lighting/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true, dutyPercent: 1.2, channels: [1, 1] }),
    });
    assert.equal(badChannels.status, 400);
    assert.match(await badChannels.text(), /channels/);

    const applied = await fetch(`${started.url}/lighting/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true, dutyPercent: 1.4, channels: [1, 3, 5] }),
    });
    assert.equal(applied.status, 200);
    const appliedBody = await applied.json();
    assert.equal(appliedBody.operation, "lighting-apply");
    assert.equal(appliedBody.result.status, "on");
    assert.equal(appliedBody.result.applied.actualLeimacPwmStep, 14);
    assert.deepEqual(appliedBody.result.applied.channels, [1, 3, 5]);

    const heartbeat = await fetch(`${started.url}/lighting/heartbeat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "test heartbeat" }),
    });
    assert.equal(heartbeat.status, 200);
    const heartbeatBody = await heartbeat.json();
    assert.ok(heartbeatBody.result.watchdog.expiresAt);

    const accepted = await fetch(`${started.url}/lighting/accept`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dutyPercent: 1.4, channels: [1, 3, 5], exposureUs: 47000, gain: 0 }),
    });
    assert.equal(accepted.status, 200);
    const stationStatus = await fetch(`${started.url}/status`, { headers });
    const stationStatusBody = await stationStatus.json();
    assert.equal(stationStatusBody.result.acceptedProfile.source, "browser_live_tuning");
    assert.deepEqual(stationStatusBody.result.acceptedProfile.channels, [1, 3, 5]);
    assert.equal(stationStatusBody.result.acceptedProfile.dutyPercent, 1.4);

    const safeOff = await fetch(`${started.url}/lighting/safe-off`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "test all off" }),
    });
    assert.equal(safeOff.status, 200);
    const safeOffBody = await safeOff.json();
    assert.equal(safeOffBody.result.applied.enabled, false);
    assert.equal(safeOffBody.result.status, "safe_off");
  } finally {
    if (typeof started.server.closeAllConnections === "function") {
      started.server.closeAllConnections();
    }
    await closeServer(started.server);
  }
});

test("real station command plan still uses full forensic front/back evidence packages", () => {
  const plan = buildAiGraderStationRealCommandPlan({
    outputDir: outputDir("forensic-plan"),
    leimacHost: "169.254.191.156",
    markPresent: true,
    wiringConfirmed: true,
    leimacStatusGreen: true,
    operatorConfirmedLightIdleOff: true,
    operatorConfirmedFixtureRulersVisible: true,
    operatorFlipConfirmed: true,
  });
  const front = plan.find((step) => step.id === "capture_front");
  const back = plan.find((step) => step.id === "capture_back");
  assert.ok(front);
  assert.ok(back);
  assert.equal(front.args[0], "ai-grader-fixed-rig-v1-evidence-package");
  assert.equal(back.args[0], "ai-grader-fixed-rig-v1-evidence-package");
  assert.deepEqual(front.args.slice(front.args.indexOf("--evidence-side") + 1, front.args.indexOf("--evidence-side") + 2), ["front"]);
  assert.deepEqual(back.args.slice(back.args.indexOf("--evidence-side") + 1, back.args.indexOf("--evidence-side") + 2), ["back"]);
  assert.equal(front.label.includes("evidence package"), true);
  assert.equal(back.label.includes("evidence package"), true);
  assert.equal(plan.find((step) => step.id === "unified_report")?.required, true);
  assert.equal(JSON.stringify(plan).includes("fast"), false);
});

test("mock station bridge runs staged workflow without claiming hardware", async () => {
  const bundleRoot = outputDir(`canonical-report-bundles-${Date.now()}`);
  const config = mockConfig({ reportBundleOutputDir: bundleRoot });
  const service = new AiGraderLocalStationBridgeService(config);

  let status = service.status();
  assert.equal(status.bridgeVersion, AI_GRADER_LOCAL_STATION_BRIDGE_VERSION);
  assert.equal(status.reportProducerContractVersion, "ai-grader-report-producer-v0.2");
  assert.equal(status.hardwareActionsEnabled, false);
  assert.equal(status.safety.hardwareAccessed, false);
  assert.equal(status.warmRunnerStatus.mode, "full_forensic");
  assert.equal(status.executionPath, "warm_full_forensic_runner");
  assert.equal(status.explicitColdDebugModeUsed, false);
  assert.equal(Object.prototype.hasOwnProperty.call(status, "fallbackUsed"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(status, "fallbackReason"), false);
  assert.equal(status.warmRunnerStatus.executionPath, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.backend, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.explicitColdDebugModeUsed, false);
  assert.deepEqual(status.warmRunnerStatus.coldDebugMode, { configured: false, active: false });
  assert.equal(Object.prototype.hasOwnProperty.call(status.warmRunnerStatus, "fallbackUsed"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(status.warmRunnerStatus, "fallback"), false);
  assert.equal(status.warmRunnerStatus.safety.captureLock, true);
  assert.equal(status.warmRunnerStatus.safety.watchdogSafeOff, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnFailure, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnCancellation, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnSessionEnd, true);
  assert.equal(status.warmRunnerStatus.safety.publicRouteExposed, false);
  assert.equal(status.warmRunnerStatus.safety.productionServiceTokenUsed, false);
  assert.deepEqual(status.warmRunnerStatus.evidencePlan.rolesBySide.front.map((role) => role.role), fullEvidenceRoleIds());
  assert.deepEqual(status.warmRunnerStatus.evidencePlan.rolesBySide.back.map((role) => role.role), fullEvidenceRoleIds());

  status = await service.action("start-session", { captureProfile: "full_forensic" });
  assert.equal(status.currentStep, "verify_fixture_rulers");
  assert.ok(status.outputs.sessionDir);
  assert.equal(status.warmRunnerStatus.phases.some((phase) => phase.id === "warm_session_setup"), true);
  assert.equal(status.captureTiming.hardwareMeasurement, false);
  assert.equal(status.captureTiming.target.fiveSecondsPerSideProven, false);

  await assert.rejects(() => service.action("launch-preview"), /fixture\/rulers/);

  status = await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  assert.equal(status.confirmations.lightIdleOff, true);
  status = await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  assert.equal(status.confirmations.fixtureRulersVisible, true);
  status = await service.action("launch-preview");
  assert.equal(status.outputs.previewPackageDir?.includes("mock-operator_preview"), true);

  status = await service.action("accept-profile", {
    acceptedProfile: { dutyPercent: 1.4, exposureUs: 45000, gain: 0, channels: [1, 2, 3, 4, 5, 6, 7, 8] },
  });
  assert.equal(status.acceptedProfile.dutyPercent, 1.4);
  assert.equal(status.acceptedProfile.actualLeimacPwmStep, 14);

  status = await service.action("capture-front", manualCaptureRequest());
  assert.equal(status.sessionManifest.frontCaptured, true);
  assert.equal(status.warmRunnerStatus.captureLock.held, false);
  assert.equal(status.warmRunnerStatus.previewPolicy.holdActive, false);
  assert.ok(status.warmRunnerStatus.previewPolicy.lastHoldStartedAt);
  assert.ok(status.warmRunnerStatus.previewPolicy.lastResumeReadyAt);
  assert.equal(status.warmRunnerStatus.evidencePlan.rolesBySide.front.every((role) => role.status === "completed"), true);
  assert.equal(status.warmRunnerStatus.evidencePlan.rolesBySide.back.every((role) => role.status === "pending"), true);
  assert.equal(status.warmRunnerStatus.queues.capture.some((phase) => phase.id === "capture_front" && phase.status === "completed"), true);
  assert.equal(status.warmRunnerStatus.queues.processing.some((phase) => phase.id === "process_front_artifacts" && phase.status === "completed"), true);
  assert.equal(status.captureTiming.events.find((event) => event.id === "capture_trigger" && event.side === "front")?.triggerMode, "operator");
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { expectedFrameId: "missing-back-frame" })),
    /recent live back preview frame/i,
  );

  noteFreshBackPreviewFrame(service);
  markReadyGeometry(service, "back");
  status = await service.action("capture-back", atomicBackCaptureRequest(service, { geometryCaptureMode: "detected_geometry" }));
  assert.equal(status.confirmations.flipComplete, true);
  assert.equal(status.sessionManifest.backCaptured, true);
  assert.equal(status.warmRunnerStatus.previewPolicy.holdActive, true);
  assert.equal(status.warmRunnerStatus.evidencePlan.rolesBySide.back.every((role) => role.status === "completed"), true);
  assert.equal(status.warmRunnerStatus.queues.processing.some((phase) => phase.id === "process_back_artifacts" && phase.status === "completed"), true);
  assert.equal(status.captureTiming.events.find((event) => event.id === "capture_trigger" && event.side === "back")?.triggerMode, "auto");
  status = await service.action("run-diagnostics");
  assert.equal(status.latestReport.exists, true);
  assert.equal(status.warmRunnerStatus.previewPolicy.holdActive, true);
  assert.equal(status.warmRunnerStatus.queues.report.some((phase) => phase.id === "report_queue" && phase.status === "completed"), true);
  assert.equal(status.timingSummary.detailedEntries.some((entry) => entry.category === "warm_runner"), true);
  assert.equal(status.timingSummary.executionPath, "warm_full_forensic_runner");
  assert.equal(status.timingSummary.explicitColdDebugModeUsed, false);
  assert.equal(Object.prototype.hasOwnProperty.call(status.timingSummary, "fallbackUsed"), false);
  assert.match(status.timingSummary.targetInterCaptureNote, /full forensic evidence preserved/i);
  assert.equal(status.captureTiming.summary.totalFrontMs >= 0, true);
  assert.equal(status.captureTiming.summary.totalBackMs >= 0, true);
  assert.equal(status.captureTiming.target.fiveSecondsPerSideProven, false);
  assert.equal(status.captureProfileGuard.fiveSecondTargetProven, false);
  const warmSessionManifest = JSON.parse(fs.readFileSync(status.outputs.manifestPath, "utf8"));
  assert.equal(warmSessionManifest.executionPath, "warm_full_forensic_runner");
  assert.equal(warmSessionManifest.explicitColdDebugModeUsed, false);
  assert.equal(Object.prototype.hasOwnProperty.call(warmSessionManifest, "fallbackUsed"), false);
  const completeMockReport = createCandidateRecoveryReport(
    config.outputDir,
    status.latestReport.reportId,
    service.manifest.sessionId,
  );
  service.manifest.outputs.unifiedReportDir = completeMockReport.reportDir;
  service.manifest.outputs.unifiedReportPath = completeMockReport.reportHtmlPath;
  const resolvedReport = await service.reportBundle(status.latestReport.reportId);
  assert.equal(resolvedReport.reportId, status.latestReport.reportId);
  assert.equal(resolvedReport.bundle.finalGradeComputed, false);
  const history = await service.reportHistory();
  assert.equal(history.items.some((item) => item.reportId === status.latestReport.reportId), true);
  assert.equal(history.stats.allTime >= 1, true);
  status = await service.action("export-report-bundle");
  assert.ok(status.outputs.reportBundlePath);
  assert.equal(status.reportBundle.captureTiming.schemaVersion, "ten-kings-ai-grader-capture-timing-v1");
  assert.equal(status.reportBundle.captureTiming.hardwareMeasurement, false);
  assert.equal(status.reportBundle.geometryCaptureDecisions.front.mode, "manual_capture");
  assert.equal(status.reportBundle.geometryCaptureDecisions.front.manualOverrideUsed, true);
  assert.equal(status.reportBundle.geometryCaptureDecisions.back.mode, "detected_geometry");
  const publicGeometryDecisions = JSON.stringify(status.reportBundle.geometryCaptureDecisions);
  assert.equal(publicGeometryDecisions.includes(status.outputs.sessionDir), false);
  assert.equal(/token|data:image|presigned|https?:\/\//i.test(publicGeometryDecisions), false);
  const reportId = status.latestReport.reportId;
  const publishPackageDir = path.join(bundleRoot, reportId);
  assert.equal(status.outputs.publishPackageDir, publishPackageDir);
  assert.equal(status.outputs.reportBundlePath, path.join(publishPackageDir, "report-bundle.json"));
  assert.equal(status.outputs.assetManifestPath, path.join(publishPackageDir, "asset-manifest.json"));
  assert.equal(status.outputs.checksumsPath, path.join(publishPackageDir, "checksums.json"));
  assert.equal(fs.existsSync(status.outputs.reportBundlePath), true);
  assert.equal(fs.existsSync(path.join(bundleRoot, "report-bundle.json")), false);
  assert.equal(status.safety.finalGradeComputed, false);
  assert.equal(status.safety.certifiedClaim, false);
  status = await service.action("calculate-final-grade", {
    operatorId: "mark",
    warningsAccepted: true,
    overrideReason: "Bridge test warning acceptance.",
  });
  assert.ok(status.outputs.productionReleasePath);
  assert.ok(status.outputs.labelDataPath);
  assert.equal(path.dirname(status.outputs.productionReleasePath), publishPackageDir);
  assert.equal(status.outputs.labelDataPath, path.join(publishPackageDir, "label-data.json"));
  assert.equal(fs.existsSync(path.join(publishPackageDir, "production-release.json")), true);
  assert.equal(fs.existsSync(path.join(publishPackageDir, "label-data.json")), true);
  const canonicalResolved = await service.reportBundle(reportId);
  assert.equal(canonicalResolved.source, "canonical_publish_package");
  assert.equal(canonicalResolved.bundle.reportId, reportId);
  assert.equal(canonicalResolved.bundle.productionRelease?.reportId, reportId);
  assert.ok(canonicalResolved.bundle.productionRelease?.label?.status);
  assert.equal(status.safety.certifiedClaim, false);
  assert.equal(status.safety.certificateGenerated, false);
  const release = JSON.parse(fs.readFileSync(status.outputs.productionReleasePath, "utf8"));
  assert.equal(release.databaseIntegration.productionDbWritesPerformed, false);
  assert.equal(release.storageIntegration.uploadPerformed, false);
});

test("active confirmed report recovers a stale PR82 package once under concurrent reads", async () => {
  const dir = outputDir("active-report-recovery-" + Date.now());
  const bundleRoot = path.join(dir, "report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
  const service = new AiGraderLocalStationBridgeService(config);
  const reportId = "active-pr82-recovery-report";
  const fixture = await installStaleCandidatePackage(service, config, reportId);
  const workflowHistory = structuredClone(fixture.manifest.rapidCapture.workflowHistory);

  const resolved = await Promise.all([service.reportBundle(reportId), service.reportBundle(reportId)]);
  assert.equal(resolved.some((item) => item.source === "canonical_publish_package_recovered"), true);
  assert.equal(resolved.every((item) => item.bundle.reportProducer.contractVersion === "ai-grader-report-producer-v0.2"), true);
  assert.equal(resolved[0].bundle.visionLab.defectFindings[0].findingId, fixture.legacyFindingId);
  assert.deepEqual(resolved[0].bundle.productionRelease.operatorFinalization, fixture.previousRelease.operatorFinalization);
  for (const fileName of [
    "report-bundle.json", "asset-manifest.json", "checksums.json", "production-release.json",
    "label-data.json", "publication-manifest.json", "integration-contract.json",
  ]) assert.equal(fs.existsSync(path.join(fixture.canonicalDir, fileName)), true, fileName);
  const nextStatus = service.status();
  assert.equal(nextStatus.rapidCapture.workflowState, "confirmed_needs_publish");
  assert.deepEqual(nextStatus.rapidCapture.workflowHistory, workflowHistory);
  assert.equal(nextStatus.progressLog.filter((entry) => entry.includes("derived package safely recovered")).length, 1);
});

test("stale candidate report without a release recovers only the base package before explicit operator finalization", async () => {
  const dir = outputDir("active-report-recovery-no-release-" + Date.now());
  const bundleRoot = path.join(dir, "report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
  const service = new AiGraderLocalStationBridgeService(config);
  const reportId = "active-pr82-recovery-no-release";
  const fixture = await installStaleCandidatePackage(service, config, reportId, {
    includeRelease: false,
    embedRelease: true,
  });

  const resolved = await service.reportBundle(reportId);
  assert.equal(resolved.source, "canonical_publish_package_recovered");
  assert.equal(resolved.bundle.productionRelease, undefined);
  for (const fileName of ["report-bundle.json", "asset-manifest.json", "checksums.json"]) {
    assert.equal(fs.existsSync(path.join(fixture.canonicalDir, fileName)), true, fileName);
  }
  assert.equal(fs.existsSync(path.join(fixture.canonicalDir, "assets")), true);
  for (const fileName of ["production-release.json", "label-data.json", "publication-manifest.json", "integration-contract.json"]) {
    assert.equal(fs.existsSync(path.join(fixture.canonicalDir, fileName)), false, fileName);
  }
  let status = service.status();
  assert.equal(status.productionRelease, undefined);
  assert.equal(status.outputs.productionReleasePath, undefined);
  assert.equal(status.safety.finalGradeComputed, false);
  assert.equal(status.safety.labelGenerated, false);
  assert.equal(status.rapidCapture.workflowState, "report_ready_needs_confirm");

  status = await service.action("calculate-final-grade", {
    operatorId: "corrective-operator",
    warningsAccepted: true,
    overrideReason: "Explicit review after safe base recovery.",
  });
  const release = JSON.parse(fs.readFileSync(path.join(fixture.canonicalDir, "production-release.json"), "utf8"));
  assert.equal(status.productionRelease.operatorFinalization.operatorId, "corrective-operator");
  assert.equal(release.operatorFinalization.operatorId, "corrective-operator");
  assert.equal(release.operatorFinalization.warningsAccepted, true);
  assert.equal(release.operatorFinalization.overrideReason, "Explicit review after safe base recovery.");
});

test("finalized active includeAssetBodies returns the exact canonical verified release with integrity-bound image bodies", async () => {
  const dir = outputDir("active-finalized-body-release-" + Date.now());
  const bundleRoot = path.join(dir, "report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
  const service = new AiGraderLocalStationBridgeService(config);
  const reportId = "active-finalized-body-release";
  const fixture = await installStaleCandidatePackage(service, config, reportId);

  const resolved = await service.reportBundle(reportId, { includeAssetBodies: true });

  assert.equal(resolved.bundle.visionLab.defectFindings[0].findingId, fixture.legacyFindingId);
  await assertFinalizedBodyBundleMatchesCanonical(resolved, fixture.canonicalDir);
});

test("finalized history includeAssetBodies returns the exact canonical verified release with integrity-bound image bodies", async () => {
  const dir = outputDir("history-finalized-body-release-" + Date.now());
  const bundleRoot = path.join(dir, "report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
  const seedService = new AiGraderLocalStationBridgeService(config);
  const reportId = "history-finalized-body-release";
  const fixture = await installStaleCandidatePackage(seedService, config, reportId);
  const historyService = new AiGraderLocalStationBridgeService(config);

  const resolved = await historyService.reportBundle(reportId, { includeAssetBodies: true });

  assert.equal(resolved.bundle.visionLab.defectFindings[0].findingId, fixture.legacyFindingId);
  await assertFinalizedBodyBundleMatchesCanonical(resolved, fixture.canonicalDir);
});

test("active and history includeAssetBodies keep a canonically unfinalized report unfinalized despite a cached manifest release", async () => {
  for (const access of ["active", "history"]) {
    const dir = outputDir(access + "-unfinalized-body-release-" + Date.now());
    const bundleRoot = path.join(dir, "report-bundles");
    fs.rmSync(dir, { recursive: true, force: true });
    const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
    const seedService = new AiGraderLocalStationBridgeService(config);
    const reportId = access + "-unfinalized-body-release";
    const fixture = await installStaleCandidatePackage(seedService, config, reportId, {
      includeRelease: false,
      embedRelease: true,
    });
    assert.equal(fixture.manifest.productionRelease.finalGradeComputed, true);
    const reader = access === "active" ? seedService : new AiGraderLocalStationBridgeService(config);

    const resolved = await reader.reportBundle(reportId, { includeAssetBodies: true });
    const canonicalBundleBytes = fs.readFileSync(path.join(fixture.canonicalDir, "report-bundle.json"), "utf8");
    const canonicalBundle = JSON.parse(canonicalBundleBytes);

    assert.equal(resolved.bundle.productionRelease, undefined, access);
    assert.notEqual(resolved.bundle.finalGradeComputed, true, access);
    assert.notEqual(resolved.bundle.finalStatus, "final_grade_computed", access);
    assert.equal(canonicalBundle.reportProducer.contractVersion, "ai-grader-report-producer-v0.2", access);
    assert.equal(fs.existsSync(path.join(fixture.canonicalDir, "asset-manifest.json")), true, access);
    assert.equal(fs.existsSync(path.join(fixture.canonicalDir, "checksums.json")), true, access);
    for (const fileName of [
      "production-release.json",
      "label-data.json",
      "publication-manifest.json",
      "integration-contract.json",
    ]) {
      assert.equal(fs.existsSync(path.join(fixture.canonicalDir, fileName)), false, access + ":" + fileName);
    }
    assertEmbeddedImageBodiesMatchCanonical(resolved.bundle, canonicalBundle);
    assert.equal(canonicalBundleBytes.includes("bodyBase64"), false, access);
  }
});

test("includeAssetBodies rejects corrupt active and identity-mismatched history canonical release evidence without cached fallback", async () => {
  for (const failure of ["corrupt-active", "mismatched-history"]) {
    const dir = outputDir("body-release-" + failure + "-" + Date.now());
    const bundleRoot = path.join(dir, "report-bundles");
    fs.rmSync(dir, { recursive: true, force: true });
    const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
    const seedService = new AiGraderLocalStationBridgeService(config);
    const reportId = "body-release-" + failure;
    const fixture = await installStaleCandidatePackage(seedService, config, reportId);
    await seedService.reportBundle(reportId);
    const releasePath = path.join(fixture.canonicalDir, "production-release.json");
    const tamperedBytes = failure === "corrupt-active"
      ? Buffer.from("{not-json")
      : Buffer.from(JSON.stringify({
          ...JSON.parse(fs.readFileSync(releasePath, "utf8")),
          reportId: "different-report-id",
        }, null, 2));
    fs.writeFileSync(releasePath, tamperedBytes);
    const reader = failure === "corrupt-active"
      ? seedService
      : new AiGraderLocalStationBridgeService(config);

    await assert.rejects(
      reader.reportBundle(reportId, { includeAssetBodies: true }),
      (error) => error instanceof Error && error.message === AI_GRADER_REPORT_RECOVERY_GUIDANCE,
      failure,
    );
    assert.deepEqual(fs.readFileSync(releasePath), tamperedBytes, failure);
  }
});

test("includeAssetBodies rejects an orphaned canonical release package when report-bundle.json is missing", async () => {
  const dir = outputDir("body-release-orphaned-canonical-" + Date.now());
  const bundleRoot = path.join(dir, "report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
  const service = new AiGraderLocalStationBridgeService(config);
  const reportId = "body-release-orphaned-canonical";
  const fixture = await installStaleCandidatePackage(service, config, reportId);
  await service.reportBundle(reportId);
  const bundlePath = path.join(fixture.canonicalDir, "report-bundle.json");
  const releasePath = path.join(fixture.canonicalDir, "production-release.json");
  const releaseBytes = fs.readFileSync(releasePath);
  fs.rmSync(bundlePath);

  await assert.rejects(
    service.reportBundle(reportId, { includeAssetBodies: true }),
    (error) => error instanceof Error && error.message === AI_GRADER_REPORT_RECOVERY_GUIDANCE,
  );
  assert.equal(fs.existsSync(bundlePath), false);
  assert.deepEqual(fs.readFileSync(releasePath), releaseBytes);
});

test("includeAssetBodies rejects impossible finalized gate state and incomplete accepted-warning attribution", async () => {
  for (const failure of ["failed-final-gate", "unlisted-accepted-warning"]) {
    const dir = outputDir("body-release-" + failure + "-" + Date.now());
    const bundleRoot = path.join(dir, "report-bundles");
    fs.rmSync(dir, { recursive: true, force: true });
    const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
    const service = new AiGraderLocalStationBridgeService(config);
    const reportId = "body-release-" + failure;
    const fixture = await installStaleCandidatePackage(service, config, reportId);
    await service.reportBundle(reportId);
    const releasePath = path.join(fixture.canonicalDir, "production-release.json");
    const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
    release.gates[0].status = failure === "failed-final-gate" ? "fail" : "accepted_warning";
    release.operatorFinalization.acceptedWarningGateIds = [];
    const tamperedBytes = Buffer.from(JSON.stringify(release, null, 2));
    fs.writeFileSync(releasePath, tamperedBytes);

    await assert.rejects(
      service.reportBundle(reportId, { includeAssetBodies: true }),
      (error) => error instanceof Error && error.message === AI_GRADER_REPORT_RECOVERY_GUIDANCE,
      failure,
    );
    assert.deepEqual(fs.readFileSync(releasePath), tamperedBytes, failure);
  }
});

test("next locked report access restores an interrupted canonical backup before recovery", async () => {
  const dir = outputDir("active-report-recovery-interrupted-" + Date.now());
  const bundleRoot = path.join(dir, "report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
  const service = new AiGraderLocalStationBridgeService(config);
  const reportId = "active-pr82-recovery-interrupted";
  const fixture = await installStaleCandidatePackage(service, config, reportId);
  const transactionId = "simulated-interruption";
  const backupDir = path.join(bundleRoot, "." + reportId + ".backup-" + transactionId);
  const stageDir = path.join(bundleRoot, "." + reportId + ".staging-" + transactionId);
  fs.renameSync(fixture.canonicalDir, backupDir);
  fs.mkdirSync(stageDir, { recursive: true });
  fs.writeFileSync(path.join(stageDir, "partial.marker"), "interrupted");

  const resolved = await service.reportBundle(reportId);
  assert.equal(resolved.source, "canonical_publish_package_recovered");
  assert.equal(resolved.bundle.visionLab.defectFindings[0].findingId, fixture.legacyFindingId);
  assert.equal(fs.existsSync(fixture.canonicalDir), true);
  assert.equal(fs.existsSync(backupDir), false);
  assert.equal(fs.existsSync(stageDir), false);
  assert.equal(service.status().rapidCapture.workflowState, "confirmed_needs_publish");
});

test("current producer sidecars cannot bypass immutable session and report-folder identity", async () => {
  const dir = outputDir("current-producer-identity-" + Date.now());
  const bundleRoot = path.join(dir, "report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
  const service = new AiGraderLocalStationBridgeService(config);
  const reportId = "current-producer-wrong-session";
  const fixture = await installStaleCandidatePackage(service, config, reportId, { includeRelease: false });
  await service.reportBundle(reportId);
  const bundlePath = path.join(fixture.canonicalDir, "report-bundle.json");
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  bundle.gradingSessionId = "wrong-session";
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));

  await assert.rejects(
    service.reportBundle(reportId),
    (error) => error instanceof Error && error.message === AI_GRADER_REPORT_RECOVERY_GUIDANCE,
  );
});

test("corrupt release evidence or an orphan release sidecar fails without replacing the base package", async () => {
  for (const failure of ["corrupt-release", "orphan-sidecar"]) {
    const dir = outputDir("release-evidence-" + failure + "-" + Date.now());
    const bundleRoot = path.join(dir, "report-bundles");
    fs.rmSync(dir, { recursive: true, force: true });
    const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
    const service = new AiGraderLocalStationBridgeService(config);
    const reportId = "release-evidence-" + failure;
    const fixture = await installStaleCandidatePackage(service, config, reportId, {
      includeRelease: failure === "corrupt-release",
    });
    const bundlePath = path.join(fixture.canonicalDir, "report-bundle.json");
    const oldBundleBytes = fs.readFileSync(bundlePath);
    const evidencePath = failure === "corrupt-release"
      ? path.join(fixture.canonicalDir, "production-release.json")
      : path.join(fixture.canonicalDir, "label-data.json");
    const evidenceBytes = failure === "corrupt-release"
      ? Buffer.from("{not-json")
      : Buffer.from(JSON.stringify({ reportId, status: "orphaned" }));
    fs.writeFileSync(evidencePath, evidenceBytes);

    await assert.rejects(
      service.reportBundle(reportId),
      (error) => error instanceof Error && error.message === AI_GRADER_REPORT_RECOVERY_GUIDANCE,
    );
    assert.deepEqual(fs.readFileSync(bundlePath), oldBundleBytes);
    assert.deepEqual(fs.readFileSync(evidencePath), evidenceBytes);
  }
});

test("tampered promoted assets restore the last committed backup before rebuilding", async () => {
  const dir = outputDir("promoted-asset-rollback-" + Date.now());
  const bundleRoot = path.join(dir, "report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
  const service = new AiGraderLocalStationBridgeService(config);
  const reportId = "promoted-asset-rollback";
  const fixture = await installStaleCandidatePackage(service, config, reportId);
  const savedBackup = path.join(bundleRoot, "saved-stale-generation");
  fs.cpSync(fixture.canonicalDir, savedBackup, { recursive: true });
  const first = await service.reportBundle(reportId);
  const transactionBackup = path.join(bundleRoot, "." + reportId + ".backup-tampered-promotion");
  fs.renameSync(savedBackup, transactionBackup);
  const imageAsset = first.bundle.assets.find((asset) => asset.kind === "image");
  fs.writeFileSync(imageAsset.localPath, Buffer.alloc(imageAsset.byteSize, 0));

  const rebuilt = await service.reportBundle(reportId);
  assert.equal(rebuilt.source, "canonical_publish_package_recovered");
  assert.equal(rebuilt.bundle.visionLab.defectFindings[0].findingId, fixture.legacyFindingId);
  assert.equal(fs.existsSync(transactionBackup), false);
  assert.equal(fs.readFileSync(imageAsset.localPath).equals(Buffer.alloc(imageAsset.byteSize, 0)), false);
});

test("browser live lighting safe-offs before front capture and only then restores accepted back positioning", async () => {
  const service = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`lighting-capture-safeoff-${Date.now()}`),
  }));

  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.applyLiveLighting({ enabled: true, dutyPercent: 1.2, channels: [1, 2, 3] });
  assert.equal(service.status().liveLighting.applied.enabled, true);
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const status = await service.action("capture-front", manualCaptureRequest());

  assert.equal(status.liveLighting.applied.enabled, true);
  assert.equal(status.liveLighting.backPositioning.status, "waiting_for_frame");
  assert.equal(status.liveLighting.backPositioning.captureReady, false);
  assert.equal(status.liveLighting.safetyEvents.some((event) => event.type === "capture_start_safe_off" && event.ok), true);
  assert.deepEqual(
    status.liveLighting.backPositioning.events.slice(0, 2).map((event) => event.type),
    ["restore_starting", "restore_success"]
  );
  const sessionManifest = JSON.parse(fs.readFileSync(status.outputs.manifestPath, "utf8"));
  assert.equal(sessionManifest.liveLighting.applied.enabled, true);
  assert.equal(sessionManifest.liveLighting.safetyEvents.some((event) => event.type === "capture_start_safe_off"), true);
});

test("accepted browser live lighting profile is passed to warm capture", async () => {
  const warm = makeFakeWarmRunner();
  const runner = {
    async run(step) {
      if (step.id === "unified_report") {
        return {
          stepId: step.id,
          ok: true,
          exitCode: 0,
          payload: { report: { packageDir: "unified-report", reportPath: "unified-report/provisional-diagnostic-report.html" } },
        };
      }
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const service = new AiGraderLocalStationBridgeService(realConfig({
    outputDir: outputDir(`lighting-accepted-${Date.now()}`),
  }), runner, warm.runner);

  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.acceptLiveLightingForCapture({ dutyPercent: 1.7, channels: [2, 4, 6, 8], exposureUs: 46000, gain: 0 });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const status = await service.action("capture-front", manualCaptureRequest());

  assert.equal(status.acceptedProfile.source, "browser_live_tuning");
  assert.equal(status.acceptedProfile.dutyPercent, 1.7);
  assert.deepEqual(status.acceptedProfile.channels, [2, 4, 6, 8]);
  assert.equal(warm.calls[0].type, "capture");
  assert.equal(warm.calls[0].input.activeLightingProfile.profileSource, "browser_live_tuning");
  assert.equal(warm.calls[0].input.activeLightingProfile.selectedDutyPercent, 1.7);
  assert.deepEqual(warm.calls[0].input.activeLightingProfile.selectedChannels, [2, 4, 6, 8]);
});

test("default bridge processing controllers are fresh, bounded, and inert until captured evidence is submitted", async () => {
  const first = new RealAiGraderLocalStationBridgeService(
    mockConfig({ outputDir: outputDir(`fresh-worker-first-${Date.now()}`) }),
    inertCommandRunner,
    undefined,
    inertBridgeDependencies(),
  );
  const second = new RealAiGraderLocalStationBridgeService(
    mockConfig({ outputDir: outputDir(`fresh-worker-second-${Date.now()}`) }),
    inertCommandRunner,
    undefined,
    inertBridgeDependencies(),
  );
  assert.notEqual(first.warmRunner, second.warmRunner);
  assert.deepEqual(first.warmRunner.processingWorkerStatus(), {
    active: false,
    pending: 0,
    maxPending: 1,
    maxConcurrency: 1,
    closed: false,
  });
  await first.shutdown("fresh controller isolation test");
  assert.equal(first.warmRunner.processingWorkerStatus().closed, true);
  assert.equal(second.warmRunner.processingWorkerStatus().closed, false);
  await second.shutdown("fresh controller isolation test");
});

test("front capture safe-offs before lock and restores only the exact durably persisted accepted profile after release", async () => {
  const dir = outputDir(`positioning-order-${Date.now()}`);
  let service;
  const writes = [];
  const warm = makeFakeWarmRunner({
    onCaptureStarted() {
      const duringCapture = service.status();
      assert.equal(duringCapture.warmRunnerStatus.captureLock.held, true);
      assert.equal(duringCapture.liveLighting.applied.enabled, undefined);
      assert.equal(duringCapture.liveLighting.physicalState.state, "physical_state_unknown");
      assert.equal(duringCapture.previewStatus.cameraOwnership, "capture_action");
    },
  });
  const writeLightingFrames = async (frames) => {
    const snapshot = service.status();
    writes.push({ frames, snapshot });
    if (snapshot.currentStep === "prompt_flip_card" && frames.length > 3) {
      assert.equal(snapshot.warmRunnerStatus.captureLock.held, false);
      assert.equal(snapshot.warmRunnerStatus.previewPolicy.holdActive, false);
      assert.ok(snapshot.outputs.frontPackageDir);
      const persisted = JSON.parse(fs.readFileSync(snapshot.outputs.manifestPath, "utf8"));
      assert.equal(persisted.currentStep, "prompt_flip_card");
      assert.equal(persisted.outputs.frontPackageDir, snapshot.outputs.frontPackageDir);
      assert.equal(persisted.warmRunnerStatus.captureLock.held, false);
      assert.equal(persisted.warmRunnerStatus.previewPolicy.holdActive, false);
      assert.equal(persisted.liveLighting.backPositioning.status, "restoring");
    }
    return frames.map(() => ({ responseKind: "ack", ok: true }));
  };
  service = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: dir }),
    { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } },
    warm.runner,
    { writeLightingFrames },
  );

  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.applyLiveLighting({ enabled: true, dutyPercent: 5, channels: [8, 2, 4] });
  await service.acceptLiveLightingForCapture({ dutyPercent: 5, channels: [8, 2, 4], exposureUs: 47000, gain: 0 });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const status = await service.action("capture-front", manualCaptureRequest());

  assert.equal(status.currentStep, "prompt_flip_card");
  assert.equal(status.liveLighting.backPositioning.status, "waiting_for_frame");
  assert.equal(status.liveLighting.backPositioning.dutyPercent, 5);
  assert.equal(status.liveLighting.backPositioning.actualLeimacPwmStep, 50);
  assert.deepEqual(status.liveLighting.backPositioning.channels, [2, 4, 8]);
  assert.equal(status.liveLighting.applied.dutyPercent, 5);
  assert.deepEqual(status.liveLighting.applied.channels, [2, 4, 8]);
  assert.match(status.liveLighting.backPositioning.profileIdentity, /^accepted-[a-f0-9]{16}$/);
  assert.deepEqual(
    status.liveLighting.backPositioning.events.slice(-2).map((event) => event.type),
    ["restore_starting", "restore_success"]
  );
  assert.ok(writes.some((entry) => entry.snapshot.currentStep === "prompt_flip_card"));
  noteFreshBackPreviewFrame(service);
  const back = await service.action("capture-back", atomicBackCaptureRequest(service));
  assert.equal(back.sessionManifest.backCaptured, true);
  assert.equal(back.liveLighting.applied.enabled, false);
  assert.equal(back.liveLighting.backPositioning.captureAuthorization, undefined);
});

test("failed front never restores; restore failure preserves front and retry is guarded, bounded, and idempotent", async () => {
  const runner = { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } };
  const failedWarm = makeFakeWarmRunner({ captureError: new Error("front capture failed") });
  let failedRestoreWrites = 0;
  const failed = new AiGraderLocalStationBridgeService(realConfig({
    outputDir: outputDir(`front-no-restore-${Date.now()}`),
  }), runner, failedWarm.runner, {
    async writeLightingFrames(frames) {
      if (frames.length > 3) failedRestoreWrites += 1;
      return frames.map(() => ({ responseKind: "ack", ok: true }));
    },
  });
  await failed.action("start-session", { captureProfile: "full_forensic" });
  await failed.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await failed.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await assert.rejects(() => failed.action("capture-front", manualCaptureRequest()), /front capture failed/);
  assert.equal(failed.status().outputs.frontPackageDir, undefined);
  assert.equal(failed.status().liveLighting.backPositioning.attemptCount, 0);
  assert.equal(failed.status().liveLighting.backPositioning.events.some((event) => event.type.startsWith("restore_")), false);
  assert.equal(failedRestoreWrites, 0);

  let failRestore = true;
  let restoreWrites = 0;
  const service = new AiGraderLocalStationBridgeService(realConfig({
    outputDir: outputDir(`restore-failure-${Date.now()}`),
  }), runner, makeFakeWarmRunner().runner, {
    async writeLightingFrames(frames) {
      const isRestore = frames.length > 3;
      if (isRestore) {
        restoreWrites += 1;
        if (failRestore) {
          throw new Error("Timed out at http://169.254.191.156/C:\\private\\profile.json token=do-not-log");
        }
      }
      return frames.map(() => ({ responseKind: "ack", ok: true }));
    },
  });
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("accept-profile", {
    acceptedProfile: { dutyPercent: 1.7, exposureUs: 46000, gain: 0, channels: [2, 4, 6, 8] },
  });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const front = await service.action("capture-front", manualCaptureRequest());
  assert.ok(front.outputs.frontPackageDir);
  assert.equal(front.currentStep, "prompt_flip_card");
  assert.equal(front.liveLighting.applied.enabled, false);
  assert.equal(front.liveLighting.backPositioning.status, "failed");
  assert.equal(front.liveLighting.backPositioning.captureReady, false);
  assert.equal(front.previewStatus.positioningLightReady, false);
  assert.equal(front.sessionManifest.backCaptured, false);
  assert.equal(front.liveLighting.backPositioning.lastError.code, "AI_GRADER_BACK_POSITIONING_RESTORE_FAILED");
  assert.doesNotMatch(front.liveLighting.backPositioning.lastError.message, /169\.254|private|do-not-log|token/i);
  const advisoryFlip = await service.action("confirm-flip", { confirmations: { flipComplete: true } });
  assert.equal(advisoryFlip.currentStep, "prompt_flip_card");
  assert.equal(advisoryFlip.liveLighting.backPositioning.captureAuthorization, undefined);

  failRestore = false;
  const retryAssertions = backPositioningRetryAssertions(service);
  const retried = await service.retryBackPositioningLight(retryAssertions);
  assert.equal(retried.status, "waiting_for_frame");
  assert.equal(retried.attemptCount, 2);
  assert.equal(restoreWrites, 2);
  const idempotent = await service.retryBackPositioningLight(retryAssertions);
  assert.equal(idempotent.attemptCount, 2);
  assert.equal(restoreWrites, 2);

  service.captureLock = { owner: "test-lock", acquiredAt: new Date().toISOString() };
  await assert.rejects(() => service.retryBackPositioningLight(retryAssertions), /capture lock|serialized capture transition/i);
  service.captureLock = undefined;
  service.activeQueueItemId = "test-queue-review";
  await assert.rejects(() => service.retryBackPositioningLight(retryAssertions), /queue item/i);
  service.activeQueueItemId = undefined;
  await service.safeOffLiveLightingForOperator("test cleanup");
});

test("retry route is token-gated, accepts no caller profile, and returns only accepted-profile status", async () => {
  const token = "local-positioning-retry-token";
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: token,
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: outputDir(`retry-route-${Date.now()}`),
  });
  const headers = {
    Origin: "https://collect.tenkings.co",
    "x-ai-grader-station-token": token,
    "content-type": "application/json",
  };
  const post = async (pathName, body, requestHeaders = headers) => fetch(`${started.url}${pathName}`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
  try {
    const unauthorized = await fetch(`${started.url}/lighting/retry-back-positioning`, {
      method: "POST",
      headers: {
      Origin: "https://collect.tenkings.co",
      },
    });
    assert.equal(unauthorized.status, 401);
    await unauthorized.text();
    assert.equal((await post("/actions/start-session", { captureProfile: "full_forensic" })).status, 200);
    assert.equal((await post("/actions/confirm-light-idle-off", { confirmations: { lightIdleOff: true } })).status, 200);
    assert.equal((await post("/actions/confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } })).status, 200);
    assert.equal((await post("/actions/capture-front", manualCaptureRequest())).status, 200);
    const station = (await (await fetch(`${started.url}/status`, { headers })).json()).result;
    const retryHeaders = {
      ...headers,
      "x-ai-grader-session-id": station.sessionId,
      "x-ai-grader-preview-side": "back",
      "x-ai-grader-preview-epoch": station.previewStatus.sideEpoch,
    };
    const missingBinding = await fetch(`${started.url}/lighting/retry-back-positioning`, { method: "POST", headers });
    assert.equal(missingBinding.status, 400);
    assert.match(await missingBinding.text(), /session.*side.*epoch/i);
    const wrongBinding = await fetch(`${started.url}/lighting/retry-back-positioning`, {
      method: "POST",
      headers: { ...retryHeaders, "x-ai-grader-preview-epoch": "obsolete-epoch" },
    });
    assert.equal(wrongBinding.status, 400);
    assert.match(await wrongBinding.text(), /obsolete/i);

    const injected = await fetch(`${started.url}/lighting/retry-back-positioning`, {
      method: "POST",
      headers: retryHeaders,
      body: JSON.stringify({ dutyPercent: 5, channels: [1], host: "example.invalid", path: "C:\\private" }),
    });
    assert.equal(injected.status, 400);
    assert.match(await injected.text(), /accepts no browser hardware/i);

    const retry = await fetch(`${started.url}/lighting/retry-back-positioning`, { method: "POST", headers: retryHeaders });
    assert.equal(retry.status, 200);
    const payload = await retry.json();
    assert.equal(payload.operation, "lighting-retry-back-positioning");
    assert.equal(payload.result.status, "waiting_for_frame");
    assert.equal(payload.result.captureReady, false);
    assert.equal(payload.result.positioningLightReady, false);
    assert.equal(payload.result.appliedEnabled, true);
    assert.equal(payload.result.dutyPercent, 1.2);
    assert.deepEqual(payload.result.channels, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(Object.keys(payload.result).sort(), [
      "appliedEnabled",
      "attemptCount",
      "captureReady",
      "channels",
      "dutyPercent",
      "firstFrameGraceMs",
      "positioningLightReady",
      "profileIdentity",
      "sessionId",
      "sideEpoch",
      "status",
    ]);
    assert.doesNotMatch(JSON.stringify(payload.result), /example\.invalid|C:\\private/i);

    const disconnected = await new Promise((resolve, reject) => {
      let settled = false;
      const request = http.request(`${started.url}/preview/stream`, { headers }, (response) => {
        assert.equal(response.statusCode, 200);
        assert.ok(response.headers["x-ai-grader-session-id"]);
        assert.equal(response.headers["x-ai-grader-preview-side"], "back");
        assert.ok(response.headers["x-ai-grader-preview-epoch"]);
        assert.ok(response.headers["x-ai-grader-frame-id"]);
        response.once("data", () => {
          settled = true;
          response.destroy();
          request.destroy();
          resolve(true);
        });
      });
      request.on("error", (error) => {
        if (!settled) reject(error);
      });
      request.end();
    });
    assert.equal(disconnected, true);
    const safelyDisconnected = await waitForAsync(async () => {
      const response = await fetch(`${started.url}/lighting/status`, { headers });
      const status = (await response.json()).result;
      return status.applied.enabled === false && status.backPositioning.status === "safe_off"
        ? status
        : undefined;
    }, "preview disconnect did not safe-off back positioning light");
    assert.equal(safelyDisconnected.applied.enabled, false);

    const restoredAgain = await fetch(`${started.url}/lighting/retry-back-positioning`, { method: "POST", headers: retryHeaders });
    assert.equal(restoredAgain.status, 200);
    const cancelled = await post("/actions/cancel-session", {});
    assert.equal(cancelled.status, 200);
    const cancelledPayload = await cancelled.json();
    assert.equal(cancelledPayload.result.liveLighting.applied.enabled, false);
    assert.equal(cancelledPayload.result.warmRunnerStatus.status, "cancelled");
  } finally {
    if (typeof started.server.closeAllConnections === "function") started.server.closeAllConnections();
    await closeServer(started.server);
  }
});

test("back positioning requires a current frame, heartbeat cannot outlive it, and side epochs reject late front work", async () => {
  const service = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`epoch-heartbeat-${Date.now()}`),
  }));
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await service.action("capture-front", manualCaptureRequest());
  const positioned = service.status();
  const backEpoch = positioned.previewStatus.sideEpoch;
  assert.equal(positioned.previewStatus.activeSide, "back");
  assert.equal(positioned.previewStatus.latestFrameId, undefined);
  assert.equal(positioned.previewStatus.positioningLightReady, false);
  assert.equal(positioned.previewStatus.cardGeometry.back, undefined);
  const graceExpiry = positioned.liveLighting.watchdog.expiresAt;
  await service.heartbeatLiveLighting("first-frame grace heartbeat");
  assert.equal(service.status().liveLighting.watchdog.expiresAt, graceExpiry);
  assert.equal(service.notePreviewFrame(1, {
    sessionId: positioned.sessionId,
    side: "front",
    sideEpoch: positioned.previewStatus.cardGeometry.front?.sideEpoch ?? "front-old",
  }, "late-front-frame"), false);
  assert.equal(service.status().previewStatus.latestFrameId, undefined);

  noteFreshBackPreviewFrame(service, 1);
  const live = service.status();
  assert.equal(live.liveLighting.backPositioning.status, "ready");
  assert.equal(live.previewStatus.sideEpoch, backEpoch);
  const previousExpiry = live.liveLighting.watchdog.expiresAt;
  await service.heartbeatLiveLighting("fresh-frame heartbeat");
  assert.ok(Date.parse(service.status().liveLighting.watchdog.expiresAt) >= Date.parse(previousExpiry));

  service.manifest.previewStatus.lastFrameAt = new Date(Date.now() - 5000).toISOString();
  service.manifest.liveLighting.backPositioning.firstFrameGraceExpiresAt = new Date(Date.now() - 1).toISOString();
  await service.heartbeatLiveLighting("stale-frame heartbeat");
  const stale = service.status();
  assert.equal(stale.liveLighting.applied.enabled, false);
  assert.equal(stale.liveLighting.backPositioning.status, "failed");
  assert.equal(stale.previewStatus.positioningLightReady, false);
  assert.equal(stale.liveLighting.backPositioning.lastError.code, "AI_GRADER_BACK_PREVIEW_FRAME_REQUIRED");
});

test("front-to-back side epoch rejects an in-flight old detector result and binds new geometry only to back", async () => {
  const service = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`late-detector-epoch-${Date.now()}`),
  }));
  await service.action("start-session", { captureProfile: "full_forensic" });
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1260">
      <rect width="900" height="1260" fill="#17191d"/>
      <rect x="198" y="277" width="504" height="706" fill="#f2f0e9"/>
    </svg>
  `);
  const jpeg = await sharp(svg).jpeg({ quality: 90 }).toBuffer();
  const front = service.status();
  const oldBinding = {
    sessionId: front.sessionId,
    side: "front",
    sideEpoch: front.previewStatus.sideEpoch,
  };
  service.queuePreviewGeometryAnalysis(
    jpeg,
    1,
    new Date().toISOString(),
    "bridge_received",
    "old-front-frame",
    oldBinding
  );
  service.manifest.currentStep = "prompt_flip_card";
  service.transitionPreviewSide("back", { preserveFrontGeometry: true });
  await waitFor(() => service.previewGeometryAnalysisInFlight === false, "old detector work did not settle");
  assert.equal(service.status().previewStatus.cardGeometry.front, undefined);
  assert.equal(service.status().previewStatus.cardGeometry.back, undefined);
  assert.equal(service.notePreviewFrame(2, oldBinding, "late-old-front-frame"), false);

  const back = service.status();
  const backBinding = {
    sessionId: back.sessionId,
    side: "back",
    sideEpoch: back.previewStatus.sideEpoch,
  };
  service.queuePreviewGeometryAnalysis(
    jpeg,
    2,
    new Date().toISOString(),
    "bridge_received",
    "new-back-frame",
    backBinding
  );
  const analyzed = await waitFor(
    () => service.status().previewStatus.cardGeometry.back?.sourceFrameId === "new-back-frame"
      ? service.status()
      : undefined,
    "new back detector work did not bind to the back epoch"
  );
  assert.equal(analyzed.previewStatus.cardGeometry.back.sessionId, back.sessionId);
  assert.equal(analyzed.previewStatus.cardGeometry.back.sideEpoch, back.previewStatus.sideEpoch);
  assert.equal(analyzed.previewStatus.cardGeometry.back.side, "back");
});

test("first-frame watchdog and failed preview-loss safe-off both fail closed", async () => {
  const watchdog = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`first-frame-watchdog-${Date.now()}`),
  }));
  await watchdog.action("start-session", { captureProfile: "full_forensic" });
  await watchdog.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await watchdog.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await watchdog.action("capture-front", manualCaptureRequest());
  assert.equal(watchdog.status().liveLighting.backPositioning.status, "waiting_for_frame");
  await watchdog.handleLiveLightingWatchdogExpiry("deterministic first-frame grace test");
  assert.equal(watchdog.status().liveLighting.applied.enabled, false);
  assert.equal(watchdog.status().liveLighting.backPositioning.status, "failed");
  assert.equal(watchdog.status().liveLighting.backPositioning.lastError.code, "AI_GRADER_BACK_PREVIEW_FRAME_REQUIRED");

  let failSafeOff = false;
  const disconnect = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`preview-loss-safeoff-failure-${Date.now()}`),
  }), undefined, undefined, {
    async writeLightingFrames(frames) {
      if (failSafeOff && frames.length <= 3) throw new Error("safe-off failed at C:\\private\\bridge token=do-not-log");
      return frames.map(() => ({ responseKind: "ack", ok: true }));
    },
  });
  await prepareBackPositioning(disconnect);
  failSafeOff = true;
  await assert.rejects(
    () => disconnect.safeOffAfterPreviewLoss("deterministic preview disconnect"),
    /safe-off failed/i,
  );
  const failed = disconnect.status();
  assert.equal(failed.liveLighting.status, "error");
  assert.equal(failed.liveLighting.applied.enabled, undefined);
  assert.equal(failed.liveLighting.backPositioning.status, "failed");
  assert.equal(failed.liveLighting.backPositioning.captureReady, false);
  assert.doesNotMatch(JSON.stringify(failed.liveLighting.backPositioning.lastError), /private|do-not-log|token/i);
  const rebound = disconnect.status();
  assert.equal(disconnect.notePreviewFrame(2, {
    sessionId: rebound.sessionId,
    side: "back",
    sideEpoch: rebound.previewStatus.sideEpoch,
  }, "test-back-frame-after-failed-safeoff"), true);
  assert.equal(disconnect.status().previewStatus.positioningLightReady, false);
  const advisory = await disconnect.action("confirm-flip", { confirmations: { flipComplete: true } });
  assert.equal(advisory.currentStep, "prompt_flip_card");
  assert.equal(advisory.liveLighting.backPositioning.captureAuthorization, undefined);
});

test("session replacement safe-offs before discarding illuminated state", async () => {
  const writes = [];
  const service = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`session-replacement-safeoff-${Date.now()}`),
  }), undefined, undefined, {
    async writeLightingFrames(frames) {
      writes.push(frames);
      return frames.map(() => ({ responseKind: "ack", ok: true }));
    },
  });
  const positioned = await prepareBackPositioning(service);
  const oldSessionId = positioned.sessionId;
  assert.equal(positioned.liveLighting.applied.enabled, true);
  const replacement = await service.action("start-session", { captureProfile: "full_forensic" });
  assert.notEqual(replacement.sessionId, oldSessionId);
  assert.equal(replacement.liveLighting.applied.enabled, false);
  assert.ok(writes.at(-1).length <= 3, "session replacement did not finish with an allowlisted safe-off write");
});

test("compatibility flip never authorizes capture and atomic assertions reject stale bindings", async () => {
  const service = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`back-auth-binding-${Date.now()}`),
  }));
  await prepareBackPositioning(service);
  const advisory = await service.action("confirm-flip", { confirmations: { flipComplete: true } });
  assert.equal(advisory.currentStep, "prompt_flip_card");
  assert.equal(advisory.liveLighting.backPositioning.captureAuthorization, undefined);

  await assert.rejects(
    () => service.acceptLiveLightingForCapture({ dutyPercent: 2, channels: [1] }),
    /disabled after front evidence/i
  );
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { expectedSessionId: "obsolete-session" })),
    /stale.*session.*epoch/i,
  );
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { expectedReportId: "obsolete-report" })),
    /stale.*session.*epoch/i,
  );
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { expectedSide: "front" })),
    /expectedSide must be back/i,
  );
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { expectedSideEpoch: "obsolete-epoch" })),
    /stale.*session.*epoch/i,
  );
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { expectedFrameId: "missing-frame" })),
    /exact retained frame/i,
  );
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { captureTriggerMode: "auto" })),
    /manual mode requires an explicit operator trigger/i,
  );
  await assert.rejects(
    () => service.action("capture-back", {
      ...atomicBackCaptureRequest(service),
      manualGeometryRect: MANUAL_GEOMETRY_RECT,
    }),
    /accepts only bounded/i,
  );
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { geometryCaptureMode: "detected_geometry" })),
    /current state is not_detected/i,
  );
  const observation = service.previewObservations.find((candidate) =>
    candidate.frameId === service.status().previewStatus.latestFrameId
  );
  assert.ok(observation?.geometry);
  const originalGeometry = structuredClone(observation.geometry);
  const readyShape = markReadyGeometry(service, "back");
  observation.geometry = { ...structuredClone(readyShape), placementState: "adjust_card" };
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { geometryCaptureMode: "detected_geometry" })),
    /current state is adjust_card/i,
  );
  observation.geometry = {
    ...structuredClone(readyShape),
    timestamp: new Date(Date.now() - 5000).toISOString(),
  };
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { geometryCaptureMode: "detected_geometry" })),
    /stale or future-dated/i,
  );
  observation.geometry = {
    ...structuredClone(readyShape),
    timestamp: new Date(Date.now() + 5000).toISOString(),
  };
  await assert.rejects(
    () => service.action("capture-back", atomicBackCaptureRequest(service, { geometryCaptureMode: "detected_geometry" })),
    /stale or future-dated/i,
  );
  observation.geometry = originalGeometry;
  service.manifest.previewStatus.cardGeometry.back = structuredClone(originalGeometry);
  const captured = await service.action("capture-back", atomicBackCaptureRequest(service));
  assert.equal(captured.sessionManifest.backCaptured, true);
  assert.equal(captured.geometryCaptureDecisions.back.mode, "manual_capture");
  assert.equal(captured.geometryCaptureDecisions.back.detectionUsed, false);
  assert.equal(captured.geometryCaptureDecisions.back.explicitOperatorAction, true);
});

test("lighting writes serialize and shutdown waits for the final safe-off", async () => {
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  const serialized = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`serialized-lighting-${Date.now()}`),
  }), undefined, undefined, {
    async writeLightingFrames(frames) {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeWrites -= 1;
      return frames.map(() => ({ responseKind: "ack", ok: true }));
    },
  });
  await serialized.action("start-session", { captureProfile: "full_forensic" });
  await Promise.all([
    serialized.applyLiveLighting({ enabled: true, dutyPercent: 1.2, channels: [1] }),
    serialized.safeOffLiveLightingForOperator("concurrent disconnect safe-off"),
  ]);
  assert.equal(maximumActiveWrites, 1);
  assert.equal(serialized.status().liveLighting.applied.enabled, false);

  let gate;
  const shutdown = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`shutdown-safeoff-await-${Date.now()}`),
  }), undefined, undefined, {
    async writeLightingFrames(frames) {
      if (gate) await gate.promise;
      return frames.map(() => ({ responseKind: "ack", ok: true }));
    },
  });
  await shutdown.action("start-session", { captureProfile: "full_forensic" });
  await shutdown.applyLiveLighting({ enabled: true, dutyPercent: 1.2, channels: [1] });
  gate = deferred();
  let shutdownSettled = false;
  const shutdownPromise = shutdown.shutdown("deterministic bridge shutdown").then(() => {
    shutdownSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownSettled, false);
  gate.resolve();
  await shutdownPromise;
  assert.equal(shutdownSettled, true);
  assert.equal(shutdown.status().liveLighting.applied.enabled, false);
});

test("cancel and end preserve physical-state unknown when the final controller acknowledgement fails", async () => {
  for (const action of ["cancel-session", "end-session"]) {
    const cleanupCalls = [];
    let failSafeOff = false;
    const service = new AiGraderLocalStationBridgeService(realConfig({
      outputDir: outputDir(`${action}-safeoff-fallback-${Date.now()}`),
    }), {
      async run(step) {
        cleanupCalls.push(step.id);
        return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
      },
    }, undefined, {
      async writeLightingFrames(frames) {
        if (failSafeOff && frames.length <= 3) throw new Error("direct safe-off failed at C:\\private\\light token=do-not-log");
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    });
    await service.action("start-session", { captureProfile: "full_forensic" });
    await service.applyLiveLighting({ enabled: true, dutyPercent: 1.2, channels: [1] });
    failSafeOff = true;
    await assert.rejects(() => service.action(action), /safe-off|physical state|Leimac/i);
    const status = service.status();
    assert.deepEqual(cleanupCalls, ["safe_off"]);
    assert.equal(status.currentStep, "safe_off_end_session");
    assert.equal(status.liveLighting.applied.enabled, undefined);
    assert.equal(status.liveLighting.physicalState.state, "physical_state_unknown");
    assert.equal(status.warmRunnerStatus.status, "failed");
    assert.doesNotMatch(JSON.stringify(status.warnings), /C:\\|private|do-not-log/i);
    const persisted = JSON.parse(fs.readFileSync(status.outputs.manifestPath, "utf8"));
    assert.equal(persisted.currentStep, "safe_off_end_session");
  }
});

test("real station bridge uses warm full forensic runner by default with fake runner", async () => {
  const calls = [];
  const warm = makeFakeWarmRunner();
  const runner = {
    async run(step) {
      calls.push(step);
      if (step.id === "operator_preview") {
        return {
          stepId: step.id,
          ok: true,
          exitCode: 0,
          payload: {
            packageDir: "preview-package",
            acceptedLightingProfile: {
              selectedDutyPercent: 1.3,
              selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
            },
          },
        };
      }
      if (step.id === "unified_report") {
        assert.equal(step.args.includes("front-package"), true);
        assert.equal(step.args.includes("back-package"), true);
        return {
          stepId: step.id,
          ok: true,
          exitCode: 0,
          payload: { report: { packageDir: "unified-report", reportPath: "unified-report/provisional-diagnostic-report.html" } },
        };
      }
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const service = new AiGraderLocalStationBridgeService(realConfig(), runner, warm.runner);
  await service.action("start-session", { captureProfile: "full_forensic" });
  await assert.rejects(() => service.action("capture-front"), /idle\/off/);
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await service.action("launch-preview");
  await service.action("capture-front", manualCaptureRequest());
  noteFreshBackPreviewFrame(service);
  await service.action("capture-back", atomicBackCaptureRequest(service));
  const status = await service.action("run-diagnostics");

  assert.deepEqual(calls.map((step) => step.id), ["operator_preview", "safe_off", "safe_off", "unified_report"]);
  assert.deepEqual(warm.calls.map((call) => `${call.type}:${call.side}`), ["capture:front", "process:front", "capture:back", "process:back"]);
  assert.equal(calls.every((step) => step.command === "node"), true);
  assert.equal(status.hardwareActionsEnabled, true);
  assert.equal(status.safety.hardwareAccessed, true);
  assert.equal(status.executionPath, "warm_full_forensic_runner");
  assert.equal(status.explicitColdDebugModeUsed, false);
  assert.equal(status.warmRunnerStatus.executionPath, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.explicitColdDebugModeUsed, false);
  assert.equal(status.outputs.unifiedReportPath, "unified-report/provisional-diagnostic-report.html");
  assert.equal(status.timingSummary.entries.some((entry) => entry.stepId === "operator_preview"), true);
  assert.equal(status.timingSummary.entries.some((entry) => entry.stepId === "capture_front"), true);
  assert.equal(status.timingSummary.entries.some((entry) => entry.stepId === "capture_back"), true);
  assert.equal(status.timingSummary.entries.some((entry) => entry.stepId === "unified_report"), true);
  assert.equal(status.timingSummary.entries.some((entry) => entry.category === "warm_runner"), true);
  assert.equal(status.timingSummary.executionPath, "warm_full_forensic_runner");
  assert.equal(status.timingSummary.explicitColdDebugModeUsed, false);
  assert.equal(Object.prototype.hasOwnProperty.call(status.timingSummary, "fallbackUsed"), false);
  assert.equal(status.timingSummary.totalCommandMs >= 0, true);
  assert.equal(status.captureTiming.hardwareMeasurement, false);
  assert.equal(status.captureTiming.target.fiveSecondsPerSideProven, false);
  assert.equal(status.captureProfileGuard.fiveSecondTargetProven, false);
  assert.equal(status.captureTiming.phases.some((phase) => phase.id === "frame_capture" && phase.side === "front"), true);
  assert.equal(status.captureTiming.phases.some((phase) => phase.id === "crop_deskew" && phase.side === "back"), true);
});

test("capture timing includes validated browser click-to-action delay", async () => {
  const service = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`capture-trigger-at-${Date.now()}`),
  }));
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const captureTriggerAt = new Date(Date.now() - 1200).toISOString();
  markReadyGeometry(service, "front");
  service.manifest.previewStatus.cardGeometry.front.timestamp = new Date(Date.parse(captureTriggerAt) - 100).toISOString();
  const status = await service.action("capture-front", { captureTriggerMode: "auto", captureTriggerAt });
  const trigger = status.captureTiming.events.find((event) => event.id === "capture_trigger" && event.side === "front");
  assert.equal(trigger.at, captureTriggerAt);
  assert.equal(trigger.triggerMode, "auto");
  assert.equal(status.captureTiming.summary.totalFrontMs >= 1100, true);
  assert.equal(status.captureTiming.target.fiveSecondsPerSideProven, false);

  const futureService = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`capture-trigger-future-${Date.now()}`),
  }));
  await futureService.action("start-session", { captureProfile: "full_forensic" });
  await futureService.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await futureService.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const futureTriggerAt = new Date(Date.now() + 2000).toISOString();
  const futureStatus = await futureService.action("capture-front", manualCaptureRequest({ captureTriggerAt: futureTriggerAt }));
  const clamped = futureStatus.captureTiming.events.find((event) => event.id === "capture_trigger" && event.side === "front");
  assert.notEqual(clamped.at, futureTriggerAt);
  assert.equal(Date.parse(clamped.at) <= Date.now(), true);
});

test("rapid capture overlaps front processing with back positioning and isolates the next card", async () => {
  const dir = outputDir(`rapid-overlap-${Date.now()}`);
  const frontProcessing = deferred();
  const warm = makeFakeWarmRunner({
    async processDelay(batch) {
      if (batch.side === "front") await frontProcessing.promise;
    },
  });
  const runner = {
    async run(step) {
      if (step.id === "unified_report") {
        return {
          stepId: step.id,
          ok: true,
          exitCode: 0,
          payload: {
            report: {
              packageDir: path.join(dir, "unified-report"),
              reportPath: path.join(dir, "unified-report", "provisional-diagnostic-report.html"),
            },
          },
        };
      }
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const config = realConfig({ outputDir: dir, reportBundleOutputDir: path.join(dir, "report-bundles") });
  const service = new AiGraderLocalStationBridgeService(config, runner, warm.runner);

  await service.action("configure-rapid-capture", { rapidCaptureEnabled: true });
  let status = await service.action("start-session", { captureProfile: "full_forensic" });
  const firstSessionId = status.sessionId;
  const firstManifestPath = status.outputs.manifestPath;
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });

  status = await service.action("capture-front", manualCaptureRequest());
  assert.equal(status.rapidCapture.workflowState, "back_positioning");
  assert.deepEqual(
    status.rapidCapture.workflowHistory.slice(-3).map((event) => event.state),
    ["front_captured", "front_processing", "back_positioning"]
  );
  assert.equal(warm.calls.some((call) => call.type === "process" && call.side === "front"), true);

  noteFreshBackPreviewFrame(service);
  markReadyGeometry(service, "back");
  status = await service.action("capture-back", atomicBackCaptureRequest(service, { geometryCaptureMode: "detected_geometry" }));
  assert.equal(status.rapidCapture.workflowState, "back_captured");
  assert.equal(status.sessionManifest.backCaptured, true);
  assert.equal(status.warmRunnerStatus.queues.processing.find((phase) => phase.id === "process_front_artifacts")?.status, "active");

  status = await service.action("queue-current-card");
  assert.notEqual(status.sessionId, firstSessionId);
  assert.equal(status.outputs.frontPackageDir, undefined);
  assert.equal(status.outputs.backPackageDir, undefined);
  assert.equal(status.outputs.unifiedReportPath, undefined);
  assert.equal(status.confirmations.lightIdleOff, false);
  assert.equal(status.confirmations.fixtureRulersVisible, false);
  assert.equal(status.confirmations.flipComplete, false);
  assert.deepEqual(status.commandResults, []);
  assert.deepEqual(status.rapidCapture.workflowHistory, []);
  assert.equal(status.rapidCaptureQueue.items.length, 1);
  assert.equal(status.rapidCaptureQueue.items[0].state, "finalizing");
  assert.equal(status.rapidCaptureQueue.items[0].manifestPath, undefined);
  assert.equal(status.rapidCaptureQueue.items[0].humanConfirmationRequired, true);
  assert.equal(status.rapidCaptureQueue.items[0].autoConfirmed, false);
  assert.equal(status.rapidCaptureQueue.items[0].autoPublished, false);

  const safelyQueuedManifest = JSON.parse(fs.readFileSync(firstManifestPath, "utf8"));
  assert.equal(safelyQueuedManifest.sessionId, firstSessionId);
  assert.ok(safelyQueuedManifest.outputs.frontPackageDir);
  assert.ok(safelyQueuedManifest.outputs.backPackageDir);
  assert.equal(safelyQueuedManifest.rapidCapture.workflowState, "finalizing");

  frontProcessing.resolve();
  const completed = await waitFor(
    () => service.status().rapidCaptureQueue.items.find((item) => item.state === "report_ready_needs_confirm"),
    "rapid queue item did not complete background finalization"
  );
  assert.equal(completed.sessionId, firstSessionId);
  assert.equal(service.status().sessionId, status.sessionId);
  assert.equal(service.status().outputs.frontPackageDir, undefined);

  const completedManifest = await waitFor(() => {
    try {
      const persisted = JSON.parse(fs.readFileSync(firstManifestPath, "utf8"));
      return typeof persisted.captureTiming?.summary?.reportReadyTotalMs === "number" ? persisted : undefined;
    } catch {
      return undefined;
    }
  }, "completed rapid manifest timing was not durably persisted");
  assert.equal(completedManifest.captureTiming.schemaVersion, "ten-kings-ai-grader-capture-timing-v1");
  assert.equal(completedManifest.captureTiming.events.find((event) => event.id === "capture_trigger" && event.side === "front")?.triggerMode, "operator");
  assert.equal(completedManifest.captureTiming.events.find((event) => event.id === "capture_trigger" && event.side === "back")?.triggerMode, "auto");
  assert.equal(completedManifest.captureTiming.summary.frontProcessingOverlappedFlip, true);
  assert.equal(completedManifest.captureTiming.summary.totalCardMs <= completedManifest.captureTiming.summary.reportReadyTotalMs, true);
  assert.equal(completedManifest.captureTiming.target.fiveSecondsPerSideProven, false);
  assert.equal(completedManifest.captureProfileGuard.fiveSecondTargetProven, false);
  assert.equal(completedManifest.captureTiming.phases.some((phase) => phase.id === "file_writes" && phase.side === "front"), true);
  const rapidBundle = JSON.parse(fs.readFileSync(completedManifest.outputs.reportBundlePath, "utf8"));
  assert.deepEqual(rapidBundle.captureTiming, completedManifest.captureTiming);
  assert.deepEqual(rapidBundle.geometryCaptureDecisions, completedManifest.geometryCaptureDecisions);
  assert.doesNotMatch(JSON.stringify(rapidBundle.captureTiming), /C:\\|localhost|stationToken|x-amz|data:image/i);
  assert.doesNotMatch(JSON.stringify(rapidBundle.geometryCaptureDecisions), /C:\\|localhost|stationToken|x-amz|data:image/i);

  const queuePath = path.join(dir, "rapid-capture-queue.json");
  const persistedQueue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  assert.equal(persistedQueue.items[0].state, "report_ready_needs_confirm");
  assert.equal(persistedQueue.items[0].sessionId, firstSessionId);
});

test("persisted rapid queue activation still requires explicit human confirm and publish actions", async () => {
  const dir = outputDir(`rapid-persistence-${Date.now()}`);
  const warm = makeFakeWarmRunner();
  const runner = {
    async run(step) {
      if (step.id === "unified_report") {
        return {
          stepId: step.id,
          ok: true,
          exitCode: 0,
          payload: {
            report: {
              packageDir: path.join(dir, "unified-report"),
              reportPath: path.join(dir, "unified-report", "provisional-diagnostic-report.html"),
            },
          },
        };
      }
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const config = realConfig({ outputDir: dir, reportBundleOutputDir: path.join(dir, "report-bundles") });
  const producer = new AiGraderLocalStationBridgeService(config, runner, warm.runner);
  await producer.action("configure-rapid-capture", { rapidCaptureEnabled: true });
  await producer.action("start-session", { captureProfile: "full_forensic" });
  await producer.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await producer.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await producer.action("capture-front", manualCaptureRequest());
  noteFreshBackPreviewFrame(producer);
  await producer.action("capture-back", atomicBackCaptureRequest(producer));
  await producer.action("queue-current-card");
  const completed = await waitFor(
    () => producer.status().rapidCaptureQueue.items.find((item) => item.state === "report_ready_needs_confirm"),
    "rapid queue item was not persisted as ready"
  );

  const activationToken = "rapid-preview-activation-token";
  const activationServer = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: activationToken,
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: dir,
    reportBundleOutputDir: path.join(dir, "report-bundles"),
  });
  const activationHeaders = {
    Origin: "https://collect.tenkings.co",
    "x-ai-grader-station-token": activationToken,
    "content-type": "application/json",
  };
  let previewRequest;
  try {
    previewRequest = http.request(`${activationServer.url}/preview/stream`, { headers: activationHeaders }, (response) => {
      response.once("data", () => {});
    });
    previewRequest.on("error", () => {});
    previewRequest.end();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const activatedResponse = await fetch(`${activationServer.url}/actions/activate-queue-item`, {
      method: "POST",
      headers: activationHeaders,
      body: JSON.stringify({ queueItemId: completed.queueItemId }),
    });
    assert.equal(activatedResponse.status, 200);
    const activatedBody = await activatedResponse.json();
    assert.equal(activatedBody.result.reportId, completed.reportId);
    assert.equal(activatedBody.result.rapidCaptureQueue.activeQueueItemId, completed.queueItemId);
    const reopened = await fetch(`${activationServer.url}/preview/stream`, { headers: activationHeaders });
    assert.equal(reopened.status, 409);
    const reopenedBody = await reopened.json();
    assert.equal(reopenedBody.code, "AI_GRADER_QUEUE_REVIEW_ACTIVE");
    const rejectedCapture = await fetch(`${activationServer.url}/actions/capture-front`, {
      method: "POST",
      headers: activationHeaders,
      body: "{}",
    });
    assert.equal(rejectedCapture.status, 400);
    assert.match((await rejectedCapture.json()).message, /fresh station session/i);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const stable = await fetch(`${activationServer.url}/status`, { headers: activationHeaders }).then((response) => response.json());
    assert.equal(stable.result.reportId, completed.reportId);
    assert.deepEqual(stable.result.previewStatus.cardGeometry.front, activatedBody.result.previewStatus.cardGeometry.front);
  } finally {
    previewRequest?.destroy();
    if (typeof activationServer.server.closeAllConnections === "function") activationServer.server.closeAllConnections();
    await closeServer(activationServer.server);
  }

  const restarted = new AiGraderLocalStationBridgeService(config, runner, warm.runner);
  let status = restarted.status();
  const persisted = status.rapidCaptureQueue.items.find((item) => item.queueItemId === completed.queueItemId);
  assert.ok(persisted);
  assert.equal(persisted.state, "report_ready_needs_confirm");
  assert.equal(persisted.autoConfirmed, false);
  assert.equal(persisted.autoPublished, false);

  status = await restarted.action("activate-queue-item", { queueItemId: completed.queueItemId });
  assert.equal(status.reportId, completed.reportId);
  assert.equal(status.rapidCapture.workflowState, "report_ready_needs_confirm");
  assert.equal(status.rapidCaptureQueue.items.find((item) => item.queueItemId === completed.queueItemId).state, "report_ready_needs_confirm");

  status = await restarted.action("calculate-final-grade", {
    operatorId: "mark",
    warningsAccepted: true,
    overrideReason: "Explicit rapid queue confirmation test.",
  });
  assert.equal(status.rapidCapture.workflowState, "confirmed_needs_publish");
  assert.equal(status.rapidCaptureQueue.items.find((item) => item.queueItemId === completed.queueItemId).state, "confirmed_needs_publish");

  status = await restarted.action("publish-report", {
    operatorId: "mark",
    warningsAccepted: true,
    overrideReason: "Explicit rapid queue publish test.",
  });
  assert.equal(status.rapidCapture.workflowState, "published");
  assert.equal(status.rapidCaptureQueue.items.find((item) => item.queueItemId === completed.queueItemId).state, "published");
});

test("CPU-busy worker-thread processing leaves preview, EOF recovery, disconnect cleanup, heartbeat, and watchdog live", async () => {
  const workerStarted = deferred();
  const detectorInputs = [];
  let busyWorker;
  const warm = makeFakeWarmRunner({
    async processDelay(batch) {
      if (batch.side !== "front") return;
      await new Promise((resolve, reject) => {
        busyWorker = new Worker(`
          const { parentPort } = require("node:worker_threads");
          const deadline = Date.now() + 3500;
          let checksum = 0;
          while (Date.now() < deadline) checksum = (checksum + 1) % 1000003;
          parentPort.postMessage(checksum);
        `, { eval: true });
        workerStarted.resolve();
        busyWorker.once("message", resolve);
        busyWorker.once("error", reject);
        busyWorker.once("exit", (code) => {
          if (code !== 0) reject(new Error(`CPU-busy worker exited with ${code}.`));
        });
      });
    },
  });
  const service = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`worker-preview-liveness-${Date.now()}`) }),
    { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } },
    warm.runner,
    {
      async detectPreviewCardGeometry(input) {
        detectorInputs.push(input);
        return detectedPreviewGeometry(input);
      },
    },
  );
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const positioned = await service.action("capture-front", manualCaptureRequest());
  await workerStarted.promise;

  assert.equal(positioned.currentStep, "prompt_flip_card");
  assert.equal(positioned.liveLighting.backPositioning.firstFrameGraceMs, 6000);
  assert.ok(Date.parse(positioned.liveLighting.backPositioning.firstFrameGraceExpiresAt) > Date.now());
  assert.equal(warm.lifecycle.active, 1);
  assert.equal(service.warmProcessingJobs.size, 1);
  const processCall = warm.calls.find((call) => call.type === "process" && call.side === "front");
  assert.equal(processCall.context.sessionId, positioned.sessionId);
  assert.match(processCall.context.requestId, /^fixed-rig-processing-/);

  const graceExpiry = service.status().liveLighting.watchdog.expiresAt;
  await service.heartbeatLiveLighting("worker first-frame grace heartbeat");
  assert.equal(service.status().liveLighting.watchdog.expiresAt, graceExpiry, "heartbeat extended first-frame grace without a frame");

  const eventLoopTurn = deferred();
  setImmediate(eventLoopTurn.resolve);
  await eventLoopTurn.promise;
  assert.equal(warm.lifecycle.active, 1, "pending processing unexpectedly blocked or completed on the bridge thread");

  const binding = {
    sessionId: positioned.sessionId,
    side: "back",
    sideEpoch: positioned.previewStatus.sideEpoch,
  };
  const frameAt = new Date().toISOString();
  assert.equal(service.notePreviewFrame(238, binding, "worker-live-back-frame", frameAt), true);
  service.queuePreviewGeometryAnalysis(
    PNG_BYTES,
    238,
    frameAt,
    "preview_capture_header",
    "worker-live-back-frame",
    binding,
  );
  const analyzed = await waitFor(
    () => service.status().previewStatus.cardGeometry.back?.sourceFrameId === "worker-live-back-frame"
      ? service.status()
      : undefined,
    "fast live-preview geometry did not bind while captured processing remained pending",
  );
  assert.equal(detectorInputs.length, 1);
  assert.equal(detectorInputs[0].detectionPolicy, "live_preview_fast");
  assert.equal(detectorInputs[0].sourceFrameId, "worker-live-back-frame");
  assert.equal(analyzed.previewStatus.cardGeometry.back.side, "back");
  assert.equal(analyzed.previewStatus.cardGeometry.back.sessionId, positioned.sessionId);
  assert.equal(analyzed.previewStatus.cardGeometry.back.sideEpoch, positioned.previewStatus.sideEpoch);
  assert.equal(analyzed.previewStatus.positioningLightReady, true);

  service.manifest.previewStatus.lastFrameAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(service.backPositioningCaptureReady(), true, "a frame inside the two-second freshness window was rejected");
  service.manifest.previewStatus.lastFrameAt = new Date(Date.now() - 3000).toISOString();
  assert.equal(service.backPositioningCaptureReady(), false, "a frame beyond the two-second freshness window remained capture-ready");
  service.manifest.previewStatus.lastFrameAt = new Date().toISOString();
  const beforeFreshHeartbeat = service.status().liveLighting.watchdog.expiresAt;
  await service.heartbeatLiveLighting("worker liveness heartbeat");
  assert.equal(service.status().liveLighting.physicalState.state, "positioning_light_verified");
  assert.ok(Date.parse(service.status().liveLighting.watchdog.expiresAt) >= Date.parse(beforeFreshHeartbeat));
  assert.equal(warm.lifecycle.active, 1);

  await service.safeOffAfterPreviewLoss("unexpected clean EOF while processing worker remained busy");
  const eofSafe = service.status();
  assert.equal(eofSafe.liveLighting.physicalState.state, "safe_off_verified");
  assert.equal(eofSafe.liveLighting.applied.enabled, false);
  assert.equal(warm.lifecycle.active, 1, "unexpected EOF cleanup waited for worker completion");

  const eofAttemptCount = eofSafe.liveLighting.backPositioning.attemptCount;
  const reconnected = await service.retryBackPositioningLight(backPositioningRetryAssertions(service));
  assert.equal(reconnected.status, "waiting_for_frame");
  assert.equal(reconnected.attemptCount, eofAttemptCount + 1, "unexpected EOF recovery started more than one restore");
  assert.equal(warm.lifecycle.active, 1, "reconnect recovery waited for worker completion");
  noteFreshBackPreviewFrame(service, 239);
  assert.equal(service.status().liveLighting.physicalState.state, "positioning_light_verified");

  await service.safeOffLiveLightingForOperator("page disconnect while processing worker remained busy");
  const disconnected = service.status();
  assert.equal(disconnected.liveLighting.physicalState.state, "safe_off_verified");
  assert.equal(disconnected.liveLighting.applied.enabled, false);
  assert.equal(warm.lifecycle.active, 1, "page-disconnect cleanup waited for worker completion");

  const restarted = await service.retryBackPositioningLight(backPositioningRetryAssertions(service));
  assert.equal(restarted.status, "waiting_for_frame");
  const restartedGraceExpiry = service.status().liveLighting.watchdog.expiresAt;
  await service.heartbeatLiveLighting("restarted first-frame grace heartbeat");
  assert.equal(service.status().liveLighting.watchdog.expiresAt, restartedGraceExpiry, "restarted grace was extended without a fresh frame");
  assert.equal(warm.lifecycle.active, 1);

  await service.handleLiveLightingWatchdogExpiry("worker liveness deterministic watchdog");
  const safe = service.status();
  assert.equal(safe.liveLighting.physicalState.state, "safe_off_verified");
  assert.equal(safe.liveLighting.applied.enabled, false);
  assert.equal(safe.liveLighting.backPositioning.captureReady, false);
  assert.equal(warm.lifecycle.active, 1, "watchdog cleanup incorrectly depended on worker completion");

  await waitFor(() => warm.lifecycle.active === 0 && service.warmProcessingJobs.size === 0, "processing job did not settle and leave the bounded bridge map");
  assert.ok(busyWorker, "CPU-busy worker thread was never created");
  await service.shutdown("worker liveness test complete");
  assert.equal(warm.lifecycle.closed, true);
  assert.equal(warm.lifecycleCalls.filter((call) => call.type === "shutdown").length, 1);
});

test("processing worker identity failures are redacted terminal failures with verified cleanup", async () => {
  const cases = [
    {
      label: "request",
      options: { processingWorkerIdentity: (identity) => ({ ...identity, requestId: "wrong-request" }) },
    },
    {
      label: "session",
      options: { processingWorkerIdentity: (identity) => ({ ...identity, sessionId: "wrong-session" }) },
    },
    {
      label: "package",
      options: { processingWorkerIdentity: (identity) => ({ ...identity, packageId: "wrong-package" }) },
    },
    {
      label: "side",
      options: { processingWorkerIdentity: (identity) => ({ ...identity, side: "back" }) },
    },
    {
      label: "source-set",
      options: { processingWorkerIdentity: (identity) => ({ ...identity, sourceSetSha256: "invalid" }) },
    },
    {
      label: "mode",
      options: {
        processingWorkerIdentity(identity) {
          const { sourceSetSha256: _sourceSetSha256, ...withoutSource } = identity;
          return { ...withoutSource, mode: "explicit_manual_capture" };
        },
      },
    },
    { label: "result-package", options: { processedPackageId: "wrong-result-package" } },
    { label: "result-side", options: { processedSide: "back" } },
  ];

  for (const identityCase of cases) {
    const warm = makeFakeWarmRunner(identityCase.options);
    const service = new AiGraderLocalStationBridgeService(
      realConfig({ outputDir: outputDir(`worker-identity-${identityCase.label}-${Date.now()}`) }),
      { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } },
      warm.runner,
    );
    await service.action("start-session", { captureProfile: "full_forensic" });
    await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
    await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
    markReadyGeometry(service, "front");
    const captured = await service.action("capture-front");
    assert.ok(captured.outputs.frontPackageDir, `${identityCase.label}: raw front evidence was not preserved`);
    const failed = await waitFor(
      () => service.status().captureFailure?.stage === "warm_processing" ? service.status() : undefined,
      `${identityCase.label}: worker identity failure did not become terminal`,
    );
    assert.equal(failed.captureFailure.side, "front", identityCase.label);
    assert.equal(failed.captureFailure.retryRequired, true, identityCase.label);
    assert.match(failed.captureFailure.message, /identity|package|side|worker/i, identityCase.label);
    assert.equal(failed.liveLighting.physicalState.state, "safe_off_verified", identityCase.label);
    assert.equal(failed.liveLighting.applied.enabled, false, identityCase.label);
    assert.equal(failed.liveLighting.backPositioning.captureReady, false, identityCase.label);
    assert.equal(failed.previewStatus.status, "error", identityCase.label);
    assert.equal(failed.previewStatus.cameraOwnership, "released", identityCase.label);
    assert.equal(warm.calls.filter((call) => call.type === "capture").length, 1, identityCase.label);
    assert.equal(warm.lifecycleCalls.filter((call) => call.type === "cancel-session").length, 1, identityCase.label);
    assert.equal(service.warmProcessingJobs.size, 0, identityCase.label);
    assert.doesNotMatch(JSON.stringify(failed), /169\.254|C:\\\\private|token=|secret=/i, identityCase.label);
    await service.shutdown(`identity ${identityCase.label} test complete`);
  }
});

test("processing failure cleanup keeps missing safe-off acknowledgement physically unknown and visible", async () => {
  const processingGate = deferred();
  let failTerminalSafeOff = false;
  const warm = makeFakeWarmRunner({
    processError: new Error("captured processing failed at /private/worker endpoint=[::1]:3020 token=hidden"),
    processErrorSide: "front",
    async processDelay(batch) {
      if (batch.side === "front") await processingGate.promise;
    },
  });
  const service = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`worker-unknown-safeoff-${Date.now()}`) }),
    { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } },
    warm.runner,
    {
      async writeLightingFrames(frames) {
        if (failTerminalSafeOff && frames.length <= 3) {
          throw new Error("safe-off acknowledgement missing at http://169.254.4.4/private token=hidden");
        }
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    },
  );
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const positioned = await service.action("capture-front", manualCaptureRequest());
  assert.equal(positioned.liveLighting.physicalState.state, "positioning_light_verified");
  failTerminalSafeOff = true;
  processingGate.resolve();
  const failed = await waitFor(
    () => service.status().captureFailure?.stage === "warm_processing" && service.terminalLifecyclePending === 0
      ? service.status()
      : undefined,
    "processing failure cleanup did not settle",
  );
  assert.equal(failed.liveLighting.physicalState.state, "physical_state_unknown");
  assert.equal(failed.liveLighting.applied.enabled, undefined);
  assert.equal(failed.liveLighting.backPositioning.captureReady, false);
  assert.equal(failed.previewStatus.status, "error");
  assert.match(failed.previewStatus.lastError, /local endpoint|local path|redacted|acknowledgement/i);
  assert.doesNotMatch(JSON.stringify(failed), /169\.254\.4\.4|\/private\/worker|\[::1\]|token=hidden/i);
  const persisted = JSON.parse(fs.readFileSync(failed.outputs.manifestPath, "utf8"));
  assert.equal(persisted.liveLighting.physicalState.state, "physical_state_unknown");
  assert.doesNotMatch(JSON.stringify(persisted), /169\.254\.4\.4|\/private\/worker|\[::1\]|token=hidden/i);
  failTerminalSafeOff = false;
  await service.shutdown("processing unknown-state test complete");
});

test("terminal cancellation and shutdown each drain one pending processing job without a second failure lifecycle", async () => {
  const cancellationGate = deferred();
  const cancelledWarm = makeFakeWarmRunner({
    async processDelay(batch) {
      if (batch.side === "front") await cancellationGate.promise;
    },
    async cancelSession() {
      cancellationGate.reject(new Error("inert worker cancellation"));
    },
  });
  const cancelled = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`worker-terminal-cancel-${Date.now()}`) }),
    { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } },
    cancelledWarm.runner,
  );
  await cancelled.action("start-session", { captureProfile: "full_forensic" });
  await cancelled.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await cancelled.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await cancelled.action("capture-front", manualCaptureRequest());
  assert.equal(cancelledWarm.lifecycle.active, 1);
  const cancelledStatus = await cancelled.action("cancel-session");
  assert.equal(cancelledStatus.currentStep, "safe_off_end_session");
  assert.equal(cancelledStatus.warmRunnerStatus.status, "cancelled");
  assert.equal(cancelledStatus.captureFailure, undefined);
  assert.equal(cancelledStatus.liveLighting.physicalState.state, "safe_off_verified");
  assert.equal(cancelledWarm.lifecycle.active, 0);
  assert.equal(cancelled.warmProcessingJobs.size, 0);
  assert.equal(cancelledWarm.lifecycleCalls.filter((call) => call.type === "cancel-session").length, 1);
  assert.equal(
    cancelledStatus.warmRunnerStatus.queues.processing.some((phase) => phase.id === "process_front_artifacts" && phase.status === "cancelled"),
    true,
  );

  const shutdownGate = deferred();
  const shutdownWarm = makeFakeWarmRunner({
    async processDelay(batch) {
      if (batch.side === "front") await shutdownGate.promise;
    },
    async shutdownProcessingWorker() {
      shutdownGate.reject(new Error("inert worker shutdown"));
    },
  });
  const shutdown = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`worker-terminal-shutdown-${Date.now()}`) }),
    { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } },
    shutdownWarm.runner,
  );
  await shutdown.action("start-session", { captureProfile: "full_forensic" });
  await shutdown.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await shutdown.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await shutdown.action("capture-front", manualCaptureRequest());
  assert.equal(shutdownWarm.lifecycle.active, 1);
  await shutdown.shutdown("deterministic pending worker shutdown");
  const shutdownStatus = shutdown.status();
  assert.equal(shutdownWarm.lifecycle.active, 0);
  assert.equal(shutdownWarm.lifecycle.closed, true);
  assert.equal(shutdownWarm.lifecycleCalls.filter((call) => call.type === "shutdown").length, 1);
  assert.equal(shutdown.warmProcessingJobs.size, 0);
  assert.equal(shutdownStatus.captureFailure, undefined);
  assert.equal(shutdownStatus.liveLighting.physicalState.state, "safe_off_verified");
  assert.equal(
    shutdownStatus.warmRunnerStatus.queues.processing.some((phase) => phase.id === "process_front_artifacts" && phase.status === "cancelled"),
    true,
  );
});

test("session end, explicit safe-off, and non-rapid replacement reconcile pending worker sessions once", async () => {
  for (const terminalAction of ["end-session", "safe-off"]) {
    const gate = deferred();
    const warm = makeFakeWarmRunner({
      async processDelay(batch) {
        if (batch.side === "front") await gate.promise;
      },
      async cancelSession() {
        gate.reject(new Error(`inert ${terminalAction} cancellation`));
      },
    });
    const service = new AiGraderLocalStationBridgeService(
      realConfig({ outputDir: outputDir(`worker-${terminalAction}-${Date.now()}`) }),
      { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } },
      warm.runner,
    );
    await service.action("start-session", { captureProfile: "full_forensic" });
    await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
    await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
    await service.action("capture-front", manualCaptureRequest());
    const terminal = await service.action(terminalAction);
    assert.equal(terminal.currentStep, "safe_off_end_session", terminalAction);
    assert.equal(terminal.warmRunnerStatus.status, "complete", terminalAction);
    assert.equal(terminal.captureFailure, undefined, terminalAction);
    assert.equal(terminal.liveLighting.physicalState.state, "safe_off_verified", terminalAction);
    assert.equal(warm.lifecycleCalls.filter((call) => call.type === "cancel-session").length, 1, terminalAction);
    assert.equal(service.warmProcessingJobs.size, 0, terminalAction);
  }

  const replacementGate = deferred();
  const replacementWarm = makeFakeWarmRunner({
    async processDelay(batch) {
      if (batch.side === "front") await replacementGate.promise;
    },
    async cancelSession() {
      replacementGate.reject(new Error("inert replacement cancellation"));
    },
  });
  const replacement = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`worker-session-replacement-${Date.now()}`) }),
    { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } },
    replacementWarm.runner,
  );
  await replacement.action("start-session", { captureProfile: "full_forensic" });
  await replacement.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await replacement.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const oldSession = await replacement.action("capture-front", manualCaptureRequest());
  const fresh = await replacement.action("start-session", { captureProfile: "full_forensic" });
  assert.notEqual(fresh.sessionId, oldSession.sessionId);
  assert.equal(fresh.captureFailure, undefined);
  assert.equal(fresh.liveLighting.physicalState.state, "safe_off_verified");
  assert.equal(replacementWarm.lifecycleCalls.filter((call) => call.type === "cancel-session").length, 1);
  assert.equal(replacement.warmProcessingJobs.size, 0);
});

test("side processing failures are terminal and cannot be overwritten or queued", async () => {
  const runner = { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } };
  const prepare = async (service) => {
    await service.action("configure-rapid-capture", { rapidCaptureEnabled: true });
    await service.action("start-session", { captureProfile: "full_forensic" });
    await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
    await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  };

  const immediateWarm = makeFakeWarmRunner({ processError: new Error("front processing failed"), processErrorSide: "front" });
  const immediate = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`process-failure-immediate-${Date.now()}`) }),
    runner,
    immediateWarm.runner
  );
  await prepare(immediate);
  await immediate.action("capture-front", manualCaptureRequest());
  const immediateFailed = await waitFor(
    () => immediate.status().rapidCapture.workflowState === "failed" ? immediate.status() : undefined,
    "immediate processing failure did not become terminal"
  );
  assert.deepEqual(immediateFailed.captureFailure, {
    side: "front",
    stage: "warm_processing",
    message: "front processing failed",
    at: immediateFailed.captureFailure.at,
    retryRequired: true,
    automaticColdFallbackAttempted: false,
  });
  assert.equal(immediateFailed.rapidCapture.workflowHistory.some((event) => event.state === "back_positioning"), false);
  await assert.rejects(() => immediate.action("queue-current-card"), /failed processing state|front and back/i);
  await assert.rejects(() => immediate.action("run-diagnostics"), /processing failed/i);

  const delayedFailure = deferred();
  const delayedWarm = makeFakeWarmRunner({
    processError: new Error("delayed front processing failed"),
    processErrorSide: "front",
    async processDelay(batch) {
      if (batch.side === "front") await delayedFailure.promise;
    },
  });
  const delayed = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`process-failure-delayed-${Date.now()}`) }),
    runner,
    delayedWarm.runner
  );
  await prepare(delayed);
  const positioned = await delayed.action("capture-front", manualCaptureRequest());
  assert.equal(positioned.rapidCapture.workflowState, "back_positioning");
  delayedFailure.resolve();
  const delayedFailed = await waitFor(
    () => delayed.status().rapidCapture.workflowState === "failed" ? delayed.status() : undefined,
    "delayed processing failure did not become terminal"
  );
  assert.equal(delayedFailed.rapidCapture.workflowState, "failed");
  assert.deepEqual(delayedFailed.captureFailure, {
    side: "front",
    stage: "warm_processing",
    message: "delayed front processing failed",
    at: delayedFailed.captureFailure.at,
    retryRequired: true,
    automaticColdFallbackAttempted: false,
  });
  const persistedDelayedFailure = await waitFor(() => {
    try {
      const value = JSON.parse(fs.readFileSync(delayedFailed.outputs.manifestPath, "utf8"));
      return value.captureFailure?.stage === "warm_processing" ? value.captureFailure : undefined;
    } catch {
      return undefined;
    }
  }, "delayed processing failure was not persisted to the station manifest");
  assert.equal(persistedDelayedFailure.message, "delayed front processing failed");
  const delayedAdvisory = await delayed.action("confirm-flip", { confirmations: { flipComplete: true } });
  assert.equal(delayedAdvisory.currentStep, "prompt_flip_card");
  assert.equal(delayedAdvisory.liveLighting.backPositioning.captureAuthorization, undefined);
  await assert.rejects(
    () => delayed.action("capture-back", atomicBackCaptureRequest(delayed, { expectedFrameId: "failed-back-frame" })),
    /blocked after a capture or processing failure/i
  );
  assert.equal(delayedWarm.calls.some((call) => call.type === "capture" && call.side === "back"), false);
  await assert.rejects(() => delayed.action("queue-current-card"), /failed processing state|front and back/i);
  await assert.rejects(() => delayed.action("run-diagnostics"), /processing failed/i);
  const delayedRetry = await delayed.action("start-session", { captureProfile: "full_forensic" });
  assert.equal(delayedRetry.captureFailure, undefined);

  const backWarm = makeFakeWarmRunner({ processError: new Error("back processing failed"), processErrorSide: "back" });
  const back = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`process-failure-back-${Date.now()}`) }),
    runner,
    backWarm.runner
  );
  await prepare(back);
  await back.action("capture-front", manualCaptureRequest());
  noteFreshBackPreviewFrame(back);
  await back.action("capture-back", atomicBackCaptureRequest(back));
  const backFailed = await waitFor(
    () => back.status().rapidCapture.workflowState === "failed" ? back.status() : undefined,
    "back processing failure did not become terminal"
  );
  assert.deepEqual(backFailed.captureFailure, {
    side: "back",
    stage: "warm_processing",
    message: "back processing failed",
    at: backFailed.captureFailure.at,
    retryRequired: true,
    automaticColdFallbackAttempted: false,
  });
  assert.equal(backFailed.rapidCapture.workflowHistory.some((event) => event.state === "back_captured"), false);
  await waitFor(() => back.terminalLifecyclePending === 0, "back processing-failure cleanup did not settle");
  await assert.rejects(() => back.action("queue-current-card"), /failed processing state/i);
});

test("restart marks an interrupted rapid finalization as explicit retryable failure", async () => {
  const dir = outputDir(`rapid-restart-finalizing-${Date.now()}`);
  const processingGate = deferred();
  const warm = makeFakeWarmRunner({
    async processDelay(batch) {
      if (batch.side === "front") await processingGate.promise;
    },
  });
  const runner = {
    async run(step) {
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const config = realConfig({ outputDir: dir, reportBundleOutputDir: path.join(dir, "report-bundles") });
  const original = new AiGraderLocalStationBridgeService(config, runner, warm.runner);
  await original.action("configure-rapid-capture", { rapidCaptureEnabled: true });
  await original.action("start-session", { captureProfile: "full_forensic" });
  await original.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await original.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await original.action("capture-front", manualCaptureRequest());
  noteFreshBackPreviewFrame(original);
  await original.action("capture-back", atomicBackCaptureRequest(original));
  const queued = await original.action("queue-current-card");
  const queueItemId = queued.rapidCaptureQueue.items[0].queueItemId;
  assert.equal(queued.rapidCaptureQueue.items[0].state, "finalizing");

  const restarted = new AiGraderLocalStationBridgeService(config, runner, warm.runner);
  const failed = await waitFor(
    () => restarted.status().rapidCaptureQueue.items.find((item) => item.queueItemId === queueItemId && item.state === "failed"),
    "restarted bridge did not mark interrupted finalization retryable"
  );
  assert.match(failed.error, /retryable.*restarted/i);
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, "rapid-capture-queue.json"), "utf8"));
  assert.equal(persisted.items.find((item) => item.queueItemId === queueItemId).state, "failed");
});

test("cold command fallback requires explicit warm runner disable flag", async () => {
  const calls = [];
  const warm = makeFakeWarmRunner();
  const runner = {
    async run(step) {
      calls.push(step);
      if (step.id === "capture_front") {
        return { stepId: step.id, ok: true, exitCode: 0, payload: { packageDir: "front-package" } };
      }
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const service = new AiGraderLocalStationBridgeService(realConfig({
    outputDir: outputDir(`fallback-${Date.now()}`),
    warmRunnerDisabled: true,
  }), runner, warm.runner);

  let status = service.status();
  assert.equal(status.executionPath, "cold_command_fallback");
  assert.equal(status.explicitColdDebugModeUsed, true);
  assert.match(status.explicitColdDebugReason, /debug flag/i);
  assert.deepEqual(status.warmRunnerStatus.coldDebugMode, {
    configured: true,
    active: true,
    reason: "Warm runner disabled by explicit debug flag.",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(status, "fallbackUsed"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(status, "fallbackReason"), false);

  await assert.rejects(
    () => service.action("start-session", { captureProfile: "production_fast" }),
    /production_fast.*cold debug/i
  );
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  status = await service.action("capture-front", manualCaptureRequest());

  assert.deepEqual(calls.map((step) => step.id), ["capture_front", "safe_off"]);
  assert.deepEqual(warm.calls, []);
  assert.equal(status.executionPath, "cold_command_fallback");
  assert.equal(status.explicitColdDebugModeUsed, true);
  assert.equal(status.warmRunnerStatus.executionPath, "cold_command_fallback");
  assert.equal(status.warmRunnerStatus.explicitColdDebugModeUsed, true);
  assert.match(status.warmRunnerStatus.explicitColdDebugReason, /debug flag/i);
  assert.equal(status.timingSummary.executionPath, "cold_command_fallback");
  assert.equal(status.timingSummary.explicitColdDebugModeUsed, true);
  assert.match(status.timingSummary.targetInterCaptureNote, /does not count/i);
  const fallbackSessionManifest = JSON.parse(fs.readFileSync(status.outputs.manifestPath, "utf8"));
  assert.equal(fallbackSessionManifest.executionPath, "cold_command_fallback");
  assert.equal(fallbackSessionManifest.explicitColdDebugModeUsed, true);
  assert.match(fallbackSessionManifest.explicitColdDebugReason, /debug flag/i);
  assert.equal(Object.prototype.hasOwnProperty.call(fallbackSessionManifest, "fallbackUsed"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fallbackSessionManifest, "fallbackReason"), false);
  assert.equal(status.captureProfile, "full_forensic");
  assert.equal(status.captureTiming.hardwareMeasurement, false);
  assert.equal(status.captureProfileGuard.fiveSecondTargetProven, false);
});

test("warm runner capture lock blocks preview stream until capture releases", async () => {
  let releaseCapture;
  let captureStarted;
  const captureStartedPromise = new Promise((resolve) => {
    captureStarted = resolve;
  });
  const releaseCapturePromise = new Promise((resolve) => {
    releaseCapture = resolve;
  });
  const runner = {
    async run(step) {
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const warm = makeFakeWarmRunner({
    onCaptureStarted() {
      captureStarted();
    },
    async captureDelay() {
      await releaseCapturePromise;
    },
  });
  const token = "local-station-token-lock";
  const started = await startAiGraderLocalStationBridgeHttpServer({
    ...realConfig({
      stationToken: token,
      port: 0,
      outputDir: outputDir(`lock-${Date.now()}`),
      allowedOrigins: ["https://collect.tenkings.co"],
    }),
  }, {}, runner, warm.runner);
  const headers = {
    Origin: "https://collect.tenkings.co",
    "x-ai-grader-station-token": token,
    "content-type": "application/json",
  };
  const postAction = async (action, body = {}) => {
    const response = await fetch(`${started.url}/actions/${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? `action ${action} failed`);
    return payload.result;
  };

  try {
    await postAction("start-session", { captureProfile: "full_forensic" });
    await postAction("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
    await postAction("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
    const capturePromise = postAction("capture-front", manualCaptureRequest());
    await captureStartedPromise;

    const blockedPreview = await fetch(`${started.url}/preview/stream`, { headers });
    assert.equal(blockedPreview.status, 409);
    const blockedPayload = await blockedPreview.json();
    assert.equal(blockedPayload.code, "AI_GRADER_CAPTURE_LOCK_HELD");
    assert.equal(blockedPayload.result.status, "paused_for_capture");

    releaseCapture();
    const captureStatus = await capturePromise;
    assert.equal(captureStatus.warmRunnerStatus.captureLock.held, false);
    assert.equal(captureStatus.warmRunnerStatus.previewPolicy.holdActive, false);
    assert.ok(captureStatus.warmRunnerStatus.previewPolicy.lastHoldStartedAt);
  } finally {
    releaseCapture();
    if (typeof started.server.closeAllConnections === "function") {
      started.server.closeAllConnections();
    }
    await closeServer(started.server);
  }
});

test("front capture releases preview for flip/back positioning while back capture reacquires the forensic hold", async () => {
  const token = "local-station-token-full-forensic-hold";
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: token,
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: outputDir(`full-forensic-hold-${Date.now()}`),
  });
  const headers = {
    Origin: "https://collect.tenkings.co",
    "x-ai-grader-station-token": token,
    "content-type": "application/json",
  };
  const postAction = async (action, body = {}) => {
    const response = await fetch(`${started.url}/actions/${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? `action ${action} failed`);
    return payload.result;
  };
  const readOnePreviewFrame = async () => {
    const chunk = await new Promise((resolve, reject) => {
      let settled = false;
      const req = http.request(`${started.url}/preview/stream`, { headers }, (res) => {
        assert.equal(res.statusCode, 200);
        res.once("data", (data) => {
          settled = true;
          res.destroy();
          req.destroy();
          resolve(Buffer.from(data));
        });
      });
      req.on("error", (error) => {
        if (!settled) reject(error);
      });
      req.setTimeout(5000, () => {
        if (settled) return;
        settled = true;
        req.destroy();
        reject(new Error("Preview stream did not return a frame."));
      });
      req.end();
    });
    assert.match(chunk.toString("utf8"), /tenkings-ai-grader-preview/);
  };
  let activeReq;

  try {
    await postAction("start-session", { captureProfile: "full_forensic" });
    await postAction("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
    await postAction("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });

    const activeStreamClosed = new Promise((resolve, reject) => {
      let sawFrame = false;
      activeReq = http.request(`${started.url}/preview/stream`, { headers }, (res) => {
        assert.equal(res.statusCode, 200);
        res.once("data", () => {
          sawFrame = true;
        });
        res.once("close", () => {
          if (!sawFrame) reject(new Error("Preview closed before a frame was observed."));
          else resolve();
        });
      });
      activeReq.on("error", (error) => {
        if (!sawFrame) reject(error);
      });
      activeReq.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const frontStatus = await postAction("capture-front", manualCaptureRequest());
    assert.equal(frontStatus.currentStep, "prompt_flip_card");
    assert.equal(frontStatus.warmRunnerStatus.previewPolicy.holdActive, false);
    assert.equal(frontStatus.previewStatus.status, "paused_for_capture");
    assert.notEqual(frontStatus.previewStatus.cameraOwnership, "preview_stream");
    await activeStreamClosed;
    activeReq.destroy();

    const backFrameReady = new Promise((resolve, reject) => {
      activeReq = http.request(`${started.url}/preview/stream`, { headers }, (res) => {
        assert.equal(res.statusCode, 200);
        res.once("data", () => resolve());
      });
      activeReq.on("error", reject);
      activeReq.end();
    });
    await backFrameReady;
    const currentStatusResponse = await fetch(`${started.url}/status`, { headers });
    const currentStatus = (await currentStatusResponse.json()).result;
    const backStatus = await postAction("capture-back", {
      idempotencyKey: `http-manual-back-${Date.now()}`,
      expectedSessionId: currentStatus.sessionId,
      expectedReportId: currentStatus.reportId,
      expectedSide: "back",
      expectedSideEpoch: currentStatus.previewStatus.sideEpoch,
      expectedFrameId: currentStatus.previewStatus.latestFrameId,
      geometryCaptureMode: "manual_capture",
      captureTriggerMode: "operator",
    });
    assert.equal(backStatus.sessionManifest.backCaptured, true);
    assert.equal(backStatus.executionPath, "warm_full_forensic_runner");
    assert.equal(backStatus.explicitColdDebugModeUsed, false);
    assert.equal(backStatus.warmRunnerStatus.previewPolicy.holdActive, true);
    assert.notEqual(backStatus.previewStatus.cameraOwnership, "preview_stream");

    const reportStatus = await postAction("run-diagnostics");
    assert.equal(reportStatus.latestReport.exists, true);
    assert.equal(reportStatus.warmRunnerStatus.previewPolicy.holdActive, true);

    const ended = await postAction("end-session");
    assert.equal(ended.currentStep, "safe_off_end_session");
    assert.equal(ended.warmRunnerStatus.previewPolicy.holdActive, false);
    assert.ok(ended.warmRunnerStatus.previewPolicy.lastHoldReleasedAt);
    await readOnePreviewFrame();
  } finally {
    if (typeof activeReq?.destroy === "function") activeReq.destroy();
    if (typeof started.server.closeAllConnections === "function") {
      started.server.closeAllConnections();
    }
    await closeServer(started.server);
  }
});

test("warm runner runs safe-off cleanup on failure, cancellation, and session end", async () => {
  const failureCalls = [];
  const failureRunner = {
    async run(step) {
      failureCalls.push(step.id);
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const failureError = Object.assign(new Error("front boom"), {
    safeToFallback: true,
    capturesStarted: false,
  });
  const failureWarm = makeFakeWarmRunner({ captureError: failureError });
  const failureService = new AiGraderLocalStationBridgeService(realConfig({ outputDir: outputDir(`failure-${Date.now()}`) }), failureRunner, failureWarm.runner);
  await failureService.action("start-session", { captureProfile: "full_forensic" });
  await failureService.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await failureService.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });

  await assert.rejects(() => failureService.action("capture-front", manualCaptureRequest()), /front boom/);
  const failureStatus = failureService.status();
  assert.deepEqual(failureCalls, ["safe_off"]);
  assert.deepEqual(failureWarm.calls.map((call) => `${call.type}:${call.side}`), ["capture:front"]);
  assert.equal(failureStatus.warmRunnerStatus.status, "failed");
  assert.equal(failureStatus.warmRunnerStatus.captureLock.held, false);
  assert.equal(failureStatus.warmRunnerStatus.previewPolicy.holdActive, false);
  assert.equal(failureStatus.previewStatus.cameraOwnership, "released");
  assert.equal(failureStatus.previewStatus.status, "error");
  assert.equal(failureStatus.warmRunnerStatus.phases.some((phase) => phase.id === "warm_safe_cleanup" && phase.status === "completed"), true);
  assert.equal(failureStatus.warmRunnerStatus.phases.find((phase) => phase.id === "warm_safe_cleanup")?.backend, "warm_full_forensic_runner");
  assert.equal(failureStatus.warmRunnerStatus.phases.some((phase) => phase.id === "capture_front" && phase.status === "failed" && phase.detail === "front boom"), true);
  assert.equal(failureStatus.executionPath, "warm_full_forensic_runner");
  assert.equal(failureStatus.explicitColdDebugModeUsed, false);
  assert.deepEqual(failureStatus.captureFailure, {
    side: "front",
    stage: "warm_capture",
    message: "front boom",
    at: failureStatus.captureFailure.at,
    retryRequired: true,
    automaticColdFallbackAttempted: false,
  });
  assert.equal(failureStatus.captureTimingHardwareEvidence.front.captureBatch, false);
  assert.equal(failureStatus.captureTimingHardwareEvidence.front.processedManifest, false);
  assert.equal(failureStatus.captureProfileGuard.fiveSecondTargetProven, false);
  const failedManifest = JSON.parse(fs.readFileSync(failureStatus.outputs.manifestPath, "utf8"));
  assert.equal(failedManifest.captureFailure.message, "front boom");
  assert.equal(failedManifest.captureFailure.retryRequired, true);
  assert.equal(failedManifest.captureFailure.automaticColdFallbackAttempted, false);
  assert.equal(failedManifest.warmRunnerStatus.captureLock.held, false);
  assert.equal(failedManifest.previewStatus.cameraOwnership, "released");
  assert.equal(Object.prototype.hasOwnProperty.call(failedManifest, "fallbackUsed"), false);
  await assert.rejects(
    () => failureService.action("capture-front", manualCaptureRequest()),
    /requires a new start-session retry/i
  );
  const freshRetry = await failureService.action("start-session", { captureProfile: "full_forensic" });
  assert.equal(freshRetry.captureFailure, undefined);
  assert.equal(freshRetry.rapidCapture.workflowState, undefined);

  const cancelCalls = [];
  const cancelService = new AiGraderLocalStationBridgeService(realConfig({ outputDir: outputDir(`cancel-${Date.now()}`) }), {
    async run(step) {
      cancelCalls.push(step.id);
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  });
  await cancelService.action("start-session", { captureProfile: "full_forensic" });
  const cancelStatus = await cancelService.action("cancel-session");
  assert.deepEqual(cancelCalls, ["safe_off"]);
  assert.equal(cancelStatus.warmRunnerStatus.status, "cancelled");
  assert.equal(cancelStatus.warmRunnerStatus.phases.some((phase) => phase.id === "station_cancelled" && phase.status === "cancelled"), true);

  const endCalls = [];
  const endService = new AiGraderLocalStationBridgeService(realConfig({ outputDir: outputDir(`end-${Date.now()}`) }), {
    async run(step) {
      endCalls.push(step.id);
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  });
  await endService.action("start-session", { captureProfile: "full_forensic" });
  const endStatus = await endService.action("end-session");
  assert.deepEqual(endCalls, ["safe_off"]);
  assert.equal(endStatus.warmRunnerStatus.status, "complete");
  assert.equal(endStatus.warmRunnerStatus.phases.some((phase) => phase.id === "warm_safe_cleanup" && phase.status === "completed"), true);
});

test("fresh bridge status exposes latest generated report from local history", async () => {
  const dir = outputDir(`history-latest-${Date.now()}`);
  const sessionDir = path.join(dir, "ai-grader-browser-station-session-2026-07-02T035658313Z");
  const reportDir = path.join(dir, "ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-02T041413536Z");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(path.join(reportDir, "front"), { recursive: true });
  const frontImagePath = path.join(reportDir, "front", "front-all-on-portrait-display.png");
  fs.writeFileSync(frontImagePath, PNG_BYTES);
  const reportHtmlPath = path.join(reportDir, "provisional-diagnostic-report.html");
  fs.writeFileSync(reportHtmlPath, `<html><body>generated report<img src="${frontImagePath}" alt="front"></body></html>`);
  fs.writeFileSync(path.join(sessionDir, "station-session.json"), JSON.stringify({
    reportId: "ai-grader-browser-station-session-2026-07-02T035658313Z-report",
    sessionId: "ai-grader-browser-station-session-2026-07-02T035658313Z-session",
    createdAt: "2026-07-02T03:56:58.313Z",
    updatedAt: "2026-07-02T04:14:13.536Z",
    outputs: { unifiedReportPath: reportHtmlPath, unifiedReportDir: reportDir },
  }));

  const service = new AiGraderLocalStationBridgeService(mockConfig({ outputDir: dir }));
  const status = service.status();
  assert.equal(status.latestReport.exists, true);
  assert.equal(status.latestReport.reportId, "ai-grader-browser-station-session-2026-07-02T035658313Z-report");
  assert.equal(status.latestReport.localHtmlPath, reportHtmlPath);
  assert.equal(status.latestReport.localViewerPath, "/ai-grader/reports/ai-grader-browser-station-session-2026-07-02T035658313Z-report");

  const resolved = await service.reportBundle(status.latestReport.reportId, { includeAssetBodies: true });
  const imageAsset = resolved.bundle.assets.find((asset) => asset.kind === "image" && asset.fileName === "front-all-on-portrait-display.png");
  assert.equal(resolved.source, "history_generated_with_asset_bodies");
  assert.equal(imageAsset?.bodyEncoding, "base64");
  assert.deepEqual(Buffer.from(imageAsset?.bodyBase64 ?? "", "base64"), PNG_BYTES);
});

test("fresh bridge recovers stale history package idempotently without changing confirmed workflow state", async () => {
  const dir = outputDir("history-report-recovery-" + Date.now());
  const bundleRoot = path.join(dir, "report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  const config = mockConfig({ outputDir: dir, reportBundleOutputDir: bundleRoot });
  const seedService = new AiGraderLocalStationBridgeService(config);
  const reportId = "history-pr82-recovery-report";
  const fixture = await installStaleCandidatePackage(seedService, config, reportId);
  const freshService = new AiGraderLocalStationBridgeService(config);

  const first = await freshService.reportBundle(reportId);
  assert.equal(first.source, "canonical_publish_package_recovered");
  assert.equal(first.bundle.visionLab.defectFindings[0].findingId, fixture.legacyFindingId);
  const firstBytes = fs.readFileSync(path.join(fixture.canonicalDir, "report-bundle.json"));
  const second = await freshService.reportBundle(reportId);
  assert.equal(second.source, "canonical_publish_package");
  assert.deepEqual(fs.readFileSync(path.join(fixture.canonicalDir, "report-bundle.json")), firstBytes);

  const persisted = JSON.parse(fs.readFileSync(fixture.manifest.outputs.manifestPath, "utf8"));
  assert.equal(persisted.rapidCapture.workflowState, "confirmed_needs_publish");
  assert.deepEqual(persisted.rapidCapture.workflowHistory, fixture.manifest.rapidCapture.workflowHistory);
  assert.equal(persisted.progressLog.filter((entry) => entry.includes("derived package safely recovered")).length, 1);
});

test("station bridge ignores stale shared bundle paths for requested history report", async () => {
  const dir = outputDir(`history-stale-bundle-${Date.now()}`);
  const sessionDir = path.join(dir, "ai-grader-browser-station-session-2026-07-06T223658063Z");
  const reportDir = path.join(dir, "ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-06T223840015Z");
  const sharedBundleDir = path.join(dir, "ai-grader-report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(sharedBundleDir, { recursive: true });
  fs.mkdirSync(path.join(reportDir, "front"), { recursive: true });
  const frontImagePath = path.join(reportDir, "front", "front-all-on-portrait-display.png");
  fs.writeFileSync(frontImagePath, PNG_BYTES);
  const reportHtmlPath = path.join(reportDir, "provisional-diagnostic-report.html");
  fs.writeFileSync(reportHtmlPath, `<html><body>generated report<img src="${frontImagePath}" alt="front"></body></html>`);
  const staleBundlePath = path.join(sharedBundleDir, "report-bundle.json");
  fs.writeFileSync(staleBundlePath, JSON.stringify({
    schemaVersion: "ten-kings-ai-grader-report-bundle-v0",
    generatedAt: "2026-07-07T00:03:18.271Z",
    gradingSessionId: "stale-session",
    reportId: "ai-grader-browser-station-session-2026-07-07T000318271Z-report",
    reportStatus: "final_ai_grader_report_v0",
    cardIdentity: { title: "Stale report" },
    evidenceReferences: {},
    provisionalGrade: {},
    assets: [],
    warnings: [],
  }));
  fs.writeFileSync(path.join(sessionDir, "station-session.json"), JSON.stringify({
    reportId: "ai-grader-browser-station-session-2026-07-06T223658063Z-report",
    sessionId: "ai-grader-browser-station-session-2026-07-06T223658063Z-session",
    createdAt: "2026-07-06T22:36:58.063Z",
    updatedAt: "2026-07-06T22:38:55.517Z",
    outputs: {
      unifiedReportPath: reportHtmlPath,
      unifiedReportDir: reportDir,
      reportBundlePath: staleBundlePath,
    },
  }));

  const service = new AiGraderLocalStationBridgeService(mockConfig({ outputDir: dir }));
  const resolved = await service.reportBundle("ai-grader-browser-station-session-2026-07-06T223658063Z-report");
  assert.equal(resolved.source, "history_generated_from_report_dir");
  assert.equal(resolved.bundle.reportId, "ai-grader-browser-station-session-2026-07-06T223658063Z-report");
  assert.equal(resolved.bundle.assets.some((asset) => asset.fileName === "front-all-on-portrait-display.png"), true);
});

test("station bridge serves one local report asset for direct storage upload", async () => {
  const dir = outputDir(`report-asset-${Date.now()}`);
  const sessionDir = path.join(dir, "ai-grader-browser-station-session-2026-07-02T035658313Z");
  const reportDir = path.join(dir, "ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-02T041413536Z");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(reportDir, "front"), { recursive: true });
  const frontImagePath = path.join(reportDir, "front", "front-all-on-portrait-display.png");
  fs.writeFileSync(frontImagePath, PNG_BYTES);
  const reportHtmlPath = path.join(reportDir, "provisional-diagnostic-report.html");
  fs.writeFileSync(reportHtmlPath, `<html><body>generated report<img src="${frontImagePath}" alt="front"></body></html>`);
  fs.writeFileSync(path.join(sessionDir, "station-session.json"), JSON.stringify({
    reportId: "ai-grader-browser-station-session-2026-07-02T035658313Z-report",
    sessionId: "ai-grader-browser-station-session-2026-07-02T035658313Z-session",
    createdAt: "2026-07-02T03:56:58.313Z",
    updatedAt: "2026-07-02T04:14:13.536Z",
    outputs: { unifiedReportPath: reportHtmlPath, unifiedReportDir: reportDir },
  }));

  const token = "local-station-token-report-asset";
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: token,
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: dir,
  });
  try {
    const reportId = "ai-grader-browser-station-session-2026-07-02T035658313Z-report";
    const assetId = "report/front/front-all-on-portrait-display.png";
    const unauthorized = await fetch(`${started.url}/reports/${encodeURIComponent(reportId)}/asset?assetId=${encodeURIComponent(assetId)}`, {
      headers: { Origin: "https://collect.tenkings.co" },
    });
    assert.equal(unauthorized.status, 401);
    await unauthorized.text();

    const response = await fetch(`${started.url}/reports/${encodeURIComponent(reportId)}/asset?assetId=${encodeURIComponent(assetId)}`, {
      headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": token },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("x-ai-grader-asset-id"), assetId);
    assert.equal(response.headers.get("x-ai-grader-sha256"), PNG_SHA256);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG_BYTES);
  } finally {
    await closeServer(started.server);
  }
});

test("station bridge CLI help exposes local bridge command and flags", async () => {
  let stdout = "";
  const code = await runCaptureHelperCli(["help"], {
    env: {},
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: () => {},
  });
  assert.equal(code, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.commands.some((command) => command.includes("ai-grader-station-bridge")), true);
  assert.equal(payload.commands.some((command) => command.startsWith("ai-grader-production-release")), true);
  assert.equal(payload.options.includes("--station-token"), true);
  assert.equal(payload.options.includes("--station-pairing-code"), true);
  assert.equal(payload.options.includes("--enable-local-station"), true);
});

test("Windows bridge scripts keep station token out of scheduled task and launcher command lines", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const startScript = fs.readFileSync(path.join(repoRoot, "scripts", "ai-grader", "start-local-station-bridge.ps1"), "utf8");
  const installScript = fs.readFileSync(path.join(repoRoot, "scripts", "ai-grader", "install-local-station-bridge.ps1"), "utf8");
  const openScript = fs.readFileSync(path.join(repoRoot, "scripts", "ai-grader", "open-local-station.ps1"), "utf8");
  const statusScript = fs.readFileSync(path.join(repoRoot, "scripts", "ai-grader", "status-local-station-bridge.ps1"), "utf8");
  const stopScript = fs.readFileSync(path.join(repoRoot, "scripts", "ai-grader", "stop-local-station-bridge.ps1"), "utf8");

  assert.equal(startScript.includes("--station-token"), false);
  assert.match(startScript, /if \(-not \$SkipBuild\) \{[\s\S]*capture-helper\" build/);
  assert.equal(startScript.includes("-and -not (Test-Path -LiteralPath $cliPath)"), false);
  assert.match(startScript, /build failed; the local bridge was not started with stale compiled code/i);
  assert.equal(installScript.includes("--station-token"), false);
  assert.equal(openScript.includes("--station-token"), false);
  assert.equal(installScript.includes("AI_GRADER_SERVICE_ACCOUNT_TOKEN"), false);
  assert.equal(openScript.includes("AI_GRADER_SERVICE_ACCOUNT_TOKEN"), false);
  assert.equal(statusScript.includes("tokenFingerprint"), true);
  assert.equal(statusScript.includes("ConvertTo-Json"), true);
  assert.equal(stopScript.includes("ai-grader-station-bridge"), true);
  assert.equal(stopScript.includes("--host 127.0.0.1"), true);
  assert.equal(stopScript.includes("--port 47652"), true);
});

test("initial safe-off confirmation waits for an in-flight lighting write and blocks relight races", async () => {
  const applyGate = deferred();
  const events = [];
  let blockApply = false;
  const service = new AiGraderLocalStationBridgeService(
    mockConfig({ outputDir: outputDir(`initial-safeoff-serialization-${Date.now()}`) }),
    undefined,
    undefined,
    {
      async writeLightingFrames(frames) {
        if (blockApply && frames.length > 3) {
          events.push("apply-pending");
          await applyGate.promise;
          events.push("apply-acknowledged");
          blockApply = false;
        } else if (events.includes("apply-pending") && frames.length <= 3) {
          events.push("confirmation-safeoff-acknowledged");
        }
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    },
  );
  await service.action("start-session", { captureProfile: "full_forensic" });
  blockApply = true;
  const apply = service.applyLiveLighting({ enabled: true, dutyPercent: 1.2, channels: [1] });
  await waitFor(() => events.includes("apply-pending"), "lighting apply never reached the fake acknowledgement gate");
  const confirmation = service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await waitFor(() => service.terminalLifecyclePending > 0, "initial safe-off did not reserve the terminal lifecycle");
  assert.equal(service.status().confirmations.lightIdleOff, false);
  await assert.rejects(
    () => service.applyLiveLighting({ enabled: true, dutyPercent: 1.3, channels: [2] }),
    /serialized capture\/terminal lifecycle/i,
  );
  await assert.rejects(() => service.heartbeatLiveLighting("racing heartbeat"), /serialized capture transition/i);
  applyGate.resolve();
  await apply;
  const confirmed = await confirmation;
  assert.equal(confirmed.confirmations.lightIdleOff, true);
  assert.equal(confirmed.liveLighting.physicalState.state, "safe_off_verified");
  assert.equal(confirmed.liveLighting.applied.enabled, false);
  assert.deepEqual(events, ["apply-pending", "apply-acknowledged", "confirmation-safeoff-acknowledged"]);
});

test("front pre-lock handoff reserves every mutation and shutdown waits without relighting", async () => {
  const safeOffGate = deferred();
  const events = [];
  let gateFrontSafeOff = false;
  let trackedWriteCount = 0;
  let restoreWriteCount = 0;
  let service;
  const warm = makeFakeWarmRunner({
    onCaptureStarted(input) {
      if (input.side !== "front") return;
      events.push("one-front-grab");
      assert.equal(service.status().warmRunnerStatus.captureLock.held, true);
    },
  });
  service = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`front-transition-reservation-${Date.now()}`) }),
    {
      async run(step) {
        events.push(`runner-${step.id}`);
        return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
      },
    },
    warm.runner,
    {
      async writeLightingFrames(frames) {
        if (gateFrontSafeOff) {
          trackedWriteCount += 1;
          if (frames.length > 3) restoreWriteCount += 1;
          if (events.includes("front-safeoff-pending") === false) {
            events.push("front-safeoff-pending");
            assert.equal(service.status().warmRunnerStatus.captureLock.held, false);
            assert.equal(service.status().liveLighting.physicalState.state, "safe_off_pending");
            await safeOffGate.promise;
            events.push("front-safeoff-acknowledged");
          }
        }
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
      async stopOrphanedPreviewStreamsUntilReleased() {
        if (gateFrontSafeOff) events.push("orphan-scan");
        return 0;
      },
    },
  );
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  gateFrontSafeOff = true;
  const capture = service.action("capture-front", manualCaptureRequest());
  await waitFor(() => events.includes("front-safeoff-pending"), "front capture never reached pre-lock safe-off");
  assert.ok(service.frontCaptureTransition);
  assert.equal(service.status().warmRunnerStatus.captureLock.held, false);
  await assert.rejects(
    () => service.applyLiveLighting({ enabled: true, dutyPercent: 1.4, channels: [1] }),
    /serialized capture\/terminal lifecycle/i,
  );
  await assert.rejects(() => service.heartbeatLiveLighting("racing front heartbeat"), /serialized capture transition/i);
  await assert.rejects(
    () => service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } }),
    /another serialized capture\/terminal lifecycle/i,
  );
  await assert.rejects(() => service.safeOffLiveLightingForOperator("racing disconnect"), /serialized capture transition/i);
  await assert.rejects(() => service.stopPreviewForOperator("racing preview stop"), /capture transition/i);
  let shutdownSettled = false;
  const shutdown = service.shutdown("close during front pre-lock handoff").then(() => { shutdownSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownSettled, false);
  safeOffGate.resolve();
  const captured = await capture;
  await shutdown;
  assert.ok(captured.outputs.frontPackageDir);
  assert.equal(shutdownSettled, true);
  assert.equal(restoreWriteCount, 0, "shutdown-pending front completion restored positioning illumination");
  assert.ok(trackedWriteCount >= 2, "front and shutdown terminal safe-offs were not both acknowledged");
  assert.ok(events.indexOf("front-safeoff-acknowledged") < events.indexOf("one-front-grab"));
  assert.equal(service.status().liveLighting.physicalState.state, "safe_off_verified");
  assert.equal(service.status().warmRunnerStatus.captureLock.held, false);
});

test("atomic Back Capture serializes drain and verified safe-off, coalesces one key, and blocks racing lifecycle calls", async () => {
  const events = [];
  const backCaptureStarted = deferred();
  const releaseBackCapture = deferred();
  let service;
  let track = false;
  let backCaptureCount = 0;
  let lightingWriteCount = 0;
  const runner = {
    async run(step) {
      if (track && step.id === "safe_off") events.push("guarded-safe-off-after-grab");
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const warm = makeFakeWarmRunner({
    onCaptureStarted(input) {
      if (input.side !== "back") return;
      backCaptureCount += 1;
      events.push("one-forensic-grab");
      backCaptureStarted.resolve();
    },
    async captureDelay(input) {
      if (input.side === "back") await releaseBackCapture.promise;
    },
  });
  service = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`atomic-order-${Date.now()}`) }),
    runner,
    warm.runner,
    {
      async writeLightingFrames(frames) {
        if (track) {
          lightingWriteCount += 1;
          const status = service.status();
          assert.equal(status.warmRunnerStatus.captureLock.held, true);
          assert.equal(status.previewStatus.intentionalTransition.active, true);
          assert.ok(status.geometryCaptureDecisions.back);
          events.push(backCaptureCount === 0 ? "verified-safe-off-before-grab" : "verified-safe-off-after-grab");
        }
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
      async stopOrphanedPreviewStreamsUntilReleased() {
        if (track) events.push("intentional-drain-complete");
        return 0;
      },
    },
  );
  await prepareBackPositioning(service);
  service.previewStop = () => events.push("intentional-reader-stop");
  track = true;
  const request = atomicBackCaptureRequest(service);
  const first = service.action("capture-back", request);
  const duplicate = service.action("capture-back", structuredClone(request));
  await backCaptureStarted.promise;

  assert.equal(backCaptureCount, 1);
  assert.equal(lightingWriteCount, 1);
  await assert.rejects(
    () => service.action("capture-back", { ...request, expectedFrameId: "conflicting-frame" }),
    /idempotency key conflicts/i,
  );
  await assert.rejects(
    () => service.action("capture-back", { ...request, idempotencyKey: "different-atomic-key-0001" }),
    /different Atomic Back Capture/i,
  );
  await assert.rejects(() => service.stopPreviewForOperator("racing browser stop"), /capture transition/i);
  await assert.rejects(() => service.safeOffLiveLightingForOperator("racing page disconnect"), /serialized capture transition/i);
  await assert.rejects(() => service.heartbeatLiveLighting("racing heartbeat"), /serialized capture transition/i);
  await assert.rejects(
    () => service.retryBackPositioningLight(backPositioningRetryAssertions(service)),
    /serialized capture transition/i,
  );
  await service.safeOffAfterPreviewLoss("racing unexpected EOF");
  assert.equal(lightingWriteCount, 1, "racing lifecycle calls issued a second write during forensic ownership");

  releaseBackCapture.resolve();
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
  assert.deepEqual(duplicateResult, firstResult);
  assert.equal(backCaptureCount, 1);
  assert.deepEqual(events, [
    "intentional-reader-stop",
    "intentional-drain-complete",
    "verified-safe-off-before-grab",
    "one-forensic-grab",
    "guarded-safe-off-after-grab",
    "verified-safe-off-after-grab",
  ]);
  assert.equal(firstResult.warmRunnerStatus.captureLock.held, false);
  assert.equal(firstResult.previewStatus.intentionalTransition.active, false);
  assert.equal(firstResult.previewStatus.intentionalTransition.outcome, "capture_started");
  const replay = await service.action("capture-back", request);
  assert.deepEqual(replay, firstResult);
  assert.equal(backCaptureCount, 1);
});

test("lighting acknowledgement is truthful while pending and missing acknowledgement becomes unknown and blocks capture", async () => {
  let gate;
  let incomplete = false;
  const service = new AiGraderLocalStationBridgeService(
    mockConfig({ outputDir: outputDir(`truthful-light-state-${Date.now()}`) }),
    undefined,
    undefined,
    {
      async writeLightingFrames(frames) {
        if (gate) await gate.promise;
        if (incomplete) return frames.slice(0, -1).map(() => ({ responseKind: "ack", ok: true }));
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    },
  );
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.applyLiveLighting({ enabled: true, dutyPercent: 1.2, channels: [1] });
  gate = deferred();
  const pendingSafeOff = service.safeOffLiveLightingForOperator("delayed acknowledgement test");
  const pending = await waitFor(
    () => service.status().liveLighting.physicalState.state === "safe_off_pending" ? service.status() : undefined,
    "safe-off never entered pending state",
  );
  assert.equal(pending.liveLighting.applied.enabled, undefined);
  assert.equal(pending.liveLighting.applied.verifiedAt, undefined);
  assert.equal(pending.liveLighting.physicalState.verifiedAt, undefined);
  gate.resolve();
  await pendingSafeOff;
  assert.equal(service.status().liveLighting.physicalState.state, "safe_off_verified");
  assert.equal(service.status().liveLighting.applied.enabled, false);

  await service.applyLiveLighting({ enabled: true, dutyPercent: 1.2, channels: [1] });
  incomplete = true;
  await assert.rejects(
    () => service.safeOffLiveLightingForOperator("missing acknowledgement test"),
    /acknowledgement incomplete/i,
  );
  const unknown = service.status();
  assert.equal(unknown.liveLighting.physicalState.state, "physical_state_unknown");
  assert.equal(unknown.liveLighting.applied.enabled, undefined);
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await assert.rejects(
    () => service.action("capture-front", manualCaptureRequest()),
    /physical state is physical_state_unknown/i,
  );
});

test("live-lighting apply failures are redacted in HTTP, status, safety events, and persisted manifest", async () => {
  const token = "local-redaction-test-token";
  let failApply = false;
  const started = await startAiGraderLocalStationBridgeHttpServer(
    {
      enabled: true,
      mode: "mock",
      host: "127.0.0.1",
      port: 0,
      stationToken: token,
      outputDir: outputDir(`lighting-redaction-${Date.now()}`),
    },
    undefined,
    undefined,
    undefined,
    {
      async writeLightingFrames(frames) {
        if (failApply && frames.length > 3) {
          throw new Error("controller http://169.254.9.9/private-controller C:\\private\\lighting.json token=secret-value");
        }
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    },
  );
  const headers = {
    "x-ai-grader-station-token": token,
    "content-type": "application/json",
  };
  const post = (pathName, body) => fetch(`${started.url}${pathName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const privatePattern = /169\.254\.9\.9|private-controller|private\\lighting|secret-value|token=/i;
  try {
    assert.equal((await post("/actions/start-session", { captureProfile: "full_forensic" })).status, 200);
    failApply = true;
    const failed = await post("/lighting/apply", { enabled: true, dutyPercent: 1.2, channels: [1] });
    assert.equal(failed.status, 400);
    const failedText = await failed.text();
    assert.doesNotMatch(failedText, privatePattern);
    assert.match(failedText, /local endpoint|local path|redacted/i);
    const statusResponse = await fetch(`${started.url}/status`, { headers });
    assert.equal(statusResponse.status, 200);
    const statusPayload = await statusResponse.json();
    assert.doesNotMatch(JSON.stringify(statusPayload), privatePattern);
    const status = statusPayload.result;
    assert.equal(status.liveLighting.physicalState.state, "safe_off_verified");
    assert.equal(status.liveLighting.safetyEvents.some((event) => event.type === "failure_safe_off"), true);
    const persisted = fs.readFileSync(status.outputs.manifestPath, "utf8");
    assert.doesNotMatch(persisted, privatePattern);
  } finally {
    failApply = false;
    if (typeof started.server.closeAllConnections === "function") started.server.closeAllConnections();
    await closeServer(started.server);
  }
});

test("restore plus cleanup failure preserves front evidence, persists redacted unknown state, and retry coalesces one fresh restore", async () => {
  let restoreFailureEnabled = true;
  let cleanupMustFail = false;
  let restoreWrites = 0;
  const runner = {
    async run(step) {
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const service = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`restore-double-failure-${Date.now()}`) }),
    runner,
    makeFakeWarmRunner().runner,
    {
      async writeLightingFrames(frames) {
        if (frames.length > 3) {
          restoreWrites += 1;
          if (restoreFailureEnabled) {
            cleanupMustFail = true;
            throw new Error("restore failed at http://169.254.1.2/C:\\private\\profile token=secret-value");
          }
        }
        if (cleanupMustFail && frames.length <= 3) {
          throw new Error("cleanup failed at C:\\private\\safeoff token=secret-value");
        }
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    },
  );
  await service.action("start-session", { captureProfile: "full_forensic" });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const front = await service.action("capture-front", manualCaptureRequest());
  assert.ok(front.outputs.frontPackageDir);
  assert.equal(front.currentStep, "prompt_flip_card");
  assert.equal(front.liveLighting.physicalState.state, "physical_state_unknown");
  assert.equal(front.liveLighting.applied.enabled, undefined);
  assert.equal(front.liveLighting.backPositioning.captureReady, false);
  const persistedFailure = JSON.parse(fs.readFileSync(front.outputs.manifestPath, "utf8"));
  assert.equal(persistedFailure.liveLighting.physicalState.state, "physical_state_unknown");
  assert.doesNotMatch(JSON.stringify({ status: front, persistedFailure }), /169\.254|C:\\private|secret-value|token=/i);

  restoreFailureEnabled = false;
  cleanupMustFail = false;
  const assertions = backPositioningRetryAssertions(service);
  const beforeRetryWrites = restoreWrites;
  const [retried, duplicate] = await Promise.all([
    service.retryBackPositioningLight(assertions),
    service.retryBackPositioningLight(assertions),
  ]);
  assert.deepEqual(duplicate, retried);
  assert.equal(restoreWrites, beforeRetryWrites + 1);
  assert.equal(service.previewObservations.length, 0);
  assert.equal(service.status().previewStatus.latestFrameId, undefined);
  assert.equal(service.status().previewStatus.cardGeometry.back, undefined);
  assert.equal(service.status().liveLighting.backPositioning.captureReady, false);
  const repeated = await service.retryBackPositioningLight(assertions);
  assert.equal(repeated.attemptCount, retried.attemptCount);
  assert.equal(restoreWrites, beforeRetryWrites + 1);
  assert.ok(service.status().liveLighting.watchdog.expiresAt);
  noteFreshBackPreviewFrame(service, 9);
  assert.equal(service.status().liveLighting.backPositioning.captureReady, true);
  const readyObservations = structuredClone(service.previewObservations);
  const readyFrameId = service.status().previewStatus.latestFrameId;
  const writesBeforeReadyReplay = restoreWrites;
  const readyReplay = await service.retryBackPositioningLight(assertions);
  const duplicateReadyReplay = await service.retryBackPositioningLight(assertions);
  assert.deepEqual(duplicateReadyReplay, readyReplay);
  assert.equal(readyReplay.status, "ready");
  assert.equal(readyReplay.captureReady, true);
  assert.equal(service.status().previewStatus.latestFrameId, readyFrameId);
  assert.deepEqual(service.previewObservations, readyObservations);
  assert.equal(restoreWrites, writesBeforeReadyReplay);
  service.manifest.previewStatus.lastFrameAt = new Date(Date.now() - 5000).toISOString();
  const staleRecovery = await service.retryBackPositioningLight(assertions);
  assert.equal(staleRecovery.status, "waiting_for_frame");
  assert.equal(staleRecovery.captureReady, false);
  assert.equal(restoreWrites, writesBeforeReadyReplay + 1);
  assert.equal(service.previewObservations.length, 0);
  assert.equal(service.status().previewStatus.latestFrameId, undefined);
});

test("shutdown waits for atomic ownership and inherits its final verified safe-off without a racing third write", async () => {
  const backStarted = deferred();
  const releaseBack = deferred();
  let trackWrites = false;
  let trackedWrites = 0;
  const warm = makeFakeWarmRunner({
    onCaptureStarted(input) {
      if (input.side === "back") backStarted.resolve();
    },
    async captureDelay(input) {
      if (input.side === "back") await releaseBack.promise;
    },
  });
  const service = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`shutdown-atomic-${Date.now()}`) }),
    { async run(step) { return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } }; } },
    warm.runner,
    {
      async writeLightingFrames(frames) {
        if (trackWrites) trackedWrites += 1;
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    },
  );
  await prepareBackPositioning(service);
  trackWrites = true;
  const capture = service.action("capture-back", atomicBackCaptureRequest(service));
  await backStarted.promise;
  const shutdown = service.shutdown("shutdown during atomic test");
  let shutdownSettled = false;
  void shutdown.then(() => { shutdownSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownSettled, false);
  assert.equal(trackedWrites, 1);
  releaseBack.resolve();
  await capture;
  await shutdown;
  assert.equal(trackedWrites, 2, "shutdown issued a third safe-off after atomic post-capture verification");
  assert.equal(service.status().liveLighting.physicalState.state, "safe_off_verified");
  assert.equal(service.status().warmRunnerStatus.captureLock.held, false);
});

test("watchdog, session replacement, shutdown, and capture failure preserve unknown physical state on missing safe-off ACK", async () => {
  let watchdogSafeOffFails = false;
  const watchdog = new AiGraderLocalStationBridgeService(
    mockConfig({ outputDir: outputDir(`watchdog-unknown-${Date.now()}`) }),
    undefined,
    undefined,
    {
      async writeLightingFrames(frames) {
        if (watchdogSafeOffFails && frames.length <= 3) throw new Error("watchdog ACK missing at C:\\private\\watchdog token=hidden");
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    },
  );
  await prepareBackPositioning(watchdog);
  watchdogSafeOffFails = true;
  await assert.rejects(() => watchdog.handleLiveLightingWatchdogExpiry("terminal matrix"), /ACK missing/i);
  assert.equal(watchdog.status().liveLighting.physicalState.state, "physical_state_unknown");
  assert.equal(watchdog.status().liveLighting.applied.enabled, undefined);
  assert.equal(watchdog.status().liveLighting.backPositioning.captureReady, false);
  await assert.rejects(
    () => watchdog.restoreBackPositioningLight("operator_retry"),
    /physical state is physical_state_unknown/i,
  );
  await assert.rejects(
    () => watchdog.action("capture-back", atomicBackCaptureRequest(watchdog)),
    /physical state is physical_state_unknown/i,
  );
  await assert.rejects(
    () => watchdog.retryBackPositioningLight(backPositioningRetryAssertions(watchdog)),
    /ACK missing/i,
  );

  let replacementSafeOffFails = false;
  const replacement = new AiGraderLocalStationBridgeService(
    mockConfig({ outputDir: outputDir(`replacement-unknown-${Date.now()}`) }),
    undefined,
    undefined,
    {
      async writeLightingFrames(frames) {
        if (replacementSafeOffFails && frames.length <= 3) throw new Error("replacement ACK missing");
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    },
  );
  const old = await prepareBackPositioning(replacement);
  replacementSafeOffFails = true;
  await assert.rejects(
    () => replacement.action("start-session", { captureProfile: "full_forensic" }),
    /replacement ACK missing/i,
  );
  assert.equal(replacement.status().sessionId, old.sessionId);
  assert.equal(replacement.status().liveLighting.physicalState.state, "physical_state_unknown");

  let shutdownSafeOffFails = false;
  const shutdown = new AiGraderLocalStationBridgeService(
    mockConfig({ outputDir: outputDir(`shutdown-unknown-${Date.now()}`) }),
    undefined,
    undefined,
    {
      async writeLightingFrames(frames) {
        if (shutdownSafeOffFails && frames.length <= 3) throw new Error("shutdown ACK missing");
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    },
  );
  await shutdown.action("start-session", { captureProfile: "full_forensic" });
  await shutdown.applyLiveLighting({ enabled: true, dutyPercent: 1.1, channels: [1] });
  shutdownSafeOffFails = true;
  await assert.rejects(() => shutdown.shutdown("terminal matrix shutdown"), /shutdown ACK missing/i);
  assert.equal(shutdown.status().liveLighting.physicalState.state, "physical_state_unknown");
  assert.notEqual(shutdown.status().warmRunnerStatus.status, "complete");

  let captureAttempted = false;
  const failedWarm = makeFakeWarmRunner({
    captureError: new Error("front camera grab failed"),
    onCaptureStarted() {
      captureAttempted = true;
    },
  });
  const captureFailure = new AiGraderLocalStationBridgeService(
    realConfig({ outputDir: outputDir(`capture-failure-unknown-${Date.now()}`) }),
    {
      async run(step) {
        return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
      },
    },
    failedWarm.runner,
    {
      async writeLightingFrames(frames) {
        if (captureAttempted && frames.length <= 3) throw new Error("capture cleanup ACK missing");
        return frames.map(() => ({ responseKind: "ack", ok: true }));
      },
    },
  );
  await captureFailure.action("start-session", { captureProfile: "full_forensic" });
  await captureFailure.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await captureFailure.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await assert.rejects(
    () => captureFailure.action("capture-front", manualCaptureRequest()),
    /front camera grab failed.*capture cleanup ACK missing/i,
  );
  const failedCaptureStatus = captureFailure.status();
  assert.equal(failedCaptureStatus.liveLighting.physicalState.state, "physical_state_unknown");
  assert.equal(failedCaptureStatus.liveLighting.applied.enabled, undefined);
  assert.equal(failedCaptureStatus.warmRunnerStatus.status, "failed");
  assert.equal(failedCaptureStatus.warmRunnerStatus.captureLock.held, false);
  assert.equal(failedCaptureStatus.outputs.frontPackageDir, undefined);
});
