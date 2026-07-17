import type {
  AiGraderLocalStationPreviewStatus,
  AiGraderPreviewCardGeometrySummary,
  AiGraderPreviewGeometrySide,
} from "./aiGraderLocalStation";

export const AI_GRADER_PREVIEW_SNAPSHOT_LIMIT = 8;
export const AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS = 2000;

export type AiGraderPreviewEpochBinding = {
  sessionId: string;
  side: AiGraderPreviewGeometrySide;
  sideEpoch: string;
};

export type AiGraderPreviewFrameBinding = AiGraderPreviewEpochBinding & { frameId: string };

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
  | { type: "frame"; frame: AiGraderPreviewFrameBinding; objectUrl: string; receivedAtMs: number; capturedAt?: string }
  | { type: "image_loaded"; frame: AiGraderPreviewFrameBinding; loadedAtMs: number; width: number; height: number }
  | { type: "geometry"; binding: AiGraderPreviewEpochBinding; geometry?: AiGraderPreviewCardGeometrySummary; observedAtMs: number }
  | { type: "tick"; nowMs: number }
  | { type: "clear"; status?: AiGraderLocalStationPreviewStatus["status"] }
  | { type: "non_live"; status: Exclude<AiGraderLocalStationPreviewStatus["status"], "live"> };

export type AiGraderPreviewEpochTransition = {
  state: AiGraderPreviewEpochState;
  revokeObjectUrls: string[];
  accepted: boolean;
};

const SAFE_PREVIEW_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function safePreviewId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!SAFE_PREVIEW_ID.test(trimmed) || /token|secret|bearer|presign|x-amz|localhost/i.test(trimmed)) return undefined;
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
  status: Pick<AiGraderLocalStationPreviewStatus, "sessionId" | "activeSide" | "sideEpoch">,
): AiGraderPreviewEpochBinding | undefined {
  return sanitizeAiGraderPreviewEpochBinding({ sessionId: status.sessionId, side: status.activeSide, sideEpoch: status.sideEpoch });
}

export function aiGraderPreviewBindingMatches(left?: AiGraderPreviewEpochBinding, right?: AiGraderPreviewEpochBinding) {
  return Boolean(left && right && left.sessionId === right.sessionId && left.side === right.side && left.sideEpoch === right.sideEpoch);
}

export function aiGraderPreviewBindingChanged(current?: AiGraderPreviewEpochBinding, next?: AiGraderPreviewEpochBinding) {
  if (!current && !next) return false;
  return !aiGraderPreviewBindingMatches(current, next);
}

function frameMatches(frame: AiGraderPreviewFrameBinding, binding?: AiGraderPreviewEpochBinding) {
  return Boolean(binding && aiGraderPreviewBindingMatches(frame, binding));
}

function geometryMatches(geometry: AiGraderPreviewCardGeometrySummary, binding: AiGraderPreviewEpochBinding | undefined, frameIds: string[]) {
  return Boolean(
    binding && geometry.sessionId === binding.sessionId && geometry.side === binding.side &&
    geometry.sideEpoch === binding.sideEpoch && geometry.sourceFrameId && frameIds.includes(geometry.sourceFrameId),
  );
}

export function createAiGraderPreviewEpochState(binding?: AiGraderPreviewEpochBinding): AiGraderPreviewEpochState {
  return { ...(binding ? { binding: { ...binding } } : {}), phase: binding ? "starting" : "not_started", snapshots: [] };
}

function uniqueUrls(urls: readonly string[]) {
  return Array.from(new Set(urls.filter(Boolean)));
}

function snapshotIsFresh(snapshot: AiGraderPreviewSnapshot, nowMs: number) {
  return typeof snapshot.capturedAtMs === "number" && Number.isFinite(snapshot.receivedAtMs) &&
    snapshot.capturedAtMs <= snapshot.receivedAtMs && snapshot.receivedAtMs - snapshot.capturedAtMs <= AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS &&
    nowMs >= snapshot.receivedAtMs && nowMs - snapshot.receivedAtMs <= AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS;
}

function snapshotHasExactGeometry(snapshot: AiGraderPreviewSnapshot) {
  const geometry = snapshot.geometry;
  return Boolean(snapshot.imageLoaded && geometry?.sourceFrameId === snapshot.frame.frameId &&
    geometry.sessionId === snapshot.frame.sessionId && geometry.side === snapshot.frame.side &&
    geometry.sideEpoch === snapshot.frame.sideEpoch);
}

function chooseDisplayed(snapshots: AiGraderPreviewSnapshot[]) {
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (snapshotHasExactGeometry(snapshots[index])) return snapshots[index].frame.frameId;
  }
  return snapshots.slice().reverse().find((snapshot) => snapshot.imageLoaded)?.frame.frameId;
}

function prune(snapshots: AiGraderPreviewSnapshot[], nowMs: number) {
  const kept = snapshots.filter((snapshot) => snapshotIsFresh(snapshot, nowMs)).slice(-AI_GRADER_PREVIEW_SNAPSHOT_LIMIT);
  const keptUrls = new Set(kept.map((snapshot) => snapshot.objectUrl));
  return { snapshots: kept, revokeObjectUrls: uniqueUrls(snapshots.filter((snapshot) => !keptUrls.has(snapshot.objectUrl)).map((snapshot) => snapshot.objectUrl)) };
}

