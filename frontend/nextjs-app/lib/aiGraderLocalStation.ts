import {
  SAMPLE_AI_GRADER_REPORT_BUNDLE,
  isAiGraderReportBundleV03,
  type AiGraderReportBundle,
  type AiGraderStationReportBundle,
} from "./aiGraderReportBundle";
import type { AiGraderStationProductionRelease } from "./aiGraderProductionRelease";
import {
  trustedPokemonCardFormatAuthorityV1Schema,
  type TrustedPokemonCardFormatAuthorityV1,
  type AiGraderCalibrationActivationAuthorityV1,
  type AiGraderCalibrationWorkstationObservationV1,
  type AiGraderCalibrationWorkstationReceiptV1,
} from "@tenkings/shared";

export const AI_GRADER_LOCAL_STATION_BRIDGE_VERSION = "ai-grader-local-station-bridge-v0.10";
export const AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION = "ai-grader-report-producer-v0.2";

export type AiGraderStationStepId =
  | "start_new_card"
  | "live_preview_focus_framing"
  | "lighting_exposure_tune"
  | "capture_front"
  | "prompt_flip_card"
  | "capture_back"
  | "run_provisional_diagnostics"
  | "view_unified_report"
  | "calculate_final_grade"
  | "finalize_publish_report"
  | "label_data_ready"
  | "session_complete";

export type AiGraderStationAction =
  | "status"
  | "start-session"
  | "observe-calibration-activation"
  | "prepare-calibration-activation"
  | "ingest-finalized-calibration-bundle"
  | "confirm-calibration-activation"
  | "abort-calibration-activation"
  | "capture-front"
  | "capture-back"
  | "publish-report"
  | "cancel-session"
  | "latest-report"
  | "session-manifest"
  | "activate-queue-item"
  | "bind-mathematical-grading-authority"
  | "submit-mathematical-finding-reviews"
  | "begin-queued-ocr"
  | "complete-queued-ocr"
  | "fail-queued-ocr";

export type AiGraderCaptureProfile = "production_fast";
export type AiGraderGradingContract = "legacy_v0" | "mathematical_calibration_v1";

export type AiGraderMathematicalCardIdentityV1 = {
  title: string;
  sideCount: 2;
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  parallelId: string | null;
};

export type AiGraderMathematicalApprovedDesignReferenceV1 = {
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  parallelId: string | null;
  referenceId: string;
  profile: "registered_design_template_v1";
  status: "approved";
  side: "front" | "back";
  version: number;
  artifactSha256: string;
  artifactWidthPx: number;
  artifactHeightPx: number;
  intendedDesignBoundary: {
    schemaVersion: "ai-grader-intended-design-boundary-v1";
    coordinateFrame: "design_reference_pixels";
    contour: Array<[number, number]>;
  };
  approvedByUserId: string;
  approvedAt: string;
};

export type AiGraderMathematicalCenteringAuthorityV1 =
  | { profile: "printed_border_v1" }
  | {
      profile: "registered_design_template_v1";
      approvedReference: AiGraderMathematicalApprovedDesignReferenceV1;
      approvedDesignArtifact: {
        assetId: string;
        fileName: string;
        contentType: "image/png" | "image/jpeg";
        sha256: string;
      };
    };

type AiGraderMathematicalGradingAuthorityBaseV1 = {
  schemaVersion: "fixed_rig_mathematical_station_grading_authority_v1";
  cardIdentity: AiGraderMathematicalCardIdentityV1;
  sides: {
    front: { centering: AiGraderMathematicalCenteringAuthorityV1 };
    back: { centering: AiGraderMathematicalCenteringAuthorityV1 };
  };
};

export type AiGraderMathematicalGradingAuthorityV1 =
  | AiGraderMathematicalGradingAuthorityBaseV1 & {
      cardFormatId: "standard_trading_card_63_50x88_90_r3_18_v1";
    }
  | AiGraderMathematicalGradingAuthorityBaseV1 & {
      cardFormatId: "pokemon_tcg_standard";
      trustedCardFormatAuthority: TrustedPokemonCardFormatAuthorityV1;
    };

export type AiGraderMathematicalReviewAssetRoleV1 =
  | "roi_crop"
  | "segmentation_mask"
  | "confidence_mask"
  | "illumination_mask"
  | "normalized_card"
  | "directional_channel";

export type AiGraderMathematicalReviewAssetMetadataV1 = {
  assetId: string;
  evidenceRole: AiGraderMathematicalReviewAssetRoleV1;
  sha256: string;
  fileName: string;
  contentType: "image/png" | "image/jpeg" | "image/tiff";
  byteSize: number;
  widthPx: number;
  heightPx: number;
};

export type AiGraderMathematicalReviewMeasurementV1 = {
  measurementId: string;
  kind: string;
  unit: string;
  measuredMeasurement: number;
  u95: number;
  effectiveMeasurement: number;
  explicitGrade10Tolerance: number;
  grade10Buffer: number;
  calibrationProfileId: string;
  calibrationVersion: string;
  algorithmVersion: string;
  validEvidenceCoverage: number;
  usableDirectionalChannelCount: number;
};

export type AiGraderMathematicalFindingReviewRequestV1 = {
  schemaVersion: "fixed_rig_mathematical_finding_review_request_v1";
  gradingContract: "mathematical_calibration_v1";
  gradingSessionId: string;
  reportId: string;
  generatedAt: string;
  calibration: {
    profileId: string;
    calibrationVersion: string;
    artifactSha256: string;
  };
  findings: Array<{
    findingId: string;
    physicalDefectId: string;
    element: "centering" | "corners" | "edges" | "surface";
    category: string;
    side: "front" | "back";
    location: string;
    regionId: string;
    geometry: {
      coordinateFrame: "normalized_card";
      kind: "box";
      x: number;
      y: number;
      width: number;
      height: number;
    };
    detector: { id: string; version: string };
    measuredDeduction: number;
    measurements: AiGraderMathematicalReviewMeasurementV1[];
    evidenceAssetIds: string[];
    trueView: AiGraderMathematicalReviewAssetMetadataV1;
    directionalChannels: AiGraderMathematicalReviewAssetMetadataV1[];
    reviewEvidence: {
      roi: AiGraderMathematicalReviewAssetMetadataV1;
      segmentationMask: AiGraderMathematicalReviewAssetMetadataV1;
      confidenceMask: AiGraderMathematicalReviewAssetMetadataV1;
      illuminationMask: AiGraderMathematicalReviewAssetMetadataV1;
    };
    explanation: string;
  }>;
  hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted";
  artifactSha256: string;
};

export type AiGraderMathematicalFindingReviewV1 = {
  findingId: string;
  reviewRequestSha256: string;
  status: "confirmed" | "adjusted";
  reviewedAt: string;
};

export type AiGraderMathematicalExecutionV1 =
  | {
      status: "processing";
      startedAt: string;
      attempt: number;
      v0FallbackUsed: false;
      reviewRequestSha256?: string;
    }
  | {
      status: "finding_review_required";
      completedAt: string;
      attempt: number;
      v0FallbackUsed: false;
      reviewRequest: AiGraderMathematicalFindingReviewRequestV1;
      reviewIssues: string[];
    }
  | {
      status: "completed";
      completedAt: string;
      attempt: number;
      v0FallbackUsed: false;
      orchestrationTraceSha256: string;
    }
  | {
      status: "insufficient_evidence";
      completedAt: string;
      attempt: number;
      v0FallbackUsed: false;
      failedStage: string;
      reasons: string[];
      requiresRecapture: boolean;
      requiresApprovedDesignReference: boolean;
      requiresCalibration: boolean;
      requiresImplementationCorrection: boolean;
    };

export type AiGraderMathematicalV1State = {
  schemaVersion: "ten-kings-ai-grader-local-station-mathematical-v1-state-v1";
  generatedAt: string;
  gradingAuthority: AiGraderMathematicalGradingAuthorityV1;
  calibrationActivationAuthority?: AiGraderCalibrationActivationAuthorityV1;
  stagedDesignReferences: Partial<Record<"front" | "back", {
    side: "front" | "back";
    referenceId: string;
    assetId: string;
    fileName: string;
    contentType: "image/png" | "image/jpeg";
    sha256: string;
    byteSize: number;
    stagedAt: string;
  }>>;
  submittedFindingReviews?: AiGraderMathematicalFindingReviewV1[];
  execution?: AiGraderMathematicalExecutionV1;
};

export const AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION = "ten-kings-ai-grader-capture-timing-v1" as const;
export type AiGraderCaptureTimingSide = "front" | "back";
export type AiGraderCaptureTimingProfile = AiGraderCaptureProfile;
export type AiGraderCaptureTriggerMode = "operator";
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
  stationSettingRequired: false;
  selectionSource: "bridge_required";
  oneRoadProductionFastRequired: true;
  fullForensicEvidencePreserved: true;
  availableCaptureProfiles: ["production_fast"];
  fiveSecondTargetProven: boolean;
};

export type AiGraderRapidCaptureWorkflowState =
  | "front_captured"
  | "front_processing"
  | "back_positioning"
  | "back_captured"
  | "finalizing"
  | "finding_review_required"
  | "insufficient_evidence"
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
  mathematicalV1?: {
    status: AiGraderMathematicalExecutionV1["status"];
    reviewRequestSha256?: string;
    failedStage?: string;
    reasons?: string[];
    requiresRecapture?: boolean;
    requiresApprovedDesignReference?: boolean;
    requiresCalibration?: boolean;
    requiresImplementationCorrection?: boolean;
  };
  ocr: AiGraderQueuedOcrLifecycle;
  error?: string;
};

export type AiGraderRapidQueueIdentity = {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
};

export function aiGraderRapidQueueIdentityMatches(
  left: AiGraderRapidQueueIdentity | null | undefined,
  right: AiGraderRapidQueueIdentity | null | undefined,
) {
  return Boolean(left && right &&
    left.queueItemId === right.queueItemId &&
    left.gradingSessionId === right.gradingSessionId &&
    left.reportId === right.reportId);
}

export function aiGraderReviewActivationAvailable(publicationClaim: AiGraderRapidQueueIdentity | null | undefined) {
  return !publicationClaim;
}

const AI_GRADER_RAPID_PUBLISHABLE_STATES = new Set<AiGraderRapidCaptureWorkflowState>([
  "report_ready_needs_confirm",
  "confirmed_needs_publish",
]);

export function aiGraderRapidItemPublishable(state: AiGraderRapidCaptureWorkflowState | undefined) {
  return Boolean(state && AI_GRADER_RAPID_PUBLISHABLE_STATES.has(state));
}

export function assertAiGraderRapidItemPublishable(state: AiGraderRapidCaptureWorkflowState | undefined) {
  if (!aiGraderRapidItemPublishable(state)) {
    throw new Error("Approve & Publish requires one unpublished exact item ready for review.");
  }
}

