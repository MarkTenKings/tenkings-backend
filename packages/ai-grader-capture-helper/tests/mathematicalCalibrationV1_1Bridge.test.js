const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1_1,
  FixedRigMathematicalCalibrationCaptureProducerV1,
} = require("../dist/drivers/fixedRigMathematicalCalibrationCaptureV1");
const {
  AiGraderLocalStationBridgeService,
  buildAiGraderLocalStationBridgeConfig,
} = require("../dist/drivers/aiGraderLocalStationBridge");
const {
  detectMathematicalCalibrationPreviewCheckerboard,
} = require("../dist/drivers/mathematicalCalibrationPreviewCheckerboard");
const { assessMathematicalCalibrationV1_1Preview } = require("../dist/drivers/fixedRigMathematicalCalibrationV1_1");

function mockPreviewExchange(sessionId) {
  const request = new EventEmitter();
  request.headers = { "x-ai-grader-mathematical-calibration-session-id": sessionId };
  const response = new EventEmitter();
  response.destroyed = false;
  response.setHeader = () => response;
  response.writeHead = (statusCode) => { response.statusCode = statusCode; };
  response.write = () => true;
  response.end = (body) => { response.body = `${response.body ?? ""}${body ?? ""}`; response.destroyed = true; };
  return { request, response };
}

async function v1BridgeFixture(root, options = {}) {
  const sessionId = options.sessionId ?? "calibration-v1-bridge-session";
  const hardStops = [];
  const captures = [];
  let orphanReleaseCalls = 0;
  let status = {
    schemaVersion: "ten-kings-mathematical-calibration-capture-session-v1",
    sessionId,
    sealed: false,
    captureCount: 0,
    measurementCount: 0,
    failedOperationCount: 0,
    sessionStateSha256: "a".repeat(64),
    nextCaptureSlot: { role: "lens_geometry", sampleIndex: 1, channelIndex: null, targetFace: "checkerboard", slotKey: "lens_geometry:none:1" },
    retryAllowed: false,
    hardStop: null,
    poseProgress: [
      { role: "lens_geometry", acceptedCount: 0, requiredCount: 10, currentAggregate: { x: 0, y: 0, rotationDegrees: 0 }, minimumCoverageFraction: 0.3, requiredAggregate: { x: 0.07, y: 0.08, rotationDegrees: 2 }, aggregateSatisfied: false },
      { role: "normalization_registration", acceptedCount: 0, requiredCount: 10, currentAggregate: { x: 0, y: 0, rotationDegrees: 0 }, minimumCoverageFraction: 0.3, requiredAggregate: { x: 0.07, y: 0.08, rotationDegrees: 2 }, aggregateSatisfied: false },
    ],
    acceptedCaptureHistory: [], failedAttempts: [], sessionDir: path.join(root, "calibration", sessionId),
  };
  const producer = {
    start: async (request) => { assert.equal(request.sessionId, sessionId); return status; },
    status: async (requestedSessionId) => { assert.equal(requestedSessionId, sessionId); return status; },
    previewPoses: async () => [],
    recordHardStop: async (_sessionId, operationId, reason) => {
      hardStops.push({ operationId, reason });
      status = { ...status, hardStop: { operationId, stoppedAt: new Date().toISOString(), reason } };
      return status;
    },
    captureStep: async (request) => {
      captures.push(request);
      if (options.captureFailure) throw new Error(options.captureFailure);
      const captureCount = status.captureCount + 1;
      status = {
        ...status,
        captureCount,
        nextCaptureSlot: { role: "lens_geometry", sampleIndex: captureCount + 1, channelIndex: null, targetFace: "checkerboard", slotKey: `lens_geometry:none:${captureCount + 1}` },
      };
      return status;
    },
  };
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    port: 47653,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: path.join(root, "station"),
  });
  const service = new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    mathematicalCalibrationCaptureProducer: producer,
    stopOrphanedPreviewStreamsUntilReleased: async () => { orphanReleaseCalls += 1; return 0; },
    detectMathematicalCalibrationPreviewCheckerboard: async () => ({
      imageWidth: 1200, imageHeight: 1680,
      internalCorners: Array.from({ length: 176 }, (_, index) => ({ x: index % 11, y: Math.floor(index / 11) })),
      outerCorners: [{ x: 100, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 1580 }, { x: 100, y: 1580 }],
      rotationDegrees: 0,
    }),
  });
  await service.startMathematicalCalibrationCapture({
    sessionId,
    operatorId: "mark-supervised",
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256: "b".repeat(64),
  });
  return {
    service,
    sessionId,
    hardStops,
    captures,
    sessionSnapshot: () => structuredClone(status),
    lifecycleSnapshot: () => ({
      captures: captures.length,
      orphanReleaseCalls,
      safeOffCommands: service.manifest.commandResults.length,
      lightingSafetyEvents: service.manifest.liveLighting.safetyEvents.length,
    }),
  };
}

