import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { StaffInventoryResearchReviewCommandSchema, StaffInventoryResearchReviewSnapshotSchema, StaffInventoryResearchResultSchema, projectStaffInventoryResearchReview,
  type StaffInventoryResearchReviewSnapshot } from '@tenkings/shared';
import { inventoryHash } from '../../../packages/database/src/cardInventoryV2';
import { marketResult, MARKET_TIME } from './fixtures/staffInventoryMarketValue';

const base = (result = marketResult()): StaffInventoryResearchReviewSnapshot => ({ schema_version: 1, job_id: '11111111-1111-4111-8111-111111111111',
  unit_id: result.unit_id, description_event_id: result.description_event_id, input_hash: 'a'.repeat(64), result_hash: inventoryHash(result), revision: 0, decisions: [], updated_at: null });
const decision = (candidate_id: string, value: 'confirmed' | 'excluded', revision = 1) => ({ candidate_id, decision: value, actor_id: 'fixture-staff', reviewed_at: MARKET_TIME, revision, request_id: randomUUID() });

test('review command accepts only exact candidate decisions and rejects client supplied actors or values', () => {
  const result = marketResult(), snapshot = base(result);
  const command = { requestId: randomUUID(), jobId: snapshot.job_id, unitId: snapshot.unit_id, descriptionEventId: snapshot.description_event_id,
    inputHash: snapshot.input_hash, resultHash: snapshot.result_hash, expectedRevision: 0, candidateId: result.selected_candidate_ids[0], decision: 'excluded' };
  assert.ok(StaffInventoryResearchReviewCommandSchema.safeParse(command).success);
  for (const changed of [{ actor: 'forged' }, { value_cents: 999 }, { decision: 'selected' }, { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { requestId: 'invalid' }, { resultHash: 'invalid' }]) assert.equal(StaffInventoryResearchReviewCommandSchema.safeParse({ ...command, ...changed }).success, false);
});
test('snapshot validates latest decision head, unique candidate/request/revision and timestamps', () => {
  const result = marketResult(), current = { ...base(result), revision: 1, updated_at: MARKET_TIME, decisions: [decision(result.selected_candidate_ids[0], 'confirmed')] };
  assert.ok(StaffInventoryResearchReviewSnapshotSchema.safeParse(current).success);
  for (const changed of [{ revision: 0 }, { revision: 2 }, { updated_at: null }, { decisions: [] }, { decisions: [...current.decisions, current.decisions[0]] }]) assert.equal(StaffInventoryResearchReviewSnapshotSchema.safeParse({ ...current, ...changed }).success, false);
});
test('projection preserves exact legacy and modern baseline math and fails closed on corrupted evidence or result bindings', () => {
  for (const version of [1, 2, 3, 5] as const) {
    const result = marketResult(version), snapshot = base(result), before = JSON.stringify(result);
    const projected = projectStaffInventoryResearchReview(result, snapshot, snapshot.result_hash)!;
    assert.equal(projected.value_cents, 1002); assert.equal(projected.total_cents, 2003); assert.equal(projected.count, 2);
    assert.equal(projectStaffInventoryResearchReview({ ...result, estimate: { ...result.estimate, value_cents: 1001 } }, snapshot, snapshot.result_hash), null);
    for (const change of [{ unit_id: 'wrong-unit' }, { description_event_id: 'old-event' }, { result_hash: '0'.repeat(64) }]) assert.equal(projectStaffInventoryResearchReview(result, { ...snapshot, ...change }, snapshot.result_hash), null);
    assert.equal(JSON.stringify(result), before);
  }
});
test('exclude and confirm derive values without mutating original evidence; incomplete review is not full confirmation', () => {
  const result = marketResult(), snapshot = { ...base(result), revision: 1, updated_at: MARKET_TIME, decisions: [decision(result.selected_candidate_ids[0], 'excluded')] };
  const before = JSON.stringify(result), excluded = projectStaffInventoryResearchReview(result, snapshot, snapshot.result_hash)!;
  assert.equal(excluded.count, 1); assert.equal(excluded.value_cents, null); assert.equal(excluded.status, 'unknown'); assert.deepEqual(excluded.selected_candidate_ids, [result.selected_candidate_ids[1]]);
  const restored = { ...snapshot, revision: 2, decisions: [decision(result.selected_candidate_ids[0], 'confirmed', 2)] };
  const projection = projectStaffInventoryResearchReview(result, restored, snapshot.result_hash)!;
  assert.equal(projection.value_cents, 1002); assert.equal(projection.count, 2); assert.equal(restored.decisions.length, 1);
  assert.equal(JSON.stringify(result), before);
  assert.equal(projectStaffInventoryResearchReview(result, { ...snapshot, decisions: [decision(result.candidates[2].id, 'confirmed')] }, snapshot.result_hash), null);
});
test('reviewed duplicate images count once by lowest candidate ID independent of model order and staff exclusions', () => {
  const result = marketResult(); result.candidates[1].image!.sha256 = result.candidates[0].image!.sha256;
  result.selected_candidate_ids = result.candidates.map(candidate => candidate.id).reverse(); result.rejections = [];
  result.estimate = { ...result.estimate, value_cents: 3968, high_cents: 9900, count: 3 };
  StaffInventoryResearchResultSchema.parse(result);
  const snapshot = base(result), before = JSON.stringify(result);
  assert.equal(projectStaffInventoryResearchReview(result, snapshot, snapshot.result_hash)!.status, 'unknown');
  const reviewed = { ...snapshot, revision: 1, updated_at: MARKET_TIME, decisions: [decision(result.candidates[1].id, 'confirmed')] };
  const projected = projectStaffInventoryResearchReview(result, reviewed, snapshot.result_hash)!;
  assert.equal(projected.value_cents, 5451); assert.equal(projected.count, 2);
  assert.deepEqual(projected.selected_candidate_ids, [result.candidates[2].id, result.candidates[0].id]);
  assert.deepEqual(projected.duplicate_candidate_ids, [result.candidates[1].id]); assert.deepEqual(projected.excluded_candidate_ids, []);
  assert.equal(JSON.stringify(result), before);
});
