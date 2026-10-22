import {
  BoxGeometry, BufferGeometry, CircleGeometry, Color, DirectionalLight, DoubleSide, ExtrudeGeometry,
  Group, HemisphereLight, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  NoToneMapping, OrthographicCamera, Path, PlaneGeometry, Scene, Shape, SRGBColorSpace, Texture, Vector3,
  WebGLRenderer,
} from 'three';
import { APPROVED_LABEL_LAYOUT } from './approved-card-media.mjs';

/** One reusable, illustrative holder. Exterior dimensions are owner supplied.
 * Internal profiles, card thickness and NFC placement are presentation geometry,
 * not measured manufacturing CAD or damage inferred from the photographs. */
export const SLAB_MODEL = Object.freeze({ version: 'atlas-illustrative-slab-v1', width: 80.264, height: 135.382, depth: 6.096,
  cardWidth: 63.5, cardHeight: 88.9, cardY: -10.109, labelWidth: 68.342, labelHeight: 20.082, labelY: 51.048 });
export const INITIAL_SLAB_ANGLE = -Math.PI / 18;
const TAU = Math.PI * 2;
export const normalizeSlabAngle = value => ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
export const slabFacing = angle => Math.abs(Math.cos(angle)) < .16 ? 'Edge view' : Math.cos(angle) > 0 ? 'Front visible' : 'Back visible';
const error = code => Object.assign(new Error(code), { code });

function rounded(width, height, radius) {
  const shape = new Shape(), x = -width / 2, y = -height / 2;
  shape.moveTo(x + radius, y); shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius); shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height); shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius); shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y); return shape;
}
function ring(width, height, radius, border, depth, bevel = .18) {
  // Bevel expands both ends and the XY silhouette; keep the requested exterior.
  const shape = rounded(width - bevel * 2, height - bevel * 2, radius - bevel);
  shape.holes.push(new Path(rounded(width - border * 2, height - border * 2, Math.max(.25, radius - border)).getPoints(12).reverse()));
  const geometry = new ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true, bevelSize: bevel,
    bevelThickness: bevel, bevelSegments: 3, steps: 1, curveSegments: 12 });
  geometry.translate(0, 0, -depth / 2 + bevel); return geometry;
}
function mesh(parent, name, geometry, material, x = 0, y = 0, z = 0) {
  const item = new Mesh(geometry, material); item.name = name; item.position.set(x, y, z); parent.add(item); return item;
}
function outline(parent, name, width, height, radius, material, z, y = 0) {
  const points = rounded(width, height, radius).getPoints(12).map(point => new Vector3(point.x, point.y, 0));
  const item = new LineLoop(new BufferGeometry().setFromPoints(points), material); item.name = name;
  item.position.set(0, y, z); parent.add(item);
}
function addNfcReference(labels, texture, layoutVersion) {
  const approved = layoutVersion === APPROVED_LABEL_LAYOUT.version;
  const tag = mesh(labels, 'illustrative-front-nfc-reference', new CircleGeometry(5.1, 48),
    new MeshBasicMaterial({ map: texture, toneMapped: false }),
    approved ? APPROVED_LABEL_LAYOUT.nfc.x - SLAB_MODEL.labelWidth / 2 : 17.08,
    SLAB_MODEL.labelY + (approved ? SLAB_MODEL.labelHeight / 2 - APPROVED_LABEL_LAYOUT.nfc.y : 0), .205);
  tag.userData.geometryAuthority = 'decorative-reference-only';
}
export function fitSlabPhoto(width, height) {
  if (!(width > 0 && height > 0)) throw error('SLAB_PHOTO_DIMENSIONS');
  const scale = Math.min(SLAB_MODEL.cardWidth / width, SLAB_MODEL.cardHeight / height);
  return { width: width * scale, height: height * scale };
}

/** Textures are the caller's verified photographs/saved label. No relighting,
 * tone mapping, cropping or inferred findings are applied. Reverse label
 * artwork is present only when the saved record supplied that texture. */
