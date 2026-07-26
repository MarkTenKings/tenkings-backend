const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const sharp = require("sharp");
const ts = require("typescript");
const {
  detectAndNormalizeCardImage,
  detectCardGeometry,
  detectCardGeometryFromBuffer,
  NORMALIZED_CARD_HEIGHT_PIXELS,
  NORMALIZED_CARD_WIDTH_PIXELS,
  normalizeCardImageWithGeometry,
} = require("../dist/drivers");

const CAPTURED_EVIDENCE_POLICY = "captured_evidence_full";
const LIVE_PREVIEW_POLICY = "live_preview_fast";

async function writeSyntheticCard(filePath, options = {}) {
  const width = options.width ?? 800;
  const height = options.height ?? 1000;
  const cardWidth = options.cardWidth ?? 440;
  const cardHeight = options.cardHeight ?? 616;
  const centerX = width / 2 + (options.offsetX ?? 0);
  const centerY = height / 2 + (options.offsetY ?? 0);
  const angle = options.angle ?? 0;
  const background = options.background ?? "#17191d";
  const card = options.card ?? "#f2f0e9";
  const details = options.details === false
    ? ""
    : `<rect x="${-cardWidth / 2 + 24}" y="${-cardHeight / 2 + 28}" width="${cardWidth - 48}" height="${cardHeight - 56}" rx="4" fill="${options.detailOne ?? "#c7b36a"}"/>
       <rect x="${-cardWidth / 2 + 44}" y="${-cardHeight / 2 + 52}" width="${cardWidth - 88}" height="${cardHeight - 104}" rx="3" fill="${options.detailTwo ?? "#465b73"}"/>`;
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="${background}"/>
      <g transform="translate(${centerX} ${centerY}) rotate(${angle})">
        <rect x="${-cardWidth / 2}" y="${-cardHeight / 2}" width="${cardWidth}" height="${cardHeight}" rx="5" fill="${card}"/>
        ${details}
      </g>
    </svg>
  `);
  await sharp(svg).png().toFile(filePath);
}

async function writeBlank(filePath) {
  await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#202226" } }).png().toFile(filePath);
}

async function shapePreviewBuffer(shape) {
  const body = shape === "circle"
    ? '<circle cx="400" cy="500" r="250" fill="#eeeeee"/>'
    : shape === "triangle"
      ? '<path d="M400 175 L675 760 L125 760 Z" fill="#eeeeee"/>'
      : '<path d="M220 190 L580 190 L700 500 L580 810 L220 810 L100 500 Z" fill="#eeeeee"/>';
  return sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
      <rect width="800" height="1000" fill="#15171a"/>
      ${body}
    </svg>
  `)).png().toBuffer();
}

/**
 * Regression fixture for a captured all-on failure mode: the card perimeter
 * is dark but real, while interior artwork has much stronger contrast. The
 * solid-plate component must not promote artwork into a card rectangle; the
 * perimeter authority may pass only after all four captured edges validate.
 */
async function writeDarkPerimeterCard(filePath, options = {}) {
  const width = options.width ?? 1400;
  const height = options.height ?? 1000;
  const cardWidth = options.cardWidth ?? 980;
  const cardHeight = options.cardHeight ?? 700;
  const centerX = width / 2 + (options.offsetX ?? 0);
  const centerY = height / 2 + (options.offsetY ?? 0);
  const angle = options.angle ?? 0;
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#000000"/>
      <g transform="translate(${centerX} ${centerY}) rotate(${angle})">
        <rect x="${-cardWidth / 2}" y="${-cardHeight / 2}" width="${cardWidth}" height="${cardHeight}" rx="10" fill="#090b0d"/>
        <path d="M ${-cardWidth * .32} ${-cardHeight * .15} L 0 ${-cardHeight * .32} L ${cardWidth * .28} ${-cardHeight * .05} L ${cardWidth * .12} ${cardHeight * .27} L ${-cardWidth * .25} ${cardHeight * .2} Z" fill="#b8a765"/>
        <circle cx="${cardWidth * .17}" cy="${cardHeight * .12}" r="${cardHeight * .16}" fill="#425f79"/>
        <rect x="${-cardWidth * .38}" y="${cardHeight * .23}" width="${cardWidth * .5}" height="${cardHeight * .12}" fill="#d9d9d9"/>
      </g>
    </svg>
  `);
  await sharp(svg).png().toFile(filePath);
}

/**
 * A dark card under intentionally directional plate illumination. The top and
 * left exterior strips are brighter than the card while the other two remain
 * dark, so all four edges stay locally coherent but do not share one global
 * interior/exterior sign.
 */
async function writeDirectionalPerimeterCard(filePath) {
  const width = 1400;
  const height = 1000;
  const cardWidth = 980;
  const cardHeight = 700;
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#000000"/>
      <g transform="translate(700 500)">
        <rect x="${-cardWidth / 2 - 20}" y="${-cardHeight / 2 - 20}" width="${cardWidth + 20}" height="20" fill="#d0d0d0"/>
        <rect x="${-cardWidth / 2 - 20}" y="${-cardHeight / 2 - 20}" width="20" height="${cardHeight + 20}" fill="#d0d0d0"/>
        <rect x="${-cardWidth / 2}" y="${-cardHeight / 2}" width="${cardWidth}" height="${cardHeight}" rx="10" fill="#090b0d"/>
        <path d="M -310 -105 L 0 -230 L 280 -35 L 120 190 L -250 150 Z" fill="#b8a765"/>
        <circle cx="165" cy="90" r="110" fill="#425f79"/>
        <rect x="-370" y="180" width="490" height="84" fill="#d9d9d9"/>
      </g>
    </svg>
  `);
  await sharp(svg).png().toFile(filePath);
}

