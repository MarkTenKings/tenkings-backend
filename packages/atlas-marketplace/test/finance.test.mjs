import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePayment, prepareRefund, prepareReversal, preparePayout, reconcileFinance, sellerBalance, recordDispute, recordHold, releaseHold } from '../src/finance.mjs';
import { assertJournal, accountBalance } from '../src/ledger.mjs';
import { financeFixture, NOW } from './finance-fixtures.mjs';

function refundInput(f, { intentId = 'refund_one', sellerCents = 2300, feeCents = 200, taxCents = 175, shippingCents = 125 } = {}) {
  return { intentId, paymentIntentId: 'payment_one', amountCents: sellerCents + feeCents + taxCents + shippingCents, allocations: { sellerCents, feeCents, taxCents, shippingCents }, policyEvidence: { approved: true, orderId: f.order.orderId, policyVersion: f.policy.version, evidenceRef: 'fixture-inspected-return' } };
}

test('exact payment reconciliation rejects mismatched scopes, never allocates unconfirmed money, and deduplicates settlement', async t => {
  const f = financeFixture(); t.after(() => f.store.close());
  assert.throws(() => f.store.transaction(tx => preparePayment(tx, { intentId: 'pbad', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: null })), { code: 'FINANCE_POLICY_REQUIRED' });
  await f.paid();
  assert.deepEqual(f.store.read(state => sellerBalance(state, 'seller_one')), { pendingCents: 9200, availableCents: 0, reservedCents: 0, withdrawingCents: 0, paidOutCents: 0, recoveryDueCents: 0, currency: 'USD' });
  const original = f.store.read(state => state.financeObservations.payment_one);
  const baseline = f.store.read();
  for (const patch of [{ amountCents: 1 }, { accountId: 'acct_other' }, { livemode: true }, { currency: 'EUR' }, { intentId: 'other' }, { orderId: 'other' }, { bindingHash: 'other' }, { objectId: 'pi_other' }, { chargeId: 'ch_other' }, { balanceTransaction: { ...original.balanceTransaction, feeCents: 301, netCents: 10899 } }]) {
    assert.throws(() => f.store.transaction(tx => reconcileFinance(tx, { intentId: 'payment_one', evidence: { ...original, ...patch } })));
    assert.deepEqual(f.store.read(), baseline);
  }
  await f.reconcile('payment_one'); await f.reconcile('payment_one');
  assert.equal(f.store.read(state => state.journals.length), 1);
  assert.equal(f.store.read(state => accountBalance(state, 'platform:acct_platform', 'processing_expense')), 300);
});

test('lost create response survives restart and never permits a fresh payment or dispatch', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-finance-'))); t.after(() => rmSync(directory, { recursive: true, force: true }));
  let f = financeFixture({ filename: join(directory, 'state.sqlite') });
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy }));
  f.provider.failNextCreateAfterCommit('payment_one');
  await assert.rejects(f.execute('payment_one'), { code: 'SYNTHETIC_RESPONSE_LOST' });
  assert.equal(f.store.read(state => state.intents.payment_one.status), 'UNKNOWN'); f.store.close();
  f = financeFixture({ filename: join(directory, 'state.sqlite') }); t.after(() => f.store.close());
  await assert.rejects(f.execute('payment_one'), { code: 'RECONCILIATION_REQUIRED' });
  assert.throws(() => f.store.transaction(tx => preparePayment(tx, { intentId: 'replacement_payment', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy })), { code: 'FINANCIAL_ACTION_EXISTS' });
  await f.resolve('payment_one', { status: 'succeeded', processingFeeCents: 300 });
  assert.equal(f.store.read(state => state.syntheticProvider.calls.payment_one), 1);
  assert.equal(f.store.read(state => state.intents.payment_one.confirmed), true);
});