export function createSlabModel({ front, back, label, backLabel, labelLayoutVersion, nfc }) {
  const model = new Group(); model.name = SLAB_MODEL.version; model.userData.geometryAuthority = 'illustrative';
  const shell = new Group(), card = new Group(), labels = new Group();
  shell.name = 'clear-two-piece-shell'; card.name = 'approved-card-photographs'; labels.name = 'saved-label'; model.add(shell, card, labels);
  const clear = new MeshPhysicalMaterial({ color: 0xdce0e1, metalness: .12, roughness: .24, clearcoat: 1,
    clearcoatRoughness: .18, transparent: true, opacity: .64, depthWrite: false, side: DoubleSide });
  const rail = new MeshPhysicalMaterial({ color: 0xe3e6e7, metalness: .16, roughness: .28, clearcoat: 1,
    transparent: true, opacity: .75, depthWrite: false });
  const seam = new LineBasicMaterial({ color: 0xa6afb1, transparent: true, opacity: .60 });
  const highlight = new LineBasicMaterial({ color: 0xf0f2f2, transparent: true, opacity: .9 });
  for (const [side, sign] of [['front', 1], ['back', -1]]) {
    mesh(shell, `${side}-beveled-shell`, ring(SLAB_MODEL.width, SLAB_MODEL.height, 2.7, 2.55, SLAB_MODEL.depth / 2, .24), clear, 0, 0, sign * SLAB_MODEL.depth / 4);
    outline(shell, `${side}-outer-lip`, SLAB_MODEL.width - .9, SLAB_MODEL.height - .9, 2.3, highlight, sign * 2.94);
    outline(shell, `${side}-inner-seal`, 74.464, 129.582, 1.8, seam, sign * 2.35);
    mesh(shell, `${side}-label-bay`, ring(70.464, 22.5, 1.1, .75, .72, .12), rail, 0, 51.041, sign * 1.15);
    mesh(shell, `${side}-card-pocket`, ring(65.064, 91, 1, .62, .65, .10), rail, 0, -10.209, sign * .95);
    for (const x of [-33.4, 33.4]) mesh(shell, `${side}-retention-rail-${x < 0 ? 'left' : 'right'}`,
      new BoxGeometry(.65, 86.7, 1.15), rail, x, -10.259, sign * .95);
    for (const [y, width] of [[37.891, 71.5], [-57.059, 70.264], [-61.609, 68.264]])
      mesh(shell, `${side}-cross-rail-${y}`, new BoxGeometry(width, .45, .8), rail, 0, y, sign * 1.1);
  }
  outline(shell, 'two-piece-midline-seam', SLAB_MODEL.width - .3, SLAB_MODEL.height - .3, 2.55, seam, 0);
  // Only the perimeter/retention geometry has a glass response. A broad glass
  // cover over the images would wash out the actual card colors.
  const backing = new MeshBasicMaterial({ color: 0xfafafa, toneMapped: false });
  mesh(card, 'generic-card-carrier', new BoxGeometry(SLAB_MODEL.cardWidth, SLAB_MODEL.cardHeight, .34), backing, 0, SLAB_MODEL.cardY);
  for (const [side, texture, sign] of [['front', front, 1], ['back', back, -1]]) {
    const { width, height } = fitSlabPhoto(texture.image.naturalWidth || texture.image.width, texture.image.naturalHeight || texture.image.height);
    const face = mesh(card, `${side}-approved-photograph`, new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: texture, toneMapped: false, transparent: true }), 0, SLAB_MODEL.cardY, sign * .181);
    if (sign < 0) face.rotation.y = Math.PI; // Viewed from behind, the saved Back remains readable, not mirrored.
  }
  mesh(labels, backLabel ? 'saved-label-carrier' : 'plain-label-carrier-no-reverse-artwork', new BoxGeometry(SLAB_MODEL.labelWidth, SLAB_MODEL.labelHeight, .38),
    new MeshBasicMaterial({ color: 0xf6f6f4, toneMapped: false }), 0, SLAB_MODEL.labelY);
  if (nfc && label) addNfcReference(labels, nfc, labelLayoutVersion);
  if (label) mesh(labels, 'front-saved-label-artwork', new PlaneGeometry(SLAB_MODEL.labelWidth, SLAB_MODEL.labelHeight),
    new MeshBasicMaterial({ map: label, transparent: true, toneMapped: false }), 0, SLAB_MODEL.labelY, .22);
  if (backLabel) {
    const reverse = mesh(labels, 'back-saved-label-artwork', new PlaneGeometry(SLAB_MODEL.labelWidth, SLAB_MODEL.labelHeight),
      new MeshBasicMaterial({ map: backLabel, transparent: true, toneMapped: false }), 0, SLAB_MODEL.labelY, -.22);
    reverse.rotation.y = Math.PI;
  }
  return model;
}

