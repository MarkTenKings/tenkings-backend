import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_GRADER_PREVIEW_MAX_CONSECUTIVE_RECONNECTS,
  AI_GRADER_PREVIEW_SNAPSHOT_LIMIT,
  AI_GRADER_LOCAL_CAPTURE_INTENT_MAX_AGE_MS,
  AI_GRADER_ACTIVE_CAPTURE_RECONCILE_INTERVAL_MS,
  AI_GRADER_ACTIVE_CAPTURE_RECONCILE_MAX_CHECKS,
  AI_GRADER_INTENTIONAL_TRANSITION_MAX_AGE_MS,
  aiGraderAtomicIntentReconcileDecision,
  aiGraderPreviewBackCaptureReady,
  aiGraderPreviewBindingChanged,
  aiGraderPreviewDetectedCaptureReady,
  aiGraderPreviewDisplayedSnapshot,
  aiGraderPreviewManualCaptureReady,
  beginAiGraderPreviewReader,
  createAiGraderPreviewEpochState,
  createAiGraderPreviewReconnectState,
  finishAiGraderPreviewReader,
  isAiGraderBackPositioningRetryReady,
  isAiGraderConfirmedCaptureTransitionFailure,
  isAiGraderConfirmedBackCaptureTransitionFailure,
  isAiGraderIntentionalCaptureEof,
  isAiGraderIntentionalBackCaptureEof,
  isAiGraderPreviewReconnectEligible,
  noteAiGraderPreviewFrameForReconnect,
  projectAiGraderPreviewLossPhysicalStateUnknown,
  projectAiGraderPreviewLossSafeOffPending,
  releaseAiGraderPreviewReconnectTimer,
  reduceAiGraderBackPositioningRetryUiState,
  runAiGraderPreviewLossRecovery,
  shouldStartAiGraderBackPositioningRetry,
  transitionAiGraderPreviewEpoch,
  type AiGraderPreviewEpochBinding,
  type AiGraderPreviewEpochEvent,
  type AiGraderPreviewEpochState,
  type AiGraderPreviewFrameBinding,
} from "../lib/aiGraderPreviewLifecycle";
import {
  DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
  openAiGraderStationPreviewStream,
  retryAiGraderBackPositioningLight,
} from "../lib/aiGraderStationBridgeClient";
import { buildAiGraderLocalStationStatus } from "../lib/aiGraderLocalStation";
import {
  aiGraderCaptureAssertionFromFrame,
  buildAiGraderAtomicCaptureRequest,
  aiGraderBackCaptureAssertionFromFrame,
  buildAiGraderAtomicBackCaptureRequest,
  createAiGraderCaptureAttempt,
  createAiGraderCaptureOperationGate,
  createAiGraderBackCaptureAttempt,
  runAiGraderAtomicCapture,
  runAiGraderAtomicBackCapture,
  runAiGraderBackPositioningRetryRecovery,
  runAiGraderStationBackCaptureOrchestration,
} from "../lib/aiGraderStationOperations";

const baseMs = Date.parse("2026-07-13T12:00:00.000Z");
const frontEpoch: AiGraderPreviewEpochBinding = {
  sessionId: "session-1",
  side: "front",
  sideEpoch: "front-1",
};
const backEpoch: AiGraderPreviewEpochBinding & { side: "back" } = {
  sessionId: "session-1",
  side: "back",
  sideEpoch: "back-2",
};

test("contract preview never projects an unacknowledged physical light state", () => {
  const status = buildAiGraderLocalStationStatus();
  assert.equal(status.liveLighting.status, "unavailable");
  assert.equal(status.liveLighting.applied.enabled, undefined);
  assert.equal(status.liveLighting.applied.verificationState, "unknown");
  assert.equal(status.liveLighting.applied.verificationComplete, false);
  assert.equal(status.liveLighting.physicalState.state, "physical_state_unknown");
  assert.equal(status.liveLighting.physicalState.complete, false);
});

test("same-step preview binding replacement advances exactly one reader generation", () => {
  let currentBinding: AiGraderPreviewEpochBinding | undefined = frontEpoch;
  let restartGeneration = 0;
  let readerStarts = 0;
  const reconcile = (nextBinding: AiGraderPreviewEpochBinding | undefined) => {
    if (!aiGraderPreviewBindingChanged(currentBinding, nextBinding)) return;
    currentBinding = nextBinding;
    restartGeneration += 1;
    const reader = beginAiGraderPreviewReader(createAiGraderPreviewReconnectState(), true);
    if (reader.startReader) readerStarts += 1;
  };

  reconcile(backEpoch);
  reconcile(backEpoch);

  assert.equal(restartGeneration, 1);
  assert.equal(readerStarts, 1);
  assert.deepEqual(currentBinding, backEpoch);
  assert.equal(aiGraderPreviewBindingChanged(undefined, undefined), false);
});

test("preview-loss safe-off failure projects pending then unknown and cannot retain verified light UI", () => {
  const baseline = buildAiGraderLocalStationStatus().liveLighting;
  const verified = {
    ...baseline,
    status: "on" as const,
    profile: { ...baseline.profile, enabled: true },
    applied: {
      ...baseline.applied,
      enabled: true,
      verificationState: "verified" as const,
      expectedWriteCount: 8,
      acknowledgedWriteCount: 8,
      verificationComplete: true,
      verifiedAt: new Date(baseMs - 1).toISOString(),
    },
    physicalState: {
      ...baseline.physicalState,
      state: "positioning_light_verified" as const,
      expectedWriteCount: 8,
      acknowledgedWriteCount: 8,
      complete: true,
      verifiedAt: new Date(baseMs - 1).toISOString(),
    },
    backPositioning: {
      status: "ready" as const,
      captureReady: true,
      sessionId: backEpoch.sessionId,
      side: "back" as const,
      sideEpoch: backEpoch.sideEpoch,
      attemptCount: 1,
      firstFrameGraceMs: 6000,
      events: [],
    },
  };

  const pending = projectAiGraderPreviewLossSafeOffPending(verified, baseMs);
  assert.equal(pending.status, "applying");
  assert.equal(pending.applied.enabled, undefined);
  assert.equal(pending.applied.verificationState, "pending");
  assert.equal(pending.applied.verificationComplete, false);
  assert.equal(pending.applied.verifiedAt, undefined);
  assert.equal(pending.physicalState.state, "safe_off_pending");
  assert.equal(pending.physicalState.complete, false);
  assert.equal(pending.physicalState.verifiedAt, undefined);
  assert.equal(pending.physicalState.expectedWriteCount, 0);
  assert.equal(pending.backPositioning?.status, "ready");
  assert.equal(pending.backPositioning?.captureReady, false);

  const unknown = projectAiGraderPreviewLossPhysicalStateUnknown(pending, baseMs + 1);
  assert.equal(unknown.status, "error");
  assert.equal(unknown.applied.enabled, undefined);
  assert.equal(unknown.applied.verificationState, "unknown");
  assert.equal(unknown.applied.verificationComplete, false);
  assert.equal(unknown.applied.verifiedAt, undefined);
  assert.equal(unknown.physicalState.state, "physical_state_unknown");
  assert.equal(unknown.physicalState.complete, false);
  assert.equal(unknown.physicalState.verifiedAt, undefined);
  assert.equal(unknown.physicalState.expectedWriteCount, 0);
  assert.equal(unknown.backPositioning?.status, "failed");
  assert.equal(unknown.backPositioning?.captureReady, false);
  assert.match(unknown.physicalState.lastError ?? "", /not acknowledged.*unknown/i);
  assert.doesNotMatch(unknown.physicalState.lastError ?? "", /token|secret|bearer|localhost/i);
});

