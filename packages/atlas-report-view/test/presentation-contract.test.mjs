import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReportPresentation } from '../src/presentation-contract.mjs';

const token = `ar_${'a'.repeat(24)}`;
const binding = { publicToken: token, approvalVersion: 1, publicHash: 'a'.repeat(64) };
function fixture() {
  return { version: 'atlas-report-presentation-v1', binding, revision: 1, updatedAt: '2026-09-22T12:00:00.000Z',
    identityDetails: { category: 'Sports cards', variant: 'Silver', cardType: 'Rookie' },
    slabPhoto: { url: `/api/reports/${token}/presentation/image?v=1&revision=1`, sha256: 'b'.repeat(64), byteCount: 999,
      contentType: 'image/webp', width: 800, height: 1200, alt: 'Actual graded card photograph' },
    market: { observedAt: '2026-09-22T12:00:00.000Z', sales: [{ id: 'sale-1', title: 'Fixture sale',
      listingUrl: 'https://www.ebay.com/itm/123456789012', grader: 'PSA', grade: '9', soldAt: null,
      currency: 'USD', priceMinor: 4500, priceBasis: 'sold' }] },
    dealerOffers: [{ id: 'offer-1', dealerName: 'Fixture authorized dealer', dealerUrl: '/dealers?dealer=fixture-shop&service=buy', amountMinor: 3000, currency: 'USD', expiresAt: '2026-09-23T12:00:00.000Z', terms: 'Physical inspection required.', kind: 'firm' }],
    dealerDirectory: { url: '/dealers?service=buy' } };
}
test('optional presentation binds one report version without modifying its content or filling absent sections', () => {
  const input = fixture(), before = structuredClone(input); assert.deepEqual(parseReportPresentation(input, binding), input); assert.deepEqual(input, before);
  const minimal = { version: input.version, binding, revision: 1, updatedAt: input.updatedAt };
  assert.deepEqual(parseReportPresentation(minimal, binding), minimal);
  for (const change of [{ approvalVersion: 2 }, { publicToken: `ar_${'b'.repeat(24)}` }, { publicHash: 'b'.repeat(64) }]) {
    assert.throws(() => parseReportPresentation(input, { ...binding, ...change }), /BINDING/);
  }
});
test('presentation rejects private fields, remote/unsafe images, different revisions and nonraster media', () => {
  for (const change of [f => { f.actorId = 'private'; }, f => { f.slabPhoto.storageKey = 'private/key'; },
    f => { f.slabPhoto.url = 'https://example.com/image.jpg'; }, f => { f.slabPhoto.url = '//example.com/image.jpg'; },
    f => { f.slabPhoto.url += '&signed=secret'; }, f => { f.slabPhoto.url = `/api/reports/${token}/presentation/image?v=1&revision=2`; },
    f => { f.slabPhoto.url = `/api/reports/${token}/presentation/image?v=2&revision=1`; },
    f => { f.slabPhoto.contentType = 'image/svg+xml'; }, f => { f.slabPhoto.width = 0; }]) {
    const value = fixture(); change(value); assert.throws(() => parseReportPresentation(value));
  }
});
test('accepted-offer unknown prices cannot expose a listing asking amount or become a valuation', () => {
  const value = fixture(); value.market.sales[0].priceBasis = 'accepted_offer_unknown';
  assert.throws(() => parseReportPresentation(value)); value.market.sales[0].priceMinor = null;
  assert.equal(parseReportPresentation(value).market.sales[0].priceMinor, null);
  value.market.sales[0].priceBasis = 'sold'; assert.throws(() => parseReportPresentation(value));
});
test('sold references retain grader and currency, require real eBay listing paths and reject duplicate evidence', () => {
  for (const url of ['javascript:alert(1)', '//www.ebay.com/itm/123', 'https://ebay.com.evil.test/itm/123',
    'https://evil@www.ebay.com/itm/123', 'https://www.ebay.com/sch/i.html', 'https://www.ebay.com\\@evil.test/itm/123']) {
    const value = fixture(); value.market.sales[0].listingUrl = url; assert.throws(() => parseReportPresentation(value), url);
  }
  const value = fixture(); value.market.sales.push(structuredClone(value.market.sales[0])); assert.throws(() => parseReportPresentation(value), /DUPLICATE/);
});
test('dealer offers require amount, currency, expiry, terms and local directory identity', () => {
  for (const change of [f => { delete f.dealerOffers[0].expiresAt; }, f => { f.dealerOffers[0].dealerUrl = 'https://evil.test'; },
    f => { f.dealerOffers[0].dealerUrl += '&dealer=second'; }, f => { f.dealerOffers[0].amountMinor = -1; },
    f => { f.dealerOffers[0].terms = ''; }, f => { f.dealerDirectory.url = '/dealers?service=buy&redirect=https://evil.test'; }]) {
    const value = fixture(); change(value); assert.throws(() => parseReportPresentation(value));
  }
});
