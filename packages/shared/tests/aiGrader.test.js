const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ORCHESTRATOR_NAMED_ERROR_STATES,
  buildInitialAiGraderAlgorithmVersions,
  buildInitialAiGraderThresholdSets,
  buildMacroSuspectRegionId,
  buildModePlan,
  buildRuntimeEnvironmentFingerprint,
  normalizeBackSideCardCoordinates,
  sortAndSelectStandardSurfaceSuspects,
  transitionOrchestratorState,
  validateAlgorithmVersionSeed,
  validateCardToStageTransformInput,
  validateCaptureManifest,
  validateCaptureManifestForMode,
  validateCaptureManifestFrame,
  validateDeviceCapabilityManifest,
  validateMacroPipelineOutput,
  validateMacroSuspectRegion,
  validateReplayTolerance,
  validateRuntimeEnvironmentFingerprint,
  validateThresholdSetVersionSeed,
} = require("../dist/aiGrader");

const SHA_256 = "a".repeat(64);
const ISO_TIME = "2026-05-28T12:00:00.000Z";

function transition(currentState, event, guardResults = {}, errorCode) {
  return transitionOrchestratorState({
    sessionId: "session-1",
    currentState,
    event,
    guardResults,
    errorCode,
    occurredAt: "2026-05-28T12:00:00.000Z",
  });
}

function expectAccepted(currentState, event, nextState, guardResults = {}, errorCode) {
  const result = transition(currentState, event, guardResults, errorCode);
  assert.equal(result.accepted, true);
  assert.equal(result.nextState, nextState);
  assert.match(result.auditEventId, /^pending:session-1:/);
}

function issueCodes(result) {
  return result.issues.map((entry) => entry.code);
}

function validDeviceCapabilityManifest(overrides = {}) {
  return {
    id: "manifest-1",
    rigId: "rig-1",
    helperInstanceId: "helper-1",
    driverName: "basler_camera.py",
    driverVersion: "1.0.0",
    deviceType: "MACRO_CAMERA",
    componentSerial: "BASLER-123",
    supportedCapturePackages: ["MACRO_FRONT"],
    coordinateUnits: { image: "px", stage: "micron" },
    timingCharacteristics: { captureMs: 120 },
    healthChecks: [{ name: "camera-open", required: true, timeoutMs: 1000 }],
    requiredCalibrationTypes: ["COLOR_CHECKER_CCM"],
    checksum: "manifest-checksum",
    observedAt: ISO_TIME,
    ...overrides,
  };
}

function frame(kind, side = "FRONT", overrides = {}) {
  return {
    frameId: `${kind.toLowerCase()}-${side.toLowerCase()}-${Math.random().toString(16).slice(2)}`,
    kind,
    side,
    storageKey: `captures/session-1/${kind}.jpg`,
    checksumSha256: SHA_256,
    capturedAt: ISO_TIME,
    widthPx: 2048,
    heightPx: 2048,
    ...overrides,
  };
}

function macroFrame(side = "FRONT") {
  return frame(side === "FRONT" ? "FRONT_DIFFUSE" : "BACK_DIFFUSE", side);
}

function baseCaptureManifest(overrides = {}) {
  return {
    id: "capture-manifest-1",
    captureSessionId: "session-1",
    tenantId: "tenant-1",
    rigId: "rig-1",
    locationId: "location-1",
    operatorId: "operator-1",
    helperInstanceId: "helper-1",
    helperVersion: "1.0.0",
    driverVersions: { macro: "1.0.0" },
    componentSerials: { macroCamera: "BASLER-123" },
    calibrationSnapshotIds: ["calibration-1"],
    frameList: [macroFrame("FRONT")],
    operatorPrompts: [{ prompt: "Confirm arm out", shownAt: ISO_TIME, confirmedAt: ISO_TIME }],
    deviceHealth: [{ check: "camera-open", status: "PASS" }],
    checksumSha256: SHA_256,
    createdAt: ISO_TIME,
    ...overrides,
  };
}

function standardCaptureManifest() {
  return baseCaptureManifest({
    frameList: [
      macroFrame("FRONT"),
      ...Array.from({ length: 4 }, (_, index) => frame("MICRO_CORNER_SPOT", "FRONT", { frameId: `corner-${index}` })),
      ...Array.from({ length: 4 }, (_, index) => frame("MICRO_EDGE_SPOT", "FRONT", { frameId: `edge-${index}` })),
      frame("MICRO_SURFACE_SPOT", "FRONT", {
        frameId: "surface-0",
        sourceSuspectRegionId: "region-1",
      }),
    ],
  });
}

