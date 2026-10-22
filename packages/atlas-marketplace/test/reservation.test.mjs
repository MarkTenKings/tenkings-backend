import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createListing } from '../src/listing.mjs';
import { reserveListing, markReservationPaymentPending, releaseReservation, settleReservation } from '../src/reservation.mjs';
import { openLocalStore } from '../src/store.mjs';
import { makeListingInput, makeSyntheticEligibility, makeSyntheticQuote, makeSyntheticConsent, makeTestTx, FIXTURE_NOW } from './listing-fixtures.mjs';

const run = promisify(execFile);
function setup() {
  const tx = makeTestTx();
  const listing = createListing(tx, makeListingInput());
  const input = { requestId: 'demo_reservation_request', reservationId: 'demo_reservation', listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, buyerId: 'demo_buyer', eligibility: makeSyntheticEligibility(), quote: makeSyntheticQuote(listing) };
  return { tx, listing, input };
}
function pending(tx, reservation) {
  const intent = { id: 'demo_payment', intentId: 'demo_payment', kind: 'PAYMENT', status: 'PREPARED', order: structuredClone(reservation.order), amountCents: reservation.order.totalCents, currency: 'USD', objectId: null, confirmed: false, reconciledAt: null, terminalUnpaid: false };
  tx.state.intents.demo_payment = intent;
  markReservationPaymentPending(tx, { reservationId: reservation.id, paymentIntentId: intent.id, eligibility: makeSyntheticEligibility() });
  return intent;
}

test('full buyer total is exact, noncoercing and policy/report bound before reservation', () => {
  for (const change of [{ totalCents: 12500 }, { shippingCents: '1200' }, { buyerFeeCents: 100, totalCents: 14800 }, { listingHash: 'a'.repeat(64) }, { protectionTerms: 'invented insurance' }]) {
    const { tx, input } = setup();
    assert.throws(() => reserveListing(tx, { ...input, quote: { ...input.quote, ...change } }));
    assert.deepEqual(tx.state.reservations, {});
  }
  const { tx, input } = setup();
  input.eligibility.approvedCard.reportHash = 'f'.repeat(64);
  assert.throws(() => reserveListing(tx, input), { code: 'LISTING_AUTHORITY_CHANGED' });
});

test('untouched lease expires, but exact retry retains its original receipt', () => {
  const { tx, input } = setup();
  const reserved = reserveListing(tx, input);
  assert.deepEqual(reserveListing(tx, input), reserved);
  assert.throws(() => reserveListing(tx, { ...input, requestId: 'demo_other_request', reservationId: 'demo_other', buyerId: 'demo_other_buyer' }), { code: 'CARD_RESERVED' });
  tx.now = Date.parse(reserved.expiresAt);
  releaseReservation(tx, { reservationId: reserved.id, reason: 'LEASE_EXPIRED' });
  assert.equal(tx.state.listings.demo_listing.status, 'ACTIVE');
  assert.deepEqual(reserveListing(tx, input), reserved);
  assert.equal(tx.state.reservations[reserved.id].status, 'RELEASED');
});

