const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const {
  FixedRigProcessingWorkerController,
  FixedRigProcessingWorkerError,
  createFixedRigWarmForensicProcessingRunner,
} = require("../dist/drivers/fixedRigProcessingWorker");
const {
  createFixedRigProcessingWorkerRequest,
  validateFixedRigProcessingWorkerAuthority,
  validateFixedRigProcessingWorkerAuthorityInput,
  validateFixedRigProcessingWorkerRequest,
} = require("../dist/drivers/fixedRigProcessingWorkerProtocol");

const TIMESTAMP = "2026-07-09T20:00:00.000Z";
const FILE_STAMP = "20260709T200000000Z";

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function capture(filePath, note, index, mimeType = "image/png") {
  return {
    outputFilePath: filePath,
    sha256: hash(filePath),
    byteSize: fs.statSync(filePath).size,
    mimeType,
    timestamp: TIMESTAMP,
    camera: { index: 0, modelName: "file-fixture-only" },
    imageWidth: 1400,
    imageHeight: 1960,
    sourcePixelFormat: "Mono8",
    savedImageFormat: mimeType === "image/tiff" ? "TIFF" : "PNG",
    exposureTime: 45000,
    gain: 0,
    transport: "GigE",
    pylon: { installed: false, status: "test_fixture" },
    calibration: {
      isCalibrated: false,
      calibrationProfileId: null,
      cameraRole: "macro_overview",
      evidenceClass: "macro_raw_smoke",
      coordinateFrame: "basler_sensor_pixels",
    },
    timing: {
      grab: { durationMs: 100 + index },
      save: { durationMs: 50 + index },
      hash: { durationMs: 2 },
    },
    note,
  };
}

function role(roleName, label, captureValue, channel) {
  return {
    role: roleName,
    label,
    ...(channel === undefined ? {} : { channel }),
    capture: captureValue,
  };
}

