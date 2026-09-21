import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { scoreCard, CURRENT_MAPPING, HoldoutCorpusSchema, HoldoutCorpusV4V5Schema, canonical } from '../scripts/evaluate-staff-comp-holdout.mjs';
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

const NOW = '2026-09-15T10:00:00.000Z';
const seal = c => { c.result_sha256 = digest(c.raw_result); return c; };
function currentCard(version = 'staff-inventory-research-v5', base = 'staff-inventory-research-v3') {
  const front = digest('synthetic-front'), back = digest('synthetic-back'), image = digest('synthetic-listing');
  const photo = sha256 => ({ key: `inventory-photos/11111111-1111-4111-8111-111111111111/${sha256}.jpg`, sha256 });
  const pin = { publicationId: 'synthetic-publication', setId: 'synthetic-set', revision: 1, manifestSha256: digest('synthetic-manifest') };
  const catalog = version === 'staff-inventory-research-v4' || base === 'staff-inventory-research-v4';
  const comparison = { candidate_id: id, classification: 'matched', reason: 'Synthetic identity and condition match.', identity_match: true, variant_match: true, visual_match: true, condition_match: true };
  const candidate = { id, source: 'SoldCompsAPI', listing_url: `https://www.ebay.com/itm/${id.slice(5)}`, retrieved_at: NOW, source_response_sha256: digest('synthetic-search'), title: 'Synthetic Base Card Raw',
    sold_price: '10.00', sold_price_cents: null, sold_currency: 'USD', best_offer_accepted: null, sold_date: '2026-09-08', sold_date_raw: '2026-09-08',
    condition: 'Ungraded', grader: null, numeric_grade: null, raw: true, image_url: 'https://i.ebayimg.com/images/g/synthetic/s-l225.jpg',
    image: { source_url: 'https://i.ebayimg.com/images/g/synthetic/s-l225.jpg', sha256: image, retrieved_at: NOW, content_type: 'image/jpeg', byte_size: 100, storage_key: null },
    source_eligible: false, exclusion_reason: 'Final amount is unverified.', sale_evidence: { status: 'sold', basis: 'listing_type' },
    image_options: { thumbnail_url: 'https://i.ebayimg.com/images/g/synthetic/s-l225.jpg', full_resolution_url: null }, multiple_price_options: false };
  const reference = { id: 'synthetic-reference', kind: 'catalog', trust: 'published_catalog',
    identity: { name: 'Synthetic Card', category: 'Sports cards', year: '2026', manufacturer: 'Synthetic', set_name: 'Synthetic Set', card_number: '1' },
    catalog_id: 'synthetic-catalog', variant_name: 'Base', variant_kind: 'BASE', source_url: 'https://example.com/synthetic-checklist', source_sha256: pin.manifestSha256, captured_at: NOW,
    distinguishing_features: ['Synthetic base diagnostic'], image: null };
  if (catalog) reference.catalog_binding = { publication: pin, card_id: 'synthetic-card', printing_id: 'synthetic-printing', applicability: 'supported',
    scope: { language: 'not_applicable', edition: 'not_applicable', format: 'not_applicable', channel: 'not_applicable' },
    image_id: null, image_relationship: null, image_depicted: null, image_represents_printing_ids: [], image_visible_diagnostic_ids: [] };
  const result = { schema_version: 1, unit_id: 'synthetic-unit', description_event_id: 'synthetic-event', description_hash: digest('synthetic-description'), engine_version: version, model: 'gpt-6-astra', researched_at: NOW,
    timings_ms: { photos: 1, sources: 1, images: 1, model: 1, total: 4 }, photos: { front: photo(front), back: photo(back) }, query: 'Synthetic Base Card',
    research_queries: [{ sequence: 1, query: 'Synthetic Base Card', reason: 'Synthetic search.', status: 'completed', source_response_sha256: candidate.source_response_sha256, candidate_ids: [id], error_code: null }],
    comparison_assessments: [comparison], diagnostics: { schema_version: 1, reason_codes: [], sources: [{ sequence: 1, returned_count: 1, parsed_count: 1, retained_count: 1, has_next_page: false }],
      candidates: [{ candidate_id: id, model_assessment: comparison, model_image_sha256: image, decision_codes: [], comparison_status: 'assessed', image_attempts: [], image_width: 40, image_height: 60 }] },
    identity: { status: 'base', variant_name: 'Base', suggestion: null, reason: 'Synthetic base diagnostic.', reference_ids: [reference.id], photo_features: [{ side: 'front', photo_sha256: front, reference_id: reference.id, evidence_type: 'catalog_feature', reference_feature: 'Synthetic base diagnostic', observation: 'Synthetic diagnostic visible.' }] },
    target_condition: { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'Synthetic card is raw.' }, references: [reference], candidates: [candidate], selected_candidate_ids: [], rejections: [{ candidate_id: id, reason: 'One sale is insufficient for a value.' }],
    estimate: { status: 'unknown', value_cents: null, low_cents: null, high_cents: null, currency: 'USD', count: 0, reason: 'One sale is insufficient for a value.' }, warnings: [] };
  if (catalog) result.catalog_context = { schema_version: 1, status: 'current', scope_receipt: null, scope_evidence: [], publications: [{ publication: pin, lookup_sha256: digest('synthetic-lookup'), coverage: { text: 'partial', applicability: 'partial', images: 'unknown' }, candidate_count: 1, returned_count: 1, truncated: false }] };
  if (version === 'staff-inventory-research-v5') {
    const detailHash = digest('synthetic-detail');
    result.sale_details = { schema_version: 1, base_engine_version: base, requests: [{ item_id: id.slice(5), requested_at: NOW, completed_at: NOW, status: 'observed', response_sha256: detailHash, error_code: null }] };
    Object.assign(candidate, { source_eligible: true, sold_price_cents: 1000, exclusion_reason: null,
      ordinary_sale_detail: { schema_version: 1, basis: 'same_item_ordinary_sale_detail', candidate_id: id, item_id: id.slice(5),
        search: { response_sha256: candidate.source_response_sha256, retrieved_at: NOW, title: candidate.title, listing_type: 'sold', sold_price: '10.00', sold_currency: 'USD', sold_date: '2026-09-08', offer_field: 'absent' },
        detail: { response_sha256: detailHash, retrieved_at: NOW, title: candidate.title, price: '10.0', currency: 'USD', best_offer_accepted: false, ended: true, ended_date_raw: 'Sep 08, 2026 18:17:08 PDT', sold_date: '2026-09-08', sold_banner: 'Item sold on Tue, Sep 8 at 6:17 PM' } } });
  }
  return seal({ ...card(), raw_result: result, provenance_roots: ['physical:synthetic-only', `image:${front}`, `image:${back}`],
    ground_truth: { status: 'exact', identity: { name: 'Synthetic Card', year: '2026', manufacturer: 'Synthetic', product_set: 'Synthetic Set', card_number: '1', variant: 'Base', language: null, edition: null }, condition: { status: 'raw', raw_condition_band: 'near mint', grader: null, numeric_grade: null }, review_evidence_sha256: digest('synthetic-human-review') },
    labels: [{ candidate_id: id, identity_condition_correct: true, sold_event: 'sold', sold_at: '2026-09-08', final_price_cents: 1000, currency: 'USD', independent_sale_key: 'synthetic-sale', evidence_sha256: digest('synthetic-human-sale') }] });
}
const currentScore = c => scoreCard(c, ['2026-03-20T00:00:00.000Z', '2026-09-16T00:00:00.000Z'], CURRENT_MAPPING);

