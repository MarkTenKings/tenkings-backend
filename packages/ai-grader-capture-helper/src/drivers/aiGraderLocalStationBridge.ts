import crypto from "node:crypto";
import { spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import {
  assertFixedRigOutputDirAllowed,
  buildFixedRigActiveLightingProfile,
  captureFixedRigWarmSideBatch,
  createFixedRigPackageDir,
  FIXED_RIG_SELECTED_EXPOSURE_US,
  FIXED_RIG_SELECTED_GAIN,
  FIXED_RIG_SELECTED_LEIMAC_DUTY,
  processFixedRigWarmSideBatch,
  type FixedRigActiveLightingProfile,
  type FixedRigCardSide,
  type FixedRigReferenceType,
  type FixedRigWarmEvidencePackageInput,
  type FixedRigWarmEvidencePackageResult,
  type FixedRigWarmSideCaptureBatch,
} from "./baslerFixedRigV1";
import {
  buildLeimacIdmuSafeOffFrames,
  composeLeimacIdmuExplicitChannelWriteFrame,
  leimacIdmuDutyPercentToSteps,
  LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT,
  LeimacIdmuClient,
  type LeimacIdmuWriteFrame,
  type LeimacIdmuWriteResult,
} from "./leimacIdmuClient";
import {
  buildAiGraderStationRealCommandPlan,
  createAiGraderStationCliRunner,
  type AiGraderStationCommandResult,
  type AiGraderStationCommandRunner,
  type AiGraderStationCommandStep,
  type AiGraderStationRealWorkflowInput,
} from "./aiGraderStationWorkflow";
import { BaslerPylonClient } from "./baslerPylonClient";
import {
  buildAiGraderReportBundle,
  writeAiGraderReportBundle,
  type AiGraderReportBundle,
} from "./aiGraderReportBundle";
import {
  writeAiGraderProductionRelease,
  type AiGraderProductionRelease,
} from "./aiGraderProductionRelease";

export const AI_GRADER_LOCAL_STATION_BRIDGE_VERSION = "ai-grader-local-station-bridge-v0.4";
export const DEFAULT_AI_GRADER_LOCAL_STATION_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_AI_GRADER_LOCAL_STATION_BRIDGE_PORT = 47652;
const PREVIEW_RELEASE_TIMEOUT_MS = 5000;
const PREVIEW_CAMERA_SETTLE_MS = 350;
const LIVE_LIGHTING_WATCHDOG_MS = 15000;

export type AiGraderLocalStationBridgeMode = "mock" | "real";

export type AiGraderLocalStationBridgeAction =
  | "status"
  | "start-session"
  | "confirm-light-idle-off"
  | "confirm-fixture-rulers"
  | "launch-preview"
  | "accept-profile"
  | "capture-front"
  | "confirm-flip"
  | "capture-back"
  | "run-diagnostics"
  | "export-report-bundle"
  | "calculate-final-grade"
  | "finalize-report"
  | "publish-report"
  | "generate-label-data"
  | "safe-off"
  | "cancel-session"
  | "latest-report"
  | "session-manifest"
  | "end-session";

export type AiGraderLocalStationStepId =
  | "start_new_card"
  | "verify_fixture_rulers"
  | "live_preview_focus_framing"
  | "lighting_exposure_tune"
  | "accept_capture_profile"
  | "capture_front"
  | "prompt_flip_card"
  | "capture_back"
  | "run_provisional_diagnostics"
  | "view_unified_report"
  | "calculate_final_grade"
  | "finalize_publish_report"
  | "label_data_ready"
  | "safe_off_end_session";

export interface AiGraderLocalStationAcceptedProfile {
  dutyPercent: number;
  exposureUs: number;
  gain: number;
  channels: number[];
  source: "operator_preview" | "browser_live_tuning" | "default" | "cli_override" | "bridge_operator";
  actualLeimacPwmStep: number;
  acceptedAt?: string;
}

export type AiGraderWarmRunnerSide = "front" | "back";
export type AiGraderWarmRunnerPhaseStatus = "pending" | "active" | "completed" | "failed" | "cancelled";
export type AiGraderWarmRunnerExecutionPath = "warm_full_forensic_runner" | "cold_command_fallback";
export type AiGraderWarmRunnerStatusName =
  | "idle"
  | "warming"
  | "capturing"
  | "processing"
  | "reporting"
  | "safe_off"
  | "complete"
  | "failed"
  | "cancelled";

export interface AiGraderWarmRunnerEvidenceRole {
  role:
    | "dark_control"
    | "all_on"
    | "accepted_profile"
    | "channel_1"
    | "channel_2"
    | "channel_3"
    | "channel_4"
    | "channel_5"
    | "channel_6"
    | "channel_7"
    | "channel_8";
  label: string;
  required: true;
  status: AiGraderWarmRunnerPhaseStatus;
}

export interface AiGraderWarmRunnerPhase {
  id: string;
  label: string;
  status: AiGraderWarmRunnerPhaseStatus;
  side?: AiGraderWarmRunnerSide;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  backend?: AiGraderWarmRunnerExecutionPath;
  executionPath?: AiGraderWarmRunnerExecutionPath;
  detail?: string;
}

export interface AiGraderWarmRunnerStatus {
  enabled: true;
  mode: "full_forensic";
  backend: AiGraderWarmRunnerExecutionPath;
  executionPath: AiGraderWarmRunnerExecutionPath;
  fallbackUsed: boolean;
  fallbackReason?: string;
  status: AiGraderWarmRunnerStatusName;
  sessionId?: string;
  activeSide?: AiGraderWarmRunnerSide;
  captureLock: {
    held: boolean;
    owner?: string;
    acquiredAt?: string;
  };
  previewPolicy: {
    pauseDuringCapture: true;
    resumeAfterSafeIdle: true;
    holdPreviewDuringFullForensicRun: true;
    holdActive?: boolean;
    holdReason?: string;
    lastPausedAt?: string;
    lastResumeReadyAt?: string;
    lastHoldStartedAt?: string;
    lastHoldReleasedAt?: string;
  };
  evidencePlan: {
    defaultFullForensic: true;
    rolesBySide: Record<AiGraderWarmRunnerSide, AiGraderWarmRunnerEvidenceRole[]>;
    preservedOutputs: [
      "front_evidence",
      "back_evidence",
      "roi_display_crops",
      "surface_intelligence",
      "vision_lab",
      "unified_report"
    ];
  };
  queues: {
    capture: AiGraderWarmRunnerPhase[];
    processing: AiGraderWarmRunnerPhase[];
    report: AiGraderWarmRunnerPhase[];
  };
  phases: AiGraderWarmRunnerPhase[];
  timing: {
    baselineTotalMs: 461000;
    targetTotalMinMs: 60000;
    targetTotalMaxMs: 150000;
    stretchTargetMs: 60000;
    measuredTotalMs?: number;
  };
  fallback: {
    available: true;
    active: boolean;
    reason?: string;
  };
  safety: {
    captureLock: true;
    watchdogSafeOff: true;
    safeOffOnFailure: true;
    safeOffOnCancellation: true;
    safeOffOnSessionEnd: true;
    fallbackToColdPath: true;
    publicRouteExposed: false;
    productionServiceTokenUsed: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
  };
  note: string;
}

export interface AiGraderLocalStationBridgeConfigInput {
  enabled?: boolean;
  host?: string;
  port?: number | string;
  mode?: AiGraderLocalStationBridgeMode;
  stationToken?: string;
  stationPairingCode?: string;
  stationPairingExpiresAt?: string;
  allowedOrigins?: string[];
  outputDir?: string;
  reportBundleOutputDir?: string;
  publicBasePath?: string;
  apply?: boolean;
  markPresent?: boolean;
  wiringConfirmed?: boolean;
  leimacStatusGreen?: boolean;
  leimacHost?: string;
  leimacPort?: number;
  leimacTimeoutMs?: number;
  leimacUnit?: number;
  pylonRoot?: string;
  pylonTimeoutMs?: number;
  baslerBridgeScript?: string;
  cameraIndex?: number;
  exposureUs?: number;
  gain?: number;
  duty?: number;
  warmRunnerDisabled?: boolean;
  fixtureLabel?: string;
  fixtureId?: string;
  referenceType?: string;
  horizontalSpanMm?: number;
  horizontalStartPx?: { x: number; y: number };
  horizontalEndPx?: { x: number; y: number };
  verticalSpanMm?: number;
  verticalStartPx?: { x: number; y: number };
  verticalEndPx?: { x: number; y: number };
  cardBoundaryRect?: { x: number; y: number; width: number; height: number };
}

export interface AiGraderLocalStationBridgeConfig {
  enabled: boolean;
  host: string;
  port: number;
  mode: AiGraderLocalStationBridgeMode;
  outputDir: string;
  localOnly: true;
  stationToken: string;
  stationPairingCode?: string;
  stationPairingExpiresAt?: string;
  allowedOrigins: string[];
  reportBundleOutputDir?: string;
  publicBasePath?: string;
  apply: boolean;
  markPresent: boolean;
  wiringConfirmed: boolean;
  leimacStatusGreen: boolean;
  leimacHost?: string;
  leimacPort?: number;
  leimacTimeoutMs?: number;
  leimacUnit?: number;
  pylonRoot?: string;
  pylonTimeoutMs?: number;
  baslerBridgeScript?: string;
  cameraIndex?: number;
  exposureUs: number;
  gain: number;
  duty: number;
  warmRunnerDisabled: boolean;
  fixtureLabel?: string;
  fixtureId?: string;
  referenceType?: string;
  horizontalSpanMm?: number;
  horizontalStartPx?: { x: number; y: number };
  horizontalEndPx?: { x: number; y: number };
  verticalSpanMm?: number;
  verticalStartPx?: { x: number; y: number };
  verticalEndPx?: { x: number; y: number };
  cardBoundaryRect?: { x: number; y: number; width: number; height: number };
}

export interface AiGraderLocalStationBridgeManifest {
  schemaVersion: typeof AI_GRADER_LOCAL_STATION_BRIDGE_VERSION;
  stationId: string;
  sessionId?: string;
  reportId?: string;
  currentStep: AiGraderLocalStationStepId;
  mode: AiGraderLocalStationBridgeMode;
  createdAt?: string;
  updatedAt: string;
  acceptedProfile: AiGraderLocalStationAcceptedProfile;
  executionPath: AiGraderWarmRunnerExecutionPath;
  fallbackUsed: boolean;
  fallbackReason?: string;
  confirmations: {
    lightIdleOff: boolean;
    fixtureRulersVisible: boolean;
    flipComplete: boolean;
    finalLightOff: boolean;
  };
  outputs: {
    sessionDir?: string;
    manifestPath?: string;
    previewPackageDir?: string;
    frontPackageDir?: string;
    backPackageDir?: string;
    unifiedReportDir?: string;
    unifiedReportPath?: string;
    reportBundlePath?: string;
    assetManifestPath?: string;
    checksumsPath?: string;
    productionReleasePath?: string;
    labelDataPath?: string;
    publicationManifestPath?: string;
    integrationContractPath?: string;
  };
  safety: {
    localOnly: true;
    hardwareAccessed: boolean;
    databaseWrites: false;
    migrationsRun: false;
    deployRun: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    highDutyLighting: false;
    capturedImagesCommitted: false;
    finalGradeComputed: boolean;
    certifiedClaim: false;
    labelGenerated: boolean;
    qrGenerated: boolean;
    certificateGenerated: false;
  };
  liveLighting: AiGraderLiveLightingStatus;
  previewStatus: AiGraderLocalStationPreviewStatus;
  warmRunnerStatus: AiGraderWarmRunnerStatus;
  commandResults: AiGraderStationCommandResult[];
  progressLog: string[];
  warnings: string[];
  reportBundle?: AiGraderReportBundle;
  productionRelease?: AiGraderProductionRelease;
}

export interface AiGraderLocalStationBridgeStatus extends AiGraderLocalStationBridgeManifest {
  ok: true;
  bridgeVersion: typeof AI_GRADER_LOCAL_STATION_BRIDGE_VERSION;
  localOnly: true;
  loginRequired: false;
  hardwareActionsEnabled: boolean;
  stationUrl: string;
  nextAction: AiGraderLocalStationBridgeAction;
  nextActionLabel: string;
  latestReport: {
    reportId?: string;
    localHtmlPath?: string;
    localViewerPath: string;
    publicViewerRoute: string;
    exists: boolean;
  };
  sessionManifest: {
    gradingSessionId: string;
    reportId: string;
    status: "planned" | "hardware_pending" | "hardware_completed" | "blocked";
    frontCaptured: boolean;
    backCaptured: boolean;
    provisionalDiagnosticsRun: boolean;
  };
  calibrationProfile: {
    referenceType: "fixed_metric_rulers";
    status: "fixture_rulers_pending" | "operator_verified";
    isCalibrated: false;
  };
  bridgeContract: {
    endpoints: Array<{
      method: "GET" | "POST";
      path: string;
      action: AiGraderLocalStationBridgeAction | "preview-status" | "preview-stream" | "preview-stop" | "lighting-status" | "lighting-apply" | "lighting-safe-off" | "lighting-accept" | "lighting-heartbeat";
      hardwareAccess: boolean;
      description: string;
    }>;
    realHardwarePending: string[];
  };
  publicViewerRoute: string;
  bridgeSecurity: {
    tokenRequired: true;
    allowedOrigins: string[];
    host: string;
    port: number;
    rejectsNonLoopback: true;
  };
  timingSummary: AiGraderLocalStationTimingSummary;
}

export interface AiGraderLocalStationTimingEntry {
  stepId: string;
  durationMs: number;
  startedAt?: string;
  finishedAt?: string;
  category?: "bridge" | "preview" | "capture" | "processing" | "report" | "safe_off" | "publish" | "warm_runner";
  label?: string;
  detail?: string;
}

export interface AiGraderLocalStationTimingSummary {
  totalCommandMs: number;
  executionPath: AiGraderWarmRunnerExecutionPath;
  fallbackUsed: boolean;
  fallbackReason?: string;
  bridgeActionOverheadMs: number;
  captureCommandMs: number;
  reportGenerationMs: number;
  safeOffMs: number;
  previewStartMs?: number;
  previewFirstFrameMs?: number;
  localReportOpenMs?: number;
  publishUploadMs?: number;
  entries: AiGraderLocalStationTimingEntry[];
  detailedEntries: AiGraderLocalStationTimingEntry[];
  phaseBreakdown: {
    bridgeStartupMs?: number;
    previewStartMs?: number;
    previewFirstFrameMs?: number;
    baslerOpenMs?: number;
    baslerCaptureMs?: number;
    imageSaveMs?: number;
    hashMs?: number;
    cameraCloseDisposeMs?: number;
    leimacWriteAckMs?: number;
    leimacSafeOffMs?: number;
    frontPackageMs?: number;
    backPackageMs?: number;
    roiDisplayGenerationMs?: number;
    surfaceIntelligenceVisionLabMs?: number;
    unifiedReportHtmlGenerationMs?: number;
    localReportOpenMs?: number;
    publishUploadMs?: number;
    warmSessionSetupMs?: number;
    frontProcessingQueuedMs?: number;
    backProcessingQueuedMs?: number;
    reportQueueMs?: number;
    safeCleanupMs?: number;
  };
  targetInterCaptureNote: string;
}

export interface AiGraderLocalStationPreviewStatus {
  status: "not_started" | "starting" | "live" | "paused_for_capture" | "stopped" | "unavailable" | "error";
  implementationType: "mjpeg_fetch_stream" | "mock_mjpeg_stream" | "native_preview_only";
  browserEmbedded: true;
  localOnly: true;
  tokenRequired: true;
  streamPath: "/preview/stream";
  statusPath: "/preview/status";
  portraitOrientation: true;
  cameraOwnership: "idle" | "preview_stream" | "capture_action" | "released";
  frameSource: "basler_pylon_continuous_grab" | "mock_station_preview" | "native_pylon_window";
  frameCount: number;
  fps?: number;
  startedAt?: string;
  firstFrameAt?: string;
  lastFrameAt?: string;
  lastError?: string;
  lastStopReason?: string;
  safety: {
    publicRouteExposed: false;
    requiresStationToken: true;
    bindsLoopbackOnly: true;
    productionServiceTokenUsed: false;
    lightingCommanded: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
  };
  note: string;
}

export interface AiGraderLiveLightingProfile {
  enabled: boolean;
  dutyPercent: number;
  actualLeimacPwmStep: number;
  channels: number[];
  source: "browser_live_tuning" | "default";
  acceptedForCapture: boolean;
  acceptedAt?: string;
}

export interface AiGraderLiveLightingSafetyEvent {
  at: string;
  type: "apply" | "safe_off" | "accept" | "heartbeat" | "watchdog_safe_off" | "capture_start_safe_off" | "failure_safe_off";
  reason: string;
  ok: boolean;
}

export interface AiGraderLiveLightingStatus {
  status: "unavailable" | "off" | "applying" | "on" | "safe_off" | "error";
  mode: "browser_live_tuning";
  localOnly: true;
  tokenRequired: true;
  controlsEnabled: boolean;
  previewRequired: true;
  profile: AiGraderLiveLightingProfile;
  applied: {
    enabled: boolean;
    dutyPercent: number;
    actualLeimacPwmStep: number;
    channels: number[];
    appliedAt?: string;
    lastApplyLatencyMs?: number;
    lastResponseKinds?: Array<LeimacIdmuWriteResult["responseKind"] | "mock">;
  };
  watchdog: {
    enabled: true;
    timeoutMs: number;
    lastHeartbeatAt?: string;
    expiresAt?: string;
  };
  connection: {
    state: "mock" | "not_configured" | "idle" | "writing" | "error";
    persistentLeimacSession: false;
  };
  safety: {
    publicRouteExposed: false;
    requiresStationToken: true;
    bindsLoopbackOnly: true;
    productionServiceTokenUsed: false;
    lowDutyCapEnforced: true;
    maxDutyPercent: number;
    safeOffOnAllOff: true;
    safeOffOnDisconnect: true;
    safeOffOnTimeout: true;
    safeOffOnCaptureStart: true;
    safeOffOnCaptureFailure: true;
    safeOffOnSessionEnd: true;
    persistentLeimacSaved: false;
    arbitraryWritesAllowed: false;
  };
  safetyEvents: AiGraderLiveLightingSafetyEvent[];
  lastError?: string;
  note: string;
}

export interface AiGraderLocalStationReportHistoryItem {
  reportId: string;
  gradingSessionId: string;
  generatedAt?: string;
  status: string;
  viewerPath: string;
  localHtmlPath?: string;
  reportBundlePath?: string;
  productionReleasePath?: string;
  sessionDir?: string;
  frontPackageDir?: string;
  backPackageDir?: string;
  provisionalOverallGrade?: number;
  finalOverallGrade?: number;
  confidenceBand?: string;
  title?: string;
  category?: string;
  warnings: string[];
}

export interface AiGraderLocalStationReportHistory {
  generatedAt: string;
  source: "local_bridge_file_backed";
  items: AiGraderLocalStationReportHistoryItem[];
  stats: {
    allTime: number;
    monthly: number;
    weekly: number;
    daily: number;
    averageProvisionalGrade?: number;
    averageFinalGrade?: number;
    provisionalGradeCounts: Record<string, number>;
    finalGradeCounts: Record<string, number>;
    finalizedCount: number;
    draftCount: number;
    warningsCount: number;
  };
}

export interface AiGraderLocalStationBridgeActionRequest {
  acceptedProfile?: Partial<AiGraderLocalStationAcceptedProfile>;
  confirmations?: Partial<AiGraderLocalStationBridgeManifest["confirmations"]>;
  reportId?: string;
  operatorId?: string;
  warningsAccepted?: boolean;
  overrideReason?: string;
}

export interface StartedAiGraderLocalStationBridge {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  config: AiGraderLocalStationBridgeConfig;
}

type JsonBody = Record<string, unknown>;
const PREVIEW_MJPEG_BOUNDARY = "tenkings-ai-grader-preview";

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function stopOrphanedBaslerPreviewStreamsUntilReleased(timeoutMs: number, settleMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let totalStopped = 0;
  while (true) {
    const stopped = stopOrphanedBaslerPreviewStreams();
    totalStopped += stopped;
    if (stopped === 0) return totalStopped;
    if (Date.now() >= deadline) {
      throw new Error(
        `AI Grader preview stream did not release the Basler camera within ${timeoutMs} ms; stale preview process(es) were still present.`
      );
    }
    await delay(settleMs);
  }
}

function childProcessHasExited(child: ChildProcessWithoutNullStreams) {
  return child.exitCode !== null || child.signalCode !== null;
}

function stopChildProcessTree(child: ChildProcessWithoutNullStreams) {
  if (childProcessHasExited(child)) return;
  try { child.kill(); } catch {}
  if (process.platform === "win32" && typeof child.pid === "number") {
    try {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5000,
      });
    } catch {}
  }
}

