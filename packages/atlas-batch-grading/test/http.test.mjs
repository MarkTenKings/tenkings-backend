import test from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_PATH, createBatchHandler } from '../src/http.mjs';
function fixture() {
  const calls = [], origin = 'https://atlasgrading.com', staff = { id: 'ordinary-staff-handle' };
  const handler = createBatchHandler({ origin, assertRequest: async () => calls.push('gateway'),
    boundary: { authenticate: async (cookie, csrf) => { calls.push({ cookie, csrf }); return staff; } },
    service: Object.fromEntries(['enqueue', 'list', 'resume', 'detail', 'approve'].map(method => [method, async (actor, input) => { assert.equal(actor, staff); calls.push(method); return { method, input }; }])) });
  const req = { method: 'POST', url: BATCH_PATH, headers: { origin, cookie: 'session', 'content-type': 'application/json', 'x-atlas-csrf': 'current' }, body: {} };
  const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
  return { calls, handler, req, res };
}
test('queue admission requires ordinary gateway, exact Origin and CSRF before service work', async () => {
  const f = fixture(); await f.handler(f.req, f.res);
  assert.equal(f.res.statusCode, 200); assert.deepEqual(f.calls, ['gateway', { cookie: 'session', csrf: 'current' }, 'enqueue']);
  assert.equal(f.res.headers['Cache-Control'], 'private, no-store');
});
test('cross-origin writes, missing CSRF, query parameters and oversized admission are refused', async () => {
  for (const change of [req => { req.headers.origin = 'https://other.invalid'; }, req => { delete req.headers['x-atlas-csrf']; },
    req => { req.url += '?authority=HUMAN'; }, req => { req.body = { long: 'x'.repeat(16384) }; }]) {
    const f = fixture(); change(f.req); await f.handler(f.req, f.res);
    assert.ok([400, 403, 413].includes(f.res.statusCode)); assert.deepEqual(f.calls, ['gateway']);
  }
});
test('read and exact resume use their own methods; unrelated manual routes are not intercepted', async () => {
  const f = fixture(); f.req.method = 'GET'; await f.handler(f.req, f.res); assert.equal(f.res.body.method, 'list');
  const g = fixture(); g.req.url += '/resume'; await g.handler(g.req, g.res); assert.equal(g.res.body.method, 'resume');
  const h = fixture(); h.req.url = '/api/staff/manual/cards/card-id'; assert.equal(await h.handler(h.req, h.res), false); assert.deepEqual(h.calls, []);
});

test('review reads cannot mutate and approval requires exact POST, current CSRF and bound job route', async () => {
  const key='a'.repeat(64), f=fixture(); f.req.url+=`/${key}`; f.req.method='GET';
  await f.handler(f.req,f.res); assert.equal(f.res.body.method,'detail'); assert.equal(f.res.body.input,key);
  const g=fixture(); g.req.url+=`/${key}/review`; await g.handler(g.req,g.res); assert.equal(g.res.body.method,'approve');
  for(const [suffix,method] of [[`/${key}`,'POST'],[`/${key}/review`,'GET'],[`/${key}/review`,'DELETE']]){
    const h=fixture(); h.req.url+=suffix; h.req.method=method; await h.handler(h.req,h.res); assert.equal(h.res.statusCode,405); assert.deepEqual(h.calls,['gateway']);
  }
});
