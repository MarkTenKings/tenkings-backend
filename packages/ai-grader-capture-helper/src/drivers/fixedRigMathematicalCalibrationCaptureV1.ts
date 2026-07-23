import crypto from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  detectAndNormalizeCardImage,
  normalizeCardImageWithGeometry,
  type CardGeometryMetadata,
  type CardGeometryNormalizationResult,
} from "./cardGeometry";
import {
  checkerboardGeometryMetadata,
  detectMathematicalCalibrationPreviewCheckerboard,
  type MathematicalCalibrationPreviewCheckerboard,
} from "./mathematicalCalibrationPreviewCheckerboard";
import {
  MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_MANIFEST_SCHEMA,
  MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_PACKAGE_SCHEMA,
  MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_PROFILE,
  MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_SESSION_SCHEMA,
  MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST,
  MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_HASH,
  MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_ID,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} from "@tenkings/shared";
import type { MathematicalCalibrationV1_1Pose } from "./fixedRigMathematicalCalibrationV1_1";
import {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PACKAGE_V1,
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
} from "./fixedRigMathematicalCalibrationCaptureContractV1";

export {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PACKAGE_V1,
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
} from "./fixedRigMathematicalCalibrationCaptureContractV1";

export const FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_SESSION_V1 =
  "ten-kings-mathematical-calibration-capture-session-v1" as const;
export const FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_MANIFEST_V1 =
  "ten-kings-mathematical-calibration-capture-manifest-v1" as const;
export const FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1_1 =
  MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_PROFILE;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MEASUREMENT_CLASSES = [
  "linear_mm",
  "area_mm2",
  "relief_index",
  "roughness_index",
  "color_delta_e",
] as const;
const CAPTURE_ROLES = [
  "lens_geometry",
  "normalization_registration",
  "repeated_placement",
  "checkerboard_placement",
  "flat_field",
  "dark_control",
  "illumination_pattern",
] as const;

const BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_V1 = {
  recoveryId: "blank-reverse-geometry-timestamp-false-stop-20260722-v1",
  sessionId: "math-cal-v1-20260722-4cfa410c-01",
  expectedPreStateSha256: "f9defc6bf72f88ae8b34c922cf84abbdbdcbcc778c09ae10bf0dbff07b401726",
  operationId: "cal-capture-3690b0b8c44a4dabaebe6a2705e5f14a",
  reason: "Accepted blank-reverse geometry record does not reproduce its immutable accepted pose and detection authority.",
  pendingSlotKey: "dark_control:1:3",
  acceptedCaptureCount: 32,
  acceptedArtifactCount: 64,
} as const;

const BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_RECEIPT_V1 =
  "ten-kings-mathematical-calibration-blank-reverse-timestamp-false-stop-recovery-receipt-v1" as const;
const BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_STATE_V1 =
  "ten-kings-mathematical-calibration-blank-reverse-timestamp-false-stop-recovery-state-v1" as const;

const ANALYZER_AUTHORITY_REBIND_INCIDENT_V1 = {
  rebindId: "sealed-analyzer-authority-rebind-20260722-v1",
  sessionId: "math-cal-v1-20260722-4cfa410c-01",
  expectedPreStateSha256: "72dace5828ac13fefd1a67ea738eafe11e54f5478c15eba4dd3c9d9326fa7a1f",
  oldAnalyzerSha256: "8cee9c2d3a9829fe196982616dcdb33b3872ce5dd2f15dd2e99cf9d08e21384b",
  correctedAnalyzerSha256: "7d9d15992b8ba2f7bedcfcb137ce3431a33d3ce708d4925e81ea95e9eb0a7439",
  oldCaptureManifestSha256: "43765b77888c0185a3189895a74c9d1305699d1be8103a58d0697df5288cd8c9",
  oldSourcePackageSha256: "27bd94d8e3b72bf7e77dc891eb7da0d395a7d051addf546280a7b938a0328321",
  captureCount: 102,
  captureArtifactCount: 204,
  authorityCount: 78,
  analyzerAuthorityCount: 74,
  protectedTargetAuthorityCount: 4,
  failureCount: 2,
  manifestReferenceCount: 182,
  reboundManifestReferenceCount: 183,
} as const;

const ANALYZER_AUTHORITY_REBIND_RECEIPT_V1 =
  "ten-kings-mathematical-calibration-analyzer-authority-rebind-receipt-v1" as const;
const ANALYZER_AUTHORITY_SUPERSEDED_LEDGER_V1 =
  "ten-kings-mathematical-calibration-superseded-analyzer-authority-ledger-v1" as const;
const ANALYZER_AUTHORITY_REBIND_JOURNAL_V1 =
  "ten-kings-mathematical-calibration-analyzer-authority-rebind-journal-v1" as const;

interface PreservedIncidentFileV1 {
  originalPath: string;
  preservedPath: string;
  sha256: string;
  byteSize: number;
}

interface SupersededSealedEnvelopeV1 {
  captureSession: PreservedIncidentFileV1;
  sourceCapturePackage: PreservedIncidentFileV1;
  captureManifest: PreservedIncidentFileV1;
  sealEvent: PreservedIncidentFileV1;
}

interface AnalyzerAuthoritySupersessionLedgerReferenceV1 {
  schemaVersion: typeof ANALYZER_AUTHORITY_SUPERSEDED_LEDGER_V1;
  rebindId: string;
  path: string;
  sha256: string;
  byteSize: number;
}

interface AnalyzerAuthorityRebindJournalV1 {
  schemaVersion: typeof ANALYZER_AUTHORITY_REBIND_JOURNAL_V1;
  rebindId: string;
  sessionId: string;
  expectedPreStateSha256: string;
  oldAnalyzerSha256: string;
  correctedAnalyzerSha256: string;
  oldCaptureManifestSha256: string;
  oldSourcePackageSha256: string;
  expectedInstalledStateSha256: string;
  expectedReceiptSha256: string;
}

export type FixedRigMathematicalCalibrationCaptureRoleV1 = (typeof CAPTURE_ROLES)[number];
export type FixedRigMathematicalCalibrationMeasurementClassV1 = (typeof MEASUREMENT_CLASSES)[number];
export type FixedRigMathematicalCalibrationTargetFaceV1 = "checkerboard" | "blank_reverse";

export interface FixedRigMathematicalCalibrationProtectedSettingsV1 {
  stationId: string;
  rigId: string;
  captureProfileVersion: typeof FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1 | typeof FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1_1;
  cameraIndex: number;
  exposureUs: number;
  gain: number;
  dutyPercent: number;
  leimacUnit: number;
  selectedChannels: readonly [1, 2, 3, 4, 5, 6, 7, 8];
  normalizedWidthPx: number;
  normalizedHeightPx: number;
  checkerboard: {
    internalColumns: number;
    internalRows: number;
    cellMm: number;
  };
}

export interface FixedRigMathematicalCalibrationCaptureBoundaryRequestV1 {
  sessionId: string;
  operationId: string;
  outputDir: string;
  label: string;
  role: FixedRigMathematicalCalibrationCaptureRoleV1;
  sampleIndex: number;
  channelIndex?: number;
  targetFace: FixedRigMathematicalCalibrationTargetFaceV1;
  protectedSettings: FixedRigMathematicalCalibrationProtectedSettingsV1;
  lighting: {
    mode: "safe_off" | "all_channels" | "single_channel";
    enabledChannels: number[];
    dutyPercent: number;
  };
}

export interface FixedRigMathematicalCalibrationCaptureBoundaryResultV1 {
  rawBytes: Buffer;
  mimeType: "image/png" | "image/tiff";
  imageWidth: number;
  imageHeight: number;
  capturedAt: string;
  camera: {
    serialNumber: string;
    modelName: string;
    transport: "GigE";
    sourcePixelFormat: string;
    savedImageFormat: "PNG" | "TIFF";
    exposureUs: number;
    gain: number;
  };
  pylon: {
    version: string;
    bridgeVersion: string;
  };
  leimac: {
    unit: number;
    dutyPercent: number;
    enabledChannels: number[];
    expectedWriteCount: number;
    acknowledgedWriteCount: number;
    responseKinds: string[];
    complete: true;
  };
  safeOff: {
    beforeCaptureConfirmed: true;
    afterCaptureConfirmed: true;
    confirmedAt: string;
  };
}

export interface FixedRigMathematicalCalibrationNormalizerInputV1 {
  sourceImagePath: string;
  workingOutputPath: string;
  capturedAt: string;
  sourceImageId: string;
  reusableGeometry?: CardGeometryMetadata;
}

export type FixedRigMathematicalCalibrationNormalizerV1 = (
  input: FixedRigMathematicalCalibrationNormalizerInputV1,
) => Promise<CardGeometryNormalizationResult>;

export interface FixedRigMathematicalCalibrationCaptureProducerConfigV1 {
  outputRoot: string;
  targetPath: string;
  targetVersion: string;
  targetSha256: string;
  protectedSettings: FixedRigMathematicalCalibrationProtectedSettingsV1;
  capture: (
    input: FixedRigMathematicalCalibrationCaptureBoundaryRequestV1,
  ) => Promise<FixedRigMathematicalCalibrationCaptureBoundaryResultV1>;
  normalize?: FixedRigMathematicalCalibrationNormalizerV1;
  detectCheckerboard?: (imageBuffer: Buffer) => Promise<MathematicalCalibrationPreviewCheckerboard>;
  now?: () => Date;
  contractVersion?: "v1.0.1" | "v1.1";
  deriveAnalyzerAuthorityRebindRequests?: (
    sessionDir: string,
  ) => Promise<RecordFixedRigMathematicalCalibrationMeasurementV1Request[]>;
}

export interface StartFixedRigMathematicalCalibrationCaptureV1Request {
  sessionId: string;
  operatorId: string;
  targetVersion: string;
  targetSha256: string;
  resume?: boolean;
}

export interface CaptureFixedRigMathematicalCalibrationStepV1Request {
  sessionId: string;
  operationId: string;
  captureAuthorizationId?: string;
  role: FixedRigMathematicalCalibrationCaptureRoleV1;
  sampleIndex: number;
  channelIndex?: number;
  targetFace: FixedRigMathematicalCalibrationTargetFaceV1;
  normalizationSourceOperationId?: string;
  removeReseatCycleId?: string;
  previewBinding?: {
    sessionId: string;
    epoch: string;
    frameId: string;
    capturedAt: string;
  };
}

interface FixedRigMathematicalCalibrationCertifiedInstrumentV1 {
  instrumentId: string;
  kind: "traceable_ruler" | "caliper" | "fixed_rig_geometry";
  calibrationVersion: string;
  calibrationSha256: string;
}

interface FixedRigMathematicalCalibrationProtectedTargetGeometryV1 {
  instrumentId: "protected-calibration-target-geometry-v1";
  kind: "protected_target_geometry";
  targetVersion: string;
  targetSha256: string;
  authorityStatement: "product_owner_confirmed_exact_target_geometry_v1";
}

export type FixedRigMathematicalCalibrationInstrumentV1 =
  | FixedRigMathematicalCalibrationCertifiedInstrumentV1
  | FixedRigMathematicalCalibrationProtectedTargetGeometryV1;

export type RecordFixedRigMathematicalCalibrationMeasurementV1Request =
  | {
      sessionId: string;
      operationId: string;
      measurementType: "print_scale";
      axis: "x" | "y";
      protectedSpanMm: number;
      authorityBasis: "protected_checkerboard_geometry";
      measurementMethod: "protected_checkerboard_geometry_authority_v1";
      sourceTargetEvidenceId: "print-verified-calibration-target";
      instrument: FixedRigMathematicalCalibrationProtectedTargetGeometryV1;
    }
  | {
      sessionId: string;
      operationId: string;
      measurementType: "print_scale";
      axis: "x" | "y";
      nominalSpanMm: number;
      measuredSpanMm: number;
      measurementU95Mm: number;
      measurementMethod: string;
      sourceMetrologyArtifactSha256: string;
      instrument: FixedRigMathematicalCalibrationInstrumentV1;
    }
  | {
      sessionId: string;
      operationId: string;
      measurementType: "target_cut_dimension";
      axis: "x" | "y";
      protectedDimensionMm: number;
      authorityBasis: "protected_checkerboard_geometry";
      measurementMethod: "protected_checkerboard_geometry_authority_v1";
      sourceTargetEvidenceId: "print-verified-calibration-target";
      instrument: FixedRigMathematicalCalibrationProtectedTargetGeometryV1;
    }
  | {
      sessionId: string;
      operationId: string;
      measurementType: "target_cut_dimension";
      axis: "x" | "y";
      nominalDimensionMm: number;
      measuredDimensionMm: number;
      measurementU95Mm: number;
      measurementMethod: string;
      sourceMetrologyArtifactSha256: string;
      instrument: FixedRigMathematicalCalibrationInstrumentV1;
    }
  | {
      sessionId: string;
      operationId: string;
      measurementType: "direction_geometry";
      channelIndex: number;
      sampleIndex: number;
      sourcePointMm: { x: number; y: number };
      cardCenterPointMm: { x: number; y: number };
      pointU95Mm: number;
      sourceCaptureOperationId: string;
      sourceEvidenceId: string;
      sourceSha256: string;
      measurementAlgorithmVersion: "opencv_illumination_centroid_checkerboard_v1";
      measurementMethod: "illumination_centroid_checkerboard_repeatability_v1";
      instrument: FixedRigMathematicalCalibrationCertifiedInstrumentV1;
    }
  | {
      sessionId: string;
      operationId: string;
      measurementType: "direction_geometry";
      channelIndex: number;
      sampleIndex: number;
      sourcePointMm: { x: number; y: number };
      cardCenterPointMm: { x: number; y: number };
      pointU95Mm: number;
      measurementMethod: string;
      sourceMetrologyArtifactSha256: string;
      instrument: FixedRigMathematicalCalibrationInstrumentV1;
    }
  | {
      sessionId: string;
      operationId: string;
      measurementType: "measurement_repeatability";
      measurementClass: FixedRigMathematicalCalibrationMeasurementClassV1;
      sampleIndex: number;
      referenceFeatureId: string;
      measuredValue: number;
      sourceCaptureOperationId: string;
      measurementAlgorithmVersion: "opencv_checkerboard_repeatability_measurement_v1" | "opencv_checkerboard_repeatability_measurement_v1.1";
      measurementMethod: string;
      instrument: FixedRigMathematicalCalibrationInstrumentV1;
    };

export interface SealFixedRigMathematicalCalibrationCaptureV1Request {
  sessionId: string;
  operationId: string;
  profileId: string;
  calibrationVersion: string;
  artifactId: string;
}

interface CaptureArtifactV1 {
  evidenceId: string;
  path: string;
  sha256: string;
  role: string;
  artifactClass: "raw_capture" | "normalized_derivative" | "measurement" | "target";
  rigId: string;
  captureProfileVersion: string;
  subjectDesignation: "calibration_target";
  productionCard: false;
  operationId: string;
  capturedAt: string;
  channelIndex: number | null;
  targetFace?: FixedRigMathematicalCalibrationTargetFaceV1;
  removeReseatCycleId?: string;
  byteSize: number;
  mediaType: string;
  parentEvidenceId?: string;
  parentSha256?: string;
  camera?: FixedRigMathematicalCalibrationCaptureBoundaryResultV1["camera"];
  pylon?: FixedRigMathematicalCalibrationCaptureBoundaryResultV1["pylon"];
  leimac?: FixedRigMathematicalCalibrationCaptureBoundaryResultV1["leimac"];
  safeOff?: FixedRigMathematicalCalibrationCaptureBoundaryResultV1["safeOff"];
  normalization?: {
    algorithmVersion: string;
    sourceSha256: string;
    coordinateFrame: "normalized_card_portrait_pixels";
    widthPx: number;
    heightPx: number;
    geometricResamplingApplied: boolean;
    sourceCropWidth: number;
    sourceCropHeight: number;
    scaleX: number;
    scaleY: number;
    deskewAppliedDegrees: number;
    geometryAuthority?: {
      kind: "same_session_accepted_blank_reverse_v1";
      sourceSessionId: string;
      sourceOperationId: string;
      sourceRawEvidenceId: string;
      sourceRawSha256: string;
      sourceNormalizedEvidenceId: string;
      sourceNormalizedSha256: string;
      sourceGeometrySha256: string;
    };
  };
  pose?: {
    centerXFraction: number;
    centerYFraction: number;
    coverageFraction: number;
    rotationDegrees: number;
    cornerSignature: number[];
  };
}

interface CaptureRecordV1 {
  operationId: string;
  role: FixedRigMathematicalCalibrationCaptureRoleV1;
  sampleIndex: number;
  channelIndex?: number;
  targetFace: FixedRigMathematicalCalibrationTargetFaceV1;
  capturedAt: string;
  removeReseatCycleId?: string;
  rawEvidenceId: string;
  normalizedEvidenceId: string;
  completedAt: string;
}

export interface FixedRigMathematicalCalibrationPoseV1 {
  centerXFraction: number;
  centerYFraction: number;
  coverageFraction: number;
  rotationDegrees: number;
  cornerSignature: number[];
}

export interface FixedRigMathematicalCalibrationAggregateV1 {
  x: number;
  y: number;
  rotationDegrees: number;
}

interface FailedCaptureOperationV1 {
  operationId: string;
  failedAt: string;
  error: string;
  role?: FixedRigMathematicalCalibrationCaptureRoleV1;
  sampleIndex?: number;
  channelIndex?: number;
  targetFace?: FixedRigMathematicalCalibrationTargetFaceV1;
  slotKey?: string;
  candidateRawSha256?: string;
  candidateCapturedAt?: string;
  candidatePose?: FixedRigMathematicalCalibrationPoseV1;
  prospectiveAggregate?: FixedRigMathematicalCalibrationAggregateV1;
}

interface BlankReverseTimestampFalseStopRecoveryStateV1 {
  schemaVersion: typeof BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_STATE_V1;
  recoveryId: string;
  recoveredAt: string;
  preRecoveryStateSha256: string;
  receiptPath: string;
  receiptSha256: string;
  recoveredHardStop: { operationId: string; stoppedAt: string; reason: string };
  preservedFailedOperation: FailedCaptureOperationV1;
  pendingSlotKey: string;
  acceptedCaptureCount: number;
  acceptedArtifactCount: number;
}

interface BlankReverseTimestampFalseStopRecoveryReceiptV1 {
  schemaVersion: typeof BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_RECEIPT_V1;
  recoveryId: string;
  recoveredAt: string;
  preRecoveryStateSha256: string;
  sessionId: string;
  recoveredHardStop: { operationId: string; stoppedAt: string; reason: string };
  preservedFailedOperation: FailedCaptureOperationV1;
  pendingSlotKey: string;
  acceptedEvidence: {
    captureCount: number;
    artifactCount: number;
    capturesSha256: string;
    artifactsSha256: string;
    eventsSha256: string;
  };
  verifiedBlankReverseAuthority: VerifiedBlankReverseGeometryAuthorityV1["provenance"];
}

interface AnalyzerAuthorityRebindStateV1 {
  schemaVersion: typeof ANALYZER_AUTHORITY_REBIND_RECEIPT_V1;
  rebindId: string;
  reboundAt: string;
  oldAnalyzerSha256: string;
  correctedAnalyzerSha256: string;
  preStateSha256: string;
  oldCaptureManifestSha256: string;
  oldSourcePackageSha256: string;
  newCaptureManifestSha256: string;
  newSourcePackageSha256: string;
  supersededAuthorityLedgerPath: string;
  supersededAuthorityLedgerSha256: string;
  supersededEnvelope: SupersededSealedEnvelopeV1;
  receiptPath: string;
  receiptSha256: string;
}

type AnalyzerAuthorityRebindReceiptV1 = Omit<AnalyzerAuthorityRebindStateV1, "receiptSha256"> & {
  sessionId: string;
  preservedEvidence: {
    capturesSha256: string;
    captureArtifactsSha256: string;
    captureEventsSha256: string;
    failuresSha256: string;
    protectedTargetAuthoritySha256: string;
    protectedTargetArtifactsSha256: string;
    protectedTargetEventsSha256: string;
  };
  correctedAuthority: {
    count: number;
    recordsSha256: string;
    artifactsSha256: string;
  };
  sealOperationId: string;
};

interface MeasurementRecordV1 {
  operationId: string;
  measurementType: RecordFixedRigMathematicalCalibrationMeasurementV1Request["measurementType"];
  evidenceId: string;
  recordedAt: string;
  payload: Record<string, unknown>;
}

interface CaptureSessionStateV1 {
  schemaVersion: typeof FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_SESSION_V1 | typeof MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_SESSION_SCHEMA;
  sessionId: string;
  operatorId: string;
  packageId: string;
  purpose: "mathematical_calibration_v1" | "mathematical_calibration_v1.1";
  subject: {
    designation: "calibration_target";
    productionCard: false;
    targetVersion: string;
    targetSha256: string;
  };
  createdAt: string;
  updatedAt: string;
  sealedAt?: string;
  protectedSettings: FixedRigMathematicalCalibrationProtectedSettingsV1;
  evidenceDerivedAuthority: {
    thresholdSetId: string;
    thresholdSetHash: string;
    uncertaintyCoverageFactor: number;
  };
  artifacts: CaptureArtifactV1[];
  captures: CaptureRecordV1[];
  measurements: MeasurementRecordV1[];
  failedOperations: FailedCaptureOperationV1[];
  hardStop?: { operationId: string; stoppedAt: string; reason: string };
  recoveryReceipts?: BlankReverseTimestampFalseStopRecoveryStateV1[];
  analyzerAuthorityRebind?: AnalyzerAuthorityRebindStateV1;
  blankReverseFlipRecorded?: boolean;
}

interface VerifiedBlankReverseGeometryAuthorityV1 {
  geometry: CardGeometryMetadata;
  fingerprint: string;
  provenance: NonNullable<NonNullable<CaptureArtifactV1["normalization"]>["geometryAuthority"]>;
}

export interface FixedRigMathematicalCalibrationCaptureSlotV1 {
  role: FixedRigMathematicalCalibrationCaptureRoleV1;
  sampleIndex: number;
  channelIndex: number | null;
  targetFace: FixedRigMathematicalCalibrationTargetFaceV1;
  slotKey: string;
}

