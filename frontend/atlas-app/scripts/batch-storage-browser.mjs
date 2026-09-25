import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
if (!process.argv[2]) throw Error('Pass the bundled Playwright node_modules directory.');
const { chromium, webkit } = createRequire(join(resolve(process.argv[2]), '__atlas__.cjs'))('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = resolve(process.argv[3] ?? '/private/tmp/atlas-staff-byte-storage'); mkdirSync(output, { recursive: true });
const sources = new Map([
  ['/batch.mjs', 'frontend/atlas-app/lib/batch-import.mjs'], ['/client.mjs', 'packages/atlas-manual-intake/src/client.mjs'],
  ['/photo-bytes.mjs', 'packages/atlas-manual-intake/src/photo-bytes.mjs'],
  ['/packages/atlas-manual-intake/src/photo-bytes.mjs', 'packages/atlas-manual-intake/src/photo-bytes.mjs'],
]);
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Local staff byte storage verification</title><script type="module">import * as batch from "/batch.mjs";import * as intake from "/client.mjs";window.modules={batch,intake};</script>'); return; }
  const source = sources.get(req.url); if (!source) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(join(root, source)));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, results = [];
try {
  for (const [name, engine, options] of [['Chrome', chromium, { channel: 'chrome' }], ['WebKit', webkit, {}]]) {
    const browser = await engine.launch({ headless: true, ...options });
    try {
      const context = await browser.newContext();
      await context.route('**/*', route => { assert.equal(new URL(route.request().url()).origin, origin); return route.continue(); });
      const page = await context.newPage(); await page.goto(origin); await page.waitForFunction(() => window.modules);
      const result = await page.evaluate(async browserName => {
        const { batch, intake } = window.modules;
        const digest = async file => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
        const bytes = new Uint8Array(4 * 1024 * 1024); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17) % 251;
        const front = new File([bytes], 'native-front.heic', { type: 'image/heic', lastModified: 123456 });
        const back = new File([bytes, new Uint8Array([255])], 'native-back.jpg', { type: 'image/jpeg', lastModified: 654321 });
        const expected = [await digest(front), await digest(back)], staffId = crypto.randomUUID(), writes = new Map();
        const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get;
        let byteReads = 0, quota = false;
        const hasBlob = value => value instanceof Blob || (!!value && typeof value === 'object' && !(value instanceof ArrayBuffer) && Object.values(value).some(hasBlob));
        IDBObjectStore.prototype.put = function(value, key) {
          if (hasBlob(value)) throw new DOMException('Raw Blob writes are deliberately refused by this test', 'DataCloneError');
          if (quota && String(key).includes(':photo-bytes:')) throw new DOMException('Injected full storage', 'QuotaExceededError');
          writes.set(String(key), (writes.get(String(key)) ?? 0) + 1); return put.call(this, value, key);
        };
        IDBObjectStore.prototype.get = function(key) { if (String(key).includes(':photo-bytes:')) byteReads++; return get.call(this, key); };
        let journal = batch.createBrowserBatchImportJournal({ staffId });
        const items = Array.from({length: 10}, () => ({ createId: crypto.randomUUID(), enqueueId: crypto.randomUUID(), cardId: null,
          hashes: {}, done: false, files: { FRONT: front, BACK: back } }));
        const started = performance.now(); await journal.put({ version: 1, items });
        let saved = await journal.get(); const beforeProgress = byteReads;
        for (let i = 0; i < 12; i++) { saved.items[0].code = 'TEST_INTERRUPTED'; await journal.put(saved); saved = await journal.get(); }
        const cachedProgress = byteReads === beforeProgress;
        await journal.close(); journal = batch.createBrowserBatchImportJournal({ staffId }); saved = await journal.get();
        const sameIds = saved.items.every((item,i) => item.createId === items[i].createId && item.enqueueId === items[i].enqueueId);
        const exact = [];
        for (const item of saved.items) exact.push((await digest(item.files.FRONT)) === expected[0] && (await digest(item.files.BACK)) === expected[1]);
        const namePreserved = saved.items[0].files.FRONT.name === front.name && saved.items[0].files.BACK.lastModified === back.lastModified;
        quota = true; let quotaCode;
        try { await journal.put({ ...saved, draft: { id: crypto.randomUUID(), files: { FRONT: front } } }); } catch (error) { quotaCode = error.code; }
        quota = false;
        const afterQuota = await journal.get(), quotaPreserved = afterQuota.items.length === 10 && !afterQuota.draft && afterQuota.items.every((item,i) => item.createId === items[i].createId);
        const operationId = crypto.randomUUID(); let upload = intake.createBrowserIntakeJournal({ staffId });
        await upload.put(operationId, { kind: 'upload', cardId: crypto.randomUUID(), file: front, planUncertain: true, input: { requestId: operationId, side: 'FRONT', sha256: expected[0] } });
        let pending = await upload.get(operationId);
        for (let i = 0; i < 10; i++) { pending = { ...pending, uploadId: operationId }; await upload.put(operationId, pending); }
        await upload.close(); upload = intake.createBrowserIntakeJournal({ staffId });
        const beforeList = byteReads, list = await upload.list({ metadataOnly: true }), metadataOnly = byteReads === beforeList && !list[0].value.file;
        const restored = await upload.get(operationId), uploadSame = restored.input.requestId === operationId && restored.uploadId === operationId && restored.planUncertain === true && await digest(restored.file) === expected[0];
        saved.items[0].done = true; saved.items[0].files = null; await journal.put(saved); const completed = await journal.get();
        await upload.remove(operationId); const removed = (await upload.list()).length === 0;
        await upload.close(); await journal.close();
        IDBObjectStore.prototype.put = put; IDBObjectStore.prototype.get = get;
        let legacyPreserved = null;
        if (browserName === 'Chrome') {
          const legacyStaff = crypto.randomUUID(), legacy = batch.createBrowserBatchImportJournal({ staffId: legacyStaff }); await legacy.get();
          const db = await new Promise((resolve,reject) => { const r = indexedDB.open('atlas-batch-originals-v1',1); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
          const old = { createId: crypto.randomUUID(), enqueueId: crypto.randomUUID(), cardId: crypto.randomUUID(), files: { FRONT: new Blob(['oldF']), BACK: new Blob(['oldB']) }, hashes: {}, done: false };
          await new Promise((resolve,reject) => { const tx=db.transaction('imports','readwrite'); tx.objectStore('imports').put({version:1,items:[old]},legacyStaff); tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error); });
          const nativeRead = Blob.prototype.arrayBuffer; let legacyReads = 0;
          Blob.prototype.arrayBuffer = function() { if (this.size === 4) { legacyReads++; throw new DOMException('Unavailable retained file','NotReadableError'); } return nativeRead.call(this); };
          IDBObjectStore.prototype.put = function(value,key) { if (hasBlob(value)) throw Error('Legacy Blob must not be rewritten'); return put.call(this,value,key); };
          let next;
          try { next = await legacy.get(); next.items.push(items[1]); await legacy.put(next); next = await legacy.get(); next.items[1].code = 'TEST'; await legacy.put(next); }
          finally { Blob.prototype.arrayBuffer = nativeRead; IDBObjectStore.prototype.put = put; }
          const original = await new Promise((resolve,reject) => { const r=db.transaction('imports','readonly').objectStore('imports').get(legacyStaff); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
          legacyPreserved = legacyReads === 0 && next.items.length === 2 && next.items[0].createId === old.createId && await next.items[0].files.FRONT.text() === 'oldF' && await original.items[0].files.BACK.text() === 'oldB';
          await legacy.close(); db.close();
        }
        return { pairs: saved.items.length, exactBytes: exact.every(Boolean), sameIds, namePreserved, cachedProgress, metadataOnly,
          quotaCode, quotaPreserved, uploadSame, removed, byteWriteCounts: [...writes].filter(([key])=>key.includes(':photo-bytes:')).map(([,n])=>n),
          completedOnly: completed.items[0].files === null && completed.items.slice(1).every(item=>item.files.FRONT instanceof Blob), legacyPreserved,
          bytesPerPair: front.size + back.size, elapsedMs: Math.round(performance.now()-started) };
      }, name);
      assert.equal(result.pairs,10); assert.equal(result.quotaCode,'PHOTO_STORAGE_QUOTA');
      for (const field of ['exactBytes','sameIds','namePreserved','cachedProgress','metadataOnly','quotaPreserved','uploadSame','removed','completedOnly']) assert.equal(result[field],true,`${name} ${field}`);
      assert.equal(result.byteWriteCounts.length,21); assert(result.byteWriteCounts.every(n=>n===1));
      if (name==='Chrome') assert.equal(result.legacyPreserved,true);
      results.push({browser:name,...result}); await context.close();
    } finally { await browser.close(); }
  }
  const receipt = { status:'PASS', scope:'Actual desktop Chrome/WebKit; exact 10 synthetic 8 MiB pairs, blocked raw Blob writes, metadata-only progress, reload, quota atomicity, stable IDs and legacy preservation. No physical iPhone or production writes.', sourceHashes:Object.fromEntries([...sources].map(([key,path])=>[key,createHash('sha256').update(readFileSync(join(root,path))).digest('hex')])), results };
  writeFileSync(join(output,'result.json'),JSON.stringify(receipt,null,2)+'\n'); console.log(JSON.stringify(receipt));
} finally { await new Promise(done=>server.close(done)); }
