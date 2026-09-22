import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as coreGeometry from '@atlas/grading-core/geometry';
import * as geometry from '../src/geometry-actions.mjs';

const require = createRequire(new URL('../../../frontend/atlas-app/package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const source = babel.transformSync(readFileSync(new URL('../src/PairedGeometryWorkspace.jsx', import.meta.url), 'utf8'), {
  filename: 'PairedGeometryWorkspace.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
const all = (node, predicate, out = []) => { if (Array.isArray(node)) node.forEach(child => all(child, predicate, out)); else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); all(node.props?.children, predicate, out); } return out; };
const hash = letter => letter.repeat(64);
const quad = [{ x: .125, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .125, y: .9 }];
function fixture() {
  const state = geometry.createGeometryWorkspace({ cardId: 'synthetic-saved-card', profile: 'POKEMON', sides: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, {
    image: { version: 2, originalSha256: hash('a'), frameId: `${side}:decoded`, frameSha256: hash(side === 'FRONT' ? 'b' : 'c'), width: 1600, height: 2400, coordinateSpace: 'ORIENTED_DECODED' },
    matColor: 'BLACK', cornerShape: 'ROUNDED_3_18_MM',
  }])) });
  const front = geometry.applyGeometryEdit(state, { side: 'FRONT', kind: 'PHYSICAL', base: geometry.geometryBase(state, 'FRONT', 'PHYSICAL'), quad, actor: 'HUMAN', proposal: null }).state;
  return { workspace: front, images: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, {
    original: { sha256: front.sides[side].image.frameSha256, url: `blob:${side}:original` },
    // A descriptor alone never permits original/unbound pixels as a rectified image.
    rectified: { sha256: front.sides[side].image.frameSha256, url: `blob:${side}:original` },
  }])), onPrepare: async () => {} };
}

function harness(props = fixture()) {
  const instances = new Map(); let current, cursor, dirty, effects = [], tree;
  const memo = (make, deps) => { const i = cursor++, old = current[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) current[i] = { deps, value: make() }; return current[i].value; };
  const effect = (callback, deps) => { const i = cursor++, slots = current, prior = slots[i]; if (!prior || deps.some((v, j) => !Object.is(v, prior.deps[j]))) { slots[i] = { deps, cleanup: prior?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = callback(); }); } };
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++, slots = current; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], change => { const next = typeof change === 'function' ? change(slots[i]) : change; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in current)) current[i] = { current: initial }; return current[i]; }, useCallback: (callback, deps) => memo(() => callback, deps), useEffect: effect, useLayoutEffect: effect,
  };
  const exports = {}; vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react') return react;
    if (name === '@atlas/grading-core/geometry') return coreGeometry;
    if (name === './geometry-actions.mjs') return geometry;
    if (name === './verified-image.mjs') return { useVerifiedImage: image => ({ url: image?.url }) };
    if (name === './gradient-snap') return { gradientMapFromImage: () => null };
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  function expand(node, path = 'root') {
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}.${i}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') { const id = `${path}:${node.type.name}`; if (!instances.has(id)) instances.set(id, []); current = instances.get(id); cursor = 0; return expand(node.type(node.props), `${id}.out`); }
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${path}.children`) } };
  }
  const f = { props };
  f.render = () => { let rounds = 0; do { dirty = false; tree = expand({ type: exports.PairedGeometryWorkspace, props: f.props }); const pending = effects; effects = []; pending.forEach(callback => callback()); assert.ok(++rounds < 20); } while (dirty); return tree; };
  f.nodes = predicate => all(tree, predicate); f.has = value => text(tree).includes(value);
  f.button = label => { const node = f.nodes(node => node.type === 'button' && text(node) === label)[0]; assert.ok(node, label); return node; };
  f.click = label => { const node = f.button(label); assert.equal(Boolean(node.props.disabled), false); const result = node.props.onClick(); f.render(); return result; };
  f.ready = () => { f.nodes(node => node.type === 'img').forEach(node => node.props.onLoad({ currentTarget: { naturalWidth: 1600, naturalHeight: 2400 } })); f.render(); };
  f.render(); return f;
}

test('saved Back original remains visible and Printed mode truthfully offers automatic recovery without a fabricated straightened image', () => {
  const f = harness(); assert.equal(f.nodes(node => node.type === 'img' && node.props.alt === 'Back card, oriented original').length, 1);
  assert.equal(Boolean(f.button('Detect edges automatically').props.disabled), false);
  f.click('Printed border'); assert.equal(f.nodes(node => node.type === 'img').length, 0);
  assert.equal(f.has('The photo is saved. Detect the physical edge first'), true);
  assert.equal(f.has('This side needs a current straightened image.'), true);
  assert.equal(f.has('Waiting for a verified photo.'), false);
  assert.equal(Boolean(f.button('Detect edges automatically').props.disabled), false);
});

test('explicit detection dispatches only Back, shows progress and retains recovery/manual choices after failure', async () => {
  const props = fixture(), before = structuredClone(props.workspace), calls = []; let reject;
  props.onPrepare = side => { calls.push(side); return new Promise((_resolve, fail) => { reject = fail; }); };
  const f = harness(props); f.ready(); const pending = f.click('Detect edges automatically');
  assert.deepEqual(calls, ['BACK']); assert.equal(f.has('Detecting edges…'), true);
  assert.equal(Boolean(f.button('Detect edges automatically').props.disabled), true);
  reject(new Error('synthetic preparation failure')); await pending; f.render();
  assert.equal(f.has('Your saved photo and the other side are retained.'), true);
  assert.equal(Boolean(f.button('Detect edges automatically').props.disabled), false);
  assert.equal(Boolean(f.button('Start manual outline').props.disabled), false);
  assert.deepEqual(props.workspace, before);
});

test('an unsaved manual Back outline suppresses automatic recovery until discarded', () => {
  const f = harness(); f.ready(); f.click('Start manual outline');
  assert.equal(f.nodes(node => node.type === 'button' && text(node) === 'Detect edges automatically').length, 0);
  assert.equal(f.has('Unsaved adjustment'), true); f.click('Discard adjustment');
  assert.equal(Boolean(f.button('Detect edges automatically').props.disabled), false);
});

test('a missing photo or prior human Back outline never gets the automatic recovery action', () => {
  for (const absent of [false, true]) {
    const props = fixture(), state = props.workspace;
    if (absent) props.workspace = geometry.createGeometryWorkspace({ cardId: state.cardId, profile: 'POKEMON', sides: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { image: null, matColor: 'BLACK', cornerShape: 'ROUNDED_3_18_MM' }])) });
    else props.workspace = geometry.applyGeometryEdit(state, { side: 'BACK', kind: 'PHYSICAL', base: geometry.geometryBase(state, 'BACK', 'PHYSICAL'), quad, actor: 'HUMAN', proposal: null }).state;
    const f = harness(props); assert.equal(f.nodes(node => node.type === 'button' && text(node) === 'Detect edges automatically').length, 0);
  }
});