async function writeUnevenDarkBackCard(filePath) {
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
      <defs>
        <linearGradient id="plate" x1="0" x2="1">
          <stop offset="0" stop-color="#66696d"/>
          <stop offset="1" stop-color="#070809"/>
        </linearGradient>
        <linearGradient id="card" x1="0" x2="1">
          <stop offset="0" stop-color="#16191d"/>
          <stop offset="1" stop-color="#020304"/>
        </linearGradient>
      </defs>
      <rect width="800" height="1000" fill="url(#plate)"/>
      <rect x="120" y="70" width="560" height="860" rx="22" fill="url(#card)"/>
      <ellipse cx="400" cy="520" rx="210" ry="275" fill="none" stroke="#323940" stroke-width="38"/>
      <circle cx="400" cy="520" r="82" fill="#747b82"/>
      <path d="M180 260 Q400 110 620 260" fill="none" stroke="#444a51" stroke-width="28"/>
      <path d="M180 790 Q400 940 620 790" fill="none" stroke="#252a30" stroke-width="28"/>
    </svg>
  `);
  await sharp(svg).png().toFile(filePath);
}

async function writeFrameConnectedGlareNetworkCard(filePath) {
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
      <rect width="800" height="1000" fill="#07090b"/>
      <path
        d="M 0 118 H 748 V 892 H 54 V 118 Z"
        fill="none"
        stroke="#59616a"
        stroke-width="24"
      />
      <rect x="180" y="150" width="440" height="616" rx="8" fill="#eeeae0"/>
      <rect x="222" y="198" width="356" height="500" rx="5" fill="#315079"/>
    </svg>
  `);
  await sharp(svg).png().toFile(filePath);
}

