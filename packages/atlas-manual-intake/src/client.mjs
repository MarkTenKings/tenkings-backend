import { encodePhoto, decodePhoto, readNativePhotoBytes, photoStorageError } from './photo-bytes.mjs';
// Browser-only. Exact native photo bytes are retained until verified storage
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
export function createIntakeClient({ request, journal, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto, uploadTimeoutMs = 90000,
  isPaused = () => false }) {
  requireThat(typeof request === 'function' && journal && typeof fetchImpl === 'function', 'INTAKE_CLIENT_INVALID');
  requireThat(Number.isSafeInteger(uploadTimeoutMs) && uploadTimeoutMs > 0 && uploadTimeoutMs <= 2_147_483_647, 'INTAKE_CLIENT_INVALID');
  const running = new Set(), uploadingSides = new Set();
  const post = (path, body, signal) => { requireThat(!isPaused(), 'INTAKE_DISCARD_PENDING'); return request(path, { method: 'POST', body, signal }); };
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
  async function resume(operationId, { signal, fallbackFile } = {}) {
    requireThat(!running.has(operationId), 'INTAKE_UPLOAD_IN_PROGRESS'); running.add(operationId);
    let identity;
    try {
      let saved = await journal.get(operationId); requireThat(saved, 'INTAKE_PENDING_UPLOAD_NOT_FOUND');
      identity = saved;
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
          let bytes;
          try { bytes = await readNativePhotoBytes(saved.file); }
          catch (failure) {
            if (failure?.code !== 'PHOTO_BYTES_UNREADABLE' || !(fallbackFile instanceof Blob)) throw failure;
            requireThat(fallbackFile.size === saved.input.byteCount, 'INTAKE_PENDING_BYTES_CONFLICT');
            const recovered = await encodePhoto(fallbackFile);
            requireThat(hex(await cryptoImpl.subtle.digest('SHA-256', recovered.bytes)) === saved.input.sha256, 'INTAKE_PENDING_BYTES_CONFLICT');
            // Upgrade only this exact retained original; no new request, card,
            // upload plan or pixel conversion is introduced by recovery.
            saved = { ...saved, file: decodePhoto(recovered) };
            await journal.put(operationId, saved, { recoverOriginal: true }); bytes = recovered.bytes;
          }
          requireThat(hex(await cryptoImpl.subtle.digest('SHA-256', bytes)) === saved.input.sha256, 'INTAKE_PENDING_BYTES_CONFLICT');
          try {
            await putNative(signed.url, { method: 'PUT', headers: signed.headers, body: new Blob([bytes], { type: saved.file.type }),
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
    } catch (failure) {
      if (failure?.code === 'INTAKE_CARD_DELETED' && identity && journal.retire) await journal.retire({
        createRequestIds: identity.kind === 'create' ? [identity.input.requestId] : [], cardIds: identity.cardId ? [identity.cardId] : [] });
      throw failure;
    } finally { running.delete(operationId); }
  }
  return Object.freeze({
    pending: options => journal.list(options), resume,
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
      requireThat(!isPaused(), 'INTAKE_DISCARD_PENDING');
      const operationId = cryptoImpl.randomUUID();
      await journal.put(operationId, { kind: 'create', input: { requestId: operationId, label } });
      return resume(operationId, options);
    },
    async upload(cardId, side, expectedVersion, file, options = {}) {
      requireThat(!isPaused(), 'INTAKE_DISCARD_PENDING');
      requireThat(file instanceof Blob && file.size > 0, 'INTAKE_NATIVE_FILE_REQUIRED');
      requireThat(file.size <= MAX_NATIVE_PHOTO_BYTES, 'INTAKE_PHOTO_TOO_LARGE');
      const sideKey = `${cardId}:${side}`;
      // Reserve before the first journal/hash await. Opposite sides are
      // independent, while a double selection cannot allocate two side plans.
      requireThat(!uploadingSides.has(sideKey), 'INTAKE_UPLOAD_IN_PROGRESS'); uploadingSides.add(sideKey);
      try {
        const pending = await journal.list({ metadataOnly: true });
        requireThat(!pending.some(item => item.value.kind === 'upload' && item.value.cardId === cardId
          && item.value.input.side === side && !item.value.verified), 'INTAKE_SIDE_UPLOAD_PENDING');
        const encoded = await encodePhoto(file);
        const sha256 = hex(await cryptoImpl.subtle.digest('SHA-256', encoded.bytes));
        file = decodePhoto(encoded);
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
  const prefix = `${staffId}:`, metadataPrefix = `${prefix}byte-metadata:`, bytesPrefix = `${prefix}photo-bytes:`, cache = new Map();
  const retiredKey = `${prefix}discarded-v1`;
  const deleted = (value, retired) => value?.kind === 'create' ? retired?.createRequestIds?.includes(value.input.requestId)
    : retired?.cardIds?.includes(value?.cardId);
  const storageFailure = cause => photoStorageError(cause, 'INTAKE_JOURNAL_UNAVAILABLE');
  const opened = new Promise((resolve, reject) => {
    const operation = indexedDB.open('atlas-native-photo-intake-v1', 1);
    operation.onupgradeneeded = () => operation.result.createObjectStore('pending');
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(storageFailure(operation.error));
  });
  async function transaction(mode, execute) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending', mode), store = tx.objectStore('pending'); let result, failure;
      const guard = work => event => { try { work(event); } catch (error) { failure = error; tx.abort(); } };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = event => reject(failure?.code === 'INTAKE_CARD_DELETED' ? failure : storageFailure(failure ?? event.target.error ?? tx.error));
      try { execute(store, value => { result = value; }, guard); }
      catch (error) { tx.abort(); reject(storageFailure(error)); }
    });
  }
  const raw = id => transaction('readonly', (store, done) => {
    store.get(metadataPrefix + id).onsuccess = event => {
      if (event.target.result) return done({ current: event.target.result });
      store.get(prefix + id).onsuccess = legacy => done({ legacy: legacy.target.result });
    };
  });
  async function get(id, { metadataOnly = false } = {}) {
    const { current, legacy } = await raw(id), value = current ?? legacy;
    if (!value) { cache.delete(id); return undefined; }
    if (value.kind !== 'upload') return value;
    if (metadataOnly) { const { file, photoRef, ...metadata } = value; return metadata; }
    if (!current) return value; // Leave the legacy Blob and intent intact.
    let file = cache.get(id);
    if (!file) {
      if (current.photoRef === 'bytes') file = decodePhoto(await transaction('readonly', (store, done) => {
        store.get(bytesPrefix + id).onsuccess = event => done(event.target.result);
      }));
      else {
        requireThat(current.photoRef === 'legacy', 'PHOTO_STORAGE_CORRUPT');
        const old = await transaction('readonly', (store, done) => {
          store.get(prefix + id).onsuccess = event => done(event.target.result);
        });
        requireThat(old?.file instanceof Blob, 'PHOTO_STORAGE_CORRUPT'); file = old.file;
      }
      cache.set(id, file);
    }
    return { ...value, file };
  }
  async function put(id, value, { recoverOriginal = false } = {}) {
    const { current, legacy } = await raw(id);
    const { file, photoRef: ignored, ...metadata } = value;
    let encoded;
    if (value.kind === 'upload') {
      requireThat(file instanceof Blob, 'PHOTO_STORAGE_CORRUPT');
      metadata.photoRef = current?.photoRef ?? (legacy?.file instanceof Blob ? 'legacy' : 'bytes');
      if (recoverOriginal) {
        const prior = current ?? legacy;
        requireThat(prior?.kind === 'upload' && prior.cardId === value.cardId && prior.uploadId === value.uploadId
          && JSON.stringify(prior.input) === JSON.stringify(value.input), 'INTAKE_PENDING_BYTES_CONFLICT');
        encoded = await encodePhoto(file);
        requireThat(encoded.byteCount === prior.input.byteCount
          && hex(await globalThis.crypto.subtle.digest('SHA-256', encoded.bytes)) === prior.input.sha256, 'INTAKE_PENDING_BYTES_CONFLICT');
        metadata.photoRef = 'bytes';
      } else if (!current && !legacy) encoded = await encodePhoto(file);
    }
    await transaction('readwrite', (store, done, guard) => {
      store.get(retiredKey).onsuccess = guard(event => {
        // A different tab may retire this card while bytes are being hashed.
        // Test the fence inside the same transaction as the delayed write.
        requireThat(!deleted(metadata, event.target.result), 'INTAKE_CARD_DELETED');
        if (encoded) store.put(encoded, bytesPrefix + id);
        store.put(metadata, metadataPrefix + id);
        // Preserve legacy rows during ordinary progress. Exact-byte recovery
        // removes one only with its verified byte replacement in this transaction.
        if (metadata.photoRef !== 'legacy') store.delete(prefix + id);
      });
    });
    if (encoded) cache.set(id, decodePhoto(encoded));
  }
  async function remove(id) {
    await transaction('readwrite', store => {
      store.delete(prefix + id); store.delete(metadataPrefix + id); store.delete(bytesPrefix + id);
    });
    cache.delete(id);
  }
  async function list(options = {}) {
    // Key enumeration avoids cursor deserialization of unrelated photo bodies.
    const keys = await transaction('readonly', (store, done) => { store.getAllKeys().onsuccess = event => done(event.target.result); });
    const ids = new Set();
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(prefix) || key.startsWith(bytesPrefix) || key === retiredKey) continue;
      ids.add(key.startsWith(metadataPrefix) ? key.slice(metadataPrefix.length) : key.slice(prefix.length));
    }
    const values = [];
    // Sequential reads keep peak memory bounded when the caller requests files.
    for (const id of ids) { const value = await get(id, options); if (value) values.push({ id, value }); }
    return values;
  }
  async function retire({ createRequestIds = [], cardIds = [] }) {
    await transaction('readwrite', (store, done, guard) => {
      store.get(retiredKey).onsuccess = guard(event => {
        const old = event.target.result ?? {}, retired = { createRequestIds: [...new Set([...(old.createRequestIds ?? []), ...createRequestIds])],
          cardIds: [...new Set([...(old.cardIds ?? []), ...cardIds])] };
        store.put(retired, retiredKey);
        store.getAllKeys().onsuccess = guard(keys => {
          for (const key of keys.target.result) {
            if (typeof key !== 'string' || !key.startsWith(prefix) || key.startsWith(bytesPrefix) || key === retiredKey) continue;
            const id = key.startsWith(metadataPrefix) ? key.slice(metadataPrefix.length) : key.slice(prefix.length);
            store.get(key).onsuccess = guard(value => {
              if (deleted(value.target.result, retired)) { store.delete(prefix + id); store.delete(metadataPrefix + id); store.delete(bytesPrefix + id); }
            });
          }
        });
      });
    });
    cache.clear();
  }
  return Object.freeze({ get, put, remove, list, retire, close: async () => { cache.clear(); (await opened).close(); } });
}
