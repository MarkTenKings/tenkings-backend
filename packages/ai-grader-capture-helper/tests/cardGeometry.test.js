const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const {
  detectAndNormalizeCardImage,
  detectCardGeometry,
} = require("../dist/drivers");

async function writeSyntheticCard(filePath, options = {}) {
  const width = options.width ?? 800;
  const height = options.height ?? 1000;
  const cardWidth = options.cardWidth ?? 350;
  const cardHeight = options.cardHeight ?? 490;
  const centerX = width / 2 + (options.offsetX ?? 0);
  const centerY = height / 2 + (options.offsetY ?? 0);
  const angle = options.angle ?? 0;
  const background = options.background ?? "#17191d";
  const card = options.card ?? "#f2f0e9";
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="${background}"/>
      <g transform="translate(${centerX} ${centerY}) rotate(${angle})">
        <rect x="${-cardWidth / 2}" y="${-cardHeight / 2}" width="${cardWidth}" height="${cardHeight}" rx="5" fill="${card}"/>
        <rect x="${-cardWidth / 2 + 24}" y="${-cardHeight / 2 + 28}" width="${cardWidth - 48}" height="${cardHeight - 56}" rx="4" fill="#c7b36a"/>
        <rect x="${-cardWidth / 2 + 44}" y="${-cardHeight / 2 + 52}" width="${cardWidth - 88}" height="${cardHeight - 104}" rx="3" fill="#465b73"/>
      </g>
    </svg>
  `);
  await sharp(svg).png().toFile(filePath);
}

async function writeBlank(filePath) {
  await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#202226" } }).png().toFile(filePath);
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-card-geometry-"));
}

test("detects four front corners within close-enough offset and +10 degree skew, then writes a portrait lossless normalized PNG", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "front-raw.png");
  const normalizedPath = path.join(dir, "front-normalized.png");
  await writeSyntheticCard(rawPath, { angle: 10, offsetX: 45, offsetY: -20 });
  const rawBefore = fs.readFileSync(rawPath);

  const result = await detectAndNormalizeCardImage({
    sourceImagePath: rawPath,
    normalizedOutputPath: normalizedPath,
    side: "front",
    sourceImageId: "report-001-front",
    sourceFrameId: "frame-front-42",
    timestamp: "2026-07-09T20:00:00.000Z",
  });

  assert.equal(result.geometry.side, "front");
  assert.equal(result.geometry.placementState, "ready");
  assert.equal(result.geometry.geometrySource, "detected");
  assert.equal(result.geometry.detectionUsed, true);
  assert.equal(result.geometry.manualFallbackUsed, false);
  assert.ok(result.geometry.detectedCorners);
  assert.ok(result.geometry.detectedCorners.topLeft.x < result.geometry.detectedCorners.topRight.x);
  assert.ok(Math.abs(result.geometry.rotationDegrees - 10) < 1.5);
  assert.ok(result.geometry.confidence >= 0.72);
  assert.ok(result.geometry.placement.centerOffsetInches.maxAxis <= 0.5);
  assert.equal(result.geometry.sourceImageId, "report-001-front");
  assert.equal(result.geometry.sourceFrameId, "frame-front-42");
  assert.equal(result.geometry.timestamp, "2026-07-09T20:00:00.000Z");
  assert.equal(JSON.stringify(result.geometry).includes(dir), false);
  assert.equal(result.rawEvidencePreserved, true);
  assert.deepEqual(fs.readFileSync(rawPath), rawBefore);
  assert.ok(result.normalizedArtifact);
  assert.equal(result.normalizedArtifact.mimeType, "image/png");
  assert.equal(result.normalizedArtifact.lossless, true);
  assert.equal(result.normalizedArtifact.sourceSha256, result.rawArtifact.sha256);
  assert.equal(fs.existsSync(normalizedPath), true);
  const normalizedMetadata = await sharp(normalizedPath).metadata();
  assert.ok(normalizedMetadata.height > normalizedMetadata.width);
  assert.ok(Math.abs(normalizedMetadata.height / normalizedMetadata.width - 1.4) < 0.08);
});

test("detects back geometry at negative skew and reports ready", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "back-raw.png");
  await writeSyntheticCard(rawPath, { angle: -10, offsetX: -35, offsetY: 25, card: "#e7e9ef" });

  const geometry = await detectCardGeometry({
    sourceImagePath: rawPath,
    side: "back",
    sourceFrameId: "back-frame-7",
  });

  assert.equal(geometry.side, "back");
  assert.equal(geometry.placementState, "ready");
  assert.equal(geometry.geometrySource, "detected");
  assert.ok(geometry.detectedCorners);
  assert.ok(Math.abs(geometry.rotationDegrees + 10) < 1.5);
  assert.ok(geometry.boundingBox.width > 300);
  assert.ok(geometry.boundingBox.height > 450);
});

test("returns adjust_card for excessive skew or center offset while retaining detected geometry", async () => {
  const dir = tempDir();
  const skewedPath = path.join(dir, "skewed.png");
  const offsetPath = path.join(dir, "offset.png");
  await writeSyntheticCard(skewedPath, { angle: 14 });
  await writeSyntheticCard(offsetPath, { angle: 2, offsetX: 115 });

  const skewed = await detectCardGeometry({ sourceImagePath: skewedPath, side: "front" });
  const offset = await detectCardGeometry({ sourceImagePath: offsetPath, side: "front" });
  const relaxed = await detectCardGeometry({
    sourceImagePath: skewedPath,
    side: "front",
    thresholds: { maxSkewDegrees: 15 },
  });

  assert.equal(skewed.placementState, "adjust_card");
  assert.equal(skewed.placement.withinSkewTolerance, false);
  assert.ok(skewed.detectedCorners);
  assert.equal(offset.placementState, "adjust_card");
  assert.equal(offset.placement.withinCenterTolerance, false);
  assert.ok(offset.detectedCorners);
  assert.equal(relaxed.placementState, "ready");
  assert.equal(relaxed.placement.maxSkewDegrees, 15);
});

test("returns not_detected without emitting a normalized artifact for a blank image", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "blank.png");
  const normalizedPath = path.join(dir, "blank-normalized.png");
  await writeBlank(rawPath);

  const result = await detectAndNormalizeCardImage({
    sourceImagePath: rawPath,
    normalizedOutputPath: normalizedPath,
    side: "front",
  });

  assert.equal(result.geometry.placementState, "not_detected");
  assert.equal(result.geometry.geometrySource, "none");
  assert.equal(result.geometry.corners, null);
  assert.equal(result.normalizedArtifact, undefined);
  assert.equal(fs.existsSync(normalizedPath), false);
  assert.equal(result.rawEvidencePreserved, true);
});

test("uses an explicit manual rectangle fallback and saves a normalized artifact without claiming detected corners", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "manual-source.png");
  const normalizedPath = path.join(dir, "manual-normalized.png");
  await writeBlank(rawPath);

  const result = await detectAndNormalizeCardImage({
    sourceImagePath: rawPath,
    normalizedOutputPath: normalizedPath,
    side: "back",
    manualFallback: { rect: { x: 225, y: 255, width: 350, height: 490 }, confidence: 0.95 },
  });

  assert.equal(result.geometry.placementState, "ready");
  assert.equal(result.geometry.geometrySource, "manual_fallback");
  assert.equal(result.geometry.detectionUsed, false);
  assert.equal(result.geometry.manualFallbackUsed, true);
  assert.equal(result.geometry.detectedCorners, null);
  assert.ok(result.geometry.corners);
  assert.deepEqual(result.geometry.boundingBox, { x: 225, y: 255, width: 350, height: 490 });
  assert.ok(result.normalizedArtifact);
  assert.equal(result.normalizedArtifact.imageWidth, 350);
  assert.equal(result.normalizedArtifact.imageHeight, 490);
  assert.equal(result.rawEvidencePreserved, true);
});
