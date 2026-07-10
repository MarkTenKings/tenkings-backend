const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AI_GRADER_DEFECT_FINDING_VERSION,
  aiGraderPublishedDefectFindingV1Schema,
  aiGraderStoredDefectFindingV1Schema,
  isSafeAiGraderPublicAssetId,
  parseAiGraderDefectFindingV1,
  parseAiGraderDefectFindings,
  parseAiGraderPublishedDefectFindingV1,
  parseAiGraderPublishedDefectFindings,
} = require("../dist/aiGraderDefectFindings");

function finding(overrides = {}) {
  return {
    schemaVersion: AI_GRADER_DEFECT_FINDING_VERSION,
    findingId: "back-surface-001",
    side: "back",
    category: "surface_anomaly",
    detector: { id: "surface-intelligence", version: "v1", captureProfileVersion: "capture-v1" },
    severity: { band: "medium" },
    confidence: 0.82,
    review: { status: "unreviewed" },
    geometry: {
      coordinateFrame: "normalized_card",
      units: "fraction",
      shape: { type: "box", x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    },
    evidence: {
      trueViewAssetId: "back/back-normalized-card.png",
      heatmapAssetId: "report/back-heatmap.png",
      overlayAssetId: "report/back-defect-overlay.png",
      channelAssetIds: [],
      roiAssetIds: [],
    },
    explanation: "AI-detected provisional surface finding.",
    ...overrides,
  };
}

function publishedFinding(overrides = {}) {
  const stored = finding();
  const { overlayAssetId: _overlayAssetId, surfaceVisionAssetId: _surfaceVisionAssetId, ...evidence } = stored.evidence;
  return {
    ...stored,
    geometry: {
      ...stored.geometry,
      shape: { kind: "box", x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    },
    evidence,
    ...overrides,
  };
}

test("defect finding parser returns only the public allowlisted contract", () => {
  const value = finding({
    localPath: "C:\\private\\finding.json",
    publicUrl: "https://signed.invalid/image?token=private",
    reviewedByUserId: "internal-user",
  });
  const result = parseAiGraderDefectFindingV1(value, {
    knownAssetIds: new Set([
      "back/back-normalized-card.png",
      "report/back-heatmap.png",
      "report/back-defect-overlay.png",
    ]),
    requireTrueViewAsset: true,
  });
  assert.equal(result.success, true);
  assert.equal(Object.hasOwn(result.data, "localPath"), false);
  assert.equal(Object.hasOwn(result.data, "publicUrl"), false);
  assert.equal(Object.hasOwn(result.data.review, "reviewedByUserId"), false);
  assert.deepEqual(result.data.geometry.shape, { type: "box", x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
});

test("defect finding parser accepts a bounded normalized polygon", () => {
  const result = parseAiGraderDefectFindingV1(
    finding({
      geometry: {
        coordinateFrame: "normalized_card",
        units: "fraction",
        shape: { type: "polygon", points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.25, y: 0.5 }] },
      },
    })
  );
  assert.equal(result.success, true);
});

test("defect finding parser fails closed for invalid geometry and dangling assets", () => {
  const outside = parseAiGraderDefectFindingV1(
    finding({ geometry: { coordinateFrame: "normalized_card", units: "fraction", shape: { type: "box", x: 0.8, y: 0.2, width: 0.3, height: 0.4 } } })
  );
  assert.equal(outside.success, false);
  assert.match(outside.issues.map((entry) => entry.message).join(" "), /inside the normalized card/);

  const dangling = parseAiGraderDefectFindingV1(finding(), {
    knownAssetIds: new Set(["report/back-heatmap.png"]),
    requireTrueViewAsset: true,
  });
  assert.equal(dangling.success, false);
  assert.match(dangling.issues.map((entry) => entry.message).join(" "), /published image asset|required/);
});

test("defect finding parser rejects degenerate polygons and unsafe text", () => {
  const result = parseAiGraderDefectFindingV1(
    finding({
      geometry: {
        coordinateFrame: "normalized_card",
        units: "fraction",
        shape: { type: "polygon", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }] },
      },
      explanation: "See C:\\private\\analysis.json",
    })
  );
  assert.equal(result.success, false);
  const messages = result.issues.map((entry) => entry.message).join(" ");
  assert.match(messages, /nonzero area/);
  assert.match(messages, /safe public text/);
});

test("defect finding parser rejects credential markers, markup, and non-identifier detector fields", () => {
  const credential = parseAiGraderDefectFindingV1(finding({ explanation: "api_key=must-not-publish" }));
  assert.equal(credential.success, false);
  const markup = parseAiGraderDefectFindingV1(finding({ explanation: "<strong>confirmed</strong>" }));
  assert.equal(markup.success, false);
  const detectorProse = parseAiGraderDefectFindingV1(finding({ detector: { id: "surface detector", version: "Bearer hidden" } }));
  assert.equal(detectorProse.success, false);
});

