import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../src/contract.mjs';
import { createPilotShippingPricing, createShippingPricingReceipt, assertShippingPricingReceipt, allocateShippingRefund } from '../src/shipping-pricing.mjs';
import { createApprovedCheckoutQuoteProvider, CHECKOUT_PRICED_SHIPPING_POLICY_SCHEMA } from '../src/checkout-quote.mjs';
import { createApprovedFeeCalculator } from '../src/fee-policy.mjs';
import { createListing } from '../src/listing.mjs';
import { reserveListing, markReservationPaymentPending, settleReservation } from '../src/reservation.mjs';
import { preparePayment, prepareRefund, reconcileFinance } from '../src/finance.mjs';
import { accountBalance, assertJournal } from '../src/ledger.mjs';
import { makeListingInput, makeTestTx, FIXTURE_NOW } from './listing-fixtures.mjs';
import { makeCheckoutPolicy, makeQuoteAdapters, makeFeeSchedule, makeScheduledListingPolicy } from './policy-quote-fixtures.mjs';
import { financeFixture } from './finance-fixtures.mjs';
import { taxFixture, input as taxInput, calculation, json } from './provider-quote-fixtures.mjs';

const policyInput = extra => ({ id: 'demo_shipping_pricing', version: 'fixture-v1', environment: 'SYNTHETIC_LOCAL', approvalRef: 'EXPLICIT_TEST_APPROVAL_NOT_RUNTIME_AUTHORITY', effectiveAt: new Date(FIXTURE_NOW-1000).toISOString(), expiresAt: new Date(FIXTURE_NOW+3600000).toISOString(), shippingTaxCode: 'txcd_99999998', maxBuyerChargeCents: 100000, ...extra });
const pricing = extra => createPilotShippingPricing(policyInput(extra));
const costReceipt = amountCents => ({ requestHash: hash('mock shipping request'), quoteRef: 'demo_carrier_rate', amountCents, currency: 'USD', policyRef: 'MOCK_CARRIER_POLICY', issuedAt: new Date(FIXTURE_NOW).toISOString(), expiresAt: new Date(FIXTURE_NOW+120000).toISOString(), deliveryEstimate: 'Mock transit estimate' });
const receipt = (amountCents, policy = pricing()) => createShippingPricingReceipt({ policy, providerReceipt: costReceipt(amountCents), issuedAt: new Date(FIXTURE_NOW).toISOString(), expiresAt: new Date(FIXTURE_NOW+120000).toISOString() });
const checkoutPolicy = shippingPricing => makeCheckoutPolicy({ schema: CHECKOUT_PRICED_SHIPPING_POLICY_SCHEMA, shippingPricing });
const quoteInput = listing => ({ listing, buyerId: 'demo_buyer', destinationId: 'demo_destination' });
function composer(policy, adapters = makeQuoteAdapters()) {
  return createApprovedCheckoutQuoteProvider({ enabled: true, policy, approvalRef: 'MOCK_CHECKOUT_APPROVAL', assertReady: () => true, clock: () => FIXTURE_NOW, ...adapters });
}

test('explicit $3 policy is bounded and immutable; disabled and legacy pass-through checkouts do not infer a charge', async () => {
  await assert.rejects(createApprovedCheckoutQuoteProvider()({}), { code: 'CHECKOUT_QUOTE_UNAVAILABLE' });
  const p = pricing(); assert.equal(p.handlingCents, 300); assert.equal(Object.isFrozen(p), true);
  assert.throws(() => createPilotShippingPricing({ ...policyInput(), handlingCents: 300 }), { code: 'SHIPPING_PRICING_INPUT_REQUIRED' });
  assert.throws(() => pricing({ maxBuyerChargeCents: 299 }), { code: 'SHIPPING_PRICING_POLICY_INVALID' });
  assert.throws(() => pricing({ shippingTaxCode: undefined }), { code: 'SHIPPING_PRICING_POLICY_INVALID' });
  assert.throws(() => receipt(1200, pricing({ maxBuyerChargeCents: 1499 })), { code: 'SHIPPING_PRICING_AMOUNT_MISMATCH' });
  assert.throws(() => receipt(Number.MAX_SAFE_INTEGER), { code: 'CENTS_OVERFLOW' });
  assert.throws(() => composer({ ...checkoutPolicy(p), taxBasis: 'ITEM_ONLY' }), { code: 'SHIPPING_PRICING_TAX_BASIS_REQUIRED' });
  assert.throws(() => composer({ ...makeCheckoutPolicy(), shippingPricing: p }), { code: 'CHECKOUT_POLICY_INVALID' });
  const listing = createListing(makeTestTx(), makeListingInput());
  for (const amountCents of [0, 1200]) {
    const adapters = makeQuoteAdapters(), original = adapters.shipping.quote;
    adapters.shipping.quote = async input => ({ ...await original(input), amountCents });
    const q = await composer(makeCheckoutPolicy(), adapters)(quoteInput(listing));
    assert.equal(q.shippingCents, amountCents); assert.equal(q.shippingPricing, undefined);
  }
  const zeroCarrier = receipt(0); assert.equal(zeroCarrier.buyerChargeCents, 300);
});

