const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_AUTHORITY_SCHEMA,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA,
  FixedRigFastMathematicalCalibrationCoreV1_2,
  hashFastCalibrationCanonicalV1_2,
  validateFastCalibrationRuntimeContextV1_2,
  verifyFastCalibrationRigCharacterizationSourceV1_2,
} = require("../dist/drivers/fixedRigFastMathematicalCalibrationV1_2");

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const exactHash = (seed) => digest(Buffer.from(seed));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");

function runtimeContext() {
  return {
    schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA,
    stationId: "dell-station-1",
    rigId: "fixed-rig-dell-v1",
    camera: {
      serialNumber: "camera-serial-1",
      modelName: "Basler-model-1",
      lensAuthorityId: "lens-authority-1",
      exposureUs: 45000,
      gain: 0,
      pixelFormat: "Mono12",
      widthPx: 2448,
      heightPx: 2048,
    },
    controller: {
      identity: "leimac-controller-1",
      unit: 1,
      channelWiring: Array.from({ length: 8 }, (_, index) => ({
        channelIndex: index + 1,
        controllerOutput: `output-${index + 1}`,
        componentId: `light-component-${index + 1}`,
        physicalDirectionId: `physical-direction-${index + 1}`,
      })),
    },
    dutyPercent: 1.2,
    target: { version: "target-v1", sha256: exactHash("target") },
    componentConfigurationId: "component-configuration-1",
    algorithmHashes: {
      geometry: exactHash("geometry"),
      photometric: exactHash("photometric"),
      finalizer: exactHash("finalizer"),
      thresholdManifest: exactHash("thresholds"),
    },
    locationLabel: "dell-calibration-bench",
    lightingConfigurationId: "lighting-room-state-1",
  };
}

function rigAuthority(context = runtimeContext()) {
  return {
    schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_AUTHORITY_SCHEMA,
    characterizedAt: "2026-07-21T12:00:00.000Z",
    rigId: context.rigId,
    sourceBundleManifestSha256: exactHash("source-bundle"),
    sourceCaptureManifestSha256: exactHash("source-capture"),
    sourceMemberLedgerSha256: exactHash("source-members"),
    targetMetrologyAuthoritySha256: exactHash("target-metrology"),
    cameraLensAuthoritySha256: exactHash("camera-lens"),
    physicalLightDirectionAuthoritySha256: exactHash("directions"),
    componentIdentityAuthoritySha256: exactHash("components"),
    repeatabilityAuthoritySha256: exactHash("repeatability"),
    cameraSerialNumber: context.camera.serialNumber,
    cameraModelName: context.camera.modelName,
    lensAuthorityId: context.camera.lensAuthorityId,
    controllerIdentity: context.controller.identity,
    channelWiring: structuredClone(context.controller.channelWiring),
    targetVersion: context.target.version,
    targetSha256: context.target.sha256,
    componentConfigurationId: context.componentConfigurationId,
    algorithmHashes: structuredClone(context.algorithmHashes),
  };
}

