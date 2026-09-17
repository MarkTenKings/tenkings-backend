#!/usr/bin/env node
/** Offline scorer. Independent human labels are required; this file creates none. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const text = z.string().min(1).max(240), hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.string().datetime();
const candidateId = z.string().regex(/^ebay:\d{6,20}$/);
const cents = z.number().int().nonnegative().max(2147483647);
const label = z.object({ candidate_id: candidateId, identity_condition_correct: z.boolean().nullable(), sold_event: z.enum(['sold', 'active', 'unknown']), sold_at: z.string().date().nullable(),
  final_price_cents: cents.nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), independent_sale_key: text.nullable(), evidence_sha256: hash }).strict();
export const HoldoutCorpusSchema = z.object({ schema_version: z.literal(1), synthetic: z.boolean(),
  protocol: z.object({ mapping: z.literal('inventory-v1-v3-ui-union-20260916'), reference_bank_sha256: hash, reference_roots: z.array(text),
    source_ui_sha256: z.literal('880cc1e51d7d22061fdd5b283795052b87b1425e391d41bf19438c86f274759e'), labeling_guide_sha256: hash, source_commit: z.string().regex(/^[a-f0-9]{40}$/),
    build_sha256: hash, model: text, model_parameters_sha256: hash, recognition_package_sha256: hash, reference_manifest_sha256: hash, provider_tape_sha256: hash,
    frozen_at: date, labels_sealed_at: date, outputs_unblinded_at: date, market_window_start: date, market_window_end: date,
    bootstrap_seed: z.literal(20260916), bootstrap_resamples: z.literal(10000), minimum_independent_families: z.literal(20),
    independent_reviewers: z.array(text).min(2), implementers: z.array(text).min(1) }).strict(),
  cards: z.array(z.object({ card_id: text, physical_card_key: text, family_id: text, category: z.enum(['SPORTS', 'POKEMON']), cohort: z.enum(['known_family', 'new_set']),
    condition: z.enum(['raw', 'graded']), rarity: z.enum(['ordinary', 'rare', 'numbered']), look_alike: z.boolean(), provenance_roots: z.array(text).min(3),
    ground_truth: z.object({ status: z.enum(['exact', 'partial', 'unknown']), identity: z.object({ name: text.nullable(), year: text.nullable(), manufacturer: text.nullable(), product_set: text.nullable(), card_number: text.nullable(), variant: text.nullable(), language: text.nullable(), edition: text.nullable() }).strict(), condition: z.object({ status: z.enum(['raw', 'graded', 'unknown']), raw_condition_band: text.nullable(), grader: text.nullable(), numeric_grade: z.number().min(1).max(10).nullable() }).strict(), review_evidence_sha256: hash }).strict(),
    input_sha256: hash, outcome: z.enum(['complete', 'provider_error', 'timeout', 'failed_image', 'abstained', 'other_failure']),
    market_available: z.enum(['yes', 'no', 'unknown']), variant_correct: z.boolean().nullable(), labels: z.array(label).max(24),
    raw_result: z.record(z.string(), z.unknown()).nullable(), result_sha256: hash.nullable() }).strict()).min(200),
}).strict();
export const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const unique = (values, name) => assert.equal(new Set(values).size, values.length, `${name} must be unique`);
const amount = value => { const match = typeof value === 'string' && /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value); return match ? Number(BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')) : null; };
export function scoreCard(card, marketWindow = null) {
  if (!card.raw_result) return { card_id: card.card_id, covered: false, assertions: 0, correct_assertions: 0, sold_assertions: 0, correct_sold_assertions: 0, false_price_assertions: 0, verified_value: false, variant: 'unresolved' };
  const result = card.raw_result;
  assert.ok(['base', 'variant', 'unresolved'].includes(result.identity?.status));
  assert.ok(['estimated', 'unknown'].includes(result.estimate?.status));
  assert.ok(['staff-inventory-research-v1', 'staff-inventory-research-v2', 'staff-inventory-research-v3'].includes(result.engine_version), 'Unknown result version requires a separately reviewed UI mapping');
  assert.equal(result.schema_version, 1); assert.ok(Array.isArray(result.candidates) && result.candidates.length <= 24);
  assert.ok(Array.isArray(result.selected_candidate_ids)); unique(result.candidates.map(x => x.id), 'Candidate IDs'); unique(result.selected_candidate_ids, 'Selections');
  const candidates = new Map(result.candidates.map(x => [x.id, x]));
  const assessments = result.comparison_assessments ?? [];
  unique(assessments.map(x => x.candidate_id), 'Assessment IDs');
  assert.ok(assessments.every(x => candidates.has(x.candidate_id) && ['matched', 'possible', 'rejected'].includes(x.classification)));
  assert.ok(result.selected_candidate_ids.every(id => candidates.has(id)));
  if (result.estimate?.status !== 'estimated') assert.equal(result.selected_candidate_ids.length, 0, 'Unknown estimate cannot assert selected comps');
  const confident = new Set([...result.selected_candidate_ids, ...assessments.filter(x => x.classification === 'matched').map(x => x.candidate_id)]);
  const labels = new Map(card.labels.map(x => [x.candidate_id, x])); unique(card.labels.map(x => x.candidate_id), 'Human label IDs');
  assert.ok([...labels.keys()].every(id => candidates.has(id)), 'Labels must name this exact result candidate pool');
  const truth = card.ground_truth;
  const establishedTruth = !truth || truth.status === 'exact' && (truth.condition.status === 'raw' ? truth.condition.raw_condition_band !== null : truth.condition.status === 'graded' && truth.condition.grader !== null && truth.condition.numeric_grade !== null);
  let correct = 0, correctSold = 0, soldAssertions = 0, falsePrice = 0, soldMatch = false;
  let falseSold = false;
  const selectedSales = new Set(), selectedPrices = []; let eligibleSelected = 0;
  for (const [id, candidate] of candidates) {
    const human = labels.get(id), withinWindow = !marketWindow || typeof human?.sold_at === 'string' && human.sold_at >= marketWindow[0].slice(0, 10) && human.sold_at < marketWindow[1].slice(0, 10), identityCorrect = establishedTruth && human?.identity_condition_correct === true;
    if (confident.has(id) && identityCorrect) correct++;
    const conflicting = /\bconflicting\b/i.test(candidate.exclusion_reason ?? '');
    const accepted = candidate.accepted_offer && amount(candidate.accepted_offer.amount);
    const priceClaim = !!accepted && !conflicting || candidate.source_eligible === true && candidate.sold_price_cents !== null;
    const soldClaim = candidate.sale_evidence?.status === 'sold' || priceClaim || result.selected_candidate_ids.includes(id);
    const claimedPrice = accepted && !conflicting ? accepted : candidate.sold_price_cents;
    const claimedCurrency = accepted && !conflicting ? candidate.accepted_offer.currency : candidate.sold_currency;
    if (soldClaim) { soldAssertions++; if (human?.sold_event === 'sold') correctSold++; else falseSold = true; }
    const correctPrice = !!human && human.sold_event === 'sold' && human.final_price_cents !== null && human.final_price_cents === claimedPrice && human.currency === claimedCurrency;
    if (priceClaim && !correctPrice) falsePrice++;
    if (confident.has(id) && identityCorrect && soldClaim && human?.sold_event === 'sold' && withinWindow) soldMatch = true;
    if (result.selected_candidate_ids.includes(id) && identityCorrect && correctPrice && withinWindow && human?.independent_sale_key && human.currency === 'USD') { eligibleSelected++; selectedSales.add(human.independent_sale_key); selectedPrices.push(human.final_price_cents); }
  }
  const covered = soldMatch && correct === confident.size && !falseSold && falsePrice === 0;
  const estimate = result.estimate, count = selectedPrices.length;
  const mean = count ? Number((selectedPrices.reduce((sum, price) => sum + BigInt(price), 0n) * 2n + BigInt(count)) / (2n * BigInt(count))) : null;
  const verifiedArithmetic = count >= 2 && estimate.currency === 'USD' && estimate.count === count && estimate.value_cents === mean && estimate.low_cents === Math.min(...selectedPrices) && estimate.high_cents === Math.max(...selectedPrices);
  return { card_id: card.card_id, covered, assertions: confident.size, correct_assertions: correct, sold_assertions: soldAssertions,
    correct_sold_assertions: correctSold, false_price_assertions: falsePrice,
    verified_value: covered && estimate.status === 'estimated' && verifiedArithmetic && eligibleSelected === result.selected_candidate_ids.length && selectedSales.size >= 2 && selectedSales.size === result.selected_candidate_ids.length,
    variant: result.identity?.status === 'unresolved' ? 'unresolved' : card.variant_correct === true ? 'correct' : card.variant_correct === false ? 'incorrect' : 'unreviewed' };
}
function wilson(success, total) {
  if (!total) return null;
  const z = 1.959963984540054, p = success / total, denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator, margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return [center - margin, center + margin];
}
function summarize(rows) {
  const sum = key => rows.reduce((n, x) => n + Number(x[key]), 0), covered = sum('covered'), assertions = sum('assertions'), correct = sum('correct_assertions'), sold = sum('sold_assertions'), correctSold = sum('correct_sold_assertions');
  return { cards: rows.length, covered, all_card_coverage: rows.length ? covered / rows.length : null, all_card_wilson95: wilson(covered, rows.length), assertions, correct_assertions: correct,
    assertion_precision: assertions ? correct / assertions : null, assertion_wilson95: wilson(correct, assertions),
    sold_assertions: sold, correct_sold_assertions: correctSold, sold_assertion_precision: sold ? correctSold / sold : null, sold_assertion_wilson95: wilson(correctSold, sold), false_price_assertions: sum('false_price_assertions'), verified_value_cards: sum('verified_value'),
    variant: Object.fromEntries(['correct', 'incorrect', 'unresolved', 'unreviewed'].map(key => [key, rows.filter(x => x.variant === key).length])) };
}
export function evaluateCorpus(input) {
  const corpus = HoldoutCorpusSchema.parse(input), { protocol, cards } = corpus;
  unique(cards.map(x => x.card_id), 'Card IDs'); unique(cards.map(x => x.physical_card_key), 'Physical cards'); unique(cards.map(x => x.input_sha256), 'Inputs');
  unique(protocol.independent_reviewers, 'Reviewers');
  assert.ok(protocol.independent_reviewers.every(x => !protocol.implementers.includes(x)), 'Reviewers must be independent of implementation');
  assert.ok(Date.parse(protocol.labels_sealed_at) <= Date.parse(protocol.outputs_unblinded_at), 'Labels must precede unblinding');
  assert.ok(Date.parse(protocol.frozen_at) <= Date.parse(protocol.labels_sealed_at));
  assert.ok(protocol.market_window_start.endsWith('T00:00:00.000Z') && protocol.market_window_end.endsWith('T00:00:00.000Z'), 'Market window uses whole UTC calendar days');
  assert.equal(Date.parse(protocol.market_window_end) - Date.parse(protocol.market_window_start), 180 * 86400000, 'Market window is frozen at 180 days');
  const roots = new Set(protocol.reference_roots), inputRoots = new Set();
  unique(protocol.reference_roots, 'Reference roots');
  for (const card of cards) {
    assert.ok(card.provenance_roots.includes(`physical:${card.physical_card_key}`), 'Exact physical-card lineage is required');
    assert.ok(card.provenance_roots.filter(root => /^image:[a-f0-9]{64}$/.test(root)).length >= 2, 'Both held-out image hashes are required');
    for (const root of card.provenance_roots) { assert.ok(!roots.has(root), 'Held-out/reference lineage overlap'); assert.ok(!inputRoots.has(root), 'Held-out physical/image/listing lineage duplicate'); inputRoots.add(root); }
    assert.equal(card.raw_result === null, card.result_sha256 === null);
    if (card.raw_result) assert.equal(digest(card.raw_result), card.result_sha256, 'Result bytes do not match sealed canonical hash');
    assert.equal(card.outcome === 'complete', card.raw_result !== null, 'Failure remains a denominator card without a fabricated result');
  }
  const rows = cards.map(card => ({ ...scoreCard(card, [protocol.market_window_start, protocol.market_window_end]), category: card.category, cohort: card.cohort, condition: card.condition, rarity: card.rarity, look_alike: card.look_alike, family: card.family_id, market_available: card.market_available }));
  const strata = {};
  for (const category of ['SPORTS', 'POKEMON']) for (const cohort of ['known_family', 'new_set']) {
    const group = rows.filter(x => x.category === category && x.cohort === cohort); assert.ok(group.length >= 50, 'Each frozen stratum requires at least 50 cards'); strata[`${category}/${cohort}`] = summarize(group);
  }
  assert.equal(new Set(Object.values(strata).map(x => x.cards)).size, 1, 'The frozen study uses equal category/cohort strata');
  const families = new Map();
  for (const row of rows) { const members = families.get(row.family) ?? []; members.push(row); families.set(row.family, members); }
  for (const family of families.values()) assert.equal(new Set(family.map(x => `${x.category}/${x.cohort}`)).size, 1, 'A family cannot straddle frozen cohort/category definitions');
  let state = protocol.bootstrap_seed >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const grouped = Object.keys(strata).map(key => [...families.values()].filter(f => `${f[0].category}/${f[0].cohort}` === key));
  const bootstrap = [];
  for (let n = 0; n < protocol.bootstrap_resamples; n++) {
    let rate = 0;
    for (const stratum of grouped) {
      let total = 0, covered = 0;
      for (let i = 0; i < stratum.length; i++) for (const row of stratum[Math.floor(random() * stratum.length)]) { total++; covered += Number(row.covered); }
      rate += covered / total;
    }
    bootstrap.push(rate / grouped.length);
  }
  bootstrap.sort((a, b) => a - b);
  const summary = summarize(rows), lower = Math.min(summary.all_card_wilson95[0], bootstrap[Math.floor(.025 * bootstrap.length)]);
  const available = rows.filter(x => x.market_available === 'yes');
  const representation = Object.fromEntries(['SPORTS', 'POKEMON'].map(category => {
    const members = rows.filter(row => row.category === category);
    return [category, { condition: Object.fromEntries(['raw', 'graded'].map(key => [key, members.filter(row => row.condition === key).length])),
      rarity: Object.fromEntries(['ordinary', 'rare', 'numbered'].map(key => [key, members.filter(row => row.rarity === key).length])), look_alikes: members.filter(row => row.look_alike).length }];
  }));
  const represented = Object.values(representation).every(group => Object.values(group.condition).every(n => n > 0) && Object.values(group.rarity).every(n => n > 0) && group.look_alikes > 0);
  return { corpus_sha256: digest(corpus), synthetic: corpus.synthetic, mapping: protocol.mapping, ...summary, strata,
    condition_strata: Object.fromEntries(['raw', 'graded'].map(key => [key, summarize(rows.filter(x => x.condition === key))])),
    rarity_strata: Object.fromEntries(['ordinary', 'rare', 'numbered'].map(key => [key, summarize(rows.filter(x => x.rarity === key))])),
    look_alike_diagnostic: summarize(rows.filter(x => x.look_alike)), representation, representation_gate: represented,
    families: families.size, family_bootstrap95: [bootstrap[Math.floor(.025 * bootstrap.length)], bootstrap[Math.floor(.975 * bootstrap.length)]], conservative_lower95: lower,
    market_available_diagnostic: { ...summarize(available), unknown: rows.filter(x => x.market_available === 'unknown').length, unavailable: rows.filter(x => x.market_available === 'no').length },
    broad_claim_gate: !corpus.synthetic && represented && families.size >= protocol.minimum_independent_families && summary.all_card_coverage > .9 && lower > .9 && summary.assertion_precision !== null && summary.assertion_precision >= .98,
    limitations: ['Independent review and seals are declared inputs, not authenticated by this offline file.', 'No real cards or labels are supplied by this tool.', 'No runtime/provider/mobile performance is measured.'], rows };
}
export function evaluatePair(baselineInput, candidateInput) {
  const baseline = evaluateCorpus(baselineInput), candidate = evaluateCorpus(candidateInput);
  assert.equal(baselineInput.synthetic, candidateInput.synthetic, 'Paired arms must have the same synthetic status');
  for (const key of ['mapping', 'labeling_guide_sha256', 'reference_bank_sha256', 'reference_roots', 'reference_manifest_sha256', 'provider_tape_sha256', 'model', 'model_parameters_sha256', 'market_window_start', 'market_window_end']) {
    assert.equal(digest(baselineInput.protocol[key]), digest(candidateInput.protocol[key]), `Paired protocol differs: ${key}`);
  }
  const baselineCards = new Map(baselineInput.cards.map(card => [card.card_id, card]));
  assert.equal(baselineCards.size, candidateInput.cards.length, 'Paired arms must use every same card');
  const sharedFields = ['card_id', 'physical_card_key', 'input_sha256', 'family_id', 'category', 'cohort', 'condition', 'rarity', 'look_alike', 'provenance_roots', 'ground_truth', 'market_available'];
  for (const card of candidateInput.cards) {
    const original = baselineCards.get(card.card_id); assert.ok(original, 'Paired arms must use every same card');
    for (const key of sharedFields) assert.equal(digest(original[key]), digest(card[key]), `Paired card input/truth differs: ${card.card_id}/${key}`);
  }
  const before = new Map(baseline.rows.map(row => [row.card_id, row]));
  const pairedRows = candidate.rows.map(row => ({ card_id: row.card_id, baseline_covered: before.get(row.card_id).covered, candidate_covered: row.covered }));
  return { baseline, candidate, paired_cards: pairedRows.length, coverage_change: candidate.all_card_coverage - baseline.all_card_coverage,
    gained_cards: pairedRows.filter(row => !row.baseline_covered && row.candidate_covered).length,
    lost_cards: pairedRows.filter(row => row.baseline_covered && !row.candidate_covered).length,
    interpretation: 'Descriptive paired outcomes only; no superiority test or fresh-provider claim.', paired_rows: pairedRows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  const readCorpus = async path => { const raw = await readFile(path); assert.ok(raw.length <= 64 * 1024 * 1024, 'Corpus exceeds 64 MiB'); return JSON.parse(raw); };
  if (input === '--schema' && output) await writeFile(output, `${JSON.stringify(z.toJSONSchema(HoldoutCorpusSchema), null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  else if (input === '--paired') {
    const [, baselinePath, candidatePath, reportPath] = process.argv.slice(2); assert.ok(baselinePath && candidatePath && reportPath, 'Usage: --paired BASELINE.json CANDIDATE.json NEW_REPORT.json');
    await writeFile(reportPath, `${JSON.stringify(evaluatePair(await readCorpus(baselinePath), await readCorpus(candidatePath)), null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } else { assert.ok(input && output, 'Usage: evaluate-staff-comp-holdout.mjs INPUT.json NEW_REPORT.json'); await writeFile(output, `${JSON.stringify(evaluateCorpus(await readCorpus(input)), null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
}
