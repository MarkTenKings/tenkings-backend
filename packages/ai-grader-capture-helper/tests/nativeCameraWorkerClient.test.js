const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  NATIVE_CAMERA_FORENSIC_ROLES,
  NATIVE_CAMERA_PROTOCOL_VERSION,
  NATIVE_CAMERA_TRANSFORM_REUSED_ROLES,
  encodeNativeCameraProtocolMessage,
} = require("../dist/drivers/nativeCameraProtocol.js");
const {
  NativeCameraWorkerClient,
} = require("../dist/drivers/nativeCameraWorkerClient.js");
const {
  createNativeCameraFakeClient,
  createNativeCameraReplayClient,
} = require("../dist/drivers/nativeCameraReplayRunner.js");

const TEST_CONFIGURATION_ID = "rig-1";
const TEST_CONFIGURATION_SHA256 = "ead6d1e1451bb0ad5f4312bd1c8ddd87249a7bdffc03211cde8bbc9750841e1d";
const TEST_CALIBRATION_ID = "fake-calibration-v1";
const TEST_CALIBRATION_SHA256 = "98699abf844c40cc1537adf6125ff4547512c2d1fbbf1562fae0eadd97185b93";
const TEST_ORIENTATION = Object.freeze({
  rotationDegrees: 0,
  mirrorHorizontal: false,
  mirrorVertical: false,
  supportsMirrorHorizontal: false,
  supportsMirrorVertical: false,
});
const TEST_HOMOGRAPHY = Object.freeze([
  1199 / 400, 0, -(1199 * 100 / 400),
  0, 1679 / 560, -(1679 * 80 / 560),
  0, 0, 1,
]);

function rigAttestation(overrides = {}) {
  return {
    configurationId: TEST_CONFIGURATION_ID,
    configurationSha256: TEST_CONFIGURATION_SHA256,
    calibrationId: TEST_CALIBRATION_ID,
    calibrationSha256: TEST_CALIBRATION_SHA256,
    sensorOrientation: { ...TEST_ORIENTATION },
    ...overrides,
  };
}

function forensicPackage(overrides = {}) {
  return {
    packageId: `${"1".repeat(64)}.back`,
    packageSha256: "2".repeat(64),
    manifestSha256: "3".repeat(64),
    capturePlanSha256: "4".repeat(64),
    idempotent: false,
    ...overrides,
  };
}

function copyEnvelope(command) {
  return {
    protocolVersion: command.protocolVersion,
    requestId: command.requestId,
    sessionId: command.sessionId,
    workerEpoch: command.workerEpoch,
    sessionEpoch: command.sessionEpoch,
    previewEpoch: command.previewEpoch,
    sideEpoch: command.sideEpoch,
    side: command.side,
    timeoutMs: command.timeoutMs,
    deadlineUnixMs: command.deadlineUnixMs,
  };
}

function timingSnapshot(overrides = {}) {
  return {
    spawnToInitializeMs: null,
    pylonInitializeMs: null,
    cameraDiscoveryMs: null,
    cameraOpenMs: null,
    cameraConfigureMs: null,
    firstPreviewFrameMs: null,
    detectMs: null,
    encodeMs: null,
    emitMs: null,
    drainMs: null,
    modeSwitchMs: null,
    lightingAcknowledgementMs: null,
    firstForensicFrameMs: null,
    forensicGrabMs: null,
    forensicWriteMs: null,
    forensicHashMs: null,
    resumeMs: null,
    droppedFrames: 0,
    ...overrides,
  };
}

class FakeWorker extends EventEmitter {
  constructor(onCommand) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.commands = [];
    this.kills = 0;
    this.inboundSequence = 0;
    this.pendingSafeOff = null;
    this.onCommand = onCommand;
    this.stdin = new EventEmitter();
    this.stdin.write = (chunk) => {
      const command = JSON.parse(Buffer.from(chunk).toString("utf8").trim());
      this.commands.push(command);
      queueMicrotask(() => this.onCommand?.(command, this));
      return true;
    };
    this.stdin.end = () => {};
  }

  result(command, payload, options = {}) {
    const successfulPayload = options.ok === false ? null : { ...payload, timing: payload.timing ?? timingSnapshot() };
    const message = {
      ...copyEnvelope(command),
      kind: "result",
      command: command.command,
      sequence: options.sequence ?? ++this.inboundSequence,
      ok: options.ok ?? true,
      payload: successfulPayload,
      error: options.ok === false
        ? { code: options.code ?? "FAKE_FAILURE", message: options.message ?? "Fake failure.", retryable: false }
        : null,
    };
    this.stdout.write(encodeNativeCameraProtocolMessage(message));
    return message;
  }

  event(command, event, payload, options = {}) {
    const message = {
      ...copyEnvelope(command),
      kind: "event",
      event,
      requestId: options.requestId ?? command.requestId,
      workerEpoch: options.workerEpoch ?? command.workerEpoch,
      sessionEpoch: options.sessionEpoch ?? command.sessionEpoch,
      previewEpoch: options.previewEpoch ?? command.previewEpoch,
      sideEpoch: options.sideEpoch ?? command.sideEpoch,
      side: options.side ?? command.side,
      sequence: options.sequence ?? ++this.inboundSequence,
      payload,
    };
    const bytes = options.raw ? Buffer.from(`${JSON.stringify(message)}\n`) : encodeNativeCameraProtocolMessage(message);
    this.stdout.write(bytes);
    return message;
  }

  requestSafeOff(command, reason, stateBeforeCompletion, onConfirmed) {
    assert.equal(this.pendingSafeOff, null);
    const safeOffRequestId = "safe-off-" + command.requestId;
    this.pendingSafeOff = { safeOffRequestId, stateBeforeCompletion, onConfirmed };
    this.event(command, "safe_off_requested", { safeOffRequestId, reason }, { requestId: safeOffRequestId });
  }

  completeSafeOff(command) {
    const pending = this.pendingSafeOff;
    assert.ok(pending);
    assert.equal(command.payload.safeOffRequestId, pending.safeOffRequestId);
    assert.equal(command.payload.safe, true);
    this.result(command, { state: pending.stateBeforeCompletion });
    this.pendingSafeOff = null;
    pending.onConfirmed();
  }

  kill() {
    this.kills += 1;
    queueMicrotask(() => this.emit("exit", null, "SIGKILL"));
    return true;
  }
}

