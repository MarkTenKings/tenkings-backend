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
    if (typeof value.type === 'function' && value.type.prototype?.render) {
      const instance = new value.type(value.props); let children = [];
      try { nodes(instance.render(), match, children); }
      catch (error) { if (!value.type.getDerivedStateFromError) throw error;
        children = []; instance.state = { ...instance.state, ...value.type.getDerivedStateFromError(error) }; nodes(instance.render(), match, children); }
      found.push(...children);
    } else if (typeof value.type === 'function') nodes(value.type(value.props), match, found);
    else nodes(value.props?.children, match, found);
  }
  return found;
}
function fixture(mode = 'detail', { label = false, backLabel = false, slab = false } = {}) {
  const token = `ar_${'Q'.repeat(24)}`, card = { cardId: '11111111-1111-4111-8111-111111111111', approvalActionId: '22222222-2222-4222-8222-222222222222',
    identity: { playerName: 'Synthetic fixture' }, report: { state: 'PUBLISHED', publicToken: token, version: 2, publicHash: 'c'.repeat(64) },
    media: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { url: `/api/reports/${token}/images/${side}?v=2`, provenance: 'APPROVED_GRADING_PHOTOGRAPH' }])) };
  if (label) card.media.LABEL = { itemId: '33333333-3333-4333-8333-333333333333',
    url: '/admin/api/staff/manual-connected/labels/33333333-3333-4333-8333-333333333333/artwork?mode=preview', provenance: 'REPORT_BOUND_LABEL_ARTWORK' };
  if (backLabel) {
    card.media.LABEL.layoutVersion = 'atlas-approved-b-v1';
    card.media.LABEL_BACK = { ...card.media.LABEL, url: card.media.LABEL.url.replace('mode=preview', 'mode=preview-back') };
  }
  if (slab) card.media.SLAB = { url: `/api/reports/${token}/presentation/image?v=2&revision=1`, presentationRevision: 1,
    provenance: 'ACTUAL_SLAB_PHOTOGRAPH', sha256: 'd'.repeat(64), byteCount: 1024, contentType: 'image/jpeg' };
  const slots = [], effects = [], window = new EventTarget(), loads = [], disposed = []; let cursor = 0, dirty = false, tree, lazyFailure = null;
  const react = { Component: class { constructor(props) { this.props = props; } },
    lazy: () => props => { if (lazyFailure) throw lazyFailure; return { type: 'Slab3D', props }; },
    Suspense: 'Suspense', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
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
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => `${name.includes('GradedCards') ? 'archive' : 'media'}.${String(key)}` }) };
    if (name.endsWith('/routes.mjs')) return { STAFF_BASE_PATH: '/admin' };
    if (name.endsWith('/graded-cards-client.mjs')) return graded;
    if (name.endsWith('/approved-card-media.mjs')) return { ...media, createApprovedMediaResource: () => media.createApprovedMediaResource({
      load: (source, { signal }) => new Promise((resolve, reject) => loads.push({ source, signal, reject,
        resolve(url = `blob:${source.kind}:${loads.length}`, metadata = {}) { resolve({ url, representation: source.delivery, ...metadata, dispose() { disposed.push(url); } }); } })),
    }) };
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  const Component = exports.default({ card, mode }).type;
  const render = () => { let count = 0; do { dirty = false; cursor = 0; tree = Component({ card }); effects.splice(0).forEach(run => run()); assert.ok(++count < 20); } while (dirty); };
  const flush = async () => { for (let n = 0; n < 6; n++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  const find = predicate => nodes(tree, predicate);
  const button = title => find(node => node.type === 'button' && (text(node) === title || node.props['aria-label'] === title))[0];
  render();
  return { card, loads, disposed, flush, find, button, render, rejectSlab(error) { lazyFailure = error; render(); }, revoke() { window.dispatchEvent(new Event(media.APPROVED_MEDIA_ACCESS_ENDED)); render(); },
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

test('real detail access event removes the composed preview, aborts pending work and revokes photo and label bytes', async () => {
  const f = fixture('detail', { label: true }); await f.flush();
  f.loads[0].resolve('blob:front'); f.loads[2].resolve('blob:label'); await f.flush();
  assert.ok(f.find(node => node.type === 'span' && node.props.className === 'archive.slab').length);
  f.revoke(); await f.flush();
  assert.equal(f.find(node => node.type === 'img').length, 0);
  assert.equal(f.find(node => node.type === 'a' && node.props.href?.startsWith('blob:')).length, 0);
  assert.ok(f.find(node => node.type === 'strong' && /Staff access ended/.test(text(node))).length);
  assert.equal(f.loads[1].signal.aborted, true); assert.deepEqual(f.disposed.sort(), ['blob:front', 'blob:label']);
  f.loads[1].resolve('blob:late-back'); await f.flush();
  assert.equal(f.find(node => node.type === 'img').length, 0); assert.deepEqual(f.disposed.sort(), ['blob:front', 'blob:label', 'blob:late-back']); f.close();
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

test('detail preserves the gallery front composition and adds an optional 3D control', async () => {
  const gallery = fixture('gallery', { label: true }), detail = fixture('detail', { label: true });
  for (const f of [gallery, detail]) {
    await f.flush(); f.loads.forEach(load => load.resolve(`blob:${load.source.kind}`)); await f.flush();
  }
  const presentation = f => f.find(node => node.type === 'span' && node.props.role === 'img')[0];
  // JSON omits only event functions. Asset placement classes, dimensions, source
  // URLs, accessible meaning and DOM composition must match between both views.
  assert.equal(JSON.stringify(presentation(detail)), JSON.stringify(presentation(gallery)));
  assert.deepEqual(detail.find(node => node.type === 'img').map(node => [node.props.className, node.props.src]), [
    ['archive.slabShell', '/admin/brand/archive/slab-shell-front.svg'], ['archive.slabCard', 'blob:FRONT'],
    [undefined, '/admin/brand/archive/nfc-tag-reference-384.webp'], ['archive.slabLabel', 'blob:LABEL'],
  ]);
  assert.deepEqual(detail.find(node => node.type === 'button').map(node => text(node)), ['Front', 'Back', '3D']);
  assert.equal(detail.find(node => node.type === 'Slab3D').length, 0);
  assert.equal(gallery.find(node => node.type === 'Slab3D').length, 0);
  assert.equal(detail.button('Front').props['aria-pressed'], true);
  assert.equal(detail.find(node => ['dialog', 'a', 'input'].includes(node.type)).length, 0);
  assert.equal(detail.find(node => /inspect|zoom/i.test(node.props['aria-label'] ?? '')).length, 0);
  gallery.close(); detail.close();
});

test('Back uses only its verified photograph and the same shell, never the front label or NFC reference', async () => {
  const f = fixture('detail', { label: true }); await f.flush();
  f.loads.forEach(load => load.resolve(`blob:${load.source.kind}`)); await f.flush();
  f.button('Back').props.onClick(); f.render();
  assert.deepEqual(f.find(node => node.type === 'img').map(node => [node.props.className, node.props.src]), [
    ['archive.slabShell', '/admin/brand/archive/slab-shell-front.svg'], ['archive.slabCard', 'blob:BACK'],
  ]);
  assert.ok(f.find(node => node.type === 'p' && /Reverse label artwork not recorded\./.test(text(node))).length);
  assert.equal(f.button('Back').props['aria-pressed'], true);
  const image = f.find(node => node.type === 'img' && node.props.src === 'blob:BACK')[0];
  image.props.onError(); f.render(); assert.deepEqual(f.disposed, ['blob:BACK']);
  f.button('Retry back photo').props.onClick(); await f.flush();
  assert.deepEqual(f.loads.map(load => load.source.kind), ['FRONT', 'BACK', 'LABEL', 'BACK']);
  f.loads[3].resolve('blob:BACK-retry'); await f.flush();
  f.button('Front').props.onClick(); f.render();
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:FRONT').length);
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:LABEL').length);
  f.close();
});

test('label failure preserves the approved front photo and retry restores the saved composition independently', async () => {
  const f = fixture('detail', { label: true }); await f.flush();
  f.loads[0].resolve('blob:front'); f.loads[1].resolve('blob:back'); f.loads[2].reject(new Error('label unavailable')); await f.flush();
  assert.equal(f.find(node => node.type === 'img').length, 2);
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:front').length);
  assert.ok(f.find(node => node.type === 'span' && node.props.className === 'archive.slab').length);
  assert.ok(f.find(node => node.type === 'p' && /Saved label artwork unavailable\./.test(text(node))).length);
  f.button('Retry preview').props.onClick(); await f.flush();
  assert.deepEqual(f.loads.map(load => load.source.kind), ['FRONT', 'BACK', 'LABEL', 'LABEL']);
  assert.deepEqual(f.disposed, []);
  f.loads[3].resolve('blob:label'); await f.flush();
  assert.ok(f.find(node => node.type === 'span' && node.props.className === 'archive.slab').length);
  assert.equal(f.button('Retry preview'), undefined); f.close();
});

test('a recorded slab photograph takes priority on Front in both views and is never substituted for Back', async () => {
  for (const mode of ['gallery', 'detail']) {
    const f = fixture(mode, { label: true, slab: true }); await f.flush();
    f.loads.forEach(load => load.resolve(`blob:${load.source.kind}`)); await f.flush();
    assert.equal(f.find(node => node.type === 'img').length, 1);
    assert.equal(f.find(node => node.type === 'img')[0].props.src, 'blob:SLAB');
    assert.match(f.find(node => node.type === 'img')[0].props.alt, /recorded slab photograph/);
    if (mode === 'detail') {
      f.button('Back').props.onClick(); f.render();
      assert.equal(f.find(node => node.type === 'img' && node.props.src === 'blob:SLAB').length, 0);
      assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:BACK').length);
    }
    f.close();
  }
});

test('3D mounts only when selected with the verified Front/Back pair, never a slab photograph as a card texture', async () => {
  const f = fixture('detail', { label: true, slab: true }); await f.flush();
  f.loads.forEach(load => load.resolve(`blob:${load.source.kind}`)); await f.flush();
  assert.equal(f.find(node => node.type === 'Slab3D').length, 0);
  f.button('3D').props.onClick(); f.render();
  const scene = f.find(node => node.type === 'Slab3D')[0];
  assert.equal(scene.props.frontUrl, 'blob:FRONT'); assert.equal(scene.props.backUrl, 'blob:BACK'); assert.equal(scene.props.labelUrl, 'blob:LABEL');
  assert.equal(f.button('3D').props['aria-pressed'], true);
  f.button('Back').props.onClick(); f.render(); assert.equal(f.find(node => node.type === 'Slab3D').length, 0);
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:BACK').length);
  f.button('3D').props.onClick(); f.render(); f.revoke(); await f.flush();
  assert.equal(f.find(node => node.type === 'Slab3D').length, 0); assert.equal(f.find(node => node.type === 'img').length, 0);
  assert.ok(f.find(node => node.type === 'strong' && /Staff access ended/.test(text(node))).length); f.close();
});

test('saved approved-B back label appears on Back and in 3D without front NFC or stretched placement', async () => {
  const f = fixture('detail', { label: true, backLabel: true }); await f.flush();
  assert.deepEqual(f.loads.map(load => load.source.kind), ['FRONT', 'BACK', 'LABEL', 'LABEL_BACK']);
  f.loads.forEach(load => load.resolve(`blob:${load.source.kind}`)); await f.flush();
  // The requested presentation overlay sits over B's opaque circle; source
  // label bytes are unchanged, and the reference never appears on the back.
  const nfc = f.find(node => node.props.className === 'archive.slabNfc')[0];
  assert.equal(nfc.props.style.zIndex, 3);
  assert.ok(parseFloat(nfc.props.style.left) > 65);
  f.button('Back').props.onClick(); f.render();
  const artwork = f.find(node => node.type === 'img' && node.props.className === 'archive.slabLabel')[0];
  assert.equal(artwork.props.src, 'blob:LABEL_BACK');
  assert.equal(f.find(node => node.props.className === 'archive.slabNfc').length, 0);
  assert.match(f.find(node => node.type === 'span' && node.props.role === 'img')[0].props['aria-label'], /saved ATLAS back label/);
  assert.equal(f.find(node => /Reverse label artwork not recorded/.test(text(node))).length, 0);
  f.button('3D').props.onClick(); f.render();
  const scene = f.find(node => node.type === 'Slab3D')[0];
  assert.equal(scene.props.labelUrl, 'blob:LABEL'); assert.equal(scene.props.backLabelUrl, 'blob:LABEL_BACK');
  assert.equal(scene.props.labelLayoutVersion, 'atlas-approved-b-v1');
  f.revoke(); await f.flush(); assert.ok(f.disposed.includes('blob:LABEL_BACK')); assert.equal(f.find(node => node.type === 'img').length, 0); f.close();
});

test('back-label decode retry preserves both photographs and front artwork', async () => {
  const f = fixture('detail', { label: true, backLabel: true }); await f.flush();
  f.loads.slice(0, 3).forEach(load => load.resolve(`blob:${load.source.kind}`)); await f.flush();
  f.button('Back').props.onClick(); f.render();
  assert.match(f.find(node => node.type === 'span' && node.props.role === 'img')[0].props['aria-label'], /Saved back label artwork is loading/);
  f.loads[3].resolve('blob:LABEL_BACK'); await f.flush();
  f.find(node => node.type === 'img' && node.props.src === 'blob:LABEL_BACK')[0].props.onError(); f.render();
  assert.deepEqual(f.disposed, ['blob:LABEL_BACK']);
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:BACK').length);
  assert.ok(f.find(node => node.type === 'p' && /Saved back label artwork unavailable/.test(text(node))).length);
  assert.match(f.find(node => node.type === 'span' && node.props.role === 'img')[0].props['aria-label'], /Saved back label artwork is unavailable/);
  f.button('Retry preview').props.onClick(); await f.flush();
  assert.deepEqual(f.loads.map(load => load.source.kind), ['FRONT', 'BACK', 'LABEL', 'LABEL_BACK', 'LABEL_BACK']);
  f.loads.at(-1).resolve('blob:back-label-retry'); await f.flush();
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:back-label-retry').length);
  f.button('Front').props.onClick(); f.render();
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:FRONT').length);
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:LABEL').length); f.close();
});

test('3D retains a usable photograph and independent retry when Back is absent; missing label never becomes reverse artwork', async () => {
  const f = fixture(); await f.flush(); f.loads[0].resolve('blob:front'); f.loads[1].reject(new Error('missing back')); await f.flush();
  f.button('3D').props.onClick(); f.render();
  assert.equal(f.find(node => node.type === 'Slab3D').length, 0);
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:front').length);
  assert.ok(f.find(node => node.type === 'p' && /3D needs both saved photographs/.test(text(node))).length);
  f.button('Retry preview').props.onClick(); await f.flush();
  f.loads.findLast(load => load.source.kind === 'BACK' && load.source.delivery === 'preview').resolve('blob:back'); await f.flush();
  const scene = f.find(node => node.type === 'Slab3D')[0]; assert.equal(scene.props.labelUrl, null);
  assert.equal(scene.props.backUrl, 'blob:back'); assert.equal(scene.props.reverseLabelUrl, undefined); f.close();
});

test('a rejected lazy 3D chunk is contained inside the optional view and Front/Back stay usable', async () => {
  const f = fixture('detail', { label: true }); await f.flush(); f.loads.forEach(load => load.resolve(`blob:${load.source.kind}`)); await f.flush();
  f.button('3D').props.onClick(); f.render();
  await Promise.reject(new Error('ChunkLoadError')).catch(error => f.rejectSlab(error));
  assert.equal(f.find(node => node.type === 'Slab3D').length, 0);
  assert.ok(f.find(node => node.type === 'p' && /3D preview unavailable\. Front and Back photographs remain available\./.test(text(node))).length);
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:FRONT').length);
  assert.equal(f.disposed.length, 0);
  f.button('Back').props.onClick(); f.render(); assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:BACK').length);
  f.button('Front').props.onClick(); f.render(); assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:FRONT').length);
  f.close();
});

test('small stills and labels load first; only selecting 3D starts full detail and progressive replacement retains ready sides', async () => {
  const f = fixture('detail', { label: true }); await f.flush();
  assert.deepEqual(f.loads.map(({ source }) => [source.kind, source.delivery]), [['FRONT', 'preview'], ['BACK', 'preview'], ['LABEL', undefined]]);
  f.loads.forEach(load => load.resolve(`blob:small-${load.source.kind}`)); await f.flush();
  f.button('Back').props.onClick(); await f.flush(); assert.equal(f.loads.length, 3);
  f.button('3D').props.onClick(); await f.flush();
  assert.deepEqual(f.loads.slice(3).map(({ source }) => [source.kind, source.delivery]), [['FRONT', 'full'], ['BACK', 'full']]);
  let scene = f.find(node => node.type === 'Slab3D')[0];
  assert.equal(scene.props.frontUrl, 'blob:small-FRONT'); assert.equal(scene.props.backUrl, 'blob:small-BACK');
  f.loads[3].resolve('blob:full-FRONT'); await f.flush();
  scene = f.find(node => node.type === 'Slab3D')[0];
  assert.equal(scene.props.frontUrl, 'blob:full-FRONT'); assert.equal(scene.props.backUrl, 'blob:small-BACK');
  f.loads[4].reject(new Error('full unavailable')); await f.flush();
  assert.equal(f.find(node => node.type === 'Slab3D')[0].props.backUrl, 'blob:small-BACK');
  f.button('Retry high detail').props.onClick(); await f.flush();
  assert.equal(f.loads.length, 6); assert.equal(f.loads[5].source.kind, 'BACK'); assert.equal(f.loads[5].source.delivery, 'full');
  f.loads[5].resolve('blob:full-BACK'); await f.flush();
  assert.equal(f.find(node => node.type === 'Slab3D')[0].props.backUrl, 'blob:full-BACK');
  f.button('Front').props.onClick(); await f.flush();
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:small-FRONT').length);
  f.button('3D').props.onClick(); await f.flush(); assert.equal(f.loads.length, 6);
  f.revoke(); await f.flush();
  assert.equal(f.find(node => node.type === 'Slab3D' || node.type === 'img').length, 0);
  assert.deepEqual(f.disposed.sort(), ['blob:full-BACK', 'blob:full-FRONT', 'blob:small-BACK', 'blob:small-FRONT', 'blob:small-LABEL'].sort()); f.close();
});

test('3D waits for a pending preview decision and reuses an older approval full fallback without downloading it twice', async () => {
  const f = fixture(); await f.flush();
  f.button('3D').props.onClick(); await f.flush(); assert.equal(f.loads.length, 2);
  f.loads[0].resolve('blob:legacy-front-full', { representation: 'full' });
  f.loads[1].resolve('blob:legacy-back-full', { representation: 'full' }); await f.flush();
  assert.equal(f.loads.length, 2);
  const scene = f.find(node => node.type === 'Slab3D')[0];
  assert.equal(scene.props.frontUrl, 'blob:legacy-front-full'); assert.equal(scene.props.backUrl, 'blob:legacy-back-full'); f.close();
});

test('verified optional full media can recover a failed still without substituting failed preview bytes', async () => {
  const f = fixture(); await f.flush();
  f.loads[0].reject(new Error('preview corrupt')); f.loads[1].resolve('blob:small-back'); await f.flush();
  f.button('3D').props.onClick(); await f.flush();
  f.loads.find(load => load.source.kind === 'FRONT' && load.source.delivery === 'full').resolve('blob:verified-full-front'); await f.flush();
  assert.equal(f.find(node => node.type === 'Slab3D')[0].props.frontUrl, 'blob:verified-full-front');
  f.button('Front').props.onClick(); await f.flush();
  assert.ok(f.find(node => node.type === 'img' && node.props.src === 'blob:verified-full-front').length); f.close();
});

test('leaving 3D cancels unfinished high-detail transfers and a later visit resumes only missing full sides', async () => {
  const f = fixture(); await f.flush(); f.loads.forEach(load => load.resolve(`blob:small-${load.source.kind}`)); await f.flush();
  f.button('3D').props.onClick(); await f.flush();
  f.loads[2].resolve('blob:full-front'); await f.flush();
  f.button('Back').props.onClick(); await f.flush();
  assert.equal(f.loads[3].signal.aborted, true);
  assert.equal(f.disposed.length, 0);
  f.loads[3].resolve('blob:late-full-back'); await f.flush(); assert.deepEqual(f.disposed, ['blob:late-full-back']);
  f.button('3D').props.onClick(); await f.flush();
  assert.equal(f.loads.length, 5); assert.equal(f.loads[4].source.kind, 'BACK');
  assert.equal(f.find(node => node.type === 'Slab3D')[0].props.frontUrl, 'blob:full-front');
  f.loads[4].resolve('blob:full-back'); await f.flush(); f.close();
});

test('a different side settling does not silently retry a failed full download', async () => {
  const f = fixture(); await f.flush(); f.loads[0].resolve('blob:small-front'); await f.flush();
  f.button('3D').props.onClick(); await f.flush();
  f.loads[2].reject(new Error('full front failed')); await f.flush();
  f.loads[1].resolve('blob:small-back'); await f.flush();
  assert.equal(f.loads.filter(load => load.source.kind === 'FRONT' && load.source.delivery === 'full').length, 1);
  assert.equal(f.loads.filter(load => load.source.kind === 'BACK' && load.source.delivery === 'full').length, 1); f.close();
});


test('the first photograph already occupies the slab when its saved label is still loading', async () => {
  const f = fixture('detail', { label: true }); await f.flush();
  f.loads[0].resolve('blob:small-front'); await f.flush();
  assert.ok(f.find(node => node.type === 'span' && node.props.className === 'archive.slab').length);
  assert.ok(f.find(node => node.type === 'img' && node.props.className === 'archive.slabCard').length);
  assert.equal(f.find(node => node.type === 'img' && node.props.className === 'archive.slabLabel').length, 0);
  f.loads[2].resolve('blob:label'); await f.flush();
  assert.ok(f.find(node => node.type === 'img' && node.props.className === 'archive.slabCard').length);
  assert.ok(f.find(node => node.type === 'img' && node.props.className === 'archive.slabLabel').length); f.close();
});
