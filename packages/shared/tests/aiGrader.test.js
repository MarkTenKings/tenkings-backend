const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ORCHESTRATOR_NAMED_ERROR_STATES,
  transitionOrchestratorState,
} = require("../dist/aiGrader");

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
