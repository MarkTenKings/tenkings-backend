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
  fs.writeFileSync(path.join(dir, "provisional-diagnostic-report.html"), "<html><body>Provisional Diagnostic - Not Certified - No Final Grade</body></html>");
  fs.mkdirSync(path.join(dir, "front"));
  fs.mkdirSync(path.join(dir, "back"));
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
  assert.equal(bundle.finalGradeComputed, false);
  assert.equal(bundle.certifiedClaim, false);
  assert.equal(bundle.labelGenerated, false);
  assert.equal(bundle.qrGenerated, false);
  assert.equal(bundle.certificateGenerated, false);
  assert.match(bundle.limitations.join(" "), /No QR Certificate Yet/);
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
