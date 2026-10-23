import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyRawWebhook, handleFinanceWebhook } from '../src/webhook.mjs';
import { financeFixture, NOW } from './finance-fixtures.mjs';
import { preparePayment } from '../src/finance.mjs';
import { openLocalStore } from '../src/store.mjs';
import { createMarketplacePilot, intentId } from '../src/service.mjs';
import { actors, createLocalFixture, syntheticFulfillmentEvidence } from '../scripts/local-fixture.mjs';

const secret = 'whsec_explicit_synthetic_fixture_only';
function signature(raw, time = NOW / 1000) { return `t=${time},v1=${createHmac('sha256', secret).update(`${time}.`).update(raw).digest('hex')}`; }

test('signature verification uses original bytes, rejects old/future signatures and does not parse unsigned data', () => {
  const rawBody = Buffer.from('{"object":"event","id":"evt_one","livemode":false,"type":"payment_intent.succeeded","data":{"object":{}}}');
  assert.equal(verifyRawWebhook({ rawBody, signature: signature(rawBody), secret, now: NOW }).event.id, 'evt_one');
  assert.throws(() => verifyRawWebhook({ rawBody: Buffer.concat([rawBody, Buffer.from(' ')]), signature: signature(rawBody), secret, now: NOW }), { code: 'INVALID_WEBHOOK_SIGNATURE' });
  assert.throws(() => verifyRawWebhook({ rawBody: JSON.parse(rawBody), signature: signature(rawBody), secret, now: NOW }), { code: 'RAW_WEBHOOK_BYTES_REQUIRED' });
  for (const delta of [-301, 301]) assert.throws(() => verifyRawWebhook({ rawBody, signature: signature(rawBody, NOW / 1000 + delta), secret, now: NOW }), { code: 'EXPIRED_WEBHOOK_SIGNATURE' });
});

test('duplicate and out-of-order webhook hints always retrieve exact current object, scoped to account and mode', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.paid();
  const objectId = f.store.read(state => state.intents.payment_one.objectId);
  const event = { object: 'event', id: 'evt_one', livemode: false, type: 'payment_intent.processing', data: { object: { id: objectId, object: 'payment_intent', status: 'processing', metadata: { atlas_marketplace_intent: 'payment_one' } } } };
  const handle = async (value, override = {}) => {
    const rawBody = Buffer.from(JSON.stringify(value));
    return handleFinanceWebhook({ store: f.store, provider: f.provider, rawBody, signature: signature(rawBody), secret, platformAccountId: 'acct_platform', now: NOW, enabled: true, ...override });
  };
  assert.equal((await handle(event)).status, 'SUCCEEDED');
  assert.equal((await handle(event)).status, 'SUCCEEDED');
  assert.equal(f.store.read(state => state.journals.length), 1);
  assert.equal(f.store.read(state => state.financeWebhooks.evt_one.status), 'RECONCILED');
  await assert.rejects(handle({ ...event, account: 'acct_other' }), { code: 'WEBHOOK_SCOPE_MISMATCH' });
  await assert.rejects(handle({ ...event, livemode: true }), { code: 'INVALID_WEBHOOK_EVENT' });
  await assert.rejects(handle({ ...event, type: 'payment_intent.succeeded' }), { code: 'WEBHOOK_EVENT_CONFLICT' });
  await assert.rejects(handle(event, { enabled: false }), { code: 'FINANCE_WEBHOOK_DISABLED' });
});

function handle(f, event, override = {}) {
  const rawBody = Buffer.from(JSON.stringify(event));
  return handleFinanceWebhook({ store: { read: async fn => f.store.read(fn), transaction: async fn => f.store.transaction(fn) }, provider: f.provider, rawBody, signature: signature(rawBody), secret, platformAccountId: 'acct_platform', now: NOW, enabled: true, ...override });
}

