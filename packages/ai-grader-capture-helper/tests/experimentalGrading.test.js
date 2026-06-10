const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const {
  analyzeDinoLiteExperimentalGradingWorkflow,
  analyzeCenteringImage,
  analyzeCornerImageForTests,
  analyzeEdgeImageForTests,
  analyzeSurfaceImageForTests,
  createSyntheticImage,
  fillRect,
  fuseExperimentalScores,
} = require("../dist");
const { runCaptureHelperCli } = require("../dist/cli");

function fakeElement(element, score) {
  return {
    element,
    status: "computed",
    score,
    confidence: 0.7,
    rawMetrics: {},
    evidenceArtifactIds: [],
    evidencePaths: [],
    limitations: [],
    algorithmVersion: "tenkings-dinolite-grading-v0.1",
    thresholdSetVersion: "tenkings-dinolite-thresholds-v0.1",
  };
}

function makeCenteredCardImage() {
  const image = createSyntheticImage(240, 320, { r: 245, g: 245, b: 245 });
  fillRect(image, { x: 20, y: 20, w: 200, h: 280 }, { r: 190, g: 190, b: 190 });
  fillRect(image, { x: 45, y: 55, w: 150, h: 210 }, { r: 65, g: 65, b: 65 });
  return image;
}

test("centering analyzer computes synthetic rectangle ratios", () => {
  const result = analyzeCenteringImage(makeCenteredCardImage());

  assert.equal(result.status, "computed");
  assert.ok(result.score >= 9);
  assert.equal(result.algorithmVersion, "tenkings-dinolite-grading-v0.1");
  assert.equal(result.thresholdSetVersion, "tenkings-dinolite-thresholds-v0.1");
});

test("centering analyzer returns not_computed when boundary is absent", () => {
  const image = createSyntheticImage(160, 120, { r: 200, g: 200, b: 200 });
  const result = analyzeCenteringImage(image);

  assert.equal(result.status, "not_computed");
  assert.equal(result.notComputedReason, "CARD_OUTER_RECT_NOT_DETECTED");
  assert.equal(result.score, undefined);
});

test("corner analyzer scores synthetic damaged corner below clean corner", () => {
  const clean = createSyntheticImage(120, 120, { r: 150, g: 150, b: 150 });
  const damaged = createSyntheticImage(120, 120, { r: 150, g: 150, b: 150 });
  fillRect(damaged, { x: 0, y: 0, w: 22, h: 22 }, { r: 250, g: 250, b: 250 });
  fillRect(damaged, { x: 30, y: 3, w: 8, h: 18 }, { r: 20, g: 20, b: 20 });

  assert.ok(analyzeCornerImageForTests(damaged).score < analyzeCornerImageForTests(clean).score);
});

test("edge analyzer scores synthetic damaged edge below clean edge", () => {
  const clean = createSyntheticImage(160, 100, { r: 145, g: 145, b: 145 });
  const damaged = createSyntheticImage(160, 100, { r: 145, g: 145, b: 145 });
  fillRect(damaged, { x: 0, y: 0, w: 160, h: 14 }, { r: 245, g: 245, b: 245 });
  for (let x = 0; x < 160; x += 8) fillRect(damaged, { x, y: 18, w: 3, h: 28 }, { r: 25, g: 25, b: 25 });

  assert.ok(analyzeEdgeImageForTests(damaged, "top-edge").score < analyzeEdgeImageForTests(clean, "top-edge").score);
});

test("surface analyzer scores synthetic specked surface below clean surface", () => {
  const clean = createSyntheticImage(140, 140, { r: 150, g: 150, b: 150 });
  const damaged = createSyntheticImage(140, 140, { r: 150, g: 150, b: 150 });
  for (let i = 20; i < 120; i += 12) {
    fillRect(damaged, { x: i, y: 40, w: 5, h: 5 }, { r: 250, g: 250, b: 250 });
    fillRect(damaged, { x: 120 - i, y: 86, w: 4, h: 4 }, { r: 20, g: 20, b: 20 });
  }
  fillRect(damaged, { x: 20, y: 70, w: 95, h: 3 }, { r: 245, g: 245, b: 245 });

  assert.ok(analyzeSurfaceImageForTests(damaged).score < analyzeSurfaceImageForTests(clean).score);
});

test("fusion computes experimental score and applies severe defect cap", () => {
  const result = fuseExperimentalScores({
    centering: fakeElement("centering", 9.5),
    corners: fakeElement("corners", 4.8),
    edges: fakeElement("edges", 8.5),
    surface: fakeElement("surface", 8.2),
  });

  assert.equal(result.status, "computed");
  assert.ok(result.score <= 6);
  assert.match(result.limitations.join(" "), /not certifiable/);
});

test("fusion reports not_computed instead of placeholder score when required inputs are missing", () => {
  const missing = { ...fakeElement("corners", 0), status: "not_computed", score: undefined, notComputedReason: "missing" };
  const result = fuseExperimentalScores({
    centering: fakeElement("centering", 9),
    corners: missing,
    edges: fakeElement("edges", 9),
    surface: fakeElement("surface", 9),
  });

  assert.equal(result.status, "not_computed");
  assert.equal(result.score, undefined);
  assert.match(result.notComputedReason, /corners/);
});

