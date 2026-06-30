const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAiGraderLightingTuneRecommendation,
  buildAiGraderStationDiagnosticRulesV0,
  buildAiGraderStationWorkflowManifest,
  renderAiGraderStationWorkflowReport,
} = require("../dist/drivers/aiGraderStationWorkflow");
const { runCaptureHelperCli } = require("../dist/cli");

async function runCli(argv) {
  let stdout = "";
  let stderr = "";
  const code = await runCaptureHelperCli(argv, {
    env: {},
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });
  return {
    code,
    stdout: stdout ? JSON.parse(stdout) : null,
    stderr: stderr ? JSON.parse(stderr) : null,
  };
}

test("station workflow exposes guided fixed-rig operator states without hardware access", () => {
  const manifest = buildAiGraderStationWorkflowManifest({
    mockRun: false,
    frontClippedFraction: 0.107932,
    backClippedFraction: 0.337672,
  });

  assert.equal(manifest.workflowVersion, "ai-grader-station-operator-workflow-v0.1");
  assert.equal(manifest.states.map((state) => state.id).join(","), [
    "start_new_card",
    "verify_fixture_rulers",
    "live_preview_focus_framing",
    "lighting_exposure_tune",
    "accept_capture_profile",
    "capture_front",
    "prompt_flip_card",
    "capture_back",
    "run_provisional_diagnostics",
    "view_unified_report",
    "rerun_if_warnings",
    "export_open_report",
    "safe_off_end_session",
  ].join(","));
  assert.equal(manifest.states.find((state) => state.id === "capture_front").status, "blocked");
  assert.equal(manifest.states.find((state) => state.id === "prompt_flip_card").hardwareAccess, false);
  assert.equal(manifest.hardwareAcceptance.status, "pending_mark_present");
  assert.equal(manifest.safety.hardwareAccessed, false);
  assert.equal(manifest.safety.leimacContacted, false);
  assert.equal(manifest.safety.finalGradeComputed, false);
  assert.equal(manifest.safety.certificateGenerated, false);
});

test("lighting tune recommends lower duty when PR40 clipping is high", () => {
  const recommendation = buildAiGraderLightingTuneRecommendation({
    frontMetrics: { clippedFraction: 0.107932 },
    backMetrics: { clippedFraction: 0.337672 },
  });

  assert.equal(recommendation.status, "needs_tuning");
  assert.equal(recommendation.operatorMustExplicitlyAcceptWarnings, true);
  assert.equal(recommendation.recommendedProfile.selectedDutyPercent < recommendation.currentProfile.selectedDutyPercent, true);
  assert.equal(recommendation.recommendedProfile.actualLeimacPwmStep, Math.round(recommendation.recommendedProfile.selectedDutyPercent * 10));
  assert.match(recommendation.warnings.join(" "), /Clipping exceeds/);

  const accepted = buildAiGraderLightingTuneRecommendation({
    frontMetrics: { clippedFraction: 0.107932 },
    backMetrics: { clippedFraction: 0.337672 },
    operatorAcceptedWarnings: true,
  });
  assert.equal(accepted.status, "accepted_with_warnings");
});

test("diagnostic rules are provisional and fail closed when gates are missing", () => {
  const missing = buildAiGraderStationDiagnosticRulesV0();
  assert.equal(missing.finalGradeComputed, false);
  assert.equal(missing.certificateGenerated, false);
  assert.equal(missing.certifiedClaim, false);
  assert.equal(missing.elements.every((element) => element.status === "insufficient_evidence"), true);

  const computed = buildAiGraderStationDiagnosticRulesV0({
    calibrationProfilePresent: true,
    framingOverlayPass: true,
    repeatabilityPass: true,
    frontEvidenceComplete: true,
    backEvidenceComplete: true,
  });
  assert.equal(computed.elements.every((element) => element.status === "provisional_diagnostic"), true);
  assert.equal(computed.elements.every((element) => element.confidence === "medium"), true);
});

test("station report has premium provisional structure and no generated grade artifacts", () => {
  const manifest = buildAiGraderStationWorkflowManifest({
    mockRun: true,
    calibrationProfileId: "fixed-ruler-pr39",
    framingOverlayPass: true,
    repeatabilityPass: true,
    frontPackageDir: "front",
    backPackageDir: "back",
  });
  const report = renderAiGraderStationWorkflowReport(manifest);

  assert.match(report, /Ten Kings AI Grader Station/);
  assert.match(report, /Diagnostic Grade Pending/);
  assert.match(report, /Provisional Diagnostic - Not Certified - No Final Grade/);
  assert.match(report, /Operator Workflow/);
  assert.match(report, /Lighting \/ Exposure Tune/);
  assert.match(report, /Provisional Diagnostic Rules V0/);
  assert.match(report, /Future Integration Contract/);
  assert.equal(manifest.integrationContract.labelGenerated, false);
  assert.equal(manifest.integrationContract.qrGenerated, false);
  assert.equal(manifest.integrationContract.certificateGenerated, false);
  assert.equal(manifest.integrationContract.finalStatus, "not_computed");
});

test("station CLI writes software-only manifest/report and rejects hardware apply mode", async () => {
  const outputDir = path.join(os.tmpdir(), "ai-grader-station");
  const result = await runCli([
    "ai-grader-station-operator-workflow",
    "--output-dir",
    outputDir,
    "--mock-run",
    "--duty",
    "1.2",
    "--exposure-us",
    "45000",
    "--front-clipped-fraction",
    "0.107932",
    "--back-clipped-fraction",
    "0.337672",
    "--calibration-profile-id",
    "fixed-ruler-pr39",
    "--mm-per-pixel-x",
    "0.047037",
    "--mm-per-pixel-y",
    "0.047344",
    "--framing-overlay-pass",
    "--repeatability-pass",
    "--front-dir",
    path.join(os.tmpdir(), "front"),
    "--back-dir",
    path.join(os.tmpdir(), "back"),
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.stdout.safety.hardwareAccessed, false);
  assert.equal(result.stdout.hardwareSmokeStatus, "pending_mark_present");
  assert.equal(fs.existsSync(result.stdout.reportPath), true);
  assert.equal(fs.existsSync(result.stdout.manifestPath), true);
  assert.equal(fs.existsSync(result.stdout.contractPath), true);
  assert.match(fs.readFileSync(result.stdout.reportPath, "utf8"), /Clipping exceeds/);

  const repoOutput = await runCli([
    "ai-grader-station-operator-workflow",
    "--output-dir",
    process.cwd(),
  ]);
  assert.equal(repoOutput.code, 1);
  assert.match(repoOutput.stderr.error, /outside the git repo/);

  const apply = await runCli([
    "ai-grader-station-operator-workflow",
    "--apply",
  ]);
  assert.equal(apply.code, 1);
  assert.match(apply.stderr.error, /hardware execution is intentionally pending/);
});