export function disposeSlabModel(model) {
  const geometries = new Set(), materials = new Set();
  model?.traverse(item => { if (item.geometry) geometries.add(item.geometry);
    for (const material of Array.isArray(item.material) ? item.material : [item.material]) if (material) materials.add(material); });
  geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); model?.clear();
}

/** Image loading is cancellable, including late browser callbacks. Photographs
 * and label arrive only as Blob URLs owned by the existing approved-media hook. */
export function loadSlabImage(url, { signal, ImageClass = globalThis.Image } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const image = new ImageClass(); let settled = false;
    const detach = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort); };
    const finish = (failure) => { if (settled) return; settled = true; detach();
      if (failure) { image.removeAttribute('src'); reject(failure); } else resolve(image); };
    const abort = () => finish(signal.reason ?? error('SLAB_CANCELLED'));
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? null : error('SLAB_IMAGE_DECODE'));
    image.onerror = () => finish(error('SLAB_IMAGE_DECODE'));
    signal?.addEventListener('abort', abort, { once: true }); image.src = url;
  });
}
export function assertSlabTextureSize(image, maximum) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  if (!(width > 0 && height > 0) || !Number.isFinite(maximum) || width > maximum || height > maximum) throw error('SLAB_TEXTURE_LIMIT');
  return { width, height };
}
function photoTexture(image, renderer) {
  assertSlabTextureSize(image, renderer.capabilities.maxTextureSize);
  const texture = new Texture(image); texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return texture;
}
function rasterTexture(image, renderer, document, kind) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(kind === 'label' ? 2048 : 512, renderer.capabilities.maxTextureSize);
  canvas.height = kind === 'label' ? Math.round(canvas.width * SLAB_MODEL.labelHeight / SLAB_MODEL.labelWidth) : canvas.width;
  const context = canvas.getContext('2d'); if (!context) throw error('SLAB_TEXTURE_UNAVAILABLE');
  if (kind === 'label') {
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const scale = Math.min(canvas.width / width, canvas.height / height);
    // Preserve the recorded artwork's own ratio, including when its SVG
    // dimensions differ slightly from the integer raster's pixel rounding.
    context.drawImage(image, (canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2, width * scale, height * scale);
  }
  else {
    // Same circular crop as the shared 2D NFC reference; never card evidence.
    context.drawImage(image, -.5086 * canvas.width, -.5471 * canvas.height, 1.9543 * canvas.width, 2.6057 * canvas.height);
  }
  return photoTexture(canvas, renderer);
}

/** The renderer is created only after the 3D tab mounts. Work is event-driven:
 * a requested frame never schedules another frame, and hidden scenes pause. */
