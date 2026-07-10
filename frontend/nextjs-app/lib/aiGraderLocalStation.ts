import { SAMPLE_AI_GRADER_REPORT_BUNDLE, type AiGraderReportBundle } from "./aiGraderReportBundle";
import type { AiGraderProductionRelease } from "./aiGraderProductionRelease";

export const AI_GRADER_LOCAL_STATION_BRIDGE_VERSION = "ai-grader-local-station-bridge-v0.5";

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
  | "end-session"
  | "configure-rapid-capture"
  | "queue-current-card"
  | "activate-queue-item";

export type AiGraderCaptureProfile = "full_forensic" | "production_fast";

export const AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION = "ten-kings-ai-grader-capture-timing-v1" as const;
export type AiGraderCaptureTimingSide = "front" | "back";
export type AiGraderCaptureTimingProfile = AiGraderCaptureProfile;
export type AiGraderCaptureTriggerMode = "operator" | "auto";
export type AiGraderCaptureTimingEventId =
  | "session_started"
  | "preview_stream_started"
  | "preview_ready"
  | "edge_detection_ready"
  | "capture_trigger"
  | "raw_capture_completed"
  | "side_processing_started"
  | "side_processing_completed"
  | "back_positioning_started"
  | "report_generation_started"
  | "report_ready"
  | "safely_queued";
export type AiGraderCaptureTimingPhaseId =
  | "lighting_profile"
  | "frame_capture"
  | "file_writes"
  | "file_hashes"
  | "crop_deskew"
  | "grading_forensic_runner"
  | "side_processing"
  | "report_generation";
export type AiGraderCaptureTimingEvent = {
  id: AiGraderCaptureTimingEventId;
  at: string;
  side?: AiGraderCaptureTimingSide;
  triggerMode?: AiGraderCaptureTriggerMode;
};
export type AiGraderCaptureTimingPhase = {
  id: AiGraderCaptureTimingPhaseId;
  durationMs: number;
  side?: AiGraderCaptureTimingSide;
  startedAt?: string;
  finishedAt?: string;
};
export type AiGraderCaptureTimingSummary = {
  previewReadyMs?: number;
  frontEdgeDetectionReadyMs?: number;
  backEdgeDetectionReadyMs?: number;
  frontPositioningMs?: number;
  backPositioningMs?: number;
  totalFrontMs?: number;
  totalBackMs?: number;
  frontProcessingMs?: number;
  backProcessingMs?: number;
  frontProcessingDuringFlipMs?: number;
  frontProcessingOverlappedFlip: boolean;
  reportGenerationMs?: number;
  totalCardMs?: number;
  reportReadyTotalMs?: number;
  safeQueueLatencyMs?: number;
};
export type AiGraderCaptureTimingMetadata = {
  schemaVersion: typeof AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION;
  captureProfile: AiGraderCaptureTimingProfile;
  targetSideMs: 5000;
  hardwareMeasurement: boolean;
  events: AiGraderCaptureTimingEvent[];
  phases: AiGraderCaptureTimingPhase[];
  summary: AiGraderCaptureTimingSummary;
  target: {
    frontWithinTarget?: boolean;
    backWithinTarget?: boolean;
    fiveSecondsPerSideProven: boolean;
    hardwareMeasurementRequired: boolean;
    note: string;
  };
};

export type AiGraderCaptureProfileGuard = {
  stationSettingRequired: true;
  selectionSource: "bridge_default" | "operator_setting" | "rapid_continuation";
  productionFastOptIn: boolean;
  fullForensicEvidencePreserved: true;
  availableCaptureProfiles: ["full_forensic", "production_fast"];
  previousStableProfile: "full_forensic";
  fiveSecondTargetProven: boolean;
};

export type AiGraderRapidCaptureWorkflowState =
  | "front_captured"
  | "front_processing"
  | "back_positioning"
  | "back_captured"
  | "finalizing"
  | "report_ready_needs_confirm"
  | "confirmed_needs_publish"
  | "published"
  | "failed";

export type AiGraderRapidCaptureWorkflowEvent = {
  state: AiGraderRapidCaptureWorkflowState;
  at: string;
  detail: string;
};

export type AiGraderRapidCaptureManifestStatus = {
  enabled: boolean;
  queueItemId?: string;
  workflowState?: AiGraderRapidCaptureWorkflowState;
  workflowHistory: AiGraderRapidCaptureWorkflowEvent[];
  safelyQueuedAt?: string;
  humanConfirmationRequired: true;
  autoConfirm: false;
  autoPublish: false;
};

export type AiGraderRapidCaptureQueueItem = {
  queueItemId: string;
  sessionId: string;
  reportId: string;
  state: AiGraderRapidCaptureWorkflowState;
  queuedAt: string;
  updatedAt: string;
  history: AiGraderRapidCaptureWorkflowEvent[];
  humanConfirmationRequired: true;
  autoConfirmed: false;
  autoPublished: false;
  error?: string;
};

