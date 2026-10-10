import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createVariantWorkers } from '../scripts/variant-workers.mjs';
import { createVariantWorker } from '../src/variant-worker.mjs';

test('variant runtime collects accepted work while new-work admission is blocked, and shutdown aborts collection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout','setInterval'] });
  const id = randomUUID(), calls = [];let stopped = false, scans = 0;
  const worker = createVariantWorker({ store: { discover: async () => {}, claim: async () => assert.fail('blocked admission cannot claim') },
    catalog: {}, loadPhotos: async () => assert.fail('no photos'),provider: async () => assert.fail('no POST'),projectResponse: () => {},admitDispatch: async () => false });
  const workers = createVariantWorkers({ worker, onEvent: () => {}, reconciler: {
    async pending() { scans++;return { items:[{run:{analysisId:id}}],nextCursor:null }; },
    reconcile({analysisId,signal}) { calls.push(analysisId);return new Promise(resolve => signal.addEventListener('abort', () => { stopped=true;resolve({state:'PENDING'}); }, {once:true})); },
  }});
  try {
    assert.equal(scans,0);workers.start();await nextTurn();assert.deepEqual(calls,[id]);
    t.mock.timers.tick(20000);await nextTurn();assert.equal(scans,1);
    await workers.stop();assert.equal(stopped,true);t.mock.timers.tick(20000);await nextTurn();assert.equal(scans,1);
  } finally { await workers.stop();t.mock.timers.reset(); }
});