test('composed quote, reservation, exact payment and paid order retain carrier cost separately from full taxed buyer shipping', async t => {
  const f = financeFixture({ clock: () => FIXTURE_NOW }); t.after(() => f.store.close());
  const schedule = makeFeeSchedule({ tiers: [{ upToCents: null, rateBps: 800, fixedCents: 0 }] }), listingPolicy = makeScheduledListingPolicy(schedule);
  const calculator = createApprovedFeeCalculator({ enabled: true, schedule, approvalRef: 'MOCK_FEE_APPROVAL', assertReady: () => true, clock: () => FIXTURE_NOW });
  const feeQuote = calculator.preview({ policy: listingPolicy, cardId: 'demo_card', sellerId: 'demo_seller', askingPriceCents: 12500 });
  const listing = f.store.transaction(tx => { tx.state.consent = makeTestTx().state.consent; return createListing(tx, makeListingInput({ policy: listingPolicy, feeQuote })); });
  const adapters = makeQuoteAdapters(), provider = composer(checkoutPolicy(pricing()), adapters);
  const quote = await provider(quoteInput(listing));
  assert.equal(listing.feeCents, 1000); assert.equal(listing.sellerNetCents, 11500);
  assert.equal(quote.shippingReceipt.amountCents, 1200); assert.equal(quote.shippingCents, 1500); assert.equal(quote.totalCents, 14750);
  assert.equal(quote.shippingPricing.quotedCarrierCostCents, 1200); assert.equal(quote.shippingPricing.handlingCents, 300);
  assert.equal(quote.shippingPricing.costStatus, 'QUOTED_NOT_SETTLED');
  assert.equal(adapters.calls[1].shippingCents, 1500); assert.equal(adapters.calls[1].basisCents, 14000);
  assert.equal(adapters.calls[1].shippingTaxCode, pricing().shippingTaxCode); assert.equal(adapters.calls[1].shippingPricingReceiptHash, quote.shippingPricing.receiptHash);
  const reservation = f.store.transaction(tx => reserveListing(tx, { requestId: 'demo_reserve', reservationId: 'demo_reservation', listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, buyerId: 'demo_buyer', eligibility: makeListingInput().eligibility, quote }));
  assert.deepEqual(reservation.order.shippingPricing, quote.shippingPricing);
  f.store.transaction(tx => {
    preparePayment(tx, { intentId: 'demo_payment', order: reservation.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: { ...f.policy, version: reservation.order.policyVersion } });
    return markReservationPaymentPending(tx, { reservationId: reservation.id, paymentIntentId: 'demo_payment', eligibility: makeListingInput().eligibility });
  });
  await f.execute('demo_payment'); f.provider.resolve('demo_payment', { status: 'succeeded', processingFeeCents: 300 }); await f.reconcile('demo_payment');
  const order = f.store.transaction(tx => settleReservation(tx, { reservationId: reservation.id, paymentIntentId: 'demo_payment', orderId: reservation.orderId }));
  assert.deepEqual(order.shippingPricing, quote.shippingPricing); assert.deepEqual(order.quote.shippingPricing, quote.shippingPricing);
  const state = f.store.read(), book = 'platform:acct_platform';
  assert.equal(accountBalance(state, book, `shipping_carrier_deferred:${order.orderId}`), -1200);
  assert.equal(accountBalance(state, book, `shipping_handling_deferred:${order.orderId}`), -300);
  assert.equal(accountBalance(state, book, 'fee_revenue'), -1000);
  assert.equal(state.journals.flatMap(entry => entry.lines).some(line => /shipping_(expense|profit|revenue)/.test(line.account)), false);
  assert.equal(assertJournal(state.journals), true);
});

