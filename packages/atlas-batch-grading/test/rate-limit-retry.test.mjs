import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { BATCH_POLICY, batchAnalysisActionId } from '../src/index.mjs';
import { createBatchRepository } from '../src/repository.mjs';

function fixture() {
  const staff = { id: randomUUID(), accessVersion: 1, role: 'REVIEWER' }, cardId = randomUUID(), sourceHash = 'a'.repeat(64);
  const key = digest(canonical([BATCH_POLICY, cardId, sourceHash]));
  const input = canonical({ cardId, sourceHash, policy: BATCH_POLICY, label: 'Fixture', uploads: { FRONT: randomUUID(), BACK: randomUUID() } });
  const row = { key, card_id: cardId, source_hash: sourceHash, actor_id: staff.id, access_version: 1,
    analysis_action_id: batchAnalysisActionId(key), analysis_attempt: 0, input, input_hash: digest(input),
    evidence: canonical({ manualRevision: 1, manualContentHash: 'b'.repeat(64) }), claim_id: randomUUID(), lease_active: true,
    state: 'RUNNING', stage: 'ANALYZE', revision: 2, attempts: 1, created_at: new Date(), updated_at: new Date() };
  const f = { staff, row, eligible: true, deleted: false, replaced: false, updates: [] };
  const tx = {
    async $queryRawUnsafe(sql) {
      if (sql.startsWith('SELECT *,lease_until')) return [row];
      if (sql.startsWith('SELECT id FROM atlas_manual_intake.card')) return [{ id: cardId }];
      if (sql.startsWith('SELECT 1 FROM atlas_manual_intake.discarded_card')) return f.deleted ? [{ one: 1 }] : [];
      if (sql.startsWith('SELECT EXISTS(')) return [{ eligible: f.eligible }];
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.batch_review')) return [];
      throw Error(`Unexpected query: ${sql}`);
    },
    async $executeRawUnsafe(sql, ...args) {
      f.updates.push({ sql, args });
      if (sql.includes('analysis_action_id=$8::uuid')) Object.assign(row, { state: args[2], stage: args[3], evidence: args[4],
        code: args[5], claim_id: null, analysis_action_id: args[7], analysis_attempt: args[8], revision: row.revision + 1 });
      return 1;
    },
  };
  const boundary = { transaction: (_staff, work) => work({ tx, principal: staff }) };
  const intakeRepository = { authorizeInTransaction: async () => ({ ready: true, sourceHash: f.replaced ? 'c'.repeat(64) : sourceHash }) };
  f.restart = () => createBatchRepository({ boundary, intakeRepository });
  f.job = () => ({ key, claimId: row.claim_id, stage: row.stage });
  return f;
}

test('proven rate-limit retry survives repository replacement and preserves every prior exact action with bounded backoff', async () => {
  const f = fixture();
  for (let attempt = 1; attempt <= 3; attempt++) {
    f.row.state = 'RUNNING'; f.row.claim_id = randomUUID();
    const repo = f.restart();
    assert.equal(await repo.finish(f.staff, f.job(), { kind: 'RETRY_ANALYSIS', code: 'BATCH_PROVIDER_RATE_LIMITED' }), true);
    const job = (await f.restart().readReview(f.staff, f.row.key)).job;
    assert.equal(job.analysisAttempt, attempt); assert.equal(job.analysisActionId, batchAnalysisActionId(f.row.key, attempt));
    assert.deepEqual(job.evidence.analysisActions, Array.from({ length: attempt }, (_, index) => batchAnalysisActionId(f.row.key, index)));
    assert.equal(f.updates.at(-1).args[6], attempt === 1 ? 30000 : 60000);
  }
  f.row.state = 'RUNNING'; f.row.claim_id = randomUUID();
  await assert.rejects(f.restart().finish(f.staff, f.job(), { kind: 'RETRY_ANALYSIS' }), { code: 'BATCH_RATE_LIMIT_RETRY_EXHAUSTED' });
  assert.equal(f.updates.length, 3);
});

test('unproven refusal, changed photos, expired lease and a replaced claim never allocate a successor', async () => {
  for (const condition of ['unproven', 'photos', 'lease', 'claim']) {
    const f = fixture(), job = f.job();
    if (condition === 'unproven') f.eligible = false;
    if (condition === 'photos') f.replaced = true;
    if (condition === 'lease') f.row.lease_active = false;
    if (condition === 'claim') f.row.claim_id = randomUUID();
    const result = f.restart().finish(f.staff, job, { kind: 'RETRY_ANALYSIS' });
    if (condition === 'unproven') await assert.rejects(result, { code: 'BATCH_RATE_LIMIT_RETRY_UNPROVEN' });
    else if (condition === 'photos') await assert.rejects(result, { code: 'BATCH_PHOTOS_CHANGED' });
    else assert.equal(await result, false);
    assert.equal(f.updates.length, 0); assert.equal(f.row.analysis_attempt, 0);
  }
});

test('deleted job is retired without a successor action, retaining provider accounting identity', async () => {
  const f = fixture(), original = f.row.analysis_action_id; f.deleted = true;
  assert.equal(await f.restart().finish(f.staff, f.job(), { kind: 'RETRY_ANALYSIS' }), false);
  assert.equal(f.row.analysis_action_id, original); assert.equal(f.row.analysis_attempt, 0);
  assert.equal(f.updates.length, 1); assert.match(f.updates[0].sql, /INTAKE_CARD_DELETED/);
});
