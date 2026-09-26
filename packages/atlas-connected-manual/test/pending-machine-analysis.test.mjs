import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefectAssistance } from '../src/defect-assistance.mjs';
import { createBatchPreparation } from '../src/batch-preparation.mjs';
import { createMachineStaffBoundary } from '../../atlas-manual-service/src/machine-auth.mjs';
import { createIntakeRepository } from '../../atlas-manual-intake/src/repository.mjs';
import { canonical, digest } from '../../atlas-manual-service/src/contract.mjs';
import { inputFixture, artifactRef, id, hash } from '../../atlas-defect-analysis/test/fixtures.mjs';

const SIDES = ['FRONT', 'BACK'];
const failEffect = () => assert.fail('pending status must not hydrate, read artifacts, dispatch, or mutate');

// Real machine authority, intake/current-pair checks, manual ACL/content checks,
// analysis receipt parser and batch path. Only SQL transport and forbidden
// external effects are fixtures; this is not a PostgreSQL lock/load benchmark.
async function fixture() {
  const f = { sql: [], transactions: 0, authReads: 0, receiptReads: 0, enabled: true, accessVersion: 7,
    unsafe: false, deleted: false, receipts: [], retired: null, runs: [], providerCalls: 0 };
  const ownerId = id(3), cardId = id(1), analysisId = id(10);
  f.intake = { id: cardId, owner_id: ownerId, create_request_id: id(4), pair_id: id(5), label: 'Synthetic card',
    revision: 9, front_upload_id: id(6), back_upload_id: id(7), front_version: 1, back_version: 1, created_at: new Date() };
  f.uploads = SIDES.map((side, i) => {
    const uploadId = id(6 + i), plan = canonical({ schemaVersion: 1, uploadId,
      binding: { cardId, pairId: f.intake.pair_id, side, version: 1 }, object: { key: `intake/${uploadId}`, versionId: null },
      expected: { sha256: hash(side), byteCount: 128 } });
    const verification = canonical({ object: { key: `intake/${uploadId}`, versionId: `verified-${side}` },
      sha256: hash(side), byteCount: 128, contentType: 'application/octet-stream' });
    const source = canonical({ ref: artifactRef(cardId, 'PHOTO_SOURCE', hash(side)), photoSourceHash: hash(`source-${side}`) });
    return { id: uploadId, card_id: cardId, request_id: id(20 + i), side, version: 1,
      plan, plan_hash: digest(plan), verification, verification_hash: digest(verification), source, source_hash: digest(source) };
  });
  const tx = {
    async $executeRawUnsafe(sql) {
      f.sql.push(sql);
      assert.match(sql, /^SET (LOCAL (lock_timeout|statement_timeout)|CONSTRAINTS ALL IMMEDIATE)/,
        'this path permits transaction guards only, never a data mutation');
      return 1;
    },
    async $queryRawUnsafe(sql, ...args) {
      f.sql.push(sql);
      if (sql.includes('FROM pg_roles')) return [{ unsafe: f.unsafe }];
      if (sql.includes('authenticate_machine')) {
        f.authReads++; await f.beforeAuth?.(f.authReads);
        return f.enabled && args[0] === ownerId && args[1] === f.accessVersion
          ? [{ id: ownerId, name: 'Synthetic owner', role: 'REVIEWER', access_version: f.accessVersion, now_at: new Date() }] : [];
      }
      if (sql.includes('FROM atlas_manual.card')) { await f.beforeManualRead?.(); return f.manual ? [structuredClone(f.manual)] : []; }
      if (sql.includes('FROM atlas_manual_intake.card')) return args[0] === cardId ? [structuredClone(f.intake)] : [];
      if (sql.includes('FROM atlas_manual_intake.discarded_card')) return f.deleted ? [{ '?column?': 1 }] : [];
      if (sql.includes('FROM atlas_manual_intake.upload')) {
        await f.beforePairRead?.(); return structuredClone(f.uploads.filter(row => args[1].includes(row.id)));
      }
      if (sql.includes('FROM atlas_defect_analysis.request_refusal')) return f.retired ? [structuredClone(f.retired)] : [];
      if (sql.includes('FROM atlas_defect_analysis.run')) return structuredClone(f.runs.filter(row => row.card_id === args[0] && row.id === args[1]));
      if (sql.includes('FROM atlas_defect_analysis.receipt')) {
        f.receiptReads++; await f.beforeReceiptRead?.(f.receiptReads); return structuredClone(f.receipts);
      }
      if (sql.includes('FROM atlas_defect_analysis.provider_event')) return f.accepted ? [structuredClone(f.accepted)] : [];
      assert.fail(`unexpected SQL: ${sql}`);
    },
  };
  f.boundary = createMachineStaffBoundary({ auth: { config: { mode: 'TEST', origin: 'https://fixture.invalid',
    deploymentId: 'fixture-deployment', releaseSha: 'fixture-release', configHash: 'fixture-config', phoneByHash: new Map() } },
    manualClient: { async $transaction(work) { f.transactions++; return work(tx); } },
    boundary: { transaction: failEffect } });
  f.staff = f.boundary.machineOwner({ ownerId, accessVersion: 7 });
  const intakeRepository = createIntakeRepository({ boundary: f.boundary, keyPrefix: 'intake', maxOriginalBytes: 1000 });
  const pair = await intakeRepository.authorizeInTransaction(tx, { id: ownerId, role: 'REVIEWER' }, cardId);
  const draft = { source: { sourceHash: pair.sourceHash }, identityRevision: 1 };
  const content = canonical(draft);
  f.manual = { id: cardId, owner_id: ownerId, editors: [], approvers: [], readers: [], revision: 3, content, content_hash: digest(content) };
  const bindingValue = inputFixture().binding;
  Object.assign(bindingValue, { sourceHash: pair.sourceHash, manualContentHash: f.manual.content_hash });
  const binding = canonical(bindingValue), evidence = canonical({ version: 'atlas-astra-defect-analysis-v2', providerBindingHash: hash('provider') });
  f.run = { id: analysisId, card_id: cardId, action_id: analysisId, actor_id: ownerId, binding, binding_hash: digest(binding),
    base_hash: hash('base'), request_hash: hash('request'), request_ref: JSON.stringify(artifactRef(cardId, 'DEFECT_REQUEST', hash('source'))),
    request_evidence: evidence, evidence_hash: digest(evidence), state: 'DISPATCHED', created_at: new Date(Date.now() - 240000),
    expires_at: new Date(Date.now() - 60000), dispatched_at: new Date(Date.now() - 230000) };
  f.runs = [f.run];
  f.acceptance = { responseId: 'resp_pending_fixture', providerRequestId: 'req_fixture', httpStatus: 200,
    providerStatus: 'in_progress', model: 'gpt-6-astra', responseHash: hash('response'),
    receivedAt: new Date(Date.now() - 230000).toISOString(), pollUntil: new Date(Date.now() + 300000).toISOString() };
  f.saveAcceptance = () => { const value = canonical(f.acceptance); f.accepted = { analysis_id: analysisId, kind: 'ACCEPTED',
    request_hash: f.run.request_hash, provider_binding_hash: hash('provider'), response_id: f.acceptance.responseId,
    evidence: value, evidence_hash: digest(value) }; };
  f.saveAcceptance();
  f.reply = (state = 'READY', kind = 'RESPONSE') => {
    const value = { state, responseRef: state === 'READY' ? artifactRef(cardId, 'DEFECT_RESPONSE', hash('source')) : null,
      resultRef: state === 'READY' ? artifactRef(cardId, 'DEFECT_RESULT', hash('source')) : null,
      responseHash: state === 'READY' ? hash('response') : null, providerRequestId: null,
      responseId: state === 'READY' ? f.acceptance.responseId : null, httpStatus: state === 'READY' ? 200 : state === 'REFUSED' ? 429 : null,
      usage: null, code: state === 'READY' ? null : state === 'REFUSED' ? 'DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR' : 'DEFECT_ANALYSIS_OUTCOME_UNKNOWN' };
    f.receipts.push({ kind, evidence: canonical(value), recorded_at: new Date() });
  };
  f.assistance = createDefectAssistance({ boundary: f.boundary, intakeRepository,
    workflow: { service: { read: failEffect }, hydrate: failEffect },
    artifacts: { read: failEffect, write: failEffect }, imageEffects: {}, memoryEnabled: true,
    provider: { bindingHash: hash('provider'), dispatch() { f.providerCalls++; failEffect(); } },
    receiptClient: { $queryRawUnsafe: failEffect } });
  f.job = { cardId, sourceHash: pair.sourceHash, uploads: { FRONT: id(6), BACK: id(7) }, stage: 'ANALYZE', analysisActionId: analysisId,
    evidence: { manualRevision: f.manual.revision, manualContentHash: f.manual.content_hash } };
  f.pending = () => f.assistance.pendingMachineAnalysis(f.staff, f.job);
  f.sql = [];
  return f;
}

