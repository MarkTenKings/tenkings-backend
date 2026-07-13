import {
  NATIVE_CAMERA_PROTOCOL_VERSION,
  type NativeCameraEpochs,
  type NativeCameraSide,
  type NativeCameraWorkerState,
} from "./nativeCameraProtocol";

export type NativeCameraSelection = "disabled" | "fake" | "replay" | "pylon";

export interface NativeCameraFeatureConfig {
  enabled: boolean;
  selection: NativeCameraSelection;
  /** Must be independently true before the pylon backend can even be spawned. */
  allowHardwareBackend: boolean;
  automaticFallbackAllowed: false;
}

export const DEFAULT_NATIVE_CAMERA_FEATURE_CONFIG: NativeCameraFeatureConfig = Object.freeze({
  enabled: false,
  selection: "disabled",
  allowHardwareBackend: false,
  automaticFallbackAllowed: false,
});

export function resolveNativeCameraFeatureConfig(
  values: Readonly<Record<string, string | undefined>> = {},
): NativeCameraFeatureConfig {
  const enabled = values.AI_GRADER_NATIVE_CAMERA_ENABLED === "true";
  const requested = values.AI_GRADER_NATIVE_CAMERA_BACKEND;
  const selection: NativeCameraSelection =
    requested === "fake" || requested === "replay" || requested === "pylon" ? requested : "disabled";
  const allowHardwareBackend = values.AI_GRADER_NATIVE_CAMERA_ALLOW_HARDWARE === "true";
  if (!enabled) return { ...DEFAULT_NATIVE_CAMERA_FEATURE_CONFIG };
  if (selection === "disabled") {
    throw new Error("Native camera enablement requires an explicit fake, replay, or pylon backend selection.");
  }
  if (selection === "pylon" && !allowHardwareBackend) {
    throw new Error("Native pylon selection requires a separate explicit hardware-backend authorization.");
  }
  return { enabled: true, selection, allowHardwareBackend, automaticFallbackAllowed: false };
}

export interface NativeCameraInternalHealth {
  enabled: boolean;
  selection: NativeCameraSelection;
  lifecycle: "stopped" | "starting" | "running" | "faulted" | "shutdown";
  state: NativeCameraWorkerState;
  healthy: boolean;
  cameraOpen: boolean;
  epochs: NativeCameraEpochs;
  side: NativeCameraSide;
  previewQueueDepth: 0 | 1;
  clientDroppedPreviewFrames: number;
  workerDroppedPreviewFrames: number;
  lastError?: { code: string; message: string } | null;
}

export interface NativeCameraPublicHealth {
  protocolVersion: typeof NATIVE_CAMERA_PROTOCOL_VERSION;
  enabled: boolean;
  selection: NativeCameraSelection;
  lifecycle: NativeCameraInternalHealth["lifecycle"];
  state: NativeCameraWorkerState;
  healthy: boolean;
  cameraOpen: boolean;
  workerEpoch: number;
  sessionEpoch: number;
  previewEpoch: number;
  sideEpoch: number;
  side: NativeCameraSide;
  previewQueueDepth: 0 | 1;
  clientDroppedPreviewFrames: number;
  workerDroppedPreviewFrames: number;
  automaticFallbackAttempted: false;
  lastError: { code: string; message: string } | null;
}

const PATH_OR_SECRET = /(?:[A-Za-z]:\\|\\\\|\/(?:home|root|tmp|var|users?)\/|https?:\/\/|file:\/\/|token|secret|credential|password|device[_ -]?id|serial(?:number)?)/i;

function safeCode(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value) ? value : "NATIVE_CAMERA_ERROR";
}

function safeMessage(value: string): string {
  if (!value || value.length > 256 || PATH_OR_SECRET.test(value)) return "Native camera attempt failed; inspect local redacted diagnostics.";
  return value.replace(/[\r\n\t]/g, " ");
}

/** Strict allowlist projection; it never copies arbitrary worker fields. */
export function toPublicNativeCameraHealth(input: NativeCameraInternalHealth): NativeCameraPublicHealth {
  return {
    protocolVersion: NATIVE_CAMERA_PROTOCOL_VERSION,
    enabled: input.enabled,
    selection: input.selection,
    lifecycle: input.lifecycle,
    state: input.state,
    healthy: input.healthy,
    cameraOpen: input.cameraOpen,
    workerEpoch: input.epochs.workerEpoch,
    sessionEpoch: input.epochs.sessionEpoch,
    previewEpoch: input.epochs.previewEpoch,
    sideEpoch: input.epochs.sideEpoch,
    side: input.side,
    previewQueueDepth: input.previewQueueDepth,
    clientDroppedPreviewFrames: input.clientDroppedPreviewFrames,
    workerDroppedPreviewFrames: input.workerDroppedPreviewFrames,
    automaticFallbackAttempted: false,
    lastError: input.lastError
      ? { code: safeCode(input.lastError.code), message: safeMessage(input.lastError.message) }
      : null,
  };
}

export function redactNativeCameraDiagnosticText(value: string): string {
  if (PATH_OR_SECRET.test(value)) return "[redacted-native-camera-diagnostic]";
  return value.slice(0, 512).replace(/[\r\n\t]/g, " ");
}
