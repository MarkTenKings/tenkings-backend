const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
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
    packageId: `${"1".repeat(64)}.front`,
    packageSha256: "2".repeat(64),
    manifestSha256: "3".repeat(64),
    capturePlanSha256: "4".repeat(64),
    idempotent: false,
    ...overrides,
  };
}

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
    detectorVersion: "native_four_edge_v2",
    detector: "fused_four_edge",
    status: "ready",
    reasonCodes: ["none"],
    sourceCorners,
    normalizedCorners: {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1199, y: 0 },
      bottomRight: { x: 1199, y: 1679 },
      bottomLeft: { x: 0, y: 1679 },
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
      edgeSupport: 0.95,
      continuity: 0.94,
      residualPixels: 0.7,
      convexity: 0.99,
      aspectRatio: 1.4,
      aspectScore: 0.99,
      coverage: 0.5,
      clearance: 0.1,
      clearanceFraction: 0.05,
      fullVisibility: true,
      perspective: 0.98,
      perspectiveSkew: 0.02,
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

test("strict NDJSON parser accepts detector v2 messages and preserves 64-bit Pylon identities as text", () => {
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
  assert.throws(
    () => parseNativeCameraGeometry(geometry({ frame: frame({ blockId: "not-a-pylon-block" }) })),
    /blockId/i,
  );
  assert.throws(
    () => parseNativeCameraGeometry(geometry({ frame: frame({ blockId: "18446744073709551616" }) })),
    /unsigned 64-bit/i,
  );
});

test("initialize accepts only a trusted configuration identity and canonical digest", () => {
  const valid = envelope({
    command: "initialize",
    payload: {
      configurationId: TEST_CONFIGURATION_ID,
      configurationSha256: TEST_CONFIGURATION_SHA256,
    },
  });
  assert.equal(parseNativeCameraProtocolMessage(valid).payload.configurationId, TEST_CONFIGURATION_ID);
  assert.throws(
    () => parseNativeCameraProtocolMessage({ ...valid, payload: { ...valid.payload, exposureUs: 1 } }),
    /Unexpected field/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({ ...valid, payload: { ...valid.payload, backend: "fake" } }),
    /Unexpected field/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({ ...valid, payload: { ...valid.payload, configurationSha256: "bad" } }),
    /configurationSha256/i,
  );
});

test("terminal fault diagnostics reject paths, URLs, secrets, and device identifiers", () => {
  const safe = cleanUndefined(envelope({
    kind: "event",
    event: "terminal_fault",
    command: undefined,
    requestId: "terminal-fault",
    payload: { code: "CAMERA_LOST", message: "Native camera became unavailable." },
  }));
  assert.equal(parseNativeCameraProtocolMessage(safe).payload.message, "Native camera became unavailable.");
  for (const message of [
    "failed at C:/private/card.png",
    "failed at D:\\private\\card.png",
    "failed at /opt/tenkings/card.png",
    "failed at //server/share/card.png",
    "details at https://private.example/fault",
    "token=private-value",
    "deviceId=camera-1",
    "serialNumber=private",
  ]) {
    assert.throws(
      () => parseNativeCameraProtocolMessage({
        ...safe,
        payload: { ...safe.payload, message },
      }),
      (error) => error instanceof NativeCameraProtocolValidationError && error.code === "UNSAFE_DIAGNOSTIC",
    );
  }
});

test("preview commands accept only an empty payload because imaging settings are rig-bound", () => {
  for (const command of ["start_preview", "resume_preview"]) {
    const valid = envelope({ command, previewEpoch: 1, payload: {} });
    assert.deepEqual(parseNativeCameraProtocolMessage(valid).payload, {});
    assert.throws(
      () => parseNativeCameraProtocolMessage({ ...valid, payload: { maxFps: 15 } }),
      /Unexpected field/i,
    );
    assert.throws(
      () => parseNativeCameraProtocolMessage({ ...valid, payload: { jpegQuality: 80 } }),
      /Unexpected field/i,
    );
  }
});

