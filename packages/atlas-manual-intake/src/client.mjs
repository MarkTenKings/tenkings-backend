// Browser-only. Native File/Blob is retained in IndexedDB until verified storage
// and working-photo preparation are recorded. No image re-encoding occurs here.
const error = code => Object.assign(new Error(code), { code });
function requireThat(ok, code) { if (!ok) throw error(code); }
const base = '/api/staff/manual-intake/cards';
const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
export const MAX_NATIVE_PHOTO_BYTES = 64 * 1024 * 1024;
const definitePlanRefusal = failure => [400, 403, 404, 409, 413].includes(failure?.status)
  && typeof failure.code === 'string';

/** request(path,{method,body,signal}) is the host's ordinary authenticated JSON
 * client with current CSRF. journal must be scoped to the current staff identity.
 * One operation per card/side; call pending() and resume() after phone reload.
 */
export function createIntakeClient({ request, journal, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto, uploadTimeoutMs = 90000 }) {
  requireThat(typeof request === 'function' && journal && typeof fetchImpl === 'function', 'INTAKE_CLIENT_INVALID');
  requireThat(Number.isSafeInteger(uploadTimeoutMs) && uploadTimeoutMs > 0 && uploadTimeoutMs <= 2_147_483_647, 'INTAKE_CLIENT_INVALID');
  const running = new Set(), uploadingSides = new Set();
  const post = (path, body, signal) => request(path, { method: 'POST', body, signal });
  async function putNative(url, options, signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason ?? error('INTAKE_UPLOAD_CANCELLED'));
    signal?.addEventListener('abort', cancel, { once: true });
    let rejectAbort;
    const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(error('INTAKE_UPLOAD_TIMEOUT')), uploadTimeoutMs);
    if (signal?.aborted) cancel();
    try {
      // Native fetch obeys abort; racing also fences a noncooperative injected
      // transport. A timeout reconciles the same key before any later PUT.
      return await Promise.race([Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return fetchImpl(url, { ...options, signal: controller.signal });
      }), aborted]);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', onAbort);
    }
  }
  async function resume(operationId, { signal } = {}) {
    requireThat(!running.has(operationId), 'INTAKE_UPLOAD_IN_PROGRESS'); running.add(operationId);
    try {
      let saved = await journal.get(operationId); requireThat(saved, 'INTAKE_PENDING_UPLOAD_NOT_FOUND');
      if (saved.kind === 'create') {
        const result = await post(base, saved.input, signal); await journal.remove(operationId); return result;
      }
      let freshPlan = false;
      if (!saved.uploadId) {
        // A closed response to the first request can be safely discarded by
        // the human. Earlier missing replies (including legacy journal rows)
        // stay conservative: an exact plan may already exist on the server.
        const previouslyCertain = saved.planUncertain === false;
        saved = { ...saved, planUncertain: true, planRefusal: null };
        await journal.put(operationId, saved);
        let result;
        try { result = await post(`${base}/${saved.cardId}/uploads`, saved.input, signal); }
        catch (failure) {
          if (definitePlanRefusal(failure)) {
            saved = { ...saved, planUncertain: !previouslyCertain,
              planRefusal: { status: failure.status, code: failure.code } };
            await journal.put(operationId, saved);
          }
          throw failure;
        }
        saved = { ...saved, uploadId: result.upload.uploadId }; await journal.put(operationId, saved);
        // Only this invocation can know the plan had no earlier uncertain
        // dispatch. Reloads and retries always reconcile before another PUT.
        freshPlan = previouslyCertain;
      }
      const path = `${base}/${saved.cardId}/uploads/${saved.uploadId}`;
      let verified, needsUpload = freshPlan;
      // A lost PUT or committed completion starts with exact-plan readback.
      // A genuinely new plan can go straight to signing; the mandatory
      // post-PUT checksum/readback remains the only original acceptance proof.
      if (!freshPlan) {
        try { verified = await post(`${path}/complete`, {}, signal); }
        catch (failure) {
          if (failure.code !== 'INTAKE_UPLOAD_ABSENT') throw failure;
          needsUpload = true;
        }
      }
      if (needsUpload) {
        const signed = await post(`${path}/sign`, {}, signal);
        if (signed.state === 'UPLOAD') {
          requireThat(signed.uploadId === saved.uploadId && signed.method === 'PUT' && signed.byteCount === saved.file.size
            && new URL(signed.url).protocol === 'https:', 'INTAKE_UPLOAD_PLAN_INVALID');
          // Rehash persisted bytes before a later retry. A lost/modified Blob
          // cannot be used to satisfy a different native-photo plan.
          const bytes = await saved.file.arrayBuffer();
          requireThat(hex(await cryptoImpl.subtle.digest('SHA-256', bytes)) === saved.input.sha256, 'INTAKE_PENDING_BYTES_CONFLICT');
          try {
            await putNative(signed.url, { method: 'PUT', headers: signed.headers, body: saved.file,
              mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }, signal);
          } catch (failure) { if (signal?.aborted) throw failure; }
          // 2xx, 412, other errors and a lost reply all require the same server
          // checksum/readback. Never count the browser's response as proof.
        } else requireThat(signed.state === 'VERIFIED', 'INTAKE_UPLOAD_PLAN_INVALID');
        verified = await post(`${path}/complete`, {}, signal);
      }
      requireThat(verified.upload.verification && verified.upload.uploadId === saved.uploadId, 'INTAKE_UPLOAD_UNVERIFIED');
      saved = { ...saved, verified: true }; await journal.put(operationId, saved);
      const prepared = await post(`${path}/prepare`, {}, signal);
      requireThat(prepared.upload.source, 'INTAKE_PHOTO_NOT_PREPARED');
      await journal.remove(operationId); return prepared;
    } finally { running.delete(operationId); }
  }
  return Object.freeze({
    pending: () => journal.list(), resume,
    list: options => request(`${base}${options?.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : ''}`, { method: 'GET' }),
    read: cardId => request(`${base}/${cardId}`, { method: 'GET' }),
    async prepareSaved(cardId, uploadId, { signal } = {}) {
      // A verified original can outlive this device's journal. Reconcile that
      // exact existing upload and prepare it without allocating or sending bytes.
      const operation = `saved:${cardId}:${uploadId}`;
      requireThat(!running.has(operation), 'INTAKE_UPLOAD_IN_PROGRESS'); running.add(operation);
      try {
        const path = `${base}/${cardId}/uploads/${uploadId}`;
        const verified = await post(`${path}/complete`, {}, signal);
        requireThat(verified.upload?.verification && verified.upload.uploadId === uploadId, 'INTAKE_UPLOAD_UNVERIFIED');
        const prepared = await post(`${path}/prepare`, {}, signal);
        requireThat(prepared.upload?.source && prepared.upload.uploadId === uploadId, 'INTAKE_PHOTO_NOT_PREPARED');
        return prepared;
      } finally { running.delete(operation); }
    },
    async discardUnplanned(operationId) {
      requireThat(!running.has(operationId), 'INTAKE_UPLOAD_IN_PROGRESS'); running.add(operationId);
      try {
        const saved = await journal.get(operationId);
        requireThat(saved?.kind === 'upload' && !saved.uploadId && saved.planUncertain === false
          && definitePlanRefusal(saved.planRefusal), 'INTAKE_PLAN_NOT_DISCARDABLE');
        await journal.remove(operationId);
      } finally { running.delete(operationId); }
    },
    async forgetVerified(operationId, { signal } = {}) {
      requireThat(!running.has(operationId), 'INTAKE_UPLOAD_IN_PROGRESS');
      const saved = await journal.get(operationId);
      requireThat(saved?.kind === 'upload' && saved.uploadId, 'INTAKE_PENDING_UPLOAD_NOT_FOUND');
      const result = await post(`${base}/${saved.cardId}/uploads/${saved.uploadId}/complete`, {}, signal);
      requireThat(result.upload.verification, 'INTAKE_UPLOAD_UNVERIFIED'); await journal.remove(operationId);
    },
    async create(label = '', options = {}) {
      const operationId = cryptoImpl.randomUUID();
      await journal.put(operationId, { kind: 'create', input: { requestId: operationId, label } });
      return resume(operationId, options);
    },
    async upload(cardId, side, expectedVersion, file, options = {}) {
      requireThat(file instanceof Blob && file.size > 0, 'INTAKE_NATIVE_FILE_REQUIRED');
      requireThat(file.size <= MAX_NATIVE_PHOTO_BYTES, 'INTAKE_PHOTO_TOO_LARGE');
      const sideKey = `${cardId}:${side}`;
      // Reserve before the first journal/hash await. Opposite sides are
      // independent, while a double selection cannot allocate two side plans.
      requireThat(!uploadingSides.has(sideKey), 'INTAKE_UPLOAD_IN_PROGRESS'); uploadingSides.add(sideKey);
      try {
        const pending = await journal.list();
        requireThat(!pending.some(item => item.value.kind === 'upload' && item.value.cardId === cardId
          && item.value.input.side === side && !item.value.verified), 'INTAKE_SIDE_UPLOAD_PENDING');
        const sha256 = hex(await cryptoImpl.subtle.digest('SHA-256', await file.arrayBuffer()));
        const operationId = cryptoImpl.randomUUID();
        await journal.put(operationId, { kind: 'upload', cardId, file, planUncertain: false, input: { requestId: operationId, side,
          expectedVersion, sha256, byteCount: file.size } });
        return await resume(operationId, options);
      } finally { uploadingSides.delete(sideKey); }
    },
  });
}

