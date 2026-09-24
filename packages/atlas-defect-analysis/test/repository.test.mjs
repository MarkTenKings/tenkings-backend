import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisRepository } from '../src/repository.mjs';
import { canonical, digest } from '../src/contract.mjs';
import { inputFixture, artifactRef, hash, id } from './fixtures.mjs';

for (const [state, expected] of [['PREPARED', 'PREPARED'], ['DISPATCHED', 'UNKNOWN']]) {
  test(`expired ${state} projects ${expected} so only never-dispatched work remains resumable for exact retirement`, async () => {
    const binding = canonical(inputFixture().binding), evidence = canonical({ version: 1 });
    const row = { id: id(1), card_id: id(2), action_id: id(1), actor_id: id(3), binding, binding_hash: digest(binding),
      base_hash: hash('base'), request_hash: hash('request'), request_ref: JSON.stringify(artifactRef(id(2), 'DEFECT_REQUEST', hash('source'))),
      request_evidence: evidence, evidence_hash: digest(evidence), state, created_at: new Date(Date.now() - 10000),
      expires_at: new Date(Date.now() - 1000), dispatched_at: state === 'DISPATCHED' ? new Date(Date.now() - 9000) : null };
    const tx = { async $queryRawUnsafe(sql) {
      if (sql.includes('FROM atlas_defect_analysis.run')) return [row];
      if (sql.includes('FROM atlas_defect_analysis.request_refusal') || sql.includes('FROM atlas_defect_analysis.receipt')) return [];
      throw new Error('unexpected status mutation/query');
    } };
    const repository = createAnalysisRepository({ boundary: { transaction: (_staff, work) => work({ tx }) }, authorize: async () => {},
      assertCurrent: async () => {}, receiptClient: { $queryRawUnsafe: async () => { throw new Error('status cannot record a receipt'); } } });
    const result = await repository.status({}, { cardId: row.card_id, analysisId: row.id });
    assert.equal(result.state, expected); assert.equal(result.dispatchedAt === null, state === 'PREPARED'); assert.deepEqual(result.receipts, []);
  });
}
