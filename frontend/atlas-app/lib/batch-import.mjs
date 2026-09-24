const BASE = '/api/staff/manual-intake/cards';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (ok, code) => { if (!ok) fail(code); };
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
const phases = new Set(['SAVE_CARD_INTENT','CREATE_CARD','SAVE_CARD_ID','READ_FRONT_BYTES','READ_BACK_BYTES','HASH_FRONT_BYTES','HASH_BACK_BYTES','SAVE_HASHES','READ_FRONT_JOURNAL','READ_BACK_JOURNAL','READ_FRONT_CARD','READ_BACK_CARD','RESUME_FRONT_UPLOAD','RESUME_BACK_UPLOAD','PREPARE_FRONT_UPLOAD','PREPARE_BACK_UPLOAD','UPLOAD_FRONT','UPLOAD_BACK','VERIFY_PAIR','ENQUEUE_CARD','SAVE_QUEUE']);
const exceptionNames = new Set(['Error','TypeError','RangeError','AbortError','DataCloneError','InvalidStateError','NotReadableError','NotSupportedError','OperationError','QuotaExceededError','SecurityError','TimeoutError','TransactionInactiveError','UnknownError']);
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(value) ? value : 'BATCH_IMPORT_INTERRUPTED';
const safeId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value) ? value : null;
const storageFailure = cause => Object.assign(new Error('BATCH_IMPORT_STORAGE'), { code: 'BATCH_IMPORT_STORAGE', name: exceptionNames.has(cause?.name) ? cause.name : 'Error' });
export function batchImportFailureDetails(item) {
  if (!item?.code) return null;
  return { code: safeCode(item.code), phase: phases.has(item.failure?.phase) ? item.failure.phase : 'UNKNOWN',
    exceptionName: exceptionNames.has(item.failure?.exceptionName) ? item.failure.exceptionName : 'Error' };
}
/** Deliberately excludes photo bytes, filenames, hashes, labels, staff/session
 * authority and raw exception messages. IDs are exact operation correlation. */
export function batchImportDiagnostics(batch) {
  const side = (item, name) => ({ saved: item.files?.[name] instanceof Blob,
    bytes: item.files?.[name] instanceof Blob ? item.files[name].size : null, hashSaved: /^[a-f0-9]{64}$/.test(item.hashes?.[name] ?? '') });
  return { version: 1, items: (batch?.items ?? []).map((item, index) => ({ ordinal: index + 1,
    createId: safeId(item.createId), enqueueId: safeId(item.enqueueId), cardId: safeId(item.cardId), done: item.done === true,
    failure: batchImportFailureDetails(item), sides: { FRONT: side(item, 'FRONT'), BACK: side(item, 'BACK') } })),
    partialPair: { FRONT: batch?.draft?.files?.FRONT instanceof Blob, BACK: batch?.draft?.files?.BACK instanceof Blob } };
}

/** Named import is optional. This path still requires explicit matching stems. */
export function pairBatchPhotos(files) {
  check(files?.length > 0 && files.length <= 200, 'BATCH_IMPORT_COUNT');
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

/** The UI shows and permits reordering these pairs before the human confirms
 * them. Browser file order alone is never silently accepted as card authority. */
export function previewOrderedBatchPhotos(files) {
  check(files?.length > 0 && files.length <= 200 && files.length % 2 === 0, 'BATCH_IMPORT_ORDER_COUNT');
  files.forEach(value => check(value instanceof Blob && value.size > 0 && value.size <= 64 * 1024 * 1024, 'BATCH_IMPORT_PAIR_FILES'));
  return Array.from({ length: files.length / 2 }, (_, index) => ({ label: `Card ${index + 1}`, files: { FRONT: files[index * 2], BACK: files[index * 2 + 1] } }));
}

export function createBrowserBatchImportJournal({ staffId, indexedDB = globalThis.indexedDB }) {
  check(typeof staffId === 'string' && /^[a-f0-9-]{36}$/.test(staffId) && indexedDB, 'BATCH_IMPORT_STORAGE');
  const opened = new Promise((resolve, reject) => {
    const request = indexedDB.open('atlas-batch-originals-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('imports');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(storageFailure(request.error));
  });
  async function transaction(mode, operation) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('imports', mode), store = tx.objectStore('imports'); let value;
      tx.oncomplete = () => resolve(value); tx.onerror = tx.onabort = event => reject(storageFailure(event.target.error ?? tx.error));
      try { operation(store, result => { value = result; }); }
      catch (error) { tx.abort(); reject(storageFailure(error)); }
    });
  }
  return {
    get: () => transaction('readonly', (store, done) => { store.get(staffId).onsuccess = event => done(event.target.result ?? null); }),
    put: value => transaction('readwrite', store => store.put(value, staffId)),
    remove: () => transaction('readwrite', store => store.delete(staffId)),
    close: async () => (await opened).close(),
  };
}