export async function completeAiGraderExactPublicationHandoff<T>(input: {
  identity: AiGraderRapidQueueIdentity;
  acknowledgeExactLocalItem(identity: AiGraderRapidQueueIdentity): Promise<void>;
  verifyPublishedRoute(reportId: string): Promise<T>;
}) {
  await input.acknowledgeExactLocalItem(input.identity);
  return input.verifyPublishedRoute(input.identity.reportId);
}

export function embedAiGraderAuthoritativeProductionRelease(
  bundle: AiGraderReportBundle,
  productionRelease: NonNullable<AiGraderReportBundle["productionRelease"]>,
): AiGraderReportBundle {
  return { ...bundle, productionRelease };
}

export type AiGraderQueuedOcrImage = {
  side: "front" | "back";
  artifactRole: "normalized_card";
  fileName: string;
  mimeType: "image/png";
  checksumSha256: string;
  byteSize: number;
  widthPx: 1200;
  heightPx: 1680;
};

export type AiGraderQueuedOcrLifecycle = {
  state: "waiting_for_normalized" | "eligible" | "in_flight" | "succeeded" | "failed";
  updatedAt: string;
  attemptCount: 0 | 1;
  eligibleAt?: string;
  startedAt?: string;
  completedAt?: string;
  attemptOwnerId?: string;
  images?: AiGraderQueuedOcrImage[];
  result?: Record<string, unknown>;
  failure?: {
    code: string;
    message: string;
  };
};

export type AiGraderRapidCaptureActiveReview = {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  manifest: {
    currentStep?: AiGraderStationStepId;
    latestReport: {
      reportId: string;
      localViewerPath: string;
      publicViewerRoute: string;
      exists: boolean;
    };
    mathematicalV1?: AiGraderMathematicalV1State;
    reportBundle?: AiGraderStationReportBundle;
    productionRelease?: AiGraderStationProductionRelease;
    safety?: {
      finalGradeComputed: boolean;
      labelGenerated: boolean;
    };
    rapidCapture?: AiGraderRapidCaptureManifestStatus;
  };
};

export type AiGraderRapidCaptureQueueStatus = {
  enabled: boolean;
  activeQueueItemId?: string;
  activeReview?: AiGraderRapidCaptureActiveReview;
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
export type AiGraderWarmRunnerExecutionPath = "warm_full_forensic_runner";
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
  safety: {
    captureLock: true;
    watchdogSafeOff: true;
    safeOffOnFailure: true;
    safeOffOnCancellation: true;
    safeOffOnSessionEnd: true;
    publicRouteExposed: false;
    productionServiceTokenUsed: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
  };
  note: string;
};

export type AiGraderLocalStationStatus = {
  bridgeVersion: typeof AI_GRADER_LOCAL_STATION_BRIDGE_VERSION;
  reportProducerContractVersion: typeof AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION;
  stationId: string;
  mode: AiGraderLocalStationBridgeMode;
  localOnly: true;
  loginRequired: false;
  hardwareActionsEnabled: boolean;
  gradingContract?: AiGraderGradingContract;
  mathematicalCalibration?: {
    ready: boolean;
    reason?: string;
    profileId?: string;
    calibrationVersion?: string;
    rigId?: string;
    artifactSha256?: string;
  };
  calibrationActivation?: {
    configured: boolean;
    state: "UNAVAILABLE" | "IDLE" | "PENDING" | "ACTIVE";
    observation?: AiGraderCalibrationWorkstationObservationV1;
    receipt?: AiGraderCalibrationWorkstationReceiptV1;
    authority?: AiGraderCalibrationActivationAuthorityV1;
  };
  mathematicalV1?: AiGraderMathematicalV1State;
  currentStep: AiGraderStationStepId;
  nextAction: AiGraderStationAction;
  nextActionLabel: string;
  executionPath: AiGraderWarmRunnerExecutionPath;
  captureProfile: AiGraderCaptureProfile;
  captureProfileGuard: AiGraderCaptureProfileGuard;
  captureTiming: AiGraderCaptureTimingMetadata;
  frontCaptureReadiness: AiGraderFrontCaptureReadiness;
  acceptedProfile: {
    dutyPercent: number;
    exposureUs: number;
    gain: number;
    channels: number[];
    source: "operator_preview" | "browser_live_tuning" | "default" | "mock" | "bridge_operator" | "cli_override";
    actualLeimacPwmStep?: number;
    acceptedAt?: string;
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
      action: AiGraderStationAction | "preview-status" | "preview-stream" | "lighting-status" | "lighting-apply" | "lighting-heartbeat";
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
  };
  geometryCaptureDecisions: Partial<Record<AiGraderWarmRunnerSide, {
    mode: "detected_geometry";
    placementState: AiGraderCardPlacementState;
    timestamp: string;
    explicitOperatorAction: boolean;
    detectionUsed: boolean;
    sourceFrameId?: string;
  }>>;
  reportBundle?: AiGraderStationReportBundle;
  stationUrl?: string;
  bridgeSecurity?: {
    tokenRequired: true;
    allowedOrigins: string[];
    host: string;
    port: number;
    rejectsNonLoopback: true;
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
  productionRelease?: AiGraderStationProductionRelease;
  rapidCapture: AiGraderRapidCaptureManifestStatus;
  rapidCaptureQueue: AiGraderRapidCaptureQueueStatus;
};

export type AiGraderFrontWorkflowBinding = {
  sessionId: string;
  reportId: string;
  side: 'front';
  sideEpoch: string;
};


export type AiGraderFrontCaptureReadinessCode =
  | 'ready'
  | 'session_required'
  | 'capture_blocked'
  | 'safety_state_unverified'
  | 'lifecycle_pending'
  | 'workflow_transition_required'
  | 'current_step_not_capture_front'
  | 'mathematical_authority_required'
  | 'design_reference_staging_required'
  | 'front_binding_stale'
  | 'live_preview_required';

export type AiGraderFrontCaptureReadiness = {
  ready: boolean;
  code: AiGraderFrontCaptureReadinessCode;
  message: string;
  binding?: AiGraderFrontWorkflowBinding;
  profileIdentity?: string;
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
  captureProfile: AiGraderCaptureTimingProfile = "production_fast"
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
    return buildDefaultAiGraderCaptureTiming(authoritativeProfile ?? "production_fast");
  }
  const recordProfile = record?.captureProfile === "production_fast" ? record.captureProfile : undefined;
  const captureProfile = authoritativeProfile ?? recordProfile ?? "production_fast";

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
          const triggerMode = entry.triggerMode === "operator" ? entry.triggerMode : undefined;
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
function stationRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeStationId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(trimmed)) return undefined;
  if (/token|secret|bearer|authorization|presign|x-amz|localhost/i.test(trimmed)) return undefined;
  return trimmed;
}

function safeStationTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function safeStationText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500 || /^data:image/i.test(trimmed) || /[a-z]:[\\/]/i.test(trimmed) ||
      /(?:station|bridge|service)[_-]?token|pairing[_-]?code|authorization|bearer\s|x-amz-|presigned/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function exactMathematicalSha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

function safeMathematicalIdentityText(value: unknown, maxLength = 191): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/ -]*$/.test(trimmed) ||
      /(?:token|secret|bearer|authorization|presign|x-amz|localhost)/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function safeMathematicalLeaf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(trimmed) ? trimmed : undefined;
}

