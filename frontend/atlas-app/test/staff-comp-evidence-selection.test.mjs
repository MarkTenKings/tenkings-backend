import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStaffCompCurationController } from '../lib/staff-comp-curation-controller.mjs';
import { createStaffCompCurationClient, parseCurationState, parseCurationReceipt } from '../lib/staff-comp-curation-client.mjs';
import { createCardHistoryCompCuration } from '../lib/card-history-comp-curation.mjs';
import { httpFixture, jsonResponse, realSavedV2 } from './staff-comp-curation-fixture.mjs';

const selectionPolicy = { version: 'atlas-comp-evidence-selection-policy-v1', status: 'LOCAL_PROPOSAL',
  method: 'private-saved-sold-evidence-v1', recencyDays: null, rightsStatus: 'UNRESOLVED' };
const selection = f => ({ requestId: randomUUID(), outcome: 'SELECTED', selectedIds: f.preview.candidates.map(c => c.sale.id), reviewedIds: f.preview.candidates.map(c => c.sale.id) });
const expected = f => ({ cardId: f.cardId, approvalActionId: f.actionId, previewId: f.previewId, mode: f.staff.mode });
const controller = f => createStaffCompCurationController({ staff: f.staff, cardId: f.cardId, input: f.readInput, request: f.request });

test('evidence-only HTTP/controller saves, reopens and appends revisions with null guidance and no changed report', async () => {
  const f = await httpFixture({ selectionPolicy }), c = controller(f);
  const before = JSON.stringify({ row: f.row, packet: f.packet, market: f.market });
  await c.load(); assert.equal(c.snapshot().state.preview.policy.recencyDays, null);
  const first = await c.decide(selection(f)); assert.equal(first.guidance, null); assert.equal(first.revision, 1);
  await c.load(); assert.deepEqual(c.snapshot().state.selection, first);
  const second = await c.decide(selection(f)); assert.equal(second.guidance, null); assert.equal(second.revision, 2);
  assert.equal(first.policy.rightsStatus, 'UNRESOLVED');
  assert.equal(JSON.stringify({ row: f.row, packet: f.packet, market: f.market }), before); c.dispose();
});

test('evidence-only unknown save recovers exact receipt, not a newer similar decision', async () => {
  const f = await httpFixture({ selectionPolicy }), c = controller(f); await c.load();
  f.hooks.response = ({ method }) => { if (method === 'POST') throw new Error('synthetic reply loss'); };
  await c.decide(selection(f)); assert.equal(c.snapshot().phase, 'UNRESOLVED'); assert.equal(f.rows.length, 1);
  await c.reconcile(); assert.equal(c.snapshot().phase, 'CONFIRMED'); assert.equal(f.rows.length, 1);
  await c.load(); await c.decide(selection(f)); const requestId = c.snapshot().pending.requestId;
  await f.service.decide(f.staff, f.cardId, f.input({ expectedPolicyHash: c.snapshot().state?.policyHash ?? firstHash(f) }));
  await c.reconcile(); assert.equal(c.snapshot().phase, 'UNRESOLVED'); assert.equal(f.rows.length, 3);
  delete f.hooks.response; const recovered = await c.retry();
  assert.equal(recovered.requestId, requestId); assert.equal(recovered.revision, 2); assert.equal(recovered.guidance, null);
  assert.equal(f.rows.length, 3); c.dispose();
});
function firstHash(f) { return JSON.parse(f.rows[0].receipt).policyHash; }

