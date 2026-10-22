import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as contract from '../lib/collection-contract.mjs';
import * as client from '../lib/collection-client.mjs';
import { createCollectionPreviewFixture } from './collection-preview-fixture.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core');
const compile = file => babel.transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  filename: file, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } }, 'transform-runtime': { helpers: false } }]], babelrc: false, configFile: false,
}).code;
const code = compile('../components/collection/CollectionWorkspace.jsx');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let cursor = 0; const slots = [], effects = [], listeners = new Map();
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => value !== b[i]);
  const react = {
    Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(callback, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, callback }; return slots[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = callback(); }); } },
  };
  const exports = {}, MyCollection = () => null;
  vm.runInNewContext(code, { exports, AbortController, Promise, window: { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) },
    require: name => name === 'react' ? react : name.endsWith('MyCollection.jsx') ? { __esModule: true, default: MyCollection }
      : name.endsWith('/collection-contract.mjs') ? contract : name.endsWith('/collection-client.mjs') ? client : name.endsWith('.css') ? {} : require(name),
  });
  return { render(props) { cursor = 0; const tree = exports.default(props); while (effects.length) effects.shift()(); return tree; },
    pagehide() { listeners.get('pagehide')?.(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); }, MyCollection };
}
const all = (tree, predicate) => !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...(tree.props?.children ?? []).flat(Infinity).flatMap(child => all(child, predicate))];
const words = tree => tree == null || tree === false ? '' : typeof tree !== 'object' ? String(tree) : (tree.props?.children ?? []).flat(Infinity).map(words).join(' ');
const buttons = tree => all(tree, x => x.type === 'button');
const click = (tree, label) => buttons(tree).find(x => words(x) === label).props.onClick();
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function setup() {
  const fixture = createCollectionPreviewFixture(), requests = [], props = { customer: { id: fixture.accountId }, accessState: 'READY',
    readPage: input => { const result = deferred(); requests.push({ input, ...result }); return result.promise; } };
  const h = harness(), read = tree => all(tree, x => x.type === h.MyCollection)[0]?.props;
  return { fixture, props, requests, h, read };
}

test('workspace clears account/session replacement synchronously and ignores older replies', async () => {
  const f = setup(); f.h.render(f.props); await flush(); f.requests[0].resolve(f.fixture.snapshot); await flush();
  assert.equal(f.read(f.h.render(f.props)).snapshot.cards.length, 2);
  const next = { ...f.props, customer: { id: f.props.customer.id } };
  assert.equal(f.read(f.h.render(next)), undefined); await flush();
  assert.equal(f.requests[0].input.signal.aborted, true);
  f.requests[1].resolve(f.fixture.snapshot); await flush(); assert.equal(f.read(f.h.render(next)).snapshot.accountId, next.customer.id);
  const foreign = { ...next, customer: { id: '99999999-9999-4999-8999-999999999999' } };
  assert.equal(f.read(f.h.render(foreign)), undefined); await flush();
  f.requests[2].resolve(f.fixture.snapshot); await flush();
  assert.equal(f.read(f.h.render(foreign)), undefined); assert.match(words(f.h.render(foreign)), /Sign in again/);
});

test('logout/access-end aborts pending work and never resurrects its private response', async () => {
  const f = setup(); f.h.render(f.props); await flush();
  const ended = { ...f.props, accessState: 'ENDED' };
  assert.equal(f.read(f.h.render(ended)), undefined); assert.equal(f.requests[0].input.signal.aborted, true);
  f.requests[0].resolve(f.fixture.snapshot); await flush();
  assert.match(words(f.h.render(ended)), /Sign in again/); assert.equal(f.read(f.h.render(ended)), undefined);
  // Even re-enabling the parent before a new read cannot restore the old page.
  assert.equal(f.read(f.h.render(f.props)), undefined); await flush(); assert.equal(f.requests.length, 1);
  assert.match(words(f.h.render(f.props)), /Sign in again/);
  const next = { ...f.props, customer: { id: f.props.customer.id } }; f.h.render(next); await flush();
  assert.equal(f.requests.length, 2); f.h.unmount(); assert.equal(f.requests[1].input.signal.aborted, true);
});

test('pagehide discards a ready page and prevents late fetches or bfcache revival', async () => {
  const f = setup(); f.h.render(f.props); await flush(); f.requests[0].resolve(f.fixture.snapshot); await flush();
  assert.ok(f.read(f.h.render(f.props))); f.h.pagehide(); assert.equal(f.read(f.h.render(f.props)), undefined);
  assert.equal(f.requests[0].input.signal.aborted, true); assert.match(words(f.h.render(f.props)), /Sign in again/);
});

