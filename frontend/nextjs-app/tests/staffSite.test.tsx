import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { SessionPayload } from '../hooks/useSession';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const cssLoader = require.extensions['.css']; require.extensions['.css'] = module => { module.exports = {}; };
const sessionPath = require.resolve('../hooks/useSession');
const cachedSession = require.cache[sessionPath];
let context: { session: SessionPayload | null; loading: boolean; ensureSession: (options?: { force?: boolean }) => Promise<SessionPayload>; logout: () => void };
require.cache[sessionPath] = { id: sessionPath, filename: sessionPath, loaded: true, exports: { useSession: () => context } } as NodeModule;
const Gate = require('../components/StaffSiteGate').default as typeof import('../components/StaffSiteGate').default;
if (cachedSession) require.cache[sessionPath] = cachedSession; else delete require.cache[sessionPath];
if (cssLoader) require.extensions['.css'] = cssLoader; else delete require.extensions['.css'];
const session = (id = 'admin', token = 'human-token'): SessionPayload => ({ token, expiresAt: '2099-01-01T00:00:00.000Z', user: { id, displayName: 'Untrusted local display', phone: null, avatarUrl: null }, wallet: { id: 'wallet', balance: 0 } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function until(check: () => boolean) { for (let i = 0; i < 50 && !check(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 2)); }); assert.ok(check(), 'UI did not settle'); }
async function mount(fetcher: typeof fetch, initial: SessionPayload | null = null) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://tenkings.co/staff', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  context = { session: initial, loading: false, ensureSession: async () => session(), logout: () => { context.session = null; } };
  const host = dom.window.document.getElementById('root')!; const root = createRoot(host);
  const render = async () => act(async () => root.render(<Gate fallback={content => <section data-shell="true">{content}</section>}>{value => <div data-private="true">Private tool for {value.user.id}: {value.user.displayName}</div>}</Gate>));
  await render();
  return { host, render, click: async (text: string) => { const button = [...host.querySelectorAll('button')].find(value => value.textContent === text); assert.ok(button); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); }, close: async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; } } };
}

test('fresh sign-in requests server access and never mounts inventory from local browser claims', async () => {
  const pending = deferred<Response>(); const requests: RequestInit[] = [];
  const ui = await mount(async (url, init) => { assert.equal(url, '/api/v2/admin/inventory/access'); requests.push(init!); return pending.promise; });
  try {
    assert.equal(requests.length, 0); assert.equal(ui.host.querySelector('[data-private]'), null);
    let logins = 0; context.ensureSession = async options => { assert.equal(options?.force, false); logins++; context.session = session(); return context.session; };
    await ui.render(); await ui.click('Sign in to staff'); await ui.render();
    assert.equal(logins, 1); assert.equal(requests.length, 1); assert.equal(ui.host.querySelector('[data-private]'), null);
    assert.equal((requests[0].headers as Record<string, string>).Authorization, 'Bearer human-token'); assert.equal(requests[0].cache, 'no-store');
    await act(async () => pending.resolve(json({ user: { id: 'admin', displayName: 'Server team member' } })));
    await until(() => !!ui.host.querySelector('[data-private]'));
    assert.match(ui.host.textContent!, /Server team member/); assert.equal(ui.host.textContent!.includes('Untrusted local display'), false);
  } finally { await ui.close(); }
});

test('changing user or token immediately hides authorized UI and ignores the old request', async () => {
  const first = deferred<Response>(), second = deferred<Response>(); let calls = 0;
  const ui = await mount(async () => ++calls === 1 ? first.promise : second.promise, session());
  try {
    context.session = session('other', 'other-token'); await ui.render();
    await act(async () => first.resolve(json({ user: { id: 'admin', displayName: 'Prior admin' } })));
    assert.equal(ui.host.querySelector('[data-private]'), null);
    await act(async () => second.resolve(json({ message: 'Customer' }, 403)));
    await until(() => ui.host.textContent!.includes('does not have inventory access'));
    assert.equal(ui.host.querySelector('[data-private]'), null);
    let forced = false; context.ensureSession = async options => { forced = options?.force === true; throw new Error('cancelled'); };
    await ui.render(); await ui.click('Sign in again'); assert.equal(forced, true); assert.match(ui.host.textContent!, /Sign-in was not completed/);
  } finally { await ui.close(); }
});

test('logout and token replacement unmount previously accepted private tools', async () => {
  let status = 200;
  const ui = await mount(async () => json({ user: { id: 'admin', displayName: 'Admin' } }, status), session());
  try {
    await until(() => !!ui.host.querySelector('[data-private]'));
    status = 401; context.session = session('admin', 'expired-token'); await ui.render();
    assert.equal(ui.host.querySelector('[data-private]'), null);
    await until(() => ui.host.textContent!.includes('session has expired'));
    await ui.click('Sign out'); await ui.render();
    assert.match(ui.host.textContent!, /Sign in to staff/); assert.equal(ui.host.querySelector('[data-private]'), null);
  } finally { await ui.close(); }
});

test('unavailable and mismatched access responses preserve drafts and permit explicit retry', async () => {
  let calls = 0;
  const ui = await mount(async () => { calls++; return calls === 1 ? json({ user: { id: 'another-user', displayName: 'Wrong' } }) : json({ user: { id: 'admin', displayName: null } }); }, session());
  try {
    sessionStorage.setItem('tenkings:staff-inventory:pending:admin', 'preserved exact command');
    await until(() => ui.host.textContent!.includes('could not be checked'));
    assert.equal(ui.host.querySelector('[data-private]'), null);
    await ui.click('Try again'); await until(() => !!ui.host.querySelector('[data-private]'));
    assert.equal(calls, 2); assert.equal(sessionStorage.getItem('tenkings:staff-inventory:pending:admin'), 'preserved exact command');
  } finally { await ui.close(); }
});
