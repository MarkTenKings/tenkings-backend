import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { ProviderQualificationPanel, getServerSideProps } from '../pages/admin/inventory-research-qualification';
import { PROVIDER_QUALIFICATION_PLAN, PROVIDER_QUALIFICATION_PLAN_HASH, PROVIDER_QUALIFICATION_ACK } from '../lib/server/staffResearchProviderQualification';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const plan = (enabled: boolean) => ({ enabled, plan: PROVIDER_QUALIFICATION_PLAN, plan_sha256: PROVIDER_QUALIFICATION_PLAN_HASH, acknowledge: PROVIDER_QUALIFICATION_ACK });

async function mount(fetchImpl: typeof fetch) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://collect.tenkings.co/admin/inventory-research-qualification', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, fetch: fetchImpl, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const host = dom.window.document.getElementById('root')!, root = createRoot(host);
  await act(async () => root.render(<ProviderQualificationPanel token="fixture-human-session" />));
  return { host, dom,
    acknowledge: async () => { const input = host.querySelector('input')!; await act(async () => Simulate.change(input, { target: { value: PROVIDER_QUALIFICATION_ACK } } as any)); },
    click: async () => { const button = [...host.querySelectorAll('button')].find(node => node.textContent?.includes('provider check') || node.textContent === 'Checking…')!; await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); },
    close: async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as any)[key]; } },
  };
}
test('opening disabled qualification page only reads plan and cannot submit provider work', async () => {
  const calls: RequestInit[] = [];
  const ui = await mount(async (url, init) => { assert.equal(url, '/api/v2/admin/inventory/provider-qualification'); calls.push(init!); return Response.json(plan(false)); });
  try {
    assert.equal(calls.length, 1); assert.equal(calls[0].method, undefined);
    assert.equal((calls[0].headers as Record<string, string>).Authorization, 'Bearer fixture-human-session');
    assert.match(ui.host.textContent!, /Execution is disabled/);
    assert.equal((ui.host.querySelector('button') as HTMLButtonElement).disabled, true);
    assert.equal((ui.host.querySelector('input') as HTMLInputElement).disabled, true);
    await ui.click(); assert.equal(calls.length, 1);
  } finally { await ui.close(); }
});
test('explicit acknowledged click sends exact plan and cohort once; failed response clears acknowledgment with no automatic retry', async () => {
  const calls: RequestInit[] = []; let complete: (response: Response) => void = () => {};
  const pending = new Promise<Response>(resolve => { complete = resolve; });
  const ui = await mount(async (_url, init) => { calls.push(init!); return init?.method === 'POST' ? pending : Response.json(plan(true)); });
  try {
    assert.equal((ui.host.querySelector('button') as HTMLButtonElement).disabled, true);
    await ui.acknowledge(); await ui.click(); await ui.click();
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(String(calls[1].body)), { cohort: 'sports_anniversary', plan_sha256: PROVIDER_QUALIFICATION_PLAN_HASH, acknowledge: PROVIDER_QUALIFICATION_ACK });
    assert.equal(Object.hasOwn(JSON.parse(String(calls[1].body)), 'apiKey'), false);
    await act(async () => complete(Response.json({ message: 'Provider qualification is unavailable.' }, { status: 503 })));
    assert.match(ui.host.textContent!, /Provider qualification is unavailable/);
    assert.equal((ui.host.querySelector('input') as HTMLInputElement).value, '');
    assert.equal((ui.host.querySelector('button') as HTMLButtonElement).disabled, true);
    assert.equal(calls.length, 2);
  } finally { await ui.close(); }
});

test('Preview page returns only its inventory navigation and private cache headers; other hosts are blocked', async () => {
  const host = 'qualified-branch.vercel.app';
  const values = { NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: host, STAFF_RESEARCH_PROVIDER_QUALIFICATION_PREVIEW_HOST: host };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  const headers: Record<string, string> = {};
  const context = (hostname: string) => ({ req: { headers: { host: hostname } }, res: { setHeader(key: string, value: string) { headers[key] = value; } } } as any);
  try {
    assert.deepEqual(await getServerSideProps(context(host)), { props: { inventoryPath: '/staff/inventory' } });
    assert.equal(headers['Cache-Control'], 'private, no-store');
    assert.equal(headers['X-Robots-Tag'], 'noindex, nofollow');
    assert.deepEqual(await getServerSideProps(context('collect.tenkings.co')), { props: { inventoryPath: '/admin/physical-inventory' } });
    assert.deepEqual(await getServerSideProps(context('foreign.vercel.app')), { notFound: true });
    process.env.VERCEL_ENV = 'production';
    assert.deepEqual(await getServerSideProps(context(host)), { notFound: true });
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
