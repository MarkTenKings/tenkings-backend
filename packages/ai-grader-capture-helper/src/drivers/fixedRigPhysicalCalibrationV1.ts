import { createHash } from "node:crypto";
import {
  MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  validateMathematicalCalibrationProfileV1,
  type MathematicalCalibrationProfileV1,
  type MathematicalCalibrationValidationIssueV1,
} from "@tenkings/shared";

export const FIXED_RIG_PHYSICAL_CALIBRATION_V1_VERSION =
  "fixed_rig_physical_calibration_v1" as const;

export interface FixedRigCalibrationEvidenceReferenceV1 {
  evidenceId: string;
  sha256: string;
  role: string;
}

export interface FixedRigScaleSampleV1 extends FixedRigCalibrationEvidenceReferenceV1 {
  axis: "x" | "y";
  physicalSpanMm: number;
  physicalSpanU95Mm: number;
  pixelSpan: number;
}

export interface FixedRigTargetPrintScaleMeasurementSampleV1 extends FixedRigCalibrationEvidenceReferenceV1 {
  axis: "x" | "y";
  nominalSpanMm: number;
  measuredSpanMm: number;
  measurementU95Mm: number;
}

export interface FixedRigProtectedTargetPrintScaleAuthorityV1 extends FixedRigCalibrationEvidenceReferenceV1 {
  axis: "x" | "y";
  authorityBasis: "protected_checkerboard_geometry";
  protectedSpanMm: number;
  targetVersion: string;
  targetSha256: string;
}

export type FixedRigTargetPrintScaleSampleV1 =
  | FixedRigTargetPrintScaleMeasurementSampleV1
  | FixedRigProtectedTargetPrintScaleAuthorityV1;

export interface FixedRigTargetCutDimensionMeasurementSampleV1 extends FixedRigCalibrationEvidenceReferenceV1 {
  axis: "x" | "y";
  nominalDimensionMm: number;
  measuredDimensionMm: number;
  measurementU95Mm: number;
}

export interface FixedRigProtectedTargetCutDimensionAuthorityV1 extends FixedRigCalibrationEvidenceReferenceV1 {
  axis: "x" | "y";
  authorityBasis: "protected_checkerboard_geometry";
  protectedDimensionMm: number;
  targetVersion: string;
  targetSha256: string;
}

export type FixedRigTargetCutDimensionSampleV1 =
  | FixedRigTargetCutDimensionMeasurementSampleV1
  | FixedRigProtectedTargetCutDimensionAuthorityV1;

export interface FixedRigResidualSampleV1 extends FixedRigCalibrationEvidenceReferenceV1 {
  residualPx: number;
}

export interface FixedRigRepeatedPlacementSampleV1 extends FixedRigCalibrationEvidenceReferenceV1 {
  displacementXMm: number;
  displacementYMm: number;
}

export interface FixedRigBoundaryRepeatabilitySampleV1 extends FixedRigCalibrationEvidenceReferenceV1 {
  outerContourFitResidualPx: number;
}

export type FixedRigMeasurementRepeatabilityClassV1 =
  | "linear_mm"
  | "area_mm2"
  | "relief_index"
  | "roughness_index"
  | "color_delta_e";

export interface FixedRigMeasurementRepeatabilitySampleV1
  extends FixedRigCalibrationEvidenceReferenceV1 {
  measurementClass: FixedRigMeasurementRepeatabilityClassV1;
  referenceFeatureId: string;
  measuredValue: number;
}

export interface FixedRigFlatFieldFrameV1 extends FixedRigCalibrationEvidenceReferenceV1 {}
export interface FixedRigDarkControlFrameV1 extends FixedRigCalibrationEvidenceReferenceV1 {}
export interface FixedRigIlluminationPatternFrameV1 extends FixedRigCalibrationEvidenceReferenceV1 {}
export interface FixedRigDirectionMeasurementSampleV1 extends FixedRigCalibrationEvidenceReferenceV1 {
  measurementMethod:
    | "fixed_ring_segment_geometry_with_ruler_v1"
    | "illumination_centroid_checkerboard_repeatability_v1";
  sourcePointMm: { x: number; y: number };
  cardCenterPointMm: { x: number; y: number };
  pointU95Mm: number;
}

export interface FixedRigCalibrationChannelInputV1 {
  channelIndex: number;
  directionMeasurementSamples: FixedRigDirectionMeasurementSampleV1[];
  directionValidationAngularErrorsDegrees: number[];
  relativeResponse: ArrayLike<number>;
  responseScale: number;
  flatFieldArtifactId: string;
  flatFieldArtifactSha256: string;
  flatFieldFrames: FixedRigFlatFieldFrameV1[];
  darkControlFrames: FixedRigDarkControlFrameV1[];
  illuminationPatternArtifactId: string;
  illuminationPatternArtifactSha256: string;
  illuminationPatternFrames: FixedRigIlluminationPatternFrameV1[];
  illuminationPatternGridWidth: number;
  illuminationPatternGridHeight: number;
  expectedDirectionalResidual: ArrayLike<number>;
}

