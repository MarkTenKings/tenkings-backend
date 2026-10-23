import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionPreferencesRuntime, collectionPreferencesConfiguration } from '../lib/server/collection-preferences-runtime.mjs';
import { createCollectionPreferencesController } from '../lib/collection-preferences-state.mjs';
import { createPreferenceFixture, prefId, CID, defer } from './collection-preferences-fixture.mjs';

const customerUrl = 'postgresql://atlas_customer_login:customer-secret@db.example.invalid/atlas?schema=atlas_customer&sslmode=require';
const preferencesUrl = 'postgresql://atlas_fixture_preferences:preferences-secret@db.example.invalid/atlas?schema=atlas_ownership_preferences&sslmode=require';
const setting = () => ({ enabled: '1', databaseUrl: preferencesUrl, schemaOwner: 'atlas_fixture_owner' });
const input = (revision = 0) => ({ requestId: prefId(110), expectedPreferenceRevision: revision, visibility: 'PUBLIC', offersDisabled: true });
function setup(params = {}) {
  const { construct, extraOptions, configure } = params, settings = Object.hasOwn(params, 'settings') ? params.settings : setting();
  const f = createPreferenceFixture(); f.config.databaseUrl = customerUrl;
  const original = f.serviceOptions.client, calls = { create: 0, transactions: 0, disconnect: 0, urls: [] };
  const owned = {
    async $transaction(work, options) { assert.equal(this, owned); calls.transactions++;
      assert.deepEqual(options, { maxWait: 3000, timeout: 8000 }); return Reflect.apply(original.$transaction, original, [work]); },
    async $disconnect() { assert.equal(this, owned); calls.disconnect++; },
  };
  const broad = { $transaction() { assert.fail('General customer client used'); }, $disconnect() { assert.fail('General client disposed'); } };
  f.auth.database.client = broad;
  const options = { customerState: f.state, settings, createClient: async url => {
    calls.create++; calls.urls.push(url); return construct ? construct(owned, f, options) : owned;
  }, ...extraOptions };
  configure?.(f, options);
  const runtime = createCollectionPreferencesRuntime(options);
  f.handler = runtime.handler;
  return { f, calls, owned, broad, options, runtime };
}

test('pure explicit configuration: off means absent; exact schema owner, separate same-db role/password and bounded pool', () => {
  const config = { mode: 'PRODUCTION', databaseUrl: customerUrl };
  for (const enabled of [undefined, null, '', '0']) assert.equal(collectionPreferencesConfiguration({ enabled, databaseUrl: undefined, schemaOwner: undefined }, config), null);
  const selected = collectionPreferencesConfiguration(setting(), config), url = new URL(selected.databaseUrl);
  assert.equal(selected.servingRole, 'atlas_fixture_preferences'); assert.equal(selected.schemaOwner, 'atlas_fixture_owner'); assert(Object.isFrozen(selected));
  assert.deepEqual([...url.searchParams.entries()], [['schema', 'atlas_ownership_preferences'], ['sslmode', 'require'], ['connection_limit', '2'], ['pool_timeout', '3'], ['connect_timeout', '5']]);
  for (const change of [{ enabled: '0' }, { enabled: true }, { schemaOwner: undefined }, { schemaOwner: 'public' }, { schemaOwner: 'pg_admin' }, { schemaOwner: 'atlas_fixture_preferences' }, { extra: true }])
    assert.throws(() => collectionPreferencesConfiguration({ ...setting(), ...change }, config), { code: 'PREFERENCES_UNAVAILABLE' });
  for (const bad of [preferencesUrl.replace('atlas_fixture_preferences:', 'atlas_customer_login:'), preferencesUrl.replace('preferences-secret', 'customer-secret'),
    preferencesUrl.replace('atlas_fixture_preferences:', '%61tlas_customer_login:'), preferencesUrl.replace('db.example.invalid', 'other.invalid'),
    preferencesUrl.replace('/atlas?', '/other?'), preferencesUrl.replace('db.example.invalid', 'db.example.invalid:5433'),
    preferencesUrl.replace('schema=atlas_ownership_preferences', 'schema=atlas_ownership'), preferencesUrl + '&schema=atlas_ownership_preferences',
    preferencesUrl + '&options=-crole=owner', preferencesUrl + '&connection_limit=99', preferencesUrl + '#x', preferencesUrl.replace('sslmode=require', 'sslmode=disable'),
    preferencesUrl.replace('preferences-secret', 'bad%0Asecret')]) assert.throws(() => collectionPreferencesConfiguration({ ...setting(), databaseUrl: bad }, config));
  assert.throws(() => collectionPreferencesConfiguration(setting(), { ...config, databaseUrl: customerUrl + '&host=other.invalid' }));
  const local = { mode: 'LOCAL_FIXTURE', databaseUrl: customerUrl.replace('db.example.invalid', '127.0.0.1').replace('&sslmode=require', '') };
  assert(collectionPreferencesConfiguration({ ...setting(), databaseUrl: preferencesUrl.replace('db.example.invalid', '127.0.0.1').replace('&sslmode=require', '') }, local));
  assert.throws(() => collectionPreferencesConfiguration(setting(), local));
});

