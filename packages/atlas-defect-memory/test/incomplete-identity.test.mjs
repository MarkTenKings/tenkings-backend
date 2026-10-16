import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefectMemory, loadAvailableLessonImages } from '../src/index.mjs';
import { canonical, digest, deriveDesignContext, retrievalDigest, validateRetrieval } from '../src/contract.mjs';
import { fixtures, identity } from './fixtures.mjs';
import { buildReviewedLessons } from '../src/lessons.mjs';
import { contextInputFixture } from '../../atlas-defect-analysis/test/fixtures.mjs';
import { buildAstraContextBackgroundDefectRequestAsync, restorePreparedRequestAsync, validateRequestEvidence } from '../../atlas-defect-analysis/src/index.mjs';

const laMeloIdentity = { cardNumber: 'BD-13', insert: null, manufacturer: 'Topps', parallel: null,
  playerName: 'LaMelo Ball', productSet: 'Topps Chrome — Ball of Duty', year: null };
const pokemonIdentity = { cardName: 'Synthetic Pokémon', productSet: 'Synthetic Set', year: '2026', layoutType: 'POKEMON' };
function targetFixture(profile, targetIdentity) {
  const f = fixtures(), target = { ...f.confirmation.card, revision: 1,
    draft: { ...f.draft, identity: targetIdentity } };
  target.contentHash = digest(canonical(target.draft));
  const calls = [], staff = {};
  const repository = {
    async loadTarget(actor, cardId) { assert.equal(actor, staff); assert.equal(cardId, target.cardId); calls.push('authorized target'); return target; },
    async readRelevant() { assert.fail('Incomplete design must not query or borrow family lessons'); },
  };
  const memory = createDefectMemory({ repository, hydrate: async card => {
    assert.equal(card, target); calls.push('hydrated target'); return { geometry: { ...f.geometry, profile } };
  } });
  return { f, target, staff, calls, repository, memory, retrieve: () => memory.retrieve(staff, { cardId: target.cardId, limit: 12 }) };
}

test('revision-one LaMelo with the observed null year produces a source-bound baseline, without inventing an empty bank', async () => {
  const f = targetFixture('SPORTS', laMeloIdentity), before = structuredClone(f.target), knowledge = await f.retrieve();
  assert.equal(knowledge.status, 'BASELINE_WITHOUT_EXAMPLES');
  assert.deepEqual(knowledge.freshness, { version: 'atlas-incomplete-design-baseline-v1', category: 'SPORTS',
    reason: 'INCOMPLETE_IDENTITY', missingFields: ['year'], targetContentHash: f.target.contentHash,
    fallback: 'BASELINE_WITHOUT_EXAMPLES' });
  assert.deepEqual(knowledge.lessons, []); assert.deepEqual(knowledge.lessonIds, []);
  assert.equal(knowledge.pendingPublications, 0); assert.deepEqual(f.target, before);
  assert.deepEqual(f.calls, ['authorized target', 'hydrated target']);
  assert.deepEqual(await loadAvailableLessonImages(knowledge, () => assert.fail('No exemplars are applicable')), { knowledge, lessonImages: [] });
  assert.throws(() => deriveDesignContext('SPORTS', laMeloIdentity), { code: 'MEMORY_EVIDENCE_INVALID' },
    'Incomplete targets never become publishable lesson designs');
});

test('missing set, year, sports manufacturer and Pokémon layout omit lessons for both profiles', async () => {
  for (const [profile, base] of [['SPORTS', identity], ['POKEMON', pokemonIdentity]]) {
    for (const year of [null, undefined, '', '  ']) {
      const target = { ...base, year }; if (year === undefined) delete target.year;
      assert.deepEqual((await targetFixture(profile, target).retrieve()).freshness.missingFields, ['year']);
    }
    const field = profile === 'SPORTS' ? 'manufacturer' : 'layoutType';
    const target = { ...base }; delete target[field];
    assert.deepEqual((await targetFixture(profile, target).retrieve()).freshness.missingFields, [field]);
    assert.deepEqual((await targetFixture(profile, { ...target, year: null }).retrieve()).freshness.missingFields, ['year', field]);
    for (const productSet of [null, undefined, '', '  ']) {
      const missingSet = { ...base, productSet }; if (productSet === undefined) delete missingSet.productSet;
      const knowledge = await targetFixture(profile, missingSet).retrieve();
      assert.deepEqual(knowledge.freshness.missingFields, ['productSet']);
      assert.equal(knowledge.status, 'BASELINE_WITHOUT_EXAMPLES');
    }
    assert.deepEqual((await targetFixture(profile, { ...target, year: null, productSet: null }).retrieve()).freshness.missingFields, ['year', 'productSet', field]);
  }
});