test('charge-refund and transfer-reversal aggregate events discover original intents; unowned provider actions are durably held', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred();
  const { prepareRefund, prepareReversal } = await import('../src/finance.mjs');
  f.store.transaction(tx => prepareRefund(tx, { intentId: 'refund1', paymentIntentId: 'payment_one', amountCents: 1000, allocations: { sellerCents: 1000, feeCents: 0, taxCents: 0, shippingCents: 0 }, policyEvidence: { approved: true, orderId: f.order.orderId, policyVersion: f.policy.version, evidenceRef: 'fixture-refund' } }));
  await f.execute('refund1'); f.provider.resolve('refund1', { status: 'succeeded' });
  const payment = f.store.read(state => state.intents.payment_one), transfer = f.store.read(state => state.intents.transfer_one), refund = f.store.read(state => state.intents.refund1);
  const provider = { ...f.provider, listRelatedObjects: async parent => ({ complete: true, objects: parent.kind === 'PAYMENT' ? [{ intentId: 'refund1', objectId: refund.objectId, kind: 'REFUND', parentObjectId: payment.chargeId }] : [{ intentId: 'reversal1', objectId: f.store.read(state => state.intents.reversal1.objectId), kind: 'REVERSAL', parentObjectId: transfer.objectId }] }) };
  const refunded = { id: 'evt_refundaggregate', object: 'event', livemode: false, type: 'charge.refunded', data: { object: { id: payment.chargeId, object: 'charge', metadata: { atlas_marketplace_intent: payment.id } } } };
  assert.equal((await handle(f, refunded, { provider })).status, 'RECONCILED');
  assert.equal(f.store.read(state => state.intents.refund1.confirmed), true);
  f.store.transaction(tx => prepareReversal(tx, { intentId: 'reversal1', transferIntentId: transfer.id, amountCents: 1000, accountEvidence: f.store.read(state => state.syntheticProvider.accounts.acct_seller) }));
  await f.execute('reversal1'); f.provider.resolve('reversal1', { status: 'succeeded' });
  const reversed = { id: 'evt_reversalaggregate', object: 'event', livemode: false, type: 'transfer.reversed', data: { object: { id: transfer.objectId, object: 'transfer', metadata: { atlas_marketplace_intent: transfer.id } } } };
  assert.equal((await handle(f, reversed, { provider })).status, 'RECONCILED');
  assert.equal(f.store.read(state => state.intents.reversal1.confirmed), true);
  const count = f.store.read(state => state.journals.length); await handle(f, reversed, { provider }); assert.equal(f.store.read(state => state.journals.length), count);
  const externalProvider = { ...provider, listRelatedObjects: async () => ({ complete: true, objects: [{ intentId: null, objectId: 're_external', kind: 'REFUND', parentObjectId: payment.chargeId }] }) };
  assert.equal((await handle(f, { ...refunded, id: 'evt_external' }, { provider: externalProvider })).status, 'REVIEW_REQUIRED');
  assert.equal(f.store.read(state => state.financeOrders[f.order.orderId].blocked), true);
  assert.equal(f.store.read(state => state.journals.length), count);
});

test('disputes require fresh provider retrieval and explicit recovery policy; missing policy retains an operational hold after payout', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred(); await f.payout(); await f.resolve('payout_one', { status: 'paid' });
  const payment = f.store.read(state => state.intents.payment_one);
  let reads = 0;
  const provider = { ...f.provider, retrieveDispute: async (original, { objectId }) => {
    reads++; assert.equal(original.id, payment.id);
    return { provider: 'synthetic', accountId: 'acct_platform', livemode: false, objectId, chargeId: payment.chargeId, currency: 'USD', amountCents: 11200, status: 'needs_response', observedAt: NOW, balanceTransaction: { id: `txn_${objectId}`, source: objectId, currency: 'USD', amountCents: -11200, feeCents: 1500, netCents: -12700, status: 'available', availableOn: NOW } };
  } };
  const event = { id: 'evt_dispute', object: 'event', livemode: false, type: 'charge.dispute.created', data: { object: { id: 'du_fixture', object: 'dispute', charge: payment.chargeId, payment_intent: payment.objectId } } };
  assert.equal((await handle(f, event, { provider })).status, 'REVIEW_REQUIRED');
  assert.equal(f.store.read(state => state.financeDisputes.du_fixture), undefined);
  assert.equal(f.store.read(state => state.financeOrders[f.order.orderId].blocked), true);
  const resolveDisputePolicy = async () => ({ approved: true, orderId: f.order.orderId, policyVersion: f.policy.version, evidenceRef: 'fixture-dispute-review', sellerRecoveryCents: 9200 });
  assert.equal((await handle(f, event, { provider, resolveDisputePolicy })).status, 'needs_response');
  const { sellerBalance } = await import('../src/finance.mjs');
  const balance = f.store.read(state => sellerBalance(state, 'seller_one'));
  assert.equal(balance.recoveryDueCents, 9200); assert.equal(balance.availableCents, 0); assert.equal(balance.paidOutCents, 9200); assert.equal(reads, 2);
});

