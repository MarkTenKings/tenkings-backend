const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repositoryRoot = path.resolve(__dirname, "..", "..", "..");

test("V1.0.1 runner and launcher require protected port, server displayed-frame authority, explicit retry, and restart resume", () => {
  const runner = fs.readFileSync(path.join(repositoryRoot, "scripts", "ai-grader", "run-mathematical-calibration-capture-v1.ps1"), "utf8");
  const launcher = fs.readFileSync(path.join(repositoryRoot, "scripts", "ai-grader", "open-mathematical-calibration-v1.ps1"), "utf8");
  assert.match(runner, /\[string\]\$BridgeUrl = 'http:\/\/127\.0\.0\.1:47653'/);
  assert.match(runner, /'Start', 'Resume', 'Advance', 'Retry'/);
  assert.match(runner, /function Get-DisplayedFrameCaptureAuthorization/);
  assert.match(runner, /\/calibration\/mathematical-v1\/capture-authorization/);
  assert.match(runner, /\$body\.captureAuthorizationId = \[string\]\$captureAuthorization\.authorizationId/);
  assert.doesNotMatch(runner, /previewBinding|latestFrameId -ne|Get-LivePreviewBinding/);
  assert.match(runner, /Use -Action Retry with a new operation ID/);
  assert.match(runner, /resume = \(\$Action -eq 'Resume'\)/);
  assert.match(launcher, /\$Port -ne 47653/);
  assert.match(launcher, /\/calibration\/mathematical-v1\?sessionId=/);
  assert.doesNotMatch(launcher, /47652/);
});

test("V1.0.1 runbook distinguishes ordinary retry from hard stop without weakening centralized thresholds", () => {
  const runbook = fs.readFileSync(path.join(repositoryRoot, "docs", "runbooks", "AI_GRADER_MATHEMATICAL_CALIBRATION_V1_RUNBOOK.md"), "utf8");
  assert.match(runbook, /coverage `>= 0\.30`/);
  assert.match(runbook, /X `>= 0\.07`, Y `>= 0\.08`, and rotation `>= 2 degrees`/);
  assert.match(runbook, /same exact slot remains pending/);
  assert.match(runbook, /-Action Retry/);
  assert.match(runbook, /-Action Resume/);
  assert.match(runbook, /missing\/wrong\/stale preview binding/);
  assert.match(runbook, /does not mutate or hard-stop the healthy authority session/);
  assert.match(runbook, /does not begin the camera\/lighting lifecycle/);
  assert.match(runbook, /hard-stops the session and is not retryable/);
});

test("the one-time blank timestamp recovery is local token-gated, fieldless, and absent from browser pages", () => {
  const runner = fs.readFileSync(path.join(repositoryRoot, "scripts", "ai-grader", "run-mathematical-calibration-capture-v1.ps1"), "utf8");
  const bridge = fs.readFileSync(path.join(repositoryRoot, "packages", "ai-grader-capture-helper", "src", "drivers", "aiGraderLocalStationBridge.ts"), "utf8");
  const v101Page = fs.readFileSync(path.join(repositoryRoot, "packages", "ai-grader-capture-helper", "src", "drivers", "mathematicalCalibrationV1_1Page.ts"), "utf8");
  assert.match(runner, /'RecoverBlankTimestampFalseStop'/);
  assert.match(runner, /recover-blank-reverse-timestamp-false-stop' -Body @\{\}/);
  assert.match(bridge, /recover-blank-reverse-timestamp-false-stop[\s\S]*tokenMatches\(req, config\)/);
  assert.match(bridge, /Object\.keys\(body\)\.length !== 0/);
  assert.match(bridge, /accepts no browser\/operator-authored recovery fields/);
  assert.doesNotMatch(v101Page, /recover-blank-reverse-timestamp-false-stop|RecoverBlankTimestampFalseStop/);
});

test("normal V1.0.1 flow derives all authority from protected target and immutable capture evidence without manual questions", () => {
  const runbook = fs.readFileSync(path.join(repositoryRoot, "docs", "runbooks", "AI_GRADER_MATHEMATICAL_CALIBRATION_V1_RUNBOOK.md"), "utf8");
  const runner = fs.readFileSync(path.join(repositoryRoot, "scripts", "ai-grader", "run-mathematical-calibration-capture-v1.ps1"), "utf8");
  const authorityDeriver = fs.readFileSync(path.join(repositoryRoot, "scripts", "ai-grader", "prepare-mathematical-calibration-repeatability-v1.py"), "utf8");
  const hardwareBridge = fs.readFileSync(path.join(repositoryRoot, "packages", "ai-grader-capture-helper", "scripts", "basler-pylon-bridge.ps1"), "utf8");
  const targetManifestText = fs.readFileSync(path.join(repositoryRoot, "output", "pdf", "ten-kings-mathematical-calibration-target-v1.json"), "utf8");
  const targetManifest = JSON.parse(targetManifestText);
  assert.match(runbook, /protected nominal checkerboard geometry/i);
  assert.match(runbook, /product_owner_confirmed_exact_target_geometry_v1/);
  assert.match(runbook, /no measuring-device, certificate, coordinate, or U95 input/i);
  assert.match(runner, /'DeriveAuthority'/);
  assert.match(runner, /Invoke-EvidenceAuthorityDerivation/);
  assert.match(runner, /if \(\$authorityKeys\.Count -ne 78\)/);
  assert.match(runner, /'PrepareRigInput'/);
  assert.match(runner, /\/calibration\/mathematical-v1\/materialization-input/);
  assert.match(runbook, /canonical_normalized_target_v1/);
  assert.match(runbook, /contains no stage matrix/);
  assert.match(runbook, /accepts only the session ID/);
  assert.match(hardwareBridge, /Mathematical calibration context terminal safe-off/);
  assert.match(hardwareBridge, /responseKinds = @\(\$SafeOffResponseKinds\)/);
  assert.doesNotMatch(runner, /CreateMetrologyTemplate|SubmitMetrology|MetrologyInputPath|measuredSpanMm|measuredDimensionMm|measurementU95Mm|sourcePointMm|cardCenterPointMm|pointU95Mm/);
  assert.match(authorityDeriver, /protected_checkerboard_geometry/);
  assert.match(authorityDeriver, /illumination_centroid_checkerboard_repeatability_v1/);
  assert.match(authorityDeriver, /requires exactly 102 captures/);
  assert.doesNotMatch(authorityDeriver, /fixed_ring_segment_geometry_with_ruler_v1|traceable_ruler|measuredSpanMm|measuredDimensionMm/);
  assert.equal(targetManifest.requiredPrintScaleVerification.authorityBasis, "protected_checkerboard_geometry");
  assert.equal(targetManifest.requiredPrintScaleVerification.operatorInputRequired, false);
  assert.equal(targetManifest.requiredCutDimensionVerification.authorityBasis, "protected_checkerboard_geometry");
  assert.equal(targetManifest.requiredCutDimensionVerification.operatorInputRequired, false);
  assert.doesNotMatch(targetManifestText, /measurementU95Required|measuredSpanMm|measuredDimensionMm|measurementU95Mm/);
});
