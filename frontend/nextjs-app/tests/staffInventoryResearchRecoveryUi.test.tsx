import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { bindStaffInventoryResearchRecovery, staffInventoryRecoveryDisplay, summarizeStaffInventoryResearchMarketValue } from '../lib/staffInventoryMarketValue';
import { recoveryJob, recoverySnapshot } from './fixtures/staffInventoryResearchRecovery';
import { marketJob, marketReview } from './fixtures/staffInventoryMarketValue';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const priorCss = require.extensions['.css']; require.extensions['.css'] = module => { module.exports = {}; };
const Recovery = require('../components/admin/StaffInventoryResearchRecovery').default as typeof import('../components/admin/StaffInventoryResearchRecovery').default;
const Panel = require('../components/admin/StaffInventoryResearchPanel').default as typeof import('../components/admin/StaffInventoryResearchPanel').default;
if (priorCss) require.extensions['.css'] = priorCss; else delete require.extensions['.css'];

async function mount(view: React.ReactElement, fetchImpl: typeof fetch = async () => assert.fail('Recovery display cannot make requests')) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/' });
  const timers: (() => void)[] = [], originalTimeout = globalThis.setTimeout;
  const values: Record<string, unknown> = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, fetch: fetchImpl, IS_REACT_ACT_ENVIRONMENT: true,
    setTimeout: (callback: () => void, delay?: number) => { if (delay === 15000) { timers.push(callback); return 989898; } return originalTimeout(callback, delay); } };
  const before = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  const container = document.getElementById('root')!, root = createRoot(container);
  await act(async () => root.render(view));
  return { container, timers, async render(next: React.ReactElement) { await act(async () => root.render(next)); }, async close() {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of before) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  } };
}
function readBody(snapshot: unknown, enabled: unknown = true) {
  const job = recoveryJob(), review = marketReview(job);
  return { version: 1, recovery_enabled: enabled, jobs: [{ ...job, result_hash: review.result_hash, review, recovery: snapshot }], image_previews: {} };
}
const panelProps = { unitId: 'fixture-unit', descriptionEventId: 'workflow:fixture', token: 'fixture-session', actorId: 'fixture-admin' };

test('recovery bindings reject another job, unit, description or input and never invent a missing snapshot', () => {
  const job = recoveryJob(), snapshot = recoverySnapshot();
  assert.equal(bindStaffInventoryResearchRecovery(null, job), null);
  assert.deepEqual(bindStaffInventoryResearchRecovery(snapshot, job), snapshot);
  for (const patch of [{ job_id: '22222222-2222-4222-8222-222222222222' }, { unit_id: 'other' }, { description_event_id: 'other' }, { input_hash: 'f'.repeat(64) }]) assert.throws(() => bindStaffInventoryResearchRecovery({ ...snapshot, ...patch }, job));
});

test('only enabled queued/checking recovery is active; parked evidence does not start a polling loop', () => {
  for (const status of ['pending', 'checking_details', 'research_queued'] as const) {
    assert.equal(staffInventoryRecoveryDisplay(recoverySnapshot({ status }), true).active, true);
    assert.deepEqual(staffInventoryRecoveryDisplay(recoverySnapshot({ status }), false), { label: 'Automatic checks paused', active: false, paused: true });
  }
  for (const status of ['waiting_catalog_evidence', 'needs_staff_review', 'waiting_new_evidence', 'resolved', 'limit_reached'] as const) assert.equal(staffInventoryRecoveryDisplay(recoverySnapshot({ status }), true).active, false);
});

test('a recovery proposal cannot alter an estimated value or create a value for an unknown result', () => {
  const estimated = marketJob(), unknown = recoveryJob(), snapshot = recoverySnapshot();
  assert.deepEqual(summarizeStaffInventoryResearchMarketValue({ ...estimated, recovery: snapshot }, true), summarizeStaffInventoryResearchMarketValue(estimated));
  const summary = summarizeStaffInventoryResearchMarketValue({ ...unknown, recovery: snapshot }, true);
  assert.equal(summary.value_cents, null); assert.equal(summary.comp_count, 0); assert.match(summary.reason, /Waiting for catalog evidence/);
});