function authOnlyCaptureManifest() {
  return baseCaptureManifest({
    frameList: [
      macroFrame("FRONT"),
      ...Array.from({ length: 5 }, (_, index) => frame("MICRO_AUTH_PATCH", "FRONT", { frameId: `auth-${index}` })),
    ],
  });
}

function forensicCaptureManifest(overrides = {}) {
  return baseCaptureManifest({
    frameList: [
      macroFrame("FRONT"),
      frame("MICRO_CORNER_TILE", "FRONT", { frameId: "corner-tile" }),
      frame("MICRO_EDGE_TILE", "FRONT", { frameId: "edge-tile" }),
      frame("MICRO_SURFACE_TILE", "FRONT", { frameId: "surface-tile" }),
      ...Array.from({ length: 5 }, (_, index) => frame("MICRO_AUTH_PATCH", "FRONT", { frameId: `forensic-auth-${index}` })),
    ],
    ...overrides,
  });
}

function macroSuspect(overrides = {}) {
  const rank = overrides.rank ?? 1;
  const side = overrides.side ?? "FRONT";
  const thresholdSetId = overrides.thresholdSetId ?? "threshold-1";
  return {
    id: buildMacroSuspectRegionId({
      sessionId: "session-1",
      side,
      rank,
      thresholdSetId,
    }),
    sessionId: "session-1",
    side,
    element: "SURFACE",
    rank,
    score: 0.9,
    threshold: 0.72,
    reasonCodes: ["DARKFIELD_ANOMALY"],
    cardMm: { x: 10, y: 20, w: 3, h: 4 },
    warpedPx: { x: 320, y: 640, w: 96, h: 128 },
    sourcePx: { x: 300, y: 620, w: 100, h: 132 },
    macroCaptureIds: ["macro-frame-1"],
    thresholdSetId,
    ...overrides,
  };
}

function macroOutput(overrides = {}) {
  return {
    sessionId: "session-1",
    side: "FRONT",
    captureManifestId: "capture-manifest-1",
    algorithmVersionId: "algorithm-1",
    thresholdSetVersionId: "threshold-1",
    centeringMeasurement: {
      horizontalPercent: 50,
      verticalPercent: 50,
      leftMm: 2,
      rightMm: 2,
      topMm: 3,
      bottomMm: 3,
    },
    provisionalGrades: {
      centering: 10,
      corners: 9,
      edges: 9,
      surface: 8,
    },
    macroMeasurements: {
      surfaceCompositeScore: 0.9,
    },
    suspectRegions: [macroSuspect()],
    physicalGateResults: [{ gate: "raw-card-holder", status: "PASS" }],
    evidenceArtifacts: [
      {
        storageKey: "captures/session-1/macro-output.json",
        checksumSha256: SHA_256,
      },
    ],
    ...overrides,
  };
}

