import type {
  AiGraderLiveLightingStatus,
  AiGraderLocalStationPreviewStatus,
  AiGraderPreviewCardGeometrySummary,
  AiGraderPreviewGeometrySide,
} from "./aiGraderLocalStation";

export const AI_GRADER_PREVIEW_RECONNECT_DELAYS_MS = [250, 500, 1000, 2000] as const;
export const AI_GRADER_PREVIEW_MAX_CONSECUTIVE_RECONNECTS = 5;
export const AI_GRADER_PREVIEW_SNAPSHOT_LIMIT = 8;
export const AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS = 2000;
export const AI_GRADER_INTENTIONAL_TRANSITION_MAX_AGE_MS = 10_000;

export type AiGraderPreviewEpochBinding = {
  sessionId: string;
  side: AiGraderPreviewGeometrySide;
  sideEpoch: string;
};

export type AiGraderPreviewFrameBinding = AiGraderPreviewEpochBinding & {
  frameId: string;
};

export type AiGraderPreviewSnapshot = {
  frame: AiGraderPreviewFrameBinding;
  objectUrl: string;
  receivedAtMs: number;
  capturedAtMs?: number;
  imageLoaded: boolean;
  imageWidth?: number;
  imageHeight?: number;
  geometry?: AiGraderPreviewCardGeometrySummary;
  geometryObservedAtMs?: number;
};

export type AiGraderPreviewEpochState = {
  binding?: AiGraderPreviewEpochBinding;
  phase: AiGraderLocalStationPreviewStatus["status"];
  snapshots: AiGraderPreviewSnapshot[];
  displayedFrameId?: string;
};

export type AiGraderPreviewEpochEvent =
  | { type: "bind"; binding?: AiGraderPreviewEpochBinding }
  | { type: "opened"; binding: AiGraderPreviewEpochBinding }
  | {
      type: "frame";
      frame: AiGraderPreviewFrameBinding;
      objectUrl: string;
      receivedAtMs: number;
      capturedAt?: string;
    }
  | {
      type: "image_loaded";
      frame: AiGraderPreviewFrameBinding;
      loadedAtMs: number;
      width: number;
      height: number;
    }
  | {
      type: "geometry";
      binding: AiGraderPreviewEpochBinding;
      geometry?: AiGraderPreviewCardGeometrySummary;
      observedAtMs: number;
    }
  | { type: "tick"; nowMs: number }
  | { type: "clear"; status?: AiGraderLocalStationPreviewStatus["status"] }
  | { type: "non_live"; status: Exclude<AiGraderLocalStationPreviewStatus["status"], "live"> };

export type AiGraderPreviewEpochTransition = {
  state: AiGraderPreviewEpochState;
  revokeObjectUrls: string[];
  accepted: boolean;
};

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

export type AiGraderBackPositioningRetryUiState = {
  status: "idle" | "retrying" | "waiting_for_frame" | "ready" | "error";
  message?: string;
};

export type AiGraderBackPositioningRetryUiEvent =
  | { type: "reset"; backPositioningActive: boolean }
  | { type: "retry_started" }
  | { type: "retry_failed"; message?: string }
  | {
      type: "restore_completed";
      bridgeCaptureReady: boolean;
      physicallyVerified: boolean;
      postVerificationFrameReady: boolean;
    }
  | { type: "fresh_frame_ready" };

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

export type AiGraderLocalBackCaptureIntent = {
  binding: AiGraderPreviewEpochBinding & { side: "back" };
  frameId: string;
};

export type AiGraderIntentionalBackCaptureEofInput = {
  expectedBinding: AiGraderPreviewEpochBinding & { side: "back" };
  localIntent?: AiGraderLocalBackCaptureIntent | null;
  authoritativeBinding?: AiGraderPreviewEpochBinding;
  bridgeIntent?: {
    active: boolean;
    kind?: "capture_back";
    sessionId?: string;
    side?: "back";
    sideEpoch?: string;
    frameId?: string;
    completedAt?: string;
    outcome?: "capture_started" | "transition_failed";
  };
  nowMs?: number;
};

export type AiGraderPreviewReaderEndReason =
  | "eof"
  | "error"
  | "abort"
  | "authoritative_state"
  | "intentional_capture_transition";

