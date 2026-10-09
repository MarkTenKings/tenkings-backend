const assert = require('node:assert/strict');
const test = require('node:test');
const { parseEbaySoldCompsV2Candidate: parse, reclassifyEbaySoldCompsV2Result: reclassify,
  buildEbaySoldCompsV2Query: query, searchEbaySoldCompsV2: search,
  EBAY_SOLD_COMPS_V2_ENGINE_VERSION: version,
  EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION: revision } = require('../dist');

const input = { matchingPolicy: 'ATLAS_IDENTITY_V1', category: 'POKEMON', year: '2020',
  productSet: 'Rebel Clash', cardName: 'Magikarp', cardNumber: '039/192', parallel: null };
const providerItem = (id, title, overrides = {}) => ({ itemId: id, url: `https://www.ebay.com/itm/${id}`,
  title, soldPrice: '92.00', soldCurrency: 'USD', bestOfferAccepted: false,
  endedAt: '2026-10-04', condition: 'Ungraded', ...overrides });
const title = 'Magikarp 039/192 Reverse Cosmos Holo Promo Pokemon Pikachu English Rebel Clash';
const generic = 'Pokemon - SWSH Rebel Clash - Reverse & Standard Holo SIngles';
const oldCandidate = item => { const { matchingPolicy, ...legacy } = input; return parse(item, legacy); };
const saved = candidates => ({ source: 'EBAY_SOLD', engineVersion: version, query: query(input),
  retrievedAt: '2025-01-01T00:00:00.000Z', offset: 0, nextOffset: candidates.length,
  requestedResultCount: 60, hasMore: false, candidates });
const evidenceKeys = new Set(['grader', 'numericGrade', 'raw', 'group', 'parallelMatch', 'matchScore', 'matchReason', 'variantEvidence', 'gradeEvidence']);
const sourceFacts = candidate => Object.fromEntries(Object.entries(candidate).filter(([key]) => !evidenceKeys.has(key)));

test('reclassification is deterministic and offline, preserves capture/price/source/order, and never mutates saved evidence', () => {
  const original = saved([
    oldCandidate(providerItem('227536166244', title)),
    oldCandidate(providerItem('304285169906', generic)),
    oldCandidate(providerItem('377530870025', '2020 Pokemon SWSH Rebel Clash Magikarp Reverse Holo #039/192 PSA 9', { condition: 'Graded' })),
  ]);
  const before = JSON.stringify(original), oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('PAID_REQUEST_FORBIDDEN'); };
  try {
    const result = reclassify(input, original);
    assert.equal(JSON.stringify(original), before);
    assert.equal(result.classificationRevision, revision);
    assert.deepEqual(result.classificationExcluded, [{ id: 'ebay:304285169906', reason: 'UNANCHORED_MULTI_CARD_LISTING' }]);
    assert.deepEqual(result.candidates.map(c => c.id), ['ebay:227536166244', 'ebay:377530870025']);
    for (const key of ['source', 'engineVersion', 'query', 'retrievedAt', 'offset', 'nextOffset', 'requestedResultCount', 'hasMore']) assert.deepEqual(result[key], original[key], key);
    for (const candidate of result.candidates) assert.deepEqual(sourceFacts(candidate), sourceFacts(original.candidates.find(c => c.id === candidate.id)));
    assert.deepEqual(result.candidates[0].variantEvidence.observed.finish, ['reverse holo', 'cosmos holo']);
    assert.equal(result.candidates[0].parallelMatch, 'UNKNOWN');
    assert.equal(result.candidates[1].gradeEvidence.groupKey, 'PSA_9');
    assert.deepEqual(reclassify(input, result), result);
    result.candidates[0].variantEvidence.observed.finish.push('caller mutation');
    assert.equal(JSON.stringify(original), before);
  } finally { globalThis.fetch = oldFetch; }
});

test('sale caveats and unselectable amounts survive title evidence replacement exactly', () => {
  for (const overrides of [{ bestOfferAccepted: true }, { soldCurrency: 'GBP' }, { bestOfferAccepted: null }, { soldPrice: 'unsafe' }]) {
    const old = oldCandidate(providerItem('227536166244', title, overrides));
    const result = reclassify(input, saved([old])).candidates[0];
    assert.equal(result.soldPriceCents, null);
    assert.equal(result.soldPriceDisplay, old.soldPriceDisplay);
    const caveat = old.matchReason.slice(old.matchReason.indexOf('parallel/variant ') + old.matchReason.slice(old.matchReason.indexOf('parallel/variant ')).indexOf('; ') + 2);
    assert.ok(result.matchReason.endsWith(caveat), caveat);
    assert.deepEqual(sourceFacts(result), sourceFacts(old));
  }
});

