import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { StaffInventoryCardCaptureProps } from '../components/admin/StaffInventoryCardCapture';

const { JSDOM } = require('jsdom');
(globalThis as any).React = React;
(require.extensions as any)['.css'] = (module: NodeModule) => { module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }); };
let prepare: (file: File, options: { signal: AbortSignal }) => Promise<{ image: string }> = async () => ({ image: 'data:image/jpeg;base64,/9j/AA==' });
const helperId = require.resolve('../lib/inventoryPhotoUpload');
require.cache[helperId] = { id: helperId, filename: helperId, loaded: true, exports: {
  STAFF_PHOTO_LONG_EDGE: 1400,
  STAFF_INVENTORY_PHOTO_ACCEPT: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif',
  prepareStaffInventoryPhoto: (file: File, options: { signal: AbortSignal }) => prepare(file, options),
  prepareStaffInventoryCanvasPhoto: (canvas: HTMLCanvasElement, options: { signal: AbortSignal }) => new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (options.signal.aborted) reject(new DOMException('Cancelled', 'AbortError'));
    else if (!blob) reject(new Error('The photo could not be captured. Try again.'));
    else resolve({ blob });
  }, 'image/jpeg', 0.9)),
  staffInventoryPreparedPhotoFile: (photo: { image?: string; blob?: Blob }, name: string) => new File([photo.blob ?? Uint8Array.from(atob(photo.image!.split(',')[1]), character => character.charCodeAt(0))], name, { type: 'image/jpeg' }),
} } as NodeModule;
const Capture = require('../components/admin/StaffInventoryCardCapture').default;

async function mount(overrides: Partial<StaffInventoryCardCaptureProps> = {}) {
  const dom = new JSDOM('<button id="opener">Take photo</button><input id="cost" inputmode="decimal"><div id="root"></div>', { url: 'https://fixture.invalid', pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let mediaCalls = 0, playCalls = 0, pauseCalls = 0, closed = 0, stopped = 0, captured = 0;
  const pairs: [File, File][] = [], errors: string[] = [], revoked: string[] = [];
  const events = new dom.window.EventTarget();
  const track = { enabled: true, readyState: 'live', stop() { stopped++; track.readyState = 'ended'; }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  let getMedia: () => Promise<any> = async () => stream;
  Object.defineProperty(dom.window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async (options: any) => { mediaCalls++; assert.equal(options.audio, false); assert.equal(options.video.facingMode.ideal, 'environment'); return getMedia(); } } });
  let play: () => Promise<void> = async () => {};
  dom.window.HTMLMediaElement.prototype.play = () => { playCalls++; return play(); };
  dom.window.HTMLMediaElement.prototype.pause = () => { pauseCalls++; };
  Object.defineProperty(dom.window.HTMLVideoElement.prototype, 'videoWidth', { get: () => 1920 });
  Object.defineProperty(dom.window.HTMLVideoElement.prototype, 'videoHeight', { get: () => 1440 });
  let finishBlob: ((blob: Blob | null) => void) | undefined;
  let holdBlob = false;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
  dom.window.HTMLCanvasElement.prototype.toBlob = function(callback: (blob: Blob | null) => void, mime: string) {
    assert.equal(mime, 'image/jpeg'); assert.equal(this.width, 1400); assert.equal(this.height, 1050); captured++;
    if (holdBlob) finishBlob = callback;
    else queueMicrotask(() => callback(new Blob([`capture-${captured}`], { type: 'image/jpeg' })));
  };
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  let blobNumber = 0;
  URL.createObjectURL = () => `blob:fixture-${++blobNumber}`;
  URL.revokeObjectURL = value => revoked.push(value);
  const root = createRoot(document.getElementById('root')!);
  let props: StaffInventoryCardCaptureProps = { open: true, cycle: 1, onPair: (front, back) => pairs.push([front, back]), onClose: () => { closed++; }, onError: message => errors.push(message), ...overrides };
  const render = async (next: Partial<StaffInventoryCardCaptureProps> = {}) => { props = { ...props, ...next }; await act(async () => root.render(<Capture {...props} />)); };
  const button = (label: string) => {
    const found = [...document.querySelectorAll('button')].find(element => !element.closest('[hidden]') && (element.textContent?.trim() === label || element.getAttribute('aria-label') === label));
    assert.ok(found, `Visible button: ${label}`); return found;
  };
  document.getElementById('opener')!.focus();
  await render();
  return {
    render, button, pairs, errors, revoked, track,
    get counts() { return { mediaCalls, playCalls, pauseCalls, closed, stopped, captured }; },
    async click(label: string) { await act(async () => button(label).click()); },
    async select(side: string, file?: File) { const input = document.querySelector<HTMLInputElement>(`input[aria-label="Choose card ${side} photo"]`)!; Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] }); await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))); },
    async visibility(hidden: boolean) { Object.defineProperty(document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' }); await act(async () => document.dispatchEvent(new dom.window.Event('visibilitychange'))); },
    async ended() { track.readyState = 'ended'; await act(async () => events.dispatchEvent(new dom.window.Event('ended'))); },
    async paused() { await act(async () => document.querySelector('video')!.dispatchEvent(new dom.window.Event('pause'))); },
    async key(key: string, shiftKey = false) { await act(async () => document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))); },
    setMedia(next: typeof getMedia) { getMedia = next; },
    setPlay(next: typeof play) { play = next; },
    holdCapture() { holdBlob = true; },
    async finishCapture(blob: Blob | null = new Blob(['late'], { type: 'image/jpeg' })) { await act(async () => finishBlob!(blob)); },
    async close() { await act(async () => root.unmount()); dom.window.close(); URL.createObjectURL = create; URL.revokeObjectURL = revoke; for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } },
  };
}