export type AiGraderPreviewLossDisposition = {
  safeOff: boolean;
  reconnect: boolean;
  preserveLocalIntent: boolean;
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

export function aiGraderPreviewBindingChanged(
  current?: AiGraderPreviewEpochBinding,
  next?: AiGraderPreviewEpochBinding,
) {
  if (!current && !next) return false;
  return !aiGraderPreviewBindingMatches(current, next);
}

export function projectAiGraderPreviewLossSafeOffPending(
  current: AiGraderLiveLightingStatus,
  nowMs = Date.now(),
): AiGraderLiveLightingStatus {
  const { enabled: _enabled, verifiedAt: _appliedVerifiedAt, ...previousApplied } = current.applied;
  const { verifiedAt: _physicalVerifiedAt, lastError: _lastError, ...previousPhysicalState } = current.physicalState;
  const expectedWriteCount = 0;
  return {
    ...current,
    status: "applying",
    applied: {
      ...previousApplied,
      verificationState: "pending",
      expectedWriteCount,
      acknowledgedWriteCount: 0,
      verificationComplete: false,
    },
    physicalState: {
      ...previousPhysicalState,
      state: "safe_off_pending",
      reason: "Preview-loss safe-off acknowledgement is pending.",
      changedAt: new Date(nowMs).toISOString(),
      expectedWriteCount,
      acknowledgedWriteCount: 0,
      complete: false,
    },
    connection: { ...current.connection, state: "writing" },
    ...(current.backPositioning ? {
      backPositioning: {
        ...current.backPositioning,
        captureReady: false,
      },
    } : {}),
  };
}

export function projectAiGraderPreviewLossPhysicalStateUnknown(
  current: AiGraderLiveLightingStatus,
  nowMs = Date.now(),
): AiGraderLiveLightingStatus {
  const { enabled: _enabled, verifiedAt: _appliedVerifiedAt, ...previousApplied } = current.applied;
  const { verifiedAt: _physicalVerifiedAt, ...previousPhysicalState } = current.physicalState;
  const expectedWriteCount = 0;
  const message = "Preview-loss safe-off was not acknowledged; physical light state is unknown.";
  return {
    ...current,
    status: "error",
    applied: {
      ...previousApplied,
      verificationState: "unknown",
      expectedWriteCount,
      acknowledgedWriteCount: 0,
      verificationComplete: false,
    },
    physicalState: {
      ...previousPhysicalState,
      state: "physical_state_unknown",
      reason: message,
      changedAt: new Date(nowMs).toISOString(),
      expectedWriteCount,
      acknowledgedWriteCount: 0,
      complete: false,
      lastError: message,
    },
    connection: { ...current.connection, state: "error" },
    ...(current.backPositioning ? {
      backPositioning: {
        ...current.backPositioning,
        status: "failed",
        captureReady: false,
        lastError: {
          code: "PHYSICAL_STATE_UNKNOWN",
          message,
        },
      },
    } : {}),
  };
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
  frameIds: readonly string[];
  observedAtMs: number;
}) {
  const { geometry, binding, frameIds, observedAtMs } = input;
  if (!geometry || !binding || !geometry.sourceFrameId || !geometry.timestamp) return false;
  if (!Number.isFinite(observedAtMs)) return false;
  const timestampMs = Date.parse(geometry.timestamp);
  if (!Number.isFinite(timestampMs) || timestampMs > observedAtMs) return false;
  if (observedAtMs - timestampMs > AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS) return false;
  return geometry.sessionId === binding.sessionId &&
    geometry.side === binding.side &&
    geometry.sideEpoch === binding.sideEpoch &&
    frameIds.includes(geometry.sourceFrameId);
}

export function createAiGraderPreviewEpochState(
  binding?: AiGraderPreviewEpochBinding
): AiGraderPreviewEpochState {
  return {
    ...(binding ? { binding: { ...binding } } : {}),
    phase: binding ? "starting" : "not_started",
    snapshots: [],
  };
}

function uniqueUrls(urls: readonly string[]) {
  return Array.from(new Set(urls.filter(Boolean)));
}

function snapshotIsFresh(snapshot: AiGraderPreviewSnapshot, nowMs: number) {
  const capturedAtMs = snapshot.capturedAtMs;
  return typeof capturedAtMs === "number" &&
    Number.isFinite(capturedAtMs) &&
    Number.isFinite(snapshot.receivedAtMs) &&
    capturedAtMs <= snapshot.receivedAtMs &&
    snapshot.receivedAtMs - capturedAtMs <= AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS &&
    nowMs >= snapshot.receivedAtMs &&
    nowMs >= capturedAtMs &&
    nowMs - snapshot.receivedAtMs <= AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS &&
    nowMs - capturedAtMs <= AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS;
}

