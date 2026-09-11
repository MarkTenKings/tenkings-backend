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
let captureProps: React.ComponentProps<typeof import('../components/admin/StaffInventoryCardCapture').default>;
const capturePath = require.resolve('../components/admin/StaffInventoryCardCapture');
const captureCache = require.cache[capturePath];
require.cache[capturePath] = { id: capturePath, filename: capturePath, loaded: true, exports: { __esModule: true, default: (props: typeof captureProps) => { captureProps = props; return props.open ? <div data-camera-fixture="true"><button onClick={props.onClose}>Close camera fixture</button></div> : null; } } } as NodeModule;
const Workspace = require('../components/admin/StaffInventoryWorkspace').default as typeof import('../components/admin/StaffInventoryWorkspace').default;
require.cache[photoPath] = photoCache;
if (captureCache) require.cache[capturePath] = captureCache; else delete require.cache[capturePath];
if (cssLoader) require.extensions['.css'] = cssLoader; else delete require.extensions['.css'];

const prepared: PreparedStaffInventoryPhoto = { image: 'data:image/jpeg;base64,fixture', byteSize: 7, width: 100, height: 140 };
const keyFor = (number: number) => `inventory-photos/11111111-1111-4111-8111-111111111111/${number.toString(16).padStart(64, '0')}.jpg`;
const photoKey = keyFor(1), photoUrl = 'https://fixture.invalid/private/new.jpg';
const draftKey = 'tenkings:staff-inventory:draft:fixture-admin', pendingKey = 'tenkings:staff-inventory:pending:fixture-admin';
const location = { id: '11111111-1111-4111-8111-111111111111', name: 'FIXTURE HQ', slug: 'fixture-hq', address: 'Fixture address', locationType: 'hq' };
const values = { cost_cents: 100, expected_sales_cents: 200, expected_profit_cents: 100, expected_margin_pct: 50, costed_units: 1, priced_units: 1, known_cost_subtotal_cents: 100, value_overflow: false };
const item: WorkspaceData['items'][number] & { photo_url: string } = {
  id: 'fixture-item', lot_id: 'fixture-lot', name: 'Fixture card', category: 'Sports cards', notes: 'Existing description',
  photo_key: 'inventory-photos/fixture/existing.jpg', photo_url: 'https://fixture.invalid/private/existing.jpg',
  back_photo_key: null, card_details: null, planned_sales_channel: null, location_id: location.id, location_name: location.name, custody_id: 'hq:fixture', batch_id: null, machine_scope: null, last_count: null,
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

async function mount(fetcher: typeof fetch = async () => json(initial), saved: typeof addDraft | null = addDraft) {
  prepare = async () => prepared;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://fixture.invalid/admin/physical-inventory', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  set('window', dom.window); set('self', dom.window); set('document', dom.window.document); set('navigator', dom.window.navigator);
  set('sessionStorage', dom.window.sessionStorage); set('fetch', fetcher); set('crypto', webcrypto); set('IS_REACT_ACT_ENVIRONMENT', true);
  const viewport = Object.assign(new dom.window.EventTarget(), { height: 844, offsetTop: 0 });
  Object.defineProperty(dom.window, 'visualViewport', { configurable: true, value: viewport });
  if (saved) sessionStorage.setItem(draftKey, JSON.stringify(saved));
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
    async fill(label: string, value: string) { await act(async () => Simulate.change(this.input(label), { target: { value } } as any)); },
    async pair() { const files = [new dom.window.File(['front'], 'front.jpg', { type: 'image/jpeg' }), new dom.window.File(['back'], 'back.jpg', { type: 'image/jpeg' })] as unknown as [File, File]; await act(async () => { captureProps.onPair(...files); }); return files; },
    camera() { return captureProps; },
    async submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); },
    submitButton() { return container.querySelector<HTMLButtonElement>('button[type="submit"]')!; },
    async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); },
  };
}