test("completed exact atomic transition remains an intentional EOF only inside its bounded identity window", () => {
  const localIntent = { binding: backEpoch, frameId: "frame-completed", submittedAtMs: baseMs };
  const completedAt = new Date(baseMs).toISOString();
  const exact = {
    active: false,
    kind: "capture_back" as const,
    sessionId: backEpoch.sessionId,
    side: "back" as const,
    sideEpoch: backEpoch.sideEpoch,
    frameId: localIntent.frameId,
    completedAt,
    outcome: "capture_started" as const,
  };
  assert.equal(isAiGraderIntentionalBackCaptureEof({
    expectedBinding: backEpoch,
    localIntent,
    authoritativeBinding: backEpoch,
    bridgeIntent: exact,
    nowMs: baseMs + 1,
  }), true);
  assert.equal(isAiGraderIntentionalBackCaptureEof({
    expectedBinding: backEpoch,
    localIntent,
    authoritativeBinding: backEpoch,
    bridgeIntent: { ...exact, outcome: "transition_failed" },
    nowMs: baseMs + 1,
  }), false);
  assert.equal(isAiGraderConfirmedBackCaptureTransitionFailure({
    expectedBinding: backEpoch,
    localIntent,
    authoritativeBinding: backEpoch,
    bridgeIntent: { ...exact, outcome: "transition_failed" },
    nowMs: baseMs + 1,
  }), true);
  assert.equal(isAiGraderIntentionalBackCaptureEof({
    expectedBinding: backEpoch,
    localIntent,
    authoritativeBinding: backEpoch,
    bridgeIntent: exact,
    nowMs: baseMs + AI_GRADER_INTENTIONAL_TRANSITION_MAX_AGE_MS + 1,
  }), false);
  assert.equal(isAiGraderIntentionalBackCaptureEof({
    expectedBinding: backEpoch,
    localIntent,
    authoritativeBinding: backEpoch,
    bridgeIntent: { ...exact, frameId: "unrelated-frame" },
    nowMs: baseMs + 1,
  }), false);
  assert.equal(isAiGraderIntentionalBackCaptureEof({
    expectedBinding: backEpoch,
    localIntent,
    authoritativeBinding: backEpoch,
    bridgeIntent: { ...exact, completedAt: new Date(baseMs + 1).toISOString() },
    nowMs: baseMs,
  }), false);
  assert.equal(isAiGraderIntentionalBackCaptureEof({
    expectedBinding: backEpoch,
    localIntent,
    authoritativeBinding: backEpoch,
    bridgeIntent: { ...exact, completedAt: "not-a-timestamp" },
    nowMs: baseMs + 1,
  }), false);
  assert.equal(isAiGraderIntentionalBackCaptureEof({
    expectedBinding: backEpoch,
    localIntent,
    authoritativeBinding: backEpoch,
    bridgeIntent: { ...exact, active: true, completedAt: undefined, outcome: undefined },
    nowMs: baseMs + AI_GRADER_LOCAL_CAPTURE_INTENT_MAX_AGE_MS + 1,
  }), true);
});

test("quick completed marker survives first ambiguity check and active authority spans the bounded poll horizon", () => {
  const localIntent = { binding: frontEpoch, frameId: "front-timestamp-bound", submittedAtMs: baseMs };
  const marker = {
    active: false,
    kind: "capture_front" as const,
    sessionId: frontEpoch.sessionId,
    side: "front" as const,
    sideEpoch: frontEpoch.sideEpoch,
    frameId: localIntent.frameId,
    completedAt: new Date(baseMs + 2_000).toISOString(),
    outcome: "capture_started" as const,
  };
  const firstReconcileAt = baseMs + AI_GRADER_LOCAL_CAPTURE_INTENT_MAX_AGE_MS;
  const completedRecognized = isAiGraderIntentionalCaptureEof({
    expectedBinding: frontEpoch,
    localIntent,
    authoritativeBinding: frontEpoch,
    bridgeIntent: marker,
    nowMs: firstReconcileAt,
  });
  assert.equal(completedRecognized, true);
  assert.deepEqual(aiGraderAtomicIntentReconcileDecision({
    exactCaptureAuthority: completedRecognized,
    exactTransitionFailure: false,
    bridgeTransitionActive: false,
    activeChecksRemaining: AI_GRADER_ACTIVE_CAPTURE_RECONCILE_MAX_CHECKS,
  }), { kind: "recover_full_status" });
  const failureRecognized = isAiGraderConfirmedCaptureTransitionFailure({
    expectedBinding: frontEpoch,
    localIntent,
    authoritativeBinding: frontEpoch,
    bridgeIntent: { ...marker, outcome: "transition_failed" },
    nowMs: firstReconcileAt,
  });
  assert.equal(failureRecognized, true);
  assert.deepEqual(aiGraderAtomicIntentReconcileDecision({
    exactCaptureAuthority: false,
    exactTransitionFailure: failureRecognized,
    bridgeTransitionActive: false,
    activeChecksRemaining: AI_GRADER_ACTIVE_CAPTURE_RECONCILE_MAX_CHECKS,
  }), { kind: "recover_full_status" });

  const activePollHorizon = firstReconcileAt +
    AI_GRADER_ACTIVE_CAPTURE_RECONCILE_INTERVAL_MS * AI_GRADER_ACTIVE_CAPTURE_RECONCILE_MAX_CHECKS;
  assert.equal(isAiGraderIntentionalCaptureEof({
    expectedBinding: frontEpoch,
    localIntent,
    authoritativeBinding: frontEpoch,
    bridgeIntent: { ...marker, active: true, completedAt: undefined, outcome: undefined },
    nowMs: activePollHorizon,
  }), true);
  assert.ok(AI_GRADER_INTENTIONAL_TRANSITION_MAX_AGE_MS > activePollHorizon - baseMs);
});