function snapshotHasExactGeometry(snapshot: AiGraderPreviewSnapshot) {
  const geometry = snapshot.geometry;
  return Boolean(
    snapshot.imageLoaded &&
    geometry?.sourceFrameId === snapshot.frame.frameId &&
    geometry.sessionId === snapshot.frame.sessionId &&
    geometry.side === snapshot.frame.side &&
    geometry.sideEpoch === snapshot.frame.sideEpoch
  );
}

function snapshotGeometryIsFresh(snapshot: AiGraderPreviewSnapshot, nowMs: number) {
  const timestampMs = Date.parse(snapshot.geometry?.timestamp ?? "");
  return Number.isFinite(timestampMs) &&
    timestampMs <= nowMs &&
    nowMs - timestampMs <= AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS;
}

function chooseDisplayedFrameId(
  snapshots: readonly AiGraderPreviewSnapshot[],
  currentDisplayedFrameId?: string,
) {
  const currentIndex = currentDisplayedFrameId
    ? snapshots.findIndex((snapshot) => snapshot.frame.frameId === currentDisplayedFrameId)
    : -1;
  const current = currentIndex >= 0 ? snapshots[currentIndex] : undefined;
  let newestExactIndex = -1;
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (snapshotHasExactGeometry(snapshots[index])) {
      newestExactIndex = index;
      break;
    }
  }
  if (current && snapshotHasExactGeometry(current)) {
    return newestExactIndex > currentIndex
      ? snapshots[newestExactIndex].frame.frameId
      : current.frame.frameId;
  }
  if (newestExactIndex >= 0) return snapshots[newestExactIndex].frame.frameId;
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (snapshots[index].imageLoaded) return snapshots[index].frame.frameId;
  }
  return undefined;
}

function pruneSnapshots(
  snapshots: readonly AiGraderPreviewSnapshot[],
  nowMs: number,
  limit = AI_GRADER_PREVIEW_SNAPSHOT_LIMIT,
) {
  const fresh = snapshots.filter((snapshot) => snapshotIsFresh(snapshot, nowMs));
  const kept = fresh.slice(-limit);
  const keptUrls = new Set(kept.map((snapshot) => snapshot.objectUrl));
  return {
    snapshots: kept,
    revokeObjectUrls: uniqueUrls(
      snapshots
        .filter((snapshot) => !keptUrls.has(snapshot.objectUrl))
        .map((snapshot) => snapshot.objectUrl),
    ),
  };
}

function clearEpochState(
  current: AiGraderPreviewEpochState,
  status: AiGraderLocalStationPreviewStatus["status"],
  binding = current.binding,
): AiGraderPreviewEpochTransition {
  return {
    state: {
      ...(binding ? { binding: { ...binding } } : {}),
      phase: status,
      snapshots: [],
    },
    revokeObjectUrls: uniqueUrls(current.snapshots.map((snapshot) => snapshot.objectUrl)),
    accepted: true,
  };
}

