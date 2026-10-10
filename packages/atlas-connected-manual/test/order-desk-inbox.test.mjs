import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createOrderDeskInboxService, orderDeskInboxGrantSQL } from '../src/order-desk-inbox.mjs';

function fixture() {
  const staff = {}, id = randomUUID(), orderId = randomUUID(), requestId = randomUUID();
  const actors = new WeakMap([[staff, { sessionHash: 'original-session', browserHash: 'original-browser' }]]);
  const config = { mode: 'LOCAL_FIXTURE', origin: 'https://atlasgrading.com', deploymentId: 'fixture', releaseSha: 'a'.repeat(40), configHash: 'b'.repeat(64), phoneByHash: new Map([['allowed-hash', '+12025550141']]) };
  const state = { role: 'REVIEWER', calls: 0, result: { orderId, requestId, outcome: 'ACKNOWLEDGED', acknowledgment: { requestId, acknowledgedAt: '2026-10-10T01:00:00.000Z', acknowledgedBy: { id, name: 'Synthetic reviewer' } } } };
  const service = createOrderDeskInboxService({ auth: { actors, config }, boundary: { transaction: async (actor, fn) => {
    assert.equal(actor, staff);
    return fn({ principal: { id, role: state.role }, tx: { $queryRawUnsafe: async (sql, ...args) => {
      state.calls++; assert.equal(sql, 'SELECT atlas_dealer.staff_order_acknowledge($1,$2,$3::jsonb,$4::text[],$5::jsonb) AS result');
      assert.deepEqual(args, ['original-session', 'original-browser', JSON.stringify({ mode: config.mode, origin: config.origin, deploymentId: config.deploymentId, releaseSha: config.releaseSha, configHash: config.configHash }), ['allowed-hash'], JSON.stringify({ orderId, requestId })]);
      return [{ result: state.result }];
    } } });
  } } });
  return { staff, id, orderId, requestId, state, service };
}

test('acknowledgment requires the original staff capability, reviewer and exact input before SQL', async () => {
  const f = fixture(), input = { orderId: f.orderId, requestId: f.requestId };
  await assert.rejects(f.service.acknowledge({}, input), { code: 'SIGN_IN_REQUIRED' });
  f.state.role = 'OBSERVER'; await assert.rejects(f.service.acknowledge(f.staff, input), { code: 'STAFF_REQUIRED' });
  for (const bad of [null, [], {}, { ...input, actorId: f.id }, { ...input, acknowledgedAt: new Date().toISOString() }, { ...input, requestId: 'invalid' }])
    await assert.rejects(f.service.acknowledge(f.staff, bad), { code: 'INVALID_ORDER_ACKNOWLEDGMENT' });
  assert.equal(f.state.calls, 0);
  f.state.role = 'REVIEWER';
  assert.deepEqual(await f.service.acknowledge(f.staff, input), f.state.result); assert.equal(f.state.calls, 1);
});

test('confirmed acknowledgment and another staff acknowledgment return only matching safe receipts', async () => {
  const f = fixture(), input = { orderId: f.orderId, requestId: f.requestId }, original = structuredClone(f.state.result);
  f.state.result.privateProviderSecret = 'must-not-escape'; f.state.result.acknowledgment.privatePhone = 'must-not-escape';
  assert.deepEqual(await f.service.acknowledge(f.staff, input), original);
  const other = { ...original, outcome: 'ALREADY_ACKNOWLEDGED', acknowledgment: { ...original.acknowledgment, requestId: randomUUID(), acknowledgedBy: { id: randomUUID(), name: 'Other reviewer' } } };
  f.state.result = other; assert.deepEqual(await f.service.acknowledge(f.staff, input), other);
  for (const change of [{ orderId: randomUUID() }, { requestId: randomUUID() }, { outcome: 'invented' }, { acknowledgment: null },
    { acknowledgment: { ...original.acknowledgment, acknowledgedAt: 'invalid' } },
    { acknowledgment: { ...original.acknowledgment, requestId: randomUUID() } },
    { acknowledgment: { ...original.acknowledgment, acknowledgedBy: { id: randomUUID(), name: 'Wrong actor' } } }]) {
    f.state.result = { ...original, ...change };
    await assert.rejects(f.service.acknowledge(f.staff, input), { code: 'ORDER_ACKNOWLEDGMENT_UNCONFIRMED' });
  }
});

test('database denials and uncertain responses never fabricate an acknowledgment', async () => {
  const f = fixture(), input = { orderId: f.orderId, requestId: f.requestId };
  for (const [status, code] of [[404, 'ORDER_NOT_FOUND'], [409, 'REQUEST_CONFLICT'], [403, 'STAFF_REQUIRED']]) {
    f.state.result = { error: { status, code } };
    await assert.rejects(f.service.acknowledge(f.staff, input), { code, status });
  }
  f.state.result = null; await assert.rejects(f.service.acknowledge(f.staff, input), { code: 'ORDER_ACKNOWLEDGMENT_UNAVAILABLE' });
});

test('runtime grants expose only the narrow session-authenticated acknowledgment function', () => {
  assert.equal(orderDeskInboxGrantSQL('atlas_fixture_manual'), 'GRANT USAGE ON SCHEMA atlas_dealer TO "atlas_fixture_manual";\nGRANT EXECUTE ON FUNCTION atlas_dealer.staff_order_acknowledge(text,text,jsonb,text[],jsonb) TO "atlas_fixture_manual";');
  for (const role of ['PUBLIC', 'atlas; DROP TABLE x', 'atlas role']) assert.throws(() => orderDeskInboxGrantSQL(role));
});
