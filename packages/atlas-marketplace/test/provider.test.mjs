import test from 'node:test';
import assert from 'node:assert/strict';
import { createStripeSandboxProvider } from '../src/provider-stripe-sandbox.mjs';
import { SYNTHETIC_FINANCE_POLICY } from '../src/provider-synthetic.mjs';
import { NOW } from './finance-fixtures.mjs';

function fixture(overrides = {}) {
  const calls = [];
  const intent = { id: 'intent1', orderId: 'order1', bindingHash: 'binding1', kind: 'PAYMENT', amountCents: 10000, accountId: 'acct_platform', platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', status: 'DISPATCHING', idempotencyKey: 'durable-original-key', policy: { ...SYNTHETIC_FINANCE_POLICY, environment: 'stripe-sandbox' } };
  const metadata = { atlas_marketplace_intent: 'intent1', atlas_marketplace_order: 'order1', atlas_marketplace_binding: 'binding1' };
  const objects = {
    '/v1/account': { object: 'account', id: 'acct_platform' },
    '/v1/balance': { object: 'balance', livemode: false, available: [{ currency: 'usd', amount: 100000 }] },
    '/v1/payment_intents': { object: 'payment_intent', id: 'pi_test1' },
    '/v1/payment_intents/pi_test1': { object: 'payment_intent', id: 'pi_test1', amount: 10000, amount_received: 10000, currency: 'usd', livemode: false, status: 'succeeded', latest_charge: 'ch_test1', metadata },
    '/v1/charges/ch_test1': { object: 'charge', id: 'ch_test1', livemode: false, payment_intent: 'pi_test1', amount: 10000, amount_captured: 10000, currency: 'usd', paid: true, balance_transaction: 'txn_test1' },
    '/v1/balance_transactions/txn_test1': { object: 'balance_transaction', id: 'txn_test1', source: 'ch_test1', currency: 'usd', amount: 10000, fee: 300, net: 9700, status: 'available', available_on: NOW / 1000 },
    ...overrides,
  };
  const fetch = async (url, options) => {
    assert.ok(url.startsWith('https://api.stripe.com/v1/'));
    calls.push({ path: new URL(url).pathname, options });
    const value = objects[new URL(url).pathname];
    return { ok: Boolean(value), text: async () => JSON.stringify(value ?? {}) };
  };
  const config = { authorizedSandbox: true, secretKey: 'sk_test_OnlyExplicitMock', platformAccountId: 'acct_platform', allowedConnectedAccountIds: ['acct_seller'], apiVersion: '2025-09-30.clover', fetch, clock: () => NOW };
  return { calls, intent, objects, config, provider: createStripeSandboxProvider(config) };
}

test('sandbox adapter is explicitly authorized, test-key-only, account pinned and sends exact immutable metadata', async () => {
  assert.throws(() => createStripeSandboxProvider(), { code: 'STRIPE_SANDBOX_NOT_AUTHORIZED' });
  const f = fixture();
  assert.throws(() => createStripeSandboxProvider({ ...f.config, secretKey: 'sk_live_refused' }), { code: 'STRIPE_TEST_KEY_REQUIRED' });
  const result = await f.provider.create(f.intent); assert.equal(result.objectId, 'pi_test1');
  const request = f.calls.find(call => call.options.method === 'POST');
  assert.equal(request.options.headers['Idempotency-Key'], 'durable-original-key');
  const body = new URLSearchParams(request.options.body);
  assert.equal(body.get('amount'), '10000'); assert.equal(body.get('metadata[atlas_marketplace_intent]'), 'intent1');
  assert.equal(body.get('transfer_data[destination]'), null); assert.equal(body.get('application_fee_amount'), null);
  const evidence = await f.provider.retrieve(f.intent, { objectId: result.objectId });
  assert.equal(evidence.chargeCapturedCents, 10000); assert.equal(evidence.balanceTransaction.feeCents, 300); assert.equal(evidence.livemode, false);
  assert.equal(await f.provider.retrieve(f.intent, {}), null);
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
});

test('adapter refuses live objects, changed intent metadata and mismatched charge without falling back or retrying', async () => {
  for (const mutation of [object => { object.livemode = true; }, object => { object.metadata.atlas_marketplace_intent = 'other'; }]) {
    const f = fixture(); mutation(f.objects['/v1/payment_intents/pi_test1']);
    await assert.rejects(f.provider.retrieve(f.intent, { objectId: 'pi_test1' }));
    assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 0);
  }
  const f = fixture(); f.objects['/v1/charges/ch_test1'].payment_intent = 'pi_other';
  await assert.rejects(f.provider.retrieve(f.intent, { objectId: 'pi_test1' }), { code: 'STRIPE_CHARGE_MISMATCH' });
  await assert.rejects(f.provider.getBalance('acct_other'), { code: 'STRIPE_ACCOUNT_SCOPE_MISMATCH' });
});