async function deterministicTexturedNoCardBuffer(options = {}) {
  const width = options.width ?? 1400;
  const height = options.height ?? 1000;
  const pixels = Buffer.alloc(width * height * 3);
  let state = 0x6d2b79f5;
  for (let index = 0; index < width * height; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const value = state >>> 24;
    const offset = index * 3;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-card-geometry-"));
}

test("detector declarations require one of the two explicit policies at every entry point", () => {
  const dir = tempDir();
  const fixturePath = path.join(dir, "detector-policy-contract.ts");
  let moduleSpecifier = path.relative(dir, path.join(__dirname, "../dist/drivers")).replaceAll("\\", "/");
  if (!moduleSpecifier.startsWith(".")) moduleSpecifier = `./${moduleSpecifier}`;
  fs.writeFileSync(fixturePath, `
    import {
      detectAndNormalizeCardImage,
      detectCardGeometry,
      detectCardGeometryFromBuffer,
      type AiGraderCardGeometryDetectionPolicy,
    } from ${JSON.stringify(moduleSpecifier)};
    declare const sourceImagePath: string;
    declare const normalizedOutputPath: string;
    const live: AiGraderCardGeometryDetectionPolicy = "live_preview_fast";
    const captured: AiGraderCardGeometryDetectionPolicy = "captured_evidence_full";
    detectCardGeometry({ sourceImagePath, side: "front", detectionPolicy: live });
    detectCardGeometryFromBuffer({ imageBuffer: undefined as never, side: "back", detectionPolicy: live });
    detectAndNormalizeCardImage({ sourceImagePath, normalizedOutputPath, side: "front", detectionPolicy: captured });
    // @ts-expect-error detectionPolicy is required and has no implicit default.
    detectCardGeometry({ sourceImagePath, side: "front" });
    // @ts-expect-error buffer detection independently requires detectionPolicy.
    detectCardGeometryFromBuffer({ imageBuffer: undefined as never, side: "back" });
    // @ts-expect-error detect-and-normalize independently requires detectionPolicy.
    detectAndNormalizeCardImage({ sourceImagePath, normalizedOutputPath, side: "front" });
    // @ts-expect-error no third detector policy is accepted.
    detectCardGeometry({ sourceImagePath, side: "front", detectionPolicy: "automatic" });
  `);
  const program = ts.createProgram([fixturePath], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(
    (diagnostic) => diagnostic.file && path.resolve(diagnostic.file.fileName) === path.resolve(fixturePath),
  );
  assert.deepEqual(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    [],
  );
});

test("runtime detector boundaries reject missing or unknown policies before image access", async () => {
  const missingPath = path.join(tempDir(), "must-not-be-opened.png");
  await assert.rejects(
    detectCardGeometry({ sourceImagePath: missingPath, side: "front" }),
    /detectionPolicy must be live_preview_fast or captured_evidence_full/,
  );
  await assert.rejects(
    detectCardGeometryFromBuffer({ imageBuffer: Buffer.alloc(0), side: "front" }),
    /detectionPolicy must be live_preview_fast or captured_evidence_full/,
  );
  await assert.rejects(
    detectAndNormalizeCardImage({
      sourceImagePath: missingPath,
      normalizedOutputPath: path.join(tempDir(), "must-not-be-written.png"),
      side: "front",
      detectionPolicy: "automatic",
    }),
    /detectionPolicy must be live_preview_fast or captured_evidence_full/,
  );
});

for (const shape of ["circle", "triangle", "hexagon"]) {
  test(`live preview exposes the observed dense ${shape} boundary without rectangular-shape admission`, async () => {
    const geometry = await detectCardGeometryFromBuffer({
      imageBuffer: await shapePreviewBuffer(shape),
      fileName: `${shape}.png`,
      side: "front",
      sourceImageId: `shape-${shape}`,
      sourceFrameId: `shape-${shape}-frame`,
      timestamp: "2026-07-25T00:00:00.000Z",
      detectionPolicy: LIVE_PREVIEW_POLICY,
    });
    assert.equal(geometry.geometrySource, "detected");
    assert.ok(geometry.observedDenseContour);
    assert.equal(geometry.observedDenseContour.coordinateFrame, "source_image_pixels");
    assert.equal(geometry.observedDenseContour.sourceAssetSha256.length, 64);
    assert.equal(geometry.observedDenseContour.contourSha256.length, 64);
    assert.ok(geometry.observedDenseContour.pointCount > 100);
    assert.ok(geometry.observedDenseContour.measurementsPx.width > 400);
    assert.ok(geometry.observedDenseContour.measurementsPx.height > 400);
  });
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function hasNoConsecutiveDuplicateContourPoints(points) {
  return points.every((point, index) => {
    const next = points[(index + 1) % points.length];
    return point.x !== next.x || point.y !== next.y;
  });
}

for (const shape of ["circle", "triangle", "hexagon"]) {
  test(`captured normalization preserves the complete ${shape} contour and its physical area`, async () => {
    const dir = tempDir();
    const rawPath = path.join(dir, `${shape}-raw.png`);
    const normalizedPath = path.join(dir, `${shape}-normalized.png`);
    fs.writeFileSync(rawPath, await shapePreviewBuffer(shape));
    const result = await detectAndNormalizeCardImage({
      sourceImagePath: rawPath,
      normalizedOutputPath: normalizedPath,
      side: "front",
      sourceImageId: `captured-${shape}`,
      sourceFrameId: `captured-${shape}-frame`,
      timestamp: "2026-07-25T00:00:00.000Z",
      detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    });
    assert.equal(result.geometry.placementState, "ready");
    assert.ok(result.geometry.observedDenseContour);
    assert.ok(result.normalizedArtifact?.normalizedDenseContour);
    const rawContour = result.geometry.observedDenseContour;
    const normalizedContour = result.normalizedArtifact.normalizedDenseContour;
    assert.equal(hasNoConsecutiveDuplicateContourPoints(rawContour.points), true);
    assert.equal(hasNoConsecutiveDuplicateContourPoints(normalizedContour.points), true);
    assert.equal(normalizedContour.pointCount, rawContour.pointCount);
    assert.equal(normalizedContour.sourceContourSha256, rawContour.contourSha256);
    assert.equal(
      normalizedContour.rawToNormalizedTransformSha256,
      result.normalizedArtifact.rawToNormalizedTransform.transformSha256,
    );
    assert.ok(normalizedContour.points.every(({ x, y }) =>
      x >= 0 && x <= NORMALIZED_CARD_WIDTH_PIXELS &&
      y >= 0 && y <= NORMALIZED_CARD_HEIGHT_PIXELS));
    const transformedArea = polygonArea(rawContour.points) *
      result.normalizedArtifact.scaleX *
      result.normalizedArtifact.scaleY;
    assert.ok(
      Math.abs(polygonArea(normalizedContour.points) - transformedArea) /
        Math.max(transformedArea, 1) < 0.0001,
      "the hash-bound normalized contour must preserve the complete physical shape",
    );
  });
}

test("live dense contour reports hash-bound calibrated millimeters and private U95 without a shape profile", async () => {
  const geometry = await detectCardGeometryFromBuffer({
    imageBuffer: await shapePreviewBuffer("circle"),
    fileName: "calibrated-circle.png",
    side: "front",
    sourceImageId: "calibrated-circle",
    sourceFrameId: "calibrated-circle-frame",
    timestamp: "2026-07-25T00:00:00.000Z",
    detectionPolicy: LIVE_PREVIEW_POLICY,
    sensorPlaneCalibration: {
      schemaVersion: "ten-kings-card-geometry-sensor-plane-calibration-v1",
      profileId: "test-exact-profile",
      calibrationVersion: "test-v1",
      calibrationArtifactSha256: "a".repeat(64),
      bundleManifestSha256: "b".repeat(64),
      sourceWidthPx: 800,
      sourceHeightPx: 1000,
      mmPerPixelX: 0.1,
      mmPerPixelY: 0.1,
      scaleRelativeU95: 0.005,
      segmentationBoundaryU95Px: 1.5,
      linearMeasurementU95Mm: 0.01,
    },
  });
  const measurement = geometry.observedDenseContour?.measurementsMm;
  assert.ok(measurement);
  assert.equal(measurement.measurementAuthoritySha256.length, 64);
  assert.ok(measurement.width > 49 && measurement.width < 51);
  assert.ok(measurement.height > 49 && measurement.height < 51);
  assert.ok(measurement.circularArcs.some((arc) => arc.radiusMm > 24 && arc.radiusMm < 26));
  assert.ok(measurement.privateUncertaintyU95.widthMm > 0);
  assert.equal(
    measurement.privateUncertaintyU95.basis,
    "calibrated_scale_boundary_and_repeatability_rss",
  );
});

test("a visible contour with less than two-percent strong support remains a real limited-quality measurement", async () => {
  const imageBuffer = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
      <rect width="800" height="1000" fill="#202226"/>
      <rect x="120" y="100" width="560" height="800" rx="20" fill="#222324"/>
      <rect x="397" y="100" width="6" height="10" fill="#dddddd"/>
    </svg>
  `)).png().toBuffer();
  const geometry = await detectCardGeometryFromBuffer({
    imageBuffer,
    fileName: "foggy-visible-contour.png",
    side: "front",
    sourceImageId: "foggy-visible-contour",
    sourceFrameId: "foggy-visible-contour-frame",
    timestamp: "2026-07-25T00:00:00.000Z",
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
  });

  assert.equal(
    geometry.placementState,
    "ready",
    JSON.stringify({
      reason: geometry.adjustmentReason,
      placement: geometry.placement,
      detection: geometry.detection,
      bounds: geometry.boundingBox,
      support: geometry.observedDenseContour?.strongSupportFraction,
      measurementsPx: geometry.observedDenseContour?.measurementsPx,
    }),
  );
  assert.ok(geometry.observedDenseContour);
  assert.equal(geometry.observedDenseContour.evidenceQuality, "limited");
  assert.ok(geometry.observedDenseContour.strongSupportFraction > 0);
  assert.ok(geometry.observedDenseContour.strongSupportFraction < 0.02);
});

async function imageRegionStats(filePath, rect) {
  const region = await sharp(filePath).extract(rect).png().toBuffer();
  return sharp(region).stats();
}

test("detects four front corners within close-enough offset and +10 degree skew, then writes a portrait lossless normalized PNG", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "front-raw.png");
  const normalizedPath = path.join(dir, "front-normalized.png");
  await writeSyntheticCard(rawPath, { angle: 10, offsetX: 45, offsetY: -20 });
  const rawBefore = fs.readFileSync(rawPath);

  const result = await detectAndNormalizeCardImage({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    normalizedOutputPath: normalizedPath,
    side: "front",
    sourceImageId: "report-001-front",
    sourceFrameId: "frame-front-42",
    timestamp: "2026-07-09T20:00:00.000Z",
  });

  assert.equal(result.geometry.side, "front");
  assert.equal(result.geometry.placementState, "ready");
  assert.equal(result.geometry.adjustmentReason, null);
  assert.equal(result.geometry.geometrySource, "detected");
  assert.equal(result.geometry.captureMode, "automatic_detection");
  assert.equal(result.geometry.confidenceBasis, "automatic_detection");
  assert.equal(result.geometry.detectionUsed, true);
  assert.equal(result.geometry.manualOverrideUsed, false);
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
  assert.equal(normalizedMetadata.width, NORMALIZED_CARD_WIDTH_PIXELS);
  assert.equal(normalizedMetadata.height, NORMALIZED_CARD_HEIGHT_PIXELS);
  assert.equal(result.normalizedArtifact.encodingLossless, true);
  assert.equal(typeof result.normalizedArtifact.geometricResamplingApplied, "boolean");
});

test("detects back geometry at negative skew and reports ready", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "back-raw.png");
  await writeSyntheticCard(rawPath, { angle: -10, offsetX: -35, offsetY: 25, card: "#e7e9ef" });

  const geometry = await detectCardGeometry({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
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

test("accepts a correctly oriented raw landscape card while retaining its right-angle transform rotation", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "landscape-raw.png");
  const normalizedPath = path.join(dir, "landscape-normalized.png");
  await writeSyntheticCard(rawPath, {
    width: 1000,
    height: 800,
    cardWidth: 700,
    cardHeight: 500,
  });

  const result = await detectAndNormalizeCardImage({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    normalizedOutputPath: normalizedPath,
    side: "front",
  });

  assert.equal(result.geometry.placementState, "ready");
  assert.ok(Math.abs(Math.abs(result.geometry.rotationDegrees) - 90) < 1.5);
  assert.ok(result.geometry.skewDegrees < 1.5);
  assert.equal(result.geometry.placement.withinSkewTolerance, true);
  assert.ok(result.normalizedArtifact);
  assert.ok(result.normalizedArtifact.imageWidth < result.normalizedArtifact.imageHeight);
});

test("Dell landscape normalization follows the clockwise operator preview and preserves printed top", async () => {
  const dir = tempDir();
  for (const angle of [-12, 0, 12]) {
    const rawPath = path.join(dir, `dell-landscape-${angle}.png`);
    const normalizedPath = path.join(dir, `dell-landscape-${angle}-normalized.png`);
    const svg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800">
        <rect width="1000" height="800" fill="#101214"/>
        <g transform="translate(500 400) rotate(${angle})">
          <rect x="-350" y="-250" width="700" height="500" rx="5" fill="#f3f1e9"/>
          <rect x="-305" y="-150" width="135" height="300" fill="#e21d32"/>
          <rect x="170" y="-150" width="135" height="300" fill="#154bd8"/>
        </g>
      </svg>
    `);
    await sharp(svg).png().toFile(rawPath);

    const result = await detectAndNormalizeCardImage({
      sourceImagePath: rawPath,
      detectionPolicy: CAPTURED_EVIDENCE_POLICY,
      normalizedOutputPath: normalizedPath,
      side: "front",
    });
    const [topStats, bottomStats] = await Promise.all([
      imageRegionStats(normalizedPath, { left: 350, top: 180, width: 500, height: 260 }),
      imageRegionStats(normalizedPath, { left: 350, top: 1240, width: 500, height: 260 }),
    ]);

    assert.equal(result.geometry.placementState, "ready", `raw landscape angle ${angle} should be Ready`);
    assert.ok(topStats.channels[0].mean > topStats.channels[2].mean, `angle ${angle} should keep operator-top red at canonical top`);
    assert.ok(bottomStats.channels[2].mean > bottomStats.channels[0].mean, `angle ${angle} should keep operator-bottom blue at canonical bottom`);
  }
});

test("requires adjustment when a card is sideways instead of silently guessing semantic orientation", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "portrait-frame-sideways-card.png");
  await writeSyntheticCard(rawPath, { cardWidth: 616, cardHeight: 440 });

  const geometry = await detectCardGeometry({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });

  assert.equal(geometry.placementState, "adjust_card");
  assert.ok(Math.abs(Math.abs(geometry.rotationDegrees) - 90) < 1.5);
  assert.ok(geometry.skewDegrees > 88);
  assert.equal(geometry.placement.withinSkewTolerance, false);
  assert.equal(geometry.placement.withinNormalizationSkewTolerance, false);
  assert.equal(geometry.semanticOrientation.basis, "operator_top_toward_preview_top");
  assert.equal(geometry.semanticOrientation.contentUprightVerified, false);
});

