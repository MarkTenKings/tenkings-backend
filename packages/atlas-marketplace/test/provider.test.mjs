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
