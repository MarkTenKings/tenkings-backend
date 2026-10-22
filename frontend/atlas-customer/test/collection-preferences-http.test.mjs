import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionPreferencesHandler, parseCollectionPreferenceRequest } from '../lib/server/collection-preferences-http.mjs';
import { createPreferenceFixture, prefId, AID, OTHER, CID, defer } from './collection-preferences-fixture.mjs';
const write = (patch = {}) => ({ requestId: prefId(40), expectedPreferenceRevision: 0, visibility: 'PRIVATE', offersDisabled: true, ...patch });
const path = '/api/customer/collection/preferences';

test('default absent, inert actual auth/service composition; strict three read/two write dispatch only', async () => {
  assert.equal(createCollectionPreferencesHandler(), null);
  const f = createPreferenceFixture(); assert.equal(f.stats.begins, 0);
  const r = await f.invoke(); assert.equal(r.code, 200); assert.equal(r.value.collectionPreferences.visibility, 'PRIVATE'); assert.equal(r.value.effective.preference, 'OPEN_TO_OFFERS');
  assert.equal(r.value.effective.canReceiveOffers, false); assert.equal(r.value.effective.notificationDelivery, 'NOT_REQUESTED');
  assert.match(r.headers['cache-control'], /private, no-store/); assert.equal(r.headers['vercel-cdn-cache-control'], 'no-store'); assert.equal(r.headers['set-cookie'], undefined);
  const input = write(), receipt = await f.invoke({ method: 'POST', body: input }); assert.equal(receipt.code, 200); assert.deepEqual(receipt.value.receipt.input, input);
  const recovered = await f.invoke({ path: `/api/customer/collection/preference-requests/${input.requestId}` }); assert.deepEqual(recovered.value.receipt, receipt.value.receipt);
  const card = await f.invoke({ path: `/api/customer/collection/cards/${CID}/preferences` }); assert.equal(card.value.cardPreferences.revision, 0);
  const saved = await f.invoke({ method: 'POST', path: `/api/customer/collection/cards/${CID}/preferences`, body: write({ requestId: prefId(41), cardId: CID, expectedOwnershipRevision: 2 }) }); assert.equal(saved.code, 200);
  assert(f.actions.every(v => ['read_access', 'read_preferences', 'read_card', 'recover_request', 'set_collection_preferences', 'set_card_preferences'].includes(v.action)));
});
test('actual signed ingress/cookie/CSRF and exact route/framing refuse before transaction', async () => {
  for (const patch of [{ signed: false }, { headers: { 'x-atlas-route-proof': '0'.repeat(64) } }, { headers: { 'x-forwarded-host': 'other.invalid' } },
    { headers: { cookie: '' } }, { headers: { 'x-atlas-customer-csrf': 'wrong' } }, { headers: { authorization: 'Bearer wrong' } },
    { headers: { origin: 'https://other.invalid' } }, { headers: { 'sec-fetch-site': 'cross-site' } }, { headers: { 'content-type': 'text/plain' } },
    { headers: { 'content-encoding': 'gzip' } }, { headers: { 'transfer-encoding': 'chunked' } }, { headers: { 'content-length': '4097' } }]) {
    const f = createPreferenceFixture(), r = await f.invoke({ method: 'POST', body: write(), ...patch }); assert(r.code >= 400); assert.equal(f.stats.begins, 0);
  }
  for (const url of [path + '?accountId=' + AID, path + '#x', path.replace('preferences', '%70references'), '/api/customer/ownership/submit', '/api/customer/collection/claims', '/api/customer/collection/preferences/extra'])
    assert.throws(() => parseCollectionPreferenceRequest({ method: 'GET', url }));
  for (const body of [{ ...write(), accountId: AID }, { ...write(), action: 'propose_transfer' }, { ...write(), offersDisabled: 'false' }])
    assert.throws(() => parseCollectionPreferenceRequest({ method: 'POST', url: path, body }));
  const getter = {}; Object.defineProperty(getter, 'requestId', { enumerable: true, get() { assert.fail('getter'); } });
  assert.throws(() => parseCollectionPreferenceRequest({ method: 'POST', url: path, body: getter }));
  for (const body of [undefined, null, '', {}]) assert.equal((await createPreferenceFixture().invoke({ body })).code, 200);
});
test('independent live account and trusted capabilities refuse forged/private payloads and loss after committed write', async () => {
  const f = createPreferenceFixture(); f.capabilities.readPreferences = async () => ({ accountId: OTHER, privateKey: 'secret' });
  const h = createCollectionPreferencesHandler(f.options); f.handler = h; // Invoke direct to keep constructor-captured replacement deliberate.
  const r = await f.invoke(); assert.equal(r.code, 503); assert.deepEqual(r.value, { error: 'PREFERENCES_UNAVAILABLE' });
  const g = createPreferenceFixture(); g.afterHTTP = null;
  g.afterCommit = async () => { if (g.records.size) { g.afterCommit = null; g.liveAccount = null; } };
  const lost = await g.invoke({ method: 'POST', body: write() }); assert.equal(lost.code, 401); assert.equal(g.records.size, 1);
  assert.deepEqual(Object.keys(lost.value), ['error']); assert.doesNotMatch(JSON.stringify(lost.value), /CONFIRMED|RECORDED|rollback/);
});
test('observed awaited read fences original ingress/body/auth/capability before buffered disclosure', async () => {
  for (const mutate of [f => { f.lastRequest.headers['x-forwarded-host'] = 'other.invalid'; }, f => { f.lastRequest.body = { accountId: OTHER }; },
    f => { f.config.sessionKey[0] ^= 1; }, f => { f.auth.digest = () => ''; }, f => { f.state.assertRequest = () => {}; },
    f => { f.capabilities.readPreferences = async () => ({}); }, f => { f.options.preferences = {}; }]) {
    const f = createPreferenceFixture(), entered = defer(), wait = defer(); f.beforeQuery = async action => { if (action === 'read_preferences') { entered.resolve(); await wait.promise; } };
    const pending = f.invoke(); await entered.promise; mutate(f); wait.resolve(); const r = await pending;
    assert(r.code >= 400); assert.doesNotMatch(JSON.stringify(r.value), new RegExp(AID)); assert(!r.value.collectionPreferences);
  }
});
test('final readAccess await is fenced too; invalid async/predicate guards never admit', async () => {
  const f = createPreferenceFixture(), original = f.capabilities.readAccess, wait = defer(), entered = defer(); let count = 0;
  f.capabilities.readAccess = async (...args) => { const value = await original(...args); if (++count === 2) { entered.resolve(); await wait.promise; } return value; };
  const handler = createCollectionPreferencesHandler(f.options), req = { method: 'GET', url: path, body: '', headers: { cookie: f.cookie } };
  f.state.assertRequest = () => {}; const options = { customerState: f.state, preferences: f.capabilities }, guarded = createCollectionPreferencesHandler(options);
  const res = { headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.code=n; return this; }, json(v) { this.value=v; } };
  const pending = guarded(req,res); await entered.promise; req.headers['sec-fetch-site'] = 'cross-site'; wait.resolve(); await pending; assert.equal(res.code,503); assert(!res.value.accountId); assert(handler);
  for (const guard of [() => true, async () => undefined]) {
    const g = createPreferenceFixture(); g.state.assertRequest = guard; const h = createCollectionPreferencesHandler(g.options), r = { setHeader() {}, status(n) { this.code=n; return this; }, json() {} };
    await h({ method: 'GET', url: path, headers: { cookie: g.cookie } },r); assert.equal(r.code,503); assert.equal(g.stats.begins,0);
  }
});
