import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;

const sportsSet = '2023_Bowman_University_Chrome_Football';
const otherSet = 'Other existing set';
const pendingKey = 'tenkings:pending-sports-catalog-preparation:v1';
const restored: Array<() => void> = [];
function stub(id: string, exports: unknown) {
  const path = require.resolve(id), original = require.cache[path];
  require.cache[path] = { id: path, filename: path, loaded: true, exports } as NodeModule;
  restored.push(() => { if (original) require.cache[path] = original; else delete require.cache[path]; });
}
stub('next/router', { useRouter: () => ({ isReady: true, query: {}, pathname: '/admin/set-ops-review', replace: async () => true }) });
stub('next/head', { __esModule: true, default: () => null });
stub('next/link', { __esModule: true, default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> });
stub('../components/AppShell', { __esModule: true, default: ({ children }: { children: React.ReactNode }) => <>{children}</> });
stub('../constants/admin', { hasAdminAccess: () => true, hasAdminPhoneAccess: () => false });
stub('../hooks/useSession', { useSession: () => ({ session: { token: 'offline-reviewer', user: { id: 'offline-reviewer', phone: null } }, loading: false }) });
// Mount the actual catalog review and sports preparation children.
const Review = require('../pages/admin/set-ops-review').default as typeof import('../pages/admin/set-ops-review').default;
for (const restore of restored.reverse()) restore();

async function mount(withJob = false, post?: () => Promise<Response>) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://collect.tenkings.co/admin/set-ops-review', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url), method = init?.method ?? 'GET';
    calls.push({ url: path, method });
    if (path === '/api/admin/set-ops/ingestion' && method === 'POST' && post) return post();
    assert.equal(method, 'GET', 'selecting or previewing a set must not write');
    if (path === '/api/admin/set-ops/access') return Response.json({ permissions: { reviewer: true, approver: true } });
    if (path.startsWith('/api/admin/set-ops/sets?')) return Response.json({ sets: [sportsSet, otherSet].map(setId => ({
      setId, label: setId, checklistStatus: 'APPROVED', oddsStatus: 'APPROVED', hasChecklist: true, hasOdds: true,
      updatedAt: null, variantCount: 1, referenceCount: 0,
    })) });
    if (path.startsWith('/api/admin/set-ops/ingestion?')) return Response.json({ jobs: withJob ? [{
      id: 'offline-pending-job', setId: otherSet, datasetType: 'PLAYER_WORKSHEET', sourceUrl: null,
      status: 'REVIEW_REQUIRED', createdAt: '2026-09-21T00:00:00Z',
    }] : [] });
    if (path.startsWith('/api/admin/variants/reference/status?')) return Response.json({ total: 0, pending: 0, processed: 0 });
    if (path.startsWith('/api/admin/set-ops/drafts?')) return Response.json({
      latestVersion: { id: 'legacy-version', version: 7, rows: [] }, versions: [{ id: 'legacy-version', version: 7 }],
      latestApprovedVersionId: 'legacy-approved-version',
    });
    if (path === '/api/admin/set-ops/catalog/sports-preparation') return Response.json({
      schemaVersion: 'setops-sports-additive-preparation-preview/v1', snapshotSha256: 'a'.repeat(64), proposalSha256: 'b'.repeat(64),
      creates: { sources: 2, parallels: 3, scopes: 3, pendingJobs: 2 },
    });
    if (path.startsWith('/api/admin/set-ops/catalog/publication?')) return Response.json({ publication: null });
    throw new Error(`Unexpected request: ${path}`);
  };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    sessionStorage: dom.window.sessionStorage, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const host = dom.window.document.getElementById('root') as HTMLElement, root = createRoot(host);
  await act(async () => root.render(<Review />));
  await act(async () => new Promise(resolve => setTimeout(resolve, 220)));
  const button = (text: string) => {
    const found = [...host.querySelectorAll('button')].find(node => node.textContent === text);
    assert.ok(found, `Missing button: ${text}`); return found;
  };
  const clickNode = async (node: Element) => { await act(async () => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  const input = () => host.querySelector<HTMLInputElement>('input[placeholder="Set ID (type to find existing or create new)"]')!;
  const choose = async (setId: string) => {
    await act(async () => Simulate.focus(input()));
    const label = [...host.querySelectorAll('button p')].find(node => node.textContent === setId);
    assert.ok(label, `Missing set option: ${setId}`); await clickNode(label.closest('button')!);
  };
  const type = async (value: string) => { await act(async () => Simulate.change(input(), { target: { value } } as never)); };
  const step = async (label: string) => {
    const text = [...host.querySelectorAll('button p')].find(node => node.textContent === label);
    assert.ok(text); await clickNode(text.closest('button')!);
  };
  return { host, calls, button, choose, type, clickNode, step, dom, click: (text: string) => clickNode(button(text)),
    close: async () => {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as Record<string, unknown>)[key]; }
    },
  };
}

