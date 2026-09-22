import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import StaffResearchExactInputQualification from '../components/admin/StaffResearchExactInputQualification';
import { EXACT_INPUT_ACK } from '../lib/server/staffResearchExactInputQualification';
import { exactFixture, actorId } from './staffResearchExactInputQualificationFixture';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
async function mount(fetchImpl: typeof fetch, retained?: string) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://qualified-main.vercel.app/admin/inventory-research-qualification', pretendToBeVisual: true });
  const key = `tk-exact-research-invocation:${actorId}`; if (retained) dom.window.localStorage.setItem(key, retained);
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, fetch: fetchImpl, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const host = dom.window.document.getElementById('root')!, root = createRoot(host);
  await act(async () => root.render(<StaffResearchExactInputQualification token="fixture-token" actorId={actorId} />));
  return { host, dom, key, input: async () => { await act(async () => Simulate.change(host.querySelector('input')!, { target: { value: EXACT_INPUT_ACK } } as any)); },
    click: async (text: string) => { const button = [...host.querySelectorAll('button')].find(node => node.textContent?.includes(text))!; assert.ok(button); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); },
    close: async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as any)[key]; } } };
}
test('disabled opening reads only plan and truthfully shows unavailable dollars and legacy references', async () => {
  const f = await exactFixture(); let calls = 0;
  const ui = await mount(async (_url, init) => { assert.equal(init?.method, undefined); calls++; return Response.json({ ...f.plan, enabled: false, reason: 'Execution is disabled.' }); });
  try { assert.equal(calls, 1); assert.equal((ui.host.querySelector('button') as HTMLButtonElement).disabled, true); assert.match(ui.host.textContent!, /Dollar cost unavailable/); assert.match(ui.host.textContent!, /matching legacy reference records/); assert.doesNotMatch(ui.host.textContent!, /Loading the exact-input plan/); assert.match(ui.host.textContent!, /Expected research enginestaff-inventory-research-v6/); assert.doesNotMatch(ui.host.textContent!, /V5 research diagnostic/); }
  finally { await ui.close(); }
});
test('uncertain POST retains identifiers before transmission, reload recovers only with GET, no retry is offered', async () => {
  const f = await exactFixture(), calls: { url: string; init?: RequestInit }[] = []; let saved = '';
  const ui = await mount(async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'POST') { saved = window.localStorage.getItem(`tk-exact-research-invocation:${actorId}`)!; assert.ok(saved); assert.deepEqual(JSON.parse(saved), { invocation_id: JSON.parse(String(init.body)).invocation_id, plan_sha256: f.plan.plan_sha256 }); throw Error('lost response'); }
    return Response.json(f.plan);
  });
  try { await ui.input(); await ui.click('Run one'); assert.match(ui.host.textContent!, /response is uncertain/); assert.equal(ui.host.querySelector('input'), null); assert.equal(calls.filter(call => call.init?.method === 'POST').length, 1); }
  finally { await ui.close(); }
  const pending = JSON.parse(saved);
  const reload = await mount(async (url, init) => { calls.push({ url: String(url), init }); assert.notEqual(init?.method, 'POST');
    return Response.json(String(url).includes('?') ? { status: 'uncertain', invocation_id: pending.invocation_id, receipt_sha256: 'a'.repeat(64), download_url: null, summary: null, message: 'Initial receipt only.' } : f.plan); }, saved);
  try { assert.equal(reload.host.querySelector('input'), null); await reload.click('Recover receipt'); assert.match(reload.host.textContent!, /Initial receipt only/); assert.equal(calls.filter(call => call.init?.method === 'POST').length, 1); }
  finally { await reload.close(); }
});
test('malformed or mismatched successful response remains uncertain and cannot unlock another POST', async () => {
  const f = await exactFixture(); let posts = 0;
  const ui = await mount(async (_url, init) => { if (init?.method === 'POST') { posts++; return Response.json({ status: 'completed', invocation_id: 'different', message: 'unsafe confirmation', download_url: 'javascript:alert(1)' }); } return Response.json(f.plan); });
  try { await ui.input(); await ui.click('Run one'); assert.equal(posts, 1); assert.match(ui.host.textContent!, /response is uncertain/); assert.doesNotMatch(ui.host.textContent!, /unsafe confirmation/); assert.equal(ui.host.querySelector('a'), null); assert.equal(ui.host.querySelector('input'), null); }
  finally { await ui.close(); }
});

