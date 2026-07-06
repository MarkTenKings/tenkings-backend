import { SAMPLE_AI_GRADER_REPORT_BUNDLE, type AiGraderReportBundle } from "./aiGraderReportBundle";
import type { AiGraderProductionRelease } from "./aiGraderProductionRelease";

export const AI_GRADER_LOCAL_STATION_BRIDGE_VERSION = "ai-grader-local-station-bridge-v0.4";

export type AiGraderStationStepId =
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

export type AiGraderStationAction =
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

export type AiGraderStationStep = {
  id: AiGraderStationStepId;
  label: string;
  operatorAction: string;
  primaryAction: AiGraderStationAction;
  hardwareCapable: boolean;
};

export type AiGraderLocalStationBridgeMode = "mock_dev" | "contract_only" | "future_hardware_bridge" | "mock" | "real";

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

export type AiGraderWarmRunnerEvidenceRole = {
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
};

export type AiGraderWarmRunnerPhase = {
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
};

export type AiGraderWarmRunnerStatus = {
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
    lastPausedAt?: string;
    lastResumeReadyAt?: string;
  };
  evidencePlan: {
    defaultFullForensic: true;
    rolesBySide: Record<AiGraderWarmRunnerSide, AiGraderWarmRunnerEvidenceRole[]>;
    preservedOutputs: Array<
      | "front_evidence"
      | "back_evidence"
      | "roi_display_crops"
      | "surface_intelligence"
      | "vision_lab"
      | "unified_report"
    >;
  };
  queues: {
    capture: AiGraderWarmRunnerPhase[];
    processing: AiGraderWarmRunnerPhase[];
    report: AiGraderWarmRunnerPhase[];
  };
  phases: AiGraderWarmRunnerPhase[];
  timing: {
    baselineTotalMs: number;
    targetTotalMinMs: number;
    targetTotalMaxMs: number;
    stretchTargetMs: number;
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
};

export type AiGraderLocalStationStatus = {
  bridgeVersion: typeof AI_GRADER_LOCAL_STATION_BRIDGE_VERSION;
  stationId: string;
  mode: AiGraderLocalStationBridgeMode;
  localOnly: true;
  loginRequired: false;
  hardwareActionsEnabled: boolean;
  currentStep: AiGraderStationStepId;
  nextAction: AiGraderStationAction;
  nextActionLabel: string;
  executionPath: AiGraderWarmRunnerExecutionPath;
  fallbackUsed: boolean;
  fallbackReason?: string;
  acceptedProfile: {
    dutyPercent: number;
    exposureUs: number;
    gain: number;
    channels: number[];
    source: "operator_preview" | "browser_live_tuning" | "default" | "mock" | "bridge_operator" | "cli_override";
    actualLeimacPwmStep?: number;
    acceptedAt?: string;
  };
  calibrationProfile: {
    referenceType: "fixed_metric_rulers";
    status: "fixture_rulers_pending" | "operator_verified";
    isCalibrated: false;
    mmPerPixelX?: number;
    mmPerPixelY?: number;
  };
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
    status: "planned" | "mock_ready" | "contract_only" | "hardware_pending" | "hardware_completed" | "blocked";
    frontCaptured: boolean;
    backCaptured: boolean;
    provisionalDiagnosticsRun: boolean;
  };
  progressLog: string[];
  warnings: string[];
  safety: {
    databaseWrites: false;
    migrationsRun: false;
    deployRun: false;
    hardwareAccessed: boolean;
    finalGradeComputed: boolean;
    certifiedClaim: false;
    labelGenerated: boolean;
    qrGenerated: boolean;
    certificateGenerated: false;
  };
  bridgeContract: {
    endpoints: Array<{
      method: "GET" | "POST";
      path: string;
      action: AiGraderStationAction | "preview-status" | "preview-stream" | "preview-stop" | "lighting-status" | "lighting-apply" | "lighting-safe-off" | "lighting-accept" | "lighting-heartbeat";
      hardwareAccess: boolean;
      description: string;
    }>;
    realHardwarePending: string[];
  };
  previewStatus: AiGraderLocalStationPreviewStatus;
  liveLighting: AiGraderLiveLightingStatus;
  warmRunnerStatus: AiGraderWarmRunnerStatus;
  reportBundle?: AiGraderReportBundle;
  stationUrl?: string;
  bridgeSecurity?: {
    tokenRequired: true;
    allowedOrigins: string[];
    host: string;
    port: number;
    rejectsNonLoopback: true;
  };
  confirmations?: {
    lightIdleOff: boolean;
    fixtureRulersVisible: boolean;
    flipComplete: boolean;
    finalLightOff: boolean;
  };
  outputs?: {
    sessionDir?: string;
    manifestPath?: string;
    frontPackageDir?: string;
    backPackageDir?: string;
    unifiedReportPath?: string;
    reportBundlePath?: string;
    productionReleasePath?: string;
    labelDataPath?: string;
    publicationManifestPath?: string;
    integrationContractPath?: string;
  };
  timingSummary?: AiGraderLocalStationTimingSummary;
  productionRelease?: AiGraderProductionRelease;
};