function stopOrphanedBaslerPreviewStreams(): number {
  if (process.platform !== "win32") return 0;
  const command = [
    "$matches = Get-CimInstance Win32_Process | Where-Object {",
    "$_.ProcessId -ne $PID -and $_.CommandLine -and",
    "$_.CommandLine -like '*basler-pylon-bridge.ps1*' -and",
    "$_.CommandLine -like '*operator-preview-mjpeg-stream*'",
    "};",
    "$count = @($matches).Count;",
    "foreach ($process in $matches) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue };",
    "Write-Output $count",
  ].join(" ");
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
    const count = Number(String(result.stdout ?? "").trim().split(/\s+/).pop() ?? "0");
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

function waitForChildProcessClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (childProcessHasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (closed: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.off("close", onClose);
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const onExit = () => finish(true);
    const onError = () => finish(true);
    timer = setTimeout(() => finish(false), timeoutMs);
    child.once("close", onClose);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function mockPreviewSvg(frameIndex: number, generatedAt: string): Buffer {
  const pulse = 28 + frameIndex % 44;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1260" viewBox="0 0 900 1260"><rect width="900" height="1260" fill="#141713"/><rect x="198" y="214" width="504" height="705" rx="16" fill="#20261e" stroke="#5bff9d" stroke-width="8"/><g stroke="#ead58c" stroke-opacity=".42" stroke-width="2">${Array.from({ length: 8 }, (_, index) => `<line x1="${100 + index * 100}" y1="0" x2="${100 + index * 100}" y2="1260"/>`).join("")}${Array.from({ length: 11 }, (_, index) => `<line x1="0" y1="${105 + index * 105}" x2="900" y2="${105 + index * 105}"/>`).join("")}</g><circle cx="450" cy="560" r="${pulse}" fill="none" stroke="#5bff9d" stroke-width="5" opacity=".75"/><text x="450" y="1020" text-anchor="middle" font-family="Arial" font-size="42" fill="#f6efd8">AI Grader Preview</text><text x="450" y="1078" text-anchor="middle" font-family="Arial" font-size="24" fill="#c9a85f">mock local stream frame ${frameIndex}</text><text x="450" y="1118" text-anchor="middle" font-family="Arial" font-size="20" fill="#bdb5a8">${generatedAt}</text></svg>`;
  return Buffer.from(svg, "utf-8");
}

function writeMjpegFrame(res: http.ServerResponse, contentType: string, bytes: Buffer, frameIndex: number) {
  res.write(`--${PREVIEW_MJPEG_BOUNDARY}\r\n`);
  res.write(`Content-Type: ${contentType}\r\n`);
  res.write(`Content-Length: ${bytes.length}\r\n`);
  res.write(`X-AI-Grader-Frame-Index: ${frameIndex}\r\n`);
  res.write(`X-AI-Grader-Captured-At: ${new Date().toISOString()}\r\n\r\n`);
  res.write(bytes);
  res.write("\r\n");
}

function setMjpegHeaders(res: http.ServerResponse, origin: string | undefined, config: AiGraderLocalStationBridgeConfig) {
  setCors(res, origin, config);
  res.writeHead(200, {
    "Content-Type": `multipart/x-mixed-replace; boundary=${PREVIEW_MJPEG_BOUNDARY}`,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Connection": "close",
    "X-AI-Grader-Preview": "local-token-gated",
  });
}

const NEXT_ACTION_BY_STEP: Record<AiGraderLocalStationStepId, AiGraderLocalStationBridgeAction> = {
  start_new_card: "start-session",
  verify_fixture_rulers: "launch-preview",
  live_preview_focus_framing: "accept-profile",
  lighting_exposure_tune: "accept-profile",
  accept_capture_profile: "capture-front",
  capture_front: "capture-front",
  prompt_flip_card: "confirm-flip",
  capture_back: "capture-back",
  run_provisional_diagnostics: "run-diagnostics",
  view_unified_report: "calculate-final-grade",
  calculate_final_grade: "finalize-report",
  finalize_publish_report: "generate-label-data",
  label_data_ready: "latest-report",
  safe_off_end_session: "safe-off",
};

function actionLabel(action: AiGraderLocalStationBridgeAction) {
  return action
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstNonEmpty(...values: Array<string | undefined>) {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return value?.trim();
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function normalizeHost(host: string | undefined): string {
  const normalized = (host ?? DEFAULT_AI_GRADER_LOCAL_STATION_BRIDGE_HOST).trim().toLowerCase();
  if (!isLoopbackHost(normalized)) {
    throw new Error("AI Grader station bridge only supports loopback hosts.");
  }
  return normalized;
}

function normalizePort(port: number | string | undefined): number {
  if (port === undefined || port === "") return DEFAULT_AI_GRADER_LOCAL_STATION_BRIDGE_PORT;
  const value = typeof port === "number" ? port : Number(port);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error("AI Grader station bridge port must be an integer from 0 to 65535.");
  }
  return value;
}

function hostForUrl(host: string) {
  return host === "::1" ? "[::1]" : host;
}

function parseMode(value: string | undefined): AiGraderLocalStationBridgeMode {
  if (!value) return "mock";
  if (value === "mock" || value === "real") return value;
  throw new Error("AI Grader station bridge mode must be mock or real.");
}

function parseAllowedOrigins(value: string | undefined, explicit: string[] | undefined): string[] {
  const fromEnv = value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const origins = [...(explicit ?? []), ...fromEnv].map((origin) => origin.trim()).filter(Boolean);
  return origins.length ? Array.from(new Set(origins)) : ["http://127.0.0.1:*", "http://localhost:*"];
}

function debugFlagEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

function pairingCodeIsActive(config: Pick<AiGraderLocalStationBridgeConfig, "stationPairingCode" | "stationPairingExpiresAt">) {
  if (!config.stationPairingCode) return false;
  if (!config.stationPairingExpiresAt) return true;
  const expiresAt = Date.parse(config.stationPairingExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function roundDuty(input: number) {
  const capped = Math.max(0, Math.min(5, input));
  const step = Math.max(0, Math.min(50, Math.round(capped * 10)));
  return { dutyPercent: step / 10, actualLeimacPwmStep: step };
}

function normalizeLightingChannels(input: unknown, options: { allowEmpty: boolean }): number[] {
  const channels = Array.isArray(input) ? input : [1, 2, 3, 4, 5, 6, 7, 8];
  if (
    channels.some((channel) => !Number.isInteger(channel) || channel < 1 || channel > 8) ||
    new Set(channels).size !== channels.length ||
    (!options.allowEmpty && channels.length === 0)
  ) {
    throw new Error(options.allowEmpty
      ? "AI Grader live lighting channels must be unique integers from 1 to 8."
      : "AI Grader capture profile channels must include unique integers from 1 to 8.");
  }
  return [...channels].sort((a, b) => a - b);
}

function validateLiveLightingRequest(value: JsonBody | undefined, current: AiGraderLiveLightingStatus): AiGraderLiveLightingProfile {
  const requestedEnabled = typeof value?.enabled === "boolean" ? value.enabled : current.profile.enabled;
  const requestedDuty = typeof value?.dutyPercent === "number" ? value.dutyPercent : current.profile.dutyPercent;
  if (!Number.isFinite(requestedDuty) || requestedDuty < 0 || requestedDuty > LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT) {
    throw new Error(`AI Grader live lighting duty must be from 0 to ${LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT} percent.`);
  }
  const duty = roundDuty(requestedDuty);
  const channels = normalizeLightingChannels(value?.channels, { allowEmpty: true });
  return {
    enabled: requestedEnabled && duty.dutyPercent > 0 && channels.length > 0,
    dutyPercent: duty.dutyPercent,
    actualLeimacPwmStep: duty.actualLeimacPwmStep,
    channels,
    source: "browser_live_tuning",
    acceptedForCapture: false,
  };
}

function defaultProfile(config: Pick<AiGraderLocalStationBridgeConfig, "duty" | "exposureUs" | "gain">): AiGraderLocalStationAcceptedProfile {
  const duty = roundDuty(config.duty);
  return {
    dutyPercent: duty.dutyPercent,
    actualLeimacPwmStep: duty.actualLeimacPwmStep,
    exposureUs: config.exposureUs,
    gain: config.gain,
    channels: [1, 2, 3, 4, 5, 6, 7, 8],
    source: "default",
  };
}

export function buildAiGraderLocalStationBridgeConfig(
  input: AiGraderLocalStationBridgeConfigInput = {},
  env: NodeJS.ProcessEnv = process.env
): AiGraderLocalStationBridgeConfig {
  const enabled = input.enabled ?? env.AI_GRADER_LOCAL_STATION_ENABLED === "true";
  const mode = input.mode ?? parseMode(env.AI_GRADER_STATION_BRIDGE_MODE);
  const outputDir = firstNonEmpty(input.outputDir, env.AI_GRADER_STATION_OUTPUT_DIR) ?? "C:\\TenKings\\capture-data\\ai-grader-station";
  const stationToken = firstNonEmpty(input.stationToken, env.AI_GRADER_STATION_BRIDGE_TOKEN) ?? (mode === "mock" ? "local-dev-token" : "");
  const stationPairingCode = firstNonEmpty(input.stationPairingCode, env.AI_GRADER_STATION_PAIRING_CODE);
  const stationPairingExpiresAt = firstNonEmpty(input.stationPairingExpiresAt, env.AI_GRADER_STATION_PAIRING_EXPIRES_AT);
  if (!enabled) {
    throw new Error("AI Grader station bridge requires --enable-local-station or AI_GRADER_LOCAL_STATION_ENABLED=true.");
  }
  assertFixedRigOutputDirAllowed(outputDir);
  if (stationPairingCode && stationPairingCode.length < 16) {
    throw new Error("AI Grader station bridge pairing code must be at least 16 characters.");
  }
  if (mode === "real") {
    if (!stationToken || stationToken.length < 16) {
      throw new Error("AI Grader station bridge real mode requires a station token of at least 16 characters.");
    }
    if (!input.apply) throw new Error("AI Grader station bridge real mode requires --apply.");
    if (!input.markPresent) throw new Error("AI Grader station bridge real mode requires --mark-present.");
    if (!input.wiringConfirmed) throw new Error("AI Grader station bridge real mode requires --wiring-confirmed.");
    if (!input.leimacStatusGreen) throw new Error("AI Grader station bridge real mode requires --leimac-status-green.");
    if (!firstNonEmpty(input.leimacHost, env.AI_GRADER_STATION_LEIMAC_HOST)) {
      throw new Error("AI Grader station bridge real mode requires --leimac-host <ip>.");
    }
  }
  const exposureUs = input.exposureUs ?? Number(env.AI_GRADER_STATION_EXPOSURE_US ?? FIXED_RIG_SELECTED_EXPOSURE_US);
  const gain = input.gain ?? Number(env.AI_GRADER_STATION_GAIN ?? FIXED_RIG_SELECTED_GAIN);
  const duty = input.duty ?? Number(env.AI_GRADER_STATION_DUTY_PERCENT ?? FIXED_RIG_SELECTED_LEIMAC_DUTY);
  if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
    throw new Error("AI Grader station bridge exposure must be an integer from 1 to 100000 us.");
  }
  if (!Number.isFinite(gain) || gain < 0) throw new Error("AI Grader station bridge gain must be non-negative.");
  if (!Number.isFinite(duty) || duty < 0 || duty > 5) throw new Error("AI Grader station bridge duty must be from 0 to 5 percent.");
  return {
    enabled,
    host: normalizeHost(firstNonEmpty(input.host, env.AI_GRADER_STATION_BRIDGE_HOST)),
    port: normalizePort(input.port ?? env.AI_GRADER_STATION_BRIDGE_PORT),
    mode,
    localOnly: true,
    stationToken,
    stationPairingCode,
    stationPairingExpiresAt,
    allowedOrigins: parseAllowedOrigins(env.AI_GRADER_STATION_ALLOWED_ORIGINS, input.allowedOrigins),
    outputDir,
    reportBundleOutputDir: firstNonEmpty(input.reportBundleOutputDir, env.AI_GRADER_REPORT_BUNDLE_OUTPUT_DIR),
    publicBasePath: firstNonEmpty(input.publicBasePath, env.AI_GRADER_REPORT_PUBLIC_BASE_PATH),
    apply: input.apply === true,
    markPresent: input.markPresent === true,
    wiringConfirmed: input.wiringConfirmed === true,
    leimacStatusGreen: input.leimacStatusGreen === true,
    leimacHost: firstNonEmpty(input.leimacHost, env.AI_GRADER_STATION_LEIMAC_HOST),
    leimacPort: input.leimacPort,
    leimacTimeoutMs: input.leimacTimeoutMs,
    leimacUnit: input.leimacUnit,
    pylonRoot: firstNonEmpty(input.pylonRoot, env.AI_GRADER_STATION_PYLON_ROOT),
    pylonTimeoutMs: input.pylonTimeoutMs,
    baslerBridgeScript: firstNonEmpty(input.baslerBridgeScript, env.AI_GRADER_STATION_BASLER_BRIDGE_SCRIPT),
    cameraIndex: input.cameraIndex,
    exposureUs,
    gain,
    duty,
    warmRunnerDisabled: input.warmRunnerDisabled ?? debugFlagEnabled(env.AI_GRADER_WARM_RUNNER_DISABLED),
    fixtureLabel: input.fixtureLabel,
    fixtureId: input.fixtureId,
    referenceType: input.referenceType,
    horizontalSpanMm: input.horizontalSpanMm,
    horizontalStartPx: input.horizontalStartPx,
    horizontalEndPx: input.horizontalEndPx,
    verticalSpanMm: input.verticalSpanMm,
    verticalStartPx: input.verticalStartPx,
    verticalEndPx: input.verticalEndPx,
    cardBoundaryRect: input.cardBoundaryRect,
  };
}

function newManifest(config: AiGraderLocalStationBridgeConfig): AiGraderLocalStationBridgeManifest {
  return {
    schemaVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
    stationId: "local-dell-ai-grader-station",
    currentStep: "start_new_card",
    mode: config.mode,
    updatedAt: new Date().toISOString(),
    acceptedProfile: defaultProfile(config),
    executionPath: config.warmRunnerDisabled ? "cold_command_fallback" : "warm_full_forensic_runner",
    fallbackUsed: config.warmRunnerDisabled,
    ...(config.warmRunnerDisabled ? { fallbackReason: "Warm runner disabled by explicit debug flag." } : {}),
    confirmations: {
      lightIdleOff: false,
      fixtureRulersVisible: false,
      flipComplete: false,
      finalLightOff: false,
    },
    outputs: {},
    safety: {
      localOnly: true,
      hardwareAccessed: false,
      databaseWrites: false,
      migrationsRun: false,
      deployRun: false,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
      highDutyLighting: false,
      capturedImagesCommitted: false,
      finalGradeComputed: false,
      certifiedClaim: false,
      labelGenerated: false,
      qrGenerated: false,
      certificateGenerated: false,
    },
    liveLighting: defaultLiveLightingStatus(config),
    previewStatus: defaultPreviewStatus(config),
    warmRunnerStatus: defaultWarmRunnerStatus(config),
    commandResults: [],
    progressLog: ["Station bridge initialized. No hardware action has run."],
    warnings: [
      "Provisional diagnostic only; not certified and no final grade.",
      config.mode === "real"
        ? "Real bridge mode is enabled, but each hardware action still requires local token and staged operator confirmations."
        : "Mock bridge mode is active; hardware success is not claimed.",
    ],
  };
}

function fullForensicEvidenceRoles(status: AiGraderWarmRunnerPhaseStatus = "pending"): AiGraderWarmRunnerEvidenceRole[] {
  return [
    { role: "dark_control", label: "Dark control", required: true, status },
    { role: "all_on", label: "All-on", required: true, status },
    { role: "accepted_profile", label: "Accepted profile", required: true, status },
    ...Array.from({ length: 8 }, (_, index) => {
      const channel = index + 1;
      return {
        role: `channel_${channel}` as AiGraderWarmRunnerEvidenceRole["role"],
        label: `Leimac channel ${channel}`,
        required: true as const,
        status,
      };
    }),
  ];
}

function defaultWarmRunnerStatus(config?: Pick<AiGraderLocalStationBridgeConfig, "warmRunnerDisabled">): AiGraderWarmRunnerStatus {
  const fallbackDisabled = config?.warmRunnerDisabled === true;
  return {
    enabled: true,
    mode: "full_forensic",
    backend: fallbackDisabled ? "cold_command_fallback" : "warm_full_forensic_runner",
    executionPath: fallbackDisabled ? "cold_command_fallback" : "warm_full_forensic_runner",
    fallbackUsed: fallbackDisabled,
    ...(fallbackDisabled ? { fallbackReason: "Warm runner disabled by explicit debug flag." } : {}),
    status: "idle",
    captureLock: {
      held: false,
    },
    previewPolicy: {
      pauseDuringCapture: true,
      resumeAfterSafeIdle: true,
      holdPreviewDuringFullForensicRun: true,
      holdActive: false,
    },
    evidencePlan: {
      defaultFullForensic: true,
      rolesBySide: {
        front: fullForensicEvidenceRoles(),
        back: fullForensicEvidenceRoles(),
      },
      preservedOutputs: [
        "front_evidence",
        "back_evidence",
        "roi_display_crops",
        "surface_intelligence",
        "vision_lab",
        "unified_report",
      ],
    },
    queues: {
      capture: [],
      processing: [],
      report: [],
    },
    phases: [],
    timing: {
      baselineTotalMs: 461000,
      targetTotalMinMs: 60000,
      targetTotalMaxMs: 150000,
      stretchTargetMs: 60000,
    },
    fallback: {
      available: true,
      active: fallbackDisabled,
      ...(fallbackDisabled ? { reason: "Warm runner disabled by explicit debug flag." } : {}),
    },
    safety: {
      captureLock: true,
      watchdogSafeOff: true,
      safeOffOnFailure: true,
      safeOffOnCancellation: true,
      safeOffOnSessionEnd: true,
      fallbackToColdPath: true,
      publicRouteExposed: false,
      productionServiceTokenUsed: false,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
    },
    note:
      fallbackDisabled
        ? "Full forensic evidence remains the default, but this run is explicitly using the cold command fallback because the warm runner was disabled by debug flag."
        : "Full forensic evidence remains the default. Speed comes from the bridge-owned warm full forensic runner, persistent side-batch camera ownership, state-aware Leimac writes, capture/process/report queues, preview locking, and safe cleanup.",
  };
}

function defaultPreviewStatus(config: AiGraderLocalStationBridgeConfig): AiGraderLocalStationPreviewStatus {
  return {
    status: "not_started",
    implementationType: config.mode === "real" ? "mjpeg_fetch_stream" : "mock_mjpeg_stream",
    browserEmbedded: true,
    localOnly: true,
    tokenRequired: true,
    streamPath: "/preview/stream",
    statusPath: "/preview/status",
    portraitOrientation: true,
    cameraOwnership: "idle",
    frameSource: config.mode === "real" ? "basler_pylon_continuous_grab" : "mock_station_preview",
    frameCount: 0,
    safety: {
      publicRouteExposed: false,
      requiresStationToken: true,
      bindsLoopbackOnly: true,
      productionServiceTokenUsed: false,
      lightingCommanded: false,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
    },
    note:
      config.mode === "real"
        ? "Embedded browser preview uses a token-gated loopback MJPEG fetch stream. Capture actions pause/release the preview stream before taking camera ownership."
        : "Mock bridge preview uses a local MJPEG-compatible stream for UI/testing only and does not open hardware.",
  };
}

function defaultLiveLightingStatus(config: AiGraderLocalStationBridgeConfig): AiGraderLiveLightingStatus {
  const profile = defaultProfile(config);
  return {
    status: config.mode === "real" && config.leimacHost ? "off" : config.mode === "mock" ? "off" : "unavailable",
    mode: "browser_live_tuning",
    localOnly: true,
    tokenRequired: true,
    controlsEnabled: config.mode === "mock" || Boolean(config.leimacHost),
    previewRequired: true,
    profile: {
      enabled: false,
      dutyPercent: profile.dutyPercent,
      actualLeimacPwmStep: profile.actualLeimacPwmStep,
      channels: profile.channels,
      source: "default",
      acceptedForCapture: false,
    },
    applied: {
      enabled: false,
      dutyPercent: 0,
      actualLeimacPwmStep: 0,
      channels: [],
    },
    watchdog: {
      enabled: true,
      timeoutMs: LIVE_LIGHTING_WATCHDOG_MS,
    },
    connection: {
      state: config.mode === "mock" ? "mock" : config.leimacHost ? "idle" : "not_configured",
      persistentLeimacSession: false,
    },
    safety: {
      publicRouteExposed: false,
      requiresStationToken: true,
      bindsLoopbackOnly: true,
      productionServiceTokenUsed: false,
      lowDutyCapEnforced: true,
      maxDutyPercent: LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT,
      safeOffOnAllOff: true,
      safeOffOnDisconnect: true,
      safeOffOnTimeout: true,
      safeOffOnCaptureStart: true,
      safeOffOnCaptureFailure: true,
      safeOffOnSessionEnd: true,
      persistentLeimacSaved: false,
      arbitraryWritesAllowed: false,
    },
    safetyEvents: [],
    note:
      "Browser live lighting tuning is local-only through the paired Dell bridge. Live edits command Leimac for visual tuning only until the operator accepts the profile for capture.",
  };
}

function mergeConfirmations(
  manifest: AiGraderLocalStationBridgeManifest,
  confirmations: Partial<AiGraderLocalStationBridgeManifest["confirmations"]> | undefined
) {
  if (!confirmations) return;
  manifest.confirmations = {
    ...manifest.confirmations,
    ...Object.fromEntries(Object.entries(confirmations).filter(([, value]) => typeof value === "boolean")),
  };
}

function validateProfile(profile: Partial<AiGraderLocalStationAcceptedProfile> | undefined, current: AiGraderLocalStationAcceptedProfile): AiGraderLocalStationAcceptedProfile {
  if (!profile) return current;
  const requestedDuty = typeof profile.dutyPercent === "number" ? profile.dutyPercent : current.dutyPercent;
  if (!Number.isFinite(requestedDuty) || requestedDuty < 0 || requestedDuty > 5) {
    throw new Error("Accepted AI Grader station duty must be from 0 to 5 percent.");
  }
  const exposureUs = typeof profile.exposureUs === "number" ? profile.exposureUs : current.exposureUs;
  if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
    throw new Error("Accepted AI Grader station exposure must be from 1 to 100000 us.");
  }
  const gain = typeof profile.gain === "number" ? profile.gain : current.gain;
  if (!Number.isFinite(gain) || gain < 0) throw new Error("Accepted AI Grader station gain must be non-negative.");
  const channels = normalizeLightingChannels(Array.isArray(profile.channels) ? profile.channels : current.channels, { allowEmpty: false });
  const duty = roundDuty(requestedDuty);
  return {
    dutyPercent: duty.dutyPercent,
    actualLeimacPwmStep: duty.actualLeimacPwmStep,
    exposureUs,
    gain,
    channels,
    source: profile.source ?? "bridge_operator",
    acceptedAt: new Date().toISOString(),
  };
}

function buildFixedRigProfile(profile: AiGraderLocalStationAcceptedProfile): FixedRigActiveLightingProfile {
  return buildFixedRigActiveLightingProfile({
    selectedDutyPercent: profile.dutyPercent,
    selectedChannels: profile.channels,
    profileSource: profile.source === "browser_live_tuning"
      ? "browser_live_tuning"
      : profile.source === "default"
        ? "default"
        : profile.source === "cli_override"
          ? "cli_override"
          : "operator_preview",
    acceptedAt: profile.acceptedAt,
  });
}

function extractPackageDir(payload: any): string | undefined {
  return payload?.packageDir ?? payload?.manifest?.packageDir ?? payload?.report?.packageDir;
}

function extractUnifiedReportPath(payload: any): string | undefined {
  return payload?.report?.reportPath ?? payload?.report?.reportHtmlPath ?? payload?.manifest?.reportPath;
}

function dirnameIfFile(filePath: string | undefined) {
  if (!filePath) return undefined;
  return path.dirname(filePath);
}

function commandInput(config: AiGraderLocalStationBridgeConfig, manifest: AiGraderLocalStationBridgeManifest): AiGraderStationRealWorkflowInput {
  return {
    outputDir: config.outputDir,
    leimacHost: config.leimacHost ?? "",
    leimacPort: config.leimacPort,
    leimacTimeoutMs: config.leimacTimeoutMs,
    leimacUnit: config.leimacUnit,
    pylonRoot: config.pylonRoot,
    pylonTimeoutMs: config.pylonTimeoutMs,
    baslerBridgeScript: config.baslerBridgeScript,
    cameraIndex: config.cameraIndex,
    exposureUs: manifest.acceptedProfile.exposureUs,
    gain: manifest.acceptedProfile.gain,
    duty: manifest.acceptedProfile.dutyPercent,
    markPresent: config.markPresent,
    wiringConfirmed: config.wiringConfirmed,
    leimacStatusGreen: config.leimacStatusGreen,
    operatorConfirmedLightIdleOff: manifest.confirmations.lightIdleOff,
    operatorFlipConfirmed: manifest.confirmations.flipComplete,
    operatorConfirmedFixtureRulersVisible: manifest.confirmations.fixtureRulersVisible,
    operatorConfirmedFinalLightOff: manifest.confirmations.finalLightOff,
    fixtureLabel: config.fixtureLabel,
    fixtureId: config.fixtureId,
    referenceType: config.referenceType,
    horizontalSpanMm: config.horizontalSpanMm,
    horizontalStartPx: config.horizontalStartPx,
    horizontalEndPx: config.horizontalEndPx,
    verticalSpanMm: config.verticalSpanMm,
    verticalStartPx: config.verticalStartPx,
    verticalEndPx: config.verticalEndPx,
    cardBoundaryRect: config.cardBoundaryRect,
  };
}

function stepById(config: AiGraderLocalStationBridgeConfig, manifest: AiGraderLocalStationBridgeManifest, id: AiGraderStationCommandStep["id"]) {
  const plan = buildAiGraderStationRealCommandPlan(commandInput(config, manifest));
  const step = plan.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`AI Grader station command plan missing step ${id}.`);
  return step;
}

function assertRealReady(config: AiGraderLocalStationBridgeConfig, manifest: AiGraderLocalStationBridgeManifest) {
  if (config.mode !== "real") return;
  if (!config.apply || !config.markPresent || !config.wiringConfirmed || !config.leimacStatusGreen || !config.leimacHost) {
    throw new Error("Real AI Grader station bridge is not armed with required apply/Mark/wiring/Leimac flags.");
  }
  if (!manifest.confirmations.lightIdleOff) throw new Error("Mark must confirm physical ring light is idle/off before hardware actions.");
}

function assertFixtureVisible(manifest: AiGraderLocalStationBridgeManifest) {
  if (!manifest.confirmations.fixtureRulersVisible) {
    throw new Error("Mark must confirm fixture/rulers are visible before capture actions.");
  }
}

function assertFlipComplete(manifest: AiGraderLocalStationBridgeManifest) {
  if (!manifest.confirmations.flipComplete) throw new Error("Mark must confirm card flip is complete before back capture.");
}

async function writeSessionManifest(manifest: AiGraderLocalStationBridgeManifest) {
  if (!manifest.outputs.sessionDir) return;
  const manifestPath = manifest.outputs.manifestPath ?? path.join(manifest.outputs.sessionDir, "station-session.json");
  manifest.outputs.manifestPath = manifestPath;
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

async function runStepOrMock(
  config: AiGraderLocalStationBridgeConfig,
  manifest: AiGraderLocalStationBridgeManifest,
  runner: AiGraderStationCommandRunner,
  step: AiGraderStationCommandStep
): Promise<AiGraderStationCommandResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const finish = (result: AiGraderStationCommandResult): AiGraderStationCommandResult => {
    const finishedAtMs = Date.now();
    return {
      ...result,
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
    };
  };
  manifest.safety.hardwareAccessed = manifest.safety.hardwareAccessed || config.mode === "real" && step.hardwareAccess;
  if (config.mode === "mock") {
    return finish({
      stepId: step.id,
      ok: true,
      exitCode: 0,
      payload: {
        ok: true,
        packageDir: path.join(manifest.outputs.sessionDir ?? config.outputDir, `mock-${step.id}`),
        report: step.id === "unified_report"
          ? {
              packageDir: path.join(manifest.outputs.sessionDir ?? config.outputDir, "mock-unified-report"),
              reportPath: path.join(manifest.outputs.sessionDir ?? config.outputDir, "mock-unified-report", "provisional-diagnostic-report.html"),
            }
          : undefined,
        acceptedLightingProfile: step.id === "operator_preview" ? buildFixedRigProfile(manifest.acceptedProfile) : undefined,
      },
    });
  }
  return finish(await runner.run(step));
}

function reportRoute(reportId: string | undefined) {
  return `/ai-grader/reports/${encodeURIComponent(reportId || "local-ai-grader-report")}`;
}

function bridgeEndpoints() {
    const actions: Array<{
      method: "GET" | "POST";
      action: AiGraderLocalStationBridgeAction | "preview-status" | "preview-stream" | "preview-stop" | "lighting-status" | "lighting-apply" | "lighting-safe-off" | "lighting-accept" | "lighting-heartbeat";
      hardwareAccess: boolean;
      description: string;
      path?: string;
    }> = [
    { method: "GET", action: "status", hardwareAccess: false, description: "Read current local station bridge status." },
    { method: "GET", action: "preview-status", path: "/preview/status", hardwareAccess: false, description: "Read embedded browser preview stream status." },
    { method: "GET", action: "preview-stream", path: "/preview/stream", hardwareAccess: true, description: "Open token-gated local MJPEG browser preview stream." },
    { method: "POST", action: "preview-stop", path: "/preview/stop", hardwareAccess: true, description: "Stop embedded browser preview and wait for Basler camera release before capture." },
    { method: "GET", action: "lighting-status", path: "/lighting/status", hardwareAccess: false, description: "Read browser live Leimac lighting tuning status." },
    { method: "POST", action: "lighting-apply", path: "/lighting/apply", hardwareAccess: true, description: "Apply low-duty browser live Leimac lighting for preview tuning." },
    { method: "POST", action: "lighting-safe-off", path: "/lighting/safe-off", hardwareAccess: true, description: "Safe-off browser live Leimac lighting." },
    { method: "POST", action: "lighting-accept", path: "/lighting/accept", hardwareAccess: false, description: "Accept current browser live lighting profile for warm capture." },
    { method: "POST", action: "lighting-heartbeat", path: "/lighting/heartbeat", hardwareAccess: false, description: "Keep browser live lighting watchdog alive while the operator page is connected." },
    { method: "POST", action: "start-session", hardwareAccess: false, description: "Create a local station session folder and manifest." },
    { method: "POST", action: "confirm-light-idle-off", hardwareAccess: false, description: "Record operator light-idle/off confirmation." },
    { method: "POST", action: "confirm-fixture-rulers", hardwareAccess: false, description: "Record operator fixture/ruler visibility confirmation." },
    { method: "POST", action: "launch-preview", hardwareAccess: true, description: "Run the existing Basler live preview/focus/framing command." },
    { method: "POST", action: "accept-profile", hardwareAccess: false, description: "Accept the current software capture profile." },
    { method: "POST", action: "capture-front", hardwareAccess: true, description: "Run front fixed-rig evidence capture." },
    { method: "POST", action: "confirm-flip", hardwareAccess: false, description: "Record operator flip confirmation." },
    { method: "POST", action: "capture-back", hardwareAccess: true, description: "Run back fixed-rig evidence capture after flip confirmation." },
    { method: "POST", action: "run-diagnostics", hardwareAccess: false, description: "Generate the unified provisional diagnostic report." },
    { method: "POST", action: "export-report-bundle", hardwareAccess: false, description: "Export report-bundle.json, asset manifest, and checksums." },
    { method: "POST", action: "calculate-final-grade", hardwareAccess: false, description: "Calculate the V0 final AI-Grader grade from the report bundle." },
    { method: "POST", action: "finalize-report", hardwareAccess: false, description: "Record operator finalization metadata and write production-release.json." },
    { method: "POST", action: "publish-report", hardwareAccess: false, description: "Prepare local publication manifest and future public report URL data." },
    { method: "POST", action: "generate-label-data", hardwareAccess: false, description: "Write label-ready JSON and QR payload URL data." },
    { method: "POST", action: "safe-off", hardwareAccess: true, description: "Run guarded Leimac safe-off cleanup." },
    { method: "POST", action: "cancel-session", hardwareAccess: true, description: "Cancel the local station session and run guarded safe-off cleanup." },
    { method: "GET", action: "latest-report", hardwareAccess: false, description: "Read latest report location." },
    { method: "GET", action: "session-manifest", hardwareAccess: false, description: "Read station manifest path and state." },
    { method: "POST", action: "end-session", hardwareAccess: false, description: "End the local station session." },
  ];
  return actions.map((endpoint) => ({
    ...endpoint,
    path: endpoint.path ?? (endpoint.method === "GET" ? `/${endpoint.action}` : `/actions/${endpoint.action}`),
  }));
}

function safeJsonParse(text: string): any | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function readJsonFile(filePath: string): Promise<any | undefined> {
  try {
    return safeJsonParse(await readFile(filePath, "utf-8"));
  } catch {
    return undefined;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function timingSummary(results: AiGraderStationCommandResult[], warmRunnerStatus?: AiGraderWarmRunnerStatus): AiGraderLocalStationTimingSummary {
  const entries = results
    .filter((result) => typeof result.durationMs === "number")
    .map((result) => ({
      stepId: result.stepId,
      durationMs: result.durationMs ?? 0,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      category: timingCategory(result.stepId),
      label: timingLabel(result.stepId),
    }));
  const warmEntries = (warmRunnerStatus?.phases ?? [])
    .filter((phase) => typeof phase.durationMs === "number")
    .map((phase) => ({
      stepId: phase.id,
      durationMs: phase.durationMs ?? 0,
      startedAt: phase.startedAt,
      finishedAt: phase.finishedAt,
      category: timingCategory(phase.id),
      label: phase.label,
      detail: phase.detail,
    }));
  const allEntries = [...entries, ...warmEntries];
  const durationFor = (stepIds: string[]) =>
    allEntries
      .filter((entry) => stepIds.includes(entry.stepId))
      .reduce((sum, entry) => sum + entry.durationMs, 0);
  const totalCommandMs = allEntries.reduce((sum, entry) => sum + entry.durationMs, 0);
  const detailedEntries = [
    ...allEntries,
    ...results.flatMap((result) => extractDetailedTimingEntries(result)),
  ];
  const frontPackageMs = durationFor(["capture_front"]);
  const backPackageMs = durationFor(["capture_back"]);
  const reportGenerationMs = durationFor(["unified_report"]);
  const safeOffMs = durationFor(["safe_off"]);
  const phaseBreakdown = {
    frontPackageMs: frontPackageMs || undefined,
    backPackageMs: backPackageMs || undefined,
    unifiedReportHtmlGenerationMs: reportGenerationMs || undefined,
    leimacSafeOffMs: safeOffMs || undefined,
    baslerOpenMs: sumDetailed(detailedEntries, "basler.open"),
    baslerCaptureMs: sumDetailed(detailedEntries, "basler.grab"),
    imageSaveMs: sumDetailed(detailedEntries, "image.save"),
    hashMs: sumDetailed(detailedEntries, "image.hash"),
    cameraCloseDisposeMs: sumDetailed(detailedEntries, "basler.close_dispose"),
    leimacWriteAckMs: sumDetailed(detailedEntries, "leimac.write_ack"),
    roiDisplayGenerationMs: sumDetailed(detailedEntries, "processing.roi_display"),
    surfaceIntelligenceVisionLabMs: sumDetailed(detailedEntries, "report.surface_vision_lab"),
    warmSessionSetupMs: sumDetailed(detailedEntries, "warm_session_setup"),
    frontProcessingQueuedMs: sumDetailed(detailedEntries, "process_front_artifacts"),
    backProcessingQueuedMs: sumDetailed(detailedEntries, "process_back_artifacts"),
    reportQueueMs: sumDetailed(detailedEntries, "report_queue"),
    safeCleanupMs: sumDetailed(detailedEntries, "warm_safe_cleanup"),
  };
  return {
    totalCommandMs,
    executionPath: warmRunnerStatus?.executionPath ?? "warm_full_forensic_runner",
    fallbackUsed: warmRunnerStatus?.fallbackUsed ?? false,
    ...(warmRunnerStatus?.fallbackReason ? { fallbackReason: warmRunnerStatus.fallbackReason } : {}),
    bridgeActionOverheadMs: 0,
    captureCommandMs: durationFor(["operator_preview", "capture_front", "capture_back"]),
    reportGenerationMs,
    safeOffMs,
    entries: allEntries,
    detailedEntries,
    phaseBreakdown,
    targetInterCaptureNote:
      warmRunnerStatus?.executionPath === "cold_command_fallback"
        ? "Cold command fallback was used. This run preserves full evidence but does not count for warm-runner speed acceptance."
        : "Warm full forensic runner is active with bridge-owned capture/process/report phases and full forensic evidence preserved.",
  };
}

function timingCategory(stepId: string): AiGraderLocalStationTimingEntry["category"] {
  if (stepId === "operator_preview") return "preview";
  if (stepId === "capture_front" || stepId === "capture_back") return "capture";
  if (stepId === "warm_session_setup" || stepId.startsWith("process_") || stepId === "report_queue") return "warm_runner";
  if (stepId === "unified_report") return "report";
  if (stepId === "safe_off" || stepId === "warm_safe_cleanup") return "safe_off";
  return "bridge";
}

function timingLabel(stepId: string): string {
  switch (stepId) {
    case "operator_preview":
      return "Operator preview command";
    case "capture_front":
      return "Front full forensic evidence package";
    case "capture_back":
      return "Back full forensic evidence package";
    case "unified_report":
      return "Unified report / Vision Lab generation";
    case "safe_off":
      return "Leimac safe-off";
    default:
      return stepId;
  }
}

function sumDetailed(entries: AiGraderLocalStationTimingEntry[], stepId: string): number | undefined {
  const sum = entries
    .filter((entry) => entry.stepId === stepId && typeof entry.durationMs === "number")
    .reduce((total, entry) => total + entry.durationMs, 0);
  return sum || undefined;
}

function extractDetailedTimingEntries(result: AiGraderStationCommandResult): AiGraderLocalStationTimingEntry[] {
  const entries: AiGraderLocalStationTimingEntry[] = [];
  const addTiming = (stepId: string, label: string, timing: any, category: AiGraderLocalStationTimingEntry["category"]) => {
    if (!timing || typeof timing.durationMs !== "number") return;
    entries.push({
      stepId,
      label,
      category,
      durationMs: timing.durationMs,
      startedAt: typeof timing.startedAt === "string" ? timing.startedAt : undefined,
      finishedAt: typeof timing.finishedAt === "string" ? timing.finishedAt : undefined,
      detail: result.stepId,
    });
  };
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    const timing = value.timing;
    if (timing) {
      addTiming("basler.open", "Basler camera open/configure", timing.open, "capture");
      addTiming("basler.grab", "Basler frame grab", timing.grab, "capture");
      addTiming("image.save", "Image save", timing.save, "capture");
      addTiming("image.hash", "Image hash", timing.hash, "capture");
      addTiming("basler.close_dispose", "Basler camera close/dispose", timing.closeDispose, "capture");
    }
    if (typeof value.durationMs === "number" && value.frame?.requestFrame) {
      addTiming("leimac.write_ack", `Leimac ${value.frame.name} write/ack`, value, "capture");
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(result.payload);
  return entries;
}

function gradeBucket(grade: number | undefined): string | undefined {
  if (typeof grade !== "number" || !Number.isFinite(grade)) return undefined;
  return String(Math.max(0, Math.min(10, Math.floor(grade))));
}

function historyItemFromBundle(input: {
  bundle: AiGraderReportBundle;
  productionRelease?: AiGraderProductionRelease;
  reportBundlePath?: string;
  productionReleasePath?: string;
  sessionDir?: string;
}): AiGraderLocalStationReportHistoryItem {
  return {
    reportId: input.bundle.reportId,
    gradingSessionId: input.bundle.gradingSessionId,
    generatedAt: input.bundle.generatedAt,
    status: input.productionRelease?.reportStatus ?? input.bundle.reportStatus,
    viewerPath: reportRoute(input.bundle.reportId),
    localHtmlPath: input.bundle.reportHtmlPath,
    reportBundlePath: input.reportBundlePath,
    productionReleasePath: input.productionReleasePath,
    sessionDir: input.sessionDir,
    frontPackageDir: input.bundle.evidenceReferences.frontPackageDir,
    backPackageDir: input.bundle.evidenceReferences.backPackageDir,
    provisionalOverallGrade: input.bundle.provisionalGrade?.overall,
    finalOverallGrade: input.productionRelease?.finalGrade.overall,
    confidenceBand: input.productionRelease?.finalGrade.confidence.band ?? input.bundle.provisionalGrade?.confidence?.band,
    title: input.bundle.cardIdentity.title,
    category: undefined,
    warnings: input.productionRelease?.warnings ?? input.bundle.warnings,
  };
}

function historyStats(items: AiGraderLocalStationReportHistoryItem[]): AiGraderLocalStationReportHistory["stats"] {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfDay - now.getDay() * 24 * 60 * 60 * 1000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const grades = items
    .map((item) => item.provisionalOverallGrade)
    .filter((grade): grade is number => typeof grade === "number" && Number.isFinite(grade));
  const finalGrades = items
    .map((item) => item.finalOverallGrade)
    .filter((grade): grade is number => typeof grade === "number" && Number.isFinite(grade));
  const gradeCounts: Record<string, number> = {};
  const finalGradeCounts: Record<string, number> = {};
  for (const item of items) {
    const bucket = gradeBucket(item.provisionalOverallGrade);
    if (bucket) gradeCounts[bucket] = (gradeCounts[bucket] ?? 0) + 1;
    const finalBucket = gradeBucket(item.finalOverallGrade);
    if (finalBucket) finalGradeCounts[finalBucket] = (finalGradeCounts[finalBucket] ?? 0) + 1;
  }
  const timestamp = (item: AiGraderLocalStationReportHistoryItem) => item.generatedAt ? new Date(item.generatedAt).getTime() : 0;
  return {
    allTime: items.length,
    monthly: items.filter((item) => timestamp(item) >= startOfMonth).length,
    weekly: items.filter((item) => timestamp(item) >= startOfWeek).length,
    daily: items.filter((item) => timestamp(item) >= startOfDay).length,
    averageProvisionalGrade: grades.length
      ? Number((grades.reduce((sum, grade) => sum + grade, 0) / grades.length).toFixed(2))
      : undefined,
    averageFinalGrade: finalGrades.length
      ? Number((finalGrades.reduce((sum, grade) => sum + grade, 0) / finalGrades.length).toFixed(2))
      : undefined,
    provisionalGradeCounts: gradeCounts,
    finalGradeCounts,
    finalizedCount: finalGrades.length,
    draftCount: items.length - finalGrades.length,
    warningsCount: items.filter((item) => item.warnings.length > 0).length,
  };
}

function latestReportFromHistorySync(outputDir: string): AiGraderLocalStationBridgeStatus["latestReport"] | undefined {
  let entries: ReturnType<typeof readdirSync> = [];
  try {
    entries = readdirSync(outputDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const candidates: Array<{ reportId: string; localHtmlPath: string; generatedAt?: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const stationManifestPath = path.join(outputDir, entry.name, "station-session.json");
    if (!existsSync(stationManifestPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(stationManifestPath, "utf8")) as Partial<AiGraderLocalStationBridgeManifest>;
      const reportId = parsed.reportId?.trim();
      const localHtmlPath = parsed.outputs?.unifiedReportPath;
      if (!reportId || !localHtmlPath || !existsSync(localHtmlPath)) continue;
      candidates.push({ reportId, localHtmlPath, generatedAt: parsed.updatedAt ?? parsed.createdAt });
    } catch {
      continue;
    }
  }

  const latest = candidates.sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")))[0];
  if (!latest) return undefined;
  return {
    reportId: latest.reportId,
    localHtmlPath: latest.localHtmlPath,
    localViewerPath: reportRoute(latest.reportId),
    publicViewerRoute: "/ai-grader/reports/[reportId]",
    exists: true,
  };
}

async function readBundleFromPath(bundlePath: string | undefined): Promise<AiGraderReportBundle | undefined> {
  if (!bundlePath) return undefined;
  const parsed = await readJsonFile(bundlePath);
  return parsed?.schemaVersion === "ai-grader-report-bundle-v0.1" ? parsed as AiGraderReportBundle : undefined;
}

async function readProductionReleaseFromPath(releasePath: string | undefined): Promise<AiGraderProductionRelease | undefined> {
  if (!releasePath) return undefined;
  const parsed = await readJsonFile(releasePath);
  return parsed?.schemaVersion === "ai-grader-production-release-v0.1" ? parsed as AiGraderProductionRelease : undefined;
}

function bundleWithProductionRelease(bundle: AiGraderReportBundle, productionRelease: AiGraderProductionRelease | undefined): AiGraderReportBundle {
  if (!productionRelease) return bundle;
  return {
    ...bundle,
    finalStatus: productionRelease.finalStatus as any,
    finalGradeComputed: productionRelease.finalGradeComputed as any,
    certifiedClaim: false,
    labelGenerated: productionRelease.labelDataGenerated as any,
    qrGenerated: productionRelease.qrPayloadGenerated as any,
    certificateGenerated: false,
    ...(productionRelease ? { productionRelease } : {}),
  } as AiGraderReportBundle;
}

export interface AiGraderWarmForensicRunner {
  captureSide(input: FixedRigWarmEvidencePackageInput): Promise<FixedRigWarmSideCaptureBatch>;
  processSide(batch: FixedRigWarmSideCaptureBatch): Promise<FixedRigWarmEvidencePackageResult>;
}

const defaultWarmForensicRunner: AiGraderWarmForensicRunner = {
  captureSide: captureFixedRigWarmSideBatch,
  processSide: processFixedRigWarmSideBatch,
};

function warmFailureAllowsColdFallback(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { safeToFallback?: unknown; capturesStarted?: unknown };
  return candidate.safeToFallback === true && candidate.capturesStarted === false;
}

export class AiGraderLocalStationBridgeService {
  readonly config: AiGraderLocalStationBridgeConfig;
  readonly runner: AiGraderStationCommandRunner;
  readonly warmRunner: AiGraderWarmForensicRunner;
  readonly stationUrl: string;
  private manifest: AiGraderLocalStationBridgeManifest;
  private previewProcess?: ChildProcessWithoutNullStreams;
  private previewStop?: (reason: string) => void;
  private captureLock?: { owner: string; acquiredAt: string };
  private warmProcessingJobs: Partial<Record<AiGraderWarmRunnerSide, Promise<FixedRigWarmEvidencePackageResult>>> = {};
  private liveLightingWatchdog?: ReturnType<typeof setTimeout>;
  private leimacClient?: LeimacIdmuClient;

  constructor(
    config: AiGraderLocalStationBridgeConfig,
    runner: AiGraderStationCommandRunner = createAiGraderStationCliRunner(),
    warmRunner: AiGraderWarmForensicRunner = defaultWarmForensicRunner
  ) {
    this.config = config;
    this.runner = runner;
    this.warmRunner = warmRunner;
    this.stationUrl = `http://${hostForUrl(config.host)}:${config.port}`;
    this.manifest = newManifest(config);
  }

  status(): AiGraderLocalStationBridgeStatus {
    const nextAction = NEXT_ACTION_BY_STEP[this.manifest.currentStep];
    const reportId = this.manifest.reportId;
    const viewerRoute = reportRoute(reportId);
    const reportReady = Boolean(this.manifest.outputs.unifiedReportPath);
    const latestHistoryReport = reportReady ? undefined : latestReportFromHistorySync(this.config.outputDir);
    return {
      ok: true,
      bridgeVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
      localOnly: true,
      loginRequired: false,
      hardwareActionsEnabled: this.config.mode === "real",
      stationUrl: this.stationUrl,
      nextAction,
      nextActionLabel: actionLabel(nextAction),
      latestReport: latestHistoryReport ?? {
        reportId,
        localHtmlPath: this.manifest.outputs.unifiedReportPath,
        localViewerPath: viewerRoute,
        publicViewerRoute: "/ai-grader/reports/[reportId]",
        exists: reportReady,
      },
      sessionManifest: {
        gradingSessionId: this.manifest.sessionId ?? "pending-local-station-session",
        reportId: reportId ?? "pending-local-station-report",
        status: reportReady ? "hardware_completed" : this.manifest.sessionId ? "hardware_pending" : "planned",
        frontCaptured: Boolean(this.manifest.outputs.frontPackageDir),
        backCaptured: Boolean(this.manifest.outputs.backPackageDir),
        provisionalDiagnosticsRun: reportReady,
      },
      calibrationProfile: {
        referenceType: "fixed_metric_rulers",
        status: this.manifest.confirmations.fixtureRulersVisible ? "operator_verified" : "fixture_rulers_pending",
        isCalibrated: false,
      },
      bridgeContract: {
        endpoints: bridgeEndpoints(),
        realHardwarePending: this.config.mode === "real" ? [] : ["Start the bridge with --station-bridge-mode real, --apply, Mark/wiring/Leimac flags, and a local token to enable hardware actions."],
      },
      publicViewerRoute: viewerRoute,
      bridgeSecurity: {
        tokenRequired: true,
        allowedOrigins: this.config.allowedOrigins,
        host: this.config.host,
        port: this.config.port,
        rejectsNonLoopback: true,
      },
      timingSummary: timingSummary(this.manifest.commandResults, this.manifest.warmRunnerStatus),
      ...this.manifest,
    };
  }

  previewStatus(): AiGraderLocalStationPreviewStatus {
    return this.manifest.previewStatus;
  }

  liveLightingStatus(): AiGraderLiveLightingStatus {
    return this.manifest.liveLighting;
  }

  private updatePreviewStatus(update: Partial<AiGraderLocalStationPreviewStatus>) {
    this.manifest.previewStatus = {
      ...this.manifest.previewStatus,
      ...update,
      safety: {
        ...this.manifest.previewStatus.safety,
        ...(update.safety ?? {}),
      },
    };
  }

  private activateFullForensicPreviewHold(reason: string) {
    if (this.manifest.warmRunnerStatus.previewPolicy.holdActive) return;
    const now = new Date().toISOString();
    this.manifest.warmRunnerStatus.previewPolicy = {
      ...this.manifest.warmRunnerStatus.previewPolicy,
      holdPreviewDuringFullForensicRun: true,
      holdActive: true,
      holdReason: reason,
      lastHoldStartedAt: now,
    };
    this.manifest.progressLog.push(`${now} Browser preview hold active for full forensic capture: ${reason}.`);
  }

  private releaseFullForensicPreviewHold(reason: string) {
    if (!this.manifest.warmRunnerStatus.previewPolicy.holdActive) return;
    const now = new Date().toISOString();
    const currentPolicy = { ...this.manifest.warmRunnerStatus.previewPolicy };
    delete currentPolicy.holdReason;
    this.manifest.warmRunnerStatus.previewPolicy = {
      ...currentPolicy,
      holdPreviewDuringFullForensicRun: true,
      holdActive: false,
      lastHoldReleasedAt: now,
      lastResumeReadyAt: now,
    };
    this.manifest.progressLog.push(`${now} Browser preview hold released: ${reason}.`);
  }

  private updateLiveLightingStatus(update: Partial<AiGraderLiveLightingStatus>) {
    this.manifest.liveLighting = {
      ...this.manifest.liveLighting,
      ...update,
      profile: {
        ...this.manifest.liveLighting.profile,
        ...(update.profile ?? {}),
      },
      applied: {
        ...this.manifest.liveLighting.applied,
        ...(update.applied ?? {}),
      },
      watchdog: {
        ...this.manifest.liveLighting.watchdog,
        ...(update.watchdog ?? {}),
      },
      connection: {
        ...this.manifest.liveLighting.connection,
        ...(update.connection ?? {}),
      },
      safety: {
        ...this.manifest.liveLighting.safety,
        ...(update.safety ?? {}),
      },
    };
  }

  private recordLiveLightingEvent(event: Omit<AiGraderLiveLightingSafetyEvent, "at">) {
    const nextEvent = { at: new Date().toISOString(), ...event };
    this.manifest.liveLighting.safetyEvents = [
      ...this.manifest.liveLighting.safetyEvents.slice(-19),
      nextEvent,
    ];
    this.manifest.progressLog.push(`${nextEvent.at} Browser live lighting ${event.type}: ${event.reason} (${event.ok ? "ok" : "failed"}).`);
  }

  private clearLiveLightingWatchdog() {
    if (this.liveLightingWatchdog) {
      clearTimeout(this.liveLightingWatchdog);
      this.liveLightingWatchdog = undefined;
    }
    this.updateLiveLightingStatus({
      watchdog: {
        enabled: true,
        timeoutMs: LIVE_LIGHTING_WATCHDOG_MS,
        lastHeartbeatAt: this.manifest.liveLighting.watchdog.lastHeartbeatAt,
        expiresAt: undefined,
      },
    });
  }

  private scheduleLiveLightingWatchdog(reason: string) {
    if (this.liveLightingWatchdog) clearTimeout(this.liveLightingWatchdog);
    const lastHeartbeatAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + LIVE_LIGHTING_WATCHDOG_MS).toISOString();
    this.updateLiveLightingStatus({
      watchdog: {
        enabled: true,
        timeoutMs: LIVE_LIGHTING_WATCHDOG_MS,
        lastHeartbeatAt,
        expiresAt,
      },
    });
    this.liveLightingWatchdog = setTimeout(() => {
      void this.safeOffLiveLighting(`watchdog timeout after ${reason}`, "watchdog_safe_off").catch(() => {});
    }, LIVE_LIGHTING_WATCHDOG_MS);
  }

  private assertLiveLightingReady() {
    if (this.captureLock) throw new Error(`AI Grader capture lock is held by ${this.captureLock.owner}; live lighting is unavailable during capture.`);
    if (this.config.mode === "mock") return;
    if (!this.config.apply || !this.config.markPresent || !this.config.wiringConfirmed || !this.config.leimacStatusGreen || !this.config.leimacHost) {
      throw new Error("Browser live lighting requires the real Dell bridge to be armed with Mark/wiring/Leimac confirmations.");
    }
  }

  private liveLeimacClient() {
    if (this.leimacClient) return this.leimacClient;
    if (!this.config.leimacHost) throw new Error("Browser live lighting requires a configured Leimac host.");
    this.leimacClient = new LeimacIdmuClient({
      host: this.config.leimacHost,
      port: this.config.leimacPort,
      timeoutMs: this.config.leimacTimeoutMs,
      unit: this.config.leimacUnit,
    });
    return this.leimacClient;
  }

  private liveLightingFrames(profile: AiGraderLiveLightingProfile): LeimacIdmuWriteFrame[] {
    if (!profile.enabled || profile.dutyPercent <= 0 || profile.channels.length === 0) {
      return buildLeimacIdmuSafeOffFrames(this.config.leimacUnit ?? 1);
    }
    const dutySteps = leimacIdmuDutyPercentToSteps(profile.dutyPercent);
    const dutyValue = String(dutySteps).padStart(4, "0");
    const selected = new Set(profile.channels);
    const channelValues = Array.from({ length: 8 }, (_, index) => {
      const channel = index + 1;
      return {
        channel,
        value: selected.has(channel) ? dutyValue : "0000",
        meaning: selected.has(channel) ? `Browser live tuning PWM duty ${profile.dutyPercent}%` : "Off / disabled",
      };
    });
    const outputValues = Array.from({ length: 8 }, (_, index) => {
      const channel = index + 1;
      return {
        channel,
        value: selected.has(channel) ? "0001" : "0000",
        meaning: selected.has(channel) ? "Lighting output enabled for browser live tuning" : "Off / disabled",
      };
    });
    return [
      ...buildLeimacIdmuSafeOffFrames(this.config.leimacUnit ?? 1),
      composeLeimacIdmuExplicitChannelWriteFrame({
        name: "lightingOutputValue",
        unit: this.config.leimacUnit ?? 1,
        channelValues,
      }),
      composeLeimacIdmuExplicitChannelWriteFrame({
        name: "lightingOutput",
        unit: this.config.leimacUnit ?? 1,
        channelValues: outputValues,
      }),
    ];
  }

  private async writeLiveLightingFrames(frames: LeimacIdmuWriteFrame[]): Promise<Array<LeimacIdmuWriteResult | { responseKind: "mock"; ok: true }>> {
    if (this.config.mode === "mock") {
      return frames.map(() => ({ responseKind: "mock" as const, ok: true as const }));
    }
    const client = this.liveLeimacClient();
    const writes: LeimacIdmuWriteResult[] = [];
    for (const frame of frames) {
      const result = await client.writeAllowlistedFrame(frame);
      writes.push(result);
      if (!result.ok) throw new Error(result.error ?? `Leimac live lighting write ${frame.name} failed.`);
    }
    return writes;
  }

  async applyLiveLighting(request: JsonBody = {}): Promise<AiGraderLiveLightingStatus> {
    this.assertLiveLightingReady();
    if (!this.manifest.sessionId) throw new Error("Start a station session before browser live lighting tuning.");
    const profile = validateLiveLightingRequest(request, this.manifest.liveLighting);
    const currentApplied = this.manifest.liveLighting.applied;
    const sameAsApplied =
      currentApplied.enabled === profile.enabled &&
      currentApplied.dutyPercent === profile.dutyPercent &&
      currentApplied.channels.join(",") === profile.channels.join(",");

    if (sameAsApplied) {
      if (profile.enabled) this.scheduleLiveLightingWatchdog("no-op apply");
      this.updateLiveLightingStatus({ profile });
      this.recordLiveLightingEvent({ type: "heartbeat", reason: "live lighting request matched current applied state", ok: true });
      await writeSessionManifest(this.manifest);
      return this.liveLightingStatus();
    }

    const startedAtMs = Date.now();
    this.updateLiveLightingStatus({
      status: "applying",
      profile,
      connection: { state: this.config.mode === "mock" ? "mock" : "writing", persistentLeimacSession: false },
      lastError: undefined,
    });
    try {
      const writes = await this.writeLiveLightingFrames(this.liveLightingFrames(profile));
      const appliedAt = new Date().toISOString();
      const lastApplyLatencyMs = Math.max(0, Date.now() - startedAtMs);
      this.updateLiveLightingStatus({
        status: profile.enabled ? "on" : "safe_off",
        applied: {
          enabled: profile.enabled,
          dutyPercent: profile.enabled ? profile.dutyPercent : 0,
          actualLeimacPwmStep: profile.enabled ? profile.actualLeimacPwmStep : 0,
          channels: profile.enabled ? profile.channels : [],
          appliedAt,
          lastApplyLatencyMs,
          lastResponseKinds: writes.map((write) => write.responseKind),
        },
        connection: { state: this.config.mode === "mock" ? "mock" : "idle", persistentLeimacSession: false },
      });
      this.recordLiveLightingEvent({ type: profile.enabled ? "apply" : "safe_off", reason: String(request.reason ?? "browser live lighting apply"), ok: true });
      if (profile.enabled) this.scheduleLiveLightingWatchdog("live lighting apply");
      else this.clearLiveLightingWatchdog();
      await writeSessionManifest(this.manifest);
      return this.liveLightingStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser live lighting apply failed.";
      this.updateLiveLightingStatus({
        status: "error",
        lastError: message,
        connection: { state: "error", persistentLeimacSession: false },
      });
      this.recordLiveLightingEvent({ type: "failure_safe_off", reason: message, ok: false });
      try {
        await this.safeOffLiveLighting("live lighting apply failure", "failure_safe_off", { force: true });
      } catch {}
      await writeSessionManifest(this.manifest);
      throw error;
    }
  }

  async heartbeatLiveLighting(reason = "browser live lighting heartbeat"): Promise<AiGraderLiveLightingStatus> {
    if (this.manifest.liveLighting.applied.enabled) this.scheduleLiveLightingWatchdog(reason);
    else this.updateLiveLightingStatus({ watchdog: { enabled: true, timeoutMs: LIVE_LIGHTING_WATCHDOG_MS, lastHeartbeatAt: new Date().toISOString() } });
    this.recordLiveLightingEvent({ type: "heartbeat", reason, ok: true });
    await writeSessionManifest(this.manifest);
    return this.liveLightingStatus();
  }

  async acceptLiveLightingForCapture(request: JsonBody = {}): Promise<AiGraderLiveLightingStatus> {
    if (!this.manifest.sessionId) throw new Error("Start a station session before accepting a browser live lighting profile.");
    const profile = validateLiveLightingRequest({
      enabled: true,
      dutyPercent: request.dutyPercent ?? this.manifest.liveLighting.profile.dutyPercent,
      channels: request.channels ?? this.manifest.liveLighting.profile.channels,
    }, this.manifest.liveLighting);
    if (!profile.enabled || profile.channels.length === 0 || profile.dutyPercent <= 0) {
      throw new Error("Browser live lighting profile must have at least one channel and nonzero duty before it can be accepted for capture.");
    }
    this.manifest.acceptedProfile = validateProfile({
      dutyPercent: profile.dutyPercent,
      exposureUs: typeof request.exposureUs === "number" ? request.exposureUs : this.manifest.acceptedProfile.exposureUs,
      gain: typeof request.gain === "number" ? request.gain : this.manifest.acceptedProfile.gain,
      channels: profile.channels,
      source: "browser_live_tuning",
    }, this.manifest.acceptedProfile);
    const acceptedAt = this.manifest.acceptedProfile.acceptedAt;
    this.updateLiveLightingStatus({
      profile: {
        ...profile,
        acceptedForCapture: true,
        acceptedAt,
      },
    });
    this.manifest.currentStep = "capture_front";
    this.recordLiveLightingEvent({ type: "accept", reason: "operator accepted browser live lighting profile for capture", ok: true });
    await writeSessionManifest(this.manifest);
    return this.liveLightingStatus();
  }

  async safeOffLiveLightingForOperator(reason = "operator requested browser live lighting safe-off"): Promise<AiGraderLiveLightingStatus> {
    await this.safeOffLiveLighting(reason, "safe_off");
    await writeSessionManifest(this.manifest);
    return this.liveLightingStatus();
  }

  private async safeOffLiveLighting(
    reason: string,
    eventType: AiGraderLiveLightingSafetyEvent["type"] = "safe_off",
    options: { force?: boolean } = {}
  ): Promise<void> {
    const shouldSend = options.force === true || this.manifest.liveLighting.applied.enabled || this.manifest.liveLighting.status === "on" || this.manifest.liveLighting.status === "applying";
    this.clearLiveLightingWatchdog();
    if (!shouldSend) {
      this.updateLiveLightingStatus({
        status: "safe_off",
        profile: {
          ...this.manifest.liveLighting.profile,
          enabled: false,
          acceptedForCapture: this.manifest.liveLighting.profile.acceptedForCapture,
        },
        applied: { enabled: false, dutyPercent: 0, actualLeimacPwmStep: 0, channels: [], appliedAt: new Date().toISOString() },
      });
      this.recordLiveLightingEvent({ type: eventType, reason, ok: true });
      return;
    }
    try {
      const writes = await this.writeLiveLightingFrames(buildLeimacIdmuSafeOffFrames(this.config.leimacUnit ?? 1));
      this.updateLiveLightingStatus({
        status: "safe_off",
        profile: {
          ...this.manifest.liveLighting.profile,
          enabled: false,
          acceptedForCapture: this.manifest.liveLighting.profile.acceptedForCapture,
        },
        applied: {
          enabled: false,
          dutyPercent: 0,
          actualLeimacPwmStep: 0,
          channels: [],
          appliedAt: new Date().toISOString(),
          lastResponseKinds: writes.map((write) => write.responseKind),
        },
        connection: { state: this.config.mode === "mock" ? "mock" : "idle", persistentLeimacSession: false },
        lastError: undefined,
      });
      this.recordLiveLightingEvent({ type: eventType, reason, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser live lighting safe-off failed.";
      this.updateLiveLightingStatus({
        status: "error",
        lastError: message,
        connection: { state: "error", persistentLeimacSession: false },
      });
      this.recordLiveLightingEvent({ type: eventType, reason: `${reason}: ${message}`, ok: false });
      throw error;
    }
  }

  private notePreviewFrame(frameCount: number) {
    const now = new Date().toISOString();
    const current = this.manifest.previewStatus;
    const startedMs = current.startedAt ? Date.parse(current.startedAt) : Date.now();
    const elapsedSeconds = Math.max(0.001, (Date.now() - startedMs) / 1000);
    this.updatePreviewStatus({
      status: "live",
      cameraOwnership: "preview_stream",
      frameCount,
      firstFrameAt: current.firstFrameAt ?? now,
      lastFrameAt: now,
      fps: Math.round((frameCount / elapsedSeconds) * 10) / 10,
    });
  }

  private async stopPreviewStream(
    reason: string,
    options: { waitForRelease?: boolean; requireRelease?: boolean; settleMs?: number; captureOwner?: boolean } = {}
  ) {
    const child = this.previewProcess;
    const captureOwner = options.captureOwner === true;
    this.previewStop?.(reason);
    this.previewStop = undefined;
    if (child) stopChildProcessTree(child);
    const stoppedOrphans = await stopOrphanedBaslerPreviewStreamsUntilReleased(
      PREVIEW_RELEASE_TIMEOUT_MS,
      options.settleMs ?? PREVIEW_CAMERA_SETTLE_MS
    );
    if (stoppedOrphans > 0) {
      this.manifest.progressLog.push(`${new Date().toISOString()} Stopped ${stoppedOrphans} orphaned Basler browser preview process(es) during preview release.`);
    }
    if (options.waitForRelease && child) {
      this.updatePreviewStatus({
        status: captureOwner ? "paused_for_capture" : "stopped",
        cameraOwnership: captureOwner ? "capture_action" : "preview_stream",
        lastStopReason: `${reason}; waiting for Basler preview process to release camera.`,
      });
      const released = await waitForChildProcessClose(child, PREVIEW_RELEASE_TIMEOUT_MS);
      if (!released) {
        stopChildProcessTree(child);
        const releasedAfterForceKill = await waitForChildProcessClose(child, 1500);
        if (releasedAfterForceKill) {
          await delay(options.settleMs ?? PREVIEW_CAMERA_SETTLE_MS);
          this.previewProcess = undefined;
          this.updatePreviewStatus({
            status: captureOwner ? "paused_for_capture" : "stopped",
            cameraOwnership: captureOwner ? "capture_action" : "released",
            lastStopReason: `${reason}; preview process tree force-stopped before camera handoff.`,
          });
          return;
        }
        const message = `AI Grader preview stream did not release the Basler camera within ${PREVIEW_RELEASE_TIMEOUT_MS} ms. Close the preview or restart the local bridge before capture.`;
        this.updatePreviewStatus({
          status: "error",
          cameraOwnership: "preview_stream",
          lastError: message,
          lastStopReason: reason,
        });
        if (options.requireRelease) throw new Error(message);
      }
      await delay(options.settleMs ?? PREVIEW_CAMERA_SETTLE_MS);
    }
    this.previewProcess = undefined;
    this.updatePreviewStatus({
      status: captureOwner ? "paused_for_capture" : "stopped",
      cameraOwnership: captureOwner ? "capture_action" : "released",
      lastStopReason: reason,
    });
  }

  async stopPreviewForOperator(reason = "operator requested preview stop"): Promise<AiGraderLocalStationPreviewStatus> {
    await this.stopPreviewStream(reason, { waitForRelease: true, settleMs: PREVIEW_CAMERA_SETTLE_MS });
    this.manifest.progressLog.push(`${new Date().toISOString()} Browser preview stream stopped: ${reason}.`);
    await writeSessionManifest(this.manifest);
    return this.previewStatus();
  }

  private async stopPreviewForHardwareAction(action: string) {
    await this.safeOffLiveLighting(`capture start before ${action}`, "capture_start_safe_off");
    await this.stopPreviewStream(`preview released before ${action} capture action`, {
      waitForRelease: true,
      requireRelease: true,
      settleMs: PREVIEW_CAMERA_SETTLE_MS,
      captureOwner: true,
    });
    this.manifest.warmRunnerStatus.previewPolicy.lastPausedAt = new Date().toISOString();
    this.manifest.progressLog.push(`${new Date().toISOString()} Browser preview stream paused/released before ${action}.`);
    const stoppedOrphans = await stopOrphanedBaslerPreviewStreamsUntilReleased(PREVIEW_RELEASE_TIMEOUT_MS, PREVIEW_CAMERA_SETTLE_MS);
    if (stoppedOrphans > 0) {
      this.manifest.progressLog.push(`${new Date().toISOString()} Stopped ${stoppedOrphans} stale Basler browser preview process(es) before ${action} capture.`);
      await delay(PREVIEW_CAMERA_SETTLE_MS);
    }
    if (this.previewProcess || this.previewStop || this.manifest.previewStatus.cameraOwnership === "preview_stream") {
      throw new Error(`AI Grader preview did not release the Basler camera before ${action} capture.`);
    }
    this.updatePreviewStatus({
      status: "paused_for_capture",
      cameraOwnership: "capture_action",
      lastStopReason: `Preview released and verified before ${action} capture.`,
    });
  }

  private acquireCaptureLock(owner: string) {
    if (this.captureLock) {
      throw new Error(`AI Grader capture lock is already held by ${this.captureLock.owner}.`);
    }
    const acquiredAt = new Date().toISOString();
    this.captureLock = { owner, acquiredAt };
    this.manifest.warmRunnerStatus.captureLock = { held: true, owner, acquiredAt };
    this.manifest.warmRunnerStatus.status = "capturing";
    this.manifest.warmRunnerStatus.activeSide = owner.includes("back") ? "back" : owner.includes("front") ? "front" : undefined;
    this.manifest.progressLog.push(`${acquiredAt} Capture lock acquired by ${owner}.`);
  }

  private releaseCaptureLock(owner: string) {
    if (!this.captureLock) return;
    if (this.captureLock.owner !== owner) {
      throw new Error(`AI Grader capture lock release mismatch: ${owner} cannot release ${this.captureLock.owner}.`);
    }
    const releasedAt = new Date().toISOString();
    this.captureLock = undefined;
    this.manifest.warmRunnerStatus.captureLock = { held: false };
    this.manifest.warmRunnerStatus.activeSide = undefined;
    if (this.manifest.warmRunnerStatus.previewPolicy.holdActive) {
      this.manifest.progressLog.push(`${releasedAt} Capture lock released by ${owner}; preview remains paused for the full forensic grading session.`);
    } else {
      this.manifest.warmRunnerStatus.previewPolicy.lastResumeReadyAt = releasedAt;
      this.manifest.progressLog.push(`${releasedAt} Capture lock released by ${owner}; preview may resume when the browser returns to idle.`);
    }
  }

  private markWarmPhase(input: {
    id: string;
    label: string;
    status: AiGraderWarmRunnerPhaseStatus;
    side?: AiGraderWarmRunnerSide;
    startedAt?: string;
    finishedAt?: string;
    backend?: AiGraderWarmRunnerPhase["backend"];
    executionPath?: AiGraderWarmRunnerPhase["executionPath"];
    detail?: string;
  }): AiGraderWarmRunnerPhase {
    const previous = this.manifest.warmRunnerStatus.phases.find((phase) => phase.id === input.id);
    const startedAt = input.startedAt ?? previous?.startedAt ?? (input.status === "active" ? new Date().toISOString() : undefined);
    const finishedAt = input.finishedAt ?? (input.status === "completed" || input.status === "failed" || input.status === "cancelled" ? new Date().toISOString() : undefined);
    const phase: AiGraderWarmRunnerPhase = {
      id: input.id,
      label: input.label,
      status: input.status,
      ...(input.side ? { side: input.side } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(finishedAt ? { finishedAt } : {}),
      ...(startedAt && finishedAt ? { durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) } : {}),
      ...(input.backend ? { backend: input.backend } : previous?.backend ? { backend: previous.backend } : {}),
      ...(input.executionPath ? { executionPath: input.executionPath } : previous?.executionPath ? { executionPath: previous.executionPath } : {}),
      ...(input.detail ? { detail: input.detail } : previous?.detail ? { detail: previous.detail } : {}),
    };
    const others = this.manifest.warmRunnerStatus.phases.filter((candidate) => candidate.id !== input.id);
    this.manifest.warmRunnerStatus.phases = [...others, phase];
    const queueName = input.id.startsWith("capture_") ? "capture" : input.id.startsWith("process_") ? "processing" : input.id.includes("report") ? "report" : undefined;
    if (queueName) {
      const queue = this.manifest.warmRunnerStatus.queues[queueName].filter((candidate) => candidate.id !== input.id);
      this.manifest.warmRunnerStatus.queues[queueName] = [...queue, phase];
    }
    return phase;
  }

  private updateEvidenceRoles(side: AiGraderWarmRunnerSide, status: AiGraderWarmRunnerPhaseStatus) {
    this.manifest.warmRunnerStatus.evidencePlan.rolesBySide[side] = fullForensicEvidenceRoles(status);
  }

  private setExecutionPath(pathName: AiGraderWarmRunnerExecutionPath, fallbackReason?: string) {
    this.manifest.executionPath = pathName;
    this.manifest.fallbackUsed = pathName === "cold_command_fallback";
    if (fallbackReason) this.manifest.fallbackReason = fallbackReason;
    else delete this.manifest.fallbackReason;
    this.manifest.warmRunnerStatus.backend = pathName;
    this.manifest.warmRunnerStatus.executionPath = pathName;
    this.manifest.warmRunnerStatus.fallbackUsed = pathName === "cold_command_fallback";
    if (fallbackReason) this.manifest.warmRunnerStatus.fallbackReason = fallbackReason;
    else delete this.manifest.warmRunnerStatus.fallbackReason;
    this.manifest.warmRunnerStatus.fallback.active = pathName === "cold_command_fallback";
    if (fallbackReason) this.manifest.warmRunnerStatus.fallback.reason = fallbackReason;
    else delete this.manifest.warmRunnerStatus.fallback.reason;
  }

  private buildWarmEvidenceInput(side: AiGraderWarmRunnerSide): FixedRigWarmEvidencePackageInput {
    return {
      outputDir: this.config.outputDir,
      side: side as FixedRigCardSide,
      activeLightingProfile: buildFixedRigProfile(this.manifest.acceptedProfile),
      pylonRoot: this.config.pylonRoot,
      pylonTimeoutMs: this.config.pylonTimeoutMs,
      baslerBridgeScript: this.config.baslerBridgeScript,
      leimacHost: this.config.leimacHost ?? "",
      leimacPort: this.config.leimacPort,
      leimacUnit: this.config.leimacUnit,
      cameraIndex: this.config.cameraIndex,
      exposureUs: this.manifest.acceptedProfile.exposureUs,
      gain: this.manifest.acceptedProfile.gain,
      fixtureLabel: this.config.fixtureLabel,
      fixtureId: this.config.fixtureId,
      referenceType: this.config.referenceType as FixedRigReferenceType | undefined,
      horizontalSpanMm: this.config.horizontalSpanMm,
      horizontalStartPx: this.config.horizontalStartPx,
      horizontalEndPx: this.config.horizontalEndPx,
      verticalSpanMm: this.config.verticalSpanMm,
      verticalStartPx: this.config.verticalStartPx,
      verticalEndPx: this.config.verticalEndPx,
      cardBoundaryRect: this.config.cardBoundaryRect,
    };
  }

  private warmSideCommandResult(side: AiGraderWarmRunnerSide, result: FixedRigWarmEvidencePackageResult, startedAtMs: number, packageDir: string): AiGraderStationCommandResult {
    const finishedAtMs = Date.now();
    return {
      stepId: side === "front" ? "capture_front" : "capture_back",
      ok: true,
      exitCode: 0,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      payload: {
        ok: true,
        executionPath: "warm_full_forensic_runner",
        fallbackUsed: false,
        packageDir,
        manifestPath: result.manifestPath,
        analysisPath: result.analysisPath,
        previewReportPath: result.previewReportPath,
        manifest: result.manifest,
      },
    };
  }

  private async awaitWarmProcessing(side: AiGraderWarmRunnerSide): Promise<FixedRigWarmEvidencePackageResult | undefined> {
    const job = this.warmProcessingJobs[side];
    if (!job) return undefined;
    const result = await job;
    delete this.warmProcessingJobs[side];
    return result;
  }

  private async runSafeOffCleanup(reason: string): Promise<void> {
    if (this.config.mode !== "real") return;
    const cleanupStartedAt = new Date().toISOString();
    this.manifest.warmRunnerStatus.status = "safe_off";
    this.markWarmPhase({
      id: "warm_safe_cleanup",
      label: "Watchdog safe-off cleanup",
      status: "active",
      startedAt: cleanupStartedAt,
      backend: "cold_command_fallback",
      detail: reason,
    });
    try {
      const result = await runStepOrMock(this.config, this.manifest, this.runner, stepById(this.config, this.manifest, "safe_off"));
      this.manifest.commandResults.push(result);
      this.manifest.confirmations.finalLightOff = result.ok || this.manifest.confirmations.finalLightOff;
      this.manifest.progressLog.push(`${new Date().toISOString()} Watchdog safe-off ${result.ok ? "completed" : "failed"} after ${reason}.`);
      if (!result.ok) this.manifest.warnings.push(result.error ?? `Safe-off failed after ${reason}.`);
      this.markWarmPhase({
        id: "warm_safe_cleanup",
        label: "Watchdog safe-off cleanup",
        status: result.ok ? "completed" : "failed",
        startedAt: cleanupStartedAt,
        backend: "cold_command_fallback",
        detail: reason,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Safe-off failed after ${reason}.`;
      this.manifest.warnings.push(message);
      this.markWarmPhase({
        id: "warm_safe_cleanup",
        label: "Watchdog safe-off cleanup",
        status: "failed",
        startedAt: cleanupStartedAt,
        backend: "cold_command_fallback",
        detail: message,
      });
    }
  }

  private async runColdFallbackSideCapture(side: AiGraderWarmRunnerSide, reason: string): Promise<AiGraderStationCommandResult> {
    const stepId = side === "front" ? "capture_front" : "capture_back";
    const owner = `cold-fallback-${stepId}`;
    const phaseId = `capture_${side}`;
    const label = `${side === "front" ? "Front" : "Back"} full forensic capture stack`;
    this.activateFullForensicPreviewHold(`${side} cold fallback full forensic capture starting`);
    this.setExecutionPath("cold_command_fallback", reason);
    this.acquireCaptureLock(owner);
    let phase: AiGraderWarmRunnerPhase | undefined;
    try {
      await this.stopPreviewForHardwareAction(side);
      this.updateEvidenceRoles(side, "active");
      phase = this.markWarmPhase({
        id: phaseId,
        label,
        status: "active",
        side,
        backend: "cold_command_fallback",
        executionPath: "cold_command_fallback",
        detail: "Emergency/debug cold fallback preserves dark_control, all_on, accepted_profile, and Leimac channels 1-8.",
      });
      const result = await runStepOrMock(this.config, this.manifest, this.runner, stepById(this.config, this.manifest, stepId));
      result.payload = {
        ...(result.payload ?? {}),
        executionPath: "cold_command_fallback",
        fallbackUsed: true,
        fallbackReason: reason,
      };
      this.manifest.commandResults.push(result);
      if (!result.ok) {
        this.updateEvidenceRoles(side, "failed");
        this.markWarmPhase({
          id: phaseId,
          label,
          status: "failed",
          side,
          startedAt: phase?.startedAt,
          backend: "cold_command_fallback",
          executionPath: "cold_command_fallback",
          detail: result.error ?? "Cold fallback evidence package failed.",
        });
        throw new Error(result.error ?? `${side} evidence capture failed.`);
      }
      this.updateEvidenceRoles(side, "completed");
      this.markWarmPhase({
        id: phaseId,
        label,
        status: "completed",
        side,
        startedAt: phase?.startedAt,
        backend: "cold_command_fallback",
        executionPath: "cold_command_fallback",
        detail: "Full forensic side stack captured through emergency/debug cold fallback.",
      });
      this.markWarmPhase({
        id: `process_${side}_artifacts`,
        label: `${side === "front" ? "Front" : "Back"} artifact processing queue`,
        status: "completed",
        side,
        backend: "cold_command_fallback",
        executionPath: "cold_command_fallback",
        detail: "Artifacts were processed by the cold evidence package command; this run does not count for speed acceptance.",
      });
      this.manifest.warmRunnerStatus.status = "processing";
      return result;
    } catch (error) {
      this.manifest.warmRunnerStatus.status = "failed";
      await this.runSafeOffCleanup(`${side} cold fallback capture failure`);
      this.manifest.warmRunnerStatus.status = "failed";
      this.releaseFullForensicPreviewHold(`${side} cold fallback capture failed after safe-off cleanup`);
      throw error;
    } finally {
      this.releaseCaptureLock(owner);
    }
  }

  private async runWarmSideCapture(side: AiGraderWarmRunnerSide): Promise<AiGraderStationCommandResult> {
    const stepId = side === "front" ? "capture_front" : "capture_back";
    const owner = `warm-${stepId}`;
    const phaseId = `capture_${side}`;
    const label = `${side === "front" ? "Front" : "Back"} full forensic capture stack`;
    this.activateFullForensicPreviewHold(`${side} warm full forensic capture starting`);
    if (this.config.warmRunnerDisabled) {
      return this.runColdFallbackSideCapture(side, "Warm runner disabled by explicit debug flag.");
    }
    this.acquireCaptureLock(owner);
    const captureStartedAtMs = Date.now();
    let phase: AiGraderWarmRunnerPhase | undefined;
    try {
      await this.stopPreviewForHardwareAction(side);
      this.setExecutionPath("warm_full_forensic_runner");
      this.updateEvidenceRoles(side, "active");
      phase = this.markWarmPhase({
        id: phaseId,
        label,
        status: "active",
        side,
        backend: "warm_full_forensic_runner",
        executionPath: "warm_full_forensic_runner",
        detail: "dark_control, all_on, accepted_profile, and Leimac channels 1-8 remain required.",
      });
      if (this.config.mode === "mock") {
        const finishedAtMs = Date.now();
        const mockPackageDir = path.join(this.manifest.outputs.sessionDir ?? this.config.outputDir, `mock-${stepId}`);
        const result: AiGraderStationCommandResult = {
          stepId,
          ok: true,
          exitCode: 0,
          startedAt: new Date(captureStartedAtMs).toISOString(),
          finishedAt: new Date(finishedAtMs).toISOString(),
          durationMs: Math.max(0, finishedAtMs - captureStartedAtMs),
          payload: {
            ok: true,
            executionPath: "warm_full_forensic_runner",
            fallbackUsed: false,
            packageDir: mockPackageDir,
          },
        };
        this.manifest.commandResults.push(result);
        this.updateEvidenceRoles(side, "completed");
        this.markWarmPhase({
          id: phaseId,
          label,
          status: "completed",
          side,
          startedAt: phase?.startedAt,
          backend: "warm_full_forensic_runner",
          executionPath: "warm_full_forensic_runner",
          detail: "Mock warm full forensic side stack captured for UI/test flow.",
        });
        this.markWarmPhase({
          id: `process_${side}_artifacts`,
          label: `${side === "front" ? "Front" : "Back"} artifact processing queue`,
          status: "completed",
          side,
          backend: "warm_full_forensic_runner",
          executionPath: "warm_full_forensic_runner",
          detail: "Mock processing completed; real mode processes captured artifacts in this queue.",
        });
        this.manifest.warmRunnerStatus.status = "processing";
        return result;
      }

      const batch = await this.warmRunner.captureSide(this.buildWarmEvidenceInput(side));
      const finishedAtMs = Date.now();
      const result: AiGraderStationCommandResult = {
        stepId,
        ok: true,
        exitCode: 0,
        startedAt: new Date(captureStartedAtMs).toISOString(),
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: Math.max(0, finishedAtMs - captureStartedAtMs),
        payload: {
          ok: true,
          executionPath: "warm_full_forensic_runner",
          fallbackUsed: false,
          packageDir: batch.packageDir,
          warmBatch: batch.batch,
        },
      };
      this.manifest.commandResults.push(result);
      this.updateEvidenceRoles(side, "completed");
      this.markWarmPhase({
        id: phaseId,
        label,
        status: "completed",
        side,
        startedAt: phase?.startedAt,
        backend: "warm_full_forensic_runner",
        executionPath: "warm_full_forensic_runner",
        detail: "Full forensic side stack captured through warm Basler/Leimac side batch.",
      });
      const processingPhase = this.markWarmPhase({
        id: `process_${side}_artifacts`,
        label: `${side === "front" ? "Front" : "Back"} artifact processing queue`,
        status: "active",
        side,
        backend: "warm_full_forensic_runner",
        executionPath: "warm_full_forensic_runner",
        detail:
          side === "front"
            ? "Front artifact processing is running during the operator flip window."
            : "Back artifact processing is running before unified report generation.",
      });
      this.warmProcessingJobs[side] = this.warmRunner.processSide(batch).then((processed) => {
        this.markWarmPhase({
          id: `process_${side}_artifacts`,
          label: `${side === "front" ? "Front" : "Back"} artifact processing queue`,
          status: "completed",
          side,
          startedAt: processingPhase.startedAt,
          backend: "warm_full_forensic_runner",
          executionPath: "warm_full_forensic_runner",
          detail: "Warm captured artifacts processed; report-compatible manifest, ROI/display crops, Surface Intelligence inputs, and Vision Lab inputs are ready.",
        });
        return processed;
      }).catch((error) => {
        const message = error instanceof Error ? error.message : `${side} warm artifact processing failed.`;
        this.markWarmPhase({
          id: `process_${side}_artifacts`,
          label: `${side === "front" ? "Front" : "Back"} artifact processing queue`,
          status: "failed",
          side,
          startedAt: processingPhase.startedAt,
          backend: "warm_full_forensic_runner",
          executionPath: "warm_full_forensic_runner",
          detail: message,
        });
        this.manifest.warmRunnerStatus.status = "failed";
        throw error;
      });
      void this.warmProcessingJobs[side]?.catch(() => {});
      this.markWarmPhase({
        id: `process_${side}_artifacts_started`,
        label: `${side === "front" ? "Front" : "Back"} processing started`,
        status: "completed",
        side,
        backend: "warm_full_forensic_runner",
        executionPath: "warm_full_forensic_runner",
        detail: "Background processing queue accepted the warm side batch.",
      });
      this.manifest.warmRunnerStatus.status = "processing";
      return result;
    } catch (error) {
      this.manifest.warmRunnerStatus.status = "failed";
      const allowFallback = warmFailureAllowsColdFallback(error);
      await this.runSafeOffCleanup(`${side} warm capture failure`);
      if (allowFallback) {
        const reason = `${side} warm runner failed before capture started and reported safe fallback eligibility.`;
        this.releaseCaptureLock(owner);
        return this.runColdFallbackSideCapture(side, reason);
      }
      this.manifest.warmRunnerStatus.status = "failed";
      this.releaseFullForensicPreviewHold(`${side} warm capture failed after safe-off cleanup`);
      throw error;
    } finally {
      if (this.captureLock?.owner === owner) this.releaseCaptureLock(owner);
    }
  }

  private async runWarmReport(): Promise<AiGraderStationCommandResult> {
    if (!this.manifest.outputs.frontPackageDir || !this.manifest.outputs.backPackageDir) {
      throw new Error("Unified report requires both front and back evidence package folders.");
    }
    const phase = this.markWarmPhase({
      id: "report_queue",
      label: "Unified report queue",
      status: "active",
      backend: this.manifest.executionPath,
      executionPath: this.manifest.executionPath,
      detail: "Builds from already processed front/back full forensic artifacts.",
    });
    this.manifest.warmRunnerStatus.status = "reporting";
    await Promise.all([this.awaitWarmProcessing("front"), this.awaitWarmProcessing("back")]);
    const step = {
      ...stepById(this.config, this.manifest, "unified_report"),
      args: [
        "ai-grader-fixed-rig-v1-card-report",
        "--output-dir",
        this.config.outputDir,
        "--front-dir",
        this.manifest.outputs.frontPackageDir,
        "--back-dir",
        this.manifest.outputs.backPackageDir,
      ],
    };
    const result = await runStepOrMock(this.config, this.manifest, this.runner, step);
    result.payload = {
      ...(result.payload ?? {}),
      executionPath: this.manifest.executionPath,
      fallbackUsed: this.manifest.fallbackUsed,
      ...(this.manifest.fallbackReason ? { fallbackReason: this.manifest.fallbackReason } : {}),
    };
    this.manifest.commandResults.push(result);
    this.markWarmPhase({
      id: "report_queue",
      label: "Unified report queue",
      status: result.ok ? "completed" : "failed",
      startedAt: phase.startedAt,
      backend: this.manifest.executionPath,
      executionPath: this.manifest.executionPath,
      detail: result.ok ? "Unified report, Surface Intelligence, and Vision Lab outputs preserved." : result.error ?? "Unified report failed.",
    });
    this.manifest.warmRunnerStatus.status = result.ok ? "complete" : "failed";
    if (!result.ok) {
      await this.runSafeOffCleanup("warm report failure");
      this.manifest.warmRunnerStatus.status = "failed";
      throw new Error(result.error ?? "Unified provisional diagnostics failed.");
    }
    return result;
  }

  async streamPreview(req: http.IncomingMessage, res: http.ServerResponse, origin: string | undefined): Promise<void> {
    if (this.captureLock) {
      this.updatePreviewStatus({
        status: "paused_for_capture",
        cameraOwnership: "capture_action",
        lastStopReason: `capture lock held by ${this.captureLock.owner}`,
      });
      sendJson(
        res,
        409,
        {
          ok: false,
          code: "AI_GRADER_CAPTURE_LOCK_HELD",
          message: "AI Grader capture owns the Basler camera; preview will resume after safe idle.",
          result: this.previewStatus(),
        },
        origin,
        this.config
      );
      return Promise.resolve();
    }
    if (this.manifest.warmRunnerStatus.previewPolicy.holdActive) {
      const reason = this.manifest.warmRunnerStatus.previewPolicy.holdReason ?? "full forensic grading session in progress";
      await this.stopPreviewStream(`preview stream blocked during ${reason}`, {
        waitForRelease: true,
        requireRelease: true,
        settleMs: PREVIEW_CAMERA_SETTLE_MS,
      });
      this.updatePreviewStatus({
        status: "paused_for_capture",
        cameraOwnership: "released",
        lastStopReason: `Preview paused while ${reason}.`,
      });
      sendJson(
        res,
        409,
        {
          ok: false,
          code: "AI_GRADER_PREVIEW_PAUSED_FOR_GRADING_SESSION",
          message: "AI Grader preview is paused while the full forensic capture/report session owns Basler access.",
          result: this.previewStatus(),
        },
        origin,
        this.config
      );
      return Promise.resolve();
    }
    await this.stopPreviewStream("new preview stream requested", { waitForRelease: true, settleMs: 100 });
    this.updatePreviewStatus({
      status: "starting",
      implementationType: this.config.mode === "real" ? "mjpeg_fetch_stream" : "mock_mjpeg_stream",
      browserEmbedded: true,
      localOnly: true,
      tokenRequired: true,
      streamPath: "/preview/stream",
      statusPath: "/preview/status",
      portraitOrientation: true,
      cameraOwnership: this.config.mode === "real" ? "preview_stream" : "idle",
      frameSource: this.config.mode === "real" ? "basler_pylon_continuous_grab" : "mock_station_preview",
      frameCount: 0,
      fps: undefined,
      startedAt: new Date().toISOString(),
      firstFrameAt: undefined,
      lastFrameAt: undefined,
      lastError: undefined,
      lastStopReason: undefined,
    });
    setMjpegHeaders(res, origin, this.config);

    return new Promise<void>((resolve) => {
      let settled = false;
      let mockPreviewTimer: ReturnType<typeof setInterval> | undefined;
      const finish = (reason: string) => {
        if (settled) return;
        settled = true;
        if (mockPreviewTimer) {
          clearInterval(mockPreviewTimer);
          mockPreviewTimer = undefined;
        }
        this.previewStop = undefined;
        if (this.previewProcess) stopChildProcessTree(this.previewProcess);
        this.previewProcess = undefined;
        this.updatePreviewStatus({
          status: reason.includes("error") ? "error" : "stopped",
          cameraOwnership: "released",
          lastStopReason: reason,
        });
        try {
          if (!res.destroyed) res.end();
        } catch {}
        resolve();
      };
      this.previewStop = finish;
      req.on("close", () => finish("browser preview client disconnected"));
      res.on("close", () => finish("browser preview response closed"));

      if (this.config.mode === "mock") {
        let frameCount = 0;
        const send = () => {
          if (settled || res.destroyed) return;
          frameCount += 1;
          const generatedAt = new Date().toISOString();
          writeMjpegFrame(res, "image/svg+xml", mockPreviewSvg(frameCount, generatedAt), frameCount);
          this.notePreviewFrame(frameCount);
        };
        send();
        mockPreviewTimer = setInterval(send, 250);
        this.previewStop = (reason: string) => {
          finish(reason);
        };
        return;
      }

      try {
        const client = new BaslerPylonClient({
          pylonRoot: this.config.pylonRoot,
          bridgeScriptPath: this.config.baslerBridgeScript,
          timeoutMs: this.config.pylonTimeoutMs ?? 1800000,
        });
        const child = client.startOperatorPreviewMjpegStream({
          cameraIndex: this.config.cameraIndex,
          exposureUs: this.manifest.acceptedProfile.exposureUs,
          refreshIntervalMs: 100,
          jpegQuality: 72,
        });
        this.previewProcess = child;
        let frameCount = 0;
        child.stdout.on("data", (chunk: Buffer) => {
          if (settled || res.destroyed) return;
          const text = chunk.toString("latin1");
          const boundaryHits = text.split(`--${PREVIEW_MJPEG_BOUNDARY}`).length - 1;
          if (boundaryHits > 0) {
            frameCount += boundaryHits;
            this.notePreviewFrame(frameCount);
          }
          res.write(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf-8").trim();
          if (text) this.updatePreviewStatus({ lastError: text.slice(0, 500) });
        });
        child.on("error", (error) => {
          this.updatePreviewStatus({ status: "error", lastError: error.message, cameraOwnership: "released" });
          finish("preview process error");
        });
        child.on("close", (code) => {
          if (code && code !== 0) {
            this.updatePreviewStatus({ status: "error", lastError: this.manifest.previewStatus.lastError ?? `Preview stream exited ${code}.` });
            finish("preview process error");
            return;
          }
          finish("preview process stopped");
        });
        this.previewStop = (reason: string) => {
          stopChildProcessTree(child);
          finish(reason);
        };
      } catch (error) {
        this.updatePreviewStatus({
          status: "error",
          cameraOwnership: "released",
          lastError: error instanceof Error ? error.message : "Preview stream failed to start.",
        });
        finish("preview start error");
      }
    });
  }

  async reportBundle(
    reportId: string | undefined,
    options: { includeAssetBodies?: boolean } = {}
  ): Promise<{ reportId: string; bundle: AiGraderReportBundle; source: string }> {
    const expectedReportId = reportId?.trim() || this.manifest.reportId;
    if (!expectedReportId) throw new Error("No AI Grader report ID is available yet.");
    if (options.includeAssetBodies) {
      const reportDir = this.manifest.outputs.unifiedReportDir ?? dirnameIfFile(this.manifest.outputs.unifiedReportPath);
      if (reportDir && this.manifest.reportId === expectedReportId) {
        const bundle = await buildAiGraderReportBundle({
          reportDir,
          outputDir: this.config.reportBundleOutputDir ?? this.config.outputDir,
          reportId: expectedReportId,
          publicBasePath: this.config.publicBasePath,
          includeAssetBodies: true,
        });
        return { reportId: expectedReportId, bundle: bundleWithProductionRelease(bundle, this.manifest.productionRelease), source: "active_manifest_generated_with_asset_bodies" };
      }
    }
    if (this.manifest.reportBundle?.reportId === expectedReportId) {
      return { reportId: expectedReportId, bundle: bundleWithProductionRelease(this.manifest.reportBundle, this.manifest.productionRelease), source: "active_manifest_memory" };
    }

    const bundleFromPath = await readBundleFromPath(this.manifest.outputs.reportBundlePath);
    if (bundleFromPath?.reportId === expectedReportId) {
      this.manifest.reportBundle = bundleFromPath;
      const productionRelease = this.manifest.productionRelease ?? await readProductionReleaseFromPath(this.manifest.outputs.productionReleasePath);
      this.manifest.productionRelease = productionRelease;
      return { reportId: expectedReportId, bundle: bundleWithProductionRelease(bundleFromPath, productionRelease), source: "active_manifest_report_bundle_path" };
    }

    const reportDir = this.manifest.outputs.unifiedReportDir ?? dirnameIfFile(this.manifest.outputs.unifiedReportPath);
    if (reportDir && this.manifest.reportId === expectedReportId) {
      const bundle = await buildAiGraderReportBundle({
        reportDir,
        outputDir: this.config.reportBundleOutputDir ?? this.config.outputDir,
        reportId: expectedReportId,
        publicBasePath: this.config.publicBasePath,
      });
      this.manifest.reportBundle = bundle;
      return { reportId: expectedReportId, bundle: bundleWithProductionRelease(bundle, this.manifest.productionRelease), source: "active_manifest_generated_from_report_dir" };
    }

    for (const item of await this.reportHistoryItems()) {
      if (item.reportId !== expectedReportId) continue;
      const reportDirFromHtml = dirnameIfFile(item.localHtmlPath);
      if (options.includeAssetBodies && reportDirFromHtml) {
        const generated = await buildAiGraderReportBundle({
          reportDir: reportDirFromHtml,
          outputDir: this.config.reportBundleOutputDir ?? this.config.outputDir,
          reportId: expectedReportId,
          publicBasePath: this.config.publicBasePath,
          includeAssetBodies: true,
        });
        const release = await readProductionReleaseFromPath(item.productionReleasePath);
        return { reportId: expectedReportId, bundle: bundleWithProductionRelease(generated, release), source: "history_generated_with_asset_bodies" };
      }
      const bundle = await readBundleFromPath(item.reportBundlePath);
      if (bundle) {
        const release = await readProductionReleaseFromPath(item.productionReleasePath);
        return { reportId: expectedReportId, bundle: bundleWithProductionRelease(bundle, release), source: "history_report_bundle_path" };
      }
      if (reportDirFromHtml) {
        const generated = await buildAiGraderReportBundle({
          reportDir: reportDirFromHtml,
          outputDir: this.config.reportBundleOutputDir ?? this.config.outputDir,
          reportId: expectedReportId,
          publicBasePath: this.config.publicBasePath,
        });
        return { reportId: expectedReportId, bundle: generated, source: "history_generated_from_report_dir" };
      }
    }

    throw new Error(`AI Grader report ${expectedReportId} was not found in the local station output directory.`);
  }

  async reportHistory(): Promise<AiGraderLocalStationReportHistory> {
    const items = await this.reportHistoryItems();
    return {
      generatedAt: new Date().toISOString(),
      source: "local_bridge_file_backed",
      items,
      stats: historyStats(items),
    };
  }

  private async writeProductionRelease(request: AiGraderLocalStationBridgeActionRequest): Promise<AiGraderProductionRelease> {
    const reportId = this.manifest.reportId;
    if (!reportId) throw new Error("Production release requires an active AI Grader report ID.");
    if (!this.manifest.outputs.reportBundlePath) {
      await this.action("export-report-bundle", request);
    }
    if (!this.manifest.outputs.reportBundlePath) {
      throw new Error("Production release requires an exported report-bundle.json.");
    }
    const outputDir = path.join(this.config.outputDir, "production-releases", reportId);
    const result = await writeAiGraderProductionRelease({
      reportBundlePath: this.manifest.outputs.reportBundlePath,
      outputDir,
      operatorId: request.operatorId,
      warningsAccepted: request.warningsAccepted,
      overrideReason: request.overrideReason,
      publicBaseUrl: this.config.publicBasePath?.startsWith("http") ? this.config.publicBasePath : undefined,
      publicBasePath: this.config.publicBasePath,
    });
    this.manifest.outputs.productionReleasePath = result.productionReleasePath;
    this.manifest.outputs.labelDataPath = result.labelDataPath;
    this.manifest.outputs.publicationManifestPath = result.publicationManifestPath;
    this.manifest.outputs.integrationContractPath = result.integrationContractPath;
    this.manifest.productionRelease = result.productionRelease;
    this.manifest.safety.finalGradeComputed = result.productionRelease.finalGradeComputed;
    this.manifest.safety.labelGenerated = result.productionRelease.labelDataGenerated;
    this.manifest.safety.qrGenerated = result.productionRelease.qrPayloadGenerated;
    this.manifest.progressLog.push(`${new Date().toISOString()} Production release artifacts written to ${result.outputDir}.`);
    await writeSessionManifest(this.manifest);
    return result.productionRelease;
  }

  private async reportHistoryItems(): Promise<AiGraderLocalStationReportHistoryItem[]> {
    const items: AiGraderLocalStationReportHistoryItem[] = [];
    if (this.manifest.reportBundle) {
      items.push(historyItemFromBundle({
        bundle: this.manifest.reportBundle,
        productionRelease: this.manifest.productionRelease,
        reportBundlePath: this.manifest.outputs.reportBundlePath,
        productionReleasePath: this.manifest.outputs.productionReleasePath,
        sessionDir: this.manifest.outputs.sessionDir,
      }));
    } else if (this.manifest.reportId && this.manifest.outputs.unifiedReportPath) {
      try {
        const resolved = await this.reportBundle(this.manifest.reportId);
        items.push(historyItemFromBundle({
          bundle: resolved.bundle,
          productionRelease: this.manifest.productionRelease,
          reportBundlePath: this.manifest.outputs.reportBundlePath,
          productionReleasePath: this.manifest.outputs.productionReleasePath,
          sessionDir: this.manifest.outputs.sessionDir,
        }));
      } catch {
        items.push({
          reportId: this.manifest.reportId,
          gradingSessionId: this.manifest.sessionId ?? this.manifest.reportId,
          generatedAt: this.manifest.updatedAt,
          status: "provisional_diagnostic_ready",
          viewerPath: reportRoute(this.manifest.reportId),
          localHtmlPath: this.manifest.outputs.unifiedReportPath,
          reportBundlePath: this.manifest.outputs.reportBundlePath,
          productionReleasePath: this.manifest.outputs.productionReleasePath,
          sessionDir: this.manifest.outputs.sessionDir,
          frontPackageDir: this.manifest.outputs.frontPackageDir,
          backPackageDir: this.manifest.outputs.backPackageDir,
          warnings: this.manifest.warnings,
        });
      }
    }

    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      entries = await readdir(this.config.outputDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionDir = path.join(this.config.outputDir, entry.name);
      const stationManifestPath = path.join(sessionDir, "station-session.json");
      if (!(await exists(stationManifestPath))) continue;
      const stationManifest = await readJsonFile(stationManifestPath) as AiGraderLocalStationBridgeManifest | undefined;
      if (!stationManifest?.reportId) continue;
      const bundle = await readBundleFromPath(stationManifest.outputs?.reportBundlePath);
      const productionRelease = await readProductionReleaseFromPath(stationManifest.outputs?.productionReleasePath);
      if (bundle) {
        items.push(historyItemFromBundle({
          bundle,
          productionRelease,
          reportBundlePath: stationManifest.outputs.reportBundlePath,
          productionReleasePath: stationManifest.outputs.productionReleasePath,
          sessionDir,
        }));
        continue;
      }
      const reportDir = stationManifest.outputs?.unifiedReportDir ?? dirnameIfFile(stationManifest.outputs?.unifiedReportPath);
      if (reportDir) {
        try {
          const generated = await buildAiGraderReportBundle({
            reportDir,
            outputDir: this.config.reportBundleOutputDir ?? this.config.outputDir,
            reportId: stationManifest.reportId,
            publicBasePath: this.config.publicBasePath,
          });
          items.push(historyItemFromBundle({
            bundle: generated,
            productionRelease,
            reportBundlePath: stationManifest.outputs?.reportBundlePath,
            productionReleasePath: stationManifest.outputs?.productionReleasePath,
            sessionDir,
          }));
        } catch {
          items.push({
            reportId: stationManifest.reportId,
            gradingSessionId: stationManifest.sessionId ?? stationManifest.reportId,
            generatedAt: stationManifest.updatedAt,
            status: "provisional_diagnostic_ready",
            viewerPath: reportRoute(stationManifest.reportId),
            localHtmlPath: stationManifest.outputs?.unifiedReportPath,
            reportBundlePath: stationManifest.outputs?.reportBundlePath,
            productionReleasePath: stationManifest.outputs?.productionReleasePath,
            sessionDir,
            frontPackageDir: stationManifest.outputs?.frontPackageDir,
            backPackageDir: stationManifest.outputs?.backPackageDir,
            warnings: stationManifest.warnings ?? [],
          });
        }
      }
    }

    const deduped = new Map<string, AiGraderLocalStationReportHistoryItem>();
    for (const item of items) deduped.set(item.reportId, item);
    return Array.from(deduped.values()).sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")));
  }

  async action(action: AiGraderLocalStationBridgeAction, request: AiGraderLocalStationBridgeActionRequest = {}): Promise<AiGraderLocalStationBridgeStatus> {
    mergeConfirmations(this.manifest, request.confirmations);
    const now = new Date().toISOString();
    this.manifest.updatedAt = now;

    if (action === "status" || action === "latest-report" || action === "session-manifest") {
      return this.status();
    }

    if (action === "start-session") {
      const { packageId, packageDir } = await createFixedRigPackageDir(this.config.outputDir, "ai-grader-browser-station-session");
      this.releaseFullForensicPreviewHold("new station session started");
      this.manifest.sessionId = `${packageId}-session`;
      this.manifest.reportId = request.reportId ?? `${packageId}-report`;
      this.manifest.createdAt = now;
      this.manifest.outputs.sessionDir = packageDir;
      this.manifest.outputs.manifestPath = path.join(packageDir, "station-session.json");
      this.manifest.currentStep = "verify_fixture_rulers";
      this.clearLiveLightingWatchdog();
      this.manifest.liveLighting = defaultLiveLightingStatus(this.config);
      this.setExecutionPath(this.config.warmRunnerDisabled ? "cold_command_fallback" : "warm_full_forensic_runner", this.config.warmRunnerDisabled ? "Warm runner disabled by explicit debug flag." : undefined);
      this.manifest.warmRunnerStatus.sessionId = this.manifest.sessionId;
      this.manifest.warmRunnerStatus.status = "warming";
      this.markWarmPhase({
        id: "warm_session_setup",
        label: "Warm session setup",
        status: "completed",
        backend: this.manifest.executionPath,
        executionPath: this.manifest.executionPath,
        detail: this.manifest.executionPath === "cold_command_fallback"
          ? "Bridge-owned session initialized with cold fallback explicitly selected by debug flag."
          : "Bridge-owned warm session initialized; Basler/Leimac ownership will be serialized through the capture lock.",
      });
      this.manifest.warmRunnerStatus.status = "idle";
      this.manifest.progressLog.push(`${now} Started station session ${this.manifest.sessionId}.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (!this.manifest.sessionId && action !== "safe-off" && action !== "end-session") {
      throw new Error("Start a station session before running AI Grader station actions.");
    }

    if (action === "confirm-light-idle-off") {
      this.manifest.confirmations.lightIdleOff = true;
      this.manifest.progressLog.push(`${now} Operator confirmed physical ring light idle/off.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "confirm-fixture-rulers") {
      this.manifest.confirmations.fixtureRulersVisible = true;
      this.manifest.progressLog.push(`${now} Operator confirmed fixture/rulers visible.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "accept-profile") {
      this.manifest.acceptedProfile = validateProfile(request.acceptedProfile, this.manifest.acceptedProfile);
      this.manifest.currentStep = "capture_front";
      this.manifest.progressLog.push(`${now} Accepted profile ${this.manifest.acceptedProfile.dutyPercent}% / ${this.manifest.acceptedProfile.exposureUs} us.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "confirm-flip") {
      this.manifest.confirmations.flipComplete = true;
      this.manifest.currentStep = "capture_back";
      this.manifest.progressLog.push(`${now} Operator confirmed card flip complete.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "cancel-session") {
      await this.safeOffLiveLighting("station cancellation", "safe_off");
      await this.runSafeOffCleanup("station cancellation");
      this.releaseFullForensicPreviewHold("station cancellation completed");
      this.manifest.currentStep = "safe_off_end_session";
      this.manifest.warmRunnerStatus.status = "cancelled";
      this.markWarmPhase({
        id: "station_cancelled",
        label: "Station cancellation",
        status: "cancelled",
        backend: this.manifest.executionPath,
        executionPath: this.manifest.executionPath,
        detail: "Cancellation requested; safe-off cleanup attempted in real mode.",
      });
      this.manifest.progressLog.push(`${now} Station session cancelled.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "end-session") {
      await this.safeOffLiveLighting("station session end", "safe_off");
      await this.runSafeOffCleanup("station session end");
      this.releaseFullForensicPreviewHold("station session end completed");
      this.manifest.currentStep = "safe_off_end_session";
      this.manifest.warmRunnerStatus.status = "complete";
      this.manifest.progressLog.push(`${now} Station session ended.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "safe-off") {
      assertRealReady(this.config, this.manifest);
      await this.safeOffLiveLighting("operator safe-off action", "safe_off");
      this.manifest.warmRunnerStatus.status = "safe_off";
      const phase = this.markWarmPhase({
        id: "warm_safe_cleanup",
        label: "Watchdog safe-off cleanup",
        status: "active",
        backend: "cold_command_fallback",
        detail: "operator safe-off action",
      });
      const result = await runStepOrMock(this.config, this.manifest, this.runner, stepById(this.config, this.manifest, "safe_off"));
      this.manifest.commandResults.push(result);
      this.manifest.confirmations.finalLightOff = Boolean(request.confirmations?.finalLightOff) || this.manifest.confirmations.finalLightOff;
      this.manifest.currentStep = "safe_off_end_session";
      this.releaseFullForensicPreviewHold("operator safe-off completed");
      this.markWarmPhase({
        id: "warm_safe_cleanup",
        label: "Watchdog safe-off cleanup",
        status: result.ok ? "completed" : "failed",
        startedAt: phase.startedAt,
        backend: "cold_command_fallback",
        detail: "operator safe-off action",
      });
      this.manifest.warmRunnerStatus.status = result.ok ? "complete" : "failed";
      this.manifest.progressLog.push(`${now} Safe-off ${result.ok ? "completed" : "failed"}.`);
      if (!result.ok) this.manifest.warnings.push(result.error ?? "Safe-off failed.");
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    assertRealReady(this.config, this.manifest);

    if (action === "launch-preview") {
      assertFixtureVisible(this.manifest);
      await this.stopPreviewForHardwareAction("native-preview");
      const result = await runStepOrMock(this.config, this.manifest, this.runner, stepById(this.config, this.manifest, "operator_preview"));
      this.manifest.commandResults.push(result);
      if (!result.ok) throw new Error(result.error ?? "Basler live preview failed.");
      this.manifest.outputs.previewPackageDir = extractPackageDir(result.payload);
      const accepted = result.payload?.acceptedLightingProfile ?? result.payload?.manifest?.acceptedLightingProfile;
      if (accepted?.selectedDutyPercent) {
        this.manifest.acceptedProfile = validateProfile({
          dutyPercent: Number(accepted.selectedDutyPercent),
          exposureUs: this.manifest.acceptedProfile.exposureUs,
          gain: this.manifest.acceptedProfile.gain,
          channels: Array.isArray(accepted.selectedChannels) ? accepted.selectedChannels : this.manifest.acceptedProfile.channels,
          source: "operator_preview",
        }, this.manifest.acceptedProfile);
      }
      this.manifest.currentStep = "accept_capture_profile";
      this.manifest.progressLog.push(`${now} Basler live preview completed; profile available for acceptance.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "capture-front") {
      assertFixtureVisible(this.manifest);
      const result = await this.runWarmSideCapture("front");
      this.manifest.outputs.frontPackageDir = extractPackageDir(result.payload);
      this.manifest.currentStep = "prompt_flip_card";
      this.manifest.progressLog.push(`${now} Front evidence captured with warm-runner orchestration.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "capture-back") {
      assertFixtureVisible(this.manifest);
      assertFlipComplete(this.manifest);
      const result = await this.runWarmSideCapture("back");
      this.manifest.outputs.backPackageDir = extractPackageDir(result.payload);
      this.manifest.currentStep = "run_provisional_diagnostics";
      this.manifest.progressLog.push(`${now} Back evidence captured with warm-runner orchestration.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "run-diagnostics") {
      const result = await this.runWarmReport();
      this.manifest.outputs.unifiedReportDir = result.payload?.report?.packageDir ?? dirnameIfFile(extractUnifiedReportPath(result.payload));
      this.manifest.outputs.unifiedReportPath = extractUnifiedReportPath(result.payload);
      this.manifest.currentStep = "view_unified_report";
      this.manifest.progressLog.push(`${now} Unified provisional diagnostics generated from warm-runner queues.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "export-report-bundle") {
      const reportDir = this.manifest.outputs.unifiedReportDir ?? dirnameIfFile(this.manifest.outputs.unifiedReportPath);
      if (!reportDir) throw new Error("Report bundle export requires a generated unified report folder.");
      const outputDir = this.config.reportBundleOutputDir ?? path.join(this.config.outputDir, "report-bundles", this.manifest.reportId ?? "local-report");
      const bundle = await writeAiGraderReportBundle({
        reportDir,
        outputDir,
        reportId: this.manifest.reportId,
        publicBasePath: this.config.publicBasePath,
      });
      this.manifest.outputs.reportBundlePath = bundle.bundlePath;
      this.manifest.outputs.assetManifestPath = bundle.assetManifestPath;
      this.manifest.outputs.checksumsPath = bundle.checksumsPath;
      this.manifest.reportBundle = bundle.bundle;
      this.manifest.progressLog.push(`${now} Report bundle exported to ${bundle.bundlePath}.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "calculate-final-grade" || action === "finalize-report" || action === "publish-report" || action === "generate-label-data") {
      const release = await this.writeProductionRelease(request);
      if (action === "calculate-final-grade") {
        this.manifest.currentStep = "calculate_final_grade";
      } else if (action === "finalize-report" || action === "publish-report") {
        this.manifest.currentStep = "finalize_publish_report";
      } else {
        this.manifest.currentStep = "label_data_ready";
      }
      this.manifest.progressLog.push(`${now} ${actionLabel(action)} completed with status ${release.reportStatus}.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    throw new Error(`Unsupported AI Grader station bridge action: ${action}`);
  }
}

function isAllowedAction(value: string): value is AiGraderLocalStationBridgeAction {
  return [
    "status",
    "start-session",
    "confirm-light-idle-off",
    "confirm-fixture-rulers",
    "launch-preview",
    "accept-profile",
    "capture-front",
    "confirm-flip",
    "capture-back",
    "run-diagnostics",
    "export-report-bundle",
    "calculate-final-grade",
    "finalize-report",
    "publish-report",
    "generate-label-data",
    "safe-off",
    "cancel-session",
    "latest-report",
    "session-manifest",
    "end-session",
  ].includes(value);
}

function remoteIsLoopback(remoteAddress: string | undefined) {
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

function hostHeaderIsLoopback(hostHeader: string | undefined) {
  if (!hostHeader) return false;
  const host = hostHeader.split(":")[0].toLowerCase();
  return isLoopbackHost(host);
}

function originAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) return true;
  return allowedOrigins.some((allowed) => {
    if (allowed.endsWith(":*")) {
      const prefix = allowed.slice(0, -1);
      return origin.startsWith(prefix);
    }
    return origin === allowed;
  });
}

function setCors(res: http.ServerResponse, origin: string | undefined, config: AiGraderLocalStationBridgeConfig) {
  if (origin && originAllowed(origin, config.allowedOrigins)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-ai-grader-station-token");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "600");
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown, origin: string | undefined, config: AiGraderLocalStationBridgeConfig) {
  setCors(res, origin, config);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`${JSON.stringify(body)}\n`);
}

function sendText(
  res: http.ServerResponse,
  statusCode: number,
  body: string,
  origin: string | undefined,
  config: AiGraderLocalStationBridgeConfig,
  contentType = "text/plain; charset=utf-8"
) {
  setCors(res, origin, config);
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJsonBody(req: http.IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("AI Grader station bridge request body must be 1MB or smaller.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI Grader station bridge request body must be a JSON object.");
  }
  return parsed as JsonBody;
}

function actionRequestFromJson(value: JsonBody): AiGraderLocalStationBridgeActionRequest {
  return value as AiGraderLocalStationBridgeActionRequest;
}

function tokenMatches(req: http.IncomingMessage, config: AiGraderLocalStationBridgeConfig) {
  const header = req.headers["x-ai-grader-station-token"];
  const supplied = Array.isArray(header) ? header[0] : header;
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(config.stationToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secretMatches(supplied: string | undefined, expected: string | undefined) {
  if (!supplied || !expected) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createAiGraderLocalStationBridgeHttpServer(
  input: AiGraderLocalStationBridgeConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
  runner: AiGraderStationCommandRunner = createAiGraderStationCliRunner(),
  warmRunner: AiGraderWarmForensicRunner = defaultWarmForensicRunner
): http.Server {
  const config = buildAiGraderLocalStationBridgeConfig(input, env);
  const service = new AiGraderLocalStationBridgeService(config, runner, warmRunner);
  let pairingCodeConsumed = false;

  const server = http.createServer(async (req, res) => {
    const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    try {
      if (!remoteIsLoopback(req.socket.remoteAddress) || !hostHeaderIsLoopback(req.headers.host)) {
        return sendJson(res, 403, { ok: false, code: "AI_GRADER_STATION_BRIDGE_NON_LOCAL", message: "AI Grader station bridge accepts loopback requests only." }, origin, config);
      }
      if (!originAllowed(origin, config.allowedOrigins)) {
        return sendJson(res, 403, { ok: false, code: "AI_GRADER_STATION_BRIDGE_ORIGIN_REJECTED", message: "Origin is not allowed by this local station bridge." }, origin, config);
      }
      if (req.method === "OPTIONS") {
        setCors(res, origin, config);
        res.writeHead(204);
        res.end();
        return;
      }
      if (!req.url) return sendJson(res, 404, { ok: false, code: "NOT_FOUND", message: "Route not found." }, origin, config);
      const url = new URL(req.url, `http://${hostForUrl(config.host)}:${config.port}`);

      if (url.pathname === "/health") {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for /health." }, origin, config);
        return sendJson(res, 200, {
          ok: true,
          bridgeVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
          mode: config.mode,
          localOnly: true,
          tokenRequired: true,
          pairingAvailable: pairingCodeIsActive(config) && !pairingCodeConsumed,
          pairingCodeExpiresAt: config.stationPairingExpiresAt,
          hardwareActionsEnabled: config.mode === "real",
          allowedOrigins: config.allowedOrigins,
        }, origin, config);
      }

      if (url.pathname === "/pair") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for /pair." }, origin, config);
        if (pairingCodeConsumed || !pairingCodeIsActive(config)) {
          return sendJson(res, 403, { ok: false, code: "AI_GRADER_STATION_BRIDGE_PAIRING_UNAVAILABLE", message: "Local station bridge pairing is not available. Relaunch the Ten Kings AI Grader Station shortcut." }, origin, config);
        }
        const body = await readJsonBody(req);
        const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode : "";
        if (!secretMatches(pairingCode, config.stationPairingCode)) {
          return sendJson(res, 403, { ok: false, code: "AI_GRADER_STATION_BRIDGE_PAIRING_REJECTED", message: "Local station bridge pairing code was rejected." }, origin, config);
        }
        pairingCodeConsumed = true;
        return sendJson(res, 200, {
          ok: true,
          operation: "pair",
          result: {
            bridgeUrl: service.stationUrl,
            stationToken: config.stationToken,
            localOnly: true,
            tokenStorage: "browser_localStorage_only",
            hardwareActionsEnabled: config.mode === "real",
          },
        }, origin, config);
      }

      const statusRoutes = new Set(["/status", "/latest-report", "/session-manifest"]);
      if (statusRoutes.has(url.pathname)) {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for this route." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        return sendJson(res, 200, { ok: true, operation: url.pathname.slice(1), result: service.status() }, origin, config);
      }

      if (url.pathname === "/report-history") {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for /report-history." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        return sendJson(res, 200, { ok: true, operation: "report-history", result: await service.reportHistory() }, origin, config);
      }

      if (url.pathname === "/preview/status") {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for /preview/status." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        return sendJson(res, 200, { ok: true, operation: "preview-status", result: service.previewStatus() }, origin, config);
      }

      if (url.pathname === "/preview/stop") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for /preview/stop." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const body = await readJsonBody(req);
        const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "operator requested preview stop";
        return sendJson(res, 200, { ok: true, operation: "preview-stop", result: await service.stopPreviewForOperator(reason) }, origin, config);
      }

      if (url.pathname === "/preview/stream") {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for /preview/stream." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        return service.streamPreview(req, res, origin);
      }

      if (url.pathname === "/lighting/status") {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for /lighting/status." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        return sendJson(res, 200, { ok: true, operation: "lighting-status", result: service.liveLightingStatus() }, origin, config);
      }

      if (url.pathname === "/lighting/apply") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for /lighting/apply." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const body = await readJsonBody(req);
        return sendJson(res, 200, { ok: true, operation: "lighting-apply", result: await service.applyLiveLighting(body) }, origin, config);
      }

      if (url.pathname === "/lighting/safe-off") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for /lighting/safe-off." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const body = await readJsonBody(req);
        const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "operator requested browser live lighting safe-off";
        return sendJson(res, 200, { ok: true, operation: "lighting-safe-off", result: await service.safeOffLiveLightingForOperator(reason) }, origin, config);
      }

      if (url.pathname === "/lighting/accept") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for /lighting/accept." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const body = await readJsonBody(req);
        return sendJson(res, 200, { ok: true, operation: "lighting-accept", result: await service.acceptLiveLightingForCapture(body) }, origin, config);
      }

      if (url.pathname === "/lighting/heartbeat") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for /lighting/heartbeat." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const body = await readJsonBody(req);
        const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "browser live lighting heartbeat";
        return sendJson(res, 200, { ok: true, operation: "lighting-heartbeat", result: await service.heartbeatLiveLighting(reason) }, origin, config);
      }

      const reportBundleMatch = url.pathname.match(/^\/reports\/([^/]+)\/bundle$/);
      if (reportBundleMatch) {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for report bundles." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const reportId = decodeURIComponent(reportBundleMatch[1]);
        return sendJson(
          res,
          200,
          {
            ok: true,
            operation: "report-bundle",
            result: await service.reportBundle(reportId, { includeAssetBodies: url.searchParams.get("includeAssetBodies") === "1" }),
          },
          origin,
          config
        );
      }

      const reportHtmlMatch = url.pathname.match(/^\/reports\/([^/]+)\/html$/);
      if (reportHtmlMatch) {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for report HTML." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const reportId = decodeURIComponent(reportHtmlMatch[1]);
        const resolved = await service.reportBundle(reportId);
        if (!resolved.bundle.reportHtmlPath) throw new Error("Report HTML path is not available for this local report.");
        return sendText(res, 200, await readFile(resolved.bundle.reportHtmlPath, "utf-8"), origin, config, "text/html; charset=utf-8");
      }

      if (url.pathname.startsWith("/actions/")) {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for station actions." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const action = decodeURIComponent(url.pathname.slice("/actions/".length));
        if (!isAllowedAction(action)) return sendJson(res, 404, { ok: false, code: "AI_GRADER_STATION_BRIDGE_ROUTE_NOT_FOUND", message: "Unknown station action." }, origin, config);
        const body = await readJsonBody(req);
        const result = await service.action(action, actionRequestFromJson(body));
        return sendJson(res, 200, { ok: true, operation: action, result }, origin, config);
      }

      return sendJson(res, 404, { ok: false, code: "NOT_FOUND", message: "Route not found." }, origin, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected AI Grader station bridge error.";
      return sendJson(res, 400, { ok: false, code: "AI_GRADER_STATION_BRIDGE_ERROR", message }, origin, config);
    }
  });
  server.on("close", () => {
    void service.safeOffLiveLightingForOperator("local bridge server closing").catch(() => {});
  });
  return server;
}

export async function startAiGraderLocalStationBridgeHttpServer(
  input: AiGraderLocalStationBridgeConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
  runner: AiGraderStationCommandRunner = createAiGraderStationCliRunner(),
  warmRunner: AiGraderWarmForensicRunner = defaultWarmForensicRunner
): Promise<StartedAiGraderLocalStationBridge> {
  const config = buildAiGraderLocalStationBridgeConfig(input, env);
  const server = createAiGraderLocalStationBridgeHttpServer(config, env, runner, warmRunner);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    host: config.host,
    port: address.port,
    url: `http://${hostForUrl(config.host)}:${address.port}`,
    config: {
      ...config,
      port: address.port,
    },
  };
}