test("exact intentional capture markers are side-generic and reject cross-side identities", () => {
  const localIntent = { binding: frontEpoch, frameId: "preview-front-intent", submittedAtMs: Date.now() };
  const exact = {
    active: true,
    kind: "capture_front" as const,
    sessionId: frontEpoch.sessionId,
    side: "front" as const,
    sideEpoch: frontEpoch.sideEpoch,
    frameId: localIntent.frameId,
  };
  assert.equal(isAiGraderIntentionalCaptureEof({
    expectedBinding: frontEpoch,
    localIntent,
    authoritativeBinding: frontEpoch,
    bridgeIntent: exact,
  }), true);
  assert.equal(isAiGraderIntentionalCaptureEof({
    expectedBinding: frontEpoch,
    localIntent,
    authoritativeBinding: frontEpoch,
    bridgeIntent: { ...exact, kind: "capture_back", side: "back" },
  }), false);
  assert.equal(isAiGraderConfirmedCaptureTransitionFailure({
    expectedBinding: frontEpoch,
    localIntent,
    authoritativeBinding: frontEpoch,
    bridgeIntent: {
      ...exact,
      active: false,
      completedAt: new Date(baseMs).toISOString(),
      outcome: "transition_failed",
    },
    nowMs: baseMs + 1,
  }), true);
});

function frame(binding: AiGraderPreviewEpochBinding, frameId: string): AiGraderPreviewFrameBinding {
  return { ...binding, frameId };
}

function geometry(
  target: AiGraderPreviewFrameBinding,
  timestampMs: number,
  placementState: "not_detected" | "adjust_card" | "ready" = "ready",
) {
  return {
    side: target.side,
    placementState,
    geometrySource: placementState === "ready" ? "detected" as const : "none" as const,
    captureMode: placementState === "ready" ? "automatic_detection" as const : "none" as const,
    confidenceBasis: placementState === "ready" ? "automatic_detection" as const : "none" as const,
    detectionUsed: placementState === "ready",
    manualOverrideUsed: false,
    corners: null,
    detectedCorners: null,
    boundingBox: null,
    rotationDegrees: 0,
    skewDegrees: 0,
    confidence: placementState === "ready" ? 0.99 : 0,
    sessionId: target.sessionId,
    sideEpoch: target.sideEpoch,
    sourceFrameId: target.frameId,
    timestamp: new Date(timestampMs).toISOString(),
    image: { width: 2048, height: 2448, coordinateFrame: "source_image_pixels" as const },
  };
}

function reduce(
  state: AiGraderPreviewEpochState,
  event: AiGraderPreviewEpochEvent,
) {
  return transitionAiGraderPreviewEpoch(state, event);
}

function addLoadedFrame(
  state: AiGraderPreviewEpochState,
  target: AiGraderPreviewFrameBinding,
  atMs: number,
  objectUrl = "blob:" + target.frameId,
  capturedAtMs = atMs,
) {
  const added = reduce(state, {
    type: "frame",
    frame: target,
    objectUrl,
    receivedAtMs: atMs,
    capturedAt: new Date(capturedAtMs).toISOString(),
  });
  const loaded = reduce(added.state, {
    type: "image_loaded",
    frame: target,
    loadedAtMs: atMs,
    width: 2048,
    height: 2448,
  });
  return {
    state: loaded.state,
    revoked: [...added.revokeObjectUrls, ...loaded.revokeObjectUrls],
  };
}

test("front-to-back binding clears snapshots and late wrong-side URLs are returned for revocation", () => {
  const frontFrame = frame(frontEpoch, "preview-front-12");
  let state = addLoadedFrame(createAiGraderPreviewEpochState(frontEpoch), frontFrame, baseMs).state;
  state = reduce(state, {
    type: "geometry",
    binding: frontEpoch,
    geometry: geometry(frontFrame, baseMs),
    observedAtMs: baseMs + 200,
  }).state;
  assert.equal(aiGraderPreviewManualCaptureReady(state, baseMs + 200), true);
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, baseMs + 200), true);

  const rebound = reduce(state, { type: "bind", binding: backEpoch });
  state = rebound.state;
  assert.deepEqual(rebound.revokeObjectUrls, ["blob:preview-front-12"]);
  assert.equal(state.phase, "starting");
  assert.equal(state.snapshots.length, 0);
  assert.equal(aiGraderPreviewManualCaptureReady(state, baseMs + 200), false);

  const rejected = reduce(state, {
    type: "frame",
    frame: frontFrame,
    objectUrl: "blob:late-front",
    receivedAtMs: baseMs + 238,
  });
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.revokeObjectUrls, ["blob:late-front"]);
  assert.equal(rejected.state, state);
});

test("238ms frames plus delayed 200ms geometry polls reach and retain an exact coherent Ready pair", () => {
  const first = frame(backEpoch, "preview-back-1");
  const second = frame(backEpoch, "preview-back-2");
  const third = frame(backEpoch, "preview-back-3");
  const fourth = frame(backEpoch, "preview-back-4");
  let state = addLoadedFrame(createAiGraderPreviewEpochState(backEpoch), first, baseMs).state;
  state = addLoadedFrame(state, second, baseMs + 238).state;
  state = reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: geometry(first, baseMs),
    observedAtMs: baseMs + 400,
  }).state;
  assert.equal(aiGraderPreviewDisplayedSnapshot(state)?.frame.frameId, first.frameId);
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, baseMs + 400), true);

  state = addLoadedFrame(state, third, baseMs + 476).state;
  assert.equal(aiGraderPreviewDisplayedSnapshot(state)?.frame.frameId, first.frameId);
  state = reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: geometry(second, baseMs + 238),
    observedAtMs: baseMs + 600,
  }).state;
  assert.equal(aiGraderPreviewDisplayedSnapshot(state)?.frame.frameId, second.frameId);
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, baseMs + 600), true);

  state = addLoadedFrame(state, fourth, baseMs + 714).state;
  assert.equal(aiGraderPreviewDisplayedSnapshot(state)?.frame.frameId, second.frameId);
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, baseMs + 714), true);
});

test("snapshot buffer is bounded to eight URLs and every eviction or expiry is returned", () => {
  let state = createAiGraderPreviewEpochState(backEpoch);
  const revoked: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    const next = addLoadedFrame(
      state,
      frame(backEpoch, "frame-" + index),
      baseMs + index * 100,
      "blob:url-" + index,
    );
    state = next.state;
    revoked.push(...next.revoked);
    assert.ok(state.snapshots.length <= AI_GRADER_PREVIEW_SNAPSHOT_LIMIT);
  }
  assert.deepEqual(revoked, ["blob:url-0", "blob:url-1", "blob:url-2", "blob:url-3"]);
  const expired = reduce(state, { type: "tick", nowMs: baseMs + 4000 });
  assert.equal(expired.state.snapshots.length, 0);
  assert.deepEqual(
    expired.revokeObjectUrls,
    ["blob:url-4", "blob:url-5", "blob:url-6", "blob:url-7", "blob:url-8", "blob:url-9", "blob:url-10", "blob:url-11"],
  );
});

