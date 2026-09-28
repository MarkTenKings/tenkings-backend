import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectedCardReader } from '../src/card-reader.mjs';
import { createBatchPreparation } from '../src/batch-preparation.mjs';

const SIDES = ['FRONT', 'BACK'];
const failure = code => Object.assign(new Error(code), { code });
function fixture() {
  const staff = { id: 'fixture-staff' }, cardId = 'fixture-card', sourceHash = 'a'.repeat(64);
  const card = { cardId, revision: 4, sourceHash, ready: true,
    sides: Object.fromEntries(SIDES.map(side => [side, { upload: { uploadId: side, source: { ref: side } } }])) };
  const calls = [], state = { card, previewFailure: false, manual: null, readFailureAt: null, reads: 0, beforeFinalRead: null };
  const checked = (name, actualStaff, actualCardId) => {
    assert.equal(actualStaff, staff); assert.equal(actualCardId, cardId); calls.push(name);
  };
  const dependencies = {
    intake: {
      async read(actualStaff, actualCardId) {
        checked('authorize-photo-read', actualStaff, actualCardId);
        if (++state.reads === state.readFailureAt) throw failure('INTAKE_ACCESS_DENIED');
        if (state.reads === 2) state.beforeFinalRead?.();
        return { card: structuredClone(state.card) };
      },
      async readSource(actualStaff, actualCardId, uploadId) {
        checked(`preview-source-${uploadId}`, actualStaff, actualCardId);
        return { photo: { workingFrame: { id: uploadId } } };
      },
    },
    details: { async read(actualStaff, actualCardId) { checked('details', actualStaff, actualCardId); return { revision: 2, details: {} }; } },
    workflow: { service: { async read(actualStaff, actualCardId) {
      checked('manual', actualStaff, actualCardId);
      if (!state.manual) throw failure('MANUAL_CARD_NOT_FOUND');
      return state.manual;
    } } },
    identification: { async status(actualStaff, actualCardId) { checked('identification', actualStaff, actualCardId); return { state: 'COMPLETE' }; } },
    earlyGeometry: { async status(actualStaff, actualCardId) { checked('geometry', actualStaff, actualCardId); return { FRONT: { state: 'READY' }, BACK: { state: 'READY' } }; } },
    async imageReadUrl({ kind, descriptor, photo }) {
      assert.equal(kind, 'original'); assert.equal(descriptor, photo.workingFrame); calls.push(`preview-url-${descriptor.id}`);
      if (state.previewFailure) throw failure('PHOTO_STORAGE_UNAVAILABLE');
      return { url: `https://fixture.invalid/${descriptor.id}` };
    },
  };
  const open = createConnectedCardReader(dependencies);
  return { open, dependencies, staff, cardId, sourceHash, calls, state,
    job: { cardId, sourceHash, uploads: { FRONT: 'FRONT', BACK: 'BACK' }, stage: 'PREPARE' } };
}

test('ordinary interactive card reads retain both previews and current manual state', async () => {
  const f = fixture(); f.state.manual = { revision: 3, draft: { source: { sourceHash: f.sourceHash } } };
  const result = await f.open(f.staff, f.cardId);
  assert.deepEqual(result.previews, { FRONT: { url: 'https://fixture.invalid/FRONT' }, BACK: { url: 'https://fixture.invalid/BACK' } });
  assert.deepEqual(result.manual, { revision: 3, current: true });
  assert.equal(f.calls.filter(call => call === 'authorize-photo-read').length, 2);
  assert.deepEqual(f.calls.filter(call => call.startsWith('preview-')), ['preview-source-FRONT', 'preview-source-BACK', 'preview-url-FRONT', 'preview-url-BACK']);
});

test('only explicit false omits preview reads; all card status and authorization reads remain', async () => {
  const f = fixture(); f.state.previewFailure = true;
  const result = await f.open(f.staff, f.cardId, { includePreviews: false });
  assert.deepEqual(result.previews, {}); assert.equal(result.card.sourceHash, f.sourceHash);
  assert.deepEqual(f.calls, ['authorize-photo-read', 'details', 'manual', 'identification', 'geometry', 'authorize-photo-read']);
  for (const options of [undefined, {}, { includePreviews: true }, { includePreviews: 0 }, { includePreviews: null }]) {
    const normal = fixture(); normal.state.previewFailure = true;
    await assert.rejects(normal.open(normal.staff, normal.cardId, options), error => error.code === 'PHOTO_STORAGE_UNAVAILABLE');
  }
});

for (const changed of ['revision', 'sourceHash']) test(`metadata read retains the final ${changed} fence`, async () => {
  const f = fixture(); f.state.beforeFinalRead = () => { f.state.card[changed] = changed === 'revision' ? 5 : 'b'.repeat(64); };
  await assert.rejects(f.open(f.staff, f.cardId, { includePreviews: false }), error => error.code === 'MANUAL_PHOTOS_CHANGED');
  assert(f.calls.includes('identification')); assert(f.calls.includes('geometry'));
  assert.equal(f.calls.some(call => call.startsWith('preview-')), false);
});

for (const readFailureAt of [1, 2]) test(`metadata read propagates authorization failure at read ${readFailureAt}`, async () => {
  const f = fixture(); f.state.readFailureAt = readFailureAt;
  await assert.rejects(f.open(f.staff, f.cardId, { includePreviews: false }), error => error.code === 'INTAKE_ACCESS_DENIED');
});

test('actual batch preparation uses the metadata reader and cannot fail on an unused preview', async () => {
  const f = fixture(); f.state.previewFailure = true;
  const result = await createBatchPreparation({ connected: { ...f.dependencies, open: f.open } }).run(f.staff, f.job);
  assert.deepEqual(result, { kind: 'ATTENTION', code: 'BATCH_IDENTITY_NEEDS_REVIEW' });
  assert.equal(f.calls.some(call => call.startsWith('preview-')), false);
  assert.equal(f.state.reads, 2);
});

for (const changed of ['sourceHash', 'uploadId']) test(`batch metadata read still rejects changed ${changed}`, async () => {
  const f = fixture();
  if (changed === 'sourceHash') f.job.sourceHash = 'b'.repeat(64);
  else f.job.uploads.FRONT = 'replaced-front';
  await assert.rejects(createBatchPreparation({ connected: { ...f.dependencies, open: f.open } }).run(f.staff, f.job), error => error.code === 'BATCH_PHOTOS_CHANGED');
  assert.equal(f.calls.some(call => call.startsWith('preview-')), false);
});