test('exact accepted action waits with one fresh machine transaction, no artifacts or provider, despite admission expiry', async () => {
  const f = await fixture();
  const connected = { assistance: f.assistance, open: failEffect, workflow: { hydrate: failEffect } };
  assert.deepEqual(await createBatchPreparation({ connected }).run(f.staff, f.job), { kind: 'WAIT', retryAfterMs: 3000 });
  assert.equal(f.transactions, 1); assert.equal(f.authReads, 2); assert.equal(f.providerCalls, 0);
  assert.equal(f.receiptReads, 2);
  const manualLock = f.sql.findIndex(sql => sql.includes('atlas_manual.card') && sql.includes('FOR UPDATE'));
  const intakeLock = f.sql.findIndex(sql => sql.includes('atlas_manual_intake.card') && sql.includes('FOR SHARE'));
  assert(manualLock >= 0 && intakeLock > manualLock, 'preserve manual-before-intake lock order');
});

test('20 pending jobs use one transaction each; a new boundary reads the retained accepted action', async () => {
  const fixtures = await Promise.all(Array.from({ length: 20 }, () => fixture()));
  assert.deepEqual(await Promise.all(fixtures.map(f => f.pending())), Array(20).fill(true));
  assert.equal(fixtures.reduce((n, f) => n + f.transactions, 0), 20);
  assert.equal(fixtures.reduce((n, f) => n + f.providerCalls, 0), 0);
  const restarted = await fixture();
  restarted.runs = structuredClone(fixtures[0].runs); restarted.run = restarted.runs[0];
  restarted.accepted = structuredClone(fixtures[0].accepted); restarted.manual = structuredClone(fixtures[0].manual);
  assert.equal(await restarted.pending(), true);
  assert.equal(restarted.run.action_id, fixtures[0].job.analysisActionId);
});