test('partial refunds reserve exact components and reduced transfer never counts proceeds twice', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.paid();
  const input = refundInput(f); f.store.transaction(tx => prepareRefund(tx, input));
  assert.throws(() => f.store.transaction(tx => prepareRefund(tx, refundInput(f, { intentId: 'excess', sellerCents: 9200 }))), { code: 'EXCESS_REFUND' });
  await f.execute(input.intentId); await f.resolve(input.intentId, { status: 'succeeded' });
  await f.transferred();
  const balance = f.store.read(state => sellerBalance(state, 'seller_one'));
  assert.equal(balance.availableCents, 6900); assert.equal(balance.pendingCents, 0);
  assert.equal(f.store.read(state => state.intents.transfer_one.amountCents), 6900);
  assertJournal(f.store.read(state => state.journals));
});

test('refund and transfer reversal remain separate, reversal is bounded by debt and unwithdrawn proceeds', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred();
  f.store.transaction(tx => prepareRefund(tx, refundInput(f)));
  await f.execute('refund_one'); await f.resolve('refund_one', { status: 'succeeded' });
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').recoveryDueCents), 2300);
  const accountEvidence = await f.provider.getAccount('acct_seller');
  assert.throws(() => f.store.transaction(tx => prepareReversal(tx, { intentId: 'too_much', transferIntentId: 'transfer_one', amountCents: 2301, accountEvidence })), { code: 'REVERSAL_WITHOUT_RECOVERY' });
  f.store.transaction(tx => prepareReversal(tx, { intentId: 'reversal_one', transferIntentId: 'transfer_one', amountCents: 2300, accountEvidence }));
  await f.execute('reversal_one'); await f.resolve('reversal_one', { status: 'succeeded' });
  const balance = f.store.read(state => sellerBalance(state, 'seller_one'));
  assert.equal(balance.availableCents, 6900); assert.equal(balance.recoveryDueCents, 0);
  assertJournal(f.store.read(state => state.journals));
});

test('pending connected funds cannot be withdrawn and only exact settled remainder becomes available after reversal', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred({ settlement: 'pending' });
  await assert.rejects(f.payout(), { code: 'SELLER_BALANCE_INSUFFICIENT' });
  f.store.transaction(tx => prepareRefund(tx, refundInput(f)));
  await f.execute('refund_one'); await f.resolve('refund_one', { status: 'succeeded' });
  const accountEvidence = await f.provider.getAccount('acct_seller');
  f.store.transaction(tx => prepareReversal(tx, { intentId: 'reversal_one', transferIntentId: 'transfer_one', amountCents: 2300, accountEvidence }));
  await f.execute('reversal_one'); await f.resolve('reversal_one', { status: 'succeeded' });
  await f.resolve('transfer_one', { status: 'succeeded', settlement: 'available' });
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').availableCents), 6900);
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').pendingCents), 0);
});

