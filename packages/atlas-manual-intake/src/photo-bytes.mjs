/** Browser-only byte preservation. Never decode, resize or re-encode a photo. */
const FORMAT = 'atlas-original-bytes-v1';
const MAX_BYTES = 64 * 1024 * 1024;
const names = new Set(['Error', 'TypeError', 'RangeError', 'AbortError', 'DataCloneError', 'InvalidStateError', 'NotReadableError', 'NotSupportedError', 'OperationError', 'QuotaExceededError', 'SecurityError', 'TimeoutError', 'TransactionInactiveError', 'UnknownError']);
const failure = (code, cause) => Object.assign(new Error(code), { code, name: names.has(cause?.name) ? cause.name : 'Error' });
const check = (ok, code) => { if (!ok) throw failure(code); };

export function photoStorageError(cause, defaultCode = 'PHOTO_STORAGE_UNAVAILABLE') {
  const code = cause?.name === 'QuotaExceededError' ? 'PHOTO_STORAGE_QUOTA'
    : ['PHOTO_BYTES_UNREADABLE', 'PHOTO_BYTES_INVALID', 'PHOTO_STORAGE_CORRUPT'].includes(cause?.code) ? cause.code : defaultCode;
  return failure(code, cause);
}

/** Older file-backed IndexedDB Blobs can fail one browser reader. Try another
 * byte reader, never a canvas/image conversion. A missing backing file remains
 * an explicit failure; neither the old record nor its operation IDs are erased. */
export async function readNativePhotoBytes(file, { FileReaderImpl = globalThis.FileReader, ResponseImpl = globalThis.Response, readTimeoutMs = 30000 } = {}) {
  check(file instanceof Blob && file.size > 0 && file.size <= MAX_BYTES, 'PHOTO_BYTES_INVALID');
  check(Number.isSafeInteger(readTimeoutMs) && readTimeoutMs > 0 && readTimeoutMs <= 120000, 'PHOTO_BYTES_INVALID');
  const timed = async (read, cancel = () => {}) => {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(read), new Promise((_resolve, reject) => {
        timer = setTimeout(() => { reject(failure('PHOTO_BYTES_UNREADABLE', { name: 'TimeoutError' })); try { cancel(); } catch { /* Already timed out. */ } }, readTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };
  const valid = bytes => { check(bytes instanceof ArrayBuffer && bytes.byteLength === file.size, 'PHOTO_BYTES_INVALID'); return bytes; };
  let cause;
  try { return valid(await timed(() => file.arrayBuffer())); } catch (error) { if (error?.code === 'PHOTO_BYTES_INVALID') throw error; cause = error; }
  if (typeof FileReaderImpl === 'function') {
    try {
      const reader = new FileReaderImpl();
      return valid(await timed(() => new Promise((resolve, reject) => {
        const finish = (error, bytes) => { error ? reject(error) : resolve(bytes); };
        reader.onload = () => finish(null, reader.result);
        reader.onerror = () => finish(reader.error ?? failure('PHOTO_BYTES_UNREADABLE'));
        reader.onabort = () => finish(reader.error ?? failure('PHOTO_BYTES_UNREADABLE', { name: 'AbortError' }));
        try { reader.readAsArrayBuffer(file); } catch (error) { finish(error); }
      }), () => reader.abort()));
    } catch (error) { if (error?.code === 'PHOTO_BYTES_INVALID') throw error; cause = error; }
  }
  if (typeof ResponseImpl === 'function') {
    try { return valid(await timed(() => new ResponseImpl(file).arrayBuffer())); }
    catch (error) { if (error?.code === 'PHOTO_BYTES_INVALID') throw error; cause = error; }
  }
  throw failure('PHOTO_BYTES_UNREADABLE', cause);
}

export async function encodePhoto(file) {
  const bytes = await readNativePhotoBytes(file);
  return { format: FORMAT, bytes, byteCount: bytes.byteLength, type: file.type,
    name: typeof file.name === 'string' ? file.name : null,
    lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null };
}

export function decodePhoto(value) {
  if (value instanceof Blob) return value; // Read-only legacy compatibility.
  check(value?.format === FORMAT && value.bytes instanceof ArrayBuffer && Number.isSafeInteger(value.byteCount)
    && value.byteCount > 0 && value.byteCount <= MAX_BYTES && value.bytes.byteLength === value.byteCount
    && typeof value.type === 'string' && (value.name === null || typeof value.name === 'string')
    && (value.lastModified === null || Number.isFinite(value.lastModified)), 'PHOTO_STORAGE_CORRUPT');
  if (value.name !== null && typeof globalThis.File === 'function') return new File([value.bytes], value.name,
    { type: value.type, ...(value.lastModified === null ? {} : { lastModified: value.lastModified }) });
  return new Blob([value.bytes], { type: value.type });
}