function frame(command, frameId, overrides = {}) {
  return {
    frameId,
    blockId: String(1000 + Number(frameId.replace(/\D/g, "") || 0)),
    hardwareTimestampTicks: "18446744073709551615",
    workerEpoch: command.workerEpoch,
    sessionEpoch: command.sessionEpoch,
    previewEpoch: command.previewEpoch,
    sideEpoch: command.sideEpoch,
    side: command.side,
    ...overrides,
  };
}

function geometry(identity, overrides = {}) {
  const sourceCorners = {
    topLeft: { x: 100, y: 80 },
    topRight: { x: 500, y: 80 },
    bottomRight: { x: 500, y: 640 },
    bottomLeft: { x: 100, y: 640 },
  };
  return {
    detectorVersion: "native_four_edge_v2",
    detector: "fused_four_edge",
    status: "ready",
    reasonCodes: ["none"],
    sourceCorners,
    normalizedCorners: {
      topLeft: { x: 0, y: 0 }, topRight: { x: 1199, y: 0 },
      bottomRight: { x: 1199, y: 1679 }, bottomLeft: { x: 0, y: 1679 },
    },
    fittedLines: [
      { edge: "top", a: 0, b: 1, c: -80 },
      { edge: "right", a: 1, b: 0, c: -500 },
      { edge: "bottom", a: 0, b: 1, c: -640 },
      { edge: "left", a: 1, b: 0, c: -100 },
    ].map((line) => ({ ...line, support: 0.95, continuity: 0.94, residualPixels: 0.7 })),
    sourceWidth: 640,
    sourceHeight: 720,
    normalizedWidth: 1200,
    normalizedHeight: 1680,
    sourceToNormalizedHomography: [...TEST_HOMOGRAPHY],
    calibration: { id: TEST_CALIBRATION_ID, sha256: TEST_CALIBRATION_SHA256 },
    sensorOrientation: { ...TEST_ORIENTATION },
    currentFrameAuthority: { normalizationSafe: true, captureReady: true, rejectionCodes: [] },
    center: { x: 300, y: 360 },
    scale: 1,
    rotationDegrees: 0,
    confidence: 0.96,
    metrics: {
      perEdgeSupport: { top: 0.95, right: 0.95, bottom: 0.95, left: 0.95 },
      edgeSupport: 0.95, continuity: 0.94, residualPixels: 0.7, convexity: 0.99,
      aspectRatio: 1.4, aspectScore: 0.99, coverage: 0.5, clearance: 0.1,
      clearanceFraction: 0.05, fullVisibility: true, perspective: 0.98, perspectiveSkew: 0.02,
    },
    frame: identity,
    detectMonotonicMs: 12,
    processingMs: 4,
    frameAgeMs: 10,
    droppedFrames: 0,
    frozen: false,
    stale: false,
    motionDelta: 0.2,
    hysteresis: {
      currentEvidenceReady: true,
      consecutiveReadyFrames: 3,
      requiredReadyFrames: 3,
      removalFenceSatisfied: true,
    },
    ...overrides,
    frame: identity,
  };
}

