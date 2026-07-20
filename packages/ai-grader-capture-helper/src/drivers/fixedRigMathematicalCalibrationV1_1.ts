import {
  MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST,
  MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_HASH,
  MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_ID,
} from "@tenkings/shared";

export const MATHEMATICAL_CALIBRATION_V1_1_ALGORITHM_VERSION =
  "fixed-rig-mathematical-calibration-v1.1-geometry-loo-u95" as const;
export const MATHEMATICAL_CALIBRATION_V1_1_PREVIEW_MIN_SAFETY_MARGIN_FRACTION = 0.01;
export const MATHEMATICAL_CALIBRATION_V1_1_REQUIRED_PLACEMENTS = 4 as const;
export const MATHEMATICAL_CALIBRATION_V1_1_REQUIRED_CHANNEL_FRAMES_PER_MODE = 3 as const;
type MathematicalCalibrationV1_1Corners = ReadonlyArray<{ x: number; y: number }>;

export interface MathematicalCalibrationV1_1Pose {
  evidenceId?: string;
  centerXFraction: number;
  centerYFraction: number;
  coverageFraction: number;
  rotationDegrees: number;
  cornerSignature: readonly number[];
  imageWidth: number;
  imageHeight: number;
  corners: MathematicalCalibrationV1_1Corners;
}

export interface MathematicalCalibrationV1_1PreviewAssessment {
  valid: boolean;
  sufficientlyDistinct: boolean;
  placementIndex: number;
  nextPlacementIndex: number;
  coverageFraction: number | null;
  center: { xFraction: number; yFraction: number } | null;
  rotationDegrees: number | null;
  outerContour: MathematicalCalibrationV1_1Corners | null;
  safetyMarginFraction: number | null;
  minimumSafetyMarginFraction: number;
  reasons: string[];
  thresholdSetId: typeof MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_ID;
  thresholdSetHash: typeof MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_HASH;
}

export interface MathematicalCalibrationV1_1EvidenceReference {
  evidenceId: string;
  sha256: string;
  roles: readonly [
    "geometry",
    "normalization_holdout",
    "segmentation_boundary",
    "repeated_placement",
  ];
}

