import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Texture, Vector3, SRGBColorSpace, NoToneMapping } from 'three';
import { SLAB_MODEL, INITIAL_SLAB_ANGLE, createSlabModel, disposeSlabModel, fitSlabPhoto, assertSlabTextureSize,
  createSlabScene, slabFacing } from '../lib/slab-3d-scene.mjs';

const texture = (width = 1350, height = 1858) => new Texture({ width, height, naturalWidth: width, naturalHeight: height });

test('procedural slab has the owner exterior, actual rounded bevel depth and bounded reusable geometry', () => {
  const model = createSlabModel({ front: texture(), back: texture(), label: texture(2048, 602), nfc: texture(512, 512) });
  const size = new Box3().setFromObject(model).getSize(new Vector3());
  for (const [actual, expected] of [[size.x, SLAB_MODEL.width], [size.y, SLAB_MODEL.height], [size.z, SLAB_MODEL.depth]])
    assert.ok(Math.abs(actual - expected) < .001, `${actual} ≈ ${expected}`);
  for (const name of ['front-beveled-shell', 'back-beveled-shell']) {
    const shell = model.getObjectByName(name); assert.equal(shell.geometry.type, 'ExtrudeGeometry');
    assert.ok(shell.geometry.parameters.options.bevelSegments >= 3);
    assert.ok(shell.geometry.parameters.options.depth > 2);
  }
  let triangles = 0, draws = 0;
  model.traverse(item => { if (item.geometry) { draws++; triangles += (item.geometry.index?.count ?? item.geometry.attributes.position.count) / 3; } });
  assert.ok(draws < 50); assert.ok(triangles < 50000); assert.equal(model.userData.geometryAuthority, 'illustrative');
  disposeSlabModel(model);
});

test('Front and Back use uncropped unlit source textures, with the Back facing outward and not mirrored', () => {
  const front = texture(), back = texture(), model = createSlabModel({ front, back }); model.updateMatrixWorld(true);
  const frontFace = model.getObjectByName('front-approved-photograph'), backFace = model.getObjectByName('back-approved-photograph');
  for (const [face, map, sign] of [[frontFace, front, 1], [backFace, back, -1]]) {
    assert.equal(face.material.type, 'MeshBasicMaterial'); assert.equal(face.material.toneMapped, false); assert.equal(face.material.map, map);
    assert.equal(map.image.naturalWidth, 1350); assert.equal(map.image.naturalHeight, 1858);
    assert.ok(Math.abs(face.geometry.parameters.width / face.geometry.parameters.height - 1350 / 1858) < 1e-12);
    assert.deepEqual(Array.from(face.geometry.attributes.uv.array), [0, 1, 1, 1, 0, 0, 1, 0]);
    assert.ok(new Vector3(0, 0, 1).transformDirection(face.matrixWorld).z * sign > .99);
  }
  assert.equal(model.getObjectByName('front-saved-label-artwork'), undefined);
  assert.equal(model.getObjectByName('back-saved-label-artwork'), undefined);
  assert.equal(model.getObjectByName('illustrative-front-nfc-reference'), undefined);
  assert.equal(model.getObjectByName('plain-label-carrier-no-reverse-artwork').material.map, null);
  assert.deepEqual(fitSlabPhoto(1000, 2000), { width: 44.45, height: 88.9 });
  disposeSlabModel(model);
});

test('shared model resources are disposed exactly once and textures remain caller owned', () => {
  const front = texture(), back = texture(), model = createSlabModel({ front, back });
  const counts = new Map();
  model.traverse(item => { for (const value of [item.geometry, item.material].filter(Boolean)) if (!counts.has(value)) {
    counts.set(value, 0); value.addEventListener('dispose', () => counts.set(value, counts.get(value) + 1));
  } });
  let textureDisposals = 0; front.addEventListener('dispose', () => textureDisposals++);
  disposeSlabModel(model); disposeSlabModel(model);
  assert.ok([...counts.values()].every(count => count === 1)); assert.equal(textureDisposals, 0); assert.equal(model.children.length, 0);
});

