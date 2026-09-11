import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { webcrypto } from 'node:crypto';

const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const cssLoader = require.extensions['.css'];
require.extensions['.css'] = module => { module.exports = {}; };
let captureProps: React.ComponentProps<typeof import('../components/admin/StaffInventoryCardCapture').default>;
const capturePath = require.resolve('../components/admin/StaffInventoryCardCapture');
const captureCache = require.cache[capturePath];
require.cache[capturePath] = { id: capturePath, filename: capturePath, loaded: true, exports: { __esModule: true, default: (props: typeof captureProps) => { captureProps = props; return props.open ? <section data-save-camera-fixture="true"><button onClick={props.onClose}>Close camera fixture</button></section> : null; } } } as NodeModule;
const Workspace = require('../components/admin/StaffInventoryWorkspace').default as typeof import('../components/admin/StaffInventoryWorkspace').default;
if (captureCache) require.cache[capturePath] = captureCache; else delete require.cache[capturePath];
if (cssLoader) require.extensions['.css'] = cssLoader; else delete require.extensions['.css'];

const locationId = '11111111-1111-4111-8111-111111111111';
const pendingKey = 'tenkings:staff-inventory:pending:save-validation-fixture';
const data = {
  version: 1, sequence: 0, items: [],
  locations: [{ id: locationId, name: 'Disposable fixture HQ', slug: 'fixture-hq', address: 'Synthetic local address', locationType: 'hq', latitude: 35, longitude: -78 }],
  machines: [], products: [], updated_at: null,
  totals: { on_hand: 0, machine_roster: 0, groups: 0, locations: 0, cost_cents: null, expected_sales_cents: null, expected_profit_cents: null, expected_margin_pct: null, costed_units: 0, priced_units: 0, known_cost_subtotal_cents: 0, value_overflow: false },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
type SavedCommand = { request_id: string; quantity?: number; total_cost_cents?: number; expected_price_cents?: number; description?: { name: string; category: string }; destination?: { location_id: string; kind: string } };
type SaveReply = (command: SavedCommand, attempt: number) => Response | Promise<Response>;

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  assert.ok(check(), 'UI did not settle');
}

