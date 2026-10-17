import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { previewAtlasManualReport, explainAtlasManualReport, calculateAtlasFinalGrade, ATLAS_FINAL_GRADE_POLICY,
  ATLAS_HALF_POINT_FINAL_GRADE_POLICY } from '../dist/manual-report.js';
import { calculateConditionScore } from '../dist/scoring.js';
import { calculateAtlasConditionScore, calculateAtlasScoringDamagePercent, ATLAS_RULE_VERSION } from '../dist/atlas-policy.js';
import { calculateSpeedsterReview } from '../dist/review.js';
import { measureSpeedsterCenteringBorders } from '../dist/scoring.js';
import { SPEEDSTER_RULE_VERSION } from '../dist/contracts.js';
import { encodeSpeedsterTraceRleV1 } from '../dist/trace-codec.js';

const quad = [{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }];
const contour = [{ x: .2, y: .2 }, { x: .3, y: .2 }, { x: .3, y: .3 }];
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function finding({ id = 'mark', side = 'BACK', zone = 'SURFACE', area = .105, denominator = 5015.55,
  defectType = 'LIGHT_SCRATCH_SCUFF', reviewResult = 'SMART_MARKED' } = {}) {
  return { id, side, zone, defectType, confidence: 1, sourceViewId: `${side}:inspection`, supportingViewIds: [],
    reviewResult, origin: 'SMART_MARK', canonicalContour: contour,
    measurement: { pixelCount: Math.round(area / .0025), widthMm: .4, heightMm: .5,
      areaMm2: area, zonePercent: area / denominator * 100, multiplier: 1, weightedAreaMm2: area, subgradeEffect: 0 } };
}
function source(findings = []) {
  return { cardProfile: 'SPORTS', identity: { playerName: 'Synthetic', year: '2026', manufacturer: 'Fixture', productSet: 'Report explanation' },
    draftRevision: 7, findingRevisions: { front: 3, back: 2 },
    capture: { front: { centeringQuad: structuredClone(quad), inspectionImageSha256: 'a'.repeat(64) },
      back: { centeringQuad: structuredClone(quad), inspectionImageSha256: 'b'.repeat(64) } },
    reviewedDefects: findings,
    manualInspection: { method: 'HUMAN', front: { inspected: true, imageSha256: 'a'.repeat(64), findingRevision: 3 },
      back: { inspected: true, imageSha256: 'b'.repeat(64), findingRevision: 2 } } };
}
const explain = findings => explainAtlasManualReport(previewAtlasManualReport(source(findings)));
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const historicalHalfReport = input => {
  const report = previewAtlasManualReport(input);
  return { ...report, finalGrade: calculateAtlasFinalGrade(report.grade.overall.rawGrade, ATLAS_HALF_POINT_FINAL_GRADE_POLICY),
    finalGradePolicy: ATLAS_HALF_POINT_FINAL_GRADE_POLICY };
};

test('a nonzero 42-pixel Back surface mark correctly explains an exact 10 and preserves report bytes', () => {
  const input = source([finding()]), report = previewAtlasManualReport(input), before = structuredClone(report), hash = sha(report);
  const value = explainAtlasManualReport(report), region = value.findings[0].regions[0];
  assert.equal(region.pixelCount, 42); assert.equal(region.areaMm2, .105); assert.equal(region.weightedAreaMm2, .105);
  close(region.eligibleAreaMm2, 5015.55); assert.equal(region.weightedDamagePercent, .002093489248);
  assert.equal(region.scoringDamagePercent, .004186978496);
  assert.equal(region.scoreWithFinding, 10); assert.equal(region.scoreWithoutFinding, 10);
  assert.equal(region.marginalSubgradeEffect, 0); assert.equal(region.marginalOverallEffect, 0);
  close(value.sides.BACK.SURFACE.tenBandMaxWeightedAreaMm2, .2507775);
  assert.deepEqual(value.overall, { rawGrade: 10, displayGrade: 10, roundingDelta: 0, rawDeductionFromTen: 0, displayDeductionFromTen: 0,
    finalGrade: 10, finalGradePolicy: ATLAS_FINAL_GRADE_POLICY, finalRoundingDelta: 0 });
  assert.equal(value.policy.additionalCaps, null); assert.equal(value.policy.marginalEffectsAdditive, false);
  assert.deepEqual(report, before); assert.equal(sha(report), hash);
  value.policy.conditionBands[0].score = 123; value.policy.defectMultipliers.LIGHT_SCRATCH_SCUFF = 123;
  assert.equal(explainAtlasManualReport(report).policy.conditionBands[0].score, 10);
  assert.equal(explainAtlasManualReport(report).policy.defectMultipliers.LIGHT_SCRATCH_SCUFF, 1);
  assert.equal(sha(previewAtlasManualReport(input)), hash);
});

