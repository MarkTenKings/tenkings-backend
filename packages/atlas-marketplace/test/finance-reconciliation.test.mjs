import test from 'node:test';
import assert from 'node:assert/strict';
import { financeFixture, NOW } from './finance-fixtures.mjs';
import { preparePayment, sellerBalance } from '../src/finance.mjs';
import { executeFinanceIntent, getPaymentCollection } from '../src/payment.mjs';
import { recordAccountAdjustment, reconcileAccount, recordAccountReport, reconcilePendingFinance, resolveFinanceException } from '../src/reconciliation.mjs';

function snapshot(amount, at = NOW) { return { provider: 'synthetic', accountId: 'acct_platform', livemode: false, currency: 'USD', availableCents: amount, pendingCents: 0, totalCents: amount, unsupported: [], observedAt: at, cutoffMs: NOW }; }
function approval(kind) { return { approved: true, accountId: 'acct_platform', kind, reviewerId: 'staff_fixture', policyVersion: 'fixture-reconciliation-policy', evidenceRef: `fixture-${kind}`, quiescent: true }; }
function opening(f) { return f.store.transaction(tx => recordAccountAdjustment(tx, { adjustmentId: 'opening1', accountId: 'acct_platform', platformAccountId: 'acct_platform', kind: 'OPENING', evidence: snapshot(1000000), approval: approval('OPENING'), maxEvidenceAgeMs: 60000 })); }
function inventory(f, extras = []) {
  return { provider: 'synthetic', accountId: 'acct_platform', livemode: false, currency: 'USD', fromMs: NOW, toMs: NOW + 1000, complete: true, observedAt: NOW, transactions: [...f.store.read(state => Object.values(state.financeBalanceTransactions ?? {}).filter(value => value.accountId === 'acct_platform').map(value => ({ ...value, createdAt: NOW }))), ...extras] };
}

test('account reconciliation proves opening plus exact provider movements; unknown external funds stay outside seller earnings', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); opening(f); await f.paid();
  const provider = { getAccountSnapshot: async () => snapshot(1010900), listBalanceTransactions: async () => inventory(f) };
  const args = { store: f.store, provider, accountId: 'acct_platform', platformAccountId: 'acct_platform', maxEvidenceAgeMs: 60000, enabled: true };
  const clean = await reconcileAccount({ ...args, reportId: 'report1' });
  assert.equal(clean.status, 'RECONCILED'); assert.equal(clean.differenceCents, 0);
  const external = { id: 'txn_external', source: 'tu_external', currency: 'USD', amountCents: 5000, feeCents: 0, netCents: 5000, status: 'available', availableOn: NOW, createdAt: NOW };
  const externalProvider = { getAccountSnapshot: async () => snapshot(1015900), listBalanceTransactions: async () => inventory(f, [external]) };
  const report = await reconcileAccount({ ...args, provider: externalProvider, reportId: 'report2' });
  assert.equal(report.status, 'EXCEPTIONS'); assert.equal(report.differenceCents, 5000);
  assert.ok(report.exceptions.some(item => item.code === 'UNACCOUNTED_PROVIDER_TRANSACTION'));
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').pendingCents), 9200);
  const input = { adjustmentId: 'external1', accountId: 'acct_platform', platformAccountId: 'acct_platform', kind: 'EXTERNAL', evidence: { ...snapshot(1015900), transaction: external }, approval: approval('EXTERNAL'), maxEvidenceAgeMs: 60000 };
  f.store.transaction(tx => recordAccountAdjustment(tx, input));
  assert.throws(() => f.store.transaction(tx => recordAccountAdjustment(tx, { ...input, adjustmentId: 'externalAgain' })), { code: 'PROVIDER_TRANSACTION_REUSED_OR_CHANGED' });
  f.store.transaction(tx => resolveFinanceException(tx, { exceptionId: 'reconciliation:report2', reviewEvidence: { approved: true, exceptionId: 'reconciliation:report2', reviewerId: 'staff_fixture', evidenceRef: 'reviewed-external-adjustment', policyVersion: 'fixture-reconciliation-policy' } }));
  const fixed = await reconcileAccount({ ...args, provider: { ...externalProvider, listBalanceTransactions: async () => inventory(f) }, reportId: 'report3' });
  assert.equal(fixed.status, 'RECONCILED'); assert.equal(fixed.differenceCents, 0);
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').pendingCents), 9200);
  assert.throws(() => f.store.transaction(tx => recordAccountAdjustment(tx, { adjustmentId: 'openingAgain', accountId: 'acct_platform', platformAccountId: 'acct_platform', kind: 'OPENING', evidence: snapshot(1015900), approval: approval('OPENING'), maxEvidenceAgeMs: 60000 })), { code: 'OPENING_ALREADY_ESTABLISHED' });
});

