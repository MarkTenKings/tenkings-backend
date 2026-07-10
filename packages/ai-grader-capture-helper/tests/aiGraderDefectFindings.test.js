const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const {
  createStableAiGraderDefectFindingId,
  extractAiGraderDefectFindingsV1,
} = require("../dist/drivers/aiGraderDefectFindings");
const { projectFixedRigDisplayRectToNormalizedCardGeometry } = require("../dist/drivers/fixedRigSurfaceIntelligence");
const { detectAndNormalizeCardImage } = require("../dist/drivers/cardGeometry");
const drivers = require("../dist/drivers");
const SOURCE_SHA256 = "a".repeat(64);
const NORMALIZED_ARTIFACT_SHA256 = "c".repeat(64);

function analysisCandidate(overrides = {}) {
  return {
    candidateId: "back-surface-intelligence-v0-001",
    category: "surface",
    severityProxy: 74.25,
    severityBand: "high",
    confidence: 0.82,
    analysisGeometry: {
      coordinateFrame: "normalized_card",
      units: "fraction",
      shape: { type: "box", x: 0.1, y: 0.2, width: 0.25, height: 0.125 },
    },
    ...overrides,
  };
}

function analysisWith(candidate, duplicateInVisionLab = false) {
  const analysis = {
    surfaceIntelligence: {
      detectorId: "preliminary_surface_intelligence_v0",
      back: {
        version: "preliminary_surface_intelligence_v0",
        captureProfileVersion: "ten-kings-fixed-rig-production-fast-v1",
        confidence: { score: 0.77 },
        candidates: [candidate],
      },
    },
  };
  if (duplicateInVisionLab) {
    analysis.visionLab = {
      sides: {
        back: {
          surfaceIntelligence: {
            detectorId: "preliminary_surface_intelligence_v0",
            version: "preliminary_surface_intelligence_v0",
            captureProfileVersion: "ten-kings-fixed-rig-production-fast-v1",
          },
          candidates: [candidate],
        },
      },
    };
  }
  return analysis;
}

test("extractor emits a bounded normalized-card finding with approved asset joins", () => {
  const knownAssetIds = new Set(["back/normalized-card.png", "back/heatmap.png"]);
  const result = extractAiGraderDefectFindingsV1(analysisWith(analysisCandidate()), {
    knownAssetIds,
    requireTrueViewAsset: true,
    approvedEvidenceBySide: {
      back: {
        trueViewAssetId: "back/normalized-card.png",
        heatmapAssetId: "back/heatmap.png",
      },
    },
  });

  assert.deepEqual(result.issues, []);
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.match(finding.findingId, /^dfv1_[a-f0-9]{24}$/);
  assert.equal(finding.category, "surface_anomaly");
  assert.deepEqual(finding.geometry.shape, { type: "box", x: 0.1, y: 0.2, width: 0.25, height: 0.125 });
  assert.equal(finding.evidence.trueViewAssetId, "back/normalized-card.png");
  assert.equal(finding.detector.captureProfileVersion, "ten-kings-fixed-rig-production-fast-v1");
  assert.equal(finding.review.status, "unreviewed");
  assert.equal(result.sourceCandidateCount, 1);
});

test("extractor never substitutes detector id for a missing version and requires capture-profile metadata", () => {
  const missingId = analysisWith(analysisCandidate());
  delete missingId.surfaceIntelligence.detectorId;
  const idResult = extractAiGraderDefectFindingsV1(missingId);
  assert.equal(idResult.findings.length, 0);
  assert.equal(idResult.sourceCandidateCount, 1);
  assert.equal(idResult.issues.some((entry) => entry.path.endsWith(".detectorId")), true);

  const missingVersion = analysisWith(analysisCandidate());
  delete missingVersion.surfaceIntelligence.back.version;
  const versionResult = extractAiGraderDefectFindingsV1(missingVersion);
  assert.equal(versionResult.findings.length, 0);
  assert.equal(versionResult.sourceCandidateCount, 1);
  assert.equal(versionResult.issues.some((entry) => entry.path.endsWith(".version")), true);

  const missingCaptureProfile = analysisWith(analysisCandidate());
  delete missingCaptureProfile.surfaceIntelligence.back.captureProfileVersion;
  const profileResult = extractAiGraderDefectFindingsV1(missingCaptureProfile);
  assert.equal(profileResult.findings.length, 0);
  assert.equal(profileResult.sourceCandidateCount, 1);
  assert.equal(profileResult.issues.some((entry) => entry.path.endsWith(".captureProfileVersion")), true);
});

