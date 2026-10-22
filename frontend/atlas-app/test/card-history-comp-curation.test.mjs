import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cardHistoryCompScope, createCardHistoryCompCuration } from '../lib/card-history-comp-curation.mjs';
import { createStaffCompCurationClient } from '../lib/staff-comp-curation-client.mjs';
import { httpFixture, deferred, jsonResponse } from './staff-comp-curation-fixture.mjs';

async function fixture() {
  const f = await httpFixture({ policyDisabled: true });
  const events = new EventTarget(), calls = [];
  let current = true;
  const options = { enabled: true, staff: f.staff, cardId: f.cardId, events, isCurrent: () => current,
    async fetchImpl(path, init) {
      calls.push({ path, init });
      if (path === '/admin/api/staff/session') return jsonResponse({ mode: 'LOCAL_FIXTURE', staff: f.staff, csrf: 'fixture-csrf' });
      if (path.endsWith('/presentation/market')) return jsonResponse({ state: 'READY', approvalActionId: f.actionId, previewId: f.previewId, preview: f.preview });
      return f.request({ method: init.method, path: path.slice('/admin'.length), ...(init.body ? { body: JSON.parse(init.body) } : {}), signal: init.signal });
    } };
  const composition = createCardHistoryCompCuration(options);
  return Object.assign(f, { options, composition, events, calls, setCurrent(value) { current = value; } });
}

test('absent display flag constructs no transport and requires explicit reviewer/card/fetch/lifetime', () => {
  assert.equal(createCardHistoryCompCuration(), null);
  assert.equal(createCardHistoryCompCuration({ enabled: 'true' }), null);
  assert.equal(cardHistoryCompScope({ id: randomUUID(), role: 'OBSERVER', mode: 'LOCAL_FIXTURE' }, randomUUID()), null);
  assert.throws(() => createCardHistoryCompCuration({ enabled: true }), { code: 'COMP_NOT_CONFIGURED' });
});

test('exact existing saved read and null-policy Skip/No suitable flow preserve report and saved pool', async t => {
  const f = await fixture(); t.after(f.composition.close);
  const original = JSON.stringify({ packet: f.packet, preview: f.preview });
  const client = createStaffCompCurationClient({ request: f.composition.request });
  const market = await f.composition.request({ method: 'GET', path: `/api/staff/manual-connected/cards/${f.cardId}/presentation/market` });
  assert.equal((await market.json()).previewId, f.previewId);
  let current = await client.read({ staff: f.staff, cardId: f.cardId, input: f.readInput });
  assert.equal(current.policy, null); assert.equal(current.availability, 'POLICY_REQUIRED');
  for (const outcome of ['SKIP', 'NO_SUITABLE_COMPS']) {
    const input = f.input({ outcome, expectedSelectionRevision: f.rows.length, selectedIds: [], reviewedIds: [], expectedPolicyHash: null });
    const result = await client.decide({ staff: f.staff, cardId: f.cardId, input });
    assert.equal(result.outcome, outcome); assert.equal(result.policy, null); assert.equal(result.guidance, null);
  }
  assert.equal(f.rows.length, 2); assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 2);
  assert.equal(JSON.stringify({ packet: f.packet, preview: f.preview }), original);
});

test('other cards, acquisition and selected policy cannot dispatch even with a retained request', async t => {
  const f = await fixture(); t.after(f.composition.close);
  for (const path of [f.readPath.replace(f.cardId, randomUUID()), `/api/staff/manual-connected/cards/${randomUUID()}/presentation/market`,
    `/api/staff/manual-connected/cards/${f.cardId}/presentation/market/search`])
    await assert.rejects(f.composition.request({ method: 'GET', path }), { code: 'COMP_REQUEST_INVALID' });
  await assert.rejects(f.composition.request({ method: 'POST', path: f.decisionPath, body: f.input() }), { code: 'COMP_POLICY_REQUIRED' });
  await assert.rejects(f.composition.request({ method: 'POST', path: f.decisionPath, body: f.input({ outcome: 'SKIP', selectedIds: [], reviewedIds: [] }) }), { code: 'COMP_POLICY_REQUIRED' });
  assert.equal(f.calls.length, 0); assert.equal(f.rows.length, 0);
});

test('observed read cannot start a final fetch or publish after actor/card/flag/lifetime replacement', async () => {
  for (const mutate of [f => { f.options.cardId = randomUUID(); }, f => { f.options.enabled = false; },
    f => { f.staff.id = randomUUID(); }, f => { f.options.staff = { ...f.staff }; }, f => f.setCurrent(false)]) {
    const f = await fixture(), entered = deferred(), release = deferred();
    f.hooks.response = async () => { entered.resolve(); await release.promise; };
    const pending = f.composition.request({ method: 'GET', path: f.readPath });
    await entered.promise; mutate(f); release.resolve();
    await assert.rejects(pending, { code: 'COMP_ACCESS_ENDED' });
    assert.equal(f.calls.length, 2); assert.equal(f.composition.isCurrent(), false); f.composition.close();
  }
});

test('pagehide and explicit disposal cancel held results with no automatic save replay', async () => {
  for (const close of [f => f.events.dispatchEvent(new Event('pagehide')), f => f.composition.close()]) {
    const f = await fixture(), entered = deferred(), release = deferred();
    f.hooks.response = async () => { entered.resolve(); await release.promise; };
    const input = f.input({ outcome: 'SKIP', selectedIds: [], reviewedIds: [], expectedPolicyHash: null });
    const pending = f.composition.request({ method: 'POST', path: f.decisionPath, body: input });
    await entered.promise; assert.equal(f.rows.length, 1); close(f);
    await assert.rejects(pending, { code: 'COMP_ACCESS_ENDED' });
    release.resolve(); await new Promise(setImmediate);
    assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
    assert.equal(f.rows.length, 1, 'closing a page is not a rollback of an already saved decision');
    await assert.rejects(f.composition.request({ method: 'GET', path: f.readPath }), { code: 'COMP_ACCESS_ENDED' });
  }
});
