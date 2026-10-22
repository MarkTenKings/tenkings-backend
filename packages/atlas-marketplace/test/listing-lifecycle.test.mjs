import test from 'node:test';
import assert from 'node:assert/strict';
import { createListing, reviseListing, withdrawListing } from '../src/listing.mjs';
import { reserveListing, cancelReservation, expireReservations, markReservationPaymentPending } from '../src/reservation.mjs';
import { catalogListings } from '../src/catalog.mjs';
import { makeListingInput, makeTestTx, makeSyntheticEligibility, makeSyntheticQuote } from './listing-fixtures.mjs';

const change = listing => ({ requestId: 'demo_revision', listingId: listing.id, sellerId: listing.sellerId, expectedVersion: listing.version, expectedBindingHash: listing.bindingHash, askingPriceCents: 15000, eligibility: makeSyntheticEligibility() });
const reserve = (listing, quote) => ({ requestId: 'demo_reserve', reservationId: 'demo_reservation', listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, buyerId: 'demo_buyer', eligibility: makeSyntheticEligibility(), quote });

test('listing revisions retain exact historical checkout and reject stale quotes and seller races', () => {
  const tx = makeTestTx(), original = createListing(tx, makeListingInput()), quote = makeSyntheticQuote(original);
  const reservation = reserveListing(tx, reserve(original, quote));
  assert.throws(() => reviseListing(tx, change(original)), { code: 'LISTING_CHANGE_UNAVAILABLE' });
  cancelReservation(tx, { requestId: 'demo_cancel', reservationId: reservation.id, buyerId: 'demo_buyer' });
  assert.throws(() => reviseListing(tx, { ...change(original), sellerId: 'demo_intruder' }), { code: 'LISTING_UNAUTHORIZED' });
  const revised = reviseListing(tx, change(original));
  assert.equal(revised.version, 2); assert.equal(revised.sellerNetCents, 14500);
  assert.deepEqual(revised.approvedCard, original.approvedCard); assert.deepEqual(revised.policy, original.policy);
  assert.equal(tx.state.listingRevisions[`${original.id}:1`].bindingHash, original.bindingHash);
  assert.equal(tx.state.reservations[reservation.id].order.itemCents, original.askingPriceCents);
  assert.deepEqual(reviseListing(tx, change(original)), revised);
  assert.throws(() => reviseListing(tx, { ...change(original), requestId: 'demo_race' }), { code: 'LISTING_CHANGED' });
  assert.throws(() => reserveListing(tx, { ...reserve(revised, quote), requestId: 'demo_stale', reservationId: 'demo_second' }), { code: 'QUOTE_BINDING_MISMATCH' });
  assert.equal(cancelReservation(tx, { requestId: 'demo_historical_cancel', reservationId: reservation.id, buyerId: 'demo_buyer' }).status, 'RELEASED');
  const input = { ...change(revised), requestId: 'demo_withdraw' };
  assert.equal(withdrawListing(tx, input).status, 'WITHDRAWN');
  assert.equal(catalogListings(tx.state).total, 0);
  assert.equal(withdrawListing(tx, input).status, 'WITHDRAWN');
});

test('unknown financial exposure and revoked consent fail closed; expiry never frees a saved payment', () => {
  const tx = makeTestTx(), listing = createListing(tx, makeListingInput());
  tx.state.intents.demo_orphan = { kind: 'PAYMENT', status: 'UNKNOWN', order: { listingId: listing.id } };
  assert.throws(() => withdrawListing(tx, { ...change(listing), requestId: 'demo_w' }), { code: 'LISTING_FINANCIAL_EXPOSURE' });
  delete tx.state.intents.demo_orphan;
  tx.state.consent.demo_card.choice = 'SHIP_TO_ME';
  assert.throws(() => reviseListing(tx, change(listing)), { code: 'HOLD_CONSENT_REQUIRED' });
  tx.state.consent.demo_card.choice = 'HOLD_AND_LIST';
  const reservation = reserveListing(tx, reserve(listing, makeSyntheticQuote(listing, { expiresAt: new Date(tx.now + 100).toISOString() })));
  assert.throws(() => cancelReservation(tx, { requestId: 'demo_bad', reservationId: reservation.id, buyerId: 'demo_other' }), { code: 'RELEASE_UNAUTHORIZED' });
  tx.state.intents.demo_payment = { kind: 'PAYMENT', id: 'demo_payment', intentId: 'demo_payment', status: 'PREPARED', order: reservation.order, amountCents: reservation.order.totalCents, currency: 'USD' };
  markReservationPaymentPending(tx, { reservationId: reservation.id, paymentIntentId: 'demo_payment', eligibility: makeSyntheticEligibility() });
  tx.now += 100;
  assert.deepEqual(expireReservations(tx), []);
  assert.throws(() => cancelReservation(tx, { requestId: 'demo_cancel', reservationId: reservation.id, buyerId: 'demo_buyer' }), { code: 'PAYMENT_RECONCILIATION_REQUIRED' });
  assert.equal(tx.state.listings[listing.id].status, 'RESERVED');
  const untouched = makeTestTx(), other = createListing(untouched, makeListingInput());
  const short = reserveListing(untouched, reserve(other, makeSyntheticQuote(other, { expiresAt: new Date(untouched.now + 100).toISOString() })));
  untouched.now += 99; assert.deepEqual(expireReservations(untouched), []);
  untouched.now += 1; assert.equal(expireReservations(untouched)[0].id, short.id);
  assert.deepEqual(expireReservations(untouched), []);
  assert.equal(untouched.state.listings[other.id].status, 'ACTIVE');
});
