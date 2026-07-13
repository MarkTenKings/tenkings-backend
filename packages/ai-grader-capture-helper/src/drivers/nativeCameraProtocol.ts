import { timingSafeEqual } from "node:crypto";

export const NATIVE_CAMERA_PROTOCOL_VERSION = "tenkings.ai-grader.native-camera.v1" as const;
export const NATIVE_CAMERA_MAX_MESSAGE_BYTES = 1024 * 1024;
export const NATIVE_CAMERA_MAX_REQUEST_ID_LENGTH = 64;
export const NATIVE_CAMERA_MAX_SESSION_ID_LENGTH = 128;
export const NATIVE_CAMERA_MAX_TIMEOUT_MS = 120_000;

export const NATIVE_CAMERA_FORENSIC_ROLES = [
  "dark_control",
  "all_on",
  "accepted_profile",
  "channel_1",
  "channel_2",
  "channel_3",
  "channel_4",
  "channel_5",
  "channel_6",
  "channel_7",
  "channel_8",
] as const;

export type NativeCameraForensicRole = (typeof NATIVE_CAMERA_FORENSIC_ROLES)[number];
export const NATIVE_CAMERA_TRANSFORM_REUSED_ROLES = [
  "accepted_profile",
  "channel_1",
  "channel_2",
  "channel_3",
  "channel_4",
  "channel_5",
  "channel_6",
  "channel_7",
  "channel_8",
] as const;
export type NativeCameraTransformReuseRole = (typeof NATIVE_CAMERA_TRANSFORM_REUSED_ROLES)[number];
export type NativeCameraSide = "front" | "back" | "none";
export type NativeCameraWorkerState =
  | "uninitialized"
  | "idle_safe"
  | "previewing"
  | "draining"
  | "capture_ready"
  | "capturing"
  | "resuming"
  | "faulted"
  | "shutdown";

export type NativeCameraCommandName =
  | "initialize"
  | "health"
  | "capabilities"
  | "start_preview"
  | "stop_drain"
  | "set_side"
  | "execute_forensic_plan"
  | "lighting_ack"
  | "lighting_completion"
  | "safe_off_completion"
  | "resume_preview"
  | "safe_idle"
  | "shutdown";

export type NativeCameraEventName =
  | "preview_frame"
  | "lighting_profile_requested"
  | "lighting_grab_completed"
  | "safe_off_requested"
  | "terminal_fault";

export interface NativeCameraEpochs {
  workerEpoch: number;
  sessionEpoch: number;
  previewEpoch: number;
  sideEpoch: number;
}

interface NativeCameraEnvelopeBase extends NativeCameraEpochs {
  protocolVersion: typeof NATIVE_CAMERA_PROTOCOL_VERSION;
  requestId: string;
  sessionId: string;
  side: NativeCameraSide;
  timeoutMs: number;
  deadlineUnixMs: number;
  sequence: number;
}

export interface NativeCameraCommand extends NativeCameraEnvelopeBase {
  kind: "command";
  command: NativeCameraCommandName;
  payload: Record<string, unknown>;
}

export interface NativeCameraProtocolError {
  code: string;
  message: string;
  retryable: false;
}

export interface NativeCameraResult extends NativeCameraEnvelopeBase {
  kind: "result";
  command: NativeCameraCommandName;
  ok: boolean;
  payload: Record<string, unknown> | null;
  error: NativeCameraProtocolError | null;
}

export interface NativeCameraEvent extends NativeCameraEnvelopeBase {
  kind: "event";
  event: NativeCameraEventName;
  payload: Record<string, unknown>;
}

export type NativeCameraProtocolMessage = NativeCameraCommand | NativeCameraResult | NativeCameraEvent;

export interface NativeCameraPoint {
  x: number;
  y: number;
}

export interface NativeCameraCorners {
  topLeft: NativeCameraPoint;
  topRight: NativeCameraPoint;
  bottomRight: NativeCameraPoint;
  bottomLeft: NativeCameraPoint;
}

export interface NativeCameraFittedLine {
  edge: "top" | "right" | "bottom" | "left";
  a: number;
  b: number;
  c: number;
  support: number;
  continuity: number;
  residualPixels: number;
}

export interface NativeCameraGeometryMetrics {
  perEdgeSupport: { top: number; right: number; bottom: number; left: number };
  edgeSupport: number;
  continuity: number;
  residualPixels: number;
  convexity: number;
  aspectRatio: number;
  aspectScore: number;
  coverage: number;
  clearance: number;
  fullVisibility: boolean;
  perspective: number;
}

export interface NativeCameraFrameIdentity extends NativeCameraEpochs {
  frameId: string;
  blockId: string | null;
  /** Decimal device ticks kept as text so JavaScript never rounds a 64-bit value. */
  hardwareTimestampTicks: string | null;
  side: NativeCameraSide;
}

export interface NativeCameraGeometryResult {
  detectorVersion: "native_four_edge_v1";
  status: "not_detected" | "adjust_card" | "ready";
  reasonCodes: string[];
  sourceCorners: NativeCameraCorners | null;
  normalizedCorners: NativeCameraCorners | null;
  fittedLines: NativeCameraFittedLine[];
  sourceWidth: number;
  sourceHeight: number;
  normalizedWidth: 1200;
  normalizedHeight: 1680;
  center: NativeCameraPoint | null;
  scale: number | null;
  rotationDegrees: number | null;
  confidence: number;
  metrics: NativeCameraGeometryMetrics;
  frame: NativeCameraFrameIdentity;
  detectMonotonicMs: number;
  processingMs: number;
  frameAgeMs: number;
  droppedFrames: number;
  frozen: boolean;
  motionDelta: number | null;
  hysteresis: {
    currentEvidenceReady: boolean;
    consecutiveReadyFrames: number;
    requiredReadyFrames: number;
    removalFenceSatisfied: boolean;
  };
}

