import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
  aiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1Schema,
  combineMeasurementUncertaintyU95,
  type AiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1,
  type OperationallyUsableMathematicalCalibrationProfileV1 as OperationalCalibrationProfileV1,
  type MathematicalMeasurementKindV1,
  type MathematicalMeasurementUncertaintyComponentsV1,
} from "@tenkings/shared";
import { validateMathematicalCalibrationForOperationalUseV1 } from "./productOwnerOperationalAcceptanceV1";

export const FIXED_RIG_MEASUREMENT_UNCERTAINTY_V1_VERSION =
  "fixed_rig_owner_human_geometry_measurement_uncertainty_v1" as const;

export type FixedRigMeasurementAxisV1 = "x" | "y" | "isotropic";

export interface DeriveFixedRigMeasurementUncertaintyV1Input {
  calibration: OperationalCalibrationProfileV1;
  kind: MathematicalMeasurementKindV1;
  measuredMeasurement: number;
  axis?: FixedRigMeasurementAxisV1;
  /** Observable fraction of the exact ROI. Omit only for non-image measurements. */
  validEvidenceCoverage?: number;
  measurementUncertaintyAuthority?:
    AiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1;
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
  measurementUncertaintyAuthority:
    AiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1;
  source: "owner_approved_human_geometry_policy";
  formula: string;
  validEvidenceCoverage?: number;
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

function validatedProfile(value: OperationalCalibrationProfileV1): OperationalCalibrationProfileV1 {
  const result = validateMathematicalCalibrationForOperationalUseV1(value);
  if (
    !result.valid ||
    !result.profile ||
    (!result.isCalibrated && !result.isOperationallyAccepted)
  ) {
    throw new Error(
      "Calibration required: the supporting mathematical calibration profile is not operationally usable.",
    );
  }
  return result.profile;
}

function axisMmPerPixel(
  profile: OperationalCalibrationProfileV1,
  axis: FixedRigMeasurementAxisV1,
): number {
  if (axis === "x") return profile.mmPerPixelX;
  if (axis === "y") return profile.mmPerPixelY;
  return Math.max(profile.mmPerPixelX, profile.mmPerPixelY);
}

function calibratedLightingFraction(profile: OperationalCalibrationProfileV1): number {
  const maximumFlatFieldDeviation = Math.max(
    ...profile.channels.map((channel) => channel.maxFlatFieldDeviationFraction),
  );
  const minimumDirectionConfidence = Math.min(
    ...profile.channels.map((channel) => channel.directionConfidence),
  );
  return maximumFlatFieldDeviation + (1 - minimumDirectionConfidence);
}

function linearComponents(
  profile: OperationalCalibrationProfileV1,
  measuredMeasurement: number,
  axis: FixedRigMeasurementAxisV1,
  repeatedPlacementU95Mm: number,
): MathematicalMeasurementUncertaintyComponentsV1 {
  const mmPerPixel = axisMmPerPixel(profile, axis);
  const lightingFraction = calibratedLightingFraction(profile);
  return {
    pixelMmScale: round(measuredMeasurement * profile.scaleRelativeU95),
    lensDistortion: round(profile.lensResidualPx * mmPerPixel),
    normalizationRegistration: round(profile.normalizationRegistrationResidualPx * mmPerPixel),
    repeatedPlacement: round(repeatedPlacementU95Mm),
    segmentationBoundary: round(profile.segmentationBoundaryU95Px * mmPerPixel),
    measurementRepeatability: round(profile.measurementRepeatability.linearMm.u95),
    lightingChannelConfidence: round(mmPerPixel * lightingFraction),
  };
}

function areaComponents(
  profile: OperationalCalibrationProfileV1,
  measuredAreaMm2: number,
  axis: FixedRigMeasurementAxisV1,
  repeatedPlacementU95Mm: number,
): MathematicalMeasurementUncertaintyComponentsV1 {
  const linear = linearComponents(profile, 0, axis, repeatedPlacementU95Mm);
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
  profile: OperationalCalibrationProfileV1,
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
 * Derive U95 from one operationally usable supporting profile while binding
 * repeated placement to the exact owner-approved Human Geometry policy.
 * Callers cannot supply or override any uncertainty component.
 */
export function deriveFixedRigMeasurementUncertaintyV1(
  input: DeriveFixedRigMeasurementUncertaintyV1Input,
): DerivedFixedRigMeasurementUncertaintyV1 {
  if (!Number.isFinite(input.measuredMeasurement) || input.measuredMeasurement < 0) {
    throw new RangeError("Measured measurement must be finite and nonnegative.");
  }
  const profile = validatedProfile(input.calibration);
  const measurementUncertaintyAuthority =
    aiGraderOwnerHumanGeometryMeasurementUncertaintyAuthorityV1Schema.parse(
      input.measurementUncertaintyAuthority ??
        AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
    );
  const axis = input.axis ?? "isotropic";
  let componentsU95: MathematicalMeasurementUncertaintyComponentsV1;
  let formula: string;
  if (LINEAR_KINDS.has(input.kind)) {
    componentsU95 = linearComponents(
      profile,
      input.measuredMeasurement,
      axis,
      measurementUncertaintyAuthority.repeatedPlacementU95Mm,
    );
    formula = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.linearMeasurementU95Formula;
  } else if (AREA_KINDS.has(input.kind)) {
    componentsU95 = areaComponents(
      profile,
      input.measuredMeasurement,
      axis,
      measurementUncertaintyAuthority.repeatedPlacementU95Mm,
    );
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
  if (input.validEvidenceCoverage !== undefined) {
    if (
      !Number.isFinite(input.validEvidenceCoverage) ||
      input.validEvidenceCoverage <= 0 ||
      input.validEvidenceCoverage > 1
    ) {
      throw new RangeError(
        "Valid evidence coverage must be greater than zero and no greater than one.",
      );
    }
    const coveragePenalty =
      componentsU95.segmentationBoundary *
      (1 - input.validEvidenceCoverage) /
      Math.sqrt(input.validEvidenceCoverage);
    componentsU95 = {
      ...componentsU95,
      segmentationBoundary: round(
        Math.hypot(
          componentsU95.segmentationBoundary,
          coveragePenalty,
        ),
      ),
    };
    formula +=
      "; segmentation boundary U95 is expanded by the observed ROI coverage";
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
    measurementUncertaintyAuthority:
      structuredClone(measurementUncertaintyAuthority),
    source: "owner_approved_human_geometry_policy",
    formula:
      formula +
      "; repeated-placement U95 is the owner-approved 0.05 mm grading policy, not a claim of new empirical calibration",
    ...(input.validEvidenceCoverage !== undefined
      ? { validEvidenceCoverage: round(input.validEvidenceCoverage) }
      : {}),
  };
}
