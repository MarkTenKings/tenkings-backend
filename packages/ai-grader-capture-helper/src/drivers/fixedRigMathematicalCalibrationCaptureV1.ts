import crypto from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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

export const FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_SESSION_V1 =
  "ten-kings-mathematical-calibration-capture-session-v1" as const;
export const FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PACKAGE_V1 =
  "ten-kings-mathematical-calibration-capture-package-v1" as const;
export const FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_MANIFEST_V1 =
  "ten-kings-mathematical-calibration-capture-manifest-v1" as const;
export const FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1 =
  "ten-kings-fixed-rig-mathematical-calibration-v1" as const;
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

export interface FixedRigMathematicalCalibrationInstrumentV1 {
  instrumentId: string;
  kind: "traceable_ruler" | "caliper" | "fixed_rig_geometry";
  calibrationVersion: string;
  calibrationSha256: string;
}

export type RecordFixedRigMathematicalCalibrationMeasurementV1Request =
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
  artifacts: CaptureArtifactV1[];
  captures: CaptureRecordV1[];
  measurements: MeasurementRecordV1[];
  failedOperations: FailedCaptureOperationV1[];
  hardStop?: { operationId: string; stoppedAt: string; reason: string };
  blankReverseFlipRecorded?: boolean;
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

function captureRole(input: CaptureFixedRigMathematicalCalibrationStepV1Request): string {
  if (input.role === "flat_field") return `flat_field_channel_${input.channelIndex}`;
  if (input.role === "dark_control") return `dark_control_channel_${input.channelIndex}`;
  if (input.role === "illumination_pattern") return `illumination_pattern_channel_${input.channelIndex}`;
  if (input.role === "checkerboard_placement") return "checkerboard_placement";
  return input.role;
}

function analysisUsesRaw(role: FixedRigMathematicalCalibrationCaptureRoleV1): boolean {
  return role === "lens_geometry" || role === "normalization_registration" || role === "repeated_placement" || role === "checkerboard_placement";
}

function lightingFor(
  input: CaptureFixedRigMathematicalCalibrationStepV1Request,
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
    assertSafeId(input.normalizationSourceOperationId, "normalizationSourceOperationId");
  }
  if (
    contractVersion === "v1.0.1" &&
    (input.role === "lens_geometry" || input.role === "normalization_registration") &&
    input.normalizationSourceOperationId !== undefined
  ) {
    throw new Error("V1.0.1 lens and normalization slots must detect geometry from the exact captured still and cannot reuse prior geometry.");
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
  assertSafeId(instrument.calibrationVersion, "instrument.calibrationVersion");
  assertSha256(instrument.calibrationSha256, "instrument.calibrationSha256");
  if (!["traceable_ruler", "caliper", "fixed_rig_geometry"].includes(instrument.kind)) {
    throw new Error("instrument.kind is not allowlisted.");
  }
}

