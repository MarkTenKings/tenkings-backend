import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApp, parsePrice } from '../ui/view.mjs';
import { makeSyntheticEligibility, makeSyntheticPolicy } from './listing-fixtures.mjs';

const demo = () => ({ mode: 'SYNTHETIC_LOCAL', csrfToken: 'demo_csrf', eligibilityCards: [makeSyntheticEligibility().approvedCard], policy: makeSyntheticPolicy(), actors: { sellerId: 'demo_seller', buyerId: 'demo_buyer' }, listings: [], reservations: [], orders: [], intents: [], consent: {}, fulfillment: {}, balance: null });

test('buyer/seller UI identifies synthetic state, refuses real mode, escapes text and exposes all catalog facets', () => {
  const data = demo();
  data.eligibilityCards[0].identity.name = '<img src=x onerror="alert(1)">';
  data.eligibilityCards[0].media.front.url = 'javascript:alert(1)';
  const html = renderApp(data);
  assert.match(html, /LOCAL SYNTHETIC DEMO/);
  assert.match(html, /Hold and list/);
  assert.match(html, /Ship to me/);
  assert.match(html, /Not reconciled/);
  assert.match(html, /&lt;img src=x/);
  assert.doesNotMatch(html, /src="javascript:|<img src=x|onerror="alert/);
  for (const name of ['query', 'category', 'set', 'year', 'grade', 'minPriceCents', 'maxPriceCents', 'numberedDenominator', 'autograph', 'relic']) assert.match(html, new RegExp(`name="${name}"`));
  assert.match(renderApp({ ...data, mode: 'PRODUCTION' }), /Marketplace unavailable/);
  assert.doesNotMatch(renderApp({ ...data, mode: 'PRODUCTION' }), /data-action="pay"/);
});

test('seller amount parsing cannot silently round, coerce or overflow', () => {
  assert.equal(parsePrice('125.00'), 12500);
  assert.equal(parsePrice('0.01'), 1);
  for (const value of ['', '0', '-1', '1.001', '1e2', '12abc', ' 12', '9007199254740992.00', 12]) assert.equal(parsePrice(value), null);
});

test('a lost payment response performs only recovery reads; unresolved state blocks another POST and carries CSRF', async () => {
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  const listeners = {};
  const root = { dataset: { runtime: 'LOCAL_DEMO' }, innerHTML: '', addEventListener(type, fn) { listeners[type] = fn; }, querySelector() { return null; } };
  const data = demo();
  const calls = [];
  globalThis.document = { getElementById() { return root; }, querySelector() { return null; } };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) return { ok: true, json: async () => data };
    throw new Error('Connection interrupted');
  };
  try {
    await import(`../ui/app.mjs?qualification=${Date.now()}`);
    const button = { disabled: false, dataset: { action: 'pay', reservation: 'demo_reservation' } };
    await listeners.click({ target: { closest: () => button } });
    assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1);
    assert.equal(calls[1].options.headers['x-atlas-demo-csrf'], 'demo_csrf');
    assert.equal(calls.filter((call) => call.url === '/api/demo').length, 2);
    assert.match(root.innerHTML, /last response is unknown/);
    await listeners.click({ target: { closest: () => button } });
    assert.equal(calls.length, 3);
  } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; }
});

test('expired quote/lease and unknown payments present recovery without a new charge; bank capability loss blocks payout', async () => {
  const { createListing } = await import('../src/listing.mjs');
  const { makeTestTx, makeListingInput, makeSyntheticQuote } = await import('./listing-fixtures.mjs');
  const tx = makeTestTx(), listing = createListing(tx, makeListingInput());
  const data = { ...demo(), now: tx.now, listings: [listing], balance: { availableCents: 100 }, sellerEligibility: { status: 'RESTRICTED', payoutsEnabled: false, bank: { status: 'VERIFIED', label: 'Synthetic bank' }, requirements: ['Bank eligibility review required'] } };
  const quote = makeSyntheticQuote(listing, { expiresAt: new Date(tx.now).toISOString() });
  let html = renderApp(data, { quote });
  assert.match(html, /This quote expired/);
  assert.match(html, /data-action="reserve"[^>]*disabled/);
  assert.match(html, /data-action="withdraw"[^>]*disabled/);
  assert.match(html, /Bank eligibility review required/);
  data.listings[0].status = 'RESERVED';
  data.reservations = [{ id: 'demo_r', listingId: listing.id, status: 'HELD', expiresAt: quote.expiresAt, quote, paymentIntentId: null }];
  html = renderApp(data);
  assert.match(html, /Reservation time elapsed/);
  assert.match(html, /data-action="pay"[^>]*disabled/);
  assert.match(html, /data-action="cancel-reservation"/);
  data.reservations[0].status = 'PAYMENT_PENDING'; data.reservations[0].paymentIntentId = 'demo_payment';
  data.intents = [{ id: 'demo_payment', kind: 'PAYMENT', status: 'UNKNOWN' }];
  html = renderApp(data);
  assert.match(html, /provider result is unknown/);
  assert.match(html, /Reconcile original payment/);
  assert.doesNotMatch(html, /data-action="pay"|data-action="cancel-reservation"/);
});