test("frame admission rejects and revokes missing, future, and ancient capture timestamps", () => {
  const initial = createAiGraderPreviewEpochState(backEpoch);
  const target = frame(backEpoch, "preview-back-invalid-time");
  const cases = [
    { objectUrl: "blob:missing-captured-at", capturedAt: undefined },
    { objectUrl: "blob:future-captured-at", capturedAt: new Date(baseMs + 1).toISOString() },
    { objectUrl: "blob:ancient-after-old-ack", capturedAt: new Date(baseMs - 2001).toISOString() },
  ];
  for (const candidate of cases) {
    const rejected = reduce(initial, {
      type: "frame",
      frame: target,
      objectUrl: candidate.objectUrl,
      receivedAtMs: baseMs,
      capturedAt: candidate.capturedAt,
    });
    assert.equal(rejected.accepted, false, candidate.objectUrl);
    assert.equal(rejected.state, initial, candidate.objectUrl);
    assert.deepEqual(rejected.revokeObjectUrls, [candidate.objectUrl]);
  }
  assert.ok(baseMs - 2001 >= baseMs - 10_000, "The ancient frame is newer than an old ACK but still too old to admit.");
});

test("snapshot pruning uses capture age even while receive age remains fresh", () => {
  const target = frame(backEpoch, "preview-back-capture-aged-first");
  const loaded = addLoadedFrame(
    createAiGraderPreviewEpochState(backEpoch),
    target,
    baseMs + 1500,
    "blob:capture-aged-first",
    baseMs,
  );
  assert.equal(loaded.state.snapshots.length, 1);
  const pruned = reduce(loaded.state, { type: "tick", nowMs: baseMs + 2001 });
  assert.equal(pruned.state.snapshots.length, 0);
  assert.deepEqual(pruned.revokeObjectUrls, ["blob:capture-aged-first"]);
});

test("geometry admission rejects missing, future, expired, non-finite, and wrong binding observations", () => {
  const target = frame(backEpoch, "preview-back-geometry");
  let state = addLoadedFrame(createAiGraderPreviewEpochState(backEpoch), target, baseMs).state;
  const valid = geometry(target, baseMs);
  const invalidEvents = [
    { ...valid, timestamp: undefined },
    { ...valid, timestamp: new Date(baseMs + 1).toISOString() },
    { ...valid, timestamp: new Date(baseMs - 2001).toISOString() },
    { ...valid, sideEpoch: "wrong-epoch" },
    { ...valid, sourceFrameId: "future-frame" },
  ];
  for (const candidate of invalidEvents) {
    const outcome = reduce(state, {
      type: "geometry",
      binding: backEpoch,
      geometry: candidate,
      observedAtMs: baseMs,
    });
    assert.equal(outcome.accepted, false);
    assert.equal(aiGraderPreviewManualCaptureReady(outcome.state, baseMs), false);
  }
  assert.equal(reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: valid,
    observedAtMs: Number.NaN,
  }).accepted, false);
  assert.equal(reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: valid,
    observedAtMs: Number.POSITIVE_INFINITY,
  }).accepted, false);

  state = reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: valid,
    observedAtMs: baseMs + 2000,
  }).state;
  assert.equal(aiGraderPreviewManualCaptureReady(state, baseMs + 2000), true);
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, baseMs + 2000), true);
  const expired = reduce(state, { type: "tick", nowMs: baseMs + 2001 });
  assert.equal(aiGraderPreviewManualCaptureReady(expired.state, baseMs + 2001), false);
  assert.deepEqual(expired.revokeObjectUrls, ["blob:preview-back-geometry"]);
});

test("manual readiness still requires exact observed geometry but does not require Ready placement", () => {
  const target = frame(backEpoch, "preview-back-manual");
  let state = addLoadedFrame(createAiGraderPreviewEpochState(backEpoch), target, baseMs).state;
  assert.equal(aiGraderPreviewManualCaptureReady(state, baseMs), false);
  state = reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: geometry(target, baseMs, "adjust_card"),
    observedAtMs: baseMs + 100,
  }).state;
  assert.equal(aiGraderPreviewManualCaptureReady(state, baseMs + 100), true);
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, baseMs + 100), false);
});

test("retry acknowledgement discards pre-ACK snapshots and requires a subsequent exact pair", () => {
  const beforeAck = frame(backEpoch, "preview-back-before-ack");
  let state = addLoadedFrame(createAiGraderPreviewEpochState(backEpoch), beforeAck, baseMs).state;
  state = reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: geometry(beforeAck, baseMs),
    observedAtMs: baseMs + 100,
  }).state;
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, baseMs + 100), true);

  const acknowledged = reduce(state, { type: "clear", status: "starting" });
  assert.deepEqual(acknowledged.revokeObjectUrls, ["blob:preview-back-before-ack"]);
  assert.equal(aiGraderPreviewDisplayedSnapshot(acknowledged.state), undefined);
  assert.equal(aiGraderPreviewDetectedCaptureReady(acknowledged.state, baseMs + 101), false);

  const afterAck = frame(backEpoch, "preview-back-after-ack");
  state = addLoadedFrame(acknowledged.state, afterAck, baseMs + 200).state;
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, baseMs + 200), false);
  state = reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: geometry(afterAck, baseMs + 200),
    observedAtMs: baseMs + 300,
  }).state;
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, baseMs + 300), true);
});

test("back readiness uses finite camera capture time and rejects a delayed pre-ACK image", () => {
  const verifiedAtMs = baseMs + 250;
  const verifiedAt = new Date(verifiedAtMs).toISOString();
  const delayed = frame(backEpoch, "preview-back-delayed-pre-ack");
  let state = addLoadedFrame(
    createAiGraderPreviewEpochState(backEpoch),
    delayed,
    baseMs + 500,
    "blob:delayed-pre-ack",
    baseMs,
  ).state;
  state = reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: geometry(delayed, baseMs),
    observedAtMs: baseMs + 600,
  }).state;
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, baseMs + 600), true);
  assert.equal(aiGraderPreviewBackCaptureReady({
    state,
    mode: "detected_geometry",
    positioningVerifiedAt: verifiedAt,
    nowMs: baseMs + 600,
  }), false);
  assert.equal(aiGraderPreviewBackCaptureReady({
    state,
    mode: "manual_capture",
    positioningVerifiedAt: verifiedAt,
    nowMs: baseMs + 600,
  }), false);
  assert.equal(aiGraderPreviewBackCaptureReady({
    state,
    mode: "detected_geometry",
    positioningVerifiedAt: "not-a-time",
    nowMs: baseMs + 600,
  }), false);

  const atAck = frame(backEpoch, "preview-back-at-ack");
  state = addLoadedFrame(
    createAiGraderPreviewEpochState(backEpoch),
    atAck,
    baseMs + 700,
    "blob:at-ack",
    verifiedAtMs,
  ).state;
  state = reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: geometry(atAck, verifiedAtMs),
    observedAtMs: baseMs + 800,
  }).state;
  assert.equal(aiGraderPreviewBackCaptureReady({
    state,
    mode: "detected_geometry",
    positioningVerifiedAt: verifiedAt,
    nowMs: baseMs + 800,
  }), true);
  assert.equal(aiGraderPreviewBackCaptureReady({
    state,
    mode: "manual_capture",
    positioningVerifiedAt: verifiedAt,
    nowMs: baseMs + 800,
  }), true);
});

