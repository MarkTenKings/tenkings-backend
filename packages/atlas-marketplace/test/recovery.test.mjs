import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceRecoveryRunner } from '../src/recovery.mjs';
import { financeFixture, NOW } from './finance-fixtures.mjs';
import { preparePayment } from '../src/finance.mjs';
import { recordAccountAdjustment } from '../src/reconciliation.mjs';

const config = { environment: 'SYNTHETIC_LOCAL', platformAccountId: 'acct_platform', connectedAccountIds: ['acct_seller'], approvalRef: 'fixture-recovery-approval', maxItems: 10, concurrency: 2, maxEvidenceAgeMs: 60000, maxDurationMs: 60000 };
function setup(t, { clock = () => NOW, openings = true } = {}) {
  const f = financeFixture({ clock }); t.after(() => f.store.close());
  const calls = { identity: 0, retrieve: 0, discover: 0, snapshots: 0, inventories: 0 };
  const external = [];
  function prepare(id = 'payment_one') {
    const order = id === 'payment_one' ? f.order : { ...f.order, orderId: `order_${id}`, reservationId: `reservation_${id}`, bindingHash: `binding_${id}` };
    return f.store.transaction(tx => preparePayment(tx, { intentId: id, order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy }));
  }
  prepare();
  if (openings) for (const accountId of ['acct_platform','acct_seller']) {
    const value = accountId === 'acct_platform' ? 1000000 : 0;
    f.store.transaction(tx => recordAccountAdjustment(tx, { adjustmentId: `opening_${accountId}`, accountId, platformAccountId: 'acct_platform', kind: 'OPENING', maxEvidenceAgeMs: 60000,
      evidence: { provider: 'synthetic', accountId, livemode: false, currency: 'USD', availableCents: value, pendingCents: 0, totalCents: value, unsupported: [], observedAt: NOW, cutoffMs: NOW },
      approval: { approved: true, accountId, kind: 'OPENING', quiescent: true, reviewerId: 'fixture-staff', policyVersion: 'fixture-policy', evidenceRef: 'fixture-opening' } }));
  }
  const provider = {
    getIdentity: async () => { calls.identity++; return { provider: 'synthetic', environment: 'SYNTHETIC_LOCAL', platformAccountId: 'acct_platform', allowedConnectedAccountIds: ['acct_seller'], livemode: false }; },
    retrieve: async (...args) => { calls.retrieve++; return f.provider.retrieve(...args); },
    discover: async intent => { calls.discover++; return { complete: true, objectId: f.store.read(state => state.syntheticProvider.intentObjects[intent.id] ?? null) }; },
    getAccountSnapshot: async accountId => { calls.snapshots++; const balance = await f.provider.getBalance(accountId); return { provider: 'synthetic', ...balance, pendingCents: 0, totalCents: balance.availableCents, unsupported: [] }; },
    listBalanceTransactions: async ({ accountId, fromMs, toMs }) => {
      calls.inventories++;
      const transactions = f.store.read(state => Object.values(state.syntheticProvider.objects).flatMap(object => {
        const evidence = object.evidence, values = [];
        if (object.intent.accountId === accountId) for (const key of ['balanceTransaction','failureBalanceTransaction']) if (evidence[key]) values.push({ ...evidence[key], createdAt: NOW });
        if (object.intent.connectedAccountId === accountId && evidence.connectedBalanceTransaction) values.push({ ...evidence.connectedBalanceTransaction, createdAt: NOW });
        return values;
      }));
      return { provider: 'synthetic', accountId, livemode: false, currency: 'USD', observedAt: clock(), fromMs, toMs, complete: true, transactions: [...transactions, ...external.filter(row => row.accountId === accountId).map(({ accountId: _, ...row }) => row)] };
    },
    create() { throw new Error('Recovery must never retain or invoke this write capability'); }
  };
  const store = { read: async fn => f.store.read(fn), transaction: async fn => f.store.transaction(fn) };
  const runner = (overrides = {}) => createFinanceRecoveryRunner({ enabled: true, store, provider, config, assertRuntimeReady: () => true, ...overrides });
  return { ...f, calls, external, prepare, recoveryProvider: provider, runner };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('default-off runner and explicit bounds/authority/mode prevent unqualified recovery', async t => {
  await assert.rejects(createFinanceRecoveryRunner().run({ runId: 'off' }), { code: 'FINANCE_RECOVERY_DISABLED' });
  const f = setup(t);
  for (const changed of [{ concurrency: 9 }, { maxItems: 501 }, { maxDurationMs: 0 }, { connectedAccountIds: ['acct_seller','acct_seller'] }, { secretKey: 'must-not-be-accepted' }]) assert.throws(() => f.runner({ config: { ...config, ...changed } }));
  await assert.rejects(f.runner({ assertRuntimeReady: () => false }).run({ runId: 'unapproved' }), { code: 'RECOVERY_RUNTIME_UNQUALIFIED' });
  await assert.rejects(f.runner({ assertRuntimeReady: async () => { throw new Error('not a synchronous readiness port'); } }).run({ runId: 'async_approval' }), { code: 'RECOVERY_RUNTIME_UNQUALIFIED' });
  assert.equal(f.calls.identity, 0); assert.equal(f.store.read().financeRecoveryRuns, undefined);
  const wrong = { ...f.recoveryProvider, getIdentity: async () => ({ provider: 'stripe', environment: 'PRODUCTION', platformAccountId: 'acct_platform', allowedConnectedAccountIds: ['acct_seller'], livemode: true }) };
  const result = await f.runner({ provider: wrong }).run({ runId: 'mode_mismatch' });
  assert.equal(result.status, 'ERROR'); assert.equal(result.code, 'RECOVERY_PROVIDER_SCOPE_MISMATCH');
  assert.equal(f.calls.retrieve, 0); assert.equal(f.calls.snapshots, 0);
});

test('lost original response recovers by discovery/GET, reconciles both books and durably hands off settlement without creating an order', async t => {
  const f = setup(t); f.provider.failNextCreateAfterCommit('payment_one');
  await assert.rejects(f.execute('payment_one'), { code: 'SYNTHETIC_RESPONSE_LOST' });
  f.provider.resolve('payment_one', { status: 'succeeded', processingFeeCents: 300 });
  const runner = f.runner(); const result = await runner.run({ runId: 'original_recovery' });
  assert.equal(result.status, 'COMPLETED'); assert.deepEqual(result.affectedPaymentIntentIds, ['payment_one']);
  assert.deepEqual(result.accountReports.map(row => row.status), ['RECONCILED','RECONCILED']);
  assert.equal(f.calls.discover, 1); assert.equal(f.store.read().syntheticProvider.calls.payment_one, 1);
  assert.equal(Object.keys(f.store.read().orders).length, 0);
  const journalCount = f.store.read().journals.length, counts = { ...f.calls };
  assert.deepEqual(await f.runner().run({ runId: 'original_recovery' }), result);
  assert.deepEqual(f.calls, counts);
  // If the host crashed before consuming the handoff, a fresh pass still finds it.
  const repeat = await runner.run({ runId: 'unsettled_recovery' });
  assert.deepEqual(repeat.affectedPaymentIntentIds, ['payment_one']);
  assert.equal(f.store.read().journals.length, journalCount);
  assert.equal(f.store.read().syntheticProvider.calls.payment_one, 1);
});

test('concurrent duplicate runs share one durable owner; item/concurrency limits and abort wait for admitted GETs', async t => {
  const f = setup(t); f.prepare('payment_two'); f.prepare('payment_three');
  for (const id of ['payment_one','payment_two','payment_three']) { await f.execute(id); f.provider.resolve(id, { status: 'succeeded' }); }
  const gate = deferred(), admitted = deferred(), controller = new AbortController(); let active = 0, maximum = 0, reads = 0;
  const provider = { ...f.recoveryProvider, retrieve: async (...args) => { active++; maximum = Math.max(maximum, active); reads++; if (reads === 2) admitted.resolve(); await gate.promise; try { return await f.recoveryProvider.retrieve(...args); } finally { active--; } } };
  const runner = f.runner({ provider, config: { ...config, maxItems: 2 } });
  const pending = runner.run({ runId: 'overlap', signal: controller.signal }); await admitted.promise;
  assert.equal((await runner.run({ runId: 'overlap' })).status, 'RUNNING');
  assert.equal((await runner.run({ runId: 'another_overlap' })).status, 'BUSY');
  controller.abort(); gate.resolve(); const result = await pending;
  assert.equal(result.status, 'INTERRUPTED'); assert.equal(result.code, 'RECOVERY_ABORTED');
  assert.equal(result.results.length, 2); assert.equal(result.selectedIntentIds.length, 2); assert.equal(result.accountReports.length, 0);
  assert.equal(maximum, 2); assert.equal(reads, 2); assert.equal(active, 0);
  assert.equal(f.store.read(state => Object.values(state.intents).filter(row => row.confirmed).length), 2);
  assert.ok(Object.values(f.store.read().syntheticProvider.calls).every(count => count === 1));
  assert.equal(f.store.read().financeExceptions, undefined);
});

test('unknown/incomplete originals and provider errors remain held; missing openings and secrets never become adjustments or success', async t => {
  const f = setup(t, { openings: false }); f.prepare('payment_two');
  f.provider.failNextCreateAfterCommit('payment_one'); await assert.rejects(f.execute('payment_one'));
  await f.execute('payment_two');
  f.prepare('payment_not_dispatched');
  const provider = { ...f.recoveryProvider, discover: async () => ({ complete: false, objectId: null }), retrieve: async () => { throw new Error('sk_test_never_persist_or_print_this_value'); } };
  const result = await f.runner({ provider }).run({ runId: 'failed_reads' });
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(f.store.read().intents.payment_not_dispatched.status, 'PREPARED');
  assert.equal(result.selectedIntentIds.includes('payment_not_dispatched'), false);
  assert.deepEqual(result.results.map(row => row.code).sort(), ['PROVIDER_DISCOVERY_INCOMPLETE','PROVIDER_RECOVERY_ERROR']);
  assert.ok(result.accountReports.every(row => row.status === 'EXCEPTIONS'));
  assert.equal(f.store.read().financeOpenings, undefined); assert.equal(f.store.read().financeAdjustments, undefined);
  assert.ok(Object.values(f.store.read().financeExceptions).every(item => item.status === 'OPEN'));
  assert.equal(JSON.stringify(f.store.read()).includes('sk_test_'), false);
  assert.equal(JSON.stringify(result).includes('sk_test_'), false);
  assert.ok(Object.values(f.store.read().syntheticProvider.calls).every(count => count === 1));
});

test('an expired durable lease permits a new read-only pass without letting the older worker overwrite its receipt', async t => {
  let now = NOW; const f = setup(t, { clock: () => now });
  await f.execute('payment_one'); f.provider.resolve('payment_one', { status: 'succeeded' });
  const gate = deferred(), entered = deferred(); let identities = 0;
  const provider = { ...f.recoveryProvider, getIdentity: async () => { if (++identities === 1) { entered.resolve(); await gate.promise; } return f.recoveryProvider.getIdentity(); } };
  const runner = f.runner({ provider, config: { ...config, maxDurationMs: 1000 } });
  const previous = runner.run({ runId: 'expired_worker' }); await entered.promise;
  now += 1001;
  const current = await runner.run({ runId: 'replacement_reader' });
  gate.resolve(); const expired = await previous;
  assert.equal(current.status, 'COMPLETED'); assert.equal(expired.status, 'INTERRUPTED'); assert.equal(expired.code, 'RECOVERY_LEASE_EXPIRED');
  assert.equal(f.store.read().financeRecoveryRuns.expired_worker.status, 'INTERRUPTED');
  assert.equal(f.store.read().financeRecoveryRuns.replacement_reader.status, 'COMPLETED');
  assert.equal(f.store.read().syntheticProvider.calls.payment_one, 1);
  assert.equal(f.store.read().journals.filter(row => row.intentId === 'payment_one').length, 1);
});

test('unexplained provider movement on either account produces review evidence without adopting it into earnings', async t => {
  const f = setup(t); await f.execute('payment_one'); f.provider.resolve('payment_one', { status: 'succeeded' });
  f.store.transaction(tx => { tx.state.syntheticProvider.accounts.acct_seller.availableCents = 500; });
  f.external.push({ accountId: 'acct_seller', id: 'txn_external', source: 'tr_external', currency: 'USD', amountCents: 500, feeCents: 0, netCents: 500, createdAt: NOW, status: 'available', availableOn: NOW });
  const result = await f.runner().run({ runId: 'external_movement' });
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.accountReports.find(row => row.accountId === 'acct_seller').differenceCents, 500);
  assert.equal(f.store.read().financeOrders.order_one.blocked, true);
  assert.equal(Object.values(f.store.read().financeAdjustments).length, 2);
  assert.equal(f.store.read().financeRecoveryRuns.external_movement.status, 'REVIEW_REQUIRED');
});

test('runtime revocation stops admission after an already admitted GET finishes', async t => {
  const f = setup(t); f.prepare('payment_two');
  for (const id of ['payment_one','payment_two']) { await f.execute(id); f.provider.resolve(id, { status: 'succeeded' }); }
  let approved = true, reads = 0;
  const provider = { ...f.recoveryProvider, retrieve: async (...args) => { reads++; const result = await f.recoveryProvider.retrieve(...args); approved = false; return result; } };
  const result = await f.runner({ provider, config: { ...config, concurrency: 1 }, assertRuntimeReady: () => approved }).run({ runId: 'revoked_during_get' });
  assert.equal(result.status, 'ERROR'); assert.equal(result.code, 'RECOVERY_RUNTIME_UNQUALIFIED'); assert.equal(reads, 1);
  assert.equal(result.accountReports.length, 0); assert.equal(f.calls.snapshots, 0);
  assert.equal(Object.values(f.store.read().intents).filter(row => row.confirmed).length, 1);
});