function finiteMathematicalNumber(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function positiveMathematicalInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function sanitizeMathematicalCardIdentity(value: unknown): AiGraderMathematicalCardIdentityV1 | undefined {
  if (!stationRecord(value) || value.sideCount !== 2) return undefined;
  const title = safeStationText(value.title);
  const tenantId = safeMathematicalIdentityText(value.tenantId);
  const setId = safeMathematicalIdentityText(value.setId);
  const programId = safeMathematicalIdentityText(value.programId);
  const cardNumber = safeMathematicalIdentityText(value.cardNumber, 128);
  const variantId = value.variantId === null ? null : safeMathematicalIdentityText(value.variantId);
  const parallelId = value.parallelId === null ? null : safeMathematicalIdentityText(value.parallelId);
  if (!title || !tenantId || !setId || !programId || !cardNumber ||
      variantId === undefined || parallelId === undefined) return undefined;
  return { title, sideCount: 2, tenantId, setId, programId, cardNumber, variantId, parallelId };
}

function sanitizeMathematicalPixelBoundary(value: unknown):
  AiGraderMathematicalApprovedDesignReferenceV1["intendedDesignBoundary"] | undefined {
  if (!stationRecord(value) ||
      value.schemaVersion !== "ai-grader-intended-design-boundary-v1" ||
      value.coordinateFrame !== "design_reference_pixels" ||
      !Array.isArray(value.contour) ||
      value.contour.length < 3 ||
      value.contour.length > 4096) return undefined;
  const contour: Array<[number, number]> = [];
  for (const point of value.contour) {
    if (!Array.isArray(point) || point.length !== 2) return undefined;
    const x = finiteMathematicalNumber(point[0]);
    const y = finiteMathematicalNumber(point[1]);
    if (x === undefined || y === undefined) return undefined;
    contour.push([x, y]);
  }
  return {
    schemaVersion: "ai-grader-intended-design-boundary-v1",
    coordinateFrame: "design_reference_pixels",
    contour,
  };
}

function sanitizeMathematicalApprovedReference(
  value: unknown,
  side: "front" | "back",
  cardIdentity: AiGraderMathematicalCardIdentityV1,
): AiGraderMathematicalApprovedDesignReferenceV1 | undefined {
  if (!stationRecord(value) ||
      value.profile !== "registered_design_template_v1" ||
      value.status !== "approved" ||
      value.side !== side) return undefined;
  const tenantId = safeMathematicalIdentityText(value.tenantId);
  const setId = safeMathematicalIdentityText(value.setId);
  const programId = safeMathematicalIdentityText(value.programId);
  const cardNumber = safeMathematicalIdentityText(value.cardNumber, 128);
  const variantId = value.variantId === null ? null : safeMathematicalIdentityText(value.variantId);
  const parallelId = value.parallelId === null ? null : safeMathematicalIdentityText(value.parallelId);
  const referenceId = safeMathematicalIdentityText(value.referenceId);
  const version = positiveMathematicalInteger(value.version);
  const artifactSha256 = exactMathematicalSha256(value.artifactSha256);
  const artifactWidthPx = positiveMathematicalInteger(value.artifactWidthPx, 100000);
  const artifactHeightPx = positiveMathematicalInteger(value.artifactHeightPx, 100000);
  const intendedDesignBoundary = sanitizeMathematicalPixelBoundary(value.intendedDesignBoundary);
  const approvedByUserId = safeMathematicalIdentityText(value.approvedByUserId);
  const approvedAt = safeStationTimestamp(value.approvedAt);
  if (!tenantId || !setId || !programId || !cardNumber || variantId === undefined ||
      parallelId === undefined || !referenceId || !version || !artifactSha256 ||
      !artifactWidthPx || !artifactHeightPx || !intendedDesignBoundary ||
      !approvedByUserId || !approvedAt) return undefined;
  if (tenantId !== cardIdentity.tenantId || setId !== cardIdentity.setId ||
      programId !== cardIdentity.programId || cardNumber !== cardIdentity.cardNumber ||
      variantId !== cardIdentity.variantId || parallelId !== cardIdentity.parallelId) return undefined;
  return {
    tenantId,
    setId,
    programId,
    cardNumber,
    variantId,
    parallelId,
    referenceId,
    profile: "registered_design_template_v1",
    status: "approved",
    side,
    version,
    artifactSha256,
    artifactWidthPx,
    artifactHeightPx,
    intendedDesignBoundary,
    approvedByUserId,
    approvedAt,
  };
}

function sanitizeMathematicalCenteringAuthority(
  value: unknown,
  side: "front" | "back",
  cardIdentity: AiGraderMathematicalCardIdentityV1,
): AiGraderMathematicalCenteringAuthorityV1 | undefined {
  if (!stationRecord(value)) return undefined;
  if (value.profile === "printed_border_v1") return { profile: "printed_border_v1" };
  if (value.profile !== "registered_design_template_v1") return undefined;
  const approvedReference = sanitizeMathematicalApprovedReference(value.approvedReference, side, cardIdentity);
  const artifact = stationRecord(value.approvedDesignArtifact) ? value.approvedDesignArtifact : undefined;
  const assetId = safeMathematicalIdentityText(artifact?.assetId);
  const fileName = safeMathematicalLeaf(artifact?.fileName);
  const contentType = artifact?.contentType === "image/png" || artifact?.contentType === "image/jpeg"
    ? artifact.contentType
    : undefined;
  const sha256 = exactMathematicalSha256(artifact?.sha256);
  if (!approvedReference || !assetId || !fileName || !contentType || !sha256 ||
      sha256 !== approvedReference.artifactSha256) return undefined;
  return {
    profile: "registered_design_template_v1",
    approvedReference,
    approvedDesignArtifact: { assetId, fileName, contentType, sha256 },
  };
}

export function sanitizeAiGraderMathematicalGradingAuthorityV1(
  value: unknown,
): AiGraderMathematicalGradingAuthorityV1 | undefined {
  if (!stationRecord(value) ||
      value.schemaVersion !== "fixed_rig_mathematical_station_grading_authority_v1" ||
      (value.cardFormatId !== "standard_trading_card_63_50x88_90_r3_18_v1" &&
        value.cardFormatId !== "pokemon_tcg_standard") ||
      !stationRecord(value.sides)) return undefined;
  const cardIdentity = sanitizeMathematicalCardIdentity(value.cardIdentity);
  if (!cardIdentity) return undefined;
  const frontValue = stationRecord(value.sides.front) ? value.sides.front.centering : undefined;
  const backValue = stationRecord(value.sides.back) ? value.sides.back.centering : undefined;
  const front = sanitizeMathematicalCenteringAuthority(frontValue, "front", cardIdentity);
  const back = sanitizeMathematicalCenteringAuthority(backValue, "back", cardIdentity);
  if (!front || !back) return undefined;
  const base = {
    schemaVersion: "fixed_rig_mathematical_station_grading_authority_v1" as const,
    cardIdentity,
    sides: { front: { centering: front }, back: { centering: back } },
  };
  if (value.cardFormatId === "standard_trading_card_63_50x88_90_r3_18_v1") {
    if ("trustedCardFormatAuthority" in value) return undefined;
    return { ...base, cardFormatId: value.cardFormatId };
  }
  const trusted = trustedPokemonCardFormatAuthorityV1Schema.safeParse(
    value.trustedCardFormatAuthority,
  );
  if (!trusted.success ||
      JSON.stringify(trusted.data.artifact.cardIdentity) !== JSON.stringify(cardIdentity)) {
    return undefined;
  }
  return {
    ...base,
    cardFormatId: "pokemon_tcg_standard",
    trustedCardFormatAuthority: trusted.data,
  };
}

function sanitizeMathematicalReviewAsset(
  value: unknown,
  expectedRole: AiGraderMathematicalReviewAssetRoleV1,
): AiGraderMathematicalReviewAssetMetadataV1 | undefined {
  if (!stationRecord(value) || value.evidenceRole !== expectedRole) return undefined;
  const assetId = safeMathematicalIdentityText(value.assetId);
  const sha256 = exactMathematicalSha256(value.sha256);
  const fileName = safeMathematicalLeaf(value.fileName);
  const contentType = value.contentType === "image/png" || value.contentType === "image/jpeg" ||
    value.contentType === "image/tiff" ? value.contentType : undefined;
  const byteSize = positiveMathematicalInteger(value.byteSize, 64 * 1024 * 1024);
  const widthPx = positiveMathematicalInteger(value.widthPx, 100000);
  const heightPx = positiveMathematicalInteger(value.heightPx, 100000);
  if (!assetId || !sha256 || !fileName || !contentType || !byteSize || !widthPx || !heightPx) return undefined;
  return { assetId, evidenceRole: expectedRole, sha256, fileName, contentType, byteSize, widthPx, heightPx };
}

function sanitizeMathematicalReviewMeasurement(value: unknown): AiGraderMathematicalReviewMeasurementV1 | undefined {
  if (!stationRecord(value)) return undefined;
  const measurementId = safeMathematicalIdentityText(value.measurementId);
  const kind = safeMathematicalIdentityText(value.kind);
  const unit = safeMathematicalIdentityText(value.unit);
  const calibrationProfileId = safeMathematicalIdentityText(value.calibrationProfileId);
  const calibrationVersion = safeMathematicalIdentityText(value.calibrationVersion);
  const algorithmVersion = safeMathematicalIdentityText(value.algorithmVersion);
  const measuredMeasurement = finiteMathematicalNumber(value.measuredMeasurement);
  const u95 = finiteMathematicalNumber(value.u95);
  const effectiveMeasurement = finiteMathematicalNumber(value.effectiveMeasurement);
  const explicitGrade10Tolerance = finiteMathematicalNumber(value.explicitGrade10Tolerance);
  const grade10Buffer = finiteMathematicalNumber(value.grade10Buffer);
  const validEvidenceCoverage = finiteMathematicalNumber(value.validEvidenceCoverage, 0, 1);
  const usableDirectionalChannelCount = finiteMathematicalNumber(value.usableDirectionalChannelCount, 0, 8);
  if (!measurementId || !kind || !unit || !calibrationProfileId || !calibrationVersion ||
      !algorithmVersion || measuredMeasurement === undefined || u95 === undefined ||
      effectiveMeasurement === undefined || explicitGrade10Tolerance === undefined ||
      grade10Buffer === undefined || validEvidenceCoverage === undefined ||
      usableDirectionalChannelCount === undefined) return undefined;
  return {
    measurementId,
    kind,
    unit,
    measuredMeasurement,
    u95,
    effectiveMeasurement,
    explicitGrade10Tolerance,
    grade10Buffer,
    calibrationProfileId,
    calibrationVersion,
    algorithmVersion,
    validEvidenceCoverage,
    usableDirectionalChannelCount,
  };
}

function sanitizeMathematicalFindingReviewRequest(
  value: unknown,
): AiGraderMathematicalFindingReviewRequestV1 | undefined {
  if (!stationRecord(value) ||
      value.schemaVersion !== "fixed_rig_mathematical_finding_review_request_v1" ||
      value.gradingContract !== "mathematical_calibration_v1" ||
      value.hashPolicy !== "sha256-canonical-json-with-artifactSha256-omitted" ||
      !stationRecord(value.calibration) ||
      !Array.isArray(value.findings)) return undefined;
  const gradingSessionId = safeStationId(value.gradingSessionId);
  const reportId = safeStationId(value.reportId);
  const generatedAt = safeStationTimestamp(value.generatedAt);
  const profileId = safeMathematicalIdentityText(value.calibration.profileId);
  const calibrationVersion = safeMathematicalIdentityText(value.calibration.calibrationVersion);
  const calibrationArtifactSha256 = exactMathematicalSha256(value.calibration.artifactSha256);
  const artifactSha256 = exactMathematicalSha256(value.artifactSha256);
  if (!gradingSessionId || !reportId || !generatedAt || !profileId || !calibrationVersion ||
      !calibrationArtifactSha256 || !artifactSha256 || value.findings.length < 1 ||
      value.findings.length > 500) return undefined;
  const findings: AiGraderMathematicalFindingReviewRequestV1["findings"] = [];
  const findingIds = new Set<string>();
  for (const rawFinding of value.findings) {
    if (!stationRecord(rawFinding) || !stationRecord(rawFinding.geometry) ||
        !stationRecord(rawFinding.detector) || !stationRecord(rawFinding.reviewEvidence) ||
        !Array.isArray(rawFinding.directionalChannels) ||
        rawFinding.directionalChannels.length !== 8 ||
        !Array.isArray(rawFinding.measurements) ||
        !Array.isArray(rawFinding.evidenceAssetIds)) return undefined;
    const findingId = safeMathematicalIdentityText(rawFinding.findingId);
    const physicalDefectId = safeMathematicalIdentityText(rawFinding.physicalDefectId);
    const element = rawFinding.element === "centering" || rawFinding.element === "corners" ||
      rawFinding.element === "edges" || rawFinding.element === "surface" ? rawFinding.element : undefined;
    const category = safeMathematicalIdentityText(rawFinding.category);
    const side = rawFinding.side === "front" || rawFinding.side === "back" ? rawFinding.side : undefined;
    const location = safeMathematicalIdentityText(rawFinding.location);
    const regionId = safeMathematicalIdentityText(rawFinding.regionId);
    const detectorId = safeMathematicalIdentityText(rawFinding.detector.id);
    const detectorVersion = safeMathematicalIdentityText(rawFinding.detector.version);
    const measuredDeduction = finiteMathematicalNumber(rawFinding.measuredDeduction, 0, 9);
    const explanation = safeStationText(rawFinding.explanation);
    const geometry = rawFinding.geometry;
    const x = finiteMathematicalNumber(geometry.x, 0, 1);
    const y = finiteMathematicalNumber(geometry.y, 0, 1);
    const width = finiteMathematicalNumber(geometry.width, 0, 1);
    const height = finiteMathematicalNumber(geometry.height, 0, 1);
    if (!findingId || findingIds.has(findingId) || !physicalDefectId || !element || !category ||
        !side || !location || !regionId || !detectorId || !detectorVersion ||
        measuredDeduction === undefined || !explanation ||
        geometry.coordinateFrame !== "normalized_card" || geometry.kind !== "box" ||
        x === undefined || y === undefined || width === undefined || height === undefined ||
        width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) return undefined;
    const measurements = rawFinding.measurements.map(sanitizeMathematicalReviewMeasurement);
    if (!measurements.length || measurements.some((entry) => !entry)) return undefined;
    const evidenceAssetIds = rawFinding.evidenceAssetIds.map((entry) =>
      safeMathematicalIdentityText(entry));
    if (!evidenceAssetIds.length || evidenceAssetIds.some((entry) => !entry)) return undefined;
    const trueView = sanitizeMathematicalReviewAsset(rawFinding.trueView, "normalized_card");
    const directionalChannels = rawFinding.directionalChannels.map((entry) =>
      sanitizeMathematicalReviewAsset(entry, "directional_channel"));
    const roi = sanitizeMathematicalReviewAsset(rawFinding.reviewEvidence.roi, "roi_crop");
    const segmentationMask = sanitizeMathematicalReviewAsset(rawFinding.reviewEvidence.segmentationMask, "segmentation_mask");
    const confidenceMask = sanitizeMathematicalReviewAsset(rawFinding.reviewEvidence.confidenceMask, "confidence_mask");
    const illuminationMask = sanitizeMathematicalReviewAsset(rawFinding.reviewEvidence.illuminationMask, "illumination_mask");
    if (!trueView || directionalChannels.some((entry) => !entry) || !roi || !segmentationMask ||
        !confidenceMask || !illuminationMask) return undefined;
    findingIds.add(findingId);
    findings.push({
      findingId,
      physicalDefectId,
      element,
      category,
      side,
      location,
      regionId,
      geometry: { coordinateFrame: "normalized_card", kind: "box", x, y, width, height },
      detector: { id: detectorId, version: detectorVersion },
      measuredDeduction,
      measurements: measurements as AiGraderMathematicalReviewMeasurementV1[],
      evidenceAssetIds: evidenceAssetIds as string[],
      trueView,
      directionalChannels: directionalChannels as AiGraderMathematicalReviewAssetMetadataV1[],
      reviewEvidence: { roi, segmentationMask, confidenceMask, illuminationMask },
      explanation,
    });
  }
  return {
    schemaVersion: "fixed_rig_mathematical_finding_review_request_v1",
    gradingContract: "mathematical_calibration_v1",
    gradingSessionId,
    reportId,
    generatedAt,
    calibration: { profileId, calibrationVersion, artifactSha256: calibrationArtifactSha256 },
    findings,
    hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
    artifactSha256,
  };
}

function mathematicalBrowserInsufficientExecution(reason: string): AiGraderMathematicalExecutionV1 {
  return {
    status: "insufficient_evidence",
    completedAt: new Date(0).toISOString(),
    attempt: 1,
    v0FallbackUsed: false,
    failedStage: "finding_review",
    reasons: [reason],
    requiresRecapture: false,
    requiresApprovedDesignReference: false,
    requiresCalibration: false,
    requiresImplementationCorrection: true,
  };
}

function sanitizeMathematicalExecution(value: unknown): AiGraderMathematicalExecutionV1 | undefined {
  if (!stationRecord(value)) return undefined;
  if (value.v0FallbackUsed !== false) {
    return mathematicalBrowserInsufficientExecution("The bridge claimed a prohibited V0 fallback; Mathematical V1 remains blocked.");
  }
  const attempt = positiveMathematicalInteger(value.attempt, 1000);
  if (!attempt) return mathematicalBrowserInsufficientExecution("The bridge returned malformed Mathematical V1 execution metadata.");
  if (value.status === "processing") {
    const startedAt = safeStationTimestamp(value.startedAt);
    const reviewRequestSha256 = exactMathematicalSha256(value.reviewRequestSha256);
    return startedAt
      ? { status: "processing", startedAt, attempt, v0FallbackUsed: false, ...(reviewRequestSha256 ? { reviewRequestSha256 } : {}) }
      : mathematicalBrowserInsufficientExecution("The bridge returned malformed Mathematical V1 processing metadata.");
  }
  const completedAt = safeStationTimestamp(value.completedAt);
  if (!completedAt) return mathematicalBrowserInsufficientExecution("The bridge returned malformed Mathematical V1 completion metadata.");
  if (value.status === "finding_review_required") {
    const reviewRequest = sanitizeMathematicalFindingReviewRequest(value.reviewRequest);
    if (!reviewRequest) {
      return mathematicalBrowserInsufficientExecution("The bridge returned a malformed exact finding-review request; no review or release is permitted.");
    }
    const reviewIssues = Array.isArray(value.reviewIssues)
      ? value.reviewIssues.map(safeStationText).filter((entry): entry is string => Boolean(entry)).slice(0, 500)
      : [];
    return { status: "finding_review_required", completedAt, attempt, v0FallbackUsed: false, reviewRequest, reviewIssues };
  }
  if (value.status === "completed") {
    const orchestrationTraceSha256 = exactMathematicalSha256(value.orchestrationTraceSha256);
    return orchestrationTraceSha256
      ? { status: "completed", completedAt, attempt, v0FallbackUsed: false, orchestrationTraceSha256 }
      : mathematicalBrowserInsufficientExecution("The completed Mathematical V1 execution is missing its exact orchestration trace SHA-256.");
  }
  if (value.status === "insufficient_evidence") {
    const failedStage = safeMathematicalIdentityText(value.failedStage) ?? "unknown_stage";
    const reasons = Array.isArray(value.reasons)
      ? value.reasons.map(safeStationText).filter((entry): entry is string => Boolean(entry)).slice(0, 500)
      : [];
    return {
      status: "insufficient_evidence",
      completedAt,
      attempt,
      v0FallbackUsed: false,
      failedStage,
      reasons: reasons.length ? reasons : ["Mathematical V1 stopped with insufficient evidence."],
      requiresRecapture: value.requiresRecapture === true,
      requiresApprovedDesignReference: value.requiresApprovedDesignReference === true,
      requiresCalibration: value.requiresCalibration === true,
      requiresImplementationCorrection: value.requiresImplementationCorrection === true,
    };
  }
  return mathematicalBrowserInsufficientExecution("The bridge returned an unsupported Mathematical V1 execution state.");
}

export function sanitizeAiGraderMathematicalV1StateForDisplay(
  value: unknown,
): AiGraderMathematicalV1State | undefined {
  if (!stationRecord(value) ||
      value.schemaVersion !== "ten-kings-ai-grader-local-station-mathematical-v1-state-v1") return undefined;
  const generatedAt = safeStationTimestamp(value.generatedAt);
  const gradingAuthority = sanitizeAiGraderMathematicalGradingAuthorityV1(value.gradingAuthority);
  if (!generatedAt || !gradingAuthority) return undefined;
  const stagedDesignReferences: AiGraderMathematicalV1State["stagedDesignReferences"] = {};
  const staged = stationRecord(value.stagedDesignReferences) ? value.stagedDesignReferences : {};
  for (const side of ["front", "back"] as const) {
    const entry = staged[side];
    if (!stationRecord(entry) || entry.side !== side) continue;
    const referenceId = safeMathematicalIdentityText(entry.referenceId);
    const assetId = safeMathematicalIdentityText(entry.assetId);
    const fileName = safeMathematicalLeaf(entry.fileName);
    const contentType = entry.contentType === "image/png" || entry.contentType === "image/jpeg"
      ? entry.contentType
      : undefined;
    const sha256 = exactMathematicalSha256(entry.sha256);
    const byteSize = positiveMathematicalInteger(entry.byteSize, 64 * 1024 * 1024);
    const stagedAt = safeStationTimestamp(entry.stagedAt);
    if (referenceId && assetId && fileName && contentType && sha256 && byteSize && stagedAt) {
      stagedDesignReferences[side] = {
        side, referenceId, assetId, fileName, contentType, sha256, byteSize, stagedAt,
      };
    }
  }
  const submittedFindingReviews = Array.isArray(value.submittedFindingReviews)
    ? value.submittedFindingReviews.map((entry): AiGraderMathematicalFindingReviewV1 | undefined => {
        if (!stationRecord(entry)) return undefined;
        const findingId = safeMathematicalIdentityText(entry.findingId);
        const reviewRequestSha256 = exactMathematicalSha256(entry.reviewRequestSha256);
        const status = entry.status === "confirmed" || entry.status === "adjusted" ? entry.status : undefined;
        const reviewedAt = safeStationTimestamp(entry.reviewedAt);
        return findingId && reviewRequestSha256 && status && reviewedAt
          ? { findingId, reviewRequestSha256, status, reviewedAt }
          : undefined;
      }).filter((entry): entry is AiGraderMathematicalFindingReviewV1 => Boolean(entry))
    : undefined;
  const execution = sanitizeMathematicalExecution(value.execution);
  return {
    schemaVersion: "ten-kings-ai-grader-local-station-mathematical-v1-state-v1",
    generatedAt,
    gradingAuthority,
    stagedDesignReferences,
    ...(submittedFindingReviews?.length ? { submittedFindingReviews } : {}),
    ...(execution ? { execution } : {}),
  };
}

const AI_GRADER_BROWSER_UNSAFE_KEY = /(?:path|dir|folder)$|^local|token|authorization|presign|credential|secret|cookie|bodyBase64|bodyEncoding/i;
const AI_GRADER_BROWSER_UNSAFE_STRING = /(?:^|[\s"'(])(?:[a-z]:[\\/]|\\\\)|^file:|(?:station|bridge|service)[_-]?token|authorization|bearer\s|x-amz-|presigned|https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i;

function browserSafeStationRecord(value: unknown): Record<string, unknown> | undefined {
  let visited = 0;
  const clone = (input: unknown, depth: number): unknown => {
    visited += 1;
    if (visited > 20_000 || depth > 40) throw new Error("Station review payload is too deeply nested.");
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
    if (typeof input === "string") {
      if (input.length > 250_000 || AI_GRADER_BROWSER_UNSAFE_STRING.test(input) || /^data:/i.test(input.trim())) return undefined;
      return input;
    }
    if (Array.isArray(input)) {
      return input.map((entry) => clone(entry, depth + 1)).filter((entry) => entry !== undefined);
    }
    if (!stationRecord(input)) return undefined;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) {
      if (AI_GRADER_BROWSER_UNSAFE_KEY.test(key)) continue;
      const safeChild = clone(child, depth + 1);
      if (safeChild !== undefined) output[key] = safeChild;
    }
    return output;
  };
  try {
    const cloned = clone(value, 0);
    if (!stationRecord(cloned) || JSON.stringify(cloned).length > 2_000_000) return undefined;
    return cloned;
  } catch {
    return undefined;
  }
}

const AI_GRADER_RAPID_CAPTURE_WORKFLOW_STATES: AiGraderRapidCaptureWorkflowState[] = [
  "front_captured",
  "front_processing",
  "back_positioning",
  "back_captured",
  "finalizing",
  "finding_review_required",
  "insufficient_evidence",
  "report_ready_needs_confirm",
  "confirmed_needs_publish",
  "published",
  "failed",
];

export function parseAiGraderRapidCaptureWorkflowState(value: unknown): AiGraderRapidCaptureWorkflowState | null {
  return typeof value === "string" && AI_GRADER_RAPID_CAPTURE_WORKFLOW_STATES.includes(value as AiGraderRapidCaptureWorkflowState)
    ? value as AiGraderRapidCaptureWorkflowState
    : null;
}

function sanitizeAiGraderRapidCaptureHistory(value: unknown): AiGraderRapidCaptureWorkflowEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): AiGraderRapidCaptureWorkflowEvent | undefined => {
      if (!stationRecord(entry)) return undefined;
      const state = parseAiGraderRapidCaptureWorkflowState(entry.state);
      const at = safeStationTimestamp(entry.at);
      if (!state || !at) return undefined;
      return { state, at, detail: safeStationText(entry.detail) ?? "Rapid Capture state updated." };
    })
    .filter((entry): entry is AiGraderRapidCaptureWorkflowEvent => Boolean(entry))
    .slice(-100);
}

