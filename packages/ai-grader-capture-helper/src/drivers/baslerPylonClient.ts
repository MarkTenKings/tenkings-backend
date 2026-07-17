import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { LEIMAC_IDMU_MAX_DUTY_PERCENT } from "./leimacIdmuClient";

export type BaslerPylonAction =
  | "readiness"
  | "list-cameras"
  | "capture-still"
  | "fixed-rig-side-batch"
  | "operator-preview-window"
  | "operator-preview-mjpeg-stream"
  | "line2-exposure-active"
  | "line2-user-output-pulse"
  | "line2-status";
export type BaslerSavedImageFormat = "png" | "tiff" | "jpg";

export const BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION = "APPLY BASLER LINE2 EXPOSURE ACTIVE";
export const BASLER_LINE2_USER_OUTPUT_PULSE_CONFIRMATION = "RUN BASLER LINE2 USER OUTPUT PULSE";

export interface BaslerPylonClientConfig {
  pylonRoot?: string;
  bridgeScriptPath?: string;
  powershellPath?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface BaslerPylonInstallInfo {
  installed: boolean;
  root?: string;
  version?: string | null;
  assemblyPath?: string | null;
  runtimePath?: string | null;
  status: "installed" | "missing";
}

export interface BaslerCameraInfo {
  index: number;
  friendlyName?: string | null;
  modelName?: string | null;
  vendorName?: string | null;
  serialNumber?: string | null;
  deviceType?: string | null;
  transport?: string | null;
  deviceIpAddress?: string | null;
  deviceMacAddress?: string | null;
  subnetMask?: string | null;
  defaultGateway?: string | null;
  networkInterfaceIpAddress?: string | null;
  userDefinedName?: string | null;
  fullName?: string | null;
}

export interface BaslerNetworkAdapterInfo {
  interfaceAlias?: string | null;
  description?: string | null;
  status?: string | null;
  linkSpeed?: string | null;
  macAddress?: string | null;
  ipAddress?: string | null;
}

export interface BaslerPylonReadinessResult {
  pylon: BaslerPylonInstallInfo;
  transport: "GigE";
  cameraCount: number;
  cameras: BaslerCameraInfo[];
  networkAdapters: BaslerNetworkAdapterInfo[];
  status: "reachable" | "not_reachable" | "pylon_missing" | "error";
  hardwareAccess: "explicit_pylon_gige_enumeration";
  note: string;
}

export interface BaslerPylonCameraListResult extends BaslerPylonReadinessResult {
  command: "basler-list-cameras";
}

export interface BaslerLine2ExposureActiveResult {
  applied: boolean;
  baslerSettingsChanged: boolean;
  cameraIndex: number;
  lineSelector: "Line2";
  lineMode: "Output";
  lineSource: "ExposureActive";
  lineInverter: boolean;
  persistentSaved: false;
  hardwareAccess: "dry_run_no_camera_opened" | "explicit_pylon_line2_configuration";
  readback?: {
    lineSelector?: string | null;
    lineMode?: string | null;
    lineSource?: string | null;
    lineInverter?: boolean | null;
    lineStatus?: BaslerLineStatusReadback;
    lineStatusAll?: BaslerLineStatusReadback;
  };
  safety: {
    dryRun: boolean;
    writesApplied: boolean;
    baslerSettingsChanged: boolean;
    persistentSaved: false;
    capturesImages: false;
    controlsLighting: false;
  };
  note: string;
}

export interface BaslerLine2StatusResult {
  applied: false;
  baslerSettingsChanged: false;
  cameraIndex: number;
  lineSelector: "Line2";
  persistentSaved: false;
  hardwareAccess: "explicit_pylon_line2_status_read";
  readback: {
    lineSelector?: string | null;
    lineMode?: string | null;
    lineSource?: string | null;
    lineInverter?: boolean | null;
    lineStatus: BaslerLineStatusReadback;
    lineStatusAll: BaslerLineStatusReadback;
  };
  safety: {
    dryRun: false;
    writesApplied: false;
    baslerSettingsChanged: false;
    persistentSaved: false;
    capturesImages: false;
    controlsLighting: false;
  };
  note: string;
}

export interface BaslerLineStatusReadback {
  supported: boolean;
  value?: boolean | number | string | null;
  raw?: string | null;
  error?: string;
}

export interface BaslerLine2UserOutputPulseResult {
  applied: boolean;
  baslerSettingsChanged: boolean;
  cameraIndex: number;
  lineSelector: "Line2";
  lineMode: "Output";
  lineSource: "UserOutput1";
  lineInverter: boolean;
  userOutputSelector: "UserOutput1";
  idleUserOutputValue: boolean;
  pulseUserOutputValue: boolean;
  pulseMs: number;
  persistentSaved: false;
  hardwareAccess: "dry_run_no_camera_opened" | "explicit_pylon_line2_user_output_pulse";
  readback?: {
    beforePulse: BaslerLine2UserOutputPulseReadback;
    duringPulse: BaslerLine2UserOutputPulseReadback;
    afterPulse: BaslerLine2UserOutputPulseReadback;
  };
  safety: {
    dryRun: boolean;
    writesApplied: boolean;
    baslerSettingsChanged: boolean;
    persistentSaved: false;
    capturesImages: false;
    controlsLighting: false;
    restoresIdle: true;
  };
  note: string;
}

export interface BaslerLine2UserOutputPulseReadback {
  lineSelector?: string | null;
  lineMode?: string | null;
  lineSource?: string | null;
  lineInverter?: boolean | null;
  userOutputSelector?: string | null;
  userOutputValue?: boolean | null;
  lineStatus: BaslerLineStatusReadback;
  lineStatusAll: BaslerLineStatusReadback;
}

export interface BaslerCalibrationMetadata {
  isCalibrated: false;
  calibrationProfileId: null;
  lensModel?: string | null;
  cameraRole: "macro_overview";
  evidenceClass: "macro_raw_smoke";
  coordinateFrame: "basler_sensor_pixels";
}

export interface BaslerCaptureStillResult {
  outputFilePath: string;
  sha256: string;
  byteSize: number;
  mimeType: "image/png" | "image/tiff" | "image/jpeg";
  timestamp: string;
  camera: BaslerCameraInfo;
  imageWidth: number;
  imageHeight: number;
  sourcePixelFormat: string;
  savedImageFormat: "PNG" | "TIFF" | "JPG";
  exposureTime?: number | null;
  gain?: number | null;
  transport: "GigE";
  pylon: BaslerPylonInstallInfo;
  calibration: BaslerCalibrationMetadata;
  note: string;
}

export type BaslerFixedRigSideBatchExecutionPath = "warm_full_forensic_runner";
export type BaslerFixedRigSideBatchSide = "front" | "back";

export interface BaslerFixedRigSideBatchRoleCapture {
  role: "dark_control" | "all_on" | "accepted_profile" | `channel_${number}`;
  label: string;
  channel?: number | "all" | number[];
  frames?: unknown[];
  writes?: unknown[];
  capture: BaslerCaptureStillResult;
}

export interface BaslerFixedRigSideBatchResult {
  executionPath: BaslerFixedRigSideBatchExecutionPath;
  fallbackUsed: false;
  side: BaslerFixedRigSideBatchSide;
  outputDir: string;
  cameraIndex: number;
  openedAt?: string;
  finishedAt?: string;
  persistentBaslerSession: true;
  persistentLeimacSession: boolean;
  selectedChannels: number[];
  dutyTenthsPercent: number;
  line2?: unknown;
  capturesStarted?: boolean;
  leimac?: {
    safeOffStart?: unknown;
    triggerSetup?: unknown;
    safeOffEnd?: unknown;
    reconnectCount?: number;
    persistentConnectionUsed?: boolean;
  };
  captures: {
    darkControl: BaslerFixedRigSideBatchRoleCapture;
    allOn: BaslerFixedRigSideBatchRoleCapture;
    acceptedProfile: BaslerFixedRigSideBatchRoleCapture;
    channels: BaslerFixedRigSideBatchRoleCapture[];
  };
  timing?: unknown;
  safety?: unknown;
  note: string;
}

export interface BaslerOperatorPreviewWindowMetrics {
  mean: number;
  max: number;
  clippedFraction: number;
  darkFraction: number;
  sharpness: number;
}

export interface BaslerOperatorPreviewWindowResult {
  windowVisible: true;
  implementationType: "windows_winforms_pylon_live_stream";
  framesUpdateAutomatically: true;
  fps?: number;
  frameAgeMs?: number;
  skippedStaleFrames?: number;
  frameSource?: string;
  framesDisplayed: number;
  overlayVisible: true;
  metricsVisible: true;
  displayOrientation: "portrait_rotated_90_for_operator_preview";
  rawCaptureOrientation: "unchanged_unrotated_sensor_pixels";
  sidebarLayout: "right_vertical_sidebar";
  operatorDecision: "accepted" | "aborted" | "closed";
  lastFramePath?: string | null;
  lastFrameSha256?: string | null;
  lastFrameByteSize?: number | null;
  lastMetrics?: BaslerOperatorPreviewWindowMetrics | null;
  lastError?: string | null;
  previewLighting: {
    controlsVisible: true;
    controlsEnabled: boolean;
    masterLightOn: boolean;
    currentDutyPercent: number;
    requestedDutyPercent?: number;
    actualAppliedDutyPercent?: number;
    actualAppliedPwmStep?: number;
    actualAppliedPwmValue?: string;
    defaultV1DutyMarkerPercent: 1.2;
    maxDutyPercent: number;
    selectedChannels: number[];
    channelMappingStatus: "unknown_uncalibrated";
    safeOffOnExit: true;
    leimacEngagedDuringPreview: boolean;
    lastApplyLatencyMs?: number | null;
    lastResponses: string[];
  };
  camera: BaslerCameraInfo;
  exposureTime?: number | null;
  gain?: number | null;
  sourcePixelFormat?: string | null;
  transport: "GigE";
  pylon: BaslerPylonInstallInfo;
  safety: {
    leimacRequired: false;
    leimacEngaged: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    overlaysBakedIntoRawEvidence: false;
    rawEvidenceClean: true;
  };
  note: string;
}

export interface BaslerPylonBridgeErrorPayload {
  code: string;
  message: string;
}

export interface BaslerPylonBridgeEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: BaslerPylonBridgeErrorPayload;
}

