import test from 'node:test';
import assert from 'node:assert/strict';
import { financeFixture, NOW } from './finance-fixtures.mjs';
import { preparePayment, prepareTransfer, preparePayout, sellerBalance } from '../src/finance.mjs';
import { executeFinanceIntent, reconcileFinanceIntent } from '../src/payment.mjs';
import { recordAccountAdjustment, reconcileAccount } from '../src/reconciliation.mjs';
import { createMarketplacePilot, intentId } from '../src/service.mjs';
import { createAuthorityContext } from '../src/authority-context.mjs';
import { hash } from '../src/contract.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Mock provider evidence only, using the same explicit contract simulator as
// finance-reconciliation.test. No Stripe, auth, bank, or production qualification.
async function sandboxContractFixture(t) {
  const f = financeFixture(); t.after(() => f.store.close());
  const policy = { ...f.policy, environment: 'stripe-sandbox' };
  const order = { ...f.order, sellerId: '22222222-2222-4222-8222-222222222222' };
  const control = { ready: true, pauseAt: null, entered: deferred(), resume: deferred(), creates: 0, retrieves: 0 };
  async function pause(kind) {
    if (control.pauseAt === kind) { control.pauseAt = null; control.entered.resolve(); await control.resume.promise; }
  }
  const provider = {
    ...f.provider,
    getAccount: async accountId => { const result = await f.provider.getAccount(accountId); await pause('account'); return result; },
    getBalance: async accountId => { const result = await f.provider.getBalance(accountId); await pause('balance'); return result; },
    create: async intent => { control.creates++; return f.provider.create({ ...intent, policy: { ...intent.policy, environment: 'synthetic' } }); },
    retrieve: async (...args) => { control.retrieves++; const result = await f.provider.retrieve(...args); return result ? { ...result, provider: 'stripe' } : null; },
    getIdentity: async () => ({ platformAccountId: 'acct_platform', livemode: false }),
    getAccountSnapshot: async accountId => {
      const balance = await f.provider.getBalance(accountId);
      return { provider: 'stripe', ...balance, pendingCents: 0, totalCents: balance.availableCents, unsupported: [], cutoffMs: NOW };
    },
    listBalanceTransactions: async ({ accountId, fromMs, toMs }) => ({ provider: 'stripe', accountId, livemode: false, currency: 'USD', observedAt: NOW, fromMs, toMs, complete: true,
      transactions: f.store.read(state => Object.values(state.syntheticProvider.objects).flatMap(object => {
        const values = [];
        if (object.intent.accountId === accountId) for (const key of ['balanceTransaction', 'failureBalanceTransaction']) if (object.evidence[key]) values.push({ ...object.evidence[key], createdAt: NOW });
        if (object.intent.connectedAccountId === accountId && object.evidence.connectedBalanceTransaction) values.push({ ...object.evidence.connectedBalanceTransaction, createdAt: NOW });
        return values;
      })) })
  };
  const run = id => executeFinanceIntent({ store: f.store, provider, intentId: id, enabled: true });
  const reconcile = id => reconcileFinanceIntent({ store: f.store, provider, intentId: id });
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy }));
  for (const accountId of ['acct_platform', 'acct_seller']) {
    const evidence = await provider.getAccountSnapshot(accountId);
    f.store.transaction(tx => recordAccountAdjustment(tx, { adjustmentId: `opening_${accountId}`, accountId, platformAccountId: 'acct_platform', kind: 'OPENING', evidence, maxEvidenceAgeMs: policy.maxEvidenceAgeMs,
      approval: { approved: true, accountId, kind: 'OPENING', quiescent: true, reviewerId: 'mock_reviewer', policyVersion: 'mock_policy', evidenceRef: 'mock_opening' } }));
  }
  await run('payment_one'); f.provider.resolve('payment_one', { status: 'succeeded', processingFeeCents: 300 }); await reconcile('payment_one');
  const accountEvidence = await provider.getAccount('acct_seller');
  f.store.transaction(tx => prepareTransfer(tx, { intentId: 'transfer_one', paymentIntentId: 'payment_one', accountEvidence,
    releaseEvidence: { approved: true, orderId: order.orderId, bindingHash: order.bindingHash, policyVersion: policy.version, releasedAt: NOW, evidenceRef: 'mock_release' } }));
  await run('transfer_one'); f.provider.resolve('transfer_one', { status: 'succeeded' }); await reconcile('transfer_one');
  f.store.transaction(tx => { tx.state.orders[order.orderId] = { ...order, connectedAccountId: 'acct_seller' }; });
  const environment = 'PROVIDER_SANDBOX';
  const context = createAuthorityContext({ environment, evidenceOrigin: 'https://fixture.invalid', evidencePathPrefixes: ['/approved/'], qualificationRefs: Object.fromEntries(['fingerprintRef', 'titlePolicyRef', 'marketplacePolicyRef', 'evidenceContractRef'].map(key => [key, 'MOCK_CONTRACT_NO_REAL_AUTHORITY'])) });
  const options = { enabled: true, environment, context, store: f.store, provider, platformAccountId: 'acct_platform', listingPolicy: {}, financePolicy: policy, fulfillmentPolicy: {}, assertRuntimeReady: () => control.ready };
  options.runtimeApproval = { approved: true, binding: { environment, platformAccountId: options.platformAccountId, listingPolicyHash: hash(options.listingPolicy), financePolicyHash: hash(policy), fulfillmentPolicyHash: hash(options.fulfillmentPolicy), qualificationRefs: context.qualificationRefs } };
  const service = createMarketplacePilot(options), actor = { id: order.sellerId, role: 'SELLER' };
  const input = { requestId: 'withdrawal_one', amountCents: 9200, externalAccountId: 'ba_synthetic' };
  const payoutId = intentId('payout', { requestId: input.requestId, sellerId: actor.id }, context);
  async function prepare() {
    for (const accountId of ['acct_platform', 'acct_seller']) assert.equal((await reconcileAccount({ store: f.store, provider, accountId, platformAccountId: 'acct_platform', reportId: `before_${accountId}`, maxEvidenceAgeMs: policy.maxEvidenceAgeMs, enabled: true })).status, 'RECONCILED');
    const accountEvidence = await provider.getAccount('acct_seller'), balanceEvidence = await provider.getBalance('acct_seller');
    f.store.transaction(tx => preparePayout(tx, { intentId: payoutId, sellerId: actor.id, connectedAccountId: 'acct_seller', externalAccountId: input.externalAccountId, amountCents: input.amountCents, allocationOrderIds: [order.orderId], accountEvidence, balanceEvidence }));
  }
  return { ...f, policy, order, provider, control, service, actor, input, payoutId, prepare, reconcile };
}

