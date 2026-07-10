import type {
  AiGraderPreviewCardGeometrySummary,
  AiGraderPreviewGeometrySide,
} from "./aiGraderLocalStation";

export const AI_GRADER_AUTO_CAPTURE_STABLE_MS = 800;
export const AI_GRADER_AUTO_CAPTURE_MAX_FRAME_AGE_MS = 2000;
export const AI_GRADER_AUTO_CAPTURE_MIN_READY_FRAMES = 3;

export type AiGraderAutoCaptureState = {
  scopeKey: string;
  observedAnalyzedRemoval: boolean;
  lastRemovalFrameId?: string;
  readySinceMs?: number;
  readyFrameIds: string[];
  readyFirstAnalyzedAtMs?: number;
  readyLatestAnalyzedAtMs?: number;
  lastFrameId?: string;
  triggered: boolean;
};

export type AiGraderAutoCaptureDecision = {
  state: AiGraderAutoCaptureState;
  shouldTrigger: boolean;
  readyStableMs: number;
  phase: "disabled" | "waiting_for_card_removal" | "waiting_for_ready" | "stabilizing" | "triggered";
};

function freshState(scopeKey: string): AiGraderAutoCaptureState {
  return {
    scopeKey,
    observedAnalyzedRemoval: false,
    readyFrameIds: [],
    triggered: false,
  };
}

function isAnalyzedFrame(
  geometry: AiGraderPreviewCardGeometrySummary | undefined,
  side: AiGraderPreviewGeometrySide,
  nowMs: number
) {
  const timestampMs = geometry?.timestamp ? Date.parse(geometry.timestamp) : Number.NaN;
  return Boolean(
    geometry &&
      geometry.side === side &&
      geometry.sourceFrameId?.trim() &&
      Number.isFinite(timestampMs) &&
      timestampMs <= nowMs + 1000 &&
      nowMs - timestampMs <= AI_GRADER_AUTO_CAPTURE_MAX_FRAME_AGE_MS
  );
}

function isDetectedReady(geometry: AiGraderPreviewCardGeometrySummary | undefined) {
  return Boolean(
    geometry?.placementState === "ready" &&
      geometry.geometrySource === "detected" &&
      geometry.detectionUsed === true &&
      (geometry.corners || geometry.detectedCorners)
  );
}

/**
 * Arms only after an analyzed not-detected removal frame in the current session/side,
 * then requires detected Ready to remain stable for the full dwell. Changing
 * session or side resets the arm, so retained front/back geometry can never
 * trigger the next capture.
 */
export function advanceAiGraderAutoCapture(input: {
  previous?: AiGraderAutoCaptureState;
  enabled: boolean;
  sessionId: string;
  side: AiGraderPreviewGeometrySide;
  geometry?: AiGraderPreviewCardGeometrySummary;
  nowMs: number;
  stableMs?: number;
}): AiGraderAutoCaptureDecision {
  const scopeKey = `${input.sessionId}:${input.side}`;
  const stableMs = Math.max(1, input.stableMs ?? AI_GRADER_AUTO_CAPTURE_STABLE_MS);
  let state = input.previous?.scopeKey === scopeKey ? { ...input.previous } : freshState(scopeKey);

  if (!input.enabled) {
    state = freshState(scopeKey);
    return { state, shouldTrigger: false, readyStableMs: 0, phase: "disabled" };
  }

  if (!isAnalyzedFrame(input.geometry, input.side, input.nowMs)) {
    state.readySinceMs = undefined;
    state.readyFrameIds = [];
    state.readyFirstAnalyzedAtMs = undefined;
    state.readyLatestAnalyzedAtMs = undefined;
    return {
      state,
      shouldTrigger: false,
      readyStableMs: 0,
      phase: state.observedAnalyzedRemoval ? "waiting_for_ready" : "waiting_for_card_removal",
    };
  }

  const frameId = input.geometry!.sourceFrameId!;
  state.lastFrameId = frameId;
  if (!isDetectedReady(input.geometry)) {
    if (input.geometry!.placementState === "not_detected") {
      state.observedAnalyzedRemoval = true;
      state.lastRemovalFrameId = frameId;
    }
    state.readySinceMs = undefined;
    state.readyFrameIds = [];
    state.readyFirstAnalyzedAtMs = undefined;
    state.readyLatestAnalyzedAtMs = undefined;
    return {
      state,
      shouldTrigger: false,
      readyStableMs: 0,
      phase: state.triggered ? "triggered" : state.observedAnalyzedRemoval ? "waiting_for_ready" : "waiting_for_card_removal",
    };
  }

  if (!state.observedAnalyzedRemoval || frameId === state.lastRemovalFrameId) {
    state.readySinceMs = undefined;
    state.readyFrameIds = [];
    state.readyFirstAnalyzedAtMs = undefined;
    state.readyLatestAnalyzedAtMs = undefined;
    return { state, shouldTrigger: false, readyStableMs: 0, phase: "waiting_for_card_removal" };
  }
  if (state.triggered) {
    return { state, shouldTrigger: false, readyStableMs: stableMs, phase: "triggered" };
  }

  if (state.readySinceMs === undefined) {
    state.readySinceMs = input.nowMs;
    state.readyFrameIds = [];
    state.readyFirstAnalyzedAtMs = undefined;
    state.readyLatestAnalyzedAtMs = undefined;
  }
  if (!state.readyFrameIds.includes(frameId)) {
    state.readyFrameIds = [...state.readyFrameIds, frameId].slice(-AI_GRADER_AUTO_CAPTURE_MIN_READY_FRAMES);
    const analyzedAtMs = Date.parse(input.geometry!.timestamp!);
    state.readyFirstAnalyzedAtMs ??= analyzedAtMs;
    state.readyLatestAnalyzedAtMs = analyzedAtMs;
  }
  const readyStableMs = Math.max(0, input.nowMs - state.readySinceMs);
  const analyzedReadySpanMs = Math.max(
    0,
    (state.readyLatestAnalyzedAtMs ?? 0) - (state.readyFirstAnalyzedAtMs ?? state.readyLatestAnalyzedAtMs ?? 0)
  );
  if (
    readyStableMs < stableMs ||
    analyzedReadySpanMs < stableMs ||
    state.readyFrameIds.length < AI_GRADER_AUTO_CAPTURE_MIN_READY_FRAMES
  ) {
    return { state, shouldTrigger: false, readyStableMs, phase: "stabilizing" };
  }
  state.triggered = true;
  return { state, shouldTrigger: true, readyStableMs, phase: "triggered" };
}
