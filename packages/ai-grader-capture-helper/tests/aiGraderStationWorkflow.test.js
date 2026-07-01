const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAiGraderLightingTuneRecommendation,
  buildAiGraderStationDiagnosticRulesV0,
  buildAiGraderStationRealCommandPlan,
  buildAiGraderStationWorkflowManifest,
  renderAiGraderStationWorkflowReport,
  runAiGraderStationRealWorkflow,
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

function realWorkflowInput(overrides = {}) {
  return {
    outputDir: path.join(os.tmpdir(), "ai-grader-station-real"),
    leimacHost: "169.254.191.156",
    leimacPort: 1000,
    exposureUs: 45000,
    gain: 0,
    markPresent: true,
    wiringConfirmed: true,
    leimacStatusGreen: true,
    operatorConfirmedLightIdleOff: true,
    operatorFlipConfirmed: true,
    operatorConfirmedFixtureRulersVisible: true,
    operatorConfirmedFinalLightOff: true,
    referenceType: "fixed_metric_rulers",
    horizontalSpanMm: 50.8,
    horizontalStartPx: { x: 540, y: 205 },
    horizontalEndPx: { x: 1620, y: 205 },
    verticalSpanMm: 50.8,
    verticalStartPx: { x: 2295, y: 145 },
    verticalEndPx: { x: 2295, y: 1218 },
    cardBoundaryRect: { x: 285, y: 349, width: 1878, height: 1350 },
    ...overrides,
  };
}

test("station real command plan orchestrates preview, front, back, unified report, and safe-off", () => {
  const plan = buildAiGraderStationRealCommandPlan(realWorkflowInput());
  assert.deepEqual(plan.map((step) => step.id), ["operator_preview", "capture_front", "capture_back", "unified_report", "safe_off"]);
  assert.equal(plan.find((step) => step.id === "operator_preview").args[0], "basler-fixed-rig-operator-preview");
  assert.equal(plan.find((step) => step.id === "capture_front").args.includes("--evidence-side"), true);
  assert.equal(plan.find((step) => step.id === "capture_back").args.includes("--operator-flip-confirmed"), true);
  assert.equal(plan.find((step) => step.id === "safe_off").args[0], "leimac-idmu-safe-off");
  assert.equal(plan.every((step) => step.command === "node"), true);
});

test("station real workflow succeeds with a fake runner and preserves front/back/report paths", async () => {
  const calls = [];
  const runner = {
    async run(step) {
      calls.push(step);
      if (step.id === "operator_preview") {
        return {
          stepId: step.id,
          ok: true,
          exitCode: 0,
          payload: {
            packageDir: "preview-package",
            acceptedLightingProfile: {
              selectedDutyPercent: 1.3,
              actualLeimacPwmStep: 13,
              selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
              profileSource: "operator_preview",
            },
          },
        };
      }
      if (step.id === "capture_front") return { stepId: step.id, ok: true, exitCode: 0, payload: { packageDir: "front-package" } };
      if (step.id === "capture_back") return { stepId: step.id, ok: true, exitCode: 0, payload: { packageDir: "back-package" } };
      if (step.id === "unified_report") {
        assert.equal(step.args.includes("front-package"), true);
        assert.equal(step.args.includes("back-package"), true);
        return { stepId: step.id, ok: true, exitCode: 0, payload: { report: { packageDir: "unified-report", reportPath: "unified-report/provisional-diagnostic-report.html" } } };
      }
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const result = await runAiGraderStationRealWorkflow(realWorkflowInput(), runner);
  assert.equal(result.status, "completed");
  assert.equal(result.frontPackageDir, "front-package");
  assert.equal(result.backPackageDir, "back-package");
  assert.equal(result.unifiedReportPath, "unified-report/provisional-diagnostic-report.html");
  assert.equal(result.acceptedLightingProfile.selectedDutyPercent, 1.3);
  assert.equal(calls.map((step) => step.id).join(","), "operator_preview,capture_front,capture_back,unified_report,safe_off");
});

test("station real workflow fails closed and safe-offs after a capture failure", async () => {
  const calls = [];
  const runner = {
    async run(step) {
      calls.push(step.id);
      if (step.id === "capture_front") return { stepId: step.id, ok: false, exitCode: 1, error: "front capture failed" };
      return { stepId: step.id, ok: true, exitCode: 0, payload: { packageDir: `${step.id}-package` } };
    },
  };
  const result = await runAiGraderStationRealWorkflow(realWorkflowInput(), runner);
  assert.equal(result.status, "blocked");
  assert.match(result.blocker, /front capture failed/);
  assert.equal(calls.includes("safe_off"), true);
  assert.equal(calls.includes("capture_back"), false);
});

test("station real workflow requires explicit supervised safety flags", async () => {
  await assert.rejects(
    () => runAiGraderStationRealWorkflow(realWorkflowInput({ markPresent: false }), { run: async () => ({ stepId: "safe_off", ok: true, exitCode: 0 }) }),
    /--mark-present/
  );
  await assert.rejects(
    () => runAiGraderStationRealWorkflow(realWorkflowInput({ operatorConfirmedFixtureRulersVisible: false }), { run: async () => ({ stepId: "safe_off", ok: true, exitCode: 0 }) }),
    /requires Confirm the fixed card fixture/
  );
});

test("station real workflow supports staged operator confirmations instead of fake startup flags", async () => {
  const prompts = [];
  const runner = {
    async run(step) {
      if (step.id === "operator_preview") return { stepId: step.id, ok: true, exitCode: 0, payload: { packageDir: "preview-package" } };
      if (step.id === "capture_front") return { stepId: step.id, ok: true, exitCode: 0, payload: { packageDir: "front-package" } };
      if (step.id === "capture_back") return { stepId: step.id, ok: true, exitCode: 0, payload: { packageDir: "back-package" } };
      if (step.id === "unified_report") return { stepId: step.id, ok: true, exitCode: 0, payload: { report: { packageDir: "report-package", reportPath: "report-package/provisional-diagnostic-report.html" } } };
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const result = await runAiGraderStationRealWorkflow(
    realWorkflowInput({
      operatorConfirmedLightIdleOff: false,
      operatorConfirmedFixtureRulersVisible: false,
      operatorFlipConfirmed: false,
      operatorConfirmedFinalLightOff: false,
      operatorPrompter: {
        async confirm(id) {
          prompts.push(id);
          return true;
        },
      },
    }),
    runner
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(prompts, ["light_idle_off", "fixture_rulers_visible", "flip_complete", "final_light_off"]);
  assert.equal(result.operatorConfirmations.every((confirmation) => confirmation.source === "interactive_prompt"), true);
  assert.equal(result.finalPhysicalRingLightOffConfirmed, true);
});

test("station CLI writes software-only manifest/report and gates hardware apply mode", async () => {
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
  assert.match(apply.stderr.error, /requires --confirm/);
});