export interface FixedRigMathematicalCalibrationPoseProgressV1 {
  role: "lens_geometry" | "normalization_registration";
  acceptedCount: number;
  requiredCount: 10;
  currentAggregate: FixedRigMathematicalCalibrationAggregateV1;
  minimumCoverageFraction: number;
  requiredAggregate: FixedRigMathematicalCalibrationAggregateV1;
  aggregateSatisfied: boolean;
}

export interface FixedRigMathematicalCalibrationCaptureSessionStatusV1 {
  schemaVersion: typeof FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_SESSION_V1 | typeof MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_SESSION_SCHEMA;
  sessionId: string;
  packageId: string;
  operatorId: string;
  sealed: boolean;
  captureCount: number;
  measurementCount: number;
  failedOperationCount: number;
  sessionStateSha256: string;
  nextCaptureSlot: FixedRigMathematicalCalibrationCaptureSlotV1 | null;
  retryAllowed: boolean;
  hardStop: { operationId: string; stoppedAt: string; reason: string } | null;
  poseProgress: FixedRigMathematicalCalibrationPoseProgressV1[];
  acceptedCaptureHistory: Array<{
    operationId: string;
    role: FixedRigMathematicalCalibrationCaptureRoleV1;
    sampleIndex: number;
    channelIndex: number | null;
    slotKey: string;
    capturedAt: string;
    rawEvidenceId: string;
    rawSha256: string;
    normalizedEvidenceId: string;
    normalizedSha256: string;
    pose: FixedRigMathematicalCalibrationPoseV1 | null;
  }>;
  failedAttempts: Array<{
    operationId: string;
    failedAt: string;
    error: string;
    role: FixedRigMathematicalCalibrationCaptureRoleV1 | null;
    sampleIndex: number | null;
    channelIndex: number | null;
    slotKey: string | null;
    candidateRawSha256: string | null;
    candidateCapturedAt: string | null;
    candidatePose: FixedRigMathematicalCalibrationPoseV1 | null;
    prospectiveAggregate: FixedRigMathematicalCalibrationAggregateV1 | null;
  }>;
  sessionDir: string;
  packageManifestPath?: string;
  captureManifestPath?: string;
}

export interface SealedFixedRigMathematicalCalibrationCaptureV1 {
  status: FixedRigMathematicalCalibrationCaptureSessionStatusV1;
  sourceCapturePackage: {
    packageId: string;
    path: string;
    sha256: string;
  };
  captureManifest: {
    path: string;
    sha256: string;
  };
}

export interface FixedRigMathematicalCalibrationFalseStopRecoveryV1 {
  status: FixedRigMathematicalCalibrationCaptureSessionStatusV1;
  recovery: BlankReverseTimestampFalseStopRecoveryStateV1;
  idempotent: boolean;
}

export interface FixedRigMathematicalCalibrationAnalyzerAuthorityRebindV1 {
  status: FixedRigMathematicalCalibrationCaptureSessionStatusV1;
  receipt: AnalyzerAuthorityRebindReceiptV1;
  idempotent: boolean;
}

function assertSafeId(value: unknown, name: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${name} must be a safe non-empty identifier.`);
  return value;
}

function assertSha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${name} must be an exact lowercase SHA-256.`);
  return value;
}

function finite(value: unknown, name: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    throw new Error(`${name} must be a finite number${minimum !== undefined ? ` >= ${minimum}` : ""}.`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, candidate]) => candidate !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, candidate]) => [key, canonical(candidate)]),
    );
  }
  return value;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf-8");
}

function hash(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function portable(...segments: string[]): string {
  return segments.join("/");
}

function safeSegment(value: string): string {
  return value.replace(/:/g, "-");
}

function captureRole(input: Pick<CaptureFixedRigMathematicalCalibrationStepV1Request, "role" | "channelIndex">): string {
  if (input.role === "flat_field") return `flat_field_channel_${input.channelIndex}`;
  if (input.role === "dark_control") return `dark_control_channel_${input.channelIndex}`;
  if (input.role === "illumination_pattern") return `illumination_pattern_channel_${input.channelIndex}`;
  if (input.role === "checkerboard_placement") return "checkerboard_placement";
  return input.role;
}

function analysisUsesRaw(role: FixedRigMathematicalCalibrationCaptureRoleV1): boolean {
  return role === "lens_geometry" || role === "normalization_registration" || role === "repeated_placement" || role === "checkerboard_placement";
}

function isBlankReversePhotometricRole(
  role: FixedRigMathematicalCalibrationCaptureRoleV1,
): role is "flat_field" | "dark_control" | "illumination_pattern" {
  return role === "flat_field" || role === "dark_control" || role === "illumination_pattern";
}

function lightingFor(
  input: Pick<CaptureFixedRigMathematicalCalibrationStepV1Request, "role" | "channelIndex">,
  settings: FixedRigMathematicalCalibrationProtectedSettingsV1,
): FixedRigMathematicalCalibrationCaptureBoundaryRequestV1["lighting"] {
  if (input.role === "dark_control") return { mode: "safe_off", enabledChannels: [], dutyPercent: 0 };
  if (input.channelIndex !== undefined) {
    return { mode: "single_channel", enabledChannels: [input.channelIndex], dutyPercent: settings.dutyPercent };
  }
  return { mode: "all_channels", enabledChannels: [...settings.selectedChannels], dutyPercent: settings.dutyPercent };
}

function captureKey(input: Pick<CaptureRecordV1, "role" | "sampleIndex" | "channelIndex">): string {
  return `${input.role}:${input.channelIndex ?? "none"}:${input.sampleIndex}`;
}

function capturePlan(contractVersion: "v1.0.1" | "v1.1"): FixedRigMathematicalCalibrationCaptureSlotV1[] {
  const plan: FixedRigMathematicalCalibrationCaptureSlotV1[] = [];
  if (contractVersion === "v1.1") {
    for (let sampleIndex = 1; sampleIndex <= 4; sampleIndex += 1) {
      plan.push({
        role: "checkerboard_placement",
        sampleIndex,
        channelIndex: null,
        targetFace: "checkerboard",
        slotKey: `checkerboard_placement:none:${sampleIndex}`,
      });
    }
  } else {
    for (const role of ["lens_geometry", "normalization_registration", "repeated_placement"] as const) {
      for (let sampleIndex = 1; sampleIndex <= 10; sampleIndex += 1) {
        plan.push({ role, sampleIndex, channelIndex: null, targetFace: "checkerboard", slotKey: `${role}:none:${sampleIndex}` });
      }
    }
  }
  for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
    for (const role of ["dark_control", "flat_field", "illumination_pattern"] as const) {
      for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
        plan.push({
          role,
          sampleIndex,
          channelIndex,
          targetFace: "blank_reverse",
          slotKey: `${role}:${channelIndex}:${sampleIndex}`,
        });
      }
    }
  }
  return plan;
}

function aggregateFor(poses: readonly FixedRigMathematicalCalibrationPoseV1[]): FixedRigMathematicalCalibrationAggregateV1 {
  if (poses.length === 0) return { x: 0, y: 0, rotationDegrees: 0 };
  const span = (values: readonly number[]) => Number((Math.max(...values) - Math.min(...values)).toFixed(6));
  return {
    x: span(poses.map((pose) => pose.centerXFraction)),
    y: span(poses.map((pose) => pose.centerYFraction)),
    rotationDegrees: span(poses.map((pose) => pose.rotationDegrees)),
  };
}

function acceptedPosesFor(
  state: CaptureSessionStateV1,
  role: "lens_geometry" | "normalization_registration",
): FixedRigMathematicalCalibrationPoseV1[] {
  return state.artifacts
    .filter((artifact) => artifact.artifactClass === "raw_capture" && artifact.role === role && artifact.pose)
    .map((artifact) => artifact.pose!);
}

function aggregateMeets(
  observed: FixedRigMathematicalCalibrationAggregateV1,
  required: FixedRigMathematicalCalibrationAggregateV1,
): boolean {
  return observed.x >= required.x && observed.y >= required.y && observed.rotationDegrees >= required.rotationDegrees;
}

class FixedRigMathematicalCalibrationHardStopV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixedRigMathematicalCalibrationHardStopV1";
  }
}

function hardStop(message: string): never {
  throw new FixedRigMathematicalCalibrationHardStopV1(message);
}

const UTC_CAPTURE_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const ECMASCRIPT_MILLISECOND_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function canonicalEcmaTimestampForCapturedAt(value: unknown): string {
  if (typeof value !== "string") {
    hardStop("Accepted blank-reverse source capturedAt is not a valid UTC timestamp.");
  }
  const match = UTC_CAPTURE_TIMESTAMP.exec(value);
  const parsed = new Date(value);
  if (!match || !Number.isFinite(parsed.getTime())) {
    hardStop("Accepted blank-reverse source capturedAt is not a valid UTC timestamp.");
  }
  const expectedUtcFields = match.slice(1, 7).map(Number);
  const observedUtcFields = [
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
    parsed.getUTCHours(),
    parsed.getUTCMinutes(),
    parsed.getUTCSeconds(),
  ];
  if (expectedUtcFields.some((field, index) => field !== observedUtcFields[index])) {
    hardStop("Accepted blank-reverse source capturedAt is not a valid UTC timestamp.");
  }
  return parsed.toISOString();
}

function assertCanonicalGeometryTimestamp(geometryTimestamp: unknown, sourceCapturedAt: unknown): void {
  const expected = canonicalEcmaTimestampForCapturedAt(sourceCapturedAt);
  if (
    typeof geometryTimestamp !== "string" ||
    !ECMASCRIPT_MILLISECOND_TIMESTAMP.test(geometryTimestamp) ||
    !Number.isFinite(new Date(geometryTimestamp).getTime()) ||
    new Date(geometryTimestamp).toISOString() !== geometryTimestamp ||
    geometryTimestamp !== expected
  ) {
    hardStop("Accepted blank-reverse geometry timestamp is not the exact canonical millisecond timestamp for its immutable source capture.");
  }
}

function posePolicyForV1(role: "lens_geometry" | "normalization_registration") {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.captureEvidence.poseDiversity;
  return {
    minimumCoverageFraction: policy.minimumDetectedTargetCoverageFractionPerView,
    requiredAggregate: role === "lens_geometry"
      ? {
          x: policy.geometry.minimumNormalizedCenterSpanX,
          y: policy.geometry.minimumNormalizedCenterSpanY,
          rotationDegrees: policy.geometry.minimumRotationSpanDegrees,
        }
      : {
          x: policy.normalization.minimumNormalizedCenterSpanX,
          y: policy.normalization.minimumNormalizedCenterSpanY,
          rotationDegrees: policy.normalization.minimumRotationSpanDegrees,
        },
  };
}

function measurementKey(record: MeasurementRecordV1): string {
  const payload = record.payload;
  switch (record.measurementType) {
    case "print_scale":
    case "target_cut_dimension":
      return `${record.measurementType}:${String(payload.axis)}`;
    case "direction_geometry":
      return `${record.measurementType}:${String(payload.channelIndex)}:${String(payload.sampleIndex)}`;
    case "measurement_repeatability":
      return `${record.measurementType}:${String(payload.measurementClass)}:${String(payload.sampleIndex)}`;
  }
}

async function writeExclusive(filePath: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes, { flag: "wx" });
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, canonicalBytes(value), { flag: "wx" });
  await rename(temporary, filePath);
}

function statusFor(state: CaptureSessionStateV1, sessionDir: string): FixedRigMathematicalCalibrationCaptureSessionStatusV1 {
  const packagePath = path.join(sessionDir, "source-capture-package.json");
  const manifestPath = path.join(sessionDir, "capture-manifest.json");
  const contractVersion = state.schemaVersion === MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_SESSION_SCHEMA ? "v1.1" : "v1.0.1";
  const completedKeys = new Set(state.captures.map(captureKey));
  const nextCaptureSlot = capturePlan(contractVersion).find((slot) => !completedKeys.has(slot.slotKey)) ?? null;
  const posePolicy = (contractVersion === "v1.1" ? MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST)
    .calibrationAcceptance.captureEvidence.poseDiversity;
  const poseProgress = contractVersion === "v1.0.1"
    ? (["lens_geometry", "normalization_registration"] as const).map((role): FixedRigMathematicalCalibrationPoseProgressV1 => {
        const poses = acceptedPosesFor(state, role);
        const rolePolicy = role === "lens_geometry" ? posePolicy.geometry : posePolicy.normalization;
        const requiredAggregate = {
          x: rolePolicy.minimumNormalizedCenterSpanX,
          y: rolePolicy.minimumNormalizedCenterSpanY,
          rotationDegrees: rolePolicy.minimumRotationSpanDegrees,
        };
        const currentAggregate = aggregateFor(poses);
        return {
          role,
          acceptedCount: poses.length,
          requiredCount: 10,
          currentAggregate,
          minimumCoverageFraction: posePolicy.minimumDetectedTargetCoverageFractionPerView,
          requiredAggregate,
          aggregateSatisfied: poses.length === 10 && aggregateMeets(currentAggregate, requiredAggregate),
        };
      })
    : [];
  const acceptedCaptureHistory = state.captures.map((capture) => {
    const raw = state.artifacts.find((artifact) => artifact.evidenceId === capture.rawEvidenceId);
    const normalized = state.artifacts.find((artifact) => artifact.evidenceId === capture.normalizedEvidenceId);
    if (!raw || !normalized) throw new Error(`Calibration capture ${capture.operationId} has incomplete immutable artifact authority.`);
    return {
      operationId: capture.operationId,
      role: capture.role,
      sampleIndex: capture.sampleIndex,
      channelIndex: capture.channelIndex ?? null,
      slotKey: captureKey(capture),
      capturedAt: capture.capturedAt,
      rawEvidenceId: capture.rawEvidenceId,
      rawSha256: raw.sha256,
      normalizedEvidenceId: capture.normalizedEvidenceId,
      normalizedSha256: normalized.sha256,
      pose: raw.pose ?? null,
    };
  });
  const failedAttempts = state.failedOperations.map((failure) => ({
    operationId: failure.operationId,
    failedAt: failure.failedAt,
    error: failure.error,
    role: failure.role ?? null,
    sampleIndex: failure.sampleIndex ?? null,
    channelIndex: failure.channelIndex ?? null,
    slotKey: failure.slotKey ?? null,
    candidateRawSha256: failure.candidateRawSha256 ?? null,
    candidateCapturedAt: failure.candidateCapturedAt ?? null,
    candidatePose: failure.candidatePose ?? null,
    prospectiveAggregate: failure.prospectiveAggregate ?? null,
  }));
  const retryAllowed = Boolean(
    !state.hardStop && nextCaptureSlot && [...state.failedOperations].reverse().some((failure) => failure.slotKey === nextCaptureSlot.slotKey),
  );
  return {
    schemaVersion: state.schemaVersion,
    sessionId: state.sessionId,
    packageId: state.packageId,
    operatorId: state.operatorId,
    sealed: Boolean(state.sealedAt),
    captureCount: state.captures.length,
    measurementCount: state.measurements.length,
    failedOperationCount: state.failedOperations.length,
    sessionStateSha256: hash(canonicalBytes(state)),
    nextCaptureSlot,
    retryAllowed,
    hardStop: state.hardStop ?? null,
    poseProgress,
    acceptedCaptureHistory,
    failedAttempts,
    sessionDir,
    ...(existsSync(packagePath) ? { packageManifestPath: packagePath } : {}),
    ...(existsSync(manifestPath) ? { captureManifestPath: manifestPath } : {}),
  };
}

async function defaultNormalizer(input: FixedRigMathematicalCalibrationNormalizerInputV1) {
  if (input.reusableGeometry) {
    return normalizeCardImageWithGeometry({
      sourceImagePath: input.sourceImagePath,
      normalizedOutputPath: input.workingOutputPath,
      geometry: input.reusableGeometry,
    });
  }
  return detectAndNormalizeCardImage({
    sourceImagePath: input.sourceImagePath,
    normalizedOutputPath: input.workingOutputPath,
    detectionPolicy: "captured_evidence_full",
    side: "front",
    sourceImageId: input.sourceImageId,
    sourceFrameId: input.sourceImageId,
    timestamp: input.capturedAt,
  });
}

function poseFromGeometry(geometry: CardGeometryMetadata) {
  if (!geometry.corners || geometry.rotationDegrees == null) {
    throw new Error("Calibration capture requires automatically detected target geometry for immutable pose provenance.");
  }
  const imageWidth = geometry.image?.width;
  const imageHeight = geometry.image?.height;
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    !Number.isFinite(geometry.rotationDegrees)
  ) {
    throw new Error("Calibration capture requires finite positive source-frame geometry and rotation.");
  }
  const corners = [
    geometry.corners.topLeft,
    geometry.corners.topRight,
    geometry.corners.bottomRight,
    geometry.corners.bottomLeft,
  ];
  if (corners.some((point) =>
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x <= 0 ||
    point.x >= imageWidth ||
    point.y <= 0 ||
    point.y >= imageHeight
  )) {
    throw new Error("Calibration target outer corners must be finite and fully inside the source frame.");
  }
  const doubledOuterContourArea = Math.abs(corners.reduce((total, point, index) => {
    const next = corners[(index + 1) % corners.length]!;
    return total + point.x * next.y - next.x * point.y;
  }, 0));
  const coverageFraction = doubledOuterContourArea / 2 / (imageWidth * imageHeight);
  if (!Number.isFinite(coverageFraction) || coverageFraction <= 0 || coverageFraction > 1) {
    throw new Error("Calibration target outer-contour coverage must be finite and within the source frame.");
  }
  const centerX = corners.reduce((total, point) => total + point.x, 0) / 4;
  const centerY = corners.reduce((total, point) => total + point.y, 0) / 4;
  return {
    centerXFraction: Number((centerX / imageWidth).toFixed(6)),
    centerYFraction: Number((centerY / imageHeight).toFixed(6)),
    coverageFraction: Number(coverageFraction.toFixed(6)),
    rotationDegrees: Number(geometry.rotationDegrees.toFixed(6)),
    cornerSignature: corners.flatMap((point) => [
      Number((point.x / imageWidth).toFixed(6)),
      Number((point.y / imageHeight).toFixed(6)),
    ]),
  };
}

function assertCaptureRequest(input: CaptureFixedRigMathematicalCalibrationStepV1Request, contractVersion: "v1.0.1" | "v1.1" = "v1.0.1"): void {
  assertSafeId(input.sessionId, "sessionId");
  assertSafeId(input.operationId, "operationId");
  if (!CAPTURE_ROLES.includes(input.role)) throw new Error("Calibration capture role is not allowlisted.");
  if (contractVersion === "v1.0.1" && input.role === "checkerboard_placement") {
    throw new Error("checkerboard_placement is available only under the Mathematical Calibration V1.1 contract.");
  }
  positiveInteger(input.sampleIndex, "sampleIndex");
  if (["flat_field", "dark_control", "illumination_pattern"].includes(input.role)) {
    if (!Number.isInteger(input.channelIndex) || Number(input.channelIndex) < 1 || Number(input.channelIndex) > 8) {
      throw new Error(`${input.role} requires channelIndex 1 through 8.`);
    }
    if (input.targetFace !== "blank_reverse") throw new Error(`${input.role} requires the blank_reverse target face.`);
    if (input.sampleIndex > 3) throw new Error(`${input.role} sampleIndex must be 1 through 3.`);
  } else {
    if (input.channelIndex !== undefined) throw new Error(`${input.role} must not declare a channelIndex.`);
    if (input.targetFace !== "checkerboard") throw new Error(`${input.role} requires the checkerboard target face.`);
    if (input.sampleIndex > 10) throw new Error(`${input.role} sampleIndex must be 1 through 10.`);
  }
  if (input.normalizationSourceOperationId !== undefined) {
    throw new Error("Calibration normalization geometry is server-owned and normalizationSourceOperationId may not be supplied by a browser or operator.");
  }
  if (contractVersion === "v1.1" && !["checkerboard_placement", "flat_field", "dark_control", "illumination_pattern"].includes(input.role)) {
    throw new Error("V1.1 accepts exactly four checkerboard_placement captures; the V1.0.1 geometry/normalization/reseat roles are not valid.");
  }
  if (contractVersion === "v1.1" && input.role === "checkerboard_placement" && input.sampleIndex > 4) {
    throw new Error("V1.1 checkerboard placement sampleIndex must be 1 through 4.");
  }
  if (input.role === "repeated_placement") {
    assertSafeId(input.removeReseatCycleId, "removeReseatCycleId");
  } else if (input.removeReseatCycleId !== undefined) {
    throw new Error(contractVersion === "v1.1"
      ? "V1.1 has no reseat interaction contract; checkerboard placements are distinct overlay-approved captures only."
      : "removeReseatCycleId is purpose-bound to repeated_placement captures.");
  }
}

function assertInstrument(instrument: FixedRigMathematicalCalibrationInstrumentV1): void {
  assertSafeId(instrument.instrumentId, "instrument.instrumentId");
  if (!["traceable_ruler", "caliper", "fixed_rig_geometry", "protected_target_geometry"].includes(instrument.kind)) {
    throw new Error("instrument.kind is not allowlisted.");
  }
  if (instrument.kind === "protected_target_geometry") {
    if (instrument.instrumentId !== "protected-calibration-target-geometry-v1" ||
        instrument.authorityStatement !== "product_owner_confirmed_exact_target_geometry_v1") {
      throw new Error("Protected target geometry requires the exact product-owner-confirmed authority identity.");
    }
    assertSafeId(instrument.targetVersion, "instrument.targetVersion");
    assertSha256(instrument.targetSha256, "instrument.targetSha256");
    return;
  }
  assertSafeId(instrument.calibrationVersion, "instrument.calibrationVersion");
  assertSha256(instrument.calibrationSha256, "instrument.calibrationSha256");
}

function assertPhysicalMeasurementTargetAuthority(input: {
  instrument: FixedRigMathematicalCalibrationInstrumentV1;
  targetVersion: string;
  targetSha256: string;
}): void {
  if (input.instrument.kind !== "protected_target_geometry") return;
  if (input.instrument.targetVersion !== input.targetVersion || input.instrument.targetSha256 !== input.targetSha256) {
    throw new Error("Protected target geometry authority does not match the active session target identity.");
  }
}

function safeSessionMember(sessionDir: string, relativePath: unknown, label: string): string {
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a relative session path.`);
  }
  const root = path.resolve(sessionDir);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escapes the isolated session.`);
  return resolved;
}

