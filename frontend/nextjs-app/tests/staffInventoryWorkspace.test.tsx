import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { webcrypto } from 'node:crypto';
import type { StaffInventoryWorkspace as WorkspaceData } from '@tenkings/database';
import type { PreparedStaffInventoryPhoto } from '../lib/inventoryPhotoUpload';

const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const cssLoader = require.extensions['.css'];
require.extensions['.css'] = module => { module.exports = {}; };
const photoPath = require.resolve('../lib/inventoryPhotoUpload');
const photoModule = require(photoPath) as typeof import('../lib/inventoryPhotoUpload');
const photoCache = require.cache[photoPath]!;
let prepare: typeof photoModule.prepareStaffInventoryPhoto;
require.cache[photoPath] = { ...photoCache, exports: { ...photoModule, prepareStaffInventoryPhoto: (...args: Parameters<typeof prepare>) => prepare(...args) } };
const Workspace = require('../components/admin/StaffInventoryWorkspace').default as typeof import('../components/admin/StaffInventoryWorkspace').default;
require.cache[photoPath] = photoCache;
if (cssLoader) require.extensions['.css'] = cssLoader; else delete require.extensions['.css'];

const prepared: PreparedStaffInventoryPhoto = { image: 'data:image/jpeg;base64,fixture', byteSize: 7, width: 100, height: 140 };
const photoKey = 'inventory-photos/fixture/new.jpg', photoUrl = 'https://fixture.invalid/private/new.jpg';
const draftKey = 'tenkings:staff-inventory:draft:fixture-admin', pendingKey = 'tenkings:staff-inventory:pending:fixture-admin';
const location = { id: '11111111-1111-4111-8111-111111111111', name: 'FIXTURE HQ', slug: 'fixture-hq', address: 'Fixture address', locationType: 'hq' };
const values = { cost_cents: 100, expected_sales_cents: 200, expected_profit_cents: 100, expected_margin_pct: 50, costed_units: 1, priced_units: 1, known_cost_subtotal_cents: 100, value_overflow: false };
const item: WorkspaceData['items'][number] & { photo_url: string } = {
  id: 'fixture-item', lot_id: 'fixture-lot', name: 'Fixture card', category: 'Sports cards', notes: 'Existing description',
  photo_key: 'inventory-photos/fixture/existing.jpg', photo_url: 'https://fixture.invalid/private/existing.jpg',
  location_id: location.id, location_name: location.name, custody_id: 'hq:fixture', batch_id: null, machine_scope: null, last_count: null,
  stage: 'unprocessed', product_id: null, quantity: 1, quantity_kind: 'on_hand', expected_price_cents: 200, ...values,
  unit_ids: ['fixture-unit'], units: [{ id: 'fixture-unit', number: 1, cost_cents: 100, expected_price_cents: 200, permanent_card_id: null, pack_id: null, planned_location_name: null }],
  receipt_quantity: 1, purchase_total_cents: 100, created_at: '2026-01-01T00:00:00.000Z', origin: 'existing',
  provenance: { receipt: 'fixture-receipt', description: 'fixture-description', cost: null, price: null, custody: 'fixture-custody' },
};
const initial: WorkspaceData = { version: 1, sequence: 0, items: [item], locations: [location], machines: [], products: [], totals: { on_hand: 1, machine_roster: 0, groups: 1, locations: 1, ...values }, updated_at: null };
const addDraft = { origin: 'purchase', type: 'single', name: 'New fixture card', category: 'Sports cards', cost: '1.00', price: '2.00', location: location.id, kind: 'hq', stage: 'unprocessed', date: '2026-01-02T12:00', note: 'Keep this receipt note', photo_key: null, photo_url: null };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function until(check: () => boolean) { for (let i = 0; i < 100 && !check(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5))); assert.ok(check(), 'UI did not settle'); }