export interface NativeCameraPreviewFramePayload {
  frame: NativeCameraFrameIdentity;
  jpeg: {
    mimeType: "image/jpeg";
    width: number;
    height: number;
    base64: string;
    byteSize: number;
    sha256: string;
  };
  geometry: NativeCameraGeometryResult;
  telemetry: {
    receiveMonotonicMs: number;
    detectMonotonicMs: number;
    encodeMonotonicMs: number;
    emitMonotonicMs: number;
    processingMs: number;
    frameAgeMs: number;
    droppedFrames: number;
    frozen: boolean;
  };
}

export interface NativeCameraForensicArtifact {
  role: NativeCameraForensicRole;
  fileName: string;
  sha256: string;
  byteSize: number;
  mimeType: "image/png" | "image/tiff";
  width: number;
  height: number;
  frame: NativeCameraFrameIdentity;
  capturedAtUnixMs: number;
  writeDurationMs: number;
  hashDurationMs: number;
}

export interface NativeCameraTimingSnapshot {
  spawnToInitializeMs: number | null;
  pylonInitializeMs: number | null;
  cameraDiscoveryMs: number | null;
  cameraOpenMs: number | null;
  cameraConfigureMs: number | null;
  firstPreviewFrameMs: number | null;
  detectMs: number | null;
  encodeMs: number | null;
  emitMs: number | null;
  drainMs: number | null;
  modeSwitchMs: number | null;
  lightingAcknowledgementMs: number | null;
  firstForensicFrameMs: number | null;
  forensicGrabMs: number | null;
  forensicWriteMs: number | null;
  forensicHashMs: number | null;
  resumeMs: number | null;
  droppedFrames: number;
}

export interface NativeCameraAuthoritativeTransform {
  sourceFrameId: string;
  sourceSha256: string;
  sourceWidth: number;
  sourceHeight: number;
  normalizedWidth: 1200;
  normalizedHeight: 1680;
  homography: [number, number, number, number, number, number, number, number, number];
  reusedByRoles: NativeCameraTransformReuseRole[];
}

export class NativeCameraProtocolValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeCameraProtocolValidationError";
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const UNSAFE_DIAGNOSTIC_PATTERN = /(?:[A-Za-z]:\\|\\\\|https?:\/\/|file:\/\/|(?:^|\s)\/[A-Za-z0-9._-]+\/|token|secret|credential|password|device[_ -]?id|serial(?:number)?)/i;

function fail(code: string, message: string): never {
  throw new NativeCameraProtocolValidationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) fail("INVALID_TYPE", `${name} must be an object.`);
  return value;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("UNKNOWN_FIELD", `Unexpected field ${key}.`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail("MISSING_FIELD", `Missing field ${key}.`);
  }
}

function textValue(value: unknown, name: string, maxLength: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    fail("INVALID_TEXT", `${name} must contain 1-${maxLength} characters.`);
  }
  if (pattern && !pattern.test(value)) fail("INVALID_TEXT", `${name} has an invalid format.`);
  return value;
}

function integer(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    fail("INVALID_INTEGER", `${name} must be an integer between ${min} and ${max}.`);
  }
  return value as number;
}

function finite(value: unknown, name: string, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail("INVALID_NUMBER", `${name} must be finite and between ${min} and ${max}.`);
  }
  return value;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") fail("INVALID_BOOLEAN", `${name} must be boolean.`);
  return value;
}

function nullableFinite(value: unknown, name: string): number | null {
  return value === null ? null : finite(value, name);
}

function side(value: unknown): NativeCameraSide {
  if (value !== "front" && value !== "back" && value !== "none") fail("INVALID_SIDE", "side is invalid.");
  return value;
}

function workerState(value: unknown): NativeCameraWorkerState {
  const values: NativeCameraWorkerState[] = [
    "uninitialized",
    "idle_safe",
    "previewing",
    "draining",
    "capture_ready",
    "capturing",
    "resuming",
    "faulted",
    "shutdown",
  ];
  if (!values.includes(value as NativeCameraWorkerState)) fail("INVALID_STATE", "state is invalid.");
  return value as NativeCameraWorkerState;
}

function commandName(value: unknown): NativeCameraCommandName {
  const values: NativeCameraCommandName[] = [
    "initialize",
    "health",
    "capabilities",
    "start_preview",
    "stop_drain",
    "set_side",
    "execute_forensic_plan",
    "lighting_ack",
    "lighting_completion",
    "safe_off_completion",
    "resume_preview",
    "safe_idle",
    "shutdown",
  ];
  if (!values.includes(value as NativeCameraCommandName)) fail("INVALID_COMMAND", "command is invalid.");
  return value as NativeCameraCommandName;
}

function eventName(value: unknown): NativeCameraEventName {
  const values: NativeCameraEventName[] = [
    "preview_frame",
    "lighting_profile_requested",
    "lighting_grab_completed",
    "safe_off_requested",
    "terminal_fault",
  ];
  if (!values.includes(value as NativeCameraEventName)) fail("INVALID_EVENT", "event is invalid.");
  return value as NativeCameraEventName;
}

function point(value: unknown, name: string): NativeCameraPoint {
  const input = record(value, name);
  exactKeys(input, ["x", "y"]);
  return { x: finite(input.x, `${name}.x`), y: finite(input.y, `${name}.y`) };
}

function corners(value: unknown, name: string): NativeCameraCorners | null {
  if (value === null) return null;
  const input = record(value, name);
  exactKeys(input, ["topLeft", "topRight", "bottomRight", "bottomLeft"]);
  return {
    topLeft: point(input.topLeft, `${name}.topLeft`),
    topRight: point(input.topRight, `${name}.topRight`),
    bottomRight: point(input.bottomRight, `${name}.bottomRight`),
    bottomLeft: point(input.bottomLeft, `${name}.bottomLeft`),
  };
}

