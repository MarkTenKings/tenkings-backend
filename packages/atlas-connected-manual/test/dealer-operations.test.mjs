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