test("center offset and ordinary in-plane rotation remain diagnostic and do not block safe normalization", async () => {
  const dir = tempDir();
  const skewedPath = path.join(dir, "skewed.png");
  const offsetPath = path.join(dir, "offset.png");
  await writeSyntheticCard(skewedPath, { angle: 14 });
  await writeSyntheticCard(offsetPath, { angle: 2, offsetX: 115 });

  const skewed = await detectCardGeometry({
    sourceImagePath: skewedPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });
  const offset = await detectCardGeometry({
    sourceImagePath: offsetPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });
  const relaxed = await detectCardGeometry({
    sourceImagePath: skewedPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
    thresholds: { maxSkewDegrees: 15 },
  });

  assert.equal(skewed.placementState, "ready");
  assert.equal(skewed.placement.withinSkewTolerance, false);
  assert.equal(skewed.placement.withinNormalizationSkewTolerance, true);
  assert.ok(skewed.detectedCorners);
  assert.equal(offset.placementState, "ready");
  assert.equal(offset.placement.withinCenterTolerance, false);
  assert.ok(offset.detectedCorners);
  assert.equal(relaxed.placementState, "ready");
  assert.equal(relaxed.placement.maxSkewDegrees, 15);
});

test("detects solid cards on both matte black and matte white base plates", async () => {
  const dir = tempDir();
  const cases = [
    { name: "black-plate", background: "#050607", card: "#f4f2ed" },
    { name: "white-plate", background: "#f5f4f1", card: "#14171b" },
  ];
  for (const entry of cases) {
    const rawPath = path.join(dir, `${entry.name}.png`);
    await writeSyntheticCard(rawPath, { ...entry, details: false, angle: 7, offsetX: 55 });
    const geometry = await detectCardGeometry({
      sourceImagePath: rawPath,
      detectionPolicy: CAPTURED_EVIDENCE_POLICY,
      side: "front",
    });
    assert.equal(
      geometry.placementState,
      "ready",
      `${entry.name} should be Ready: ${JSON.stringify({
        detection: geometry.detection,
        warnings: geometry.warnings,
        measurementsPx: geometry.observedDenseContour?.measurementsPx,
      })}`,
    );
    assert.equal(geometry.geometrySource, "detected");
    assert.equal(geometry.detection.method, "solid_plate_color_component_pca_v2");
    assert.ok(geometry.confidence >= geometry.placement.minReadyConfidence);
    assert.ok(geometry.detectedCorners);
  }
});

