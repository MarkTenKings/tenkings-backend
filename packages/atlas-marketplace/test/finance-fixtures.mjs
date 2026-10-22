import { openLocalStore } from '../src/store.mjs';
import { createSyntheticProvider, SYNTHETIC_FINANCE_POLICY } from '../src/provider-synthetic.mjs';
import { preparePayment, prepareTransfer, preparePayout } from '../src/finance.mjs';
import { executeFinanceIntent, reconcileFinanceIntent } from '../src/payment.mjs';

export const NOW = 1792699200000;
export function financeFixture({ filename = ':memory:', clock = () => NOW } = {}) {
  const store = openLocalStore({ filename, clock, environment: 'SYNTHETIC_LOCAL' });
  const provider = createSyntheticProvider({ store, clock, enabled: true });
  provider.configureAccount({ accountId: 'acct_platform', availableCents: 1000000 });
  provider.configureAccount({ accountId: 'acct_seller', availableCents: 0 });
  const policy = { ...SYNTHETIC_FINANCE_POLICY };
  const order = { orderId: 'order_one', reservationId: 'reservation_one', listingId: 'listing_one', cardId: 'card_one', sellerId: 'seller_one', buyerId: 'buyer_one', currency: 'USD', totalCents: 11200, itemCents: 10000, feeCents: 800, sellerNetCents: 9200, taxCents: 700, shippingCents: 500, policyVersion: policy.version, bindingHash: 'binding_one' };
  const execute = intentId => executeFinanceIntent({ store, provider, intentId, enabled: true });
  const reconcile = intentId => reconcileFinanceIntent({ store, provider, intentId });
  const resolve = async (intentId, options) => { provider.resolve(intentId, options); return reconcile(intentId); };
  async function paid() {
    store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy }));
    await execute('payment_one');
    return resolve('payment_one', { status: 'succeeded', processingFeeCents: 300 });
  }
  async function transferred({ settlement = 'available' } = {}) {
    if (!store.read(state => state.intents.payment_one?.confirmed ?? false)) await paid();
    const accountEvidence = await provider.getAccount('acct_seller');
    store.transaction(tx => prepareTransfer(tx, { intentId: 'transfer_one', paymentIntentId: 'payment_one', releaseEvidence: { approved: true, orderId: order.orderId, bindingHash: order.bindingHash, policyVersion: policy.version, releasedAt: NOW, evidenceRef: 'fixture-delivered-and-inspected' }, accountEvidence }));
    await execute('transfer_one');
    return resolve('transfer_one', { status: 'succeeded', settlement });
  }
  async function payout({ amountCents = 9200, intentId = 'payout_one' } = {}) {
    const accountEvidence = await provider.getAccount('acct_seller'), balanceEvidence = await provider.getBalance('acct_seller');
    store.transaction(tx => preparePayout(tx, { intentId, sellerId: order.sellerId, connectedAccountId: 'acct_seller', externalAccountId: 'ba_synthetic', amountCents, allocationOrderIds: [order.orderId], accountEvidence, balanceEvidence }));
    await execute(intentId);
    return intentId;
  }
  return { store, provider, policy, order, clock, paid, transferred, payout, execute, reconcile, resolve };
}
