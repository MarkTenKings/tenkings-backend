const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (ok, code) => { if (!ok) fail(code); };
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value ?? '');
const hex = value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');

export function createBrowserIntakeJournal({ accountId, draftId, indexedDB = globalThis.indexedDB }) {
  check(uuid(accountId) && uuid(draftId) && indexedDB, 'BROWSER_SAVE_UNAVAILABLE');
  const key = `${accountId}:${draftId}`, metadataKey = `${key}:bytes-v1`;
  // New photo keys are immutable until verified completion releases them.
  // Progress reads therefore need only metadata once each Blob is decoded.
  const decodedPhotos = new Map();
  const opened = new Promise((resolve, reject) => {
    const request = indexedDB.open('atlas-customer-originals-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pairs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(photoStorageError(request.error, 'BROWSER_SAVE_UNAVAILABLE'));
  });
  async function transact(mode, operation) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pairs', mode); let value, failure;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(failure ?? photoStorageError(tx.error, 'BROWSER_SAVE_UNAVAILABLE'));
      const store = tx.objectStore('pairs');
      const get = (id, next) => { store.get(id).onsuccess = event => { try { next(event.target.result); } catch (error) { failure = error; tx.abort(); } }; };
      try { operation(store, result => { value = result; }, get); } catch (error) { failure = error; tx.abort(); }
    });
  }
  const readRaw = () => transact('readonly', (_store, done, get) => get(metadataKey, metadata => {
    if (metadata) done({ metadata, legacy: null });
    else get(key, legacy => done({ metadata, legacy }));
  }));
  const legacyRefs = item => item?.files ? Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { legacy: item.requestId, side }])) : null;
  return {
    async get() {
      return transact('readonly', (_store, done, get) => get(metadataKey, metadata => {
        if (!metadata) { decodedPhotos.clear(); get(key, legacy => done(legacy ?? null)); return; }
        const retained = new Set(metadata.items.flatMap(item => Object.values(item.photoRefs ?? {}).map(ref => ref.key).filter(Boolean)));
        for (const photoKey of decodedPhotos.keys()) if (!retained.has(photoKey)) decodedPhotos.delete(photoKey);
        function restore(legacy) {
          const restored = { version: 1, items: metadata.items.map(item => ({ ...item, files: null })) };
          let pending = 1;
          const finish = () => { if (--pending === 0) done(restored); };
          restored.items.forEach(item => {
            if (!item.photoRefs) return;
            item.files = {};
            for (const side of ['FRONT', 'BACK']) {
              const ref = item.photoRefs[side];
              if (ref?.legacy) {
                const old = legacy?.items.find(entry => entry.requestId === ref.legacy);
                check(old?.files?.[side] instanceof Blob, 'BROWSER_SAVE_UNAVAILABLE'); item.files[side] = old.files[side];
              } else {
                check(typeof ref?.key === 'string' && ref.key.startsWith(`${key}:photo:`), 'BROWSER_SAVE_UNAVAILABLE');
                const cached = decodedPhotos.get(ref.key);
                if (cached) item.files[side] = cached;
                else {
                  pending++; get(ref.key, photo => {
                    check(photo, 'BROWSER_SAVE_UNAVAILABLE');
                    const decoded = decodePhoto(photo); decodedPhotos.set(ref.key, decoded); item.files[side] = decoded; finish();
                  });
                }
              }
            }
          });
          finish();
        }
        // Preserve old rows without repeatedly loading them for byte-only carts.
        const needsLegacy = metadata.items.some(item => Object.values(item.photoRefs ?? {}).some(ref => ref.legacy));
        if (needsLegacy) get(key, restore); else restore(null);
      }));
    },
    async put(value) {
      check(value?.version === 1 && Array.isArray(value.items), 'BROWSER_SAVE_UNAVAILABLE');
      const { metadata, legacy } = await readRaw(), writes = [], releases = [];
      const previous = new Map((metadata?.items ?? legacy?.items ?? []).map(item => [item.requestId, item]));
      const items = [];
      for (const item of value.items) {
        check(uuid(item.requestId), 'BROWSER_SAVE_UNAVAILABLE');
        const old = previous.get(item.requestId), priorRefs = old?.photoRefs ?? legacyRefs(old);
        const saved = { ...item, files: null, photoRefs: null };
        if (item.files) {
          saved.photoRefs = {};
          for (const side of ['FRONT', 'BACK']) {
            const ref = priorRefs?.[side];
            // A legacy Blob may already be unreadable. Preserve its old row and
            // reference without forcing other cards to read or rewrite it.
            if (ref) saved.photoRefs[side] = ref;
            else {
              const photo = await encodePhoto(item.files[side]);
              const photoKey = `${key}:photo:${item.requestId}:${side}`;
              saved.photoRefs[side] = { key: photoKey }; writes.push([photoKey, photo]);
            }
          }
        } else if (item.done) {
          for (const ref of Object.values(priorRefs ?? {})) if (ref.key) releases.push(ref.key);
        }
        items.push(saved);
      }
      const revision = metadata?.revision ?? 0;
      await transact('readwrite', (store, _done, get) => get(metadataKey, current => {
        check((current?.revision ?? 0) === revision, 'BROWSER_SAVE_UNAVAILABLE');
        for (const [id, photo] of writes) store.put(photo, id);
        store.put({ version: 1, revision: revision + 1, items }, metadataKey);
        for (const id of releases) store.delete(id);
      }));
      const retained = new Set(items.flatMap(item => Object.values(item.photoRefs ?? {}).map(ref => ref.key).filter(Boolean)));
      for (const photoKey of decodedPhotos.keys()) if (!retained.has(photoKey)) decodedPhotos.delete(photoKey);
    },
    close: async () => { decodedPhotos.clear(); (await opened).close(); },
  };
}

