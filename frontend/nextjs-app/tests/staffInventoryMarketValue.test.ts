import assert from 'node:assert/strict';
import test from 'node:test';
import { StaffInventoryResearchResultSchema } from '../lib/staffInventoryResearch';
import { getStaffInventoryMarketCalculation, StaffInventoryMarketValueResponseSchema, StaffInventoryMarketValueSummarySchema, summarizeStaffInventoryResearchMarketValue } from '../lib/staffInventoryMarketValue';
import { marketJob, marketResult, marketReview, MARKET_TIME } from './fixtures/staffInventoryMarketValue';

test('legacy and modern summaries use only selected evidence, half-cent rounds up, and inputs stay immutable', () => {
  for (const version of [1, 2, 3, 5] as const) {
    const result = marketResult(version), job = marketJob(result), before = JSON.stringify(job);
    const calculated = getStaffInventoryMarketCalculation(result)!;
    assert.deepEqual({ ...calculated, selected_candidates: calculated.selected_candidates.map(candidate => candidate.id) }, {
      value_cents: 1002, low_cents: 1001, high_cents: 1002, count: 2, total_cents: 2003, selected_candidates: result.selected_candidate_ids,
    });
    const summary = summarizeStaffInventoryResearchMarketValue(job);
    assert.deepEqual(summary, { unit_id: job.unit_id, description_event_id: job.description_event_id, status: 'estimated', value_cents: 1002,
      low_cents: 1001, high_cents: 1002, comp_count: 2, researched_at: MARKET_TIME, reason: result.estimate.reason });
    StaffInventoryMarketValueSummarySchema.parse(summary);
    assert.equal(JSON.stringify(job), before);
    assert.equal(JSON.stringify(summary).includes('9900'), false, 'A wrong-card candidate must not increase the average or count.');
    if (version === 1) assert.equal(Object.hasOwn(result, 'comparison_assessments'), false);
  }
});

test('queued, running, failed and superseded jobs cannot reuse a saved estimate', () => {
  for (const status of ['queued', 'running', 'failed', 'superseded'] as const) {
    const summary = summarizeStaffInventoryResearchMarketValue({ ...marketJob(), status });
    assert.equal(summary.status, status === 'superseded' ? 'unknown' : status);
    assert.equal(summary.value_cents, null); assert.equal(summary.low_cents, null); assert.equal(summary.high_cents, null);
    assert.equal(summary.comp_count, 0); assert.equal(summary.researched_at, null);
    StaffInventoryMarketValueSummarySchema.parse(summary);
  }
  assert.throws(() => summarizeStaffInventoryResearchMarketValue({ ...marketJob(), status: 'completed' }));
  assert.equal(summarizeStaffInventoryResearchMarketValue({ ...marketJob(), completed_at: null }).status, 'unknown');
});

test('unknown completed research stays unknown with a reason and no invented zero value', () => {
  const result = marketResult();
  result.estimate = { status: 'unknown', value_cents: null, low_cents: null, high_cents: null, currency: 'USD', count: 0, reason: 'No sufficiently matched sales.' };
  result.selected_candidate_ids = [];
  result.rejections = result.candidates.map(candidate => ({ candidate_id: candidate.id, reason: 'Matching evidence is unresolved.' }));
  StaffInventoryResearchResultSchema.parse(result);
  const summary = summarizeStaffInventoryResearchMarketValue(marketJob(result));
  assert.equal(summary.status, 'unknown'); assert.equal(summary.reason, result.estimate.reason); assert.equal(summary.researched_at, MARKET_TIME);
  assert.equal(summary.value_cents, null); assert.equal(summary.comp_count, 0); assert.equal(getStaffInventoryMarketCalculation(result), null);
  assert.equal(summarizeStaffInventoryResearchMarketValue({ ...marketJob(), result: null }).status, 'unknown');
});

test('stale or mismatched result bindings fail closed without leaking evidence', () => {
  for (const changed of [{ unit_id: 'different-unit' }, { description_event_id: 'old-description' }, { description_hash: '0'.repeat(64) }]) {
    const job = marketJob(); job.result = { ...job.result!, ...changed };
    const summary = summarizeStaffInventoryResearchMarketValue(job);
    assert.equal(summary.unit_id, job.unit_id); assert.equal(summary.description_event_id, job.description_event_id);
    assert.equal(summary.status, 'unknown'); assert.equal(summary.value_cents, null); assert.equal(summary.comp_count, 0);
  }
});