test("validateMacroPipelineOutput accepts a valid macro output", () => {
  const result = validateMacroPipelineOutput(macroOutput());

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("validateMacroSuspectRegion rejects invalid score, rect, rank, side, and element", () => {
  const result = validateMacroSuspectRegion(
    macroSuspect({
      side: "LEFT",
      element: "CORNERS",
      rank: 0,
      score: 1.2,
      cardMm: { x: 0, y: 0, w: 0, h: 4 },
      warpedPx: { x: 0, y: 0, w: 10, h: -1 },
    })
  );

  assert.equal(result.valid, false);
  assert.ok(issueCodes(result).includes("INVALID_ENUM"));
  assert.ok(issueCodes(result).includes("INVALID_RANK"));
  assert.ok(issueCodes(result).includes("INVALID_SCORE"));
  assert.ok(issueCodes(result).includes("INVALID_RECT"));
});

test("sortAndSelectStandardSurfaceSuspects routes top-N suspects above threshold", () => {
  const selected = sortAndSelectStandardSurfaceSuspects(
    [
      macroSuspect({ rank: 1, score: 0.88 }),
      macroSuspect({ rank: 2, score: 0.93 }),
      macroSuspect({ rank: 3, score: 0.77 }),
      macroSuspect({ rank: 4, score: 0.91 }),
      macroSuspect({ rank: 5, score: 0.5 }),
    ],
    { topN: 3, threshold: 0.72 }
  );

  assert.deepEqual(
    selected.map((entry) => entry.rank),
    [2, 4, 1]
  );
});

test("sortAndSelectStandardSurfaceSuspects supports zero-suspect STANDARD behavior", () => {
  const selected = sortAndSelectStandardSurfaceSuspects([
    macroSuspect({ rank: 1, score: 0.2 }),
    macroSuspect({ rank: 2, score: 0.71 }),
  ]);

  assert.deepEqual(selected, []);
});

test("sortAndSelectStandardSurfaceSuspects uses the default 0.72 threshold", () => {
  const selected = sortAndSelectStandardSurfaceSuspects([
    macroSuspect({ rank: 1, score: 0.71 }),
    macroSuspect({ rank: 2, score: 0.72 }),
  ]);

  assert.deepEqual(
    selected.map((entry) => entry.rank),
    [2]
  );
});

test("validateMacroPipelineOutput rejects centering microscope evidence", () => {
  const result = validateMacroPipelineOutput(
    macroOutput({
      centeringMeasurement: {
        horizontalPercent: 50,
        microEvidenceArtifactIds: ["micro-frame-1"],
      },
    })
  );

  assert.equal(result.valid, false);
  assert.ok(issueCodes(result).includes("CENTERING_USES_MICROSCOPE_EVIDENCE"));
});

test("normalizeBackSideCardCoordinates mirrors back-side rectangles into corrected card coordinates", () => {
  const rect = normalizeBackSideCardCoordinates({
    side: "BACK",
    rect: { x: 10, y: 5, w: 4, h: 6 },
    cardWidthMm: 100,
    cardHeightMm: 140,
  });

  assert.deepEqual(rect, { x: 86, y: 5, w: 4, h: 6 });
});

test("validateCardToStageTransformInput checks transform calibration contract", () => {
  const validResult = validateCardToStageTransformInput({
    side: "BACK",
    cardPointMm: { x: 50, y: 70 },
    transformType: "AFFINE",
    calibrationSnapshotId: "calibration-1",
    validAt: ISO_TIME,
    expiresAt: "2026-05-29T12:00:00.000Z",
    holderFiducialsVisible: true,
    acroHomeEstablished: true,
    fiducialPointCount: 4,
    rmsResidualMicrons: 25,
    backSideOrientationCorrectionStored: true,
    stageTargetMicrons: { x: 10000, y: 12000 },
    safeTravelBoundsMicrons: { minX: 0, maxX: 20000, minY: 0, maxY: 20000 },
  });

  const invalidResult = validateCardToStageTransformInput({
    side: "BACK",
    cardPointMm: { x: 50, y: 70 },
    transformType: "AFFINE",
    calibrationSnapshotId: "calibration-1",
    validAt: ISO_TIME,
    holderFiducialsVisible: false,
    acroHomeEstablished: false,
    fiducialPointCount: 3,
    rmsResidualMicrons: 75,
    stageTargetMicrons: { x: 30000, y: 12000 },
    safeTravelBoundsMicrons: { minX: 0, maxX: 20000, minY: 0, maxY: 20000 },
  });

  assert.equal(validResult.valid, true);
  assert.equal(invalidResult.valid, false);
  assert.ok(issueCodes(invalidResult).includes("INVALID_TRANSFORM"));
});

test("buildInitialAiGraderAlgorithmVersions returns valid provenance seeds", () => {
  const seeds = buildInitialAiGraderAlgorithmVersions();
  const names = seeds.map((seed) => seed.name).sort();

  assert.deepEqual(names, [
    "CMYK_PRINT_PROFILE_V1",
    "MACRO_PIPELINE_V1",
    "STANDARD_SPOT_FUSION_V1",
  ]);
  seeds.forEach((seed) => {
    assert.equal(validateAlgorithmVersionSeed(seed).valid, true);
  });
});

test("validateAlgorithmVersionSeed rejects invalid hashes, versions, and tolerances", () => {
  const seed = {
    ...buildInitialAiGraderAlgorithmVersions()[0],
    semanticVersion: "v1",
    sourceHash: "not-a-sha",
    numericTolerance: { finalGrade: -1 },
  };
  const result = validateAlgorithmVersionSeed(seed);

  assert.equal(result.valid, false);
  assert.ok(issueCodes(result).includes("INVALID_VERSION"));
  assert.ok(issueCodes(result).includes("INVALID_CHECKSUM"));
  assert.ok(issueCodes(result).includes("INVALID_TOLERANCE"));
});

test("buildInitialAiGraderThresholdSets returns valid threshold seeds", () => {
  const seeds = buildInitialAiGraderThresholdSets();

  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].name, "DEFAULT_AI_GRADER_THRESHOLDS_V1");
  assert.equal(validateThresholdSetVersionSeed(seeds[0]).valid, true);
});

