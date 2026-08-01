import assert from "node:assert/strict";
import test from "node:test";

import type { SpeedsterMeasuredDefect } from "../lib/ai-grader-v2/contracts";
import {
  calculateSpeedsterReview,
  completeSpeedsterReview,
  correctSpeedsterDefectType,
  publicSpeedsterDefects,
  removeSpeedsterDefect,
} from "../lib/ai-grader-v2/review";

const capture = {
  front: { centeringBorders: { leftMm: 3, rightMm: 3, topMm: 3, bottomMm: 3 } },
  back: { centeringBorders: { leftMm: 3, rightMm: 3, topMm: 3, bottomMm: 3 } },
};

const defect: SpeedsterMeasuredDefect = {
  id: "front-1",
  side: "FRONT",
  zone: "SURFACE",
  defectType: "LIGHT_SCRATCH_SCUFF",
  confidence: 0.9,
  canonicalContour: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }],
  sourceViewId: "FRONT:DIRECTIONAL",
  supportingViewIds: ["FRONT:MICRO_DEFECT"],
  reviewResult: "UNREVIEWED",
  measurement: {
    widthMm: 1,
    heightMm: 1,
    areaMm2: 1,
    zonePercent: 2,
    multiplier: 1,
    weightedAreaMm2: 1,
    subgradeEffect: 0,
  },
};

test("derives the exact eligible zone area from the measured defect and excludes removed findings", () => {
  const active = calculateSpeedsterReview(capture, [defect]);
  assert.equal(active.grade.front.surface.weightedDamagePercent, 2);
  assert.equal(active.grade.front.surface.score, 8);
  assert.equal(active.grade.front.corners.score, 10);
  assert.equal(active.defects[0].measurement.subgradeEffect, 1.4);

  const removed = calculateSpeedsterReview(capture, removeSpeedsterDefect([defect], defect.id));
  assert.equal(removed.grade.front.surface.weightedDamagePercent, 0);
  assert.equal(removed.grade.front.surface.score, 10);
  assert.equal(removed.defects[0].reviewResult, "REMOVED");
});

test("type corrections change published multiplier math immediately", () => {
  const corrected = correctSpeedsterDefectType([defect], defect.id, "PEELING_HEAVY_DAMAGE");
  const review = calculateSpeedsterReview(capture, corrected);
  assert.equal(review.defects[0].reviewResult, "TYPE_CORRECTED");
  assert.equal(review.defects[0].measurement.multiplier, 2);
  assert.equal(review.grade.front.surface.weightedDamagePercent, 4);
  assert.equal(review.grade.front.surface.score, 6);
});

test("completion accepts untouched findings and keeps canonical report view IDs", () => {
  const completed = completeSpeedsterReview([defect]);
  assert.equal(completed[0].reviewResult, "ACCEPTED");
  const persisted = publicSpeedsterDefects(completed);
  assert.equal(persisted[0].sourceViewId, "DIRECTIONAL");
  assert.deepEqual(persisted[0].supportingViewIds, ["MICRO_DEFECT"]);
});
