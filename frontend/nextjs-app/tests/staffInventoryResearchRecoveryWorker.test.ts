import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import type { StaffInventoryResearchRecoveryClaimV2 } from '@tenkings/database';
import type { StaffInventoryResearchRecoveryAssessment } from '@tenkings/shared';
import { runStaffInventoryResearchRecovery, type InventoryResearchRecoveryWorkerDependencies } from '../lib/server/staffInventoryResearchRecoveryWorker';
import { runStaffInventoryResearchWorker, type StaffInventoryResearchWorkerDependencies } from '../lib/server/staffInventoryResearchWorker';

function harness() {
  const start = Date.parse('2026-09-22T04:00:00.000Z'); let time = start;
  const calls: string[] = [], parent = new AbortController();
  const input = { schema_version: 1 as const, unit_id: 'synthetic:unit', description_event_id: 'synthetic:description', description_hash: 'a'.repeat(64),
    description: { name: 'Synthetic Card', category: 'Sports cards', year: '2025', manufacturer: 'Fixture', set_name: 'Synthetic Product', card_number: '001', variant: null, card_type: null }, front_photo_key: null, back_photo_key: null };
  const assessment: StaffInventoryResearchRecoveryAssessment = { schema_version: 1, resolver_version: 'staff-inventory-recovery-identity-v1', source_input_sha256: 'b'.repeat(64),
    description_event_id: input.description_event_id, description_hash: input.description_hash, proposed_description: input.description, added_fields: [], conflicts: [], missing_fields: [],
    recognition: { status: 'not_needed', evidence: null }, references: [], catalog_context: null, need_codes: ['MISSING_ORIGINAL_PHOTOS'], evidence_sha256: null, ready_for_research: false };
  const claim: StaffInventoryResearchRecoveryClaimV2 = { jobId: '11111111-1111-4111-8111-111111111111', leaseToken: '22222222-2222-4222-8222-222222222222',
    leaseExpiresAt: new Date(start + 120000).toISOString(), input, inputHash: assessment.source_input_sha256, expectedResultHash: null,
    previousAssessment: assessment, allowRecognition: false, allowScopeResolution: false };
  const deps: InventoryResearchRecoveryWorkerDependencies = {
    now: () => time, claim: async () => { calls.push('claim'); return claim; },
    prepare: async current => { assert.equal(current, claim); calls.push('prepare'); return assessment; },
    complete: async (current, prepared) => { assert.equal(current, claim); assert.equal(prepared, assessment); calls.push('complete'); return 'waiting'; },
    fail: async current => { assert.equal(current, claim); calls.push('fail'); return true; },
  };
  return { start, calls, parent, input, assessment, claim, deps, setTime(value: number) { time = value; }, run: (remainingBudgetMs = 240000) => runStaffInventoryResearchRecovery({ remainingBudgetMs, signal: parent.signal }, deps) };
}

test('recovery serializes exact claimed inputs and durable completion, with at most four checks per invocation', async () => {
  const f = harness();
  assert.deepEqual(await f.run(), { checked: 4, queued: 0, waiting: 4, failed: 0, stale: 0 });
  assert.deepEqual(f.calls, Array(4).fill(['claim', 'prepare', 'complete']).flat());
  assert.equal(getEventListeners(f.parent.signal, 'abort').length, 0);
});

test('busy intake or insufficient invocation budget does not invoke paid preparation', async () => {
  for (const remaining of [0, 129999]) {
    const f = harness(); assert.equal((await f.run(remaining)).checked, 0); assert.deepEqual(f.calls, []);
  }
  const idle = harness(); idle.deps.claim = async () => null;
  assert.equal((await idle.run()).checked, 0); assert.deepEqual(idle.calls, []);
  const cancelled = harness(); cancelled.parent.abort();
  assert.equal((await cancelled.run()).checked, 0); assert.deepEqual(cancelled.calls, []);
});

test('queued, waiting and stale completions stay distinct, and a failed prepare has one durable failure call', async () => {
  const f = harness(); let attempt = 0;
  f.deps.prepare = async () => { if (++attempt === 1) throw new Error('private provider failure'); return f.assessment; };
  f.deps.complete = async () => (['queued', 'waiting', 'stale'] as const)[attempt - 2];
  assert.deepEqual(await f.run(), { checked: 4, queued: 1, waiting: 1, failed: 1, stale: 1 });
  assert.equal(f.calls.filter(call => call === 'fail').length, 1);
});

test('failed lease ownership is counted stale and cannot be mistaken for a saved failure', async () => {
  const f = harness();
  f.deps.prepare = async () => { throw new Error('provider detail'); };
  f.deps.fail = async () => { f.setTime(f.start + 120000); return false; };
  assert.deepEqual(await f.run(), { checked: 1, queued: 0, waiting: 0, failed: 0, stale: 1 });
});