export function createSlabScene(host, { frontUrl, backUrl, labelUrl, backLabelUrl, labelLayoutVersion, nfcUrl, onReady = () => {}, onError = () => {}, onFacing = () => {} }, overrides = {}) {
  if (![frontUrl, backUrl].every(url => typeof url === 'string' && url.startsWith('blob:'))
    || [labelUrl, backLabelUrl].some(url => url && (typeof url !== 'string' || !url.startsWith('blob:')))) throw error('SLAB_APPROVED_SOURCE_REQUIRED');
  const win = overrides.window ?? window, doc = overrides.document ?? document;
  const renderer = overrides.renderer ?? new WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'low-power' });
  const scene = new Scene(), camera = new OrthographicCamera(-45, 45, 72, -72, .1, 1000);
  const aborter = new AbortController(), images = new Set(), textures = new Set(), listeners = [];
  let model, frame = null, disposed = false, ready = false, visible = true, angle = INITIAL_SLAB_ANGLE, drag = null;
  let resizeObserver, intersectionObserver;
  const canvas = renderer.domElement;
  renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = NoToneMapping; scene.background = new Color(0xffffff);
  camera.position.set(0, 0, 300); camera.lookAt(0, 0, 0);
  scene.add(new HemisphereLight(0xffffff, 0xd4d8d9, 2));
  for (const [x, y, z, intensity] of [[-90, 110, 140, 2.2], [100, 40, -120, 1.8]]) {
    const light = new DirectionalLight(0xffffff, intensity); light.position.set(x, y, z); scene.add(light);
  }
  canvas.setAttribute('aria-hidden', 'true'); canvas.dataset.slabModel = SLAB_MODEL.version;
  host.appendChild(canvas);
  const listen = (target, type, handler, options) => { target.addEventListener(type, handler, options); listeners.push(() => target.removeEventListener(type, handler, options)); };
  const stopFrame = () => { if (frame !== null) { win.cancelAnimationFrame(frame); frame = null; } };
  function draw() {
    frame = null; if (disposed || !model || !visible || doc.hidden) return;
    try {
      renderer.render(scene, camera);
      canvas.dataset.slabAngle = String(angle); canvas.dataset.slabFacing = slabFacing(angle);
      canvas.dataset.slabFrames = String(Number(canvas.dataset.slabFrames ?? 0) + 1);
      if (!ready) { ready = true; onReady({ modelVersion: SLAB_MODEL.version,
        photos: [frontUrl, backUrl].map(url => { const image = [...images].find(value => value.src === url); return { width: image.naturalWidth, height: image.naturalHeight }; }),
        estimatedTextureBytes: [...textures].reduce((sum, texture) => sum + (texture.image.naturalWidth || texture.image.width) * (texture.image.naturalHeight || texture.image.height) * 4 * 4 / 3, 0),
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }); }
    } catch { fail(error('SLAB_RENDER_UNAVAILABLE')); }
  }
  function requestRender() { if (!disposed && visible && !doc.hidden && frame === null) frame = win.requestAnimationFrame(draw); }
  function resize() {
    if (disposed) return;
    const width = host.clientWidth, height = host.clientHeight; if (!(width > 0 && height > 0)) return;
    renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 2)); renderer.setSize(width, height, false);
    const viewHeight = Math.max(SLAB_MODEL.height * 1.045, (SLAB_MODEL.width + SLAB_MODEL.depth) * 1.07 * height / width);
    camera.left = -viewHeight * width / height / 2; camera.right = -camera.left; camera.top = viewHeight / 2; camera.bottom = -camera.top;
    camera.updateProjectionMatrix(); requestRender();
  }
  function setAngle(value) { if (disposed || !model) return; angle = normalizeSlabAngle(value); model.rotation.y = angle; onFacing(slabFacing(angle)); requestRender(); }
  function endDrag() { const previous = drag; drag = null; host.removeAttribute('data-dragging');
    if (previous && host.hasPointerCapture?.(previous.id)) host.releasePointerCapture(previous.id); }
  function dispose() {
    if (disposed) return; disposed = true; aborter.abort(error('SLAB_CANCELLED')); clearTimeout(timeout); stopFrame(); endDrag();
    listeners.splice(0).forEach(remove => remove()); resizeObserver?.disconnect(); intersectionObserver?.disconnect();
    disposeSlabModel(model); textures.forEach(texture => { texture.dispose(); if (texture.image?.getContext) { texture.image.width = 0; texture.image.height = 0; } }); textures.clear();
    images.forEach(image => image.removeAttribute('src')); images.clear(); scene.clear();
    renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
  }
  function fail(failure) { if (disposed) return; dispose(); onError(failure); }
  const timeout = setTimeout(() => fail(error('SLAB_LOAD_TIMEOUT')), 20000);
  listen(canvas, 'webglcontextlost', event => { event.preventDefault(); fail(error('SLAB_CONTEXT_LOST')); });
  listen(doc, 'visibilitychange', () => { if (doc.hidden) { stopFrame(); endDrag(); } else requestRender(); });
  listen(win, 'resize', resize);
  listen(host, 'pointerdown', event => {
    if (!ready || event.isPrimary === false || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, angle, active: false };
    if (event.pointerType === 'mouse') host.setPointerCapture?.(event.pointerId);
  });
  listen(host, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.active && Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy)) {
      drag.active = true; host.setPointerCapture?.(event.pointerId); host.setAttribute('data-dragging', 'true'); host.focus({ preventScroll: true });
    }
    if (drag.active) { event.preventDefault(); setAngle(drag.angle + dx / Math.max(host.clientWidth, 1) * TAU); }
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(host, event, endDrag);
  listen(host, 'keydown', event => {
    if (!ready || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); endDrag(); setAngle(event.key === 'Home' ? INITIAL_SLAB_ANGLE : event.key === 'End' ? Math.PI : angle + (event.key === 'ArrowLeft' ? -1 : 1) * Math.PI / 12);
  });
  const Resize = overrides.ResizeObserver ?? win.ResizeObserver, Intersection = overrides.IntersectionObserver ?? win.IntersectionObserver;
  if (Resize) { resizeObserver = new Resize(resize); resizeObserver.observe(host); }
  if (Intersection) { intersectionObserver = new Intersection(entries => { visible = entries.some(entry => entry.isIntersecting);
    if (!visible) { stopFrame(); endDrag(); } else requestRender(); }); intersectionObserver.observe(host); }
  const load = async url => {
    const image = await loadSlabImage(url, { signal: aborter.signal, ImageClass: overrides.ImageClass ?? win.Image });
    if (disposed) { image.removeAttribute('src'); throw error('SLAB_CANCELLED'); } images.add(image); return image;
  };
  const started = (async () => {
    try {
      const required = [load(frontUrl), load(backUrl), labelUrl ? load(labelUrl) : null, backLabelUrl ? load(backLabelUrl) : null];
      // Decorative NFC arrival must not hold up usable approved photographs.
      const nfcLoad = nfcUrl && labelUrl ? load(nfcUrl).catch(() => null) : Promise.resolve(null);
      const [frontImage, backImage, labelImage, backLabelImage] = await Promise.all(required);
      if (disposed) return;
      const keep = texture => { textures.add(texture); return texture; };
      const front = keep(photoTexture(frontImage, renderer)), back = keep(photoTexture(backImage, renderer));
      const label = labelImage ? keep(rasterTexture(labelImage, renderer, doc, 'label')) : null;
      const backLabel = backLabelImage ? keep(rasterTexture(backLabelImage, renderer, doc, 'label')) : null;
      // The derived decorative/vector rasters now own their pixels; retain only
      // the full-size card image objects needed by their authoritative textures.
      for (const image of [labelImage, backLabelImage]) if (image) { image.removeAttribute('src'); images.delete(image); }
      model = createSlabModel({ front, back, label, backLabel, labelLayoutVersion }); model.rotation.y = angle; scene.add(model); clearTimeout(timeout);
      onFacing(slabFacing(angle)); resize();
      void nfcLoad.then(image => {
        if (!image || disposed) return;
        try { const nfc = keep(rasterTexture(image, renderer, doc, 'nfc')); addNfcReference(model.getObjectByName('saved-label'), nfc, labelLayoutVersion); requestRender(); }
        catch { /* A failed decorative reference never replaces card evidence. */ }
        finally { image.removeAttribute('src'); images.delete(image); }
      });
    } catch (failure) { fail(failure); }
  })();
  return { started, rotateBy(delta) { endDrag(); setAngle(angle + delta); }, reset() { endDrag(); setAngle(INITIAL_SLAB_ANGLE); }, dispose };
}
