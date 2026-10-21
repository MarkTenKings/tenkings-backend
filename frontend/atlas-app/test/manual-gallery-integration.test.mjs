import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as galleryClient from '../lib/staff-card-gallery-client.mjs';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/ManualCards.jsx', import.meta.url), 'utf8'), {
  filename: 'ManualCards.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const held = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const find = (node, type) => Array.isArray(node) ? node.map(item => find(item, type)).find(Boolean)
  : node && typeof node === 'object' ? node.type === type ? node : find(node.props?.children, type) : null;
function harness() {
  const staff = { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE' }, slots = [], effects = [], listeners = new Map();
  const f = { staff, session: { staff }, calls: [], pending: [], list: async () => ({ staffId: f.staff.id, cards: [{ cardId: 'old-card', label: 'Old private label' }], nextCursor: 'older' }) };
  let cursor = 0, dirty = false, tree;
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(action, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((x, n) => x !== old.deps[n])) slots[i] = { deps, action }; return slots[i].action; },
    useEffect(action, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((x, n) => x !== old.deps[n])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = action(); }); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, crypto: { randomUUID }, localStorage: { getItem: () => null },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    require(name) {
      if (name === 'react') return react;
      if (name === 'next/router') return { useRouter: () => ({ query: {}, events: { on() {}, off() {} } }) };
      if (name === '../lib/staff-card-gallery-client.mjs') return galleryClient;
      if (name === '../lib/manual-client.mjs') return { manualMessage: error => error.code ?? 'Unavailable', manualRequest: async path => {
        f.calls.push(path); assert.equal(path, '/api/staff/session'); if (f.sessionError) throw f.sessionError; return f.session;
      } };
      if (name === '@atlas/manual-intake/client') return { createBrowserIntakeJournal: () => ({ close() {} }), createIntakeClient: () => ({ pending: async () => f.pending, list: options => { f.calls.push(options ?? 'list'); return f.list(options); } }) };
      if (name === '../lib/batch-import.mjs') return { createBrowserBatchImportJournal: () => ({ close() {} }) };
      if (name === '../lib/card-discard.mjs') return { hasPendingDiscard: () => false, discardedIdsFromEvent: () => null, discardKey: () => 'discard', discardEvent: 'discard', createWorkspaceDiscarder: () => ({ pending: () => false, reconcile: async () => null }) };
      if (name.startsWith('@babel/runtime/')) return nextRequire(`next/dist/compiled/${name}`);
      if (name.startsWith('./') || name === 'next/link') return { __esModule: true, default: name.slice(2) };
      return {};
    },
  });
  f.renderBeforeEffects = () => { cursor = 0; dirty = false; tree = exports.default({ staff: f.staff }); };
  f.render = () => { let n = 0; do { f.renderBeforeEffects(); effects.splice(0).forEach(run => run()); assert.ok(++n < 20); } while (dirty); };
  f.flush = async () => { for (let i = 0; i < 5; i++) { await new Promise(setImmediate); f.render(); } };
  f.gallery = () => find(tree, 'StaffCardGallery').props;
  f.event = name => { listeners.get(name)?.({}); f.render(); };
  f.close = () => slots.forEach(slot => slot?.cleanup?.());
  f.render(); return f;
}

test('staff replacement hides list labels and cursor synchronously, including a late previous page', async () => {
  const f = harness(); await f.flush(); assert.equal(f.gallery().cards[0].label, 'Old private label');
  const old = held(); f.list = () => old.promise; f.gallery().onLoadMore(); await f.flush();
  f.staff = { ...f.staff, id: randomUUID() }; f.session = { staff: f.staff }; f.renderBeforeEffects();
  assert.equal(f.gallery().cards.length, 0); assert.equal(f.gallery().nextCursor, null);
  old.resolve({ staffId: 'old', cards: [{ label: 'Late private label' }], nextCursor: 'leak' }); await new Promise(setImmediate); f.renderBeforeEffects();
  assert.equal(f.gallery().cards.length, 0);
  f.list = async () => ({ staffId: f.staff.id, cards: [], nextCursor: null }); await f.flush(); assert.equal(f.gallery().accessState, 'READY'); f.close();
});