test('early dispute returns the freshly confirmed payment separately and never binds missing parent identifiers', async t => {
  const f = financeFixture(); t.after(() => f.store.close());
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order: f.order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: f.policy }));
  await f.execute('payment_one');
  f.provider.resolve('payment_one', { status: 'succeeded' });
  const original = f.store.read(state => state.intents.payment_one);
  const unbound = { id: 'evt_unbound_dispute', object: 'event', livemode: false, type: 'charge.dispute.created', data: { object: { id: 'du_unbound', object: 'dispute' } } };
  assert.equal((await handle(f, unbound)).code, 'UNBOUND_DISPUTE');
  assert.equal(f.store.read(state => state.intents.payment_one.confirmed), false);
  const provider = { ...f.provider, retrieveDispute: async (payment, { objectId }) => {
    assert.equal(payment.confirmed, true);
    return { provider: 'synthetic', accountId: 'acct_platform', livemode: false, objectId, chargeId: payment.chargeId, currency: 'USD', amountCents: payment.amountCents, status: 'needs_response', observedAt: NOW };
  } };
  const event = { id: 'evt_early_dispute', object: 'event', livemode: false, type: 'charge.dispute.created', data: { object: { id: 'du_early', object: 'dispute', payment_intent: original.objectId } } };
  const result = await handle(f, event, { provider });
  assert.equal(result.status, 'REVIEW_REQUIRED'); assert.equal(result.affectedPaymentIntentId, original.id); assert.equal(result.intentId, undefined);
  const snapshot = f.store.read();
  assert.equal(snapshot.financeWebhooks[event.id].affectedPaymentIntentId, original.id);
  assert.equal(snapshot.financeWebhooks[event.id].intentId, undefined);
  assert.equal(snapshot.intents[original.id].confirmed, true);
  assert.equal(snapshot.financeOrders[f.order.orderId].blocked, true);
  assert.equal(snapshot.financeExceptions['dispute-review:du_early'].status, 'OPEN');
  assert.equal(snapshot.journals.length, 1);
  assert.equal((await handle(f, event, { provider })).affectedPaymentIntentId, original.id);
  assert.equal(f.store.read(state => state.journals.length), 1);
});

test('service settles an early disputed payment exactly once while review holds prevent physical fulfillment', async t => {
  const clock = () => NOW, store = openLocalStore({ filename: ':memory:', environment: 'SYNTHETIC_LOCAL', clock });
  t.after(() => store.close());
  const fixture = createLocalFixture({ store, clock, assets: false });
  const provider = { ...fixture.provider, retrieveDispute: async (payment, { objectId }) => ({ provider: 'synthetic', accountId: payment.accountId, livemode: false, objectId, chargeId: payment.chargeId, currency: 'USD', amountCents: payment.amountCents, status: 'needs_response', observedAt: NOW }) };
  const service = createMarketplacePilot({ ...fixture, provider, store, enabled: true, environment: 'SYNTHETIC_LOCAL', platformAccountId: 'demo_platform', clock, webhook: { secret } });
  await service.recordConsent(actors.seller, { requestId: 'demo_consent', cardId: 'demo_card', choice: 'HOLD_AND_LIST', evidenceRef: 'demo_hold_consent' });
  const listing = await service.publishListing(actors.seller, { requestId: 'demo_listing', cardId: 'demo_card', askingPriceCents: 12500 });
  const quote = await service.quote(actors.buyer, listing.id);
  const reservation = await service.reserve(actors.buyer, { requestId: 'demo_reservation', listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, quoteId: quote.quoteId });
  await service.pay(actors.buyer, { reservationId: reservation.id });
  const paymentId = intentId('payment', reservation.id), payment = store.read(state => state.intents[paymentId]);
  provider.resolve(paymentId, { status: 'succeeded' });
  assert.equal(Object.keys(store.read().orders).length, 0);
  const rawBody = Buffer.from(JSON.stringify({ id: 'evt_service_dispute', object: 'event', livemode: false, type: 'charge.dispute.created', data: { object: { id: 'du_service_early', object: 'dispute', payment_intent: payment.objectId } } }));
  assert.equal((await service.receiveProviderWebhook({ rawBody, signature: signature(rawBody) })).status, 'REVIEW_REQUIRED');
  const snapshot = store.read(), order = snapshot.orders[reservation.orderId];
  assert.equal(order.status, 'PAID'); assert.equal(snapshot.listings[listing.id].status, 'SOLD');
  assert.equal(snapshot.financeOrders[order.orderId].blocked, true);
  assert.equal(snapshot.fulfillment[order.orderId].status, 'AWAITING_PACKING');
  for (const action of ['PACK', 'DISPATCH', 'RELEASE']) await assert.rejects(() => service.fulfill(actors.staff, { requestId: `demo_held_${action}`, orderId: order.orderId, action, evidence: syntheticFulfillmentEvidence(order, action) }), { code: 'FINANCE_HOLD' });
  assert.equal(store.read().fulfillment[order.orderId].status, 'AWAITING_PACKING');
  await service.receiveProviderWebhook({ rawBody, signature: signature(rawBody) });
  assert.equal(store.read().journals.length, snapshot.journals.length);
  assert.equal(Object.keys(store.read().orders).length, 1);
  assert.equal(store.read().syntheticProvider.calls[paymentId], 1);
});