test('operator refund closure remains disabled until the exact case refund is confirmed and staff controls respect projection role', () => {
  const data = demo();
  data.orders = [{ orderId: 'demo_order', cardId: 'demo_card', approvedCard: makeSyntheticEligibility().approvedCard, totalCents: 14700, sellerNetCents: 12000, feeCents: 500, taxCents: 1000, shippingCents: 1200 }];
  data.fulfillment.demo_order = { status: 'AWAITING_PACKING', history: [], cases: [{ id: 'demo_case', kind: 'RETURN', status: 'OPEN', openedAt: 1, history: [], refundObligation: { amountCents: 14700, allocations: { sellerCents: 12000, feeCents: 500, taxCents: 1000, shippingCents: 1200 }, policyVersion: 'synthetic-v1' } }] };
  data.intents = [{ id: 'demo_refund', kind: 'REFUND', orderId: 'demo_order', caseId: 'demo_case', status: 'UNKNOWN', confirmed: false }];
  let html = renderApp(data);
  assert.match(html, /Reconcile original case refund/);
  assert.match(html, /name="inspectionConfirmed" required/);
  assert.match(html, /type="submit" disabled>Record reviewed resolution/);
  assert.match(html, /data-action="fulfillment"[^>]*disabled/);
  data.intents[0].status = 'SUCCEEDED'; data.intents[0].confirmed = true;
  html = renderApp(data);
  assert.doesNotMatch(html, /type="submit" disabled>Record reviewed resolution/);
  data.runtime = 'AUTHENTICATED'; data.schema = 'atlas-marketplace-workspace-v1'; data.environment = 'SYNTHETIC_LOCAL'; data.scope = { role: 'BUYER', actorId: 'demo_buyer' };
  html = renderApp(data);
  assert.match(html, /Open protection case/);
  assert.doesNotMatch(html, /data-form="case-resolve"|data-form="refund-review"|data-action="fulfillment"/);
});

function authenticated(role = 'BUYER') {
  const data = demo();
  Object.assign(data, { runtime: 'AUTHENTICATED', mode: undefined, schema: 'atlas-marketplace-workspace-v1', environment: 'PROVIDER_SANDBOX', scope: { role, actorId: '11111111-1111-4111-8111-111111111111' }, now: Date.now(), csrfToken: 'session_bound_csrf' });
  data.eligibilityCards[0].identity.name = 'Approved structural test card';
  data.eligibilityCards[0].media.front.url = '/api/marketplace/evidence/front_reference';
  data.eligibilityCards[0].media.back.url = '/api/marketplace/evidence/back_reference';
  data.eligibilityCards[0].reportUrl = '/api/marketplace/evidence/report_reference';
  data.orders = [{ orderId: 'order_fixture', cardId: 'card_fixture', totalCents: 14700, sellerNetCents: 12000, feeCents: 500, shippingCents: 1200, taxCents: 1000, approvedCard: data.eligibilityCards[0] }];
  data.fulfillment.order_fixture = { status: 'AWAITING_PACKING', history: [{ action: 'TEST_OBSERVATION', at: 1, evidence: { secret: 'PRIVATE_EVIDENCE_NOT_FOR_DOM' } }], cases: [{ id: 'case_fixture', kind: 'APPEAL', status: 'OPEN', history: [], openedAt: 1 }] };
  data.intents = [{ id: 'transfer_fixture', kind: 'TRANSFER', orderId: 'order_fixture', status: 'UNKNOWN' }];
  data.privateCredentials = 'NEVER_RENDER_CREDENTIAL';
  return data;
}

