const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AI_GRADER_REPORT_BUNDLE_VERSION,
  buildAiGraderReportBundle,
  writeAiGraderReportBundle,
} = require("../dist/drivers/aiGraderReportBundle");
const {
  AI_GRADER_PRODUCTION_RELEASE_VERSION,
  buildAiGraderProductionRelease,
  writeAiGraderProductionRelease,
} = require("../dist/drivers/aiGraderProductionRelease");
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

function fixtureReportDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-report-bundle-fixture-"));
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        packageId: "report-fixture-1",
        frontPackageDir: path.join(dir, "front"),
        backPackageDir: path.join(dir, "back"),
        acceptedLightingProfile: { selectedDutyPercent: 1.3, actualLeimacPwmStep: 13, selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8] },
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(dir, "analysis.json"),
    JSON.stringify(
      {
        provisionalGradeStory: {
          status: "provisional_diagnostic_grade",
          provisionalOverallGrade: 8.5,
          confidence: { band: "low", score: 0.361, warnings: ["clipping accepted as warning"] },
          elementScores: {
            centering: { score: 10 },
            corners: { score: 8.97 },
            edges: { score: 8.97 },
            surface: { score: 5.5 },
          },
          story: { summary: "Evidence-linked story.", claims: [{ claim: "Surface limits grade.", evidenceRefs: ["visionLab.heatmap.back"] }] },
          whyNot10: [{ id: "surface", title: "Surface candidate", explanation: "Back surface candidate.", evidenceRefs: ["visionLab.heatmap.back"] }],
          gradeImpactCandidates: [
            {
              id: "back-surface-001",
              category: "surface",
              side: "back",
              severity: "high",
              confidence: "medium",
              sourceChannels: [3, 1, 6],
              evidenceRefs: ["back-surface-intelligence-v0-heatmap.png"],
            },
          ],
        },
        visionLab: {
          trueView: { front: "front-true-view.png", back: "back-true-view.png" },
          heatmap: { back: "back-surface-intelligence-v0-heatmap.png" },
          channelImages: ["front-channel-1.png", "back-channel-3.png"],
        },
      },
      null,
      2
    )
  );
  fs.mkdirSync(path.join(dir, "front"));
  fs.mkdirSync(path.join(dir, "back"));
  fs.writeFileSync(path.join(dir, "front", "front-all-on-portrait-display.png"), Buffer.from("front-image"));
  fs.writeFileSync(path.join(dir, "back", "back-all-on-portrait-display.png"), Buffer.from("back-image"));
  fs.writeFileSync(path.join(dir, "back-surface-intelligence-v0-heatmap.png"), Buffer.from("heatmap-image"));
  fs.writeFileSync(
    path.join(dir, "provisional-diagnostic-report.html"),
    `<html><body>Provisional Diagnostic - Not Certified - No Final Grade
<img src="${path.join(dir, "front", "front-all-on-portrait-display.png")}" alt="front">
<img src="${path.join(dir, "back", "back-all-on-portrait-display.png")}" alt="back">
</body></html>`
  );
  return dir;
}

test("report bundle exports web-ready provisional contract without final/certified claims", async () => {
  const reportDir = fixtureReportDir();
  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "fixture-report" });

  assert.equal(bundle.schemaVersion, AI_GRADER_REPORT_BUNDLE_VERSION);
  assert.equal(bundle.reportId, "fixture-report");
  assert.equal(bundle.reportStatus, "provisional_diagnostic_ready");
  assert.equal(bundle.provisionalGrade?.overall, 8.5);
  assert.equal(bundle.visionLab.available, true);
  assert.equal(bundle.visionLab.candidateCount, 1);
  assert.equal(bundle.assets.some((asset) => asset.kind === "image" && asset.fileName === "front-all-on-portrait-display.png"), true);
  assert.equal(bundle.finalGradeComputed, false);
  assert.equal(bundle.certifiedClaim, false);
  assert.equal(bundle.labelGenerated, false);
  assert.equal(bundle.qrGenerated, false);
  assert.equal(bundle.certificateGenerated, false);
  assert.match(bundle.limitations.join(" "), /No QR Certificate Yet/);
});

test("report bundle can include base64 image bodies for production publish", async () => {
  const reportDir = fixtureReportDir();
  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "fixture-report", includeAssetBodies: true });

  const frontImage = bundle.assets.find((asset) => asset.kind === "image" && asset.fileName === "front-all-on-portrait-display.png");
  assert.equal(frontImage?.contentType, "image/png");
  assert.equal(frontImage?.bodyEncoding, "base64");
  assert.equal(Buffer.from(frontImage?.bodyBase64 ?? "", "base64").toString("utf8"), "front-image");
  assert.equal(frontImage?.sha256, "635c727b41c225c9496e646413781d7c3aa11874287dd7a9d584911839f42999");
});

test("report bundle writer creates bundle, asset manifest, and checksums", async () => {
  const reportDir = fixtureReportDir();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-report-bundle-output-"));
  const result = await writeAiGraderReportBundle({ reportDir, outputDir, reportId: "fixture-report" });

  assert.equal(fs.existsSync(result.bundlePath), true);
  assert.equal(fs.existsSync(result.assetManifestPath), true);
  assert.equal(fs.existsSync(result.checksumsPath), true);
  const checksums = JSON.parse(fs.readFileSync(result.checksumsPath, "utf8"));
  assert.equal(checksums.checksums.some((entry) => entry.id === "report-html" && /^[a-f0-9]{64}$/.test(entry.sha256)), true);
});

