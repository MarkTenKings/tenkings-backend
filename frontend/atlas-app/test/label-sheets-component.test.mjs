import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as api from '../lib/label-sheets-client.mjs';
import * as nfc from '../lib/gototags-nfc-export.mjs';
import * as geometry from '../../../packages/atlas-finishing/src/label-sheet-geometry.mjs';
const require = createRequire(new URL('../package.json', import.meta.url)), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/LabelSheets.jsx', import.meta.url), 'utf8'), { filename: 'LabelSheets.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code;
const all = (value, predicate, out = []) => { if (Array.isArray(value)) value.forEach(child => all(child, predicate, out)); else if (value && typeof value === 'object') { if (predicate(value)) out.push(value); all(value.props?.children, predicate, out); } return out; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
function data(number = 1, count = 3) {
  const sheetId = randomUUID(); const items = Array.from({ length: count }, (_, index) => ({ itemId: randomUUID(), sheetId, cardId: randomUUID(), approvalActionId: randomUUID(), approvalVersion: 2, purpose: 'ORIGINAL', originalItemId: null, slot: index + 1, state: 'READY', labelHash: 'a'.repeat(64), snapshot: { identity: { playerName: `Saved Player ${number}-${index + 1}`, year: '2024', productSet: 'Saved Set' }, grade: 9.5, reportNumber: `ATLAS-${number}-${index + 1}`, approvalVersion: 2, reportHref: `https://atlasgrading.com/reports/ar_${String(number * 50 + index).padStart(24, '0')}?v=2` } }));
  return { sheetId, number, state: 'OPEN', revision: count, occupied: count, capacity: 50, materialProfileId: 'atlas-v4-gold-v1', jigHash: geometry.LABEL_JIG_V1.jigHash, items, exports: [], printEvents: [] };
}
async function fixture({ sheets = [data()], staff: initialStaff = { id: randomUUID(), role: 'REVIEWER' }, error = null, saved = new Map(), hold = null, initialCardId = null, pendingItems = [], postError = null } = {}) {
  let staff = initialStaff, cursor = 0, dirty = false, tree, exports = {};
  const slots = [], effects = [], calls = [], timers = new Set();
  const changed = (a, b) => !a || b.some((value, i) => value !== a[i]);
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial; return [slots[id], value => { const next = typeof value === 'function' ? value(slots[id]) : value; if (!Object.is(slots[id], next)) { slots[id] = next; dirty = true; } }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useCallback(fn, deps) { const id = cursor++; if (changed(slots[id]?.deps, deps)) slots[id] = { deps, value: fn }; return slots[id].value; },
    useEffect(fn, deps) { const id = cursor++; if (changed(slots[id]?.deps, deps)) { const old = slots[id]; slots[id] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[id].cleanup = fn(); }); } },
  };
  const f = { sheets, calls, saved, error, hold, initialCardId, pendingItems, postError, downloads: [], blobs: new Map() };
  const request = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (url === '/api/staff/session') return { staff: { ...staff, ...f.sessionStaff }, csrf: 'csrf' };
    if (f.hold) { const value = f.hold(url, options); if (value) return value; }
    if (f.error) throw f.error;
    if (!options.method && f.pages && url.startsWith(api.LABEL_SHEETS_PATH) && !url.slice(api.LABEL_SHEETS_PATH.length).startsWith('/')) return f.pages[new URL(url, 'https://fixture.test').searchParams.get('cursor') ?? '0'];
    if (!options.method && url === api.LABEL_SHEETS_PATH) return { version: 'atlas-label-sheets-v1', rendererProfileHash: 'f'.repeat(64), sheets: f.sheets.map(value => ({ ...value })), items: f.listItems ?? f.sheets.flatMap(value => value.items), pending: f.pendingItems ?? [] };
    const sheet = f.sheets.find(value => url === `${api.LABEL_SHEETS_PATH}/${value.sheetId}` || url.startsWith(`${api.LABEL_SHEETS_PATH}/${value.sheetId}/`));
    if (options.method === 'POST') {
      if (f.postError) throw f.postError;
      if (url.endsWith('/layout-retries')) {
        const parent = f.pendingItems.find(item => url.includes(item.itemId));
        assert.ok(parent);
        const successor = { ...parent, itemId: randomUUID(), originalItemId: parent.itemId, purpose: 'LAYOUT_RETRY', state: 'PENDING_RENDER', failureHash: null };
        f.pendingItems = [successor]; return successor;
      }
      if (url.endsWith('/exports')) { const result = { exportId: randomUUID(), sheetId: sheet.sheetId, exportProfileId: options.body.exportProfileId, state: 'READY', sha256: 'c'.repeat(64), manifestHash: 'd'.repeat(64) }; sheet.state = 'SEALED'; sheet.exports = [result]; return result; }
      if (url.endsWith('/download')) return { exportProfileId: sheet.exports.find(value => url.includes(value.exportId)).exportProfileId, url: 'https://objects.example/exact.png', expiresAt: new Date(Date.now() + 60000).toISOString() };
      if (url.endsWith('/print-confirmations')) { const result = { eventId: randomUUID(), ...options.body }; sheet.printEvents.push(result); return result; }
    }
    if (sheet) return structuredClone(sheet);
    throw new Error(`Unexpected fixture path: ${url}`);
  };
  class BrowserURL extends URL { static createObjectURL(blob) { const url = `blob:${randomUUID()}`; f.blobs.set(url, blob); return url; } static revokeObjectURL() {} }
  vm.runInNewContext(code, { exports, crypto: { randomUUID }, URL: BrowserURL, Blob, setTimeout: fn => fn(), setInterval(fn) { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn), document: { visibilityState: 'visible', body: { appendChild() {} }, createElement() { return { remove() {}, click() { f.downloads.push({ href: this.href, filename: this.download }); } }; } },
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }, require(name) {
      if (name === 'react') return react;
      if (name === 'next/link') return 'a';
      if (name === './Shell') return 'Shell';
      if (name === '@atlas/finishing/label-sheet-geometry') return geometry;
      if (name.endsWith('/label-sheets-client.mjs')) return { ...api, createLabelSheetsClient: options => api.createLabelSheetsClient({ ...options, cryptoImpl: { randomUUID } }) };
      if (name.endsWith('/gototags-nfc-export.mjs')) return nfc;
      if (name.endsWith('/manual-client.mjs')) return { manualRequest: request, manualMessage: failure => failure.code ?? failure.message ?? 'Request unavailable' };
      if (name.endsWith('/routes.mjs')) return { STAFF_BASE_PATH: '/admin' };
      if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key });
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
  f.render = () => { let count = 0; do { dirty = false; cursor = 0; tree = exports.default({ staff, embedded: true, initialCardId: f.initialCardId }); effects.splice(0).forEach(fn => fn()); assert.ok(++count < 30); } while (dirty); };
  f.flush = async () => { for (let i = 0; i < 8; i++) { await new Promise(setImmediate); f.render(); } };
  f.find = predicate => all(tree, predicate); f.text = () => text(tree);
  f.button = label => f.find(node => node.type === 'button' && text(node) === label)[0];
  f.click = label => { const button = f.button(label); assert.ok(button, label); assert.notEqual(button.props.disabled, true, label); button.props.onClick(); f.render(); };
  f.detail = () => f.find(node => node.type?.name === 'LabelDetail')[0]?.props;
  f.dialog = () => f.find(node => node.type?.name === 'ActionDialog')[0]?.props;
  f.switchStaff = id => { staff = { ...staff, id }; f.render(); };
  f.tick = async () => { [...timers].forEach(fn => fn()); await f.flush(); };
  f.dispose = () => slots.forEach(slot => slot?.cleanup?.()); f.render(); await f.flush(); return f;
}
test('actual component reads saved sheets and maps all fifty slots from the shared geometry without a write', async () => {
  const f = await fixture(); const positions = f.find(node => node.type === 'button' && /^Position \d+, row/.test(node.props['aria-label'] ?? ''));
  assert.equal(positions.length, 50); assert.match(positions[0].props['aria-label'], /^Position 1, row 1, column 1, Saved Player/);
  assert.match(positions[49].props['aria-label'], /^Position 50, row 5, column 10, empty/);
  assert.equal(positions[0].props.style.left, `${36.59 / 310 * 100}%`);
  assert.equal(positions[49].props.style.top, `${310.513 / 400 * 100}%`);
  assert.equal(f.calls.some(call => call.method), false); assert.equal(f.detail().item.snapshot.grade, 9.5);
  positions[49].props.onClick(); f.render(); assert.equal(f.detail().slot, 50); assert.equal(f.detail().item, undefined); f.dispose();
});
test('partial export requires its explicit gesture and binds the sheet displayed when the dialog opened', async () => {
  const first = data(1), second = data(2), f = await fixture({ sheets: [first, second] });
  f.click('Export this sheet'); assert.ok(f.dialog()); assert.equal(f.calls.some(call => call.method), false);
  const dialog = f.dialog(); first.revision++; await f.tick();
  dialog.onSubmit({ slots: [], reason: '' }); await f.flush();
  const posts = f.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 1);
  assert.equal(posts[0].body.expectedSheetRevision, 3); assert.match(posts[0].url, new RegExp(`${first.sheetId}/exports$`));
  assert.equal(f.sheets[0].state, 'SEALED'); assert.equal(f.dialog(), undefined); assert.doesNotMatch(f.text(), /NFC verified|Label printed/); f.dispose();
});
test('download and physical print recording stay distinct and select the exact successful positions', async () => {
  const first = data(), f = await fixture({ sheets: [first] }); f.click('Export this sheet'); f.dialog().onSubmit({ slots: [], reason: '' }); await f.flush();
  f.click('Download sheet PNG ↓'); await f.flush();
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 2); assert.equal(first.printEvents.length, 0); assert.match(f.text(), /Download Black ink \+ transparent foil PNG/);
  f.click('Record printed labels'); assert.equal(first.printEvents.length, 0); f.dialog().onSubmit({ slots: [2], reason: '' }); await f.flush();
  assert.equal(first.printEvents.length, 1); assert.deepEqual(first.printEvents[0].successfulSlots, [2]); assert.match(f.text(), /1 saved physical print confirmation/); f.dispose();
});
test('lost mutation reply stays visible with exact retry and no fresh export is silently submitted', async () => {
  const f = await fixture(); f.postError = { status: 503, code: 'NETWORK_LOST' }; f.click('Export this sheet'); f.dialog().onSubmit({ slots: [], reason: '' }); await f.flush();
  assert.match(f.text(), /NETWORK_LOST/); assert.equal(f.dialog(), undefined); await f.tick(); assert.match(f.text(), /NETWORK_LOST/); assert.ok(f.button('Retry saved request')); const before = f.calls.filter(call => call.method === 'POST')[0];
  f.postError = null; f.click('Retry saved request'); await f.flush(); const posts = f.calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 2); assert.deepEqual(posts[1].body, before.body); assert.equal(f.button('Retry saved request'), undefined); f.dispose();
});
test('individual list uses exact approved identity and shows layout failures without an artwork URL', async () => {
  const f = await fixture(); f.pendingItems = [{ itemId: randomUUID(), cardId: randomUUID(), state: 'NEEDS_LAYOUT', identity: { cardName: 'A complete unrenderable name' } }]; await f.tick();
  f.click('Individual labels 4');
  assert.match(f.text(), /A complete unrenderable name/); const row = f.find(node => node.type === 'button' && text(node).includes('A complete unrenderable name'))[0]; row.props.onClick(); f.render();
  assert.equal(f.detail().item.state, 'NEEDS_LAYOUT'); assert.equal(api.labelArtworkHref(f.detail().item), null); f.dispose();
});

