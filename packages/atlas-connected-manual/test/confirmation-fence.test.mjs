import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfirmationCommit } from '../src/confirmation-fence.mjs';

const cardId = '10000000-0000-4000-8000-000000000001';
const old = { analysisId: '10000000-0000-4000-8000-000000000002', requestHash: 'a'.repeat(64), responseHash: null, responseState: null, acceptanceHash: null };
const guard = () => ({ version: 'atlas-manual-confirmation-fence-v1', analysis: old, deadlineAt: Date.now() + 1000 });

test('confirmation fence locks the run before a separate fresh receipt read and refuses a receipt that arrived while waiting', async () => {
  const queries = [];
  const tx = { async $queryRawUnsafe(sql, id) {
    assert.equal(id, cardId); queries.push(sql);
    if (sql.includes('FOR UPDATE OF r')) return [{ id: old.analysisId }];
    assert.equal(queries.length, 2);
    return [{ id: old.analysisId, request_hash: old.requestHash, response_evidence: JSON.stringify({ state: 'READY', responseHash: 'b'.repeat(64) }) }];
  } };
  await assert.rejects(validateConfirmationCommit({ tx, cardId, input: { action: { type: 'CONFIRM_FINDINGS' } }, commitGuard: guard() }), { code: 'MANUAL_ASTRA_REVIEW_STALE' });
  assert.equal(queries.length, 2); assert(queries[0].includes('FOR UPDATE OF r')); assert(!queries[1].includes('FOR UPDATE'));
});

test('report approval uses the same fence; expired or absent guards cannot reach metadata writes', async () => {
  const tx = { async $queryRawUnsafe() { assert.fail('Invalid guard cannot query'); } };
  for (const type of ['CONFIRM_FINDINGS', 'APPROVE_REPORT']) {
    await assert.rejects(validateConfirmationCommit({ tx, cardId, input: { action: { type } } }), { code: 'MANUAL_ASTRA_REVIEW_REQUIRED' });
    await assert.rejects(validateConfirmationCommit({ tx, cardId, input: { action: { type } }, commitGuard: { ...guard(), deadlineAt: Date.now() - 1 } }), { code: 'MANUAL_CONFIRM_DEADLINE' });
  }
  await validateConfirmationCommit({ tx, cardId, input: { action: { type: 'INSPECT_SIDE' } } });
});