export interface MathematicalCalibrationV1_1ValidationResult {
  accepted: boolean;
  contractVersion: "1.1.0";
  algorithmVersion: typeof MATHEMATICAL_CALIBRATION_V1_1_ALGORITHM_VERSION;
  thresholdSetId: typeof MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_ID;
  thresholdSetHash: typeof MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_HASH;
  poseCount: number;
  uniqueEvidenceCount: number;
  geometrySpans: { x: number; y: number; rotation: number };
  holdoutU95: number;
  reasons: string[];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function wrappedRotationDifference(left: number, right: number): number {
  const raw = Math.abs(left - right) % 360;
  return Math.min(raw, 360 - raw);
}

function contourArea(corners: MathematicalCalibrationV1_1Corners): number {
  return Math.abs(corners.reduce((total, point, index) => {
    const next = corners[(index + 1) % corners.length]!;
    return total + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function poseFromContour(
  corners: MathematicalCalibrationV1_1Corners,
  imageWidth: number,
  imageHeight: number,
  rotationDegrees: number,
): MathematicalCalibrationV1_1Pose | undefined {
  if (!finite(imageWidth) || !finite(imageHeight) || imageWidth <= 0 || imageHeight <= 0 || !finite(rotationDegrees)) {
    return undefined;
  }
  if (corners.some((point) => !finite(point.x) || !finite(point.y))) return undefined;
  const margin = Math.min(...corners.map((point) => Math.min(
    point.x / imageWidth,
    point.y / imageHeight,
    (imageWidth - point.x) / imageWidth,
    (imageHeight - point.y) / imageHeight,
  )));
  const coverage = contourArea(corners) / (imageWidth * imageHeight);
  const centerX = corners.reduce((sum, point) => sum + point.x, 0) / corners.length;
  const centerY = corners.reduce((sum, point) => sum + point.y, 0) / corners.length;
  return {
    centerXFraction: centerX / imageWidth,
    centerYFraction: centerY / imageHeight,
    coverageFraction: coverage,
    rotationDegrees,
    cornerSignature: corners.flatMap((point) => [point.x / imageWidth, point.y / imageHeight]),
    imageWidth,
    imageHeight,
    corners,
    ...(margin >= MATHEMATICAL_CALIBRATION_V1_1_PREVIEW_MIN_SAFETY_MARGIN_FRACTION ? {} : {}),
  };
}

export function assessMathematicalCalibrationV1_1Preview(input: {
  corners?: MathematicalCalibrationV1_1Corners | null;
  imageWidth?: number;
  imageHeight?: number;
  rotationDegrees?: number | null;
  acceptedPoses: readonly MathematicalCalibrationV1_1Pose[];
}): MathematicalCalibrationV1_1PreviewAssessment {
  const placementIndex = input.acceptedPoses.length;
  const base = {
    placementIndex,
    nextPlacementIndex: Math.min(placementIndex + 1, MATHEMATICAL_CALIBRATION_V1_1_REQUIRED_PLACEMENTS),
    minimumSafetyMarginFraction: MATHEMATICAL_CALIBRATION_V1_1_PREVIEW_MIN_SAFETY_MARGIN_FRACTION,
    thresholdSetId: MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_HASH,
  } as const;
  if (!input.corners || !finite(input.imageWidth) || !finite(input.imageHeight) || !finite(input.rotationDegrees)) {
    return {
      ...base,
      valid: false,
      sufficientlyDistinct: false,
      coverageFraction: null,
      center: null,
      rotationDegrees: null,
      outerContour: null,
      safetyMarginFraction: null,
      reasons: ["checkerboard outer contour is not detected with finite geometry"],
    };
  }
  const pose = poseFromContour(input.corners, input.imageWidth, input.imageHeight, input.rotationDegrees);
  if (!pose) {
    return {
      ...base,
      valid: false,
      sufficientlyDistinct: false,
      coverageFraction: null,
      center: null,
      rotationDegrees: null,
      outerContour: null,
      safetyMarginFraction: null,
      reasons: ["checkerboard geometry is not finite"],
    };
  }
  const safetyMarginFraction = Math.min(...pose.corners.map((point) => Math.min(
    point.x / pose.imageWidth,
    point.y / pose.imageHeight,
    (pose.imageWidth - point.x) / pose.imageWidth,
    (pose.imageHeight - point.y) / pose.imageHeight,
  )));
  const policy = MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST.calibrationAcceptance.captureEvidence.poseDiversity;
  const valid = pose.coverageFraction >= policy.minimumDetectedTargetCoverageFractionPerView
    && safetyMarginFraction >= MATHEMATICAL_CALIBRATION_V1_1_PREVIEW_MIN_SAFETY_MARGIN_FRACTION;
  const sufficientlyDistinct = input.acceptedPoses.every((previous) =>
    Math.abs(previous.centerXFraction - pose.centerXFraction) >= 0.005
    || Math.abs(previous.centerYFraction - pose.centerYFraction) >= 0.005
    || wrappedRotationDifference(previous.rotationDegrees, pose.rotationDegrees) >= 2,
  );
  const reasons: string[] = [];
  if (pose.coverageFraction < policy.minimumDetectedTargetCoverageFractionPerView) reasons.push("coverage is below the centralized minimum");
  if (safetyMarginFraction < MATHEMATICAL_CALIBRATION_V1_1_PREVIEW_MIN_SAFETY_MARGIN_FRACTION) reasons.push("outer contour is inside the unsafe frame margin");
  if (!sufficientlyDistinct) reasons.push("pose is not sufficiently distinct from an accepted placement");
  if (placementIndex >= MATHEMATICAL_CALIBRATION_V1_1_REQUIRED_PLACEMENTS) reasons.push("all four immutable placements are already captured");
  return {
    ...base,
    valid,
    sufficientlyDistinct,
    coverageFraction: Number(pose.coverageFraction.toFixed(6)),
    center: { xFraction: Number(pose.centerXFraction.toFixed(6)), yFraction: Number(pose.centerYFraction.toFixed(6)) },
    rotationDegrees: Number(pose.rotationDegrees.toFixed(6)),
    outerContour: pose.corners,
    safetyMarginFraction: Number(safetyMarginFraction.toFixed(6)),
    reasons,
  };
}

/** Student-t 97.5% critical values for the only supported four-pose LOO sample. */
export function conservativeSmallSampleU95(values: readonly number[]): number {
  if (values.length !== MATHEMATICAL_CALIBRATION_V1_1_REQUIRED_PLACEMENTS || values.some((value) => !finite(value))) {
    throw new Error("V1.1 conservative U95 requires exactly four finite leave-one-pose-out values.");
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return 3.182446305284263 * Math.sqrt(variance);
}

export function validateFourPoseEvidence(input: {
  poses: readonly MathematicalCalibrationV1_1Pose[];
  evidence: readonly MathematicalCalibrationV1_1EvidenceReference[];
  leaveOnePoseOutResiduals: readonly number[];
}): MathematicalCalibrationV1_1ValidationResult {
  const reasons: string[] = [];
  const poses = input.poses;
  const evidenceIds = new Set(input.evidence.map((entry) => entry.evidenceId));
  const policy = MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST.calibrationAcceptance.captureEvidence.poseDiversity;
  const x = poses.length ? Math.max(...poses.map((pose) => pose.centerXFraction)) - Math.min(...poses.map((pose) => pose.centerXFraction)) : 0;
  const y = poses.length ? Math.max(...poses.map((pose) => pose.centerYFraction)) - Math.min(...poses.map((pose) => pose.centerYFraction)) : 0;
  const rotation = poses.length ? Math.max(...poses.map((pose) => pose.rotationDegrees)) - Math.min(...poses.map((pose) => pose.rotationDegrees)) : 0;
  if (poses.length !== MATHEMATICAL_CALIBRATION_V1_1_REQUIRED_PLACEMENTS) reasons.push("exactly four checkerboard placements are required");
  if (evidenceIds.size !== input.evidence.length || evidenceIds.size !== poses.length) reasons.push("placement evidence is duplicated or inflated");
  if (poses.some((pose) => pose.coverageFraction < policy.minimumDetectedTargetCoverageFractionPerView)) reasons.push("a placement is below the minimum coverage");
  if (x < policy.geometry.minimumNormalizedCenterSpanX || y < policy.geometry.minimumNormalizedCenterSpanY || rotation < policy.geometry.minimumRotationSpanDegrees) reasons.push("four-pose diversity does not meet the centralized geometry minima");
  if (input.leaveOnePoseOutResiduals.length !== MATHEMATICAL_CALIBRATION_V1_1_REQUIRED_PLACEMENTS) reasons.push("deterministic LOO evidence is incomplete");
  const holdoutU95 = input.leaveOnePoseOutResiduals.length === MATHEMATICAL_CALIBRATION_V1_1_REQUIRED_PLACEMENTS
    ? conservativeSmallSampleU95(input.leaveOnePoseOutResiduals)
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(holdoutU95)) reasons.push("small-sample U95 could not be computed");
  return {
    accepted: reasons.length === 0,
    contractVersion: "1.1.0",
    algorithmVersion: MATHEMATICAL_CALIBRATION_V1_1_ALGORITHM_VERSION,
    thresholdSetId: MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_HASH,
    poseCount: poses.length,
    uniqueEvidenceCount: evidenceIds.size,
    geometrySpans: { x, y, rotation },
    holdoutU95,
    reasons,
  };
}
