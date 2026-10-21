import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CustomerAuth } from '../../../frontend/atlas-customer/lib/server/auth.mjs';
import { createCardOwnershipReadService, cardOwnershipReadGrantSQL } from '../src/card-ownership-read-service.mjs';

const aid = randomUUID(), cid = randomUUID();
const browser = Buffer.alloc(32, 1).toString('base64url'), session = Buffer.alloc(32, 2).toString('base64url');
const cookie = `reader_browser=${browser}; reader_session=${session}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const binding = () => ({ mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', deploymentId: 'local-customer-fixture',
  releaseSha: '0'.repeat(40), configHash: 'a'.repeat(64) });
const preferences = () => ({ accountId: aid, revision: 0, visibility: 'PRIVATE', offersDisabled: false });
const card = () => ({ cardId: cid, ownership: { status: 'VERIFIED', ownerAccountId: aid, revision: 1 },
  cardPreferenceRevision: 0, cardVisibility: 'PRIVATE', cardOffersDisabled: false, collectionPreferences: preferences(),
  custody: { status: 'RECORDED', currentPhysicalHolder: aid, privateAddress: 'NEVER_EXPOSE' },
  approvedCard: { approvalActionId: randomUUID(), certificateNumber: 'ATLAS-123456789ABC',
    report: { publicToken: 'ar_' + 'a'.repeat(24), version: 2, publicHash: 'b'.repeat(64) } },
  evidence: 'NEVER_EXPOSE', ownerPhone: 'NEVER_EXPOSE', label: { actorId: 'NEVER_EXPOSE' } });
const routine = () => ({ schema: 'atlas_ownership', name: 'customer_read(text, text, jsonb, text, jsonb)',
  definer: true, config: ['search_path=pg_catalog'], owned: false });
function fixture({ result = { accountId: aid, cards: [], nextCardId: null, preferences: preferences() }, unsafe = false, functions = [routine()], databaseError } = {}) {
  const queries = [], settings = [], config = { ...binding(), cookies: { browser: 'reader_browser', session: 'reader_session' } };
  const auth = new CustomerAuth({ config, database: { call() { throw Error('Unexpected auth writer'); } }, provider: {} });
  let transactions = 0;
  const client = { async $transaction(fn, options) {
    transactions++; assert.deepEqual(options, { maxWait: 3000, timeout: 5000 });
    return fn({ async $executeRawUnsafe(sql) { settings.push(sql); }, async $queryRawUnsafe(sql, ...params) {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT r.rolsuper')) return [{ unsafe }];
      if (sql.startsWith('SELECT n.nspname')) return functions;
      assert.equal(sql, 'SELECT atlas_ownership.customer_read($1,$2,$3::jsonb,$4,$5::jsonb) AS result');
      if (databaseError) throw databaseError;
      return [{ result }];
    } });
  } };
  return { service: createCardOwnershipReadService({ auth, client }), auth, config, queries, settings, get transactions() { return transactions; } };
}

test('real CustomerAuth cookie hashes and captured deployment binding are the only authority passed to the reader', async () => {
  const f = fixture();
  const value = await f.service.read(cookie, 'read_collection', { afterCardId: null, limit: 25 });
  assert.equal(value.accountId, aid); assert.deepEqual(value.cards, []); assert.equal(value.preferences.offersDisabled, false);
  assert.deepEqual(f.queries.at(-1).params, [digest(session), digest(browser), JSON.stringify(binding()), 'read_collection', JSON.stringify({ afterCardId: null, limit: 25 })]);
  assert.deepEqual(f.settings, ["SET LOCAL lock_timeout = '1500ms'", "SET LOCAL statement_timeout = '3000ms'"]);
  assert.equal(Object.keys(f.service).join(','), 'read'); assert.ok(Object.isFrozen(f.service));
});

test('every mutation and unknown action is refused before authentication or SQL', async () => {
  const f = fixture();
  for (const action of ['submit_claim', 'review_claim', 'propose_transfer', 'accept_transfer', 'cancel_transfer',
    'set_card_preferences', 'set_collection_preferences', 'read_claim', 'read_collection;SELECT 1', null, {}]) {
    await assert.rejects(f.service.read(cookie, action, {}), { code: 'OWNERSHIP_READ_ONLY' });
  }
  assert.equal(f.transactions, 0);
});

test('caller account/capability, malformed cookies and expanded paging are refused before SQL', async () => {
  const f = fixture();
  for (const field of ['accountId', 'ownerAccountId', 'authority', 'sessionHash', 'browserHash', 'binding', 'approvedCard']) {
    await assert.rejects(f.service.read(cookie, 'read_collection', { afterCardId: null, limit: 25, [field]: aid }), { code: 'INVALID_OWNERSHIP_REQUEST' });
  }
  for (const limit of [0, 51, '25', 1.2]) await assert.rejects(f.service.read(cookie, 'read_collection', { afterCardId: null, limit }), { code: 'INVALID_OWNERSHIP_REQUEST' });
  for (const header of ['', undefined, { accountId: aid, sessionHash: digest(session), browserHash: digest(browser) }, 'x'.repeat(8193), `reader_browser=${browser}`]) {
    await assert.rejects(f.service.read(header, 'read_preferences', {}), { code: 'SIGN_IN_REQUIRED' });
  }
  assert.equal(f.transactions, 0);
});

test('changing trusted auth release configuration fails closed rather than mixing bindings', async () => {
  const f = fixture(); f.config.releaseSha = '1'.repeat(40);
  await assert.rejects(f.service.read(cookie, 'read_preferences', {}), { code: 'OWNERSHIP_READ_ADAPTER_INVALID' });
  assert.equal(f.transactions, 0);
  assert.throws(() => createCardOwnershipReadService({ auth: { accountId: aid, config: binding() }, client: {} }), { code: 'OWNERSHIP_READ_ADAPTER_INVALID' });
});

test('reader refuses broad database authority and any mutator, helper, ownership or search_path drift', async () => {
  const variants = [{ unsafe: true }, { functions: [] }, { functions: [routine(), { ...routine(), name: 'customer_call(text, text, jsonb, text, jsonb)' }] },
    { functions: [routine(), { ...routine(), name: 'current_title(uuid)' }] },
    ...[{ definer: false }, { owned: true }, { schema: 'atlas_customer' }, { config: ['search_path=public'] },
      { config: ['search_path=pg_catalog', 'row_security=off'] }].map(patch => ({ functions: [{ ...routine(), ...patch }] }))];
  for (const variant of variants) {
    const f = fixture(variant);
    await assert.rejects(f.service.read(cookie, 'read_preferences', {}), { code: 'OWNERSHIP_READ_DATABASE_ROLE_INVALID' });
    assert.equal(f.queries.some(q => q.sql.startsWith('SELECT atlas_ownership.customer_read(')), false);
  }
  const f = fixture(); await f.service.read(cookie, 'read_collection', { afterCardId: null, limit: 1 });
  assert.match(f.queries[0].sql, /has_sequence_privilege/); assert.match(f.queries[0].sql, /has_column_privilege/);
});

test('database auth/refusal/unavailability errors never become an empty collection', async () => {
  for (const [status, code] of [[401, 'SIGN_IN_REQUIRED'], [404, 'OWNERSHIP_NOT_FOUND'], [503, 'CUSTOMER_ACCESS_NOT_ENABLED']]) {
    const f = fixture({ result: { error: { status, code } } });
    await assert.rejects(f.service.read(cookie, 'read_collection', { afterCardId: null, limit: 1 }), { status, code });
  }
  const error = new Error('database offline'), f = fixture({ databaseError: error });
  await assert.rejects(f.service.read(cookie, 'read_preferences', {}), value => value === error);
  for (const error of [{ status: 200, code: 'OK' }, { status: 503, code: 'private contact detail' }]) {
    await assert.rejects(fixture({ result: { error } }).service.read(cookie, 'read_preferences', {}), { code: 'OWNERSHIP_RESPONSE_INVALID' });
  }
});

test('card, preferences and continuation responses preserve exact approval bindings and redact private fields', async () => {
  const raw = card(), f = fixture({ result: { accountId: aid, cards: [raw], nextCardId: cid, preferences: preferences() } });
  const value = await f.service.read(cookie, 'read_collection', { afterCardId: null, limit: 1 });
  assert.equal(value.nextCardId, cid); assert.deepEqual(value.cards[0].approvedCard, raw.approvedCard);
  assert.equal(value.cards[0].eligibility.canReceiveOffers, false); assert.equal(value.cards[0].notificationDelivery, 'NOT_REQUESTED');
  assert.deepEqual(value.cards[0].custody, { status: 'RECORDED', currentPhysicalHolder: 'UNKNOWN' });
  assert.doesNotMatch(JSON.stringify(value), /NEVER_EXPOSE|ownerPhone|actorId|evidence|label/);
  const one = await fixture({ result: { accountId: aid, card: raw } }).service.read(cookie, 'read_card', { cardId: cid });
  assert.deepEqual(one, value.cards[0]);
  assert.equal((await fixture({ result: { accountId: aid, preferences: preferences() } }).service.read(cookie, 'read_preferences', {})).accountId, aid);
});

test('unknown/nonowner, conflicting preference snapshots and missing approved report fail closed', async () => {
  for (const mutate of [c => { c.ownership.status = 'UNKNOWN'; }, c => { c.ownership.ownerAccountId = randomUUID(); },
    c => { c.collectionPreferences.revision++; }, c => { c.approvedCard.report = null; }]) {
    const raw = card(); mutate(raw);
    const f = fixture({ result: { accountId: aid, cards: [raw], nextCardId: null, preferences: preferences() } });
    await assert.rejects(f.service.read(cookie, 'read_collection', { afterCardId: null, limit: 1 }), { code: 'OWNERSHIP_RESPONSE_INVALID' });
  }
});

test('reader grant is narrow and source has no executable mutator or writer registration', async () => {
  assert.equal(cardOwnershipReadGrantSQL('atlas_fixture_reader'), 'GRANT USAGE ON SCHEMA atlas_ownership TO "atlas_fixture_reader";\nGRANT EXECUTE ON FUNCTION atlas_ownership.customer_read(text,text,jsonb,text,jsonb) TO "atlas_fixture_reader";');
  for (const role of ['public', 'pg_read_all_data', 'x"; DROP SCHEMA', '', 'UPPER']) {
    assert.throws(() => cardOwnershipReadGrantSQL(role), { code: 'OWNERSHIP_READ_ROLE_INVALID' });
  }
  const sql = await readFile(new URL('../sql/card-ownership-reader-proposal.sql', import.meta.url), 'utf8');
  const executable = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(executable, /atlas_ownership\.(?:customer_call|staff_call)\s*\(/);
  assert.match(executable, /REVOKE ALL ON FUNCTION atlas_ownership.customer_read\(text,text,jsonb,text,jsonb\) FROM PUBLIC/);
  assert.equal((executable.match(/atlas_customer.current_account\(/g) ?? []).length, 2);
  const manifest = await readFile(new URL('../../atlas-standalone-database/migrations.manifest.json', import.meta.url), 'utf8');
  assert.doesNotMatch(manifest, /card-ownership-reader|card-ownership-proposal/);
});
