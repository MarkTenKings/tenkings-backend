/** SoldCompsAPI /docs: soldPrice on an accepted-offer listing is normally an
 * asking amount. Only explicit hydration evidence can establish its sale price.
 * This helper never changes the shared grader/public comps parser. */
export type ResearchAcceptedOffer = {
  amount: string;
  currency: string;
  source_field: 'soldPrice' | 'boaAcceptedPrice';
  hydrated: true;
};

function amount(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim() || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents > 0n && cents <= 2147483647n ? value : null;
}
function currency(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
}
function usdCents(value: string, unit: string) {
  if (unit !== 'USD') return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}

export function readResearchPriceEvidence(raw: Record<string, unknown>): {
  sold_price_cents: number | null;
  accepted_offer?: ResearchAcceptedOffer;
} {
  const listed = amount(raw.soldPrice), listedCurrency = currency(raw.soldCurrency);
  if (raw.bestOfferAccepted === false) {
    // Contradictory provider fields do not establish a price.
    if (raw.boaHydrated === true || raw.boaAcceptedPrice != null || raw.boaAcceptedCurrency != null) return { sold_price_cents: null };
    return { sold_price_cents: listed && listedCurrency ? usdCents(listed, listedCurrency) : null };
  }
  if (raw.bestOfferAccepted !== true || raw.boaHydrated !== true) return { sold_price_cents: null };
  const hasCrossCurrency = raw.boaAcceptedPrice != null || raw.boaAcceptedCurrency != null;
  const acceptedAmount = hasCrossCurrency ? amount(raw.boaAcceptedPrice) : listed;
  const acceptedCurrency = hasCrossCurrency ? currency(raw.boaAcceptedCurrency) : listedCurrency;
  if (!acceptedAmount || !acceptedCurrency) return { sold_price_cents: null };
  const accepted_offer: ResearchAcceptedOffer = {
    amount: acceptedAmount, currency: acceptedCurrency,
    source_field: hasCrossCurrency ? 'boaAcceptedPrice' : 'soldPrice', hydrated: true,
  };
  return { sold_price_cents: usdCents(acceptedAmount, acceptedCurrency), accepted_offer };
}
