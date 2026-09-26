import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixtures, identity } from './fixtures.mjs';
import { canonical, digest, deriveDesignContext, designKey, retrievalDigest, validateRetrieval } from '../src/contract.mjs';
import { buildReviewedLessons, reviewedCropTransform } from '../src/lessons.mjs';
import { createDefectMemory } from '../src/index.mjs';
import { createDefectMemoryRepository } from '../src/repository.mjs';

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
test('removing an imported proposal publishes one negative lesson with the actual human rejection', async () => {
  const f = fixtures(), state = structuredClone(f.state), finding = state.sides.FRONT.findings[0];
  finding.reviewResultBeforeRemoval = finding.reviewResult; finding.reviewResult = 'REMOVED';
  state.sides.FRONT.humanEditedIds = [finding.id];
  const { defects } = f.finish(state), review = { analysisId: randomUUID(), proposalId: 'removed-original', side: 'FRONT',
    action: 'REJECT', findingId: finding.id, base: { frame: defects.sides.FRONT.frame }, proposal: { defectType: finding.defectType },
    reviewerId: randomUUID(), reviewedAt: new Date().toISOString() };
  const bundle = await buildReviewedLessons({ confirmation: f.confirmation,
    hydrate: async () => ({ geometry: f.geometry, defects, assistance: { reviews: [review] } }), createExemplar: f.createExemplar,
    proposalTrace: async () => { assert.fail('a bound removed finding already owns its exact trace'); } });
  const negatives = bundle.lessons.filter(lesson => lesson.disposition === 'REJECTED');
  assert.equal(negatives.length, 1); assert.equal(negatives[0].findingId, finding.id);
  assert.equal(negatives[0].proposalReview.action, 'REJECT'); assert.equal(negatives[0].proposalReview.reviewerId, review.reviewerId);
});
test('excluded old-frame removal retains explicit audit but never fabricates a crop or a learned negative', async () => {
  const f = fixtures(), state = structuredClone(f.state), slot = state.sides.FRONT, original = structuredClone(slot.findings[0]);
  const sourceImage = { version: 1, originalSha256: slot.frame.originalSha256, frameId: 'working-front', frameSha256: 'a'.repeat(64),
    width: 1600, height: 2400, coordinateSpace: 'ORIENTED_DECODED' };
  const sourceQuad = [{ x: .125, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .125, y: .9 }];
  const sourceFrame = { id: slot.frame.frameId, version: 1, sourceToRectified: [1269/1200, 0, -200*1269/1200, 0, 1777/1920, -240*1777/1920, 0, 0, 1],
    rectified: { sha256: slot.frame.rectifiedImageSha256, width: 1270, height: 1778 },
    inspection: { sha256: slot.frame.inspectionImageSha256, width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } } };
  const { detectorMask, zone, canonicalContour, measurement, ...retained } = original;
  slot.findings = [{ ...retained, reviewResult: 'REMOVED', reviewResultBeforeRemoval: original.reviewResult,
    finalTrace: detectorMask, measurementRegions: [], traceProvenance: { version: 'speedster-trace-provenance-v1',
      sourceViewId: original.sourceViewId, cropTransform: { version: 'speedster-canonical-crop-affine-v1', crop: { x: 0, y: 0, width: 1269, height: 1777 } },
      highlighterStrokes: [], finalTraceSha256: detectorMask.sha256 },
    geometryExclusion: { version: 'atlas-geometry-exclusion-v1', reason: 'TRACE_OUTSIDE_CORRECTED_CARD',
      sourceImage, sourceQuad, sourceFrame, sourceTraceSha256: detectorMask.sha256 } }];
  slot.humanEditedIds = [original.id]; slot.frame = { ...slot.frame, preparationVersion: 2, frameId: 'corrected-front',
    rectifiedImageSha256: 'c'.repeat(64), inspectionImageSha256: 'd'.repeat(64) };
  const { defects } = f.finish(state), review = { analysisId: randomUUID(), proposalId: 'retained-original', side: 'FRONT',
    action: 'REJECT', findingId: original.id, base: { frame: defects.sides.FRONT.frame }, proposal: { defectType: original.defectType },
    reviewerId: randomUUID(), reviewedAt: new Date().toISOString() };
  let crops = 0;
  const bundle = await buildReviewedLessons({ confirmation: f.confirmation,
    hydrate: async () => ({ geometry: f.geometry, defects, assistance: { reviews: [review] } }),
    createExemplar: async input => { assert.equal(input.side, 'BACK'); crops++; return f.createExemplar(input); },
    proposalTrace: async () => { assert.fail('old coordinates must not be rasterized in the new frame'); } });
  assert.equal(crops, 1); assert.equal(bundle.lessons.some(lesson => lesson.side === 'FRONT'), false);
  assert.deepEqual(bundle.retainedObservations, [{ findingId: original.id, side: 'FRONT', reason: 'ORIGINAL_FRAME_NOT_CURRENT',
    sourceFrameId: sourceFrame.id, sourceTraceSha256: detectorMask.sha256 }]);
  assert.deepEqual(defects.sides.FRONT.findings[0].finalTrace, original.detectorMask);
  assert.deepEqual(defects.sides.FRONT.findings[0].geometryExclusion.sourceFrame, sourceFrame);
  assert.equal(review.action, 'REJECT');
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
test('publication persists retained-not-learned audit separately and returns the same count on exact replay', async () => {
  const f = fixtures(), confirmation = structuredClone(f.confirmation);
  const request = canonical({ actionId: confirmation.actionId, action: { type: 'CONFIRM_FINDINGS', reviewed: true, base: f.base } });
  confirmation.requestHash = digest(request);
  const row = { id: f.cardId, owner_id: confirmation.actorId, editors: [], approvers: [], readers: [], revision: 2,
    content: canonical(confirmation.card.draft), content_hash: confirmation.card.contentHash };
  const action = { card_id: f.cardId, action_id: confirmation.actionId, actor_id: confirmation.actorId, result_revision: 2,
    request, request_hash: digest(request), result: canonical({ card: confirmation.card,
      receipt: { actorKind: 'HUMAN', actorId: confirmation.actorId, actionId: confirmation.actionId } }) };
  let saved = null, inserts = 0;
  const principal = { id: confirmation.actorId, role: 'REVIEWER' };
  const tx = { async $queryRawUnsafe(sql, ...args) {
    if (sql.startsWith('SELECT * FROM atlas_manual.card')) return [row];
    if (sql.startsWith('SELECT * FROM atlas_manual.action')) return [action];
    if (sql.startsWith('SELECT * FROM atlas_manual.defect_memory_publication')) return saved ? [saved] : [];
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return [{ locked: '' }];
    if (sql.startsWith('INSERT INTO atlas_manual.defect_memory_publication')) {
      inserts++; saved = { card_id: args[0], action_id: args[1], revision: 1, document: args[7], document_hash: args[8] }; return [saved];
    }
    assert.fail(`Unexpected fixture SQL: ${sql}`);
  } };
  const repository = createDefectMemoryRepository({ boundary: { transaction: async (_staff, work) => work({ tx, principal,
    refresh: async () => ({ principal }) }) } });
  const bundle = { version: 'atlas-reviewed-lessons-v1', design: deriveDesignContext('SPORTS', identity), lessons: [],
    retainedObservations: [{ findingId: 'old-rejected-finding', side: 'FRONT', reason: 'ORIGINAL_FRAME_NOT_CURRENT',
      sourceFrameId: 'old-front-frame', sourceTraceSha256: digest('exact-retained-trace') }] };
  const published = await repository.publish({}, confirmation, bundle);
  assert.equal(published.lessonCount, 0); assert.equal(published.retainedObservationCount, 1);
  assert.deepEqual(JSON.parse(saved.document).retainedObservations, bundle.retainedObservations);
  assert.deepEqual(await repository.publish({}, confirmation, bundle), published);
  assert.deepEqual(await repository.status({}, f.cardId), published); assert.equal(inserts, 1);
  const invalid = structuredClone(bundle); invalid.retainedObservations[0].reason = 'LEARNED';
  await assert.rejects(repository.publish({}, confirmation, invalid), { code: 'MEMORY_PUBLICATION_INVALID' });
  assert.equal(inserts, 1);
});