export function transitionAiGraderPreviewEpoch(
  current: AiGraderPreviewEpochState,
  event: AiGraderPreviewEpochEvent
): AiGraderPreviewEpochTransition {
  if (event.type === "bind") {
    if (aiGraderPreviewBindingMatches(current.binding, event.binding)) {
      return { state: current, revokeObjectUrls: [], accepted: false };
    }
    return {
      state: createAiGraderPreviewEpochState(event.binding),
      revokeObjectUrls: uniqueUrls(current.snapshots.map((snapshot) => snapshot.objectUrl)),
      accepted: true,
    };
  }
  if (event.type === "non_live") {
    return clearEpochState(current, event.status);
  }
  if (event.type === "clear") {
    return clearEpochState(current, event.status ?? (current.binding ? "starting" : "not_started"));
  }
  if (event.type === "tick") {
    const pruned = pruneSnapshots(current.snapshots, event.nowMs);
    const displayedFrameId = chooseDisplayedFrameId(pruned.snapshots, current.displayedFrameId);
    return {
      state: { ...current, snapshots: pruned.snapshots, displayedFrameId },
      revokeObjectUrls: pruned.revokeObjectUrls,
      accepted: pruned.revokeObjectUrls.length > 0 || displayedFrameId !== current.displayedFrameId,
    };
  }
  const eventBinding = event.type === "frame" || event.type === "image_loaded" ? event.frame : event.binding;
  if (!aiGraderPreviewBindingMatches(current.binding, eventBinding)) {
    return {
      state: current,
      revokeObjectUrls: event.type === "frame" ? [event.objectUrl] : [],
      accepted: false,
    };
  }
  if (event.type === "opened") {
    return {
      state: { ...current, phase: current.snapshots.length ? current.phase : "starting" },
      revokeObjectUrls: [],
      accepted: true,
    };
  }
  if (event.type === "frame") {
    const capturedAtMs = Date.parse(event.capturedAt ?? "");
    if (
      !Number.isFinite(event.receivedAtMs) ||
      !Number.isFinite(capturedAtMs) ||
      capturedAtMs > event.receivedAtMs ||
      event.receivedAtMs - capturedAtMs > AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS
    ) {
      return { state: current, revokeObjectUrls: [event.objectUrl], accepted: false };
    }
    const previous = current.snapshots.find((snapshot) => snapshot.frame.frameId === event.frame.frameId);
    const withoutDuplicate = current.snapshots.filter((snapshot) => snapshot.frame.frameId !== event.frame.frameId);
    const nextSnapshot: AiGraderPreviewSnapshot = {
      frame: { ...event.frame },
      objectUrl: event.objectUrl,
      receivedAtMs: event.receivedAtMs,
      capturedAtMs,
      imageLoaded: false,
    };
    const pruned = pruneSnapshots([...withoutDuplicate, nextSnapshot], event.receivedAtMs);
    const replacedUrl = previous && previous.objectUrl !== event.objectUrl ? previous.objectUrl : undefined;
    return {
      state: {
        ...current,
        phase: "live",
        snapshots: pruned.snapshots,
        displayedFrameId: chooseDisplayedFrameId(pruned.snapshots, current.displayedFrameId),
      },
      revokeObjectUrls: uniqueUrls([...pruned.revokeObjectUrls, ...(replacedUrl ? [replacedUrl] : [])]),
      accepted: true,
    };
  }
  if (event.type === "image_loaded") {
    if (!Number.isFinite(event.loadedAtMs) || event.width <= 0 || event.height <= 0) {
      return { state: current, revokeObjectUrls: [], accepted: false };
    }
    const pruned = pruneSnapshots(current.snapshots, event.loadedAtMs);
    let found = false;
    const snapshots = pruned.snapshots.map((snapshot) => {
      if (snapshot.frame.frameId !== event.frame.frameId) return snapshot;
      found = true;
      return { ...snapshot, imageLoaded: true, imageWidth: event.width, imageHeight: event.height };
    });
    const displayedFrameId = chooseDisplayedFrameId(snapshots, current.displayedFrameId);
    return {
      state: { ...current, snapshots, displayedFrameId },
      revokeObjectUrls: pruned.revokeObjectUrls,
      accepted: found,
    };
  }
  const geometry = event.geometry;
  if (!geometry || !aiGraderPreviewGeometryMatchesEpoch({
    geometry,
    binding: current.binding,
    frameIds: current.snapshots.map((snapshot) => snapshot.frame.frameId),
    observedAtMs: event.observedAtMs,
  })) {
    return { state: current, revokeObjectUrls: [], accepted: false };
  }
  const pruned = pruneSnapshots(current.snapshots, event.observedAtMs);
  let found = false;
  const snapshots = pruned.snapshots.map((snapshot) => {
    if (snapshot.frame.frameId !== geometry.sourceFrameId) return snapshot;
    found = true;
    return { ...snapshot, geometry: { ...geometry }, geometryObservedAtMs: event.observedAtMs };
  });
  const displayedFrameId = chooseDisplayedFrameId(snapshots, current.displayedFrameId);
  return {
    state: { ...current, snapshots, displayedFrameId },
    revokeObjectUrls: pruned.revokeObjectUrls,
    accepted: found,
  };
}

export function aiGraderPreviewDisplayedSnapshot(state: AiGraderPreviewEpochState) {
  return state.displayedFrameId
    ? state.snapshots.find((snapshot) => snapshot.frame.frameId === state.displayedFrameId)
    : undefined;
}

export function aiGraderPreviewManualCaptureReady(
  state: AiGraderPreviewEpochState,
  nowMs = Date.now(),
) {
  const displayed = aiGraderPreviewDisplayedSnapshot(state);
  return state.phase === "live" && Boolean(
    state.binding &&
    displayed &&
    snapshotIsFresh(displayed, nowMs) &&
    snapshotHasExactGeometry(displayed) &&
    snapshotGeometryIsFresh(displayed, nowMs) &&
    aiGraderPreviewFrameMatchesEpoch(displayed.frame, state.binding)
  );
}