test("extractor treats a genuine zero-candidate analysis as valid without detector metadata", () => {
  const result = extractAiGraderDefectFindingsV1({
    surfaceIntelligence: { back: { candidates: [] } },
  });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.issues, []);
  assert.equal(result.sourceCandidateCount, 0);
});

test("stable finding IDs ignore transient candidate details and duplicate projections", () => {
  const first = analysisCandidate();
  const second = analysisCandidate({
    candidateId: "renumbered-candidate",
    severityProxy: 41,
    severityBand: "medium",
    confidence: 0.31,
    evidenceRefs: { localPath: "C:\\capture-data\\private.png", data: "data:image/png;base64,secret" },
    rawRect: { x: 400, y: 500, width: 25, height: 30 },
  });
  const firstResult = extractAiGraderDefectFindingsV1(analysisWith(first, true));
  const secondResult = extractAiGraderDefectFindingsV1(analysisWith(second));

  assert.equal(firstResult.findings.length, 1);
  assert.equal(firstResult.sourceCandidateCount, 1);
  assert.equal(firstResult.findings[0].findingId, secondResult.findings[0].findingId);
  const serialized = JSON.stringify(secondResult.findings);
  assert.doesNotMatch(serialized, /capture-data|data:image|rawRect|evidenceRefs|renumbered/);
});

test("extractor fails closed without normalized-card geometry or with dangling evidence", () => {
  const noGeometry = extractAiGraderDefectFindingsV1(
    analysisWith(analysisCandidate({ analysisGeometry: undefined, displayRect: { x: 1, y: 2, width: 3, height: 4 } })),
  );
  assert.equal(noGeometry.findings.length, 0);
  assert.match(noGeometry.issues[0].message, /normalized-card geometry/);

  const dangling = extractAiGraderDefectFindingsV1(analysisWith(analysisCandidate()), {
    knownAssetIds: new Set(["back/normalized-card.png"]),
    requireTrueViewAsset: true,
    approvedEvidenceBySide: { back: { trueViewAssetId: "back/missing.png" } },
  });
  assert.equal(dangling.findings.length, 0);
  assert.equal(dangling.issues.some((entry) => /published image asset/.test(entry.message)), true);
});

test("stable ID changes when detector, side, or geometry changes", () => {
  const base = {
    side: "front",
    category: "scratch",
    detector: { id: "surface-v1", version: "1.0.0" },
    geometry: {
      coordinateFrame: "normalized_card",
      units: "fraction",
      shape: { type: "box", x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
    },
  };
  const baseId = createStableAiGraderDefectFindingId(base);
  assert.notEqual(baseId, createStableAiGraderDefectFindingId({ ...base, side: "back" }));
  assert.notEqual(baseId, createStableAiGraderDefectFindingId({ ...base, detector: { id: "surface-v2", version: "2.0.0" } }));
  assert.notEqual(
    baseId,
    createStableAiGraderDefectFindingId({
      ...base,
      geometry: { ...base.geometry, shape: { ...base.geometry.shape, x: 0.11 } },
    }),
  );
  assert.equal(
    baseId,
    createStableAiGraderDefectFindingId({
      category: base.category,
      side: base.side,
      detector: { version: "1.0.0", id: "surface-v1" },
      geometry: {
        units: "fraction",
        shape: { height: 0.1, width: 0.3, y: 0.2, x: 0.1, type: "box" },
        coordinateFrame: "normalized_card",
      },
    }),
  );

  const polygon = {
    coordinateFrame: "normalized_card",
    units: "fraction",
    shape: {
      type: "polygon",
      points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.6 }, { x: 0.1, y: 0.6 }],
    },
  };
  const polygonId = createStableAiGraderDefectFindingId({ ...base, geometry: polygon });
  assert.equal(
    polygonId,
    createStableAiGraderDefectFindingId({
      ...base,
      geometry: { ...polygon, shape: { ...polygon.shape, points: [...polygon.shape.points.slice(2), ...polygon.shape.points.slice(0, 2)] } },
    }),
  );
  assert.equal(
    polygonId,
    createStableAiGraderDefectFindingId({
      ...base,
      geometry: { ...polygon, shape: { ...polygon.shape, points: [...polygon.shape.points].reverse() } },
    }),
  );
});