test('broken arithmetic, mismatched assessments and unverified prices never establish a summary value', () => {
  const mutations = [
    (result: ReturnType<typeof marketResult>) => { result.estimate.value_cents = 1001; },
    (result: ReturnType<typeof marketResult>) => { result.estimate.low_cents = 1000; },
    (result: ReturnType<typeof marketResult>) => { result.estimate.high_cents = 1003; },
    (result: ReturnType<typeof marketResult>) => { result.estimate.count = 3; },
    (result: ReturnType<typeof marketResult>) => { result.comparison_assessments![0].classification = 'rejected'; },
    (result: ReturnType<typeof marketResult>) => { result.comparison_assessments![0].visual_match = false; },
    (result: ReturnType<typeof marketResult>) => { result.candidates[0].best_offer_accepted = null; },
    (result: ReturnType<typeof marketResult>) => { result.candidates[0].source_eligible = false; },
    (result: ReturnType<typeof marketResult>) => { result.candidates[0].sold_price_cents = 1.5; },
    (result: ReturnType<typeof marketResult>) => { result.selected_candidate_ids[0] = result.selected_candidate_ids[1]; },
    (result: ReturnType<typeof marketResult>) => { result.selected_candidate_ids[0] = 'ebay:999999999999'; },
  ];
  for (const mutate of mutations) {
    const result = marketResult(5); mutate(result);
    assert.equal(getStaffInventoryMarketCalculation(result), null);
    const summary = summarizeStaffInventoryResearchMarketValue(marketJob(result));
    assert.equal(summary.status, 'unknown'); assert.equal(summary.value_cents, null); assert.equal(summary.comp_count, 0);
  }
});

test('legacy A,A,B selected listing images require review without silently reweighting stored arithmetic', () => {
  const result = marketResult();
  result.candidates[1].image!.sha256 = result.candidates[0].image!.sha256;
  result.selected_candidate_ids = result.candidates.map(candidate => candidate.id); result.rejections = [];
  result.estimate = { ...result.estimate, value_cents: 3968, low_cents: 1001, high_cents: 9900, count: 3 };
  const before = JSON.stringify(result);
  StaffInventoryResearchResultSchema.parse(result); // Historical parser stays frozen.
  assert.equal(getStaffInventoryMarketCalculation(result), null);
  const summary = summarizeStaffInventoryResearchMarketValue(marketJob(result));
  assert.equal(summary.status, 'unknown'); assert.match(summary.reason, /review/); assert.equal(summary.value_cents, null);
  assert.equal(JSON.stringify(result), before);
});

test('calculation remains exact at the maximum source-cent bounds', () => {
  const result = marketResult();
  for (const candidate of result.candidates.slice(0, 2)) { candidate.sold_price = '21474836.47'; candidate.sold_price_cents = 2147483647; }
  result.estimate = { ...result.estimate, value_cents: 2147483647, low_cents: 2147483647, high_cents: 2147483647 };
  assert.equal(getStaffInventoryMarketCalculation(result)?.total_cents, 4294967294);
  assert.equal(summarizeStaffInventoryResearchMarketValue(marketJob(result)).value_cents, 2147483647);
});

test('summary parser rejects extra evidence, duplicate units, impossible states and over-limit responses', () => {
  const summary = summarizeStaffInventoryResearchMarketValue(marketJob());
  for (const changed of [{ value_cents: null }, { value_cents: 0 }, { comp_count: 1 }, { comp_count: 25 }, { low_cents: 1003 }, { researched_at: null }, { status: 'unknown' }, { candidates: [] }]) {
    assert.equal(StaffInventoryMarketValueSummarySchema.safeParse({ ...summary, ...changed }).success, false);
  }
  assert.equal(StaffInventoryMarketValueResponseSchema.safeParse({ version: 1, summaries: [] }).success, true);
  assert.equal(StaffInventoryMarketValueResponseSchema.safeParse({ version: 1, summaries: [summary, summary] }).success, false);
  assert.equal(StaffInventoryMarketValueResponseSchema.safeParse({ version: 1, summaries: [], image_previews: {} }).success, false);
  assert.equal(StaffInventoryMarketValueResponseSchema.safeParse({ version: 1, summaries: Array.from({ length: 51 }, (_, i) => ({ ...summary, unit_id: `fixture-${i}` })) }).success, false);
});