test('existing sports set opens real preparation without pending jobs or a draft selection', async () => {
  const ui = await mount();
  try {
    assert.equal(ui.host.querySelector('tbody tr'), null);
    assert.equal(ui.button('Download taxonomy mapping').disabled, true);
    await ui.choose(sportsSet);
    assert.match(ui.host.textContent!, /Prepare the Bowman University sports pilot/);
    assert.match(ui.host.textContent!, new RegExp(`Catalog set: ${sportsSet}`));
    assert.equal(ui.button('Download taxonomy mapping').disabled, false);
    assert.equal(ui.button('Continue to Step 2').disabled, true, 'catalog selection cannot authorize a legacy draft');
    assert.equal(ui.button('Prepare pending mappings').disabled, true);
    await ui.click('Preview missing mappings');
    assert.equal(ui.calls.filter(call => call.url.endsWith('/sports-preparation')).length, 1);
    assert.equal(ui.button('Prepare pending mappings').disabled, false);
    assert.ok(ui.calls.every(call => call.method === 'GET'));
  } finally { await ui.close(); }
});

test('catalog switching preserves a pending preparation and cannot rebind the legacy selected job', async () => {
  const ui = await mount(true);
  try {
    await ui.choose(otherSet);
    const row = ui.host.querySelector('tbody tr'); assert.ok(row); await ui.clickNode(row);
    assert.equal(ui.button('Build Draft From Selected Job').disabled, false);
    await ui.click('Continue to Step 2'); await ui.click('Reload Draft');
    assert.match(ui.host.textContent!, /Latest version: v7 \(legacy-v\)/);
    await ui.step('Ingestion Queue');
    const pendingBytes = JSON.stringify({ action: 'stage', request: { idempotencyKey: 'pending-offline-key' } });
    ui.dom.window.sessionStorage.setItem(pendingKey, pendingBytes);
    await ui.type(''); await ui.choose(sportsSet);
    assert.equal(ui.button('Retry same preparation').disabled, false);
    assert.equal(ui.button('Preview missing mappings').disabled, true);
    await ui.click('Continue to Step 2');
    assert.match(ui.host.textContent!, /Selected set: Other existing set/);
    assert.match(ui.host.textContent!, /Latest version: v7 \(legacy-v\)/);
    assert.match(ui.host.textContent!, /Latest approved version id: legacy-approved-version/);
    await ui.step('Ingestion Queue');
    await ui.type('New not-yet-created set');
    assert.equal(ui.button('Download taxonomy mapping').disabled, true);
    assert.doesNotMatch(ui.host.textContent!, /Prepare the Bowman University sports pilot/);
    await ui.type(''); await ui.choose(otherSet);
    await ui.click('Load current publication');
    assert.ok(ui.calls.some(call => call.url === `/api/admin/set-ops/catalog/publication?setId=${encodeURIComponent(otherSet)}`));
    await ui.type(''); await ui.choose(sportsSet);
    assert.equal(ui.button('Retry same preparation').disabled, false);
    assert.equal(ui.dom.window.sessionStorage.getItem(pendingKey), pendingBytes);
    assert.ok(ui.calls.every(call => call.method === 'GET'));
  } finally { await ui.close(); }
});

test('late prepared-import completion preserves a newer explicit catalog choice', async () => {
  const source = readFileSync(new URL('../../../docs/plans/catalog-pilot-20260916/pokemon-complete-import.unreviewed.json', import.meta.url), 'utf8');
  const importedSet = JSON.parse(source).requestDraft.setId;
  for (const changeSelection of [false, true]) {
    let finish: (response: Response) => void = () => {};
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const ui = await mount(false, () => pending);
    try {
      const input = ui.host.querySelector<HTMLInputElement>('input[aria-label="Prepared checklist JSON"]')!;
      Object.defineProperty(input, 'files', { configurable: true, value: [{ size: source.length, name: 'prepared.json', text: async () => source }] });
      await act(async () => Simulate.change(input));
      await ui.click('Queue prepared checklist for review');
      assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
      if (changeSelection) await ui.choose(sportsSet);
      await act(async () => finish(Response.json({ job: { id: 'imported-checklist-job' } })));
      const expected = changeSelection ? sportsSet : importedSet;
      assert.ok(ui.host.textContent!.includes(`Catalog set: ${expected}`));
      assert.equal(ui.host.textContent!.includes('Prepare the Bowman University sports pilot'), changeSelection);
      assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
    } finally { await ui.close(); }
  }
});