test('Stripe-shaped refund, transfer, reversal and failed payout bind both account books and parent objects', async () => {
  const f = fixture();
  const metadata = { atlas_marketplace_intent: 'intent1', atlas_marketplace_order: 'order1', atlas_marketplace_binding: 'binding1' };
  const transaction = (id, source, amount) => ({ id, object: 'balance_transaction', source, amount, currency: 'usd', fee: 0, net: amount, status: 'available', available_on: NOW / 1000 });
  Object.assign(f.objects, {
    '/v1/refunds/re_test1': { object: 'refund', id: 're_test1', amount: 10000, currency: 'usd', metadata, charge: 'ch_test1', status: 'succeeded', balance_transaction: 'txn_refund' },
    '/v1/balance_transactions/txn_refund': transaction('txn_refund', 're_test1', -10000),
    '/v1/transfers/tr_test1': { object: 'transfer', id: 'tr_test1', amount: 10000, currency: 'usd', metadata, livemode: false, destination: 'acct_seller', source_transaction: 'ch_test1', destination_payment: 'py_test1', balance_transaction: 'txn_transfer' },
    '/v1/balance_transactions/txn_transfer': transaction('txn_transfer', 'tr_test1', -10000),
    '/v1/charges/py_test1': { object: 'charge', id: 'py_test1', livemode: false, amount: 10000, currency: 'usd', source_transfer: 'tr_test1', balance_transaction: 'txn_connected' },
    '/v1/balance_transactions/txn_connected': transaction('txn_connected', 'py_test1', 10000),
    '/v1/transfers/tr_test1/reversals/trr_test1': { object: 'transfer_reversal', id: 'trr_test1', amount: 10000, currency: 'usd', metadata, transfer: 'tr_test1', destination_payment_refund: 'pyr_test1', balance_transaction: 'txn_reversal' },
    '/v1/balance_transactions/txn_reversal': transaction('txn_reversal', 'trr_test1', 10000),
    '/v1/refunds/pyr_test1': { object: 'refund', id: 'pyr_test1', amount: 10000, currency: 'usd', charge: 'py_test1', balance_transaction: 'txn_connectedrev' },
    '/v1/balance_transactions/txn_connectedrev': transaction('txn_connectedrev', 'pyr_test1', -10000),
    '/v1/payouts/po_test1': { object: 'payout', id: 'po_test1', amount: 10000, currency: 'usd', metadata: { ...metadata, atlas_marketplace_order: '' }, livemode: false, status: 'failed', automatic: false, method: 'standard', type: 'bank_account', destination: 'ba_test1', balance_transaction: 'txn_payout', failure_balance_transaction: 'txn_return' },
    '/v1/balance_transactions/txn_payout': transaction('txn_payout', 'po_test1', -10000),
    '/v1/balance_transactions/txn_return': transaction('txn_return', 'po_test1', 10000),
  });
  const refund = await f.provider.retrieve({ ...f.intent, kind: 'REFUND', parentObjectId: 'ch_test1' }, { objectId: 're_test1' });
  assert.equal(refund.parentObjectId, 'ch_test1'); assert.equal(refund.balanceTransaction.netCents, -10000);
  const transfer = await f.provider.retrieve({ ...f.intent, kind: 'TRANSFER', parentObjectId: 'ch_test1' }, { objectId: 'tr_test1' });
  assert.equal(transfer.connectedBalanceTransaction.netCents, 10000);
  const reversal = await f.provider.retrieve({ ...f.intent, kind: 'REVERSAL', parentObjectId: 'tr_test1' }, { objectId: 'trr_test1' });
  assert.equal(reversal.connectedBalanceTransaction.netCents, -10000);
  const payout = await f.provider.retrieve({ ...f.intent, kind: 'PAYOUT', accountId: 'acct_seller', externalAccountId: 'ba_test1', orderId: null }, { objectId: 'po_test1' });
  assert.equal(payout.failureBalanceTransaction.netCents, 10000);
  for (const path of ['/v1/charges/py_test1', '/v1/balance_transactions/txn_connected', '/v1/refunds/pyr_test1', '/v1/payouts/po_test1']) assert.equal(f.calls.find(call => call.path === path).options.headers['Stripe-Account'], 'acct_seller');
  assert.ok(f.calls.every(call => call.options.method === 'GET'));
});