function sanitizeAiGraderRapidCaptureManifest(value: unknown): AiGraderRapidCaptureManifestStatus {
  const record = stationRecord(value) ? value : {};
  const queueItemId = safeStationId(record.queueItemId);
  const workflowState = parseAiGraderRapidCaptureWorkflowState(record.workflowState);
  const safelyQueuedAt = safeStationTimestamp(record.safelyQueuedAt);
  return {
    enabled: true,
    ...(queueItemId ? { queueItemId } : {}),
    ...(workflowState ? { workflowState } : {}),
    workflowHistory: sanitizeAiGraderRapidCaptureHistory(record.workflowHistory),
    ...(safelyQueuedAt ? { safelyQueuedAt } : {}),
    humanConfirmationRequired: true,
    autoConfirm: false,
    autoPublish: false,
  };
}

const AI_GRADER_QUEUED_OCR_STATES: AiGraderQueuedOcrLifecycle["state"][] = [
  "waiting_for_normalized",
  "eligible",
  "in_flight",
  "succeeded",
  "failed",
];
const AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

function sanitizeAiGraderQueuedOcrImage(value: unknown): AiGraderQueuedOcrImage | undefined {
  if (!stationRecord(value) || (value.side !== "front" && value.side !== "back") ||
      value.artifactRole !== "normalized_card" || value.mimeType !== "image/png" ||
      value.widthPx !== 1200 || value.heightPx !== 1680) return undefined;
  const fileName = value.fileName === `${value.side}-normalized-card.png`
    ? value.fileName
    : undefined;
  const checksumSha256 = typeof value.checksumSha256 === "string" && /^[a-f0-9]{64}$/.test(value.checksumSha256)
    ? value.checksumSha256
    : undefined;
  const byteSize = Number(value.byteSize);
  if (!fileName || !checksumSha256 || !Number.isSafeInteger(byteSize) || byteSize < 1) return undefined;
  return {
    side: value.side,
    artifactRole: "normalized_card",
    fileName,
    mimeType: "image/png",
    checksumSha256,
    byteSize,
    widthPx: 1200,
    heightPx: 1680,
  };
}