export interface BaslerPylonBridgeRunOptions {
  timeoutMs: number;
}

export type BaslerPylonBridgeRunner = (
  command: string,
  args: string[],
  options: BaslerPylonBridgeRunOptions
) => Promise<BaslerPylonBridgeEnvelope>;

export interface BaslerCaptureStillOptions {
  outputDir: string;
  label: string;
  cameraIndex?: number;
  savedFormat?: BaslerSavedImageFormat;
  lensModel?: string;
  exposureUs?: number;
  gain?: number;
}

export interface BaslerFixedRigSideBatchOptions {
  outputDir: string;
  side: BaslerFixedRigSideBatchSide;
  selectedChannels?: number[];
  cameraIndex?: number;
  savedFormat?: BaslerSavedImageFormat;
  lensModel?: string;
  exposureUs?: number;
  gain?: number;
  leimacHost?: string;
  leimacPort?: number;
  leimacUnit?: number;
  dutyPercent?: number;
}

export interface BaslerOperatorPreviewWindowOptions {
  outputDir?: string;
  cameraIndex?: number;
  exposureUs?: number;
  refreshIntervalMs?: number;
  leimacHost?: string;
  leimacPort?: number;
  leimacUnit?: number;
  previewDutyPercent?: number;
}

export interface BaslerOperatorPreviewMjpegStreamOptions {
  cameraIndex?: number;
  exposureUs?: number;
  refreshIntervalMs?: number;
  jpegQuality?: number;
}

