import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_STAFF_PHOTO_SOURCE_BYTES,
  MAX_STAFF_PHOTO_UPLOAD_BYTES,
  STAFF_INVENTORY_PHOTO_ACCEPT,
  prepareStaffInventoryPhoto,
  staffInventoryPhotoDimensions,
  staffInventoryPhotoKind,
} from '../lib/inventoryPhotoUpload';

function heif(major = 'heic', compatible = ['mif1', 'heic']) {
  const bytes = Buffer.alloc(16 + 4 * compatible.length);
  bytes.writeUInt32BE(bytes.length); bytes.write('ftyp', 4); bytes.write(major, 8);
  compatible.forEach((brand, index) => bytes.write(brand, 16 + 4 * index));
  return bytes;
}

test('photo recognition uses bytes and accepts normal iPhone HEIC/HEIF brands', () => {
  for (const [bytes, kind] of [[Buffer.from([0xff, 0xd8, 0xff]), 'jpeg'], [Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), 'png'], [Buffer.from('RIFF1234WEBP'), 'webp'], [heif(), 'heic'], [heif('heix'), 'heic'], [heif('mif1'), 'heic'], [heif('mif1', ['mif1', 'heic', 'hevc']), 'heic']] as const) assert.equal(staffInventoryPhotoKind(bytes), kind);
  assert.ok(STAFF_INVENTORY_PHOTO_ACCEPT.includes('.heic')); assert.ok(STAFF_INVENTORY_PHOTO_ACCEPT.includes('image/heif'));
  for (const bytes of [Buffer.from('<svg></svg>'), Buffer.from('GIF89a'), heif('avif', ['mif1', 'avif']), heif('msf1'), heif().subarray(0, 18), Buffer.from(''), Buffer.from('0000ftyp')]) assert.equal(staffInventoryPhotoKind(bytes), null);
  const malformed = heif(); malformed.writeUInt32BE(15); assert.equal(staffInventoryPhotoKind(malformed), null);
});

test('12 MP and 48 MP phone dimensions preserve portrait/landscape and never crop or enlarge', () => {
  assert.deepEqual(staffInventoryPhotoDimensions(4032, 3024), { width: 1400, height: 1050 });
  assert.deepEqual(staffInventoryPhotoDimensions(3024, 4032), { width: 1050, height: 1400 });
  assert.deepEqual(staffInventoryPhotoDimensions(8064, 6048), { width: 1400, height: 1050 });
  assert.deepEqual(staffInventoryPhotoDimensions(6048, 8064), { width: 1050, height: 1400 });
  assert.deepEqual(staffInventoryPhotoDimensions(800, 600), { width: 800, height: 600 });
  for (const [width, height] of [[0, 1], [NaN, 3], [1.5, 2], [16385, 1], [9000, 6000]]) assert.throws(() => staffInventoryPhotoDimensions(width, height), /50 megapixels/);
  assert.ok(Buffer.byteLength(JSON.stringify({ image: `data:image/jpeg;base64,${'A'.repeat(4 * Math.ceil(MAX_STAFF_PHOTO_UPLOAD_BYTES / 3))}` })) < 4_500_000);
});

test('empty, oversized, spoofed and cancelled inputs fail before any browser decoder runs', async () => {
  await assert.rejects(prepareStaffInventoryPhoto(new File([], 'empty.jpg')), /under 30 MB/);
  const oversized = { size: MAX_STAFF_PHOTO_SOURCE_BYTES + 1, slice: () => assert.fail('oversized source read') } as unknown as File;
  await assert.rejects(prepareStaffInventoryPhoto(oversized), /under 30 MB/);
  await assert.rejects(prepareStaffInventoryPhoto(new File(['<svg/>'], 'photo.HEIC', { type: 'image/heic' })), /could not be opened/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareStaffInventoryPhoto(new File([heif()], 'photo.heic'), { signal: controller.signal }), { name: 'AbortError' });
});

test('native load cancellation releases the image URL and never starts an HEIC worker', async t => {
  let closeCount = 0, workerCount = 0, created = '';
  class FakeImage {
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(value: string) { if (!value) closeCount++; }
  }
  t.mock.method(globalThis.URL, 'createObjectURL', () => { created = 'blob:fixture'; return created; });
  const revoked: string[] = []; t.mock.method(globalThis.URL, 'revokeObjectURL', (value: string) => revoked.push(value));
  const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image'), previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class { constructor() { workerCount++; } } });
  t.after(() => { if (previousImage) Object.defineProperty(globalThis, 'Image', previousImage); else Reflect.deleteProperty(globalThis, 'Image'); if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker); else Reflect.deleteProperty(globalThis, 'Worker'); });
  const controller = new AbortController();
  const pending = prepareStaffInventoryPhoto(new File([heif()], 'photo.heic'), { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(workerCount, 0); assert.equal(closeCount, 1); assert.deepEqual(revoked, [created]);
});

test('a cancelled HEIC decoder is terminated and a subsequent attempt creates a fresh worker', async t => {
  const workers: FakeWorker[] = [];
  class FakeImage {
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onerror?.()); }
  }
  class FakeWorker {
    onmessage: ((event: unknown) => void) | null = null; onerror: ((event: { preventDefault: () => void }) => void) | null = null;
    stopped = false;
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.stopped = true; }
  }
  const names = ['Image', 'Worker'] as const, old = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage }); Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
  t.after(() => names.forEach((name, index) => { const descriptor = old[index]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const pending = prepareStaffInventoryPhoto(new File([heif()], 'phone.HEIF', { type: '' }), { signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(workers.length, attempt + 1); assert.equal(workers[attempt].stopped, false);
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(workers[attempt].stopped, true);
  }
});