function exactLatestDisplayedFrame(fixture) {
  const preview = fixture.service.previewStatus();
  return {
    sessionId: fixture.sessionId,
    epoch: preview.sideEpoch,
    frameId: preview.latestFrameId,
    capturedAt: preview.lastFrameAt,
  };
}

async function acknowledgeLatestAndAuthorize(fixture) {
  const displayed = exactLatestDisplayedFrame(fixture);
  fixture.service.acknowledgeMathematicalCalibrationDisplayedFrame(displayed);
  const authorization = await fixture.service.authorizeMathematicalCalibrationDisplayedFrame(fixture.sessionId);
  return { displayed, authorization };
}

test("checkerboard detector default timeout allows ten-second bounded detection", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-calibration-checkerboard-timeout-"));
  const scriptPath = path.join(root, "delayed-detector.py");
  await fs.writeFile(scriptPath, [
    "import json, time",
    "time.sleep(3.5)",
    "print(json.dumps({'imageWidth': 1000, 'imageHeight': 1000, 'internalCorners': [{'x': 10, 'y': 10}] * 176, 'outerCorners': [{'x': 10, 'y': 10}, {'x': 990, 'y': 10}, {'x': 990, 'y': 990}, {'x': 10, 'y': 990}], 'segmentationBoundary': [{'x': 10, 'y': 10}, {'x': 500, 'y': 10}, {'x': 990, 'y': 10}, {'x': 990, 'y': 500}, {'x': 990, 'y': 990}, {'x': 500, 'y': 990}, {'x': 10, 'y': 990}, {'x': 10, 'y': 500}], 'rotationDegrees': 0}))",
  ].join("\n"));
  const result = await detectMathematicalCalibrationPreviewCheckerboard(Buffer.from("delayed-fixture"), { scriptPath });
  assert.equal(result.internalCorners.length, 176);
});

test("Production preview does not require a Mathematical Calibration session header", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-production-preview-no-calibration-header-"));
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    port: 47652,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: path.join(root, "station"),
  });
  const service = new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    stopOrphanedPreviewStreamsUntilReleased: async () => 0,
  });
  // Seed an already-existing historical session directly; public start-session
  // is covered separately and accepts only explicit Mathematical V1.
  await service.createFreshSession({
    captureProfile: "production_fast",
    reportId: "production-preview-report",
    gradingContract: "legacy_v0",
  });

  const request = new EventEmitter();
  request.headers = {};
  const response = new EventEmitter();
  response.destroyed = false;
  response.setHeader = () => response;
  response.writeHead = () => undefined;
  response.write = () => true;
  response.end = () => { response.destroyed = true; };

  const stream = service.streamPreview(request, response, undefined);
  const liveDeadline = Date.now() + 500;
  while (service.previewStatus().status !== "live" && Date.now() < liveDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(service.previewStatus().status, "live");
  assert.equal(service.previewStatus().frameCount > 0, true);
  request.emit("close");
  await stream;
});

