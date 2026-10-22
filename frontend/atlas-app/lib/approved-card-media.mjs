import { parseInspectionAccess } from '@atlas/service-bridge/inspection-access';
import { loadVerifiedImage } from '../../../packages/atlas-manual-workspace/src/verified-image.mjs';

export const APPROVED_MEDIA_ACCESS_ENDED = 'atlas:verified-image-access-ended';
export const APPROVED_LABEL_LAYOUT = Object.freeze({ version: 'atlas-approved-b-v1', width: 68.342, height: 20.082,
  nfc: Object.freeze({ x: 51.8, y: 9.75, radius: 5.1 }) });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const failure = code => Object.assign(new Error(code), { code });
const check = (value, code = 'APPROVED_MEDIA_INVALID') => { if (!value) throw failure(code); };

/** Paths and grants are bound to this saved approval, never to "latest". */
export function approvedMediaSource(card, kind, { delivery = 'full' } = {}) {
  const report = card?.report, media = card?.media?.[kind];
  if (report?.state !== 'PUBLISHED' || !/^ar_[A-Za-z0-9_-]{24}$/.test(report.publicToken ?? '')
    || !positive(report.version) || !hash(report.publicHash) || !media) return null;
  const binding = { publicToken: report.publicToken, approvalVersion: report.version, publicHash: report.publicHash };
  if (['FRONT', 'BACK'].includes(kind)) {
    if (!['preview', 'full'].includes(delivery)) return null;
    const url = `/api/reports/${report.publicToken}/images/${kind}?v=${report.version}`;
    return media.url === url && media.provenance === 'APPROVED_GRADING_PHOTOGRAPH'
      ? { kind, url, delivery, binding: { ...binding, side: kind } } : null;
  }
  if (kind === 'LABEL' || kind === 'LABEL_BACK') {
    const url = `/admin/api/staff/manual-connected/labels/${media.itemId}/artwork?mode=${kind === 'LABEL_BACK' ? 'preview-back' : 'preview'}`;
    if (!uuid(media.itemId) || media.url !== url || media.provenance !== 'REPORT_BOUND_LABEL_ARTWORK') return null;
    if (kind === 'LABEL_BACK') {
      const front = approvedMediaSource(card, 'LABEL');
      if (!front || front.layoutVersion !== APPROVED_LABEL_LAYOUT.version || media.itemId !== card.media.LABEL.itemId) return null;
      return { kind, url, layoutVersion: front.layoutVersion };
    }
    return { kind, url, ...(media.layoutVersion === APPROVED_LABEL_LAYOUT.version ? { layoutVersion: media.layoutVersion } : {}) };
  }
  if (kind === 'SLAB') {
    const url = `/api/reports/${report.publicToken}/presentation/image?v=${report.version}&revision=${media.presentationRevision}`;
    return media.url === url && media.provenance === 'ACTUAL_SLAB_PHOTOGRAPH' && positive(media.presentationRevision)
      && hash(media.sha256) && positive(media.byteCount) && media.byteCount <= 50 * 1024 * 1024
      ? { kind, url, descriptor: { ...media, mime: media.contentType } } : null;
  }
  return null;
}

export function approvedMediaIdentity(card) {
  return JSON.stringify([card?.cardId, card?.approvalActionId, card?.report, card?.media]);
}

function waitFor(operation, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); })
      .then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
        signal.removeEventListener('abort', abort); reject(error);
      });
  });
}

const pause = (ms, signal) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
});

/** Share the public reader's two-request admission allowance across the
 * archive. Retries reuse the exact source. No grants or photos are persisted. */
