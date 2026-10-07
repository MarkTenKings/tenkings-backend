import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { webcrypto } from 'node:crypto';
import type { WorkflowCommandV2 } from '@tenkings/database';
import type { WorkflowView } from '../lib/inventoryWorkflow';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const Workspace = require('../components/admin/InventoryWorkflowWorkspace').default;
const { WorkflowStateV2, applyWorkflowEventV2, calculateWorkflowAllocationV2, replayWorkflowEventsV2, workflowPurchaseCancellationBlockV2 } = require('../../../packages/database/dist/database/src/inventoryWorkflowV2State');
const { workflowEventIdV2 } = require('../../../packages/database/dist/database/src/inventoryWorkflowV2');
const location = { id: '11111111-1111-4111-8111-111111111111', name: 'DISPOSABLE UI HQ', slug: 'fixture-hq' };
const initial: WorkflowView = { version: 2, lots: [], lots_total: 0, lot_offset: 0, selected_lot_id: null, batches: [], batches_total: 0, batch_offset: 0, selected_batch: null, reconciliation: null, units: [], events: [], events_total: 0, event_offset: 0, locations: [location], notice: 'Fixture test only: missing counts and costs stay unknown.' };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
async function until(check: () => boolean) { for (let i = 0; i < 100 && !check(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5))); assert.ok(check(), 'UI did not settle'); }
async function mount(fetcher: typeof fetch, saved?: unknown, waitForInitial = true) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://fixture.invalid/admin/physical-inventory', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  set('window', dom.window); set('document', dom.window.document); set('navigator', dom.window.navigator); set('sessionStorage', dom.window.sessionStorage); set('fetch', fetcher); set('crypto', webcrypto); set('IS_REACT_ACT_ENVIRONMENT', true);
  if (saved) sessionStorage.setItem('ten-kings:inventory-workflow:pending:fixture-admin', JSON.stringify(saved));
  const container = dom.window.document.getElementById('root') as HTMLElement, root = createRoot(container);
  await act(async () => root.render(<Workspace token="fixture-human-token" adminId="fixture-admin" />));
  if (waitForInitial) await until(() => !!container.textContent?.includes('Record an actual workflow step'));
  return { container, dom,
    async session(adminId: string, token: string) { await act(async () => root.render(<Workspace token={token} adminId={adminId} />)); },
    async input(label: string, value: string) { const wrapper = [...container.querySelectorAll('label')].find(l => l.firstChild?.textContent === label); assert.ok(wrapper, label); const node = wrapper.querySelector('input,select,textarea')!; await act(async () => Simulate.change(node, { target: { value } } as any)); },
    async check(text: string) { const wrapper = [...container.querySelectorAll('label')].find(l => l.textContent === text); assert.ok(wrapper, text); await act(async () => Simulate.change(wrapper.querySelector('input')!, { target: { checked: true } } as any)); },
    button(text: string) { const button = [...container.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(button, text); return button; },
    async click(text: string) { const button = this.button(text); assert.equal(button.disabled, false, text); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); },
    async submit() { await act(async () => this.button('Save evidenced workflow step').closest('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); },
    async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); },
  };
}
test('guided raw receipt saves through the source contract, preserves exact retry after an uncertain response and reloads roster', async () => {
  const state = new WorkflowStateV2(); let view = initial; const posts: string[] = [];
  const ui = await mount(async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fixture-human-token');
    if (init?.method !== 'POST') return json(view);
    posts.push(String(init.body)); const { command } = JSON.parse(String(init.body)) as { command: WorkflowCommandV2 };
    const previous = state.events.get(workflowEventIdV2(command.request_id));
    const event = previous ?? { schema_version: 2, source_event_id: workflowEventIdV2(command.request_id), source_sequence: 1, event_kind: command.event_kind, data: command.data, effective_at: command.effective_at, recorded_at: '2026-02-01T00:00:00.000Z', recorded_by: 'fixture-admin', evidence_ref: command.evidence_ref, currency: 'USD' };
    if (!previous) applyWorkflowEventV2(state, event);
    const receipt = [...state.lots.values()][0]; view = { ...initial, lots: [{ ...receipt.data, receipt_event_id: event.source_event_id, cost_authority_event_id: event.source_event_id, assignment_event_id: null, origin_kind: 'purchase_received', cancelled_event_id: null, cancellation_reason: null, cancellation_block_reason: null }], lots_total: 1, selected_lot_id: receipt.data.lot_id, units: [...state.units.values()], events: [event], events_total: 1 };
    if (posts.length === 1) throw new TypeError('Fixture response lost after acceptance');
    return json({ outcome: 'REPLAY', request_id: command.request_id, event, impact: null });
  });
  try {
    await ui.input('Record an actual workflow step', 'purchase_received');
    for (const [label, value] of [['Event time (UTC)', '2026-01-01T00:00:00.000Z'], ['Event evidence reference', 'fixture:receive'], ['New purchase lot ID', 'fixture-lot'], ['Acquisition cycle ID', 'fixture-cycle'], ['Received card quantity', '2'], ['Documented purchase total (USD)', '10.01'], ['Purchase / invoice evidence', 'fixture:invoice'], ['HQ custody identity', 'hq:fixture'], ['Existing Location', location.id]]) await ui.input(label, value);
    await ui.check('Create one permanent bookkeeping roster ID for each actual received card. These IDs do not create graded cards.');
    await ui.submit(); await until(() => posts.length === 1 && !!ui.container.textContent?.includes('exact submission is saved'));
    await ui.click('Retry exact saved submission'); await until(() => !!ui.container.textContent?.includes('Recovered accepted'));
    assert.equal(posts.length, 2); assert.equal(posts[0], posts[1]); assert.equal(state.units.size, 2); assert.ok([...state.units.values()].every((u: any) => u.cost === null)); assert.match(ui.container.textContent!, /Cost assignment unset/); assert.equal(sessionStorage.getItem('ten-kings:inventory-workflow:pending:fixture-admin'), null);
  } finally { await ui.close(); }
});
test('every guided control is available and allocation starts without a selected policy', async () => {
  let posts = 0; const ui = await mount(async (_url, init) => { if (init?.method === 'POST') posts++; return json(initial); });
  try {
    const select = [...ui.container.querySelectorAll('label')].find(l => l.firstChild?.textContent === 'Record an actual workflow step')!.querySelector('select')!;
    for (const kind of ['purchase_received', 'purchase_cancelled', 'opening_stock_recorded', 'purchase_cost_documented', 'cost_assigned', 'processed', 'packed', 'stock_corrected', 'reserved', 'price_set', 'custody_moved', 'batch_loaded', 'sale_observed', 'stock_counted', 'batch_removed', 'physical_return_observed', 'refund_observed', 'batch_reconciled']) assert.ok([...select.options].some(o => o.value === kind));
    await ui.input('Record an actual workflow step', 'cost_assigned');
    const policy = [...ui.container.querySelectorAll('label')].find(l => l.firstChild?.textContent === 'Explicit acquisition cost method')!.querySelector('select')!; assert.equal(policy.value, '');
    await ui.click('Preview causal impact'); assert.equal(posts, 0);
    await ui.input('Record an actual workflow step', 'opening_stock_recorded'); assert.match(ui.container.textContent!, /does not invent a prior HQ receipt/);
    await ui.input('Record an actual workflow step', 'sale_observed'); assert.match(ui.container.textContent!, /do not select individual sold cards/);
    await ui.input('Record an actual workflow step', 'refund_observed'); assert.match(ui.container.textContent!, /changes no physical stock/);
  } finally { await ui.close(); }
});