test('pagination replaces the page, has no total claim and refuses stale overlapping refresh replies', async () => {
  const f = setup(), base = f.fixture.snapshot.cards[0];
  const cards = Array.from({ length: 25 }, (_, index) => ({ ...structuredClone(base), cardId: `${(index+1).toString(16).padStart(8,'0')}-1111-4111-8111-111111111111` }));
  const page = { ...f.fixture.snapshot, cards, nextCardId: cards.at(-1).cardId };
  f.h.render(f.props); await flush(); f.requests[0].resolve(page); await flush(); let tree = f.h.render(f.props);
  assert.equal(f.read(tree).readOnly, true); assert.equal(f.read(tree).displays, undefined); assert.equal(f.read(tree).renderCardMedia, undefined);
  click(tree, 'Next page'); assert.equal(f.read(f.h.render(f.props)), undefined); await flush();
  assert.equal(f.requests[1].input.afterCardId, page.nextCardId);
  f.requests[1].resolve({ ...page, cards: [f.fixture.snapshot.cards[1]], nextCardId: null }); await flush(); tree = f.h.render(f.props);
  assert.equal(f.read(tree).snapshot.cards.length, 1); assert.equal(f.read(tree).afterCardId, page.nextCardId);
  click(tree, 'Refresh collection'); await flush(); const older = f.requests[2];
  // An event retained from the prior render cannot commit an older refresh.
  click(tree, 'First page'); await flush(); assert.equal(older.input.signal.aborted, true);
  f.requests[3].resolve({ ...f.fixture.snapshot, cards: [] }); await flush();
  older.resolve(page); await flush(); assert.equal(f.read(f.h.render(f.props)).snapshot.cards.length, 0);
});

test('injected readers still reject invalid data; unavailable/access errors clear a formerly visible page', async () => {
  for (const outcome of ['foreign', 'unavailable', 'ended']) {
    const f = setup(); f.h.render(f.props); await flush(); f.requests[0].resolve(f.fixture.snapshot); await flush();
    click(f.h.render(f.props), 'Refresh collection'); await flush();
    if (outcome === 'foreign') f.requests[1].resolve({ ...f.fixture.snapshot, accountId: f.fixture.snapshot.cards[0].cardId });
    else f.requests[1].reject(Object.assign(Error('PRIVATE ERROR'), { code: outcome === 'ended' ? 'COLLECTION_ACCESS_ENDED' : 'NETWORK_FAILURE' }));
    await flush(); const tree = f.h.render(f.props); assert.equal(f.read(tree), undefined);
    assert.match(words(tree), outcome !== 'unavailable' ? /Sign in again/ : /unavailable/); assert.doesNotMatch(words(tree), /PRIVATE ERROR|No verified cards/);
  }
});

test('actual read-only collection render contains report bindings and no preview controls', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), exports = {};
  vm.runInNewContext(compile('../components/collection/MyCollection.jsx'), { exports, Intl, window: {},
    require: name => name === 'react' ? React : name.endsWith('/collection-contract.mjs') ? contract : name.endsWith('.css') ? {} : require(name) });
  const f = createCollectionPreviewFixture();
  const html = renderToStaticMarkup(React.createElement(exports.default, { ...f, readOnly: true }));
  assert.match(html, /Recorded preferences/); assert.match(html, /Find a card on this page/); assert.match(html, /Grade Report/);
  assert.doesNotMatch(html, /checkbox|Preview card preferences|Preview collection preferences|>Save|>Make Offer/);
});


test('captured account ID, reader and old buttons cannot expose or cancel a changed scope', async () => {
  for (const change of ['id', 'reader']) {
    const f = setup(); f.h.render(f.props); await flush(); f.requests[0].resolve(f.fixture.snapshot); await flush();
    const old = f.h.render(f.props); let next = f.props;
    if (change === 'id') f.props.customer.id = '99999999-9999-4999-8999-999999999999';
    else next = { ...f.props, readPage: input => { const result = deferred(); f.requests.push({ input, ...result }); return result.promise; } };
    assert.equal(f.read(f.h.render(next)), undefined); await flush();
    click(old, 'Refresh collection'); await flush(); assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].input.signal.aborted, false);
    const page = structuredClone(f.fixture.snapshot); page.accountId = next.customer.id; page.preferences.accountId = next.customer.id;
    for (const card of page.cards) card.ownership.ownerAccountId = next.customer.id;
    f.requests[1].resolve(page); await flush(); assert.equal(f.read(f.h.render(next)).snapshot.accountId, next.customer.id);
    f.h.unmount();
  }
});

test('all authority refusals notify shared scope once and cannot be undone by a READY toggle', async () => {
  for (const fail of [401, 403, 'account', 'owner']) {
    const f=setup(); let lost=0; f.props.onAccessLost=()=>lost++;
    f.h.render(f.props); await flush();
    if(typeof fail==='number') f.requests[0].reject({status:fail});
    else { const page=structuredClone(f.fixture.snapshot); if(fail==='account') page.accountId='99999999-9999-4999-8999-999999999999';
      else page.cards[0].ownership.ownerAccountId='99999999-9999-4999-8999-999999999999'; f.requests[0].resolve(page); }
    await flush(); assert.match(words(f.h.render(f.props)), /Sign in again/); assert.equal(lost,1);
    f.h.render({...f.props,accessState:'ENDED'}); f.h.render(f.props); await flush(); assert.equal(f.requests.length,1);
    f.h.unmount();
  }
});
