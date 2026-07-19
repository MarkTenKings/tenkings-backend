import crypto from "node:crypto";
import { spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import {
  assertFixedRigOutputDirAllowed,
  buildFixedRigActiveLightingProfile,
  captureFixedRigWarmSideBatch,
  createFixedRigPackageDir,
  FIXED_RIG_SELECTED_EXPOSURE_US,
  FIXED_RIG_SELECTED_GAIN,
  FIXED_RIG_SELECTED_LEIMAC_DUTY,
  type FixedRigActiveLightingProfile,
  type FixedRigCardSide,
  type FixedRigCaptureProfile,
  type FixedRigReferenceType,
  type FixedRigWarmEvidencePackageInput,
  type FixedRigWarmEvidencePackageResult,
  type FixedRigWarmSideCaptureBatch,
} from "./baslerFixedRigV1";
import {
  createFixedRigWarmForensicProcessingRunner,
  type FixedRigWarmProcessingResult,
} from "./fixedRigProcessingWorker";
import { FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION } from "./fixedRigProcessingWorkerProtocol";
import {
  buildLeimacIdmuSafeOffFrames,
  composeLeimacIdmuExplicitChannelWriteFrame,
  leimacIdmuDutyPercentToSteps,
  LEIMAC_IDMU_MAX_DUTY_PERCENT,
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
import {
  BaslerPylonClient,
  defaultBaslerPylonBridgeScriptPath,
  type BaslerCaptureStillResult,
} from "./baslerPylonClient";
import {
  AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
  buildAiGraderReportBundle,
  writeAiGraderReportBundle,
  type AiGraderReportBundle,
  type AiGraderReportBundleAsset,
} from "./aiGraderReportBundle";
import {
  AI_GRADER_REPORT_RECOVERY_GUIDANCE,
  aiGraderReportBundleNeedsRecovery,
  readAiGraderReportPackageReleaseEvidence,
  reconcileAiGraderReportPackageTransaction,
  recoverAiGraderReportPackage,
  withAiGraderReportPackageOperation,
  type RecoverAiGraderReportPackageResult,
} from "./aiGraderReportPackageRecovery";
import {
  writeAiGraderProductionRelease,
  type AiGraderProductionRelease,
} from "./aiGraderProductionRelease";
import {
  AI_GRADER_MATHEMATICAL_PRODUCTION_RELEASE_V1_VERSION,
  AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_V1_VERSION,
  AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_DIR,
  AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_V1_VERSION,
  buildAiGraderMathematicalReportEnvelopeV1,
  decodeAiGraderMathematicalAssetPayloadsV1,
  readAiGraderMathematicalReportAssetV1,
  readAiGraderMathematicalReportPackageV1,
  writeAiGraderMathematicalProductionReleaseV1,
  writeAiGraderMathematicalReportPackageV1,
  type AiGraderMathematicalAssetPayloadTransportV1,
  type AiGraderMathematicalProductionReleaseV1,
  type AiGraderMathematicalReportEnvelopeV1,
  type AiGraderMathematicalReportPackageV1,
} from "./aiGraderMathematicalReportPackageV1";
import {
  AI_GRADER_MATHEMATICAL_REPORT_ADAPTER_V1_VERSION,
  type AiGraderMathematicalReportBundleV1Artifact,
} from "./aiGraderMathematicalReportBundleV1";
import {
  type AiGraderReportBundleV03,
} from "@tenkings/shared";
import {
  detectCardGeometryFromBuffer,
  type CardGeometryMetadata,
  type CardGeometrySide,
  type CardPlacementState,
} from "./cardGeometry";
import {
  cloneAiGraderCaptureTiming,
  createAiGraderCaptureTimingMetadata,
  recordAiGraderCaptureTimingEvent,
  recordAiGraderCaptureTimingPhase,
  type AiGraderCaptureTimingMetadata,
  type AiGraderCaptureTriggerMode,
} from "./aiGraderCaptureTiming";
import {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
  FixedRigMathematicalCalibrationCaptureProducerV1,
  type CaptureFixedRigMathematicalCalibrationStepV1Request,
  type FixedRigMathematicalCalibrationCaptureBoundaryRequestV1,
  type FixedRigMathematicalCalibrationCaptureBoundaryResultV1,
  type RecordFixedRigMathematicalCalibrationMeasurementV1Request,
  type SealFixedRigMathematicalCalibrationCaptureV1Request,
  type SealedFixedRigMathematicalCalibrationCaptureV1,
  type StartFixedRigMathematicalCalibrationCaptureV1Request,
  type FixedRigMathematicalCalibrationCaptureSessionStatusV1,
} from "./fixedRigMathematicalCalibrationCaptureV1";
import { loadFixedRigMathematicalCalibrationBundleV1 } from "./fixedRigMathematicalCalibrationBundleV1";
import {
  FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION,
  buildFixedRigMathematicalCalibrationStationPackageV1,
  type BuildFixedRigMathematicalCalibrationStationPackageV1Result,
  type FixedRigMathematicalStationGradingAuthorityV1,
} from "./fixedRigMathematicalStationAdapterV1";
import type {
  FixedRigMathematicalFindingReviewAssetMetadataV1,
  FixedRigMathematicalFindingReviewAssetV1,
  FixedRigMathematicalFindingReviewRequestV1,
  FixedRigMathematicalFindingReviewV1,
} from "./fixedRigMathematicalCalibrationOrchestratorV1";

export const AI_GRADER_LOCAL_STATION_BRIDGE_VERSION = "ai-grader-local-station-bridge-v0.9";
export const DEFAULT_AI_GRADER_LOCAL_STATION_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_AI_GRADER_LOCAL_STATION_BRIDGE_PORT = 47652;
const PREVIEW_RELEASE_TIMEOUT_MS = 5000;
const PREVIEW_CAMERA_SETTLE_MS = 350;
const LIVE_LIGHTING_WATCHDOG_MS = 15000;
const BACK_POSITIONING_FIRST_FRAME_GRACE_MS = 6000;
const BACK_POSITIONING_LIVE_FRAME_MAX_AGE_MS = 2000;
const BACK_POSITIONING_EVENT_LIMIT = 20;
const BACK_POSITIONING_ERROR_MAX_LENGTH = 240;
const ATOMIC_CAPTURE_AUTHORIZATION_MS = 10000;
const PREVIEW_OBSERVATION_LIMIT = 8;
const ATOMIC_CAPTURE_IDEMPOTENCY_LIMIT = 64;
const ATOMIC_CAPTURE_IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const ATOMIC_CAPTURE_ASSERTION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ATOMIC_CAPTURE_PRIVATE_ASSERTION_RE = /(?:token|secret|bearer|authorization|presign|x-amz|localhost|(?:\d{1,3}\.){3}\d{1,3})/i;
// The Basler preview runs at roughly 4-5 fps on the Dell. Geometry analysis is
// latest-frame-only, so a 125 ms cadence can inspect every delivered frame
// without building a queue while avoiding the former fixed half-second lag.
const PREVIEW_GEOMETRY_THROTTLE_MS = 125;
const PREVIEW_GEOMETRY_MAX_AGE_MS = 2000;
const CAPTURE_TRIGGER_MAX_ACTION_DELAY_MS = 10_000;
const PREVIEW_JPEG_BUFFER_LIMIT_BYTES = 12 * 1024 * 1024;
const PREVIEW_MJPEG_HEADER_BUFFER_LIMIT_BYTES = 8 * 1024;
const MATHEMATICAL_DESIGN_REFERENCE_MAX_BYTES = 64 * 1024 * 1024;
const MATHEMATICAL_REVIEW_ASSET_MAX_BYTES = 64 * 1024 * 1024;
const MATHEMATICAL_REVIEW_ASSET_TOTAL_MAX_BYTES = 512 * 1024 * 1024;
const SHA256_LOWERCASE_RE = /^[a-f0-9]{64}$/;

export type AiGraderLocalStationBridgeMode = "mock" | "real";

export type AiGraderGradingContract = "legacy_v0" | "mathematical_calibration_v1";
export type AiGraderStationReportBundle = AiGraderReportBundle | AiGraderReportBundleV03;
export type AiGraderStationProductionRelease = AiGraderProductionRelease | AiGraderMathematicalProductionReleaseV1;

type RegisteredMathematicalCenteringAuthority = Extract<
  FixedRigMathematicalStationGradingAuthorityV1["sides"]["front"]["centering"],
  { profile: "registered_design_template_v1" }
>;

export type AiGraderLocalStationMathematicalCenteringAuthorityV1 =
  | { profile: "printed_border_v1" }
  | {
      profile: "registered_design_template_v1";
      approvedReference: RegisteredMathematicalCenteringAuthority["approvedReference"];
      approvedDesignArtifact: Omit<RegisteredMathematicalCenteringAuthority["approvedDesignArtifact"], "filePath">;
    };

export interface AiGraderLocalStationMathematicalGradingAuthorityV1 {
  schemaVersion: typeof FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION;
  cardIdentity: FixedRigMathematicalStationGradingAuthorityV1["cardIdentity"];
  cardFormatId: FixedRigMathematicalStationGradingAuthorityV1["cardFormatId"];
  sides: {
    front: { centering: AiGraderLocalStationMathematicalCenteringAuthorityV1 };
    back: { centering: AiGraderLocalStationMathematicalCenteringAuthorityV1 };
  };
}

export interface AiGraderLocalStationStagedDesignReferenceV1 {
  side: "front" | "back";
  referenceId: string;
  assetId: string;
  fileName: string;
  contentType: "image/png" | "image/jpeg";
  sha256: string;
  byteSize: number;
  filePath: string;
  stagedAt: string;
}

export interface AiGraderLocalStationMathematicalReviewAssetV1 {
  assetId: string;
  side: "front" | "back";
  evidenceRole: FixedRigMathematicalFindingReviewAssetMetadataV1["evidenceRole"];
  fileName: string;
  contentType: "image/png" | "image/jpeg" | "image/tiff";
  sha256: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
  filePath: string;
}

type MathematicalCompletedResultV1 = Extract<
  BuildFixedRigMathematicalCalibrationStationPackageV1Result,
  { status: "completed" }
>;
type MathematicalInsufficientResultV1 = Extract<
  BuildFixedRigMathematicalCalibrationStationPackageV1Result,
  { status: "insufficient_evidence" }
>;

export type AiGraderLocalStationMathematicalExecutionV1 =
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
      reviewRequest: FixedRigMathematicalFindingReviewRequestV1;
      reviewIssues: string[];
    }
  | {
      status: "completed";
      completedAt: string;
      attempt: number;
      v0FallbackUsed: false;
      reportPackagePath: string;
      reportBundlePath: string;
      orchestrationTraceSha256: string;
      grade: MathematicalCompletedResultV1["grade"];
      summary: MathematicalCompletedResultV1["summary"];
    }
  | {
      status: "insufficient_evidence";
      completedAt: string;
      attempt: number;
      v0FallbackUsed: false;
      failedStage: MathematicalInsufficientResultV1["failedStage"];
      reasons: string[];
      requiresRecapture: boolean;
      requiresApprovedDesignReference: boolean;
      requiresCalibration: boolean;
      requiresImplementationCorrection: boolean;
    };

export interface AiGraderLocalStationMathematicalV1State {
  schemaVersion: "ten-kings-ai-grader-local-station-mathematical-v1-state-v1";
  generatedAt: string;
  gradingAuthority: AiGraderLocalStationMathematicalGradingAuthorityV1;
  stagedDesignReferences: Partial<Record<"front" | "back", AiGraderLocalStationStagedDesignReferenceV1>>;
  reviewAssets?: Record<string, AiGraderLocalStationMathematicalReviewAssetV1>;
  submittedFindingReviews?: FixedRigMathematicalFindingReviewV1[];
  execution?: AiGraderLocalStationMathematicalExecutionV1;
}

export type AiGraderLocalStationBridgeAction =
  | "status"
  | "start-session"
  | "capture-front"
  | "capture-back"
  | "run-diagnostics"
  | "export-report-bundle"
  | "calculate-final-grade"
  | "finalize-report"
  | "publish-report"
  | "generate-label-data"
  | "cancel-session"
  | "latest-report"
  | "session-manifest"
  | "configure-rapid-capture"
  | "queue-current-card"
  | "activate-queue-item"
  | "bind-mathematical-grading-authority"
  | "submit-mathematical-finding-reviews";

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

export interface AiGraderRapidCaptureWorkflowEvent {
  state: AiGraderRapidCaptureWorkflowState;
  at: string;
  detail: string;
}

export interface AiGraderRapidCaptureQueueItem {
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
    status: AiGraderLocalStationMathematicalExecutionV1["status"];
    reviewRequestSha256?: string;
    failedStage?: MathematicalInsufficientResultV1["failedStage"];
    reasons?: string[];
    requiresRecapture?: boolean;
    requiresApprovedDesignReference?: boolean;
    requiresCalibration?: boolean;
    requiresImplementationCorrection?: boolean;
  };
  error?: string;
}

interface PersistedAiGraderRapidCaptureQueueItem extends AiGraderRapidCaptureQueueItem {
  manifestPath: string;
}

interface PersistedAiGraderRapidCaptureQueue {
  schemaVersion: "ten-kings-ai-grader-rapid-capture-queue-v1";
  updatedAt: string;
  rapidCaptureEnabled: boolean;
  items: PersistedAiGraderRapidCaptureQueueItem[];
}

export type AiGraderLocalStationStepId =
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

export interface AiGraderLocalStationAcceptedProfile {
  dutyPercent: number;
  exposureUs: number;
  gain: number;
  channels: number[];
  source: "operator_preview" | "browser_live_tuning" | "default" | "cli_override" | "bridge_operator";
  actualLeimacPwmStep: number;
  acceptedAt?: string;
}

export interface AiGraderFrontCaptureBinding {
  sessionId: string;
  reportId: string;
  side: 'front';
  sideEpoch: string;
}

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

export interface AiGraderFrontCaptureReadiness {
  ready: boolean;
  code: AiGraderFrontCaptureReadinessCode;
  message: string;
  binding?: AiGraderFrontCaptureBinding;
  profileIdentity?: string;
}

export type AiGraderWarmRunnerSide = "front" | "back";
export type AiGraderGeometryCaptureMode = "detected_geometry";
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
  captureProfile?: FixedRigCaptureProfile;
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
  mathematicalCalibrationOutputDir?: string;
  mathematicalCalibrationTargetPath?: string;
  mathematicalCalibrationTargetVersion?: string;
  mathematicalCalibrationTargetSha256?: string;
  mathematicalCalibrationRigId?: string;
  mathematicalCalibrationProfilePath?: string;
  mathematicalCalibrationProfileSha256?: string;
  mathematicalCalibrationBundlePath?: string;
  mathematicalCalibrationBundleSha256?: string;
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
  captureProfile: FixedRigCaptureProfile;
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
  mathematicalCalibrationOutputDir: string;
  mathematicalCalibrationTargetPath?: string;
  mathematicalCalibrationTargetVersion?: string;
  mathematicalCalibrationTargetSha256?: string;
  mathematicalCalibrationRigId: string;
  mathematicalCalibrationProfilePath?: string;
  mathematicalCalibrationProfileSha256?: string;
  mathematicalCalibrationBundlePath?: string;
  mathematicalCalibrationBundleSha256?: string;
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
  gradingContract?: AiGraderGradingContract;
  mathematicalV1?: AiGraderLocalStationMathematicalV1State;
  captureProfile: FixedRigCaptureProfile;
  captureProfileGuard: {
    stationSettingRequired: true;
    selectionSource: "bridge_default" | "operator_setting" | "rapid_continuation";
    productionFastOptIn: boolean;
    fullForensicEvidencePreserved: true;
    availableCaptureProfiles: ["full_forensic", "production_fast"];
    previousStableProfile: "full_forensic";
    fiveSecondTargetProven: boolean;
  };
  executionPath: AiGraderWarmRunnerExecutionPath;
  outputs: {
    sessionDir?: string;
    manifestPath?: string;
    previewPackageDir?: string;
    frontPackageDir?: string;
    backPackageDir?: string;
    unifiedReportDir?: string;
    unifiedReportPath?: string;
    reportBundlePath?: string;
    publishPackageDir?: string;
    assetManifestPath?: string;
    checksumsPath?: string;
    productionReleasePath?: string;
    labelDataPath?: string;
    publicationManifestPath?: string;
    integrationContractPath?: string;
    mathematicalReportBundlePath?: string;
    mathematicalReportEnvelopePath?: string;
    mathematicalReleaseChecksumsPath?: string;
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
  reportBundle?: AiGraderStationReportBundle;
  productionRelease?: AiGraderStationProductionRelease;
  captureTiming: AiGraderCaptureTimingMetadata;
  captureTimingHardwareEvidence: Record<AiGraderWarmRunnerSide, {
    captureBatch: boolean;
    processedManifest: boolean;
  }>;
  captureFailure?: {
    side: AiGraderWarmRunnerSide;
    stage: "warm_capture" | "warm_processing";
    message: string;
    at: string;
  };
  geometryCaptureDecisions: Partial<Record<AiGraderWarmRunnerSide, {
    mode: AiGraderGeometryCaptureMode;
    placementState: CardPlacementState;
    timestamp: string;
    explicitOperatorAction: boolean;
    detectionUsed: boolean;
    manualOverrideUsed: boolean;
    sourceFrameId?: string;
  }>>;
  rapidCapture: {
    enabled: boolean;
    queueItemId?: string;
    workflowState?: AiGraderRapidCaptureWorkflowState;
    workflowHistory: AiGraderRapidCaptureWorkflowEvent[];
    safelyQueuedAt?: string;
    humanConfirmationRequired: true;
    autoConfirm: false;
    autoPublish: false;
  };
}

export interface AiGraderLocalStationBridgeStatus extends AiGraderLocalStationBridgeManifest {
  ok: true;
  bridgeVersion: typeof AI_GRADER_LOCAL_STATION_BRIDGE_VERSION;
  reportProducerContractVersion: typeof AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION;
  localOnly: true;
  loginRequired: false;
  hardwareActionsEnabled: boolean;
  mathematicalCalibration?: {
    ready: boolean;
    reason?: string;
    profileId?: string;
    calibrationVersion?: string;
    rigId?: string;
    artifactSha256?: string;
    bundleSha256?: string;
  };
  frontCaptureReadiness: AiGraderFrontCaptureReadiness;
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
  bridgeContract: {
    gradingContracts: ["legacy_v0", "mathematical_calibration_v1"];
    mathematicalV1: {
      reportBundleSchemaVersion: "ai-grader-report-bundle-v0.3";
      envelopeVersion: typeof AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_V1_VERSION;
      packageVersion: typeof AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_V1_VERSION;
      productionReleaseVersion: typeof AI_GRADER_MATHEMATICAL_PRODUCTION_RELEASE_V1_VERSION;
      gradingSessionIdentity: "external_envelope";
      packageIntegrity: "atomic_non_overwriting_sha256";
      fallbackPolicy: "explicit_not_ready_no_v0_or_manual_fallback";
    };
    endpoints: Array<{
      method: "GET" | "POST";
      path: string;
      action: AiGraderLocalStationBridgeAction | "preview-status" | "preview-stream" | "lighting-status" | "lighting-apply" | "lighting-heartbeat"
        | "mathematical-calibration-start" | "mathematical-calibration-status" | "mathematical-calibration-capture"
        | "mathematical-calibration-measurement" | "mathematical-calibration-seal"
        | "mathematical-design-reference-stage" | "mathematical-review-asset";
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
  rapidCaptureQueue: {
    enabled: boolean;
    activeQueueItemId?: string;
    persisted: true;
    reportWorkerSerialized: true;
    items: AiGraderRapidCaptureQueueItem[];
  };
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
  sessionId?: string;
  activeSide: CardGeometrySide;
  sideEpoch: string;
  latestFrameId?: string;
  positioningLightReady: boolean;
  fps?: number;
  startedAt?: string;
  firstFrameAt?: string;
  lastFrameAt?: string;
  lastError?: string;
  lastStopReason?: string;
  intentionalTransition: {
    active: boolean;
    kind?: "capture_front" | "capture_back";
    sessionId?: string;
    side?: CardGeometrySide;
    sideEpoch?: string;
    frameId?: string;
    startedAt?: string;
    completedAt?: string;
    outcome?: "capture_started" | "transition_failed";
  };
  cardGeometry: {
    activeSide: CardGeometrySide;
    sessionId?: string;
    sideEpoch: string;
    front?: CardGeometryMetadata & { sessionId: string; sideEpoch: string };
    back?: CardGeometryMetadata & { sessionId: string; sideEpoch: string };
    analysis: {
      source: "real_mjpeg_jpeg" | "mock_deterministic";
      throttleMs: number;
      inFlight: boolean;
      latestFramePending: boolean;
      framesAnalyzed: number;
      framesDroppedAsStale: number;
      lastDurationMs?: number;
      lastFrameCapturedAt?: string;
      lastFrameTimestampSource?: "preview_capture_header" | "bridge_received";
      lastStartedAt?: string;
      lastCompletedAt?: string;
      lastError?: string;
    };
    explicitManualOverlayAvailable: true;
    previewFramesPersisted: false;
  };
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

type AiGraderPreviewGeometryStatus = AiGraderLocalStationPreviewStatus["cardGeometry"];

export interface AiGraderLiveLightingProfile {
  enabled: boolean;
  dutyPercent: number;
  actualLeimacPwmStep: number;
  channels: number[];
  source: "browser_live_tuning" | "accepted_station_profile" | "default";
  acceptedForCapture: boolean;
  acceptedAt?: string;
  candidateProfileIdentity?: string;
}

export interface AiGraderLiveLightingSafetyEvent {
  at: string;
  type: "apply" | "safe_off" | "accept" | "heartbeat" | "watchdog_safe_off" | "capture_start_safe_off" | "failure_safe_off";
  reason: string;
  ok: boolean;
}

interface AiGraderPreviewObservation {
  sessionId: string;
  side: CardGeometrySide;
  sideEpoch: string;
  frameId: string;
  capturedAt: string;
  receivedAt: string;
  geometry?: CardGeometryMetadata & { sessionId: string; sideEpoch: string };
}

interface AiGraderBackCaptureSnapshot {
  sessionId: string;
  reportId: string;
  side: "back";
  sideEpoch: string;
  frameId: string;
  captureMode: AiGraderGeometryCaptureMode;
  captureTriggerMode: AiGraderCaptureTriggerMode;
  capturedAt: string;
  receivedAt: string;
  geometry: CardGeometryMetadata & { sessionId: string; sideEpoch: string };
  geometrySha256: string;
  snapshottedAt: string;
}

interface AiGraderFrontCaptureSnapshot {
  sessionId: string;
  reportId: string;
  side: "front";
  sideEpoch: string;
  frameId: string;
  captureMode: AiGraderGeometryCaptureMode;
  captureTriggerMode: AiGraderCaptureTriggerMode;
  capturedAt: string;
  receivedAt: string;
  geometry: CardGeometryMetadata & { sessionId: string; sideEpoch: string };
  geometrySha256: string;
  acceptedProfileIdentity: string;
  snapshottedAt: string;
}

interface AiGraderBackCaptureOperation {
  fingerprint: string;
  promise: Promise<AiGraderLocalStationBridgeStatus>;
  result?: AiGraderLocalStationBridgeStatus;
  consumed: boolean;
}

type AiGraderFrontCaptureOperation = AiGraderBackCaptureOperation;

export interface AiGraderBackPositioningLightEvent {
  at: string;
  type: "restore_starting" | "restore_success" | "restore_failure" | "fresh_frame_ready" | "safe_off";
  trigger: "front_capture" | "preview_frame" | "safety";
  profileIdentity?: string;
  error?: {
    code: "AI_GRADER_BACK_POSITIONING_RESTORE_FAILED" | "AI_GRADER_BACK_PREVIEW_FRAME_REQUIRED";
    message: string;
  };
}

export interface AiGraderBackPositioningLightStatus {
  status: "inactive" | "restoring" | "waiting_for_frame" | "ready" | "failed" | "safe_off";
  captureReady: boolean;
  sessionId?: string;
  side: "back";
  sideEpoch: string;
  profileIdentity?: string;
  dutyPercent?: number;
  actualLeimacPwmStep?: number;
  channels?: number[];
  attemptCount: number;
  firstFrameGraceMs: number;
  firstFrameGraceExpiresAt?: string;
  lastAttempt?: "front_capture";
  lastError?: {
    code: "AI_GRADER_BACK_POSITIONING_RESTORE_FAILED" | "AI_GRADER_BACK_PREVIEW_FRAME_REQUIRED";
    message: string;
  };
  captureAuthorization?: {
    sessionId: string;
    sideEpoch: string;
    frameId: string;
    profileIdentity: string;
    authorizedAt: string;
    expiresAt: string;
  };
  events: AiGraderBackPositioningLightEvent[];
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
    enabled?: boolean;
    dutyPercent: number;
    actualLeimacPwmStep: number;
    channels: number[];
    appliedAt?: string;
    lastApplyLatencyMs?: number;
    lastResponseKinds?: Array<LeimacIdmuWriteResult["responseKind"] | "mock">;
    verificationState: "pending" | "verified" | "unknown";
    expectedWriteCount: number;
    acknowledgedWriteCount: number;
    verificationComplete: boolean;
    verifiedAt?: string;
  };
  physicalState: {
    state: "unverified" | "safe_off_pending" | "safe_off_verified" | "positioning_light_verified";
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
    lowDutyCapEnforced: false;
    maxDutyPercent: number;
    safeOffOnAllOff: true;
    safeOffOnDisconnect: true;
    safeOffOnTimeout: true;
    safeOffOnCaptureStart: false;
    safeOffOnCaptureFailure: true;
    safeOffOnSessionEnd: true;
    persistentLeimacSaved: false;
    arbitraryWritesAllowed: false;
  };
  safetyEvents: AiGraderLiveLightingSafetyEvent[];
  backPositioning: AiGraderBackPositioningLightStatus;
  lastError?: string;
  note: string;
}

type AiGraderLiveLightingStatusUpdate = Omit<Partial<AiGraderLiveLightingStatus>,
  "profile" | "applied" | "physicalState" | "watchdog" | "connection" | "safety" | "backPositioning"
> & {
  profile?: Partial<AiGraderLiveLightingStatus["profile"]>;
  applied?: Partial<AiGraderLiveLightingStatus["applied"]>;
  physicalState?: Partial<AiGraderLiveLightingStatus["physicalState"]>;
  watchdog?: Partial<AiGraderLiveLightingStatus["watchdog"]>;
  connection?: Partial<AiGraderLiveLightingStatus["connection"]>;
  safety?: Partial<AiGraderLiveLightingStatus["safety"]>;
  backPositioning?: Partial<AiGraderLiveLightingStatus["backPositioning"]>;
};

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
  reportId?: string;
  operatorId?: string;
  warningsAccepted?: boolean;
  overrideReason?: string;
  captureProfile?: FixedRigCaptureProfile;
  gradingContract?: AiGraderGradingContract;
  mathematicalGradingAuthority?: AiGraderLocalStationMathematicalGradingAuthorityV1;
  mathematicalReviewRequestSha256?: string;
  mathematicalFindingReviews?: FixedRigMathematicalFindingReviewV1[];
  mathematicalReportEnvelope?: AiGraderMathematicalReportEnvelopeV1;
  mathematicalReportPackagePath?: string;
  mathematicalAssetPayloads?: AiGraderMathematicalAssetPayloadTransportV1[];
  rapidCaptureEnabled?: boolean;
  queueItemId?: string;
  captureTriggerMode?: AiGraderCaptureTriggerMode;
  captureTriggerAt?: string;
  geometryCaptureMode?: AiGraderGeometryCaptureMode;
  idempotencyKey?: string;
  expectedSessionId?: string;
  expectedReportId?: string;
  expectedSide?: CardGeometrySide;
  expectedSideEpoch?: string;
  expectedCandidateProfileIdentity?: string;
  expectedFrameId?: string;
}

export interface StartedAiGraderLocalStationBridge {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  config: AiGraderLocalStationBridgeConfig;
}

export type AiGraderLocalStationLightingWriteResult =
  | LeimacIdmuWriteResult
  | { responseKind: "mock"; ok: true };

export type AiGraderLocalStationRealHardwareBoundary =
  | "lighting_network"
  | "calibration_camera_capture"
  | "orphan_preview_process_scan"
  | "preview_process_start"
  | "preview_process_stop";

export interface AiGraderLocalStationBridgeDependencies {
  detectPreviewCardGeometry?: typeof detectCardGeometryFromBuffer;
  writeLightingFrames?: (
    frames: readonly LeimacIdmuWriteFrame[]
  ) => Promise<AiGraderLocalStationLightingWriteResult[]>;
  stopOrphanedPreviewStreamsUntilReleased?: (timeoutMs: number, settleMs: number) => Promise<number>;
  stopPreviewProcessTree?: (child: ChildProcessWithoutNullStreams) => void;
  startPreviewProcess?: (input: {
    pylonRoot?: string;
    bridgeScriptPath?: string;
    timeoutMs: number;
    cameraIndex?: number;
    exposureUs: number;
    refreshIntervalMs: number;
    jpegQuality: number;
  }) => ChildProcessWithoutNullStreams;
  onRealHardwareBoundary?: (boundary: AiGraderLocalStationRealHardwareBoundary) => void;
  mathematicalCalibrationCaptureProducer?: FixedRigMathematicalCalibrationCaptureProducerV1;
  loadMathematicalCalibrationBundle?: typeof loadFixedRigMathematicalCalibrationBundleV1;
  buildMathematicalStationPackage?: typeof buildFixedRigMathematicalCalibrationStationPackageV1;
  captureMathematicalCalibrationFrame?: (
    input: FixedRigMathematicalCalibrationCaptureBoundaryRequestV1,
  ) => Promise<FixedRigMathematicalCalibrationCaptureBoundaryResultV1>;
}

export function requireAppliedMathematicalCalibrationCameraSettings(
  capture: Pick<BaslerCaptureStillResult, "exposureTime" | "gain">,
): { exposureUs: number; gain: number } {
  if (
    typeof capture.exposureTime !== "number" ||
    !Number.isFinite(capture.exposureTime) ||
    capture.exposureTime <= 0 ||
    typeof capture.gain !== "number" ||
    !Number.isFinite(capture.gain) ||
    capture.gain < 0
  ) {
    throw new Error(
      "Mathematical calibration capture requires finite applied exposure and gain telemetry from Pylon; requested settings cannot substitute for missing camera evidence.",
    );
  }
  return { exposureUs: capture.exposureTime, gain: capture.gain };
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

function writeMjpegFrame(
  res: http.ServerResponse,
  contentType: string,
  bytes: Buffer,
  frameIndex: number,
  capturedAt: string,
  binding: { sessionId: string; side: CardGeometrySide; sideEpoch: string },
  frameId: string
) {
  res.write(`--${PREVIEW_MJPEG_BOUNDARY}\r\n`);
  res.write(`Content-Type: ${contentType}\r\n`);
  res.write(`Content-Length: ${bytes.length}\r\n`);
  res.write(`X-AI-Grader-Frame-Index: ${frameIndex}\r\n`);
  res.write(`X-AI-Grader-Captured-At: ${capturedAt}\r\n`);
  res.write(`X-AI-Grader-Session-Id: ${binding.sessionId}\r\n`);
  res.write(`X-AI-Grader-Preview-Side: ${binding.side}\r\n`);
  res.write(`X-AI-Grader-Preview-Epoch: ${binding.sideEpoch}\r\n`);
  res.write(`X-AI-Grader-Frame-Id: ${frameId}\r\n\r\n`);
  res.write(bytes);
  res.write("\r\n");
}

function setMjpegHeaders(
  res: http.ServerResponse,
  origin: string | undefined,
  config: AiGraderLocalStationBridgeConfig,
  binding: { sessionId: string; side: CardGeometrySide; sideEpoch: string },
  streamId: string
) {
  setCors(res, origin, config);
  res.writeHead(200, {
    "Content-Type": `multipart/x-mixed-replace; boundary=${PREVIEW_MJPEG_BOUNDARY}`,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Connection": "close",
    "X-AI-Grader-Preview": "local-token-gated",
    "X-AI-Grader-Session-Id": binding.sessionId,
    "X-AI-Grader-Preview-Side": binding.side,
    "X-AI-Grader-Preview-Epoch": binding.sideEpoch,
    "X-AI-Grader-Frame-Id": streamId,
  });
}

const NEXT_ACTION_BY_STEP: Record<AiGraderLocalStationStepId, AiGraderLocalStationBridgeAction> = {
  start_new_card: "start-session",
  live_preview_focus_framing: "capture-front",
  lighting_exposure_tune: "capture-front",
  capture_front: "capture-front",
  prompt_flip_card: "capture-back",
  capture_back: "capture-back",
  run_provisional_diagnostics: "run-diagnostics",
  view_unified_report: "calculate-final-grade",
  calculate_final_grade: "finalize-report",
  finalize_publish_report: "generate-label-data",
  label_data_ready: "latest-report",
  session_complete: "latest-report",
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

function stationContractObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be one exact JSON object.");
  }
  return value as Record<string, unknown>;
}

function assertStationContractKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(label + " fields do not match the exact station contract.");
  }
}

function exactStationString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(label + " must be a non-empty string.");
  }
  return value.trim();
}

function validateLocalMathematicalGradingAuthorityV1(
  value: unknown,
): AiGraderLocalStationMathematicalGradingAuthorityV1 {
  const authority = stationContractObject(value, "Mathematical V1 grading authority");
  assertStationContractKeys(
    authority,
    ["schemaVersion", "cardIdentity", "cardFormatId", "sides"],
    "Mathematical V1 grading authority",
  );
  if (authority.schemaVersion !== FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION) {
    throw new Error("Mathematical V1 grading authority schemaVersion is not supported.");
  }
  const cardIdentity = stationContractObject(authority.cardIdentity, "Mathematical V1 card identity");
  for (const field of ["tenantId", "setId", "programId", "cardNumber"] as const) {
    exactStationString(cardIdentity[field], "Mathematical V1 card identity " + field);
  }
  if (!("variantId" in cardIdentity) || !("parallelId" in cardIdentity)) {
    throw new Error("Mathematical V1 card identity requires explicit nullable variantId and parallelId.");
  }
  const sides = stationContractObject(authority.sides, "Mathematical V1 side authority");
  assertStationContractKeys(sides, ["front", "back"], "Mathematical V1 side authority");
  for (const side of ["front", "back"] as const) {
    const sideAuthority = stationContractObject(sides[side], "Mathematical V1 " + side + " authority");
    assertStationContractKeys(sideAuthority, ["centering"], "Mathematical V1 " + side + " authority");
    const centering = stationContractObject(
      sideAuthority.centering,
      "Mathematical V1 " + side + " centering authority",
    );
    if (centering.profile === "printed_border_v1") {
      assertStationContractKeys(
        centering,
        ["profile"],
        "Mathematical V1 printed-border " + side + " authority",
      );
      continue;
    }
    if (centering.profile !== "registered_design_template_v1") {
      throw new Error("Mathematical V1 " + side + " centering profile is not supported.");
    }
    assertStationContractKeys(
      centering,
      ["profile", "approvedReference", "approvedDesignArtifact"],
      "Mathematical V1 registered-template " + side + " authority",
    );
    const reference = stationContractObject(
      centering.approvedReference,
      "Mathematical V1 " + side + " approved reference",
    );
    assertStationContractKeys(
      reference,
      [
        "tenantId", "setId", "programId", "cardNumber", "variantId", "parallelId",
        "referenceId", "profile", "status", "side", "version", "artifactSha256",
        "artifactWidthPx", "artifactHeightPx", "intendedDesignBoundary",
        "approvedByUserId", "approvedAt",
      ],
      "Mathematical V1 " + side + " approved reference",
    );
    const artifact = stationContractObject(
      centering.approvedDesignArtifact,
      "Mathematical V1 " + side + " approved artifact",
    );
    assertStationContractKeys(
      artifact,
      ["assetId", "fileName", "contentType", "sha256"],
      "Mathematical V1 " + side + " approved artifact",
    );
    const artifactSha256 = exactStationString(
      artifact.sha256,
      "Mathematical V1 " + side + " artifact SHA-256",
    ).toLowerCase();
    if (!SHA256_LOWERCASE_RE.test(artifactSha256) || reference.artifactSha256 !== artifactSha256) {
      throw new Error("Mathematical V1 " + side + " reference and artifact SHA-256 do not match.");
    }
    if (reference.side !== side || reference.profile !== "registered_design_template_v1" ||
        reference.status !== "approved") {
      throw new Error("Mathematical V1 " + side + " reference is not the exact approved side/profile.");
    }
    for (const field of ["tenantId", "setId", "programId", "cardNumber", "variantId", "parallelId"] as const) {
      if (reference[field] !== cardIdentity[field]) {
        throw new Error("Mathematical V1 " + side + " reference identity does not match the exact card.");
      }
    }
    if (artifact.contentType !== "image/png" && artifact.contentType !== "image/jpeg") {
      throw new Error("Mathematical V1 design-reference contentType must be image/png or image/jpeg.");
    }
    const fileName = exactStationString(artifact.fileName, "Mathematical V1 design-reference fileName");
    if (path.basename(fileName) !== fileName) {
      throw new Error("Mathematical V1 design-reference fileName must be a safe leaf.");
    }
    exactStationString(reference.referenceId, "Mathematical V1 approved reference ID");
    exactStationString(artifact.assetId, "Mathematical V1 design-reference asset ID");
  }
  return structuredClone(value) as AiGraderLocalStationMathematicalGradingAuthorityV1;
}

function newLocalMathematicalV1State(
  authority: AiGraderLocalStationMathematicalGradingAuthorityV1,
  generatedAt: string,
): AiGraderLocalStationMathematicalV1State {
  return {
    schemaVersion: "ten-kings-ai-grader-local-station-mathematical-v1-state-v1",
    generatedAt,
    gradingAuthority: structuredClone(authority),
    stagedDesignReferences: {},
  };
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

function activePreviewGeometrySide(step: AiGraderLocalStationStepId): CardGeometrySide {
  return step === "prompt_flip_card" || step === "capture_back" || step === "run_provisional_diagnostics"
    ? "back"
    : "front";
}

function buildPreviewSideEpoch(sessionId: string | undefined, side: CardGeometrySide, epoch: number) {
  const identity = crypto
    .createHash("sha256")
    .update(`${sessionId ?? "pending"}:${side}:${epoch}`)
    .digest("hex")
    .slice(0, 16);
  return `${side}-${epoch}-${identity}`;
}

function defaultPreviewGeometryStatus(
  config: Pick<AiGraderLocalStationBridgeConfig, "mode">,
  binding: { sessionId?: string; side?: CardGeometrySide; sideEpoch?: string } = {}
): AiGraderPreviewGeometryStatus {
  const side = binding.side ?? "front";
  return {
    activeSide: side,
    sessionId: binding.sessionId,
    sideEpoch: binding.sideEpoch ?? buildPreviewSideEpoch(binding.sessionId, side, 0),
    analysis: {
      source: config.mode === "real" ? "real_mjpeg_jpeg" : "mock_deterministic",
      throttleMs: PREVIEW_GEOMETRY_THROTTLE_MS,
      inFlight: false,
      latestFramePending: false,
      framesAnalyzed: 0,
      framesDroppedAsStale: 0,
    },
    explicitManualOverlayAvailable: true,
    previewFramesPersisted: false,
  };
}

function mockPreviewGeometry(
  side: CardGeometrySide,
  frameIndex: number,
  timestamp: string,
  sessionId: string,
  sideEpoch: string,
  frameId: string
): CardGeometryMetadata & { sessionId: string; sideEpoch: string } {
  const placementState: CardPlacementState = frameIndex === 1 ? "not_detected" : frameIndex === 2 ? "adjust_card" : "ready";
  const detected = placementState !== "not_detected";
  const ready = placementState === "ready";
  const box = detected
    ? ready
      ? { x: 198, y: 277.5, width: 504, height: 705 }
      : { x: 42, y: 277.5, width: 504, height: 705 }
    : null;
  const corners = box
    ? {
        topLeft: { x: box.x, y: box.y },
        topRight: { x: box.x + box.width, y: box.y },
        bottomRight: { x: box.x + box.width, y: box.y + box.height },
        bottomLeft: { x: box.x, y: box.y + box.height },
      }
    : null;
  return {
    version: "ten-kings-card-geometry-v1",
    detectionPolicy: "live_preview_fast",
    side,
    placementState,
    adjustmentReason: placementState === "ready" ? null : placementState === "adjust_card" ? "outside_frame" : "not_detected",
    geometrySource: detected ? "detected" : "none",
    captureMode: detected ? "automatic_detection" : "none",
    confidenceBasis: detected ? "automatic_detection" : "none",
    detectionUsed: detected,
    manualOverrideUsed: false,
    corners,
    detectedCorners: corners,
    boundingBox: box,
    rotationDegrees: detected ? 0 : null,
    skewDegrees: detected ? 0 : null,
    confidence: ready ? 0.96 : detected ? 0.82 : 0,
    sourceImageId: `preview-${side}`,
    sourceFrameId: frameId,
    timestamp,
    sessionId,
    sideEpoch,
    image: { width: 900, height: 1260, coordinateFrame: "source_image_pixels" },
    semanticOrientation: {
      canonicalOrientation: "portrait",
      basis: "operator_top_toward_preview_top",
      contentUprightVerified: false,
    },
    placement: {
      ...(detected ? {
        centerOffsetPixels: ready
          ? { x: 0, y: 0, distance: 0, maxAxis: 0 }
          : { x: -156, y: 0, distance: 156, maxAxis: 156 },
        centerOffsetInches: ready
          ? { x: 0, y: 0, distance: 0, maxAxis: 0 }
          : { x: -0.7738, y: 0, distance: 0.7738, maxAxis: 0.7738 },
        estimatedPixelsPerInch: 201.6,
      } : {}),
      maxCenterOffsetInches: 0.5,
      maxSkewDegrees: 10,
      maxNormalizationSkewDegrees: 35,
      minReadyConfidence: 0.72,
      withinCenterTolerance: ready,
      withinSkewTolerance: detected,
      withinNormalizationSkewTolerance: detected,
      withinAspectTolerance: detected,
      withinFrame: ready,
      confidenceReady: detected,
    },
    detection: {
      method: "adaptive_border_contrast_connected_component_pca_v1",
      backgroundLuma: 20,
      contrastRange: detected ? 180 : 0,
      foregroundThreshold: detected ? 54 : 12,
      foregroundPixelFraction: detected ? 0.3133 : 0,
      ...(detected ? { componentPixelFraction: 0.3133, measuredAspectRatio: 1.3988, relativeAspectError: 0.0009 } : {}),
      expectedAspectRatio: 1.4,
      analysisWidth: 731,
      analysisHeight: 1024,
    },
    warnings: placementState === "not_detected"
      ? ["Mock preview has no card candidate yet."]
      : placementState === "adjust_card"
        ? ["Mock card is outside the safe visible-frame boundary."]
        : [],
  };
}

export interface AiGraderPreviewJpegFrame {
  bytes: Buffer;
  capturedAt?: string;
  receivedAt: string;
  frameIndex?: number;
  timestampSource: "preview_capture_header" | "bridge_received";
}

export class AiGraderPreviewJpegFrameAssembler {
  private buffered = Buffer.alloc(0);
  private pendingFrameMetadata?: Omit<AiGraderPreviewJpegFrame, "bytes">;

  get bufferedByteLength() {
    return this.buffered.length;
  }

  push(chunk: Buffer): Buffer[] {
    return this.pushWithMetadata(chunk).map((frame) => frame.bytes);
  }

  pushWithMetadata(chunk: Buffer): AiGraderPreviewJpegFrame[] {
    if (!chunk.length) return [];
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk]) : Buffer.from(chunk);
    const frames: AiGraderPreviewJpegFrame[] = [];
    while (this.buffered.length) {
      const start = this.buffered.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) {
        const text = this.buffered.toString("latin1");
        const looksLikeMultipartHeader = text.includes("--") || /(?:Content-|X-AI-Grader-)/i.test(text);
        this.buffered = looksLikeMultipartHeader
          ? this.buffered.subarray(-PREVIEW_MJPEG_HEADER_BUFFER_LIMIT_BYTES)
          : this.buffered.at(-1) === 0xff
            ? this.buffered.subarray(-1)
            : Buffer.alloc(0);
        break;
      }
      if (!this.pendingFrameMetadata) {
        const header = start > 0 ? this.buffered.subarray(0, start).toString("latin1") : "";
        const capturedAtValues = [...header.matchAll(/(?:^|\r?\n)X-AI-Grader-Captured-At:\s*([^\r\n]+)/gi)];
        const frameIndexValues = [...header.matchAll(/(?:^|\r?\n)X-AI-Grader-Frame-Index:\s*(\d+)/gi)];
        const capturedAtCandidate = capturedAtValues.at(-1)?.[1]?.trim();
        const frameIndexCandidate = Number(frameIndexValues.at(-1)?.[1]);
        const receivedAt = new Date().toISOString();
        this.pendingFrameMetadata = {
          receivedAt,
          ...(capturedAtCandidate && Number.isFinite(Date.parse(capturedAtCandidate))
            ? { capturedAt: capturedAtCandidate, timestampSource: "preview_capture_header" as const }
            : { timestampSource: "bridge_received" as const }),
          ...(Number.isSafeInteger(frameIndexCandidate) && frameIndexCandidate >= 0
            ? { frameIndex: frameIndexCandidate }
            : {}),
        };
      }
      if (start > 0) this.buffered = this.buffered.subarray(start);
      const end = this.buffered.indexOf(Buffer.from([0xff, 0xd9]), 2);
      if (end < 0) {
        if (this.buffered.length > PREVIEW_JPEG_BUFFER_LIMIT_BYTES) {
          const nextStart = this.buffered.lastIndexOf(Buffer.from([0xff, 0xd8]));
          this.buffered = nextStart > 0 && this.buffered.length - nextStart <= PREVIEW_JPEG_BUFFER_LIMIT_BYTES
            ? this.buffered.subarray(nextStart)
            : this.buffered.subarray(-1);
          this.pendingFrameMetadata = this.buffered.length > 1
            ? { receivedAt: new Date().toISOString(), timestampSource: "bridge_received" }
            : undefined;
        }
        break;
      }
      const frameEnd = end + 2;
      if (frameEnd <= PREVIEW_JPEG_BUFFER_LIMIT_BYTES) {
        frames.push({
          bytes: Buffer.from(this.buffered.subarray(0, frameEnd)),
          ...(this.pendingFrameMetadata ?? {
            receivedAt: new Date().toISOString(),
            timestampSource: "bridge_received" as const,
          }),
        });
      }
      this.buffered = this.buffered.subarray(frameEnd);
      this.pendingFrameMetadata = undefined;
    }
    return frames;
  }
}

function parseCaptureProfile(value: string | undefined): FixedRigCaptureProfile {
  const normalized = (value ?? "full_forensic").trim().toLowerCase();
  if (normalized === "full_forensic" || normalized === "production_fast") return normalized;
  throw new Error("AI Grader capture profile must be full_forensic or production_fast.");
}

function parseCaptureTriggerMode(value: AiGraderCaptureTriggerMode | undefined): AiGraderCaptureTriggerMode {
  if (value === undefined || value === "operator") return "operator";
  if (value === "auto") return "auto";
  throw new Error("AI Grader capture trigger mode must be operator or auto.");
}

function validatedCaptureTriggerAt(value: string | undefined, actionReceivedAt: string): string {
  const receivedMs = Date.parse(actionReceivedAt);
  if (typeof value !== "string" || !Number.isFinite(receivedMs)) return actionReceivedAt;
  const suppliedMs = Date.parse(value);
  if (!Number.isFinite(suppliedMs)) return actionReceivedAt;
  if (suppliedMs < receivedMs - CAPTURE_TRIGGER_MAX_ACTION_DELAY_MS || suppliedMs > receivedMs) return actionReceivedAt;
  if (new Date(suppliedMs).toISOString().slice(0, 10) !== new Date(receivedMs).toISOString().slice(0, 10)) return actionReceivedAt;
  return new Date(suppliedMs).toISOString();
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
  const capped = Math.max(0, Math.min(LEIMAC_IDMU_MAX_DUTY_PERCENT, input));
  const step = Math.max(0, Math.min(999, Math.round(capped * 10)));
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
  if (!Number.isFinite(requestedDuty) || requestedDuty < 0 || requestedDuty > LEIMAC_IDMU_MAX_DUTY_PERCENT) {
    throw new Error(`AI Grader live lighting duty must be from 0 to ${LEIMAC_IDMU_MAX_DUTY_PERCENT} percent.`);
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
  const captureProfile = input.captureProfile ?? parseCaptureProfile(env.AI_GRADER_CAPTURE_PROFILE);
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
  if (!Number.isFinite(duty) || duty < 0 || duty > LEIMAC_IDMU_MAX_DUTY_PERCENT) throw new Error(`AI Grader station bridge duty must be from 0 to ${LEIMAC_IDMU_MAX_DUTY_PERCENT} percent.`);
  const mathematicalCalibrationTargetSha256 = firstNonEmpty(
    input.mathematicalCalibrationTargetSha256,
    env.AI_GRADER_MATHEMATICAL_CALIBRATION_TARGET_SHA256,
  );
  const mathematicalCalibrationProfileSha256 = firstNonEmpty(
    input.mathematicalCalibrationProfileSha256,
    env.AI_GRADER_MATHEMATICAL_CALIBRATION_PROFILE_SHA256,
  );
  const mathematicalCalibrationBundleSha256 = firstNonEmpty(
    input.mathematicalCalibrationBundleSha256,
    env.AI_GRADER_MATHEMATICAL_CALIBRATION_BUNDLE_SHA256,
  );
  for (const [name, value] of [
    ["mathematical calibration target", mathematicalCalibrationTargetSha256],
    ["mathematical calibration profile", mathematicalCalibrationProfileSha256],
    ["mathematical calibration bundle", mathematicalCalibrationBundleSha256],
  ] as const) {
    if (value && !/^[a-f0-9]{64}$/.test(value)) throw new Error(`AI Grader ${name} SHA-256 must be exact lowercase hexadecimal.`);
  }
  const mathematicalCalibrationOutputDir = firstNonEmpty(
    input.mathematicalCalibrationOutputDir,
    env.AI_GRADER_MATHEMATICAL_CALIBRATION_OUTPUT_DIR,
  ) ?? path.join(outputDir, "mathematical-calibration-v1");
  assertFixedRigOutputDirAllowed(mathematicalCalibrationOutputDir);
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
    captureProfile,
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
    mathematicalCalibrationOutputDir,
    mathematicalCalibrationTargetPath: firstNonEmpty(
      input.mathematicalCalibrationTargetPath,
      env.AI_GRADER_MATHEMATICAL_CALIBRATION_TARGET_PATH,
    ),
    mathematicalCalibrationTargetVersion: firstNonEmpty(
      input.mathematicalCalibrationTargetVersion,
      env.AI_GRADER_MATHEMATICAL_CALIBRATION_TARGET_VERSION,
    ),
    mathematicalCalibrationTargetSha256,
    mathematicalCalibrationRigId: firstNonEmpty(
      input.mathematicalCalibrationRigId,
      env.AI_GRADER_MATHEMATICAL_CALIBRATION_RIG_ID,
    ) ?? "ten-kings-fixed-rig-dell-v1",
    mathematicalCalibrationProfilePath: firstNonEmpty(
      input.mathematicalCalibrationProfilePath,
      env.AI_GRADER_MATHEMATICAL_CALIBRATION_PROFILE_PATH,
    ),
    mathematicalCalibrationProfileSha256,
    mathematicalCalibrationBundlePath: firstNonEmpty(
      input.mathematicalCalibrationBundlePath,
      env.AI_GRADER_MATHEMATICAL_CALIBRATION_BUNDLE_PATH,
    ),
    mathematicalCalibrationBundleSha256,
  };
}

function newManifest(
  config: AiGraderLocalStationBridgeConfig,
  rapidCaptureEnabled = false,
  startedAt = new Date().toISOString(),
): AiGraderLocalStationBridgeManifest {
  const captureProfile: FixedRigCaptureProfile = config.captureProfile;
  return {
    schemaVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
    stationId: "local-dell-ai-grader-station",
    currentStep: "start_new_card",
    mode: config.mode,
    updatedAt: startedAt,
    acceptedProfile: defaultProfile(config),
    gradingContract: "legacy_v0",
    captureProfile,
    captureProfileGuard: {
      stationSettingRequired: true,
      selectionSource: "bridge_default",
      productionFastOptIn: captureProfile === "production_fast",
      fullForensicEvidencePreserved: true,
      availableCaptureProfiles: ["full_forensic", "production_fast"],
      previousStableProfile: "full_forensic",
      fiveSecondTargetProven: false,
    },
    executionPath: "warm_full_forensic_runner",
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
        ? "Real bridge mode is enabled; bounded hardware actions require exact controller acknowledgement."
        : "Mock bridge mode is active; hardware success is not claimed.",
    ],
    captureTiming: createAiGraderCaptureTimingMetadata({
      captureProfile,
      hardwareMeasurement: false,
      startedAt,
    }),
    captureTimingHardwareEvidence: {
      front: { captureBatch: false, processedManifest: false },
      back: { captureBatch: false, processedManifest: false },
    },
    geometryCaptureDecisions: {},
    rapidCapture: {
      enabled: rapidCaptureEnabled,
      workflowHistory: [],
      humanConfirmationRequired: true,
      autoConfirm: false,
      autoPublish: false,
    },
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

function defaultWarmRunnerStatus(_config?: AiGraderLocalStationBridgeConfig): AiGraderWarmRunnerStatus {
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
    note: "Full forensic evidence runs only through the bridge-owned warm runner with serialized camera and lighting ownership.",
  };
}

function defaultPreviewStatus(config: AiGraderLocalStationBridgeConfig): AiGraderLocalStationPreviewStatus {
  const sideEpoch = buildPreviewSideEpoch(undefined, "front", 0);
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
    activeSide: "front",
    sideEpoch,
    positioningLightReady: false,
    intentionalTransition: { active: false },
    cardGeometry: defaultPreviewGeometryStatus(config, { side: "front", sideEpoch }),
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
    status: "unavailable",
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
      reason: "Bridge startup has no controller acknowledgement for the current physical light state.",
      changedAt: new Date().toISOString(),
      expectedWriteCount: 0,
      acknowledgedWriteCount: 0,
      complete: false,
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
      lowDutyCapEnforced: false,
      maxDutyPercent: LEIMAC_IDMU_MAX_DUTY_PERCENT,
      safeOffOnAllOff: true,
      safeOffOnDisconnect: true,
      safeOffOnTimeout: true,
      safeOffOnCaptureStart: false,
      safeOffOnCaptureFailure: true,
      safeOffOnSessionEnd: true,
      persistentLeimacSaved: false,
      arbitraryWritesAllowed: false,
    },
    safetyEvents: [],
    backPositioning: {
      status: "inactive",
      captureReady: false,
      side: "back",
      sideEpoch: buildPreviewSideEpoch(undefined, "back", 0),
      attemptCount: 0,
      firstFrameGraceMs: BACK_POSITIONING_FIRST_FRAME_GRACE_MS,
      events: [],
    },
    note:
      "Lighting is local-only through the paired Dell bridge. Start New Card applies the configured profile, and the exact controller-acknowledged bridge state is authoritative for capture.",
  };
}

function validateProfile(profile: Partial<AiGraderLocalStationAcceptedProfile> | undefined, current: AiGraderLocalStationAcceptedProfile): AiGraderLocalStationAcceptedProfile {
  if (!profile) return current;
  const requestedDuty = typeof profile.dutyPercent === "number" ? profile.dutyPercent : current.dutyPercent;
  if (!Number.isFinite(requestedDuty) || requestedDuty < 0 || requestedDuty > LEIMAC_IDMU_MAX_DUTY_PERCENT) {
    throw new Error(`Accepted AI Grader station duty must be from 0 to ${LEIMAC_IDMU_MAX_DUTY_PERCENT} percent.`);
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

function boundedBackPositioningError(
  error: unknown,
  code: "AI_GRADER_BACK_POSITIONING_RESTORE_FAILED" | "AI_GRADER_BACK_PREVIEW_FRAME_REQUIRED" = "AI_GRADER_BACK_POSITIONING_RESTORE_FAILED"
) {
  const fallback = code === "AI_GRADER_BACK_PREVIEW_FRAME_REQUIRED"
    ? "A fresh live back preview frame is required before the positioning light can remain on."
    : "The accepted back-positioning light profile could not be established. End this card session and inspect the local light connection.";
  let message = error instanceof Error ? error.message : fallback;
  message = message
    .replace(/[A-Za-z]:\\[^\r\n]*/g, "[local path]")
    .replace(/(?:https?:\/\/|\\\\)[^\s]+/gi, "[local endpoint]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[local address]")
    .replace(/\b(?:token|secret|authorization|bearer|password)\b\s*[:=]?\s*[^\s,;]*/gi, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, BACK_POSITIONING_ERROR_MAX_LENGTH);
  return { code, message: message || fallback };
}

function boundedPreviewLifecycleError(error: unknown) {
  const fallback = "The local preview lifecycle failed. Restart the preview after checking the local camera connection.";
  let message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  message = message
    .replace(/[A-Za-z]:\\[^\r\n]*/g, "[local path]")
    .replace(/(?:https?:\/\/|\\\\)[^\s]+/gi, "[local endpoint]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[local address]")
    .replace(/\b(?:token|secret|authorization|bearer|password)\b\s*[:=]?\s*[^\s,;]*/gi, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, BACK_POSITIONING_ERROR_MAX_LENGTH);
  return message || fallback;
}

function boundedProcessingWorkerError(error: unknown) {
  const fallback = "Captured evidence processing failed in the isolated worker; the session is terminal and requires a fresh capture.";
  let message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  message = message
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, "[local path]")
    .replace(/(?:https?:\/\/|\\\\)[^\s]+/gi, "[local endpoint]")
    .replace(/(^|[\s=(])\/[^\s,;]+/g, "$1[local path]")
    .replace(/\[[0-9A-Fa-f:]{2,}\](?::\d{1,5})?/g, "[local address]")
    .replace(/(?:^|[^0-9A-Fa-f:])(?:0:){7}[01](?:[^0-9A-Fa-f:]|$)/gi, " [local address] ")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[local address]")
    .replace(/\b(?:token|secret|authorization|bearer|password)\b\s*[:=]?\s*[^\s,;]*/gi, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, BACK_POSITIONING_ERROR_MAX_LENGTH);
  return message || fallback;
}

function acceptedProfileDigestSha256(profile: AiGraderLocalStationAcceptedProfile) {
  const duty = roundDuty(profile.dutyPercent);
  const channels = normalizeLightingChannels(profile.channels, { allowEmpty: false });
  const allowedSources = new Set<AiGraderLocalStationAcceptedProfile['source']>([
    'operator_preview',
    'browser_live_tuning',
    'default',
    'cli_override',
    'bridge_operator',
  ]);
  if (
    duty.dutyPercent <= 0
    || duty.dutyPercent > LEIMAC_IDMU_MAX_DUTY_PERCENT
    || duty.actualLeimacPwmStep !== profile.actualLeimacPwmStep
    || !Number.isInteger(profile.exposureUs)
    || profile.exposureUs <= 0
    || profile.exposureUs > 100000
    || !Number.isFinite(profile.gain)
    || profile.gain < 0
    || !allowedSources.has(profile.source)
  ) {
    throw new Error('The durable accepted station profile is invalid for guarded capture.');
  }
  return crypto.createHash('sha256').update(JSON.stringify({
    dutyPercent: duty.dutyPercent,
    actualLeimacPwmStep: duty.actualLeimacPwmStep,
    exposureUs: profile.exposureUs,
    gain: profile.gain,
    channels,
    source: profile.source,
  })).digest('hex');
}

function durableAcceptedPositioningProfile(profile: AiGraderLocalStationAcceptedProfile) {
  const profileDigestSha256 = acceptedProfileDigestSha256(profile);
  const acceptedAt = profile.acceptedAt;
  if (typeof acceptedAt !== 'string' || !Number.isFinite(Date.parse(acceptedAt)) || new Date(acceptedAt).toISOString() !== acceptedAt) {
    throw new Error('The durable accepted station profile has no valid bridge acceptance timestamp.');
  }
  const duty = roundDuty(profile.dutyPercent);
  const channels = normalizeLightingChannels(profile.channels, { allowEmpty: false });
  const allowedSources = new Set<AiGraderLocalStationAcceptedProfile["source"]>([
    "operator_preview",
    "browser_live_tuning",
    "default",
    "cli_override",
    "bridge_operator",
  ]);
  if (
    duty.dutyPercent <= 0
    || duty.dutyPercent > LEIMAC_IDMU_MAX_DUTY_PERCENT
    || duty.actualLeimacPwmStep !== profile.actualLeimacPwmStep
    || !allowedSources.has(profile.source)
  ) {
    throw new Error("The durable accepted station profile is invalid for guarded back positioning.");
  }
  const identityInput = JSON.stringify({
    profileDigestSha256,
    acceptedAt,
  });
  return {
    profile: {
      enabled: true,
      dutyPercent: duty.dutyPercent,
      actualLeimacPwmStep: duty.actualLeimacPwmStep,
      channels,
      source: "accepted_station_profile" as const,
      acceptedForCapture: true,
      acceptedAt,
    },
    profileDigestSha256,
    identity: `accepted-${crypto.createHash("sha256").update(identityInput).digest("hex").slice(0, 16)}`,
  };
}

function buildFixedRigProfile(profile: AiGraderLocalStationAcceptedProfile): FixedRigActiveLightingProfile {
  return buildFixedRigActiveLightingProfile({
    selectedDutyPercent: profile.dutyPercent,
    selectedChannels: profile.channels,
    profileSource: profile.source === "browser_live_tuning"
      ? "browser_live_tuning"
      : profile.source === "default" || profile.source === "bridge_operator"
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

function isSubpath(childPath: string, parentPath: string) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeReportPackageSegment(reportId: string) {
  const normalized = reportId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(normalized)) {
    throw new Error("AI Grader report ID is not safe for a publish package directory.");
  }
  return normalized;
}

interface AiGraderReportRecoverySource {
  manifest: AiGraderLocalStationBridgeManifest;
  reportDir: string;
  sessionManifestPath: string;
}

function reportBundleRootDir(config: AiGraderLocalStationBridgeConfig) {
  return config.reportBundleOutputDir ?? path.join(config.outputDir, "report-bundles");
}

function publishPackageDir(config: AiGraderLocalStationBridgeConfig, reportId: string) {
  return path.join(reportBundleRootDir(config), safeReportPackageSegment(reportId));
}

function publishPackagePath(config: AiGraderLocalStationBridgeConfig, reportId: string, fileName: string) {
  return path.join(publishPackageDir(config, reportId), fileName);
}

function mathematicalPublishPackageDir(config: AiGraderLocalStationBridgeConfig, reportId: string) {
  return path.join(publishPackageDir(config, reportId), AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_DIR);
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
    fixtureLabel: config.fixtureLabel,
    fixtureId: config.fixtureId,
    referenceType: config.referenceType,
    horizontalSpanMm: config.horizontalSpanMm,
    horizontalStartPx: config.horizontalStartPx,
    horizontalEndPx: config.horizontalEndPx,
    verticalSpanMm: config.verticalSpanMm,
    verticalStartPx: config.verticalStartPx,
    verticalEndPx: config.verticalEndPx,
  };
}

function stepById(config: AiGraderLocalStationBridgeConfig, manifest: AiGraderLocalStationBridgeManifest, id: AiGraderStationCommandStep["id"]) {
  const plan = buildAiGraderStationRealCommandPlan(commandInput(config, manifest));
  const step = plan.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`AI Grader station command plan missing step ${id}.`);
  return step;
}

function assertRealBridgeArmed(config: AiGraderLocalStationBridgeConfig) {
  if (config.mode !== "real") return;
  if (!config.apply || !config.markPresent || !config.wiringConfirmed || !config.leimacStatusGreen || !config.leimacHost) {
    throw new Error("Real AI Grader station bridge is not armed with required apply/Mark/wiring/Leimac flags.");
  }
}

function assertRealReady(config: AiGraderLocalStationBridgeConfig, manifest: AiGraderLocalStationBridgeManifest) {
  assertRealBridgeArmed(config);
  void manifest;
}

function assertAtomicFrontRealReady(config: AiGraderLocalStationBridgeConfig) {
  assertRealBridgeArmed(config);
}

function mathematicalCalibrationReadiness(
  config: AiGraderLocalStationBridgeConfig,
  loader: typeof loadFixedRigMathematicalCalibrationBundleV1 = loadFixedRigMathematicalCalibrationBundleV1,
): NonNullable<AiGraderLocalStationBridgeStatus["mathematicalCalibration"]> {
  if (!config.mathematicalCalibrationBundlePath || !config.mathematicalCalibrationBundleSha256) {
    return { ready: false, reason: "No exact finalized Mathematical Calibration V1 bundle is configured on this station." };
  }
  try {
    const loaded = loader({
      bundlePath: config.mathematicalCalibrationBundlePath,
      bundleSha256: config.mathematicalCalibrationBundleSha256,
      expectedRigId: config.mathematicalCalibrationRigId,
    });
    return {
      ready: true,
      profileId: loaded.profile.profileId,
      calibrationVersion: loaded.profile.calibrationVersion,
      rigId: loaded.profile.rigId,
      artifactSha256: loaded.profile.artifactSha256,
      bundleSha256: loaded.bundleSha256,
    };
  } catch (error) {
    return { ready: false, reason: error instanceof Error ? error.message : "Calibration bundle readiness could not be established." };
  }
}

const atomicJsonWriteChains = new Map<string, Promise<void>>();

async function writeJsonAtomic(filePath: string, value: unknown) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const previous = atomicJsonWriteChains.get(filePath) ?? Promise.resolve();
  const write = previous
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await writeFile(tempPath, serialized, "utf-8");
      await rename(tempPath, filePath);
    });
  atomicJsonWriteChains.set(filePath, write);
  try {
    await write;
  } finally {
    if (atomicJsonWriteChains.get(filePath) === write) atomicJsonWriteChains.delete(filePath);
  }
}

async function writeSessionManifest(manifest: AiGraderLocalStationBridgeManifest) {
  if (!manifest.outputs.sessionDir) return;
  const manifestPath = manifest.outputs.manifestPath ?? path.join(manifest.outputs.sessionDir, "station-session.json");
  manifest.outputs.manifestPath = manifestPath;
  await writeJsonAtomic(manifestPath, manifest);
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
      action: AiGraderLocalStationBridgeAction | "preview-status" | "preview-stream" | "lighting-status" | "lighting-apply" | "lighting-heartbeat"
        | "mathematical-calibration-start" | "mathematical-calibration-status" | "mathematical-calibration-capture"
        | "mathematical-calibration-measurement" | "mathematical-calibration-seal"
        | "mathematical-design-reference-stage" | "mathematical-review-asset";
      hardwareAccess: boolean;
      description: string;
      path?: string;
    }> = [
    { method: "GET", action: "status", hardwareAccess: false, description: "Read current local station bridge status." },
    { method: "GET", action: "preview-status", path: "/preview/status", hardwareAccess: false, description: "Read embedded browser preview stream status." },
    { method: "GET", action: "preview-stream", path: "/preview/stream", hardwareAccess: true, description: "Open token-gated local MJPEG browser preview stream." },
    { method: "GET", action: "lighting-status", path: "/lighting/status", hardwareAccess: false, description: "Read browser live Leimac lighting tuning status." },
    { method: "POST", action: "lighting-apply", path: "/lighting/apply", hardwareAccess: true, description: "Apply an explicit bounded Leimac duty for preview tuning." },
    { method: "POST", action: "lighting-heartbeat", path: "/lighting/heartbeat", hardwareAccess: false, description: "Keep browser live lighting watchdog alive while the operator page is connected." },
    { method: "POST", action: "mathematical-calibration-start", path: "/calibration/mathematical-v1/start", hardwareAccess: false, description: "Start or explicitly resume a purpose-bound non-production calibration capture session." },
    { method: "GET", action: "mathematical-calibration-status", path: "/calibration/mathematical-v1/status", hardwareAccess: false, description: "Read one exact calibration capture-session status." },
    { method: "POST", action: "mathematical-calibration-capture", path: "/calibration/mathematical-v1/capture", hardwareAccess: true, description: "Capture one allowlisted calibration step under bridge lock, watchdog, protected settings, and safe-off." },
    { method: "POST", action: "mathematical-calibration-measurement", path: "/calibration/mathematical-v1/measurement", hardwareAccess: false, description: "Record one instrument/operator/time-bound immutable physical measurement." },
    { method: "POST", action: "mathematical-calibration-seal", path: "/calibration/mathematical-v1/seal", hardwareAccess: false, description: "Fail closed unless the unique capture/metrology ledger is complete, then seal analyzer input and source package." },
    { method: "POST", action: "mathematical-design-reference-stage", path: "/mathematical-v1/design-reference-artifacts/{front|back}", hardwareAccess: false, description: "Stage one exact approved design-reference body through a token-gated, create-new, 64 MiB bounded, SHA-256 verified session route." },
    { method: "GET", action: "mathematical-review-asset", path: "/mathematical-v1/review-assets?reportId={reportId}&assetId={assetId}", hardwareAccess: false, description: "Read one exact hash-bound normalized, directional, ROI, segmentation, confidence, or illumination asset named by a pending Mathematical finding-review request." },
    { method: "POST", action: "start-session", hardwareAccess: true, description: "Create a local station session." },
    { method: "POST", action: "capture-front", hardwareAccess: true, description: "Validate the exact front preview snapshot, drain preview, and capture front evidence." },
    { method: "POST", action: "capture-back", hardwareAccess: true, description: "Validate the exact back preview snapshot, drain preview, and capture back evidence." },
    { method: "POST", action: "run-diagnostics", hardwareAccess: false, description: "Generate the unified provisional diagnostic report." },
    { method: "POST", action: "export-report-bundle", hardwareAccess: false, description: "Export the designated legacy V0 package or strict Mathematical V1 V0.3 body, external grading-session envelope, immutable assets, and checksums." },
    { method: "POST", action: "calculate-final-grade", hardwareAccess: false, description: "Calculate legacy V0 only for legacy sessions, or validate and return the exact four-element Mathematical V1 grade for explicitly designated calibrated sessions." },
    { method: "POST", action: "finalize-report", hardwareAccess: false, description: "Record operator finalization metadata and write the grading-contract-specific production release without cross-version fallback." },
    { method: "POST", action: "publish-report", hardwareAccess: false, description: "Prepare local publication manifest and future public report URL data." },
    { method: "POST", action: "generate-label-data", hardwareAccess: false, description: "Write label-ready JSON and QR payload URL data." },
    { method: "POST", action: "cancel-session", hardwareAccess: true, description: "Cancel the local station session and run guarded safe-off cleanup." },
    { method: "POST", action: "configure-rapid-capture", hardwareAccess: false, description: "Enable or disable the durable Rapid Capture throughput queue." },
    { method: "POST", action: "queue-current-card", hardwareAccess: false, description: "Queue persisted front/back evidence for serialized background report processing." },
    { method: "POST", action: "activate-queue-item", hardwareAccess: false, description: "Open one completed queued report for Approve & Publish." },
    { method: "POST", action: "bind-mathematical-grading-authority", hardwareAccess: false, description: "Bind exact Mathematical V1 card and centering/design-reference authority to a fresh Rapid continuation before capture; publication remains bridge-derived." },
    { method: "POST", action: "submit-mathematical-finding-reviews", hardwareAccess: false, description: "Submit explicit operator finding decisions bound to the exact pending review-request SHA-256 and rerun deterministically." },
    { method: "GET", action: "latest-report", hardwareAccess: false, description: "Read latest report location." },
    { method: "GET", action: "session-manifest", hardwareAccess: false, description: "Read station manifest path and state." },
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

async function recoveryPathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
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
    bridgeActionOverheadMs: 0,
    captureCommandMs: durationFor(["operator_preview", "capture_front", "capture_back"]),
    reportGenerationMs,
    safeOffMs,
    entries: allEntries,
    detailedEntries,
    phaseBreakdown,
    targetInterCaptureNote: "Warm full forensic runner is active with bridge-owned capture/process/report phases and full forensic evidence preserved.",
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
  return String(Math.max(1, Math.min(10, Math.floor(grade))));
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

function historyItemFromMathematicalBundle(input: {
  bundle: AiGraderReportBundleV03;
  gradingSessionId: string;
  productionRelease?: AiGraderMathematicalProductionReleaseV1;
  reportBundlePath?: string;
  productionReleasePath?: string;
  sessionDir?: string;
}): AiGraderLocalStationReportHistoryItem {
  const release = input.productionRelease;
  return {
    reportId: input.bundle.reportId,
    gradingSessionId: input.gradingSessionId,
    generatedAt: input.bundle.generatedAt,
    status: release?.reportStatus ?? "final_ai_grader_report_v1",
    viewerPath: reportRoute(input.bundle.reportId),
    reportBundlePath: input.reportBundlePath,
    productionReleasePath: input.productionReleasePath,
    sessionDir: input.sessionDir,
    finalOverallGrade: input.bundle.productionRelease.finalGrade.overall,
    confidenceBand: input.bundle.productionRelease.finalGrade.confidence.band,
    title: input.bundle.cardIdentity.title,
    warnings: release?.warnings ?? input.bundle.warnings ?? [],
  };
}

function isMathematicalReportBundle(bundle: AiGraderStationReportBundle | undefined): bundle is AiGraderReportBundleV03 {
  return bundle?.schemaVersion === "ai-grader-report-bundle-v0.3";
}

function isMathematicalProductionRelease(
  release: AiGraderStationProductionRelease | undefined,
): release is AiGraderMathematicalProductionReleaseV1 {
  return release?.schemaVersion === "ai-grader-mathematical-production-release-v1";
}

function gradingContractFor(manifest: Pick<AiGraderLocalStationBridgeManifest, "gradingContract" | "reportBundle">): AiGraderGradingContract {
  return manifest.gradingContract === "mathematical_calibration_v1" || isMathematicalReportBundle(manifest.reportBundle)
    ? "mathematical_calibration_v1"
    : "legacy_v0";
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
  const cleanBundle = { ...bundle } as AiGraderReportBundle & { productionRelease?: AiGraderProductionRelease };
  delete cleanBundle.productionRelease;
  const unfinalizedReportStatus = cleanBundle.reportStatus === "insufficient_evidence" || cleanBundle.reportStatus === "missing_report_data"
    ? cleanBundle.reportStatus
    : "provisional_diagnostic_ready";
  if (!productionRelease) {
    return {
      ...cleanBundle,
      reportStatus: unfinalizedReportStatus,
      finalStatus: "not_computed",
      finalGradeComputed: false,
      certifiedClaim: false,
      labelGenerated: false,
      qrGenerated: false,
      certificateGenerated: false,
    } as AiGraderReportBundle;
  }
  if (productionRelease.reportId !== bundle.reportId ||
      productionRelease.gradingSessionId !== bundle.gradingSessionId) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  return {
    ...cleanBundle,
    reportStatus: productionRelease.reportStatus,
    finalStatus: productionRelease.finalStatus as any,
    finalGradeComputed: productionRelease.finalGradeComputed as any,
    certifiedClaim: false,
    labelGenerated: productionRelease.labelDataGenerated as any,
    qrGenerated: productionRelease.qrPayloadGenerated as any,
    certificateGenerated: false,
    productionRelease,
  } as AiGraderReportBundle;
}

export interface AiGraderWarmForensicRunner {
  captureSide(input: FixedRigWarmEvidencePackageInput): Promise<FixedRigWarmSideCaptureBatch>;
  processSide(
    batch: FixedRigWarmSideCaptureBatch,
    context: { requestId: string; sessionId: string }
  ): Promise<FixedRigWarmProcessingResult>;
  cancelSession?(sessionId: string, reason?: string): Promise<void>;
  shutdownProcessingWorker?(reason?: string): Promise<void>;
  processingWorkerStatus?(): {
    active: boolean;
    pending: number;
    maxPending: number;
    maxConcurrency: 1;
    closed: boolean;
  };
}

function createDefaultWarmForensicRunner(config: AiGraderLocalStationBridgeConfig): AiGraderWarmForensicRunner {
  const processing = createFixedRigWarmForensicProcessingRunner({ allowedOutputRoot: config.outputDir });
  return {
    captureSide: captureFixedRigWarmSideBatch,
    processSide: processing.processSide,
    cancelSession: processing.cancelSession,
    shutdownProcessingWorker: processing.shutdownProcessingWorker,
    processingWorkerStatus: processing.processingWorkerStatus,
  };
}

function cloneManifest(manifest: AiGraderLocalStationBridgeManifest): AiGraderLocalStationBridgeManifest {
  return structuredClone(manifest);
}

const RAPID_CAPTURE_QUEUE_SCHEMA_VERSION = "ten-kings-ai-grader-rapid-capture-queue-v1" as const;
const RAPID_CAPTURE_QUEUE_LIMIT = 25;

export function retainAiGraderRapidCaptureQueueItems<T extends { state: AiGraderRapidCaptureWorkflowState }>(
  items: T[],
  limit = RAPID_CAPTURE_QUEUE_LIMIT,
): T[] {
  const protectedItems = items.filter((item) => item.state !== "published" && item.state !== "failed");
  const terminalAllowance = Math.max(0, limit - protectedItems.length);
  const retainedTerminal = new Set(
    items
      .filter((item) => item.state === "published" || item.state === "failed")
      .slice(0, terminalAllowance),
  );
  return items.filter(
    (item) => (item.state !== "published" && item.state !== "failed") || retainedTerminal.has(item),
  );
}

function rapidCaptureQueuePath(config: AiGraderLocalStationBridgeConfig) {
  return path.join(config.outputDir, "rapid-capture-queue.json");
}

function readRapidCaptureQueueSync(config: AiGraderLocalStationBridgeConfig): PersistedAiGraderRapidCaptureQueue {
  const empty = (): PersistedAiGraderRapidCaptureQueue => ({
    schemaVersion: RAPID_CAPTURE_QUEUE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    rapidCaptureEnabled: false,
    items: [],
  });
  try {
    const parsed = JSON.parse(readFileSync(rapidCaptureQueuePath(config), "utf-8")) as Partial<PersistedAiGraderRapidCaptureQueue>;
    if (parsed.schemaVersion !== RAPID_CAPTURE_QUEUE_SCHEMA_VERSION || !Array.isArray(parsed.items)) return empty();
    return {
      schemaVersion: RAPID_CAPTURE_QUEUE_SCHEMA_VERSION,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      rapidCaptureEnabled: parsed.rapidCaptureEnabled === true,
      items: retainAiGraderRapidCaptureQueueItems(parsed.items.filter(
        (item): item is PersistedAiGraderRapidCaptureQueueItem => Boolean(
          item
          && typeof item.queueItemId === "string"
          && typeof item.sessionId === "string"
          && typeof item.reportId === "string"
          && typeof item.manifestPath === "string",
        ),
      )),
    };
  } catch {
    return empty();
  }
}

function publicRapidCaptureQueueItem(item: PersistedAiGraderRapidCaptureQueueItem): AiGraderRapidCaptureQueueItem {
  const { manifestPath: _manifestPath, ...publicItem } = item;
  return publicItem;
}

function mathematicalRapidQueueSummary(
  execution: AiGraderLocalStationMathematicalExecutionV1 | undefined,
): AiGraderRapidCaptureQueueItem["mathematicalV1"] | undefined {
  if (!execution) return undefined;
  if (execution.status === "finding_review_required") {
    return {
      status: execution.status,
      reviewRequestSha256: execution.reviewRequest.artifactSha256,
    };
  }
  if (execution.status === "insufficient_evidence") {
    return {
      status: execution.status,
      failedStage: execution.failedStage,
      reasons: [...execution.reasons],
      requiresRecapture: execution.requiresRecapture,
      requiresApprovedDesignReference: execution.requiresApprovedDesignReference,
      requiresCalibration: execution.requiresCalibration,
      requiresImplementationCorrection: execution.requiresImplementationCorrection,
    };
  }
  return {
    status: execution.status,
    ...(execution.status === "processing" && execution.reviewRequestSha256
      ? { reviewRequestSha256: execution.reviewRequestSha256 }
      : {}),
  };
}

function timingRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function finiteTimingDuration(value: unknown): number | undefined {
  const duration = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function nestedTimingDuration(value: unknown, seen = new Set<object>()): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const durations = value.map((item) => nestedTimingDuration(item, seen)).filter((item): item is number => item !== undefined);
    return durations.length ? durations.reduce((sum, item) => sum + item, 0) : undefined;
  }
  const record = value as Record<string, unknown>;
  const direct = finiteTimingDuration(record.durationMs);
  if (direct !== undefined) return direct;
  const durations = Object.values(record)
    .map((item) => nestedTimingDuration(item, seen))
    .filter((item): item is number => item !== undefined);
  return durations.length ? durations.reduce((sum, item) => sum + item, 0) : undefined;
}

export class AiGraderLocalStationBridgeService {
  readonly config: AiGraderLocalStationBridgeConfig;
  readonly runner: AiGraderStationCommandRunner;
  readonly warmRunner: AiGraderWarmForensicRunner;
  readonly dependencies: AiGraderLocalStationBridgeDependencies;
  readonly stationUrl: string;
  private manifest: AiGraderLocalStationBridgeManifest;
  private previewProcess?: ChildProcessWithoutNullStreams;
  private previewStop?: (reason: string) => void;
  private captureLock?: { owner: string; acquiredAt: string };
  private warmProcessingJobs = new Map<string, Promise<FixedRigWarmProcessingResult>>();
  private processingSessionsCancelling = new Set<string>();
  private processingWorkerShutdown?: Promise<void>;
  private rapidQueue: PersistedAiGraderRapidCaptureQueue;
  private committedRapidQueue: PersistedAiGraderRapidCaptureQueue;
  private queuedManifests = new Map<string, AiGraderLocalStationBridgeManifest>();
  private reportWorker: Promise<void> = Promise.resolve();
  private queueWriteChain: Promise<void> = Promise.resolve();
  private activeQueueItemId?: string;
  private previewGeometryPending?: {
    frame: Buffer;
    frameIndex: number;
    frameCapturedAt: string;
    frameTimestampSource: "preview_capture_header" | "bridge_received";
    side: CardGeometrySide;
    sessionId: string;
    sideEpoch: string;
    frameId: string;
    epoch: number;
  };
  private previewGeometryAnalysisInFlight = false;
  private previewGeometryTimer?: ReturnType<typeof setTimeout>;
  private previewGeometryLastStartedAtMs = 0;
  private previewGeometryEpoch = 0;
  private previewStreamSequence = 0;
  private liveLightingWatchdog?: ReturnType<typeof setTimeout>;
  private leimacClient?: LeimacIdmuClient;
  private lightingWriteChain: Promise<void> = Promise.resolve();
  private previewObservations: AiGraderPreviewObservation[] = [];
  private frontCaptureOperations = new Map<string, AiGraderFrontCaptureOperation>();
  private frontCaptureInFlightKey?: string;
  private backCaptureOperations = new Map<string, AiGraderBackCaptureOperation>();
  private backCaptureInFlightKey?: string;
  private frontCaptureTransition?: {
    owner: string;
    promise: Promise<AiGraderLocalStationBridgeStatus>;
  };
  private atomicBackCaptureContext?: { owner: string; snapshot: AiGraderBackCaptureSnapshot };
  private atomicFrontCaptureContext?: { owner: string; snapshot: AiGraderFrontCaptureSnapshot };
  private closing = false;
  private terminalLifecycleChain: Promise<void> = Promise.resolve();
  private terminalLifecyclePending = 0;
  private lightingLifecycleChain: Promise<void> = Promise.resolve();
  private lightingLifecyclePending = 0;
  private readonly mathematicalCalibrationCaptureProducer?: FixedRigMathematicalCalibrationCaptureProducerV1;

  constructor(
    config: AiGraderLocalStationBridgeConfig,
    runner: AiGraderStationCommandRunner = createAiGraderStationCliRunner(),
    warmRunner: AiGraderWarmForensicRunner = createDefaultWarmForensicRunner(config),
    dependencies: AiGraderLocalStationBridgeDependencies = {}
  ) {
    this.config = config;
    this.runner = runner;
    this.warmRunner = warmRunner;
    this.dependencies = dependencies;
    this.stationUrl = `http://${hostForUrl(config.host)}:${config.port}`;
    this.rapidQueue = readRapidCaptureQueueSync(config);
    this.committedRapidQueue = structuredClone(this.rapidQueue);
    this.manifest = newManifest(config, this.rapidQueue.rapidCaptureEnabled);
    this.mathematicalCalibrationCaptureProducer = dependencies.mathematicalCalibrationCaptureProducer ?? (
      config.mathematicalCalibrationTargetPath &&
      config.mathematicalCalibrationTargetVersion &&
      config.mathematicalCalibrationTargetSha256
        ? new FixedRigMathematicalCalibrationCaptureProducerV1({
            outputRoot: config.mathematicalCalibrationOutputDir,
            targetPath: config.mathematicalCalibrationTargetPath,
            targetVersion: config.mathematicalCalibrationTargetVersion,
            targetSha256: config.mathematicalCalibrationTargetSha256,
            protectedSettings: {
              stationId: "local-dell-ai-grader-station",
              rigId: config.mathematicalCalibrationRigId,
              captureProfileVersion: FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
              cameraIndex: config.cameraIndex ?? 0,
              exposureUs: config.exposureUs,
              gain: config.gain,
              dutyPercent: config.duty,
              leimacUnit: config.leimacUnit ?? 1,
              selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
              normalizedWidthPx: 1200,
              normalizedHeightPx: 1680,
              checkerboard: { internalColumns: 11, internalRows: 16, cellMm: 5 },
            },
            capture: (input) => this.captureMathematicalCalibrationHardwareBoundary(input),
          })
        : undefined
    );
    void this.recoverPersistedRapidFinalization().catch(() => {});
  }

  private currentFrontCaptureBinding(): AiGraderFrontCaptureBinding | undefined {
    if (!this.manifest.sessionId || !this.manifest.reportId) return undefined;
    return {
      sessionId: this.manifest.sessionId,
      reportId: this.manifest.reportId,
      side: 'front',
      sideEpoch: this.manifest.previewStatus.sideEpoch,
    };
  }

  private deriveFrontCaptureReadiness(): AiGraderFrontCaptureReadiness {
    const binding = this.currentFrontCaptureBinding();
    const result = (
      code: AiGraderFrontCaptureReadinessCode,
      message: string,
      ready = false,
      profileIdentity?: string
    ): AiGraderFrontCaptureReadiness => ({
      ready,
      code,
      message,
      ...(binding ? { binding } : {}),
      ...(profileIdentity ? { profileIdentity } : {}),
    });
    if (!binding) return result('session_required', 'Start New Card to create an authoritative station session and report.');
    if (this.manifest.captureFailure || this.manifest.outputs.frontPackageDir) {
      return result('capture_blocked', 'Front capture is unavailable because this session already has evidence or a terminal capture/processing failure.');
    }
    if (gradingContractFor(this.manifest) === "mathematical_calibration_v1") {
      if (!this.manifest.mathematicalV1) {
        return result(
          'mathematical_authority_required',
          'Bind the exact Mathematical V1 card and centering/design-reference authority before Capture Front; publication remains bridge-derived.',
        );
      }
      const centering = this.manifest.mathematicalV1.gradingAuthority.sides.front.centering;
      if (centering.profile === "registered_design_template_v1" &&
          !this.manifest.mathematicalV1.stagedDesignReferences.front) {
        return result(
          'design_reference_staging_required',
          'Stage the exact approved Front design-reference bytes before Capture Front.',
        );
      }
    }
    if (
      this.closing
      || this.frontCaptureTransition
      || this.frontCaptureInFlightKey
      || this.captureLock
      || this.manifest.previewStatus.intentionalTransition.active
      || this.terminalLifecyclePending > 0
      || this.lightingLifecyclePending > 0
    ) {
      return result('lifecycle_pending', 'Wait for the current transition, capture, cleanup, lighting, or safe-off request to finish.');
    }
    const profileIdentity = this.manifest.liveLighting.profile.candidateProfileIdentity;
    if (!this.positioningLightingVerificationComplete(this.manifest.acceptedProfile)) {
      return result(
        'safety_state_unverified',
        'Capture Front requires complete controller acknowledgement of the current bounded lighting profile.',
        false,
        profileIdentity
      );
    }
    if (this.manifest.currentStep !== 'capture_front') {
      return result('current_step_not_capture_front', `Start Grading requires bridge step capture_front; current step is ${this.manifest.currentStep}.`, false, profileIdentity);
    }
    if (
      this.manifest.previewStatus.activeSide !== 'front'
      || this.manifest.previewStatus.sessionId !== binding.sessionId
      || this.manifest.previewStatus.sideEpoch !== binding.sideEpoch
    ) {
      return result('front_binding_stale', 'The live preview does not match the accepted session/report/front epoch. Reconnect to the current bridge state.', false, profileIdentity);
    }
    if (
      this.manifest.previewStatus.status !== 'live'
      || this.manifest.previewStatus.cameraOwnership !== 'preview_stream'
    ) {
      return result('live_preview_required', 'Wait for the current session-bound Front preview to become live before Start Grading.', false, profileIdentity);
    }
    return result('ready', 'The exact current Front frame and acknowledged lighting profile are ready.', true, profileIdentity);
  }

  status(): AiGraderLocalStationBridgeStatus {
    this.refreshPreviewGeometryActiveSide();
    const nextAction = NEXT_ACTION_BY_STEP[this.manifest.currentStep];
    const reportId = this.manifest.reportId;
    const viewerRoute = reportRoute(reportId);
    const reportReady = Boolean(this.manifest.outputs.unifiedReportPath);
    const latestHistoryReport = reportReady ? undefined : latestReportFromHistorySync(this.config.outputDir);
    return {
      ok: true,
      bridgeVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
      reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
      localOnly: true,
      loginRequired: false,
      frontCaptureReadiness: this.deriveFrontCaptureReadiness(),
      hardwareActionsEnabled: this.config.mode === "real",
      mathematicalCalibration: mathematicalCalibrationReadiness(
        this.config,
        this.dependencies.loadMathematicalCalibrationBundle ??
          loadFixedRigMathematicalCalibrationBundleV1,
      ),
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
      bridgeContract: {
        gradingContracts: ["legacy_v0", "mathematical_calibration_v1"],
        mathematicalV1: {
          reportBundleSchemaVersion: "ai-grader-report-bundle-v0.3",
          envelopeVersion: AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_V1_VERSION,
          packageVersion: AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_V1_VERSION,
          productionReleaseVersion: AI_GRADER_MATHEMATICAL_PRODUCTION_RELEASE_V1_VERSION,
          gradingSessionIdentity: "external_envelope",
          packageIntegrity: "atomic_non_overwriting_sha256",
          fallbackPolicy: "explicit_not_ready_no_v0_or_manual_fallback",
        },
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
      rapidCaptureQueue: {
        enabled: this.committedRapidQueue.rapidCaptureEnabled,
        ...(this.activeQueueItemId ? { activeQueueItemId: this.activeQueueItemId } : {}),
        persisted: true,
        reportWorkerSerialized: true,
        items: this.committedRapidQueue.items.map(publicRapidCaptureQueueItem),
      },
      ...this.manifest,
    };
  }

  previewStatus(): AiGraderLocalStationPreviewStatus {
    this.refreshPreviewGeometryActiveSide();
    return this.manifest.previewStatus;
  }

  liveLightingStatus(): AiGraderLiveLightingStatus {
    return this.manifest.liveLighting;
  }

  private ensureCaptureTiming(manifest: AiGraderLocalStationBridgeManifest) {
    const captureProfile: FixedRigCaptureProfile = manifest.captureProfile === "production_fast" ? "production_fast" : "full_forensic";
    if (!manifest.captureTiming || manifest.captureTiming.schemaVersion !== "ten-kings-ai-grader-capture-timing-v1") {
      manifest.captureTiming = createAiGraderCaptureTimingMetadata({
        captureProfile,
        hardwareMeasurement: false,
        startedAt: manifest.createdAt ?? manifest.updatedAt,
      });
    }
    manifest.captureTimingHardwareEvidence ??= {
      front: { captureBatch: false, processedManifest: false },
      back: { captureBatch: false, processedManifest: false },
    };
    manifest.captureTiming.captureProfile = captureProfile;
    manifest.captureTiming.hardwareMeasurement = (["front", "back"] as const).every((side) =>
      manifest.captureTimingHardwareEvidence[side].captureBatch
      && manifest.captureTimingHardwareEvidence[side].processedManifest
    );
    manifest.captureTiming = cloneAiGraderCaptureTiming(manifest.captureTiming);
    if (manifest.captureProfileGuard) {
      manifest.captureProfileGuard.fiveSecondTargetProven = manifest.captureTiming.target.fiveSecondsPerSideProven;
    }
    return manifest.captureTiming;
  }

  private recordCaptureTimingEvent(
    manifest: AiGraderLocalStationBridgeManifest,
    input: Parameters<typeof recordAiGraderCaptureTimingEvent>[1]
  ) {
    const timing = this.ensureCaptureTiming(manifest);
    recordAiGraderCaptureTimingEvent(timing, input);
    this.ensureCaptureTiming(manifest);
  }

  private recordCaptureTimingPhase(
    manifest: AiGraderLocalStationBridgeManifest,
    input: Parameters<typeof recordAiGraderCaptureTimingPhase>[1]
  ) {
    const timing = this.ensureCaptureTiming(manifest);
    recordAiGraderCaptureTimingPhase(timing, input);
    this.ensureCaptureTiming(manifest);
  }

  private captureTimingSnapshot(manifest: AiGraderLocalStationBridgeManifest): Record<string, any> {
    return cloneAiGraderCaptureTiming(this.ensureCaptureTiming(manifest)) as unknown as Record<string, any>;
  }

  private geometryCaptureDecisionSnapshot(manifest: AiGraderLocalStationBridgeManifest): Record<string, any> {
    const snapshot: Record<string, any> = {};
    for (const side of ["front", "back"] as const) {
      const decision = manifest.geometryCaptureDecisions?.[side];
      if (!decision) continue;
      snapshot[side] = {
        mode: decision.mode,
        placementState: decision.placementState,
        timestamp: decision.timestamp,
        explicitOperatorAction: decision.explicitOperatorAction,
        detectionUsed: decision.detectionUsed,
        manualOverrideUsed: decision.manualOverrideUsed,
        ...(decision.sourceFrameId ? { sourceFrameId: decision.sourceFrameId } : {}),
      };
    }
    return snapshot;
  }

  private async captureTimingSnapshotForReport(reportId: string, sessionDir?: string): Promise<Record<string, any> | undefined> {
    if (this.manifest.reportId === reportId) return this.captureTimingSnapshot(this.manifest);
    if (!sessionDir) return undefined;
    const persisted = await readJsonFile(path.join(sessionDir, "station-session.json")) as AiGraderLocalStationBridgeManifest | undefined;
    return persisted?.reportId === reportId ? this.captureTimingSnapshot(persisted) : undefined;
  }

  private async geometryCaptureDecisionSnapshotForReport(reportId: string, sessionDir?: string): Promise<Record<string, any> | undefined> {
    if (this.manifest.reportId === reportId) return this.geometryCaptureDecisionSnapshot(this.manifest);
    if (!sessionDir) return undefined;
    const persisted = await readJsonFile(path.join(sessionDir, "station-session.json")) as AiGraderLocalStationBridgeManifest | undefined;
    return persisted?.reportId === reportId ? this.geometryCaptureDecisionSnapshot(persisted) : undefined;
  }

  private recoverySourceFromManifest(
    manifest: AiGraderLocalStationBridgeManifest,
    reportId: string,
    sessionManifestPath: string,
  ): AiGraderReportRecoverySource | undefined {
    if (manifest.reportId !== reportId || !manifest.sessionId) return undefined;
    const reportDir = manifest.outputs.unifiedReportDir ?? dirnameIfFile(manifest.outputs.unifiedReportPath);
    if (!reportDir || !isSubpath(reportDir, this.config.outputDir) ||
        !isSubpath(sessionManifestPath, this.config.outputDir)) return undefined;
    return { manifest, reportDir: path.resolve(reportDir), sessionManifestPath: path.resolve(sessionManifestPath) };
  }

  private async findReportRecoverySource(reportId: string): Promise<AiGraderReportRecoverySource | undefined> {
    const activeManifestPath = this.manifest.outputs.manifestPath ??
      (this.manifest.outputs.sessionDir ? path.join(this.manifest.outputs.sessionDir, "station-session.json") : undefined);
    if (activeManifestPath) {
      const active = this.recoverySourceFromManifest(this.manifest, reportId, activeManifestPath);
      if (active) return active;
    }
    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      entries = await readdir(this.config.outputDir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionManifestPath = path.join(this.config.outputDir, entry.name, "station-session.json");
      const persisted = await readJsonFile(sessionManifestPath) as AiGraderLocalStationBridgeManifest | undefined;
      if (!persisted) continue;
      const source = this.recoverySourceFromManifest(persisted, reportId, sessionManifestPath);
      if (source) return source;
    }
    return undefined;
  }

  private async findStationManifestForReport(
    reportId: string,
  ): Promise<{ manifest: AiGraderLocalStationBridgeManifest; manifestPath?: string } | undefined> {
    if (this.manifest.reportId === reportId) {
      return { manifest: this.manifest, manifestPath: this.manifest.outputs.manifestPath };
    }
    for (const queued of this.queuedManifests.values()) {
      if (queued.reportId === reportId) return { manifest: queued, manifestPath: queued.outputs.manifestPath };
    }
    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      entries = await readdir(this.config.outputDir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.config.outputDir, entry.name, "station-session.json");
      const manifest = await readJsonFile(manifestPath) as AiGraderLocalStationBridgeManifest | undefined;
      if (manifest?.reportId === reportId) return { manifest, manifestPath };
    }
    return undefined;
  }

  private assertMathematicalPackagePathAllowed(packagePath: string): string {
    const resolved = path.resolve(packagePath);
    const allowedRoots = [path.resolve(this.config.outputDir), path.resolve(reportBundleRootDir(this.config))];
    if (!allowedRoots.some((root) => isSubpath(resolved, root))) {
      throw new Error("Mathematical Grading V1 package path must stay within the configured station or report-package output root.");
    }
    return resolved;
  }

  private assertMathematicalPackageIdentity(
    reportPackage: AiGraderMathematicalReportPackageV1,
    manifest: AiGraderLocalStationBridgeManifest,
  ): void {
    if (!manifest.reportId || !manifest.sessionId ||
      reportPackage.envelope.reportBundle.reportId !== manifest.reportId ||
      reportPackage.envelope.gradingSessionId !== manifest.sessionId) {
      throw new Error("Mathematical Grading V1 package identity did not match the exact station report and external grading session.");
    }
  }

  private applyMathematicalReportPackage(
    manifest: AiGraderLocalStationBridgeManifest,
    reportPackage: AiGraderMathematicalReportPackageV1,
  ): void {
    this.assertMathematicalPackageIdentity(reportPackage, manifest);
    manifest.gradingContract = "mathematical_calibration_v1";
    manifest.outputs.reportBundlePath = reportPackage.bundlePath;
    manifest.outputs.mathematicalReportBundlePath = reportPackage.bundlePath;
    manifest.outputs.mathematicalReportEnvelopePath = reportPackage.envelopePath;
    manifest.outputs.publishPackageDir = reportPackage.outputDir;
    manifest.outputs.assetManifestPath = reportPackage.assetManifestPath;
    manifest.outputs.checksumsPath = reportPackage.checksumsPath;
    manifest.reportBundle = reportPackage.envelope.reportBundle;
  }

  private async resolveMathematicalReportPackage(
    manifest: AiGraderLocalStationBridgeManifest,
    request: AiGraderLocalStationBridgeActionRequest,
  ): Promise<AiGraderMathematicalReportPackageV1> {
    if (!manifest.reportId || !manifest.sessionId) {
      throw new Error("Mathematical Grading V1 requires one exact report and external grading-session identity.");
    }
    if (request.mathematicalReportPackagePath && request.mathematicalReportEnvelope) {
      throw new Error("Provide either a Mathematical V1 package path or a V0.3 body envelope, not both.");
    }
    if (request.mathematicalReportPackagePath) {
      const reportPackage = await readAiGraderMathematicalReportPackageV1(
        this.assertMathematicalPackagePathAllowed(request.mathematicalReportPackagePath),
      );
      this.assertMathematicalPackageIdentity(reportPackage, manifest);
      return reportPackage;
    }
    if (request.mathematicalReportEnvelope) {
      const envelope = buildAiGraderMathematicalReportEnvelopeV1({
        gradingSessionId: request.mathematicalReportEnvelope.gradingSessionId,
        reportBundle: request.mathematicalReportEnvelope.reportBundle,
      });
      if (envelope.gradingSessionId !== manifest.sessionId || envelope.reportBundle.reportId !== manifest.reportId) {
        throw new Error("Mathematical Grading V1 body envelope did not match the exact active station report and grading session.");
      }
      const artifact: AiGraderMathematicalReportBundleV1Artifact = {
        adapterVersion: AI_GRADER_MATHEMATICAL_REPORT_ADAPTER_V1_VERSION,
        bundle: envelope.reportBundle,
        assetPayloads: decodeAiGraderMathematicalAssetPayloadsV1(request.mathematicalAssetPayloads ?? []),
      };
      return writeAiGraderMathematicalReportPackageV1({
        gradingSessionId: manifest.sessionId,
        artifact,
        outputDir: mathematicalPublishPackageDir(this.config, manifest.reportId),
      });
    }
    const existingPath = manifest.outputs.mathematicalReportEnvelopePath ??
      manifest.outputs.mathematicalReportBundlePath ??
      (manifest.outputs.reportBundlePath?.endsWith("report-bundle-v0.3.json")
        ? manifest.outputs.reportBundlePath
        : undefined);
    if (existingPath) {
      const reportPackage = await readAiGraderMathematicalReportPackageV1(
        this.assertMathematicalPackagePathAllowed(existingPath),
      );
      this.assertMathematicalPackageIdentity(reportPackage, manifest);
      return reportPackage;
    }
    const canonicalDir = mathematicalPublishPackageDir(this.config, manifest.reportId);
    if (await exists(canonicalDir)) {
      const reportPackage = await readAiGraderMathematicalReportPackageV1(canonicalDir);
      this.assertMathematicalPackageIdentity(reportPackage, manifest);
      return reportPackage;
    }
    throw new Error(
      "Mathematical Grading V1 is not ready: provide the completed strict V0.3 body plus every immutable asset payload, or a checksum-verified package path. V0/manual fallback is prohibited.",
    );
  }

  private async mathematicalReportBundleResponse(
    expectedReportId: string,
  ): Promise<{
    reportId: string;
    gradingSessionId: string;
    gradingContract: "mathematical_calibration_v1";
    bundle: AiGraderReportBundleV03;
    source: string;
  }> {
    const source = await this.findStationManifestForReport(expectedReportId);
    if (!source || gradingContractFor(source.manifest) !== "mathematical_calibration_v1") {
      throw new Error("Mathematical Grading V1 report " + expectedReportId + " is not available.");
    }
    const reportPackage = await this.resolveMathematicalReportPackage(source.manifest, {});
    this.applyMathematicalReportPackage(source.manifest, reportPackage);
    if (source.manifestPath) await writeJsonAtomic(source.manifestPath, source.manifest);
    return {
      reportId: expectedReportId,
      gradingSessionId: reportPackage.envelope.gradingSessionId,
      gradingContract: "mathematical_calibration_v1",
      bundle: reportPackage.envelope.reportBundle,
      source: "checksum_verified_mathematical_v1_package",
    };
  }

  private async applyRecoveredReportPackage(
    source: AiGraderReportRecoverySource,
    result: RecoverAiGraderReportPackageResult,
  ) {
    const manifest = source.manifest;
    manifest.outputs.reportBundlePath = result.bundlePath;
    manifest.outputs.assetManifestPath = result.assetManifestPath;
    manifest.outputs.checksumsPath = result.checksumsPath;
    manifest.outputs.publishPackageDir = result.outputDir;
    manifest.reportBundle = result.bundle;
    if (result.productionRelease) {
      manifest.outputs.productionReleasePath = result.productionReleasePath;
      manifest.outputs.labelDataPath = result.labelDataPath;
      manifest.outputs.publicationManifestPath = result.publicationManifestPath;
      manifest.outputs.integrationContractPath = result.integrationContractPath;
      manifest.productionRelease = result.productionRelease;
      manifest.safety.finalGradeComputed = result.productionRelease.finalGradeComputed;
      manifest.safety.labelGenerated = result.productionRelease.labelDataGenerated;
      manifest.safety.qrGenerated = result.productionRelease.qrPayloadGenerated;
    } else {
      manifest.outputs.productionReleasePath = undefined;
      manifest.outputs.labelDataPath = undefined;
      manifest.outputs.publicationManifestPath = undefined;
      manifest.outputs.integrationContractPath = undefined;
      manifest.productionRelease = undefined;
      manifest.safety.finalGradeComputed = false;
      manifest.safety.labelGenerated = false;
      manifest.safety.qrGenerated = false;
    }
    manifest.progressLog.push(new Date().toISOString() + " Existing report derived package safely recovered for Confirm Card and Publish.");
    if (this.manifest.reportId === manifest.reportId && this.manifest.sessionId === manifest.sessionId) {
      this.manifest = manifest;
    }
    await writeJsonAtomic(source.sessionManifestPath, manifest);
  }

  private async recoverReportBundleIfNeeded(input: {
    reportId: string;
    bundle: AiGraderReportBundle;
    packageDir: string;
  }) {
    const source = await this.findReportRecoverySource(input.reportId);
    if (!source || source.manifest.sessionId !== input.bundle.gradingSessionId ||
        typeof input.bundle.localReportFolder !== "string" ||
        path.resolve(input.bundle.localReportFolder) !== path.resolve(source.reportDir)) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    const productionRelease = await readAiGraderReportPackageReleaseEvidence({
      packageDir: input.packageDir,
      bundle: input.bundle,
    });
    const needsRecovery = await aiGraderReportBundleNeedsRecovery(input.bundle, source?.reportDir, input.packageDir);
    if (!needsRecovery) return { ...input, productionRelease, recovered: false as const };
    const result = await recoverAiGraderReportPackage({
      canonicalDir: publishPackageDir(this.config, input.reportId),
      reportDir: source.reportDir,
      reportId: input.reportId,
      gradingSessionId: input.bundle.gradingSessionId,
      previousBundle: input.bundle,
      previousRelease: productionRelease,
      publicBasePath: this.config.publicBasePath,
      publicBaseUrl: this.config.publicBasePath?.startsWith("http") ? this.config.publicBasePath : undefined,
      captureTiming: this.captureTimingSnapshot(source.manifest),
      geometryCaptureDecisions: this.geometryCaptureDecisionSnapshot(source.manifest),
    });
    await this.applyRecoveredReportPackage(source, result);
    return {
      reportId: input.reportId,
      bundle: result.bundle,
      productionRelease: result.productionRelease,
      recovered: true as const,
    };
  }

  private recordGeometryCaptureDecision(
    manifest: AiGraderLocalStationBridgeManifest,
    side: AiGraderWarmRunnerSide,
    request: Pick<AiGraderLocalStationBridgeActionRequest, "captureTriggerMode" | "geometryCaptureMode">,
    timestamp: string
  ) {
    const triggerMode = parseCaptureTriggerMode(request.captureTriggerMode);
    const requestedMode = request.geometryCaptureMode ?? "detected_geometry";
    if (requestedMode !== "detected_geometry") {
      throw new Error("AI Grader geometry capture mode must be detected_geometry.");
    }
    const geometry = manifest.previewStatus.cardGeometry[side];
    const placementState = geometry?.placementState ?? "not_detected";
    const detectedCorners = geometry?.detectedCorners ?? geometry?.corners;
    const detectedPoints = detectedCorners
      ? [detectedCorners.topLeft, detectedCorners.topRight, detectedCorners.bottomRight, detectedCorners.bottomLeft]
      : [];
    const decisionAtMs = Date.parse(timestamp);
    const geometryAtMs = Date.parse(geometry?.timestamp ?? "");
    const geometryAgeMs = decisionAtMs - geometryAtMs;
    const geometryFresh = Number.isFinite(geometryAtMs)
      && Number.isFinite(decisionAtMs)
      && geometryAgeMs >= -250
      && geometryAgeMs <= PREVIEW_GEOMETRY_MAX_AGE_MS;
    const validDetectedGeometry = placementState === "ready"
      && geometry?.side === side
      && geometry?.sessionId === manifest.sessionId
      && geometry?.sideEpoch === manifest.previewStatus.sideEpoch
      && manifest.previewStatus.activeSide === side
      && geometry?.geometrySource === "detected"
      && geometry.detectionUsed === true
      && geometry.manualOverrideUsed !== true
      && geometryFresh
      && detectedPoints.length === 4
      && detectedPoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      && Boolean(geometry.boundingBox)
      && Number.isFinite(geometry.boundingBox?.x)
      && Number.isFinite(geometry.boundingBox?.y)
      && Number.isFinite(geometry.boundingBox?.width)
      && Number.isFinite(geometry.boundingBox?.height)
      && Number(geometry.boundingBox?.width) > 0
      && Number(geometry.boundingBox?.height) > 0;
    if (!validDetectedGeometry) {
      const freshnessDetail = geometry && !geometryFresh
        ? ` The latest detected frame is stale (${Number.isFinite(geometryAgeMs) ? Math.max(0, Math.round(geometryAgeMs)) : "unknown"} ms old); wait for a fresh live outline.`
        : "";
      throw new Error(`AI Grader ${side} capture requires a fresh, valid Ready detected-geometry state; current state is ${placementState}.${freshnessDetail}`);
    }
    const sourceFrameId = typeof geometry?.sourceFrameId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(geometry.sourceFrameId)
      ? geometry.sourceFrameId
      : undefined;
    manifest.geometryCaptureDecisions[side] = {
      mode: requestedMode,
      placementState,
      timestamp,
      explicitOperatorAction: triggerMode === "operator",
      detectionUsed: geometry?.detectionUsed === true,
      manualOverrideUsed: false,
      ...(sourceFrameId ? { sourceFrameId } : {}),
    };
    manifest.progressLog.push(
      `${timestamp} ${side} capture geometry decision: detected geometry at ${placementState}.`
    );
  }

  private recordProcessedSideTiming(
    manifest: AiGraderLocalStationBridgeManifest,
    side: AiGraderWarmRunnerSide,
    result: FixedRigWarmEvidencePackageResult,
    completedAt = new Date().toISOString()
  ) {
    this.recordCaptureTimingEvent(manifest, { id: "side_processing_completed", side, at: completedAt });
    const capture = timingRecord(result.manifest.captureTiming);
    const processing = timingRecord(result.manifest.processingTiming);
    manifest.captureTimingHardwareEvidence[side].processedManifest = capture?.hardwareMeasurement === true;
    const processingPhases = timingRecord(processing?.phases);
    const phaseValues: Array<[Parameters<typeof recordAiGraderCaptureTimingPhase>[1]["id"], number | undefined]> = [
      ["lighting_profile", nestedTimingDuration(capture?.lightingProfileChanges)],
      ["frame_capture", finiteTimingDuration(capture?.frameCaptureMs)],
      ["file_writes", finiteTimingDuration(capture?.fileWritesMs)],
      ["file_hashes", finiteTimingDuration(capture?.fileHashMs)],
      ["crop_deskew", finiteTimingDuration(timingRecord(processingPhases?.cropDeskew)?.durationMs)],
      ["grading_forensic_runner", finiteTimingDuration(capture?.gradingForensicRunnerMs)],
      ["side_processing", finiteTimingDuration(processing?.totalDurationMs)],
    ];
    for (const [id, durationMs] of phaseValues) {
      if (durationMs === undefined) continue;
      this.recordCaptureTimingPhase(manifest, { id, side, durationMs });
    }
    if (finiteTimingDuration(processing?.totalDurationMs) === undefined) {
      const startedAt = manifest.captureTiming.events.find((event) => event.id === "side_processing_started" && event.side === side)?.at;
      const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
      const completedAtMs = Date.parse(completedAt);
      if (Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) && completedAtMs >= startedAtMs) {
        this.recordCaptureTimingPhase(manifest, {
          id: "side_processing",
          side,
          durationMs: completedAtMs - startedAtMs,
          startedAt,
          finishedAt: completedAt,
        });
      }
    }
  }

  private refreshPreviewGeometryActiveSide() {
    const geometry = this.manifest.previewStatus.cardGeometry ?? defaultPreviewGeometryStatus(this.config);
    const activeSide = activePreviewGeometrySide(this.manifest.currentStep);
    if (
      geometry.activeSide === activeSide
      && this.manifest.previewStatus.activeSide === activeSide
      && this.manifest.previewStatus.cardGeometry
    ) return;
    this.manifest.previewStatus.activeSide = activeSide;
    this.manifest.previewStatus.cardGeometry = { ...geometry, activeSide };
  }

  private serializeTerminalLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    this.terminalLifecyclePending += 1;
    const run = this.terminalLifecycleChain.catch(() => {}).then(operation);
    this.terminalLifecycleChain = run.then(() => undefined, () => undefined);
    return run.finally(() => {
      this.terminalLifecyclePending = Math.max(0, this.terminalLifecyclePending - 1);
    });
  }

  private currentAtomicBackCapturePromise() {
    if (!this.backCaptureInFlightKey) return undefined;
    return this.backCaptureOperations.get(this.backCaptureInFlightKey)?.promise;
  }

  private currentAtomicFrontCapturePromise() {
    if (!this.frontCaptureInFlightKey) return undefined;
    return this.frontCaptureOperations.get(this.frontCaptureInFlightKey)?.promise;
  }

  private serializeLightingLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    this.lightingLifecyclePending += 1;
    const run = this.lightingLifecycleChain.catch(() => {}).then(operation);
    this.lightingLifecycleChain = run.then(() => undefined, () => undefined);
    return run.finally(() => {
      this.lightingLifecyclePending = Math.max(0, this.lightingLifecyclePending - 1);
    });
  }

  private awaitLightingLifecycleIdle() {
    return this.lightingLifecycleChain.catch(() => undefined);
  }

  private transitionPreviewSide(side: CardGeometrySide, options: { preserveFrontGeometry?: boolean } = {}) {
    this.previewGeometryEpoch += 1;
    this.previewObservations = [];
    this.previewGeometryPending = undefined;
    if (this.previewGeometryTimer) clearTimeout(this.previewGeometryTimer);
    this.previewGeometryTimer = undefined;
    this.previewGeometryLastStartedAtMs = 0;
    const sessionId = this.manifest.sessionId;
    const sideEpoch = buildPreviewSideEpoch(sessionId, side, this.previewGeometryEpoch);
    const historicalFront = options.preserveFrontGeometry
      ? this.manifest.previewStatus.cardGeometry?.front
      : undefined;
    this.updatePreviewStatus({
      sessionId,
      activeSide: side,
      sideEpoch,
      intentionalTransition: { active: false },
      latestFrameId: undefined,
      positioningLightReady: false,
      frameCount: 0,
      fps: undefined,
      firstFrameAt: undefined,
      lastFrameAt: undefined,
    });
    this.manifest.previewStatus.cardGeometry = {
      ...defaultPreviewGeometryStatus(this.config, { sessionId, side, sideEpoch }),
      ...(historicalFront ? { front: historicalFront } : {}),
    };
    this.updateBackPositioningLight({
      sessionId,
      sideEpoch,
      captureReady: false,
      captureAuthorization: undefined,
    });
  }

  private prunePreviewObservations(nowMs = Date.now()) {
    this.previewObservations = this.previewObservations
      .filter((observation) => {
        const capturedAtMs = Date.parse(observation.capturedAt);
        return Number.isFinite(capturedAtMs)
          && capturedAtMs <= nowMs
          && nowMs - capturedAtMs <= PREVIEW_GEOMETRY_MAX_AGE_MS;
      })
      .slice(-PREVIEW_OBSERVATION_LIMIT);
  }

  private retainPreviewObservation(
    binding: { sessionId: string; side: CardGeometrySide; sideEpoch: string },
    frameId: string,
    capturedAt: string
  ) {
    const capturedAtMs = Date.parse(capturedAt);
    const nowMs = Date.now();
    if (
      !Number.isFinite(capturedAtMs)
      || capturedAtMs > nowMs
      || nowMs - capturedAtMs > PREVIEW_GEOMETRY_MAX_AGE_MS
    ) return false;
    this.prunePreviewObservations();
    const existing = this.previewObservations.find((observation) =>
      observation.sessionId === binding.sessionId
      && observation.side === binding.side
      && observation.sideEpoch === binding.sideEpoch
      && observation.frameId === frameId
    );
    if (existing) {
      existing.capturedAt = capturedAt;
      existing.receivedAt = new Date().toISOString();
    } else {
      this.previewObservations.push({
        ...binding,
        frameId,
        capturedAt,
        receivedAt: new Date().toISOString(),
      });
    }
    this.previewObservations = this.previewObservations.slice(-PREVIEW_OBSERVATION_LIMIT);
    return true;
  }

  private retainPreviewGeometryObservation(
    geometry: CardGeometryMetadata & { sessionId: string; sideEpoch: string }
  ) {
    if (!geometry.sourceFrameId) return false;
    const geometryAtMs = Date.parse(geometry.timestamp);
    const nowMs = Date.now();
    if (
      !Number.isFinite(geometryAtMs)
      || geometryAtMs > nowMs
      || nowMs - geometryAtMs > PREVIEW_GEOMETRY_MAX_AGE_MS
    ) return false;
    this.prunePreviewObservations();
    const observation = this.previewObservations.find((candidate) =>
      candidate.sessionId === geometry.sessionId
      && candidate.side === geometry.side
      && candidate.sideEpoch === geometry.sideEpoch
      && candidate.frameId === geometry.sourceFrameId
    );
    if (!observation) return false;
    observation.geometry = structuredClone(geometry);
    return true;
  }

  private previewObservation(side: CardGeometrySide, frameId: string) {
    this.prunePreviewObservations();
    return this.previewObservations.find((observation) =>
      observation.sessionId === this.manifest.sessionId
      && observation.side === side
      && observation.sideEpoch === this.manifest.previewStatus.sideEpoch
      && observation.frameId === frameId
    );
  }

  private postRestoreBackPreviewObservation(frameId: string | undefined) {
    if (!frameId) return undefined;
    const observation = this.previewObservation("back", frameId);
    const verifiedAtMs = Date.parse(this.manifest.liveLighting.physicalState.verifiedAt ?? "");
    const capturedAtMs = Date.parse(observation?.capturedAt ?? "");
    const receivedAtMs = Date.parse(observation?.receivedAt ?? "");
    if (
      !observation
      || !Number.isFinite(verifiedAtMs)
      || !Number.isFinite(capturedAtMs)
      || !Number.isFinite(receivedAtMs)
      || capturedAtMs < verifiedAtMs
      || receivedAtMs < verifiedAtMs
    ) return undefined;
    return observation;
  }

  private validateAtomicFrontCaptureRequest(request: AiGraderLocalStationBridgeActionRequest) {
    const allowedKeys = new Set([
      "idempotencyKey",
      "expectedSessionId",
      "expectedReportId",
      "expectedSide",
      "expectedSideEpoch",
      "expectedFrameId",
      "geometryCaptureMode",
      "captureTriggerMode",
      "captureTriggerAt",
    ]);
    const unexpected = Object.keys(request as Record<string, unknown>).filter((key) => !allowedKeys.has(key));
    if (unexpected.length > 0) {
      throw new Error("Atomic Front Capture accepts only bounded idempotency, session/report/side/epoch/frame, mode, and trigger assertions.");
    }
    if (
      !request.idempotencyKey
      || !ATOMIC_CAPTURE_IDEMPOTENCY_KEY_RE.test(request.idempotencyKey)
      || ATOMIC_CAPTURE_PRIVATE_ASSERTION_RE.test(request.idempotencyKey)
    ) {
      throw new Error("Atomic Front Capture requires a 16-128 character bounded idempotency key.");
    }
    const requiredStrings = [request.expectedSessionId, request.expectedReportId, request.expectedSideEpoch, request.expectedFrameId];
    if (requiredStrings.some((value) =>
      typeof value !== "string"
      || !ATOMIC_CAPTURE_ASSERTION_RE.test(value)
      || ATOMIC_CAPTURE_PRIVATE_ASSERTION_RE.test(value)
    )) {
      throw new Error("Atomic Front Capture requires path-free bounded expected session/report/epoch/frame assertions.");
    }
    if (request.expectedSide !== "front") throw new Error("Atomic Front Capture expectedSide must be front.");
    if (request.geometryCaptureMode !== "detected_geometry") {
      throw new Error("Capture Front requires detected_geometry mode.");
    }
    if (request.captureTriggerMode !== "operator" && request.captureTriggerMode !== "auto") {
      throw new Error("Atomic Front Capture requires an explicit operator or auto captureTriggerMode assertion.");
    }
    const captureTriggerMode = parseCaptureTriggerMode(request.captureTriggerMode);
    if (
      typeof request.captureTriggerAt !== "string"
      || request.captureTriggerAt.length > 40
      || !Number.isFinite(Date.parse(request.captureTriggerAt))
      || new Date(request.captureTriggerAt).toISOString() !== request.captureTriggerAt
    ) {
      throw new Error("Atomic Front Capture requires an explicit canonical ISO captureTriggerAt assertion.");
    }
    return {
      idempotencyKey: request.idempotencyKey,
      expectedSessionId: request.expectedSessionId!,
      expectedReportId: request.expectedReportId!,
      expectedSide: "front" as const,
      expectedSideEpoch: request.expectedSideEpoch!,
      expectedFrameId: request.expectedFrameId!,
      geometryCaptureMode: request.geometryCaptureMode,
      captureTriggerMode,
      captureTriggerAt: request.captureTriggerAt,
    };
  }

  private frontCaptureFingerprint(request: ReturnType<AiGraderLocalStationBridgeService["validateAtomicFrontCaptureRequest"]>) {
    return crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
  }

  private durableAcceptedCaptureProfile() {
    if (
      this.manifest.acceptedProfile.source !== 'browser_live_tuning'
      && this.manifest.acceptedProfile.source !== 'operator_preview'
      && this.manifest.acceptedProfile.source !== 'bridge_operator'
    ) {
      throw new Error('Capture authority requires a controller-acknowledged browser, operator-preview, or bridge-applied configured profile.');
    }
    const accepted = durableAcceptedPositioningProfile(this.manifest.acceptedProfile);
    const identity = crypto.createHash("sha256").update(JSON.stringify({
      sessionId: this.manifest.sessionId,
      reportId: this.manifest.reportId,
      profileDigestSha256: accepted.profileDigestSha256,
      acceptedAt: this.manifest.acceptedProfile.acceptedAt,
    })).digest("hex");
    const live = this.manifest.liveLighting.profile;
    if (
      live.acceptedForCapture !== true
      || live.acceptedAt !== this.manifest.acceptedProfile.acceptedAt
      || live.dutyPercent !== accepted.profile.dutyPercent
      || live.actualLeimacPwmStep !== accepted.profile.actualLeimacPwmStep
      || live.channels.join(',') !== accepted.profile.channels.join(',')
    ) {
      throw new Error('Capture requires the exact current controller-acknowledged lighting profile.');
    }
    return { ...accepted, identity };
  }

  private snapshotAtomicFrontCapture(
    request: ReturnType<AiGraderLocalStationBridgeService["validateAtomicFrontCaptureRequest"]>
  ): AiGraderFrontCaptureSnapshot {
    assertAtomicFrontRealReady(this.config);
    if (this.manifest.captureFailure) {
      throw new Error("Atomic Front Capture is blocked after a capture or processing failure.");
    }
    if (this.manifest.outputs.frontPackageDir || this.manifest.outputs.backPackageDir) {
      throw new Error("Atomic Front Capture requires a fresh session with no persisted side evidence.");
    }
    if (
      this.manifest.currentStep !== "capture_front"
      || request.expectedSessionId !== this.manifest.sessionId
      || request.expectedReportId !== this.manifest.reportId
      || request.expectedSideEpoch !== this.manifest.previewStatus.sideEpoch
      || this.manifest.previewStatus.activeSide !== "front"
    ) {
      throw new Error("Atomic Front Capture assertions are stale for the active session/report/front epoch.");
    }
    if (
      this.manifest.previewStatus.status !== "live"
      || this.manifest.previewStatus.cameraOwnership !== "preview_stream"
      || this.manifest.previewStatus.sessionId !== request.expectedSessionId
    ) {
      throw new Error("Atomic Front Capture requires the current session-bound live preview to own the camera.");
    }
    const accepted = this.durableAcceptedCaptureProfile();
    if (!this.positioningLightingVerificationComplete(accepted.profile)) {
      throw new Error('Atomic Front Capture requires complete controller acknowledgement of the exact accepted positioning-light profile.');
    }
    const observation = this.previewObservation("front", request.expectedFrameId);
    if (!observation?.geometry) {
      throw new Error("Atomic Front Capture requires an exact retained frame/geometry observation.");
    }
    const geometry = observation.geometry;
    if (
      geometry.sessionId !== request.expectedSessionId
      || geometry.side !== "front"
      || geometry.sideEpoch !== request.expectedSideEpoch
      || geometry.sourceFrameId !== request.expectedFrameId
    ) {
      throw new Error("Atomic Front Capture geometry does not match the asserted session/side/epoch/frame.");
    }
    const nowMs = Date.now();
    const capturedAtMs = Date.parse(observation.capturedAt);
    const receivedAtMs = Date.parse(observation.receivedAt);
    const geometryAtMs = Date.parse(geometry.timestamp);
    if (
      !Number.isFinite(capturedAtMs)
      || capturedAtMs > nowMs
      || nowMs - capturedAtMs > PREVIEW_GEOMETRY_MAX_AGE_MS
      || !Number.isFinite(receivedAtMs)
      || receivedAtMs > nowMs
      || nowMs - receivedAtMs > PREVIEW_GEOMETRY_MAX_AGE_MS
      || !Number.isFinite(geometryAtMs)
      || geometryAtMs > nowMs
      || nowMs - geometryAtMs > PREVIEW_GEOMETRY_MAX_AGE_MS
    ) {
      throw new Error("Atomic Front Capture retained frame/geometry observation is stale or future-dated.");
    }
    if (request.geometryCaptureMode === "detected_geometry") {
      const corners = geometry.detectedCorners ?? geometry.corners;
      if (
        geometry.placementState !== "ready"
        || geometry.geometrySource !== "detected"
        || geometry.detectionUsed !== true
        || geometry.manualOverrideUsed === true
        || !corners
        || !geometry.boundingBox
      ) {
        throw new Error(`Atomic Front Capture detected mode requires exact authoritative Ready geometry; current state is ${geometry.placementState}.`);
      }
    }
    return {
      sessionId: request.expectedSessionId,
      reportId: request.expectedReportId,
      side: "front",
      sideEpoch: request.expectedSideEpoch,
      frameId: request.expectedFrameId,
      captureMode: request.geometryCaptureMode,
      captureTriggerMode: request.captureTriggerMode,
      capturedAt: observation.capturedAt,
      receivedAt: observation.receivedAt,
      geometry: structuredClone(geometry),
      geometrySha256: crypto.createHash("sha256").update(JSON.stringify(geometry)).digest("hex"),
      acceptedProfileIdentity: accepted.identity,
      snapshottedAt: new Date().toISOString(),
    };
  }

  private recordAtomicFrontCaptureDecision(snapshot: AiGraderFrontCaptureSnapshot, captureTriggerAt: string) {
    this.manifest.geometryCaptureDecisions.front = {
      mode: snapshot.captureMode,
      placementState: snapshot.geometry.placementState,
      timestamp: captureTriggerAt,
      explicitOperatorAction: true,
      detectionUsed: true,
      manualOverrideUsed: false,
      sourceFrameId: snapshot.frameId,
    };
    this.manifest.progressLog.push(
      `${captureTriggerAt} Front capture audit recorded from the exact bridge-authoritative detected frame and acknowledged lighting profile (${snapshot.acceptedProfileIdentity}).`
    );
    this.recordCaptureTimingEvent(this.manifest, {
      id: "capture_trigger",
      side: "front",
      triggerMode: snapshot.captureTriggerMode,
      at: captureTriggerAt,
    });
  }

  private async executeAtomicFrontCapture(
    request: ReturnType<AiGraderLocalStationBridgeService["validateAtomicFrontCaptureRequest"]>,
    operation: AiGraderFrontCaptureOperation
  ) {
    const owner = `atomic-capture-front:${request.idempotencyKey}`;
    const priorWarmRunnerStatus = this.manifest.warmRunnerStatus.status;
    this.acquireCaptureLock(owner);
    let snapshot: AiGraderFrontCaptureSnapshot | undefined;
    let transitionStarted = false;
    let previewDrainVerified = false;
    let transitionSafeOffAttempted = false;
    let completed = false;
    let transitionStartedAt: string | undefined;
    let outcomeError: unknown;
    try {
      snapshot = this.snapshotAtomicFrontCapture(request);
      const captureTriggerAt = validatedCaptureTriggerAt(request.captureTriggerAt, new Date().toISOString());
      if (captureTriggerAt !== request.captureTriggerAt) {
        throw new Error("Atomic Front Capture captureTriggerAt is stale or future-dated for this request.");
      }
      transitionStarted = true;
      transitionStartedAt = new Date().toISOString();
      this.atomicFrontCaptureContext = { owner, snapshot };
      this.recordAtomicFrontCaptureDecision(snapshot, captureTriggerAt);
      this.updatePreviewStatus({
        intentionalTransition: {
          active: true,
          kind: "capture_front",
          sessionId: snapshot.sessionId,
          side: "front",
          sideEpoch: snapshot.sideEpoch,
          frameId: snapshot.frameId,
          startedAt: transitionStartedAt,
        },
      });
      this.activateFullForensicPreviewHold("atomic front capture transition");
      await this.stopPreviewStream("intentional atomic front capture transition", {
        waitForRelease: true,
        requireRelease: true,
        settleMs: PREVIEW_CAMERA_SETTLE_MS,
        captureOwner: true,
      });
      previewDrainVerified = true;
      const accepted = this.durableAcceptedCaptureProfile();
      if (
        operation.consumed
        || this.captureLock?.owner !== owner
        || this.manifest.sessionId !== snapshot.sessionId
        || this.manifest.reportId !== snapshot.reportId
        || this.manifest.currentStep !== "capture_front"
        || Boolean(this.manifest.captureFailure)
        || Boolean(this.manifest.outputs.frontPackageDir)
        || this.manifest.previewStatus.activeSide !== "front"
        || this.manifest.previewStatus.sideEpoch !== snapshot.sideEpoch
        || this.atomicFrontCaptureContext?.snapshot !== snapshot
        || snapshot.geometry.sessionId !== snapshot.sessionId
        || snapshot.geometry.side !== "front"
        || snapshot.geometry.sideEpoch !== snapshot.sideEpoch
        || snapshot.geometry.sourceFrameId !== snapshot.frameId
        || crypto.createHash("sha256").update(JSON.stringify(snapshot.geometry)).digest("hex") !== snapshot.geometrySha256
        || accepted.identity !== snapshot.acceptedProfileIdentity
        || Date.now() - Date.parse(snapshot.snapshottedAt) > ATOMIC_CAPTURE_AUTHORIZATION_MS
      ) {
        throw new Error("Atomic Front Capture authorization changed before camera ownership; capture was not consumed.");
      }
      operation.consumed = true;
      const result = await this.runWarmSideCapture("front");
      this.manifest.outputs.frontPackageDir = extractPackageDir(result.payload);
      if (!this.manifest.outputs.frontPackageDir) {
        throw new Error("Atomic Front Capture did not return a persisted front evidence package.");
      }
      this.manifest.currentStep = "prompt_flip_card";
      this.transitionPreviewSide("back", { preserveFrontGeometry: true });
      this.updatePreviewStatus({
        intentionalTransition: {
          active: true,
          kind: "capture_front",
          sessionId: snapshot.sessionId,
          side: "front",
          sideEpoch: snapshot.sideEpoch,
          frameId: snapshot.frameId,
          startedAt: transitionStartedAt,
        },
      });
      if (this.captureLock?.owner === owner) this.releaseCaptureLock(owner);
      this.releaseFullForensicPreviewHold("front capture complete; operator can position back with live preview");
      this.recordCaptureTimingEvent(this.manifest, { id: "back_positioning_started", side: "back" });
      this.manifest.progressLog.push(`${new Date().toISOString()} Front evidence captured by one bridge-authoritative atomic operation.`);
      await writeSessionManifest(this.manifest);
      if (this.closing) {
        this.updateBackPositioningLight({ status: "safe_off", captureReady: false, captureAuthorization: undefined });
        this.manifest.progressLog.push(`${new Date().toISOString()} Back-positioning restore was skipped because bridge shutdown is pending.`);
        await writeSessionManifest(this.manifest);
      } else {
        try {
          await this.serializeLightingLifecycle(() => this.restoreBackPositioningLightUnlocked("front_capture"));
        } catch (error) {
          const lastError = boundedBackPositioningError(error);
          this.updateBackPositioningLight({ status: "failed", captureReady: false, lastError });
          this.recordBackPositioningLightEvent({
            type: "restore_failure",
            trigger: "front_capture",
            profileIdentity: this.manifest.liveLighting.backPositioning.profileIdentity,
            error: lastError,
          });
          await writeSessionManifest(this.manifest);
        }
      }
      completed = true;
    } catch (error) {
      outcomeError = error;
      if (transitionStarted && !transitionSafeOffAttempted) {
        transitionSafeOffAttempted = true;
        try {
          await this.safeOffLiveLighting("atomic front capture transition failure", "failure_safe_off", { force: true });
        } catch (cleanupError) {
          const original = boundedBackPositioningError(error).message;
          const cleanup = boundedBackPositioningError(cleanupError).message;
          const cleanupMessage = `Failure safe-off also could not be verified: ${cleanup}`;
          if (!this.manifest.warnings.includes(original)) this.manifest.warnings.push(original);
          if (!this.manifest.warnings.includes(cleanupMessage)) this.manifest.warnings.push(cleanupMessage);
        }
      }
      if (transitionStarted && !this.manifest.captureFailure) {
        this.manifest.currentStep = "capture_front";
        this.manifest.warmRunnerStatus.status = this.manifest.liveLighting.physicalState.state === "safe_off_verified"
          ? "safe_off"
          : "failed";
        const lastError = boundedPreviewLifecycleError(outcomeError);
        const currentOwnership = this.manifest.previewStatus.cameraOwnership;
        const failedDrainOwnership = currentOwnership === "released" ? "preview_stream" : currentOwnership;
        this.updatePreviewStatus({
          status: "error",
          cameraOwnership: previewDrainVerified ? "released" : failedDrainOwnership,
          positioningLightReady: false,
          lastError,
          lastStopReason: "Atomic Front Capture transition failed; a fresh preview/frame is required before retry.",
        });
      }
    } finally {
      this.atomicFrontCaptureContext = undefined;
      if (transitionStarted && snapshot) {
        this.updatePreviewStatus({
          intentionalTransition: {
            active: false,
            kind: "capture_front",
            sessionId: snapshot.sessionId,
            side: "front",
            sideEpoch: snapshot.sideEpoch,
            frameId: snapshot.frameId,
            startedAt: transitionStartedAt,
            completedAt: new Date().toISOString(),
            outcome: completed ? "capture_started" : "transition_failed",
          },
        });
      }
      if (this.captureLock?.owner === owner) this.releaseCaptureLock(owner);
      if (!transitionStarted) this.manifest.warmRunnerStatus.status = priorWarmRunnerStatus;
      if (transitionStarted && !completed) {
        if (previewDrainVerified) {
          this.releaseFullForensicPreviewHold("atomic front capture transition failed; explicit preview recovery is available");
        } else {
          this.manifest.progressLog.push(`${new Date().toISOString()} Atomic Front Capture drain failed with preview ownership unreleased; forensic preview hold remains active and automatic restart is blocked.`);
        }
      }
      try {
        await writeSessionManifest(this.manifest);
      } catch (error) {
        if (!outcomeError) outcomeError = error;
      }
    }
    if (outcomeError) throw outcomeError;
    return this.status();
  }

  private atomicFrontCapture(requestValue: AiGraderLocalStationBridgeActionRequest) {
    const request = this.validateAtomicFrontCaptureRequest(requestValue);
    const fingerprint = this.frontCaptureFingerprint(request);
    const existing = this.frontCaptureOperations.get(request.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("Atomic Front Capture idempotency key conflicts with a different request.");
      return existing.result ? Promise.resolve(structuredClone(existing.result)) : existing.promise;
    }
    if (this.closing) throw new Error("Atomic Front Capture is unavailable while the local bridge is closing.");
    if (this.terminalLifecyclePending > 0 || this.lightingLifecyclePending > 0) {
      throw new Error("Atomic Front Capture is blocked while a lighting or terminal lifecycle operation is pending.");
    }
    if (!this.manifest.sessionId) {
      throw new Error("Start a station session before running AI Grader station actions.");
    }
    if (this.frontCaptureInFlightKey && this.frontCaptureInFlightKey !== request.idempotencyKey) {
      throw new Error("A different Atomic Front Capture operation already owns the serialized lifecycle.");
    }
    if (this.currentAtomicBackCapturePromise()) {
      throw new Error("Atomic Front Capture is blocked while Atomic Back Capture owns the serialized lifecycle.");
    }
    this.frontCaptureInFlightKey = request.idempotencyKey;
    const operation = {} as AiGraderFrontCaptureOperation;
    operation.fingerprint = fingerprint;
    operation.consumed = false;
    const reservation = {
      owner: `atomic-capture-front:${request.idempotencyKey}`,
    } as NonNullable<AiGraderLocalStationBridgeService["frontCaptureTransition"]>;
    const tracked = Promise.resolve().then(() => this.executeAtomicFrontCapture(request, operation)).then((result) => {
      operation.result = structuredClone(result);
      return structuredClone(operation.result);
    }).finally(() => {
      if (this.frontCaptureInFlightKey === request.idempotencyKey) this.frontCaptureInFlightKey = undefined;
      if (this.frontCaptureTransition === reservation) this.frontCaptureTransition = undefined;
    });
    operation.promise = tracked;
    reservation.promise = tracked;
    this.frontCaptureOperations.set(request.idempotencyKey, operation);
    this.frontCaptureTransition = reservation;
    while (this.frontCaptureOperations.size > ATOMIC_CAPTURE_IDEMPOTENCY_LIMIT) {
      const oldest = this.frontCaptureOperations.keys().next().value;
      if (!oldest || oldest === this.frontCaptureInFlightKey) break;
      this.frontCaptureOperations.delete(oldest);
    }
    return tracked;
  }

  private validateAtomicBackCaptureRequest(request: AiGraderLocalStationBridgeActionRequest) {
    const allowedKeys = new Set([
      "idempotencyKey",
      "expectedSessionId",
      "expectedReportId",
      "expectedSide",
      "expectedSideEpoch",
      "expectedFrameId",
      "geometryCaptureMode",
      "captureTriggerMode",
      "captureTriggerAt",
    ]);
    const unexpected = Object.keys(request as Record<string, unknown>).filter((key) => !allowedKeys.has(key));
    if (unexpected.length > 0) {
      throw new Error("Atomic Back Capture accepts only bounded idempotency, session/report/side/epoch/frame, mode, and trigger assertions.");
    }
    if (!request.idempotencyKey || !ATOMIC_CAPTURE_IDEMPOTENCY_KEY_RE.test(request.idempotencyKey)) {
      throw new Error("Atomic Back Capture requires a 16-128 character bounded idempotency key.");
    }
    const requiredStrings = [request.expectedSessionId, request.expectedReportId, request.expectedSideEpoch, request.expectedFrameId];
    if (requiredStrings.some((value) => typeof value !== "string" || value.length < 1 || value.length > 256)) {
      throw new Error("Atomic Back Capture requires bounded expected session/report/epoch/frame assertions.");
    }
    if (request.expectedSide !== "back") throw new Error("Atomic Back Capture expectedSide must be back.");
    if (request.geometryCaptureMode !== "detected_geometry") throw new Error("Capture Back requires detected_geometry mode.");
    const captureTriggerMode = parseCaptureTriggerMode(request.captureTriggerMode);
    return {
      idempotencyKey: request.idempotencyKey,
      expectedSessionId: request.expectedSessionId!,
      expectedReportId: request.expectedReportId!,
      expectedSide: "back" as const,
      expectedSideEpoch: request.expectedSideEpoch!,
      expectedFrameId: request.expectedFrameId!,
      geometryCaptureMode: request.geometryCaptureMode,
      captureTriggerMode,
      captureTriggerAt: request.captureTriggerAt,
    };
  }

  private backCaptureFingerprint(request: ReturnType<AiGraderLocalStationBridgeService["validateAtomicBackCaptureRequest"]>) {
    return crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
  }

  private snapshotAtomicBackCapture(
    request: ReturnType<AiGraderLocalStationBridgeService["validateAtomicBackCaptureRequest"]>
  ): AiGraderBackCaptureSnapshot {
    if (this.manifest.captureFailure) {
      throw new Error("Atomic Back Capture is blocked after a capture or processing failure.");
    }
    if (!this.manifest.outputs.frontPackageDir || this.manifest.outputs.backPackageDir) {
      throw new Error("Atomic Back Capture requires persisted front evidence and no existing back evidence.");
    }
    if (
      this.manifest.currentStep !== "prompt_flip_card"
      || request.expectedSessionId !== this.manifest.sessionId
      || request.expectedReportId !== this.manifest.reportId
      || request.expectedSideEpoch !== this.manifest.previewStatus.sideEpoch
      || this.manifest.previewStatus.activeSide !== "back"
    ) {
      throw new Error("Atomic Back Capture assertions are stale for the active session/report/back epoch.");
    }
    if (!this.backPositioningCaptureReady()) {
      throw new Error("Atomic Back Capture requires the verified durable positioning light and a recent live back preview frame.");
    }
    const observation = this.previewObservation("back", request.expectedFrameId);
    if (!observation?.geometry) {
      throw new Error("Atomic Back Capture requires an exact retained frame/geometry observation.");
    }
    const geometry = observation.geometry;
    if (
      geometry.sessionId !== request.expectedSessionId
      || geometry.side !== "back"
      || geometry.sideEpoch !== request.expectedSideEpoch
      || geometry.sourceFrameId !== request.expectedFrameId
    ) {
      throw new Error("Atomic Back Capture geometry does not match the asserted session/side/epoch/frame.");
    }
    const nowMs = Date.now();
    const capturedAtMs = Date.parse(observation.capturedAt);
    const receivedAtMs = Date.parse(observation.receivedAt);
    const geometryAtMs = Date.parse(geometry.timestamp);
    const positioningVerifiedAtMs = Date.parse(this.manifest.liveLighting.physicalState.verifiedAt ?? "");
    if (
      !Number.isFinite(capturedAtMs)
      || capturedAtMs > nowMs
      || nowMs - capturedAtMs > PREVIEW_GEOMETRY_MAX_AGE_MS
      || !Number.isFinite(receivedAtMs)
      || receivedAtMs > nowMs
      || nowMs - receivedAtMs > PREVIEW_GEOMETRY_MAX_AGE_MS
      || !Number.isFinite(geometryAtMs)
      || geometryAtMs > nowMs
      || nowMs - geometryAtMs > PREVIEW_GEOMETRY_MAX_AGE_MS
      || !Number.isFinite(positioningVerifiedAtMs)
      || capturedAtMs < positioningVerifiedAtMs
      || receivedAtMs < positioningVerifiedAtMs
    ) {
      throw new Error("Atomic Back Capture retained frame/geometry observation is stale or future-dated.");
    }
    if (request.geometryCaptureMode === "detected_geometry") {
      const corners = geometry.detectedCorners ?? geometry.corners;
      if (
        geometry.placementState !== "ready"
        || geometry.geometrySource !== "detected"
        || geometry.detectionUsed !== true
        || geometry.manualOverrideUsed === true
        || !corners
        || !geometry.boundingBox
      ) {
        throw new Error(`Atomic Back Capture detected mode requires exact authoritative Ready geometry; current state is ${geometry.placementState}.`);
      }
    }
    return {
      sessionId: request.expectedSessionId,
      reportId: request.expectedReportId,
      side: "back",
      sideEpoch: request.expectedSideEpoch,
      frameId: request.expectedFrameId,
      captureMode: request.geometryCaptureMode,
      captureTriggerMode: request.captureTriggerMode,
      capturedAt: observation.capturedAt,
      receivedAt: observation.receivedAt,
      geometry: structuredClone(geometry),
      geometrySha256: crypto.createHash("sha256").update(JSON.stringify(geometry)).digest("hex"),
      snapshottedAt: new Date().toISOString(),
    };
  }

  private recordAtomicBackCaptureDecision(snapshot: AiGraderBackCaptureSnapshot, captureTriggerAt: string) {
    this.manifest.geometryCaptureDecisions.back = {
      mode: snapshot.captureMode,
      placementState: snapshot.geometry.placementState,
      timestamp: captureTriggerAt,
      explicitOperatorAction: true,
      detectionUsed: true,
      manualOverrideUsed: false,
      sourceFrameId: snapshot.frameId,
    };
    this.manifest.progressLog.push(`${captureTriggerAt} Operator flip/capture audit recorded from bridge-authoritative ${snapshot.captureMode} snapshot.`);
    this.recordCaptureTimingEvent(this.manifest, {
      id: "capture_trigger",
      side: "back",
      triggerMode: snapshot.captureTriggerMode,
      at: captureTriggerAt,
    });
  }

  private async executeAtomicBackCapture(
    request: ReturnType<AiGraderLocalStationBridgeService["validateAtomicBackCaptureRequest"]>,
    operation: AiGraderBackCaptureOperation
  ) {
    const owner = `atomic-capture-back:${request.idempotencyKey}`;
    const priorWarmRunnerStatus = this.manifest.warmRunnerStatus.status;
    this.acquireCaptureLock(owner);
    let snapshot: AiGraderBackCaptureSnapshot | undefined;
    let transitionStarted = false;
    let transitionSafeOffAttempted = false;
    let completed = false;
    let outcomeError: unknown;
    try {
      snapshot = this.snapshotAtomicBackCapture(request);
      const captureTriggerAt = validatedCaptureTriggerAt(request.captureTriggerAt, new Date().toISOString());
      transitionStarted = true;
      this.atomicBackCaptureContext = { owner, snapshot };
      this.recordAtomicBackCaptureDecision(snapshot, captureTriggerAt);
      this.updatePreviewStatus({
        intentionalTransition: {
          active: true,
          kind: "capture_back",
          sessionId: snapshot.sessionId,
          side: "back",
          sideEpoch: snapshot.sideEpoch,
          frameId: snapshot.frameId,
          startedAt: new Date().toISOString(),
        },
      });
      this.activateFullForensicPreviewHold("atomic back capture transition");
      await this.stopPreviewStream("intentional atomic back capture transition", {
        waitForRelease: true,
        requireRelease: true,
        settleMs: PREVIEW_CAMERA_SETTLE_MS,
        captureOwner: true,
      });
      if (
        operation.consumed
        || this.captureLock?.owner !== owner
        || this.manifest.sessionId !== snapshot.sessionId
        || this.manifest.reportId !== snapshot.reportId
        || this.manifest.currentStep !== "prompt_flip_card"
        || Boolean(this.manifest.captureFailure)
        || this.manifest.previewStatus.activeSide !== "back"
        || this.manifest.previewStatus.sideEpoch !== snapshot.sideEpoch
        || this.atomicBackCaptureContext?.snapshot !== snapshot
        || snapshot.geometry.sessionId !== snapshot.sessionId
        || snapshot.geometry.side !== "back"
        || snapshot.geometry.sideEpoch !== snapshot.sideEpoch
        || snapshot.geometry.sourceFrameId !== snapshot.frameId
        || crypto.createHash("sha256").update(JSON.stringify(snapshot.geometry)).digest("hex") !== snapshot.geometrySha256
        || Date.now() - Date.parse(snapshot.snapshottedAt) > ATOMIC_CAPTURE_AUTHORIZATION_MS
      ) {
        throw new Error("Atomic Back Capture authorization changed before camera ownership; capture was not consumed.");
      }
      operation.consumed = true;
      const result = await this.runWarmSideCapture("back");
      this.manifest.outputs.backPackageDir = extractPackageDir(result.payload);
      this.manifest.currentStep = "run_provisional_diagnostics";
      this.manifest.progressLog.push(`${new Date().toISOString()} Back evidence captured by one bridge-authoritative atomic operation.`);
      completed = true;
    } catch (error) {
      outcomeError = error;
      if (transitionStarted && !transitionSafeOffAttempted) {
        transitionSafeOffAttempted = true;
        try {
          await this.safeOffLiveLighting("atomic back capture transition failure", "failure_safe_off", { force: true });
        } catch (cleanupError) {
          const original = boundedBackPositioningError(error).message;
          const cleanup = boundedBackPositioningError(cleanupError).message;
          const cleanupMessage = `Failure safe-off also could not be verified: ${cleanup}`;
          if (!this.manifest.warnings.includes(original)) this.manifest.warnings.push(original);
          if (!this.manifest.warnings.includes(cleanupMessage)) this.manifest.warnings.push(cleanupMessage);
        }
      }
      if (transitionStarted && !this.manifest.captureFailure) {
        this.manifest.currentStep = "prompt_flip_card";
        this.manifest.warmRunnerStatus.status = this.manifest.liveLighting.physicalState.state === "safe_off_verified"
          ? "safe_off"
          : "failed";
        const lastError = boundedBackPositioningError(outcomeError);
        this.updateBackPositioningLight({
          status: "failed",
          captureReady: false,
          captureAuthorization: undefined,
          lastError,
        });
        this.updatePreviewStatus({
          status: "error",
          cameraOwnership: "released",
          positioningLightReady: false,
          lastError: lastError.message,
          lastStopReason: "Atomic Back Capture transition failed; explicit positioning-preview recovery is required.",
        });
      }
    } finally {
      this.atomicBackCaptureContext = undefined;
      if (transitionStarted && snapshot) {
        this.updatePreviewStatus({
          intentionalTransition: {
            active: false,
            kind: "capture_back",
            sessionId: snapshot.sessionId,
            side: "back",
            sideEpoch: snapshot.sideEpoch,
            frameId: snapshot.frameId,
            startedAt: this.manifest.previewStatus.intentionalTransition.startedAt,
            completedAt: new Date().toISOString(),
            outcome: completed ? "capture_started" : "transition_failed",
          },
        });
      }
      if (this.captureLock?.owner === owner) this.releaseCaptureLock(owner);
      if (!transitionStarted) this.manifest.warmRunnerStatus.status = priorWarmRunnerStatus;
      if (transitionStarted && !completed) {
        this.releaseFullForensicPreviewHold("atomic back capture transition failed; explicit preview recovery is available");
      }
      try {
        await writeSessionManifest(this.manifest);
      } catch (error) {
        if (!outcomeError) outcomeError = error;
      }
    }
    if (outcomeError) throw outcomeError;
    return this.status();
  }

  private atomicBackCapture(requestValue: AiGraderLocalStationBridgeActionRequest) {
    if (this.closing) throw new Error("Atomic Back Capture is unavailable while the local bridge is closing.");
    if (this.frontCaptureTransition) {
      throw new Error("Atomic Back Capture is blocked while Front Capture owns the serialized lifecycle reservation.");
    }
    if (this.terminalLifecyclePending > 0 || this.lightingLifecyclePending > 0) {
      throw new Error("Atomic Back Capture is blocked while a lighting or terminal lifecycle operation is pending.");
    }
    const request = this.validateAtomicBackCaptureRequest(requestValue);
    const fingerprint = this.backCaptureFingerprint(request);
    const existing = this.backCaptureOperations.get(request.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("Atomic Back Capture idempotency key conflicts with a different request.");
      return existing.result ? Promise.resolve(structuredClone(existing.result)) : existing.promise;
    }
    if (this.backCaptureInFlightKey && this.backCaptureInFlightKey !== request.idempotencyKey) {
      throw new Error("A different Atomic Back Capture operation already owns the serialized lifecycle.");
    }
    this.backCaptureInFlightKey = request.idempotencyKey;
    const operation = {} as AiGraderBackCaptureOperation;
    operation.fingerprint = fingerprint;
    operation.consumed = false;
    this.backCaptureOperations.set(request.idempotencyKey, operation);
    operation.promise = this.executeAtomicBackCapture(request, operation).then((result) => {
      operation.result = structuredClone(result);
      return structuredClone(operation.result);
    }).finally(() => {
      if (this.backCaptureInFlightKey === request.idempotencyKey) this.backCaptureInFlightKey = undefined;
    });
    while (this.backCaptureOperations.size > ATOMIC_CAPTURE_IDEMPOTENCY_LIMIT) {
      const oldest = this.backCaptureOperations.keys().next().value;
      if (!oldest || oldest === this.backCaptureInFlightKey) break;
      this.backCaptureOperations.delete(oldest);
    }
    return operation.promise;
  }

  private resetPreviewGeometryAnalysis() {
    this.transitionPreviewSide(activePreviewGeometrySide(this.manifest.currentStep));
  }

  private noteMockPreviewGeometry(frameIndex: number, frameId: string) {
    const side = this.manifest.previewStatus.activeSide;
    const sessionId = this.manifest.sessionId;
    if (!sessionId) return;
    const sideEpoch = this.manifest.previewStatus.sideEpoch;
    const now = new Date().toISOString();
    const current = this.manifest.previewStatus.cardGeometry ?? defaultPreviewGeometryStatus(this.config);
    const geometry = mockPreviewGeometry(side, frameIndex, now, sessionId, sideEpoch, frameId);
    if (!this.retainPreviewGeometryObservation(geometry)) return;
    this.manifest.previewStatus.cardGeometry = {
      ...current,
      activeSide: side,
      [side]: geometry,
      analysis: {
        ...current.analysis,
        source: "mock_deterministic",
        inFlight: false,
        latestFramePending: false,
        framesAnalyzed: current.analysis.framesAnalyzed + 1,
        lastStartedAt: now,
        lastCompletedAt: now,
        lastError: undefined,
      },
    };
    if (geometry.placementState === "ready") {
      this.recordCaptureTimingEvent(this.manifest, { id: "edge_detection_ready", side, at: now });
    }
  }

  private queuePreviewGeometryAnalysis(
    frame: Buffer,
    frameIndex: number,
    frameCapturedAt: string,
    frameTimestampSource: "preview_capture_header" | "bridge_received",
    frameId: string,
    binding: { sessionId: string; side: CardGeometrySide; sideEpoch: string }
  ) {
    if (
      binding.sessionId !== this.manifest.sessionId
      || binding.side !== this.manifest.previewStatus.activeSide
      || binding.sideEpoch !== this.manifest.previewStatus.sideEpoch
    ) return;
    if (!this.retainPreviewObservation(binding, frameId, frameCapturedAt)) return;
    const side = binding.side;
    const current = this.manifest.previewStatus.cardGeometry ?? defaultPreviewGeometryStatus(this.config);
    const stalePending = Boolean(this.previewGeometryPending);
    this.previewGeometryPending = {
      frame,
      frameIndex,
      frameCapturedAt,
      frameTimestampSource,
      side,
      sessionId: binding.sessionId,
      sideEpoch: binding.sideEpoch,
      frameId,
      epoch: this.previewGeometryEpoch,
    };
    this.manifest.previewStatus.cardGeometry = {
      ...current,
      activeSide: side,
      analysis: {
        ...current.analysis,
        source: "real_mjpeg_jpeg",
        latestFramePending: true,
        framesDroppedAsStale: current.analysis.framesDroppedAsStale + (stalePending ? 1 : 0),
      },
    };
    this.pumpPreviewGeometryAnalysis();
  }

  private pumpPreviewGeometryAnalysis() {
    if (this.previewGeometryAnalysisInFlight || !this.previewGeometryPending) return;
    const waitMs = Math.max(0, this.previewGeometryLastStartedAtMs + PREVIEW_GEOMETRY_THROTTLE_MS - Date.now());
    if (waitMs > 0) {
      if (!this.previewGeometryTimer) {
        this.previewGeometryTimer = setTimeout(() => {
          this.previewGeometryTimer = undefined;
          this.pumpPreviewGeometryAnalysis();
        }, waitMs);
      }
      return;
    }
    const pending = this.previewGeometryPending;
    this.previewGeometryPending = undefined;
    this.previewGeometryAnalysisInFlight = true;
    this.previewGeometryLastStartedAtMs = Date.now();
    const startedAt = new Date(this.previewGeometryLastStartedAtMs).toISOString();
    const current = this.manifest.previewStatus.cardGeometry ?? defaultPreviewGeometryStatus(this.config);
    this.manifest.previewStatus.cardGeometry = {
      ...current,
      analysis: {
        ...current.analysis,
        inFlight: true,
        latestFramePending: false,
        lastStartedAt: startedAt,
      },
    };
    const detectPreviewCardGeometry = this.dependencies.detectPreviewCardGeometry ?? detectCardGeometryFromBuffer;
    void detectPreviewCardGeometry({
      imageBuffer: pending.frame,
      fileName: "preview-frame.jpg",
      side: pending.side,
      sourceImageId: `preview-${pending.side}`,
      sourceFrameId: pending.frameId,
      timestamp: pending.frameCapturedAt,
      detectionPolicy: "live_preview_fast",
    }).then((geometry) => {
      if (
        pending.epoch !== this.previewGeometryEpoch
        || pending.sessionId !== this.manifest.sessionId
        || pending.side !== this.manifest.previewStatus.activeSide
        || pending.sideEpoch !== this.manifest.previewStatus.sideEpoch
      ) return;
      const completedAtMs = Date.now();
      const latest = this.manifest.previewStatus.cardGeometry ?? defaultPreviewGeometryStatus(this.config);
      const boundGeometry = {
        ...geometry,
        sessionId: pending.sessionId,
        sideEpoch: pending.sideEpoch,
      };
      if (!this.retainPreviewGeometryObservation(boundGeometry)) {
        delete latest[pending.side];
        this.manifest.previewStatus.cardGeometry = {
          ...latest,
          analysis: {
            ...latest.analysis,
            inFlight: false,
            lastCompletedAt: new Date(completedAtMs).toISOString(),
            lastError: "Preview geometry was rejected because its exact frame observation is missing, expired, or future-dated.",
          },
        };
        return;
      }
      this.manifest.previewStatus.cardGeometry = {
        ...latest,
        activeSide: activePreviewGeometrySide(this.manifest.currentStep),
        [pending.side]: boundGeometry,
        analysis: {
          ...latest.analysis,
          inFlight: false,
          framesAnalyzed: latest.analysis.framesAnalyzed + 1,
          lastDurationMs: Math.max(0, completedAtMs - this.previewGeometryLastStartedAtMs),
          lastFrameCapturedAt: pending.frameCapturedAt,
          lastFrameTimestampSource: pending.frameTimestampSource,
          lastCompletedAt: new Date(completedAtMs).toISOString(),
          lastError: undefined,
        },
      };
      if (boundGeometry.placementState === "ready") {
        this.recordCaptureTimingEvent(this.manifest, {
          id: "edge_detection_ready",
          side: pending.side,
          at: boundGeometry.timestamp,
        });
      }
    }).catch(() => {
      if (
        pending.epoch !== this.previewGeometryEpoch
        || pending.sessionId !== this.manifest.sessionId
        || pending.sideEpoch !== this.manifest.previewStatus.sideEpoch
      ) return;
      const completedAtMs = Date.now();
      const latest = this.manifest.previewStatus.cardGeometry ?? defaultPreviewGeometryStatus(this.config);
      // Never retain a prior Ready outline after a decoder/detector failure.
      // The operator must see a fresh analyzed frame before capture can pass.
      delete latest[pending.side];
      this.manifest.previewStatus.cardGeometry = {
        ...latest,
        analysis: {
          ...latest.analysis,
          inFlight: false,
          lastDurationMs: Math.max(0, completedAtMs - this.previewGeometryLastStartedAtMs),
          lastCompletedAt: new Date(completedAtMs).toISOString(),
          lastError: "Preview geometry analysis could not analyze the latest encoded frame.",
        },
      };
    }).finally(() => {
      this.previewGeometryAnalysisInFlight = false;
      const latest = this.manifest.previewStatus.cardGeometry;
      if (latest) {
        latest.analysis.inFlight = false;
        latest.analysis.latestFramePending = Boolean(this.previewGeometryPending);
      }
      this.pumpPreviewGeometryAnalysis();
    });
  }

  private bindMathematicalGradingAuthority(
    manifest: AiGraderLocalStationBridgeManifest,
    value: unknown,
  ): void {
    if (gradingContractFor(manifest) !== "mathematical_calibration_v1") {
      throw new Error("Mathematical grading authority can bind only to an explicit Mathematical V1 session.");
    }
    if (!manifest.sessionId || !manifest.reportId || !manifest.createdAt) {
      throw new Error("Mathematical grading authority requires one exact active station session.");
    }
    if (manifest.outputs.frontPackageDir || manifest.outputs.backPackageDir ||
        manifest.mathematicalV1?.execution || Object.keys(manifest.mathematicalV1?.stagedDesignReferences ?? {}).length) {
      throw new Error("Mathematical grading authority is immutable after staging, capture, or grading starts.");
    }
    if (manifest.mathematicalV1) {
      throw new Error("Mathematical grading authority is already bound to this exact session.");
    }
    manifest.mathematicalV1 = newLocalMathematicalV1State(
      validateLocalMathematicalGradingAuthorityV1(value),
      manifest.createdAt,
    );
    manifest.progressLog.push(
      new Date().toISOString() +
      " Exact Mathematical V1 card and centering/design-reference authority bound before capture; no caller publication or registration transform was accepted.",
    );
  }

  private mathematicalCenteringAuthority(
    manifest: AiGraderLocalStationBridgeManifest,
    side: "front" | "back",
  ): AiGraderLocalStationMathematicalCenteringAuthorityV1 {
    if (gradingContractFor(manifest) !== "mathematical_calibration_v1" || !manifest.mathematicalV1) {
      throw new Error("Mathematical V1 capture requires exact card and centering authority before capture.");
    }
    return manifest.mathematicalV1.gradingAuthority.sides[side].centering;
  }

  private verifyStagedDesignReferenceSync(
    manifest: AiGraderLocalStationBridgeManifest,
    side: "front" | "back",
  ): AiGraderLocalStationStagedDesignReferenceV1 | undefined {
    const centering = this.mathematicalCenteringAuthority(manifest, side);
    if (centering.profile === "printed_border_v1") return undefined;
    const staged = manifest.mathematicalV1?.stagedDesignReferences[side];
    if (!staged || !manifest.outputs.sessionDir ||
        staged.referenceId !== centering.approvedReference.referenceId ||
        staged.sha256 !== centering.approvedDesignArtifact.sha256 ||
        staged.assetId !== centering.approvedDesignArtifact.assetId ||
        staged.fileName !== centering.approvedDesignArtifact.fileName ||
        staged.contentType !== centering.approvedDesignArtifact.contentType ||
        !isSubpath(staged.filePath, manifest.outputs.sessionDir)) {
      throw new Error(
        "Mathematical V1 " + side +
        " capture requires the exact approved design-reference bytes staged for this session.",
      );
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(staged.filePath);
    } catch {
      throw new Error("Mathematical V1 " + side + " staged design-reference file is unavailable.");
    }
    if (bytes.byteLength !== staged.byteSize ||
        crypto.createHash("sha256").update(bytes).digest("hex") !== staged.sha256) {
      throw new Error("Mathematical V1 " + side + " staged design-reference bytes changed after staging.");
    }
    return staged;
  }

  private assertMathematicalCaptureAuthority(
    manifest: AiGraderLocalStationBridgeManifest,
    side: "front" | "back",
  ): void {
    if (gradingContractFor(manifest) !== "mathematical_calibration_v1") return;
    this.verifyStagedDesignReferenceSync(manifest, side);
  }

  assertMathematicalDesignReferenceStageRequest(input: {
    sessionId: string;
    side: "front" | "back";
    referenceId: string;
    sha256: string;
    contentType: string;
  }): void {
    if (!this.manifest.sessionId || this.manifest.sessionId !== input.sessionId ||
        gradingContractFor(this.manifest) !== "mathematical_calibration_v1") {
      throw new Error("Design-reference staging session does not match the exact active Mathematical V1 session.");
    }
    if (!this.manifest.outputs.sessionDir || !this.manifest.outputs.manifestPath) {
      throw new Error("Design-reference staging requires the exact active station-session directory.");
    }
    if (input.side !== "front" && input.side !== "back") {
      throw new Error("Design-reference staging side must be front or back.");
    }
    const centering = this.mathematicalCenteringAuthority(this.manifest, input.side);
    if (centering.profile !== "registered_design_template_v1") {
      throw new Error("Design-reference staging is permitted only for a registered-template side.");
    }
    const expected = centering.approvedDesignArtifact;
    if (input.referenceId !== centering.approvedReference.referenceId ||
        input.sha256 !== expected.sha256 ||
        input.contentType !== expected.contentType) {
      throw new Error("Staged design-reference headers do not match the exact approved session authority.");
    }
  }

  async stageMathematicalDesignReference(input: {
    sessionId: string;
    side: "front" | "back";
    referenceId: string;
    sha256: string;
    contentType: string;
    declaredByteSize: number;
    bytes: Uint8Array;
  }): Promise<AiGraderLocalStationStagedDesignReferenceV1> {
    this.assertMathematicalDesignReferenceStageRequest(input);
    const centering = this.mathematicalCenteringAuthority(this.manifest, input.side);
    if (centering.profile !== "registered_design_template_v1") throw new Error("Registered-template staging authority changed.");
    const expected = centering.approvedDesignArtifact;
    if (!Number.isSafeInteger(input.declaredByteSize) || input.declaredByteSize < 24 ||
        input.declaredByteSize > MATHEMATICAL_DESIGN_REFERENCE_MAX_BYTES ||
        input.bytes.byteLength !== input.declaredByteSize) {
      throw new Error(
        "Design-reference Content-Length must exactly match 24 through " +
        MATHEMATICAL_DESIGN_REFERENCE_MAX_BYTES + " bounded bytes.",
      );
    }
    const bytes = Buffer.from(input.bytes);
    const observedSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (!SHA256_LOWERCASE_RE.test(input.sha256) || observedSha256 !== input.sha256) {
      throw new Error("Staged design-reference body SHA-256 does not match its exact approved authority.");
    }
    if (this.manifest.mathematicalV1?.stagedDesignReferences[input.side]) {
      throw new Error("This exact Mathematical V1 side already has an immutable staged design reference.");
    }
    const sessionDir = this.manifest.outputs.sessionDir;
    if (!sessionDir) {
      throw new Error("Design-reference staging requires the exact active station-session directory.");
    }
    const stageDir = path.join(sessionDir, "mathematical-v1-design-references");
    const extension = expected.contentType === "image/png" ? "png" : "jpg";
    const filePath = path.join(stageDir, input.side + "-approved-design-reference." + extension);
    if (!isSubpath(filePath, sessionDir)) {
      throw new Error("Design-reference staging path escaped the exact station session.");
    }
    await mkdir(stageDir, { recursive: true });
    try {
      await writeFile(filePath, bytes, { flag: "wx" });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EEXIST") {
        throw new Error("Design-reference staging is create-new and cannot overwrite an existing file.");
      }
      throw error;
    }
    const readback = await readFile(filePath);
    if (readback.byteLength !== bytes.byteLength ||
        crypto.createHash("sha256").update(readback).digest("hex") !== observedSha256) {
      throw new Error("Staged design-reference readback did not preserve exact bytes and SHA-256.");
    }
    const staged: AiGraderLocalStationStagedDesignReferenceV1 = {
      side: input.side,
      referenceId: centering.approvedReference.referenceId,
      assetId: expected.assetId,
      fileName: expected.fileName,
      contentType: expected.contentType as "image/png" | "image/jpeg",
      sha256: observedSha256,
      byteSize: bytes.byteLength,
      filePath,
      stagedAt: new Date().toISOString(),
    };
    this.manifest.mathematicalV1!.stagedDesignReferences[input.side] = staged;
    this.manifest.updatedAt = staged.stagedAt;
    this.manifest.progressLog.push(
      staged.stagedAt + " Staged one create-new, hash-verified " + input.side +
      " approved design reference inside the exact private station session.",
    );
    await writeSessionManifest(this.manifest);
    return structuredClone(staged);
  }

  private hydratedMathematicalGradingAuthority(
    manifest: AiGraderLocalStationBridgeManifest,
  ): FixedRigMathematicalStationGradingAuthorityV1 {
    if (!manifest.mathematicalV1) {
      throw new Error("Mathematical V1 grading authority is missing from this exact station session.");
    }
    const authority = structuredClone(manifest.mathematicalV1.gradingAuthority) as unknown as Record<string, unknown>;
    const sides = authority.sides as FixedRigMathematicalStationGradingAuthorityV1["sides"];
    for (const side of ["front", "back"] as const) {
      const centering = sides[side].centering;
      if (centering.profile === "printed_border_v1") continue;
      const staged = this.verifyStagedDesignReferenceSync(manifest, side);
      if (!staged) throw new Error("Registered-template staging authority unexpectedly resolved empty.");
      sides[side].centering = {
        ...centering,
        approvedDesignArtifact: {
          ...centering.approvedDesignArtifact,
          filePath: staged.filePath,
        },
      };
    }
    const configuredPublicBase = this.config.publicBasePath?.startsWith("https://")
      ? this.config.publicBasePath.replace(/\/$/, "")
      : "https://collect.tenkings.co";
    const reportBase = configuredPublicBase.endsWith("/ai-grader/reports")
      ? configuredPublicBase
      : configuredPublicBase + "/ai-grader/reports";
    const publicReportUrl = reportBase + "/" + encodeURIComponent(manifest.reportId!);
    const certHash = crypto.createHash("sha1")
      .update(manifest.reportId!)
      .digest("hex")
      .slice(0, 8)
      .toUpperCase();
    authority.publication = {
      certId: "TK-AIG-" + certHash,
      publicReportUrl,
      qrPayloadUrl: publicReportUrl,
    };
    return authority as unknown as FixedRigMathematicalStationGradingAuthorityV1;
  }

  private async exactWarmManifestBinding(
    manifest: AiGraderLocalStationBridgeManifest,
    side: "front" | "back",
  ): Promise<{ manifestPath: string; manifestSha256: string }> {
    await this.awaitWarmProcessing(manifest, side);
    const packageDir = manifest.outputs[side === "front" ? "frontPackageDir" : "backPackageDir"];
    if (!packageDir) throw new Error("Mathematical V1 is missing the exact " + side + " warm package.");
    const manifestPath = path.join(packageDir, "manifest.json");
    if (!isSubpath(manifestPath, packageDir) || !isSubpath(manifestPath, this.config.outputDir)) {
      throw new Error("Mathematical V1 " + side + " manifest path escaped the station output authority.");
    }
    const bytes = await readFile(manifestPath);
    return {
      manifestPath,
      manifestSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  }

  private async buildMathematicalReviewAssetRegistry(
    manifest: AiGraderLocalStationBridgeManifest,
    request: FixedRigMathematicalFindingReviewRequestV1,
    producedAssets: readonly FixedRigMathematicalFindingReviewAssetV1[],
  ): Promise<Record<string, AiGraderLocalStationMathematicalReviewAssetV1>> {
    const sessionDir = manifest.outputs.sessionDir;
    if (!sessionDir || !manifest.sessionId || !manifest.reportId ||
        request.gradingSessionId !== manifest.sessionId ||
        request.reportId !== manifest.reportId ||
        !SHA256_LOWERCASE_RE.test(request.artifactSha256)) {
      throw new Error("Pending Mathematical review request is not bound to the exact station session/report.");
    }
    if (!request.findings.length) {
      throw new Error("Pending Mathematical review request must name at least one measured finding.");
    }

    type ExpectedAsset = {
      side: "front" | "back";
      metadata: FixedRigMathematicalFindingReviewAssetMetadataV1;
    };
    const expected = new Map<string, ExpectedAsset>();
    const allowedContentTypes = new Set(["image/png", "image/jpeg", "image/tiff"]);
    const assetIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
    const metadataMatches = (
      left: FixedRigMathematicalFindingReviewAssetMetadataV1,
      right: FixedRigMathematicalFindingReviewAssetMetadataV1,
    ) =>
      left.assetId === right.assetId &&
      left.evidenceRole === right.evidenceRole &&
      left.sha256 === right.sha256 &&
      left.fileName === right.fileName &&
      left.contentType === right.contentType &&
      left.byteSize === right.byteSize &&
      left.widthPx === right.widthPx &&
      left.heightPx === right.heightPx;
    const addExpected = (
      side: "front" | "back",
      metadata: FixedRigMathematicalFindingReviewAssetMetadataV1,
      requiredRole: FixedRigMathematicalFindingReviewAssetMetadataV1["evidenceRole"],
    ) => {
      if (!metadata || typeof metadata !== "object" ||
          !assetIdPattern.test(metadata.assetId) ||
          metadata.evidenceRole !== requiredRole ||
          !SHA256_LOWERCASE_RE.test(metadata.sha256) ||
          !metadata.fileName.trim() ||
          path.basename(metadata.fileName) !== metadata.fileName ||
          !allowedContentTypes.has(metadata.contentType) ||
          !Number.isSafeInteger(metadata.byteSize) || metadata.byteSize <= 0 ||
          metadata.byteSize > MATHEMATICAL_REVIEW_ASSET_MAX_BYTES ||
          !Number.isSafeInteger(metadata.widthPx) || metadata.widthPx <= 0 ||
          !Number.isSafeInteger(metadata.heightPx) || metadata.heightPx <= 0) {
        throw new Error(
          "Pending Mathematical review request contains invalid " + requiredRole + " asset metadata.",
        );
      }
      const key = metadata.assetId.toLowerCase();
      const prior = expected.get(key);
      if (prior && (prior.side !== side || !metadataMatches(prior.metadata, metadata))) {
        throw new Error("Pending Mathematical review request reused one asset ID inconsistently.");
      }
      expected.set(key, { side, metadata: structuredClone(metadata) });
    };

    for (const finding of request.findings) {
      if (finding.side !== "front" && finding.side !== "back") {
        throw new Error("Pending Mathematical review finding has an invalid side.");
      }
      if (finding.directionalChannels.length !== 8) {
        throw new Error("Pending Mathematical review finding requires all eight directional channels.");
      }
      addExpected(finding.side, finding.trueView, "normalized_card");
      for (const directional of finding.directionalChannels) {
        addExpected(finding.side, directional, "directional_channel");
      }
      addExpected(finding.side, finding.reviewEvidence.roi, "roi_crop");
      addExpected(finding.side, finding.reviewEvidence.segmentationMask, "segmentation_mask");
      addExpected(finding.side, finding.reviewEvidence.confidenceMask, "confidence_mask");
      addExpected(finding.side, finding.reviewEvidence.illuminationMask, "illumination_mask");
    }

    const exactBytes = new Map<string, Buffer>();
    for (const produced of producedAssets) {
      const key = produced?.assetId?.toLowerCase();
      const expectedAsset = key ? expected.get(key) : undefined;
      if (!expectedAsset || !Buffer.isBuffer(produced.bytes) ||
          !metadataMatches(expectedAsset.metadata, produced) ||
          exactBytes.has(key!)) {
        throw new Error("Station adapter returned an extra, duplicate, or metadata-mismatched review asset.");
      }
      const bytes = Buffer.from(produced.bytes);
      if (bytes.byteLength !== produced.byteSize ||
          crypto.createHash("sha256").update(bytes).digest("hex") !== produced.sha256) {
        throw new Error("Station adapter review asset bytes do not match exact request metadata.");
      }
      exactBytes.set(key!, bytes);
    }

    for (const side of ["front", "back"] as const) {
      const binding = await this.exactWarmManifestBinding(manifest, side);
      const bytes = await readFile(binding.manifestPath);
      const parsed = stationContractObject(
        JSON.parse(bytes.toString("utf-8")),
        "Mathematical " + side + " review source manifest",
      );
      const sideEvidence = stationContractObject(
        parsed[side],
        "Mathematical " + side + " review source evidence",
      );
      const accepted = stationContractObject(
        sideEvidence.acceptedProfile,
        "Mathematical " + side + " accepted-profile evidence",
      );
      const artifacts: Array<{
        assetId: string;
        evidenceRole: "normalized_card" | "directional_channel";
        artifact: Record<string, unknown>;
      }> = [{
        assetId: side + "-accepted-profile",
        evidenceRole: "normalized_card",
        artifact: stationContractObject(
          accepted.analysisArtifact,
          "Mathematical " + side + " accepted-profile artifact",
        ),
      }];
      if (!Array.isArray(sideEvidence.channels)) {
        throw new Error("Mathematical " + side + " review source lacks directional channels.");
      }
      for (const value of sideEvidence.channels) {
        const channel = stationContractObject(
          value,
          "Mathematical " + side + " directional review source",
        );
        if (!Number.isSafeInteger(channel.channel) || Number(channel.channel) < 1 ||
            Number(channel.channel) > 8) {
          throw new Error("Mathematical directional review source has an invalid channel.");
        }
        artifacts.push({
          assetId: side + "-directional-channel-" + Number(channel.channel),
          evidenceRole: "directional_channel",
          artifact: stationContractObject(
            channel.analysisArtifact,
            "Mathematical " + side + " directional review artifact",
          ),
        });
      }
      const packageDir = path.dirname(binding.manifestPath);
      for (const source of artifacts) {
        const key = source.assetId.toLowerCase();
        const required = expected.get(key);
        if (!required || exactBytes.has(key)) continue;
        if (required.side !== side || required.metadata.evidenceRole !== source.evidenceRole) {
          throw new Error("Mathematical review source role does not match the exact request.");
        }
        const filePath = path.resolve(exactStationString(
          source.artifact.localOutputPath,
          "Mathematical review source path",
        ));
        const declaredSha256 = exactStationString(
          source.artifact.sha256,
          "Mathematical review source SHA-256",
        ).toLowerCase();
        if (!isSubpath(filePath, packageDir) || !isSubpath(filePath, this.config.outputDir) ||
            declaredSha256 !== required.metadata.sha256 ||
            !SHA256_LOWERCASE_RE.test(declaredSha256)) {
          throw new Error("Mathematical review source path/hash escaped or mismatched its immutable request.");
        }
        const sourceBytes = await readFile(filePath);
        const extension = path.extname(filePath).toLowerCase();
        const contentType = extension === ".tif" || extension === ".tiff"
          ? "image/tiff"
          : extension === ".jpg" || extension === ".jpeg"
            ? "image/jpeg"
            : "image/png";
        if (sourceBytes.byteLength !== required.metadata.byteSize ||
            path.basename(filePath) !== required.metadata.fileName ||
            contentType !== required.metadata.contentType ||
            crypto.createHash("sha256").update(sourceBytes).digest("hex") !== declaredSha256) {
          throw new Error("Mathematical review source bytes changed after request generation.");
        }
        exactBytes.set(key, sourceBytes);
      }
    }

    let totalByteSize = 0;
    for (const [key, required] of expected) {
      const bytes = exactBytes.get(key);
      if (!bytes) {
        throw new Error(
          "Mathematical review source " + required.metadata.assetId +
          " is unavailable before explicit operator review.",
        );
      }
      totalByteSize += bytes.byteLength;
    }
    if (totalByteSize > MATHEMATICAL_REVIEW_ASSET_TOTAL_MAX_BYTES) {
      throw new Error("Pending Mathematical review assets exceed the bounded aggregate size.");
    }

    const reviewDir = path.join(
      sessionDir,
      "mathematical-v1-finding-review",
      request.artifactSha256,
    );
    if (!isSubpath(reviewDir, sessionDir) || !isSubpath(reviewDir, this.config.outputDir)) {
      throw new Error("Pending Mathematical review asset directory escaped station authority.");
    }
    await mkdir(reviewDir, { recursive: true });
    const registry = new Map<string, AiGraderLocalStationMathematicalReviewAssetV1>();
    const ordered = [...expected.values()].sort((left, right) =>
      left.metadata.assetId.localeCompare(right.metadata.assetId));
    for (const [index, required] of ordered.entries()) {
      const key = required.metadata.assetId.toLowerCase();
      const bytes = exactBytes.get(key)!;
      const extension = required.metadata.contentType === "image/tiff"
        ? "tiff"
        : required.metadata.contentType === "image/jpeg"
          ? "jpg"
          : "png";
      const filePath = path.join(
        reviewDir,
        String(index + 1).padStart(4, "0") + "." + extension,
      );
      if (!isSubpath(filePath, reviewDir)) {
        throw new Error("Pending Mathematical review asset path escaped its immutable request.");
      }
      try {
        await writeFile(filePath, bytes, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      }
      const readback = await readFile(filePath);
      if (readback.byteLength !== required.metadata.byteSize ||
          crypto.createHash("sha256").update(readback).digest("hex") !== required.metadata.sha256) {
        throw new Error("Pending Mathematical review asset readback does not match the exact request.");
      }
      registry.set(required.metadata.assetId, {
        assetId: required.metadata.assetId,
        side: required.side,
        evidenceRole: required.metadata.evidenceRole,
        fileName: required.metadata.fileName,
        contentType: required.metadata.contentType as "image/png" | "image/jpeg" | "image/tiff",
        sha256: required.metadata.sha256,
        byteSize: required.metadata.byteSize,
        widthPx: required.metadata.widthPx,
        heightPx: required.metadata.heightPx,
        filePath,
      });
    }
    return Object.fromEntries(registry);
  }

  private async runMathematicalStationPackage(
    manifest: AiGraderLocalStationBridgeManifest,
    findingReviews?: FixedRigMathematicalFindingReviewV1[],
  ): Promise<AiGraderLocalStationMathematicalExecutionV1> {
    if (gradingContractFor(manifest) !== "mathematical_calibration_v1" ||
        !manifest.mathematicalV1 || !manifest.sessionId || !manifest.reportId) {
      throw new Error("Mathematical V1 processing requires one exact authority-bound station session.");
    }
    if (!this.config.mathematicalCalibrationBundlePath ||
        !this.config.mathematicalCalibrationBundleSha256) {
      throw new Error("Mathematical V1 processing requires one protected finalized calibration bundle.");
    }
    const prior = manifest.mathematicalV1.execution;
    const attempt = (prior?.attempt ?? 0) + 1;
    const startedAt = new Date().toISOString();
    manifest.mathematicalV1.execution = {
      status: "processing",
      startedAt,
      attempt,
      v0FallbackUsed: false,
      ...(prior?.status === "finding_review_required"
        ? { reviewRequestSha256: prior.reviewRequest.artifactSha256 }
        : {}),
    };
    manifest.mathematicalV1.submittedFindingReviews = findingReviews
      ? structuredClone(findingReviews)
      : undefined;
    manifest.updatedAt = startedAt;
    manifest.progressLog.push(
      startedAt + " Mathematical V1 deterministic processing started from the exact finalized bundle and warm side manifests.",
    );
    await writeSessionManifest(manifest);

    let result: BuildFixedRigMathematicalCalibrationStationPackageV1Result;
    try {
      const [front, back] = await Promise.all([
        this.exactWarmManifestBinding(manifest, "front"),
        this.exactWarmManifestBinding(manifest, "back"),
      ]);
      const builder = this.dependencies.buildMathematicalStationPackage ??
        buildFixedRigMathematicalCalibrationStationPackageV1;
      result = await builder({
        authority: this.hydratedMathematicalGradingAuthority(manifest),
        gradingSessionId: manifest.sessionId,
        generatedAt: manifest.mathematicalV1.generatedAt,
        reportId: manifest.reportId,
        outputDir: mathematicalPublishPackageDir(this.config, manifest.reportId),
        captureProfileVersion: manifest.captureProfile === "full_forensic"
          ? "ten-kings-fixed-rig-full-forensic-v1"
          : "ten-kings-fixed-rig-production-fast-v1",
        calibration: {
          bundlePath: this.config.mathematicalCalibrationBundlePath,
          bundleSha256: this.config.mathematicalCalibrationBundleSha256,
          expectedRigId: this.config.mathematicalCalibrationRigId,
        },
        warmSides: { front, back },
        ...(findingReviews ? { findingReviews: structuredClone(findingReviews) } : {}),
      });
      if (result.gradingContract !== "mathematical_calibration_v1" || result.v0FallbackUsed !== false) {
        throw new Error("Mathematical station adapter returned cross-contract or fallback output.");
      }
    } catch (error) {
      result = {
        version: "fixed_rig_mathematical_calibration_orchestrator_v1",
        status: "insufficient_evidence",
        gradingContract: "mathematical_calibration_v1",
        v0FallbackUsed: false,
        failedStage: "input_contract",
        reasons: [
          "Unexpected deterministic Mathematical V1 station integration failure: " +
          (error instanceof Error ? error.message : "unknown station adapter error"),
        ],
        requiresRecapture: false,
        requiresApprovedDesignReference: false,
        requiresCalibration: false,
        requiresImplementationCorrection: true,
        reportPackage: null,
        stationInput: null,
      };
    }

    let reviewAssets: Record<string, AiGraderLocalStationMathematicalReviewAssetV1> | undefined;
    if (result.status === "finding_review_required") {
      try {
        reviewAssets = await this.buildMathematicalReviewAssetRegistry(
          manifest,
          result.reviewRequest,
          result.reviewAssets,
        );
      } catch (error) {
        result = {
          version: "fixed_rig_mathematical_calibration_orchestrator_v1",
          status: "insufficient_evidence",
          gradingContract: "mathematical_calibration_v1",
          v0FallbackUsed: false,
          failedStage: "finding_review",
          reasons: [
            "Pending finding-review evidence could not be exposed from exact immutable sources: " +
            (error instanceof Error ? error.message : "unknown review-asset binding error"),
          ],
          requiresRecapture: false,
          requiresApprovedDesignReference: false,
          requiresCalibration: false,
          requiresImplementationCorrection: true,
          reportPackage: null,
          stationInput: null,
        };
      }
    }
    const completedAt = new Date().toISOString();
    if (result.status === "completed") {
      delete manifest.mathematicalV1.reviewAssets;
      this.applyMathematicalReportPackage(manifest, result.reportPackage);
      manifest.outputs.unifiedReportDir = result.reportPackage.outputDir;
      manifest.outputs.unifiedReportPath = result.reportPackage.bundlePath;
      manifest.mathematicalV1.execution = {
        status: "completed",
        completedAt,
        attempt,
        v0FallbackUsed: false,
        reportPackagePath: result.reportPackage.outputDir,
        reportBundlePath: result.reportPackage.bundlePath,
        orchestrationTraceSha256: result.orchestrationTraceSha256,
        grade: result.grade,
        summary: result.summary,
      };
      manifest.progressLog.push(
        completedAt + " Mathematical V1 strict V0.3 package completed with all four elements and no V0/manual fallback.",
      );
    } else if (result.status === "finding_review_required") {
      manifest.mathematicalV1.reviewAssets = reviewAssets;
      manifest.mathematicalV1.execution = {
        status: "finding_review_required",
        completedAt,
        attempt,
        v0FallbackUsed: false,
        reviewRequest: structuredClone(result.reviewRequest),
        reviewIssues: [...result.reviewIssues],
      };
      manifest.progressLog.push(
        completedAt + " Mathematical V1 requires explicit operator review bound to request " +
        result.reviewRequest.artifactSha256 + "; no finding was auto-confirmed.",
      );
    } else {
      delete manifest.mathematicalV1.reviewAssets;
      manifest.mathematicalV1.execution = {
        status: "insufficient_evidence",
        completedAt,
        attempt,
        v0FallbackUsed: false,
        failedStage: result.failedStage,
        reasons: [...result.reasons],
        requiresRecapture: result.requiresRecapture,
        requiresApprovedDesignReference: result.requiresApprovedDesignReference,
        requiresCalibration: result.requiresCalibration,
        requiresImplementationCorrection: result.requiresImplementationCorrection,
      };
      const warning = "Mathematical V1 insufficient evidence: " + result.reasons.join("; ");
      if (!manifest.warnings.includes(warning)) manifest.warnings.push(warning);
      manifest.progressLog.push(
        completedAt + " Mathematical V1 stopped at " + result.failedStage +
        " with explicit insufficient evidence; no V0/manual fallback ran.",
      );
    }
    manifest.currentStep = "view_unified_report";
    manifest.updatedAt = completedAt;
    await writeSessionManifest(manifest);
    return manifest.mathematicalV1.execution;
  }

  private validatedMathematicalFindingReviews(
    manifest: AiGraderLocalStationBridgeManifest,
    reviewRequestSha256: unknown,
    reviews: unknown,
  ): FixedRigMathematicalFindingReviewV1[] {
    const execution = manifest.mathematicalV1?.execution;
    if (execution?.status !== "finding_review_required") {
      throw new Error("Mathematical finding reviews require the exact pending finding-review request.");
    }
    if (reviewRequestSha256 !== execution.reviewRequest.artifactSha256) {
      throw new Error("Mathematical finding reviews are not bound to the exact pending request SHA-256.");
    }
    if (!Array.isArray(reviews)) {
      throw new Error("Mathematical finding reviews must be an explicit complete array.");
    }
    const expectedIds = new Set(execution.reviewRequest.findings.map((finding) => finding.findingId));
    const seen = new Set<string>();
    const parsed = reviews.map((value, index): FixedRigMathematicalFindingReviewV1 => {
      const review = stationContractObject(value, "Mathematical finding review " + (index + 1));
      assertStationContractKeys(
        review,
        ["findingId", "reviewRequestSha256", "status", "reviewedAt"],
        "Mathematical finding review " + (index + 1),
      );
      const findingId = exactStationString(review.findingId, "Mathematical finding review findingId");
      if (!expectedIds.has(findingId) || seen.has(findingId)) {
        throw new Error("Mathematical finding reviews contain an unexpected or duplicate finding ID.");
      }
      seen.add(findingId);
      if (review.reviewRequestSha256 !== execution.reviewRequest.artifactSha256) {
        throw new Error("Every Mathematical finding review must bind the exact request SHA-256.");
      }
      if (review.status !== "confirmed" && review.status !== "adjusted") {
        throw new Error("Every Mathematical finding review must be explicitly confirmed or adjusted.");
      }
      const reviewedAt = exactStationString(review.reviewedAt, "Mathematical finding review reviewedAt");
      if (!Number.isFinite(Date.parse(reviewedAt))) {
        throw new Error("Mathematical finding review reviewedAt must be an ISO timestamp.");
      }
      return {
        findingId,
        reviewRequestSha256: execution.reviewRequest.artifactSha256,
        status: review.status,
        reviewedAt,
      };
    });
    if (seen.size !== expectedIds.size) {
      throw new Error("Every finding in the exact Mathematical review request requires an explicit operator decision.");
    }
    return parsed;
  }

  private transitionRapidWorkflow(
    manifest: AiGraderLocalStationBridgeManifest,
    state: AiGraderRapidCaptureWorkflowState,
    detail: string,
  ) {
    if (manifest.rapidCapture.workflowState === "failed" && state !== "failed") {
      manifest.progressLog.push(`${new Date().toISOString()} Ignored rapid workflow transition ${state}; failed is terminal for this card.`);
      return;
    }
    const event: AiGraderRapidCaptureWorkflowEvent = {
      state,
      at: new Date().toISOString(),
      detail,
    };
    manifest.rapidCapture.workflowState = state;
    manifest.rapidCapture.workflowHistory = [...manifest.rapidCapture.workflowHistory, event].slice(-100);
    manifest.updatedAt = event.at;
    manifest.progressLog.push(`${event.at} Rapid capture workflow: ${state} - ${detail}`);
    const queueItemId = manifest.rapidCapture.queueItemId;
    if (!queueItemId) return;
    const item = this.rapidQueue.items.find((candidate) => candidate.queueItemId === queueItemId);
    if (!item) return;
    item.state = state;
    item.updatedAt = event.at;
    item.history = [...item.history, event].slice(-100);
    item.mathematicalV1 = mathematicalRapidQueueSummary(manifest.mathematicalV1?.execution);
    if (state !== "failed") delete item.error;
    this.queuedManifests.set(queueItemId, manifest);
  }

  private persistRapidQueue(): Promise<void> {
    this.rapidQueue.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(this.rapidQueue);
    this.queueWriteChain = this.queueWriteChain
      .catch(() => {})
      .then(async () => {
        await writeJsonAtomic(rapidCaptureQueuePath(this.config), snapshot);
        this.committedRapidQueue = structuredClone(snapshot);
      });
    return this.queueWriteChain;
  }

  private async syncQueuedManifest(manifest: AiGraderLocalStationBridgeManifest) {
    const queueItemId = manifest.rapidCapture.queueItemId;
    if (!queueItemId) return;
    const item = this.rapidQueue.items.find((candidate) => candidate.queueItemId === queueItemId);
    if (!item) return;
    item.state = manifest.rapidCapture.workflowState ?? item.state;
    item.updatedAt = manifest.updatedAt;
    item.history = [...manifest.rapidCapture.workflowHistory];
    item.mathematicalV1 = mathematicalRapidQueueSummary(manifest.mathematicalV1?.execution);
    item.error = item.state === "failed" ? manifest.warnings.at(-1) ?? item.error : undefined;
    this.queuedManifests.set(queueItemId, manifest);
    await writeSessionManifest(manifest);
    await this.persistRapidQueue();
  }

  private enqueueRapidFinalization(queueItemId: string) {
    this.reportWorker = this.reportWorker
      .catch(() => {})
      .then(async () => {
        const manifest = this.queuedManifests.get(queueItemId);
        const item = this.rapidQueue.items.find((candidate) => candidate.queueItemId === queueItemId);
        if (!manifest || !item) throw new Error(`Rapid capture queue item ${queueItemId} is no longer available.`);
        try {
          const reportId = manifest.reportId ?? "local-report";
          if (gradingContractFor(manifest) === "mathematical_calibration_v1") {
            const execution = await this.runMathematicalStationPackage(manifest);
            if (execution.status === "finding_review_required") {
              this.transitionRapidWorkflow(
                manifest,
                "finding_review_required",
                "Exact measured findings require operator review bound to request " +
                execution.reviewRequest.artifactSha256 + "; this queued card remains reviewable.",
              );
              await this.syncQueuedManifest(manifest);
              return;
            }
            if (execution.status === "insufficient_evidence") {
              this.transitionRapidWorkflow(
                manifest,
                "insufficient_evidence",
                "Mathematical V1 stopped fail-closed at " + execution.failedStage +
                "; no V0/manual fallback was used.",
              );
              await this.syncQueuedManifest(manifest);
              return;
            }
            if (execution.status !== "completed") {
              throw new Error("Mathematical V1 Rapid processing did not reach a durable terminal state.");
            }
          } else {
            const result = await this.runWarmReport(manifest);
            manifest.outputs.unifiedReportDir = result.payload?.report?.packageDir ?? dirnameIfFile(extractUnifiedReportPath(result.payload));
            manifest.outputs.unifiedReportPath = extractUnifiedReportPath(result.payload);
            const reportDir = manifest.outputs.unifiedReportDir ?? dirnameIfFile(manifest.outputs.unifiedReportPath);
            if (!reportDir) throw new Error("Rapid finalization did not produce a unified report folder.");
            const packageDir = publishPackageDir(this.config, reportId);
            const bundle = await withAiGraderReportPackageOperation(reportId, async () => {
              await reconcileAiGraderReportPackageTransaction({
                canonicalDir: packageDir,
                reportId,
                gradingSessionId: manifest.sessionId,
                reportDir,
              });
              return writeAiGraderReportBundle({
                reportDir,
                outputDir: packageDir,
                reportId,
                gradingSessionId: manifest.sessionId,
                publicBasePath: this.config.publicBasePath,
                captureTiming: this.captureTimingSnapshot(manifest),
                geometryCaptureDecisions: this.geometryCaptureDecisionSnapshot(manifest),
              });
            });
            manifest.outputs.reportBundlePath = bundle.bundlePath;
            manifest.outputs.publishPackageDir = bundle.outputDir;
            manifest.outputs.assetManifestPath = bundle.assetManifestPath;
            manifest.outputs.checksumsPath = bundle.checksumsPath;
            manifest.reportBundle = bundle.bundle;
          }
          const release = await this.writeProductionReleaseForManifest(manifest, {
            operatorId: "rapid-background-preparation",
            warningsAccepted: true,
            overrideReason: "Canonical Rapid background preparation before the separate authenticated Approve & Publish authority.",
          });
          if (
            release.reportId !== reportId
            || release.gradingSessionId !== manifest.sessionId
            || release.finalGradeComputed !== true
            || release.labelDataGenerated !== true
            || release.qrPayloadGenerated !== true
            || release.label.status !== "label_data_ready"
            || !manifest.outputs.productionReleasePath
            || !manifest.outputs.labelDataPath
          ) {
            throw new Error("Rapid background preparation did not produce the exact final grade and label-ready release for this queued report.");
          }
          manifest.currentStep = "label_data_ready";
          this.transitionRapidWorkflow(
            manifest,
            "report_ready_needs_confirm",
            "Background diagnostics, final grade, finalized release, and label data are ready for the single Approve & Publish authority.",
          );
          await this.syncQueuedManifest(manifest);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Rapid background finalization failed.";
          if (!manifest.warnings.includes(message)) manifest.warnings.push(message);
          this.transitionRapidWorkflow(manifest, "failed", message);
          const failedItem = this.rapidQueue.items.find((candidate) => candidate.queueItemId === queueItemId);
          if (failedItem) failedItem.error = message;
          await this.syncQueuedManifest(manifest);
        }
      });
    void this.reportWorker.catch(() => {});
  }

  private async recoverPersistedRapidFinalization() {
    const outputRoot = `${path.resolve(this.config.outputDir).toLowerCase()}${path.sep}`;
    for (const item of this.rapidQueue.items.filter((candidate) => candidate.state === "finalizing")) {
      const resolvedManifestPath = path.resolve(item.manifestPath);
      if (!resolvedManifestPath.toLowerCase().startsWith(outputRoot) || path.basename(resolvedManifestPath) !== "station-session.json") {
        item.state = "failed";
        item.error = "Rapid finalization recovery failed because the persisted manifest reference was invalid.";
        item.updatedAt = new Date().toISOString();
        continue;
      }
      const manifest = await readJsonFile(resolvedManifestPath) as AiGraderLocalStationBridgeManifest | undefined;
      if (!manifest || manifest.sessionId !== item.sessionId || manifest.reportId !== item.reportId) {
        item.state = "failed";
        item.error = "Rapid finalization recovery failed because the persisted session identity did not match the queue item.";
        item.updatedAt = new Date().toISOString();
        continue;
      }
      manifest.rapidCapture ??= {
        enabled: true,
        workflowHistory: [],
        humanConfirmationRequired: true,
        autoConfirm: false,
        autoPublish: false,
      };
      manifest.rapidCapture.queueItemId = item.queueItemId;
      this.ensureCaptureTiming(manifest);
      this.queuedManifests.set(item.queueItemId, manifest);
      const sideProcessingComplete = (["front", "back"] as const).every((side) =>
        manifest.warmRunnerStatus?.phases?.some((phase) => phase.id === `process_${side}_artifacts` && phase.status === "completed"),
      );
      if (sideProcessingComplete) {
        this.enqueueRapidFinalization(item.queueItemId);
        continue;
      }
      const message = "Rapid finalization recovery stopped because the bridge restarted before both side-processing packages completed.";
      if (!manifest.warnings.includes(message)) manifest.warnings.push(message);
      this.transitionRapidWorkflow(manifest, "failed", message);
      item.error = message;
      await writeSessionManifest(manifest);
    }
    await this.persistRapidQueue();
  }

  private async queueCurrentRapidCard() {
    if (!this.rapidQueue.rapidCaptureEnabled || !this.manifest.rapidCapture.enabled) {
      throw new Error("Enable Rapid Capture before queueing the current card.");
    }
    if (this.captureLock) {
      throw new Error(`Cannot queue the current card while capture lock is held by ${this.captureLock.owner}.`);
    }
    const { sessionId, reportId } = this.manifest;
    if (!sessionId || !reportId || !this.manifest.outputs.manifestPath) {
      throw new Error("Rapid Capture queueing requires an active station session and report identity.");
    }
    if (!this.manifest.outputs.frontPackageDir || !this.manifest.outputs.backPackageDir) {
      throw new Error("Rapid Capture queueing requires persisted front and back capture packages.");
    }
    if (this.manifest.captureFailure || this.manifest.rapidCapture.workflowState === "failed") {
      throw new Error("A failed card cannot enter the Rapid Capture ready queue.");
    }
    const snapshot = this.manifest;
    const queueItemId = `${sessionId}-rapid-card`;
    snapshot.rapidCapture.queueItemId = queueItemId;
    snapshot.rapidCapture.safelyQueuedAt = new Date().toISOString();
    this.recordCaptureTimingEvent(snapshot, { id: "safely_queued", at: snapshot.rapidCapture.safelyQueuedAt });
    this.transitionRapidWorkflow(
      snapshot,
      "finalizing",
      "Both raw side packages are persisted; one serialized worker is completing the report in the background.",
    );
    const item: PersistedAiGraderRapidCaptureQueueItem = {
      queueItemId,
      sessionId,
      reportId,
      state: "finalizing",
      queuedAt: snapshot.rapidCapture.safelyQueuedAt,
      updatedAt: snapshot.updatedAt,
      history: [...snapshot.rapidCapture.workflowHistory],
      humanConfirmationRequired: true,
      autoConfirmed: false,
      autoPublished: false,
      manifestPath: snapshot.outputs.manifestPath!,
    };
    this.rapidQueue.items = retainAiGraderRapidCaptureQueueItems([
      item,
      ...this.rapidQueue.items.filter((candidate) => candidate.queueItemId !== queueItemId),
    ]);
    this.queuedManifests.set(queueItemId, snapshot);
    await writeSessionManifest(snapshot);
    await this.persistRapidQueue();
    this.enqueueRapidFinalization(queueItemId);
    await this.createFreshSession(
      { captureProfile: snapshot.captureProfile, gradingContract: gradingContractFor(snapshot) },
      new Date().toISOString(),
      "rapid_continuation",
    );
  }

  private async activateRapidQueueItem(queueItemId: string) {
    if (!queueItemId.trim()) throw new Error("Rapid Capture queue item ID is required.");
    if (this.captureLock) throw new Error(`Cannot activate a queued card while capture lock is held by ${this.captureLock.owner}.`);
    if (
      this.previewProcess
      || this.previewStop
      || this.manifest.previewStatus.status === "live"
      || this.manifest.previewStatus.status === "starting"
      || this.manifest.previewStatus.cameraOwnership === "preview_stream"
    ) {
      await this.stopPreviewStream("Rapid Capture review activation", {
        waitForRelease: true,
        requireRelease: true,
        settleMs: PREVIEW_CAMERA_SETTLE_MS,
      });
    }
    if (this.manifest.outputs.frontPackageDir || this.manifest.outputs.backPackageDir) {
      throw new Error("Queue the active card before opening a completed Rapid Capture report.");
    }
    const freshSessionProgressed = Boolean(this.manifest.sessionId) && (
      this.manifest.currentStep !== "capture_front"
      || this.manifest.commandResults.length > 0
      || this.manifest.rapidCapture.workflowHistory.length > 0
    );
    if (freshSessionProgressed) {
      throw new Error("The next card has already started; finish or reset it before opening a queued report.");
    }
    const item = this.rapidQueue.items.find((candidate) => candidate.queueItemId === queueItemId);
    if (!item) throw new Error(`Rapid Capture queue item ${queueItemId} was not found.`);
    if (![
      "finding_review_required",
      "insufficient_evidence",
      "report_ready_needs_confirm",
      "confirmed_needs_publish",
      "published",
    ].includes(item.state)) {
      throw new Error(`Rapid Capture queue item ${queueItemId} is not ready for review (state ${item.state}).`);
    }
    let manifest = this.queuedManifests.get(queueItemId);
    if (!manifest) manifest = await readJsonFile(item.manifestPath) as AiGraderLocalStationBridgeManifest | undefined;
    if (!manifest || manifest.sessionId !== item.sessionId || manifest.reportId !== item.reportId) {
      throw new Error(`Rapid Capture queue item ${queueItemId} has no matching persisted session manifest.`);
    }
    if (this.manifest.sessionId) await this.releaseStationRuntimeForReplacement("Rapid Capture review activation");
    this.manifest = cloneManifest(manifest);
    this.releaseFullForensicPreviewHold("Rapid Capture report opened for Approve & Publish");
    this.manifest.rapidCapture.enabled = this.rapidQueue.rapidCaptureEnabled;
    this.manifest.rapidCapture.queueItemId = queueItemId;
    this.activeQueueItemId = queueItemId;
    this.queuedManifests.set(queueItemId, this.manifest);
    this.manifest.progressLog.push(`${new Date().toISOString()} Opened Rapid Capture report for the single Approve & Publish authority.`);
    await writeSessionManifest(this.manifest);
  }

  private async releaseStationRuntimeForReplacement(reason: string) {
    let previewError: unknown;
    let safeOffError: unknown;
    try {
      await this.stopPreviewStream(reason, {
        waitForRelease: true,
        requireRelease: true,
        settleMs: PREVIEW_CAMERA_SETTLE_MS,
      });
    } catch (error) {
      previewError = error;
    }
    const safeOff = await this.runTerminalSafeOff(reason);
    if (!safeOff.ok) safeOffError = safeOff.directError ?? safeOff.guardedCleanupError ?? new Error("Session replacement safe-off could not be verified.");
    await writeSessionManifest(this.manifest);
    if (previewError) throw new Error(boundedPreviewLifecycleError(previewError));
    if (safeOffError) {
      const rawMessage = safeOffError instanceof Error
        ? safeOffError.message
        : typeof safeOffError === "object" && safeOffError !== null && "message" in safeOffError
          ? String((safeOffError as { message: unknown }).message)
          : "Session replacement safe-off could not be verified.";
      throw new Error(boundedBackPositioningError(new Error(rawMessage)).message);
    }
  }

  private createFreshSession(
    request: {
      reportId?: string;
      captureProfile: FixedRigCaptureProfile;
      gradingContract?: AiGraderGradingContract;
      mathematicalGradingAuthority?: AiGraderLocalStationMathematicalGradingAuthorityV1;
    },
    now = new Date().toISOString(),
    selectionSource: AiGraderLocalStationBridgeManifest["captureProfileGuard"]["selectionSource"] = "operator_setting"
  ) {
    return this.serializeTerminalLifecycle(async () => {
      await this.awaitLightingLifecycleIdle();
      return this.createFreshSessionUnlocked(request, now, selectionSource);
    });
  }

  private async createFreshSessionUnlocked(
    request: {
      reportId?: string;
      captureProfile: FixedRigCaptureProfile;
      gradingContract?: AiGraderGradingContract;
      mathematicalGradingAuthority?: AiGraderLocalStationMathematicalGradingAuthorityV1;
    },
    now = new Date().toISOString(),
    selectionSource: AiGraderLocalStationBridgeManifest["captureProfileGuard"]["selectionSource"] = "operator_setting"
  ) {
    if (this.captureLock) {
      throw new Error(`Cannot start a new card while capture lock is held by ${this.captureLock.owner}.`);
    }
    if (this.manifest.sessionId) {
      let processingError: Error | undefined;
      if (selectionSource !== "rapid_continuation") {
        try {
          await this.cancelWarmProcessingSession(this.manifest.sessionId, "station session replacement");
        } catch (error) {
          processingError = new Error(boundedProcessingWorkerError(error));
          this.manifest.warmRunnerStatus.status = "failed";
          if (!this.manifest.warnings.includes(processingError.message)) this.manifest.warnings.push(processingError.message);
        }
      }
      let runtimeError: Error | undefined;
      try {
        await this.releaseStationRuntimeForReplacement("station session replacement");
      } catch (error) {
        runtimeError = error instanceof Error ? error : new Error(boundedPreviewLifecycleError(error));
      }
      if (processingError || runtimeError) {
        await writeSessionManifest(this.manifest);
        throw new Error([runtimeError?.message, processingError?.message].filter(Boolean).join(" "));
      }
    }
    const { packageId, packageDir } = await createFixedRigPackageDir(this.config.outputDir, "ai-grader-browser-station-session");
    this.releaseFullForensicPreviewHold("new station session started");
    this.clearLiveLightingWatchdog();
    const manifest = newManifest(this.config, this.rapidQueue.rapidCaptureEnabled, now);
    manifest.gradingContract = request.gradingContract ?? "legacy_v0";
    manifest.captureProfile = parseCaptureProfile(request.captureProfile);
    manifest.captureProfileGuard.selectionSource = selectionSource;
    manifest.captureProfileGuard.productionFastOptIn = request.captureProfile === "production_fast";
    manifest.captureTiming = createAiGraderCaptureTimingMetadata({
      captureProfile: manifest.captureProfile,
      hardwareMeasurement: false,
      startedAt: now,
    });
    manifest.sessionId = `${packageId}-session`;
    manifest.reportId = request.reportId ?? `${packageId}-report`;
    manifest.createdAt = now;
    manifest.updatedAt = now;
    manifest.outputs.sessionDir = packageDir;
    manifest.outputs.manifestPath = path.join(packageDir, "station-session.json");
    manifest.currentStep = "capture_front";
    if (manifest.gradingContract === "mathematical_calibration_v1" && request.mathematicalGradingAuthority) {
      this.bindMathematicalGradingAuthority(manifest, request.mathematicalGradingAuthority);
    }
    manifest.warmRunnerStatus.sessionId = manifest.sessionId;
    manifest.warmRunnerStatus.status = "warming";
    this.manifest = manifest;
    this.frontCaptureOperations.clear();
    this.frontCaptureInFlightKey = undefined;
    this.backCaptureOperations.clear();
    this.backCaptureInFlightKey = undefined;
    this.activeQueueItemId = undefined;
    this.resetPreviewGeometryAnalysis();
    this.setExecutionPath("warm_full_forensic_runner", undefined, manifest);
    this.markWarmPhase({
      id: "warm_session_setup",
      label: "Warm session setup",
      status: "completed",
      backend: manifest.executionPath,
      executionPath: manifest.executionPath,
      detail: "Bridge-owned warm session initialized; Basler/Leimac ownership is serialized through the capture lock.",
    }, manifest);
    manifest.warmRunnerStatus.status = "idle";
    manifest.progressLog.push(`${now} Started station session ${manifest.sessionId} with clean per-card state.`);
    await writeSessionManifest(manifest);
    try {
      await this.applyConfiguredDefaultLightingUnlocked(
        selectionSource === "rapid_continuation"
          ? "Rapid continuation configured positioning light"
          : "Start New Card configured positioning light",
      );
      manifest.progressLog.push(`${new Date().toISOString()} Configured positioning light is controller-acknowledged and Capture Front lighting-ready.`);
      await writeSessionManifest(manifest);
    } catch (error) {
      const message = boundedBackPositioningError(error).message;
      manifest.progressLog.push(`${new Date().toISOString()} Configured positioning light was not fully acknowledged; this session is not capture-ready.`);
      await writeSessionManifest(manifest);
      throw new Error(`Start New Card could not establish the configured positioning light. Retry Start New Card. ${message}`);
    }
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

  private updateLiveLightingStatus(update: AiGraderLiveLightingStatusUpdate) {
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
      physicalState: {
        ...this.manifest.liveLighting.physicalState,
        ...(update.physicalState ?? {}),
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
      backPositioning: {
        ...this.manifest.liveLighting.backPositioning,
        ...(update.backPositioning ?? {}),
      },
    };
  }

  private stopOrphanedPreviewStreamsUntilReleased(timeoutMs: number, settleMs: number) {
    if (this.dependencies.stopOrphanedPreviewStreamsUntilReleased) {
      return this.dependencies.stopOrphanedPreviewStreamsUntilReleased(timeoutMs, settleMs);
    }
    this.dependencies.onRealHardwareBoundary?.("orphan_preview_process_scan");
    return stopOrphanedBaslerPreviewStreamsUntilReleased(timeoutMs, settleMs);
  }

  private stopPreviewProcessTree(child: ChildProcessWithoutNullStreams) {
    if (this.dependencies.stopPreviewProcessTree) {
      this.dependencies.stopPreviewProcessTree(child);
      return;
    }
    this.dependencies.onRealHardwareBoundary?.("preview_process_stop");
    stopChildProcessTree(child);
  }

  private startPreviewProcess() {
    const input = {
      pylonRoot: this.config.pylonRoot,
      bridgeScriptPath: this.config.baslerBridgeScript,
      timeoutMs: this.config.pylonTimeoutMs ?? 1800000,
      cameraIndex: this.config.cameraIndex,
      exposureUs: this.manifest.acceptedProfile.exposureUs,
      refreshIntervalMs: 100,
      jpegQuality: 72,
    };
    if (this.dependencies.startPreviewProcess) return this.dependencies.startPreviewProcess(input);
    this.dependencies.onRealHardwareBoundary?.("preview_process_start");
    const client = new BaslerPylonClient({
      pylonRoot: input.pylonRoot,
      bridgeScriptPath: input.bridgeScriptPath,
      timeoutMs: input.timeoutMs,
    });
    return client.startOperatorPreviewMjpegStream({
      cameraIndex: input.cameraIndex,
      exposureUs: input.exposureUs,
      refreshIntervalMs: input.refreshIntervalMs,
      jpegQuality: input.jpegQuality,
    });
  }

  private updateBackPositioningLight(update: Partial<AiGraderBackPositioningLightStatus>) {
    this.updateLiveLightingStatus({
      backPositioning: {
        ...this.manifest.liveLighting.backPositioning,
        ...update,
      },
    });
    this.updatePreviewStatus({
      positioningLightReady: update.captureReady ?? this.manifest.liveLighting.backPositioning.captureReady,
    });
  }

  private recordBackPositioningLightEvent(event: Omit<AiGraderBackPositioningLightEvent, "at">) {
    const nextEvent: AiGraderBackPositioningLightEvent = { at: new Date().toISOString(), ...event };
    this.updateBackPositioningLight({
      events: [
        ...this.manifest.liveLighting.backPositioning.events.slice(-(BACK_POSITIONING_EVENT_LIMIT - 1)),
        nextEvent,
      ],
    });
    this.manifest.progressLog.push(
      `${nextEvent.at} Back positioning light ${event.type} (${event.trigger})${event.profileIdentity ? ` profile ${event.profileIdentity}` : ""}.`
    );
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

  private scheduleLiveLightingWatchdog(reason: string, timeoutMs = LIVE_LIGHTING_WATCHDOG_MS) {
    if (this.liveLightingWatchdog) clearTimeout(this.liveLightingWatchdog);
    const lastHeartbeatAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
    this.updateLiveLightingStatus({
      watchdog: {
        enabled: true,
        timeoutMs,
        lastHeartbeatAt,
        expiresAt,
      },
    });
    this.liveLightingWatchdog = setTimeout(() => {
      void this.handleLiveLightingWatchdogExpiry(reason).catch(async (error) => {
        const message = boundedBackPositioningError(error).message;
        this.updatePreviewStatus({ status: "error", positioningLightReady: false, lastError: message });
        if (!this.manifest.warnings.includes(message)) this.manifest.warnings.push(message);
        await writeSessionManifest(this.manifest).catch(() => undefined);
      });
    }, timeoutMs);
    this.liveLightingWatchdog.unref?.();
  }

  private async handleLiveLightingWatchdogExpiry(reason: string) {
    if (this.closing) return;
    const frontCapture = this.frontCaptureTransition?.promise;
    if (frontCapture) await frontCapture.catch(() => undefined);
    await this.serializeTerminalLifecycle(async () => {
      const atomic = this.currentAtomicBackCapturePromise();
      if (atomic) await atomic.catch(() => undefined);
      await this.awaitLightingLifecycleIdle();
      const positioningWasActive = this.manifest.currentStep === "prompt_flip_card"
        && new Set(["restoring", "waiting_for_frame", "ready"])
          .has(this.manifest.liveLighting.backPositioning.status);
      let cleanupError: unknown;
      if (this.manifest.liveLighting.physicalState.state !== "safe_off_verified") {
        try {
          await this.safeOffLiveLighting(`watchdog timeout after ${reason}`, "watchdog_safe_off");
        } catch (error) {
          cleanupError = error;
        }
      }
      if (positioningWasActive) {
        const lastError = boundedBackPositioningError(
          new Error("Back positioning light safe-off: a fresh live preview frame and heartbeat were not received in time."),
          "AI_GRADER_BACK_PREVIEW_FRAME_REQUIRED"
        );
        this.updateBackPositioningLight({ status: "failed", captureReady: false, lastError });
        this.recordBackPositioningLightEvent({
          type: "restore_failure",
          trigger: "safety",
          profileIdentity: this.manifest.liveLighting.backPositioning.profileIdentity,
          error: lastError,
        });
      }
      await writeSessionManifest(this.manifest);
      if (cleanupError) throw cleanupError;
    });
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

  private async writeLiveLightingFrames(frames: LeimacIdmuWriteFrame[]): Promise<AiGraderLocalStationLightingWriteResult[]> {
    if (this.dependencies.writeLightingFrames) return this.dependencies.writeLightingFrames(frames);
    if (this.config.mode === "mock") {
      return frames.map(() => ({ responseKind: "mock" as const, ok: true as const }));
    }
    this.dependencies.onRealHardwareBoundary?.("lighting_network");
    const client = this.liveLeimacClient();
    const writes: LeimacIdmuWriteResult[] = [];
    for (const frame of frames) {
      const result = await client.writeAllowlistedFrame(frame);
      writes.push(result);
      if (!result.ok) throw new Error(result.error ?? `Leimac live lighting write ${frame.name} failed.`);
    }
    return writes;
  }

  private async captureMathematicalCalibrationHardwareBoundary(
    input: FixedRigMathematicalCalibrationCaptureBoundaryRequestV1,
  ): Promise<FixedRigMathematicalCalibrationCaptureBoundaryResultV1> {
    if (this.dependencies.captureMathematicalCalibrationFrame) {
      return this.dependencies.captureMathematicalCalibrationFrame(input);
    }
    if (this.config.mode !== "real") {
      throw new Error("Mathematical calibration image capture requires an injected hardware-free test boundary or an armed real station bridge.");
    }
    assertRealBridgeArmed(this.config);
    const safeOffBefore = await this.runTerminalSafeOff(`mathematical calibration ${input.operationId} pre-capture`);
    if (!safeOffBefore.ok) {
      throw new Error(safeOffBefore.directError?.message ?? safeOffBefore.guardedCleanupError?.message ?? "Calibration pre-capture safe-off could not be confirmed.");
    }
    const profile: AiGraderLiveLightingProfile = {
      enabled: input.lighting.mode !== "safe_off" && input.lighting.enabledChannels.length > 0,
      dutyPercent: input.lighting.dutyPercent,
      actualLeimacPwmStep: leimacIdmuDutyPercentToSteps(input.lighting.dutyPercent),
      channels: input.lighting.enabledChannels,
      source: "accepted_station_profile",
      acceptedForCapture: true,
    };
    const frames = this.liveLightingFrames(profile);
    let verification: ReturnType<AiGraderLocalStationBridgeService["strictLightingAcknowledgements"]> | undefined;
    let captureResult: Awaited<ReturnType<BaslerPylonClient["captureStill"]>> | undefined;
    let operationError: Error | undefined;
    let safeOffAfter: Awaited<ReturnType<AiGraderLocalStationBridgeService["runTerminalSafeOff"]>> | undefined;
    try {
      const writes = await this.executeLiveLightingFrames(frames);
      verification = this.strictLightingAcknowledgements(frames, writes);
      await mkdir(input.outputDir, { recursive: true });
      this.dependencies.onRealHardwareBoundary?.("calibration_camera_capture");
      const client = new BaslerPylonClient({
        pylonRoot: this.config.pylonRoot,
        bridgeScriptPath: this.config.baslerBridgeScript,
        timeoutMs: this.config.pylonTimeoutMs ?? 1800000,
      });
      captureResult = await client.captureStill({
        outputDir: input.outputDir,
        label: input.label,
        cameraIndex: input.protectedSettings.cameraIndex,
        savedFormat: "png",
        exposureUs: input.protectedSettings.exposureUs,
        gain: input.protectedSettings.gain,
      });
    } catch (error) {
      operationError = error instanceof Error ? error : new Error("Mathematical calibration capture failed.");
    } finally {
      safeOffAfter = await this.runTerminalSafeOff(`mathematical calibration ${input.operationId} post-capture`);
    }
    if (!safeOffAfter.ok) {
      const message = safeOffAfter.directError?.message ?? safeOffAfter.guardedCleanupError?.message ?? "Calibration post-capture safe-off could not be confirmed.";
      throw new Error(operationError ? `${operationError.message} Post-capture safe-off also failed: ${message}` : message);
    }
    if (operationError) throw operationError;
    if (!captureResult || !verification) throw new Error("Calibration capture did not return exact camera/lighting evidence.");
    const pylonVersion = captureResult.pylon.version?.trim();
    const cameraSerial = captureResult.camera.serialNumber?.trim();
    const cameraModel = captureResult.camera.modelName?.trim() ?? captureResult.camera.friendlyName?.trim();
    if (!pylonVersion || !cameraSerial || !cameraModel) {
      throw new Error("Calibration capture requires exact pylon version and Basler camera serial/model provenance.");
    }
    if (captureResult.mimeType !== "image/png" || captureResult.savedImageFormat !== "PNG") {
      throw new Error("Mathematical calibration capture requested lossless PNG evidence and will not relabel or accept another camera output format.");
    }
    const appliedCameraSettings =
      requireAppliedMathematicalCalibrationCameraSettings(captureResult);
    const bridgeScriptPath = this.config.baslerBridgeScript ?? defaultBaslerPylonBridgeScriptPath();
    const bridgeScriptSha256 = crypto.createHash("sha256").update(readFileSync(bridgeScriptPath)).digest("hex");
    const confirmedAt = new Date().toISOString();
    return {
      rawBytes: await readFile(captureResult.outputFilePath),
      mimeType: "image/png",
      imageWidth: captureResult.imageWidth,
      imageHeight: captureResult.imageHeight,
      capturedAt: captureResult.timestamp,
      camera: {
        serialNumber: cameraSerial,
        modelName: cameraModel,
        transport: "GigE",
        sourcePixelFormat: captureResult.sourcePixelFormat,
        savedImageFormat: "PNG",
        exposureUs: appliedCameraSettings.exposureUs,
        gain: appliedCameraSettings.gain,
      },
      pylon: {
        version: pylonVersion,
        bridgeVersion: `basler-pylon-bridge-sha256-${bridgeScriptSha256}`,
      },
      leimac: {
        unit: input.protectedSettings.leimacUnit,
        dutyPercent: input.lighting.dutyPercent,
        enabledChannels: input.lighting.enabledChannels,
        expectedWriteCount: verification.expectedWriteCount,
        acknowledgedWriteCount: verification.acknowledgedWriteCount,
        responseKinds: verification.responseKinds,
        complete: true,
      },
      safeOff: {
        beforeCaptureConfirmed: true,
        afterCaptureConfirmed: true,
        confirmedAt,
      },
    };
  }

  private executeLiveLightingFrames(
    frames: LeimacIdmuWriteFrame[]
  ): Promise<AiGraderLocalStationLightingWriteResult[]> {
    const run = this.lightingWriteChain
      .catch(() => {})
      .then(() => this.writeLiveLightingFrames(frames));
    this.lightingWriteChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private strictLightingAcknowledgements(
    frames: readonly LeimacIdmuWriteFrame[],
    writes: readonly AiGraderLocalStationLightingWriteResult[]
  ) {
    const acknowledgedWriteCount = writes.filter((write) =>
      write.ok === true && (write.responseKind === "ack" || (this.config.mode === "mock" && write.responseKind === "mock"))
    ).length;
    const complete = writes.length === frames.length && acknowledgedWriteCount === frames.length;
    if (!complete) {
      throw new Error(
        `Leimac acknowledgement incomplete: expected ${frames.length} allowlisted response(s), received ${writes.length}, acknowledged ${acknowledgedWriteCount}.`
      );
    }
    return {
      expectedWriteCount: frames.length,
      acknowledgedWriteCount,
      complete: true as const,
      responseKinds: writes.map((write) => write.responseKind),
    };
  }

  private lightingVerificationCountsComplete() {
    const applied = this.manifest.liveLighting.applied;
    const physical = this.manifest.liveLighting.physicalState;
    const expected = applied.expectedWriteCount;
    const responses = applied.lastResponseKinds ?? [];
    return Number.isInteger(expected)
      && expected > 0
      && applied.acknowledgedWriteCount === expected
      && physical.expectedWriteCount === expected
      && physical.acknowledgedWriteCount === expected
      && responses.length === expected
      && responses.every((kind) => kind === 'ack' || (this.config.mode === 'mock' && kind === 'mock'))
      && applied.verificationState === 'verified'
      && applied.verificationComplete === true
      && physical.complete === true
      && Number.isFinite(Date.parse(applied.verifiedAt ?? ''))
      && Number.isFinite(Date.parse(physical.verifiedAt ?? ''))
      && applied.verifiedAt === physical.verifiedAt
      && physical.lastError === undefined
      && this.manifest.liveLighting.lastError === undefined
      && (this.manifest.liveLighting.connection.state === 'idle' || this.manifest.liveLighting.connection.state === 'mock');
  }

  private positioningLightingVerificationComplete(
    profile: Pick<AiGraderLocalStationAcceptedProfile, 'dutyPercent' | 'actualLeimacPwmStep' | 'channels'>
  ) {
    const live = this.manifest.liveLighting;
    return this.lightingVerificationCountsComplete()
      && live.status === 'on'
      && live.physicalState.state === 'positioning_light_verified'
      && live.applied.enabled === true
      && live.applied.dutyPercent === profile.dutyPercent
      && live.applied.actualLeimacPwmStep === profile.actualLeimacPwmStep
      && live.applied.channels.join(',') === profile.channels.join(',');
  }

  private safeOffLightingVerificationComplete() {
    const live = this.manifest.liveLighting;
    return this.lightingVerificationCountsComplete()
      && live.status === 'safe_off'
      && live.physicalState.state === 'safe_off_verified'
      && live.applied.enabled === false
      && live.applied.dutyPercent === 0
      && live.applied.actualLeimacPwmStep === 0
      && live.applied.channels.length === 0;
  }

  private markPhysicalStateUnknown(reason: string, error: unknown, expectedWriteCount = 0, acknowledgedWriteCount = 0) {
    const message = boundedBackPositioningError(
      error instanceof Error ? error : new Error("Leimac physical state could not be verified.")
    ).message;
    const changedAt = new Date().toISOString();
    this.updateLiveLightingStatus({
      status: "error",
      profile: { candidateProfileIdentity: undefined },
      applied: {
        enabled: undefined,
        verificationState: "unknown",
        expectedWriteCount,
        acknowledgedWriteCount,
        verificationComplete: false,
      },
      physicalState: {
        state: "unverified",
        reason,
        changedAt,
        expectedWriteCount,
        acknowledgedWriteCount,
        complete: false,
        lastError: message,
      },
      connection: { state: "error", persistentLeimacSession: false },
      lastError: message,
    });
    this.updateBackPositioningLight({ captureReady: false, captureAuthorization: undefined });
    if (!this.manifest.warnings.includes(message)) this.manifest.warnings.push(message);
    return message;
  }

  private markForensicLightingOwnership(side: AiGraderWarmRunnerSide) {
    const changedAt = new Date().toISOString();
    this.clearLiveLightingWatchdog();
    this.updateLiveLightingStatus({
      status: "unavailable",
      applied: {
        enabled: undefined,
        verificationState: "unknown",
        expectedWriteCount: 0,
        acknowledgedWriteCount: 0,
        verificationComplete: false,
        verifiedAt: undefined,
      },
      physicalState: {
        state: "unverified",
        reason: `${side} forensic runner owns lighting; bridge verification awaits the bounded post-capture safe-off.`,
        changedAt,
        expectedWriteCount: 0,
        acknowledgedWriteCount: 0,
        complete: false,
        verifiedAt: undefined,
        lastError: undefined,
      },
      connection: { state: "idle", persistentLeimacSession: false },
      lastError: undefined,
    });
    this.updateBackPositioningLight({ captureReady: false, captureAuthorization: undefined });
    this.manifest.progressLog.push(`${changedAt} ${side} forensic runner took lighting ownership; prior bridge safe-off proof was invalidated.`);
  }

  private markLightingWritePending(reason: string, expectedWriteCount: number, targetEnabled: boolean) {
    const changedAt = new Date().toISOString();
    this.updateLiveLightingStatus({
      status: "applying",
      applied: {
        enabled: undefined,
        verificationState: "pending",
        expectedWriteCount,
        acknowledgedWriteCount: 0,
        verificationComplete: false,
        verifiedAt: undefined,
      },
      physicalState: {
        state: targetEnabled ? "unverified" : "safe_off_pending",
        reason,
        changedAt,
        expectedWriteCount,
        acknowledgedWriteCount: 0,
        complete: false,
        verifiedAt: undefined,
        lastError: undefined,
      },
      connection: {
        state: this.config.mode === "mock" ? "mock" : "writing",
        persistentLeimacSession: false,
      },
      lastError: undefined,
    });
    this.updateBackPositioningLight({ captureReady: false, captureAuthorization: undefined });
  }

  private assertBackPositioningRestoreEligible() {
    if (!this.manifest.sessionId || !this.manifest.outputs.frontPackageDir) {
      throw new Error("Back-positioning light restore requires safely persisted front evidence for the active session.");
    }
    if (this.manifest.currentStep !== "prompt_flip_card") {
      throw new Error("Back-positioning light restore is valid only while the active session is at prompt_flip_card.");
    }
    if (this.captureLock) {
      throw new Error("Back-positioning light restore is unavailable while the capture lock is held.");
    }
    if (this.manifest.warmRunnerStatus.previewPolicy.holdActive) {
      throw new Error("Back-positioning light restore requires the forensic preview hold to be released.");
    }
    if (this.manifest.captureFailure) {
      throw new Error("Back-positioning light restore is unavailable after a capture or processing failure.");
    }
    this.assertLiveLightingReady();
  }

  private restoreBackPositioningLight(trigger: "front_capture") {
    if (this.closing || this.terminalLifecyclePending > 0 || this.frontCaptureTransition) {
      return Promise.reject(new Error("Back-positioning restore is blocked by a terminal bridge lifecycle."));
    }
    return this.serializeLightingLifecycle(() => this.restoreBackPositioningLightUnlocked(trigger));
  }

  private async restoreBackPositioningLightUnlocked(trigger: "front_capture") {
    this.assertBackPositioningRestoreEligible();
    const accepted = this.durableAcceptedCaptureProfile();
    const current = this.manifest.liveLighting.backPositioning;
    const applied = this.manifest.liveLighting.applied;
    const sameActiveProfile = current.sessionId === this.manifest.sessionId
      && current.sideEpoch === this.manifest.previewStatus.sideEpoch
      && current.profileIdentity === accepted.identity
      && applied.enabled
      && applied.dutyPercent === accepted.profile.dutyPercent
      && applied.actualLeimacPwmStep === accepted.profile.actualLeimacPwmStep
      && applied.channels.join(",") === accepted.profile.channels.join(",")
      && new Set(["waiting_for_frame", "ready"]).has(current.status);
    if (sameActiveProfile) return this.liveLightingStatus();

    const attemptCount = current.attemptCount + 1;
    const startedAt = new Date().toISOString();
    this.updateBackPositioningLight({
      status: "restoring",
      captureReady: false,
      sessionId: this.manifest.sessionId,
      sideEpoch: this.manifest.previewStatus.sideEpoch,
      profileIdentity: accepted.identity,
      dutyPercent: accepted.profile.dutyPercent,
      actualLeimacPwmStep: accepted.profile.actualLeimacPwmStep,
      channels: [...accepted.profile.channels],
      attemptCount,
      lastAttempt: trigger,
      firstFrameGraceExpiresAt: undefined,
      lastError: undefined,
      captureAuthorization: undefined,
    });
    this.recordBackPositioningLightEvent({
      type: "restore_starting",
      trigger,
      profileIdentity: accepted.identity,
    });
    await writeSessionManifest(this.manifest);

    let failureToThrow: unknown;
    let restoreVerified = false;
    try {
      const startedAtMs = Date.now();
      const frames = this.liveLightingFrames(accepted.profile);
      this.markLightingWritePending("Durable accepted back-positioning profile write awaiting acknowledgement.", frames.length, true);
      const writes = await this.executeLiveLightingFrames(frames);
      const verification = this.strictLightingAcknowledgements(frames, writes);
      const appliedAt = new Date().toISOString();
      const firstFrameGraceExpiresAt = new Date(Date.now() + BACK_POSITIONING_FIRST_FRAME_GRACE_MS).toISOString();
      this.updateLiveLightingStatus({
        status: "on",
        profile: accepted.profile,
        applied: {
          enabled: true,
          dutyPercent: accepted.profile.dutyPercent,
          actualLeimacPwmStep: accepted.profile.actualLeimacPwmStep,
          channels: [...accepted.profile.channels],
          appliedAt,
          lastApplyLatencyMs: Math.max(0, Date.now() - startedAtMs),
          lastResponseKinds: verification.responseKinds,
          verificationState: "verified",
          expectedWriteCount: verification.expectedWriteCount,
          acknowledgedWriteCount: verification.acknowledgedWriteCount,
          verificationComplete: true,
          verifiedAt: appliedAt,
        },
        physicalState: {
          state: "positioning_light_verified",
          reason: `Durable accepted back-positioning profile restored by ${trigger}.`,
          changedAt: appliedAt,
          expectedWriteCount: verification.expectedWriteCount,
          acknowledgedWriteCount: verification.acknowledgedWriteCount,
          complete: true,
          verifiedAt: appliedAt,
          lastError: undefined,
        },
        connection: { state: this.config.mode === "mock" ? "mock" : "idle", persistentLeimacSession: false },
        lastError: undefined,
      });
      this.updateBackPositioningLight({
        status: "waiting_for_frame",
        captureReady: false,
        firstFrameGraceExpiresAt,
        lastError: undefined,
      });
      this.recordBackPositioningLightEvent({
        type: "restore_success",
        trigger,
        profileIdentity: accepted.identity,
      });
      this.scheduleLiveLightingWatchdog("back positioning first-frame grace", BACK_POSITIONING_FIRST_FRAME_GRACE_MS);
      restoreVerified = true;
    } catch (error) {
      const lastError = boundedBackPositioningError(error);
      let cleanupError: unknown;
      try {
        await this.safeOffLiveLighting("back positioning restore failure", "failure_safe_off", { force: true });
      } catch (error) {
        cleanupError = error;
      }
      this.updateBackPositioningLight({
        status: "failed",
        captureReady: false,
        firstFrameGraceExpiresAt: undefined,
        lastError,
      });
      this.recordBackPositioningLightEvent({
        type: "restore_failure",
        trigger,
        profileIdentity: accepted.identity,
        error: lastError,
      });
      if (cleanupError) {
        const cleanup = boundedBackPositioningError(cleanupError).message;
        failureToThrow = new Error(`${lastError.message} Failure safe-off also could not be verified: ${cleanup}`);
      }
    }
    this.manifest.progressLog.push(`${startedAt} Back-positioning restore attempt ${attemptCount} completed with status ${this.manifest.liveLighting.backPositioning.status}.`);
    try {
      await writeSessionManifest(this.manifest);
    } catch (persistenceError) {
      const persistenceFailure = boundedBackPositioningError(persistenceError);
      if (restoreVerified) {
        let cleanupError: unknown;
        try {
          await this.safeOffLiveLighting("back positioning restore manifest persistence failure", "failure_safe_off", { force: true });
        } catch (error) {
          cleanupError = error;
        }
        this.updateBackPositioningLight({
          status: "failed",
          captureReady: false,
          firstFrameGraceExpiresAt: undefined,
          lastError: persistenceFailure,
        });
        this.recordBackPositioningLightEvent({
          type: "restore_failure",
          trigger,
          profileIdentity: accepted.identity,
          error: persistenceFailure,
        });
        this.manifest.progressLog.push(`${new Date().toISOString()} Verified positioning restore was safe-offed because its manifest commit failed.`);
        let cleanupPersistenceError: unknown;
        try {
          await writeSessionManifest(this.manifest);
        } catch (error) {
          cleanupPersistenceError = error;
        }
        const cleanupMessage = cleanupError ? boundedBackPositioningError(cleanupError).message : undefined;
        const cleanupPersistenceMessage = cleanupPersistenceError
          ? boundedBackPositioningError(cleanupPersistenceError).message
          : undefined;
        throw new Error([
          persistenceFailure.message,
          cleanupMessage ? `Failure safe-off also could not be verified: ${cleanupMessage}` : undefined,
          cleanupPersistenceMessage ? `Cleanup state also could not be persisted: ${cleanupPersistenceMessage}` : undefined,
        ].filter(Boolean).join(" "));
      }
      const preceding = failureToThrow ? boundedBackPositioningError(failureToThrow).message : undefined;
      throw new Error([preceding, persistenceFailure.message].filter(Boolean).join(" "));
    }
    if (failureToThrow) throw failureToThrow;
    return this.liveLightingStatus();
  }

  private backPositioningCaptureReady() {
    const positioning = this.manifest.liveLighting.backPositioning;
    const lastFrameMs = Date.parse(this.manifest.previewStatus.lastFrameAt ?? "");
    const frameAgeMs = Date.now() - lastFrameMs;
    let accepted: ReturnType<typeof durableAcceptedPositioningProfile> | undefined;
    try {
      accepted = this.durableAcceptedCaptureProfile();
    } catch {
      return false;
    }
    return positioning.status === "ready"
      && positioning.captureReady
      && positioning.sessionId === this.manifest.sessionId
      && positioning.sideEpoch === this.manifest.previewStatus.sideEpoch
      && positioning.profileIdentity === accepted.identity
      && this.manifest.previewStatus.status === "live"
      && this.manifest.previewStatus.activeSide === "back"
      && this.manifest.previewStatus.positioningLightReady
      && Boolean(this.manifest.previewStatus.latestFrameId)
      && Boolean(this.postRestoreBackPreviewObservation(this.manifest.previewStatus.latestFrameId))
      && Number.isFinite(lastFrameMs)
      && frameAgeMs >= 0
      && frameAgeMs <= BACK_POSITIONING_LIVE_FRAME_MAX_AGE_MS
      && this.manifest.liveLighting.physicalState.state === "positioning_light_verified"
      && this.manifest.liveLighting.applied.enabled
      && this.manifest.liveLighting.applied.verificationState === "verified"
      && this.manifest.liveLighting.applied.verificationComplete
      && this.manifest.liveLighting.applied.dutyPercent === accepted.profile.dutyPercent
      && this.manifest.liveLighting.applied.actualLeimacPwmStep === accepted.profile.actualLeimacPwmStep
      && this.manifest.liveLighting.applied.channels.join(",") === accepted.profile.channels.join(",");
  }

  private assertBackPositioningCaptureReady() {
    if (!this.backPositioningCaptureReady()) {
      throw new Error("Back Capture requires the bridge-owned positioning light plus a fresh session/side/epoch-bound live back preview frame. This card session cannot continue without both.");
    }
  }

  private authorizeBackCapture() {
    this.assertBackPositioningCaptureReady();
    const positioning = this.manifest.liveLighting.backPositioning;
    const frameId = this.manifest.previewStatus.latestFrameId!;
    const authorizedAt = new Date().toISOString();
    const captureAuthorization = {
      sessionId: this.manifest.sessionId!,
      sideEpoch: positioning.sideEpoch,
      frameId,
      profileIdentity: positioning.profileIdentity!,
      authorizedAt,
      expiresAt: new Date(Date.now() + ATOMIC_CAPTURE_AUTHORIZATION_MS).toISOString(),
    };
    this.updateBackPositioningLight({ captureAuthorization });
    return captureAuthorization;
  }

  private assertBackCaptureAuthorization(
    authorization: NonNullable<AiGraderBackPositioningLightStatus["captureAuthorization"]> | undefined,
    options: { requireFreshLiveFrame?: boolean; geometryCaptureMode?: AiGraderGeometryCaptureMode } = {}
  ) {
    const current = this.manifest.liveLighting.backPositioning.captureAuthorization;
    let accepted: ReturnType<typeof durableAcceptedPositioningProfile> | undefined;
    try {
      accepted = this.durableAcceptedCaptureProfile();
    } catch {}
    if (
      !authorization
      || !current
      || !accepted
      || current.sessionId !== authorization.sessionId
      || current.sideEpoch !== authorization.sideEpoch
      || current.frameId !== authorization.frameId
      || current.profileIdentity !== authorization.profileIdentity
      || authorization.sessionId !== this.manifest.sessionId
      || authorization.sideEpoch !== this.manifest.previewStatus.sideEpoch
      || authorization.profileIdentity !== accepted.identity
      || Date.parse(authorization.expiresAt) < Date.now()
    ) {
      throw new Error("Back Capture authorization is missing, stale, or does not match the active session/side/epoch/frame/profile.");
    }
    if (options.requireFreshLiveFrame) {
      if (!this.backPositioningCaptureReady() || this.manifest.previewStatus.latestFrameId !== authorization.frameId) {
        throw new Error("Back Capture authorization no longer matches the latest fresh live back preview frame.");
      }
      if (options.geometryCaptureMode === "detected_geometry") {
        const geometry = this.manifest.previewStatus.cardGeometry.back;
        if (
          geometry?.sessionId !== authorization.sessionId
          || geometry?.sideEpoch !== authorization.sideEpoch
          || geometry?.sourceFrameId !== authorization.frameId
        ) {
          throw new Error("Back Capture detected geometry does not match the authorized session/side/epoch/frame.");
        }
      }
    }
  }

  applyLiveLighting(request: JsonBody = {}): Promise<AiGraderLiveLightingStatus> {
    if (
      this.closing
      || this.frontCaptureTransition
      || this.terminalLifecyclePending > 0
      || this.captureLock
      || this.manifest.previewStatus.intentionalTransition.active
    ) {
      return Promise.reject(new Error("Live lighting apply is blocked while a serialized capture/terminal lifecycle owns the bridge."));
    }
    return this.serializeLightingLifecycle(() => this.applyLiveLightingUnlocked(request));
  }

  private async applyConfiguredDefaultLightingUnlocked(reason: string): Promise<AiGraderLiveLightingStatus> {
    const configured = this.manifest.acceptedProfile;
    if (configured.dutyPercent <= 0 || configured.channels.length === 0) {
      throw new Error("The configured default positioning-light profile must enable at least one channel above zero duty.");
    }
    return this.applyLiveLightingUnlocked({
      enabled: true,
      dutyPercent: configured.dutyPercent,
      channels: configured.channels,
      reason,
    }, "bridge_operator");
  }

  private async applyLiveLightingUnlocked(
    request: JsonBody = {},
    acceptanceSource: "browser_live_tuning" | "bridge_operator" = "browser_live_tuning",
  ): Promise<AiGraderLiveLightingStatus> {
    if (this.manifest.currentStep === "prompt_flip_card" || this.manifest.currentStep === "capture_back") {
      throw new Error("Browser hardware/profile values are disabled after Front Capture; the bridge owns Back positioning for the remainder of this card session.");
    }
    this.assertLiveLightingReady();
    if (!this.manifest.sessionId) throw new Error("Start a station session before browser live lighting tuning.");
    const requestedProfile = validateLiveLightingRequest(request, this.manifest.liveLighting);
    const profile: AiGraderLiveLightingProfile = {
      ...requestedProfile,
      source: acceptanceSource === "bridge_operator" ? "accepted_station_profile" : "browser_live_tuning",
    };
    const currentApplied = this.manifest.liveLighting.applied;
    const sameAsApplied =
      currentApplied.enabled === profile.enabled &&
      currentApplied.dutyPercent === profile.dutyPercent &&
      currentApplied.channels.join(",") === profile.channels.join(",");
    const acceptAppliedProfile = () => {
      if (!profile.enabled) return profile;
      this.manifest.acceptedProfile = validateProfile({
        dutyPercent: profile.dutyPercent,
        exposureUs: this.manifest.acceptedProfile.exposureUs,
        gain: this.manifest.acceptedProfile.gain,
        channels: profile.channels,
        source: acceptanceSource,
      }, this.manifest.acceptedProfile);
      return { ...profile, acceptedForCapture: true, acceptedAt: this.manifest.acceptedProfile.acceptedAt };
    };

    if (sameAsApplied) {
      if (profile.enabled) this.scheduleLiveLightingWatchdog("no-op apply");
      this.updateLiveLightingStatus({ profile: acceptAppliedProfile() });
      this.recordLiveLightingEvent({ type: "heartbeat", reason: "live lighting request matched current applied state", ok: true });
      await writeSessionManifest(this.manifest);
      return this.liveLightingStatus();
    }

    const startedAtMs = Date.now();
    const frames = this.liveLightingFrames(profile);
    this.updateLiveLightingStatus({ profile });
    this.markLightingWritePending(
      String(request.reason ?? "browser live lighting apply awaiting acknowledgement"),
      frames.length,
      profile.enabled,
    );
    try {
      const writes = await this.executeLiveLightingFrames(frames);
      const verification = this.strictLightingAcknowledgements(frames, writes);
      const appliedAt = new Date().toISOString();
      const lastApplyLatencyMs = Math.max(0, Date.now() - startedAtMs);
      const appliedProfile = acceptAppliedProfile();
      this.updateLiveLightingStatus({
        status: profile.enabled ? "on" : "safe_off",
        profile: appliedProfile,
        applied: {
          enabled: profile.enabled,
          dutyPercent: profile.enabled ? profile.dutyPercent : 0,
          actualLeimacPwmStep: profile.enabled ? profile.actualLeimacPwmStep : 0,
          channels: profile.enabled ? profile.channels : [],
          appliedAt,
          lastApplyLatencyMs,
          lastResponseKinds: verification.responseKinds,
          verificationState: "verified",
          expectedWriteCount: verification.expectedWriteCount,
          acknowledgedWriteCount: verification.acknowledgedWriteCount,
          verificationComplete: true,
          verifiedAt: appliedAt,
        },
        physicalState: {
          state: profile.enabled ? "positioning_light_verified" : "safe_off_verified",
          reason: String(request.reason ?? "browser live lighting apply"),
          changedAt: appliedAt,
          expectedWriteCount: verification.expectedWriteCount,
          acknowledgedWriteCount: verification.acknowledgedWriteCount,
          complete: true,
          verifiedAt: appliedAt,
          lastError: undefined,
        },
        connection: { state: this.config.mode === "mock" ? "mock" : "idle", persistentLeimacSession: false },
      });
      this.recordLiveLightingEvent({ type: profile.enabled ? "apply" : "safe_off", reason: String(request.reason ?? "browser live lighting apply"), ok: true });
      if (profile.enabled) this.scheduleLiveLightingWatchdog("live lighting apply");
      else this.clearLiveLightingWatchdog();
      await writeSessionManifest(this.manifest);
      return this.liveLightingStatus();
    } catch (error) {
      const failure = boundedBackPositioningError(
        error instanceof Error ? error : new Error("Capture-ready lighting apply failed.")
      );
      this.markPhysicalStateUnknown("capture-ready lighting apply failed", error);
      this.recordLiveLightingEvent({ type: "failure_safe_off", reason: failure.message, ok: false });
      let cleanupError: unknown;
      try {
        await this.safeOffLiveLighting("live lighting apply failure", "failure_safe_off", { force: true });
      } catch (error) {
        cleanupError = error;
      }
      await writeSessionManifest(this.manifest);
      if (cleanupError) {
        const cleanup = boundedBackPositioningError(cleanupError);
        throw new Error(`${failure.message} Failure safe-off also could not be verified: ${cleanup.message}`);
      }
      throw new Error(failure.message);
    }
  }

  async heartbeatLiveLighting(reason = "browser live lighting heartbeat"): Promise<AiGraderLiveLightingStatus> {
    if (
      this.closing
      || this.frontCaptureTransition
      || this.terminalLifecyclePending > 0
      || this.lightingLifecyclePending > 0
      || this.captureLock
      || this.manifest.previewStatus.intentionalTransition.active
    ) {
      throw new Error("Live lighting heartbeat is blocked while a serialized capture transition owns the bridge.");
    }
    const positioning = this.manifest.liveLighting.backPositioning;
    if (
      this.manifest.liveLighting.applied.enabled
      && new Set(["waiting_for_frame", "ready"]).has(positioning.status)
    ) {
      const lastFrameMs = Date.parse(this.manifest.previewStatus.lastFrameAt ?? "");
      const frameAgeMs = Date.now() - lastFrameMs;
      const freshFrame = this.manifest.previewStatus.status === "live"
        && this.manifest.previewStatus.sessionId === this.manifest.sessionId
        && this.manifest.previewStatus.activeSide === "back"
        && this.manifest.previewStatus.sideEpoch === positioning.sideEpoch
        && Boolean(this.manifest.previewStatus.latestFrameId)
        && Boolean(this.postRestoreBackPreviewObservation(this.manifest.previewStatus.latestFrameId))
        && Number.isFinite(lastFrameMs)
        && frameAgeMs >= 0
        && frameAgeMs <= BACK_POSITIONING_LIVE_FRAME_MAX_AGE_MS;
      if (freshFrame) {
        this.scheduleLiveLightingWatchdog(reason);
      } else {
        const withinGrace = positioning.status === "waiting_for_frame"
          && Date.parse(positioning.firstFrameGraceExpiresAt ?? "") > Date.now();
        if (!withinGrace) {
          const lastError = boundedBackPositioningError(
            new Error("Back positioning light safe-off: heartbeat did not have a recent live back preview frame."),
            "AI_GRADER_BACK_PREVIEW_FRAME_REQUIRED"
          );
          let safeOffError: unknown;
          try {
            await this.safeOffLiveLighting("back positioning heartbeat without a fresh frame", "watchdog_safe_off");
          } catch (error) {
            safeOffError = error;
          }
          this.updateBackPositioningLight({ status: "failed", captureReady: false, lastError });
          this.recordBackPositioningLightEvent({
            type: "restore_failure",
            trigger: "safety",
            profileIdentity: positioning.profileIdentity,
            error: lastError,
          });
          await writeSessionManifest(this.manifest);
          if (safeOffError) throw safeOffError;
        }
      }
    } else if (this.manifest.liveLighting.applied.enabled) {
      this.scheduleLiveLightingWatchdog(reason);
    } else {
      this.updateLiveLightingStatus({ watchdog: { enabled: true, timeoutMs: LIVE_LIGHTING_WATCHDOG_MS, lastHeartbeatAt: new Date().toISOString() } });
    }
    this.recordLiveLightingEvent({ type: "heartbeat", reason, ok: true });
    await writeSessionManifest(this.manifest);
    return this.liveLightingStatus();
  }

  private async safeOffLiveLighting(
    reason: string,
    eventType: AiGraderLiveLightingSafetyEvent["type"] = "safe_off",
    options: { force?: boolean; preserveBackCaptureAuthorization?: boolean } = {}
  ): Promise<void> {
    const safeOffFrames = buildLeimacIdmuSafeOffFrames(this.config.leimacUnit ?? 1);
    const alreadyVerified = this.safeOffLightingVerificationComplete();
    const shouldSend = options.force === true || !alreadyVerified;
    const positioningWasActive = this.manifest.liveLighting.backPositioning.status !== "inactive"
      && this.manifest.liveLighting.backPositioning.status !== "safe_off";
    const captureAuthorization = options.preserveBackCaptureAuthorization
      ? this.manifest.liveLighting.backPositioning.captureAuthorization
      : undefined;
    this.clearLiveLightingWatchdog();
    if (positioningWasActive) {
      this.updateBackPositioningLight({
        captureReady: false,
        firstFrameGraceExpiresAt: undefined,
        captureAuthorization,
      });
    }
    if (!shouldSend) {
      this.recordLiveLightingEvent({ type: eventType, reason, ok: true });
      return;
    }
    const pendingAt = new Date().toISOString();
    this.updateLiveLightingStatus({
      status: "applying",
      applied: {
        enabled: undefined,
        verificationState: "pending",
        expectedWriteCount: safeOffFrames.length,
        acknowledgedWriteCount: 0,
        verificationComplete: false,
        verifiedAt: undefined,
      },
      physicalState: {
        state: "safe_off_pending",
        reason,
        changedAt: pendingAt,
        expectedWriteCount: safeOffFrames.length,
        acknowledgedWriteCount: 0,
        complete: false,
        verifiedAt: undefined,
        lastError: undefined,
      },
      connection: {
        state: this.config.mode === "mock" ? "mock" : "writing",
        persistentLeimacSession: false,
      },
    });
    let writes: AiGraderLocalStationLightingWriteResult[] = [];
    try {
      writes = await this.executeLiveLightingFrames(safeOffFrames);
      const verification = this.strictLightingAcknowledgements(safeOffFrames, writes);
      const verifiedAt = new Date().toISOString();
      this.updateLiveLightingStatus({
        status: "safe_off",
        profile: {
          enabled: false,
          acceptedForCapture: this.manifest.liveLighting.profile.acceptedForCapture,
          candidateProfileIdentity: undefined,
        },
        applied: {
          enabled: false,
          dutyPercent: 0,
          actualLeimacPwmStep: 0,
          channels: [],
          appliedAt: verifiedAt,
          lastResponseKinds: verification.responseKinds,
          verificationState: "verified",
          expectedWriteCount: verification.expectedWriteCount,
          acknowledgedWriteCount: verification.acknowledgedWriteCount,
          verificationComplete: true,
          verifiedAt,
        },
        physicalState: {
          state: "safe_off_verified",
          reason,
          changedAt: verifiedAt,
          expectedWriteCount: verification.expectedWriteCount,
          acknowledgedWriteCount: verification.acknowledgedWriteCount,
          complete: true,
          verifiedAt,
          lastError: undefined,
        },
        connection: { state: this.config.mode === "mock" ? "mock" : "idle", persistentLeimacSession: false },
        lastError: undefined,
      });
      if (positioningWasActive) {
        this.updateBackPositioningLight({
          status: "safe_off",
          captureReady: false,
          firstFrameGraceExpiresAt: undefined,
          captureAuthorization,
        });
        this.recordBackPositioningLightEvent({
          type: "safe_off",
          trigger: "safety",
          profileIdentity: this.manifest.liveLighting.backPositioning.profileIdentity,
        });
      }
      this.recordLiveLightingEvent({ type: eventType, reason, ok: true });
    } catch (error) {
      const acknowledgedWriteCount = writes.filter((write) =>
        write.ok === true && (write.responseKind === "ack" || (this.config.mode === "mock" && write.responseKind === "mock"))
      ).length;
      const message = this.markPhysicalStateUnknown(reason, error, safeOffFrames.length, acknowledgedWriteCount);
      if (positioningWasActive) this.updateBackPositioningLight({ status: "failed", captureReady: false, captureAuthorization: undefined });
      this.recordLiveLightingEvent({ type: eventType, reason: `${reason}: ${message}`, ok: false });
      throw new Error(message);
    }
  }

  private notePreviewFrame(
    frameCount: number,
    binding: { sessionId: string; side: CardGeometrySide; sideEpoch: string },
    frameId: string,
    capturedAt = new Date().toISOString()
  ) {
    if (
      binding.sessionId !== this.manifest.sessionId
      || binding.side !== this.manifest.previewStatus.activeSide
      || binding.sideEpoch !== this.manifest.previewStatus.sideEpoch
    ) return false;
    if (!this.retainPreviewObservation(binding, frameId, capturedAt)) return false;
    const now = new Date().toISOString();
    const current = this.manifest.previewStatus;
    const startedMs = current.startedAt ? Date.parse(current.startedAt) : Date.now();
    const elapsedSeconds = Math.max(0.001, (Date.now() - startedMs) / 1000);
    this.updatePreviewStatus({
      status: "live",
      cameraOwnership: "preview_stream",
      frameCount,
      sessionId: binding.sessionId,
      activeSide: binding.side,
      sideEpoch: binding.sideEpoch,
      latestFrameId: frameId,
      firstFrameAt: current.firstFrameAt ?? now,
      lastFrameAt: now,
      fps: Math.round((frameCount / elapsedSeconds) * 10) / 10,
    });
    if (frameCount === 1) {
      this.recordCaptureTimingEvent(this.manifest, { id: "preview_ready", at: now });
    }
    const positioning = this.manifest.liveLighting.backPositioning;
    if (
      binding.side === "back"
      && positioning.status === "waiting_for_frame"
      && positioning.sessionId === binding.sessionId
      && positioning.sideEpoch === binding.sideEpoch
      && this.manifest.liveLighting.applied.enabled
      && Boolean(this.postRestoreBackPreviewObservation(frameId))
    ) {
      this.updateBackPositioningLight({
        status: "ready",
        captureReady: true,
        firstFrameGraceExpiresAt: undefined,
        lastError: undefined,
      });
      this.recordBackPositioningLightEvent({
        type: "fresh_frame_ready",
        trigger: "preview_frame",
        profileIdentity: positioning.profileIdentity,
      });
      this.scheduleLiveLightingWatchdog("fresh back preview frame");
      void writeSessionManifest(this.manifest).catch(() => {});
    }
    return true;
  }

  private async stopPreviewStream(
    reason: string,
    options: { waitForRelease?: boolean; requireRelease?: boolean; settleMs?: number; captureOwner?: boolean } = {}
  ) {
    const child = this.previewProcess;
    const captureOwner = options.captureOwner === true;
    this.previewStop?.(reason);
    this.previewStop = undefined;
    if (child) this.stopPreviewProcessTree(child);
    const stoppedOrphans = await this.stopOrphanedPreviewStreamsUntilReleased(
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
        this.stopPreviewProcessTree(child);
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

  async shutdown(reason = "local bridge server closing"): Promise<void> {
    this.closing = true;
    const workerShutdown = this.beginProcessingWorkerShutdown(reason).then(
      () => undefined,
      (error) => new Error(boundedProcessingWorkerError(error)),
    );
    const frontCapture = this.frontCaptureTransition?.promise;
    if (frontCapture) await frontCapture.catch(() => undefined);
    const atomic = this.currentAtomicBackCapturePromise();
    if (atomic) await atomic.catch(() => undefined);
    let terminalError: Error | undefined;
    try {
      await this.serializeTerminalLifecycle(async () => {
        await this.awaitLightingLifecycleIdle();
        let previewError: unknown;
        try {
          await this.stopPreviewStream(reason, {
            waitForRelease: true,
            requireRelease: true,
            settleMs: PREVIEW_CAMERA_SETTLE_MS,
          });
        } catch (error) {
          previewError = error;
        }
        const inheritedAtomicSafeOff = Boolean(atomic)
          && this.manifest.liveLighting.physicalState.state === "safe_off_verified";
        const safeOff = inheritedAtomicSafeOff
          ? { ok: true, directError: undefined, guardedCleanupError: undefined }
          : await this.runTerminalSafeOff(reason);
        this.clearLiveLightingWatchdog();
        await writeSessionManifest(this.manifest);
        if (previewError) throw new Error(boundedPreviewLifecycleError(previewError));
        if (!safeOff.ok) throw new Error(safeOff.directError?.message ?? safeOff.guardedCleanupError?.message ?? "Local bridge shutdown safe-off could not be confirmed.");
      });
    } catch (error) {
      terminalError = error instanceof Error ? error : new Error(boundedPreviewLifecycleError(error));
    }
    const workerError = await workerShutdown;
    if (this.warmRunner.shutdownProcessingWorker) {
      const remainingJobs = [...this.warmProcessingJobs.values()];
      await Promise.allSettled(remainingJobs);
      this.warmProcessingJobs.clear();
      try {
        await writeSessionManifest(this.manifest);
      } catch (error) {
        if (!terminalError) terminalError = new Error(boundedPreviewLifecycleError(error));
      }
    }
    if (terminalError && workerError) {
      throw new Error(`${terminalError.message} Processing worker shutdown also failed: ${workerError.message}`);
    }
    if (terminalError) throw terminalError;
    if (workerError) throw workerError;
  }

  private async stopPreviewForHardwareAction(action: string) {
    await this.stopPreviewStream(`preview released before ${action} capture action`, {
      waitForRelease: true,
      requireRelease: true,
      settleMs: PREVIEW_CAMERA_SETTLE_MS,
    });
    this.manifest.warmRunnerStatus.previewPolicy.lastPausedAt = new Date().toISOString();
    this.manifest.progressLog.push(`${new Date().toISOString()} Browser preview stream paused/released before ${action}.`);
    const stoppedOrphans = await this.stopOrphanedPreviewStreamsUntilReleased(PREVIEW_RELEASE_TIMEOUT_MS, PREVIEW_CAMERA_SETTLE_MS);
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
  }, manifest: AiGraderLocalStationBridgeManifest = this.manifest): AiGraderWarmRunnerPhase {
    const previous = manifest.warmRunnerStatus.phases.find((phase) => phase.id === input.id);
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
    const others = manifest.warmRunnerStatus.phases.filter((candidate) => candidate.id !== input.id);
    manifest.warmRunnerStatus.phases = [...others, phase];
    const queueName = input.id.startsWith("capture_") ? "capture" : input.id.startsWith("process_") ? "processing" : input.id.includes("report") ? "report" : undefined;
    if (queueName) {
      const queue = manifest.warmRunnerStatus.queues[queueName].filter((candidate) => candidate.id !== input.id);
      manifest.warmRunnerStatus.queues[queueName] = [...queue, phase];
    }
    return phase;
  }

  private updateEvidenceRoles(side: AiGraderWarmRunnerSide, status: AiGraderWarmRunnerPhaseStatus, manifest: AiGraderLocalStationBridgeManifest = this.manifest) {
    manifest.warmRunnerStatus.evidencePlan.rolesBySide[side] = fullForensicEvidenceRoles(status);
  }

  private setExecutionPath(pathName: AiGraderWarmRunnerExecutionPath, _unused?: undefined, manifest: AiGraderLocalStationBridgeManifest = this.manifest) {
    manifest.executionPath = pathName;
    manifest.warmRunnerStatus.backend = pathName;
    manifest.warmRunnerStatus.executionPath = pathName;
  }

  private buildWarmEvidenceInput(side: AiGraderWarmRunnerSide, manifest: AiGraderLocalStationBridgeManifest = this.manifest): FixedRigWarmEvidencePackageInput {
    return {
      outputDir: this.config.outputDir,
      side: side as FixedRigCardSide,
      captureProfile: manifest.captureProfile,
      activeLightingProfile: buildFixedRigProfile(manifest.acceptedProfile),
      pylonRoot: this.config.pylonRoot,
      pylonTimeoutMs: this.config.pylonTimeoutMs,
      baslerBridgeScript: this.config.baslerBridgeScript,
      leimacHost: this.config.leimacHost ?? "",
      leimacPort: this.config.leimacPort,
      leimacUnit: this.config.leimacUnit,
      cameraIndex: this.config.cameraIndex,
      exposureUs: manifest.acceptedProfile.exposureUs,
      gain: manifest.acceptedProfile.gain,
      fixtureLabel: this.config.fixtureLabel,
      fixtureId: this.config.fixtureId,
      referenceType: this.config.referenceType as FixedRigReferenceType | undefined,
      horizontalSpanMm: this.config.horizontalSpanMm,
      horizontalStartPx: this.config.horizontalStartPx,
      horizontalEndPx: this.config.horizontalEndPx,
      verticalSpanMm: this.config.verticalSpanMm,
      verticalStartPx: this.config.verticalStartPx,
      verticalEndPx: this.config.verticalEndPx,
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
        captureProfile: this.manifest.captureProfile,
        packageDir,
        manifestPath: result.manifestPath,
        analysisPath: result.analysisPath,
        previewReportPath: result.previewReportPath,
        manifest: result.manifest,
      },
    };
  }

  private warmProcessingKey(manifest: AiGraderLocalStationBridgeManifest, side: AiGraderWarmRunnerSide) {
    if (!manifest.sessionId) throw new Error("Warm processing requires a session ID.");
    return `${manifest.sessionId}:${side}`;
  }

  private beginProcessingWorkerShutdown(reason: string): Promise<void> {
    if (!this.processingWorkerShutdown) {
      this.processingWorkerShutdown = Promise.resolve().then(async () => {
        await this.warmRunner.shutdownProcessingWorker?.(reason);
      });
    }
    return this.processingWorkerShutdown;
  }

  private async cancelWarmProcessingSession(sessionId: string | undefined, reason: string): Promise<void> {
    if (!sessionId || !this.warmRunner.cancelSession) return;
    this.processingSessionsCancelling.add(sessionId);
    try {
      await this.warmRunner.cancelSession(sessionId, reason);
      const matchingJobs = [...this.warmProcessingJobs.entries()]
        .filter(([key]) => key.startsWith(`${sessionId}:`));
      await Promise.allSettled(matchingJobs.map(([, job]) => job));
      for (const [key] of matchingJobs) this.warmProcessingJobs.delete(key);
    } finally {
      this.processingSessionsCancelling.delete(sessionId);
    }
  }

  private assertWarmProcessingIdentity(input: {
    requestId: string;
    sessionId: string;
    side: AiGraderWarmRunnerSide;
    batch: FixedRigWarmSideCaptureBatch;
    processed: FixedRigWarmProcessingResult;
    manifest: AiGraderLocalStationBridgeManifest;
  }) {
    if (input.manifest.sessionId !== input.sessionId) {
      throw new Error("Warm processing worker session identity changed before its response was accepted.");
    }
    if (input.batch.side !== input.side) {
      throw new Error("Warm processing worker capture-batch side identity is invalid.");
    }
    if (input.processed.packageId !== input.batch.packageId) {
      throw new Error("Warm processing worker response package identity does not match the captured evidence.");
    }
    if (path.resolve(input.processed.packageDir) !== path.resolve(input.batch.packageDir)) {
      throw new Error("Warm processing worker response package directory does not match the captured evidence.");
    }
    const processedSide = input.processed.manifest?.evidenceSide;
    if (processedSide !== undefined && processedSide !== input.side) {
      throw new Error("Warm processing worker response side identity does not match the captured evidence.");
    }
    const workerIdentity = input.processed.processingWorker;
    const expectedMode = "captured_evidence_worker";
    const sourceIdentityMatches = /^[a-f0-9]{64}$/i.test(workerIdentity.sourceSetSha256);
    if (
      !workerIdentity
      || workerIdentity.protocolVersion !== FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION
      || workerIdentity.requestId !== input.requestId
      || workerIdentity.sessionId !== input.sessionId
      || workerIdentity.packageId !== input.batch.packageId
      || workerIdentity.side !== input.side
      || workerIdentity.mode !== expectedMode
      || !sourceIdentityMatches
    ) {
      throw new Error("Warm processing worker authority identity does not match the captured evidence request.");
    }
  }

  private async awaitWarmProcessing(manifest: AiGraderLocalStationBridgeManifest, side: AiGraderWarmRunnerSide): Promise<FixedRigWarmProcessingResult | undefined> {
    const key = this.warmProcessingKey(manifest, side);
    const job = this.warmProcessingJobs.get(key);
    if (!job) return undefined;
    try {
      return await job;
    } finally {
      this.warmProcessingJobs.delete(key);
    }
  }

  private async runSafeOffCleanup(reason: string): Promise<boolean> {
    if (this.config.mode !== "real") return true;
    const cleanupStartedAt = new Date().toISOString();
    const cleanupExecutionPath = this.manifest.executionPath;
    this.manifest.warmRunnerStatus.status = "safe_off";
    this.markWarmPhase({
      id: "warm_safe_cleanup",
      label: "Watchdog safe-off cleanup",
      status: "active",
      startedAt: cleanupStartedAt,
      backend: cleanupExecutionPath,
      executionPath: cleanupExecutionPath,
      detail: reason,
    });
    try {
      const rawResult = await runStepOrMock(this.config, this.manifest, this.runner, stepById(this.config, this.manifest, "safe_off"));
      const safeError = rawResult.ok
        ? undefined
        : boundedBackPositioningError(new Error(rawResult.error ?? `Safe-off failed after ${reason}.`)).message;
      const result = rawResult.ok ? rawResult : { ...rawResult, error: safeError };
      this.manifest.commandResults.push(result);
      this.manifest.progressLog.push(`${new Date().toISOString()} Watchdog safe-off ${result.ok ? "completed" : "failed"} after ${reason}.`);
      if (!result.ok) this.manifest.warnings.push(safeError ?? `Safe-off failed after ${reason}.`);
      this.markWarmPhase({
        id: "warm_safe_cleanup",
        label: "Watchdog safe-off cleanup",
        status: result.ok ? "completed" : "failed",
        startedAt: cleanupStartedAt,
        backend: cleanupExecutionPath,
        executionPath: cleanupExecutionPath,
        detail: reason,
      });
      return result.ok;
    } catch (error) {
      const message = boundedBackPositioningError(
        error instanceof Error ? error : new Error(`Safe-off failed after ${reason}.`)
      ).message;
      this.manifest.warnings.push(message);
      this.markWarmPhase({
        id: "warm_safe_cleanup",
        label: "Watchdog safe-off cleanup",
        status: "failed",
        startedAt: cleanupStartedAt,
        backend: cleanupExecutionPath,
        executionPath: cleanupExecutionPath,
        detail: message,
      });
      return false;
    }
  }

  private async runTerminalSafeOff(reason: string) {
    const guardedCleanupOk = await this.runSafeOffCleanup(reason);
    const guardedCleanupError = guardedCleanupOk
      ? undefined
      : boundedBackPositioningError(new Error(`Guarded forensic safe-off cleanup failed after ${reason}.`));
    let directError: ReturnType<typeof boundedBackPositioningError> | undefined;
    try {
      await this.safeOffLiveLighting(reason, "safe_off", { force: true });
    } catch (error) {
      directError = boundedBackPositioningError(error);
      this.updateBackPositioningLight({
        status: "failed",
        captureReady: false,
        captureAuthorization: undefined,
        lastError: directError,
      });
      this.recordBackPositioningLightEvent({
        type: "restore_failure",
        trigger: "safety",
        profileIdentity: this.manifest.liveLighting.backPositioning.profileIdentity,
        error: directError,
      });
      if (!this.manifest.warnings.includes(directError.message)) this.manifest.warnings.push(directError.message);
    }
    return {
      ok: guardedCleanupOk
        && !directError
        && this.safeOffLightingVerificationComplete(),
      directError,
      guardedCleanupOk,
      guardedCleanupError,
    };
  }

  private async runWarmSideCapture(
    side: AiGraderWarmRunnerSide,
    backAuthorization?: NonNullable<AiGraderBackPositioningLightStatus["captureAuthorization"]>
  ): Promise<AiGraderStationCommandResult> {
    const sessionManifest = this.manifest;
    const stepId = side === "front" ? "capture_front" : "capture_back";
    const atomicContext = side === "front" ? this.atomicFrontCaptureContext : this.atomicBackCaptureContext;
    const owner = atomicContext?.owner ?? `warm-${stepId}`;
    const phaseId = `capture_${side}`;
    const label = `${side === "front" ? "Front" : "Back"} full forensic capture stack`;
    this.activateFullForensicPreviewHold(`${side} warm full forensic capture starting`);
    const captureStartedAtMs = Date.now();
    let phase: AiGraderWarmRunnerPhase | undefined;
    let terminalSafeOffAttempted = false;
    let terminalSafeOffResult: Awaited<ReturnType<typeof this.runTerminalSafeOff>> | undefined;
    try {
      if (!atomicContext) await this.stopPreviewForHardwareAction(side);
      if (side === "back" && !atomicContext) {
        this.assertBackCaptureAuthorization(backAuthorization);
        this.updateBackPositioningLight({ captureAuthorization: undefined });
      }
      if (!atomicContext) this.acquireCaptureLock(owner);
      else if (this.captureLock?.owner !== owner) throw new Error(`Atomic ${side === "front" ? "Front" : "Back"} Capture lost capture ownership before warm forensic capture.`);
      this.setExecutionPath("warm_full_forensic_runner", undefined, sessionManifest);
      this.updateEvidenceRoles(side, "active", sessionManifest);
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
        const mockPackageDir = path.join(sessionManifest.outputs.sessionDir ?? this.config.outputDir, `mock-${stepId}`);
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
            captureProfile: sessionManifest.captureProfile,
            rawEvidenceFormat: sessionManifest.captureProfile === "production_fast" ? "tiff" : "png",
            packageDir: mockPackageDir,
          },
        };
        const mockCompletedAt = result.finishedAt ?? new Date().toISOString();
        this.recordCaptureTimingEvent(sessionManifest, { id: "raw_capture_completed", side, at: mockCompletedAt });
        this.recordCaptureTimingEvent(sessionManifest, { id: "side_processing_started", side, at: mockCompletedAt });
        this.recordCaptureTimingEvent(sessionManifest, { id: "side_processing_completed", side, at: mockCompletedAt });
        this.recordCaptureTimingPhase(sessionManifest, {
          id: "side_processing",
          side,
          durationMs: 0,
          startedAt: mockCompletedAt,
          finishedAt: mockCompletedAt,
        });
        sessionManifest.commandResults.push(result);
        this.updateEvidenceRoles(side, "completed", sessionManifest);
        this.markWarmPhase({
          id: phaseId,
          label,
          status: "completed",
          side,
          startedAt: phase?.startedAt,
          backend: "warm_full_forensic_runner",
          executionPath: "warm_full_forensic_runner",
          detail: "Mock warm full forensic side stack captured for UI/test flow.",
        }, sessionManifest);
        this.markWarmPhase({
          id: `process_${side}_artifacts`,
          label: `${side === "front" ? "Front" : "Back"} artifact processing queue`,
          status: "completed",
          side,
          backend: "warm_full_forensic_runner",
          executionPath: "warm_full_forensic_runner",
          detail: "Mock processing completed; real mode processes captured artifacts in this queue.",
        }, sessionManifest);
        sessionManifest.warmRunnerStatus.status = "processing";
        return result;
      }

      this.markForensicLightingOwnership(side);
      const batch = await this.warmRunner.captureSide(this.buildWarmEvidenceInput(side, sessionManifest));
      sessionManifest.captureTimingHardwareEvidence[side].captureBatch = batch.hardwareMeasurement === true;
      this.ensureCaptureTiming(sessionManifest);
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
          captureProfile: sessionManifest.captureProfile,
          rawEvidenceFormat: batch.rawEvidenceFormat,
          packageDir: batch.packageDir,
          warmBatch: batch.batch,
        },
      };
      const rawCompletedAt = result.finishedAt ?? new Date().toISOString();
      this.recordCaptureTimingEvent(sessionManifest, { id: "raw_capture_completed", side, at: rawCompletedAt });
      const processingStartedAt = new Date().toISOString();
      this.recordCaptureTimingEvent(sessionManifest, { id: "side_processing_started", side, at: processingStartedAt });
      sessionManifest.commandResults.push(result);
      this.updateEvidenceRoles(side, "completed", sessionManifest);
      this.markWarmPhase({
        id: phaseId,
        label,
        status: "completed",
        side,
        startedAt: phase?.startedAt,
        backend: "warm_full_forensic_runner",
        executionPath: "warm_full_forensic_runner",
        detail: "Full forensic side stack captured through warm Basler/Leimac side batch.",
      }, sessionManifest);
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
      }, sessionManifest);
      const processingKey = this.warmProcessingKey(sessionManifest, side);
      const processingSessionId = sessionManifest.sessionId;
      if (!processingSessionId) throw new Error("Warm processing requires an active session identity.");
      const processingRequestId = `fixed-rig-processing-${crypto.randomUUID()}`;
      const processingJob = this.warmRunner.processSide(batch, {
        requestId: processingRequestId,
        sessionId: processingSessionId,
      }).then(async (processed) => {
        this.assertWarmProcessingIdentity({
          requestId: processingRequestId,
          sessionId: processingSessionId,
          side,
          batch,
          processed,
          manifest: sessionManifest,
        });
        this.recordProcessedSideTiming(sessionManifest, side, processed);
        this.markWarmPhase({
          id: `process_${side}_artifacts`,
          label: `${side === "front" ? "Front" : "Back"} artifact processing queue`,
          status: "completed",
          side,
          startedAt: processingPhase.startedAt,
          backend: "warm_full_forensic_runner",
          executionPath: "warm_full_forensic_runner",
          detail: "Warm captured artifacts processed; report-compatible manifest, ROI/display crops, Surface Intelligence inputs, and Vision Lab inputs are ready.",
        }, sessionManifest);
        sessionManifest.updatedAt = new Date().toISOString();
        await writeSessionManifest(sessionManifest);
        return processed;
      }).catch(async (error) => {
        const message = boundedProcessingWorkerError(error);
        const failedAt = new Date().toISOString();
        const intentionallyCancelled = this.closing
          || this.processingSessionsCancelling.has(processingSessionId)
          || sessionManifest.currentStep === "session_complete";
        if (intentionallyCancelled) {
          this.markWarmPhase({
            id: `process_${side}_artifacts`,
            label: `${side === "front" ? "Front" : "Back"} artifact processing queue`,
            status: "cancelled",
            side,
            startedAt: processingPhase.startedAt,
            backend: "warm_full_forensic_runner",
            executionPath: "warm_full_forensic_runner",
            detail: "Captured-evidence processing was cancelled by the terminal bridge lifecycle.",
          }, sessionManifest);
          if (sessionManifest === this.manifest && sessionManifest.currentStep === "session_complete") {
            sessionManifest.warmRunnerStatus.status = "cancelled";
          }
          sessionManifest.progressLog.push(`${failedAt} ${side} captured-evidence processing worker reconciled with the terminal bridge lifecycle.`);
          sessionManifest.updatedAt = failedAt;
          if (!this.closing) {
            await writeSessionManifest(sessionManifest);
          }
          throw new Error(message);
        }

        this.processingSessionsCancelling.add(processingSessionId);
        let workerReconcileError: Error | undefined;
        try {
          await this.warmRunner.cancelSession?.(processingSessionId, `${side} captured-evidence processing failure`);
        } catch (reconcileError) {
          workerReconcileError = new Error(boundedProcessingWorkerError(reconcileError));
        }
        const terminalMessage = workerReconcileError
          ? boundedProcessingWorkerError(new Error(`${message} Worker reconciliation also failed: ${workerReconcileError.message}`))
          : message;
        this.markWarmPhase({
          id: `process_${side}_artifacts`,
          label: `${side === "front" ? "Front" : "Back"} artifact processing queue`,
          status: "failed",
          side,
          startedAt: processingPhase.startedAt,
          backend: "warm_full_forensic_runner",
          executionPath: "warm_full_forensic_runner",
          detail: terminalMessage,
        }, sessionManifest);
        sessionManifest.warmRunnerStatus.status = "failed";
        sessionManifest.captureFailure = {
          side,
          stage: "warm_processing",
          message: terminalMessage,
          at: failedAt,
        };
        if (!sessionManifest.warnings.includes(terminalMessage)) sessionManifest.warnings.push(terminalMessage);
        let terminalCleanupError: Error | undefined;
        try {
          if (sessionManifest === this.manifest) {
            await this.serializeTerminalLifecycle(async () => {
              const frontAtomic = this.currentAtomicFrontCapturePromise();
              if (frontAtomic) await frontAtomic.catch(() => undefined);
              const atomic = this.currentAtomicBackCapturePromise();
              if (atomic) await atomic.catch(() => undefined);
              await this.awaitLightingLifecycleIdle();
              if (sessionManifest !== this.manifest) return;
              const safeOff = await this.runTerminalSafeOff(`${side} processing failure`);
              if (!safeOff.ok) {
                terminalCleanupError = new Error(
                  safeOff.directError?.message
                    ?? safeOff.guardedCleanupError?.message
                    ?? `${side} processing failure safe-off could not be verified.`
                );
              }
              let previewReleased = false;
              try {
                await this.stopPreviewStream(`${side} processing failure released preview`, {
                  waitForRelease: true,
                  settleMs: PREVIEW_CAMERA_SETTLE_MS,
                });
                previewReleased = true;
              } catch (cleanupError) {
                if (!terminalCleanupError) terminalCleanupError = new Error(boundedPreviewLifecycleError(cleanupError));
              }
              const lightVerifiedOff = this.manifest.liveLighting.physicalState.state === "safe_off_verified";
              this.updatePreviewStatus({
                status: "error",
                cameraOwnership: previewReleased ? "released" : this.manifest.previewStatus.cameraOwnership,
                positioningLightReady: false,
                lastError: terminalCleanupError?.message ?? terminalMessage,
                lastStopReason: previewReleased && lightVerifiedOff
                  ? `${side} processing failed; preview released and positioning light safe-off was verified.`
                  : `${side} processing failed; terminal cleanup is incomplete and physical/camera state remains authoritative above.`,
              });
            });
          }
          await writeSessionManifest(sessionManifest);
          if (terminalCleanupError) throw terminalCleanupError;
          throw new Error(terminalMessage);
        } finally {
          this.processingSessionsCancelling.delete(processingSessionId);
        }
      });
      const trackedProcessingJob = processingJob.finally(() => {
        if (this.warmProcessingJobs.get(processingKey) === trackedProcessingJob) {
          this.warmProcessingJobs.delete(processingKey);
        }
      });
      this.warmProcessingJobs.set(processingKey, trackedProcessingJob);
      void trackedProcessingJob.catch(() => {});
      this.markWarmPhase({
        id: `process_${side}_artifacts_started`,
        label: `${side === "front" ? "Front" : "Back"} processing started`,
        status: "completed",
        side,
        backend: "warm_full_forensic_runner",
        executionPath: "warm_full_forensic_runner",
        detail: "Background processing queue accepted the warm side batch.",
      }, sessionManifest);
      sessionManifest.warmRunnerStatus.status = "processing";
      // Yield only through the immediate promise chain so synchronous process
      // rejection becomes terminal before the capture handler advances state.
      // Long-running processing is still fully backgrounded.
      await Promise.resolve();
      await Promise.resolve();
      return result;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : `${side} warm capture failed.`;
      if (side === "back" && !atomicContext && !this.captureLock && /Back Capture authorization/i.test(message)) {
        sessionManifest.currentStep = "prompt_flip_card";
        this.updateBackPositioningLight({ captureAuthorization: undefined, captureReady: false });
        this.releaseFullForensicPreviewHold("back capture authorization expired before camera ownership");
        sessionManifest.progressLog.push(`${failedAt} Back capture authorization expired before camera ownership; front evidence remains preserved and a fresh current frame is required.`);
        await writeSessionManifest(sessionManifest);
        throw error;
      }
      sessionManifest.warmRunnerStatus.status = "failed";
      this.updateEvidenceRoles(side, "failed", sessionManifest);
      this.markWarmPhase({
        id: phaseId,
        label,
        status: "failed",
        side,
        startedAt: phase?.startedAt,
        backend: "warm_full_forensic_runner",
        executionPath: "warm_full_forensic_runner",
        detail: message,
      }, sessionManifest);
      sessionManifest.captureFailure = {
        side,
        stage: "warm_capture",
        message,
        at: failedAt,
      };
      sessionManifest.captureTimingHardwareEvidence[side] = { captureBatch: false, processedManifest: false };
      this.ensureCaptureTiming(sessionManifest);
      sessionManifest.captureProfileGuard.fiveSecondTargetProven = false;
      if (!sessionManifest.warnings.includes(message)) sessionManifest.warnings.push(message);
      sessionManifest.progressLog.push(`${failedAt} ${side} warm capture failed; fatal bridge cleanup runs Safe Off and Start New Card remains the only next workflow.`);
      if (!terminalSafeOffAttempted) {
        terminalSafeOffAttempted = true;
        terminalSafeOffResult = await this.runTerminalSafeOff(`${side} warm capture failure`);
      }
      sessionManifest.warmRunnerStatus.status = "failed";
      this.releaseFullForensicPreviewHold(`${side} warm capture failed after safe-off cleanup`);
      this.updatePreviewStatus({
        status: "error",
        cameraOwnership: "released",
        lastError: message,
        lastStopReason: `${side} warm capture failed after fatal safe-off cleanup.`,
      });
      if (!atomicContext && this.captureLock?.owner === owner) this.releaseCaptureLock(owner);
      sessionManifest.updatedAt = new Date().toISOString();
      await writeSessionManifest(sessionManifest);
      if (!terminalSafeOffResult?.ok) {
        const cleanup = terminalSafeOffResult?.directError?.message
          ?? terminalSafeOffResult?.guardedCleanupError?.message
          ?? "Post-capture safe-off could not be verified.";
        throw new Error(`${message} ${cleanup}`);
      }
      throw error;
    } finally {
      if (!atomicContext && this.captureLock?.owner === owner) this.releaseCaptureLock(owner);
    }
  }

  private async runWarmReport(manifest: AiGraderLocalStationBridgeManifest = this.manifest): Promise<AiGraderStationCommandResult> {
    if (!manifest.outputs.frontPackageDir || !manifest.outputs.backPackageDir) {
      throw new Error("Unified report requires both front and back evidence package folders.");
    }
    const phase = this.markWarmPhase({
      id: "report_queue",
      label: "Unified report queue",
      status: "active",
      backend: manifest.executionPath,
      executionPath: manifest.executionPath,
      detail: "Builds from already processed front/back full forensic artifacts.",
    }, manifest);
    manifest.warmRunnerStatus.status = "reporting";
    await Promise.all([this.awaitWarmProcessing(manifest, "front"), this.awaitWarmProcessing(manifest, "back")]);
    const reportStartedAt = new Date().toISOString();
    this.recordCaptureTimingEvent(manifest, { id: "report_generation_started", at: reportStartedAt });
    const step = {
      ...stepById(this.config, manifest, "unified_report"),
      args: [
        "ai-grader-fixed-rig-v1-card-report",
        "--output-dir",
        this.config.outputDir,
        "--front-dir",
        manifest.outputs.frontPackageDir,
        "--back-dir",
        manifest.outputs.backPackageDir,
      ],
    };
    const result = await runStepOrMock(this.config, manifest, this.runner, step);
    const reportFinishedAt = result.finishedAt ?? new Date().toISOString();
    this.recordCaptureTimingPhase(manifest, {
      id: "report_generation",
      durationMs: result.durationMs ?? Math.max(0, Date.parse(reportFinishedAt) - Date.parse(reportStartedAt)),
      startedAt: result.startedAt ?? reportStartedAt,
      finishedAt: reportFinishedAt,
    });
    result.payload = {
      ...(result.payload ?? {}),
      executionPath: manifest.executionPath,
    };
    manifest.commandResults.push(result);
    this.markWarmPhase({
      id: "report_queue",
      label: "Unified report queue",
      status: result.ok ? "completed" : "failed",
      startedAt: phase.startedAt,
      backend: manifest.executionPath,
      executionPath: manifest.executionPath,
      detail: result.ok ? "Unified report, Surface Intelligence, and Vision Lab outputs preserved." : result.error ?? "Unified report failed.",
    }, manifest);
    manifest.warmRunnerStatus.status = result.ok ? "complete" : "failed";
    if (!result.ok) {
      const safeOff = manifest === this.manifest ? await this.runTerminalSafeOff("warm report failure") : undefined;
      manifest.warmRunnerStatus.status = "failed";
      if (safeOff && !safeOff.ok) {
        throw new Error(
          `${result.error ?? "Unified provisional diagnostics failed."} ${safeOff.directError?.message
            ?? safeOff.guardedCleanupError?.message
            ?? "Report-failure safe-off could not be verified."}`
        );
      }
      throw new Error(result.error ?? "Unified provisional diagnostics failed.");
    }
    this.recordCaptureTimingEvent(manifest, { id: "report_ready", at: reportFinishedAt });
    return result;
  }

  async streamPreview(req: http.IncomingMessage, res: http.ServerResponse, origin: string | undefined): Promise<void> {
    if (this.closing || this.terminalLifecyclePending > 0 || this.lightingLifecyclePending > 0) {
      sendJson(
        res,
        409,
        {
          ok: false,
          code: "AI_GRADER_LIFECYCLE_BUSY",
          message: "Preview is unavailable while a lighting or terminal lifecycle owns the bridge.",
          result: this.previewStatus(),
        },
        origin,
        this.config,
      );
      return Promise.resolve();
    }
    if (this.frontCaptureTransition && !this.captureLock) {
      sendJson(
        res,
        409,
        {
          ok: false,
          code: "AI_GRADER_LIFECYCLE_BUSY",
          message: "Preview is unavailable during the serialized Front Capture lifecycle reservation.",
          result: this.previewStatus(),
        },
        origin,
        this.config,
      );
      return Promise.resolve();
    }
    if (!this.manifest.sessionId) {
      this.updatePreviewStatus({
        status: "stopped",
        cameraOwnership: "released",
        lastStopReason: "A session-bound preview requires an active station session.",
      });
      sendJson(
        res,
        409,
        {
          ok: false,
          code: "AI_GRADER_PREVIEW_SESSION_REQUIRED",
          message: "Start a station session before opening the session-bound preview.",
          result: this.previewStatus(),
        },
        origin,
        this.config
      );
      return Promise.resolve();
    }
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
    const previewStartedAt = new Date().toISOString();
    const binding = {
      sessionId: this.manifest.sessionId,
      side: this.manifest.previewStatus.activeSide,
      sideEpoch: this.manifest.previewStatus.sideEpoch,
    };
    const streamSequence = ++this.previewStreamSequence;
    const streamId = `stream-${streamSequence}-${binding.sideEpoch}`;
    this.updatePreviewStatus({
      status: "starting",
      intentionalTransition: { active: false },
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
      sessionId: binding.sessionId,
      activeSide: binding.side,
      sideEpoch: binding.sideEpoch,
      latestFrameId: undefined,
      positioningLightReady: this.manifest.liveLighting.backPositioning.captureReady,
      fps: undefined,
      startedAt: previewStartedAt,
      firstFrameAt: undefined,
      lastFrameAt: undefined,
      lastError: undefined,
      lastStopReason: undefined,
    });
    this.recordCaptureTimingEvent(this.manifest, { id: "preview_stream_started", at: previewStartedAt });
    setMjpegHeaders(res, origin, this.config, binding, streamId);

    return new Promise<void>((resolve) => {
      let settled = false;
      let mockPreviewTimer: ReturnType<typeof setInterval> | undefined;
      const finish = (reason: string) => {
        if (settled) return;
        settled = true;
        const intentionalCaptureTransition = this.manifest.previewStatus.intentionalTransition.active
          && (
            this.manifest.previewStatus.intentionalTransition.kind === "capture_front"
            || this.manifest.previewStatus.intentionalTransition.kind === "capture_back"
          )
          && this.manifest.previewStatus.intentionalTransition.sessionId === binding.sessionId
          && this.manifest.previewStatus.intentionalTransition.side === binding.side
          && this.manifest.previewStatus.intentionalTransition.sideEpoch === binding.sideEpoch;
        if (mockPreviewTimer) {
          clearInterval(mockPreviewTimer);
          mockPreviewTimer = undefined;
        }
        this.previewStop = undefined;
        if (this.previewProcess) this.stopPreviewProcessTree(this.previewProcess);
        this.previewProcess = undefined;
        this.updatePreviewStatus({
          status: intentionalCaptureTransition ? "paused_for_capture" : reason.includes("error") ? "error" : "stopped",
          cameraOwnership: intentionalCaptureTransition ? "capture_action" : "released",
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
          if (
            binding.sessionId !== this.manifest.sessionId
            || binding.side !== this.manifest.previewStatus.activeSide
            || binding.sideEpoch !== this.manifest.previewStatus.sideEpoch
          ) {
            finish("preview epoch replaced");
            return;
          }
          frameCount += 1;
          const generatedAt = new Date().toISOString();
          const frameId = `frame-${streamSequence}-${frameCount}`;
          writeMjpegFrame(res, "image/svg+xml", mockPreviewSvg(frameCount, generatedAt), frameCount, generatedAt, binding, frameId);
          this.notePreviewFrame(frameCount, binding, frameId, generatedAt);
          this.noteMockPreviewGeometry(frameCount, frameId);
        };
        send();
        mockPreviewTimer = setInterval(send, 250);
        this.previewStop = (reason: string) => {
          finish(reason);
        };
        return;
      }

      try {
        const child = this.startPreviewProcess();
        this.previewProcess = child;
        let frameCount = 0;
        const jpegFrames = new AiGraderPreviewJpegFrameAssembler();
        child.stdout.on("data", (chunk: Buffer) => {
          if (settled || res.destroyed) return;
          for (const frame of jpegFrames.pushWithMetadata(chunk)) {
            if (
              binding.sessionId !== this.manifest.sessionId
              || binding.side !== this.manifest.previewStatus.activeSide
              || binding.sideEpoch !== this.manifest.previewStatus.sideEpoch
            ) {
              finish("preview epoch replaced");
              return;
            }
            frameCount += 1;
            const frameId = `frame-${streamSequence}-${frame.frameIndex ?? frameCount}`;
            writeMjpegFrame(
              res,
              "image/jpeg",
              frame.bytes,
              frame.frameIndex ?? frameCount,
              frame.capturedAt ?? frame.receivedAt,
              binding,
              frameId
            );
            this.notePreviewFrame(frameCount, binding, frameId, frame.capturedAt ?? frame.receivedAt);
            this.queuePreviewGeometryAnalysis(
              frame.bytes,
              frame.frameIndex ?? frameCount,
              frame.capturedAt ?? frame.receivedAt,
              frame.timestampSource,
              frameId,
              binding
            );
          }
        });
        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf-8").trim();
          if (text) this.updatePreviewStatus({ lastError: boundedPreviewLifecycleError(text) });
        });
        child.on("error", (error) => {
          this.updatePreviewStatus({ status: "error", lastError: boundedPreviewLifecycleError(error), cameraOwnership: "released" });
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
          this.stopPreviewProcessTree(child);
          finish(reason);
        };
      } catch (error) {
        this.updatePreviewStatus({
          status: "error",
          cameraOwnership: "released",
          lastError: boundedPreviewLifecycleError(error),
        });
        finish("preview start error");
      }
    });
  }

  private async attachVerifiedReportAssetBodies(
    expectedReportId: string,
    authoritativeBundle: AiGraderReportBundle,
  ): Promise<AiGraderReportBundle> {
    try {
      const recoverySource = await this.findReportRecoverySource(expectedReportId);
      if (!recoverySource ||
          authoritativeBundle.reportId !== expectedReportId ||
          authoritativeBundle.gradingSessionId !== recoverySource.manifest.sessionId ||
          typeof authoritativeBundle.localReportFolder !== "string" ||
          path.resolve(authoritativeBundle.localReportFolder) !== path.resolve(recoverySource.reportDir)) {
        throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      }
      const bodyBundle = await buildAiGraderReportBundle({
        reportDir: recoverySource.reportDir,
        outputDir: publishPackageDir(this.config, expectedReportId),
        reportId: expectedReportId,
        generatedAt: authoritativeBundle.generatedAt,
        gradingSessionId: authoritativeBundle.gradingSessionId,
        cardIdentity: authoritativeBundle.cardIdentity,
        publicBasePath: this.config.publicBasePath,
        includeAssetBodies: true,
        captureTiming: authoritativeBundle.captureTiming ?? this.captureTimingSnapshot(recoverySource.manifest),
        geometryCaptureDecisions: authoritativeBundle.geometryCaptureDecisions ??
          this.geometryCaptureDecisionSnapshot(recoverySource.manifest),
        ocrPrefill: authoritativeBundle.ocrPrefill,
      });
      if (bodyBundle.reportId !== authoritativeBundle.reportId ||
          bodyBundle.gradingSessionId !== authoritativeBundle.gradingSessionId) {
        throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      }
      const authoritativeImages = authoritativeBundle.assets.filter((asset) => asset.kind === "image");
      const bodyImages = bodyBundle.assets.filter((asset) => asset.kind === "image");
      const bodyImagesById = new Map(bodyImages.map((asset) => [asset.id, asset]));
      if (bodyImagesById.size !== bodyImages.length || bodyImages.length !== authoritativeImages.length ||
          new Set(authoritativeImages.map((asset) => asset.id)).size !== authoritativeImages.length) {
        throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      }
      const verifiedBodies = new Map<string, Pick<AiGraderReportBundleAsset, "bodyEncoding" | "bodyBase64">>();
      for (const authoritativeAsset of authoritativeImages) {
        const bodyAsset = bodyImagesById.get(authoritativeAsset.id);
        if (!bodyAsset ||
            !/^[a-f0-9]{64}$/.test(authoritativeAsset.sha256 ?? "") ||
            !Number.isSafeInteger(authoritativeAsset.byteSize) ||
            Number(authoritativeAsset.byteSize) <= 0 ||
            bodyAsset.sha256 !== authoritativeAsset.sha256 ||
            bodyAsset.byteSize !== authoritativeAsset.byteSize ||
            (authoritativeAsset.contentType !== undefined && bodyAsset.contentType !== authoritativeAsset.contentType) ||
            (authoritativeAsset.widthPx !== undefined && bodyAsset.widthPx !== authoritativeAsset.widthPx) ||
            (authoritativeAsset.heightPx !== undefined && bodyAsset.heightPx !== authoritativeAsset.heightPx) ||
            (authoritativeAsset.side !== undefined && bodyAsset.side !== authoritativeAsset.side) ||
            (authoritativeAsset.evidenceRole !== undefined && bodyAsset.evidenceRole !== authoritativeAsset.evidenceRole) ||
            bodyAsset.bodyEncoding !== "base64" ||
            typeof bodyAsset.bodyBase64 !== "string") {
          throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
        }
        const normalizedBody = bodyAsset.bodyBase64.replace(/\s/g, "");
        const bodyBytes = Buffer.from(normalizedBody, "base64");
        if (!normalizedBody ||
            bodyBytes.toString("base64") !== normalizedBody ||
            bodyBytes.byteLength !== authoritativeAsset.byteSize ||
            crypto.createHash("sha256").update(bodyBytes).digest("hex") !== authoritativeAsset.sha256) {
          throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
        }
        verifiedBodies.set(authoritativeAsset.id, {
          bodyEncoding: "base64",
          bodyBase64: normalizedBody,
        });
      }
      return {
        ...authoritativeBundle,
        assets: authoritativeBundle.assets.map((asset) => {
          const { bodyEncoding: _unverifiedEncoding, bodyBase64: _unverifiedBody, ...cleanAsset } = asset;
          const verifiedBody = verifiedBodies.get(asset.id);
          return verifiedBody ? { ...cleanAsset, ...verifiedBody } : cleanAsset;
        }),
      };
    } catch {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
  }

  private async reportBundleResponse(input: {
    expectedReportId: string;
    bundle: AiGraderReportBundle;
    productionRelease?: AiGraderProductionRelease;
    source: string;
    includeAssetBodies?: boolean;
  }): Promise<{
    reportId: string;
    gradingSessionId: string;
    gradingContract: "legacy_v0";
    bundle: AiGraderReportBundle;
    source: string;
  }> {
    const authoritativeBundle = bundleWithProductionRelease(input.bundle, input.productionRelease);
    const responseBundle = input.includeAssetBodies
      ? await this.attachVerifiedReportAssetBodies(input.expectedReportId, authoritativeBundle)
      : authoritativeBundle;
    return {
      reportId: input.expectedReportId,
      gradingSessionId: responseBundle.gradingSessionId,
      gradingContract: "legacy_v0",
      bundle: responseBundle,
      source: input.includeAssetBodies ? input.source + "_with_asset_bodies" : input.source,
    };
  }

  async reportBundle(
    reportId: string | undefined,
    options: { includeAssetBodies?: boolean } = {}
  ): Promise<
    | {
        reportId: string;
        gradingSessionId: string;
        gradingContract: "legacy_v0";
        bundle: AiGraderReportBundle;
        source: string;
      }
    | {
        reportId: string;
        gradingSessionId: string;
        gradingContract: "mathematical_calibration_v1";
        bundle: AiGraderReportBundleV03;
        source: string;
      }
  > {
    const expectedReportId = reportId?.trim() || this.manifest.reportId;
    if (!expectedReportId) throw new Error("No AI Grader report ID is available yet.");
    return withAiGraderReportPackageOperation(expectedReportId, async () => {
      const stationSource = await this.findStationManifestForReport(expectedReportId);
      if (stationSource && gradingContractFor(stationSource.manifest) === "mathematical_calibration_v1") {
        return this.mathematicalReportBundleResponse(expectedReportId);
      }
      const recoverySource = await this.findReportRecoverySource(expectedReportId);
      await reconcileAiGraderReportPackageTransaction({
        canonicalDir: publishPackageDir(this.config, expectedReportId),
        reportId: expectedReportId,
        gradingSessionId: recoverySource?.manifest.sessionId,
        reportDir: recoverySource?.reportDir,
      });
      return this.reportBundleUnlocked(expectedReportId, options);
    });
  }

  async reportAsset(reportId: string, assetId: string): Promise<{
    id: string;
    bytes: Buffer;
    contentType: string;
    sha256: string;
  }> {
    const resolved = await this.reportBundle(reportId);
    if (resolved.gradingContract === "mathematical_calibration_v1") {
      const source = await this.findStationManifestForReport(reportId);
      if (!source) throw new Error("Mathematical Grading V1 station manifest is unavailable.");
      const reportPackage = await this.resolveMathematicalReportPackage(source.manifest, {});
      const asset = await readAiGraderMathematicalReportAssetV1({
        packagePath: reportPackage.outputDir,
        assetId,
      });
      return {
        id: asset.asset.id,
        bytes: asset.bytes,
        contentType: asset.asset.contentType ?? "application/octet-stream",
        sha256: asset.asset.sha256 ?? asset.asset.checksumSha256 ?? crypto.createHash("sha256").update(asset.bytes).digest("hex"),
      };
    }
    const asset = resolved.bundle.assets.find((candidate) => candidate.id === assetId);
    if (!asset?.localPath || asset.kind !== "image") {
      throw new Error("AI Grader report asset " + assetId + " is not available as a local image file.");
    }
    const bytes = await readFile(asset.localPath);
    return {
      id: asset.id,
      bytes,
      contentType: asset.contentType ?? "application/octet-stream",
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async mathematicalReviewAsset(reportId: string, assetId: string): Promise<{
    id: string;
    bytes: Buffer;
    contentType: string;
    sha256: string;
    side: "front" | "back";
    evidenceRole: FixedRigMathematicalFindingReviewAssetMetadataV1["evidenceRole"];
    widthPx: number;
    heightPx: number;
  }> {
    if (!reportId.trim() || !assetId.trim()) {
      throw new Error("Pending Mathematical review asset requires exact reportId and assetId.");
    }
    const source = await this.findStationManifestForReport(reportId);
    const execution = source?.manifest.mathematicalV1?.execution;
    if (!source || gradingContractFor(source.manifest) !== "mathematical_calibration_v1" ||
        execution?.status !== "finding_review_required") {
      throw new Error("Mathematical review assets are available only for one exact pending review request.");
    }
    const asset = source.manifest.mathematicalV1?.reviewAssets?.[assetId];
    const namedByRequest = execution.reviewRequest.findings.some((finding) =>
      finding.trueView.assetId === assetId ||
      finding.directionalChannels.some((channel) => channel.assetId === assetId) ||
      finding.reviewEvidence.roi.assetId === assetId ||
      finding.reviewEvidence.segmentationMask.assetId === assetId ||
      finding.reviewEvidence.confidenceMask.assetId === assetId ||
      finding.reviewEvidence.illuminationMask.assetId === assetId);
    if (!asset || !namedByRequest || !source.manifest.outputs.sessionDir ||
        !isSubpath(asset.filePath, source.manifest.outputs.sessionDir) ||
        !isSubpath(asset.filePath, this.config.outputDir)) {
      throw new Error("Requested asset is not an exact hash-bound source in the pending review request.");
    }
    const bytes = await readFile(asset.filePath);
    if (bytes.byteLength !== asset.byteSize ||
        crypto.createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new Error("Pending Mathematical review asset changed after exact request generation.");
    }
    return {
      id: asset.assetId,
      bytes,
      contentType: asset.contentType,
      sha256: asset.sha256,
      side: asset.side,
      evidenceRole: asset.evidenceRole,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
    };
  }

  private async reportBundleUnlocked(
    expectedReportId: string,
    options: { includeAssetBodies?: boolean } = {},
  ): Promise<{
    reportId: string;
    gradingSessionId: string;
    gradingContract: "legacy_v0";
    bundle: AiGraderReportBundle;
    source: string;
  }> {
    const packageDir = publishPackageDir(this.config, expectedReportId);
    const canonicalBundlePath = publishPackagePath(this.config, expectedReportId, "report-bundle.json");
    const canonicalDirExists = await recoveryPathExists(packageDir);
    const canonicalBundleExists = canonicalDirExists
      ? await recoveryPathExists(canonicalBundlePath)
      : false;
    if (canonicalDirExists && !canonicalBundleExists) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    const canonicalBundle = await readBundleFromPath(canonicalBundlePath);
    if (canonicalBundleExists && canonicalBundle?.reportId !== expectedReportId) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    if (canonicalBundle?.reportId === expectedReportId) {
      const resolved = await this.recoverReportBundleIfNeeded({
        reportId: expectedReportId,
        bundle: canonicalBundle,
        packageDir,
      });
      return this.reportBundleResponse({
        expectedReportId,
        bundle: resolved.bundle,
        productionRelease: resolved.productionRelease,
        source: resolved.recovered ? "canonical_publish_package_recovered" : "canonical_publish_package",
        includeAssetBodies: options.includeAssetBodies,
      });
    }
    if (this.manifest.reportBundle?.reportId === expectedReportId &&
        !isMathematicalReportBundle(this.manifest.reportBundle)) {
      const resolved = await this.recoverReportBundleIfNeeded({
        reportId: expectedReportId,
        bundle: this.manifest.reportBundle,
        packageDir: options.includeAssetBodies
          ? packageDir
          : this.manifest.outputs.reportBundlePath
          ? path.dirname(this.manifest.outputs.reportBundlePath)
          : packageDir,
      });
      return this.reportBundleResponse({
        expectedReportId,
        bundle: resolved.bundle,
        productionRelease: resolved.productionRelease,
        source: resolved.recovered ? "active_manifest_memory_recovered" : "active_manifest_memory",
        includeAssetBodies: options.includeAssetBodies,
      });
    }

    const bundleFromPath = await readBundleFromPath(this.manifest.outputs.reportBundlePath);
    if (bundleFromPath?.reportId === expectedReportId) {
      this.manifest.reportBundle = bundleFromPath;
      const resolved = await this.recoverReportBundleIfNeeded({
        reportId: expectedReportId,
        bundle: bundleFromPath,
        packageDir: options.includeAssetBodies
          ? packageDir
          : this.manifest.outputs.reportBundlePath
          ? path.dirname(this.manifest.outputs.reportBundlePath)
          : packageDir,
      });
      this.manifest.reportBundle = resolved.bundle;
      this.manifest.productionRelease = resolved.productionRelease;
      return this.reportBundleResponse({
        expectedReportId,
        bundle: resolved.bundle,
        productionRelease: resolved.productionRelease,
        source: resolved.recovered ? "active_manifest_report_bundle_path_recovered" : "active_manifest_report_bundle_path",
        includeAssetBodies: options.includeAssetBodies,
      });
    }

    const reportDir = this.manifest.outputs.unifiedReportDir ?? dirnameIfFile(this.manifest.outputs.unifiedReportPath);
    if (reportDir && this.manifest.reportId === expectedReportId) {
      const bundle = await buildAiGraderReportBundle({
        reportDir,
        outputDir: packageDir,
        reportId: expectedReportId,
        publicBasePath: this.config.publicBasePath,
        captureTiming: this.captureTimingSnapshot(this.manifest),
        geometryCaptureDecisions: this.geometryCaptureDecisionSnapshot(this.manifest),
      });
      this.manifest.reportBundle = bundle;
      return this.reportBundleResponse({
        expectedReportId,
        bundle,
        source: options.includeAssetBodies ? "active_manifest_generated" : "active_manifest_generated_from_report_dir",
        includeAssetBodies: options.includeAssetBodies,
      });
    }

    const historySource = await this.findReportRecoverySource(expectedReportId);
    if (historySource) {
      const historyBundle = await readBundleFromPath(historySource.manifest.outputs.reportBundlePath);
      if (historyBundle?.reportId === expectedReportId) {
        const resolved = await this.recoverReportBundleIfNeeded({
          reportId: expectedReportId,
          bundle: historyBundle,
          packageDir: options.includeAssetBodies
            ? packageDir
            : historySource.manifest.outputs.reportBundlePath
            ? path.dirname(historySource.manifest.outputs.reportBundlePath)
            : packageDir,
        });
        return this.reportBundleResponse({
          expectedReportId,
          bundle: resolved.bundle,
          productionRelease: resolved.productionRelease,
          source: resolved.recovered ? "history_report_bundle_path_recovered" : "history_report_bundle_path",
          includeAssetBodies: options.includeAssetBodies,
        });
      }
      const generated = await buildAiGraderReportBundle({
        reportDir: historySource.reportDir,
        outputDir: packageDir,
        reportId: expectedReportId,
        gradingSessionId: historySource.manifest.sessionId,
        publicBasePath: this.config.publicBasePath,
        captureTiming: this.captureTimingSnapshot(historySource.manifest),
        geometryCaptureDecisions: this.geometryCaptureDecisionSnapshot(historySource.manifest),
      });
      return this.reportBundleResponse({
        expectedReportId,
        bundle: generated,
        source: options.includeAssetBodies ? "history_generated" : "history_generated_from_report_dir",
        includeAssetBodies: options.includeAssetBodies,
      });
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

  private async writeProductionRelease(request: AiGraderLocalStationBridgeActionRequest): Promise<AiGraderStationProductionRelease> {
    const reportId = this.manifest.reportId;
    if (!reportId) throw new Error("Production release requires an active AI Grader report ID.");
    if (!this.manifest.outputs.reportBundlePath) {
      await this.action("export-report-bundle", request);
    }
    return this.writeProductionReleaseForManifest(this.manifest, request);
  }

  private async writeProductionReleaseForManifest(
    manifest: AiGraderLocalStationBridgeManifest,
    request: AiGraderLocalStationBridgeActionRequest,
  ): Promise<AiGraderStationProductionRelease> {
    const reportId = manifest.reportId;
    if (!reportId || !manifest.sessionId) {
      throw new Error("Production release requires one exact report and grading-session identity.");
    }
    if (gradingContractFor(manifest) === "mathematical_calibration_v1") {
      return withAiGraderReportPackageOperation(reportId, async () => {
        const reportPackage = await this.resolveMathematicalReportPackage(manifest, request);
        this.applyMathematicalReportPackage(manifest, reportPackage);
        const result = await writeAiGraderMathematicalProductionReleaseV1({
          packagePath: reportPackage.outputDir,
          operatorId: request.operatorId,
          warningsAccepted: request.warningsAccepted,
          overrideReason: request.overrideReason,
        });
        const release = result.productionRelease;
        const expectedPublication =
          this.hydratedMathematicalGradingAuthority(manifest).publication;
        const elementNames = ["centering", "corners", "edges", "surface"] as const;
        const identityFields = [
          "title", "sideCount", "tenantId", "setId", "programId",
          "cardNumber", "variantId", "parallelId",
        ] as const;
        if (
          release.schemaVersion !== AI_GRADER_MATHEMATICAL_PRODUCTION_RELEASE_V1_VERSION ||
          release.reportId !== reportId ||
          release.gradingSessionId !== manifest.sessionId ||
          release.reportStatus !== "final_ai_grader_report_v1" ||
          release.finalStatus !== "final_grade_computed" ||
          release.finalGrade.status !== "final_mathematical_grade_v1" ||
          release.finalGradeComputed !== true ||
          release.labelDataGenerated !== true ||
          release.qrPayloadGenerated !== true ||
          release.certifiedClaim !== false ||
          release.certificateGenerated !== false ||
          release.label.status !== "label_data_ready" ||
          release.label.labelVersion !== "ten-kings-ai-grader-label-v1" ||
          release.label.reportId !== reportId ||
          release.label.certificateStatus !== "report_id_issued_not_certified" ||
          release.label.certifiedClaim !== false ||
          release.label.certId !== expectedPublication.certId ||
          release.label.publicReportUrl !== expectedPublication.publicReportUrl ||
          release.label.qrPayloadUrl !== expectedPublication.qrPayloadUrl ||
          release.publication.reportId !== reportId ||
          release.publication.publicReportUrl !== expectedPublication.publicReportUrl ||
          release.publication.qrPayloadUrl !== expectedPublication.qrPayloadUrl ||
          release.label.labelGradeText !== release.finalGrade.labelGrade.toFixed(1) ||
          elementNames.some((element) =>
            release.label.elementScores[element] !== release.finalGrade.elements[element].score ||
            release.label.elementScores[element] < 1 ||
            release.label.elementScores[element] > 10) ||
          identityFields.some((field) =>
            release.cardIdentity[field] !==
              manifest.mathematicalV1!.gradingAuthority.cardIdentity[field] ||
            release.label.cardIdentity[field] !== release.cardIdentity[field])
        ) {
          throw new Error(
            "Mathematical Grading V1 production release did not preserve its exact V1 schema, " +
            "final flags, card identity, four element scores, Label V1 data, and report/QR authority.",
          );
        }
        manifest.outputs.productionReleasePath = result.productionReleasePath;
        manifest.outputs.labelDataPath = result.labelDataPath;
        manifest.outputs.publicationManifestPath = result.publicationManifestPath;
        manifest.outputs.integrationContractPath = result.integrationContractPath;
        manifest.outputs.mathematicalReleaseChecksumsPath = result.releaseChecksumsPath;
        manifest.outputs.publishPackageDir = result.outputDir;
        manifest.reportBundle = reportPackage.envelope.reportBundle;
        manifest.productionRelease = release;
        manifest.safety.finalGradeComputed = true;
        manifest.safety.labelGenerated = true;
        manifest.safety.qrGenerated = true;
        manifest.progressLog.push(
          new Date().toISOString() + " Mathematical Grading V1 production release validated from the strict V0.3 body with no V0 warning, redistribution, 9.0 cap, manual grade, or scoring fallback.",
        );
        await writeSessionManifest(manifest);
        return release;
      });
    }
    if (!manifest.outputs.reportBundlePath) {
      throw new Error("Production release requires an exported report-bundle.json.");
    }
    return withAiGraderReportPackageOperation(reportId, async () => {
      const reportDir = manifest.outputs.unifiedReportDir ?? dirnameIfFile(manifest.outputs.unifiedReportPath);
      await reconcileAiGraderReportPackageTransaction({
        canonicalDir: publishPackageDir(this.config, reportId),
        reportId,
        gradingSessionId: manifest.sessionId,
        reportDir,
      });
      return this.writeProductionReleaseUnlocked(request, reportId, manifest);
    });
  }

  private async writeProductionReleaseUnlocked(
    request: AiGraderLocalStationBridgeActionRequest,
    reportId: string,
    manifest: AiGraderLocalStationBridgeManifest = this.manifest,
  ): Promise<AiGraderProductionRelease> {
    if (!manifest.outputs.reportBundlePath) {
      throw new Error("Production release requires an exported report-bundle.json.");
    }
    const outputDir = publishPackageDir(this.config, reportId);
    const result = await writeAiGraderProductionRelease({
      reportBundlePath: manifest.outputs.reportBundlePath,
      outputDir,
      operatorId: request.operatorId,
      warningsAccepted: request.warningsAccepted,
      overrideReason: request.overrideReason,
      publicBaseUrl: this.config.publicBasePath?.startsWith("http") ? this.config.publicBasePath : undefined,
      publicBasePath: this.config.publicBasePath,
    });
    if (
      result.productionRelease.reportId !== reportId
      || result.productionRelease.gradingSessionId !== manifest.sessionId
    ) {
      throw new Error("Production release identity did not match the exact station report and grading session.");
    }
    manifest.outputs.productionReleasePath = result.productionReleasePath;
    manifest.outputs.labelDataPath = result.labelDataPath;
    manifest.outputs.publicationManifestPath = result.publicationManifestPath;
    manifest.outputs.integrationContractPath = result.integrationContractPath;
    manifest.outputs.publishPackageDir = result.outputDir;
    manifest.productionRelease = result.productionRelease;
    manifest.safety.finalGradeComputed = result.productionRelease.finalGradeComputed;
    manifest.safety.labelGenerated = result.productionRelease.labelDataGenerated;
    manifest.safety.qrGenerated = result.productionRelease.qrPayloadGenerated;
    manifest.progressLog.push(`${new Date().toISOString()} Production release artifacts written to ${result.outputDir}.`);
    await writeSessionManifest(manifest);
    return result.productionRelease;
  }

  private async reportHistoryItems(): Promise<AiGraderLocalStationReportHistoryItem[]> {
    const items: AiGraderLocalStationReportHistoryItem[] = [];
    if (this.manifest.reportBundle) {
      if (isMathematicalReportBundle(this.manifest.reportBundle)) {
        items.push(historyItemFromMathematicalBundle({
          bundle: this.manifest.reportBundle,
          gradingSessionId: this.manifest.sessionId ?? "",
          productionRelease: isMathematicalProductionRelease(this.manifest.productionRelease)
            ? this.manifest.productionRelease
            : undefined,
          reportBundlePath: this.manifest.outputs.reportBundlePath,
          productionReleasePath: this.manifest.outputs.productionReleasePath,
          sessionDir: this.manifest.outputs.sessionDir,
        }));
      } else {
        items.push(historyItemFromBundle({
          bundle: this.manifest.reportBundle,
          productionRelease: !isMathematicalProductionRelease(this.manifest.productionRelease)
            ? this.manifest.productionRelease
            : undefined,
          reportBundlePath: this.manifest.outputs.reportBundlePath,
          productionReleasePath: this.manifest.outputs.productionReleasePath,
          sessionDir: this.manifest.outputs.sessionDir,
        }));
      }
    } else if (this.manifest.reportId && this.manifest.outputs.unifiedReportPath) {
      try {
        const resolved = await this.reportBundle(this.manifest.reportId);
        if (resolved.gradingContract === "mathematical_calibration_v1") {
          items.push(historyItemFromMathematicalBundle({
            bundle: resolved.bundle,
            gradingSessionId: resolved.gradingSessionId,
            productionRelease: isMathematicalProductionRelease(this.manifest.productionRelease)
              ? this.manifest.productionRelease
              : undefined,
            reportBundlePath: this.manifest.outputs.reportBundlePath,
            productionReleasePath: this.manifest.outputs.productionReleasePath,
            sessionDir: this.manifest.outputs.sessionDir,
          }));
        } else {
          items.push(historyItemFromBundle({
            bundle: resolved.bundle,
            productionRelease: !isMathematicalProductionRelease(this.manifest.productionRelease)
              ? this.manifest.productionRelease
              : undefined,
            reportBundlePath: this.manifest.outputs.reportBundlePath,
            productionReleasePath: this.manifest.outputs.productionReleasePath,
            sessionDir: this.manifest.outputs.sessionDir,
          }));
        }
      } catch {
        items.push({
          reportId: this.manifest.reportId,
          gradingSessionId: this.manifest.sessionId ?? this.manifest.reportId,
          generatedAt: this.manifest.updatedAt,
          status: gradingContractFor(this.manifest) === "mathematical_calibration_v1"
            ? "insufficient_mathematical_v1_evidence"
            : "provisional_diagnostic_ready",
          viewerPath: reportRoute(this.manifest.reportId),
          localHtmlPath: this.manifest.outputs.unifiedReportPath,
          reportBundlePath: this.manifest.outputs.reportBundlePath,
          productionReleasePath: this.manifest.outputs.productionReleasePath,
          sessionDir: this.manifest.outputs.sessionDir,
          frontPackageDir: this.manifest.outputs.frontPackageDir,
          backPackageDir: this.manifest.outputs.backPackageDir,
          warnings: gradingContractFor(this.manifest) === "mathematical_calibration_v1"
            ? [...this.manifest.warnings, "Mathematical Grading V1 is not ready; no historical or manual scoring fallback was used."]
            : this.manifest.warnings,
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
      if (gradingContractFor(stationManifest) === "mathematical_calibration_v1") {
        try {
          const reportPackage = await this.resolveMathematicalReportPackage(stationManifest, {});
          items.push(historyItemFromMathematicalBundle({
            bundle: reportPackage.envelope.reportBundle,
            gradingSessionId: reportPackage.envelope.gradingSessionId,
            productionRelease: isMathematicalProductionRelease(stationManifest.productionRelease)
              ? stationManifest.productionRelease
              : undefined,
            reportBundlePath: reportPackage.bundlePath,
            productionReleasePath: stationManifest.outputs.productionReleasePath,
            sessionDir,
          }));
        } catch {
          items.push({
            reportId: stationManifest.reportId,
            gradingSessionId: stationManifest.sessionId ?? stationManifest.reportId,
            generatedAt: stationManifest.updatedAt,
            status: "insufficient_mathematical_v1_evidence",
            viewerPath: reportRoute(stationManifest.reportId),
            reportBundlePath: stationManifest.outputs.reportBundlePath,
            productionReleasePath: stationManifest.outputs.productionReleasePath,
            sessionDir,
            frontPackageDir: stationManifest.outputs.frontPackageDir,
            backPackageDir: stationManifest.outputs.backPackageDir,
            warnings: [
              ...(stationManifest.warnings ?? []),
              "Mathematical Grading V1 is not ready; historical V0 scoring was not generated as a fallback.",
            ],
          });
        }
        continue;
      }
      const canonicalBundlePath = publishPackagePath(this.config, stationManifest.reportId, "report-bundle.json");
      const canonicalProductionReleasePath = publishPackagePath(this.config, stationManifest.reportId, "production-release.json");
      const canonicalBundle = await readBundleFromPath(canonicalBundlePath);
      const bundleFromManifestPath = await readBundleFromPath(stationManifest.outputs?.reportBundlePath);
      const bundle = canonicalBundle?.reportId === stationManifest.reportId
        ? canonicalBundle
        : bundleFromManifestPath?.reportId === stationManifest.reportId
          ? bundleFromManifestPath
          : undefined;
      const productionRelease = await readProductionReleaseFromPath(canonicalProductionReleasePath)
        ?? await readProductionReleaseFromPath(stationManifest.outputs?.productionReleasePath);
      if (bundle) {
        items.push(historyItemFromBundle({
          bundle,
          productionRelease,
          reportBundlePath: canonicalBundle?.reportId === stationManifest.reportId ? canonicalBundlePath : stationManifest.outputs.reportBundlePath,
          productionReleasePath: productionRelease ? (await exists(canonicalProductionReleasePath) ? canonicalProductionReleasePath : stationManifest.outputs.productionReleasePath) : stationManifest.outputs.productionReleasePath,
          sessionDir,
        }));
        continue;
      }
      const reportDir = stationManifest.outputs?.unifiedReportDir ?? dirnameIfFile(stationManifest.outputs?.unifiedReportPath);
      if (reportDir) {
        try {
          const generated = await buildAiGraderReportBundle({
            reportDir,
            outputDir: publishPackageDir(this.config, stationManifest.reportId),
            reportId: stationManifest.reportId,
            publicBasePath: this.config.publicBasePath,
            captureTiming: this.captureTimingSnapshot(stationManifest),
            geometryCaptureDecisions: this.geometryCaptureDecisionSnapshot(stationManifest),
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

  private requireMathematicalCalibrationCaptureProducer(): FixedRigMathematicalCalibrationCaptureProducerV1 {
    if (!this.mathematicalCalibrationCaptureProducer) {
      throw new Error(
        "Mathematical calibration capture is unavailable until the bridge has an exact protected target path, version, and SHA-256.",
      );
    }
    return this.mathematicalCalibrationCaptureProducer;
  }

  private assertCalibrationSessionIsolated(): void {
    if (this.manifest.sessionId) {
      throw new Error("Mathematical calibration capture requires an isolated bridge with no active card-grading session.");
    }
    if (this.closing || this.frontCaptureTransition || this.captureLock || this.terminalLifecyclePending > 0 || this.lightingLifecyclePending > 0) {
      throw new Error("Mathematical calibration mutation is blocked while another serialized bridge lifecycle is active.");
    }
  }

  startMathematicalCalibrationCapture(
    request: StartFixedRigMathematicalCalibrationCaptureV1Request,
  ): Promise<FixedRigMathematicalCalibrationCaptureSessionStatusV1> {
    this.assertCalibrationSessionIsolated();
    return this.requireMathematicalCalibrationCaptureProducer().start(request);
  }

  mathematicalCalibrationCaptureStatus(sessionId: string): Promise<FixedRigMathematicalCalibrationCaptureSessionStatusV1> {
    return this.requireMathematicalCalibrationCaptureProducer().status(sessionId);
  }

  captureMathematicalCalibrationStep(
    request: CaptureFixedRigMathematicalCalibrationStepV1Request,
  ): Promise<FixedRigMathematicalCalibrationCaptureSessionStatusV1> {
    this.assertCalibrationSessionIsolated();
    assertRealBridgeArmed(this.config);
    return this.serializeTerminalLifecycle(async () => {
      await this.awaitLightingLifecycleIdle();
      await this.stopPreviewForHardwareAction("mathematical calibration");
      const owner = `mathematical-calibration:${request.sessionId}:${request.operationId}`;
      this.acquireCaptureLock(owner);
      let result: FixedRigMathematicalCalibrationCaptureSessionStatusV1 | undefined;
      let operationError: Error | undefined;
      try {
        result = await this.requireMathematicalCalibrationCaptureProducer().captureStep(request);
      } catch (error) {
        operationError = error instanceof Error ? error : new Error("Mathematical calibration capture failed.");
      }
      let safeOff: Awaited<ReturnType<AiGraderLocalStationBridgeService["runTerminalSafeOff"]>>;
      try {
        safeOff = await this.runTerminalSafeOff(`mathematical calibration ${request.operationId} bridge lifecycle end`);
      } finally {
        if (this.captureLock?.owner === owner) this.releaseCaptureLock(owner);
      }
      if (!safeOff.ok) {
        const message = safeOff.directError?.message ?? safeOff.guardedCleanupError?.message ?? "Calibration lifecycle safe-off could not be confirmed.";
        throw new Error(operationError ? `${operationError.message} ${message}` : message);
      }
      if (operationError) throw operationError;
      if (!result) throw new Error("Mathematical calibration capture did not return a durable session status.");
      return result;
    });
  }

  recordMathematicalCalibrationMeasurement(
    request: RecordFixedRigMathematicalCalibrationMeasurementV1Request,
  ): Promise<FixedRigMathematicalCalibrationCaptureSessionStatusV1> {
    this.assertCalibrationSessionIsolated();
    return this.requireMathematicalCalibrationCaptureProducer().recordMeasurement(request);
  }

  sealMathematicalCalibrationCapture(
    request: SealFixedRigMathematicalCalibrationCaptureV1Request,
  ): Promise<SealedFixedRigMathematicalCalibrationCaptureV1> {
    this.assertCalibrationSessionIsolated();
    return this.requireMathematicalCalibrationCaptureProducer().seal(request);
  }

  async action(action: AiGraderLocalStationBridgeAction, request: AiGraderLocalStationBridgeActionRequest = {}): Promise<AiGraderLocalStationBridgeStatus> {
    if (action === "capture-front") {
      this.assertMathematicalCaptureAuthority(this.manifest, "front");
      return this.atomicFrontCapture(request);
    }
    if (action === "capture-back") {
      this.assertMathematicalCaptureAuthority(this.manifest, "back");
      return this.atomicBackCapture(request);
    }
    if (action === "status" || action === "latest-report" || action === "session-manifest") {
      return this.status();
    }
    const terminalAction = action === "cancel-session";
    if (
      this.closing
      || this.frontCaptureTransition
      || this.captureLock
      || this.manifest.previewStatus.intentionalTransition.active
      || this.terminalLifecyclePending > 0
      || (this.lightingLifecyclePending > 0 && !terminalAction)
    ) {
      throw new Error("Station mutation is blocked while another serialized capture/terminal lifecycle owns the bridge.");
    }
    const now = new Date().toISOString();
    this.manifest.updatedAt = now;

    if (action === "configure-rapid-capture") {
      if (typeof request.rapidCaptureEnabled !== "boolean") {
        throw new Error("Rapid Capture configuration requires rapidCaptureEnabled true or false.");
      }
      this.rapidQueue.rapidCaptureEnabled = request.rapidCaptureEnabled;
      this.manifest.rapidCapture.enabled = request.rapidCaptureEnabled;
      this.manifest.progressLog.push(`${now} Rapid Capture ${request.rapidCaptureEnabled ? "enabled" : "disabled"}; Capture Back queues work and Approve & Publish remains the only publication authority.`);
      await writeSessionManifest(this.manifest);
      await this.persistRapidQueue();
      return this.status();
    }

    if (action === "activate-queue-item") {
      await this.activateRapidQueueItem(request.queueItemId ?? "");
      return this.status();
    }

    if (action === "start-session") {
      if (!request.captureProfile) {
        throw new Error("AI Grader start-session requires an explicit captureProfile of full_forensic or production_fast.");
      }
      assertRealBridgeArmed(this.config);
      if (request.gradingContract !== undefined &&
          request.gradingContract !== "legacy_v0" &&
          request.gradingContract !== "mathematical_calibration_v1") {
        throw new Error("AI Grader start-session gradingContract must be legacy_v0 or mathematical_calibration_v1.");
      }
      if (request.gradingContract === "mathematical_calibration_v1") {
        const readiness = mathematicalCalibrationReadiness(
          this.config,
          this.dependencies.loadMathematicalCalibrationBundle ??
            loadFixedRigMathematicalCalibrationBundleV1,
        );
        if (!readiness.ready) {
          throw new Error(`Mathematical Calibration V1 is not ready: ${readiness.reason ?? "finalized calibration evidence is unavailable"}. No V0 fallback is permitted.`);
        }
        if (!request.mathematicalGradingAuthority) {
          throw new Error("Mathematical V1 Start New Card requires exact card and centering/design-reference authority; publication remains bridge-derived.");
        }
      } else if (request.mathematicalGradingAuthority) {
        throw new Error("Legacy V0 Start New Card cannot accept Mathematical V1 grading authority.");
      }
      await this.createFreshSession({
        reportId: request.reportId,
        captureProfile: request.captureProfile,
        gradingContract: request.gradingContract ?? "legacy_v0",
        mathematicalGradingAuthority: request.mathematicalGradingAuthority,
      }, now);
      return this.status();
    }

    if (!this.manifest.sessionId) {
      throw new Error("Start a station session before running AI Grader station actions.");
    }
    if (request.gradingContract && request.gradingContract !== gradingContractFor(this.manifest)) {
      throw new Error("AI Grader action gradingContract must match the contract explicitly selected at Start New Card.");
    }
    if ((request.mathematicalReportEnvelope || request.mathematicalReportPackagePath) &&
        gradingContractFor(this.manifest) !== "mathematical_calibration_v1") {
      throw new Error("Start an explicit mathematical_calibration_v1 session before attaching a strict V0.3 artifact.");
    }

    if (action === "bind-mathematical-grading-authority") {
      if (!request.mathematicalGradingAuthority) {
        throw new Error("Binding Mathematical V1 authority requires one exact mathematicalGradingAuthority.");
      }
      this.bindMathematicalGradingAuthority(this.manifest, request.mathematicalGradingAuthority);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "queue-current-card") {
      await this.queueCurrentRapidCard();
      return this.status();
    }

    if (
      action === "cancel-session"
      && (this.captureLock || this.manifest.previewStatus.intentionalTransition.active)
    ) {
      throw new Error("Terminal station lifecycle actions are blocked while forensic capture owns the serialized lifecycle.");
    }

    if (action === "cancel-session") return this.serializeTerminalLifecycle(async () => {
      await this.awaitLightingLifecycleIdle();
      const safeOff = await this.runTerminalSafeOff("station cancellation");
      this.releaseFullForensicPreviewHold("station cancellation completed");
      let processingError: Error | undefined;
      try {
        await this.cancelWarmProcessingSession(this.manifest.sessionId, "station cancellation");
      } catch (error) {
        processingError = new Error(boundedProcessingWorkerError(error));
        if (!this.manifest.warnings.includes(processingError.message)) this.manifest.warnings.push(processingError.message);
      }
      const cancelledCleanly = safeOff.ok && !processingError;
      if (cancelledCleanly) this.manifest.currentStep = "session_complete";
      this.manifest.warmRunnerStatus.status = cancelledCleanly ? "cancelled" : "failed";
      this.markWarmPhase({
        id: "station_cancelled",
        label: "Station cancellation",
        status: cancelledCleanly ? "cancelled" : "failed",
        backend: this.manifest.executionPath,
        executionPath: this.manifest.executionPath,
        detail: cancelledCleanly
          ? "Cancellation completed with controller-acknowledged safe-off and processing-worker reconciliation."
          : "Cancellation cleanup was incomplete; authoritative physical and processing-worker status remain visible.",
      });
      this.manifest.progressLog.push(`${now} Station session cancelled.`);
      await writeSessionManifest(this.manifest);
      if (!safeOff.ok || processingError) {
        const safeOffMessage = safeOff.ok
          ? undefined
          : safeOff.directError?.message ?? safeOff.guardedCleanupError?.message ?? "Station cancellation safe-off could not be confirmed.";
        throw new Error([safeOffMessage, processingError?.message].filter(Boolean).join(" "));
      }
      return this.status();
    });

    assertRealReady(this.config, this.manifest);

    if (action === "submit-mathematical-finding-reviews") {
      if (gradingContractFor(this.manifest) !== "mathematical_calibration_v1") {
        throw new Error("Finding-review submission is available only for an explicit Mathematical V1 session.");
      }
      const reviews = this.validatedMathematicalFindingReviews(
        this.manifest,
        request.mathematicalReviewRequestSha256,
        request.mathematicalFindingReviews,
      );
      const execution = await this.runMathematicalStationPackage(this.manifest, reviews);
      if (this.activeQueueItemId) {
        if (execution.status === "completed") {
          const release = await this.writeProductionReleaseForManifest(this.manifest, {
            operatorId: request.operatorId ?? "rapid-reviewed-background-preparation",
            warningsAccepted: request.warningsAccepted,
            overrideReason: request.overrideReason,
          });
          if (
            release.reportId !== this.manifest.reportId ||
            release.gradingSessionId !== this.manifest.sessionId ||
            release.finalGradeComputed !== true ||
            release.labelDataGenerated !== true ||
            release.qrPayloadGenerated !== true ||
            release.label.status !== "label_data_ready" ||
            !this.manifest.outputs.productionReleasePath ||
            !this.manifest.outputs.labelDataPath
          ) {
            throw new Error("Reviewed Mathematical Rapid item did not produce the exact strict release and Label V1 data.");
          }
          this.manifest.currentStep = "label_data_ready";
          this.transitionRapidWorkflow(
            this.manifest,
            "report_ready_needs_confirm",
            "Explicit finding reviews were accepted; strict Mathematical V1 release and Label V1 data await Approve & Publish.",
          );
        } else if (execution.status === "finding_review_required") {
          this.transitionRapidWorkflow(
            this.manifest,
            "finding_review_required",
            "Submitted reviews did not satisfy the exact request; no finding was auto-confirmed.",
          );
        } else if (execution.status === "insufficient_evidence") {
          this.transitionRapidWorkflow(
            this.manifest,
            "insufficient_evidence",
            "Reviewed Mathematical V1 rerun stopped fail-closed at " + execution.failedStage + ".",
          );
        }
        await this.syncQueuedManifest(this.manifest);
      }
      return this.status();
    }

    if (action === "run-diagnostics") {
      if (gradingContractFor(this.manifest) === "mathematical_calibration_v1") {
        await this.runMathematicalStationPackage(this.manifest);
        return this.status();
      }
      const result = await this.runWarmReport();
      this.manifest.outputs.unifiedReportDir = result.payload?.report?.packageDir ?? dirnameIfFile(extractUnifiedReportPath(result.payload));
      this.manifest.outputs.unifiedReportPath = extractUnifiedReportPath(result.payload);
      this.manifest.currentStep = "view_unified_report";
      this.manifest.progressLog.push(`${now} Unified diagnostics generated from the single serialized capture path.`);
      await writeSessionManifest(this.manifest);
      return this.status();
    }

    if (action === "export-report-bundle") {
      if (gradingContractFor(this.manifest) === "mathematical_calibration_v1") {
        const reportId = this.manifest.reportId;
        if (!reportId) throw new Error("Mathematical Grading V1 export requires an exact report ID.");
        const reportPackage = await withAiGraderReportPackageOperation(reportId, () =>
          this.resolveMathematicalReportPackage(this.manifest, request)
        );
        this.applyMathematicalReportPackage(this.manifest, reportPackage);
        this.manifest.progressLog.push(
          now + " Strict Mathematical Grading V1 V0.3 body, external grading-session envelope, immutable assets, and checksums exported without overwrite.",
        );
        await writeSessionManifest(this.manifest);
        return this.status();
      }
      const reportDir = this.manifest.outputs.unifiedReportDir ?? dirnameIfFile(this.manifest.outputs.unifiedReportPath);
      if (!reportDir) throw new Error("Report bundle export requires a generated unified report folder.");
      const reportId = this.manifest.reportId ?? "local-report";
      const outputDir = publishPackageDir(this.config, reportId);
      const bundle = await withAiGraderReportPackageOperation(reportId, async () => {
        await reconcileAiGraderReportPackageTransaction({
          canonicalDir: outputDir,
          reportId,
          gradingSessionId: this.manifest.sessionId,
          reportDir,
        });
        return writeAiGraderReportBundle({
          reportDir,
          outputDir,
          reportId,
          gradingSessionId: this.manifest.sessionId,
          publicBasePath: this.config.publicBasePath,
          captureTiming: this.captureTimingSnapshot(this.manifest),
          geometryCaptureDecisions: this.geometryCaptureDecisionSnapshot(this.manifest),
        });
      });
      this.manifest.outputs.reportBundlePath = bundle.bundlePath;
      this.manifest.outputs.publishPackageDir = bundle.outputDir;
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
      if (this.activeQueueItemId && action === "publish-report") {
        this.transitionRapidWorkflow(this.manifest, "published", "Approve & Publish completed for this queued report.");
        await this.syncQueuedManifest(this.manifest);
      }
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
    "capture-front",
    "capture-back",
    "run-diagnostics",
    "export-report-bundle",
    "calculate-final-grade",
    "finalize-report",
    "publish-report",
    "generate-label-data",
    "cancel-session",
    "latest-report",
    "session-manifest",
    "configure-rapid-capture",
    "queue-current-card",
    "activate-queue-item",
    "bind-mathematical-grading-authority",
    "submit-mathematical-finding-reviews",
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
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type,x-ai-grader-station-token,x-ai-grader-session-id,x-ai-grader-preview-side,x-ai-grader-preview-epoch,x-ai-grader-side,x-ai-grader-reference-id,x-ai-grader-sha256"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "x-ai-grader-session-id,x-ai-grader-preview-side,x-ai-grader-preview-epoch,x-ai-grader-frame-id,x-ai-grader-reference-id,x-ai-grader-sha256,x-ai-grader-asset-id,x-ai-grader-side,x-ai-grader-evidence-role"
  );
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

function sendBinary(
  res: http.ServerResponse,
  statusCode: number,
  body: Buffer,
  origin: string | undefined,
  config: AiGraderLocalStationBridgeConfig,
  contentType = "application/octet-stream",
  extraHeaders: Record<string, string> = {}
) {
  setCors(res, origin, config);
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
    ...extraHeaders,
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

function exactRequestHeader(req: http.IncomingMessage, name: string): string {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value) || typeof value !== "string" || value.trim().length === 0) {
    throw new Error(name + " must be supplied exactly once.");
  }
  return value.trim();
}

async function readExactBoundedBinaryBody(
  req: http.IncomingMessage,
  maximumBytes: number,
): Promise<{ bytes: Buffer; declaredByteSize: number }> {
  const contentLength = exactRequestHeader(req, "Content-Length");
  if (!/^[0-9]+$/.test(contentLength)) {
    throw new Error("Design-reference Content-Length must be one exact decimal integer.");
  }
  const declaredByteSize = Number(contentLength);
  if (!Number.isSafeInteger(declaredByteSize) || declaredByteSize < 24 ||
      declaredByteSize > maximumBytes) {
    throw new Error(
      "Design-reference Content-Length must be from 24 through " + maximumBytes + " bytes.",
    );
  }
  const chunks: Buffer[] = [];
  let observed = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    observed += bytes.byteLength;
    if (observed > declaredByteSize || observed > maximumBytes) {
      throw new Error("Design-reference body exceeded its exact bounded Content-Length.");
    }
    chunks.push(bytes);
  }
  if (observed !== declaredByteSize) {
    throw new Error("Design-reference body length did not match Content-Length.");
  }
  return { bytes: Buffer.concat(chunks), declaredByteSize };
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
  warmRunner?: AiGraderWarmForensicRunner,
  dependencies: AiGraderLocalStationBridgeDependencies = {}
): http.Server {
  const config = buildAiGraderLocalStationBridgeConfig(input, env);
  const service = new AiGraderLocalStationBridgeService(
    config,
    runner,
    warmRunner ?? createDefaultWarmForensicRunner(config),
    dependencies,
  );
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
          reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
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

      if (url.pathname === "/lighting/heartbeat") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for /lighting/heartbeat." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const body = await readJsonBody(req);
        const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "browser live lighting heartbeat";
        return sendJson(res, 200, { ok: true, operation: "lighting-heartbeat", result: await service.heartbeatLiveLighting(reason) }, origin, config);
      }

      const designReferenceStageMatch = url.pathname.match(
        /^\/mathematical-v1\/design-reference-artifacts\/(front|back)$/,
      );
      if (designReferenceStageMatch) {
        if (req.method !== "POST") {
          return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for Mathematical design-reference staging." }, origin, config);
        }
        if (!tokenMatches(req, config)) {
          return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        }
        if (url.search.length > 0) {
          throw new Error("Design-reference staging does not accept caller path or query parameters.");
        }
        const side = designReferenceStageMatch[1] as "front" | "back";
        if (exactRequestHeader(req, "X-AI-Grader-Side") !== side) {
          throw new Error("Design-reference path and X-AI-Grader-Side must match exactly.");
        }
        const contentType = exactRequestHeader(req, "Content-Type").toLowerCase();
        if (contentType !== "image/png" && contentType !== "image/jpeg") {
          throw new Error("Design-reference Content-Type must be exactly image/png or image/jpeg.");
        }
        const stageHeaders = {
          sessionId: exactRequestHeader(req, "X-AI-Grader-Session-Id"),
          side,
          referenceId: exactRequestHeader(req, "X-AI-Grader-Reference-Id"),
          sha256: exactRequestHeader(req, "X-AI-Grader-SHA256").toLowerCase(),
          contentType,
        };
        service.assertMathematicalDesignReferenceStageRequest(stageHeaders);
        const body = await readExactBoundedBinaryBody(
          req,
          MATHEMATICAL_DESIGN_REFERENCE_MAX_BYTES,
        );
        const staged = await service.stageMathematicalDesignReference({
          ...stageHeaders,
          declaredByteSize: body.declaredByteSize,
          bytes: body.bytes,
        });
        return sendJson(res, 201, {
          ok: true,
          operation: "mathematical-design-reference-stage",
          result: {
            side: staged.side,
            referenceId: staged.referenceId,
            assetId: staged.assetId,
            sha256: staged.sha256,
            byteSize: staged.byteSize,
            contentType: staged.contentType,
            stagedAt: staged.stagedAt,
            createNew: true,
          },
        }, origin, config);
      }

      if (url.pathname === "/calibration/mathematical-v1/status") {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for the calibration status route." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const sessionId = url.searchParams.get("sessionId") ?? "";
        return sendJson(res, 200, { ok: true, operation: "mathematical-calibration-status", result: await service.mathematicalCalibrationCaptureStatus(sessionId) }, origin, config);
      }

      if (url.pathname === "/calibration/mathematical-v1/start") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for calibration start." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const body = await readJsonBody(req);
        return sendJson(res, 200, { ok: true, operation: "mathematical-calibration-start", result: await service.startMathematicalCalibrationCapture(body as unknown as StartFixedRigMathematicalCalibrationCaptureV1Request) }, origin, config);
      }

      if (url.pathname === "/calibration/mathematical-v1/capture") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for calibration capture." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const body = await readJsonBody(req);
        return sendJson(res, 200, { ok: true, operation: "mathematical-calibration-capture", result: await service.captureMathematicalCalibrationStep(body as unknown as CaptureFixedRigMathematicalCalibrationStepV1Request) }, origin, config);
      }

      if (url.pathname === "/calibration/mathematical-v1/measurement") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for calibration measurement." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const body = await readJsonBody(req);
        return sendJson(res, 200, { ok: true, operation: "mathematical-calibration-measurement", result: await service.recordMathematicalCalibrationMeasurement(body as unknown as RecordFixedRigMathematicalCalibrationMeasurementV1Request) }, origin, config);
      }

      if (url.pathname === "/calibration/mathematical-v1/seal") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST is required for calibration seal." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const body = await readJsonBody(req);
        return sendJson(res, 200, { ok: true, operation: "mathematical-calibration-seal", result: await service.sealMathematicalCalibrationCapture(body as unknown as SealFixedRigMathematicalCalibrationCaptureV1Request) }, origin, config);
      }

      if (url.pathname === "/mathematical-v1/review-assets") {
        if (req.method !== "GET") {
          return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for pending Mathematical review assets." }, origin, config);
        }
        if (!tokenMatches(req, config)) {
          return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        }
        const reportId = url.searchParams.get("reportId") ?? "";
        const assetId = url.searchParams.get("assetId") ?? "";
        if (url.searchParams.size !== 2 || !reportId || !assetId) {
          throw new Error("Pending Mathematical review asset requires only exact reportId and assetId parameters.");
        }
        const asset = await service.mathematicalReviewAsset(reportId, assetId);
        return sendBinary(
          res,
          200,
          asset.bytes,
          origin,
          config,
          asset.contentType,
          {
            "X-AI-Grader-Asset-Id": asset.id,
            "X-AI-Grader-SHA256": asset.sha256,
            "X-AI-Grader-Side": asset.side,
            "X-AI-Grader-Evidence-Role": asset.evidenceRole,
            "X-AI-Grader-Width-Px": String(asset.widthPx),
            "X-AI-Grader-Height-Px": String(asset.heightPx),
          },
        );
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

      const reportAssetMatch = url.pathname.match(/^\/reports\/([^/]+)\/asset$/);
      if (reportAssetMatch) {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for report assets." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const reportId = decodeURIComponent(reportAssetMatch[1]);
        const assetId = url.searchParams.get("assetId") ?? "";
        if (!assetId.trim()) throw new Error("assetId is required.");
        const asset = await service.reportAsset(reportId, assetId);
        return sendBinary(
          res,
          200,
          asset.bytes,
          origin,
          config,
          asset.contentType,
          {
            "X-AI-Grader-Asset-Id": asset.id,
            "X-AI-Grader-SHA256": asset.sha256,
          }
        );
      }

      const reportHtmlMatch = url.pathname.match(/^\/reports\/([^/]+)\/html$/);
      if (reportHtmlMatch) {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "GET is required for report HTML." }, origin, config);
        if (!tokenMatches(req, config)) return sendJson(res, 401, { ok: false, code: "AI_GRADER_STATION_BRIDGE_UNAUTHORIZED", message: "Station token is required." }, origin, config);
        const reportId = decodeURIComponent(reportHtmlMatch[1]);
        const resolved = await service.reportBundle(reportId);
        if (resolved.gradingContract === "mathematical_calibration_v1") {
          throw new Error("Mathematical Grading V1 is rendered from its strict V0.3 report body and does not expose legacy generated HTML.");
        }
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
  let shutdownPromise: Promise<void> | undefined;
  const beginShutdown = () => shutdownPromise ??= service.shutdown("local bridge server closing");
  const originalClose = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    let resolveServerClose!: (error?: Error) => void;
    const serverClosed = new Promise<Error | undefined>((resolve) => {
      resolveServerClose = resolve;
    });
    const result = originalClose((error?: Error) => resolveServerClose(error));
    const cleanup = beginShutdown();
    void serverClosed.then(async (serverError) => {
      let cleanupError: Error | undefined;
      try {
        await cleanup;
      } catch (error) {
        cleanupError = error instanceof Error ? error : new Error("Local bridge shutdown cleanup failed.");
      }
      callback?.(serverError ?? cleanupError);
    });
    return result;
  }) as typeof server.close;
  return server;
}

function singleHeader(req: http.IncomingMessage, name: string) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export async function startAiGraderLocalStationBridgeHttpServer(
  input: AiGraderLocalStationBridgeConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
  runner: AiGraderStationCommandRunner = createAiGraderStationCliRunner(),
  warmRunner?: AiGraderWarmForensicRunner,
  dependencies: AiGraderLocalStationBridgeDependencies = {}
): Promise<StartedAiGraderLocalStationBridge> {
  const config = buildAiGraderLocalStationBridgeConfig(input, env);
  const server = createAiGraderLocalStationBridgeHttpServer(config, env, runner, warmRunner, dependencies);
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