test('grade reclassification preserves raw versus unresolved slab and special labels without numeric conversions', () => {
  for (const [suffix, condition, status, designation, numeric] of [
    ['NM', 'Ungraded', 'RAW', null, null], ['PSA 9', 'Graded', 'GRADED', 'STANDARD', 9],
    ['BGS 10 Black Label', 'Graded', 'GRADED', 'BLACK_LABEL', 10],
    ['CGC 10 Pristine', 'Graded', 'GRADED', 'PRISTINE', 10],
    ['CGC 9.5', 'Graded', 'GRADED', 'STANDARD', 9.5], ['CGC 10', 'Graded', 'GRADED', null, 10],
    ['PSA/DNA Auto 10', 'Graded', 'UNRESOLVED', null, null],
  ]) {
    const old = oldCandidate(providerItem('227536166244', `2020 Rebel Clash Magikarp 039/192 ${suffix}`, { condition }));
    const candidate = reclassify(input, saved([old])).candidates[0];
    assert.equal(candidate.gradeEvidence.status, status, suffix);
    assert.equal(candidate.gradeEvidence.designation, designation, suffix);
    assert.equal(candidate.numericGrade, numeric, suffix);
    assert.equal(candidate.raw, status === 'RAW', suffix);
  }
});

test('replay rejects wrong query/provenance, unsafe IDs, financial drift and malformed exclusion metadata', () => {
  const source = saved([oldCandidate(providerItem('227536166244', title))]);
  for (const change of [
    r => r.source = 'OTHER', r => r.engineVersion = 'different', r => r.query += ' other',
    r => r.retrievedAt = 'invalid', r => r.candidates.push(r.candidates[0]),
    r => r.candidates[0].id = 'ebay:999999999999',
    r => r.candidates[0].listingUrl = 'https://foreign.invalid/itm/227536166244',
    r => r.candidates[0].soldPriceCents = 3.14, r => r.candidates[0].soldDate = '2026-02-30',
    r => r.classificationExcluded = [],
    r => r.classificationRevision = revision,
    r => { r.classificationRevision = revision; r.classificationExcluded = null; },
    r => { r.classificationRevision = revision; r.classificationExcluded = [{ id: r.candidates[0].id, reason: 'UNANCHORED_MULTI_CARD_LISTING' }]; },
    r => { r.classificationRevision = revision; r.classificationExcluded = [{ id: 'ebay:304285169906', reason: 'INVENTED' }]; },
    r => { r.classificationRevision = revision; r.classificationExcluded = [{ id: 'ebay:304285169906', reason: 'UNANCHORED_MULTI_CARD_LISTING', extra: true }]; },
    r => { r.classificationRevision = revision; r.classificationExcluded = Array.from({ length: 60 }, (_, i) => ({ id: `ebay:${304285169000 + i}`, reason: 'UNANCHORED_MULTI_CARD_LISTING' })); },
  ]) {
    const changed = structuredClone(source); change(changed);
    assert.throws(() => reclassify(input, changed), error => error.code === 'SOLDCOMPS_INVALID_RESPONSE');
  }
  const { matchingPolicy, ...legacy } = input;
  assert.throws(() => reclassify(legacy, source), error => error.code === 'INVALID_INPUT');
  assert.throws(() => reclassify({ ...input, cardNumber: '040/192' }, source), error => error.code === 'SOLDCOMPS_INVALID_RESPONSE');
});

test('fresh ATLAS search records the same filtered IDs while legacy search keeps its saved envelope', async () => {
  const items = [providerItem('227536166244', title), providerItem('304285169906', generic)];
  let calls = 0;
  const fetch = async () => { calls++; return { ok: true, status: 200, text: async () => JSON.stringify({ keyword: query(input), page: 1, totalItems: 2, hasNextPage: false, items }) }; };
  const result = await search(input, { apiKey: 'offline-test', fetch, now: () => new Date('2026-10-08T23:00:00.000Z') });
  assert.equal(calls, 1);
  assert.equal(result.classificationRevision, revision);
  assert.deepEqual(result.classificationExcluded, [{ id: 'ebay:304285169906', reason: 'UNANCHORED_MULTI_CARD_LISTING' }]);
  assert.equal(result.candidates.length, 1); assert.equal(result.nextOffset, 2);
  assert.equal(result.retrievedAt, '2026-10-08T23:00:00.000Z');
  const { matchingPolicy, ...legacy } = input;
  const old = await search(legacy, { apiKey: 'offline-test', fetch });
  assert.equal(old.candidates.length, 2);
  assert.equal('classificationRevision' in old, false); assert.equal('classificationExcluded' in old, false);
});
