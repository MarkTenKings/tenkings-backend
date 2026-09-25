import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEarlyGeometry } from '../src/early-geometry.mjs';
import { createEarlyGeometryStore, earlyGeometryGrantSQL } from '../src/early-geometry-store.mjs';
import { createWorkLimiter } from '../src/index.mjs';
import { geometryProcessingSettings, geometryProcessingEnvironment } from '../src/geometry-processing.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const until = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await pause(5); } assert.fail('Geometry worker did not reach the bounded barrier'); };

test('geometry settings are explicit, bounded and conservative by default', () => {
  assert.deepEqual(geometryProcessingSettings(), { geometryConcurrency: 2, geometryDiscoveryPageSize: 2 });
  assert.deepEqual(geometryProcessingEnvironment({}), geometryProcessingSettings());
  assert.deepEqual(geometryProcessingEnvironment({ ATLAS_MANUAL_GEOMETRY_CONCURRENCY: '12', ATLAS_MANUAL_GEOMETRY_DISCOVERY_PAGE_SIZE: '32' }),
    { geometryConcurrency: 12, geometryDiscoveryPageSize: 32 });
  assert(Object.isFrozen(geometryProcessingSettings()));
  for (const [key, values] of [['geometryConcurrency', [0, -1, 13, 1.5, '2', null, NaN, Infinity]],
    ['geometryDiscoveryPageSize', [0, -1, 33, 1.5, '2', null, NaN, Infinity]]]) {
    for (const value of values) assert.throws(() => geometryProcessingSettings({ [key]: value }), { code: 'GEOMETRY_PROCESSING_CONFIG_INVALID' });
  }
});

test('constructing or stopping a geometry worker is cold even with persisted discovery work', async () => {
  const touched = [];
  const fail = name => () => { touched.push(name); throw Error(`Unexpected ${name}`); };
  const worker = createEarlyGeometry({ geometryConcurrency: 12, geometryDiscoveryPageSize: 32,
    store: { pending: fail('database'), claim: fail('claim') }, runtimeIdentity: fail('native'),
    limited: fail('limiter'), artifacts: { read: fail('artifact') } });
  await pause(20); await worker.stop(); assert.equal(worker.start(), false); assert.deepEqual(touched, []);
  assert.throws(() => createEarlyGeometry({ geometryConcurrency: 13 }), { code: 'GEOMETRY_PROCESSING_CONFIG_INVALID' });
});

for (const [capacity, native, expected] of [[12, 12, 12], [12, 3, 3], [2, 12, 2]]) {
  test(`geometry ${capacity} reserves at most ${expected} claims behind native ${native}`, async () => {
    const gate = deferred(), entered = [];
    const worker = createEarlyGeometry({ geometryConcurrency: capacity, geometryDiscoveryPageSize: 8,
      runtimeIdentity: async () => ({ fixture: 'native' }), limits: {}, limited: createWorkLimiter(native, { maxQueue: 32 }), intervalMs: 5,
      store: { async pending(_engine, _cursor, size) { assert.equal(size, 8); return []; },
        async claim(_engine, id, limit) { assert.equal(limit, capacity); entered.push(id); await gate.promise; return null; } } });
    try {
      assert.equal(worker.start(), true); assert.equal(worker.start(), false);
      await until(() => entered.length === expected); await pause(20);
      assert.equal(entered.length, expected); assert.equal(new Set(entered).size, expected);
    } finally { const stopped = worker.stop(); gate.resolve(); await stopped; }
  });
}

test('configured discovery page advances beyond failed sources and rejects overfull pages', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ upload_id: randomUUID(), card_id: randomUUID(),
    created_at: new Date(i), cursor_created_at: new Date(i).toISOString().replace('Z', '123Z'), plan: '{}', verification: '{}', source: '{"ref":{}}' }));
  const cursors = [], errors = []; let reads = 0;
  const worker = createEarlyGeometry({ geometryDiscoveryPageSize: 5, intervalMs: 5,
    runtimeIdentity: async () => ({}), limits: {}, limited: work => work(), onEvent: value => errors.push(value),
    artifacts: { async read() { reads++; throw Error('Unavailable fixture artifact'); } },
    store: { async pending(_engine, cursor, size) { assert.equal(size, 5); cursors.push(cursor);
      return cursors.length === 1 ? rows : cursors.length === 2 ? [...rows, rows[0]] : []; }, async claim() { return null; } } });
  try {
    worker.start(); await until(() => cursors.length >= 3);
    assert.equal(cursors[0], null);
    assert.deepEqual(cursors[1], { createdAt: rows[4].cursor_created_at, uploadId: rows[4].upload_id });
    assert.equal(reads, 5, 'The invalid oversized page must not read or stage any source');
    assert(errors.some(value => value.code === 'GEOMETRY_STORED_CONTENT_INVALID'));
  } finally { await worker.stop(); }
});

test('repository forwards the same bounded limits to SQL and grants only new function execution', async () => {
  const calls = [];
  const store = createEarlyGeometryStore({ receiptClient: { async $transaction(work) {
    return work({ async $executeRawUnsafe() {}, async $queryRawUnsafe(...args) { calls.push(args); return []; } });
  } } });
  const id = randomUUID(), hash = 'a'.repeat(64), cursor = { createdAt: new Date(0).toISOString(), uploadId: randomUUID() };
  await store.claim(hash, id, 12); await store.pending(hash, cursor, 32);
  assert.deepEqual(calls.map(row => row.slice(1)), [[hash, id, 12], [hash, cursor.createdAt, cursor.uploadId, 32]]);
  assert.match(calls[0][0], /claim_early_geometry\(\$1,\$2::uuid,\$3::integer\)/);
  assert.match(calls[1][0], /pending_early_geometry\(\$1,\$2::timestamptz,\$3::uuid,\$4::integer\)/);
  await assert.rejects(store.claim(hash, id, 13), { code: 'GEOMETRY_PROCESSING_CONFIG_INVALID' });
  await assert.rejects(store.pending(hash, null, 33), { code: 'GEOMETRY_PROCESSING_CONFIG_INVALID' });
  assert.equal(calls.length, 2);
  const grants = earlyGeometryGrantSQL('atlas_geometry_fixture');
  assert.match(grants, /claim_early_geometry\(text,uuid,integer\)/);
  assert.match(grants, /pending_early_geometry\(text,timestamptz,uuid,integer\)/);
  assert.doesNotMatch(grants, /geometry_claim_capacity|GRANT ALL/);
});