test('saved staff exclusion and confirmation use one reviewed calculation without changing original research', () => {
  const result = marketResult(5), job = marketJob(result), review = marketReview(job);
  const before = JSON.stringify(result);
  const reviewedJob = { ...job, result_hash: review.result_hash, review };
  assert.deepEqual(summarizeStaffInventoryResearchMarketValue(reviewedJob), summarizeStaffInventoryResearchMarketValue(job), 'Revision zero preserves the baseline summary.');
  assert.deepEqual(getStaffInventoryMarketCalculation(result, review, review.result_hash), getStaffInventoryMarketCalculation(result));
  review.revision = 1; review.updated_at = MARKET_TIME;
  review.decisions = [{ candidate_id: result.selected_candidate_ids[0], decision: 'excluded', actor_id: 'fixture-admin', reviewed_at: MARKET_TIME,
    revision: 1, request_id: '22222222-2222-4222-8222-222222222222' }];
  const excluded = summarizeStaffInventoryResearchMarketValue(reviewedJob);
  assert.equal(excluded.status, 'unknown'); assert.equal(excluded.value_cents, null); assert.equal(excluded.comp_count, 0);
  assert.match(excluded.reason, /Fewer than two/); assert.equal(getStaffInventoryMarketCalculation(result, review, review.result_hash), null);
  review.revision = 2; review.decisions[0] = { ...review.decisions[0], decision: 'confirmed', revision: 2, request_id: '33333333-3333-4333-8333-333333333333' };
  const restored = summarizeStaffInventoryResearchMarketValue(reviewedJob), calculation = getStaffInventoryMarketCalculation(result, review, review.result_hash)!;
  assert.equal(restored.value_cents, 1002); assert.equal(restored.comp_count, 2); assert.equal(calculation.value_cents, restored.value_cents);
  assert.deepEqual(calculation.selected_candidates.map(candidate => candidate.id), result.selected_candidate_ids);
  assert.equal(JSON.stringify(result), before);
});

test('reviewed summary rejects job/input/result mismatches and cannot promote a possible or rejected listing', () => {
  const job = marketJob(marketResult(5)), baseline = marketReview(job);
  for (const patch of [{ job_id: '22222222-2222-4222-8222-222222222222' }, { unit_id: 'different-card' },
    { description_event_id: 'old-description' }, { input_hash: '0'.repeat(64) }, { result_hash: '0'.repeat(64) },
    { revision: 1, updated_at: MARKET_TIME, decisions: [{ candidate_id: job.result!.candidates[2].id, decision: 'confirmed', actor_id: 'fixture-admin',
      reviewed_at: MARKET_TIME, revision: 1, request_id: '22222222-2222-4222-8222-222222222222' }] }]) {
    const summary = summarizeStaffInventoryResearchMarketValue({ ...job, result_hash: baseline.result_hash, review: { ...baseline, ...patch } });
    assert.equal(summary.status, 'unknown'); assert.equal(summary.value_cents, null); assert.equal(summary.comp_count, 0);
  }
  assert.equal(getStaffInventoryMarketCalculation(job.result, baseline), null, 'A review cannot be projected without its server-verified result hash.');
  assert.equal(getStaffInventoryMarketCalculation(job.result, baseline, '0'.repeat(64)), null);
});

test('historical duplicate weighting is unchanged without review and deterministically projected after explicit review', () => {
  const result = marketResult();
  result.candidates[1].image!.sha256 = result.candidates[0].image!.sha256;
  result.selected_candidate_ids = result.candidates.map(candidate => candidate.id).reverse(); result.rejections = [];
  result.estimate = { ...result.estimate, value_cents: 3968, low_cents: 1001, high_cents: 9900, count: 3 };
  const job = marketJob(result), review = marketReview(job), original = JSON.stringify(result);
  const reviewedJob = { ...job, result_hash: review.result_hash, review };
  assert.deepEqual(summarizeStaffInventoryResearchMarketValue(reviewedJob), summarizeStaffInventoryResearchMarketValue(job));
  assert.equal(getStaffInventoryMarketCalculation(result, review, review.result_hash), null);
  review.revision = 1; review.updated_at = MARKET_TIME;
  review.decisions = [{ candidate_id: result.candidates[2].id, decision: 'confirmed', actor_id: 'fixture-admin', reviewed_at: MARKET_TIME,
    revision: 1, request_id: '22222222-2222-4222-8222-222222222222' }];
  const calculation = getStaffInventoryMarketCalculation(result, review, review.result_hash)!;
  assert.deepEqual(calculation.selected_candidates.map(candidate => candidate.id).sort(), [result.candidates[0].id, result.candidates[2].id]);
  assert.equal(calculation.value_cents, 5451); assert.equal(calculation.count, 2);
  assert.equal(summarizeStaffInventoryResearchMarketValue(reviewedJob).value_cents, calculation.value_cents);
  assert.equal(JSON.stringify(result), original);
});
