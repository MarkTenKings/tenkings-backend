const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
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
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const REPLACEMENT_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6S8AAAAASUVORK5CYII=",
  "base64",
);
const PNG_SHA256 = crypto.createHash("sha256").update(PNG_BYTES).digest("hex");

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
  const sourceSha256BySide = Object.fromEntries(
    ["front", "back"].map((side) => [side, PNG_SHA256]),
  );
  const normalizedArtifactSha256BySide = Object.fromEntries(
    ["front", "back"].map((side) => [side, PNG_SHA256]),
  );
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
          gates: {
            requiredGatesPassed: true,
            results: [
              {
                gate: "clipping",
                status: "accepted_warning",
                summary: "Clipping exceeded the soft target but was accepted as a V0 confidence warning.",
                evidenceRefs: ["analysis.front.allOn.clippedPixelFraction", "analysis.back.allOn.clippedPixelFraction"],
              },
            ],
            blockers: [],
            acceptedWarnings: ["clipping: accepted warning"],
          },
          elementScores: {
            centering: {
              category: "centering",
              status: "provisional_diagnostic",
              score: 10,
              confidence: 0.94,
              confidenceBand: "high",
              primaryMetrics: {},
              warnings: [],
              evidenceRefs: ["analysis.provisionalGradeStory.elementScores.centering"],
              explanation: "Centering evidence supports the provisional score.",
            },
            corners: {
              category: "corners",
              status: "provisional_diagnostic",
              score: 8.97,
              confidence: 0.72,
              confidenceBand: "medium",
              primaryMetrics: {},
              warnings: [],
              evidenceRefs: ["analysis.provisionalGradeStory.elementScores.corners"],
              explanation: "Corner evidence supports the provisional score.",
            },
            edges: {
              category: "edges",
              status: "provisional_diagnostic",
              score: 8.97,
              confidence: 0.71,
              confidenceBand: "medium",
              primaryMetrics: {},
              warnings: [],
              evidenceRefs: ["analysis.provisionalGradeStory.elementScores.edges"],
              explanation: "Edge evidence supports the provisional score.",
            },
            surface: {
              category: "surface",
              status: "provisional_diagnostic",
              score: 5.5,
              confidence: 0.78,
              confidenceBand: "medium",
              primaryMetrics: {},
              warnings: [],
              evidenceRefs: ["analysis.provisionalGradeStory.elementScores.surface"],
              explanation: "Surface evidence supports the provisional score.",
            },
          },
          story: { summary: "Evidence-linked story.", claims: [{ claim: "Surface limits grade.", evidenceRefs: ["visionLab.heatmap.back"] }] },
          whyNot10: [{ id: "surface", title: "Surface candidate", explanation: "Back surface candidate.", evidenceRefs: ["visionLab.heatmap.back"] }],
          gradeImpactCandidates: [
            {
              id: "back-surface-intelligence-v0-001",
              category: "surface",
              side: "back",
              severity: "high",
              confidence: 0.78,
              confidenceBand: "medium",
              provisionalGradeImpact: 2.5,
              sourceChannels: [3, 1, 6],
              evidenceRefs: ["back-surface-intelligence-v0-heatmap.png"],
              explanation: "The back surface candidate limits the provisional grade.",
            },
          ],
        },
        surfaceIntelligence: {
          detectorId: "preliminary_surface_intelligence_v0",
          back: {
            version: "preliminary_surface_intelligence_v0",
            confidence: { score: 0.78 },
            heatmap: { outputFilePath: path.join(dir, "back-surface-intelligence-v0-heatmap.png") },
            candidates: [
              {
                candidateId: "back-surface-intelligence-v0-001",
                side: "back",
                category: "surface",
                severityBand: "high",
                severityProxy: 74.25,
                confidence: 0.78,
                analysisGeometry: {
                  coordinateFrame: "normalized_card",
                  units: "fraction",
                  sourceSha256: sourceSha256BySide.back,
                  normalizedArtifactSha256: normalizedArtifactSha256BySide.back,
                  shape: { type: "box", x: 0.1, y: 0.2, width: 0.25, height: 0.125 },
                },
              },
            ],
          },
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
  fs.writeFileSync(path.join(dir, "front", "front-all-on-portrait-display.png"), PNG_BYTES);
  fs.writeFileSync(path.join(dir, "back", "back-all-on-portrait-display.png"), PNG_BYTES);
  fs.writeFileSync(path.join(dir, "front", "front-normalized-card.png"), PNG_BYTES);
  fs.writeFileSync(path.join(dir, "back", "back-normalized-card.png"), PNG_BYTES);
  for (const side of ["front", "back"]) {
    fs.writeFileSync(
      path.join(dir, side, "manifest.json"),
      JSON.stringify({
        captureTiming: {
          captureProfile: "production_fast",
          totalSideMs: side === "front" ? 4700 : 4800,
          fileWritesMs: side === "front" ? 2200 : 2300,
        },
        processingTiming: {
          totalDurationMs: side === "front" ? 950 : 900,
          frontProcessingMayOverlapFlip: side === "front",
        },
        [side]: {
          normalizedCard: {
            geometry: {
              version: "ten-kings-card-geometry-v1",
              side,
              placementState: "ready",
              geometrySource: "detected",
              captureMode: "automatic_detection",
              confidenceBasis: "automatic_detection",
              detectionUsed: true,
              manualOverrideUsed: false,
              corners: {
                topLeft: { x: 10, y: 20 },
                topRight: { x: 210, y: 20 },
                bottomRight: { x: 210, y: 300 },
                bottomLeft: { x: 10, y: 300 },
              },
              boundingBox: { x: 10, y: 20, width: 200, height: 280 },
              rotationDegrees: side === "front" ? 4.2 : -3.1,
              skewDegrees: side === "front" ? 4.2 : -3.1,
              confidence: 0.94,
              sourceImageId: `${side}-all-on-safe-id`,
              sourceFrameId: `${side}-frame-safe-id`,
              timestamp: "2026-07-09T12:00:00.000Z",
            },
            normalizedArtifact: {
              localOutputPath: path.join(dir, side, `${side}-normalized-card.png`),
              mimeType: "image/png",
              sha256: normalizedArtifactSha256BySide[side],
              sourceSha256: sourceSha256BySide[side],
            },
            rawEvidencePreserved: true,
          },
        },
      })
    );
  }
  fs.writeFileSync(path.join(dir, "back-surface-intelligence-v0-heatmap.png"), PNG_BYTES);
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
  const bundle = await buildAiGraderReportBundle({
    reportDir,
    reportId: "fixture-report",
    geometryCaptureDecisions: {
      front: {
        mode: "detected_geometry",
        placementState: "ready",
        timestamp: "2026-07-09T12:00:00.000Z",
        explicitOperatorAction: false,
        detectionUsed: true,
        manualOverrideUsed: false,
        sourceFrameId: "front-frame-safe-id",
      },
      back: {
        mode: "manual_capture",
        placementState: "adjust_card",
        timestamp: "2026-07-09T12:00:05.000Z",
        explicitOperatorAction: true,
        detectionUsed: false,
        manualOverrideUsed: true,
        manualBoundaryRect: { x: 100, y: 100, width: 1400, height: 1000, coordinateFrame: "basler_sensor_pixels" },
      },
    },
  });

  assert.equal(bundle.schemaVersion, AI_GRADER_REPORT_BUNDLE_VERSION);
  assert.equal(bundle.reportId, "fixture-report");
  assert.equal(bundle.reportStatus, "provisional_diagnostic_ready");
  assert.equal(bundle.provisionalGrade?.overall, 8.5);
  assert.equal(bundle.provisionalGrade?.gates?.results?.[0]?.gate, "clipping");
  assert.equal(bundle.provisionalGrade?.gates?.results?.[0]?.status, "accepted_warning");
  assert.equal(bundle.visionLab.available, true);
  assert.equal(bundle.visionLab.candidateCount, 1);
  assert.equal(bundle.visionLab.defectFindings?.length, 1);
  assert.deepEqual(bundle.visionLab.findingValidation, {
    status: "valid",
    sourceCandidateCount: 1,
    publishedFindingCount: 1,
    issues: [],
  });
  assert.equal(bundle.visionLab.defectFindings?.[0]?.side, "back");
  assert.equal(bundle.visionLab.defectFindings?.[0]?.evidence.trueViewAssetId, "report/back/back-normalized-card.png");
  assert.deepEqual(bundle.visionLab.defectFindings?.[0]?.geometry.shape, {
    type: "box",
    x: 0.1,
    y: 0.2,
    width: 0.25,
    height: 0.125,
  });
  assert.doesNotMatch(JSON.stringify(bundle.visionLab.defectFindings), /sourceSha256/);
  assert.deepEqual(bundle.provisionalGrade?.gradeImpactCandidates?.[0]?.findingIds, [bundle.visionLab.defectFindings?.[0]?.findingId]);
  const findingTrueView = bundle.assets.find((asset) => asset.id === bundle.visionLab.defectFindings?.[0]?.evidence.trueViewAssetId);
  assert.equal(findingTrueView?.side, "back");
  assert.equal(findingTrueView?.evidenceRole, "normalized_card");
  assert.equal(findingTrueView?.widthPx, 1);
  assert.equal(findingTrueView?.heightPx, 1);
  assert.equal(bundle.visionLab.defectFindings?.[0]?.detector.captureProfileVersion, "ten-kings-fixed-rig-production-fast-v1");
  const findingHeatmap = bundle.assets.find((asset) => asset.id === bundle.visionLab.defectFindings?.[0]?.evidence.heatmapAssetId);
  assert.equal(findingHeatmap?.side, "back");
  assert.equal(findingHeatmap?.evidenceRole, "surface_heatmap");
  assert.equal(bundle.assets.some((asset) => asset.kind === "image" && asset.fileName === "front-all-on-portrait-display.png"), true);
  assert.equal(bundle.assets.some((asset) => asset.kind === "image" && asset.fileName === "front-normalized-card.png"), true);
  assert.equal(bundle.assets.some((asset) => asset.kind === "image" && asset.fileName === "back-normalized-card.png"), true);
  assert.equal(bundle.geometry?.front?.placementState, "ready");
  assert.equal(bundle.geometry?.back?.placementState, "ready");
  assert.equal(bundle.geometryCaptureDecisions?.front?.mode, "detected_geometry");
  assert.equal(bundle.geometryCaptureDecisions?.back?.mode, "manual_capture");
  assert.equal(bundle.geometryCaptureDecisions?.back?.manualOverrideUsed, true);
  assert.equal(bundle.captureTiming?.front?.captureProfile, "production_fast");
  assert.equal(bundle.captureTiming?.frontProcessing?.frontProcessingMayOverlapFlip, true);
  assert.equal(bundle.finalGradeComputed, false);
  assert.equal(bundle.certifiedClaim, false);
  assert.equal(bundle.labelGenerated, false);
  assert.equal(bundle.qrGenerated, false);
  assert.equal(bundle.certificateGenerated, false);
  assert.match(bundle.limitations.join(" "), /No QR Certificate Yet/);
});