export function transitionAiGraderPreviewEpoch(current: AiGraderPreviewEpochState, event: AiGraderPreviewEpochEvent): AiGraderPreviewEpochTransition {
  if (event.type === "bind") {
    if (aiGraderPreviewBindingMatches(current.binding, event.binding)) return { state: current, revokeObjectUrls: [], accepted: false };
    return { state: createAiGraderPreviewEpochState(event.binding), revokeObjectUrls: current.snapshots.map((s) => s.objectUrl), accepted: true };
  }
  if (event.type === "clear" || event.type === "non_live") {
    const phase = event.type === "clear" ? (event.status ?? (current.binding ? "starting" : "not_started")) : event.status;
    return { state: { ...(current.binding ? { binding: current.binding } : {}), phase, snapshots: [] }, revokeObjectUrls: current.snapshots.map((s) => s.objectUrl), accepted: true };
  }
  if (event.type === "tick") {
    const result = prune(current.snapshots, event.nowMs);
    return { state: { ...current, snapshots: result.snapshots, displayedFrameId: chooseDisplayed(result.snapshots) }, revokeObjectUrls: result.revokeObjectUrls, accepted: true };
  }
  const eventBinding = event.type === "frame" || event.type === "image_loaded" ? event.frame : event.binding;
  if (!aiGraderPreviewBindingMatches(current.binding, eventBinding)) {
    return { state: current, revokeObjectUrls: event.type === "frame" ? [event.objectUrl] : [], accepted: false };
  }
  if (event.type === "opened") return { state: { ...current, phase: "starting" }, revokeObjectUrls: [], accepted: true };
  if (event.type === "frame") {
    const capturedAtMs = Date.parse(event.capturedAt ?? "");
    if (!Number.isFinite(capturedAtMs) || capturedAtMs > event.receivedAtMs || event.receivedAtMs - capturedAtMs > AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS) {
      return { state: current, revokeObjectUrls: [event.objectUrl], accepted: false };
    }
    const old = current.snapshots.find((snapshot) => snapshot.frame.frameId === event.frame.frameId);
    const next = [...current.snapshots.filter((snapshot) => snapshot.frame.frameId !== event.frame.frameId), {
      frame: event.frame, objectUrl: event.objectUrl, receivedAtMs: event.receivedAtMs, capturedAtMs, imageLoaded: false,
    }];
    const result = prune(next, event.receivedAtMs);
    return { state: { ...current, phase: "live", snapshots: result.snapshots, displayedFrameId: chooseDisplayed(result.snapshots) }, revokeObjectUrls: uniqueUrls([...result.revokeObjectUrls, ...(old && old.objectUrl !== event.objectUrl ? [old.objectUrl] : [])]), accepted: true };
  }
  if (event.type === "image_loaded") {
    let found = false;
    const snapshots = current.snapshots.map((snapshot) => {
      if (snapshot.frame.frameId !== event.frame.frameId) return snapshot;
      found = true;
      return { ...snapshot, imageLoaded: true, imageWidth: event.width, imageHeight: event.height };
    });
    return { state: { ...current, snapshots, displayedFrameId: chooseDisplayed(snapshots) }, revokeObjectUrls: [], accepted: found };
  }
  if (!event.geometry || !geometryMatches(event.geometry, current.binding, current.snapshots.map((s) => s.frame.frameId))) {
    return { state: current, revokeObjectUrls: [], accepted: false };
  }
  let found = false;
  const snapshots = current.snapshots.map((snapshot) => {
    if (snapshot.frame.frameId !== event.geometry?.sourceFrameId) return snapshot;
    found = true;
    return { ...snapshot, geometry: event.geometry, geometryObservedAtMs: event.observedAtMs };
  });
  return { state: { ...current, snapshots, displayedFrameId: chooseDisplayed(snapshots) }, revokeObjectUrls: [], accepted: found };
}

export function aiGraderPreviewDisplayedSnapshot(state: AiGraderPreviewEpochState) {
  return state.displayedFrameId ? state.snapshots.find((snapshot) => snapshot.frame.frameId === state.displayedFrameId) : undefined;
}

export function aiGraderPreviewDetectedCaptureReady(state: AiGraderPreviewEpochState, nowMs = Date.now()) {
  const displayed = aiGraderPreviewDisplayedSnapshot(state);
  const geometryTime = Date.parse(displayed?.geometry?.timestamp ?? "");
  return state.phase === "live" && Boolean(displayed && snapshotIsFresh(displayed, nowMs) && snapshotHasExactGeometry(displayed) &&
    Number.isFinite(geometryTime) && nowMs - geometryTime <= AI_GRADER_PREVIEW_SNAPSHOT_MAX_AGE_MS &&
    frameMatches(displayed.frame, state.binding) && displayed.geometry?.placementState === "ready" &&
    displayed.geometry.geometrySource === "detected" && displayed.geometry.detectionUsed === true);
}

export function aiGraderPreviewBackCaptureReady(input: {
  state: AiGraderPreviewEpochState;
  mode: "detected_geometry";
  positioningVerifiedAt?: string;
  nowMs?: number;
}) {
  if (input.state.binding?.side !== "back" || !aiGraderPreviewDetectedCaptureReady(input.state, input.nowMs ?? Date.now())) return false;
  const capturedAtMs = aiGraderPreviewDisplayedSnapshot(input.state)?.capturedAtMs;
  const verifiedAtMs = Date.parse(input.positioningVerifiedAt ?? "");
  return typeof capturedAtMs === "number" && Number.isFinite(verifiedAtMs) && capturedAtMs >= verifiedAtMs;
}
