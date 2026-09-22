import { z } from 'zod';
import { StaffInventoryResearchResultSchema } from './staffInventoryResearch';

const identity = z.string().min(1).max(200).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const candidateId = z.string().regex(/^ebay:\d{6,20}$/);
const revision = z.number().int().min(0).max(2_147_483_646);
const timestamp = z.string().datetime().refine(value => value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
export const StaffInventoryResearchReviewCommandSchema = z.object({
  requestId: z.string().uuid(), jobId: z.string().uuid(), unitId: identity, descriptionEventId: identity,
  inputHash: hash, resultHash: hash, expectedRevision: revision, candidateId,
  decision: z.enum(['confirmed', 'excluded']),
}).strict();
export type StaffInventoryResearchReviewCommand = z.infer<typeof StaffInventoryResearchReviewCommandSchema>;
export const StaffInventoryResearchReviewSnapshotSchema = z.object({
  schema_version: z.literal(1), job_id: z.string().uuid(), unit_id: identity, description_event_id: identity,
  input_hash: hash, result_hash: hash, revision,
  decisions: z.array(z.object({ candidate_id: candidateId, decision: z.enum(['confirmed', 'excluded']), actor_id: identity,
    reviewed_at: timestamp, revision: revision.refine(value => value > 0), request_id: z.string().uuid() }).strict()).max(24),
  updated_at: timestamp.nullable(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.decisions.map(decision => decision.candidate_id)).size !== value.decisions.length
    || new Set(value.decisions.map(decision => decision.revision)).size !== value.decisions.length
    || new Set(value.decisions.map(decision => decision.request_id)).size !== value.decisions.length
    || value.decisions.some(decision => decision.revision > value.revision || value.updated_at !== null && decision.reviewed_at > value.updated_at)
    || (value.revision === 0 ? value.decisions.length !== 0 || value.updated_at !== null
      : !value.decisions.some(decision => decision.revision === value.revision && decision.reviewed_at === value.updated_at))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid research review revision.' });
  }
});
export type StaffInventoryResearchReviewSnapshot = z.infer<typeof StaffInventoryResearchReviewSnapshotSchema>;
export type StaffInventoryResearchReviewProjection = {
  status: 'estimated' | 'unknown'; value_cents: number | null; low_cents: number | null; high_cents: number | null;
  count: number; total_cents: number; selected_candidate_ids: string[]; excluded_candidate_ids: string[]; duplicate_candidate_ids: string[]; reason: string;
};

/** Browser-safe projection of a server-verified immutable result and review.
 * expectedResultHash must come from that result's verified job envelope. The
 * server independently checks canonical bytes; this function does not hash. */
export function projectStaffInventoryResearchReview(input: unknown, snapshot: unknown, expectedResultHash: string): StaffInventoryResearchReviewProjection | null {
  const parsed = StaffInventoryResearchResultSchema.safeParse(input), reviewed = StaffInventoryResearchReviewSnapshotSchema.safeParse(snapshot);
  if (!parsed.success || !reviewed.success || !hash.safeParse(expectedResultHash).success) return null;
  const result = parsed.data, review = reviewed.data;
  if (review.result_hash !== expectedResultHash || review.unit_id !== result.unit_id || review.description_event_id !== result.description_event_id
    || review.decisions.some(decision => !result.selected_candidate_ids.includes(decision.candidate_id))) return null;
  const decisions = new Map(review.decisions.map(decision => [decision.candidate_id, decision.decision]));
  const candidates = new Map(result.candidates.map(candidate => [candidate.id, candidate]));
  const excluded = result.selected_candidate_ids.filter(id => decisions.get(id) === 'excluded');
  const included = result.selected_candidate_ids.filter(id => decisions.get(id) !== 'excluded');
  const unique: string[] = [], duplicates: string[] = [], images = new Set<string>();
  for (const id of [...included].sort()) {
    const image = candidates.get(id)!.image!.sha256;
    if (images.has(image)) duplicates.push(id); else { images.add(image); unique.push(id); }
  }
  // Preserve the legacy saved value boundary until staff actually record a
  // decision. Afterwards duplicate evidence gets no additional arithmetic weight.
  const uniqueIds = new Set(unique);
  const selected = review.revision === 0 && duplicates.length ? included : included.filter(id => uniqueIds.has(id));
  const prices = selected.map(id => candidates.get(id)!.sold_price_cents!);
  const total = prices.reduce((sum, price) => sum + BigInt(price), 0n);
  const base: StaffInventoryResearchReviewProjection = { status: 'unknown', value_cents: null, low_cents: null, high_cents: null,
    count: selected.length, total_cents: Number(total), selected_candidate_ids: selected, excluded_candidate_ids: excluded,
    duplicate_candidate_ids: duplicates, reason: result.estimate.reason };
  if (review.revision === 0 && duplicates.length) return { ...base, reason: 'Saved research contains repeated listing images and needs staff review.' };
  if (prices.length < 2) return { ...base, reason: review.revision === 0 && !prices.length ? result.estimate.reason : 'Fewer than two eligible comparisons with distinct images remain.' };
  const value = Number((total * 2n + BigInt(prices.length)) / (2n * BigInt(prices.length)));
  if (!Number.isSafeInteger(Number(total))) return null;
  return { ...base, status: 'estimated', value_cents: value, low_cents: Math.min(...prices), high_cents: Math.max(...prices),
    reason: review.revision === 0 ? result.estimate.reason : 'Mean of the remaining eligible comparisons after saved staff review, excluding shipping.' };
}