test('new and recovering labels need no layout gesture or browser mutation', async () => {
  const failed = { itemId: randomUUID(), cardId: randomUUID(), state: 'NEEDS_LAYOUT', purpose: 'ORIGINAL', automaticLayoutRecoveryEligible: true,
    snapshot: { grade: 8.5, identity: { cardName: 'Sylveon ex' } } };
  const f = await fixture({ pendingItems: [failed], initialCardId: failed.cardId });
  assert.equal(f.detail().onLayoutRetry, undefined);
  assert.equal(f.detail().item.automaticLayoutRecoveryEligible, true);
  assert.match(f.text(), /Preparing label/); assert.doesNotMatch(f.text(), /Needs layout|Retry label layout/);
  await f.tick(); assert.equal(f.calls.some(call => call.method), false);
  const ready = { ...failed, state: 'READY', automaticLayoutRecoveryEligible: false, labelHash: 'a'.repeat(64) };
  f.pendingItems = [ready]; await f.tick();
  assert.equal(f.detail().item.state, 'READY'); assert.equal(f.detail().item.snapshot.grade, 8.5);
  assert.equal(f.calls.some(call => call.method), false); f.dispose();
});
test('the selected preparing label follows automatic recovery into its printable successor', async () => {
  const failed = { itemId: randomUUID(), cardId: randomUUID(), state: 'NEEDS_LAYOUT', purpose: 'ORIGINAL', automaticLayoutRecoveryEligible: true, snapshot: { grade: 8 } };
  const f = await fixture({ pendingItems: [failed], initialCardId: failed.cardId });
  const ready = { ...failed, itemId: randomUUID(), originalItemId: failed.itemId, purpose: 'LAYOUT_RETRY', state: 'READY', labelHash: 'a'.repeat(64), automaticLayoutRecoveryEligible: false };
  f.pendingItems = [{ ...failed, state: 'SUPERSEDED', supersededReason: 'LAYOUT_RETRIED', layoutRetryItemId: ready.itemId }, ready];
  await f.tick(); assert.equal(f.detail().item.itemId, ready.itemId); assert.equal(f.detail().item.snapshot.grade, 8);
  assert.equal(f.calls.some(call => call.method), false); f.dispose();
});
function legacyLayoutIntent(staff, failed) {
  return { version: 1, staffId: staff.id, kind: 'layout-retry', path: `${api.LABEL_ITEMS_PATH}/${failed.itemId}/layout-retries`,
    body: { requestId: randomUUID(), expectedFailureHash: 'b'.repeat(64), expectedRendererProfileHash: 'f'.repeat(64) } };
}
test('an existing saved layout request reconciles automatically with its exact original intent', async () => {
  const staff = { id: randomUUID(), role: 'REVIEWER' }, failed = { itemId: randomUUID(), cardId: randomUUID(), state: 'NEEDS_LAYOUT', purpose: 'ORIGINAL', snapshot: { grade: 8.5 } };
  const saved = new Map(), key = `atlas-label-sheets:${staff.id}:pending`, intent = legacyLayoutIntent(staff, failed);
  saved.set(key, JSON.stringify(intent));
  const f = await fixture({ staff, saved, pendingItems: [failed], initialCardId: failed.cardId });
  const posts = f.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 1);
  assert.equal(posts[0].url, intent.path); assert.deepEqual(posts[0].body, intent.body);
  assert.equal(saved.has(key), false); await f.tick();
  assert.equal(f.detail().item.purpose, 'LAYOUT_RETRY'); assert.equal(f.detail().item.snapshot.grade, 8.5);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1); assert.equal(f.downloads.length, 0); f.dispose();
});
test('deleted-card and already-recovered layout replies release only the exact saved intent', async () => {
  for (const [status, code] of [[404, 'LABEL_ITEM_NOT_FOUND'], [410, 'INTAKE_CARD_DELETED'], [409, 'LABEL_LAYOUT_ALREADY_RETRIED']]) {
    const staff = { id: randomUUID(), role: 'REVIEWER' }, failed = { itemId: randomUUID() }, saved = new Map();
    const key = `atlas-label-sheets:${staff.id}:pending`, intent = legacyLayoutIntent(staff, failed); saved.set(key, JSON.stringify(intent));
    const f = await fixture({ staff, saved, postError: { status, code } });
    assert.equal(saved.has(key), false); assert.equal(f.button('Export this sheet').props.disabled, false);
    await f.tick(); assert.equal(f.calls.filter(call => call.method === 'POST').length, 1); f.dispose();
  }
});
test('unknown legacy layout outcomes remain saved and automatic reconciliation is bounded', async () => {
  const staff = { id: randomUUID(), role: 'REVIEWER' }, failed = { itemId: randomUUID() }, saved = new Map();
  const key = `atlas-label-sheets:${staff.id}:pending`, intent = legacyLayoutIntent(staff, failed), raw = JSON.stringify(intent); saved.set(key, raw);
  const f = await fixture({ staff, saved, postError: { status: 502, code: 'MANUAL_SERVICE_RESPONSE_INVALID' } });
  assert.equal(f.button('Export this sheet').props.disabled, true);
  await f.tick(); await f.tick(); await f.tick(); await f.tick();
  const posts = f.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 3);
  for (const post of posts) { assert.equal(post.url, intent.path); assert.deepEqual(post.body, intent.body); }
  assert.equal(saved.get(key), raw); assert.ok(f.button('Check connection again'));
  assert.doesNotMatch(f.text(), /Needs layout|Retry label layout/); f.dispose();
});
test('read-only staff never reconcile a saved layout mutation automatically', async () => {
  const staff = { id: randomUUID(), role: 'VIEWER' }, saved = new Map(), intent = legacyLayoutIntent(staff, { itemId: randomUUID() });
  saved.set(`atlas-label-sheets:${staff.id}:pending`, JSON.stringify(intent));
  const f = await fixture({ staff, saved }); await f.tick();
  assert.equal(f.calls.some(call => call.method), false); f.dispose();
});
test('a late sheet read never replaces the newly selected sheet', async () => {
  const first = data(1), second = data(2), f = await fixture({ sheets: [first, second] }); let resolve;
  f.hold = url => url === `${api.LABEL_SHEETS_PATH}/${first.sheetId}` ? new Promise(done => { resolve = done; }) : null;
  const sheetButton = id => f.find(node => node.type === 'button' && node.props.className === 'sheetItem' && text(node).startsWith(id))[0];
  sheetButton('Sheet 001').props.onClick(); await f.flush(); sheetButton('Sheet 002').props.onClick(); await f.flush();
  assert.equal(f.detail().sheet.sheetId, second.sheetId); resolve(first); await f.flush(); assert.equal(f.detail().sheet.sheetId, second.sheetId); f.dispose();
});
test('a late response from the prior staff account cannot show its labels or download links', async () => {
  const first = data(), f = await fixture({ sheets: [first] }); let resolve;
  f.hold = url => url === api.LABEL_SHEETS_PATH ? new Promise(done => { resolve = done; }) : null;
  const late = f.tick(); await new Promise(setImmediate); f.hold = null; f.sheets = [data(2)]; f.switchStaff(randomUUID()); await f.flush();
  resolve({ version: 'atlas-label-sheets-v1', sheets: [first], items: first.items, pending: [] }); await late;
  assert.equal(f.detail().sheet.sheetId, f.sheets[0].sheetId); assert.doesNotMatch(f.text(), /Saved Player 1/); f.dispose();
});
test('unavailable sheets preserve the existing NFC route and require no allocation POST', async () => {
  const f = await fixture({ error: { code: 'LABEL_SHEETS_UNAVAILABLE', status: 503 } });
  assert.match(f.text(), /not enabled here yet/); assert.ok(f.find(node => node.type === 'a' && node.props.href === '/station').length); assert.equal(f.calls.some(call => call.method), false); f.dispose();
});
test('read-only staff can inspect but cannot export or record print success', async () => {
  const f = await fixture({ staff: { id: randomUUID(), role: 'OBSERVER' } });
  assert.equal(f.button('Export this sheet').props.disabled, true); assert.equal(f.detail().readOnly, true); assert.equal(f.calls.some(call => call.method), false); f.dispose();
});