test('default/malformed runtime is absent with no import/construction client access or leaked config', async () => {
  const empty = createCollectionPreferencesRuntime(); assert.equal(empty.preferences, null); assert.equal(empty.handler, null); await empty.close();
  const getter = {}; Object.defineProperty(getter, 'customerState', { get() { assert.fail('Unknown options getter'); } });
  const malformed = createCollectionPreferencesRuntime(getter); assert.equal(malformed.preferences, null); await malformed.close();
  for (const settings of [undefined, {}, { enabled: '0', databaseUrl: undefined, schemaOwner: undefined }, { ...setting(), databaseUrl: 'private-invalid' }]) {
    const f = setup({ settings }); assert.equal(f.runtime.preferences, null); assert.equal(f.runtime.configuredForDisplay, false); assert.equal(f.f.handler, null); assert.equal(f.calls.create, 0);
    assert.doesNotMatch(JSON.stringify(f.runtime), /secret|databaseUrl|schemaOwner/); await f.runtime.close(); assert.equal(f.calls.disconnect, 0);
  }
  const f = setup({ extraOptions: { provider: {} } }); assert.equal(f.runtime.preferences, null); await f.runtime.close(); assert.equal(f.calls.create, 0);
  const invalidHandlerState = setup({ configure: f => { f.config.cookies.extra = 'unreviewed'; } });
  assert.equal(invalidHandlerState.runtime.handler, null); assert.equal(invalidHandlerState.runtime.preferences, null);
  assert.equal(invalidHandlerState.runtime.configuredForDisplay, false); await invalidHandlerState.runtime.close(); assert.equal(invalidHandlerState.calls.create, 0);
});

test('actual auth/signed HTTP → lazy restricted runtime → qualified service; only six methods and live role checks', async () => {
  const f = setup(); assert.equal(f.calls.create, 0); assert.equal(f.runtime.configuredForDisplay, true); assert.equal(f.calls.create, 0); assert(Object.isFrozen(f.runtime));
  assert.deepEqual(Object.keys(f.runtime.preferences), ['readAccess', 'readPreferences', 'readCard', 'setCollectionPreferences', 'setCardPreferences', 'recoverRequest']);
  assert.equal((await f.f.invoke()).code, 200); const saved = await f.f.invoke({ method: 'POST', body: input() });
  assert.equal(saved.code, 200); assert.equal(saved.value.outcome, 'RECORDED');
  const recovered = await f.f.invoke({ path: `/api/customer/collection/preference-requests/${input().requestId}` });
  assert.deepEqual(recovered.value.receipt, saved.value.receipt);
  const card = await f.f.invoke({ path: `/api/customer/collection/cards/${CID}/preferences` }); assert.equal(card.code, 200);
  assert.equal(f.calls.create, 1); assert(f.calls.transactions > 4); assert.equal(f.f.records.size, 1);
  assert.equal(new URL(f.calls.urls[0]).searchParams.get('schema'), 'atlas_ownership_preferences');
  f.f.unsafe = true; const invalid = await f.f.invoke(); assert.equal(invalid.code, 503); assert(!invalid.value.accountId);
  await f.runtime.close(); assert.equal(f.calls.disconnect, 1); assert.equal(f.runtime.configuredForDisplay, false);
});

