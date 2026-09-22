import { z } from 'zod';
import { StaffInventoryResearchResultSchema, type StaffInventoryResearchCandidate, type StaffInventoryResearchResult } from './staffInventoryResearch';
import { StaffInventoryResearchReviewSnapshotSchema, projectStaffInventoryResearchReview, type StaffInventoryResearchReviewSnapshot } from '@tenkings/shared';
export { StaffInventoryResearchReviewCommandSchema, StaffInventoryResearchReviewSnapshotSchema, projectStaffInventoryResearchReview } from '@tenkings/shared';
export type { StaffInventoryResearchReviewCommand, StaffInventoryResearchReviewSnapshot } from '@tenkings/shared';
export type StaffInventoryResearchReviewProjection = NonNullable<ReturnType<typeof projectStaffInventoryResearchReview>>;

const identity = z.string().min(1).max(200).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const cents = z.number().int().min(1).max(2_147_483_647);
const timestamp = z.string().datetime().refine(value => value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

export const StaffInventoryResearchReviewResponseSchema = z.object({
  version: z.literal(1), outcome: z.enum(['RECORDED', 'REPLAY']), request_id: z.string().uuid(), recorded_revision: z.number().int().positive(),
  review: StaffInventoryResearchReviewSnapshotSchema,
}).strict().refine(receipt => receipt.recorded_revision <= receipt.review.revision, 'Review receipt precedes its recorded decision.');
export type StaffInventoryResearchReviewResponse = z.infer<typeof StaffInventoryResearchReviewResponseSchema>;
export type StaffInventoryResearchJobWithReview = import('@tenkings/database').StaffInventoryResearchStatusV2 & {
  result_hash: string | null; review: StaffInventoryResearchReviewSnapshot | null;
};

export const StaffInventoryMarketValueSummarySchema = z.object({
  unit_id: identity,
  description_event_id: identity,
  status: z.enum(['queued', 'running', 'failed', 'estimated', 'unknown']),
  value_cents: cents.nullable(), low_cents: cents.nullable(), high_cents: cents.nullable(),
  comp_count: z.number().int().min(0).max(24),
  researched_at: timestamp.nullable(),
  reason: z.string().min(1).max(400).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'estimated') {
    if (value.value_cents === null || value.low_cents === null || value.high_cents === null || value.comp_count < 2 || value.researched_at === null
      || value.low_cents > value.value_cents || value.value_cents > value.high_cents) ctx.addIssue({ code: 'custom', message: 'Incomplete market estimate.' });
  } else if (value.value_cents !== null || value.low_cents !== null || value.high_cents !== null || value.comp_count !== 0
    || value.status !== 'unknown' && value.researched_at !== null) ctx.addIssue({ code: 'custom', message: 'Unavailable research cannot establish a value.' });
});
export type StaffInventoryMarketValueSummary = z.infer<typeof StaffInventoryMarketValueSummarySchema>;

/** A missing unit means there is no current research job. Consumers must also
 * match description_event_id to the current Inventory row before displaying it. */
export const StaffInventoryMarketValueResponseSchema = z.object({
  version: z.literal(1), summaries: z.array(StaffInventoryMarketValueSummarySchema).max(50),
}).strict().refine(value => new Set(value.summaries.map(summary => summary.unit_id)).size === value.summaries.length, 'Duplicate inventory research summary.');
export type StaffInventoryMarketValueResponse = z.infer<typeof StaffInventoryMarketValueResponseSchema>;

export type StaffInventoryMarketCalculation = {
  value_cents: number; low_cents: number; high_cents: number; count: number; total_cents: number;
  selected_candidates: StaffInventoryResearchCandidate[];
};

function calculation(result: StaffInventoryResearchResult): StaffInventoryMarketCalculation | null {
  if (result.estimate.status !== 'estimated') return null;
  const byId = new Map(result.candidates.map(candidate => [candidate.id, candidate]));
  const selected = result.selected_candidate_ids.map(id => byId.get(id)!);
  // Old envelopes can contain A,A,B listing images while satisfying the legacy
  // minimum-two-images rule. Do not silently reweight their persisted estimate.
  if (new Set(selected.map(candidate => candidate.image?.sha256)).size !== selected.length) return null;
  const prices = selected.map(candidate => candidate.sold_price_cents!);
  const count = prices.length;
  const total = prices.reduce((sum, price) => sum + BigInt(price), 0n);
  const value = count ? Number((total * 2n + BigInt(count)) / (2n * BigInt(count))) : null;
  const low = Math.min(...prices), high = Math.max(...prices);
  if (count < 2 || !Number.isSafeInteger(Number(total)) || result.estimate.count !== count || result.estimate.value_cents !== value
    || result.estimate.low_cents !== low || result.estimate.high_cents !== high || value === null) return null;
  return { value_cents: value, low_cents: low, high_cents: high, count, total_cents: Number(total), selected_candidates: selected };
}