export function createApprovedMediaLoader({ fetchImpl = (...args) => fetch(...args), timeoutMs = 45000,
  retryDelays = [250, 750], verify = loadVerifiedImage, urlImpl = globalThis.URL,
  origin = () => globalThis.location?.origin,
  endAccess = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPROVED_MEDIA_ACCESS_ENDED)); },
} = {}) {
  const queue = []; let active = 0, scheduled = false;
  const schedule = () => { if (!scheduled) { scheduled = true; queueMicrotask(drain); } };
  const drain = () => {
    scheduled = false; queue.sort((a, b) => a.priority - b.priority);
    while (active < 2 && queue.length) {
      const next = queue.shift(); next.detach();
      if (next.signal.aborted) { next.reject(next.signal.reason); continue; }
      active++;
      waitFor(next.run, next.signal).then(next.resolve, next.reject).finally(() => { active--; schedule(); });
    }
  };
  const enqueue = (run, signal, priority) => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); entry.detach(); reject(signal.reason); };
    const entry = { run, signal, priority, resolve, reject, detach: () => signal.removeEventListener('abort', abort) };
    signal.addEventListener('abort', abort, { once: true }); queue.push(entry); schedule();
  });

  async function request(url, options, signal, deadlineAt) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await waitFor(() => Promise.resolve(fetchImpl(url, { ...options, signal })).then(value => {
          if (signal.aborted) { try { Promise.resolve(value?.body?.cancel()).catch(() => {}); } catch {} }
          return value;
        }), signal);
      } catch (error) {
        if (signal.aborted || attempt >= retryDelays.length || error?.name !== 'TypeError') throw error;
        await pause(retryDelays[attempt], signal); continue;
      }
      signal.throwIfAborted();
      if (options.credentials === 'same-origin' && [401, 403].includes(response.status)) endAccess();
      if (![429, 502, 503, 504].includes(response.status) || attempt >= retryDelays.length) return response;
      // Retain the server's minimum wait, bounded by this load's original deadline.
      const header = response.headers?.get('retry-after');
      const after = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 0;
      const delay = Math.max(retryDelays[attempt], Number.isFinite(after) ? after : 0);
      try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch {}
      if (delay >= deadlineAt - Date.now()) throw failure('APPROVED_MEDIA_TIMEOUT');
      await pause(delay, signal);
    }
  }

  return async function load(source, { signal = new AbortController().signal } = {}) {
    check(source && ['FRONT', 'BACK', 'LABEL', 'LABEL_BACK', 'SLAB'].includes(source.kind));
    const photograph = source.kind === 'FRONT' || source.kind === 'BACK';
    check(!photograph || ['preview', 'full'].includes(source.delivery ?? 'full'));
    const controller = new AbortController(), deadlineAt = Date.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(failure('APPROVED_MEDIA_TIMEOUT')), timeoutMs);
    const bounded = AbortSignal.any([signal, controller.signal]);
    const retryFetch = (url, options) => request(url, options, bounded, deadlineAt);
    try {
      return await enqueue(async () => {
        let descriptor = source.descriptor, full;
        if (photograph) {
          const response = await retryFetch(`${source.url}&delivery=direct`, { method: 'GET', credentials: 'omit',
            cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
          check(response.ok && !response.redirected, 'APPROVED_MEDIA_UNAVAILABLE');
          const grant = parseInspectionAccess(await waitFor(() => response.json(), bounded), source.binding);
          bounded.throwIfAborted(); full = grant.image;
          descriptor = source.delivery === 'preview' && full.preview ? full.preview : full;
        }
        if (descriptor) {
          const verified = async selected => {
            const asset = await verify(selected, { signal: bounded, fetchImpl: retryFetch, urlImpl, origin: origin(), timeoutMs });
            if (bounded.aborted) { asset.dispose(); throw bounded.reason; }
            return { ...asset, width: selected.width, height: selected.height,
              sha256: selected.sha256, byteCount: selected.byteCount,
              ...(full ? { representation: selected === full ? 'full' : 'preview', sourceSha256: full.sha256 } : {}) };
          };
          try { return await verified(descriptor); }
          catch (error) {
            // A missing/unavailable small rendition may use the independently
            // verified full image from this same exact grant. Corrupt bytes,
            // bad lineage, cancellation and deadlines never downgrade checks.
            if (!full || descriptor === full || bounded.aborted
              || !(error?.code === 'VERIFIED_IMAGE_UNAVAILABLE' || error?.name === 'TypeError')) throw error;
            return verified(full);
          }
        }
        // Saved label preview bytes have no image hash in the current contract;
        // their exact authenticated item route is authoritative. The print hash
        // must not be incorrectly applied to these different preview bytes.
        const response = await retryFetch(source.url, { method: 'GET', credentials: 'same-origin', cache: 'no-store',
          redirect: 'error', referrerPolicy: 'no-referrer' });
        check(response.ok && !response.redirected && response.body?.getReader, 'APPROVED_MEDIA_UNAVAILABLE');
        check(response.headers?.get('content-type')?.split(';')[0] === 'image/svg+xml', 'APPROVED_MEDIA_FORMAT');
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await waitFor(() => reader.read(), bounded);
            if (done) break;
            size += value.byteLength; check(size <= 2 * 1024 * 1024, 'APPROVED_MEDIA_TOO_LARGE'); chunks.push(value);
          }
          check(size > 0); bounded.throwIfAborted();
          const url = urlImpl.createObjectURL(new Blob(chunks, { type: 'image/svg+xml' })); let disposed = false;
          return { url, byteCount: size, dispose() { if (!disposed) { disposed = true; urlImpl.revokeObjectURL(url); } } };
        } finally { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
      // A complete still needs its saved label as promptly as its small photo.
      // Optional large media never jumps ahead of either in the shared queue.
      }, bounded, ['LABEL', 'LABEL_BACK'].includes(source.kind) || source.delivery === 'preview' ? 0 : 1);
    } finally { clearTimeout(timer); }
  };
}

