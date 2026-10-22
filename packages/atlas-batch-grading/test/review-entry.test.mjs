import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@atlas/manual-service/contract';
import { BATCH_POLICY, batchAnalysisActionId } from '../src/index.mjs';
import { createBatchRepository } from '../src/repository.mjs';

function fixture() {
  const staff = { id: '10000000-0000-4000-8000-000000000001', role: 'REVIEWER', accessVersion: 4 };
  const cardId = '20000000-0000-4000-8000-000000000002', sourceHash = 'a'.repeat(64), contentHash = 'b'.repeat(64);
  const uploads = { FRONT: 'front', BACK: 'back' }, key = digest(canonical([BATCH_POLICY, cardId, sourceHash]));
  const input = canonical({ policy: BATCH_POLICY, cardId, sourceHash, label: 'Synthetic card', uploads });
  const f = { staff, calls: [], accessCalls: 0, missing: false, denied: null,
    card: { cardId, revision: 1, contentHash, draft: { source: { sourceHash, uploads } } },
    intake: { ready: true, sourceHash, sides: Object.fromEntries(Object.entries(uploads).map(([side, uploadId]) => [side, { upload: { uploadId } }])) },
    row: { key, card_id: cardId, source_hash: sourceHash, actor_id: staff.id, access_version: 4,
      input, input_hash: digest(input), analysis_action_id: batchAnalysisActionId(key), state: 'REVIEW', stage: 'REPORT', revision: 4,
      evidence: canonical({ authority: 'MACHINE_PROPOSAL', reportHash: 'c'.repeat(64), manualRevision: 1, manualContentHash: contentHash }),
      current_manual_revision: 1, current_manual_hash: contentHash, final_review_started: false, current_approval: false,
      created_at: new Date('2026-10-21T00:00:00Z'), updated_at: new Date('2026-10-21T01:00:00Z') } };
  const tx = { async $queryRawUnsafe(sql, ...args) {
    assert.match(sql, /^SELECT j\./); assert.match(sql, /j\.key=\$1 AND j\.card_id=\$2::uuid AND j\.actor_id=\$3::uuid/);
    assert.match(sql, /m\.owner_id=\$3::uuid OR \$3::uuid=ANY\(m\.editors\)/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|LIMIT)\b/); f.calls.push({ sql, args });
    return f.missing || f.row.key !== args[0] || f.row.card_id !== args[1] || f.row.actor_id !== args[2] ? [] : [f.row];
  } };
  f.repo = createBatchRepository({ boundary: { transaction: (actor, work) => {
    assert.equal(actor, staff); if (f.denied) throw f.denied; return work({ tx, principal: staff });
  } }, intakeRepository: { authorizeInTransaction: async (_tx, principal, id, options) => {
    f.accessCalls++; assert.equal(principal, staff); assert.equal(id, cardId); assert.equal(options.edit, true);
    if (f.accessDenied) throw f.accessDenied; return f.intake;
  } } });
  f.read = () => f.repo.reviewEntry(staff, f.card);
  return f;
}

test('workspace lookup is one exact current-card/source/owner read, not the capped queue', async () => {
  const f = fixture(), before = structuredClone(f.row);
  assert.deepEqual(await f.read(), { key: f.row.key, cardId: f.card.cardId, state: 'REVIEW', sourceHash: f.intake.sourceHash,
    manualRevision: 1, manualContentHash: f.card.contentHash });
  assert.equal(f.calls.length, 1); assert.equal(f.accessCalls, 1); assert.deepEqual(f.row, before);
});

test('no context is invented for absent/foreign jobs, processing work, adopted drafts or current approvals', async () => {
  for (const change of [f => { f.missing = true; }, f => { f.row.actor_id = '30000000-0000-4000-8000-000000000003'; },
    f => { f.row.state = 'RUNNING'; }, f => { f.card.draft.finalReview = {}; }, f => { f.row.final_review_started = true; },
    f => { f.row.current_approval = true; f.row.access_version--; }, f => { delete f.card.draft.source; },
    f => { f.staff.role = 'READER'; }, f => { f.staff.actorKind = 'MACHINE'; }]) {
    const f = fixture(); change(f); assert.equal(await f.read(), null); assert.equal(f.accessCalls, 0);
  }
});

test('geometry-confirmed revision two and concurrent newer drafts cannot adopt revision-one machine findings', async () => {
  const confirmed = fixture(); confirmed.card.revision = confirmed.row.current_manual_revision = 2;
  confirmed.card.contentHash = confirmed.row.current_manual_hash = 'd'.repeat(64);
  assert.equal(await confirmed.read(), null); assert.equal(confirmed.accessCalls, 0);
  for (const change of [f => { f.row.current_manual_revision++; }, f => { f.row.current_manual_hash = 'e'.repeat(64); }]) {
    const f = fixture(); change(f); assert.equal(await f.read(), null); assert.equal(f.accessCalls, 0);
  }
});

test('fresh eligible context still requires live access, selected uploads and original admission authority', async () => {
  for (const [change, code] of [[f => { f.denied = { status: 401, code: 'SIGN_IN_REQUIRED' }; }, 'SIGN_IN_REQUIRED'],
    [f => { f.accessDenied = { status: 410, code: 'INTAKE_CARD_DELETED' }; }, 'INTAKE_CARD_DELETED'],
    [f => { f.row.access_version--; }, 'BATCH_ACCESS_CHANGED'],
    [f => { f.intake.sourceHash = 'd'.repeat(64); }, 'BATCH_PHOTOS_CHANGED'],
    [f => { f.intake.sides.FRONT.upload.uploadId = 'replacement'; }, 'BATCH_PHOTOS_CHANGED']]) {
    const f = fixture(); change(f); await assert.rejects(f.read(), { code });
  }
});

test('corrupt or non-machine report evidence is not an adoption hint', async () => {
  for (const change of [f => { f.row.input_hash = 'f'.repeat(64); }, f => {
    f.row.evidence = canonical({ ...JSON.parse(f.row.evidence), authority: 'HUMAN' });
  }, f => { f.row.evidence = canonical({ ...JSON.parse(f.row.evidence), reportHash: null }); }]) {
    const f = fixture(); change(f); await assert.rejects(f.read());
  }
});