test("report bundle rejects stale defect geometry from a different normalized source", async () => {
  const reportDir = fixtureReportDir();
  const analysisPath = path.join(reportDir, "analysis.json");
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  analysis.surfaceIntelligence.back.candidates[0].analysisGeometry.sourceSha256 = "f".repeat(64);
  fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));

  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "stale-geometry" });
  assert.deepEqual(bundle.visionLab.defectFindings ?? [], []);
  assert.equal(bundle.visionLab.findingValidation.status, "invalid");
  assert.equal(bundle.visionLab.findingValidation.sourceCandidateCount, 1);
  assert.equal(bundle.visionLab.findingValidation.publishedFindingCount, 0);
  assert.equal(bundle.visionLab.findingValidation.issues.some((entry) => /fingerprints/.test(entry.message)), true);
  assert.equal(bundle.provisionalGrade.gradeImpactCandidates[0].findingIds, undefined);
});

test("report bundle exposes valid zero-count finding validation when no candidates exist", async () => {
  const reportDir = fixtureReportDir();
  const analysisPath = path.join(reportDir, "analysis.json");
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  analysis.surfaceIntelligence.back.candidates = [];
  analysis.provisionalGradeStory.gradeImpactCandidates = [];
  fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));

  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "no-defect-candidates" });
  assert.deepEqual(bundle.visionLab.findingValidation, {
    status: "valid",
    sourceCandidateCount: 0,
    publishedFindingCount: 0,
    issues: [],
  });
});

