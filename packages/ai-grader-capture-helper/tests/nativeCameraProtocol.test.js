const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  NATIVE_CAMERA_FORENSIC_ROLES,
  NATIVE_CAMERA_MAX_MESSAGE_BYTES,
  NATIVE_CAMERA_PROTOCOL_VERSION,
  NATIVE_CAMERA_TRANSFORM_REUSED_ROLES,
  NativeCameraNdjsonParser,
  NativeCameraProtocolValidationError,
  encodeNativeCameraProtocolMessage,
  parseNativeCameraGeometry,
  parseNativeCameraProtocolMessage,
} = require("../dist/drivers/nativeCameraProtocol.js");
const {
  assertNativeCameraReplayDeterministic,
  runNativeCameraProtocolReplay,
} = require("../dist/drivers/nativeCameraReplayRunner.js");
const {
  DEFAULT_NATIVE_CAMERA_FEATURE_CONFIG,
  redactNativeCameraDiagnosticText,
  resolveNativeCameraFeatureConfig,
  toPublicNativeCameraHealth,
} = require("../dist/drivers/nativeCameraHealth.js");
const { adaptNativeCameraGeometry } = require("../dist/drivers/nativeCameraGeometryAdapter.js");

function envelope(overrides = {}) {
  return {
    protocolVersion: NATIVE_CAMERA_PROTOCOL_VERSION,
    kind: "command",
    command: "health",
    requestId: "request-1",
    sessionId: "session-1",
    workerEpoch: 1,
    sessionEpoch: 1,
    previewEpoch: 0,
    sideEpoch: 0,
    side: "none",
    timeoutMs: 1000,
    deadlineUnixMs: Date.now() + 1000,
    sequence: 1,
    payload: {},
    ...overrides,
  };
}

function frame(overrides = {}) {
  return {
    frameId: "frame-1",
    blockId: "18446744073709551615",
    hardwareTimestampTicks: "18446744073709551615",
    workerEpoch: 1,
    sessionEpoch: 1,
    previewEpoch: 1,
    sideEpoch: 1,
    side: "front",
    ...overrides,
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

function geometry(overrides = {}) {
  const identity = frame(overrides.frame);
  const sourceCorners = {
    topLeft: { x: 100, y: 80 },
    topRight: { x: 500, y: 80 },
    bottomRight: { x: 500, y: 640 },
    bottomLeft: { x: 100, y: 640 },
  };
  return {
    detectorVersion: "native_four_edge_v1",
    status: "ready",
    reasonCodes: ["current_evidence_ready"],
    sourceCorners,
    normalizedCorners: {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1200, y: 0 },
      bottomRight: { x: 1200, y: 1680 },
      bottomLeft: { x: 0, y: 1680 },
    },
    fittedLines: ["top", "right", "bottom", "left"].map((edge) => ({
      edge,
      a: edge === "left" || edge === "right" ? 1 : 0,
      b: edge === "top" || edge === "bottom" ? 1 : 0,
      c: -1,
      support: 0.95,
      continuity: 0.94,
      residualPixels: 0.7,
    })),
    sourceWidth: 640,
    sourceHeight: 720,
    normalizedWidth: 1200,
    normalizedHeight: 1680,
    center: { x: 300, y: 360 },
    scale: 1,
    rotationDegrees: 0,
    confidence: 0.96,
    metrics: {
      perEdgeSupport: { top: 0.95, right: 0.95, bottom: 0.95, left: 0.95 },
      edgeSupport: 0.95,
      continuity: 0.94,
      residualPixels: 0.7,
      convexity: 0.99,
      aspectRatio: 1.4,
      aspectScore: 0.99,
      coverage: 0.5,
      clearance: 0.1,
      fullVisibility: true,
      perspective: 0.98,
    },
    frame: identity,
    detectMonotonicMs: 12,
    processingMs: 4,
    frameAgeMs: 10,
    droppedFrames: 0,
    frozen: false,
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

function previewEvent(sequence, frameId) {
  const bytes = Buffer.from([0xff, 0xd8, sequence, 0xff, 0xd9]);
  const identity = frame({ frameId });
  const detected = geometry({ frame: identity });
  return envelope({
    kind: "event",
    event: "preview_frame",
    command: undefined,
    requestId: "preview-request",
    previewEpoch: 1,
    sideEpoch: 1,
    side: "front",
    sequence,
    payload: {
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
        processingMs: 4,
        frameAgeMs: 10,
        droppedFrames: 0,
        frozen: false,
      },
    },
  });
}

function cleanUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

test("strict v1 NDJSON parser accepts fragmented messages and preserves 64-bit Pylon identities as text", () => {
  const parser = new NativeCameraNdjsonParser();
  const encoded = encodeNativeCameraProtocolMessage(envelope());
  assert.deepEqual(parser.push(encoded.subarray(0, 7)), []);
  const messages = parser.push(encoded.subarray(7));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].protocolVersion, NATIVE_CAMERA_PROTOCOL_VERSION);
  assert.deepEqual(parser.end(), []);

  const parsed = parseNativeCameraGeometry(geometry());
  assert.equal(parsed.frame.blockId, "18446744073709551615");
  assert.equal(parsed.frame.hardwareTimestampTicks, "18446744073709551615");
});