export const loadApprovedMedia = createApprovedMediaLoader();

/** One mounted approval owns its media, including independent preview/full
 * photo slots. Full detail cannot evict a still or silently substitute a small
 * rendition. The caller remounts on approvedMediaIdentity changes; nothing is
 * retained across that boundary. Disposed/late loads cannot publish. */
export function createApprovedMediaResource({ load = loadApprovedMedia } = {}) {
  const entries = new Map(); let disposed = false;
  const release = entry => { entry?.controller.abort(); entry?.asset?.dispose(); };
  const slot = source => ['FRONT', 'BACK'].includes(source.kind) ? `${source.kind}:${source.delivery ?? 'full'}` : source.kind;
  const publishState = (entry, state) => { entry.state = state; entry.publish(state); };
  return {
    read(source, publish) {
      if (disposed || !source) return Promise.resolve();
      const key = JSON.stringify(source), entrySlot = slot(source), previous = entries.get(entrySlot);
      if (previous?.key === key && (previous.asset || previous.pending)) {
        previous.publish = publish; publish(previous.state);
        return previous.promise ?? Promise.resolve();
      }
      release(previous);
      const entry = { key, controller: new AbortController(), pending: true, publish, source };
      entries.set(entrySlot, entry); publishState(entry, { loading: true, url: null, error: null });
      const current = () => !disposed && entries.get(entrySlot) === entry && !entry.controller.signal.aborted;
      entry.promise = Promise.resolve().then(() => { entry.controller.signal.throwIfAborted(); return load(source, { signal: entry.controller.signal }); })
        .then(asset => {
          if (!current()) { asset.dispose(); return; }
          entry.asset = asset; entry.pending = false;
          const { representation, width, height, sourceSha256, sha256, byteCount } = asset;
          publishState(entry, { loading: false, url: asset.url, error: null, representation, width, height, sourceSha256, sha256, byteCount });
        }, error => { if (current()) { entry.pending = false; publishState(entry, { loading: false, url: null, error }); } });
      return entry.promise;
    },
    cancel(kind, delivery = 'full') {
      const entrySlot = slot({ kind, delivery }), entry = entries.get(entrySlot);
      if (disposed || !entry?.pending) return;
      release(entry); entries.delete(entrySlot);
      publishState(entry, { loading: false, url: null, error: null, cancelled: true });
    },
    fail(kind, url, delivery = 'full') {
      if (disposed) return;
      for (const [entrySlot, entry] of entries) {
        if (entry.source.kind !== kind || (url ? entry.asset?.url !== url : entrySlot !== slot({ kind, delivery }))) continue;
        release(entry); entries.delete(entrySlot);
        publishState(entry, { loading: false, url: null, error: failure('APPROVED_MEDIA_DECODE') });
      }
    },
    dispose() { disposed = true; entries.forEach(release); entries.clear(); },
  };
}
