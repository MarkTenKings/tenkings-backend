import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { createCustomerUploader, createBrowserIntakeJournal } from '../lib/intake-journal.mjs';

function fixture() {
  let saved = null; const draftId = randomUUID(), calls = [], cards = [];
  const journal = { get: async () => structuredClone(saved), put: async value => { saved = structuredClone(value); } };
  const request = async (path, { body }) => {
    assert(saved?.items.length > 0, 'Original pair must be committed before the first request'); calls.push({ path, body });
    if (path.endsWith('/cards')) {
      if (!cards.some(card => card.id === body.cardId)) cards.push({ id: body.cardId, uploads: { FRONT: { id: body.front.uploadId, state: 'PENDING' }, BACK: { id: body.back.uploadId, state: 'PENDING' } } });
      return { draft: { id: draftId, cards } };
    }
    const card = cards.find(card => path.includes(card.id)), side = ['FRONT', 'BACK'].find(side => path.includes(card.uploads[side].id));
    if (path.endsWith('/sign')) return card.uploads[side].state === 'VERIFIED' ? { state: 'VERIFIED' } : { state: 'UPLOAD', method: 'PUT', url: 'https://photos.example/original', headers: {} };
    card.uploads[side].state = 'VERIFIED'; return { draft: { id: draftId, cards } };
  };
  return { draftId, calls, cards, journal, request, saved: () => saved };
}
test('customer pair is durable before network, explicit sides retain original bytes and successful uploads release only local blobs', async () => {
  const f = fixture(), puts = [], queue = createCustomerUploader({ ...f, cryptoImpl: webcrypto, put: async (_, blob) => puts.push(await blob.text()) });
  await queue.appendPair(new Blob(['front']), new Blob(['back'])); await queue.whenIdle();
  assert.deepEqual(puts, ['front', 'back']); assert.equal(f.saved().items[0].done, true); assert.equal(f.saved().items[0].files, null);
  assert.equal(f.calls.filter(call => call.path.endsWith('/cards')).length, 1);
});
test('append during upload cannot be overwritten by the earlier upload progress', async () => {
  const f = fixture(); let release, started; const begun = new Promise(resolve => { started = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  let first = true;
  const queue = createCustomerUploader({ ...f, cryptoImpl: webcrypto, put: async () => { if (first) { first = false; started(); await blocked; } } });
  await queue.appendPair(new Blob(['front1']), new Blob(['back1'])); await begun;
  await queue.appendPair(new Blob(['front2']), new Blob(['back2'])); release(); await queue.whenIdle();
  assert.equal(f.saved().items.length, 2); assert(f.saved().items.every(item => item.done)); assert.equal(f.cards.length, 2);
});
test('lost creation reply resumes the same request/card/pair and does not duplicate cards', async () => {
  const f = fixture(); let lost = true;
  const request = async (...args) => { const result = await f.request(...args); if (lost && args[0].endsWith('/cards')) { lost = false; throw Object.assign(Error('lost'), { code: 'UNCONFIRMED_REPLY' }); } return result; };
  const queue = createCustomerUploader({ ...f, request, cryptoImpl: webcrypto, put: async () => {} });
  await queue.appendPair(new Blob(['front']), new Blob(['back'])); await queue.whenIdle();
  const before = structuredClone(f.saved().items[0]); assert(before.files.FRONT instanceof Blob);
  await queue.resume(); assert.equal(f.cards.length, 1); assert.equal(f.saved().items[0].requestId, before.requestId); assert.equal(f.saved().items[0].done, true);
  assert.deepEqual(f.calls.filter(call => call.path.endsWith('/cards')).map(call => call.body), [before.input, before.input]);
});
test('browser quota failure keeps originals with caller and dispatches nothing', async () => {
  const f = fixture(); f.journal.put = async () => { throw Object.assign(Error('quota'), { code: 'BROWSER_SAVE_UNAVAILABLE' }); };
  const queue = createCustomerUploader({ ...f, cryptoImpl: webcrypto });
  await assert.rejects(queue.appendPair(new Blob(['front']), new Blob(['back'])), /quota/); assert.equal(f.calls.length, 0);
});
test('identical sides are retained as a correctable local error and never dispatched', async () => {
  const f = fixture(), queue = createCustomerUploader({ ...f, cryptoImpl: webcrypto });
  await queue.appendPair(new Blob(['same']), new Blob(['same'])); await queue.whenIdle();
  assert.equal(f.calls.length, 0); assert.equal(f.saved().items[0].error, 'DISTINCT_CARD_SIDES_REQUIRED');
  assert(f.saved().items[0].files.FRONT instanceof Blob);
  await queue.discardUnsent(f.saved().items[0].requestId); assert.equal(f.saved().items[0].cancelled, true);
  await queue.resume(); assert.equal(f.calls.length, 0);
});
test('browser journal refuses missing account, draft or IndexedDB before opening any store', () => {
  for (const options of [{}, { accountId: randomUUID(), draftId: randomUUID(), indexedDB: null }]) assert.throws(() => createBrowserIntakeJournal(options), /BROWSER_SAVE_UNAVAILABLE/);
});
test('a locally captured pair adopts stable identities once, even after its upload finishes', async () => {
  const f = fixture(), queue = createCustomerUploader({ ...f, cryptoImpl: webcrypto, put: async () => {} });
  const retained = { requestId: randomUUID(), cardId: randomUUID(), pairId: randomUUID(), uploadIds: { FRONT: randomUUID(), BACK: randomUUID() } };
  const front = new Blob(['preserved front']), back = new Blob(['preserved back']);
  await queue.appendPair(front, back, retained); await queue.whenIdle();
  await queue.appendPair(front, back, retained); await queue.whenIdle();
  assert.equal(f.saved().items.length, 1); assert.equal(f.cards.length, 1);
  assert.equal(f.cards[0].id, retained.cardId); assert.equal(f.saved().items[0].requestId, retained.requestId);
  assert.deepEqual(f.saved().items[0].uploadIds, retained.uploadIds);
  await assert.rejects(queue.appendPair(front, back, { ...retained, pairId: randomUUID() }), /CAPTURE_IDENTITY_CONFLICT/);
});