test('list response authenticated to another cookie account closes the workspace before exposing labels', async () => {
  const f = harness(); f.list = async () => ({ staffId: randomUUID(), cards: [{ label: 'Other account' }], nextCursor: null });
  await f.flush(); assert.equal(f.gallery().accessState, 'ENDED'); assert.equal(f.gallery().cards.length, 0); f.close();
});

test('online reconciliation keeps the current refresh closure after same-account staff replacement', async () => {
  const f = harness(); await f.flush(); f.staff = { ...f.staff }; f.session = { staff: f.staff }; await f.flush();
  f.list = async () => ({ staffId: f.staff.id, cards: [{ cardId: 'reconnected', label: 'Reconnected card' }], nextCursor: null });
  f.event('online'); await f.flush(); assert.equal(f.gallery().cards[0].label, 'Reconnected card'); f.close();
});

test('pagination deduplicates once and a refresh supersedes an outstanding page', async () => {
  const f = harness(); await f.flush(); const page = held(); let pages = 0;
  f.list = () => { pages++; return page.promise; }; f.gallery().onLoadMore(); f.gallery().onLoadMore(); await f.flush(); assert.equal(pages, 1);
  page.resolve({ staffId: f.staff.id, cards: [{ cardId: 'old-card', label: 'duplicate' }, { cardId: 'second', label: 'Second' }], nextCursor: 'third' });
  await f.flush(); assert.equal(f.gallery().cards.length, 2); assert.equal(f.gallery().cards[0].label, 'Old private label');
  const stale = held(); f.list = () => stale.promise; f.gallery().onLoadMore(); await f.flush();
  f.list = async () => ({ staffId: f.staff.id, cards: [{ cardId: 'fresh', label: 'Fresh' }], nextCursor: null }); f.gallery().onRetryList(); await f.flush();
  stale.resolve({ staffId: f.staff.id, cards: [{ cardId: 'stale', label: 'Stale' }], nextCursor: 'stale-cursor' }); await f.flush();
  assert.equal(f.gallery().cards.length, 1); assert.equal(f.gallery().cards[0].label, 'Fresh'); assert.equal(f.gallery().nextCursor, null); f.close();
});

test('access loss and pagehide clear metadata immediately and reject late pages', async () => {
  for (const event of ['atlas:verified-image-access-ended', 'pagehide']) {
    const f = harness(); await f.flush(); const late = held(); f.list = () => late.promise; f.gallery().onLoadMore(); await f.flush();
    f.event(event); assert.equal(f.gallery().cards.length, 0); assert.equal(f.gallery().accessState, 'ENDED');
    late.resolve({ staffId: f.staff.id, cards: [{ cardId: 'late', label: 'Late' }], nextCursor: null }); await f.flush();
    assert.equal(f.gallery().cards.length, 0); assert.equal(f.gallery().accessState, 'ENDED'); f.close();
  }
});

test('temporary startup failure offers a real retry, while a denied session requires sign-in', async () => {
  const f = harness(); f.sessionError = { status: 503, code: 'UNAVAILABLE' }; await f.flush();
  // The first request may already have read the session, so force the next bootstrap.
  f.staff = { ...f.staff }; f.session = { staff: f.staff }; await f.flush();
  assert.equal(f.gallery().loading, false); assert.ok(f.gallery().error);
  f.sessionError = null; f.gallery().onRetryList(); await f.flush(); assert.equal(f.gallery().cards.length, 1);
  f.staff = { ...f.staff, role: 'OBSERVER' }; f.sessionError = { status: 403, code: 'DENIED' }; await f.flush();
  assert.equal(f.gallery().cards.length, 0); assert.equal(f.gallery().accessState, 'ENDED'); f.close();
});
