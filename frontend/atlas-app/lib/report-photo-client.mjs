// Optional presentation-photo transport. Native bytes are never re-encoded in
// the browser. An uncertain result retains its original request identity.
const fail = code => Object.assign(new Error(code), { code });
const check = (condition, code = 'PRESENTATION_UPLOAD_INVALID') => { if (!condition) throw fail(code); };
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
export const MAX_PRESENTATION_PHOTO_BYTES = 64 * 1024 * 1024;
const absent = error => ['PRESENTATION_UPLOAD_ABSENT','MANUAL_PRESENTATION_UPLOAD_ABSENT','INTAKE_UPLOAD_ABSENT'].includes(error?.code);

export function createReportPhotoClient({ cardId, staffId, request, storage, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto }) {
  check(/^[a-f0-9-]{36}$/.test(cardId) && /^[a-f0-9-]{36}$/.test(staffId) && typeof request === 'function' && storage, 'PRESENTATION_CLIENT_INVALID');
  const path = `/api/staff/manual-connected/cards/${cardId}/presentation`, key = `atlas-report-photo:${staffId}:${cardId}`;
  let running = false;
  const post = (url, body) => request(url, { method: 'POST', body });
  function pending() {
    let value; try { value = JSON.parse(storage.getItem(key) ?? 'null'); } catch { throw fail('PRESENTATION_PENDING_INVALID'); }
    if (value) check(value.version === 1 && value.cardId === cardId && value.staffId === staffId
      && ['upload','remove'].includes(value.kind) && /^[a-f0-9-]{36}$/.test(value.input?.requestId ?? ''), 'PRESENTATION_PENDING_INVALID');
    return value;
  }
  function save(value) {
    const before = pending(); check(!before || before.input.requestId === value.input.requestId, 'PRESENTATION_PENDING_CONFLICT');
    storage.setItem(key, JSON.stringify(value));
  }
  function clear(value) { if (pending()?.input.requestId === value.input.requestId) storage.removeItem(key); }
  async function fileHash(file) {
    check(file instanceof Blob && file.size > 0, 'PRESENTATION_FILE_REQUIRED');
    check(file.size <= MAX_PRESENTATION_PHOTO_BYTES, 'PRESENTATION_PHOTO_TOO_LARGE');
    return hex(await cryptoImpl.subtle.digest('SHA-256', await file.arrayBuffer()));
  }
  async function run(saved, file, fresh) {
    if (saved.kind === 'remove') {
      const result = await post(`${path}/remove`, saved.input);
      check(result.approvalActionId === saved.input.approvalActionId && result.revision > saved.input.expectedRevision);
      clear(saved); return result;
    }
    if (!saved.uploadId) {
      const planned = await post(`${path}/uploads`, saved.input);
      check(/^[a-f0-9-]{36}$/.test(planned.uploadId ?? ''));
      saved = { ...saved, uploadId: planned.uploadId }; save(saved);
    }
    const uploadPath = `${path}/uploads/${saved.uploadId}`;
    let result;
    if (!fresh) {
      try { result = await post(`${uploadPath}/complete`, {}); }
      catch (error) { if (!absent(error)) throw error; }
    }
    if (!result) {
      check(file, 'PRESENTATION_SAVED_FILE_REQUIRED');
      check(file.size === saved.input.byteCount && await fileHash(file) === saved.input.sha256, 'PRESENTATION_SAVED_FILE_MISMATCH');
      const signed = await post(`${uploadPath}/sign`, {});
      if (signed.state === 'UPLOAD') {
        let url; try { url = new URL(signed.url); } catch { throw fail('PRESENTATION_UPLOAD_INVALID'); }
        check(signed.method === 'PUT' && url.protocol === 'https:' && !url.username && !url.password && signed.headers && typeof signed.headers === 'object');
        // Storage responses never establish completion; all outcomes reconcile
        // through the exact server-side byte verification below.
        try { await fetchImpl(signed.url, { method: 'PUT', headers: signed.headers, body: file,
          mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(90000) }); }
        catch { /* The exact completion read distinguishes a saved object from absence. */ }
      } else check(signed.state === 'VERIFIED' || signed.state === 'COMPLETE');
      result = await post(`${uploadPath}/complete`, {});
    }
    check(result.approvalActionId === saved.input.approvalActionId && result.revision > saved.input.expectedRevision && result.presentation?.slabPhoto);
    clear(saved); return result;
  }
  async function exclusive(callback) {
    check(!running, 'PRESENTATION_UPLOAD_BUSY'); running = true;
    try { return await callback(); } finally { running = false; }
  }
  return Object.freeze({
    read: () => request(path), pending,
    upload: (file, current, alt) => exclusive(async () => {
      check(!pending(), 'PRESENTATION_REQUEST_PENDING');
      check(/^[a-f0-9-]{36}$/.test(current?.approvalActionId ?? '') && Number.isSafeInteger(current?.revision) && current.revision >= 0);
      const sha256 = await fileHash(file);
      const saved = { version: 1, cardId, staffId, kind: 'upload', input: { requestId: cryptoImpl.randomUUID(),
        approvalActionId: current.approvalActionId, expectedRevision: current.revision, sha256, byteCount: file.size, alt } };
      save(saved); return run(saved, file, true);
    }),
    resume: file => exclusive(async () => { const saved = pending(); check(saved, 'PRESENTATION_REQUEST_MISSING'); return run(saved, file, false); }),
    remove: current => exclusive(async () => {
      check(!pending(), 'PRESENTATION_REQUEST_PENDING');
      check(/^[a-f0-9-]{36}$/.test(current?.approvalActionId ?? '') && Number.isSafeInteger(current?.revision) && current.revision > 0);
      const saved = { version: 1, cardId, staffId, kind: 'remove', input: { requestId: cryptoImpl.randomUUID(), approvalActionId: current.approvalActionId, expectedRevision: current.revision } };
      save(saved); return run(saved, null, false);
    }),
    reconcileSuperseded: () => exclusive(async () => {
      const saved = pending(), current = await request(path);
      check(saved && (saved.input.approvalActionId !== current.approvalActionId || current.revision > saved.input.expectedRevision), 'PRESENTATION_REQUEST_CURRENT');
      clear(saved); return current;
    }),
  });
}