for (const [label, mutate, code] of [
  ['cloned machine handle', f => { f.staff = { ...f.staff }; }, 'MANUAL_MACHINE_AUTH_REQUIRED'],
  ['human actor', f => { f.staff = { id: f.staff.id }; }, 'MANUAL_MACHINE_AUTH_REQUIRED'],
  ['owner revocation', f => { f.accessVersion++; }, 'MANUAL_MACHINE_ACCESS_REVOKED'],
  ['disabled deployment', f => { f.enabled = false; }, 'MANUAL_MACHINE_ACCESS_REVOKED'],
  ['revocation before transaction return', f => { f.beforeAuth = n => { if (n === 2) f.enabled = false; }; }, 'MANUAL_MACHINE_ACCESS_REVOKED'],
  ['unsafe DB role', f => { f.unsafe = true; }, 'MANUAL_DATABASE_ROLE_INVALID'],
  ['deleted intake', f => { f.deleted = true; }, 'INTAKE_CARD_DELETED'],
  ['manual ACL removed', f => { f.manual.owner_id = id(90); }, 'MANUAL_CARD_NOT_FOUND'],
  ['manual revision changed', f => { f.manual.revision++; }, 'BATCH_MANUAL_DRAFT_CHANGED'],
  ['manual content changed', f => { f.manual.content = canonical({ source: { sourceHash: f.job.sourceHash }, identityRevision: 2 });
    f.manual.content_hash = digest(f.manual.content); }, 'BATCH_MANUAL_DRAFT_CHANGED'],
  ['manual content corrupted', f => { f.manual.content += ' '; }, 'MANUAL_STORED_CONTENT_INVALID'],
  ['wrong job upload ID', f => { f.job.uploads.FRONT = id(80); }, 'BATCH_PHOTOS_CHANGED'],
  ['wrong job source', f => { f.job.sourceHash = hash('other'); }, 'BATCH_PHOTOS_CHANGED'],
  ['selected upload replaced', f => { f.intake.front_upload_id = id(80); f.intake.front_version = 0; }, 'BATCH_PHOTOS_CHANGED'],
  ['foreign run actor', f => { f.run.actor_id = id(80); }, 'DEFECT_ANALYSIS_STALE'],
  ['different run action', f => { f.run.action_id = id(80); }, 'DEFECT_ANALYSIS_STALE'],
  ['stale identity binding', f => { const binding = JSON.parse(f.run.binding); binding.identityRevision++;
    f.run.binding = canonical(binding); f.run.binding_hash = digest(f.run.binding); }, 'DEFECT_ANALYSIS_STALE'],
  ['stale run manual revision', f => { const binding = JSON.parse(f.run.binding); binding.manualRevision++;
    f.run.binding = canonical(binding); f.run.binding_hash = digest(f.run.binding); }, 'DEFECT_ANALYSIS_STALE'],
  ['corrupt run binding', f => { f.run.binding_hash = hash('wrong'); }, 'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID'],
  ['corrupt acceptance', f => { f.accepted.evidence_hash = hash('wrong'); }, 'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID'],
  ['acceptance for different request', f => { f.accepted.request_hash = hash('wrong'); }, 'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID'],
]) test(`pending path refuses ${label}`, async () => {
  const f = await fixture(); mutate(f); await assert.rejects(f.pending(), { code }); assert.equal(f.providerCalls, 0);
});

