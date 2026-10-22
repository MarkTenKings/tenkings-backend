import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { makeConfig } from '../lib/server/config.mjs';
import { createOwnershipReadHandler, parseOwnershipCollectionQuery } from '../lib/server/ownership-read.mjs';
import { createCollectionPreviewFixture } from './collection-preview-fixture.mjs';

function setup(reader) {
  const fixture = createCollectionPreviewFixture(), calls = [];
  const config = makeConfig({ mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', deploymentId: 'collection-fixture', releaseSha: '0'.repeat(40),
    accountSid: 'AC'+'0'.repeat(32), serviceSid: 'VA'+'0'.repeat(32), phoneKey: Buffer.alloc(32, 8),
    cookies: { browser: 'customer_browser', session: 'customer_session' }, sessionKey: Buffer.alloc(32, 7) });
  const auth = new CustomerAuth({ config, database: { call() { assert.fail('Existing customer gateway must not be used'); } } });
  const cookie = `customer_browser=${Buffer.alloc(32, 1).toString('base64url')}; customer_session=${Buffer.alloc(32, 2).toString('base64url')}`;
  const state = { auth, config, assertRequest() {}, ownershipRead: reader ?? { read: async (...args) => { calls.push(args); return fixture.snapshot; }, call() { assert.fail('Writer called'); } } };
  const handler = createOwnershipReadHandler(state);
  return { fixture, calls, state, async run(change = {}) {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', url: '/api/customer/collection', headers: { cookie }, body: '', ...change }, res);
    assert.match(res.headers['Cache-Control'], /private, no-store/);
    assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store');
    return res;
  } };
}

test('read handler uses existing customer cookies and only the separately injected read operation', async () => {
  const f = setup(), r = await f.run();
  assert.equal(r.statusCode, 200); assert.equal(r.body.accountId, f.fixture.accountId);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1], 'read_collection');
  assert.deepEqual(f.calls[0][2], { afterCardId: null, limit: 25 }); assert.equal(f.calls[0].length, 3);
  assert.equal(r.headers['Set-Cookie'], undefined);
});

test('Next empty GET body representations work, but payloads and framing are rejected', async () => {
  const f = setup();
  for (const body of [undefined, null, '', {}]) assert.equal((await f.run({ body })).statusCode, 200);
  for (const body of [' ', 'payload', [], { accountId: f.fixture.accountId }]) assert.equal((await f.run({ body })).statusCode, 400);
  for (const headers of [{ 'content-length': '2' }, { 'transfer-encoding': 'chunked' }]) assert.equal((await f.run({ headers, body: {} })).statusCode, 400);
});

test('query grammar denies account selectors, duplicate/encoded keys and noncanonical cursors or limits', async () => {
  const f = setup(), id = f.fixture.snapshot.cards[0].cardId;
  assert.deepEqual(parseOwnershipCollectionQuery(`/api/customer/collection?afterCardId=${id}&limit=50`), { afterCardId: id, limit: 50 });
  for (const query of ['?', '?limit=0', '?limit=51', '?limit=01', '?limit=1&limit=2', '?limit=1&', '?%6cimit=2',
    '?accountId='+f.fixture.accountId, '?action=set_collection_preferences', '?afterCardId=', '?afterCardId=../private', '?limit=1#fragment']) {
    assert.equal((await f.run({ url: '/api/customer/collection'+query })).statusCode, 400, query);
  }
  assert.equal(f.calls.length, 0);
});

test('unconfigured or combined writer service is unavailable, never an empty collection', async () => {
  for (const reader of [undefined, { call() { assert.fail('Combined writer invoked'); } }]) {
    const f = setup(); f.state.ownershipRead = reader;
    const r = await f.run(); assert.equal(r.statusCode, 503); assert.deepEqual(r.body, { error: 'COLLECTION_UNAVAILABLE' });
  }
  const f = setup(); f.fixture.snapshot.cards = [];
  const r = await f.run(); assert.equal(r.statusCode, 200); assert.deepEqual(r.body.cards, []);
});

test('method, gateway, cross-site and customer authentication failures perform no reader operation', async () => {
  const f = setup();
  assert.equal((await f.run({ method: 'POST', body: {} })).statusCode, 405);
  assert.equal((await f.run({ headers: {} })).statusCode, 401);
  assert.equal((await f.run({ headers: { 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
  assert.equal((await f.run({ url: '/api/customer/collection/claim' })).statusCode, 404);
  f.state.assertRequest = () => { throw Error('PRIVATE GATEWAY DETAILS'); };
  assert.equal((await f.run()).statusCode, 503); assert.equal(f.calls.length, 0);
});

test('invalid ownership or cursor responses and internal errors fail closed without private exception text', async () => {
  for (const mutate of [v => v.cards[0].ownership.ownerAccountId = v.cards[1].cardId,
    v => v.nextCardId = v.cards[0].cardId, v => v.cards.reverse(), v => v.cards[0].approvedCard.report.publicHash = 'wrong']) {
    const f = setup(); mutate(f.fixture.snapshot);
    const r = await f.run(); assert.equal(r.statusCode, 503); assert.deepEqual(r.body, { error: 'COLLECTION_UNAVAILABLE' });
  }
  const f = setup({ read() { throw Error('PRIVATE SQL/COOKIE'); } });
  assert.deepEqual((await f.run()).body, { error: 'COLLECTION_UNAVAILABLE' });
});

test('captured reader method cannot change during an observed awaited read', async () => {
  let entered, release;
  const observed = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const f = setup(); let admissions = 0;
  f.state.assertRequest = () => { admissions++; };
  const reader = f.state.ownershipRead;
  reader.read = async () => { entered(); await held; return f.fixture.snapshot; };
  const pending = f.run(); await observed;
  reader.read = () => assert.fail('Replaced reader was called');
  release(); const response = await pending;
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { error: 'COLLECTION_UNAVAILABLE' });
  assert.equal(admissions, 1);
});
