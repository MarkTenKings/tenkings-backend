import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, requireThat } from '@atlas/manual-service/contract';
import { curationFixture } from '../../../frontend/atlas-app/test/staff-comp-curation-fixture.mjs';
import { createStaffCompCurationNativeComposition } from '../../../frontend/atlas-app/lib/server/staff-comp-curation-native-composition.mjs';
import { createCompCurationService } from '../src/comp-curation-service.mjs';
import { createCompCurationArchiveCapability } from '../src/comp-curation-archive.mjs';
import { createPublicationRepository } from '../src/publication-repository.mjs';
import { createPresentationRepository } from '../src/presentation-repository.mjs';

const selectionPolicy = { version: 'atlas-comp-evidence-selection-policy-v1', status: 'LOCAL_PROPOSAL',
  method: 'private-saved-sold-evidence-v1', recencyDays: null, rightsStatus: 'UNRESOLVED' };
async function fixture(acl = 'readers') {
  const f = await curationFixture(), queries = [];
  f.card.owner_id = randomUUID(); f.card[acl] = [f.actorId]; f.principal.actorKind = 'HUMAN';
  let active = true;
  const boundary = { transaction: (staff, work) => f.options.boundary.transaction(staff, context => work({ ...context, tx: {
    ...context.tx, async $queryRawUnsafe(sql, ...args) {
      queries.push(sql);
      if (sql.includes('curation-archive:card') || /^SELECT \* FROM atlas_manual\.card WHERE id=\$1::uuid FOR (SHARE|UPDATE)$/.test(sql)) return [structuredClone(f.card)];
      if (sql.includes('curation-archive:active')) { await f.hooks.active?.(); return active ? [{ id: f.cardId }] : []; }
      if (sql.includes('curation-archive:publication')) { await f.hooks.archivePublication?.(); return [structuredClone(f.row)]; }
      return context.tx.$queryRawUnsafe(sql, ...args);
    },
  } })) };
  const artifacts = { async read(ref, expected, options) {
    if (expected.kind === 'PUBLIC_REPORT') { await f.hooks.archiveArtifact?.(); return f.artifacts.read(ref, expected, options); }
    return f.options.artifacts.read(ref, expected, options);
  } };
  const options = { ...f.options, boundary, artifacts, policy: null, selectionPolicy,
    approved: { loadPacket: () => assert.fail('Shared approval-authority reader must not be called') } };
  const capability = createCompCurationArchiveCapability(options);
  const service = createCompCurationService({ ...options, archiveCapability: capability });
  return { ...f, options, capability, service, queries, setActive(value) { active = value; },
    readInput: { approvalActionId: f.actionId, previewId: f.previewId } };
}

test('explicit private archive capability admits reader/editor reviewers without granting publication or public selection', async () => {
  for (const acl of ['readers', 'editors']) {
    const f = await fixture(acl), before = canonical({ card: f.card, publication: f.row, market: f.market, packet: f.packet });
    assert.deepEqual(Object.keys(f.capability).sort(), ['authorize', 'loadPacket', 'version']);
    const state = await f.service.read(f.staff, f.cardId, f.readInput);
    const input = f.input({ expectedPolicyHash: state.policyHash }), result = await f.service.decide(f.staff, f.cardId, input);
    assert.equal(result.guidance, null); assert.equal(result.actorId, f.actorId); assert.equal(result.selected.length, 3);
    assert.deepEqual(await f.service.decide(f.staff, f.cardId, input), result); assert.equal(f.rows.length, 1);
    assert.equal(canonical({ card: f.card, publication: f.row, market: f.market, packet: f.packet }), before);
    assert(f.queries.filter(q => q.includes('curation-archive:')).every(q => /SELECT/.test(q) && !/INSERT|UPDATE|DELETE/.test(q)));
    const publication = createPublicationRepository({ boundary: f.options.boundary, validateAccess: f.options.validateAccess });
    await assert.rejects(publication.load(f.staff, f.cardId, f.actionId), { code: 'MANUAL_CARD_ACCESS_DENIED' });
    const presentation = createPresentationRepository({ boundary: f.options.boundary, validateAccess: f.options.validateAccess, keyPrefix: 'fixture' });
    await assert.rejects(presentation.marketCommitStatus(f.staff, f.cardId, { requestId: randomUUID(), approvalActionId: f.actionId }), { code: 'MANUAL_CARD_ACCESS_DENIED' });
  }
});

test('default service and forged or differently-bound capabilities cannot acquire archive authority', async () => {
  const f = await fixture();
  const ordinary = createCompCurationService(f.options);
  await assert.rejects(ordinary.read(f.staff, f.cardId, f.readInput), { code: 'MANUAL_CARD_NOT_FOUND' });
  for (const archiveCapability of [true, {}, { ...f.capability }])
    assert.throws(() => createCompCurationService({ ...f.options, archiveCapability }), { code: 'COMP_ARCHIVE_CONFIGURATION_INVALID' });
  assert.throws(() => createCompCurationService({ ...f.options, boundary: { ...f.options.boundary }, archiveCapability: f.capability }), { code: 'COMP_ARCHIVE_CONFIGURATION_INVALID' });
  assert.throws(() => createCompCurationService({ ...f.options, selectionPolicy: null, archiveCapability: f.capability,
    policy: { version: 'atlas-comp-curation-policy-v1', status: 'LOCAL_PROPOSAL', method: 'selected-sold-price-arithmetic-mean-v1', recencyDays: 90, rightsStatus: 'UNRESOLVED' } }),
  { code: 'COMP_CURATION_CONFIGURATION_INVALID' });
  assert.equal(f.rows.length, 0);
});