export interface BaslerLine2ExposureActiveOptions {
  apply?: boolean;
  confirmation?: string;
  cameraIndex?: number;
  lineInverter?: boolean;
}

export interface BaslerLine2UserOutputPulseOptions {
  apply?: boolean;
  confirmation?: string;
  cameraIndex?: number;
  lineInverter?: boolean;
  pulseMs?: number;
  idleUserOutputValue?: boolean;
}

export class BaslerPylonClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BaslerPylonClientError";
    this.code = code;
  }
}

export function normalizeBaslerSavedImageFormat(value: string | undefined): BaslerSavedImageFormat {
  const normalized = (value ?? "png").trim().toLowerCase();
  if (normalized === "png" || normalized === "tiff" || normalized === "jpg") return normalized;
  if (normalized === "jpeg") return "jpg";
  throw new BaslerPylonClientError("BASLER_IMAGE_FORMAT_UNSUPPORTED", "--format must be png, tiff, or jpg.");
}

export function assertBaslerCaptureOutputDirAllowed(outputDir: string, repoRoot = process.cwd()): string {
  if (!outputDir || outputDir.trim().length === 0) {
    throw new BaslerPylonClientError("BASLER_OUTPUT_DIR_REQUIRED", "Basler still capture requires --output-dir <path>.");
  }
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const relative = path.relative(resolvedRepoRoot, resolvedOutputDir);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new BaslerPylonClientError(
      "BASLER_OUTPUT_DIR_INSIDE_REPO",
      "Basler still capture output directory must be outside the git repo."
    );
  }
  return resolvedOutputDir;
}

