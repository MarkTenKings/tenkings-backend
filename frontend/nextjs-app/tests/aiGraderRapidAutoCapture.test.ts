import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  AI_GRADER_AUTO_CAPTURE_STABLE_MS,
  advanceAiGraderAutoCapture,
  type AiGraderAutoCaptureState,
} from "../lib/aiGraderRapidAutoCapture";
import type { AiGraderPreviewCardGeometrySummary } from "../lib/aiGraderLocalStation";

const WALL_TIME_MS = Date.parse("2026-07-10T00:00:00.000Z");

function geometry(input: {
  side?: "front" | "back";
  state: "not_detected" | "adjust_card" | "ready";
  frameId?: string;
}): AiGraderPreviewCardGeometrySummary {
  const ready = input.state === "ready";
  const corners = ready
    ? {
        topLeft: { x: 10, y: 10 },
        topRight: { x: 90, y: 10 },
        bottomRight: { x: 90, y: 140 },
        bottomLeft: { x: 10, y: 140 },
      }
    : null;
  return {
    side: input.side ?? "front",
    placementState: input.state,
    geometrySource: ready ? "detected" : "none",
    captureMode: ready ? "automatic_detection" : "none",
    confidenceBasis: ready ? "automatic_detection" : "none",
    detectionUsed: ready,
    manualOverrideUsed: false,
    corners,
    detectedCorners: corners,
    boundingBox: ready ? { x: 10, y: 10, width: 80, height: 130 } : null,
    rotationDegrees: ready ? 1 : null,
    skewDegrees: ready ? 1 : null,
    confidence: ready ? 0.94 : 0,
    ...(input.frameId
      ? {
          sourceFrameId: input.frameId,
          timestamp: "2026-07-10T00:00:00.000Z",
          image: { width: 100, height: 150, coordinateFrame: "source_image_pixels" as const },
        }
      : {}),
  };
}

function advance(previous: AiGraderAutoCaptureState | undefined, options: {
  sessionId?: string;
  side?: "front" | "back";
  geometry?: AiGraderPreviewCardGeometrySummary;
  nowMs: number;
  enabled?: boolean;
  frameAgeMs?: number;
}) {
  const wallNowMs = WALL_TIME_MS + options.nowMs;
  const currentGeometry = options.geometry?.sourceFrameId
    ? { ...options.geometry, timestamp: new Date(wallNowMs - (options.frameAgeMs ?? 0)).toISOString() }
    : options.geometry;
  return advanceAiGraderAutoCapture({
    previous,
    enabled: options.enabled ?? true,
    sessionId: options.sessionId ?? "session-a",
    side: options.side ?? "front",
    geometry: currentGeometry,
    nowMs: wallNowMs,
  });
}

test("auto capture never arms from default or retained ready geometry", () => {
  let decision = advance(undefined, { geometry: geometry({ state: "not_detected" }), nowMs: 0 });
  assert.equal(decision.phase, "waiting_for_card_removal");
  assert.equal(decision.shouldTrigger, false);

  decision = advance(decision.state, { geometry: geometry({ state: "ready", frameId: "front-ready-1" }), nowMs: 2000 });
  assert.equal(decision.phase, "waiting_for_card_removal");
  assert.equal(decision.shouldTrigger, false);
  decision = advance(decision.state, { geometry: geometry({ state: "ready", frameId: "front-ready-2" }), nowMs: 4000 });
  assert.equal(decision.shouldTrigger, false);
});

test("auto capture requires analyzed card removal then 800ms stable detected ready and fires once", () => {
  let decision = advance(undefined, { geometry: geometry({ state: "adjust_card", frameId: "front-adjust-1" }), nowMs: 0 });
  assert.equal(decision.phase, "waiting_for_card_removal");
  decision = advance(decision.state, { geometry: geometry({ state: "ready", frameId: "front-ready-too-soon" }), nowMs: 50 });
  assert.equal(decision.shouldTrigger, false);
  assert.equal(decision.phase, "waiting_for_card_removal");
  decision = advance(decision.state, { geometry: geometry({ state: "not_detected", frameId: "front-removed-1" }), nowMs: 75 });
  assert.equal(decision.phase, "waiting_for_ready");
  decision = advance(decision.state, { geometry: geometry({ state: "ready", frameId: "front-ready-1" }), nowMs: 100 });
  assert.equal(decision.phase, "stabilizing");
  decision = advance(decision.state, {
    geometry: geometry({ state: "ready", frameId: "front-ready-2" }),
    nowMs: 100 + AI_GRADER_AUTO_CAPTURE_STABLE_MS - 1,
  });
  assert.equal(decision.shouldTrigger, false);
  decision = advance(decision.state, {
    geometry: geometry({ state: "ready", frameId: "front-ready-3" }),
    nowMs: 100 + AI_GRADER_AUTO_CAPTURE_STABLE_MS,
  });
  assert.equal(decision.shouldTrigger, true);
  decision = advance(decision.state, { geometry: geometry({ state: "ready", frameId: "front-ready-4" }), nowMs: 2000 });
  assert.equal(decision.shouldTrigger, false);
  assert.equal(decision.phase, "triggered");
});

