const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MATHEMATICAL_CALIBRATION_V1_1_PAGE_PATH,
  MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML,
} = require("../dist/drivers/mathematicalCalibrationV1_1Page");

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