test('front then back emits one local pair, keeps stream paused during pricing and reuses it next card', async () => {
  const ui = await mount();
  try {
    assert.equal(ui.counts.mediaCalls, 1); assert.equal(ui.button('Capture front').disabled, false);
    const video = document.querySelector('video')!; assert.equal(video.playsInline, true); assert.equal(video.muted, true);
    await ui.click('Capture front'); assert.equal(ui.pairs.length, 0); assert.ok(document.querySelector('img[alt="Captured card front"]'));
    await ui.click('Capture back'); assert.equal(ui.pairs.length, 1); assert.equal(ui.track.enabled, false);
    assert.deepEqual(ui.pairs[0].map(file => [file.name, file.type]), [['card-front.jpg', 'image/jpeg'], ['card-back.jpg', 'image/jpeg']]);
    await ui.render({ open: false }); assert.equal(ui.counts.stopped, 0);
    await ui.render({ open: true, cycle: 2 }); assert.equal(ui.counts.mediaCalls, 1); assert.equal(ui.track.enabled, true); assert.equal(document.querySelectorAll('img').length, 0); assert.equal(ui.revoked.length, 2);
    await ui.click('Capture front'); await ui.click('Capture back'); assert.equal(ui.pairs.length, 2);
  } finally { await ui.close(); }
  assert.equal(ui.counts.stopped, 1); assert.equal(ui.revoked.length, 4);
});

test('retaking the front uses its replacement and duplicate shutter clicks do not duplicate work', async () => {
  const ui = await mount();
  try {
    await ui.click('Capture front'); await ui.click('Retake front'); assert.equal(ui.revoked.length, 1);
    ui.holdCapture();
    await act(async () => { ui.button('Capture front').click(); ui.button('Capture front').click(); });
    assert.equal(ui.counts.captured, 2); assert.equal(ui.pairs.length, 0);
    await ui.finishCapture();
    await act(async () => { ui.button('Capture back').click(); ui.button('Capture back').click(); });
    await ui.finishCapture(); assert.equal(ui.counts.captured, 3); assert.equal(ui.pairs.length, 1);
    assert.equal(await ui.pairs[0][0].text(), 'late');
  } finally { await ui.close(); }
});