test("V1.1 binds only a calibration session, exposes overlay-gated capture, and never opens Production", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v11-bridge-"));
  const target = Buffer.from("%PDF-1.4\nV1.1 test target\n");
  const targetPath = path.join(root, "target.pdf");
  await fs.writeFile(targetPath, target);
  const targetSha256 = crypto.createHash("sha256").update(target).digest("hex");
  const producer = new FixedRigMathematicalCalibrationCaptureProducerV1({
    outputRoot: path.join(root, "calibration"),
    targetPath,
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256,
    contractVersion: "v1.1",
    protectedSettings: {
      stationId: "local-dell-ai-grader-station",
      rigId: "fixed-rig-test-v1",
      captureProfileVersion: FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1_1,
      cameraIndex: 0,
      exposureUs: 6200,
      gain: 0,
      dutyPercent: 1.2,
      leimacUnit: 1,
      selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
      normalizedWidthPx: 1200,
      normalizedHeightPx: 1680,
      checkerboard: { internalColumns: 11, internalRows: 16, cellMm: 5 },
    },
    capture: async () => { throw new Error("hardware boundary must not run in this test"); },
  });
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    port: 47653,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: path.join(root, "station"),
  });
  const service = new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    mathematicalCalibrationCaptureProducerV1_1: producer,
    stopOrphanedPreviewStreamsUntilReleased: async () => 0,
    detectPreviewCardGeometry: async () => { throw new Error("Production detector must not serve calibration preview"); },
    detectMathematicalCalibrationPreviewCheckerboard: async () => ({
      imageWidth: 1200,
      imageHeight: 1680,
      internalCorners: Array.from({ length: 176 }, (_, index) => ({ x: index % 11, y: Math.floor(index / 11) })),
      outerCorners: [{ x: 100, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 1580 }, { x: 100, y: 1580 }],
      rotationDegrees: 0,
    }),
  });
  const started = await service.startMathematicalCalibrationV1_1Capture({
    sessionId: "calibration-v11-bridge-session",
    operatorId: "mark-supervised",
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256,
  });
  assert.equal(started.captureCount, 0);
  assert.equal(service.manifest.sessionId, undefined, "calibration must not create a station/Production session");
  assert.ok(service.status().bridgeContract.endpoints.some((endpoint) => endpoint.path === "/calibration/mathematical-v1.1/capture"));
  assert.throws(
    () => service.captureMathematicalCalibrationV1_1Step({
      sessionId: started.sessionId,
      operationId: "placement-1",
      role: "checkerboard_placement",
      sampleIndex: 1,
      targetFace: "checkerboard",
    }),
    /active token-bound preview.*valid and sufficiently distinct/i,
  );

  service.mathematicalCalibrationPreviewStatus = {
    contractVersion: "1.1.0",
    sessionId: started.sessionId,
    active: false,
    overlay: assessMathematicalCalibrationV1_1Preview({ acceptedPoses: [] }),
    cameraOwnership: "released",
    reconnectAllowed: true,
  };
  await assert.rejects(
    service.captureMathematicalCalibrationV1_1Step({
      sessionId: started.sessionId,
      operationId: "flat-field-1-1",
      role: "flat_field",
      sampleIndex: 1,
      channelIndex: 1,
      targetFace: "blank_reverse",
    }),
    /hardware boundary must not run in this test/,
  );

  const request = new EventEmitter();
  request.headers = { "x-ai-grader-mathematical-calibration-session-id": started.sessionId };
  const response = new EventEmitter();
  response.destroyed = false;
  response.setHeader = () => response;
  response.writeHead = () => undefined;
  response.write = () => true;
  response.end = () => { response.destroyed = true; };
  const stream = service.streamPreview(request, response, undefined);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const preview = service.previewStatus();
  assert.equal(preview.status, "live");
  assert.equal(preview.frameCount > 0, true);
  assert.equal(preview.positioningLightReady, false, "calibration preview does not depend on Production positioning-light readiness");
  assert.equal(preview.frameSource, "mock_station_preview");
  assert.equal(preview.mathematicalCalibrationPreview.active, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(service.previewStatus().mathematicalCalibrationPreview.overlay.valid, true);
  const reconnectRequest = new EventEmitter();
  reconnectRequest.headers = { "x-ai-grader-mathematical-calibration-session-id": started.sessionId };
  const reconnectResponse = new EventEmitter();
  reconnectResponse.destroyed = false;
  let reconnectStatus;
  let reconnectBody = "";
  reconnectResponse.setHeader = () => reconnectResponse;
  reconnectResponse.writeHead = (statusCode) => { reconnectStatus = statusCode; };
  reconnectResponse.write = () => true;
  reconnectResponse.end = (body) => { reconnectBody += body ?? ""; reconnectResponse.destroyed = true; };
  await service.streamPreview(reconnectRequest, reconnectResponse, undefined);
  assert.equal(reconnectStatus, 409);
  assert.match(reconnectBody, /AI_GRADER_PREVIEW_STREAM_ALREADY_ACTIVE/);
  request.emit("close");
  await stream;
});

