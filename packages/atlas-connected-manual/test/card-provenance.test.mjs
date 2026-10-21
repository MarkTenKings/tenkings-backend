import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { emptyAtlasSportsAttributes } from '@atlas/grading-core/identity';
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

function detailFixture() {
  const f = fixture(), attributes = emptyAtlasSportsAttributes();
  attributes.serial = { presence: 'PRESENT', printed: '007/099', numerator: 7, denominator: 99,
    evidence: [{ side: 'BACK', imageSha256: hash, observation: 'Private reviewed source observation' }] };
  f.card.identity = { playerName: null, productSet: 'Saved set', sportsAttributes: attributes };
  const saved = { version: 'atlas-manual-report-snapshot-v2', identity: f.card.identity, finalGrade: f.card.finalGrade,
    finalGradePolicy: 'atlas-final-half-point-v1', ruleVersion: 'SAVED_HISTORICAL_RULE',
    grade: { subgrades: { centering: 9.27, corners: 9.75, edges: 8.94, surface: 9.63 } }, report: { privateStorageKey: 'PRIVATE_REF' } };
  f.card.approvedSnapshot = canonical(saved); f.card.report.reportHash = digest(f.card.approvedSnapshot);
  for (const event of f.result.events) event.source.reportHash = f.card.report.reportHash;
  const sale = { id: 'saved-sale-1', title: 'Saved sold listing', listingUrl: 'https://www.ebay.com/itm/123456789012', grader: 'PSA', grade: '9',
    soldAt: '2026-10-01T12:00:00.000Z', priceMinor: 10123, currency: 'USD', priceBasis: 'sold', labelText: 'PRIVATE_LABEL_READING' };
  f.presentation = { version: 'atlas-report-presentation-v1', binding: { publicToken: f.card.report.publicToken, approvalVersion: 2, publicHash: hash },
    revision: 3, updatedAt: '2026-10-20T13:10:00.000Z', market: { observedAt: '2026-10-20T13:05:00.000Z', sales: [sale],
      estimate: { lowMinor: 1, highMinor: 100000, currency: 'USD', asOf: '2026-10-20T13:05:00.000Z', sampleCount: 1, method: 'Do not project this estimate' } } };
  f.source = { version: 'atlas-selected-market-source-v1', previewId: randomUUID(), sourceHash: hash, selectedIds: [sale.id],
    ref: { cardId: f.card.cardId, kind: 'MARKET_PREVIEW', sha256: hash, privateStorageKey: 'PRIVATE_MARKET_REF' } };
  f.savePresentation = () => { const presentation = canonical(f.presentation), market_source = canonical(f.source);
    f.card.presentationEvidence = { card_id: f.card.cardId, approval_action_id: f.card.approvalActionId, revision: 3, createdAt: '2026-10-20T13:10:00.000001Z',
      presentation, presentation_hash: digest(presentation), market_source, market_source_hash: digest(market_source) }; };
  f.savePresentation(); return f;
}

test('detail uses exact approval scores and reviewed Sports facts without exposing source artifacts or recalculating historical awards', async () => {
  const f = detailFixture(), before = structuredClone(f.result), value = await f.read();
  assert.equal(value.card.identity.category, 'SPORTS', 'null descriptive name does not erase the saved category');
  assert.equal(value.card.identity.sportsAttributes.serial.printed, '007/099');
  assert.equal(value.card.identity.sportsAttributes.serial.denominator, 99);
  assert.deepEqual(value.card.approvedSummary, { state: 'AVAILABLE', ruleVersion: 'SAVED_HISTORICAL_RULE', finalGradePolicy: 'atlas-final-half-point-v1',
    subgrades: { centering: 9.27, corners: 9.75, edges: 8.94, surface: 9.63 } });
  assert.equal(value.card.finalGrade, 9.5); assert.equal(value.card.report.publicHash, hash);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|Private reviewed|approvedSnapshot|imageSha256|presentationEvidence|estimate/);
  assert.deepEqual(f.result, before);
  const legacy = fixture(); const old = await legacy.read(); assert.deepEqual(old.card.approvedSummary, { state: 'UNAVAILABLE' });
  assert.equal(old.card.identity.sportsAttributes, undefined); assert.deepEqual(old.card.savedComparables, { state: 'UNAVAILABLE' });
});

test('saved comparable selection retains observed disclosed prices and exact links but never private source ids or a valuation', async () => {
  const f = detailFixture(), { card } = await f.read();
  assert.equal(card.savedComparables.state, 'SAVED'); assert.equal(card.savedComparables.selection, 'SAVED_REPORT_SELECTION');
  assert.equal(card.savedComparables.source, 'EBAY_SOLD_LISTINGS'); assert.equal(card.savedComparables.sales[0].priceMinor, 10123);
  assert.equal(card.savedComparables.sales[0].listingUrl, 'https://www.ebay.com/itm/123456789012');
  assert.equal(card.savedComparables.presentationRevision, 3); assert.equal(card.savedComparables.observedAt, f.presentation.market.observedAt);
  assert.doesNotMatch(JSON.stringify(card.savedComparables), /previewId|sourceHash|PRIVATE|estimate|shipping|ref/);
  f.presentation.market.sales[0].priceMinor = null; f.presentation.market.sales[0].priceBasis = 'accepted_offer_unknown'; f.savePresentation();
  assert.equal((await f.read()).card.savedComparables.sales[0].priceMinor, null);
});

test('wrong card/approval/version/hash/source/time or unvalidated URL makes optional comps unavailable without hiding the approved grade', async () => {
  for (const change of [f => f.card.presentationEvidence.card_id = randomUUID(), f => f.card.presentationEvidence.approval_action_id = randomUUID(),
    f => f.card.presentationEvidence.createdAt = '2026-10-20T14:00:00.123457Z', f => f.card.presentationEvidence.presentation_hash = hash,
    f => { f.presentation.binding.approvalVersion = 1; f.savePresentation(); }, f => { f.presentation.binding.publicHash = 'b'.repeat(64); f.savePresentation(); },
    f => { f.presentation.market.observedAt = '2026-10-21T00:00:00.000Z'; f.savePresentation(); },
    f => { f.presentation.market.sales[0].listingUrl = 'https://attacker.invalid/itm/123456789012'; f.savePresentation(); },
    f => { f.source.selectedIds = ['wrong']; f.savePresentation(); }, f => { f.source.ref.cardId = randomUUID(); f.savePresentation(); },
    f => { f.source.ref.kind = 'UNAPPROVED_DRAFT'; f.savePresentation(); }, f => f.card.presentationEvidence.market_source_hash = hash,
    f => { f.card.report.state = 'PENDING'; f.result.events = [f.approval]; }]) {
    const f = detailFixture(); change(f); const value = await f.read();
    assert.deepEqual(value.card.savedComparables, { state: 'UNAVAILABLE' }); assert.equal(value.card.finalGrade, 9.5);
    if (f.card.report.state === 'PENDING') { assert.equal(value.card.report.publicHash, undefined); assert.deepEqual(value.card.media, {}); }
  }
});

test('approval snapshot corruption and current-event report swaps fail closed instead of presenting a false detail record', async () => {
  for (const change of [f => f.card.approvedSnapshot += ' ', f => f.card.identity.playerName = 'Different card', f => f.card.finalGrade = 10,
    f => f.publication.report.version = 1, f => f.publication.report.finalGrade = 8, f => f.approval.source.reportHash = hash]) {
    const f = detailFixture(); change(f); await assert.rejects(f.read(), { code: 'CARD_PROVENANCE_RESPONSE_INVALID' });
  }
});