test("report-bound extraction requires the normalized source fingerprint", () => {
  const matching = analysisCandidate({
    analysisGeometry: {
      ...analysisCandidate().analysisGeometry,
      sourceSha256: SOURCE_SHA256,
      normalizedArtifactSha256: NORMALIZED_ARTIFACT_SHA256,
    },
  });
  const options = {
    normalizedSourceSha256BySide: { back: SOURCE_SHA256 },
    normalizedArtifactSha256BySide: { back: NORMALIZED_ARTIFACT_SHA256 },
    requireNormalizedSourceMatch: true,
  };
  assert.equal(extractAiGraderDefectFindingsV1(analysisWith(matching), options).findings.length, 1);
  const stale = analysisCandidate({
    analysisGeometry: {
      ...analysisCandidate().analysisGeometry,
      sourceSha256: "b".repeat(64),
      normalizedArtifactSha256: NORMALIZED_ARTIFACT_SHA256,
    },
  });
  const result = extractAiGraderDefectFindingsV1(analysisWith(stale), options);
  assert.equal(result.findings.length, 0);
  assert.equal(result.issues.some((entry) => /source and artifact fingerprints/.test(entry.message)), true);
});

test("extractor rejects side mismatches and out-of-range confidence without clamping", () => {
  const sideMismatch = extractAiGraderDefFindingsV1ForTest(
    analysisCandidate({ side: "front" }),
  );
  assert.equal(sideMismatch.findings.length, 0);
  assert.equal(sideMismatch.issues.some((entry) => /side must match/.test(entry.message)), true);

  const badConfidence = extractAiGraderDefFindingsV1ForTest(
    analysisCandidate({ confidence: 82 }),
  );
  assert.equal(badConfidence.findings.length, 0);
  assert.equal(badConfidence.issues.some((entry) => entry.path.endsWith("confidence")), true);
});

function extractAiGraderDefFindingsV1ForTest(candidate) {
  return extractAiGraderDefectFindingsV1(analysisWith(candidate));
}

test("drivers barrel exports the defect finding API", () => {
  assert.equal(drivers.extractAiGraderDefectFindingsV1, extractAiGraderDefectFindingsV1);
  assert.equal(drivers.createStableAiGraderDefectFindingId, createStableAiGraderDefectFindingId);
});

test("display candidates project through the same rotation and crop as normalized card evidence", () => {
  const geometry = projectFixedRigDisplayRectToNormalizedCardGeometry(
    { x: 20, y: 40, width: 20, height: 40 },
    {
      sourceSha256: SOURCE_SHA256,
      normalizedArtifactSha256: NORMALIZED_ARTIFACT_SHA256,
      sourceImageWidth: 200,
      sourceImageHeight: 100,
      displayTransform: "rotate90cw",
      rotationDegrees: 90,
      corners: {
        topLeft: { x: 20, y: 10 },
        topRight: { x: 20, y: 90 },
        bottomRight: { x: 180, y: 90 },
        bottomLeft: { x: 180, y: 10 },
      },
    },
  );
  assert.equal(geometry.coordinateFrame, "normalized_card");
  assert.equal(geometry.shape.type, "polygon");
  assert.deepEqual(geometry.shape.points, [
    { x: 0.876543, y: 0.875776 },
    { x: 0.62963, y: 0.875776 },
    { x: 0.62963, y: 0.627329 },
    { x: 0.876543, y: 0.627329 },
  ]);
});

test("projected geometry matches pixels produced by the real rotate-and-crop normalizer", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-defect-projection-"));
  const sourceImagePath = path.join(dir, "source.png");
  const normalizedOutputPath = path.join(dir, "normalized.png");
  const redPatch = await sharp({
    create: { width: 40, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer();
  await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).composite([{ input: redPatch, left: 40, top: 60 }]).png().toFile(sourceImagePath);

  const normalized = await detectAndNormalizeCardImage({
    sourceImagePath,
    normalizedOutputPath,
    side: "front",
    manualOverride: {
      action: "manual_capture",
      confirmed: true,
      rect: { x: 20, y: 10, width: 160, height: 80 },
    },
  });
  assert.ok(normalized.normalizedArtifact);
  const projected = projectFixedRigDisplayRectToNormalizedCardGeometry(
    { x: 20, y: 40, width: 20, height: 40 },
    {
      sourceSha256: SOURCE_SHA256,
      normalizedArtifactSha256: NORMALIZED_ARTIFACT_SHA256,
      sourceImageWidth: 200,
      sourceImageHeight: 100,
      displayTransform: "rotate90cw",
      rotationDegrees: normalized.geometry.rotationDegrees,
      deskewAppliedDegrees: normalized.normalizedArtifact.deskewAppliedDegrees,
      corners: normalized.geometry.corners,
    },
  );
  assert.equal(projected.shape.type, "polygon");

  const { data, info } = await sharp(normalizedOutputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const redPixels = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset] > 200 && data[offset + 1] < 30 && data[offset + 2] < 30) redPixels.push({ x, y });
    }
  }
  assert.ok(redPixels.length > 0);
  const actualBounds = {
    x: Math.min(...redPixels.map((point) => point.x)) / info.width,
    y: Math.min(...redPixels.map((point) => point.y)) / info.height,
    right: (Math.max(...redPixels.map((point) => point.x)) + 1) / info.width,
    bottom: (Math.max(...redPixels.map((point) => point.y)) + 1) / info.height,
  };
  const projectedBounds = {
    x: Math.min(...projected.shape.points.map((point) => point.x)),
    y: Math.min(...projected.shape.points.map((point) => point.y)),
    right: Math.max(...projected.shape.points.map((point) => point.x)),
    bottom: Math.max(...projected.shape.points.map((point) => point.y)),
  };
  for (const key of ["x", "y", "right", "bottom"]) {
    assert.ok(Math.abs(actualBounds[key] - projectedBounds[key]) <= 0.02, `${key}: ${actualBounds[key]} vs ${projectedBounds[key]}`);
  }
});

