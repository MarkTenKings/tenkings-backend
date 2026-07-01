import { SAMPLE_AI_GRADER_REPORT_BUNDLE, type AiGraderReportBundle } from "./aiGraderReportBundle";

export const AI_GRADER_LOCAL_STATION_BRIDGE_VERSION = "ai-grader-local-station-bridge-v0.1";

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
  | "safe_off_end_session";

export type AiGraderStationAction =
  | "status"
  | "start-session"
  | "launch-preview"
  | "accept-profile"
  | "capture-front"
  | "confirm-flip"
  | "capture-back"
  | "run-diagnostics"
  | "safe-off"
  | "latest-report"
  | "session-manifest";

export type AiGraderStationStep = {
  id: AiGraderStationStepId;
  label: string;
  operatorAction: string;
  primaryAction: AiGraderStationAction;
  hardwareCapable: boolean;
};

export type AiGraderLocalStationBridgeMode = "mock_dev" | "contract_only" | "future_hardware_bridge";

export type AiGraderLocalStationStatus = {
  bridgeVersion: typeof AI_GRADER_LOCAL_STATION_BRIDGE_VERSION;
  stationId: string;
  mode: AiGraderLocalStationBridgeMode;
  localOnly: true;
  loginRequired: false;
  hardwareActionsEnabled: false;
  currentStep: AiGraderStationStepId;
  nextAction: AiGraderStationAction;
  nextActionLabel: string;
  acceptedProfile: {
    dutyPercent: number;
    exposureUs: number;
    gain: number;
    channels: number[];
    source: "operator_preview" | "default" | "mock";
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
    status: "planned" | "mock_ready" | "contract_only";
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
    hardwareAccessed: false;
    finalGradeComputed: false;
    certifiedClaim: false;
    labelGenerated: false;
    qrGenerated: false;
    certificateGenerated: false;
  };
  bridgeContract: {
    endpoints: Array<{ method: "GET" | "POST"; path: string; action: AiGraderStationAction; hardwareAccess: false; description: string }>;
    realHardwarePending: string[];
  };
  reportBundle: AiGraderReportBundle;
};

export const AI_GRADER_STATION_STEPS: AiGraderStationStep[] = [
  { id: "start_new_card", label: "Start New Card", operatorAction: "Create a local grading session.", primaryAction: "start-session", hardwareCapable: false },
  { id: "verify_fixture_rulers", label: "Verify Fixture/Rulers", operatorAction: "Confirm fixture and rulers are visible.", primaryAction: "launch-preview", hardwareCapable: true },
  { id: "live_preview_focus_framing", label: "Live Preview / Focus / Framing", operatorAction: "Use the Basler live preview to align and focus.", primaryAction: "launch-preview", hardwareCapable: true },
  { id: "lighting_exposure_tune", label: "Lighting / Exposure Tune", operatorAction: "Tune duty/exposure until clipping is acceptable.", primaryAction: "accept-profile", hardwareCapable: true },
  { id: "accept_capture_profile", label: "Accept Capture Profile", operatorAction: "Lock the software capture profile for this card.", primaryAction: "accept-profile", hardwareCapable: false },
  { id: "capture_front", label: "Capture Front", operatorAction: "Capture front fixed-rig evidence.", primaryAction: "capture-front", hardwareCapable: true },
  { id: "prompt_flip_card", label: "Prompt Flip Card", operatorAction: "Pause for the operator to flip and seat the card.", primaryAction: "confirm-flip", hardwareCapable: false },
  { id: "capture_back", label: "Capture Back", operatorAction: "Capture back fixed-rig evidence after flip confirmation.", primaryAction: "capture-back", hardwareCapable: true },
  { id: "run_provisional_diagnostics", label: "Run Provisional Diagnostics", operatorAction: "Generate the unified provisional diagnostic report.", primaryAction: "run-diagnostics", hardwareCapable: false },
  { id: "view_unified_report", label: "View Unified Report", operatorAction: "Open the local report and review Vision Lab.", primaryAction: "latest-report", hardwareCapable: false },
  { id: "safe_off_end_session", label: "Safe Off / End Session", operatorAction: "Run safe-off and end the station session.", primaryAction: "safe-off", hardwareCapable: true },
];

