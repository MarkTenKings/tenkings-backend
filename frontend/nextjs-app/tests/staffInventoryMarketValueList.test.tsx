import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import type { StaffInventoryWorkspace as WorkspaceData } from '@tenkings/database';
import type { StaffInventoryMarketValueSummary as Summary } from '../lib/staffInventoryMarketValue';

const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const cssLoader = require.extensions['.css']; require.extensions['.css'] = module => { module.exports = {}; };
const panelPath = require.resolve('../components/admin/StaffInventoryResearchPanel'), savedPanel = require.cache[panelPath];
require.cache[panelPath] = { id: panelPath, filename: panelPath, loaded: true, exports: { __esModule: true,
  default: (props: { unitId: string; descriptionEventId: string }) => <div data-research-unit={props.unitId} data-description={props.descriptionEventId}>Existing research drawer</div> } } as NodeModule;
const capturePath = require.resolve('../components/admin/StaffInventoryCardCapture'), savedCapture = require.cache[capturePath];
require.cache[capturePath] = { id: capturePath, filename: capturePath, loaded: true, exports: { __esModule: true,
  default: (props: { open: boolean; onClose(): void }) => props.open ? <button onClick={props.onClose}>Close camera fixture</button> : null } } as NodeModule;
const Workspace = require('../components/admin/StaffInventoryWorkspace').default as typeof import('../components/admin/StaffInventoryWorkspace').default;
if (savedPanel) require.cache[panelPath] = savedPanel; else delete require.cache[panelPath];
if (savedCapture) require.cache[capturePath] = savedCapture; else delete require.cache[capturePath];
if (cssLoader) require.extensions['.css'] = cssLoader; else delete require.extensions['.css'];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const metrics = { cost_cents: 100, expected_sales_cents: 200, expected_profit_cents: 100, expected_margin_pct: 50, costed_units: 1, priced_units: 1, known_cost_subtotal_cents: 100, value_overflow: false };
function card(id: string, overrides: Partial<WorkspaceData['items'][number]> = {}): WorkspaceData['items'][number] {
  return { id, lot_id: `lot-${id}`, name: `Card ${id}`, category: 'Pokémon', notes: '', photo_key: null, back_photo_key: null,
    card_details: null, planned_sales_channel: 'eBay', location_id: 'hq', location_name: 'HQ', custody_id: 'hq:fixture', batch_id: null,
    machine_scope: null, last_count: null, stage: 'unprocessed', product_id: null, quantity: 1, quantity_kind: 'on_hand',
    expected_price_cents: 200, ...metrics, unit_ids: [id], units: [{ id, number: 1, cost_cents: 100, expected_price_cents: 200,
      permanent_card_id: null, pack_id: null, planned_location_name: null }], receipt_quantity: 1, purchase_total_cents: 100,
    created_at: '2026-01-01T00:00:00.000Z', origin: 'existing',
    provenance: { receipt: `receipt-${id}`, description: `description-${id}`, cost: null, price: null, custody: 'custody' }, ...overrides };
}
function workspace(items: WorkspaceData['items']): WorkspaceData {
  return { version: 1, sequence: 0, items, locations: [], machines: [], products: [],
    totals: { on_hand: items.length, machine_roster: 0, groups: items.length, locations: 1, ...metrics }, updated_at: null };
}
function summary(id: string, status: Summary['status'] = 'estimated', overrides: Partial<Summary> = {}): Summary {
  return { unit_id: id, description_event_id: `description-${id}`, status,
    value_cents: status === 'estimated' ? 1234 : null, low_cents: status === 'estimated' ? 1200 : null, high_cents: status === 'estimated' ? 1268 : null,
    comp_count: status === 'estimated' ? 2 : 0, researched_at: status === 'estimated' || status === 'unknown' ? '2026-01-02T00:00:00.000Z' : null,
    reason: 'Fixture research evidence.', ...overrides };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function mount(fetcher: typeof fetch, pending?: unknown) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://fixture.invalid/staff/inventory', pretendToBeVisual: true });
  Object.defineProperties(dom.window.HTMLElement.prototype, { attachEvent: { configurable: true, value() {} }, detachEvent: { configurable: true, value() {} } });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  set('window', dom.window); set('self', dom.window); set('document', dom.window.document); set('navigator', dom.window.navigator);
  set('sessionStorage', dom.window.sessionStorage); set('fetch', fetcher); set('crypto', webcrypto); set('IS_REACT_ACT_ENVIRONMENT', true);
  const intervals: (() => void)[] = [];
  set('setInterval', (callback: () => void) => { intervals.push(callback); return intervals.length; }); set('clearInterval', () => {});
  const pendingTimers: (() => void)[] = [], timeout = globalThis.setTimeout;
  set('setTimeout', (callback: () => void, delay?: number) => { if (delay === 30000) { pendingTimers.push(callback); return 999999; } return timeout(callback, delay); });
  if (pending) sessionStorage.setItem('tenkings:staff-inventory:pending:actor-a', JSON.stringify(pending));
  const container = document.getElementById('root')!, root = createRoot(container);
  const render = async (token = 'token-a', adminId = 'actor-a') => { await act(async () => root.render(<Workspace token={token} adminId={adminId} onAdvanced={() => {}} />)); };
  await render();
  return { container, render, intervals, pendingTimers,
    cell(id: string) { const row = [...container.querySelectorAll('tbody tr')].find(row => row.querySelector('strong')?.textContent === `Card ${id}`); assert.ok(row); return row.querySelector<HTMLElement>('[data-label="eBay comp value"]')!; },
    async click(label: string) { const button = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label); assert.ok(button, `Missing ${label}`); await act(async () => button.click()); },
    async hidden(value: boolean) { await act(async () => { Object.defineProperty(document, 'hidden', { configurable: true, value }); document.dispatchEvent(new dom.window.Event('visibilitychange')); }); },
    async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); },
  };
}

