import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfirmationFence } from '../src/confirmation-fence.mjs';

test('analysis projection reads the retained response without locking a human approval', async () => {
  const queries = [];
  const tx = { async $queryRawUnsafe(sql, cardId) {
    queries.push(sql); assert.equal(cardId, 'card-fixture');
    return [{ id: 'analysis-fixture', request_hash: 'a'.repeat(64), acceptance_hash: null,
      response_evidence: JSON.stringify({ state: 'READY', responseHash: 'b'.repeat(64) }) }];
  } };
  assert.deepEqual(await readConfirmationFence(tx, 'card-fixture'), {
    analysisId: 'analysis-fixture', requestHash: 'a'.repeat(64), responseHash: 'b'.repeat(64), responseState: 'READY', acceptanceHash: null,
  });
  assert.equal(queries.length, 1); assert.equal(queries[0].includes('FOR UPDATE'), false);
});