test('card-specific navigation selects its exact sheet and slot before a previous saved selection', async () => {
  const first = data(1), second = data(2), id = randomUUID(), saved = new Map();
  saved.set(`atlas-label-sheets:${id}:selection`, JSON.stringify({ sheetId: first.sheetId, slot: 1 }));
  const f = await fixture({ sheets: [first, second], staff: { id, role: 'REVIEWER' }, initialCardId: second.items[1].cardId, saved });
  assert.equal(f.detail().sheet.sheetId, second.sheetId); assert.equal(f.detail().slot, 2); assert.equal(f.detail().item.itemId, second.items[1].itemId); f.dispose();
});
test('older pages are loaded explicitly, retained across refresh, and rechecked with their own cursors', async () => {
  const first = data(1), older = data(2), f = await fixture({ sheets: [first, older] });
  f.pages = { 0: { version: 'atlas-label-sheets-v1', sheets: [first], items: first.items, pending: [], hasMore: true, nextCursor: 20 }, 20: { version: 'atlas-label-sheets-v1', sheets: [older], items: older.items, pending: [], hasMore: false, nextCursor: null } };
  await f.tick(); f.click('Load older sheets & labels'); await f.flush();
  assert.equal(f.find(node => node.props?.className === 'sheetItem').length, 2); assert.equal(f.button('Load older sheets & labels'), undefined);
  const before = f.calls.length; await f.tick();
  assert.ok(f.calls.slice(before).some(call => call.url === `${api.LABEL_SHEETS_PATH}?cursor=20`));
  assert.equal(f.find(node => node.props?.className === 'sheetItem').length, 2); f.dispose();
});
test('full-sheet rollover preserves all fifty positions and a separate next sheet', async () => {
  const full = data(1, 50), next = data(2, 1); full.state = 'SEALED';
  const f = await fixture({ sheets: [next, full] });
  assert.equal(f.detail().sheet.sheetId, next.sheetId); assert.equal(f.detail().sheet.items.length, 1);
  f.find(node => node.props?.className === 'sheetItem' && text(node).startsWith('Sheet 001'))[0].props.onClick(); await f.flush();
  assert.equal(f.detail().sheet.items.length, 50); assert.equal(f.detail().sheet.state, 'SEALED');
  assert.equal(f.find(node => node.type === 'button' && /^Position 50,/.test(node.props['aria-label'] ?? ''))[0].props['aria-label'].includes('empty'), false);
  assert.equal(f.calls.some(call => call.method), false); f.dispose();
});
test('superseded approvals remain visible as history but cannot export or record another print', async () => {
  const old = data(); old.containsSuperseded = true; old.items[0].state = 'SUPERSEDED';
  const f = await fixture({ sheets: [old] });
  assert.equal(f.button('Export this sheet').props.disabled, true); assert.match(f.text(), /report approval on this sheet changed/); f.dispose();
});
test('saved individual exports from the item listing survive reload in the sheet inspector', async () => {
  const sheet = data(), f = await fixture({ sheets: [sheet] });
  const output = { exportId: randomUUID(), itemId: sheet.items[0].itemId, exportProfileId: api.LABEL_PRINT_FORMATS.foil.individual, state: 'READY', sha256: 'e'.repeat(64) };
  f.listItems = sheet.items.map((item, index) => ({ ...item, exports: index === 0 ? [output] : [] }));
  await f.tick();
  assert.equal(f.detail().individualOutput.exportId, output.exportId);
  assert.equal(f.detail().item.exports, undefined);
  assert.equal(f.calls.some(call => call.method), false); f.dispose();
});
test('card-specific navigation opens its pending label instead of an unrelated ready sheet', async () => {
  const pending = { itemId: randomUUID(), cardId: randomUUID(), state: 'PENDING_RENDER' };
  const f = await fixture({ initialCardId: pending.cardId, pendingItems: [pending] });
  assert.equal(f.detail().item.itemId, pending.itemId); assert.equal(f.detail().item.state, 'PENDING_RENDER');
  assert.equal(f.calls.some(call => call.method), false); f.dispose();
});
test('individual material stays bound to its saved item when its older sheet page is not loaded', async () => {
  const sheet = data(), f = await fixture({ sheets: [sheet] });
  const item = { ...data(2).items[0], materialProfileId: 'atlas-v4-holo-v1' };
  f.listItems = [item]; await f.tick(); f.click('Individual labels 1');
  assert.equal(f.detail().sheet.materialProfileId, 'atlas-v4-holo-v1');
  assert.equal(f.detail().item.snapshot.grade, 9.5); assert.doesNotMatch(f.text(), /Sheet 000/); f.dispose();
});

