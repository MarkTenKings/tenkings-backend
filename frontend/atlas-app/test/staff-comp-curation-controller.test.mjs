import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStaffCompCurationController } from '../lib/staff-comp-curation-controller.mjs';
import { httpFixture, realSavedV2, deferred, jsonResponse } from './staff-comp-curation-fixture.mjs';
const make = (f, extra = {}) => createStaffCompCurationController({ staff: f.staff, cardId: f.cardId, input: f.readInput, request: f.request, ...extra });
const selection = f => ({ requestId: randomUUID(), outcome: 'SELECTED', selectedIds: f.preview.candidates.map(c => c.sale.id), reviewedIds: f.preview.candidates.map(c => c.sale.id) });

test('read then explicit selected/Skip/No suitable decisions keep grade/report/asking price separate', async () => {
  const f = await httpFixture(), controller = make(f); assert.equal(f.exchanges.length, 0);
  await controller.load(); assert.equal(controller.snapshot().phase, 'READY');
  const saved = await controller.decide(selection(f)); assert.equal(saved.guidance.meanMinor, 2000); assert.equal(saved.guidance.askingPriceMinor, null);
  assert.equal(controller.snapshot().phase, 'CONFIRMED'); assert.equal(f.calls.insert, 1);
  for (const outcome of ['SKIP', 'NO_SUITABLE_COMPS']) {
    await controller.load(); await controller.decide({ requestId: randomUUID(), outcome });
    assert.equal(controller.snapshot().receipt.guidance, null);
  }
  assert.equal(f.calls.insert, 3); assert.equal(f.row.state, 'PUBLISHED');
});
test('lost committed reply reconciles via GET only; identical-looking newer decision cannot prove prior request', async () => {
  const f = await httpFixture(), controller = make(f); await controller.load(); const decision = selection(f);
  f.hooks.response = ({ method }) => { if (method === 'POST') throw new Error('lost response after commit'); };
  await controller.decide(decision); assert.equal(controller.snapshot().phase, 'UNRESOLVED'); assert.equal(f.calls.insert, 1);
  await assert.rejects(controller.decide(selection(f)), { code: 'COMP_RECONCILE_REQUIRED' });
  await controller.reconcile(); assert.equal(controller.snapshot().phase, 'CONFIRMED'); assert.equal(f.calls.insert, 1);
  assert.deepEqual(f.exchanges.map(x => x.method), ['GET', 'POST', 'GET']);
  // A second unknown decision is followed by a different stored request with
  // exactly the same selected facts. Latest-value equality is not recovery.
  await controller.load(); await controller.decide(selection(f)); assert.equal(f.calls.insert, 2);
  await f.service.decide(f.staff, f.cardId, f.input()); assert.equal(f.calls.insert, 3);
  await controller.reconcile(); assert.equal(controller.snapshot().phase, 'UNRESOLVED'); assert.equal(controller.snapshot().receipt, null);
  const pendingId = controller.snapshot().pending.requestId; delete f.hooks.response;
  const recovered = await controller.retry(); assert.equal(recovered.requestId, pendingId); assert.equal(recovered.revision, 2);
  assert.equal(f.calls.insert, 3); assert.equal(controller.snapshot().phase, 'CONFIRMED');
});
test('no current receipt does not prove failed save; explicit retry uses exact original request once', async () => {
  const f = await httpFixture(); let fail = true;
  const controller = make(f, { request: async req => { if (req.method === 'POST' && fail) { fail = false; throw new Error('before request reached handler'); } return f.request(req); } });
  await controller.load(); const decision = selection(f); await controller.decide(decision); assert.equal(f.calls.insert, 0);
  await controller.reconcile(); assert.equal(controller.snapshot().phase, 'UNRESOLVED');
  await controller.retry(); assert.equal(f.calls.insert, 1); assert.equal(controller.snapshot().receipt.requestId, decision.requestId);
});
test('changed approval/source or revision cannot rewrite pending request; stale read clears display', async () => {
  const f = await httpFixture(), controller = make(f); await controller.load();
  f.hooks.response = ({ method }) => { if (method === 'POST') throw new Error('lost reply'); };
  await controller.decide(selection(f)); const id = controller.snapshot().pending.requestId;
  f.row.state = 'PENDING'; await controller.reconcile(); assert.equal(controller.snapshot().phase, 'UNRESOLVED'); assert.equal(controller.snapshot().state, null);
  await controller.retry(); assert.equal(controller.snapshot().pending.requestId, id); assert.equal(f.calls.insert, 1);
  assert.equal(controller.snapshot().phase, 'UNRESOLVED');
});
test('exact immutable receipt reconciliation rejects changed actor/source/policy/revision/facts', async () => {
  for (const change of [v => { v.result.selection.actorId = randomUUID(); }, v => { v.result.selection.source.requestHash = 'e'.repeat(64); },
    v => { v.result.selection.policyHash = 'e'.repeat(64); }, v => { v.result.selection.binding.reportHash = 'e'.repeat(64); },
    v => { v.result.selection.revision++; v.result.revision++; }]) {
    const f = await httpFixture(); let alter = false;
    const controller = make(f, { request: async req => { const response = await f.request(req); if (alter && req.method === 'GET') {
      const value = await response.json(); change(value); return jsonResponse(value); } return response; } });
    await controller.load(); f.hooks.response = ({ method }) => { if (method === 'POST') throw new Error('lost response'); };
    await controller.decide(selection(f)); alter = true; await controller.reconcile(); assert.equal(controller.snapshot().phase, 'UNRESOLVED'); assert.equal(f.calls.insert, 1);
  }
});
test('actual saved v2 missing graded designation cannot dispatch; raw evidence remains a separate group', async () => {
  const f = await httpFixture(); realSavedV2(f); const controller = make(f); await controller.load();
  const graded = controller.snapshot().state.preview.candidates.find(c => !c.raw), raw = controller.snapshot().state.preview.candidates.find(c => c.raw);
  await assert.rejects(controller.decide({ requestId: randomUUID(), outcome: 'SELECTED', selectedIds: [graded.id], reviewedIds: [graded.id] }), { code: 'COMP_SELECTION_INELIGIBLE' });
  assert.equal(f.calls.insert, 0); assert.equal(f.exchanges.length, 1);
  await controller.decide({ requestId: randomUUID(), outcome: 'SELECTED', selectedIds: [raw.id], reviewedIds: [raw.id] });
  assert.equal(controller.snapshot().receipt.guidance.group, 'RAW / condition unverified');
});
test('401/403 clear private data and pending request; same-ID new account object and logout cancel late replies', async () => {
  for (const status of [401, 403]) {
    const f = await httpFixture(); let accessLost = 0, deny = false;
    const controller = make(f, { onAccessLost: () => accessLost++, request: req => deny ? Promise.resolve(jsonResponse({ error: 'ended' }, status)) : f.request(req) });
    await controller.load(); deny = true; await controller.decide(selection(f));
    assert.deepEqual(controller.snapshot(), { phase: 'ENDED', state: null, receipt: null, pending: null, error: null }); assert.equal(accessLost, 1);
  }
  for (const end of [c => c.dispose(), (c, f) => c.assertScope({ ...f.staff })]) {
    const f = await httpFixture(), waiting = deferred(), entered = deferred();
    const controller = make(f, { request: req => { entered.resolve(); return waiting.promise.then(() => f.request(req)); } });
    const load = controller.load(); await entered.promise; end(controller, f); await load;
    waiting.resolve(); await new Promise(resolve => setImmediate(resolve)); assert.equal(controller.snapshot().phase, 'ENDED'); assert.equal(controller.snapshot().state, null);
  }
});
test('disabled adapter makes no call; overlapping actions refuse and access loss cannot restart controller', async () => {
  const f = await httpFixture(), disabled = make(f, { request: undefined }); assert.equal(disabled.snapshot().phase, 'DISABLED'); assert.equal(f.exchanges.length, 0);
  await assert.rejects(disabled.load(), { code: 'COMP_NOT_CONFIGURED' }); assert.equal(disabled.snapshot().phase, 'DISABLED');
  const waiting = deferred(), entered = deferred(), controller = make(f, { request: () => { entered.resolve(); return waiting.promise; } });
  const load = controller.load(); await entered.promise; await assert.rejects(controller.load(), { code: 'COMP_BUSY' });
  controller.dispose(); await load; await assert.rejects(controller.load(), { code: 'COMP_ACCESS_ENDED' });
  const changed = make(f); f.staff.role = 'OBSERVER'; assert.equal(changed.assertScope(f.staff), false); assert.equal(changed.snapshot().phase, 'ENDED');
});