/** Exact originals and stable operation IDs commit before any network work.
 * Progress merges into the latest saved roster so a slow upload cannot erase a
 * pair added while it was running. A failed pair does not stop later pairs. */
export function createCustomerUploader({ draftId, journal, request, put = putOriginal, cryptoImpl = globalThis.crypto, onProgress = () => {}, onSaved = () => {} }) {
  check(uuid(draftId), 'INVALID_INTAKE');
  let tail = Promise.resolve(), running = null, disposed = false, requested = false;
  const serial = operation => { const result = tail.then(operation); tail = result.catch(() => {}); return result; };
  const read = () => serial(() => journal.get());
  const publish = value => { if (!disposed) onProgress(structuredClone(value)); };
  const save = item => serial(async () => {
    const value = await journal.get(); check(value?.version === 1, 'BROWSER_SAVE_UNAVAILABLE');
    const index = value.items.findIndex(entry => entry.requestId === item.requestId); check(index >= 0, 'BROWSER_SAVE_UNAVAILABLE');
    value.items[index] = structuredClone(item); await journal.put(value); publish(value);
  });
  async function process(item) {
    try {
      item.error = null;
      if (!item.input) {
        const input = { requestId: item.requestId, cardId: item.cardId, pairId: item.pairId };
        for (const side of ['FRONT', 'BACK']) input[side.toLowerCase()] = { uploadId: item.uploadIds[side], sha256: hex(await cryptoImpl.subtle.digest('SHA-256', await readNativePhotoBytes(item.files[side]))),
          byteCount: item.files[side].size, fileName: (item.files[side].name ?? '').slice(0, 240) };
        check(input.front.sha256 !== input.back.sha256, 'DISTINCT_CARD_SIDES_REQUIRED'); item.input = input; await save(item);
      }
      if (disposed) return;
      await request(`/intake/drafts/${draftId}/cards`, { body: item.input });
      for (const side of ['FRONT', 'BACK']) {
        if (disposed) return;
        if (item.verified[side]) continue;
        const path = `/intake/drafts/${draftId}/cards/${item.cardId}/uploads/${item.uploadIds[side]}`;
        const signed = await request(`${path}/sign`, { body: {} });
        if (signed.state !== 'VERIFIED') {
          check(signed.state === 'UPLOAD' && signed.method === 'PUT' && typeof signed.url === 'string' && new URL(signed.url).protocol === 'https:', 'UPLOAD_REPLY_INVALID');
          const bytes = await readNativePhotoBytes(item.files[side]), expected = item.input[side.toLowerCase()];
          check(bytes.byteLength === expected.byteCount && hex(await cryptoImpl.subtle.digest('SHA-256', bytes)) === expected.sha256, 'INTAKE_PENDING_BYTES_CONFLICT');
          // Conditional PUT on the same key is safe after a lost reply. A 412
          // is verified by the server before this side is considered complete.
          await put(signed, new Blob([bytes], { type: item.files[side].type }));
        }
        const result = await request(`${path}/complete`, { body: {} });
        check(result.draft?.cards?.find(card => card.id === item.cardId)?.uploads?.[side]?.state === 'VERIFIED', 'UPLOAD_REPLY_INVALID');
        item.verified[side] = true; await save(item); if (!disposed) onSaved(result.draft);
      }
      item.done = true; item.files = null; await save(item);
    } catch (error) { item.error = error?.code ?? 'UPLOAD_INTERRUPTED'; await save(item); }
  }
  function kick(retry = false) {
    requested = true;
    if (running || disposed) return running ?? Promise.resolve();
    running = (async () => {
      const attempted = new Set();
      do {
        requested = false;
        while (!disposed) {
          const saved = await read(); const item = saved?.items.find(entry => !entry.done && !attempted.has(entry.requestId) && (retry || !entry.error));
          if (!item) break; attempted.add(item.requestId); await process(structuredClone(item));
        }
      } while (requested && !disposed);
    })().finally(() => { running = null; });
    running.catch(() => {}); return running;
  }
  return {
    async appendPair(front, back, retained = null) {
      check(!disposed, 'UPLOAD_INTERRUPTED');
      for (const file of [front, back]) check(file instanceof Blob && file.size > 0 && file.size <= 64 * 1024 * 1024, 'PHOTO_SIZE_INVALID');
      const result = await serial(async () => {
        const value = await journal.get() ?? { version: 1, items: [] }; check(value.version === 1, 'BROWSER_SAVE_UNAVAILABLE');
        if (retained) {
          check([retained.requestId, retained.cardId, retained.pairId, retained.uploadIds?.FRONT, retained.uploadIds?.BACK].every(uuid), 'INVALID_CAPTURE_IDENTITY');
          const previous = value.items.find(item => item.requestId === retained.requestId);
          if (previous) { check(previous.cardId === retained.cardId && previous.pairId === retained.pairId && previous.uploadIds.FRONT === retained.uploadIds.FRONT && previous.uploadIds.BACK === retained.uploadIds.BACK, 'CAPTURE_IDENTITY_CONFLICT'); return value; }
        }
        check(value.items.filter(item => !item.cancelled).length < 100, 'INTAKE_CARD_LIMIT');
        value.items.push({ requestId: cryptoImpl.randomUUID(), cardId: cryptoImpl.randomUUID(), pairId: cryptoImpl.randomUUID(), uploadIds: { FRONT: cryptoImpl.randomUUID(), BACK: cryptoImpl.randomUUID() },
          ...(retained ? { requestId: retained.requestId, cardId: retained.cardId, pairId: retained.pairId, uploadIds: { ...retained.uploadIds } } : {}),
          files: { FRONT: front, BACK: back }, verified: { FRONT: false, BACK: false }, input: null, done: false, error: null });
        await journal.put(value); publish(value); return value;
      });
      kick(); return result;
    },
    async resume() { const value = await read(); if (value) publish(value); return kick(true); },
    async discardUnsent(requestId) {
      return serial(async () => {
        const value = await journal.get(), item = value?.items.find(entry => entry.requestId === requestId);
        // Only the deterministic local duplicate-side refusal has no possible
        // server effect. Preserve every started/uncertain request for recovery.
        check(item && !item.input && item.error === 'DISTINCT_CARD_SIDES_REQUIRED', 'INTAKE_REQUEST_ALREADY_STARTED');
        item.cancelled = true; item.done = true; item.files = null; item.error = null;
        await journal.put(value); publish(value);
      });
    },
    pending: read,
    whenIdle: async () => { await running; await tail; },
    dispose: () => { disposed = true; },
  };
}

async function putOriginal(signed, file) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: file, credentials: 'omit', redirect: 'error', signal: controller.signal });
    if (!response.ok && response.status !== 412) fail('UPLOAD_INTERRUPTED');
  } catch { fail('UPLOAD_INTERRUPTED'); } finally { clearTimeout(timer); }
}
import { encodePhoto, decodePhoto, readNativePhotoBytes, photoStorageError } from '../../../packages/atlas-manual-intake/src/photo-bytes.mjs';