test("parser fails closed on malformed, oversize, truncated, unknown, and wrong-version input", () => {
  assert.throws(() => new NativeCameraNdjsonParser().push("{nope}\n"), /valid JSON/i);
  assert.throws(
    () => new NativeCameraNdjsonParser().push(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d, 0x0a])),
    (error) => error instanceof NativeCameraProtocolValidationError && error.code === "MALFORMED_UTF8",
  );
  const validJson = JSON.stringify(envelope());
  assert.throws(
    () => new NativeCameraNdjsonParser().push(`${validJson.replace('"kind":"command"', '"kind":"command","kind":"command"')}\n`),
    (error) => error instanceof NativeCameraProtocolValidationError && error.code === "DUPLICATE_JSON_KEY",
  );
  const initializeJson = JSON.stringify(envelope({
    command: "initialize",
    payload: { configurationId: TEST_CONFIGURATION_ID, configurationSha256: TEST_CONFIGURATION_SHA256 },
  }));
  assert.throws(
    () => new NativeCameraNdjsonParser().push(`${initializeJson.replace(
      `"configurationId":"${TEST_CONFIGURATION_ID}"`,
      `"configurationId":"${TEST_CONFIGURATION_ID}","\\u0063onfigurationId":"${TEST_CONFIGURATION_ID}"`,
    )}\n`),
    (error) => error instanceof NativeCameraProtocolValidationError && error.code === "DUPLICATE_JSON_KEY",
  );
  assert.throws(
    () => new NativeCameraNdjsonParser().push(Buffer.alloc(NATIVE_CAMERA_MAX_MESSAGE_BYTES + 1, 0x20)),
    (error) => error instanceof NativeCameraProtocolValidationError && error.code === "MESSAGE_TOO_LARGE",
  );
  const truncated = new NativeCameraNdjsonParser();
  truncated.push(JSON.stringify(envelope()));
  assert.throws(() => truncated.end(), /newline-delimited/i);
  const whitespaceOnly = new NativeCameraNdjsonParser();
  whitespaceOnly.push(" \t\r");
  assert.throws(
    () => whitespaceOnly.end(),
    (error) => error instanceof NativeCameraProtocolValidationError && error.code === "TRUNCATED_MESSAGE",
  );
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
        hysteresis: {
          currentEvidenceReady: true,
          consecutiveReadyFrames: 1,
          requiredReadyFrames: 3,
          removalFenceSatisfied: true,
        },
      }),
      authoritativeTransform: {
        sourceFrameId: artifacts[1].frame.frameId,
        sourceSha256: artifacts[1].sha256,
        sourceWidth: artifacts[1].width,
        sourceHeight: artifacts[1].height,
        normalizedWidth: 1200,
        normalizedHeight: 1680,
        homography: [...TEST_HOMOGRAPHY],
        reusedByRoles: [...NATIVE_CAMERA_TRANSFORM_REUSED_ROLES],
      },
      rigConfiguration: rigAttestation(),
      package: forensicPackage(),
      captureDurationMs: 100,
      droppedFrames: 0,
      timing: timingSnapshot({ forensicGrabMs: 20, forensicWriteMs: 30, forensicHashMs: 4 }),
    },
  });
  const accepted = parseNativeCameraProtocolMessage(result);
  assert.equal(accepted.payload.forensicProfile, "full_forensic");
  assert.equal(accepted.payload.authoritativeAllOnGeometry.currentFrameAuthority.captureReady, true);
  assert.equal(accepted.payload.authoritativeAllOnGeometry.hysteresis.consecutiveReadyFrames, 1);
  assert.deepEqual(accepted.payload.package, forensicPackage());
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
        artifacts: result.payload.artifacts.map((artifact, index) =>
          index === 7 ? { ...artifact, frame: { ...artifact.frame, blockId: null } } : artifact,
        ),
      },
    }),
    /Every forensic artifact must carry an exact hardware BlockID/i,
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
  for (const [name, authoritativeAllOnGeometry] of [
    ["adjust", geometry({ frame: artifacts[1].frame, sourceWidth: artifacts[1].width, sourceHeight: artifacts[1].height,
      status: "adjust_card", reasonCodes: ["warming_up"], currentFrameAuthority: { normalizationSafe: true, captureReady: false, rejectionCodes: ["low_confidence"] } })],
    ["stale", geometry({ frame: artifacts[1].frame, sourceWidth: artifacts[1].width, sourceHeight: artifacts[1].height,
      status: "adjust_card", reasonCodes: ["stale_frame"], stale: true,
      currentFrameAuthority: { normalizationSafe: false, captureReady: false, rejectionCodes: ["stale_frame"] } })],
    ["frozen", geometry({ frame: artifacts[1].frame, sourceWidth: artifacts[1].width, sourceHeight: artifacts[1].height,
      status: "adjust_card", reasonCodes: ["frozen_frame"], frozen: true,
      currentFrameAuthority: { normalizationSafe: false, captureReady: false, rejectionCodes: ["frozen_frame"] } })],
    ["unsafe authority", geometry({ frame: artifacts[1].frame, sourceWidth: artifacts[1].width, sourceHeight: artifacts[1].height,
      status: "adjust_card", reasonCodes: ["unsupported_edge"],
      currentFrameAuthority: { normalizationSafe: true, captureReady: false, rejectionCodes: ["unsupported_edge"] } })],
  ]) {
    assert.throws(
      () => parseNativeCameraProtocolMessage({
        ...result,
        payload: { ...result.payload, authoritativeAllOnGeometry },
      }),
      /Only exact current-frame Ready geometry/i,
      name,
    );
  }
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: {
        ...result.payload,
        authoritativeAllOnGeometry: geometry({
          frame: artifacts[1].frame,
          sourceWidth: artifacts[1].width,
          sourceHeight: artifacts[1].height,
          sourceToNormalizedHomography: [1, 0, 0, 0, 0, 0, 0, 0, 1],
        }),
      },
    }),
    /nonsingular|homography/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: { ...result.payload, rigConfiguration: rigAttestation({ calibrationSha256: "5".repeat(64) }) },
    }),
    /attested calibration and orientation/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: {
        ...result.payload,
        rigConfiguration: rigAttestation({ sensorOrientation: { ...TEST_ORIENTATION, rotationDegrees: 90 } }),
      },
    }),
    /attested calibration and orientation/i,
  );
  assert.throws(
    () => parseNativeCameraProtocolMessage({
      ...result,
      payload: { ...result.payload, package: forensicPackage({ packageSha256: "bad" }) },
    }),
    /package\.packageSha256/i,
  );
});

