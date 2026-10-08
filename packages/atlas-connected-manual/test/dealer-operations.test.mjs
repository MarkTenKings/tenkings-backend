import test from 'node:test';
import assert from 'node:assert/strict';
import { createDealerStaffService, dealerStaffGrantSQL } from '../src/dealer-operations.mjs';
import { createConnectedHandler } from '../src/http.mjs';

test('dealer staff service binds original unforgeable staff handle and propagates SQL denial', async () => {
  const staff = { id: 'fixture-reviewer' }, actors = new WeakMap([[staff, { sessionHash: 'session', browserHash: 'browser' }]]);
  let called = 0;
  const service = createDealerStaffService({ auth: { actors, config: { mode: 'LOCAL_FIXTURE', origin: 'https://atlasgrading.com', phoneByHash: new Map([['phone', '+12025550100']]) } },
    boundary: { transaction: async (value, fn) => { assert.equal(value, staff); return fn({ principal: { role: 'REVIEWER' }, tx: { $queryRawUnsafe: async (sql, ...args) => {
      called++; assert.equal(args[1], 'session'); assert.equal(args[2], 'browser'); assert.deepEqual(args[4], ['phone']);
      return [{ result: { error: { status: 403, code: 'FRESH_HUMAN_OPERATIONS_REQUIRED' } } }];
    } } }); } } });
  await assert.rejects(service.call({ ...staff }, 'read', {}), { code: 'SIGN_IN_REQUIRED' });
  await assert.rejects(service.call(staff, 'location_configure', {}), { code: 'FRESH_HUMAN_OPERATIONS_REQUIRED' });
  assert.equal(called, 1); assert.doesNotMatch(dealerStaffGrantSQL('atlas_manual_fixture'), /ON ALL|GRANT SELECT|atlas_customer/);
});
test('dealer custody HTTP requires private admission, original cookie and CSRF before dispatch', async () => {
  let calls = 0; const staff = {};
  const handler = createConnectedHandler({ origin: 'https://atlasgrading.com', assertRequest: req => { assert.equal(req.private, true); },
    boundary: { authenticate: async (cookie, csrf) => { assert.equal(cookie, 'original-cookie'); assert.equal(csrf, 'original-csrf'); return staff; } },
    connected: { workflow: {}, intake: {}, dealerOperations: { call: async (actor, action, input) => {
      calls++; assert.equal(actor, staff); assert.equal(action, 'custody_record'); assert.deepEqual(input, { requestId: 'stable' }); return { eventId: 'saved' };
    } } } });
  const response = () => ({ status(code) { this.code = code; return this; }, json(value) { this.body = value; }, setHeader() {} });
  const request = { private: true, method: 'POST', url: '/api/staff/manual-connected/dealer-operations/custody', body: { requestId: 'stable' },
    headers: { origin: 'https://atlasgrading.com', cookie: 'original-cookie', 'content-type': 'application/json', 'x-atlas-csrf': 'original-csrf' } };
  const denied = response(); await handler({ ...request, headers: { ...request.headers, origin: 'https://attacker.test' } }, denied);
  assert.equal(denied.code, 403); assert.equal(calls, 0);
  const accepted = response(); await handler(request, accepted); assert.equal(accepted.code, 200); assert.equal(calls, 1);
});

test('return PDF requires original reviewer capability and exact bounded, hash-verified PDF', async () => {
  const { createHash, randomUUID } = await import('node:crypto');
  const orderId = randomUUID(), staff = {}, actors = new WeakMap([[staff, { sessionHash: 'original-session', browserHash: 'original-browser' }]]);
  const bytes = Buffer.from('%PDF-1.7\nSynthetic staff return label\n%%EOF');
  const label = { orderId, leg: 'RETURN', mimeType: 'application/pdf', labelBase64: bytes.toString('base64'), labelSha256: createHash('sha256').update(bytes).digest('hex') };
  let role = 'REVIEWER', result = label, calls = 0;
  const service = createDealerStaffService({ auth: { actors, config: { phoneByHash: new Map() } }, boundary: { transaction: async (_staff, fn) => fn({ principal: { role }, tx: { $queryRawUnsafe: async (_sql, ...args) => { calls++; assert.equal(args[0], 'return_label'); assert.equal(args[1], 'original-session'); assert.deepEqual(JSON.parse(args[5]), { orderId }); return [{ result }]; } } }) } });
  await assert.rejects(service.call({}, 'return_label', { orderId }), { code: 'SIGN_IN_REQUIRED' });
  role = 'OBSERVER'; await assert.rejects(service.call(staff, 'return_label', { orderId }), { code: 'STAFF_REQUIRED' }); role = 'REVIEWER';
  await assert.rejects(service.call(staff, 'return_label', { orderId, effectId: 'different' }), { code: 'INVALID_DEALER_OPERATION' }); assert.equal(calls, 0);
  assert.deepEqual(await service.call(staff, 'return_label', { orderId }), label);
  for (const change of [{ orderId: randomUUID() }, { leg: 'INBOUND' }, { mimeType: 'text/html' }, { labelSha256: 'f'.repeat(64) }, { labelBase64: Buffer.from('not a PDF').toString('base64') }, { labelBase64: label.labelBase64 + '\n' }, { labelBase64: 'A'.repeat(5592409) }]) {
    result = { ...label, ...change }; await assert.rejects(service.call(staff, 'return_label', { orderId }), { code: 'LABEL_NOT_READY' });
  }
  result = { ...label, unrelatedProviderSecret: 'must not escape' }; assert.deepEqual(await service.call(staff, 'return_label', { orderId }), label);
});

test('return-label HTTP is exact GET, staff cookie authenticated, no-store and cannot create or retry labels', async () => {
  const orderId = '0336918d-0204-47e0-acdf-6ef4b22b62c1', staff = {}; let calls = 0, authentications = 0;
  const handler = createConnectedHandler({ origin: 'https://atlasgrading.com', assertRequest: req => { assert.equal(req.private, true); },
    boundary: { authenticate: async (cookie, csrf) => { authentications++; assert.equal(cookie, 'staff-cookie'); assert.equal(csrf, undefined); return staff; } },
    connected: { workflow: {}, intake: {}, dealerOperations: { call: async (actor, action, input) => { calls++; assert.equal(actor, staff); assert.equal(action, 'return_label'); assert.deepEqual(input, { orderId }); return { labelBase64: Buffer.from('%PDF-fixture').toString('base64'), labelSha256: 'a'.repeat(64) }; } } } });
  const response = () => ({ headers: {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; }, send(value) { this.bytes = value; }, setHeader(key, value) { this.headers[key] = value; } });
  const request = { private: true, method: 'GET', url: `/api/staff/manual-connected/dealer-operations/orders/${orderId}/return-label`, headers: { cookie: 'staff-cookie' } };
  for (const change of [{ method: 'POST' }, { method: 'DELETE' }, { url: request.url + '?effectId=INBOUND' }]) { const r = response(); await handler({ ...request, ...change }, r); assert.equal(r.code, 405); }
  assert.equal(calls, 0); assert.equal(authentications, 0);
  const r = response(); await handler(request, r); assert.equal(r.code, 200); assert.equal(r.bytes.toString(), '%PDF-fixture'); assert.equal(r.headers['Content-Type'], 'application/pdf'); assert.equal(r.headers['X-ATLAS-Label-SHA256'], 'a'.repeat(64)); assert.equal(r.headers['Cache-Control'], 'private, no-store'); assert.equal(r.headers['X-Content-Type-Options'], 'nosniff'); assert.equal(calls, 1); assert.equal(authentications, 1);
});