test('incomplete inventory and moving provider snapshots never qualify an account as reconciled', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); opening(f); await f.paid();
  const result = f.store.transaction(tx => recordAccountReport(tx, { reportId: 'moving', accountId: 'acct_platform', platformAccountId: 'acct_platform', before: snapshot(1010900), after: snapshot(1010901), inventory: { ...inventory(f), complete: false }, maxEvidenceAgeMs: 60000 }));
  assert.equal(result.status, 'EXCEPTIONS');
  for (const code of ['TRANSACTION_INVENTORY_INCOMPLETE', 'BALANCE_CHANGED_DURING_RECONCILIATION', 'PROVIDER_LEDGER_DIFFERENCE']) assert.ok(result.exceptions.some(item => item.code === code));
  await assert.rejects(f.transferred(), { code: 'ORDER_FUNDS_RESTRICTED' });
});

test('async store wrappers preserve single dispatch and unknown recovery only retrieves the original object', async t => {
  const f = financeFixture(); t.after(() => f.store.close());
  const store = { read: async fn => f.store.read(fn), transaction: async fn => f.store.transaction(fn) };
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy }));
  f.provider.failNextCreateAfterCommit('payment_one');
  await assert.rejects(executeFinanceIntent({ store, provider: f.provider, intentId: 'payment_one', enabled: true }), { code: 'SYNTHETIC_RESPONSE_LOST' });
  const createCalls = f.store.read(state => state.syntheticProvider.calls.payment_one);
  f.provider.resolve('payment_one', { status: 'succeeded', processingFeeCents: 300 });
  const result = await reconcilePendingFinance({ store, provider: f.provider, enabled: true });
  assert.equal(result[0].status, 'SUCCEEDED');
  assert.equal(f.store.read(state => state.syntheticProvider.calls.payment_one), createCalls);
  assert.equal(f.store.read(state => state.journals.length), 1);
  await assert.rejects(executeFinanceIntent({ store, provider: f.provider, intentId: 'payment_one', enabled: true }), { code: 'RECONCILIATION_REQUIRED' });
});

test('payment collection validates durable original buyer and reservation before requesting any client capability', async t => {
  const f = financeFixture(); t.after(() => f.store.close());
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy })); await f.execute('payment_one');
  let calls = 0;
  const provider = { getPaymentCollection: async intent => { calls++; return { paymentIntentId: intent.objectId, clientSecret: 'intended-transient-test-capability' }; } };
  const args = { store: { read: async fn => f.store.read(fn) }, provider, intentId: 'payment_one', buyerId: f.order.buyerId, reservationId: f.order.reservationId, enabled: true };
  await assert.rejects(getPaymentCollection({ ...args, buyerId: 'another_buyer' }), { code: 'PAYMENT_COLLECTION_SCOPE_MISMATCH' });
  await assert.rejects(getPaymentCollection({ ...args, reservationId: 'another_reservation' }), { code: 'PAYMENT_COLLECTION_SCOPE_MISMATCH' });
  assert.equal(calls, 0);
  const result = await getPaymentCollection(args); assert.equal(result.clientSecret, 'intended-transient-test-capability'); assert.equal(result.intentId, 'payment_one'); assert.equal(result.reservationId, f.order.reservationId);
  assert.equal(calls, 1); assert.equal(JSON.stringify(f.store.read()).includes('intended-transient-test-capability'), false);
});

