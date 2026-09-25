import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePhoto, decodePhoto, readNativePhotoBytes, photoStorageError } from '../src/photo-bytes.mjs';

test('exact original bytes, MIME, name and modification time survive envelopes', async () => {
  const original = new File([new Uint8Array([0, 255, 127, 13, 10, 128])], 'original.heic', { type: 'image/heic', lastModified: 123456 });
  const encoded = await encodePhoto(original), restored = decodePhoto(structuredClone(encoded));
  assert.deepEqual(new Uint8Array(await restored.arrayBuffer()), new Uint8Array(await original.arrayBuffer()));
  assert.equal(restored.type, original.type); assert.equal(restored.name, original.name); assert.equal(restored.lastModified, original.lastModified);
});
test('reader fallback returns identical native bytes without decoding', async () => {
  const file = new Blob(['\u0000native\u00ff']), expected = await file.arrayBuffer();
  file.arrayBuffer = async () => { throw new DOMException('private raw message', 'NotReadableError'); };
  class Reader { readAsArrayBuffer() { this.result = expected; this.onload(); } }
  assert.deepEqual(await readNativePhotoBytes(file, { FileReaderImpl: Reader, ResponseImpl: null }), expected);
});
test('Response byte fallback follows FileReader failure', async () => {
  const file = new Blob(['native']), expected = await file.arrayBuffer(); file.arrayBuffer = async () => { throw Error('first'); };
  class Reader { readAsArrayBuffer() { throw new DOMException('second', 'NotReadableError'); } }
  class Response { arrayBuffer() { return expected; } }
  assert.deepEqual(await readNativePhotoBytes(file, { FileReaderImpl: Reader, ResponseImpl: Response }), expected);
});
test('all reader failures retain an explicit safe code and exception name', async () => {
  const file = new Blob(['original']); file.arrayBuffer = async () => { throw new DOMException('PRIVATE', 'NotReadableError'); };
  await assert.rejects(readNativePhotoBytes(file, { FileReaderImpl: null, ResponseImpl: null }), failure => failure.code === 'PHOTO_BYTES_UNREADABLE' && failure.name === 'NotReadableError' && !failure.message.includes('PRIVATE'));
  assert.equal(file.size, 8);
});
test('truncated bytes fail closed without invoking another reader', async () => {
  const file = new Blob(['native']); file.arrayBuffer = async () => new ArrayBuffer(1);
  class Reader { constructor() { assert.fail('must not reinterpret truncated bytes'); } }
  await assert.rejects(readNativePhotoBytes(file, { FileReaderImpl: Reader }), { code: 'PHOTO_BYTES_INVALID' });
});
test('corrupt persisted envelopes fail closed and legacy Blob remains untouched', () => {
  assert.throws(() => decodePhoto({ format: 'atlas-original-bytes-v1', bytes: new ArrayBuffer(2), byteCount: 3, type: 'image/png', name: null, lastModified: null }), { code: 'PHOTO_STORAGE_CORRUPT' });
  const blob = new Blob(['native']); assert.equal(decodePhoto(blob), blob);
});
test('only confirmed QuotaExceededError is described as full storage', () => {
  assert.equal(photoStorageError(new Error('quota?'), 'BATCH_IMPORT_STORAGE').code, 'BATCH_IMPORT_STORAGE');
  assert.equal(photoStorageError(new DOMException('private detail', 'QuotaExceededError')).code, 'PHOTO_STORAGE_QUOTA');
  assert.equal(photoStorageError({ code: 'PHOTO_BYTES_UNREADABLE', name: 'NotReadableError' }).code, 'PHOTO_BYTES_UNREADABLE');
});
test('hung native readers time out and permit another exact byte reader', async () => {
  const file = new Blob(['native']), expected = await file.arrayBuffer(); file.arrayBuffer = () => new Promise(() => {});
  class Reader { readAsArrayBuffer() { this.result = expected; this.onload(); } }
  assert.deepEqual(await readNativePhotoBytes(file, { FileReaderImpl: Reader, ResponseImpl: null, readTimeoutMs: 5 }), expected);
  class HungResponse { arrayBuffer() { return new Promise(() => {}); } }
  await assert.rejects(readNativePhotoBytes(file, { FileReaderImpl: null, ResponseImpl: HungResponse, readTimeoutMs: 5 }), { code: 'PHOTO_BYTES_UNREADABLE', name: 'TimeoutError' });
});