test("a card sized to the production 97%-height portrait guide remains inside the Ready scale envelope", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "production-guide-scale.png");
  const frameWidth = 1000;
  const frameHeight = 1200;
  const cardHeight = frameHeight * 0.97;
  const cardWidth = cardHeight * (2.5 / 3.5);
  await writeSyntheticCard(rawPath, {
    width: frameWidth,
    height: frameHeight,
    cardWidth,
    cardHeight,
    details: false,
  });

  const geometry = await detectCardGeometry({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });

  assert.ok(geometry.placement.cardCoverage > 0.8);
  assert.equal(geometry.placement.withinCoverageTolerance, true);
  assert.equal(geometry.placement.withinFrame, true);
  assert.equal(geometry.placementState, "ready");
});

test("synthetic outer-corner localization stays close to known rotated-card ground truth", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "known-corners.png");
  const width = 800;
  const height = 1000;
  const cardWidth = 440;
  const cardHeight = 616;
  const offsetX = 37;
  const offsetY = -29;
  const angle = 11;
  await writeSyntheticCard(rawPath, { width, height, cardWidth, cardHeight, offsetX, offsetY, angle, details: false });

  const geometry = await detectCardGeometry({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });
  const radians = angle * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = width / 2 + offsetX;
  const centerY = height / 2 + offsetY;
  const transform = (x, y) => ({
    x: centerX + x * cosine - y * sine,
    y: centerY + x * sine + y * cosine,
  });
  const expected = {
    topLeft: transform(-cardWidth / 2, -cardHeight / 2),
    topRight: transform(cardWidth / 2, -cardHeight / 2),
    bottomRight: transform(cardWidth / 2, cardHeight / 2),
    bottomLeft: transform(-cardWidth / 2, cardHeight / 2),
  };

  assert.equal(geometry.placementState, "ready");
  for (const key of ["topLeft", "topRight", "bottomRight", "bottomLeft"]) {
    const actual = geometry.detectedCorners[key];
    const error = Math.hypot(actual.x - expected[key].x, actual.y - expected[key].y);
    assert.ok(error < 8, `${key} error ${error.toFixed(2)} px exceeded synthetic tolerance`);
  }
});