test("report bundle CLI rejects repo output and writes software-only safety payload", async () => {
  const reportDir = fixtureReportDir();
  const repoOutput = await runCli(["ai-grader-report-bundle", "--report-dir", reportDir, "--output-dir", process.cwd()]);
  assert.equal(repoOutput.code, 1);
  assert.match(repoOutput.stderr.error, /outside the git repo/);

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-report-bundle-cli-"));
  const result = await runCli(["ai-grader-report-bundle", "--report-dir", reportDir, "--output-dir", outputDir, "--report-id", "cli-report"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.command, "ai-grader-report-bundle");
  assert.equal(result.stdout.bundle.reportId, "cli-report");
  assert.equal(result.stdout.safety.hardwareAccessed, false);
  assert.equal(result.stdout.safety.databaseWrites, false);
  assert.equal(result.stdout.safety.finalGradeComputed, false);
  assert.equal(fs.existsSync(result.stdout.reportBundlePath), true);
});

test("production release computes final AI-Grader V0 with label and QR data when warning gates are accepted", async () => {
  const reportDir = fixtureReportDir();
  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "production-fixture" });
  const release = buildAiGraderProductionRelease({
    bundle,
    operatorId: "mark",
    warningsAccepted: true,
    overrideReason: "Accepted V0 warning gates for production release test.",
    publicBaseUrl: "https://collect.tenkings.co",
  });

  assert.equal(release.schemaVersion, AI_GRADER_PRODUCTION_RELEASE_VERSION);
  assert.equal(release.reportStatus, "final_ai_grader_report_v0");
  assert.equal(release.finalGradeComputed, true);
  assert.equal(release.finalGrade.overall, 8.5);
  assert.equal(release.label.status, "label_data_ready");
  assert.equal(release.label.qrPayloadUrl, "https://collect.tenkings.co/ai-grader/reports/production-fixture");
  assert.equal(release.certifiedClaim, false);
  assert.equal(release.certificateGenerated, false);
  assert.equal(release.databaseIntegration.productionDbWritesPerformed, false);
  assert.equal(release.storageIntegration.uploadPerformed, false);
});

test("production release fails closed when required front/back evidence is missing", async () => {
  const reportDir = fixtureReportDir();
  fs.rmSync(path.join(reportDir, "front"), { recursive: true, force: true });
  fs.rmSync(path.join(reportDir, "back"), { recursive: true, force: true });
  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "missing-evidence" });
  bundle.evidenceReferences.frontEvidenceRefs = [];
  bundle.evidenceReferences.backEvidenceRefs = [];
  bundle.evidenceReferences.frontPackageDir = undefined;
  bundle.evidenceReferences.backPackageDir = undefined;
  const release = buildAiGraderProductionRelease({ bundle, warningsAccepted: true });

  assert.equal(release.reportStatus, "insufficient_evidence");
  assert.equal(release.finalGradeComputed, false);
  assert.equal(release.finalGrade.status, "insufficient_evidence");
  assert.equal(release.label.status, "blocked_insufficient_evidence");
  assert.equal(release.gates.some((gate) => gate.id === "front_evidence" && gate.status === "fail"), true);
});

test("production release writer and CLI write local publication artifacts without hardware or DB side effects", async () => {
  const reportDir = fixtureReportDir();
  const bundleOutput = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-production-bundle-"));
  const bundleResult = await writeAiGraderReportBundle({ reportDir, outputDir: bundleOutput, reportId: "release-cli" });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-production-release-"));
  const result = await writeAiGraderProductionRelease({
    reportBundlePath: bundleResult.bundlePath,
    outputDir,
    operatorId: "mark",
    warningsAccepted: true,
  });

  assert.equal(fs.existsSync(result.productionReleasePath), true);
  assert.equal(fs.existsSync(result.labelDataPath), true);
  assert.equal(fs.existsSync(result.publicationManifestPath), true);
  assert.equal(fs.existsSync(result.integrationContractPath), true);

  const repoOutput = await runCli(["ai-grader-production-release", "--report-bundle-path", bundleResult.bundlePath, "--output-dir", process.cwd()]);
  assert.equal(repoOutput.code, 1);
  assert.match(repoOutput.stderr.error, /outside the git repo/);

  const cliOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-production-release-cli-"));
  const cliResult = await runCli([
    "ai-grader-production-release",
    "--report-bundle-path",
    bundleResult.bundlePath,
    "--output-dir",
    cliOutputDir,
    "--operator-id",
    "mark",
    "--operator-accepted-warnings",
    "--override-reason",
    "Accepted warning gates for V0 release.",
  ]);
  assert.equal(cliResult.code, 0);
  assert.equal(cliResult.stdout.command, "ai-grader-production-release");
  assert.equal(cliResult.stdout.productionRelease.finalGradeComputed, true);
  assert.equal(cliResult.stdout.safety.hardwareAccessed, false);
  assert.equal(cliResult.stdout.safety.databaseWrites, false);
  assert.equal(cliResult.stdout.safety.certifiedClaim, false);
  assert.equal(fs.existsSync(cliResult.stdout.labelDataPath), true);
});
