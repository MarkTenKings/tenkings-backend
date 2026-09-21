import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStaffInventoryResearchSaleDetails, type StaffInventoryResearchSaleDetailsInput, type StaffInventoryResearchSaleDetailsReason } from '../lib/server/staffInventoryResearchSaleDetails';

// Sanitized from the four 2026-09-17 provider observations. IDs, player/card
// names and response hashes are synthetic; field presence, amounts and date
// spellings retain the observed controls. No private reports or live URLs.
const sports = {
  itemId: '100000000001', title: '2020 Topps Example Player 1985 35th Anniversary Auto RC #85A-BB Blue Jays PSA 9',
  listingType: 'sold', soldPrice: '89', soldCurrency: 'USD', endedAt: '2026-09-08', buyingFormat: 'auction', bidCount: 17,
};
const sportsDetail = { itemId: sports.itemId, title: sports.title, price: '89.0', currency: 'USD',
  ended: true, endedDate: 'Sep 08, 2026 18:17:08 PDT', soldBanner: 'Item sold on Tue, Sep 8 at 6:17 PM', bestOfferAccepted: false, bidCount: 17 };
const pokemon = { itemId: '100000000002', title: 'Pokémon TCG Sample Card Legendary Treasures Radiant Collection Holo RC1/RC25 EN 2013',
  listingType: 'sold', soldPrice: '1.08', soldCurrency: 'USD', endedAt: '2026-09-11', buyingFormat: 'auction', bidCount: 1 };
const pokemonDetail = { itemId: pokemon.itemId, title: pokemon.title, price: '1.08', currency: 'USD',
  ended: true, endedDate: 'Sep 11, 2026 14:42:41 PDT', soldBanner: 'Item sold on Fri, Sep 11 at 2:42 PM', bestOfferAccepted: false, bidCount: 1 };
const offer = { itemId: '100000000003', title: 'Silver 2023-24 Panini Prizm Basketball Example Player Rookie Card RC 136',
  listingType: 'sold', soldPrice: '886', soldCurrency: 'USD', endedAt: '2026-02-24',
  bestOfferAccepted: true, boaHydrated: false, boaAcceptedPrice: null, boaAcceptedCurrency: null };
const offerDetail = { itemId: offer.itemId, title: offer.title, price: '886.0', currency: 'USD', ended: true,
  endedDate: 'Wed, Sep 16, 11:24 PM', soldBanner: 'This listing sold on Wed, Sep 16 at 11:24 PM', bestOfferAccepted: true };
const active = { itemId: '100000000004', title: 'Sample Card #RC1/RC25 Legendary Treasures Radiant Collection Common Pokemon TCG MP',
  listingType: 'active', currentPrice: '2.84', currentPriceMax: null, buyingFormat: 'buyItNow', bidCount: null };
const activeDetail = { itemId: active.itemId, title: active.title, price: '2.84', currency: 'USD', ended: true,
  endedDate: '3d 20h', soldBanner: null, bestOfferAccepted: false, bidCount: null };

function input(search: Record<string, unknown> = sports, detail: Record<string, unknown> = sportsDetail): StaffInventoryResearchSaleDetailsInput {
  return { candidate_id: `ebay:${search.itemId}`, requested_item_id: String(search.itemId),
    search: { response_sha256: 'a'.repeat(64), retrieved_at: '2026-09-17T11:00:00.000Z', item: { ...search } },
    detail: { response_sha256: 'b'.repeat(64), retrieved_at: '2026-09-17T11:00:05.000Z', item: { ...detail } } };
}
function denied(value: unknown, reason?: StaffInventoryResearchSaleDetailsReason) {
  const result = resolveStaffInventoryResearchSaleDetails(value);
  assert.equal(result.status, 'unconfirmed'); assert.equal(result.sold_price_cents, null); assert.equal(result.evidence, null);
  if (reason && result.status === 'unconfirmed') assert.equal(result.reason, reason);
}

test('the two observed ordinary-sale shapes confirm equal integer cents and preserve exact source spellings', () => {
  for (const [search, detail, expected] of [[sports, sportsDetail, 8900], [pokemon, pokemonDetail, 108]] as const) {
    const original = input(search, detail), result = resolveStaffInventoryResearchSaleDetails(original);
    assert.equal(result.status, 'confirmed'); assert.equal(result.sold_price_cents, expected);
    if (result.status !== 'confirmed') assert.fail('ordinary evidence was not confirmed');
    assert.equal(result.evidence.search.sold_price, search.soldPrice);
    assert.equal(result.evidence.detail.price, detail.price);
    assert.equal(result.evidence.search.offer_field, 'absent');
    assert.equal(result.evidence.detail.best_offer_accepted, false);
    assert.equal(result.evidence.search.response_sha256, original.search.response_sha256);
    assert.equal(result.evidence.detail.response_sha256, original.detail.response_sha256);
    assert.equal(Object.hasOwn(original.search.item as object, 'bestOfferAccepted'), false);
  }
});

