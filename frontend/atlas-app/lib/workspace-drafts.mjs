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
    async function transaction(mode, action) {
        const database = await openDatabase(indexedDB);
        return new Promise((resolve, reject) => {
            const tx = database.transaction(STORE, mode), request = action(tx.objectStore(STORE)); let value;
            request.onsuccess = () => { value = request.result; };
            tx.oncomplete = () => { database.close(); resolve(value); };
            tx.onerror = tx.onabort = () => { database.close(); reject(new Error('Photo drafts could not be saved in this browser. Keep this tab open and retry.')); };
        });
    }
    return {
        async read() { const saved = await transaction('readonly', store => store.get(key)); return saved?.version === 1 && Array.isArray(saved.entries) ? saved.entries : []; },
        write(entries) { return transaction('readwrite', store => store.put({ version: 1, entries, updatedAt: new Date().toISOString() }, key)); }
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
