import {
  BoxGeometry, CircleGeometry, Color, DataTexture, DirectionalLight, DoubleSide, EquirectangularReflectionMapping, ExtrudeGeometry, FloatType, LinearSRGBColorSpace, RGBAFormat,
  Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  NoToneMapping, PerspectiveCamera, Path, PlaneGeometry, Scene, Shape, SRGBColorSpace, Texture,
  WebGLRenderer,
} from 'three';
import { APPROVED_LABEL_LAYOUT } from './approved-card-media.mjs';

/** One reusable, illustrative holder. Exterior dimensions are owner supplied.
 * Internal profiles, card thickness and NFC placement are presentation geometry,
 * not measured manufacturing CAD or damage inferred from the photographs. */
export const SLAB_MODEL = Object.freeze({ version: 'atlas-illustrative-slab-v2', width: 80.264, height: 135.382, depth: 6.096,
  cardWidth: 63.5, cardHeight: 88.9, cardY: -10.109, labelWidth: 68.342, labelHeight: 20.082, labelY: 51.048 });
export const INITIAL_SLAB_ANGLE = -Math.PI / 12;
export const SLAB_STUDIO = Object.freeze({ version: 'atlas-neutral-studio-v2', width: 256, height: 128, material: 'reflection' });
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
/** Neutral softboxes and dark flags, authored once in spherical space. This is
 * decorative lighting only; no network HDR, card-derived texture or per-card art. */