export function buildBaslerLine2ExposureActivePlan(cameraIndex = 0, lineInverter = false): BaslerLine2ExposureActiveResult {
  if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
    throw new BaslerPylonClientError("BASLER_CAMERA_INDEX_INVALID", "--camera-index must be a non-negative integer.");
  }
  if (typeof lineInverter !== "boolean") {
    throw new BaslerPylonClientError("BASLER_LINE_INVERTER_INVALID", "--line-inverter must be true or false.");
  }
  return {
    applied: false,
    baslerSettingsChanged: false,
    cameraIndex,
    lineSelector: "Line2",
    lineMode: "Output",
    lineSource: "ExposureActive",
    lineInverter,
    persistentSaved: false,
    hardwareAccess: "dry_run_no_camera_opened",
    safety: {
      dryRun: true,
      writesApplied: false,
      baslerSettingsChanged: false,
      persistentSaved: false,
      capturesImages: false,
      controlsLighting: false,
    },
    note:
      "Dry-run Basler Line 2 plan only; does not open the camera, does not save a User Set, and does not capture images.",
  };
}

export function normalizeBaslerLine2PulseMs(value: number | string | undefined): number {
  const numeric = value == null || value === "" ? 500 : Number(value);
  if (!Number.isInteger(numeric) || numeric < 250 || numeric > 500) {
    throw new BaslerPylonClientError("BASLER_LINE2_PULSE_MS_INVALID", "--pulse-ms must be an integer from 250 to 500.");
  }
  return numeric;
}

export function buildBaslerLine2UserOutputPulsePlan(
  cameraIndex = 0,
  lineInverter = true,
  pulseMs: number | string | undefined = 500,
  idleUserOutputValue = false
): BaslerLine2UserOutputPulseResult {
  if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
    throw new BaslerPylonClientError("BASLER_CAMERA_INDEX_INVALID", "--camera-index must be a non-negative integer.");
  }
  if (typeof lineInverter !== "boolean") {
    throw new BaslerPylonClientError("BASLER_LINE_INVERTER_INVALID", "--line-inverter must be true or false.");
  }
  if (typeof idleUserOutputValue !== "boolean") {
    throw new BaslerPylonClientError("BASLER_LINE2_IDLE_VALUE_INVALID", "--idle-user-output-value must be true or false.");
  }
  const normalizedPulseMs = normalizeBaslerLine2PulseMs(pulseMs);
  return {
    applied: false,
    baslerSettingsChanged: false,
    cameraIndex,
    lineSelector: "Line2",
    lineMode: "Output",
    lineSource: "UserOutput1",
    lineInverter,
    userOutputSelector: "UserOutput1",
    idleUserOutputValue,
    pulseUserOutputValue: !idleUserOutputValue,
    pulseMs: normalizedPulseMs,
    persistentSaved: false,
    hardwareAccess: "dry_run_no_camera_opened",
    safety: {
      dryRun: true,
      writesApplied: false,
      baslerSettingsChanged: false,
      persistentSaved: false,
      capturesImages: false,
      controlsLighting: false,
      restoresIdle: true,
    },
    note:
      "Dry-run Basler Line 2 UserOutput1 pulse plan only; does not open the camera, does not save a User Set, and does not capture images.",
  };
}