function frameIdentity(value: unknown, name: string): NativeCameraFrameIdentity {
  const input = record(value, name);
  exactKeys(input, [
    "frameId",
    "blockId",
    "hardwareTimestampTicks",
    "workerEpoch",
    "sessionEpoch",
    "previewEpoch",
    "sideEpoch",
    "side",
  ]);
  return {
    frameId: textValue(input.frameId, `${name}.frameId`, 128, SAFE_ID_PATTERN),
    blockId: input.blockId === null ? null : textValue(input.blockId, `${name}.blockId`, 128, SAFE_ID_PATTERN),
    hardwareTimestampTicks:
      input.hardwareTimestampTicks === null
        ? null
        : textValue(input.hardwareTimestampTicks, `${name}.hardwareTimestampTicks`, 32, /^(?:0|[1-9][0-9]*)$/),
    workerEpoch: integer(input.workerEpoch, `${name}.workerEpoch`),
    sessionEpoch: integer(input.sessionEpoch, `${name}.sessionEpoch`),
    previewEpoch: integer(input.previewEpoch, `${name}.previewEpoch`),
    sideEpoch: integer(input.sideEpoch, `${name}.sideEpoch`),
    side: side(input.side),
  };
}

function finiteUnit(value: unknown, name: string): number {
  return finite(value, name, 0, 1);
}

function geometryMetrics(value: unknown): NativeCameraGeometryMetrics {
  const input = record(value, "geometry.metrics");
  exactKeys(input, [
    "perEdgeSupport",
    "edgeSupport",
    "continuity",
    "residualPixels",
    "convexity",
    "aspectRatio",
    "aspectScore",
    "coverage",
    "clearance",
    "fullVisibility",
    "perspective",
  ]);
  const perEdge = record(input.perEdgeSupport, "geometry.metrics.perEdgeSupport");
  exactKeys(perEdge, ["top", "right", "bottom", "left"]);
  return {
    perEdgeSupport: {
      top: finiteUnit(perEdge.top, "geometry.metrics.perEdgeSupport.top"),
      right: finiteUnit(perEdge.right, "geometry.metrics.perEdgeSupport.right"),
      bottom: finiteUnit(perEdge.bottom, "geometry.metrics.perEdgeSupport.bottom"),
      left: finiteUnit(perEdge.left, "geometry.metrics.perEdgeSupport.left"),
    },
    edgeSupport: finiteUnit(input.edgeSupport, "geometry.metrics.edgeSupport"),
    continuity: finiteUnit(input.continuity, "geometry.metrics.continuity"),
    residualPixels: finite(input.residualPixels, "geometry.metrics.residualPixels", 0),
    convexity: finiteUnit(input.convexity, "geometry.metrics.convexity"),
    aspectRatio: finite(input.aspectRatio, "geometry.metrics.aspectRatio", 0),
    aspectScore: finiteUnit(input.aspectScore, "geometry.metrics.aspectScore"),
    coverage: finiteUnit(input.coverage, "geometry.metrics.coverage"),
    clearance: finiteUnit(input.clearance, "geometry.metrics.clearance"),
    fullVisibility: bool(input.fullVisibility, "geometry.metrics.fullVisibility"),
    perspective: finiteUnit(input.perspective, "geometry.metrics.perspective"),
  };
}

export function parseNativeCameraGeometry(value: unknown): NativeCameraGeometryResult {
  const input = record(value, "geometry");
  exactKeys(input, [
    "detectorVersion",
    "status",
    "reasonCodes",
    "sourceCorners",
    "normalizedCorners",
    "fittedLines",
    "sourceWidth",
    "sourceHeight",
    "normalizedWidth",
    "normalizedHeight",
    "center",
    "scale",
    "rotationDegrees",
    "confidence",
    "metrics",
    "frame",
    "detectMonotonicMs",
    "processingMs",
    "frameAgeMs",
    "droppedFrames",
    "frozen",
    "motionDelta",
    "hysteresis",
  ]);
  if (input.detectorVersion !== "native_four_edge_v1") fail("INVALID_GEOMETRY", "detectorVersion is invalid.");
  if (input.status !== "not_detected" && input.status !== "adjust_card" && input.status !== "ready") {
    fail("INVALID_GEOMETRY", "geometry.status is invalid.");
  }
  if (!Array.isArray(input.reasonCodes) || input.reasonCodes.length > 16) {
    fail("INVALID_GEOMETRY", "geometry.reasonCodes is invalid.");
  }
  const reasonCodes = input.reasonCodes.map((entry, index) =>
    textValue(entry, `geometry.reasonCodes[${index}]`, 64, SAFE_ID_PATTERN),
  );
  if (!Array.isArray(input.fittedLines) || input.fittedLines.length > 4) {
    fail("INVALID_GEOMETRY", "geometry.fittedLines is invalid.");
  }
  const fittedLines = input.fittedLines.map((entry, index) => {
    const line = record(entry, `geometry.fittedLines[${index}]`);
    exactKeys(line, ["edge", "a", "b", "c", "support", "continuity", "residualPixels"]);
    if (line.edge !== "top" && line.edge !== "right" && line.edge !== "bottom" && line.edge !== "left") {
      fail("INVALID_GEOMETRY", "fitted line edge is invalid.");
    }
    const edge = line.edge as NativeCameraFittedLine["edge"];
    return {
      edge,
      a: finite(line.a, "line.a"),
      b: finite(line.b, "line.b"),
      c: finite(line.c, "line.c"),
      support: finiteUnit(line.support, "line.support"),
      continuity: finiteUnit(line.continuity, "line.continuity"),
      residualPixels: finite(line.residualPixels, "line.residualPixels", 0),
    };
  });
  const canonicalEdges: NativeCameraFittedLine["edge"][] = ["top", "right", "bottom", "left"];
  if (fittedLines.some((line, index) => line.edge !== canonicalEdges[index])) {
    fail("INVALID_GEOMETRY", "Fitted lines must be unique and use canonical edge order.");
  }
  const hysteresis = record(input.hysteresis, "geometry.hysteresis");
  exactKeys(hysteresis, [
    "currentEvidenceReady",
    "consecutiveReadyFrames",
    "requiredReadyFrames",
    "removalFenceSatisfied",
  ]);
  const result: NativeCameraGeometryResult = {
    detectorVersion: "native_four_edge_v1",
    status: input.status,
    reasonCodes,
    sourceCorners: corners(input.sourceCorners, "geometry.sourceCorners"),
    normalizedCorners: corners(input.normalizedCorners, "geometry.normalizedCorners"),
    fittedLines,
    sourceWidth: integer(input.sourceWidth, "geometry.sourceWidth", 1, 100_000),
    sourceHeight: integer(input.sourceHeight, "geometry.sourceHeight", 1, 100_000),
    normalizedWidth: integer(input.normalizedWidth, "geometry.normalizedWidth", 1200, 1200) as 1200,
    normalizedHeight: integer(input.normalizedHeight, "geometry.normalizedHeight", 1680, 1680) as 1680,
    center: input.center === null ? null : point(input.center, "geometry.center"),
    scale: input.scale === null ? null : finite(input.scale, "geometry.scale", 0),
    rotationDegrees: input.rotationDegrees === null ? null : finite(input.rotationDegrees, "geometry.rotationDegrees", -180, 180),
    confidence: finiteUnit(input.confidence, "geometry.confidence"),
    metrics: geometryMetrics(input.metrics),
    frame: frameIdentity(input.frame, "geometry.frame"),
    detectMonotonicMs: finite(input.detectMonotonicMs, "geometry.detectMonotonicMs", 0),
    processingMs: finite(input.processingMs, "geometry.processingMs", 0),
    frameAgeMs: finite(input.frameAgeMs, "geometry.frameAgeMs", 0),
    droppedFrames: integer(input.droppedFrames, "geometry.droppedFrames"),
    frozen: bool(input.frozen, "geometry.frozen"),
    motionDelta: input.motionDelta === null ? null : finite(input.motionDelta, "geometry.motionDelta", 0),
    hysteresis: {
      currentEvidenceReady: bool(hysteresis.currentEvidenceReady, "geometry.hysteresis.currentEvidenceReady"),
      consecutiveReadyFrames: integer(hysteresis.consecutiveReadyFrames, "geometry.hysteresis.consecutiveReadyFrames"),
      requiredReadyFrames: integer(hysteresis.requiredReadyFrames, "geometry.hysteresis.requiredReadyFrames", 1, 120),
      removalFenceSatisfied: bool(hysteresis.removalFenceSatisfied, "geometry.hysteresis.removalFenceSatisfied"),
    },
  };
  if (result.status === "ready") {
    if (!result.sourceCorners || !result.normalizedCorners || result.fittedLines.length !== 4) {
      fail("INCOHERENT_READY", "Ready geometry requires corners and four fitted lines.");
    }
    if (result.frozen || !result.hysteresis.currentEvidenceReady || !result.metrics.fullVisibility) {
      fail("INCOHERENT_READY", "Frozen, stale, or clipped geometry cannot be Ready.");
    }
  }
  return result;
}

