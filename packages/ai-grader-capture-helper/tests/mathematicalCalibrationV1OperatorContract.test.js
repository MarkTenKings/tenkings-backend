const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repositoryRoot = path.resolve(__dirname, "..", "..", "..");

test("V1.0.1 runner and launcher require protected port, fresh preview authority, explicit retry, and restart resume", () => {
  const runner = fs.readFileSync(path.join(repositoryRoot, "scripts", "ai-grader", "run-mathematical-calibration-capture-v1.ps1"), "utf8");
  const launcher = fs.readFileSync(path.join(repositoryRoot, "scripts", "ai-grader", "open-mathematical-calibration-v1.ps1"), "utf8");
  assert.match(runner, /\[string\]\$BridgeUrl = 'http:\/\/127\.0\.0\.1:47653'/);
  assert.match(runner, /'Start', 'Resume', 'Advance', 'Retry'/);
  assert.match(runner, /function Get-LivePreviewBinding/);
  assert.match(runner, /contractVersion -ne '1\.0\.1'/);
  assert.match(runner, /\$body\.previewBinding = \$previewBinding/);
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

test("metrology derives protected target authority without device or certificate questions", () => {
  const runbook = fs.readFileSync(path.join(repositoryRoot, "docs", "runbooks", "AI_GRADER_MATHEMATICAL_CALIBRATION_V1_RUNBOOK.md"), "utf8");
  const runner = fs.readFileSync(path.join(repositoryRoot, "scripts", "ai-grader", "run-mathematical-calibration-capture-v1.ps1"), "utf8");
  assert.match(runbook, /abs\(measuredSpanMm - nominalSpanMm\) \+ measurementU95Mm <= 0\.20 mm/);
  assert.match(runbook, /product_owner_confirmed_exact_target_geometry_v1/);
  assert.match(runbook, /no measuring-device or calibration-certificate fields/i);
  assert.match(runner, /function Get-ProtectedTargetGeometryAuthority/);
  assert.match(runner, /product_owner_confirmed_exact_target_geometry_v1/);
  assert.doesNotMatch(runner, /product_owner_attested_device|ownerAttestation|manufacturer|serialNumber|maximumRangeMm|accuracyMm|resolutionMm|calibrationSha256/);
});