test('condition descriptions match every scoring-percent band and all category multipliers', () => {
  const bands = explain([]).policy.conditionBands;
  assert.deepEqual(explain([]).policy.categoryDamageMultipliers, { CORNERS: .5, EDGES: 1, SURFACE: 2 });
  assert.equal(explain([]).policy.globalDamageMultiplier, undefined);
  for (const [damage, score] of [[0,10],[.01,10],[.010001,9.5],[.02,9.5],[.020001,9],[.03,9],
    [.030001,8],[.04,8],[.040001,7],[.05,7],[.050001,6],[.06,6],[.060001,5],[.07,5],
    [.070001,4],[.08,4],[.080001,3],[.09,3],[.090001,2],[.1,2],[.100001,1],[20,1]]) {
    const matches = bands.filter(b => (b.lowerInclusive ? damage >= b.lowerPercent : damage > b.lowerPercent)
      && (b.upperPercent === null || (b.upperInclusive ? damage <= b.upperPercent : damage < b.upperPercent)));
    assert.equal(matches.length, 1); assert.equal(matches[0].score, score);
  }
  for (const [zone, multiplier] of [['CORNERS',.5],['EDGES',1],['SURFACE',2]]) {
    assert.equal(calculateAtlasConditionScore(.02, zone), { CORNERS: 10, EDGES: 9.5, SURFACE: 8 }[zone]);
    close(calculateAtlasScoringDamagePercent(.02, zone), .02 * multiplier);
    const value = explain([finding({ zone, area: .02, denominator: 100 })]);
    assert.equal(value.sides.BACK[zone].weightedDamagePercent, .02);
    assert.equal(value.sides.BACK[zone].scoringDamagePercent, .02 * multiplier);
    assert.equal(value.sides.BACK[zone].tenBandMaxWeightedAreaMm2, .01 / multiplier);
    assert.equal(value.findings[0].regions[0].scoreWithFinding, value.sides.BACK[zone].score);
  }
  const justBelow = explain([finding({ area: 2 * .0025, denominator: 100 })]);
  const onePixelAbove = explain([finding({ area: 3 * .0025, denominator: 100 })]);
  assert.equal(justBelow.sides.BACK.SURFACE.score, 10); assert.equal(onePixelAbove.sides.BACK.SURFACE.score, 9.5);
  assert.equal(onePixelAbove.categories.surface.subgrade, 9.85);
  assert.equal(onePixelAbove.findings[0].regions[0].marginalSubgradeEffect, .15);
  assert.equal(onePixelAbove.findings[0].regions[0].marginalOverallEffect, .0375);
});

test('marginal effects are independently calculated and must not be summed as deductions', () => {
  const value = explain([finding({ id: 'one', side: 'FRONT', area: .004, denominator: 100 }),
    finding({ id: 'two', side: 'FRONT', area: .004, denominator: 100 })]);
  assert.equal(value.sides.FRONT.SURFACE.weightedDamagePercent, .008);
  assert.equal(value.sides.FRONT.SURFACE.scoringDamagePercent, .016);
  assert.equal(value.categories.surface.subgrade, 9.65);
  for (const f of value.findings) {
    assert.equal(f.regions[0].scoreWithFinding, 9.5); assert.equal(f.regions[0].scoreWithoutFinding, 10);
    assert.equal(f.regions[0].marginalSubgradeEffect, .35);
  }
  close(value.categories.surface.deductionFromTen, .35);
  close(value.findings.reduce((sum, f) => sum + f.regions[0].marginalSubgradeEffect, 0), .7);
  assert.equal(value.policy.marginalEffectsAdditive, false);
});