test('archive capability refuses global reviewers, observers/machines, wrong modes, inactive intake and stale publications', async () => {
  for (const [alter, code] of [[f => { f.card.readers = []; }, 'MANUAL_CARD_NOT_FOUND'],
    [f => { f.principal.role = 'OBSERVER'; }, 'MANUAL_CARD_ACCESS_DENIED'],
    [f => { f.principal.actorKind = 'MACHINE'; }, 'MANUAL_CARD_ACCESS_DENIED'],
    [f => { f.row.mode = 'OTHER'; }, 'COMP_APPROVAL_STALE'],
    [f => f.setActive(false), 'INTAKE_CARD_DELETED'],
    [f => { f.hooks.access = () => requireThat(false, 404, 'INTAKE_CARD_NOT_FOUND'); }, 'INTAKE_CARD_NOT_FOUND'],
    [f => { f.row.state = 'PENDING'; }, 'COMP_APPROVAL_STALE'],
    [f => { f.row.action_id = randomUUID(); }, 'COMP_APPROVAL_STALE']]) {
    const f = await fixture(); alter(f);
    await assert.rejects(f.service.read(f.staff, f.cardId, f.readInput), { code }); assert.equal(f.rows.length, 0);
  }
});

test('archive packet read rechecks access and approval after storage and never accepts corrupt source', async () => {
  for (const [alter, code] of [[f => { f.card.readers = []; }, 'MANUAL_CARD_NOT_FOUND'],
    [f => { f.principal.id = randomUUID(); }, 'MANUAL_CARD_NOT_FOUND'],
    [f => f.setActive(false), 'INTAKE_CARD_DELETED'],
    [f => { f.row.mode = 'OTHER'; }, 'COMP_APPROVAL_STALE'],
    [f => { f.row.action_id = randomUUID(); }, 'COMP_APPROVAL_STALE']]) {
    const f = await fixture(); f.hooks.archiveArtifact = () => alter(f);
    await assert.rejects(f.capability.loadPacket(f.staff, f.cardId, f.actionId), { code }); assert.equal(f.rows.length, 0);
  }
  const f = await fixture(); f.row.manifest_hash = 'a'.repeat(64);
  await assert.rejects(f.capability.loadPacket(f.staff, f.cardId, f.actionId), { code: 'MANUAL_FINISHING_SOURCE_INVALID' });
  const changed = await fixture(); changed.row.result = '{}';
  await assert.rejects(changed.capability.loadPacket(changed.staff, changed.cardId, changed.actionId), { code: 'MANUAL_PUBLICATION_CORRUPT' });
});

test('archive access revoked during evidence or receipt replay cannot insert or disclose the retained decision', async () => {
  const f = await fixture(), state = await f.service.read(f.staff, f.cardId, f.readInput), input = f.input({ expectedPolicyHash: state.policyHash });
  await f.service.decide(f.staff, f.cardId, input);
  const before = canonical(f.rows); f.card.readers = [];
  await assert.rejects(f.service.decide(f.staff, f.cardId, input), { code: 'MANUAL_CARD_NOT_FOUND' }); assert.equal(canonical(f.rows), before);
  const changed = await fixture(); changed.hooks.archiveArtifact = () => { changed.card.readers = []; };
  await assert.rejects(changed.service.decide(changed.staff, changed.cardId, changed.input({ expectedPolicyHash: state.policyHash })), { code: 'MANUAL_CARD_NOT_FOUND' });
  assert.equal(changed.rows.length, 0);
});

test('native archive opt-in is isolated, default-off, and invalidates on replacement', async () => {
  const f = await fixture(), options = { enabled: true, archiveCompAccess: true, environment: {},
    ...Object.fromEntries(['boundary', 'approved', 'artifacts', 'validateAccess', 'selectionPolicy'].map(key => [key, f.options[key]])),
    auth: { async authenticate() { return f.staff; } }, origin: 'http://127.0.0.1:4318', assertRequest() {} };
  const native = createStaffCompCurationNativeComposition(options);
  const request = async () => {
    let status, body;
    await native.handler({ method: 'GET', url: `/api/staff/comp-curation/cards/${f.cardId}?approvalActionId=${f.actionId}&previewId=${f.previewId}`, headers: {}, body: '' },
      { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; } });
    return { status, body };
  };
  const read = await request(); assert.equal(read.status, 200); assert.equal(read.body.result.availability, 'READY');
  assert.equal(native.archiveCompAccess, true); assert.equal(native.policy, null);
  options.archiveCompAccess = false; assert.equal((await request()).status, 503); assert.equal(f.rows.length, 0); native.close();
  assert.throws(() => createStaffCompCurationNativeComposition({ ...options, archiveCompAccess: 'true' }), { code: 'COMP_NOT_CONFIGURED' });
});

