const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const sharp = require("sharp");

const {
  NATIVE_CAMERA_SHARP_COMPARATOR_MANIFEST_VERSION,
  NATIVE_CAMERA_SHARP_COMPARATOR_REPORT_VERSION,
  evaluateNativeCameraSharpComparator,
  loadNativeCameraSharpComparatorManifest,
  parseNativeCameraSharpComparatorManifest,
  serializeNativeCameraSharpComparatorReport,
} = require("../dist/drivers/nativeCameraSharpComparator.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tk-sharp-comparator-"));
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeFixtures(root) {
  const card = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1680">
      <rect width="1200" height="1680" fill="#101214"/>
      <rect x="250" y="350" width="700" height="980" rx="8" fill="#eeeae0"/>
      <rect x="320" y="440" width="560" height="800" fill="#315079"/>
    </svg>
  `)).png().toBuffer();
  const blank = await sharp({
    create: { width: 1200, height: 1680, channels: 3, background: "#101214" },
  }).png().toBuffer();
  fs.writeFileSync(path.join(root, "card.png"), card);
  fs.writeFileSync(path.join(root, "blank.png"), blank);
  return { card, blank };
}

function manifestFor(card, blank) {
  return {
    schemaVersion: NATIVE_CAMERA_SHARP_COMPARATOR_MANIFEST_VERSION,
    corpusKind: "safe",
    missingRealCorpusCategories: ["Approved Dell Basler full-resolution corpus"],
    cases: [
      {
        id: "safe-front-card",
        pairId: "safe-pair",
        side: "front",
        category: "safe_card",
        expectedCard: true,
        expectedDetection: true,
        expectedReady: true,
        relativeFile: "card.png",
        permittedSha256: digest(card),
        imageWidth: 1200,
        imageHeight: 1680,
        groundTruthCorners: [
          { x: 250, y: 350 },
          { x: 950, y: 350 },
          { x: 950, y: 1330 },
          { x: 250, y: 1330 },
        ],
      },
      {
        id: "safe-back-empty",
        pairId: "safe-pair",
        side: "back",
        category: "safe_no_card",
        expectedCard: false,
        expectedDetection: false,
        expectedReady: false,
        relativeFile: "blank.png",
        permittedSha256: digest(blank),
        imageWidth: 1200,
        imageHeight: 1680,
        groundTruthCorners: null,
      },
    ],
  };
}

test("offline Sharp comparator invokes the existing detector on full-resolution encoded fixtures deterministically", async () => {
  const root = tempDir();
  const fixtures = await writeFixtures(root);
  const manifest = manifestFor(fixtures.card, fixtures.blank);

  const first = await evaluateNativeCameraSharpComparator(manifest, root);
  const second = await evaluateNativeCameraSharpComparator(manifest, root);

  assert.deepEqual(second, first);
  assert.equal(first.schemaVersion, NATIVE_CAMERA_SHARP_COMPARATOR_REPORT_VERSION);
  assert.equal(first.detectorVersion, "ten-kings-card-geometry-v1");
  assert.equal(first.corpusAvailable, true);
  assert.equal(first.syntheticOnly, true);
  assert.equal(first.cases.length, 2);
  assert.equal(first.cases[0].placementState, "ready");
  assert.equal(first.cases[0].detected, true);
  assert.equal(first.cases[0].ready, true);
  assert.ok(first.cases[0].meanCornerErrorPixels < 12);
  assert.equal(first.cases[0].imageWidth, 1200);
  assert.equal(first.cases[0].imageHeight, 1680);
  assert.equal(first.cases[1].placementState, "not_detected");
  assert.equal(first.cases[1].detected, false);
  assert.equal(first.cases[1].ready, false);
  assert.deepEqual(first.aggregate, {
    cases: 2,
    expectedCards: 1,
    negatives: 1,
    truePositive: 1,
    falsePositive: 0,
    trueNegative: 1,
    falseNegative: 0,
    falseDetection: 0,
    falseReady: 0,
    detectionRecall: 1,
    detectionPrecision: 1,
    readyRecall: 1,
    readyPrecision: 1,
    meanCornerErrorPixels: first.cases[0].meanCornerErrorPixels,
  });

  const serialized = serializeNativeCameraSharpComparatorReport(first);
  assert.equal(serialized, serializeNativeCameraSharpComparatorReport(second));
  assert.doesNotMatch(serialized, /card\.png|blank\.png/i);
  assert.equal(serialized.includes(root), false);
});

test("empty authorized corpus reports missing evidence without manufacturing metrics", async () => {
  const manifest = {
    schemaVersion: NATIVE_CAMERA_SHARP_COMPARATOR_MANIFEST_VERSION,
    corpusKind: "private",
    missingRealCorpusCategories: ["Approved full-resolution front and back images"],
    cases: [],
  };

  const report = await evaluateNativeCameraSharpComparator(manifest);

  assert.equal(report.corpusAvailable, false);
  assert.equal(report.syntheticOnly, false);
  assert.equal(report.aggregate.cases, 0);
  assert.equal(report.aggregate.detectionRecall, null);
  assert.equal(report.aggregate.detectionPrecision, null);
  assert.equal(report.aggregate.readyRecall, null);
  assert.equal(report.aggregate.readyPrecision, null);
  assert.equal(report.aggregate.meanCornerErrorPixels, null);
  assert.match(report.accuracyDisclaimer, /no accuracy evidence/i);
  assert.equal(report.cases.length, 0);
});

test("manifest and fixture trust checks reject traversal, unsupported fields, hash mismatch, and dimension mismatch", async () => {
  const root = tempDir();
  const fixtures = await writeFixtures(root);
  const manifest = manifestFor(fixtures.card, fixtures.blank);

  assert.throws(
    () => parseNativeCameraSharpComparatorManifest({ ...manifest, hardwareSelector: "forbidden" }),
    /unsupported property/,
  );
  assert.throws(
    () => parseNativeCameraSharpComparatorManifest({
      ...manifest,
      missingRealCorpusCategories: ["C:\\private\\cards"],
    }),
    /missing-corpus categories are invalid/,
  );
  assert.throws(
    () => parseNativeCameraSharpComparatorManifest({
      ...manifest,
      cases: [{ ...manifest.cases[0], relativeFile: "../card.png" }],
    }),
    /escaped its authorized root/,
  );
  await assert.rejects(
    evaluateNativeCameraSharpComparator({
      ...manifest,
      cases: [{ ...manifest.cases[0], permittedSha256: "0".repeat(64) }],
    }, root),
    /permitted SHA-256/,
  );
  await assert.rejects(
    evaluateNativeCameraSharpComparator({
      ...manifest,
      cases: [{ ...manifest.cases[0], imageWidth: 1199 }],
    }, root),
    /dimensions do not match/,
  );
  await assert.rejects(evaluateNativeCameraSharpComparator(manifest), /fixture root is required/);
  const invalidUtf8Manifest = path.join(root, "invalid-utf8.json");
  fs.writeFileSync(invalidUtf8Manifest, Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x7d]));
  await assert.rejects(loadNativeCameraSharpComparatorManifest(invalidUtf8Manifest), /not valid UTF-8/);
});

test("tracked missing-corpus manifest runs through the offline CLI with path-free deterministic JSON", () => {
  const cli = path.resolve(__dirname, "../dist/drivers/nativeCameraSharpComparator.js");
  const manifest = path.resolve(__dirname, "../native/fixtures/sharp-comparator-missing-corpus.json");
  const first = spawnSync(process.execPath, [cli, "--manifest", manifest], { encoding: "utf8" });
  const second = spawnSync(process.execPath, [cli, "--manifest", manifest], { encoding: "utf8" });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stderr, "");
  assert.equal(second.stdout, first.stdout);
  const report = JSON.parse(first.stdout);
  assert.equal(report.corpusAvailable, false);
  assert.equal(report.aggregate.cases, 0);
  assert.doesNotMatch(first.stdout, /private-fixtures|[A-Z]:\\/i);
});
