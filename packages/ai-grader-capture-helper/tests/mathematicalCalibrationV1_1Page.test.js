const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const {
  MATHEMATICAL_CALIBRATION_V1_PAGE_PATH,
  MATHEMATICAL_CALIBRATION_V1_PAGE_HTML,
  MATHEMATICAL_CALIBRATION_V1_1_PAGE_PATH,
  MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML,
} = require("../dist/drivers/mathematicalCalibrationV1_1Page");

function assertRenderedInlineScriptsCompile(html, pageName) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, `${pageName} must render at least one inline script`);
  for (const [index, match] of scripts.entries()) {
    assert.doesNotThrow(
      () => new vm.Script(match[1], { filename: `${pageName}-inline-${index + 1}.js` }),
      `${pageName} rendered inline script ${index + 1} must compile`,
    );
  }
}

test("rendered V1.0.1 and V1.1 operator-page inline scripts compile", () => {
  assertRenderedInlineScriptsCompile(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, "mathematical-calibration-v1.0.1");
  assertRenderedInlineScriptsCompile(MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML, "mathematical-calibration-v1.1");
});

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
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /const imageUrl=URL\.createObjectURL/);
  assert.equal(
    (MATHEMATICAL_CALIBRATION_V1_PAGE_HTML.match(/URL\.revokeObjectURL\(imageUrl\)/g) ?? []).length,
    2,
    "each preview Blob URL must be revoked on image load or error",
  );
  assert.match(MATHEMATICAL_CALIBRATION_V1_PAGE_HTML, /image\.onload=.*URL\.revokeObjectURL\(imageUrl\).*image\.onerror=.*URL\.revokeObjectURL\(imageUrl\)/s);
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