test('missing cookie/CSRF/ingress refuses before client creation; role/owner or grant drift never reaches gateway', async () => {
  const f = setup(); for (const patch of [{ signed: false }, { headers: { cookie: '' } }, { headers: { 'x-atlas-customer-csrf': 'wrong' } }])
    assert.notEqual((await f.f.invoke({ method: 'POST', body: input(), ...patch })).code, 200);
  assert.equal(f.calls.create, 0); await f.runtime.close();
  for (const change of [g => { g.f.unsafe = true; }, g => { g.f.defs[0].owner = 'wrong_owner'; }, g => { g.f.defs[0].bodySha256 = 'f'.repeat(64); }]) {
    const g = setup(); change(g); assert.equal((await g.f.invoke()).code, 503); assert.equal(g.f.actions.length, 0); await g.runtime.close();
  }
});

test('observed SQL wait pins settings/config/auth/client methods inside transaction, so post-append rejection rolls back', async () => {
  const changes = [g => { g.options.settings.databaseUrl += '&changed=1'; }, g => { g.options.settings.schemaOwner = 'other_owner'; },
    g => { g.options.settings = { ...g.options.settings }; }, g => { g.options.createClient = () => assert.fail('replacement factory'); },
    g => { g.f.config.databaseUrl += '&changed=1'; }, g => { g.f.config.sessionKey[0] ^= 1; }, g => { g.f.auth.digest = () => assert.fail('replacement digest'); },
    g => { g.f.state.assertRequest = () => {}; }, g => { g.owned.$transaction = () => assert.fail('replacement transaction'); },
    g => { g.f.auth.database = {}; }, g => { g.f.auth.database.client = {}; }];
  for (const change of changes) {
    const g = setup(), entered = defer(), release = defer(); g.f.afterQuery = async action => { if (action === 'set_collection_preferences') { entered.resolve(); await release.promise; } };
    const pending = g.f.invoke({ method: 'POST', body: input() }); await entered.promise; assert.equal(g.f.records.size, 1);
    change(g); assert.equal(g.runtime.configuredForDisplay, false); release.resolve(); const response = await pending; assert.equal(response.code, 503); assert.equal(g.f.records.size, 0); assert(g.f.stats.rollbacks >= 1);
    assert.deepEqual(response.value, { error: 'PREFERENCES_UNAVAILABLE' }); await g.runtime.close(); assert.equal(g.calls.disconnect, 1);
  }
});

test('transaction method drift after an awaited query is refused before commit', async () => {
  const f = setup(), original = f.owned.$transaction; let txRef;
  f.owned.$transaction = async function (work, opts) { return Reflect.apply(original, f.owned, [async tx => { txRef = tx; return work(tx); }, opts]); };
  f.f.afterQuery = async action => { if (action === 'set_collection_preferences') txRef.$queryRawUnsafe = () => assert.fail('replaced SQL'); };
  const response = await f.f.invoke({ method: 'POST', body: input() }); assert.equal(response.code, 503); assert.equal(f.f.records.size, 0); await f.runtime.close();
});

test('post-commit runtime drift stays UNKNOWN; restoring exact capability permits original receipt recovery without new write', async () => {
  const f = setup(), controller = createCollectionPreferencesController({ session: f.f.session, request: f.f.request });
  await controller.load(); const original = f.options.settings.schemaOwner;
  f.f.afterCommit = async () => { if (f.f.records.size) { f.f.afterCommit = null; f.options.settings.schemaOwner = 'other_owner'; } };
  await controller.save({ requestId: input().requestId, visibility: 'PUBLIC', offersDisabled: true });
  assert.equal(controller.snapshot().phase, 'UNKNOWN'); assert.equal(f.f.records.size, 1);
  await assert.rejects(controller.save({ requestId: prefId(120), visibility: 'PRIVATE', offersDisabled: false }), { code: 'PREFERENCES_RECOVERY_REQUIRED' });
  f.options.settings.schemaOwner = original; await controller.recover(); assert.equal(controller.snapshot().phase, 'CONFIRMED'); assert.equal(f.f.records.size, 1);
  controller.dispose(); await f.runtime.close();
});