export function createBatchImporter({ request, intake, journal, cryptoImpl = globalThis.crypto, onProgress = () => {}, onQueued = () => {},
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let running = false, disposed = false, drained = Promise.resolve(), journalTail = Promise.resolve(), requested = false, authBlocked = false;
  const post = (path, body) => request(path, { method: 'POST', body });
  // Every append and progress write reads the newest journal inside this queue.
  // In particular, a slow upload may never overwrite a newly appended pair.
  const serial = operation => {
    const result = journalTail.then(operation);
    journalTail = result.catch(() => {}); return result;
  };
  const notify = value => { if (!disposed) { try { onProgress(structuredClone(value)); } catch { /* UI callbacks do not change persisted intent. */ } } };
  async function write(value) { await journal.put(value); notify(value); return structuredClone(value); }
  const read = () => serial(() => journal.get());
  const makeItem = pair => ({ ...pair, createId: cryptoImpl.randomUUID(), enqueueId: cryptoImpl.randomUUID(),
    cardId: null, started: false, hashes: {}, done: false, code: null });
  const saveItem = item => serial(async () => {
    const batch = await journal.get();
    check(batch?.version === 1, 'BATCH_IMPORT_MISSING');
    const index = batch.items.findIndex(value => value.createId === item.createId);
    check(index >= 0, 'BATCH_IMPORT_MISSING'); batch.items[index] = structuredClone(item); await write(batch);
  });
  async function processItem(item) {
    item.code = null; item.failure = null;
    const step = async (phase, operation) => {
      try { return await operation(); }
      catch (error) { throw Object.assign(new Error('Saved upload step did not finish'), { code: safeCode(error?.code), status: error?.status,
        diagnostic: { phase, exceptionName: exceptionNames.has(error?.name) ? error.name : 'Error' } }); }
    };
    try {
      if (!item.cardId) {
        item.started = true; await step('SAVE_CARD_INTENT', () => saveItem(item));
        if (disposed) return;
        const created = await step('CREATE_CARD', async () => { const result = await post(BASE, { requestId: item.createId, label: item.label }); check(result.card?.cardId, 'BATCH_IMPORT_CREATE_UNCERTAIN'); return result; });
        item.cardId = created.card.cardId; await step('SAVE_CARD_ID', () => saveItem(item));
      }
      for (const side of ['FRONT', 'BACK']) {
        if (!item.hashes[side]) {
          const bytes = await step(`READ_${side}_BYTES`, () => item.files[side].arrayBuffer());
          item.hashes[side] = await step(`HASH_${side}_BYTES`, async () => hex(await cryptoImpl.subtle.digest('SHA-256', bytes)));
        }
      }
      await step('SAVE_HASHES', () => saveItem(item));
      const prepareSide = async side => {
        if (disposed) return;
        const pending = await step(`READ_${side}_JOURNAL`, async () => (await intake.pending()).filter(entry => entry.value.kind === 'upload' && entry.value.cardId === item.cardId && entry.value.input.side === side));
        check(pending.length <= 1, 'BATCH_IMPORT_UPLOAD_CONFLICT');
        if (pending.length) {
          check(pending[0].value.input.sha256 === item.hashes[side], 'BATCH_IMPORT_UPLOAD_CONFLICT');
          await step(`RESUME_${side}_UPLOAD`, () => intake.resume(pending[0].id)); return;
        }
        const slot = await step(`READ_${side}_CARD`, async () => (await intake.read(item.cardId)).card.sides[side]);
        if (slot.upload) {
          check(slot.upload.plan.expected.sha256 === item.hashes[side], 'BATCH_IMPORT_UPLOAD_CONFLICT');
          if (slot.upload.source) return;
          await step(`PREPARE_${side}_UPLOAD`, () => intake.prepareSaved(item.cardId, slot.upload.uploadId)); return;
        }
        await step(`UPLOAD_${side}`, () => intake.upload(item.cardId, side, slot.version, item.files[side]));
      };
      const outcomes = await Promise.allSettled(['FRONT', 'BACK'].map(async side => {
        for (let attempt = 0; attempt < 30; attempt++) {
          if (disposed) return;
          try { return await prepareSide(side); }
          catch (error) {
            // This explicit refusal occurs before work. Other uncertainty is
            // retained for exact-intent recovery, never retried by new intake.
            if (error?.code !== 'MANUAL_PROCESSING_BUSY' || attempt === 29 || disposed) throw error;
            item.code = 'MANUAL_PROCESSING_BUSY'; await saveItem(item); await pause(3000);
          }
        }
      }));
      const failed = outcomes.find(outcome => outcome.status === 'rejected'); if (failed) throw failed.reason;
      if (disposed) return;
      const { card } = await step('VERIFY_PAIR', async () => { const result = await intake.read(item.cardId); check(result.card.ready && ['FRONT', 'BACK'].every(side => result.card.sides[side].upload?.plan.expected.sha256 === item.hashes[side]), 'BATCH_IMPORT_UPLOAD_CONFLICT'); return result; });
      await step('ENQUEUE_CARD', () => post('/api/staff/manual-connected/cards/batch', { actionId: item.enqueueId, cards: [{ cardId: item.cardId, sourceHash: card.sourceHash }] }));
      item.done = true; item.files = null; item.code = null; item.failure = null; await step('SAVE_QUEUE', () => saveItem(item));
      if (!disposed) { try { onQueued({ cardId: item.cardId, createId: item.createId, enqueueId: item.enqueueId, label: item.label }); } catch { /* Queue confirmation is already durable. */ } }
    } catch (error) {
      item.code = safeCode(error?.code); item.failure = error?.diagnostic ?? { phase: 'UNKNOWN', exceptionName: exceptionNames.has(error?.name) ? error.name : 'Error' };
      await saveItem(item);
      if ([401, 403].includes(error?.status)) authBlocked = true;
    }
  }
  function kick(retry = false) {
    if (disposed || authBlocked) return drained;
    requested = true;
    if (running) return drained;
    running = true;
    drained = (async () => {
      const attempted = new Set(); let latest;
      try {
      do {
        requested = false;
        while (!disposed && !authBlocked) {
          const batch = await read(); check(batch?.version === 1, 'BATCH_IMPORT_MISSING'); latest = batch;
          const item = batch.items.find(value => !value.done && !attempted.has(value.createId) && (retry || !value.code));
          if (!item) break;
          attempted.add(item.createId); await processItem(item);
        }
      } while (requested && !disposed && !authBlocked);
      return latest;
      } finally { running = false; }
    })();
    // Background failures remain observable through whenIdle()/run(), without
    // creating an unhandled rejection when the intake form immediately resets.
    drained.catch(() => {}); return drained;
  }
  async function appendPairs(pairs) {
    check(!disposed, 'BATCH_IMPORT_BUSY');
    const value = await serial(async () => {
      check(!disposed, 'BATCH_IMPORT_BUSY');
      const old = await journal.get(); check(!old || old.version === 1, 'BATCH_IMPORT_STORAGE');
      const batch = old ?? { version: 1, id: cryptoImpl.randomUUID(), items: [] };
      batch.items.push(...pairs.map(makeItem));
      // Original Blobs and both idempotency IDs must commit before any request.
      return write(batch);
    });
    kick(); return value;
  }
  return Object.freeze({
    async append(files) { return appendPairs(pairBatchPhotos(files)); },
    async appendReviewedPairs(pairs) {
      check(Array.isArray(pairs) && pairs.length > 0 && pairs.length <= 100, 'BATCH_IMPORT_COUNT');
      return appendPairs(pairs.map((pair, index) => {
        for (const side of ['FRONT', 'BACK']) check(pair?.files?.[side] instanceof Blob && pair.files[side].size > 0 && pair.files[side].size <= 64 * 1024 * 1024, 'BATCH_IMPORT_PAIR_FILES');
        return { key: cryptoImpl.randomUUID(), label: `Card ${index + 1}`, files: { FRONT: pair.files.FRONT, BACK: pair.files.BACK } };
      }));
    },
    async saveSide(side, file, acquisition = null) {
      check(['FRONT', 'BACK'].includes(side), 'BATCH_IMPORT_PAIR_FILES');
      check(file instanceof Blob && file.size > 0 && file.size <= 64 * 1024 * 1024, 'BATCH_IMPORT_PAIR_FILES');
      const value = await serial(async () => {
        check(!disposed, 'BATCH_IMPORT_BUSY');
        const old = await journal.get(); check(!old || old.version === 1, 'BATCH_IMPORT_STORAGE');
        const batch = old ?? { version: 1, id: cryptoImpl.randomUUID(), items: [] };
        const draft = batch.draft ?? { id: cryptoImpl.randomUUID(), files: {}, acquisition: {} };
        // A second shutter event cannot replace an already assigned side.
        check(!draft.files[side], 'BATCH_IMPORT_SIDE_SAVED');
        draft.files[side] = file; draft.acquisition[side] = acquisition;
        if (draft.files.FRONT && draft.files.BACK) {
          batch.items.push(makeItem({ key: draft.id, label: `Card ${batch.items.length + 1}`, files: draft.files, acquisition: draft.acquisition }));
          batch.draft = null;
        } else batch.draft = draft;
        // Complete pair insertion and removal of the partial pair are atomic.
        return write(batch);
      });
      if (!value.draft) kick();
      return value;
    },
    async appendPair(front, back) {
      for (const value of [front, back]) check(value instanceof Blob && value.size > 0 && value.size <= 64 * 1024 * 1024, 'BATCH_IMPORT_PAIR_FILES');
      const label = typeof front.name === 'string' && front.name.trim() ? front.name.trim().slice(0, 120) : 'Card';
      return appendPairs([{ key: cryptoImpl.randomUUID(), label, files: { FRONT: front, BACK: back } }]);
    },
    async stage(files) {
      const pairs = pairBatchPhotos(files);
      return serial(async () => {
        check(!running && !disposed, 'BATCH_IMPORT_BUSY');
        const old = await journal.get(); check(!old || (!old.draft && old.items.every(item => item.done)), 'BATCH_IMPORT_PENDING');
        return write({ version: 1, id: cryptoImpl.randomUUID(), items: pairs.map(makeItem) });
      });
    },
    read,
    async clearSelection() {
      return serial(async () => {
        check(!running && !disposed, 'BATCH_IMPORT_BUSY');
        const old = await journal.get(); check(!old || old.items.every(item => !item.started), 'BATCH_IMPORT_PENDING');
        await journal.remove(); notify(null);
      });
    },
    run() { check(!disposed, 'BATCH_IMPORT_BUSY'); if (!running) authBlocked = false; return kick(true); },
    whenIdle: () => drained,
    dispose() { disposed = true; return Promise.allSettled([drained, journalTail]).then(() => undefined); },
  });
}
