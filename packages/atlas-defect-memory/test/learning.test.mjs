import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixtures } from './fixtures.mjs';
import { buildReviewedLessons } from '../src/lessons.mjs';
import { buildReviewedFeedback } from '../src/feedback.mjs';
import { createLearningPublicationWorker, createLearningPublicationRepository } from '../src/publication-worker.mjs';
import { createDefectMemory } from '../src/index.mjs';
import { canonical, digest, retrievalDigest } from '../src/contract.mjs';
import { selectDefectLessons } from '../src/retrieval-policy.mjs';
import { readActiveLearning } from '../src/active-retrieval.mjs';
import { loadAvailableLessonImages } from '../src/lesson-availability.mjs';
import { inputFixture, withLessons, lesson } from '../../atlas-defect-analysis/test/fixtures.mjs';
import { buildAstraDefectRequest, restorePreparedRequest } from '../../atlas-defect-analysis/src/index.mjs';

test('explicitly inspected zero findings capture clean candidate labels; uninspected and unconfirmed never do', async () => {
  const f = fixtures({ empty: true }), hydrated = await f.hydrate();
  const bundle = await buildReviewedLessons({ confirmation: f.confirmation, hydrate: f.hydrate, createExemplar: f.createExemplar });
  assert.equal(bundle.lessons.length, 0);
  const feedback = buildReviewedFeedback({ confirmation: f.confirmation, hydrated, bundle });
  assert.equal(feedback.sha256, digest(feedback.document));
  const value = JSON.parse(feedback.document); assert.equal(value.activation, 'CANDIDATE_ONLY');
  assert.deepEqual(value.examples.map(e => e.label), ['INSPECTED_NO_DEFECT', 'INSPECTED_NO_DEFECT']);
  const unsafe = structuredClone(hydrated); unsafe.defects.sides.FRONT.inspection = null;
  assert.throws(() => buildReviewedFeedback({ confirmation: f.confirmation, hydrated: unsafe, bundle }), { code: 'MEMORY_INSPECTION_REQUIRED' });
  unsafe.defects.confirmation = null;
  assert.throws(() => buildReviewedFeedback({ confirmation: f.confirmation, hydrated: unsafe, bundle }), { code: 'MEMORY_CONFIRMATION_REQUIRED' });
});
test('geometry candidates retain before/after frame transforms and remain separate from defect exemplars', async () => {
  const f = fixtures(), hydrated = structuredClone(await f.hydrate());
  const quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  for (const side of ['FRONT', 'BACK']) Object.assign(hydrated.geometry.sides[side], {
    physical: { quad, actor: 'HUMAN' }, printed: { quad, actor: 'HUMAN' }, cornerShape: 'ROUNDED',
    confirmation: { actor: 'HUMAN' }, prepared: { frame: { id: `${side}-frame`, sourceToRectified: [1,0,0,0,1,0,0,0,1] } },
  });
  hydrated.finalReview = { originalGeometry: structuredClone(hydrated.geometry), report: {}, reportHash: digest('synthetic-report') };
  hydrated.geometry.sides.FRONT.printed.quad = quad.map((p, i) => ({ ...p, x: i === 0 ? .01 : p.x }));
  const bundle = await buildReviewedLessons({ confirmation: f.confirmation, hydrate: async () => hydrated, createExemplar: f.createExemplar });
  const feedback = JSON.parse(buildReviewedFeedback({ confirmation: f.confirmation, hydrated, bundle }).document);
  const geometry = feedback.examples.filter(e => e.kind === 'GEOMETRY');
  assert.deepEqual(geometry.map(e => e.label), ['CORRECTED', 'ACCEPTED']);
  assert(geometry.every(e => e.role === 'GEOMETRY_REVIEWER' && e.frame.originalSha256 && e.confirmed.prepared.frame.sourceToRectified));
  assert(bundle.lessons.every(e => !Object.hasOwn(e, 'geometry')));
});
test('prepared feedback is reproducible after publication succeeded but worker completion was interrupted', async () => {
  const f = fixtures(); let published = 0;
  const memory = createDefectMemory({ repository: {
    loadConfirmation: async (_staff, _card, _action, options) => { assert.equal(options.includePublished, true); return { status: 'PENDING', confirmation: f.confirmation }; },
    publish: async () => { published++; return { status: 'PUBLISHED', generation: 1 }; },
  }, hydrate: f.hydrate, createExemplar: f.createExemplar });
  const first = await memory.prepare({}, f.cardId, f.confirmation.actionId), replay = await memory.prepare({}, f.cardId, f.confirmation.actionId);
  assert.equal(first.feedback.sha256, replay.feedback.sha256); assert.equal(published, 2);
});
function workerFixture(prepare) {
  const f = fixtures(), job = { cardId: f.cardId, actionId: f.confirmation.actionId, actorId: f.confirmation.actorId,
    accessVersion: 7, attempts: 1, failures: 0 };
  let claimed = false; const outcomes = [], handles = [];
  const timers = { setInterval: () => ({ unref() {} }), clearInterval() {} };
  const worker = createLearningPublicationWorker({ repository: { claim: async () => claimed ? null : (claimed = true, job),
    renew: async () => true, finish: async (_job, outcome) => { outcomes.push(outcome); return true; } },
    authorityFor: exact => { handles.push(exact); return { actorKind: 'MACHINE', actorId: exact.actorId, accessVersion: exact.accessVersion }; },
    prepare, timers });
  return { worker, outcomes, handles };
}
async function settle(f) { f.worker.start(); for (let i = 0; i < 10; i++) await setImmediate(); await f.worker.stop(); }
test('busy global learning scheduler yields immediately without occupying a transaction lock wait', async () => {
  const statements = [];
  const queue = createLearningPublicationRepository({ boundary: { machineTransaction: async (_authority, work) => work({
    tx: { $queryRawUnsafe: async sql => { statements.push(sql); assert(sql.includes('pg_try_advisory_xact_lock')); return [{ locked: false }]; } },
  }) } });
  assert.equal(await queue.claim(2), null); assert.equal(statements.length, 1);
});
test('background publication uses captured original authority and finishes without any browser/session', async () => {
  const f = workerFixture(async authority => {
    assert.equal(authority.actorKind, 'MACHINE'); assert.equal(authority.accessVersion, 7);
    return { publication: { status: 'PUBLISHED' }, feedback: { document: '{}', sha256: digest('{}') } };
  });
  await settle(f); assert.equal(f.outcomes[0].state, 'PREPARED'); assert.equal(f.handles.length, 1);
});
test('explicit authority revocation holds work; storage outages retry; superseded confirmation stays superseded', async () => {
  for (const [error, expected] of [[{ code: 'MANUAL_MACHINE_ACCESS_REVOKED', status: 403 }, 'HELD'],
    [{ code: 'PHOTO_STORAGE_UNAVAILABLE', status: 503 }, 'QUEUED'], [{ code: 'MEMORY_CONFIRMATION_STALE', status: 409 }, 'SUPERSEDED']]) {
    const f = workerFixture(async () => { throw Object.assign(new Error(error.code), error); });
    await settle(f); assert.equal(f.outcomes[0].state, expected);
  }
});
test('freshness permits eligible-source fallback and stays bound through exact stored ASTRA restoration', () => {
  const input = inputFixture();
  input.knowledge.freshness = { version: 'atlas-learning-freshness-v1', activeReleaseId: 'baseline-20260928',
    activeReleaseSha256: digest('release'), unavailableSources: 3, policy: 'legacy-defect-family-v1', role: 'DEFECT_PROPOSER', fallback: 'BASELINE_WITHOUT_EXAMPLES' };
  input.knowledge.sha256 = retrievalDigest(input.knowledge);
  const prepared = buildAstraDefectRequest(input), restored = restorePreparedRequest(prepared);
  assert.equal(restored.requestHash, prepared.requestHash); assert.equal(restored.evidence.knowledge.freshness.unavailableSources, 3);
  const altered = structuredClone(prepared.evidence); altered.knowledge.freshness.unavailableSources = 0;
  assert.throws(() => restorePreparedRequest({ ...prepared, evidence: altered }));
});
test('balanced candidate retrieval enforces source/label budgets and exact-design negatives deterministically', async () => {
  const f = fixtures(), bundle = await buildReviewedLessons({ confirmation: f.confirmation, hydrate: f.hydrate, createExemplar: f.createExemplar });
  const candidates = Array.from({ length: 8 }, (_, index) => {
    const { id: _id, ...body } = structuredClone(bundle.lessons[0]); body.findingId = `finding-${index}`;
    return { lesson: { ...body, id: digest(canonical(body)) }, generation: 100 - index };
  });
  const target = { cardId: fixtures().cardId, originalSha256: [digest('other-front'), digest('other-back')], design: bundle.design, side: null };
  const selected = selectDefectLessons({ candidates, target });
  assert.equal(selected.lessons.length, 2); assert.equal(selected.decisions.filter(d => d.reason === 'SOURCE_QUOTA').length, 6);
  assert.deepEqual(selectDefectLessons({ candidates: [...candidates].reverse(), target }).lessons, selected.lessons);
  assert.equal(selectDefectLessons({ candidates, target: { ...target, cardId: f.cardId } }).lessons.length, 0);
});
test('one invalid historical exemplar cannot disable other valid lessons; exclusions remain in exact request evidence', async () => {
  const input = withLessons(inputFixture(), [lesson('ACCEPTED'), lesson('REJECTED')]);
  input.knowledge.freshness = { version: 'atlas-learning-freshness-v1', activeReleaseId: 'baseline-20260928',
    activeReleaseSha256: digest('release'), unavailableSources: 0, policy: 'legacy-defect-family-v1', role: 'DEFECT_PROPOSER', fallback: 'ELIGIBLE_EXAMPLES' };
  input.knowledge.sha256 = retrievalDigest(input.knowledge);
  const badId = input.knowledge.lessons[0].id;
  const available = await loadAvailableLessonImages(input.knowledge, async selected => {
    if (selected.lessons[0].id === badId) throw Object.assign(new Error('invalid'), { code: 'DEFECT_LESSON_UNVERIFIED', status: 503 });
    return input.lessonImages.filter(i => i.lessonId === selected.lessons[0].id);
  });
  assert.equal(available.knowledge.lessons.length, 1); assert.equal(available.knowledge.freshness.unavailableLessons[0].id, badId);
  const prepared = buildAstraDefectRequest({ ...input, ...available });
  assert.equal(restorePreparedRequest(prepared).requestHash, prepared.requestHash);
  const missing = await loadAvailableLessonImages(input.knowledge, async () => { throw Object.assign(Error(), { status: 503 }); });
  assert.equal(missing.knowledge.lessons.length, 0); assert.equal(missing.knowledge.freshness.fallback, 'BASELINE_WITHOUT_EXAMPLES');
  await assert.rejects(loadAvailableLessonImages(input.knowledge, async () => { throw Object.assign(Error(), { status: 403 }); }));
});
test('one malformed active lesson is excluded before ranking; all malformed lessons use explicit baseline fallback', async () => {
  const f = fixtures(), bundle = await buildReviewedLessons({ confirmation: f.confirmation, hydrate: f.hydrate, createExemplar: f.createExemplar });
  const invalid = structuredClone(bundle.lessons[0]); invalid.side = 'INVALID';
  const target = { cardId: fixtures().cardId, originalSha256: [digest('other-front'), digest('other-back')], design: bundle.design, side: null, limit: 12 };
  for (const policy of ['legacy-defect-family-v1', 'balanced-defect-v1']) for (const includeValid of [true, false]) {
    const entries = [{ lesson: invalid, generation: 2 }, ...(includeValid ? [{ lesson: bundle.lessons[1], generation: 1 }] : [])];
    const tx = { $queryRawUnsafe: async () => [{ release_id: 'fixture', release_hash: digest('release'), policy,
      selected: entries, generation: 2, unavailable_sources: 0, pending: [] }] };
    const result = await readActiveLearning(tx, target);
    assert.equal(result.lessons.length, includeValid ? 1 : 0);
    assert.equal(result.freshness.unavailableLessons[0].id, invalid.id);
    assert.equal(result.freshness.fallback, includeValid ? 'ELIGIBLE_EXAMPLES' : 'BASELINE_WITHOUT_EXAMPLES');
  }
});
test('evaluated defect releases fall back after runtime model/image/scoring drift while the frozen baseline stays intact', async () => {
  const f = fixtures(), bundle = await buildReviewedLessons({ confirmation: f.confirmation, hydrate: f.hydrate, createExemplar: f.createExemplar });
  const bindings = { modelPromptSha256: digest('model'), imagePolicySha256: digest('image'), scoringPolicySha256: digest('score') };
  const snapshot = { release_id: 'fixture', release_hash: digest('release'), policy: 'balanced-defect-v1', kind: 'EVALUATED_CANDIDATE',
    qualification: { bindings, policySettingsSha256: digest('policy') }, selected: [{ lesson: bundle.lessons[0], generation: 1 }], generation: 1, unavailable_sources: 0, pending: [] };
  const target = { cardId: fixtures().cardId, originalSha256: [digest('other-front'), digest('other-back')], design: bundle.design, side: null, limit: 12, learningBindings: bindings };
  const tx = { $queryRawUnsafe: async () => [snapshot] };
  assert.equal((await readActiveLearning(tx, target)).lessons.length, 1);
  for (const key of Object.keys(bindings)) {
    const result = await readActiveLearning(tx, { ...target, learningBindings: { ...bindings, [key]: digest('changed') } });
    assert.equal(result.lessons.length, 0); assert.equal(result.freshness.qualification.reason, 'RUNTIME_POLICY_CHANGED');
  }
  delete snapshot.qualification; assert.equal((await readActiveLearning(tx, target)).lessons.length, 0);
  snapshot.kind = 'FROZEN_BASELINE'; assert.equal((await readActiveLearning(tx, target)).lessons.length, 1);
});