export interface FixedRigLensDistortionModelV1 {
  model: "opencv_brown_conrady_v1";
  sourceWidthPx: number;
  sourceHeightPx: number;
  cameraMatrix: number[];
  distortionCoefficients: number[];
  calibrationRmsPx: number;
  perViewResidualPx: number[];
}

export interface FixedRigNormalizationModelV1 {
  model: "undistort_outer_cut_homography_with_fixed_holdout_repeatability_v1";
  sampleResidualPx: number[];
}

export interface BuildFixedRigPhysicalCalibrationV1Input {
  profileId: string;
  calibrationVersion: string;
  rigId: string;
  artifactId: string;
  finalizedAt: string;
  normalizedWidthPx: number;
  normalizedHeightPx: number;
  scaleSamples: FixedRigScaleSampleV1[];
  targetPrintScaleSamples: FixedRigTargetPrintScaleSampleV1[];
  targetCutDimensionSamples: FixedRigTargetCutDimensionSampleV1[];
  lensResidualSamples: FixedRigResidualSampleV1[];
  normalizationResidualSamples: FixedRigResidualSampleV1[];
  repeatedPlacementSamples: FixedRigRepeatedPlacementSampleV1[];
  segmentationBoundarySamples: FixedRigBoundaryRepeatabilitySampleV1[];
  measurementRepeatabilitySamples: FixedRigMeasurementRepeatabilitySampleV1[];
  channels: FixedRigCalibrationChannelInputV1[];
  targetEvidence: FixedRigCalibrationEvidenceReferenceV1[];
  operatorId: string;
  targetVersion: string;
  targetSha256: string;
  lensModel: FixedRigLensDistortionModelV1;
  normalizationModel: FixedRigNormalizationModelV1;
}

export interface FixedRigPhysicalCalibrationArtifactV1 {
  schemaVersion: "ai-grader-physical-calibration-artifact-v1";
  algorithmVersion: typeof FIXED_RIG_PHYSICAL_CALIBRATION_V1_VERSION;
  thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
  thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
  artifactId: string;
  artifactSha256: string;
  hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted";
  profileId: string;
  calibrationVersion: string;
  rigId: string;
  finalizedAt: string;
  operatorId: string;
  target: { version: string; sha256: string };
  evidence: FixedRigCalibrationEvidenceReferenceV1[];
  inputs: {
    scaleSamples: FixedRigScaleSampleV1[];
    targetPrintScaleSamples: FixedRigTargetPrintScaleSampleV1[];
    targetCutDimensionSamples: FixedRigTargetCutDimensionSampleV1[];
    lensResidualSamples: FixedRigResidualSampleV1[];
    normalizationResidualSamples: FixedRigResidualSampleV1[];
    repeatedPlacementSamples: FixedRigRepeatedPlacementSampleV1[];
    segmentationBoundarySamples: FixedRigBoundaryRepeatabilitySampleV1[];
    measurementRepeatabilitySamples: FixedRigMeasurementRepeatabilitySampleV1[];
    lensModel: FixedRigLensDistortionModelV1;
    normalizationModel: FixedRigNormalizationModelV1;
    channels: Array<{
      channelIndex: number;
      direction: { x: number; y: number };
      directionConfidence: number;
      directionMeasurementSampleCount: number;
      directionAngularU95Degrees: number | null;
      directionSourceRadiusMm: number | null;
      directionPointU95Mm: number | null;
      directionValidationAngularErrorsDegrees: number[];
      directionMeasurementEvidence: FixedRigDirectionMeasurementSampleV1[];
      flatFieldArtifactId: string;
      flatFieldArtifactSha256: string;
      flatFieldFrameCount: number;
      flatFieldFrameEvidence: FixedRigFlatFieldFrameV1[];
      darkControlFrameCount: number;
      darkControlFrameEvidence: FixedRigDarkControlFrameV1[];
      maxFlatFieldDeviationFraction: number | null;
      responseScale: number;
      illuminationPatternArtifactId: string;
      illuminationPatternArtifactSha256: string;
      illuminationPatternFrameCount: number;
      illuminationPatternFrameEvidence: FixedRigIlluminationPatternFrameV1[];
      illuminationPatternGridWidth: number;
      illuminationPatternGridHeight: number;
      maximumAbsoluteExpectedDirectionalResidual: number | null;
    }>;
  };
  computed: {
    mmPerPixelX: number | null;
    mmPerPixelY: number | null;
    scaleRelativeU95: number | null;
    lensResidualPx: number | null;
    normalizationRegistrationResidualPx: number | null;
    repeatedPlacementU95Mm: number | null;
    segmentationBoundaryU95Px: number | null;
    measurementRepeatability: {
      linearMm: { sampleCount: number; u95: number | null };
      areaMm2: { sampleCount: number; u95: number | null };
      reliefIndex: { sampleCount: number; u95: number | null };
      roughnessIndex: { sampleCount: number; u95: number | null };
      colorDeltaE: { sampleCount: number; u95: number | null };
    };
  };
  methods: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty;
}