function manifestReferences(value: unknown): Array<{ path: string; sha256: string }> {
  const references: Array<{ path: string; sha256: string }> = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const object = candidate as Record<string, unknown>;
    if (typeof object.path === "string" && typeof object.sha256 === "string") {
      references.push({ path: object.path, sha256: object.sha256 });
    }
    Object.values(object).forEach(visit);
  };
  visit(value);
  return references;
}

function isProtectedTargetAuthorityRecord(record: MeasurementRecordV1): boolean {
  return (record.payload.instrument as { kind?: unknown } | undefined)?.kind === "protected_target_geometry";
}

function isAnalyzerAuthorityRecord(record: MeasurementRecordV1): boolean {
  const instrument = record.payload.instrument as { kind?: unknown; calibrationSha256?: unknown } | undefined;
  return (record.measurementType === "direction_geometry" || record.measurementType === "measurement_repeatability") &&
    instrument?.kind === "fixed_rig_geometry";
}

function measurementArtifactBody(record: MeasurementRecordV1): Record<string, unknown> {
  const schemaVersion = record.measurementType === "direction_geometry"
    ? "ten-kings-calibration-direction-measurement-v1"
    : record.measurementType === "measurement_repeatability"
      ? "ten-kings-calibration-repeatability-measurement-v1"
      : record.measurementType === "print_scale"
        ? "ten-kings-calibration-print-scale-authority-v1"
        : "ten-kings-calibration-target-cut-dimension-authority-v1";
  return { schemaVersion, ...record.payload };
}

function expectedAnalyzerPayloadFromRequest(
  request: RecordFixedRigMathematicalCalibrationMeasurementV1Request,
  oldRecord: MeasurementRecordV1,
  state: CaptureSessionStateV1,
): Record<string, unknown> {
  if (request.measurementType === "direction_geometry" && "measurementAlgorithmVersion" in request) {
    return {
      operatorId: state.operatorId,
      recordedAt: oldRecord.recordedAt,
      measurementMethod: request.measurementMethod,
      instrument: request.instrument,
      channelIndex: request.channelIndex,
      sampleIndex: request.sampleIndex,
      sourcePointMm: request.sourcePointMm,
      cardCenterPointMm: request.cardCenterPointMm,
      pointU95Mm: request.pointU95Mm,
      sourceCaptureOperationId: request.sourceCaptureOperationId,
      sourceEvidenceId: request.sourceEvidenceId,
      sourceSha256: request.sourceSha256,
      sourceRole: `illumination_pattern_channel_${request.channelIndex}`,
      measurementAlgorithmVersion: request.measurementAlgorithmVersion,
    };
  }
  if (request.measurementType === "measurement_repeatability") {
    const sourceCapture = state.captures.find((capture) => capture.operationId === request.sourceCaptureOperationId);
    const sourceArtifact = sourceCapture && state.artifacts.find((artifact) => artifact.evidenceId === sourceCapture.rawEvidenceId);
    if (!sourceCapture || sourceCapture.role !== "repeated_placement" || !sourceArtifact) {
      throw new Error("Corrected analyzer request does not bind an exact immutable repeated-placement capture.");
    }
    return {
      operatorId: state.operatorId,
      recordedAt: oldRecord.recordedAt,
      measurementMethod: request.measurementMethod,
      instrument: request.instrument,
      measurementClass: request.measurementClass,
      sampleIndex: request.sampleIndex,
      referenceFeatureId: request.referenceFeatureId,
      measuredValue: request.measuredValue,
      sourceCaptureOperationId: request.sourceCaptureOperationId,
      sourceEvidenceId: sourceArtifact.evidenceId,
      sourceSha256: sourceArtifact.sha256,
      sourceRole: "repeated_placement",
      measurementAlgorithmVersion: request.measurementAlgorithmVersion,
      fixedRoiDefinition: "registered_checkerboard_center_cell_and_grid_spacing_v1",
    };
  }
  throw new Error("Incident rebind received a non-analyzer authority request in the corrected 74-record set.");
}

export class FixedRigMathematicalCalibrationCaptureProducerV1 {
  private readonly config: FixedRigMathematicalCalibrationCaptureProducerConfigV1;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly verifiedBlankReverseGeometry = new Map<string, VerifiedBlankReverseGeometryAuthorityV1>();
  private readonly blankReverseTimestampFalseStopRecovery = BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_V1;
  private readonly analyzerAuthorityRebindIncident = ANALYZER_AUTHORITY_REBIND_INCIDENT_V1;
  private analyzerAuthorityRebindTestFailpoint?:
    "after-stage" | "after-backup-rename" | "after-original-restore" | "after-stage-to-live";
  private analyzerAuthoritySupersessionLedgerForSeal?: AnalyzerAuthoritySupersessionLedgerReferenceV1;

  constructor(config: FixedRigMathematicalCalibrationCaptureProducerConfigV1) {
    this.config = config;
    assertSafeId(config.targetVersion, "targetVersion");
    assertSha256(config.targetSha256, "targetSha256");
    assertSafeId(config.protectedSettings.stationId, "protectedSettings.stationId");
    assertSafeId(config.protectedSettings.rigId, "protectedSettings.rigId");
    const contractVersion = config.contractVersion ?? "v1.0.1";
    const expectedProfile = contractVersion === "v1.1"
      ? FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1_1
      : FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1;
    if (config.protectedSettings.captureProfileVersion !== expectedProfile) {
      throw new Error(`captureProfileVersion must be ${expectedProfile}.`);
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.catch(() => undefined).then(operation);
    this.chain = run;
    return run;
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.config.outputRoot, safeSegment(assertSafeId(sessionId, "sessionId")));
  }

