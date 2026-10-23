import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CustomerAuth } from '../../../frontend/atlas-customer/lib/server/auth.mjs';
import { ownershipPreferencesInput, projectOwnershipPreferences } from '../src/card-ownership-preferences-contract.mjs';
import { createCardOwnershipPreferencesService, cardOwnershipPreferencesGrantSQL, OWNERSHIP_PREFERENCES_ROUTINE_PINS } from '../src/card-ownership-preferences-service.mjs';

const aid = randomUUID(), cid = randomUUID(), time = '2026-10-22T00:00:00.000000Z';
const request = (patch = {}) => ({ requestId: randomUUID(), expectedPreferenceRevision: 0, visibility: 'PRIVATE', offersDisabled: true, ...patch });
const cardRequest = () => request({ cardId: cid, expectedOwnershipRevision: 2 });
const access = accountId => ({ accountId, observedAt: time });
const prefs = (patch = {}) => ({ accountId: aid, revision: 0, visibility: 'PRIVATE', offersDisabled: false, ...patch });
const current = (card = null) => ({ ...access(aid), collectionPreferences: prefs(), cardPreferences: card });
const receipt = (action, input) => ({ ...access(aid), requestId: input.requestId, receipt: { eventId: randomUUID(), requestId: input.requestId,
  action, kind: action === 'set_card_preferences' ? 'CARD_PREFERENCES_SET' : 'COLLECTION_PREFERENCES_SET', cardId: input.cardId ?? null,
  input, preferenceRevision: input.expectedPreferenceRevision + 1, recordedAt: time } });
const defer = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
function fixture({ answer = current(), unsafe = false, onQuery, onCommit } = {}) {
  const config = { mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', deploymentId: 'preferences-fixture', releaseSha: '0'.repeat(40), configHash: 'a'.repeat(64),
    cookies: { browser: 'pref_browser', session: 'pref_session' }, sessionKey: Buffer.alloc(32, 9) };
  config.binding = Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(k => [k, config[k]]));
  const auth = new CustomerAuth({ config, database: { call() { assert.fail('No auth writer'); } }, provider: {} });
  const browserToken = Buffer.alloc(32, 2).toString('base64url'), sessionToken = Buffer.alloc(32, 3).toString('base64url');
  const cookie = `${config.cookies.browser}=${browserToken}; ${config.cookies.session}=${sessionToken}`;
  const csrf = auth.digest(`session:${sessionToken}`), actions = [], settings = [], queries = [];
  const roleRow = { name: 'atlas_fixture_prefs', session: 'atlas_fixture_prefs', unsafe, memberships: [] };
  const defs = OWNERSHIP_PREFERENCES_ROUTINE_PINS.map(r => ({ ...r, config: [...r.config], owner: 'atlas_fixture_owner' }));
  const stats = { begins: 0, commits: 0, rollbacks: 0, roleChecks: 0 }; let executable = [{ schema: defs[0].schema, name: defs[0].name }];
  const client = { async $transaction(work, options) {
    stats.begins++; assert.deepEqual(options, { maxWait: 3000, timeout: 8000 });
    try {
      const result = await work({ async $executeRawUnsafe(q) { settings.push(q); }, async $queryRawUnsafe(q, ...args) {
        queries.push(q);
        if (q.startsWith('SELECT current_user')) { stats.roleChecks++; return [structuredClone(roleRow)]; }
        if (q.startsWith('SELECT n.nspname') && !q.includes('bodySha256')) return executable;
        if (q.includes('bodySha256')) return defs;
        actions.push(args[3]); if (onQuery) { const override = await onQuery(args, f); if (override) return [{ result: override }]; }
        if (args[3] === 'read_access') return [{ result: access(aid) }];
        return [{ result: typeof answer === 'function' ? answer(args) : answer }];
      } }); stats.commits++; if (onCommit) await onCommit(f); return result;
    } catch (error) { if (!stats.commits) stats.rollbacks++; throw error; }
  } };
  const options = { customerAuth: auth, client, servingRole: 'atlas_fixture_prefs', schemaOwner: 'atlas_fixture_owner' };
  const f = { config, auth, cookie, csrf, client, options, actions, settings, queries, roleRow, defs, stats, setExecutable(v) { executable = v; } };
  f.service = createCardOwnershipPreferencesService(options); return f;
}
const administratorMembership = ({ servingRole, schemaOwner }) => ({ role: servingRole, member: schemaOwner, admin: true, inherit: false, set: false, grantorSuperuser: true });