test('single-flight construction and explicit close drain observed requests; post-append work rolls back and late results are withheld', async () => {
  const entered = defer(), release = defer(), f = setup({ construct: async owned => { entered.resolve(); await release.promise; return owned; } });
  const first = f.runtime.preferences.readAccess(f.f.cookie), second = f.runtime.preferences.readPreferences(f.f.cookie); await entered.promise;
  assert.equal(f.calls.create, 1); release.resolve(); assert((await first).accountId); assert((await second).accountId);
  const written = defer(), resume = defer(); f.f.afterQuery = async action => { if (action === 'set_collection_preferences') { written.resolve(); await resume.promise; } };
  const pending = f.f.invoke({ method: 'POST', body: input() }); await written.promise;
  let closed = false; const closing = f.runtime.close(); assert.strictEqual(f.runtime.close(), closing); closing.then(() => { closed = true; });
  assert.equal(closed, false); assert.equal(f.calls.disconnect, 0); await assert.rejects(f.runtime.preferences.readAccess(f.f.cookie), { code: 'PREFERENCES_UNAVAILABLE' });
  resume.resolve(); assert.equal((await pending).code, 503); await closing; assert.equal(closed, true); assert.equal(f.f.records.size, 0); assert.equal(f.calls.disconnect, 1);
});

test('close during observed construction keeps disposal ownership and runs zero transactions', async () => {
  const entered = defer(), release = defer(), f = setup({ construct: async owned => { entered.resolve(); await release.promise; return owned; } });
  const pending = f.runtime.preferences.readAccess(f.f.cookie).then(value => ({ value }), error => ({ error })); await entered.promise;
  const closing = f.runtime.close(); release.resolve(); assert.equal((await pending).error.code, 'PREFERENCES_UNAVAILABLE'); await closing;
  assert.deepEqual([f.calls.create, f.calls.transactions, f.calls.disconnect], [1, 0, 1]);
});

test('request cancellation withholds buffered data; runtime drain owns completion rather than inventing database cancellation', async () => {
  const f = setup(), entered = defer(), release = defer(); f.f.beforeQuery = async action => { if (action === 'read_preferences') { entered.resolve(); await release.promise; } };
  const pending = f.f.invoke(); await entered.promise; f.f.lastRequest.emit('aborted'); release.resolve();
  const response = await pending; assert.equal(response.code, 503); assert(!response.value.accountId); await f.runtime.close(); assert.equal(f.calls.disconnect, 1);
});

test('failed construction is sticky; malformed newly owned clients dispose once; ordinary customer client is never used or disposed', async () => {
  const fail = setup({ construct: () => { throw Error('private credentials'); } });
  for (let i = 0; i < 2; i++) assert.equal((await fail.f.invoke()).code, 503); assert.equal(fail.calls.create, 1); await fail.runtime.close();
  for (const reject of [false, true]) {
    let disconnect = 0; const f = setup({ construct: () => ({ $transaction: null, $disconnect() { disconnect++; if (reject) throw Error('private close'); } }) });
    for (let i = 0; i < 2; i++) assert.equal((await f.f.invoke()).code, 503);
    if (reject) await assert.rejects(f.runtime.close(), { code: 'PREFERENCES_UNAVAILABLE' }); else await f.runtime.close();
    assert.equal(disconnect, 1); assert.equal(f.calls.transactions, 0);
  }
  const general = setup({ construct: (_owned, f) => f.auth.database.client }); assert.equal((await general.f.invoke()).code, 503); await general.runtime.close(); assert.equal(general.calls.transactions, 0);
});

test('a replaced disconnect is never invoked and disposal failure remains explicit', async () => {
  const f = setup(); assert.equal((await f.f.invoke()).code, 200); f.owned.$disconnect = () => assert.fail('replaced disconnect');
  assert.equal((await f.f.invoke()).code, 503); await assert.rejects(f.runtime.close(), { code: 'PREFERENCES_UNAVAILABLE' }); assert.equal(f.calls.disconnect, 0);
  const g = setup(); let disconnect = 0; g.owned.$disconnect = () => { disconnect++; throw Error('private disposal error'); };
  assert.equal((await g.f.invoke()).code, 200); await assert.rejects(g.runtime.close(), { code: 'PREFERENCES_UNAVAILABLE' }); assert.equal(disconnect, 1);
});