function rigSource(context = runtimeContext()) {
  const members = [
    {
      role: "target_metrology",
      fileName: "target-metrology-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-target-metrology-authority-v1",
        rigId: context.rigId,
        targetVersion: context.target.version,
        targetSha256: context.target.sha256,
        scaleSamples: [],
        targetPrintScaleSamples: [],
        targetCutDimensionSamples: [],
        targetEvidence: [],
      },
    },
    {
      role: "camera_lens",
      fileName: "camera-lens-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-camera-lens-authority-v1",
        rigId: context.rigId,
        cameraSerialNumber: context.camera.serialNumber,
        cameraModelName: context.camera.modelName,
        lensAuthorityId: context.camera.lensAuthorityId,
        normalizedWidthPx: 1000,
        normalizedHeightPx: 1400,
        lensResidualSamples: [],
        lensModel: {
          model: "opencv_brown_conrady_v1", sourceWidthPx: context.camera.widthPx, sourceHeightPx: context.camera.heightPx,
          cameraMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], distortionCoefficients: [0, 0, 0, 0, 0],
          calibrationRmsPx: 0, perViewResidualPx: [],
        },
        normalizationModel: {
          model: "undistort_outer_cut_homography_with_fixed_holdout_repeatability_v1",
          sampleResidualPx: [],
        },
      },
    },
    {
      role: "physical_light_directions",
      fileName: "physical-light-directions-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-physical-light-directions-authority-v1",
        rigId: context.rigId,
        channels: Array.from({ length: 8 }, (_, index) => ({ channelIndex: index + 1, directionMeasurementSamples: [] })),
      },
    },
    {
      role: "component_identities",
      fileName: "component-identities-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-component-identities-authority-v1",
        rigId: context.rigId,
        controllerIdentity: context.controller.identity,
        componentConfigurationId: context.componentConfigurationId,
        channelWiring: structuredClone(context.controller.channelWiring),
        algorithmHashes: structuredClone(context.algorithmHashes),
      },
    },
    {
      role: "repeatability",
      fileName: "repeatability-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-repeatability-authority-v1",
        rigId: context.rigId,
        repeatedPlacementSamples: [],
        measurementRepeatabilitySamples: [],
      },
    },
  ].map((member) => ({ ...member, bytes: canonicalBytes(member.value) }));
  const ledger = members.map(({ role, fileName, bytes }) => ({ role, fileName, sha256: digest(bytes) }));
  return {
    bundleBytes: canonicalBytes({
      schemaVersion: "ten-kings-mathematical-rig-characterization-source-v1.2",
      characterizedAt: "2026-07-21T12:00:00.000Z",
      rigId: context.rigId,
      sourceCaptureManifestSha256: exactHash("one-time-source-capture"),
      members: ledger,
    }),
    members: members.map(({ fileName, bytes }) => ({ fileName, bytes })),
  };
}

