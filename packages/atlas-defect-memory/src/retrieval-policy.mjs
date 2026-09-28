import { immutable, requireThat, designKey, validateLesson } from './contract.mjs';

export const BALANCED_DEFECT_POLICY = Object.freeze({ version: 'balanced-defect-v1', role: 'DEFECT_PROPOSER',
  maximum: 12, candidateMaximum: 96, perSourceMaximum: 2, perDispositionMaximum: 4 });

/** Candidate policy. The current release keeps the legacy order. This policy
 * can only enter serving through an independently evaluated release manifest.
 * Geometry, clean-side absence claims and grading rules are separate consumers. */
export function selectDefectLessons({ candidates, target, limit = 12 }) {
  requireThat(Array.isArray(candidates) && candidates.length <= BALANCED_DEFECT_POLICY.candidateMaximum
    && Number.isInteger(limit) && limit >= 1 && limit <= BALANCED_DEFECT_POLICY.maximum, 503, 'MEMORY_RETRIEVAL_INVALID');
  const decisions = [], eligible = [], seen = new Set();
  for (const entry of candidates) {
    const lesson = validateLesson(entry.lesson);
    let excluded = null;
    if (seen.has(lesson.id)) excluded = 'DUPLICATE';
    else if (lesson.source.cardId === target.cardId || target.originalSha256.includes(lesson.source.frame.originalSha256)) excluded = 'SAME_SOURCE';
    else if (designKey(lesson.design) !== designKey(target.design)) excluded = 'DESIGN_MISMATCH';
    else if (target.side && lesson.side !== target.side) excluded = 'SIDE_MISMATCH';
    else if (lesson.disposition === 'REJECTED' && (!target.design.cardNumber || lesson.design.cardNumber !== target.design.cardNumber)) excluded = 'NEGATIVE_REQUIRES_EXACT_DESIGN';
    seen.add(lesson.id);
    if (excluded) decisions.push({ id: lesson.id, selected: false, reason: excluded });
    else eligible.push({ ...entry, lesson, exact: target.design.cardNumber !== null && lesson.design.cardNumber === target.design.cardNumber });
  }
  // Stable identity resolves ties. Recency does not make a label more correct.
  eligible.sort((a, b) => Number(b.exact) - Number(a.exact) || a.lesson.id.localeCompare(b.lesson.id));
  const selected = [], sources = new Map(), labels = new Map();
  for (const { lesson, exact } of eligible) {
    const sourceCount = sources.get(lesson.source.cardId) ?? 0, labelCount = labels.get(lesson.disposition) ?? 0;
    const reason = selected.length >= limit ? 'BUDGET' : sourceCount >= BALANCED_DEFECT_POLICY.perSourceMaximum ? 'SOURCE_QUOTA'
      : labelCount >= BALANCED_DEFECT_POLICY.perDispositionMaximum ? 'DISPOSITION_QUOTA' : exact ? 'EXACT_DESIGN' : 'MATCHING_FAMILY';
    const accepted = ['EXACT_DESIGN', 'MATCHING_FAMILY'].includes(reason);
    decisions.push({ id: lesson.id, selected: accepted, reason });
    if (accepted) { selected.push(lesson); sources.set(lesson.source.cardId, sourceCount + 1); labels.set(lesson.disposition, labelCount + 1); }
  }
  return immutable({ policy: BALANCED_DEFECT_POLICY, lessons: selected, decisions });
}