test('source traces retain multiple measured zones and multiplier-based damage without trace remeasurement', () => {
  const mask = new Uint8Array(1270 * 1778);
  for (let y = 60; y < 80; y++) for (let x = 60; x < 80; x++) mask[y * 1270 + x] = 1;
  for (let y = 20; y < 40; y++) for (let x = 160; x < 180; x++) mask[y * 1270 + x] = 1;
  const rle = encodeSpeedsterTraceRleV1(mask), legacy = finding({ defectType: 'CHIPPING_EXPOSED_STOCK' });
  const { zone, measurement, canonicalContour, ...base } = legacy;
  const trace = { ...base, finalTrace: rle,
    traceProvenance: { version: 'speedster-trace-provenance-v1', sourceViewId: base.sourceViewId,
      cropTransform: { version: 'speedster-canonical-crop-affine-v1', crop: { x: 0, y: 0, width: 1269, height: 1777 } },
      highlighterStrokes: [], finalTraceSha256: rle.sha256 },
    measurementRegions: [['CORNERS',91.29],['EDGES',529.6]].map(([zone, denominator]) => ({ zone, canonicalContour: contour,
      measurement: { ...measurement, pixelCount: 400, areaMm2: 1, zonePercent: 100 / denominator, weightedAreaMm2: 1 } })) };
  const value = explain([trace]);
  assert.deepEqual(value.findings[0].regions.map(r => r.zone), ['CORNERS','EDGES']);
  for (const r of value.findings[0].regions) { assert.equal(r.multiplier, 1.5); assert.equal(r.areaMm2, 1); assert.equal(r.weightedAreaMm2, 1.5); }
  assert.equal(value.sides.BACK.CORNERS.score, 1); assert.equal(value.sides.BACK.EDGES.score, 1);
  assert.equal(value.categories.corners.subgrade, 7.3); assert.equal(value.categories.edges.subgrade, 7.3);
  close(value.overall.rawGrade, 8.65); assert.equal(value.overall.displayGrade, 8.7);
  // A retained, fully shadowed exact trace owns no measured region. Its full
  // bitmap must never be counted again by an explanation-only projection.
  const shadowed = explain([trace, { ...trace, id: 'shadowed', measurementRegions: [] }]);
  assert.deepEqual(shadowed.sides, value.sides); assert.deepEqual(shadowed.overall, value.overall);
  assert.equal(shadowed.findings.length, 2); assert.deepEqual(shadowed.findings[1].regions, []);
});

test('removed findings retain physical evidence but contribute no damage; empty categories have no invented denominator', () => {
  const removed = finding({ reviewResult: 'REMOVED', area: 10, denominator: 100 }); removed.measurement.subgradeEffect = 5;
  const value = explain([removed]), region = value.findings[0].regions[0];
  assert.equal(value.findings[0].included, false); assert.equal(region.areaMm2, 10); assert.equal(region.eligibleAreaMm2, 100);
  assert.equal(region.weightedDamagePercent, 0); assert.equal(region.marginalSubgradeEffect, 0); assert.equal(region.subgradeEffect, 0);
  assert.equal(value.sides.BACK.SURFACE.eligibleAreaMm2, null);
  assert.equal(value.sides.BACK.SURFACE.tenBandMaxWeightedAreaMm2, null);
  assert.equal(value.sides.BACK.SURFACE.weightedDamagePercent, 0); assert.equal(value.overall.rawGrade, 10);
});