test('guided correction shows prior physical state, previews zero-write and recovers the exact saved correction after response loss', async () => {
  const events: any[] = [];
  const seed = (event_kind: string, data: unknown) => events.push({ schema_version: 2, source_event_id: 'fixture-correction-' + (events.length + 1), source_sequence: events.length + 1, event_kind, data, effective_at: '2026-01-01T00:00:00.000Z', recorded_at: '2026-02-01T00:00:00.000Z', recorded_by: 'fixture-admin', evidence_ref: 'fixture:physical-evidence', currency: 'USD' });
  seed('purchase_received', { lot_id: 'fixture-correction-lot', acquisition_cycle_id: 'fixture-correction-cycle', quantity: 1, total_cost_cents: 125, unknown_reason: null, purchase_evidence_ref: 'fixture:invoice', unit_ids: ['fixture-correction-unit'], custody: { custody_id: 'hq:fixture', location_id: location.id } });
  seed('processed', { unit_ids: ['fixture-correction-unit'], stage: 'processed', product_id: 'fixture-product', permanent_card_links: [] });
  seed('custody_moved', { unit_ids: ['fixture-correction-unit'], from_custody_id: 'hq:fixture', to: { custody_id: 'transit:wrong-entry', location_id: null }, movement: 'dispatch' });
  const currentView = () => { const state = replayWorkflowEventsV2(events); return { ...initial, units: [...state.units.values()], events: [...state.events.values()], events_total: events.length }; };
  const posts: Array<{ mode: string; command: WorkflowCommandV2 }> = []; let lost = false;
  const ui = await mount(async (_url, init) => {
    if (init?.method !== 'POST') return json(currentView());
    const submission = JSON.parse(String(init.body)) as { mode: string; command: WorkflowCommandV2 }; posts.push(submission);
    const { command, mode } = submission, prior = events.find(e => e.source_event_id === workflowEventIdV2(command.request_id));
    const event = prior ?? { schema_version: 2, source_event_id: workflowEventIdV2(command.request_id), source_sequence: events.length + 1, event_kind: command.event_kind, data: command.data, effective_at: command.effective_at, recorded_at: '2026-02-01T00:00:00.000Z', recorded_by: 'fixture-admin', evidence_ref: command.evidence_ref, currency: 'USD' };
    if (!prior) { replayWorkflowEventsV2([...events, event]); if (mode === 'record') events.push(event); }
    if (mode === 'record' && !lost) { lost = true; throw new Error('fixture lost response after commit'); }
    return json({ outcome: mode === 'preview' ? 'PREVIEW' : prior ? 'REPLAY' : 'RECORDED', request_id: command.request_id, event, impact: null });
  });
  try {
    await ui.click('Select entire roster'); await ui.input('Record an actual workflow step', 'stock_corrected');
    assert.match(ui.container.textContent!, /Current physical evidence: fixture-correction-3/);
    await ui.input('Physical fact to correct', 'custody');
    for (const [label, value] of [['Event time (UTC)', '2026-01-02T00:00:00.000Z'], ['Event evidence reference', 'fixture:verified-custody'], ['Holding correction reason', 'Delivery entry used the wrong custody.'], ['Correct current custody', 'hq:fixture'], ['Existing Location', location.id]]) await ui.input(label, value);
    await ui.click('Preview causal impact'); await until(() => !!ui.container.textContent?.includes('Preview passed causal replay')); assert.equal(events.length, 3);
    await ui.submit(); await until(() => !!ui.container.textContent?.includes('exact submission is saved')); assert.equal(events.length, 4);
    await ui.click('Retry exact saved submission'); await until(() => !!ui.container.textContent?.includes('Recovered accepted correct held stock'));
    assert.equal(events.length, 4); assert.deepEqual(posts[0].command, posts[1].command); assert.deepEqual(posts[1].command, posts[2].command);
    assert.deepEqual((posts[1].command.data as any).expected_states, [{ unit_id: 'fixture-correction-unit', state_event_id: 'fixture-correction-3' }]);
    assert.equal(replayWorkflowEventsV2(events).units.get('fixture-correction-unit').custody.custody_id, 'hq:fixture');
    assert.equal(sessionStorage.getItem('ten-kings:inventory-workflow:pending:fixture-admin'), null);
  } finally { await ui.close(); }
});
test('saved command is frozen through reload and a mismatched receipt cannot clear its retry evidence', async () => {
  const command = { request_id: 'fixture-saved-request', event_kind: 'price_set', effective_at: '2026-01-01T00:00:00.000Z', evidence_ref: 'fixture:price', data: { unit_ids: ['fixture-unit'], intended_sale_price_cents: 5000 } };
  const ui = await mount(async (_url, init) => init?.method === 'POST' ? json({ outcome: 'RECORDED', request_id: command.request_id, event: { schema_version: 2, ...command, source_event_id: 'wrong', source_sequence: 1, recorded_by: 'other-admin', currency: 'USD' }, impact: null }) : json(initial), { adminId: 'fixture-admin', command });
  try { await ui.click('Retry exact saved submission'); await until(() => !!ui.container.textContent?.includes('Acceptance could not be verified')); assert.ok(sessionStorage.getItem('ten-kings:inventory-workflow:pending:fixture-admin')); } finally { await ui.close(); }
});

