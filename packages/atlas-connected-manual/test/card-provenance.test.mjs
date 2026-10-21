import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cardProvenanceInput, cardProvenanceQuery, OWNERSHIP_VERIFICATION } from '../src/card-provenance-contract.mjs';
import { createCardProvenanceService, projectCardProvenance, publicCardProvenance, cardProvenanceGrantSQL, validateCardProvenanceConfiguration } from '../src/card-provenance-service.mjs';

const hash = 'a'.repeat(64), approvedAt = '2026-10-20T12:00:00.123456Z', publishedAt = '2026-10-20T13:00:00.123456Z', snapshot = '2026-10-20T14:00:00.123456Z';
function fixture() {
  const cardId = randomUUID(), approvalActionId = randomUUID(), staff = {}, calls = [], actors = new WeakMap([[staff, { sessionHash: 'original-session', browserHash: 'original-browser' }]]);
  const card = { cardId, certificateNumber: 'ATLAS-ABCDEF012345', approvalActionId, approvedAt, identity: { playerName: 'Synthetic player', privateNotes: 'PRIVATE' }, finalGrade: 9.5,
    report: { state: 'PUBLISHED', version: 2, publicToken: `ar_${'A'.repeat(24)}`, reportHash: hash }, mediaEvidence: { publicHash: hash, sourceHash: hash, sourceRevision: 4 } };
  const approval = { eventId: `approval:${approvalActionId}`, kind: 'REPORT_APPROVED', category: 'GRADING', verification: 'VERIFIED_RECORD', occurredAt: approvedAt, recordedAt: approvedAt,
    source: { type: 'APPROVAL', cardId, approvalActionId, sourceRevision: 4, sourceHash: hash, reportHash: hash }, report: { version: 2, finalGrade: 9.5, approvedAt } };
  const publication = { eventId: `publication:${approvalActionId}`, kind: 'REPORT_PUBLISHED', category: 'GRADING', verification: 'VERIFIED_RECORD', occurredAt: publishedAt, recordedAt: publishedAt,
    source: { type: 'PUBLICATION', cardId, approvalActionId, reportHash: hash, publicHash: hash, manifestHash: hash }, report: { version: 2, finalGrade: 9.5, approvedAt, publicHash: hash } };
  const f = { staff, calls, actors, card, approval, publication, role: 'REVIEWER', result: { schemaVersion: 1, card, snapshot, events: [publication, approval], latestCustody: null, page: null } };
  f.service = createCardProvenanceService({ auth: { actors, config: { mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', deploymentId: 'fixture', releaseSha: hash, configHash: hash, phoneByHash: new Map([['original-phone-hash', 'private-phone']]) } },
    boundary: { transaction: async (value, work) => { assert.equal(value, staff); return work({ principal: { role: f.role }, tx: { $queryRawUnsafe: async (sql, ...args) => { calls.push({ sql, args }); return [{ result: f.result }]; } } }); } } });
  f.read = () => f.service.read(staff, cardId);
  return f;
}

test('provenance contract binds a bounded cursor to exactly one card and rejects authority/query injection', () => {
  const cardId = randomUUID(), eventId = `approval:${randomUUID()}`;
  assert.deepEqual(cardProvenanceInput(cardId), { cardId, limit: 50, page: null });
  const page = { v: 1, cardId, snapshot, recordedAt: approvedAt, eventId }, cursor = Buffer.from(JSON.stringify(page)).toString('base64url');
  assert.deepEqual(cardProvenanceInput(cardId, { cursor, limit: '1' }).page, page);
  for (const input of [[], null, { limit: 0 }, { limit: 101 }, { limit: '01' }, { ownerId: randomUUID() }, { cursor: 'bad' }, { cursor: '' }, { cursor: cursor + '=' }])
    assert.throws(() => cardProvenanceInput(cardId, input), { code: 'INVALID_CARD_PROVENANCE_QUERY' });
  for (const changed of [{ ...page, cardId: randomUUID() }, { ...page, eventId: 'claim:' + randomUUID() }, { ...page, snapshot: '2026-02-30T14:00:00.123456Z' }, { ...page, actor: 'x' }])
    assert.throws(() => cardProvenanceInput(cardId, { cursor: Buffer.from(JSON.stringify(changed)).toString('base64url') }), { code: 'INVALID_CARD_PROVENANCE_QUERY' });
  for (const suffix of ['?cursor=x&cursor=x', '?limit=1&limit=2', '?customer=x', '?limit=1%'])
    assert.throws(() => cardProvenanceQuery(new URL(`https://fixture.invalid/api/staff/manual-connected/cards/${cardId}/provenance${suffix}`)), { code: 'INVALID_CARD_PROVENANCE_QUERY' });
  assert.deepEqual(OWNERSHIP_VERIFICATION, ['VERIFIED', 'OWNER_REPORTED', 'UNKNOWN']);
});

test('staff provenance requires original reviewer capability and a read-only independently authenticated SQL call', async () => {
  const f = fixture(); await assert.rejects(f.service.read({ ...f.staff }, f.card.cardId), { code: 'SIGN_IN_REQUIRED' });
  f.role = 'OBSERVER'; await assert.rejects(f.read(), { code: 'STAFF_REQUIRED' }); assert.equal(f.calls.length, 0);
  f.role = 'REVIEWER'; const value = await f.read(), call = f.calls[0];
  assert.match(call.sql, /^SELECT atlas_manual.card_provenance\(/); assert.deepEqual(call.args.slice(0, 2), ['original-session', 'original-browser']);
  assert.deepEqual(call.args[3], ['original-phone-hash']); assert.equal(JSON.parse(call.args[4]).cardId, f.card.cardId);
  assert.equal(value.ownership.status, 'UNKNOWN'); assert.equal(value.custody.currentPhysicalHolder, 'UNKNOWN');
  assert.deepEqual(value.capabilities, { ownershipClaims: false, ownershipTransfers: false, reholder: false });
});

test('projection preserves separate immutable approval/publication source anchors and exact original report links', async () => {
  const f = fixture(), before = structuredClone(f.result); f.result.ownerId = 'FORGED_OWNER'; f.card.identity.owner = 'FORGED_OWNER';
  const value = await f.read(); assert.equal(value.card.report.path, `/reports/${f.card.report.publicToken}?v=2`);
  assert.equal(value.card.media.FRONT.url, `/api/reports/${f.card.report.publicToken}/images/FRONT?v=2`);
  assert.equal(value.history.events[0].source.reportHash, hash); assert.equal(value.history.events[1].source.sourceHash, hash);
  assert.equal(value.history.events[1].report.path, undefined); assert.equal(value.history.complete, false);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|FORGED_OWNER|mediaEvidence|privateNotes/);
  assert.deepEqual(f.result.events, before.events, 'reading must not rewrite historical events');
});

test('custody is a separate sourced record; a customer deposit is never verified ownership or physical receipt', async () => {
  const f = fixture(), id = randomUUID();
  const event = { eventId: `custody:${id}`, kind: 'DEPOSIT_DECLARED', category: 'CUSTODY', verification: 'SUBMITTER_REPORTED', occurredAt: approvedAt, recordedAt: approvedAt, sequence: 1,
    source: { type: 'CUSTODY', cardId: f.card.cardId, eventId: id, submissionCardId: randomUUID(), receivedEventId: randomUUID(), linkedAt: publishedAt, inputHash: hash }, evidence: { name: 'Private customer', address: 'Private street' } };
  f.result.events = [event]; const value = await f.read();
  assert.equal(value.history.events[0].verification, 'SUBMITTER_REPORTED'); assert.equal(value.ownership.verification, 'UNKNOWN');
  assert.equal(value.custody.status, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(value), /Private customer|Private street|evidence/);
  f.result.latestCustody = { ...event }; await assert.rejects(f.read(), { code: 'CARD_PROVENANCE_RESPONSE_INVALID' });
});

test('public projection publishes only saved publication facts and cannot leak internal identities, custody or pending approvals', async () => {
  const f = fixture(), value = await f.read(); value.card.customer = { email: 'secret@example.invalid' }; value.ownership = { status: 'VERIFIED', ownerId: randomUUID() };
  const publicValue = publicCardProvenance(value);
  assert.equal(publicValue.history.events.length, 1); assert.equal(publicValue.history.events[0].reportVersion, 2);
  assert.equal(publicValue.ownership.status, 'UNKNOWN'); assert.equal(publicValue.history.complete, false);
  assert.doesNotMatch(JSON.stringify(publicValue), new RegExp(`${f.card.cardId}|${f.card.approvalActionId}|source|ownerId|email|secret|custody|snapshot|cursor`, 'i'));
  f.result.events = [f.approval]; f.card.report.state = 'PENDING'; const pending = await f.read();
  assert.deepEqual(pending.card.media, {}); assert.equal(pending.card.report.path, null); assert.equal(publicCardProvenance(pending), null);
  value.history.events[0].source.cardId = randomUUID(); assert.throws(() => publicCardProvenance(value), { code: 'CARD_PROVENANCE_RESPONSE_INVALID' });
});

test('same-card snapshot pagination retains microseconds and rejects malformed/swap replies', async () => {
  const f = fixture(); f.result.events = [f.publication];
  f.result.page = { v: 1, cardId: f.card.cardId, snapshot, recordedAt: publishedAt, eventId: f.publication.eventId };
  const first = await f.service.read(f.staff, f.card.cardId, { limit: 1 }); const query = cardProvenanceInput(f.card.cardId, { limit: 1, cursor: first.history.nextCursor });
  assert.equal(query.page.recordedAt, publishedAt);
  f.result.events = [f.approval]; f.result.page = null;
  const second = projectCardProvenance(f.result, query); assert.equal(second.card.approvalActionId, first.card.approvalActionId);
  f.result.snapshot = '2026-10-20T14:00:00.123457Z'; assert.throws(() => projectCardProvenance(f.result, query), { code: 'CARD_PROVENANCE_RESPONSE_INVALID' });
});

test('corrupt, cross-card, unsorted or fabricated provenance results fail closed', async () => {
  for (const corrupt of [f => f.card.cardId = randomUUID(), f => f.publication.source.cardId = randomUUID(), f => f.publication.source.publicHash = 'wrong',
    f => f.approval.source.approvalActionId = randomUUID(), f => f.result.events.reverse(), f => f.result.events.push(f.approval), f => f.approval.verification = 'OWNER_REPORTED',
    f => f.approval.kind = 'REHOLDERED', f => f.result.events = Array(101).fill(f.approval), f => f.card.report.publicToken = 'ar_invalid']) {
    const f = fixture(); corrupt(f); await assert.rejects(f.read());
  }
});

test('future provenance runtime requires additive schema and exact grant; role names cannot inject grants', async () => {
  assert.match(cardProvenanceGrantSQL('atlas_manual_fixture'), /^GRANT EXECUTE ON FUNCTION atlas_manual.card_provenance/);
  assert.throws(() => cardProvenanceGrantSQL('bad";GRANT ALL'), { code: 'CARD_PROVENANCE_ROLE_INVALID' });
  for (const [installed, allowed, code] of [[false, false, 'CARD_PROVENANCE_SCHEMA_REQUIRED'], [true, false, 'CARD_PROVENANCE_GRANTS_REQUIRED'], [true, true, null]]) {
    const client = { async $queryRawUnsafe(sql) { return [sql.includes('to_regprocedure') ? { installed } : { allowed }]; } };
    if (code) await assert.rejects(validateCardProvenanceConfiguration({ client }), { code }); else await validateCardProvenanceConfiguration({ client });
  }
});
