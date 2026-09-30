import test from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_RULE_VERSION, calculateAtlasConditionScore, calculateAtlasReview,
  calculateAtlasScoringDamagePercent } from '../dist/atlas-policy.js';
import { calculateAtlasFinalGrade } from '../dist/manual-report.js';

const centering = score => {
  const worst = 55 + (10 - score) * 5;
  return { leftMm: worst, rightMm: 100 - worst, topMm: 50, bottomMm: 50 };
};
const capture = (front = 10, back = 10) => ({
  front: { centeringBorders: centering(front) }, back: { centeringBorders: centering(back) },
});
const finding = (id, side, zone, basePercent, defectType = 'LIGHT_SCRATCH_SCUFF', areaMm2 = basePercent) => ({
  id, side, zone, defectType, reviewResult: 'ACCEPTED',
  measurement: { areaMm2, zonePercent: areaMm2, widthMm: 1, heightMm: 1,
    multiplier: 1, weightedAreaMm2: areaMm2, subgradeEffect: 0 },
});

test('new ATLAS damage bands use one global 1.5 multiplier on the existing weighted percentage', () => {
  assert.equal(ATLAS_RULE_VERSION, 'ATLAS_2026_09_30_DAMAGE_1_5_V1');
  for (const [base, scoring, score] of [
    [0, 0, 10], [.006, .009, 10], [.01, .015, 9.5], [.016, .024, 9],
    [.02, .03, 9], [.023, .0345, 8], [.03, .045, 7], [.037, .0555, 6],
    [.04, .06, 6], [.040000001, .0600000015, 5], [.05, .075, 4],
    [.057, .0855, 3], [.06, .09, 3], [.063, .0945, 2], [.067, .1005, 1],
  ]) {
    assert.equal(calculateAtlasScoringDamagePercent(base), scoring);
    assert.equal(calculateAtlasConditionScore(base), score);
  }
  const measured = calculateAtlasReview(capture(), [finding('coating-loss', 'BACK', 'SURFACE', .04,
    'VISIBLE_SCRATCH_PRINT_COATING_LOSS', .032)]);
  assert.equal(measured.grade.back.surface.weightedDamagePercent, .04);
  assert.equal(measured.grade.back.surface.score, 6);
  assert.equal(measured.defects[0].measurement.multiplier, 1.25);
  assert.equal(measured.defects[0].measurement.weightedAreaMm2, .04);
  assert.equal(measured.defects[0].measurement.subgradeEffect, 1.2);
});

test('saved Abomasnow measurements replay to 8.5 under the owner-approved rule', () => {
  // Base zone percentages from the approved Atlas Abomasnow report v1.
  const defects = [
    finding('back-corners', 'BACK', 'CORNERS', .262898455472),
    finding('back-edges', 'BACK', 'EDGES', .666540785498),
    finding('back-surface', 'BACK', 'SURFACE', .037284046615),
  ];
  const before = structuredClone(defects);
  const { grade } = calculateAtlasReview(capture(), defects);
  assert.deepEqual(defects, before);
  assert.deepEqual([grade.back.corners.score, grade.back.edges.score, grade.back.surface.score], [1, 1, 6]);
  assert.deepEqual(grade.subgrades, { centering: 10, corners: 7.3, edges: 7.3, surface: 8.8 });
  assert(Math.abs(grade.overall.rawGrade - 8.35) < 1e-10);
  assert.equal(calculateAtlasFinalGrade(grade.overall.rawGrade), 8.5);
});

test('saved Drake Maye measurements replay to 7.5 under the owner-approved rule', () => {
  // Base zone percentages and centering scores from the approved Atlas Drake Maye report v1.
  const defects = [
    finding('front-edges', 'FRONT', 'EDGES', .046261329305),
    finding('front-surface', 'FRONT', 'SURFACE', .005233723121),
    finding('back-edges', 'BACK', 'EDGES', .118603663142),
    finding('back-surface', 'BACK', 'SURFACE', .343045628097),
  ];
  const { grade } = calculateAtlasReview(capture(9.2191780821918, 8.3239436619718), defects);
  assert.deepEqual([grade.front.edges.score, grade.front.surface.score, grade.back.edges.score, grade.back.surface.score], [5, 10, 1, 1]);
  assert.equal(grade.subgrades.edges, 3.8);
  assert.equal(grade.subgrades.surface, 7.3);
  assert(Math.abs(grade.overall.rawGrade - 7.51265193903145) < 1e-10);
  assert.equal(calculateAtlasFinalGrade(grade.overall.rawGrade), 7.5);
});
