import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  mathematicalDesignReferenceV1Schema,
  type AiGraderReportBundleV03,
  type MathematicalCalibrationProfileV1,
  type MathematicalDesignReferenceV1,
  type MathematicalGradingElementV1,
  type MathematicalMeasurementV1,
} from "@tenkings/shared";
import {
  buildAiGraderMathematicalReportBundleV1,
  type AiGraderMathematicalConditionObservationPresentationV1,
  type AiGraderMathematicalEvidenceQualityLimitationV1,
  type AiGraderMathematicalFindingPresentationV1,
  type AiGraderMathematicalReportAssetBindingV1,
  type AiGraderMathematicalReportBundleV1Artifact,
  type AiGraderMathematicalReportConfidenceV1,
} from "./aiGraderMathematicalReportBundleV1";
import {
  writeAiGraderMathematicalReportPackageV1,
  type AiGraderMathematicalReportPackageV1,
} from "./aiGraderMathematicalReportPackageV1";
import {
  encodeFixedRigCalibratedDetectorPlaneV1,
  FIXED_RIG_CALIBRATED_DETECTOR_PLANE_V1_VERSION,
  FIXED_RIG_CONDITION_DETECTOR_PLANE_NAMES_V1,
  type FixedRigConditionDetectorPlaneNameV1,
} from "./fixedRigCalibratedDetectorPlaneV1";
import {
  buildFixedRigExpectedOuterCardMaskV1,
  buildFixedRigConditionPlanesV1,
  FIXED_RIG_CONDITION_PLANE_PRODUCER_V1_VERSION,
  hashFixedRigIntendedOuterBoundaryV1,
  type FixedRigOuterBoundaryArtifactV1,
  type FixedRigOuterCutGeometryEvidenceV1,
  type FixedRigRgbPlaneV1,
} from "./fixedRigConditionPlaneProducerV1";
import {
  buildFixedRigCenteringSideV1,
  fuseFixedRigCenteringFrontBackV1,
  type FixedRigCenteringProfileInputV1,
  type FixedRigPointV1,
} from "./fixedRigCenteringV1";
import { buildFixedRigPrintedBorderCenteringSideV1 } from "./fixedRigPrintedBorderDetectorV1";
import {
  buildFixedRigConditionSegmentationV1,
  type FixedRigConditionDesignRegistrationV1,
  type FixedRigConditionSourcePlanesV1,
} from "./fixedRigConditionSegmentationV1";
import {
  aggregateFixedRigCornersV1,
  aggregateFixedRigEdgesV1,
  measureFixedRigCornerObservationV1,
  measureFixedRigEdgeObservationV1,
  type FixedRigConditionMeasurementCalibrationV1,
  type FixedRigConditionObservationResultV1,
  type FixedRigCrossSideDefectLinkV1,
  type FixedRigPhysicalFindingV1,
} from "./fixedRigCornerEdgeV1";
import {
  buildFixedRigMathematicalGradeV1,
  type FixedRigMathematicalGradeV1Result,
  type FixedRigPhysicalDefectDeduplicationV1,
} from "./fixedRigMathematicalGradeV1";
import { buildFixedRigPhotometricCalibrationProfileV1 } from "./fixedRigPhotometricCalibrationV1";
import {
  buildFixedRigPhotometricEvidenceV1,
  type FixedRigPhotometricCalibrationProfileV1,
  type FixedRigPhotometricEvidenceV1,
  type FixedRigScalarPlaneV1,
} from "./fixedRigPhotometricEvidenceV1";
import type { FixedRigPhysicalCalibrationArtifactV1 } from "./fixedRigPhysicalCalibrationV1";
import { buildFixedRigSurfaceV1, type FixedRigSurfaceV1Result } from "./fixedRigSurfaceV1";
import {
  verifyCardGeometryRawToNormalizedTransformV1,
  type CardGeometryRawToNormalizedTransformV1,
} from './cardGeometry';
import { detectFixedRigRawBoundObservedOuterCutV1 } from './fixedRigRawSensorOuterCutDetectorV1';

export const FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION =
  "fixed_rig_mathematical_calibration_orchestrator_v1" as const;
export const FIXED_RIG_MATHEMATICAL_FINDING_REVIEW_REQUEST_V1_VERSION =
  "fixed_rig_mathematical_finding_review_request_v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_CHANNEL_COUNT =
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount;

type Side = "front" | "back";
type EvidenceReferenceV1 = MathematicalMeasurementV1["evidence"][number];
type FinalGradeV1 = Extract<
  FixedRigMathematicalGradeV1Result,
  { status: "final_mathematical_grade_v1" }
>;
type ComputedConditionSegmentationV1 = Extract<
  ReturnType<typeof buildFixedRigConditionSegmentationV1>,
  { status: "computed" }
>;
type ComputedSurfaceV1 = FixedRigSurfaceV1Result & { status: "computed"; score: number };

export interface FixedRigExactInputFileV1 {
  filePath: string;
  sha256: string;
}

export interface FixedRigExactReportEvidenceFileV1 extends FixedRigExactInputFileV1 {
  assetId: string;
  fileName: string;
  contentType: string;
}

export interface FixedRigExactDirectionalChannelV1 extends FixedRigExactReportEvidenceFileV1 {
  channel: number;
  channelConfidence: number;
}

export type FixedRigMathematicalCardIdentityV1 = AiGraderReportBundleV03["cardIdentity"] & {
  title: string;
  sideCount: 2;
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  parallelId: string | null;
};

export type FixedRigMathematicalCenteringSideEvidenceV1 =
  | {
      /** Printed lines are detected from the immutable all-on image. */
      profileInput: { profile: "printed_border_v1" };
    }
  | {
      profileInput: Extract<
        FixedRigCenteringProfileInputV1,
        { profile: "registered_design_template_v1" }
      >;
    };

export interface FixedRigMathematicalCalibrationSideInputV1 {
  rawAllOn: FixedRigExactReportEvidenceFileV1;
  rawToNormalizedTransform: CardGeometryRawToNormalizedTransformV1;
  normalizedAllOn: FixedRigExactReportEvidenceFileV1;
  normalizedCard: FixedRigExactReportEvidenceFileV1;
  directionalChannels: FixedRigExactDirectionalChannelV1[];
  darkControl: FixedRigExactReportEvidenceFileV1;
  /** Exact approved card-format cut geometry; never inferred from frame size. */
  intendedOuterBoundary: FixedRigOuterBoundaryArtifactV1;
  designReference?: MathematicalDesignReferenceV1;
  designReferenceArtifact?: FixedRigExactReportEvidenceFileV1;
  designRegistration?: FixedRigConditionDesignRegistrationV1;
  centering: FixedRigMathematicalCenteringSideEvidenceV1;
  measurementCalibration: FixedRigConditionMeasurementCalibrationV1;
  algorithmVersion: string;
}

export interface FixedRigMathematicalFindingReviewV1 {
  findingId: string;
  reviewRequestSha256: string;
  status: "confirmed" | "adjusted";
  reviewedAt: string;
}

export interface FixedRigMathematicalFindingReviewAssetMetadataV1 {
  assetId: string;
  evidenceRole: "roi_crop" | "segmentation_mask" | "confidence_mask" | "illumination_mask" | "normalized_card" | "directional_channel";
  sha256: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
}

export interface FixedRigMathematicalFindingReviewAssetV1
  extends FixedRigMathematicalFindingReviewAssetMetadataV1 {
  bytes: Buffer;
}

export interface FixedRigMathematicalFindingReviewRequestV1 {
  schemaVersion: typeof FIXED_RIG_MATHEMATICAL_FINDING_REVIEW_REQUEST_V1_VERSION;
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
    element: MathematicalGradingElementV1;
    category: string;
    side: Side;
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
    measurements: MathematicalMeasurementV1[];
    evidenceAssetIds: string[];
    trueView: FixedRigMathematicalFindingReviewAssetMetadataV1;
    directionalChannels: FixedRigMathematicalFindingReviewAssetMetadataV1[];
    reviewEvidence: {
      roi: FixedRigMathematicalFindingReviewAssetMetadataV1;
      segmentationMask: FixedRigMathematicalFindingReviewAssetMetadataV1;
      confidenceMask: FixedRigMathematicalFindingReviewAssetMetadataV1;
      illuminationMask: FixedRigMathematicalFindingReviewAssetMetadataV1;
    };
    explanation: string;
  }>;
  hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted";
  artifactSha256: string;
}

export interface BuildFixedRigMathematicalCalibrationOrchestratorV1Input {
  /** Explicit opt-in. Ordinary sessions remain legacy_v0 and never call this seam. */
  gradingContract: "mathematical_calibration_v1";
  gradingSessionId: string;
  generatedAt: string;
  reportId: string;
  outputDir: string;
  captureProfileVersion: string;
  cardIdentity: FixedRigMathematicalCardIdentityV1;
  calibration: {
    finalizedProfile: MathematicalCalibrationProfileV1;
    /** Must come from the verified finalized-bundle loader; never caller-authored metadata. */
    bundleAuthority: AiGraderReportBundleV03["calibrationBundleAuthority"];
    physicalArtifact: FixedRigExactInputFileV1;
    flatFieldArtifacts: FixedRigExactInputFileV1[];
    illuminationPatternArtifact: FixedRigExactInputFileV1;
    sensorMaximumValue: number;
  };
  sides: {
    front: FixedRigMathematicalCalibrationSideInputV1;
    back: FixedRigMathematicalCalibrationSideInputV1;
  };
  cornerCrossSideLinks?: FixedRigCrossSideDefectLinkV1[];
  edgeCrossSideLinks?: FixedRigCrossSideDefectLinkV1[];
  physicalDefectDeduplication?: FixedRigPhysicalDefectDeduplicationV1[];
  findingReviews?: FixedRigMathematicalFindingReviewV1[];
  report: {
    publication: {
      certId: string;
      publicReportUrl: string;
      qrPayloadUrl: string;
    };
    evidenceQualityLimitations?: AiGraderMathematicalEvidenceQualityLimitationV1[];
    geometry?: Record<string, unknown>;
    geometryCaptureDecisions?: Record<string, unknown>;
    captureTiming?: Record<string, unknown>;
    ocrPrefill?: Record<string, unknown>;
    warnings?: string[];
    limitations?: string[];
  };
}

export type FixedRigMathematicalOrchestrationStageV1 =
  | "input_contract"
  | "calibration_ingestion"
  | "photometric_calibration"
  | "capture_evidence_ingestion"
  | "photometric_evidence"
  | "detector_plane_ingestion"
  | "condition_segmentation"
  | "centering"
  | "corner_edge_measurement"
  | "surface_measurement"
  | "grade_composition"
  | "finding_review"
  | "report_adaptation"
  | "package_write";

export interface FixedRigMathematicalCalibrationOrchestrationSummaryV1 {
  calibration: { profileId: string; version: string; artifactSha256: string };
  sides: Record<Side, {
    validPixelFraction: number;
    invalidPixelFraction: number;
    cornerFindingCount: number;
    edgeFindingCount: number;
    surfaceFindingCount: number;
    suppressedSurfaceCandidateCount: number;
    surfaceScore: number;
  }>;
  scores: {
    centering: number;
    corners: number;
    edges: number;
    surface: number;
    overall: number;
    label: number;
  };
}

export type BuildFixedRigMathematicalCalibrationOrchestratorV1Result =
  | {
      version: typeof FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION;
      status: "completed";
      gradingContract: "mathematical_calibration_v1";
      v0FallbackUsed: false;
      reportArtifact: AiGraderMathematicalReportBundleV1Artifact;
      reportPackage: AiGraderMathematicalReportPackageV1;
      stationInput: {
        gradingContract: "mathematical_calibration_v1";
        mathematicalReportPackagePath: string;
      };
      grade: FinalGradeV1;
      orchestrationTraceSha256: string;
      summary: FixedRigMathematicalCalibrationOrchestrationSummaryV1;
    }
  | {
      version: typeof FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION;
      status: "finding_review_required";
      gradingContract: "mathematical_calibration_v1";
      v0FallbackUsed: false;
      failedStage: "finding_review";
      reviewRequest: FixedRigMathematicalFindingReviewRequestV1;
      reviewAssets: FixedRigMathematicalFindingReviewAssetV1[];
      reviewIssues: string[];
      grade: FinalGradeV1;
      summary: FixedRigMathematicalCalibrationOrchestrationSummaryV1;
      reportPackage: null;
      stationInput: null;
    }
  | {
      version: typeof FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION;
      status: "insufficient_evidence";
      gradingContract: "mathematical_calibration_v1";
      v0FallbackUsed: false;
      failedStage: FixedRigMathematicalOrchestrationStageV1;
      reasons: string[];
      requiresRecapture: boolean;
      requiresApprovedDesignReference: boolean;
      requiresCalibration: boolean;
      requiresImplementationCorrection: boolean;
      reportPackage: null;
      stationInput: null;
    };

