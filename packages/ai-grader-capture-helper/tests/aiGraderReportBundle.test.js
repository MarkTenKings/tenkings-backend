const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AI_GRADER_REPORT_BUNDLE_VERSION,
  AI_GRADER_REPORT_PRODUCER_CAPABILITIES,
  AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
  buildAiGraderReportBundle,
  writeAiGraderReportBundle,
} = require("../dist/drivers/aiGraderReportBundle");
const { createStableAiGraderDefectFindingId } = require("../dist/drivers/aiGraderDefectFindings");
const {
  AI_GRADER_REPORT_RECOVERY_GUIDANCE,
  aiGraderReportBundleNeedsRecovery,
  recoverAiGraderReportPackage,
} = require("../dist/drivers/aiGraderReportPackageRecovery");
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
          front: {
            version: "preliminary_surface_intelligence_v0",
            candidates: [],
          },
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

function pr82StaleCandidateBundle(bundle) {
  const stale = structuredClone(bundle);
  delete stale.reportProducer;
  delete stale.visionLab.findingValidation;
  const finding = stale.visionLab.defectFindings[0];
  const legacyDetector = { id: finding.detector.id, version: finding.detector.version };
  const legacyFindingId = createStableAiGraderDefectFindingId({
    side: finding.side,
    category: finding.category,
    detector: legacyDetector,
    geometry: finding.geometry,
  });
  finding.findingId = legacyFindingId;
  finding.detector = legacyDetector;
  stale.provisionalGrade.gradeImpactCandidates[0].findingIds = [legacyFindingId];
  for (const asset of stale.assets) {
    if (asset.kind === "image") {
      delete asset.widthPx;
      delete asset.heightPx;
    }
  }
  return { stale, legacyFindingId };
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
  assert.equal(bundle.reportProducer.contractVersion, AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION);
  assert.equal(bundle.reportProducer.capabilities.includes("finding-validation-v1"), true);
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

test("stale PR82 candidate package is transactionally recovered without recapture and preserves verified IDs and hashes", async () => {
  const reportDir = fixtureReportDir();
  const reportId = "recover-pr82-report";
  const gradingSessionId = "recover-pr82-session";
  const current = await buildAiGraderReportBundle({ reportDir, reportId, gradingSessionId });
  const { stale, legacyFindingId } = pr82StaleCandidateBundle(current);
  const previousRelease = buildAiGraderProductionRelease({
    bundle: stale,
    generatedAt: "2026-07-11T12:00:00.000Z",
    operatorId: "operator-verified",
    warningsAccepted: true,
    overrideReason: "Reviewed existing report",
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-report-recovery-"));
  const canonicalDir = path.join(root, reportId);
  fs.mkdirSync(canonicalDir, { recursive: true });
  fs.writeFileSync(path.join(canonicalDir, "report-bundle.json"), JSON.stringify(stale));
  fs.writeFileSync(path.join(canonicalDir, "production-release.json"), JSON.stringify(previousRelease));
  fs.writeFileSync(path.join(canonicalDir, "old-generation.marker"), "old");

  assert.equal(await aiGraderReportBundleNeedsRecovery(stale, reportDir), true);
  const result = await recoverAiGraderReportPackage({
    canonicalDir,
    reportDir,
    reportId,
    gradingSessionId,
    previousBundle: stale,
    previousRelease,
  });

  assert.equal(result.bundle.schemaVersion, "ai-grader-report-bundle-v0.1");
  assert.equal(result.bundle.reportProducer.contractVersion, AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION);
  assert.equal(result.bundle.visionLab.findingValidation.status, "valid");
  assert.equal(result.bundle.visionLab.defectFindings[0].findingId, legacyFindingId);
  assert.equal(result.bundle.visionLab.defectFindings[0].detector.captureProfileVersion, "ten-kings-fixed-rig-production-fast-v1");
  assert.deepEqual(result.productionRelease.operatorFinalization, previousRelease.operatorFinalization);
  assert.equal(fs.existsSync(path.join(canonicalDir, "old-generation.marker")), false);
  for (const fileName of [
    "report-bundle.json", "asset-manifest.json", "checksums.json", "production-release.json",
    "label-data.json", "publication-manifest.json", "integration-contract.json",
  ]) {
    assert.equal(fs.existsSync(path.join(canonicalDir, fileName)), true, fileName);
  }
  assert.equal(fs.readdirSync(path.join(canonicalDir, "assets")).length > 0, true);
  assert.equal(JSON.stringify(result).includes(".staging-"), false);
  const oldHashes = new Map(stale.assets.filter((asset) => asset.sha256).map((asset) => [asset.id, asset.sha256]));
  for (const asset of result.bundle.assets.filter((asset) => oldHashes.has(asset.id))) {
    assert.equal(asset.sha256, oldHashes.get(asset.id));
  }
  assert.equal(await aiGraderReportBundleNeedsRecovery(result.bundle, reportDir, canonicalDir), false);
});

test("verified candidate-free legacy v0.1 remains compatible", async () => {
  const reportDir = fixtureReportDir();
  const analysisPath = path.join(reportDir, "analysis.json");
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  analysis.surfaceIntelligence.back.candidates = [];
  analysis.provisionalGradeStory.gradeImpactCandidates = [];
  fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
  const legacy = await buildAiGraderReportBundle({ reportDir, reportId: "candidate-free-legacy" });
  delete legacy.reportProducer;
  delete legacy.visionLab.defectFindings;
  delete legacy.visionLab.findingValidation;
  assert.equal(await aiGraderReportBundleNeedsRecovery(legacy, reportDir), false);
});

test("candidate-free compatibility fails closed when source analysis is missing, corrupt, incomplete, or one-sided", async () => {
  for (const failure of ["missing", "corrupt", "incomplete", "one-sided"]) {
    const reportDir = fixtureReportDir();
    const legacy = await buildAiGraderReportBundle({ reportDir, reportId: "unverified-zero-" + failure });
    delete legacy.reportProducer;
    delete legacy.defectFindings;
    delete legacy.visionLab.defectFindings;
    delete legacy.visionLab.findingValidation;
    delete legacy.visionLab.findingContractVersion;
    delete legacy.visionLab.candidateCount;
    if (legacy.provisionalGrade) delete legacy.provisionalGrade.gradeImpactCandidates;
    const analysisPath = path.join(reportDir, "analysis.json");
    if (failure === "missing") fs.unlinkSync(analysisPath);
    if (failure === "corrupt") fs.writeFileSync(analysisPath, "{not-json");
    if (failure === "incomplete") fs.writeFileSync(analysisPath, "{}");
    if (failure === "one-sided") {
      const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
      delete analysis.surfaceIntelligence.front;
      fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
    }

    await assert.rejects(
      aiGraderReportBundleNeedsRecovery(legacy, reportDir),
      (error) => error instanceof Error && error.message === AI_GRADER_REPORT_RECOVERY_GUIDANCE,
    );
  }
});

test("current producer requires complete matching base sidecars and omits the atomic package capability", async () => {
  assert.equal(AI_GRADER_REPORT_PRODUCER_CAPABILITIES.includes("atomic-derived-package-v1"), false);
  for (const failure of [
    "missing-asset-manifest",
    "mismatched-asset-manifest",
    "missing-checksums",
    "mismatched-checksums",
    "missing-asset-integrity",
    "missing-asset-integrity-missing-status",
    "retired-atomic-capability",
  ]) {
    const reportDir = fixtureReportDir();
    const reportId = "current-sidecars-" + failure;
    const gradingSessionId = reportId + "-session";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-current-sidecars-"));
    const canonicalDir = path.join(root, reportId);
    const written = await writeAiGraderReportBundle({
      reportDir,
      outputDir: canonicalDir,
      reportId,
      gradingSessionId,
    });
    const bundlePath = path.join(canonicalDir, "report-bundle.json");
    const assetManifestPath = path.join(canonicalDir, "asset-manifest.json");
    const checksumsPath = path.join(canonicalDir, "checksums.json");
    if (failure === "missing-asset-manifest") fs.unlinkSync(assetManifestPath);
    if (failure === "mismatched-asset-manifest") {
      const sidecar = JSON.parse(fs.readFileSync(assetManifestPath, "utf8"));
      sidecar.assets[0].localPath = sidecar.assets[0].localPath + ".mismatched";
      fs.writeFileSync(assetManifestPath, JSON.stringify(sidecar, null, 2));
    }
    if (failure === "missing-checksums") fs.unlinkSync(checksumsPath);
    if (failure === "mismatched-checksums") {
      const sidecar = JSON.parse(fs.readFileSync(checksumsPath, "utf8"));
      sidecar.checksums[0].sha256 = "f".repeat(64);
      fs.writeFileSync(checksumsPath, JSON.stringify(sidecar, null, 2));
    }
    if (failure.startsWith("missing-asset-integrity")) {
      const asset = written.bundle.assets.find((entry) => entry.kind !== "folder");
      delete asset.sha256;
      delete asset.byteSize;
      if (failure.endsWith("missing-status")) written.bundle.reportStatus = "missing_report_data";
      fs.writeFileSync(bundlePath, JSON.stringify(written.bundle, null, 2));
      const assetManifest = JSON.parse(fs.readFileSync(assetManifestPath, "utf8"));
      assetManifest.assets = written.bundle.assets;
      fs.writeFileSync(assetManifestPath, JSON.stringify(assetManifest, null, 2));
      const checksums = JSON.parse(fs.readFileSync(checksumsPath, "utf8"));
      checksums.checksums = checksums.checksums.filter((entry) => entry.id !== asset.id);
      fs.writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2));
    }
    if (failure === "retired-atomic-capability") {
      written.bundle.reportProducer.capabilities.push("atomic-derived-package-v1");
      fs.writeFileSync(bundlePath, JSON.stringify(written.bundle, null, 2));
    }

    assert.equal(await aiGraderReportBundleNeedsRecovery(written.bundle, reportDir, canonicalDir), true);
    const recovered = await recoverAiGraderReportPackage({
      canonicalDir,
      reportDir,
      reportId,
      gradingSessionId,
      previousBundle: written.bundle,
    });
    assert.equal(recovered.productionRelease, undefined);
    assert.equal(recovered.bundle.reportProducer.capabilities.includes("atomic-derived-package-v1"), false);
    assert.equal(await aiGraderReportBundleNeedsRecovery(recovered.bundle, reportDir, canonicalDir), false);
    const assetManifest = JSON.parse(fs.readFileSync(path.join(canonicalDir, "asset-manifest.json"), "utf8"));
    const checksums = JSON.parse(fs.readFileSync(path.join(canonicalDir, "checksums.json"), "utf8"));
    assert.equal(assetManifest.reportId, reportId);
    assert.deepEqual(assetManifest.assets, recovered.bundle.assets);
    assert.equal(checksums.reportId, reportId);
    assert.deepEqual(checksums.checksums, recovered.bundle.assets.filter((asset) => asset.sha256).map((asset) => ({
      id: asset.id,
      localPath: asset.localPath,
      sha256: asset.sha256,
      byteSize: asset.byteSize,
    })));
  }
});

test("report recovery rejects tampered IDs, invalid fingerprints, and missing analysis without replacing the old package", async () => {
  for (const failure of ["tampered-id", "invalid-fingerprint", "missing-analysis"]) {
    const reportDir = fixtureReportDir();
    const reportId = "blocked-recovery-" + failure;
    const gradingSessionId = reportId + "-session";
    const current = await buildAiGraderReportBundle({ reportDir, reportId, gradingSessionId });
    const { stale } = pr82StaleCandidateBundle(current);
    if (failure === "tampered-id") {
      stale.visionLab.defectFindings[0].findingId = "dfv1_000000000000000000000000";
    } else if (failure === "invalid-fingerprint") {
      const analysisPath = path.join(reportDir, "analysis.json");
      const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
      analysis.surfaceIntelligence.back.candidates[0].analysisGeometry.sourceSha256 = "f".repeat(64);
      fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
    } else {
      fs.unlinkSync(path.join(reportDir, "analysis.json"));
    }
    const previousRelease = buildAiGraderProductionRelease({ bundle: stale, operatorId: "operator-verified", warningsAccepted: true });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-report-recovery-blocked-"));
    const canonicalDir = path.join(root, reportId);
    fs.mkdirSync(canonicalDir, { recursive: true });
    const oldBundleBytes = Buffer.from(JSON.stringify(stale));
    const oldReleaseBytes = Buffer.from(JSON.stringify(previousRelease));
    fs.writeFileSync(path.join(canonicalDir, "report-bundle.json"), oldBundleBytes);
    fs.writeFileSync(path.join(canonicalDir, "production-release.json"), oldReleaseBytes);

    await assert.rejects(
      recoverAiGraderReportPackage({ canonicalDir, reportDir, reportId, gradingSessionId, previousBundle: stale, previousRelease }),
      (error) => error instanceof Error && error.message === AI_GRADER_REPORT_RECOVERY_GUIDANCE,
    );
    assert.deepEqual(fs.readFileSync(path.join(canonicalDir, "report-bundle.json")), oldBundleBytes);
    assert.deepEqual(fs.readFileSync(path.join(canonicalDir, "production-release.json")), oldReleaseBytes);
    assert.equal(fs.readdirSync(root).some((name) => name.includes(".staging-") || name.includes(".backup-")), false);
  }
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

test("production release projects the exact source grade blocker instead of hiding a missing final grade", async () => {
  const reportDir = fixtureReportDir();
  const bundle = await buildAiGraderReportBundle({ reportDir, reportId: "source-grade-blocker" });
  bundle.provisionalGrade.status = "insufficient_evidence";
  delete bundle.provisionalGrade.overall;
  bundle.provisionalGrade.gates = {
    requiredGatesPassed: false,
    results: [
      {
        gate: "focus_sharpness",
        status: "fail",
        summary: "Minimum sharpness is 14.4081; soft target is 60.",
        evidenceRefs: ["analysis.front.allOn.sharpnessScore", "analysis.back.allOn.sharpnessScore"],
      },
    ],
    blockers: ["focus_sharpness: Minimum sharpness is 14.4081; soft target is 60."],
    acceptedWarnings: [],
  };

  const release = buildAiGraderProductionRelease({
    bundle,
    operatorId: "operator",
    warningsAccepted: true,
  });

  assert.equal(release.finalGradeComputed, false);
  const sourceGate = release.gates.find((gate) => gate.id === "source_grade_readiness");
  assert.equal(sourceGate?.status, "fail");
  assert.match(sourceGate?.reason ?? "", /focus_sharpness/);
  assert.match(sourceGate?.reason ?? "", /14\.4081/);
  assert.equal(release.labelDataGenerated, false);
  assert.equal(release.qrPayloadGenerated, false);
});

test("production release rejects fail-open source grade shapes", async () => {
  const source = await buildAiGraderReportBundle({ reportDir: fixtureReportDir(), reportId: "source-grade-shape" });
  const cases = [
    (bundle) => { delete bundle.provisionalGrade.gates.requiredGatesPassed; },
    (bundle) => { bundle.provisionalGrade.gates.requiredGatesPassed = false; },
    (bundle) => { bundle.provisionalGrade.gates.results = []; },
    (bundle) => { delete bundle.provisionalGrade.gates.results[0].evidenceRefs; },
    (bundle) => { bundle.provisionalGrade.overall = 11; },
  ];
  for (const mutate of cases) {
    const bundle = structuredClone(source);
    mutate(bundle);
    const release = buildAiGraderProductionRelease({ bundle, operatorId: "operator", warningsAccepted: true });
    assert.equal(release.finalGradeComputed, false);
    assert.equal(release.gates.find((gate) => gate.id === "source_grade_readiness")?.status, "fail");
    assert.equal(release.labelDataGenerated, false);
    assert.equal(release.qrPayloadGenerated, false);
  }
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