test('unavailable provider inventory persists an explicit exception and never fabricates a reconciled balance', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); opening(f); await f.paid();
  const provider = { getAccountSnapshot: async () => snapshot(1010900), listBalanceTransactions: async () => { const error = new Error('mock response lost'); error.code = 'MOCK_UNAVAILABLE'; throw error; } };
  const result = await reconcileAccount({ store: f.store, provider, accountId: 'acct_platform', platformAccountId: 'acct_platform', reportId: 'unavailable', maxEvidenceAgeMs: 60000, enabled: true });
  assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.providerTotalCents, undefined);
  assert.equal(f.store.read(state => state.financeExceptions['reconciliation-unavailable:unavailable'].status), 'OPEN');
});

test('Stripe-mode payout requires reconciled owned cash; a reservation preserves the proof, but debits and unexplained external funds invalidate it', async t => {
  const f = financeFixture(); t.after(() => f.store.close());
  const { prepareTransfer, preparePayout } = await import('../src/finance.mjs');
  const { reconcileFinanceIntent } = await import('../src/payment.mjs');
  // Adapter contract fixture only: the durable local simulator supplies mocked Stripe evidence.
  const provider = { ...f.provider, create: intent => f.provider.create({ ...intent, policy: { ...intent.policy, environment: 'synthetic' } }), retrieve: async (...args) => { const result = await f.provider.retrieve(...args); return result ? { ...result, provider: 'stripe' } : null; } };
  const policy = { ...f.policy, environment: 'stripe-sandbox' };
  const run = intentId => executeFinanceIntent({ store: f.store, provider, intentId, enabled: true });
  const reconcile = intentId => reconcileFinanceIntent({ store: f.store, provider, intentId });
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy }));
  f.store.transaction(tx => recordAccountAdjustment(tx, { adjustmentId: 'platformopening', accountId: 'acct_platform', platformAccountId: 'acct_platform', kind: 'OPENING', evidence: { ...snapshot(1000000), provider: 'stripe' }, approval: approval('OPENING'), maxEvidenceAgeMs: 60000 }));
  const accountSnapshot = amount => ({ ...snapshot(amount), provider: 'stripe', accountId: 'acct_seller' });
  f.store.transaction(tx => recordAccountAdjustment(tx, { adjustmentId: 'selleropening', accountId: 'acct_seller', platformAccountId: 'acct_platform', kind: 'OPENING', evidence: accountSnapshot(0), approval: { ...approval('OPENING'), accountId: 'acct_seller' }, maxEvidenceAgeMs: 60000 }));
  await run('payment_one'); f.provider.resolve('payment_one', { status: 'succeeded', processingFeeCents: 300 }); await reconcile('payment_one');
  const accountEvidence = await provider.getAccount('acct_seller');
  f.store.transaction(tx => prepareTransfer(tx, { intentId: 'transfer_one', paymentIntentId: 'payment_one', releaseEvidence: { approved: true, orderId: f.order.orderId, bindingHash: f.order.bindingHash, policyVersion: policy.version, releasedAt: NOW, evidenceRef: 'mock-release' }, accountEvidence }));
  await run('transfer_one'); f.provider.resolve('transfer_one', { status: 'succeeded' }); await reconcile('transfer_one');
  const payoutInput = async id => ({ intentId: id, sellerId: f.order.sellerId, connectedAccountId: 'acct_seller', externalAccountId: 'ba_synthetic', amountCents: 1000, allocationOrderIds: [f.order.orderId], accountEvidence: await provider.getAccount('acct_seller'), balanceEvidence: await provider.getBalance('acct_seller') });
  let input = await payoutInput('withdraw1');
  assert.throws(() => f.store.transaction(tx => preparePayout(tx, input)), { code: 'ACCOUNT_RECONCILIATION_REQUIRED' });
  const accountInventory = extras => ({ ...inventory(f), provider: 'stripe', accountId: 'acct_seller', transactions: [...f.store.read(state => Object.values(state.financeBalanceTransactions).filter(value => value.accountId === 'acct_seller').map(value => ({ ...value, createdAt: NOW }))), ...extras] });
  const report = (reportId, amount, extras = []) => f.store.transaction(tx => recordAccountReport(tx, { reportId, accountId: 'acct_seller', platformAccountId: 'acct_platform', before: accountSnapshot(amount), after: accountSnapshot(amount), inventory: accountInventory(extras), maxEvidenceAgeMs: 60000 }));
  assert.equal(report('sellerreport1', 9200).status, 'RECONCILED');
  assert.throws(() => f.store.transaction(tx => preparePayout(tx, input)), { code: 'ACCOUNT_RECONCILIATION_REQUIRED' });
  const platformSnapshot = { ...snapshot(1001700), provider: 'stripe' };
  assert.equal(f.store.transaction(tx => recordAccountReport(tx, { reportId: 'platformreport1', accountId: 'acct_platform', platformAccountId: 'acct_platform', before: platformSnapshot, after: platformSnapshot, inventory: { ...inventory(f), provider: 'stripe' }, maxEvidenceAgeMs: 60000 })).status, 'RECONCILED');
  f.store.transaction(tx => preparePayout(tx, input));
  await run('withdraw1'); // Reservation contains no cash movement, so the same report remains valid for dispatch.
  f.provider.resolve('withdraw1', { status: 'paid' }); await reconcile('withdraw1');
  input = await payoutInput('withdraw2');
  assert.throws(() => f.store.transaction(tx => preparePayout(tx, input)), { code: 'ACCOUNT_RECONCILIATION_CHANGED' });
  f.store.transaction(tx => { tx.state.syntheticProvider.accounts.acct_seller.availableCents += 500; });
  const external = { id: 'txn_unexplained', source: 'tr_external', currency: 'USD', amountCents: 500, feeCents: 0, netCents: 500, status: 'available', availableOn: NOW, createdAt: NOW };
  assert.equal(report('sellerreport2', 8700, [external]).status, 'EXCEPTIONS');
  input = await payoutInput('withdraw2'); assert.ok(input.balanceEvidence.availableCents >= input.amountCents);
  assert.throws(() => f.store.transaction(tx => preparePayout(tx, input)), { code: 'SELLER_FUNDS_RESTRICTED' });
  assert.equal(f.store.read(state => state.intents.withdraw2), undefined);
});

test('a recurring provider exception reopens a reviewed hold instead of inheriting its old release', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred();
  const { recordFinanceException } = await import('../src/reconciliation.mjs');
  const { digest } = await import('../src/ledger.mjs');
  const input = { exceptionId: 'recurring', accountId: 'acct_seller', code: 'PROVIDER_UNAVAILABLE', evidenceHash: digest('fixture-unavailable') };
  const first = f.store.transaction(tx => recordFinanceException(tx, input));
  f.store.transaction(tx => resolveFinanceException(tx, { exceptionId: 'recurring', reviewEvidence: { approved: true, exceptionId: 'recurring', reviewerId: 'staff_fixture', evidenceRef: 'review1', policyVersion: 'fixture-policy' } }));
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').availableCents), 9200);
  const second = f.store.transaction(tx => recordFinanceException(tx, input));
  assert.equal(second.status, 'OPEN'); assert.equal(second.generation, 2); assert.notDeepEqual(second.holdIds, first.holdIds);
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').availableCents), 0);
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').reservedCents), 9200);
});
