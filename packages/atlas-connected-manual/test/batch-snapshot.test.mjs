import test from 'node:test';
import assert from 'node:assert/strict';
import { createMachineBatchSnapshot } from '../src/batch-snapshot.mjs';
import { createConnectedCardReader } from '../src/card-reader.mjs';
import { createBatchPreparation } from '../src/batch-preparation.mjs';
import { workspace } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';

const SIDES = ['FRONT', 'BACK'], hash = n => String(n).repeat(64), clone = value => structuredClone(value);
const refuse = code => Object.assign(new Error(code), { code });
function fixture({ stage = 'ANALYZE', initialized = true } = {}) {
  const f = { calls: [], stage, initialized, artifacts: 0 };
  const staff = Object.freeze({ actorKind: 'MACHINE' }), human = Object.freeze({ actorKind: 'HUMAN' });
  const principal = { actorKind: 'MACHINE', canCertify: false };
  const check = actor => { if (actor !== staff && actor !== human) throw refuse('MANUAL_MACHINE_AUTH_REQUIRED'); };
  f.card = { ready: true, cardId: 'fixture-card', revision: 8, sourceHash: hash('a'),
    sides: Object.fromEntries(SIDES.map(side => [side, { upload: { uploadId: `upload-${side}` } }])) };
  f.manual = { cardId: f.card.cardId, revision: 3, contentHash: hash('b'), draft: { identityRevision: 1,
    source: { sourceHash: f.card.sourceHash, uploads: { FRONT: 'upload-FRONT', BACK: 'upload-BACK' } },
    geometry: { ref: 'geometry-artifact', sourceHash: hash('c') }, defects: { ref: 'defect-artifact', sourceHash: hash('d') } } };
  f.saved = { revision: 2, details: { fields: { name: 'Fixture Player', category: 'Sports cards', manufacturer: 'Fixture', card_number: '1',
    year: '2026', set_name: 'Fixture set', variant: '', card_type: '' },
    profile: 'SPORTS', cornerShape: 'SQUARE', matColor: 'BLACK', layoutType: null, parallel: '', insert: '', touched: [], sourceHash: f.card.sourceHash } };
  f.identity = { state: 'COMPLETE' };
  f.geometry = Object.fromEntries(SIDES.map(side => [side, { state: 'READY' }]));
  f.state = { defects: clone(workspace(false)), assistance: null, geometry: { sides: Object.fromEntries(SIDES.map(side => [side,
    { physical: { quad: [] }, printed: { quad: [] }, prepared: { id: side } }])) } };
  f.intakeRepository = { async read(actor, cardId, options) {
    check(actor); assert.equal(cardId, f.card.cardId); assert.deepEqual(options, { edit: true });
    f.calls.push('pair'); await f.onPair?.(f.calls.filter(x => x === 'pair').length);
    return { card: clone(f.card), principal: actor === human ? { actorKind: 'HUMAN', canCertify: true } : clone(principal) };
  } };
  f.workflow = { service: { async read(actor) { check(actor); f.calls.push('manual'); await f.onManual?.();
    if (!f.initialized) throw refuse('MANUAL_CARD_NOT_FOUND'); return clone(f.manual); } },
    async hydrate(card) { f.calls.push('hydrate'); assert.deepEqual(card, f.manual); return clone(f.state); } };
  f.details = { async read(actor) { check(actor); f.calls.push('details'); await f.onDetails?.(); return clone(f.saved); } };
  f.identification = { async status(actor) { check(actor); f.calls.push('identity'); await f.onIdentity?.(); return clone(f.identity); } };
  f.earlyGeometry = { async ensure(actor) { check(actor); f.calls.push('ensure'); return { earlyGeometry: clone(f.geometry) }; },
    async status(actor) { check(actor); f.calls.push('geometry-status'); return clone(f.geometry); } };
  const intake = { async read(actor) { check(actor); f.calls.push('pair'); return { card: clone(f.card) }; } };
  f.snapshot = createMachineBatchSnapshot(f);
  f.humanOpen = createConnectedCardReader({ intake, details: f.details, workflow: f.workflow,
    identification: f.identification, earlyGeometry: f.earlyGeometry });
  f.job = { cardId: f.card.cardId, sourceHash: f.card.sourceHash, uploads: clone(f.manual.draft.source.uploads),
    stage, analysisActionId: 'same-exact-action', evidence: { manualRevision: f.manual.revision, manualContentHash: f.manual.contentHash } };
  f.connected = { machineBatchSnapshot: f.snapshot, open: async () => assert.fail('machine batch cannot open the UI projection'),
    workflow: f.workflow, details: f.details, identification: f.identification, earlyGeometry: f.earlyGeometry,
    assistance: { async status(_actor, _card, actionId) { f.calls.push('analysis-status'); assert.equal(actionId, f.job.analysisActionId);
      return { state: 'READY', astra: { status: 'READY', analysisId: actionId } }; } },
    async initialize(_actor, _card, input) { f.calls.push('initialize'); assert.deepEqual(input, { sourceHash: f.job.sourceHash, detailsRevision: f.saved.revision });
      f.initialized = true; return { card: clone(f.manual) }; } };
  f.staff = staff; f.human = human; f.principal = principal;
  f.prepare = options => createBatchPreparation({ connected: f.connected,
    artifacts: { async write() { f.calls.push('report-write'); f.artifacts++; return 'report-ref'; } }, ...options });
  return f;
}

