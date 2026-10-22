import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorityContext, approvedEvidenceUrl } from '../src/authority-context.mjs';
import { assertEligibility, createSyntheticEligibilityAdapter } from '../src/eligibility.mjs';
import { createListing, reviseListing } from '../src/listing.mjs';
import { reserveListing, cancelReservation, markReservationPaymentPending, settleReservation } from '../src/reservation.mjs';
import { catalogListings } from '../src/catalog.mjs';
import { makeTestTx, makeListingInput, makeSyntheticEligibility, makeSyntheticPolicy, makeSyntheticQuote } from './listing-fixtures.mjs';

const ids = { card: '11111111-1111-4111-8111-111111111111', seller: '22222222-2222-4222-8222-222222222222', buyer: '33333333-3333-4333-8333-333333333333', approval: '44444444-4444-4444-8444-444444444444' };
const context = environment => createAuthorityContext({ environment, evidenceOrigin: 'https://fixture.invalid', evidencePathPrefixes: ['/approved/'], qualificationRefs: { fingerprintRef: 'ISOLATED_STRUCTURAL_TEST_ONLY', titlePolicyRef: 'ISOLATED_STRUCTURAL_TEST_ONLY', marketplacePolicyRef: 'ISOLATED_STRUCTURAL_TEST_ONLY', evidenceContractRef: 'ISOLATED_STRUCTURAL_TEST_ONLY' } });
function fixture(environment) {
  const eligibility = makeSyntheticEligibility();
  Object.assign(eligibility, { environment, assertionId: 'assertion_fixture', cardId: ids.card, sellerId: ids.seller });
  eligibility.title.ownerId = ids.seller;
  Object.assign(eligibility.consignment, { sellerId: ids.seller, policyId: 'policy_fixture', holdConsentRef: 'consent_fixture' });
  eligibility.custody.cardId = ids.card;
  Object.assign(eligibility.seller, { accountId: ids.seller, connectedAccountId: 'acct_fixture' });
  Object.assign(eligibility.approvedCard, { cardId: ids.card, approvalId: ids.approval, reportUrl: 'https://fixture.invalid/approved/report', certificateId: 'ATLAS-AAAAAAAAAAAA' });
  for (const side of ['front', 'back']) Object.assign(eligibility.approvedCard.media[side], { objectId: `media_${side}`, url: `/approved/${side}` });
  const policy = makeSyntheticPolicy({ environment, id: 'policy_fixture' });
  const tx = makeTestTx(); tx.context = context(environment);
  tx.state.consent[ids.card] = { choice: 'HOLD_AND_LIST', sellerId: ids.seller, evidenceRef: 'consent_fixture' };
  return { tx, eligibility, input: makeListingInput({ requestId: 'request_listing', listingId: 'listing_fixture', sellerId: ids.seller, eligibility, policy }) };
}

test('trusted nonlocal context reuses exact listing/revision/reservation/payment reducers without synthetic IDs or evidence routes', () => {
  for (const environment of ['PROVIDER_SANDBOX', 'PRODUCTION']) {
    const { tx, eligibility, input } = fixture(environment);
    let listing = createListing(tx, input);
    listing = reviseListing(tx, { requestId: 'request_revision', listingId: listing.id, sellerId: ids.seller, expectedVersion: 1, expectedBindingHash: listing.bindingHash, askingPriceCents: 13000, eligibility });
    const quote = makeSyntheticQuote(listing, { quoteId: 'quote_fixture' });
    const reservation = reserveListing(tx, { requestId: 'request_reserve', reservationId: 'reservation_fixture', listingId: listing.id, listingVersion: 2, listingHash: listing.bindingHash, buyerId: ids.buyer, eligibility, quote });
    assert.equal(reservation.environment, environment); assert.ok(!reservation.orderId.startsWith('demo_'));
    tx.state.intents.payment_fixture = { id: 'payment_fixture', intentId: 'payment_fixture', kind: 'PAYMENT', status: 'PREPARED', order: reservation.order, amountCents: reservation.order.totalCents, currency: 'USD' };
    markReservationPaymentPending(tx, { reservationId: reservation.id, paymentIntentId: 'payment_fixture', eligibility });
    Object.assign(tx.state.intents.payment_fixture, { status: 'SUCCEEDED', confirmed: true, objectId: 'pi_fixture', reconciledAt: tx.now });
    const order = settleReservation(tx, { reservationId: reservation.id, paymentIntentId: 'payment_fixture', orderId: reservation.orderId });
    assert.equal(order.environment, environment); assert.equal(order.approvedCard.cardId, ids.card);
    assert.equal(order.approvedCard.reportHash, input.eligibility.approvedCard.reportHash);
    assert.equal(catalogListings(tx.state, {}, tx.context).total, 0);
  }
});

test('browser-shaped modes and synthetic adapters cannot authorize nonlocal records; media origin and route pins fail closed', async () => {
  const { tx, eligibility, input } = fixture('PROVIDER_SANDBOX');
  assert.throws(() => createListing({ ...tx, context: { environment: 'PROVIDER_SANDBOX' } }, input), { code: 'UNTRUSTED_AUTHORITY_CONTEXT' });
  assert.throws(() => createListing({ ...tx, context: undefined }, input), { code: 'SYNTHETIC_ID_REQUIRED' });
  assert.throws(() => assertEligibility(eligibility, { cardId: ids.card, sellerId: ids.seller, now: tx.now }), { code: 'ELIGIBILITY_UNAVAILABLE' });
  assert.throws(() => createSyntheticEligibilityAdapter({ enabled: true, fixtures: [eligibility], assertionTtlMs: 1000 }), { code: 'SYNTHETIC_ID_REQUIRED' });
  assert.throws(() => createAuthorityContext({ environment: 'PRODUCTION', evidenceOrigin: 'https://fixture.invalid', evidencePathPrefixes: ['/approved/'] }), { code: 'AUTHORITY_QUALIFICATION_REQUIRED' });
  for (const url of ['https://elsewhere.invalid/approved/front', '/demo/front.svg', '//fixture.invalid/approved/front', '/approved/../secret', '/approved/%2e%2e/secret', 'https://name@fixture.invalid/approved/front']) assert.throws(() => approvedEvidenceUrl(url, tx.context), { code: 'EVIDENCE_URL_INVALID' });
  const production = context('PRODUCTION');
  assert.throws(() => assertEligibility(eligibility, { cardId: ids.card, sellerId: ids.seller, now: tx.now, context: production }), { code: 'ELIGIBILITY_UNAVAILABLE' });
  const localTx = makeTestTx(); localTx.context = tx.context;
  assert.throws(() => createListing(localTx, makeListingInput()), { code: 'DOMAIN_ID_INVALID' });
});
