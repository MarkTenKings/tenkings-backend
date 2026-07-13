import type {
  AiGraderLocalStationPreviewStatus,
  AiGraderPreviewCardGeometrySummary,
  AiGraderPreviewGeometrySide,
} from "./aiGraderLocalStation";

export const AI_GRADER_PREVIEW_RECONNECT_DELAYS_MS = [250, 500, 1000, 2000] as const;
export const AI_GRADER_PREVIEW_MAX_CONSECUTIVE_RECONNECTS = 5;

export type AiGraderPreviewEpochBinding = {
  sessionId: string;
  side: AiGraderPreviewGeometrySide;
  sideEpoch: string;
};

export type AiGraderPreviewFrameBinding = AiGraderPreviewEpochBinding & {
  frameId: string;
};

export type AiGraderPreviewEpochState = {
  binding?: AiGraderPreviewEpochBinding;
  phase: AiGraderLocalStationPreviewStatus["status"];
  acceptedFrameIds: string[];
  latestFrame?: AiGraderPreviewFrameBinding;
  imageReadyFrameId?: string;
  geometryFrameId?: string;
};

export type AiGraderPreviewEpochEvent =
  | { type: "bind"; binding?: AiGraderPreviewEpochBinding }
  | { type: "opened"; binding: AiGraderPreviewEpochBinding }
  | { type: "frame"; frame: AiGraderPreviewFrameBinding }
  | { type: "image_loaded"; frame: AiGraderPreviewFrameBinding }
  | { type: "geometry"; binding: AiGraderPreviewEpochBinding; sourceFrameId?: string }
  | { type: "non_live"; status: Exclude<AiGraderLocalStationPreviewStatus["status"], "live"> };

export type AiGraderPreviewReconnectState = {
  readerActive: boolean;
  retryScheduled: boolean;
  consecutiveFailures: number;
  exhausted: boolean;
};

export type AiGraderPreviewReconnectDecision = {
  state: AiGraderPreviewReconnectState;
  startReader: boolean;
  reconnectDelayMs?: number;
};

export type AiGraderPreviewEligibilityInput = {
  connected: boolean;
  hasStationToken: boolean;
  mounted: boolean;
  aborted: boolean;
  captureActionActive: boolean;
  captureLockHeld: boolean;
  runnerCapturing: boolean;
  previewHoldActive: boolean;
  queueReviewActive: boolean;
  terminalOrSafeOff: boolean;
};

const SAFE_PREVIEW_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function safePreviewId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!SAFE_PREVIEW_ID.test(trimmed)) return undefined;
  if (/token|secret|bearer|presign|x-amz|localhost/i.test(trimmed)) return undefined;
  return trimmed;
}

export function sanitizeAiGraderPreviewEpochBinding(value: unknown): AiGraderPreviewEpochBinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const sessionId = safePreviewId(record.sessionId);
  const sideEpoch = safePreviewId(record.sideEpoch);
  const side = record.side === "front" || record.side === "back" ? record.side : undefined;
  return sessionId && sideEpoch && side ? { sessionId, side, sideEpoch } : undefined;
}

export function sanitizeAiGraderPreviewFrameBinding(value: unknown): AiGraderPreviewFrameBinding | undefined {
  const binding = sanitizeAiGraderPreviewEpochBinding(value);
  const frameId = value && typeof value === "object" && !Array.isArray(value)
    ? safePreviewId((value as Record<string, unknown>).frameId)
    : undefined;
  return binding && frameId ? { ...binding, frameId } : undefined;
}

export function aiGraderPreviewStatusBinding(
  status: Pick<AiGraderLocalStationPreviewStatus, "sessionId" | "activeSide" | "sideEpoch">
): AiGraderPreviewEpochBinding | undefined {
  return sanitizeAiGraderPreviewEpochBinding({
    sessionId: status.sessionId,
    side: status.activeSide,
    sideEpoch: status.sideEpoch,
  });
}

export function aiGraderPreviewBindingMatches(
  left?: AiGraderPreviewEpochBinding,
  right?: AiGraderPreviewEpochBinding
) {
  return Boolean(
    left &&
    right &&
    left.sessionId === right.sessionId &&
    left.side === right.side &&
    left.sideEpoch === right.sideEpoch
  );
}

export function aiGraderPreviewFrameMatchesEpoch(
  frame: AiGraderPreviewFrameBinding | undefined,
  binding: AiGraderPreviewEpochBinding | undefined
) {
  return Boolean(frame && aiGraderPreviewBindingMatches(frame, binding));
}

export function aiGraderPreviewGeometryMatchesEpoch(input: {
  geometry?: AiGraderPreviewCardGeometrySummary;
  binding?: AiGraderPreviewEpochBinding;
  acceptedFrameIds: readonly string[];
}) {
  const { geometry, binding, acceptedFrameIds } = input;
  if (!geometry || !binding || !geometry.sourceFrameId) return false;
  return geometry.sessionId === binding.sessionId &&
    geometry.side === binding.side &&
    geometry.sideEpoch === binding.sideEpoch &&
    acceptedFrameIds.includes(geometry.sourceFrameId);
}