test('pricing receipt and cost binding fail closed on repricing, stale terms, missing receipts and arithmetic drift', async () => {
  const tx = makeTestTx(), listing = createListing(tx, makeListingInput()), policy = checkoutPolicy(pricing()), provider = composer(policy), quote = await provider(quoteInput(listing));
  for (const change of [q => q.shippingPricing.quotedCarrierCostCents++, q => q.shippingReceipt.amountCents++, q => delete q.shippingPricing]) {
    const changed = structuredClone(quote); change(changed); const { receiptHash, ...content } = changed; changed.receiptHash = hash(content);
    assert.throws(() => provider.assertCurrent(changed, quoteInput(listing)), error => ['SHIPPING_PRICING_RECEIPT_INVALID','SHIPPING_COST_BINDING_MISMATCH','SHIPPING_PRICING_POLICY_MISMATCH'].includes(error.code));
  }
  assert.throws(() => assertShippingPricingReceipt(quote.shippingPricing, { now: Date.parse(quote.shippingPricing.expiresAt) }), { code: 'SHIPPING_PRICING_EXPIRED' });
  const adapters = makeQuoteAdapters(), expired = composer(checkoutPolicy(pricing({ expiresAt: new Date(FIXTURE_NOW).toISOString() })), adapters);
  await assert.rejects(expired(quoteInput(listing)), { code: 'SHIPPING_PRICING_POLICY_EXPIRED' }); assert.equal(adapters.calls.length, 0);
});

test('Stripe Tax receives the full buyer charge and exact independently configured shipping tax code', async () => {
  const calls = [], f = taxFixture({ fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); if (url.endsWith('/v1/account')) return json({ id: 'acct_SYNTHETIC' });
    const value = calculation(options.body); value.amount_total = value.line_items.data[0].amount + value.shipping_cost.amount + value.tax_amount_exclusive; return json(value);
  } });
  const request = { ...taxInput('tax'), shippingCents: 1500, basisCents: 11500, shippingPricingReceiptHash: hash('private pricing receipt'), shippingTaxCode: f.config.shippingTaxCode };
  await assert.rejects(f.adapter.quote({ ...request, shippingTaxCode: 'txcd_00000000' }), { code: 'TAX_SHIPPING_PRICING_MISMATCH' }); assert.equal(calls.length, 0);
  const result = await f.adapter.quote(request), wire = new URLSearchParams(calls.find(call => call.method === 'POST').body);
  assert.equal(wire.get('shipping_cost[amount]'), '1500'); assert.equal(wire.get('shipping_cost[tax_code]'), f.config.shippingTaxCode); assert.equal(result.basisCents, 11500);
  const wrong = taxFixture({ fetchImpl: async (url, options) => {
    if (url.endsWith('/v1/account')) return json({ id: 'acct_SYNTHETIC' });
    const value = calculation(options.body); value.shipping_cost.amount = 1200; return json(value);
  } });
  await assert.rejects(wrong.adapter.quote(request), { code: 'TAX_TOTAL_MISMATCH' });
});

test('partial shipping refunds reserve both components, reconcile lost responses once, and consume the final cent remainder', async t => {
  const f = financeFixture({ clock: () => FIXTURE_NOW }); t.after(() => f.store.close());
  const shippingPricing = receipt(333), order = { ...f.order, taxCents: 0, shippingCents: 633, totalCents: 10633, shippingPricing };
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy }));
  await f.execute('payment_one'); f.provider.resolve('payment_one', { status: 'succeeded' }); await f.reconcile('payment_one');
  const refund = (id, shippingCents) => f.store.transaction(tx => prepareRefund(tx, { intentId: id, paymentIntentId: 'payment_one', amountCents: shippingCents, allocations: { sellerCents: 0, feeCents: 0, taxCents: 0, shippingCents }, policyEvidence: { approved: true, orderId: order.orderId, policyVersion: f.policy.version, evidenceRef: `review_${id}` } }));
  const amounts = [1, 2, 100, 530], saved = amounts.map((amount, index) => refund(`refund_${index}`, amount));
  assert.equal(saved.reduce((total, row) => total + row.shippingRefundAttribution.carrierCents, 0), 333);
  assert.equal(saved.reduce((total, row) => total + row.shippingRefundAttribution.handlingCents, 0), 300);
  assert.throws(() => refund('refund_excess', 1), { code: 'EXCESS_REFUND_ALLOCATION' });
  f.provider.failNextCreateAfterCommit('refund_1');
  await assert.rejects(f.execute('refund_1'), { code: 'SYNTHETIC_RESPONSE_LOST' });
  assert.throws(() => refund('refund_unknown_replacement', 1), { code: 'EXCESS_REFUND_ALLOCATION' });
  for (const index of [3, 1, 0, 2]) {
    const id = `refund_${index}`; if (index !== 1) await f.execute(id);
    f.provider.resolve(id, { status: 'succeeded' }); await f.reconcile(id); await f.reconcile(id);
  }
  const state = f.store.read(), book = 'platform:acct_platform';
  assert.equal(accountBalance(state, book, `shipping_carrier_deferred:${order.orderId}`), 0);
  assert.equal(accountBalance(state, book, `shipping_handling_deferred:${order.orderId}`), 0);
  assert.equal(accountBalance(state, book, 'fee_revenue'), -800);
  for (let index = 0; index < amounts.length; index++) assert.equal(state.syntheticProvider.calls[`refund_${index}`], 1);
  assert.equal(assertJournal(state.journals), true);
  assert.deepEqual(allocateShippingRefund(receipt(300), 1), { carrierCents: 1, handlingCents: 0 }); // Exact half-cent rounds up.
});

