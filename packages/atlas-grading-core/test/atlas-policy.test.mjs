import test from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_RULE_VERSION, ATLAS_CATEGORY_DAMAGE_MULTIPLIERS, calculateAtlasConditionScore,
  calculateAtlasReview, calculateAtlasScoringDamagePercent } from '../dist/atlas-policy.js';
import { calculateAtlasFinalGrade, ATLAS_HALF_POINT_FINAL_GRADE_POLICY } from '../dist/manual-report.js';
import { calculateSpeedsterReview } from '../dist/review.js';

const centering = score => {
  const worst = 55 + (10 - score) * 5;
  return { leftMm: worst, rightMm: 100 - worst, topMm: 50, bottomMm: 50 };
};
const capture = (front = 10, back = 10) => ({
  front: { centeringBorders: centering(front) }, back: { centeringBorders: centering(back) },
});
const finding = (id, side, zone, areaMm2, defectType = 'LIGHT_SCRATCH_SCUFF') => ({
  id, side, zone, defectType, reviewResult: 'ACCEPTED',
  measurement: { areaMm2, zonePercent: areaMm2, widthMm: 1, heightMm: 1,
    multiplier: 1, weightedAreaMm2: areaMm2, subgradeEffect: 0 },
});
const categories = [['CORNERS', .25], ['EDGES', 1], ['SURFACE', 2]];
const bands = [[.01,10],[.02,9.5],[.03,9],[.04,8],[.05,7],[.06,6],[.07,5],[.08,4],[.09,3],[.1,2]];

test('current ATLAS policy uses exactly one category multiplier for the same measured damage', () => {
  assert.equal(ATLAS_RULE_VERSION, 'ATLAS_2026_10_21_CATEGORY_DAMAGE_V1');
  assert.deepEqual(ATLAS_CATEGORY_DAMAGE_MULTIPLIERS, { CORNERS: .25, EDGES: 1, SURFACE: 2 });
  assert.equal(Object.isFrozen(ATLAS_CATEGORY_DAMAGE_MULTIPLIERS), true);
  for (const invalid of [undefined, null, 'corners', 'CENTERING', 'toString']) {
    assert.throws(() => calculateAtlasConditionScore(.02, invalid), /ATLAS_DAMAGE_CATEGORY_INVALID/);
    assert.throws(() => calculateAtlasScoringDamagePercent(.02, invalid), /ATLAS_DAMAGE_CATEGORY_INVALID/);
  }
  assert.deepEqual(categories.map(([zone]) => calculateAtlasScoringDamagePercent(.02, zone)), [.005,.02,.04]);
  assert.deepEqual(categories.map(([zone]) => calculateAtlasConditionScore(.02, zone)), [10,9.5,8]);
});

for (const [zone, multiplier] of categories) test(`${zone} preserves every inclusive threshold and twelve-place scoring normalization`, () => {
  assert.equal(calculateAtlasConditionScore(0, zone), 10);
  for (const [index, [threshold, score]] of bands.entries()) {
    const raw = threshold / multiplier;
    assert.equal(calculateAtlasScoringDamagePercent(raw, zone), threshold);
    assert.equal(calculateAtlasConditionScore(raw, zone), score);
    assert.equal(calculateAtlasConditionScore(raw - 1e-10, zone), score);
    assert.equal(calculateAtlasConditionScore(raw + 1e-10, zone), bands[index + 1]?.[1] ?? 1);
    // Changes below the existing normalization precision retain that same boundary.
    assert.equal(calculateAtlasConditionScore((threshold + 1e-14) / multiplier, zone), score);
  }
  assert.equal(calculateAtlasConditionScore(100, zone), 1);
});

