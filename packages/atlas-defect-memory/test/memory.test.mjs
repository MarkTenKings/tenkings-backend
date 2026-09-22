import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixtures, identity } from './fixtures.mjs';
import { canonical, digest, deriveDesignContext, designKey, retrievalDigest, validateRetrieval } from '../src/contract.mjs';
import { buildReviewedLessons, reviewedCropTransform } from '../src/lessons.mjs';
import { createDefectMemory } from '../src/index.mjs';

test('deterministic design scopes separate set, category, parallel and Pokémon layout; card numbers rank within family', () => {
  const first = deriveDesignContext('SPORTS', identity);
  assert.equal(designKey(first), designKey(deriveDesignContext('SPORTS', { ...identity, cardNumber: '2', productSet: '  SYNTHETIC   SET ' })));
  for (const changed of [{ productSet: 'Unrelated' }, { parallel: 'Gold' }, { manufacturer: 'Different' }, { year: '2025' }])
    assert.notEqual(designKey(first), designKey(deriveDesignContext('SPORTS', { ...identity, ...changed })));
  const p = { cardName: 'Synthetic', year: '2026', productSet: 'Synthetic Set', layoutType: 'POKEMON' };
  assert.notEqual(designKey(deriveDesignContext('POKEMON', p)), designKey(deriveDesignContext('POKEMON', { ...p, layoutType: 'TRAINER' })));
});
test('checked masks create exact bounded visual crop transforms and reject altered masks', () => {
  const f = fixtures(), finding = f.defects.sides.FRONT.findings[0], trace = finding.finalTrace ?? finding.detectorMask;
  const transform = reviewedCropTransform(trace, f.defects.sides.FRONT.frame);
  assert.equal(transform.sourceWidth, 1270); assert.equal(transform.sourceHeight, 1778);
  assert(transform.x >= 0 && transform.x + transform.width <= 1270 && transform.height > 0);
  assert.throws(() => reviewedCropTransform({ ...trace, sha256: digest('altered') }, f.defects.sides.FRONT.frame));
});
test('confirmed lessons retain positive, corrected, rejected and missed human-added evidence without SAM metadata', async () => {
  const f = fixtures(), state = structuredClone(f.state), original = state.sides.FRONT.findings[0];
  state.sides.FRONT.findings = [original,
    { ...structuredClone(original), id: 'type-corrected', defectType: 'FRAYING', detectedDefectType: original.defectType, reviewResult: 'TYPE_CORRECTED' },
    { ...structuredClone(original), id: 'rejected', reviewResult: 'REMOVED', reviewResultBeforeRemoval: 'UNREVIEWED' },
    { ...structuredClone(original), id: 'human-added', origin: 'SMART_MARK', reviewResult: 'SMART_MARKED' }];
  state.sides.FRONT.humanEditedIds = ['type-corrected', 'rejected', 'human-added'];
  const { defects } = f.finish(state);
  const bundle = await buildReviewedLessons({ confirmation: f.confirmation, hydrate: async () => ({ geometry: f.geometry, defects }), createExemplar: f.createExemplar });
  assert.deepEqual(bundle.lessons.filter(l => l.side === 'FRONT').map(l => l.disposition), ['ACCEPTED', 'CORRECTED', 'REJECTED', 'ADDED']);
  assert.equal(bundle.lessons.find(l => l.findingId === 'type-corrected').previousDefectType, original.defectType);
  assert(bundle.lessons.every(l => l.source.actionId === f.confirmation.actionId && l.source.actorId === f.confirmation.actorId));
  assert(!canonical(bundle, { maxBytes: 1048576 }).includes('SAM'));
});
test('unconfirmed lists and machine-only removals cannot become trusted lessons', async () => {
  const f = fixtures();
  await assert.rejects(buildReviewedLessons({ confirmation: f.confirmation, hydrate: async () => ({ geometry: f.geometry, defects: f.state }), createExemplar: f.createExemplar }), { code: 'MEMORY_CONFIRMATION_REQUIRED' });
  const state = structuredClone(f.state), finding = state.sides.FRONT.findings[0];
  finding.reviewResultBeforeRemoval = finding.reviewResult; finding.reviewResult = 'REMOVED';
  const { defects } = f.finish(state);
  const bundle = await buildReviewedLessons({ confirmation: f.confirmation, hydrate: async () => ({ geometry: f.geometry, defects }), createExemplar: f.createExemplar });
  assert(!bundle.lessons.some(l => l.findingId === finding.id));
});
test('Astra proposal acceptance, corrected type and explicit rejection retain original review provenance', async () => {
  const f = fixtures(), state = structuredClone(f.state), finding = state.sides.FRONT.findings[0];
  finding.origin = 'SMART_MARK'; finding.reviewResult = 'SMART_MARKED'; state.sides.FRONT.humanEditedIds = [finding.id];
  const { defects } = f.finish(state), review = { analysisId: randomUUID(), proposalId: 'proposal-1', side: 'FRONT',
    action: 'ACCEPT', findingId: finding.id, base: { frame: defects.sides.FRONT.frame }, proposal: { defectType: finding.defectType, outline: [[1, 1], [2, 1], [2, 2]] },
    reviewerId: randomUUID(), reviewedAt: new Date().toISOString() };
  const rejected = { ...review, proposalId: 'proposal-2', action: 'REJECT', findingId: null };
  const bundle = await buildReviewedLessons({ confirmation: f.confirmation,
    hydrate: async () => ({ geometry: f.geometry, defects, assistance: { reviews: [review, rejected] } }), createExemplar: f.createExemplar,
    proposalTrace: async () => finding.finalTrace ?? finding.detectorMask });
  assert.equal(bundle.lessons.find(l => l.findingId === finding.id).disposition, 'ACCEPTED');
  const negative = bundle.lessons.find(l => l.proposalReview?.action === 'REJECT');
  assert.equal(negative.disposition, 'REJECTED'); assert.equal(negative.proposalReview.reviewerId, review.reviewerId);
});
test('exemplar cannot substitute another source, crop transform or trace hash', async () => {
  const f = fixtures();
  for (const mutate of [value => { value.crop.ref.cardId = randomUUID(); }, value => { value.cropTransform = { ...value.cropTransform, x: 999 }; },
    value => { value.trace.sha256 = digest('wrong trace'); }]) {
    await assert.rejects(buildReviewedLessons({ confirmation: f.confirmation, hydrate: f.hydrate,
      createExemplar: async input => { const value = structuredClone(await f.createExemplar(input)); mutate(value); return value; } }));
  }
});
test('empty reviewed bank differs from pending publication; hashes bind complete retrieval and revision', () => {
  const snapshot = { version: 'atlas-defect-memory-retrieval-v1', generation: 0, revision: `m1:0:${digest('no confirmations')}`,
    status: 'EMPTY_REVIEWED_BANK', pendingPublications: 0, lessons: [], lessonIds: [] };
  const sealed = { ...snapshot, sha256: retrievalDigest(snapshot) };
  assert.equal(validateRetrieval(sealed).status, 'EMPTY_REVIEWED_BANK');
  assert.throws(() => validateRetrieval({ ...sealed, pendingPublications: 1, status: 'PUBLICATION_PENDING' }));
  const pending = { ...snapshot, revision: `m1:0:${digest('new confirmation')}`, pendingPublications: 1, status: 'PUBLICATION_PENDING' };
  assert.notEqual(retrievalDigest(pending), sealed.sha256);
  assert.equal(validateRetrieval({ ...pending, sha256: retrievalDigest(pending) }).status, 'PUBLICATION_PENDING');
});
test('publication effects fail after durable confirmation and retry only its immutable snapshot', async () => {
  const f = fixtures(); let calls = 0, publishes = 0;
  const repository = { loadConfirmation: async () => ({ status: 'PENDING', confirmation: f.confirmation }), publish: async (_staff, input) => {
    assert.equal(input.card.contentHash, f.confirmation.card.contentHash); publishes++; return { status: 'PUBLISHED' }; } };
  const memory = createDefectMemory({ repository, hydrate: f.hydrate, createExemplar: async input => {
    if (calls++ === 0) throw new Error('transient crop failure'); return f.createExemplar(input); } });
  await assert.rejects(memory.publish({}, f.cardId, f.confirmation.actionId), /transient crop failure/); assert.equal(publishes, 0);
  assert.equal((await memory.publish({}, f.cardId, f.confirmation.actionId)).status, 'PUBLISHED'); assert.equal(publishes, 1);
});
