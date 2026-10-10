import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createConnectedHandler } from '../src/http.mjs';
import { isManualServicePath, manualResponsePolicy } from '../src/transport.mjs';

const origin = 'https://atlasgrading.com', base = '/api/staff/manual-connected/order-desk';
function fixture() {
  const actor = {}, orderId = randomUUID(), cardId = randomUUID(), requestId = randomUUID(), calls = [];
  const connected = { workflow: {}, intake: {}, orderDesk: {
    async list(staff, input) { assert.equal(staff, actor); calls.push({ action: 'list', input }); return { schemaVersion: 1, orders: [] }; },
    async detail(staff, input) { assert.equal(staff, actor); calls.push({ action: 'detail', input }); return { schemaVersion: 1, order: {} }; },
    async photo(staff, input) { assert.equal(staff, actor); calls.push({ action: 'photo', input }); return { bytes: Buffer.from('image-fixture'), contentType: 'image/jpeg' }; },
  }, orderDeskInbox: { async acknowledge(staff, input) { assert.equal(staff, actor); calls.push({ action: 'acknowledge', input }); return { orderId, outcome: 'ACKNOWLEDGED' }; } } };
  const handler = createConnectedHandler({ connected, origin, assertRequest: async () => {}, boundary: {
    async authenticate(cookie, csrf) { assert.equal(cookie, 'fixture'); calls.push({ auth: true, csrf }); return actor; },
  } });
  const request = (url = base, method = 'GET', body) => ({ url, method, body, headers: { origin, cookie: 'fixture', 'content-type': 'application/json', 'x-atlas-csrf': 'csrf-fixture' } });
  const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; }, send(value) { this.body = value; } });
  return { actor, orderId, cardId, requestId, calls, connected, handler, request, response };
}
test('order desk uses authenticated GET reads with bounded server query and private response', async () => {
  const f = fixture(), res = f.response();
  await f.handler(f.request(`${base}?q=Maye&view=new&limit=25`), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(f.calls, [{ auth: true, csrf: undefined }, { action: 'list', input: { q: 'Maye', view: 'new', limit: 25 } }]);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  f.calls.length = 0;
  await f.handler(f.request(`${base}/orders/${f.orderId}`), f.response());
  assert.deepEqual(f.calls.at(-1), { action: 'detail', input: { orderId: f.orderId } });
});
test('explicit acknowledgment forwards only bound order/request and authenticated CSRF actor', async () => {
  const f = fixture(), res = f.response();
  await f.handler(f.request(`${base}/orders/${f.orderId}/acknowledge`, 'POST', { requestId: f.requestId }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(f.calls, [{ auth: true, csrf: 'csrf-fixture' }, { action: 'acknowledge', input: { orderId: f.orderId, requestId: f.requestId } }]);
});
test('ambiguous query, invalid method, forged actor and missing CSRF never reach service', async () => {
  for (const change of [
    (f, r) => { r.url += '?q=a&q=b'; },
    (f, r) => { r.url += '?accountId=' + f.orderId; },
    (f, r) => { r.url += '?limit=101'; },
    (f, r) => { r.method = 'DELETE'; },
    (f, r) => { r.url += `/orders/${f.orderId}?size=detail`; },
    (f, r) => { r.url += `/orders/${f.orderId}/acknowledge`; r.method = 'POST'; r.body = { requestId: f.requestId, actorId: f.actor }; },
    (f, r) => { r.url += `/orders/${f.orderId}/acknowledge`; r.method = 'POST'; r.body = { requestId: f.requestId }; delete r.headers['x-atlas-csrf']; },
    (f, r) => { r.url += `/orders/${f.orderId}/acknowledge`; r.method = 'POST'; r.body = { requestId: f.requestId }; r.headers.origin = 'https://foreign.invalid'; },
  ]) {
    const f = fixture(), req = f.request(), res = f.response(); change(f, req);
    await f.handler(req, res);
    assert.ok([400, 403, 405].includes(res.statusCode)); assert.deepEqual(f.calls, []);
  }
});
test('photo route binds card/order/side/size and permits only bounded raster responses', async () => {
  const f = fixture(), path = `${base}/orders/${f.orderId}/cards/${f.cardId}/photos/BACK?size=detail`, res = f.response();
  await f.handler(f.request(path), res);
  assert.equal(res.statusCode, 200); assert.equal(res.headers['Content-Type'], 'image/jpeg');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.deepEqual(f.calls.at(-1), { action: 'photo', input: { orderId: f.orderId, cardId: f.cardId, side: 'BACK', size: 'detail' } });
  assert.equal(isManualServicePath(path), true); assert.equal(manualResponsePolicy(path, 'image/jpeg').limit, 4 * 1024 * 1024);
  for (const contentType of ['text/html', 'image/svg+xml', 'application/pdf']) assert.throws(() => manualResponsePolicy(path, contentType));
  assert.throws(() => manualResponsePolicy(base, 'image/jpeg'));
  f.connected.orderDesk.photo = async () => ({ bytes: Buffer.alloc(4 * 1024 * 1024 + 1), contentType: 'image/jpeg' });
  const rejected = f.response(); await f.handler(f.request(path), rejected); assert.equal(rejected.statusCode, 503);
});
test('transport permits only exact order desk routes, preserving existing path normalization guard', () => {
  const f = fixture();
  for (const path of [base, `${base}?view=new`, `${base}/orders/${f.orderId}`, `${base}/orders/${f.orderId}/acknowledge`]) assert.equal(isManualServicePath(path), true);
  for (const path of [`${base}/orders/${f.orderId}/delete`, `${base}/orders/../${f.orderId}`, `${base}/orders/${f.orderId}%2fcards`, `${base}/all`, `${base}/orders/${f.orderId}/cards/${f.cardId}/photos/ANY`]) assert.equal(isManualServicePath(path), false);
});
