import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { loadResearchReplayVersions, replaySyntheticResearch, replayHistoricalResearch } from '../scripts/lib/staffResearchReplay';

test('exact baseline and current source receive identical frozen tapes; three mechanisms recover and ten controls remain bounded', async () => {
  const versions = await loadResearchReplayVersions(resolve(__dirname, '../../..'));
  try {
    const report = await replaySyntheticResearch(versions);
    assert.equal(report.passed, true); assert.equal(report.cases.length, 13); assert.equal(report.accuracy_claim, false);
    for (const row of report.cases.slice(0, 3)) {
      assert.notEqual(row.baseline.estimate.estimate_status, 'estimated', row.id);
      assert.equal(row.candidate.estimate.estimate_status, 'estimated', row.id);
      assert.ok(row.candidate.decisions.classifications.every((v: string) => v === 'matched'));
      assert.equal(row.baseline.decisions.engine_version, 'staff-inventory-research-v2');
      assert.equal(row.candidate.decisions.engine_version, 'staff-inventory-research-v3');
      assert.equal(row.input_sha256.length, 64); assert.equal(row.source_sha256.length, 64);
    }
    for (const id of ['missing_sold_status', 'active_listing']) {
      const row = report.cases.find(value => value.id === id)!;
      assert.equal(row.baseline.estimate.estimate_status, 'estimated');
      assert.notEqual(row.candidate.estimate.estimate_status, 'estimated');
      assert.ok(row.candidate.decisions.classifications.every((v: string) => v === 'matched'), 'Sale eligibility is distinct from visual match');
      assert.ok(row.candidate.decisions.source_eligible.every((v: boolean) => v === false));
    }
    const unknownOffer = report.cases.find(value => value.id === 'missing_offer_flag')!;
    assert.notEqual(unknownOffer.baseline.estimate.estimate_status, 'estimated'); assert.notEqual(unknownOffer.candidate.estimate.estimate_status, 'estimated');
    for (const row of report.cases) for (const version of ['baseline', 'candidate']) for (const mode of ['decisions', 'estimate']) {
      assert.equal(row[version][mode].provider_calls, 1); assert.equal(row[version][mode].model_calls, 1);
    }
    assert.equal(replayHistoricalResearch({ jobs: [] }, versions).final_estimate_replay, 'unavailable_without_original_source_and_model_evidence');
    assert.throws(() => replayHistoricalResearch({ jobs: [{ result: {}, input: {}, inputHash: '0'.repeat(64), resultHash: '0'.repeat(64) }] }, versions), /hash mismatch/);
  } finally { await versions.close(); }
});