function sanitizeAiGraderQueuedOcr(
  value: unknown,
  identity: { queueItemId: string; gradingSessionId: string; reportId: string },
): AiGraderQueuedOcrLifecycle {
  const record = stationRecord(value) ? value : {};
  const parsedState = typeof record.state === "string" &&
    AI_GRADER_QUEUED_OCR_STATES.includes(record.state as AiGraderQueuedOcrLifecycle["state"])
    ? record.state as AiGraderQueuedOcrLifecycle["state"]
    : undefined;
  const updatedAt = safeStationTimestamp(record.updatedAt);
  const attemptCount = record.attemptCount === 1 ? 1 : 0;
  const images = Array.isArray(record.images)
    ? record.images.map(sanitizeAiGraderQueuedOcrImage).filter((image): image is AiGraderQueuedOcrImage => Boolean(image))
    : [];
  const sortedImageSides = images.map((image) => image.side)
    .sort((left, right) => left === right ? 0 : left === "front" ? -1 : 1);
  const rawImagesValid = Array.isArray(record.images) &&
    record.images.length >= 1 &&
    record.images.length <= 2 &&
    images.length === record.images.length &&
    new Set(images.map((image) => image.side)).size === images.length &&
    images.every((image, index) => image.side === sortedImageSides[index]);
  const eligibleAt = safeStationTimestamp(record.eligibleAt);
  const startedAt = safeStationTimestamp(record.startedAt);
  const completedAt = safeStationTimestamp(record.completedAt);
  const attemptOwnerId = typeof record.attemptOwnerId === "string" &&
    AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_PATTERN.test(record.attemptOwnerId)
    ? record.attemptOwnerId
    : undefined;
  const attemptOwnerAbsent = record.attemptOwnerId === undefined;
  const result = browserSafeStationRecord(record.result);
  const exactResult = result &&
    safeStationId(result.queueItemId) === identity.queueItemId &&
    safeStationId(result.gradingSessionId) === identity.gradingSessionId &&
    safeStationId(result.reportId) === identity.reportId &&
    result.status === "prefill_ready"
    ? result
    : undefined;
  const failureRecord = stationRecord(record.failure) ? record.failure : {};
  const failureCode = safeStationId(failureRecord.code);
  const failureMessage = safeStationText(failureRecord.message);
  const waitingImages = rawImagesValid ? images : undefined;
  const exactImages = rawImagesValid && images.length === 2 ? images : undefined;
  const ordered = (...timestamps: Array<string | undefined>) => {
    const present = timestamps.filter((timestamp): timestamp is string => Boolean(timestamp));
    return present.every((timestamp, index) => index === 0 || Date.parse(present[index - 1]) <= Date.parse(timestamp));
  };
  const noTerminalPayload = record.result === undefined && record.failure === undefined && completedAt === undefined;
  const structurallyValid = Boolean(updatedAt && parsedState && (
    (parsedState === "waiting_for_normalized" && attemptCount === 0 && attemptOwnerAbsent && !eligibleAt && !startedAt && (record.images === undefined || waitingImages) && noTerminalPayload) ||
    (parsedState === "eligible" && attemptCount === 0 && attemptOwnerAbsent && eligibleAt && !startedAt && exactImages && noTerminalPayload && ordered(eligibleAt, updatedAt)) ||
    (parsedState === "in_flight" && attemptCount === 1 && attemptOwnerId && eligibleAt && startedAt && exactImages && noTerminalPayload && ordered(eligibleAt, startedAt, updatedAt)) ||
    (parsedState === "succeeded" && attemptCount === 1 && attemptOwnerId && eligibleAt && startedAt && completedAt && exactImages && exactResult && record.failure === undefined && ordered(eligibleAt, startedAt, completedAt, updatedAt)) ||
    (parsedState === "failed" && completedAt && failureCode && failureMessage && record.result === undefined && (
      (attemptCount === 0 && attemptOwnerAbsent && !startedAt && ordered(completedAt, updatedAt)) ||
      (attemptCount === 1 && attemptOwnerId && eligibleAt && startedAt && exactImages && ordered(eligibleAt, startedAt, completedAt, updatedAt))
    ))
  ));
  if (!structurallyValid || !parsedState || !updatedAt) {
    const failureAt = updatedAt ?? new Date(0).toISOString();
    return {
      state: "failed",
      updatedAt: failureAt,
      attemptCount,
      completedAt: failureAt,
      failure: {
        code: "AI_GRADER_OCR_PERSISTED_STATE_INVALID",
        message: `Persisted OCR lifecycle evidence is malformed for exact queue ${identity.queueItemId}, session ${identity.gradingSessionId}, report ${identity.reportId}; this item will not retry automatically.`.slice(0, 500),
      },
    };
  }
  const persistedImages = parsedState === "waiting_for_normalized" ? waitingImages : exactImages;
  return {
    state: parsedState,
    updatedAt,
    attemptCount,
    ...(eligibleAt ? { eligibleAt } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(attemptOwnerId ? { attemptOwnerId } : {}),
    ...(persistedImages ? { images: persistedImages } : {}),
    ...(exactResult ? { result: exactResult } : {}),
    ...(failureCode && failureMessage ? { failure: { code: failureCode, message: failureMessage } } : {}),
  };
}

function sanitizeAiGraderRapidCaptureQueueItem(value: unknown): AiGraderRapidCaptureQueueItem | undefined {
  if (!stationRecord(value)) return undefined;
  const queueItemId = safeStationId(value.queueItemId);
  const sessionId = safeStationId(value.sessionId);
  const reportId = safeStationId(value.reportId);
  const state = parseAiGraderRapidCaptureWorkflowState(value.state);
  const queuedAt = safeStationTimestamp(value.queuedAt);
  const updatedAt = safeStationTimestamp(value.updatedAt);
  if (!queueItemId || !sessionId || !reportId || !state || !queuedAt || !updatedAt) return undefined;
  const error = safeStationText(value.error);
  const rawMathematical = stationRecord(value.mathematicalV1) ? value.mathematicalV1 : undefined;
  const mathematicalStatus: AiGraderMathematicalExecutionV1["status"] | undefined = rawMathematical &&
    (rawMathematical.status === "processing" ||
      rawMathematical.status === "finding_review_required" ||
      rawMathematical.status === "completed" ||
      rawMathematical.status === "insufficient_evidence")
    ? rawMathematical.status
    : undefined;
  const mathematicalV1: AiGraderRapidCaptureQueueItem["mathematicalV1"] = mathematicalStatus
    ? {
        status: mathematicalStatus,
        ...(exactMathematicalSha256(rawMathematical?.reviewRequestSha256)
          ? { reviewRequestSha256: exactMathematicalSha256(rawMathematical?.reviewRequestSha256) }
          : {}),
        ...(safeMathematicalIdentityText(rawMathematical?.failedStage)
          ? { failedStage: safeMathematicalIdentityText(rawMathematical?.failedStage) }
          : {}),
        ...(Array.isArray(rawMathematical?.reasons)
          ? {
              reasons: rawMathematical.reasons
                .map(safeStationText)
                .filter((entry): entry is string => Boolean(entry))
                .slice(0, 100),
            }
          : {}),
        ...(rawMathematical?.requiresRecapture === true ? { requiresRecapture: true } : {}),
        ...(rawMathematical?.requiresApprovedDesignReference === true ? { requiresApprovedDesignReference: true } : {}),
        ...(rawMathematical?.requiresCalibration === true ? { requiresCalibration: true } : {}),
        ...(rawMathematical?.requiresImplementationCorrection === true ? { requiresImplementationCorrection: true } : {}),
      }
    : undefined;
  const ocr = sanitizeAiGraderQueuedOcr(value.ocr, {
    queueItemId,
    gradingSessionId: sessionId,
    reportId,
  });
  const stateWithTerminalOcr = ocr.state === "failed" ? "failed" : state;
  const terminalOcrError = ocr.state === "failed" ? ocr.failure?.message : undefined;
  return {
    queueItemId,
    sessionId,
    reportId,
    state: stateWithTerminalOcr,
    queuedAt,
    updatedAt,
    history: sanitizeAiGraderRapidCaptureHistory(value.history),
    humanConfirmationRequired: true,
    autoConfirmed: false,
    autoPublished: false,
    ...(mathematicalV1 ? { mathematicalV1 } : {}),
    ocr,
    ...(error || terminalOcrError ? { error: error ?? terminalOcrError } : {}),
  };
}

function sanitizeAiGraderRapidCaptureActiveReview(value: unknown): AiGraderRapidCaptureActiveReview | undefined {
  if (!stationRecord(value) || !stationRecord(value.manifest)) return undefined;
  const queueItemId = safeStationId(value.queueItemId);
  const gradingSessionId = safeStationId(value.gradingSessionId);
  const reportId = safeStationId(value.reportId);
  const manifest = value.manifest;
  if (!queueItemId || !gradingSessionId || !reportId) return undefined;
  const latest = stationRecord(manifest.latestReport) ? manifest.latestReport : {};
  if (safeStationId(latest.reportId) !== reportId ||
      (latest.exists !== true && latest.exists !== false)) return undefined;
  const mathematicalV1 = sanitizeAiGraderMathematicalV1StateForDisplay(manifest.mathematicalV1);
  const mathematicalExecution = mathematicalV1?.execution;
  if (mathematicalExecution?.status === "finding_review_required" &&
      (mathematicalExecution.reviewRequest.gradingSessionId !== gradingSessionId ||
        mathematicalExecution.reviewRequest.reportId !== reportId)) {
    return undefined;
  }
  const pendingMathematicalEvidence =
    mathematicalExecution?.status === "finding_review_required" ||
    mathematicalExecution?.status === "insufficient_evidence";
  if (latest.exists !== true && !pendingMathematicalEvidence) return undefined;
  const safeReportBundle = browserSafeStationRecord(manifest.reportBundle);
  const candidateReportBundle = safeReportBundle as unknown as AiGraderStationReportBundle | undefined;
  const reportBundle = safeReportBundle &&
      safeStationId(safeReportBundle.reportId) === reportId &&
      candidateReportBundle &&
      (isAiGraderReportBundleV03(candidateReportBundle) ||
        safeStationId(safeReportBundle.gradingSessionId) === gradingSessionId)
    ? candidateReportBundle
    : undefined;
  const safeProductionRelease = browserSafeStationRecord(manifest.productionRelease);
  const productionRelease = safeProductionRelease &&
      safeStationId(safeProductionRelease.reportId) === reportId &&
      safeStationId(safeProductionRelease.gradingSessionId) === gradingSessionId
    ? safeProductionRelease as unknown as AiGraderStationProductionRelease
    : undefined;
  const currentStep = typeof manifest.currentStep === "string"
    ? AI_GRADER_STATION_STEPS.find((step) => step.id === manifest.currentStep)?.id
    : undefined;
  return {
    queueItemId,
    gradingSessionId,
    reportId,
    manifest: {
      ...(currentStep ? { currentStep } : {}),
      latestReport: {
        reportId,
        localViewerPath: "/ai-grader/station",
        publicViewerRoute: "/ai-grader/reports/" + encodeURIComponent(reportId),
        exists: latest.exists === true,
      },
      ...(mathematicalV1 ? { mathematicalV1 } : {}),
      ...(reportBundle ? { reportBundle } : {}),
      ...(productionRelease ? { productionRelease } : {}),
      ...(stationRecord(manifest.safety) ? {
        safety: {
          finalGradeComputed: manifest.safety.finalGradeComputed === true,
          labelGenerated: manifest.safety.labelGenerated === true,
        },
      } : {}),
      ...(manifest.rapidCapture ? { rapidCapture: sanitizeAiGraderRapidCaptureManifest(manifest.rapidCapture) } : {}),
    },
  };
}

export function sanitizeAiGraderRapidCaptureQueue(value: unknown): AiGraderRapidCaptureQueueStatus {
  const record = stationRecord(value) ? value : {};
  const activeQueueItemId = safeStationId(record.activeQueueItemId);
  const activeReview = sanitizeAiGraderRapidCaptureActiveReview(record.activeReview);
  const items = Array.isArray(record.items)
    ? record.items.map(sanitizeAiGraderRapidCaptureQueueItem)
        .filter((item): item is AiGraderRapidCaptureQueueItem => Boolean(item))
        .slice(0, 50)
    : [];
  const exactActiveReview = activeReview && items.some((item) => {
    const pendingMathematicalState =
      item.state === "finding_review_required" || item.state === "insufficient_evidence";
    const activeMathematicalStatus = activeReview.manifest.mathematicalV1?.execution?.status;
    return item.queueItemId === activeReview.queueItemId &&
      item.sessionId === activeReview.gradingSessionId &&
      item.reportId === activeReview.reportId &&
      item.state !== "failed" &&
      (item.ocr.state === "succeeded" || pendingMathematicalState) &&
      (!pendingMathematicalState ||
        (item.mathematicalV1?.status === item.state && activeMathematicalStatus === item.state));
  })
    ? activeReview
    : undefined;
  return {
    enabled: true,
    ...(activeQueueItemId && exactActiveReview?.queueItemId === activeQueueItemId ? { activeQueueItemId } : {}),
    ...(exactActiveReview && exactActiveReview.queueItemId === activeQueueItemId ? { activeReview: exactActiveReview } : {}),
    persisted: true,
    reportWorkerSerialized: true,
    items,
  };
}

const AI_GRADER_FRONT_CAPTURE_READINESS_CODES: AiGraderFrontCaptureReadinessCode[] = [
  "ready",
  "session_required",
  "capture_blocked",
  "safety_state_unverified",
  "lifecycle_pending",
  "workflow_transition_required",
  "current_step_not_capture_front",
  "mathematical_authority_required",
  "design_reference_staging_required",
  "front_binding_stale",
  "live_preview_required",
];

function sanitizeAiGraderFrontWorkflowBinding(value: unknown): AiGraderFrontWorkflowBinding | undefined {
  if (!stationRecord(value) || value.side !== "front") return undefined;
  const sessionId = safeStationId(value.sessionId);
  const reportId = safeStationId(value.reportId);
  const sideEpoch = safeStationId(value.sideEpoch);
  return sessionId && reportId && sideEpoch ? { sessionId, reportId, side: "front", sideEpoch } : undefined;
}

function sanitizeAiGraderFrontCaptureReadiness(value: unknown): AiGraderFrontCaptureReadiness {
  const record = stationRecord(value) ? value : {};
  const code = typeof record.code === "string" &&
    AI_GRADER_FRONT_CAPTURE_READINESS_CODES.includes(record.code as AiGraderFrontCaptureReadinessCode)
      ? record.code as AiGraderFrontCaptureReadinessCode
      : "session_required";
  const binding = sanitizeAiGraderFrontWorkflowBinding(record.binding);
  const profileIdentity = typeof record.profileIdentity === "string" && /^accepted-[a-f0-9]{16}$/.test(record.profileIdentity)
    ? record.profileIdentity
    : undefined;
  const ready = record.ready === true && code === "ready" && Boolean(binding && profileIdentity);
  return {
    ready,
    code: ready ? "ready" : code === "ready" ? "front_binding_stale" : code,
    message: safeStationText(record.message) ?? "The exact current Front frame and acknowledged lighting profile are required.",
    ...(binding ? { binding } : {}),
    ...(profileIdentity ? { profileIdentity } : {}),
  };
}

function sanitizeGeometryCaptureDecisions(value: unknown): AiGraderLocalStationStatus["geometryCaptureDecisions"] {
  if (!stationRecord(value)) return {};
  const result: AiGraderLocalStationStatus["geometryCaptureDecisions"] = {};
  for (const side of ["front", "back"] as const) {
    const decision = value[side];
    if (!stationRecord(decision) || decision.mode !== "detected_geometry") continue;
    const placementState =
      decision.placementState === "ready" || decision.placementState === "adjust_card" || decision.placementState === "not_detected"
        ? decision.placementState
        : undefined;
    const timestamp = safeStationTimestamp(decision.timestamp);
    if (!placementState || !timestamp || decision.detectionUsed !== true) continue;
    const sourceFrameId = sanitizePreviewGeometrySourceFrameId(decision.sourceFrameId);
    result[side] = {
      mode: "detected_geometry",
      placementState,
      timestamp,
      explicitOperatorAction: true,
      detectionUsed: true,
      ...(sourceFrameId ? { sourceFrameId } : {}),
    };
  }
  return result;
}

/** Sanitizes the exact single capture path. */
export function sanitizeAiGraderLocalStationStatusForDisplay(
  status: AiGraderLocalStationStatus
): AiGraderLocalStationStatus {
  if (status.captureProfile !== "production_fast" ||
      status.captureProfileGuard?.selectionSource !== "bridge_required" ||
      status.captureProfileGuard?.oneRoadProductionFastRequired !== true) {
    throw new Error("Dell local bridge update/restart required. The one-road station requires production_fast.");
  }
  const captureProfile: AiGraderCaptureProfile = "production_fast";
  const rawMathematicalCalibration = status.mathematicalCalibration;
  const mathematicalCalibration = rawMathematicalCalibration
    ? {
        ready: rawMathematicalCalibration.ready === true,
        ...(safeStationText(rawMathematicalCalibration.reason)
          ? { reason: safeStationText(rawMathematicalCalibration.reason) }
          : {}),
        ...(safeStationText(rawMathematicalCalibration.profileId)
          ? { profileId: safeStationText(rawMathematicalCalibration.profileId) }
          : {}),
        ...(safeStationText(rawMathematicalCalibration.calibrationVersion)
          ? { calibrationVersion: safeStationText(rawMathematicalCalibration.calibrationVersion) }
          : {}),
        ...(safeStationText(rawMathematicalCalibration.rigId)
          ? { rigId: safeStationText(rawMathematicalCalibration.rigId) }
          : {}),
        ...(typeof rawMathematicalCalibration.artifactSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(rawMathematicalCalibration.artifactSha256)
          ? { artifactSha256: rawMathematicalCalibration.artifactSha256 }
          : {}),
      }
    : undefined;
  const rawCalibrationActivation = status.calibrationActivation;
  const calibrationActivation =
    rawCalibrationActivation &&
    ["UNAVAILABLE", "IDLE", "PENDING", "ACTIVE"].includes(rawCalibrationActivation.state)
      ? {
          configured: rawCalibrationActivation.configured === true,
          state: rawCalibrationActivation.state,
        }
      : undefined;
  const gradingContract =
    status.gradingContract === "mathematical_calibration_v1" ? "mathematical_calibration_v1"
      : status.gradingContract === "legacy_v0" ? "legacy_v0"
        : undefined;
  const mathematicalV1 = sanitizeAiGraderMathematicalV1StateForDisplay(status.mathematicalV1);
  return {
    bridgeVersion: status.bridgeVersion,
    reportProducerContractVersion: status.reportProducerContractVersion,
    stationId: status.stationId,
    mode: status.mode,
    localOnly: true,
    loginRequired: false,
    hardwareActionsEnabled: status.hardwareActionsEnabled,
    ...(gradingContract ? { gradingContract } : {}),
    ...(mathematicalCalibration ? { mathematicalCalibration } : {}),
    ...(calibrationActivation ? { calibrationActivation } : {}),
    ...(mathematicalV1 ? { mathematicalV1 } : {}),
    currentStep: status.currentStep,
    nextAction: status.nextAction,
    nextActionLabel: status.nextActionLabel,
    executionPath: "warm_full_forensic_runner",
    captureProfile,
    captureProfileGuard: {
      stationSettingRequired: false,
      selectionSource: "bridge_required",
      oneRoadProductionFastRequired: true,
      fullForensicEvidencePreserved: true,
      availableCaptureProfiles: ["production_fast"],
      fiveSecondTargetProven:
        status.executionPath === "warm_full_forensic_runner" &&
        sanitizeAiGraderCaptureTiming(status.captureTiming, captureProfile).target.fiveSecondsPerSideProven,
    },
    captureTiming: sanitizeAiGraderCaptureTiming(status.captureTiming, captureProfile),
    frontCaptureReadiness: sanitizeAiGraderFrontCaptureReadiness(status.frontCaptureReadiness),
    acceptedProfile: status.acceptedProfile,
    latestReport: status.latestReport,
    sessionManifest: status.sessionManifest,
    progressLog: status.progressLog,
    warnings: status.warnings,
    safety: status.safety,
    bridgeContract: status.bridgeContract,
    previewStatus: status.previewStatus,
    liveLighting: status.liveLighting,
    warmRunnerStatus: {
      ...status.warmRunnerStatus,
      backend: "warm_full_forensic_runner",
      executionPath: "warm_full_forensic_runner",
      safety: status.warmRunnerStatus.safety,
    } as AiGraderWarmRunnerStatus,
    ...(status.captureFailure ? { captureFailure: status.captureFailure } : {}),
    geometryCaptureDecisions: sanitizeGeometryCaptureDecisions(status.geometryCaptureDecisions),
    ...(status.reportBundle ? { reportBundle: status.reportBundle } : {}),
    ...(status.stationUrl ? { stationUrl: status.stationUrl } : {}),
    ...(status.bridgeSecurity ? { bridgeSecurity: status.bridgeSecurity } : {}),
    ...(status.outputs ? { outputs: status.outputs } : {}),
    ...(status.productionRelease ? { productionRelease: status.productionRelease } : {}),
    rapidCapture: sanitizeAiGraderRapidCaptureManifest(status.rapidCapture),
    rapidCaptureQueue: sanitizeAiGraderRapidCaptureQueue(status.rapidCaptureQueue),
    ...(status.timingSummary
      ? {
          timingSummary: {
            ...status.timingSummary,
            executionPath: "warm_full_forensic_runner",
          },
        }
      : {}),
  } as AiGraderLocalStationStatus;
}



export type AiGraderLocalStationTimingSummary = {
  totalCommandMs: number;
  executionPath: AiGraderWarmRunnerExecutionPath;
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
  adjustmentReason?: "not_detected" | "outside_frame" | "unsafe_scale" | "rotate_top_up" | "wrong_aspect" | "low_confidence";
  geometrySource: "detected" | "none";
  captureMode: "automatic_detection" | "none";
  confidenceBasis: "automatic_detection" | "none";
  detectionUsed: boolean;
  corners: AiGraderPreviewGeometryCorners | null;
  detectedCorners: AiGraderPreviewGeometryCorners | null;
  boundingBox: AiGraderPreviewGeometryBoundingBox | null;
  rotationDegrees: number | null;
  skewDegrees: number | null;
  confidence: number;
  sessionId?: string;
  sideEpoch?: string;
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
  ]).has(String(value.adjustmentReason))
    ? value.adjustmentReason as AiGraderPreviewCardGeometrySummary["adjustmentReason"]
    : undefined;
  const geometrySource =
    value.geometrySource === "detected" || value.geometrySource === "none"
      ? value.geometrySource
      : "none";
  const captureMode =
    value.captureMode === "automatic_detection" || value.captureMode === "none"
      ? value.captureMode
      : geometrySource === "detected"
        ? "automatic_detection"
        : "none";
  const confidenceBasis =
    value.confidenceBasis === "automatic_detection" || value.confidenceBasis === "none"
      ? value.confidenceBasis
      : captureMode === "automatic_detection"
        ? "automatic_detection"
        : "none";
  const corners = sanitizePreviewGeometryCorners(value.corners);
  const detectedCorners = sanitizePreviewGeometryCorners(value.detectedCorners);
  const rotationDegrees = previewGeometryNumber(value.rotationDegrees) ?? null;
  const skewDegrees = previewGeometryNumber(value.skewDegrees) ?? null;
  const confidenceValue = previewGeometryNumber(value.confidence) ?? 0;
  const sessionId = sanitizePreviewGeometrySourceFrameId(value.sessionId);
  const sideEpoch = sanitizePreviewGeometrySourceFrameId(value.sideEpoch);
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
    corners,
    detectedCorners,
    boundingBox: sanitizePreviewGeometryBoundingBox(value.boundingBox),
    rotationDegrees,
    skewDegrees,
    confidence: Math.max(0, Math.min(1, confidenceValue)),
    ...(sessionId ? { sessionId } : {}),
    ...(sideEpoch ? { sideEpoch } : {}),
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
  frameSource: "basler_pylon_continuous_grab" | "basler_pylon_single_frame" | "mock_station_preview" | "native_pylon_window";
  frameCount: number;
  sessionId?: string;
  activeSide?: AiGraderPreviewGeometrySide;
  sideEpoch?: string;
  latestFrameId?: string;
  positioningLightReady?: boolean;
  intentionalTransition: {
    active: boolean;
    kind?: "capture_front" | "capture_back";
    sessionId?: string;
    side?: AiGraderPreviewGeometrySide;
    sideEpoch?: string;
    frameId?: string;
    startedAt?: string;
    completedAt?: string;
    outcome?: "capture_started" | "transition_failed";
  };
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
    source: "browser_live_tuning" | "accepted_station_profile" | "default";
    acceptedForCapture: boolean;
    acceptedAt?: string;
    candidateProfileIdentity?: string;
  };
  applied: {
    enabled?: boolean;
    dutyPercent: number;
    actualLeimacPwmStep: number;
    channels: number[];
    appliedAt?: string;
    lastApplyLatencyMs?: number;
    lastResponseKinds?: string[];
    verificationState: "pending" | "verified" | "unknown";
    expectedWriteCount: number;
    acknowledgedWriteCount: number;
    verificationComplete: boolean;
    verifiedAt?: string;
  };
  physicalState: {
    state: "safe_off_pending" | "safe_off_verified" | "positioning_light_verified" | "unverified";
    reason: string;
    changedAt: string;
    expectedWriteCount: number;
    acknowledgedWriteCount: number;
    complete: boolean;
    verifiedAt?: string;
    lastError?: string;
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
    boundedCommands: true;
    maxDutyPercent: 99.9;
    watchdogOwnedByBridge: true;
    safeOffOnCaptureFailure: true;
    safeOffOnCancellation: true;
    safeOffOnSessionEnd: true;
    persistentLeimacSaved: false;
    arbitraryWritesAllowed: false;
  };
  safetyEvents: Array<{
    at: string;
    type: "apply" | "safe_off" | "heartbeat" | "watchdog_safe_off" | "failure_safe_off";
    reason: string;
    ok: boolean;
  }>;
  lastError?: string;
  note: string;
};