test('payment collection exposes only the exact original test PaymentIntent capability and rejects already-collected or foreign objects', async () => {
  const f = fixture();
  Object.assign(f.objects['/v1/payment_intents/pi_test1'], { amount_received: 0, status: 'requires_payment_method', latest_charge: null, capture_method: 'automatic', confirmation_method: 'automatic', client_secret: 'pi_test1_secret_explicitMock' });
  const provider = createStripeSandboxProvider({ ...f.config, publishableKey: 'pk_test_ExplicitMock' });
  const intent = { ...f.intent, objectId: 'pi_test1' };
  const collection = await provider.getPaymentCollection(intent);
  assert.deepEqual(collection, { strategy: 'stripe-payment-element', paymentIntentId: 'pi_test1', clientSecret: 'pi_test1_secret_explicitMock', publishableKey: 'pk_test_ExplicitMock', amountCents: 10000, currency: 'USD' });
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 0);
  f.objects['/v1/payment_intents/pi_test1'].amount_received = 1;
  await assert.rejects(provider.getPaymentCollection(intent), { code: 'PAYMENT_NOT_COLLECTIBLE' });
  f.objects['/v1/payment_intents/pi_test1'].amount_received = 0;
  f.objects['/v1/payment_intents/pi_test1'].client_secret = 'pi_other_secret_wrong';
  await assert.rejects(provider.getPaymentCollection(intent), { code: 'STRIPE_CLIENT_SECRET_MISMATCH' });
});

test('hosted onboarding requires explicit account policy and HTTPS return origins, with no invented account/controller settings', async () => {
  const f = fixture({ '/v1/account_links': { object: 'account_link', expires_at: NOW / 1000 + 300, url: 'https://connect.stripe.com/setup/explicitMock' } });
  const provider = createStripeSandboxProvider({ ...f.config, allowedReturnOrigins: ['https://marketplace.example'] });
  const input = { accountId: 'acct_seller', refreshUrl: 'https://marketplace.example/onboarding/refresh', returnUrl: 'https://marketplace.example/onboarding/return', collectionFields: 'eventually_due', policyEvidence: { approved: true, accountId: 'acct_seller', policyVersion: 'fixture-policy', evidenceRef: 'fixture-reviewed-onboarding' } };
  await assert.rejects(provider.createOnboardingLink({ ...input, returnUrl: 'https://attacker.example/' }), { code: 'STRIPE_RETURN_URL_REJECTED' });
  await assert.rejects(provider.createOnboardingLink({ ...input, policyEvidence: null }), { code: 'CONNECT_POLICY_REQUIRED' });
  const result = await provider.createOnboardingLink(input);
  assert.equal(result.status, 'ONBOARDING_REQUIRED');
  const posts = f.calls.filter(call => call.options.method === 'POST'); assert.equal(posts.length, 1); assert.equal(posts[0].path, '/v1/account_links');
  const params = new URLSearchParams(posts[0].options.body);
  assert.equal(params.get('account'), 'acct_seller'); assert.equal(params.get('collection_options[fields]'), 'eventually_due');
  assert.equal(params.get('type'), 'account_onboarding');
});

test('dispute retrieval verifies original charge and exact debit/reinstatement, while discovery never creates replacement objects', async () => {
  const f = fixture();
  const transaction = (id, amount, fee = 0) => ({ id, object: 'balance_transaction', source: 'du_test1', amount, currency: 'usd', fee, net: amount - fee, status: 'available', available_on: NOW / 1000 });
  Object.assign(f.objects, {
    '/v1/disputes/du_test1': { id: 'du_test1', object: 'dispute', charge: 'ch_test1', payment_intent: 'pi_test1', amount: 10000, currency: 'usd', status: 'won', livemode: false, balance_transactions: ['txn_dispute', 'txn_reinstate'] },
    '/v1/balance_transactions/txn_dispute': transaction('txn_dispute', -10000, 1500),
    '/v1/balance_transactions/txn_reinstate': transaction('txn_reinstate', 10000),
  });
  const payment = { ...f.intent, objectId: 'pi_test1', chargeId: 'ch_test1', confirmed: true };
  const dispute = await f.provider.retrieveDispute(payment, { objectId: 'du_test1' });
  assert.equal(dispute.balanceTransaction.netCents, -11500); assert.equal(dispute.reinstatementBalanceTransaction.netCents, 10000);
  f.objects['/v1/payment_intents'] = { object: 'list', has_more: false, data: [f.objects['/v1/payment_intents/pi_test1']] };
  assert.deepEqual(await f.provider.discover(f.intent), { objectId: 'pi_test1', complete: true });
  f.objects['/v1/disputes/du_test1'].charge = 'ch_other';
  await assert.rejects(f.provider.retrieveDispute(payment, { objectId: 'du_test1' }), { code: 'STRIPE_DISPUTE_MISMATCH' });
  assert.ok(f.calls.every(call => call.options.method === 'GET'));
});

