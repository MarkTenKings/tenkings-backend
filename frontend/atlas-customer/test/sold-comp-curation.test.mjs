import test from 'node:test';
import assert from 'node:assert/strict';
import { COMP_CURATION_METHOD, curateSoldComps, parseSavedCompSource } from '../lib/sold-comp-curation.mjs';

const binding = { cardId: '11111111-1111-4111-8111-111111111111', approvalActionId: '22222222-2222-4222-8222-222222222222',
  report: { publicToken: `ar_${'A'.repeat(24)}`, version: 1, publicHash: 'a'.repeat(64) } };
const policy = { asOf: '2026-10-21T12:00:00.000Z', recencyDays: 180 };
const candidate = (index, priceMinor = 10000) => ({ match: 'MATCH', requiresReview: true, sale: {
  id: `ebay:${123456789000 + index}`, title: `2024 Sample player #7 Blue /99 PSA 9`,
  listingUrl: `https://www.ebay.com/itm/${123456789000 + index}?tracking=ignored`, grader: 'PSA', grade: '9', raw: false,
  designation: 'STANDARD', evidenceKind: 'SLABBED', identityStatus: 'MATCH', soldAt: `2026-10-${String(20 - index).padStart(2, '0')}T00:00:00.000Z`,
  priceMinor, currency: 'USD', priceBasis: 'sold',
} });
function fixture() {
  return { schema: 'atlas-saved-comp-source-v1', cardId: binding.cardId, approvalActionId: binding.approvalActionId,
    previewId: '33333333-3333-4333-8333-333333333333', sourceHash: 'b'.repeat(64),
    preview: { version: 'atlas-market-preview-v2', binding: { publicToken: binding.report.publicToken, approvalVersion: 1, publicHash: binding.report.publicHash },
      source: 'EBAY_SOLD', engineVersion: 'ebay-sold-comps-v2.3.0', retrievedAt: '2026-10-21T00:00:00.000Z', candidates: [candidate(0), candidate(1, 11000), candidate(2, 9000)] } };
}
function decide(source = fixture(), selectedIds = source.preview.candidates.map(value => value.sale.id)) {
  return curateSoldComps(source, binding, { ...policy, outcome: 'SELECTED', selectedIds, reviewedIds: selectedIds });
}

test('optional 1–5 curation explains exact sold-price arithmetic without changing source or report', () => {
  const source = fixture(), before = structuredClone(source), result = decide(source);
  assert.equal(result.guidance.meanMinor, 10000); assert.equal(result.guidance.sumMinor, 30000);
  assert.equal(result.guidance.sampleCount, 3); assert.equal(result.guidance.lowMinor, 9000); assert.equal(result.guidance.highMinor, 11000);
  assert.equal(result.guidance.method, COMP_CURATION_METHOD); assert.equal(result.guidance.askingPriceMinor, null);
  assert.equal(result.guidance.sellerSetsAskingPrice, true); assert.equal(result.persistence, 'PREVIEW_ONLY');
  assert.equal(result.approvalUnaffected, true); assert.equal(result.policy.status, 'LOCAL_PROPOSAL');
  assert.deepEqual(result.guidance.excludes, ['SHIPPING', 'TAX', 'FEES']); assert.deepEqual(source, before);
});

test('Skip and No suitable comps produce no price or approval gate, never zero', () => {
  for (const outcome of ['SKIP', 'NO_SUITABLE_COMPS']) {
    const result = curateSoldComps(fixture(), binding, { ...policy, outcome });
    assert.equal(result.guidance, null); assert.deepEqual(result.selected, []); assert.equal(result.approvalUnaffected, true);
  }
  assert.throws(() => curateSoldComps(fixture(), binding, { ...policy, outcome: 'SKIP', selectedIds: ['a'] }), { code: 'COMP_SELECTION_OUTCOME_CONFLICT' });
});

test('zero, six, duplicate and unreviewed selections cannot produce guidance', () => {
  const source = fixture(); source.preview.candidates = Array.from({ length: 6 }, (_, i) => candidate(i));
  assert.throws(() => decide(source), { code: 'COMP_SELECTION_BOUND' });
  assert.throws(() => decide(source, []), { code: 'COMP_SELECTION_BOUND' });
  const ids = source.preview.candidates.slice(0, 5).map(value => value.sale.id);
  assert.equal(decide(source, ids).guidance.sampleCount, 5);
  assert.throws(() => decide(source, [ids[0], ids[0]]));
  assert.throws(() => curateSoldComps(source, binding, { ...policy, outcome: 'SELECTED', selectedIds: ids }), { code: 'COMP_HUMAN_REVIEW_REQUIRED' });
});

test('wrong card, approval, report version/hash/token cannot reuse saved evidence', () => {
  for (const mutate of [v => { v.cardId = binding.approvalActionId; }, v => { v.approvalActionId = binding.cardId; },
    v => { v.preview.binding.approvalVersion = 2; }, v => { v.preview.binding.publicHash = 'c'.repeat(64); },
    v => { v.preview.binding.publicToken = `ar_${'B'.repeat(24)}`; }]) {
    const source = fixture(); mutate(source); assert.throws(() => decide(source), { code: 'COMP_APPROVAL_MISMATCH' });
  }
});

