import assert from 'node:assert/strict';
import test from 'node:test';
import { researchImageOptions, researchSaleEvidence } from '../lib/server/staffInventoryResearchEvidence';

test('sold-event evidence is independent of price and missing offer flags', () => {
  const price = { soldPrice: '25.00', soldCurrency: 'USD', bestOfferAccepted: false };
  assert.equal(researchSaleEvidence(price).sale_evidence.status, 'unknown');
  assert.equal(researchSaleEvidence(price).price.sold_price_cents, null);
  assert.equal(researchSaleEvidence({ ...price, ended: true, endedAt: '2026-09-01' }).sale_evidence.status, 'unknown');
  assert.equal(researchSaleEvidence({ ...price, listingType: 'sold' }).price.sold_price_cents, 2500);
  assert.equal(researchSaleEvidence({ ...price, listingType: 'active' }).price.sold_price_cents, null);
  assert.equal(researchSaleEvidence({ soldPrice: '25.00', soldCurrency: 'USD', listingType: 'sold' }).price.sold_price_cents, null);
});

test('positive offer hydration supports a sold event but cannot override active or invalid source type', () => {
  const offer = { soldPrice: '25.00', soldCurrency: 'USD', bestOfferAccepted: true, boaHydrated: true };
  assert.equal(researchSaleEvidence(offer).sale_evidence.basis, 'hydrated_offer');
  assert.equal(researchSaleEvidence(offer).price.sold_price_cents, 2500);
  assert.equal(researchSaleEvidence({ ...offer, listingType: 'active' }).sale_evidence.status, 'active');
  assert.equal(researchSaleEvidence({ ...offer, listingType: 'active' }).price.sold_price_cents, null);
  assert.equal(researchSaleEvidence({ ...offer, listingType: 'unsupported' }).sale_evidence.status, 'unknown');
  assert.equal(researchSaleEvidence({ ...offer, boaHydrated: false }).price.sold_price_cents, null);
});

test('larger primary images are opt-in and must be actual safe provider URLs', () => {
  const thumbnailUrl = 'https://i.ebayimg.com/images/g/example/s-l225.jpg';
  const fullResThumbnailUrl = 'https://i.ebayimg.com/images/g/example/s-l1600.jpg';
  assert.equal(researchImageOptions({ thumbnailUrl, fullResThumbnailUrl }, false).image_url, thumbnailUrl);
  assert.equal(researchImageOptions({ thumbnailUrl, fullResThumbnailUrl }, true).image_url, fullResThumbnailUrl);
  for (const invalid of ['https://seller.example/image.jpg', 'https://i.ebayimg.com.evil.example/a.jpg', fullResThumbnailUrl + '?token=secret', 'http://i.ebayimg.com/a.jpg']) {
    const result = researchImageOptions({ thumbnailUrl, fullResThumbnailUrl: invalid }, true);
    assert.equal(result.image_url, thumbnailUrl);
    assert.equal(result.image_options.full_resolution_url, null);
  }
  assert.equal(researchImageOptions({ thumbnailUrl }, true).image_url, thumbnailUrl);
  assert.equal(researchImageOptions({}, true).image_url, null);
});