test("V1.0.1 displayed-frame preflight rejects wrong session, epoch, and slot without hardware work", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-preview-lifecycle-"));
  const fixture = await v1BridgeFixture(root);
  const wrong = mockPreviewExchange("wrong-calibration-session");
  await fixture.service.streamPreview(wrong.request, wrong.response, undefined);
  assert.equal(wrong.response.statusCode, 409);
  assert.match(wrong.response.body, /AI_GRADER_CALIBRATION_PREVIEW_SESSION_MISMATCH/);

  const first = mockPreviewExchange(fixture.sessionId);
  const firstStream = fixture.service.streamPreview(first.request, first.response, undefined);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const before = fixture.service.previewStatus();
  assert.equal(before.status, "live");
  assert.equal(before.cameraOwnership, "preview_stream");
  assert.equal(before.mathematicalCalibrationPreview.contractVersion, "1.0.1");
  assert.equal(before.mathematicalCalibrationPreview.sessionId, fixture.sessionId);
  const displayed = exactLatestDisplayedFrame(fixture);
  const initialSession = fixture.sessionSnapshot();
  const initialLifecycle = fixture.lifecycleSnapshot();
  assert.throws(
    () => fixture.service.acknowledgeMathematicalCalibrationDisplayedFrame({ ...displayed, sessionId: "wrong-request-session" }),
    /exact active V1\.0\.1 session/i,
  );
  assert.throws(
    () => fixture.service.acknowledgeMathematicalCalibrationDisplayedFrame({ ...displayed, epoch: `${displayed.epoch}-wrong` }),
    /active session and preview epoch/i,
  );
  await assert.rejects(
    fixture.service.authorizeMathematicalCalibrationDisplayedFrame(fixture.sessionId),
    /page-acknowledged frame/i,
  );
  await assert.rejects(
    fixture.service.captureMathematicalCalibrationStep({
      sessionId: "wrong-request-session", operationId: "v1-preview-wrong-request-session", role: "lens_geometry", sampleIndex: 1,
      targetFace: "checkerboard", captureAuthorizationId: "math-cal-auth-11111111111111111111111111111111",
    }),
    /exact active bridge-bound session/i,
  );
  assert.equal(fixture.hardStops.length, 0);
  assert.deepEqual(fixture.sessionSnapshot(), initialSession);
  assert.deepEqual(fixture.lifecycleSnapshot(), initialLifecycle);
  assert.equal(fixture.service.previewStatus().status, "live");
  assert.equal(fixture.service.previewStatus().cameraOwnership, "preview_stream");
  assert.equal(fixture.service.previewStatus().sideEpoch, displayed.epoch);

  await assert.rejects(
    fixture.service.captureMathematicalCalibrationStep({
      sessionId: fixture.sessionId, operationId: "v1-preview-wrong-slot", role: "lens_geometry", sampleIndex: 2,
      targetFace: "checkerboard", captureAuthorizationId: "math-cal-auth-22222222222222222222222222222222",
    }),
    /does not match exact next slot/i,
  );
  assert.equal(fixture.hardStops.length, 0);
  assert.deepEqual(fixture.sessionSnapshot(), initialSession);
  assert.deepEqual(fixture.lifecycleSnapshot(), initialLifecycle);
  assert.equal(fixture.service.previewStatus().status, "live");
  assert.equal(fixture.service.previewStatus().cameraOwnership, "preview_stream");
  assert.equal(fixture.service.previewStatus().sideEpoch, displayed.epoch);
  first.request.emit("close");
  await firstStream;
});

