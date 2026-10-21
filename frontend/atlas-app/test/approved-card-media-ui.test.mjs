import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as media from '../lib/approved-card-media.mjs';
import * as graded from '../lib/graded-cards-client.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/ApprovedCardMedia.jsx', import.meta.url), 'utf8'), {
  filename: 'ApprovedCardMedia.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
function nodes(value, match, found = []) {
  if (Array.isArray(value)) value.forEach(item => nodes(item, match, found));
  else if (value && typeof value === 'object') {
    if (match(value)) found.push(value);
    if (typeof value.type === 'function') nodes(value.type(value.props), match, found);
    else nodes(value.props?.children, match, found);
  }
  return found;
}
function fixture(mode = 'detail') {
  const token = `ar_${'Q'.repeat(24)}`, card = { cardId: '11111111-1111-4111-8111-111111111111', approvalActionId: '22222222-2222-4222-8222-222222222222',
    identity: { playerName: 'Synthetic fixture' }, report: { state: 'PUBLISHED', publicToken: token, version: 2, publicHash: 'c'.repeat(64) },
    media: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { url: `/api/reports/${token}/images/${side}?v=2`, provenance: 'APPROVED_GRADING_PHOTOGRAPH' }])) };
  const slots = [], effects = [], window = new EventTarget(), loads = [], disposed = []; let cursor = 0, dirty = false, tree;
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(action, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, n) => value !== old.deps[n])) {
      slots[index] = { deps, action, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = action(); });
    } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, window, require(name) {
    if (name === 'react') return react;
    if (name === 'next/link') return ({ children, ...props }) => ({ type: 'a', props: { ...props, children } });
    if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key });
    if (name.endsWith('/routes.mjs')) return { STAFF_BASE_PATH: '/admin' };
    if (name.endsWith('/graded-cards-client.mjs')) return graded;
    if (name.endsWith('/approved-card-media.mjs')) return { ...media, createApprovedMediaResource: () => media.createApprovedMediaResource({
      load: (source, { signal }) => new Promise((resolve, reject) => loads.push({ source, signal, reject,
        resolve(url = `blob:${source.kind}:${loads.length}`) { resolve({ url, dispose() { disposed.push(url); } }); } })),
    }) };
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  const Component = exports.default({ card, mode }).type;
  const render = () => { let count = 0; do { dirty = false; cursor = 0; tree = Component({ card }); effects.splice(0).forEach(run => run()); assert.ok(++count < 20); } while (dirty); };
  const flush = async () => { for (let n = 0; n < 6; n++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  const find = predicate => nodes(tree, predicate);
  const button = title => find(node => node.type === 'button' && (text(node) === title || node.props['aria-label'] === title))[0];
  render();
  return { card, loads, disposed, flush, find, button, render, revoke() { window.dispatchEvent(new Event(media.APPROVED_MEDIA_ACCESS_ENDED)); render(); },
    rehearse() { slots.forEach(slot => slot?.cleanup?.()); slots.forEach(slot => { if (slot?.action) slot.cleanup = slot.action(); }); render(); },
    close() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test('real detail component distinguishes loading from unavailable and preserves Front during Back retry', async () => {
  const f = fixture(); await f.flush();
  assert.deepEqual(f.loads.map(value => value.source.kind), ['FRONT', 'BACK']);
  assert.equal(f.find(node => node.type === 'img').length, 0);
  assert.ok(f.find(node => node.type === 'strong' && /Loading approved front/.test(text(node))).length);
  f.loads[0].resolve('blob:front'); f.loads[1].reject(new Error('back unavailable')); await f.flush();
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:front').length);
  f.button('Back').props.onClick(); f.render();
  assert.ok(f.find(node => node.type === 'strong' && /back photograph unavailable/.test(text(node))).length);
  f.button('Retry back photo').props.onClick(); await f.flush();
  assert.deepEqual(f.loads.map(value => value.source.kind), ['FRONT', 'BACK', 'BACK']);
  assert.equal(f.disposed.length, 0);
  f.loads[2].resolve('blob:back'); await f.flush();
  f.button('Front').props.onClick(); f.render();
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:front').length);
  f.close(); assert.deepEqual(f.disposed.sort(), ['blob:back', 'blob:front']);
});

test('real detail access event removes images and full-size links, aborts pending work and revokes ready bytes', async () => {
  const f = fixture(); await f.flush(); f.loads[0].resolve('blob:front'); await f.flush();
  assert.ok(f.find(node => node.type === 'a' && node.props.href === 'blob:front').length);
  f.revoke(); await f.flush();
  assert.equal(f.find(node => node.type === 'img').length, 0);
  assert.equal(f.find(node => node.type === 'a' && node.props.href?.startsWith('blob:')).length, 0);
  assert.ok(f.find(node => node.type === 'strong' && /Staff access ended/.test(text(node))).length);
  assert.equal(f.loads[1].signal.aborted, true); assert.deepEqual(f.disposed, ['blob:front']);
  f.loads[1].resolve('blob:late-back'); await f.flush();
  assert.equal(f.find(node => node.type === 'img').length, 0); assert.deepEqual(f.disposed, ['blob:front', 'blob:late-back']); f.close();
});

test('effect cleanup/setup rehearsal creates fresh resources and stale photo completion cannot publish', async () => {
  const f = fixture(); await f.flush(); f.rehearse(); await f.flush();
  assert.equal(f.loads.length, 4); assert.ok(f.loads.slice(0, 2).every(value => value.signal.aborted));
  f.loads[0].resolve('blob:old-front'); f.loads[1].resolve('blob:old-back');
  f.loads[2].resolve('blob:new-front'); f.loads[3].resolve('blob:new-back'); await f.flush();
  assert.equal(f.find(node => node.type === 'img' && /old/.test(node.props.src)).length, 0);
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:new-front').length);
  assert.deepEqual(f.disposed.sort(), ['blob:old-back', 'blob:old-front']); f.close();
});

test('both inspection triggers restore their own focus only after the modal closes', async () => {
  const f = fixture(); await f.flush(); f.loads[0].resolve('blob:front'); f.loads[1].resolve('blob:back'); await f.flush();
  for (const name of ['Inspect approved front photograph of Synthetic fixture', 'Inspect / zoom ↗']) {
    let focused = 0;
    f.button(name).props.onClick({ currentTarget: { isConnected: true, focus() { focused++; } } }); f.render();
    f.button('Close photograph inspection').props.onClick(); f.render(); assert.equal(focused, 0);
    f.find(node => node.type === 'dialog')[0].props.onClose(); f.render(); assert.equal(focused, 1);
  }
  f.close();
});
