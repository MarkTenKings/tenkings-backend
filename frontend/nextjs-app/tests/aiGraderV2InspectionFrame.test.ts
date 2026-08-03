import assert from "node:assert/strict";
import test from "node:test";

import {
  SPEEDSTER_CANONICAL_FRAME,
  canonicalPointToInspection,
  inspectionBoxToCanonical,
  parseSpeedsterInspectionFrame,
} from "../lib/ai-grader-v2/inspection-frame";

const frame = {
  width: 1350,
  height: 1858,
  cardBounds: { x: 40, y: 40, width: 1270, height: 1778 },
};

test("maps canonical card corners into the exact 40-pixel inspection inset", () => {
  assert.deepEqual(canonicalPointToInspection({ x: 0, y: 0 }, frame), {
    x: 40 / 1349,
    y: 40 / 1857,
  });
  assert.deepEqual(canonicalPointToInspection({ x: 1, y: 1 }, frame), {
    x: 1309 / 1349,
    y: 1817 / 1857,
  });
});

test("Smart-Mark boxes may use the context but measurement receives only card intersection", () => {
  const canonical = inspectionBoxToCanonical({
    x: 20 / 1349,
    y: 30 / 1857,
    width: 50 / 1349,
    height: 60 / 1857,
  }, frame);
  assert.ok(canonical);
  assert.equal(canonical.x, 0);
  assert.equal(canonical.y, 0);
  assert.ok(canonical.width > 0);
  assert.ok(canonical.height > 0);
  assert.equal(inspectionBoxToCanonical({ x: 0, y: 0, width: 10 / 1349, height: 10 / 1857 }, frame), null);
});

test("legacy full-frame evidence remains an identity mapping", () => {
  const point = { x: 0.25, y: 0.75 };
  assert.deepEqual(canonicalPointToInspection(point, SPEEDSTER_CANONICAL_FRAME), point);
});

test("accepts only bounded inspection metadata", () => {
  assert.deepEqual(parseSpeedsterInspectionFrame(frame), frame);
  assert.equal(parseSpeedsterInspectionFrame({
    ...frame,
    cardBounds: { ...frame.cardBounds, x: 1000 },
  }), null);
});
