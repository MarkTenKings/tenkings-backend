import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { startStripeBrowserQualification } from '../scripts/serve-stripe-browser-qualification.mjs';
import { SANDBOX_PLATFORM, SANDBOX_SELLER, SANDBOX_PLAN_FORMAT } from '../scripts/qualify-stripe-sandbox.mjs';
import { hash } from '../src/contract.mjs';
import { preparePayment, claimDispatch, bindFinanceObject, reconcileFinance } from '../src/finance.mjs';

const NOW = 1792699200000;
function fixture() {
  const plan = {
    format: SANDBOX_PLAN_FORMAT, runId: 'r2qa_mock_browser_only_001', platformAccountId: SANDBOX_PLATFORM, connectedAccountId: SANDBOX_SELLER, livemode: false, apiVersion: '2025-09-30.clover',
    authorization: { approved: true, evidenceRef: 'MOCK_BROWSER_ONLY', approvedAt: NOW - 1000, expiresAt: NOW + 600000, allowedStages: ['payment', 'confirm', 'reconcile'] },
    financePolicy: { version: 'MOCK_BROWSER_POLICY', environment: 'stripe-sandbox', maxEvidenceAgeMs: 60000, ...Object.fromEntries(['approvalRef','authorityRef','feeTermsRef','refundTermsRef','transferTermsRef','payoutTermsRef','returnsTermsRef','reserveTermsRef','disputeTermsRef'].map(key => [key, 'MOCK_ONLY_' + key])) },
    amounts: { totalCents: 1000, itemCents: 1000, feeCents: 100, sellerNetCents: 900, taxCents: 0, shippingCents: 0 },
    refund: { timing: 'AFTER_TRANSFER', amountCents: 100, allocations: { sellerCents: 100, feeCents: 0, taxCents: 0, shippingCents: 0 }, evidenceRef: 'MOCK_REFUND' },
    payout: { amountCents: 800, externalAccountId: 'ba_MockBrowser', evidenceRef: 'MOCK_PAYOUT' },
    openingReview: { approved: true, quiescent: true, reviewerId: 'MOCK_REVIEWER', policyVersion: 'MOCK_OPENING', evidenceRef: 'MOCK_OPENING_REF' },
    releaseRef: 'MOCK_RELEASE', paymentMethod: 'pm_card_visa',
  };
  let now = NOW, state = { intents: {}, journals: [], events: [], sandbox: { runId: plan.runId, planHash: hash(plan), environment: 'PROVIDER_SANDBOX' } };
  const store = {
    read(fn = value => value) { return structuredClone(fn(state)); },
    transaction(fn) { const draft = structuredClone(state); const result = fn({ state: draft, now, emit(type, payload) { draft.events.push({ type, payload }); } }); state = draft; return structuredClone(result); },
  };
  const order = { ...plan.amounts, currency: 'USD', policyVersion: plan.financePolicy.version };
  for (const key of ['orderId','reservationId','listingId','cardId','sellerId','buyerId']) order[key] = `${plan.runId}_${key}`;
  order.bindingHash = hash({ planHash: hash(plan), order });
  const intentId = plan.runId + '_payment', objectId = 'pi_MockBrowserOnly';
  store.transaction(tx => preparePayment(tx, { intentId, order, platformAccountId: SANDBOX_PLATFORM, connectedAccountId: SANDBOX_SELLER, policy: plan.financePolicy }));
  store.transaction(tx => claimDispatch(tx, intentId)); store.transaction(tx => bindFinanceObject(tx, intentId, objectId));
  let providerStatus = 'requires_payment_method';
  const calls = [], evidence = () => ({ provider: 'stripe', livemode: false, accountId: SANDBOX_PLATFORM, kind: 'PAYMENT', intentId, orderId: order.orderId, bindingHash: order.bindingHash, objectId, amountCents: 1000, currency: 'USD', observedAt: now, status: providerStatus,
    ...(providerStatus === 'succeeded' ? { amountReceivedCents: 1000, chargeCapturedCents: 1000, chargePaid: true, chargeCurrency: 'USD', chargeAmountCents: 1000, chargeId: 'ch_MockBrowserOnly', balanceTransaction: { id: 'txn_MockBrowserOnly', currency: 'USD', source: 'ch_MockBrowserOnly', amountCents: 1000, feeCents: 59, netCents: 941, status: 'available', availableOn: now } } : {}) });
  store.transaction(tx => reconcileFinance(tx, { intentId, evidence: evidence() }));
  const provider = {
    async getIdentity() { calls.push('identity'); return { provider: 'stripe', environment: 'PROVIDER_SANDBOX', livemode: false, platformAccountId: SANDBOX_PLATFORM, allowedConnectedAccountIds: [SANDBOX_SELLER], apiVersion: plan.apiVersion, paymentCollectionConfigured: true }; },
    async getPaymentCollection(intent) { calls.push('collection'); assert.equal(intent.id, intentId); assert.equal(intent.objectId, objectId); return { strategy: 'stripe-payment-element', paymentIntentId: objectId, clientSecret: objectId + '_secret_MOCKCAPABILITY', publishableKey: 'pk_test_MOCKONLY', amountCents: 1000, currency: 'USD' }; },
    async retrieve(intent, binding) { calls.push('retrieve'); assert.equal(intent.id, intentId); assert.equal(binding.objectId, objectId); return evidence(); },
    async create() { assert.fail('Browser fixture must never create a provider object'); },
  };
  return { plan, order, store, provider, calls, intentId, clock: () => now, expire() { now = plan.authorization.expiresAt; }, succeed() { providerStatus = 'succeeded'; }, options() { return { enabled: true, store, provider, plan, approvedPlanHash: hash(plan), clock: () => now }; } };
}

