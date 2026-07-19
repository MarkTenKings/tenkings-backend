import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  combineMeasurementUncertaintyU95,
  validateMathematicalCalibrationProfileV1,
  type MathematicalCalibrationProfileV1,
  type MathematicalMeasurementKindV1,
  type MathematicalMeasurementUncertaintyComponentsV1,
} from "@tenkings/shared";

export const FIXED_RIG_MEASUREMENT_UNCERTAINTY_V1_VERSION =
  "fixed_rig_profile_derived_measurement_uncertainty_v1" as const;

export type FixedRigMeasurementAxisV1 = "x" | "y" | "isotropic";

export interface DeriveFixedRigMeasurementUncertaintyV1Input {
  calibration: MathematicalCalibrationProfileV1;
  kind: MathematicalMeasurementKindV1;
  measuredMeasurement: number;
  axis?: FixedRigMeasurementAxisV1;
}

export interface DerivedFixedRigMeasurementUncertaintyV1 {
  version: typeof FIXED_RIG_MEASUREMENT_UNCERTAINTY_V1_VERSION;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationSha256: string;
  kind: MathematicalMeasurementKindV1;
  axis: FixedRigMeasurementAxisV1;
  componentsU95: MathematicalMeasurementUncertaintyComponentsV1;
  u95: number;
  source: "finalized_calibration_profile";
  formula: string;
}

const LINEAR_KINDS = new Set<MathematicalMeasurementKindV1>([
  "length_mm",
  "width_mm",
  "depth_mm",
  "shape_deviation_mm",
  "margin_mm",
  "margin_difference_mm",
]);
const AREA_KINDS = new Set<MathematicalMeasurementKindV1>([
  "area_mm2",
  "deformation_area_mm2",
]);

function round(value: number): number {
  const factor = 1_000_000;
  return Math.sign(value) * Math.floor(Math.abs(value) * factor + 0.5 + Number.EPSILON) / factor;
}

function validatedProfile(value: MathematicalCalibrationProfileV1): MathematicalCalibrationProfileV1 {
  const validation = validateMathematicalCalibrationProfileV1(value);
  if (!validation.valid || !validation.isCalibrated || !validation.profile) {
    throw new Error(
      "Measurement uncertainty requires one finalized calibration profile satisfying every V1 acceptance gate.",
    );
  }
  return validation.profile;
}

function axisMmPerPixel(
  profile: MathematicalCalibrationProfileV1,
  axis: FixedRigMeasurementAxisV1,
): number {
  if (axis === "x") return profile.mmPerPixelX;
  if (axis === "y") return profile.mmPerPixelY;
  return Math.max(profile.mmPerPixelX, profile.mmPerPixelY);
}

function calibratedLightingFraction(profile: MathematicalCalibrationProfileV1): number {
  const maximumFlatFieldDeviation = Math.max(
    ...profile.channels.map((channel) => channel.maxFlatFieldDeviationFraction),
  );
  const minimumDirectionConfidence = Math.min(
    ...profile.channels.map((channel) => channel.directionConfidence),
  );
  return maximumFlatFieldDeviation + (1 - minimumDirectionConfidence);
}

function linearComponents(
  profile: MathematicalCalibrationProfileV1,
  measuredMeasurement: number,
  axis: FixedRigMeasurementAxisV1,
): MathematicalMeasurementUncertaintyComponentsV1 {
  const mmPerPixel = axisMmPerPixel(profile, axis);
  const lightingFraction = calibratedLightingFraction(profile);
  return {
    pixelMmScale: round(measuredMeasurement * profile.scaleRelativeU95),
    lensDistortion: round(profile.lensResidualPx * mmPerPixel),
    normalizationRegistration: round(profile.normalizationRegistrationResidualPx * mmPerPixel),
    repeatedPlacement: round(profile.repeatedPlacementU95Mm),
    segmentationBoundary: round(profile.segmentationBoundaryU95Px * mmPerPixel),
    measurementRepeatability: round(profile.measurementRepeatability.linearMm.u95),
    lightingChannelConfidence: round(mmPerPixel * lightingFraction),
  };
}

