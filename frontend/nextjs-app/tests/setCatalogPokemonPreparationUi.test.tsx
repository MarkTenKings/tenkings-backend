import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Preparation from '../components/admin/SetCatalogPokemonPreparation';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;

const setId = 'Black & White-Legendary Treasures';
const storageKey = 'tenkings:pending-pokemon-catalog-preparation:v1';
const binding = { draftId: 'draft', draftVersionId: 'version', ingestionJobId: 'job', sourceId: 'source', programRowId: 'program' };
const preview = { schemaVersion: 'setops-pokemon-additive-preparation-preview/v1', snapshotSha256: 'a'.repeat(64),
  proposalSha256: 'b'.repeat(64), binding, creates: { parallels: 2, scopes: 2 }, preservedCards: 138, applicability: 'unknown' };
const confirmed = (bytes: string, outcome = 'recorded') => ({ outcome, receiptSha256: 'c'.repeat(64),
  receipt: { schemaVersion: 'setops-pokemon-additive-preparation-receipt/v1', baselineSha256: preview.snapshotSha256, proposalSha256: preview.proposalSha256, binding, idempotencyKey: JSON.parse(bytes).request.idempotencyKey, preservedCards: 138, applicability: 'unknown', approved: false, publication: null } });
async function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://collect.tenkings.co/admin/set-ops-review' });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let post = async (body: string): Promise<Response> => Response.json(confirmed(body));
  let get = async (): Promise<Response> => Response.json(preview);
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, '/api/admin/set-ops/catalog/pokemon-preparation');
    calls.push({ url: String(url), init: init ?? {} });
    return init?.method === 'POST' ? post(String(init.body)) : get();
  };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    sessionStorage: dom.window.sessionStorage, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const host = dom.window.document.getElementById('root') as HTMLElement, root = createRoot(host);
  let key = 0;
  async function render(selected = setId, canReview = true, remount = false) {
    if (remount) key++;
    await act(async () => root.render(<Preparation key={key} setId={selected} token="fixture-token" canReview={canReview} />));
  }
  await render();
  const button = (text: string) => { const found = [...host.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(found, text); return found; };
  const click = async (text: string, twice = false) => act(async () => {
    const target = button(text); target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    if (twice) target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  return { host, calls, dom, button, click, render, setPost: (fn: typeof post) => { post = fn; }, setGet: (fn: typeof get) => { get = fn; },
    close: async () => { await act(async () => root.unmount()); dom.window.close();
      for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; }
    } };
}

test('pilot UI is scoped, never auto-runs and separates preview from explicit preparation', async () => {
  const ui = await mount();
  try {
    assert.equal(ui.calls.length, 0); assert.equal(ui.button('Prepare pending mappings').disabled, true);
    await ui.render('different-set'); assert.equal(ui.host.textContent, ''); assert.equal(ui.calls.length, 0);
    await ui.render(setId, false); assert.equal(ui.button('Preview missing mappings').disabled, true);
    await ui.render(); await ui.click('Preview missing mappings');
    assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].init.method, 'GET');
    assert.match(ui.host.textContent!, /Physical printing applicability remains unknown/);
    await ui.click('Prepare pending mappings');
    assert.equal(ui.calls.length, 2); assert.equal(ui.calls[1].init.method, 'POST');
    assert.equal(JSON.parse(String(ui.calls[1].init.body)).request.expectedSnapshotSha256, preview.snapshotSha256);
    assert.equal(sessionStorage.getItem(storageKey), null);
    assert.match(ui.host.textContent!, /Pending mappings prepared/);
  } finally { await ui.close(); }
});

test('uncertain response survives remount and retries the exact original bytes without a new key', async () => {
  const ui = await mount();
  try {
    ui.setPost(async () => { throw new Error('Connection ended before confirmation'); });
    await ui.click('Preview missing mappings'); await ui.click('Prepare pending mappings');
    const first = String(ui.calls[1].init.body);
    assert.equal(sessionStorage.getItem(storageKey), first); assert.equal(first.includes('fixture-token'), false);
    await ui.render(setId, true, true);
    assert.equal(ui.calls.length, 2); assert.equal(ui.button('Preview missing mappings').disabled, true);
    ui.setPost(async bytes => Response.json(confirmed(bytes, 'replay')));
    await ui.click('Retry same preparation');
    assert.equal(ui.calls.length, 3); assert.equal(ui.calls[2].init.body, first); assert.equal(sessionStorage.getItem(storageKey), null);
  } finally { await ui.close(); }
});

test('double clicks dispatch once and a late response cannot clear the request after context changes', async () => {
  const ui = await mount();
  try {
    let finish!: (value: Response) => void;
    ui.setPost(() => new Promise(resolve => { finish = resolve; }));
    await ui.click('Preview missing mappings'); await ui.click('Prepare pending mappings', true);
    assert.equal(ui.calls.filter(call => call.init.method === 'POST').length, 1);
    const retained = sessionStorage.getItem(storageKey); assert.ok(retained);
    await ui.render('different-set');
    await act(async () => { finish(Response.json(confirmed(retained))); });
    assert.equal(sessionStorage.getItem(storageKey), retained); assert.equal(ui.host.textContent, '');
    await ui.render(); assert.equal(ui.button('Preview missing mappings').disabled, true);
    assert.equal(ui.calls.length, 2);
  } finally { await ui.close(); }
});