test("expected scale and aspect remain advisory when a complete physical contour is visible", async () => {
  const dir = tempDir();
  const tinyPath = path.join(dir, "tiny-card.png");
  const matchingBorderPath = path.join(dir, "matching-border.png");
  await writeSyntheticCard(tinyPath, { cardWidth: 300, cardHeight: 420, details: false });
  const matchingBorderSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
      <rect width="800" height="1000" fill="#f5f5f3"/>
      <rect x="180" y="192" width="440" height="616" rx="5" fill="#f5f5f3"/>
      <rect x="260" y="304" width="280" height="392" fill="#24364f"/>
    </svg>
  `);
  await sharp(matchingBorderSvg).png().toFile(matchingBorderPath);

  const tiny = await detectCardGeometry({
    sourceImagePath: tinyPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });
  const matchingBorder = await detectCardGeometry({
    sourceImagePath: matchingBorderPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });

  assert.equal(tiny.placementState, "ready");
  assert.equal(tiny.adjustmentReason, null);
  assert.equal(tiny.placement.withinCoverageTolerance, false);
  assert.ok(tiny.observedDenseContour);
  assert.equal(matchingBorder.placementState, "ready");
  assert.equal(matchingBorder.placement.withinCoverageTolerance, false);
  assert.ok(matchingBorder.observedDenseContour);
  assert.match(matchingBorder.warnings.join(" "), /comparison profile|coverage/i);
});

test("color-aware plate subtraction detects a low-luma-contrast card", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "similar-color-card.png");
  await writeSyntheticCard(rawPath, {
    background: "#17191d",
    card: "#20242c",
    details: false,
    angle: -6,
    offsetY: 38,
  });

  const geometry = await detectCardGeometry({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "back",
  });

  assert.equal(geometry.placementState, "ready");
  assert.equal(geometry.geometrySource, "detected");
  assert.ok(geometry.detectedCorners);
  assert.ok((geometry.detection.backgroundColor?.r ?? 255) < 40);
});

test("live dense contour detects a dark Back across a strong smooth illumination falloff", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "uneven-dark-back.png");
  await writeUnevenDarkBackCard(rawPath);

  const geometry = await detectCardGeometry({
    sourceImagePath: rawPath,
    detectionPolicy: LIVE_PREVIEW_POLICY,
    side: "back",
  });

  assert.equal(geometry.placementState, "ready");
  assert.equal(geometry.geometrySource, "detected");
  assert.ok(geometry.observedDenseContour);
  assert.ok(geometry.observedDenseContour.strongSupportFraction > 0);
  assert.ok(Math.min(
    geometry.observedDenseContour.measurementsPx.width,
    geometry.observedDenseContour.measurementsPx.height,
  ) > 520);
  assert.ok(Math.max(
    geometry.observedDenseContour.measurementsPx.width,
    geometry.observedDenseContour.measurementsPx.height,
  ) > 820);
});

test("dense material contour normalizes a dark captured perimeter without selecting bright artwork", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "dark-perimeter-captured-frame.png");
  const normalizedPath = path.join(dir, "dark-perimeter-normalized.png");
  await writeDarkPerimeterCard(rawPath, { angle: -3, offsetX: 24, offsetY: -12 });
  const rawBefore = fs.readFileSync(rawPath);

  const result = await detectAndNormalizeCardImage({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    normalizedOutputPath: normalizedPath,
    side: "front",
  });

  assert.equal(result.geometry.placementState, "ready");
  assert.equal(result.geometry.geometrySource, "detected");
  assert.equal(result.geometry.detection.method, "solid_plate_color_component_pca_v2");
  assert.ok(result.geometry.observedDenseContour);
  assert.ok(Math.min(
    result.geometry.observedDenseContour.measurementsPx.width,
    result.geometry.observedDenseContour.measurementsPx.height,
  ) > 650);
  assert.ok(Math.max(
    result.geometry.observedDenseContour.measurementsPx.width,
    result.geometry.observedDenseContour.measurementsPx.height,
  ) > 900);
  assert.ok(result.geometry.detectedCorners);
  assert.ok(result.normalizedArtifact);
  assert.deepEqual(fs.readFileSync(rawPath), rawBefore);
  assert.equal(result.rawEvidencePreserved, true);
  assert.equal((await sharp(normalizedPath).metadata()).width, NORMALIZED_CARD_WIDTH_PIXELS);
  assert.equal((await sharp(normalizedPath).metadata()).height, NORMALIZED_CARD_HEIGHT_PIXELS);
});

test("dense material contour survives directional exterior lighting without a global polarity assumption", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "directional-perimeter.png");
  const normalizedPath = path.join(dir, "directional-perimeter-normalized.png");
  await writeDirectionalPerimeterCard(rawPath);

  const result = await detectAndNormalizeCardImage({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    normalizedOutputPath: normalizedPath,
    side: "front",
  });

  assert.equal(result.geometry.placementState, "ready");
  assert.equal(result.geometry.detection.method, "solid_plate_color_component_pca_v2");
  assert.ok(result.geometry.observedDenseContour);
  assert.ok(Math.min(
    result.geometry.observedDenseContour.measurementsPx.width,
    result.geometry.observedDenseContour.measurementsPx.height,
  ) > 650);
  assert.ok(Math.max(
    result.geometry.observedDenseContour.measurementsPx.width,
    result.geometry.observedDenseContour.measurementsPx.height,
  ) > 900);
  assert.equal((await sharp(normalizedPath).metadata()).width, NORMALIZED_CARD_WIDTH_PIXELS);
  assert.equal((await sharp(normalizedPath).metadata()).height, NORMALIZED_CARD_HEIGHT_PIXELS);
});

test("dense-contour authority fails closed on deterministic full-frame texture with no card", async () => {
  const geometry = await detectCardGeometryFromBuffer({
    imageBuffer: await deterministicTexturedNoCardBuffer(),
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
    sourceFrameId: "textured-no-card",
  });

  assert.equal(geometry.placementState, "not_detected");
  assert.equal(geometry.detectedCorners, null);
  assert.equal(geometry.detection.method, "solid_plate_color_component_pca_v2");
  assert.equal(geometry.observedDenseContour, undefined);
});

test("a frame-connected glare network cannot authorize a false enclosed contour", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "frame-connected-glare-network.png");
  await writeFrameConnectedGlareNetworkCard(rawPath);

  const geometry = await detectCardGeometry({
    sourceImagePath: rawPath,
    detectionPolicy: LIVE_PREVIEW_POLICY,
    side: "front",
  });

  assert.equal(geometry.placementState, "not_detected");
  assert.equal(geometry.geometrySource, "none");
  assert.equal(geometry.observedDenseContour, undefined);
  assert.match(geometry.warnings.join(" "), /camera frame|enclosed material region/i);
});

test("a fully visible card beyond the placement guides is Ready, while a clipped card is Adjust Card", async () => {
  const dir = tempDir();
  const flexiblePath = path.join(dir, "flexible-placement.png");
  const clippedPath = path.join(dir, "clipped-placement.png");
  await writeSyntheticCard(flexiblePath, { angle: 17, offsetX: 90 });
  await writeSyntheticCard(clippedPath, { angle: 0, offsetX: -227 });

  const flexible = await detectCardGeometry({
    sourceImagePath: flexiblePath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });
  const clipped = await detectCardGeometry({
    sourceImagePath: clippedPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });

  assert.equal(flexible.placementState, "ready");
  assert.equal(
    flexible.placement.withinCenterTolerance,
    false,
    JSON.stringify({
      corners: flexible.corners,
      bounds: flexible.boundingBox,
      placement: flexible.placement,
      measurementsPx: flexible.observedDenseContour?.measurementsPx,
    }),
  );
  assert.equal(flexible.placement.withinSkewTolerance, false);
  assert.equal(flexible.placement.withinNormalizationSkewTolerance, true);
  assert.equal(flexible.placement.withinFrame, true);
  assert.equal(
    clipped.geometrySource,
    "none",
    JSON.stringify({
      placementState: clipped.placementState,
      bounds: clipped.boundingBox,
      measurementsPx: clipped.observedDenseContour?.measurementsPx,
      warnings: clipped.warnings,
    }),
  );
  assert.equal(clipped.placementState, "not_detected");
  assert.equal(clipped.adjustmentReason, "not_detected");
  assert.equal(clipped.observedDenseContour, undefined);
});

test("the broad rotation envelope allows close-enough placement but fails closed beyond safe normalization", async () => {
  const dir = tempDir();
  const withinPath = path.join(dir, "rotation-within-envelope.png");
  const beyondPath = path.join(dir, "rotation-beyond-envelope.png");
  await writeSyntheticCard(withinPath, { angle: 34, offsetX: 24 });
  await writeSyntheticCard(beyondPath, { angle: 40 });

  const within = await detectCardGeometry({
    sourceImagePath: withinPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });
  const beyond = await detectCardGeometry({
    sourceImagePath: beyondPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });

  assert.equal(within.placementState, "ready");
  assert.equal(within.placement.withinSkewTolerance, false);
  assert.equal(within.placement.withinNormalizationSkewTolerance, true);
  assert.equal(within.placement.maxNormalizationSkewDegrees, 35);
  assert.equal(beyond.placementState, "adjust_card");
  assert.equal(beyond.adjustmentReason, "rotate_top_up");
  assert.equal(beyond.geometrySource, "detected");
  assert.equal(beyond.placement.withinNormalizationSkewTolerance, false);
  assert.match(beyond.warnings.join(" "), /outside the safe automatic-normalization envelope/i);
});

test("normalization keeps an operator-top marker at the canonical top for allowed rotation", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "semantic-top-raw.png");
  const normalizedPath = path.join(dir, "semantic-top-normalized.png");
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
      <rect width="800" height="1000" fill="#101214"/>
      <g transform="translate(400 500) rotate(24)">
        <rect x="-220" y="-308" width="440" height="616" rx="5" fill="#f3f1e9"/>
        <rect x="-135" y="-258" width="270" height="120" fill="#e21d32"/>
        <rect x="-135" y="138" width="270" height="120" fill="#154bd8"/>
      </g>
    </svg>
  `);
  await sharp(svg).png().toFile(rawPath);

  const result = await detectAndNormalizeCardImage({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    normalizedOutputPath: normalizedPath,
    side: "front",
  });
  const [topStats, bottomStats] = await Promise.all([
    imageRegionStats(normalizedPath, { left: 300, top: 200, width: 600, height: 200 }),
    imageRegionStats(normalizedPath, { left: 300, top: 1300, width: 600, height: 200 }),
  ]);

  assert.equal(result.geometry.placementState, "ready");
  assert.equal(result.geometry.semanticOrientation.contentUprightVerified, false);
  assert.ok(topStats.channels[0].mean > topStats.channels[2].mean, "operator-top region should retain the red top marker");
  assert.ok(bottomStats.channels[2].mean > bottomStats.channels[0].mean, "canonical bottom should retain the blue bottom marker");
});

