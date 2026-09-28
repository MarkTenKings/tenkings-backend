import { canonical, digest, immutable, requireThat, retrievalDigest, validateRetrieval } from './contract.mjs';

/** An unavailable historical exemplar excludes that lesson, never the current
 * card's authoritative evidence. Old stored requests keep their exact behavior;
 * only lifecycle-aware new retrievals can use this explicit fallback. */
export async function loadAvailableLessonImages(knowledge, readImages) {
  validateRetrieval(knowledge);
  if (!knowledge.freshness) return { knowledge, lessonImages: await readImages(knowledge) };
  const lessons = [], lessonImages = [], unavailableLessons = [...(knowledge.freshness.unavailableLessons ?? [])];
  for (const lesson of knowledge.lessons) {
    try {
      const images = await readImages({ ...knowledge, lessons: [lesson], lessonIds: [lesson.id] });
      requireThat(Array.isArray(images) && images.length === 1 && images[0].lessonId === lesson.id, 503, 'DEFECT_LESSON_UNVERIFIED');
      lessons.push(lesson); lessonImages.push(images[0]);
    } catch (error) {
      // Authentication is never downgraded into memory absence.
      if ([401, 403].includes(error?.status)) throw error;
      unavailableLessons.push({ id: lesson.id, reason: /UNVERIFIED|INVALID|MISMATCH/.test(error?.code ?? '')
        ? 'EXEMPLAR_UNVERIFIED' : 'EXEMPLAR_UNAVAILABLE' });
    }
  }
  if (!unavailableLessons.length) return { knowledge, lessonImages };
  const { sha256: _sha, ...previous } = knowledge;
  const updated = { ...previous, lessons, lessonIds: lessons.map(l => l.id), status: lessons.length ? 'READY' : 'EMPTY_REVIEWED_BANK',
    revision: `m1:${knowledge.generation}:${digest(canonical({ previousRevision: knowledge.revision, unavailableLessons }))}`,
    freshness: { ...knowledge.freshness, unavailableLessons: unavailableLessons.slice(0, 32),
      fallback: lessons.length ? 'ELIGIBLE_EXAMPLES' : 'BASELINE_WITHOUT_EXAMPLES' } };
  return { knowledge: validateRetrieval(immutable({ ...updated, sha256: retrievalDigest(updated) })), lessonImages };
}