test('hardware texture guard rejects an unsupported native photo without reducing it', () => {
  const photo = { naturalWidth: 6000, naturalHeight: 9000 };
  assert.throws(() => assertSlabTextureSize(photo, 8192), { code: 'SLAB_TEXTURE_LIMIT' });
  assert.deepEqual(photo, { naturalWidth: 6000, naturalHeight: 9000 });
  assert.deepEqual(assertSlabTextureSize(photo, 16384), { width: 6000, height: 9000 });
});

class Element extends EventTarget {
  constructor(width = 360, height = 480) { super(); this.clientWidth = width; this.clientHeight = height; this.dataset = {}; this.attributes = new Map(); this.children = []; this.captured = null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
  focus() { this.focused = true; }
}
function fixture(extra = {}) {
  const host = new Element(), win = new EventTarget(), doc = new EventTarget(), pending = [], frames = new Map(), errors = [], ready = [], facing = [], canvases = [];
  let serial = 0;
  win.devicePixelRatio = 3; win.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
  win.cancelAnimationFrame = key => frames.delete(key); doc.hidden = false;
  doc.createElement = name => {
    assert.equal(name, 'canvas'); const canvas = { width: 0, height: 0, draws: [], getContext: () => ({ drawImage: (...args) => canvas.draws.push(args) }) }; canvases.push(canvas); return canvas;
  };
  class ImageFixture {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; }
    set src(url) { this._src = url; pending.push(this); }
    get src() { return this._src; }
    removeAttribute(name) { assert.equal(name, 'src'); this._src = ''; this.cleared = true; }
    resolve(width = 1350, height = 1858) { this.naturalWidth = width; this.naturalHeight = height; this.onload?.(); }
    reject() { this.onerror?.(); }
  }
  const renderer = { domElement: new Element(), capabilities: { maxTextureSize: extra.maxTextureSize ?? 4096, getMaxAnisotropy: () => 16 },
    info: { render: { calls: 0, triangles: 0 } }, renders: 0, disposed: 0, contextLosses: 0,
    render(scene, camera) { this.renders++; this.scene = scene; this.camera = camera; this.info.render.calls = 30; this.info.render.triangles = 10000; },
    setPixelRatio(value) { this.pixelRatio = value; }, setSize(width, height) { this.size = [width, height]; },
    dispose() { this.disposed++; }, forceContextLoss() { this.contextLosses++; } };
  const scene = createSlabScene(host, { frontUrl: 'blob:front', backUrl: 'blob:back', ...extra.sources,
    onReady: value => ready.push(value), onError: value => errors.push(value), onFacing: value => facing.push(value) },
  { window: win, document: doc, renderer, ImageClass: ImageFixture });
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
  const emit = (target, type, props = {}) => { const event = new Event(type, { cancelable: true }); Object.assign(event, props); target.dispatchEvent(event); return event; };
  return { host, win, doc, pending, frames, renderer, ready, errors, facing, canvases, scene, flush, emit,
    async load() { pending.forEach(image => image.resolve()); await scene.started; flush(); } };
}

test('scene keeps native photographs, renders on demand at bounded DPR and releases all GPU/image resources', async () => {
  const f = fixture(); await f.load();
  assert.equal(f.ready.length, 1); assert.deepEqual(f.ready[0].photos, [{ width: 1350, height: 1858 }, { width: 1350, height: 1858 }]);
  assert.equal(f.renderer.pixelRatio, 2); assert.equal(f.renderer.outputColorSpace, SRGBColorSpace); assert.equal(f.renderer.toneMapping, NoToneMapping);
  assert.equal(f.renderer.renders, 1); assert.equal(f.frames.size, 0); f.flush(); assert.equal(f.renderer.renders, 1);
  const maps = new Set(); f.renderer.scene.traverse(item => { if (item.material?.map) maps.add(item.material.map); });
  let releases = 0; maps.forEach(map => { assert.equal(map.colorSpace, SRGBColorSpace); assert.equal(map.anisotropy, 8); map.addEventListener('dispose', () => releases++); });
  f.scene.rotateBy(Math.PI / 6); f.scene.rotateBy(Math.PI / 6); assert.equal(f.frames.size, 1);
  f.flush(); assert.equal(f.renderer.renders, 2); assert.equal(f.frames.size, 0);
  f.scene.dispose(); f.scene.dispose(); assert.equal(releases, 2); assert.equal(f.renderer.disposed, 1); assert.equal(f.renderer.contextLosses, 1);
  assert.equal(f.host.children.length, 0); assert.ok(f.pending.every(image => image.cleared));
  f.scene.rotateBy(1); f.emit(f.win, 'resize'); assert.equal(f.frames.size, 0);
});

