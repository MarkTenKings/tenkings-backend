import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalStore } from '../src/store.mjs';
import { createFinanceAlertOutbox, recordOperationalAlert } from '../src/finance-alerts.mjs';
import { digest } from '../src/ledger.mjs';
import { NOW, deferred } from './host-finance-fixtures.mjs';
const config = { approvalRef: 'fixture_approval', destinationRef: 'fixture_sink', maxItems: 2, leaseMs: 1000 };
function setup(t, clock = () => NOW) {
  const store = openLocalStore({ filename: ':memory:', environment: 'SYNTHETIC_LOCAL', clock }); t.after(() => store.close());
  const add = topic => store.transaction(tx => recordOperationalAlert(tx, { scope: 'fixture_scope', topic, code: 'PROVIDER_UNAVAILABLE', reference: 'fixture_original', evidenceHash: digest({ topic }) }));
  const outbox = sender => createFinanceAlertOutbox({ enabled: true, store, scope: 'fixture_scope', config, assertRuntimeReady: () => true, sender });
  return { store, add, outbox };
}
test('alerts default off and absent/unqualified sender cannot cause external delivery', async t => {
  await assert.rejects(createFinanceAlertOutbox().flush(), { code: 'FINANCE_ALERTS_DISABLED' });
  const f = setup(t); f.add('one'); assert.equal((await f.outbox().flush()).status, 'SENDER_NOT_CONFIGURED');
  assert.throws(() => f.outbox({ send() {} }), { code: 'FINANCE_ALERT_SENDER_UNQUALIFIED' });
  let sent = 0; await assert.rejects(f.outbox({ assertReady: () => false, send() { sent++; }, lookup() {} }).flush(), { code: 'HOST_FINANCE_UNQUALIFIED' });
  assert.equal(sent, 0); assert.equal(Object.values(f.store.read().financeAlertOutbox)[0].dispatchCount, 0);
});
test('concurrent sends share one durable claim; lost response recovers by original lookup after restart and never fresh send', async t => {
  let now = NOW; const f = setup(t, () => now), a = f.add('one'), gate = deferred(), entered = deferred(); let sends = 0, lookups = 0;
  const sender = { assertReady: () => true, async send({ idempotencyKey, alert }) { sends++; assert.equal(idempotencyKey, a.alertId); assert.deepEqual(Object.keys(alert).sort(), ['alertId','code','evidenceHash','firstObservedAt','reference']); entered.resolve(); await gate.promise; throw new Error('sk_test_DO_NOT_PERSIST'); }, async lookup({ idempotencyKey }) { lookups++; assert.equal(idempotencyKey, a.alertId); return { status: 'DELIVERED', receiptId: 'fixture_message_once' }; } };
  const original = f.outbox(sender).flush(); await entered.promise;
  await f.outbox(sender).flush(); assert.equal(sends, 1); assert.equal(lookups, 0);
  // Simulate process loss past its lease. The new instance only looks up.
  now += 1001; await f.outbox(sender).flush(); gate.resolve(); await original;
  const row = f.store.read().financeAlertOutbox[a.alertId]; assert.equal(row.status, 'DELIVERED'); assert.equal(row.dispatchCount, 1); assert.equal(sends, 1); assert.equal(lookups, 1);
  assert.equal(JSON.stringify(f.store.read()).includes('sk_test_'), false);
  assert.equal(f.store.read().financeOperationalAlerts[a.alertId].status, 'OPEN');
});
test('unknown and not-found delivery never re-arm; bounded batches and destination identity remain durable', async t => {
  const f = setup(t); for (const topic of ['one','two','three']) f.add(topic); let sends = 0, lookups = 0;
  const sender = { assertReady: () => true, async send() { sends++; return { status: 'UNKNOWN' }; }, async lookup() { lookups++; return { status: 'NOT_FOUND' }; } };
  await f.outbox(sender).flush(); assert.equal(sends, 2);
  await f.outbox(sender).flush(); assert.equal(sends, 3); assert.equal(lookups, 1);
  await f.outbox(sender).flush(); assert.equal(sends, 3); assert.ok(lookups > 1);
  assert.ok(Object.values(f.store.read().financeAlertOutbox).every(row => row.status === 'UNKNOWN' && row.dispatchCount === 1));
  const other = createFinanceAlertOutbox({ enabled: true, store: f.store, scope: 'fixture_scope', config: { ...config, destinationRef: 'different_sink' }, assertRuntimeReady: () => true, sender });
  await assert.rejects(other.flush(), { code: 'FINANCE_ALERT_DESTINATION_CHANGED' }); assert.equal(sends, 3);
});

test('deadline interrupts noncooperative sender to durable UNKNOWN; late result is ignored and method drift/revocation refuses another admission', async t => {
  const f = setup(t), item = f.add('deadline'), gate = deferred(), entered = deferred(); let passedSignal, approved = true;
  const sender = { assertReady: () => approved, async send({ signal }) { passedSignal = signal; entered.resolve(); return gate.promise; }, async lookup() { return { status: 'NOT_FOUND' }; } };
  const outbox = f.outbox(sender), pending = outbox.flush({ deadline: Date.now() + 30 }); await entered.promise;
  const result = await pending; assert.equal(result.status, 'INTERRUPTED'); assert.equal(passedSignal.aborted, true);
  assert.equal(f.store.read().financeAlertOutbox[item.alertId].status, 'UNKNOWN');
  assert.equal(outbox.status().inFlightCount, 1);
  assert.equal((await outbox.flush()).status, 'REVIEW_REQUIRED');
  assert.equal(f.store.read().financeAlertOutbox[item.alertId].lookupCount, 0);
  gate.resolve({ status: 'DELIVERED', receiptId: 'late_ignored' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(outbox.status().inFlightCount, 0);
  assert.equal(f.store.read().financeAlertOutbox[item.alertId].status, 'UNKNOWN');
  approved = false; await assert.rejects(outbox.flush(), { code: 'HOST_FINANCE_UNQUALIFIED' });
  approved = true; sender.lookup = async () => ({ status: 'DELIVERED', receiptId: 'replacement' });
  await assert.rejects(outbox.flush(), { code: 'FINANCE_ALERT_SENDER_CHANGED' });
  assert.equal(f.store.read().financeAlertOutbox[item.alertId].dispatchCount, 1);
});