function parseJpeg(value: unknown): NativeCameraPreviewFramePayload["jpeg"] {
  const input = record(value, "preview.jpeg");
  exactKeys(input, ["mimeType", "width", "height", "base64", "byteSize", "sha256"]);
  if (input.mimeType !== "image/jpeg") fail("INVALID_JPEG", "preview JPEG MIME is invalid.");
  const base64 = typeof input.base64 === "string" ? input.base64 : fail("INVALID_JPEG", "preview JPEG body is invalid.");
  if (base64.length > NATIVE_CAMERA_MAX_MESSAGE_BYTES || !BASE64_PATTERN.test(base64)) {
    fail("INVALID_JPEG", "preview JPEG base64 is invalid.");
  }
  const byteSize = integer(input.byteSize, "preview.jpeg.byteSize", 1, NATIVE_CAMERA_MAX_MESSAGE_BYTES);
  const decoded = Buffer.from(base64, "base64");
  if (decoded.length !== byteSize) fail("INVALID_JPEG", "preview JPEG byte size does not match its body.");
  return {
    mimeType: "image/jpeg",
    width: integer(input.width, "preview.jpeg.width", 1, 8192),
    height: integer(input.height, "preview.jpeg.height", 1, 8192),
    base64,
    byteSize,
    sha256: textValue(input.sha256, "preview.jpeg.sha256", 64, SHA256_PATTERN),
  };
}

export function parseNativeCameraPreviewPayload(value: unknown): NativeCameraPreviewFramePayload {
  const input = record(value, "preview payload");
  exactKeys(input, ["frame", "jpeg", "geometry", "telemetry"]);
  const frame = frameIdentity(input.frame, "preview.frame");
  const geometry = parseNativeCameraGeometry(input.geometry);
  const telemetry = record(input.telemetry, "preview.telemetry");
  exactKeys(telemetry, [
    "receiveMonotonicMs",
    "detectMonotonicMs",
    "encodeMonotonicMs",
    "emitMonotonicMs",
    "processingMs",
    "frameAgeMs",
    "droppedFrames",
    "frozen",
  ]);
  const result: NativeCameraPreviewFramePayload = {
    frame,
    jpeg: parseJpeg(input.jpeg),
    geometry,
    telemetry: {
      receiveMonotonicMs: finite(telemetry.receiveMonotonicMs, "preview.telemetry.receiveMonotonicMs", 0),
      detectMonotonicMs: finite(telemetry.detectMonotonicMs, "preview.telemetry.detectMonotonicMs", 0),
      encodeMonotonicMs: finite(telemetry.encodeMonotonicMs, "preview.telemetry.encodeMonotonicMs", 0),
      emitMonotonicMs: finite(telemetry.emitMonotonicMs, "preview.telemetry.emitMonotonicMs", 0),
      processingMs: finite(telemetry.processingMs, "preview.telemetry.processingMs", 0),
      frameAgeMs: finite(telemetry.frameAgeMs, "preview.telemetry.frameAgeMs", 0),
      droppedFrames: integer(telemetry.droppedFrames, "preview.telemetry.droppedFrames"),
      frozen: bool(telemetry.frozen, "preview.telemetry.frozen"),
    },
  };
  const coherentIdentity = JSON.stringify(frame) === JSON.stringify(geometry.frame);
  if (!coherentIdentity) fail("FRAME_COHERENCE", "Preview JPEG and geometry do not identify the same frame.");
  if (result.telemetry.frozen !== geometry.frozen || result.telemetry.frameAgeMs !== geometry.frameAgeMs) {
    fail("FRAME_COHERENCE", "Preview and geometry freshness telemetry disagree.");
  }
  return result;
}