test("auto capture rearms separately for each side and session", () => {
  let decision = advance(undefined, { geometry: geometry({ state: "not_detected", frameId: "front-removed" }), nowMs: 0 });
  decision = advance(decision.state, { geometry: geometry({ state: "ready", frameId: "front-ready" }), nowMs: 100 });
  decision = advance(decision.state, { geometry: geometry({ state: "ready", frameId: "front-ready-2" }), nowMs: 500 });
  decision = advance(decision.state, { geometry: geometry({ state: "ready", frameId: "front-ready-3" }), nowMs: 900 });
  assert.equal(decision.shouldTrigger, true);

  decision = advance(decision.state, {
    side: "back",
    geometry: geometry({ side: "back", state: "ready", frameId: "retained-back-ready" }),
    nowMs: 2000,
  });
  assert.equal(decision.shouldTrigger, false);
  assert.equal(decision.phase, "waiting_for_card_removal");
  decision = advance(decision.state, {
    side: "back",
    geometry: geometry({ side: "back", state: "not_detected", frameId: "back-empty" }),
    nowMs: 2100,
  });
  decision = advance(decision.state, {
    side: "back",
    geometry: geometry({ side: "back", state: "ready", frameId: "back-ready" }),
    nowMs: 2200,
  });
  decision = advance(decision.state, {
    side: "back",
    geometry: geometry({ side: "back", state: "ready", frameId: "back-ready-2" }),
    nowMs: 2600,
  });
  decision = advance(decision.state, {
    side: "back",
    geometry: geometry({ side: "back", state: "ready", frameId: "back-ready-3" }),
    nowMs: 3000,
  });
  assert.equal(decision.shouldTrigger, true);

  decision = advance(decision.state, {
    sessionId: "session-b",
    geometry: geometry({ state: "ready", frameId: "prior-card-front-ready" }),
    nowMs: 4000,
  });
  assert.equal(decision.shouldTrigger, false);
  assert.equal(decision.phase, "waiting_for_card_removal");
});

test("auto capture does not count a frozen Ready frame or stale analyzed timestamps", () => {
  let decision = advance(undefined, { geometry: geometry({ state: "not_detected", frameId: "removed" }), nowMs: 0 });
  decision = advance(decision.state, { geometry: geometry({ state: "ready", frameId: "frozen-ready" }), nowMs: 100 });
  decision = advance(decision.state, { geometry: geometry({ state: "ready", frameId: "frozen-ready" }), nowMs: 1000 });
  assert.equal(decision.shouldTrigger, false);
  assert.equal(decision.phase, "stabilizing");

  decision = advance(decision.state, {
    geometry: geometry({ state: "ready", frameId: "stale-ready-2" }),
    nowMs: 1200,
    frameAgeMs: 2500,
  });
  assert.equal(decision.shouldTrigger, false);
  assert.equal(decision.phase, "waiting_for_ready");
});

test("station rapid flow keeps capture, review, OCR, and publish gates explicit", () => {
  const stationPath = [
    path.join(process.cwd(), "pages", "ai-grader", "station.tsx"),
    path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "station.tsx"),
  ].find((candidate) => fs.existsSync(candidate));
  assert.ok(stationPath);
  const source = fs.readFileSync(stationPath, "utf8");
  assert.match(source, /nowMs: Date\.now\(\)/);
  assert.doesNotMatch(source, /nowMs: performance\.now\(\)/);
  assert.match(source, /captureTriggerAt/);
  assert.match(source, /captureTriggerMode/);
  assert.match(source, /queue-current-card/);
  assert.match(source, /previewSuspendedForRapidReview/);
  assert.match(source, /disabled=\{busy !== null \|\| !canStartGrading \|\| previewGeometrySide !== "front"/);
  assert.match(source, /const canStartGrading =\s*!status\.captureFailure &&/);
  assert.match(source, /report_ready_needs_confirm/);
  assert.match(source, /rapidOcrInFlightReportIdRef/);
  assert.match(source, /Background OCR suggestions loaded/);
  assert.match(source, /Human Confirm Card and Publish actions are still required/);
  const backFlow = source.slice(source.indexOf("const confirmFlipAndContinue"), source.indexOf("const activateRapidQueueItem"));
  assert.ok(backFlow.indexOf('runAction("queue-current-card"') < backFlow.indexOf('runAction("run-diagnostics"'));
});