test("validateThresholdSetVersionSeed rejects invalid hash, version, and empty thresholds", () => {
  const seed = {
    ...buildInitialAiGraderThresholdSets()[0],
    semanticVersion: "1",
    sourceHash: "bad",
    thresholds: {},
  };
  const result = validateThresholdSetVersionSeed(seed);

  assert.equal(result.valid, false);
  assert.ok(issueCodes(result).includes("INVALID_VERSION"));
  assert.ok(issueCodes(result).includes("INVALID_CHECKSUM"));
  assert.ok(issueCodes(result).includes("EMPTY_ARRAY"));
});

test("buildRuntimeEnvironmentFingerprint creates a valid runtime fingerprint", () => {
  const fingerprint = buildRuntimeEnvironmentFingerprint({
    label: "shared-test",
    containerDigest: `sha256:${"b".repeat(64)}`,
    nodeVersion: "20.11.1",
    dependencyLockHash: SHA_256,
    osInfo: { platform: "darwin" },
  });
  const result = validateRuntimeEnvironmentFingerprint(fingerprint);

  assert.equal(fingerprint.fingerprintKey, `${fingerprint.containerDigest}::${fingerprint.dependencyLockHash}`);
  assert.equal(result.valid, true);
});

test("validateRuntimeEnvironmentFingerprint rejects bad digests and fingerprint keys", () => {
  const fingerprint = buildRuntimeEnvironmentFingerprint({
    label: "shared-test",
    containerDigest: "bad",
    dependencyLockHash: "bad",
  });
  const result = validateRuntimeEnvironmentFingerprint({
    ...fingerprint,
    fingerprintKey: "mismatch",
  });

  assert.equal(result.valid, false);
  assert.ok(issueCodes(result).includes("INVALID_CHECKSUM"));
});

test("validateReplayTolerance reports replay pass and fail against numeric tolerances", () => {
  const passing = validateReplayTolerance({
    sourceGradeRunId: "grade-run-1",
    algorithmVersionId: "algorithm-1",
    thresholdSetVersionId: "threshold-1",
    runtimeEnvironmentId: "runtime-1",
    inputChecksum: SHA_256,
    outputChecksum: "b".repeat(64),
    deltas: {
      finalGrade: 0,
      measurement: 0.0000005,
    },
    numericTolerance: {
      finalGrade: 0,
      measurement: 0.000001,
    },
  });

  const failing = validateReplayTolerance({
    sourceGradeRunId: "grade-run-1",
    algorithmVersionId: "algorithm-1",
    thresholdSetVersionId: "threshold-1",
    runtimeEnvironmentId: "runtime-1",
    inputChecksum: SHA_256,
    outputChecksum: "b".repeat(64),
    deltas: {
      finalGrade: 0.5,
      missingTolerance: 1,
    },
    numericTolerance: {
      finalGrade: 0,
    },
  });

  assert.equal(passing.validInput, true);
  assert.equal(passing.tolerancePassed, true);
  assert.equal(passing.checked, 2);
  assert.equal(failing.validInput, false);
  assert.equal(failing.tolerancePassed, false);
  assert.equal(failing.failures.length, 1);
  assert.ok(issueCodes(failing).includes("MISSING_TOLERANCE"));
});