test('centering tolerance and final display rounding remain distinct from exact raw scores', () => {
  const input = source([]);
  // Horizontal balance 56/44 yields Front centering9.8, subgrade9.86,
  // raw overall9.965 and displayed10. Other categories have zero damage.
  input.capture.front.centeringQuad = [{ x: .056, y: .03 }, { x: .956, y: .03 }, { x: .956, y: .97 }, { x: .056, y: .97 }];
  const value = explainAtlasManualReport(previewAtlasManualReport(input));
  assert.equal(value.sides.FRONT.centering.worstPercent, 56); assert.equal(value.sides.FRONT.centering.withinTenTolerance, false);
  assert.equal(value.sides.FRONT.centering.score, 9.8); assert.equal(value.sides.BACK.centering.withinTenTolerance, true);
  close(value.categories.centering.subgrade, 9.86); close(value.overall.rawGrade, 9.965);
  assert.equal(value.overall.displayGrade, 10); close(value.overall.roundingDelta, .035);
});

test('an explanation refuses inconsistent persisted scores instead of presenting invented arithmetic', () => {
  for (const change of [r => { r.grade.back.surface.weightedDamagePercent = 1; },
    r => { r.grade.back.surface.score = 9; }, r => { r.grade.front.centering.score = 9; },
    r => { r.grade.subgrades.surface = 9; }, r => { r.grade.overall.rawGrade = 9; },
    r => { r.grade.overall.displayGrade = 9; }, r => { r.finalGrade = 9.5; }]) {
    const report = previewAtlasManualReport(source([finding()])); change(report);
    assert.throws(() => explainAtlasManualReport(report), /EXPLANATION_GRADE_MISMATCH/);
  }
  const report = previewAtlasManualReport(source([])); report.ruleVersion = 'future-unknown';
  assert.throws(() => explainAtlasManualReport(report), /EXPLANATION_INVALID/);
});

test('historical half-point reports retain direct raw rounding with upward quarter-point ties', () => {
  for (const [raw, final, detail] of [[9.7,9.5,9.7],[9.8,10,9.8],[9.25,9.5,9.3],[9.75,10,9.8],
    [9.249999,9,9.2],[9.250001,9.5,9.3],[9.749999,9.5,9.7],[9.750001,10,9.8],
    [9.24,9,9.2],[9.26,9.5,9.3],[10,10,10]]) {
    const input = source([]), centeringScore = raw * 4 - 30;
    const worst = 55 + (10 - centeringScore) * 5, left = worst / 1000, right = (100 - worst) / 1000;
    const printed = [{ x: left, y: .03 }, { x: 1 - right, y: .03 }, { x: 1 - right, y: .97 }, { x: left, y: .97 }];
    input.capture.front.centeringQuad = printed; input.capture.back.centeringQuad = printed;
    const report = historicalHalfReport(input), explanation = explainAtlasManualReport(report);
    assert.equal(report.version, 'atlas-manual-draft-report-v2');
    assert.equal(report.finalGradePolicy, 'atlas-final-half-point-v1');
    close(report.grade.overall.rawGrade, raw); assert.equal(report.grade.overall.displayGrade, detail);
    assert.equal(report.finalGrade, final); assert.equal(explanation.overall.finalGrade, final);
    close(explanation.overall.finalRoundingDelta, final - raw);
    assert.equal(explanation.policy.finalGradeRoundingInput, 'rawGrade');
    assert.deepEqual(['corners','edges','surface'].map(k => report.grade.subgrades[k]), [10,10,10]);
    close(report.grade.subgrades.centering, centeringScore);
  }
});