test('type weights and raw measurements stay separate from scoring damage and marginal side effects', () => {
  const defects = ['FRONT','BACK'].flatMap(side => categories.map(([zone]) =>
    finding(`${side}-${zone}`, side, zone, .016, 'VISIBLE_SCRATCH_PRINT_COATING_LOSS')));
  const before = structuredClone(defects), input = capture(9,8), historical = calculateSpeedsterReview(input, defects);
  const result = calculateAtlasReview(input, defects);
  assert.deepEqual(defects, before);
  for (const side of ['front','back']) {
    assert.deepEqual(result.grade[side].centering, historical.grade[side].centering);
    for (const [index, [zone]] of categories.entries()) {
      const current = result.grade[side][zone.toLowerCase()];
      assert.equal(current.weightedDamagePercent, .02);
      assert.equal(current.score, [10,9.5,8][index]);
      assert.equal(historical.grade[side][zone.toLowerCase()].score, 10, 'shared Speedster policy is unchanged');
    }
  }
  for (const [index, entry] of result.defects.entries()) {
    const original = before[index], { subgradeEffect, multiplier, weightedAreaMm2, ...measurement } = entry.measurement;
    assert.equal(multiplier, 1.25); assert.equal(weightedAreaMm2, .02);
    assert.equal(measurement.areaMm2, original.measurement.areaMm2);
    assert.equal(measurement.zonePercent, original.measurement.zonePercent);
    const expectedEffect = [0,.5,2][index % 3] * (entry.side === 'FRONT' ? .7 : .3);
    assert.equal(subgradeEffect, expectedEffect);
  }
  assert.deepEqual(result.grade.subgrades, { centering: 8.7, corners: 10, edges: 9.5, surface: 8 });
  assert.equal(result.grade.overall.rawGrade, 9.05);
  assert.equal(calculateAtlasFinalGrade(result.grade.overall.rawGrade), 9);
});

test('removed findings remain excluded and side weighting uses each unrounded category score', () => {
  const defects = [finding('front-edge', 'FRONT', 'EDGES', .03),
    finding('back-surface', 'BACK', 'SURFACE', .02),
    { ...finding('removed', 'FRONT', 'CORNERS', 20), reviewResult: 'REMOVED' }];
  const { grade } = calculateAtlasReview(capture(), defects);
  assert.deepEqual(grade.subgrades, { centering: 10, corners: 10, edges: 9.3, surface: 9.4 });
  assert.equal(grade.overall.rawGrade, 9.675);
  assert.equal(grade.overall.displayGrade, 9.7);
  assert.equal(calculateAtlasFinalGrade(grade.overall.rawGrade), 10);
  assert.equal(calculateAtlasFinalGrade(grade.overall.rawGrade, ATLAS_HALF_POINT_FINAL_GRADE_POLICY), 9.5);
});

test('quarter corner factor reproduces the two reviewed calibration results without changing other categories', () => {
  const cases = [
    { frontCenter: 9.7613613922068, backCenter: 9.330170292563, corner: .110744758501,
      other: [finding('back-surface', 'BACK', 'SURFACE', .023526831554)],
      raw: 9.508001015578415, final: 10, edges: 10, surface: 9.1 },
    { frontCenter: 9.4664840513762, backCenter: 9.8952513808878, corner: .11522757446,
      other: [finding('front-edge', 'FRONT', 'EDGES', .017938066465),
        finding('front-surface', 'FRONT', 'SURFACE', .011514190866)],
      raw: 9.461278562557421, final: 9, edges: 9.65, surface: 9.3 },
  ];
  for (const sample of cases) {
    const { grade } = calculateAtlasReview(capture(sample.frontCenter, sample.backCenter),
      [finding('front-corner', 'FRONT', 'CORNERS', sample.corner), ...sample.other]);
    assert.equal(grade.front.corners.score, 9); assert.equal(grade.back.corners.score, 10);
    assert.equal(grade.subgrades.corners, 9.3);
    assert.equal(grade.subgrades.edges, sample.edges); assert.equal(grade.subgrades.surface, sample.surface);
    assert.ok(Math.abs(grade.overall.rawGrade - sample.raw) < 1e-10);
    assert.equal(calculateAtlasFinalGrade(grade.overall.rawGrade), sample.final);
  }
});
