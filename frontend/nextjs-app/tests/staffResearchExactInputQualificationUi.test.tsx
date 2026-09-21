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
  try { assert.equal(calls, 1); assert.equal((ui.host.querySelector('button') as HTMLButtonElement).disabled, true); assert.match(ui.host.textContent!, /Dollar cost unavailable/); assert.match(ui.host.textContent!, /matching legacy reference records/); assert.doesNotMatch(ui.host.textContent!, /Loading the exact-input plan/); }
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
