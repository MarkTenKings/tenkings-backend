import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { APPROVED_MEDIA_ACCESS_ENDED } from '../lib/approved-card-media.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/Slab3D.jsx', import.meta.url), 'utf8'), {
  filename: 'Slab3D.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
function nodes(value, predicate, result = []) {
  if (Array.isArray(value)) value.forEach(item => nodes(item, predicate, result));
  else if (value && typeof value === 'object') { if (predicate(value)) result.push(value); nodes(value.props?.children, predicate, result); }
  return result;
}
function fixture({ failStart = false } = {}) {
  const slots = [], effects = [], scenes = [], window = new EventTarget();
  let cursor = 0, dirty = false, tree;
  let props = { name: 'Synthetic approved card', frontUrl: 'blob:front', backUrl: 'blob:back', labelUrl: 'blob:label', fallback: 'SAVED_FRONT_PRESENTATION' };
  const react = {
    createElement(type, props, ...children) { if (props?.ref && !props.ref.current) props.ref.current = {}; return { type, props: { ...props, children } }; },
    useRef(value) { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => {
      const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
    }]; },
    useEffect(action, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, n) => value !== old.deps[n])) {
      slots[index] = { deps, action, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = action(); });
    } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, window, require(name) {
    if (name === 'react') return react;
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => `slab.${String(key)}` }) };
    if (name.endsWith('/routes.mjs')) return { STAFF_BASE_PATH: '/admin' };
    if (name.endsWith('/approved-card-media.mjs')) return { APPROVED_MEDIA_ACCESS_ENDED };
    if (name.endsWith('/slab-3d-scene.mjs')) return { createSlabScene(host, options) {
      if (failStart) throw Object.assign(new Error('WebGL unavailable'), { code: 'SLAB_RENDER_UNAVAILABLE' });
      const scene = { host, options, disposals: 0, rotations: [], resets: 0, updates: [], assetRetries: [], retryAssets(slots) { this.assetRetries.push(slots); }, updateAssets(assets) { this.updates.push(assets); }, dispose() { this.disposals++; }, rotateBy(delta) { this.rotations.push(delta); }, reset() { this.resets++; } };
      scenes.push(scene); return scene;
    } };
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  const render = () => { let count = 0; do { cursor = 0; dirty = false; tree = exports.default(props); effects.splice(0).forEach(action => action()); assert.ok(++count < 20); } while (dirty); };
  const find = predicate => nodes(tree, predicate), button = title => find(node => node.type === 'button' && (text(node) === title || node.props['aria-label'] === title))[0];
  render(); return { scenes, render, find, button, text: () => text(tree), status: () => tree.props['data-slab-state'],
    event(type) { window.dispatchEvent(new Event(type)); render(); },
    update(next) { props = { ...props, ...next }; render(); }, close() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test('component retains the approved fallback until 3D is ready, then provides enabled turn/reset controls', () => {
  const f = fixture(); assert.equal(f.status(), 'loading'); assert.match(f.text(), /SAVED_FRONT_PRESENTATION/);
  assert.equal(f.button('Turn slab left').props.disabled, true);
  assert.deepEqual([f.scenes[0].options.frontUrl, f.scenes[0].options.backUrl, f.scenes[0].options.labelUrl], ['blob:front', 'blob:back', 'blob:label']);
  f.scenes[0].options.onReady(); f.render(); assert.equal(f.status(), 'ready'); assert.doesNotMatch(f.text(), /SAVED_FRONT_PRESENTATION/);
  assert.equal(f.button('Turn slab left').props.disabled, false); f.button('Turn slab left').props.onClick(); f.button('Turn slab right').props.onClick(); f.button('Reset').props.onClick();
  assert.deepEqual(f.scenes[0].rotations, [-Math.PI / 6, Math.PI / 6]); assert.equal(f.scenes[0].resets, 1);
  const surface = f.find(node => node.props.role === 'img')[0]; assert.equal(surface.props.tabIndex, 0); assert.match(surface.props['aria-label'], /Left and Right arrows/);
  f.close(); assert.equal(f.scenes[0].disposals, 1);
});

test('renderer failure keeps photographs and offers an explicit fresh scene retry', () => {
  const f = fixture(); f.scenes[0].options.onError({ code: 'SLAB_TEXTURE_LIMIT' }); f.render();
  assert.equal(f.status(), 'unavailable'); assert.match(f.text(), /full resolution in 3D/); assert.match(f.text(), /SAVED_FRONT_PRESENTATION/);
  const surface = f.find(node => node.props.className === 'slab.viewport')[0];
  // An image role would hide its fallback status and Retry descendants from AX.
  assert.equal(surface.props.role, undefined); assert.equal(surface.props['aria-label'], undefined); assert.equal(surface.props['aria-busy'], false);
  assert.ok(f.find(node => node.props.role === 'status').length); assert.ok(f.button('Retry 3D'));
  f.button('Retry 3D').props.onClick(); f.render(); assert.equal(f.scenes.length, 2); assert.equal(f.scenes[0].disposals, 1); assert.equal(f.status(), 'loading');
  f.scenes[0].options.onReady(); f.render(); assert.equal(f.status(), 'loading');
  f.scenes[1].options.onReady(); f.render(); assert.equal(f.status(), 'ready'); f.close();
  const unavailable = fixture({ failStart: true }); assert.equal(unavailable.status(), 'unavailable'); assert.match(unavailable.text(), /Front and Back photographs remain available/); unavailable.close();
});

test('access ended and pagehide immediately hide private fallback and dispose scene; late callbacks stay ignored', () => {
  for (const type of [APPROVED_MEDIA_ACCESS_ENDED, 'pagehide']) {
    const f = fixture(), old = f.scenes[0]; f.event(type);
    assert.equal(f.status(), 'blocked'); assert.doesNotMatch(f.text(), /SAVED_FRONT_PRESENTATION/); assert.match(f.text(), /Staff access ended/); assert.equal(old.disposals, 1);
    old.options.onReady(); old.options.onError({ code: 'late' }); old.options.onFacing('Back visible'); f.render(); assert.equal(f.status(), 'blocked'); f.close();
  }
});

test('progressive photo and late saved-label updates preserve the ready scene and turn position', () => {
  const f = fixture(), scene = f.scenes[0]; scene.options.onReady(); f.render();
  f.button('Turn slab right').props.onClick();
  f.update({ frontUrl: 'blob:full-front', backUrl: 'blob:full-back', frontPhotoFrame: 'atlas-inspection-card-v1', backPhotoFrame: 'atlas-inspection-card-v1', labelUrl: 'blob:late-label', backLabelUrl: 'blob:saved-reverse' });
  assert.equal(f.scenes.length, 1); assert.equal(scene.disposals, 0); assert.equal(f.status(), 'ready');
  assert.equal(scene.updates.at(-1).frontUrl, 'blob:full-front'); assert.equal(scene.updates.at(-1).backLabelUrl, 'blob:saved-reverse');
  assert.equal(scene.updates.at(-1).frontPhotoFrame, 'atlas-inspection-card-v1'); assert.equal(scene.updates.at(-1).backPhotoFrame, 'atlas-inspection-card-v1');
  assert.deepEqual(scene.rotations, [Math.PI / 6]); assert.equal(scene.resets, 0);
  scene.options.onAssetError({ code: 'SLAB_TEXTURE_LIMIT' }, { slot: 'frontUrl' }); f.render();
  assert.equal(f.status(), 'ready'); assert.match(f.text(), /Preview quality/); assert.equal(f.button('Turn slab right').props.disabled, false);
  scene.options.onAssetReady({ slot: 'frontUrl' }); f.render(); assert.match(f.text(), /Drag to turn/);
  f.close(); assert.equal(scene.disposals, 1);
});

test('remount and retry can always start from the owned preview before attempting full detail', () => {
  const f = fixture(); f.update({ initialFrontUrl: 'blob:preview-front', initialBackUrl: 'blob:preview-back', frontUrl: 'blob:full-front', backUrl: 'blob:full-back' });
  f.scenes[0].options.onError({ code: 'SLAB_CONTEXT_LOST' }); f.render();
  f.button('Retry 3D').props.onClick(); f.render();
  assert.equal(f.scenes[1].options.frontUrl, 'blob:preview-front'); assert.equal(f.scenes[1].options.backUrl, 'blob:preview-back');
  assert.equal(f.scenes[1].updates[0].frontUrl, 'blob:full-front'); assert.equal(f.scenes[1].updates[0].backUrl, 'blob:full-back'); f.close();
});

test('a late saved-label failure is visible and retry does not reset the usable scene', () => {
  const f = fixture(), scene = f.scenes[0]; scene.options.onReady(); f.render();
  scene.options.onAssetError({ code: 'SLAB_IMAGE_DECODE' }, { slot: 'labelUrl' }); f.render();
  assert.equal(f.status(), 'ready'); assert.match(f.text(), /Saved label display unavailable/);
  f.button('Retry label').props.onClick(); assert.equal(scene.assetRetries.length, 1); assert.equal(scene.assetRetries[0][0], 'labelUrl');
  assert.equal(scene.disposals, 0); assert.equal(scene.resets, 0);
  scene.options.onAssetReady({ slot: 'labelUrl' }); f.render(); assert.doesNotMatch(f.text(), /Saved label display unavailable/); f.close();
});

test('a saved back label and its approved layout update the existing ready scene when they arrive', () => {
  const f = fixture(), old = f.scenes[0]; old.options.onReady(); f.render();
  f.update({ backLabelUrl: 'blob:back-label', labelLayoutVersion: 'atlas-approved-b-v1' });
  assert.equal(old.disposals, 0); assert.equal(f.scenes.length, 1);
  assert.equal(old.updates.at(-1).backLabelUrl, 'blob:back-label');
  assert.equal(old.updates.at(-1).labelLayoutVersion, 'atlas-approved-b-v1');
  assert.equal(f.status(), 'ready'); f.close();
});
