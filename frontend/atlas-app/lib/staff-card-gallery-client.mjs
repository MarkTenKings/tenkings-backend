import { STAFF_BASE_PATH } from './routes.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_IMAGE = 768 * 1024;
const MAX_JSON = 2 * 1024 * 1024;
const states = ['UNKNOWN', 'SAVED_DRAFT', 'APPROVED_CURRENT', 'CHANGED_SINCE_APPROVAL', 'PHOTOS_CHANGED'];
const fail = (code = 'GALLERY_REPLY_INVALID', status = 503) => Object.assign(new Error(code), { code, status });
const check = value => { if (!value) throw fail(); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const nullableHash = value => value === null || typeof value === 'string' && HASH.test(value);
const keys = (value, names) => check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)));
export function staffCardGalleryScope(staff) {
  return staff && typeof staff.id === 'string' && UUID.test(staff.id)
    && typeof staff.role === 'string' && /^[A-Z_]{1,30}$/.test(staff.role)
    && typeof staff.mode === 'string' && /^[A-Z_]{1,30}$/.test(staff.mode)
    ? `${staff.id}:${staff.role}:${staff.mode}` : null;
}
export function staffCardGalleryKey(card) {
  check(UUID.test(card?.cardId ?? '') && integer(card.revision) && nullableHash(card.sourceHash));
  const front = card.sides?.FRONT;
  check(front && integer(front.version));
  const upload = front.upload;
  if (upload) check(UUID.test(upload.uploadId ?? '') && upload.version === front.version
    && (!upload.verification || HASH.test(upload.verification.sha256 ?? '')));
  return [card.cardId, card.revision, card.sourceHash ?? 'none', upload?.uploadId ?? 'none', front.version,
    upload?.verification?.sha256 ?? 'none'].join(':');
}
function readBinding(value, card, manual) {
  keys(value, ['cardId', 'intakeRevision', 'sourceHash', 'side', 'uploadId', 'version', 'originalSha256', 'manualRevision', 'manualContentHash']);
  const front = card.sides.FRONT, upload = front.upload;
  check(value.cardId === card.cardId && value.intakeRevision === card.revision && value.sourceHash === card.sourceHash
    && value.side === 'FRONT' && upload && value.uploadId === upload.uploadId && value.version === front.version
    && value.originalSha256 === upload.verification?.sha256 && HASH.test(value.originalSha256)
    && value.manualRevision === (manual?.revision ?? null) && value.manualContentHash === (manual?.contentHash ?? null));
  return { cardId: value.cardId, intakeRevision: value.intakeRevision, sourceHash: value.sourceHash, side: 'FRONT',
    uploadId: value.uploadId, version: value.version, originalSha256: value.originalSha256,
    manualRevision: value.manualRevision, manualContentHash: value.manualContentHash };
}
export function readStaffCardGalleryMetadata(value, card, staffId) {
  check(UUID.test(staffId ?? ''));
  if (value?.staffId !== staffId) throw fail('GALLERY_ACCESS_ENDED', 401);
  staffCardGalleryKey(card);
  keys(value, ['schema', 'staffId', 'cardId', 'intakeRevision', 'sourceHash', 'manual', 'title', 'review', 'front']);
  check(value.schema === 'atlas-staff-card-gallery-v1' && value.cardId === card.cardId);
  if (value.intakeRevision !== card.revision || value.sourceHash !== card.sourceHash) throw fail('GALLERY_SOURCE_CHANGED', 409);
  let manual = null;
  if (value.manual !== null) {
    keys(value.manual, ['revision', 'contentHash', 'sourceCurrent']);
    check(integer(value.manual.revision) && HASH.test(value.manual.contentHash ?? '') && typeof value.manual.sourceCurrent === 'boolean');
    manual = { ...value.manual };
  }
  keys(value.title, ['state', 'text', 'source']);
  check(value.title.state === 'UNKNOWN' ? value.title.text === null && value.title.source === null
    : value.title.state === 'CURRENT' && typeof value.title.text === 'string' && value.title.text.trim().length > 0
      && value.title.text.length <= 1000 && !value.title.text.includes('\0') && ['MANUAL', 'SAVED_DETAILS'].includes(value.title.source));
  if (value.title.source === 'MANUAL') check(manual?.sourceCurrent === true);
  keys(value.review, ['state', 'approval']); check(states.includes(value.review.state));
  let approval = null;
  if (value.review.approval !== null) {
    keys(value.review.approval, ['actionId', 'sourceHash', 'reportHash', 'approvedAt', 'current']);
    const a = value.review.approval;
    check(UUID.test(a.actionId ?? '') && HASH.test(a.sourceHash ?? '') && HASH.test(a.reportHash ?? '')
      && typeof a.approvedAt === 'string' && Number.isFinite(Date.parse(a.approvedAt)) && typeof a.current === 'boolean');
    approval = { ...a };
  }
  if (value.review.state === 'APPROVED_CURRENT') check(manual?.sourceCurrent === true && approval?.current === true && approval.sourceHash === manual.contentHash);
  else check(approval?.current !== true);
  if (value.review.state === 'CHANGED_SINCE_APPROVAL') check(manual?.sourceCurrent === true && approval && approval.sourceHash !== manual.contentHash);
  if (value.review.state === 'PHOTOS_CHANGED') check(manual?.sourceCurrent === false);
  if (value.review.state === 'SAVED_DRAFT') check(manual?.sourceCurrent === true);
  keys(value.front, ['state', 'binding']); check(['READY', 'UNAVAILABLE'].includes(value.front.state));
  const binding = value.front.state === 'READY' ? readBinding(value.front.binding, card, manual) : null;
  if (value.front.state === 'UNAVAILABLE') check(value.front.binding === null);
  return { schema: value.schema, staffId, cardId: card.cardId, intakeRevision: card.revision, sourceHash: card.sourceHash,
    manual, title: { ...value.title }, review: { state: value.review.state, approval }, front: { state: value.front.state, binding } };
}
export function staffCardGalleryPreviewPath(metadata) {
  const b = metadata.front.binding; check(metadata.front.state === 'READY' && b);
  const params = new URLSearchParams();
  for (const name of ['intakeRevision', 'sourceHash', 'uploadId', 'version', 'originalSha256', 'manualRevision', 'manualContentHash'])
    params.set(name, b[name] === null ? 'none' : String(b[name]));
  return `${STAFF_BASE_PATH}/api/staff/manual-connected/cards/${b.cardId}/gallery-preview?${params}`;
}
export async function readStaffCardGalleryPreview(value, metadata, card, staffId, cryptoImpl = globalThis.crypto) {
  check(UUID.test(staffId ?? ''));
  if (value?.staffId !== staffId || metadata?.staffId !== staffId) throw fail('GALLERY_ACCESS_ENDED', 401);
  keys(value, ['schema', 'staffId', 'binding', 'image', 'display']); check(value.schema === 'atlas-staff-gallery-preview-v1');
  const binding = readBinding(value.binding, card, metadata.manual);
  check(JSON.stringify(binding) === JSON.stringify(metadata.front.binding));
  keys(value.display, ['source', 'fit', 'crop', 'background', 'sourceFrameSha256']);
  check(value.display.source === 'ORIGINAL_UPLOAD' && value.display.fit === 'inside' && value.display.crop === false
    && value.display.background === '#ffffff' && HASH.test(value.display.sourceFrameSha256 ?? ''));
  const im = value.image;
  keys(im, ['mime', 'byteCount', 'sha256', 'width', 'height', 'base64']);
  check(im.mime === 'image/jpeg' && Number.isSafeInteger(im.byteCount) && im.byteCount >= 4 && im.byteCount <= MAX_IMAGE
    && HASH.test(im.sha256 ?? '') && Number.isSafeInteger(im.width) && im.width > 0 && im.width <= 768
    && Number.isSafeInteger(im.height) && im.height > 0 && im.height <= 768
    && typeof im.base64 === 'string' && im.base64.length <= Math.ceil(MAX_IMAGE / 3) * 4
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(im.base64));
  const binary = atob(im.base64); check(btoa(binary) === im.base64 && binary.length === im.byteCount);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  check(bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217);
  const digest = [...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  check(digest === im.sha256);
  return { blob: new Blob([bytes], { type: im.mime }), width: im.width, height: im.height, sha256: digest };
}
async function boundedJson(response) {
  const declared = response.headers.get('content-length');
  if (declared !== null) check(/^[0-9]+$/.test(declared) && Number(declared) <= MAX_JSON);
  check(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''));
  check(/(?:^|,)\s*private(?:\s*,|\s*$)/i.test(response.headers.get('cache-control') ?? '')
    && /(?:^|,)\s*no-store(?:\s*,|\s*$)/i.test(response.headers.get('cache-control') ?? ''));
  if (!response.body?.getReader) throw fail();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_JSON) throw fail(); chunks.push(value); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw fail(); }
}
async function get(path, signal, fetchImpl) {
  const response = await fetchImpl(path, { method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { Accept: 'application/json' }, signal });
  if (response.status === 401 || response.status === 403) throw fail('GALLERY_ACCESS_ENDED', response.status);
  const value = await boundedJson(response);
  if (!response.ok) throw fail(typeof value?.error === 'string' && /^[A-Z_]{1,80}$/.test(value.error) ? value.error : 'GALLERY_UNAVAILABLE', response.status);
  return value;
}
/** Read-only wire adapter. The queue validates every reply, including injected fixture replies. */
export async function readStaffCardGalleryItem(card, { staffId, signal, onMetadata, metadata = null, fetchImpl = globalThis.fetch } = {}) {
  check(UUID.test(staffId ?? ''));
  staffCardGalleryKey(card);
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 25000);
  try {
    const value = metadata ?? await get(`${STAFF_BASE_PATH}/api/staff/manual-connected/cards/${card.cardId}/gallery`, controller.signal, fetchImpl);
    const checked = readStaffCardGalleryMetadata(value, card, staffId); onMetadata?.(checked);
    return { metadata: checked, preview: checked.front.state === 'READY' ? await get(staffCardGalleryPreviewPath(checked), controller.signal, fetchImpl) : null };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

/** Scope-owned, visible-only queue. At most two metadata→preview reads run together. */
export function createStaffCardGalleryQueue({ staffId, readCard = readStaffCardGalleryItem, onAccessLost, createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url) } = {}) {
  check(UUID.test(staffId ?? ''));
  const records = new Map(), waiting = []; let active = 0, closed = false;
  const initial = () => ({ state: 'IDLE', metadata: null, url: null, width: null, height: null });
  const publish = record => { for (const listener of record.listeners) listener({ ...record.value }); };
  const clearURL = record => { if (record.value.url) revokeObjectURL(record.value.url); record.value.url = null; };
  const remove = record => { record.generation++; record.controller?.abort(); clearURL(record); records.delete(record.key); };
  function dispose() { if (closed) return; closed = true; waiting.length = 0; for (const record of records.values()) { record.generation++; record.controller?.abort(); clearURL(record); record.value = initial(); publish(record); } records.clear(); }
  function pump() {
    while (!closed && active < 2 && waiting.length) {
      const record = waiting.shift(); if (records.get(record.key) !== record || record.value.state !== 'QUEUED') continue;
      if (!record.visible) { record.value = { ...record.value, state: 'IDLE' }; publish(record); continue; }
      const generation = ++record.generation, controller = new AbortController(); record.controller = controller; active++;
      const current = () => !closed && !controller.signal.aborted && records.get(record.key) === record && record.generation === generation;
      record.value = { ...record.value, state: 'LOADING' }; publish(record);
      void (async () => {
        try {
          const result = await readCard(record.card, { staffId, signal: controller.signal, metadata: record.value.metadata,
            onMetadata: value => { if (!current()) return; const metadata = readStaffCardGalleryMetadata(value, record.card, staffId); record.value = { ...record.value, metadata }; publish(record); } });
          if (!current()) return;
          const metadata = readStaffCardGalleryMetadata(result.metadata, record.card, staffId);
          if (record.value.metadata) check(JSON.stringify(metadata) === JSON.stringify(record.value.metadata));
          if (metadata.front.state === 'UNAVAILABLE') { check(result.preview === null); record.value = { ...initial(), state: 'MISSING', metadata }; publish(record); return; }
          const photo = await readStaffCardGalleryPreview(result.preview, metadata, record.card, staffId); if (!current()) return;
          const url = createObjectURL(photo.blob); if (!current()) { revokeObjectURL(url); return; }
          clearURL(record); record.value = { state: 'READY', metadata, url, width: photo.width, height: photo.height }; publish(record);
        } catch (error) {
          if (!current()) return;
          if (error?.status === 401 || error?.status === 403 || error?.code === 'GALLERY_ACCESS_ENDED') { dispose(); onAccessLost?.(); return; }
          clearURL(record);
          const stale = error?.status === 409 || error?.code === 'GALLERY_SOURCE_CHANGED';
          const unavailable = [404, 410].includes(error?.status) && error?.code !== 'GALLERY_PREVIEW_UNAVAILABLE';
          record.value = { ...initial(), state: stale ? 'STALE' : unavailable ? 'UNAVAILABLE' : 'FAILED', metadata: stale || unavailable ? null : record.value.metadata };
          publish(record);
        } finally { active--; if (record.controller === controller) record.controller = null; pump(); }
      })();
    }
  }
  function enqueue(record) { if (closed || !record.visible || !['IDLE', 'FAILED', 'MISSING'].includes(record.value.state)) return; record.value = { ...record.value, state: 'QUEUED' }; waiting.push(record); publish(record); pump(); }
  return Object.freeze({
    subscribe(card, listener) {
      if (closed) return () => {};
      const key = staffCardGalleryKey(card); let record = records.get(key);
      if (!record) { record = { key, card, listeners: new Set(), visible: false, generation: 0, controller: null, value: initial() }; records.set(key, record); }
      record.listeners.add(listener); listener({ ...record.value });
      return () => { record.listeners.delete(listener); if (!record.listeners.size) remove(record); };
    },
    visible(card, visible) { const record = records.get(staffCardGalleryKey(card)); if (!record || closed) return; record.visible = visible; if (visible && record.value.state === 'IDLE') enqueue(record); },
    retry(card) { const record = records.get(staffCardGalleryKey(card)); if (!record || closed) return; record.visible = true; if (record.value.state === 'MISSING') record.value.metadata = null; enqueue(record); },
    imageFailed(card) { const record = records.get(staffCardGalleryKey(card)); if (!record || closed || record.value.state !== 'READY') return; clearURL(record); record.value = { ...record.value, state: 'FAILED' }; publish(record); },
    dispose,
  });
}