// These are mock strings and mock HTTP responses. This test is not live qualification.
test('production adapter has no default activation, requires branded approvals, and refuses test/live evidence mixing', async () => {
  const { createStripeAuthorization, createStripeProvider, STRIPE_PRODUCTION_APPROVAL_REFS } = await import('../src/provider-stripe.mjs');
  const f = fixture();
  const approvalRefs = Object.fromEntries(STRIPE_PRODUCTION_APPROVAL_REFS.map(key => [key, `mock-only-${key}`]));
  const input = { environment: 'PRODUCTION', platformAccountId: 'acct_platform', allowedConnectedAccountIds: ['acct_seller'], apiVersion: f.config.apiVersion, approvalRefs };
  assert.throws(() => createStripeAuthorization(), { code: 'STRIPE_ENVIRONMENT_REQUIRED' });
  assert.throws(() => createStripeAuthorization({ ...input, approvalRefs: {} }), { code: 'STRIPE_PRODUCTION_APPROVALS_REQUIRED' });
  const authorization = createStripeAuthorization(input);
  assert.throws(() => createStripeProvider({ authorization: { ...authorization }, secretKey: 'sk_live_MOCKONLY', liveExecutionEnabled: true }), { code: 'STRIPE_AUTHORIZATION_REQUIRED' });
  assert.throws(() => createStripeProvider({ authorization, secretKey: 'sk_live_MOCKONLY' }), { code: 'STRIPE_LIVE_EXECUTION_DISABLED' });
  assert.throws(() => createStripeProvider({ authorization, secretKey: 'sk_test_MOCKONLY', liveExecutionEnabled: true }), { code: 'STRIPE_LIVE_KEY_REQUIRED' });
  assert.equal(f.calls.length, 0);
  const provider = createStripeProvider({ authorization, secretKey: 'sk_live_MOCKONLY', publishableKey: 'pk_live_MOCKONLY', liveExecutionEnabled: true, fetch: f.config.fetch, clock: () => NOW });
  await assert.rejects(provider.getIdentity(), { code: 'STRIPE_MODE_MISMATCH' });
  f.objects['/v1/balance'].livemode = true;
  f.objects['/v1/payment_intents/pi_test1'].livemode = true;
  f.objects['/v1/charges/ch_test1'].livemode = true;
  const identity = await provider.getIdentity(); assert.equal(identity.environment, 'PRODUCTION'); assert.equal(identity.livemode, true);
  const intent = { ...f.intent, policy: { ...f.intent.policy, environment: 'stripe-production' } };
  assert.equal((await provider.retrieve(intent, { objectId: 'pi_test1' })).livemode, true);
  await assert.rejects(provider.retrieve(f.intent, { objectId: 'pi_test1' }), { code: 'STRIPE_INTENT_SCOPE_MISMATCH' });
  f.objects['/v1/charges/ch_test1'].livemode = false;
  await assert.rejects(provider.retrieve(intent, { objectId: 'pi_test1' }), { code: 'STRIPE_CHARGE_MISMATCH' });
  assert.ok(f.calls.every(call => call.options.method === 'GET'));
  assert.throws(() => createStripeSandboxProvider({ ...f.config, secretKey: 'sk_live_MOCKONLY', liveExecutionEnabled: true }), { code: 'STRIPE_TEST_KEY_REQUIRED' });
});

test('balance inventory is paginated and mode-scoped, with exact amount/source and no implicit financial adjustment', async () => {
  const f = fixture();
  f.objects['/v1/balance'].pending = [{ currency: 'usd', amount: 300 }];
  f.objects['/v1/balance_transactions'] = { object: 'list', has_more: false, data: [{ object: 'balance_transaction', id: 'txn_external', source: null, currency: 'usd', amount: -100, fee: 0, net: -100, status: 'available', available_on: NOW / 1000, created: NOW / 1000, type: 'stripe_fee' }] };
  const balance = await f.provider.getAccountSnapshot('acct_platform'); assert.equal(balance.totalCents, 100300);
  const inventory = await f.provider.listBalanceTransactions({ accountId: 'acct_platform', fromMs: NOW, toMs: NOW + 1000 });
  assert.equal(inventory.complete, true); assert.equal(inventory.transactions[0].sourceIsNull, true); assert.equal(inventory.transactions[0].netCents, -100);
  f.objects['/v1/balance_transactions'].data[0].created = NOW / 1000 - 1;
  await assert.rejects(f.provider.listBalanceTransactions({ accountId: 'acct_platform', fromMs: NOW, toMs: NOW + 1000 }), { code: 'STRIPE_TRANSACTION_WINDOW_MISMATCH' });
  assert.ok(f.calls.every(call => call.options.method === 'GET'));
});