export function createSlabStudioEnvironment() {
  const { width, height } = SLAB_STUDIO, data = new Float32Array(width * height * 4);
  const smooth = (a, b, value) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
  const box = (u, v, cx, cy, w, h, feather = .012) => {
    const dx = Math.min(Math.abs(u - cx), 1 - Math.abs(u - cx));
    return (1 - smooth(w / 2 - feather, w / 2 + feather, dx)) * (1 - smooth(h / 2 - feather, h / 2 + feather, Math.abs(v - cy)));
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height;
    let light = .045 + .06 * Math.sin(v * Math.PI);
    light += 4.5 * box(u, v, .80, .46, .065, .66); // tall key softbox
    light += 1.4 * box(u, v, .63, .48, .16, .50); // broad fill
    light += 4.0 * box(u, v, .28, .46, .05, .60); // reverse/edge strip
    light += 2.5 * box(u, v, .50, .18, .55, .10); // overhead strip
    light -= .09 * box(u, v, .91, .50, .055, .80); // black flag gives the polished rim a readable edge
    const value = Math.max(.015, light), index = (y * width + x) * 4;
    data[index] = value; data[index + 1] = value; data[index + 2] = value; data[index + 3] = 1;
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType); texture.name = SLAB_STUDIO.version;
  texture.mapping = EquirectangularReflectionMapping; texture.colorSpace = LinearSRGBColorSpace; texture.needsUpdate = true;
  return texture;
}
function solid(width, height, radius, depth, bevel = .1) {
  const shape = rounded(width - bevel * 2, height - bevel * 2, Math.max(.03, radius - bevel));
  const geometry = new ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 8, steps: 1 });
  geometry.translate(0, 0, -depth / 2 + bevel); return geometry;
}
function shoulder() {
  const shape = rounded(74.464, 129.582, 1.8);
  // These windows stay physically open in the presentation model: decorative
  // plastic cannot tint, blur or refract an approved photograph or saved label.
  for (const [width, height, radius, y] of [[70.75, 23.0, 1.15, SLAB_MODEL.labelY], [65.5, 91.4, 1.2, SLAB_MODEL.cardY]]) {
    const points = rounded(width, height, radius).getPoints(12).map(point => { point.y += y; return point; });
    shape.holes.push(new Path(points.reverse()));
  }
  const geometry = new ExtrudeGeometry(shape, { depth: .18, bevelEnabled: true, bevelSize: .12,
    bevelThickness: .12, bevelSegments: 3, curveSegments: 12, steps: 1 });
  geometry.translate(0, 0, -.09); return geometry;
}
function plastic(parameters, materialMode) {
  const { reflectionDensity = .12, ...surface } = parameters;
  const material = new MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: .10, ior: 1.49,
    clearcoat: .65, clearcoatRoughness: .07, envMapIntensity: .85,
    transparent: true, opacity: .72, depthWrite: false, side: DoubleSide, forceSinglePass: true, ...surface });
  if (materialMode === 'transmission') {
    material.transmission = .96; material.thickness = 1.4; material.opacity = 1; material.color.set(0xffffff);
  } else {
    // Clear plastic has no diffuse paint layer. Keep Three's GGX studio/specular
    // lighting and curved normals, then composite an authored Fresnel reflection
    // over the scene without an offscreen refraction pass. This approximation
    // affects only the shell geometry; evidence materials never use this hook.
    // Shader locations are qualified against the pinned Three 0.186.1 version.
    material.onBeforeCompile = shader => {
      if (!shader.fragmentShader.includes('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;')
        || !shader.fragmentShader.includes('#include <opaque_fragment>')) throw error('SLAB_MATERIAL_UNAVAILABLE');
      shader.uniforms.atlasReflectionDensity = { value: reflectionDensity };
      shader.fragmentShader = `uniform float atlasReflectionDensity;\n${shader.fragmentShader}`
        .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
          'vec3 outgoingLight = totalSpecular + totalEmissiveRadiance;')
        .replace('#include <opaque_fragment>', `
          float atlasGrazing = pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);
          float atlasCoverage = clamp(opacity * mix(atlasReflectionDensity, 1.0, atlasGrazing), 0.015, 0.92);
          gl_FragColor = vec4(outgoingLight / max(atlasCoverage, 0.04), atlasCoverage);
        `);
    };
    material.customProgramCacheKey = () => 'atlas-clear-reflection-v2';
  }
  return material;
}
function placeNfcReference(tag, layoutVersion) {
  const approved = layoutVersion === APPROVED_LABEL_LAYOUT.version;
  tag.position.set(approved ? APPROVED_LABEL_LAYOUT.nfc.x - SLAB_MODEL.labelWidth / 2 : 17.08,
    SLAB_MODEL.labelY + (approved ? SLAB_MODEL.labelHeight / 2 - APPROVED_LABEL_LAYOUT.nfc.y : 0), approved ? .26 : .205);
}
function addNfcReference(labels, texture, layoutVersion) {
  const tag = mesh(labels, 'illustrative-front-nfc-reference', new CircleGeometry(5.1, 48),
    new MeshBasicMaterial({ map: texture, toneMapped: false }));
  placeNfcReference(tag, layoutVersion);
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
export function createSlabModel({ front, back, label, backLabel, labelLayoutVersion, nfc, materialMode = SLAB_STUDIO.material }) {
  const model = new Group(); model.name = SLAB_MODEL.version; model.userData.geometryAuthority = 'illustrative';
  model.userData.materialMode = materialMode; model.userData.studioVersion = SLAB_STUDIO.version;
  model.userData.labelLayoutVersion = labelLayoutVersion ?? null;
  const shell = new Group(), card = new Group(), labels = new Group();
  shell.name = 'clear-two-piece-shell'; card.name = 'approved-card-photographs'; labels.name = 'saved-label'; model.add(shell, card, labels);
  const clear = plastic({ opacity: .76, roughness: .085, reflectionDensity: .13 }, materialMode);
  const shoulderMaterial = plastic({ opacity: .22, roughness: .12, clearcoat: .25, reflectionDensity: .025 }, materialMode);
  const polished = plastic({ opacity: .86, roughness: .055, clearcoat: 1, envMapIntensity: 1.2, reflectionDensity: .22 }, materialMode);
  const rail = plastic({ opacity: .62, roughness: .11, clearcoat: .6, reflectionDensity: .16 }, materialMode);
  const seal = new MeshPhysicalMaterial({ color: 0x7f7f7f, metalness: 0, ior: 1.49, opacity: .34, transparent: true,
    depthWrite: false, roughness: .23, envMapIntensity: .35 });
  const weld = new MeshPhysicalMaterial({ color: 0xbdbdbd, metalness: 0, ior: 1.49, opacity: .22, transparent: true,
    depthWrite: false, roughness: .20, envMapIntensity: .5 });
  const ribGeometry = solid(.85, 86.7, .4, 1.05, .12);
  for (const [side, sign] of [['front', 1], ['back', -1]]) {
    // A thick curved wall, a rolled outer lip and a lower internal shoulder give
    // the two shell halves distinct depth cues at every angle.
    mesh(shell, `${side}-beveled-shell`, ring(SLAB_MODEL.width, SLAB_MODEL.height, 2.7, 2.55, SLAB_MODEL.depth / 2, .50), clear, 0, 0, sign * SLAB_MODEL.depth / 4);
    mesh(shell, `${side}-polished-lip`, ring(79.10, 134.218, 2.35, .86, .28, .105), polished, 0, 0, sign * 2.87);
    mesh(shell, `${side}-window-shoulder`, shoulder(), shoulderMaterial, 0, 0, sign * 2.31);
    mesh(shell, `${side}-recessed-weld-channel`, ring(75.36, 130.478, 1.95, .32, .24, .06), weld, 0, 0, sign * 2.13);
    mesh(shell, `${side}-label-bay`, ring(70.464, 22.5, 1.1, .75, .90, .16), rail, 0, 51.041, sign * 1.15);
    mesh(shell, `${side}-card-pocket`, ring(65.064, 91, 1, .62, .85, .14), rail, 0, -10.209, sign * .95);
    for (const x of [-33.4, 33.4]) mesh(shell, `${side}-retention-rail-${x < 0 ? 'left' : 'right'}`,
      ribGeometry, polished, x, -10.259, sign * .95);
    for (const [name, y, width, height] of [['label-divider', 37.891, 71.5, .85], ['card-support', -57.059, 70.264, .85], ['foot-rib', -61.609, 68.264, .55]])
      mesh(shell, `${side}-${name}`, solid(width, height, height / 2, .80, .11), rail, 0, y, sign * 1.1);
  }
  // An inset physical joining band, rather than a screen-space outline, remains
  // readable in edge view. It is illustrative mould anatomy, not measured CAD.
  mesh(shell, 'two-piece-midline-seam', ring(80.10, 135.218, 2.62, .38, .20, .045), seal);
  // No broad glass cover is layered over the evidence windows.
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
  // The owner-authorized NFC reference is a separate presentation overlay over
  // the opaque B circle; the saved/print artwork texture remains unchanged.
  // Historical labels retain their original below-artwork placement.
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
    // Preserve the recorded artwork's own ratio, including raster rounding.
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
export function createSlabScene(host, { frontUrl, backUrl, labelUrl, backLabelUrl, labelLayoutVersion, nfcUrl, onReady = () => {}, onError = () => {}, onAssetError = () => {}, onAssetReady = () => {}, onFacing = () => {} }, overrides = {}) {
  if (![frontUrl, backUrl].every(url => typeof url === 'string' && url.startsWith('blob:'))
    || [labelUrl, backLabelUrl].some(url => url && (typeof url !== 'string' || !url.startsWith('blob:')))) throw error('SLAB_APPROVED_SOURCE_REQUIRED');
  const win = overrides.window ?? window, doc = overrides.document ?? document;
  const renderer = overrides.renderer ?? new WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'low-power' });
  const scene = new Scene(), camera = new PerspectiveCamera(26, 1, .1, 1000);
  const aborter = new AbortController(), images = new Set(), textures = new Set(), listeners = [];
  let model, frame = null, disposed = false, ready = false, visible = true, angle = INITIAL_SLAB_ANGLE, drag = null;
  let resizeObserver, intersectionObserver, contactShadow;
  let wantedAssets = { frontUrl, backUrl, labelUrl, backLabelUrl, labelLayoutVersion };
  const currentAssets = {}, assetRequests = new Map(), photoImages = {};
  const canvas = renderer.domElement;
  renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = NoToneMapping; scene.background = new Color(0xffffff);
  camera.position.set(0, 0, 300); camera.lookAt(0, 0, 0);
  scene.environment = createSlabStudioEnvironment(); textures.add(scene.environment);
  // An authored soft footprint grounds the presentation without a shadow pass
  // or an overlay on the photograph. It is not measured photographic evidence.
  const shadowPixels = new Uint8Array(128 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) {
    const radius = ((x + .5 - 64) / 61) ** 2 + ((y + .5 - 16) / 13) ** 2;
    shadowPixels[(y * 128 + x) * 4 + 3] = Math.round(255 * Math.exp(-radius * 3));
  }
  const shadowTexture = new DataTexture(shadowPixels, 128, 32); shadowTexture.needsUpdate = true; textures.add(shadowTexture);
  contactShadow = mesh(scene, 'illustrative-studio-contact-shadow', new PlaneGeometry(86, 6),
    new MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: .10, depthWrite: false, toneMapped: false }), 0, -68.7, -4);
  contactShadow.renderOrder = -1;
  scene.add(new HemisphereLight(0xffffff, 0xa0a0a0, .65));
  for (const [x, y, z, intensity] of [[-90, 110, 140, 1.8], [100, 40, -120, 1.1]]) {
    const light = new DirectionalLight(0xffffff, intensity); light.position.set(x, y, z); scene.add(light);
  }
  canvas.setAttribute('aria-hidden', 'true'); canvas.dataset.slabModel = SLAB_MODEL.version;
  canvas.dataset.slabStudio = SLAB_STUDIO.version; canvas.dataset.slabMaterial = overrides.materialMode ?? SLAB_STUDIO.material;
  host.appendChild(canvas);
  const listen = (target, type, handler, options) => { target.addEventListener(type, handler, options); listeners.push(() => target.removeEventListener(type, handler, options)); };
  const stopFrame = () => { if (frame !== null) { win.cancelAnimationFrame(frame); frame = null; } };
  function draw() {
    frame = null; if (disposed || !model || !visible || doc.hidden) return;
    try {
      renderer.render(scene, camera);
      canvas.dataset.slabDrawCalls = String(renderer.info.render.calls); canvas.dataset.slabTriangles = String(renderer.info.render.triangles);
      canvas.dataset.slabSourceTextureBytes = String([...textures].reduce((sum, texture) => sum + (texture.image.naturalWidth || texture.image.width) * (texture.image.naturalHeight || texture.image.height) * 4 * (texture.image.data?.BYTES_PER_ELEMENT || 1) * 4 / 3, 0));
      canvas.dataset.slabAngle = String(angle); canvas.dataset.slabFacing = slabFacing(angle);
      canvas.dataset.slabFrames = String(Number(canvas.dataset.slabFrames ?? 0) + 1);
      if (!ready) { ready = true; onReady({ modelVersion: SLAB_MODEL.version,
        photos: ['front', 'back'].map(side => { const image = photoImages[side]; return { width: image.naturalWidth, height: image.naturalHeight }; }),
        estimatedTextureBytes: [...textures].reduce((sum, texture) => sum + (texture.image.naturalWidth || texture.image.width) * (texture.image.naturalHeight || texture.image.height) * 4 * (texture.image.data?.BYTES_PER_ELEMENT || 1) * 4 / 3, 0),
        studioVersion: SLAB_STUDIO.version, materialMode: overrides.materialMode ?? SLAB_STUDIO.material,
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }); }
    } catch { fail(error('SLAB_RENDER_UNAVAILABLE')); }
  }
  function requestRender() { if (!disposed && visible && !doc.hidden && frame === null) frame = win.requestAnimationFrame(draw); }
  function resize() {
    if (disposed) return;
    const width = host.clientWidth, height = host.clientHeight; if (!(width > 0 && height > 0)) return;
    renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 2)); renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const tangentY = Math.tan(camera.fov * Math.PI / 360), tangentX = tangentY * camera.aspect;
    const turnRadius = Math.hypot(SLAB_MODEL.width, SLAB_MODEL.depth) / 2, margin = 1.03;
    // Fit the full rotation envelope, including the near edge moving toward the
    // perspective camera. Keep distance fixed while turning, with 3% headroom.
    camera.position.z = Math.max(SLAB_MODEL.height / 2 * margin / tangentY + turnRadius,
      turnRadius * Math.hypot(1, margin / tangentX));
    // The evidence planes sit 0.011 mm above their carriers. A generic .1–1000
    // frustum quantizes that gap away at this distance, causing white stripes.
    // Bound depth to the same turn envelope so those separate surfaces remain
    // resolved without moving, cropping or relighting the saved artwork.
    camera.near = Math.max(1, camera.position.z - turnRadius - 10);
    camera.far = camera.position.z + turnRadius + 10;
    camera.updateProjectionMatrix(); requestRender();
  }
  function setAngle(value) { if (disposed || !model) return; angle = normalizeSlabAngle(value); model.rotation.y = angle;
    contactShadow.scale.x = (SLAB_MODEL.width * Math.abs(Math.cos(angle)) + SLAB_MODEL.depth * Math.abs(Math.sin(angle))) / SLAB_MODEL.width;
    onFacing(slabFacing(angle)); requestRender(); }
  function endDrag() { const previous = drag; drag = null; host.removeAttribute('data-dragging');
    if (previous && host.hasPointerCapture?.(previous.id)) host.releasePointerCapture(previous.id); }
  function dispose() {
    if (disposed) return; disposed = true; aborter.abort(error('SLAB_CANCELLED'));
    assetRequests.forEach(request => request.aborter.abort(error('SLAB_CANCELLED'))); assetRequests.clear(); clearTimeout(timeout); stopFrame(); endDrag();
    listeners.splice(0).forEach(remove => remove()); resizeObserver?.disconnect(); intersectionObserver?.disconnect();
    disposeSlabModel(model); contactShadow?.geometry.dispose(); contactShadow?.material.dispose(); textures.forEach(texture => { texture.dispose(); if (texture.image?.getContext) { texture.image.width = 0; texture.image.height = 0; } }); textures.clear();
    images.forEach(image => image.removeAttribute('src')); images.clear(); scene.environment = null; scene.clear();
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
  const releaseTexture = texture => {
    if (!texture) return;
    textures.delete(texture); texture.dispose(); const image = texture.image;
    if (image?.getContext) { image.width = 0; image.height = 0; }
    else if (images.has(image)) { image.removeAttribute('src'); images.delete(image); }
  };
  const removePart = name => {
    const part = model?.getObjectByName(name); if (!part) return;
    part.removeFromParent(); part.geometry.dispose(); releaseTexture(part.material.map); part.material.dispose();
  };
  function installAsset(key, image, url) {
    const isPhoto = key === 'frontUrl' || key === 'backUrl', isNfc = key === 'nfcUrl';
    const side = key === 'backUrl' || key === 'backLabelUrl' ? 'back' : 'front';
    const name = isPhoto ? `${side}-approved-photograph` : isNfc ? 'illustrative-front-nfc-reference' : `${side}-saved-label-artwork`;
    if (!image) {
      removePart(name); currentAssets[key] = null;
      if (key === 'backLabelUrl') {
        const carrier = model.getObjectByName('saved-label-carrier');
        if (carrier) carrier.name = 'plain-label-carrier-no-reverse-artwork';
      }
      onAssetReady({ slot: key }); return;
    }
    const texture = isPhoto ? photoTexture(image, renderer) : rasterTexture(image, renderer, doc, isNfc ? 'nfc' : 'label');
    textures.add(texture);
    if (!isPhoto) { image.removeAttribute('src'); images.delete(image); }
    let part = model.getObjectByName(name);
    if (part) {
      const old = part.material.map; part.material.map = texture; part.material.needsUpdate = true; releaseTexture(old);
      if (isPhoto) { const fitted = fitSlabPhoto(image.naturalWidth, image.naturalHeight); part.geometry.dispose(); part.geometry = new PlaneGeometry(fitted.width, fitted.height); }
    } else if (isNfc) addNfcReference(model.getObjectByName('saved-label'), texture, currentAssets.labelLayoutVersion);
    else {
      part = mesh(model.getObjectByName('saved-label'), name, new PlaneGeometry(SLAB_MODEL.labelWidth, SLAB_MODEL.labelHeight),
        new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }), 0, SLAB_MODEL.labelY, side === 'back' ? -.22 : .22);
      if (side === 'back') part.rotation.y = Math.PI;
    }
    if (key === 'backLabelUrl') {
      const carrier = model.getObjectByName('plain-label-carrier-no-reverse-artwork');
      if (carrier) carrier.name = 'saved-label-carrier';
    }
    if (key === 'labelUrl') {
      currentAssets.labelLayoutVersion = wantedAssets.labelLayoutVersion;
      const nfc = model.getObjectByName('illustrative-front-nfc-reference');
      if (nfc) placeNfcReference(nfc, currentAssets.labelLayoutVersion);
    }
    if (isPhoto) photoImages[side] = image;
    currentAssets[key] = url; onAssetReady({ slot: key }); requestRender();
    if (key === 'labelUrl') syncNfcReference();
  }
  function replaceAsset(key, url) {
    const previous = assetRequests.get(key);
    if (previous?.url === url || !previous && currentAssets[key] === url) return;
    previous?.aborter.abort(error('SLAB_ASSET_SUPERSEDED')); assetRequests.delete(key);
    if (!url) { installAsset(key, null, null); requestRender(); return; }
    const request = { url, aborter: new AbortController() }; assetRequests.set(key, request);
    void loadSlabImage(url, { signal: request.aborter.signal, ImageClass: overrides.ImageClass ?? win.Image }).then(image => {
      if (disposed || assetRequests.get(key) !== request) { image.removeAttribute('src'); return; }
      images.add(image);
      try { installAsset(key, image, url); }
      catch (failure) { image.removeAttribute('src'); images.delete(image); onAssetError(failure, { slot: key }); }
    }).catch(failure => { if (!disposed && !request.aborter.signal.aborted) onAssetError(failure, { slot: key }); })
      .finally(() => { if (assetRequests.get(key) === request) assetRequests.delete(key); });
  }
  function syncNfcReference() {
    // Follow the successfully displayed label, including while a replacement is
    // pending or has failed. The overlay never modifies its saved artwork map.
    replaceAsset('nfcUrl', currentAssets.labelUrl && nfcUrl ? nfcUrl : null);
  }
  /** Same-card progressive replacement. Callers must remount at an approval/card
   * identity change. Each slot cancels stale loads; failure retains usable pixels. */
  function updateAssets(next = {}) {
    if (disposed) return;
    const wanted = { ...wantedAssets, ...next };
    if (![wanted.frontUrl, wanted.backUrl].every(url => typeof url === 'string' && url.startsWith('blob:'))
      || [wanted.labelUrl, wanted.backLabelUrl].some(url => url && (typeof url !== 'string' || !url.startsWith('blob:')))) throw error('SLAB_APPROVED_SOURCE_REQUIRED');
    wantedAssets = wanted;
    if (!model) return;
    model.userData.labelLayoutVersion = wanted.labelLayoutVersion ?? null;
    for (const key of ['frontUrl', 'backUrl', 'labelUrl', 'backLabelUrl']) replaceAsset(key, wanted[key] || null);
    const nfc = model.getObjectByName('illustrative-front-nfc-reference');
    if (currentAssets.labelUrl === wanted.labelUrl) {
      const changed = currentAssets.labelLayoutVersion !== wanted.labelLayoutVersion;
      currentAssets.labelLayoutVersion = wanted.labelLayoutVersion;
      if (nfc && changed) { placeNfcReference(nfc, currentAssets.labelLayoutVersion); requestRender(); }
    }
    syncNfcReference();
  }
  const started = (async () => {
    try {
      const [frontImage, backImage] = await Promise.all([load(frontUrl), load(backUrl)]);
      if (disposed) return;
      const front = photoTexture(frontImage, renderer); textures.add(front);
      const back = photoTexture(backImage, renderer); textures.add(back);
      photoImages.front = frontImage; photoImages.back = backImage;
      currentAssets.frontUrl = frontUrl; currentAssets.backUrl = backUrl;
      model = createSlabModel({ front, back, labelLayoutVersion, materialMode: overrides.materialMode });
      model.rotation.y = angle; scene.add(model); clearTimeout(timeout);
      onFacing(slabFacing(angle)); resize(); updateAssets(wantedAssets);
    } catch (failure) { fail(failure); }
  })();
  return { started, updateAssets, retryAssets(slots) { if (disposed || !model) return; for (const slot of slots) if (['frontUrl', 'backUrl', 'labelUrl', 'backLabelUrl'].includes(slot)) replaceAsset(slot, wantedAssets[slot] || null); }, rotateBy(delta) { endDrag(); setAngle(angle + delta); }, reset() { endDrag(); setAngle(INITIAL_SLAB_ANGLE); }, dispose };
}
