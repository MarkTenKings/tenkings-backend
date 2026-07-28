export type AiGraderOcrReviewState =
  | "supported"
  | "unknown"
  | "disagreement";

export const AI_GRADER_OCR_REVIEW_CONFIDENCE_THRESHOLD = 0.8;

const REVIEWABLE_UNRESOLVED_CATALOG_EVIDENCE = new Set([
  "catalog.identity.unresolved",
  "catalog.set.unresolved",
  "catalog.card_number.unresolved",
  "catalog.insert.unresolved",
  "catalog.parallel.unresolved",
]);

export function aiGraderOcrFieldRequiresReview(input: {
  state: AiGraderOcrReviewState;
  confidence: number;
  evidenceRefs: readonly string[];
}) {
  return input.state !== "supported" ||
    input.confidence < AI_GRADER_OCR_REVIEW_CONFIDENCE_THRESHOLD ||
    input.evidenceRefs.some((evidenceRef) =>
      REVIEWABLE_UNRESOLVED_CATALOG_EVIDENCE.has(evidenceRef));
}