function identification(body: string, overrides: Record<string, unknown> = {}) {
  const keys = JSON.parse(body);
  return { suggestions: Object.fromEntries(Object.entries({ name: 'Read card name', category: 'Sports cards', manufacturer: 'Read manufacturer', card_number: '007', year: '2024', set_name: 'Fixture set', variant: 'Gold', card_type: 'Base' }).map(([key, value]) => [key, { value, confidence: 'high', evidence: 'Printed on card' }])), warnings: [], provenance: { model: 'gpt-6-astra', reasoning_effort: 'low', identified_at: new Date().toISOString(), elapsed_ms: 100, ocr: { provider: 'google_vision', front: 'read', back: 'read' }, photos: { front: { key: keys.front_photo_key, sha256: keys.front_photo_key.split('/').pop().slice(0,64) }, back: { key: keys.back_photo_key, sha256: keys.back_photo_key.split('/').pop().slice(0,64) } } }, ...overrides };
}
function api(options: { identify?: (body: string) => Promise<Response>; upload?: (number: number, init?: RequestInit) => Promise<Response>; save?: (body: string) => Promise<Response> } = {}) {
  let uploads = 0;
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/photo')) return options.upload ? options.upload(++uploads, init) : json({ photo_key: keyFor(++uploads), photo_url: `${photoUrl}-${uploads}` });
    if (String(url).endsWith('/identify')) return options.identify ? options.identify(String(init?.body)) : json(identification(String(init?.body)));
    if (init?.method === 'POST') return options.save ? options.save(String(init.body)) : json({ outcome: 'RECORDED', request_id: JSON.parse(String(init.body)).request_id });
    return json(initial);
  };
}

test('new entries default to individual cards, with direct camera/library and no initial stock or condition choices', async () => {
  const ui = await mount(api(), null);
  try {
    await ui.click('Add inventory');
    assert.equal(ui.input('Card name').value, '');
    assert.equal(ui.container.querySelector('[aria-label="Current condition"]'), null);
    assert.equal([...ui.container.querySelectorAll('button')].some(b => b.textContent === 'Current stock' || b.textContent === 'New purchase'), false);
    await ui.click('Take photo'); assert.equal(ui.camera().open, true); assert.equal(ui.camera().initialSource, 'camera');
    await ui.click('Close camera fixture'); await ui.click('Choose photos');
    assert.equal(ui.camera().initialSource, 'library');
    await ui.click('Close camera fixture'); assert.equal(ui.input('Card name').value, '');
  } finally { await ui.close(); }
});

test('paired upload and Astra fill only untouched descriptive fields; staff edits and money always win', async () => {
  const decode = deferred<PreparedStaffInventoryPhoto>(), identity = deferred<Response>(); let identityBody = ''; let writes = 0;
  const ui = await mount(api({ identify: async body => { identityBody = body; return identity.promise; }, save: async body => { writes++; return json({ outcome: 'RECORDED', request_id: JSON.parse(body).request_id }); } }));
  try {
    await ui.click('Add inventory'); prepare = () => decode.promise; await ui.pair();
    assert.equal(ui.submitButton().disabled, true); await ui.submit(); assert.equal(writes, 0);
    await ui.fill('Card name', 'Staff corrected during upload');
    await ui.fill('Card acquisition cost', '10.50'); await ui.fill('Expected sale price per card', '42.00');
    await act(async () => decode.resolve(prepared)); await until(() => !!identityBody);
    await ui.fill('Manufacturer', 'Staff corrected during analysis'); await ui.fill('Sales channel', 'Whatnot');
    await act(async () => identity.resolve(json(identification(identityBody)))); await until(() => !ui.submitButton().disabled);
    assert.equal(ui.input('Card name').value, 'Staff corrected during upload'); assert.equal(ui.input('Manufacturer').value, 'Staff corrected during analysis');
    assert.equal(ui.input('Card number').value, '007'); assert.equal(ui.input('Year').value, '2024'); assert.equal(ui.input('Sales channel').value, 'Whatnot');
    assert.equal(ui.input('Card acquisition cost').value, '10.50'); assert.equal(ui.input('Expected sale price per card').value, '42.00');
    const saved = JSON.parse(sessionStorage.getItem(draftKey)!); assert.ok(saved.photo_key && saved.back_photo_key); assert.notEqual(saved.photo_key, saved.back_photo_key);
  } finally { await ui.close(); }
});

