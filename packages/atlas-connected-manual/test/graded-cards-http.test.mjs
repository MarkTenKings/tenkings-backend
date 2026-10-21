import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnectedHandler } from '../src/http.mjs';
import { createManualServiceProxy, isManualServicePath, manualResponsePolicy } from '../src/transport.mjs';
import { createPrivateManualServer } from '../scripts/private-server.mjs';
const origin = 'https://atlasgrading.com', base = '/api/staff/manual-connected/graded-cards';
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, send(body) { this.body = body; }, end(body) { this.body = body; } });
function fixture() {
  const actor = {}, calls = [], connected = { intake: {}, workflow: {}, gradedCards: { async list(staff, input) { assert.equal(staff, actor); calls.push(input); return { schemaVersion: 1, cards: [], nextCursor: null }; } } };
  const boundary = { async authenticate(cookie, csrf) { assert.equal(csrf, undefined); if (cookie !== 'staff') throw Object.assign(Error(), { status: 401, code: 'SIGN_IN_REQUIRED' }); return actor; } };
  return { calls, connected, boundary, handler: createConnectedHandler({ connected, boundary, origin, assertRequest: async () => {} }) };
}
test('strict authenticated archive GET rejects unknown/duplicate/malformed filters and mutations', async () => {
  const f = fixture(), result = response();
  await f.handler({ method: 'GET', url: `${base}?q=Jordan+%25&from=2026-10-01&limit=24`, headers: { cookie: 'staff' } }, result);
  assert.equal(result.statusCode, 200); assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(f.calls, [{ q: 'Jordan %', from: '2026-10-01', limit: '24' }]);
  for (const suffix of ['?q=a&q=b', '?accountId=any', '?category=ALL', '?from=2026-02-30', '?limit=51', '?cursor=invalid']) {
    const bad = response(); await f.handler({ method: 'GET', url: base + suffix, headers: { cookie: 'staff' } }, bad); assert.equal(bad.statusCode, 400);
  }
  const write = response(); await f.handler({ method: 'POST', url: base, headers: { cookie: 'staff' } }, write); assert.equal(write.statusCode, 405);
  const anonymous = response(); await f.handler({ method: 'GET', url: base, headers: {} }, anonymous); assert.equal(anonymous.statusCode, 401);
  assert.equal(f.calls.length, 1);
});
test('transport admits only exact read route/valid query and keeps raster/SVG/private paths excluded', () => {
  for (const path of [base, `${base}?q=Mewtwo+%26+friends&category=POKEMON&to=2026-10-20&limit=50`]) assert.equal(isManualServicePath(path), true);
  for (const path of [base + '/all', base + '/delete', base + '?q=a&q=b', base + '?limit=999', base + '?q=%', base + '?accountId=x', '/api/customer/graded-cards']) assert.equal(isManualServicePath(path), false, path);
  for (const type of ['image/png', 'image/svg+xml', 'application/pdf']) assert.throws(() => manualResponsePolicy(base, type));
});
test('real signed proxy and private HTTP server preserve archive query and ordinary authentication', async () => {
  const f = fixture(), key = 'synthetic-key-'.repeat(4), server = createPrivateManualServer({ connected: f.connected, boundary: f.boundary, origin, key });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const host = `http://127.0.0.1:${server.address().port}`;
    const proxy = createManualServiceProxy({ origin: 'https://private.invalid', key, fetchImpl: (url, init) => { const target = new URL(url); return fetch(host + target.pathname + target.search, init); } });
    const res = response(); await proxy({ method: 'GET', url: `${base}?q=100%25_Jordan&category=SPORTS`, headers: { cookie: 'staff' } }, res);
    assert.equal(res.statusCode, 200); assert.deepEqual(JSON.parse(Buffer.from(res.body).toString()), { schemaVersion: 1, cards: [], nextCursor: null });
    assert.deepEqual(f.calls, [{ q: '100%_Jordan', category: 'SPORTS' }]);
    const denied = response(); await proxy({ method: 'GET', url: base, headers: {} }, denied); assert.equal(denied.statusCode, 401); assert.equal(f.calls.length, 1);
    const unsigned = await fetch(host + base); assert.equal(unsigned.status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