test('competing payouts reserve funds once, capability loss stops dispatch, and holds require explicit release', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred();
  const accountEvidence = await f.provider.getAccount('acct_seller'), balanceEvidence = await f.provider.getBalance('acct_seller');
  const request = { intentId: 'payout_one', sellerId: 'seller_one', connectedAccountId: 'acct_seller', externalAccountId: 'ba_synthetic', amountCents: 6000, allocationOrderIds: ['order_one'], accountEvidence, balanceEvidence };
  const results = await Promise.allSettled(['payout_one', 'payout_two'].map(intentId => Promise.resolve().then(() => f.store.transaction(tx => preparePayout(tx, { ...request, intentId })))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  f.provider.configureAccount({ accountId: 'acct_seller', payoutsEnabled: false });
  await assert.rejects(f.execute('payout_one'), { code: 'PAYOUT_ACCOUNT_INELIGIBLE' });
  assert.equal(f.store.read(state => state.intents.payout_one.status), 'PREPARED');
  f.provider.configureAccount({ accountId: 'acct_seller', payoutsEnabled: true });
  f.store.transaction(tx => recordHold(tx, { orderId: 'order_one', holdId: 'hold_one', reason: 'return_open', evidenceRef: 'return_case', amountCents: 9200 }));
  await assert.rejects(f.execute('payout_one'), { code: 'SELLER_FUNDS_RESTRICTED' });
  f.store.transaction(tx => releaseHold(tx, { holdId: 'hold_one', evidenceRef: 'case_resolved' }));
  await f.execute('payout_one');
});

test('payout failure after paid reinstates money once only with exact returned-funds evidence', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred(); await f.payout();
  await f.resolve('payout_one', { status: 'paid' });
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').paidOutCents), 9200);
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').availableCents), 0);
  f.provider.resolve('payout_one', { status: 'failed' });
  const evidence = await f.provider.retrieve(f.store.read(state => state.intents.payout_one));
  assert.throws(() => f.store.transaction(tx => reconcileFinance(tx, { intentId: 'payout_one', evidence: { ...evidence, failureBalanceTransaction: null } })), { code: 'BALANCE_TRANSACTION_MISMATCH' });
  await f.reconcile('payout_one'); await f.reconcile('payout_one');
  const balance = f.store.read(state => sellerBalance(state, 'seller_one'));
  assert.equal(balance.availableCents, 9200); assert.equal(balance.paidOutCents, 0); assert.equal(balance.withdrawingCents, 0);
  assert.equal(f.store.read(state => state.journals.filter(entry => entry.kind === 'PAYOUT_RETURNED').length), 1);
});

test('dispute after payout records platform loss and seller recovery due without inventing available money', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred(); await f.payout(); await f.resolve('payout_one', { status: 'paid' });
  const payment = f.store.read(state => state.intents.payment_one);
  const evidence = { provider: 'synthetic', accountId: 'acct_platform', livemode: false, objectId: 'dp_one', chargeId: payment.chargeId, currency: 'USD', amountCents: 11200, status: 'needs_response', observedAt: NOW, balanceTransaction: { id: 'txn_dispute', source: 'dp_one', currency: 'USD', amountCents: -11200, feeCents: 1500, netCents: -12700, status: 'available', availableOn: NOW } };
  const policyEvidence = { approved: true, orderId: 'order_one', policyVersion: f.policy.version, evidenceRef: 'fixture-dispute-authority', sellerRecoveryCents: 9200 };
  f.store.transaction(tx => recordDispute(tx, { paymentIntentId: payment.id, evidence, policyEvidence }));
  f.store.transaction(tx => recordDispute(tx, { paymentIntentId: payment.id, evidence, policyEvidence }));
  const balance = f.store.read(state => sellerBalance(state, 'seller_one'));
  assert.equal(balance.availableCents, 0); assert.equal(balance.paidOutCents, 9200); assert.equal(balance.recoveryDueCents, 9200);
  assert.throws(() => f.store.transaction(tx => recordDispute(tx, { paymentIntentId: payment.id, evidence: { ...evidence, objectId: 'dp_duplicate' }, policyEvidence })), { code: 'MULTIPLE_DISPUTES_REQUIRE_REVIEW' });
  assert.throws(() => f.store.transaction(tx => prepareRefund(tx, refundInput(f))), { code: 'DISPUTED_PAYMENT_REFUND_REQUIRES_REVIEW' });
  const accountEvidence = await f.provider.getAccount('acct_seller');
  assert.throws(() => f.store.transaction(tx => prepareReversal(tx, { intentId: 'unfunded_recovery', transferIntentId: 'transfer_one', amountCents: 9200, accountEvidence })), { code: 'REVERSAL_FUNDS_UNAVAILABLE' });
  assertJournal(f.store.read(state => state.journals));
});

