/** Inventory display photos are prepared locally; original phone files are never uploaded. */
export const STAFF_INVENTORY_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
export const MAX_STAFF_PHOTO_SOURCE_BYTES = 30 * 1024 * 1024;
export const MAX_STAFF_PHOTO_PIXELS = 50_000_000;
export const MAX_STAFF_PHOTO_UPLOAD_BYTES = 2.5 * 1024 * 1024;
export const STAFF_PHOTO_LONG_EDGE = 1400;
const PREPARATION_TIMEOUT_MS = 60_000;
const INVALID_PHOTO = 'This photo could not be opened. Choose a JPG, PNG, WebP or HEIC/HEIF photo, or take a new photo.';

export type PreparedStaffInventoryPhoto = { image: string; byteSize: number; width: number; height: number };
type PhotoKind = 'jpeg' | 'png' | 'webp' | 'heic';
type DecodedPhoto = { source: CanvasImageSource; width: number; height: number; close: () => void };

/** File bytes, rather than a picker MIME value or filename, select the decoder. */
export function staffInventoryPhotoKind(bytes: Uint8Array): PhotoKind | null {
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && text(0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return 'webp';
  if (bytes.length < 16 || text(4, 4) !== 'ftyp') return null;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size < 16 || size > bytes.length || size % 4 !== 0) return null;
  const brands = [text(8, 4)];
  for (let offset = 16; offset < size; offset += 4) brands.push(text(offset, 4));
  // A valid still can list `hevc` as a compatible brand; it is not by itself a timeline.
  if (brands.some(brand => ['avif', 'avis', 'msf1'].includes(brand))) return null;
  return brands.some(brand => ['heic', 'heix', 'mif1'].includes(brand)) ? 'heic' : null;
}

export function staffInventoryPhotoDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > MAX_STAFF_PHOTO_PIXELS) {
    throw new Error('Choose a photo no larger than 50 megapixels. Standard iPhone 12 MP and 48 MP photos are supported.');
  }
  const scale = Math.min(1, STAFF_PHOTO_LONG_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Photo preparation cancelled.', 'AbortError');
}

function decodeNative(blob: Blob, signal?: AbortSignal): Promise<DecodedPhoto> {
  checkAborted(signal);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    const close = () => { image.src = ''; URL.revokeObjectURL(url); };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); image.onload = null; image.onerror = null; };
    const fail = (error: Error) => { cleanup(); close(); reject(error); };
    const abort = () => fail(new DOMException('Photo preparation cancelled.', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('Preparing this photo took too long. Try the photo again or take a new photo.')), PREPARATION_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    image.onload = () => { cleanup(); resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, close }); };
    image.onerror = () => fail(new Error(INVALID_PHOTO));
    image.src = url;
  });
}

function decodeHeic(blob: Blob, signal?: AbortSignal): Promise<DecodedPhoto> {
  checkAborted(signal);
  return new Promise((resolve, reject) => {
    // Next emits this on-demand worker and its embedded codec from this same site.
    const worker = new Worker(new URL('./inventoryPhotoHeic.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const abort = () => fail(new DOMException('Photo preparation cancelled.', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('Preparing this HEIC photo took too long. Try again or take a new photo.')), PREPARATION_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); fail(new Error(INVALID_PHOTO)); };
    worker.onmessage = event => {
      const { bitmap, error } = event.data ?? {};
      if (!(bitmap instanceof ImageBitmap)) { fail(new Error(typeof error === 'string' ? error : INVALID_PHOTO)); return; }
      cleanup();
      resolve({ source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() });
    };
    worker.postMessage({ blob });
  });
}

function jpegBlob(canvas: HTMLCanvasElement, quality: number, signal?: AbortSignal): Promise<Blob> {
  checkAborted(signal);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (signal?.aborted) { reject(new DOMException('Photo preparation cancelled.', 'AbortError')); return; }
      if (!blob || blob.type !== 'image/jpeg' || !blob.size) { reject(new Error(INVALID_PHOTO)); return; }
      resolve(blob);
    }, 'image/jpeg', quality);
  });
}

function dataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  checkAborted(signal);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => reader.abort();
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = () => { cleanup(); typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(INVALID_PHOTO)); };
    reader.onerror = () => { cleanup(); reject(new Error(INVALID_PHOTO)); };
    reader.onabort = () => { cleanup(); reject(new DOMException('Photo preparation cancelled.', 'AbortError')); };
    reader.readAsDataURL(blob);
  });
}

export async function prepareStaffInventoryPhoto(file: File, options: { signal?: AbortSignal } = {}): Promise<PreparedStaffInventoryPhoto> {
  const { signal } = options;
  checkAborted(signal);
  if (!file.size || file.size > MAX_STAFF_PHOTO_SOURCE_BYTES) throw new Error('Choose a photo under 30 MB, or take a new photo.');
  const kind = staffInventoryPhotoKind(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
  checkAborted(signal);
  if (!kind) throw new Error(INVALID_PHOTO);
  const blob = file.slice(0, file.size, `image/${kind === 'heic' ? 'heic' : kind}`);
  let decoded: DecodedPhoto;
  try { decoded = await decodeNative(blob, signal); }
  catch (error) {
    checkAborted(signal);
    if (kind !== 'heic') throw error;
    decoded = await decodeHeic(blob, signal);
  }
  const canvas = document.createElement('canvas');
  try {
    checkAborted(signal);
    const dimensions = staffInventoryPhotoDimensions(decoded.width, decoded.height);
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(INVALID_PHOTO);
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    let prepared: Blob | null = null;
    for (const quality of [0.9, 0.8, 0.68]) {
      prepared = await jpegBlob(canvas, quality, signal);
      if (prepared.size <= MAX_STAFF_PHOTO_UPLOAD_BYTES) break;
    }
    if (!prepared || prepared.size > MAX_STAFF_PHOTO_UPLOAD_BYTES) throw new Error('This photo is too detailed to upload. Choose a smaller photo or take a new photo.');
    const image = await dataUrl(prepared, signal);
    checkAborted(signal);
    return { image, byteSize: prepared.size, ...dimensions };
  } finally { decoded.close(); canvas.width = 1; canvas.height = 1; }
}
