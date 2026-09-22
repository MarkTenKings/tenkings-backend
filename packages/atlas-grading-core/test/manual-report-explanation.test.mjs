import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { previewAtlasManualReport, explainAtlasManualReport, calculateAtlasFinalGrade, ATLAS_FINAL_GRADE_POLICY } from '../dist/manual-report.js';
import { calculateConditionScore } from '../dist/scoring.js';
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

test('a nonzero 42-pixel Back surface mark correctly explains an exact 10 and preserves report bytes', () => {
  const input = source([finding()]), report = previewAtlasManualReport(input), before = structuredClone(report), hash = sha(report);
  const value = explainAtlasManualReport(report), region = value.findings[0].regions[0];
  assert.equal(region.pixelCount, 42); assert.equal(region.areaMm2, .105); assert.equal(region.weightedAreaMm2, .105);
  close(region.eligibleAreaMm2, 5015.55); assert.equal(region.weightedDamagePercent, .002093489248);
  assert.equal(region.scoreWithFinding, 10); assert.equal(region.scoreWithoutFinding, 10);
  assert.equal(region.marginalSubgradeEffect, 0); assert.equal(region.marginalOverallEffect, 0);
  close(value.sides.BACK.SURFACE.tenBandMaxWeightedAreaMm2, 10.0311);
  assert.deepEqual(value.overall, { rawGrade: 10, displayGrade: 10, roundingDelta: 0, rawDeductionFromTen: 0, displayDeductionFromTen: 0,
    finalGrade: 10, finalGradePolicy: ATLAS_FINAL_GRADE_POLICY, finalRoundingDelta: 0 });
  assert.equal(value.policy.additionalCaps, null); assert.equal(value.policy.marginalEffectsAdditive, false);
  assert.deepEqual(report, before); assert.equal(sha(report), hash);
  value.policy.conditionBands[0].score = 123; value.policy.defectMultipliers.LIGHT_SCRATCH_SCUFF = 123;
  assert.equal(explainAtlasManualReport(report).policy.conditionBands[0].score, 10);
  assert.equal(explainAtlasManualReport(report).policy.defectMultipliers.LIGHT_SCRATCH_SCUFF, 1);
  assert.equal(sha(previewAtlasManualReport(input)), hash);
});

test('condition descriptions match every exact threshold and independently expected score', () => {
  const bands = explain([]).policy.conditionBands;
  for (const [damage, score] of [[0,10],[.2,10],[.200001,9],[1,9],[1.000001,8],[2,8],[2.000001,7],
    [3.5,7],[3.500001,6],[4.999999,6],[5,5],[5.999999,5],[6,4],[6.999999,4],[7,3],[7.999999,3],
    [8,2],[9.999999,2],[10,1],[20,1]]) {
    const matches = bands.filter(b => (b.lowerInclusive ? damage >= b.lowerPercent : damage > b.lowerPercent)
      && (b.upperPercent === null || (b.upperInclusive ? damage <= b.upperPercent : damage < b.upperPercent)));
    assert.equal(matches.length, 1); assert.equal(matches[0].score, score); assert.equal(calculateConditionScore(damage), score);
  }
  const justBelow = explain([finding({ area: 80 * .0025, denominator: 100 })]);
  const onePixelAbove = explain([finding({ area: 81 * .0025, denominator: 100 })]);
  assert.equal(justBelow.sides.BACK.SURFACE.score, 10); assert.equal(onePixelAbove.sides.BACK.SURFACE.score, 9);
  assert.equal(onePixelAbove.categories.surface.subgrade, 9.7);
  assert.equal(onePixelAbove.findings[0].regions[0].marginalSubgradeEffect, .3);
  assert.equal(onePixelAbove.findings[0].regions[0].marginalOverallEffect, .075);
});

