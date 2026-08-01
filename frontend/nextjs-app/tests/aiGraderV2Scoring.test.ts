import assert from "node:assert/strict";
import test from "node:test";
import {
  SPEEDSTER_DEFECT_MULTIPLIERS,
  calculateCenteringBalance,
  calculateCenteringScore,
  calculateConditionScore,
  calculateDefectSubgradeEffect,
  calculateOverallGrade,
  calculateSpeedsterGrade,
  calculateWeightedDamagePercent,
  combineFrontBackScore,
} from "../lib/ai-grader-v2/scoring";

test("centering converts opposite border measurements into exact percentages", () => {
  assert.deepEqual(calculateCenteringBalance(3, 2), [60, 40]);
  const [left, right] = calculateCenteringBalance(2.4, 2);
  assert.ok(Math.abs(left - 54.54545454545454) < 1e-12);
  assert.ok(Math.abs(right - 45.45454545454545) < 1e-12);
  assert.deepEqual(calculateCenteringBalance(0, 0), [50, 50]);
});

test("centering uses the worse axis and linearly interpolates published boundaries", () => {
  for (const [worstPercent, expectedScore] of [
    [55, 10],
    [60, 9],
    [65, 8],
    [70, 7],
    [75, 6],
    [80, 5],
    [85, 4],
    [90, 3],
    [95, 2],
  ] as const) {
    assert.equal(
      calculateCenteringScore({
        leftMm: worstPercent,
        rightMm: 100 - worstPercent,
        topMm: 50,
        bottomMm: 50,
      }),
      expectedScore,
    );
  }
  assert.equal(
    calculateCenteringScore({ leftMm: 50, rightMm: 50, topMm: 57.5, bottomMm: 42.5 }),
    9.5,
  );
  assert.equal(
    calculateCenteringScore({ leftMm: 60, rightMm: 40, topMm: 65, bottomMm: 35 }),
    8,
  );
  assert.equal(
    calculateCenteringScore({ leftMm: 95, rightMm: 5, topMm: 50, bottomMm: 50 }),
    2,
  );
  assert.equal(
    calculateCenteringScore({ leftMm: 95.01, rightMm: 4.99, topMm: 50, bottomMm: 50 }),
    1,
  );
});

test("front and back subgrades use the published 70/30 formula", () => {
  assert.equal(combineFrontBackScore(10, 8), 9.4);
  assert.equal(combineFrontBackScore(7.5, 9), 7.95);
});

test("condition damage applies the Blueprint multiplier to each non-overlapping area", () => {
  assert.deepEqual(SPEEDSTER_DEFECT_MULTIPLIERS, {
    FAINT_COLOR_VARIATION: 0.5,
    VISIBLE_WHITENING: 1,
    FRAYING: 1.25,
    CHIPPING_EXPOSED_STOCK: 1.5,
    LIFTING_DEFORMATION: 2,
    LIGHT_SCRATCH_SCUFF: 1,
    VISIBLE_SCRATCH_PRINT_COATING_LOSS: 1.25,
    DENT_MATERIAL_DAMAGE: 1.5,
    PEELING_HEAVY_DAMAGE: 2,
  });
  assert.equal(
    calculateWeightedDamagePercent(100, [
      { areaMm2: 0.2, defectType: "FAINT_COLOR_VARIATION" },
      { areaMm2: 0.4, defectType: "VISIBLE_WHITENING" },
      { areaMm2: 0.8, defectType: "CHIPPING_EXPOSED_STOCK" },
    ]),
    1.7,
  );
});

test("condition scores honor every published threshold boundary", () => {
  const cases: readonly (readonly [number, number])[] = [
    [0, 10],
    [0.2, 10],
    [0.200001, 9],
    [1, 9],
    [1.000001, 8],
    [2, 8],
    [2.000001, 7],
    [3.5, 7],
    [3.500001, 6],
    [4.999999, 6],
    [5, 5],
    [5.999999, 5],
    [6, 4],
    [6.999999, 4],
    [7, 3],
    [7.999999, 3],
    [8, 2],
    [9.999999, 2],
    [10, 1],
  ];

  for (const [damagePercent, expectedScore] of cases) {
    assert.equal(calculateConditionScore(damagePercent), expectedScore);
  }
});