test("near-limit close-enough normalization keeps canonical finding geometry and fingerprint linkage", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-grader-defect-close-enough-"));
  const sourceImagePath = path.join(dir, "source-34-degrees.png");
  const normalizedOutputPath = path.join(dir, "normalized-34-degrees.png");
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000">
      <rect width="2000" height="2000" fill="#121518"/>
      <g transform="translate(1000 1000) rotate(34)">
        <rect x="-500" y="-700" width="1000" height="1400" rx="10" fill="#eeeae0"/>
        <rect x="-420" y="-590" width="840" height="1180" fill="#805f2c"/>
      </g>
    </svg>
  `);
  await sharp(svg).png().toFile(sourceImagePath);

  const normalized = await detectAndNormalizeCardImage({
    sourceImagePath,
    normalizedOutputPath,
    side: "back",
  });
  assert.equal(normalized.geometry.placementState, "ready");
  assert.ok(Math.abs(normalized.geometry.skewDegrees - 34) < 1.5);
  assert.equal(normalized.geometry.placement.maxNormalizationSkewDegrees, 35);
  assert.ok(normalized.normalizedArtifact);
  assert.equal(normalized.normalizedArtifact.imageWidth, 1200);
  assert.equal(normalized.normalizedArtifact.imageHeight, 1680);

  const canonicalRect = { x: 240, y: 336, width: 360, height: 420 };
  const projected = projectFixedRigDisplayRectToNormalizedCardGeometry(canonicalRect, {
    projectionMode: "normalized_card_direct",
    inputCoordinateFrame: "normalized_card_portrait_pixels",
    sourceSha256: normalized.rawArtifact.sha256,
    normalizedArtifactSha256: normalized.normalizedArtifact.sha256,
    normalizedImageWidth: normalized.normalizedArtifact.imageWidth,
    normalizedImageHeight: normalized.normalizedArtifact.imageHeight,
  });
  assert.deepEqual(projected.shape, {
    type: "polygon",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.45 },
      { x: 0.2, y: 0.45 },
    ],
  });

  const candidate = analysisCandidate({ analysisGeometry: projected });
  const result = extractAiGraderDefectFindingsV1(analysisWith(candidate), {
    approvedEvidenceBySide: { back: { trueViewAssetId: "back/normalized-card.png" } },
    normalizedSourceSha256BySide: { back: normalized.rawArtifact.sha256 },
    normalizedArtifactSha256BySide: { back: normalized.normalizedArtifact.sha256 },
    requireNormalizedSourceMatch: true,
    requireTrueViewAsset: true,
    knownAssetIds: new Set(["back/normalized-card.png"]),
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].side, "back");
  assert.deepEqual(result.findings[0].geometry.shape, {
    type: "polygon",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.2, y: 0.45 },
      { x: 0.5, y: 0.45 },
      { x: 0.5, y: 0.2 },
    ],
  });
  assert.equal(result.findings[0].evidence.trueViewAssetId, "back/normalized-card.png");

  const crossSideFingerprint = extractAiGraderDefectFindingsV1(analysisWith(candidate), {
    normalizedSourceSha256BySide: { front: normalized.rawArtifact.sha256, back: "f".repeat(64) },
    normalizedArtifactSha256BySide: { front: normalized.normalizedArtifact.sha256, back: "e".repeat(64) },
    requireNormalizedSourceMatch: true,
  });
  assert.equal(crossSideFingerprint.findings.length, 0);
  assert.equal(crossSideFingerprint.issues.some((issue) => /fingerprints/.test(issue.message)), true);
});