function forensicRole(value: unknown, name: string): NativeCameraForensicRole {
  if (!NATIVE_CAMERA_FORENSIC_ROLES.includes(value as NativeCameraForensicRole)) {
    fail("INVALID_FORENSIC_ROLE", `${name} is invalid.`);
  }
  return value as NativeCameraForensicRole;
}

function validateExactForensicRoles(value: unknown, name: string): NativeCameraForensicRole[] {
  if (!Array.isArray(value) || value.length !== NATIVE_CAMERA_FORENSIC_ROLES.length) {
    fail("INCOMPLETE_FORENSIC_PLAN", `${name} must contain all eleven roles.`);
  }
  const roles = value.map((entry, index) => forensicRole(entry, `${name}[${index}]`));
  if (new Set(roles).size !== roles.length) fail("DUPLICATE_FORENSIC_ROLE", `${name} contains duplicate roles.`);
  if (roles.some((role, index) => role !== NATIVE_CAMERA_FORENSIC_ROLES[index])) {
    fail("OUT_OF_ORDER_FORENSIC_ROLE", `${name} must use canonical role order.`);
  }
  return roles;
}

function validateCommandPayload(command: NativeCameraCommandName, value: unknown): Record<string, unknown> {
  const payload = record(value, `${command}.payload`);
  if (command === "initialize") {
    exactKeys(payload, ["backend", "configurationId"], ["calibrationId"]);
    if (payload.backend !== "fake" && payload.backend !== "replay" && payload.backend !== "pylon") {
      fail("INVALID_BACKEND", "initialize backend is invalid.");
    }
    textValue(payload.configurationId, "configurationId", 128, SAFE_ID_PATTERN);
    if (payload.calibrationId !== undefined) textValue(payload.calibrationId, "calibrationId", 128, SAFE_ID_PATTERN);
  } else if (command === "health" || command === "capabilities" || command === "stop_drain" || command === "safe_idle" || command === "shutdown") {
    exactKeys(payload, []);
  } else if (command === "start_preview" || command === "resume_preview") {
    exactKeys(payload, ["maxFps", "jpegQuality"]);
    finite(payload.maxFps, "maxFps", 1, 60);
    integer(payload.jpegQuality, "jpegQuality", 1, 100);
  } else if (command === "set_side") {
    exactKeys(payload, ["side"]);
    const selected = side(payload.side);
    if (selected === "none") fail("INVALID_SIDE", "set_side requires front or back.");
  } else if (command === "execute_forensic_plan") {
    exactKeys(payload, ["captureId", "forensicProfile", "roles", "normalizedWidth", "normalizedHeight"]);
    textValue(payload.captureId, "captureId", 128, SAFE_ID_PATTERN);
    if (payload.forensicProfile !== "full_forensic" && payload.forensicProfile !== "production_fast") {
      fail("INVALID_FORENSIC_PROFILE", "forensicProfile is invalid.");
    }
    validateExactForensicRoles(payload.roles, "roles");
    integer(payload.normalizedWidth, "normalizedWidth", 1200, 1200);
    integer(payload.normalizedHeight, "normalizedHeight", 1680, 1680);
  } else if (command === "lighting_ack") {
    exactKeys(payload, ["captureRequestId", "role", "stableAcknowledgementId", "authorizationId", "stableAtUnixMs", "expiresAtUnixMs"]);
    textValue(payload.captureRequestId, "captureRequestId", 64, REQUEST_ID_PATTERN);
    forensicRole(payload.role, "role");
    textValue(payload.stableAcknowledgementId, "stableAcknowledgementId", 128, SAFE_ID_PATTERN);
    textValue(payload.authorizationId, "authorizationId", 128, SAFE_ID_PATTERN);
    integer(payload.stableAtUnixMs, "stableAtUnixMs", 0);
    integer(payload.expiresAtUnixMs, "expiresAtUnixMs", 0);
  } else if (command === "lighting_completion") {
    exactKeys(payload, ["captureRequestId", "role", "authorizationId", "completedAtUnixMs"]);
    textValue(payload.captureRequestId, "captureRequestId", 64, REQUEST_ID_PATTERN);
    forensicRole(payload.role, "role");
    textValue(payload.authorizationId, "authorizationId", 128, SAFE_ID_PATTERN);
    integer(payload.completedAtUnixMs, "completedAtUnixMs", 0);
  } else if (command === "safe_off_completion") {
    exactKeys(payload, ["safeOffRequestId", "safe", "completedAtUnixMs"]);
    textValue(payload.safeOffRequestId, "safeOffRequestId", 64, REQUEST_ID_PATTERN);
    bool(payload.safe, "safe");
    integer(payload.completedAtUnixMs, "completedAtUnixMs", 0);
  }
  return payload;
}

function validateError(value: unknown): NativeCameraProtocolError {
  const input = record(value, "error");
  exactKeys(input, ["code", "message", "retryable"]);
  if (input.retryable !== false) fail("INVALID_ERROR", "Native failures are terminal for the attempt.");
  const message = textValue(input.message, "error.message", 512);
  if (UNSAFE_DIAGNOSTIC_PATTERN.test(message)) {
    fail("UNSAFE_DIAGNOSTIC", "Protocol errors must not expose paths, URLs, secrets, or device identifiers.");
  }
  return {
    code: textValue(input.code, "error.code", 64, SAFE_ID_PATTERN),
    message,
    retryable: false,
  };
}

