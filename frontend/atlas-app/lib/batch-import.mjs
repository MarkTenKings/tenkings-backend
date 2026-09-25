import { encodePhoto, decodePhoto, photoStorageError } from '../../../packages/atlas-manual-intake/src/photo-bytes.mjs';
const BASE = '/api/staff/manual-intake/cards';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (ok, code) => { if (!ok) fail(code); };
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
const phases = new Set(['SAVE_CARD_INTENT','CREATE_CARD','SAVE_CARD_ID','READ_FRONT_BYTES','READ_BACK_BYTES','HASH_FRONT_BYTES','HASH_BACK_BYTES','SAVE_HASHES','READ_FRONT_JOURNAL','READ_BACK_JOURNAL','READ_FRONT_CARD','READ_BACK_CARD','RESUME_FRONT_UPLOAD','RESUME_BACK_UPLOAD','PREPARE_FRONT_UPLOAD','PREPARE_BACK_UPLOAD','UPLOAD_FRONT','UPLOAD_BACK','VERIFY_PAIR','ENQUEUE_CARD','SAVE_QUEUE']);
const exceptionNames = new Set(['Error','TypeError','RangeError','AbortError','DataCloneError','InvalidStateError','NotReadableError','NotSupportedError','OperationError','QuotaExceededError','SecurityError','TimeoutError','TransactionInactiveError','UnknownError']);
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(value) ? value : 'BATCH_IMPORT_INTERRUPTED';
const safeId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value) ? value : null;
const failureContext = value => ({
  ...(typeof value?.at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.at) && Number.isFinite(Date.parse(value.at)) ? { at: value.at } : {}),
  ...(Number.isInteger(value?.status) && value.status >= 400 && value.status <= 599 ? { status: value.status } : {}),
  ...(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value?.reference ?? '') ? { reference: value.reference } : {}),
});
const storageFailure = cause => photoStorageError(cause, 'BATCH_IMPORT_STORAGE');
export function batchImportFailureDetails(item) {
  if (!item?.code) return null;
  return { code: safeCode(item.code), phase: phases.has(item.failure?.phase) ? item.failure.phase : 'UNKNOWN',
    exceptionName: exceptionNames.has(item.failure?.exceptionName) ? item.failure.exceptionName : 'Error', ...failureContext(item.failure) };
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
  const metadataKey = `${staffId}:byte-metadata-v1`, prefix = `${staffId}:photo-bytes:`, photoCache = new Map();
  const retiredKey = `${staffId}:discarded-v1`;
  const filter = (value, retired) => value ? { ...value, items: value.items.filter(item => !retired?.createRequestIds?.includes(item.createId)
    && !retired?.cardIds?.includes(item.cardId)), ...(value.draft && retired?.draftIds?.includes(value.draft.id) ? { draft: null } : {}) } : null;
  const isRef = value => value?.format === 'atlas-photo-reference-v1' && typeof value.key === 'string' && value.key.startsWith(prefix);
  const isLegacy = value => value?.format === 'atlas-legacy-batch-photo-v1' && ['item', 'draft'].includes(value.kind)
    && typeof value.id === 'string' && ['FRONT', 'BACK'].includes(value.side);
  const entries = batch => [...(batch?.items ?? []).map(item => ({ item, kind: 'item', id: item.createId })),
    ...(batch?.draft ? [{ item: batch.draft, kind: 'draft', id: batch.draft.id }] : [])];
  const opened = new Promise((resolve, reject) => {
    const request = indexedDB.open('atlas-batch-originals-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('imports');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(storageFailure(request.error));
  });
  async function transaction(mode, operation) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('imports', mode), store = tx.objectStore('imports'); let value, failure;
      tx.oncomplete = () => resolve(value); tx.onerror = tx.onabort = event => reject(storageFailure(event.target.error ?? tx.error));
      const guard = work => event => { try { work(event); } catch (error) { failure = error; tx.abort(); } };
      tx.onabort = tx.onerror = event => reject(storageFailure(failure ?? event.target.error ?? tx.error));
      try { operation(store, result => { value = result; }, guard); }
      catch (error) { tx.abort(); reject(storageFailure(error)); }
    });
  }
  const raw = () => transaction('readonly', (store, done) => { store.get(metadataKey).onsuccess = event => done(event.target.result ?? null); });
  const getMetadata = () => transaction('readonly', (store, done) => {
    store.get(metadataKey).onsuccess = event => {
      if (event.target.result) return done(event.target.result);
      store.get(staffId).onsuccess = legacy => done(legacy.target.result ?? null);
    };
  });
  async function get() {
    return transaction('readonly', (store, done, guard) => {
      store.get(metadataKey).onsuccess = guard(event => {
        const metadata = event.target.result;
        const liveKeys = new Set(entries(metadata).flatMap(({ item }) => Object.values(item.files ?? {})).filter(isRef).map(ref => ref.key));
        for (const key of photoCache.keys()) if (!liveKeys.has(key)) photoCache.delete(key);
        const restore = guard(legacyEvent => {
          const legacy = legacyEvent.target.result;
          if (!metadata) {
            if (!legacy) return done(null);
            for (const { item, kind, id } of entries(legacy)) if (item.files) item.photoRefs = Object.fromEntries(
              Object.keys(item.files).map(side => [side, { format: 'atlas-legacy-batch-photo-v1', kind, id, side }]));
            return done(legacy);
          }
          let pending = 1;
          const finish = () => { if (--pending === 0) done(metadata); };
          for (const { item } of entries(metadata)) {
            if (!item.files) continue;
            item.photoRefs = { ...item.files };
            for (const [side, reference] of Object.entries(item.photoRefs)) {
              if (isLegacy(reference)) {
                const original = reference.kind === 'draft' ? legacy?.draft : legacy?.items.find(value => value.createId === reference.id);
                check(original && (reference.kind !== 'draft' || original.id === reference.id) && original.files?.[side] instanceof Blob, 'PHOTO_STORAGE_CORRUPT');
                item.files[side] = original.files[side];
              } else {
                check(isRef(reference), 'PHOTO_STORAGE_CORRUPT');
                if (photoCache.has(reference.key)) { item.files[side] = photoCache.get(reference.key); continue; }
                pending++;
                store.get(reference.key).onsuccess = guard(photoEvent => {
                  item.files[side] = decodePhoto(photoEvent.target.result);
                  check(item.files[side].size === reference.byteCount, 'PHOTO_STORAGE_CORRUPT');
                  photoCache.set(reference.key, item.files[side]); finish();
                });
              }
            }
          }
          finish();
        });
        const needsLegacy = !metadata || entries(metadata).some(({ item }) => Object.values(item.files ?? {}).some(isLegacy));
        if (needsLegacy) store.get(staffId).onsuccess = restore;
        else restore({ target: { result: null } });
      });
    });
  }
  async function put(value) {
    // Bytes are materialized outside a transaction, and only for new or
    // explicitly recovered photos. A broken legacy Blob is kept by reference
    // in its untouched old record; it cannot block another card's progress.
    const previous = await raw(), metadata = { ...value, items: value.items.map(item => ({ ...item })),
      ...(value.draft ? { draft: { ...value.draft } } : {}) }, photos = new Map();
    const prior = new Map(entries(previous).map(entry => [`${entry.kind}:${entry.id}`, entry.item]));
    for (const { item, kind, id } of entries(metadata)) {
      if (!item.files) { delete item.photoRefs; continue; }
      const files = {};
      for (const [side, file] of Object.entries(item.files)) {
        const old = prior.get(`${kind}:${id}`)?.files?.[side], retained = item.photoRefs?.[side];
        let reference = isRef(old) ? old : isRef(retained) || isLegacy(retained) ? retained : null;
        if (reference && isRef(reference)) check(file.size === reference.byteCount, 'PHOTO_STORAGE_CORRUPT');
        if (!reference) {
          const key = `${prefix}${kind}:${id}:${side}`, encoded = await encodePhoto(file);
          photos.set(key, encoded); reference = { format: 'atlas-photo-reference-v1', key, byteCount: encoded.byteCount };
        }
        files[side] = reference;
      }
      item.files = files; delete item.photoRefs;
    }
    let retained = value, liveKeys;
    await transaction('readwrite', (store, done, guard) => {
      store.get(retiredKey).onsuccess = guard(event => {
        const accepted = filter(metadata, event.target.result); retained = filter(value, event.target.result);
        const references = entries(accepted).flatMap(({ item }) => Object.values(item.files ?? {}));
        liveKeys = new Set(references.filter(isRef).map(reference => reference.key));
        for (const [key, encoded] of photos) if (liveKeys.has(key)) store.put(encoded, key);
        store.put(accepted, metadataKey);
        for (const { item } of entries(previous)) for (const reference of Object.values(item.files ?? {})) {
          if (isRef(reference) && !liveKeys.has(reference.key)) store.delete(reference.key);
        }
        // Legacy records remain only while another live original needs them.
        if (!references.some(isLegacy)) store.delete(staffId);
      });
    });
    for (const [key, encoded] of photos) if (liveKeys.has(key)) photoCache.set(key, decodePhoto(encoded));
    for (const key of photoCache.keys()) if (!liveKeys.has(key)) photoCache.delete(key);
    return retained;
  }
  async function retire({ createRequestIds = [], cardIds = [], draftId = null }) {
    await transaction('readwrite', (store, done, guard) => {
      store.get(retiredKey).onsuccess = guard(event => {
        const old = event.target.result ?? {}, retired = { createRequestIds: [...new Set([...(old.createRequestIds ?? []), ...createRequestIds])],
          cardIds: [...new Set([...(old.cardIds ?? []), ...cardIds])], draftIds: [...new Set([...(old.draftIds ?? []), ...(draftId ? [draftId] : [])])] };
        store.put(retired, retiredKey);
        store.get(metadataKey).onsuccess = guard(metadataEvent => {
          const previous = metadataEvent.target.result, next = filter(previous, retired);
          if (next) {
            const liveKeys = new Set(entries(next).flatMap(({ item }) => Object.values(item.files ?? {})).filter(isRef).map(ref => ref.key));
            for (const { item } of entries(previous)) for (const ref of Object.values(item.files ?? {})) if (isRef(ref) && !liveKeys.has(ref.key)) store.delete(ref.key);
            if (!next.items.length && !next.draft) store.delete(metadataKey); else store.put(next, metadataKey);
          }
          store.get(staffId).onsuccess = guard(legacyEvent => {
            const legacy = filter(legacyEvent.target.result, retired);
            if (legacy?.items.length || legacy?.draft) store.put(legacy, staffId); else store.delete(staffId);
          });
        });
      });
    });
    photoCache.clear();
  }
  return {
    get, put, getMetadata, retire,
    remove: async () => {
      const previous = await raw();
      await transaction('readwrite', store => {
        for (const { item } of entries(previous)) for (const reference of Object.values(item.files ?? {})) if (isRef(reference)) store.delete(reference.key);
        store.delete(metadataKey); store.delete(staffId);
      });
      photoCache.clear();
    },
    close: async () => { photoCache.clear(); (await opened).close(); },
  };
}