test('closed preference inputs reject claims, authority, getters and unrelated actions', () => {
  for (const action of ['submit_claim','propose_transfer','accept_transfer','read_collection','review_claim'])
    assert.throws(() => ownershipPreferencesInput(action, {}), { code: 'OWNERSHIP_PREFERENCES_ONLY' });
  for (const bad of [{ ...request(), accountId: aid }, { ...request(), offersDisabled: 'false' }, { ...request(), expectedPreferenceRevision: 2147483647 }])
    assert.throws(() => ownershipPreferencesInput('set_collection_preferences', bad));
  const getter = {}; Object.defineProperty(getter, 'requestId', { enumerable: true, get() { assert.fail('Getter executed'); } });
  assert.throws(() => ownershipPreferencesInput('recover_request', getter));
  const v = request(); const out = ownershipPreferencesInput('set_collection_preferences', v); assert(Object.isFrozen(out)); assert.deepEqual(out, v);
});
test('current collection defaults and card opt-out stay independent from delivery and ownership receipts', () => {
  const c = { cardId: cid, ownershipRevision: 2, revision: 1, visibility: 'PUBLIC', offersDisabled: true };
  const r = projectOwnershipPreferences('read_card', current(c), { cardId: cid }, aid);
  assert.equal(r.effective.visibility, 'PRIVATE'); assert.equal(r.effective.preference, 'DISABLED'); assert.equal(r.cardPreferences.visibility, 'PUBLIC');
  assert.equal(r.effective.canReceiveOffers, false); assert.equal(r.effective.notificationDelivery, 'NOT_REQUESTED');
  assert.equal(projectOwnershipPreferences('read_preferences', current(), {}, aid).effective.preference, 'OPEN_TO_OFFERS');
  for (const patch of [{ ownerAccountId: aid }, { currentPhysicalHolder: aid }, { claim: {} }])
    assert.throws(() => projectOwnershipPreferences('read_preferences', { ...current(), ...patch }, {}, aid));
});
test('receipts bind exact original input, account, request, kind and stored revision', () => {
  const input = cardRequest(), raw = receipt('set_card_preferences', input);
  const r = projectOwnershipPreferences('set_card_preferences', raw, input, aid);
  assert.equal(r.outcome, 'RECORDED'); assert.deepEqual(r.receipt.input, input); assert(!Object.hasOwn(r, 'current'));
  for (const change of [x => x.accountId = randomUUID(), x => x.receipt.action = 'propose_transfer', x => x.receipt.kind = 'CLAIM_SUBMITTED',
    x => x.receipt.preferenceRevision++, x => x.receipt.input.offersDisabled = false, x => x.receipt.cardId = randomUUID(),
    x => x.receipt.recordedAt = '2027-01-01T00:00:00Z']) {
    const bad = structuredClone(raw); change(bad); assert.throws(() => projectOwnershipPreferences('set_card_preferences', bad, input, aid));
  }
});
test('historical recovery carries no current ownership; ABSENT is explicit and never a write success', () => {
  const input = cardRequest(), raw = receipt('set_card_preferences', input);
  const r = projectOwnershipPreferences('recover_request', raw, { requestId: input.requestId }, aid);
  assert.equal(r.receipt.input.expectedOwnershipRevision, 2); assert.doesNotMatch(JSON.stringify(r), /currentOwner|currentTitle|ownerAccountId/);
  const absent = { ...access(aid), requestId: input.requestId, receipt: null };
  assert.equal(projectOwnershipPreferences('recover_request', absent, { requestId: input.requestId }, aid).outcome, 'ABSENT');
  assert.throws(() => projectOwnershipPreferences('set_card_preferences', absent, input, aid));
});
test('construction is inert, separate client required, grant proposal has only new gateway', () => {
  const f = fixture(); assert.equal(f.stats.begins, 0);
  const grants = cardOwnershipPreferencesGrantSQL('atlas_fixture_prefs');
  assert.match(grants, /atlas_ownership_preferences.customer_call/); assert.doesNotMatch(grants, /CREATE|TABLE|SEQUENCE|atlas_ownership\.customer_call/);
  assert.throws(() => cardOwnershipPreferencesGrantSQL('public'));
  assert.throws(() => createCardOwnershipPreferencesService({ ...f.options, client: f.auth.database }));
});
test('actual CustomerAuth CSRF and cookie proofs precede transactions', async () => {
  const f = fixture();
  await assert.rejects(f.service.setCollectionPreferences(f.cookie, 'wrong', request()), { code: 'CSRF_REQUIRED' });
  await assert.rejects(f.service.readPreferences(''), { code: 'SIGN_IN_REQUIRED' }); assert.equal(f.stats.begins, 0);
  await f.service.readPreferences(f.cookie);
  assert.deepEqual(f.actions, ['read_access','read_preferences','read_access']); assert.equal(f.stats.roleChecks, 2);
  assert(f.settings.includes("SET LOCAL timezone='UTC'")); assert.equal(f.stats.commits, 1);
});
test('forged cross-account reply is refused inside transaction before private output', async () => {
  const f = fixture({ answer: { ...current(), accountId: randomUUID() } });
  await assert.rejects(f.service.readPreferences(f.cookie), { code: 'OWNERSHIP_PREFERENCES_RESPONSE_INVALID' });
  assert.equal(f.stats.rollbacks, 1); assert.equal(f.stats.commits, 0);
});
test('direct old gateway, helper and raw-table role drift fail closed', async () => {
  const unsafe = fixture({ unsafe: true }); await assert.rejects(unsafe.service.readPreferences(unsafe.cookie), { code: 'OWNERSHIP_PREFERENCES_DATABASE_ROLE_INVALID' });
  const f = fixture(); f.setExecutable([{ schema: 'atlas_ownership', name: 'customer_call(text, text, jsonb, text, jsonb)' }]);
  await assert.rejects(f.service.readPreferences(f.cookie), { code: 'OWNERSHIP_PREFERENCES_DATABASE_ROLE_INVALID' }); assert.equal(f.actions.length, 0);
});
test('reviewed owner incoming superuser-granted admin-only membership permits preference reads', async () => {
  const f = fixture(); f.roleRow.memberships = [administratorMembership(f.options)];
  await f.service.readPreferences(f.cookie);
  assert.equal(f.stats.roleChecks, 2); assert.equal(f.stats.commits, 1);
});
test('preference roles reject outgoing and non-exact incoming administrator memberships before reads', async () => {
  for (const patch of [{ role: 'another_role' }, { member: 'another_owner' },
    { role: 'another_role', member: 'atlas_fixture_prefs' }, { member: 'atlas_fixture_prefs' },
    { admin: false }, { admin: null }, { admin: 'true' }, { inherit: true }, { inherit: null }, { inherit: 0 },
    { set: true }, { set: null }, { set: 0 }, { grantorSuperuser: false }, { grantorSuperuser: null }, { grantorSuperuser: 'true' }]) {
    const f = fixture(); f.roleRow.memberships = [administratorMembership(f.options), { ...administratorMembership(f.options), ...patch }];
    await assert.rejects(f.service.readPreferences(f.cookie), { code: 'OWNERSHIP_PREFERENCES_DATABASE_ROLE_INVALID' }, JSON.stringify(patch));
    assert.equal(f.actions.length, 0); assert.equal(f.stats.commits, 0);
  }
  for (const memberships of [undefined, null, {}, [null], [{}]]) {
    const f = fixture(); f.roleRow.memberships = memberships;
    await assert.rejects(f.service.readPreferences(f.cookie), { code: 'OWNERSHIP_PREFERENCES_DATABASE_ROLE_INVALID' });
    assert.equal(f.actions.length, 0);
  }
});
test('post-write administrator membership drift rejects the receipt inside the transaction', async () => {
  const input = request(), f = fixture({ answer: receipt('set_collection_preferences', input), onQuery(args, f) {
    if (args[3] === 'set_collection_preferences') f.roleRow.memberships[0].inherit = true;
  } });
  f.roleRow.memberships = [administratorMembership(f.options)];
  await assert.rejects(f.service.setCollectionPreferences(f.cookie, f.csrf, input), { code: 'OWNERSHIP_PREFERENCES_DATABASE_ROLE_INVALID' });
  assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
});
test('preference catalog queries inspect both membership directions and literal pg_ schemas', async () => {
  const f = fixture(); await f.service.readPreferences(f.cookie);
  const query = f.queries.find(sql => sql.startsWith('SELECT current_user'));
  assert.match(query, /WHERE m\.member=r\.oid OR m\.roleid=r\.oid/);
  assert.match(query, /LEFT JOIN pg_roles g ON g\.oid=m\.grantor/);
  assert.match(query, /'grantorSuperuser',g\.rolsuper/);
  const catalog = [...new Set(f.queries)].join('\n');
  assert.doesNotMatch(catalog, /LIKE 'pg_%'/);
  assert.equal([...catalog.matchAll(/left\(n\.nspname,3\)<>'pg_'/g)].length, 4);
});
test('definition, owner, definer and configuration source drift are refused before reads', async () => {
  for (const patch of [{ owner: 'foreign_owner' }, { definer: false }, { bodySha256: 'f'.repeat(64) }, { config: ['search_path=public'] }]) {
    const f = fixture(); Object.assign(f.defs[0], patch); await assert.rejects(f.service.readPreferences(f.cookie), { code: 'OWNERSHIP_PREFERENCES_DATABASE_ROLE_INVALID' });
    assert.equal(f.actions.length, 0);
  }
});
test('post-write source rejection throws within transaction; no false success receipt', async () => {
  const input = request(); const f = fixture({ answer: receipt('set_collection_preferences', input), onQuery(args, f) {
    if (args[3] === 'set_collection_preferences') f.defs[0].bodySha256 = 'f'.repeat(64);
  } });
  await assert.rejects(f.service.setCollectionPreferences(f.cookie, f.csrf, input), { code: 'OWNERSHIP_PREFERENCES_DATABASE_ROLE_INVALID' });
  assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
});
test('capability drift during an observed write await rolls back; close does not disconnect caller', async () => {
  for (const mutate of [f => f.options.client = {}, f => f.config.binding.releaseSha = 'f'.repeat(40), f => f.config.cookies.session = 'changed', f => f.service.close()]) {
    const entered = defer(), gate = defer(), input = request();
    const f = fixture({ answer: receipt('set_collection_preferences', input), async onQuery(args) {
      if (args[3] === 'set_collection_preferences') { entered.resolve(); await gate.promise; }
    } });
    const pending = f.service.setCollectionPreferences(f.cookie, f.csrf, input); await entered.promise; mutate(f); gate.resolve();
    await assert.rejects(pending, { code: 'OWNERSHIP_PREFERENCES_UNAVAILABLE' }); assert.equal(f.stats.rollbacks, 1);
  }
});
test('lost response after commit remains an error without a definitive-refusal outcome', async () => {
  const input = request(); const f = fixture({ answer: receipt('set_collection_preferences', input), onCommit() { throw Error('synthetic response lost after commit'); } });
  await assert.rejects(f.service.setCollectionPreferences(f.cookie, f.csrf, input), /response lost/);
  assert.equal(f.stats.commits, 1); assert.equal(f.stats.rollbacks, 0);
});
test('static body pins match exact new/unchanged source and UTC gateway serialization', async () => {
  const sources = { atlas_ownership_preferences: await readFile(new URL('../sql/card-ownership-preferences-proposal.sql', import.meta.url), 'utf8'),
    atlas_ownership: await readFile(new URL('../sql/card-ownership-proposal.sql', import.meta.url), 'utf8'),
    atlas_customer: await readFile(new URL('../../atlas-standalone-database/sql/baseline.sql', import.meta.url), 'utf8') };
  for (const pin of OWNERSHIP_PREFERENCES_ROUTINE_PINS) {
    const name = pin.name.split('(')[0];
    const expression = new RegExp('CREATE(?: OR REPLACE)? FUNCTION ' + pin.schema + '\\.' + name + '\\([^;]+?AS (\\$[A-Za-z_]*\\$)(.*?)\\1;', 'gs');
    const match = [...sources[pin.schema].matchAll(expression)].at(-1); assert(match, pin.name);
    assert.equal(createHash('sha256').update(match[2]).digest('hex'), pin.bodySha256, pin.name);
  }
  assert.match(sources.atlas_ownership_preferences, /to_char\(saved.created_at AT TIME ZONE 'UTC'/);
  assert.match(sources.atlas_ownership_preferences, /RAISE EXCEPTION 'SIGN_IN_REQUIRED'/);
});

test('final live access rejection after append rolls back inside the transaction', async () => {
  const input = request(); let reads = 0;
  const f = fixture({ answer: receipt('set_collection_preferences', input), onQuery(args) {
    if (args[3] === 'read_access' && ++reads === 2) return { error: { status: 401, code: 'SIGN_IN_REQUIRED' } };
  } });
  await assert.rejects(f.service.setCollectionPreferences(f.cookie, f.csrf, input), { code: 'SIGN_IN_REQUIRED' });
  assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
});
test('post-commit capability loss reports uncertainty, not a fabricated rollback', async () => {
  const input = request(); const f = fixture({ answer: receipt('set_collection_preferences', input), onCommit(f) { f.service.close(); } });
  await assert.rejects(f.service.setCollectionPreferences(f.cookie, f.csrf, input), { code: 'OWNERSHIP_PREFERENCES_UNAVAILABLE' });
  assert.equal(f.stats.commits, 1); assert.equal(f.stats.rollbacks, 0);
});

test('typed monotone stale witness binds exact account/action/card/input, never generic error or ABSENT', async () => {
  const input = cardRequest(), raw = { ...access(aid), requestId: input.requestId, action: 'set_card_preferences', cardId: cid, input,
    observedPreferenceRevision: 3 };
  const output = projectOwnershipPreferences('set_card_preferences', raw, input, aid);
  assert.equal(output.schema, 'atlas-ownership-preferences-stale-v1'); assert.equal(output.outcome, 'NOT_APPLIED_STALE'); assert.deepEqual(output.input, input);
  for (const change of [v => { v.observedPreferenceRevision = 0; }, v => { v.action = 'set_collection_preferences'; }, v => { v.accountId = randomUUID(); },
    v => { v.requestId = randomUUID(); }, v => { v.cardId = randomUUID(); }, v => { v.input.visibility = 'PUBLIC'; }, v => { v.receipt = null; }]) {
    const bad = structuredClone(raw); change(bad); assert.throws(() => projectOwnershipPreferences('set_card_preferences', bad, input, aid));
  }
  assert.throws(() => projectOwnershipPreferences('recover_request', raw, { requestId: input.requestId }, aid));
  const f = fixture({ answer: raw }); assert.deepEqual(await f.service.setCardPreferences(f.cookie, f.csrf, input), output);
  assert.equal(f.stats.commits, 1); assert.deepEqual(f.actions, ['read_access', 'set_card_preferences', 'read_access']);
});
test('stale witness is withheld on final live auth/source rejection and requires reviewed immutable journal guard', async () => {
  const input = request(), raw = { ...access(aid), requestId: input.requestId, action: 'set_collection_preferences', cardId: null, input, observedPreferenceRevision: 2 };
  for (const kind of ['AUTH', 'SOURCE']) {
    let reads = 0;
    const f = fixture({ answer: raw, onQuery(args, f) {
      if (kind === 'SOURCE' && args[3] === 'set_collection_preferences') f.defs[0].bodySha256 = 'f'.repeat(64);
      if (kind === 'AUTH' && args[3] === 'read_access' && ++reads === 2) return { error: { status: 401, code: 'SIGN_IN_REQUIRED' } };
    } });
    await assert.rejects(f.service.setCollectionPreferences(f.cookie, f.csrf, input)); assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
  }
  const source = await readFile(new URL('../src/card-ownership-preferences-service.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'atlas_[^']+'::reg(?:class|procedure)/);
  assert.match(source, /cn\.nspname='atlas_ownership' AND c\.relname='event'/); assert.match(source, /pn\.nspname='atlas_manual' AND p\.proname='immutable' AND p\.pronargs=0/);
  assert.match(source, /t\.tgtype=27/); assert.match(source, /t\.tgenabled='O'/);
});
