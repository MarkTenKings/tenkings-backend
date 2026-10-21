import { parseOwnerCollectionPage } from './collection-contract.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const failure = (code, status) => Object.assign(new Error(code), { code, ...(status ? { status } : {}) });
export function collectionPagePath({ afterCardId = null, limit = 25 } = {}) {
  if (!(afterCardId === null || typeof afterCardId === 'string' && UUID.test(afterCardId))
    || !Number.isInteger(limit) || limit < 1 || limit > 50) throw failure('COLLECTION_REQUEST_INVALID');
  return `/account/api/customer/collection?limit=${limit}${afterCardId === null ? '' : `&afterCardId=${afterCardId}`}`;
}

/** Bounded, cancellable GET only; no browser storage, auth bootstrap or retry. */
export async function readCollectionPage({ accountId, afterCardId = null, limit = 25, signal } = {}, fetcher = globalThis.fetch) {
  if (typeof accountId !== 'string' || !UUID.test(accountId)) throw failure('COLLECTION_ACCOUNT_MISMATCH');
  const path = collectionPagePath({ afterCardId, limit }), controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) throw failure('COLLECTION_CANCELLED');
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 25000);
  try {
    const response = await fetcher(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    if (controller.signal.aborted) throw failure('COLLECTION_CANCELLED');
    if (response.status === 401 || response.status === 403) throw failure('COLLECTION_ACCESS_ENDED', response.status);
    if (!response.ok) throw failure('COLLECTION_UNAVAILABLE', response.status);
    if (!response.body || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')
      || !/\bprivate\b/i.test(response.headers.get('cache-control') ?? '')
      || !/\bno-store\b/i.test(response.headers.get('cache-control') ?? '')) throw failure('COLLECTION_UNAVAILABLE');
    const reader = response.body.getReader(), parts = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw failure('COLLECTION_CANCELLED');
        if (done) break;
        length += value.byteLength;
        if (length > 262144) throw failure('COLLECTION_UNAVAILABLE');
        parts.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return parseOwnerCollectionPage(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), accountId, { afterCardId, limit });
  } catch (error) {
    if (controller.signal.aborted) throw failure(signal?.aborted ? 'COLLECTION_CANCELLED' : 'COLLECTION_UNAVAILABLE');
    if (['COLLECTION_ACCESS_ENDED', 'COLLECTION_UNAVAILABLE'].includes(error.code)) throw error;
    throw failure('COLLECTION_UNAVAILABLE');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
