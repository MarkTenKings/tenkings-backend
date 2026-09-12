import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createInventoryResearchCronHandler } from '../pages/api/cron/inventory-research';
import { runStaffInventoryResearchWorker, type StaffInventoryResearchWorkerDependencies } from '../lib/server/staffInventoryResearchWorker';
import { StaffInventoryResearchError } from '../lib/server/staffInventoryResearch';
import { staffInventoryResearchSetKeys, staffInventoryResearchCatalogReferences } from '../lib/server/staffInventoryResearchReferences';

function response() {
  const result = { code: 0, body: null as any, headers: {} as Record<string, string> };
  const res = { setHeader(key: string, value: string) { result.headers[key] = value; }, status(code: number) { result.code = code; return this; }, json(body: unknown) { result.body = body; return this; } } as unknown as NextApiResponse;
  return { result, res };
}
const secret = 'fixture-dedicated-cron-capability'.repeat(2);
test('scheduled research requires its dedicated secret and cannot accept a card or model parameter', async () => {
  let runs = 0;
  const handler = createInventoryResearchCronHandler({ secret: () => secret, run: async () => { runs++; return { claimed: 0, completed: 0, failed: 0, superseded: 0 }; } });
  for (const authorization of ['', 'Bearer admin-token', `Basic ${secret}`, `Bearer ${secret} `]) {
    const { result, res } = response(); await handler({ method: 'GET', headers: { authorization }, query: {} } as NextApiRequest, res);
    assert.equal(result.code, 401); assert.equal(runs, 0);
  }
  for (const [method, query, code] of [['POST', {}, 405], ['GET', { unit_id: 'untrusted' }, 400], ['GET', {}, 200]] as const) {
    const { result, res } = response(); await handler({ method, headers: { authorization: `Bearer ${secret}` }, query } as NextApiRequest, res);
    assert.equal(result.code, code); assert.equal(result.headers['Cache-Control'], 'private, no-store');
  }
  assert.equal(runs, 1);
});
test('worker completion errors expose no provider exception or secret', async () => {
  const { result, res } = response();
  await createInventoryResearchCronHandler({ secret: () => secret, run: async () => { throw new Error('fixture-provider-secret'); } })({ method: 'GET', headers: { authorization: `Bearer ${secret}` }, query: {} } as NextApiRequest, res);
  assert.equal(result.code, 503); assert.equal(JSON.stringify(result).includes('fixture-provider-secret'), false);
});
function workerFixture(started = Date.now()) {
  const calls: string[] = [], claim = { jobId: 'job', leaseToken: 'exact-owner', leaseExpiresAt: new Date(started + 180000).toISOString(), input: { unit_id: 'unit' } } as any;
  const deps: StaffInventoryResearchWorkerDependencies = {
    now: () => started,
    claim: async () => { calls.push('claim'); return claim; },
    research: async () => { calls.push('research'); return { private: 'evidence' } as any; },
    complete: async (current, result) => { assert.equal(current, claim); assert.equal((result as any).private, 'evidence'); calls.push('complete'); return true; },
    fail: async () => { calls.push('fail'); return true; },
  };
  return { deps, calls, claim };
}
test('worker awaits completion before next claim and bounds a run to four cards', async () => {
  const { deps, calls } = workerFixture();
  assert.deepEqual(await runStaffInventoryResearchWorker(deps), { claimed: 4, completed: 4, failed: 0, superseded: 0 });
  assert.deepEqual(calls, Array(4).fill(['claim', 'research', 'complete']).flat());
});
test('busy intake or full global capacity ends a worker without model calls', async () => {
  const { deps, calls } = workerFixture(); deps.claim = async () => null;
  assert.equal((await runStaffInventoryResearchWorker(deps)).claimed, 0); assert.deepEqual(calls, []);
});
test('failed attempts are recorded safely; stale worker completion cannot be counted as saved', async () => {
  const { deps } = workerFixture(); let n = 0;
  deps.research = async () => { if (n++ === 0) throw new Error('unsafe provider response'); return {} as any; };
  deps.fail = async (_, error) => { assert.ok(error instanceof StaffInventoryResearchError); assert.equal(error.code, 'provider_error'); assert.equal(error.message.includes('unsafe'), false); return true; };
  deps.complete = async () => false;
  assert.deepEqual(await runStaffInventoryResearchWorker(deps), { claimed: 4, completed: 0, failed: 1, superseded: 3 });
});
test('deadline budget and external cancellation stop further claims', async () => {
  const { deps } = workerFixture(0); let time = 0; deps.now = () => time;
  deps.complete = async () => { time = 150000; return true; };
  assert.equal((await runStaffInventoryResearchWorker(deps)).claimed, 1);
  const abort = new AbortController(); abort.abort();
  assert.equal((await runStaffInventoryResearchWorker(deps, abort.signal)).claimed, 0);
});
test('a later research claim reserves the full engine and transaction budgets', async () => {
  for (const elapsed of [50000, 100000, 139999]) {
    const { deps, calls } = workerFixture(0); let time = 0; deps.now = () => time;
    deps.complete = async () => { calls.push('complete'); time = elapsed; return true; };
    assert.deepEqual(await runStaffInventoryResearchWorker(deps), { claimed: 1, completed: 1, failed: 0, superseded: 0 });
    assert.deepEqual(calls, ['claim', 'research', 'complete']);
  }
});
test('quick attempts leave capacity for another full research attempt', async () => {
  const { deps, calls } = workerFixture(0); let time = 0; deps.now = () => time;
  deps.complete = async () => { calls.push('complete'); time = calls.filter(call => call === 'complete').length === 1 ? 49999 : 200000; return true; };
  assert.deepEqual(await runStaffInventoryResearchWorker(deps), { claimed: 2, completed: 2, failed: 0, superseded: 0 });
  assert.deepEqual(calls, Array(2).fill(['claim', 'research', 'complete']).flat());
});
test('an aged lease stops research with a completion reserve and a fresh lease keeps the engine cap', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [leaseRemaining, researchBudget] of [[60000, 40000], [180000, 150000]]) {
    const started = Date.parse('2026-09-11T10:00:00.000Z');
    const { deps, claim } = workerFixture(started); let time = started; deps.now = () => time;
    claim.leaseExpiresAt = new Date(started + leaseRemaining).toISOString();
    let began!: (signal: AbortSignal) => void;
    const active = new Promise<AbortSignal>(resolve => { began = resolve; });
    deps.research = async (_, signal) => {
      began(signal);
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new StaffInventoryResearchError('cancelled')), { once: true }));
    };
    deps.complete = async () => assert.fail('Expired research must not complete.');
    deps.fail = async (_, error) => { assert.equal(error.code, 'timeout'); time = started + 200000; return true; };
    const running = runStaffInventoryResearchWorker(deps), signal = await active;
    time = started + researchBudget - 1; t.mock.timers.tick(researchBudget - 1);
    assert.equal(signal.aborted, false);
    time++; t.mock.timers.tick(1);
    assert.deepEqual(await running, { claimed: 1, completed: 0, failed: 1, superseded: 0 });
    assert.equal(signal.aborted, true);
  }
});
test('exhausted lease or invocation budgets fail safely before vendor work', async () => {
  for (const invocationExhausted of [false, true]) {
    const started = Date.parse('2026-09-11T10:00:00.000Z');
    const { deps, claim } = workerFixture(started); let time = started; deps.now = () => time;
    deps.claim = async () => {
      if (invocationExhausted) time = started + 220001;
      claim.leaseExpiresAt = new Date(time + (invocationExhausted ? 180000 : 19999)).toISOString();
      return claim;
    };
    deps.research = async () => assert.fail('No provider call is allowed after the usable attempt budget.');
    deps.fail = async (_, error) => { assert.equal(error.code, 'timeout'); time = started + 240000; return true; };
    assert.deepEqual(await runStaffInventoryResearchWorker(deps), { claimed: 1, completed: 0, failed: 1, superseded: 0 });
  }
});
test('parent cancellation reaches the claimed attempt and removes its listener', async () => {
  const { deps } = workerFixture(), parent = new AbortController();
  let began!: (signal: AbortSignal) => void;
  const active = new Promise<AbortSignal>(resolve => { began = resolve; });
  deps.research = async (_, signal) => {
    began(signal);
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new StaffInventoryResearchError('cancelled')), { once: true }));
  };
  deps.complete = async () => assert.fail('Cancelled work must not complete.');
  deps.fail = async (_, error) => { assert.equal(error.code, 'cancelled'); return true; };
  const running = runStaffInventoryResearchWorker(deps, parent.signal), signal = await active;
  parent.abort();
  assert.deepEqual(await running, { claimed: 1, completed: 0, failed: 1, superseded: 0 });
  assert.equal(signal.aborted, true);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});