test("V1.0.1 rejects browser-supplied normalization geometry before preview or hardware lifecycle work", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-server-owned-geometry-"));
  const fixture = await v1BridgeFixture(root);
  const before = fixture.lifecycleSnapshot();
  await assert.rejects(
    fixture.service.captureMathematicalCalibrationStep({
      sessionId: fixture.sessionId,
      operationId: "browser-supplied-geometry",
      role: "lens_geometry",
      sampleIndex: 1,
      targetFace: "checkerboard",
      normalizationSourceOperationId: "external-or-cross-session-source",
    }),
    /server-owned.*may not be supplied/i,
  );
  assert.deepEqual(fixture.lifecycleSnapshot(), before);
  assert.equal(fixture.captures.length, 0);
  assert.equal(fixture.hardStops.length, 0);
  assert.equal(fixture.sessionSnapshot().captureCount, 0);
});

test("V1.0.1 exact displayed frame remains authoritative while continuous latest frames advance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-displayed-frame-advance-"));
  const fixture = await v1BridgeFixture(root);
  const first = mockPreviewExchange(fixture.sessionId);
  const firstStream = fixture.service.streamPreview(first.request, first.response, undefined);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const displayed = exactLatestDisplayedFrame(fixture);
  fixture.service.acknowledgeMathematicalCalibrationDisplayedFrame(displayed);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.notEqual(fixture.service.previewStatus().latestFrameId, displayed.frameId, "continuous preview must advance beyond the displayed frame");
  const authorization = await fixture.service.authorizeMathematicalCalibrationDisplayedFrame(fixture.sessionId);
  await firstStream;
  assert.equal(authorization.frameId, displayed.frameId);
  assert.match(authorization.frameSha256, /^[a-f0-9]{64}$/);
  assert.match(authorization.detectorAssessmentSha256, /^[a-f0-9]{64}$/);
  fixture.service.manifest.previewStatus.latestFrameId = "frame-continuously-advanced-after-authorization";
  fixture.service.manifest.previewStatus.lastFrameAt = new Date().toISOString();

  const captured = await fixture.service.captureMathematicalCalibrationStep({
    sessionId: fixture.sessionId, operationId: "v1-preview-success", role: "lens_geometry", sampleIndex: 1,
    targetFace: "checkerboard", captureAuthorizationId: authorization.authorizationId,
  });
  assert.equal(captured.captureCount, 1);
  assert.equal(fixture.captures.length, 1);
  assert.equal(fixture.captures[0].captureAuthorizationId, authorization.authorizationId);
  assert.equal(fixture.service.previewStatus().cameraOwnership, "released");
  assert.equal(fixture.service.previewStatus().mathematicalCalibrationPreview.active, false);

  const replayLifecycle = fixture.lifecycleSnapshot();
  await assert.rejects(
    fixture.service.captureMathematicalCalibrationStep({
      sessionId: fixture.sessionId, operationId: "v1-preview-replay", role: "lens_geometry", sampleIndex: 2,
      targetFace: "checkerboard", captureAuthorizationId: authorization.authorizationId,
    }),
    /missing, expired, replayed, mismatched, or changed displayed-frame authorization/i,
  );
  assert.deepEqual(fixture.lifecycleSnapshot(), replayLifecycle);
  assert.equal(fixture.hardStops.length, 0);
});

