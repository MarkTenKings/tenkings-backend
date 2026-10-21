import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as archive from '../lib/graded-cards-client.mjs';
import * as routes from '../lib/routes.mjs';
import * as orders from '../lib/order-desk-client.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/GradedCards.jsx', import.meta.url), 'utf8'), {
  filename: 'GradedCards.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
function expand(value) {
  if (Array.isArray(value)) return value.map(expand);
  if (!value || typeof value !== 'object') return value;
  if (typeof value.type === 'function') return expand(value.type(value.props));
  return { ...value, props: { ...value.props, children: expand(value.props?.children) } };
}
function find(value, predicate, result = []) {
  if (Array.isArray(value)) value.forEach(item => find(item, predicate, result));
  else if (value && typeof value === 'object') {
    if (predicate(value)) result.push(value);
    find(value.props?.children, predicate, result);
  }
  return result;
}
function harness() {
  const slots = [], effects = [], listeners = new Map(), calls = []; let cursor = 0, dirty = false, tree;
  const staff = { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE', customerOperationsEnabled: true };
  const token = `ar_${'a'.repeat(24)}`;
  const card = { cardId: randomUUID(), approvalActionId: randomUUID(), identity: { playerName: 'Private old card' },
    certificateNumber: 'ATLAS-ABCDEF123456', finalGrade: 8.5, approvedAt: '2026-10-20T00:00:00.000Z',
    report: { state: 'PUBLISHED', publicToken: token, version: 1, path: `/reports/${token}?v=1` },
    submission: { orderId: randomUUID(), reference: 'PRIVATE-ORDER', customer: { name: 'Private old customer' }, channel: 'MAIL_IN' } };
  const f = { staff, card, calls, session: { staff }, hold: null, result: { schemaVersion: 1, cards: [card], nextCursor: 'older-page' } };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => {
      const next = typeof value === 'function' ? value(slots[index]) : value;
      if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
    }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(action, deps) { const index = cursor++, old = slots[index];
      if (!old || deps.some((value, n) => value !== old.deps[n])) { slots[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => { old?.cleanup?.(); slots[index].cleanup = action(); });
      }
    },
  };
  const request = async (path, options) => {
    calls.push({ path, options }); assert.equal(options.method, undefined);
    if (path === 'session') return f.session;
    return f.hold ? f.hold.promise : structuredClone(f.result);
  };
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, window: {
    addEventListener: (name, action) => listeners.set(name, action), removeEventListener: name => listeners.delete(name),
  }, require(name) {
    if (name === 'react') return react;
    if (name === 'next/link') return 'a';
    if (name === './Shell') return { __esModule: true, default: 'Shell' };
    if (name === './ApprovedCardMedia') return { __esModule: true, default: 'ApprovedCardMedia' };
    if (name.endsWith('/client')) return { api: request };
    if (name.endsWith('/graded-cards-client.mjs')) return archive;
    if (name.endsWith('/routes.mjs')) return routes;
    if (name.endsWith('/order-desk-client.mjs')) return orders;
    if (name.endsWith('.css')) return {};
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  // Deliberately expose the pre-effect render: an ordinary flush-only harness
  // would miss the old private rows painting before useEffect clears them.
  f.renderBeforeEffects = () => { dirty = false; cursor = 0; tree = expand(exports.default({ staff: f.staff, request })); };
  f.render = () => { let count = 0; do { f.renderBeforeEffects(); effects.splice(0).forEach(run => run()); assert.ok(++count < 20); } while (dirty); };
  f.flush = async () => { for (let n = 0; n < 5; n++) { await new Promise(setImmediate); f.render(); } };
  f.find = predicate => find(tree, predicate);
  f.text = () => JSON.stringify(tree);
  f.button = label => f.find(node => node.type === 'button' && text(node) === label)[0];
  f.event = name => { listeners.get(name)?.({ persisted: true }); f.render(); };
  f.close = () => slots.forEach(slot => slot?.cleanup?.());
  f.render(); return f;
}

test('gallery and table hide old metadata, media and pagination before effects on any staff-scope change', async () => {
  for (const view of ['Gallery', 'Table']) for (const change of [{ id: randomUUID() }, { role: 'OBSERVER' }, { mode: 'OTHER_FIXTURE' }]) {
    const f = harness(); await f.flush(); f.button(view).props.onClick(); f.render();
    assert.match(f.text(), /Private old card/); assert.equal(f.find(node => node.type === 'ApprovedCardMedia').length, 1);
    assert.ok(f.button('Load more cards'));
    const held = deferred(); f.hold = held; f.staff = { ...f.staff, ...change }; f.session = { staff: f.staff };
    f.renderBeforeEffects();
    assert.doesNotMatch(f.text(), /Private old card|Private old customer|ATLAS-ABCDEF123456|PRIVATE-ORDER|older-page/);
    assert.equal(f.find(node => node.type === 'ApprovedCardMedia').length, 0); assert.equal(f.button('Load more cards'), undefined);
    assert.match(f.text(), /Loading approved cards/); assert.equal(f.button('Refresh archive ↻').props.disabled, true);
    await f.flush(); assert.doesNotMatch(f.text(), /Private old card|ATLAS-ABCDEF123456/);
    held.resolve({ schemaVersion: 1, cards: [{ ...f.card, identity: { playerName: 'New scope card' } }], nextCursor: null });
    await f.flush(); assert.match(f.text(), /New scope card/); assert.equal(f.find(node => node.type === 'ApprovedCardMedia').length, 1); f.close();
  }
});

test('late old-scope pagination cannot reappear even if it resolves before scope-change effects run', async () => {
  const f = harness(); await f.flush(); const old = deferred(); f.hold = old;
  f.button('Load more cards').props.onClick(); await f.flush();
  const oldRead = f.calls.filter(call => call.path !== 'session').at(-1);
  f.staff = { ...f.staff, id: randomUUID() }; f.session = { staff: f.staff }; f.renderBeforeEffects();
  old.resolve({ schemaVersion: 1, cards: [{ ...f.card, cardId: randomUUID(), identity: { playerName: 'Late private card' } }], nextCursor: null });
  await new Promise(setImmediate); f.renderBeforeEffects();
  assert.doesNotMatch(f.text(), /Private old card|Late private card|ATLAS-ABCDEF123456/);
  assert.equal(f.find(node => node.type === 'ApprovedCardMedia').length, 0);
  const fresh = deferred(); f.hold = fresh; await f.flush(); assert.equal(oldRead.options.signal.aborted, true);
  fresh.resolve({ schemaVersion: 1, cards: [], nextCursor: null }); await f.flush();
  assert.doesNotMatch(f.text(), /Private old card|Late private card|ATLAS-ABCDEF123456/); f.close();
});

test('access loss still clears same-scope rows and prevents a late page from restoring them', async () => {
  const f = harness(); await f.flush(); const held = deferred(); f.hold = held;
  f.button('Load more cards').props.onClick(); await f.flush(); f.event('atlas:verified-image-access-ended');
  assert.doesNotMatch(f.text(), /Private old card|ATLAS-ABCDEF123456/); assert.match(f.text(), /Sign in again/);
  held.resolve(f.result); await f.flush(); assert.equal(f.find(node => node.type === 'ApprovedCardMedia').length, 0); f.close();
});