export type BuildFixedRigPhysicalCalibrationV1Result =
  | {
      status: "finalized";
      isCalibrated: true;
      profile: MathematicalCalibrationProfileV1;
      artifact: FixedRigPhysicalCalibrationArtifactV1;
      issues: [];
    }
  | {
      status: "rejected";
      isCalibrated: false;
      profile: null;
      artifact: FixedRigPhysicalCalibrationArtifactV1;
      issues: MathematicalCalibrationValidationIssueV1[];
    };

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values: readonly number[]): number {
  if (!values.length) throw new RangeError("At least one calibration sample is required.");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2) return Number.POSITIVE_INFINITY;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function rms(values: readonly number[]): number {
  if (!values.length) return Number.POSITIVE_INFINITY;
  return Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length);
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

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function finiteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function maxFlatFieldDeviation(relativeResponse: ArrayLike<number>): number {
  const values = Array.from(relativeResponse);
  if (!values.length || values.some((value) => !finitePositive(value))) return Number.POSITIVE_INFINITY;
  const average = mean(values);
  return Math.max(...values.map((value) => Math.abs(value / average - 1)));
}

function deriveDirectionMeasurement(
  samples: readonly FixedRigDirectionMeasurementSampleV1[],
  validationAngularErrorsDegrees: readonly number[],
  coverageFactor: number,
): {
  direction: { x: number; y: number };
  angularU95Degrees: number;
  confidence: number;
  sourceRadiusMm: number;
  pointU95Mm: number;
} | null {
  if (!samples.length ||
      validationAngularErrorsDegrees.length !== samples.length ||
      validationAngularErrorsDegrees.some((value) => !finiteNonnegative(value))) return null;
  const normalized = samples.map((sample) => {
    if (
      !(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance
        .allowedPhysicalDirectionMeasurementMethods.includes(sample.measurementMethod as "fixed_ring_segment_geometry_with_ruler_v1") ||
        sample.measurementMethod === "illumination_centroid_checkerboard_repeatability_v1") ||
      !Number.isFinite(sample.sourcePointMm?.x) ||
      !Number.isFinite(sample.sourcePointMm?.y) ||
      !Number.isFinite(sample.cardCenterPointMm?.x) ||
      !Number.isFinite(sample.cardCenterPointMm?.y) ||
      !finitePositive(sample.pointU95Mm)
    ) return null;
    const x = sample.sourcePointMm.x - sample.cardCenterPointMm.x;
    const y = sample.sourcePointMm.y - sample.cardCenterPointMm.y;
    const length = Math.hypot(x, y);
    return Number.isFinite(length) && length > 0
      ? {
          x: x / length,
          y: y / length,
          radiusMm: length,
          pointAngularU95Degrees:
            Math.atan2(sample.pointU95Mm, length) * 180 / Math.PI,
        }
      : null;
  });
  if (normalized.some((sample) => sample === null)) return null;
  const vectors = normalized as Array<{
    x: number;
    y: number;
    radiusMm: number;
    pointAngularU95Degrees: number;
  }>;
  const meanX = mean(vectors.map((sample) => sample.x));
  const meanY = mean(vectors.map((sample) => sample.y));
  const meanLength = Math.hypot(meanX, meanY);
  if (!Number.isFinite(meanLength) || meanLength <= 0) return null;
  const direction = { x: meanX / meanLength, y: meanY / meanLength };
  const signedAnglesDegrees = vectors.map((sample) =>
    Math.atan2(
      direction.x * sample.y - direction.y * sample.x,
      direction.x * sample.x + direction.y * sample.y,
    ) * 180 / Math.PI,
  );
  const angularU95Degrees = Math.hypot(
    coverageFactor * sampleStandardDeviation(signedAnglesDegrees),
    Math.max(...vectors.map((sample) => sample.pointAngularU95Degrees)),
    rms(validationAngularErrorsDegrees),
  );
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance;
  return {
    direction: { x: round(direction.x), y: round(direction.y) },
    angularU95Degrees: round(angularU95Degrees),
    sourceRadiusMm: round(mean(vectors.map((sample) => sample.radiusMm))),
    pointU95Mm: round(Math.max(...samples.map((sample) => sample.pointU95Mm))),
    confidence: round(
      Math.max(
        0,
        1 - angularU95Degrees / policy.channelDirectionConfidenceSectorScaleDegrees,
      ),
    ),
  };
}

function uniqueEvidence(input: BuildFixedRigPhysicalCalibrationV1Input): FixedRigCalibrationEvidenceReferenceV1[] {
  const evidence = [
    ...input.targetEvidence,
    ...input.scaleSamples,
    ...(input.targetPrintScaleSamples ?? []),
    ...(input.targetCutDimensionSamples ?? []),
    ...input.lensResidualSamples,
    ...input.normalizationResidualSamples,
    ...input.repeatedPlacementSamples,
    ...input.segmentationBoundarySamples,
    ...input.measurementRepeatabilitySamples,
    ...input.channels.flatMap((channel) => channel.flatFieldFrames),
    ...input.channels.flatMap((channel) => channel.darkControlFrames),
    ...input.channels.flatMap((channel) => channel.illuminationPatternFrames),
    ...input.channels.flatMap((channel) => channel.directionMeasurementSamples),
  ].map(({ evidenceId, sha256, role }) => ({ evidenceId, sha256, role }));
  return [...new Map(evidence.map((entry) => [
    `${entry.evidenceId}:${entry.sha256}:${entry.role}`,
    entry,
  ])).values()];
}

