const check = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value ?? '');
const photo = file => check(file instanceof Blob && file.size > 0 && file.size <= 64 * 1024 * 1024, 'PHOTO_SIZE_INVALID');

/** Account-scoped, per-pair original storage. Capturing a new card never rewrites
 * earlier image blobs and never waits for a server or an identification result. */
export function createCaptureBuffer({ accountId, indexedDB = globalThis.indexedDB, cryptoImpl = globalThis.crypto }) {
  check(uuid(accountId) && indexedDB && cryptoImpl, 'BROWSER_SAVE_UNAVAILABLE');
  const prefix = `${accountId}:`, metaKey = `${prefix}meta`, frontKey = `${prefix}front`;
  // Pair IDs own immutable originals. Reuse their decoded Blobs within this
  // journal instance; still read each stored pair to observe uploaded state.
  const decodedPairs = new Map();
  const opened = new Promise((resolve, reject) => {
    const request = indexedDB.open('atlas-customer-capture-v2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('capture');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(photoStorageError(request.error, 'BROWSER_SAVE_UNAVAILABLE'));
  });
  const empty = () => ({ version: 2, pairIds: [], draftId: null, createRequest: null, service: null });
  async function transaction(mode, operation) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('capture', mode); let output, failure;
      tx.oncomplete = () => resolve(output);
      tx.onabort = tx.onerror = () => reject(failure ?? photoStorageError(tx.error, 'BROWSER_SAVE_UNAVAILABLE'));
      const store = tx.objectStore('capture');
      const get = (key, next) => { store.get(key).onsuccess = event => { try { next(event.target.result); } catch (error) { failure = error; tx.abort(); } }; };
      operation({ store, get, done: value => { output = value; } });
    });
  }
  async function snapshot() {
    return transaction('readonly', ({ get, done }) => get(metaKey, value => {
      const meta = value ?? empty();
      const retained = new Set(meta.pairIds);
      for (const id of decodedPairs.keys()) if (!retained.has(id)) decodedPairs.delete(id);
      get(frontKey, front => {
        const pairs = []; let pending = meta.pairIds.length;
        const restoredFront = front ? decodePhoto(front) : null;
        if (!pending) return done({ ...meta, front: restoredFront, pairs });
        meta.pairIds.forEach((id, index) => get(`${prefix}pair:${id}`, pair => {
          check(pair, 'BROWSER_SAVE_UNAVAILABLE');
          let files = null;
          if (pair.files) {
            files = decodedPairs.get(id);
            if (!files) { files = Object.freeze({ FRONT: decodePhoto(pair.files.FRONT), BACK: decodePhoto(pair.files.BACK) }); decodedPairs.set(id, files); }
          } else decodedPairs.delete(id);
          pairs[index] = { ...pair, files };
          if (--pending === 0) done({ ...meta, front: restoredFront, pairs });
        }));
      });
    }));
  }
  return {
    snapshot,
    async setService(service) {
      check(service && ['MAIL_IN', 'DEALER_DROP_OFF'].includes(service.intakeMethod), 'INVALID_SERVICE');
      await transaction('readwrite', ({ store, get }) => get(metaKey, value => {
        const meta = value ?? empty();
        check(!meta.draftId || (meta.service?.intakeMethod === service.intakeMethod && meta.service?.kioskId === service.kioskId), 'SAVED_SERVICE_LOCKED');
        if (meta.service?.intakeMethod !== service.intakeMethod || meta.service?.kioskId !== service.kioskId) meta.createRequest = null;
        meta.service = service; store.put(meta, metaKey);
      })); return snapshot();
    },
    async capture(side, file) {
      photo(file); check(['FRONT', 'BACK'].includes(side), 'INVALID_SIDE');
      // Materialize exact original bytes before opening the transaction. Safari
      // must not depend on an IndexedDB file-backed Blob to read this photo later.
      const encoded = await encodePhoto(file);
      await transaction('readwrite', ({ store, get }) => get(metaKey, value => {
        const meta = value ?? empty(); check(meta.pairIds.length < 100, 'INTAKE_CARD_LIMIT');
        get(frontKey, front => {
          if (side === 'FRONT') { check(!front, 'FRONT_ALREADY_SAVED'); store.put(encoded, frontKey); }
          else {
            check(front && decodePhoto(front) instanceof Blob, 'FRONT_REQUIRED');
            const requestId = cryptoImpl.randomUUID(), pair = { requestId, cardId: cryptoImpl.randomUUID(), pairId: cryptoImpl.randomUUID(), uploadIds: { FRONT: cryptoImpl.randomUUID(), BACK: cryptoImpl.randomUUID() }, files: { FRONT: front, BACK: encoded }, uploaded: false };
            store.put(pair, `${prefix}pair:${requestId}`); meta.pairIds.push(requestId); store.put(meta, metaKey); store.delete(frontKey);
          }
        });
      })); return snapshot();
    },
    async discardFront() {
      await transaction('readwrite', ({ store }) => store.delete(frontKey)); return snapshot();
    },
    async discardUnsentPair(requestId) {
      await transaction('readwrite', ({ store, get }) => get(metaKey, meta => get(`${prefix}pair:${requestId}`, pair => {
        check(meta && pair && !pair.uploaded, 'CAPTURE_ALREADY_UPLOADED');
        meta.pairIds = meta.pairIds.filter(id => id !== requestId); store.put(meta, metaKey); store.delete(`${prefix}pair:${requestId}`);
      }))); decodedPairs.delete(requestId); return snapshot();
    },
    async creation() {
      return transaction('readwrite', ({ store, get, done }) => get(metaKey, value => {
        const meta = value ?? empty(); check(meta.service, 'INVALID_SERVICE');
        meta.createRequest ??= { requestId: cryptoImpl.randomUUID(), ...meta.service };
        store.put(meta, metaKey); done(meta.createRequest);
      }));
    },
    async attachDraft(draftId) {
      check(uuid(draftId), 'INVALID_INTAKE');
      await transaction('readwrite', ({ store, get }) => get(metaKey, value => { const meta = value ?? empty(); check(!meta.draftId || meta.draftId === draftId, 'DRAFT_MISMATCH'); meta.draftId = draftId; store.put(meta, metaKey); })); return snapshot();
    },
    async uploaded(requestId) {
      await transaction('readwrite', ({ store, get }) => get(`${prefix}pair:${requestId}`, pair => { if (pair && !pair.uploaded) { pair.uploaded = true; pair.files = null; store.put(pair, `${prefix}pair:${requestId}`); } }));
      decodedPairs.delete(requestId);
    },
    async clearPaid() {
      await transaction('readwrite', ({ store, get }) => get(metaKey, meta => { for (const id of meta?.pairIds ?? []) store.delete(`${prefix}pair:${id}`); store.delete(frontKey); store.delete(metaKey); }));
      decodedPairs.clear();
    },
    close: async () => { decodedPairs.clear(); (await opened).close(); },
  };
}
import { encodePhoto, decodePhoto, photoStorageError } from '../../../packages/atlas-manual-intake/src/photo-bytes.mjs';