export function aiGraderAuthoritativeLiveLightingDraft(lighting: AiGraderLiveLightingStatus) {
  const expected = lighting.applied.expectedWriteCount;
  const positioningVerified =
    lighting.status === "on"
    && lighting.profile.enabled === true
    && lighting.profile.acceptedForCapture === true
    && lighting.applied.enabled === true
    && lighting.applied.verificationState === "verified"
    && lighting.applied.verificationComplete === true
    && Number.isInteger(expected)
    && expected > 0
    && lighting.applied.acknowledgedWriteCount === expected
    && lighting.applied.lastResponseKinds?.length === expected
    && lighting.applied.lastResponseKinds.every((kind) => kind === "ack" || kind === "mock")
    && lighting.physicalState.state === "positioning_light_verified"
    && lighting.physicalState.complete === true
    && lighting.physicalState.expectedWriteCount === expected
    && lighting.physicalState.acknowledgedWriteCount === expected
    && Number.isFinite(Date.parse(lighting.applied.verifiedAt ?? ""))
    && lighting.applied.verifiedAt === lighting.physicalState.verifiedAt
    && lighting.lastError === undefined
    && lighting.physicalState.lastError === undefined
    && (lighting.connection.state === "idle" || lighting.connection.state === "mock")
    && lighting.applied.dutyPercent === lighting.profile.dutyPercent
    && lighting.applied.actualLeimacPwmStep === lighting.profile.actualLeimacPwmStep
    && lighting.applied.channels.join(",") === lighting.profile.channels.join(",");
  return {
    enabled: positioningVerified,
    dutyPercent: lighting.profile.dutyPercent,
    channels: [...lighting.profile.channels],
  };
}