function operationIds(prefix = "operation") {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function metadata(context = runtimeContext()) {
  return {
    capturedAt: "2026-07-21T12:00:01.000Z",
    camera: structuredClone(context.camera),
    controller: {
      controllerIdentity: context.controller.identity,
      expectedWriteCount: 5,
      acknowledgedWriteCount: 5,
      responseKinds: ["ack", "ack", "ack", "ack", "ack"],
      complete: true,
    },
    safeOffBeforeConfirmed: true,
    safeOffAfterConfirmed: true,
  };
}

function frame(label, context = runtimeContext()) {
  return {
    bytes: Buffer.from(`immutable-${label}`),
    mediaType: "image/tiff",
    metadata: metadata(context),
  };
}

function poseFor(frameValue, centerX, centerY, rotation, coverage = 0.30) {
  const context = runtimeContext();
  const side = Math.sqrt(coverage);
  const left = centerX - side / 2;
  const right = centerX + side / 2;
  const top = centerY - side / 2;
  const bottom = centerY + side / 2;
  return {
    sourceFrameSha256: digest(frameValue.bytes),
    centerXFraction: centerX,
    centerYFraction: centerY,
    coverageFraction: coverage,
    rotationDegrees: rotation,
    safetyMarginFraction: Math.min(left, 1 - right, top, 1 - bottom),
    authorityReprojectionResidualPx: 0.1,
    outerCorners: [
      { x: left * context.camera.widthPx, y: top * context.camera.heightPx },
      { x: right * context.camera.widthPx, y: top * context.camera.heightPx },
      { x: right * context.camera.widthPx, y: bottom * context.camera.heightPx },
      { x: left * context.camera.widthPx, y: bottom * context.camera.heightPx },
    ],
  };
}

async function openCore(root, options = {}) {
  const context = options.context ?? runtimeContext();
  return FixedRigFastMathematicalCalibrationCoreV1_2.open({
    outputRoot: root,
    now: () => new Date("2026-07-21T12:00:00.000Z"),
    operationId: options.operationId ?? operationIds(options.prefix),
  }, {
    sessionId: options.sessionId ?? "fast-calibration-session-1",
    operatorId: "mark-supervised",
    runtimeContext: context,
    ...(!options.resume ? { rigCharacterizationSource: rigSource(context) } : {}),
    resume: options.resume,
  });
}

async function acceptPose(core, label, x, y, rotation, options = {}) {
  const value = frame(label);
  return core.captureCheckerboard({
    frame: value,
    pose: poseFor(value, x, y, rotation, options.coverage),
    ...(options.replaceSlot ? { replaceSlot: options.replaceSlot } : {}),
  });
}

test("V1.2 capture contract is exactly four placements plus 72 automated frames", () => {
  assert.deepEqual(FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS, {
    checkerboardPlacements: 4,
    darkControlFrames: 24,
    flatFieldFrames: 24,
    illuminationPatternFrames: 24,
    totalImageCaptures: 76,
    quickPhysicalMeasurements: 0,
  });
});

test("failed pose retry preserves accepted poses and restart resumes the pending slot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-calibration-pose-retry-"));
  try {
    const core = await openCore(root, { operationId: operationIds("first-process") });
    await acceptPose(core, "pose-1", 0.35, 0.35, 0);
    const bad = frame("pose-2-bad");
    await assert.rejects(
      core.captureCheckerboard({ frame: bad, pose: poseFor(bad, 0.45, 0.45, 3, 0.1) }),
      (error) => error.operationId === "first-process-2" && /coverage/.test(error.message),
    );
    assert.deepEqual(core.status().acceptedPlacementSlots, [1]);
    assert.equal(core.status().failedOperationCount, 1);
    assert.equal(core.status().nextAction.slot, 2);

    const resumed = await openCore(root, {
      resume: true,
      operationId: operationIds("second-process"),
    });
    assert.deepEqual(resumed.status().acceptedPlacementSlots, [1]);
    assert.equal(resumed.status().nextAction.slot, 2);
    await acceptPose(resumed, "pose-2-retry", 0.42, 0.44, 3);
    assert.deepEqual(resumed.status().acceptedPlacementSlots, [1, 2]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("pose four fails closed on aggregate diversity and explicit supersession preserves lineage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-calibration-supersession-"));
  try {
    const core = await openCore(root);
    await acceptPose(core, "pose-1", 0.40, 0.40, 0);
    await acceptPose(core, "pose-2", 0.43, 0.43, 3);
    await acceptPose(core, "pose-3", 0.46, 0.46, 6);
    await assert.rejects(
      acceptPose(core, "pose-4-low-diversity", 0.47, 0.47, 9),
      /aggregate diversity/,
    );
    assert.deepEqual(core.status().acceptedPlacementSlots, [1, 2, 3]);
    await acceptPose(core, "pose-1-replacement", 0.32, 0.32, -3, { replaceSlot: 1 });
    assert.equal(core.status().supersededOperationCount, 1);
    await acceptPose(core, "pose-4-pass", 0.52, 0.54, 10);
    assert.equal(core.status().phase, "blank_reverse_flip");
    assert.ok(core.status().aggregatePoseSpans.x >= 0.07);
    assert.ok(core.status().aggregatePoseSpans.y >= 0.08);
    const ledger = core.getSourceArtifactLedger();
    assert.equal(ledger.filter((entry) => entry.role === "checkerboard_placement").length, 5);
    assert.ok(ledger.some((entry) => entry.supersedesOperationId));
    assert.equal(ledger.filter((entry) => entry.role === "checkerboard_placement" && entry.active).length, 4);
    assert.equal(ledger.filter((entry) => entry.role === "checkerboard_placement" && !entry.active).length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function prepareForBatch(core) {
  await acceptPose(core, "pose-a", 0.30, 0.30, -4);
  await acceptPose(core, "pose-b", 0.40, 0.43, 1);
  await acceptPose(core, "pose-c", 0.48, 0.50, 5);
  await acceptPose(core, "pose-d", 0.56, 0.60, 9);
  await core.confirmBlankReverseFlip(true);
}

function batchController(context, options = {}) {
  const calls = { open: 0, close: 0, safeOff: 0, captures: [] };
  let captureIndex = 0;
  return {
    calls,
    async open() {
      calls.open += 1;
      return structuredClone(options.openContext ?? context);
    },
    async capture(request) {
      calls.captures.push(structuredClone(request));
      captureIndex += 1;
      if (options.failAt === captureIndex) throw new Error("simulated persistent batch failure");
      const label = options.duplicateAt === captureIndex ? "batch-frame-0-1" : `batch-frame-${options.offset ?? 0}-${captureIndex}`;
      return frame(label, context);
    },
    async safeOff() {
      calls.safeOff += 1;
      if (options.failSafeOff) throw new Error("simulated final safe-off failure");
      return {
        controllerIdentity: context.controller.identity,
        confirmed: true,
        responseKinds: ["ack"],
      };
    },
    async close() {
      calls.close += 1;
    },
  };
}

test("persistent camera/controller batch opens once, checkpoints frames, and resumes at first missing frame", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-calibration-batch-resume-"));
  try {
    const context = runtimeContext();
    const core = await openCore(root, { context });
    await prepareForBatch(core);
    const first = batchController(context, { failAt: 3 });
    await assert.rejects(core.runPhotometricBatch(first), /simulated persistent batch failure/);
    assert.deepEqual({ open: first.calls.open, safeOff: first.calls.safeOff, close: first.calls.close }, { open: 1, safeOff: 1, close: 1 });
    assert.equal(core.status().captureCounts.acceptedPhotometricFrames, 2);
    assert.equal(core.status().nextAction.role, "dark_control");
    assert.equal(core.status().nextAction.channelIndex, 1);
    assert.equal(core.status().nextAction.sampleIndex, 3);

    const resumed = await openCore(root, { context, resume: true, operationId: operationIds("resumed") });
    const second = batchController(context, { offset: 100 });
    await resumed.runPhotometricBatch(second);
    assert.equal(second.calls.open, 1, "camera/controller must remain open for the complete resumed batch");
    assert.equal(second.calls.close, 1);
    assert.equal(second.calls.captures.length, 70);
    assert.deepEqual(second.calls.captures[0], {
      operationId: "resumed-1",
      role: "dark_control",
      channelIndex: 1,
      sampleIndex: 3,
      dutyPercent: 0,
    });
    assert.equal(resumed.status().phase, "analyze");
    assert.equal(resumed.status().captureCounts.totalAcceptedImages, 76);
    await assert.rejects(
      resumed.recordAnalysis({ analysisBytes: Buffer.from("{}"), accepted: true, sourceArtifactLedgerSha256: "a".repeat(64) }),
      /Caller-authored analysis bytes/,
    );
    await assert.rejects(
      resumed.recordFinalizedBundle({ bundleBytes: Buffer.from("{}"), memberCount: 12, memberLedgerSha256: "b".repeat(64) }),
      /Caller-authored final bundle bytes/,
    );
    assert.throws(() => resumed.assertReadyForStartNewCard(context), /Agent 4 activation receipt/);
    assert.equal(resumed.status().phase, "analyze");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("final safe-off failure is immutable, blocks analysis, and resumes only batch cleanup", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-calibration-safe-off-"));
  try {
    const context = runtimeContext();
    const core = await openCore(root, { context });
    await prepareForBatch(core);
    const failedCleanup = batchController(context, { failSafeOff: true });
    await assert.rejects(core.runPhotometricBatch(failedCleanup), /simulated final safe-off failure/);
    assert.equal(core.status().captureCounts.acceptedPhotometricFrames, 72);
    assert.equal(core.status().phase, "photometric_sweep");
    assert.equal(core.status().nextAction.action, "complete_batch_cleanup");
    assert.equal(core.status().failedOperationCount, 1);

    const resumedCleanup = batchController(context, { offset: 500 });
    await core.runPhotometricBatch(resumedCleanup);
    assert.equal(resumedCleanup.calls.captures.length, 0);
    assert.deepEqual(
      { open: resumedCleanup.calls.open, safeOff: resumedCleanup.calls.safeOff, close: resumedCleanup.calls.close },
      { open: 1, safeOff: 1, close: 1 },
    );
    assert.equal(core.status().phase, "analyze");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("duplicate photometric evidence fails without losing prior accepted batch frames", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-calibration-duplicate-"));
  try {
    const context = runtimeContext();
    const core = await openCore(root, { context });
    await prepareForBatch(core);
    const controller = batchController(context, { duplicateAt: 2 });
    await assert.rejects(core.runPhotometricBatch(controller), /duplicate or relabel/);
    assert.equal(core.status().captureCounts.acceptedPhotometricFrames, 1);
    assert.equal(core.status().nextAction.sampleIndex, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resume and Start New Card readiness reject any exact runtime-context mismatch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-calibration-context-"));
  try {
    const context = runtimeContext();
    await openCore(root, { context });
    const changed = structuredClone(context);
    changed.locationLabel = "different-site";
    await assert.rejects(
      openCore(root, { context: changed, resume: true }),
      /rig characterization|resume identity|runtime context/i,
    );
    assert.notEqual(hashFastCalibrationCanonicalV1_2(context), hashFastCalibrationCanonicalV1_2(changed));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime context and pose validators reject missing authority keys, unsafe duty, and zero corners", async () => {
  const missingAlgorithm = runtimeContext();
  delete missingAlgorithm.algorithmHashes.geometry;
  assert.throws(
    () => validateFastCalibrationRuntimeContextV1_2(missingAlgorithm),
    /fields do not match the exact V1.2 contract/,
  );
  const unsafeDuty = runtimeContext();
  unsafeDuty.dutyPercent = 101;
  assert.throws(() => validateFastCalibrationRuntimeContextV1_2(unsafeDuty), /dutyPercent/);
  const context = runtimeContext();
  assert.doesNotThrow(() => verifyFastCalibrationRigCharacterizationSourceV1_2(rigSource(context), context));

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-calibration-zero-corners-"));
  try {
    const core = await openCore(root, { context });
    const value = frame("zero-corner-pose", context);
    const pose = poseFor(value, 0.4, 0.4, 0, 0.30);
    pose.outerCorners = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    await assert.rejects(
      core.captureCheckerboard({ frame: value, pose }),
      /positive and strictly inside|four distinct|coverage is not consistent/,
    );
    assert.deepEqual(core.status().acceptedPlacementSlots, []);
    assert.equal(core.status().failedOperationCount, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("corrupt append-only event or accepted evidence is rejected on restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-calibration-corrupt-"));
  try {
    const core = await openCore(root);
    await acceptPose(core, "pose-corrupt", 0.35, 0.35, 0);
    const sessionDir = path.join(root, "fast-calibration-session-1");
    const eventPath = path.join(sessionDir, "events", "00000001.json");
    const event = JSON.parse(await fs.readFile(eventPath, "utf8"));
    event.slot = 2;
    await fs.writeFile(eventPath, JSON.stringify(event));
    await assert.rejects(openCore(root, { resume: true }), /event chain.*corrupt/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resume rejects any identity mutation that enables fallback authority", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-calibration-identity-"));
  try {
    await openCore(root);
    const identityPath = path.join(root, "fast-calibration-session-1", "session-identity.json");
    const identity = JSON.parse(await fs.readFile(identityPath, "utf8"));
    identity.v0FallbackAllowed = true;
    await fs.writeFile(identityPath, canonicalBytes(identity));
    await assert.rejects(
      openCore(root, { resume: true }),
      /no-fallback authority/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