test('canceled payment requires explicit zero received and captured funds before reservation release', async t => {
  const f = financeFixture(); t.after(() => f.store.close());
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy }));
  await f.execute('payment_one');
  const intent = f.store.read(state => state.intents.payment_one);
  const base = await f.provider.retrieve(intent);
  for (const patch of [{}, { amountReceivedCents: 0 }, { amountReceivedCents: 1, chargePaid: true, chargeCapturedCents: 1 }, { amountReceivedCents: 0, chargePaid: false, chargeCapturedCents: 1 }]) {
    assert.throws(() => f.store.transaction(tx => reconcileFinance(tx, { intentId: intent.id, evidence: { ...base, ...patch, status: 'canceled' } })), { code: 'UNPAID_CANCELLATION_UNPROVEN' });
    assert.equal(f.store.read(state => state.intents.payment_one.terminalUnpaid), false);
  }
  await f.resolve('payment_one', { status: 'canceled' });
  assert.equal(f.store.read(state => state.intents.payment_one.terminalUnpaid), true);
  assert.equal(f.store.read(state => state.journals.length), 0);
});

test('concurrent dispatch claims produce exactly one provider create', async t => {
  const f = financeFixture(); t.after(() => f.store.close());
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy }));
  const results = await Promise.allSettled([f.execute('payment_one'), f.execute('payment_one')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.store.read(state => state.syntheticProvider.calls.payment_one), 1);
});

test('after-payout refund remains recovery debt and cannot make a fresh reversal or withdrawal', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred(); await f.payout(); await f.resolve('payout_one', { status: 'paid' });
  f.store.transaction(tx => prepareRefund(tx, refundInput(f)));
  await f.execute('refund_one'); await f.resolve('refund_one', { status: 'succeeded' });
  const balance = f.store.read(state => sellerBalance(state, 'seller_one'));
  assert.equal(balance.recoveryDueCents, 2300); assert.equal(balance.availableCents, 0); assert.equal(balance.paidOutCents, 9200);
  const accountEvidence = await f.provider.getAccount('acct_seller');
  assert.throws(() => f.store.transaction(tx => prepareReversal(tx, { intentId: 'unfunded_reversal', transferIntentId: 'transfer_one', amountCents: 2300, accountEvidence })), { code: 'REVERSAL_FUNDS_UNAVAILABLE' });
  await assert.rejects(f.payout({ intentId: 'fresh_payout', amountCents: 1 }), { code: 'SELLER_FUNDS_RESTRICTED' });
});

test('failed in-flight payout returns its reservation only once and retains the debit and correction', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred(); await f.payout({ amountCents: 4000 });
  await f.resolve('payout_one', { status: 'in_transit' });
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').withdrawingCents), 4000);
  await f.resolve('payout_one', { status: 'failed' }); await f.reconcile('payout_one');
  const balance = f.store.read(state => sellerBalance(state, 'seller_one'));
  assert.equal(balance.availableCents, 9200); assert.equal(balance.withdrawingCents, 0); assert.equal(balance.paidOutCents, 0);
  const types = f.store.read(state => state.journals.filter(entry => entry.intentId === 'payout_one').map(entry => entry.kind));
  assert.deepEqual(types, ['PAYOUT_RESERVED', 'PAYOUT_DEBITED', 'PAYOUT_RETURNED']);
});

