import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadResearchReplayVersions, replaySyntheticResearch, replayHistoricalResearch, replayHash, RESEARCH_REPLAY_BASELINE } from '../scripts/lib/staffResearchReplay';

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
      assert.equal(row.candidate.decisions.engine_version, 'staff-inventory-research-v6');
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

test('replay binds the frozen baseline and candidate sale resolver while rejecting recovery before provider work', async () => {
  const root = resolve(__dirname, '../../..'), versions = await loadResearchReplayVersions(root);
  try {
    const engine = 'frontend/nextjs-app/lib/server/staffInventoryResearch.ts', details = 'packages/shared/src/staffInventoryResearchSaleDetails.ts';
    const frozen = execFileSync('/usr/bin/git', ['show', `${RESEARCH_REPLAY_BASELINE}:${engine}`], { cwd: root });
    assert.equal(versions.hashes.baseline[engine], replayHash(frozen));
    assert.equal(versions.hashes.candidate[details], replayHash(await readFile(resolve(root, details))));
    assert.equal(versions.hashes.baseline[details], undefined, 'The old baseline must not gain a new price resolver');
    assert.equal(versions.hashes.candidate['replay:recovery-disabled'].length, 64);
    const disabled = () => assert.fail('Unreviewed recovery must fail before provider or storage access');
    await assert.rejects(versions.candidate.researchStaffInventoryCard({
      schema_version: 1, unit_id: 'replay-unit', description_event_id: 'replay-description', description_hash: 'a'.repeat(64),
      description: { name: 'Fixture Card', category: null, manufacturer: null, year: null, set_name: null, card_number: null, variant: null, card_type: null },
      front_photo_key: null, back_photo_key: null,
    }, { recoveryAssessment: {}, env: { OPENAI_API_KEY: 'fixture', SOLDCOMPS_API_KEY: 'fixture' }, fetchImpl: disabled, loadPhoto: disabled, loadReferences: disabled }), { code: 'invalid_input' });
  } finally { await versions.close(); }
});
