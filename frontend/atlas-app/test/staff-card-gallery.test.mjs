import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as client from '../lib/staff-card-gallery-client.mjs';
import { galleryFixture, staffId, uuid, deferred, flush } from './staff-card-gallery-fixture.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core');
const code = babel.transformSync(readFileSync(new URL('../components/StaffCardGallery.jsx', import.meta.url), 'utf8'), {
  filename: 'StaffCardGallery.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } }, 'transform-runtime': { helpers: false } }]], babelrc: false, configFile: false,
}).code;
const nodes = (tree, match) => Array.isArray(tree) ? tree.flatMap(child => nodes(child, match)) : !tree || typeof tree !== 'object' ? []
  : [...(match(tree) ? [tree] : []), ...nodes(tree.props?.children, match)];
const words = tree => Array.isArray(tree) ? tree.map(words).join(' ') : tree == null || tree === false ? '' : typeof tree !== 'object' ? String(tree) : words(tree.props?.children);
const click = (tree, label) => nodes(tree, n => n.type === 'button' && words(n).trim() === label)[0].props.onClick();
function harness(tile = false) {
  const slots = [], effects = [], window = new EventTarget(), queues = [], urls = [], revoked = [], observers = []; let cursor = 0;
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, n) => value !== old.deps[n])) { slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const exports = {}, Link = 'NextLink';
  vm.runInNewContext(code, { exports, Intl, window,
    IntersectionObserver: class { constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); } observe(node) { this.node = node; } disconnect() { this.closed = true; } },
    require(name) {
      if (name === 'react') return react;
      if (name === 'next/link') return { __esModule: true, default: Link };
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) };
      if (name.endsWith('/routes.mjs')) return { STAFF_REAUTHENTICATE_PATH: '/admin?reauthenticate=1' };
      if (name.endsWith('/staff-card-gallery-client.mjs')) return { ...client, createStaffCardGalleryQueue: options => {
        const queue = client.createStaffCardGalleryQueue({ ...options, createObjectURL: () => { const url = `blob:test-${urls.length}`; urls.push(url); return url; }, revokeObjectURL: url => revoked.push(url) }); queues.push(queue); return queue;
      } };
      return require(name);
    },
  });
  return { queues, urls, revoked, observers, Card: exports.StaffGalleryCard,
    render(props, effectsNow = true) { cursor = 0; const tree = (tile ? exports.StaffGalleryCard : exports.default)(props);
      for (const node of nodes(tree, node => node.props?.ref)) node.props.ref.current = {};
      if (effectsNow) this.effects(); return tree; },
    effects() { while (effects.length) effects.shift()(); }, pagehide() { window.dispatchEvent(new Event('pagehide')); }, unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function setup() {
  const h = harness(), f = galleryFixture(), requests = [], staff = { id: staffId, role: 'REVIEWER', mode: 'PRODUCTION' }; let lost = 0;
  const props = { staff, cards: [f.card], cardsScope: client.staffCardGalleryScope(staff), onAccessLost: () => lost++,
    readCard: (card, options) => { const request = { card, options, ...deferred() }; requests.push(request); return request.promise; } };
  const cards = tree => nodes(tree, node => node.type === h.Card);
  h.render(props); const tree = h.render(props);
  const start = () => { const queue = cards(h.render(props))[0].props.queue; queue.subscribe(f.card, () => {}); queue.visible(f.card, true); return queue; };
  return { h, f, props, requests, cards, tree, start, lost: () => lost };
}

test('actual gallery hides the previous scope before effects on staff replacement and rejects foreign list scope', async () => {
  const f = setup(); assert.equal(f.cards(f.tree).length, 1); f.start();
  const replacement = { ...f.props, staff: { ...f.props.staff } };
  assert.equal(f.cards(f.h.render(replacement, false)).length, 0); assert.equal(f.requests[0].options.signal.aborted, false);
  f.h.effects(); assert.equal(f.requests[0].options.signal.aborted, true);
  assert.equal(f.cards(f.h.render(replacement)).length, 1);
  const foreign = { ...replacement, staff: { ...replacement.staff, id: uuid(901) } };
  assert.equal(f.cards(f.h.render(foreign)).length, 0); assert.match(words(f.h.render(foreign)), /Loading your grading workspace/);
  f.requests[0].resolve(f.f); await flush(); assert.equal(f.h.urls.length, 0); f.h.unmount();
});

test('actual gallery logout/pagehide teardown aborts private reads and cannot revive late responses', async () => {
  for (const reason of ['logout', 'pagehide']) {
    const f = setup(); f.start(); let props = f.props;
    if (reason === 'logout') props = { ...props, accessState: 'ENDED' }; else f.h.pagehide();
    const tree = f.h.render(props); assert.equal(f.cards(tree).length, 0); assert.match(words(tree), /Sign in again/);
    assert.equal(f.requests[0].options.signal.aborted, true); f.requests[0].resolve(f.f); await flush();
    assert.equal(f.cards(f.h.render(props)).length, 0); assert.equal(f.h.urls.length, 0); f.h.unmount();
  }
});

test('actual gallery closes after metadata/preview staff mismatch and removes ready object URLs on unmount', async () => {
  const f = setup(); f.start(); f.requests[0].resolve(f.f); await flush(); assert.equal(f.h.urls.length, 1);
  f.h.unmount(); assert.deepEqual(f.h.revoked, f.h.urls);
  const next = setup(); next.start(); next.requests[0].options.onMetadata(next.f.metadata);
  next.requests[0].resolve({ ...next.f, preview: { ...next.f.preview, staffId: uuid(901) } }); await flush();
  const tree = next.h.render(next.props); assert.equal(next.cards(tree).length, 0); assert.match(words(tree), /Sign in again/); assert.equal(next.lost(), 1); next.h.unmount();
});

test('gallery forwards root pagination and distinguishes an empty list from failure without inventing a total', () => {
  const f = setup(); let more = 0, refresh = 0;
  const props = { ...f.props, nextCursor: uuid(80), onLoadMore: () => more++, onRetryList: () => refresh++ };
  let tree = f.h.render(props); assert.match(words(tree), /1 card in this view · More available/); click(tree, 'Load more cards'); assert.equal(more, 1);
  click(tree, 'Refresh workspace'); assert.equal(refresh, 1);
  tree = f.h.render({ ...props, cards: [], nextCursor: null }); assert.match(words(tree), /No cards in this workspace yet/);
  tree = f.h.render({ ...props, cards: [], nextCursor: null, error: new Error('private details') }); assert.doesNotMatch(words(tree), /No cards in this workspace yet|private details/); assert.match(words(tree), /could not refresh/);
  tree = f.h.render({ ...props, cards: [f.f.card, f.f.card] }); assert.equal(f.cards(tree).length, 0); assert.match(words(tree), /could not be verified/); f.h.unmount();
});

function tileSetup() {
  const h = harness(true), f = galleryFixture(); let publish, retry = 0, failed = 0, closed = 0; const visible = [];
  const queue = { subscribe(_card, listener) { publish = listener; return () => closed++; }, visible(_card, value) { visible.push(value); }, retry() { retry++; }, imageFailed() { failed++; } };
  const props = { card: f.card, queue }; h.render(props);
  return { h, f, props, visible, publish: value => publish(value), retry: () => retry, failed: () => failed, closed: () => closed };
}

test('actual card is intersection-lazy and separates pending, missing and photo-failure states', () => {
  const f = tileSetup(); assert.equal(f.visible.length, 0); assert.ok(f.h.observers[0].node);
  f.h.observers[0].callback([{ isIntersecting: true }]); assert.deepEqual(f.visible, [true]);
  let tree = f.h.render(f.props); assert.match(words(tree), /Reading grading status/); assert.doesNotMatch(words(tree), /Grading complete|Status not recorded/);
  f.publish({ state: 'MISSING', metadata: { ...f.f.metadata, front: { state: 'UNAVAILABLE', binding: null } }, url: null });
  tree = f.h.render(f.props); assert.match(words(tree), /Original preview unavailable/); assert.match(words(tree), /Grading complete/); click(tree, 'Retry photo'); assert.equal(f.retry(), 1);
  f.publish({ state: 'FAILED', metadata: f.f.metadata, url: null }); tree = f.h.render(f.props); assert.match(words(tree), /Photo could not load/); assert.match(words(tree), /Grading complete/);
  f.h.unmount(); assert.equal(f.closed(), 1); assert.equal(f.h.observers[0].closed, true);
});

test('actual card renders only the verified object URL and truthful changed status; stale access removes all card links', () => {
  const f = tileSetup();
  f.publish({ state: 'READY', metadata: f.f.metadata, url: 'blob:verified-original', width: 600, height: 768 });
  let tree = f.h.render(f.props), images = nodes(tree, node => node.type === 'img');
  assert.equal(images.length, 1); assert.equal(images[0].props.src, 'blob:verified-original'); assert.match(images[0].props.alt, /Original Front upload/);
  assert.match(words(tree), /uncropped display preview/); images[0].props.onError(); assert.equal(f.failed(), 1);
  for (const [state, label] of [['CHANGED_SINCE_APPROVAL', 'Review changed'], ['PHOTOS_CHANGED', 'Photos changed'], ['UNKNOWN', 'Status not recorded'], ['SAVED_DRAFT', 'Grading in progress']]) {
    f.publish({ state: 'READY', metadata: { ...f.f.metadata, review: { state, approval: null } }, url: 'blob:verified-original' });
    tree = f.h.render(f.props); assert.match(words(tree), new RegExp(label)); assert.doesNotMatch(words(tree), /Grading complete/);
  }
  for (const state of ['STALE', 'UNAVAILABLE']) {
    f.publish({ state, metadata: null, url: null }); tree = f.h.render(f.props);
    assert.equal(nodes(tree, node => node.type === 'img' || node.type === 'NextLink').length, 0); assert.doesNotMatch(words(tree), /Synthetic card|Grading complete/);
  }
  f.h.unmount();
});