test('absent year does not disguise malformed supplied identity metadata', async () => {
  for (const [profile, base] of [['SPORTS', laMeloIdentity], ['POKEMON', { ...pokemonIdentity, year: null }]]) {
    for (const patch of [{ year: 2026 }, { year: {} }, { year: false }, { year: 'x'.repeat(513) }, { year: '\n' },
      { productSet: {} }, { productSet: 13 }, { parallel: {} }, { cardNumber: 13 },
      ...(profile === 'SPORTS' ? [{ manufacturer: {} }, { insert: false }] : [{ layoutType: 'OTHER' }, { layoutType: {} }])]) {
      await assert.rejects(targetFixture(profile, { ...base, ...patch }).retrieve(),
        error => ['MEMORY_DESIGN_INVALID', 'MEMORY_EVIDENCE_INVALID'].includes(error.code));
    }
  }
});

test('missing identity never suppresses authorization/source errors or bypasses retrieval bounds', async () => {
  const f = targetFixture('SPORTS', laMeloIdentity);
  for (const code of ['SIGN_IN_REQUIRED', 'INTAKE_PAIR_STALE', 'MEMORY_CONFIRMATION_INVALID']) {
    const error = Object.assign(new Error(code), { code });
    f.repository.loadTarget = async () => { throw error; };
    await assert.rejects(f.retrieve(), actual => actual === error);
  }
  for (const request of [{ side: 'LEFT' }, { limit: 0 }, { limit: 33 }])
    await assert.rejects(f.memory.retrieve(f.staff, { cardId: f.target.cardId, ...request }), { code: 'MEMORY_RETRIEVAL_INVALID' });
});

test('complete design keeps valid reviewed lessons and propagates genuine memory failures', async () => {
  const f = targetFixture('SPORTS', identity), source = fixtures();
  const bundle = await buildReviewedLessons({ confirmation: source.confirmation, hydrate: source.hydrate, createExemplar: source.createExemplar });
  const snapshot = { revision: `m1:7:${digest('saved lesson snapshot')}`, generation: 7, pendingPublications: 0, lessons: bundle.lessons };
  f.repository.readRelevant = async (_staff, request) => {
    assert.equal(request.expectedContentHash, f.target.contentHash);
    assert.deepEqual(request.design, deriveDesignContext('SPORTS', identity));
    return snapshot;
  };
  const knowledge = await f.retrieve();
  assert.equal(knowledge.status, 'READY'); assert.equal(knowledge.generation, 7);
  assert.deepEqual(knowledge.lessons, bundle.lessons); assert.equal(knowledge.freshness, undefined);
  const corrupted = structuredClone(snapshot);
  corrupted.lessons[0].source.resultRevision = 1;
  f.repository.readRelevant = async () => corrupted;
  await assert.rejects(f.retrieve(), { code: 'MEMORY_EVIDENCE_INVALID' });
  const error = Object.assign(new Error('MEMORY_PUBLICATION_INVALID'), { code: 'MEMORY_PUBLICATION_INVALID' });
  f.repository.readRelevant = async () => { throw error; };
  await assert.rejects(f.retrieve(), actual => actual === error);
});

test('incomplete-design evidence cannot masquerade as an empty bank or contain unavailable design lessons', async () => {
  const knowledge = await targetFixture('SPORTS', laMeloIdentity).retrieve();
  for (const change of [value => { value.status = 'EMPTY_REVIEWED_BANK'; }, value => { value.freshness.missingFields = []; },
    value => { value.freshness.missingFields = ['playerName']; }, value => { value.freshness.missingFields = ['layoutType']; },
    value => { value.freshness.targetContentHash = digest('different target'); }]) {
    const changed = structuredClone(knowledge); change(changed); changed.sha256 = retrievalDigest(changed);
    assert.throws(() => validateRetrieval(changed), { code: 'MEMORY_RETRIEVAL_INVALID' });
  }
});

test('both profiles can prepare and restore exact baseline Astra requests with all ten images and unchanged model settings', async () => {
  for (const [profile, targetIdentity] of [['SPORTS', { ...laMeloIdentity, productSet: null }], ['POKEMON', { ...pokemonIdentity, year: null, productSet: null, layoutType: null }]]) {
    const f = targetFixture(profile, targetIdentity), input = contextInputFixture();
    input.profile = profile; input.cardId = f.target.cardId; input.binding.manualRevision = 1;
    input.binding.manualContentHash = f.target.contentHash; input.knowledge = await f.retrieve();
    const prepared = await buildAstraContextBackgroundDefectRequestAsync(input);
    validateRequestEvidence(prepared.evidence);
    assert.equal(prepared.request.model, 'gpt-6-astra'); assert.equal(prepared.request.reasoning.effort, 'xhigh');
    const images = prepared.request.input[1].content.filter(value => value.type === 'input_image');
    assert.equal(images.length, 10); assert(images.every(value => value.detail === 'original'));
    assert.deepEqual(prepared.evidence.knowledge.freshness, input.knowledge.freshness);
    const restored = await restorePreparedRequestAsync(structuredClone(prepared));
    assert.equal(restored.requestText, prepared.requestText); assert.equal(restored.evidenceHash, prepared.evidenceHash);
    const wrongTarget = structuredClone(input); wrongTarget.binding.manualContentHash = digest('another saved draft');
    await assert.rejects(buildAstraContextBackgroundDefectRequestAsync(wrongTarget));
  }
});