test("retry UI reducer proves pending to success, waiting, and failure states used by Station", () => {
  const idle = { status: "idle" as const };
  const pending = reduceAiGraderBackPositioningRetryUiState(idle, { type: "retry_started" });
  assert.deepEqual(pending, {
    status: "retrying",
    message: "Restoring the accepted positioning profile.",
  });
  assert.equal(reduceAiGraderBackPositioningRetryUiState(pending, {
    type: "restore_completed",
    bridgeCaptureReady: true,
    physicallyVerified: true,
    postVerificationFrameReady: true,
  }).status, "ready");
  const waiting = reduceAiGraderBackPositioningRetryUiState(pending, {
    type: "restore_completed",
    bridgeCaptureReady: true,
    physicallyVerified: true,
    postVerificationFrameReady: false,
  });
  assert.equal(waiting.status, "waiting_for_frame");
  assert.equal(reduceAiGraderBackPositioningRetryUiState(waiting, {
    type: "fresh_frame_ready",
  }).status, "ready");
  assert.deepEqual(reduceAiGraderBackPositioningRetryUiState(pending, {
    type: "retry_failed",
    message: "Bounded restore failed safely.",
  }), {
    status: "error",
    message: "Bounded restore failed safely.",
  });
  assert.equal(reduceAiGraderBackPositioningRetryUiState(pending, {
    type: "restore_completed",
    bridgeCaptureReady: true,
    physicallyVerified: false,
    postVerificationFrameReady: true,
  }).status, "error");
});

test("ready positioning retry is a repeat no-op and becomes retryable when truth is lost", () => {
  const verifiedAtMs = baseMs;
  const target = frame(backEpoch, "preview-back-retry-idempotent");
  let state = addLoadedFrame(
    createAiGraderPreviewEpochState(backEpoch),
    target,
    baseMs + 100,
    "blob:retry-idempotent",
    baseMs,
  ).state;
  state = reduce(state, {
    type: "geometry",
    binding: backEpoch,
    geometry: geometry(target, baseMs),
    observedAtMs: baseMs + 200,
  }).state;
  const readyInput = {
    state,
    positioningPhysicallyVerified: true,
    positioningVerifiedAt: new Date(verifiedAtMs).toISOString(),
    nowMs: baseMs + 200,
  };
  assert.equal(isAiGraderBackPositioningRetryReady(readyInput), true);
  assert.equal(shouldStartAiGraderBackPositioningRetry(readyInput), false);
  assert.equal(shouldStartAiGraderBackPositioningRetry(readyInput), false);
  assert.equal(shouldStartAiGraderBackPositioningRetry({
    ...readyInput,
    positioningPhysicallyVerified: false,
  }), true);

  const expired = reduce(state, { type: "tick", nowMs: baseMs + 2101 }).state;
  assert.equal(shouldStartAiGraderBackPositioningRetry({
    ...readyInput,
    state: expired,
    nowMs: baseMs + 2101,
  }), true);
  assert.equal(reduceAiGraderBackPositioningRetryUiState({ status: "ready" }, {
    type: "reset",
    backPositioningActive: true,
  }).status, "waiting_for_frame");
});

test("atomic intent suppresses preview-loss recovery only inside its bounded submitted window", async () => {
  const localIntent = { binding: backEpoch, frameId: "preview-back-atomic-pending", submittedAtMs: baseMs };
  const observe = async (input: {
    reason: "eof" | "error" | "abort";
    withIntent: boolean;
    atomicTransitionFailureConfirmed?: boolean;
    nowMs?: number;
  }) => {
    let safeOffCalls = 0;
    let reconnectCalls = 0;
    const disposition = await runAiGraderPreviewLossRecovery({
      reason: input.reason,
      expectedBinding: backEpoch,
      localIntent: input.withIntent ? localIntent : null,
      atomicTransitionFailureConfirmed: input.atomicTransitionFailureConfirmed,
      reconnectEligible: true,
      nowMs: input.nowMs ?? baseMs + 1,
    }, {
      async safeOff() {
        safeOffCalls += 1;
      },
      reconnect() {
        reconnectCalls += 1;
      },
    });
    return { disposition, safeOffCalls, reconnectCalls };
  };

  for (const reason of ["eof", "error"] as const) {
    const pending = await observe({ reason, withIntent: true });
    assert.equal(pending.disposition.preserveLocalIntent, true, reason);
    assert.equal(pending.safeOffCalls, 0, reason);
    assert.equal(pending.reconnectCalls, 0, reason);
  }
  const expired = await observe({
    reason: "eof",
    withIntent: true,
    nowMs: baseMs + AI_GRADER_LOCAL_CAPTURE_INTENT_MAX_AGE_MS + 1,
  });
  assert.equal(expired.disposition.preserveLocalIntent, false);
  assert.equal(expired.safeOffCalls, 1);
  assert.equal(expired.reconnectCalls, 1);
  const busyAbort = await observe({ reason: "abort", withIntent: true });
  assert.equal(busyAbort.safeOffCalls, 0);
  assert.equal(busyAbort.reconnectCalls, 0);

  const confirmedFailure = await observe({
    reason: "eof",
    withIntent: false,
    atomicTransitionFailureConfirmed: true,
  });
  assert.equal(confirmedFailure.safeOffCalls, 0);
  assert.equal(confirmedFailure.reconnectCalls, 1);

  const unexpected = await observe({ reason: "eof", withIntent: false });
  assert.equal(unexpected.disposition.preserveLocalIntent, false);
  assert.equal(unexpected.safeOffCalls, 1);
  assert.equal(unexpected.reconnectCalls, 1);
});