test('mixed saved states are separate from manual financial totals and open exact accessible research', async () => {
  const items = ['estimated', 'queued', 'running', 'unknown', 'failed', 'none', 'stale'].map(id => card(id));
  items.push(card('batch', { receipt_quantity: 5, quantity: 5, unit_ids: ['batch-1', 'batch-2'] }));
  const response = deferred<Response>(), urls: string[] = [];
  const ui = await mount(async (url, init) => { assert.notEqual(init?.method, 'POST'); urls.push(String(url)); return String(url).includes('view=summary') ? response.promise : json(workspace(items)); });
  try {
    assert.ok(ui.container.textContent?.includes('All inventory')); assert.equal(ui.cell('estimated').textContent, 'Checking value…Review research');
    assert.equal(urls.length, 2); const query = new URL(urls[1], 'https://fixture.invalid').searchParams;
    assert.equal(query.getAll('unit_id').length, 7); assert.equal(query.has('unit_id', 'batch-1'), false);
    await act(async () => response.resolve(json({ version: 1, summaries: [summary('estimated'), summary('queued', 'queued'), summary('running', 'running'), summary('unknown', 'unknown'), summary('failed', 'failed'), summary('stale', 'estimated', { description_event_id: 'old-description' })] })));
    assert.equal(ui.cell('estimated').textContent, '$12.342 comps · Review');
    for (const [id, label] of [['queued', 'Queued'], ['running', 'Researching…'], ['unknown', 'More evidence needed'], ['failed', 'Unavailable'], ['none', 'Not researched'], ['stale', 'Unavailable'], ['batch', 'Individual card research']]) assert.ok(ui.cell(id).textContent?.startsWith(label));
    assert.equal(ui.cell('batch').querySelector('button'), null); assert.equal(ui.container.textContent?.includes('$0.00'), false);
    const row = ui.cell('estimated').parentElement!;
    assert.ok(row.querySelector('[data-label="Expected sale / card"]')?.textContent?.startsWith('$2.00'));
    assert.ok(row.querySelector('[data-label="Expected profit"]')?.textContent?.startsWith('$1.00'));
    await ui.click('Review eBay comps for Card estimated: $12.34');
    assert.equal(ui.container.querySelector('[data-research-unit]')?.getAttribute('data-research-unit'), 'estimated');
    assert.equal(ui.container.querySelector('[data-research-unit]')?.getAttribute('data-description'), 'description-estimated');
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'Card research');
  } finally { await ui.close(); }
});