export type AiGraderRapidCaptureQueueStatus = {
  enabled: boolean;
  activeQueueItemId?: string;
  persisted: true;
  reportWorkerSerialized: true;
  items: AiGraderRapidCaptureQueueItem[];
};

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
  explicitColdDebugModeUsed: boolean;
  explicitColdDebugReason?: string;
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
  coldDebugMode: {
    configured: boolean;
    active: boolean;
    reason?: string;
  };
  safety: {
    captureLock: true;
    watchdogSafeOff: true;
    safeOffOnFailure: true;
    safeOffOnCancellation: true;
    safeOffOnSessionEnd: true;
    explicitColdDebugModeOnly: true;
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
  explicitColdDebugModeUsed: boolean;
  explicitColdDebugReason?: string;
  captureProfile: AiGraderCaptureProfile;
  captureProfileGuard: AiGraderCaptureProfileGuard;
  captureTiming: AiGraderCaptureTimingMetadata;
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
  captureFailure?: {
    side: AiGraderWarmRunnerSide;
    stage: "warm_capture" | "warm_processing";
    message: string;
    at: string;
    retryRequired: true;
    automaticColdFallbackAttempted: false;
  };
  geometryCaptureDecisions: Partial<Record<AiGraderWarmRunnerSide, {
    mode: "detected_geometry" | "manual_capture";
    placementState: AiGraderCardPlacementState;
    timestamp: string;
    explicitOperatorAction: boolean;
    detectionUsed: boolean;
    manualOverrideUsed: boolean;
    manualBoundaryRect?: AiGraderPreviewGeometryBoundingBox;
    sourceFrameId?: string;
  }>>;
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
  rapidCapture: AiGraderRapidCaptureManifestStatus;
  rapidCaptureQueue: AiGraderRapidCaptureQueueStatus;
};

const AI_GRADER_CAPTURE_TIMING_EVENT_IDS: AiGraderCaptureTimingEventId[] = [
  "session_started",
  "preview_stream_started",
  "preview_ready",
  "edge_detection_ready",
  "capture_trigger",
  "raw_capture_completed",
  "side_processing_started",
  "side_processing_completed",
  "back_positioning_started",
  "report_generation_started",
  "report_ready",
  "safely_queued",
];

const AI_GRADER_CAPTURE_TIMING_PHASE_IDS: AiGraderCaptureTimingPhaseId[] = [
  "lighting_profile",
  "frame_capture",
  "file_writes",
  "file_hashes",
  "crop_deskew",
  "grading_forensic_runner",
  "side_processing",
  "report_generation",
];

function captureTimingRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function captureTimingTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function captureTimingDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 10) / 10
    : undefined;
}

function captureTimingTargetNote(hardwareMeasurement: boolean, fiveSecondsPerSideProven: boolean) {
  if (fiveSecondsPerSideProven) {
    return "Both sides met the five-second target in a recorded hardware run with the selected forensic profile.";
  }
  if (hardwareMeasurement) {
    return "The hardware run did not prove five seconds for both sides; inspect file-write, frame-capture, and lighting/profile phases.";
  }
  return "Five seconds per side is unproven until both sides are measured on the Dell with complete forensic evidence preserved.";
}

export function buildDefaultAiGraderCaptureTiming(
  captureProfile: AiGraderCaptureTimingProfile = "full_forensic"
): AiGraderCaptureTimingMetadata {
  return {
    schemaVersion: AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION,
    captureProfile,
    targetSideMs: 5000,
    hardwareMeasurement: false,
    events: [],
    phases: [],
    summary: { frontProcessingOverlappedFlip: false },
    target: {
      fiveSecondsPerSideProven: false,
      hardwareMeasurementRequired: true,
      note: captureTimingTargetNote(false, false),
    },
  };
}

