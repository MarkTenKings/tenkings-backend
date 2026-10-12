import { canonical, digest, immutable, object, requireThat, retrievalDigest, validateRetrieval, targetDesignContext, SIDES } from './contract.mjs';
import { buildReviewedLessons } from './lessons.mjs';
import { buildReviewedFeedback } from './feedback.mjs';
export { createLearningPublicationRepository, createLearningPublicationWorker, learningGrantSQL } from './publication-worker.mjs';
export { loadAvailableLessonImages } from './lesson-availability.mjs';
export { createDefectMemoryRepository, defectMemoryGrantSQL, authorizeManualCard } from './repository.mjs';
export { buildReviewedLessons, reviewedCropTransform } from './lessons.mjs';
export { deriveDesignContext, designKey, validateRetrieval, retrievalDigest } from './contract.mjs';
export { readRoleLearning } from './role-repository.mjs';
export { consumeCleanLearning, consumeGeometryLearning, selectRoleLearning, validateLearningRegistry,
  validateReviewerQuality, validateLearningPolicy, normalizeLearningIdentity, geometryLearningConsumerFacts } from './role-learning.mjs';

/** Confirmation commits first. All image effects execute outside the durable
 * transaction, and failed publication remains discoverable from its action. */
export function createDefectMemory({ repository, hydrate, createExemplar, createCleanExemplar = null, proposalTrace = null, buildLessons = buildReviewedLessons, resolveAnalysisEvidence = null }) {
  requireThat(repository && typeof buildLessons === 'function', 500, 'MEMORY_SERVICE_INVALID');
  return Object.freeze({
    status: (staff, cardId, actionId = null) => repository.status(staff, cardId, actionId),
    async publish(staff, cardId, actionId) {
      const loaded = await repository.loadConfirmation(staff, cardId, actionId);
      if (loaded.status !== 'PENDING') return loaded;
      const bundle = await buildLessons({ confirmation: loaded.confirmation, hydrate, createExemplar, proposalTrace, staff });
      // Snapshot before authentication awaits; only trusted effects produce this
      // manifest. Public clients cannot submit lessons or arbitrary asset refs.
      const snapshot = JSON.parse(canonical(bundle, { maxBytes: 1048576 }));
      return repository.publish(staff, loaded.confirmation, snapshot);
    },
    async prepare(staff, cardId, actionId, { signal } = {}) {
      signal?.throwIfAborted();
      const loaded = await repository.loadConfirmation(staff, cardId, actionId, { includePublished: true });
      if (loaded.status !== 'PENDING') return { publication: loaded, feedback: null };
      const hydrated = await hydrate(loaded.confirmation.card);
      const bundle = await buildLessons({ confirmation: loaded.confirmation, hydrate: async () => hydrated,
        createExemplar, proposalTrace, staff });
      signal?.throwIfAborted();
      const analysisEvidence = resolveAnalysisEvidence ? await resolveAnalysisEvidence({ staff, cardId, hydrated }) : null;
      const cleanImages = {};
      if (createCleanExemplar) for (const side of SIDES) {
        const slot = hydrated.defects?.sides?.[side];
        if (slot?.inspection?.inspected === true && !slot.findings.some(f => f.reviewResult !== 'REMOVED')) {
          signal?.throwIfAborted();
          cleanImages[side] = await createCleanExemplar({ staff, card: loaded.confirmation.card, side, frame: slot.frame });
        }
      }
      const feedback = buildReviewedFeedback({ confirmation: loaded.confirmation, hydrated, bundle, analysisEvidence, cleanImages });
      const published = await repository.publish(staff, loaded.confirmation, JSON.parse(canonical(bundle, { maxBytes: 1048576 })));
      return { publication: published, feedback };
    },
    async retrieve(staff, request) {
      object(request, ['cardId', ...Object.keys(request).filter(key => key === 'side' || key === 'limit')]);
      const { side = null, limit = 12 } = request;
      requireThat((side === null || SIDES.includes(side)) && Number.isSafeInteger(limit) && limit > 0 && limit <= 32,
        400, 'MEMORY_RETRIEVAL_INVALID');
      const target = await repository.loadTarget(staff, request.cardId), hydrated = await hydrate(target);
      const { design, missingFields } = targetDesignContext(hydrated.geometry.profile, target.draft.identity);
      if (!design) {
        // loadTarget has authenticated and validated the current saved source.
        // Generation zero is a baseline marker, not a claim that the bank is empty.
        const freshness = { version: 'atlas-incomplete-design-baseline-v1', category: hydrated.geometry.profile,
          reason: 'INCOMPLETE_IDENTITY', missingFields, targetContentHash: target.contentHash, fallback: 'BASELINE_WITHOUT_EXAMPLES' };
        const result = { version: 'atlas-defect-memory-retrieval-v1', revision: `m1:0:${digest(canonical(freshness))}`,
          generation: 0, status: 'BASELINE_WITHOUT_EXAMPLES', freshness, pendingPublications: 0, lessonIds: [], lessons: [] };
        return validateRetrieval({ ...result, sha256: retrievalDigest(result) });
      }
      const snapshot = await repository.readRelevant(staff, { ...request, expectedContentHash: target.contentHash,
        design,
        originalSha256: SIDES.map(side => hydrated.geometry.sides[side].image.originalSha256) });
      const result = { version: 'atlas-defect-memory-retrieval-v1', revision: snapshot.revision, generation: snapshot.generation,
        status: snapshot.pendingPublications > 0 ? 'PUBLICATION_PENDING' : snapshot.lessons.length ? 'READY' : 'EMPTY_REVIEWED_BANK',
        ...(snapshot.freshness ? { freshness: snapshot.freshness } : {}),
        pendingPublications: snapshot.pendingPublications, lessonIds: snapshot.lessons.map(lesson => lesson.id), lessons: snapshot.lessons };
      return validateRetrieval(immutable({ ...result, sha256: retrievalDigest(result) }));
    },
  });
}