test("report bundle marks candidate extraction invalid when detector version is missing", async () => {
  const reportDir = fixtureReportDir();
  const analysisPath = path.join(reportDir, "analysis.json");
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  delete analysis.surfaceIntelligence.back.version;
  fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));

  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "missing-detector-version" });
  assert.equal(bundle.visionLab.findingValidation.status, "invalid");
  assert.equal(bundle.visionLab.findingValidation.sourceCandidateCount, 1);
  assert.equal(bundle.visionLab.findingValidation.publishedFindingCount, 0);
  assert.equal(bundle.visionLab.findingValidation.issues.some((entry) => entry.path.endsWith(".version")), true);
});

test("report bundle marks candidate extraction invalid when capture profile version cannot be derived", async () => {
  const reportDir = fixtureReportDir();
  const backManifestPath = path.join(reportDir, "back", "manifest.json");
  const backManifest = JSON.parse(fs.readFileSync(backManifestPath, "utf8"));
  delete backManifest.captureTiming.captureProfile;
  fs.writeFileSync(backManifestPath, JSON.stringify(backManifest, null, 2));

  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "missing-capture-profile-version" });
  assert.equal(bundle.visionLab.findingValidation.status, "invalid");
  assert.equal(bundle.visionLab.findingValidation.sourceCandidateCount, 1);
  assert.equal(bundle.visionLab.findingValidation.publishedFindingCount, 0);
  assert.equal(
    bundle.visionLab.findingValidation.issues.some((entry) => entry.path.endsWith(".captureProfileVersion")),
    true,
  );
});