async function createFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-worker-fixture-"));
  const packageId = options.packageId ?? "worker-package-front";
  const packageDir = path.join(root, packageId);
  const side = options.side ?? "front";
  const mimeType = options.format === "tiff" ? "image/tiff" : "image/png";
  const extension = mimeType === "image/tiff" ? "tiff" : "png";
  const sideDir = path.join(packageDir, side);
  fs.mkdirSync(sideDir, { recursive: true });
  const sourceTemplate = path.join(sideDir, `source-template.${extension}`);
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1960">
      <rect width="1400" height="1960" fill="#000000"/>
      <g transform="translate(710 975) rotate(7)">
        <rect x="-525" y="-735" width="1050" height="1470" rx="8" fill="#090b0d"/>
        <path d="M -350 -220 L 10 -430 L 360 -90 L 145 340 L -300 240 Z" fill="#b8a765"/>
        <circle cx="180" cy="170" r="210" fill="#425f79"/>
        <rect x="-380" y="390" width="570" height="150" fill="#d9d9d9"/>
      </g>
    </svg>
  `);
  const image = sharp(svg);
  if (mimeType === "image/tiff") await image.tiff({ compression: "lzw" }).toFile(sourceTemplate);
  else await image.png().toFile(sourceTemplate);
  const definitions = [
    ["all_on", `${side}-all-on`, "all"],
    ["accepted_profile", `${side}-accepted-lighting-profile`, [1, 2, 3, 4, 5, 6, 7, 8]],
    ...Array.from({ length: 8 }, (_, index) => [
      `channel_${index + 1}`,
      `${side}-channel-${index + 1}`,
      index + 1,
    ]),
  ];
  const roleCaptures = definitions.map(([roleName, label, channel], index) => {
    const filePath = path.join(sideDir, `basler-${label}-${FILE_STAMP}.${extension}`);
    fs.copyFileSync(sourceTemplate, filePath);
    return role(roleName, label, capture(filePath, label, index + 1, mimeType), channel);
  });
  const darkPath = path.join(sideDir, `basler-${side}-dark-${FILE_STAMP}.${extension}`);
  fs.copyFileSync(sourceTemplate, darkPath);
  fs.unlinkSync(sourceTemplate);
  const batch = {
    executionPath: "warm_full_forensic_runner",
    packageId,
    packageDir,
    sideDir,
    side,
    captureProfile: mimeType === "image/tiff" ? "production_fast" : "full_forensic",
    rawEvidenceFormat: mimeType === "image/tiff" ? "tiff" : "png",
    hardwareMeasurement: false,
    activeLightingProfile: {
      profileId: "file-fixture-profile",
      profileVersion: "fixed-rig-active-lighting-profile-v0.1",
      selectedDutyPercent: 1.2,
      actualLeimacPwmStep: 12,
      selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
      profileSource: "accepted_station_profile",
      acceptedAt: TIMESTAMP,
      resetToDefault: false,
      selectedLightingProfileId: "line2-inverter-level-low-v0",
      selectedPolarity: { baslerLineInverter: true, leimacTriggerActivation: "LevelLow" },
      persistentLeimacSaved: false,
      note: "file-only fixture",
    },
    batch: {
      executionPath: "warm_full_forensic_runner",
      fallbackUsed: false,
      side,
      outputDir: sideDir,
      cameraIndex: 0,
      openedAt: TIMESTAMP,
      finishedAt: "2026-07-09T20:00:06.000Z",
      persistentBaslerSession: true,
      persistentLeimacSession: true,
      selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
      dutyTenthsPercent: 12,
      capturesStarted: true,
      leimac: { triggerSetup: { writes: [] } },
      captures: {
        darkControl: role("dark_control", `${side}-dark`, capture(darkPath, `${side}-dark`, 0, mimeType)),
        allOn: roleCaptures[0],
        acceptedProfile: roleCaptures[1],
        channels: roleCaptures.slice(2),
      },
      timing: { warmCameraOpenConfigure: { durationMs: 400 } },
      safety: { safeOffBefore: true, safeOffAfter: true },
      note: "file-only fixture; no hardware access",
    },
    exposureUs: 45000,
    gain: 0,
    ...(options.manual ? {
      manualGeometryOverride: {
        action: "manual_capture",
        confirmed: true,
        rect: { x: 175, y: 245, width: 1050, height: 1470 },
      },
    } : {}),
  };
  return { root, packageDir, sideDir, batch, sources: roleCaptures.map((entry) => entry.capture.outputFilePath) };
}

function authorityInput(batch) {
  return {
    packageId: batch.packageId,
    side: batch.side,
    allOn: batch.batch.captures.allOn,
    acceptedProfile: batch.batch.captures.acceptedProfile,
    channels: batch.batch.captures.channels,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeWorker(root, name, body) {
  const filePath = path.join(root, `${name}.cjs`);
  fs.writeFileSync(filePath, body, "utf8");
  return filePath;
}

function settledError(promise) {
  return promise.then(
    () => assert.fail("Expected processing worker operation to reject."),
    (error) => error,
  );
}

test("compiled fixed-rig processing worker is isolated, exact, bounded, and terminal", async (t) => {
  const fixture = await createFixture();
  const request = await createFixedRigProcessingWorkerRequest({
    allowedOutputRoot: fixture.root,
    requestId: "request-front-1",
    sessionId: "session-front-1",
    captureBatch: fixture.batch,
  });
  const immutableHashes = fixture.sources.map(hash);
  let response;

  await t.test("compiled Windows-safe worker resolves exact sources off the event loop and drains before success", async () => {
    const controller = new FixedRigProcessingWorkerController({ allowedOutputRoot: fixture.root });
    assert.equal(path.isAbsolute(controller.workerPath), true);
    assert.match(controller.workerPath, /workers[\\/]fixedRigGeometryProcessingWorker\.js$/);
    let eventLoopTicks = 0;
    let maximumTickerGapMs = 0;
    let previousTickAt = Date.now();
    const workerStartedAt = Date.now();
    const ticker = setInterval(() => {
      const tickAt = Date.now();
      eventLoopTicks += 1;
      maximumTickerGapMs = Math.max(maximumTickerGapMs, tickAt - previousTickAt);
      previousTickAt = tickAt;
    }, 10);
    try {
      response = await controller.submit(request);
    } finally {
      clearInterval(ticker);
    }
    assert.equal(response.ok, true);
    assert.deepEqual(response.identity, request.identity);
    assert.equal(response.authority.source.geometry.detectionPolicy, "captured_evidence_full");
    assert.match(response.authority.source.geometry.detection.method, /v3/i);
    assert.equal(response.authority.source.geometry.placementState, "ready");
    assert.ok(eventLoopTicks >= 2, `expected event-loop progress during worker detection, observed ${eventLoopTicks} ticks`);
    const workerDurationMs = Date.now() - workerStartedAt;
    t.diagnostic(`compiled worker duration=${workerDurationMs}ms ticks=${eventLoopTicks} maxTickerGap=${maximumTickerGapMs}ms`);
    assert.ok(maximumTickerGapMs < 750, `worker blocked the main event loop for ${maximumTickerGapMs}ms`);
    assert.deepEqual(controller.status(), {
      active: false,
      pending: 0,
      maxPending: 20,
      maxConcurrency: 1,
      closed: false,
    });
    await controller.shutdown("test complete");
  });

  await t.test("production runner consumes one revalidated authority and preserves v3 normalization and raw bytes", async () => {
    const runner = createFixedRigWarmForensicProcessingRunner({ allowedOutputRoot: fixture.root });
    let result;
    try {
      const callerBatch = structuredClone(fixture.batch);
      const processing = runner.processSide(callerBatch, { requestId: "request-front-2", sessionId: "session-front-1" });
      callerBatch.packageDir = path.join(fixture.root, "mutated-after-submit");
      callerBatch.sideDir = path.join(callerBatch.packageDir, "front");
      callerBatch.batch.captures.allOn.capture.sha256 = "0".repeat(64);
      result = await processing;
    } finally {
      await runner.shutdownProcessingWorker("test complete");
    }
    assert.equal(result.processingWorker.mode, "captured_evidence_worker");
    assert.match(result.processingWorker.sourceSetSha256, /^[a-f0-9]{64}$/);
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
    const authority = manifest.analysisCoordinateSystem.fullResolutionGeometryAuthority;
    assert.equal(authority.source.geometry.detectionPolicy, "captured_evidence_full");
    assert.match(authority.source.geometry.detection.method, /v3/i);
    assert.equal(manifest.front.normalizedCard.geometry.placementState, "ready");
    assert.equal(fs.existsSync(manifest.front.normalizedCard.normalizedArtifact.localOutputPath), true);
    assert.deepEqual(fixture.sources.map(hash), immutableHashes);
  });

  await t.test("compiled worker accepts canonical lossless TIFF evidence without a format fallback", async () => {
    const tiffFixture = await createFixture({ packageId: "worker-package-tiff", format: "tiff" });
    for (const capturedRole of [
      tiffFixture.batch.batch.captures.allOn,
      tiffFixture.batch.batch.captures.acceptedProfile,
      ...tiffFixture.batch.batch.captures.channels,
    ]) {
      capturedRole.capture.timestamp = "2026-07-09T16:00:00-04:00";
    }
    const controller = new FixedRigProcessingWorkerController({ allowedOutputRoot: tiffFixture.root });
    try {
      const tiffResponse = await controller.resolveGeometryAuthority({
        requestId: "request-tiff",
        sessionId: "session-tiff",
        captureBatch: tiffFixture.batch,
      });
      assert.equal(tiffResponse.authority.source.geometry.detectionPolicy, "captured_evidence_full");
      assert.match(tiffResponse.authority.source.geometry.detection.method, /v3/i);
      assert.equal(tiffResponse.authority.source.geometry.placementState, "ready");
      assert.equal(tiffResponse.authority.source.geometry.timestamp, TIMESTAMP);
    } finally {
      await controller.shutdown("TIFF test complete");
    }
  });

  await t.test("request and main-consumer identity reject extra bodies, cross-role metadata, paths, and containment", async () => {
    const extraBody = clone(request);
    extraBody.sources[0].imageBody = "not-allowed";
    assert.throws(() => validateFixedRigProcessingWorkerRequest(extraBody), /unsupported fields/i);
    const absolutePath = clone(request);
    absolutePath.sources[0].relativePath = path.resolve(fixture.root, "outside.png");
    assert.throws(() => validateFixedRigProcessingWorkerRequest(absolutePath), /relative path/i);
    const duplicateRole = clone(request);
    duplicateRole.sources[1].role = "all_on";
    assert.throws(() => validateFixedRigProcessingWorkerRequest(duplicateRole), /order or label/i);
    const extraRequestField = { ...clone(request), sourceImagePath: fixture.sources[0] };
    assert.throws(() => validateFixedRigProcessingWorkerRequest(extraRequestField), /unsupported fields/i);
    const wrongChannelBatch = structuredClone(fixture.batch);
    wrongChannelBatch.batch.captures.acceptedProfile.channel = [8, 7, 6, 5, 4, 3, 2, 1];
    await assert.rejects(
      createFixedRigProcessingWorkerRequest({
        allowedOutputRoot: fixture.root,
        requestId: "request-wrong-channel",
        sessionId: "session-front-1",
        captureBatch: wrongChannelBatch,
      }),
      /filename or role label is invalid/i,
    );
    await validateFixedRigProcessingWorkerAuthorityInput(request, authorityInput(fixture.batch), fixture.root);
    const equivalentTimestampBatch = structuredClone(fixture.batch);
    equivalentTimestampBatch.batch.captures.allOn.capture.timestamp = "2026-07-09T16:00:00-04:00";
    await validateFixedRigProcessingWorkerAuthorityInput(request, authorityInput(equivalentTimestampBatch), fixture.root);
    const changedInput = authorityInput(fixture.batch);
    changedInput.acceptedProfile = {
      ...changedInput.acceptedProfile,
      capture: { ...changedInput.acceptedProfile.capture, timestamp: "2026-07-09T20:00:01.000Z" },
    };
    await assert.rejects(
      validateFixedRigProcessingWorkerAuthorityInput(request, changedInput, fixture.root),
      /did not match its revalidated worker source/i,
    );
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-worker-other-root-"));
    await assert.rejects(
      createFixedRigProcessingWorkerRequest({
        allowedOutputRoot: otherRoot,
        requestId: "request-outside",
        sessionId: "session-front-1",
        captureBatch: fixture.batch,
      }),
      /immutable side package|containment/i,
    );
  });

  await t.test("authority validation rejects injected fields, dropped/duplicate roles, and altered PR92 consensus", () => {
    validateFixedRigProcessingWorkerAuthority(request, response.authority);
    for (const mutate of [
      (authority) => { authority.imageBody = "forbidden"; },
      (authority) => { authority.source.geometry.localPath = "C:\\private\\card.png"; },
      (authority) => { authority.source.geometry.placement.unexpected = true; },
      (authority) => { authority.source.geometry.detection.unexpected = true; },
      (authority) => { authority.source.geometry.corners.topLeft.z = 1; },
      (authority) => { authority.inspectedRoles.pop(); },
      (authority) => { authority.inspectedRoles[1] = clone(authority.inspectedRoles[0]); },
      (authority) => { authority.consensus.maximumCornerDeltaPixels += 0.5; },
      (authority) => { authority.source.geometry.corners.topLeft.x += 2; },
      (authority) => { authority.source.geometry.boundingBox.x += 1; },
      (authority) => { authority.consensus.agreeingRoles = ["all_on"]; },
      (authority) => {
        authority.source.image.coordinateFrame = "data:image/png;base64,AAAA";
        authority.source.geometry.image.coordinateFrame = "data:image/png;base64,AAAA";
      },
      (authority) => { authority.source.geometry.semanticOrientation.basis = "https://private.invalid/geometry"; },
      (authority) => { authority.source.geometry.semanticOrientation.contentUprightVerified = "false"; },
      (authority) => { authority.source.geometry.warnings = ["diagnostic at /private/captured/card.png"]; },
      (authority) => { authority.inspectedRoles[0].warnings = ["file:///C:/private/card.png"]; },
      (authority) => { authority.source.geometry.warnings = ["data:image/png;base64,AAAA"]; },
      (authority) => { authority.source.geometry.warnings = ["source=https://private.invalid/card"]; },
      (authority) => { authority.source.geometry.warnings = ["path=/srv/private/card.png"]; },
      (authority) => { authority.source.geometry.warnings = ["path:/srv/private/card.png"]; },
      (authority) => { authority.source.geometry.warnings = ["path=C:\\private\\card.png"]; },
      (authority) => { authority.source.geometry.warnings = ["capture/card.png"]; },
      (authority) => { authority.source.geometry.warnings = ["capture/manifest.json"]; },
      (authority) => { authority.source.geometry.warnings = ["capture/session/card"]; },
      (authority) => { authority.source.geometry.warnings = ["endpoint=[::1]:3020"]; },
      (authority) => { authority.source.geometry.warnings = ["payload=data:image/png,AAAA"]; },
      (authority) => { authority.source.geometry.warnings = ["A".repeat(300)]; },
      (authority) => { authority.source.geometry.warnings = [`${"A".repeat(200)}\n${"A".repeat(200)}`]; },
      (authority) => { authority.source.geometry.placement.withinFrame = "true"; },
      (authority) => { authority.source.geometry.placement.centerOffsetPixels.x = Number.POSITIVE_INFINITY; },
      (authority) => {
        authority.source.geometry.placement.minReadyConfidence = 1;
        authority.source.geometry.placement.confidenceReady = true;
      },
      (authority) => {
        authority.source.geometry.placement.maxNormalizationSkewDegrees = 0;
        authority.source.geometry.placement.withinNormalizationSkewTolerance = true;
      },
      (authority) => { authority.source.geometry.detection.analysisWidth = "960"; },
      (authority) => { authority.source.geometry.detection.method = "manual_override_no_automatic_detection"; },
      (authority) => { authority.source.geometry.detection.perimeterSidePolarity[0] = "unknown"; },
      (authority) => {
        const detection = authority.source.geometry.detection;
        if (detection.method === "perimeter_gradient_rectangle_v3") delete detection.perimeterGradientStrength;
        else delete detection.componentPixelFraction;
      },
      (authority) => {
        const detection = authority.source.geometry.detection;
        if (detection.method === "perimeter_gradient_rectangle_v3") detection.backgroundColor = { r: 0, g: 0, b: 0 };
        else detection.perimeterGradientStrength = 10;
      },
      (authority) => { authority.inspectedRoles[0].placementState = "automatic"; },
      (authority) => { authority.inspectedRoles[0].confidence = 2; },
      (authority) => {
        const inspection = authority.inspectedRoles.find((candidate) => candidate.role !== authority.authoritativeRole)
          ?? authority.inspectedRoles[0];
        inspection.placementState = "not_detected";
        inspection.adjustmentReason = "low_confidence";
        inspection.corners = null;
        inspection.rotationDegrees = null;
      },
      (authority) => {
        const inspection = authority.inspectedRoles.find((candidate) => candidate.role !== authority.authoritativeRole)
          ?? authority.inspectedRoles[0];
        inspection.placementState = "adjust_card";
        inspection.adjustmentReason = "not_detected";
      },
    ]) {
      const authority = clone(response.authority);
      mutate(authority);
      assert.throws(() => validateFixedRigProcessingWorkerAuthority(request, authority));
    }
    for (const warning of [
      "card.png",
      "manifest.json",
      "endpoint=0:0:0:0:0:0:0:1",
      "endpoint=[::1]:3020",
      "capture/session/card",
    ]) {
      const authority = clone(response.authority);
      authority.source.geometry.warnings = [warning];
      authority.inspectedRoles.find((inspection) => inspection.role === authority.authoritativeRole).warnings = [warning];
      assert.throws(() => validateFixedRigProcessingWorkerAuthority(request, authority));
    }
  });

  await t.test("one active plus twenty pending side jobs is bounded and shutdown drains all without overlap", async () => {
    const hangWorker = writeWorker(fixture.root, "hang-worker", `
      const { parentPort } = require("node:worker_threads");
      parentPort.on("message", () => {});
    `);
    const controller = new FixedRigProcessingWorkerController({
      allowedOutputRoot: fixture.root,
      workerPath: hangWorker,
      timeoutMs: 5000,
    });
    const accepted = Array.from({ length: 21 }, (_, index) => {
      const queuedRequest = clone(request);
      queuedRequest.identity.requestId = `request-bounded-${index}`;
      return settledError(controller.submit(queuedRequest));
    });
    const overflowRequest = clone(request);
    overflowRequest.identity.requestId = "request-bounded-overflow";
    const overflow = settledError(controller.submit(overflowRequest));
    assert.deepEqual(controller.status(), {
      active: true,
      pending: 20,
      maxPending: 20,
      maxConcurrency: 1,
      closed: false,
      activeIdentity: { ...request.identity, requestId: "request-bounded-0" },
    });
    assert.equal((await overflow).code, "queue_full");
    await controller.shutdown("bounded shutdown");
    for (const acceptedJob of accepted) assert.equal((await acceptedJob).code, "shutdown");
    assert.equal(controller.status().closed, true);
    assert.throws(
      () => new FixedRigProcessingWorkerController({ allowedOutputRoot: fixture.root, maxPending: 21 }),
      /zero through twenty pending side jobs/i,
    );
  });

  await t.test("session cancellation terminates its active job and rejects its pending job without closing the controller", async () => {
    const hangWorker = writeWorker(fixture.root, "cancel-hang-worker", `
      const { parentPort } = require("node:worker_threads");
      parentPort.on("message", () => {});
    `);
    const controller = new FixedRigProcessingWorkerController({
      allowedOutputRoot: fixture.root,
      workerPath: hangWorker,
      timeoutMs: 5000,
    });
    const first = settledError(controller.submit(request));
    const pendingRequest = clone(request);
    pendingRequest.identity.requestId = "request-front-pending";
    const second = settledError(controller.submit(pendingRequest));
    await controller.cancelSession(request.identity.sessionId, "session ended");
    assert.equal((await first).code, "cancelled");
    assert.equal((await second).code, "cancelled");
    assert.deepEqual(controller.status(), {
      active: false,
      pending: 0,
      maxPending: 20,
      maxConcurrency: 1,
      closed: false,
    });
    await controller.shutdown("cancel test complete");
  });

  await t.test("one failed side job advances the same serialized worker queue to the later exact job", async () => {
    const advancingWorker = writeWorker(fixture.root, "advancing-worker", `
      const { parentPort } = require("node:worker_threads");
      let requestIdentity;
      parentPort.on("message", (message) => {
        if (message.operation === "revalidate_captured_source_identity") {
          parentPort.postMessage({ ...message, ok: true });
          setImmediate(() => process.exit(0));
          return;
        }
        requestIdentity = message.identity;
        if (message.identity.requestId === "request-intentional-failure") {
          parentPort.postMessage({
            protocolVersion: message.protocolVersion,
            operation: message.operation,
            ok: false,
            identity: requestIdentity,
            error: { code: "processing_failed", message: "intentional exact-item failure" },
          });
          return;
        }
        parentPort.postMessage({
          protocolVersion: message.protocolVersion,
          operation: message.operation,
          ok: true,
          identity: requestIdentity,
          authority: ${JSON.stringify(response.authority)},
        });
      });
    `);
    const controller = new FixedRigProcessingWorkerController({
      allowedOutputRoot: fixture.root,
      workerPath: advancingWorker,
      timeoutMs: 5000,
    });
    const failedRequest = clone(request);
    failedRequest.identity.requestId = "request-intentional-failure";
    const laterRequest = clone(request);
    laterRequest.identity.requestId = "request-after-failure";
    const failed = settledError(controller.submit(failedRequest));
    const later = controller.submit(laterRequest);
    assert.equal((await failed).code, "worker_failed");
    assert.equal((await later).identity.requestId, "request-after-failure");
    assert.equal(controller.status().maxConcurrency, 1);
    await controller.shutdown("advance test complete");
  });

  await t.test("the sole controller slot remains held through heavy TIFF-to-PNG response processing", async () => {
    const workerPath = writeWorker(fixture.root, "held-full-processing-worker", `
      const { parentPort } = require("node:worker_threads");
      parentPort.on("message", (message) => {
        if (message.operation === "revalidate_captured_source_identity") {
          parentPort.postMessage({ ...message, ok: true });
          setImmediate(() => process.exit(0));
          return;
        }
        parentPort.postMessage({
          protocolVersion: message.protocolVersion,
          operation: message.operation,
          ok: true,
          identity: message.identity,
          authority: ${JSON.stringify(response.authority)},
        });
      });
    `);
    const controller = new FixedRigProcessingWorkerController({ allowedOutputRoot: fixture.root, workerPath, timeoutMs: 5000 });
    let releaseFirst;
    const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
    let firstProcessingStarted = false;
    let secondProcessingStarted = false;
    const firstRequest = clone(request);
    firstRequest.identity.requestId = "request-held-heavy-first";
    const secondRequest = clone(request);
    secondRequest.identity.requestId = "request-held-heavy-second";
    const first = controller.submit(firstRequest, async (workerResponse) => {
      firstProcessingStarted = true;
      await firstHeld;
      return workerResponse.identity.requestId;
    });
    while (!firstProcessingStarted) await new Promise((resolve) => setTimeout(resolve, 5));
    const second = controller.submit(secondRequest, async (workerResponse) => {
      secondProcessingStarted = true;
      return workerResponse.identity.requestId;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(secondProcessingStarted, false, "later side cannot enter heavy processing while first TIFF-to-PNG body is held");
    assert.equal(controller.status().activeIdentity.requestId, firstRequest.identity.requestId);
    assert.equal(controller.status().pending, 1);
    assert.equal(controller.status().maxConcurrency, 1);
    releaseFirst();
    assert.equal(await first, firstRequest.identity.requestId);
    assert.equal(await second, secondRequest.identity.requestId);
    assert.equal(secondProcessingStarted, true);
    await controller.shutdown("held full processing complete");
  });

  await t.test("crash, timeout, malformed, wrong identity, and child error are redacted terminal results", async () => {
    const workers = {
      crash: writeWorker(fixture.root, "crash-worker", `throw new Error("C:\\\\private\\\\secret-card.tiff token=hidden");`),
      timeout: writeWorker(fixture.root, "timeout-worker", `
        const { parentPort } = require("node:worker_threads");
        parentPort.on("message", () => {});
      `),
      malformed: writeWorker(fixture.root, "malformed-worker", `
        const { parentPort } = require("node:worker_threads");
        parentPort.on("message", () => { const value = {}; value.self = value; parentPort.postMessage(value); });
      `),
      wrong: writeWorker(fixture.root, "wrong-worker", `
        const { parentPort } = require("node:worker_threads");
        parentPort.on("message", (request) => parentPort.postMessage({
          protocolVersion: request.protocolVersion,
          operation: request.operation,
          ok: false,
          identity: { ...request.identity, sessionId: "wrong-session" },
          error: { code: "processing_failed", message: "wrong" },
        }));
      `),
      childFailure: writeWorker(fixture.root, "failure-worker", `
        const { parentPort } = require("node:worker_threads");
        parentPort.on("message", (request) => parentPort.postMessage({
          protocolVersion: request.protocolVersion,
          operation: request.operation,
          ok: false,
          identity: request.identity,
          error: { code: "processing_failed", message: "C:\\\\private\\\\card.tiff token=hidden" },
        }));
      `),
      extraWrapper: writeWorker(fixture.root, "extra-wrapper-worker", `
        const { parentPort } = require("node:worker_threads");
        parentPort.on("message", (request) => parentPort.postMessage({
          protocolVersion: request.protocolVersion,
          operation: request.operation,
          ok: false,
          identity: request.identity,
          error: { code: "processing_failed", message: "failed" },
          imageBody: "forbidden",
        }));
      `),
      extraAck: writeWorker(fixture.root, "extra-ack-worker", `
        const { parentPort } = require("node:worker_threads");
        let identity;
        parentPort.on("message", (message) => {
          if (!identity) {
            identity = message.identity;
            parentPort.postMessage({
              protocolVersion: message.protocolVersion,
              operation: message.operation,
              ok: true,
              identity,
              authority: ${JSON.stringify(response.authority)},
            });
            return;
          }
          parentPort.postMessage({
            protocolVersion: message.protocolVersion,
            operation: message.operation,
            ok: true,
            identity,
            blob: "forbidden",
          });
        });
      `),
    };
    const expected = {
      crash: "crash",
      timeout: "timeout",
      malformed: "malformed_response",
      wrong: "identity_mismatch",
      childFailure: "worker_failed",
      extraWrapper: "malformed_response",
      extraAck: "malformed_response",
    };
    for (const [name, workerPath] of Object.entries(workers)) {
      const controller = new FixedRigProcessingWorkerController({
        allowedOutputRoot: fixture.root,
        workerPath,
        timeoutMs: name === "timeout" ? 100 : 2000,
      });
      const error = await settledError(controller.submit(request));
      assert.ok(error instanceof FixedRigProcessingWorkerError);
      assert.equal(error.code, expected[name]);
      assert.doesNotMatch(error.message, /private|secret-card|token=hidden/i);
      if (name === "childFailure") assert.equal(error.workerFailureKind, "processing_failed");
      await controller.shutdown("terminal test complete");
    }
  });

  await t.test("source mutation after request is terminal and never silently falls back", async () => {
    await sharp({ create: { width: 32, height: 32, channels: 3, background: "#000" } })
      .png()
      .toFile(fixture.sources[0]);
    const controller = new FixedRigProcessingWorkerController({ allowedOutputRoot: fixture.root });
    const error = await settledError(controller.submit(request));
    assert.equal(error.code, "worker_failed");
    assert.equal(error.workerFailureKind, "source_integrity_failed");
    assert.doesNotMatch(error.message, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    await controller.shutdown("mutation test complete");
  });
});