test('library entry requests no camera, preserves front on cancel or failed back and accepts HEIC through shared helper', async () => {
  const inputs: File[] = [];
  prepare = async file => { inputs.push(file); if (file.name === 'bad.heic') throw new Error('Cannot decode this photo.'); return { image: 'data:image/jpeg;base64,/9j/AA==' }; };
  const ui = await mount({ initialSource: 'library' });
  try {
    assert.equal(ui.counts.mediaCalls, 0); assert.ok(document.querySelector<HTMLInputElement>('input[type="file"]')!.accept.includes('heic'));
    await ui.select('front', new File(['fixture'], 'front.heic', { type: 'image/heic' }));
    await ui.select('back'); assert.equal(ui.pairs.length, 0); assert.ok(ui.button('Choose back photo'));
    await ui.select('back', new File(['fixture'], 'bad.heic')); assert.equal(ui.errors.at(-1), 'Cannot decode this photo.'); assert.ok(document.querySelector('img[alt="Captured card front"]'));
    await ui.select('back', new File(['fixture'], 'back.heic')); assert.equal(ui.pairs.length, 1); assert.equal(ui.pairs[0][0].type, 'image/jpeg'); assert.equal(ui.counts.mediaCalls, 0); assert.equal(inputs.length, 3);
  } finally { await ui.close(); }
});

test('late media permission completion after close stops every track and never installs it', async () => {
  const ui = await mount({ open: false });
  let resolve: ((value: any) => void) | undefined;
  let lateStopped = 0;
  ui.setMedia(() => new Promise(done => { resolve = done; }));
  try {
    await ui.render({ open: true }); assert.equal(ui.counts.mediaCalls, 1);
    await ui.render({ open: false });
    const late = { stop() { lateStopped++; }, readyState: 'live' };
    await act(async () => resolve!({ getTracks: () => [late], getVideoTracks: () => [late] }));
    assert.equal(lateStopped, 1); assert.equal(document.querySelector('video')!.srcObject ?? null, null);
    await ui.render({ open: true, cycle: 2 }); assert.equal(ui.counts.mediaCalls, 1); assert.ok(ui.button('Resume camera'));
  } finally { await ui.close(); }
});

test('permission denial is actionable, preserves library choice and never retries on a new cycle', async () => {
  const ui = await mount({ open: false });
  ui.setMedia(async () => { throw new DOMException('No permission', 'NotAllowedError'); });
  try {
    await ui.render({ open: true }); assert.match(ui.errors[0], /Camera access is off/);
    await ui.render({ cycle: 2 }); assert.equal(ui.counts.mediaCalls, 1);
    await ui.click('Choose photos instead'); assert.ok(ui.button('Choose front photo')); assert.equal(ui.counts.mediaCalls, 1);
  } finally { await ui.close(); }
});

test('an automatic next-card open without a previous camera session waits for Resume camera', async () => {
  const ui = await mount({ open: false });
  try {
    await ui.render({ open: true, cycle: 2, autoStartCamera: false });
    assert.equal(ui.counts.mediaCalls, 0); assert.ok(ui.button('Resume camera'));
    await ui.click('Resume camera'); assert.equal(ui.counts.mediaCalls, 1); assert.equal(ui.button('Capture front').disabled, false);
  } finally { await ui.close(); }
});

test('a hidden document and ended track release camera and require a user resume', async () => {
  const ui = await mount();
  try {
    await ui.click('Capture front'); await ui.visibility(true); assert.equal(ui.counts.stopped, 1);
    await ui.visibility(false); await ui.render({ cycle: 2 }); assert.equal(ui.counts.mediaCalls, 1); assert.ok(ui.button('Resume camera'));
    ui.track.readyState = 'live'; await ui.click('Resume camera'); assert.equal(ui.counts.mediaCalls, 2);
    await ui.ended(); assert.equal(ui.counts.stopped, 2); assert.ok(ui.button('Resume camera'));
  } finally { await ui.close(); }
});

test('blocked playback resumes the retained stream without another media request', async () => {
  const ui = await mount({ open: false });
  ui.setPlay(async () => { throw new DOMException('Gesture needed', 'NotAllowedError'); });
  try {
    await ui.render({ open: true }); assert.ok(ui.button('Resume camera')); assert.equal(ui.track.enabled, false);
    ui.setPlay(async () => {}); await ui.click('Resume camera'); assert.equal(ui.counts.mediaCalls, 1); assert.equal(ui.button('Capture front').disabled, false);
  } finally { await ui.close(); }
});

test('a browser-paused video offers a gesture to resume the retained camera', async () => {
  const ui = await mount();
  try {
    await ui.paused(); assert.equal(ui.track.enabled, false); assert.ok(ui.button('Resume camera'));
    await ui.click('Resume camera'); assert.equal(ui.counts.mediaCalls, 1); assert.equal(ui.button('Capture front').disabled, false);
  } finally { await ui.close(); }
});