test('old-session delayed reads cannot replace a new session or retain its previous admin retry', async () => {
  let releaseOld: (value: Response) => void = () => {}; let posts = 0;
  const saved = { adminId: 'fixture-admin', command: { request_id: 'fixture-old-pending', event_kind: 'price_set', effective_at: '2026-01-01T00:00:00.000Z', evidence_ref: 'fixture:price', data: { unit_ids: ['fixture-old-unit'], intended_sale_price_cents: 5000 } } };
  const ui = await mount(async (_url, init) => {
    if (init?.method === 'POST') { posts++; return json({}, 500); }
    if ((init?.headers as Record<string, string>).Authorization === 'Bearer fixture-human-token') return new Promise(resolve => { releaseOld = resolve; });
    return json({ ...initial, notice: 'CURRENT SECOND SESSION EVIDENCE' });
  }, saved, false);
  try {
    await ui.session('fixture-second-admin', 'fixture-second-token');
    await until(() => !!ui.container.textContent?.includes('CURRENT SECOND SESSION EVIDENCE'));
    assert.doesNotMatch(ui.container.textContent!, /Retry exact saved submission|Unresolved submission/);
    await act(async () => { releaseOld(json({ ...initial, notice: 'STALE FIRST SESSION EVIDENCE' })); });
    assert.match(ui.container.textContent!, /CURRENT SECOND SESSION EVIDENCE/); assert.doesNotMatch(ui.container.textContent!, /STALE FIRST SESSION EVIDENCE/);
    assert.ok(sessionStorage.getItem('ten-kings:inventory-workflow:pending:fixture-admin')); assert.equal(posts, 0);
  } finally { await ui.close(); }
});
test('a previous admin command stored under a different admin key cannot be retried', async () => {
  let posts = 0; const ui = await mount(async (_url, init) => { if (init?.method === 'POST') posts++; return json(initial); });
  try {
    sessionStorage.setItem('ten-kings:inventory-workflow:pending:fixture-second-admin', JSON.stringify({ adminId: 'fixture-admin', command: { request_id: 'fixture-old-request', event_kind: 'price_set' } }));
    await ui.session('fixture-second-admin', 'fixture-second-token'); await until(() => !!ui.container.textContent?.includes('Saved retry evidence could not be verified'));
    assert.doesNotMatch(ui.container.textContent!, /Retry exact saved submission/); assert.equal(posts, 0);
  } finally { await ui.close(); }
});
test('guided cancellation previews without mutation and saves the original receipt with no remaining holdings', async () => {
  const state = new WorkflowStateV2(), posts: Array<{ mode: string; command: WorkflowCommandV2 }> = [];
  const original = { schema_version: 2, source_event_id: workflowEventIdV2('fixture-ui-original'), source_sequence: 1, event_kind: 'purchase_received', effective_at: '2026-01-01T00:00:00.000Z', recorded_at: '2026-02-01T00:00:00.000Z', recorded_by: 'fixture-admin', evidence_ref: 'fixture:receipt', currency: 'USD', data: { lot_id: 'fixture-ui-cancel-lot', acquisition_cycle_id: 'fixture-ui-cancel-cycle', quantity: 2, total_cost_cents: 90, unknown_reason: null, purchase_evidence_ref: 'fixture:invoice', unit_ids: ['fixture-ui-cancel-a', 'fixture-ui-cancel-b'], custody: { custody_id: 'hq:fixture', location_id: location.id } } };
  applyWorkflowEventV2(state, original);
  const currentView = () => {
    const cancellation = state.cancellations.get(original.data.lot_id);
    return { ...initial, lots: [{ ...original.data, receipt_event_id: original.source_event_id, cost_authority_event_id: original.source_event_id, assignment_event_id: null, origin_kind: 'purchase_received', cancelled_event_id: cancellation?.source_event_id ?? null, cancellation_reason: cancellation?.data.reason ?? null, cancellation_block_reason: workflowPurchaseCancellationBlockV2(state, original.data.lot_id) }], lots_total: 1, selected_lot_id: original.data.lot_id, units: [...state.units.values()], events: [...state.events.values()], events_total: state.events.size };
  };
  const ui = await mount(async (_url, init) => {
    if (init?.method !== 'POST') return json(currentView());
    const submission = JSON.parse(String(init.body)) as { mode: string; command: WorkflowCommandV2 }; posts.push(submission);
    const { command, mode } = submission;
    const event = { schema_version: 2, source_event_id: workflowEventIdV2(command.request_id), source_sequence: state.events.size + 1, event_kind: command.event_kind, effective_at: command.effective_at, evidence_ref: command.evidence_ref, recorded_at: '2026-02-01T00:00:00.000Z', recorded_by: 'fixture-admin', currency: 'USD', data: command.data };
    if (mode === 'preview') replayWorkflowEventsV2([...state.events.values(), event]); else applyWorkflowEventV2(state, event);
    return json({ outcome: mode === 'preview' ? 'PREVIEW' : 'RECORDED', request_id: command.request_id, event, impact: { units: 0, lots: 1, batches: 0, backdated: false } });
  });
  try {
    await ui.input('Record an actual workflow step', 'purchase_cancelled');
    await ui.input('Event time (UTC)', '2026-01-02T00:00:00.000Z'); await ui.input('Event evidence reference', 'fixture:entry-correction'); await ui.input('Receipt cancellation reason', 'Invoice shows one card; two were entered.');
    await ui.click('Preview causal impact'); assert.equal(posts.length, 0);
    await ui.check('This is an erroneous unused receipt entry. Cancel its available holdings and preserve its original evidence and identities.');
    await ui.click('Preview causal impact'); await until(() => !!ui.container.textContent?.includes('Preview passed causal replay')); assert.equal(state.units.size, 2); assert.equal(posts.length, 1);
    await ui.submit(); await until(() => !!ui.container.textContent?.includes('Cancelled receipt entry · no available holdings'));
    assert.equal(state.units.size, 0); assert.equal(state.lots.size, 1); assert.equal(state.events.size, 2); assert.deepEqual(posts[0].command, posts[1].command);
    assert.equal(posts[1].command.event_kind, 'purchase_cancelled'); if (posts[1].command.event_kind === 'purchase_cancelled') assert.equal(posts[1].command.data.purchase_event_id, original.source_event_id);
    assert.equal(sessionStorage.getItem('ten-kings:inventory-workflow:pending:fixture-admin'), null);
  } finally { await ui.close(); }
});