test('an aged lease and a slow claim reserve twenty seconds for persistence before any provider work', async () => {
  for (const expires of ['invalid-date', 'expired-lease', 'slow-claim']) {
    const f = harness();
    f.deps.claim = async () => {
      if (expires === 'slow-claim') f.setTime(f.start + 220001);
      else f.claim.leaseExpiresAt = expires === 'invalid-date' ? 'invalid' : new Date(f.start + 19999).toISOString();
      return f.claim;
    };
    f.deps.prepare = async () => assert.fail('No provider work inside persistence reserve');
    f.deps.fail = async () => { f.setTime(f.start + 240000); return true; };
    assert.deepEqual(await f.run(), { checked: 1, queued: 0, waiting: 0, failed: 1, stale: 0 });
  }
});

test('hung preparation that ignores abort is raced out at the lease deadline and its later result is ignored', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = harness(); f.claim.leaseExpiresAt = new Date(f.start + 45000).toISOString();
  let began!: (signal: AbortSignal) => void, finish!: (assessment: StaffInventoryResearchRecoveryAssessment) => void;
  const active = new Promise<AbortSignal>(resolve => { began = resolve; });
  f.deps.prepare = async (_, signal) => { began(signal); return new Promise(resolve => { finish = resolve; }); };
  f.deps.complete = async () => assert.fail('An expired provider result cannot complete');
  f.deps.fail = async () => { f.setTime(f.start + 200000); return true; };
  const run = f.run(), signal = await active;
  t.mock.timers.tick(24999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await run, { checked: 1, queued: 0, waiting: 0, failed: 1, stale: 0 });
  assert.equal(signal.aborted, true); assert.equal(getEventListeners(f.parent.signal, 'abort').length, 0);
  assert.equal(getEventListeners(signal, 'abort').length, 0);
  finish(f.assessment); await Promise.resolve();
});

test('parent cancellation during a claim or preparation prevents further provider work and removes listeners', async () => {
  const duringClaim = harness();
  duringClaim.deps.claim = async () => { duringClaim.parent.abort(); return duringClaim.claim; };
  duringClaim.deps.prepare = async () => assert.fail('Cancelled claim cannot invoke preparation');
  assert.equal((await duringClaim.run()).failed, 1);
  const duringPrepare = harness(); let began!: (signal: AbortSignal) => void;
  const active = new Promise<AbortSignal>(resolve => { began = resolve; });
  duringPrepare.deps.prepare = async (_, signal) => { began(signal); return new Promise(() => {}); };
  duringPrepare.deps.complete = async () => assert.fail('Cancelled preparation cannot complete');
  const run = duringPrepare.run(), signal = await active; duringPrepare.parent.abort();
  assert.deepEqual(await run, { checked: 1, queued: 0, waiting: 0, failed: 1, stale: 0 });
  assert.equal(signal.aborted, true); assert.equal(getEventListeners(duringPrepare.parent.signal, 'abort').length, 0);
});

test('durable claim and failure-persistence outages propagate rather than silently bypassing recovery', async () => {
  const claim = harness(); claim.deps.claim = async () => { throw new Error('claim unavailable'); };
  await assert.rejects(claim.run(), /claim unavailable/); assert.deepEqual(claim.calls, []);
  const fail = harness(); fail.deps.prepare = async () => { throw new Error('provider failed'); };
  fail.deps.fail = async () => { throw new Error('persistence unavailable'); };
  await assert.rejects(fail.run(), /persistence unavailable/);
  assert.equal(getEventListeners(fail.parent.signal, 'abort').length, 0);
});

test('already-paid recognition/scope permissions and cached proposal are passed through unchanged', async () => {
  const f = harness();
  f.deps.prepare = async claim => {
    assert.equal(claim.allowRecognition, false); assert.equal(claim.allowScopeResolution, false);
    assert.equal(claim.previousAssessment, f.assessment); return f.assessment;
  };
  f.deps.complete = async () => { f.setTime(f.start + 120000); return 'waiting'; };
  assert.equal((await f.run()).checked, 1);
});

test('ready research receives its invocation budget before a slow recovery backlog', async () => {
  const start = Date.now(); let now = start; const calls: string[] = [];
  const claim = { jobId: 'fixture', leaseToken: 'fixture-lease', leaseExpiresAt: new Date(start + 180000).toISOString(),
    inputHash: 'b'.repeat(64), input: harness().input, attempt: 1 } as NonNullable<Awaited<ReturnType<StaffInventoryResearchWorkerDependencies['claim']>>>;
  const deps: StaffInventoryResearchWorkerDependencies = {
    now: () => now,
    claim: async () => { calls.push('claim'); return claim; },
    research: async () => { calls.push('research'); now = start + 60000; return {} as Awaited<ReturnType<StaffInventoryResearchWorkerDependencies['research']>>; },
    complete: async () => { calls.push('complete'); return true; }, fail: async () => assert.fail('Ready fixture must complete'),
    recover: async input => { calls.push('recovery'); assert.equal(input.remainingBudgetMs, 180000); now = start + 200000; },
  };
  assert.deepEqual(await runStaffInventoryResearchWorker(deps), { claimed: 1, completed: 1, failed: 0, superseded: 0 });
  assert.deepEqual(calls, ['claim', 'research', 'complete', 'recovery']);
});