function validateArtifact(value: unknown): NativeCameraForensicArtifact {
  const input = record(value, "artifact");
  exactKeys(input, [
    "role",
    "fileName",
    "sha256",
    "byteSize",
    "mimeType",
    "width",
    "height",
    "frame",
    "capturedAtUnixMs",
    "writeDurationMs",
    "hashDurationMs",
  ]);
  const mimeType = input.mimeType;
  if (mimeType !== "image/png" && mimeType !== "image/tiff") fail("INVALID_ARTIFACT", "artifact MIME is invalid.");
  const fileName = textValue(input.fileName, "artifact.fileName", 180);
  if (fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    fail("INVALID_ARTIFACT", "artifact.fileName must not contain a path.");
  }
  return {
    role: forensicRole(input.role, "artifact.role"),
    fileName,
    sha256: textValue(input.sha256, "artifact.sha256", 64, SHA256_PATTERN),
    byteSize: integer(input.byteSize, "artifact.byteSize", 1),
    mimeType,
    width: integer(input.width, "artifact.width", 1, 100_000),
    height: integer(input.height, "artifact.height", 1, 100_000),
    frame: frameIdentity(input.frame, "artifact.frame"),
    capturedAtUnixMs: integer(input.capturedAtUnixMs, "artifact.capturedAtUnixMs", 0),
    writeDurationMs: finite(input.writeDurationMs, "artifact.writeDurationMs", 0),
    hashDurationMs: finite(input.hashDurationMs, "artifact.hashDurationMs", 0),
  };
}

function validateTimingSnapshot(value: unknown): NativeCameraTimingSnapshot {
  const timing = record(value, "timing");
  const durationKeys = [
    "spawnToInitializeMs",
    "pylonInitializeMs",
    "cameraDiscoveryMs",
    "cameraOpenMs",
    "cameraConfigureMs",
    "firstPreviewFrameMs",
    "detectMs",
    "encodeMs",
    "emitMs",
    "drainMs",
    "modeSwitchMs",
    "lightingAcknowledgementMs",
    "firstForensicFrameMs",
    "forensicGrabMs",
    "forensicWriteMs",
    "forensicHashMs",
    "resumeMs",
  ] as const;
  exactKeys(timing, [...durationKeys, "droppedFrames"]);
  const output = {} as NativeCameraTimingSnapshot;
  for (const key of durationKeys) output[key] = timing[key] === null ? null : finite(timing[key], `timing.${key}`, 0);
  output.droppedFrames = integer(timing.droppedFrames, "timing.droppedFrames");
  return output;
}

function validateAuthoritativeTransform(value: unknown): NativeCameraAuthoritativeTransform {
  const transform = record(value, "authoritativeTransform");
  exactKeys(transform, [
    "sourceFrameId",
    "sourceSha256",
    "sourceWidth",
    "sourceHeight",
    "normalizedWidth",
    "normalizedHeight",
    "homography",
    "reusedByRoles",
  ]);
  if (!Array.isArray(transform.homography) || transform.homography.length !== 9) {
    fail("INVALID_HOMOGRAPHY", "authoritativeTransform.homography must contain exactly nine values.");
  }
  const homography = transform.homography.map((entry, index) => finite(entry, `authoritativeTransform.homography[${index}]`));
  if (!Array.isArray(transform.reusedByRoles) || transform.reusedByRoles.length !== NATIVE_CAMERA_TRANSFORM_REUSED_ROLES.length) {
    fail("INVALID_TRANSFORM_REUSE", "authoritativeTransform.reusedByRoles must contain the nine derived-light roles.");
  }
  const reusedByRoles = transform.reusedByRoles.map((entry, index) => {
    if (entry !== NATIVE_CAMERA_TRANSFORM_REUSED_ROLES[index]) {
      fail("INVALID_TRANSFORM_REUSE", "authoritativeTransform.reusedByRoles must use canonical order and exclude controls.");
    }
    return entry as NativeCameraTransformReuseRole;
  });
  return {
    sourceFrameId: textValue(transform.sourceFrameId, "authoritativeTransform.sourceFrameId", 128, SAFE_ID_PATTERN),
    sourceSha256: textValue(transform.sourceSha256, "authoritativeTransform.sourceSha256", 64, SHA256_PATTERN),
    sourceWidth: integer(transform.sourceWidth, "authoritativeTransform.sourceWidth", 1, 100_000),
    sourceHeight: integer(transform.sourceHeight, "authoritativeTransform.sourceHeight", 1, 100_000),
    normalizedWidth: integer(transform.normalizedWidth, "authoritativeTransform.normalizedWidth", 1200, 1200) as 1200,
    normalizedHeight: integer(transform.normalizedHeight, "authoritativeTransform.normalizedHeight", 1680, 1680) as 1680,
    homography: homography as NativeCameraAuthoritativeTransform["homography"],
    reusedByRoles,
  };
}