test('NFC batch downloads exact fresh approved URLs in sheet order without touching the pending PNG export', async () => {
  const first = data(1, 1), second = data(2, 2), staff = { id: randomUUID(), role: 'REVIEWER' }, saved = new Map();
  const key = `atlas-label-sheets:${staff.id}:pending`, intent = JSON.stringify({ version: 1, staffId: staff.id, kind: 'export', path: `${api.LABEL_SHEETS_PATH}/${first.sheetId}/exports`, body: { requestId: randomUUID(), expectedSheetRevision: first.revision, exportProfileId: api.LABEL_EXPORT_PROFILE } });
  saved.set(key, intent);
  const f = await fixture({ sheets: [second, first], staff, saved });
  assert.ok(f.button('Retry saved request')); assert.equal(f.button('Export this sheet').props.disabled, true);
  // Historical individual summaries are not used as NFC authority.
  f.listItems = [{ ...data(9).items[0], snapshot: { reportHref: 'https://wrong.example' } }];
  f.click('Prepare NFC batch'); await f.flush();
  assert.match(f.text(), /3 current cards on the loaded sheets/);
  const rows = f.find(node => node.type === 'ol' && node.props['aria-label'] === 'NFC encoding order')[0];
  assert.ok(text(rows).indexOf('Saved Player 1-1') < text(rows).indexOf('Saved Player 2-1'));
  const before = f.calls.length; f.click('Download NFC batch CSV'); await f.flush();
  assert.equal(f.downloads.length, 1); const csv = await f.blobs.get(f.downloads[0].href).text();
  assert.equal(csv, nfc.nfcBatchCsv(nfc.buildNfcBatch([first, second]), [...first.items, ...second.items].map(item => item.itemId)));
  assert.ok(f.calls.slice(before).some(call => call.url === `${api.LABEL_SHEETS_PATH}/${first.sheetId}`));
  assert.ok(f.calls.slice(before).some(call => call.url === `${api.LABEL_SHEETS_PATH}/${second.sheetId}`));
  assert.equal(f.calls.some(call => call.method), false); assert.equal(saved.get(key), intent); assert.equal(first.printEvents.length, 0);
  assert.match(f.text(), /ATLAS has not recorded NFC completion/); assert.ok(f.button('Retry saved request')); f.dispose();
});