test('parent cancellation during a claim prevents vendor work and successful runs remove listeners', async () => {
  const { deps, claim } = workerFixture(), parent = new AbortController();
  deps.claim = async () => { parent.abort(); return claim; };
  deps.research = async () => assert.fail('The cancelled claim must not call a provider.');
  deps.fail = async (_, error) => { assert.equal(error.code, 'cancelled'); return true; };
  assert.deepEqual(await runStaffInventoryResearchWorker(deps, parent.signal), { claimed: 1, completed: 0, failed: 1, superseded: 0 });
  const successful = workerFixture(), liveParent = new AbortController();
  assert.equal((await runStaffInventoryResearchWorker(successful.deps, liveParent.signal)).completed, 4);
  assert.equal(getEventListeners(liveParent.signal, 'abort').length, 0);
});
const description = { name: 'Fixture Runner', category: 'Sports cards', year: '2025', manufacturer: 'Fixture', set_name: 'Chrome Baseball', card_number: '007/100', variant: null, card_type: null };
test('catalog aliases require exact year/maker/product/card number and source review', () => {
  assert.ok(staffInventoryResearchSetKeys(description).includes('2025 fixture chrome baseball'));
  assert.deepEqual(staffInventoryResearchSetKeys({ ...description, manufacturer: null }), []);
  const row = { cardId: 'card', setId: '2025_Fixture_Chrome_Baseball', cardNumber: '007/100', playerName: 'Fixture Runner', metadataJson: null, parallelId: 'gold', label: 'Gold', serialText: '/50', finishFamily: 'gold border', visualCuesJson: { border: 'Gold around image' }, variationId: null, variationLabel: null, scopeNote: null, cardSourceId: 'cs', parallelSourceId: 'ps', scopeSourceId: 'ss', sourceUrl: 'https://example.com/checklist', cardReviewedAt: new Date('2026-09-01T00:00:00.000Z'), parallelReviewedAt: new Date('2026-09-01T00:00:00.000Z'), scopeReviewedAt: new Date('2026-09-01T00:00:00.000Z'), sourceMetadata: null };
  const reviewedRow = { ...row, variationSourceId: null, variationReviewedAt: null };
  const [reference] = staffInventoryResearchCatalogReferences(description, [reviewedRow]);
  assert.equal(reference.variant_kind, 'PARALLEL'); assert.equal(reference.identity.category, null); assert.match(reference.source_sha256, /^[a-f0-9]{64}$/);
  for (const patch of [{ cardNumber: '7/100' }, { setId: '2024_Fixture_Chrome_Baseball' }, { scopeReviewedAt: null }, { variationId: 'variation', variationLabel: 'Image variation' }]) assert.deepEqual(staffInventoryResearchCatalogReferences(description, [{ ...reviewedRow, ...patch }]), []);
});