test('sequential summary chunks obey both 50-card and encoded URL bounds without per-row full reads', async () => {
  const cards = [...Array.from({ length: 105 }, (_, i) => card(`u-${i}`)), ...Array.from({ length: 12 }, (_, i) => card(`${'人'.repeat(110)}-${i}`))];
  const requests: { url: string; pending: ReturnType<typeof deferred<Response>> }[] = [];
  const ui = await mount(async url => { if (!String(url).includes('view=summary')) return json(workspace(cards)); const pending = deferred<Response>(); requests.push({ url: String(url), pending }); return pending.promise; });
  try {
    assert.equal(requests.length, 1);
    const received: string[] = [];
    for (let index = 0; received.length < cards.length; index++) {
      assert.equal(requests.length, index + 1, 'Only one chunk may be outstanding');
      const request = requests[index], ids = new URL(request.url, 'https://fixture.invalid').searchParams.getAll('unit_id');
      assert.ok(ids.length > 0 && ids.length <= 50); assert.ok(request.url.length < 6000); received.push(...ids);
      await act(async () => request.pending.resolve(json({ version: 1, summaries: [] })));
    }
    assert.equal(new Set(received).size, cards.length); assert.deepEqual(new Set(received), new Set(cards.map(card => card.unit_ids[0])));
  } finally { await ui.close(); }
});

test('add/capture, hidden document and Locations pause reads, abort pending work and ignore late replies', async () => {
  const requests: { pending: ReturnType<typeof deferred<Response>>; signal: AbortSignal }[] = [];
  const ui = await mount(async (url, init) => { if (!String(url).includes('view=summary')) return json(workspace([card('one')])); const pending = deferred<Response>(); requests.push({ pending, signal: init!.signal! }); return pending.promise; });
  try {
    assert.equal(requests.length, 1); await ui.click('Add inventory'); assert.equal(requests[0].signal.aborted, true);
    await ui.click('Take photo'); assert.equal(requests.length, 1); await ui.click('Close camera fixture');
    await act(async () => requests[0].pending.resolve(json({ version: 1, summaries: [summary('one')] })));
    assert.equal(requests.length, 1); assert.equal(ui.cell('one').textContent?.includes('$12.34'), false);
    await ui.click('Cancel'); assert.equal(requests.length, 2);
    await ui.hidden(true); assert.equal(requests[1].signal.aborted, true);
    await act(async () => requests[1].pending.resolve(json({ version: 1, summaries: [summary('one')] })));
    await ui.hidden(false); assert.equal(requests.length, 3);
    await ui.click('Locations'); assert.equal(requests[2].signal.aborted, true);
    await act(async () => requests[2].pending.resolve(json({ version: 1, summaries: [summary('one')] })));
    assert.equal(requests.length, 3); await ui.click('Inventory'); assert.equal(requests.length, 4);
    await act(async () => requests[3].pending.resolve(json({ version: 1, summaries: [] })));
    assert.ok(ui.cell('one').textContent?.startsWith('Not researched'));
  } finally { await ui.close(); }
});

test('a restored uncertain write prevents list research reads', async () => {
  const calls: string[] = [];
  const ui = await mount(async url => { calls.push(String(url)); return json(workspace([card('one')])); }, { actor: 'actor-a', command: { request_id: 'pending-fixture', action: 'add' } });
  try { assert.equal(calls.length, 1); assert.ok(ui.container.textContent?.includes('Finish your last save')); }
  finally { await ui.close(); }
});

