import crypto from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} from "@tenkings/shared";
import type {
  BuildFastCalibrationAnalysisV1_2Input,
  FastCalibrationAnalysisV1_2,
  FastCalibrationSourceCapturePackageV1_2,
} from "./fixedRigFastMathematicalCalibrationBundleV1_2";
import type {
  FastCalibrationEvidenceAnalysisResultV1_2,
  FastCalibrationEvidenceAnalyzerV1_2,
} from "./fixedRigFastCalibrationEvidenceAnalyzerV1_2";
import {
  stageFastCalibrationFinalizerHandoffV1_2,
  verifyFastCalibrationFinalizerHandoffV1_2,
} from "./fixedRigFastMathematicalCalibrationFinalizerHandoffV1_2";
import type {
  BuildFixedRigPhysicalCalibrationV1Input,
  FixedRigCalibrationChannelInputV1,
} from "./fixedRigPhysicalCalibrationV1";

export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT = "1.2.0" as const;
export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA =
  "ten-kings-mathematical-calibration-capture-session-v1.2" as const;
export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PACKAGE_SCHEMA =
  "ten-kings-mathematical-calibration-capture-package-v1.2" as const;
export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PROFILE =
  "ten-kings-fixed-rig-mathematical-calibration-v1.2" as const;
export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA =
  "ten-kings-mathematical-calibration-runtime-context-v1.2" as const;
export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_AUTHORITY_SCHEMA =
  "ten-kings-mathematical-rig-characterization-v1.2" as const;
export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_SCHEMA =
  "ten-kings-mathematical-rig-characterization-source-v1.2" as const;
export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_SCHEMA =
  "ten-kings-mathematical-calibration-analysis-v1.2" as const;

export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS = Object.freeze({
  checkerboardPlacements: 4,
  darkControlFrames: 24,
  flatFieldFrames: 24,
  illuminationPatternFrames: 24,
  totalImageCaptures: 76,
  quickPhysicalMeasurements: 0,
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MINIMUM_TARGET_COVERAGE = 0.30;
const MINIMUM_SAFETY_MARGIN = 0.01;
const MINIMUM_X_SPAN = 0.07;
const MINIMUM_Y_SPAN = 0.08;
const MINIMUM_ROTATION_SPAN_DEGREES = 2;

type JsonObject = Record<string, unknown>;

export interface FastCalibrationChannelWiringV1_2 {
  channelIndex: number;
  controllerOutput: string;
  componentId: string;
  physicalDirectionId: string;
}

export interface FastCalibrationRuntimeContextV1_2 {
  schemaVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA;
  stationId: string;
  rigId: string;
  camera: {
    serialNumber: string;
    modelName: string;
    lensAuthorityId: string;
    exposureUs: number;
    gain: number;
    pixelFormat: string;
    widthPx: number;
    heightPx: number;
  };
  controller: {
    identity: string;
    unit: number;
    channelWiring: FastCalibrationChannelWiringV1_2[];
  };
  dutyPercent: number;
  target: { version: string; sha256: string };
  componentConfigurationId: string;
  algorithmHashes: {
    geometry: string;
    photometric: string;
    finalizer: string;
    thresholdManifest: string;
  };
  locationLabel: string;
  lightingConfigurationId: string;
}

export type FastCalibrationRigSourceMemberRoleV1_2 =
  | "target_metrology"
  | "camera_lens"
  | "physical_light_directions"
  | "component_identities"
  | "repeatability";

export interface FastCalibrationRigSourceBundleMemberV1_2 {
  role: FastCalibrationRigSourceMemberRoleV1_2;
  fileName: string;
  sha256: string;
}

export interface FastCalibrationRigCharacterizationSourceV1_2 {
  bundleBytes: Buffer;
  members: Array<{ fileName: string; bytes: Buffer }>;
}

export interface FastCalibrationRigSourceBundleV1_2 {
  schemaVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_SCHEMA;
  characterizedAt: string;
  rigId: string;
  sourceCaptureManifestSha256: string;
  sourceEvidenceManifestSha256: string;
  members: FastCalibrationRigSourceBundleMemberV1_2[];
}

export interface FastCalibrationTargetMetrologyAuthorityMemberV1_2 {
  schemaVersion: "ten-kings-target-metrology-authority-v1";
  rigId: string;
  targetVersion: string;
  targetSha256: string;
  scaleSamples: BuildFixedRigPhysicalCalibrationV1Input["scaleSamples"];
  targetPrintScaleSamples: BuildFixedRigPhysicalCalibrationV1Input["targetPrintScaleSamples"];
  targetCutDimensionSamples: BuildFixedRigPhysicalCalibrationV1Input["targetCutDimensionSamples"];
  targetEvidence: BuildFixedRigPhysicalCalibrationV1Input["targetEvidence"];
}

export interface FastCalibrationCameraLensAuthorityMemberV1_2 {
  schemaVersion: "ten-kings-camera-lens-authority-v1";
  rigId: string;
  cameraSerialNumber: string;
  cameraModelName: string;
  lensAuthorityId: string;
  normalizedWidthPx: number;
  normalizedHeightPx: number;
  lensResidualSamples: BuildFixedRigPhysicalCalibrationV1Input["lensResidualSamples"];
  lensModel: BuildFixedRigPhysicalCalibrationV1Input["lensModel"];
  normalizationModel: BuildFixedRigPhysicalCalibrationV1Input["normalizationModel"];
}

export type FastCalibrationPhysicalDirectionsAuthorityMemberV1_2 = {
  schemaVersion: "ten-kings-physical-light-directions-authority-v1";
  rigId: string;
  channels: Array<Pick<FixedRigCalibrationChannelInputV1, "channelIndex" | "directionMeasurementSamples">>;
} & (
  | {
      coordinateFrame: "canonical_normalized_target_v1";
      authorityMethod: "evidence_derived_normalized_illumination_direction_v1";
    }
  | {
      stageToUndistortedSensorMatrix: readonly [number, number, number, number];
    }
);

export interface FastCalibrationComponentIdentitiesAuthorityMemberV1_2 {
  schemaVersion: "ten-kings-component-identities-authority-v1";
  rigId: string;
  controllerIdentity: string;
  componentConfigurationId: string;
  channelWiring: FastCalibrationChannelWiringV1_2[];
  algorithmHashes: FastCalibrationRuntimeContextV1_2["algorithmHashes"];
}

export interface FastCalibrationRepeatabilityAuthorityMemberV1_2 {
  schemaVersion: "ten-kings-repeatability-authority-v1";
  rigId: string;
  repeatedPlacementSamples: BuildFixedRigPhysicalCalibrationV1Input["repeatedPlacementSamples"];
  measurementRepeatabilitySamples: BuildFixedRigPhysicalCalibrationV1Input["measurementRepeatabilitySamples"];
}

export interface VerifiedFastCalibrationRigCharacterizationSourceV1_2 {
  authority: FastCalibrationRigCharacterizationAuthorityV1_2;
  directionCoordinateAuthority:
    | { coordinateFrame: "canonical_normalized_target_v1" }
    | {
        coordinateFrame: "measured_stage_v1";
        stageToUndistortedSensorMatrix: readonly [number, number, number, number];
      };
  oneTimeBuilderInput: Pick<BuildFixedRigPhysicalCalibrationV1Input,
    | "rigId" | "normalizedWidthPx" | "normalizedHeightPx" | "scaleSamples"
    | "targetPrintScaleSamples" | "targetCutDimensionSamples" | "lensResidualSamples"
    | "repeatedPlacementSamples" | "measurementRepeatabilitySamples" | "targetEvidence"
    | "targetVersion" | "targetSha256" | "lensModel" | "normalizationModel"> & {
      channels: Array<Pick<FixedRigCalibrationChannelInputV1, "channelIndex" | "directionMeasurementSamples">>;
    };
}

export interface FastCalibrationRigCharacterizationAuthorityV1_2 {
  schemaVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_AUTHORITY_SCHEMA;
  characterizedAt: string;
  rigId: string;
  sourceBundleManifestSha256: string;
  sourceCaptureManifestSha256: string;
  sourceEvidenceManifestSha256: string;
  sourceMemberLedgerSha256: string;
  targetMetrologyAuthoritySha256: string;
  cameraLensAuthoritySha256: string;
  physicalLightDirectionAuthoritySha256: string;
  componentIdentityAuthoritySha256: string;
  repeatabilityAuthoritySha256: string;
  oneTimeCalibrationInputSha256: string;
  cameraSerialNumber: string;
  cameraModelName: string;
  lensAuthorityId: string;
  controllerIdentity: string;
  channelWiring: FastCalibrationChannelWiringV1_2[];
  targetVersion: string;
  targetSha256: string;
  componentConfigurationId: string;
  algorithmHashes: FastCalibrationRuntimeContextV1_2["algorithmHashes"];
}

export interface FastCalibrationPoseV1_2 {
  sourceFrameSha256: string;
  centerXFraction: number;
  centerYFraction: number;
  coverageFraction: number;
  rotationDegrees: number;
  safetyMarginFraction: number;
  authorityReprojectionResidualPx: number;
  outerCorners: readonly [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
}

export type FastCalibrationPhotometricRoleV1_2 =
  | "dark_control"
  | "flat_field"
  | "illumination_pattern";

export interface FastCalibrationControllerAcknowledgementV1_2 {
  controllerIdentity: string;
  expectedWriteCount: number;
  acknowledgedWriteCount: number;
  responseKinds: string[];
  complete: boolean;
}

export interface FastCalibrationCaptureMetadataV1_2 {
  capturedAt: string;
  camera: FastCalibrationRuntimeContextV1_2["camera"];
  controller: FastCalibrationControllerAcknowledgementV1_2;
  safeOffBeforeConfirmed: boolean;
  safeOffAfterConfirmed: boolean;
}

export interface FastCalibrationCapturedFrameV1_2 {
  bytes: Buffer;
  mediaType: "image/png" | "image/tiff";
  metadata: FastCalibrationCaptureMetadataV1_2;
}

export interface FastCalibrationPersistentBatchControllerV1_2 {
  open(expectedContext: FastCalibrationRuntimeContextV1_2): Promise<FastCalibrationRuntimeContextV1_2>;
  capture(input: {
    operationId: string;
    role: FastCalibrationPhotometricRoleV1_2;
    channelIndex: number;
    sampleIndex: number;
    dutyPercent: number;
  }): Promise<FastCalibrationCapturedFrameV1_2>;
  safeOff(): Promise<{
    controllerIdentity: string;
    confirmed: boolean;
    responseKinds: string[];
  }>;
  close(): Promise<void>;
}

interface FastCalibrationEvidenceV1_2 {
  evidenceId: string;
  relativePath: string;
  sha256: string;
  byteSize: number;
  mediaType: "image/png" | "image/tiff" | "application/json";
}

interface FastCalibrationSessionIdentityV1_2 {
  schemaVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA;
  contractVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT;
  sessionId: string;
  operatorId: string;
  createdAt: string;
  runtimeContext: FastCalibrationRuntimeContextV1_2;
  runtimeContextSha256: string;
  rigCharacterization: FastCalibrationRigCharacterizationAuthorityV1_2;
  rigCharacterizationSha256: string;
  rigCharacterizationSource: {
    bundle: FastCalibrationEvidenceV1_2;
    members: Array<FastCalibrationEvidenceV1_2 & { fileName: string }>;
  };
  oneTimeCalibrationInputSha256: string;
  noProductionMutation: true;
  v0FallbackAllowed: false;
}

type FastCalibrationCaptureRoleV1_2 = "checkerboard_placement" | FastCalibrationPhotometricRoleV1_2;

interface FastCalibrationEventBaseV1_2 {
  sequence: number;
  operationId: string;
  recordedAt: string;
  previousEventSha256: string | null;
  eventSha256: string;
}

interface FastCalibrationAcceptedEventV1_2 extends FastCalibrationEventBaseV1_2 {
  type: "capture_accepted";
  role: FastCalibrationCaptureRoleV1_2;
  slot: number;
  channelIndex: number | null;
  sampleIndex: number;
  evidence: FastCalibrationEvidenceV1_2;
  metadata: FastCalibrationCaptureMetadataV1_2;
  pose?: FastCalibrationPoseV1_2;
  supersedesOperationId?: string;
}

interface FastCalibrationFailedEventV1_2 extends FastCalibrationEventBaseV1_2 {
  type: "capture_failed" | "analysis_failed" | "finalization_failed" | "batch_open_failed" | "batch_safe_off_failed" | "batch_close_failed";
  role: FastCalibrationCaptureRoleV1_2 | "analysis" | "finalization" | "batch_open" | "safe_off" | "batch_close";
  slot: number | null;
  channelIndex: number | null;
  sampleIndex: number | null;
  error: string;
  evidence?: FastCalibrationEvidenceV1_2;
}

interface FastCalibrationFlipEventV1_2 extends FastCalibrationEventBaseV1_2 {
  type: "blank_reverse_flip_confirmed";
  flipCount: 1;
}

interface FastCalibrationAnalysisEventV1_2 extends FastCalibrationEventBaseV1_2 {
  type: "analysis_completed";
  evidence: FastCalibrationEvidenceV1_2;
  analysisSha256: string;
  sourceArtifactLedgerSha256: string;
  sourceManifestSha256: string;
  accepted: true;
}

interface FastCalibrationFinalizationEventV1_2 extends FastCalibrationEventBaseV1_2 {
  type: "finalization_completed";
  bundle: FastCalibrationEvidenceV1_2;
  memberLedgerSha256: string;
  memberCount: 12;
  analysisSha256: string;
  sourceArtifactLedgerSha256: string;
  bundleSha256: string;
  captureContractVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT;
  runtimeContextSha256: string;
  rigCharacterizationSha256: string;
  members: Array<FastCalibrationEvidenceV1_2 & { fileName: string }>;
}
interface FastCalibrationBatchCleanupEventV1_2 extends FastCalibrationEventBaseV1_2 {
  type: "batch_cleanup_completed";
  controllerIdentity: string;
  safeOffResponseKinds: string[];
  closed: true;
}


type FastCalibrationEventV1_2 =
  | FastCalibrationAcceptedEventV1_2
  | FastCalibrationFailedEventV1_2
  | FastCalibrationFlipEventV1_2
  | FastCalibrationAnalysisEventV1_2
  | FastCalibrationFinalizationEventV1_2
  | FastCalibrationBatchCleanupEventV1_2;

export type FastCalibrationPhaseV1_2 =
  | "checkerboard_placements"
  | "blank_reverse_flip"
  | "photometric_sweep"
  | "analyze"
  | "finalize"
  | "ready_for_explicit_activation";

export type FastCalibrationNextActionV1_2 =
  | { action: "capture_checkerboard"; role: "checkerboard_placement"; slot: number; channelIndex: null; sampleIndex: number }
  | { action: "confirm_blank_reverse_flip"; role: "blank_reverse_flip"; slot: null; channelIndex: null; sampleIndex: null }
  | { action: "capture_photometric"; role: FastCalibrationPhotometricRoleV1_2; slot: number; channelIndex: number; sampleIndex: number }
  | { action: "analyze"; role: "analysis"; slot: null; channelIndex: null; sampleIndex: null }
  | { action: "complete_batch_cleanup"; role: "safe_off"; slot: null; channelIndex: null; sampleIndex: null }
  | { action: "finalize"; role: "finalization"; slot: null; channelIndex: null; sampleIndex: null }
  | { action: "activate_explicitly"; role: "activation"; slot: null; channelIndex: null; sampleIndex: null };

export interface FastCalibrationStatusV1_2 {
  sessionId: string;
  contractVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT;
  phase: FastCalibrationPhaseV1_2;
  nextAction: FastCalibrationNextActionV1_2;
  captureCounts: {
    acceptedCheckerboardPlacements: number;
    acceptedPhotometricFrames: number;
    totalAcceptedImages: number;
    requiredTotalImages: 76;
  };
  acceptedPlacementSlots: number[];
  failedOperationCount: number;
  supersededOperationCount: number;
  aggregatePoseSpans: { x: number; y: number; rotationDegrees: number };
  runtimeContextSha256: string;
  rigCharacterizationSha256: string;
  eventCount: number;
  lastEventSha256: string | null;
}

export interface FastCalibrationAuditProjectionV1_2 {
  revisionSha256: string;
  acceptedPoses: Array<{
    operationId: string;
    slot: number;
    evidenceSha256: string;
    byteSize: number;
    acceptedRevision: string;
    supersedesOperationId: string | null;
    supersededByOperationId: string | null;
    active: boolean;
    pose: FastCalibrationPoseV1_2;
  }>;
  failedAttempts: Array<{
    operationId: string;
    recordedRevision: string;
    action: FastCalibrationNextActionV1_2["action"];
    slot: number | null;
    channelIndex: number | null;
    sampleIndex: number | null;
    issue: string;
  }>;
  blankReverseFlipCount: 0 | 1;
  automaticSweep: {
    darkAccepted: number;
    flatFieldAccepted: number;
    illuminationPatternAccepted: number;
    batchCleanupConfirmed: boolean;
  };
  analysis: {
    state: "not_started" | "failed" | "accepted";
    analysisSha256: string | null;
    sourceManifestSha256: string | null;
    sourceArtifactLedgerSha256: string | null;
    issues: string[];
  };
  finalization: {
    state: "not_started" | "failed" | "completed";
    bundleSha256: string | null;
    memberLedgerSha256: string | null;
    analysisSha256: string | null;
    sourceArtifactLedgerSha256: string | null;
    memberCount: 0 | 12;
    issues: string[];
  };
}

export class FastCalibrationOperationErrorV1_2 extends Error {
  constructor(public readonly operationId: string, message: string) {
    super(message);
    this.name = "FastCalibrationOperationErrorV1_2";
  }
}

export interface OpenFastCalibrationSessionV1_2Input {
  sessionId: string;
  operatorId: string;
  runtimeContext: FastCalibrationRuntimeContextV1_2;
  rigCharacterizationSource?: FastCalibrationRigCharacterizationSourceV1_2;
  resume?: boolean;
}

export interface FastCalibrationCoreV1_2Config {
  outputRoot: string;
  now?: () => Date;
  operationId?: () => string;
  evidenceAnalyzer?: FastCalibrationEvidenceAnalyzerV1_2;
  finalizerStagingRoot?: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
}

export function hashFastCalibrationCanonicalV1_2(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalBytes(value)).digest("hex");
}

export function projectFastCalibrationOneTimeInputV1_2(
  input: VerifiedFastCalibrationRigCharacterizationSourceV1_2["oneTimeBuilderInput"] | BuildFixedRigPhysicalCalibrationV1Input,
): unknown {
  return {
    rigId: input.rigId,
    targetVersion: input.targetVersion,
    normalizedWidthPx: input.normalizedWidthPx,
    normalizedHeightPx: input.normalizedHeightPx,
    targetSha256: input.targetSha256,
    scaleSamples: input.scaleSamples,
    targetPrintScaleSamples: input.targetPrintScaleSamples,
    targetCutDimensionSamples: input.targetCutDimensionSamples,
    lensResidualSamples: input.lensResidualSamples,
    repeatedPlacementSamples: input.repeatedPlacementSamples,
    measurementRepeatabilitySamples: input.measurementRepeatabilitySamples,
    lensModel: input.lensModel,
    normalizationModel: { model: input.normalizationModel.model },
    targetEvidence: input.targetEvidence,
    channels: input.channels.map((channel) => ({
      channelIndex: channel.channelIndex,
      directionMeasurementSamples: channel.directionMeasurementSamples,
    })),
  };
}

function hashBytes(value: Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${label} must be an exact safe identifier.`);
  return value;
}

function exactSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be an exact lowercase SHA-256.`);
  return value;
}

function exactKeys(value: unknown, expected: readonly string[], label: string): asserts value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be one exact object.`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${label} fields do not match the exact V1.2 contract.`);
  }
}

function exactIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be one exact UTC ISO timestamp.`);
  }
  return value;
}

function finiteRange(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} through ${maximum}.`);
  }
  return value;
}

function finite(value: unknown, label: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    throw new Error(`${label} must be a finite number${minimum === undefined ? "" : ` >= ${minimum}`}.`);
  }
  return value;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return hashFastCalibrationCanonicalV1_2(left) === hashFastCalibrationCanonicalV1_2(right);
}

function validateChannelWiring(value: FastCalibrationChannelWiringV1_2[], label: string): void {
  if (!Array.isArray(value) || value.length !== 8) throw new Error(`${label} must bind exactly eight channels.`);
  const channels = new Set<number>();
  const outputs = new Set<string>();
  for (const item of value) {
    exactKeys(item, ["channelIndex", "controllerOutput", "componentId", "physicalDirectionId"], `${label} entry`);
    if (!Number.isInteger(item.channelIndex) || item.channelIndex < 1 || item.channelIndex > 8 || channels.has(item.channelIndex)) {
      throw new Error(`${label} channelIndex must contain unique channels 1 through 8.`);
    }
    channels.add(item.channelIndex);
    const output = exactId(item.controllerOutput, `${label}.controllerOutput`);
    if (outputs.has(output)) throw new Error(`${label} controller outputs must be unique.`);
    outputs.add(output);
    exactId(item.componentId, `${label}.componentId`);
    exactId(item.physicalDirectionId, `${label}.physicalDirectionId`);
  }
  if (value.some((item, index) => item.channelIndex !== index + 1)) {
    throw new Error(`${label} must use canonical channel order 1 through 8.`);
  }
}

export function validateFastCalibrationRuntimeContextV1_2(value: FastCalibrationRuntimeContextV1_2): void {
  exactKeys(value, [
    "schemaVersion", "stationId", "rigId", "camera", "controller", "dutyPercent", "target",
    "componentConfigurationId", "algorithmHashes", "locationLabel", "lightingConfigurationId",
  ], "runtimeContext");
  if (value?.schemaVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA) {
    throw new Error("Fast calibration runtime context schema mismatch.");
  }
  exactId(value.stationId, "runtimeContext.stationId");
  exactId(value.rigId, "runtimeContext.rigId");
  exactKeys(value.camera, [
    "serialNumber", "modelName", "lensAuthorityId", "exposureUs", "gain", "pixelFormat", "widthPx", "heightPx",
  ], "runtimeContext.camera");
  exactId(value.camera.serialNumber, "runtimeContext.camera.serialNumber");
  exactId(value.camera.modelName, "runtimeContext.camera.modelName");
  exactId(value.camera.lensAuthorityId, "runtimeContext.camera.lensAuthorityId");
  finiteRange(value.camera.exposureUs, "runtimeContext.camera.exposureUs", 1, 10_000_000);
  finiteRange(value.camera.gain, "runtimeContext.camera.gain", 0, 100);
  exactId(value.camera.pixelFormat, "runtimeContext.camera.pixelFormat");
  if (!Number.isInteger(value.camera.widthPx) || value.camera.widthPx < 64 || value.camera.widthPx > 100_000 ||
      !Number.isInteger(value.camera.heightPx) || value.camera.heightPx < 64 || value.camera.heightPx > 100_000) {
    throw new Error("Fast calibration camera resolution must contain bounded positive integer dimensions.");
  }
  exactKeys(value.controller, ["identity", "unit", "channelWiring"], "runtimeContext.controller");
  exactId(value.controller.identity, "runtimeContext.controller.identity");
  if (!Number.isInteger(value.controller.unit) || value.controller.unit < 1 || value.controller.unit > 255) {
    throw new Error("Fast calibration controller unit must be an integer from 1 through 255.");
  }
  validateChannelWiring(value.controller.channelWiring, "runtimeContext.controller.channelWiring");
  finiteRange(value.dutyPercent, "runtimeContext.dutyPercent", Number.EPSILON, 100);
  exactKeys(value.target, ["version", "sha256"], "runtimeContext.target");
  exactId(value.target.version, "runtimeContext.target.version");
  exactSha(value.target.sha256, "runtimeContext.target.sha256");
  exactId(value.componentConfigurationId, "runtimeContext.componentConfigurationId");
  exactKeys(value.algorithmHashes, ["geometry", "photometric", "finalizer", "thresholdManifest"], "runtimeContext.algorithmHashes");
  for (const [name, digest] of Object.entries(value.algorithmHashes)) exactSha(digest, `runtimeContext.algorithmHashes.${name}`);
  exactId(value.locationLabel, "runtimeContext.locationLabel");
  exactId(value.lightingConfigurationId, "runtimeContext.lightingConfigurationId");
}

function parseCanonicalJson<T>(bytes: Buffer, label: string): T {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error(`${label} bytes are empty.`);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!bytes.equals(canonicalBytes(value))) throw new Error(`${label} bytes are not exact canonical JSON.`);
  return value as T;
}

const RIG_SOURCE_MEMBERS: ReadonlyArray<{ role: FastCalibrationRigSourceMemberRoleV1_2; fileName: string }> = [
  { role: "target_metrology", fileName: "target-metrology-authority-v1.json" },
  { role: "camera_lens", fileName: "camera-lens-authority-v1.json" },
  { role: "physical_light_directions", fileName: "physical-light-directions-authority-v1.json" },
  { role: "component_identities", fileName: "component-identities-authority-v1.json" },
  { role: "repeatability", fileName: "repeatability-authority-v1.json" },
];