test('historical V1 report bytes and tenth-point final remain unchanged by the new policy', () => {
  const input = source([finding({ side: 'FRONT', area: .7, denominator: 100 })]);
  const current = previewAtlasManualReport(input);
  const centeringBorders = measureSpeedsterCenteringBorders(quad);
  const oldReview = calculateSpeedsterReview({ front: { centeringBorders }, back: { centeringBorders } }, input.reviewedDefects);
  const { finalGrade, finalGradePolicy, ...legacyFields } = current;
  const historical = { ...legacyFields, version: 'atlas-manual-draft-report-v1', ruleVersion: SPEEDSTER_RULE_VERSION,
    grade: oldReview.grade, findings: oldReview.defects };
  // Captured from the V1 builder before this policy change, independently of
  // the new rounding path. The persisted old report keeps its original hash.
  const historicalHash = 'd0c72494ea26530f1ebccc5975627da31ddafe12306dea38bb8957edda751453';
  assert.equal(sha(historical), historicalHash);
  const explanation = explainAtlasManualReport(historical);
  assert.equal(explanation.overall.rawGrade, 9.825); assert.equal(explanation.overall.displayGrade, 9.8);
  assert.equal(explanation.overall.finalGrade, 9.8);
  assert.equal(explanation.overall.finalGradePolicy, 'atlas-historical-tenth-v1');
  assert.equal(current.ruleVersion, ATLAS_RULE_VERSION); assert.equal(current.finalGrade, 8); assert.equal(sha(historical), historicalHash);
  assert.notDeepEqual(historical.grade, current.grade); assert.notEqual(sha(current), historicalHash);
  assert.equal(explanation.policy.globalDamageMultiplier, undefined);
  assert.equal(explanation.sides.FRONT.SURFACE.scoringDamagePercent, undefined);
  assert.equal(calculateConditionScore(historical.grade.front.surface.weightedDamagePercent), historical.grade.front.surface.score);
  assert.throws(() => explainAtlasManualReport({ ...historical, finalGrade: 10 }), /EXPLANATION_INVALID/);
  assert.throws(() => explainAtlasManualReport({ ...current, finalGradePolicy: 'unreviewed-future-policy' }), /EXPLANATION_INVALID/);
  assert.throws(() => explainAtlasManualReport({ ...current, version: 'atlas-manual-draft-report-v3' }), /EXPLANATION_INVALID/);
});

test('half-point final policy preserves representable values immediately below exact quarter boundaries', () => {
  // IEEE-754 adjacent values, not decimal approximations rounded by the
  // unchanged twelve-place physical measurement normalization.
  for (const [raw, final] of [[1,1],[1.2499999999999998,1],[1.25,1.5],[1.2500000000000002,1.5],
    [9.749999999999998,9.5],[9.75,10],[9.750000000000002,10],[10,10]]) {
    assert.equal(calculateAtlasFinalGrade(raw, ATLAS_HALF_POINT_FINAL_GRADE_POLICY), final);
  }
  for (const invalid of [0, 10.1, NaN, Infinity]) assert.throws(() => calculateAtlasFinalGrade(invalid), /FINAL_GRADE_INVALID/);
});

test('low-score historical half-point reports retain raw measurements on both sides of the 1.25 award boundary', () => {
  const damaged = ['FRONT','BACK'].flatMap(side => ['CORNERS','EDGES','SURFACE']
    .map(zone => finding({ id: `${side}:${zone}`, side, zone, area: 10, denominator: 100 })));
  const centered = score => {
    const worst = score === 1 ? 100 : 55 + (10 - score) * 5;
    const left = worst / 1000, right = (100 - worst) / 1000;
    return [{ x: left, y: .03 }, { x: 1 - right, y: .03 }, { x: 1 - right, y: .97 }, { x: left, y: .97 }];
  };
  for (const [front, back, raw, final] of [[1,1,1,1],[2,2,1.25,1.5],
    [1,4.33332,1.249999,1],[1,4.333346666667,1.250001,1.5]]) {
    const input = source(damaged); input.capture.front.centeringQuad = centered(front); input.capture.back.centeringQuad = centered(back);
    const report = historicalHalfReport(input), explained = explainAtlasManualReport(report);
    close(report.grade.overall.rawGrade, raw); assert.equal(report.finalGrade, final);
    assert.equal(explained.overall.finalGrade, final);
    assert.deepEqual(['corners','edges','surface'].map(key => report.grade.subgrades[key]), [1,1,1]);
    const current = previewAtlasManualReport(input);
    assert.deepEqual(current.grade, report.grade); assert.deepEqual(current.findings, report.findings);
    assert.equal(current.finalGrade, 1); assert.equal(explainAtlasManualReport(current).overall.finalGrade, 1);
  }
});