const ACTION_TO_STEP: Record<AiGraderStationAction, AiGraderStationStepId> = {
  status: "start_new_card",
  "start-session": "verify_fixture_rulers",
  "launch-preview": "live_preview_focus_framing",
  "accept-profile": "capture_front",
  "capture-front": "prompt_flip_card",
  "confirm-flip": "capture_back",
  "capture-back": "run_provisional_diagnostics",
  "run-diagnostics": "view_unified_report",
  "safe-off": "safe_off_end_session",
  "latest-report": "view_unified_report",
  "session-manifest": "view_unified_report",
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
  view_unified_report: "latest-report",
  safe_off_end_session: "safe-off",
};

function actionLabel(action: AiGraderStationAction) {
  return action
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function bridgeEndpoints() {
  const actions: Array<{ method: "GET" | "POST"; action: AiGraderStationAction; description: string }> = [
    { method: "GET", action: "status", description: "Read current local station status." },
    { method: "POST", action: "start-session", description: "Start a local station session in mock/contract mode." },
    { method: "POST", action: "launch-preview", description: "Contract endpoint for launching Basler live preview." },
    { method: "POST", action: "accept-profile", description: "Accept the current capture profile." },
    { method: "POST", action: "capture-front", description: "Contract endpoint for front capture." },
    { method: "POST", action: "confirm-flip", description: "Record operator flip confirmation." },
    { method: "POST", action: "capture-back", description: "Contract endpoint for back capture." },
    { method: "POST", action: "run-diagnostics", description: "Generate or attach the provisional report." },
    { method: "POST", action: "safe-off", description: "Contract endpoint for Leimac safe-off." },
    { method: "GET", action: "latest-report", description: "Read latest report location." },
    { method: "GET", action: "session-manifest", description: "Read station session manifest." },
  ];
  return actions.map((endpoint) => ({
    ...endpoint,
    path: `/api/ai-grader/station/${endpoint.action}`,
    hardwareAccess: false as const,
  }));
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
  const frontCaptured = ["prompt_flip_card", "capture_back", "run_provisional_diagnostics", "view_unified_report", "safe_off_end_session"].includes(currentStep);
  const backCaptured = ["run_provisional_diagnostics", "view_unified_report", "safe_off_end_session"].includes(currentStep);
  const diagnosticsRun = ["view_unified_report", "safe_off_end_session"].includes(currentStep);

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
    acceptedProfile: {
      dutyPercent: 1.3,
      exposureUs: 45000,
      gain: 0,
      channels: [1, 2, 3, 4, 5, 6, 7, 8],
      source: "operator_preview",
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
      "PR #46 local station bridge is mock/contract-only and does not run hardware.",
      diagnosticsRun ? "Sample report bundle is attached for local viewer review." : "Report opens after diagnostics complete.",
    ],
    warnings: [
      "Hardware browser control is pending a supervised local bridge implementation.",
      "No final grade, certificate, QR certificate, or certified claim is generated.",
    ],
    safety: {
      databaseWrites: false,
      migrationsRun: false,
      deployRun: false,
      hardwareAccessed: false,
      finalGradeComputed: false,
      certifiedClaim: false,
      labelGenerated: false,
      qrGenerated: false,
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
    reportBundle,
  };
}

export function parseAiGraderStationAction(value: string | string[] | undefined): AiGraderStationAction | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "status";
  const allowed: AiGraderStationAction[] = [
    "status",
    "start-session",
    "launch-preview",
    "accept-profile",
    "capture-front",
    "confirm-flip",
    "capture-back",
    "run-diagnostics",
    "safe-off",
    "latest-report",
    "session-manifest",
  ];
  return allowed.includes(raw as AiGraderStationAction) ? (raw as AiGraderStationAction) : null;
}