test('connected account capability loss records fresh status and blocks withdrawal, even when the event body claims eligibility', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.transferred();
  f.provider.configureAccount({ accountId: 'acct_seller', payoutsEnabled: false });
  const event = { id: 'evt_accountloss', object: 'event', account: 'acct_seller', livemode: false, type: 'account.updated', data: { object: { id: 'acct_seller', object: 'account', payouts_enabled: true } } };
  assert.equal((await handle(f, event)).status, 'REVIEW_REQUIRED');
  assert.equal(f.store.read(state => state.financeAccountObservations.acct_seller.payoutsEnabled), false);
  await assert.rejects(f.payout(), { code: 'SELLER_FUNDS_RESTRICTED' });
});

test('live webhook mode is rejected by default and requires explicit matching server mode; signature fixture only', () => {
  const rawBody = Buffer.from(JSON.stringify({ object: 'event', id: 'evt_mocklive', livemode: true, type: 'payment_intent.succeeded', data: { object: {} } }));
  assert.throws(() => verifyRawWebhook({ rawBody, signature: signature(rawBody), secret, now: NOW }), { code: 'INVALID_WEBHOOK_EVENT' });
  assert.equal(verifyRawWebhook({ rawBody, signature: signature(rawBody), secret, now: NOW, expectedLivemode: true }).event.livemode, true);
});

test('scoped endpoints bind signatures to platform or Connect account, allow bounded rotation, and refuse mixed or ambiguous keys', async () => {
  const { verifyScopedRawWebhook, scopedWebhookBinding } = await import('../src/webhook.mjs');
  const endpoints = [{ id: 'we_platform', scope: 'PLATFORM', secret }, { id: 'we_connect', scope: 'CONNECTED', secret: 'whsec_connect_fixture_only' }, { id: 'we_platform_rotation', scope: 'PLATFORM', secret: 'whsec_platform_rotation_fixture_only' }];
  const event = { id: 'evt_scoped', object: 'event', livemode: false, type: 'payment_intent.succeeded', data: { object: { id: 'pi_scoped', object: 'payment_intent' } } };
  const verify = (value, signingSecret, override = {}) => {
    const rawBody = Buffer.from(JSON.stringify(value)), time = NOW/1000;
    const signature = `t=${time},v1=${createHmac('sha256', signingSecret).update(`${time}.`).update(rawBody).digest('hex')}`;
    return verifyScopedRawWebhook({ rawBody, signature, now: NOW, endpoints, platformAccountId: 'acct_platform', ...override });
  };
  assert.equal(verify(event, secret).endpointId, 'we_platform');
  assert.equal(verify(event, endpoints[2].secret).endpointId, 'we_platform_rotation');
  assert.equal(verify({ ...event, account: 'acct_seller' }, endpoints[1].secret).endpointId, 'we_connect');
  assert.throws(() => verify(event, endpoints[1].secret), { code: 'WEBHOOK_ENDPOINT_SCOPE_MISMATCH' });
  assert.throws(() => verify({ ...event, account: 'acct_seller' }, secret), { code: 'WEBHOOK_ENDPOINT_SCOPE_MISMATCH' });
  assert.throws(() => verify({ ...event, livemode: true }, secret), { code: 'INVALID_WEBHOOK_EVENT' });
  assert.throws(() => verify(event, secret, { secret }), { code: 'WEBHOOK_ENDPOINT_CONFIG_REQUIRED' });
  assert.throws(() => scopedWebhookBinding({ endpoints: [endpoints[0], { ...endpoints[1], secret }] }), { code: 'WEBHOOK_ENDPOINT_CONFIG_REQUIRED' });
  assert.throws(() => scopedWebhookBinding({ endpoints: Array(5).fill(endpoints[0]) }), { code: 'WEBHOOK_ENDPOINT_CONFIG_REQUIRED' });
  assert.equal(JSON.stringify(scopedWebhookBinding({ endpoints })).includes('whsec_'), false);
});