test('NFC refresh excludes replaced approvals and replacement labels and selection controls the CSV', async () => {
  const sheet = data(1, 4); sheet.items[2].state = 'SUPERSEDED'; sheet.items[3].purpose = 'REPRINT'; sheet.items[3].originalItemId = sheet.items[0].itemId;
  const f = await fixture({ sheets: [sheet] }); f.click('Prepare NFC batch'); await f.flush();
  assert.match(f.text(), /2 current cards/); assert.match(f.text(), /2 labels excluded/); assert.match(f.text(), /Approval changed/);
  const boxes = f.find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.equal(boxes.length, 2);
  boxes[0].props.onChange({ target: { checked: false } }); f.render(); f.click('Download NFC batch CSV'); await f.flush();
  const csv = await f.blobs.get(f.downloads[0].href).text(); assert.ok(csv.includes(sheet.items[1].snapshot.reportHref));
  assert.ok(!csv.includes(sheet.items[0].snapshot.reportHref)); assert.ok(!csv.includes(sheet.items[2].snapshot.reportHref)); assert.ok(!csv.includes(sheet.items[3].snapshot.reportHref)); f.dispose();
});

test('NFC download rechecks current approval and refuses a stale preview without silently downloading the new queue', async () => {
  const sheet = data(1, 2), f = await fixture({ sheets: [sheet] }); f.click('Prepare NFC batch'); await f.flush();
  sheet.items[0].state = 'SUPERSEDED'; sheet.containsSuperseded = true;
  f.click('Download NFC batch CSV'); await f.flush(); assert.equal(f.downloads.length, 0);
  assert.match(f.text(), /The queue changed/); assert.match(f.text(), /1 current card/);
  f.click('Download NFC batch CSV'); await f.flush(); assert.equal(f.downloads.length, 1);
  assert.ok(!(await f.blobs.get(f.downloads[0].href).text()).includes(sheet.items[0].snapshot.reportHref)); f.dispose();
});

