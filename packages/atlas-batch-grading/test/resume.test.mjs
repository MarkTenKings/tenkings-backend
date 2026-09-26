import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@atlas/manual-service/contract';
import { BATCH_POLICY, batchActionId } from '../src/index.mjs';
import { createBatchRepository } from '../src/repository.mjs';

function fixture(overrides = {}) {
  const staff = { id: '10000000-0000-4000-8000-000000000001', accessVersion: 2, role: 'REVIEWER' };
  const cardId = '20000000-0000-4000-8000-000000000002', sourceHash = 'a'.repeat(64);
  const key = digest(canonical([BATCH_POLICY, cardId, sourceHash]));
  const input = canonical({ policy: BATCH_POLICY, cardId, sourceHash, label: 'Saved card', uploads: { FRONT: 'front', BACK: 'back' } });
  const row = { key, card_id: cardId, source_hash: sourceHash, input, input_hash: digest(input),
    actor_id: staff.id, access_version: 2, analysis_action_id: batchActionId(key, 'ANALYZE'), stage: 'ANALYZE',
    state: 'NEEDS_ATTENTION', revision: 7, evidence: canonical({ manualContentHash: 'b'.repeat(64), manualRevision: 3 }),
    code: 'BATCH_ANALYSIS_UNCERTAIN', attempts: 1, created_at: new Date(), updated_at: new Date(), lease_active: false,
    ...overrides };
  const f = { row, staff, updated: 0, manualHash: 'b'.repeat(64), approved: false, review: false, sourceChanged: false };
  const tx = { async $queryRawUnsafe(sql, ...args) {
    if (sql.startsWith('SELECT * FROM (SELECT j.')) return [row];
    if (sql.startsWith('SELECT *,lease_until')) return [row];
    if (sql.startsWith('SELECT m.content_hash,')) return [{ content_hash: f.manualHash, current_approval: f.approved }];
    if (sql.startsWith('SELECT job_key')) return f.review ? [{ job_key: key }] : [];
    if (sql.startsWith('UPDATE atlas_manual_connected.batch_grading SET state=$3')) {
      f.updated++;
      Object.assign(row, { state: args[2], access_version: args[1], revision: row.revision + 1, code: null });
      const { access_changed, manual_changed, review_started, current_approval, photos_changed, ...saved } = row;
      return [saved];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  f.repo = createBatchRepository({ boundary: { transaction: (_staff, work) => work({ tx, principal: staff }) },
    intakeRepository: { authorizeInTransaction: async () => ({ ready: true, sourceHash: f.sourceChanged ? 'c'.repeat(64) : sourceHash }) } });
  f.resume = () => f.repo.resume(staff, { key, expectedRevision: 7 });
  return f;
}

test('unknown analysis resumes only its original job, source and analysis action', async () => {
  const f = fixture(), action = f.row.analysis_action_id;
  assert.equal((await f.repo.list(f.staff)).jobs[0].canResumeProcessing, true);
  const result = await f.resume();
  assert.equal(result.job.state, 'QUEUED'); assert.equal(result.job.analysisActionId, action);
  assert.equal(result.job.revision, 8); assert.equal(result.job.canResumeProcessing, false);
  await assert.rejects(f.resume(), { code: 'BATCH_RESUME_STALE' }); assert.equal(f.updated, 1);
});

test('resume cannot process an approved report, changed draft, human work, foreign owner or changed photos', async () => {
  for (const [change, code] of [
    [f => { f.approved = true; }, 'BATCH_ALREADY_APPROVED'],
    [f => { f.manualHash = 'c'.repeat(64); }, 'BATCH_CONTINUE_MANUAL_REVIEW'],
    [f => { f.review = true; }, 'BATCH_CONTINUE_MANUAL_REVIEW'],
    [f => { f.row.code = 'BATCH_HUMAN_WORK_PRESENT'; }, 'BATCH_CONTINUE_MANUAL_REVIEW'],
    [f => { f.row.actor_id = '30000000-0000-4000-8000-000000000003'; }, 'BATCH_NOT_FOUND'],
    [f => { f.sourceChanged = true; }, 'BATCH_PHOTOS_CHANGED'],
  ]) {
    const f = fixture(); change(f); await assert.rejects(f.resume(), { code }); assert.equal(f.updated, 0);
  }
});

test('current access may resume preparation after corrections, or preserve a partial human review', async () => {
  const preparation = fixture({ stage: 'PREPARE', code: 'BATCH_GEOMETRY_NEEDS_REVIEW' });
  preparation.manualHash = 'c'.repeat(64); assert.equal((await preparation.resume()).job.state, 'QUEUED');
  const review = fixture({ state: 'REVIEW', access_version: 1, access_changed: true, manual_changed: true, review_started: true });
  review.review = true; review.manualHash = 'c'.repeat(64);
  assert.equal((await review.repo.list(review.staff)).jobs[0].canResumeProcessing, true);
  assert.equal((await review.resume()).job.state, 'REVIEW');
  const active = fixture({ state: 'RUNNING', access_version: 1, lease_active: true });
  await assert.rejects(active.resume(), { code: 'BATCH_RESUME_STALE' });
});

test('queue projection exposes no resume for superseded, approved or edited machine reports', async () => {
  for (const override of [{ current_approval: true }, { photos_changed: true }, { manual_changed: true },
    { review_started: true }, { code: 'BATCH_HUMAN_WORK_PRESENT' }]) {
    const f = fixture(override); assert.equal((await f.repo.list(f.staff)).jobs[0].canResumeProcessing, false);
  }
});
test('a corrected finished card stays in final review without exposing its obsolete machine score', async () => {
  const f = fixture({ state: 'REVIEW', manual_changed: true,
    evidence: canonical({ name: 'Saved card', proposedGrade: 10, manualContentHash: 'b'.repeat(64), manualRevision: 3 }) });
  const job = (await f.repo.list(f.staff)).jobs[0];
  assert.equal(job.state, 'REVIEW'); assert.equal(job.code, 'BATCH_MANUAL_DRAFT_CHANGED');
  assert.equal(job.evidence.name, 'Saved card'); assert.equal(job.evidence.proposedGrade, undefined);
  assert.equal(job.canResumeProcessing, false); assert.equal(f.updated, 0);
});
