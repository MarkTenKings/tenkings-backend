// Browser-safe, read-only entry resolution. No default transport or acquisition.
import { curationStaff, curationSame, curationError } from './staff-comp-curation-client.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const check = (value, code = 'COMP_ENTRY_INVALID') => { if (!value) throw curationError(code); };
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
export function compCurationCard(card) {
  check(card && UUID.test(card.cardId ?? '') && UUID.test(card.approvalActionId ?? '') && card.report?.state === 'PUBLISHED'
    && /^ar_[A-Za-z0-9_-]{24}$/.test(card.report.publicToken ?? '') && positive(card.report.version) && HASH.test(card.report.publicHash ?? ''));
  for (const value of [card.sourceHash, card.report.reportHash]) check(value == null || HASH.test(value));
  check(card.sourceRevision == null || positive(card.sourceRevision));
  check(card.mode == null || typeof card.mode === 'string' && card.mode.length > 0 && card.mode.length <= 80);
  return { cardId: card.cardId, approvalActionId: card.approvalActionId, sourceRevision: card.sourceRevision ?? null,
    sourceHash: card.sourceHash ?? null, reportHash: card.report.reportHash ?? null, mode: card.mode ?? null,
    publicToken: card.report.publicToken, publicVersion: card.report.version, publicHash: card.report.publicHash };
}
export function assertCompCurationBinding(value, card, mode) {
  const b = value?.binding;
  check(b && ['cardId', 'approvalActionId', 'publicToken', 'publicVersion', 'publicHash'].every(key => b[key] === card[key])
    && b.mode === mode && (card.mode === null || card.mode === mode), 'COMP_ENTRY_CHANGED');
  for (const key of ['sourceRevision', 'sourceHash', 'reportHash']) check(card[key] === null || b[key] === card[key], 'COMP_ENTRY_CHANGED');
  return value;
}
export function parseSavedCompEntry(value, card) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  if (value.state === 'NOT_REQUESTED') {
    check(value.previewId == null && value.approvalActionId == null && value.preview == null);
    return { status: 'NO_SAVED_POOL', input: { approvalActionId: card.approvalActionId, previewId: null } };
  }
  check(value.approvalActionId === card.approvalActionId && UUID.test(value.previewId ?? ''), 'COMP_ENTRY_CHANGED');
  if (value.state !== 'READY') {
    check(['PENDING', 'SEARCHING', 'QUEUED', 'FAILED', 'UNKNOWN', 'UNAVAILABLE'].includes(value.state));
    return { status: 'POOL_NOT_READY', input: null };
  }
  const p = value.preview;
  check(['atlas-market-preview-v1', 'atlas-market-preview-v2'].includes(p?.version)
    && curationSame(p.binding, { publicToken: card.publicToken, approvalVersion: card.publicVersion, publicHash: card.publicHash })
    && Array.isArray(p.candidates) && p.candidates.length <= 1000, 'COMP_ENTRY_CHANGED');
  // Raw status prices, titles, URLs and acquisition state never enter the UI.
  // The curation service re-reads this exact saved pool and returns its own
  // approval/source/policy-bound, account-bound validated display projection.
  return { status: 'READY', input: { approvalActionId: card.approvalActionId, previewId: value.previewId } };
}

const discard = response => { try { void response?.body?.cancel().catch(() => {}); } catch {} };
function interrupted(work, signal, late) {
  return new Promise((resolve, reject) => {
    let ended = false;
    const abort = () => { signal.removeEventListener('abort', abort); if (!ended) { ended = true; reject(curationError('COMP_CANCELLED')); } };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    Promise.resolve(work).then(value => { signal.removeEventListener('abort', abort); if (ended) { late?.(value); return; } ended = true; resolve(value); },
      error => { signal.removeEventListener('abort', abort); if (!ended) { ended = true; reject(error); } });
  });
}
/** request must be the explicitly composed authenticated same-origin adapter.
 * It returns a Response and owns real cookies/CSRF. No global fetch fallback. */
export function createSavedCompEntryReader({ request } = {}) {
  return async function read({ staff, card: raw, signal } = {}) {
    check(typeof request === 'function', 'COMP_NOT_CONFIGURED');
    const actor = curationStaff(staff), card = compCurationCard(raw);
    check(card.mode === null || card.mode === actor.mode, 'COMP_ENTRY_CHANGED');
    const controller = new AbortController(), abort = () => controller.abort();
    if (signal?.aborted) throw curationError('COMP_CANCELLED');
    signal?.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, 25000);
    async function get(path) {
      let response, reader;
      const cancel = () => { try { void reader?.cancel().catch(() => {}); } catch {} };
      try {
        response = await interrupted(Promise.resolve().then(() => {
          if (controller.signal.aborted) throw curationError('COMP_CANCELLED');
          return request({ method: 'GET', path, signal: controller.signal });
        }), controller.signal, discard);
        if ([401, 403].includes(response?.status)) throw curationError('COMP_ACCESS_ENDED');
        check(response?.ok && response.body && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')
          && /\bprivate\b/i.test(response.headers.get('cache-control') ?? '') && /\bno-store\b/i.test(response.headers.get('cache-control') ?? ''));
        const length = response.headers.get('content-length');
        check(length === null || /^\d+$/.test(length) && Number(length) <= 2097152);
        reader = response.body.getReader(); controller.signal.addEventListener('abort', cancel, { once: true });
        const chunks = []; let size = 0;
        while (true) {
          const { done, value } = await interrupted(reader.read(), controller.signal); if (done) break;
          size += value.byteLength; check(size <= 2097152); chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } finally { controller.signal.removeEventListener('abort', cancel); cancel(); try { reader?.releaseLock(); } catch {} discard(response); }
    }
    try {
      const before = await get('/api/staff/session'); check(curationSame(curationStaff(before.staff), actor), 'COMP_ACCESS_ENDED');
      const status = await get(`/api/staff/manual-connected/cards/${card.cardId}/presentation/market`);
      const after = await get('/api/staff/session'); check(curationSame(curationStaff(after.staff), actor), 'COMP_ACCESS_ENDED');
      if (controller.signal.aborted) throw curationError('COMP_CANCELLED');
      return parseSavedCompEntry(status, card);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
  };
}