test('NFC invalid URLs and failed fresh reads produce no partial download', async () => {
  const sheet = data(), f = await fixture({ sheets: [sheet] }); f.click('Prepare NFC batch'); await f.flush();
  sheet.items[1].snapshot.reportHref = 'https://unrelated.example/reports/test';
  f.click('Download NFC batch CSV'); await f.flush(); assert.equal(f.downloads.length, 0);
  assert.match(f.text(), /saved report URL does not match/); assert.equal(f.button('Download NFC batch CSV'), undefined);
  sheet.items[1].snapshot.reportHref = `https://atlasgrading.com/reports/ar_${'X'.repeat(24)}?v=2`;
  f.click('Prepare NFC batch'); await f.flush(); f.error = { code: 'LABEL_ACCESS_DENIED' };
  f.click('Download NFC batch CSV'); await f.flush(); assert.equal(f.downloads.length, 0); assert.equal(f.button('Download NFC batch CSV'), undefined); f.dispose();
});

test('NFC does not download after the signed-in account changes, including a late prior-account sheet response', async () => {
  const sheet = data(), f = await fixture({ sheets: [sheet] }); f.click('Prepare NFC batch'); await f.flush();
  f.sessionStaff = { id: randomUUID() }; f.click('Download NFC batch CSV'); await f.flush(); assert.equal(f.downloads.length, 0);
  f.sessionStaff = null; f.click('Prepare NFC batch'); await f.flush(); let resolve;
  f.hold = url => url === `${api.LABEL_SHEETS_PATH}/${sheet.sheetId}` ? new Promise(done => { resolve = done; }) : null;
  f.click('Download NFC batch CSV'); await f.flush(); assert.ok(resolve);
  f.hold = null; f.sheets = [data(2)]; f.switchStaff(randomUUID()); await f.flush(); resolve(sheet); await f.flush();
  assert.equal(f.downloads.length, 0); assert.doesNotMatch(f.text(), /Saved Player 1/); assert.equal(f.button('Download NFC batch CSV'), undefined); f.dispose();
});