test('uncertain saves retry exact bytes; only acknowledgement resets the card and opens the next camera', async () => {
  const posts: string[] = []; const ui = await mount(api({ save: async body => { posts.push(body); if (posts.length === 1) throw new Error('Response lost'); return json({ outcome: posts.length === 2 ? 'REPLAY' : 'RECORDED', request_id: JSON.parse(body).request_id }); } }));
  try {
    await ui.click('Add inventory'); await ui.click('Choose photos'); await ui.pair(); await until(() => !ui.submitButton().disabled);
    await ui.fill('Sales channel', 'Amazon'); await ui.submit(); await until(() => !!sessionStorage.getItem(pendingKey));
    assert.equal(ui.camera().open, false); const first = JSON.parse(posts[0]);
    assert.equal(first.description.planned_sales_channel, 'Amazon'); assert.equal(first.description.card_details.card_number, '007'); assert.ok(first.description.back_photo_key);
    await ui.click('Retry saved entry'); await until(() => !sessionStorage.getItem(pendingKey));
    assert.equal(posts[0], posts[1]); assert.equal(ui.camera().open, true); assert.equal(ui.camera().initialSource, 'camera');
    assert.equal(ui.input('Card name').value, ''); assert.equal(ui.input('Card acquisition cost').value, ''); assert.equal(ui.input('Expected sale price per card').value, '');
    assert.equal(ui.input('Current location').value, location.id); assert.equal(ui.input('Location type').value, 'hq'); assert.equal(ui.input('Sales channel').value, '');
    assert.equal(ui.container.querySelectorAll('img[alt="Front of inventory card"]').length, 0);
    await ui.pair(); await until(() => !ui.submitButton().disabled); await ui.fill('Card acquisition cost', '3.00'); await ui.fill('Expected sale price per card', '8.00');
    await ui.submit(); await until(() => posts.length === 3 && ui.camera().open);
    const second = JSON.parse(posts[2]); assert.notEqual(first.request_id, second.request_id); assert.notEqual(first.description.photo_key, second.description.photo_key);
    assert.equal(second.description.planned_sales_channel, null); assert.equal(second.total_cost_cents, 300); assert.equal(second.expected_price_cents, 800);
  } finally { await ui.close(); }
});

test('unavailable identification leaves both photos ready for a manual card and never invents prices', async () => {
  let posted: any; const ui = await mount(api({ identify: async () => json({ message: 'Unavailable' }, 503), save: async body => { posted = JSON.parse(body); return json({ outcome: 'RECORDED', request_id: posted.request_id }); } }));
  try {
    await ui.click('Add inventory'); await ui.pair(); await until(() => !!ui.container.textContent?.includes('Card details could not be read'));
    assert.equal(ui.submitButton().disabled, false); assert.equal(ui.input('Card name').value, addDraft.name);
    await ui.submit(); await until(() => !!posted); assert.ok(posted.description.photo_key && posted.description.back_photo_key); assert.equal(posted.total_cost_cents, 100);
  } finally { await ui.close(); }
});

test('an identification response bound to different photos cannot overwrite this card', async () => {
  const ui = await mount(api({ identify: async body => json(identification(body, { provenance: { model: 'gpt-6-astra', photos: { front: { key: 'wrong' }, back: { key: 'wrong' } } } })) }));
  try { await ui.click('Add inventory'); await ui.pair(); await until(() => !ui.submitButton().disabled); assert.equal(ui.input('Card name').value, addDraft.name); assert.equal(ui.input('Card number').value, ''); assert.ok(ui.button('Retry identification')); }
  finally { await ui.close(); }
});