test('authenticated role views never render simulator controls, unrelated authority, demo assets or staff actions for a buyer', () => {
  const data = authenticated();
  let html = renderApp(data);
  assert.match(html, /Authenticated workspace/);
  assert.match(html, /src="\/api\/marketplace\/evidence\/front_reference"/);
  assert.doesNotMatch(html, /LOCAL SYNTHETIC DEMO|data-action="simulate"|data-form="fulfillment-evidence"|data-form="refund-review"|data-form="case-resolve"|id="listing-form"|PRIVATE_EVIDENCE_NOT_FOR_DOM|NEVER_RENDER_CREDENTIAL/);
  data.eligibilityCards[0].media.front.url = '/demo/front.svg';
  data.eligibilityCards[0].reportUrl = 'https://elsewhere.invalid/report';
  html = renderApp(data);
  assert.match(html, /Qualified approved media is unavailable/);
  assert.doesNotMatch(html, /src="\/demo\/|href="https:\/\/elsewhere/);
  data.scope.role = 'STAFF';
  html = renderApp(data);
  assert.match(html, /data-form="fulfillment-evidence"/);
  assert.match(html, /name="packingPhotoRef"/);
  assert.match(html, /name="reviewRef"/);
  assert.doesNotMatch(html, /data-action="simulate"|LOCAL PROVIDER SIMULATOR|value="demo_/);
});

test('authenticated bootstrap uses only workspace/session CSRF and sends operator-entered evidence without fabricated refs', async () => {
  const previous = { document: globalThis.document, fetch: globalThis.fetch, FormData: globalThis.FormData };
  const listeners = {}, calls = [], data = authenticated('STAFF');
  data.fulfillment.order_fixture.cases = [];
  const root = { dataset: { runtime: 'AUTHENTICATED' }, innerHTML: '', addEventListener(type, fn) { listeners[type] = fn; }, querySelector() { return null; } };
  globalThis.document = { getElementById() { return root; }, querySelector() { return null; } };
  const entered = { ref: 'retained_evidence_record', deliveryProofRef: 'retained_carrier_delivery' };
  globalThis.FormData = class { constructor() { return new Map(Object.entries(entered)); } };
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, options }); return { ok: true, json: async () => options.method === 'POST' ? {} : data }; };
  try {
    await import(`../ui/app.mjs?authenticated_qualification=${Date.now()}`);
    assert.equal(calls[0].url, '/api/marketplace/workspace');
    await listeners.submit({ preventDefault() {}, target: { dataset: { form: 'fulfillment-evidence', order: 'order_fixture', step: 'DELIVER' } } });
    const post = calls.find(call => call.options.method === 'POST');
    assert.equal(post.url, '/api/marketplace/fulfillment');
    assert.equal(post.options.headers['x-atlas-csrf'], 'session_bound_csrf');
    assert.equal(post.options.headers['x-atlas-demo-csrf'], undefined);
    const body = JSON.parse(post.options.body);
    assert.equal(body.requestId.startsWith('demo_'), false);
    assert.deepEqual(body.evidence, { ...entered, environment: 'PROVIDER_SANDBOX', orderId: 'order_fixture', cardId: 'card_fixture' });
    const simulator = { disabled: false, dataset: { action: 'simulate', intent: 'transfer_fixture', status: 'succeeded' } };
    await listeners.click({ target: { closest: () => simulator } });
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
    assert.ok(calls.every(call => !call.url.startsWith('/api/demo')));
  } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.FormData = previous.FormData; }
});

test('Stripe return parameters are scrubbed and cannot mark paid or reconcile a mismatched retained reservation', async () => {
  const previous = { document: globalThis.document, fetch: globalThis.fetch, location: globalThis.location, history: globalThis.history, sessionStorage: globalThis.sessionStorage };
  const calls = [], replaced = [], data = authenticated('BUYER');
  data.reservations = [{ id: 'owned_reservation', paymentIntentId: 'original_intent', status: 'PAYMENT_PENDING', quote: { totalCents: 14700 } }];
  const root = { dataset: { runtime: 'AUTHENTICATED' }, innerHTML: '', addEventListener() {}, querySelector() { return null; } };
  globalThis.document = { getElementById() { return root; }, querySelector() { return null; } };
  globalThis.location = { pathname: '/marketplace/', origin: 'https://marketplace.invalid', search: '?redirect_status=succeeded&payment_intent=pi_wrong&payment_intent_client_secret=NEVER_PERSIST_THIS' };
  globalThis.history = { replaceState(_state, _title, url) { replaced.push(url); } };
  globalThis.sessionStorage = { getItem() { return JSON.stringify({ reservationId: 'owned_reservation', intentId: 'different_intent', amountCents: 14700, currency: 'USD' }); }, removeItem() {} };
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, options }); return { ok: true, json: async () => data }; };
  try {
    await import(`../ui/app.mjs?return_qualification=${Date.now()}`);
    assert.deepEqual(replaced, ['/marketplace/']);
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 0);
    assert.equal(data.reservations[0].status, 'PAYMENT_PENDING');
    assert.doesNotMatch(root.innerHTML, /NEVER_PERSIST_THIS|pi_wrong/);
    assert.match(root.innerHTML, /return parameters do not confirm a sale/);
  } finally { Object.assign(globalThis, previous); }
});