export function verifyFastCalibrationRigCharacterizationSourceV1_2(
  source: FastCalibrationRigCharacterizationSourceV1_2,
  context: FastCalibrationRuntimeContextV1_2,
): VerifiedFastCalibrationRigCharacterizationSourceV1_2 {
  validateFastCalibrationRuntimeContextV1_2(context);
  const bundle = parseCanonicalJson<FastCalibrationRigSourceBundleV1_2>(source.bundleBytes, "rigCharacterizationSource.bundle");
  exactKeys(bundle, ["schemaVersion", "characterizedAt", "rigId", "sourceCaptureManifestSha256", "sourceEvidenceManifestSha256", "members"], "rigCharacterizationSource.bundle");
  if (bundle.schemaVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_SCHEMA) {
    throw new Error("Rig-characterization source bundle schema mismatch.");
  }
  exactIsoTimestamp(bundle.characterizedAt, "rigCharacterizationSource.characterizedAt");
  exactId(bundle.rigId, "rigCharacterizationSource.rigId");
  exactSha(bundle.sourceCaptureManifestSha256, "rigCharacterizationSource.sourceCaptureManifestSha256");
  exactSha(bundle.sourceEvidenceManifestSha256, "rigCharacterizationSource.sourceEvidenceManifestSha256");
  if (!Array.isArray(bundle.members) || bundle.members.length !== RIG_SOURCE_MEMBERS.length ||
      bundle.members.some((member, index) => {
        exactKeys(member, ["role", "fileName", "sha256"], "rigCharacterizationSource.bundle member");
        return member.role !== RIG_SOURCE_MEMBERS[index].role || member.fileName !== RIG_SOURCE_MEMBERS[index].fileName ||
          exactSha(member.sha256, "rigCharacterizationSource.bundle member sha256") !== member.sha256;
      })) {
    throw new Error("Rig-characterization source bundle must contain the exact five ordered authority members.");
  }
  if (!Array.isArray(source.members) || source.members.length !== RIG_SOURCE_MEMBERS.length) {
    throw new Error("Rig-characterization source must provide exactly five member byte payloads.");
  }
  const supplied = new Map<string, Buffer>();
  for (const member of source.members) {
    if (!member || typeof member.fileName !== "string" || !Buffer.isBuffer(member.bytes) || supplied.has(member.fileName)) {
      throw new Error("Rig-characterization source member payloads must have unique exact file names and bytes.");
    }
    supplied.set(member.fileName, member.bytes);
  }
  const memberBytes = RIG_SOURCE_MEMBERS.map(({ fileName }, index) => {
    const bytes = supplied.get(fileName);
    if (!bytes || hashBytes(bytes) !== bundle.members[index].sha256) {
      throw new Error(`Rig-characterization source member ${fileName} is missing or corrupt.`);
    }
    return bytes;
  });
  const target = parseCanonicalJson<FastCalibrationTargetMetrologyAuthorityMemberV1_2>(memberBytes[0], "target metrology authority");
  exactKeys(target, ["schemaVersion", "rigId", "targetVersion", "targetSha256", "scaleSamples", "targetPrintScaleSamples", "targetCutDimensionSamples", "targetEvidence"], "target metrology authority");
  const camera = parseCanonicalJson<FastCalibrationCameraLensAuthorityMemberV1_2>(memberBytes[1], "camera/lens authority");
  exactKeys(camera, ["schemaVersion", "rigId", "cameraSerialNumber", "cameraModelName", "lensAuthorityId", "normalizedWidthPx", "normalizedHeightPx", "lensResidualSamples", "lensModel", "normalizationModel"], "camera/lens authority");
  const directions = parseCanonicalJson<FastCalibrationPhysicalDirectionsAuthorityMemberV1_2>(memberBytes[2], "physical direction authority");
  if ("coordinateFrame" in directions && directions.coordinateFrame === "canonical_normalized_target_v1") {
    exactKeys(directions, ["schemaVersion", "rigId", "coordinateFrame", "authorityMethod", "channels"], "physical direction authority");
    if (directions.authorityMethod !== "evidence_derived_normalized_illumination_direction_v1") {
      throw new Error("Canonical target-frame direction authority method mismatch.");
    }
  } else {
    exactKeys(directions, ["schemaVersion", "rigId", "stageToUndistortedSensorMatrix", "channels"], "physical direction authority");
  }
  const components = parseCanonicalJson<FastCalibrationComponentIdentitiesAuthorityMemberV1_2>(memberBytes[3], "component identity authority");
  exactKeys(components, ["schemaVersion", "rigId", "controllerIdentity", "componentConfigurationId", "channelWiring", "algorithmHashes"], "component identity authority");
  const repeatability = parseCanonicalJson<FastCalibrationRepeatabilityAuthorityMemberV1_2>(memberBytes[4], "repeatability authority");
  exactKeys(repeatability, ["schemaVersion", "rigId", "repeatedPlacementSamples", "measurementRepeatabilitySamples"], "repeatability authority");
  if (
    target.schemaVersion !== "ten-kings-target-metrology-authority-v1" ||
    camera.schemaVersion !== "ten-kings-camera-lens-authority-v1" ||
    directions.schemaVersion !== "ten-kings-physical-light-directions-authority-v1" ||
    components.schemaVersion !== "ten-kings-component-identities-authority-v1" ||
    repeatability.schemaVersion !== "ten-kings-repeatability-authority-v1" ||
    [target.rigId, camera.rigId, directions.rigId, components.rigId, repeatability.rigId].some((rigId) => rigId !== bundle.rigId)
  ) {
    throw new Error("Rig-characterization member schema or rig identity mismatch.");
  }
  if (!Array.isArray(target.scaleSamples) || !Array.isArray(target.targetPrintScaleSamples) ||
      !Array.isArray(target.targetCutDimensionSamples) || !Array.isArray(target.targetEvidence) ||
      !Array.isArray(camera.lensResidualSamples) || !Array.isArray(directions.channels) ||
      !Array.isArray(repeatability.repeatedPlacementSamples) || !Array.isArray(repeatability.measurementRepeatabilitySamples)) {
    throw new Error("Rig-characterization source members do not contain reconstructable one-time inputs.");
  }
  if (!("coordinateFrame" in directions) &&
      (!Array.isArray(directions.stageToUndistortedSensorMatrix) || directions.stageToUndistortedSensorMatrix.length !== 4 ||
        directions.stageToUndistortedSensorMatrix.some((value) => !Number.isFinite(value)) ||
        Math.abs(directions.stageToUndistortedSensorMatrix[0] * directions.stageToUndistortedSensorMatrix[3] -
          directions.stageToUndistortedSensorMatrix[1] * directions.stageToUndistortedSensorMatrix[2]) < 1e-12)) {
    throw new Error("Legacy measured-stage direction authority requires one finite non-singular transform.");
  }
  if (directions.channels.length !== 8 || directions.channels.some((channel, index) => {
    exactKeys(channel, ["channelIndex", "directionMeasurementSamples"], "physical direction authority channel");
    return channel.channelIndex !== index + 1 || !Array.isArray(channel.directionMeasurementSamples);
  })) {
    throw new Error("Physical direction authority must contain exact channels 1 through 8.");
  }
  validateChannelWiring(components.channelWiring, "component identity authority channelWiring");
  exactKeys(components.algorithmHashes, ["geometry", "photometric", "finalizer", "thresholdManifest"], "component identity authority algorithmHashes");
  Object.entries(components.algorithmHashes).forEach(([name, digest]) => exactSha(digest, `component identity authority algorithmHashes.${name}`));
  finiteRange(camera.normalizedWidthPx, "camera/lens normalizedWidthPx", 64, 100_000);
  finiteRange(camera.normalizedHeightPx, "camera/lens normalizedHeightPx", 64, 100_000);
  exactId(target.targetVersion, "target metrology targetVersion");
  exactSha(target.targetSha256, "target metrology targetSha256");
  const oneTimeBuilderInput: VerifiedFastCalibrationRigCharacterizationSourceV1_2["oneTimeBuilderInput"] = {
    rigId: bundle.rigId,
    normalizedWidthPx: camera.normalizedWidthPx,
    normalizedHeightPx: camera.normalizedHeightPx,
    scaleSamples: target.scaleSamples,
    targetPrintScaleSamples: target.targetPrintScaleSamples,
    targetCutDimensionSamples: target.targetCutDimensionSamples,
    lensResidualSamples: camera.lensResidualSamples,
    repeatedPlacementSamples: repeatability.repeatedPlacementSamples,
    measurementRepeatabilitySamples: repeatability.measurementRepeatabilitySamples,
    targetEvidence: target.targetEvidence,
    targetVersion: target.targetVersion,
    targetSha256: target.targetSha256,
    lensModel: camera.lensModel,
    normalizationModel: camera.normalizationModel,
    channels: directions.channels,
  };
  const authority: FastCalibrationRigCharacterizationAuthorityV1_2 = {
    schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_AUTHORITY_SCHEMA,
    characterizedAt: bundle.characterizedAt,
    rigId: bundle.rigId,
    sourceBundleManifestSha256: hashBytes(source.bundleBytes),
    sourceCaptureManifestSha256: bundle.sourceCaptureManifestSha256,
    sourceEvidenceManifestSha256: bundle.sourceEvidenceManifestSha256,
    sourceMemberLedgerSha256: hashFastCalibrationCanonicalV1_2(bundle.members),
    targetMetrologyAuthoritySha256: bundle.members[0].sha256,
    cameraLensAuthoritySha256: bundle.members[1].sha256,
    physicalLightDirectionAuthoritySha256: bundle.members[2].sha256,
    componentIdentityAuthoritySha256: bundle.members[3].sha256,
    repeatabilityAuthoritySha256: bundle.members[4].sha256,
    oneTimeCalibrationInputSha256: hashFastCalibrationCanonicalV1_2(projectFastCalibrationOneTimeInputV1_2(oneTimeBuilderInput)),
    cameraSerialNumber: camera.cameraSerialNumber,
    cameraModelName: camera.cameraModelName,
    lensAuthorityId: camera.lensAuthorityId,
    controllerIdentity: components.controllerIdentity,
    channelWiring: components.channelWiring,
    targetVersion: target.targetVersion,
    targetSha256: target.targetSha256,
    componentConfigurationId: components.componentConfigurationId,
    algorithmHashes: components.algorithmHashes,
  };
  validateFastCalibrationRigCharacterizationV1_2(authority, context);
  return {
    authority,
    oneTimeBuilderInput,
    directionCoordinateAuthority: "coordinateFrame" in directions && directions.coordinateFrame === "canonical_normalized_target_v1"
      ? { coordinateFrame: "canonical_normalized_target_v1" }
      : {
          coordinateFrame: "measured_stage_v1",
          stageToUndistortedSensorMatrix: [...(directions as FastCalibrationPhysicalDirectionsAuthorityMemberV1_2 & {
            stageToUndistortedSensorMatrix: readonly [number, number, number, number];
          }).stageToUndistortedSensorMatrix] as [number, number, number, number],
        },
  };
}

export function validateFastCalibrationRigCharacterizationV1_2(
  authority: FastCalibrationRigCharacterizationAuthorityV1_2,
  context: FastCalibrationRuntimeContextV1_2,
): void {
  if (authority?.schemaVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_AUTHORITY_SCHEMA) {
    throw new Error("Fast calibration rig-characterization schema mismatch.");
  }
  exactKeys(authority, [
    "schemaVersion", "characterizedAt", "rigId", "sourceBundleManifestSha256", "sourceCaptureManifestSha256",
    "sourceEvidenceManifestSha256", "sourceMemberLedgerSha256", "targetMetrologyAuthoritySha256", "cameraLensAuthoritySha256",
    "physicalLightDirectionAuthoritySha256", "componentIdentityAuthoritySha256", "repeatabilityAuthoritySha256",
    "oneTimeCalibrationInputSha256", "cameraSerialNumber", "cameraModelName", "lensAuthorityId",
    "controllerIdentity", "channelWiring", "targetVersion", "targetSha256", "componentConfigurationId",
    "algorithmHashes",
  ], "rigCharacterization");
  exactIsoTimestamp(authority.characterizedAt, "rigCharacterization.characterizedAt");
  exactId(authority.rigId, "rigCharacterization.rigId");
  for (const [name, digest] of Object.entries(authority).filter(([key]) => key.endsWith("Sha256"))) {
    exactSha(digest, `rigCharacterization.${name}`);
  }
  validateChannelWiring(authority.channelWiring, "rigCharacterization.channelWiring");
  exactKeys(authority.algorithmHashes, ["geometry", "photometric", "finalizer", "thresholdManifest"], "rigCharacterization.algorithmHashes");
  Object.entries(authority.algorithmHashes).forEach(([name, digest]) => exactSha(digest, `rigCharacterization.algorithmHashes.${name}`));
  if (
    authority.rigId !== context.rigId ||
    authority.cameraSerialNumber !== context.camera.serialNumber ||
    authority.cameraModelName !== context.camera.modelName ||
    authority.lensAuthorityId !== context.camera.lensAuthorityId ||
    authority.controllerIdentity !== context.controller.identity ||
    authority.targetVersion !== context.target.version ||
    authority.targetSha256 !== context.target.sha256 ||
    authority.componentConfigurationId !== context.componentConfigurationId ||
    !sameCanonical(authority.channelWiring, context.controller.channelWiring) ||
    !sameCanonical(authority.algorithmHashes, context.algorithmHashes)
  ) {
    throw new Error("Fast calibration runtime context does not exactly match immutable rig characterization.");
  }
}

export function assertFastCalibrationRuntimeContextMatchV1_2(
  expected: FastCalibrationRuntimeContextV1_2,
  live: FastCalibrationRuntimeContextV1_2,
): void {
  validateFastCalibrationRuntimeContextV1_2(live);
  if (!sameCanonical(expected, live)) {
    throw new Error("Live camera, rig, controller, wiring, settings, target, component, algorithm, location, or lighting context differs from the active calibration.");
  }
}

function photometricPlan(): Array<{
  role: FastCalibrationPhotometricRoleV1_2;
  slot: number;
  channelIndex: number;
  sampleIndex: number;
}> {
  const plan: Array<{ role: FastCalibrationPhotometricRoleV1_2; slot: number; channelIndex: number; sampleIndex: number }> = [];
  let slot = 1;
  for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
    for (const role of ["dark_control", "flat_field", "illumination_pattern"] as const) {
      for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
        plan.push({ role, slot, channelIndex, sampleIndex });
        slot += 1;
      }
    }
  }
  return plan;
}

const PHOTOMETRIC_PLAN = photometricPlan();

function acceptedEvents(events: FastCalibrationEventV1_2[]): FastCalibrationAcceptedEventV1_2[] {
  return events.filter((event): event is FastCalibrationAcceptedEventV1_2 => event.type === "capture_accepted");
}

function activePlacements(events: FastCalibrationEventV1_2[]): Map<number, FastCalibrationAcceptedEventV1_2> {
  const active = new Map<number, FastCalibrationAcceptedEventV1_2>();
  for (const event of acceptedEvents(events)) {
    if (event.role === "checkerboard_placement") active.set(event.slot, event);
  }
  return active;
}

function acceptedPhotometricKeys(events: FastCalibrationEventV1_2[]): Set<string> {
  return new Set(acceptedEvents(events)
    .filter((event) => event.role !== "checkerboard_placement")
    .map((event) => `${event.role}:${event.channelIndex}:${event.sampleIndex}`));
}

function poseSpans(poses: FastCalibrationPoseV1_2[]): { x: number; y: number; rotationDegrees: number } {
  if (poses.length === 0) return { x: 0, y: 0, rotationDegrees: 0 };
  return {
    x: Math.max(...poses.map((pose) => pose.centerXFraction)) - Math.min(...poses.map((pose) => pose.centerXFraction)),
    y: Math.max(...poses.map((pose) => pose.centerYFraction)) - Math.min(...poses.map((pose) => pose.centerYFraction)),
    rotationDegrees: Math.max(...poses.map((pose) => pose.rotationDegrees)) - Math.min(...poses.map((pose) => pose.rotationDegrees)),
  };
}