test('uneven and threshold-adjacent printed quads preserve normalized centering without a second axis normalization', () => {
  const pairs = [[.01234567890123, .05432198765432], [.07142857142857143, .06363636363636364],
    ...[55, 55.000000000001, 54.999999999999, 95, 95.000000000001, 94.999999999999]
      .map(p => [.001 * p, .001 * (100 - p)])];
  let seed = 76543;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 120; i++) pairs.push([.001 + random() * .15, .001 + random() * .15]);
  for (const [left, right] of pairs) {
    const input = source([]);
    input.capture.front.centeringQuad = [{ x: left, y: .0234567890123 }, { x: 1 - right, y: .0234567890123 },
      { x: 1 - right, y: .9543210987654 }, { x: left, y: .9543210987654 }];
    const report = previewAtlasManualReport(input), explained = explainAtlasManualReport(report);
    assert.equal(explained.sides.FRONT.centering.score, report.grade.front.centering.score);
    assert.equal(explained.sides.FRONT.centering.worstPercent, Math.max(...report.grade.front.centering.leftRightBalance,
      ...report.grade.front.centering.topBottomBalance));
  }
  const report = previewAtlasManualReport(source([]));
  report.grade.front.centering.leftRightBalance = [55,44.999999999999];
  assert.equal(explainAtlasManualReport(report).sides.FRONT.centering.score, 10);
});

test('a synthetic prior ATLAS 1.5 report remains immutable and is explained under its recorded rule', () => {
  // Authored synthetic values only: each side has .020% measured damage in all
  // three categories. The retired uniform 1.5 policy scored each category 9.
  const findings = ['FRONT','BACK'].flatMap(side => ['CORNERS','EDGES','SURFACE'].map(zone =>
    finding({ id: `${side}-${zone}`, side, zone, area: .02, denominator: 100 })));
  const current = previewAtlasManualReport(source(findings));
  const historical = structuredClone(current);
  historical.ruleVersion = 'ATLAS_2026_09_30_DAMAGE_1_5_V1';
  for (const side of ['front','back']) for (const category of ['corners','edges','surface']) historical.grade[side][category].score = 9;
  historical.grade.subgrades = { centering: 10, corners: 9, edges: 9, surface: 9 };
  historical.grade.overall = { rawGrade: 9.25, displayGrade: 9.3 };
  historical.finalGrade = 9.5;
  historical.finalGradePolicy = ATLAS_HALF_POINT_FINAL_GRADE_POLICY;
  for (const f of historical.findings) f.measurement.subgradeEffect = f.side === 'FRONT' ? .7 : .3;
  const before = structuredClone(historical), hash = sha(historical), explanation = explainAtlasManualReport(historical);
  assert.equal(hash, 'eebcd447bf5e4834368ba45feb3671c6eb0aa7389d5ee54ce3c51f59e15da051');
  assert.equal(explanation.policy.globalDamageMultiplier, 1.5);
  assert.equal(explanation.policy.categoryDamageMultipliers, undefined);
  assert.equal(explanation.policy.conditionFormula, '100 × sum(measured area × defect multiplier) ÷ eligible category area × 1.5');
  for (const side of ['FRONT','BACK']) for (const zone of ['CORNERS','EDGES','SURFACE']) {
    assert.equal(explanation.sides[side][zone].weightedDamagePercent, .02);
    assert.equal(explanation.sides[side][zone].scoringDamagePercent, .03);
    assert.equal(explanation.sides[side][zone].score, 9);
    close(explanation.sides[side][zone].tenBandMaxWeightedAreaMm2, .01 / 1.5);
  }
  assert.equal(explanation.overall.finalGrade, 9.5);
  assert.deepEqual(historical, before); assert.equal(sha(historical), hash);
  assert.deepEqual(current.grade.subgrades, { centering: 10, corners: 10, edges: 9.5, surface: 8 });
  assert.equal(current.ruleVersion, ATLAS_RULE_VERSION);
  assert.throws(() => explainAtlasManualReport({ ...historical, ruleVersion: ATLAS_RULE_VERSION }), /EXPLANATION_GRADE_MISMATCH/);
  assert.throws(() => explainAtlasManualReport({ ...current, ruleVersion: historical.ruleVersion }), /EXPLANATION_GRADE_MISMATCH/);
});

