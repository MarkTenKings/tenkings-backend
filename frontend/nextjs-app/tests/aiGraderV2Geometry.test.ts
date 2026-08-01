import assert from "node:assert/strict";
import test from "node:test";
import {
  SPEEDSTER_CARD_HEIGHT_MM,
  SPEEDSTER_CARD_WIDTH_MM,
  canonicalPointToDisplayPoint,
  canonicalPointToUnitPoint,
  clampCanonicalPoint,
  classifyCanonicalPoint,
  displayPointToCanonicalPoint,
  getCornerZones,
  getEdgeZones,
  getSpeedsterCardDimensions,
  isCanonicalPoint,
  unitPointToCanonicalPoint,
} from "../lib/ai-grader-v2/geometry";

test("Pokemon and standard Sports profiles share the approved physical grid", () => {
  const expected = { widthMm: 63.5, heightMm: 88.9 };
  assert.deepEqual(getSpeedsterCardDimensions("POKEMON"), expected);
  assert.deepEqual(getSpeedsterCardDimensions("SPORTS"), expected);
  assert.equal(SPEEDSTER_CARD_WIDTH_MM, 63.5);
  assert.equal(SPEEDSTER_CARD_HEIGHT_MM, 88.9);
});

test("canonical points validate and clamp to the physical card", () => {
  assert.equal(isCanonicalPoint({ x: 0, y: 0 }, "POKEMON"), true);
  assert.equal(isCanonicalPoint({ x: 63.5, y: 88.9 }, "SPORTS"), true);
  assert.equal(isCanonicalPoint({ x: -0.01, y: 10 }, "POKEMON"), false);
  assert.equal(isCanonicalPoint({ x: 10, y: 88.91 }, "POKEMON"), false);
  assert.equal(isCanonicalPoint({ x: Number.NaN, y: 10 }, "POKEMON"), false);
  assert.deepEqual(clampCanonicalPoint({ x: -4, y: 100 }, "SPORTS"), {
    x: 0,
    y: 88.9,
  });
  assert.throws(
    () => clampCanonicalPoint({ x: Number.NaN, y: 1 }, "POKEMON"),
    /finite numbers/,
  );
});

test("the four corner scoring zones are fixed 5 mm squares", () => {
  assert.deepEqual(getCornerZones("POKEMON"), [
    { corner: "TOP_LEFT", xMm: 0, yMm: 0, widthMm: 5, heightMm: 5 },
    { corner: "TOP_RIGHT", xMm: 58.5, yMm: 0, widthMm: 5, heightMm: 5 },
    { corner: "BOTTOM_RIGHT", xMm: 58.5, yMm: 83.9, widthMm: 5, heightMm: 5 },
    { corner: "BOTTOM_LEFT", xMm: 0, yMm: 83.9, widthMm: 5, heightMm: 5 },
  ]);
});

test("edge rectangles cover the outer 2 mm and exclude all corner squares", () => {
  assert.deepEqual(getEdgeZones("SPORTS"), [
    { xMm: 5, yMm: 0, widthMm: 53.5, heightMm: 2 },
    { xMm: 61.5, yMm: 5, widthMm: 2, heightMm: 78.9 },
    { xMm: 5, yMm: 86.9, widthMm: 53.5, heightMm: 2 },
    { xMm: 0, yMm: 5, widthMm: 2, heightMm: 78.9 },
  ]);
});

test("zone classification is deterministic at corner, edge, and surface boundaries", () => {
  assert.equal(classifyCanonicalPoint({ x: 0, y: 0 }, "POKEMON"), "CORNERS");
  assert.equal(classifyCanonicalPoint({ x: 5, y: 5 }, "POKEMON"), "CORNERS");
  assert.equal(classifyCanonicalPoint({ x: 5.01, y: 2 }, "POKEMON"), "EDGES");
  assert.equal(classifyCanonicalPoint({ x: 2, y: 20 }, "POKEMON"), "EDGES");
  assert.equal(classifyCanonicalPoint({ x: 2.01, y: 20 }, "POKEMON"), "SURFACE");
  assert.equal(classifyCanonicalPoint({ x: 3, y: 3 }, "POKEMON"), "CORNERS");
  assert.equal(classifyCanonicalPoint({ x: 31.75, y: 44.45 }, "SPORTS"), "SURFACE");
  assert.throws(
    () => classifyCanonicalPoint({ x: 64, y: 20 }, "SPORTS"),
    /outside the canonical card grid/,
  );
});

test("canonical, unit, and display coordinates round-trip for the UI", () => {
  const canonical = { x: 31.75, y: 44.45 };
  assert.deepEqual(canonicalPointToUnitPoint(canonical, "POKEMON"), { x: 0.5, y: 0.5 });
  assert.deepEqual(unitPointToCanonicalPoint({ x: 0.5, y: 0.5 }, "POKEMON"), canonical);
  assert.deepEqual(canonicalPointToDisplayPoint(canonical, "POKEMON", 635, 889), {
    x: 317.5,
    y: 444.5,
  });
  assert.deepEqual(displayPointToCanonicalPoint({ x: 317.5, y: 444.5 }, "POKEMON", 635, 889), canonical);
  assert.deepEqual(displayPointToCanonicalPoint({ x: -10, y: 900 }, "POKEMON", 635, 889), {
    x: 0,
    y: 88.9,
  });
  assert.throws(
    () => canonicalPointToDisplayPoint(canonical, "POKEMON", 0, 889),
    /positive finite numbers/,
  );
});