export type AiGraderLocalStationTimingSummary = {
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
  entries: Array<{
    stepId: string;
    durationMs: number;
    startedAt?: string;
    finishedAt?: string;
    category?: "bridge" | "preview" | "capture" | "processing" | "report" | "safe_off" | "publish" | "warm_runner";
    label?: string;
    detail?: string;
  }>;
  detailedEntries: Array<{
    stepId: string;
    durationMs: number;
    startedAt?: string;
    finishedAt?: string;
    category?: "bridge" | "preview" | "capture" | "processing" | "report" | "safe_off" | "publish" | "warm_runner";
    label?: string;
    detail?: string;
  }>;
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
};

export type AiGraderLocalStationPreviewStatus = {
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
};

export type AiGraderLiveLightingStatus = {
  status: "unavailable" | "off" | "applying" | "on" | "safe_off" | "error";
  mode: "browser_live_tuning";
  localOnly: true;
  tokenRequired: true;
  controlsEnabled: boolean;
  previewRequired: true;
  profile: {
    enabled: boolean;
    dutyPercent: number;
    actualLeimacPwmStep: number;
    channels: number[];
    source: "browser_live_tuning" | "default";
    acceptedForCapture: boolean;
    acceptedAt?: string;
  };
  applied: {
    enabled: boolean;
    dutyPercent: number;
    actualLeimacPwmStep: number;
    channels: number[];
    appliedAt?: string;
    lastApplyLatencyMs?: number;
    lastResponseKinds?: string[];
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
  safetyEvents: Array<{
    at: string;
    type: "apply" | "safe_off" | "accept" | "heartbeat" | "watchdog_safe_off" | "capture_start_safe_off" | "failure_safe_off";
    reason: string;
    ok: boolean;
  }>;
  lastError?: string;
  note: string;
};

export type AiGraderLocalReportHistoryItem = {
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
};

export type AiGraderLocalReportHistory = {
  generatedAt: string;
  source: "local_bridge_file_backed" | "fixture";
  items: AiGraderLocalReportHistoryItem[];
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
};

export const AI_GRADER_STATION_STEPS: AiGraderStationStep[] = [
  { id: "start_new_card", label: "Start New Card", operatorAction: "Create a local grading session.", primaryAction: "start-session", hardwareCapable: false },
  { id: "verify_fixture_rulers", label: "Verify Fixture/Rulers", operatorAction: "Confirm ring light idle/off, fixture, and rulers before live preview.", primaryAction: "launch-preview", hardwareCapable: true },
  { id: "live_preview_focus_framing", label: "Live Preview / Focus / Framing", operatorAction: "Use the Basler live preview to align and focus.", primaryAction: "launch-preview", hardwareCapable: true },
  { id: "lighting_exposure_tune", label: "Lighting / Exposure Tune", operatorAction: "Tune duty/exposure until clipping is acceptable.", primaryAction: "accept-profile", hardwareCapable: true },
  { id: "accept_capture_profile", label: "Accept Capture Profile", operatorAction: "Lock the software capture profile for this card.", primaryAction: "accept-profile", hardwareCapable: false },
  { id: "capture_front", label: "Capture Front", operatorAction: "Capture front fixed-rig evidence.", primaryAction: "capture-front", hardwareCapable: true },
  { id: "prompt_flip_card", label: "Prompt Flip Card", operatorAction: "Pause for the operator to flip and seat the card.", primaryAction: "confirm-flip", hardwareCapable: false },
  { id: "capture_back", label: "Capture Back", operatorAction: "Capture back fixed-rig evidence after flip confirmation.", primaryAction: "capture-back", hardwareCapable: true },
  { id: "run_provisional_diagnostics", label: "Run Provisional Diagnostics", operatorAction: "Generate the unified provisional diagnostic report.", primaryAction: "run-diagnostics", hardwareCapable: false },
  { id: "view_unified_report", label: "View Unified Report", operatorAction: "Open the local report and review Vision Lab.", primaryAction: "latest-report", hardwareCapable: false },
  { id: "calculate_final_grade", label: "Calculate Final Grade", operatorAction: "Compute Final AI-Grader Grade V0 from accepted evidence and gates.", primaryAction: "calculate-final-grade", hardwareCapable: false },
  { id: "finalize_publish_report", label: "Finalize / Publish Report", operatorAction: "Write production-release and publication artifacts.", primaryAction: "finalize-report", hardwareCapable: false },
  { id: "label_data_ready", label: "Label Data Ready", operatorAction: "Review label-ready JSON and QR payload URL.", primaryAction: "generate-label-data", hardwareCapable: false },
  { id: "safe_off_end_session", label: "Safe Off / End Session", operatorAction: "Run safe-off and end the station session.", primaryAction: "safe-off", hardwareCapable: true },
];

const ACTION_TO_STEP: Record<AiGraderStationAction, AiGraderStationStepId> = {
  status: "start_new_card",
  "start-session": "verify_fixture_rulers",
  "confirm-light-idle-off": "verify_fixture_rulers",
  "confirm-fixture-rulers": "verify_fixture_rulers",
  "launch-preview": "live_preview_focus_framing",
  "accept-profile": "capture_front",
  "capture-front": "prompt_flip_card",
  "confirm-flip": "capture_back",
  "capture-back": "run_provisional_diagnostics",
  "run-diagnostics": "view_unified_report",
  "export-report-bundle": "view_unified_report",
  "calculate-final-grade": "calculate_final_grade",
  "finalize-report": "finalize_publish_report",
  "publish-report": "finalize_publish_report",
  "generate-label-data": "label_data_ready",
  "safe-off": "safe_off_end_session",
  "cancel-session": "safe_off_end_session",
  "latest-report": "view_unified_report",
  "session-manifest": "view_unified_report",
  "end-session": "safe_off_end_session",
};

const NEXT_ACTION_BY_STEP: Record<AiGraderStationStepId, AiGraderStationAction> = {
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

function actionLabel(action: AiGraderStationAction) {
  return action
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function bridgeEndpoints() {
  const actions: Array<{
    method: "GET" | "POST";
    action: AiGraderStationAction | "preview-status" | "preview-stream" | "preview-stop" | "lighting-status" | "lighting-apply" | "lighting-safe-off" | "lighting-accept" | "lighting-heartbeat";
    description: string;
    path?: string;
  }> = [
    { method: "GET", action: "status", description: "Read current local station status." },
    { method: "GET", action: "preview-status", path: "/preview/status", description: "Read embedded browser preview status." },
    { method: "GET", action: "preview-stream", path: "/preview/stream", description: "Open local token-gated embedded preview stream." },
    { method: "POST", action: "preview-stop", path: "/preview/stop", description: "Stop embedded browser preview and release the Basler camera before capture." },
    { method: "GET", action: "lighting-status", path: "/lighting/status", description: "Read browser live Leimac lighting status." },
    { method: "POST", action: "lighting-apply", path: "/lighting/apply", description: "Apply low-duty browser live Leimac lighting for preview tuning." },
    { method: "POST", action: "lighting-safe-off", path: "/lighting/safe-off", description: "Safe-off browser live Leimac lighting." },
    { method: "POST", action: "lighting-accept", path: "/lighting/accept", description: "Use the browser live lighting profile for capture." },
    { method: "POST", action: "lighting-heartbeat", path: "/lighting/heartbeat", description: "Refresh browser live lighting watchdog." },
    { method: "POST", action: "start-session", description: "Start a local station session in mock/contract mode." },
    { method: "POST", action: "confirm-light-idle-off", description: "Record operator confirmation that the physical ring light is idle/off." },
    { method: "POST", action: "confirm-fixture-rulers", description: "Record operator confirmation that the fixture/rulers are visible." },
    { method: "POST", action: "launch-preview", description: "Contract endpoint for launching Basler live preview." },
    { method: "POST", action: "accept-profile", description: "Accept the current capture profile." },
    { method: "POST", action: "capture-front", description: "Contract endpoint for front capture." },
    { method: "POST", action: "confirm-flip", description: "Record operator flip confirmation." },
    { method: "POST", action: "capture-back", description: "Contract endpoint for back capture." },
    { method: "POST", action: "run-diagnostics", description: "Generate or attach the provisional report." },
    { method: "POST", action: "export-report-bundle", description: "Export report-bundle.json, asset manifest, and checksums." },
    { method: "POST", action: "calculate-final-grade", description: "Calculate Final AI-Grader Grade V0 from the report bundle." },
    { method: "POST", action: "finalize-report", description: "Finalize the local report and record operator warning acceptance." },
    { method: "POST", action: "publish-report", description: "Prepare local publication manifest and public URL data." },
    { method: "POST", action: "generate-label-data", description: "Generate label-ready JSON and QR payload URL data." },
    { method: "POST", action: "safe-off", description: "Contract endpoint for Leimac safe-off." },
    { method: "POST", action: "cancel-session", description: "Cancel a local station session with safe-off cleanup." },
    { method: "GET", action: "latest-report", description: "Read latest report location." },
    { method: "GET", action: "session-manifest", description: "Read station session manifest." },
    { method: "POST", action: "end-session", description: "End the local station session." },
  ];
  return actions.map((endpoint) => ({
    ...endpoint,
    path: endpoint.path ?? `/api/ai-grader/station/${endpoint.action}`,
    hardwareAccess: false,
  }));
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

function defaultWarmRunnerStatus(): AiGraderWarmRunnerStatus {
  return {
    enabled: true,
    mode: "full_forensic",
    backend: "warm_full_forensic_runner",
    executionPath: "warm_full_forensic_runner",
    fallbackUsed: false,
    status: "idle",
    captureLock: {
      held: false,
    },
    previewPolicy: {
      pauseDuringCapture: true,
      resumeAfterSafeIdle: true,
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
      active: false,
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
      "Full forensic evidence remains the default. The local Dell bridge owns warm capture, lock, queue, timing, and safe cleanup state.",
  };
}

function defaultPreviewStatus(): AiGraderLocalStationPreviewStatus {
  return {
    status: "not_started",
    implementationType: "mock_mjpeg_stream",
    browserEmbedded: true,
    localOnly: true,
    tokenRequired: true,
    streamPath: "/preview/stream",
    statusPath: "/preview/status",
    portraitOrientation: true,
    cameraOwnership: "idle",
    frameSource: "mock_station_preview",
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
    note: "Contract preview status only. Real embedded preview is supplied by the token-gated local Dell bridge.",
  };
}

function defaultLiveLightingStatus(): AiGraderLiveLightingStatus {
  return {
    status: "off",
    mode: "browser_live_tuning",
    localOnly: true,
    tokenRequired: true,
    controlsEnabled: true,
    previewRequired: true,
    profile: {
      enabled: false,
      dutyPercent: 1.3,
      actualLeimacPwmStep: 13,
      channels: [1, 2, 3, 4, 5, 6, 7, 8],
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
      timeoutMs: 15000,
    },
    connection: {
      state: "mock",
      persistentLeimacSession: false,
    },
    safety: {
      publicRouteExposed: false,
      requiresStationToken: true,
      bindsLoopbackOnly: true,
      productionServiceTokenUsed: false,
      lowDutyCapEnforced: true,
      maxDutyPercent: 5,
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
    note: "Browser live lighting tuning is local-only through the paired Dell bridge.",
  };
}

export function buildAiGraderLocalStationStatus(input: {
  action?: AiGraderStationAction;
  mode?: AiGraderLocalStationBridgeMode;
  now?: string;
} = {}): AiGraderLocalStationStatus {
  const action = input.action ?? "status";
  const currentStep = ACTION_TO_STEP[action] ?? "start_new_card";
  const nextAction = NEXT_ACTION_BY_STEP[currentStep];
  const reportBundle = SAMPLE_AI_GRADER_REPORT_BUNDLE;
  const frontCaptured = ["prompt_flip_card", "capture_back", "run_provisional_diagnostics", "view_unified_report", "calculate_final_grade", "finalize_publish_report", "label_data_ready", "safe_off_end_session"].includes(currentStep);
  const backCaptured = ["run_provisional_diagnostics", "view_unified_report", "calculate_final_grade", "finalize_publish_report", "label_data_ready", "safe_off_end_session"].includes(currentStep);
  const diagnosticsRun = ["view_unified_report", "calculate_final_grade", "finalize_publish_report", "label_data_ready", "safe_off_end_session"].includes(currentStep);
  const finalComputed = ["calculate_final_grade", "finalize_publish_report", "label_data_ready"].includes(currentStep);
  const labelReady = currentStep === "label_data_ready";

  return {
    bridgeVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
    stationId: "local-dell-ai-grader-station",
    mode: input.mode ?? "mock_dev",
    localOnly: true,
    loginRequired: false,
    hardwareActionsEnabled: false,
    currentStep,
    nextAction,
    nextActionLabel: actionLabel(nextAction),
    executionPath: "warm_full_forensic_runner",
    fallbackUsed: false,
    acceptedProfile: {
      dutyPercent: 1.3,
      exposureUs: 45000,
      gain: 0,
      channels: [1, 2, 3, 4, 5, 6, 7, 8],
      source: "operator_preview",
      actualLeimacPwmStep: 13,
    },
    calibrationProfile: {
      referenceType: "fixed_metric_rulers",
      status: currentStep === "start_new_card" ? "fixture_rulers_pending" : "operator_verified",
      isCalibrated: false,
      mmPerPixelX: 0.047037,
      mmPerPixelY: 0.047344,
    },
    latestReport: {
      reportId: reportBundle.reportId,
      localHtmlPath: reportBundle.reportHtmlPath,
      localViewerPath: `/ai-grader/reports/${reportBundle.reportId}`,
      publicViewerRoute: "/ai-grader/reports/[reportId]",
      exists: diagnosticsRun,
    },
    sessionManifest: {
      gradingSessionId: reportBundle.gradingSessionId,
      reportId: reportBundle.reportId,
      status: input.mode === "contract_only" ? "contract_only" : "mock_ready",
      frontCaptured,
      backCaptured,
      provisionalDiagnosticsRun: diagnosticsRun,
    },
    progressLog: [
      `${input.now ?? "local"} ${actionLabel(action)} requested.`,
      "Local station contract status does not run hardware.",
      diagnosticsRun ? "Sample report bundle is attached for local viewer review." : "Report opens after diagnostics complete.",
    ],
    warnings: [
      "Contract preview uses fixture data unless connected to the real Dell bridge.",
      "Certified claims remain disabled; final AI-Grader V0 is software/report status only.",
    ],
    safety: {
      databaseWrites: false,
      migrationsRun: false,
      deployRun: false,
      hardwareAccessed: false,
      finalGradeComputed: finalComputed,
      certifiedClaim: false,
      labelGenerated: labelReady,
      qrGenerated: labelReady,
      certificateGenerated: false,
    },
    bridgeContract: {
      endpoints: bridgeEndpoints(),
      realHardwarePending: [
        "Launch existing Basler live preview from browser action.",
        "Run guarded station workflow command from a local service process.",
        "Stream command progress and operator confirmations back to the page.",
        "Run Leimac safe-off from the page only after Mark is present and explicit apply flags are supplied.",
      ],
    },
    previewStatus: defaultPreviewStatus(),
    liveLighting: defaultLiveLightingStatus(),
    warmRunnerStatus: defaultWarmRunnerStatus(),
    reportBundle,
    outputs: {
      productionReleasePath: finalComputed ? "sample-production-release.json" : undefined,
      labelDataPath: labelReady ? "sample-label-data.json" : undefined,
      publicationManifestPath: finalComputed ? "sample-publication-manifest.json" : undefined,
      integrationContractPath: finalComputed ? "sample-integration-contract.json" : undefined,
    },
    timingSummary: {
      totalCommandMs: 0,
      executionPath: "warm_full_forensic_runner",
      fallbackUsed: false,
      bridgeActionOverheadMs: 0,
      captureCommandMs: 0,
      reportGenerationMs: 0,
      safeOffMs: 0,
      entries: [],
      detailedEntries: [],
      phaseBreakdown: {},
      targetInterCaptureNote: "Contract preview uses fixture data; real timing appears when connected to the local bridge.",
    },
  };
}

export function buildSampleAiGraderReportHistory(): AiGraderLocalReportHistory {
  return {
    generatedAt: new Date().toISOString(),
    source: "fixture",
    items: [
      {
        reportId: SAMPLE_AI_GRADER_REPORT_BUNDLE.reportId,
        gradingSessionId: SAMPLE_AI_GRADER_REPORT_BUNDLE.gradingSessionId,
        generatedAt: SAMPLE_AI_GRADER_REPORT_BUNDLE.generatedAt,
        status: SAMPLE_AI_GRADER_REPORT_BUNDLE.reportStatus,
        viewerPath: `/ai-grader/reports/${SAMPLE_AI_GRADER_REPORT_BUNDLE.reportId}`,
        localHtmlPath: SAMPLE_AI_GRADER_REPORT_BUNDLE.reportHtmlPath,
        sessionDir: SAMPLE_AI_GRADER_REPORT_BUNDLE.localReportFolder,
        frontPackageDir: SAMPLE_AI_GRADER_REPORT_BUNDLE.evidenceReferences.frontPackageDir,
        backPackageDir: SAMPLE_AI_GRADER_REPORT_BUNDLE.evidenceReferences.backPackageDir,
        provisionalOverallGrade: SAMPLE_AI_GRADER_REPORT_BUNDLE.provisionalGrade?.overall,
        finalOverallGrade: undefined,
        confidenceBand: SAMPLE_AI_GRADER_REPORT_BUNDLE.provisionalGrade?.confidence?.band,
        title: SAMPLE_AI_GRADER_REPORT_BUNDLE.cardIdentity.title,
        category: "Unknown",
        warnings: SAMPLE_AI_GRADER_REPORT_BUNDLE.warnings,
      },
    ],
    stats: {
      allTime: 1,
      monthly: 1,
      weekly: 1,
      daily: 1,
      averageProvisionalGrade: SAMPLE_AI_GRADER_REPORT_BUNDLE.provisionalGrade?.overall,
      averageFinalGrade: undefined,
      provisionalGradeCounts: { "8": 1 },
      finalGradeCounts: {},
      finalizedCount: 0,
      draftCount: 1,
      warningsCount: 1,
    },
  };
}

export function parseAiGraderStationAction(value: string | string[] | undefined): AiGraderStationAction | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "status";
  const allowed: AiGraderStationAction[] = [
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
  ];
  return allowed.includes(raw as AiGraderStationAction) ? (raw as AiGraderStationAction) : null;
}
