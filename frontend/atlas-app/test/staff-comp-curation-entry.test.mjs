import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { compCurationCard, parseSavedCompEntry, createSavedCompEntryReader, assertCompCurationBinding } from '../lib/staff-comp-curation-entry.mjs';
import { compUIFixture, deferred, flush } from './staff-comp-curation-ui-fixture.mjs';
import { jsonResponse } from './staff-comp-curation-fixture.mjs';

test('saved-entry reader uses actual saved status, exact approval/report and session fences; no acquisition', async () => {
  const f = await compUIFixture(), reader = createSavedCompEntryReader({ request: f.request });
  const result = await reader({ staff: f.staff, card: f.card });
  assert.deepEqual(result, { status: 'READY', input: f.readInput });
  assert.deepEqual(f.traffic.map(r => [r.method, r.path]), [['GET','/api/staff/session'], ['GET',f.statusPath], ['GET','/api/staff/session']]);
  assert.equal(f.calls.insert, 0); assert.equal(f.exchanges.length, 0);
  f.setPool(false); assert.equal((await reader({ staff: f.staff, card: f.card })).status, 'NO_SAVED_POOL');
  f.setPool(true); f.market.state = 'STARTED'; assert.deepEqual(await reader({ staff: f.staff, card: f.card }), { status: 'POOL_NOT_READY', input: null });
});

test('entry rejects foreign actor, pending approval, changed report or saved pool binding without forwarding raw candidates', async () => {
  const f = await compUIFixture(), card = compCurationCard(f.card);
  assert.throws(() => compCurationCard({ ...f.card, report: { ...f.card.report, state: 'PENDING' } }));
  const ready = { state: 'READY', previewId: f.previewId, approvalActionId: f.actionId, preview: f.preview };
  for (const value of [{ ...ready, approvalActionId: randomUUID() }, { ...ready, previewId: 'bad' },
    { ...ready, preview: { ...f.preview, binding: { ...f.preview.binding, publicHash: 'f'.repeat(64) } } }]) assert.throws(() => parseSavedCompEntry(value, card));
  const state = await f.service.read(f.staff, f.cardId, f.readInput);
  assertCompCurationBinding(state, card, f.staff.mode);
  for (const key of ['sourceHash', 'reportHash', 'sourceRevision', 'publicHash', 'mode']) assert.throws(() => assertCompCurationBinding({ ...state, binding: { ...state.binding, [key]: 'changed' } }, card, f.staff.mode));
  f.metadataHooks.status = () => f.setSession({ ...f.staff, id: randomUUID() });
  await assert.rejects(createSavedCompEntryReader({ request: f.request })({ staff: f.staff, card: f.card }), { code: 'COMP_ACCESS_ENDED' });
});

test('entry requires explicit private bounded JSON transport and treats 401/403 as access loss', async () => {
  const f = await compUIFixture();
  await assert.rejects(createSavedCompEntryReader()({ staff: f.staff, card: f.card }), { code: 'COMP_NOT_CONFIGURED' });
  for (const status of [401, 403]) await assert.rejects(createSavedCompEntryReader({ request: () => jsonResponse({}, status) })({ staff: f.staff, card: f.card }), { code: 'COMP_ACCESS_ENDED' });
  for (const headers of [{ 'content-type': 'application/json' }, { 'content-type': 'application/json', 'cache-control': 'private,no-store', 'content-length': '2097153' }]) {
    await assert.rejects(createSavedCompEntryReader({ request: () => new Response('{}', { headers }) })({ staff: f.staff, card: f.card }));
  }
});

test('stalled transport and stalled body settle on abort with no post-abort chunk; late bodies are disposed', async () => {
  const f = await compUIFixture(), pending = deferred(), abort = new AbortController(); let cancelled = 0;
  const work = createSavedCompEntryReader({ request: () => pending.promise })({ staff: f.staff, card: f.card, signal: abort.signal });
  await flush(); abort.abort(); await assert.rejects(work, { code: 'COMP_CANCELLED' });
  pending.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }))); await flush(); assert.equal(cancelled, 1);
  const second = new AbortController(), started = deferred();
  const reading = createSavedCompEntryReader({ request: () => {
    started.resolve(); return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } });
  } })({ staff: f.staff, card: f.card, signal: second.signal });
  await started.promise; await flush(); second.abort(); await assert.rejects(reading, { code: 'COMP_CANCELLED' }); assert.equal(cancelled, 2);
});

test('entry timeout settles a noncompliant request and streamed bodies cannot exceed the bound', async t => {
  const f = await compUIFixture(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = deferred(); let dispatched = 0;
  const work = createSavedCompEntryReader({ request: () => { dispatched++; entered.resolve(); return new Promise(() => {}); } })({ staff: f.staff, card: f.card });
  const refusal = assert.rejects(work, { code: 'COMP_CANCELLED' }); await entered.promise; assert.equal(dispatched, 1);
  t.mock.timers.tick(25001); await refusal; assert.equal(dispatched, 1);
  t.mock.timers.reset(); let cancelled = false;
  await assert.rejects(createSavedCompEntryReader({ request: () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array(2097153)); }, cancel() { cancelled = true; } }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } }) })({ staff: f.staff, card: f.card }));
  assert.equal(cancelled, true);
});
