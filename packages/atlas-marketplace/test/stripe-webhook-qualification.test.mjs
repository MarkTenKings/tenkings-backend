import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { startStripeWebhookQualification } from '../scripts/serve-stripe-webhook-qualification.mjs';
import { SANDBOX_PLATFORM, SANDBOX_SELLER, SANDBOX_PLAN_FORMAT } from '../scripts/qualify-stripe-sandbox.mjs';
import { hash } from '../src/contract.mjs';
import { preparePayment, claimDispatch, bindFinanceObject, reconcileFinance } from '../src/finance.mjs';

const NOW = 1792699200000, SECRET = 'whsec_MOCK_ONLY_SIGNING_SECRET';
function fixture() {
  const plan = {
    format: SANDBOX_PLAN_FORMAT, runId: 'r2qa_mock_webhook_only_001', platformAccountId: SANDBOX_PLATFORM, connectedAccountId: SANDBOX_SELLER, livemode: false, apiVersion: '2025-09-30.clover',
    authorization: { approved: true, evidenceRef: 'MOCK_WEBHOOK_ONLY', approvedAt: NOW - 1000, expiresAt: NOW + 600000, allowedStages: ['payment', 'confirm', 'reconcile'] },
    financePolicy: { version: 'MOCK_WEBHOOK_POLICY', environment: 'stripe-sandbox', maxEvidenceAgeMs: 60000, ...Object.fromEntries(['approvalRef','authorityRef','feeTermsRef','refundTermsRef','transferTermsRef','payoutTermsRef','returnsTermsRef','reserveTermsRef','disputeTermsRef'].map(key => [key, 'MOCK_ONLY_' + key])) },
    amounts: { totalCents: 1000, itemCents: 1000, feeCents: 100, sellerNetCents: 900, taxCents: 0, shippingCents: 0 },
    refund: { timing: 'AFTER_TRANSFER', amountCents: 100, allocations: { sellerCents: 100, feeCents: 0, taxCents: 0, shippingCents: 0 }, evidenceRef: 'MOCK_REFUND' },
    payout: { amountCents: 800, externalAccountId: 'ba_MockWebhook', evidenceRef: 'MOCK_PAYOUT' },
    openingReview: { approved: true, quiescent: true, reviewerId: 'MOCK_REVIEWER', policyVersion: 'MOCK_OPENING', evidenceRef: 'MOCK_OPENING_REF' }, releaseRef: 'MOCK_RELEASE', paymentMethod: 'pm_card_visa',
  };
  let now = NOW, state = { intents: {}, journals: [], events: [], sandbox: { runId: plan.runId, planHash: hash(plan), environment: 'PROVIDER_SANDBOX' } };
  const store = { read(fn = value => value) { return structuredClone(fn(state)); }, transaction(fn) { const draft = structuredClone(state); const result = fn({ state: draft, now, emit(type, payload) { draft.events.push({ type, payload }); } }); state = draft; return structuredClone(result); } };
  const order = { ...plan.amounts, currency: 'USD', policyVersion: plan.financePolicy.version };
  for (const key of ['orderId','reservationId','listingId','cardId','sellerId','buyerId']) order[key] = `${plan.runId}_${key}`;
  order.bindingHash = hash({ planHash: hash(plan), order });
  const intentId = plan.runId + '_payment', objectId = 'pi_MockWebhookOnly';
  store.transaction(tx => preparePayment(tx, { intentId, order, platformAccountId: SANDBOX_PLATFORM, connectedAccountId: SANDBOX_SELLER, policy: plan.financePolicy }));
  store.transaction(tx => claimDispatch(tx, intentId)); store.transaction(tx => bindFinanceObject(tx, intentId, objectId));
  const evidence = { provider: 'stripe', livemode: false, accountId: SANDBOX_PLATFORM, kind: 'PAYMENT', intentId, orderId: order.orderId, bindingHash: order.bindingHash, objectId, amountCents: 1000, currency: 'USD', observedAt: now, status: 'requires_payment_method' };
  store.transaction(tx => reconcileFinance(tx, { intentId, evidence }));
  const calls = [], provider = {
    async getIdentity() { calls.push('identity'); return { provider: 'stripe', environment: 'PROVIDER_SANDBOX', livemode: false, platformAccountId: SANDBOX_PLATFORM, allowedConnectedAccountIds: [SANDBOX_SELLER], apiVersion: plan.apiVersion }; },
    async retrieve(intent, binding) { calls.push('retrieve'); assert.equal(intent.id, intentId); assert.equal(binding.objectId, objectId); return { ...evidence, status: 'succeeded', observedAt: now, amountReceivedCents: 1000, chargeCapturedCents: 1000, chargePaid: true, chargeCurrency: 'USD', chargeAmountCents: 1000, chargeId: 'ch_MockWebhookOnly', balanceTransaction: { id: 'txn_MockWebhookOnly', currency: 'USD', source: 'ch_MockWebhookOnly', amountCents: 1000, feeCents: 59, netCents: 941, status: 'available', availableOn: now } }; },
    async create() { assert.fail('No webhook qualification provider creates permitted'); },
  };
  const event = { id: 'evt_MockWebhookOnly', object: 'event', livemode: false, type: 'payment_intent.processing', data: { object: { id: objectId, object: 'payment_intent', status: 'processing', client_secret: 'RAW_PAYLOAD_SECRET_MUST_NOT_PERSIST', metadata: { atlas_marketplace_intent: intentId, atlas_marketplace_order: order.orderId, atlas_marketplace_binding: order.bindingHash } } } };
  return { plan, store, provider, calls, event, intentId, expire() { now = plan.authorization.expiresAt; }, options() { return { enabled: true, store, provider, plan, approvedPlanHash: hash(plan), clock: () => now }; } };
}
function sign(rawBody, timestamp = NOW / 1000) { return `t=${timestamp},v1=${createHmac('sha256', SECRET).update(`${timestamp}.`).update(rawBody).digest('hex')}`; }