test('the observed accepted offer never converts its listed detail price to a realized price', () => {
  denied(input(offer, offerDetail), 'ACCEPTED_OFFER');
  denied(input(offer, { ...offerDetail, bestOfferAccepted: false }), 'ACCEPTED_OFFER');
  denied(input({ ...sports, bestOfferAccepted: true, boaHydrated: true }, sportsDetail), 'ACCEPTED_OFFER');
  denied(input(sports, { ...sportsDetail, bestOfferAccepted: true }), 'ACCEPTED_OFFER');
});

test('the observed active anomaly and even a sold-looking active detail cannot establish sold authority', () => {
  denied(input(active, activeDetail), 'ACTIVE_LISTING');
  denied(input({ ...sports, listingType: 'active' }, sportsDetail), 'ACTIVE_LISTING');
  denied(input(sports, { ...sportsDetail, listingType: 'active' }), 'ACTIVE_LISTING');
  for (const listingType of [undefined, null, 'unknown', 'Sold', false]) denied(input({ ...sports, listingType }, sportsDetail), 'SOLD_STATUS_UNCONFIRMED');
  denied(input(sports, { ...sportsDetail, listingType: 'unknown' }), 'SOLD_STATUS_UNCONFIRMED');
});

test('only an absent or explicitly null search flag can be filled by an explicit detail false', () => {
  const result = resolveStaffInventoryResearchSaleDetails(input({ ...sports, bestOfferAccepted: null }, sportsDetail));
  assert.equal(result.status, 'confirmed');
  if (result.status === 'confirmed') assert.equal(result.evidence.search.offer_field, 'null');
  denied(input({ ...sports, bestOfferAccepted: false }, sportsDetail), 'SEARCH_OFFER_FLAG_NOT_MISSING');
  for (const bestOfferAccepted of ['false', 0, {}, undefined]) denied(input({ ...sports, bestOfferAccepted }, sportsDetail), 'MALFORMED_OFFER_FLAG');
  for (const bestOfferAccepted of [undefined, null, 'false', 0]) denied(input(sports, { ...sportsDetail, bestOfferAccepted }), 'OFFER_STATUS_UNCONFIRMED');
  const withoutFlag: Record<string, unknown> = { ...sportsDetail }; delete withoutFlag.bestOfferAccepted;
  denied(input(sports, withoutFlag), 'OFFER_STATUS_UNCONFIRMED');
});

test('request, candidate, search and returned IDs must identify the same exact item', () => {
  denied({ ...input(), requested_item_id: pokemon.itemId }, 'ITEM_ID_MISMATCH');
  denied({ ...input(), candidate_id: `ebay:${pokemon.itemId}` }, 'ITEM_ID_MISMATCH');
  denied(input({ ...sports, itemId: pokemon.itemId }, sportsDetail), 'ITEM_ID_MISMATCH');
  denied(input(sports, { ...sportsDetail, itemId: pokemon.itemId }), 'ITEM_ID_MISMATCH');
  for (const itemId of [Number(sports.itemId), '123', '../100000000001', sports.itemId + ' ', sports.itemId + '\n']) denied(input(sports, { ...sportsDetail, itemId }), 'ITEM_ID_MISMATCH');
});

test('a matching item ID cannot erase title, currency or amount contradictions', () => {
  denied(input(sports, { ...sportsDetail, title: sportsDetail.title.replace('PSA 9', 'PSA 10') }), 'TITLE_MISMATCH');
  denied(input(sports, { ...sportsDetail, title: sportsDetail.title.replace('85A-BB', '85A-BC') }), 'TITLE_MISMATCH');
  denied(input(sports, { ...sportsDetail, price: '88.99' }), 'AMOUNT_MISMATCH');
  for (const currency of ['CAD', 'usd', null, undefined]) {
    denied(input({ ...sports, soldCurrency: currency }, sportsDetail), 'CURRENCY_UNCONFIRMED');
    denied(input(sports, { ...sportsDetail, currency }), 'CURRENCY_UNCONFIRMED');
  }
  for (const title of ['', sports.title + '\n', '<b>sale</b>', 'x'.repeat(501)]) denied(input(sports, { ...sportsDetail, title }), 'INVALID_TITLE');
  const spaced = resolveStaffInventoryResearchSaleDetails(input(sports, { ...sportsDetail, title: sportsDetail.title.replace('Topps ', 'Topps  ') }));
  assert.equal(spaced.status, 'confirmed');
});

test('malformed, zero, fractional-cent and overflowing amounts never become money', () => {
  for (const price of [' 89', '89 ', '89\n', '$89', '1,000', '8.9e1', '-1', '0', '89.001', '21474836.48', 89, null, undefined]) {
    denied(input(sports, { ...sportsDetail, price }), 'INVALID_AMOUNT');
    denied(input({ ...sports, soldPrice: price }, sportsDetail), 'INVALID_AMOUNT');
  }
  const maximum = resolveStaffInventoryResearchSaleDetails(input({ ...sports, soldPrice: '21474836.47' }, { ...sportsDetail, price: '21474836.47' }));
  assert.equal(maximum.sold_price_cents, 2147483647);
});