function validateResultPayload(command: NativeCameraCommandName, value: unknown): Record<string, unknown> {
  const payload = record(value, `${command}.result.payload`);
  if (command === "health") {
    exactKeys(payload, ["state", "healthy", "backend", "cameraOpen", "automaticFallbackAttempted", "timing"]);
    workerState(payload.state);
    bool(payload.healthy, "healthy");
    if (payload.backend !== "fake" && payload.backend !== "replay" && payload.backend !== "pylon") fail("INVALID_BACKEND", "backend is invalid.");
    bool(payload.cameraOpen, "cameraOpen");
    if (payload.automaticFallbackAttempted !== false) fail("FALLBACK_FORBIDDEN", "Automatic fallback is forbidden.");
  } else if (command === "capabilities") {
    exactKeys(payload, ["state", "backends", "forensicRoles", "normalizedWidth", "normalizedHeight", "queueDepth", "timing"]);
    workerState(payload.state);
    if (!Array.isArray(payload.backends) || payload.backends.some((entry) => entry !== "fake" && entry !== "replay" && entry !== "pylon")) {
      fail("INVALID_CAPABILITIES", "backends is invalid.");
    }
    validateExactForensicRoles(payload.forensicRoles, "forensicRoles");
    integer(payload.normalizedWidth, "normalizedWidth", 1200, 1200);
    integer(payload.normalizedHeight, "normalizedHeight", 1680, 1680);
    integer(payload.queueDepth, "queueDepth", 1, 1);
  } else if (command === "execute_forensic_plan") {
    exactKeys(payload, [
      "state",
      "captureId",
      "forensicProfile",
      "artifacts",
      "authoritativeAllOnGeometry",
      "authoritativeTransform",
      "captureDurationMs",
      "droppedFrames",
      "timing",
    ]);
    workerState(payload.state);
    textValue(payload.captureId, "captureId", 128, SAFE_ID_PATTERN);
    if (payload.forensicProfile !== "full_forensic" && payload.forensicProfile !== "production_fast") {
      fail("INVALID_FORENSIC_PROFILE", "forensicProfile is invalid.");
    }
    if (!Array.isArray(payload.artifacts) || payload.artifacts.length !== 11) {
      fail("INCOMPLETE_FORENSIC_OUTPUT", "Forensic result must contain eleven artifacts.");
    }
    const artifacts = payload.artifacts.map(validateArtifact);
    validateExactForensicRoles(artifacts.map((entry) => entry.role), "artifact roles");
    const requiredMime = payload.forensicProfile === "full_forensic" ? "image/png" : "image/tiff";
    if (artifacts.some((entry) => entry.mimeType !== requiredMime)) {
      fail("INVALID_FORENSIC_ENCODING", `${payload.forensicProfile} artifacts must use ${requiredMime}.`);
    }
    const firstArtifact = artifacts[0];
    if (!firstArtifact) fail("INCOMPLETE_FORENSIC_OUTPUT", "Forensic artifacts are absent.");
    const frameIds = new Set<string>();
    const blockIds = new Set<string>();
    for (const artifact of artifacts) {
      if (artifact.width !== firstArtifact.width || artifact.height !== firstArtifact.height) {
        fail("FORENSIC_DIMENSION_MISMATCH", "All forensic artifacts must use coherent raw dimensions.");
      }
      if (
        artifact.frame.workerEpoch !== firstArtifact.frame.workerEpoch ||
        artifact.frame.sessionEpoch !== firstArtifact.frame.sessionEpoch ||
        artifact.frame.previewEpoch !== firstArtifact.frame.previewEpoch ||
        artifact.frame.sideEpoch !== firstArtifact.frame.sideEpoch ||
        artifact.frame.side !== firstArtifact.frame.side
      ) {
        fail("FORENSIC_EPOCH_MISMATCH", "All forensic artifacts must use coherent epochs and side.");
      }
      if (frameIds.has(artifact.frame.frameId)) {
        fail("DUPLICATE_FORENSIC_FRAME", "Forensic artifacts must use distinct frame IDs.");
      }
      frameIds.add(artifact.frame.frameId);
      if (artifact.frame.blockId !== null) {
        if (blockIds.has(artifact.frame.blockId)) {
          fail("DUPLICATE_FORENSIC_BLOCK", "Forensic artifacts must use distinct non-null BlockIDs.");
        }
        blockIds.add(artifact.frame.blockId);
      }
    }
    const allOn = artifacts.find((artifact) => artifact.role === "all_on");
    if (!allOn) fail("INCOMPLETE_FORENSIC_OUTPUT", "Forensic output omitted all_on.");
    const authoritativeGeometry = parseNativeCameraGeometry(payload.authoritativeAllOnGeometry);
    if (!nativeCameraFrameIdentityEquals(authoritativeGeometry.frame, allOn.frame)) {
      fail("AUTHORITATIVE_FRAME_MISMATCH", "Authoritative geometry must identify the exact all_on frame.");
    }
    if (authoritativeGeometry.sourceWidth !== allOn.width || authoritativeGeometry.sourceHeight !== allOn.height) {
      fail("AUTHORITATIVE_DIMENSION_MISMATCH", "Authoritative geometry dimensions must match all_on.");
    }
    const authoritativeTransform = validateAuthoritativeTransform(payload.authoritativeTransform);
    if (
      authoritativeTransform.sourceFrameId !== allOn.frame.frameId ||
      authoritativeTransform.sourceSha256 !== allOn.sha256
    ) {
      fail("AUTHORITATIVE_SOURCE_MISMATCH", "Authoritative transform must bind the exact all_on frame and SHA-256.");
    }
    if (authoritativeTransform.sourceWidth !== allOn.width || authoritativeTransform.sourceHeight !== allOn.height) {
      fail("AUTHORITATIVE_DIMENSION_MISMATCH", "Authoritative transform dimensions must match all_on.");
    }
    finite(payload.captureDurationMs, "captureDurationMs", 0);
    integer(payload.droppedFrames, "droppedFrames");
  } else {
    exactKeys(payload, ["state", "timing"]);
    workerState(payload.state);
  }
  validateTimingSnapshot(payload.timing);
  return payload;
}

function validateEventPayload(event: NativeCameraEventName, value: unknown): Record<string, unknown> {
  const payload = record(value, `${event}.payload`);
  if (event === "preview_frame") {
    parseNativeCameraPreviewPayload(payload);
  } else if (event === "lighting_profile_requested") {
    exactKeys(payload, ["captureRequestId", "role", "ordinal"]);
    textValue(payload.captureRequestId, "captureRequestId", 64, REQUEST_ID_PATTERN);
    forensicRole(payload.role, "role");
    integer(payload.ordinal, "ordinal", 0, 10);
  } else if (event === "lighting_grab_completed") {
    exactKeys(payload, ["captureRequestId", "role", "authorizationId", "frame"]);
    textValue(payload.captureRequestId, "captureRequestId", 64, REQUEST_ID_PATTERN);
    forensicRole(payload.role, "role");
    textValue(payload.authorizationId, "authorizationId", 128, SAFE_ID_PATTERN);
    frameIdentity(payload.frame, "frame");
  } else if (event === "safe_off_requested") {
    exactKeys(payload, ["safeOffRequestId", "reason"]);
    textValue(payload.safeOffRequestId, "safeOffRequestId", 64, REQUEST_ID_PATTERN);
    textValue(payload.reason, "reason", 96, SAFE_ID_PATTERN);
  } else {
    exactKeys(payload, ["code", "message"]);
    textValue(payload.code, "code", 64, SAFE_ID_PATTERN);
    textValue(payload.message, "message", 512);
  }
  return payload;
}