function previewPayload(command, frameId, overrides = {}) {
  const bytes = Buffer.from([0xff, 0xd8, Number(frameId.replace(/\D/g, "")) || 1, 0xff, 0xd9]);
  const identity = frame(command, frameId, overrides.frame);
  const detected = geometry(identity, overrides.geometry);
  return {
    frame: identity,
    jpeg: {
      mimeType: "image/jpeg",
      width: 640,
      height: 720,
      base64: bytes.toString("base64"),
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    geometry: detected,
    telemetry: {
      receiveMonotonicMs: 10,
      detectMonotonicMs: 12,
      encodeMonotonicMs: 14,
      emitMonotonicMs: 15,
      processingMs: detected.processingMs,
      frameAgeMs: detected.frameAgeMs,
      droppedFrames: detected.droppedFrames,
      frozen: detected.frozen,
    },
  };
}

function forensicResultPayload(command) {
  const mimeType = command.payload.forensicProfile === "production_fast" ? "image/tiff" : "image/png";
  const extension = mimeType === "image/tiff" ? "tiff" : "png";
  const artifacts = NATIVE_CAMERA_FORENSIC_ROLES.map((role, index) => ({
    role,
    fileName: `${role}.${extension}`,
    sha256: String(index).padStart(64, "0"),
    byteSize: 100 + index,
    mimeType,
    width: 2448,
    height: 2048,
    frame: frame(command, `capture-${index}`),
    capturedAtUnixMs: Date.now(),
    writeDurationMs: 2,
    hashDurationMs: 1,
  }));
  const allOn = artifacts[1];
  return {
    state: "idle_safe",
    captureId: command.payload.captureId,
    forensicProfile: command.payload.forensicProfile,
    artifacts,
    authoritativeAllOnGeometry: geometry(allOn.frame, {
      sourceWidth: allOn.width,
      sourceHeight: allOn.height,
      hysteresis: {
        currentEvidenceReady: true,
        consecutiveReadyFrames: 1,
        requiredReadyFrames: 3,
        removalFenceSatisfied: true,
      },
    }),
    authoritativeTransform: {
      sourceFrameId: allOn.frame.frameId,
      sourceSha256: allOn.sha256,
      sourceWidth: allOn.width,
      sourceHeight: allOn.height,
      normalizedWidth: 1200,
      normalizedHeight: 1680,
      homography: [...TEST_HOMOGRAPHY],
      reusedByRoles: [...NATIVE_CAMERA_TRANSFORM_REUSED_ROLES],
    },
    rigConfiguration: rigAttestation(),
    package: forensicPackage(),
    captureDurationMs: 100,
    droppedFrames: 0,
    timing: timingSnapshot(),
  };
}

function writeUntrustedRawResult(worker, command, payload) {
  worker.stdout.write(Buffer.from(`${JSON.stringify({
    ...copyEnvelope(command),
    kind: "result",
    command: command.command,
    sequence: ++worker.inboundSequence,
    ok: true,
    payload,
    error: null,
  })}\n`));
}

function healthPayload(state = "idle_safe") {
  return {
    state,
    healthy: true,
    backend: "fake",
    cameraOpen: true,
    rigConfigurationVerified: true,
    automaticFallbackAttempted: false,
  };
}

function basicHandler(command, worker) {
  if (command.command === "initialize") worker.result(command, { state: "idle_safe", rigConfiguration: rigAttestation() });
  else if (command.command === "health") worker.result(command, healthPayload());
  else if (command.command === "capabilities") {
    worker.result(command, {
      state: "idle_safe",
      backends: ["fake", "replay", "pylon"],
      forensicRoles: [...NATIVE_CAMERA_FORENSIC_ROLES],
      normalizedWidth: 1200,
      normalizedHeight: 1680,
      queueDepth: 1,
    });
  } else if (command.command === "set_side") worker.result(command, { state: "idle_safe" });
  else if (command.command === "start_preview" || command.command === "resume_preview") worker.result(command, { state: "previewing" });
  else if (command.command === "stop_drain") worker.result(command, { state: "capture_ready" });
  else if (command.command === "safe_idle") {
    worker.requestSafeOff(command, "safe_idle_requested", "capture_ready", () => worker.result(command, { state: "idle_safe" }));
  } else if (command.command === "shutdown") {
    worker.requestSafeOff(command, "worker_shutdown", "idle_safe", () => worker.result(command, { state: "shutdown" }));
  } else if (command.command === "safe_off_completion") worker.completeSafeOff(command);
}

function lightingSpy() {
  const calls = [];
  return {
    calls,
    coordinator: {
      async requestEvidenceRoleProfile(request) {
        calls.push(["profile", request.role]);
        return { profileRequestId: `profile-${request.role}`, accepted: true };
      },
      async waitForStableLight(context) {
        calls.push(["stable", context.role]);
        return { stable: true, acknowledgementId: `stable-${context.role}`, stableAtUnixMs: Date.now(), acknowledgementDurationMs: 1 };
      },
      async authorizeOneGrab(context) {
        calls.push(["authorize", context.role]);
        return { authorized: true, authorizationId: `auth-${context.role}`, authorizedAtUnixMs: Date.now(), expiresAtUnixMs: Date.now() + 5000 };
      },
      async completeEvidenceRole(completion) {
        calls.push(["complete", completion.role]);
      },
      async safeOff(reason) {
        calls.push(["safe_off", reason]);
        return { safe: true, completedAtUnixMs: Date.now() };
      },
    },
  };
}

function newClient(worker, lighting, overrides = {}) {
  return createNativeCameraFakeClient({
    sessionId: "session-1",
    sessionEpoch: 1,
    configurationId: TEST_CONFIGURATION_ID,
    configurationSha256: TEST_CONFIGURATION_SHA256,
    spawnWorker: () => worker,
    lighting,
    defaultTimeoutMs: 100,
    ...overrides,
  });
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("disabled client never invokes its worker factory or Pylon", async () => {
  let spawned = 0;
  const client = new NativeCameraWorkerClient({
    sessionId: "session-disabled",
    sessionEpoch: 1,
    configurationId: "disabled-config",
    configurationSha256: TEST_CONFIGURATION_SHA256,
    spawnWorker: () => { spawned += 1; throw new Error("must not spawn"); },
  });
  await assert.rejects(client.start(), /disabled by default/i);
  assert.equal(spawned, 0);

  const replay = createNativeCameraReplayClient({
    sessionId: "session-replay",
    sessionEpoch: 1,
    configurationId: "replay-config",
    configurationSha256: TEST_CONFIGURATION_SHA256,
    spawnWorker: () => { throw new Error("not started"); },
  });
  assert.equal(replay.publicHealth().selection, "replay");
  assert.equal(replay.publicHealth().automaticFallbackAttempted, false);

  assert.throws(
    () => new NativeCameraWorkerClient({
      sessionId: "session-bad-digest",
      sessionEpoch: 1,
      configurationId: "rig-config-v1",
      configurationSha256: "not-a-digest",
      spawnWorker: () => worker,
    }),
    /configurationSha256/i,
  );
});

test("one persistent worker owns preview/drain/resume and the preview queue drops to depth one", async () => {
  const safe = lightingSpy();
  const worker = new FakeWorker(basicHandler);
  let spawns = 0;
  const client = newClient(worker, safe.coordinator, { spawnWorker: () => { spawns += 1; return worker; } });
  await client.start();
  const initialize = worker.commands.find((entry) => entry.command === "initialize");
  assert.deepEqual(Object.keys(initialize.payload).sort(), ["configurationId", "configurationSha256"]);
  assert.equal(initialize.payload.configurationSha256, TEST_CONFIGURATION_SHA256);
  await client.setSide({ side: "front", sideEpoch: 1 });
  await client.startPreview({ previewEpoch: 1 });
  const start = worker.commands.find((entry) => entry.command === "start_preview");
  assert.deepEqual(start.payload, {});
  worker.event(start, "preview_frame", previewPayload(start, "frame-1"));
  worker.event(start, "preview_frame", previewPayload(start, "frame-2"));
  await tick();
  assert.equal(client.publicHealth().previewQueueDepth, 1);
  assert.equal(client.publicHealth().clientDroppedPreviewFrames, 1);
  assert.equal(client.consumeLatestPreview().frame.frameId, "frame-2");
  assert.equal(client.consumeLatestPreview(), null);
  await client.stopAndDrain();
  await client.safeIdle();
  assert.ok(safe.calls.some(([name, reason]) => name === "safe_off" && reason === "safe_idle"));
  await client.resumePreview({ previewEpoch: 2 });
  const resume = worker.commands.find((entry) => entry.command === "resume_preview");
  assert.deepEqual(resume.payload, {});
  assert.equal(spawns, 1);
  assert.equal(worker.commands.filter((entry) => entry.command === "initialize").length, 1);
  await client.shutdown();
  assert.ok(safe.calls.some(([name, reason]) => name === "safe_off" && reason === "client_shutdown"));
});

test("start preview accepts a correlated frame coalesced behind its result in one stdout chunk", async () => {
  const safe = lightingSpy();
  const worker = new FakeWorker((command, target) => {
    if (command.command !== "start_preview") {
      basicHandler(command, target);
      return;
    }
    const result = {
      ...copyEnvelope(command),
      kind: "result",
      command: command.command,
      sequence: ++target.inboundSequence,
      ok: true,
      payload: { state: "previewing", timing: timingSnapshot() },
      error: null,
    };
    const preview = {
      ...copyEnvelope(command),
      kind: "event",
      event: "preview_frame",
      sequence: ++target.inboundSequence,
      payload: previewPayload(command, "frame-coalesced"),
    };
    target.stdout.write(Buffer.concat([
      encodeNativeCameraProtocolMessage(result),
      encodeNativeCameraProtocolMessage(preview),
    ]));
  });
  const client = newClient(worker, safe.coordinator);

  await client.start();
  await client.setSide({ side: "front", sideEpoch: 1 });
  await client.startPreview({ previewEpoch: 1 });

  assert.equal(client.publicHealth().state, "previewing");
  assert.equal(client.consumeLatestPreview()?.frame.frameId, "frame-coalesced");
  assert.equal(worker.kills, 0);
  await client.stopAndDrain();
  await client.safeIdle();
  await client.shutdown();
});

test("safe idle is idempotent after initialization without a redundant lighting operation", async () => {
  const safe = lightingSpy();
  const worker = new FakeWorker((command, target) => {
    if (command.command === "safe_idle") target.result(command, { state: "idle_safe" });
    else basicHandler(command, target);
  });
  const client = newClient(worker, safe.coordinator);

  await client.start();
  await client.safeIdle();

  assert.equal(client.publicHealth().state, "idle_safe");
  assert.equal(worker.kills, 0);
  assert.equal(safe.calls.some(([name]) => name === "safe_off"), false);
  await client.shutdown();
});

test("a valid in-flight preview during drain is fully checked and discarded without faulting", async () => {
  const safe = lightingSpy();
  let drainCommand;
  const worker = new FakeWorker((command, target) => {
    if (command.command === "stop_drain") {
      drainCommand = command;
      return;
    }
    basicHandler(command, target);
  });
  const client = newClient(worker, safe.coordinator);
  await client.start();
  await client.setSide({ side: "front", sideEpoch: 1 });
  await client.startPreview({ previewEpoch: 1 });
  const start = worker.commands.find((entry) => entry.command === "start_preview");
  worker.event(start, "preview_frame", previewPayload(start, "frame-before-drain"));
  await tick();
  assert.equal(client.publicHealth().previewQueueDepth, 1);

  const draining = client.stopAndDrain();
  await tick();
  assert.ok(drainCommand);
  worker.event(start, "preview_frame", previewPayload(start, "frame-in-flight"));
  await tick();
  assert.equal(client.publicHealth().lifecycle, "running");
  assert.equal(client.publicHealth().previewQueueDepth, 0);
  assert.equal(client.consumeLatestPreview(), null);
  assert.equal(worker.kills, 0);
  assert.equal(safe.calls.some(([name]) => name === "safe_off"), false);

  worker.result(drainCommand, { state: "capture_ready" });
  await draining;
  assert.equal(client.publicHealth().state, "capture_ready");
  await client.shutdown();
});

test("reserved terminal-fault events preserve the bounded worker fault code", async () => {
  const safe = lightingSpy();
  const worker = new FakeWorker(basicHandler);
  const client = newClient(worker, safe.coordinator);
  await client.start();
  const initialize = worker.commands.find((entry) => entry.command === "initialize");
  worker.event(
    initialize,
    "terminal_fault",
    { code: "CAMERA_LOST", message: "Native camera became unavailable." },
    { requestId: "terminal-fault" },
  );
  await client.waitForTerminalSafety();
  assert.equal(client.publicHealth().lifecycle, "faulted");
  assert.equal(client.publicHealth().lastError.code, "CAMERA_LOST");
  assert.equal(client.publicHealth().lastError.message, "Native camera became unavailable.");
  assert.equal(worker.kills, 1);
  assert.ok(safe.calls.some(([name, reason]) => name === "safe_off" && reason === "capture_failure"));
});

test("unsafe terminal-fault diagnostics never reach pending errors or public health", async () => {
  const safe = lightingSpy();
  const worker = new FakeWorker((command, target) => {
    if (command.command !== "health") basicHandler(command, target);
  });
  const client = newClient(worker, safe.coordinator);
  await client.start();
  const pending = client.health(10_000);
  const healthCommand = worker.commands.find((entry) => entry.command === "health");
  assert.ok(healthCommand);
  worker.event(
    healthCommand,
    "terminal_fault",
    { code: "CAMERA_LOST", message: "failed at C:\\private\\card.png token=private" },
    { requestId: "terminal-fault", raw: true },
  );
  await assert.rejects(
    pending,
    (error) =>
      error.code === "MALFORMED_PROTOCOL" &&
      !/private|card\.png|token=/i.test(error.message),
  );
  await client.waitForTerminalSafety();
  const publicJson = JSON.stringify(client.publicHealth());
  assert.equal(/private|card\.png|token=/i.test(publicJson), false);
  assert.equal(client.publicHealth().lastError.code, "MALFORMED_PROTOCOL");
  assert.equal(worker.kills, 1);
  assert.ok(safe.calls.some(([name]) => name === "safe_off"));
});

test("client bounds in-flight commands and terminally rejects stdin backpressure", async (t) => {
  await t.test("the thirty-third active command fails before another write or timer", async () => {
    const safe = lightingSpy();
    const worker = new FakeWorker((command, target) => {
      if (command.command !== "health") basicHandler(command, target);
    });
    const client = newClient(worker, safe.coordinator);
    await client.start();
    const requests = Array.from({ length: 33 }, () => client.health(10_000));
    const settled = await Promise.allSettled(requests);
    await client.waitForTerminalSafety();
    assert.equal(worker.commands.filter((entry) => entry.command === "health").length, 32);
    assert.equal(settled.every((entry) => entry.status === "rejected"), true);
    assert.equal(settled[32].reason.code, "CLIENT_COMMAND_LIMIT");
    assert.equal(worker.kills, 1);
    assert.ok(safe.calls.some(([name, reason]) => name === "safe_off" && reason === "invalid_order"));
  });

  await t.test("write false terminally fails instead of buffering another command", async () => {
    const safe = lightingSpy();
    const worker = new FakeWorker(basicHandler);
    const client = newClient(worker, safe.coordinator);
    await client.start();
    const originalWrite = worker.stdin.write;
    worker.stdin.write = (chunk) => {
      const command = JSON.parse(Buffer.from(chunk).toString("utf8").trim());
      if (command.command !== "health") return originalWrite(chunk);
      worker.commands.push(command);
      return false;
    };
    await assert.rejects(
      client.health(10_000),
      (error) => error.code === "WORKER_STDIN_BACKPRESSURE",
    );
    await client.waitForTerminalSafety();
    assert.equal(worker.commands.filter((entry) => entry.command === "health").length, 1);
    assert.equal(client.publicHealth().lastError.code, "WORKER_STDIN_BACKPRESSURE");
    assert.equal(worker.kills, 1);
    assert.ok(safe.calls.some(([name, reason]) => name === "safe_off" && reason === "worker_exit"));
  });
});

test("same-frame JPEG/geometry coherence and stale or unreported frozen Ready fail terminally", async () => {
  for (const mode of ["hash", "frozen", "stale"]) {
    const safe = lightingSpy();
    const worker = new FakeWorker(basicHandler);
    const client = newClient(worker, safe.coordinator);
    await client.start();
    await client.setSide({ side: "front", sideEpoch: 1 });
    await client.startPreview({ previewEpoch: 1 });
    const start = worker.commands.find((entry) => entry.command === "start_preview");
    const first = previewPayload(start, "frame-1");
    worker.event(start, "preview_frame", first);
    if (mode === "hash") {
      const bad = previewPayload(start, "frame-2");
      bad.jpeg.sha256 = "0".repeat(64);
      worker.event(start, "preview_frame", bad);
    } else if (mode === "frozen") {
      worker.event(start, "preview_frame", previewPayload(start, "frame-1"));
    } else {
      const stale = previewPayload(start, "frame-2", { geometry: { frameAgeMs: 1000 } });
      stale.telemetry.frameAgeMs = 1000;
      worker.event(start, "preview_frame", stale);
    }
    await tick();
    await client.waitForTerminalSafety();
    assert.equal(client.publicHealth().lifecycle, "faulted", mode);
    assert.equal(worker.kills, 1, mode);
    assert.ok(safe.calls.some(([name]) => name === "safe_off"), mode);
  }
});

test("invalid client transition is terminal and invokes injected safe-off", async () => {
  const safe = lightingSpy();
  const worker = new FakeWorker(basicHandler);
  const client = newClient(worker, safe.coordinator);
  await client.start();
  await assert.rejects(client.stopAndDrain(), /Expected previewing/i);
  await client.waitForTerminalSafety();
  assert.equal(worker.kills, 1);
  assert.ok(safe.calls.some(([name, reason]) => name === "safe_off" && reason === "invalid_order"));
});

test("negative terminal safe-off receipt is recorded as a safety failure", async () => {
  const safe = lightingSpy();
  safe.coordinator.safeOff = async (reason) => {
    safe.calls.push(["safe_off", reason]);
    return { safe: false, completedAtUnixMs: Date.now() };
  };
  const worker = new FakeWorker(basicHandler);
  const client = newClient(worker, safe.coordinator);
  await client.start();
  await assert.rejects(client.stopAndDrain(), /Expected previewing/i);
  await client.waitForTerminalSafety();
  assert.equal(worker.kills, 1);
  assert.equal(client.publicHealth().lastError.code, "SAFE_OFF_FAILED");
});

test("wrong epoch, duplicate result, malformed, truncated, timeout, and crash each kill and safe-off with no fallback", async (t) => {
  await t.test("wrong epoch", async () => {
    const safe = lightingSpy();
    const worker = new FakeWorker(basicHandler);
    const client = newClient(worker, safe.coordinator);
    await client.start();
    await client.setSide({ side: "front", sideEpoch: 1 });
    await client.startPreview({ previewEpoch: 1 });
    const start = worker.commands.find((entry) => entry.command === "start_preview");
    const bad = previewPayload({ ...start, previewEpoch: 2 }, "frame-epoch");
    worker.event(start, "preview_frame", bad, { previewEpoch: 2 });
    await client.waitForTerminalSafety();
    assert.equal(worker.kills, 1);
    assert.equal(client.publicHealth().automaticFallbackAttempted, false);
  });

  await t.test("duplicate result", async () => {
    const safe = lightingSpy();
    const worker = new FakeWorker((command, target) => {
      basicHandler(command, target);
      if (command.command === "initialize") {
        queueMicrotask(() => target.result(command, {
          state: "idle_safe",
          rigConfiguration: rigAttestation(),
        }));
      }
    });
    const client = newClient(worker, safe.coordinator);
    await client.start();
    await tick();
    await client.waitForTerminalSafety();
    assert.equal(worker.kills, 1);
    assert.ok(safe.calls.some(([name]) => name === "safe_off"));
  });

  await t.test("out-of-order sequence", async () => {
    const safe = lightingSpy();
    const worker = new FakeWorker(basicHandler);
    const client = newClient(worker, safe.coordinator);
    await client.start();
    const initialize = worker.commands.find((entry) => entry.command === "initialize");
    worker.event(initialize, "terminal_fault", { code: "FAKE_FAULT", message: "redacted fake fault" }, {
      sequence: worker.inboundSequence,
    });
    await client.waitForTerminalSafety();
    assert.equal(worker.kills, 1);
    assert.ok(safe.calls.some(([name, reason]) => name === "safe_off" && reason === "invalid_order"));
  });

  await t.test("sequence gap", async () => {
    const safe = lightingSpy();
    const worker = new FakeWorker(basicHandler);
    const client = newClient(worker, safe.coordinator);
    await client.start();
    const initialize = worker.commands.find((entry) => entry.command === "initialize");
    worker.event(initialize, "terminal_fault", { code: "FAKE_FAULT", message: "redacted fake fault" }, {
      sequence: worker.inboundSequence + 2,
    });
    await client.waitForTerminalSafety();
    assert.equal(worker.kills, 1);
    assert.equal(client.publicHealth().lastError.code, "OUT_OF_ORDER_MESSAGE");
    assert.ok(safe.calls.some(([name, reason]) => name === "safe_off" && reason === "invalid_order"));
  });

  for (const mode of ["malformed", "truncated", "clean_stdout_eof", "stdin_epipe", "crash"]) {
    await t.test(mode, async () => {
      const safe = lightingSpy();
      const worker = new FakeWorker(basicHandler);
      const client = newClient(worker, safe.coordinator);
      await client.start();
      if (mode === "malformed") worker.stdout.write("{bad}\n");
      if (mode === "truncated") { worker.stdout.write('{"protocolVersion":'); worker.stdout.end(); }
      if (mode === "clean_stdout_eof") worker.stdout.end();
      if (mode === "stdin_epipe") worker.stdin.emit("error", new Error("simulated EPIPE"));
      if (mode === "crash") worker.emit("exit", 9, null);
      await tick();
      await client.waitForTerminalSafety();
      assert.equal(worker.kills, 1, mode);
      assert.ok(safe.calls.some(([name]) => name === "safe_off"), mode);
    });
  }

  await t.test("timeout", async () => {
    const safe = lightingSpy();
    const worker = new FakeWorker((command, target) => {
      if (command.command !== "health") basicHandler(command, target);
    });
    const client = newClient(worker, safe.coordinator);
    await client.start();
    await assert.rejects(client.health(10), /timed out/i);
    await client.waitForTerminalSafety();
    assert.equal(worker.kills, 1);
    assert.equal(client.publicHealth().automaticFallbackAttempted, false);
  });

  await t.test("late result", async () => {
    const safe = lightingSpy();
    let now = 1_000;
    let healthCommand;
    const worker = new FakeWorker((command, target) => {
      if (command.command === "health") {
        healthCommand = command;
        return;
      }
      basicHandler(command, target);
    });
    const client = newClient(worker, safe.coordinator, { nowUnixMs: () => now });
    await client.start();
    const health = client.health(80);
    await tick();
    now = healthCommand.deadlineUnixMs + 1;
    worker.result(healthCommand, healthPayload());
    await assert.rejects(health, /deadline/i);
    await client.waitForTerminalSafety();
    assert.equal(worker.kills, 1);
    assert.ok(safe.calls.some(([name, reason]) => name === "safe_off" && reason === "worker_timeout"));
  });
});

test("lighting events are serialized and a later profile cannot start before the prior role completes", async () => {
  const safe = lightingSpy();
  const worker = new FakeWorker((command, target) => {
    if (command.command === "execute_forensic_plan") {
      target.event(command, "lighting_profile_requested", {
        captureRequestId: command.requestId,
        role: "dark_control",
        ordinal: 0,
      });
      target.event(command, "lighting_profile_requested", {
        captureRequestId: command.requestId,
        role: "all_on",
        ordinal: 1,
      });
      return;
    }
    if (command.command === "lighting_ack") {
      target.result(command, { state: "capturing" });
      return;
    }
    basicHandler(command, target);
  });
  const client = newClient(worker, safe.coordinator);
  await client.start();
  await client.setSide({ side: "front", sideEpoch: 1 });
  await client.startPreview({ previewEpoch: 1 });
  await client.stopAndDrain();
  await assert.rejects(
    client.executeForensicSidePlan({ captureId: "capture-overlap", forensicProfile: "full_forensic" }),
  );
  await client.waitForTerminalSafety();
  assert.deepEqual(safe.calls.filter(([name]) => name === "profile"), [["profile", "dark_control"]]);
  assert.equal(worker.kills, 1);
  assert.ok(safe.calls.some(([name]) => name === "safe_off"));
});

test("hung injected lighting and terminal safe-off operations are bounded and fail closed", async (t) => {
  await t.test("profile request", async () => {
    const safe = lightingSpy();
    safe.coordinator.requestEvidenceRoleProfile = () => new Promise(() => {});
    const worker = new FakeWorker((command, target) => {
      if (command.command === "execute_forensic_plan") {
        target.event(command, "lighting_profile_requested", {
          captureRequestId: command.requestId,
          role: "dark_control",
          ordinal: 0,
        });
        return;
      }
      basicHandler(command, target);
    });
    const client = newClient(worker, safe.coordinator, { defaultTimeoutMs: 30 });
    await client.start();
    await client.setSide({ side: "front", sideEpoch: 1 });
    await client.startPreview({ previewEpoch: 1 });
    await client.stopAndDrain();
    await assert.rejects(
      client.executeForensicSidePlan({
        captureId: "capture-hung-profile",
        forensicProfile: "full_forensic",
        timeoutMs: 30,
      }),
    );
    await client.waitForTerminalSafety();
    assert.equal(worker.kills, 1);
    assert.ok(safe.calls.some(([name]) => name === "safe_off"));
  });

  await t.test("terminal safe-off", async () => {
    const safe = lightingSpy();
    safe.coordinator.safeOff = () => new Promise(() => {});
    const worker = new FakeWorker(basicHandler);
    const client = newClient(worker, safe.coordinator, { defaultTimeoutMs: 25 });
    await client.start();
    await assert.rejects(client.stopAndDrain(), /Expected previewing/i);
    await client.waitForTerminalSafety();
    assert.equal(worker.kills, 1);
    assert.equal(client.publicHealth().lastError.code, "SAFE_OFF_FAILED");
  });
});

test("capture failure is terminal, safe-offs, and never starts a fallback worker", async () => {
  const safe = lightingSpy();
  let spawns = 0;
  const worker = new FakeWorker((command, target) => {
    if (command.command === "execute_forensic_plan") {
      target.result(command, null, { ok: false, code: "FAKE_CAPTURE_FAILURE", message: "Fake capture failed." });
      return;
    }
    basicHandler(command, target);
  });
  const client = newClient(worker, safe.coordinator, { spawnWorker: () => { spawns += 1; return worker; } });
  await client.start();
  await client.setSide({ side: "front", sideEpoch: 1 });
  await client.startPreview({ previewEpoch: 1 });
  await client.stopAndDrain();
  await assert.rejects(
    client.executeForensicSidePlan({ captureId: "capture-fail", forensicProfile: "full_forensic" }),
    /Fake capture failed/i,
  );
  await client.waitForTerminalSafety();
  assert.equal(spawns, 1);
  assert.equal(worker.kills, 1);
  assert.ok(safe.calls.some(([name, reason]) => name === "safe_off" && reason === "capture_failure"));
  assert.equal(client.publicHealth().automaticFallbackAttempted, false);
});

test("stale or missing-BlockID lighting grab completion is rejected before the injected completion side effect", async (t) => {
  for (const variant of ["wrong_epoch", "missing_block_id"]) {
    await t.test(variant, async () => {
      const safe = lightingSpy();
      let executeCommand;
      const worker = new FakeWorker((command, target) => {
        if (command.command === "execute_forensic_plan") {
          executeCommand = command;
          target.event(command, "lighting_profile_requested", {
            captureRequestId: command.requestId,
            role: "dark_control",
            ordinal: 0,
          });
          return;
        }
        if (command.command === "lighting_ack") {
          target.result(command, { state: "capturing" });
          const capturedFrame = frame(executeCommand, "unsafe-grab", variant === "wrong_epoch"
            ? { sideEpoch: executeCommand.sideEpoch + 1 }
            : { blockId: null });
          target.event(executeCommand, "lighting_grab_completed", {
            captureRequestId: executeCommand.requestId,
            role: "dark_control",
            authorizationId: command.payload.authorizationId,
            frame: capturedFrame,
          });
          return;
        }
        basicHandler(command, target);
      });
      const client = newClient(worker, safe.coordinator);
      await client.start();
      await client.setSide({ side: "back", sideEpoch: 1 });
      await client.startPreview({ previewEpoch: 1 });
      await client.stopAndDrain();
      await assert.rejects(
        client.executeForensicSidePlan({ captureId: `capture-${variant}`, forensicProfile: "full_forensic" }),
      );
      await client.waitForTerminalSafety();
      assert.equal(safe.calls.some(([operation]) => operation === "complete"), false);
      assert.ok(safe.calls.some(([operation]) => operation === "safe_off"));
      assert.equal(worker.kills, 1);
    });
  }
});

test("unsafe forensic authority, rig attestation, and package output terminally safe-off without fallback", async (t) => {
  const cases = [
    ["adjust_card authority", (payload) => Object.assign(payload.authoritativeAllOnGeometry, {
      status: "adjust_card",
      reasonCodes: ["warming_up"],
      currentFrameAuthority: { normalizationSafe: true, captureReady: false, rejectionCodes: ["low_confidence"] },
    })],
    ["stale authority", (payload) => Object.assign(payload.authoritativeAllOnGeometry, {
      status: "adjust_card",
      reasonCodes: ["stale_frame"],
      stale: true,
      currentFrameAuthority: { normalizationSafe: false, captureReady: false, rejectionCodes: ["stale_frame"] },
    })],
    ["frozen authority", (payload) => Object.assign(payload.authoritativeAllOnGeometry, {
      status: "adjust_card",
      reasonCodes: ["frozen_frame"],
      frozen: true,
      currentFrameAuthority: { normalizationSafe: false, captureReady: false, rejectionCodes: ["frozen_frame"] },
    })],
    ["singular homography", (payload) => {
      payload.authoritativeAllOnGeometry.sourceToNormalizedHomography = [1, 0, 0, 0, 0, 0, 0, 0, 1];
    }],
    ["calibration mismatch", (payload) => {
      payload.rigConfiguration = rigAttestation({ calibrationSha256: "5".repeat(64) });
    }],
    ["orientation mismatch", (payload) => {
      payload.rigConfiguration = rigAttestation({
        sensorOrientation: { ...TEST_ORIENTATION, rotationDegrees: 90 },
      });
    }],
    ["missing forensic BlockID", (payload) => {
      payload.artifacts[6].frame.blockId = null;
    }],
    ["source corner outside raw frame", (payload) => {
      payload.authoritativeAllOnGeometry.sourceCorners.topLeft.x = -1;
      payload.authoritativeAllOnGeometry.sourceCorners.bottomLeft.x = -1;
    }],
    ["invalid package", (payload) => {
      payload.package = forensicPackage({ packageSha256: "bad" });
    }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const safe = lightingSpy();
      let spawns = 0;
      const worker = new FakeWorker((command, target) => {
        if (command.command === "execute_forensic_plan") {
          const payload = forensicResultPayload(command);
          mutate(payload);
          writeUntrustedRawResult(target, command, payload);
          return;
        }
        basicHandler(command, target);
      });
      const client = newClient(worker, safe.coordinator, {
        spawnWorker: () => { spawns += 1; return worker; },
      });
      await client.start();
      await client.setSide({ side: "back", sideEpoch: 1 });
      await client.startPreview({ previewEpoch: 1 });
      await client.stopAndDrain();
      await assert.rejects(
        client.executeForensicSidePlan({ captureId: `capture-${name.replace(/[^a-z]+/g, "-")}`, forensicProfile: "full_forensic" }),
      );
      await client.waitForTerminalSafety();
      assert.equal(spawns, 1, name);
      assert.equal(worker.kills, 1, name);
      assert.ok(safe.calls.some(([operation]) => operation === "safe_off"), name);
      assert.equal(client.publicHealth().automaticFallbackAttempted, false, name);
    });
  }
});

test("split stderr secrets are buffered and redacted before diagnostics are exposed", async () => {
  const safe = lightingSpy();
  const worker = new FakeWorker(basicHandler);
  const diagnostics = [];
  const client = newClient(worker, safe.coordinator, { onRedactedDiagnostic: (value) => diagnostics.push(value) });
  await client.start();
  worker.stderr.write("C:\\private");
  assert.deepEqual(diagnostics, []);
  worker.stderr.write("\\card.png token=secret\n");
  await tick();
  assert.deepEqual(diagnostics, ["[redacted-native-camera-diagnostic]"]);
  assert.equal(JSON.stringify(diagnostics).includes("private"), false);
  await client.shutdown();
});

test("all eleven roles require stable-light and one-grab authorization; production_fast remains TIFF with no fallback", async () => {
  const safe = lightingSpy();
  let executeCommand;
  let nextRole = 0;
  const worker = new FakeWorker((command, target) => {
    if (command.command === "execute_forensic_plan") {
      executeCommand = command;
      const role = NATIVE_CAMERA_FORENSIC_ROLES[nextRole];
      target.event(command, "lighting_profile_requested", { captureRequestId: command.requestId, role, ordinal: nextRole });
      return;
    }
    if (command.command === "lighting_ack") {
      target.result(command, { state: "capturing" });
      target.event(executeCommand, "lighting_grab_completed", {
        captureRequestId: executeCommand.requestId,
        role: command.payload.role,
        authorizationId: command.payload.authorizationId,
        frame: frame(executeCommand, `capture-${nextRole}`),
      });
      return;
    }
    if (command.command === "lighting_completion") {
      target.result(command, { state: "capturing" });
      nextRole += 1;
      if (nextRole < NATIVE_CAMERA_FORENSIC_ROLES.length) {
        const role = NATIVE_CAMERA_FORENSIC_ROLES[nextRole];
        target.event(executeCommand, "lighting_profile_requested", {
          captureRequestId: executeCommand.requestId,
          role,
          ordinal: nextRole,
        });
      } else {
        const artifacts = NATIVE_CAMERA_FORENSIC_ROLES.map((role, index) => ({
          role,
          fileName: `${role}.tiff`,
          sha256: String(index).padStart(64, "0"),
          byteSize: 100 + index,
          mimeType: "image/tiff",
          width: 2448,
          height: 2048,
          frame: frame(executeCommand, `capture-${index}`),
          capturedAtUnixMs: Date.now(),
          writeDurationMs: 2,
          hashDurationMs: 1,
        }));
        const allOn = artifacts[1];
        const capturePayload = {
          state: "idle_safe",
          captureId: executeCommand.payload.captureId,
          forensicProfile: executeCommand.payload.forensicProfile,
          artifacts,
          authoritativeAllOnGeometry: geometry(allOn.frame, {
            sourceWidth: allOn.width,
            sourceHeight: allOn.height,
            hysteresis: {
              currentEvidenceReady: true,
              consecutiveReadyFrames: 1,
              requiredReadyFrames: 3,
              removalFenceSatisfied: true,
            },
          }),
          authoritativeTransform: {
            sourceFrameId: allOn.frame.frameId,
            sourceSha256: allOn.sha256,
            sourceWidth: allOn.width,
            sourceHeight: allOn.height,
            normalizedWidth: 1200,
            normalizedHeight: 1680,
            homography: [...TEST_HOMOGRAPHY],
            reusedByRoles: [...NATIVE_CAMERA_TRANSFORM_REUSED_ROLES],
          },
          rigConfiguration: rigAttestation(),
          package: forensicPackage(),
          captureDurationMs: 100,
          droppedFrames: 0,
        };
        target.requestSafeOff(
          executeCommand,
          "forensic_plan_complete",
          "capturing",
          () => target.result(executeCommand, capturePayload),
        );
      }
      return;
    }
    basicHandler(command, target);
  });
  const client = newClient(worker, safe.coordinator);
  await client.start();
  await client.setSide({ side: "back", sideEpoch: 1 });
  await client.startPreview({ previewEpoch: 1 });
  await client.stopAndDrain();
  const result = await client.executeForensicSidePlan({ captureId: "capture-11", forensicProfile: "production_fast" });
  assert.equal(result.payload.artifacts.length, 11);
  assert.ok(result.payload.artifacts.every((artifact) => artifact.mimeType === "image/tiff"));
  assert.deepEqual(result.payload.rigConfiguration, rigAttestation());
  assert.deepEqual(result.payload.package, forensicPackage());
  assert.equal(result.payload.authoritativeAllOnGeometry.hysteresis.consecutiveReadyFrames, 1);
  for (const role of NATIVE_CAMERA_FORENSIC_ROLES) {
    assert.ok(safe.calls.some(([name, value]) => name === "profile" && value === role));
    assert.ok(safe.calls.some(([name, value]) => name === "stable" && value === role));
    assert.ok(safe.calls.some(([name, value]) => name === "authorize" && value === role));
    assert.ok(safe.calls.some(([name, value]) => name === "complete" && value === role));
  }
  assert.equal(worker.commands.filter((entry) => entry.command === "lighting_ack").length, 11);
  assert.ok(worker.commands
    .filter((entry) => entry.command === "lighting_ack")
    .every((entry) => Number.isSafeInteger(entry.payload.expiresAtUnixMs) && entry.payload.expiresAtUnixMs > entry.payload.stableAtUnixMs));
  assert.ok(safe.calls.some(([name, value]) => name === "safe_off" && value === "capture_complete"));
  assert.equal(client.publicHealth().automaticFallbackAttempted, false);
});