test("V1.0.1 wrong-slot use invalidates only the one-use authorization and fresh reconnect retries the same slot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-auth-wrong-slot-"));
  const fixture = await v1BridgeFixture(root);
  const first = mockPreviewExchange(fixture.sessionId);
  const firstStream = fixture.service.streamPreview(first.request, first.response, undefined);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const { authorization } = await acknowledgeLatestAndAuthorize(fixture);
  await firstStream;
  const pendingSession = fixture.sessionSnapshot();
  const afterAuthorizationLifecycle = fixture.lifecycleSnapshot();
  await assert.rejects(
    fixture.service.captureMathematicalCalibrationStep({
      sessionId: fixture.sessionId, operationId: "v1-preview-authorized-wrong-slot", role: "lens_geometry", sampleIndex: 2,
      targetFace: "checkerboard", captureAuthorizationId: authorization.authorizationId,
    }),
    /does not match exact next slot/i,
  );
  assert.equal(fixture.hardStops.length, 0);
  assert.deepEqual(fixture.sessionSnapshot(), pendingSession);
  assert.deepEqual(fixture.lifecycleSnapshot(), afterAuthorizationLifecycle);
  assert.equal(fixture.service.previewStatus().status, "stopped");
  assert.equal(fixture.service.previewStatus().cameraOwnership, "released");

  const second = mockPreviewExchange(fixture.sessionId);
  const secondStream = fixture.service.streamPreview(second.request, second.response, undefined);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const reconnected = fixture.service.previewStatus();
  assert.equal(reconnected.status, "live");
  assert.notEqual(reconnected.sideEpoch, authorization.epoch);
  const fresh = await acknowledgeLatestAndAuthorize(fixture);
  await secondStream;
  const retried = await fixture.service.captureMathematicalCalibrationStep({
    sessionId: fixture.sessionId, operationId: "v1-preview-retry-current", role: "lens_geometry", sampleIndex: 1,
    targetFace: "checkerboard", captureAuthorizationId: fresh.authorization.authorizationId,
  });
  assert.equal(retried.captureCount, 1);
  assert.equal(fixture.captures.length, 1);
  assert.equal(fixture.hardStops.length, 0);
  assert.equal(fixture.service.previewStatus().status, "stopped");
  assert.equal(fixture.service.previewStatus().cameraOwnership, "released");
  assert.equal(fixture.service.previewStatus().mathematicalCalibrationPreview.active, false);
});

test("V1.0.1 ordinary capture failure still drains preview, verifies terminal cleanup, releases camera, and remains non-hard-stop", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-preview-failure-"));
  const fixture = await v1BridgeFixture(root, { sessionId: "calibration-v1-failure-session", captureFailure: "ordinary exact-still detector rejection" });
  const exchange = mockPreviewExchange(fixture.sessionId);
  const stream = fixture.service.streamPreview(exchange.request, exchange.response, undefined);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const { authorization } = await acknowledgeLatestAndAuthorize(fixture);
  await stream;
  await assert.rejects(
    fixture.service.captureMathematicalCalibrationStep({
      sessionId: fixture.sessionId, operationId: "v1-preview-ordinary-failure", role: "lens_geometry", sampleIndex: 1,
      targetFace: "checkerboard", captureAuthorizationId: authorization.authorizationId,
    }),
    /ordinary exact-still detector rejection/,
  );
  const after = fixture.service.previewStatus();
  assert.equal(after.status, "stopped");
  assert.equal(after.cameraOwnership, "released");
  assert.equal(after.mathematicalCalibrationPreview.active, false);
  assert.equal(fixture.hardStops.length, 0);
});

