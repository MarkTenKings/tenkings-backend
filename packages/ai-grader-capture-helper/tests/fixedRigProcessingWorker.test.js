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
const {
  collectFixedRigMathematicalNativeCaptureRolesV1,
} = require("../dist/drivers/fixedRigMathematicalStationAdapterV1");

const TIMESTAMP = "2026-07-09T20:00:00.000Z";
const FILE_STAMP = "20260709T200000000Z";

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function capture(filePath, note, index, mimeType = "image/png", overrides = {}) {
  return {
    outputFilePath: filePath,
    sha256: hash(filePath),
    byteSize: fs.statSync(filePath).size,
    mimeType,
    timestamp: overrides.timestamp ?? TIMESTAMP,
    camera: {
      index: 0,
      modelName: "file-fixture-only",
      ...(overrides.cameraSerialNumber
        ? { serialNumber: overrides.cameraSerialNumber }
        : {}),
    },
    imageWidth: 1400,
    imageHeight: 1960,
    sourcePixelFormat: "Mono8",
    savedImageFormat: mimeType === "image/tiff" ? "TIFF" : "PNG",
    exposureTime: overrides.exposureTime ?? 45000,
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
    ...(options.bracket
      ? []
      : Array.from({ length: 8 }, (_, index) => [
          `channel_${index + 1}`,
          `${side}-channel-${index + 1}`,
          index + 1,
        ])),
  ];
  const roleCaptures = definitions.map(([roleName, label, channel], index) => {
    const filePath = path.join(sideDir, `basler-${label}-${FILE_STAMP}.${extension}`);
    fs.copyFileSync(sourceTemplate, filePath);
    return role(roleName, label, capture(filePath, label, index + 1, mimeType), channel);
  });
  let rawOrdinal = roleCaptures.length;
  const bracketCells = options.bracket
    ? [15000, 30000, 37500].map((exposureUs) => {
        const bracketRole = (kind, ordinal) => {
          rawOrdinal += 1;
          const roleName = `bracket_${exposureUs}_${kind}_${ordinal}`;
          const label = `${side}-bracket-${exposureUs}-${kind}-${ordinal}`;
          const filePath = path.join(sideDir, `basler-${label}-${FILE_STAMP}.${extension}`);
          fs.copyFileSync(sourceTemplate, filePath);
          const captureValue = capture(filePath, label, rawOrdinal, mimeType, {
            exposureTime: exposureUs,
            cameraSerialNumber: "worker-camera-serial-1",
            timestamp: new Date(Date.parse(TIMESTAMP) + rawOrdinal).toISOString(),
          });
          const startedTicks = rawOrdinal * 10;
          return {
            ...role(
              roleName,
              label,
              captureValue,
              kind === "channel" ? ordinal : undefined,
            ),
            exposureUs,
            monotonicStartedTicks: startedTicks,
            monotonicFinishedTicks: startedTicks + 5,
            ...(kind === "reference"
              ? { referenceOrdinal: ordinal }
              : { dutyTenthsPercent: 24, settleMs: 0 }),
          };
        };
        return {
          exposureUs,
          cameraReadback: {
            exposureUs,
            gain: 0,
            pixelFormat: "Mono8",
            cameraSerialNumber: "worker-camera-serial-1",
          },
          references: Array.from({ length: 3 }, (_, index) =>
            bracketRole("reference", index + 1)),
          channels: Array.from({ length: 8 }, (_, index) =>
            bracketRole("channel", index + 1)),
        };
      })
    : undefined;
  const darkPath = options.bracket
    ? undefined
    : path.join(sideDir, `basler-${side}-dark-${FILE_STAMP}.${extension}`);
  if (darkPath) fs.copyFileSync(sourceTemplate, darkPath);
  if (options.bracket) {
    const exactRawRoles = [
      ...roleCaptures,
      ...bracketCells.flatMap((cell) => [...cell.references, ...cell.channels]),
    ];
    await Promise.all(exactRawRoles.map(async (entry, index) => {
      await sharp(sourceTemplate)
        .withMetadata({ density: 72 + index })
        .tiff({ compression: "lzw" })
        .toFile(entry.capture.outputFilePath);
      entry.capture.sha256 = hash(entry.capture.outputFilePath);
      entry.capture.byteSize = fs.statSync(entry.capture.outputFilePath).size;
    }));
  }
  fs.unlinkSync(sourceTemplate);
  const selectedBracketCell = bracketCells?.[2];
  const darkControl = selectedBracketCell
    ? selectedBracketCell.references[0]
    : role("dark_control", `${side}-dark`, capture(darkPath, `${side}-dark`, 0, mimeType));
  const selectedChannels = selectedBracketCell
    ? selectedBracketCell.channels
    : roleCaptures.slice(2);
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
      selectedDutyPercent: options.bracket ? 2.4 : 1.2,
      actualLeimacPwmStep: options.bracket ? 24 : 12,
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
      dutyTenthsPercent: options.bracket ? 24 : 12,
      capturesStarted: true,
      leimac: { triggerSetup: { writes: [] } },
      captures: {
        darkControl,
        allOn: roleCaptures[0],
        acceptedProfile: roleCaptures[1],
        channels: selectedChannels,
        ...(bracketCells
          ? {
              photometricBracket: {
                version: "fixed_rig_exposure_bracket_capture_v1",
                exposuresUs: [15000, 30000, 37500],
                isolatedDutyTenthsPercent: 24,
                settleMs: 0,
                gain: 0,
                pixelFormat: "Mono8",
                cells: bracketCells,
              },
            }
          : {}),
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
  const nativeSources = bracketCells
    ? [
        roleCaptures[0],
        roleCaptures[1],
        ...bracketCells.flatMap((cell) => [...cell.references, ...cell.channels]),
      ]
    : roleCaptures;
  return {
    root,
    packageDir,
    sideDir,
    batch,
    sources: nativeSources.map((entry) => entry.capture.outputFilePath),
  };
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
      const admission = await processing.admission;
      assert.deepEqual(admission, {
        status: "accepted",
        requestId: "request-front-2",
        sessionId: "session-front-1",
        packageId: fixture.batch.packageId,
        side: "front",
        acceptedAt: admission.acceptedAt,
        validationBoundary: "structural_snapshot_only",
        sourceIntegrity: "pending_worker_validation",
      });
      assert.equal(new Date(admission.acceptedAt).toISOString(), admission.acceptedAt);
      assert.equal(Object.isFrozen(admission), true, "the admitted exact identity cannot be mutated after controller insertion");
      assert.equal("sourceSetSha256" in admission, false, "source integrity is a later child-worker validation, not structural admission");
      assert.equal(runner.processingWorkerStatus().active, true, "admission resolves only after insertion into the one controller queue");
      assert.equal(runner.processingWorkerStatus().maxConcurrency, 1);
      callerBatch.packageDir = path.join(fixture.root, "mutated-after-submit");
      callerBatch.sideDir = path.join(callerBatch.packageDir, "front");
      callerBatch.batch.captures.allOn.capture.sha256 = "0".repeat(64);
      result = await processing;
    } finally {
      await runner.shutdownProcessingWorker("test complete");
    }
    assert.equal(result.processingWorker.mode, "captured_evidence_worker");
    assert.equal(result.processingWorker.requestId, "request-front-2");
    assert.equal(result.processingWorker.sessionId, "session-front-1");
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

  await t.test("native 35-role exposure bracket preserves exact capture identities through worker geometry and normalization", async (t) => {
    const bracketFixture = await createFixture({
      packageId: "worker-package-native-bracket",
      format: "tiff",
      bracket: true,
    });
    t.after(() => fs.rmSync(bracketFixture.root, { recursive: true, force: true }));
    const nativeRoles = [
      bracketFixture.batch.batch.captures.allOn,
      bracketFixture.batch.batch.captures.acceptedProfile,
      ...bracketFixture.batch.batch.captures.photometricBracket.cells.flatMap((cell) => [
        ...cell.references,
        ...cell.channels,
      ]),
    ];
    assert.equal(nativeRoles.length, 35);
    assert.equal(new Set(nativeRoles.map((entry) => entry.capture.outputFilePath)).size, 35);
    const immutableHashes = bracketFixture.sources.map(hash);
    const bracketRequest = await createFixedRigProcessingWorkerRequest({
      allowedOutputRoot: bracketFixture.root,
      requestId: "request-native-bracket",
      sessionId: "session-native-bracket",
      captureBatch: bracketFixture.batch,
    });
    assert.deepEqual(
      bracketRequest.sources.map((source) => source.role),
      ["all_on", "accepted_profile", ...Array.from({ length: 8 }, (_, index) => `channel_${index + 1}`)],
      "geometry authority retains its canonical role vocabulary",
    );
    assert.deepEqual(
      bracketRequest.sources.map((source) => source.captureRole),
      [
        "all_on",
        "accepted_profile",
        ...Array.from({ length: 8 }, (_, index) => `bracket_37500_channel_${index + 1}`),
      ],
      "the request separately binds the exact native capture roles",
    );
    assert.equal(new Set(bracketRequest.sources.map((source) => source.relativePath)).size, 10);

    const runner = createFixedRigWarmForensicProcessingRunner({
      allowedOutputRoot: bracketFixture.root,
    });
    let result;
    try {
      result = await runner.processSide(bracketFixture.batch, {
        requestId: "request-native-bracket-processing",
        sessionId: "session-native-bracket",
      });
    } finally {
      await runner.shutdownProcessingWorker("native bracket test complete");
    }
    assert.equal(result.processingWorker.mode, "captured_evidence_worker");
    assert.match(result.processingWorker.sourceSetSha256, /^[a-f0-9]{64}$/);
    assert.equal(result.manifest.rawEvidenceIntegrity.verified, true);
    assert.equal(result.manifest.rawEvidenceIntegrity.roles.length, 35);
    assert.deepEqual(
      result.manifest.rawEvidenceIntegrity.roles.map((entry) => entry.role),
      nativeRoles.map((entry) => entry.role),
    );
    assert.equal(result.manifest.front.allOn.capture.captureRole, undefined);
    assert.equal(result.manifest.front.acceptedProfile.capture.captureRole, undefined);
    assert.equal(
      result.manifest.front.photometricExposureBracket.cells[2].channels[0]
        .capture.captureRole,
      undefined,
      "real capture objects do not fabricate a nested captureRole field",
    );
    const nativeRoleBindings =
      collectFixedRigMathematicalNativeCaptureRolesV1(result.manifest.front, "front");
    assert.equal(nativeRoleBindings.length, 35);
    assert.deepEqual(
      nativeRoleBindings.map((entry) => entry.captureRole),
      nativeRoles.map((entry) => entry.role),
    );
    assert.deepEqual(
      nativeRoleBindings.map((entry) => entry.sha256),
      nativeRoles.map((entry) => entry.capture.sha256),
    );
    const wrongPresentationLabel = structuredClone(result.manifest.front);
    wrongPresentationLabel.allOn.label = "front-legacy-alias";
    assert.throws(
      () => collectFixedRigMathematicalNativeCaptureRolesV1(
        wrongPresentationLabel,
        "front",
      ),
      /canonical side identities/i,
    );
    const wrongNativeRole = structuredClone(result.manifest.front);
    wrongNativeRole.photometricExposureBracket.cells[1].channels[3].role =
      "bracket_30000_channel_5";
    assert.throws(
      () => collectFixedRigMathematicalNativeCaptureRolesV1(wrongNativeRole, "front"),
      /captureRole must equal bracket_30000_channel_4/i,
    );
    const aliasedRawHash = structuredClone(result.manifest.front);
    aliasedRawHash.photometricExposureBracket.cells[0].references[1].capture.sha256 =
      aliasedRawHash.photometricExposureBracket.cells[0].references[0].capture.sha256;
    assert.throws(
      () => collectFixedRigMathematicalNativeCaptureRolesV1(aliasedRawHash, "front"),
      /missing, duplicated, or aliased/i,
    );
    const normalizedBracket =
      result.manifest.front.photometricExposureBracket.cells.flatMap((cell) => [
        ...cell.references,
        ...cell.channels,
      ]);
    assert.equal(normalizedBracket.length, 33);
    assert.equal(
      new Set(normalizedBracket.map((entry) => entry.capture.outputFilePath)).size,
      33,
    );
    assert.equal(
      new Set(normalizedBracket.map((entry) => entry.normalized.analysisArtifact.localOutputPath)).size,
      33,
    );
    assert.equal(
      normalizedBracket.every((entry) =>
        fs.existsSync(entry.normalized.analysisArtifact.localOutputPath)),
      true,
    );
    assert.equal(
      fs.existsSync(result.manifest.front.normalizedCard.normalizedArtifact.localOutputPath),
      true,
    );
    assert.deepEqual(bracketFixture.sources.map(hash), immutableHashes);
  });

  await t.test("native bracket selected aliases, request roles, and every raw role remain fail-closed", async (t) => {
    const bracketFixture = await createFixture({
      packageId: "worker-package-native-bracket-negative",
      format: "tiff",
      bracket: true,
    });
    t.after(() => fs.rmSync(bracketFixture.root, { recursive: true, force: true }));
    const wrongSelectedCell = structuredClone(bracketFixture.batch);
    wrongSelectedCell.batch.captures.channels = [
      wrongSelectedCell.batch.captures.photometricBracket.cells[1].channels[0],
      ...wrongSelectedCell.batch.captures.channels.slice(1),
    ];
    await assert.rejects(
      createFixedRigProcessingWorkerRequest({
        allowedOutputRoot: bracketFixture.root,
        requestId: "request-native-bracket-wrong-alias",
        sessionId: "session-native-bracket-negative",
        captureBatch: wrongSelectedCell,
      }),
      /not its exact native 37\.5 ms channel/i,
    );

    const bracketRequest = await createFixedRigProcessingWorkerRequest({
      allowedOutputRoot: bracketFixture.root,
      requestId: "request-native-bracket-negative",
      sessionId: "session-native-bracket-negative",
      captureBatch: bracketFixture.batch,
    });
    const forgedRoleOrder = clone(bracketRequest);
    [
      forgedRoleOrder.sources[2].captureRole,
      forgedRoleOrder.sources[3].captureRole,
    ] = [
      forgedRoleOrder.sources[3].captureRole,
      forgedRoleOrder.sources[2].captureRole,
    ];
    assert.throws(
      () => validateFixedRigProcessingWorkerRequest(forgedRoleOrder),
      /native capture roles are missing, duplicated, or out of order/i,
    );
    const canonicalizedConsumer = authorityInput(bracketFixture.batch);
    canonicalizedConsumer.channels = canonicalizedConsumer.channels.map((entry, index) => ({
      ...entry,
      role: `channel_${index + 1}`,
    }));
    await assert.rejects(
      validateFixedRigProcessingWorkerAuthorityInput(
        bracketRequest,
        canonicalizedConsumer,
        bracketFixture.root,
      ),
      /authority roles were missing, duplicated, or reordered/i,
    );

    const unselectedLowExposureReference =
      bracketFixture.batch.batch.captures.photometricBracket.cells[0].references[1];
    fs.appendFileSync(unselectedLowExposureReference.capture.outputFilePath, "tampered");
    const runner = createFixedRigWarmForensicProcessingRunner({
      allowedOutputRoot: bracketFixture.root,
    });
    try {
      const error = await settledError(
        runner.processSide(bracketFixture.batch, {
          requestId: "request-native-bracket-tampered",
          sessionId: "session-native-bracket-negative",
        }),
      );
      assert.ok(error instanceof FixedRigProcessingWorkerError);
      assert.equal(error.code, "worker_failed");
      assert.equal(error.workerFailureKind, "processing_failed");
      assert.match(error.message, /failed safely; processing stopped/i);
    } finally {
      await runner.shutdownProcessingWorker("native bracket negative test complete");
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

  await t.test("one active plus twenty pending warm-side jobs stay serialized and advance in order", async () => {
    const eventsPath = path.join(fixture.root, "warm-capacity-events.log");
    const releasePath = path.join(fixture.root, "warm-capacity-release");
    const warmSideWorkerPath = writeWorker(fixture.root, "warm-capacity-worker", `
      const crypto = require("node:crypto");
      const fs = require("node:fs");
      const path = require("node:path");
      const { parentPort, workerData } = require("node:worker_threads");
      const admitted = workerData.admissionIdentity;
      const eventsPath = path.join(workerData.allowedOutputRoot, "warm-capacity-events.log");
      const releasePath = path.join(workerData.allowedOutputRoot, "warm-capacity-release");
      const record = (kind) => fs.appendFileSync(eventsPath, admitted.requestId + ":" + kind + String.fromCharCode(10));
      const finish = () => {
        record("end");
        const identity = {
          protocolVersion: "fixed-rig-geometry-processing-worker-v1",
          requestId: admitted.requestId,
          sessionId: admitted.sessionId,
          packageId: admitted.packageId,
          side: admitted.side,
          sourceSetSha256: crypto.createHash("sha256").update(admitted.requestId).digest("hex"),
        };
        parentPort.postMessage({
          protocolVersion: "fixed-rig-geometry-processing-worker-v1",
          operation: "process_fixed_rig_warm_side",
          ok: true,
          identity,
          result: {
            executionPath: "warm_full_forensic_runner",
            packageId: admitted.packageId,
            packageDir: workerData.captureBatch.packageDir,
            manifestPath: path.join(workerData.captureBatch.packageDir, "manifest.json"),
            analysisPath: path.join(workerData.captureBatch.packageDir, "analysis.json"),
            previewReportPath: path.join(workerData.captureBatch.packageDir, "preview-report.html"),
            manifest: {},
            processingWorker: { ...identity, mode: "captured_evidence_worker" },
          },
        });
        parentPort.close();
      };
      record("start");
      if (admitted.requestId === "warm-capacity-0") {
        const timer = setInterval(() => {
          if (fs.existsSync(releasePath)) { clearInterval(timer); finish(); }
        }, 5);
      } else finish();
    `);
    const runner = createFixedRigWarmForensicProcessingRunner({
      allowedOutputRoot: fixture.root,
      warmSideWorkerPath,
      maxPending: 20,
      timeoutMs: 5000,
    });
    const batchFor = (index) => {
      const value = structuredClone(fixture.batch);
      value.packageId = `warm-capacity-package-${index}`;
      value.packageDir = path.join(fixture.root, value.packageId);
      value.sideDir = path.join(value.packageDir, value.side);
      value.batch.outputDir = value.sideDir;
      return value;
    };
    const submissions = [];
    try {
      for (let index = 0; index < 21; index += 1) {
        const submission = runner.processSide(batchFor(index), {
          requestId: `warm-capacity-${index}`,
          sessionId: `warm-capacity-session-${index}`,
        });
        submissions.push(submission);
        assert.equal((await submission.admission).requestId, `warm-capacity-${index}`);
      }
      assert.deepEqual(runner.processingWorkerStatus(), {
        active: true,
        pending: 20,
        maxPending: 20,
        maxConcurrency: 1,
        closed: false,
      });
      assert.throws(
        () => runner.processSide(batchFor(21), {
          requestId: "warm-capacity-overflow",
          sessionId: "warm-capacity-overflow-session",
        }),
        (error) => error instanceof FixedRigProcessingWorkerError && error.code === "queue_full",
      );
      for (let attempt = 0; attempt < 200 && !fs.existsSync(eventsPath); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(fs.existsSync(eventsPath), true, "the active warm-side worker started");
      assert.deepEqual(
        fs.readFileSync(eventsPath, "utf8").trim().split(/\r?\n/),
        ["warm-capacity-0:start"],
      );
      fs.writeFileSync(releasePath, "release");
      const results = await Promise.all(submissions);
      assert.deepEqual(
        results.map((result) => result.processingWorker.requestId),
        Array.from({ length: 21 }, (_, index) => `warm-capacity-${index}`),
      );
      assert.deepEqual(
        fs.readFileSync(eventsPath, "utf8").trim().split(/\r?\n/),
        Array.from(
          { length: 21 },
          (_, index) => [`warm-capacity-${index}:start`, `warm-capacity-${index}:end`],
        ).flat(),
      );
      assert.deepEqual(runner.processingWorkerStatus(), {
        active: false,
        pending: 0,
        maxPending: 20,
        maxConcurrency: 1,
        closed: false,
      });
    } finally {
      if (!fs.existsSync(releasePath)) fs.writeFileSync(releasePath, "release");
      await runner.shutdownProcessingWorker("warm capacity test complete");
    }
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

  await t.test("a hung or malformed TIFF-to-PNG child is terminal once and the same queue advances to later admitted sides", async () => {
    const eventPath = path.join(fixture.root, "warm-side-worker-events.log");
    const warmSideWorkerPath = writeWorker(fixture.root, "bounded-warm-side-worker", `
      const crypto = require("node:crypto");
      const fs = require("node:fs");
      const path = require("node:path");
      const { parentPort, workerData } = require("node:worker_threads");
      const admitted = workerData.admissionIdentity;
      fs.appendFileSync(path.join(workerData.allowedOutputRoot, "warm-side-worker-events.log"), admitted.requestId + String.fromCharCode(10));
      if (admitted.requestId === "request-hung-tiff-png") {
        setInterval(() => undefined, 1000);
      } else {
        const identity = {
          protocolVersion: "fixed-rig-geometry-processing-worker-v1",
          requestId: admitted.requestId,
          sessionId: admitted.sessionId,
          packageId: admitted.packageId,
          side: admitted.side,
          sourceSetSha256: crypto.createHash("sha256").update(JSON.stringify(admitted)).digest("hex"),
        };
        parentPort.postMessage({
          protocolVersion: "fixed-rig-geometry-processing-worker-v1",
          operation: "process_fixed_rig_warm_side",
          ok: true,
          identity,
          result: {
            executionPath: "warm_full_forensic_runner",
            packageId: admitted.packageId,
            packageDir: workerData.captureBatch.packageDir,
            manifestPath: path.join(workerData.captureBatch.packageDir, "manifest.json"),
            analysisPath: path.join(workerData.captureBatch.packageDir, "analysis.json"),
            previewReportPath: path.join(workerData.captureBatch.packageDir, "preview-report.html"),
            manifest: {},
            processingWorker: admitted.requestId === "request-malformed-processing-identity"
              ? null
              : { ...identity, mode: "captured_evidence_worker" },
          },
        });
        parentPort.close();
      }
    `);
    const runner = createFixedRigWarmForensicProcessingRunner({
      allowedOutputRoot: fixture.root,
      warmSideWorkerPath,
      maxPending: 1,
      timeoutMs: 100,
    });
    const queuedBatch = (packageId) => {
      const value = structuredClone(fixture.batch);
      value.packageId = packageId;
      value.packageDir = path.join(fixture.root, packageId);
      value.sideDir = path.join(value.packageDir, value.side);
      value.batch.outputDir = value.sideDir;
      return value;
    };
    try {
      const structurallyInvalid = structuredClone(fixture.batch);
      structurallyInvalid.sideDir = path.join(fixture.root, "wrong-side-directory");
      assert.throws(
        () => runner.processSide(structurallyInvalid, {
          requestId: "request-invalid-structure",
          sessionId: "session-invalid-structure",
        }),
        (error) => error instanceof FixedRigProcessingWorkerError && error.code === "identity_mismatch",
        "structurally invalid evidence never receives an admission handle",
      );
      assert.equal(runner.processingWorkerStatus().active, false);
      const hung = runner.processSide(fixture.batch, {
        requestId: "request-hung-tiff-png",
        sessionId: "session-hung-tiff-png",
      });
      const hungSettled = settledError(hung);
      assert.equal((await hung.admission).validationBoundary, "structural_snapshot_only");
      const laterBatch = queuedBatch("worker-package-later");
      const later = runner.processSide(laterBatch, {
        requestId: "request-after-hung-tiff-png",
        sessionId: "session-after-hung-tiff-png",
      });
      assert.equal((await later.admission).requestId, "request-after-hung-tiff-png");
      assert.throws(
        () => runner.processSide(laterBatch, {
          requestId: "request-not-admitted-queue-full",
          sessionId: "session-not-admitted-queue-full",
        }),
        (error) => error instanceof FixedRigProcessingWorkerError && error.code === "queue_full",
        "a caller cannot observe an admission handle when insertion did not occur",
      );
      assert.equal(runner.processingWorkerStatus().pending, 1);
      assert.equal(runner.processingWorkerStatus().maxConcurrency, 1);
      while (!fs.existsSync(eventPath)) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.deepEqual(
        fs.readFileSync(eventPath, "utf8").trim().split(/\r?\n/),
        ["request-hung-tiff-png"],
        "the later side cannot start while the first side owns the active child",
      );
      const hungError = await hungSettled;
      assert.equal(hungError.code, "timeout");
      const laterResult = await later;
      assert.equal(laterResult.processingWorker.requestId, "request-after-hung-tiff-png");
      assert.deepEqual(
        fs.readFileSync(eventPath, "utf8").trim().split(String.fromCharCode(10)).map((line) => line.trim()),
        ["request-hung-tiff-png", "request-after-hung-tiff-png"],
        "the hung exact side was not retried and the later side started once after child termination",
      );
      const malformed = runner.processSide(queuedBatch("worker-package-malformed"), {
        requestId: "request-malformed-processing-identity",
        sessionId: "session-malformed-processing-identity",
      });
      const malformedSettled = settledError(malformed);
      await malformed.admission;
      const afterMalformed = runner.processSide(queuedBatch("worker-package-after-malformed"), {
        requestId: "request-after-malformed-processing-identity",
        sessionId: "session-after-malformed-processing-identity",
      });
      await afterMalformed.admission;
      const malformedError = await malformedSettled;
      assert.ok(malformedError instanceof FixedRigProcessingWorkerError);
      assert.equal(malformedError.code, "identity_mismatch", "malformed nested identity is one exact-item terminal rejection");
      assert.equal((await afterMalformed).processingWorker.requestId, "request-after-malformed-processing-identity");
      assert.deepEqual(
        fs.readFileSync(eventPath, "utf8").trim().split(String.fromCharCode(10)).map((line) => line.trim()),
        [
          "request-hung-tiff-png",
          "request-after-hung-tiff-png",
          "request-malformed-processing-identity",
          "request-after-malformed-processing-identity",
        ],
        "malformed success did not crash or retry, and the same queue advanced once to the later side",
      );
      assert.deepEqual(runner.processingWorkerStatus(), {
        active: false,
        pending: 0,
        maxPending: 1,
        maxConcurrency: 1,
        closed: false,
      });
    } finally {
      await runner.shutdownProcessingWorker("bounded warm-side test complete");
    }
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
