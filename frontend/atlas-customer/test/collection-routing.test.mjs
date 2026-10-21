import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/server/http.mjs';
import { createCollectionPreviewFixture } from './collection-preview-fixture.mjs';

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(value) { this.code = value; return this; }, json(value) { this.value = value; return this; } };
}

test('integrated collection GET reaches only the restricted reader through existing ingress guards', async () => {
  const fixture = createCollectionPreviewFixture(), calls = [];
  const handler = createHandler({ config: { origin: 'https://atlasgrading.com' },
    assertRequest(req) { assert.equal(req.headers['x-fixture-hop'], 'accepted'); }, clientAddress: () => 'fixture',
    auth: { authority(cookie) { assert.equal(cookie, 'fixture-cookie'); }, call() { assert.fail('Combined writer called'); } },
    ownershipRead: { async read(cookie, action, input) { calls.push({ cookie, action, input }); return fixture.snapshot; } } });
  for (const body of [undefined, '', {}]) {
    const res = response();
    await handler({ method: 'GET', url: '/api/customer/collection?limit=25', body,
      headers: { cookie: 'fixture-cookie', 'x-fixture-hop': 'accepted', 'sec-fetch-site': 'same-origin' } }, res);
    assert.equal(res.code, 200); assert.equal(res.value.accountId, fixture.accountId);
    assert.match(res.headers['cache-control'], /no-store/);
  }
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], { cookie: 'fixture-cookie', action: 'read_collection', input: { limit: 25, afterCardId: null } });
});

test('integrated collection rejects mutations and cross-site reads; absent reader is unavailable, never empty', async () => {
  let reads = 0;
  const state = { config: { origin: 'https://atlasgrading.com' }, assertRequest() {}, clientAddress: () => 'fixture',
    auth: { authority() {}, call() { assert.fail('Combined writer called'); } },
    ownershipRead: { read() { reads++; assert.fail('Rejected read reached service'); } } };
  for (const [method, headers, expected] of [['POST', {}, 405], ['GET', { 'sec-fetch-site': 'cross-site' }, 403]]) {
    const res = response(); await createHandler(state)({ method, url: '/api/customer/collection', headers }, res);
    assert.equal(res.code, expected);
  }
  const res = response();
  await createHandler({ ...state, ownershipRead: undefined })({ method: 'GET', url: '/api/customer/collection', headers: {} }, res);
  assert.equal(res.code, 503); assert.deepEqual(res.value, { error: 'COLLECTION_UNAVAILABLE' }); assert.equal(reads, 0);
});
