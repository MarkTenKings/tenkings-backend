const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (ok, code) => { if (!ok) fail(code); };
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value ?? '');
const hex = value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');

export function createBrowserIntakeJournal({ accountId, draftId, indexedDB = globalThis.indexedDB }) {
  check(uuid(accountId) && uuid(draftId) && indexedDB, 'BROWSER_SAVE_UNAVAILABLE');
  const key = `${accountId}:${draftId}`;
  const opened = new Promise((resolve, reject) => {
    const request = indexedDB.open('atlas-customer-originals-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pairs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Object.assign(new Error('BROWSER_SAVE_UNAVAILABLE'), { code: 'BROWSER_SAVE_UNAVAILABLE' }));
  });
  async function transact(mode, operation) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pairs', mode); let value;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(Object.assign(new Error('BROWSER_SAVE_UNAVAILABLE'), { code: 'BROWSER_SAVE_UNAVAILABLE' }));
      operation(tx.objectStore('pairs'), result => { value = result; });
    });
  }
  return { get: () => transact('readonly', (store, done) => { store.get(key).onsuccess = event => done(event.target.result ?? null); }),
    put: value => transact('readwrite', store => store.put(value, key)), close: async () => (await opened).close() };
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
        for (const side of ['FRONT', 'BACK']) input[side.toLowerCase()] = { uploadId: item.uploadIds[side], sha256: hex(await cryptoImpl.subtle.digest('SHA-256', await item.files[side].arrayBuffer())),
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
          // Conditional PUT on the same key is safe after a lost reply. A 412
          // is verified by the server before this side is considered complete.
          await put(signed, item.files[side]);
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