export function sanitizeAiGraderCaptureTiming(
  value: unknown,
  authoritativeProfile?: AiGraderCaptureTimingProfile
): AiGraderCaptureTimingMetadata {
  const record = captureTimingRecord(value) ? value : undefined;
  if (!record || record.schemaVersion !== AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION) {
    return buildDefaultAiGraderCaptureTiming(authoritativeProfile ?? "full_forensic");
  }
  const recordProfile = record?.captureProfile === "production_fast" || record?.captureProfile === "full_forensic"
    ? record.captureProfile
    : undefined;
  const captureProfile = authoritativeProfile ?? recordProfile ?? "full_forensic";

  const hardwareMeasurement = record.hardwareMeasurement === true;
  const events = Array.isArray(record.events)
    ? record.events
        .map((entry): AiGraderCaptureTimingEvent | undefined => {
          if (!captureTimingRecord(entry)) return undefined;
          const id = typeof entry.id === "string" && AI_GRADER_CAPTURE_TIMING_EVENT_IDS.includes(entry.id as AiGraderCaptureTimingEventId)
            ? (entry.id as AiGraderCaptureTimingEventId)
            : undefined;
          const at = captureTimingTimestamp(entry.at);
          if (!id || !at) return undefined;
          const side = entry.side === "front" || entry.side === "back" ? entry.side : undefined;
          const triggerMode = entry.triggerMode === "operator" || entry.triggerMode === "auto" ? entry.triggerMode : undefined;
          return { id, at, ...(side ? { side } : {}), ...(triggerMode ? { triggerMode } : {}) };
        })
        .filter((event): event is AiGraderCaptureTimingEvent => Boolean(event))
        .slice(-250)
    : [];
  const phases = Array.isArray(record.phases)
    ? record.phases
        .map((entry): AiGraderCaptureTimingPhase | undefined => {
          if (!captureTimingRecord(entry)) return undefined;
          const id = typeof entry.id === "string" && AI_GRADER_CAPTURE_TIMING_PHASE_IDS.includes(entry.id as AiGraderCaptureTimingPhaseId)
            ? (entry.id as AiGraderCaptureTimingPhaseId)
            : undefined;
          const durationMs = captureTimingDuration(entry.durationMs);
          if (!id || durationMs === undefined) return undefined;
          const side = entry.side === "front" || entry.side === "back" ? entry.side : undefined;
          const startedAt = captureTimingTimestamp(entry.startedAt);
          const finishedAt = captureTimingTimestamp(entry.finishedAt);
          return {
            id,
            durationMs,
            ...(side ? { side } : {}),
            ...(startedAt ? { startedAt } : {}),
            ...(finishedAt ? { finishedAt } : {}),
          };
        })
        .filter((phase): phase is AiGraderCaptureTimingPhase => Boolean(phase))
        .slice(-250)
    : [];
  const summaryRecord = captureTimingRecord(record.summary) ? record.summary : {};
  const summary: AiGraderCaptureTimingSummary = {
    ...(captureTimingDuration(summaryRecord.previewReadyMs) !== undefined ? { previewReadyMs: captureTimingDuration(summaryRecord.previewReadyMs) } : {}),
    ...(captureTimingDuration(summaryRecord.frontEdgeDetectionReadyMs) !== undefined ? { frontEdgeDetectionReadyMs: captureTimingDuration(summaryRecord.frontEdgeDetectionReadyMs) } : {}),
    ...(captureTimingDuration(summaryRecord.backEdgeDetectionReadyMs) !== undefined ? { backEdgeDetectionReadyMs: captureTimingDuration(summaryRecord.backEdgeDetectionReadyMs) } : {}),
    ...(captureTimingDuration(summaryRecord.frontPositioningMs) !== undefined ? { frontPositioningMs: captureTimingDuration(summaryRecord.frontPositioningMs) } : {}),
    ...(captureTimingDuration(summaryRecord.backPositioningMs) !== undefined ? { backPositioningMs: captureTimingDuration(summaryRecord.backPositioningMs) } : {}),
    ...(captureTimingDuration(summaryRecord.totalFrontMs) !== undefined ? { totalFrontMs: captureTimingDuration(summaryRecord.totalFrontMs) } : {}),
    ...(captureTimingDuration(summaryRecord.totalBackMs) !== undefined ? { totalBackMs: captureTimingDuration(summaryRecord.totalBackMs) } : {}),
    ...(captureTimingDuration(summaryRecord.frontProcessingMs) !== undefined ? { frontProcessingMs: captureTimingDuration(summaryRecord.frontProcessingMs) } : {}),
    ...(captureTimingDuration(summaryRecord.backProcessingMs) !== undefined ? { backProcessingMs: captureTimingDuration(summaryRecord.backProcessingMs) } : {}),
    ...(captureTimingDuration(summaryRecord.frontProcessingDuringFlipMs) !== undefined ? { frontProcessingDuringFlipMs: captureTimingDuration(summaryRecord.frontProcessingDuringFlipMs) } : {}),
    frontProcessingOverlappedFlip: summaryRecord.frontProcessingOverlappedFlip === true,
    ...(captureTimingDuration(summaryRecord.reportGenerationMs) !== undefined ? { reportGenerationMs: captureTimingDuration(summaryRecord.reportGenerationMs) } : {}),
    ...(captureTimingDuration(summaryRecord.totalCardMs) !== undefined ? { totalCardMs: captureTimingDuration(summaryRecord.totalCardMs) } : {}),
    ...(captureTimingDuration(summaryRecord.reportReadyTotalMs) !== undefined ? { reportReadyTotalMs: captureTimingDuration(summaryRecord.reportReadyTotalMs) } : {}),
    ...(captureTimingDuration(summaryRecord.safeQueueLatencyMs) !== undefined ? { safeQueueLatencyMs: captureTimingDuration(summaryRecord.safeQueueLatencyMs) } : {}),
  };
  const targetRecord = captureTimingRecord(record.target) ? record.target : {};
  const frontWithinTarget = typeof targetRecord.frontWithinTarget === "boolean" ? targetRecord.frontWithinTarget : undefined;
  const backWithinTarget = typeof targetRecord.backWithinTarget === "boolean" ? targetRecord.backWithinTarget : undefined;
  const fiveSecondsPerSideProven =
    targetRecord.fiveSecondsPerSideProven === true &&
    hardwareMeasurement &&
    frontWithinTarget === true &&
    backWithinTarget === true;
  return {
    schemaVersion: AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION,
    captureProfile,
    targetSideMs: 5000,
    hardwareMeasurement,
    events,
    phases,
    summary,
    target: {
      ...(frontWithinTarget !== undefined ? { frontWithinTarget } : {}),
      ...(backWithinTarget !== undefined ? { backWithinTarget } : {}),
      fiveSecondsPerSideProven,
      hardwareMeasurementRequired: !hardwareMeasurement,
      note: captureTimingTargetNote(hardwareMeasurement, fiveSecondsPerSideProven),
    },
  };
}