test("preview reconnect is sequential, finite, bounded, frame-resettable, and intentional-capture aware", () => {
  let state = createAiGraderPreviewReconnectState();
  let decision = beginAiGraderPreviewReader(state, true);
  assert.equal(decision.startReader, true);
  state = decision.state;
  const delays: number[] = [];
  for (let attempt = 0; attempt < AI_GRADER_PREVIEW_MAX_CONSECUTIVE_RECONNECTS; attempt += 1) {
    decision = finishAiGraderPreviewReader({ state, eligible: true, reason: "eof" });
    assert.ok(decision.reconnectDelayMs);
    delays.push(decision.reconnectDelayMs as number);
    state = releaseAiGraderPreviewReconnectTimer(decision.state);
    state = beginAiGraderPreviewReader(state, true).state;
  }
  decision = finishAiGraderPreviewReader({ state, eligible: true, reason: "error" });
  assert.equal(decision.state.exhausted, true);
  assert.equal(decision.reconnectDelayMs, undefined);
  assert.deepEqual(delays, [250, 500, 1000, 2000, 2000]);

  state = noteAiGraderPreviewFrameForReconnect({ ...decision.state, readerActive: true });
  assert.equal(
    finishAiGraderPreviewReader({ state, eligible: true, reason: "eof" }).reconnectDelayMs,
    250,
  );
  assert.equal(
    finishAiGraderPreviewReader({
      state,
      eligible: true,
      reason: "intentional_capture_transition",
    }).reconnectDelayMs,
    undefined,
  );
});

test("preview reconnect eligibility excludes every prohibited state", () => {
  const base = {
    connected: true,
    hasStationToken: true,
    mounted: true,
    aborted: false,
    captureActionActive: false,
    captureLockHeld: false,
    runnerCapturing: false,
    previewHoldActive: false,
    queueReviewActive: false,
    terminalOrSafeOff: false,
  };
  assert.equal(isAiGraderPreviewReconnectEligible(base), true);
  for (const key of [
    "aborted",
    "captureActionActive",
    "captureLockHeld",
    "runnerCapturing",
    "previewHoldActive",
    "queueReviewActive",
    "terminalOrSafeOff",
  ] as const) {
    assert.equal(isAiGraderPreviewReconnectEligible({ ...base, [key]: true }), false, key);
  }
});

test("preview stream distinguishes clean EOF, abort, actual error, and authoritative state without malformed final frame", async () => {
  const bytes = new TextEncoder().encode("jpeg-frame");
  const complete = new TextEncoder().encode(
    "--preview-boundary\r\n" +
      "Content-Type: image/jpeg\r\n" +
      "Content-Length: " + bytes.length + "\r\n" +
      "X-AI-Grader-Frame-Index: 1\r\n" +
      "X-AI-Grader-Session-Id: session-1\r\n" +
      "X-AI-Grader-Preview-Side: back\r\n" +
      "X-AI-Grader-Preview-Epoch: back-2\r\n" +
      "X-AI-Grader-Frame-Id: preview-back-1\r\n\r\n" +
      "jpeg-frame\r\n" +
      "--preview-boundary\r\nContent-Type: image/jpeg\r\nContent-Length: 99\r\n\r\nincomplete",
  );
  const events: string[] = [];
  const frames: string[] = [];
  const eofResult = await openAiGraderStationPreviewStream(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "station-token" },
    {
      onOpen: () => events.push("open"),
      onFrame: (value) => {
        events.push("frame");
        frames.push(
          value.sessionId + ":" + value.side + ":" + value.sideEpoch + ":" + value.frameId + ":" + value.byteLength,
        );
      },
      onEof: () => events.push("eof"),
      onAbort: () => events.push("abort"),
      onError: () => events.push("error"),
    },
    async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(complete);
        controller.close();
      },
    }), {
      status: 200,
      headers: { "content-type": "multipart/x-mixed-replace; boundary=preview-boundary" },
    }),
  );
  assert.equal(eofResult.kind, "eof");
  assert.deepEqual(events, ["open", "frame", "eof"]);
  assert.deepEqual(frames, ["session-1:back:back-2:preview-back-1:" + bytes.length]);

  const abortController = new AbortController();
  abortController.abort();
  const abortEvents: string[] = [];
  const abortResult = await openAiGraderStationPreviewStream(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "station-token" },
    { signal: abortController.signal, onAbort: () => abortEvents.push("abort"), onError: () => abortEvents.push("error") },
    async () => { throw new DOMException("aborted", "AbortError"); },
  );
  assert.equal(abortResult.kind, "abort");
  assert.deepEqual(abortEvents, ["abort"]);

  const errorEvents: string[] = [];
  await assert.rejects(
    openAiGraderStationPreviewStream(
      { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "station-token" },
      { onAbort: () => errorEvents.push("abort"), onError: () => errorEvents.push("error") },
      async () => { throw new Error("reader failed"); },
    ),
    /reader failed/,
  );
  assert.deepEqual(errorEvents, ["error"]);

  const stateEvents: string[] = [];
  const stateResult = await openAiGraderStationPreviewStream(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "station-token" },
    {
      onState: (value) => stateEvents.push(String(value.statusCode) + ":" + value.previewStatus?.status),
      onError: () => stateEvents.push("error"),
    },
    async () => new Response(JSON.stringify({
      ok: false,
      code: "AI_GRADER_CAPTURE_LOCK_HELD",
      message: "Capture owns camera.",
      result: { status: "paused_for_capture", cameraOwnership: "capture_action" },
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
  );
  assert.equal(stateResult.kind, "authoritative_state");
  assert.deepEqual(stateEvents, ["409:paused_for_capture"]);
});

test("retry uses empty body and exact token-gated binding headers", async () => {
  const result = await retryAiGraderBackPositioningLight(
    {
      baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
      stationToken: "station-token",
      expectedSessionId: backEpoch.sessionId,
      expectedSide: "back",
      expectedSideEpoch: backEpoch.sideEpoch,
    },
    async (input, init) => {
      assert.equal(String(input), DEFAULT_AI_GRADER_STATION_BRIDGE_URL + "/lighting/retry-back-positioning");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["x-ai-grader-station-token"], "station-token");
      assert.equal(headers["X-AI-Grader-Session-Id"], backEpoch.sessionId);
      assert.equal(headers["X-AI-Grader-Preview-Side"], "back");
      assert.equal(headers["X-AI-Grader-Preview-Epoch"], backEpoch.sideEpoch);
      assert.deepEqual(JSON.parse(String(init?.body)), {});
      return new Response(JSON.stringify({
        ok: true,
        result: {
          status: "waiting_for_frame",
          captureReady: false,
          sessionId: backEpoch.sessionId,
          sideEpoch: backEpoch.sideEpoch,
          attemptCount: 2,
          firstFrameGraceMs: 6000,
          positioningLightReady: false,
          appliedEnabled: true,
        },
      }), { status: 200 });
    },
  );
  assert.equal(result.status, "waiting_for_frame");
});

