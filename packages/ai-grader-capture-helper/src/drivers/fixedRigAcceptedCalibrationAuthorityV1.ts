import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  validateMathematicalCalibrationProfileV1,
  type MathematicalCalibrationProfileV1,
} from "@tenkings/shared";

export const FIXED_RIG_ACCEPTED_CALIBRATION_AUTHORITY_V1_VERSION =
  "fixed_rig_accepted_calibration_authority_v1" as const;

export const FIXED_RIG_CALIBRATION_REQUIRED_MESSAGE =
  "Calibration required: Production grading accepts only a finalized, isCalibrated=true profile satisfying every Mathematical Calibration V1 acceptance gate. Run the owner-operated fixed-rig recalibration workflow, capture the required checkerboard, placement, boundary, lighting, and repeatability evidence, analyze it, finalize only a passing bundle, then activate that exact finalized bundle before grading." as const;

/**
 * Grading authority is intentionally narrower than the historical emergency
 * operational-acceptance contract. A rejected or isCalibrated=false profile
 * can remain inspectable evidence, but it cannot authorize measurement.
 */
export function requireAcceptedFixedRigCalibrationAuthorityV1(
  value: unknown,
): MathematicalCalibrationProfileV1 {
  const validation = validateMathematicalCalibrationProfileV1(value);
  if (!validation.valid || !validation.isCalibrated || !validation.profile) {
    const observed = value && typeof value === "object"
      ? (value as { repeatedPlacementU95Mm?: unknown }).repeatedPlacementU95Mm
      : undefined;
    const observedNote = typeof observed === "number"
      ? ` Observed repeated-placement U95 was ${observed} mm; the active acceptance limit is ${MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.maxPlacementU95Mm} mm.`
      : "";
    throw new Error(FIXED_RIG_CALIBRATION_REQUIRED_MESSAGE + observedNote);
  }
  return validation.profile;
}