export function createBrowserIntakeJournal({ staffId, indexedDB = globalThis.indexedDB }) {
  requireThat(typeof staffId === 'string' && /^[a-f0-9-]{36}$/.test(staffId) && indexedDB, 'INTAKE_JOURNAL_UNAVAILABLE');
  const prefix = `${staffId}:`, opened = new Promise((resolve, reject) => {
    const operation = indexedDB.open('atlas-native-photo-intake-v1', 1);
    operation.onupgradeneeded = () => operation.result.createObjectStore('pending');
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(error('INTAKE_JOURNAL_UNAVAILABLE'));
  });
  async function transaction(mode, execute) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending', mode), store = tx.objectStore('pending'); let result;
      const set = value => { result = value; };
      tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(error('INTAKE_JOURNAL_UNAVAILABLE'));
      execute(store, set);
    });
  }
  return Object.freeze({
    get: id => transaction('readonly', (store, done) => { store.get(prefix + id).onsuccess = event => done(event.target.result); }),
    put: (id, value) => transaction('readwrite', store => { store.put(value, prefix + id); }),
    remove: id => transaction('readwrite', store => { store.delete(prefix + id); }),
    list: () => transaction('readonly', (store, done) => {
      const values = [], cursor = store.openCursor();
      cursor.onsuccess = event => {
        const item = event.target.result;
        if (!item) { done(values); return; }
        if (String(item.key).startsWith(prefix)) values.push({ id: String(item.key).slice(prefix.length), value: item.value });
        item.continue();
      };
    }),
    close: async () => (await opened).close(),
  });
}