const AI_GRADER_RAPID_CAPTURE_WORKFLOW_STATES: AiGraderRapidCaptureWorkflowState[] = [
  "front_captured",
  "front_processing",
  "back_positioning",
  "back_captured",
  "finalizing",
  "report_ready_needs_confirm",
  "confirmed_needs_publish",
  "published",
  "failed",
];

export function parseAiGraderRapidCaptureWorkflowState(value: unknown): AiGraderRapidCaptureWorkflowState | null {
  return typeof value === "string" && AI_GRADER_RAPID_CAPTURE_WORKFLOW_STATES.includes(value as AiGraderRapidCaptureWorkflowState)
    ? (value as AiGraderRapidCaptureWorkflowState)
    : null;
}

function rapidCaptureRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeRapidCaptureId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(trimmed)) return undefined;
  if (/token|secret|bearer|authorization|presign|x-amz|localhost/i.test(trimmed)) return undefined;
  return trimmed;
}

function safeRapidCaptureTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function unsafeRapidCaptureText(value: string) {
  return (
    value.length > 500 ||
    /^data:image/i.test(value) ||
    /[a-z]:[\\/]/i.test(value) ||
    /(?:^|\s)\/(?:users|home|tmp|var|etc|opt)\//i.test(value) ||
    /https?:\/\/(?:127\.0\.0\.1|localhost|\[?::1\]?|10\.|192\.168\.|169\.254\.)/i.test(value) ||
    /(?:station|bridge|service)[_-]?token|pairing[_-]?code|authorization|bearer\s|x-amz-|presigned/i.test(value)
  );
}

function safeRapidCaptureText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && !unsafeRapidCaptureText(trimmed) ? trimmed : undefined;
}

function sanitizeAiGraderRapidCaptureHistory(value: unknown): AiGraderRapidCaptureWorkflowEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): AiGraderRapidCaptureWorkflowEvent | undefined => {
      if (!rapidCaptureRecord(entry)) return undefined;
      const state = parseAiGraderRapidCaptureWorkflowState(entry.state);
      const at = safeRapidCaptureTimestamp(entry.at);
      if (!state || !at) return undefined;
      return {
        state,
        at,
        detail: safeRapidCaptureText(entry.detail) ?? "Rapid capture state updated.",
      };
    })
    .filter((entry): entry is AiGraderRapidCaptureWorkflowEvent => Boolean(entry))
    .slice(-100);
}

function sanitizeAiGraderRapidCaptureManifest(value: unknown): AiGraderRapidCaptureManifestStatus {
  const record = rapidCaptureRecord(value) ? value : {};
  const queueItemId = safeRapidCaptureId(record.queueItemId);
  const workflowState = parseAiGraderRapidCaptureWorkflowState(record.workflowState);
  const safelyQueuedAt = safeRapidCaptureTimestamp(record.safelyQueuedAt);
  return {
    enabled: record.enabled === true,
    ...(queueItemId ? { queueItemId } : {}),
    ...(workflowState ? { workflowState } : {}),
    workflowHistory: sanitizeAiGraderRapidCaptureHistory(record.workflowHistory),
    ...(safelyQueuedAt ? { safelyQueuedAt } : {}),
    humanConfirmationRequired: true,
    autoConfirm: false,
    autoPublish: false,
  };
}

function sanitizeAiGraderRapidCaptureQueueItem(value: unknown): AiGraderRapidCaptureQueueItem | undefined {
  if (!rapidCaptureRecord(value)) return undefined;
  const queueItemId = safeRapidCaptureId(value.queueItemId);
  const sessionId = safeRapidCaptureId(value.sessionId);
  const reportId = safeRapidCaptureId(value.reportId);
  const state = parseAiGraderRapidCaptureWorkflowState(value.state);
  const queuedAt = safeRapidCaptureTimestamp(value.queuedAt);
  const updatedAt = safeRapidCaptureTimestamp(value.updatedAt);
  if (!queueItemId || !sessionId || !reportId || !state || !queuedAt || !updatedAt) return undefined;
  const error = safeRapidCaptureText(value.error);
  return {
    queueItemId,
    sessionId,
    reportId,
    state,
    queuedAt,
    updatedAt,
    history: sanitizeAiGraderRapidCaptureHistory(value.history),
    humanConfirmationRequired: true,
    autoConfirmed: false,
    autoPublished: false,
    ...(error ? { error } : {}),
  };
}

