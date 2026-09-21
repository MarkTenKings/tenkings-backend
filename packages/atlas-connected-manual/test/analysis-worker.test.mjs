import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createAnalysisWorker } from '../scripts/analysis-worker.mjs';

const page = (ids, nextCursor = null) => ({ items: ids.map(analysisId => ({ run: { analysisId }, acceptance: {} })), nextCursor });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('worker starts with a durable scan, serializes GET reconciliation, and pages fairly without dispatch capability', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = randomUUID(), second = randomUUID(), cursor = { recordedAt: '2026-09-21T00:00:00.000Z', analysisId: first };
  const gate = deferred(), scans = [], reads = [], events = [];
  const reconciler = {
    async pending(input) { scans.push(input); return scans.length === 1 ? page([first], cursor) : page([second]); },
    async reconcile(input) { reads.push(input); if (input.analysisId === first) await gate.promise; return { state: 'SETTLED', analysisId: input.analysisId }; },
    get dispatch() { assert.fail('worker must not inspect provider dispatch'); },
  };
  const worker = createAnalysisWorker({ reconciler, onEvent: event => events.push(event) });
  try {
    assert.equal(scans.length, 0); assert.equal(worker.start(), true); assert.equal(worker.start(), false); await nextTurn();
    assert.deepEqual(scans, [{ limit: 5, cursor: null }]); assert.equal(reads.length, 1);
    assert.deepEqual(Object.keys(reads[0]).sort(), ['analysisId', 'signal']); assert.ok(reads[0].signal instanceof AbortSignal);
    t.mock.timers.tick(50000); await nextTurn(); assert.equal(scans.length, 1); assert.equal(reads.length, 1);
    gate.resolve(); await nextTurn(); t.mock.timers.tick(5000); await nextTurn();
    assert.deepEqual(scans[1], { limit: 5, cursor }); assert.deepEqual(reads.map(r => r.analysisId), [first, second]);
    assert.ok(events.every(e => e.event === 'MANUAL_DEFECT_BACKGROUND_RECONCILED' && e.state === 'SETTLED'));
    await worker.stop(); t.mock.timers.tick(50000); await nextTurn(); assert.equal(scans.length, 2);
  } finally { gate.resolve(); await worker.stop(); t.mock.timers.reset(); }
});

test('a new process worker recovers the same accepted ID without a browser principal or automatic POST', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const id = randomUUID(), calls = [], scans = [];
  const reconciler = { async pending(input) { scans.push(input); return page([id]); },
    async reconcile(input) { calls.push(input); return { state: calls.length === 1 ? 'PENDING' : 'SETTLED', analysisId: id }; } };
  const first = createAnalysisWorker({ reconciler }), restarted = createAnalysisWorker({ reconciler });
  try {
    first.start(); await nextTurn(); await first.stop();
    restarted.start(); await nextTurn(); await restarted.stop();
    assert.equal(scans.length, 2); assert.ok(scans.every(x => x.cursor === null));
    assert.deepEqual(calls.map(x => x.analysisId), [id, id]); assert.notEqual(calls[0].signal, calls[1].signal);
    assert.ok(calls.every(x => !Object.hasOwn(x, 'staff') && !Object.hasOwn(x, 'prepared') && !Object.hasOwn(x, 'requestHash')));
  } finally { await first.stop(); await restarted.stop(); t.mock.timers.reset(); }
});

test('transient scan and per-ID retrieval failures keep polling and never log raw exception text', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ids = [randomUUID(), randomUUID()], events = [], called = []; let scans = 0;
  const worker = createAnalysisWorker({ onEvent: value => events.push(value), reconciler: {
    async pending() { if (++scans === 1) throw Error('sk-synthetic-private-value'); return page(ids); },
    async reconcile({ analysisId }) { called.push(analysisId); if (analysisId === ids[0]) throw Object.assign(Error('raw private transport details'), { code: 'DEFECT_ANALYSIS_PROVIDER_BINDING_CHANGED' }); return { state: 'SETTLED' }; },
  } });
  try {
    worker.start(); await nextTurn(); t.mock.timers.tick(5000); await nextTurn();
    assert.deepEqual(called, ids); assert.equal(events.length, 3);
    assert.equal(events[0].event, 'MANUAL_DEFECT_BACKGROUND_SCAN_PENDING');
    assert.equal(events[1].code, 'DEFECT_ANALYSIS_PROVIDER_BINDING_CHANGED');
    assert.doesNotMatch(JSON.stringify(events), /sk-synthetic|raw private|transport details/);
  } finally { await worker.stop(); t.mock.timers.reset(); }
});

test('shutdown aborts only the current GET and prevents later IDs or scheduled scans', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ids = [randomUUID(), randomUUID()], calls = [], events = []; let scans = 0;
  const worker = createAnalysisWorker({ onEvent: value => events.push(value), reconciler: {
    async pending() { scans++; return page(ids); },
    reconcile({ analysisId, signal }) { calls.push(analysisId); return new Promise(resolve => signal.addEventListener('abort', () => resolve({ state: 'UNKNOWN' }), { once: true })); },
  } });
  try {
    worker.start(); await nextTurn(); await worker.stop(); t.mock.timers.tick(60000); await nextTurn();
    assert.deepEqual(calls, [ids[0]]); assert.equal(scans, 1); assert.deepEqual(events, []);
  } finally { await worker.stop(); t.mock.timers.reset(); }
});

test('invalid and duplicate accepted IDs cannot reach provider reconciliation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const id = randomUUID(); let reads = 0;
  for (const ids of [['not-an-analysis'], [id, id]]) {
    const worker = createAnalysisWorker({ reconciler: { async pending() { return page(ids); }, async reconcile() { reads++; } } });
    worker.start(); await nextTurn(); await worker.stop();
  }
  t.mock.timers.reset(); assert.equal(reads, 0);
  assert.throws(() => createAnalysisWorker({ reconciler: {}, batchSize: 11 }), /CONFIGURATION_INVALID/);
});