test('isolated browser fixture is default-off, plan-bound and pending-only before any provider access', async () => {
  const f = fixture();
  await assert.rejects(startStripeBrowserQualification(), { code: 'BROWSER_QUALIFICATION_DISABLED' });
  await assert.rejects(startStripeBrowserQualification({ ...f.options(), approvedPlanHash: 'not-approved' }), { code: 'SANDBOX_EXECUTION_NOT_AUTHORIZED' });
  f.store.transaction(tx => { tx.state.intents[f.intentId].confirmed = true; tx.state.intents[f.intentId].status = 'SUCCEEDED'; });
  await assert.rejects(startStripeBrowserQualification(f.options()), { code: 'SANDBOX_PENDING_PAYMENT_REQUIRED' });
  assert.deepEqual(f.calls, []);
});

test('actual loopback HTTP reuses account UI, limits capabilities to one original intent, and reconciles success exactly once without leaking secrets or creating marketplace state', async t => {
  const f = fixture(), server = await startStripeBrowserQualification(f.options());
  t.after(() => server.close());
  const home = await fetch(server.url + '?payment_intent_client_secret=untrusted_return_value&redirect_status=succeeded');
  assert.equal(home.status, 200); assert.match(home.headers.get('content-security-policy'), /https:\/\/js\.stripe\.com/);
  const html = await home.text();
  assert.match(html, /SYNTHETIC SESSION AND CHECKOUT/); assert.match(html, /does not authenticate through R1/); assert.match(html, /data-mount-path="\/account\/marketplace\/"/); assert.doesNotMatch(html, /untrusted_return_value/);
  const script = await fetch(server.url + 'app.mjs');
  assert.equal(await script.text(), await readFile(new URL('../ui/app.mjs', import.meta.url), 'utf8'));
  const workspaceURL = server.origin + server.apiPath + '/workspace';
  const workspaceResponse = await fetch(workspaceURL), workspace = await workspaceResponse.json();
  assert.equal(workspaceResponse.headers.get('cache-control'), 'no-store'); assert.equal(workspace.qualification.syntheticSession, true); assert.equal(workspace.qualification.cardAuthority, false); assert.equal(workspace.qualification.confirmed, false);
  assert.deepEqual(workspace.orders, []); assert.equal(workspace.listings[0].approvedCard, null); assert.equal(workspace.reservations[0].paymentIntentId, f.intentId); assert.doesNotMatch(JSON.stringify(workspace), /secret_|pk_test_/);
  const headers = { origin: server.origin, 'content-type': 'application/json', 'x-atlas-csrf': workspace.csrfToken }, body = JSON.stringify({ reservationId: f.order.reservationId });
  const post = (path, override = {}) => fetch(server.origin + server.apiPath + path, { method: 'POST', headers, body, ...override });
  for (const path of ['/payments', '/listings', '/reservations', '/provider/webhook', '/fulfillment', '/demo/provider']) assert.equal((await post(path)).status, 404);
  const wrongHost = await new Promise((resolve, reject) => { const request = httpRequest(workspaceURL, { headers: { host: 'attacker.invalid' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); request.on('error', reject); request.end(); });
  assert.equal(wrongHost, 403);
  assert.equal((await fetch(workspaceURL, { headers: { origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await post('/payments/collection', { headers: { ...headers, 'x-atlas-csrf': 'wrong' } })).status, 403);
  assert.equal((await post('/payments/collection', { body: JSON.stringify({ reservationId: 'another_reservation' }) })).status, 403);
  assert.equal((await post('/payments/collection', { body: JSON.stringify({ reservationId: f.order.reservationId, intentId: 'replacement' }) })).status, 403);
  assert.equal((await post('/payments/collection', { body: 'x'.repeat(1025) })).status, 413);
  assert.equal((await fetch(server.origin + server.apiPath + '/payments/collection')).status, 405);
  assert.deepEqual(f.calls, ['identity']);
  const collectionResponse = await post('/payments/collection'), collection = await collectionResponse.json();
  assert.equal(collectionResponse.status, 200); assert.equal(collectionResponse.headers.get('cache-control'), 'no-store'); assert.equal(collection.reservationId, f.order.reservationId); assert.equal(collection.intentId, f.intentId); assert.equal(collection.paymentIntentId, 'pi_MockBrowserOnly'); assert.match(collection.clientSecret, /_secret_MOCKCAPABILITY$/);
  const pending = await post('/payments/reconcile'); assert.equal((await pending.json()).confirmed, false); assert.equal(f.store.read().journals.length, 0);
  f.succeed();
  for (let count = 0; count < 2; count++) { const response = await post('/payments/reconcile'); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { intentId: f.intentId, paymentIntentId: 'pi_MockBrowserOnly', status: 'SUCCEEDED', confirmed: true, amountCents: 1000, currency: 'USD', dispatchCount: 1, journalEntries: 1 }); }
  assert.equal((await post('/payments/collection')).status, 409);
  const persisted = f.store.read(); assert.equal(persisted.journals.length, 1); assert.equal(persisted.orders, undefined); assert.equal(persisted.listings, undefined); assert.equal(persisted.reservations, undefined); assert.doesNotMatch(JSON.stringify(persisted), /MOCKCAPABILITY|pk_test_/);
  assert.deepEqual(f.calls, ['identity', 'collection', 'retrieve', 'retrieve', 'retrieve']);
  f.expire(); assert.equal((await fetch(workspaceURL)).status, 403); assert.equal((await post('/payments/reconcile')).status, 403); assert.equal(f.calls.length, 5);
});
