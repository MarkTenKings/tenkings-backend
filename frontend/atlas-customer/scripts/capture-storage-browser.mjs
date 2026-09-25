import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

if (!process.argv[2]) throw Error('Pass the bundled Playwright node_modules directory.');
const { chromium, webkit } = createRequire(join(resolve(process.argv[2]), '__atlas__.cjs'))('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = resolve(process.argv[3] ?? '/private/tmp/atlas-customer-byte-storage'); mkdirSync(output, { recursive: true });
const sources = new Map([
  ['/buffer.mjs', 'frontend/atlas-customer/lib/capture-buffer.mjs'],
  ['/journal.mjs', 'frontend/atlas-customer/lib/intake-journal.mjs'],
  ['/packages/atlas-manual-intake/src/photo-bytes.mjs', 'packages/atlas-manual-intake/src/photo-bytes.mjs'],
]);
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Local customer byte storage verification</title><script type="module">import * as buffer from "/buffer.mjs";import * as journal from "/journal.mjs";window.modules={buffer,journal};</script>'); return; }
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
        const { buffer, journal } = window.modules;
        const digest = async file => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
        const bytes = new Uint8Array(4 * 1024 * 1024); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17) % 251;
        const front = new File([bytes], 'front-original.png', { type: 'image/png', lastModified: 1700000000000 });
        const back = new File([bytes, new Uint8Array([7])], 'back-original.png', { type: 'image/png', lastModified: 1700000000001 });
        const expected = [await digest(front), await digest(back)], accountId = crypto.randomUUID();
        const operationIds = item => ({ requestId: item.requestId, cardId: item.cardId, pairId: item.pairId, uploadIds: item.uploadIds });
        let capture = buffer.createCaptureBuffer({ accountId }); await capture.setService({ intakeMethod: 'MAIL_IN' });
        const started = performance.now();
        for (let i = 0; i < 10; i++) { await capture.capture('FRONT', front); await capture.capture('BACK', back); }
        const saved = await capture.snapshot(), ids = saved.pairs.map(operationIds); await capture.close();
        capture = buffer.createCaptureBuffer({ accountId });
        const reopened = await capture.snapshot();
        const repeated = await capture.snapshot();
        const captureBlobCache = repeated.pairs.every((pair, i) => pair.files.FRONT === reopened.pairs[i].files.FRONT && pair.files.BACK === reopened.pairs[i].files.BACK);
        const captureHashes = await Promise.all(reopened.pairs.map(async pair => [await digest(pair.files.FRONT), await digest(pair.files.BACK)]));
        const metadata = new Map(), originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, key) { metadata.set(String(key), (metadata.get(String(key)) ?? 0) + 1); return originalPut.call(this, value, key); };
        const draftId = crypto.randomUUID(); let upload = journal.createBrowserIntakeJournal({ accountId, draftId });
        const items = reopened.pairs.slice(0, 2).map(pair => ({ ...pair, verified: { FRONT: false, BACK: false }, done: false }));
        await upload.put({ version: 1, items });
        let current = await upload.get();
        const originalGet = IDBObjectStore.prototype.get; let progressPhotoReads = 0;
        IDBObjectStore.prototype.get = function(key) { if (String(key).includes(':photo:')) progressPhotoReads++; return originalGet.call(this, key); };
        current.items[0].error = 'TEST_INTERRUPTION'; await upload.put(current); await upload.get();
        IDBObjectStore.prototype.get = originalGet;
        await upload.close(); upload = journal.createBrowserIntakeJournal({ accountId, draftId }); current = await upload.get();
        const uploadHashes = await Promise.all(current.items.map(async item => [await digest(item.files.FRONT), await digest(item.files.BACK)]));
        const retainedIds = current.items.map(operationIds);
        current.items[0].done = true; current.items[0].files = null; await upload.put(current);
        const completed = await upload.get();
        IDBObjectStore.prototype.put = originalPut;
        await upload.close(); await capture.close();
        let legacyPreserved = null;
        if (browserName === 'Chrome') {
          const legacyDraft = crypto.randomUUID(), legacyJournal = journal.createBrowserIntakeJournal({ accountId, draftId: legacyDraft });
          await legacyJournal.get();
          const db = await new Promise((resolve, reject) => { const request = indexedDB.open('atlas-customer-originals-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
          const legacyItem = { requestId: crypto.randomUUID(), cardId: crypto.randomUUID(), pairId: crypto.randomUUID(), uploadIds: { FRONT: crypto.randomUUID(), BACK: crypto.randomUUID() }, files: { FRONT: new Blob(['oldF']), BACK: new Blob(['oldB']) }, done: false };
          const legacyKey = `${accountId}:${legacyDraft}`;
          await new Promise((resolve, reject) => { const tx = db.transaction('pairs', 'readwrite'); tx.objectStore('pairs').put({ version: 1, items: [legacyItem] }, legacyKey); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
          let attemptedLegacyReads = 0; const read = Blob.prototype.arrayBuffer;
          Blob.prototype.arrayBuffer = function() { if (this.size === 4) { attemptedLegacyReads++; throw Error('Unavailable old photo'); } return read.call(this); };
          try { await legacyJournal.put({ version: 1, items: [legacyItem, items[1]] }); }
          finally { Blob.prototype.arrayBuffer = read; }
          const migrated = await legacyJournal.get();
          const rawLegacy = await new Promise((resolve, reject) => { const tx = db.transaction('pairs', 'readonly'), request = tx.objectStore('pairs').get(legacyKey); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
          legacyPreserved = attemptedLegacyReads === 0 && migrated.items.length === 2 && migrated.items[0].requestId === legacyItem.requestId
            && await migrated.items[0].files.FRONT.text() === 'oldF' && rawLegacy.items[0].requestId === legacyItem.requestId && await rawLegacy.items[0].files.BACK.text() === 'oldB';
          await legacyJournal.close(); db.close();
        }
        return { pairs: reopened.pairs.length, sameIds: JSON.stringify(ids) === JSON.stringify(reopened.pairs.map(operationIds)),
          exactCaptureBytes: captureHashes.every(hashes => JSON.stringify(hashes) === JSON.stringify(expected)),
          exactUploadBytes: uploadHashes.every(hashes => JSON.stringify(hashes) === JSON.stringify(expected)),
          uploadIdsPreserved: JSON.stringify(retainedIds) === JSON.stringify(items.map(operationIds)),
          photoWrites: [...metadata].filter(([key]) => key.includes(':photo:')).map(([, count]) => count),
          completedReleased: completed.items[0].files === null, otherPairRetained: completed.items[1].files.FRONT instanceof Blob,
          namePreserved: reopened.pairs[0].files.FRONT.name === front.name,
          lastModifiedPreserved: reopened.pairs[0].files.FRONT.lastModified === front.lastModified,
          legacyPreserved, captureBlobCache, progressPhotoReads, elapsedMs: Math.round(performance.now() - started), bytesPerPair: front.size + back.size };
      }, name);
      assert.equal(result.pairs, 10); for (const key of ['sameIds', 'exactCaptureBytes', 'exactUploadBytes', 'uploadIdsPreserved', 'completedReleased', 'otherPairRetained', 'namePreserved', 'lastModifiedPreserved', 'captureBlobCache']) assert.equal(result[key], true, `${name}: ${key}`);
      assert.equal(result.progressPhotoReads, 0, `${name}: progress must not reload original byte records`);
      assert.deepEqual(result.photoWrites, [1, 1, 1, 1], `${name}: progress must not rewrite original bytes`);
      if (name === 'Chrome') assert.equal(result.legacyPreserved, true, 'Unreadable legacy bytes cannot block saving another pair');
      results.push({ browser: name, ...result }); await context.close();
    } finally { await browser.close(); }
  }
  const receipt = { status: 'PASS', scope: 'Actual desktop Chrome/WebKit IndexedDB; exact synthetic original bytes and stable IDs; no network uploads or physical iPhone proof', results };
  writeFileSync(join(output, 'result.json'), JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt));
} finally { await new Promise(done => server.close(done)); }