test('frozen legacy schema bytes and score bytes remain unchanged', async () => {
  const bytes = `${JSON.stringify(z.toJSONSchema(HoldoutCorpusSchema), null, 2)}\n`;
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '2945cf31153502bcfe3fb5f8bb8908f113b8094765974d5a850f7d5d857fefba');
  assert.equal(await readFile(new URL('../scripts/staff-comp-holdout.schema.json', import.meta.url), 'utf8'), bytes);
  const golden = '{"assertions":1,"card_id":"synthetic-only","correct_assertions":1,"correct_sold_assertions":1,"covered":true,"false_price_assertions":0,"sold_assertions":1,"variant":"correct","verified_value":false}';
  for (const version of [1, 2, 3]) {
    const c = card(); c.raw_result.engine_version = `staff-inventory-research-v${version}`; const before = canonical(c.raw_result);
    assert.equal(canonical(scoreCard(c)), golden); assert.equal(canonical(c.raw_result), before);
    const valid = currentCard('staff-inventory-research-v4'); valid.raw_result.engine_version = `staff-inventory-research-v${version}`;
    delete valid.raw_result.catalog_context; delete valid.raw_result.references[0].catalog_binding; seal(valid);
    assert.equal(canonical(scoreCard(valid)), golden); assert.equal(canonical(currentScore(valid)), golden);
  }
});
test('new mapping accepts strict V4 and V5 with either base without rewriting persisted bytes', () => {
  for (const [version, base] of [['staff-inventory-research-v4', 'staff-inventory-research-v4'], ['staff-inventory-research-v5', 'staff-inventory-research-v3'], ['staff-inventory-research-v5', 'staff-inventory-research-v4']]) {
    const c = currentCard(version, base), before = canonical(c.raw_result), out = currentScore(c);
    assert.equal(out.covered, true); assert.equal(out.verified_value, false); assert.equal(out.assertions, 1); assert.equal(canonical(c.raw_result), before);
    assert.throws(() => scoreCard(c), /separately reviewed UI mapping/);
  }
  const c = currentCard(); c.raw_result.engine_version = 'staff-inventory-research-v6'; assert.throws(() => currentScore(seal(c)), /separately reviewed UI mapping/);
});
test('V5 must bind exact source/detail receipts even after the altered result is resealed', () => {
  const mutations = [
    r => { r.candidates[0].ordinary_sale_detail.search.response_sha256 = digest('wrong-search'); },
    r => { r.candidates[0].ordinary_sale_detail.detail.response_sha256 = digest('wrong-detail'); },
    r => { r.candidates[0].ordinary_sale_detail.detail.retrieved_at = '2026-09-15T10:00:01.000Z'; },
    r => { r.candidates[0].ordinary_sale_detail.item_id = '222222222222'; },
    r => { r.candidates[0].ordinary_sale_detail.detail.price = '10.01'; },
    r => { r.candidates[0].ordinary_sale_detail.detail.best_offer_accepted = true; },
    r => { r.candidates[0].ordinary_sale_detail.detail.sold_banner = 'Item sold on Wed, Sep 9 at 6:17 PM'; },
    r => { r.sale_details.requests = []; }, r => { r.sale_details.base_engine_version = 'staff-inventory-research-v2'; },
    r => { r.sale_details.requests[0].completed_at = '2026-09-14T10:00:00.000Z'; },
    r => { delete r.sale_details; }, r => { r.engine_version = 'staff-inventory-research-v4'; }, r => { r.engine_version = 'staff-inventory-research-v3'; },
  ];
  for (const mutate of mutations) { const c = currentCard(); mutate(c.raw_result); assert.throws(() => currentScore(seal(c)), undefined, String(mutate)); }
  const c = currentCard(); c.raw_result.warnings.push('Changed after sealing.'); assert.throws(() => currentScore(c), /sealed canonical hash/);
  const unrelated = currentCard(); unrelated.provenance_roots = []; assert.throws(() => currentScore(unrelated), /held-out image root/);
});
test('V4 and V5 catalog scope/current/reference binding is revalidated', () => {
  for (const version of ['staff-inventory-research-v4', 'staff-inventory-research-v5']) {
    for (const mutate of [
      r => { r.catalog_context.status = 'unavailable'; }, r => { r.catalog_context.status = 'no_publication'; },
      r => { r.references[0].catalog_binding.publication = { ...r.references[0].catalog_binding.publication, revision: 2 }; },
      r => { r.references[0].catalog_binding.scope.language = 'en'; },
      r => { r.references[0].catalog_binding.applicability = 'unknown'; },
      r => { r.references[0].source_sha256 = digest('wrong-manifest'); },
      r => { r.catalog_context.publications[0].coverage.applicability = 'truncated'; },
    ]) { const c = currentCard(version, 'staff-inventory-research-v4'); mutate(c.raw_result); assert.throws(() => currentScore(seal(c)), undefined, String(mutate)); }
    const unavailable = currentCard(version, 'staff-inventory-research-v4'); unavailable.raw_result.catalog_context.status = 'unavailable'; unavailable.raw_result.references = [];
    unavailable.raw_result.identity = { status: 'unresolved', variant_name: null, suggestion: null, reason: 'Publication is no longer available.', reference_ids: [], photo_features: [] };
    assert.equal(currentScore(seal(unavailable)).variant, 'unresolved', 'Revocation cannot manufacture variant correctness or require changing historical evidence');
  }
});
test('observed catalog scope requires the exact front/back invocation receipt', () => {
  const c = currentCard('staff-inventory-research-v5', 'staff-inventory-research-v4'), r = c.raw_result;
  r.references[0].catalog_binding.scope.language = 'en';
  r.catalog_context.scope_evidence = [{ field: 'language', value: 'en', side: 'front', photo_sha256: r.photos.front.sha256, observation: 'Synthetic English print.' }];
  r.catalog_context.scope_receipt = { attempt_id: 'synthetic-attempt', invocation_id: 'synthetic-invocation', receipt_ref: 'synthetic-receipt', request_sha256: digest('synthetic-request'), response_sha256: digest('synthetic-response'), http_status: 200, acknowledgement: 'process',
    images: ['front', 'back'].map(side => ({ side, mime_type: 'image/jpeg', transmitted_sha256: r.photos[side].sha256, source_sha256: null })) };
  assert.equal(currentScore(seal(c)).covered, true);
  for (const mutate of [
    r => { r.catalog_context.scope_receipt = null; },
    r => { r.catalog_context.scope_receipt.images[1].transmitted_sha256 = r.photos.front.sha256; },
    r => { r.catalog_context.scope_evidence[0].photo_sha256 = digest('other-photo'); },
    r => { r.catalog_context.scope_evidence[0].value = 'unknown'; },
  ]) { const changed = structuredClone(c); mutate(changed.raw_result); assert.throws(() => currentScore(seal(changed)), undefined, String(mutate)); }
});
test('new mapping retains independent condition, sold, offer-price and nonselected assertion checks', () => {
  const wrong = currentCard(); wrong.labels[0].identity_condition_correct = false; assert.equal(currentScore(wrong).covered, false);
  const unknownPrice = currentCard(); unknownPrice.labels[0].final_price_cents = null; assert.equal(currentScore(unknownPrice).false_price_assertions, 1);
  const active = currentCard('staff-inventory-research-v4'); Object.assign(active.raw_result.candidates[0], { sold_date: null, sold_date_raw: null, sale_evidence: { status: 'active', basis: 'listing_type' } }); active.labels[0].sold_event = 'active';
  const out = currentScore(seal(active)); assert.equal(out.covered, false); assert.equal(out.sold_assertions, 0); assert.equal(out.correct_assertions, 1);
  const unselected = currentCard(); unselected.raw_result.comparison_assessments[0].classification = 'rejected'; unselected.labels[0].sold_event = 'unknown';
  const rejected = currentScore(seal(unselected)); assert.equal(rejected.assertions, 0); assert.equal(rejected.sold_assertions, 1); assert.equal(rejected.false_price_assertions, 1);
  const offer = currentCard('staff-inventory-research-v4'); Object.assign(offer.raw_result.candidates[0], { best_offer_accepted: true, accepted_offer: { amount: '10.00', currency: 'USD', source_field: 'soldPrice', hydrated: true } }); offer.labels[0].final_price_cents = null;
  assert.equal(currentScore(seal(offer)).false_price_assertions, 1);
});