export function sanitizeAiGraderRapidCaptureQueue(
  value: unknown,
  fallbackEnabled = false
): AiGraderRapidCaptureQueueStatus {
  const record = rapidCaptureRecord(value) ? value : {};
  const activeQueueItemId = safeRapidCaptureId(record.activeQueueItemId);
  const items = Array.isArray(record.items)
    ? record.items
        .map(sanitizeAiGraderRapidCaptureQueueItem)
        .filter((item): item is AiGraderRapidCaptureQueueItem => Boolean(item))
        .slice(0, 50)
    : [];
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallbackEnabled,
    ...(activeQueueItemId ? { activeQueueItemId } : {}),
    persisted: true,
    reportWorkerSerialized: true,
    items,
  };
}

function sanitizeGeometryCaptureDecisions(value: unknown): AiGraderLocalStationStatus["geometryCaptureDecisions"] {
  if (!rapidCaptureRecord(value)) return {};
  const result: AiGraderLocalStationStatus["geometryCaptureDecisions"] = {};
  for (const side of ["front", "back"] as const) {
    const decision = value[side];
    if (!rapidCaptureRecord(decision)) continue;
    const mode = decision.mode === "detected_geometry" || decision.mode === "manual_capture" ? decision.mode : undefined;
    const placementState =
      decision.placementState === "ready" || decision.placementState === "adjust_card" || decision.placementState === "not_detected"
        ? decision.placementState
        : undefined;
    const timestamp = safeRapidCaptureTimestamp(decision.timestamp);
    if (!mode || !placementState || !timestamp) continue;
    const sourceFrameId = sanitizePreviewGeometrySourceFrameId(decision.sourceFrameId);
    const manualBoundaryRect = sanitizePreviewGeometryBoundingBox(decision.manualBoundaryRect);
    const manual = mode === "manual_capture";
    if (manual && (decision.explicitOperatorAction !== true || decision.manualOverrideUsed !== true || !manualBoundaryRect)) continue;
    if (!manual && (decision.detectionUsed !== true || decision.manualOverrideUsed === true)) continue;
    result[side] = {
      mode,
      placementState,
      timestamp,
      explicitOperatorAction: manual,
      detectionUsed: !manual,
      manualOverrideUsed: manual,
      ...(manualBoundaryRect ? { manualBoundaryRect } : {}),
      ...(sourceFrameId ? { sourceFrameId } : {}),
    };
  }
  return result;
}

/** Keeps the local status useful to the station UI while allowlisting rapid
 * queue fields and refusing an unguarded production_fast profile. */
export function sanitizeAiGraderLocalStationStatusForDisplay(
  status: AiGraderLocalStationStatus
): AiGraderLocalStationStatus {
  const rapidCapture = sanitizeAiGraderRapidCaptureManifest(status.rapidCapture);
  const guardSource = status.captureProfileGuard?.selectionSource;
  const selectionSource =
    guardSource === "operator_setting" || guardSource === "rapid_continuation" || guardSource === "bridge_default"
      ? guardSource
      : "bridge_default";
  const productionFastSelected =
    status.captureProfile === "production_fast" &&
    status.captureProfileGuard?.productionFastOptIn === true &&
    (selectionSource === "operator_setting" || selectionSource === "rapid_continuation");
  const captureProfile: AiGraderCaptureProfile = productionFastSelected ? "production_fast" : "full_forensic";
  const sanitizedCaptureTiming = sanitizeAiGraderCaptureTiming(status.captureTiming, captureProfile);
  const explicitColdDebugModeUsed =
    status.executionPath === "cold_command_fallback" && status.explicitColdDebugModeUsed === true;
  const unsafeStatus = status as AiGraderLocalStationStatus & Record<string, unknown>;
  const {
    fallbackUsed: _legacyFallbackUsed,
    fallbackReason: _legacyFallbackReason,
    warmRunnerStatus: unsafeWarmRunner,
    timingSummary: unsafeTimingSummary,
    ...statusWithoutLegacyFallback
  } = unsafeStatus;
  const {
    fallbackUsed: _legacyWarmFallbackUsed,
    fallbackReason: _legacyWarmFallbackReason,
    fallback: _legacyWarmFallback,
    ...warmRunnerWithoutLegacyFallback
  } = unsafeWarmRunner as AiGraderWarmRunnerStatus & Record<string, unknown>;
  const {
    fallbackToColdPath: _legacyFallbackToColdPath,
    ...warmSafetyWithoutLegacyFallback
  } = unsafeWarmRunner.safety as AiGraderWarmRunnerStatus["safety"] & Record<string, unknown>;
  const timingSummary = unsafeTimingSummary
    ? (() => {
        const {
          fallbackUsed: _legacyTimingFallbackUsed,
          fallbackReason: _legacyTimingFallbackReason,
          ...timingWithoutLegacyFallback
        } = unsafeTimingSummary as AiGraderLocalStationTimingSummary & Record<string, unknown>;
        return {
          ...timingWithoutLegacyFallback,
          explicitColdDebugModeUsed:
            unsafeTimingSummary.executionPath === "cold_command_fallback" &&
            unsafeTimingSummary.explicitColdDebugModeUsed === true,
          ...(safeRapidCaptureText(unsafeTimingSummary.explicitColdDebugReason)
            ? { explicitColdDebugReason: safeRapidCaptureText(unsafeTimingSummary.explicitColdDebugReason) }
            : {}),
        } as AiGraderLocalStationTimingSummary;
      })()
    : undefined;
  return {
    ...statusWithoutLegacyFallback,
    explicitColdDebugModeUsed,
    ...(safeRapidCaptureText(status.explicitColdDebugReason)
      ? { explicitColdDebugReason: safeRapidCaptureText(status.explicitColdDebugReason) }
      : {}),
    captureProfile,
    captureProfileGuard: {
      stationSettingRequired: true,
      selectionSource,
      productionFastOptIn: productionFastSelected,
      fullForensicEvidencePreserved: true,
      availableCaptureProfiles: ["full_forensic", "production_fast"],
      previousStableProfile: "full_forensic",
      fiveSecondTargetProven:
        !explicitColdDebugModeUsed &&
        status.executionPath === "warm_full_forensic_runner" &&
        sanitizedCaptureTiming.target.fiveSecondsPerSideProven,
    },
    captureTiming: sanitizedCaptureTiming,
    warmRunnerStatus: {
      ...warmRunnerWithoutLegacyFallback,
      explicitColdDebugModeUsed:
        unsafeWarmRunner.executionPath === "cold_command_fallback" && unsafeWarmRunner.explicitColdDebugModeUsed === true,
      ...(safeRapidCaptureText(unsafeWarmRunner.explicitColdDebugReason)
        ? { explicitColdDebugReason: safeRapidCaptureText(unsafeWarmRunner.explicitColdDebugReason) }
        : {}),
      coldDebugMode: {
        configured: unsafeWarmRunner.coldDebugMode?.configured === true,
        active:
          unsafeWarmRunner.executionPath === "cold_command_fallback" && unsafeWarmRunner.coldDebugMode?.active === true,
        ...(safeRapidCaptureText(unsafeWarmRunner.coldDebugMode?.reason)
          ? { reason: safeRapidCaptureText(unsafeWarmRunner.coldDebugMode?.reason) }
          : {}),
      },
      safety: {
        ...warmSafetyWithoutLegacyFallback,
        explicitColdDebugModeOnly: true,
      },
    },
    geometryCaptureDecisions: sanitizeGeometryCaptureDecisions(status.geometryCaptureDecisions),
    ...(timingSummary ? { timingSummary } : {}),
    rapidCapture,
    rapidCaptureQueue: sanitizeAiGraderRapidCaptureQueue(status.rapidCaptureQueue, rapidCapture.enabled),
  };
}

