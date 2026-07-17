import assert from "node:assert/strict";
import test from "node:test";
import {
  aiGraderPreviewDetectedCaptureReady,
  createAiGraderPreviewEpochState,
  transitionAiGraderPreviewEpoch,
} from "../lib/aiGraderPreviewLifecycle";

test("preview accepts only fresh exact-binding geometry for the displayed frame", () => {
  const now = Date.parse("2026-07-17T12:00:01.000Z");
  const binding = { sessionId: "session-1", side: "front" as const, sideEpoch: "epoch-1" };
  const frame = { ...binding, frameId: "frame-1" };
  let state = createAiGraderPreviewEpochState(binding);
  state = transitionAiGraderPreviewEpoch(state, { type: "opened", binding }).state;
  state = transitionAiGraderPreviewEpoch(state, {
    type: "frame", frame, objectUrl: "blob:frame-1", receivedAtMs: now, capturedAt: "2026-07-17T12:00:00.900Z",
  }).state;
  state = transitionAiGraderPreviewEpoch(state, { type: "image_loaded", frame, loadedAtMs: now, width: 1200, height: 1800 }).state;
  state = transitionAiGraderPreviewEpoch(state, {
    type: "geometry", binding, observedAtMs: now,
    geometry: {
      side: "front", placementState: "ready", geometrySource: "detected", captureMode: "automatic_detection",
      confidenceBasis: "automatic_detection", detectionUsed: true, corners: null, detectedCorners: null,
      boundingBox: null, rotationDegrees: 0, skewDegrees: 0, confidence: 0.99,
      sessionId: binding.sessionId, sideEpoch: binding.sideEpoch, sourceFrameId: frame.frameId,
      timestamp: "2026-07-17T12:00:00.950Z",
    },
  }).state;
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, now), true);
  assert.equal(aiGraderPreviewDetectedCaptureReady(state, now + 2501), false);
});

test("stale or wrong-epoch frames are rejected without a reconnect fallback", () => {
  const binding = { sessionId: "session-1", side: "back" as const, sideEpoch: "epoch-2" };
  const state = createAiGraderPreviewEpochState(binding);
  const transition = transitionAiGraderPreviewEpoch(state, {
    type: "frame",
    frame: { sessionId: "session-1", side: "back", sideEpoch: "old-epoch", frameId: "frame-old" },
    objectUrl: "blob:old",
    receivedAtMs: 10000,
    capturedAt: new Date(9900).toISOString(),
  });
  assert.equal(transition.accepted, false);
  assert.deepEqual(transition.revokeObjectUrls, ["blob:old"]);
});