test('failed pair replacement preserves saved photos and edits; retry uses the same front and back', async () => {
  const files: File[] = []; let fail = true, posted: any;
  const ui = await mount(api({ upload: async number => fail ? json({}, 503) : json({ photo_key: keyFor(number), photo_url: `${photoUrl}-${number}` }), save: async body => { posted = JSON.parse(body); return json({ outcome: 'RECORDED', request_id: posted.request_id }); } }));
  try {
    await ui.edit(); await ui.fill('Card name', 'Keep staff name'); prepare = async file => { files.push(file); return prepared; }; const pair = await ui.pair();
    await until(() => !!ui.container.textContent?.includes('Both photos could not be saved')); assert.equal(ui.submitButton().disabled, true);
    assert.equal(ui.container.querySelector<HTMLImageElement>('img[alt="Front of inventory card"]')?.src, item.photo_url);
    fail = false; await ui.click('Retry photos'); await until(() => !ui.submitButton().disabled); assert.deepEqual(files, [...pair, ...pair]);
    await ui.submit(); await until(() => !!posted); assert.equal(posted.description.name, 'Keep staff name'); assert.ok(posted.description.back_photo_key);
  } finally { await ui.close(); }
});

test('closing a card aborts preparation and late results cannot attach to another form', async () => {
  const decode = deferred<PreparedStaffInventoryPhoto>(); let signal: AbortSignal | undefined, uploads = 0;
  const ui = await mount(api({ upload: async () => { uploads++; return json({}); } }));
  try {
    await ui.click('Add inventory'); prepare = (_file, options) => { signal = options?.signal; return decode.promise; }; await ui.pair();
    await ui.click('Cancel'); assert.equal(signal?.aborted, true); await ui.edit(); await act(async () => decode.resolve(prepared));
    assert.equal(uploads, 0); assert.equal(ui.input('Card name').value, item.name); assert.equal(ui.submitButton().disabled, false);
    assert.equal(ui.container.querySelector<HTMLImageElement>('img[alt="Front of inventory card"]')?.src, item.photo_url);
  } finally { await ui.close(); }
});

test('continuing manually cancels in-flight identity and ignores its late result', async () => {
  const identity = deferred<Response>(); let body = '', signal: AbortSignal | undefined;
  const base = api(); const ui = await mount(async (url, init) => { if (String(url).endsWith('/identify')) { body = String(init?.body); signal = init?.signal as AbortSignal; return identity.promise; } return base(url, init); });
  try {
    await ui.click('Add inventory'); await ui.pair(); await until(() => !!body); await ui.click('Continue manually'); assert.equal(signal?.aborted, true);
    await ui.fill('Card name', 'Manual card'); await act(async () => identity.resolve(json(identification(body))));
    assert.equal(ui.input('Card name').value, 'Manual card'); assert.equal(ui.input('Card number').value, ''); assert.equal(ui.submitButton().disabled, false);
  } finally { await ui.close(); }
});

test('batch photo controls keep rear-camera and HEIC library support with explicit failure recovery', async () => {
  const ui = await mount();
  try {
    await ui.click('Add inventory'); await ui.click('Batch of cards');
    const camera = ui.input('Take inventory photo'), library = ui.input('Choose inventory photo');
    assert.equal(camera.getAttribute('capture'), 'environment'); assert.equal(library.hasAttribute('capture'), false); assert.match(library.accept, /\.heic/); assert.equal(camera.tabIndex, -1);
    prepare = async () => { throw new Error('Photo unsupported'); }; await ui.choose(new ui.dom.window.File(['fixture'], 'bad.heic'));
    await until(() => !!ui.container.textContent?.includes('Photo unsupported')); assert.equal(ui.submitButton().disabled, true);
    await ui.click('Continue without photo'); assert.equal(ui.submitButton().disabled, false);
  } finally { await ui.close(); }
});

test('drawer follows the keyboard viewport and keyboard focus excludes hidden camera and collapsed details', async () => {
  const ui = await mount();
  try {
    await ui.click('Add inventory'); const dialog = ui.container.querySelector<HTMLElement>('[role="dialog"]')!, overlay = dialog.parentElement!;
    assert.equal(overlay.style.getPropertyValue('--inventory-viewport-height'), '844px'); ui.viewport.height = 380; ui.viewport.offsetTop = 18;
    await act(async () => ui.viewport.dispatchEvent(new ui.dom.window.Event('resize')));
    assert.equal(overlay.style.getPropertyValue('--inventory-viewport-height'), '380px'); assert.equal(overlay.style.getPropertyValue('--inventory-viewport-top'), '18px');
    ui.submitButton().focus(); await act(async () => document.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'Close inventory details');
  } finally { await ui.close(); }
});

