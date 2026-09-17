import { useEffect, useRef, useState } from 'react';

export const MAX_VERIFIED_IMAGE_BYTES = 256 * 1024 * 1024;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (condition, code = 'VERIFIED_IMAGE_INVALID') => { if (!condition) fail(code); };
const empty = { contentKey: null, url: null, loading: false, error: null };

/** Transport URLs carry authorization, never pixel/editor lineage. */
export function verifiedImageContentKey(descriptor) {
  return descriptor && /^[a-f0-9]{64}$/.test(descriptor.sha256)
    && (descriptor.byteCount === undefined || Number.isSafeInteger(descriptor.byteCount)
      && descriptor.byteCount > 0 && descriptor.byteCount <= MAX_VERIFIED_IMAGE_BYTES)
    ? JSON.stringify([descriptor.sha256, descriptor.byteCount ?? null]) : null;
}
function imageMime(bytes) {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && [82,73,70,70].every((value,index) => bytes[index] === value)
    && [87,69,66,80].every((value,index) => bytes[index+8] === value)) return 'image/webp';
  fail('VERIFIED_IMAGE_FORMAT');
}

/** Fetch bounded exact bytes; only a verified owned Blob can reach an img.
 * No decode, canvas draw, resizing or image re-encoding happens here. */
export async function loadVerifiedImage(descriptor, { signal, fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto, urlImpl = globalThis.URL, origin = globalThis.location?.origin,
  maxBytes = MAX_VERIFIED_IMAGE_BYTES, timeoutMs = 90000 } = {}) {
  const contentKey = verifiedImageContentKey(descriptor);
  check(contentKey && typeof descriptor.url === 'string' && descriptor.url.length > 0);
  const expected = { sha256: descriptor.sha256, byteCount: descriptor.byteCount };
  check(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_VERIFIED_IMAGE_BYTES
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2_147_483_647);
  check(expected.byteCount === undefined || expected.byteCount <= maxBytes, 'VERIFIED_IMAGE_TOO_LARGE');
  let target, page;
  try { page = new URL(origin); target = new URL(descriptor.url, page); } catch { fail('VERIFIED_IMAGE_ORIGIN'); }
  const sameOrigin = target.origin === page.origin;
  check(!target.username && !target.password && !target.hash && ['http:','https:'].includes(page.protocol)
    && ['http:','https:'].includes(target.protocol)
    && (sameOrigin || target.protocol === 'https:'), 'VERIFIED_IMAGE_ORIGIN');
  const controller = new AbortController();
  const cancelled = () => controller.abort(Object.assign(new Error('VERIFIED_IMAGE_CANCELLED'), { code: 'VERIFIED_IMAGE_CANCELLED' }));
  signal?.addEventListener('abort', cancelled, { once: true });
  let rejectAbort;
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  // Always attach a rejection handler even if cancellation precedes fetch.
  aborted.catch(() => {});
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('VERIFIED_IMAGE_TIMEOUT'), { code: 'VERIFIED_IMAGE_TIMEOUT' })), timeoutMs);
  if (signal?.aborted) cancelled();
  const wait = operation => Promise.race([Promise.resolve().then(() => {
    if (controller.signal.aborted) throw controller.signal.reason;
    return operation();
  }), aborted]);
  let reader;
  try {
    const response = await wait(() => Promise.resolve(fetchImpl(target.href, { method: 'GET', mode: 'cors',
      credentials: sameOrigin ? 'same-origin' : 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      cache: 'no-store', signal: controller.signal })).then(value => {
      if (controller.signal.aborted) { try { Promise.resolve(value?.body?.cancel()).catch(() => {}); } catch {} }
      return value;
    }));
    check(response?.ok && !response.redirected && response.body?.getReader, 'VERIFIED_IMAGE_UNAVAILABLE');
    reader = response.body.getReader();
    const lengthHeader = response.headers?.get('content-length');
    if (lengthHeader !== null && lengthHeader !== undefined) {
      check(/^[0-9]+$/.test(lengthHeader), 'VERIFIED_IMAGE_LENGTH');
      const length = Number(lengthHeader);
      check(Number.isSafeInteger(length) && length > 0 && length <= maxBytes, 'VERIFIED_IMAGE_TOO_LARGE');
      check(expected.byteCount === undefined || length === expected.byteCount, 'VERIFIED_IMAGE_LENGTH');
    }
    const chunks = []; let length = 0;
    while (true) {
      const next = await wait(() => reader.read());
      if (next.done) break;
      check(next.value instanceof Uint8Array, 'VERIFIED_IMAGE_INVALID');
      length += next.value.byteLength;
      check(length <= maxBytes, 'VERIFIED_IMAGE_TOO_LARGE');
      check(expected.byteCount === undefined || length <= expected.byteCount, 'VERIFIED_IMAGE_LENGTH');
      chunks.push(Uint8Array.from(next.value));
    }
    check(length > 0 && (expected.byteCount === undefined || length === expected.byteCount), 'VERIFIED_IMAGE_LENGTH');
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const digest = await wait(() => cryptoImpl.subtle.digest('SHA-256', bytes));
    const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    check(sha256 === expected.sha256, 'VERIFIED_IMAGE_HASH');
    if (controller.signal.aborted) throw controller.signal.reason;
    const blob = new Blob([bytes], { type: imageMime(bytes) }), url = urlImpl.createObjectURL(blob);
    let released = false;
    return { contentKey, url, sha256, byteCount: length,
      dispose() { if (!released) { released = true; urlImpl.revokeObjectURL(url); } } };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancelled);
    controller.signal.removeEventListener('abort', onAbort);
    // Do not let a stalled reader's cancellation extend this bounded load.
    try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch {}
  }
}

/** One component owns one verified Blob. URL renewal reuses the same proved
 * pixels; changed bytes revoke it. Superseded asynchronous loads cannot publish. */
export function createVerifiedImageResource({ load = loadVerifiedImage } = {}) {
  let generation = 0, pending = null, asset = null;
  const cancelPending = () => { generation++; pending?.abort(); pending = null; };
  const dispose = () => { cancelPending(); asset?.dispose(); asset = null; };
  return { cancelPending, dispose,
    async update(descriptor, publish) {
      const contentKey = verifiedImageContentKey(descriptor);
      if (asset && asset.contentKey === contentKey) {
        publish({ contentKey, url: asset.url, loading: false, error: null }); return;
      }
      dispose();
      if (!descriptor) { publish(empty); return; }
      const current = generation, controller = new AbortController(); pending = controller;
      publish({ contentKey, url: null, loading: true, error: null });
      try {
        const found = await load(descriptor, { signal: controller.signal });
        if (current !== generation || controller.signal.aborted) { found.dispose(); return; }
        pending = null; asset = found;
        publish({ contentKey, url: found.url, loading: false, error: null });
      } catch (error) {
        if (current === generation && !controller.signal.aborted) {
          pending = null; publish({ contentKey, url: null, loading: false, error });
        }
      }
    },
  };
}

export function useVerifiedImage(descriptor) {
  const resource = useRef(null), [value, setValue] = useState(empty);
  if (!resource.current) resource.current = createVerifiedImageResource();
  const contentKey = verifiedImageContentKey(descriptor), url = descriptor?.url;
  useEffect(() => {
    let live = true;
    void resource.current.update(descriptor, state => { if (live) setValue(state); });
    return () => { live = false; resource.current.cancelPending(); };
  }, [contentKey, url]);
  useEffect(() => () => resource.current.dispose(), []);
  return value.contentKey === contentKey ? value : { ...empty, contentKey, loading: Boolean(descriptor) };
}