test('evidence parser cannot smuggle guidance, changed policy or ineligible/empty/mixed selected facts', async () => {
  const f = await httpFixture({ selectionPolicy });
  const state = await f.service.read(f.staff, f.cardId, f.readInput);
  const saved = await f.service.decide(f.staff, f.cardId, f.input({ expectedPolicyHash: state.policyHash }));
  for (const change of [v => { v.guidance = { meanMinor: 2000 }; }, v => { v.policy.method = 'selected-sold-price-arithmetic-mean-v1'; },
    v => { v.policy.recencyDays = 90; }, v => { v.selected = []; }, v => { v.selected[0].eligible = false; v.selected[0].reasonCodes = ['IDENTITY_NOT_CONFIRMED']; },
    v => { v.selected[0].currency = 'CAD'; }]) {
    const altered = structuredClone(saved); change(altered);
    assert.throws(() => parseCurationReceipt(altered, expected(f)), { code: 'COMP_RESPONSE_INVALID' });
  }
  const wrongPreview = structuredClone(state); wrongPreview.preview.policy.method = 'selected-sold-price-arithmetic-mean-v1';
  assert.throws(() => parseCurationState(wrongPreview, expected(f)), { code: 'COMP_RESPONSE_INVALID' });
  const legacy = await httpFixture(), oldState = await legacy.service.read(legacy.staff, legacy.cardId, legacy.readInput);
  const oldReceipt = await legacy.service.decide(legacy.staff, legacy.cardId, legacy.input());
  assert.equal(parseCurationReceipt(oldReceipt, expected(legacy)).guidance.meanMinor, 2000);
  assert.equal(parseCurationState(oldState, expected(legacy)).policy.recencyDays, 90);
  oldReceipt.guidance = null;
  assert.throws(() => parseCurationReceipt(oldReceipt, expected(legacy)), { code: 'COMP_RESPONSE_INVALID' });
});

test('saved current v2 unknown designation remains unselectable even with evidence-only policy', async () => {
  const f = await httpFixture({ selectionPolicy }); realSavedV2(f); const c = controller(f); await c.load();
  const graded = c.snapshot().state.preview.candidates.find(row => !row.raw);
  assert.equal(graded.designation, null); assert.equal(graded.eligible, false);
  await assert.rejects(c.decide({ requestId: randomUUID(), outcome: 'SELECTED', selectedIds: [graded.id], reviewedIds: [graded.id] }), { code: 'COMP_SELECTION_INELIGIBLE' });
  assert.equal(f.rows.length, 0); c.dispose();
});

test('Card History allows only the observed evidence-policy hash and exact card, with no pricing or implicit POST', async t => {
  const f = await httpFixture({ selectionPolicy }), calls = [], events = new EventTarget();
  const composition = createCardHistoryCompCuration({ enabled: true, staff: f.staff, cardId: f.cardId, events, isCurrent: () => true,
    async fetchImpl(path, init) {
      calls.push(init.method);
      if (path === '/admin/api/staff/session') return jsonResponse({ mode: f.staff.mode, staff: f.staff, csrf: 'fixture-csrf' });
      return f.request({ method: init.method, path: path.slice('/admin'.length), ...(init.body ? { body: JSON.parse(init.body) } : {}), signal: init.signal });
    } });
  t.after(composition.close);
  await assert.rejects(composition.request({ method: 'POST', path: f.decisionPath, body: f.input() }), { code: 'COMP_POLICY_REQUIRED' });
  assert.deepEqual(calls, []);
  const client = createStaffCompCurationClient({ request: composition.request });
  const state = await client.read({ staff: f.staff, cardId: f.cardId, input: f.readInput });
  assert(calls.every(method => method === 'GET')); assert.equal(f.rows.length, 0);
  await assert.rejects(composition.request({ method: 'POST', path: f.decisionPath, body: f.input() }), { code: 'COMP_POLICY_REQUIRED' });
  const input = f.input({ expectedPolicyHash: state.policyHash });
  const saved = await client.decide({ staff: f.staff, cardId: f.cardId, input });
  assert.equal(saved.guidance, null); assert.equal(f.rows.length, 1); assert.equal(calls.filter(method => method === 'POST').length, 1);
  const replay = await client.decide({ staff: f.staff, cardId: f.cardId, input });
  assert.deepEqual(replay, saved); assert.equal(f.rows.length, 1);
});
