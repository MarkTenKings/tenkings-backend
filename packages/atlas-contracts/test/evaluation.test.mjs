import './offline-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCohort, rateIncludingAbstentions, zeroFailureUpperBound, staffingScenario } from '../evaluation/metrics.mjs';
import { runFaultEvaluation } from '../evaluation/run.mjs';
import { hash } from '../src/strict.mjs';

test('cohort validator rejects specimen/capture/family and approved-Memory leakage', () => {
  const options = { candidateManifestHash: hash('candidate') };
  const a = { caseId: 'one', physicalSpecimenId: 'specimen_a', captureGroupId: 'capture_a', familyId: 'family_a', split: 'DEVELOPMENT', sourceHashes: [hash('front'), hash('back')], ...options };
  const b = { ...a, caseId: 'two', split: 'LOCKED_QUALITY' };
  assert.throws(() => validateCohort([a, b], options), /LEAKAGE/);
  assert.throws(() => validateCohort([{ ...b, physicalSpecimenId: 'heldout' }], { ...options, memorySpecimens: ['heldout'] }), /MEMORY_LEAKAGE/);
  assert.equal(validateCohort([a, { ...a, caseId: 'retake' }], options).groupedSpecimens, 1);
  assert.throws(() => validateCohort([a, { ...b, physicalSpecimenId: 'different', captureGroupId: 'different', familyId: 'different' }], options), /SOURCE_SPLIT_LEAKAGE/);
  assert.throws(() => validateCohort([{ ...a, candidateManifestHash: hash('different') }], options), /CANDIDATE_DRIFT/);
});
test('failed and abstained cases stay in denominators; staffing and zero-failure intervals are honest', () => {
  const results = [{ caseId: 'a', status: 'MEASURED', correct: true }, { caseId: 'b', status: 'ABSTAINED' }, { caseId: 'c', status: 'FAILED' }];
  assert.deepEqual(rateIncludingAbstentions(['a', 'b', 'c'], results, r => r.correct), { numerator: 1, denominator: 3, rate: 1 / 3, abstentions: 1, failures: 1 });
  assert.throws(() => rateIncludingAbstentions(['a', 'b', 'c'], [results[0]], r => r.correct), /RESULT_ROSTER_MISMATCH/);
  assert.throws(() => rateIncludingAbstentions(['a', 'b', 'c'], [results[0], results[0], results[0]], r => r.correct), /RESULT_ROSTER_MISMATCH/);
  assert.ok(zeroFailureUpperBound(100) > 0.029 && zeroFailureUpperBound(100) < 0.03);
  assert.equal(staffingScenario(1000, 30, 60, 0.8).reviewStaffMinutes, 625);
});
test('fault evaluator reports simulation separately and cannot claim visual quality or authorize promotion', () => {
  const report = runFaultEvaluation(8);
  assert.equal(report.jobsHandledAsExpected, 8); assert.equal(report.evidenceLimits.independentPhysicalAccuracySpecimens, 0);
  assert.equal(report.quality.defectRecall, null); assert.equal(report.promotion, 'NOT_AUTHORIZED_BY_MOCK_RESULTS');
});