for (const [label, mutate] of [
  ['missing exact action', f => { f.runs = []; }],
  ['different card', f => { f.job.cardId = id(90); }],
  ['PREPARED', f => { f.run.state = 'PREPARED'; f.accepted = null; }],
  ['unaccepted DISPATCHED', f => { f.accepted = null; }],
  ['expired accepted collection', f => { f.acceptance.pollUntil = new Date(Date.now() - 1000).toISOString(); f.saveAcceptance(); }],
  ['READY response after lost socket reply', f => f.reply()],
  ['definite 429 refusal', f => { f.accepted = null; f.reply('REFUSED'); }],
  ['unknown outcome without custody', f => { f.accepted = null; f.reply('UNKNOWN', 'OUTCOME'); }],
  ['accepted action with an outcome', f => f.reply('UNKNOWN', 'OUTCOME')],
  ['retired action', f => { f.retired = { analysis_id: f.run.id, card_id: f.run.card_id, action_id: f.run.action_id,
    actor_id: f.run.actor_id, base_hash: f.run.base_hash, code: 'DEFECT_ANALYSIS_STALE', created_at: new Date() }; }],
]) test(`${label} never uses the pending shortcut`, async () => {
  const f = await fixture(); mutate(f);
  if (label === 'different card') await assert.rejects(f.pending());
  else assert.equal(await f.pending(), false);
  assert.equal(f.providerCalls, 0);
});

test('terminal receipt arriving during source validation falls through and advances the same action without POST', async () => {
  const f = await fixture(); let opened = 0, hydrated = 0, statusRead = 0;
  f.beforePairRead = () => { if (!f.receipts.length) f.reply(); };
  const connected = {
    async open() { opened++; return { card: { ready: true, sourceHash: f.job.sourceHash,
      sides: Object.fromEntries(SIDES.map(side => [side, { upload: { uploadId: f.job.uploads[side] } }])) } }; },
    workflow: { service: { async read() { return { revision: f.manual.revision, contentHash: f.manual.content_hash }; } },
      async hydrate() { hydrated++; return {}; } },
    assistance: { pendingMachineAnalysis: f.assistance.pendingMachineAnalysis,
      async status(staff, cardId, analysisId) { statusRead++; assert.equal(analysisId, f.job.analysisActionId);
        const run = await f.assistance.repository.status(staff, { cardId, analysisId });
        return { state: run.state, astra: { status: run.state, analysisId: run.analysisId } }; },
      analyzeMachine: failEffect },
  };
  const result = await createBatchPreparation({ connected }).run(f.staff, f.job);
  assert.deepEqual(result, { kind: 'CONTINUE', evidence: { analysisId: f.job.analysisActionId } });
  assert.equal(opened, 1); assert.equal(hydrated, 1); assert.equal(statusRead, 1); assert.equal(f.providerCalls, 0);
  assert.equal(f.receiptReads, 3);
});

test('terminal receipt after the final snapshot is adopted on next poll, never resent', async () => {
  const f = await fixture(); assert.equal(await f.pending(), true); f.reply();
  assert.equal(await f.pending(), false); assert.equal(f.providerCalls, 0);
});

test('changed manual and photo records are revalidated before WAIT', async () => {
  const manual = await fixture(); manual.beforeReceiptRead = n => { if (n === 1) manual.manual.revision++; };
  await assert.rejects(manual.pending(), { code: 'BATCH_MANUAL_DRAFT_CHANGED' });
  const photo = await fixture(); photo.beforeReceiptRead = n => { if (n === 1) { photo.intake.front_upload_id = id(99); photo.intake.front_version = 0; } };
  await assert.rejects(photo.pending(), { code: 'BATCH_PHOTOS_CHANGED' });
});

test('stopping during pending validation cannot convert cancellation into a completed wait', async () => {
  const f = await fixture(), controller = new AbortController();
  f.beforePairRead = () => controller.abort();
  await assert.rejects(createBatchPreparation({ connected: { assistance: f.assistance, open: failEffect } })
    .run(f.staff, f.job, { signal: controller.signal }), { code: 'BATCH_INTERRUPTED' });
});
