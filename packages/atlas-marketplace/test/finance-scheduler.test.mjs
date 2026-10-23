import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalStore } from '../src/store.mjs';
import { createFinanceScheduler } from '../src/finance-scheduler.mjs';
import { NOW, deferred } from './host-finance-fixtures.mjs';
const config = { intervalMs: 1000, pollIntervalMs: 100, leaseMs: 2000 };
function setup(t, run) {
  let now = NOW, ready = true; const queued = new Map(); let sequence = 0;
  const timers = { setTimeout(fn) { const id = ++sequence; queued.set(id, fn); return id; }, clearTimeout(id) { queued.delete(id); } };
  const store = openLocalStore({ filename: ':memory:', environment: 'SYNTHETIC_LOCAL', clock: () => now }); t.after(() => store.close());
  const make = () => createFinanceScheduler({ enabled: true, store, scope: 'fixture_scope', configHash: 'fixture_hash', config, run, assertRuntimeReady: () => ready, timers });
  return { store, make, queued, advance: ms => { now += ms; }, revoke: () => { ready = false; } };
}
test('only explicit start registers a timer; duplicate processes and restart share a durable due slot', async t => {
  let calls = 0; const f = setup(t, async ({ runId }) => { calls++; return { runId, status: 'COMPLETED' }; }), one = f.make();
  assert.equal(f.queued.size, 0); assert.equal(f.store.read().financeSchedules, undefined);
  one.start(); one.start(); assert.equal(f.queued.size, 1);
  await Promise.all([one.tick(), f.make().tick()]); assert.equal(calls, 1);
  assert.equal((await f.make().tick()).status, 'NOT_DUE');
  f.advance(100000); await f.make().tick(); assert.equal(calls, 2); // no catch-up storm
  await one.stop(); assert.equal(f.queued.size, 0);
  f.revoke(); assert.throws(() => one.start(), { code: 'HOST_FINANCE_UNQUALIFIED' });
});
test('stop aborts then joins admitted work; an expired lease fences an older worker completion', async t => {
  const entered = deferred(), gate = deferred(); let seenSignal, calls = 0;
  const f = setup(t, async ({ runId, signal }) => { if (++calls === 1) { seenSignal = signal; entered.resolve(); await gate.promise; } return { runId, status: signal.aborted ? 'INTERRUPTED' : 'COMPLETED' }; });
  const old = f.make(), pending = old.tick(); await entered.promise;
  let stopped = false; const stop = old.stop().then(() => { stopped = true; });
  assert.equal(seenSignal.aborted, true); assert.equal(stopped, false);
  f.advance(2001); const fresh = await f.make().tick(); assert.equal(fresh.status, 'COMPLETED');
  gate.resolve(); const previous = await pending; await stop;
  assert.equal(previous.status, 'INTERRUPTED'); assert.equal(previous.code, 'FINANCE_SCHEDULE_LEASE_EXPIRED');
  assert.equal(f.store.read().financeSchedules.fixture_scope.lastRunId, fresh.runId);
  assert.equal(stopped, true);
});
