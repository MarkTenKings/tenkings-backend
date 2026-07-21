const test = require("node:test");
const assert = require("node:assert/strict");

const shared = require("@tenkings/shared");
const {
  assessMathematicalCalibrationV1_1Preview,
  conservativeSmallSampleU95,
  validateFourPoseEvidence,
} = require("../dist/drivers/fixedRigMathematicalCalibrationV1_1.js");

function corners(x, y, width = 700, height = 900) {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

function pose(index) {
  const current = corners(100 + index * 80, 120 + index * 90);
  const assessment = assessMathematicalCalibrationV1_1Preview({
    corners: current,
    imageWidth: 1200,
    imageHeight: 1680,
    rotationDegrees: index * 3,
    acceptedPoses: [],
  });
  return {
    evidenceId: `placement-${index}`,
    centerXFraction: assessment.center.xFraction,
    centerYFraction: assessment.center.yFraction,
    coverageFraction: assessment.coverageFraction,
    rotationDegrees: assessment.rotationDegrees,
    cornerSignature: [],
    imageWidth: 1200,
    imageHeight: 1680,
    corners: current,
  };
}

test("V1.1 threshold identity is distinct and V1.0.1 remains unchanged", () => {
  assert.equal(shared.MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID, "ten-kings-mathematical-grading-v1.0.1");
  assert.equal(shared.MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_ID, "ten-kings-mathematical-grading-v1.1.0");
  assert.equal(shared.MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST.calibrationAcceptance.minimumLensCalibrationViews, 4);
  assert.equal(shared.MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST.calibrationAcceptance.minimumNormalizationRegistrations, 4);
  assert.equal(shared.MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST.calibrationAcceptance.minimumRepeatedPlacements, 4);
  assert.equal(shared.MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount, 8);
  assert.equal(shared.MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_MANIFEST.calibrationAcceptance.minimumFlatFieldFramesPerChannel, 3);
  assert.notEqual(shared.MATHEMATICAL_CALIBRATION_V1_1_THRESHOLD_SET_HASH, shared.MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH);
});

test("preview fails closed at zero outer-corner coordinates and exposes the overlay contract", () => {
  const invalid = assessMathematicalCalibrationV1_1Preview({
    corners: corners(0, 100),
    imageWidth: 1200,
    imageHeight: 1680,
    rotationDegrees: 0,
    acceptedPoses: [],
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.reasons.join(" "), /unsafe frame margin/);

  const valid = assessMathematicalCalibrationV1_1Preview({
    corners: corners(180, 180),
    imageWidth: 1200,
    imageHeight: 1680,
    rotationDegrees: 2,
    acceptedPoses: [],
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.sufficientlyDistinct, true);
  assert.equal(valid.nextPlacementIndex, 1);
  assert.deepEqual(Object.keys(valid.center).sort(), ["xFraction", "yFraction"]);
});

test("four-pose validation references each immutable placement exactly once", () => {
  const poses = [0, 1, 2, 3].map(pose);
  const evidence = poses.map((entry) => ({
    evidenceId: entry.evidenceId,
    sha256: entry.evidenceId.padEnd(64, "0"),
    roles: ["geometry", "normalization_holdout", "segmentation_boundary", "repeated_placement"],
  }));
  const accepted = validateFourPoseEvidence({ poses, evidence, leaveOnePoseOutResiduals: [0.21, 0.22, 0.23, 0.24] });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.poseCount, 4);
  assert.equal(accepted.uniqueEvidenceCount, 4);
  assert.ok(accepted.holdoutU95 > 0);

  const duplicate = validateFourPoseEvidence({ poses, evidence: [...evidence.slice(0, 3), evidence[0]], leaveOnePoseOutResiduals: [0.21, 0.22, 0.23, 0.24] });
  assert.equal(duplicate.accepted, false);
  assert.match(duplicate.reasons.join(" "), /duplicated or inflated/);
});

test("small-sample U95 uses the conservative Student-t multiplier", () => {
  const result = conservativeSmallSampleU95([0.21, 0.22, 0.23, 0.24]);
  assert.ok(Math.abs(result - 0.04108520513521758) < 1e-12);
  assert.throws(() => conservativeSmallSampleU95([0.2, 0.21, 0.22]), /exactly four/);
});