test('pointer supports a full turn and vertical touch movement remains available to page scrolling', async () => {
  const f = fixture(); await f.load();
  f.emit(f.host, 'pointerdown', { pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientX: 0, clientY: 0 });
  const vertical = f.emit(f.host, 'pointermove', { pointerId: 1, clientX: 1, clientY: 100 });
  assert.equal(vertical.defaultPrevented, false); assert.equal(f.frames.size, 0); assert.equal(f.host.captured, null);
  f.emit(f.host, 'pointercancel');
  f.emit(f.host, 'pointerdown', { pointerId: 2, isPrimary: true, pointerType: 'touch', button: 0, clientX: 0, clientY: 0 });
  const horizontal = f.emit(f.host, 'pointermove', { pointerId: 2, clientX: 180, clientY: 2 }); f.flush();
  assert.equal(horizontal.defaultPrevented, true); assert.equal(f.host.captured, 2); assert.equal(f.host.focused, true);
  assert.equal(f.renderer.domElement.dataset.slabFacing, 'Back visible');
  f.emit(f.host, 'pointermove', { pointerId: 2, clientX: 360, clientY: 2 }); f.flush();
  assert.ok(Math.abs(Number(f.renderer.domElement.dataset.slabAngle) - INITIAL_SLAB_ANGLE) < 1e-10);
  f.emit(f.host, 'pointerup'); assert.equal(f.host.captured, null); assert.equal(f.frames.size, 0); f.scene.dispose();
});

test('keyboard and reset provide deterministic equivalents without an animation loop', async () => {
  const f = fixture(); await f.load();
  const right = f.emit(f.host, 'keydown', { key: 'ArrowRight' }); f.flush(); assert.equal(right.defaultPrevented, true);
  assert.ok(Number(f.renderer.domElement.dataset.slabAngle) > INITIAL_SLAB_ANGLE);
  f.emit(f.host, 'keydown', { key: 'End' }); f.flush(); assert.equal(f.facing.at(-1), 'Back visible');
  f.emit(f.host, 'keydown', { key: 'Home' }); f.flush(); assert.equal(f.facing.at(-1), 'Front visible');
  f.scene.rotateBy(Math.PI); f.scene.reset(); f.flush(); assert.ok(Math.abs(Number(f.renderer.domElement.dataset.slabAngle) - INITIAL_SLAB_ANGLE) < 1e-10);
  assert.equal(f.frames.size, 0); assert.equal(slabFacing(Math.PI / 2), 'Edge view'); f.scene.dispose();
});

test('tab exit while images are pending aborts them and ignores late image callbacks', async () => {
  const f = fixture(), late = f.pending.map(image => image.onload); f.scene.dispose();
  f.pending.forEach((image, index) => { image.naturalWidth = 1350; image.naturalHeight = 1858; late[index](); }); await f.scene.started;
  assert.equal(f.ready.length, 0); assert.equal(f.errors.length, 0); assert.equal(f.frames.size, 0); assert.equal(f.renderer.renders, 0);
  assert.ok(f.pending.every(image => image.cleared)); assert.equal(f.renderer.disposed, 1);
});