test('pending refund debit stays in clearing and failed refund returns cash once without erasing its unpaid obligation', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.paid();
  f.store.transaction(tx => prepareRefund(tx, refundInput(f))); await f.execute('refund_one');
  const original = f.store.read(state => state.financeObservations.refund_one);
  const movement = (id, amount) => ({ id, source: original.objectId, currency: 'USD', amountCents: amount, feeCents: 0, netCents: amount, status: 'available', availableOn: NOW });
  const pending = { ...original, status: 'pending', balanceTransaction: movement('txn_pendingrefund', -2800) };
  f.store.transaction(tx => reconcileFinance(tx, { intentId: 'refund_one', evidence: pending }));
  assert.equal(f.store.read(state => accountBalance(state, 'platform:acct_platform', 'refund_clearing:refund_one')), 2800);
  assert.equal(f.store.read(state => sellerBalance(state, 'seller_one').pendingCents), 9200);
  const failed = { ...pending, status: 'failed', failureBalanceTransaction: movement('txn_refundreturn', 2800) };
  assert.throws(() => f.store.transaction(tx => reconcileFinance(tx, { intentId: 'refund_one', evidence: { ...failed, failureBalanceTransaction: null } })), { code: 'BALANCE_TRANSACTION_MISMATCH' });
  f.store.transaction(tx => reconcileFinance(tx, { intentId: 'refund_one', evidence: failed }));
  const count = f.store.read(state => state.journals.length);
  f.store.transaction(tx => reconcileFinance(tx, { intentId: 'refund_one', evidence: failed }));
  assert.equal(f.store.read(state => state.journals.length), count);
  assert.equal(f.store.read(state => accountBalance(state, 'platform:acct_platform', 'provider_cash')), 10900);
  assert.equal(f.store.read(state => accountBalance(state, 'platform:acct_platform', 'refund_clearing:refund_one')), 0);
  assert.equal(f.store.read(state => state.financeHolds['refund-failed:refund_one'].active), true);
  assert.equal(f.store.read(state => state.intents.refund_one.status), 'FAILED');
  await assert.rejects(f.transferred(), { code: 'ORDER_FUNDS_RESTRICTED' });
});

test('production finance reducers require live observations and matching account capability mode; mocked evidence only', async t => {
  const f = financeFixture(); t.after(() => f.store.close());
  const { claimDispatch, prepareTransfer } = await import('../src/finance.mjs');
  const policy = { ...f.policy, environment: 'stripe-production' };
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_mock_live', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy }));
  f.store.transaction(tx => claimDispatch(tx, 'payment_mock_live'));
  const evidence = { provider: 'stripe', accountId: 'acct_platform', livemode: true, kind: 'PAYMENT', objectId: 'pi_mocklive', intentId: 'payment_mock_live', orderId: f.order.orderId, bindingHash: f.order.bindingHash, currency: 'USD', amountCents: 11200, status: 'succeeded', observedAt: NOW, chargeId: 'ch_mocklive', chargePaid: true, chargeCapturedCents: 11200, chargeAmountCents: 11200, chargeCurrency: 'USD', amountReceivedCents: 11200, balanceTransaction: { id: 'txn_mocklive', source: 'ch_mocklive', currency: 'USD', amountCents: 11200, feeCents: 300, netCents: 10900, status: 'available', availableOn: NOW } };
  assert.throws(() => f.store.transaction(tx => reconcileFinance(tx, { intentId: 'payment_mock_live', evidence: { ...evidence, livemode: false } })), { code: 'PROVIDER_EVIDENCE_MISMATCH' });
  f.store.transaction(tx => reconcileFinance(tx, { intentId: 'payment_mock_live', evidence }));
  const accountEvidence = await f.provider.getAccount('acct_seller');
  const input = { intentId: 'transfer_mock_live', paymentIntentId: 'payment_mock_live', releaseEvidence: { approved: true, orderId: f.order.orderId, bindingHash: f.order.bindingHash, policyVersion: policy.version, releasedAt: NOW, evidenceRef: 'mock-only-release' }, accountEvidence };
  assert.throws(() => f.store.transaction(tx => prepareTransfer(tx, input)), { code: 'ACCOUNT_INELIGIBLE' });
  f.store.transaction(tx => prepareTransfer(tx, { ...input, accountEvidence: { ...accountEvidence, livemode: true } }));
  assert.throws(() => f.store.transaction(tx => claimDispatch(tx, 'transfer_mock_live', accountEvidence)), { code: 'ACCOUNT_INELIGIBLE' });
  assert.equal(f.store.read(state => state.intents.transfer_mock_live.dispatchCount), 0);
});
