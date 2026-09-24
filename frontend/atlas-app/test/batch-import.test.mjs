import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pairBatchPhotos, createBatchImporter } from '../lib/batch-import.mjs';
const file = (name, content = name) => Object.assign(new Blob([content]), { name });
function fixture(options = {}) {
  let saved = null, active = 0, peak = 0, loseCreate = false, loseEnqueue = false, busyFront = false, pauses=0;
  const cards = new Map(), creates = new Map(), queued = new Map(), uploads = [];
  const journal = { get: async () => structuredClone(saved), put: async value => { saved = structuredClone(value); }, remove: async () => { saved = null; } };
  const intake = {
    pending: async () => [], read: async id => ({ card: structuredClone(cards.get(id)) }),
    async upload(id, side, version, value) {
      if(side==='FRONT'&&busyFront){busyFront=false;throw Object.assign(new Error('Busy'),{code:'MANUAL_PROCESSING_BUSY',status:503});}
      active++; peak = Math.max(peak, active); await delay(1);
      try {
        const card = cards.get(id), sha = Buffer.from(await webcrypto.subtle.digest('SHA-256', await value.arrayBuffer())).toString('hex');
        assert.equal(card.sides[side].version, version); uploads.push({ id, side });
        card.sides[side] = { version: version + 1, upload: { uploadId: randomUUID(), source: { fixture: true }, plan: { expected: { sha256: sha } } } };
        card.ready = Boolean(card.sides.FRONT.upload && card.sides.BACK.upload);
        return { card: structuredClone(card) };
      } finally { active--; }
    },
  };
  async function request(path, { body }) {
    if (path.endsWith('/batch')) {
      const prior = queued.get(body.actionId); if (prior) assert.deepEqual(prior, body); else queued.set(body.actionId, body);
      if (loseEnqueue) { loseEnqueue = false; throw Error('lost committed queue reply'); }
      return { jobs: [] };
    }
    if (!creates.has(body.requestId)) {
      const card = { cardId: randomUUID(), sourceHash: 'a'.repeat(64), label: body.label, ready: false, sides: { FRONT: { version: 0, upload: null }, BACK: { version: 0, upload: null } } };
      cards.set(card.cardId, card); creates.set(body.requestId, card);
    }
    if (loseCreate) { loseCreate = false; throw Error('lost committed create reply'); }
    return { card: structuredClone(creates.get(body.requestId)) };
  }
  const importer = () => createBatchImporter({ request, intake, journal, cryptoImpl: webcrypto, ...options, pause:async ms=>{assert.equal(ms,3000);pauses++;} });
  return { importer, journal, cards, creates, queued, uploads, get peak() { return peak; },get pauses(){return pauses;},busy:()=>{busyFront=true;}, loseCreate: () => { loseCreate = true; }, loseEnqueue: () => { loseEnqueue = true; } };
}
test('pairs exact filename stems regardless of file order and refuses ambiguous or incomplete physical pairings', () => {
  assert.equal(pairBatchPhotos([file('card-A_back.HEIC'), file('card-A_front.jpg')])[0].label, 'card-A');
  for (const files of [[file('a_front.jpg')], [file('a_front.jpg'), file('b_back.jpg')], [file('a_front.jpg'), file('a_front.png'), file('a_back.jpg')], [file('IMG123.jpg'), file('IMG124.jpg')]]) assert.throws(() => pairBatchPhotos(files), /BATCH_IMPORT_/);
});
test('100 physical pairs preserve originals, cap upload concurrency at two and queue independently', async () => {
  const f = fixture(), owner = f.importer();
  const files = Array.from({ length: 100 }, (_, index) => [file(`card-${index}_front.heic`), file(`card-${index}_back.heic`)]).flat();
  const saved = await owner.append(files); assert.equal(saved.items[0].files.FRONT instanceof Blob, true);
  const result = await owner.whenIdle(); assert.equal(result.items.every(item => item.done), true);
  assert.equal(f.creates.size, 100); assert.equal(f.uploads.length, 200); assert.equal(f.queued.size, 100); assert.equal(f.peak, 2);
  assert.equal((await f.journal.get()).items.every(item => item.files === null), true);
});
test('lost create and enqueue replies survive importer replacement without duplicate cards or uploads', async () => {
  const f = fixture(), first = f.importer(); await first.stage([file('one_front.jpg'), file('one_back.jpg')]);
  f.loseCreate(); await first.run(); assert.equal(f.creates.size, 1); await first.dispose();
  const second = f.importer(); await assert.rejects(second.clearSelection(), /BATCH_IMPORT_PENDING/);
  f.loseEnqueue(); await second.run(); assert.equal(f.queued.size, 1); assert.equal(f.uploads.length, 2); await second.dispose();
  const final = await f.importer().run(); assert.equal(final.items[0].done, true); assert.equal(f.creates.size, 1); assert.equal(f.queued.size, 1); assert.equal(f.uploads.length, 2);
});
test('source replacement during an interrupted import does not overwrite the replacement or queue the wrong card', async () => {
  const f = fixture(), owner = f.importer(); await owner.stage([file('one_front.jpg'), file('one_back.jpg')]);
  f.loseEnqueue(); await owner.run(); const [card] = f.cards.values(); card.sides.FRONT.upload.plan.expected.sha256 = 'e'.repeat(64);
  const result = await owner.run(); assert.equal(result.items[0].code, 'BATCH_IMPORT_UPLOAD_CONFLICT'); assert.equal(result.items[0].done, false);
  assert.equal(f.uploads.length, 2); assert.equal(f.queued.size, 1);
});
test('unstarted selection may be cleared but a pending import cannot be replaced', async () => {
  const f = fixture(), owner = f.importer(); await owner.stage([file('one_front.jpg'), file('one_back.jpg')]);
  await assert.rejects(owner.stage([file('two_front.jpg'), file('two_back.jpg')]), /BATCH_IMPORT_PENDING/);
  await owner.clearSelection(); assert.equal(await owner.read(), null);
});
test('ordinary CPU contention automatically waits then finishes the same pair without extra clicks',async()=>{
 const f=fixture(),owner=f.importer();await owner.stage([file('one_front.jpg'),file('one_back.jpg')]);f.busy();
 const result=await owner.run();assert.equal(result.items[0].done,true);assert.equal(result.items[0].code,null);
 assert.equal(f.pauses,1);assert.equal(f.creates.size,1);assert.equal(f.uploads.length,2);assert.equal(f.queued.size,1);
});