async function mount(fetcher: typeof fetch = async () => json(initial)) {
  prepare = async () => prepared;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://fixture.invalid/admin/physical-inventory', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  set('window', dom.window); set('self', dom.window); set('document', dom.window.document); set('navigator', dom.window.navigator);
  set('sessionStorage', dom.window.sessionStorage); set('fetch', fetcher); set('crypto', webcrypto); set('IS_REACT_ACT_ENVIRONMENT', true);
  const viewport = Object.assign(new dom.window.EventTarget(), { height: 844, offsetTop: 0 });
  Object.defineProperty(dom.window, 'visualViewport', { configurable: true, value: viewport });
  sessionStorage.setItem(draftKey, JSON.stringify(addDraft));
  const container = dom.window.document.getElementById('root') as HTMLElement, root = createRoot(container);
  await act(async () => root.render(<Workspace token="fixture-human-token" adminId="fixture-admin" onAdvanced={() => {}} />));
  await until(() => !!container.textContent?.includes('Fixture card'));
  return {
    container, dom, viewport,
    button(text: string) { const button = [...container.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(button, `Missing button ${text}`); return button; },
    async click(text: string) { const button = this.button(text); assert.equal(button.disabled, false, text); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); },
    async edit() { const button = container.querySelector<HTMLButtonElement>('button[aria-label="Open Fixture card"]')!; await act(async () => button.click()); await this.click('Edit details & price'); },
    input(label: string) { const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`); assert.ok(input, `Missing input ${label}`); return input; },
    async choose(file: File, source: 'camera' | 'library' = 'library') { const input = this.input(source === 'camera' ? 'Take inventory photo' : 'Choose inventory photo'); Object.defineProperty(input, 'files', { configurable: true, value: [file] }); await act(async () => Simulate.change(input)); },
    async submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); },
    submitButton() { return container.querySelector<HTMLButtonElement>('button[type="submit"]')!; },
    async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); },
  };
}

test('add and edit expose separate rear-camera and library inputs; cancelling the picker preserves the entry', async () => {
  const ui = await mount();
  try {
    await ui.click('Add inventory');
    for (const editing of [false, true]) {
      if (editing) { await ui.click('Cancel'); await ui.edit(); }
      const camera = ui.input('Take inventory photo'), library = ui.input('Choose inventory photo');
      assert.equal(camera.capture || camera.getAttribute('capture'), 'environment'); assert.equal(library.hasAttribute('capture'), false);
      assert.equal(camera.accept, photoModule.STAFF_INVENTORY_PHOTO_ACCEPT); assert.equal(library.accept, photoModule.STAFF_INVENTORY_PHOTO_ACCEPT);
      assert.match(library.accept, /\.heic/); assert.match(library.accept, /\.heif/); assert.equal(camera.tabIndex, -1); assert.equal(library.tabIndex, -1);
      let cameraOpened = 0, libraryOpened = 0;
      camera.addEventListener('click', () => cameraOpened++); library.addEventListener('click', () => libraryOpened++);
      await ui.click('Take photo'); await ui.click('Choose photo'); assert.equal(cameraOpened, 1); assert.equal(libraryOpened, 1);
      await act(async () => library.dispatchEvent(new ui.dom.window.Event('cancel', { bubbles: true })));
      assert.equal(ui.input('Card name').value, editing ? item.name : addDraft.name); assert.equal(ui.submitButton().disabled, false);
      if (editing) assert.equal(ui.container.querySelector<HTMLImageElement>('img[alt="Inventory photo"]')?.src, item.photo_url);
    }
  } finally { await ui.close(); }
});

test('save waits through photo preparation and upload, then exact inventory retry preserves the ready photo', async () => {
  const decode = deferred<PreparedStaffInventoryPhoto>(), upload = deferred<Response>(); const posts: string[] = []; let uploads = 0;
  const ui = await mount(async (url, init) => {
    if (String(url).endsWith('/photo')) { uploads++; assert.deepEqual(JSON.parse(String(init?.body)), { image: prepared.image }); return upload.promise; }
    if (init?.method !== 'POST') return json(initial);
    posts.push(String(init.body)); if (posts.length === 1) throw new Error('Fixture response lost');
    return json({ outcome: 'REPLAY', request_id: JSON.parse(posts[0]).request_id });
  });
  try {
    prepare = () => decode.promise;
    await ui.click('Add inventory'); await ui.choose(new ui.dom.window.File(['fixture'], 'phone.HEIC', { type: 'image/heic' }), 'camera');
    assert.equal(ui.submitButton().disabled, true); await ui.submit(); assert.equal(posts.length, 0); assert.equal(uploads, 0);
    await act(async () => decode.resolve(prepared)); await until(() => uploads === 1);
    assert.equal(ui.submitButton().disabled, true); await ui.submit(); assert.equal(posts.length, 0);
    assert.equal(JSON.parse(sessionStorage.getItem(draftKey)!).photo_key, null);
    await act(async () => upload.resolve(json({ photo_key: photoKey, photo_url: photoUrl })));
    await until(() => !ui.submitButton().disabled); assert.equal(JSON.parse(sessionStorage.getItem(draftKey)!).photo_key, photoKey);
    await ui.submit(); await until(() => !!sessionStorage.getItem(pendingKey));
    assert.equal(JSON.parse(posts[0]).description.photo_key, photoKey); assert.equal(JSON.parse(posts[0]).description.notes, addDraft.note);
    await ui.click('Retry saved entry'); await until(() => !sessionStorage.getItem(pendingKey));
    assert.equal(posts.length, 2); assert.equal(posts[0], posts[1]); assert.equal(uploads, 1);
  } finally { await ui.close(); }
});

test('a failed replacement retains the old photo and retries the same selected file without dropping edits', async () => {
  let uploads = 0; const files: File[] = [], posts: string[] = [];
  const ui = await mount(async (url, init) => {
    if (String(url).endsWith('/photo')) { uploads++; return uploads === 1 ? json({ message: 'Fixture upload interrupted.' }, 503) : json({ photo_key: photoKey, photo_url: photoUrl }); }
    if (init?.method === 'POST') { posts.push(String(init.body)); return json({ outcome: 'RECORDED', request_id: JSON.parse(String(init.body)).request_id }); }
    return json(initial);
  });
  try {
    prepare = async file => { files.push(file); return prepared; };
    await ui.edit(); await act(async () => Simulate.change(ui.input('Card name'), { target: { value: 'Edited fixture name' } } as any));
    const file = new ui.dom.window.File(['fixture'], 'same-file.heif', { type: '' }); await ui.choose(file);
    await until(() => !!ui.container.textContent?.includes('Fixture upload interrupted.'));
    assert.equal(ui.input('Card name').value, 'Edited fixture name'); assert.equal(ui.submitButton().disabled, true);
    await ui.submit(); assert.equal(posts.length, 0); assert.ok(ui.button('Keep current photo'));
    await ui.click('Retry photo'); await until(() => !ui.submitButton().disabled);
    assert.deepEqual(files, [file, file]); await ui.submit(); await until(() => posts.length === 1);
    assert.equal(JSON.parse(posts[0]).description.name, 'Edited fixture name'); assert.equal(JSON.parse(posts[0]).description.photo_key, photoKey);
  } finally { await ui.close(); }
});

test('a failed photo requires explicit keep-current or continue-without before saving', async () => {
  const posts: string[] = [];
  const ui = await mount(async (_url, init) => {
    if (init?.method !== 'POST') return json(initial);
    posts.push(String(init.body)); return json({ outcome: 'RECORDED', request_id: JSON.parse(String(init.body)).request_id });
  });
  try {
    prepare = async () => { throw new Error('Fixture unsupported photo.'); };
    for (const editing of [false, true]) {
      if (editing) await ui.edit(); else await ui.click('Add inventory');
      await ui.choose(new ui.dom.window.File(['fixture'], 'bad.heic'));
      await until(() => !!ui.container.textContent?.includes('Fixture unsupported photo.'));
      assert.equal(ui.submitButton().disabled, true); await ui.submit(); assert.equal(posts.length, editing ? 1 : 0);
      await ui.click(editing ? 'Keep current photo' : 'Continue without photo'); assert.equal(ui.submitButton().disabled, false);
      await ui.submit(); await until(() => !ui.container.querySelector('form'));
      assert.equal(JSON.parse(posts.at(-1)!).description.photo_key, editing ? item.photo_key : null);
    }
  } finally { await ui.close(); }
});

test('closing during preparation aborts it and a delayed completion cannot attach to another form', async () => {
  const decode = deferred<PreparedStaffInventoryPhoto>(); let signal: AbortSignal | undefined, uploads = 0;
  const ui = await mount(async (url) => { if (String(url).endsWith('/photo')) uploads++; return json(initial); });
  try {
    prepare = (_file, options) => { signal = options?.signal; return decode.promise; };
    await ui.click('Add inventory'); await ui.choose(new ui.dom.window.File(['fixture'], 'phone.heic'));
    await ui.click('Cancel'); assert.equal(signal?.aborted, true);
    await ui.edit(); await act(async () => decode.resolve(prepared));
    assert.equal(uploads, 0); assert.equal(ui.input('Card name').value, item.name); assert.equal(ui.submitButton().disabled, false);
    assert.equal(ui.container.querySelector<HTMLImageElement>('img[alt="Inventory photo"]')?.src, item.photo_url);
    assert.equal(JSON.parse(sessionStorage.getItem(draftKey)!).name, addDraft.name);
  } finally { await ui.close(); }
});

test('cancelling an active upload ignores its late response and keeps the saved photo', async () => {
  const upload = deferred<Response>(); let signal: AbortSignal | undefined;
  const ui = await mount(async (url, init) => { if (String(url).endsWith('/photo')) { signal = init?.signal as AbortSignal; return upload.promise; } return json(initial); });
  try {
    await ui.edit(); await ui.choose(new ui.dom.window.File(['fixture'], 'phone.jpg')); await until(() => !!signal);
    await ui.click('Cancel photo'); assert.equal(signal?.aborted, true); assert.equal(ui.submitButton().disabled, false);
    await act(async () => upload.resolve(json({ photo_key: photoKey, photo_url: photoUrl })));
    assert.equal(ui.container.querySelector<HTMLImageElement>('img[alt="Inventory photo"]')?.src, item.photo_url);
    assert.doesNotMatch(ui.container.textContent!, /Photo ready/);
  } finally { await ui.close(); }
});

test('the drawer follows the visible keyboard viewport and native picker inputs stay out of the tab cycle', async () => {
  const ui = await mount();
  try {
    await ui.click('Add inventory'); const dialog = ui.container.querySelector<HTMLElement>('[role="dialog"]')!, overlay = dialog.parentElement!;
    assert.equal(overlay.style.getPropertyValue('--inventory-viewport-height'), '844px');
    ui.viewport.height = 380; ui.viewport.offsetTop = 18;
    await act(async () => ui.viewport.dispatchEvent(new ui.dom.window.Event('resize')));
    assert.equal(overlay.style.getPropertyValue('--inventory-viewport-height'), '380px'); assert.equal(overlay.style.getPropertyValue('--inventory-viewport-top'), '18px');
    const last = ui.submitButton(); last.focus();
    await act(async () => document.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'Close inventory details');
    assert.ok([...dialog.querySelectorAll<HTMLInputElement>('input[type="file"]')].every(input => input.tabIndex === -1));
  } finally { await ui.close(); }
});