class OrchestrationFailureV1 extends Error {
  constructor(
    readonly stage: FixedRigMathematicalOrchestrationStageV1,
    message: string,
    readonly flags: {
      requiresRecapture?: boolean;
      requiresApprovedDesignReference?: boolean;
      requiresCalibration?: boolean;
      requiresImplementationCorrection?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "OrchestrationFailureV1";
  }
}

function fail(
  stage: FixedRigMathematicalOrchestrationStageV1,
  message: string,
  flags: OrchestrationFailureV1["flags"] = {},
): never {
  throw new OrchestrationFailureV1(stage, message, flags);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
}

function assertCalibrationBundleAuthorityV1(
  input: BuildFixedRigMathematicalCalibrationOrchestratorV1Input["calibration"],
): void {
  const authority = input.bundleAuthority;
  const memberLedgerSha256 = sha256(
    Buffer.from(JSON.stringify(canonical(authority.members)), "utf8"),
  );
  if (memberLedgerSha256 !== authority.memberLedgerSha256) {
    return fail("calibration_ingestion", "Verified calibration-bundle member-ledger SHA-256 mismatch.", {
      requiresCalibration: true,
    });
  }
  const memberFor = (role: string, channelIndex?: number) =>
    authority.members.find((member) =>
      member.role === role &&
      (channelIndex === undefined || ("channelIndex" in member && member.channelIndex === channelIndex)));
  if (
    memberFor("physical_calibration_artifact")?.sha256 !== input.physicalArtifact.sha256.toLowerCase() ||
    memberFor("illumination_pattern")?.sha256 !== input.illuminationPatternArtifact.sha256.toLowerCase()
  ) {
    return fail("calibration_ingestion", "Calibration input files do not match the verified bundle member authority.", {
      requiresCalibration: true,
    });
  }
  for (let channelIndex = 1; channelIndex <= REQUIRED_CHANNEL_COUNT; channelIndex += 1) {
    const file = input.flatFieldArtifacts[channelIndex - 1];
    const profileChannel = input.finalizedProfile.channels.find((channel) =>
      channel.channelIndex === channelIndex);
    const authorityMember = memberFor("flat_field", channelIndex);
    if (
      !file || !profileChannel || !authorityMember ||
      authorityMember.sha256 !== file.sha256.toLowerCase() ||
      authorityMember.sha256 !== profileChannel.flatFieldArtifactSha256
    ) {
      return fail("calibration_ingestion", "Flat-field inputs do not match the verified bundle and finalized profile authority.", {
        requiresCalibration: true,
      });
    }
  }
  const illuminationMember = memberFor("illumination_pattern");
  if (
    !illuminationMember ||
    input.finalizedProfile.channels.some((channel) =>
      channel.illuminationPatternArtifactSha256 !== illuminationMember.sha256)
  ) {
    return fail("calibration_ingestion", "Illumination-pattern input does not match every finalized profile channel.", {
      requiresCalibration: true,
    });
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 600) : "unknown V1 contract error";
}

async function readExactFileV1(
  input: FixedRigExactInputFileV1,
  label: string,
  stage: FixedRigMathematicalOrchestrationStageV1,
): Promise<Buffer> {
  const expected = input.sha256?.toLowerCase();
  if (!input.filePath || !SHA256.test(expected)) {
    return fail(stage, `${label} requires an exact local path and SHA-256.`, {
      requiresImplementationCorrection: true,
    });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(input.filePath);
  } catch {
    return fail(stage, `${label} exact evidence file is unavailable.`, {
      requiresImplementationCorrection: true,
    });
  }
  if (sha256(bytes) !== expected) {
    return fail(stage, `${label} exact file SHA-256 mismatch.`, {
      requiresImplementationCorrection: true,
    });
  }
  return bytes;
}

async function decodeGrayPlaneV1(input: {
  bytes: Uint8Array;
  width: number;
  height: number;
  sensorMaximumValue: number;
  label: string;
}): Promise<FixedRigScalarPlaneV1> {
  let result: { data: Buffer; info: { width: number; height: number; channels: number } };
  try {
    result = await sharp(input.bytes, { failOn: "error" })
      .removeAlpha()
      .greyscale()
      .raw({ depth: "float" })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return fail("capture_evidence_ingestion", `${input.label} cannot be decoded as immutable image evidence.`, {
      requiresRecapture: true,
    });
  }
  if (result.info.width !== input.width || result.info.height !== input.height ||
      result.info.channels !== 1 || result.data.byteLength !== input.width * input.height * 4) {
    return fail("capture_evidence_ingestion", `${input.label} does not match the finalized normalized frame.`, {
      requiresRecapture: true,
    });
  }
  const data = new Float32Array(input.width * input.height);
  for (let index = 0; index < data.length; index += 1) {
    const value = result.data.readFloatLE(index * 4);
    if (!Number.isFinite(value) || value < 0 || value > input.sensorMaximumValue + 1e-6) {
      return fail("capture_evidence_ingestion", `${input.label} contains values outside the certified sensor range.`, {
        requiresRecapture: true,
      });
    }
    data[index] = value;
  }
  return { width: input.width, height: input.height, data };
}

async function decodeRgbPlaneV1(input: {
  bytes: Uint8Array;
  width: number;
  height: number;
  sensorMaximumValue: number;
  label: string;
}): Promise<FixedRigRgbPlaneV1> {
  let result: { data: Buffer; info: { width: number; height: number; channels: number } };
  try {
    result = await sharp(input.bytes, { failOn: "error" })
      .removeAlpha()
      .toColourspace("srgb")
      .raw({ depth: "float" })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return fail("capture_evidence_ingestion", `${input.label} cannot be decoded as immutable RGB evidence.`, {
      requiresRecapture: true,
    });
  }
  if (result.info.width !== input.width || result.info.height !== input.height ||
      result.info.channels !== 3 || result.data.byteLength !== input.width * input.height * 3 * 4) {
    return fail("capture_evidence_ingestion", `${input.label} does not match the finalized three-channel normalized frame.`, {
      requiresRecapture: true,
    });
  }
  if (!Number.isFinite(input.sensorMaximumValue) || input.sensorMaximumValue <= 0) {
    return fail("calibration_ingestion", "Finalized sensor maximum must be positive before RGB normalization.", {
      requiresCalibration: true,
    });
  }
  const data = new Float32Array(input.width * input.height * 3);
  for (let index = 0; index < data.length; index += 1) {
    const value = result.data.readFloatLE(index * 4);
    if (!Number.isFinite(value) || value < 0 || value > input.sensorMaximumValue + 1e-6) {
      return fail("capture_evidence_ingestion", `${input.label} contains RGB values outside the certified sensor range.`, {
        requiresRecapture: true,
      });
    }
    data[index] = value / input.sensorMaximumValue;
  }
  return { width: input.width, height: input.height, data };
}

function evidenceKey(reference: Pick<EvidenceReferenceV1, "assetId">): string {
  return reference.assetId.toLowerCase();
}

function exactIdentityMatches(
  identity: FixedRigMathematicalCardIdentityV1,
  reference: MathematicalDesignReferenceV1,
): boolean {
  return identity.tenantId === reference.tenantId && identity.setId === reference.setId &&
    identity.programId === reference.programId && identity.cardNumber === reference.cardNumber &&
    identity.variantId === reference.variantId && identity.parallelId === reference.parallelId;
}

function assertMeasurementCalibrationV1(
  input: FixedRigConditionMeasurementCalibrationV1,
  profile: MathematicalCalibrationProfileV1,
  side: Side,
): void {
  const expectedX = 1 / profile.mmPerPixelX;
  const expectedY = 1 / profile.mmPerPixelY;
  if (
    input.profile.profileId !== profile.profileId ||
    input.profile.calibrationVersion !== profile.calibrationVersion ||
    input.profile.artifactSha256.toLowerCase() !== profile.artifactSha256.toLowerCase() ||
    input.calibrationProfileId !== profile.profileId ||
    input.calibrationVersion !== profile.calibrationVersion ||
    input.calibrationSha256.toLowerCase() !== profile.artifactSha256.toLowerCase() ||
    Math.abs(input.pixelsPerMmX - expectedX) > 1e-9 ||
    Math.abs(input.pixelsPerMmY - expectedY) > 1e-9
  ) {
    fail("input_contract", `${side} measurement calibration does not exactly match the finalized physical profile and scale.`, {
      requiresCalibration: true,
    });
  }
}

interface IngestedSideV1 {
  side: Side;
  input: FixedRigMathematicalCalibrationSideInputV1;
  normalizedBytes: Buffer;
  normalizedReference: EvidenceReferenceV1;
  channelAssetIds: string[];
  detectorPlaneSha256s: Record<string, string>;
  assetBindings: AiGraderMathematicalReportAssetBindingV1[];
  photometric: FixedRigPhotometricEvidenceV1;
  condition: ComputedConditionSegmentationV1;
  outerCutGeometryEvidence: FixedRigOuterCutGeometryEvidenceV1;
  centering: Extract<ReturnType<typeof buildFixedRigCenteringSideV1>, { status: "computed" }>;
  surface: ComputedSurfaceV1;
  visualizationAssetIds: {
    commonModeResponse: string;
    invalidIlluminationMask: string;
    confidenceMask: string;
    heatmap: string;
    surfaceVision: string;
  };
}

async function ingestSideV1(input: {
  side: Side;
  sideInput: FixedRigMathematicalCalibrationSideInputV1;
  cardIdentity: FixedRigMathematicalCardIdentityV1;
  profile: MathematicalCalibrationProfileV1;
  photometricCalibration: FixedRigPhotometricCalibrationProfileV1;
  sensorMaximumValue: number;
}): Promise<IngestedSideV1> {
  const { side, sideInput, profile } = input;
  const rawSideInput = sideInput as unknown as Record<string, unknown>;
  if (
    "calibratedDetectorPlanes" in rawSideInput ||
    "gradeRelevantMask" in rawSideInput ||
    "conditionPlanes" in rawSideInput
  ) {
    return fail("input_contract", `${side} caller-supplied detector or grading masks are prohibited; physical V1 derives them from captured evidence.`, {
      requiresImplementationCorrection: true,
    });
  }
  assertMeasurementCalibrationV1(sideInput.measurementCalibration, profile, side);
  const rawCentering = sideInput.centering as unknown as Record<string, unknown>;
  const rawProfileInput = sideInput.centering.profileInput as unknown as Record<string, unknown>;
  if ("outerCutContour" in rawCentering || "outerCutBoundaryConfidence" in rawCentering ||
      "printBoundarySamples" in rawProfileInput) {
    return fail("input_contract", `${side} caller-authored outer contours, contour confidence, and printed-line samples are prohibited.`, {
      requiresImplementationCorrection: true,
    });
  }
  if (
    sideInput.intendedOuterBoundary.profileId === profile.profileId ||
    sideInput.intendedOuterBoundary.profileVersion === profile.calibrationVersion ||
    sideInput.intendedOuterBoundary.artifactSha256 !==
      hashFixedRigIntendedOuterBoundaryV1(sideInput.intendedOuterBoundary)
  ) {
    return fail("input_contract", `${side} requires an exact hash-bound card-format intended-cut profile distinct from calibration/coupon authority.`, {
      requiresImplementationCorrection: true,
    });
  }
  const designParts = [
    sideInput.designReference,
    sideInput.designReferenceArtifact,
    sideInput.designRegistration,
  ];
  const hasAnyDesignEvidence = designParts.some(Boolean);
  const hasCompleteDesignEvidence = designParts.every(Boolean);
  const registeredCentering =
    sideInput.centering.profileInput.profile === "registered_design_template_v1";
  if ((hasAnyDesignEvidence && !hasCompleteDesignEvidence) ||
      (registeredCentering && !hasCompleteDesignEvidence)) {
    return fail("input_contract", `${side} registered-design evidence must supply its approved reference, exact artifact, and registration together.`, {
      requiresApprovedDesignReference: true,
    });
  }
  if (hasCompleteDesignEvidence) {
    const reference = sideInput.designReference!;
    const artifact = sideInput.designReferenceArtifact!;
    const parsedReference = mathematicalDesignReferenceV1Schema.safeParse(reference);
    if (!parsedReference.success || reference.side !== side ||
        !exactIdentityMatches(input.cardIdentity, reference)) {
      return fail("input_contract", `${side} approved design reference does not match the exact card identity and side.`, {
        requiresApprovedDesignReference: true,
      });
    }
    if (reference.widthPx !== profile.normalizedWidthPx ||
        reference.heightPx !== profile.normalizedHeightPx) {
      return fail("input_contract", `${side} approved design reference is not in the finalized normalized frame.`, {
        requiresApprovedDesignReference: true,
      });
    }
    if (artifact.assetId !== reference.artifactId) {
      return fail("input_contract", `${side} approved design artifact ID does not match its immutable reference.`, {
        requiresApprovedDesignReference: true,
      });
    }
  }
  const rawAllOnBytes = await readExactFileV1(
    sideInput.rawAllOn,
    `${side} raw sensor all-on capture`,
    'capture_evidence_ingestion',
  );
  const rawToNormalizedTransform = sideInput.rawToNormalizedTransform;
  if (!verifyCardGeometryRawToNormalizedTransformV1(rawToNormalizedTransform) ||
      rawToNormalizedTransform.sourceSha256 !== sideInput.rawAllOn.sha256.toLowerCase() ||
      rawToNormalizedTransform.outputWidthPx !== profile.normalizedWidthPx ||
      rawToNormalizedTransform.outputHeightPx !== profile.normalizedHeightPx) {
    return fail('capture_evidence_ingestion', `${side} raw all-on evidence is not bound to the exact recorded normalization transform.`, {
      requiresRecapture: true,
      requiresImplementationCorrection: true,
    });
  }
  const normalizedBytes = await readExactFileV1(
    sideInput.normalizedCard,
    `${side} normalized card`,
    "capture_evidence_ingestion",
  );
  const allOnBytes = await readExactFileV1(
    sideInput.normalizedAllOn,
    `${side} normalized all-on capture`,
    "capture_evidence_ingestion",
  );
  const designBytes = hasCompleteDesignEvidence
    ? await readExactFileV1(
        sideInput.designReferenceArtifact!,
        `${side} approved design artifact`,
        "capture_evidence_ingestion",
      )
    : undefined;
  if (designBytes && sha256(designBytes) !== sideInput.designReference!.artifactSha256.toLowerCase()) {
    return fail("capture_evidence_ingestion", `${side} approved design artifact hash does not match its approved reference.`, {
      requiresApprovedDesignReference: true,
      requiresImplementationCorrection: true,
    });
  }
  if (designBytes) {
    let designMetadata: { width?: number; height?: number };
    try {
      designMetadata = await sharp(designBytes, { failOn: "error" }).metadata();
    } catch {
      return fail("capture_evidence_ingestion", `${side} approved design artifact cannot be decoded.`, {
        requiresApprovedDesignReference: true,
      });
    }
    if (designMetadata.width !== profile.normalizedWidthPx || designMetadata.height !== profile.normalizedHeightPx) {
      return fail("capture_evidence_ingestion", `${side} approved design image dimensions do not match its reference.`, {
        requiresApprovedDesignReference: true,
      });
    }
  }
  const rawAllOnRgb = await decodeRgbPlaneV1({
    bytes: rawAllOnBytes,
    width: rawToNormalizedTransform.sourceWidthPx,
    height: rawToNormalizedTransform.sourceHeightPx,
    sensorMaximumValue: input.sensorMaximumValue,
    label: `${side} raw sensor all-on capture`,
  });
  const normalizedRgb = await decodeRgbPlaneV1({
    bytes: normalizedBytes,
    width: profile.normalizedWidthPx,
    height: profile.normalizedHeightPx,
    sensorMaximumValue: input.sensorMaximumValue,
    label: `${side} normalized card`,
  });
  const allOnRgb = await decodeRgbPlaneV1({
    bytes: allOnBytes,
    width: profile.normalizedWidthPx,
    height: profile.normalizedHeightPx,
    sensorMaximumValue: input.sensorMaximumValue,
    label: `${side} normalized all-on capture`,
  });
  const designRgb = designBytes
    ? await decodeRgbPlaneV1({
        bytes: designBytes,
        width: profile.normalizedWidthPx,
        height: profile.normalizedHeightPx,
        sensorMaximumValue: input.sensorMaximumValue,
        label: `${side} approved design artifact`,
      })
    : undefined;
  const indexes = sideInput.directionalChannels.map((channel) => channel.channel);
  if (indexes.length !== REQUIRED_CHANNEL_COUNT || new Set(indexes).size !== REQUIRED_CHANNEL_COUNT ||
      indexes.some((channel) => !Number.isInteger(channel) || channel < 1 || channel > REQUIRED_CHANNEL_COUNT)) {
    return fail("input_contract", `${side} requires each fixed-rig directional channel exactly once.`, {
      requiresRecapture: true,
    });
  }
  const sortedChannels = [...sideInput.directionalChannels].sort((left, right) => left.channel - right.channel);
  const channelInputs: Parameters<typeof buildFixedRigPhotometricEvidenceV1>[0]["channels"] = [];
  const channelReferences: EvidenceReferenceV1[] = [];
  const assetBindings: AiGraderMathematicalReportAssetBindingV1[] = [
    {
      id: sideInput.rawAllOn.assetId,
      side,
      evidenceRole: 'other_evidence',
      fileName: sideInput.rawAllOn.fileName,
      contentType: sideInput.rawAllOn.contentType,
      bytes: rawAllOnBytes,
      sha256: sideInput.rawAllOn.sha256.toLowerCase(),
      widthPx: rawToNormalizedTransform.sourceWidthPx,
      heightPx: rawToNormalizedTransform.sourceHeightPx,
    },
    {
      id: sideInput.normalizedAllOn.assetId,
      side,
      evidenceRole: "other_evidence",
      fileName: sideInput.normalizedAllOn.fileName,
      contentType: sideInput.normalizedAllOn.contentType,
      bytes: allOnBytes,
      sha256: sideInput.normalizedAllOn.sha256.toLowerCase(),
      widthPx: profile.normalizedWidthPx,
      heightPx: profile.normalizedHeightPx,
    },
    {
      id: sideInput.normalizedCard.assetId,
      side,
      evidenceRole: "normalized_card",
      fileName: sideInput.normalizedCard.fileName,
      contentType: sideInput.normalizedCard.contentType,
      bytes: normalizedBytes,
      sha256: sideInput.normalizedCard.sha256.toLowerCase(),
      widthPx: profile.normalizedWidthPx,
      heightPx: profile.normalizedHeightPx,
    },
  ];
  if (designBytes) {
    const artifact = sideInput.designReferenceArtifact!;
    assetBindings.push({
      id: artifact.assetId,
      side,
      evidenceRole: "design_reference",
      fileName: artifact.fileName,
      contentType: artifact.contentType,
      bytes: designBytes,
      sha256: artifact.sha256.toLowerCase(),
      widthPx: profile.normalizedWidthPx,
      heightPx: profile.normalizedHeightPx,
    });
  }
  for (const channel of sortedChannels) {
    if (!Number.isFinite(channel.channelConfidence) || channel.channelConfidence < 0 || channel.channelConfidence > 1) {
      return fail("input_contract", `${side} channel ${channel.channel} confidence is not a measured fraction.`, {
        requiresRecapture: true,
      });
    }
    const bytes = await readExactFileV1(
      channel,
      `${side} directional channel ${channel.channel}`,
      "capture_evidence_ingestion",
    );
    const image = await decodeGrayPlaneV1({
      bytes,
      width: profile.normalizedWidthPx,
      height: profile.normalizedHeightPx,
      sensorMaximumValue: input.sensorMaximumValue,
      label: `${side} directional channel ${channel.channel}`,
    });
    channelInputs.push({
      channel: channel.channel,
      image,
      channelConfidence: channel.channelConfidence,
      sourceEvidenceId: channel.assetId,
      sourceSha256: channel.sha256.toLowerCase(),
    });
    channelReferences.push({
      assetId: channel.assetId,
      sha256: channel.sha256.toLowerCase(),
      side,
      role: "directional_channel",
      regionId: `${side}-full-card`,
      channelIndex: channel.channel,
    });
    assetBindings.push({
      id: channel.assetId,
      side,
      evidenceRole: "directional_channel",
      fileName: channel.fileName,
      contentType: channel.contentType,
      bytes,
      sha256: channel.sha256.toLowerCase(),
      widthPx: profile.normalizedWidthPx,
      heightPx: profile.normalizedHeightPx,
    });
  }
  const darkBytes = await readExactFileV1(
    sideInput.darkControl,
    `${side} registered dark control`,
    "capture_evidence_ingestion",
  );
  const darkControl = await decodeGrayPlaneV1({
    bytes: darkBytes,
    width: profile.normalizedWidthPx,
    height: profile.normalizedHeightPx,
    sensorMaximumValue: input.sensorMaximumValue,
    label: `${side} registered dark control`,
  });
  assetBindings.push({
    id: sideInput.darkControl.assetId,
    side,
    evidenceRole: "other_evidence",
    fileName: sideInput.darkControl.fileName,
    contentType: sideInput.darkControl.contentType,
    bytes: darkBytes,
    sha256: sideInput.darkControl.sha256.toLowerCase(),
    widthPx: profile.normalizedWidthPx,
    heightPx: profile.normalizedHeightPx,
  });
  const normalizedReference: EvidenceReferenceV1 = {
    assetId: sideInput.normalizedCard.assetId,
    sha256: sideInput.normalizedCard.sha256.toLowerCase(),
    side,
    role: "normalized_card",
    regionId: `${side}-full-card`,
  };
  const allOnReference: EvidenceReferenceV1 = {
    assetId: sideInput.normalizedAllOn.assetId,
    sha256: sideInput.normalizedAllOn.sha256.toLowerCase(),
    side,
    role: "all_on",
    regionId: `${side}-full-card`,
  };
  const designReference: EvidenceReferenceV1 | undefined = designBytes
    ? {
        assetId: sideInput.designReferenceArtifact!.assetId,
        sha256: sideInput.designReferenceArtifact!.sha256.toLowerCase(),
        side,
        role: "design_reference",
        regionId: `${side}-full-card`,
      }
    : undefined;
  const rawSourceEvidence = [
    allOnReference,
    normalizedReference,
    ...(designReference ? [designReference] : []),
    ...channelReferences,
  ];
  if (new Set(rawSourceEvidence.map(evidenceKey)).size !== rawSourceEvidence.length) {
    return fail("input_contract", `${side} raw evidence asset IDs must be unique across all-on, normalized, design, and directional inputs.`, {
      requiresImplementationCorrection: true,
    });
  }
  let gradeRelevantMask: FixedRigScalarPlaneV1;
  let expectedOuterCardMaskBytes: Buffer;
  let expectedOuterCardMask: FixedRigScalarPlaneV1;
  const intendedOuterBoundary = sideInput.intendedOuterBoundary;
  const observedCut = detectFixedRigRawBoundObservedOuterCutV1({
    rawAllOnRgb,
    rawAllOnAssetId: sideInput.rawAllOn.assetId,
    rawAllOnAssetSha256: sideInput.rawAllOn.sha256.toLowerCase(),
    normalizedAllOnAssetId: sideInput.normalizedAllOn.assetId,
    normalizedAllOnAssetSha256: sideInput.normalizedAllOn.sha256.toLowerCase(),
    rawToNormalizedTransform,
    calibrationProfileId: profile.profileId,
    calibrationVersion: profile.calibrationVersion,
    calibrationSha256: profile.artifactSha256.toLowerCase(),
    intendedBoundary: intendedOuterBoundary,
    pixelsPerMmX: sideInput.measurementCalibration.pixelsPerMmX,
    pixelsPerMmY: sideInput.measurementCalibration.pixelsPerMmY,
    segmentationBoundaryU95Px: profile.segmentationBoundaryU95Px,
  });
  if (observedCut.status !== 'computed') {
    return fail('detector_plane_ingestion', `${side} raw-sensor outer-cut evidence is insufficient: ${observedCut.reasons.join('; ')}`, {
      requiresRecapture: true,
    });
  }
  const expectedOuterCardMaskAssetId =
    `${side}/mathematical-v1/detector-planes/expectedOuterCardMask.tkplane`;
  const conditionEvidenceDomainMaskAssetId =
    `${side}/mathematical-v1/detector-planes/conditionEvidenceDomainMask.json`;
  try {
    expectedOuterCardMask = buildFixedRigExpectedOuterCardMaskV1({
      width: profile.normalizedWidthPx,
      height: profile.normalizedHeightPx,
      outerCutContour: intendedOuterBoundary.contour,
    });
    if (!Array.from(expectedOuterCardMask.data).some((value) => Number(value) === 1)) {
      return fail("detector_plane_ingestion", `${side} intended card-format contour contains no grade-relevant pixels.`, {
        requiresRecapture: true,
      });
    }
    expectedOuterCardMaskBytes = encodeFixedRigCalibratedDetectorPlaneV1({
      header: {
        schemaVersion: FIXED_RIG_CALIBRATED_DETECTOR_PLANE_V1_VERSION,
        assetId: expectedOuterCardMaskAssetId,
        side,
        planeName: "expectedOuterCardMask",
        coordinateFrame: "normalized_card_portrait_pixels",
        width: profile.normalizedWidthPx,
        height: profile.normalizedHeightPx,
        dataType: "float32le",
        detector: {
          id: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.conditionPlaneProducer.producerId,
          version: FIXED_RIG_CONDITION_PLANE_PRODUCER_V1_VERSION,
        },
        calibration: {
          profileId: profile.profileId,
          version: profile.calibrationVersion,
          sha256: profile.artifactSha256.toLowerCase(),
        },
        derivation: "normalized_physical_segmentation",
        sourceEvidence: [normalizedReference],
        heatmapUsedAsInput: false,
        manualOverrideUsed: false,
      },
      plane: expectedOuterCardMask,
    });
  } catch (error) {
    if (error instanceof OrchestrationFailureV1) throw error;
    return fail("detector_plane_ingestion", `${side} grade-relevant outer-card mask could not be produced: ${safeMessage(error)}.`, {
      requiresImplementationCorrection: true,
    });
  }
  // The bounded evidence domain includes the card and the exterior perimeter
  // search band needed to prove chips/protrusions. Physical capture producers
  // must bind raw exterior pixels and their raw-to-normalized transform; the
  // intended material mask above remains a separate card-format authority.
  gradeRelevantMask = {
    width: profile.normalizedWidthPx,
    height: profile.normalizedHeightPx,
    data: new Float32Array(
      profile.normalizedWidthPx * profile.normalizedHeightPx,
    ).fill(1),
  };
  const conditionEvidenceDomainMaskBytes = canonicalJsonBytes({
    schemaVersion: "fixed-rig-condition-evidence-domain-mask-v1",
    assetId: conditionEvidenceDomainMaskAssetId,
    side,
    coordinateFrame: "normalized_card_portrait_pixels",
    width: gradeRelevantMask.width,
    height: gradeRelevantMask.height,
    calibrationProfileId: profile.profileId,
    calibrationVersion: profile.calibrationVersion,
    calibrationSha256: profile.artifactSha256,
    intendedBoundaryArtifactSha256: intendedOuterBoundary.artifactSha256,
    derivation: "complete_bounded_capture_domain_including_outer_cut_search_evidence",
    dataEncoding: "all_pixels_equal_one",
    manualOverrideUsed: false,
  });
  const conditionEvidenceDomainMaskSha256 =
    sha256(conditionEvidenceDomainMaskBytes);
  assetBindings.push({
    id: conditionEvidenceDomainMaskAssetId,
    side,
    evidenceRole: "segmentation_mask",
    fileName: `${side}-condition-evidence-domain-mask.json`,
    contentType: "application/json",
    bytes: conditionEvidenceDomainMaskBytes,
    sha256: conditionEvidenceDomainMaskSha256,
    byteSize: conditionEvidenceDomainMaskBytes.byteLength,
  });
  let photometric: FixedRigPhotometricEvidenceV1;
  try {
    photometric = buildFixedRigPhotometricEvidenceV1({
      channels: channelInputs,
      calibration: input.photometricCalibration,
      darkControl,
      gradeRelevantMask,
      gradeRelevantMaskSourceEvidenceId: conditionEvidenceDomainMaskAssetId,
      gradeRelevantMaskSourceSha256: conditionEvidenceDomainMaskSha256,
    });
  } catch (error) {
    return fail("photometric_evidence", `Unable to compute ${side} calibrated photometric evidence: ${safeMessage(error)}.`, {
      requiresImplementationCorrection: true,
    });
  }
  if (photometric.status !== "computed") {
    return fail("photometric_evidence", `${side} evidence has insufficient valid directional coverage and requires recapture.`, {
      requiresRecapture: true,
    });
  }
  const produced = buildFixedRigConditionPlanesV1({
    side,
    normalizedAllOnRgb: allOnRgb,
    normalizedAcceptedProfileRgb: normalizedRgb,
    approvedDesignReferenceRgb: designRgb,
    designRegistration: sideInput.designRegistration,
    intendedOuterBoundary,
    rawBoundObservedOuterCut: observedCut.artifact,
    photometricEvidence: photometric,
    measurementCalibration: sideInput.measurementCalibration,
    sourceEvidence: rawSourceEvidence,
  });
  if (produced.status !== "computed") {
    return fail("detector_plane_ingestion", `${side} physical detector-plane production is insufficient: ${produced.reasons.join("; ")}`, {
      requiresRecapture: produced.requiresRecapture,
      requiresApprovedDesignReference: produced.requiresApprovedDesignReference,
      requiresCalibration: produced.requiresCalibration,
    });
  }
  if (
    produced.planes.expectedOuterCardMask.width !== expectedOuterCardMask.width ||
    produced.planes.expectedOuterCardMask.height !== expectedOuterCardMask.height ||
    Array.from(produced.planes.expectedOuterCardMask.data).some(
      (value, index) => Number(value) !== Number(expectedOuterCardMask.data[index]),
    )
  ) {
    return fail("detector_plane_ingestion", `${side} full detector production did not reproduce the exact intended card-format material mask.`, {
      requiresImplementationCorrection: true,
    });
  }
  const planes: FixedRigConditionSourcePlanesV1 = produced.planes;
  const planeReferences: EvidenceReferenceV1[] = [];
  const detectorPlaneSha256s: Record<string, string> = {};
  const planeReferenceByName = new Map<FixedRigConditionDetectorPlaneNameV1, EvidenceReferenceV1>();
  for (const planeName of FIXED_RIG_CONDITION_DETECTOR_PLANE_NAMES_V1) {
    const planeAssetId = `${side}/mathematical-v1/detector-planes/${planeName}.tkplane`;
    let fileBytes: Buffer;
    try {
      fileBytes = planeName === "expectedOuterCardMask"
        ? expectedOuterCardMaskBytes
        : encodeFixedRigCalibratedDetectorPlaneV1({
        header: {
          schemaVersion: FIXED_RIG_CALIBRATED_DETECTOR_PLANE_V1_VERSION,
          assetId: planeAssetId,
          side,
          planeName,
          coordinateFrame: "normalized_card_portrait_pixels",
          width: profile.normalizedWidthPx,
          height: profile.normalizedHeightPx,
          dataType: "float32le",
          detector: {
            id: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.conditionPlaneProducer.producerId,
            version: produced.version,
          },
          calibration: {
            profileId: profile.profileId,
            version: profile.calibrationVersion,
            sha256: profile.artifactSha256.toLowerCase(),
          },
          derivation: "fused_calibrated_detector",
          sourceEvidence: produced.sourceEvidence,
          heatmapUsedAsInput: false,
          manualOverrideUsed: false,
        },
        plane: produced.planes[planeName],
        });
    } catch (error) {
      return fail("detector_plane_ingestion", `${side} computed detector plane ${planeName} could not be checksum-bound: ${safeMessage(error)}.`, {
        requiresImplementationCorrection: true,
      });
    }
    const planeSha256 = sha256(fileBytes);
    detectorPlaneSha256s[planeName] = planeSha256;
    const planeReference: EvidenceReferenceV1 = {
      assetId: planeAssetId,
      sha256: planeSha256,
      side,
      role: "segmentation_mask",
      regionId: `${side}-full-card`,
    };
    planeReferences.push(planeReference);
    planeReferenceByName.set(planeName, planeReference);
    assetBindings.push({
      id: planeAssetId,
      side,
      evidenceRole: "segmentation_mask",
      fileName: `${side}-${planeName}.tkplane`,
      contentType: "application/vnd.tenkings.calibrated-detector-plane-v1",
      bytes: fileBytes,
      sha256: planeSha256,
      byteSize: fileBytes.byteLength,
      widthPx: profile.normalizedWidthPx,
      heightPx: profile.normalizedHeightPx,
    });
  }
  const sourceEvidence = [...produced.sourceEvidence, ...planeReferences];
  const condition = buildFixedRigConditionSegmentationV1({
    side,
    cardIdentity: {
      tenantId: input.cardIdentity.tenantId,
      setId: input.cardIdentity.setId,
      programId: input.cardIdentity.programId,
      cardNumber: input.cardIdentity.cardNumber,
      variantId: input.cardIdentity.variantId,
      parallelId: input.cardIdentity.parallelId,
    },
    designReference: sideInput.designReference,
    designRegistration: sideInput.designRegistration,
    photometricEvidence: photometric,
    measurementCalibration: sideInput.measurementCalibration,
    algorithmVersion: sideInput.algorithmVersion,
    sourceEvidence,
    planes,
    unavailableModalities: produced.unavailableModalities,
  });
  if (condition.status !== "computed") {
    return fail("condition_segmentation", `${side} condition evidence is insufficient: ${condition.reasons.join("; ")}`, {
      requiresRecapture: true,
      requiresApprovedDesignReference: condition.reasons.some((reason) => /design|reference|registration/i.test(reason)),
    });
  }
  const recaptureConditionLimitation = condition.evidenceQualityLimitations.find(
    (limitation) => limitation.requiresRecapture,
  );
  if (recaptureConditionLimitation) {
    return fail(
      "condition_segmentation",
      side + " condition evidence remains ungradable: " +
        recaptureConditionLimitation.message,
      { requiresRecapture: true },
    );
  }
  if (sideInput.centering.profileInput.profile === "registered_design_template_v1" &&
      sideInput.designReference &&
      (sideInput.centering.profileInput.designReference.artifactSha256.toLowerCase() !==
        sideInput.designReference.artifactSha256.toLowerCase() ||
       sideInput.centering.profileInput.designReference.designReferenceId !==
        sideInput.designReference.designReferenceId)) {
    return fail("centering", `${side} centering registration does not use the exact approved condition-design artifact.`, {
      requiresApprovedDesignReference: true,
    });
  }
  const centeringEvidence = [
    allOnReference,
    normalizedReference,
    ...(designReference ? [designReference] : []),
    planeReferenceByName.get("expectedOuterCardMask")!,
  ];
  const centering = sideInput.centering.profileInput.profile === "printed_border_v1"
    ? buildFixedRigPrintedBorderCenteringSideV1({
        side,
        calibration: profile,
        outerCutContour: produced.outerCutGeometryEvidence.observedArtifact.normalizedContour,
        flatFieldNormalizedAllOnLuminance: rgbLuminancePlaneV1(allOnRgb),
        evidence: centeringEvidence,
      }).centering
    : buildFixedRigCenteringSideV1({
        side,
        calibration: profile,
        outerCutContour: produced.outerCutGeometryEvidence.observedArtifact.normalizedContour,
        profileInput: sideInput.centering.profileInput,
        evidence: centeringEvidence,
      });
  if (centering.status !== "computed") {
    return fail("centering", `${side} centering evidence is insufficient: ${centering.reasons.join("; ")}`, {
      requiresRecapture: true,
      requiresApprovedDesignReference: true,
    });
  }
  const surface = buildFixedRigSurfaceV1({
    side,
    photometricEvidence: photometric,
    calibration: sideInput.measurementCalibration,
    algorithmVersion: sideInput.algorithmVersion,
    candidateSeeds: condition.surfaceCandidateSeeds,
    depthMm: condition.surfaceDepthMm,
    reliefIndex: condition.surfaceReliefIndex,
  });
  if (surface.status !== "computed") {
    return fail("surface_measurement", `${side} surface evidence is insufficient and requires recapture.`, {
      requiresRecapture: true,
    });
  }
  const visualizationAssetIds = {
    commonModeResponse: `${side}/mathematical-v1/replay/common-mode-response.png`,
    invalidIlluminationMask:
      `${side}/mathematical-v1/replay/invalid-illumination-mask.png`,
    confidenceMask: `${side}/mathematical-v1/replay/confidence-mask.png`,
    heatmap: `${side}/mathematical-v1/replay/surface-heatmap.png`,
    surfaceVision: `${side}/mathematical-v1/replay/surface-vision.png`,
  };
  const invalidIlluminationPixels: number[] = [];
  for (let index = 0; index < photometric.invalidIlluminationMask.length; index += 1) {
    if (photometric.invalidIlluminationMask[index]) invalidIlluminationPixels.push(index);
  }
  const [
    commonModeResponseBytes,
    invalidIlluminationMaskBytes,
    confidenceMaskBytes,
    heatmapBytes,
    surfaceVisionBytes,
  ] = await Promise.all([
    scalarResponsePngV1({
      width: photometric.width,
      height: photometric.height,
      data: photometric.commonModeResponse,
      palette: "grayscale",
    }),
    maskPngV1(photometric.width, photometric.height, invalidIlluminationPixels),
    scalarMaskPngV1(condition.conditionValidEvidenceMask),
    scalarResponsePngV1({
      width: photometric.width,
      height: photometric.height,
      data: surface.heatmap.response,
      palette: "heatmap",
    }),
    scalarResponsePngV1({
      width: photometric.width,
      height: photometric.height,
      data: directionalResidualMagnitudeV1(photometric),
      palette: "surface_vision",
    }),
  ]);
  const visualizationBindings: Array<{
    id: string;
    evidenceRole:
      | "common_mode_response"
      | "illumination_mask"
      | "confidence_mask"
      | "surface_heatmap"
      | "surface_vision";
    bytes: Buffer;
  }> = [
    {
      id: visualizationAssetIds.commonModeResponse,
      evidenceRole: "common_mode_response",
      bytes: commonModeResponseBytes,
    },
    {
      id: visualizationAssetIds.invalidIlluminationMask,
      evidenceRole: "illumination_mask",
      bytes: invalidIlluminationMaskBytes,
    },
    {
      id: visualizationAssetIds.confidenceMask,
      evidenceRole: "confidence_mask",
      bytes: confidenceMaskBytes,
    },
    {
      id: visualizationAssetIds.heatmap,
      evidenceRole: "surface_heatmap",
      bytes: heatmapBytes,
    },
    {
      id: visualizationAssetIds.surfaceVision,
      evidenceRole: "surface_vision",
      bytes: surfaceVisionBytes,
    },
  ];
  assetBindings.push(...visualizationBindings.map((binding) => ({
    id: binding.id,
    side,
    evidenceRole: binding.evidenceRole,
    fileName: binding.id.split("/").pop()!,
    contentType: "image/png",
    bytes: binding.bytes,
    sha256: sha256(binding.bytes),
    byteSize: binding.bytes.byteLength,
    widthPx: photometric.width,
    heightPx: photometric.height,
  })));
  return {
    side,
    input: sideInput,
    normalizedBytes,
    normalizedReference,
    channelAssetIds: sortedChannels.map((channel) => channel.assetId),
    detectorPlaneSha256s,
    assetBindings,
    photometric,
    condition,
    outerCutGeometryEvidence: produced.outerCutGeometryEvidence,
    centering,
    surface: surface as ComputedSurfaceV1,
    visualizationAssetIds,
  };
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function conditionFindingSource(
  findingId: string,
  element: "corners" | "edges",
  observations: FixedRigConditionObservationResultV1[],
): { finding: FixedRigPhysicalFindingV1; location: string } | undefined {
  for (const observation of observations) {
    if (observation.status !== "computed" || observation.element !== element) continue;
    const finding = observation.findings.find((entry) => entry.finding.findingId === findingId);
    if (finding) return { finding, location: observation.location };
  }
  return undefined;
}

function roiOrigin(input: {
  element: "corners" | "edges";
  location: string;
  width: number;
  height: number;
  calibration: FixedRigConditionMeasurementCalibrationV1;
}): { x: number; y: number; width: number; height: number } {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.conditionSegmentation.regionGeometry;
  const cornerWidth = Math.ceil(policy.cornerRoiSizeMm * input.calibration.pixelsPerMmX);
  const cornerHeight = Math.ceil(policy.cornerRoiSizeMm * input.calibration.pixelsPerMmY);
  if (input.element === "corners") {
    if (input.location === "top_left") return { x: 0, y: 0, width: cornerWidth, height: cornerHeight };
    if (input.location === "top_right") {
      return { x: input.width - cornerWidth, y: 0, width: cornerWidth, height: cornerHeight };
    }
    if (input.location === "bottom_right") {
      return {
        x: input.width - cornerWidth,
        y: input.height - cornerHeight,
        width: cornerWidth,
        height: cornerHeight,
      };
    }
    return { x: 0, y: input.height - cornerHeight, width: cornerWidth, height: cornerHeight };
  }
  const edgeDepthX = Math.ceil(policy.edgeRoiDepthMm * input.calibration.pixelsPerMmX);
  const edgeDepthY = Math.ceil(policy.edgeRoiDepthMm * input.calibration.pixelsPerMmY);
  const edgeEndX = Math.ceil(policy.edgeEndExclusionMm * input.calibration.pixelsPerMmX);
  const edgeEndY = Math.ceil(policy.edgeEndExclusionMm * input.calibration.pixelsPerMmY);
  if (input.location === "top") {
    return { x: edgeEndX, y: 0, width: input.width - 2 * edgeEndX, height: edgeDepthY };
  }
  if (input.location === "right") {
    return {
      x: input.width - edgeDepthX,
      y: edgeEndY,
      width: edgeDepthX,
      height: input.height - 2 * edgeEndY,
    };
  }
  if (input.location === "bottom") {
    return {
      x: edgeEndX,
      y: input.height - edgeDepthY,
      width: input.width - 2 * edgeEndX,
      height: edgeDepthY,
    };
  }
  return { x: 0, y: edgeEndY, width: edgeDepthX, height: input.height - 2 * edgeEndY };
}

function reportGeometryForFinding(input: {
  finding: FinalGradeV1["findings"][number];
  side: IngestedSideV1;
  cornerObservations: FixedRigConditionObservationResultV1[];
  edgeObservations: FixedRigConditionObservationResultV1[];
}): {
  box: { x: number; y: number; width: number; height: number };
  pixelIndices: number[];
  detectorId: string;
  detectorVersion: string;
  secondaryEvidenceCategories: string[];
} {
  const width = input.side.condition.width;
  const height = input.side.condition.height;
  if (input.finding.source === "surface") {
    const source = input.side.surface.findings.find((entry) => entry.findingId === input.finding.findingId);
    if (!source || !source.detectorIds[0] || !source.detectorVersions[0]) {
      return fail("report_adaptation", `Surface finding ${input.finding.findingId} has no measured source.`, {
        requiresImplementationCorrection: true,
      });
    }
    return {
      box: { ...source.overlay.boundingBoxPx },
      pixelIndices: uniqueNumbers([...source.overlay.validPixelIndices, ...source.overlay.invalidPixelIndices]),
      detectorId: source.detectorIds[0],
      detectorVersion: source.detectorVersions[0],
      secondaryEvidenceCategories: [...source.secondaryEvidenceCategories],
    };
  }
  const element = input.finding.element as "corners" | "edges";
  const observations = element === "corners" ? input.cornerObservations : input.edgeObservations;
  const source = conditionFindingSource(input.finding.findingId, element, observations);
  if (!source) {
    return fail("report_adaptation", `Condition finding ${input.finding.findingId} has no measured source.`, {
      requiresImplementationCorrection: true,
    });
  }
  const origin = roiOrigin({
    element,
    location: source.location,
    width,
    height,
    calibration: input.side.input.measurementCalibration,
  });
  const box = {
    x: origin.x + source.finding.boundingBoxPx.x,
    y: origin.y + source.finding.boundingBoxPx.y,
    width: source.finding.boundingBoxPx.width,
    height: source.finding.boundingBoxPx.height,
  };
  const pixelIndices = source.finding.pixelIndices.map((index) => {
    const localX = index % origin.width;
    const localY = Math.floor(index / origin.width);
    return (origin.y + localY) * width + origin.x + localX;
  });
  return {
    box,
    pixelIndices,
    detectorId: source.finding.finding.detectorId,
    detectorVersion: source.finding.finding.detectorVersion,
    secondaryEvidenceCategories: [...source.finding.secondaryCategoryEvidence],
  };
}

function findingReviewRequestV1(input: {
  gradingSessionId: string;
  reportId: string;
  generatedAt: string;
  profile: MathematicalCalibrationProfileV1;
  grade: FinalGradeV1;
  sides: Record<Side, IngestedSideV1>;
  cornerObservations: FixedRigConditionObservationResultV1[];
  edgeObservations: FixedRigConditionObservationResultV1[];
  preparedPresentations: PreparedFindingPresentationV1[];
  assetBindings: AiGraderMathematicalReportAssetBindingV1[];
}): FixedRigMathematicalFindingReviewRequestV1 {
  const findings = input.grade.findings.map((finding) => {
    const side = input.sides[finding.side];
    const source = reportGeometryForFinding({
      finding,
      side,
      cornerObservations: input.cornerObservations,
      edgeObservations: input.edgeObservations,
    });
    const width = side.condition.width;
    const height = side.condition.height;
    const presentation = input.preparedPresentations.find((entry) =>
      entry.findingId.toLowerCase() === finding.findingId.toLowerCase());
    if (!presentation || presentation.roiAssetIds.length !== 1) {
      return fail("report_adaptation", `Finding ${finding.findingId} review evidence was not prepared exactly once.`, {
        requiresImplementationCorrection: true,
      });
    }
    const asset = (assetId: string) => {
      const binding = input.assetBindings.find((entry) =>
        entry.id.toLowerCase() === assetId.toLowerCase());
      if (!binding) {
        return fail("report_adaptation", `Finding ${finding.findingId} review asset ${assetId} is missing.`, {
          requiresImplementationCorrection: true,
        });
      }
      return immutableReviewAssetV1(binding);
    };
    const trueView = asset(presentation.trueViewAssetId);
    const directionalChannels = presentation.channelAssetIds.map(asset);
    const reviewEvidence = {
      roi: asset(presentation.roiAssetIds[0]!),
      segmentationMask: asset(presentation.segmentationMaskAssetId),
      confidenceMask: asset(presentation.confidenceMaskAssetId),
      illuminationMask: asset(presentation.illuminationMaskAssetId),
    };
    return {
      findingId: finding.findingId,
      physicalDefectId: finding.physicalDefectId,
      element: finding.element,
      category: finding.category,
      side: finding.side,
      location: finding.location,
      regionId: finding.regionId,
      geometry: {
        coordinateFrame: "normalized_card" as const,
        kind: "box" as const,
        x: source.box.x / width,
        y: source.box.y / height,
        width: source.box.width / width,
        height: source.box.height / height,
      },
      detector: { id: source.detectorId, version: source.detectorVersion },
      measuredDeduction: finding.deduction,
      measurements: finding.measurements.map((measurement) => ({ ...measurement })),
      evidenceAssetIds: unique([
        ...finding.evidenceAssetIds,
        ...finding.measurements.flatMap((measurement) =>
          measurement.evidence.map((reference) => reference.assetId)),
        reviewEvidence.roi.assetId,
        reviewEvidence.segmentationMask.assetId,
        reviewEvidence.confidenceMask.assetId,
        reviewEvidence.illuminationMask.assetId,
      ]),
      trueView: reviewAssetMetadataV1(trueView),
      directionalChannels: directionalChannels.map(reviewAssetMetadataV1),
      reviewEvidence: {
        roi: reviewAssetMetadataV1(reviewEvidence.roi),
        segmentationMask: reviewAssetMetadataV1(reviewEvidence.segmentationMask),
        confidenceMask: reviewAssetMetadataV1(reviewEvidence.confidenceMask),
        illuminationMask: reviewAssetMetadataV1(reviewEvidence.illuminationMask),
      },
      explanation: finding.explanation,
    };
  });
  const payload = {
    schemaVersion: FIXED_RIG_MATHEMATICAL_FINDING_REVIEW_REQUEST_V1_VERSION,
    gradingContract: "mathematical_calibration_v1" as const,
    gradingSessionId: input.gradingSessionId,
    reportId: input.reportId,
    generatedAt: input.generatedAt,
    calibration: {
      profileId: input.profile.profileId,
      calibrationVersion: input.profile.calibrationVersion,
      artifactSha256: input.profile.artifactSha256,
    },
    findings,
    hashPolicy:
      "sha256-canonical-json-with-artifactSha256-omitted" as const,
  };
  return {
    ...payload,
    artifactSha256: sha256(canonicalJsonBytes(payload)),
  };
}

function findingReviewIssuesV1(input: {
  request: FixedRigMathematicalFindingReviewRequestV1;
  reviews: readonly FixedRigMathematicalFindingReviewV1[];
}): string[] {
  const issues: string[] = [];
  const expected = new Set(
    input.request.findings.map((finding) => finding.findingId.toLowerCase()),
  );
  const seen = new Set<string>();
  for (const review of input.reviews) {
    if ("confidence" in (review as unknown as Record<string, unknown>)) {
      issues.push("Review " + review.findingId + " must not author confidence; finding confidence is derived from immutable evidence.");
    }
    const key = review.findingId.toLowerCase();
    if (seen.has(key)) issues.push("Duplicate review for " + review.findingId + ".");
    seen.add(key);
    if (!expected.has(key)) {
      issues.push("Review " + review.findingId + " is not part of this measured finding request.");
    }
    if (review.reviewRequestSha256 !== input.request.artifactSha256) {
      issues.push("Review " + review.findingId + " is not bound to the exact finding-review request SHA-256.");
    }
    if (review.status !== "confirmed" && review.status !== "adjusted") {
      issues.push("Review " + review.findingId + " status must be confirmed or adjusted.");
    }
    if (
      typeof review.reviewedAt !== "string" ||
      !Number.isFinite(new Date(review.reviewedAt).getTime())
    ) issues.push("Review " + review.findingId + " requires an exact review timestamp.");
  }
  for (const finding of input.request.findings) {
    if (!seen.has(finding.findingId.toLowerCase())) {
      issues.push("Finding " + finding.findingId + " requires explicit human review.");
    }
  }
  return [...new Set(issues)];
}

function rgbLuminancePlaneV1(rgb: FixedRigRgbPlaneV1): FixedRigScalarPlaneV1 {
  const data = new Float32Array(rgb.width * rgb.height);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.max(0, Math.min(
      1,
      0.2126 * Number(rgb.data[index * 3]) +
        0.7152 * Number(rgb.data[index * 3 + 1]) +
        0.0722 * Number(rgb.data[index * 3 + 2]),
    ));
  }
  return { width: rgb.width, height: rgb.height, data };
}

async function maskPngV1(width: number, height: number, pixels: readonly number[]): Promise<Buffer> {
  const raw = Buffer.alloc(width * height);
  for (const index of pixels) {
    if (Number.isInteger(index) && index >= 0 && index < raw.length) raw[index] = 255;
  }
  return sharp(raw, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function scalarMaskPngV1(plane: FixedRigScalarPlaneV1): Promise<Buffer> {
  const raw = Buffer.alloc(plane.width * plane.height);
  for (let index = 0; index < raw.length; index += 1) {
    raw[index] = Number(plane.data[index]) > 0 ? 255 : 0;
  }
  return sharp(raw, { raw: { width: plane.width, height: plane.height, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function scalarResponsePngV1(input: {
  width: number;
  height: number;
  data: ArrayLike<number>;
  palette: "grayscale" | "heatmap" | "surface_vision";
}): Promise<Buffer> {
  let maximum = input.palette === "grayscale" ? 1 : 0;
  if (input.palette !== "grayscale") {
    for (let index = 0; index < input.data.length; index += 1) {
      maximum = Math.max(maximum, Math.abs(Number(input.data[index])));
    }
    maximum = Math.max(maximum, Number.EPSILON);
  }
  const raw = Buffer.alloc(input.width * input.height * 3);
  for (let index = 0; index < input.width * input.height; index += 1) {
    const normalized = Math.max(
      0,
      Math.min(1, Math.abs(Number(input.data[index])) / maximum),
    );
    let red: number;
    let green: number;
    let blue: number;
    if (input.palette === "grayscale") {
      red = green = blue = Math.round(normalized * 255);
    } else if (input.palette === "surface_vision") {
      red = Math.round(255 * normalized);
      green = Math.round(255 * Math.sqrt(normalized));
      blue = Math.round(255 * (1 - normalized));
    } else {
      red = Math.round(255 * Math.max(0, Math.min(1, 2 * normalized - 0.5)));
      green = Math.round(255 * Math.max(0, 1 - Math.abs(2 * normalized - 1)));
      blue = Math.round(255 * Math.max(0, Math.min(1, 1.5 - 2 * normalized)));
    }
    raw[index * 3] = red;
    raw[index * 3 + 1] = green;
    raw[index * 3 + 2] = blue;
  }
  return sharp(raw, { raw: { width: input.width, height: input.height, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

function directionalResidualMagnitudeV1(
  photometric: FixedRigPhotometricEvidenceV1,
): Float32Array {
  const response = new Float32Array(photometric.width * photometric.height);
  for (const channel of photometric.channels) {
    for (let index = 0; index < response.length; index += 1) {
      if (!channel.validDirectionalObservationMask[index]) continue;
      response[index] = Math.max(
        response[index]!,
        Math.abs(Number(channel.directionalResidual[index])),
      );
    }
  }
  return response;
}

function evidenceDerivedFindingConfidenceV1(
  finding: FinalGradeV1["findings"][number],
): number {
  const requiredChannelCount =
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount;
  const confidence = Math.min(...finding.measurements.map((measurement) => Math.min(
    measurement.validEvidenceCoverage,
    measurement.usableDirectionalChannelCount / requiredChannelCount,
  )));
  return Math.round(Math.max(0, Math.min(1, confidence)) * 1_000_000) / 1_000_000;
}

type PreparedFindingPresentationV1 = Omit<AiGraderMathematicalFindingPresentationV1, "review">;

async function buildPreparedFindingPresentationsV1(input: {
  captureProfileVersion: string;
  grade: FinalGradeV1;
  sides: Record<Side, IngestedSideV1>;
  cornerObservations: FixedRigConditionObservationResultV1[];
  edgeObservations: FixedRigConditionObservationResultV1[];
  assetBindings: AiGraderMathematicalReportAssetBindingV1[];
}): Promise<PreparedFindingPresentationV1[]> {
  const presentations: PreparedFindingPresentationV1[] = [];
  for (const finding of input.grade.findings) {
    const side = input.sides[finding.side];
    const source = reportGeometryForFinding({
      finding,
      side,
      cornerObservations: input.cornerObservations,
      edgeObservations: input.edgeObservations,
    });
    const width = side.condition.width;
    const height = side.condition.height;
    if (!Number.isInteger(source.box.x) || !Number.isInteger(source.box.y) ||
        !Number.isInteger(source.box.width) || !Number.isInteger(source.box.height) ||
        source.box.width <= 0 || source.box.height <= 0 || source.box.x < 0 || source.box.y < 0 ||
        source.box.x + source.box.width > width || source.box.y + source.box.height > height) {
      return fail("report_adaptation", `Finding ${finding.findingId} produced an invalid measured ROI.`, {
        requiresImplementationCorrection: true,
      });
    }
    const segmentationBytes = await maskPngV1(width, height, source.pixelIndices);
    const confidenceBytes = await scalarMaskPngV1(side.condition.conditionValidEvidenceMask);
    const illuminationPixels: number[] = [];
    for (let index = 0; index < side.photometric.invalidIlluminationMask.length; index += 1) {
      if (side.photometric.invalidIlluminationMask[index]) illuminationPixels.push(index);
    }
    const illuminationBytes = await maskPngV1(width, height, illuminationPixels);
    const baseId = `${finding.side}/mathematical-v1/findings/${finding.findingId}`;
    const segmentationMaskAssetId = `${baseId}/segmentation-mask.png`;
    const confidenceMaskAssetId = `${baseId}/confidence-mask.png`;
    const illuminationMaskAssetId = `${baseId}/illumination-mask.png`;
    const roiAssetId = `${baseId}/roi.png`;
    let roiBytes: Buffer;
    try {
      roiBytes = await sharp(side.normalizedBytes, { failOn: "error" })
        .extract({
          left: source.box.x,
          top: source.box.y,
          width: source.box.width,
          height: source.box.height,
        })
        .png({ compressionLevel: 9 })
        .toBuffer();
    } catch {
      return fail("report_adaptation", `Finding ${finding.findingId} ROI cannot be reproduced from its exact normalized source.`, {
        requiresImplementationCorrection: true,
      });
    }
    input.assetBindings.push(
      {
        id: segmentationMaskAssetId,
        side: finding.side,
        evidenceRole: "segmentation_mask",
        fileName: `${finding.findingId}-segmentation-mask.png`,
        contentType: "image/png",
        bytes: segmentationBytes,
        sha256: sha256(segmentationBytes),
        byteSize: segmentationBytes.byteLength,
        widthPx: width,
        heightPx: height,
      },
      {
        id: confidenceMaskAssetId,
        side: finding.side,
        evidenceRole: "confidence_mask",
        fileName: `${finding.findingId}-confidence-mask.png`,
        contentType: "image/png",
        bytes: confidenceBytes,
        sha256: sha256(confidenceBytes),
        byteSize: confidenceBytes.byteLength,
        widthPx: width,
        heightPx: height,
      },
      {
        id: illuminationMaskAssetId,
        side: finding.side,
        evidenceRole: "illumination_mask",
        fileName: `${finding.findingId}-illumination-mask.png`,
        contentType: "image/png",
        bytes: illuminationBytes,
        sha256: sha256(illuminationBytes),
        byteSize: illuminationBytes.byteLength,
        widthPx: width,
        heightPx: height,
      },
      {
        id: roiAssetId,
        side: finding.side,
        evidenceRole: "roi_crop",
        fileName: `${finding.findingId}-roi.png`,
        contentType: "image/png",
        bytes: roiBytes,
        sha256: sha256(roiBytes),
        byteSize: roiBytes.byteLength,
        widthPx: source.box.width,
        heightPx: source.box.height,
      },
    );
    const fixedEvidence = new Set([
      side.input.normalizedCard.assetId,
      ...side.channelAssetIds,
    ].map((assetId) => assetId.toLowerCase()));
    const additionalEvidenceAssetIds = unique(
      finding.measurements.flatMap((measurement) =>
        measurement.evidence.map((reference) => reference.assetId)),
    ).filter((assetId) => !fixedEvidence.has(assetId.toLowerCase()));
    presentations.push({
      findingId: finding.findingId,
      geometry: {
        kind: "box",
        x: source.box.x / width,
        y: source.box.y / height,
        width: source.box.width / width,
        height: source.box.height / height,
      },
      detector: {
        id: source.detectorId,
        version: source.detectorVersion,
        captureProfileVersion: input.captureProfileVersion,
      },
      confidence: evidenceDerivedFindingConfidenceV1(finding),
      evidenceQuality: "sufficient",
      trueViewAssetId: side.input.normalizedCard.assetId,
      segmentationMaskAssetId,
      confidenceMaskAssetId,
      illuminationMaskAssetId,
      heatmapAssetId: side.visualizationAssetIds.heatmap,
      surfaceVisionAssetId: side.visualizationAssetIds.surfaceVision,
      channelAssetIds: [...side.channelAssetIds],
      roiAssetIds: [roiAssetId],
      additionalEvidenceAssetIds,
      secondaryEvidenceCategories: source.secondaryEvidenceCategories,
    });
  }
  return presentations;
}

function immutableReviewAssetV1(
  binding: AiGraderMathematicalReportAssetBindingV1,
): FixedRigMathematicalFindingReviewAssetV1 {
  const allowedRoles = new Set([
    "roi_crop",
    "segmentation_mask",
    "confidence_mask",
    "illumination_mask",
    "normalized_card",
    "directional_channel",
  ]);
  if (!binding.bytes || !binding.widthPx || !binding.heightPx ||
      !allowedRoles.has(binding.evidenceRole)) {
    return fail("report_adaptation", `Review asset ${binding.id} lacks exact raster bytes, dimensions, or role.`, {
      requiresImplementationCorrection: true,
    });
  }
  const observedSha256 = sha256(binding.bytes);
  if (binding.sha256 && binding.sha256.toLowerCase() !== observedSha256) {
    return fail("report_adaptation", `Review asset ${binding.id} immutable SHA-256 mismatch.`, {
      requiresImplementationCorrection: true,
    });
  }
  return {
    assetId: binding.id,
    evidenceRole: binding.evidenceRole as FixedRigMathematicalFindingReviewAssetMetadataV1["evidenceRole"],
    sha256: observedSha256,
    fileName: binding.fileName,
    contentType: binding.contentType,
    byteSize: binding.bytes.byteLength,
    widthPx: binding.widthPx,
    heightPx: binding.heightPx,
    bytes: Buffer.from(binding.bytes),
  };
}

function reviewAssetMetadataV1(
  asset: FixedRigMathematicalFindingReviewAssetV1,
): FixedRigMathematicalFindingReviewAssetMetadataV1 {
  const { bytes: _bytes, ...metadata } = asset;
  return metadata;
}

function finalizeFindingPresentationsV1(input: {
  prepared: PreparedFindingPresentationV1[];
  reviews: FixedRigMathematicalFindingReviewV1[];
  reviewRequestSha256: string;
}): AiGraderMathematicalFindingPresentationV1[] {
  const reviews = new Map<string, FixedRigMathematicalFindingReviewV1>();
  for (const review of input.reviews) {
    const key = review.findingId.toLowerCase();
    if (reviews.has(key)) {
      return fail("finding_review", `Duplicate finding review ${review.findingId}.`, {
        requiresImplementationCorrection: true,
      });
    }
    reviews.set(key, review);
  }
  return input.prepared.map((presentation) => {
    const review = reviews.get(presentation.findingId.toLowerCase());
    if (!review || review.reviewRequestSha256 !== input.reviewRequestSha256 ||
        !Number.isFinite(new Date(review.reviewedAt).getTime())) {
      return fail("finding_review", `Finding ${presentation.findingId} has no valid explicit review disposition.`, {
        requiresImplementationCorrection: true,
      });
    }
    return {
      ...presentation,
      review: { status: review.status, reviewedAt: review.reviewedAt },
    };
  });
}

async function buildConditionObservationPresentationsV1(input: {
  grade: FinalGradeV1;
  sides: Record<Side, IngestedSideV1>;
  cornerObservations: FixedRigConditionObservationResultV1[];
  edgeObservations: FixedRigConditionObservationResultV1[];
  assetBindings: AiGraderMathematicalReportAssetBindingV1[];
}): Promise<AiGraderMathematicalConditionObservationPresentationV1[]> {
  const results: AiGraderMathematicalConditionObservationPresentationV1[] = [];
  for (const element of ["corners", "edges"] as const) {
    const observations =
      element === "corners" ? input.cornerObservations : input.edgeObservations;
    for (const observation of observations) {
      if (observation.status !== "computed" || observation.element !== element) {
        return fail(
          "report_adaptation",
          `Every ${element} observation must be computed before report evidence is emitted.`,
          { requiresRecapture: true },
        );
      }
      const side = input.sides[observation.side];
      const origin = roiOrigin({
        element,
        location: observation.location,
        width: side.condition.width,
        height: side.condition.height,
        calibration: side.input.measurementCalibration,
      });
      if (
        origin.x < 0 ||
        origin.y < 0 ||
        origin.width <= 0 ||
        origin.height <= 0 ||
        origin.x + origin.width > side.condition.width ||
        origin.y + origin.height > side.condition.height
      ) {
        return fail(
          "report_adaptation",
          `${observation.side} ${element} ${observation.location} has an invalid calibrated ROI.`,
          { requiresImplementationCorrection: true },
        );
      }
      const segmentationPixels = uniqueNumbers(
        observation.findings.flatMap((finding) => finding.pixelIndices),
      );
      const localConfidence = new Float32Array(origin.width * origin.height);
      const localIlluminationPixels: number[] = [];
      for (let localY = 0; localY < origin.height; localY += 1) {
        for (let localX = 0; localX < origin.width; localX += 1) {
          const localIndex = localY * origin.width + localX;
          const fullIndex =
            (origin.y + localY) * side.condition.width + origin.x + localX;
          localConfidence[localIndex] = Number(
            side.condition.conditionValidEvidenceMask.data[fullIndex],
          );
          if (side.photometric.invalidIlluminationMask[fullIndex]) {
            localIlluminationPixels.push(localIndex);
          }
        }
      }
      const baseId =
        `${observation.side}/mathematical-v1/observations/${element}/${observation.location}`;
      const roiAssetId = `${baseId}/roi.png`;
      const segmentationMaskAssetId = `${baseId}/segmentation-mask.png`;
      const confidenceMaskAssetId = `${baseId}/confidence-mask.png`;
      const illuminationMaskAssetId = `${baseId}/illumination-mask.png`;
      let roiBytes: Buffer;
      try {
        roiBytes = await sharp(side.normalizedBytes, { failOn: "error" })
          .extract({
            left: origin.x,
            top: origin.y,
            width: origin.width,
            height: origin.height,
          })
          .png({ compressionLevel: 9, adaptiveFiltering: false })
          .toBuffer();
      } catch {
        return fail(
          "report_adaptation",
          `${observation.side} ${element} ${observation.location} ROI cannot be reproduced.`,
          { requiresImplementationCorrection: true },
        );
      }
      const [segmentationBytes, confidenceBytes, illuminationBytes] =
        await Promise.all([
          maskPngV1(origin.width, origin.height, segmentationPixels),
          scalarMaskPngV1({
            width: origin.width,
            height: origin.height,
            data: localConfidence,
          }),
          maskPngV1(origin.width, origin.height, localIlluminationPixels),
        ]);
      input.assetBindings.push(
        {
          id: roiAssetId,
          side: observation.side,
          evidenceRole: "roi_crop",
          fileName:
            `${observation.side}-${element}-${observation.location}-roi.png`,
          contentType: "image/png",
          bytes: roiBytes,
          widthPx: origin.width,
          heightPx: origin.height,
        },
        {
          id: segmentationMaskAssetId,
          side: observation.side,
          evidenceRole: "segmentation_mask",
          fileName:
            `${observation.side}-${element}-${observation.location}-segmentation.png`,
          contentType: "image/png",
          bytes: segmentationBytes,
          widthPx: origin.width,
          heightPx: origin.height,
        },
        {
          id: confidenceMaskAssetId,
          side: observation.side,
          evidenceRole: "confidence_mask",
          fileName:
            `${observation.side}-${element}-${observation.location}-confidence.png`,
          contentType: "image/png",
          bytes: confidenceBytes,
          widthPx: origin.width,
          heightPx: origin.height,
        },
        {
          id: illuminationMaskAssetId,
          side: observation.side,
          evidenceRole: "illumination_mask",
          fileName:
            `${observation.side}-${element}-${observation.location}-illumination.png`,
          contentType: "image/png",
          bytes: illuminationBytes,
          widthPx: origin.width,
          heightPx: origin.height,
        },
      );
      const location = input.grade.elements[element].locationScores.find((entry) =>
        entry.side === observation.side && entry.location === observation.location
      );
      if (!location) {
        return fail(
          "report_adaptation",
          `${observation.side} ${element} ${observation.location} has no final location score.`,
          { requiresImplementationCorrection: true },
        );
      }
      const retainedFindings = input.grade.findings.filter((finding) =>
        finding.element === element &&
        finding.side === observation.side &&
        finding.location === observation.location
      );
      results.push({
        element,
        side: observation.side,
        location: observation.location,
        regionId: observation.regionId,
        score: location.score,
        penalty: location.penalty,
        validEvidenceCoverage: observation.validEvidenceCoverage,
        usableDirectionalChannelCount: observation.usableDirectionalChannelCount,
        findingIds: [...location.findingIds],
        measurementIds: unique(
          retainedFindings.flatMap((finding) =>
            finding.measurements.map((measurement) => measurement.measurementId),
          ),
        ),
        roiAssetId,
        segmentationMaskAssetId,
        confidenceMaskAssetId,
        illuminationMaskAssetId,
        channelAssetIds: [...side.channelAssetIds],
      });
    }
  }
  return results;
}

function maskFractionV1(mask: ArrayLike<number>, gradeRelevantMask: ArrayLike<number>): number {
  let denominator = 0;
  let numerator = 0;
  for (let index = 0; index < gradeRelevantMask.length; index += 1) {
    if (!gradeRelevantMask[index]) continue;
    denominator += 1;
    if (mask[index]) numerator += 1;
  }
  return denominator ? Math.round((numerator / denominator) * 1_000_000) / 1_000_000 : 0;
}

function deriveEvidenceQualityLimitationsV1(
  sides: Record<Side, IngestedSideV1>,
): AiGraderMathematicalEvidenceQualityLimitationV1[] {
  const limitations: AiGraderMathematicalEvidenceQualityLimitationV1[] = [];
  for (const sideName of ["front", "back"] as const) {
    const side = sides[sideName];
    const baseEvidence = [
      side.visualizationAssetIds.invalidIlluminationMask,
      side.visualizationAssetIds.confidenceMask,
    ];
    const excludedConditionEvidence =
      side.condition.evidenceQualityLimitations.find(
        (limitation) =>
          limitation.code === "invalid_condition_evidence_excluded",
      );
    if (excludedConditionEvidence) {
      limitations.push({
        limitationId:
          sideName + "-full-card-condition-evidence-excluded",
        side: sideName,
        regionId: sideName + "-full-card",
        classification: "low_confidence",
        validEvidenceCoverage: side.condition.validEvidenceCoverage,
        excludedPixelFraction:
          excludedConditionEvidence.affectedPixelFraction,
        recoveredFromAlternateChannels: false,
        recaptureRequired: excludedConditionEvidence.requiresRecapture,
        evidenceAssetIds: [side.visualizationAssetIds.confidenceMask],
        explanation: excludedConditionEvidence.message,
      });
    }
    if (
      side.photometric.coverage.commonModeSpecularPixelFraction > 0 ||
      side.photometric.coverage.calibratedPatternPixelFraction > 0
    ) {
      const excludedPixelFraction = Math.min(
        1,
        side.photometric.coverage.commonModeSpecularPixelFraction +
          side.photometric.coverage.calibratedPatternPixelFraction,
      );
      limitations.push({
        limitationId: `${sideName}-full-card-common-mode-illumination`,
        side: sideName,
        regionId: `${sideName}-full-card`,
        classification: "common_mode_specular_glare",
        validEvidenceCoverage: side.photometric.coverage.validPixelFraction,
        excludedPixelFraction,
        recoveredFromAlternateChannels: side.photometric.coverage.validPixelFraction >=
          MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surfaceEvidence.minValidPixelCoverage,
        recaptureRequired: false,
        evidenceAssetIds: [
          side.visualizationAssetIds.commonModeResponse,
          ...baseEvidence,
        ],
        explanation:
          "Smooth common-mode or calibrated illumination response was excluded from physical condition scoring; valid directional channels remained authoritative.",
      });
    }
    if (side.photometric.coverage.clippedPixelFraction > 0) {
      limitations.push({
        limitationId: `${sideName}-full-card-clipping`,
        side: sideName,
        regionId: `${sideName}-full-card`,
        classification: "clipping",
        validEvidenceCoverage: side.photometric.coverage.validPixelFraction,
        excludedPixelFraction: side.photometric.coverage.clippedPixelFraction,
        recoveredFromAlternateChannels: true,
        recaptureRequired: false,
        evidenceAssetIds: baseEvidence,
        explanation:
          "Clipped pixels were excluded as evidence-quality limitations and did not deduct as physical card damage.",
      });
    }
    const lowConfidenceFraction = maskFractionV1(
      side.photometric.lowConfidenceMask,
      side.photometric.gradeRelevantMask,
    );
    if (lowConfidenceFraction > 0) {
      limitations.push({
        limitationId: `${sideName}-full-card-low-confidence`,
        side: sideName,
        regionId: `${sideName}-full-card`,
        classification: "low_confidence",
        validEvidenceCoverage: side.photometric.coverage.validPixelFraction,
        excludedPixelFraction: lowConfidenceFraction,
        recoveredFromAlternateChannels: true,
        recaptureRequired: false,
        evidenceAssetIds: [side.visualizationAssetIds.confidenceMask],
        explanation:
          "Low-confidence pixels were excluded; sufficient alternate calibrated directional evidence remained.",
      });
    }
    const insufficientDirectionalFraction = maskFractionV1(
      side.photometric.insufficientDirectionalObservationsMask,
      side.photometric.gradeRelevantMask,
    );
    if (insufficientDirectionalFraction > 0) {
      limitations.push({
        limitationId: `${sideName}-full-card-directional-coverage`,
        side: sideName,
        regionId: `${sideName}-full-card`,
        classification: "insufficient_directional_observations",
        validEvidenceCoverage: side.photometric.coverage.validPixelFraction,
        excludedPixelFraction: insufficientDirectionalFraction,
        recoveredFromAlternateChannels: false,
        recaptureRequired: false,
        evidenceAssetIds: baseEvidence,
        explanation:
          "Pixels without the minimum directional observations were excluded; remaining valid evidence satisfied final-grade coverage gates.",
      });
    }
    side.surface.suppressedCandidates.forEach((candidate, index) => {
      if (candidate.requiresRecapture) return;
      const commonMode =
        candidate.reason === "glare_explained" ||
        candidate.reason === "calibrated_illumination_pattern";
      limitations.push({
        limitationId: `${sideName}-suppressed-candidate-${index + 1}`,
        side: sideName,
        regionId: candidate.candidateId,
        classification: commonMode
          ? "common_mode_specular_glare"
          : "low_confidence",
        validEvidenceCoverage: candidate.validEvidenceCoverage,
        excludedPixelFraction: Math.max(0, 1 - candidate.validEvidenceCoverage),
        recoveredFromAlternateChannels: candidate.corroboratingChannels.length > 0,
        recaptureRequired: false,
        evidenceAssetIds: commonMode
          ? [
              side.visualizationAssetIds.commonModeResponse,
              ...baseEvidence,
            ]
          : [side.visualizationAssetIds.confidenceMask],
        explanation: candidate.message,
      });
    });
  }
  return limitations;
}

function orchestrationSummaryV1(input: {
  profile: MathematicalCalibrationProfileV1;
  sides: Record<Side, IngestedSideV1>;
  centering: Extract<ReturnType<typeof fuseFixedRigCenteringFrontBackV1>, { status: "computed" }>;
  corners: Extract<ReturnType<typeof aggregateFixedRigCornersV1>, { status: "computed" }>;
  edges: Extract<ReturnType<typeof aggregateFixedRigEdgesV1>, { status: "computed" }>;
  grade: FinalGradeV1;
}): FixedRigMathematicalCalibrationOrchestrationSummaryV1 {
  const sideSummary = (side: Side) => ({
    validPixelFraction: input.sides[side].photometric.coverage.validPixelFraction,
    invalidPixelFraction: input.sides[side].photometric.coverage.invalidPixelFraction,
    cornerFindingCount: input.corners.observations.filter((observation) => observation.side === side)
      .reduce((sum, observation) => sum + observation.findings.length, 0),
    edgeFindingCount: input.edges.observations.filter((observation) => observation.side === side)
      .reduce((sum, observation) => sum + observation.findings.length, 0),
    surfaceFindingCount: input.sides[side].surface.findings.length,
    suppressedSurfaceCandidateCount: input.sides[side].surface.suppressedCandidates.length,
    surfaceScore: input.sides[side].surface.score,
  });
  return {
    calibration: {
      profileId: input.profile.profileId,
      version: input.profile.calibrationVersion,
      artifactSha256: input.profile.artifactSha256,
    },
    sides: { front: sideSummary("front"), back: sideSummary("back") },
    scores: {
      centering: input.centering.score,
      corners: input.corners.score,
      edges: input.edges.score,
      surface: input.grade.elements.surface.score,
      overall: input.grade.overall,
      label: input.grade.labelGrade,
    },
  };
}

function calibratedConfidenceV1(
  score: number,
  warnings: string[],
): AiGraderMathematicalReportConfidenceV1 {
  const rounded = Math.round(Math.max(0, Math.min(1, score)) * 1_000_000) / 1_000_000;
  const bands = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.reportConfidenceBands;
  return {
    score: rounded,
    band: rounded >= bands.highMinimum
      ? "high"
      : rounded >= bands.mediumMinimum ? "medium" : "low",
    validEvidenceCoverage: rounded,
    warnings,
  };
}

function deriveReportConfidenceV1(input: {
  sides: Record<Side, IngestedSideV1>;
  cornerObservations: FixedRigConditionObservationResultV1[];
  edgeObservations: FixedRigConditionObservationResultV1[];
}): {
  overall: AiGraderMathematicalReportConfidenceV1;
  elements: Record<MathematicalGradingElementV1, AiGraderMathematicalReportConfidenceV1>;
} {
  const minimumCoverage = (observations: FixedRigConditionObservationResultV1[]) =>
    Math.min(...observations.map((observation) =>
      observation.status === "computed" ? observation.validEvidenceCoverage : 0));
  const centeringCoverage = Math.min(
    input.sides.front.outerCutGeometryEvidence.boundaryConfidence,
    input.sides.back.outerCutGeometryEvidence.boundaryConfidence,
    input.sides.front.centering.registration.confidence,
    input.sides.back.centering.registration.confidence,
  );
  const surfaceCoverage = Math.min(
    input.sides.front.photometric.coverage.validPixelFraction,
    input.sides.back.photometric.coverage.validPixelFraction,
  );
  const raw = {
    centering: centeringCoverage,
    corners: minimumCoverage(input.cornerObservations),
    edges: minimumCoverage(input.edgeObservations),
    surface: surfaceCoverage,
  };
  const elements = Object.fromEntries(
    (Object.entries(raw) as Array<[MathematicalGradingElementV1, number]>).map(
      ([element, coverage]) => [element, calibratedConfidenceV1(
        coverage,
        coverage < 1
          ? [`${element} confidence is derived from calibrated valid-evidence coverage and detector/registration confidence; it does not change the condition score.`]
          : [],
      )],
    ),
  ) as Record<MathematicalGradingElementV1, AiGraderMathematicalReportConfidenceV1>;
  return {
    overall: calibratedConfidenceV1(
      Math.min(...Object.values(raw)),
      Object.values(raw).some((coverage) => coverage < 1)
        ? ["Overall confidence is the minimum deterministic calibrated element confidence; no caller confidence is accepted."]
        : [],
    ),
    elements,
  };
}

function buildInsufficientResultV1(
  failure: OrchestrationFailureV1,
): BuildFixedRigMathematicalCalibrationOrchestratorV1Result {
  return {
    version: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
    status: "insufficient_evidence",
    gradingContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    failedStage: failure.stage,
    reasons: [failure.message],
    requiresRecapture: failure.flags.requiresRecapture ?? false,
    requiresApprovedDesignReference: failure.flags.requiresApprovedDesignReference ?? false,
    requiresCalibration: failure.flags.requiresCalibration ?? false,
    requiresImplementationCorrection: failure.flags.requiresImplementationCorrection ?? false,
    reportPackage: null,
    stationInput: null,
  };
}

/**
 * Runs calibrated V1 in a fixed order and emits a station-ready package only
 * after every physical, evidence, score, review, report, and checksum boundary
 * succeeds. There is intentionally no V0/manual/alternate-camera fallback.
 */
export async function buildFixedRigMathematicalCalibrationReportPackageV1(
  input: BuildFixedRigMathematicalCalibrationOrchestratorV1Input,
): Promise<BuildFixedRigMathematicalCalibrationOrchestratorV1Result> {
  try {
    if (input.gradingContract !== "mathematical_calibration_v1") {
      return fail("input_contract", "Mathematical V1 orchestration requires explicit session opt-in.", {
        requiresImplementationCorrection: true,
      });
    }
    if ("confidence" in (input.report as unknown as Record<string, unknown>)) {
      return fail(
        "input_contract",
        "Caller-authored report confidence is prohibited; V1 derives confidence from calibrated coverage, detector/registration evidence, and uncertainty-bound observations.",
        { requiresImplementationCorrection: true },
      );
    }
    if (input.report.evidenceQualityLimitations?.length) {
      return fail(
        "input_contract",
        "Caller-authored evidence-quality limitations are prohibited; V1 derives them from exact photometric and suppression evidence.",
        { requiresImplementationCorrection: true },
      );
    }
    if (!input.gradingSessionId || !input.reportId || !input.outputDir) {
      return fail("input_contract", "Mathematical V1 requires exact session, report, and package identities.", {
        requiresImplementationCorrection: true,
      });
    }
    assertCalibrationBundleAuthorityV1(input.calibration);
    const physicalBytes = await readExactFileV1(
      input.calibration.physicalArtifact,
      "physical calibration artifact",
      "calibration_ingestion",
    );
    let physicalArtifact: FixedRigPhysicalCalibrationArtifactV1;
    try {
      physicalArtifact = JSON.parse(physicalBytes.toString("utf8")) as FixedRigPhysicalCalibrationArtifactV1;
    } catch {
      return fail("calibration_ingestion", "Physical calibration artifact is not valid exact JSON evidence.", {
        requiresCalibration: true,
      });
    }
    const flatFieldBytes: Buffer[] = [];
    for (let index = 0; index < input.calibration.flatFieldArtifacts.length; index += 1) {
      flatFieldBytes.push(await readExactFileV1(
        input.calibration.flatFieldArtifacts[index]!,
        `flat-field calibration artifact ${index + 1}`,
        "calibration_ingestion",
      ));
    }
    const patternBytes = await readExactFileV1(
      input.calibration.illuminationPatternArtifact,
      "illumination-pattern calibration artifact",
      "calibration_ingestion",
    );
    let photometricCalibration: FixedRigPhotometricCalibrationProfileV1;
    try {
      photometricCalibration = buildFixedRigPhotometricCalibrationProfileV1({
        calibrationProfile: input.calibration.finalizedProfile,
        physicalArtifact,
        sensorMaximumValue: input.calibration.sensorMaximumValue,
        flatFieldArtifacts: flatFieldBytes.map((fileBytes) => ({ fileBytes })),
        illuminationPatternArtifact: { fileBytes: patternBytes },
      });
    } catch (error) {
      return fail("photometric_calibration", `Finalized calibration evidence was rejected: ${safeMessage(error)}.`, {
        requiresCalibration: true,
      });
    }
    const front = await ingestSideV1({
      side: "front",
      sideInput: input.sides.front,
      cardIdentity: input.cardIdentity,
      profile: input.calibration.finalizedProfile,
      photometricCalibration,
      sensorMaximumValue: input.calibration.sensorMaximumValue,
    });
    const back = await ingestSideV1({
      side: "back",
      sideInput: input.sides.back,
      cardIdentity: input.cardIdentity,
      profile: input.calibration.finalizedProfile,
      photometricCalibration,
      sensorMaximumValue: input.calibration.sensorMaximumValue,
    });
    const sides = { front, back };
    const centering = fuseFixedRigCenteringFrontBackV1(front.centering, back.centering);
    if (centering.status !== "computed") {
      return fail("centering", `Front/back centering fusion is insufficient: ${centering.reasons.join("; ")}`, {
        requiresRecapture: true,
        requiresApprovedDesignReference: true,
      });
    }
    const cornerObservations = [front, back].flatMap((side) =>
      side.condition.cornerObservations.map((observation) =>
        measureFixedRigCornerObservationV1(observation)));
    const edgeObservations = [front, back].flatMap((side) =>
      side.condition.edgeObservations.map((observation) =>
        measureFixedRigEdgeObservationV1(observation)));
    const corners = aggregateFixedRigCornersV1(cornerObservations, input.cornerCrossSideLinks ?? []);
    const edges = aggregateFixedRigEdgesV1(edgeObservations, input.edgeCrossSideLinks ?? []);
    if (corners.status !== "computed" || edges.status !== "computed") {
      return fail("corner_edge_measurement", [
        ...(corners.status === "insufficient_evidence" ? corners.reasons : []),
        ...(edges.status === "insufficient_evidence" ? edges.reasons : []),
      ].join("; "), { requiresRecapture: true });
    }
    const grade = buildFixedRigMathematicalGradeV1({
      calibration: input.calibration.finalizedProfile,
      centering,
      corners,
      edges,
      surface: { front: front.surface, back: back.surface },
      physicalDefectDeduplication: input.physicalDefectDeduplication,
    });
    if (grade.status !== "final_mathematical_grade_v1") {
      return fail("grade_composition", grade.issues.map((issue) => issue.message).join("; "), {
        requiresRecapture: grade.requiresRecapture,
        requiresApprovedDesignReference: grade.requiresApprovedDesignReference,
        requiresCalibration: grade.requiresCalibration,
        requiresImplementationCorrection: grade.requiresImplementationCorrection,
      });
    }
    const summary = orchestrationSummaryV1({
      profile: input.calibration.finalizedProfile,
      sides,
      centering,
      corners,
      edges,
      grade,
    });
    const assetBindings = [...front.assetBindings, ...back.assetBindings];
    const preparedFindingPresentations = await buildPreparedFindingPresentationsV1({
      captureProfileVersion: input.captureProfileVersion,
      grade,
      sides,
      cornerObservations,
      edgeObservations,
      assetBindings,
    });
    const reviewRequest = findingReviewRequestV1({
      gradingSessionId: input.gradingSessionId,
      reportId: input.reportId,
      generatedAt: input.generatedAt,
      profile: input.calibration.finalizedProfile,
      grade,
      sides,
      cornerObservations,
      edgeObservations,
      preparedPresentations: preparedFindingPresentations,
      assetBindings,
    });
    const reviewAssetIds = unique(preparedFindingPresentations.flatMap((presentation) => [
      ...presentation.roiAssetIds,
      presentation.segmentationMaskAssetId,
      presentation.confidenceMaskAssetId,
      presentation.illuminationMaskAssetId,
    ]));
    const reviewAssets = reviewAssetIds.map((assetId) => {
      const binding = assetBindings.find((entry) =>
        entry.id.toLowerCase() === assetId.toLowerCase());
      if (!binding) {
        return fail("report_adaptation", `Prepared finding-review asset ${assetId} is missing.`, {
          requiresImplementationCorrection: true,
        });
      }
      return immutableReviewAssetV1(binding);
    });
    const reviewIssues = findingReviewIssuesV1({
      request: reviewRequest,
      reviews: input.findingReviews ?? [],
    });
    if (reviewIssues.length) {
      return {
        version: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
        status: "finding_review_required",
        gradingContract: "mathematical_calibration_v1",
        v0FallbackUsed: false,
        failedStage: "finding_review",
        reviewRequest,
        reviewAssets,
        reviewIssues,
        grade,
        summary,
        reportPackage: null,
        stationInput: null,
      };
    }
    const findingPresentations = finalizeFindingPresentationsV1({
      prepared: preparedFindingPresentations,
      reviews: input.findingReviews ?? [],
      reviewRequestSha256: reviewRequest.artifactSha256,
    });
    const conditionObservationPresentations =
      await buildConditionObservationPresentationsV1({
        grade,
        sides,
        cornerObservations,
        edgeObservations,
        assetBindings,
      });
    const derivedEvidenceQualityLimitations =
      deriveEvidenceQualityLimitationsV1(sides);
    const reportConfidence = deriveReportConfidenceV1({
      sides,
      cornerObservations,
      edgeObservations,
    });
    const traceBytes = canonicalJsonBytes({
      schemaVersion: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
      gradingContract: input.gradingContract,
      gradingSessionId: input.gradingSessionId,
      reportId: input.reportId,
      calibration: {
        profileId: input.calibration.finalizedProfile.profileId,
        version: input.calibration.finalizedProfile.calibrationVersion,
        artifactSha256: input.calibration.finalizedProfile.artifactSha256,
        bundleManifestSha256: input.calibration.bundleAuthority.bundleManifestSha256,
        sourceCaptureManifestSha256: input.calibration.bundleAuthority.sourceCaptureManifestSha256,
        memberLedgerSha256: input.calibration.bundleAuthority.memberLedgerSha256,
        physicalArtifactFileSha256: input.calibration.physicalArtifact.sha256.toLowerCase(),
        flatFieldArtifactFileSha256s: input.calibration.flatFieldArtifacts
          .map((entry) => entry.sha256.toLowerCase()),
        illuminationPatternArtifactFileSha256:
          input.calibration.illuminationPatternArtifact.sha256.toLowerCase(),
      },
      evidence: Object.fromEntries((["front", "back"] as const).map((side) => [side, {
        rawAllOnSha256: input.sides[side].rawAllOn.sha256.toLowerCase(),
        rawToNormalizedTransformSha256:
          input.sides[side].rawToNormalizedTransform.transformSha256,
        normalizedAllOnSha256: input.sides[side].normalizedAllOn.sha256.toLowerCase(),
        normalizedCardSha256: input.sides[side].normalizedCard.sha256.toLowerCase(),
        darkControlSha256: input.sides[side].darkControl.sha256.toLowerCase(),
        ...(input.sides[side].designReference ? {
          designReferenceId: input.sides[side].designReference!.designReferenceId,
          designReferenceSha256:
            input.sides[side].designReference!.artifactSha256.toLowerCase(),
        } : {
          designReferenceUnavailable: true,
        }),
        intendedOuterBoundaryProfileId:
          input.sides[side].intendedOuterBoundary.profileId,
        intendedOuterBoundaryProfileVersion:
          input.sides[side].intendedOuterBoundary.profileVersion,
        intendedOuterBoundaryArtifactSha256:
          input.sides[side].intendedOuterBoundary.artifactSha256,
        directionalChannelSha256s: [...input.sides[side].directionalChannels]
          .sort((left, right) => left.channel - right.channel)
          .map((entry) => entry.sha256.toLowerCase()),
        detectorPlaneSha256s: sides[side].detectorPlaneSha256s,
        heatmapUsedAsIndependentGradeInput: false,
      }])),
      findingReviewRequestSha256: reviewRequest.artifactSha256,
      findingReviews: (input.findingReviews ?? []).map((review) => ({
        findingId: review.findingId,
        reviewRequestSha256: review.reviewRequestSha256,
        status: review.status,
        reviewedAt: review.reviewedAt,
      })),
      summary,
      v0FallbackUsed: false,
    });
    const traceAssetId = "mathematical-v1/orchestration-trace.json";
    assetBindings.push({
      id: traceAssetId,
      side: "front",
      evidenceRole: "other_evidence",
      fileName: "mathematical-v1-orchestration-trace.json",
      contentType: "application/json",
      bytes: traceBytes,
      sha256: sha256(traceBytes),
      byteSize: traceBytes.byteLength,
    });
    let reportArtifact: AiGraderMathematicalReportBundleV1Artifact;
    try {
      reportArtifact = await buildAiGraderMathematicalReportBundleV1({
        generatedAt: input.generatedAt,
        reportId: input.reportId,
        cardIdentity: input.cardIdentity,
        calibrationProfile: input.calibration.finalizedProfile,
        calibrationBundleAuthority: input.calibration.bundleAuthority,
        designReferences: [front.input.designReference, back.input.designReference]
          .filter((reference): reference is MathematicalDesignReferenceV1 => Boolean(reference)),
        centering,
        corners,
        edges,
        surface: { front: front.surface, back: back.surface },
        outerCutGeometryEvidence: {
          front: front.outerCutGeometryEvidence,
          back: back.outerCutGeometryEvidence,
        },
        grade,
        publication: input.report.publication,
        confidence: reportConfidence,
        findingPresentations,
        conditionObservationPresentations,
        assetBindings,
        evidenceQualityLimitations: derivedEvidenceQualityLimitations,
        geometry: input.report.geometry,
        geometryCaptureDecisions: input.report.geometryCaptureDecisions,
        captureTiming: input.report.captureTiming,
        ocrPrefill: input.report.ocrPrefill,
        warnings: input.report.warnings,
        limitations: input.report.limitations,
      });
    } catch (error) {
      return fail("report_adaptation", `Strict V0.3 report adapter rejected the calibrated artifact: ${safeMessage(error)}.`, {
        requiresImplementationCorrection: true,
      });
    }
    let reportPackage: AiGraderMathematicalReportPackageV1;
    try {
      reportPackage = await writeAiGraderMathematicalReportPackageV1({
        gradingSessionId: input.gradingSessionId,
        artifact: reportArtifact,
        outputDir: input.outputDir,
      });
    } catch (error) {
      return fail("package_write", `Strict V0.3 immutable package write failed: ${safeMessage(error)}.`, {
        requiresImplementationCorrection: true,
      });
    }
    return {
      version: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
      status: "completed",
      gradingContract: "mathematical_calibration_v1",
      v0FallbackUsed: false,
      reportArtifact,
      reportPackage,
      stationInput: {
        gradingContract: "mathematical_calibration_v1",
        mathematicalReportPackagePath: input.outputDir,
      },
      grade,
      orchestrationTraceSha256: sha256(traceBytes),
      summary,
    };
  } catch (error) {
    if (error instanceof OrchestrationFailureV1) return buildInsufficientResultV1(error);
    return buildInsufficientResultV1(new OrchestrationFailureV1(
      "input_contract",
      `Unexpected deterministic V1 orchestration failure: ${safeMessage(error)}.`,
      { requiresImplementationCorrection: true },
    ));
  }
}