test("synchronous capture gate coalesces rapid identical operations and rejects a conflicting capture", async () => {
  const gate = createAiGraderCaptureOperationGate();
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const operation = async () => {
    calls += 1;
    await held;
    return "captured";
  };
  const signature = "session-1|report-1|front|front-1|frame-1|detected_geometry|operator";
  const first = gate.run(signature, operation);
  const second = gate.run(signature, operation);
  assert.equal(first, second);
  assert.equal(gate.activeSignature(), signature);
  await assert.rejects(
    gate.run("session-1|report-1|back|back-2|frame-2|detected_geometry|operator", operation),
    /different.*capture operation/i,
  );
  release();
  assert.equal(await first, "captured");
  assert.equal(calls, 1);
});

test("ambiguous capture reconciliation polls exact active authority sequentially to a hard bound", () => {
  const first = aiGraderAtomicIntentReconcileDecision({
    exactCaptureAuthority: true,
    exactTransitionFailure: false,
    bridgeTransitionActive: true,
    activeChecksRemaining: AI_GRADER_ACTIVE_CAPTURE_RECONCILE_MAX_CHECKS,
  });
  assert.deepEqual(first, {
    kind: "poll_active",
    delayMs: AI_GRADER_ACTIVE_CAPTURE_RECONCILE_INTERVAL_MS,
    nextActiveChecksRemaining: AI_GRADER_ACTIVE_CAPTURE_RECONCILE_MAX_CHECKS - 1,
  });
  assert.deepEqual(aiGraderAtomicIntentReconcileDecision({
    exactCaptureAuthority: true,
    exactTransitionFailure: false,
    bridgeTransitionActive: true,
    activeChecksRemaining: 0,
  }), { kind: "active_deadline" });
  assert.deepEqual(aiGraderAtomicIntentReconcileDecision({
    exactCaptureAuthority: true,
    exactTransitionFailure: false,
    bridgeTransitionActive: false,
    activeChecksRemaining: 0,
  }), { kind: "recover_full_status" });
  assert.deepEqual(aiGraderAtomicIntentReconcileDecision({
    exactCaptureAuthority: false,
    exactTransitionFailure: true,
    bridgeTransitionActive: false,
    activeChecksRemaining: 0,
  }), { kind: "recover_full_status" });
  assert.deepEqual(aiGraderAtomicIntentReconcileDecision({
    exactCaptureAuthority: false,
    exactTransitionFailure: false,
    bridgeTransitionActive: false,
    activeChecksRemaining: 0,
  }), { kind: "safe_off_reconnect" });
});

test("Station atomic Front helper emits one v0.9 assertion-only mutation with a stable key", async () => {
  const assertion = aiGraderCaptureAssertionFromFrame({
    frame: frame(frontEpoch, "preview-front-atomic"),
    reportId: "report-1",
    geometryCaptureMode: "manual_capture",
    captureTriggerMode: "operator",
  });
  const firstAttempt = createAiGraderCaptureAttempt(assertion, "2026-07-13T12:00:01.000Z");
  const retryAttempt = createAiGraderCaptureAttempt(assertion, "2026-07-13T12:00:02.000Z");
  assert.equal(firstAttempt.idempotencyKey, retryAttempt.idempotencyKey);
  assert.match(firstAttempt.idempotencyKey, /^capture-front-v0\.9-[a-f0-9]{16}$/);
  const body = buildAiGraderAtomicCaptureRequest({ assertion, attempt: firstAttempt });
  assert.deepEqual(Object.keys(body).sort(), [
    "captureTriggerAt",
    "captureTriggerMode",
    "expectedFrameId",
    "expectedReportId",
    "expectedSessionId",
    "expectedSide",
    "expectedSideEpoch",
    "geometryCaptureMode",
    "idempotencyKey",
  ]);
  assert.equal("manualGeometryRect" in body, false);
  assert.equal("confirmations" in body, false);
  assert.equal("acceptedProfile" in body, false);

  let calls = 0;
  const result = await runAiGraderAtomicCapture({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "station-token",
    assertion,
    attempt: firstAttempt,
  }, async (input, init) => {
    calls += 1;
    assert.equal(String(input), DEFAULT_AI_GRADER_STATION_BRIDGE_URL + "/actions/capture-front");
    assert.deepEqual(JSON.parse(String(init?.body)), body);
    return new Response(JSON.stringify({
      ok: true,
      result: buildAiGraderLocalStationStatus({ action: "capture-front" }),
    }), { status: 200 });
  });
  assert.equal(calls, 1);
  assert.equal(result.currentStep, "prompt_flip_card");
});

test("Station atomic helper performs one capture mutation and keeps manual mode assertion-only", async () => {
  const displayed = frame(backEpoch, "preview-back-atomic");
  const manualAssertion = aiGraderBackCaptureAssertionFromFrame({
    frame: displayed,
    reportId: "report-1",
    geometryCaptureMode: "manual_capture",
    captureTriggerMode: "operator",
  });
  const firstAttempt = createAiGraderBackCaptureAttempt(manualAssertion, "2026-07-13T12:00:01.000Z");
  const retryAttempt = createAiGraderBackCaptureAttempt(manualAssertion, "2026-07-13T12:00:02.000Z");
  assert.equal(firstAttempt.idempotencyKey, retryAttempt.idempotencyKey);
  const body = buildAiGraderAtomicBackCaptureRequest({ assertion: manualAssertion, attempt: firstAttempt });
  assert.equal(body.geometryCaptureMode, "manual_capture");
  assert.equal("manualGeometryRect" in body, false);
  assert.equal("confirmations" in body, false);

  let calls = 0;
  const result = await runAiGraderAtomicBackCapture({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "station-token",
    assertion: manualAssertion,
    attempt: firstAttempt,
  }, async (input, init) => {
    calls += 1;
    assert.equal(String(input), DEFAULT_AI_GRADER_STATION_BRIDGE_URL + "/actions/capture-back");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), body);
    return new Response(JSON.stringify({
      ok: true,
      result: buildAiGraderLocalStationStatus({ action: "capture-back" }),
    }), { status: 200 });
  });
  assert.equal(calls, 1);
  assert.equal(result.currentStep, "run_provisional_diagnostics");
});