export function createAiGraderPreviewEpochState(
  binding?: AiGraderPreviewEpochBinding
): AiGraderPreviewEpochState {
  return {
    ...(binding ? { binding: { ...binding } } : {}),
    phase: binding ? "starting" : "not_started",
    acceptedFrameIds: [],
  };
}

export function advanceAiGraderPreviewEpoch(
  current: AiGraderPreviewEpochState,
  event: AiGraderPreviewEpochEvent
): AiGraderPreviewEpochState {
  if (event.type === "bind") {
    if (aiGraderPreviewBindingMatches(current.binding, event.binding)) return current;
    return createAiGraderPreviewEpochState(event.binding);
  }
  if (event.type === "non_live") {
    return {
      ...(current.binding ? { binding: current.binding } : {}),
      phase: event.status,
      acceptedFrameIds: [],
    };
  }
  if (!aiGraderPreviewBindingMatches(current.binding, event.type === "frame" || event.type === "image_loaded" ? event.frame : event.binding)) {
    return current;
  }
  if (event.type === "opened") {
    return {
      ...(current.binding ? { binding: current.binding } : {}),
      phase: "starting",
      acceptedFrameIds: [],
    };
  }
  if (event.type === "frame") {
    const acceptedFrameIds = [...current.acceptedFrameIds.filter((frameId) => frameId !== event.frame.frameId), event.frame.frameId].slice(-64);
    return {
      ...current,
      phase: "live",
      acceptedFrameIds,
      latestFrame: event.frame,
      // A newer frame invalidates image-load and geometry readiness from every
      // older frame, even inside the same session/side epoch.
      imageReadyFrameId: undefined,
      geometryFrameId: undefined,
    };
  }
  if (event.type === "image_loaded") {
    if (current.latestFrame?.frameId !== event.frame.frameId) return current;
    return { ...current, imageReadyFrameId: event.frame.frameId };
  }
  if (!event.sourceFrameId || current.latestFrame?.frameId !== event.sourceFrameId) return current;
  return { ...current, geometryFrameId: event.sourceFrameId };
}

export function aiGraderPreviewManualCaptureReady(state: AiGraderPreviewEpochState) {
  return state.phase === "live" && Boolean(
    state.binding &&
    state.latestFrame &&
    state.imageReadyFrameId &&
    state.imageReadyFrameId === state.latestFrame.frameId &&
    aiGraderPreviewFrameMatchesEpoch(state.latestFrame, state.binding)
  );
}

export function aiGraderPreviewDetectedCaptureReady(state: AiGraderPreviewEpochState) {
  return aiGraderPreviewManualCaptureReady(state) && Boolean(
    state.latestFrame && state.geometryFrameId === state.latestFrame.frameId
  );
}

export function isAiGraderPreviewReconnectEligible(input: AiGraderPreviewEligibilityInput) {
  return input.connected &&
    input.hasStationToken &&
    input.mounted &&
    !input.aborted &&
    !input.captureActionActive &&
    !input.captureLockHeld &&
    !input.runnerCapturing &&
    !input.previewHoldActive &&
    !input.queueReviewActive &&
    !input.terminalOrSafeOff;
}

export function createAiGraderPreviewReconnectState(): AiGraderPreviewReconnectState {
  return { readerActive: false, retryScheduled: false, consecutiveFailures: 0, exhausted: false };
}

export function beginAiGraderPreviewReader(
  current: AiGraderPreviewReconnectState,
  eligible: boolean
): AiGraderPreviewReconnectDecision {
  if (!eligible || current.readerActive || current.retryScheduled || current.exhausted) {
    return { state: current, startReader: false };
  }
  return {
    state: { ...current, readerActive: true },
    startReader: true,
  };
}

export function noteAiGraderPreviewFrameForReconnect(
  current: AiGraderPreviewReconnectState
): AiGraderPreviewReconnectState {
  return { ...current, consecutiveFailures: 0, exhausted: false };
}

export function finishAiGraderPreviewReader(input: {
  state: AiGraderPreviewReconnectState;
  eligible: boolean;
  reason: "eof" | "error" | "abort" | "authoritative_state";
}): AiGraderPreviewReconnectDecision {
  const inactive = { ...input.state, readerActive: false };
  if (!input.eligible || input.reason === "abort" || input.reason === "authoritative_state") {
    return { state: { ...inactive, retryScheduled: false }, startReader: false };
  }
  const consecutiveFailures = inactive.consecutiveFailures + 1;
  if (consecutiveFailures > AI_GRADER_PREVIEW_MAX_CONSECUTIVE_RECONNECTS) {
    return {
      state: { ...inactive, consecutiveFailures, retryScheduled: false, exhausted: true },
      startReader: false,
    };
  }
  const reconnectDelayMs = AI_GRADER_PREVIEW_RECONNECT_DELAYS_MS[
    Math.min(consecutiveFailures - 1, AI_GRADER_PREVIEW_RECONNECT_DELAYS_MS.length - 1)
  ];
  return {
    state: { ...inactive, consecutiveFailures, retryScheduled: true, exhausted: false },
    startReader: false,
    reconnectDelayMs,
  };
}

export function releaseAiGraderPreviewReconnectTimer(
  current: AiGraderPreviewReconnectState
): AiGraderPreviewReconnectState {
  return { ...current, retryScheduled: false };
}
