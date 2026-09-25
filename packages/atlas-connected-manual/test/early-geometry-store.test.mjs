import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createEarlyGeometryStore } from '../src/early-geometry-store.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('ordinary ensure releases intake while a geometry worker owns the job and waits for intake', async () => {
  const workerGeometry = deferred(), intakeLocked = deferred(), intakeReleased = deferred();
  const input = { cardId: 'card', uploadId: 'upload', side: 'FRONT', photoSource: { fixture: 'immutable source' }, engine: { fixture: 'runtime' } };
  const row = { key: digest(canonical(input)), input: canonical(input), card_id: input.cardId, upload_id: input.uploadId,
    side: 'FRONT', engine_hash: digest(canonical(input.engine)), access_version: 1, actor_id: 'owner', state: 'RUNNING', attempts: 1,
    claim_id: 'worker-claim', result: null, error: null };
  let mutationLocks = 0, workerFinished = false;
  const tx = {
    async $executeRawUnsafe(sql) { assert.match(sql, /^INSERT INTO atlas_manual_connected\.early_geometry_intent/); return 0; },
    async $queryRawUnsafe(sql) {
      assert.match(sql, /^SELECT \* FROM atlas_manual_connected\.early_geometry WHERE key=/);
      if (sql.endsWith('FOR UPDATE')) { mutationLocks++; await workerGeometry.promise; }
      return [structuredClone(row)];
    },
  };
  const store = createEarlyGeometryStore({ boundary: { async transaction(_staff, work) {
    try { return await work({ tx, principal: { id: 'owner', accessVersion: 1 } }); }
    finally { intakeReleased.resolve(); }
  } }, intakeRepository: { async authorizeInTransaction(_tx, _principal, _cardId, { lock }) {
    assert.equal(lock, 'UPDATE'); intakeLocked.resolve();
    return { sides: { FRONT: { upload: { uploadId: 'upload', source: input.photoSource } } } };
  } } });
  // Model the actual SQL lock order: claim/finish owns geometry then requests
  // intake SHARE; ensure owns intake UPDATE. A geometry UPDATE here deadlocks.
  const worker = (async () => { await intakeLocked.promise; await intakeReleased.promise; workerFinished = true; workerGeometry.resolve(); })();
  let timer;
  try {
    const result = await Promise.race([store.ensure({}, input), new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Error('geometry/intake lock inversion')), 1000);
    })]);
    await worker;
    assert.equal(result.state, 'RUNNING'); assert.equal(result.claimId, 'worker-claim');
    assert.equal(mutationLocks, 0); assert.equal(workerFinished, true);
  } finally { clearTimeout(timer); intakeReleased.resolve(); workerGeometry.resolve(); await worker; }
});

test('explicit geometry retry still locks and validates the current terminal state before changing it', async () => {
  const input = { cardId: 'card', uploadId: 'upload', side: 'FRONT', photoSource: {}, engine: {} };
  const row = { key: digest(canonical(input)), input: canonical(input), card_id: 'card', upload_id: 'upload',
    side: 'FRONT', engine_hash: digest(canonical(input.engine)), access_version: 1, actor_id: 'owner',
    state: 'NEEDS_REVIEW', attempts: 1, result: '{}', error: null };
  let locks = 0, mutations = 0;
  const tx = {
    async $executeRawUnsafe(sql) { if (sql.startsWith('UPDATE ')) mutations++; return 1; },
    async $queryRawUnsafe(sql) {
      if (sql.endsWith('FOR UPDATE')) { locks++; return [{ ...row, state: 'RUNNING' }]; }
      return [structuredClone(row)];
    },
  };
  const store = createEarlyGeometryStore({ boundary: { transaction: (_staff, work) => work({ tx, principal: { id: 'owner', accessVersion: 1 } }) },
    intakeRepository: { authorizeInTransaction: async () => ({ sides: { FRONT: { upload: { uploadId: 'upload', source: {} } } } }) } });
  await assert.rejects(store.ensure({}, input, { retry: true }), { code: 'GEOMETRY_RETRY_STALE' });
  assert.equal(locks, 1); assert.equal(mutations, 0);
});