test("report bundle rejects defect geometry when normalized artifact bytes change", async () => {
  const reportDir = fixtureReportDir();
  fs.writeFileSync(path.join(reportDir, "back", "back-normalized-card.png"), REPLACEMENT_PNG_BYTES);

  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "replaced-normalized-artifact" });
  assert.deepEqual(bundle.visionLab.defectFindings ?? [], []);
  assert.equal(bundle.provisionalGrade.gradeImpactCandidates[0].findingIds, undefined);
});

test("report bundle excludes non-raster bytes mislabeled with an image extension", async () => {
  const reportDir = fixtureReportDir();
  fs.writeFileSync(path.join(reportDir, "back", "back-normalized-card.png"), Buffer.from("<svg><script>bad</script></svg>"));

  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "mime-spoofed-image" });
  assert.equal(bundle.assets.some((asset) => asset.fileName === "back-normalized-card.png"), false);
  assert.deepEqual(bundle.visionLab.defectFindings ?? [], []);
});

test("report bundle excludes raster images with embedded private metadata", async () => {
  const reportDir = fixtureReportDir();
  const normalizedPath = path.join(reportDir, "back", "back-normalized-card.png");
  await sharp(PNG_BYTES)
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><private>local-device-comment</private></x:xmpmeta>')
    .png()
    .toFile(normalizedPath);

  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "private-image-metadata" });
  assert.equal(bundle.assets.some((asset) => asset.fileName === "back-normalized-card.png"), false);
  assert.deepEqual(bundle.visionLab.defectFindings ?? [], []);
});

test("report bundle can include base64 image bodies for local operator viewer export", async () => {
  const reportDir = fixtureReportDir();
  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "fixture-report", includeAssetBodies: true });

  const frontImage = bundle.assets.find((asset) => asset.kind === "image" && asset.fileName === "front-all-on-portrait-display.png");
  assert.equal(frontImage?.contentType, "image/png");
  assert.equal(frontImage?.bodyEncoding, "base64");
  assert.deepEqual(Buffer.from(frontImage?.bodyBase64 ?? "", "base64"), PNG_BYTES);
  assert.equal(frontImage?.sha256, PNG_SHA256);
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
  assert.equal(release.finalGrade.elements.centering.confidence, "high");
  assert.equal(release.finalGrade.elements.surface.confidence, "medium");
  assert.equal(release.finalGrade.gradeImpactReasons[0].confidence, "medium");
  assert.equal(release.label.status, "label_data_ready");
  assert.equal(release.label.qrPayloadUrl, "https://collect.tenkings.co/ai-grader/reports/production-fixture");
  assert.equal(release.certifiedClaim, false);
  assert.equal(release.certificateGenerated, false);
  assert.equal(release.databaseIntegration.productionDbWritesPerformed, false);
  assert.equal(release.storageIntegration.uploadPerformed, false);
});

test("production release does not invent element or grade-impact confidence bands", async () => {
  const reportDir = fixtureReportDir();
  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "production-confidence-band-fixture" });
  delete bundle.provisionalGrade.elementScores.centering.confidenceBand;
  delete bundle.provisionalGrade.gradeImpactCandidates[0].confidenceBand;

  const release = buildAiGraderProductionRelease({
    bundle,
    operatorId: "mark",
    warningsAccepted: true,
    overrideReason: "Accepted V0 warning gates for confidence-band test.",
    publicBaseUrl: "https://collect.tenkings.co",
  });

  assert.equal(release.finalGrade.elements.centering, undefined);
  assert.equal(release.finalGrade.gradeImpactReasons.length, 0);
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
