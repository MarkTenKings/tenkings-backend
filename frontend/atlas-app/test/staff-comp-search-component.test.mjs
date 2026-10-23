import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as controller from '../lib/staff-comp-search-controller.mjs';
import * as entry from '../lib/staff-comp-curation-entry.mjs';
import * as actor from '../lib/staff-comp-curation-client.mjs';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const code = babel.transformSync(readFileSync(new URL('../components/StaffCompSearch.jsx', import.meta.url), 'utf8'), {
  filename: 'StaffCompSearch.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code;
const all = (value, out = []) => { if (Array.isArray(value)) value.forEach(v => all(v, out)); else if (value && typeof value === 'object') { out.push(value); all(value.props?.children, out); } return out; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
function harness(enabled = true) {
  const slots = [], effects = [], timers = new Map(), values = new Map(), events = new EventTarget(); let cursor = 0, dirty = false, timerId = 0;
  const f = { calls: [], ready: [], blocked: false, market: { state: 'NOT_REQUESTED', refreshable: true }, timers };
  f.props = { enabled, staff: { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE' },
    card: { cardId: randomUUID(), approvalActionId: randomUUID(), report: { state: 'PUBLISHED', publicToken: `ar_${'a'.repeat(24)}`, version: 1, publicHash: 'b'.repeat(64) } },
    isSelectionPending: () => f.blocked, onReady: v => f.ready.push(v),
    request: async (path, input) => { f.calls.push({ path, input });
      if (input.method === 'POST') { f.market = { state: 'QUEUED', previewId: input.body.requestId, approvalActionId: f.props.card.approvalActionId, refreshable: false }; return f.market; }
      return { approvalActionId: f.props.card.approvalActionId, revision: 0, marketSearch: f.market }; },
  };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { const next = typeof value === 'function' ? value(slots[n]) : value; if (!Object.is(next, slots[n])) { slots[n] = next; dirty = true; } }]; },
    useRef(initial) { const n = cursor++; if (!(n in slots)) slots[n] = { current: initial }; return slots[n]; },
    useEffect(setup, deps) { const n = cursor++, old = slots[n]; if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) { slots[n] = { deps }; effects.push(() => { old?.cleanup?.(); slots[n].cleanup = setup(); }); } },
  };
  events.sessionStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const exports = {};
  vm.runInNewContext(code, { exports, window: events, setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), require(name) {
    if (name === 'react') return react;
    if (name.endsWith('staff-comp-search-controller.mjs')) return controller;
    if (name.endsWith('staff-comp-curation-entry.mjs')) return entry;
    if (name.endsWith('staff-comp-curation-client.mjs')) return actor;
    if (name.endsWith('.css')) return {};
    return require(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  f.render = () => { let count = 0; do { dirty = false; cursor = 0; f.tree = exports.default(f.props); effects.splice(0).forEach(fn => fn()); assert(++count < 20); } while (dirty); };
  f.flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(setImmediate); f.render(); } };
  f.button = label => all(f.tree).find(v => v.type === 'button' && text(v) === label);
  f.dispose = () => { for (const slot of slots) slot?.cleanup?.(); };
  f.render(); return f;
}
test('disabled panel is inert; enabled mount and queued polling GET only until an explicit button action', async () => {
  const off = harness(false); await off.flush(); assert.equal(off.tree, null); assert.equal(off.calls.length, 0); off.dispose();
  const f = harness(); await f.flush(); assert(f.calls.every(v => v.input.method === 'GET'));
  f.button('Search fresh eBay sales').props.onClick(); await f.flush(); assert.equal(f.calls.filter(v => v.input.method === 'POST').length, 1); assert.equal(f.timers.size, 1);
  f.market = { ...f.market, state: 'READY', refreshable: true, preview: { candidates: [], binding: { publicToken: f.props.card.report.publicToken, approvalVersion: 1, publicHash: f.props.card.report.publicHash } } };
  const tick = [...f.timers.values()][0]; f.timers.clear(); tick(); await f.flush();
  assert.equal(f.timers.size, 0); assert.equal(f.ready.length, 1); assert.equal(f.calls.filter(v => v.input.method === 'POST').length, 1); f.dispose();
});
test('blocked selection explains disabled search; a retained handler cannot search after access or card changes', async () => {
  const f = harness(); await f.flush(); const old = f.button('Search fresh eBay sales').props.onClick;
  f.blocked = true; f.render(); assert.equal(f.button('Search fresh eBay sales').props.disabled, true); assert.match(text(f.tree), /Resolve the pending selection/);
  old(); await f.flush(); assert.equal(f.calls.filter(v => v.input.method === 'POST').length, 0);
  f.blocked = false; f.props.card = { ...f.props.card, cardId: randomUUID() }; f.render(); old(); await f.flush();
  assert.equal(f.calls.filter(v => v.input.method === 'POST').length, 0); f.dispose();
});
