import test from 'node:test';
import assert from 'node:assert/strict';
import { createListing, assertListingBinding } from '../src/listing.mjs';
import { catalogListings } from '../src/catalog.mjs';
import { makeListingInput, makeTestTx, makeSyntheticPolicy } from './listing-fixtures.mjs';

test('listing requires explicit policy and independent Hold and list consent', () => {
  const tx = makeTestTx();
  assert.throws(() => createListing(tx, makeListingInput({ policy: null })), { code: 'POLICY_REQUIRED' });
  delete tx.state.consent.demo_card;
  assert.throws(() => createListing(tx, makeListingInput()), { code: 'HOLD_CONSENT_REQUIRED' });
  tx.state.consent.demo_card = { choice: 'SHIP_TO_ME', sellerId: 'demo_seller', evidenceRef: 'demo_hold_consent' };
  assert.throws(() => createListing(tx, makeListingInput()), { code: 'HOLD_CONSENT_REQUIRED' });
  assert.deepEqual(tx.state.listings, {});
});

test('fee/net has no default; immutable listing and exact request retry cannot double-list a card', () => {
  const tx = makeTestTx();
  const input = makeListingInput();
  const listing = createListing(tx, input);
  assert.equal(listing.sellerNetCents, 12000);
  input.eligibility.approvedCard.identity.name = 'changed after publish';
  assert.equal(tx.state.listings.demo_listing.approvedCard.identity.name, 'ATLAS Synthetic Specimen');
  assert.deepEqual(createListing(tx, makeListingInput()), listing);
  assert.equal(tx.state.events.length, 1);
  assert.throws(() => createListing(tx, makeListingInput({ askingPriceCents: 12600 })), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.throws(() => createListing(tx, makeListingInput({ requestId: 'demo_other_request', listingId: 'demo_other_listing' })), { code: 'CARD_UNAVAILABLE' });
  listing.approvedCard.media.back.sha256 = 'f'.repeat(64);
  assert.throws(() => assertListingBinding(listing), { code: 'LISTING_BINDING_INVALID' });
  assert.throws(() => createListing(makeTestTx(), makeListingInput({ policy: makeSyntheticPolicy({ feeCents: undefined }) })), { code: 'INVALID_CENTS' });
  assert.throws(() => createListing(makeTestTx(), makeListingInput({ askingPriceCents: '12500' })), { code: 'INVALID_CENTS' });
});

test('public catalog distinguishes available listings, filters unknown honestly and redacts authority', () => {
  const tx = makeTestTx();
  createListing(tx, makeListingInput());
  const catalog = catalogListings(tx.state, { query: 'synthetic', numberedDenominator: 99, autograph: false });
  assert.equal(catalog.total, 1);
  assert.equal(catalog.items[0].authority, undefined);
  assert.equal(catalog.items[0].sellerId, undefined);
  assert.equal(catalog.items[0].connectedAccountId, undefined);
  assert.equal(catalogListings(tx.state, { relic: false }).total, 0);
  tx.state.listings.demo_listing.status = 'RESERVED';
  assert.equal(catalogListings(tx.state).total, 0);
});