test('revision and session changes reject stale workspace and summary responses', async () => {
  let current = workspace([card('one')]); const summaries: { pending: ReturnType<typeof deferred<Response>>; signal: AbortSignal; auth: string }[] = [];
  const oldWorkspace = deferred<Response>(); let delayWorkspace = false;
  const ui = await mount(async (url, init) => {
    if (!String(url).includes('view=summary')) return delayWorkspace && (init?.headers as Record<string, string>).Authorization === 'Bearer token-a' ? oldWorkspace.promise : json(current);
    const pending = deferred<Response>(); summaries.push({ pending, signal: init!.signal!, auth: (init?.headers as Record<string, string>).Authorization }); return pending.promise;
  });
  try {
    current = workspace([card('one', { provenance: { ...card('one').provenance, description: 'new-description' } })]);
    await ui.click('Refresh inventory'); assert.equal(summaries[0].signal.aborted, true);
    await act(async () => summaries[0].pending.resolve(json({ version: 1, summaries: [summary('one')] })));
    const latest = summaries.at(-1)!;
    await act(async () => latest.pending.resolve(json({ version: 1, summaries: [summary('one', 'estimated', { description_event_id: 'new-description', value_cents: 1250 })] })));
    assert.ok(ui.cell('one').textContent?.startsWith('$12.50'));
    delayWorkspace = true; await ui.click('Refresh inventory'); const previous = summaries.at(-1)!;
    current = workspace([card('two')]); await ui.render('token-b', 'actor-b');
    assert.equal(previous.signal.aborted, true); assert.equal(summaries.at(-1)!.auth, 'Bearer token-b');
    await act(async () => { oldWorkspace.resolve(json(workspace([card('old-account')]))); previous.pending.resolve(json({ version: 1, summaries: [summary('one')] })); });
    assert.equal(ui.container.textContent?.includes('Card old-account'), false); assert.equal(ui.container.textContent?.includes('Card one'), false);
    await act(async () => summaries.at(-1)!.pending.resolve(json({ version: 1, summaries: [summary('two')] })));
    assert.ok(ui.cell('two').textContent?.startsWith('$12.34'));
  } finally { await ui.close(); }
});

test('completed summaries skip workspace polling and refresh only on deliberate refresh or drawer close', async () => {
  let reads = 0;
  const ui = await mount(async url => String(url).includes('view=summary') ? (reads++, json({ version: 1, summaries: [summary('one')] })) : json(workspace([card('one')])));
  try {
    assert.equal(reads, 1);
    for (let i = 0; i < 3; i++) await act(async () => ui.intervals.at(-1)!());
    assert.equal(reads, 1);
    await ui.click('Refresh inventory'); assert.equal(reads, 2);
    await ui.click('Review eBay comps for Card one: $12.34'); assert.equal(reads, 2);
    await ui.click('Close inventory details'); assert.equal(reads, 3);
  } finally { await ui.close(); }
});

test('queued and running summaries refresh in one 30-second batch, then stop after completion', async () => {
  const batches: string[][] = [];
  const ui = await mount(async url => {
    if (!String(url).includes('view=summary')) return json(workspace([card('one'), card('two'), card('done')]));
    const ids = new URL(String(url), 'https://fixture.invalid').searchParams.getAll('unit_id'); batches.push(ids);
    return json({ version: 1, summaries: ids.map(id => summary(id, batches.length === 1 && id !== 'done' ? id === 'one' ? 'queued' : 'running' : 'estimated')) });
  });
  const originalNow = Date.now;
  try {
    assert.equal(ui.pendingTimers.length, 1); Date.now = () => originalNow() + 31000;
    await act(async () => ui.pendingTimers[0]());
    assert.deepEqual(batches, [['one', 'two', 'done'], ['one', 'two']]); assert.equal(ui.pendingTimers.length, 1);
    assert.ok(ui.cell('one').textContent?.startsWith('$12.34')); assert.ok(ui.cell('two').textContent?.startsWith('$12.34'));
  } finally { Date.now = originalNow; await ui.close(); }
});

test('malformed and failed summary reads remain unavailable without zeroes, provider requests or automatic retries', async () => {
  let reads = 0;
  const ui = await mount(async (url, init) => {
    assert.notEqual(init?.method, 'POST');
    if (!String(url).includes('view=summary')) return json(workspace([card('one')]));
    reads++; return reads === 1 ? json({ version: 1, summaries: [summary('one', 'estimated', { value_cents: 0 })] }) : json({ message: 'Unavailable' }, 503);
  });
  try {
    assert.ok(ui.cell('one').textContent?.startsWith('Unavailable')); assert.equal(ui.container.textContent?.includes('$0.00'), false);
    await act(async () => ui.intervals.at(-1)!()); assert.equal(reads, 1);
    await ui.click('Refresh inventory'); assert.equal(reads, 2); assert.ok(ui.cell('one').textContent?.startsWith('Unavailable'));
  } finally { await ui.close(); }
});
