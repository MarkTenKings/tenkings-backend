const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS,
  MATHEMATICAL_CALIBRATION_V1_2_LIST_DTO_SCHEMA,
  MATHEMATICAL_CALIBRATION_V1_2_REPLACEMENT_ACKNOWLEDGEMENT,
  MATHEMATICAL_CALIBRATION_V1_2_STATUS_DTO_SCHEMA,
  parseMathematicalCalibrationV1_2SessionMutationRequestDto,
  parseReplaceMathematicalCalibrationV1_2PoseRequestDto,
  parseStartMathematicalCalibrationV1_2SessionRequestDto,
  validateMathematicalCalibrationV1_2SessionListResponseDto,
  validateMathematicalCalibrationV1_2SessionStatusDto,
} = require("../dist/drivers/mathematicalCalibrationV1_2Contract");
const {
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA,
} = require("../dist/drivers/fixedRigFastMathematicalCalibrationV1_2");

const SHA = "a".repeat(64);
const REVISION = "b".repeat(64);

function incompleteStatus() {
  return {
    schemaVersion: MATHEMATICAL_CALIBRATION_V1_2_STATUS_DTO_SCHEMA,
    sessionSchemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA,
    contractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
    sessionId: "session-1",
    revision: REVISION,
    phase: "checkerboard_placements",
    expectedAction: {
      action: "capture_checkerboard",
      role: "checkerboard_placement",
      slot: 1,
      channelIndex: null,
      sampleIndex: 1,
    },
    acceptedPoses: [],
    failedAttempts: [],
    aggregateSpans: { x: 0, y: 0, rotationDegrees: 0 },
    blankReverseFlip: { confirmed: false, count: 0 },
    automaticSweep: {
      acceptedFrames: 0,
      requiredFrames: 72,
      darkAccepted: 0,
      darkRequired: 24,
      flatFieldAccepted: 0,
      flatFieldRequired: 24,
      illuminationPatternAccepted: 0,
      illuminationPatternRequired: 24,
      batchCleanupConfirmed: false,
      nextRole: "dark_control",
      nextChannelIndex: 1,
      nextSampleIndex: 1,
    },
    analysis: {
      state: "not_started",
      analysisSha256: null,
      sourceManifestSha256: null,
      sourceArtifactLedgerSha256: null,
      issues: [],
    },
    finalization: {
      state: "not_started",
      bundleSha256: null,
      memberLedgerSha256: null,
      analysisSha256: null,
      sourceArtifactLedgerSha256: null,
      runtimeContextSha256: SHA,
      rigCharacterizationSha256: SHA,
      memberCount: 0,
      issues: [],
    },
    activationEligible: false,
  };
}

test("V1.2 route family is exact and contains no activation mutation", () => {
  assert.deepEqual(MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS, {
    sessions: "/calibration/mathematical-v1.2/sessions",
    start: "/calibration/mathematical-v1.2/start",
    status: "/calibration/mathematical-v1.2/status",
    capture: "/calibration/mathematical-v1.2/capture",
    retry: "/calibration/mathematical-v1.2/retry",
    replacePose: "/calibration/mathematical-v1.2/replace-pose",
    analyze: "/calibration/mathematical-v1.2/analyze",
    finalize: "/calibration/mathematical-v1.2/finalize",
  });
  assert.equal(Object.values(MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS).some((path) => path.includes("activate")), false);
  assert.equal(Object.values(MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS).some((path) => /legacy|v0/i.test(path)), false);
});