test("experimental report carries non-certified warning language", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "dinolite-grading-report-"));
  const imagePath = path.join(sessionDir, "01-full-card-overview-normal.jpg");
  const previewReportPath = path.join(sessionDir, "preview-report.html");
  const manifestPath = path.join(sessionDir, "manifest.json");
  const image = makeCenteredCardImage();
  await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } })
    .jpeg()
    .toFile(imagePath);

  const analysis = await analyzeDinoLiteExperimentalGradingWorkflow({
    adapter: "fake",
    simulated: true,
    comActiveXInstantiated: false,
    sessionId: "synthetic-report-session",
    label: "synthetic-report",
    plan: "experimental-card-grading",
    sessionDir,
    manifestPath,
    previewReportPath,
    timestamp: "2026-06-10T00:00:00.000Z",
    status: "completed",
    device: { index: 0, name: "Synthetic Dino-Lite" },
    ocxVersion: "simulated",
    connectedDuringCommand: false,
    previewDuringCommand: false,
    config: { bitfield: 0 },
    amr: null,
    options: { includeFlcSweep: false, includeEdr: false, includeEdof: false },
    targets: [
      {
        target: {
          id: "full-card-overview",
          name: "Full-card overview",
          type: "interim_macro_overview",
          reportLabel: "interim_full_card_overview",
          instruction: "Synthetic test overview.",
          captureGuide: "Guide: fit as much of the card as possible, avoid background, keep card edges visible.",
          captureGuidesEnabled: true,
          cornerProfile: null,
        },
        targetIndex: 1,
        action: "capture",
        attempt: 1,
        status: "success",
        artifacts: [
          {
            path: imagePath,
            filename: path.basename(imagePath),
            sha256: "synthetic",
            byteSize: fs.statSync(imagePath).size,
            mimeType: "image/jpeg",
            timestamp: "2026-06-10T00:00:00.000Z",
            captureKind: "normal",
            lightingRecipe: "normal",
            status: "success",
          },
        ],
      },
    ],
    cleanup: { previewStopped: true, disconnected: true, hostDisposed: true },
    limitations: [],
    forbiddenOperationsInvoked: false,
  }, { cornerProfile: "sharp_90", captureGuides: true });

  const html = fs.readFileSync(previewReportPath, "utf8");
  assert.match(html, /Experimental AI Grader Test Run - Not Certified/);
  assert.match(html, /not a certified grade/);
  assert.match(html, /not a certificate/);
  assert.match(html, /not calibrated production macro evidence/);
  assert.match(html, /not a final AI grade/);
  assert.match(html, /Score Scale/);
  assert.match(html, /x\.xx \/ 10/);
  assert.match(html, /centering 10\/10/i);
  assert.match(html, /corners 10\/10/i);
  assert.match(html, /edges 10\/10/i);
  assert.match(html, /surface 10\/10/i);
  assert.match(html, /overall 10\/10/i);
  assert.match(html, /Why this score\?/i);
  assert.match(html, /Quality Warning Summary/);
  assert.equal(analysis.operatorOptions.cornerProfile, "sharp_90");
  assert.equal(analysis.scoreScale.displayFormat, "x.xx / 10");
  assert.equal(analysis.qualityDiagnostics.length, 1);
});

test("experimental grading CLI rejects unsupported corner profile before spawning bridge", async () => {
  let stderr = "";
  const code = await runCaptureHelperCli(
    [
      "dinolite-experimental-grading-run",
      "--bridge-exe",
      "bridge.exe",
      "--adapter",
      "dnvideox",
      "--device-index",
      "0",
      "--output-dir",
      path.join(os.tmpdir(), "dinolite-grading-runs"),
      "--label",
      "profile-test",
      "--corner-profile",
      "rounded",
    ],
    {
      stderr: (text) => {
        stderr += text;
      },
      env: {},
    }
  );

  assert.equal(code, 1);
  assert.match(stderr, /sharp_90 only/);
});

test("experimental grading CLI rejects missing label before spawning bridge", async () => {
  let stderr = "";
  const code = await runCaptureHelperCli(
    [
      "dinolite-experimental-grading-run",
      "--bridge-exe",
      "bridge.exe",
      "--adapter",
      "dnvideox",
      "--device-index",
      "0",
      "--output-dir",
      path.join(os.tmpdir(), "dinolite-grading-runs"),
    ],
    {
      stderr: (text) => {
        stderr += text;
      },
      env: {},
    }
  );

  assert.equal(code, 1);
  assert.match(stderr, /requires --label/);
});

test("experimental grading CLI rejects output inside repo before spawning bridge", async () => {
  let stderr = "";
  const code = await runCaptureHelperCli(
    [
      "dinolite-experimental-grading-run",
      "--bridge-exe",
      "bridge.exe",
      "--adapter",
      "dnvideox",
      "--device-index",
      "0",
      "--output-dir",
      process.cwd(),
      "--label",
      "unsafe",
    ],
    {
      stderr: (text) => {
        stderr += text;
      },
      env: {},
    }
  );

  assert.equal(code, 1);
  assert.match(stderr, /outside the git repo/);
});
