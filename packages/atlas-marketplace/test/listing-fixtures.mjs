import { hash } from '../src/contract.mjs';

export const FIXTURE_NOW = Date.parse('2026-10-22T22:00:00.000Z');

export function makeSyntheticPolicy(overrides = {}) {
  return {
    id: 'demo_policy', version: 'synthetic-v1', environment: 'SYNTHETIC_LOCAL', approvalRef: 'demo_fixture_policy_only',
    feeCents: 500, feeDisclosure: 'Synthetic example: a fixed $5 fee, including processing. This is not an approved ATLAS fee.',
    fulfillmentRoute: 'ATLAS_HELD', protectionTerms: 'Synthetic protection terms: evidence-backed local test only; no real coverage.',
    returnsTerms: 'Synthetic inspected-return and appeal policy fixture; no real return period is promised.',
    transferReleaseTerms: 'Synthetic release after recorded delivery and explicit release review.',
    payoutTerms: 'Synthetic verified-bank withdrawal after reconciled transfer and availability. No actual funds.',
    reservationTtlMs: 600000, ...overrides,
  };
}

export function makeSyntheticEligibility(overrides = {}) {
  return {
    environment: 'SYNTHETIC_LOCAL', assertionId: 'demo_assertion', cardId: 'demo_card', sellerId: 'demo_seller',
    issuedAt: new Date(FIXTURE_NOW).toISOString(), expiresAt: new Date(FIXTURE_NOW + 300000).toISOString(), authorityRevision: 'demo_authority_v1',
    title: { ownerId: 'demo_seller', evidenceRef: 'demo_title', status: 'VERIFIED' },
    consignment: { sellerId: 'demo_seller', evidenceRef: 'demo_consignment', policyId: 'demo_policy', holdConsentRef: 'demo_hold_consent', status: 'ACTIVE' },
    custody: { cardId: 'demo_card', custodian: 'ATLAS', locationRef: 'demo_vault', evidenceRef: 'demo_custody', status: 'HELD' },
    seller: { accountId: 'demo_seller', connectedAccountId: 'demo_connected', paymentsEligible: true, currency: 'USD' },
    approvedCard: {
      cardId: 'demo_card', certificateId: 'SYNTHETIC-001', approvalId: 'demo_approval', reportVersion: 1,
      reportHash: hash('Synthetic report v1'), reportUrl: '/demo/report',
      identity: { name: 'ATLAS Synthetic Specimen', category: 'SPORTS', year: '2026', set: 'Local test series', grade: 9, numberedDenominator: 99, autograph: false, relic: null },
      media: {
        front: { objectId: 'demo_front', sha256: hash('Synthetic Front'), url: '/demo/front.svg', width: 600, height: 900 },
        back: { objectId: 'demo_back', sha256: hash('Synthetic Back'), url: '/demo/back.svg', width: 600, height: 900 },
      },
    }, ...overrides,
  };
}

export function makeListingInput(overrides = {}) {
  return { requestId: 'demo_listing_request', listingId: 'demo_listing', sellerId: 'demo_seller', askingPriceCents: 12500, eligibility: makeSyntheticEligibility(), policy: makeSyntheticPolicy(), ...overrides };
}

export function makeSyntheticConsent() {
  return { choice: 'HOLD_AND_LIST', sellerId: 'demo_seller', evidenceRef: 'demo_hold_consent' };
}

export function makeTestTx(now = FIXTURE_NOW) {
  const state = { listings: {}, reservations: {}, receipts: {}, journals: [], intents: {}, orders: {}, fulfillment: {}, events: [], consent: { demo_card: makeSyntheticConsent() } };
  return { state, now, emit(type, payload) { state.events.push({ type, payload }); } };
}

export function makeSyntheticQuote(listing, overrides = {}) {
  return { quoteId: 'demo_quote', policyId: listing.policy.id, policyVersion: listing.policy.version, listingHash: listing.bindingHash, itemCents: listing.askingPriceCents, shippingCents: 1200, taxCents: 1000, buyerFeeCents: 0, totalCents: listing.askingPriceCents + 2200, shippingQuoteRef: 'demo_shipping_quote', taxQuoteRef: 'demo_tax_quote', deliveryEstimate: 'Synthetic estimate: 3–5 test days; no physical shipment.', protectionTerms: listing.policy.protectionTerms, expiresAt: new Date(FIXTURE_NOW + 300000).toISOString(), ...overrides };
}