test("parser fails closed on malformed, oversize, truncated, unknown, and wrong-version input", () => {
  assert.throws(() => new NativeCameraNdjsonParser().push("{nope}\n"), /valid JSON/i);
  assert.throws(
    () => new NativeCameraNdjsonParser().push(Buffer.alloc(NATIVE_CAMERA_MAX_MESSAGE_BYTES + 1, 0x20)),
    (error) => error instanceof NativeCameraProtocolValidationError && error.code === "MESSAGE_TOO_LARGE",
  );
  const truncated = new NativeCameraNdjsonParser();
  truncated.push(JSON.stringify(envelope()));
  assert.throws(() => truncated.end(), /newline-delimited/i);
  assert.throws(() => parseNativeCameraProtocolMessage({ ...envelope(), surprise: true }), /Unexpected field/i);
  assert.throws(() => parseNativeCameraProtocolMessage({ ...envelope(), protocolVersion: "v2" }), /version/i);
  assert.throws(() => parseNativeCameraProtocolMessage({ ...envelope(), requestId: "x".repeat(65) }), /1-64/i);
});

test("forensic plan requires canonical eleven roles and an explicit profile", () => {
  const valid = envelope({
    command: "execute_forensic_plan",
    side: "front",
    sideEpoch: 1,
    payload: {
      captureId: "capture-1",
      forensicProfile: "production_fast",
      roles: [...NATIVE_CAMERA_FORENSIC_ROLES],
      normalizedWidth: 1200,
      normalizedHeight: 1680,
    },
  });
  assert.equal(parseNativeCameraProtocolMessage(valid).command, "execute_forensic_plan");
  assert.throws(
    () => parseNativeCameraProtocolMessage({ ...valid, payload: { ...valid.payload, roles: valid.payload.roles.slice(0, 10) } }),
    /eleven/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({ ...valid, payload: { ...valid.payload, roles: [...valid.payload.roles.slice(0, 10), "channel_7"] } }),
    /duplicate|canonical/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({ ...valid, payload: { ...valid.payload, forensicProfile: "automatic" } }),
    /forensicProfile/i,
  );
});