async function mount(reply: SaveReply = command => json({ request_id: command.request_id, outcome: 'RECORDED' }), geolocation?: Pick<Geolocation, 'watchPosition' | 'clearWatch' | 'getCurrentPosition'>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://fixture.invalid/admin/physical-inventory', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  const posts: SavedCommand[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === 'POST') { const command = JSON.parse(String(init.body)) as SavedCommand; posts.push(command); return reply(command, posts.length); }
    return json(data);
  };
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLFormElement', 'Element', 'Node'] as const) set(key, key === 'window' ? dom.window : dom.window[key]);
  set('self', dom.window); set('sessionStorage', dom.window.sessionStorage); set('fetch', fetcher); set('crypto', webcrypto); set('IS_REACT_ACT_ENVIRONMENT', true);
  if (geolocation) Object.defineProperty(dom.window.navigator, 'geolocation', { configurable: true, value: geolocation });
  set('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window)); set('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
  Object.defineProperty(dom.window, 'visualViewport', { configurable: true, value: Object.assign(new dom.window.EventTarget(), { height: 844, offsetTop: 0 }) });
  // JSDOM has no layout; native Chrome/WebKit coverage verifies the actual viewport.
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  // React was imported before the disposable DOM and selected its legacy input
  // event fallback. Supply that fallback without changing native focus behavior.
  Object.defineProperties(dom.window.HTMLElement.prototype, { attachEvent: { configurable: true, value() {} }, detachEvent: { configurable: true, value() {} } });
  const container = dom.window.document.getElementById('root') as HTMLElement, root = createRoot(container);
  await act(async () => root.render(<Workspace token="local-fixture-token" adminId="save-validation-fixture" onAdvanced={() => {}} />));
  const button = (text: string) => { const matches = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.textContent === text && !b.closest('[hidden]')); const found = matches.find(b => b.closest('form')) ?? matches[0]; assert.ok(found, `Missing button ${text}`); return found; };
  await until(() => !![...container.querySelectorAll('button')].find(b => b.textContent === 'Add inventory' && !b.disabled));
  await act(async () => button('Add inventory').click());
  let submits = 0;
  container.querySelector('form')!.addEventListener('submit', () => { submits++; });
  const api = {
    container, dom, posts, button,
    form: () => container.querySelector('form')!,
    submits: () => submits,
    input(label: string) { const input = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`); assert.ok(input, `Missing field ${label}`); return input; },
    async fill(label: string, value: string) { await act(async () => Simulate.change(this.input(label), { target: { value } } as any)); },
    async click(text: string) { const target = button(text); assert.equal(target.disabled, false, `Disabled ${text}`); await act(async () => target.click()); },
    // Clicking the actual button exercises native constraint validation. Dispatching
    // a submit event directly would miss the original silent save regression.
    async submit() { const target = this.form().querySelector<HTMLButtonElement>('button[type="submit"]')!; assert.ok(target); assert.equal(target.disabled, false); await act(async () => target.click()); },
    footerAlert() { const alert = this.form().lastElementChild?.querySelector<HTMLElement>('[role="alert"]'); assert.ok(alert, 'The form must expose its error beside the save controls'); return alert; },
    async valid() { await this.fill('Card name', 'Synthetic validation card'); await this.fill('Category', 'Sports cards'); await this.fill('Current location', locationId); await this.fill('Card acquisition cost', '10.00'); await this.fill('Expected sale price per card', '25.00'); },
    async date(value: string) { const summary = [...this.form().querySelectorAll('summary')].find(e => e.textContent?.startsWith('More details'))!; await act(async () => summary.click()); await this.fill('Entry date and time', value); await act(async () => summary.click()); assert.equal(this.input('Entry date and time').closest('details')?.open, false); },
    async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); },
  };
  return api;
}

test('a real save click exposes every missing required field instead of being intercepted by native validation', async () => {
  const ui = await mount();
  try {
    await ui.date('');
    await ui.fill('Card acquisition cost', '10.00');
    await ui.fill('Expected sale price per card', '25.00');
    await ui.submit();
    assert.equal(ui.submits(), 1, 'The app must receive a real submit even when required fields are empty');
    assert.equal(ui.posts.length, 0);
    ui.footerAlert();
    for (const label of ['Card name', 'Category', 'Current location', 'Location type', 'Entry date and time']) assert.equal(ui.input(label).getAttribute('aria-invalid'), 'true', `${label} needs an actionable error`);
    assert.equal(ui.input('Entry date and time').closest('details')?.open, true, 'Every invalid disclosure must open, including later fields');
    await until(() => document.activeElement === ui.input('Card name'));
    assert.equal(ui.input('Card acquisition cost').value, '10.00');
    assert.equal(ui.input('Expected sale price per card').value, '25.00');
  } finally { await ui.close(); }
});

test('missing GPS destination is explained and manual selection allows the same entry to save', async () => {
  const ui = await mount();
  try {
    await ui.valid(); await ui.fill('Current location', '');
    await ui.submit();
    assert.equal(ui.submits(), 1); assert.equal(ui.posts.length, 0); ui.footerAlert();
    assert.equal(ui.input('Current location').getAttribute('aria-invalid'), 'true');
    assert.equal(ui.input('Location type').getAttribute('aria-invalid'), 'true');
    await until(() => document.activeElement === ui.input('Current location'));
    await ui.fill('Current location', locationId); await ui.submit();
    await until(() => captureProps.open);
    assert.equal(ui.posts.length, 1); assert.equal(ui.posts[0].destination?.location_id, locationId); assert.equal(ui.posts[0].destination?.kind, 'hq');
    assert.equal(ui.posts[0].total_cost_cents, 1000); assert.equal(ui.posts[0].expected_price_cents, 2500);
    assert.equal(captureProps.autoStartCamera, false, 'Async receipt must not request a new camera permission');
  } finally { await ui.close(); }
});

for (const [caseName, date] of [['an empty', ''], ['a future', '2099-01-01T12:00']] as const) test(`${caseName} date inside closed More details is revealed and focused on a real save click`, async () => {
  const ui = await mount();
  try {
    await ui.valid(); await ui.date(date); await ui.submit();
    assert.equal(ui.submits(), 1); assert.equal(ui.posts.length, 0); ui.footerAlert();
    const field = ui.input('Entry date and time');
    assert.equal(field.getAttribute('aria-invalid'), 'true');
    await until(() => field.closest('details')?.open === true && document.activeElement === field);
    assert.equal(ui.input('Card name').value, 'Synthetic validation card');
  } finally { await ui.close(); }
});

test('explicit validation retains required machine identifiers and physical loading confirmation', async () => {
  const ui = await mount();
  try {
    await ui.valid(); await ui.fill('Location type', 'machine'); await ui.submit();
    assert.equal(ui.submits(), 1); assert.equal(ui.posts.length, 0); ui.footerAlert();
    assert.equal(ui.input('Machine number').getAttribute('aria-invalid'), 'true');
    assert.equal(ui.input('Machine product number').getAttribute('aria-invalid'), 'true');
    const confirmation = ui.form().querySelector<HTMLInputElement>('input[type="checkbox"][required]')!;
    assert.ok(confirmation); assert.equal(confirmation.getAttribute('aria-invalid'), 'true');
  } finally { await ui.close(); }
});

test('batch quantity remains bounded when browser validation no longer intercepts submit', async () => {
  const ui = await mount();
  try {
    await ui.valid(); await ui.click('Batch of cards');
    const quantity = ui.form().querySelector<HTMLInputElement>('input[type="number"]')!;
    assert.ok(quantity);
    for (const value of ['', '2001']) {
      await ui.fill(quantity.getAttribute('aria-label')!, value); await ui.submit();
      assert.equal(ui.posts.length, 0); ui.footerAlert(); assert.equal(quantity.getAttribute('aria-invalid'), 'true');
    }
    await ui.fill(quantity.getAttribute('aria-label')!, '3'); await ui.submit();
    await until(() => !ui.container.querySelector('form'));
    assert.equal(ui.posts.length, 1); assert.equal(ui.posts[0].quantity, 3); assert.equal(ui.posts[0].total_cost_cents, 1000);
  } finally { await ui.close(); }
});

for (const [label, invalid, cents] of [['Card acquisition cost', '10.000', 1000], ['Expected sale price per card', '25,00', 2500]] as const) test(`invalid ${label.toLowerCase()} remains editable with a visible error and corrected values save`, async () => {
  const ui = await mount();
  try {
    await ui.valid(); await ui.fill(label, invalid); await ui.submit();
    assert.equal(ui.posts.length, 0); ui.footerAlert();
    assert.equal(ui.input(label).getAttribute('aria-invalid'), 'true');
    await until(() => document.activeElement === ui.input(label));
    await ui.fill(label, (cents / 100).toFixed(2)); await ui.submit();
    await until(() => captureProps.open); assert.equal(ui.posts.length, 1);
    assert.equal(ui.posts[0].total_cost_cents, 1000); assert.equal(ui.posts[0].expected_price_cents, 2500);
  } finally { await ui.close(); }
});

test('server rejection exposes an editable recovery at the save controls and preserves the entry', async () => {
  const ui = await mount((command, attempt) => attempt === 1 ? json({ message: 'Synthetic rejected location' }, 400) : json({ request_id: command.request_id, outcome: 'RECORDED' }));
  try {
    await ui.valid(); await ui.submit();
    await until(() => ui.container.textContent!.includes('Synthetic rejected location'));
    assert.match(ui.footerAlert().textContent ?? '', /Synthetic rejected location/);
    const edit = ui.button('Edit entry'); assert.ok(edit.closest('form'), 'Recovery must accompany the footer controls');
    assert.equal(captureProps.open, false); assert.ok(sessionStorage.getItem(pendingKey));
    await ui.click('Edit entry');
    assert.equal(ui.input('Card name').value, 'Synthetic validation card'); assert.equal(ui.input('Card acquisition cost').value, '10.00');
    await ui.fill('Card acquisition cost', '12.00'); await ui.submit();
    await until(() => captureProps.open); assert.equal(ui.posts.length, 2);
    assert.notEqual(ui.posts[0].request_id, ui.posts[1].request_id); assert.equal(ui.posts[1].total_cost_cents, 1200);
    assert.equal(sessionStorage.getItem(pendingKey), null);
  } finally { await ui.close(); }
});

test('a missing acknowledgement exposes exact retry and advances only after matching confirmation', async () => {
  const ui = await mount((command, attempt) => attempt === 1 ? json({ outcome: 'RECORDED' }) : json({ request_id: command.request_id, outcome: 'REPLAY' }));
  try {
    await ui.valid(); await ui.submit();
    await until(() => ui.container.textContent!.includes('Save could not be confirmed'));
    assert.match(ui.footerAlert().textContent ?? '', /Save could not be confirmed/);
    assert.equal(captureProps.open, false); assert.equal(ui.posts.length, 1);
    const saved = JSON.parse(sessionStorage.getItem(pendingKey)!); assert.deepEqual(saved.command, ui.posts[0]);
    assert.ok(ui.button('Retry saved entry').closest('form'), 'Exact retry must be reachable beside the save control');
    await ui.click('Retry saved entry');
    await until(() => captureProps.open); assert.equal(ui.posts.length, 2); assert.deepEqual(ui.posts[1], ui.posts[0]);
    assert.equal(sessionStorage.getItem(pendingKey), null);
  } finally { await ui.close(); }
});

test('camera entry shows GPS refinement and reuses the refined location across confirmed cards', async () => {
  let receive: PositionCallback | undefined, watches = 0;
  const cleared: number[] = [];
  const ui = await mount(undefined, {
    watchPosition(success, _failure, options) { watches++; receive = success; assert.equal(options?.enableHighAccuracy, true); assert.equal(options?.maximumAge, 0); return 41; },
    clearWatch(id) { cleared.push(id); },
    getCurrentPosition() { assert.fail('The browser should refine a watch instead of accepting one coarse reading'); },
  });
  const position = (accuracy: number) => ({ coords: { latitude: 35, longitude: -78, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() }) as GeolocationPosition;
  try {
    await ui.click('Take photo'); await until(() => !!receive);
    await act(async () => receive!(position(500)));
    assert.match(captureProps.locationStatus ?? '', /500 m.*Improving the signal/);
    assert.equal(ui.input('Current location').value, '', 'A coarse reading must not silently assign a location');
    await act(async () => receive!(position(10)));
    await until(() => ui.input('Current location').value === locationId);
    assert.deepEqual(cleared, [41]);
    for (const name of ['First synthetic card', 'Second synthetic card']) {
      await ui.click('Close camera fixture');
      await ui.fill('Card name', name); await ui.fill('Category', 'Sports cards');
      await ui.fill('Card acquisition cost', '10.00'); await ui.fill('Expected sale price per card', '25.00');
      await ui.submit(); await until(() => captureProps.open);
      assert.equal(ui.input('Current location').value, locationId);
      assert.equal(captureProps.autoStartCamera, false);
    }
    assert.equal(ui.posts.length, 2); assert.equal(watches, 1); assert.deepEqual(cleared, [41]);
  } finally { await ui.close(); }
});