test('NFC batch uses a fresh listing, discloses older-page scope and stays unavailable to read-only staff', async () => {
  const first = data(1, 1), second = data(2, 1), f = await fixture({ sheets: [first] });
  f.sheets = [second, first]; f.pages = { 0: { version: 'atlas-label-sheets-v1', sheets: [second, first], items: [...second.items, ...first.items], pending: [], hasMore: true, nextCursor: 20 } };
  f.click('Prepare NFC batch'); await f.flush(); assert.match(f.text(), /2 current cards/); assert.match(f.text(), /Older sheets are not included/);
  assert.equal(f.calls.some(call => call.method), false); f.dispose();
  const observer = await fixture({ staff: { id: randomUUID(), role: 'OBSERVER' } }); assert.equal(observer.button('Prepare NFC batch').props.disabled, true); observer.dispose();
});

test('NFC refresh preserves deliberately unchecked cards and does not select new arrivals automatically', async () => {
  const first = data(1, 2), second = data(2, 1), f = await fixture({ sheets: [first] });
  f.click('Prepare NFC batch'); await f.flush();
  f.find(node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: false } }); f.render();
  f.sheets = [second, first]; f.click('Refresh NFC batch'); await f.flush();
  const boxes = f.find(node => node.type === 'input' && node.props.type === 'checkbox');
  assert.deepEqual(boxes.map(node => node.props.checked), [false, true, false]);
  f.click('Download NFC batch CSV'); await f.flush(); const csv = await f.blobs.get(f.downloads[0].href).text();
  assert.ok(csv.includes(first.items[1].snapshot.reportHref)); assert.ok(!csv.includes(first.items[0].snapshot.reportHref)); assert.ok(!csv.includes(second.items[0].snapshot.reportHref)); f.dispose();
});

