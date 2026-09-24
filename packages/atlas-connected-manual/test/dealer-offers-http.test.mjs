import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createConnectedHandler } from '../src/http.mjs';
const origin = 'https://atlasgrading.com';
function fixture() {
  const calls = [], staff = {}, cardId = randomUUID(), connected = { workflow: {}, intake: {}, dealerOffers: {
    async status(actor, card) { assert.equal(actor, staff); assert.equal(card, cardId); calls.push('read'); return { offers: [] }; },
    async select(actor, card, body) { assert.equal(actor, staff); assert.equal(card, cardId); calls.push(body); return { revision: 1 }; },
  } };
  const handler = createConnectedHandler({ connected, origin, assertRequest: async () => {}, boundary: {
    async authenticate(cookie, csrf) { assert.equal(cookie, 'fixture-cookie'); calls.push({ csrf }); return staff; },
  } });
  const req = { url: `/api/staff/manual-connected/cards/${cardId}/presentation/dealer-offers`, method: 'POST', body: { synthetic: true },
    headers: { origin, cookie: 'fixture-cookie', 'x-atlas-csrf': 'fixture-csrf', 'content-type': 'application/json' } };
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  return { handler, calls, req, res };
}
test('dealer reads and selections require ordinary authenticated card scope and return no-store', async () => {
  const f = fixture(); await f.handler(f.req, f.res); assert.equal(f.res.statusCode, 200); assert.deepEqual(f.calls, [{ csrf: 'fixture-csrf' }, f.req.body]);
  assert.equal(f.res.headers['Cache-Control'], 'private, no-store');
  const g = fixture(); g.req.method = 'GET'; await g.handler(g.req, g.res); assert.deepEqual(g.calls, [{ csrf: undefined }, 'read']);
});
test('cross-origin, missing CSRF, wrong method, query overrides and excess bodies cannot reach dealer selection', async () => {
  for (const mutate of [req => { req.headers.origin = 'https://other.invalid'; }, req => { delete req.headers['x-atlas-csrf']; },
    req => { req.headers['content-type'] = 'text/plain'; }, req => { req.method = 'DELETE'; }, req => { req.url += '?dealer=untrusted'; },
    req => { req.body = { oversized: 'x'.repeat(65536) }; }]) {
    const f = fixture(); mutate(f.req); await f.handler(f.req, f.res); assert.ok([403, 405, 413].includes(f.res.statusCode)); assert.deepEqual(f.calls, []);
  }
});
