import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { compCurationInput } from '../../../packages/atlas-connected-manual/src/comp-curation-contract.mjs';
import { createStaffCompCurationClient, curationDecisionInput, parseCurationResponse } from '../lib/staff-comp-curation-client.mjs';
import { httpFixture, realSavedV2, jsonResponse, deferred } from './staff-comp-curation-fixture.mjs';

const options = f => ({ staff: f.staff, cardId: f.cardId, input: f.readInput });
test('default is unavailable/no fetch; explicit transport consumes actual-service state and preserves unknown designation', async () => {
  const f = await httpFixture();
  await assert.rejects(createStaffCompCurationClient().read(options(f)), { code: 'COMP_NOT_CONFIGURED' });
  realSavedV2(f); const client = createStaffCompCurationClient({ request: f.request });
  const state = await client.read(options(f)), graded = state.preview.candidates.find(c => !c.raw), raw = state.preview.candidates.find(c => c.raw);
  assert.equal(graded.designation, null); assert.equal(graded.eligible, false); assert(graded.reasonCodes.includes('GRADE_DESIGNATION_UNCONFIRMED'));
  assert.equal(raw.eligible, true); assert.equal(state.status, 'LOCAL_PROPOSAL');
  const result = await client.decide({ ...options(f), input: f.input({ selectedIds: [raw.id], reviewedIds: [raw.id] }) });
  assert.equal(result.guidance.meanMinor, 1001); assert.equal(result.guidance.listingPrice, null); assert.equal(result.reportSnapshotUnaffected, true);
  assert.equal(f.exchanges.length, 2); assert(!f.exchanges[0].path.includes(f.actorId));
});
test('browser request parser agrees with actual service parser, rejects authority/price and incomplete human review', async () => {
  const f = await httpFixture(), input = f.input();
  assert.deepEqual(curationDecisionInput({ ...input, selectedIds: [...input.selectedIds].reverse() }), compCurationInput(input));
  for (const change of [{ actorId: f.actorId }, { priceMinor: 1 }, { policy: {} }, { reviewedIds: [] }, { selectedIds: ['a', 'a'] },
    { outcome: 'SKIP' }, { expectedSelectionRevision: 2147483646 }]) {
    assert.throws(() => curationDecisionInput({ ...input, ...change })); assert.throws(() => compCurationInput({ ...input, ...change }));
  }
});
test('foreign staff, approval/source/shape and manufactured guidance responses fail closed', async () => {
  const f = await httpFixture(), envelope = await (await f.request({ method: 'GET', path: f.readPath })).json();
  const expected = { ...options(f), action: 'read' };
  for (const change of [v => { v.staff.id = randomUUID(); }, v => { v.staff.role = 'OBSERVER'; },
    v => { v.result.binding.cardId = randomUUID(); }, v => { v.result.source.previewId = randomUUID(); },
    v => { v.result.preview.candidates[0].listingUrl = 'https://evil.invalid/itm/123'; },
    v => { v.result.preview.candidates[0].priceMinor = null; }, v => { v.result.extra = 'private'; }]) {
    const bad = structuredClone(envelope); change(bad); assert.throws(() => parseCurationResponse(bad, expected));
  }
  const input = f.input(), receipt = await (await f.request({ method: 'POST', path: f.decisionPath, body: input })).json();
  for (const change of [v => { v.result.revision++; }, v => { v.result.actorId = randomUUID(); },
    v => { v.result.guidance.meanMinor++; }, v => { v.result.guidance.askingPriceMinor = 123; }, v => { v.result.reportSnapshotUnaffected = false; }]) {
    const bad = structuredClone(receipt); change(bad); assert.throws(() => parseCurationResponse(bad, { ...options(f), input, action: 'decide' }));
  }
});
test('401/403 and cookie-account response mismatch end access; generic mutation HTTP failures stay unknown', async () => {
  const f = await httpFixture();
  for (const status of [401, 403]) {
    const client = createStaffCompCurationClient({ request: async () => jsonResponse({ error: 'refused' }, status) });
    await assert.rejects(client.read(options(f)), { code: 'COMP_ACCESS_ENDED' });
  }
  for (const status of [400, 404, 409, 503]) await assert.rejects(createStaffCompCurationClient({ request: async () => jsonResponse({ error: 'refused' }, status) })
    .decide({ ...options(f), input: f.input() }), { code: 'COMP_OUTCOME_UNKNOWN' });
  const envelope = await (await f.request({ method: 'GET', path: f.readPath })).json(); envelope.staff.id = randomUUID();
  await assert.rejects(createStaffCompCurationClient({ request: async () => jsonResponse(envelope) }).read(options(f)), { code: 'COMP_ACCESS_ENDED' });
});
test('noncompliant transport and stalled response body settle on abort; late body is cancelled', async () => {
  const f = await httpFixture(), first = deferred(), entered = deferred(); let cancelled = 0;
  const transport = createStaffCompCurationClient({ request: () => { entered.resolve(); return first.promise; } });
  const ac = new AbortController(), pending = transport.read({ ...options(f), signal: ac.signal }); await entered.promise; ac.abort();
  await assert.rejects(pending, { code: 'COMP_CANCELLED' });
  first.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, 1);
  const reading = deferred(), ac2 = new AbortController();
  const client = createStaffCompCurationClient({ request: async () => new Response(new ReadableStream({ pull() { reading.resolve(); }, cancel() { cancelled++; } }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } }) });
  const stalled = client.read({ ...options(f), signal: ac2.signal }); await reading.promise; ac2.abort();
  await assert.rejects(stalled, { code: 'COMP_CANCELLED' }); assert.equal(cancelled, 2);
});
test('bounded response and private/no-store are mandatory; timeout settles without adapter cooperation', async t => {
  const f = await httpFixture();
  for (const response of [new Response('x'.repeat(2097153), { headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'cache-control': 'public' } })])
    await assert.rejects(createStaffCompCurationClient({ request: async () => response }).read(options(f)), { code: 'COMP_UNAVAILABLE' });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = deferred(), client = createStaffCompCurationClient({ request: () => { entered.resolve(); return new Promise(() => {}); } });
  const pending = client.read(options(f)); await entered.promise; t.mock.timers.tick(25000);
  await assert.rejects(pending, { code: 'COMP_UNAVAILABLE' });
});