test("asset IDs are relative logical identifiers and case-insensitive finding IDs are unique", () => {
  assert.equal(isSafeAiGraderPublicAssetId("front/front-normalized-card.png"), true);
  for (const unsafe of [
    "C:\\private\\card.png",
    "../card.png",
    "/absolute/card.png",
    "https://example.com/card.png",
    "data:image/png;base64,abc",
    "front/card.png?token=x",
    "front\\card.png",
  ]) assert.equal(isSafeAiGraderPublicAssetId(unsafe), false, unsafe);

  const parsed = parseAiGraderDefectFindings([
    finding(),
    finding({ findingId: "BACK-SURFACE-001" }),
  ]);
  assert.equal(parsed.findings.length, 1);
  assert.match(parsed.issues[0].message, /unique case-insensitively/);
});

test("defect finding collection enforces its production count bound", () => {
  const parsed = parseAiGraderDefectFindings(Array.from({ length: 101 }, (_, index) => finding({ findingId: `finding-${index}` })));
  assert.equal(parsed.findings.length, 0);
  assert.match(parsed.issues[0].message, /at most 100/);
});

test("strict stored findings retain private review attribution and reject measurements", () => {
  const stored = finding({
    review: {
      status: "confirmed",
      reviewedByUserId: "grader-42",
      reviewedAt: "2026-07-10T15:00:00.000Z",
    },
  });
  assert.equal(aiGraderStoredDefectFindingV1Schema.safeParse(stored).success, true);
  assert.equal(
    aiGraderStoredDefectFindingV1Schema.safeParse({
      ...stored,
      measurements: { lengthMm: 0.2, calibrationVersion: "cal-v1" },
    }).success,
    false,
  );
});

test("published finding projection uses kind geometry and excludes reviewer identity", () => {
  const stored = finding();
  const published = publishedFinding();
  assert.equal(aiGraderPublishedDefectFindingV1Schema.safeParse(published).success, true);
  assert.equal(
    aiGraderPublishedDefectFindingV1Schema.safeParse({
      ...published,
      review: { status: "confirmed", reviewedByUserId: "grader-42" },
    }).success,
    false,
  );
  assert.equal(aiGraderPublishedDefectFindingV1Schema.safeParse(stored).success, false);
});

test("strict review metadata matches the declared status", () => {
  const stored = finding();
  assert.equal(
    aiGraderStoredDefectFindingV1Schema.safeParse({
      ...stored,
      review: { status: "unreviewed", reviewedAt: "2026-07-10T15:00:00.000Z" },
    }).success,
    false,
  );
  assert.equal(
    aiGraderStoredDefectFindingV1Schema.safeParse({
      ...stored,
      review: { status: "confirmed", reviewedAt: "2026-07-10T15:00:00.000Z" },
    }).success,
    false,
  );

  const published = publishedFinding();
  assert.equal(
    aiGraderPublishedDefectFindingV1Schema.safeParse({
      ...published,
      review: { status: "confirmed" },
    }).success,
    false,
  );
  assert.equal(
    aiGraderPublishedDefectFindingV1Schema.safeParse({
      ...published,
      review: { status: "adjusted", reviewedAt: "2026-07-10T15:00:00.000Z" },
    }).success,
    true,
  );
});

test("published physical measurements are positive, versioned, and nonempty", () => {
  const published = publishedFinding();
  assert.equal(
    aiGraderPublishedDefectFindingV1Schema.safeParse({
      ...published,
      measurements: { lengthMm: 0.2, calibrationVersion: "cal-v1" },
    }).success,
    true,
  );
  for (const measurements of [
    { calibrationVersion: "cal-v1" },
    { lengthMm: 0, calibrationVersion: "cal-v1" },
    { lengthMm: 0.2 },
  ]) {
    assert.equal(aiGraderPublishedDefectFindingV1Schema.safeParse({ ...published, measurements }).success, false);
  }
});

test("strict v0.2 finding schemas require capture-profile detector metadata", () => {
  const stored = finding({ detector: { id: "surface-intelligence", version: "v1" } });
  assert.equal(aiGraderStoredDefectFindingV1Schema.safeParse(stored).success, false);

  const published = publishedFinding({ detector: stored.detector });
  assert.equal(aiGraderPublishedDefectFindingV1Schema.safeParse(published).success, false);
  assert.equal(parseAiGraderDefectFindingV1(stored).success, true, "legacy v0.1 parser remains compatible");
});

test("published finding wrappers enforce dynamic asset membership and unique IDs", () => {
  const published = publishedFinding();
  const knownAssetIds = new Set([
    "back/back-normalized-card.png",
    "report/back-heatmap.png",
  ]);
  assert.equal(parseAiGraderPublishedDefectFindingV1(published, { knownAssetIds, requireTrueViewAsset: true }).success, true);
  assert.equal(parseAiGraderPublishedDefectFindingV1(published, { knownAssetIds: new Set() }).success, false);

  const collection = parseAiGraderPublishedDefectFindings([
    published,
    { ...published, findingId: published.findingId.toUpperCase() },
  ], { knownAssetIds });
  assert.equal(collection.findings.length, 1);
  assert.match(collection.issues[0].message, /unique case-insensitively/);
});