test('snapshot construction is cold and adds no reads', () => {
  const unavailable = new Proxy({}, { get() { assert.fail('construction must not touch a repository'); } });
  assert.equal(typeof createMachineBatchSnapshot({ intakeRepository: unavailable, workflow: unavailable,
    details: unavailable, identification: unavailable }), 'function');
});

for (const stage of ['ANALYZE', 'REPORT', 'PREPARE']) test(`${stage} with a manual card loads only pair/manual/pair`, async () => {
  const f = fixture({ stage }); const result = await f.snapshot(f.staff, f.job);
  assert.deepEqual(f.calls, ['pair', 'manual', 'pair']);
  assert.deepEqual(result.card, f.card); assert.deepEqual(result.manualCard, f.manual);
  assert.equal(result.identification, null); assert.equal(result.details, undefined);
});

test('uninitialized PREPARE preserves consumed identity/detail/manual facts of human open and omits geometry projection', async () => {
  const f = fixture({ stage: 'PREPARE', initialized: false });
  const original = await f.humanOpen(f.human, f.job.cardId, { includePreviews: false }); f.calls = [];
  const compact = await f.snapshot(f.staff, f.job);
  for (const key of ['card', 'manual', 'revision', 'details', 'identification']) assert.deepEqual(compact[key], original[key]);
  assert.deepEqual(f.calls, ['pair', 'manual', 'details', 'identity', 'pair']);
  assert.equal(compact.earlyGeometry, undefined);
});

test('final pair-only fence does exactly one authorized intake read', async () => {
  const f = fixture({ stage: 'REPORT' });
  assert.deepEqual(await f.snapshot(f.staff, f.job, { pairOnly: true }), { card: f.card });
  assert.deepEqual(f.calls, ['pair']);
});

for (const [label, alter, code] of [
  ['forged machine handle', f => { f.staff = { ...f.staff }; }, 'MANUAL_MACHINE_AUTH_REQUIRED'],
  ['real human principal', f => { f.staff = f.human; }, 'MANUAL_MACHINE_AUTH_REQUIRED'],
  ['certifying machine principal', f => { f.principal.canCertify = true; }, 'MANUAL_MACHINE_AUTH_REQUIRED'],
  ['not ready pair', f => { f.card.ready = false; }, 'BATCH_PHOTOS_CHANGED'],
  ['different selected upload', f => { f.card.sides.BACK.upload.uploadId = 'new-upload'; }, 'BATCH_PHOTOS_CHANGED'],
  ['different pair source', f => { f.card.sourceHash = hash('e'); }, 'BATCH_PHOTOS_CHANGED'],
  ['manual from old pair', f => { f.manual.draft.source.sourceHash = hash('e'); }, 'BATCH_PHOTOS_CHANGED'],
  ['manual upload mismatch', f => { f.manual.draft.source.uploads.FRONT = 'old-upload'; }, 'BATCH_PHOTOS_CHANGED'],
  ['manual revision changed', f => { f.manual.revision++; }, 'BATCH_MANUAL_DRAFT_CHANGED'],
  ['manual content changed', f => { f.manual.contentHash = hash('e'); }, 'BATCH_MANUAL_DRAFT_CHANGED'],
  ['manual missing after PREPARE', f => { f.initialized = false; }, 'MANUAL_CARD_NOT_FOUND'],
  ['revocation on final read', f => { f.onPair = n => { if (n === 2) throw refuse('MANUAL_MACHINE_ACCESS_REVOKED'); }; }, 'MANUAL_MACHINE_ACCESS_REVOKED'],
  ['deletion on final read', f => { f.onPair = n => { if (n === 2) throw refuse('INTAKE_CARD_DELETED'); }; }, 'INTAKE_CARD_DELETED'],
]) test(`snapshot refuses ${label}`, async () => {
  const f = fixture(); alter(f); await assert.rejects(f.snapshot(f.staff, f.job), { code });
  assert(!f.calls.includes('hydrate')); assert(!f.calls.includes('geometry-status'));
});

for (const [label, change, code] of [
  ['pair revision', f => { f.card.revision++; }, 'MANUAL_PHOTOS_CHANGED'],
  ['source', f => { f.card.sourceHash = hash('f'); }, 'BATCH_PHOTOS_CHANGED'],
  ['upload selection', f => { f.card.sides.FRONT.upload.uploadId = 'replaced'; }, 'BATCH_PHOTOS_CHANGED'],
]) test(`snapshot fences ${label} changed across the manual read`, async () => {
  const f = fixture(); f.onManual = () => change(f);
  await assert.rejects(f.snapshot(f.staff, f.job), { code });
});