test('explicit side slots accept camera filenames and queue automatically after original persistence', async () => {
  const confirmations = [], f = fixture({ onQueued: event => confirmations.push(event) }), owner = f.importer();
  const saved = await owner.appendPair(file('IMG_8032.HEIC', 'front'), file('DSC_0001.JPG', 'back'));
  assert.equal(saved.items[0].files.FRONT instanceof Blob, true);
  assert.equal(saved.items[0].files.BACK instanceof Blob, true);
  assert.equal(saved.items[0].done, false);
  const result = await owner.whenIdle();
  assert.equal(result.items[0].done, true); assert.equal(f.queued.size, 1);
  assert.deepEqual(confirmations.map(value => value.cardId), [result.items[0].cardId]);
  assert.equal(confirmations[0].enqueueId, saved.items[0].enqueueId);
});
test('appending while an upload is paused preserves every intent and continues without a start action', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(), originalPut = f.journal.put; let blocked = false;
  f.journal.put = async value => {
    await originalPut(value);
    if (!blocked && value.items[0].cardId) { blocked = true; entered(); await gate; }
  };
  const owner = f.importer(); await owner.appendPair(file('first.jpg'), file('first-back.jpg'));
  await started;
  const second = owner.appendPair(file('next.jpg'), file('next-back.jpg'));
  const third = owner.append([file('bulk_back.heic'), file('bulk_front.heic')]);
  release(); await Promise.all([second, third]);
  const result = await owner.whenIdle();
  assert.equal(result.items.length, 3); assert.equal(result.items.every(item => item.done), true);
  assert.equal(new Set(result.items.map(item => item.createId)).size, 3);
  assert.equal(new Set(result.items.map(item => item.enqueueId)).size, 3);
  assert.equal(f.creates.size, 3); assert.equal(f.queued.size, 3); assert.equal(f.uploads.length, 6); assert.equal(f.peak, 2);
});
test('new intake does not retry uncertain work, and explicit recovery reuses its saved intent', async () => {
  const f = fixture(), owner = f.importer(); f.loseEnqueue();
  const first = await owner.appendPair(file('one-front.jpg'), file('one-back.jpg'));
  await owner.whenIdle();
  assert.equal((await owner.read()).items[0].files.FRONT instanceof Blob, true);
  await owner.appendPair(file('two-front.jpg'), file('two-back.jpg')); await owner.whenIdle();
  const pending = await owner.read();
  assert.equal(pending.items[0].done, false); assert.equal(pending.items[1].done, true);
  assert.equal(pending.items[0].enqueueId, first.items[0].enqueueId); assert.equal(f.queued.size, 2);
  await owner.run(); assert.equal((await owner.read()).items.every(item => item.done), true);
  assert.equal(f.queued.size, 2); assert.equal(f.creates.size, 2); assert.equal(f.uploads.length, 4);
});
test('journal refusal sends no request and a subsequent append is not poisoned', async () => {
  const f = fixture(), originalPut = f.journal.put; let fail = true;
  f.journal.put = async value => { if (fail) { fail = false; throw Error('storage full'); } return originalPut(value); };
  const owner = f.importer();
  await assert.rejects(owner.appendPair(file('first.jpg'), file('second.jpg')), /storage full/);
  assert.equal(f.creates.size, 0); assert.equal(f.uploads.length, 0); assert.equal(f.queued.size, 0);
  await owner.appendPair(file('first.jpg'), file('second.jpg')); await owner.whenIdle(); assert.equal(f.queued.size, 1);
});
test('bulk accepts exactly 100 named pairs and refuses 101 without inventing pairing authority', async () => {
  const files = Array.from({ length: 100 }, (_, index) => [file(`${index}_front.heic`), file(`${index}_back.heic`)]).flat();
  assert.equal(pairBatchPhotos(files.reverse()).length, 100);
  assert.throws(() => pairBatchPhotos([...files, file('extra_front.heic'), file('extra_back.heic')]), /BATCH_IMPORT_COUNT/);
  const owner = fixture().importer();
  await assert.rejects(owner.append([file('IMG_A.jpg'), file('IMG_B.jpg')]), /BATCH_IMPORT_PAIR_NAMES/);
  await assert.rejects(owner.appendPair(file('empty.jpg', ''), file('back.jpg')), /BATCH_IMPORT_PAIR_FILES/);
});
test('dispose retains unfinished originals and replacement importer resumes automatically with stable IDs', async () => {
  const f = fixture(), owner = f.importer();
  const saved = await owner.appendPair(file('first.jpg'), file('second.jpg')); await owner.dispose();
  const preserved = await f.journal.get();
  assert.equal(preserved.items[0].createId, saved.items[0].createId);
  assert.equal(preserved.items[0].files.FRONT instanceof Blob, true);
  await assert.rejects(owner.appendPair(file('new.jpg'), file('new-back.jpg')), /BATCH_IMPORT_BUSY/);
  const second = f.importer(); await second.run();
  assert.equal((await second.read()).items[0].done, true); assert.equal(f.creates.size, 1); assert.equal(f.queued.size, 1);
});
