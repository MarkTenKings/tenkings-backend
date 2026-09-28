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
  maxBytes = MAX_VERIFIED_IMAGE_BYTES, timeoutMs = 90000, onProgress = () => {} } = {}) {
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
  let reader, lastProgressAt = -Infinity;
  const progress = (loadedBytes, totalBytes, phase = 'DOWNLOADING') => {
    const now = Date.now();
    if (loadedBytes === 0 || phase === 'VERIFYING' || now - lastProgressAt >= 100) {
      lastProgressAt = now; onProgress({ loadedBytes, totalBytes: totalBytes ?? null, phase });
    }
  };
  try {
    progress(0, expected.byteCount);
    const response = await wait(() => Promise.resolve(fetchImpl(target.href, { method: 'GET', mode: 'cors',
      credentials: sameOrigin ? 'same-origin' : 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      cache: 'no-store', signal: controller.signal })).then(value => {
      if (controller.signal.aborted) { try { Promise.resolve(value?.body?.cancel()).catch(() => {}); } catch {} }
      return value;
    }));
    check(response?.ok && !response.redirected && response.body?.getReader, 'VERIFIED_IMAGE_UNAVAILABLE');
    reader = response.body.getReader();
    const lengthHeader = response.headers?.get('content-length');
    let declaredLength;
    if (lengthHeader !== null && lengthHeader !== undefined) {
      check(/^[0-9]+$/.test(lengthHeader), 'VERIFIED_IMAGE_LENGTH');
      const length = Number(lengthHeader);
      check(Number.isSafeInteger(length) && length > 0 && length <= maxBytes, 'VERIFIED_IMAGE_TOO_LARGE');
      check(expected.byteCount === undefined || length === expected.byteCount, 'VERIFIED_IMAGE_LENGTH');
      declaredLength = length;
    }
    const expectedLength = expected.byteCount ?? declaredLength;
    // Saved descriptors provide an exact bounded length. Write incoming bytes
    // directly into one buffer instead of retaining a second full set of chunks.
    const received = expectedLength === undefined ? null : new Uint8Array(expectedLength);
    const chunks = []; let length = 0;
    while (true) {
      const next = await wait(() => reader.read());
      if (next.done) break;
      check(next.value instanceof Uint8Array, 'VERIFIED_IMAGE_INVALID');
      length += next.value.byteLength;
      check(length <= maxBytes, 'VERIFIED_IMAGE_TOO_LARGE');
      check(expected.byteCount === undefined || length <= expected.byteCount, 'VERIFIED_IMAGE_LENGTH');
      check(expectedLength === undefined || length <= expectedLength, 'VERIFIED_IMAGE_LENGTH');
      if (received) received.set(next.value, length - next.value.byteLength);
      else chunks.push(Uint8Array.from(next.value));
      progress(length, expectedLength);
    }
    check(length > 0 && (expectedLength === undefined || length === expectedLength), 'VERIFIED_IMAGE_LENGTH');
    const bytes = received ?? new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    chunks.length = 0;
    progress(length, length, 'VERIFYING');
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

// Keep only the two recent views of this mounted image (original/straightened),
// within a bounded memory budget. No shared or persistent image cache is used.
export const MAX_RETAINED_VERIFIED_IMAGE_BYTES = 64 * 1024 * 1024;

/** One component owns its verified Blobs. Renewing a transport URL must not
 * restart a slow transfer of the same bytes. Superseded loads cannot publish. */
export function createVerifiedImageResource({ load = loadVerifiedImage, retainedViews = 1 } = {}) {
  check(retainedViews === 1 || retainedViews === 2);
  let pending = null;
  const assets = new Map();
  const cancelPending = () => { const previous = pending; pending = null; previous?.controller.abort(); };
  const dispose = () => { cancelPending(); for (const asset of assets.values()) asset.dispose(); assets.clear(); };
  const retain = (asset, descriptor) => {
    assets.set(asset.contentKey, asset);
    const sizeOf = stored => stored.byteCount
      ?? (stored.contentKey === asset.contentKey ? descriptor.byteCount : undefined)
      ?? MAX_VERIFIED_IMAGE_BYTES;
    // Legacy loader adapters may omit byteCount; don't retain unknown sizes.
    let retainedBytes = [...assets.values()].reduce((sum, stored) => sum + sizeOf(stored), 0);
    while (assets.size > 1 && (assets.size > retainedViews || retainedBytes > MAX_RETAINED_VERIFIED_IMAGE_BYTES)) {
      const [key, oldest] = assets.entries().next().value;
      oldest.dispose(); assets.delete(key); retainedBytes -= sizeOf(oldest);
    }
  };
  return { cancelPending, dispose,
    update(descriptor, publish) {
      const contentKey = verifiedImageContentKey(descriptor);
      const asset = assets.get(contentKey);
      if (asset) {
        cancelPending();
        // Touch the verified view so the least recently used view is evicted.
        assets.delete(contentKey); assets.set(contentKey, asset);
        publish({ contentKey, url: asset.url, loading: false, error: null }); return Promise.resolve();
      }
      if (pending && contentKey && pending.contentKey === contentKey) {
        // Renewed authorization describes the same pixels. Keep the transfer
        // and its deadline, publishing only to the most recent subscriber.
        pending.descriptor = { ...descriptor }; pending.publish = publish;
        publish({ contentKey, url: null, loading: true, error: null, progress: pending.progress }); return pending.promise;
      }
      cancelPending();
      if (!descriptor) { dispose(); publish(empty); return Promise.resolve(); }
      const current = { contentKey, controller: new AbortController(), descriptor: { ...descriptor }, publish };
      pending = current;
      publish({ contentKey, url: null, loading: true, error: null });
      const onProgress = progress => {
        if (pending !== current || current.controller.signal.aborted) return;
        current.progress = progress;
        current.publish({ contentKey, url: null, loading: true, error: null, progress });
      };
      current.promise = (async () => {
        try {
          let requested = current.descriptor, found;
          try { found = await load(requested, { signal: current.controller.signal, onProgress }); }
          catch (error) {
            // An expired grant can be retried once if a refreshed grant arrived
            // during the transfer. Hash/length/format/timeouts are never bypassed.
            if (pending !== current || current.controller.signal.aborted
              || error?.code !== 'VERIFIED_IMAGE_UNAVAILABLE' || requested.url === current.descriptor.url) throw error;
            found = await load(current.descriptor, { signal: current.controller.signal, onProgress });
          }
          if (pending !== current || current.controller.signal.aborted) { found.dispose(); return; }
          pending = null; retain(found, current.descriptor);
          current.publish({ contentKey, url: found.url, loading: false, error: null });
        } catch (error) {
          if (pending === current && !current.controller.signal.aborted) {
            pending = null; current.publish({ contentKey, url: null, loading: false, error });
          }
        }
      })();
      return current.promise;
    },
  };
}

export function useVerifiedImage(descriptor, { cacheScope = null } = {}) {
  const resource = useRef(null), [value, setValue] = useState(empty), [retryVersion, setRetryVersion] = useState(0);
  if (!resource.current) resource.current = createVerifiedImageResource({ retainedViews: cacheScope ? 2 : 1 });
  const contentKey = verifiedImageContentKey(descriptor), url = descriptor?.url;
  useEffect(() => () => resource.current.dispose(), [cacheScope]);
  useEffect(() => {
    void resource.current.update(descriptor, setValue);
    // The resource cancels on content replacement/unmount. Effect cleanup on
    // URL renewal would abort the very transfer update() is meant to retain.
  }, [contentKey, url, cacheScope, retryVersion]);
  const visible = value.contentKey === contentKey ? value : { ...empty, contentKey, loading: Boolean(descriptor) };
  return { ...visible, retry: () => setRetryVersion(version => version + 1) };
}