test('unknown and nonterminal payment outcomes never release or permit a second buyer', () => {
  const { tx, input } = setup();
  const reserved = reserveListing(tx, input);
  const intent = pending(tx, reserved);
  tx.now += 900000;
  for (const status of ['UNKNOWN', 'DISPATCHING', 'PENDING', 'FAILED']) {
    intent.status = status;
    assert.throws(() => releaseReservation(tx, { reservationId: reserved.id, reason: 'PAYMENT_CANCELED', paymentIntentId: intent.id }), { code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    assert.throws(() => releaseReservation(tx, { reservationId: reserved.id, reason: 'LEASE_EXPIRED', paymentIntentId: intent.id }), { code: 'PAYMENT_RECONCILIATION_REQUIRED' });
  }
  const fresh = makeSyntheticEligibility({ issuedAt: new Date(tx.now).toISOString(), expiresAt: new Date(tx.now + 100000).toISOString() });
  const freshQuote = { ...input.quote, expiresAt: new Date(tx.now + 100000).toISOString() };
  assert.throws(() => reserveListing(tx, { ...input, requestId: 'demo_second_request', reservationId: 'demo_second', buyerId: 'demo_buyer_two', eligibility: fresh, quote: freshQuote }), { code: 'CARD_RESERVED' });
  assert.equal(tx.state.listings.demo_listing.status, 'RESERVED');
});

test('settlement checks exact retained payment/order; success is once and stale cancellation cannot release sale', () => {
  const { tx, input } = setup();
  const reserved = reserveListing(tx, input);
  const intent = pending(tx, reserved);
  Object.assign(intent, { status: 'SUCCEEDED', confirmed: true, objectId: 'demo_provider_payment', reconciledAt: FIXTURE_NOW });
  intent.reconciledAt = FIXTURE_NOW + 1;
  assert.throws(() => settleReservation(tx, { reservationId: reserved.id, paymentIntentId: intent.id, orderId: reserved.orderId }), { code: 'PAYMENT_UNCONFIRMED' });
  intent.reconciledAt = FIXTURE_NOW;
  intent.order.buyerId = 'demo_attacker';
  assert.throws(() => settleReservation(tx, { reservationId: reserved.id, paymentIntentId: intent.id, orderId: reserved.orderId }), { code: 'PAYMENT_BINDING_MISMATCH' });
  intent.order.buyerId = reserved.buyerId;
  const order = settleReservation(tx, { reservationId: reserved.id, paymentIntentId: intent.id, orderId: reserved.orderId });
  assert.equal(order.totalCents, 14700);
  assert.equal(order.sellerNetCents, 12000);
  assert.deepEqual(settleReservation(tx, { reservationId: reserved.id, paymentIntentId: intent.id, orderId: reserved.orderId }), order);
  assert.equal(tx.state.events.filter((e) => e.type === 'SALE_CONFIRMED').length, 1);
  Object.assign(intent, { status: 'CANCELED', terminalUnpaid: true, confirmed: false });
  assert.throws(() => releaseReservation(tx, { reservationId: reserved.id, paymentIntentId: intent.id, reason: 'PAYMENT_CANCELED' }), { code: 'RESERVATION_UNAVAILABLE' });
});

test('only an exact canceled/unpaid object frees the original payment reservation', () => {
  const { tx, input } = setup();
  const reserved = reserveListing(tx, input);
  const intent = pending(tx, reserved);
  Object.assign(intent, { status: 'CANCELED', terminalUnpaid: true, confirmed: false, objectId: 'demo_provider_payment', reconciledAt: FIXTURE_NOW });
  assert.throws(() => releaseReservation(tx, { reservationId: reserved.id, paymentIntentId: 'demo_wrong_payment', reason: 'PAYMENT_CANCELED' }), { code: 'PAYMENT_INTENT_MISMATCH' });
  assert.equal(releaseReservation(tx, { reservationId: reserved.id, paymentIntentId: intent.id, reason: 'PAYMENT_CANCELED' }).status, 'RELEASED');
});

test('fresh consent and authority are required before initial or resumed prepared dispatch', () => {
  const { tx, input } = setup();
  tx.state.consent.demo_card.choice = 'SHIP_TO_ME';
  assert.throws(() => reserveListing(tx, input), { code: 'HOLD_CONSENT_REQUIRED' });
  tx.state.consent.demo_card.choice = 'HOLD_AND_LIST';
  const reserved = reserveListing(tx, input);
  const intent = pending(tx, reserved);
  tx.state.consent.demo_card.choice = 'SHIP_TO_ME';
  assert.throws(() => markReservationPaymentPending(tx, { reservationId: reserved.id, paymentIntentId: intent.id, eligibility: makeSyntheticEligibility() }), { code: 'HOLD_CONSENT_REQUIRED' });
  tx.state.consent.demo_card.choice = 'HOLD_AND_LIST';
  const changed = makeSyntheticEligibility({ authorityRevision: 'demo_revoked' });
  assert.throws(() => markReservationPaymentPending(tx, { reservationId: reserved.id, paymentIntentId: intent.id, eligibility: changed }), { code: 'LISTING_AUTHORITY_CHANGED' });
  intent.status = 'UNKNOWN';
  // Recovery reads an already-dispatched intent even if title later changes.
  assert.equal(markReservationPaymentPending(tx, { reservationId: reserved.id, paymentIntentId: intent.id }).paymentIntentId, intent.id);
});

test('actual SQLite cross-process contention grants one reservation and survives reopen', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'atlas-r2-reservation-')));
  const filename = join(directory, 'synthetic.sqlite');
  try {
    const store = openLocalStore({ filename, clock: () => FIXTURE_NOW, environment: 'SYNTHETIC_LOCAL' });
    store.transaction((tx) => { tx.state.consent.demo_card = makeSyntheticConsent(); return createListing(tx, makeListingInput()); });
    store.close();
    const storeUrl = new URL('../src/store.mjs', import.meta.url).href;
    const reservationUrl = new URL('../src/reservation.mjs', import.meta.url).href;
    const fixturesUrl = new URL('./listing-fixtures.mjs', import.meta.url).href;
    const attempts = await Promise.all(['one', 'two'].map(async (key) => {
      const script = `import { openLocalStore } from ${JSON.stringify(storeUrl)}; import { reserveListing } from ${JSON.stringify(reservationUrl)}; import { makeSyntheticQuote, makeSyntheticEligibility, FIXTURE_NOW } from ${JSON.stringify(fixturesUrl)}; const store=openLocalStore({filename:${JSON.stringify(filename)},clock:()=>FIXTURE_NOW,environment:'SYNTHETIC_LOCAL'}); try { const value=store.transaction(tx=>{const listing=tx.state.listings.demo_listing; return reserveListing(tx,{requestId:'demo_request_${key}',reservationId:'demo_reservation_${key}',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,buyerId:'demo_buyer_${key}',eligibility:makeSyntheticEligibility(),quote:makeSyntheticQuote(listing)});}); console.log(JSON.stringify({ok:true,id:value.id})); } catch(e) {console.log(JSON.stringify({ok:false,code:e.code}));} finally {store.close();}`;
      return JSON.parse((await run(process.execPath, ['--input-type=module', '-e', script])).stdout.trim());
    }));
    assert.equal(attempts.filter((a) => a.ok).length, 1);
    assert.equal(attempts.find((a) => !a.ok).code, 'CARD_RESERVED');
    const reopened = openLocalStore({ filename, clock: () => FIXTURE_NOW, environment: 'SYNTHETIC_LOCAL' });
    assert.equal(Object.keys(reopened.read().reservations).length, 1);
    reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