test('context loss removes the private canvas and resources, returns a truthful failure and cannot continue drawing', async () => {
  const f = fixture(); await f.load(); f.scene.rotateBy(.2);
  const lost = f.emit(f.renderer.domElement, 'webglcontextlost');
  assert.equal(lost.defaultPrevented, true); assert.equal(f.errors[0].code, 'SLAB_CONTEXT_LOST');
  assert.equal(f.frames.size, 0); assert.equal(f.host.children.length, 0); assert.equal(f.renderer.disposed, 1); assert.ok(f.pending.every(image => image.cleared));
  f.scene.reset(); f.flush(); assert.equal(f.renderer.renders, 1);
});

test('hidden document stops queued rendering and resumes with one requested frame', async () => {
  const f = fixture(); await f.load(); f.scene.rotateBy(.2); f.doc.hidden = true; f.emit(f.doc, 'visibilitychange');
  assert.equal(f.frames.size, 0); f.scene.rotateBy(.2); assert.equal(f.frames.size, 0);
  f.doc.hidden = false; f.emit(f.doc, 'visibilitychange'); assert.equal(f.frames.size, 1); f.flush(); assert.equal(f.frames.size, 0); f.scene.dispose();
});

test('unsupported photo resolution returns fallback instead of a silently reduced texture', async () => {
  const f = fixture(); f.pending[0].resolve(); f.pending[1].resolve(6000, 9000); await f.scene.started;
  assert.equal(f.errors[0].code, 'SLAB_TEXTURE_LIMIT'); assert.equal(f.ready.length, 0); assert.equal(f.renderer.renders, 0);
  assert.equal(f.host.children.length, 0); assert.equal(f.renderer.contextLosses, 1); assert.equal(f.pending[1].naturalHeight, 9000);
});

test('saved SVG and decorative NFC have separate bounded rasters while card images remain native', async () => {
  const f = fixture({ sources: { labelUrl: 'blob:label', nfcUrl: '/admin/brand/archive/nfc-tag-reference.jpg' } });
  f.pending[0].resolve(); f.pending[1].resolve(); f.pending[2].resolve(258, 76); f.pending[3].resolve(3024, 4032); await f.scene.started; f.flush();
  assert.equal(f.errors.length, 0); assert.deepEqual(f.canvases.map(canvas => [canvas.width, canvas.height]), [[2048, 602], [512, 512]]);
  assert.deepEqual(f.pending.slice(0, 2).map(image => [image.naturalWidth, image.naturalHeight]), [[1350, 1858], [1350, 1858]]);
  const model = f.renderer.scene.getObjectByName(SLAB_MODEL.version);
  assert.ok(model.getObjectByName('front-saved-label-artwork')); assert.equal(model.getObjectByName('back-saved-label-artwork'), undefined);
  assert.ok(f.ready[0].estimatedTextureBytes < 40 * 1024 * 1024); f.scene.dispose(); assert.ok(f.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test('unverified remote photograph URLs never construct a renderer or load an image', () => {
  assert.throws(() => createSlabScene(null, { frontUrl: 'https://example.com/front.jpg', backUrl: 'blob:back' }), { code: 'SLAB_APPROVED_SOURCE_REQUIRED' });
});

test('a slow decorative NFC reference cannot delay the interactive photographs and late completion is disposable', async () => {
  const f = fixture({ sources: { labelUrl: 'blob:label', nfcUrl: '/admin/brand/archive/nfc-tag-reference.jpg' } });
  f.pending.slice(0, 3).forEach(image => image.resolve()); await f.scene.started; f.flush();
  assert.equal(f.ready.length, 1); assert.equal(f.renderer.scene.getObjectByName('illustrative-front-nfc-reference'), undefined);
  f.scene.dispose(); const pending = f.pending[3]; assert.ok(pending.cleared); pending.resolve(3024, 4032);
  await Promise.resolve(); await Promise.resolve(); f.flush(); assert.equal(f.renderer.renders, 1); assert.equal(f.errors.length, 0);
});
