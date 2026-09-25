import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { batchImportDiagnostics, batchImportFailureDetails, pairBatchPhotos, createBatchImporter } from '../lib/batch-import.mjs';
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
  return { importer, journal, intake, cards, creates, queued, uploads, get peak() { return peak; },get pauses(){return pauses;},busy:()=>{busyFront=true;}, loseCreate: () => { loseCreate = true; }, loseEnqueue: () => { loseEnqueue = true; } };
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

test('automatic intake processes a healthy pair before retrying a busy pair with the same IDs', async () => {
  const completed = [], f = fixture({ onQueued: event => completed.push(event.cardId) }), owner = f.importer();
  f.busy();
  const saved = await owner.append([file('one_front.jpg'), file('one_back.jpg'), file('two_front.jpg'), file('two_back.jpg')]);
  const result = await owner.whenIdle();
  assert.equal(result.items.every(item => item.done), true);
  assert.deepEqual(completed, [result.items[1].cardId, result.items[0].cardId]);
  assert.deepEqual(result.items.map(item => [item.createId, item.enqueueId]), saved.items.map(item => [item.createId, item.enqueueId]));
  assert.equal(f.pauses, 1); assert.equal(f.creates.size, 2); assert.equal(f.uploads.length, 4); assert.equal(f.queued.size, 2);
});

test('persistent busy refusal is bounded while the other original uploads only once', async () => {
  const f = fixture(), upload = f.intake.upload; let refused = 0;
  f.intake.upload = async (...args) => {
    if (args[1] === 'FRONT') { refused++; throw Object.assign(new Error('busy'), { code: 'MANUAL_PROCESSING_BUSY', status: 503 }); }
    return upload(...args);
  };
  const owner = f.importer(), saved = await owner.appendPair(file('front.jpg'), file('back.jpg'));
  const result = await owner.whenIdle();
  assert.equal(refused, 30); assert.equal(f.pauses, 29); assert.equal(f.creates.size, 1); assert.equal(f.uploads.length, 1); assert.equal(f.queued.size, 0);
  assert.equal(result.items[0].code, 'MANUAL_PROCESSING_BUSY'); assert.equal(result.items[0].done, false);
  assert.equal(result.items[0].createId, saved.items[0].createId); assert.equal(result.items[0].files.FRONT instanceof Blob, true);
});

test('busy Front does not hide Back attention or authentication failures', async () => {
  for (const [code, status] of [['PHOTO_HDR_UNSUPPORTED', 422], ['SIGN_IN_REQUIRED', 401]]) {
    const f = fixture();
    f.intake.upload = async (_id, side) => { throw Object.assign(new Error('synthetic refusal'), side === 'FRONT'
      ? { code: 'MANUAL_PROCESSING_BUSY', status: 503 } : { code, status }); };
    const owner = f.importer(); await owner.appendPair(file('front.jpg'), file('back.jpg')); const result = await owner.whenIdle();
    assert.equal(result.items[0].code, code); assert.equal(result.items[0].failure.phase, 'UPLOAD_BACK'); assert.equal(f.pauses, 0);
    assert.equal(f.queued.size, 0); assert.equal(result.items[0].files.BACK instanceof Blob, true);
  }
});