test("normalization emits the fixed 1200x1680 coordinate space and records interpolation without changing raw bytes", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "small-raw.png");
  const normalizedPath = path.join(dir, "small-normalized.png");
  await writeSyntheticCard(rawPath, {
    width: 240,
    height: 320,
    cardWidth: 140,
    cardHeight: 196,
    details: false,
    angle: 4,
  });
  const rawBefore = fs.readFileSync(rawPath);

  const result = await detectAndNormalizeCardImage({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    normalizedOutputPath: normalizedPath,
    side: "front",
  });
  const metadata = await sharp(normalizedPath).metadata();

  assert.ok(result.normalizedArtifact);
  assert.equal(metadata.width, NORMALIZED_CARD_WIDTH_PIXELS);
  assert.equal(metadata.height, NORMALIZED_CARD_HEIGHT_PIXELS);
  assert.equal(result.normalizedArtifact.upscaled, true);
  assert.equal(result.normalizedArtifact.geometricResamplingApplied, true);
  // Dense-contour normalization retains a small exterior safety margin instead
  // of clipping the measured edge to the old four-corner crop.
  assert.ok(result.normalizedArtifact.sourceCropWidth >= 140);
  assert.ok(result.normalizedArtifact.sourceCropWidth <= 154);
  assert.ok(result.normalizedArtifact.sourceCropHeight >= 196);
  assert.ok(result.normalizedArtifact.sourceCropHeight <= 210);
  assert.ok(result.normalizedArtifact.scaleX > 1);
  assert.ok(result.normalizedArtifact.scaleY > 1);
  assert.ok(Math.abs(
    result.normalizedArtifact.scaleX - result.normalizedArtifact.scaleY,
  ) < 0.01, "physical shape must not be stretched to the 5:7 envelope");
  assert.equal(
    result.normalizedArtifact.rawToNormalizedTransform.outputPlacement.fit,
    "contain_preserve_physical_shape",
  );
  assert.ok(result.normalizedArtifact.normalizedDenseContour);
  assert.ok(result.normalizedArtifact.normalizedDenseContour.points.every(({ x, y }) =>
    x >= 0 && x <= NORMALIZED_CARD_WIDTH_PIXELS &&
    y >= 0 && y <= NORMALIZED_CARD_HEIGHT_PIXELS));
  assert.equal(result.rawEvidencePreserved, true);
  assert.deepEqual(fs.readFileSync(rawPath), rawBefore);
});

test("reuses one Ready geometry transform on another same-dimension forensic frame", async () => {
  const dir = tempDir();
  const geometryPath = path.join(dir, "all-on.png");
  const channelPath = path.join(dir, "channel-1.png");
  const mismatchPath = path.join(dir, "mismatch.png");
  const normalizedPath = path.join(dir, "channel-1-normalized.png");
  await writeSyntheticCard(geometryPath, { angle: 16, offsetX: 80 });
  await writeSyntheticCard(channelPath, {
    angle: 16,
    offsetX: 80,
    card: "#d8e5f4",
    detailOne: "#5f7b9d",
    detailTwo: "#1c2c44",
  });
  await writeSyntheticCard(mismatchPath, { width: 810, height: 1000 });
  const channelRawBefore = fs.readFileSync(channelPath);
  const geometry = await detectCardGeometry({
    sourceImagePath: geometryPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
  });

  const result = await normalizeCardImageWithGeometry({
    sourceImagePath: channelPath,
    normalizedOutputPath: normalizedPath,
    geometry,
  });
  const metadata = await sharp(normalizedPath).metadata();

  assert.equal(result.rawEvidencePreserved, true);
  assert.deepEqual(fs.readFileSync(channelPath), channelRawBefore);
  assert.equal(result.normalizedArtifact.sourceSha256, result.rawArtifact.sha256);
  assert.equal(metadata.width, NORMALIZED_CARD_WIDTH_PIXELS);
  assert.equal(metadata.height, NORMALIZED_CARD_HEIGHT_PIXELS);
  await assert.rejects(
    normalizeCardImageWithGeometry({
      sourceImagePath: mismatchPath,
      normalizedOutputPath: path.join(dir, "must-not-normalize.png"),
      geometry,
    }),
    /dimensions must exactly match/,
  );
});

test("live preview and captured evidence use only the dense low-contrast material contour", async () => {
  const dir = tempDir();
  const darkPerimeterPath = path.join(dir, "policy-dark-perimeter.png");
  await writeDarkPerimeterCard(darkPerimeterPath, { angle: -3, offsetX: 24, offsetY: -12 });
  const imageBuffer = fs.readFileSync(darkPerimeterPath);
  const liveAttempts = [];
  const capturedAttempts = [];
  const startedAt = performance.now();
  const controllerIoTicks = [];
  const controllerIoTimer = setInterval(() => controllerIoTicks.push(performance.now()), 25);

  let live;
  try {
    live = await detectCardGeometryFromBuffer({
      imageBuffer,
      detectionPolicy: LIVE_PREVIEW_POLICY,
      side: "front",
      sourceFrameId: "live-policy-frame",
      onDetectionAttempt: (observation) => liveAttempts.push(observation),
    });
  } finally {
    clearInterval(controllerIoTimer);
  }
  const completedAt = performance.now();
  const liveElapsedMs = completedAt - startedAt;
  const controllerIoCheckpoints = [startedAt, ...controllerIoTicks, completedAt];
  const longestControllerIoGapMs = Math.max(
    ...controllerIoCheckpoints.slice(1).map((value, index) => value - controllerIoCheckpoints[index]),
  );
  const captured = await detectCardGeometryFromBuffer({
    imageBuffer,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    side: "front",
    sourceFrameId: "captured-policy-frame",
    onDetectionAttempt: (observation) => capturedAttempts.push(observation),
  });

  assert.equal(live.detectionPolicy, LIVE_PREVIEW_POLICY);
  assert.equal(live.placementState, "ready");
  assert.equal(live.detection.method, "solid_plate_color_component_pca_v2");
  assert.deepEqual(liveAttempts.map(({ method }) => method), [
    "solid_plate_color_component_pca_v2",
  ]);
  assert.ok(live.observedDenseContour);
  assert.ok(
    liveElapsedMs < 1_800,
    `live perimeter detection exceeded the two-second retained-frame window: ${liveElapsedMs.toFixed(1)} ms`,
  );
  assert.equal(captured.detectionPolicy, CAPTURED_EVIDENCE_POLICY);
  assert.equal(captured.placementState, "ready");
  assert.equal(captured.detection.method, "solid_plate_color_component_pca_v2");
  assert.deepEqual(capturedAttempts.map(({ method }) => method), [
    "solid_plate_color_component_pca_v2",
  ]);
  for (const observation of [...liveAttempts, ...capturedAttempts]) {
    assert.equal(Number.isFinite(observation.elapsedMs), true);
    assert.ok(observation.elapsedMs >= 0);
    assert.ok(observation.elapsedMs <= 300_000);
    assert.equal(Object.isFrozen(observation), true);
  }
});