export function aiGraderApproveAndPublishEligible(input: {
  itemState: AiGraderRapidCaptureWorkflowState | undefined;
  reportReady: boolean;
  finalReady: boolean;
  productionSignedIn: boolean;
  identityReady: boolean;
  publishStatus: "idle" | "pending" | "published" | "disabled" | "error";
}) {
  return aiGraderRapidItemPublishable(input.itemState)
    && input.reportReady
    && input.finalReady
    && input.productionSignedIn
    && input.identityReady
    && input.publishStatus !== "published"
    && input.publishStatus !== "pending";
}

export function aiGraderStartNewCardAvailable(input: {
  bridgeConnected: boolean;
  captureBusy: boolean;
  lightingRequestPending: boolean;
  captureLockHeld: boolean;
  warmRunnerStatus: AiGraderWarmRunnerStatusName;
  currentStep: AiGraderStationStepId;
}) {
  return input.bridgeConnected &&
    !input.captureBusy &&
    !input.lightingRequestPending &&
    !input.captureLockHeld &&
    input.warmRunnerStatus !== "capturing" &&
    input.currentStep === "start_new_card";
}

export function selectNextSerializedAiGraderOcrItem(items: AiGraderRapidCaptureQueueItem[]) {
  if (items.some((item) => item.ocr.state === "in_flight")) return undefined;
  return items
    .filter((item) => item.ocr.state === "eligible")
    .sort((left, right) =>
      Date.parse(left.queuedAt) - Date.parse(right.queuedAt) || left.queueItemId.localeCompare(right.queueItemId)
    )[0];
}

