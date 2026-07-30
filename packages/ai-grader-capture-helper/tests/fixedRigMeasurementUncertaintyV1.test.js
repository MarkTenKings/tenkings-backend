const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
  combineMeasurementUncertaintyU95,
  effectiveMeasurementV1,
} = require("../../shared/dist");
const {
  deriveFixedRigMeasurementUncertaintyV1,
} = require("../dist/drivers/fixedRigMeasurementUncertaintyV1");

const SHA = "a".repeat(64);

function profile() {
  return {
    schemaVersion: "ai-grader-mathematical-calibration-profile-v1",
    profileId: "uncertainty-profile-v1",
    calibrationVersion: "uncertainty-v1.0.0",
    rigId: "uncertainty-test-rig-v1",
    isCalibrated: true,
    status: "finalized",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: "uncertainty-artifact-v1",
    artifactSha256: SHA,
    finalizedAt: "2026-07-18T12:00:00.000Z",
    normalizedWidthPx: 635,
    normalizedHeightPx: 889,
    mmPerPixelX: 0.1,
    mmPerPixelY: 0.1,
    scaleRelativeU95: 0.001,
    scaleSampleCount: 10,
    lensCalibrationViewCount: 10,
    lensResidualPx: 0.1,
    normalizationRegistrationResidualPx: 0.2,
    normalizationRegistrationSampleCount: 10,
    repeatedPlacementCount: 10,
    repeatedPlacementU95Mm: 0.01,
    segmentationBoundaryU95Px: 0.2,
    segmentationBoundarySampleCount: 10,
    measurementRepeatability: {
      linearMm: { sampleCount: 10, u95: 0.03 },
      areaMm2: { sampleCount: 10, u95: 0.04 },
      reliefIndex: { sampleCount: 10, u95: 0.02 },
      roughnessIndex: { sampleCount: 10, u95: 0.03 },
      colorDeltaE: { sampleCount: 10, u95: 0.2 },
    },
    channels: Array.from({ length: 8 }, (_, index) => ({
      channelIndex: index + 1,
      direction: { x: Math.cos(index * Math.PI / 4), y: Math.sin(index * Math.PI / 4) },
      directionConfidence: 1,
      directionMeasurementSampleCount: 3,
      directionAngularU95Degrees: 0,
      directionSourceRadiusMm: 100,
      directionPointU95Mm: 0.1,
      flatFieldArtifactId: `flat-field-${index + 1}`,
      flatFieldArtifactSha256: SHA,
      flatFieldFrameCount: 3,
      darkControlFrameCount: 3,
      maxFlatFieldDeviationFraction: 0.02,
      illuminationPatternArtifactId: "illumination-pattern-v1",
      illuminationPatternArtifactSha256: SHA,
      illuminationPatternFrameCount: 3,
      responseScale: 1,
    })),
  };
}

test("linear U95 is derived from every certified profile source and has no caller override", () => {
  const input = {
    calibration: profile(),
    kind: "length_mm",
    measuredMeasurement: 2,
    axis: "x",
    uncertaintyComponentsU95: {
      pixelMmScale: 99,
      lensDistortion: 99,
      normalizationRegistration: 99,
      repeatedPlacement: 99,
      segmentationBoundary: 99,
      measurementRepeatability: 99,
      lightingChannelConfidence: 99,
    },
  };
  const derived = deriveFixedRigMeasurementUncertaintyV1(input);
  assert.deepEqual(derived.componentsU95, {
    pixelMmScale: 0.002,
    lensDistortion: 0.01,
    normalizationRegistration: 0.02,
    repeatedPlacement: 0.05,
    segmentationBoundary: 0.02,
    measurementRepeatability: 0.03,
    lightingChannelConfidence: 0.002,
  });
  assert.equal(derived.u95, 0.065635);
  assert.equal(derived.source, "owner_approved_human_geometry_policy");
  assert.deepEqual(
    derived.measurementUncertaintyAuthority,
    AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
  );
});

test("area and dimensionless U95 use their class repeatability and manifest propagation", () => {
  const area = deriveFixedRigMeasurementUncertaintyV1({
    calibration: profile(), kind: "area_mm2", measuredMeasurement: 4,
  });
  assert.deepEqual(area.componentsU95, {
    pixelMmScale: 0.008,
    lensDistortion: 0.04,
    normalizationRegistration: 0.08,
    repeatedPlacement: 0.2,
    segmentationBoundary: 0.08,
    measurementRepeatability: 0.04,
    lightingChannelConfidence: 0.008,
  });
  assert.equal(area.u95, combineMeasurementUncertaintyU95(area.componentsU95));

  const relief = deriveFixedRigMeasurementUncertaintyV1({
    calibration: profile(), kind: "relief_index", measuredMeasurement: 0.5,
  });
  assert.equal(relief.componentsU95.measurementRepeatability, 0.02);
  assert.equal(relief.componentsU95.lightingChannelConfidence, 0.02);
  assert.equal(relief.u95, 0.028284);

  const color = deriveFixedRigMeasurementUncertaintyV1({
    calibration: profile(), kind: "delta_e", measuredMeasurement: 3,
  });
  assert.equal(color.componentsU95.measurementRepeatability, 0.2);
  assert.equal(color.componentsU95.lightingChannelConfidence, 0.004);
});

test("unfinalized or incomplete profiles fail closed", () => {
  const invalid = profile();
  delete invalid.measurementRepeatability.colorDeltaE;
  assert.throws(
    () => deriveFixedRigMeasurementUncertaintyV1({
      calibration: invalid, kind: "length_mm", measuredMeasurement: 1,
    }),
    /Calibration required/,
  );
});

test("rejected 4.306362 mm emergency calibration cannot erase sub-4.3 mm defects", () => {
  const rejected = profile();
  rejected.isCalibrated = false;
  rejected.status = "rejected";
  rejected.repeatedPlacementU95Mm = 4.306362;
  assert.throws(
    () => deriveFixedRigMeasurementUncertaintyV1({
      calibration: rejected,
      kind: "shape_deviation_mm",
      measuredMeasurement: 0.4,
    }),
    /supporting mathematical calibration profile is not operationally usable/,
  );
});

test("accepted normal calibration preserves uncertainty without erasing a legitimate defect", () => {
  const accepted = profile();
  accepted.repeatedPlacementU95Mm = 0.02;
  const result = deriveFixedRigMeasurementUncertaintyV1({
    calibration: accepted,
    kind: "shape_deviation_mm",
    measuredMeasurement: 0.4,
  });
  assert.ok(result.u95 > 0, "accepted calibration must preserve U95 protection");
  assert.ok(
    effectiveMeasurementV1(0.4, result.u95) > 0.3,
    "the owner-policy U95 must preserve the real 0.4 mm deviation",
  );
  assert.equal(result.componentsU95.repeatedPlacement, 0.05);
  assert.equal(
    result.measurementUncertaintyAuthority.policyId,
    "owner_human_geometry_measurement_uncertainty_v1",
  );
  assert.equal(accepted.repeatedPlacementU95Mm, 0.02);
});
