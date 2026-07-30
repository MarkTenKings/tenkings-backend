const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1,
  AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_SHA256,
  AI_GRADER_GEOMETRY_CORNERS,
  AI_GRADER_GEOMETRY_EDGES,
  assertAiGraderHumanGeometrySideConfirmedV1,
  buildAiGraderHumanGeometryAssistSideV1,
  deriveAiGraderHumanGeometryRegionsV1,
  canonicalJsonV1,
} = require("../dist");

const contour = [
  { x: 10, y: 10 },
  { x: 1190, y: 10 },
  { x: 1190, y: 1670 },
  { x: 10, y: 1670 },
  { x: 10, y: 10 },
];

function confirmedSide(sideName = "front") {
  const side = buildAiGraderHumanGeometryAssistSideV1(sideName, contour);
  for (const edge of AI_GRADER_GEOMETRY_EDGES) {
    side.printedBorders[edge].reviewed = true;
  }
  for (const corner of AI_GRADER_GEOMETRY_CORNERS) {
    side.physicalCorners[corner].reviewed = true;
  }
  side.edgeRegionsReviewed = true;
  side.surfaceRegionReviewed = true;
  side.confirmed = true;
  return side;
}

test("every printed border receives exactly three deterministic candidates", () => {
  const first = buildAiGraderHumanGeometryAssistSideV1("front", contour);
  const second = buildAiGraderHumanGeometryAssistSideV1("front", contour);
  for (const edge of AI_GRADER_GEOMETRY_EDGES) {
    assert.equal(first.printedBorders[edge].candidates.length, 3);
    assert.deepEqual(first.printedBorders[edge], second.printedBorders[edge]);
  }
});

test("owner Human Geometry uncertainty policy has one reproducible deterministic hash", () => {
  const { policySha256, ...payload } =
    AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_AUTHORITY_V1;
  assert.equal(
    createHash("sha256").update(canonicalJsonV1(payload), "utf8").digest("hex"),
    policySha256,
  );
  assert.equal(
    policySha256,
    AI_GRADER_OWNER_HUMAN_GEOMETRY_MEASUREMENT_UNCERTAINTY_POLICY_SHA256,
  );
  assert.equal(payload.repeatedPlacementU95Mm, 0.05);
  assert.equal(
    payload.authorityBasis,
    "owner_approved_grading_policy_not_empirical_calibration",
  );
});

test("every border, corner, edge region, surface, and side requires explicit review", () => {
  const side = confirmedSide();
  side.physicalCorners.bottom_right.reviewed = false;
  assert.throws(
    () => assertAiGraderHumanGeometrySideConfirmedV1(side),
    /bottom right physical corner requires human review/,
  );
  side.physicalCorners.bottom_right.reviewed = true;
  side.surfaceRegionReviewed = false;
  assert.throws(
    () => assertAiGraderHumanGeometrySideConfirmedV1(side),
    /surface region/,
  );
});

test("rounded 3.18 mm and square 90-degree tools drive the same derived master regions", () => {
  const side = confirmedSide();
  const roundedCount = side.derivedRegions.physicalOuterContour.length;
  side.physicalCorners.top_right.toolType = "square_90_degree";
  side.derivedRegions = deriveAiGraderHumanGeometryRegionsV1(side.physicalCorners);
  assert.equal(side.physicalCorners.top_right.toolType, "square_90_degree");
  assert.ok(side.derivedRegions.physicalOuterContour.length < roundedCount);
  assert.equal(side.derivedRegions.edgeBands.top.length, 4);
  assert.ok(side.derivedRegions.surfaceRegion.length >= 3);
  assert.doesNotThrow(() => assertAiGraderHumanGeometrySideConfirmedV1(side));
});