function poseGeometryReasons(
  pose: FastCalibrationPoseV1_2,
  frameSha256: string,
  context: FastCalibrationRuntimeContextV1_2,
): string[] {
  const reasons: string[] = [];
  try {
    exactKeys(pose, [
      "sourceFrameSha256", "centerXFraction", "centerYFraction", "coverageFraction", "rotationDegrees",
      "safetyMarginFraction", "authorityReprojectionResidualPx", "outerCorners",
    ], "capture-time pose");
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
    return reasons;
  }
  if (pose.sourceFrameSha256 !== frameSha256) reasons.push("pose validation is not bound to the exact capture-time still");
  const ranges: Array<[string, unknown, number, number]> = [
    ["centerXFraction", pose.centerXFraction, Number.EPSILON, 1 - Number.EPSILON],
    ["centerYFraction", pose.centerYFraction, Number.EPSILON, 1 - Number.EPSILON],
    ["coverageFraction", pose.coverageFraction, MINIMUM_TARGET_COVERAGE, 0.95],
    ["rotationDegrees", pose.rotationDegrees, -180, 180],
    ["safetyMarginFraction", pose.safetyMarginFraction, MINIMUM_SAFETY_MARGIN, 0.49],
    ["authorityReprojectionResidualPx", pose.authorityReprojectionResidualPx, 0, 0.5],
  ];
  for (const [name, value, minimum, maximum] of ranges) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
      reasons.push(`${name} is outside the exact safe range ${minimum} through ${maximum}`);
    }
  }
  if (!Array.isArray(pose.outerCorners) || pose.outerCorners.length !== 4) {
    reasons.push("outer target contour must contain exactly four corners");
    return reasons;
  }
  const width = context.camera.widthPx;
  const height = context.camera.heightPx;
  const points = pose.outerCorners;
  const unique = new Set<string>();
  for (const point of points) {
    try {
      exactKeys(point, ["x", "y"], "capture-time outer corner");
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const coordinate = point as { x: number; y: number };
    if (!Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y) ||
        coordinate.x <= 0 || coordinate.x >= width - 1 || coordinate.y <= 0 || coordinate.y >= height - 1) {
      reasons.push("every outer target corner must be positive and strictly inside the exact source frame");
    }
    unique.add(`${coordinate.x}:${coordinate.y}`);
  }
  if (unique.size !== 4) reasons.push("outer target corners must be four distinct points");
  const signedAreaTwice = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  const areaFraction = Math.abs(signedAreaTwice) / 2 / (width * height);
  if (!Number.isFinite(areaFraction) || areaFraction <= 0 ||
      Math.abs(areaFraction - pose.coverageFraction) > 0.02) {
    reasons.push("declared coverage is not consistent with the bounded four-corner polygon");
  }
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length / width;
  const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length / height;
  if (Math.abs(centerX - pose.centerXFraction) > 0.02 || Math.abs(centerY - pose.centerYFraction) > 0.02) {
    reasons.push("declared pose center is not consistent with the bounded four-corner polygon");
  }
  const observedMargin = Math.min(...points.flatMap((point) => [
    point.x / width, (width - point.x) / width, point.y / height, (height - point.y) / height,
  ]));
  if (Math.abs(observedMargin - pose.safetyMarginFraction) > 0.02) {
    reasons.push("declared safety margin is not consistent with the bounded four-corner polygon");
  }
  return [...new Set(reasons)];
}

export function validateFastCalibrationPoseV1_2(
  pose: FastCalibrationPoseV1_2,
  frameSha256: string,
  context: FastCalibrationRuntimeContextV1_2,
): void {
  const reasons = poseGeometryReasons(pose, frameSha256, context);
  if (reasons.length > 0) throw new Error(`Fast calibration pose failed: ${reasons.join("; ")}.`);
}

function validatePose(
  pose: FastCalibrationPoseV1_2,
  frameSha256: string,
  context: FastCalibrationRuntimeContextV1_2,
  prior: FastCalibrationPoseV1_2[],
  finalSet: FastCalibrationPoseV1_2[],
): string[] {
  const reasons = poseGeometryReasons(pose, frameSha256, context);
  if (prior.some((item) =>
    Math.abs(item.centerXFraction - pose.centerXFraction) < 0.005 &&
    Math.abs(item.centerYFraction - pose.centerYFraction) < 0.005 &&
    Math.abs(item.rotationDegrees - pose.rotationDegrees) < 2)) {
    reasons.push("pose is not sufficiently distinct from an accepted placement");
  }
  if (finalSet.length === 4) {
    const spans = poseSpans(finalSet);
    if (spans.x < MINIMUM_X_SPAN || spans.y < MINIMUM_Y_SPAN || spans.rotationDegrees < MINIMUM_ROTATION_SPAN_DEGREES) {
      reasons.push("complete four-pose aggregate diversity does not meet unchanged X, Y, and rotation minima");
    }
  }
  return reasons;
}

function assertCaptureMetadata(
  metadata: FastCalibrationCaptureMetadataV1_2,
  context: FastCalibrationRuntimeContextV1_2,
): void {
  if (!sameCanonical(metadata.camera, context.camera)) throw new Error("Capture-time camera identity/settings differ from the session runtime context.");
  const acknowledgement = metadata.controller;
  if (
    acknowledgement.controllerIdentity !== context.controller.identity ||
    !Number.isInteger(acknowledgement.expectedWriteCount) || acknowledgement.expectedWriteCount < 1 ||
    acknowledgement.acknowledgedWriteCount !== acknowledgement.expectedWriteCount ||
    acknowledgement.complete !== true || acknowledgement.responseKinds.length !== acknowledgement.expectedWriteCount ||
    acknowledgement.responseKinds.some((kind) => kind !== "ack")
  ) {
    throw new Error("Capture-time controller identity or exact acknowledgements are incomplete.");
  }
  if (!metadata.safeOffBeforeConfirmed || !metadata.safeOffAfterConfirmed) {
    throw new Error("Capture-time safe-off was not exactly confirmed before and after the frame.");
  }
}

async function persistIdentityEvidence(
  sessionDir: string,
  prefix: string,
  bytes: Buffer,
): Promise<FastCalibrationEvidenceV1_2> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("Rig-characterization source evidence bytes are empty.");
  const sha256 = hashBytes(bytes);
  const relativePath = `evidence/${prefix}-${sha256}.json`;
  const filePath = path.join(sessionDir, ...relativePath.split("/"));
  try {
    await writeFile(filePath, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (hashBytes(await readFile(filePath)) !== sha256) throw new Error("Stored rig-characterization source evidence is corrupt.");
  }
  return {
    evidenceId: `${prefix}-${sha256.slice(0, 16)}`,
    relativePath,
    sha256,
    byteSize: bytes.length,
    mediaType: "application/json",
  };
}

async function readIdentityEvidence(sessionDir: string, evidence: FastCalibrationEvidenceV1_2): Promise<Buffer> {
  if (evidence.mediaType !== "application/json" || !evidence.relativePath.startsWith("evidence/") ||
      evidence.relativePath.includes("..") || evidence.relativePath.includes("\\")) {
    throw new Error("Stored rig-characterization source evidence path or media type is unsafe.");
  }
  const bytes = await readFile(path.join(sessionDir, ...evidence.relativePath.split("/")));
  if (bytes.length !== evidence.byteSize || hashBytes(bytes) !== evidence.sha256) {
    throw new Error("Stored rig-characterization source evidence is missing or corrupt.");
  }
  return bytes;
}

export class FixedRigFastMathematicalCalibrationCoreV1_2 {
  private constructor(
    private readonly config: FastCalibrationCoreV1_2Config,
    private readonly sessionDir: string,
    private readonly identity: FastCalibrationSessionIdentityV1_2,
    private events: FastCalibrationEventV1_2[],
  ) {}