test('retaking a card clears unsupported previous AI fields while preserving staff corrections', async () => {
  let reads = 0; const ui = await mount(api({ identify: async body => { const result = identification(body); if (++reads === 2) result.suggestions.year = { value: null as any, confidence: 'unknown', evidence: null as any }; return json(result); } }));
  try {
    await ui.click('Add inventory'); await ui.pair(); await until(() => !ui.submitButton().disabled); assert.equal(ui.input('Year').value, '2024');
    await ui.fill('Manufacturer', 'Staff manufacturer'); await ui.pair(); await until(() => !ui.submitButton().disabled);
    assert.equal(ui.input('Year').value, ''); assert.equal(ui.input('Manufacturer').value, 'Staff manufacturer');
  } finally { await ui.close(); }
});

test('restoring a cancelled draft preserves which identity fields the staff member corrected', async () => {
  const ui = await mount(api());
  try {
    await ui.click('Add inventory'); await ui.fill('Year', '1999'); await ui.click('Cancel'); await ui.click('Add inventory');
    await ui.pair(); await until(() => !ui.submitButton().disabled); assert.equal(ui.input('Year').value, '1999');
    assert.equal(ui.input('Card number').value, '007');
  } finally { await ui.close(); }
});

test('a stalled background inventory refresh never blocks the camera after a confirmed save', async () => {
  let saved = false; const never = deferred<Response>(), base = api({ save: async body => { saved = true; return json({ outcome: 'RECORDED', request_id: JSON.parse(body).request_id }); } });
  const ui = await mount(async (url, init) => saved && init?.method !== 'POST' ? never.promise : base(url, init));
  try {
    await ui.click('Add inventory'); await ui.submit(); await until(() => ui.camera().open && !ui.camera().disabled);
    assert.equal(sessionStorage.getItem(pendingKey), null); assert.equal(ui.camera().autoStartCamera, false);
  } finally { await ui.close(); }
});

test('GPS fills a unique location and refreshes it after expiry even when staff selected its custody type', async () => {
  const second = { ...location, id: '22222222-2222-4222-8222-222222222222', name: 'Second fixture store', locationType: 'store', latitude: 39, longitude: -121 };
  const located = { ...initial, locations: [{ ...location, latitude: 38, longitude: -121 }, second] };
  const ui = await mount(async () => json(located), null); const originalNow = Date.now; let now = originalNow(), fixes = 0;
  try {
    Date.now = () => now;
    Object.defineProperty(ui.dom.window.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (done: (position: unknown) => void) => { fixes++; done({ coords: { latitude: fixes === 1 ? 38 : 39, longitude: -121, accuracy: 10 }, timestamp: now }); } } });
    await ui.click('Add inventory'); await ui.click('Take photo'); await until(() => ui.input('Current location').value === location.id);
    assert.equal(ui.input('Location type').value, 'hq'); await ui.click('Close camera fixture'); await ui.fill('Location type', 'kiosk');
    assert.equal(JSON.parse(sessionStorage.getItem(draftKey)!).autoSelectedLocation, true);
    now += 310000; await ui.click('Take photo'); await until(() => ui.input('Current location').value === second.id);
    assert.equal(fixes, 2); assert.equal(ui.input('Location type').value, 'store');
  } finally { Date.now = originalNow; await ui.close(); }
});