test('unknown accepted offers and unpriced sales remain visible but do not enter a calculation', () => {
  const source = fixture(); source.preview.candidates[0].sale.priceBasis = 'accepted_offer_unknown';
  source.preview.candidates[0].sale.priceMinor = 99999; // A crossed-out asking amount is never accepted as sold.
  source.preview.candidates[0].sale.reportedPrice = '999.99';
  source.preview.candidates[1].sale.priceBasis = 'unknown'; source.preview.candidates[1].sale.priceMinor = null;
  const parsed = parseSavedCompSource(source, binding, policy);
  assert.equal(parsed.candidates[0].priceMinor, null); assert.equal(parsed.candidates[0].eligible, false);
  assert.deepEqual(parsed.candidates[0].reasonCodes, ['ACCEPTED_OFFER_UNDISCLOSED']);
  assert.equal(parsed.candidates[1].priceMinor, null); assert.throws(() => decide(source), { code: 'COMP_SELECTION_INELIGIBLE' });
  assert.equal(decide(source, [source.preview.candidates[2].sale.id]).guidance.meanMinor, 9000);
});

test('identity uncertainty, serial/autograph/relic conflicts, lots and reproduction labels stay out', () => {
  for (const mutate of [row => { row.match = 'UNKNOWN'; }, row => { row.sale.identityStatus = 'DIFFERENT'; },
    row => { row.sportsAttributeEvidence = { status: 'UNKNOWN', reasonCodes: ['RELIC_WINDOW_ASSOCIATION_UNVERIFIED'] }; },
    row => { row.variantEvidence = { status: 'CONTRADICTORY' }; }, row => { row.sale.title += ' lot of 3 cards'; },
    row => { row.sale.title += ' reproduction'; }, row => { row.sale.title += ' bundle'; }]) {
    const source = fixture(); mutate(source.preview.candidates[0]); assert.throws(() => decide(source), { code: 'COMP_SELECTION_INELIGIBLE' });
  }
});

test('companies, exact grades, special designations and raw evidence never share a mean', () => {
  for (const mutate of [sale => { sale.grader = 'SGC'; }, sale => { sale.grade = '8'; },
    sale => { sale.grader = 'BGS'; sale.grade = '10'; sale.designation = 'BLACK_LABEL'; },
    sale => { sale.raw = true; sale.evidenceKind = 'RAW'; sale.grader = null; sale.grade = null; sale.designation = null; }]) {
    const source = fixture(); mutate(source.preview.candidates[1].sale);
    assert.throws(() => decide(source), { code: 'COMP_GRADE_GROUP_MIXED' });
  }
  const source = fixture(); source.preview.candidates[0].sale.designation = null;
  assert.throws(() => decide(source), { code: 'COMP_SELECTION_INELIGIBLE' });
});

test('foreign currencies are kept separate and never silently converted', () => {
  const source = fixture(); source.preview.candidates[1].sale.currency = 'EUR';
  assert.throws(() => decide(source), { code: 'COMP_CURRENCY_MIXED' });
  const result = decide(source, [source.preview.candidates[1].sale.id]); assert.equal(result.guidance.currency, 'EUR'); assert.equal(result.guidance.meanMinor, 11000);
});

test('unknown, impossible, future and stale dates cannot establish recent sales', () => {
  for (const soldAt of [null, '2026-02-30T00:00:00.000Z', '2027-10-20T00:00:00.000Z', '2025-10-20T00:00:00.000Z']) {
    const source = fixture(); source.preview.candidates[0].sale.soldAt = soldAt;
    assert.throws(() => decide(source), { code: 'COMP_SELECTION_INELIGIBLE' });
  }
  const source = fixture(); source.preview.retrievedAt = '2027-10-20T00:00:00.000Z';
  assert.throws(() => decide(source), { code: 'COMP_OBSERVATION_INVALID' });
  assert.throws(() => parseSavedCompSource(fixture(), binding, {}), { code: 'COMP_POLICY_REQUIRED' });
});

test('exact half cents round upward without floating point currency arithmetic', () => {
  const source = fixture(); source.preview.candidates = [candidate(0, 10000), candidate(1, 10001)];
  assert.equal(decide(source).guidance.meanMinor, 10001);
  source.preview.candidates.push(candidate(2, 10000)); assert.equal(decide(source).guidance.meanMinor, 10000);
});

test('nonpositive, fractional, unsafe or unbounded money is never accepted', () => {
  for (const priceMinor of [0, -1, 1.2, Number.MAX_SAFE_INTEGER, NaN, Infinity]) {
    const source = fixture(); source.preview.candidates[0].sale.priceMinor = priceMinor;
    assert.throws(() => decide(source), { code: 'COMP_SELECTION_INELIGIBLE' });
  }
});

test('duplicated listing URLs under separate IDs do not inflate sample count', () => {
  for (const duplicate of ['https://www.ebay.com/itm/123456789000?tracking=other',
    'https://ebay.com/itm/another-title/123456789000', 'https://www.ebay.co.uk/itm/123456789000/']) {
    const source = fixture(); source.preview.candidates[1].sale.listingUrl = duplicate;
    const parsed = parseSavedCompSource(source, binding, policy); assert.equal(parsed.candidates[0].eligible, false);
    assert(parsed.candidates[0].reasonCodes.includes('DUPLICATE_LISTING')); assert.throws(() => decide(source));
  }
});

test('unsafe links and private query/internal fields are excluded from the display projection', () => {
  const source = fixture(); source.preview.query = 'PRIVATE SEARCH'; source.preview.internalNotes = 'PRIVATE NOTES';
  const result = parseSavedCompSource(source, binding, policy);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|tracking=|internalNotes/);
  for (const listingUrl of ['javascript:alert(1)', 'https://ebay.com.evil.invalid/itm/123456789000', 'https://user:secret@ebay.com/itm/123456789000']) {
    source.preview.candidates[0].sale.listingUrl = listingUrl; assert.throws(() => decide(source), { code: 'COMP_SELECTION_INELIGIBLE' });
  }
});