test('external payout-bank eligibility uses documented new status and account permission, without claiming ownership verification', async () => {
  const f = fixture({
    '/v1/accounts/acct_seller': { object: 'account', id: 'acct_seller', payouts_enabled: true, capabilities: { transfers: 'active' }, settings: { payouts: { schedule: { interval: 'manual' } } }, requirements: { disabled_reason: null, currently_due: [], past_due: [], errors: [], pending_verification: [] } },
    '/v1/accounts/acct_seller/external_accounts': { object: 'list', has_more: false, data: [{ object: 'bank_account', id: 'ba_payout', account: 'acct_seller', currency: 'usd', status: 'new', available_payout_methods: ['standard'], requirements: null, future_requirements: null }] }
  });
  const result = await f.provider.getAccount('acct_seller');
  assert.deepEqual(result.payoutEligibleExternalAccountIds, ['ba_payout']);
  assert.deepEqual(result.verifiedExternalAccountIds, result.payoutEligibleExternalAccountIds); // historical alias only
  assert.equal(result.bankAccounts[0].qualification, 'STRIPE_PAYOUT_ELIGIBLE'); assert.equal(result.bankAccounts[0].status, 'new');
  assert.equal(Object.hasOwn(result.bankAccounts[0], 'ownershipVerified'), false);
  const bank = f.objects['/v1/accounts/acct_seller/external_accounts'].data[0];
  for (const status of ['verified','validated','errored','verification_failed','tokenized_account_number_deactivated','unknown']) {
    bank.status = status; const denied = await f.provider.getAccount('acct_seller'); assert.deepEqual(denied.payoutEligibleExternalAccountIds, []); assert.equal(denied.bankAccounts[0].qualification, 'UNAVAILABLE');
  }
  assert.ok(f.calls.every(call => call.options.method === 'GET'));
});

test('payout-bank eligibility refuses wrong ownership/currency/method, incomplete inventory and unresolved bank or parent requirements', async () => {
  const account = { object: 'account', id: 'acct_seller', payouts_enabled: true, capabilities: { transfers: 'active' }, settings: { payouts: { schedule: { interval: 'manual' } } }, requirements: { disabled_reason: null, currently_due: [], past_due: [], errors: [], pending_verification: [] } };
  const bank = { object: 'bank_account', id: 'ba_payout', account: 'acct_seller', currency: 'usd', status: 'new', available_payout_methods: ['standard'] };
  const mutations = [
    (_a,b) => { b.account = 'acct_other'; }, (_a,b) => { delete b.account; }, (_a,b) => { b.currency = 'eur'; },
    (_a,b) => { b.available_payout_methods = ['instant']; }, (_a,b) => { delete b.available_payout_methods; },
    ...['currently_due','past_due','pending_verification','errors'].map(key => (_a,b) => { b.requirements = { [key]: ['unresolved'] }; }),
    (_a,b) => { b.future_requirements = { pending_verification: ['ownership'] }; },
    (a) => { a.requirements.pending_verification = ['verification']; }, (a) => { a.requirements.currently_due = ['bank']; },
    (a) => { a.payouts_enabled = false; }, (a) => { a.capabilities.transfers = 'pending'; },
    (a) => { a.settings.payouts.schedule.interval = 'daily'; }
  ];
  for (const mutate of mutations) {
    const a = structuredClone(account), b = structuredClone(bank); mutate(a,b);
    const f = fixture({ '/v1/accounts/acct_seller': a, '/v1/accounts/acct_seller/external_accounts': { object: 'list', has_more: false, data: [b] } });
    assert.deepEqual((await f.provider.getAccount('acct_seller')).payoutEligibleExternalAccountIds, []);
  }
  const f = fixture({ '/v1/accounts/acct_seller': account, '/v1/accounts/acct_seller/external_accounts': { object: 'list', has_more: true, data: [bank] } });
  await assert.rejects(f.provider.getAccount('acct_seller'), { code: 'STRIPE_EXTERNAL_ACCOUNTS_INCOMPLETE' });
});