test('a late GPS result cannot overwrite a location selected by staff', async () => {
  const located = { ...initial, locations: [{ ...location, latitude: 38, longitude: -121 }, { ...location, id: 'manual-site', name: 'Manual fixture site', latitude: 39, longitude: -121 }] };
  const ui = await mount(async () => json(located), null); let complete: ((position: unknown) => void) | undefined;
  try {
    Object.defineProperty(ui.dom.window.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (done: (position: unknown) => void) => { complete = done; } } });
    await ui.click('Add inventory'); await ui.click('Take photo'); await until(() => !!complete); await ui.click('Close camera fixture');
    await ui.fill('Current location', 'manual-site'); await act(async () => complete!({ coords: { latitude: 38, longitude: -121, accuracy: 10 }, timestamp: Date.now() }));
    assert.equal(ui.input('Current location').value, 'manual-site');
  } finally { await ui.close(); }
});


test('sales channel offers approved choices and an old draft starts undecided; cancel restores a chosen channel', async () => {
  const ui = await mount(api());
  try {
    await ui.click('Add inventory');
    const select = ui.input('Sales channel') as unknown as HTMLSelectElement;
    assert.equal(select.value, '');
    assert.deepEqual([...select.options].map(o => o.text), ['Not decided yet', 'Vending machines', 'Stores', 'Kiosks', 'Ten Kings online', 'eBay', 'Whatnot', 'Amazon']);
    const section = select.closest('section')!; assert.ok(section.textContent?.includes('3. Cost & expected price'));
    const before = section.textContent?.slice(section.textContent.indexOf('Expected gross profit'));
    await ui.fill('Sales channel', 'eBay');
    assert.equal(section.textContent?.slice(section.textContent.indexOf('Expected gross profit')), before);
    await ui.click('Cancel'); await ui.click('Add inventory'); assert.equal(ui.input('Sales channel').value, 'eBay');
  } finally { await ui.close(); }
});

test('editing retains a saved custom channel and staff can explicitly clear it without changing price or custody', async () => {
  const posts: any[] = [];
  const data = { ...initial, items: [{ ...item, planned_sales_channel: 'Card convention' }] };
  const ui = await mount(async (_url, init) => {
    if (init?.method === 'POST') { const body = JSON.parse(String(init.body)); posts.push(body); return json({ outcome: 'RECORDED', request_id: body.request_id }); }
    return json(data);
  });
  try {
    await ui.edit(); assert.equal(ui.input('Sales channel').value, 'Card convention');
    await ui.fill('Card name', 'Updated fixture'); await ui.submit(); await until(() => posts.length === 1);
    assert.equal(posts[0].description.planned_sales_channel, 'Card convention'); assert.equal(posts[0].expected_price_cents, 200);
    assert.equal(posts[0].destination, undefined); assert.equal(posts[0].total_cost_cents, undefined);
    await ui.edit(); await ui.fill('Sales channel', ''); await ui.submit(); await until(() => posts.length === 2);
    assert.equal(posts[1].description.planned_sales_channel, null);
  } finally { await ui.close(); }
});

test('saved channels are visible and searchable; channel filters and clear filters include undecided stock', async () => {
  const data = { ...initial, items: [{ ...item, planned_sales_channel: 'Whatnot' }, { ...item, id: 'second', name: 'Another card' }] };
  const ui = await mount(async () => json(data));
  const visible = () => [...ui.container.querySelectorAll('tbody tr')].map(row => row.textContent);
  try {
    assert.equal(visible().length, 2); assert.match(visible()[0] || '', /Whatnot/);
    await ui.fill('Filter by sales channel', 'channel:Whatnot'); assert.equal(visible().length, 1); assert.match(visible()[0] || '', /Fixture card/);
    await ui.fill('Filter by sales channel', '__unset'); assert.equal(visible().length, 1); assert.match(visible()[0] || '', /Another card/);
    await ui.fill('Filter by sales channel', 'channel:Amazon'); assert.ok(ui.container.textContent?.includes('No matching inventory'));
    await ui.click('Clear filters'); assert.equal(visible().length, 2);
    await ui.fill('Search inventory', 'whatnot'); assert.equal(visible().length, 1);
    const open = ui.container.querySelector<HTMLButtonElement>('button[aria-label="Open Fixture card"]')!; await act(async () => open.click());
    assert.ok(ui.container.querySelector('[role="dialog"]')?.textContent?.includes('Sales channelWhatnot'));
  } finally { await ui.close(); }
});
