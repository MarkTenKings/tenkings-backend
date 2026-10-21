import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createConnectedHandler } from '../src/http.mjs';
import { createManualServiceProxy, isManualServicePath, manualResponsePolicy } from '../src/transport.mjs';
import { createPrivateManualServer } from '../scripts/private-server.mjs';

const origin = 'https://atlasgrading.com', cardId = randomUUID(), path = `/api/staff/manual-connected/cards/${cardId}/provenance`;
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, send(body) { this.body = body; }, end(body) { this.body = body; } });
function fixture() {
  const actor = {}, calls = [], connected = { intake: {}, workflow: {}, cardProvenance: { async read(staff, id, input) { assert.equal(staff, actor); calls.push({ id, input }); return { schemaVersion: 1, ownership: { status: 'UNKNOWN' } }; } } };
  const boundary = { async authenticate(cookie, csrf) { assert.equal(csrf, undefined); if (cookie !== 'staff') throw Object.assign(Error(), { status: 401, code: 'SIGN_IN_REQUIRED' }); return actor; } };
  return { connected, boundary, calls, handler: createConnectedHandler({ connected, boundary, origin, assertRequest: async () => {} }) };
}

test('provenance GET authenticates the original session, rejects malformed cursors and never offers ownership writes', async () => {
  const f = fixture(), result = response();
  await f.handler({ method: 'GET', url: path + '?limit=20', headers: { cookie: 'staff' } }, result);
  assert.equal(result.statusCode, 200); assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(f.calls, [{ id: cardId, input: { limit: '20' } }]);
  for (const suffix of ['?accountId=x', '?limit=1&limit=2', '?cursor=invalid', '?claim=owner', '?limit=101']) {
    const bad = response(); await f.handler({ method: 'GET', url: path + suffix, headers: { cookie: 'staff' } }, bad); assert.equal(bad.statusCode, 400);
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const bad = response(); await f.handler({ method, url: path, headers: { cookie: 'staff' }, body: { ownerId: randomUUID() } }, bad); assert.equal(bad.statusCode, 405);
  }
  const denied = response(); await f.handler({ method: 'GET', url: path, headers: {} }, denied); assert.equal(denied.statusCode, 401);
  assert.equal(f.calls.length, 1);
});

test('signed transport admits only exact provenance route and read query, without alternate media/claims', () => {
  assert.equal(isManualServicePath(path), true); assert.equal(isManualServicePath(path + '?limit=100'), true);
  for (const bad of [path + '/claim', path + '/transfer', path + '?ownerId=x', path + '?limit=2&limit=1', path.replace(cardId, 'not-a-card'), path + '?cursor=%'])
    assert.equal(isManualServicePath(bad), false, bad);
  for (const type of ['image/png', 'image/svg+xml', 'application/pdf']) assert.throws(() => manualResponsePolicy(path, type));
});

test('actual signed proxy/private HTTP route preserves card identity and refuses writes before transport dispatch', async () => {
  const f = fixture(), key = 'synthetic-private-key-'.repeat(3), server = createPrivateManualServer({ connected: f.connected, boundary: f.boundary, origin, key });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); let dispatches = 0;
  try {
    const host = `http://127.0.0.1:${server.address().port}`;
    const proxy = createManualServiceProxy({ origin: 'https://private.invalid', key, fetchImpl: (url, init) => { dispatches++; const parsed = new URL(url); return fetch(host + parsed.pathname + parsed.search, init); } });
    const result = response(); await proxy({ method: 'GET', url: path + '?limit=1', headers: { cookie: 'staff' } }, result);
    assert.equal(result.statusCode, 200); assert.equal(JSON.parse(Buffer.from(result.body).toString()).ownership.status, 'UNKNOWN');
    assert.deepEqual(f.calls, [{ id: cardId, input: { limit: '1' } }]);
    const write = response(); await proxy({ method: 'POST', url: path, headers: { cookie: 'staff', origin, 'content-type': 'application/json', 'x-atlas-csrf': 'fixture' }, body: {} }, write);
    assert.equal(write.statusCode, 405); assert.equal(dispatches, 1); assert.equal(f.calls.length, 1);
    assert.equal((await fetch(host + path)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