test('hydration and multi-option evidence cannot be hidden by detail false', () => {
  for (const patch of [{ boaHydrated: true }, { boaHydrated: 'false' }, { boaAcceptedPrice: '89' }, { boaAcceptedCurrency: 'USD' }]) {
    denied(input({ ...sports, ...patch }, sportsDetail), 'HYDRATION_CONFLICT');
    denied(input(sports, { ...sportsDetail, ...patch }), 'HYDRATION_CONFLICT');
  }
  for (const field of ['soldPriceMax', 'currentPriceMax', 'priceMax']) {
    denied(input({ ...sports, [field]: '100' }, sportsDetail), 'PRICE_OPTIONS_PRESENT');
    denied(input(sports, { ...sportsDetail, [field]: '100' }), 'PRICE_OPTIONS_PRESENT');
  }
});

test('relative, yearless, impossible or conflicting dates remain unconfirmed', () => {
  for (const endedDate of ['3d 20h', 'Wed, Sep 16, 11:24 PM', 'Feb 30, 2026 18:17:08 PST', 'Sep 08, 2026 25:17:08 PDT', 'Sep 08, 2026 18:17:08 XYZ', sportsDetail.endedDate + '\n', null]) {
    denied(input(sports, { ...sportsDetail, endedDate }), 'ENDING_UNCONFIRMED');
  }
  for (const ended of [false, null, 'true']) denied(input(sports, { ...sportsDetail, ended }), 'ENDING_UNCONFIRMED');
  denied(input({ ...sports, endedAt: '2026-09-09' }, sportsDetail), 'DATE_MISMATCH');
  denied(input({ ...sports, endedAt: '2026-02-30' }, sportsDetail), 'ENDING_UNCONFIRMED');
  const future = input(); future.detail.retrieved_at = '2026-09-08T11:00:00.000Z'; denied(future, 'DATE_MISMATCH');
});

test('positive sold banner must agree with the complete ending, not merely contain the word sold', () => {
  for (const soldBanner of [null, '', 'Not sold', 'This item was not sold', 'Item sold on Wed, Sep 9 at 6:17 PM',
    'Item sold on Tue, Sep 8 at 6:17 AM', 'Item sold on Mon, Sep 8 at 6:17 PM', sportsDetail.soldBanner + ' pending', sportsDetail.soldBanner + '\n']) {
    denied(input(sports, { ...sportsDetail, soldBanner }), 'SOLD_BANNER_UNCONFIRMED');
  }
  assert.equal(resolveStaffInventoryResearchSaleDetails(input(sports, { ...sportsDetail, soldBanner: sportsDetail.soldBanner.replace('Item sold', 'This listing sold') })).status, 'confirmed');
});

test('calendar agreement uses the explicit source timezone without requiring the UTC date to match', () => {
  const result = resolveStaffInventoryResearchSaleDetails(input(sports, { ...sportsDetail,
    endedDate: 'Sep 08, 2026 23:17:08 PDT', soldBanner: 'Item sold on Tue, Sep 8 at 11:17 PM' }));
  assert.equal(result.status, 'confirmed');
  if (result.status === 'confirmed') assert.equal(result.evidence.detail.sold_date, '2026-09-08');
});

test('malformed observations, stripped invalid fields and invalid receipts fail closed', () => {
  for (const value of [null, [], {}, { ...input(), search: null }, { ...input(), detail: { ...input().detail, item: [] } }]) denied(value, 'MALFORMED_OBSERVATION');
  for (const invalid_fields of [['bestOfferAccepted'], 'none', null]) denied(input({ ...sports, invalid_fields }, sportsDetail), 'MALFORMED_OBSERVATION');
  denied(input(sports, { ...sportsDetail, invalid_fields: ['price'] }), 'MALFORMED_OBSERVATION');
  for (const field of ['search', 'detail'] as const) {
    const missingHash = input(); missingHash[field].response_sha256 = ''; denied(missingHash, 'INVALID_SOURCE_RECEIPT');
    const malformedHash = input(); malformedHash[field].response_sha256 += '\n'; denied(malformedHash, 'INVALID_SOURCE_RECEIPT');
    const badTime = input(); badTime[field].retrieved_at = '2026-02-30T00:00:00.000Z'; denied(badTime, 'INVALID_SOURCE_RECEIPT');
  }
});

test('repeated resolution is pure, preserves input hashes/observations, and does not return mutable input aliases', () => {
  const original = input({ ...sports, invalid_fields: [] }, { ...sportsDetail, invalid_fields: [] });
  const before = JSON.stringify(original);
  for (const receipt of [original.search, original.detail]) { Object.freeze(receipt.item); Object.freeze(receipt); }
  Object.freeze(original);
  const first = resolveStaffInventoryResearchSaleDetails(original), second = resolveStaffInventoryResearchSaleDetails(original);
  assert.deepEqual(first, second); assert.equal(JSON.stringify(original), before);
  assert.equal(first.status, 'confirmed');
  if (first.status === 'confirmed') first.evidence.search.title = 'Changed returned evidence';
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(resolveStaffInventoryResearchSaleDetails(original), second);
});