export function aiGraderPreviewDetectedCaptureReady(
  state: AiGraderPreviewEpochState,
  nowMs = Date.now(),
) {
  const displayed = aiGraderPreviewDisplayedSnapshot(state);
  return aiGraderPreviewManualCaptureReady(state, nowMs) && Boolean(
    displayed?.geometry?.placementState === "ready" &&
    displayed.geometry.geometrySource === "detected" &&
    displayed.geometry.detectionUsed === true
  );
}

export function aiGraderPreviewSnapshotCapturedAtOrAfterVerification(input: {
  snapshot?: AiGraderPreviewSnapshot;
  verifiedAt?: string;
}) {
  const capturedAtMs = input.snapshot?.capturedAtMs;
  const receivedAtMs = input.snapshot?.receivedAtMs;
  const verifiedAtMs = Date.parse(input.verifiedAt ?? "");
  return typeof capturedAtMs === "number" &&
    typeof receivedAtMs === "number" &&
    Number.isFinite(capturedAtMs) &&
    Number.isFinite(receivedAtMs) &&
    Number.isFinite(verifiedAtMs) &&
    capturedAtMs <= receivedAtMs &&
    capturedAtMs >= verifiedAtMs;
}

export function aiGraderPreviewBackCaptureReady(input: {
  state: AiGraderPreviewEpochState;
  mode: "detected_geometry" | "manual_capture";
  positioningVerifiedAt?: string;
  nowMs?: number;
}) {
  if (input.state.binding?.side !== "back") return false;
  const nowMs = input.nowMs ?? Date.now();
  const baseReady = input.mode === "manual_capture"
    ? aiGraderPreviewManualCaptureReady(input.state, nowMs)
    : aiGraderPreviewDetectedCaptureReady(input.state, nowMs);
  return baseReady && aiGraderPreviewSnapshotCapturedAtOrAfterVerification({
    snapshot: aiGraderPreviewDisplayedSnapshot(input.state),
    verifiedAt: input.positioningVerifiedAt,
  });
}

export function isAiGraderBackPositioningRetryReady(input: {
  state: AiGraderPreviewEpochState;
  positioningPhysicallyVerified: boolean;
  positioningVerifiedAt?: string;
  nowMs?: number;
}) {
  return input.positioningPhysicallyVerified && aiGraderPreviewBackCaptureReady({
    state: input.state,
    mode: "manual_capture",
    positioningVerifiedAt: input.positioningVerifiedAt,
    nowMs: input.nowMs,
  });
}

export function shouldStartAiGraderBackPositioningRetry(input: {
  state: AiGraderPreviewEpochState;
  positioningPhysicallyVerified: boolean;
  positioningVerifiedAt?: string;
  nowMs?: number;
}) {
  return !isAiGraderBackPositioningRetryReady(input);
}

