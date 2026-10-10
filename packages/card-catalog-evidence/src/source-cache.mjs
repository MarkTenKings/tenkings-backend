import { createHash } from 'node:crypto';
import { canonicalJson, CatalogContractError } from './index.mjs';
import { VARIANT_CATALOG_REVISION } from './variant-review.mjs';

export const VARIANT_SOURCE_CACHE_VERSION = 'variant-source-cache/v1';
export const VARIANT_SOURCE_LIMITS = Object.freeze({ responseBytes: 1024 * 1024, timeoutMs: 10000, ttlMs: 24 * 60 * 60 * 1000, memoryEntries: 128 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = code => Object.assign(new Error(code), { code });
function allowed(value) {
  try { const u = new URL(value); return u.origin === 'https://api.tcgdex.net' && !u.username && !u.password && !u.hash
    && /^\/v2\/[a-z]{2}(?:-[a-z]{2,8})?\/(?:cards|sets)(?:\/[A-Za-z0-9._-]+)?$/.test(u.pathname)
    && value.length <= 2048; } catch { return false; }
}
export function variantSourceCacheKey(url) {
  if (!allowed(url)) throw new CatalogContractError('INVALID_VARIANT_SOURCE_URL', 'url');
  return `variant-source:v1:${sha(canonicalJson({ revision: VARIANT_CATALOG_REVISION, url }))}`;
}
export function validateVariantSourceCacheEntry(entry, url) {
  if (!entry || Object.keys(entry).sort().join('|') !== ['schemaVersion', 'key', 'url', 'body', 'sha256', 'capturedAt', 'expiresAt'].sort().join('|')
    || entry.schemaVersion !== VARIANT_SOURCE_CACHE_VERSION || entry.key !== variantSourceCacheKey(url) || entry.url !== url
    || typeof entry.body !== 'string' || Buffer.byteLength(entry.body) > VARIANT_SOURCE_LIMITS.responseBytes
    || entry.sha256 !== sha(Buffer.from(entry.body)) || !Number.isFinite(Date.parse(entry.capturedAt)) || !Number.isFinite(Date.parse(entry.expiresAt))
    || Date.parse(entry.expiresAt) - Date.parse(entry.capturedAt) !== VARIANT_SOURCE_LIMITS.ttlMs)
    throw failure('VARIANT_SOURCE_CACHE_INVALID');
  return structuredClone(entry);
}
function waitFor(promise, signal) {
  signal?.throwIfAborted();
  if (!signal) return promise;
  let abort;
  const stopped = new Promise((_, reject) => { abort = () => reject(signal.reason ?? failure('VARIANT_SOURCE_CANCELLED')); signal.addEventListener('abort', abort, { once: true }); });
  return Promise.race([promise, stopped]).finally(() => signal.removeEventListener('abort', abort));
}

/** Public metadata GETs only. A host cache may retain immutable response bodies
 * by sha256 and atomically advance a URL-key pointer. No authorization, physical
 * IDs or photographs are accepted. Catalog authority is never cached here. */
export function createVariantSourceReader({ cache = null, fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = VARIANT_SOURCE_LIMITS.timeoutMs } = {}) {
  if (typeof fetchImpl !== 'function' || cache !== null && (typeof cache.get !== 'function' || typeof cache.put !== 'function')
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > VARIANT_SOURCE_LIMITS.timeoutMs) throw failure('VARIANT_SOURCE_CONFIGURATION');
  const memory = new Map(), inFlight = new Map();
  async function load(url) {
    const key = variantSourceCacheKey(url), saved = cache ? await cache.get(key) : memory.get(key);
    if (saved) {
      const entry = validateVariantSourceCacheEntry(saved, url);
      if (Date.parse(entry.capturedAt) <= now() && Date.parse(entry.expiresAt) > now()) return entry;
    }
    const controller = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('VARIANT_SOURCE_TIMEOUT')); }, timeoutMs); });
    try {
      const read = async () => {
        const response = await fetchImpl(url, { method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { Accept: 'application/json' } });
        if (!response.ok || response.redirected || response.url && response.url !== url
          || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw failure('VARIANT_SOURCE_UNAVAILABLE');
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > VARIANT_SOURCE_LIMITS.responseBytes)) throw failure('VARIANT_SOURCE_TOO_LARGE');
        const reader = response.body?.getReader();
        if (!reader) throw failure('VARIANT_SOURCE_INVALID');
        const chunks = []; let total = 0;
        const cancel = () => { void reader.cancel().catch(() => {}); }; controller.signal.addEventListener('abort', cancel, { once: true });
        try {
          while (true) {
            controller.signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
            total += part.value.length; if (total > VARIANT_SOURCE_LIMITS.responseBytes) throw failure('VARIANT_SOURCE_TOO_LARGE');
            chunks.push(Buffer.from(part.value));
          }
        } finally { controller.signal.removeEventListener('abort', cancel); cancel(); }
        if (length !== null && !response.headers.get('content-encoding') && total !== Number(length)) throw failure('VARIANT_SOURCE_TRUNCATED');
        const bytes = Buffer.concat(chunks, total), body = bytes.toString('utf8');
        if (!Buffer.from(body).equals(bytes)) throw failure('VARIANT_SOURCE_ENCODING');
        try { JSON.parse(body); } catch { throw failure('VARIANT_SOURCE_INVALID'); }
        const captured = now();
        const entry = { schemaVersion: VARIANT_SOURCE_CACHE_VERSION, key, url, body, sha256: sha(bytes),
          capturedAt: new Date(captured).toISOString(), expiresAt: new Date(captured + VARIANT_SOURCE_LIMITS.ttlMs).toISOString() };
        if (cache) await cache.put(key, structuredClone(entry));
        else { memory.set(key, entry); while (memory.size > VARIANT_SOURCE_LIMITS.memoryEntries) memory.delete(memory.keys().next().value); }
        return entry;
      };
      return await Promise.race([read(), expired]);
    } finally { clearTimeout(timer); controller.abort(); }
  }
  return Object.freeze({
    async json(url, { signal, budget } = {}) {
      const key = variantSourceCacheKey(url);
      signal?.throwIfAborted();
      if (budget) { if (!Number.isSafeInteger(budget.remaining) || budget.remaining < 1) throw failure('VARIANT_SOURCE_BUDGET'); budget.remaining--; }
      if (!inFlight.has(key)) inFlight.set(key, load(url).finally(() => inFlight.delete(key)));
      const entry = await waitFor(inFlight.get(key), signal);
      return { data: JSON.parse(entry.body), source: { url: entry.url, sha256: entry.sha256, capturedAt: entry.capturedAt } };
    },
  });
}
