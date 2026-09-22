import { z } from 'zod';
import { StaffInventoryResearchDescriptionSchema, StaffInventoryResearchPhotoKeySchema, StaffInventoryResearchReferenceSchema, StaffInventoryResearchCatalogContextSchema } from './staffInventoryResearch';

export const STAFF_INVENTORY_RESEARCH_RECOVERY_LIMITS = Object.freeze({ photoAttempts: 2, automaticRefreshes: 3, maxSnapshotBytes: 131072, recheckMs: 6 * 60 * 60 * 1000, errorBackoffMs: 30 * 60 * 1000 });
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const field = z.enum(['name', 'category', 'manufacturer', 'card_number', 'year', 'set_name', 'variant', 'card_type']);
export const StaffInventoryResearchRecoveryNeedSchema = z.enum(['MISSING_ORIGINAL_PHOTOS', 'MISSING_IDENTITY_FIELDS', 'DESCRIPTION_CONFLICT', 'RECOGNITION_UNAVAILABLE', 'RECOGNITION_FAILED', 'RECOGNITION_DEFERRED', 'CATALOG_UNAVAILABLE', 'MISSING_CATALOG_REFERENCE', 'MISSING_DIAGNOSTIC_EVIDENCE', 'AMBIGUOUS_CATALOG_IDENTITY', 'UNSUPPORTED_CATEGORY']);
const text = (maximum: number) => z.string().min(1).max(maximum).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const photo = z.object({ key: StaffInventoryResearchPhotoKeySchema, sha256: sha }).strict().refine(value => value.key.endsWith(`${value.sha256}.jpg`));
const suggestion = z.object({ value: text(160).nullable(), confidence: z.enum(['high', 'medium', 'low', 'unknown']), evidence: text(240).nullable() }).strict();
export function isStaffInventoryRecoverySourceUrl(value: string): boolean {
  try {
    const url = new URL(value), path = decodeURIComponent(url.pathname), host = url.hostname;
    const domains = ['topps.com', 'paniniamerica.net', 'paninigroup.com', 'upperdeck.com', 'pokemon.com', 'tcdb.com', 'tradingcarddb.com', 'cardboardconnection.com', 'beckett.com', 'sportscardspro.com', 'breakninja.com', 'baseballcardpedia.com'];
    return url.toString() === value && url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && path !== '/'
      && !/[\u0000-\u001f\u007f\\]/.test(path) && !/(?:^|\/)(?:search|searchresults|search-results|login|signin|sign-in|register|account|cart|checkout)(?:[\/._-]|$)/i.test(path)
      && domains.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}
const sourceDiscovery = z.object({ schema_version: z.literal(1), disposition: z.literal('review_required'), demand_sha256: sha, query: text(400), requested_at: z.string().datetime(),
  status: z.enum(['candidates', 'not_found', 'unavailable']), requests: z.array(z.object({ provider: z.enum(['bing_rss', 'duckduckgo_html']), response_sha256: sha.nullable(), status: z.enum(['completed', 'failed', 'oversized', 'cancelled']) }).strict()).max(2),
  candidates: z.array(z.object({ title: text(240), url: z.string().max(2048).refine(isStaffInventoryRecoverySourceUrl), domain: text(253), provider: z.enum(['bing_rss', 'duckduckgo_html']) }).strict().refine(value => isStaffInventoryRecoverySourceUrl(value.url) && new URL(value.url).hostname === value.domain)).max(3),
}).strict();
export const StaffInventoryRecoverySourceSummarySchema = sourceDiscovery.pick({ status: true, candidates: true }).refine(value => (value.status === 'candidates') === (value.candidates.length > 0));
export const StaffInventoryRecoverySourceDiscoverySchema = sourceDiscovery.superRefine((value, ctx) => {
  const completed = new Set(value.requests.filter(request => request.status === 'completed').map(request => request.provider));
  if (new Set(value.requests.map(request => request.provider)).size !== value.requests.length || new Set(value.candidates.map(candidate => candidate.url)).size !== value.candidates.length
    || value.requests.some(request => (request.status === 'completed') !== (request.response_sha256 !== null))
    || value.candidates.some(candidate => !completed.has(candidate.provider))
    || (value.status === 'candidates') !== (value.candidates.length > 0)
    || value.status === 'not_found' && !completed.size || value.status === 'unavailable' && (completed.size > 0 || value.candidates.length > 0)) {
    ctx.addIssue({ code: 'custom', message: 'Source discovery status, requests and candidates must agree.' });
  }
});
export type StaffInventoryRecoverySourceDiscovery = z.infer<typeof StaffInventoryRecoverySourceDiscoverySchema>;
/** Exact original-photo recognition receipt; retained so cheap catalog rechecks never repeat paid OCR. */
export const StaffInventoryRecoveryRecognitionSchema = z.object({
  suggestions: z.object({ name: suggestion, category: suggestion, manufacturer: suggestion, card_number: suggestion, year: suggestion, set_name: suggestion, variant: suggestion, card_type: suggestion }).strict(),
  warnings: z.array(text(240)).max(4),
  provenance: z.object({ model: z.literal('gpt-6-astra'), reasoning_effort: z.literal('low'), identified_at: z.string().datetime(), elapsed_ms: z.number().int().min(0).max(45000),
    stage_timings_ms: z.object({ photo_read: z.number().nonnegative(), ocr: z.number().nonnegative(), model: z.number().nonnegative() }).strict().optional(),
    photos: z.object({ front: photo, back: photo }).strict(),
    ocr: z.object({ provider: z.literal('google_vision'), front: z.enum(['read', 'empty', 'unavailable']), back: z.enum(['read', 'empty', 'unavailable']) }).strict(),
  }).strict(),
}).strict();
export const StaffInventoryResearchRecoveryAssessmentSchema = z.object({
  schema_version: z.literal(1), resolver_version: z.literal('staff-inventory-recovery-identity-v1'), source_input_sha256: sha,
  description_event_id: text(200), description_hash: sha, proposed_description: StaffInventoryResearchDescriptionSchema,
  added_fields: z.array(field).max(8), conflicts: z.array(z.object({ field, saved_value: text(160), suggested_value: text(160), evidence: text(240) }).strict()).max(8), missing_fields: z.array(field).max(8),
  recognition: z.object({ status: z.enum(['not_needed', 'completed', 'unavailable', 'failed', 'deferred']), evidence: StaffInventoryRecoveryRecognitionSchema.nullable() }).strict(),
  references: z.array(StaffInventoryResearchReferenceSchema).max(24), catalog_context: StaffInventoryResearchCatalogContextSchema.nullable(),
  need_codes: z.array(StaffInventoryResearchRecoveryNeedSchema).max(16), evidence_sha256: sha.nullable(), ready_for_research: z.boolean(),
  source_discovery: StaffInventoryRecoverySourceDiscoverySchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.ready_for_research !== (value.evidence_sha256 !== null) || value.ready_for_research && (!value.references.some(reference => reference.kind === 'catalog' && reference.distinguishing_features.length > 0) || value.missing_fields.length || value.conflicts.length || value.need_codes.length)) ctx.addIssue({ code: 'custom', message: 'Recovery requires complete, conflict-free reviewed evidence.' });
  if (value.recognition.status === 'completed' && !value.recognition.evidence) ctx.addIssue({ code: 'custom', message: 'Completed recognition requires its original-photo receipt.' });
  for (const values of [value.added_fields, value.missing_fields]) if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: 'Recovery fields must be unique.' });
});
export type StaffInventoryResearchRecoveryAssessment = z.infer<typeof StaffInventoryResearchRecoveryAssessmentSchema>;
export type StaffInventoryRecoveryRecognition = z.infer<typeof StaffInventoryRecoveryRecognitionSchema>;
export const StaffInventoryResearchRecoveryStatusSchema = z.enum(['pending', 'checking_details', 'waiting_catalog_evidence', 'needs_staff_review', 'waiting_new_evidence', 'research_queued', 'resolved', 'limit_reached']);
export const StaffInventoryResearchRecoverySnapshotSchema = z.object({
  schema_version: z.literal(1), job_id: z.string().uuid(), unit_id: text(200), description_event_id: text(200), input_hash: sha,
  status: StaffInventoryResearchRecoveryStatusSchema, missing_fields: z.array(field).max(8), reason: text(400), checked_at: z.string().datetime().nullable(), next_check_at: z.string().datetime().nullable(),
  photo_attempt_count: z.number().int().min(0).max(2), automatic_refresh_count: z.number().int().min(0).max(3), need_codes: z.array(StaffInventoryResearchRecoveryNeedSchema).max(16).optional(),
  proposal: StaffInventoryResearchDescriptionSchema.nullable(), added_fields: z.array(field).max(8), conflicts: z.array(z.object({ field, saved_value: text(160), suggested_value: text(160), evidence: text(240) }).strict()).max(8),
  source_discovery: StaffInventoryRecoverySourceSummarySchema.optional(),
}).strict();
export type StaffInventoryResearchRecoverySnapshot = z.infer<typeof StaffInventoryResearchRecoverySnapshotSchema>;