test("forensic result encoding is pinned to PNG for full_forensic and TIFF for production_fast", () => {
  const artifacts = NATIVE_CAMERA_FORENSIC_ROLES.map((role, index) => ({
    role,
    fileName: `${role}.png`,
    sha256: "a".repeat(64),
    byteSize: 100 + index,
    mimeType: "image/png",
    width: 2448,
    height: 2048,
    frame: frame({ frameId: `artifact-${index}`, blockId: String(index + 1) }),
    capturedAtUnixMs: Date.now(),
    writeDurationMs: 2,
    hashDurationMs: 1,
  }));
  const result = envelope({
    kind: "result",
    command: "execute_forensic_plan",
    ok: true,
    error: null,
    side: "front",
    previewEpoch: 1,
    sideEpoch: 1,
    payload: {
      state: "idle_safe",
      captureId: "capture-full",
      forensicProfile: "full_forensic",
      artifacts,
      authoritativeAllOnGeometry: geometry({
        frame: artifacts[1].frame,
        sourceWidth: artifacts[1].width,
        sourceHeight: artifacts[1].height,
      }),
      authoritativeTransform: {
        sourceFrameId: artifacts[1].frame.frameId,
        sourceSha256: artifacts[1].sha256,
        sourceWidth: artifacts[1].width,
        sourceHeight: artifacts[1].height,
        normalizedWidth: 1200,
        normalizedHeight: 1680,
        homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        reusedByRoles: [...NATIVE_CAMERA_TRANSFORM_REUSED_ROLES],
      },
      captureDurationMs: 100,
      droppedFrames: 0,
      timing: timingSnapshot({ forensicGrabMs: 20, forensicWriteMs: 30, forensicHashMs: 4 }),
    },
  });
  assert.equal(parseNativeCameraProtocolMessage(result).payload.forensicProfile, "full_forensic");
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: { ...result.payload, artifacts: artifacts.map((artifact, index) => index === 3 ? { ...artifact, mimeType: "image/tiff" } : artifact) },
    }),
    /full_forensic artifacts must use image\/png/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: { ...result.payload, timing: timingSnapshot({ detectMs: -1 }) },
    }),
    /timing\.detectMs must be finite/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: {
        ...result.payload,
        authoritativeTransform: { ...result.payload.authoritativeTransform, sourceSha256: "b".repeat(64) },
      },
    }),
    /exact all_on frame and SHA-256/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: {
        ...result.payload,
        authoritativeTransform: {
          ...result.payload.authoritativeTransform,
          reusedByRoles: ["dark_control", ...NATIVE_CAMERA_TRANSFORM_REUSED_ROLES.slice(1)],
        },
      },
    }),
    /canonical order and exclude controls/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: {
        ...result.payload,
        authoritativeTransform: { ...result.payload.authoritativeTransform, homography: [1, 0, 0, 0, 1, 0, 0, 0] },
      },
    }),
    /exactly nine values/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: {
        ...result.payload,
        authoritativeAllOnGeometry: geometry({
          frame: { ...artifacts[1].frame, frameId: "wrong-all-on-frame" },
          sourceWidth: artifacts[1].width,
          sourceHeight: artifacts[1].height,
        }),
      },
    }),
    /exact all_on frame/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: {
        ...result.payload,
        artifacts: result.payload.artifacts.map((artifact, index) =>
          index === 2 ? { ...artifact, frame: { ...artifact.frame, frameId: artifacts[1].frame.frameId } } : artifact,
        ),
      },
    }),
    /distinct frame IDs/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: {
        ...result.payload,
        artifacts: result.payload.artifacts.map((artifact, index) =>
          index === 2 ? { ...artifact, frame: { ...artifact.frame, blockId: artifacts[1].frame.blockId } } : artifact,
        ),
      },
    }),
    /distinct non-null BlockIDs/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: {
        ...result.payload,
        artifacts: result.payload.artifacts.map((artifact, index) => index === 5 ? { ...artifact, width: 2000 } : artifact),
      },
    }),
    /coherent raw dimensions/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: {
        ...result.payload,
        artifacts: result.payload.artifacts.map((artifact, index) =>
          index === 5 ? { ...artifact, frame: { ...artifact.frame, sideEpoch: artifact.frame.sideEpoch + 1 } } : artifact,
        ),
      },
    }),
    /coherent epochs and side/i,
  );
});

test("Ready is rejected for frozen, clipped, or incomplete edge evidence", () => {
  assert.throws(() => parseNativeCameraGeometry(geometry({ frozen: true })), /Frozen, stale, or clipped/i);
  assert.throws(
    () => parseNativeCameraGeometry(geometry({ metrics: { ...geometry().metrics, fullVisibility: false } })),
    /Frozen, stale, or clipped/i,
  );
  assert.throws(() => parseNativeCameraGeometry(geometry({ fittedLines: geometry().fittedLines.slice(0, 3) })), /four fitted lines/i);
});

test("lighting authorization expiry and explicit safe-off completion are strict wire fields", () => {
  const lightingAck = envelope({
    command: "lighting_ack",
    side: "front",
    previewEpoch: 1,
    sideEpoch: 1,
    payload: {
      captureRequestId: "capture-1",
      role: "all_on",
      stableAcknowledgementId: "stable-1",
      authorizationId: "authorization-1",
      stableAtUnixMs: 1000,
      expiresAtUnixMs: 2000,
    },
  });
  assert.equal(parseNativeCameraProtocolMessage(lightingAck).payload.expiresAtUnixMs, 2000);
  const { expiresAtUnixMs, ...missingExpiry } = lightingAck.payload;
  assert.equal(expiresAtUnixMs, 2000);
  assert.throws(
    () => parseNativeCameraProtocolMessage({ ...lightingAck, payload: missingExpiry }),
    /Missing field expiresAtUnixMs/i,
  );
  const safeOff = envelope({
    command: "safe_off_completion",
    side: "front",
    previewEpoch: 1,
    sideEpoch: 1,
    payload: { safeOffRequestId: "safe-off-1", safe: true, completedAtUnixMs: 2001 },
  });
  assert.equal(parseNativeCameraProtocolMessage(safeOff).payload.safe, true);
});