test("detector timing observation is non-authoritative and has no wall-clock acceptance threshold", async () => {
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1680">
      <rect width="1200" height="1680" fill="#08090a"/>
      <g transform="translate(650 820) rotate(12)">
        <rect x="-350" y="-490" width="700" height="980" rx="12" fill="#eeeae0"/>
        <rect x="-290" y="-420" width="580" height="840" fill="#315079"/>
      </g>
    </svg>
  `);
  const previewJpeg = await sharp(svg).jpeg({ quality: 72 }).toBuffer();
  let observationCount = 0;
  const geometry = await detectCardGeometryFromBuffer({
    imageBuffer: previewJpeg,
    detectionPolicy: LIVE_PREVIEW_POLICY,
    side: "front",
    sourceFrameId: "observer-does-not-control-result",
    thresholds: { analysisMaxDimension: 768 },
    onDetectionAttempt: () => {
      observationCount += 1;
      throw new Error("diagnostic observers cannot alter results");
    },
  });

  assert.equal(geometry.placementState, "ready");
  assert.equal(geometry.detectionPolicy, LIVE_PREVIEW_POLICY);
  assert.equal(observationCount, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(geometry, "timing"), false);
});

test("live_preview_fast stays within the practical preview software budget", async (t) => {
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1680">
      <rect width="1200" height="1680" fill="#08090a"/>
      <g transform="translate(650 820) rotate(12)">
        <rect x="-350" y="-490" width="700" height="980" rx="12" fill="#eeeae0"/>
        <rect x="-290" y="-420" width="580" height="840" fill="#315079"/>
      </g>
    </svg>
  `);
  const previewJpeg = await sharp(svg).jpeg({ quality: 72 }).toBuffer();
  await detectCardGeometryFromBuffer({
    imageBuffer: previewJpeg,
    detectionPolicy: LIVE_PREVIEW_POLICY,
    side: "front",
    thresholds: { analysisMaxDimension: 768 },
  });
  const startedAt = performance.now();
  const results = [];
  for (let index = 0; index < 3; index += 1) {
    results.push(await detectCardGeometryFromBuffer({
      imageBuffer: previewJpeg,
      detectionPolicy: LIVE_PREVIEW_POLICY,
      side: "front",
      sourceFrameId: `fast-preview-${index}`,
      thresholds: { analysisMaxDimension: 768 },
    }));
  }
  const elapsedMs = performance.now() - startedAt;
  const averageMs = elapsedMs / results.length;

  assert.ok(results.every((geometry) => geometry.placementState === "ready"));
  assert.ok(results.every((geometry) => geometry.detection.method === "solid_plate_color_component_pca_v2"));
  assert.ok(elapsedMs < 1500, `three fast preview detections took ${elapsedMs.toFixed(1)} ms`);
  t.diagnostic(`software timing: live_preview_fast average=${averageMs.toFixed(1)}ms total=${elapsedMs.toFixed(1)}ms over 3 frames`);
});

test("empty black, white, and gently shaded solid plates remain fail-closed Not Detected", async () => {
  const dir = tempDir();
  const blackPath = path.join(dir, "empty-black.png");
  const whitePath = path.join(dir, "empty-white.png");
  const shadedPath = path.join(dir, "empty-shaded.png");
  await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#070809" } }).png().toFile(blackPath);
  await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#f5f5f3" } }).png().toFile(whitePath);
  await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
      <defs><radialGradient id="plate"><stop offset="0" stop-color="#202226"/><stop offset="1" stop-color="#17191d"/></radialGradient></defs>
      <rect width="800" height="1000" fill="url(#plate)"/>
    </svg>
  `)).png().toFile(shadedPath);

  for (const sourceImagePath of [blackPath, whitePath, shadedPath]) {
    const geometry = await detectCardGeometry({
      sourceImagePath,
      detectionPolicy: CAPTURED_EVIDENCE_POLICY,
      side: "front",
    });
    assert.equal(
      geometry.placementState,
      "not_detected",
      `${path.basename(sourceImagePath)} must remain empty: ${JSON.stringify({
        detection: geometry.detection,
        bounds: geometry.boundingBox,
        support: geometry.observedDenseContour?.strongSupportFraction,
        measurementsPx: geometry.observedDenseContour?.measurementsPx,
      })}`,
    );
    assert.equal(geometry.geometrySource, "none");
    assert.equal(geometry.detectionUsed, false);
  }
});

test("returns not_detected without emitting a normalized artifact or honoring legacy automatic fallback input", async () => {
  const dir = tempDir();
  const rawPath = path.join(dir, "blank.png");
  const normalizedPath = path.join(dir, "blank-normalized.png");
  await writeBlank(rawPath);

  const result = await detectAndNormalizeCardImage({
    sourceImagePath: rawPath,
    detectionPolicy: CAPTURED_EVIDENCE_POLICY,
    normalizedOutputPath: normalizedPath,
    side: "front",
    // This legacy property is deliberately ignored. Manual geometry now needs
    // the explicit manualOverride action below.
    manualFallback: { rect: { x: 225, y: 255, width: 350, height: 490 } },
  });

  assert.equal(result.geometry.placementState, "not_detected");
  assert.equal(result.geometry.geometrySource, "none");
  assert.equal(result.geometry.captureMode, "none");
  assert.equal(result.geometry.manualOverrideUsed, false);
  assert.equal(result.geometry.corners, null);
  assert.equal(result.normalizedArtifact, undefined);
  assert.equal(fs.existsSync(normalizedPath), false);
  assert.equal(result.rawEvidencePreserved, true);
});
