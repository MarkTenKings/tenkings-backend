import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCard } from '../scripts/evaluate-staff-comp-holdout.mjs';
const id = 'ebay:111111111111';
function card(change = {}) {
  return { card_id: 'synthetic-only', variant_correct: true, labels: [{ candidate_id: id, identity_condition_correct: true, sold_event: 'sold', final_price_cents: null, currency: 'USD', independent_sale_key: 'sale-one' }],
    raw_result: { schema_version: 1, engine_version: 'staff-inventory-research-v3', identity: { status: 'base' }, estimate: { status: 'unknown' },
      selected_candidate_ids: [], comparison_assessments: [{ candidate_id: id, classification: 'matched' }], candidates: [{ id, source_eligible: false, sold_price_cents: null, sale_evidence: { status: 'sold' } }] }, ...change };
}
test('a matched sold research attachment counts without a price estimate', () => { const out = scoreCard(card()); assert.equal(out.covered, true); assert.equal(out.verified_value, false); assert.equal(out.assertions, 1); });
test('one wrong confident identity fails the card even alongside a correct sale', () => { const c = card(); c.raw_result.candidates.push({ ...c.raw_result.candidates[0], id: 'ebay:222222222222' }); c.raw_result.comparison_assessments.push({ candidate_id: 'ebay:222222222222', classification: 'matched' }); c.labels.push({ ...c.labels[0], candidate_id: 'ebay:222222222222', identity_condition_correct: false }); assert.equal(scoreCard(c).covered, false); });
test('an accurately labeled active match is not sold coverage or a false sale', () => { const c = card(); c.raw_result.candidates[0].sale_evidence.status = 'active'; c.labels[0].sold_event = 'active'; const out = scoreCard(c); assert.equal(out.covered, false); assert.equal(out.sold_assertions, 0); assert.equal(out.correct_assertions, 1); });
test('unknown offer amount cannot pass a verified-price assertion', () => { const c = card(); Object.assign(c.raw_result.candidates[0], { accepted_offer: { amount: '10.00', currency: 'USD' } }); const out = scoreCard(c); assert.equal(out.covered, false); assert.equal(out.false_price_assertions, 1); });
test('provider failure remains an uncovered card', () => { const out = scoreCard(card({ raw_result: null })); assert.equal(out.covered, false); assert.equal(out.assertions, 0); });
test('new result versions cannot silently reuse the historical UI mapper', () => { const c = card(); c.raw_result.engine_version = 'staff-inventory-research-v4'; assert.throws(() => scoreCard(c), /separately reviewed UI mapping/); });
test('relisted copies cannot establish two independent sales for a value', () => {
  const c = card(), second = 'ebay:222222222222';
  Object.assign(c.raw_result.candidates[0], { source_eligible: true, sold_price_cents: 1000, sold_currency: 'USD' });
  c.raw_result.candidates.push({ ...c.raw_result.candidates[0], id: second });
  c.raw_result.selected_candidate_ids = [id, second]; c.raw_result.estimate = { status: 'estimated', currency: 'USD', count: 2, value_cents: 1000, low_cents: 1000, high_cents: 1000 };
  c.labels[0].final_price_cents = 1000; c.labels.push({ ...c.labels[0], candidate_id: second });
  const out = scoreCard(c); assert.equal(out.covered, true); assert.equal(out.verified_value, false);
});
test('verified value independently checks the displayed arithmetic against human sale amounts', () => {
  const c = card(), second = 'ebay:222222222222';
  Object.assign(c.raw_result.candidates[0], { source_eligible: true, sold_price_cents: 1000, sold_currency: 'USD' });
  c.raw_result.candidates.push({ ...c.raw_result.candidates[0], id: second, sold_price_cents: 1101 });
  c.raw_result.selected_candidate_ids = [id, second];
  c.raw_result.estimate = { status: 'estimated', currency: 'USD', count: 2, value_cents: 1051, low_cents: 1000, high_cents: 1101 };
  c.labels[0].final_price_cents = 1000; c.labels.push({ ...c.labels[0], candidate_id: second, final_price_cents: 1101, independent_sale_key: 'sale-two' });
  assert.equal(scoreCard(c).verified_value, true);
  c.raw_result.estimate.value_cents = 9999;
  assert.equal(scoreCard(c).verified_value, false);
  assert.equal(scoreCard(c).covered, true, 'Correct comp coverage and estimated-value correctness are separate scores');
});
import { evaluateCorpus, evaluatePair, digest } from '../scripts/evaluate-staff-comp-holdout.mjs';
function failureCorpus() {
  const end = '2026-09-16T00:00:00.000Z';
  return { schema_version: 1, synthetic: true,
    protocol: { mapping: 'inventory-v1-v3-ui-union-20260916', reference_bank_sha256: digest('test-only-bank'), reference_roots: [], source_ui_sha256: '880cc1e51d7d22061fdd5b283795052b87b1425e391d41bf19438c86f274759e', labeling_guide_sha256: digest('test-only-guide'), source_commit: 'a'.repeat(40), frozen_at: '2026-09-01T00:00:00.000Z', labels_sealed_at: '2026-09-02T00:00:00.000Z', outputs_unblinded_at: end,
      build_sha256: digest('synthetic-build'), model: 'synthetic-only', model_parameters_sha256: digest('synthetic-model-parameters'), recognition_package_sha256: digest('synthetic-package'), reference_manifest_sha256: digest('synthetic-reference-manifest'), provider_tape_sha256: digest('synthetic-provider-tape'),
      market_window_start: new Date(Date.parse(end) - 180 * 86400000).toISOString(), market_window_end: end, bootstrap_seed: 20260916, bootstrap_resamples: 10000, minimum_independent_families: 20, independent_reviewers: ['test-reviewer-a', 'test-reviewer-b'], implementers: ['test-author'] },
    cards: Array.from({ length: 200 }, (_, i) => ({ card_id: `fixture-${i}`, physical_card_key: `fixture-${i}`, family_id: `family-${Math.floor(i / 10)}`, category: i < 100 ? 'SPORTS' : 'POKEMON', cohort: i % 100 < 50 ? 'known_family' : 'new_set', condition: i % 2 ? 'raw' : 'graded', rarity: 'ordinary', look_alike: false,
      provenance_roots: [`physical:fixture-${i}`, `image:${digest(`front-${i}`)}`, `image:${digest(`back-${i}`)}`], ground_truth: { status: 'unknown', identity: { name: null, year: null, manufacturer: null, product_set: null, card_number: null, variant: null, language: null, edition: null }, condition: { status: 'unknown', raw_condition_band: null, grader: null, numeric_grade: null }, review_evidence_sha256: digest(`unknown-truth-${i}`) }, input_sha256: digest(`input-${i}`), outcome: 'provider_error', market_available: 'unknown', variant_correct: null, labels: [], raw_result: null, result_sha256: null })) };
}
test('all 200 failures and unknown-availability cases remain in the denominator', () => { const out = evaluateCorpus(failureCorpus()); assert.equal(out.cards, 200); assert.equal(out.all_card_coverage, 0); assert.equal(out.market_available_diagnostic.unknown, 200); assert.equal(out.market_available_diagnostic.cards, 0); assert.equal(out.rarity_strata.ordinary.cards, 200); assert.equal(out.representation_gate, false); assert.equal(out.broad_claim_gate, false); });
test('reference leakage and nonindependent reviewers stop evaluation', () => { const corpus = failureCorpus(); corpus.protocol.reference_roots.push(corpus.cards[0].provenance_roots[1]); assert.throws(() => evaluateCorpus(corpus), /lineage overlap/); corpus.protocol.reference_roots = []; corpus.protocol.independent_reviewers[0] = 'test-author'; assert.throws(() => evaluateCorpus(corpus), /independent of implementation/); });
test('a sold match outside the frozen market window cannot count as coverage', () => { const c = card(); c.labels[0].sold_at = '2025-01-01'; const out = scoreCard(c, ['2026-03-20T00:00:00.000Z', '2026-09-16T00:00:00.000Z']); assert.equal(out.covered, false); assert.equal(out.correct_sold_assertions, 1); });
test('paired scoring retains every same sealed input and rejects a swapped card image', () => {
  const baseline = failureCorpus(), candidate = structuredClone(baseline); candidate.protocol.source_commit = 'b'.repeat(40);
  const out = evaluatePair(baseline, candidate); assert.equal(out.paired_cards, 200); assert.equal(out.coverage_change, 0); assert.equal(out.gained_cards, 0); assert.equal(out.lost_cards, 0);
  candidate.cards[0].input_sha256 = digest('swapped-image');
  assert.throws(() => evaluatePair(baseline, candidate), /Paired card input\/truth differs/);
});