test('marginal effects are independently calculated and must not be summed as deductions', () => {
  const value = explain([finding({ id: 'one', side: 'FRONT', area: .15, denominator: 100 }),
    finding({ id: 'two', side: 'FRONT', area: .15, denominator: 100 })]);
  assert.equal(value.sides.FRONT.SURFACE.weightedDamagePercent, .3);
  assert.equal(value.categories.surface.subgrade, 9.3);
  for (const f of value.findings) {
    assert.equal(f.regions[0].scoreWithFinding, 9); assert.equal(f.regions[0].scoreWithoutFinding, 10);
    assert.equal(f.regions[0].marginalSubgradeEffect, .7);
  }
  close(value.categories.surface.deductionFromTen, .7);
  close(value.findings.reduce((sum, f) => sum + f.regions[0].marginalSubgradeEffect, 0), 1.4);
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
  assert.equal(value.sides.BACK.CORNERS.score, 8); assert.equal(value.sides.BACK.EDGES.score, 9);
  assert.equal(value.categories.corners.subgrade, 9.4); assert.equal(value.categories.edges.subgrade, 9.7);
  close(value.overall.rawGrade, 9.775); assert.equal(value.overall.displayGrade, 9.8);
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

test('new ATLAS reports award half-point grades directly from raw with upward quarter-point ties', () => {
  for (const [raw, final, detail] of [[9.7,9.5,9.7],[9.8,10,9.8],[9.25,9.5,9.3],[9.75,10,9.8],
    [9.249999,9,9.2],[9.250001,9.5,9.3],[9.749999,9.5,9.7],[9.750001,10,9.8],
    [9.24,9,9.2],[9.26,9.5,9.3],[10,10,10]]) {
    const input = source([]), centeringScore = raw * 4 - 30;
    const worst = 55 + (10 - centeringScore) * 5, left = worst / 1000, right = (100 - worst) / 1000;
    const printed = [{ x: left, y: .03 }, { x: 1 - right, y: .03 }, { x: 1 - right, y: .97 }, { x: left, y: .97 }];
    input.capture.front.centeringQuad = printed; input.capture.back.centeringQuad = printed;
    const report = previewAtlasManualReport(input), explanation = explainAtlasManualReport(report);
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
  const current = previewAtlasManualReport(source([finding({ side: 'FRONT', area: .7, denominator: 100 })]));
  const { finalGrade, finalGradePolicy, ...legacyFields } = current;
  const historical = { ...legacyFields, version: 'atlas-manual-draft-report-v1' };
  // Captured from the V1 builder before this policy change, independently of
  // the new rounding path. The persisted old report keeps its original hash.
  const historicalHash = 'd0c72494ea26530f1ebccc5975627da31ddafe12306dea38bb8957edda751453';
  assert.equal(sha(historical), historicalHash);
  const explanation = explainAtlasManualReport(historical);
  assert.equal(explanation.overall.rawGrade, 9.825); assert.equal(explanation.overall.displayGrade, 9.8);
  assert.equal(explanation.overall.finalGrade, 9.8);
  assert.equal(explanation.overall.finalGradePolicy, 'atlas-historical-tenth-v1');
  assert.equal(current.finalGrade, 10); assert.equal(sha(historical), historicalHash);
  assert.deepEqual(historical.grade, current.grade); assert.notEqual(sha(current), historicalHash);
  assert.throws(() => explainAtlasManualReport({ ...historical, finalGrade: 10 }), /EXPLANATION_INVALID/);
  assert.throws(() => explainAtlasManualReport({ ...current, finalGradePolicy: 'unreviewed-future-policy' }), /EXPLANATION_INVALID/);
  assert.throws(() => explainAtlasManualReport({ ...current, version: 'atlas-manual-draft-report-v3' }), /EXPLANATION_INVALID/);
});

test('half-point final policy preserves representable values immediately below exact quarter boundaries', () => {
  // IEEE-754 adjacent values, not decimal approximations rounded by the
  // unchanged twelve-place physical measurement normalization.
  for (const [raw, final] of [[1,1],[1.2499999999999998,1],[1.25,1.5],[1.2500000000000002,1.5],
    [9.749999999999998,9.5],[9.75,10],[9.750000000000002,10],[10,10]]) {
    assert.equal(calculateAtlasFinalGrade(raw), final);
  }
  for (const invalid of [0, 10.1, NaN, Infinity]) assert.throws(() => calculateAtlasFinalGrade(invalid), /FINAL_GRADE_INVALID/);
});

test('low-score reports retain raw measurements on both sides of the 1.25 award boundary', () => {
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
    const report = previewAtlasManualReport(input), explained = explainAtlasManualReport(report);
    close(report.grade.overall.rawGrade, raw); assert.equal(report.finalGrade, final);
    assert.equal(explained.overall.finalGrade, final);
    assert.deepEqual(['corners','edges','surface'].map(key => report.grade.subgrades[key]), [1,1,1]);
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