export function defaultBaslerPylonBridgeScriptPath(): string {
  return path.resolve(__dirname, "..", "..", "scripts", "basler-pylon-bridge.ps1");
}

export function defaultBaslerPylonRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    nonEmpty(env.TENKINGS_BASLER_PYLON_ROOT) ??
    nonEmpty(env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT) ??
    (existsSync("C:\\Program Files\\Basler\\pylon") ? "C:\\Program Files\\Basler\\pylon" : undefined)
  );
}

export class BaslerPylonClient {
  private readonly config: Required<Pick<BaslerPylonClientConfig, "powershellPath" | "timeoutMs">> &
    Omit<BaslerPylonClientConfig, "powershellPath" | "timeoutMs">;
  private readonly runBridgeProcess: BaslerPylonBridgeRunner;

  constructor(config: BaslerPylonClientConfig = {}, runBridgeProcess: BaslerPylonBridgeRunner = defaultBridgeRunner) {
    this.config = {
      ...config,
      powershellPath: config.powershellPath ?? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      timeoutMs: config.timeoutMs ?? 30000,
    };
    this.runBridgeProcess = runBridgeProcess;
  }

  async readiness(): Promise<BaslerPylonReadinessResult> {
    return this.runBridge<BaslerPylonReadinessResult>("readiness");
  }

  async listCameras(): Promise<BaslerPylonCameraListResult> {
    return this.runBridge<BaslerPylonCameraListResult>("list-cameras");
  }