function recorded(value: number): number | null {
  return Number.isFinite(value) ? round(value) : null;
}

export function buildFixedRigPhysicalCalibrationV1(
  input: BuildFixedRigPhysicalCalibrationV1Input,
): BuildFixedRigPhysicalCalibrationV1Result {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST;
  const manualIssues: MathematicalCalibrationValidationIssueV1[] = [];
  const addIssue = (path: string, message: string) => manualIssues.push({ path, message });
  const xSamples = input.scaleSamples.filter((sample) => sample.axis === "x");
  const ySamples = input.scaleSamples.filter((sample) => sample.axis === "y");
  if (xSamples.some((sample) => !finitePositive(sample.physicalSpanMm) ||
      !finitePositive(sample.physicalSpanU95Mm) || !finitePositive(sample.pixelSpan)) ||
      ySamples.some((sample) => !finitePositive(sample.physicalSpanMm) ||
      !finitePositive(sample.physicalSpanU95Mm) || !finitePositive(sample.pixelSpan))) {
    addIssue(
      "scaleSamples",
      "physical span, pixel span, and physical U95 must be finite and positive",
    );
  }
  if (xSamples.length < policy.calibrationAcceptance.minimumScaleSamples ||
      ySamples.length < policy.calibrationAcceptance.minimumScaleSamples) {
    addIssue(
      "scaleSamples",
      `each axis requires at least ${policy.calibrationAcceptance.minimumScaleSamples} samples`,
    );
  }
  const xScale = xSamples.filter((sample) => finitePositive(sample.physicalSpanMm) && finitePositive(sample.pixelSpan))
    .map((sample) => sample.physicalSpanMm / sample.pixelSpan);
  const yScale = ySamples.filter((sample) => finitePositive(sample.physicalSpanMm) && finitePositive(sample.pixelSpan))
    .map((sample) => sample.physicalSpanMm / sample.pixelSpan);
  const mmPerPixelX = xScale.length ? mean(xScale) : 0;
  const mmPerPixelY = yScale.length ? mean(yScale) : 0;
  const coverageFactor = policy.uncertainty.coverageFactor;
  const relativeU95X = xScale.length > 1 && mmPerPixelX > 0
    ? coverageFactor * sampleStandardDeviation(xScale) / mmPerPixelX
    : Number.POSITIVE_INFINITY;
  const relativeU95Y = yScale.length > 1 && mmPerPixelY > 0
    ? coverageFactor * sampleStandardDeviation(yScale) / mmPerPixelY
    : Number.POSITIVE_INFINITY;
  const physicalRelativeU95X = xSamples.length
    ? Math.max(...xSamples.map((sample) =>
      finitePositive(sample.physicalSpanMm) && finitePositive(sample.physicalSpanU95Mm)
        ? sample.physicalSpanU95Mm / sample.physicalSpanMm
        : Number.POSITIVE_INFINITY))
    : Number.POSITIVE_INFINITY;
  const physicalRelativeU95Y = ySamples.length
    ? Math.max(...ySamples.map((sample) =>
      finitePositive(sample.physicalSpanMm) && finitePositive(sample.physicalSpanU95Mm)
        ? sample.physicalSpanU95Mm / sample.physicalSpanMm
        : Number.POSITIVE_INFINITY))
    : Number.POSITIVE_INFINITY;
  const scaleRelativeU95 = Math.max(
    Math.hypot(relativeU95X, physicalRelativeU95X),
    Math.hypot(relativeU95Y, physicalRelativeU95Y),
  );
  const targetPrintScaleSamples = Array.isArray(input.targetPrintScaleSamples)
    ? input.targetPrintScaleSamples
    : [];
  if (
    !["x", "y"].every((axis) =>
      targetPrintScaleSamples.some((sample) => sample.axis === axis))
  ) {
    addIssue("targetPrintScaleSamples", "exact X and Y print-scale verification is required");
  }
  for (const sample of targetPrintScaleSamples) {
    if ("protectedSpanMm" in sample) {
      if (sample.authorityBasis !== "protected_checkerboard_geometry" ||
          !finitePositive(sample.protectedSpanMm) ||
          sample.targetVersion !== input.targetVersion || sample.targetSha256 !== input.targetSha256) {
        addIssue("targetPrintScaleSamples", "protected checkerboard print-scale authority must match the exact target identity");
      }
    } else {
      if (!finitePositive(sample.nominalSpanMm) || !finitePositive(sample.measuredSpanMm) ||
          !finitePositive(sample.measurementU95Mm)) {
        addIssue("targetPrintScaleSamples", "scale verification values must be finite physical measurements");
      } else if (Math.abs(sample.measuredSpanMm - sample.nominalSpanMm) + sample.measurementU95Mm >
          policy.calibrationAcceptance.maxTargetPrintScaleErrorMm) {
        addIssue(
          "targetPrintScaleSamples",
          `print-scale error plus U95 must be <= ${policy.calibrationAcceptance.maxTargetPrintScaleErrorMm} mm`,
        );
      }
    }
  }
  const requiredPrintSpans = policy.calibrationAcceptance.targetPrintVerificationSpansMm;
  for (const axis of ["x", "y"] as const) {
    const samples = targetPrintScaleSamples.filter((sample) => sample.axis === axis);
    const observedSpan = samples.length === 1
      ? ("protectedSpanMm" in samples[0]! ? samples[0]!.protectedSpanMm : samples[0]!.nominalSpanMm)
      : undefined;
    if (samples.length !== 1 || observedSpan !== requiredPrintSpans[axis]) {
      addIssue(
        "targetPrintScaleSamples",
        `requires exactly the target's ${requiredPrintSpans[axis]} mm ${axis.toUpperCase()} verification span`,
      );
    }
  }
  const targetCutDimensionSamples = Array.isArray(input.targetCutDimensionSamples)
    ? input.targetCutDimensionSamples
    : [];
  const requiredCutDimensions = policy.calibrationAcceptance.targetCutDimensionsMm;
  for (const axis of ["x", "y"] as const) {
    const samples = targetCutDimensionSamples.filter((sample) => sample.axis === axis);
    const observedDimension = samples.length === 1
      ? ("protectedDimensionMm" in samples[0]! ? samples[0]!.protectedDimensionMm : samples[0]!.nominalDimensionMm)
      : undefined;
    if (samples.length !== 1 || observedDimension !== requiredCutDimensions[axis]) {
      addIssue(
        "targetCutDimensionSamples",
        `requires exactly the cut coupon's ${requiredCutDimensions[axis]} mm ${axis.toUpperCase()} dimension`,
      );
      continue;
    }
    const sample = samples[0]!;
    if ("protectedDimensionMm" in sample) {
      if (sample.authorityBasis !== "protected_checkerboard_geometry" ||
          sample.protectedDimensionMm !== requiredCutDimensions[axis] ||
          sample.targetVersion !== input.targetVersion || sample.targetSha256 !== input.targetSha256) {
        addIssue("targetCutDimensionSamples", "protected checkerboard cut authority must match the exact target identity");
      }
    } else if (!finitePositive(sample.measuredDimensionMm) ||
        !finitePositive(sample.measurementU95Mm) ||
        Math.abs(sample.measuredDimensionMm - sample.nominalDimensionMm) + sample.measurementU95Mm >
          policy.calibrationAcceptance.maxTargetCutDimensionErrorMm) {
        addIssue(
          "targetCutDimensionSamples",
          `cut-dimension error plus U95 must be <= ${policy.calibrationAcceptance.maxTargetCutDimensionErrorMm} mm`,
        );
    }
  }
  const lensValues = input.lensResidualSamples.map((sample) => sample.residualPx);
  const normalizationValues = input.normalizationResidualSamples.map((sample) => sample.residualPx);
  const placementX = input.repeatedPlacementSamples.map((sample) => sample.displacementXMm);
  const placementY = input.repeatedPlacementSamples.map((sample) => sample.displacementYMm);
  const boundaryValues = input.segmentationBoundarySamples.map(
    (sample) => sample.outerContourFitResidualPx,
  );
  if (lensValues.some((value) => !finiteNonnegative(value))) addIssue("lensResidualSamples", "residuals must be finite and nonnegative");
  if (normalizationValues.some((value) => !finiteNonnegative(value))) addIssue("normalizationResidualSamples", "residuals must be finite and nonnegative");
  if ([...placementX, ...placementY, ...boundaryValues].some((value) => !Number.isFinite(value))) {
    addIssue("repeatabilitySamples", "repeatability observations must be finite");
  }
  const lensResidualPx = rms(lensValues.filter(finiteNonnegative));
  const normalizationRegistrationResidualPx = rms(normalizationValues.filter(finiteNonnegative));
  const repeatedPlacementU95Mm = Math.max(
    coverageFactor * sampleStandardDeviation(placementX.filter(Number.isFinite)),
    coverageFactor * sampleStandardDeviation(placementY.filter(Number.isFinite)),
  );
  const finiteBoundaryValues = boundaryValues.filter(Number.isFinite);
  const segmentationBoundaryU95Px = Math.hypot(
    rms(finiteBoundaryValues),
    coverageFactor * sampleStandardDeviation(finiteBoundaryValues),
  );
  const repeatabilityPolicy = policy.calibrationAcceptance;
  const repeatabilityDefinitions = [
    ["linear_mm", "linearMm", repeatabilityPolicy.maximumMeasurementRepeatabilityU95.linearMm],
    ["area_mm2", "areaMm2", repeatabilityPolicy.maximumMeasurementRepeatabilityU95.areaMm2],
    ["relief_index", "reliefIndex", repeatabilityPolicy.maximumMeasurementRepeatabilityU95.reliefIndex],
    ["roughness_index", "roughnessIndex", repeatabilityPolicy.maximumMeasurementRepeatabilityU95.roughnessIndex],
    ["color_delta_e", "colorDeltaE", repeatabilityPolicy.maximumMeasurementRepeatabilityU95.colorDeltaE],
  ] as const;
  const measurementRepeatability = Object.fromEntries(
    repeatabilityDefinitions.map(([measurementClass, profileKey, limit]) => {
      const samples = input.measurementRepeatabilitySamples.filter(
        (sample) => sample.measurementClass === measurementClass,
      );
      const featureIds = new Set(samples.map((sample) => sample.referenceFeatureId));
      const values = samples.map((sample) => sample.measuredValue);
      const u95 = coverageFactor * sampleStandardDeviation(values.filter(Number.isFinite));
      if (
        samples.length < repeatabilityPolicy.minimumMeasurementRepeatabilitySamplesPerClass ||
        featureIds.size !== 1 ||
        values.some((value) => !finiteNonnegative(value)) ||
        !finitePositive(u95) ||
        u95 > limit
      ) {
        addIssue(
          `measurementRepeatabilitySamples.${measurementClass}`,
          `requires one repeated physical feature, at least ${repeatabilityPolicy.minimumMeasurementRepeatabilitySamplesPerClass} finite samples, and positive U95 <= ${limit}`,
        );
      }
      return [profileKey, { sampleCount: samples.length, u95: recorded(u95) }];
    }),
  ) as FixedRigPhysicalCalibrationArtifactV1["computed"]["measurementRepeatability"];
  const lensModel = input.lensModel;
  if (
    lensModel.model !== "opencv_brown_conrady_v1" ||
    !Number.isInteger(lensModel.sourceWidthPx) ||
    lensModel.sourceWidthPx <= 0 ||
    !Number.isInteger(lensModel.sourceHeightPx) ||
    lensModel.sourceHeightPx <= 0 ||
    lensModel.cameraMatrix.length !== 9 ||
    lensModel.cameraMatrix.some((value) => !Number.isFinite(value)) ||
    lensModel.distortionCoefficients.length < 4 ||
    lensModel.distortionCoefficients.length > 14 ||
    lensModel.distortionCoefficients.some((value) => !Number.isFinite(value)) ||
    !finiteNonnegative(lensModel.calibrationRmsPx) ||
    lensModel.perViewResidualPx.length !== input.lensResidualSamples.length ||
    lensModel.perViewResidualPx.some((value) => !finiteNonnegative(value))
  ) {
    addIssue("lensModel", "a finite Brown-Conrady model and one residual per lens view are required");
  } else {
    const recordedResiduals = input.lensResidualSamples.map((sample) => round(sample.residualPx));
    if (
      lensModel.perViewResidualPx.some(
        (value, index) => round(value) !== recordedResiduals[index],
      )
    ) {
      addIssue("lensModel.perViewResidualPx", "must exactly match the immutable lens residual samples");
    }
    if (lensModel.calibrationRmsPx > policy.calibrationAcceptance.maxLensResidualPx) {
      addIssue(
        "lensModel.calibrationRmsPx",
        `must be <= ${policy.calibrationAcceptance.maxLensResidualPx}`,
      );
    }
  }
  const normalizationModel = input.normalizationModel;
  if (
    normalizationModel.model !== "undistort_outer_cut_homography_with_fixed_holdout_repeatability_v1" ||
    normalizationModel.sampleResidualPx.length !== input.normalizationResidualSamples.length ||
    normalizationModel.sampleResidualPx.some((value) => !finiteNonnegative(value))
  ) {
    addIssue(
      "normalizationModel",
      "an undistort-plus-homography model and one residual per normalization sample are required",
    );
  } else if (
    normalizationModel.sampleResidualPx.some(
      (value, index) => round(value) !== round(input.normalizationResidualSamples[index]!.residualPx),
    )
  ) {
    addIssue(
      "normalizationModel.sampleResidualPx",
      "must exactly match the immutable normalization residual samples",
    );
  }
  const channelArtifacts = input.channels.map((channel, index) => {
    const deviation = maxFlatFieldDeviation(channel.relativeResponse);
    if (!Number.isFinite(deviation)) {
      addIssue(`channels.${index}.relativeResponse`, "flat-field response must contain finite positive samples");
    }
    const patternValues = Array.from(channel.expectedDirectionalResidual);
    const patternDimensionsValid =
      Number.isInteger(channel.illuminationPatternGridWidth) &&
      channel.illuminationPatternGridWidth > 0 &&
      Number.isInteger(channel.illuminationPatternGridHeight) &&
      channel.illuminationPatternGridHeight > 0 &&
      patternValues.length ===
        channel.illuminationPatternGridWidth * channel.illuminationPatternGridHeight;
    if (!patternDimensionsValid || patternValues.some((value) => !Number.isFinite(value))) {
      addIssue(
        `channels.${index}.expectedDirectionalResidual`,
        "illumination pattern must contain one finite residual per calibrated grid pixel",
      );
    }
    const maximumAbsoluteExpectedDirectionalResidual = patternValues.length &&
      patternValues.every(Number.isFinite)
      ? Math.max(...patternValues.map((value) => Math.abs(value)))
      : Number.POSITIVE_INFINITY;
    const directionMeasurement = deriveDirectionMeasurement(
      channel.directionMeasurementSamples,
      channel.directionValidationAngularErrorsDegrees,
      coverageFactor,
    );
    if (!directionMeasurement) {
      addIssue(
        `channels.${index}.directionMeasurementSamples`,
        "finite nonzero repeated physical direction measurements are required",
      );
    }
    if (
      channel.directionValidationAngularErrorsDegrees.some(
        (value) =>
          !finiteNonnegative(value) ||
          value > policy.calibrationAcceptance.maxIrradianceDirectionValidationErrorDegrees,
      )
    ) {
      addIssue(
        `channels.${index}.directionValidationAngularErrorsDegrees`,
        `geometry-to-irradiance direction validation must be <= ${policy.calibrationAcceptance.maxIrradianceDirectionValidationErrorDegrees} degrees`,
      );
    }
    if (
      channel.darkControlFrames.length <
      policy.calibrationAcceptance.minimumDarkControlFramesPerChannel
    ) {
      addIssue(
        `channels.${index}.darkControlFrames`,
        `requires at least ${policy.calibrationAcceptance.minimumDarkControlFramesPerChannel} exact dark-control frames`,
      );
    }
    return {
      channelIndex: channel.channelIndex,
      direction: directionMeasurement?.direction ?? { x: 0, y: 0 },
      directionConfidence: directionMeasurement?.confidence ?? 0,
      directionMeasurementSampleCount: channel.directionMeasurementSamples.length,
      directionAngularU95Degrees: recorded(
        directionMeasurement?.angularU95Degrees ?? Number.POSITIVE_INFINITY,
      ),
      directionSourceRadiusMm: recorded(
        directionMeasurement?.sourceRadiusMm ?? Number.POSITIVE_INFINITY,
      ),
      directionPointU95Mm: recorded(
        directionMeasurement?.pointU95Mm ?? Number.POSITIVE_INFINITY,
      ),
      directionValidationAngularErrorsDegrees: [
        ...channel.directionValidationAngularErrorsDegrees,
      ],
      directionMeasurementEvidence: channel.directionMeasurementSamples.map(
        (sample) => ({ ...sample }),
      ),
      flatFieldArtifactId: channel.flatFieldArtifactId,
      flatFieldArtifactSha256: channel.flatFieldArtifactSha256,
      flatFieldFrameCount: channel.flatFieldFrames.length,
      flatFieldFrameEvidence: channel.flatFieldFrames.map((frame) => ({ ...frame })),
      darkControlFrameCount: channel.darkControlFrames.length,
      darkControlFrameEvidence: channel.darkControlFrames.map((frame) => ({ ...frame })),
      maxFlatFieldDeviationFraction: recorded(deviation),
      responseScale: channel.responseScale,
      illuminationPatternArtifactId: channel.illuminationPatternArtifactId,
      illuminationPatternArtifactSha256: channel.illuminationPatternArtifactSha256,
      illuminationPatternFrameCount: channel.illuminationPatternFrames.length,
      illuminationPatternFrameEvidence: channel.illuminationPatternFrames.map((frame) => ({ ...frame })),
      illuminationPatternGridWidth: channel.illuminationPatternGridWidth,
      illuminationPatternGridHeight: channel.illuminationPatternGridHeight,
      maximumAbsoluteExpectedDirectionalResidual:
        recorded(maximumAbsoluteExpectedDirectionalResidual),
    };
  });
  const evidence = uniqueEvidence(input);
  const evidenceById = new Map<string, FixedRigCalibrationEvidenceReferenceV1>();
  for (const entry of evidence) {
    const prior = evidenceById.get(entry.evidenceId);
    if (prior && (prior.sha256 !== entry.sha256 || prior.role !== entry.role)) {
      addIssue(
        "evidence",
        `evidenceId ${entry.evidenceId} is reused with a different hash or role`,
      );
    } else {
      evidenceById.set(entry.evidenceId, entry);
    }
  }
  const artifactWithoutHash: Omit<FixedRigPhysicalCalibrationArtifactV1, "artifactSha256"> = {
    schemaVersion: "ai-grader-physical-calibration-artifact-v1",
    algorithmVersion: FIXED_RIG_PHYSICAL_CALIBRATION_V1_VERSION,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: input.artifactId,
    hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
    profileId: input.profileId,
    calibrationVersion: input.calibrationVersion,
    rigId: input.rigId,
    finalizedAt: input.finalizedAt,
    operatorId: input.operatorId,
    target: { version: input.targetVersion, sha256: input.targetSha256 },
    evidence,
    inputs: {
      scaleSamples: input.scaleSamples.map((sample) => ({ ...sample })),
      targetPrintScaleSamples: targetPrintScaleSamples.map((sample) => ({ ...sample })),
      targetCutDimensionSamples: targetCutDimensionSamples.map((sample) => ({ ...sample })),
      lensResidualSamples: input.lensResidualSamples.map((sample) => ({ ...sample })),
      normalizationResidualSamples: input.normalizationResidualSamples.map((sample) => ({ ...sample })),
      repeatedPlacementSamples: input.repeatedPlacementSamples.map((sample) => ({ ...sample })),
      segmentationBoundarySamples: input.segmentationBoundarySamples.map((sample) => ({ ...sample })),
      measurementRepeatabilitySamples: input.measurementRepeatabilitySamples.map(
        (sample) => ({ ...sample }),
      ),
      lensModel: {
        ...input.lensModel,
        cameraMatrix: [...input.lensModel.cameraMatrix],
        distortionCoefficients: [...input.lensModel.distortionCoefficients],
        perViewResidualPx: [...input.lensModel.perViewResidualPx],
      },
      normalizationModel: {
        ...input.normalizationModel,
        sampleResidualPx: [...input.normalizationModel.sampleResidualPx],
      },
      channels: channelArtifacts,
    },
    computed: {
      mmPerPixelX: recorded(mmPerPixelX),
      mmPerPixelY: recorded(mmPerPixelY),
      scaleRelativeU95: recorded(scaleRelativeU95),
      lensResidualPx: recorded(lensResidualPx),
      normalizationRegistrationResidualPx: recorded(normalizationRegistrationResidualPx),
      repeatedPlacementU95Mm: recorded(repeatedPlacementU95Mm),
      segmentationBoundaryU95Px: recorded(segmentationBoundaryU95Px),
      measurementRepeatability,
    },
    methods: policy.uncertainty,
  };
  const artifactSha256 = sha256Canonical(artifactWithoutHash);
  const artifact: FixedRigPhysicalCalibrationArtifactV1 = {
    ...artifactWithoutHash,
    artifactSha256,
  };
  const profileCandidate = {
    schemaVersion: MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
    profileId: input.profileId,
    calibrationVersion: input.calibrationVersion,
    rigId: input.rigId,
    isCalibrated: true,
    status: "finalized",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: input.artifactId,
    artifactSha256,
    finalizedAt: input.finalizedAt,
    normalizedWidthPx: input.normalizedWidthPx,
    normalizedHeightPx: input.normalizedHeightPx,
    mmPerPixelX: round(mmPerPixelX),
    mmPerPixelY: round(mmPerPixelY),
    scaleRelativeU95: round(scaleRelativeU95),
    scaleSampleCount: Math.min(xSamples.length, ySamples.length),
    lensCalibrationViewCount: input.lensResidualSamples.length,
    lensResidualPx: round(lensResidualPx),
    normalizationRegistrationSampleCount: input.normalizationResidualSamples.length,
    normalizationRegistrationResidualPx: round(normalizationRegistrationResidualPx),
    repeatedPlacementCount: input.repeatedPlacementSamples.length,
    repeatedPlacementU95Mm: round(repeatedPlacementU95Mm),
    segmentationBoundaryU95Px: round(segmentationBoundaryU95Px),
    segmentationBoundarySampleCount: input.segmentationBoundarySamples.length,
    measurementRepeatability: Object.fromEntries(
      Object.entries(measurementRepeatability).map(([key, value]) => [
        key,
        { sampleCount: value.sampleCount, u95: value.u95 },
      ]),
    ),
    channels: channelArtifacts.map((channel) => ({
      channelIndex: channel.channelIndex,
      direction: channel.direction,
      directionConfidence: channel.directionConfidence,
      directionMeasurementSampleCount: channel.directionMeasurementSampleCount,
      directionAngularU95Degrees: channel.directionAngularU95Degrees,
      directionSourceRadiusMm: channel.directionSourceRadiusMm,
      directionPointU95Mm: channel.directionPointU95Mm,
      flatFieldArtifactId: channel.flatFieldArtifactId,
      flatFieldArtifactSha256: channel.flatFieldArtifactSha256,
      flatFieldFrameCount: channel.flatFieldFrameCount,
      darkControlFrameCount: channel.darkControlFrameCount,
      maxFlatFieldDeviationFraction: channel.maxFlatFieldDeviationFraction,
      illuminationPatternArtifactId: channel.illuminationPatternArtifactId,
      illuminationPatternArtifactSha256: channel.illuminationPatternArtifactSha256,
      illuminationPatternFrameCount: channel.illuminationPatternFrameCount,
      responseScale: channel.responseScale,
    })),
  };
  const validation = validateMathematicalCalibrationProfileV1(profileCandidate);
  const issues = [...manualIssues, ...validation.issues];
  if (issues.length || !validation.profile) {
    return {
      status: "rejected",
      isCalibrated: false,
      profile: null,
      artifact,
      issues,
    };
  }
  return {
    status: "finalized",
    isCalibrated: true,
    profile: validation.profile,
    artifact,
    issues: [],
  };
}
