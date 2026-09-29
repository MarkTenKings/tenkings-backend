import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeStoryModel, gradeStoryFrame, GRADE_STORY_DURATION } from '../src/grade-calculation-story.mjs';

function explanation(scores = [9.6, 9.2, 9.4, 9.2], final = 9.5) {
  const rawGrade = scores.reduce((sum, value) => sum + value, 0) / 4;
  return { policy: { frontWeight: .7, backWeight: .3, categoryWeight: .25,
    finalGradeFormula: 'Round the raw overall directly to the nearest 0.5.' },
  categories: Object.fromEntries(['centering', 'corners', 'edges', 'surface'].map((key, i) => [key, {
    frontScore: scores[i], backScore: scores[i], subgrade: scores[i],
    deductionFromTen: 10 - scores[i], overallContribution: scores[i] / 4,
  }])), overall: { rawGrade, finalGrade: final, rawDeductionFromTen: 10 - rawGrade } };
}

test('grade story consumes category contributions, not individual non-additive effects', () => {
  const source = explanation(); source.findings = [{ marginalOverallEffect: 999 }];
  const before = JSON.stringify(source), model = gradeStoryModel(source);
  assert.ok(Math.abs(model.raw - 9.35) < 1e-10); assert.equal(model.final, 9.5);
  assert.deepEqual(model.rows.map(row => row.key), ['centering', 'corners', 'edges', 'surface']);
  assert.ok(Math.abs(model.rows.reduce((sum, row) => sum + row.deduction, 0) - .65) < 1e-10);
  assert.equal(JSON.stringify(source), before);
});

test('9.35 is held before the final grade, and the thumbnail then changes physical position', () => {
  const model = gradeStoryModel(explanation());
  const held = gradeStoryFrame(model, 5500), landing = gradeStoryFrame(model, 6300), done = gradeStoryFrame(model, GRADE_STORY_DURATION);
  assert.equal(held.position, model.raw); assert.equal(held.raw, true); assert.equal(held.final, false);
  assert.ok(landing.position > held.position && landing.position < model.final); assert.ok(landing.lift > 0);
  assert.equal(done.position, model.final); assert.equal(done.final, true); assert.equal(done.complete, true);
});

test('round-down and unchanged awards follow the saved policy without an upward fiction', () => {
  const down = gradeStoryModel(explanation([9.1, 9.1, 9.1, 9.1], 9));
  assert.equal(down.direction, 'down'); assert.ok(gradeStoryFrame(down, 6300).position < down.raw);
  const same = gradeStoryModel(explanation([10, 10, 10, 10], 10));
  assert.equal(same.direction, 'unchanged'); assert.equal(gradeStoryFrame(same, 6300).lift, 0);
  assert.equal(gradeStoryFrame(same, 7000).position, 10);
});

test('historical tenth grade is retained without half-point recomputation', () => {
  const source = explanation([9.35, 9.35, 9.35, 9.35], 9.4);
  source.policy.finalGradeFormula = 'Historical V1 report: the original nearest-tenth display grade remains the final grade.';
  const model = gradeStoryModel(source);
  assert.equal(model.final, 9.4); assert.match(model.rounding, /Historical/);
});

test('scale always contains raw and final with an honest labeled interval, including the endpoints', () => {
  for (const [raw, final] of [[1, 1], [1.25, 1.5], [8.99, 9], [9.85, 10], [10, 10]]) {
    const model = gradeStoryModel(explanation([raw, raw, raw, raw], final));
    assert.ok(model.minimum <= Math.min(raw, final)); assert.ok(model.maximum >= Math.max(raw, final));
    assert.ok(model.minimum >= 1 && model.maximum <= 10 && model.maximum > model.minimum);
  }
});

test('incomplete, non-finite or contradictory explanation cannot manufacture a grade story', () => {
  assert.equal(gradeStoryModel(null), null);
  for (const change of [e => { e.categories.edges.subgrade = NaN; }, e => { e.overall.rawGrade = 1; },
    e => { e.categories.corners.deductionFromTen = 5; }, e => { e.policy.categoryWeight = .3; },
    e => { e.overall.finalGrade = 11; }, e => { e.categories.surface.frontScore = 0; }]) {
    const source = explanation(); change(source); assert.equal(gradeStoryModel(source), null);
  }
});
