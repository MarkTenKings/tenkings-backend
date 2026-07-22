const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MATHEMATICAL_CALIBRATION_V1_PAGE_PATH,
  MATHEMATICAL_CALIBRATION_V1_PAGE_HTML,
  MATHEMATICAL_CALIBRATION_V1_1_PAGE_PATH,
  MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML,
} = require("../dist/drivers/mathematicalCalibrationV1_1Page");

test("V1.0.1 operator page is session-bound, read-only, and exposes pose, aggregate, accepted, and failed evidence", () => {
  assert.equal(MATHEMATICAL_CALIBRATION_V1_PAGE_PATH, "/calibration/mathematical-v1");
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /X-AI-Grader-Station-Token/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /X-AI-Grader-Mathematical-Calibration-Session-Id/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /nextCaptureSlot/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /poseProgress/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /acceptedCaptureHistory/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /failedAttempts/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /Advisory positioning only/i);
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /Reconnect fresh preview epoch/);
  assert.doesNotMatch(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /\/capture["']/);
  assert.doesNotMatch(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /stationToken=/i);
});

test("calibration-only page is bridge-served, paired without URL token, and renders the required overlay fields", () => {
  assert.equal(MATHEMATICAL_CALIBRATION_V1_1_PAGE_PATH, "/calibration/mathematical-v1.1");
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /X-AI-Grader-Station-Token/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /X-AI-Grader-Mathematical-Calibration-Session-Id/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /preview\/stream/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /location\.hash\.match\(\/\(\?:\^\|\[#&\]\)aiGraderBridgePair=/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /outerContour/);
  assert.match(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /sufficientlyDistinct/);
  assert.doesNotMatch(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /stationToken=/i);
  assert.doesNotMatch(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, /token=.*location\.search/i);
});