test('missing fields and suggestions are explicit; canonical edit opens without changing facts or sending requests', async () => {
  const snapshot = recoverySnapshot({ status: 'needs_staff_review', conflicts: [{ field: 'card_number', saved_value: '008', suggested_value: '007', evidence: 'The front number reads 007.' }] });
  const before = JSON.stringify(snapshot); let edited = 0;
  const ui = await mount(<Recovery snapshot={snapshot} enabled onEditDetails={() => edited++} />);
  try {
    assert.match(ui.container.textContent!, /Details need staff review/); assert.match(ui.container.textContent!, /Still missing: Year/);
    assert.match(ui.container.textContent!, /Photo suggestions · not saved to inventory/); assert.match(ui.container.textContent!, /Suggested: 2024/);
    assert.match(ui.container.textContent!, /Saved: 008/); assert.match(ui.container.textContent!, /Suggested: 007/); assert.match(ui.container.textContent!, /front number reads 007/);
    assert.match(ui.container.textContent!, /Last checked/); assert.match(ui.container.textContent!, /does not guarantee a new search or a value/);
    await act(async () => ui.container.querySelector('button')!.click()); assert.equal(edited, 1); assert.equal(JSON.stringify(snapshot), before);
  } finally { await ui.close(); }
});

test('disabled recovery preserves the last outcome but does not promise an automatic next check', async () => {
  const ui = await mount(<Recovery snapshot={recoverySnapshot({ status: 'checking_details' })} enabled={false} />);
  try {
    assert.match(ui.container.textContent!, /Automatic checks paused/); assert.match(ui.container.textContent!, /Last checked/);
    assert.doesNotMatch(ui.container.textContent!, /Next eligible evidence check|background check continues/);
  } finally { await ui.close(); }
});

test('catalog-only blockers show exact needs and the existing review route without asking to edit complete details', async () => {
  let edits = 0;
  const snapshot = recoverySnapshot({ missing_fields: [], added_fields: [], proposal: null,
    need_codes: ['MISSING_CATALOG_REFERENCE', 'MISSING_DIAGNOSTIC_EVIDENCE', 'AMBIGUOUS_CATALOG_IDENTITY'] });
  const ui = await mount(<Recovery snapshot={snapshot} enabled onEditDetails={() => edits++} />);
  try {
    assert.match(ui.container.textContent!, /No reviewed catalog reference matches this card identity/);
    assert.match(ui.container.textContent!, /does not yet distinguish this printing or finish/);
    assert.match(ui.container.textContent!, /More than one catalog identity remains plausible/);
    assert.doesNotMatch(ui.container.textContent!, /Review in Edit details|Use Edit details|Still missing:/);
    assert.equal(ui.container.querySelector('a')!.href, 'https://collect.tenkings.co/admin/set-ops-review');
    assert.match(ui.container.textContent!, /authenticated review and publication/); assert.match(ui.container.textContent!, /does not block automatic eBay searches/); assert.equal(edits, 0);
  } finally { await ui.close(); }
});

test('photo-only recovery needs do not send staff into catalog review', async () => {
  const ui = await mount(<Recovery snapshot={recoverySnapshot({ status: 'needs_staff_review', need_codes: ['MISSING_IDENTITY_FIELDS', 'DESCRIPTION_CONFLICT', 'RECOGNITION_FAILED'] })} enabled />);
  try {
    assert.match(ui.container.textContent!, /Required card details are still missing/);
    assert.match(ui.container.textContent!, /photo recognition attempt did not complete/);
    assert.equal(ui.container.querySelector('a'), null);
  } finally { await ui.close(); }
});

test('source suggestions remain bounded unreviewed links, never imports or card evidence', async () => {
  const source_discovery = { status: 'candidates' as const, candidates: [{ title: 'Fixture Chrome checklist', url: 'https://www.topps.com/fixture-chrome', domain: 'www.topps.com', provider: 'bing_rss' as const }] };
  const ui = await mount(<Recovery snapshot={recoverySnapshot({ source_discovery })} enabled />);
  try {
    assert.match(ui.container.textContent!, /Unreviewed source suggestions/); assert.match(ui.container.textContent!, /has not fetched or approved these pages/);
    const source = ui.container.querySelector('a')!; assert.equal(source.href, source_discovery.candidates[0].url);
    assert.equal(source.target, '_blank'); assert.equal(source.rel, 'noopener noreferrer'); assert.match(ui.container.textContent!, /www.topps.com/);
  } finally { await ui.close(); }
  for (const url of ['javascript:alert(1)', 'https://example.invalid/checklist', 'https://topps.com.evil.invalid/checklist', 'https://www.topps.com/fixture?q=private']) {
    assert.throws(() => bindStaffInventoryResearchRecovery({ ...recoverySnapshot(), source_discovery: { ...source_discovery, candidates: [{ ...source_discovery.candidates[0], url }] } }, recoveryJob()));
  }
  assert.throws(() => bindStaffInventoryResearchRecovery({ ...recoverySnapshot(), source_discovery: { ...source_discovery, candidates: Array(4).fill(source_discovery.candidates[0]) } }, recoveryJob()));
});