test('webhook fixture is default-off and refuses unapproved or foreign stores before provider access', async () => {
  const f = fixture();
  await assert.rejects(startStripeWebhookQualification(), { code: 'WEBHOOK_QUALIFICATION_DISABLED' });
  await assert.rejects(startStripeWebhookQualification({ ...f.options(), approvedPlanHash: 'wrong' }), { code: 'SANDBOX_EXECUTION_NOT_AUTHORIZED' });
  f.store.transaction(tx => { tx.state.intents[f.intentId].connectedAccountId = 'acct_unapproved'; });
  await assert.rejects(startStripeWebhookQualification(f.options()), { code: 'SANDBOX_WEBHOOK_STORE_SCOPE_REFUSED' });
  assert.deepEqual(f.calls, []);
});

test('actual loopback raw-body webhook requires installed signing secret, exact run scope and current signature, then retrieves original and deduplicates its journal with redacted receipts', async t => {
  const f = fixture(), receipts = [], server = await startStripeWebhookQualification({ ...f.options(), onReceipt: value => { receipts.push(value); } });
  t.after(() => server.close());
  const raw = Buffer.from(JSON.stringify(f.event, null, 2)), post = (bytes = raw, headers = {}) => fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', 'stripe-signature': sign(bytes), ...headers }, body: bytes });
  assert.equal(server.webhookPath, '/webhook'); assert.equal((await server.receipt()).ready, false); assert.equal((await post()).status, 503);
  assert.equal((await fetch(server.url)).status, 405); assert.equal((await fetch(server.url + '?secret=not-accepted', { method: 'POST' })).status, 404);
  assert.throws(() => server.setSigningSecret('invalid'), { code: 'SANDBOX_WEBHOOK_SECRET_REQUIRED' });
  server.setSigningSecret(SECRET); server.setSigningSecret(SECRET);
  assert.throws(() => server.setSigningSecret('whsec_ANOTHER_MOCK_SECRET_ONLY'), { code: 'SANDBOX_WEBHOOK_SECRET_ALREADY_SET' });
  const wrongHost = await new Promise((resolve, reject) => { const request = httpRequest(server.url, { method: 'POST', headers: { host: 'attacker.invalid' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); request.on('error', reject); request.end(); });
  assert.equal(wrongHost, 403);
  assert.equal((await post(raw, { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await post(Buffer.concat([raw, Buffer.from(' ')]), { 'stripe-signature': sign(raw) })).status, 403);
  assert.equal((await post(raw, { 'stripe-signature': sign(raw, NOW / 1000 - 301) })).status, 403);
  assert.equal((await post(Buffer.alloc(262145))).status, 413);
  for (const patch of [{ livemode: true }, { account: 'acct_other' }, { type: 'charge.dispute.created' }, { data: { object: { ...f.event.data.object, id: 'pi_OtherPayment' } } }, { data: { object: { ...f.event.data.object, metadata: { atlas_marketplace_intent: 'another_run_payment' } } } }]) {
    assert.equal((await post(Buffer.from(JSON.stringify({ ...f.event, ...patch })))).status, 403);
  }
  assert.deepEqual(f.calls, ['identity']); assert.equal(f.store.read().financeWebhooks, undefined);
  for (let i = 0; i < 2; i++) {
    const response = await post(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { received: true, transport: 'STRIPE_CLI_FORWARDING', productionEndpointQualified: false, eventId: f.event.id, type: f.event.type, status: 'SUCCEEDED', intentId: f.intentId });
  }
  const alteredEvent = Buffer.from(JSON.stringify({ ...f.event, type: 'payment_intent.succeeded' }));
  assert.equal((await post(alteredEvent)).status, 409);
  const balance = Buffer.from(JSON.stringify({ id: 'evt_MockSellerBalance', object: 'event', livemode: false, account: SANDBOX_SELLER, type: 'balance.available', data: { object: { object: 'balance' } } }));
  const balanceResponse = await post(balance); assert.equal(balanceResponse.status, 200); assert.equal((await balanceResponse.json()).accountReconciliationRequired, true);
  const receipt = await server.receipt(), state = f.store.read();
  assert.equal(receipt.productionEndpointQualified, false); assert.equal(receipt.events.length, 2); assert.equal(receipt.journalEntries, 1); assert.equal(receipt.intents[0].confirmed, true); assert.equal(state.intents[f.intentId].dispatchCount, 1);
  assert.equal(receipt.events.find(row => row.eventId === f.event.id).rawHash, hashRaw(raw));
  assert.doesNotMatch(JSON.stringify({ receipt, state, receipts }), /RAW_PAYLOAD_SECRET|whsec_|client_secret/); assert.deepEqual(f.calls, ['identity', 'retrieve', 'retrieve']);
  assert.equal(state.orders, undefined); assert.equal(state.reservations, undefined);
  f.expire(); assert.equal((await post()).status, 403); assert.equal(f.calls.length, 3);
});

function hashRaw(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