function putCurrentCard(corpus, index = 0, result = currentCard()) {
  corpus.cards[index] = { ...corpus.cards[index], ...result, card_id: corpus.cards[index].card_id,
    provenance_roots: [`physical:${corpus.cards[index].physical_card_key}`, ...result.provenance_roots.filter(root => root.startsWith('image:'))], outcome: 'complete' };
}
test('schema-v2 fixes the 200-card denominator and keeps all failure cards', async () => {
  const corpus = failureCorpus(); corpus.schema_version = 2; corpus.protocol.mapping = CURRENT_MAPPING; putCurrentCard(corpus);
  const out = evaluateCorpus(corpus); assert.equal(out.cards, 200); assert.equal(out.covered, 1); assert.equal(out.broad_claim_gate, false);
  assert.equal(out.rows.filter(row => !row.covered).length, 199); assert.ok(Object.values(out.strata).every(stratum => stratum.cards === 50));
  assert.equal(await readFile(new URL('../scripts/staff-comp-holdout-v4-v5.schema.json', import.meta.url), 'utf8'), `${JSON.stringify(z.toJSONSchema(HoldoutCorpusV4V5Schema), null, 2)}\n`);
  corpus.cards.push(corpus.cards[0]); assert.throws(() => evaluateCorpus(corpus));
  const legacy = failureCorpus(); legacy.protocol.mapping = CURRENT_MAPPING; assert.throws(() => evaluateCorpus(legacy));
});
test('paired common candidate human labels cannot differ in either mapping', () => {
  for (const modern of [false, true]) {
    const baseline = failureCorpus(); if (modern) { baseline.schema_version = 2; baseline.protocol.mapping = CURRENT_MAPPING; }
    const result = currentCard(); if (!modern) { result.raw_result = card().raw_result; seal(result); }
    putCurrentCard(baseline, 0, result);
    const candidate = structuredClone(baseline); assert.equal(evaluatePair(baseline, candidate).coverage_change, 0);
    for (const [field, value] of [['identity_condition_correct', false], ['sold_event', 'unknown'], ['sold_at', '2026-09-09'], ['final_price_cents', null], ['currency', 'CAD'], ['independent_sale_key', 'different-sale'], ['evidence_sha256', digest('different-review')]]) {
      const changed = structuredClone(candidate); changed.cards[0].labels[0][field] = value;
      assert.throws(() => evaluatePair(baseline, changed), /Paired candidate human truth differs/, field);
    }
    candidate.cards[0].labels = []; assert.throws(() => evaluatePair(baseline, candidate), /Paired candidate human truth differs/);
  }
});
test('paired V3/V5 and V4/V5 comparisons share one current mapping and unchanged common truth', () => {
  for (const base of ['staff-inventory-research-v3', 'staff-inventory-research-v4']) {
    const baseline = failureCorpus(); baseline.schema_version = 2; baseline.protocol.mapping = CURRENT_MAPPING;
    const old = currentCard('staff-inventory-research-v4'); old.raw_result.engine_version = base;
    if (base === 'staff-inventory-research-v3') { delete old.raw_result.catalog_context; delete old.raw_result.references[0].catalog_binding; }
    putCurrentCard(baseline, 0, seal(old));
    const candidate = structuredClone(baseline); putCurrentCard(candidate, 0, currentCard('staff-inventory-research-v5', base));
    const out = evaluatePair(baseline, candidate); assert.equal(out.paired_cards, 200); assert.equal(out.coverage_change, 0);
    assert.equal(out.baseline.false_price_assertions, 0); assert.equal(out.candidate.false_price_assertions, 0);
    assert.equal(out.baseline.broad_claim_gate, false); assert.equal(out.candidate.broad_claim_gate, false);
  }
});
