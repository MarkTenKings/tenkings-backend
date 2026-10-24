import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLabelRepository } from '../src/label-sheet-repository.mjs';
import { createLabelService } from '../src/label-sheet-service.mjs';
import { createLabelWorker } from '../src/label-worker.mjs';

function heldFixture(blockedKey) {
  const calls = [], principal = { id: randomUUID(), role: 'REVIEWER', accessVersion: 1 };
  const tx = {
    async $queryRawUnsafe(sql, ...args) {
      calls.push({ sql, args });
      assert.equal(sql, 'SELECT pg_try_advisory_xact_lock(721930,$1::integer) AS locked', 'Held admission must stop before any source read or mutation');
      return [{ locked: args[0] !== blockedKey }];
    },
    $executeRawUnsafe() { assert.fail('Held admission cannot mutate or take an actor lock'); },
  };
  const transaction = async (_staff, work) => work({ tx, principal });
  const boundary = { transaction, machineTransaction: transaction, machineOwner: () => principal };
  return { calls, boundary, repository: createLabelRepository({ boundary }) };
}

for (const blockedKey of [76, 77]) test(`release lock ${blockedKey} suppresses discovery and all automatic reservation entries`, async () => {
  const f = heldFixture(blockedKey), id = randomUUID();
  assert.deepEqual(await f.repository.pendingCandidates(), []);
  assert.equal(await f.repository.claimItem({}, id), null);
  assert.equal(await f.repository.claimExport({}, id), null);
  await assert.rejects(f.repository.retryLayout({}, id, {}, {}, { automatic: true }), { code: 'LABEL_RELEASE_HELD' });
  assert.deepEqual(f.calls.map(call => call.args[0]), Array(4).fill(blockedKey === 76 ? [76] : [76, 77]).flat());
});

test('worker startup and stale item/export discoveries cannot dispatch providers or storage under a hold', async () => {
  const f = heldFixture(76), forbidden = () => assert.fail('Held worker cannot dispatch external work');
  const options = { boundary: f.boundary, finishing: { loadPacket: forbidden }, storage: { write: forbidden, download: forbidden }, styler: { resolve: forbidden } };
  const worker = createLabelWorker({ service: createLabelService({ ...options, repository: f.repository }) });
  worker.start(); await worker.wake(); await worker.stop();
  for (const kind of ['ITEM', 'EXPORT']) {
    const service = createLabelService({ ...options, repository: { ...f.repository,
      pendingCandidates: async () => [{ id: randomUUID(), actor_id: randomUUID(), access_version: 1, kind }] } });
    assert.equal(await service.runPending(), 0);
  }
});