test('storage failure prevents dispatch and malformed confirmation keeps the retry request', async () => {
  const ui = await mount();
  const original = ui.dom.window.Storage.prototype.setItem;
  try {
    await ui.click('Preview missing mappings');
    ui.dom.window.Storage.prototype.setItem = () => { throw new Error('Session storage blocked'); };
    await ui.click('Prepare pending mappings');
    assert.equal(ui.calls.length, 1); assert.match(ui.host.textContent!, /Session storage blocked/);
    ui.dom.window.Storage.prototype.setItem = original;
    ui.setPost(async bytes => Response.json({ ...confirmed(bytes), receipt: { ...confirmed(bytes).receipt, baselineSha256: 'd'.repeat(64) } }));
    await ui.click('Prepare pending mappings');
    assert.ok(sessionStorage.getItem(storageKey)); assert.match(ui.host.textContent!, /did not confirm preparation/);
    assert.equal(ui.button('Preview missing mappings').disabled, true);
  } finally { ui.dom.window.Storage.prototype.setItem = original; await ui.close(); }
});

test('invalid preview cannot enable staging and a failed refresh clears the prior preview', async () => {
  const ui = await mount();
  try {
    ui.setGet(async () => Response.json({ ...preview, creates: {} }));
    await ui.click('Preview missing mappings'); assert.equal(ui.button('Prepare pending mappings').disabled, true);
    ui.setGet(async () => Response.json(preview));
    await ui.click('Preview missing mappings'); assert.equal(ui.button('Prepare pending mappings').disabled, false);
    ui.setGet(async () => { throw new Error('Preview unavailable'); });
    await ui.click('Preview missing mappings'); assert.equal(ui.button('Prepare pending mappings').disabled, true);
    assert.equal(ui.calls.filter(call => call.init.method === 'POST').length, 0);
  } finally { await ui.close(); }
});

test('only an exact authoritative stale rejection permits a new deliberate preview', async () => {
  const ui = await mount();
  try {
    ui.setPost(async bytes => { const request = JSON.parse(bytes).request; return Response.json({
      message: 'Stale snapshot', code: 'POKEMON_PREPARATION_SNAPSHOT_STALE', idempotencyKey: 'wrong-key',
      expectedSnapshotSha256: request.expectedSnapshotSha256 }, { status: 409 }); });
    await ui.click('Preview missing mappings'); await ui.click('Prepare pending mappings');
    const original = sessionStorage.getItem(storageKey); assert.ok(original);
    assert.equal(ui.button('Preview missing mappings').disabled, true);
    ui.setPost(async bytes => { const request = JSON.parse(bytes).request; return Response.json({
      message: 'Preparation snapshot changed; preview again.', code: 'POKEMON_PREPARATION_SNAPSHOT_STALE',
      idempotencyKey: request.idempotencyKey, expectedSnapshotSha256: request.expectedSnapshotSha256 }, { status: 409 }); });
    await ui.click('Retry same preparation');
    assert.equal(ui.calls[2].init.body, original);
    assert.equal(sessionStorage.getItem(storageKey), null);
    assert.equal(sessionStorage.getItem(`${storageKey}:last-rejected`), original);
    assert.equal(ui.button('Preview missing mappings').disabled, false);
    assert.equal(ui.button('Prepare pending mappings').disabled, true);
    assert.equal(ui.calls.length, 3, 'Stale rejection never automatically previews or stages');
    await ui.render(setId, true, true); assert.equal(ui.button('Preview missing mappings').disabled, false);
    await ui.click('Preview missing mappings');
    ui.setPost(async bytes => Response.json(confirmed(bytes)));
    await ui.click('Prepare pending mappings');
    assert.notEqual(JSON.parse(String(ui.calls[4].init.body)).request.idempotencyKey, JSON.parse(original).request.idempotencyKey);
  } finally { await ui.close(); }
});

test('a receipt for another job, key or approved state never clears the pending request', async () => {
  const ui = await mount();
  try {
    await ui.click('Preview missing mappings');
    for (const patch of [{ binding: { ...binding, ingestionJobId: 'another-job' } }, { idempotencyKey: 'another-key' }, { approved: true }]) {
      ui.setPost(async bytes => { const result = confirmed(bytes); return Response.json({ ...result, receipt: { ...result.receipt, ...patch } }); });
      await ui.click(sessionStorage.getItem(storageKey) ? 'Retry same preparation' : 'Prepare pending mappings');
      assert.ok(sessionStorage.getItem(storageKey)); assert.match(ui.host.textContent!, /did not confirm preparation/);
    }
    const posts = ui.calls.filter(call => call.init.method === 'POST');
    assert.equal(posts.length, 3); assert.ok(posts.every(post => post.init.body === posts[0].init.body));
  } finally { await ui.close(); }
});