test("V1.0.1 capture authorization expires and reconnect invalidates it without capture or hard stop", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-auth-invalidation-"));
  const fixture = await v1BridgeFixture(root);
  const first = mockPreviewExchange(fixture.sessionId);
  const firstStream = fixture.service.streamPreview(first.request, first.response, undefined);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const firstAuthorized = await acknowledgeLatestAndAuthorize(fixture);
  await firstStream;
  fixture.service.mathematicalCalibrationCaptureAuthorization.expiresAt = new Date(Date.now() - 1).toISOString();
  const beforeExpiredUse = fixture.lifecycleSnapshot();
  await assert.rejects(
    fixture.service.captureMathematicalCalibrationStep({
      sessionId: fixture.sessionId, operationId: "v1-preview-expired", role: "lens_geometry", sampleIndex: 1,
      targetFace: "checkerboard", captureAuthorizationId: firstAuthorized.authorization.authorizationId,
    }),
    /missing, expired, replayed, mismatched, or changed displayed-frame authorization/i,
  );
  assert.deepEqual(fixture.lifecycleSnapshot(), beforeExpiredUse);
  assert.equal(fixture.hardStops.length, 0);

  const second = mockPreviewExchange(fixture.sessionId);
  const secondStream = fixture.service.streamPreview(second.request, second.response, undefined);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const secondAuthorized = await acknowledgeLatestAndAuthorize(fixture);
  await secondStream;
  const reconnect = mockPreviewExchange(fixture.sessionId);
  const reconnectStream = fixture.service.streamPreview(reconnect.request, reconnect.response, undefined);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const beforeInvalidatedUse = fixture.lifecycleSnapshot();
  await assert.rejects(
    fixture.service.captureMathematicalCalibrationStep({
      sessionId: fixture.sessionId, operationId: "v1-preview-reconnect-invalidated", role: "lens_geometry", sampleIndex: 1,
      targetFace: "checkerboard", captureAuthorizationId: secondAuthorized.authorization.authorizationId,
    }),
    /missing, expired, replayed, mismatched, or changed displayed-frame authorization/i,
  );
  assert.deepEqual(fixture.lifecycleSnapshot(), beforeInvalidatedUse);
  assert.equal(fixture.service.previewStatus().status, "live");
  assert.equal(fixture.service.previewStatus().cameraOwnership, "preview_stream");
  reconnect.request.emit("close");
  await reconnectStream;
});

test("calibration preview uses a separate single-frame Pylon action and Production remains continuous", () => {
  const script = fsSync.readFileSync(
    path.join(__dirname, "..", "scripts", "basler-pylon-bridge.ps1"),
    "utf8",
  );
  assert.match(script, /calibration-preview-mjpeg-stream/);
  const calibrationStart = script.match(/function Start-CalibrationPreviewMjpegStream[\s\S]*?\n}\r?\n\r?\nfunction Add-OperatorPreviewTypes/);
  assert.ok(calibrationStart, "calibration preview action must have its own implementation");
  assert.doesNotMatch(calibrationStart[0], /live_preview_fast/);
  assert.match(calibrationStart[0], /StreamGrabber\.Start\(1\)/);
  assert.match(calibrationStart[0], /RetrieveResult\(1000, \[Basler\.Pylon\.TimeoutHandling\]::ThrowException\)/);
  assert.match(calibrationStart[0], /IsValid/);
  assert.match(calibrationStart[0], /PYLON_CALIBRATION_PREVIEW_NO_VALID_FRAME/);
  assert.match(calibrationStart[0], /AddSeconds\(10\)/);
  assert.match(calibrationStart[0], /while \(\$true\)/);
  assert.match(calibrationStart[0], /\$frameIndex -eq 0 -and \(Get-Date\) -ge \$deadline/);
  assert.doesNotMatch(calibrationStart[0], /while \(\(Get-Date\) -lt \$deadline\)/);
  const productionStart = script.match(/function Start-OperatorPreviewMjpegStream[\s\S]*?\n}\r?\n\r?\nfunction Start-CalibrationPreviewMjpegStream/);
  assert.ok(productionStart, "Production preview action must remain present");
  assert.match(productionStart[0], /GrabStrategy\]::LatestImages/);
  assert.match(productionStart[0], /TimeoutHandling\]::Return/);
});
