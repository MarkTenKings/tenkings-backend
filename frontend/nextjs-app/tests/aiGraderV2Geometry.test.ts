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
  sanitizeSpeedsterUnitQuad,
  unitPointToCanonicalPoint,
} from "../lib/ai-grader-v2/geometry";
import {
  buildSpeedsterGradientMap,
  snapSpeedsterPoint,
} from "../lib/ai-grader-v2/gradient-snap";

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

test("physical geometry rejects out-of-bounds, crossed, concave, and collapsed evidence without clamping", () => {
  assert.equal(sanitizeSpeedsterUnitQuad([
    { x: -0.04, y: 0.08 },
    { x: 0.94, y: 0.07 },
    { x: 1.06, y: 0.95 },
    { x: -0.18, y: 1.37 },
  ]), null);
  assert.equal(sanitizeSpeedsterUnitQuad([{ x: 0, y: 0 }]), null);
  assert.equal(sanitizeSpeedsterUnitQuad([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: Number.NaN, y: 1 },
  ]), null);
  assert.equal(sanitizeSpeedsterUnitQuad([
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.2, y: 0.9 },
    { x: 0.8, y: 0.9 },
  ]), null);
  assert.equal(sanitizeSpeedsterUnitQuad([
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.6, y: 0.9 },
    { x: 0.5, y: 0.3 },
  ]), null);
  assert.equal(sanitizeSpeedsterUnitQuad([
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.105 },
    { x: 0.1, y: 0.105 },
  ]), null);
  assert.deepEqual(sanitizeSpeedsterUnitQuad([
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.08 },
    { x: 0.88, y: 0.92 },
    { x: 0.12, y: 0.9 },
  ]), [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.08 },
    { x: 0.88, y: 0.92 },
    { x: 0.12, y: 0.9 },
  ]);
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

test("human geometry drag snaps each axis to the nearby physical card edge", () => {
  const width = 80;
  const height = 80;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = x >= 20 && x <= 60 && y >= 10 && y <= 70 ? 255 : 0;
      const index = (y * width + x) * 4;
      rgba[index] = value;
      rgba[index + 1] = value;
      rgba[index + 2] = value;
      rgba[index + 3] = 255;
    }
  }
  const map = buildSpeedsterGradientMap({ width, height, data: rgba } as ImageData);
  const snapped = snapSpeedsterPoint(
    map,
    { x: 18 / 79, y: 12 / 79 },
    {
      inwardX: 1,
      inwardY: 1,
      radius: 5,
      sampleStart: 2,
      sampleLength: 30,
      minimumStrength: 0.05,
    },
  );

  assert.ok(Math.abs(snapped.x * 79 - 20) <= 1);
  assert.ok(Math.abs(snapped.y * 79 - 10) <= 1);
});