test('foil export is the default and saved original-ink exports never masquerade as black-only files', async () => {
  const sheet = data(), original = { exportId: randomUUID(), exportProfileId: api.LABEL_PRINT_FORMATS.original.sheet, state: 'READY', sha256: 'c'.repeat(64) };
  sheet.state = 'SEALED'; sheet.exports = [original];
  const f = await fixture({ sheets: [sheet] });
  assert.ok(f.button('Export this sheet')); assert.equal(f.button('Download sheet PNG ↓'), undefined);
  const selector = f.find(node => node.type === 'select' && node.props.value === 'foil')[0]; assert.ok(selector);
  f.click('Export this sheet'); assert.equal(f.dialog().printFormat, 'foil');
  f.dialog().onSubmit({ slots: [], reason: '' }); await f.flush();
  const post = f.calls.find(call => call.method === 'POST'); assert.equal(post.body.exportProfileId, api.LABEL_PRINT_FORMATS.foil.sheet);
  // Both formats coexist; selecting original must select its own saved bytes.
  sheet.exports.push(original); await f.tick();
  selector.props.onChange({ target: { value: 'original' } }); f.render();
  assert.ok(f.button('Download sheet PNG ↓')); f.click('Download sheet PNG ↓'); await f.flush();
  assert.ok(f.calls.some(call => call.method === 'POST' && call.url.endsWith(`/${original.exportId}/download`))); f.dispose();
});
