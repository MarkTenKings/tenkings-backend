import { createHash } from 'node:crypto';
import { isVariantProviderImageUrl } from './variant-review.mjs';

export const VARIANT_PROVIDER_MEDIA_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, pixels: 52000000, timeoutMs: 10000, ttlMs: 86400000 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = code => Object.assign(new Error(code), { code });
export async function readBoundedProviderBody(response, signal, maximum) {
  const length = response.headers.get('content-length');
  if (!response.body?.getReader || length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw failure('VARIANT_SOURCE_TOO_LARGE');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      total += part.value.length; if (total > maximum) throw failure('VARIANT_SOURCE_TOO_LARGE'); chunks.push(Buffer.from(part.value)); }
    if (length !== null && !response.headers.get('content-encoding') && total !== Number(length)) throw failure('VARIANT_SOURCE_TRUNCATED');
    return Buffer.concat(chunks, total);
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}
export async function boundedProviderOperation(signal, timeoutMs, work) {
  signal?.throwIfAborted(); const controller = new AbortController(); let timer, rejectAbort;
  const stop = () => controller.abort(signal.reason); signal?.addEventListener('abort', stop, { once: true });
  const timeout = new Promise((_, reject) => { rejectAbort = () => reject(failure('VARIANT_SOURCE_CANCELLED'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    timer = setTimeout(() => controller.abort(), timeoutMs); });
  try { return await Promise.race([work(controller.signal), timeout]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); controller.signal.removeEventListener('abort', rejectAbort); controller.abort(); }
}

/** The host supplies a real decoder (not MIME/header guesses). Bytes are never
 * transformed. The cache contains only public provider images, not user photos. */
export function createVariantProviderImageReader({ cache, inspectImage, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!cache?.get || !cache?.getRetained || !cache?.put || typeof inspectImage !== 'function') throw failure('VARIANT_IMAGE_CONFIGURATION');
  const pending = new Map();
  async function verify(entry, url, decode = true) {
    if (!entry || entry.schemaVersion !== 'variant-provider-image/v1' || entry.url !== url || typeof entry.body !== 'string'
      || entry.body.length > Math.ceil(VARIANT_PROVIDER_MEDIA_LIMITS.bytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.body)
      || Date.parse(entry.expiresAt) - Date.parse(entry.capturedAt) !== VARIANT_PROVIDER_MEDIA_LIMITS.ttlMs) throw failure('VARIANT_IMAGE_CACHE_INVALID');
    const bytes = Buffer.from(entry.body, 'base64');
    if (!bytes.length || bytes.toString('base64') !== entry.body || sha(bytes) !== entry.sha256) throw failure('VARIANT_IMAGE_CACHE_INVALID');
    const actual = decode ? await inspectImage(bytes) : entry;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(actual.mimeType) || actual.mimeType !== entry.mimeType || actual.width !== entry.width || actual.height !== entry.height
      || !Number.isSafeInteger(actual.width) || actual.width < 1 || !Number.isSafeInteger(actual.height) || actual.height < 1
      || actual.width * actual.height > VARIANT_PROVIDER_MEDIA_LIMITS.pixels) throw failure('VARIANT_IMAGE_INVALID');
    return { bytes, sha256: entry.sha256, mimeType: actual.mimeType, width: actual.width, height: actual.height };
  }
  return Object.freeze({
    /** Serving path: retained immutable bytes only. No refresh, network, cache
     * write or image decoder work can be triggered by a browser read. */
    async readRetained(url, { signal, expectedSha256 } = {}) {
      signal?.throwIfAborted();
      if (!isVariantProviderImageUrl(url, 'scrydex') || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) throw failure('VARIANT_IMAGE_URL');
      const entry = await cache.getRetained(`variant-provider-image-evidence:v1:${sha(url)}:${expectedSha256}`);
      const result = await verify(entry, url, false); signal?.throwIfAborted();
      if (result.sha256 !== expectedSha256) throw failure('VARIANT_REFERENCE_CHANGED'); return result;
    },
    async read(url, { signal, expectedSha256 = null } = {}) {
    if (!isVariantProviderImageUrl(url, 'scrydex')) throw failure('VARIANT_IMAGE_URL');
    const key = `variant-provider-image:v1:${sha(url)}`;
    return boundedProviderOperation(signal, VARIANT_PROVIDER_MEDIA_LIMITS.timeoutMs, async active => {
      const saved = await cache.get(key);
      if (saved && Date.parse(saved.expiresAt) > now() && Date.parse(saved.capturedAt) <= now()) {
        const image = await verify(saved, url); if (expectedSha256 && expectedSha256 !== image.sha256) throw failure('VARIANT_REFERENCE_CHANGED'); return image;
      }
      if (!pending.has(key)) pending.set(key, (async () => {
        const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: active, headers: { Accept: 'image/jpeg,image/png,image/webp' } });
        if (!response.ok || response.redirected || response.url && response.url !== url) throw failure('VARIANT_IMAGE_UNAVAILABLE');
        const bytes = await readBoundedProviderBody(response, active, VARIANT_PROVIDER_MEDIA_LIMITS.bytes), metadata = await inspectImage(bytes), captured = now();
        const entry = { schemaVersion: 'variant-provider-image/v1', url, body: bytes.toString('base64'), sha256: sha(bytes), ...metadata,
          capturedAt: new Date(captured).toISOString(), expiresAt: new Date(captured + VARIANT_PROVIDER_MEDIA_LIMITS.ttlMs).toISOString() };
        const result = await verify(entry, url);
        const advertised = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        if (advertised !== result.mimeType) throw failure('VARIANT_IMAGE_INVALID');
        await cache.put(`variant-provider-image-evidence:v1:${sha(url)}:${entry.sha256}`, entry); await cache.put(key, entry); return result;
      })().finally(() => pending.delete(key)));
      const image = await pending.get(key); if (expectedSha256 && expectedSha256 !== image.sha256) throw failure('VARIANT_REFERENCE_CHANGED'); return image;
    });
  } });
}