test("replay is deterministic and uses a latest-frame queue of one", () => {
  const first = Buffer.from(`${JSON.stringify(cleanUndefined(previewEvent(1, "frame-1")))}\n`);
  const second = Buffer.from(`${JSON.stringify(cleanUndefined(previewEvent(2, "frame-2")))}\n`);
  const result = assertNativeCameraReplayDeterministic([first.subarray(0, 17), first.subarray(17), second]);
  assert.equal(result.messageCount, 2);
  assert.equal(result.previewFrameCount, 2);
  assert.equal(result.queueDrops, 1);
  assert.equal(result.latestPreview.frame.frameId, "frame-2");
  assert.equal(runNativeCameraProtocolReplay([first, second]).deterministicDigest, result.deterministicDigest);
});

test("native mode is disabled by default and pylon needs a second explicit authorization", () => {
  assert.deepEqual(resolveNativeCameraFeatureConfig({}), DEFAULT_NATIVE_CAMERA_FEATURE_CONFIG);
  assert.throws(
    () => resolveNativeCameraFeatureConfig({ AI_GRADER_NATIVE_CAMERA_ENABLED: "true" }),
    /explicit fake, replay, or pylon/i,
  );
  assert.throws(
    () => resolveNativeCameraFeatureConfig({ AI_GRADER_NATIVE_CAMERA_ENABLED: "true", AI_GRADER_NATIVE_CAMERA_BACKEND: "pylon" }),
    /separate explicit/i,
  );
  assert.equal(
    resolveNativeCameraFeatureConfig({
      AI_GRADER_NATIVE_CAMERA_ENABLED: "true",
      AI_GRADER_NATIVE_CAMERA_BACKEND: "fake",
    }).selection,
    "fake",
  );
});

test("public health is allowlisted and diagnostics redact paths, URLs, tokens, and device identifiers", () => {
  const output = toPublicNativeCameraHealth({
    enabled: true,
    selection: "replay",
    lifecycle: "faulted",
    state: "faulted",
    healthy: false,
    cameraOpen: false,
    epochs: { workerEpoch: 1, sessionEpoch: 2, previewEpoch: 3, sideEpoch: 4 },
    side: "back",
    previewQueueDepth: 0,
    clientDroppedPreviewFrames: 1,
    workerDroppedPreviewFrames: 2,
    lastError: { code: "LEAK", message: "C:\\private\\card.png token=abc" },
    localPath: "C:\\should-not-copy",
  });
  const json = JSON.stringify(output);
  assert.equal(json.includes("private"), false);
  assert.equal(json.includes("should-not-copy"), false);
  assert.equal(json.includes("token=abc"), false);
  assert.equal(output.automaticFallbackAttempted, false);
  assert.equal(redactNativeCameraDiagnosticText("https://private/deviceId=42"), "[redacted-native-camera-diagnostic]");
});

test("geometry adapter is path-free, retains exact frame identity, and never upgrades frozen evidence", () => {
  const adapted = adaptNativeCameraGeometry(geometry(), 1_800_000_000_000);
  const json = JSON.stringify(adapted);
  assert.equal(adapted.geometry.placementState, "ready");
  assert.equal(adapted.geometry.sourceFrameId, "frame-1");
  assert.equal(adapted.geometry.sourceImageId, "18446744073709551615");
  assert.equal(adapted.nativeDetector.version, "native_four_edge_v1");
  assert.equal(/localOutputPath|[A-Za-z]:\\/.test(json), false);

  const notReady = adaptNativeCameraGeometry(
    geometry({ status: "adjust_card", frozen: true, hysteresis: { ...geometry().hysteresis, currentEvidenceReady: false } }),
  );
  assert.notEqual(notReady.geometry.placementState, "ready");
});
