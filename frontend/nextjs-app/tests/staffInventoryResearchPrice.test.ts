import assert from 'node:assert/strict';
import test from 'node:test';
import { readResearchPriceEvidence } from '../lib/server/staffInventoryResearchPrice';

test('verified ordinary sale uses exact decimal USD cents', () => {
  assert.deepEqual(readResearchPriceEvidence({ soldPrice: '26.5', soldCurrency: 'USD', bestOfferAccepted: false }), { sold_price_cents: 2650 });
  assert.deepEqual(readResearchPriceEvidence({ soldPrice: '17', soldCurrency: 'USD', bestOfferAccepted: false }), { sold_price_cents: 1700 });
});
test('listed prices and absent offer flags never establish actual proceeds', () => {
  for (const bestOfferAccepted of [true, null, undefined, 'false']) {
    assert.deepEqual(readResearchPriceEvidence({ soldPrice: '26.50', soldCurrency: 'USD', bestOfferAccepted }), { sold_price_cents: null });
  }
});
test('explicit hydrated accepted offer supplies source-bound realized price', () => {
  assert.deepEqual(readResearchPriceEvidence({ soldPrice: '19.95', soldCurrency: 'USD', bestOfferAccepted: true, boaHydrated: true }), {
    sold_price_cents: 1995,
    accepted_offer: { amount: '19.95', currency: 'USD', source_field: 'soldPrice', hydrated: true },
  });
});
test('cross-currency hydration does not confuse original listing with accepted amount', () => {
  assert.deepEqual(readResearchPriceEvidence({ soldPrice: '100', soldCurrency: 'CAD', bestOfferAccepted: true, boaHydrated: true, boaAcceptedPrice: '62.25', boaAcceptedCurrency: 'USD' }), {
    sold_price_cents: 6225,
    accepted_offer: { amount: '62.25', currency: 'USD', source_field: 'boaAcceptedPrice', hydrated: true },
  });
  const eur = readResearchPriceEvidence({ soldPrice: '100', soldCurrency: 'USD', bestOfferAccepted: true, boaHydrated: true, boaAcceptedPrice: '60', boaAcceptedCurrency: 'EUR' });
  assert.equal(eur.sold_price_cents, null);
  assert.equal(eur.accepted_offer?.currency, 'EUR');
});
test('incomplete or conflicting hydration evidence stays unknown', () => {
  const base = { soldPrice: '100', soldCurrency: 'USD', bestOfferAccepted: true, boaHydrated: true };
  for (const patch of [
    { boaAcceptedPrice: '60' }, { boaAcceptedCurrency: 'USD' },
    { boaAcceptedPrice: '60', boaAcceptedCurrency: 'usd' },
    { bestOfferAccepted: false }, { bestOfferAccepted: undefined }, { boaHydrated: 'true' },
  ]) assert.equal(readResearchPriceEvidence({ ...base, ...patch }).sold_price_cents, null);
});
test('malformed and overflow prices cannot become cents', () => {
  for (const soldPrice of [' 10', '1e3', '0', '-1', '3.456', '21474836.48', '10 USD', '$10', '1,000', 10]) {
    assert.equal(readResearchPriceEvidence({ soldPrice, soldCurrency: 'USD', bestOfferAccepted: false }).sold_price_cents, null);
  }
  assert.equal(readResearchPriceEvidence({ soldPrice: '21474836.47', soldCurrency: 'USD', bestOfferAccepted: false }).sold_price_cents, 2147483647);
});