test('a recovered completed or failed receipt can deliberately prepare another check without dispatch or evidence deletion', async () => {
  const f = await exactFixture(), saved = { invocation_id: 'd747368a-901d-4f36-9a64-ab21f2e6f601', plan_sha256: 'd'.repeat(64) };
  for (const status of ['completed', 'failed']) {
    const calls: string[] = [];
    const ui = await mount(async (url, init) => {
      assert.notEqual(init?.method, 'POST'); calls.push(String(url));
      return Response.json(String(url).includes('?') ? { status, invocation_id: saved.invocation_id, receipt_sha256: 'a'.repeat(64),
        download_url: 'https://private.example/terminal.json?expires=60', summary: { status }, message: 'Private terminal evidence recovered.' } : f.plan);
    }, JSON.stringify(saved));
    try {
      ui.dom.window.localStorage.setItem('unrelated', 'keep');
      assert.doesNotMatch(ui.host.textContent!, /Prepare another check/);
      await ui.click('Recover receipt');
      assert.equal(ui.dom.window.localStorage.getItem(ui.key), JSON.stringify(saved));
      assert.equal(ui.host.querySelector('input'), null);
      const count = calls.length; await ui.click('Prepare another check');
      assert.equal(calls.length, count); assert.equal(ui.dom.window.localStorage.getItem(ui.key), null);
      assert.equal(ui.dom.window.localStorage.getItem('unrelated'), 'keep');
      assert.ok(ui.host.querySelector('input')); assert.equal((ui.host.querySelector('input') as HTMLInputElement).value, '');
      assert.equal((ui.host.querySelector('button') as HTMLButtonElement).disabled, true);
      const previous = ui.host.querySelector('[aria-label="Previous diagnostic receipt"]')!;
      assert.match(previous.textContent!, new RegExp(saved.invocation_id)); assert.match(previous.textContent!, new RegExp(saved.plan_sha256));
      assert.match(previous.textContent!, new RegExp('a'.repeat(64))); assert.match(previous.textContent!, /Server evidence is unchanged/);
      assert.equal(previous.querySelector('a')?.getAttribute('href'), 'https://private.example/terminal.json?expires=60');
    } finally { await ui.close(); }
  }
});

test('uncertain receipts, unavailable downloads and running work keep the exact pending pointer', async () => {
  const f = await exactFixture(), saved = { invocation_id: 'd747368a-901d-4f36-9a64-ab21f2e6f601', plan_sha256: 'd'.repeat(64) };
  for (const status of ['uncertain', 'completed', 'failed']) {
    const ui = await mount(async url => Response.json(String(url).includes('?') ? { status, invocation_id: saved.invocation_id,
      receipt_sha256: 'a'.repeat(64), download_url: null, summary: null, message: 'Recoverable evidence.' } : f.plan), JSON.stringify(saved));
    try { await ui.click('Recover receipt'); assert.doesNotMatch(ui.host.textContent!, /Prepare another check/); assert.equal(ui.dom.window.localStorage.getItem(ui.key), JSON.stringify(saved)); }
    finally { await ui.close(); }
  }
  let complete: ((value: Response) => void) | undefined;
  const ui = await mount(async (_url, init) => init?.method === 'POST' ? new Promise<Response>(resolve => { complete = resolve; }) : Response.json(f.plan));
  try {
    await ui.input(); await ui.click('Run one');
    const pending = ui.dom.window.localStorage.getItem(ui.key)!; assert.ok(pending); assert.doesNotMatch(ui.host.textContent!, /Prepare another check/);
    assert.equal(ui.host.querySelector('input'), null);
    await act(async () => complete!(Response.json({ status: 'uncertain', invocation_id: JSON.parse(pending).invocation_id,
      receipt_sha256: 'a'.repeat(64), download_url: null, summary: null, message: 'Initial receipt only.' })));
    assert.equal(ui.dom.window.localStorage.getItem(ui.key), pending); assert.doesNotMatch(ui.host.textContent!, /Prepare another check/);
  } finally { await ui.close(); }
});

test('preparing another check cannot erase a different invocation saved by another tab', async () => {
  const f = await exactFixture(), saved = { invocation_id: 'd747368a-901d-4f36-9a64-ab21f2e6f601', plan_sha256: 'd'.repeat(64) };
  const ui = await mount(async url => Response.json(String(url).includes('?') ? { status: 'completed', invocation_id: saved.invocation_id,
    receipt_sha256: 'a'.repeat(64), download_url: 'https://private.example/terminal.json', summary: null, message: 'Completed.' } : f.plan), JSON.stringify(saved));
  try {
    await ui.click('Recover receipt'); const other = JSON.stringify({ ...saved, invocation_id: 'e747368a-901d-4f36-9a64-ab21f2e6f601' });
    ui.dom.window.localStorage.setItem(ui.key, other); await ui.click('Prepare another check');
    assert.equal(ui.dom.window.localStorage.getItem(ui.key), other); assert.equal(ui.host.querySelector('input'), null); assert.match(ui.host.textContent!, /retained invocation changed/);
  } finally { await ui.close(); }
});