// Adjacent positive finite doubles, with no decimal pre-rounding in the test.
const adjacent = (value, direction) => {
  const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value);
  bytes.setBigUint64(0, bytes.getBigUint64(0) + BigInt(direction));
  return bytes.getFloat64(0);
};

test('whole-number final awards use exact raw inputs across every halfway boundary and reject invalid domains', () => {
  assert.equal(ATLAS_FINAL_GRADE_POLICY, 'atlas-final-whole-point-v1');
  for (let lower = 1; lower < 10; lower++) {
    const boundary = lower + .5;
    assert.equal(calculateAtlasFinalGrade(adjacent(boundary, -1)), lower);
    assert.equal(calculateAtlasFinalGrade(boundary), lower + 1);
    assert.equal(calculateAtlasFinalGrade(adjacent(boundary, 1)), lower + 1);
  }
  for (const [raw, expected] of [[1,1], [1.25,1], [7.64684128229908,8], [8.25,8], [8.35,8], [8.45,8], [8.49,8], [8.5,9],
    [8.75,9], [9.25,9], [9.49,9], [9.5,10], [9.7,10], [9.75,10], [10,10]]) {
    assert.equal(calculateAtlasFinalGrade(raw), expected);
  }
  for (const invalid of [0, .5, adjacent(1, -1), adjacent(10, 1), 10.0001, NaN, Infinity, -Infinity]) {
    for (const policy of [ATLAS_FINAL_GRADE_POLICY, ATLAS_HALF_POINT_FINAL_GRADE_POLICY]) {
      assert.throws(() => calculateAtlasFinalGrade(invalid, policy), /FINAL_GRADE_INVALID/);
    }
  }
  assert.throws(() => calculateAtlasFinalGrade(8.35, 'unknown'), /FINAL_GRADE_POLICY_INVALID/);
  // Both tempting intermediate inputs would incorrectly award 9 for raw 8.45.
  assert.equal(calculateAtlasFinalGrade(calculateAtlasFinalGrade(8.35, ATLAS_HALF_POINT_FINAL_GRADE_POLICY)), 9);
  assert.equal(calculateAtlasFinalGrade(8.35), 8);
  assert.equal(calculateAtlasFinalGrade(Math.round(8.45 * 10) / 10), 9);
  assert.equal(calculateAtlasFinalGrade(8.45), 8);
});

test('historical half-point dispatch preserves every quarter-point boundary and adjacent double', () => {
  for (let lower = 1; lower < 10; lower += .5) {
    const boundary = lower + .25;
    assert.equal(calculateAtlasFinalGrade(adjacent(boundary, -1), ATLAS_HALF_POINT_FINAL_GRADE_POLICY), lower);
    assert.equal(calculateAtlasFinalGrade(boundary, ATLAS_HALF_POINT_FINAL_GRADE_POLICY), lower + .5);
    assert.equal(calculateAtlasFinalGrade(adjacent(boundary, 1), ATLAS_HALF_POINT_FINAL_GRADE_POLICY), lower + .5);
  }
});

test('new report creation and explanation round raw 8.35 to 8 and raw 8.5 to 9 without tenth-point input', () => {
  for (const [raw, expected] of [[8.35,8], [8.45,8], [8.49,8], [8.5,9], [9.49,9], [9.5,10], [9.7,10]]) {
    const input = source([]), centeringScore = raw * 4 - 30, worst = 55 + (10 - centeringScore) * 5;
    const left = worst / 1000, right = (100 - worst) / 1000;
    const printed = [{ x: left, y: .03 }, { x: 1 - right, y: .03 }, { x: 1 - right, y: .97 }, { x: left, y: .97 }];
    input.capture.front.centeringQuad = printed; input.capture.back.centeringQuad = printed;
    const report = previewAtlasManualReport(input), before = sha(report), explanation = explainAtlasManualReport(report);
    assert.equal(report.finalGradePolicy, ATLAS_FINAL_GRADE_POLICY); close(report.grade.overall.rawGrade, raw);
    assert.equal(report.finalGrade, expected); assert.equal(explanation.overall.finalGrade, expected);
    assert.equal(explanation.policy.finalGradePolicy, ATLAS_FINAL_GRADE_POLICY);
    assert.match(explanation.policy.finalGradeFormula, /nearest whole number; exact \.5 ties round upward/);
    assert.equal(explanation.policy.finalGradeRoundingInput, 'rawGrade');
    assert.equal(sha(report), before);
  }
});