function validateBase(input: Record<string, unknown>): void {
  if (input.protocolVersion !== NATIVE_CAMERA_PROTOCOL_VERSION) fail("PROTOCOL_VERSION", "Protocol version is invalid.");
  textValue(input.requestId, "requestId", NATIVE_CAMERA_MAX_REQUEST_ID_LENGTH, REQUEST_ID_PATTERN);
  textValue(input.sessionId, "sessionId", NATIVE_CAMERA_MAX_SESSION_ID_LENGTH, SAFE_ID_PATTERN);
  integer(input.workerEpoch, "workerEpoch");
  integer(input.sessionEpoch, "sessionEpoch");
  integer(input.previewEpoch, "previewEpoch");
  integer(input.sideEpoch, "sideEpoch");
  side(input.side);
  integer(input.timeoutMs, "timeoutMs", 1, NATIVE_CAMERA_MAX_TIMEOUT_MS);
  integer(input.deadlineUnixMs, "deadlineUnixMs", 0);
  integer(input.sequence, "sequence", 1);
}

export function parseNativeCameraProtocolMessage(value: unknown): NativeCameraProtocolMessage {
  const input = record(value, "message");
  if (input.kind === "command") {
    exactKeys(input, [
      "protocolVersion", "kind", "command", "requestId", "sessionId", "workerEpoch", "sessionEpoch",
      "previewEpoch", "sideEpoch", "side", "timeoutMs", "deadlineUnixMs", "sequence", "payload",
    ]);
    validateBase(input);
    const command = commandName(input.command);
    validateCommandPayload(command, input.payload);
    return input as unknown as NativeCameraCommand;
  }
  if (input.kind === "result") {
    exactKeys(input, [
      "protocolVersion", "kind", "command", "requestId", "sessionId", "workerEpoch", "sessionEpoch",
      "previewEpoch", "sideEpoch", "side", "timeoutMs", "deadlineUnixMs", "sequence", "ok", "payload", "error",
    ]);
    validateBase(input);
    const command = commandName(input.command);
    const ok = bool(input.ok, "ok");
    if (ok) {
      if (input.error !== null) fail("INVALID_RESULT", "Successful results cannot contain an error.");
      validateResultPayload(command, input.payload);
    } else {
      if (input.payload !== null) fail("INVALID_RESULT", "Failed results cannot contain payload data.");
      validateError(input.error);
    }
    return input as unknown as NativeCameraResult;
  }
  if (input.kind === "event") {
    exactKeys(input, [
      "protocolVersion", "kind", "event", "requestId", "sessionId", "workerEpoch", "sessionEpoch",
      "previewEpoch", "sideEpoch", "side", "timeoutMs", "deadlineUnixMs", "sequence", "payload",
    ]);
    validateBase(input);
    validateEventPayload(eventName(input.event), input.payload);
    return input as unknown as NativeCameraEvent;
  }
  fail("INVALID_KIND", "Message kind is invalid.");
}

export function encodeNativeCameraProtocolMessage(message: NativeCameraProtocolMessage): Buffer {
  const validated = parseNativeCameraProtocolMessage(message);
  const encoded = Buffer.from(`${JSON.stringify(validated)}\n`, "utf8");
  if (encoded.byteLength - 1 > NATIVE_CAMERA_MAX_MESSAGE_BYTES) {
    fail("MESSAGE_TOO_LARGE", `Protocol message exceeds ${NATIVE_CAMERA_MAX_MESSAGE_BYTES} bytes.`);
  }
  return encoded;
}

export class NativeCameraNdjsonParser {
  private pending = Buffer.alloc(0);
  private ended = false;

  constructor(private readonly maxMessageBytes = NATIVE_CAMERA_MAX_MESSAGE_BYTES) {
    integer(maxMessageBytes, "maxMessageBytes", 128, NATIVE_CAMERA_MAX_MESSAGE_BYTES);
  }

  push(chunk: Buffer | string): NativeCameraProtocolMessage[] {
    if (this.ended) fail("PARSER_ENDED", "Cannot push data after parser end.");
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    this.pending = Buffer.concat([this.pending, bytes]);
    const messages: NativeCameraProtocolMessage[] = [];
    for (;;) {
      const newline = this.pending.indexOf(0x0a);
      if (newline < 0) break;
      if (newline > this.maxMessageBytes) fail("MESSAGE_TOO_LARGE", "Protocol line exceeds the configured byte limit.");
      let line = this.pending.subarray(0, newline);
      this.pending = this.pending.subarray(newline + 1);
      if (line.length > 0 && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
      if (line.length === 0) fail("EMPTY_MESSAGE", "Empty protocol lines are forbidden.");
      let decoded: unknown;
      try {
        decoded = JSON.parse(line.toString("utf8"));
      } catch {
        fail("MALFORMED_JSON", "Protocol line is not valid JSON.");
      }
      messages.push(parseNativeCameraProtocolMessage(decoded));
    }
    if (this.pending.length > this.maxMessageBytes) fail("MESSAGE_TOO_LARGE", "Protocol line exceeds the configured byte limit.");
    return messages;
  }

  end(): NativeCameraProtocolMessage[] {
    if (this.ended) return [];
    this.ended = true;
    if (this.pending.length === 0) return [];
    if (this.pending.toString("utf8").trim().length === 0) {
      this.pending = Buffer.alloc(0);
      return [];
    }
    fail("TRUNCATED_MESSAGE", "Protocol stream ended before a newline-delimited message completed.");
  }
}

export function nativeCameraFrameIdentityEquals(left: NativeCameraFrameIdentity, right: NativeCameraFrameIdentity): boolean {
  const a = Buffer.from(JSON.stringify(left));
  const b = Buffer.from(JSON.stringify(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
