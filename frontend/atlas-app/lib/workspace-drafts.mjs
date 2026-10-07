const DATABASE = 'atlas-photo-drafts-v1';
const STORE = 'drafts';
function openDatabase(indexedDB) {
    return new Promise((resolve, reject) => {
        if (!indexedDB) { reject(new Error('This browser cannot save photo drafts. Enable browser storage before adding photographs.')); return; }
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => reject(new Error('Photo draft storage could not be opened. Your selected files have not been uploaded.'));
        request.onsuccess = () => resolve(request.result);
        request.onblocked = () => reject(new Error('Close older ATLAS tabs, then reopen photo draft storage.'));
    });
}
/** IndexedDB preserves File/Blob bytes across reloads without serializing
 * image bodies into localStorage. Every key is scoped to the signed-in staff. */
export function createPhotoDraftStore(ownerId, indexedDB = globalThis.indexedDB) {
    if (typeof ownerId !== 'string' || !ownerId) throw new Error('Staff access is required for local draft recovery.');
    const key = `staff:${ownerId}`;
    const fileKeys = new WeakMap(); let knownRevision;
    const failure = () => new Error('Photo drafts could not be saved in this browser. Keep this tab open and retry.');
    const revisionOf = value => value ? JSON.stringify([value.version, value.revision ?? null, value.updatedAt ?? null]) : null;
    const changed = () => Object.assign(new Error('Your photographs have newer saved progress in another ATLAS tab. Reload this page to continue from that progress.'), { code: 'PHOTO_DRAFT_CHANGED' });
    const map = (value, visit) => {
        if (!value || typeof value !== 'object') return value;
        const replacement = visit(value); if (replacement !== value) return replacement;
        if (Array.isArray(value)) return value.map(item => map(item, visit));
        return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, map(item, visit)]));
    };
    return {
        async read() {
            const database = await openDatabase(indexedDB);
            return new Promise((resolve, reject) => {
                const tx = database.transaction(STORE, 'readonly'), objectStore = tx.objectStore(STORE), request = objectStore.get(key), blobs = new Map(); let saved, failed;
                request.onsuccess = () => {
                    saved = request.result;
                    if (saved?.version !== 2) return;
                    if (!Array.isArray(saved.blobKeys) || saved.blobKeys.some(value => typeof value !== 'string' || !value.startsWith(`${key}:photo:`))) { failed = true; return; }
                    for (const blobKey of saved.blobKeys) {
                        const photo = objectStore.get(blobKey);
                        photo.onsuccess = () => { if (!(photo.result instanceof Blob)) failed = true; else blobs.set(blobKey, photo.result); };
                    }
                };
                tx.oncomplete = () => {
                    database.close();
                    if (failed) { reject(failure()); return; }
                    knownRevision = revisionOf(saved);
                    if (!saved) { resolve([]); return; }
                    if (saved.version === 1 && Array.isArray(saved.entries)) { resolve(saved.entries); return; }
                    if (saved.version !== 2 || !Array.isArray(saved.entries)) { reject(failure()); return; }
                    try {
                        const restored = new Map();
                        const entries = map(saved.entries, value => {
                            if (!Object.hasOwn(value, '$atlasPhotoBlob')) return value;
                            const blob = blobs.get(value.$atlasPhotoBlob);
                            if (!blob) throw failure();
                            if (!restored.has(value.$atlasPhotoBlob)) {
                                const file = new File([blob], value.name, { type: blob.type, lastModified: value.lastModified });
                                restored.set(value.$atlasPhotoBlob, file); fileKeys.set(file, value.$atlasPhotoBlob);
                            }
                            return restored.get(value.$atlasPhotoBlob);
                        });
                        resolve(entries);
                    } catch { reject(failure()); }
                };
                tx.onerror = tx.onabort = () => { database.close(); reject(failure()); };
            });
        },
        async write(entries) {
            // Large immutable image bodies are separate from the small progress
            // manifest. Every new Blob and its first reference commit together;
            // upload/identity transitions then rewrite metadata only.
            const selected = new Map(), retained = new Set();
            const metadata = map(entries, value => {
                if (!(value instanceof Blob)) return value;
                const blobKey = fileKeys.get(value) ?? selected.get(value) ?? `${key}:photo:${globalThis.crypto.randomUUID()}`;
                selected.set(value, blobKey); retained.add(blobKey);
                return { $atlasPhotoBlob: blobKey, name: value.name ?? 'photograph', lastModified: value.lastModified ?? 0 };
            });
            const database = await openDatabase(indexedDB);
            return new Promise((resolve, reject) => {
                const tx = database.transaction(STORE, 'readwrite'), objectStore = tx.objectStore(STORE);
                const manifest = { version: 2, revision: globalThis.crypto.randomUUID(), entries: metadata, blobKeys: [...retained], updatedAt: new Date().toISOString() };
                let cause;
                const abort = error => { cause = error; try { tx.abort(); } catch { database.close(); reject(cause); } };
                tx.oncomplete = () => { database.close(); selected.forEach((blobKey, file) => fileKeys.set(file, blobKey)); knownRevision = revisionOf(manifest); resolve(); };
                tx.onerror = tx.onabort = () => { database.close(); reject(cause ?? failure()); };
                // Compare inside this transaction: another tab may have queued
                // the card, released its copies, or captured new work since our
                // read. A stale writer must not replace that newer manifest.
                const latest = objectStore.get(key);
                latest.onsuccess = () => {
                    if (revisionOf(latest.result) !== (knownRevision ?? null)) { abort(changed()); return; }
                    try {
                        const currentKeys = latest.result?.version === 2 ? latest.result.blobKeys : [];
                        if (!Array.isArray(currentKeys) || currentKeys.some(value => typeof value !== 'string' || !value.startsWith(`${key}:photo:`))) throw failure();
                        // Check keys, not large image bodies. Any missing cached
                        // body is restored atomically with its reference.
                        selected.forEach((blobKey, file) => {
                            const present = objectStore.getKey(blobKey);
                            present.onsuccess = () => { if (present.result === undefined) { try { objectStore.put(file, blobKey); } catch { abort(failure()); } } };
                        });
                        objectStore.put(manifest, key);
                        // Removed browser upload copies are no longer needed
                        // after queue acceptance. HEIC originals stay referenced.
                        for (const blobKey of currentKeys) if (!retained.has(blobKey)) objectStore.delete(blobKey);
                    } catch { abort(failure()); }
                };
            });
        }
    };
}
export function createWorkspaceJournal(ownerId, cardId, storage = globalThis.sessionStorage) {
    const key = `atlas-workspace-request-v1:${ownerId}:${cardId}`;
    return {
        read() { try { const value = JSON.parse(storage.getItem(key) ?? 'null'); return value?.version === 1 ? value.pending : null; } catch { throw new Error('The saved request could not be read. Keep this tab open before changing this card.'); } },
        write(pending) {
            try { if (pending) storage.setItem(key, JSON.stringify({ version: 1, pending })); else storage.removeItem(key); }
            catch { throw new Error('This browser could not retain the request. Enable browser storage before saving.'); }
        }
    };
}