export type AiGraderLocalStationTimingSummary = {
  totalCommandMs: number;
  executionPath: AiGraderWarmRunnerExecutionPath;
  explicitColdDebugModeUsed: boolean;
  explicitColdDebugReason?: string;
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

export type AiGraderCardPlacementState = "not_detected" | "adjust_card" | "ready";
export type AiGraderPreviewGeometrySide = "front" | "back";
export type AiGraderPreviewGeometryPoint = { x: number; y: number };
export type AiGraderPreviewGeometryCorners = {
  topLeft: AiGraderPreviewGeometryPoint;
  topRight: AiGraderPreviewGeometryPoint;
  bottomRight: AiGraderPreviewGeometryPoint;
  bottomLeft: AiGraderPreviewGeometryPoint;
};
export type AiGraderPreviewGeometryBoundingBox = { x: number; y: number; width: number; height: number };

/**
 * Path-free subset of capture-helper CardGeometryMetadata that is safe to
 * display in the token-gated station UI. Raw/local artifact locations are
 * deliberately not part of this contract.
 */
export type AiGraderPreviewCardGeometrySummary = {
  version?: "ten-kings-card-geometry-v1";
  side: AiGraderPreviewGeometrySide;
  placementState: AiGraderCardPlacementState;
  adjustmentReason?: "not_detected" | "outside_frame" | "unsafe_scale" | "rotate_top_up" | "wrong_aspect" | "low_confidence" | "manual_capture_selected";
  geometrySource: "detected" | "manual_override" | "none";
  captureMode: "automatic_detection" | "manual_capture" | "none";
  confidenceBasis: "automatic_detection" | "operator_confirmation" | "none";
  detectionUsed: boolean;
  manualOverrideUsed: boolean;
  corners: AiGraderPreviewGeometryCorners | null;
  detectedCorners: AiGraderPreviewGeometryCorners | null;
  boundingBox: AiGraderPreviewGeometryBoundingBox | null;
  rotationDegrees: number | null;
  skewDegrees: number | null;
  confidence: number;
  sourceFrameId?: string;
  timestamp?: string;
  image?: {
    width: number;
    height: number;
    coordinateFrame: "source_image_pixels";
  };
};

export type AiGraderPreviewCardGeometryBySide = {
  activeSide?: AiGraderPreviewGeometrySide;
  front?: AiGraderPreviewCardGeometrySummary;
  back?: AiGraderPreviewCardGeometrySummary;
};

export function aiGraderCardPlacementLabel(state: AiGraderCardPlacementState): "Not Detected" | "Adjust Card" | "Ready" {
  if (state === "ready") return "Ready";
  if (state === "adjust_card") return "Adjust Card";
  return "Not Detected";
}

function previewGeometryRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function previewGeometryNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizePreviewGeometryPoint(value: unknown): AiGraderPreviewGeometryPoint | undefined {
  if (!previewGeometryRecord(value)) return undefined;
  const x = previewGeometryNumber(value.x);
  const y = previewGeometryNumber(value.y);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function sanitizePreviewGeometryCorners(value: unknown): AiGraderPreviewGeometryCorners | null {
  if (value === null) return null;
  if (!previewGeometryRecord(value)) return null;
  const topLeft = sanitizePreviewGeometryPoint(value.topLeft);
  const topRight = sanitizePreviewGeometryPoint(value.topRight);
  const bottomRight = sanitizePreviewGeometryPoint(value.bottomRight);
  const bottomLeft = sanitizePreviewGeometryPoint(value.bottomLeft);
  return topLeft && topRight && bottomRight && bottomLeft ? { topLeft, topRight, bottomRight, bottomLeft } : null;
}

function sanitizePreviewGeometryBoundingBox(value: unknown): AiGraderPreviewGeometryBoundingBox | null {
  if (!previewGeometryRecord(value)) return null;
  const x = previewGeometryNumber(value.x);
  const y = previewGeometryNumber(value.y);
  const width = previewGeometryNumber(value.width);
  const height = previewGeometryNumber(value.height);
  return x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0
    ? null
    : { x, y, width, height };
}

function sanitizePreviewGeometrySourceFrameId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(trimmed)) return undefined;
  if (/token|secret|bearer|presign|x-amz|localhost/i.test(trimmed)) return undefined;
  return trimmed;
}

function sanitizePreviewGeometryTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

export function sanitizeAiGraderPreviewCardGeometry(
  value: unknown,
  expectedSide?: AiGraderPreviewGeometrySide
): AiGraderPreviewCardGeometrySummary | undefined {
  if (!previewGeometryRecord(value)) return undefined;
  const side = value.side === "front" || value.side === "back" ? value.side : expectedSide;
  if (!side || (expectedSide && side !== expectedSide)) return undefined;
  const placementState =
    value.placementState === "ready" || value.placementState === "adjust_card" || value.placementState === "not_detected"
      ? value.placementState
      : "not_detected";
  const adjustmentReason = new Set([
    "not_detected",
    "outside_frame",
    "unsafe_scale",
    "rotate_top_up",
    "wrong_aspect",
    "low_confidence",
    "manual_capture_selected",
  ]).has(String(value.adjustmentReason))
    ? value.adjustmentReason as AiGraderPreviewCardGeometrySummary["adjustmentReason"]
    : undefined;
  const geometrySource =
    value.geometrySource === "detected" || value.geometrySource === "manual_override" || value.geometrySource === "none"
      ? value.geometrySource
      : "none";
  const captureMode =
    value.captureMode === "automatic_detection" || value.captureMode === "manual_capture" || value.captureMode === "none"
      ? value.captureMode
      : geometrySource === "detected"
        ? "automatic_detection"
        : geometrySource === "manual_override"
          ? "manual_capture"
          : "none";
  const confidenceBasis =
    value.confidenceBasis === "automatic_detection" || value.confidenceBasis === "operator_confirmation" || value.confidenceBasis === "none"
      ? value.confidenceBasis
      : captureMode === "automatic_detection"
        ? "automatic_detection"
        : captureMode === "manual_capture"
          ? "operator_confirmation"
          : "none";
  const corners = sanitizePreviewGeometryCorners(value.corners);
  const detectedCorners = sanitizePreviewGeometryCorners(value.detectedCorners);
  const rotationDegrees = previewGeometryNumber(value.rotationDegrees) ?? null;
  const skewDegrees = previewGeometryNumber(value.skewDegrees) ?? null;
  const confidenceValue = previewGeometryNumber(value.confidence) ?? 0;
  const sourceFrameId = sanitizePreviewGeometrySourceFrameId(value.sourceFrameId);
  const timestamp = sanitizePreviewGeometryTimestamp(value.timestamp);
  const imageRecord = previewGeometryRecord(value.image) ? value.image : undefined;
  const imageWidth = imageRecord ? previewGeometryNumber(imageRecord.width) : undefined;
  const imageHeight = imageRecord ? previewGeometryNumber(imageRecord.height) : undefined;
  const image =
    imageWidth !== undefined && imageHeight !== undefined && imageWidth > 0 && imageHeight > 0
      ? { width: imageWidth, height: imageHeight, coordinateFrame: "source_image_pixels" as const }
      : undefined;
  return {
    ...(value.version === "ten-kings-card-geometry-v1" ? { version: value.version } : {}),
    side,
    placementState,
    ...(adjustmentReason ? { adjustmentReason } : {}),
    geometrySource,
    captureMode,
    confidenceBasis,
    detectionUsed: value.detectionUsed === true,
    manualOverrideUsed: value.manualOverrideUsed === true,
    corners,
    detectedCorners,
    boundingBox: sanitizePreviewGeometryBoundingBox(value.boundingBox),
    rotationDegrees,
    skewDegrees,
    confidence: Math.max(0, Math.min(1, confidenceValue)),
    ...(sourceFrameId ? { sourceFrameId } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(image ? { image } : {}),
  };
}

export function sanitizeAiGraderPreviewCardGeometryBySide(value: unknown): AiGraderPreviewCardGeometryBySide | undefined {
  if (!previewGeometryRecord(value)) return undefined;
  const activeSide = value.activeSide === "front" || value.activeSide === "back" ? value.activeSide : undefined;
  const front = sanitizeAiGraderPreviewCardGeometry(value.front, "front");
  const back = sanitizeAiGraderPreviewCardGeometry(value.back, "back");
  if (!activeSide && !front && !back) return undefined;
  return {
    ...(activeSide ? { activeSide } : {}),
    ...(front ? { front } : {}),
    ...(back ? { back } : {}),
  };
}

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
  cardGeometry?: AiGraderPreviewCardGeometryBySide;
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
  { id: "calculate_final_grade", label: "Review Report", operatorAction: "Review the generated diagnostic report and publish readiness.", primaryAction: "calculate-final-grade", hardwareCapable: false },
  { id: "finalize_publish_report", label: "Ready to Publish", operatorAction: "Publish to Ten Kings when the report is ready.", primaryAction: "finalize-report", hardwareCapable: false },
  { id: "label_data_ready", label: "Label / QR Ready", operatorAction: "Public report and printable label data are ready after publish.", primaryAction: "generate-label-data", hardwareCapable: false },
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
  "configure-rapid-capture": "start_new_card",
  "queue-current-card": "start_new_card",
  "activate-queue-item": "calculate_final_grade",
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
    { method: "POST", action: "configure-rapid-capture", description: "Enable or disable persisted rapid capture mode without changing human confirmation or publish gates." },
    { method: "POST", action: "queue-current-card", description: "Queue safely persisted front/back evidence for serialized background finalization and start a clean next card." },
    { method: "POST", action: "activate-queue-item", description: "Open a completed queue item in the existing Confirm Card and Publish workflow." },
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
    explicitColdDebugModeUsed: false,
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
    coldDebugMode: {
      configured: false,
      active: false,
    },
    safety: {
      captureLock: true,
      watchdogSafeOff: true,
      safeOffOnFailure: true,
      safeOffOnCancellation: true,
      safeOffOnSessionEnd: true,
      explicitColdDebugModeOnly: true,
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
    cardGeometry: {
      activeSide: "front",
      front: {
        side: "front",
        placementState: "not_detected",
        geometrySource: "none",
        captureMode: "none",
        confidenceBasis: "none",
        detectionUsed: false,
        manualOverrideUsed: false,
        corners: null,
        detectedCorners: null,
        boundingBox: null,
        rotationDegrees: null,
        skewDegrees: null,
        confidence: 0,
      },
      back: {
        side: "back",
        placementState: "not_detected",
        geometrySource: "none",
        captureMode: "none",
        confidenceBasis: "none",
        detectionUsed: false,
        manualOverrideUsed: false,
        corners: null,
        detectedCorners: null,
        boundingBox: null,
        rotationDegrees: null,
        skewDegrees: null,
        confidence: 0,
      },
    },
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
  captureProfile?: AiGraderCaptureProfile;
  rapidCaptureEnabled?: boolean;
} = {}): AiGraderLocalStationStatus {
  const action = input.action ?? "status";
  const captureProfile = input.captureProfile ?? "full_forensic";
  const rapidCaptureEnabled = input.rapidCaptureEnabled === true;
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
    explicitColdDebugModeUsed: false,
    captureProfile,
    captureProfileGuard: {
      stationSettingRequired: true,
      selectionSource: captureProfile === "production_fast" ? "operator_setting" : "bridge_default",
      productionFastOptIn: captureProfile === "production_fast",
      fullForensicEvidencePreserved: true,
      availableCaptureProfiles: ["full_forensic", "production_fast"],
      previousStableProfile: "full_forensic",
      fiveSecondTargetProven: false,
    },
    captureTiming: buildDefaultAiGraderCaptureTiming(captureProfile),
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
    geometryCaptureDecisions: {},
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
      explicitColdDebugModeUsed: false,
      bridgeActionOverheadMs: 0,
      captureCommandMs: 0,
      reportGenerationMs: 0,
      safeOffMs: 0,
      entries: [],
      detailedEntries: [],
      phaseBreakdown: {},
      targetInterCaptureNote: "Contract preview uses fixture data; real timing appears when connected to the local bridge.",
    },
    rapidCapture: {
      enabled: rapidCaptureEnabled,
      workflowHistory: [],
      humanConfirmationRequired: true,
      autoConfirm: false,
      autoPublish: false,
    },
    rapidCaptureQueue: {
      enabled: rapidCaptureEnabled,
      persisted: true,
      reportWorkerSerialized: true,
      items: [],
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
    "configure-rapid-capture",
    "queue-current-card",
    "activate-queue-item",
  ];
  return allowed.includes(raw as AiGraderStationAction) ? (raw as AiGraderStationAction) : null;
}