export function aiGraderAtomicBackQueueReleaseMatches(input: {
  status: AiGraderLocalStationStatus;
  gradingSessionId: string;
  reportId: string;
}) {
  return input.status.currentStep === "start_new_card" &&
    input.status.sessionManifest.frontCaptured === false &&
    input.status.sessionManifest.backCaptured === false &&
    input.status.rapidCaptureQueue.items.some((item) =>
      item.sessionId === input.gradingSessionId && item.reportId === input.reportId);
}

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
  { id: "capture_front", label: "Capture Front", operatorAction: "Capture front fixed-rig evidence.", primaryAction: "capture-front", hardwareCapable: true },
  { id: "capture_back", label: "Capture Back", operatorAction: "Capture back fixed-rig evidence.", primaryAction: "capture-back", hardwareCapable: true },
  { id: "finalize_publish_report", label: "Approve & Publish", operatorAction: "Approve and atomically publish the report, card, label, and durable linkage. Add To Inventory remains a downstream Finish action.", primaryAction: "publish-report", hardwareCapable: false },
];

const ACTION_TO_STEP: Record<AiGraderStationAction, AiGraderStationStepId> = {
  status: "start_new_card",
  "start-session": "live_preview_focus_framing",
  "observe-calibration-activation": "start_new_card",
  "prepare-calibration-activation": "start_new_card",
  "ingest-finalized-calibration-bundle": "start_new_card",
  "confirm-calibration-activation": "start_new_card",
  "abort-calibration-activation": "start_new_card",
  "capture-front": "prompt_flip_card",
  "capture-back": "run_provisional_diagnostics",
  "publish-report": "finalize_publish_report",
  "cancel-session": "session_complete",
  "latest-report": "view_unified_report",
  "session-manifest": "view_unified_report",
  "activate-queue-item": "view_unified_report",
  "bind-mathematical-grading-authority": "capture_front",
  "submit-mathematical-finding-reviews": "view_unified_report",
  "begin-queued-ocr": "start_new_card",
  "complete-queued-ocr": "start_new_card",
  "fail-queued-ocr": "start_new_card",
};

const NEXT_ACTION_BY_STEP: Record<AiGraderStationStepId, AiGraderStationAction> = {
  start_new_card: "start-session",
  live_preview_focus_framing: "capture-front",
  lighting_exposure_tune: "capture-front",
  capture_front: "capture-front",
  prompt_flip_card: "capture-back",
  capture_back: "capture-back",
  run_provisional_diagnostics: "status",
  view_unified_report: "status",
  calculate_final_grade: "publish-report",
  finalize_publish_report: "status",
  label_data_ready: "latest-report",
  session_complete: "latest-report",
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
    action: AiGraderStationAction | "preview-status" | "preview-stream" | "lighting-status" | "lighting-apply" | "lighting-heartbeat";
    description: string;
    path?: string;
  }> = [
    { method: "GET", action: "status", description: "Read current local station status." },
    { method: "GET", action: "preview-status", path: "/preview/status", description: "Read embedded browser preview status." },
    { method: "GET", action: "preview-stream", path: "/preview/stream", description: "Open local token-gated embedded preview stream." },
    { method: "GET", action: "lighting-status", path: "/lighting/status", description: "Read browser live Leimac lighting status." },
    { method: "POST", action: "lighting-apply", path: "/lighting/apply", description: "Apply bounded allowlisted Leimac lighting with exact acknowledgement validation." },
    { method: "POST", action: "lighting-heartbeat", path: "/lighting/heartbeat", description: "Refresh browser live lighting watchdog." },
    { method: "POST", action: "start-session", description: "Start a local station session in mock/contract mode." },
    { method: "POST", action: "capture-front", description: "Validate the exact front frame and acknowledged lighting, serialize camera ownership, and capture front evidence." },
    { method: "POST", action: "capture-back", description: "Validate the exact back frame and acknowledged lighting, serialize camera ownership, and capture back evidence." },
    { method: "POST", action: "publish-report", description: "Prepare local publication manifest and public URL data." },
    { method: "POST", action: "cancel-session", description: "Cancel a local station session with safe-off cleanup." },
    { method: "POST", action: "activate-queue-item", description: "Select one exact completed queued report for review without taking capture ownership." },
    { method: "POST", action: "bind-mathematical-grading-authority", description: "Bind exact Mathematical V1 card and centering authority before capture." },
    { method: "POST", action: "submit-mathematical-finding-reviews", description: "Submit one exact SHA-bound disposition for every measured finding." },
    { method: "POST", action: "begin-queued-ocr", description: "Atomically claim one exact eligible queued OCR lifecycle." },
    { method: "POST", action: "complete-queued-ocr", description: "Persist one safe OCR result for the exact claimed queue identity." },
    { method: "POST", action: "fail-queued-ocr", description: "Persist one explicit terminal OCR failure for the exact claimed queue identity." },
    { method: "GET", action: "latest-report", description: "Read latest report location." },
    { method: "GET", action: "session-manifest", description: "Read station session manifest." },
  ];
  return actions.map((endpoint) => ({
    ...endpoint,
    path: endpoint.path ??
      (endpoint.action === "status"
        ? "/status"
        : endpoint.action === "latest-report"
          ? "/latest-report"
          : endpoint.action === "session-manifest"
            ? "/session-manifest"
            : `/actions/${endpoint.action}`),
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
    safety: {
      captureLock: true,
      watchdogSafeOff: true,
      safeOffOnFailure: true,
      safeOffOnCancellation: true,
      safeOffOnSessionEnd: true,
      publicRouteExposed: false,
      productionServiceTokenUsed: false,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
    },
    note:
      "The one production_fast path preserves immutable measurement evidence. The local Dell bridge owns capture, lock, queue, timing, and clean release state.",
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
    intentionalTransition: { active: false },
    cardGeometry: {
      activeSide: "front",
      front: {
        side: "front",
        placementState: "not_detected",
        geometrySource: "none",
        captureMode: "none",
        confidenceBasis: "none",
        detectionUsed: false,
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
    status: "unavailable",
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
      dutyPercent: 0,
      actualLeimacPwmStep: 0,
      channels: [],
      verificationState: "unknown",
      expectedWriteCount: 0,
      acknowledgedWriteCount: 0,
      verificationComplete: false,
    },
    physicalState: {
      state: "unverified",
      reason: "Contract preview has no controller acknowledgement for physical light state.",
      changedAt: new Date(0).toISOString(),
      expectedWriteCount: 0,
      acknowledgedWriteCount: 0,
      complete: false,
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
      boundedCommands: true,
      maxDutyPercent: 99.9,
      watchdogOwnedByBridge: true,
      safeOffOnCaptureFailure: true,
      safeOffOnCancellation: true,
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
} = {}): AiGraderLocalStationStatus {
  const action = input.action ?? "status";
  const captureProfile: AiGraderCaptureProfile = "production_fast";
  const currentStep = ACTION_TO_STEP[action] ?? "start_new_card";
  const nextAction = NEXT_ACTION_BY_STEP[currentStep];
  const reportBundle = SAMPLE_AI_GRADER_REPORT_BUNDLE;
  const frontCaptured = ["prompt_flip_card", "capture_back", "run_provisional_diagnostics", "view_unified_report", "calculate_final_grade", "finalize_publish_report", "label_data_ready", "session_complete"].includes(currentStep);
  const backCaptured = ["run_provisional_diagnostics", "view_unified_report", "calculate_final_grade", "finalize_publish_report", "label_data_ready", "session_complete"].includes(currentStep);
  const diagnosticsRun = ["view_unified_report", "calculate_final_grade", "finalize_publish_report", "label_data_ready", "session_complete"].includes(currentStep);
  const finalComputed = ["calculate_final_grade", "finalize_publish_report", "label_data_ready"].includes(currentStep);
  const labelReady = currentStep === "label_data_ready";

  return {
    bridgeVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
    reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
    stationId: "local-dell-ai-grader-station",
    mode: input.mode ?? "mock_dev",
    localOnly: true,
    loginRequired: false,
    hardwareActionsEnabled: false,
    mathematicalCalibration: {
      ready: false,
      reason: "Contract preview has no finalized physical calibration profile. Connect the Dell bridge to evaluate Mathematical V1 readiness.",
    },
    currentStep,
    nextAction,
    nextActionLabel: actionLabel(nextAction),
    executionPath: "warm_full_forensic_runner",
    captureProfile,
    captureProfileGuard: {
      stationSettingRequired: false,
      selectionSource: "bridge_required",
      oneRoadProductionFastRequired: true,
      fullForensicEvidencePreserved: true,
      availableCaptureProfiles: ["production_fast"],
      fiveSecondTargetProven: false,
    },
    captureTiming: buildDefaultAiGraderCaptureTiming(captureProfile),
    frontCaptureReadiness: {
      ready: false,
      code: 'session_required',
      message: 'Start a bridge-authoritative grading session before Front capture.',
    },
    acceptedProfile: {
      dutyPercent: 1.3,
      exposureUs: 45000,
      gain: 0,
      channels: [1, 2, 3, 4, 5, 6, 7, 8],
      source: "mock",
      actualLeimacPwmStep: 13,
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
        "Stream bounded command progress back to the page.",
      ],
    },
    previewStatus: defaultPreviewStatus(),
    liveLighting: defaultLiveLightingStatus(),
    warmRunnerStatus: defaultWarmRunnerStatus(),
    geometryCaptureDecisions: {},
    rapidCapture: {
      enabled: true,
      workflowHistory: [],
      humanConfirmationRequired: true,
      autoConfirm: false,
      autoPublish: false,
    },
    rapidCaptureQueue: {
      enabled: true,
      persisted: true,
      reportWorkerSerialized: true,
      items: [],
    },
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
    "capture-front",
    "capture-back",
    "publish-report",
    "cancel-session",
    "latest-report",
    "session-manifest",
    "activate-queue-item",
    "bind-mathematical-grading-authority",
    "submit-mathematical-finding-reviews",
    "begin-queued-ocr",
    "complete-queued-ocr",
    "fail-queued-ocr",
  ];
  return allowed.includes(raw as AiGraderStationAction) ? (raw as AiGraderStationAction) : null;
}