export class FixedRigMathematicalCalibrationCaptureProducerV1 {
  private readonly config: FixedRigMathematicalCalibrationCaptureProducerConfigV1;
  private chain: Promise<unknown> = Promise.resolve();

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
    const sessionRoot = path.resolve(this.sessionDir(state.sessionId));
    for (const artifact of state.artifacts) {
      const artifactPath = path.resolve(sessionRoot, ...artifact.path.split("/"));
      if (!artifactPath.startsWith(`${sessionRoot}${path.sep}`)) {
        throw new Error(`Calibration artifact ${artifact.evidenceId} escapes the isolated session root.`);
      }
      const bytes = await readFile(artifactPath);
      const metadata = await stat(artifactPath);
      if (hash(bytes) !== artifact.sha256 || metadata.size !== artifact.byteSize) {
        throw new Error(`Calibration artifact ${artifact.evidenceId} failed immutable SHA-256/size verification.`);
      }
    }
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
      const sessionDir = this.sessionDir(sessionId);
      const statePath = this.statePath(sessionId);
      if (existsSync(statePath)) {
        if (!request.resume) throw new Error("Calibration capture session already exists; explicit resume is required.");
        const state = await this.load(sessionId);
        if (
          state.operatorId !== operatorId ||
          state.subject.targetVersion !== request.targetVersion ||
          state.subject.targetSha256 !== request.targetSha256 ||
          hash(canonicalBytes(state.protectedSettings)) !== hash(canonicalBytes(this.config.protectedSettings))
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
      if (this.config.contractVersion === "v1.1" && request.normalizationSourceOperationId !== undefined) {
        throw new Error("V1.1 placement captures are immutable source evidence and may not import or reuse another capture as their input.");
      }
      const reusableGeometry = request.normalizationSourceOperationId
        ? state.artifacts.find(
            (artifact) => artifact.operationId === request.normalizationSourceOperationId && artifact.artifactClass === "normalized_derivative",
          )
        : undefined;
      if (request.normalizationSourceOperationId && !reusableGeometry?.pose) {
        throw new Error("normalizationSourceOperationId does not identify completed geometry-bound evidence.");
      }
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
        let referencedGeometry: CardGeometryMetadata | undefined;
        if (request.normalizationSourceOperationId) {
          const sourceRecord = state.captures.find((record) => record.operationId === request.normalizationSourceOperationId);
          const sourceArtifact = state.artifacts.find((artifact) => artifact.evidenceId === sourceRecord?.normalizedEvidenceId);
          const geometryPath = sourceArtifact ? path.join(this.sessionDir(request.sessionId), "working", `${sourceArtifact.evidenceId}-geometry.json`) : undefined;
          if (!geometryPath || !existsSync(geometryPath)) throw new Error("Reusable normalization geometry record is unavailable.");
          referencedGeometry = JSON.parse((await readFile(geometryPath)).toString("utf-8")) as CardGeometryMetadata;
        }
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
            : referencedGeometry
              ? { reusableGeometry: referencedGeometry }
              : {}),
        });
        if (!normalization.rawEvidencePreserved || !normalization.normalizedArtifact) {
          throw new Error("Calibration normalization must preserve raw bytes and produce a normalized derivative.");
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
        schemaVersion = "ten-kings-calibration-print-scale-measurement-v1";
        Object.assign(payload, {
          axis: request.axis,
          nominalSpanMm: finite(request.nominalSpanMm, "nominalSpanMm", 0.001),
          measuredSpanMm: finite(request.measuredSpanMm, "measuredSpanMm", 0.001),
          measurementU95Mm: finite(request.measurementU95Mm, "measurementU95Mm", 0),
          sourceMetrologyArtifactSha256: assertSha256(
            request.sourceMetrologyArtifactSha256,
            "sourceMetrologyArtifactSha256",
          ),
        });
      } else if (request.measurementType === "target_cut_dimension") {
        role = `target_cut_dimension_${request.axis}`;
        schemaVersion = "ten-kings-calibration-target-cut-dimension-measurement-v1";
        Object.assign(payload, {
          axis: request.axis,
          nominalDimensionMm: finite(request.nominalDimensionMm, "nominalDimensionMm", 0.001),
          measuredDimensionMm: finite(request.measuredDimensionMm, "measuredDimensionMm", 0.001),
          measurementU95Mm: finite(request.measurementU95Mm, "measurementU95Mm", 0),
          sourceMetrologyArtifactSha256: assertSha256(
            request.sourceMetrologyArtifactSha256,
            "sourceMetrologyArtifactSha256",
          ),
        });
      } else if (request.measurementType === "direction_geometry") {
        const channelIndex = positiveInteger(request.channelIndex, "channelIndex");
        const sampleIndex = positiveInteger(request.sampleIndex, "sampleIndex");
        if (channelIndex > 8 || sampleIndex > 3) throw new Error("Direction geometry requires channel 1-8 and sample 1-3.");
        role = `direction_geometry_channel_${channelIndex}`;
        schemaVersion = "ten-kings-calibration-direction-measurement-v1";
        Object.assign(payload, {
          channelIndex,
          sampleIndex,
          sourcePointMm: {
            x: finite(request.sourcePointMm.x, "sourcePointMm.x"),
            y: finite(request.sourcePointMm.y, "sourcePointMm.y"),
          },
          cardCenterPointMm: {
            x: finite(request.cardCenterPointMm.x, "cardCenterPointMm.x"),
            y: finite(request.cardCenterPointMm.y, "cardCenterPointMm.y"),
          },
          pointU95Mm: finite(request.pointU95Mm, "pointU95Mm", 0),
          sourceMetrologyArtifactSha256: assertSha256(
            request.sourceMetrologyArtifactSha256,
            "sourceMetrologyArtifactSha256",
          ),
        });
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
      const packageBody = {
        schemaVersion: v11 ? MATHEMATICAL_CALIBRATION_V1_1_CAPTURE_PACKAGE_SCHEMA : FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PACKAGE_V1,
        packageId: state.packageId,
        rigId: state.protectedSettings.rigId,
        captureProfileVersion: state.protectedSettings.captureProfileVersion,
        purpose: state.purpose,
        thresholdSetId: v11 ? MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_ID : MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
        thresholdSetHash: v11 ? MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_HASH : MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
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
        couponWidthMm: Number(measurementFor("target_cut_dimension", (payload) => payload.axis === "x").nominalDimensionMm),
        couponHeightMm: Number(measurementFor("target_cut_dimension", (payload) => payload.axis === "y").nominalDimensionMm),
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