test("per-defect report math shows only its exact threshold effect", () => {
  const crossingDefects = [
    { areaMm2: 0.15, defectType: "VISIBLE_WHITENING" as const },
    { areaMm2: 0.1, defectType: "VISIBLE_WHITENING" as const },
  ];
  assert.equal(
    calculateDefectSubgradeEffect("FRONT", 100, crossingDefects, 1),
    0.7,
  );

  const sameBandDefects = [
    { areaMm2: 0.3, defectType: "VISIBLE_WHITENING" as const },
    { areaMm2: 0.2, defectType: "VISIBLE_WHITENING" as const },
  ];
  assert.equal(
    calculateDefectSubgradeEffect("BACK", 100, sameBandDefects, 1),
    0,
  );
});

test("overall grade equally weights all subgrades and stores raw plus tenth display", () => {
  assert.deepEqual(
    calculateOverallGrade({
      centering: 9.5,
      corners: 9,
      edges: 8.5,
      surface: 9,
    }),
    { rawGrade: 9, displayGrade: 9 },
  );
  assert.deepEqual(
    calculateOverallGrade({
      centering: 9.96,
      corners: 9.96,
      edges: 9.96,
      surface: 9.96,
    }),
    { rawGrade: 9.96, displayGrade: 10 },
  );
  assert.deepEqual(
    calculateOverallGrade({
      centering: 9.44,
      corners: 9.44,
      edges: 9.44,
      surface: 9.44,
    }),
    { rawGrade: 9.44, displayGrade: 9.4 },
  );
  assert.deepEqual(
    calculateOverallGrade({
      centering: 8.75,
      corners: 8.75,
      edges: 8.75,
      surface: 8.75,
    }),
    { rawGrade: 8.75, displayGrade: 8.8 },
  );
});

test("Speedster calculates one complete grade from measured borders and de-duplicated defect areas", () => {
  assert.deepEqual(
    calculateSpeedsterGrade({
      front: {
        centering: { leftMm: 55, rightMm: 45, topMm: 50, bottomMm: 50 },
        corners: {
          eligibleAreaMm2: 100,
          defects: [{ areaMm2: 0.2, defectType: "VISIBLE_WHITENING" }],
        },
        edges: {
          eligibleAreaMm2: 100,
          defects: [{ areaMm2: 1.2, defectType: "FRAYING" }],
        },
        surface: {
          eligibleAreaMm2: 100,
          defects: [{ areaMm2: 2.5, defectType: "PEELING_HEAVY_DAMAGE" }],
        },
      },
      back: {
        centering: { leftMm: 65, rightMm: 35, topMm: 50, bottomMm: 50 },
        corners: {
          eligibleAreaMm2: 100,
          defects: [{ areaMm2: 1, defectType: "VISIBLE_WHITENING" }],
        },
        edges: {
          eligibleAreaMm2: 100,
          defects: [{ areaMm2: 2, defectType: "CHIPPING_EXPOSED_STOCK" }],
        },
        surface: {
          eligibleAreaMm2: 100,
          defects: [{ areaMm2: 5, defectType: "PEELING_HEAVY_DAMAGE" }],
        },
      },
    }),
    {
      front: {
        centering: {
          leftRightBalance: [55, 45],
          topBottomBalance: [50, 50],
          score: 10,
        },
        corners: { weightedDamagePercent: 0.2, score: 10 },
        edges: { weightedDamagePercent: 1.5, score: 8 },
        surface: { weightedDamagePercent: 5, score: 5 },
      },
      back: {
        centering: {
          leftRightBalance: [65, 35],
          topBottomBalance: [50, 50],
          score: 8,
        },
        corners: { weightedDamagePercent: 1, score: 9 },
        edges: { weightedDamagePercent: 3, score: 7 },
        surface: { weightedDamagePercent: 10, score: 1 },
      },
      subgrades: {
        centering: 9.4,
        corners: 9.7,
        edges: 7.7,
        surface: 3.8,
      },
      overall: { rawGrade: 7.65, displayGrade: 7.7 },
    },
  );
});