test('a provider-proven unpaid refund releases only its reserved shipping attribution for a separately reviewed later refund', async t => {
  const f = financeFixture({ clock: () => FIXTURE_NOW }); t.after(() => f.store.close());
  const shippingPricing = receipt(1), order = { ...f.order, shippingCents: 301, totalCents: f.order.itemCents + f.order.taxCents + 301, shippingPricing };
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy }));
  await f.execute('payment_one'); f.provider.resolve('payment_one', { status: 'succeeded' }); await f.reconcile('payment_one');
  const prepare = id => f.store.transaction(tx => prepareRefund(tx, { intentId: id, paymentIntentId: 'payment_one', amountCents: 301, allocations: { sellerCents: 0, feeCents: 0, taxCents: 0, shippingCents: 301 }, policyEvidence: { approved: true, orderId: order.orderId, policyVersion: f.policy.version, evidenceRef: `review_${id}` } }));
  prepare('failed_refund'); await f.execute('failed_refund');
  assert.throws(() => prepare('later_refund'), { code: 'EXCESS_REFUND_ALLOCATION' });
  f.provider.resolve('failed_refund', { status: 'failed' }); await f.reconcile('failed_refund');
  assert.deepEqual(prepare('later_refund').shippingRefundAttribution, { carrierCents: 1, handlingCents: 300 });
  await f.execute('later_refund'); f.provider.resolve('later_refund', { status: 'succeeded' }); await f.reconcile('later_refund');
  const state = f.store.read(); assert.equal(assertJournal(state.journals), true);
  assert.equal(accountBalance(state, 'platform:acct_platform', `shipping_carrier_deferred:${order.orderId}`), 0);
  assert.equal(accountBalance(state, 'platform:acct_platform', `shipping_handling_deferred:${order.orderId}`), 0);
});

test('a confirmed shipping refund later returned by the provider restores its exact split once, even after quote expiry', async t => {
  let now = FIXTURE_NOW;
  const f = financeFixture({ clock: () => now }); t.after(() => f.store.close());
  const shippingPricing = receipt(333), order = { ...f.order, shippingCents: 633, totalCents: f.order.itemCents + f.order.taxCents + 633, shippingPricing };
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy }));
  await f.execute('payment_one'); f.provider.resolve('payment_one', { status: 'succeeded' }); await f.reconcile('payment_one');
  now += 7200000; // Historical allocations remain recoverable; no new quote is approved.
  const prepare = (id, amountCents) => f.store.transaction(tx => prepareRefund(tx, { intentId: id, paymentIntentId: 'payment_one', amountCents, allocations: { sellerCents: 0, feeCents: 0, taxCents: 0, shippingCents: amountCents }, policyEvidence: { approved: true, orderId: order.orderId, policyVersion: f.policy.version, evidenceRef: `review_${id}` } }));
  const original = prepare('refund_returned', 101);
  await f.execute(original.id); f.provider.resolve(original.id, { status: 'succeeded' }); await f.reconcile(original.id);
  const evidence = f.store.read(state => state.financeObservations[original.id]);
  const returned = { ...evidence, status: 'failed', failureBalanceTransaction: { id: 'txn_mock_shipping_refund_return', source: evidence.objectId, currency: 'USD', amountCents: 101, feeCents: 0, netCents: 101, status: 'available', availableOn: now } };
  assert.throws(() => f.store.transaction(tx => reconcileFinance(tx, { intentId: original.id, evidence: { ...returned, failureBalanceTransaction: null } })), { code: 'BALANCE_TRANSACTION_MISMATCH' });
  for (let n = 0; n < 2; n++) f.store.transaction(tx => reconcileFinance(tx, { intentId: original.id, evidence: returned }));
  const state = f.store.read(), book = 'platform:acct_platform';
  assert.equal(accountBalance(state, book, `shipping_carrier_deferred:${order.orderId}`), -333);
  assert.equal(accountBalance(state, book, `shipping_handling_deferred:${order.orderId}`), -300);
  assert.equal(state.journals.filter(row => row.intentId === original.id && row.kind === 'REFUND_RETURNED').length, 1);
  assert.equal(state.financeHolds[`refund-failed:${original.id}`].active, true);
  assert.equal(assertJournal(state.journals), true);
  assert.deepEqual(prepare('refund_separately_reviewed', 633).shippingRefundAttribution, { carrierCents: 333, handlingCents: 300 });
});