test('cancelling preparation and changing cycle ignores an old photo and aborts its decoder', async () => {
  let signal: AbortSignal | undefined, resolve: ((value: { image: string }) => void) | undefined;
  prepare = async (_file, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); };
  const ui = await mount({ initialSource: 'library' });
  try {
    await ui.select('front', new File(['fixture'], 'front.heic'));
    await ui.click('Cancel photo'); assert.equal(signal!.aborted, true);
    await ui.render({ cycle: 2 });
    await act(async () => resolve!({ image: 'data:image/jpeg;base64,/9j/AA==' }));
    assert.equal(document.querySelectorAll('img').length, 0); assert.equal(ui.pairs.length, 0); assert.ok(ui.button('Choose front photo'));
  } finally { await ui.close(); }
});

test('closing during canvas encoding ignores its stale completion and keyboard focus stays scoped', async () => {
  const ui = await mount();
  try {
    assert.equal(document.activeElement?.hasAttribute('data-inventory-camera'), true);
    await ui.key('Tab'); assert.equal(document.activeElement?.getAttribute('aria-label'), 'Close card camera');
    await ui.key('Tab', true); assert.equal(document.activeElement?.textContent, 'Choose photos instead');
    ui.holdCapture(); await ui.click('Capture front');
    await ui.key('Escape'); assert.equal(ui.counts.closed, 1); assert.equal(ui.counts.stopped, 1);
    await ui.render({ open: false }); await ui.finishCapture(); assert.equal(ui.pairs.length, 0); assert.equal(document.querySelectorAll('img').length, 0);
    assert.equal(document.activeElement?.id, 'opener');
  } finally { await ui.close(); }
});

test('the back shutter hands focus to Cost before delayed encoding and never restores the opener over it', async () => {
  const ready: string[] = [];
  let handoffs = 0;
  const ui = await mount({ onSideReady: side => ready.push(side), onPricingStart: () => { handoffs++; document.getElementById('cost')!.focus(); } });
  try {
    await ui.click('Capture front'); assert.deepEqual(ready, ['front']);
    ui.holdCapture(); await ui.click('Capture back');
    assert.equal(handoffs, 1); assert.equal(ui.pairs.length, 0);
    assert.equal(document.activeElement?.id, 'cost');
    assert.equal(document.querySelector<HTMLElement>('[data-inventory-camera]')!.hidden, true);
    await ui.finishCapture(); assert.deepEqual(ready, ['front', 'back']); assert.equal(ui.pairs.length, 1);
    await ui.render({ open: false }); assert.equal(document.activeElement?.id, 'cost');
    await ui.render({ open: true, cycle: 2 }); assert.equal(ui.counts.mediaCalls, 1);
    assert.ok(ui.button('Capture front')); assert.equal(ui.track.enabled, true);
  } finally { await ui.close(); }
});

test('failed back encoding restores its camera and keeps the captured front for retry', async () => {
  let cancelled = 0;
  const ui = await mount({ onPricingStart: () => document.getElementById('cost')!.focus(), onPricingCancel: () => { cancelled++; } });
  try {
    await ui.click('Capture front'); ui.holdCapture(); await ui.click('Capture back');
    await ui.finishCapture(null);
    assert.equal(cancelled, 1); assert.equal(ui.pairs.length, 0);
    assert.ok(document.querySelector('img[alt="Captured card front"]')); assert.ok(ui.button('Capture back'));
    assert.equal(ui.counts.mediaCalls, 1); assert.match(ui.errors.at(-1)!, /could not be captured/);
    await ui.click('Capture back'); await ui.finishCapture(); assert.equal(ui.pairs.length, 1);
  } finally { await ui.close(); }
});

test('closing during the back-to-Cost handoff cancels its late photo and does not deliver into a new cycle', async () => {
  const ui = await mount({ onPricingStart: () => document.getElementById('cost')!.focus() });
  try {
    await ui.click('Capture front'); ui.holdCapture(); await ui.click('Capture back');
    await ui.render({ open: false }); await ui.render({ open: true, cycle: 2 });
    await ui.finishCapture();
    assert.equal(ui.pairs.length, 0); assert.equal(document.querySelectorAll('img').length, 0);
    assert.ok(ui.button('Capture front')); assert.equal(ui.counts.mediaCalls, 1);
  } finally { await ui.close(); }
});