export function reduceAiGraderBackPositioningRetryUiState(
  current: AiGraderBackPositioningRetryUiState,
  event: AiGraderBackPositioningRetryUiEvent,
): AiGraderBackPositioningRetryUiState {
  if (event.type === "reset") {
    return event.backPositioningActive
      ? { status: "waiting_for_frame", message: "Waiting for positioning light and a fresh back preview frame." }
      : { status: "idle" };
  }
  if (event.type === "retry_started") {
    return { status: "retrying", message: "Restoring the accepted positioning profile." };
  }
  if (event.type === "retry_failed") {
    return { status: "error", message: event.message ?? "Positioning light restore failed safely." };
  }
  if (event.type === "fresh_frame_ready") {
    return current.status === "idle"
      ? current
      : { status: "ready", message: "Positioning light and fresh back preview are ready." };
  }
  if (!event.physicallyVerified) {
    return { status: "error", message: "Positioning light restore did not reach a verified physical state." };
  }
  return event.bridgeCaptureReady && event.postVerificationFrameReady
    ? { status: "ready", message: "Positioning light and fresh back preview are ready." }
    : { status: "waiting_for_frame", message: "Positioning light restored. Waiting for a fresh back preview frame." };
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

export function aiGraderLocalBackCaptureIntentMatches(input: {
  expectedBinding: AiGraderPreviewEpochBinding;
  localIntent?: AiGraderLocalBackCaptureIntent | null;
}) {
  return input.expectedBinding.side === "back" && Boolean(
    input.localIntent &&
    aiGraderPreviewBindingMatches(input.localIntent.binding, input.expectedBinding) &&
    safePreviewId(input.localIntent.frameId)
  );
}

function bridgeBackCaptureIntentMatches(input: AiGraderIntentionalBackCaptureEofInput) {
  const localIntent = input.localIntent;
  const bridgeIntent = input.bridgeIntent;
  return Boolean(
    localIntent &&
    bridgeIntent &&
    aiGraderLocalBackCaptureIntentMatches({ expectedBinding: input.expectedBinding, localIntent }) &&
    aiGraderPreviewBindingMatches(input.authoritativeBinding, input.expectedBinding) &&
    bridgeIntent.kind === "capture_back" &&
    bridgeIntent.sessionId === input.expectedBinding.sessionId &&
    bridgeIntent.side === "back" &&
    bridgeIntent.sideEpoch === input.expectedBinding.sideEpoch &&
    bridgeIntent.frameId === localIntent.frameId
  );
}

function completedBridgeIntentIsCurrent(input: AiGraderIntentionalBackCaptureEofInput) {
  const completedAtMs = Date.parse(input.bridgeIntent?.completedAt ?? "");
  const ageMs = (input.nowMs ?? Date.now()) - completedAtMs;
  return Number.isFinite(completedAtMs) &&
    ageMs >= 0 &&
    ageMs <= AI_GRADER_INTENTIONAL_TRANSITION_MAX_AGE_MS;
}

export function isAiGraderIntentionalBackCaptureEof(input: AiGraderIntentionalBackCaptureEofInput) {
  const bridgeIntent = input.bridgeIntent;
  if (!bridgeIntent || !bridgeBackCaptureIntentMatches(input)) return false;
  if (bridgeIntent.active === true) return true;
  return bridgeIntent.outcome === "capture_started" && completedBridgeIntentIsCurrent(input);
}

export function isAiGraderConfirmedBackCaptureTransitionFailure(
  input: AiGraderIntentionalBackCaptureEofInput,
) {
  return input.bridgeIntent?.active === false &&
    input.bridgeIntent.outcome === "transition_failed" &&
    bridgeBackCaptureIntentMatches(input) &&
    completedBridgeIntentIsCurrent(input);
}

export function aiGraderPreviewLossDisposition(input: {
  reason: AiGraderPreviewReaderEndReason;
  expectedBinding: AiGraderPreviewEpochBinding;
  localIntent?: AiGraderLocalBackCaptureIntent | null;
  atomicTransitionFailureConfirmed?: boolean;
  reconnectEligible: boolean;
}): AiGraderPreviewLossDisposition {
  if (input.reason !== "eof" && input.reason !== "error") {
    return { safeOff: false, reconnect: false, preserveLocalIntent: false };
  }
  if (input.atomicTransitionFailureConfirmed) {
    return { safeOff: false, reconnect: input.reconnectEligible, preserveLocalIntent: false };
  }
  if (aiGraderLocalBackCaptureIntentMatches({
    expectedBinding: input.expectedBinding,
    localIntent: input.localIntent,
  })) {
    return { safeOff: false, reconnect: false, preserveLocalIntent: true };
  }
  return { safeOff: true, reconnect: input.reconnectEligible, preserveLocalIntent: false };
}

export async function runAiGraderPreviewLossRecovery(input: {
  reason: AiGraderPreviewReaderEndReason;
  expectedBinding: AiGraderPreviewEpochBinding;
  localIntent?: AiGraderLocalBackCaptureIntent | null;
  atomicTransitionFailureConfirmed?: boolean;
  reconnectEligible: boolean;
}, operations: {
  safeOff: () => Promise<void>;
  reconnect: () => void | Promise<void>;
}) {
  const disposition = aiGraderPreviewLossDisposition(input);
  if (disposition.safeOff) await operations.safeOff();
  if (disposition.reconnect) await operations.reconnect();
  return disposition;
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
  reason: "eof" | "error" | "abort" | "authoritative_state" | "intentional_capture_transition";
}): AiGraderPreviewReconnectDecision {
  const inactive = { ...input.state, readerActive: false };
  if (
    !input.eligible ||
    input.reason === "abort" ||
    input.reason === "authoritative_state" ||
    input.reason === "intentional_capture_transition"
  ) {
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
