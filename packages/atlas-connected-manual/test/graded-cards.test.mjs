import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createGradedCardsService, gradedCardsGrantSQL, gradedCardsListInput, validateGradedCardsConfiguration } from '../src/graded-cards.mjs';

const hash = 'a'.repeat(64), approvedAt = '2026-10-20T14:00:00.123456Z';
function fixture() {
  const staff = {}, actor = randomUUID(), cardId = randomUUID(), calls = [], actors = new WeakMap([[staff, { sessionHash: 'saved-session', browserHash: 'saved-browser' }]]);
  const row = { cardId, approvalActionId: randomUUID(), certificateNumber: 'ATLAS-012345ABCDEF', identity: { category: 'SPORTS', playerName: 'Synthetic 100%_Jordan' },
    finalGrade: 9.5, approvedAt, approver: { id: actor, name: 'Reviewer' }, reviewers: [], submission: null,
    report: { state: 'PUBLISHED', version: 2, publicToken: `ar_${'A'.repeat(24)}`, reportHash: hash },
    mediaEvidence: { publicHash: hash, sourceRevision: 5, sourceHash: hash } };
  const f = { staff, actor, calls, actors, role: 'REVIEWER', result: { schemaVersion: 1, cards: [row], page: null }, row };
  f.service = createGradedCardsService({ auth: { actors, config: { mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', deploymentId: 'fixture', releaseSha: hash, configHash: hash, phoneByHash: new Map([['phone-hash', 'private-phone']]) } },
    boundary: { transaction: async (value, work) => { assert.equal(value, staff); return work({ principal: { id: actor, role: f.role }, tx: { $queryRawUnsafe: async (sql, ...args) => { calls.push({ sql, args }); return [{ result: f.result }]; } } }); } } });
  return f;
}

test('archive validates literal search, calendar dates and bounded pages without SQL', () => {
  assert.deepEqual(gradedCardsListInput({ q: '  100%_Jordan  ', category: 'SPORTS', from: '2026-10-01', to: '2026-10-20', limit: '50' }),
    { q: '100%_Jordan', category: 'SPORTS', from: '2026-10-01', to: '2026-10-20', limit: 50, page: null });
  for (const input of [[], null, { q: 'a'.repeat(121) }, { q: 'a\nb' }, { q: null, category: 'all' }, { from: '2026-02-30' }, { from: '2026-10-21', to: '2026-10-20' },
    { to: '2026-10-20T00:00:00Z' }, { limit: 0 }, { limit: 51 }, { limit: '01' }, { limit: 2.5 }, { ownerId: randomUUID() }, { cursor: '' }, { cursor: 'bad' }])
    assert.throws(() => gradedCardsListInput(input), { code: 'INVALID_GRADED_CARDS_QUERY' });
});

test('archive requires original reviewer capability and forwards only original bound auth', async () => {
  const f = fixture();
  await assert.rejects(f.service.list({ ...f.staff }), { code: 'SIGN_IN_REQUIRED' });
  f.role = 'OBSERVER'; await assert.rejects(f.service.list(f.staff), { code: 'STAFF_REQUIRED' }); assert.equal(f.calls.length, 0);
  f.role = 'REVIEWER'; await f.service.list(f.staff, { q: "' OR true --" });
  assert.equal(f.calls[0].sql, 'SELECT atlas_manual.graded_cards($1,$2,$3::jsonb,$4::text[],$5::jsonb) AS result');
  assert.deepEqual(f.calls[0].args.slice(0, 2), ['saved-session', 'saved-browser']);
  assert.deepEqual(f.calls[0].args[3], ['phone-hash']); assert.equal(JSON.parse(f.calls[0].args[4]).q, "' OR true --");
  f.result = { error: { status: 403, code: 'STAFF_REQUIRED' } }; await assert.rejects(f.service.list(f.staff), { code: 'STAFF_REQUIRED' });
  assert.doesNotMatch(gradedCardsGrantSQL('atlas_manual_role'), /GRANT SELECT|ON ALL|atlas_customer/);
  assert.throws(() => gradedCardsGrantSQL('role";GRANT ALL'), { code: 'GRADED_CARDS_ROLE_INVALID' });
});

test('projection removes unrelated private fields and never invents ownership or live publication', async () => {
  const f = fixture(), orderId = randomUUID();
  f.row.customerEmail = 'private@example.invalid'; f.row.ownerId = randomUUID(); f.row.identity.privateKey = 'private-key';
  f.row.approver.phone = 'private-phone';
  f.row.submission = { orderId, cardId: randomUUID(), reference: 'ORDER-123', channel: 'MAIL_IN', customer: { name: 'Submitter', email: 'private@example.invalid', address: 'private-address' }, receipt: 'private-receipt', currentOwnerId: randomUUID() };
  const result = await f.service.list(f.staff), row = result.cards[0], encoded = JSON.stringify(result);
  assert.equal(row.identity.playerName, f.row.identity.playerName); assert.equal(row.finalGrade, 9.5);
  assert.equal(row.report.path, `/reports/${f.row.report.publicToken}?v=2`);
  assert.equal(row.media.FRONT.url, `/api/reports/${f.row.report.publicToken}/images/FRONT?v=2`);
  assert.deepEqual(row.submission.customer, { name: 'Submitter' });
  assert.doesNotMatch(encoded, /private-|ownerId|OwnerId|mediaEvidence|sourceHash|phone|email|address|receipt/);
  f.row.report.state = 'PENDING'; f.row.mediaEvidence.publicHash = null;
  const pending = (await f.service.list(f.staff)).cards[0]; assert.equal(pending.report.path, null); assert.deepEqual(pending.media, {});
});

test('cursor preserves microseconds and exact filters; malformed or filter-swapped cursor fails before SQL', async () => {
  const f = fixture(); f.result.page = { snapshot: '2026-10-20T15:00:00.987654Z', approvedAt, cardId: f.row.cardId };
  const first = await f.service.list(f.staff, { q: 'Jordan', limit: 1 });
  assert.match(first.nextCursor, /^[A-Za-z0-9_-]{1,512}$/);
  await f.service.list(f.staff, { q: 'Jordan', cursor: first.nextCursor, limit: 24 });
  const input = JSON.parse(f.calls[1].args[4]); assert.equal(input.page.approvedAt, approvedAt); assert.equal(input.page.snapshot, f.result.page.snapshot);
  for (const change of [{ q: 'different' }, { category: 'POKEMON' }, { from: '2026-10-01' }, { to: '2026-10-21' }])
    await assert.rejects(f.service.list(f.staff, { q: 'Jordan', cursor: first.nextCursor, ...change }), { code: 'INVALID_GRADED_CARDS_QUERY' });
  const page = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString()); page.approvedAt = '2026-10-21T15:00:00.000000Z';
  await assert.rejects(f.service.list(f.staff, { q: 'Jordan', cursor: Buffer.from(JSON.stringify(page)).toString('base64url') }), { code: 'INVALID_GRADED_CARDS_QUERY' });
  assert.equal(f.calls.length, 2);
});

test('corrupt or oversized native results fail closed', async () => {
  for (const change of [f => { f.result = null; }, f => { f.row.certificateNumber = 'wrong'; }, f => { f.row.approver = null; },
    f => { f.row.mediaEvidence.publicHash = null; }, f => { f.result.cards = Array(25).fill(f.row); },
    f => { f.result.page = { snapshot: '2026-10-20T15:00:00.000000Z', approvedAt, cardId: randomUUID() }; }]) {
    const f = fixture(); change(f); await assert.rejects(f.service.list(f.staff), error => error.status === 503);
  }
});

test('native startup requires both registered archive schema and narrow serving grant', async () => {
  for (const [installed, allowed, code] of [[false, true, 'GRADED_CARDS_SCHEMA_REQUIRED'], [true, false, 'GRADED_CARDS_GRANTS_REQUIRED'], [true, true, null]]) {
    const calls = [], client = { $queryRawUnsafe: async (sql, signature) => { calls.push(sql); assert.equal(signature, 'atlas_manual.graded_cards(text,text,jsonb,text[],jsonb)'); return sql.includes('to_regprocedure') ? [{ installed }] : [{ allowed }]; } };
    if (code) await assert.rejects(validateGradedCardsConfiguration({ client }), { code });
    else await validateGradedCardsConfiguration({ client });
    assert.equal(calls.length, installed ? 2 : 1);
  }
});
