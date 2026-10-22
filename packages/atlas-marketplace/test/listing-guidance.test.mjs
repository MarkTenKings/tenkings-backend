import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../src/contract.mjs';
import { createListing } from '../src/listing.mjs';
import { createUnavailableListingGuidanceAdapter, previewListingGuidance, recordListingGuidanceRefresh } from '../src/listing-guidance.mjs';
import { makeTestTx, makeListingInput, FIXTURE_NOW } from './listing-fixtures.mjs';

function fixture(listing) {
  const date = new Date(FIXTURE_NOW - 86400000).toISOString();
  const selected = [{ id: 'demo_sale', title: 'Synthetic single-card sold reference', listingUrl: '/demo/sales/demo_sale', soldAt: date, priceMinor: 10000, priceBasis: 'sold', currency: 'USD', raw: false, grader: 'PSA', grade: 9, designation: 'STANDARD', group: 'PSA / 9 / STANDARD', eligible: true, reasonCodes: [] }];
  const receipt = { schema: 'atlas-comp-curation-receipt-v1', status: 'LOCAL_PROPOSAL', visibility: 'PRIVATE_INTERNAL', requestId: 'demo_curation', revision: 1,
    binding: { cardId: listing.cardId, approvalActionId: listing.approvedCard.approvalId, reportHash: listing.approvedCard.reportHash, publicVersion: listing.approvedCard.reportVersion },
    source: { previewId: 'demo_market_preview', requestHash: hash('request'), resultHash: hash('result'), artifactHash: hash('artifact'), previewHash: hash('preview') },
    outcome: 'SELECTED', selected, selectedFactsHash: hash(selected), reportSnapshotUnaffected: true,
    guidance: { status: 'LOCAL_PROPOSAL', method: 'selected-sold-price-arithmetic-mean-v1', meanMinor: 10000, sumMinor: 10000, sampleCount: 1, lowMinor: 10000, highMinor: 10000, currency: 'USD', group: 'PSA / 9 / STANDARD', oldestSaleAt: date, newestSaleAt: date, excludes: ['SHIPPING', 'TAX', 'FEES'], rounding: 'NEAREST_MINOR_UNIT_HALF_UP', askingPriceMinor: null, sellerSetsAskingPrice: true },
  };
  return {
    policy: { id: 'demo_guidance_policy', version: 'demo_v1', environment: 'SYNTHETIC_LOCAL', status: 'APPROVED_SYNTHETIC', rightsStatus: 'APPROVED_SYNTHETIC', method: 'selected-sold-price-arithmetic-mean-v1', maxAgeMs: 86400000 * 30, approvalRef: 'demo_policy_only', rightsEvidenceRef: 'demo_synthetic_artwork_only' },
    packet: { schema: 'atlas-marketplace-r1-guidance-copy-v1', environment: 'SYNTHETIC_LOCAL', listingVersion: listing.version, listingHash: listing.bindingHash, identityHash: hash(listing.approvedCard.identity), receipt, receiptHash: hash(receipt), identityMatches: { demo_sale: 'CONFIRMED' }, observedAt: new Date(FIXTURE_NOW).toISOString() },
  };
}

test('listing guidance stays unavailable for real or unresolved policy and unknown designation', async () => {
  const tx = makeTestTx(), listing = createListing(tx, makeListingInput());
  const { packet, policy } = fixture(listing);
  assert.equal((await createUnavailableListingGuidanceAdapter().read()).status, 'UNAVAILABLE');
  assert.equal(previewListingGuidance({ listing, packet, policy: { ...policy, rightsStatus: 'UNRESOLVED' }, now: FIXTURE_NOW }).status, 'UNAVAILABLE');
  packet.receipt.selected[0].designation = null;
  packet.receipt.selectedFactsHash = hash(packet.receipt.selected);
  packet.receiptHash = hash(packet.receipt);
  assert.equal(previewListingGuidance({ listing, packet, policy, now: FIXTURE_NOW }).reason, 'COMP_DESIGNATION_UNCONFIRMED');
});

test('explicit saved guidance refresh preserves the exact asking price/report, retains receipts and refuses stale evidence', () => {
  const tx = makeTestTx(), listing = createListing(tx, makeListingInput());
  const { packet, policy } = fixture(listing);
  const before = structuredClone(tx.state.listings);
  const input = { requestId: 'demo_guidance_refresh', listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, sellerId: listing.sellerId, packet, policy };
  const receipt = recordListingGuidanceRefresh(tx, input);
  assert.equal(receipt.guidance.meanMinor, 10000);
  assert.equal(listing.askingPriceCents, 12500);
  assert.deepEqual(tx.state.listings, before);
  assert.deepEqual(recordListingGuidanceRefresh(tx, input), receipt);
  assert.equal(tx.state.listingGuidance[listing.id].length, 1);
  const changed = structuredClone(packet);
  changed.identityHash = hash('different printing');
  assert.equal(previewListingGuidance({ listing, packet: changed, policy, now: FIXTURE_NOW }).status, 'UNAVAILABLE');
  assert.equal(previewListingGuidance({ listing, packet, policy, now: FIXTURE_NOW + 86400000 * 31 }).reason, 'COMP_STALE');
});
