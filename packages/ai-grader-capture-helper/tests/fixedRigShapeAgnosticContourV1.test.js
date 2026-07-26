const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  detectFixedRigShapeAgnosticContourV1,
  verifyFixedRigShapeAgnosticContourArtifactV1,
} = require("../dist/drivers/fixedRigShapeAgnosticContourV1");

const WIDTH = 128;
const HEIGHT = 160;
const PIXELS_PER_MM = 2;
const SHA = "a".repeat(64);

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const a = points[current];
    const b = points[previous];
    if (((a.y > y) !== (b.y > y)) &&
        x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function planes(inside, objectValue = 0.8) {
  const background = new Float32Array(WIDTH * HEIGHT).fill(0.1);
  const observed = Float32Array.from(background);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (inside(x + 0.5, y + 0.5)) observed[y * WIDTH + x] = objectValue;
    }
  }
  return { observed, background };
}

function detect(inside, suffix, objectValue = 0.8) {
  const input = planes(inside, objectValue);
  const result = detectFixedRigShapeAgnosticContourV1({
    width: WIDTH,
    height: HEIGHT,
    ...input,
    sourceAssetId: `shape-${suffix}`,
    sourceAssetSha256: SHA,
    backgroundAssetId: "empty-fixture",
    backgroundAssetSha256: "b".repeat(64),
    calibrationProfileId: "fixed-rig-test",
    calibrationSha256: "c".repeat(64),
    pixelsPerMmX: PIXELS_PER_MM,
    pixelsPerMmY: PIXELS_PER_MM,
  });
  assert.equal(result.status, "computed", result.reasons?.join(" "));
  assert.equal(verifyFixedRigShapeAgnosticContourArtifactV1(result.artifact), true);
  assert.ok(result.artifact.contourPointCount > 20);
  return result.artifact;
}

function fillRatio(artifact) {
  return artifact.enclosedAreaMm2 /
    (artifact.orientedBounds.widthMm * artifact.orientedBounds.heightMm);
}

test("dense raw contour follows a rounded rectangle without receiving a radius or shape profile", () => {
  const left = 28;
  const top = 22;
  const right = 100;
  const bottom = 138;
  const radius = 12;
  const artifact = detect((x, y) => {
    const nearestX = Math.max(left + radius, Math.min(right - radius, x));
    const nearestY = Math.max(top + radius, Math.min(bottom - radius, y));
    return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
  }, "rounded-rectangle");
  assert.ok(Math.abs(artifact.orientedBounds.widthMm - (right - left) / PIXELS_PER_MM) < 1);
  assert.ok(Math.abs(artifact.orientedBounds.heightMm - (bottom - top) / PIXELS_PER_MM) < 1);
  assert.ok(fillRatio(artifact) > 0.94);
  assert.ok(artifact.contourPointCount > 300);
});

test("dense raw contour remains circular instead of becoming a four-corner box", () => {
  const center = { x: 64, y: 80 };
  const radiusPx = 44;
  const artifact = detect(
    (x, y) => (x - center.x) ** 2 + (y - center.y) ** 2 <= radiusPx ** 2,
    "circle",
  );
  const expectedDiameterMm = radiusPx * 2 / PIXELS_PER_MM;
  assert.ok(Math.abs(artifact.orientedBounds.widthMm - expectedDiameterMm) < 1);
  assert.ok(Math.abs(artifact.orientedBounds.heightMm - expectedDiameterMm) < 1);
  assert.ok(Math.abs(fillRatio(artifact) - Math.PI / 4) < 0.04);
  assert.ok(artifact.circularArcs.some((arc) =>
    Math.abs(arc.radiusMm - radiusPx / PIXELS_PER_MM) < 1 &&
    arc.sweepDegrees > 300), JSON.stringify(artifact.circularArcs, null, 2));
});

test("dense raw contour preserves a triangle's non-rectangular physical area", () => {
  const triangle = [
    { x: 64, y: 20 },
    { x: 108, y: 136 },
    { x: 20, y: 136 },
  ];
  const artifact = detect((x, y) => pointInPolygon(x, y, triangle), "triangle");
  assert.ok(fillRatio(artifact) > 0.46 && fillRatio(artifact) < 0.56);
  assert.equal(artifact.circularArcs.length, 0, JSON.stringify(artifact.circularArcs, null, 2));
});

test("dense raw contour preserves a hexagon's six-sided area", () => {
  const center = { x: 64, y: 80 };
  const radius = 48;
  const hexagon = Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
  const artifact = detect((x, y) => pointInPolygon(x, y, hexagon), "hexagon");
  assert.ok(fillRatio(artifact) > 0.7 && fillRatio(artifact) < 0.8);
  assert.equal(artifact.circularArcs.length, 0, JSON.stringify(artifact.circularArcs, null, 2));
});

test("artifact verification detects contour mutation", () => {
  const artifact = detect(
    (x, y) => x >= 30 && x <= 98 && y >= 24 && y <= 136,
    "integrity",
  );
  const mutated = {
    ...artifact,
    contour: artifact.contour.map((point, index) =>
      index === 0 ? { x: point.x + 1, y: point.y } : point),
  };
  assert.equal(verifyFixedRigShapeAgnosticContourArtifactV1(mutated), false);
});

test("fog-like low contrast still produces a measured contour", () => {
  const artifact = detect(
    (x, y) => x >= 30 && x <= 98 && y >= 24 && y <= 136,
    "low-contrast",
    0.103,
  );
  assert.ok(artifact.foregroundThreshold < 0.003);
  assert.ok(artifact.orientedBounds.widthMm > 30);
  assert.ok(artifact.orientedBounds.heightMm > 50);
});

test("a card occupying most of the working area cannot raise its own foreground threshold", () => {
  const artifact = detect(
    (x, y) => x >= 8 && x <= 120 && y >= 8 && y <= 152,
    "majority-coverage-card",
  );
  assert.ok(artifact.foregroundCoverage > 0.6);
  assert.ok(artifact.orientedBounds.widthMm > 50);
  assert.ok(artifact.orientedBounds.heightMm > 65);
});

test("working-area coverage is advisory and cannot erase a visible unusual shape", () => {
  const artifact = detect(
    (x, y) => (x - 64) ** 2 + (y - 80) ** 2 <= 8 ** 2,
    "small-visible-circle",
  );
  assert.ok(artifact.foregroundCoverage < 0.02);
  assert.equal(artifact.placementAdvisories.length, 1);
  assert.ok(artifact.contourPointCount > 20);
});