  async configureLine2ExposureActive(options: BaslerLine2ExposureActiveOptions = {}): Promise<BaslerLine2ExposureActiveResult> {
    const cameraIndex = options.cameraIndex ?? 0;
    const lineInverter = options.lineInverter ?? false;
    if (!options.apply) return buildBaslerLine2ExposureActivePlan(cameraIndex, lineInverter);
    if (options.confirmation !== BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION) {
      throw new BaslerPylonClientError(
        "BASLER_LINE2_CONFIRMATION_REQUIRED",
        `Basler Line 2 apply requires --confirm "${BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION}".`
      );
    }
    if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
      throw new BaslerPylonClientError("BASLER_CAMERA_INDEX_INVALID", "--camera-index must be a non-negative integer.");
    }
    if (typeof lineInverter !== "boolean") {
      throw new BaslerPylonClientError("BASLER_LINE_INVERTER_INVALID", "--line-inverter must be true or false.");
    }
    return this.runBridge<BaslerLine2ExposureActiveResult>("line2-exposure-active", [
      "-CameraIndex",
      String(cameraIndex),
      "-LineInverter",
      lineInverter ? "true" : "false",
      "-Apply",
    ]);
  }

  async readLine2Status(cameraIndex = 0): Promise<BaslerLine2StatusResult> {
    if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
      throw new BaslerPylonClientError("BASLER_CAMERA_INDEX_INVALID", "--camera-index must be a non-negative integer.");
    }
    return this.runBridge<BaslerLine2StatusResult>("line2-status", [
      "-CameraIndex",
      String(cameraIndex),
    ]);
  }

  async pulseLine2UserOutput(options: BaslerLine2UserOutputPulseOptions = {}): Promise<BaslerLine2UserOutputPulseResult> {
    const cameraIndex = options.cameraIndex ?? 0;
    const lineInverter = options.lineInverter ?? true;
    const pulseMs = normalizeBaslerLine2PulseMs(options.pulseMs);
    const idleUserOutputValue = options.idleUserOutputValue ?? false;
    if (!options.apply) return buildBaslerLine2UserOutputPulsePlan(cameraIndex, lineInverter, pulseMs, idleUserOutputValue);
    if (options.confirmation !== BASLER_LINE2_USER_OUTPUT_PULSE_CONFIRMATION) {
      throw new BaslerPylonClientError(
        "BASLER_LINE2_PULSE_CONFIRMATION_REQUIRED",
        `Basler Line 2 UserOutput pulse requires --confirm "${BASLER_LINE2_USER_OUTPUT_PULSE_CONFIRMATION}".`
      );
    }
    if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
      throw new BaslerPylonClientError("BASLER_CAMERA_INDEX_INVALID", "--camera-index must be a non-negative integer.");
    }
    if (typeof lineInverter !== "boolean") {
      throw new BaslerPylonClientError("BASLER_LINE_INVERTER_INVALID", "--line-inverter must be true or false.");
    }
    if (typeof idleUserOutputValue !== "boolean") {
      throw new BaslerPylonClientError("BASLER_LINE2_IDLE_VALUE_INVALID", "--idle-user-output-value must be true or false.");
    }
    return this.runBridge<BaslerLine2UserOutputPulseResult>("line2-user-output-pulse", [
      "-CameraIndex",
      String(cameraIndex),
      "-LineInverter",
      lineInverter ? "true" : "false",
      "-PulseMs",
      String(pulseMs),
      "-IdleUserOutputValue",
      idleUserOutputValue ? "true" : "false",
      "-Apply",
    ]);
  }

  async captureStill(options: BaslerCaptureStillOptions): Promise<BaslerCaptureStillResult> {
    const outputDir = assertBaslerCaptureOutputDirAllowed(options.outputDir);
    const label = options.label?.trim();
    if (!label) {
      throw new BaslerPylonClientError("BASLER_LABEL_REQUIRED", "Basler still capture requires --label <label>.");
    }
    const cameraIndex = options.cameraIndex ?? 0;
    if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
      throw new BaslerPylonClientError("BASLER_CAMERA_INDEX_INVALID", "--camera-index must be a non-negative integer.");
    }

    return this.runBridge<BaslerCaptureStillResult>("capture-still", [
      "-OutputDir",
      outputDir,
      "-Label",
      label,
      "-CameraIndex",
      String(cameraIndex),
      "-Format",
      normalizeBaslerSavedImageFormat(options.savedFormat),
      ...(options.exposureUs ? ["-ExposureUs", String(options.exposureUs)] : []),
      ...(options.gain != null ? ["-Gain", String(options.gain)] : []),
      ...(options.lensModel ? ["-LensModel", options.lensModel] : []),
    ]);
  }

  async captureFixedRigSideBatch(options: BaslerFixedRigSideBatchOptions): Promise<BaslerFixedRigSideBatchResult> {
    const outputDir = assertBaslerCaptureOutputDirAllowed(options.outputDir);
    const cameraIndex = options.cameraIndex ?? 0;
    if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
      throw new BaslerPylonClientError("BASLER_CAMERA_INDEX_INVALID", "--camera-index must be a non-negative integer.");
    }
    const selectedChannels = options.selectedChannels?.length ? options.selectedChannels : [1, 2, 3, 4, 5, 6, 7, 8];
    if (
      selectedChannels.some((channel) => !Number.isInteger(channel) || channel < 1 || channel > 8) ||
      new Set(selectedChannels).size !== selectedChannels.length
    ) {
      throw new BaslerPylonClientError("BASLER_FIXED_RIG_CHANNELS_INVALID", "Warm fixed-rig side batch selected channels must be unique integers from 1 to 8.");
    }
    const dutyPercent = options.dutyPercent ?? 1.2;
    if (!Number.isFinite(dutyPercent) || dutyPercent < 0 || dutyPercent > LEIMAC_IDMU_MAX_DUTY_PERCENT) {
      throw new BaslerPylonClientError(
        "BASLER_FIXED_RIG_DUTY_INVALID",
        `Warm fixed-rig side batch duty must be from 0 to ${LEIMAC_IDMU_MAX_DUTY_PERCENT} percent.`,
      );
    }

    return this.runBridge<BaslerFixedRigSideBatchResult>("fixed-rig-side-batch", [
      "-OutputDir",
      outputDir,
      "-Side",
      options.side,
      "-CameraIndex",
      String(cameraIndex),
      "-Format",
      normalizeBaslerSavedImageFormat(options.savedFormat),
      "-SelectedChannels",
      selectedChannels.join(","),
      "-PreviewDutyTenthsPercent",
      String(Math.round(dutyPercent * 10)),
      ...(options.exposureUs ? ["-ExposureUs", String(options.exposureUs)] : []),
      ...(options.gain != null ? ["-Gain", String(options.gain)] : []),
      ...(options.lensModel ? ["-LensModel", options.lensModel] : []),
      ...(options.leimacHost ? ["-LeimacHost", options.leimacHost] : []),
      ...(options.leimacPort ? ["-LeimacPort", String(options.leimacPort)] : []),
      ...(options.leimacUnit ? ["-LeimacUnit", String(options.leimacUnit)] : []),
    ]);
  }

  async showOperatorPreviewWindow(options: BaslerOperatorPreviewWindowOptions = {}): Promise<BaslerOperatorPreviewWindowResult> {
    const cameraIndex = options.cameraIndex ?? 0;
    if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
      throw new BaslerPylonClientError("BASLER_CAMERA_INDEX_INVALID", "--camera-index must be a non-negative integer.");
    }
    const refreshIntervalMs = options.refreshIntervalMs ?? 500;
    if (!Number.isInteger(refreshIntervalMs) || refreshIntervalMs < 250 || refreshIntervalMs > 5000) {
      throw new BaslerPylonClientError("BASLER_PREVIEW_REFRESH_INVALID", "--preview-refresh-ms must be an integer from 250 to 5000.");
    }

    return this.runBridge<BaslerOperatorPreviewWindowResult>("operator-preview-window", [
      "-CameraIndex",
      String(cameraIndex),
      "-RefreshIntervalMs",
      String(refreshIntervalMs),
      ...(options.outputDir ? ["-OutputDir", assertBaslerCaptureOutputDirAllowed(options.outputDir)] : []),
      ...(options.exposureUs ? ["-ExposureUs", String(options.exposureUs)] : []),
      ...(options.leimacHost ? ["-LeimacHost", options.leimacHost] : []),
      ...(options.leimacPort ? ["-LeimacPort", String(options.leimacPort)] : []),
      ...(options.leimacUnit ? ["-LeimacUnit", String(options.leimacUnit)] : []),
      ...(options.previewDutyPercent != null ? ["-PreviewDutyTenthsPercent", String(Math.round(options.previewDutyPercent * 10))] : []),
    ]);
  }

  startOperatorPreviewMjpegStream(options: BaslerOperatorPreviewMjpegStreamOptions = {}): ChildProcessWithoutNullStreams {
    const cameraIndex = options.cameraIndex ?? 0;
    if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
      throw new BaslerPylonClientError("BASLER_CAMERA_INDEX_INVALID", "--camera-index must be a non-negative integer.");
    }
    const refreshIntervalMs = options.refreshIntervalMs ?? 100;
    if (!Number.isInteger(refreshIntervalMs) || refreshIntervalMs < 50 || refreshIntervalMs > 2000) {
      throw new BaslerPylonClientError("BASLER_PREVIEW_REFRESH_INVALID", "--preview-refresh-ms must be an integer from 50 to 2000.");
    }
    const jpegQuality = options.jpegQuality ?? 72;
    if (!Number.isInteger(jpegQuality) || jpegQuality < 35 || jpegQuality > 95) {
      throw new BaslerPylonClientError("BASLER_PREVIEW_JPEG_QUALITY_INVALID", "Preview JPEG quality must be an integer from 35 to 95.");
    }
    const scriptPath = this.config.bridgeScriptPath ?? defaultBaslerPylonBridgeScriptPath();
    if (!existsSync(scriptPath)) {
      throw new BaslerPylonClientError("BASLER_BRIDGE_SCRIPT_MISSING", `Basler pylon bridge script is missing: ${scriptPath}`);
    }
    const pylonRoot = this.config.pylonRoot ?? defaultBaslerPylonRoot(this.config.env ?? process.env);
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Action",
      "operator-preview-mjpeg-stream",
      ...(pylonRoot ? ["-PylonRoot", pylonRoot] : []),
      "-CameraIndex",
      String(cameraIndex),
      "-RefreshIntervalMs",
      String(refreshIntervalMs),
      "-JpegQuality",
      String(jpegQuality),
      ...(options.exposureUs ? ["-ExposureUs", String(options.exposureUs)] : []),
    ];
    return spawn(this.config.powershellPath, args, {
      stdio: "pipe",
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
  }

  private async runBridge<T>(action: BaslerPylonAction, extraArgs: string[] = []): Promise<T> {
    const scriptPath = this.config.bridgeScriptPath ?? defaultBaslerPylonBridgeScriptPath();
    if (!existsSync(scriptPath)) {
      throw new BaslerPylonClientError("BASLER_BRIDGE_SCRIPT_MISSING", `Basler pylon bridge script is missing: ${scriptPath}`);
    }

    const pylonRoot = this.config.pylonRoot ?? defaultBaslerPylonRoot(this.config.env ?? process.env);
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Action",
      action,
      ...(pylonRoot ? ["-PylonRoot", pylonRoot] : []),
      ...extraArgs,
    ];
    const envelope = await this.runBridgeProcess(this.config.powershellPath, args, {
      timeoutMs: this.config.timeoutMs,
    });

    if (!envelope.ok) {
      throw new BaslerPylonClientError(
        envelope.error?.code ?? "BASLER_BRIDGE_ERROR",
        envelope.error?.message ?? "Basler pylon bridge returned an error."
      );
    }
    return envelope.result as T;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function defaultBridgeRunner(
  command: string,
  args: string[],
  options: BaslerPylonBridgeRunOptions
): Promise<BaslerPylonBridgeEnvelope> {
  return new Promise<BaslerPylonBridgeEnvelope>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "pipe",
      windowsHide: !args.includes("operator-preview-window"),
    }) as ChildProcessWithoutNullStreams;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new BaslerPylonClientError("BASLER_BRIDGE_TIMEOUT", "Basler pylon bridge command timed out."));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new BaslerPylonClientError("BASLER_BRIDGE_PROCESS_ERROR", error.message));
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
      if (!stdout) {
        reject(
          new BaslerPylonClientError(
            "BASLER_BRIDGE_NO_OUTPUT",
            `Basler pylon bridge emitted no JSON: code=${code ?? "null"} signal=${signal ?? "null"}${stderr ? ` stderr=${stderr}` : ""}`
          )
        );
        return;
      }
      try {
        const envelope = JSON.parse(stdout) as BaslerPylonBridgeEnvelope;
        if (code !== 0 && envelope.ok) {
          reject(
            new BaslerPylonClientError(
              "BASLER_BRIDGE_EXITED",
              `Basler pylon bridge exited non-zero: code=${code ?? "null"} signal=${signal ?? "null"}${stderr ? ` stderr=${stderr}` : ""}`
            )
          );
          return;
        }
        resolve(envelope);
      } catch {
        reject(new BaslerPylonClientError("BASLER_BRIDGE_BAD_JSON", "Basler pylon bridge emitted invalid JSON."));
      }
    });
  });
}