test('whole awards preserve precise Sports and Pokémon physical scores, findings and historical half-report hashes', () => {
  const historicalHashes = { SPORTS: '387351719b44e16c6f4ad005cc9294c25b72f2f201b30282d9b29417a531c572',
    POKEMON: 'd091589e0ad5449e874b1c925b746277d7bee620a8ed0cd64ccd1316941bd6c7' };
  for (const cardProfile of ['SPORTS', 'POKEMON']) {
    const input = source([finding({ side: 'FRONT', area: .7, denominator: 100 }),
      finding({ id: 'edge', zone: 'EDGES', area: .015, denominator: 100 })]);
    if (cardProfile === 'POKEMON') Object.assign(input, { cardProfile,
      identity: { cardName: 'Synthetic', year: '2026', productSet: 'Report explanation', layoutType: 'POKEMON' } });
    const report = previewAtlasManualReport(input), historical = historicalHalfReport(input);
    // Literal hashes captured from the pre-change builder, including precise
    // grades, all measurements/findings and identity serialization.
    assert.equal(sha(historical), historicalHashes[cardProfile]);
    const { finalGrade, finalGradePolicy, ...physical } = report;
    const { finalGrade: oldAward, finalGradePolicy: oldPolicy, ...oldPhysical } = historical;
    assert.deepEqual(physical, oldPhysical); assert.equal(finalGrade, 8); assert.equal(oldAward, 8.5);
    assert.equal(report.grade.back.edges.score, 9.5);
    assert.equal(report.grade.overall.rawGrade, 8.387500000000001); assert.equal(report.grade.overall.displayGrade, 8.4);
    const currentExplanation = explainAtlasManualReport(report), oldExplanation = explainAtlasManualReport(historical);
    for (const key of ['sides', 'categories', 'findings']) assert.deepEqual(currentExplanation[key], oldExplanation[key]);
    const invariant = explanation => {
      const copy = structuredClone(explanation);
      delete copy.policy.finalGradePolicy; delete copy.policy.finalGradeFormula;
      delete copy.overall.finalGrade; delete copy.overall.finalGradePolicy; delete copy.overall.finalRoundingDelta;
      return copy;
    };
    assert.deepEqual(invariant(currentExplanation), invariant(oldExplanation));
    assert.equal(sha(historical), historicalHashes[cardProfile]);
    assert.throws(() => explainAtlasManualReport({ ...historical, finalGradePolicy }), /GRADE_MISMATCH/);
    assert.throws(() => explainAtlasManualReport({ ...report, finalGradePolicy: oldPolicy }), /GRADE_MISMATCH/);
  }
});

test('raw 9.5 awards 10 with a category score of 8 and no additional perfect-ten cap', () => {
  const input = source(['FRONT','BACK'].map(side => finding({ id: side, side, area: .0175, denominator: 100 })));
  const report = previewAtlasManualReport(input), explanation = explainAtlasManualReport(report);
  assert.deepEqual(report.grade.subgrades, { centering: 10, corners: 10, edges: 10, surface: 8 });
  assert.equal(report.grade.overall.rawGrade, 9.5); assert.equal(report.grade.overall.displayGrade, 9.5);
  assert.equal(report.finalGrade, 10); assert.equal(explanation.overall.finalRoundingDelta, .5);
  assert.equal(explanation.policy.additionalCaps, null);
});