test("Ready is rejected for frozen, clipped, or incomplete edge evidence", () => {
  assert.throws(() => parseNativeCameraGeometry(geometry({ frozen: true })), /Frozen, stale, or clipped/i);
  assert.throws(
    () => parseNativeCameraGeometry(geometry({ metrics: { ...geometry().metrics, fullVisibility: false } })),
    /Frozen, stale, or clipped/i,
  );
  assert.throws(
    () => parseNativeCameraGeometry(geometry({
      sourceCorners: {
        topLeft: { x: -1, y: 80 },
        topRight: { x: 500, y: 80 },
        bottomRight: { x: 500, y: 640 },
        bottomLeft: { x: -1, y: 640 },
      },
    })),
    /inside the exact raw source frame/i,
  );
  assert.throws(() => parseNativeCameraGeometry(geometry({ fittedLines: geometry().fittedLines.slice(0, 3) })), /four fitted lines/i);
});

test("health requires an explicit verified rig flag", () => {
  const valid = envelope({
    kind: "result",
    command: "health",
    ok: true,
    error: null,
    payload: {
      state: "idle_safe",
      healthy: true,
      backend: "fake",
      cameraOpen: true,
      rigConfigurationVerified: true,
      automaticFallbackAttempted: false,
      timing: timingSnapshot(),
    },
  });
  assert.equal(parseNativeCameraProtocolMessage(valid).payload.rigConfigurationVerified, true);
  const { rigConfigurationVerified, ...missing } = valid.payload;
  assert.equal(rigConfigurationVerified, true);
  assert.throws(() => parseNativeCameraProtocolMessage({ ...valid, payload: missing }), /rigConfigurationVerified/i);
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

test("preview telemetry must remain coherent with geometry and monotonic stage order", () => {
  const cases = [
    ["drop mismatch", (payload) => { payload.telemetry.droppedFrames += 1; }],
    ["geometry detect after detector completion", (payload) => { payload.telemetry.detectMonotonicMs = 11; }],
    ["encode before detect", (payload) => { payload.telemetry.encodeMonotonicMs = 11; }],
    ["emit before encode", (payload) => { payload.telemetry.emitMonotonicMs = 13; }],
    ["total processing below detector processing", (payload) => { payload.telemetry.processingMs = 3; }],
  ];
  for (const [name, mutate] of cases) {
    const message = cleanUndefined(previewEvent(1, `telemetry-${name.replace(/\W+/g, "-")}`));
    mutate(message.payload);
    assert.throws(() => parseNativeCameraProtocolMessage(message), /telemetry disagree|incoherent|out of order/i, name);
  }
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

test("production start and serve surfaces cannot activate the dormant Pylon host", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages/ai-grader-capture-helper/package.json"), "utf8"));
  const productionScripts = [packageJson.scripts.build, packageJson.scripts.test, packageJson.scripts.health,
    packageJson.scripts.capabilities, packageJson.scripts.serve].join("\n");
  assert.doesNotMatch(productionScripts, /Pylon\.Host|build-pylon-host|native:build:pylon/i);

  const bridge = fs.readFileSync(
    path.join(repoRoot, "packages/ai-grader-capture-helper/src/drivers/aiGraderLocalStationBridge.ts"),
    "utf8",
  );
  assert.doesNotMatch(bridge, /nativeCamera|TenKings\.AiGrader\.Pylon\.Host/i);

  const normalNativeScripts = [packageJson.scripts["native:restore"], packageJson.scripts["native:build"],
    packageJson.scripts["native:test"], packageJson.scripts["native:replay"], packageJson.scripts["native:package"]].join("\n");
  assert.doesNotMatch(normalNativeScripts, /build-pylon-host|TenKings\.AiGrader\.Pylon\.Host/i);
  assert.match(packageJson.scripts["native:build:pylon"], /build-pylon-host/i);
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
  for (const unsafe of [
    "failed at C:/private/card.png",
    "failed at D:\\private\\card.png",
    "failed at /opt/tenkings/private-card.png",
    "failed at //server/share/private-card.png",
  ]) {
    assert.equal(redactNativeCameraDiagnosticText(unsafe), "[redacted-native-camera-diagnostic]");
    const projected = toPublicNativeCameraHealth({
      enabled: true,
      selection: "replay",
      lifecycle: "faulted",
      state: "faulted",
      healthy: false,
      cameraOpen: false,
      epochs: { workerEpoch: 1, sessionEpoch: 2, previewEpoch: 3, sideEpoch: 4 },
      side: "back",
      previewQueueDepth: 0,
      clientDroppedPreviewFrames: 0,
      workerDroppedPreviewFrames: 0,
      lastError: { code: "PATH_FAILURE", message: unsafe },
    });
    assert.equal(JSON.stringify(projected).includes("private-card"), false);
    assert.match(projected.lastError.message, /inspect local redacted diagnostics/i);
  }
});

test("geometry adapter is path-free, retains exact frame identity, and never upgrades frozen evidence", () => {
  const adapted = adaptNativeCameraGeometry(geometry(), 1_800_000_000_000);
  const json = JSON.stringify(adapted);
  assert.equal(adapted.geometry.placementState, "ready");
  assert.equal(adapted.geometry.sourceFrameId, "frame-1");
  assert.equal(adapted.geometry.sourceImageId, "18446744073709551615");
  assert.equal(adapted.nativeDetector.version, "native_four_edge_v2");
  assert.equal(/localOutputPath|[A-Za-z]:\\/.test(json), false);

  const notReady = adaptNativeCameraGeometry(
    geometry({ status: "adjust_card", frozen: true, hysteresis: { ...geometry().hysteresis, currentEvidenceReady: false } }),
  );
  assert.notEqual(notReady.geometry.placementState, "ready");
});