test("Station Back Capture orchestration confirms an HTTP 409 pre-transition failure before recovery", async () => {
  const assertion = aiGraderBackCaptureAssertionFromFrame({
    frame: frame(backEpoch, "preview-back-orchestrated-failure"),
    reportId: "report-1",
    geometryCaptureMode: "detected_geometry",
    captureTriggerMode: "operator",
  });
  const attempt = createAiGraderBackCaptureAttempt(assertion, "2026-07-13T12:00:03.000Z");
  const paths: string[] = [];
  let intentCount = 0;
  let confirmedFailureCount = 0;
  await assert.rejects(runAiGraderStationBackCaptureOrchestration({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "station-token",
    assertion,
    attempt,
    onIntent(intent) {
      intentCount += 1;
      assert.equal(intent.frameId, assertion.expectedFrameId);
    },
    onConfirmedPreTransitionFailure({ intent, previewStatus }) {
      confirmedFailureCount += 1;
      assert.equal(intent.frameId, assertion.expectedFrameId);
      assert.equal(previewStatus.status, "live");
    },
  }, async (input) => {
    const requestUrl = new URL(String(input));
    paths.push(requestUrl.pathname);
    if (requestUrl.pathname === "/actions/capture-back") {
      return new Response(JSON.stringify({ ok: false, code: "STALE_FRAME", message: "Capture assertion is stale." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      result: {
        ...buildAiGraderLocalStationStatus({ action: "capture-front" }).previewStatus,
        status: "live",
        sessionId: backEpoch.sessionId,
        activeSide: "back",
        sideEpoch: backEpoch.sideEpoch,
        cameraOwnership: "preview_stream",
        intentionalTransition: { active: false },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }), /stale/i);
  assert.deepEqual(paths, ["/actions/capture-back", "/preview/status"]);
  assert.equal(intentCount, 1);
  assert.equal(confirmedFailureCount, 1);
});

test("Station Back Capture orchestration preserves intent after ambiguous POST rejection with live status", async () => {
  const assertion = aiGraderBackCaptureAssertionFromFrame({
    frame: frame(backEpoch, "preview-back-ambiguous-live"),
    reportId: "report-1",
    geometryCaptureMode: "detected_geometry",
    captureTriggerMode: "operator",
  });
  const attempt = createAiGraderBackCaptureAttempt(assertion, "2026-07-13T12:00:04.000Z");
  const paths: string[] = [];
  let confirmedFailureCount = 0;
  await assert.rejects(runAiGraderStationBackCaptureOrchestration({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "station-token",
    assertion,
    attempt,
    onIntent() {},
    onConfirmedPreTransitionFailure() {
      confirmedFailureCount += 1;
    },
  }, async (input) => {
    const requestUrl = new URL(String(input));
    paths.push(requestUrl.pathname);
    if (requestUrl.pathname === "/actions/capture-back") {
      throw new TypeError("ambiguous capture transport rejection");
    }
    return new Response(JSON.stringify({
      ok: true,
      result: {
        ...buildAiGraderLocalStationStatus({ action: "capture-front" }).previewStatus,
        status: "live",
        sessionId: backEpoch.sessionId,
        activeSide: "back",
        sideEpoch: backEpoch.sideEpoch,
        cameraOwnership: "preview_stream",
        intentionalTransition: { active: false },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }), /ambiguous capture transport rejection/);
  assert.deepEqual(paths, ["/actions/capture-back", "/preview/status"]);
  assert.equal(confirmedFailureCount, 0);
});

test("Station Back Capture orchestration accepts exact transition_failed after ambiguous POST rejection", async () => {
  const expectedFrameId = "preview-back-ambiguous-transition-failed";
  const assertion = aiGraderBackCaptureAssertionFromFrame({
    frame: frame(backEpoch, expectedFrameId),
    reportId: "report-1",
    geometryCaptureMode: "detected_geometry",
    captureTriggerMode: "operator",
  });
  const attempt = createAiGraderBackCaptureAttempt(assertion, "2026-07-13T12:00:05.000Z");
  const paths: string[] = [];
  let confirmedFailureCount = 0;
  await assert.rejects(runAiGraderStationBackCaptureOrchestration({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "station-token",
    assertion,
    attempt,
    onIntent() {},
    onConfirmedPreTransitionFailure({ intent, previewStatus }) {
      confirmedFailureCount += 1;
      assert.equal(intent.frameId, expectedFrameId);
      assert.equal(previewStatus.intentionalTransition.outcome, "transition_failed");
    },
  }, async (input) => {
    const requestUrl = new URL(String(input));
    paths.push(requestUrl.pathname);
    if (requestUrl.pathname === "/actions/capture-back") {
      throw new TypeError("ambiguous capture transport rejection");
    }
    return new Response(JSON.stringify({
      ok: true,
      result: {
        ...buildAiGraderLocalStationStatus({ action: "capture-front" }).previewStatus,
        status: "live",
        sessionId: backEpoch.sessionId,
        activeSide: "back",
        sideEpoch: backEpoch.sideEpoch,
        cameraOwnership: "preview_stream",
        intentionalTransition: {
          active: false,
          kind: "capture_back",
          sessionId: backEpoch.sessionId,
          side: "back",
          sideEpoch: backEpoch.sideEpoch,
          frameId: expectedFrameId,
          completedAt: new Date().toISOString(),
          outcome: "transition_failed",
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }), /ambiguous capture transport rejection/);
  assert.deepEqual(paths, ["/actions/capture-back", "/preview/status"]);
  assert.equal(confirmedFailureCount, 1);
});

test("Station retry recovery restarts one reader before one bounded restore and rejects obsolete binding", async () => {
  const order: string[] = [];
  const result = await runAiGraderBackPositioningRetryRecovery({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "station-token",
    expectedBinding: backEpoch,
    getCurrentBinding: () => backEpoch,
    restartPreview: async () => {
      order.push("restart");
    },
  }, async () => {
    order.push("retry");
    return new Response(JSON.stringify({
      ok: true,
      result: {
        status: "waiting_for_frame",
        captureReady: false,
        sessionId: backEpoch.sessionId,
        sideEpoch: backEpoch.sideEpoch,
        attemptCount: 1,
        firstFrameGraceMs: 6000,
        positioningLightReady: false,
      },
    }), { status: 200 });
  });
  assert.deepEqual(order, ["restart", "retry"]);
  assert.equal(result.sideEpoch, backEpoch.sideEpoch);

  let currentBinding: AiGraderPreviewEpochBinding = backEpoch;
  let obsoleteResponseCommitted = false;
  await assert.rejects(async () => {
    await runAiGraderBackPositioningRetryRecovery({
      baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
      stationToken: "station-token",
      expectedBinding: backEpoch,
      getCurrentBinding: () => currentBinding,
      restartPreview: async () => undefined,
    }, async () => {
      currentBinding = frontEpoch;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          status: "waiting_for_frame",
          captureReady: false,
          sessionId: backEpoch.sessionId,
          sideEpoch: backEpoch.sideEpoch,
          attemptCount: 1,
          firstFrameGraceMs: 6000,
          positioningLightReady: false,
        },
      }), { status: 200 });
    });
    obsoleteResponseCommitted = true;
  }, /in flight/);
  assert.equal(obsoleteResponseCommitted, false);
  assert.equal(currentBinding, frontEpoch);

  let restarted = false;
  await assert.rejects(
    runAiGraderBackPositioningRetryRecovery({
      baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
      stationToken: "station-token",
      expectedBinding: backEpoch,
      getCurrentBinding: () => frontEpoch,
      restartPreview: async () => {
        restarted = true;
      },
    }),
    /obsolete/,
  );
  assert.equal(restarted, false);
});
