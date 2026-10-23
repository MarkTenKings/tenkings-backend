import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as storageModule from '../lib/graded-cards-saved-filters.mjs';
import * as archive from '../lib/graded-cards-client.mjs';
const require = createRequire(new URL('../package.json', import.meta.url)), nextRequire = createRequire(require.resolve('next/package.json'));
const code = require('next/dist/compiled/babel/core').transformSync(readFileSync(new URL('../components/GradedCardsSavedFilters.jsx', import.meta.url), 'utf8'), {
  filename: 'GradedCardsSavedFilters.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
function find(value, predicate, rows = []) {
  if (Array.isArray(value)) value.forEach(x => find(x, predicate, rows));
  else if (value && typeof value === 'object') { if (predicate(value)) rows.push(value); find(value.props?.children, predicate, rows); }
  return rows;
}
async function harness() {
  const slots = [], effects = [], windowListeners = new Map(), documentListeners = new Map(), data = new Map(); let cursor = 0, dirty = false, tree;
  const staff = { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE' }, filters = { q: '', category: '', from: '', to: '' };
  const f = { calls: [], writes: [], applied: [], lost: 0, session: { staff }, hold: null, failure: null, data,
    props: { staff, filters, view: 'gallery', inputVersion: filters, enabled: true } };
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { f.writes.push({ key, value }); data.set(key, value); } };
  const locks = { request: async (_key, _options, work) => work({}) };
  f.store = storageModule.createSavedArchiveFilters({ staff, storage, locks, randomUUID });
  const seeded = await f.store.create({ name: 'Private saved search', filters: { ...filters, q: 'Private customer', category: 'SPORTS' }, view: 'table' }, async () => () => true);
  f.id = seeded[0].id; f.writes.length = 0;
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useEffect(action, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((x, n) => x !== old.deps[n])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = action(); }); } },
  };
  const request = async (path, options) => { f.calls.push({ path, options }); assert.equal(path, 'session'); if (f.failure) throw f.failure; return f.hold ? f.hold.promise : f.session; };
  const exports = {}, document = { visibilityState: 'visible', addEventListener: (name, action) => documentListeners.set(name, action), removeEventListener: name => documentListeners.delete(name) };
  vm.runInNewContext(code, { exports, AbortController, document, window: { localStorage: storage, navigator: { locks },
    addEventListener: (name, action) => windowListeners.set(name, action), removeEventListener: name => windowListeners.delete(name),
  }, require(name) {
    if (name === 'react') return react;
    if (name.endsWith('/client')) return { api: request };
    if (name.endsWith('/graded-cards-client.mjs')) return archive;
    if (name.endsWith('/graded-cards-saved-filters.mjs')) return { ...storageModule, createSavedArchiveFilters: options => storageModule.createSavedArchiveFilters({ ...options, randomUUID }) };
    if (name.endsWith('.css')) return {};
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  f.beforeEffects = () => { dirty = false; cursor = 0; tree = exports.default({ ...f.props, request, onApply: (...values) => f.applied.push(values), onAccessLost: () => f.lost++ }); };
  f.render = () => { let n = 0; do { f.beforeEffects(); effects.splice(0).forEach(run => run()); assert(++n < 20); } while (dirty); };
  f.flush = async () => { for (let n = 0; n < 5; n++) { await new Promise(setImmediate); f.render(); } };
  f.find = predicate => find(tree, predicate); f.text = () => JSON.stringify(tree);
  f.button = label => f.find(node => node.type === 'button' && text(node) === label)[0];
  f.choose = () => { f.find(node => node.type === 'select')[0].props.onChange({ target: { value: f.id } }); f.render(); };
  f.close = () => slots.forEach(slot => slot?.cleanup?.());
  f.hide = () => { document.visibilityState = 'hidden'; documentListeners.get('visibilitychange')(); f.render(); };
  f.show = () => { document.visibilityState = 'visible'; documentListeners.get('visibilitychange')(); f.render(); };
  f.storageEvent = () => { windowListeners.get('storage')({ key: f.store.key }); f.render(); };
  f.render(); await f.flush(); return f;
}

test('loading presets only checks session; explicit apply/save/delete use the current scope and applied filters', async () => {
  const f = await harness(); assert.match(f.text(), /Private saved search/); assert.equal(f.applied.length, 0); assert.equal(f.writes.length, 0);
  f.choose(); f.button('Apply saved filter').props.onClick(); await f.flush();
  assert.equal(f.applied.length, 1); assert.equal(f.applied[0][0].q, 'Private customer'); assert.equal(f.applied[0][1], 'table');
  f.props.inputVersion = { ...f.props.filters, q: 'Unapplied customer' }; f.render();
  f.find(node => node.type === 'input')[0].props.onChange({ target: { value: 'Applied only' } }); f.render();
  f.button('Save applied filters').props.onClick(); await f.flush();
  assert.equal(f.store.read().at(-1).name, 'Applied only'); assert.equal(f.store.read().at(-1).filters.q, '');
  f.button('Delete saved filter').props.onClick(); await f.flush(); assert.deepEqual(f.store.read().map(row => row.name), ['Private saved search']);
  assert(f.calls.every(call => call.path === 'session')); f.close();
});
test('late apply does not overwrite a newer draft, applied filter or view', async () => {
  for (const field of ['inputVersion', 'filters', 'view']) {
    const f = await harness(); f.choose(); const pending = deferred(); f.hold = pending;
    f.button('Apply saved filter').props.onClick(); await f.flush();
    f.props[field] = field === 'view' ? 'table' : { ...f.props.filters, q: 'Newer input' }; f.beforeEffects();
    pending.resolve(f.session); await f.flush(); assert.equal(f.applied.length, 0, field); assert.equal(f.writes.length, 0); f.close();
  }
});
test('scope changes hide saved names before effects and a late old-scope reply cannot apply', async () => {
  for (const change of ['account', 'access']) {
    const f = await harness(); f.choose();
    f.find(node => node.type === 'input')[0].props.onChange({ target: { value: 'Private draft name' } }); f.render();
    const pending = deferred(); f.hold = pending;
    f.button('Apply saved filter').props.onClick(); await f.flush();
    if (change === 'account') f.props.staff = { ...f.props.staff, id: randomUUID() }; else f.props.enabled = false;
    f.beforeEffects(); assert.doesNotMatch(f.text(), /Private saved search|Private customer|Private draft name/);
    pending.resolve(f.session); await new Promise(setImmediate); assert.equal(f.applied.length, 0); assert.equal(f.writes.length, 0); f.close();
  }
});
test('denied session cannot save or expose retained names, while hidden tabs recheck before revealing presets', async () => {
  const f = await harness(); f.find(node => node.type === 'input')[0].props.onChange({ target: { value: 'New saved search' } }); f.render();
  f.failure = { status: 403 }; f.button('Save applied filters').props.onClick(); await f.flush();
  assert.equal(f.writes.length, 0); assert.equal(f.lost, 1); assert.doesNotMatch(f.text(), /Private saved search|New saved search/); f.close();
  const other = await harness(); other.hide(); assert.doesNotMatch(other.text(), /Private saved search/);
  other.session = { staff: { ...other.props.staff, id: randomUUID() } }; other.show(); await other.flush();
  assert.equal(other.lost, 1); assert.doesNotMatch(other.text(), /Private saved search/); assert.equal(other.writes.length, 0); other.close();
});
test('cross-tab deletion is re-read before applying and corrupt storage never auto-overwrites', async () => {
  const f = await harness(); f.choose(); await f.store.remove(f.id, async () => () => true); f.writes.length = 0;
  f.button('Apply saved filter').props.onClick(); await f.flush(); assert.equal(f.applied.length, 0); assert.match(f.text(), /saved filter changed/);
  f.data.set(f.store.key, 'invalid JSON'); f.storageEvent(); await f.flush();
  assert.match(f.text(), /Existing browser data was kept/); assert.equal(f.writes.length, 0); assert.equal(f.data.get(f.store.key), 'invalid JSON'); f.close();
});