  static async listStored(
    config: FastCalibrationCoreV1_2Config,
  ): Promise<FixedRigFastMathematicalCalibrationCoreV1_2[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(path.resolve(config.outputRoot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const sessions: FixedRigFastMathematicalCalibrationCoreV1_2[] = [];
    for (const name of [...entries].sort()) {
      const identityPath = path.join(path.resolve(config.outputRoot), name, "session-identity.json");
      let bytes: Buffer;
      try {
        bytes = await readFile(identityPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const stored = parseCanonicalJson<FastCalibrationSessionIdentityV1_2>(bytes, "stored fast calibration session identity");
      sessions.push(await FixedRigFastMathematicalCalibrationCoreV1_2.open(config, {
        sessionId: stored.sessionId,
        operatorId: stored.operatorId,
        runtimeContext: stored.runtimeContext,
        resume: true,
      }));
    }
    return sessions;
  }

  static async open(
    config: FastCalibrationCoreV1_2Config,
    input: OpenFastCalibrationSessionV1_2Input,
  ): Promise<FixedRigFastMathematicalCalibrationCoreV1_2> {
    if (config.finalizerStagingRoot !== undefined && !path.isAbsolute(config.finalizerStagingRoot)) {
      throw new Error("Fast calibration finalizer staging root must be one protected absolute path.");
    }
    const sessionId = exactId(input.sessionId, "sessionId");
    const operatorId = exactId(input.operatorId, "operatorId");
    validateFastCalibrationRuntimeContextV1_2(input.runtimeContext);
    const outputRoot = path.resolve(config.outputRoot);
    const sessionDir = path.join(outputRoot, sessionId.replace(/:/g, "-"));
    const identityPath = path.join(sessionDir, "session-identity.json");
    let identityBytes: Buffer | undefined;
    try {
      identityBytes = await readFile(identityPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let identity: FastCalibrationSessionIdentityV1_2;
    if (identityBytes) {
      identity = parseCanonicalJson<FastCalibrationSessionIdentityV1_2>(
        identityBytes,
        "fast calibration session identity",
      );
      exactKeys(identity, [
        "schemaVersion", "contractVersion", "sessionId", "operatorId", "createdAt", "runtimeContext",
        "runtimeContextSha256", "rigCharacterization", "rigCharacterizationSha256",
        "rigCharacterizationSource", "oneTimeCalibrationInputSha256", "noProductionMutation",
        "v0FallbackAllowed",
      ], "fast calibration session identity");
      exactKeys(identity.rigCharacterizationSource, ["bundle", "members"], "session rig-characterization source");
      exactKeys(identity.rigCharacterizationSource.bundle, [
        "evidenceId", "relativePath", "sha256", "byteSize", "mediaType",
      ], "session rig-characterization bundle checkpoint");
      if (!Array.isArray(identity.rigCharacterizationSource.members) ||
          identity.rigCharacterizationSource.members.length !== RIG_SOURCE_MEMBERS.length) {
        throw new Error("Session rig-characterization source member checkpoint list is incomplete.");
      }
      identity.rigCharacterizationSource.members.forEach((member) => exactKeys(member, [
        "evidenceId", "relativePath", "sha256", "byteSize", "mediaType", "fileName",
      ], "session rig-characterization member checkpoint"));
      if (identity.contractVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT ||
          identity.noProductionMutation !== true || identity.v0FallbackAllowed !== false) {
        throw new Error("Fast calibration session identity contract or no-fallback authority is invalid.");
      }
      exactIsoTimestamp(identity.createdAt, "session identity createdAt");
      exactSha(identity.runtimeContextSha256, "session identity runtimeContextSha256");
      exactSha(identity.rigCharacterizationSha256, "session identity rigCharacterizationSha256");
      exactSha(identity.oneTimeCalibrationInputSha256, "session identity oneTimeCalibrationInputSha256");
      if (!input.resume) throw new Error("Fast calibration session already exists; explicit resume is required.");
      validateFastCalibrationRigCharacterizationV1_2(identity.rigCharacterization, input.runtimeContext);
      const storedSource: FastCalibrationRigCharacterizationSourceV1_2 = {
        bundleBytes: await readIdentityEvidence(sessionDir, identity.rigCharacterizationSource.bundle),
        members: await Promise.all(identity.rigCharacterizationSource.members.map(async (member) => ({
          fileName: member.fileName,
          bytes: await readIdentityEvidence(sessionDir, member),
        }))),
      };
      const verifiedStored = verifyFastCalibrationRigCharacterizationSourceV1_2(storedSource, input.runtimeContext);
      const suppliedSource = input.rigCharacterizationSource
        ? verifyFastCalibrationRigCharacterizationSourceV1_2(input.rigCharacterizationSource, input.runtimeContext)
        : undefined;
      if (
        identity.schemaVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA ||
        identity.sessionId !== sessionId || identity.operatorId !== operatorId ||
        identity.runtimeContextSha256 !== hashFastCalibrationCanonicalV1_2(input.runtimeContext) ||
        identity.rigCharacterizationSha256 !== hashFastCalibrationCanonicalV1_2(verifiedStored.authority) ||
        identity.oneTimeCalibrationInputSha256 !== verifiedStored.authority.oneTimeCalibrationInputSha256 ||
        !sameCanonical(identity.runtimeContext, input.runtimeContext) ||
        !sameCanonical(identity.rigCharacterization, verifiedStored.authority) ||
        (suppliedSource !== undefined && !sameCanonical(suppliedSource.authority, verifiedStored.authority))
      ) {
        throw new Error("Fast calibration resume identity, immutable rig authority, or runtime context mismatch.");
      }
    } else {
      if (input.resume) throw new Error("Fast calibration session does not exist and cannot be resumed.");
      if (!input.rigCharacterizationSource) {
        throw new Error("A new fast calibration session requires exact local one-time rig-characterization bundle and member bytes.");
      }
      const verified = verifyFastCalibrationRigCharacterizationSourceV1_2(
        input.rigCharacterizationSource,
        input.runtimeContext,
      );
      await mkdir(path.join(sessionDir, "events"), { recursive: true });
      await mkdir(path.join(sessionDir, "evidence"), { recursive: true });
      const bundleEvidence = await persistIdentityEvidence(
        sessionDir,
        "rig-source-bundle",
        input.rigCharacterizationSource.bundleBytes,
      );
      const memberEvidence = await Promise.all(input.rigCharacterizationSource.members.map(async (member) => ({
        ...(await persistIdentityEvidence(
          sessionDir,
          `rig-source-member-${member.fileName.replace(/[^A-Za-z0-9.-]/g, "-")}`,
          member.bytes,
        )),
        fileName: member.fileName,
      })));
      const createdAt = (config.now?.() ?? new Date()).toISOString();
      identity = {
        schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA,
        contractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
        sessionId,
        operatorId,
        createdAt,
        runtimeContext: input.runtimeContext,
        runtimeContextSha256: hashFastCalibrationCanonicalV1_2(input.runtimeContext),
        rigCharacterization: verified.authority,
        rigCharacterizationSha256: hashFastCalibrationCanonicalV1_2(verified.authority),
        rigCharacterizationSource: {
          bundle: bundleEvidence,
          members: memberEvidence,
        },
        oneTimeCalibrationInputSha256: verified.authority.oneTimeCalibrationInputSha256,
        noProductionMutation: true,
        v0FallbackAllowed: false,
      };
      await writeFile(identityPath, canonicalBytes(identity), { flag: "wx" });
    }
    const core = new FixedRigFastMathematicalCalibrationCoreV1_2(config, sessionDir, identity, []);
    core.events = await core.loadEvents();
    return core;
  }

  private async loadEvents(): Promise<FastCalibrationEventV1_2[]> {
    let names: string[] = [];
    try {
      names = (await readdir(path.join(this.sessionDir, "events")))
        .filter((name) => /^\d{8}\.json$/.test(name)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const events: FastCalibrationEventV1_2[] = [];
    let previous: string | null = hashFastCalibrationCanonicalV1_2(this.identity);
    const operationIds = new Set<string>();
    for (const [index, name] of names.entries()) {
      const event = JSON.parse((await readFile(path.join(this.sessionDir, "events", name))).toString("utf8")) as FastCalibrationEventV1_2;
      const { eventSha256, ...withoutHash } = event;
      if (event.sequence !== index + 1 || event.previousEventSha256 !== previous || hashFastCalibrationCanonicalV1_2(withoutHash) !== eventSha256) {
        throw new Error("Fast calibration append-only event chain is missing, reordered, or corrupt.");
      }
      if (operationIds.has(event.operationId)) throw new Error("Fast calibration operationId is duplicated in the immutable event chain.");
      operationIds.add(event.operationId);
      previous = eventSha256;
      events.push(event);
      const evidence = event.type === "finalization_completed"
        ? event.bundle
        : "evidence" in event
          ? event.evidence
          : undefined;
      if (evidence) {
        if (!evidence.relativePath.startsWith("evidence/") || evidence.relativePath.includes("..") || evidence.relativePath.includes("\\")) {
          throw new Error("Fast calibration event contains an unsafe evidence path.");
        }
        const evidenceBytes = await readFile(path.join(this.sessionDir, ...evidence.relativePath.split("/")));
        if (hashBytes(evidenceBytes) !== evidence.sha256 || evidenceBytes.length !== evidence.byteSize) {
          throw new Error("Fast calibration accepted or failed evidence checkpoint is missing or corrupt.");
        }
      }
    }
    await this.verifyDurableCompletion(events);
    return events;
  }

  private async verifyDurableCompletion(events: FastCalibrationEventV1_2[]): Promise<void> {
    const analyses = events.filter(
      (event): event is FastCalibrationAnalysisEventV1_2 => event.type === "analysis_completed",
    );
    const finalizations = events.filter(
      (event): event is FastCalibrationFinalizationEventV1_2 => event.type === "finalization_completed",
    );
    if (analyses.length > 1 || finalizations.length > 1 || (finalizations.length > 0 && analyses.length !== 1)) {
      throw new Error("Fast calibration durable analysis/finalization lineage is invalid.");
    }
    if (analyses.length === 0) return;

    const analysisEvent = analyses[0]!;
    const analysisModule = await import("./fixedRigFastMathematicalCalibrationBundleV1_2");
    const analysisBytes = await readIdentityEvidence(this.sessionDir, analysisEvent.evidence);
    const analysis = analysisModule.parseAndRebuildFastCalibrationAnalysisV1_2(analysisBytes);
    const source = this.sourceAuthority(events);
    if (
      analysis.analysisSha256 !== analysisEvent.analysisSha256 ||
      analysis.sourceManifestSha256 !== analysisEvent.sourceManifestSha256 ||
      analysis.sourceArtifactLedgerSha256 !== analysisEvent.sourceArtifactLedgerSha256 ||
      !sameCanonical(analysis.sourceCapturePackage, source.sourceCapturePackage) ||
      !sameCanonical(analysis.sourceArtifactLedger, source.sourceArtifactLedger)
    ) {
      throw new Error("Stored deterministic analysis no longer matches the active event/evidence ledger.");
    }
    const deterministic = await this.rebuildDeterministicAnalysis(events);
    if (
      deterministic.analysisSha256 !== analysis.analysisSha256 ||
      !analysisBytes.equals(analysisModule.serializeFastCalibrationAnalysisV1_2(deterministic))
    ) {
      throw new Error(
        "Stored analysis does not deterministically reconstruct from the exact checkpointed frame bytes.",
      );
    }
    if (finalizations.length === 0) return;

    const finalization = finalizations[0]!;
    if (finalization.members.length !== 12 || new Set(finalization.members.map((member) => member.fileName)).size !== 12) {
      throw new Error("Stored finalized bundle does not contain twelve unique member checkpoints.");
    }
    const memberBytes = new Map<string, { path: string; bytes: Buffer }>();
    for (const member of finalization.members) {
      if (path.basename(member.fileName) !== member.fileName) {
        throw new Error("Stored finalized bundle member fileName is unsafe.");
      }
      memberBytes.set(member.fileName, {
        path: member.relativePath,
        bytes: await readIdentityEvidence(this.sessionDir, member),
      });
    }
    const storedBundleBytes = await readIdentityEvidence(this.sessionDir, finalization.bundle);
    const loader = await import("./fixedRigMathematicalCalibrationBundleV1");
    const loaded = loader.verifyFixedRigMathematicalCalibrationBundleBytesV1({
      bundlePath: loader.FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1,
      bundleSha256: finalization.bundleSha256,
      expectedRigId: this.identity.runtimeContext.rigId,
      expectedRuntimeContext: this.identity.runtimeContext,
      bundleBytes: storedBundleBytes,
      readMemberBytes(fileName) {
        const member = memberBytes.get(fileName);
        if (!member) throw new Error(`Stored finalized bundle member ${fileName} is missing.`);
        return member;
      },
    });
    if (
      finalization.bundle.sha256 !== finalization.bundleSha256 ||
      loaded.authority.bundleManifestSha256 !== finalization.bundleSha256 ||
      loaded.authority.memberLedgerSha256 !== finalization.memberLedgerSha256 ||
      loaded.authority.members.length !== finalization.memberCount ||
      loaded.authority.sourceCaptureManifestSha256 !== analysis.sourceManifestSha256 ||
      loaded.authority.captureContractVersion !== finalization.captureContractVersion ||
      loaded.authority.runtimeContextSha256 !== finalization.runtimeContextSha256 ||
      loaded.authority.rigCharacterizationSha256 !== finalization.rigCharacterizationSha256 ||
      finalization.analysisSha256 !== analysis.analysisSha256 ||
      finalization.sourceArtifactLedgerSha256 !== analysis.sourceArtifactLedgerSha256
    ) {
      throw new Error("Stored finalized bundle authority no longer matches its exact analysis/session lineage.");
    }
    if (this.config.finalizerStagingRoot) {
      await verifyFastCalibrationFinalizerHandoffV1_2({
        stagingRoot: this.config.finalizerStagingRoot,
        bundleBytes: storedBundleBytes,
        bundleManifestSha256: finalization.bundleSha256,
        members: loaded.authority.members.map((member) => {
          const stored = memberBytes.get(member.fileName);
          if (!stored) throw new Error(`Stored finalizer handoff member ${member.fileName} is missing.`);
          return { fileName: member.fileName, sha256: member.sha256, bytes: stored.bytes };
        }),
        rigId: loaded.profile.rigId,
        profileId: loaded.profile.profileId,
        calibrationVersion: loaded.profile.calibrationVersion,
        finalizedAt: loaded.profile.finalizedAt,
        sourceAnalysisSha256: analysis.analysisSha256,
      });
    }
  }

  private nextOperationId(): string {
    const value = this.config.operationId?.() ?? `op-${crypto.randomUUID()}`;
    exactId(value, "operationId");
    if (this.events.some((event) => event.operationId === value)) throw new Error("Generated fast calibration operationId is not unique.");
    return value;
  }

  private async append<T extends Omit<FastCalibrationEventV1_2, keyof FastCalibrationEventBaseV1_2>>(
    operationId: string,
    body: T,
  ): Promise<FastCalibrationEventV1_2> {
    exactId(operationId, "operationId");
    if (this.events.some((event) => event.operationId === operationId)) throw new Error("Fast calibration operationId cannot be reused.");
    const sequence = this.events.length + 1;
    const withoutHash = {
      ...body,
      sequence,
      operationId,
      recordedAt: (this.config.now?.() ?? new Date()).toISOString(),
      previousEventSha256: this.events.at(-1)?.eventSha256 ?? hashFastCalibrationCanonicalV1_2(this.identity),
    };
    const event = { ...withoutHash, eventSha256: hashFastCalibrationCanonicalV1_2(withoutHash) } as unknown as FastCalibrationEventV1_2;
    await writeFile(
      path.join(this.sessionDir, "events", `${String(sequence).padStart(8, "0")}.json`),
      canonicalBytes(event),
      { flag: "wx" },
    );
    this.events.push(event);
    return event;
  }

  private async checkpoint(bytes: Buffer, mediaType: FastCalibrationEvidenceV1_2["mediaType"], prefix: string): Promise<FastCalibrationEvidenceV1_2> {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("Fast calibration evidence bytes are empty.");
    const sha256 = hashBytes(bytes);
    const extension = mediaType === "image/tiff" ? "tiff" : mediaType === "image/png" ? "png" : "json";
    const relativePath = `evidence/${prefix}-${sha256}.${extension}`;
    const filePath = path.join(this.sessionDir, ...relativePath.split("/"));
    try {
      await writeFile(filePath, bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (hashBytes(await readFile(filePath)) !== sha256) throw new Error("Existing content-addressed calibration checkpoint is corrupt.");
    }
    const metadata = await stat(filePath);
    if (metadata.size !== bytes.length) throw new Error("Fast calibration checkpoint byte size mismatch.");
    return { evidenceId: `${prefix}-${sha256.slice(0, 16)}`, relativePath, sha256, byteSize: bytes.length, mediaType };
  }

  status(): FastCalibrationStatusV1_2 {
    const placements = activePlacements(this.events);
    const photometricKeys = acceptedPhotometricKeys(this.events);
    const placementPoses = [...placements.values()].sort((a, b) => a.slot - b.slot).map((event) => event.pose!);
    const lastPhotometricSequence = Math.max(0, ...acceptedEvents(this.events)
      .filter((event) => event.role !== "checkerboard_placement")
      .map((event) => event.sequence));
    const batchCleanupComplete = this.events.some((event) =>
      event.type === "batch_cleanup_completed" && event.sequence > lastPhotometricSequence);
    const flip = this.events.some((event) => event.type === "blank_reverse_flip_confirmed");
    const analysis = this.events.some((event) => event.type === "analysis_completed");
    const finalization = this.events.some((event) => event.type === "finalization_completed");
    let phase: FastCalibrationPhaseV1_2;
    let nextAction: FastCalibrationNextActionV1_2;
    if (placements.size < 4) {
      const slot = [1, 2, 3, 4].find((candidate) => !placements.has(candidate))!;
      phase = "checkerboard_placements";
      nextAction = { action: "capture_checkerboard", role: "checkerboard_placement", slot, channelIndex: null, sampleIndex: slot };
    } else if (!flip) {
      phase = "blank_reverse_flip";
      nextAction = { action: "confirm_blank_reverse_flip", role: "blank_reverse_flip", slot: null, channelIndex: null, sampleIndex: null };
    } else if (photometricKeys.size < PHOTOMETRIC_PLAN.length) {
      const missing = PHOTOMETRIC_PLAN.find((item) => !photometricKeys.has(`${item.role}:${item.channelIndex}:${item.sampleIndex}`))!;
      phase = "photometric_sweep";
      nextAction = { action: "capture_photometric", ...missing };
    } else if (!batchCleanupComplete) {
      phase = "photometric_sweep";
      nextAction = { action: "complete_batch_cleanup", role: "safe_off", slot: null, channelIndex: null, sampleIndex: null };
    } else if (!analysis) {
      phase = "analyze";
      nextAction = { action: "analyze", role: "analysis", slot: null, channelIndex: null, sampleIndex: null };
    } else if (!finalization) {
      phase = "finalize";
      nextAction = { action: "finalize", role: "finalization", slot: null, channelIndex: null, sampleIndex: null };
    } else {
      phase = "ready_for_explicit_activation";
      nextAction = { action: "activate_explicitly", role: "activation", slot: null, channelIndex: null, sampleIndex: null };
    }
    return {
      sessionId: this.identity.sessionId,
      contractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
      phase,
      nextAction,
      captureCounts: {
        acceptedCheckerboardPlacements: placements.size,
        acceptedPhotometricFrames: photometricKeys.size,
        totalAcceptedImages: placements.size + photometricKeys.size,
        requiredTotalImages: 76,
      },
      acceptedPlacementSlots: [...placements.keys()].sort((a, b) => a - b),
      failedOperationCount: this.events.filter((event) => event.type.endsWith("failed")).length,
      supersededOperationCount: acceptedEvents(this.events).filter((event) => event.supersedesOperationId).length,
      aggregatePoseSpans: poseSpans(placementPoses),
      runtimeContextSha256: this.identity.runtimeContextSha256,
      rigCharacterizationSha256: this.identity.rigCharacterizationSha256,
      eventCount: this.events.length,
      lastEventSha256: this.events.at(-1)?.eventSha256 ?? null,
    };
  }

  private async recordCaptureFailure(input: {
    operationId: string;
    role: FastCalibrationCaptureRoleV1_2;
    slot: number | null;
    channelIndex: number | null;
    sampleIndex: number | null;
    error: unknown;
    evidence?: FastCalibrationEvidenceV1_2;
  }): Promise<never> {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    await this.append(input.operationId, {
      type: "capture_failed",
      role: input.role,
      slot: input.slot,
      channelIndex: input.channelIndex,
      sampleIndex: input.sampleIndex,
      error: message.slice(0, 1000),
      ...(input.evidence ? { evidence: input.evidence } : {}),
    });
    throw new FastCalibrationOperationErrorV1_2(input.operationId, message);
  }

  async captureCheckerboard(input: {
    frame: FastCalibrationCapturedFrameV1_2;
    pose: FastCalibrationPoseV1_2;
    replaceSlot?: number;
  }): Promise<FastCalibrationStatusV1_2> {
    const operationId = this.nextOperationId();
    const before = this.status();
    const placements = activePlacements(this.events);
    const replacement = input.replaceSlot !== undefined;
    const slot = replacement ? input.replaceSlot! : before.nextAction.role === "checkerboard_placement" ? before.nextAction.slot : 0;
    let evidence: FastCalibrationEvidenceV1_2 | undefined;
    try {
      if (before.phase !== "checkerboard_placements") throw new Error("Checkerboard placement capture is not the bridge-owned next action.");
      if (!Number.isInteger(slot) || slot < 1 || slot > 4) throw new Error("Checkerboard placement slot must be 1 through 4.");
      const superseded = placements.get(slot);
      if (replacement && !superseded) throw new Error("Explicit pose replacement requires an already accepted slot.");
      if (!replacement && superseded) throw new Error("Accepted pose slot cannot be overwritten without explicit replacement.");
      assertCaptureMetadata(input.frame.metadata, this.identity.runtimeContext);
      evidence = await this.checkpoint(input.frame.bytes, input.frame.mediaType, `checkerboard-${slot}-${operationId}`);
      const other = [...placements.values()].filter((event) => event.slot !== slot).map((event) => event.pose!);
      const finalSet = other.length === 3 ? [...other, input.pose] : [];
      const reasons = validatePose(input.pose, evidence.sha256, this.identity.runtimeContext, other, finalSet);
      if (acceptedEvents(this.events).some((event) => event.evidence.sha256 === evidence!.sha256)) {
        reasons.push("capture bytes duplicate or relabel previously accepted evidence");
      }
      if (reasons.length) throw new Error(reasons.join("; "));
      await this.append(operationId, {
        type: "capture_accepted",
        role: "checkerboard_placement",
        slot,
        channelIndex: null,
        sampleIndex: slot,
        evidence,
        metadata: input.frame.metadata,
        pose: input.pose,
        ...(superseded ? { supersedesOperationId: superseded.operationId } : {}),
      });
      return this.status();
    } catch (error) {
      return this.recordCaptureFailure({ operationId, role: "checkerboard_placement", slot: slot || null, channelIndex: null, sampleIndex: slot || null, error, evidence });
    }
  }

  async confirmBlankReverseFlip(confirmed: boolean): Promise<FastCalibrationStatusV1_2> {
    const operationId = this.nextOperationId();
    if (this.status().phase !== "blank_reverse_flip" || confirmed !== true) {
      throw new FastCalibrationOperationErrorV1_2(operationId, "Exactly one explicit blank-reverse flip confirmation is required after four accepted poses.");
    }
    await this.append(operationId, { type: "blank_reverse_flip_confirmed", flipCount: 1 });
    return this.status();
  }

  async runPhotometricBatch(controller: FastCalibrationPersistentBatchControllerV1_2): Promise<FastCalibrationStatusV1_2> {
    if (this.status().phase !== "photometric_sweep") throw new Error("Photometric batch is not the bridge-owned next action.");
    let opened = false;
    let currentOperationId: string | undefined;
    try {
      opened = true;
      try {
        const observedContext = await controller.open(this.identity.runtimeContext);
        assertFastCalibrationRuntimeContextMatchV1_2(this.identity.runtimeContext, observedContext);
      } catch (error) {
        const openOperationId = this.nextOperationId();
        const message = error instanceof Error ? error.message : String(error);
        await this.append(openOperationId, {
          type: "batch_open_failed",
          role: "batch_open",
          slot: null,
          channelIndex: null,
          sampleIndex: null,
          error: message.slice(0, 1000),
        });
        throw new FastCalibrationOperationErrorV1_2(openOperationId, message);
      }
      while (this.status().nextAction.action === "capture_photometric") {
        const next = this.status().nextAction;
        if (next.role !== "dark_control" && next.role !== "flat_field" && next.role !== "illumination_pattern") {
          throw new Error("Photometric sweep next-action contract is inconsistent.");
        }
        currentOperationId = this.nextOperationId();
        try {
          const frame = await controller.capture({
            operationId: currentOperationId,
            role: next.role,
            channelIndex: next.channelIndex,
            sampleIndex: next.sampleIndex,
            dutyPercent: next.role === "dark_control" ? 0 : this.identity.runtimeContext.dutyPercent,
          });
          assertCaptureMetadata(frame.metadata, this.identity.runtimeContext);
          const evidence = await this.checkpoint(frame.bytes, frame.mediaType, `${next.role}-${next.channelIndex}-${next.sampleIndex}-${currentOperationId}`);
          if (acceptedEvents(this.events).some((event) => event.evidence.sha256 === evidence.sha256)) {
            throw new Error("Photometric capture bytes duplicate or relabel previously accepted evidence.");
          }
          await this.append(currentOperationId, {
            type: "capture_accepted",
            role: next.role,
            slot: next.slot,
            channelIndex: next.channelIndex,
            sampleIndex: next.sampleIndex,
            evidence,
            metadata: frame.metadata,
          });
          currentOperationId = undefined;
        } catch (error) {
          await this.recordCaptureFailure({
            operationId: currentOperationId as string,
            role: next.role,
            slot: next.slot,
            channelIndex: next.channelIndex,
            sampleIndex: next.sampleIndex,
            error,
          });
        }
      }
    } finally {
      if (opened) {
        const cleanupOperationId = this.nextOperationId();
        let safeOff: Awaited<ReturnType<FastCalibrationPersistentBatchControllerV1_2["safeOff"]>>;
        try {
          safeOff = await controller.safeOff();
          if (
            safeOff.controllerIdentity !== this.identity.runtimeContext.controller.identity ||
            safeOff.confirmed !== true || safeOff.responseKinds.length === 0 || safeOff.responseKinds.some((kind) => kind !== "ack")
          ) {
            throw new Error("Persistent calibration batch final safe-off acknowledgement is incomplete.");
          }
        } catch (error) {
          const safeOffMessage = error instanceof Error ? error.message : String(error);
          let closeMessage = "";
          try {
            await controller.close();
          } catch (closeError) {
            closeMessage = closeError instanceof Error ? closeError.message : String(closeError);
          }
          const message = closeMessage
            ? safeOffMessage + "; controller close also failed: " + closeMessage
            : safeOffMessage;
          await this.append(cleanupOperationId, {
            type: "batch_safe_off_failed",
            role: "safe_off",
            slot: null,
            channelIndex: null,
            sampleIndex: null,
            error: message.slice(0, 1000),
          });
          throw new FastCalibrationOperationErrorV1_2(cleanupOperationId, message);
        }
        try {
          await controller.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.append(cleanupOperationId, {
            type: "batch_close_failed",
            role: "batch_close",
            slot: null,
            channelIndex: null,
            sampleIndex: null,
            error: message.slice(0, 1000),
          });
          throw new FastCalibrationOperationErrorV1_2(cleanupOperationId, message);
        }
        await this.append(cleanupOperationId, {
          type: "batch_cleanup_completed",
          controllerIdentity: safeOff.controllerIdentity,
          safeOffResponseKinds: [...safeOff.responseKinds],
          closed: true,
        });
      }
    }
    return this.status();
  }

  private sourceAuthority(events: FastCalibrationEventV1_2[] = this.events): {
    sourceManifestSha256: string;
    sourceCapturePackage: FastCalibrationSourceCapturePackageV1_2;
    sourceArtifactLedger: ReturnType<FixedRigFastMathematicalCalibrationCoreV1_2["getSourceArtifactLedger"]>;
  } {
    const sourceArtifactLedger = this.sourceArtifactLedgerForEvents(events);
    const sourceArtifactLedgerSha256 = hashFastCalibrationCanonicalV1_2(sourceArtifactLedger);
    const flip = events.find((event) => event.type === "blank_reverse_flip_confirmed");
    const cleanup = [...events].reverse().find((event) => event.type === "batch_cleanup_completed");
    if (!flip || !cleanup || activePlacements(events).size + acceptedPhotometricKeys(events).size !== 76) {
      throw new Error("Fast calibration source authority is incomplete.");
    }
    const sourceManifestSha256 = hashFastCalibrationCanonicalV1_2({
      schemaVersion: "ten-kings-mathematical-calibration-source-manifest-v1.2",
      sessionIdentitySha256: hashFastCalibrationCanonicalV1_2(this.identity),
      blankReverseFlipEventSha256: flip.eventSha256,
      batchCleanupEventSha256: cleanup.eventSha256,
      sourceArtifactLedgerSha256,
    });
    const sourceCapturePackage: FastCalibrationSourceCapturePackageV1_2 = {
      schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PACKAGE_SCHEMA,
      contractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
      packageId: `capture-package-${hashFastCalibrationCanonicalV1_2(this.identity.sessionId).slice(0, 32)}`,
      manifestSha256: sourceManifestSha256,
      rigId: this.identity.runtimeContext.rigId,
      captureProfileVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PROFILE,
      purpose: "mathematical_calibration_v1.2",
      thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
      thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
      captureEvidenceAcceptance: {
        exactCheckerboardPlacements: 4,
        exactPhotometricFrames: 72,
        exactTotalImageCaptures: 76,
        exactBlankReverseFlipCount: 1,
        poseFourRequiresFinalAggregateDiversity: true,
        acceptedPoseSupersessionPreservesEvidence: true,
        failedAttemptLeavesSlotPending: true,
        persistentBatchRequired: true,
        automaticFallbackAllowed: false,
      },
      stationAuthority: {
        stationId: this.identity.runtimeContext.stationId,
        sessionId: this.identity.sessionId,
        operatorId: this.identity.operatorId,
        createdAt: this.identity.createdAt,
        finalizedAt: cleanup.recordedAt,
        noProductionMutation: true,
        protectedSettings: this.identity.runtimeContext,
      },
      subject: {
        designation: "calibration_target",
        productionCard: false,
        targetVersion: this.identity.runtimeContext.target.version,
        targetSha256: this.identity.runtimeContext.target.sha256,
      },
      rigCharacterizationAuthority: this.identity.rigCharacterization,
      rigCharacterizationSha256: this.identity.rigCharacterizationSha256,
      runtimeContext: this.identity.runtimeContext,
      runtimeContextSha256: this.identity.runtimeContextSha256,
      captureCounts: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS,
      sourceArtifactLedgerSha256,
    };
    return { sourceManifestSha256, sourceCapturePackage, sourceArtifactLedger };
  }

  private async verifiedStoredRigSource(): Promise<VerifiedFastCalibrationRigCharacterizationSourceV1_2> {
    const source: FastCalibrationRigCharacterizationSourceV1_2 = {
      bundleBytes: await readIdentityEvidence(this.sessionDir, this.identity.rigCharacterizationSource.bundle),
      members: await Promise.all(this.identity.rigCharacterizationSource.members.map(async (member) => ({
        fileName: member.fileName,
        bytes: await readIdentityEvidence(this.sessionDir, member),
      }))),
    };
    const verified = verifyFastCalibrationRigCharacterizationSourceV1_2(source, this.identity.runtimeContext);
    if (!sameCanonical(verified.authority, this.identity.rigCharacterization)) {
      throw new Error("Stored one-time rig-characterization source no longer matches the session identity.");
    }
    return verified;
  }

  private async readAcceptedFrame(
    entry: ReturnType<FixedRigFastMathematicalCalibrationCoreV1_2["getSourceArtifactLedger"]>[number],
    events: FastCalibrationEventV1_2[],
  ): Promise<Buffer> {
    const event = events.find((candidate): candidate is FastCalibrationAcceptedEventV1_2 =>
      candidate.type === "capture_accepted" && candidate.operationId === entry.operationId);
    if (!event || event.evidence.sha256 !== entry.sha256 || event.evidence.byteSize !== entry.byteSize ||
        event.evidence.mediaType === "application/json" || !event.evidence.relativePath.startsWith("evidence/") ||
        event.evidence.relativePath.includes("..") || event.evidence.relativePath.includes("\\")) {
      throw new Error("Active source artifact is not exactly bound to a safe captured-frame checkpoint.");
    }
    const bytes = await readFile(path.join(this.sessionDir, ...event.evidence.relativePath.split("/")));
    if (bytes.length !== event.evidence.byteSize || hashBytes(bytes) !== event.evidence.sha256) {
      throw new Error("Active captured-frame checkpoint is missing or corrupt.");
    }
    return bytes;
  }

  private buildEvidenceDerivedInput(
    source: ReturnType<FixedRigFastMathematicalCalibrationCoreV1_2["sourceAuthority"]>,
    verifiedRig: VerifiedFastCalibrationRigCharacterizationSourceV1_2,
    decoded: FastCalibrationEvidenceAnalysisResultV1_2,
    transformPhysicalDirection: (
      vector: { x: number; y: number },
      matrix: readonly [number, number, number, number],
    ) => { x: number; y: number },
  ): Pick<BuildFastCalibrationAnalysisV1_2Input, "builderInput" | "flatFieldArtifacts" | "illuminationPatternArtifact"> {
    if (decoded.geometryAlgorithmSha256 !== this.identity.runtimeContext.algorithmHashes.geometry ||
        decoded.photometricAlgorithmSha256 !== this.identity.runtimeContext.algorithmHashes.photometric) {
      throw new Error("Evidence analyzer implementation hashes differ from the protected runtime algorithm hashes.");
    }
    const activePoses = source.sourceArtifactLedger
      .filter((entry) => entry.active && entry.role === "checkerboard_placement")
      .sort((left, right) => left.slot - right.slot);
    if (decoded.poses.length !== 4 || activePoses.length !== 4) {
      throw new Error("Evidence-derived geometry must contain exactly four active poses.");
    }
    const normalizationResidualSamples: BuildFixedRigPhysicalCalibrationV1Input["normalizationResidualSamples"] = [];
    const segmentationBoundarySamples: BuildFixedRigPhysicalCalibrationV1Input["segmentationBoundarySamples"] = [];
    decoded.poses.forEach((derived, poseIndex) => {
      const sourcePose = activePoses[poseIndex]!;
      if (derived.sourceFrameSha256 !== sourcePose.sha256 || !sourcePose.pose ||
          !sameCanonical(derived.pose, sourcePose.pose) || derived.normalizationResidualPx.length < 10 ||
          derived.segmentationBoundaryResidualPx.length < 10) {
        throw new Error("Capture-time pose geometry does not reconstruct from its exact active checkpoint bytes.");
      }
      derived.normalizationResidualPx.forEach((residualPx, index) => {
        finite(residualPx, "evidence-derived normalization residual", 0);
        normalizationResidualSamples.push({
          evidenceId: `pose-${sourcePose.slot}-normalization-${index + 1}`,
          sha256: sourcePose.sha256,
          role: "checkerboard_placement",
          residualPx,
        });
      });
      derived.segmentationBoundaryResidualPx.forEach((outerContourFitResidualPx, index) => {
        finite(outerContourFitResidualPx, "evidence-derived segmentation-boundary residual", 0);
        segmentationBoundarySamples.push({
          evidenceId: `pose-${sourcePose.slot}-boundary-${index + 1}`,
          sha256: sourcePose.sha256,
          role: "checkerboard_placement",
          outerContourFitResidualPx,
        });
      });
    });
    if (decoded.gridWidth !== 8 || decoded.gridHeight !== 8 || decoded.channels.length !== 8) {
      throw new Error("Evidence-derived photometric result must contain exact 8x8 grids for channels 1 through 8.");
    }
    const meanGrid = (grids: number[][], label: string): number[] => {
      if (grids.length !== 3 || grids.some((grid) => grid.length !== 64 || grid.some((value) => !Number.isFinite(value) || value < 0))) {
        throw new Error(`${label} must contain three exact finite non-negative 8x8 decoded grids.`);
      }
      return Array.from({ length: 64 }, (_, index) => Number(
        ((grids[0]![index]! + grids[1]![index]! + grids[2]![index]!) / 3).toFixed(9),
      ));
    };
    const sourceFor = (role: FastCalibrationPhotometricRoleV1_2, channelIndex: number, sampleIndex: number) => {
      const values = source.sourceArtifactLedger.filter((entry) => entry.active && entry.role === role &&
        entry.channelIndex === channelIndex && entry.sampleIndex === sampleIndex);
      if (values.length !== 1) throw new Error(`Exact ${role} source evidence is missing or duplicated.`);
      return { evidenceId: `${role}-${channelIndex}-${sampleIndex}`, sha256: values[0]!.sha256, role };
    };
    const physicalDirection = (channelIndex: number): { x: number; y: number } => {
      const authority = verifiedRig.oneTimeBuilderInput.channels.find((channel) => channel.channelIndex === channelIndex);
      if (!authority || authority.directionMeasurementSamples.length < 3) {
        throw new Error(`Channel ${channelIndex} immutable physical-direction authority is incomplete.`);
      }
      const vectors = authority.directionMeasurementSamples.map((sample) => ({
        x: sample.sourcePointMm.x - sample.cardCenterPointMm.x,
        y: sample.sourcePointMm.y - sample.cardCenterPointMm.y,
      }));
      const x = vectors.reduce((sum, value) => sum + value.x, 0) / vectors.length;
      const y = vectors.reduce((sum, value) => sum + value.y, 0) / vectors.length;
      const magnitude = Math.hypot(x, y);
      if (!Number.isFinite(magnitude) || magnitude <= 0) throw new Error(`Channel ${channelIndex} physical direction is degenerate.`);
      const normalized = { x: x / magnitude, y: y / magnitude };
      if (decoded.directionCoordinateFrame === "canonical_normalized_target_v1") return normalized;
      if (!decoded.physicalToNormalizedDirectionMatrix) {
        throw new Error("Legacy measured-stage direction analysis lacks its measured transform.");
      }
      return transformPhysicalDirection(normalized, decoded.physicalToNormalizedDirectionMatrix);
    };
    const angleError = (grid: number[], expected: { x: number; y: number }): number => {
      const minimum = Math.min(...grid);
      let weightedX = 0;
      let weightedY = 0;
      let weight = 0;
      grid.forEach((value, index) => {
        const sampleWeight = Math.max(0, value - minimum);
        weightedX += sampleWeight * ((index % 8) - 3.5);
        weightedY += sampleWeight * (Math.floor(index / 8) - 3.5);
        weight += sampleWeight;
      });
      const magnitude = Math.hypot(weightedX, weightedY);
      if (weight <= 0 || magnitude <= 0) throw new Error("Illumination pattern has no evidence-derived directional centroid.");
      const dot = Math.max(-1, Math.min(1, (weightedX * expected.x + weightedY * expected.y) / magnitude));
      return Number((Math.acos(dot) * 180 / Math.PI).toFixed(9));
    };
    const derivedChannels = decoded.channels.map((channel, index) => {
      if (channel.channelIndex !== index + 1) throw new Error("Decoded photometric channels are reordered or incomplete.");
      const dark = meanGrid(channel.darkControlGrids, `channel ${channel.channelIndex} dark response`);
      const flat = meanGrid(channel.flatFieldGrids, `channel ${channel.channelIndex} flat response`);
      const pattern = meanGrid(channel.illuminationPatternGrids, `channel ${channel.channelIndex} illumination response`);
      const correctedFlat = flat.map((value, cell) => Math.max(0, value - dark[cell]!));
      const responseScale = correctedFlat.reduce((sum, value) => sum + value, 0) / correctedFlat.length;
      if (!Number.isFinite(responseScale) || responseScale <= 0) throw new Error(`Channel ${channel.channelIndex} flat response is not above dark response.`);
      const relativeResponse = correctedFlat.map((value) => Number((value / responseScale).toFixed(9)));
      const correctedPattern = pattern.map((value, cell) => Math.max(0, value - dark[cell]!));
      const patternScale = correctedPattern.reduce((sum, value) => sum + value, 0) / correctedPattern.length;
      if (!Number.isFinite(patternScale) || patternScale <= 0) throw new Error(`Channel ${channel.channelIndex} illumination response is not above dark response.`);
      const expectedDirectionalResidual = correctedPattern.map((value, cell) =>
        Number((value / patternScale - relativeResponse[cell]!).toFixed(9)));
      const expected = physicalDirection(channel.channelIndex);
      const directionValidationAngularErrorsDegrees = channel.illuminationPatternGrids.map((grid) => {
        const corrected = grid.map((value, cell) => Math.max(0, value - dark[cell]!));
        return angleError(corrected, expected);
      });
      return { channel, dark, flat, pattern, responseScale: Number(responseScale.toFixed(9)), relativeResponse,
        expectedDirectionalResidual, directionValidationAngularErrorsDegrees };
    });
    const flatFieldArtifacts = derivedChannels.map((value) => {
      const channelIndex = value.channel.channelIndex;
      const content = {
        schemaVersion: "ten-kings-flat-field-artifact-v1",
        algorithmVersion: "opencv_physical_calibration_analysis_v1",
        hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
        algorithmSha256: decoded.photometricAlgorithmSha256,
        channelIndex,
        gridWidth: decoded.gridWidth,
        gridHeight: decoded.gridHeight,
        darkResponse: value.dark,
        flatResponse: value.flat,
        relativeResponse: value.relativeResponse,
        responseScale: value.responseScale,
        sourceFrames: [1, 2, 3].map((sampleIndex) => ({
          darkControlSha256: sourceFor("dark_control", channelIndex, sampleIndex).sha256,
          flatFieldSha256: sourceFor("flat_field", channelIndex, sampleIndex).sha256,
        })),
      };
      const artifactSha256 = hashBytes(Buffer.from(JSON.stringify(canonical(content)), "utf8"));
      const bytes = canonicalBytes({ ...content, artifactSha256 });
      return { channelIndex, fileName: `flat-field-channel-${channelIndex}-v1.json`, sha256: hashBytes(bytes), bytes };
    });
    const illuminationContent = {
      schemaVersion: "ten-kings-illumination-pattern-artifact-v1",
      algorithmVersion: "opencv_physical_calibration_analysis_v1",
      hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
      algorithmSha256: decoded.photometricAlgorithmSha256,
      coordinateFrame: "normalized_card_portrait_pixels",
      gridWidth: decoded.gridWidth,
      gridHeight: decoded.gridHeight,
      channels: derivedChannels.map((value) => ({
        channelIndex: value.channel.channelIndex,
        illuminationResponse: value.pattern,
        expectedDirectionalResidual: value.expectedDirectionalResidual,
        directionValidationAngularErrorsDegrees: value.directionValidationAngularErrorsDegrees,
        sourceFrameSha256: [1, 2, 3].map((sampleIndex) =>
          sourceFor("illumination_pattern", value.channel.channelIndex, sampleIndex).sha256),
      })),
    };
    const illuminationArtifactSha256 = hashBytes(Buffer.from(JSON.stringify(canonical(illuminationContent)), "utf8"));
    const illuminationBytes = canonicalBytes({ ...illuminationContent, artifactSha256: illuminationArtifactSha256 });
    const illuminationPatternArtifact = {
      fileName: "illumination-pattern-v1.json" as const,
      sha256: hashBytes(illuminationBytes),
      bytes: illuminationBytes,
    };
    const builderInput: BuildFixedRigPhysicalCalibrationV1Input = {
      ...verifiedRig.oneTimeBuilderInput,
      profileId: `mathematical-calibration-profile-${this.identity.sessionId}`,
      calibrationVersion: "mathematical-calibration-v1.2.0",
      artifactId: `mathematical-calibration-artifact-${this.identity.sessionId}`,
      finalizedAt: source.sourceCapturePackage.stationAuthority.finalizedAt,
      operatorId: source.sourceCapturePackage.stationAuthority.operatorId,
      normalizationResidualSamples,
      segmentationBoundarySamples,
      normalizationModel: {
        ...verifiedRig.oneTimeBuilderInput.normalizationModel,
        sampleResidualPx: normalizationResidualSamples.map((sample) => sample.residualPx),
      },
      channels: derivedChannels.map((value) => {
        const channelIndex = value.channel.channelIndex;
        const oneTime = verifiedRig.oneTimeBuilderInput.channels.find((channel) => channel.channelIndex === channelIndex)!;
        const flat = flatFieldArtifacts.find((artifact) => artifact.channelIndex === channelIndex)!;
        return {
          channelIndex,
          directionMeasurementSamples: oneTime.directionMeasurementSamples,
          directionValidationAngularErrorsDegrees: value.directionValidationAngularErrorsDegrees,
          relativeResponse: value.relativeResponse,
          responseScale: value.responseScale,
          flatFieldArtifactId: `flat-field-${channelIndex}-v1`,
          flatFieldArtifactSha256: flat.sha256,
          flatFieldFrames: [1, 2, 3].map((sampleIndex) => sourceFor("flat_field", channelIndex, sampleIndex)),
          darkControlFrames: [1, 2, 3].map((sampleIndex) => sourceFor("dark_control", channelIndex, sampleIndex)),
          illuminationPatternArtifactId: "illumination-pattern-v1",
          illuminationPatternArtifactSha256: illuminationPatternArtifact.sha256,
          illuminationPatternFrames: [1, 2, 3].map((sampleIndex) => sourceFor("illumination_pattern", channelIndex, sampleIndex)),
          illuminationPatternGridWidth: decoded.gridWidth,
          illuminationPatternGridHeight: decoded.gridHeight,
          expectedDirectionalResidual: value.expectedDirectionalResidual,
        };
      }),
    };
    return { builderInput, flatFieldArtifacts, illuminationPatternArtifact };
  }

  private async rebuildDeterministicAnalysis(
    events: FastCalibrationEventV1_2[] = this.events,
  ): Promise<FastCalibrationAnalysisV1_2> {
    const analyzer = this.config.evidenceAnalyzer;
    if (!analyzer) throw new Error("Trusted local V1.2 evidence analyzer is not configured.");
    const source = this.sourceAuthority(events);
    const verifiedRig = await this.verifiedStoredRigSource();
    const activeSourceArtifactLedger = source.sourceArtifactLedger.filter((entry) => entry.active);
    const decoded = await analyzer.analyze({
      runtimeContext: this.identity.runtimeContext,
      activeSourceArtifactLedger,
      readFrame: (entry) => this.readAcceptedFrame(entry, events),
      geometryAuthority: {
        lensModel: verifiedRig.oneTimeBuilderInput.lensModel,
        directionCoordinateAuthority: verifiedRig.directionCoordinateAuthority,
      },
    });
    const { transformFastCalibrationPhysicalDirectionV1_2 } =
      await import("./fixedRigFastCalibrationMathV1_2");
    const derived = this.buildEvidenceDerivedInput(
      source,
      verifiedRig,
      decoded,
      transformFastCalibrationPhysicalDirectionV1_2,
    );
    const analysisModule = await import("./fixedRigFastMathematicalCalibrationBundleV1_2");
    return analysisModule.buildFastCalibrationAnalysisV1_2({ ...source, ...derived });
  }

  async analyze(): Promise<FastCalibrationStatusV1_2> {
    if (arguments.length !== 0) {
      throw new Error("Fast calibration analyze accepts no caller-authored values, artifacts, bytes, or hashes.");
    }
    const operationId = this.nextOperationId();
    if (this.status().phase !== "analyze") throw new Error("Analysis is not the bridge-owned next action.");
    try {
      const source = this.sourceAuthority();
      const analysisModule = await import("./fixedRigFastMathematicalCalibrationBundleV1_2");
      const analysis = await this.rebuildDeterministicAnalysis();
      if (analysis.authorityLayers.oneTimeRigCharacterizationInputSha256 !== this.identity.oneTimeCalibrationInputSha256 ||
          analysis.sourceArtifactLedgerSha256 !== source.sourceCapturePackage.sourceArtifactLedgerSha256) {
        throw new Error("Deterministic analysis does not match the verified session authority.");
      }
      const evidence = await this.checkpoint(
        analysisModule.serializeFastCalibrationAnalysisV1_2(analysis),
        "application/json",
        `analysis-${operationId}`,
      );
      await this.append(operationId, {
        type: "analysis_completed",
        evidence,
        analysisSha256: analysis.analysisSha256,
        sourceArtifactLedgerSha256: analysis.sourceArtifactLedgerSha256,
        sourceManifestSha256: analysis.sourceManifestSha256,
        accepted: true,
      });
      return this.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.append(operationId, {
        type: "analysis_failed",
        role: "analysis",
        slot: null,
        channelIndex: null,
        sampleIndex: null,
        error: message.slice(0, 1000),
      });
      throw new FastCalibrationOperationErrorV1_2(operationId, message);
    }
  }

  async recordAnalysis(_callerAuthoredInput: unknown): Promise<never> {
    throw new Error("Caller-authored analysis bytes, acceptance booleans, and trusted hashes are prohibited; use deterministic analyze().");
  }

  async finalize(): Promise<FastCalibrationStatusV1_2> {
    const operationId = this.nextOperationId();
    if (this.status().phase !== "finalize") throw new Error("Finalization is not the bridge-owned next action.");
    try {
      const analysisEvent = [...this.events].reverse().find(
        (event): event is FastCalibrationAnalysisEventV1_2 => event.type === "analysis_completed",
      );
      if (!analysisEvent) throw new Error("Finalization requires the exact completed analysis event.");
      const analysisModule = await import("./fixedRigFastMathematicalCalibrationBundleV1_2");
      const analysisBytes = await readIdentityEvidence(this.sessionDir, analysisEvent.evidence);
      const analysis: FastCalibrationAnalysisV1_2 = analysisModule.parseAndRebuildFastCalibrationAnalysisV1_2(analysisBytes);
      const currentSource = this.sourceAuthority();
      if (
        analysis.analysisSha256 !== analysisEvent.analysisSha256 ||
        analysis.sourceManifestSha256 !== analysisEvent.sourceManifestSha256 ||
        analysis.sourceArtifactLedgerSha256 !== analysisEvent.sourceArtifactLedgerSha256 ||
        !sameCanonical(analysis.sourceCapturePackage, currentSource.sourceCapturePackage) ||
        !sameCanonical(analysis.sourceArtifactLedger, currentSource.sourceArtifactLedger)
      ) {
        throw new Error("Completed analysis no longer matches the exact active session event/evidence ledger.");
      }
      await mkdir(path.join(this.sessionDir, "finalizations"), { recursive: true });
      const finalized = await analysisModule.finalizeFastMathematicalCalibrationBundleV1_2({
        analysis,
        outputDir: path.join(this.sessionDir, "finalizations", operationId),
      });
      const loader = await import("./fixedRigMathematicalCalibrationBundleV1");
      const loaded = loader.loadFixedRigMathematicalCalibrationBundleV1({
        bundlePath: finalized.bundlePath,
        bundleSha256: finalized.bundleSha256,
        expectedRigId: this.identity.runtimeContext.rigId,
        expectedRuntimeContext: this.identity.runtimeContext,
      });
      if (
        finalized.authority.members.length !== 12 || loaded.authority.members.length !== 12 ||
        loaded.authority.bundleManifestSha256 !== finalized.bundleSha256 ||
        loaded.authority.memberLedgerSha256 !== finalized.authority.memberLedgerSha256 ||
        loaded.authority.sourceCaptureManifestSha256 !== analysis.sourceManifestSha256 ||
        loaded.authority.captureContractVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT ||
        loaded.authority.runtimeContextSha256 !== this.identity.runtimeContextSha256 ||
        loaded.authority.rigCharacterizationSha256 !== this.identity.rigCharacterizationSha256 ||
        finalized.bundle.sourceAnalysisSha256 !== analysis.analysisSha256
      ) {
        throw new Error("Canonical V1.2 loader rejected final bundle authority binding.");
      }
      const finalizedMembers = await Promise.all(finalized.authority.members.map(async (member) => ({
        fileName: member.fileName,
        sha256: member.sha256,
        bytes: await readFile(path.join(path.dirname(finalized.bundlePath), member.fileName)),
      })));
      if (this.config.finalizerStagingRoot) {
        await stageFastCalibrationFinalizerHandoffV1_2({
          stagingRoot: this.config.finalizerStagingRoot,
          bundleBytes: finalized.bundleBytes,
          bundleManifestSha256: finalized.bundleSha256,
          members: finalizedMembers,
          rigId: finalized.profile.rigId,
          profileId: finalized.profile.profileId,
          calibrationVersion: finalized.profile.calibrationVersion,
          finalizedAt: finalized.profile.finalizedAt,
          sourceAnalysisSha256: analysis.analysisSha256,
        });
      }
      const bundle = await this.checkpoint(finalized.bundleBytes, "application/json", `bundle-${operationId}`);
      const members = await Promise.all(finalizedMembers.map(async (member) => ({
        ...(await this.checkpoint(
          member.bytes,
          "application/json",
          `bundle-member-${operationId}-${member.fileName.replace(/[^A-Za-z0-9.-]/g, "-")}`,
        )),
        fileName: member.fileName,
      })));
      await this.append(operationId, {
        type: "finalization_completed",
        bundle,
        members,
        memberLedgerSha256: loaded.authority.memberLedgerSha256,
        memberCount: 12,
        analysisSha256: analysis.analysisSha256,
        sourceArtifactLedgerSha256: analysis.sourceArtifactLedgerSha256,
        bundleSha256: finalized.bundleSha256,
        captureContractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
        runtimeContextSha256: this.identity.runtimeContextSha256,
        rigCharacterizationSha256: this.identity.rigCharacterizationSha256,
      });
      return this.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.append(operationId, {
        type: "finalization_failed",
        role: "finalization",
        slot: null,
        channelIndex: null,
        sampleIndex: null,
        error: message.slice(0, 1000),
      });
      throw new FastCalibrationOperationErrorV1_2(operationId, message);
    }
  }

  async recordFinalizedBundle(_callerAuthoredInput: unknown): Promise<never> {
    throw new Error("Caller-authored final bundle bytes and trusted hashes are prohibited; use canonical finalize().");
  }

  assertReadyForStartNewCard(_liveContext: FastCalibrationRuntimeContextV1_2): never {
    throw new Error("Fast calibration core completion is only ready_for_explicit_activation; Agent 4 activation receipt is required before Start New Card.");
  }

  assertReadyForExplicitActivation(liveContext: FastCalibrationRuntimeContextV1_2): void {
    if (this.status().phase !== "ready_for_explicit_activation") {
      throw new Error("Fast calibration is not ready for explicit activation.");
    }
    assertFastCalibrationRuntimeContextMatchV1_2(this.identity.runtimeContext, liveContext);
  }

  private sourceArtifactLedgerForEvents(events: FastCalibrationEventV1_2[]): Array<{
    operationId: string;
    role: FastCalibrationCaptureRoleV1_2;
    slot: number;
    channelIndex: number | null;
    sampleIndex: number;
    sha256: string;
    byteSize: number;
    active: boolean;
    supersedesOperationId?: string;
    pose?: FastCalibrationPoseV1_2;
  }> {
    const activePlacementOperationIds = new Set(
      [...activePlacements(events).values()].map((event) => event.operationId),
    );
    return acceptedEvents(events).map((event) => ({
      operationId: event.operationId,
      role: event.role,
      slot: event.slot,
      channelIndex: event.channelIndex,
      sampleIndex: event.sampleIndex,
      sha256: event.evidence.sha256,
      byteSize: event.evidence.byteSize,
      active: event.role !== "checkerboard_placement" || activePlacementOperationIds.has(event.operationId),
      ...(event.supersedesOperationId ? { supersedesOperationId: event.supersedesOperationId } : {}),
      ...(event.pose ? { pose: event.pose } : {}),
    }));
  }

  getSourceArtifactLedger(): ReturnType<
    FixedRigFastMathematicalCalibrationCoreV1_2["sourceArtifactLedgerForEvents"]
  > {
    return this.sourceArtifactLedgerForEvents(this.events);
  }

  auditProjection(): FastCalibrationAuditProjectionV1_2 {
    const activeOperationIds = new Set([...activePlacements(this.events).values()].map((event) => event.operationId));
    const acceptedPoseEvents = acceptedEvents(this.events).filter((event) => event.role === "checkerboard_placement");
    const supersededBy = new Map<string, string>();
    acceptedPoseEvents.forEach((event) => {
      if (event.supersedesOperationId) supersededBy.set(event.supersedesOperationId, event.operationId);
    });
    const failures = this.events.filter((event): event is FastCalibrationFailedEventV1_2 => event.type.endsWith("failed"));
    const actionForFailure = (event: FastCalibrationFailedEventV1_2): FastCalibrationNextActionV1_2["action"] => {
      if (event.type === "analysis_failed") return "analyze";
      if (event.type === "finalization_failed") return "finalize";
      if (event.role === "checkerboard_placement") return "capture_checkerboard";
      return "capture_photometric";
    };
    const latestAnalysis = [...this.events].reverse().find((event) =>
      event.type === "analysis_completed" || event.type === "analysis_failed");
    const latestFinalization = [...this.events].reverse().find((event) =>
      event.type === "finalization_completed" || event.type === "finalization_failed");
    const analysisCompleted = latestAnalysis?.type === "analysis_completed" ? latestAnalysis : undefined;
    const finalizationCompleted = latestFinalization?.type === "finalization_completed" ? latestFinalization : undefined;
    const accepted = acceptedEvents(this.events);
    return {
      revisionSha256: this.events.at(-1)?.eventSha256 ?? hashFastCalibrationCanonicalV1_2(this.identity),
      acceptedPoses: acceptedPoseEvents.map((event) => ({
        operationId: event.operationId,
        slot: event.slot,
        evidenceSha256: event.evidence.sha256,
        byteSize: event.evidence.byteSize,
        acceptedRevision: event.eventSha256,
        supersedesOperationId: event.supersedesOperationId ?? null,
        supersededByOperationId: supersededBy.get(event.operationId) ?? null,
        active: activeOperationIds.has(event.operationId),
        pose: event.pose!,
      })),
      failedAttempts: failures.map((event) => ({
        operationId: event.operationId,
        recordedRevision: event.eventSha256,
        action: actionForFailure(event),
        slot: event.slot,
        channelIndex: event.channelIndex,
        sampleIndex: event.sampleIndex,
        issue: event.error,
      })),
      blankReverseFlipCount: this.events.some((event) => event.type === "blank_reverse_flip_confirmed") ? 1 : 0,
      automaticSweep: {
        darkAccepted: accepted.filter((event) => event.role === "dark_control").length,
        flatFieldAccepted: accepted.filter((event) => event.role === "flat_field").length,
        illuminationPatternAccepted: accepted.filter((event) => event.role === "illumination_pattern").length,
        batchCleanupConfirmed: this.events.some((event) => event.type === "batch_cleanup_completed"),
      },
      analysis: {
        state: analysisCompleted ? "accepted" : latestAnalysis ? "failed" : "not_started",
        analysisSha256: analysisCompleted?.analysisSha256 ?? null,
        sourceManifestSha256: analysisCompleted?.sourceManifestSha256 ?? null,
        sourceArtifactLedgerSha256: analysisCompleted?.sourceArtifactLedgerSha256 ?? null,
        issues: latestAnalysis?.type === "analysis_failed" ? [latestAnalysis.error] : [],
      },
      finalization: {
        state: finalizationCompleted ? "completed" : latestFinalization ? "failed" : "not_started",
        bundleSha256: finalizationCompleted?.bundleSha256 ?? null,
        memberLedgerSha256: finalizationCompleted?.memberLedgerSha256 ?? null,
        analysisSha256: finalizationCompleted?.analysisSha256 ?? null,
        sourceArtifactLedgerSha256: finalizationCompleted?.sourceArtifactLedgerSha256 ?? null,
        memberCount: finalizationCompleted ? 12 : 0,
        issues: latestFinalization?.type === "finalization_failed" ? [latestFinalization.error] : [],
      },
    };
  }
}