test('pending exact upload receives the preserved batch original as a recovery candidate', async () => {
  const f = fixture(), upload = f.intake.upload, resumes = [];
  // Derive the exact expected original hash; the resume operation owns checking its byte count and hash again.
  const front = file('front.jpg', 'front original');
  const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', await front.arrayBuffer())).toString('hex');
  f.intake.pending = async () => [...f.cards.values()].flatMap(card => card.sides.FRONT.upload ? [] : [{ id: card.cardId, value: {
    kind: 'upload', cardId: card.cardId, input: { side: 'FRONT', sha256 },
  } }]);
  f.intake.resume = async (id, { fallbackFile }) => { resumes.push(await fallbackFile.text()); return upload(id, 'FRONT', 0, fallbackFile); };
  const owner = f.importer(); await owner.appendPair(front, file('back.jpg')); const result = await owner.whenIdle();
  assert.equal(result.items[0].done, true); assert.deepEqual(resumes, ['front original']); assert.equal(f.uploads.length, 2);
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

test('camera saves the Front before any network request and reload resumes the same physical pair', async () => {
  const f = fixture(), first = f.importer();
  const front = file('IMG_0001.jpg', 'exact front original');
  const staged = await first.saveSide('FRONT', front, { source: 'camera' });
  assert.equal(f.creates.size, 0); assert.equal(staged.items.length, 0);
  assert.equal(await staged.draft.files.FRONT.text(), 'exact front original');
  await assert.rejects(first.saveSide('FRONT', file('duplicate.jpg')), /BATCH_IMPORT_SIDE_SAVED/);
  await first.dispose();
  const next = f.importer(), recovered = await next.read();
  assert.equal(recovered.draft.id, staged.draft.id);
  await next.saveSide('BACK', file('IMG_0002.jpg', 'exact back original')); await next.whenIdle();
  const completed = await next.read();
  assert.equal(completed.draft, null); assert.equal(completed.items.length, 1);
  assert.equal(completed.items[0].key, staged.draft.id); assert.equal(f.creates.size, 1); assert.equal(f.uploads.length, 2);
});

test('failed Back durability keeps the Front and does not advance, create or overwrite a side', async () => {
  const f = fixture(), owner = f.importer(); await owner.saveSide('FRONT', file('front.jpg', 'front'));
  const originalPut = f.journal.put; f.journal.put = async () => { throw Object.assign(new Error('storage full'), { code: 'BATCH_IMPORT_STORAGE' }); };
  await assert.rejects(owner.saveSide('BACK', file('back.jpg')), /storage full/);
  assert.equal((await owner.read()).items.length, 0); assert.equal((await owner.read()).draft.files.BACK, undefined); assert.equal(f.creates.size, 0);
  f.journal.put = originalPut; await owner.saveSide('BACK', file('back.jpg')); await owner.whenIdle();
  assert.equal(f.creates.size, 1); assert.equal(f.queued.size, 1);
});

test('ten original Front/Back pairs admit durably while every network request is stalled', async () => {
  let saved = null, release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const journal = { get: async () => structuredClone(saved), put: async value => { saved = structuredClone(value); } };
  const owner = createBatchImporter({ journal, cryptoImpl: webcrypto, intake: {}, request: async () => { calls++; await gate; throw Object.assign(new Error('signed out'), { status: 401, code: 'SIGN_IN_REQUIRED' }); } });
  const payload = new Uint8Array(4 * 1024 * 1024), began = performance.now();
  for (let index = 0; index < 10; index++) {
    payload[0] = index; await owner.saveSide('FRONT', file('camera.png', payload));
    payload[0] = 100 + index; await owner.saveSide('BACK', file('camera.png', payload));
  }
  const elapsed = performance.now() - began, queued = await owner.read();
  assert.equal(calls, 1); assert.equal(queued.items.length, 10); assert.equal(queued.draft, null);
  assert.equal(new Set(queued.items.map(item => item.createId)).size, 10);
  assert.ok(elapsed < 60_000, `Local admission took ${elapsed} ms`);
  for (let index = 0; index < 10; index++) {
    assert.equal(new Uint8Array(await queued.items[index].files.FRONT.arrayBuffer())[0], index);
    assert.equal(new Uint8Array(await queued.items[index].files.BACK.arrayBuffer())[0], 100 + index);
  }
  release(); await owner.whenIdle(); assert.equal(calls, 1); // Auth pauses the worker, not capture.
  await owner.saveSide('FRONT', file('next-front.jpg')); await owner.saveSide('BACK', file('next-back.jpg'));
  assert.equal((await owner.read()).items.length, 11); assert.equal(calls, 1); await owner.dispose();
});

test('ordered import requires even originals and explicitly reviewed pairs preserve the chosen order', async () => {
  const { previewOrderedBatchPhotos } = await import('../lib/batch-import.mjs');
  const values = [file('IMG_4.jpg', 'back2'), file('IMG_1.jpg', 'front1'), file('IMG_2.jpg', 'back1'), file('IMG_3.jpg', 'front2')];
  assert.throws(() => previewOrderedBatchPhotos(values.slice(0, 3)), /BATCH_IMPORT_ORDER_COUNT/);
  const reviewed = previewOrderedBatchPhotos([values[1], values[2], values[3], values[0]]);
  assert.equal(await reviewed[0].files.FRONT.text(), 'front1'); assert.equal(await reviewed[1].files.BACK.text(), 'back2');
  const f = fixture(), owner = f.importer(), saved = await owner.appendReviewedPairs(reviewed);
  assert.equal(await saved.items[0].files.FRONT.text(), 'front1'); assert.equal(await saved.items[1].files.BACK.text(), 'back2');
  await owner.whenIdle(); assert.equal(f.queued.size, 2); assert.equal(f.uploads.length, 4);
});

test('local hash failure retains exact card intent and safe stage/native name; resume creates no replacement', async () => {
  let failing = true;
  const f = fixture({ cryptoImpl: { randomUUID, subtle: { digest: (...args) => {
    if (failing) throw new DOMException('PRIVATE RAW ERROR MUST NOT BE RETAINED', 'OperationError');
    return webcrypto.subtle.digest(...args);
  } } } }), owner = f.importer();
  await owner.appendPair(file('private-front.jpg'), file('private-back.jpg')); await owner.whenIdle();
  const before = (await owner.read()).items[0];
  const details=batchImportFailureDetails(before);assert.ok(Number.isFinite(Date.parse(details.at)));
  assert.deepEqual({...details,at:undefined}, { code: 'BATCH_IMPORT_INTERRUPTED', phase: 'HASH_FRONT_BYTES', exceptionName: 'OperationError',at:undefined });
  assert(before.files.FRONT instanceof Blob); assert.equal(f.creates.size, 1); assert.equal(f.uploads.length, 0);
  assert.equal(JSON.stringify(before).includes('PRIVATE RAW ERROR'), false);
  failing = false; await owner.run(); const after = (await owner.read()).items[0];
  assert.equal(after.cardId, before.cardId); assert.equal(after.createId, before.createId); assert.equal(after.enqueueId, before.enqueueId);
  assert.equal(f.creates.size, 1); assert.equal(after.done, true); assert.equal(after.failure, null);
});

test('diagnostic export allowlists metadata and strips photo/name/hash/authority and raw failure text', () => {
  const id=randomUUID(), source={items:[{createId:id,enqueueId:id,cardId:id,label:'PRIVATE CARD NAME',files:{FRONT:file('PRIVATE FILE','PRIVATE PHOTO BYTES')},hashes:{FRONT:'a'.repeat(64)},code:'PHOTO_HDR_UNSUPPORTED',failure:{phase:'UPLOAD_FRONT',exceptionName:'TypeError',message:'PRIVATE ERROR'},cookie:'PRIVATE COOKIE'}],draft:{files:{BACK:file('PRIVATE BACK')}}};
  const exported=batchImportDiagnostics(source), encoded=JSON.stringify(exported);
  assert.equal(exported.items[0].sides.FRONT.hashSaved,true);assert.equal(exported.items[0].sides.FRONT.saved,true);assert.equal(exported.items[0].cardId,id);
  assert.equal(exported.partialPair.BACK,true);assert(!encoded.includes('PRIVATE'));assert(!encoded.includes('a'.repeat(64)));assert(!encoded.includes('cookie'));assert(!encoded.includes('files'));
  assert.deepEqual(batchImportFailureDetails({code:'PRIVATE EXCEPTION MESSAGE',failure:{phase:'PRIVATE PHASE',exceptionName:'PRIVATE NATIVE MESSAGE'}}),{code:'BATCH_IMPORT_INTERRUPTED',phase:'UNKNOWN',exceptionName:'Error'});
  assert.deepEqual(batchImportFailureDetails({code:'PHOTO_HDR_UNSUPPORTED'}),{code:'PHOTO_HDR_UNSUPPORTED',phase:'UNKNOWN',exceptionName:'Error'});
  assert.equal(batchImportFailureDetails({code:{toString:()=> 'PHOTO_HDR_UNSUPPORTED',private:'secret'}}).code,'BATCH_IMPORT_INTERRUPTED');
});

test('export includes only a bounded HTTP status, UTC failure time and opaque request reference',()=>{
 const reference=randomUUID(),at='2026-09-25T06:00:00.123Z';
 assert.deepEqual(batchImportFailureDetails({code:'TEMPORARILY_UNAVAILABLE',failure:{phase:'CREATE_CARD',exceptionName:'Error',status:503,at,reference,url:'PRIVATE'}}),
 {code:'TEMPORARILY_UNAVAILABLE',phase:'CREATE_CARD',exceptionName:'Error',status:503,at,reference});
 const value=batchImportFailureDetails({code:'BATCH_IMPORT_INTERRUPTED',failure:{status:999,at:'PRIVATE TIME',reference:'PRIVATE TOKEN'}});
 assert.deepEqual(value,{code:'BATCH_IMPORT_INTERRUPTED',phase:'UNKNOWN',exceptionName:'Error'});
});
test('a processing status pause still admits the next original locally while a pending deletion blocks admission',async()=>{
 let deleting=false;const f=fixture({isPaused:()=>deleting}),owner=f.importer();await owner.pauseForDiscard();
 await owner.saveSide('FRONT',file('front.jpg'));assert.equal(f.creates.size,0);
 deleting=true;await assert.rejects(owner.saveSide('BACK',file('back.jpg')),{code:'BATCH_IMPORT_BUSY'});
 assert.equal((await owner.read()).draft.files.BACK,undefined);deleting=false;owner.resumeAfterDiscard();
 await owner.saveSide('BACK',file('back.jpg'));await owner.whenIdle();assert.equal(f.creates.size,1);
});