function areaComponents(
  profile: MathematicalCalibrationProfileV1,
  measuredAreaMm2: number,
  axis: FixedRigMeasurementAxisV1,
): MathematicalMeasurementUncertaintyComponentsV1 {
  const linear = linearComponents(profile, 0, axis);
  const propagate = (linearPositionU95Mm: number) =>
    round(2 * Math.sqrt(measuredAreaMm2) * linearPositionU95Mm);
  return {
    pixelMmScale: round(2 * measuredAreaMm2 * profile.scaleRelativeU95),
    lensDistortion: propagate(linear.lensDistortion),
    normalizationRegistration: propagate(linear.normalizationRegistration),
    repeatedPlacement: propagate(linear.repeatedPlacement),
    segmentationBoundary: propagate(linear.segmentationBoundary),
    measurementRepeatability: round(profile.measurementRepeatability.areaMm2.u95),
    lightingChannelConfidence: propagate(linear.lightingChannelConfidence),
  };
}

function dimensionlessComponents(
  profile: MathematicalCalibrationProfileV1,
  kind: "relief_index" | "roughness_index" | "delta_e",
): MathematicalMeasurementUncertaintyComponentsV1 {
  const repeatability = kind === "relief_index"
    ? profile.measurementRepeatability.reliefIndex.u95
    : kind === "roughness_index"
      ? profile.measurementRepeatability.roughnessIndex.u95
      : profile.measurementRepeatability.colorDeltaE.u95;
  return {
    pixelMmScale: 0,
    lensDistortion: 0,
    normalizationRegistration: 0,
    repeatedPlacement: 0,
    segmentationBoundary: 0,
    measurementRepeatability: round(repeatability),
    lightingChannelConfidence: round(
      kind === "delta_e"
        ? repeatability * calibratedLightingFraction(profile)
        : calibratedLightingFraction(profile),
    ),
  };
}

/**
 * Derive every U95 component from one accepted physical profile. Callers may
 * provide a measured value and an axis, but cannot supply or override an
 * uncertainty component. Evidence-quality limitations are handled before
 * scoring and therefore cannot be converted into a condition deduction here.
 */
export function deriveFixedRigMeasurementUncertaintyV1(
  input: DeriveFixedRigMeasurementUncertaintyV1Input,
): DerivedFixedRigMeasurementUncertaintyV1 {
  if (!Number.isFinite(input.measuredMeasurement) || input.measuredMeasurement < 0) {
    throw new RangeError("Measured measurement must be finite and nonnegative.");
  }
  const profile = validatedProfile(input.calibration);
  const axis = input.axis ?? "isotropic";
  let componentsU95: MathematicalMeasurementUncertaintyComponentsV1;
  let formula: string;
  if (LINEAR_KINDS.has(input.kind)) {
    componentsU95 = linearComponents(profile, input.measuredMeasurement, axis);
    formula = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.linearMeasurementU95Formula;
  } else if (AREA_KINDS.has(input.kind)) {
    componentsU95 = areaComponents(profile, input.measuredMeasurement, axis);
    formula = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.areaMeasurementU95Formula;
  } else if (
    input.kind === "relief_index" ||
    input.kind === "roughness_index" ||
    input.kind === "delta_e"
  ) {
    componentsU95 = dimensionlessComponents(profile, input.kind);
    formula = input.kind === "delta_e"
      ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.colorDeltaEMeasurementU95Formula
      : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.dimensionlessMeasurementU95Formula;
  } else {
    throw new RangeError(
      `${input.kind} uncertainty must be derived from its physical source measurements, not supplied as a free-standing scalar.`,
    );
  }
  return {
    version: FIXED_RIG_MEASUREMENT_UNCERTAINTY_V1_VERSION,
    calibrationProfileId: profile.profileId,
    calibrationVersion: profile.calibrationVersion,
    calibrationSha256: profile.artifactSha256,
    kind: input.kind,
    axis,
    componentsU95,
    u95: combineMeasurementUncertaintyU95(componentsU95),
    source: "finalized_calibration_profile",
    formula,
  };
}