/** Validate all version-specific matching/sale evidence before projecting the
 * canonical integer-cent mean. This never discovers or recomputes selections. */
export function getStaffInventoryMarketCalculation(input: unknown, review?: unknown, expectedResultHash?: string | null): StaffInventoryMarketCalculation | null {
  const parsed = StaffInventoryResearchResultSchema.safeParse(input);
  if (!parsed.success) return null;
  if (review === undefined || review === null) return calculation(parsed.data);
  if (!expectedResultHash) return null;
  const snapshot = StaffInventoryResearchReviewSnapshotSchema.safeParse(review);
  if (!snapshot.success) return null;
  const projection = projectStaffInventoryResearchReview(parsed.data, snapshot.data, expectedResultHash);
  if (!projection) return null;
  if (snapshot.data.revision === 0) return calculation(parsed.data);
  if (projection.status !== 'estimated' || projection.value_cents === null || projection.low_cents === null
    || projection.high_cents === null || projection.total_cents === null) return null;
  const candidates = new Map(parsed.data.candidates.map(candidate => [candidate.id, candidate]));
  return { value_cents: projection.value_cents, low_cents: projection.low_cents, high_cents: projection.high_cents,
    count: projection.count, total_cents: projection.total_cents,
    selected_candidates: projection.selected_candidate_ids.map(id => candidates.get(id)!) };
}

const jobEnvelope = z.object({
  unit_id: identity, description_event_id: identity, description_hash: hash, input_hash: hash,
  status: z.enum(['queued', 'running', 'complete', 'failed', 'superseded']),
  completed_at: timestamp.nullable(), result: z.unknown(),
  job_id: z.string().uuid().optional(), result_hash: hash.nullable().optional(), review: z.unknown().optional(),
});

/** Use only after readStaffInventoryResearchV2 has verified the persisted input
 * and result hashes. This adds display/status/binding checks, not DB authority. */
export function summarizeStaffInventoryResearchMarketValue(input: unknown): StaffInventoryMarketValueSummary {
  const job = jobEnvelope.parse(input);
  const summary: StaffInventoryMarketValueSummary = {
    unit_id: job.unit_id, description_event_id: job.description_event_id,
    status: 'unknown', value_cents: null, low_cents: null, high_cents: null,
    comp_count: 0, researched_at: null, reason: 'Saved research needs review before an estimate can be shown.',
  };
  if (job.status === 'queued' || job.status === 'running' || job.status === 'failed') {
    return { ...summary, status: job.status, reason: job.status === 'queued' ? 'Research is queued.'
      : job.status === 'running' ? 'Research is in progress.' : 'Research did not complete. Open research for details.' };
  }
  if (job.status === 'superseded') return { ...summary, reason: 'This research belongs to an earlier card description.' };
  if (!job.completed_at) return summary;
  const parsed = StaffInventoryResearchResultSchema.safeParse(job.result);
  if (!parsed.success) return summary;
  const result = parsed.data;
  if (result.unit_id !== job.unit_id || result.description_event_id !== job.description_event_id || result.description_hash !== job.description_hash) return summary;
  if (job.review !== undefined && job.review !== null) {
    const review = StaffInventoryResearchReviewSnapshotSchema.safeParse(job.review);
    if (!review.success || review.data.job_id !== job.job_id || review.data.unit_id !== job.unit_id
      || review.data.description_event_id !== job.description_event_id || review.data.input_hash !== job.input_hash
      || review.data.result_hash !== job.result_hash || !job.result_hash) return summary;
    const projection = projectStaffInventoryResearchReview(result, review.data, job.result_hash);
    if (!projection) return summary;
    if (review.data.revision > 0) return { ...summary, status: projection.status, value_cents: projection.value_cents, low_cents: projection.low_cents,
      high_cents: projection.high_cents, comp_count: projection.status === 'estimated' ? projection.count : 0,
      researched_at: result.researched_at, reason: projection.reason };
  }
  if (result.estimate.status === 'unknown') return { ...summary, researched_at: result.researched_at, reason: result.estimate.reason };
  const value = calculation(result);
  if (!value) return summary;
  return { ...summary, status: 'estimated', value_cents: value.value_cents, low_cents: value.low_cents, high_cents: value.high_cents,
    comp_count: value.count, researched_at: result.researched_at, reason: result.estimate.reason };
}
