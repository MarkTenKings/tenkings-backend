const BASE = '/api/staff/manual-intake/cards';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (ok, code) => { if (!ok) fail(code); };
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');

/** File order is never card-pair authority. Explicit matching stems and side
 * suffixes are required; the UI displays every pair before its single import. */
export function pairBatchPhotos(files) {
  check(files?.length > 0 && files.length <= 100, 'BATCH_IMPORT_COUNT');
  const pairs = new Map();
  for (const file of files) {
    const match = /^(.+?)[ _.-](front|back)\.(jpe?g|png|heic|heif|webp)$/i.exec(file.name ?? '');
    check(match && file instanceof Blob && file.size > 0 && file.size <= 64 * 1024 * 1024, 'BATCH_IMPORT_PAIR_NAMES');
    const label = match[1].trim(), key = label.toLocaleLowerCase('en-US'), side = match[2].toUpperCase();
    check(label.length > 0 && label.length <= 120, 'BATCH_IMPORT_PAIR_NAMES');
    const pair = pairs.get(key) ?? { key, label, files: {} };
    check(!pair.files[side], 'BATCH_IMPORT_DUPLICATE_SIDE'); pair.files[side] = file; pairs.set(key, pair);
  }
  check([...pairs.values()].every(pair => pair.files.FRONT && pair.files.BACK), 'BATCH_IMPORT_MISSING_SIDE');
  return [...pairs.values()];
}

export function createBrowserBatchImportJournal({ staffId, indexedDB = globalThis.indexedDB }) {
  check(typeof staffId === 'string' && /^[a-f0-9-]{36}$/.test(staffId) && indexedDB, 'BATCH_IMPORT_STORAGE');
  const opened = new Promise((resolve, reject) => {
    const request = indexedDB.open('atlas-batch-originals-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('imports');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(Object.assign(new Error('BATCH_IMPORT_STORAGE'), { code: 'BATCH_IMPORT_STORAGE' }));
  });
  async function transaction(mode, operation) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('imports', mode), store = tx.objectStore('imports'); let value;
      tx.oncomplete = () => resolve(value); tx.onerror = tx.onabort = () => reject(Object.assign(new Error('BATCH_IMPORT_STORAGE'), { code: 'BATCH_IMPORT_STORAGE' }));
      operation(store, result => { value = result; });
    });
  }
  return {
    get: () => transaction('readonly', (store, done) => { store.get(staffId).onsuccess = event => done(event.target.result ?? null); }),
    put: value => transaction('readwrite', store => store.put(value, staffId)),
    remove: () => transaction('readwrite', store => store.delete(staffId)),
    close: async () => (await opened).close(),
  };
}

export function createBatchImporter({ request, intake, journal, cryptoImpl = globalThis.crypto, onProgress = () => {} }) {
  let running = false, disposed = false, drained = Promise.resolve(), finish = null;
  const post = (path, body) => request(path, { method: 'POST', body });
  async function save(value) { await journal.put(value); if (!disposed) onProgress(structuredClone(value)); }
  return Object.freeze({
    async stage(files) {
      check(!running && !disposed, 'BATCH_IMPORT_BUSY');
      const old = await journal.get(); check(!old || old.items.every(item => item.done), 'BATCH_IMPORT_PENDING');
      const items = pairBatchPhotos(files).map(pair => ({ ...pair, createId: cryptoImpl.randomUUID(), enqueueId: cryptoImpl.randomUUID(),
        cardId: null, started: false, hashes: {}, done: false, code: null }));
      const value = { version: 1, id: cryptoImpl.randomUUID(), items };
      // Persist all original Blobs before any card or upload request is sent.
      await save(value); return value;
    },
    read: () => journal.get(),
    async clearSelection() {
      check(!running && !disposed, 'BATCH_IMPORT_BUSY');
      const old = await journal.get(); check(!old || old.items.every(item => !item.started), 'BATCH_IMPORT_PENDING');
      await journal.remove(); onProgress(null);
    },
    async run() {
      check(!running && !disposed, 'BATCH_IMPORT_BUSY'); running = true; drained = new Promise(resolve => { finish = resolve; });
      try {
        const batch = await journal.get(); check(batch?.version === 1, 'BATCH_IMPORT_MISSING');
        for (const item of batch.items) {
          if (item.done || disposed) continue;
          item.code = null;
          try {
            if (!item.cardId) {
              item.started = true; await save(batch);
              const created = await post(BASE, { requestId: item.createId, label: item.label });
              check(created.card?.cardId, 'BATCH_IMPORT_CREATE_UNCERTAIN'); item.cardId = created.card.cardId; await save(batch);
            }
            for (const side of ['FRONT', 'BACK']) {
              if (!item.hashes[side]) item.hashes[side] = hex(await cryptoImpl.subtle.digest('SHA-256', await item.files[side].arrayBuffer()));
            }
            await save(batch);
            const outcomes = await Promise.allSettled(['FRONT', 'BACK'].map(async side => {
              if (disposed) return;
              const pending = (await intake.pending()).filter(entry => entry.value.kind === 'upload' && entry.value.cardId === item.cardId && entry.value.input.side === side);
              check(pending.length <= 1, 'BATCH_IMPORT_UPLOAD_CONFLICT');
              if (pending.length) {
                check(pending[0].value.input.sha256 === item.hashes[side], 'BATCH_IMPORT_UPLOAD_CONFLICT');
                await intake.resume(pending[0].id); return;
              }
              const current = await intake.read(item.cardId), slot = current.card.sides[side];
              if (slot.upload) {
                check(slot.upload.plan.expected.sha256 === item.hashes[side], 'BATCH_IMPORT_UPLOAD_CONFLICT');
                if (slot.upload.source) return;
                await intake.prepareSaved(item.cardId, slot.upload.uploadId); return;
              }
              await intake.upload(item.cardId, side, slot.version, item.files[side]);
            }));
            const failed = outcomes.find(outcome => outcome.status === 'rejected'); if (failed) throw failed.reason;
            if (disposed) continue;
            const { card } = await intake.read(item.cardId);
            check(card.ready && ['FRONT', 'BACK'].every(side => card.sides[side].upload?.plan.expected.sha256 === item.hashes[side]), 'BATCH_IMPORT_UPLOAD_CONFLICT');
            await post('/api/staff/manual-connected/cards/batch', { actionId: item.enqueueId, cards: [{ cardId: item.cardId, sourceHash: card.sourceHash }] });
            item.done = true; item.files = null; await save(batch);
          } catch (error) {
            item.code = /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'BATCH_IMPORT_INTERRUPTED';
            await save(batch);
            if ([401, 403].includes(error?.status)) break;
          }
        }
        return batch;
      } finally { running = false; finish?.(); finish = null; }
    },
    dispose() { disposed = true; return drained; },
  });
}