for (const pauseAt of ['account', 'balance']) test(`service refuses a standard payout claim after runtime revocation during ${pauseAt} GET`, async t => {
  const f = await sandboxContractFixture(t); await f.prepare();
  const creates = f.control.creates, journalCount = f.store.read().journals.length;
  f.control.pauseAt = pauseAt;
  const result = f.service.withdraw(f.actor, f.input);
  const refused = assert.rejects(result, { code: 'RUNTIME_QUALIFICATION_REQUIRED' });
  await f.control.entered.promise;
  assert.equal(f.service.status().enabled, true);
  f.control.ready = false; f.control.resume.resolve(); await refused;
  const current = f.store.read(state => state.intents[f.payoutId]);
  assert.equal(current.status, 'PREPARED'); assert.equal(current.dispatchCount, 0); assert.equal(current.objectId, null);
  assert.equal(f.control.creates, creates); assert.equal(f.store.read().journals.length, journalCount);
  assert.equal(f.store.read(state => sellerBalance(state, f.actor.id)).withdrawingCents, 9200);
  // Ordinary service access remains gated. Once independently requalified, a
  // never-sent payout can be locally canceled with its exact reserved funds.
  f.control.ready = true;
  const canceled = await f.service.cancelWithdrawal(f.actor, { intentId: f.payoutId });
  assert.equal(canceled.status, 'VOIDED'); assert.equal(canceled.dispatchCount, 0);
  assert.equal(f.store.read(state => sellerBalance(state, f.actor.id)).availableCents, 9200);
  assert.equal(f.control.creates, creates);
});

test('dispatch readiness must be synchronous; rejected thenables roll back and cannot claim or create', async t => {
  const f = financeFixture(); t.after(() => f.store.close());
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy }));
  const args = { store: f.store, provider: f.provider, intentId: 'payment_one', enabled: true };
  let entered = 0;
  await assert.rejects(executeFinanceIntent({ ...args, assertDispatchReady: async () => { entered++; return true; } }), { code: 'FINANCE_DISPATCH_UNQUALIFIED' });
  assert.equal(entered, 0);
  await assert.rejects(executeFinanceIntent({ ...args, assertDispatchReady: tx => { tx.state.rejectedGuardWrite = true; return Promise.reject(new Error('mock async guard refused')); } }), { code: 'FINANCE_DISPATCH_UNQUALIFIED' });
  const state = f.store.read(); assert.equal(state.rejectedGuardWrite, undefined);
  assert.equal(state.intents.payment_one.status, 'PREPARED'); assert.equal(state.intents.payment_one.dispatchCount, 0);
  assert.equal(state.syntheticProvider.calls.payment_one, undefined);
});

test('revoked create readiness does not replace or block original-object GET recovery after a lost payout response', async t => {
  const f = await sandboxContractFixture(t); await f.prepare();
  const creates = f.control.creates;
  f.provider.failNextCreateAfterCommit(f.payoutId);
  await assert.rejects(f.service.withdraw(f.actor, f.input), { code: 'SYNTHETIC_RESPONSE_LOST' });
  assert.equal(f.store.read(state => state.intents[f.payoutId].status), 'UNKNOWN');
  f.control.ready = false;
  f.provider.resolve(f.payoutId, { status: 'paid' });
  // The host's separately qualified operational runner owns authorization for
  // this existing recovery API; a create gate is not a prerequisite for GET.
  const result = await f.reconcile(f.payoutId);
  const journals = f.store.read().journals.length;
  await f.reconcile(f.payoutId);
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(result.dispatchCount, 1); assert.equal(result.confirmed, true);
  assert.equal(f.control.creates, creates + 1); assert.equal(f.store.read().journals.length, journals);
  assert.equal(f.store.read(state => sellerBalance(state, f.actor.id)).paidOutCents, 9200);
  await assert.rejects(executeFinanceIntent({ store: f.store, provider: f.provider, intentId: f.payoutId, enabled: true, assertDispatchReady: () => false }), { code: 'RECONCILIATION_REQUIRED' });
});
