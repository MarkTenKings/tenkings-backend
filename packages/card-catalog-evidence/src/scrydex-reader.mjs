import { createHash, randomUUID } from 'node:crypto';
import { readBoundedProviderBody, boundedProviderOperation } from './provider-media.mjs';

export const SCRYDEX_METADATA_LIMITS = Object.freeze({ bytes: 1024 * 1024, timeoutMs: 10000, ttlMs: 86400000, requestsPerPrepare: 1 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = code => Object.assign(new Error(code), { code });
export function isScrydexMetadataUrl(value) {
  try { const u = new URL(value); return u.origin === 'https://api.scrydex.com' && !u.username && !u.password && !u.hash
    && u.pathname === '/pokemon/v1/cards' && value.length <= 2048 && [...u.searchParams.keys()].every(k => ['q', 'page', 'page_size', 'select', 'casing'].includes(k))
    && u.searchParams.get('page') === '1' && u.searchParams.get('page_size') === '7' && u.searchParams.get('casing') === 'snake'
    && u.searchParams.get('select') === 'id,name,number,printed_number,expansion,language_code,variants,images'; } catch { return false; }
}
/** Explicitly opt-in. One idempotent metadata GET per prepare, no SDK retries.
 * A durable request-intent row is written before each actual network attempt.
 * No card photos, physical IDs, private notes, prices or credentials are cached. */
export function createScrydexMetadataReader({ apiKey, teamId, cache, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (![apiKey, teamId].every(v => typeof v === 'string' && v.length >= 4 && v.length <= 512 && !/[\s\x00-\x1f\x7f]/.test(v)) || !cache?.get || !cache?.getRetained || !cache?.put) throw failure('SCRYDEX_NOT_CONFIGURED');
  const pending = new Map();
  const keyFor = url => `variant-scrydex-source:v1:${sha(url)}`;
  function validate(entry, url) {
    if (!entry || entry.schemaVersion !== 'scrydex-source/v1' || entry.url !== url || entry.key !== keyFor(url)
      || typeof entry.body !== 'string' || Buffer.byteLength(entry.body) > SCRYDEX_METADATA_LIMITS.bytes || sha(entry.body) !== entry.sha256
      || !Number.isFinite(Date.parse(entry.capturedAt)) || Date.parse(entry.expiresAt) - Date.parse(entry.capturedAt) !== SCRYDEX_METADATA_LIMITS.ttlMs) throw failure('VARIANT_SOURCE_CACHE_INVALID');
    let data; try { data = JSON.parse(entry.body); } catch { throw failure('VARIANT_SOURCE_CACHE_INVALID'); }
    return { data, source: { url, sha256: entry.sha256, capturedAt: entry.capturedAt } };
  }
  return Object.freeze({
    async retained(url, expectedSha256) {
      if (!isScrydexMetadataUrl(url)) throw failure('VARIANT_SOURCE_URL');
      const entry = await cache.getRetained(`variant-scrydex-evidence:v1:${sha(url)}:${expectedSha256}`);
      if (!entry || entry.sha256 !== expectedSha256) throw failure('VARIANT_REFERENCE_SOURCE_UNAVAILABLE');
      return validate(entry, url);
    },
    async json(url, { signal, budget } = {}) {
      if (!isScrydexMetadataUrl(url)) throw failure('VARIANT_SOURCE_URL');
      if (!budget || !Number.isInteger(budget.remaining) || budget.remaining < 1) throw failure('VARIANT_SOURCE_BUDGET'); budget.remaining--;
      return boundedProviderOperation(signal, SCRYDEX_METADATA_LIMITS.timeoutMs, async active => {
        const key = keyFor(url), saved = await cache.get(key);
        if (saved && Date.parse(saved.capturedAt) <= now() && Date.parse(saved.expiresAt) > now()) return validate(saved, url);
        if (!pending.has(key)) pending.set(key, (async () => {
          const time = now(), requestId = randomUUID();
          await cache.put(`variant-scrydex-request:v1:${requestId}`, { schemaVersion: 'scrydex-request/v1', requestId, requestKey: key,
            url, requests: 1, state: 'DISPATCH_INTENT', capturedAt: new Date(time).toISOString(), expiresAt: new Date(time + 30 * 86400000).toISOString() });
          const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: active,
            headers: { Accept: 'application/json', 'X-Api-Key': apiKey, 'X-Team-ID': teamId } });
          if (!response.ok || response.redirected || response.url && response.url !== url || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw failure('VARIANT_SOURCE_UNAVAILABLE');
          const bytes = await readBoundedProviderBody(response, active, SCRYDEX_METADATA_LIMITS.bytes), body = bytes.toString('utf8');
          if (!Buffer.from(body).equals(bytes) || body.includes(apiKey) || body.includes(teamId)) throw failure('VARIANT_SOURCE_INVALID');
          const captured = now(), entry = { schemaVersion: 'scrydex-source/v1', key, url, body, sha256: sha(bytes),
            capturedAt: new Date(captured).toISOString(), expiresAt: new Date(captured + SCRYDEX_METADATA_LIMITS.ttlMs).toISOString() };
          const result = validate(entry, url);
          // The immutable body remains addressable after the URL pointer moves.
          await cache.put(`variant-scrydex-evidence:v1:${sha(url)}:${entry.sha256}`, entry); await cache.put(key, entry); return result;
        })().finally(() => pending.delete(key)));
        return pending.get(key);
      });
    },
  });
}