export function createBatchImporter({ request, intake, journal, cryptoImpl = globalThis.crypto, onProgress = () => {}, onQueued = () => {},
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), isPaused = () => false }) {
  let running = false, disposed = false, paused = false, drained = Promise.resolve(), journalTail = Promise.resolve(), requested = false, authBlocked = false;
  const blocked = () => paused || isPaused();
  const post = (path, body) => request(path, { method: 'POST', body });
  // Every append and progress write reads the newest journal inside this queue.
  // In particular, a slow upload may never overwrite a newly appended pair.
  const serial = operation => {
    const result = journalTail.then(operation);
    journalTail = result.catch(() => {}); return result;
  };
  const notify = value => { if (!disposed) { try { onProgress(structuredClone(value)); } catch { /* UI callbacks do not change persisted intent. */ } } };
  async function write(value) { const saved = await journal.put(value) ?? value; notify(saved); return structuredClone(saved); }
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
      try { check(!blocked(), 'INTAKE_DISCARD_PENDING'); return await operation(); }
      catch (error) { throw Object.assign(new Error('Saved upload step did not finish'), { code: safeCode(error?.code), status: error?.status,
        diagnostic: { phase, exceptionName: exceptionNames.has(error?.name) ? error.name : 'Error', ...failureContext({ ...error, at: new Date().toISOString() }) } }); }
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
          const encoded = await step(`READ_${side}_BYTES`, () => encodePhoto(item.files[side]));
          item.hashes[side] = await step(`HASH_${side}_BYTES`, async () => hex(await cryptoImpl.subtle.digest('SHA-256', encoded.bytes)));
          item.files[side] = decodePhoto(encoded);
          if (item.photoRefs) delete item.photoRefs[side];
        }
      }
      await step('SAVE_HASHES', () => saveItem(item));
      const prepareSide = async side => {
        if (disposed) return;
        const pending = await step(`READ_${side}_JOURNAL`, async () => (await intake.pending({ metadataOnly: true })).filter(entry => entry.value.kind === 'upload' && entry.value.cardId === item.cardId && entry.value.input.side === side));
        check(pending.length <= 1, 'BATCH_IMPORT_UPLOAD_CONFLICT');
        if (pending.length) {
          check(pending[0].value.input.sha256 === item.hashes[side], 'BATCH_IMPORT_UPLOAD_CONFLICT');
          // A pre-byte-storage intake journal can retain an unreadable Safari
          // Blob while this batch holds the same original in durable bytes.
          // Resume may use it only after checking the existing plan's hash.
          await step(`RESUME_${side}_UPLOAD`, () => intake.resume(pending[0].id, { fallbackFile: item.files[side] })); return;
        }
        const slot = await step(`READ_${side}_CARD`, async () => (await intake.read(item.cardId)).card.sides[side]);
        if (slot.upload) {
          check(slot.upload.plan.expected.sha256 === item.hashes[side], 'BATCH_IMPORT_UPLOAD_CONFLICT');
          if (slot.upload.source) return;
          await step(`PREPARE_${side}_UPLOAD`, () => intake.prepareSaved(item.cardId, slot.upload.uploadId)); return;
        }
        await step(`UPLOAD_${side}`, () => intake.upload(item.cardId, side, slot.version, item.files[side]));
      };
      const outcomes = await Promise.allSettled(['FRONT', 'BACK'].map(prepareSide));
      const failures = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
      // A busy side must not hide the other side's real attention/auth error.
      const failed = failures.find(error => [401, 403].includes(error?.status))
        ?? failures.find(error => error?.code !== 'MANUAL_PROCESSING_BUSY') ?? failures[0];
      if (failed) throw failed;
      if (disposed) return;
      const { card } = await step('VERIFY_PAIR', async () => { const result = await intake.read(item.cardId); check(result.card.ready && ['FRONT', 'BACK'].every(side => result.card.sides[side].upload?.plan.expected.sha256 === item.hashes[side]), 'BATCH_IMPORT_UPLOAD_CONFLICT'); return result; });
      await step('ENQUEUE_CARD', () => post('/api/staff/manual-connected/cards/batch', { actionId: item.enqueueId, cards: [{ cardId: item.cardId, sourceHash: card.sourceHash }] }));
      item.done = true; item.files = null; item.code = null; item.failure = null; await step('SAVE_QUEUE', () => saveItem(item));
      if (!disposed) { try { onQueued({ cardId: item.cardId, createId: item.createId, enqueueId: item.enqueueId, label: item.label }); } catch { /* Queue confirmation is already durable. */ } }
    } catch (error) {
      if (error?.code === 'INTAKE_CARD_DELETED' && journal.retire) {
        await serial(async () => { await journal.retire({ createRequestIds: [item.createId], cardIds: item.cardId ? [item.cardId] : [] }); notify(await journal.get()); });
        return error.code;
      }
      if (error?.code === 'INTAKE_DISCARD_PENDING') return error.code;
      item.code = safeCode(error?.code); item.failure = error?.diagnostic ?? { phase: 'UNKNOWN', exceptionName: exceptionNames.has(error?.name) ? error.name : 'Error' };
      await saveItem(item);
      if ([401, 403].includes(error?.status)) authBlocked = true;
      return item.code;
    }
  }
  function kick(retry = false) {
    if (disposed || authBlocked || blocked()) return drained;
    requested = true;
    if (running) return drained;
    running = true;
    drained = (async () => {
      const attempted = new Set(), busyAttempts = new Map(), deferredBusy = new Set(); let latest;
      try {
      do {
        requested = false;
        while (!disposed && !authBlocked && !blocked()) {
          const batch = await read(); if (!batch) { latest = null; break; } check(batch.version === 1, 'BATCH_IMPORT_MISSING'); latest = batch;
          const item = batch.items.find(value => !value.done && !attempted.has(value.createId) && (retry || !value.code || deferredBusy.has(value.createId)));
          if (!item) break;
          attempted.add(item.createId);
          const code = await processItem(item);
          if (code === 'MANUAL_PROCESSING_BUSY') {
            const count = (busyAttempts.get(item.createId) ?? 0) + 1; busyAttempts.set(item.createId, count);
            if (count < 30) deferredBusy.add(item.createId); else deferredBusy.delete(item.createId);
          } else deferredBusy.delete(item.createId);
        }
        // Server contention is an explicit pre-work refusal. Let every other
        // saved pair run first, then retry these exact intents on a bounded
        // cadence. Uncertain/unsupported work still needs deliberate recovery.
        if (deferredBusy.size && !disposed && !authBlocked && !blocked()) {
          await pause(3000);
          for (const id of deferredBusy) attempted.delete(id);
          requested = true;
        }
      } while (requested && !disposed && !authBlocked && !blocked());
      return latest;
      } finally { running = false; }
    })();
    // Background failures remain observable through whenIdle()/run(), without
    // creating an unhandled rejection when the intake form immediately resets.
    drained.catch(() => {}); return drained;
  }
  async function appendPairs(pairs) {
    check(!disposed && !isPaused(), 'BATCH_IMPORT_BUSY');
    const value = await serial(async () => {
      check(!disposed && !isPaused(), 'BATCH_IMPORT_BUSY');
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
        check(!disposed && !isPaused(), 'BATCH_IMPORT_BUSY');
        const old = await journal.get(); check(!old || old.version === 1, 'BATCH_IMPORT_STORAGE');
        const batch = old ?? { version: 1, id: cryptoImpl.randomUUID(), items: [] };
        const draft = batch.draft ?? { id: cryptoImpl.randomUUID(), files: {}, acquisition: {} };
        // A second shutter event cannot replace an already assigned side.
        check(!draft.files[side], 'BATCH_IMPORT_SIDE_SAVED');
        draft.files[side] = file; draft.acquisition[side] = acquisition;
        if (draft.files.FRONT && draft.files.BACK) {
          batch.items.push(makeItem({ key: draft.id, label: `Card ${batch.items.length + 1}`, files: draft.files, photoRefs: draft.photoRefs, acquisition: draft.acquisition }));
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
        check(!running && !disposed && !blocked(), 'BATCH_IMPORT_BUSY');
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
    pauseForDiscard() { paused = true; return Promise.allSettled([drained, journalTail]).then(() => undefined); },
    resumeAfterDiscard() { paused = false; },
    refresh: () => serial(async () => { const saved = await journal.get(); notify(saved); return saved; }),
    dispose() { disposed = true; return Promise.allSettled([drained, journalTail]).then(() => undefined); },
  });
}
