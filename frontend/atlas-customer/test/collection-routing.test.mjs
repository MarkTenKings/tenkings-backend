import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { makeConfig } from '../lib/server/config.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { createCollectionPreviewFixture } from './collection-preview-fixture.mjs';

const cookie = `collection_browser=${Buffer.alloc(32,1).toString('base64url')}; collection_session=${Buffer.alloc(32,2).toString('base64url')}`;
function trustedState() {
  const config = makeConfig({mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'collection-fixture',releaseSha:'0'.repeat(40),
    accountSid:'AC'+'0'.repeat(32),serviceSid:'VA'+'0'.repeat(32),sessionKey:Buffer.alloc(32,7),phoneKey:Buffer.alloc(32,8),
    cookies:{browser:'collection_browser',session:'collection_session'}});
  return {config,auth:new CustomerAuth({config,database:{call(){assert.fail('Combined writer called');}}}),clientAddress:()=> 'fixture'};
}
function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(value) { this.code = value; return this; }, json(value) { this.value = value; return this; } };
}

test('integrated collection GET reaches only the restricted reader through existing ingress guards', async () => {
  const fixture = createCollectionPreviewFixture(), calls = [];
  let admissions = 0;
  const handler = createHandler({ ...trustedState(),
    assertRequest(req) { admissions++; assert.equal(req.headers['x-fixture-hop'], 'accepted'); },
    ownershipRead: { async read(cookie, action, input) { calls.push({ cookie, action, input }); return fixture.snapshot; } } });
  for (const body of [undefined, '', {}]) {
    const res = response();
    await handler({ method: 'GET', url: '/api/customer/collection?limit=25', body,
      headers: { cookie, 'x-fixture-hop': 'accepted', 'sec-fetch-site': 'same-origin' } }, res);
    assert.equal(res.code, 200); assert.equal(res.value.accountId, fixture.accountId);
    assert.match(res.headers['cache-control'], /no-store/);
  }
  assert.equal(calls.length, 3); assert.equal(admissions, 3);
  assert.deepEqual(calls[0], { cookie, action: 'read_collection', input: { limit: 25, afterCardId: null } });
});

test('integrated collection rejects mutations and cross-site reads; absent reader is unavailable, never empty', async () => {
  let reads = 0;
  const state = { ...trustedState(), assertRequest() {},
    ownershipRead: { read() { reads++; assert.fail('Rejected read reached service'); } } };
  for (const [method, headers, expected] of [['POST', {}, 405], ['GET', { 'sec-fetch-site': 'cross-site' }, 403]]) {
    const res = response(); await createHandler(state)({ method, url: '/api/customer/collection', headers }, res);
    assert.equal(res.code, expected);
  }
  const res = response();
  await createHandler({ ...state, ownershipRead: undefined })({ method: 'GET', url: '/api/customer/collection', headers: {cookie} }, res);
  assert.equal(res.code, 503); assert.deepEqual(res.value, { error: 'COLLECTION_UNAVAILABLE' }); assert.equal(reads, 0);
});