test('source-search failure and no-links receipts preserve their distinct outcomes', async () => {
  for (const status of ['not_found', 'unavailable'] as const) {
    const ui = await mount(<Recovery snapshot={recoverySnapshot({ source_discovery: { status, candidates: [] } })} enabled />);
    try {
      assert.match(ui.container.textContent!, status === 'not_found' ? /found no usable review links/ : /unavailable during the last check/);
      assert.equal(ui.container.querySelectorAll('a').length, 1, 'Only existing catalog review navigation is shown');
    } finally { await ui.close(); }
  }
});

test('Panel displays recovery through authenticated GET only and passes review to the existing edit action', async () => {
  let calls = 0, edited = 0;
  const ui = await mount(<Panel {...panelProps} onEditDetails={() => edited++} />, async (_url, init) => {
    calls++; assert.equal(init?.method, undefined); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-session');
    return Response.json(readBody(recoverySnapshot({ status: 'needs_staff_review' })));
  });
  try {
    assert.match(ui.container.textContent!, /Details need staff review/); assert.match(ui.container.textContent!, /More evidence needed/);
    const edit = [...ui.container.querySelectorAll('button')].find(button => button.textContent === 'Review in Edit details')!;
    assert.ok(edit); await act(async () => edit.click()); assert.equal(edited, 1); assert.equal(calls, 1);
    assert.doesNotMatch(ui.container.textContent!, /\$0\.00/);
  } finally { await ui.close(); }
});

test('Panel rejects malformed or foreign recovery and malformed execution flags without exposing proposals', async () => {
  for (const body of [readBody({ ...recoverySnapshot(), input_hash: 'f'.repeat(64) }), readBody({ ...recoverySnapshot(), status: 'approved' }), readBody(recoverySnapshot(), 'true')]) {
    const ui = await mount(<Panel {...panelProps} />, async () => Response.json(body));
    try { assert.match(ui.container.textContent!, /Research is temporarily unavailable/); assert.doesNotMatch(ui.container.textContent!, /Photo suggestions|Suggested: 2024/); }
    finally { await ui.close(); }
  }
});

test('a late prior-session recovery response cannot replace the current account view', async () => {
  let finish: ((response: Response) => void) | undefined;
  const ui = await mount(<Panel {...panelProps} />, async (_url, init) => new Headers(init?.headers).get('Authorization') === 'Bearer fixture-session'
    ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json({ version: 1, recovery_enabled: true, jobs: [], image_previews: {} }));
  try {
    await ui.render(<Panel {...panelProps} token="other-session" actorId="other-admin" />);
    await act(async () => finish!(Response.json(readBody(recoverySnapshot()))));
    assert.doesNotMatch(ui.container.textContent!, /Photo suggestions|Waiting for catalog evidence|Suggested: 2024/);
    assert.match(ui.container.textContent!, /Not researched/);
  } finally { await ui.close(); }
});

test('a queued job waiting for evidence shows its actual blocker and stops active polling', async () => {
  let calls = 0;
  const ui = await mount(<Panel {...panelProps} />, async () => {
    calls++; const body = readBody(recoverySnapshot({ status: calls === 1 ? 'checking_details' : 'waiting_catalog_evidence' }));
    return Response.json({ ...body, jobs: body.jobs.map(job => ({ ...job, status: 'queued', review: null, result_hash: null })) });
  });
  try {
    assert.match(ui.container.textContent!, /Checking missing details/); assert.equal(ui.timers.length, 1);
    await act(async () => ui.timers[0]());
    assert.match(ui.container.textContent!, /Waiting for catalog evidence/); assert.doesNotMatch(ui.container.textContent!, /checking the card and recent eBay sales/);
    assert.equal(calls, 2); assert.equal(ui.timers.length, 1, 'Parked recovery does not schedule another active poll');
    const summary = summarizeStaffInventoryResearchMarketValue({ ...recoveryJob(), status: 'queued', recovery: recoverySnapshot() }, true);
    assert.equal(summary.status, 'unknown'); assert.equal(summary.value_cents, null); assert.match(summary.reason, /Waiting for catalog evidence/);
  } finally { await ui.close(); }
});

test('disabled recovery cannot make a parked initial job look active or keep polling', async () => {
  const body = readBody(recoverySnapshot({ status: 'checking_details' }), false);
  const ui = await mount(<Panel {...panelProps} />, async () => Response.json({ ...body, jobs: body.jobs.map(job => ({ ...job, status: 'queued', review: null, result_hash: null })) }));
  try {
    assert.match(ui.container.textContent!, /Automatic checks paused/); assert.equal(ui.timers.length, 0);
    assert.doesNotMatch(ui.container.textContent!, /background check continues|checking the card and recent eBay sales/);
    assert.equal(summarizeStaffInventoryResearchMarketValue({ ...recoveryJob(), status: 'queued', recovery: recoverySnapshot({ status: 'checking_details' }) }, false).status, 'unknown');
  } finally { await ui.close(); }
});
