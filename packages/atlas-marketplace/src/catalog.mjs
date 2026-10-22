import { clone, requireValue } from './contract.mjs';
import { assertListingBinding } from './listing.mjs';

const ALLOWED_FILTERS = new Set(['query', 'category', 'year', 'set', 'grade', 'minPriceCents', 'maxPriceCents', 'numberedDenominator', 'autograph', 'relic', 'offset', 'limit']);
// Only actual ACTIVE listings enter this projection; private collection/title and
// consignment/custody evidence never become public catalog fields.
export function catalogListings(state, filters = {}) {
  requireValue(filters && typeof filters === 'object' && !Array.isArray(filters), 'FILTER_INVALID');
  requireValue(Object.keys(filters).every((key) => ALLOWED_FILTERS.has(key)), 'FILTER_INVALID');
  for (const key of ['query', 'year', 'set', 'category']) if (filters[key] !== undefined) requireValue(typeof filters[key] === 'string' && filters[key].length <= 200, 'FILTER_INVALID');
  for (const key of ['minPriceCents', 'maxPriceCents', 'numberedDenominator', 'offset', 'limit']) if (filters[key] !== undefined) requireValue(Number.isSafeInteger(filters[key]) && filters[key] >= 0, 'FILTER_INVALID');
  if (filters.grade !== undefined) requireValue(typeof filters.grade === 'number' && Number.isFinite(filters.grade) && filters.grade >= 1 && filters.grade <= 10, 'FILTER_INVALID');
  for (const key of ['autograph', 'relic']) if (filters[key] !== undefined) requireValue(typeof filters[key] === 'boolean', 'FILTER_INVALID');
  requireValue(filters.minPriceCents === undefined || filters.maxPriceCents === undefined || filters.minPriceCents <= filters.maxPriceCents, 'FILTER_INVALID');
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 30;
  requireValue(limit > 0 && limit <= 100, 'FILTER_INVALID');
  const normalize = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US');
  const matches = Object.values(state.listings).filter((listing) => {
    if (listing.status !== 'ACTIVE') return false;
    assertListingBinding(listing);
    const identity = listing.approvedCard.identity;
    if (filters.query && !normalize([identity.name, identity.set, identity.year, listing.approvedCard.certificateId].join(' ')).includes(normalize(filters.query))) return false;
    for (const key of ['category', 'year', 'set', 'grade', 'numberedDenominator', 'autograph', 'relic']) if (filters[key] !== undefined && identity[key] !== filters[key]) return false;
    return !(filters.minPriceCents !== undefined && listing.askingPriceCents < filters.minPriceCents) && !(filters.maxPriceCents !== undefined && listing.askingPriceCents > filters.maxPriceCents);
  }).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return {
    total: matches.length, offset, nextOffset: offset + limit < matches.length ? offset + limit : null,
    items: matches.slice(offset, offset + limit).map((listing) => ({ id: listing.id, version: listing.version, bindingHash: listing.bindingHash, status: listing.status, environment: listing.environment, cardId: listing.cardId, sellerDisplay: 'Synthetic seller', askingPriceCents: listing.askingPriceCents, currency: listing.currency, fulfillmentRoute: listing.policy.fulfillmentRoute, approvedCard: clone(listing.approvedCard) })),
  };
}