  private statePath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), "capture-session.json");
  }

  private async readAcceptedArtifactBytes(state: CaptureSessionStateV1, artifact: CaptureArtifactV1): Promise<Buffer> {
    const sessionRoot = path.resolve(this.sessionDir(state.sessionId));
    const artifactPath = path.resolve(sessionRoot, ...artifact.path.split("/"));
    if (!artifactPath.startsWith(`${sessionRoot}${path.sep}`)) {
      throw new Error(`Calibration artifact ${artifact.evidenceId} escapes the isolated session root.`);
    }
    const bytes = await readFile(artifactPath);
    const metadata = await stat(artifactPath);
    if (hash(bytes) !== artifact.sha256 || metadata.size !== artifact.byteSize) {
      throw new Error(`Calibration artifact ${artifact.evidenceId} failed immutable SHA-256/size verification.`);
    }
    return bytes;
  }

  private async resolveBlankReverseGeometryAuthority(
    state: CaptureSessionStateV1,
  ): Promise<VerifiedBlankReverseGeometryAuthorityV1 | undefined> {
    if (
      state.schemaVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_SESSION_V1 ||
      state.purpose !== "mathematical_calibration_v1"
    ) {
      return undefined;
    }
    if (
      hash(canonicalBytes(state.protectedSettings)) !== hash(canonicalBytes(this.config.protectedSettings)) ||
      state.subject.targetVersion !== this.config.targetVersion ||
      state.subject.targetSha256 !== this.config.targetSha256
    ) {
      hardStop("Accepted blank-reverse geometry authority does not match the protected session target or settings.");
    }
    const planOrder = new Map(capturePlan("v1.0.1").map((slot, index) => [slot.slotKey, index]));
    const candidates = state.captures
      .filter((capture) => capture.targetFace === "blank_reverse" && isBlankReversePhotometricRole(capture.role));
    if (candidates.length === 0) return undefined;
    const source = candidates[0]!;
    if (!planOrder.has(captureKey(source))) {
      hardStop("Accepted blank-reverse geometry source is not a canonical V1.0.1 capture slot.");
    }
    if (
      state.captures.filter((capture) => capture.operationId === source.operationId).length !== 1 ||
      state.captures.filter((capture) => captureKey(capture) === captureKey(source)).length !== 1
    ) {
      hardStop("Accepted blank-reverse geometry source is duplicated in the immutable capture ledger.");
    }
    const rawMatches = state.artifacts.filter((artifact) => artifact.evidenceId === source.rawEvidenceId);
    const normalizedMatches = state.artifacts.filter((artifact) => artifact.evidenceId === source.normalizedEvidenceId);
    if (rawMatches.length !== 1 || normalizedMatches.length !== 1) {
      hardStop("Accepted blank-reverse geometry source has missing or duplicate artifact identities.");
    }
    const rawArtifact = rawMatches[0]!;
    const normalizedArtifact = normalizedMatches[0]!;
    const expectedRole = captureRole(source);
    const expectedLighting = lightingFor(source, state.protectedSettings);
    if (
      rawArtifact.artifactClass !== "raw_capture" ||
      normalizedArtifact.artifactClass !== "normalized_derivative" ||
      rawArtifact.operationId !== source.operationId ||
      normalizedArtifact.operationId !== source.operationId ||
      rawArtifact.role !== `${expectedRole}_raw` ||
      normalizedArtifact.role !== expectedRole ||
      rawArtifact.targetFace !== "blank_reverse" ||
      normalizedArtifact.targetFace !== "blank_reverse" ||
      rawArtifact.channelIndex !== (source.channelIndex ?? null) ||
      normalizedArtifact.channelIndex !== (source.channelIndex ?? null) ||
      rawArtifact.rigId !== state.protectedSettings.rigId ||
      normalizedArtifact.rigId !== state.protectedSettings.rigId ||
      rawArtifact.captureProfileVersion !== state.protectedSettings.captureProfileVersion ||
      normalizedArtifact.captureProfileVersion !== state.protectedSettings.captureProfileVersion ||
      rawArtifact.subjectDesignation !== "calibration_target" ||
      normalizedArtifact.subjectDesignation !== "calibration_target" ||
      rawArtifact.productionCard !== false ||
      normalizedArtifact.productionCard !== false ||
      rawArtifact.capturedAt !== source.capturedAt ||
      normalizedArtifact.capturedAt !== source.capturedAt ||
      rawArtifact.camera?.exposureUs !== state.protectedSettings.exposureUs ||
      rawArtifact.camera?.gain !== state.protectedSettings.gain ||
      rawArtifact.leimac?.unit !== state.protectedSettings.leimacUnit ||
      rawArtifact.leimac?.dutyPercent !== expectedLighting.dutyPercent ||
      JSON.stringify([...(rawArtifact.leimac?.enabledChannels ?? [])].sort()) !== JSON.stringify([...expectedLighting.enabledChannels].sort()) ||
      rawArtifact.leimac?.complete !== true ||
      rawArtifact.leimac.acknowledgedWriteCount !== rawArtifact.leimac.expectedWriteCount ||
      rawArtifact.safeOff?.beforeCaptureConfirmed !== true ||
      rawArtifact.safeOff?.afterCaptureConfirmed !== true ||
      normalizedArtifact.parentEvidenceId !== rawArtifact.evidenceId ||
      normalizedArtifact.parentSha256 !== rawArtifact.sha256 ||
      normalizedArtifact.normalization?.sourceSha256 !== rawArtifact.sha256 ||
      normalizedArtifact.normalization?.coordinateFrame !== "normalized_card_portrait_pixels" ||
      normalizedArtifact.normalization?.widthPx !== state.protectedSettings.normalizedWidthPx ||
      normalizedArtifact.normalization?.heightPx !== state.protectedSettings.normalizedHeightPx ||
      !rawArtifact.pose ||
      !normalizedArtifact.pose ||
      hash(canonicalBytes(rawArtifact.pose)) !== hash(canonicalBytes(normalizedArtifact.pose))
    ) {
      hardStop("Accepted blank-reverse geometry source does not match its immutable capture, rig, controller, pose, or normalization authority.");
    }
    const [rawBytes, normalizedBytes] = await Promise.all([
      this.readAcceptedArtifactBytes(state, rawArtifact),
      this.readAcceptedArtifactBytes(state, normalizedArtifact),
    ]);
    if (/[\\/]/.test(normalizedArtifact.evidenceId)) {
      hardStop("Accepted blank-reverse normalized evidence identity is not path-safe.");
    }
    const sessionRoot = path.resolve(this.sessionDir(state.sessionId));
    const geometryPath = path.resolve(sessionRoot, "working", `${normalizedArtifact.evidenceId}-geometry.json`);
    if (!geometryPath.startsWith(`${sessionRoot}${path.sep}`)) {
      hardStop("Accepted blank-reverse geometry record escapes the isolated session root.");
    }
    const geometryBytes = await readFile(geometryPath);
    let geometry: CardGeometryMetadata;
    try {
      geometry = JSON.parse(geometryBytes.toString("utf-8")) as CardGeometryMetadata;
    } catch {
      hardStop("Accepted blank-reverse geometry record is not valid canonical JSON.");
    }
    if (!geometry! || !geometryBytes.equals(canonicalBytes(geometry))) {
      hardStop("Accepted blank-reverse geometry record is not canonical immutable geometry.");
    }
    assertCanonicalGeometryTimestamp(geometry.timestamp, source.capturedAt);
    const geometryPose = poseFromGeometry(geometry);
    if (
      geometry.version !== normalizedArtifact.normalization!.algorithmVersion ||
      geometry.sourceImageId !== rawArtifact.evidenceId ||
      geometry.sourceFrameId !== rawArtifact.evidenceId ||
      geometry.placementState !== "ready" ||
      geometry.geometrySource !== "detected" ||
      geometry.captureMode !== "automatic_detection" ||
      geometry.confidenceBasis !== "automatic_detection" ||
      geometry.detectionUsed !== true ||
      geometry.manualOverrideUsed !== false ||
      hash(canonicalBytes(geometryPose)) !== hash(canonicalBytes(rawArtifact.pose))
    ) {
      hardStop("Accepted blank-reverse geometry record does not reproduce its immutable accepted pose and detection authority.");
    }
    const geometrySha256 = hash(geometryBytes);
    const provenance: VerifiedBlankReverseGeometryAuthorityV1["provenance"] = {
      kind: "same_session_accepted_blank_reverse_v1",
      sourceSessionId: state.sessionId,
      sourceOperationId: source.operationId,
      sourceRawEvidenceId: rawArtifact.evidenceId,
      sourceRawSha256: rawArtifact.sha256,
      sourceNormalizedEvidenceId: normalizedArtifact.evidenceId,
      sourceNormalizedSha256: normalizedArtifact.sha256,
      sourceGeometrySha256: geometrySha256,
    };
    const fingerprint = hash(canonicalBytes({
      protectedSettings: state.protectedSettings,
      subject: state.subject,
      source,
      rawArtifact,
      normalizedArtifact,
      rawSha256: hash(rawBytes),
      normalizedSha256: hash(normalizedBytes),
      geometrySha256,
    }));
    const cached = this.verifiedBlankReverseGeometry.get(state.sessionId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        hardStop("Accepted blank-reverse geometry authority changed after server verification.");
      }
      return { geometry, fingerprint, provenance };
    }
    const auditOutputPath = path.join(
      this.sessionDir(state.sessionId),
      "working",
      `${normalizedArtifact.evidenceId}-authority-audit-${crypto.randomUUID()}.png`,
    );
    try {
      const reproduced = await (this.config.normalize ?? defaultNormalizer)({
        sourceImagePath: path.join(sessionRoot, ...rawArtifact.path.split("/")),
        workingOutputPath: auditOutputPath,
        capturedAt: source.capturedAt,
        sourceImageId: rawArtifact.evidenceId,
      });
      const reproducedBytes = reproduced.normalizedArtifact
        ? await readFile(reproduced.normalizedArtifact.localOutputPath)
        : undefined;
      const expectedNormalization = normalizedArtifact.normalization!;
      if (
        !reproduced.rawEvidencePreserved ||
        !reproduced.normalizedArtifact ||
        !reproducedBytes ||
        reproduced.rawArtifact.sha256 !== rawArtifact.sha256 ||
        reproduced.normalizedArtifact.sourceSha256 !== rawArtifact.sha256 ||
        reproduced.normalizedArtifact.sha256 !== normalizedArtifact.sha256 ||
        !reproducedBytes.equals(normalizedBytes) ||
        !canonicalBytes(reproduced.geometry).equals(geometryBytes) ||
        reproduced.normalizedArtifact.imageWidth !== expectedNormalization.widthPx ||
        reproduced.normalizedArtifact.imageHeight !== expectedNormalization.heightPx ||
        reproduced.normalizedArtifact.geometricResamplingApplied !== expectedNormalization.geometricResamplingApplied ||
        reproduced.normalizedArtifact.sourceCropWidth !== expectedNormalization.sourceCropWidth ||
        reproduced.normalizedArtifact.sourceCropHeight !== expectedNormalization.sourceCropHeight ||
        reproduced.normalizedArtifact.scaleX !== expectedNormalization.scaleX ||
        reproduced.normalizedArtifact.scaleY !== expectedNormalization.scaleY ||
        reproduced.normalizedArtifact.deskewAppliedDegrees !== expectedNormalization.deskewAppliedDegrees
      ) {
        hardStop("Accepted blank-reverse geometry and normalized derivative do not reproduce from the exact immutable source raw.");
      }
    } finally {
      await rm(auditOutputPath, { force: true });
    }
    const verified = { geometry, fingerprint, provenance };
    this.verifiedBlankReverseGeometry.set(state.sessionId, verified);
    return verified;
  }

  private async load(sessionId: string): Promise<CaptureSessionStateV1> {
    const bytes = await readFile(this.statePath(sessionId));
    const state = JSON.parse(bytes.toString("utf-8")) as CaptureSessionStateV1;
    const expectedSchema = this.config.contractVersion === "v1.1"
      ? MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_SESSION_SCHEMA
      : FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_SESSION_V1;
    if (state.schemaVersion !== expectedSchema || state.sessionId !== sessionId) {
      throw new Error("Calibration capture session state is not the expected immutable contract.");
    }
    return state;
  }

  private async persist(state: CaptureSessionStateV1): Promise<void> {
    await writeJsonAtomic(this.statePath(state.sessionId), state);
  }

  private async verifyAcceptedArtifactIntegrity(state: CaptureSessionStateV1): Promise<void> {
    for (const artifact of state.artifacts) {
      await this.readAcceptedArtifactBytes(state, artifact);
    }
  }

  private async acceptedCaptureEvidenceLedger(
    state: CaptureSessionStateV1,
    verifiedSessionDir = this.sessionDir(state.sessionId),
  ): Promise<{
    captureCount: number;
    artifactCount: number;
    capturesSha256: string;
    artifactsSha256: string;
    eventsSha256: string;
  }> {
    const acceptedArtifacts = state.artifacts
      .filter((artifact) => artifact.artifactClass === "raw_capture" || artifact.artifactClass === "normalized_derivative")
      .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
    const eventLedger: Array<{ operationId: string; path: string; sha256: string; byteSize: number }> = [];
    for (const capture of state.captures) {
      const rawMatches = acceptedArtifacts.filter((artifact) => artifact.evidenceId === capture.rawEvidenceId);
      const normalizedMatches = acceptedArtifacts.filter((artifact) => artifact.evidenceId === capture.normalizedEvidenceId);
      if (rawMatches.length !== 1 || normalizedMatches.length !== 1) {
        throw new Error(`Accepted capture ${capture.operationId} does not bind exactly one raw and normalized artifact.`);
      }
      const relativePath = portable("events", `${safeSegment(capture.operationId)}.json`);
      const eventPath = path.join(verifiedSessionDir, ...relativePath.split("/"));
      const eventBytes = await readFile(eventPath);
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(eventBytes.toString("utf-8")) as Record<string, unknown>;
      } catch {
        throw new Error(`Accepted capture ${capture.operationId} event is not valid canonical JSON.`);
      }
      if (!eventBytes.equals(canonicalBytes(event))) {
        throw new Error(`Accepted capture ${capture.operationId} event is not canonical immutable JSON.`);
      }
      const request = event.request as Record<string, unknown> | undefined;
      if (
        event.operation !== "capture-step" ||
        !request ||
        request.sessionId !== state.sessionId ||
        request.operationId !== capture.operationId ||
        request.role !== capture.role ||
        request.sampleIndex !== capture.sampleIndex ||
        (request.channelIndex ?? null) !== (capture.channelIndex ?? null) ||
        request.targetFace !== capture.targetFace ||
        (request.removeReseatCycleId ?? null) !== (capture.removeReseatCycleId ?? null) ||
        hash(canonicalBytes(event.rawArtifact)) !== hash(canonicalBytes(rawMatches[0])) ||
        hash(canonicalBytes(event.normalizedArtifact)) !== hash(canonicalBytes(normalizedMatches[0]))
      ) {
        throw new Error(`Accepted capture ${capture.operationId} event does not reproduce its immutable request and artifact authority.`);
      }
      eventLedger.push({
        operationId: capture.operationId,
        path: relativePath,
        sha256: hash(eventBytes),
        byteSize: eventBytes.length,
      });
    }
    eventLedger.sort((left, right) => left.operationId.localeCompare(right.operationId));
    return {
      captureCount: state.captures.length,
      artifactCount: acceptedArtifacts.length,
      capturesSha256: hash(canonicalBytes(state.captures)),
      artifactsSha256: hash(canonicalBytes(acceptedArtifacts)),
      eventsSha256: hash(canonicalBytes(eventLedger)),
    };
  }

  private async protectedTargetEvidenceLedger(
    state: CaptureSessionStateV1,
    verifiedSessionDir = this.sessionDir(state.sessionId),
  ): Promise<{
    authoritySha256: string;
    artifactsSha256: string;
    eventsSha256: string;
  }> {
    const records = state.measurements.filter(isProtectedTargetAuthorityRecord);
    if (records.length !== this.analyzerAuthorityRebindIncident.protectedTargetAuthorityCount) {
      throw new Error("Protected-target authority ledger does not contain exactly four records.");
    }
    const evidenceIds = new Set(records.map((record) => record.evidenceId));
    const artifacts = state.artifacts.filter((artifact) =>
      artifact.artifactClass === "target" || evidenceIds.has(artifact.evidenceId));
    const eventLedger: Array<{ operationId: string; path: string; sha256: string; byteSize: number }> = [];
    for (const record of records) {
      const matches = artifacts.filter((artifact) => artifact.evidenceId === record.evidenceId);
      if (matches.length !== 1 || matches[0]!.artifactClass !== "measurement" || matches[0]!.operationId !== record.operationId) {
        throw new Error(`Protected-target authority ${record.operationId} does not bind exactly one immutable measurement artifact.`);
      }
      const artifact = matches[0]!;
      const relativePath = portable("events", `${safeSegment(record.operationId)}.json`);
      const eventBytes = await readFile(path.join(verifiedSessionDir, ...relativePath.split("/")));
      const expectedEventBytes = canonicalBytes({
        operation: "record-measurement",
        request: measurementArtifactBody(record),
        artifact,
      });
      if (!eventBytes.equals(expectedEventBytes)) {
        throw new Error(`Protected-target authority event ${record.operationId} does not reproduce its immutable record and artifact.`);
      }
      eventLedger.push({
        operationId: record.operationId,
        path: relativePath,
        sha256: hash(eventBytes),
        byteSize: eventBytes.length,
      });
    }
    eventLedger.sort((left, right) => left.operationId.localeCompare(right.operationId));
    return {
      authoritySha256: hash(canonicalBytes(records)),
      artifactsSha256: hash(canonicalBytes(artifacts)),
      eventsSha256: hash(canonicalBytes(eventLedger)),
    };
  }

  private async readAndValidateFalseStopRecoveryReceipt(
    state: CaptureSessionStateV1,
    recovery: BlankReverseTimestampFalseStopRecoveryStateV1,
  ): Promise<BlankReverseTimestampFalseStopRecoveryReceiptV1> {
    const contract = this.blankReverseTimestampFalseStopRecovery;
    const expectedReceiptPath = portable("events", `${contract.recoveryId}.json`);
    if (recovery.receiptPath !== expectedReceiptPath || !SHA256.test(recovery.receiptSha256)) {
      throw new Error("The incident-bound false-stop recovery state does not bind the exact canonical receipt path and SHA-256.");
    }
    const receiptPath = path.join(this.sessionDir(state.sessionId), ...recovery.receiptPath.split("/"));
    const receiptBytes = await readFile(receiptPath);
    let receipt: BlankReverseTimestampFalseStopRecoveryReceiptV1;
    try {
      receipt = JSON.parse(receiptBytes.toString("utf-8")) as BlankReverseTimestampFalseStopRecoveryReceiptV1;
    } catch {
      throw new Error("The incident-bound false-stop recovery receipt is not valid canonical JSON.");
    }
    if (
      !receiptBytes.equals(canonicalBytes(receipt)) ||
      hash(receiptBytes) !== recovery.receiptSha256 ||
      receipt.schemaVersion !== BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_RECEIPT_V1 ||
      receipt.recoveryId !== contract.recoveryId ||
      receipt.recoveredAt !== recovery.recoveredAt ||
      !ECMASCRIPT_MILLISECOND_TIMESTAMP.test(receipt.recoveredAt) ||
      !Number.isFinite(new Date(receipt.recoveredAt).getTime()) ||
      new Date(receipt.recoveredAt).toISOString() !== receipt.recoveredAt ||
      receipt.preRecoveryStateSha256 !== contract.expectedPreStateSha256 ||
      receipt.sessionId !== contract.sessionId ||
      hash(canonicalBytes(receipt.recoveredHardStop)) !== hash(canonicalBytes(recovery.recoveredHardStop)) ||
      hash(canonicalBytes(receipt.preservedFailedOperation)) !== hash(canonicalBytes(recovery.preservedFailedOperation)) ||
      receipt.pendingSlotKey !== contract.pendingSlotKey ||
      receipt.acceptedEvidence.captureCount !== contract.acceptedCaptureCount ||
      receipt.acceptedEvidence.artifactCount !== contract.acceptedArtifactCount
    ) {
      throw new Error("The incident-bound false-stop recovery receipt failed exact canonical identity verification.");
    }
    return receipt;
  }

  async recoverKnownBlankReverseTimestampFalseStop(
    bridgeBoundSessionId: string,
  ): Promise<FixedRigMathematicalCalibrationFalseStopRecoveryV1> {
    return this.serialized(async () => {
      const contract = this.blankReverseTimestampFalseStopRecovery;
      if (bridgeBoundSessionId !== contract.sessionId) {
        throw new Error("The one-time blank-reverse timestamp recovery is bound only to its exact audited V1.0.1 session.");
      }
      const state = await this.load(contract.sessionId);
      const recoveries = state.recoveryReceipts ?? [];
      const matchingRecoveries = recoveries.filter((recovery) => recovery.recoveryId === contract.recoveryId);
      if (matchingRecoveries.length > 0) {
        if (matchingRecoveries.length !== 1 || recoveries.length !== 1 || state.hardStop) {
          throw new Error("The incident-bound recovery history or current hard-stop state is not the exact idempotent recovered state.");
        }
        const recovery = matchingRecoveries[0]!;
        if (
          recovery.schemaVersion !== BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_STATE_V1 ||
          recovery.preRecoveryStateSha256 !== contract.expectedPreStateSha256 ||
          recovery.recoveredHardStop.operationId !== contract.operationId ||
          recovery.recoveredHardStop.reason !== contract.reason ||
          recovery.preservedFailedOperation.operationId !== contract.operationId ||
          recovery.preservedFailedOperation.error !== contract.reason ||
          recovery.pendingSlotKey !== contract.pendingSlotKey ||
          recovery.acceptedCaptureCount !== contract.acceptedCaptureCount ||
          recovery.acceptedArtifactCount !== contract.acceptedArtifactCount
        ) {
          throw new Error("The incident-bound recovery state record failed exact identity verification.");
        }
        await this.readAndValidateFalseStopRecoveryReceipt(state, recovery);
        return { status: statusFor(state, this.sessionDir(state.sessionId)), recovery, idempotent: true };
      }
      if (recoveries.length !== 0) {
        throw new Error("An unrelated recovery record is present; the one-time incident recovery is unavailable.");
      }
      const preRecoveryStateSha256 = hash(canonicalBytes(state));
      if (preRecoveryStateSha256 !== contract.expectedPreStateSha256) {
        throw new Error("The one-time incident recovery pre-state SHA-256 does not match the exact audited state.");
      }
      const acceptedArtifacts = state.artifacts.filter(
        (artifact) => artifact.artifactClass === "raw_capture" || artifact.artifactClass === "normalized_derivative",
      );
      const matchingFailures = state.failedOperations.filter((failure) => failure.operationId === contract.operationId);
      const latestFailure = state.failedOperations.at(-1);
      const completedKeys = new Set(state.captures.map(captureKey));
      const pendingSlot = capturePlan("v1.0.1").find((slot) => !completedKeys.has(slot.slotKey));
      const failedOperationWorkingDir = path.join(this.sessionDir(state.sessionId), "working", safeSegment(contract.operationId));
      const failedOperationEventPath = path.join(this.sessionDir(state.sessionId), "events", `${safeSegment(contract.operationId)}.json`);
      if (
        state.schemaVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_SESSION_V1 ||
        state.purpose !== "mathematical_calibration_v1" ||
        state.sessionId !== contract.sessionId ||
        state.sealedAt !== undefined ||
        state.captures.length !== contract.acceptedCaptureCount ||
        acceptedArtifacts.length !== contract.acceptedArtifactCount ||
        state.measurements.length !== 0 ||
        state.hardStop?.operationId !== contract.operationId ||
        state.hardStop.reason !== contract.reason ||
        matchingFailures.length !== 1 ||
        latestFailure !== matchingFailures[0] ||
        latestFailure.operationId !== contract.operationId ||
        latestFailure.error !== contract.reason ||
        latestFailure.slotKey !== contract.pendingSlotKey ||
        latestFailure.role !== "dark_control" ||
        latestFailure.channelIndex !== 1 ||
        latestFailure.sampleIndex !== 3 ||
        latestFailure.targetFace !== "blank_reverse" ||
        latestFailure.candidateRawSha256 !== undefined ||
        latestFailure.candidateCapturedAt !== undefined ||
        latestFailure.candidatePose !== undefined ||
        latestFailure.prospectiveAggregate !== undefined ||
        state.captures.some((capture) => capture.operationId === contract.operationId) ||
        state.artifacts.some((artifact) => artifact.operationId === contract.operationId) ||
        existsSync(failedOperationWorkingDir) ||
        existsSync(failedOperationEventPath) ||
        pendingSlot?.slotKey !== contract.pendingSlotKey ||
        pendingSlot.targetFace !== "blank_reverse"
      ) {
        throw new Error("The one-time incident recovery state does not match the exact false-stop operation, pending slot, or preserved evidence counts.");
      }
      await this.verifyAcceptedArtifactIntegrity(state);
      const acceptedEvidence = await this.acceptedCaptureEvidenceLedger(state);
      this.verifiedBlankReverseGeometry.delete(state.sessionId);
      const blankAuthority = await this.resolveBlankReverseGeometryAuthority(state);
      if (!blankAuthority) {
        throw new Error("The one-time incident recovery could not verify an accepted same-session blank-reverse geometry authority.");
      }
      const receiptRelativePath = portable("events", `${contract.recoveryId}.json`);
      const receiptPath = path.join(this.sessionDir(state.sessionId), ...receiptRelativePath.split("/"));
      let receipt: BlankReverseTimestampFalseStopRecoveryReceiptV1;
      let receiptBytes: Buffer;
      if (existsSync(receiptPath)) {
        receiptBytes = await readFile(receiptPath);
        try {
          receipt = JSON.parse(receiptBytes.toString("utf-8")) as BlankReverseTimestampFalseStopRecoveryReceiptV1;
        } catch {
          throw new Error("The pre-existing incident recovery receipt is not valid canonical JSON.");
        }
      } else {
        const recoveredAt = (this.config.now?.() ?? new Date()).toISOString();
        receipt = {
          schemaVersion: BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_RECEIPT_V1,
          recoveryId: contract.recoveryId,
          recoveredAt,
          preRecoveryStateSha256,
          sessionId: state.sessionId,
          recoveredHardStop: structuredClone(state.hardStop),
          preservedFailedOperation: structuredClone(latestFailure),
          pendingSlotKey: contract.pendingSlotKey,
          acceptedEvidence,
          verifiedBlankReverseAuthority: structuredClone(blankAuthority.provenance),
        };
        receiptBytes = canonicalBytes(receipt);
        await writeExclusive(receiptPath, receiptBytes);
      }
      const expectedReceipt: BlankReverseTimestampFalseStopRecoveryReceiptV1 = {
        schemaVersion: BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_RECEIPT_V1,
        recoveryId: contract.recoveryId,
        recoveredAt: receipt.recoveredAt,
        preRecoveryStateSha256,
        sessionId: state.sessionId,
        recoveredHardStop: structuredClone(state.hardStop),
        preservedFailedOperation: structuredClone(latestFailure),
        pendingSlotKey: contract.pendingSlotKey,
        acceptedEvidence,
        verifiedBlankReverseAuthority: structuredClone(blankAuthority.provenance),
      };
      if (
        !ECMASCRIPT_MILLISECOND_TIMESTAMP.test(receipt.recoveredAt) ||
        !Number.isFinite(new Date(receipt.recoveredAt).getTime()) ||
        new Date(receipt.recoveredAt).toISOString() !== receipt.recoveredAt ||
        !receiptBytes.equals(canonicalBytes(expectedReceipt))
      ) {
        throw new Error("The incident-bound false-stop recovery receipt does not reproduce the exact audited pre-state evidence.");
      }
      receipt = expectedReceipt;
      const recovery: BlankReverseTimestampFalseStopRecoveryStateV1 = {
        schemaVersion: BLANK_REVERSE_TIMESTAMP_FALSE_STOP_RECOVERY_STATE_V1,
        recoveryId: contract.recoveryId,
        recoveredAt: receipt.recoveredAt,
        preRecoveryStateSha256,
        receiptPath: receiptRelativePath,
        receiptSha256: hash(receiptBytes),
        recoveredHardStop: structuredClone(state.hardStop),
        preservedFailedOperation: structuredClone(latestFailure),
        pendingSlotKey: contract.pendingSlotKey,
        acceptedCaptureCount: acceptedEvidence.captureCount,
        acceptedArtifactCount: acceptedEvidence.artifactCount,
      };
      state.recoveryReceipts = [recovery];
      delete state.hardStop;
      state.updatedAt = receipt.recoveredAt;
      await this.persist(state);
      return { status: statusFor(state, this.sessionDir(state.sessionId)), recovery, idempotent: false };
    });
  }

  private async readCanonicalIncidentJson<T>(
    filePath: string,
    label: string,
  ): Promise<{ body: T; bytes: Buffer }> {
    const bytes = await readFile(filePath);
    let body: T;
    try {
      body = JSON.parse(bytes.toString("utf-8")) as T;
    } catch {
      throw new Error(`${label} is not valid canonical JSON.`);
    }
    if (!bytes.equals(canonicalBytes(body))) throw new Error(`${label} is not canonical JSON.`);
    return { body, bytes };
  }

  private async verifyIncidentStateArtifacts(
    state: CaptureSessionStateV1,
    verifiedSessionDir: string,
  ): Promise<void> {
    for (const artifact of state.artifacts) {
      const artifactPath = safeSessionMember(verifiedSessionDir, artifact.path, `artifact ${artifact.evidenceId} path`);
      const bytes = await readFile(artifactPath);
      const metadata = await stat(artifactPath);
      if (hash(bytes) !== artifact.sha256 || bytes.length !== artifact.byteSize || metadata.size !== artifact.byteSize) {
        throw new Error(`Incident rebind rejected changed artifact ${artifact.evidenceId}.`);
      }
    }
  }

  private async verifyAnalyzerAuthorityRecordsAndEvents(
    state: CaptureSessionStateV1,
    verifiedSessionDir: string,
    expectedAnalyzerSha256: string,
  ): Promise<{ records: MeasurementRecordV1[]; artifacts: CaptureArtifactV1[] }> {
    const records = state.measurements.filter(isAnalyzerAuthorityRecord);
    if (records.length !== this.analyzerAuthorityRebindIncident.analyzerAuthorityCount) {
      throw new Error("Analyzer authority ledger does not contain exactly 74 records.");
    }
    const artifacts: CaptureArtifactV1[] = [];
    for (const record of records) {
      const instrument = record.payload.instrument as { calibrationSha256?: unknown };
      if (instrument.calibrationSha256 !== expectedAnalyzerSha256) {
        throw new Error("Analyzer authority is not uniformly bound to the exact expected analyzer SHA-256.");
      }
      const matches = state.artifacts.filter((artifact) => artifact.evidenceId === record.evidenceId);
      if (matches.length !== 1 || matches[0]!.artifactClass !== "measurement" || matches[0]!.operationId !== record.operationId) {
        throw new Error(`Analyzer authority ${record.operationId} does not bind exactly one immutable measurement artifact.`);
      }
      const artifact = matches[0]!;
      const authorityBytes = await readFile(safeSessionMember(verifiedSessionDir, artifact.path, "analyzer authority file path"));
      if (!authorityBytes.equals(canonicalBytes(measurementArtifactBody(record)))) {
        throw new Error(`Analyzer authority file ${record.operationId} does not reproduce its immutable record.`);
      }
      const eventBytes = await readFile(path.join(verifiedSessionDir, "events", `${safeSegment(record.operationId)}.json`));
      if (!eventBytes.equals(canonicalBytes({
        operation: "record-measurement",
        request: measurementArtifactBody(record),
        artifact,
      }))) {
        throw new Error(`Analyzer authority event ${record.operationId} does not reproduce its immutable record and artifact.`);
      }
      artifacts.push(artifact);
    }
    return { records, artifacts };
  }

  private async verifyOriginalAnalyzerAuthorityIncidentSession(verifiedSessionDir: string): Promise<{
    state: CaptureSessionStateV1;
    stateBytes: Buffer;
    packageBytes: Buffer;
    manifestBytes: Buffer;
    sealEvent: { name: string; body: Record<string, unknown>; bytes: Buffer };
    oldSealRequest: SealFixedRigMathematicalCalibrationCaptureV1Request;
    captureArtifacts: CaptureArtifactV1[];
    analyzerRecords: MeasurementRecordV1[];
    protectedTargetRecords: MeasurementRecordV1[];
    captureEvidence: Awaited<ReturnType<FixedRigMathematicalCalibrationCaptureProducerV1["acceptedCaptureEvidenceLedger"]>>;
    targetEvidence: Awaited<ReturnType<FixedRigMathematicalCalibrationCaptureProducerV1["protectedTargetEvidenceLedger"]>>;
  }> {
    const incident = this.analyzerAuthorityRebindIncident;
    const { body: state, bytes: stateBytes } = await this.readCanonicalIncidentJson<CaptureSessionStateV1>(
      path.join(verifiedSessionDir, "capture-session.json"), "Original incident capture state");
    const captureArtifacts = state.artifacts.filter((artifact) =>
      artifact.artifactClass === "raw_capture" || artifact.artifactClass === "normalized_derivative");
    const measurementArtifacts = state.artifacts.filter((artifact) => artifact.artifactClass === "measurement");
    if (
      hash(stateBytes) !== incident.expectedPreStateSha256 ||
      state.schemaVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_SESSION_V1 ||
      state.sessionId !== incident.sessionId || state.purpose !== "mathematical_calibration_v1" ||
      typeof state.sealedAt !== "string" || state.hardStop !== undefined || state.analyzerAuthorityRebind !== undefined ||
      state.captures.length !== incident.captureCount || captureArtifacts.length !== incident.captureArtifactCount ||
      state.measurements.length !== incident.authorityCount || measurementArtifacts.length !== incident.authorityCount ||
      state.artifacts.length !== incident.captureArtifactCount + incident.authorityCount + 1 ||
      state.failedOperations.length !== incident.failureCount
    ) throw new Error("Incident rebind requires the exact canonical original sealed pre-state and ledgers.");
    await this.verifyIncidentStateArtifacts(state, verifiedSessionDir);

    const packageResult = await this.readCanonicalIncidentJson<Record<string, unknown>>(
      path.join(verifiedSessionDir, "source-capture-package.json"), "Original source capture package");
    const manifestResult = await this.readCanonicalIncidentJson<Record<string, unknown>>(
      path.join(verifiedSessionDir, "capture-manifest.json"), "Original capture manifest");
    if (
      hash(packageResult.bytes) !== incident.oldSourcePackageSha256 ||
      hash(manifestResult.bytes) !== incident.oldCaptureManifestSha256
    ) throw new Error("Incident rebind requires the exact old source package and capture manifest hashes.");
    const references = manifestReferences(manifestResult.body);
    if (references.length !== incident.manifestReferenceCount) {
      throw new Error("Old capture manifest does not contain exactly 182 protected references.");
    }
    for (const reference of references) {
      assertSha256(reference.sha256, "manifest reference SHA-256");
      if (hash(await readFile(safeSessionMember(verifiedSessionDir, reference.path, "manifest reference path"))) !== reference.sha256) {
        throw new Error(`Manifest reference ${reference.path} failed exact byte/hash verification.`);
      }
    }

    const captureEvidence = await this.acceptedCaptureEvidenceLedger(state, verifiedSessionDir);
    const targetEvidence = await this.protectedTargetEvidenceLedger(state, verifiedSessionDir);
    const { records: analyzerRecords } = await this.verifyAnalyzerAuthorityRecordsAndEvents(
      state, verifiedSessionDir, incident.oldAnalyzerSha256);
    const protectedTargetRecords = state.measurements.filter(isProtectedTargetAuthorityRecord);
    if (analyzerRecords.length + protectedTargetRecords.length !== state.measurements.length) {
      throw new Error("Original authority set contains a record outside the exact 74 analyzer and four protected-target records.");
    }

    const eventFiles = (await readdir(path.join(verifiedSessionDir, "events"))).filter((name) => name.endsWith(".json"));
    const sealEvents: Array<{ name: string; body: Record<string, unknown>; bytes: Buffer }> = [];
    for (const name of eventFiles) {
      const event = await this.readCanonicalIncidentJson<Record<string, unknown>>(
        path.join(verifiedSessionDir, "events", name), `Original event ${name}`);
      if (event.body.operation === "seal") sealEvents.push({ name, ...event });
    }
    if (sealEvents.length !== 1) throw new Error("Incident rebind requires exactly one canonical original seal event.");
    const sealEvent = sealEvents[0]!;
    const oldSealRequest = sealEvent.body.request as SealFixedRigMathematicalCalibrationCaptureV1Request;
    const expectedSealBytes = canonicalBytes({
      operation: "seal",
      request: oldSealRequest,
      packageSha256: incident.oldSourcePackageSha256,
      captureManifestSha256: incident.oldCaptureManifestSha256,
      finalizedAt: state.sealedAt,
    });
    if (
      oldSealRequest?.sessionId !== incident.sessionId ||
      sealEvent.name !== `${safeSegment(oldSealRequest.operationId)}.json` ||
      !sealEvent.bytes.equals(expectedSealBytes)
    ) throw new Error("Original seal event does not exactly reproduce the old sealed envelope.");
    return {
      state,
      stateBytes,
      packageBytes: packageResult.bytes,
      manifestBytes: manifestResult.bytes,
      sealEvent,
      oldSealRequest,
      captureArtifacts,
      analyzerRecords,
      protectedTargetRecords,
      captureEvidence,
      targetEvidence,
    };
  }

  private async verifyCompletedAnalyzerAuthorityIncidentSession(
    verifiedSessionDir: string,
    expectedJournal?: AnalyzerAuthorityRebindJournalV1,
  ): Promise<{ state: CaptureSessionStateV1; stateBytes: Buffer; receipt: AnalyzerAuthorityRebindReceiptV1 } | null> {
    const incident = this.analyzerAuthorityRebindIncident;
    const stateResult = await this.readCanonicalIncidentJson<CaptureSessionStateV1>(
      path.join(verifiedSessionDir, "capture-session.json"), "Completed incident capture state");
    const state = stateResult.body;
    const binding = state.analyzerAuthorityRebind;
    if (!binding) return null;
    const captureArtifacts = state.artifacts.filter((artifact) =>
      artifact.artifactClass === "raw_capture" || artifact.artifactClass === "normalized_derivative");
    const measurementArtifacts = state.artifacts.filter((artifact) => artifact.artifactClass === "measurement");
    if (
      state.schemaVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_SESSION_V1 ||
      state.sessionId !== incident.sessionId || state.purpose !== "mathematical_calibration_v1" ||
      typeof state.sealedAt !== "string" || state.hardStop !== undefined ||
      state.captures.length !== incident.captureCount || captureArtifacts.length !== incident.captureArtifactCount ||
      state.measurements.length !== incident.authorityCount || measurementArtifacts.length !== incident.authorityCount ||
      state.artifacts.length !== incident.captureArtifactCount + incident.authorityCount + 1 ||
      state.failedOperations.length !== incident.failureCount
    ) throw new Error("Completed incident rebind state schema, seal, counts, or hard-stop status is invalid.");
    if (
      binding.schemaVersion !== ANALYZER_AUTHORITY_REBIND_RECEIPT_V1 ||
      binding.rebindId !== incident.rebindId || binding.preStateSha256 !== incident.expectedPreStateSha256 ||
      binding.oldAnalyzerSha256 !== incident.oldAnalyzerSha256 ||
      binding.correctedAnalyzerSha256 !== incident.correctedAnalyzerSha256 ||
      binding.oldCaptureManifestSha256 !== incident.oldCaptureManifestSha256 ||
      binding.oldSourcePackageSha256 !== incident.oldSourcePackageSha256 ||
      !SHA256.test(binding.newCaptureManifestSha256) || !SHA256.test(binding.newSourcePackageSha256) ||
      !SHA256.test(binding.supersededAuthorityLedgerSha256) || !SHA256.test(binding.receiptSha256)
    ) throw new Error("Completed incident rebind state does not match the exact product-bound contract.");
    const receiptResult = await this.readCanonicalIncidentJson<AnalyzerAuthorityRebindReceiptV1>(
      safeSessionMember(verifiedSessionDir, binding.receiptPath, "rebind receipt path"), "Completed incident rebind receipt");
    if (hash(receiptResult.bytes) !== binding.receiptSha256) {
      throw new Error("Completed incident rebind receipt SHA-256 does not match state linkage.");
    }
    const receipt = receiptResult.body;
    const { receiptSha256: _ignored, ...expectedReceiptBinding } = binding;
    for (const [key, value] of Object.entries(expectedReceiptBinding)) {
      if (hash(canonicalBytes((receipt as unknown as Record<string, unknown>)[key])) !== hash(canonicalBytes(value))) {
        throw new Error("Completed incident rebind receipt and state linkage differ.");
      }
    }
    if (
      receipt.sessionId !== incident.sessionId || receipt.reboundAt !== state.sealedAt ||
      receipt.correctedAuthority.count !== incident.analyzerAuthorityCount ||
      receipt.sealOperationId !== "cal-seal-analyzer-rebind-20260722-v1"
    ) throw new Error("Completed incident rebind receipt identity, time, authority count, or seal operation is invalid.");
    if (expectedJournal && (
      expectedJournal.expectedInstalledStateSha256 !== hash(stateResult.bytes) ||
      expectedJournal.expectedReceiptSha256 !== binding.receiptSha256
    )) throw new Error("Installed completed state does not match the authenticated incident journal.");

    await this.verifyIncidentStateArtifacts(state, verifiedSessionDir);
    const captureEvidence = await this.acceptedCaptureEvidenceLedger(state, verifiedSessionDir);
    const targetEvidence = await this.protectedTargetEvidenceLedger(state, verifiedSessionDir);
    if (
      captureEvidence.capturesSha256 !== receipt.preservedEvidence.capturesSha256 ||
      captureEvidence.artifactsSha256 !== receipt.preservedEvidence.captureArtifactsSha256 ||
      captureEvidence.eventsSha256 !== receipt.preservedEvidence.captureEventsSha256 ||
      hash(canonicalBytes(state.failedOperations)) !== receipt.preservedEvidence.failuresSha256 ||
      targetEvidence.authoritySha256 !== receipt.preservedEvidence.protectedTargetAuthoritySha256 ||
      targetEvidence.artifactsSha256 !== receipt.preservedEvidence.protectedTargetArtifactsSha256 ||
      targetEvidence.eventsSha256 !== receipt.preservedEvidence.protectedTargetEventsSha256
    ) throw new Error("Completed incident rebind no longer reproduces its preserved capture, failure, or protected-target ledgers.");
    const corrected = await this.verifyAnalyzerAuthorityRecordsAndEvents(
      state, verifiedSessionDir, incident.correctedAnalyzerSha256);
    if (
      hash(canonicalBytes(corrected.records)) !== receipt.correctedAuthority.recordsSha256 ||
      hash(canonicalBytes(corrected.artifacts)) !== receipt.correctedAuthority.artifactsSha256
    ) throw new Error("Completed corrected analyzer authority aggregate no longer matches its receipt.");

    const packageResult = await this.readCanonicalIncidentJson<Record<string, unknown>>(
      path.join(verifiedSessionDir, "source-capture-package.json"), "Completed source capture package");
    const manifestResult = await this.readCanonicalIncidentJson<Record<string, unknown>>(
      path.join(verifiedSessionDir, "capture-manifest.json"), "Completed capture manifest");
    if (
      hash(packageResult.bytes) !== receipt.newSourcePackageSha256 ||
      hash(manifestResult.bytes) !== receipt.newCaptureManifestSha256
    ) throw new Error("Completed new source package or capture manifest no longer matches its receipt.");
    const references = manifestReferences(manifestResult.body);
    if (references.length !== incident.reboundManifestReferenceCount) {
      throw new Error("Completed capture manifest does not contain the exact 183 protected references.");
    }
    for (const reference of references) {
      assertSha256(reference.sha256, "completed manifest reference SHA-256");
      if (hash(await readFile(safeSessionMember(verifiedSessionDir, reference.path, "completed manifest reference path"))) !== reference.sha256) {
        throw new Error(`Completed manifest reference ${reference.path} failed exact byte/hash verification.`);
      }
    }

    const ledgerResult = await this.readCanonicalIncidentJson<Record<string, unknown>>(
      safeSessionMember(verifiedSessionDir, receipt.supersededAuthorityLedgerPath, "superseded authority ledger path"),
      "Superseded analyzer-authority ledger");
    if (hash(ledgerResult.bytes) !== receipt.supersededAuthorityLedgerSha256) {
      throw new Error("Superseded analyzer-authority ledger no longer matches its receipt.");
    }
    const ledger = ledgerResult.body as {
      schemaVersion?: unknown;
      rebindId?: unknown;
      sessionId?: unknown;
      oldAnalyzerSha256?: unknown;
      authorityCount?: unknown;
      sealedEnvelope?: SupersededSealedEnvelopeV1;
      entries?: Array<{
        operationId: string;
        record: MeasurementRecordV1;
        artifact: CaptureArtifactV1;
        authorityFile: PreservedIncidentFileV1;
        eventFile: PreservedIncidentFileV1;
      }>;
    };
    if (
      ledger.schemaVersion !== ANALYZER_AUTHORITY_SUPERSEDED_LEDGER_V1 ||
      ledger.rebindId !== incident.rebindId || ledger.sessionId !== incident.sessionId ||
      ledger.oldAnalyzerSha256 !== incident.oldAnalyzerSha256 ||
      ledger.authorityCount !== incident.analyzerAuthorityCount ||
      !ledger.sealedEnvelope || !Array.isArray(ledger.entries) ||
      ledger.entries.length !== incident.analyzerAuthorityCount ||
      hash(canonicalBytes(ledger.sealedEnvelope)) !== hash(canonicalBytes(receipt.supersededEnvelope))
    ) throw new Error("Superseded analyzer-authority ledger identity, envelope, or entry count is invalid.");

    const verifyPreservedCopy = async (descriptor: PreservedIncidentFileV1, label: string): Promise<Buffer> => {
      if (
        typeof descriptor.originalPath !== "string" || typeof descriptor.preservedPath !== "string" ||
        !SHA256.test(descriptor.sha256) || !Number.isInteger(descriptor.byteSize) || descriptor.byteSize < 1
      ) throw new Error(`${label} descriptor is invalid.`);
      const copyPath = safeSessionMember(verifiedSessionDir, descriptor.preservedPath, `${label} preserved path`);
      const bytes = await readFile(copyPath);
      const metadata = await stat(copyPath);
      if (hash(bytes) !== descriptor.sha256 || bytes.length !== descriptor.byteSize || metadata.size !== descriptor.byteSize) {
        throw new Error(`${label} preserved copy failed exact byte/hash/size verification.`);
      }
      return bytes;
    };
    const envelope = ledger.sealedEnvelope;
    const preservedStateBytes = await verifyPreservedCopy(envelope.captureSession, "superseded capture state");
    const preservedPackageBytes = await verifyPreservedCopy(envelope.sourceCapturePackage, "superseded source package");
    const preservedManifestBytes = await verifyPreservedCopy(envelope.captureManifest, "superseded capture manifest");
    const preservedSealEventBytes = await verifyPreservedCopy(envelope.sealEvent, "superseded seal event");
    if (
      envelope.captureSession.originalPath !== "capture-session.json" ||
      envelope.sourceCapturePackage.originalPath !== "source-capture-package.json" ||
      envelope.captureManifest.originalPath !== "capture-manifest.json" ||
      !envelope.sealEvent.originalPath.startsWith("events/") ||
      hash(preservedStateBytes) !== incident.expectedPreStateSha256 ||
      hash(preservedPackageBytes) !== incident.oldSourcePackageSha256 ||
      hash(preservedManifestBytes) !== incident.oldCaptureManifestSha256
    ) throw new Error("Superseded complete sealed envelope does not reproduce the exact original incident.");
    const preservedState = JSON.parse(preservedStateBytes.toString("utf-8")) as CaptureSessionStateV1;
    if (!preservedStateBytes.equals(canonicalBytes(preservedState))) {
      throw new Error("Superseded capture state copy is not canonical JSON.");
    }
    const preservedSeal = JSON.parse(preservedSealEventBytes.toString("utf-8")) as Record<string, unknown>;
    const preservedSealRequest = preservedSeal.request as SealFixedRigMathematicalCalibrationCaptureV1Request;
    if (!preservedSealEventBytes.equals(canonicalBytes({
      operation: "seal",
      request: preservedSealRequest,
      packageSha256: incident.oldSourcePackageSha256,
      captureManifestSha256: incident.oldCaptureManifestSha256,
      finalizedAt: preservedState.sealedAt,
    }))) throw new Error("Superseded seal event copy does not reproduce the original complete sealed envelope.");

    const seenOperations = new Set<string>();
    for (const entry of ledger.entries) {
      if (seenOperations.has(entry.operationId) || entry.operationId !== entry.record.operationId || entry.artifact.operationId !== entry.operationId) {
        throw new Error("Superseded analyzer-authority ledger contains a duplicate or mismatched operation.");
      }
      seenOperations.add(entry.operationId);
      const oldInstrument = entry.record.payload.instrument as { calibrationSha256?: unknown };
      if (oldInstrument.calibrationSha256 !== incident.oldAnalyzerSha256 || entry.artifact.evidenceId !== entry.record.evidenceId) {
        throw new Error("Superseded analyzer-authority entry is not bound to the exact old analyzer record and artifact.");
      }
      const authorityBytes = await verifyPreservedCopy(entry.authorityFile, `superseded authority ${entry.operationId}`);
      const eventBytes = await verifyPreservedCopy(entry.eventFile, `superseded event ${entry.operationId}`);
      if (
        entry.authorityFile.originalPath !== entry.artifact.path ||
        !authorityBytes.equals(canonicalBytes(measurementArtifactBody(entry.record))) ||
        !eventBytes.equals(canonicalBytes({
          operation: "record-measurement",
          request: measurementArtifactBody(entry.record),
          artifact: entry.artifact,
        }))
      ) throw new Error(`Superseded analyzer-authority copy ${entry.operationId} does not reproduce its ledger entry.`);
    }

    const expectedLedgerReference: AnalyzerAuthoritySupersessionLedgerReferenceV1 = {
      schemaVersion: ANALYZER_AUTHORITY_SUPERSEDED_LEDGER_V1,
      rebindId: incident.rebindId,
      path: receipt.supersededAuthorityLedgerPath,
      sha256: receipt.supersededAuthorityLedgerSha256,
      byteSize: ledgerResult.bytes.length,
    };
    if (
      hash(canonicalBytes(packageResult.body.analyzerAuthoritySupersession)) !== hash(canonicalBytes(expectedLedgerReference)) ||
      hash(canonicalBytes(manifestResult.body.analyzerAuthoritySupersession)) !== hash(canonicalBytes(expectedLedgerReference))
    ) throw new Error("New sealed package and manifest do not reference the exact pre-seal supersession ledger.");
    const currentSealResult = await this.readCanonicalIncidentJson<Record<string, unknown>>(
      path.join(verifiedSessionDir, "events", `${safeSegment(receipt.sealOperationId)}.json`), "Current incident seal event");
    const currentSealRequest = currentSealResult.body.request as SealFixedRigMathematicalCalibrationCaptureV1Request;
    if (
      currentSealRequest?.sessionId !== incident.sessionId || currentSealRequest.operationId !== receipt.sealOperationId ||
      !currentSealResult.bytes.equals(canonicalBytes({
      operation: "seal",
      request: currentSealRequest,
      packageSha256: receipt.newSourcePackageSha256,
      captureManifestSha256: receipt.newCaptureManifestSha256,
      finalizedAt: state.sealedAt,
    }))
    ) throw new Error("Current incident seal event does not reproduce the completed sealed envelope.");
    return { state, stateBytes: stateResult.bytes, receipt };
  }

  async rebindKnownSealedAnalyzerAuthority(): Promise<FixedRigMathematicalCalibrationAnalyzerAuthorityRebindV1> {
    return this.serialized(async () => {
      const incident = this.analyzerAuthorityRebindIncident;
      if (this.config.contractVersion === "v1.1") {
        throw new Error("The incident-bound analyzer-authority rebind is unavailable to V1.1 producers.");
      }
      const sessionDir = this.sessionDir(incident.sessionId);
      const stageRoot = path.join(this.config.outputRoot, ".analyzer-authority-rebind-stage-v1");
      const stageSessionDir = path.join(stageRoot, incident.sessionId);
      const backupDir = `${sessionDir}.analyzer-authority-rebind-backup-v1`;
      const quarantineDir = `${sessionDir}.analyzer-authority-rebind-quarantine-v1`;
      const journalPath = path.join(this.config.outputRoot, `.${incident.sessionId}.analyzer-authority-rebind-journal-v1.json`);
      const readAuthenticatedJournal = async (): Promise<AnalyzerAuthorityRebindJournalV1> => {
        const result = await this.readCanonicalIncidentJson<AnalyzerAuthorityRebindJournalV1>(
          journalPath, "Incident analyzer-authority rebind journal");
        const journal = result.body;
        if (
          journal.schemaVersion !== ANALYZER_AUTHORITY_REBIND_JOURNAL_V1 ||
          journal.rebindId !== incident.rebindId || journal.sessionId !== incident.sessionId ||
          journal.expectedPreStateSha256 !== incident.expectedPreStateSha256 ||
          journal.oldAnalyzerSha256 !== incident.oldAnalyzerSha256 ||
          journal.correctedAnalyzerSha256 !== incident.correctedAnalyzerSha256 ||
          journal.oldCaptureManifestSha256 !== incident.oldCaptureManifestSha256 ||
          journal.oldSourcePackageSha256 !== incident.oldSourcePackageSha256 ||
          !SHA256.test(journal.expectedInstalledStateSha256) || !SHA256.test(journal.expectedReceiptSha256)
        ) throw new Error("Incident analyzer-authority rebind journal is not the exact authenticated fixed-incident contract.");
        return journal;
      };
      const restoreOriginalBackup = async (reason: unknown): Promise<never> => {
        await this.verifyOriginalAnalyzerAuthorityIncidentSession(backupDir);
        if (!existsSync(sessionDir) || !existsSync(backupDir)) {
          throw new Error("Incident rollback requires both the failed installed replacement and exact original backup.");
        }
        if (existsSync(quarantineDir)) {
          throw new Error("Incident rollback refused to overwrite an existing quarantined replacement; live and backup remain preserved.");
        }
        await rename(sessionDir, quarantineDir);
        try {
          await rename(backupDir, sessionDir);
        } catch (restoreError) {
          await rename(quarantineDir, sessionDir);
          throw restoreError;
        }
        await this.verifyOriginalAnalyzerAuthorityIncidentSession(sessionDir);
        await rm(stageRoot, { recursive: true, force: true });
        await rm(journalPath, { force: true });
        throw new Error(`Installed incident rebind failed full verification; the exact original was restored and the replacement quarantined: ${String(reason)}`);
      };
      const restoreOriginalBackupBeforeInstall = async (reason: unknown): Promise<never> => {
        await this.verifyOriginalAnalyzerAuthorityIncidentSession(backupDir);
        let stagedDisposition = "missing";
        if (existsSync(stageSessionDir)) {
          if (existsSync(quarantineDir)) {
            stagedDisposition = "preserved at its staged path because the quarantine path is already occupied";
          } else {
            await rename(stageSessionDir, quarantineDir);
            stagedDisposition = "quarantined";
          }
        }
        await rename(backupDir, sessionDir);
        await this.verifyOriginalAnalyzerAuthorityIncidentSession(sessionDir);
        if (this.analyzerAuthorityRebindTestFailpoint === "after-original-restore") {
          throw new Error("TEST_ONLY_ANALYZER_REBIND_FAILPOINT_AFTER_ORIGINAL_RESTORE");
        }
        if (!existsSync(stageSessionDir)) await rm(stageRoot, { recursive: true, force: true });
        await rm(journalPath, { force: true });
        throw new Error(
          `Journal-bound staged replacement was missing or invalid; the exact original was restored at its canonical path; retry the operation. ` +
          `The staged replacement was ${stagedDisposition}: ${String(reason)}`,
        );
      };
      if (existsSync(journalPath)) {
        const journal = await readAuthenticatedJournal();
        const liveExists = existsSync(sessionDir);
        const backupExists = existsSync(backupDir);
        if (!liveExists && backupExists) {
          await this.verifyOriginalAnalyzerAuthorityIncidentSession(backupDir);
          let staged;
          try {
            if (!existsSync(stageSessionDir)) throw new Error("Journal-bound backup recovery is missing its staged replacement.");
            staged = await this.verifyCompletedAnalyzerAuthorityIncidentSession(stageSessionDir, journal);
            if (!staged) throw new Error("Journal-bound staged replacement is not a completed incident rebind.");
          } catch (error) {
            return restoreOriginalBackupBeforeInstall(error);
          }
          await rename(backupDir, sessionDir);
          await this.verifyOriginalAnalyzerAuthorityIncidentSession(sessionDir);
          await rm(stageRoot, { recursive: true, force: true });
          await rm(journalPath, { force: true });
        } else if (liveExists && backupExists) {
          await this.verifyOriginalAnalyzerAuthorityIncidentSession(backupDir);
          let installed;
          try {
            installed = await this.verifyCompletedAnalyzerAuthorityIncidentSession(sessionDir, journal);
            if (!installed) throw new Error("Installed replacement is not a completed incident rebind.");
          } catch (error) {
            return restoreOriginalBackup(error);
          }
          await rm(backupDir, { recursive: true, force: true });
          await rm(stageRoot, { recursive: true, force: true });
          await rm(journalPath, { force: true });
          return { status: statusFor(installed.state, sessionDir), receipt: installed.receipt, idempotent: true };
        } else if (liveExists && !backupExists) {
          const liveBytes = await readFile(path.join(sessionDir, "capture-session.json"));
          if (hash(liveBytes) === incident.expectedPreStateSha256) {
            await this.verifyOriginalAnalyzerAuthorityIncidentSession(sessionDir);
            let removeDisposableStageRoot = false;
            if (!existsSync(stageSessionDir)) {
              removeDisposableStageRoot = true;
            } else {
              let staged;
              try {
                staged = await this.verifyCompletedAnalyzerAuthorityIncidentSession(stageSessionDir);
                if (!staged) throw new Error("Journal-bound staged replacement is not a completed incident rebind.");
              } catch {
                if (!existsSync(quarantineDir)) {
                  await rename(stageSessionDir, quarantineDir);
                  removeDisposableStageRoot = true;
                }
              }
              if (staged) {
                await this.verifyCompletedAnalyzerAuthorityIncidentSession(stageSessionDir, journal);
                removeDisposableStageRoot = true;
              }
            }
            if (removeDisposableStageRoot) await rm(stageRoot, { recursive: true, force: true });
            await rm(journalPath, { force: true });
          } else {
            const installed = await this.verifyCompletedAnalyzerAuthorityIncidentSession(sessionDir, journal);
            if (!installed) throw new Error("Journal-bound live session is neither the exact original nor a completed replacement.");
            await rm(stageRoot, { recursive: true, force: true });
            await rm(journalPath, { force: true });
            return { status: statusFor(installed.state, sessionDir), receipt: installed.receipt, idempotent: true };
          }
        } else {
          throw new Error("Incident rebind recovery found neither a live session nor its exact original backup.");
        }
      }

      const completed = await this.verifyCompletedAnalyzerAuthorityIncidentSession(sessionDir);
      if (completed) {
        return { status: statusFor(completed.state, sessionDir), receipt: completed.receipt, idempotent: true };
      }

      const analyzerPath = path.resolve(__dirname, "../../../../scripts/ai-grader/analyze-mathematical-calibration-v1.py");
      const analyzerSha256 = hash(await readFile(analyzerPath));
      if (analyzerSha256 !== incident.correctedAnalyzerSha256) {
        throw new Error("Portable corrected analyzer bytes do not match the exact incident-bound SHA-256.");
      }
      const original = await this.verifyOriginalAnalyzerAuthorityIncidentSession(sessionDir);
      const {
        state,
        stateBytes: initialStateBytes,
        packageBytes,
        manifestBytes,
        sealEvent,
        oldSealRequest,
        captureArtifacts,
        analyzerRecords,
        protectedTargetRecords,
        captureEvidence,
        targetEvidence,
      } = original;
      const protectedTargetRecordsSha256 = targetEvidence.authoritySha256;
      const protectedTargetEvidenceIds = new Set(protectedTargetRecords.map((record) => record.evidenceId));
      const protectedTargetArtifacts = state.artifacts.filter((artifact) =>
        artifact.artifactClass === "target" || protectedTargetEvidenceIds.has(artifact.evidenceId));
      const derive = this.config.deriveAnalyzerAuthorityRebindRequests;
      if (!derive) throw new Error("The protected corrected-analyzer authority derivation is unavailable.");
      const requests = await derive(sessionDir);
      if (!Array.isArray(requests) || requests.length !== incident.authorityCount) {
        throw new Error("Corrected analyzer derivation did not produce exactly 78 authority requests.");
      }
      const analyzerRequests = requests.filter((request) =>
        request.measurementType === "direction_geometry" || request.measurementType === "measurement_repeatability");
      const targetRequests = requests.filter((request) =>
        request.measurementType === "print_scale" || request.measurementType === "target_cut_dimension");
      if (analyzerRequests.length !== incident.analyzerAuthorityCount || targetRequests.length !== incident.protectedTargetAuthorityCount) {
        throw new Error("Corrected derivation has missing, extra, or misclassified authority requests.");
      }
      const requestOperations = requests.map((request) => request.operationId);
      if (new Set(requestOperations).size !== requests.length) throw new Error("Corrected authority derivation contains duplicate operations.");

      const oldByOperation = new Map(state.measurements.map((record) => [record.operationId, record]));
      for (const request of targetRequests) {
        const old = oldByOperation.get(request.operationId);
        if (!old || !isProtectedTargetAuthorityRecord(old)) throw new Error("Protected-target authority request identity changed.");
        const requestWithoutEnvelope = structuredClone(request) as unknown as Record<string, unknown>;
        delete requestWithoutEnvelope.sessionId;
        delete requestWithoutEnvelope.operationId;
        delete requestWithoutEnvelope.measurementType;
        const oldComparable = structuredClone(old.payload);
        delete oldComparable.operatorId;
        delete oldComparable.recordedAt;
        delete oldComparable.sourceTargetSha256;
        if (hash(canonicalBytes(oldComparable)) !== hash(canonicalBytes(requestWithoutEnvelope))) {
          throw new Error("Four protected-target authority records are not byte-semantically unchanged.");
        }
      }

      const correctedRecordsByOperation = new Map<string, MeasurementRecordV1>();
      const correctedArtifactsByOperation = new Map<string, CaptureArtifactV1>();
      const supersededEntries: Record<string, unknown>[] = [];
      const supersededCopies = new Map<string, Buffer>();
      for (const request of analyzerRequests) {
        const old = oldByOperation.get(request.operationId);
        if (!old || !isAnalyzerAuthorityRecord(old) || old.measurementType !== request.measurementType) {
          throw new Error("Corrected analyzer request is missing or does not match one exact old authority operation.");
        }
        const expectedNewPayload = expectedAnalyzerPayloadFromRequest(request, old, state);
        const expectedOldPayload = structuredClone(expectedNewPayload);
        const oldInstrument = structuredClone(expectedOldPayload.instrument as Record<string, unknown>);
        if (oldInstrument.calibrationSha256 !== incident.correctedAnalyzerSha256) {
          throw new Error("Corrected authority request does not bind the exact portable analyzer SHA-256.");
        }
        oldInstrument.calibrationSha256 = incident.oldAnalyzerSha256;
        expectedOldPayload.instrument = oldInstrument;
        if (hash(canonicalBytes(old.payload)) !== hash(canonicalBytes(expectedOldPayload))) {
          throw new Error("Corrected analyzer changed numeric, U95, source provenance, method, algorithm, or another non-analyzer field.");
        }
        const oldArtifact = state.artifacts.find((artifact) => artifact.evidenceId === old.evidenceId);
        if (!oldArtifact || oldArtifact.artifactClass !== "measurement" || oldArtifact.operationId !== old.operationId) {
          throw new Error("Old analyzer authority artifact declaration is missing or mismatched.");
        }
        const oldFilePath = safeSessionMember(sessionDir, oldArtifact.path, "old analyzer authority path");
        const oldFileBytes = await readFile(oldFilePath);
        if (!oldFileBytes.equals(canonicalBytes(measurementArtifactBody(old)))) {
          throw new Error("Old analyzer authority file does not reproduce its immutable record.");
        }
        const oldEventPath = path.join(sessionDir, "events", `${safeSegment(old.operationId)}.json`);
        const oldEventBytes = await readFile(oldEventPath);
        const expectedOldEventBytes = canonicalBytes({
          operation: "record-measurement",
          request: measurementArtifactBody(old),
          artifact: oldArtifact,
        });
        if (!oldEventBytes.equals(expectedOldEventBytes)) {
          throw new Error("Old analyzer authority event does not reproduce its immutable record and artifact.");
        }
        const preservedAuthorityPath = portable(
          "rebind", incident.rebindId, "superseded-authority", "files", `${hash(oldFileBytes)}.json`);
        const preservedEventPath = portable(
          "rebind", incident.rebindId, "superseded-authority", "events", `${hash(oldEventBytes)}.json`);
        supersededCopies.set(preservedAuthorityPath, oldFileBytes);
        supersededCopies.set(preservedEventPath, oldEventBytes);
        const correctedRecord: MeasurementRecordV1 = { ...structuredClone(old), payload: expectedNewPayload };
        const correctedBytes = canonicalBytes(measurementArtifactBody(correctedRecord));
        const correctedArtifact: CaptureArtifactV1 = {
          ...structuredClone(oldArtifact), sha256: hash(correctedBytes), byteSize: correctedBytes.length,
        };
        correctedRecordsByOperation.set(old.operationId, correctedRecord);
        correctedArtifactsByOperation.set(old.operationId, correctedArtifact);
        supersededEntries.push({
          operationId: old.operationId,
          record: old,
          artifact: oldArtifact,
          authorityFile: {
            originalPath: oldArtifact.path, preservedPath: preservedAuthorityPath,
            sha256: hash(oldFileBytes), byteSize: oldFileBytes.length,
          },
          eventFile: {
            originalPath: portable("events", `${safeSegment(old.operationId)}.json`), preservedPath: preservedEventPath,
            sha256: hash(oldEventBytes), byteSize: oldEventBytes.length,
          },
        });
      }
      if (correctedRecordsByOperation.size !== incident.analyzerAuthorityCount) {
        throw new Error("Corrected analyzer authority is missing or duplicates one of the 74 exact operations.");
      }

      const preservedEnvelopeFile = (
        originalPath: string,
        className: string,
        bytes: Buffer,
      ): PreservedIncidentFileV1 => {
        const preservedPath = portable(
          "rebind", incident.rebindId, "superseded-envelope", className, `${hash(bytes)}.json`);
        supersededCopies.set(preservedPath, bytes);
        return { originalPath, preservedPath, sha256: hash(bytes), byteSize: bytes.length };
      };
      const supersededEnvelope: SupersededSealedEnvelopeV1 = {
        captureSession: preservedEnvelopeFile("capture-session.json", "capture-session", initialStateBytes),
        sourceCapturePackage: preservedEnvelopeFile("source-capture-package.json", "source-package", packageBytes),
        captureManifest: preservedEnvelopeFile("capture-manifest.json", "capture-manifest", manifestBytes),
        sealEvent: preservedEnvelopeFile(portable("events", sealEvent.name), "seal-event", sealEvent.bytes),
      };
      const preservedEvidence = {
        capturesSha256: captureEvidence.capturesSha256,
        captureArtifactsSha256: captureEvidence.artifactsSha256,
        captureEventsSha256: captureEvidence.eventsSha256,
        failuresSha256: hash(canonicalBytes(state.failedOperations)),
        protectedTargetAuthoritySha256: protectedTargetRecordsSha256,
        protectedTargetArtifactsSha256: targetEvidence.artifactsSha256,
        protectedTargetEventsSha256: targetEvidence.eventsSha256,
      };
      const supersededLedgerBody = {
        schemaVersion: ANALYZER_AUTHORITY_SUPERSEDED_LEDGER_V1,
        rebindId: incident.rebindId,
        sessionId: incident.sessionId,
        oldAnalyzerSha256: incident.oldAnalyzerSha256,
        oldCaptureManifestSha256: incident.oldCaptureManifestSha256,
        oldSourcePackageSha256: incident.oldSourcePackageSha256,
        sealedEnvelope: supersededEnvelope,
        authorityCount: supersededEntries.length,
        entries: supersededEntries,
      };
      const supersededLedgerBytes = canonicalBytes(supersededLedgerBody);
      const supersededLedgerRelativePath = portable("rebind", incident.rebindId, "superseded-analyzer-authority-ledger.json");
      const supersessionLedgerReference: AnalyzerAuthoritySupersessionLedgerReferenceV1 = {
        schemaVersion: ANALYZER_AUTHORITY_SUPERSEDED_LEDGER_V1,
        rebindId: incident.rebindId,
        path: supersededLedgerRelativePath,
        sha256: hash(supersededLedgerBytes),
        byteSize: supersededLedgerBytes.length,
      };

      await rm(stageRoot, { recursive: true, force: true });
      await mkdir(stageRoot, { recursive: true });
      await cp(sessionDir, stageSessionDir, { recursive: true, errorOnExist: true, force: false });
      for (const [relativePath, bytes] of supersededCopies) {
        await writeExclusive(safeSessionMember(stageSessionDir, relativePath, "superseded authority copy path"), bytes);
      }
      const stagedState = structuredClone(state);
      stagedState.measurements = stagedState.measurements.map((record) => correctedRecordsByOperation.get(record.operationId) ?? record);
      stagedState.artifacts = stagedState.artifacts.map((artifact) => correctedArtifactsByOperation.get(artifact.operationId) ?? artifact);
      delete stagedState.sealedAt;
      delete stagedState.analyzerAuthorityRebind;
      for (const record of analyzerRecords) {
        const correctedRecord = correctedRecordsByOperation.get(record.operationId)!;
        const correctedArtifact = correctedArtifactsByOperation.get(record.operationId)!;
        const correctedBytes = canonicalBytes(measurementArtifactBody(correctedRecord));
        await writeFile(safeSessionMember(stageSessionDir, correctedArtifact.path, "staged corrected authority path"), correctedBytes);
        await writeFile(
          path.join(stageSessionDir, "events", `${safeSegment(record.operationId)}.json`),
          canonicalBytes({ operation: "record-measurement", request: measurementArtifactBody(correctedRecord), artifact: correctedArtifact }),
        );
      }
      await writeExclusive(safeSessionMember(stageSessionDir, supersededLedgerRelativePath, "superseded authority ledger path"), supersededLedgerBytes);
      await rm(path.join(stageSessionDir, "source-capture-package.json"), { force: true });
      await rm(path.join(stageSessionDir, "capture-manifest.json"), { force: true });
      await rm(path.join(stageSessionDir, "events", sealEvent.name), { force: true });
      await writeJsonAtomic(path.join(stageSessionDir, "capture-session.json"), stagedState);

      const stagedProducer = new FixedRigMathematicalCalibrationCaptureProducerV1({
        ...this.config,
        outputRoot: stageRoot,
      });
      stagedProducer.analyzerAuthoritySupersessionLedgerForSeal = supersessionLedgerReference;
      const sealOperationId = "cal-seal-analyzer-rebind-20260722-v1";
      const resealed = await stagedProducer.seal({
        sessionId: incident.sessionId,
        operationId: sealOperationId,
        profileId: oldSealRequest.profileId,
        calibrationVersion: oldSealRequest.calibrationVersion,
        artifactId: oldSealRequest.artifactId,
      });
      const resealedStatePath = path.join(stageSessionDir, "capture-session.json");
      const resealedState = JSON.parse((await readFile(resealedStatePath)).toString("utf-8")) as CaptureSessionStateV1;
      if (
        hash(canonicalBytes(resealedState.captures)) !== preservedEvidence.capturesSha256 ||
        hash(canonicalBytes(resealedState.failedOperations)) !== preservedEvidence.failuresSha256 ||
        hash(canonicalBytes(resealedState.artifacts.filter((artifact) =>
          artifact.artifactClass === "raw_capture" || artifact.artifactClass === "normalized_derivative")
          .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)))) !== preservedEvidence.captureArtifactsSha256 ||
        hash(canonicalBytes(resealedState.measurements.filter(isProtectedTargetAuthorityRecord))) !== preservedEvidence.protectedTargetAuthoritySha256
        || hash(canonicalBytes(resealedState.artifacts.filter((artifact) =>
          artifact.artifactClass === "target" || protectedTargetEvidenceIds.has(artifact.evidenceId)))) !== preservedEvidence.protectedTargetArtifactsSha256
      ) throw new Error("Staged reseal changed preserved capture, artifact, failure, or protected-target authority evidence.");
      const correctedRecords = resealedState.measurements.filter(isAnalyzerAuthorityRecord);
      const correctedArtifacts = resealedState.artifacts.filter((artifact) =>
        artifact.artifactClass === "measurement" && correctedRecords.some((record) => record.evidenceId === artifact.evidenceId));
      const reboundAt = resealedState.sealedAt!;
      const receiptRelativePath = portable("rebind", incident.rebindId, "analyzer-authority-rebind-receipt.json");
      const receiptWithoutSha: AnalyzerAuthorityRebindReceiptV1 = {
        schemaVersion: ANALYZER_AUTHORITY_REBIND_RECEIPT_V1,
        rebindId: incident.rebindId,
        reboundAt,
        oldAnalyzerSha256: incident.oldAnalyzerSha256,
        correctedAnalyzerSha256: incident.correctedAnalyzerSha256,
        preStateSha256: incident.expectedPreStateSha256,
        oldCaptureManifestSha256: incident.oldCaptureManifestSha256,
        oldSourcePackageSha256: incident.oldSourcePackageSha256,
        newCaptureManifestSha256: resealed.captureManifest.sha256,
        newSourcePackageSha256: resealed.sourceCapturePackage.sha256,
        supersededAuthorityLedgerPath: supersededLedgerRelativePath,
        supersededAuthorityLedgerSha256: hash(supersededLedgerBytes),
        supersededEnvelope,
        receiptPath: receiptRelativePath,
        sessionId: incident.sessionId,
        preservedEvidence,
        correctedAuthority: {
          count: correctedRecords.length,
          recordsSha256: hash(canonicalBytes(correctedRecords)),
          artifactsSha256: hash(canonicalBytes(correctedArtifacts)),
        },
        sealOperationId,
      };
      const receiptBytes = canonicalBytes(receiptWithoutSha);
      await writeExclusive(safeSessionMember(stageSessionDir, receiptRelativePath, "rebind receipt path"), receiptBytes);
      resealedState.analyzerAuthorityRebind = {
        schemaVersion: ANALYZER_AUTHORITY_REBIND_RECEIPT_V1,
        rebindId: incident.rebindId,
        reboundAt,
        oldAnalyzerSha256: incident.oldAnalyzerSha256,
        correctedAnalyzerSha256: incident.correctedAnalyzerSha256,
        preStateSha256: incident.expectedPreStateSha256,
        oldCaptureManifestSha256: incident.oldCaptureManifestSha256,
        oldSourcePackageSha256: incident.oldSourcePackageSha256,
        newCaptureManifestSha256: resealed.captureManifest.sha256,
        newSourcePackageSha256: resealed.sourceCapturePackage.sha256,
        supersededAuthorityLedgerPath: supersededLedgerRelativePath,
        supersededAuthorityLedgerSha256: hash(supersededLedgerBytes),
        supersededEnvelope,
        receiptPath: receiptRelativePath,
        receiptSha256: hash(receiptBytes),
      };
      await writeJsonAtomic(resealedStatePath, resealedState);
      const stagedCompleted = await this.verifyCompletedAnalyzerAuthorityIncidentSession(stageSessionDir);
      if (!stagedCompleted) throw new Error("Staged incident rebind is missing its completed-state authority.");
      const journal: AnalyzerAuthorityRebindJournalV1 = {
        schemaVersion: ANALYZER_AUTHORITY_REBIND_JOURNAL_V1,
        rebindId: incident.rebindId,
        sessionId: incident.sessionId,
        expectedPreStateSha256: incident.expectedPreStateSha256,
        oldAnalyzerSha256: incident.oldAnalyzerSha256,
        correctedAnalyzerSha256: incident.correctedAnalyzerSha256,
        oldCaptureManifestSha256: incident.oldCaptureManifestSha256,
        oldSourcePackageSha256: incident.oldSourcePackageSha256,
        expectedInstalledStateSha256: hash(stagedCompleted.stateBytes),
        expectedReceiptSha256: stagedCompleted.state.analyzerAuthorityRebind!.receiptSha256,
      };
      await writeJsonAtomic(journalPath, journal);
      if (this.analyzerAuthorityRebindTestFailpoint === "after-stage") {
        throw new Error("TEST_ONLY_ANALYZER_REBIND_FAILPOINT_AFTER_STAGE");
      }
      await rename(sessionDir, backupDir);
      if (this.analyzerAuthorityRebindTestFailpoint === "after-backup-rename") {
        throw new Error("TEST_ONLY_ANALYZER_REBIND_FAILPOINT_AFTER_BACKUP_RENAME");
      }
      try {
        await rename(stageSessionDir, sessionDir);
      } catch (error) {
        await rename(backupDir, sessionDir);
        throw error;
      }
      if (this.analyzerAuthorityRebindTestFailpoint === "after-stage-to-live") {
        throw new Error("TEST_ONLY_ANALYZER_REBIND_FAILPOINT_AFTER_STAGE_TO_LIVE");
      }
      let installed;
      try {
        installed = await this.verifyCompletedAnalyzerAuthorityIncidentSession(sessionDir, journal);
        if (!installed) throw new Error("Installed incident rebind is missing its completed-state authority.");
      } catch (error) {
        return restoreOriginalBackup(error);
      }
      await this.verifyOriginalAnalyzerAuthorityIncidentSession(backupDir);
      await rm(backupDir, { recursive: true, force: true });
      await rm(stageRoot, { recursive: true, force: true });
      await rm(journalPath, { force: true });
      return { status: statusFor(installed.state, sessionDir), receipt: installed.receipt, idempotent: false };
    });
  }

  async recordHardStop(sessionId: string, operationId: string, reason: string): Promise<FixedRigMathematicalCalibrationCaptureSessionStatusV1> {
    return this.serialized(async () => {
      assertSafeId(sessionId, "sessionId");
      assertSafeId(operationId, "operationId");
      const state = await this.load(sessionId);
      if (!state.hardStop) {
        const stoppedAt = (this.config.now?.() ?? new Date()).toISOString();
        state.hardStop = { operationId, stoppedAt, reason: reason.slice(0, 500) };
        state.updatedAt = stoppedAt;
        await this.persist(state);
      }
      return statusFor(state, this.sessionDir(sessionId));
    });
  }

  async start(request: StartFixedRigMathematicalCalibrationCaptureV1Request): Promise<FixedRigMathematicalCalibrationCaptureSessionStatusV1> {
    return this.serialized(async () => {
      const sessionId = assertSafeId(request.sessionId, "sessionId");
      const operatorId = assertSafeId(request.operatorId, "operatorId");
      if (request.targetVersion !== this.config.targetVersion || request.targetSha256 !== this.config.targetSha256) {
        throw new Error("Calibration target identity does not match the bridge-protected target artifact.");
      }
      const targetBytes = await readFile(this.config.targetPath);
      if (hash(targetBytes) !== this.config.targetSha256) throw new Error("Bridge-protected calibration target file SHA-256 mismatch.");
      const expectedAuthority = this.config.contractVersion === "v1.1"
        ? {
            thresholdSetId: MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_ID,
            thresholdSetHash: MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_HASH,
            uncertaintyCoverageFactor: MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST.uncertainty.coverageFactor,
          }
        : {
            thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
            thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
            uncertaintyCoverageFactor: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.coverageFactor,
          };
      const sessionDir = this.sessionDir(sessionId);
      const statePath = this.statePath(sessionId);
      if (existsSync(statePath)) {
        if (!request.resume) throw new Error("Calibration capture session already exists; explicit resume is required.");
        const state = await this.load(sessionId);
        if (
          state.operatorId !== operatorId ||
          state.subject.targetVersion !== request.targetVersion ||
          state.subject.targetSha256 !== request.targetSha256 ||
          hash(canonicalBytes(state.protectedSettings)) !== hash(canonicalBytes(this.config.protectedSettings)) ||
          hash(canonicalBytes(state.evidenceDerivedAuthority)) !== hash(canonicalBytes(expectedAuthority))
        ) {
          const stoppedAt = (this.config.now?.() ?? new Date()).toISOString();
          state.hardStop = { operationId: "session-resume", stoppedAt, reason: "Calibration capture resume identity/settings mismatch." };
          state.updatedAt = stoppedAt;
          await this.persist(state);
          throw new Error("Calibration capture resume identity/settings mismatch.");
        }
        try {
          await this.verifyAcceptedArtifactIntegrity(state);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Calibration resume artifact integrity verification failed.";
          const stoppedAt = (this.config.now?.() ?? new Date()).toISOString();
          state.hardStop = { operationId: "session-resume", stoppedAt, reason: reason.slice(0, 500) };
          state.updatedAt = stoppedAt;
          await this.persist(state);
          throw error;
        }
        return statusFor(state, sessionDir);
      }
      await mkdir(this.config.outputRoot, { recursive: true });
      await mkdir(sessionDir, { recursive: false });
      const createdAt = (this.config.now?.() ?? new Date()).toISOString();
      const targetRelativePath = portable("evidence", "target", "calibration-target.pdf");
      await writeExclusive(path.join(sessionDir, ...targetRelativePath.split("/")), targetBytes);
      const packageId = `mathematical-calibration-${sessionId}`;
      const targetArtifact: CaptureArtifactV1 = {
        evidenceId: "print-verified-calibration-target",
        path: targetRelativePath,
        sha256: this.config.targetSha256,
        role: "print_verified_calibration_target",
        artifactClass: "target",
        rigId: this.config.protectedSettings.rigId,
        captureProfileVersion: this.config.protectedSettings.captureProfileVersion,
        subjectDesignation: "calibration_target",
        productionCard: false,
        operationId: "session-start",
        capturedAt: createdAt,
        channelIndex: null,
        byteSize: targetBytes.length,
        mediaType: "application/pdf",
      };
      const v11 = this.config.contractVersion === "v1.1";
      const state: CaptureSessionStateV1 = {
        schemaVersion: v11 ? MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_SESSION_SCHEMA : FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_SESSION_V1,
        sessionId,
        operatorId,
        packageId,
        purpose: v11 ? "mathematical_calibration_v1.1" : "mathematical_calibration_v1",
        subject: {
          designation: "calibration_target",
          productionCard: false,
          targetVersion: request.targetVersion,
          targetSha256: request.targetSha256,
        },
        createdAt,
        updatedAt: createdAt,
        protectedSettings: this.config.protectedSettings,
        evidenceDerivedAuthority: expectedAuthority,
        artifacts: [targetArtifact],
        captures: [],
        measurements: [],
        failedOperations: [],
        ...(v11 ? { blankReverseFlipRecorded: false } : {}),
      };
      await writeExclusive(statePath, canonicalBytes(state));
      return statusFor(state, sessionDir);
    });
  }

  async status(sessionId: string): Promise<FixedRigMathematicalCalibrationCaptureSessionStatusV1> {
    const state = await this.load(assertSafeId(sessionId, "sessionId"));
    return statusFor(state, this.sessionDir(sessionId));
  }

  async previewPoses(
    sessionId: string,
    role?: "lens_geometry" | "normalization_registration" | "repeated_placement",
  ): Promise<MathematicalCalibrationV1_1Pose[]> {
    const state = await this.load(assertSafeId(sessionId, "sessionId"));
    const previewRole = this.config.contractVersion === "v1.1" ? "checkerboard_placement" : role;
    if (!previewRole) return [];
    return state.artifacts
      .filter((artifact) => artifact.artifactClass === "raw_capture" && artifact.role === previewRole && artifact.pose)
      .sort((left, right) => left.operationId.localeCompare(right.operationId))
      .map((artifact) => {
        const pose = artifact.pose!;
        const values = pose.cornerSignature;
        return {
          evidenceId: artifact.evidenceId,
          centerXFraction: pose.centerXFraction,
          centerYFraction: pose.centerYFraction,
          coverageFraction: pose.coverageFraction,
          rotationDegrees: pose.rotationDegrees,
          cornerSignature: values,
          imageWidth: 1,
          imageHeight: 1,
          corners: [
            { x: values[0]!, y: values[1]! },
            { x: values[2]!, y: values[3]! },
            { x: values[4]!, y: values[5]! },
            { x: values[6]!, y: values[7]! },
          ],
        };
      });
  }

  async captureStep(request: CaptureFixedRigMathematicalCalibrationStepV1Request): Promise<FixedRigMathematicalCalibrationCaptureSessionStatusV1> {
    return this.serialized(async () => {
      assertCaptureRequest(request, this.config.contractVersion ?? "v1.0.1");
      const state = await this.load(request.sessionId);
      if (state.sealedAt) throw new Error("Sealed calibration capture sessions are immutable.");
      if (state.hardStop) {
        throw new Error(`Calibration capture session is hard-stopped: ${state.hardStop.reason}`);
      }
      if (state.captures.some((capture) => capture.operationId === request.operationId)) {
        return statusFor(state, this.sessionDir(request.sessionId));
      }
      if (state.failedOperations.some((failure) => failure.operationId === request.operationId)) {
        throw new Error("Failed operationId cannot be reused; submit a new operationId for an explicit retry.");
      }
      const key = captureKey(request);
      if (state.captures.some((capture) => captureKey(capture) === key)) {
        throw new Error(`Calibration capture slot ${key} is already occupied and cannot be overwritten.`);
      }
      const contractVersion = this.config.contractVersion ?? "v1.0.1";
      const operationDir = path.join(this.sessionDir(request.sessionId), "working", safeSegment(request.operationId));
      const lighting = lightingFor(request, state.protectedSettings);
      const boundaryRequest: FixedRigMathematicalCalibrationCaptureBoundaryRequestV1 = {
        sessionId: request.sessionId,
        operationId: request.operationId,
        outputDir: operationDir,
        label: `${request.role}-${request.channelIndex ?? "all"}-${request.sampleIndex}`,
        role: request.role,
        sampleIndex: request.sampleIndex,
        ...(request.channelIndex !== undefined ? { channelIndex: request.channelIndex } : {}),
        targetFace: request.targetFace,
        protectedSettings: state.protectedSettings,
        lighting,
      };
      let candidatePose: FixedRigMathematicalCalibrationPoseV1 | undefined;
      let prospectiveAggregate: FixedRigMathematicalCalibrationAggregateV1 | undefined;
      let candidateRawSha256: string | undefined;
      let candidateCapturedAt: string | undefined;
      try {
        let blankReverseGeometryAuthority: VerifiedBlankReverseGeometryAuthorityV1 | undefined;
        if (contractVersion === "v1.0.1" && isBlankReversePhotometricRole(request.role)) {
          try {
            blankReverseGeometryAuthority = await this.resolveBlankReverseGeometryAuthority(state);
          } catch (error) {
            if (error instanceof FixedRigMathematicalCalibrationHardStopV1) throw error;
            hardStop(
              `Accepted blank-reverse geometry authority verification failed: ${error instanceof Error ? error.message : "unknown integrity error"}`,
            );
          }
        }
        const captured = await this.config.capture(boundaryRequest);
        candidateCapturedAt = captured.capturedAt;
        if (!Buffer.isBuffer(captured.rawBytes) || captured.rawBytes.length === 0) throw new Error("Capture boundary returned no raw bytes.");
        if (captured.camera.exposureUs !== state.protectedSettings.exposureUs || captured.camera.gain !== state.protectedSettings.gain) {
          hardStop("Capture boundary camera settings do not match bridge-protected calibration settings.");
        }
        if (
          captured.leimac.unit !== state.protectedSettings.leimacUnit ||
          captured.leimac.dutyPercent !== lighting.dutyPercent ||
          JSON.stringify([...captured.leimac.enabledChannels].sort()) !== JSON.stringify([...lighting.enabledChannels].sort()) ||
          captured.leimac.acknowledgedWriteCount !== captured.leimac.expectedWriteCount ||
          captured.leimac.complete !== true
        ) {
          hardStop("Capture boundary Leimac settings/acknowledgements do not match the protected logical capture step.");
        }
        if (!captured.safeOff.beforeCaptureConfirmed || !captured.safeOff.afterCaptureConfirmed) {
          hardStop("Capture boundary did not confirm safe-off before and after calibration capture.");
        }
        const extension = captured.mimeType === "image/tiff" ? "tiff" : "png";
        const baseName = `${request.role}-${request.channelIndex ?? "all"}-${String(request.sampleIndex).padStart(2, "0")}-${safeSegment(request.operationId)}`;
        const rawRelativePath = portable("evidence", "raw", `${baseName}.${extension}`);
        const rawPath = path.join(this.sessionDir(request.sessionId), ...rawRelativePath.split("/"));
        const sourceImagePath = contractVersion === "v1.0.1"
          ? path.join(operationDir, `${baseName}-raw-working.${extension}`)
          : rawPath;
        await writeExclusive(sourceImagePath, captured.rawBytes);
        const rawSha256 = hash(captured.rawBytes);
        candidateRawSha256 = rawSha256;
        const rawEvidenceId = `${baseName}-raw`;
        const captureTimeGeometry = this.config.contractVersion === "v1.1" && request.role === "checkerboard_placement"
          ? checkerboardGeometryMetadata(
              await (this.config.detectCheckerboard ?? detectMathematicalCalibrationPreviewCheckerboard)(captured.rawBytes),
              {
                sourceImageId: rawEvidenceId,
                sourceFrameId: rawEvidenceId,
                timestamp: captured.capturedAt,
              },
            )
          : undefined;
        const workingOutputPath = path.join(operationDir, `${baseName}-normalized-working.png`);
        const normalization = await (this.config.normalize ?? defaultNormalizer)({
          sourceImagePath,
          workingOutputPath,
          capturedAt: captured.capturedAt,
          sourceImageId: rawEvidenceId,
          ...(captureTimeGeometry
            ? { reusableGeometry: captureTimeGeometry }
            : blankReverseGeometryAuthority
              ? { reusableGeometry: blankReverseGeometryAuthority.geometry }
              : {}),
        });
        if (!normalization.rawEvidencePreserved || !normalization.normalizedArtifact) {
          throw new Error("Calibration normalization must preserve raw bytes and produce a normalized derivative.");
        }
        if (
          blankReverseGeometryAuthority &&
          hash(canonicalBytes(normalization.geometry)) !== blankReverseGeometryAuthority.provenance.sourceGeometrySha256
        ) {
          hardStop("Blank-reverse normalization did not use the exact verified server-selected geometry authority.");
        }
        const pose = poseFromGeometry(normalization.geometry);
        candidatePose = pose;
        if (contractVersion === "v1.0.1" && (request.role === "lens_geometry" || request.role === "normalization_registration")) {
          const policy = posePolicyForV1(request.role);
          if (pose.coverageFraction < policy.minimumCoverageFraction) {
            throw new Error(
              `${request.role} exact captured still coverage ${pose.coverageFraction.toFixed(6)} is below centralized minimum ${policy.minimumCoverageFraction.toFixed(6)}.`,
            );
          }
          const accepted = acceptedPosesFor(state, request.role);
          prospectiveAggregate = aggregateFor([...accepted, pose]);
          if (accepted.length === 9 && !aggregateMeets(prospectiveAggregate, policy.requiredAggregate)) {
            throw new Error(
              `${request.role} prospective tenth-pose aggregate does not meet centralized minima ` +
              `(X ${prospectiveAggregate.x.toFixed(6)}/${policy.requiredAggregate.x.toFixed(6)}, ` +
              `Y ${prospectiveAggregate.y.toFixed(6)}/${policy.requiredAggregate.y.toFixed(6)}, ` +
              `rotation ${prospectiveAggregate.rotationDegrees.toFixed(6)}/${policy.requiredAggregate.rotationDegrees.toFixed(6)} degrees).`,
            );
          }
        }
        if (normalization.rawArtifact.sha256 !== rawSha256 || normalization.normalizedArtifact.sourceSha256 !== rawSha256) {
          hardStop("Calibration normalization source hash does not bind to the immutable raw capture.");
        }
        if (
          normalization.normalizedArtifact.imageWidth !== state.protectedSettings.normalizedWidthPx ||
          normalization.normalizedArtifact.imageHeight !== state.protectedSettings.normalizedHeightPx
        ) {
          hardStop("Calibration normalized derivative dimensions do not match protected settings.");
        }
        const normalizedBytes = await readFile(normalization.normalizedArtifact.localOutputPath);
        const normalizedRelativePath = portable("evidence", "normalized", `${baseName}.png`);
        const normalizedPath = path.join(this.sessionDir(request.sessionId), ...normalizedRelativePath.split("/"));
        if (contractVersion !== "v1.0.1") await writeExclusive(normalizedPath, normalizedBytes);
        const normalizedSha256 = hash(normalizedBytes);
        if (normalization.normalizedArtifact.sha256 !== normalizedSha256) {
          hardStop("Calibration normalized derivative SHA-256 mismatch.");
        }
        if (contractVersion === "v1.0.1") {
          await writeExclusive(rawPath, captured.rawBytes);
          await writeExclusive(normalizedPath, normalizedBytes);
        }
        const normalizedEvidenceId = `${baseName}-normalized`;
        const geometryRecordPath = path.join(this.sessionDir(request.sessionId), "working", `${normalizedEvidenceId}-geometry.json`);
        await writeExclusive(geometryRecordPath, canonicalBytes(normalization.geometry));
        const common = {
          rigId: state.protectedSettings.rigId,
          captureProfileVersion: state.protectedSettings.captureProfileVersion,
          subjectDesignation: "calibration_target" as const,
          productionCard: false as const,
          operationId: request.operationId,
          capturedAt: captured.capturedAt,
          channelIndex: request.channelIndex ?? null,
          targetFace: request.targetFace,
          ...(request.removeReseatCycleId ? { removeReseatCycleId: request.removeReseatCycleId } : {}),
        };
        const rawArtifact: CaptureArtifactV1 = {
          evidenceId: rawEvidenceId,
          path: rawRelativePath,
          sha256: rawSha256,
          role: analysisUsesRaw(request.role) ? captureRole(request) : `${captureRole(request)}_raw`,
          artifactClass: "raw_capture",
          ...common,
          byteSize: captured.rawBytes.length,
          mediaType: captured.mimeType,
          camera: captured.camera,
          pylon: captured.pylon,
          leimac: captured.leimac,
          safeOff: captured.safeOff,
          pose,
        };
        const normalizedArtifact: CaptureArtifactV1 = {
          evidenceId: normalizedEvidenceId,
          path: normalizedRelativePath,
          sha256: normalizedSha256,
          role: analysisUsesRaw(request.role) ? `${captureRole(request)}_normalized` : captureRole(request),
          artifactClass: "normalized_derivative",
          ...common,
          byteSize: normalizedBytes.length,
          mediaType: "image/png",
          parentEvidenceId: rawEvidenceId,
          parentSha256: rawSha256,
          normalization: {
            algorithmVersion: normalization.geometry.version,
            sourceSha256: rawSha256,
            coordinateFrame: "normalized_card_portrait_pixels",
            widthPx: normalization.normalizedArtifact.imageWidth,
            heightPx: normalization.normalizedArtifact.imageHeight,
            geometricResamplingApplied: normalization.normalizedArtifact.geometricResamplingApplied,
            sourceCropWidth: normalization.normalizedArtifact.sourceCropWidth,
            sourceCropHeight: normalization.normalizedArtifact.sourceCropHeight,
            scaleX: normalization.normalizedArtifact.scaleX,
            scaleY: normalization.normalizedArtifact.scaleY,
            deskewAppliedDegrees: normalization.normalizedArtifact.deskewAppliedDegrees,
            ...(blankReverseGeometryAuthority ? { geometryAuthority: blankReverseGeometryAuthority.provenance } : {}),
          },
          pose,
        };
        state.artifacts.push(rawArtifact, normalizedArtifact);
        state.captures.push({
          operationId: request.operationId,
          role: request.role,
          sampleIndex: request.sampleIndex,
          ...(request.channelIndex !== undefined ? { channelIndex: request.channelIndex } : {}),
          targetFace: request.targetFace,
          capturedAt: captured.capturedAt,
          ...(request.removeReseatCycleId ? { removeReseatCycleId: request.removeReseatCycleId } : {}),
          rawEvidenceId,
          normalizedEvidenceId,
          completedAt: (this.config.now?.() ?? new Date()).toISOString(),
        });
        if (this.config.contractVersion === "v1.1" && request.role === "flat_field" && state.blankReverseFlipRecorded === false) {
          state.blankReverseFlipRecorded = true;
        }
        state.updatedAt = (this.config.now?.() ?? new Date()).toISOString();
        await writeExclusive(
          path.join(this.sessionDir(request.sessionId), "events", `${safeSegment(request.operationId)}.json`),
          canonicalBytes({ operation: "capture-step", request, rawArtifact, normalizedArtifact }),
        );
        await this.persist(state);
        return statusFor(state, this.sessionDir(request.sessionId));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Calibration capture failed.";
        const failedAt = (this.config.now?.() ?? new Date()).toISOString();
        state.failedOperations.push({
          operationId: request.operationId,
          failedAt,
          error: message.slice(0, 500),
          role: request.role,
          sampleIndex: request.sampleIndex,
          ...(request.channelIndex !== undefined ? { channelIndex: request.channelIndex } : {}),
          targetFace: request.targetFace,
          slotKey: key,
          ...(candidateRawSha256 ? { candidateRawSha256 } : {}),
          ...(candidateCapturedAt ? { candidateCapturedAt } : {}),
          ...(candidatePose ? { candidatePose } : {}),
          ...(prospectiveAggregate ? { prospectiveAggregate } : {}),
        });
        if (error instanceof FixedRigMathematicalCalibrationHardStopV1) {
          state.hardStop = { operationId: request.operationId, stoppedAt: failedAt, reason: message.slice(0, 500) };
        }
        state.updatedAt = failedAt;
        await this.persist(state);
        throw error;
      }
    });
  }

  async recordMeasurement(
    request: RecordFixedRigMathematicalCalibrationMeasurementV1Request,
  ): Promise<FixedRigMathematicalCalibrationCaptureSessionStatusV1> {
    return this.serialized(async () => {
      assertSafeId(request.sessionId, "sessionId");
      assertSafeId(request.operationId, "operationId");
      assertSafeId(request.measurementMethod, "measurementMethod");
      assertInstrument(request.instrument);
      const state = await this.load(request.sessionId);
      assertPhysicalMeasurementTargetAuthority({
        instrument: request.instrument,
        targetVersion: state.subject.targetVersion,
        targetSha256: state.subject.targetSha256,
      });
      if (state.sealedAt) throw new Error("Sealed calibration capture sessions are immutable.");
      const existing = state.measurements.find((record) => record.operationId === request.operationId);
      if (existing) return statusFor(state, this.sessionDir(request.sessionId));
      const recordedAt = (this.config.now?.() ?? new Date()).toISOString();
      const payload: Record<string, unknown> = {
        operatorId: state.operatorId,
        recordedAt,
        measurementMethod: request.measurementMethod,
        instrument: request.instrument,
      };
      let role: string;
      let schemaVersion: string;
      if (request.measurementType === "print_scale") {
        role = `print_scale_verification_${request.axis}`;
        if ("protectedSpanMm" in request) {
          schemaVersion = "ten-kings-calibration-print-scale-authority-v1";
          const protectedSpanMm = finite(request.protectedSpanMm, "protectedSpanMm", 0.001);
          if (request.authorityBasis !== "protected_checkerboard_geometry" ||
              request.measurementMethod !== "protected_checkerboard_geometry_authority_v1" ||
              request.sourceTargetEvidenceId !== "print-verified-calibration-target" ||
              request.instrument.kind !== "protected_target_geometry") {
            throw new Error("Print-scale authority must come from the exact protected checkerboard target.");
          }
          const targetArtifact = state.artifacts.find((artifact) => artifact.evidenceId === request.sourceTargetEvidenceId);
          if (!targetArtifact || targetArtifact.artifactClass !== "target" || targetArtifact.sha256 !== state.subject.targetSha256) {
            throw new Error("Print-scale authority source target is unavailable or does not match the session target.");
          }
          Object.assign(payload, {
            axis: request.axis,
            protectedSpanMm,
            authorityBasis: request.authorityBasis,
            sourceTargetEvidenceId: targetArtifact.evidenceId,
            sourceTargetSha256: targetArtifact.sha256,
          });
        } else {
          if (request.instrument.kind === "protected_target_geometry") {
            throw new Error("Protected target geometry must use the nominal target-authority contract, not physical measurement fields.");
          }
          schemaVersion = "ten-kings-calibration-print-scale-measurement-v1";
          Object.assign(payload, {
            axis: request.axis,
            nominalSpanMm: finite(request.nominalSpanMm, "nominalSpanMm", 0.001),
            measuredSpanMm: finite(request.measuredSpanMm, "measuredSpanMm", 0.001),
            measurementU95Mm: finite(request.measurementU95Mm, "measurementU95Mm", 0),
            sourceMetrologyArtifactSha256: assertSha256(request.sourceMetrologyArtifactSha256, "sourceMetrologyArtifactSha256"),
          });
        }
      } else if (request.measurementType === "target_cut_dimension") {
        role = `target_cut_dimension_${request.axis}`;
        if ("protectedDimensionMm" in request) {
          schemaVersion = "ten-kings-calibration-target-cut-dimension-authority-v1";
          const protectedDimensionMm = finite(request.protectedDimensionMm, "protectedDimensionMm", 0.001);
          if (request.authorityBasis !== "protected_checkerboard_geometry" ||
              request.measurementMethod !== "protected_checkerboard_geometry_authority_v1" ||
              request.sourceTargetEvidenceId !== "print-verified-calibration-target" ||
              request.instrument.kind !== "protected_target_geometry") {
            throw new Error("Target-cut authority must come from the exact protected checkerboard target.");
          }
          const targetArtifact = state.artifacts.find((artifact) => artifact.evidenceId === request.sourceTargetEvidenceId);
          if (!targetArtifact || targetArtifact.artifactClass !== "target" || targetArtifact.sha256 !== state.subject.targetSha256) {
            throw new Error("Target-cut authority source target is unavailable or does not match the session target.");
          }
          Object.assign(payload, {
            axis: request.axis,
            protectedDimensionMm,
            authorityBasis: request.authorityBasis,
            sourceTargetEvidenceId: targetArtifact.evidenceId,
            sourceTargetSha256: targetArtifact.sha256,
          });
        } else {
          if (request.instrument.kind === "protected_target_geometry") {
            throw new Error("Protected target geometry must use the nominal target-authority contract, not physical measurement fields.");
          }
          schemaVersion = "ten-kings-calibration-target-cut-dimension-measurement-v1";
          Object.assign(payload, {
            axis: request.axis,
            nominalDimensionMm: finite(request.nominalDimensionMm, "nominalDimensionMm", 0.001),
            measuredDimensionMm: finite(request.measuredDimensionMm, "measuredDimensionMm", 0.001),
            measurementU95Mm: finite(request.measurementU95Mm, "measurementU95Mm", 0),
            sourceMetrologyArtifactSha256: assertSha256(request.sourceMetrologyArtifactSha256, "sourceMetrologyArtifactSha256"),
          });
        }
      } else if (request.measurementType === "direction_geometry") {
        const channelIndex = positiveInteger(request.channelIndex, "channelIndex");
        const sampleIndex = positiveInteger(request.sampleIndex, "sampleIndex");
        if (channelIndex > 8 || sampleIndex > 3) throw new Error("Direction geometry requires channel 1-8 and sample 1-3.");
        const evidenceDerived = "measurementAlgorithmVersion" in request;
        if (evidenceDerived &&
            (request.measurementMethod !== "illumination_centroid_checkerboard_repeatability_v1" ||
             request.measurementAlgorithmVersion !== "opencv_illumination_centroid_checkerboard_v1" ||
             request.instrument.kind !== "fixed_rig_geometry" ||
             request.instrument.instrumentId !== "ten-kings-illumination-centroid-direction-analyzer-v1" ||
             request.instrument.calibrationVersion !== request.measurementAlgorithmVersion)) {
          throw new Error("Direction authority must use the exact illumination-centroid checkerboard derivation.");
        }
        role = `direction_geometry_channel_${channelIndex}`;
        schemaVersion = "ten-kings-calibration-direction-measurement-v1";
        const sourcePointMm = {
          x: finite(request.sourcePointMm.x, "sourcePointMm.x"),
          y: finite(request.sourcePointMm.y, "sourcePointMm.y"),
        };
        const cardCenterPointMm = {
          x: finite(request.cardCenterPointMm.x, "cardCenterPointMm.x"),
          y: finite(request.cardCenterPointMm.y, "cardCenterPointMm.y"),
        };
        const pointU95Mm = finite(request.pointU95Mm, "pointU95Mm", 0);
        Object.assign(payload, {
          channelIndex,
          sampleIndex,
          sourcePointMm,
          cardCenterPointMm,
          pointU95Mm,
        });
        if (evidenceDerived) {
          const sourceCaptureOperationId = assertSafeId(request.sourceCaptureOperationId, "sourceCaptureOperationId");
          const sourceEvidenceId = assertSafeId(request.sourceEvidenceId, "sourceEvidenceId");
          const sourceSha256 = assertSha256(request.sourceSha256, "sourceSha256");
          const sourceCapture = state.captures.find((capture) =>
            capture.operationId === sourceCaptureOperationId && capture.role === "illumination_pattern" &&
            capture.channelIndex === channelIndex && capture.sampleIndex === sampleIndex
          );
          if (!sourceCapture || sourceCapture.normalizedEvidenceId !== sourceEvidenceId) {
            throw new Error("Direction authority must bind the matching immutable normalized illumination capture.");
          }
          const sourceArtifact = state.artifacts.find((artifact) => artifact.evidenceId === sourceEvidenceId);
          if (!sourceArtifact || sourceArtifact.artifactClass !== "normalized_derivative" ||
              sourceArtifact.role !== `illumination_pattern_channel_${channelIndex}` || sourceArtifact.sha256 !== sourceSha256) {
            throw new Error("Direction authority illumination evidence is unavailable or mismatched.");
          }
          const sessionRoot = path.resolve(this.sessionDir(request.sessionId));
          const sourcePath = path.resolve(sessionRoot, ...sourceArtifact.path.split("/"));
          if (!sourcePath.startsWith(`${sessionRoot}${path.sep}`) || hash(await readFile(sourcePath)) !== sourceSha256) {
            throw new Error("Direction authority illumination evidence failed immutable path/hash verification.");
          }
          Object.assign(payload, {
            sourceCaptureOperationId, sourceEvidenceId, sourceSha256,
            sourceRole: `illumination_pattern_channel_${channelIndex}`,
            measurementAlgorithmVersion: request.measurementAlgorithmVersion,
          });
        } else {
          if (request.instrument.kind === "protected_target_geometry") {
            throw new Error("Protected target geometry cannot authorize physical light-direction coordinates.");
          }
          Object.assign(payload, {
            sourceMetrologyArtifactSha256: assertSha256(request.sourceMetrologyArtifactSha256, "sourceMetrologyArtifactSha256"),
          });
        }
      } else {
        if (!MEASUREMENT_CLASSES.includes(request.measurementClass)) throw new Error("measurementClass is not allowlisted.");
        const sampleIndex = positiveInteger(request.sampleIndex, "sampleIndex");
        const maximumRepeatabilitySamples = this.config.contractVersion === "v1.1" ? 4 : 10;
        if (sampleIndex > maximumRepeatabilitySamples) throw new Error(`Measurement repeatability sampleIndex must be 1 through ${maximumRepeatabilitySamples}.`);
        const sourceCaptureOperationId = assertSafeId(
          request.sourceCaptureOperationId,
          "sourceCaptureOperationId",
        );
        const expectedRepeatabilityAlgorithm = this.config.contractVersion === "v1.1"
          ? "opencv_checkerboard_repeatability_measurement_v1.1"
          : "opencv_checkerboard_repeatability_measurement_v1";
        if (request.measurementAlgorithmVersion !== expectedRepeatabilityAlgorithm) {
          throw new Error("Measurement repeatability requires the exact deterministic OpenCV checkerboard algorithm version.");
        }
        const expectedRepeatabilityMethod = this.config.contractVersion === "v1.1"
          ? "fixed_reference_repeatability_v1.1"
          : "fixed_reference_repeatability_v1";
        if (request.measurementMethod !== expectedRepeatabilityMethod) {
          throw new Error(`Measurement repeatability requires ${expectedRepeatabilityMethod}.`);
        }
        const sourceCapture = state.captures.find(
          (capture) => capture.operationId === sourceCaptureOperationId,
        );
        const expectedSourceRole = this.config.contractVersion === "v1.1" ? "checkerboard_placement" : "repeated_placement";
        if (!sourceCapture || sourceCapture.role !== expectedSourceRole || sourceCapture.sampleIndex !== sampleIndex) {
          throw new Error("Measurement repeatability must bind to the matching immutable repeated-placement source capture.");
        }
        const sourceArtifact = state.artifacts.find(
          (artifact) => artifact.evidenceId === sourceCapture.rawEvidenceId,
        );
        if (!sourceArtifact || sourceArtifact.artifactClass !== "raw_capture") {
          throw new Error("Measurement repeatability source raw evidence is unavailable.");
        }
        const sessionRoot = path.resolve(this.sessionDir(request.sessionId));
        const sourcePath = path.resolve(sessionRoot, ...sourceArtifact.path.split("/"));
        if (!sourcePath.startsWith(`${sessionRoot}${path.sep}`)) {
          throw new Error("Measurement repeatability source path escapes the isolated calibration session.");
        }
        const sourceBytes = await readFile(sourcePath);
        if (hash(sourceBytes) !== sourceArtifact.sha256) {
          throw new Error("Measurement repeatability source raw evidence SHA-256 mismatch.");
        }
        const expectedFeatureId = `checkerboard-repeatability-${request.measurementClass}-${this.config.contractVersion === "v1.1" ? "v1.1" : "v1"}`;
        if (request.referenceFeatureId !== expectedFeatureId) {
          throw new Error(`referenceFeatureId must be ${expectedFeatureId}.`);
        }
        role = "measurement_repeatability";
        schemaVersion = "ten-kings-calibration-repeatability-measurement-v1";
        Object.assign(payload, {
          measurementClass: request.measurementClass,
          sampleIndex,
          referenceFeatureId: assertSafeId(request.referenceFeatureId, "referenceFeatureId"),
          measuredValue: finite(request.measuredValue, "measuredValue"),
          sourceCaptureOperationId,
          sourceEvidenceId: sourceArtifact.evidenceId,
          sourceSha256: sourceArtifact.sha256,
          sourceRole: expectedSourceRole,
          measurementAlgorithmVersion: request.measurementAlgorithmVersion,
          fixedRoiDefinition:
            "registered_checkerboard_center_cell_and_grid_spacing_v1",
        });
      }
      const measurementBody = { schemaVersion, ...payload };
      const evidenceId = `${role}-${safeSegment(request.operationId)}`;
      const relativePath = portable("evidence", "measurements", `${evidenceId}.json`);
      const bytes = canonicalBytes(measurementBody);
      const artifact: CaptureArtifactV1 = {
        evidenceId,
        path: relativePath,
        sha256: hash(bytes),
        role,
        artifactClass: "measurement",
        rigId: state.protectedSettings.rigId,
        captureProfileVersion: state.protectedSettings.captureProfileVersion,
        subjectDesignation: "calibration_target",
        productionCard: false,
        operationId: request.operationId,
        capturedAt: recordedAt,
        channelIndex: request.measurementType === "direction_geometry" ? request.channelIndex : null,
        byteSize: bytes.length,
        mediaType: "application/json",
      };
      const record: MeasurementRecordV1 = {
        operationId: request.operationId,
        measurementType: request.measurementType,
        evidenceId,
        recordedAt,
        payload,
      };
      const key = measurementKey(record);
      if (state.measurements.some((candidate) => measurementKey(candidate) === key)) {
        throw new Error(`Calibration measurement slot ${key} is already occupied and cannot be overwritten.`);
      }
      await writeExclusive(path.join(this.sessionDir(request.sessionId), ...relativePath.split("/")), bytes);
      await writeExclusive(
        path.join(this.sessionDir(request.sessionId), "events", `${safeSegment(request.operationId)}.json`),
        canonicalBytes({ operation: "record-measurement", request: measurementBody, artifact }),
      );
      state.artifacts.push(artifact);
      state.measurements.push(record);
      state.updatedAt = recordedAt;
      await this.persist(state);
      return statusFor(state, this.sessionDir(request.sessionId));
    });
  }

  async seal(request: SealFixedRigMathematicalCalibrationCaptureV1Request): Promise<SealedFixedRigMathematicalCalibrationCaptureV1> {
    return this.serialized(async () => {
      assertSafeId(request.sessionId, "sessionId");
      assertSafeId(request.operationId, "operationId");
      assertSafeId(request.profileId, "profileId");
      assertSafeId(request.calibrationVersion, "calibrationVersion");
      assertSafeId(request.artifactId, "artifactId");
      const state = await this.load(request.sessionId);
      const sessionDir = this.sessionDir(request.sessionId);
      const packagePath = path.join(sessionDir, "source-capture-package.json");
      const captureManifestPath = path.join(sessionDir, "capture-manifest.json");
      if (state.sealedAt) {
        const packageBytes = await readFile(packagePath);
        const manifestBytes = await readFile(captureManifestPath);
        return {
          status: statusFor(state, sessionDir),
          sourceCapturePackage: { packageId: state.packageId, path: packagePath, sha256: hash(packageBytes) },
          captureManifest: { path: captureManifestPath, sha256: hash(manifestBytes) },
        };
      }
      const v11 = this.config.contractVersion === "v1.1";
      const thresholdManifest = v11 ? MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST;
      const expectedCaptureKeys = new Set<string>();
      if (v11) {
        for (let sampleIndex = 1; sampleIndex <= 4; sampleIndex += 1) expectedCaptureKeys.add(`checkerboard_placement:none:${sampleIndex}`);
      } else {
        for (const role of ["lens_geometry", "normalization_registration", "repeated_placement"] as const) {
          for (let sampleIndex = 1; sampleIndex <= 10; sampleIndex += 1) expectedCaptureKeys.add(`${role}:none:${sampleIndex}`);
        }
      }
      for (const role of ["flat_field", "dark_control", "illumination_pattern"] as const) {
        for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
          for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) expectedCaptureKeys.add(`${role}:${channelIndex}:${sampleIndex}`);
        }
      }
      const observedCaptureKeys = new Set(state.captures.map(captureKey));
      if (observedCaptureKeys.size !== expectedCaptureKeys.size || [...expectedCaptureKeys].some((key) => !observedCaptureKeys.has(key))) {
        throw new Error("Calibration session cannot seal until every required unique capture slot is complete.");
      }
      if (v11 && state.blankReverseFlipRecorded !== true) {
        throw new Error("V1.1 calibration session requires exactly one recorded blank-reverse flip before channel evidence.");
      }
      const expectedMeasurementKeys = new Set<string>([
        "print_scale:x", "print_scale:y", "target_cut_dimension:x", "target_cut_dimension:y",
      ]);
      for (let channel = 1; channel <= 8; channel += 1) {
        for (let sample = 1; sample <= 3; sample += 1) expectedMeasurementKeys.add(`direction_geometry:${channel}:${sample}`);
      }
      for (const measurementClass of MEASUREMENT_CLASSES) {
        for (let sample = 1; sample <= (v11 ? 4 : 10); sample += 1) expectedMeasurementKeys.add(`measurement_repeatability:${measurementClass}:${sample}`);
      }
      const observedMeasurementKeys = new Set(state.measurements.map(measurementKey));
      if (observedMeasurementKeys.size !== expectedMeasurementKeys.size || [...expectedMeasurementKeys].some((key) => !observedMeasurementKeys.has(key))) {
        throw new Error("Calibration session cannot seal until every required immutable metrology record is complete.");
      }
      for (const artifact of state.artifacts) {
        const artifactPath = path.join(sessionDir, ...artifact.path.split("/"));
        const bytes = await readFile(artifactPath);
        const metadata = await stat(artifactPath);
        if (hash(bytes) !== artifact.sha256 || metadata.size !== artifact.byteSize) {
          throw new Error(`Calibration artifact ${artifact.evidenceId} changed after its immutable ledger record was created.`);
        }
      }
      const captureArtifacts = state.artifacts.filter(
        (artifact) => artifact.artifactClass === "raw_capture" || artifact.artifactClass === "normalized_derivative",
      );
      const hashes = captureArtifacts.map((artifact) => artifact.sha256);
      if (new Set(hashes).size !== hashes.length) throw new Error("Calibration session contains duplicate image content relabeled as different evidence.");
      const posePolicy = thresholdManifest.calibrationAcceptance.captureEvidence.poseDiversity;
      const poseRoles = v11 ? ["checkerboard_placement"] as const : ["lens_geometry", "normalization_registration"] as const;
      for (const role of poseRoles) {
        const poses = captureArtifacts
          .filter((artifact) => artifact.artifactClass === "raw_capture" && artifact.role === role)
          .map((artifact) => artifact.pose!);
        if (poses.some((pose) => pose.coverageFraction < posePolicy.minimumDetectedTargetCoverageFractionPerView)) {
          throw new Error(`${role} contains a view below the centralized minimum detected-target coverage.`);
        }
        const xSpan = Math.max(...poses.map((pose) => pose.centerXFraction)) - Math.min(...poses.map((pose) => pose.centerXFraction));
        const ySpan = Math.max(...poses.map((pose) => pose.centerYFraction)) - Math.min(...poses.map((pose) => pose.centerYFraction));
        const rotationSpan = Math.max(...poses.map((pose) => pose.rotationDegrees)) - Math.min(...poses.map((pose) => pose.rotationDegrees));
        const rolePolicy = role === "lens_geometry" || role === "checkerboard_placement" ? posePolicy.geometry : posePolicy.normalization;
        if (
          xSpan < rolePolicy.minimumNormalizedCenterSpanX ||
          ySpan < rolePolicy.minimumNormalizedCenterSpanY ||
          rotationSpan < rolePolicy.minimumRotationSpanDegrees
        ) {
          throw new Error(`${role} does not contain the required independently observed pose diversity.`);
        }
      }
      const repeatedPlacement = state.captures.filter((capture) => capture.role === (v11 ? "checkerboard_placement" : "repeated_placement"));
      if (
        new Set(repeatedPlacement.map((capture) => capture.operationId)).size !== repeatedPlacement.length ||
        (!v11 && new Set(repeatedPlacement.map((capture) => capture.capturedAt)).size !== repeatedPlacement.length) ||
        (!v11 && new Set(repeatedPlacement.map((capture) => capture.removeReseatCycleId)).size !== repeatedPlacement.length) ||
        new Set(repeatedPlacement.map((capture) =>
          state.artifacts.find((artifact) => artifact.evidenceId === capture.rawEvidenceId)?.sha256,
        )).size !== repeatedPlacement.length
      ) {
        throw new Error("Repeated-placement evidence requires unique operation IDs, timestamps, raw hashes, and explicit remove/reseat cycle IDs.");
      }
      const finalizedAt = (this.config.now?.() ?? new Date()).toISOString();
      const analyzerAuthoritySupersession = this.analyzerAuthoritySupersessionLedgerForSeal
        ? structuredClone(this.analyzerAuthoritySupersessionLedgerForSeal)
        : undefined;
      const packageBody = {
        schemaVersion: v11 ? MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_PACKAGE_SCHEMA : FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PACKAGE_V1,
        packageId: state.packageId,
        rigId: state.protectedSettings.rigId,
        captureProfileVersion: state.protectedSettings.captureProfileVersion,
        purpose: state.purpose,
        thresholdSetId: v11 ? MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_ID : MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
        thresholdSetHash: v11 ? MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_HASH : MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
        evidenceDerivedAuthority: state.evidenceDerivedAuthority,
        captureEvidenceAcceptance:
          thresholdManifest.calibrationAcceptance.captureEvidence,
        ...(v11 ? {
          calibrationContractVersion: "1.1.0",
          placementContract: {
            exactlyDistinctCheckerboardPlacements: 4,
            blankReverseFlipCount: state.blankReverseFlipRecorded ? 1 : 0,
            noDuplicateEvidence: true,
          },
        } : {}),
        stationAuthority: {
          stationId: state.protectedSettings.stationId,
          sessionId: state.sessionId,
          operatorId: state.operatorId,
          createdAt: state.createdAt,
          finalizedAt,
          protectedSettings: state.protectedSettings,
          noProductionMutation: true,
        },
        subject: state.subject,
        artifacts: state.artifacts,
        ...(analyzerAuthoritySupersession ? { analyzerAuthoritySupersession } : {}),
      };
      const packageBytes = canonicalBytes(packageBody);
      await writeExclusive(packagePath, packageBytes);
      const packageSha256 = hash(packageBytes);
      const artifactFor = (evidenceId: string) => {
        const artifact = state.artifacts.find((candidate) => candidate.evidenceId === evidenceId);
        if (!artifact) throw new Error(`Missing sealed artifact ${evidenceId}.`);
        return { evidenceId: artifact.evidenceId, path: artifact.path, sha256: artifact.sha256 };
      };
      const capturesFor = (role: FixedRigMathematicalCalibrationCaptureRoleV1, channelIndex?: number) =>
        state.captures
          .filter((capture) => capture.role === role && capture.channelIndex === channelIndex)
          .sort((left, right) => left.sampleIndex - right.sampleIndex)
          .map((capture) => artifactFor(analysisUsesRaw(role) ? capture.rawEvidenceId : capture.normalizedEvidenceId));
      const measurementFor = (
        type: MeasurementRecordV1["measurementType"],
        predicate: (payload: Record<string, unknown>) => boolean,
      ): Record<string, unknown> & { evidenceId: string; path: string; sha256: string } => {
        const record = state.measurements.find((candidate) => candidate.measurementType === type && predicate(candidate.payload));
        if (!record) throw new Error(`Missing sealed ${type} measurement.`);
        return { ...artifactFor(record.evidenceId), ...record.payload };
      };
      const targetArtifact = state.artifacts.find((artifact) => artifact.artifactClass === "target")!;
      const target = {
        evidenceId: targetArtifact.evidenceId,
        path: targetArtifact.path,
        version: state.subject.targetVersion,
        sha256: targetArtifact.sha256,
        couponWidthMm: Number(measurementFor("target_cut_dimension", (payload) => payload.axis === "x").protectedDimensionMm ?? measurementFor("target_cut_dimension", (payload) => payload.axis === "x").nominalDimensionMm),
        couponHeightMm: Number(measurementFor("target_cut_dimension", (payload) => payload.axis === "y").protectedDimensionMm ?? measurementFor("target_cut_dimension", (payload) => payload.axis === "y").nominalDimensionMm),
        cutDimensionVerification: {
          x: measurementFor("target_cut_dimension", (payload) => payload.axis === "x"),
          y: measurementFor("target_cut_dimension", (payload) => payload.axis === "y"),
        },
        printScaleVerification: {
          x: measurementFor("print_scale", (payload) => payload.axis === "x"),
          y: measurementFor("print_scale", (payload) => payload.axis === "y"),
        },
      };
      const flatFieldChannels = Array.from({ length: 8 }, (_, index) => {
        const channelIndex = index + 1;
        return {
          channelIndex,
          frames: capturesFor("flat_field", channelIndex),
          darkFrames: capturesFor("dark_control", channelIndex),
          illuminationPatternFrames: capturesFor("illumination_pattern", channelIndex),
          directionMeasurements: state.measurements
            .filter((record) => record.measurementType === "direction_geometry" && record.payload.channelIndex === channelIndex)
            .sort((left, right) => Number(left.payload.sampleIndex) - Number(right.payload.sampleIndex))
            .map((record) => ({ ...artifactFor(record.evidenceId), ...record.payload })),
        };
      });
      const captureManifestBody = {
        schemaVersion: v11 ? MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_MANIFEST_SCHEMA : FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_MANIFEST_V1,
        evidenceRoot: ".",
        profileId: request.profileId,
        calibrationVersion: request.calibrationVersion,
        rigId: state.protectedSettings.rigId,
        captureProfileVersion: state.protectedSettings.captureProfileVersion,
        sourceCapturePackage: {
          packageId: state.packageId,
          path: path.basename(packagePath),
          sha256: packageSha256,
        },
        artifactId: request.artifactId,
        operatorId: state.operatorId,
        finalizedAt,
        normalizedWidthPx: state.protectedSettings.normalizedWidthPx,
        normalizedHeightPx: state.protectedSettings.normalizedHeightPx,
        checkerboard: state.protectedSettings.checkerboard,
        target,
        geometryViews: capturesFor(v11 ? "checkerboard_placement" : "lens_geometry"),
        normalizationViews: capturesFor(v11 ? "checkerboard_placement" : "normalization_registration"),
        placementViews: capturesFor(v11 ? "checkerboard_placement" : "repeated_placement"),
        ...(v11 ? {
          segmentationBoundaryViews: capturesFor("checkerboard_placement"),
          normalizationHoldoutViews: capturesFor("checkerboard_placement"),
          repeatedPlacementDerivations: capturesFor("checkerboard_placement"),
          placementEvidenceIdentity: state.captures
            .filter((capture) => capture.role === "checkerboard_placement")
            .sort((left, right) => left.sampleIndex - right.sampleIndex)
            .map((capture) => artifactFor(capture.rawEvidenceId)),
          blankReverseFlip: { count: 1, targetFace: "blank_reverse" },
          validation: {
            method: "deterministic_leave_one_pose_out",
            smallSampleU95: "student_t_0.975_n_minus_1_times_sample_standard_deviation",
          },
        } : {}),
        measurementRepeatabilitySamples: state.measurements
          .filter((record) => record.measurementType === "measurement_repeatability")
          .sort((left, right) => `${left.payload.measurementClass}:${left.payload.sampleIndex}`.localeCompare(`${right.payload.measurementClass}:${right.payload.sampleIndex}`))
          .map((record) => ({ ...artifactFor(record.evidenceId), ...record.payload })),
        flatFieldChannels,
        ...(analyzerAuthoritySupersession ? { analyzerAuthoritySupersession } : {}),
      };
      const captureManifestBytes = canonicalBytes(captureManifestBody);
      await writeExclusive(captureManifestPath, captureManifestBytes);
      state.sealedAt = finalizedAt;
      state.updatedAt = finalizedAt;
      await writeExclusive(
        path.join(sessionDir, "events", `${safeSegment(request.operationId)}.json`),
        canonicalBytes({
          operation: "seal",
          request,
          packageSha256,
          captureManifestSha256: hash(captureManifestBytes),
          finalizedAt,
        }),
      );
      await this.persist(state);
      return {
        status: statusFor(state, sessionDir),
        sourceCapturePackage: { packageId: state.packageId, path: packagePath, sha256: packageSha256 },
        captureManifest: { path: captureManifestPath, sha256: hash(captureManifestBytes) },
      };
    });
  }
}
