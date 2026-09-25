import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createWorkLimiter } from '../src/index.mjs';

test('bounded native FIFO holds work before allocation, refills independently and releases a failed slot', async () => {
  const limit = createWorkLimiter(2, { maxQueue: 2 }), release = [], entered = [];
  let active = 0, peak = 0;
  const jobs = Array.from({ length: 4 }, (_, index) => limit(async () => {
    entered.push(index); peak = Math.max(peak, ++active);
    try { await new Promise(resolve => { release[index] = resolve; }); if (index === 0) throw Error('native failure'); }
    finally { active--; }
    return index;
  }).then(value => ({ value }), error => ({ error: error.message })));
  assert.deepEqual(entered, [0, 1]);
  await assert.rejects(limit(() => assert.fail('queue overflow executed')), { code: 'MANUAL_PROCESSING_BUSY' });
  release[1](); await nextTurn(); assert.deepEqual(entered, [0, 1, 2]);
  release[0](); await nextTurn(); assert.deepEqual(entered, [0, 1, 2, 3]);
  release[2](); release[3](); const results = await Promise.all(jobs);
  assert.equal(peak, 2); assert.equal(active, 0); assert.equal(results[0].error, 'native failure');
  assert.equal(await limit(async () => 42), 42);
});