test('PREPARE preserves the source fence across identification/details reads', async () => {
  const f = fixture({ stage: 'PREPARE', initialized: false }); f.onIdentity = () => { f.card.revision++; };
  await assert.rejects(f.snapshot(f.staff, f.job), { code: 'MANUAL_PHOTOS_CHANGED' });
});

test('ANALYZE reuses the authenticated manual snapshot but still hydrates and reconciles exact saved results', async () => {
  const f = fixture();
  assert.deepEqual(await f.prepare().run(f.staff, f.job), { kind: 'CONTINUE', evidence: { analysisId: f.job.analysisActionId } });
  assert.deepEqual(f.calls, ['pair', 'manual', 'pair', 'hydrate', 'analysis-status']);
});

test('PREPARE reuses ensure geometry status while preserving initialization and artifact quality validation', async () => {
  const f = fixture({ stage: 'PREPARE', initialized: false });
  assert.deepEqual(await f.prepare().run(f.staff, f.job), { kind: 'CONTINUE', evidence: clone(f.job.evidence) });
  assert.deepEqual(f.calls, ['pair', 'manual', 'details', 'identity', 'pair', 'ensure', 'initialize', 'manual', 'hydrate', 'pair']);
});

for (const geometryState of ['RUNNING', 'FAILED', 'NEEDS_REVIEW']) test(`ensure ${geometryState} retains machine geometry gate`, async () => {
  const f = fixture({ stage: 'PREPARE', initialized: false }); f.geometry.FRONT.state = geometryState;
  const result = await f.prepare().run(f.staff, f.job);
  assert.equal(result.kind, geometryState === 'RUNNING' ? 'WAIT' : 'ATTENTION');
  if (geometryState !== 'RUNNING') assert.equal(result.code, 'BATCH_GEOMETRY_NEEDS_REVIEW');
  assert(f.calls.includes('ensure'));
  assert(!f.calls.includes('initialize')); assert(!f.calls.includes('geometry-status')); assert(!f.calls.includes('hydrate'));
});

for (const [label, change, code] of [
  ['unprepared geometry', f => { f.state.geometry.sides.FRONT.prepared = null; }, 'BATCH_GEOMETRY_NEEDS_REVIEW'],
  ['human inspection', f => { f.state.defects.sides.FRONT.inspection = {}; }, 'BATCH_HUMAN_WORK_PRESENT'],
]) test(`compact PREPARE keeps ${label} hydration gate`, async () => {
  const f = fixture({ stage: 'PREPARE' }); change(f);
  assert.equal((await f.prepare().run(f.staff, f.job)).code, code);
  assert(f.calls.includes('hydrate'));
});

test('REPORT retains hydration, post-measurement source/manual fences and report write', async () => {
  const f = fixture({ stage: 'REPORT' });
  const result = await f.prepare({ async reportBuilder({ card, state, analysis }) {
    f.calls.push('report'); assert.deepEqual(card, f.manual); assert.deepEqual(state, f.state);
    assert.equal(analysis.analysisId, f.job.analysisActionId);
    return { proposedGrade: 9, findings: [], identity: { playerName: 'Fixture' }, limitations: [], analysisId: analysis.analysisId };
  } }).run(f.staff, f.job);
  assert.equal(result.kind, 'REVIEW');
  assert.deepEqual(f.calls, ['pair', 'manual', 'pair', 'hydrate', 'analysis-status', 'report', 'pair', 'manual', 'report-write']);
});

for (const [label, change, code] of [
  ['source changed during report', f => { f.card.sourceHash = hash('e'); }, 'BATCH_PHOTOS_CHANGED'],
  ['manual changed during report', f => { f.manual.revision++; }, 'BATCH_MANUAL_DRAFT_CHANGED'],
]) test(`${label} prevents report write`, async () => {
  const f = fixture({ stage: 'REPORT' });
  await assert.rejects(f.prepare({ async reportBuilder() { change(f); return {}; } }).run(f.staff, f.job), { code });
  assert.equal(f.artifacts, 0);
});

test('human batch caller retains ordinary connected.open behavior', async () => {
  const f = fixture(); f.connected.open = f.humanOpen;
  f.connected.machineBatchSnapshot = () => assert.fail('human caller cannot use machine snapshot');
  const result = await f.prepare().run(f.human, f.job);
  assert.equal(result.kind, 'CONTINUE'); assert(f.calls.includes('details')); assert(f.calls.includes('identity'));
  assert(f.calls.includes('geometry-status'));
});

for (const stage of ['PREPARE', 'ANALYZE', 'REPORT']) test(`${stage} artifact validation failure remains fatal before further effects`, async () => {
  const f = fixture({ stage });
  f.workflow.hydrate = async () => { f.calls.push('hydrate'); throw refuse('MANUAL_ARTIFACT_UNVERIFIED'); };
  await assert.rejects(f.prepare({ reportBuilder() { assert.fail('unverified artifacts cannot reach report construction'); } })
    .run(f.staff, f.job), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
  assert(f.calls.includes('hydrate')); assert(!f.calls.includes('analysis-status')); assert.equal(f.artifacts, 0);
});