test("validateDeviceCapabilityManifest accepts a valid manifest", () => {
  const result = validateDeviceCapabilityManifest(validDeviceCapabilityManifest());

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("validateDeviceCapabilityManifest rejects invalid driver and component fields", () => {
  const result = validateDeviceCapabilityManifest(
    validDeviceCapabilityManifest({
      driverName: "",
      componentSerial: "",
      deviceType: "BAD_DEVICE",
    })
  );

  assert.equal(result.valid, false);
  assert.ok(issueCodes(result).includes("REQUIRED"));
  assert.ok(issueCodes(result).includes("INVALID_ENUM"));
});

test("validateCaptureManifest accepts a structurally valid manifest", () => {
  const result = validateCaptureManifest(baseCaptureManifest());

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("validateCaptureManifestFrame rejects bad checksum, storage key, and timestamp", () => {
  const result = validateCaptureManifestFrame(
    frame("FRONT_DIFFUSE", "FRONT", {
      storageKey: "",
      checksumSha256: "not-a-sha",
      capturedAt: "not-a-date",
    })
  );

  assert.equal(result.valid, false);
  assert.ok(issueCodes(result).includes("REQUIRED"));
  assert.ok(issueCodes(result).includes("INVALID_CHECKSUM"));
  assert.ok(issueCodes(result).includes("INVALID_TIMESTAMP"));
});

test("validateCaptureManifestForMode treats QUICK as macro-only", () => {
  const plan = buildModePlan("QUICK");
  const result = validateCaptureManifestForMode(baseCaptureManifest(), "QUICK", { side: "FRONT" });

  assert.equal(plan.microscopePlan.type, "NONE");
  assert.equal(result.valid, true);
});

test("validateCaptureManifestForMode enforces STANDARD macro and micro spot expectations", () => {
  const validResult = validateCaptureManifestForMode(standardCaptureManifest(), "STANDARD", { side: "FRONT" });
  const invalidResult = validateCaptureManifestForMode(baseCaptureManifest(), "STANDARD", { side: "FRONT" });

  assert.equal(validResult.valid, true);
  assert.equal(invalidResult.valid, false);
  assert.ok(issueCodes(invalidResult).includes("MODE_MISSING_MICRO_SPOTS"));
});

test("validateCaptureManifestForMode enforces AUTH_ONLY auth patch expectations", () => {
  const validResult = validateCaptureManifestForMode(authOnlyCaptureManifest(), "AUTH_ONLY", { side: "FRONT" });
  const invalidResult = validateCaptureManifestForMode(baseCaptureManifest(), "AUTH_ONLY", { side: "FRONT" });

  assert.equal(validResult.valid, true);
  assert.equal(invalidResult.valid, false);
  assert.ok(issueCodes(invalidResult).includes("MODE_MISSING_AUTH_PATCHES"));
});

test("validateCaptureManifestForMode enforces FORENSIC raster and auth expectations at contract level", () => {
  const validResult = validateCaptureManifestForMode(forensicCaptureManifest(), "FORENSIC", { side: "FRONT" });
  const invalidResult = validateCaptureManifestForMode(
    forensicCaptureManifest({
      frameList: [
        macroFrame("FRONT"),
        frame("MICRO_CORNER_TILE", "FRONT", { frameId: "corner-tile" }),
        frame("MICRO_EDGE_TILE", "FRONT", { frameId: "edge-tile" }),
        ...Array.from({ length: 5 }, (_, index) => frame("MICRO_AUTH_PATCH", "FRONT", { frameId: `auth-${index}` })),
      ],
    }),
    "FORENSIC",
    { side: "FRONT" }
  );

  assert.equal(validResult.valid, true);
  assert.equal(invalidResult.valid, false);
  assert.ok(issueCodes(invalidResult).includes("MODE_MISSING_FORENSIC_RASTER"));
});

test("transitionOrchestratorState follows the STANDARD happy path", () => {
  expectAccepted("INIT", "SESSION_CREATED", "MACRO_PREFLIGHT", {
    sessionBelongsToTenant: true,
    rigActive: true,
    operatorAuthorized: true,
  });
  expectAccepted("MACRO_PREFLIGHT", "PREFLIGHT_PASS", "MACRO_CAPTURE", {
    armPosition: "ARM_OUT",
    noObstruction: true,
    cardStable: true,
  });
  expectAccepted("MACRO_CAPTURE", "MACRO_UPLOADED", "MACRO_PIPELINE", {
    requiredFramesUploaded: true,
  });
  expectAccepted("MACRO_PIPELINE", "MACRO_PIPELINE_COMPLETE", "ARM_IN_PROMPT", {
    macroOutputValid: true,
    mode: "STANDARD",
  });
  expectAccepted("ARM_IN_PROMPT", "ARM_IN_CONFIRMED", "ARM_IN_CONFIRMED", {
    operatorConfirmed: true,
    interlockPosition: "ARM_IN",
  });
  expectAccepted("ARM_IN_CONFIRMED", "ARM_IN_CONFIRMED", "STAGE_HOME", {
    interlockPosition: "ARM_IN",
  });
  expectAccepted("STAGE_HOME", "STAGE_HOME_COMPLETE", "MICRO_SPOTS", {
    homeSuccess: true,
    positionReadable: true,
  });
  expectAccepted("MICRO_SPOTS", "MICRO_SPOTS_COMPLETE", "ARM_OUT_PROMPT", {
    allRequiredPackagesValid: true,
  });
  expectAccepted("ARM_OUT_PROMPT", "ARM_OUT_CONFIRMED", "ARM_OUT_CONFIRMED", {
    operatorConfirmed: true,
    interlockPosition: "ARM_OUT",
  });
  expectAccepted("ARM_OUT_CONFIRMED", "ARM_OUT_CONFIRMED", "FUSION", {
    obstructionClear: true,
  });
  expectAccepted("FUSION", "FUSION_COMPLETE", "REVIEW", {
    gradeRunWritten: true,
  });
  expectAccepted("REVIEW", "OPERATOR_APPROVED", "COMPLETE", {
    blockingGates: false,
  });
});

test("transitionOrchestratorState routes QUICK macro output directly to fusion", () => {
  expectAccepted("MACRO_PIPELINE", "MACRO_PIPELINE_COMPLETE", "FUSION", {
    macroOutputValid: true,
    mode: "QUICK",
  });
});

test("transitionOrchestratorState supports operator override review completion", () => {
  expectAccepted("REVIEW", "OPERATOR_OVERRIDE_SUBMITTED", "OPERATOR_OVERRIDE_PENDING");
  expectAccepted("OPERATOR_OVERRIDE_PENDING", "OPERATOR_APPROVED", "COMPLETE", {
    overrideReviewedApproved: true,
  });
});

test("transitionOrchestratorState rejects invalid guards without advancing state", () => {
  const result = transition("MACRO_PREFLIGHT", "PREFLIGHT_PASS", {
    armPosition: "ARM_OUT",
    noObstruction: false,
    cardStable: true,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.nextState, "MACRO_PREFLIGHT");
});

test("transitionOrchestratorState rejects missing INIT guards", () => {
  const result = transition("INIT", "SESSION_CREATED");

  assert.equal(result.accepted, false);
  assert.equal(result.nextState, "INIT");
});

test("transitionOrchestratorState covers named v5 error states", () => {
  assert.deepEqual(
    [...ORCHESTRATOR_NAMED_ERROR_STATES].sort(),
    [
      "ABORTED",
      "ARM_POSITION_CONFLICT",
      "MACRO_OBSTRUCTION_DETECTED",
      "MICRO_INCOMPLETE_REQUIRES_REVIEW",
      "PAUSED_OPERATOR_TIMEOUT",
      "PHYSICAL_GATE_REVIEW",
      "SPOT_FAILED_REQUIRES_DECISION",
      "STAGE_HOME_FAILED",
      "UPLOAD_FAILED",
    ].sort()
  );

  expectAccepted(
    "MACRO_PREFLIGHT",
    "ERROR",
    "ARM_POSITION_CONFLICT",
    {},
    "ARM_POSITION_CONFLICT"
  );
  expectAccepted(
    "MACRO_PREFLIGHT",
    "ERROR",
    "MACRO_OBSTRUCTION_DETECTED",
    {},
    "MACRO_OBSTRUCTION_DETECTED"
  );
  expectAccepted(
    "MACRO_PREFLIGHT",
    "ERROR",
    "PHYSICAL_GATE_REVIEW",
    {},
    "PHYSICAL_GATE_REVIEW"
  );
  expectAccepted("MACRO_CAPTURE", "ERROR", "UPLOAD_FAILED", {}, "UPLOAD_FAILED");
  expectAccepted(
    "ARM_IN_PROMPT",
    "ERROR",
    "PAUSED_OPERATOR_TIMEOUT",
    {},
    "PAUSED_OPERATOR_TIMEOUT"
  );
  expectAccepted("STAGE_HOME", "ERROR", "STAGE_HOME_FAILED", {}, "STAGE_HOME_FAILED");
  expectAccepted(
    "MICRO_SPOTS",
    "ERROR",
    "SPOT_FAILED_REQUIRES_DECISION",
    {},
    "SPOT_FAILED_REQUIRES_DECISION"
  );
  expectAccepted(
    "MICRO_SPOTS",
    "ERROR",
    "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    {},
    "MICRO_INCOMPLETE_REQUIRES_REVIEW"
  );
  expectAccepted("REVIEW", "ABORT", "ABORTED");
});