test("start and mutation requests expose only server revision/session selection", () => {
  assert.deepEqual(parseStartMathematicalCalibrationV1_2SessionRequestDto({}), {});
  assert.deepEqual(parseStartMathematicalCalibrationV1_2SessionRequestDto({
    resumeSessionId: "session-1",
    expectedRevision: REVISION,
  }), {
    resumeSessionId: "session-1",
    expectedRevision: REVISION,
  });
  for (const invalid of [
    null,
    { operationId: "browser-op" },
    { resumeSessionId: "session-1" },
    { resumeSessionId: "session-1", expectedRevision: REVISION, runtimeContext: {} },
  ]) assert.throws(() => parseStartMathematicalCalibrationV1_2SessionRequestDto(invalid), /exact object|exact V1.2 bridge contract/);

  const exact = { sessionId: "session-1", expectedRevision: REVISION };
  assert.deepEqual(parseMathematicalCalibrationV1_2SessionMutationRequestDto(exact), exact);
  for (const forbidden of [
    "operationId", "role", "slot", "channelIndex", "sampleIndex", "runtimeContext",
    "rigCharacterization", "accepted", "analysisBytes", "bundleBytes", "trustedHash", "gradingContract",
  ]) {
    assert.throws(
      () => parseMathematicalCalibrationV1_2SessionMutationRequestDto({ ...exact, [forbidden]: "browser-value" }),
      /exact V1.2 bridge contract/,
    );
  }
});

test("pose replacement requires one accepted slot and exact history acknowledgement", () => {
  const exact = {
    sessionId: "session-1",
    expectedRevision: REVISION,
    acceptedSlot: 2,
    acknowledgement: MATHEMATICAL_CALIBRATION_V1_2_REPLACEMENT_ACKNOWLEDGEMENT,
  };
  assert.deepEqual(parseReplaceMathematicalCalibrationV1_2PoseRequestDto(exact), exact);
  assert.throws(
    () => parseReplaceMathematicalCalibrationV1_2PoseRequestDto({ ...exact, acknowledgement: "replace" }),
    /history-preservation acknowledgement/,
  );
  assert.throws(
    () => parseReplaceMathematicalCalibrationV1_2PoseRequestDto({ ...exact, acceptedSlot: 5 }),
    /acceptedSlot/,
  );
});

test("rich status derives activation eligibility from exact completed local finalization", () => {
  const incomplete = incompleteStatus();
  assert.equal(validateMathematicalCalibrationV1_2SessionStatusDto(incomplete), incomplete);
  const ready = structuredClone(incomplete);
  ready.phase = "ready_for_explicit_activation";
  ready.expectedAction = {
    action: "activate_explicitly", role: "activation", slot: null, channelIndex: null, sampleIndex: null,
  };
  ready.automaticSweep = {
    ...ready.automaticSweep,
    acceptedFrames: 72,
    darkAccepted: 24,
    flatFieldAccepted: 24,
    illuminationPatternAccepted: 24,
    batchCleanupConfirmed: true,
    nextRole: null,
    nextChannelIndex: null,
    nextSampleIndex: null,
  };
  ready.analysis = {
    state: "accepted", analysisSha256: SHA, sourceManifestSha256: SHA,
    sourceArtifactLedgerSha256: SHA, issues: [],
  };
  ready.finalization = {
    state: "completed", bundleSha256: SHA, memberLedgerSha256: SHA, analysisSha256: SHA,
    sourceArtifactLedgerSha256: SHA, runtimeContextSha256: SHA, rigCharacterizationSha256: SHA,
    memberCount: 12, issues: [],
  };
  ready.activationEligible = true;
  assert.equal(validateMathematicalCalibrationV1_2SessionStatusDto(ready), ready);

  const browserDeclaredActive = structuredClone(incomplete);
  browserDeclaredActive.activationEligible = true;
  assert.throws(
    () => validateMathematicalCalibrationV1_2SessionStatusDto(browserDeclaredActive),
    /activationEligible/,
  );
  ready.finalization.bundleSha256 = null;
  assert.throws(
    () => validateMathematicalCalibrationV1_2SessionStatusDto(ready),
    /Completed finalization/,
  );
});

test("session list is read-only projection with exact 76-image contract", () => {
  const response = {
    schemaVersion: MATHEMATICAL_CALIBRATION_V1_2_LIST_DTO_SCHEMA,
    sessions: [{
      sessionId: "session-1",
      revision: REVISION,
      contractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
      phase: "checkerboard_placements",
      expectedAction: "capture_checkerboard",
      acceptedImageCount: 0,
      requiredImageCount: 76,
      activationEligible: false,
    }],
  };
  assert.equal(validateMathematicalCalibrationV1_2SessionListResponseDto(response), response);
  response.sessions[0].requiredImageCount = 75;
  assert.throws(() => validateMathematicalCalibrationV1_2SessionListResponseDto(response), /required count/);
});
