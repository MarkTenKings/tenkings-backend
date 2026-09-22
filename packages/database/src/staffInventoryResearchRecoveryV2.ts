import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { StaffInventoryResearchInputSchema, StaffInventoryResearchResultSchema, StaffInventoryResearchRecoveryAssessmentSchema, StaffInventoryResearchRecoverySnapshotSchema,
  StaffInventoryResearchRecoveryStatusSchema, STAFF_INVENTORY_RESEARCH_RECOVERY_LIMITS as LIMITS, type StaffInventoryResearchInput, type StaffInventoryResearchRecoveryAssessment,
  type StaffInventoryResearchRecoverySnapshot, type StaffInventoryRecoverySourceDiscovery } from '@tenkings/shared';
import { canonical, inventoryHash, CardInventoryErrorV2 } from './cardInventoryV2';
import { readWorkflowHistoryV2 } from './inventoryWorkflowV2Read';
import { replayWorkflowEventsV2, type WorkflowStateV2 } from './inventoryWorkflowV2State';
import { syncStaffInventoryResearchV2, STAFF_INVENTORY_RESEARCH_LIMITS_V2 } from './staffInventoryResearchV2';

type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, '$queryRaw'>;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const stateSchema = z.object({ schema_version: z.literal(1), status: StaffInventoryResearchRecoveryStatusSchema, reason: z.string().min(1).max(400), checked_at: z.string().datetime().nullable(),
  source_attempts: z.array(z.object({ lease_token: z.string().uuid(), started_at: z.string().datetime(), demand_sha256: sha }).strict()).max(1),
  scope_attempts: z.array(z.object({ lease_token: z.string().uuid(), started_at: z.string().datetime() }).strict()).max(2),
  photo_attempts: z.array(z.object({ lease_token: z.string().uuid(), started_at: z.string().datetime() }).strict()).max(LIMITS.photoAttempts),
  refreshes: z.array(z.object({ evidence_sha256: sha, at: z.string().datetime(), attempt_count: z.number().int().min(0).max(8), result_hash: sha.nullable(), assessment: StaffInventoryResearchRecoveryAssessmentSchema }).strict()).max(LIMITS.automaticRefreshes),
  assessment: StaffInventoryResearchRecoveryAssessmentSchema.nullable(),
}).strict();
type RecoveryState = z.infer<typeof stateSchema>;
type Row = { id: string; unitId: string; descriptionEventId: string; descriptionHash: string; inputHash: string; input: string; status: string; attemptCount: number; maxAttempts: number;
  result: string | null; resultHash: string | null; recoveryState: string | null; recoveryStateHash: string | null; recoveryNextCheckAt: Date | null; recoveryLeaseToken: string | null; recoveryLeaseExpiresAt: Date | null };
const columns = Prisma.raw('"id", "unitId", "descriptionEventId", "descriptionHash", "inputHash", "input", "status", "attemptCount", "maxAttempts", "result", "resultHash", "recoveryState", "recoveryStateHash", "recoveryNextCheckAt", "recoveryLeaseToken", "recoveryLeaseExpiresAt"');
const fail = (message: string): never => { throw new CardInventoryErrorV2('INTEGRITY', message); };
async function lock(tx: Tx) {
  // Same order as Inventory and authenticated staff reviews. No provider work is
  // performed while these locks or the caller's transaction are held.
  await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(20260907, 4201)`);
  await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(20260908, 4201)`);
  await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(20260911, 4202)`);
}
async function clock(tx: Reader) { return (await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS now`))[0].now; }
function verified(row: Row) {
  const input = StaffInventoryResearchInputSchema.parse(JSON.parse(row.input));
  if (canonical(input) !== row.input || inventoryHash(input) !== row.inputHash || input.unit_id !== row.unitId || input.description_event_id !== row.descriptionEventId || input.description_hash !== row.descriptionHash) fail('Recovery input failed exact revision verification.');
  const result = row.result === null ? null : StaffInventoryResearchResultSchema.parse(JSON.parse(row.result));
  if (result && (canonical(result) !== row.result || inventoryHash(result) !== row.resultHash || result.unit_id !== row.unitId || result.description_event_id !== row.descriptionEventId || result.description_hash !== row.descriptionHash)) fail('Recovery result failed exact revision verification.');
  const state: RecoveryState = row.recoveryState ? stateSchema.parse(JSON.parse(row.recoveryState)) : { schema_version: 1, status: 'pending', reason: 'Automatic recovery is awaiting its first check.', checked_at: null, photo_attempts: [], scope_attempts: [], source_attempts: [], refreshes: [], assessment: null };
  if (row.recoveryState && (canonical(state) !== row.recoveryState || inventoryHash(state) !== row.recoveryStateHash)) fail('Recovery evidence failed verification.');
  if (state.assessment) verifyAssessment(state.assessment, input, row.inputHash);
  for (const refresh of state.refreshes) { verifyAssessment(refresh.assessment, input, row.inputHash); if (refresh.evidence_sha256 !== refresh.assessment.evidence_sha256) fail('Recovery refresh evidence does not match its digest.'); }
  if (new Set(state.refreshes.map(refresh => refresh.evidence_sha256)).size !== state.refreshes.length) fail('Recovery evidence was scheduled more than once.');
  return { input, result, state };
}
function verifyAssessment(assessment: StaffInventoryResearchRecoveryAssessment, input: StaffInventoryResearchInput, inputHash: string) {
  if (assessment.source_input_sha256 !== inputHash || assessment.description_event_id !== input.description_event_id || assessment.description_hash !== input.description_hash) fail('Recovery assessment belongs to another input.');
  if (assessment.added_fields.some(field => field === 'variant' || field === 'card_type') || assessment.proposed_description.variant !== input.description.variant || assessment.proposed_description.card_type !== input.description.card_type) fail('Recovery cannot infer optional variant or card type.');
  for (const field of Object.keys(input.description) as (keyof StaffInventoryResearchInput['description'])[]) {
    if (input.description[field] !== null && assessment.proposed_description[field] !== input.description[field]) fail('Recovery cannot replace a saved human description.');
    if (input.description[field] === null && assessment.proposed_description[field] !== null && !assessment.added_fields.includes(field)) fail('Recovery additions require explicit original-photo provenance.');
  }
  const receipt = assessment.recognition.evidence;
  if (receipt && (receipt.provenance.photos.front.key !== input.front_photo_key || receipt.provenance.photos.back.key !== input.back_photo_key)) fail('Recovery recognition belongs to another photo pair.');
  for (const field of assessment.added_fields) {
    const suggestion = receipt?.suggestions[field];
    if (input.description[field] !== null || !suggestion || suggestion.confidence !== 'high' || !suggestion.evidence || suggestion.value !== assessment.proposed_description[field]) fail('Recovery additions require high-confidence exact-photo evidence.');
  }
}
function eligible(state: WorkflowStateV2, row: Pick<Row, 'unitId' | 'descriptionEventId' | 'descriptionHash'>) {
  const unit = state.units.get(row.unitId);
  return !!unit?.description && unit.description_event_id === row.descriptionEventId && inventoryHash(unit.description) === row.descriptionHash
    && unit.possession === 'recorded' && unit.batch_id === null && state.lots.get(unit.lot_id)?.data.quantity === 1 && !state.cancellations.has(unit.lot_id);
}
async function save(tx: Tx, row: Row, state: RecoveryState, next: Date | null, lease: { token: string; expires: Date } | null = null) {
  const encoded = canonical(stateSchema.parse(state));
  if (Buffer.byteLength(encoded) > LIMITS.maxSnapshotBytes * 4) fail('Recovery evidence exceeds its bounded storage size.');
  await tx.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "recoveryState" = ${encoded}, "recoveryStateHash" = ${inventoryHash(state)}, "recoveryNextCheckAt" = ${next}, "recoveryLeaseToken" = ${lease?.token ?? null}, "recoveryLeaseExpiresAt" = ${lease?.expires ?? null} WHERE "id" = ${row.id}`);
}
function snapshot(row: Row): StaffInventoryResearchRecoverySnapshot {
  const { state, result } = verified(row), assessment = state.assessment;
  const resolved = result?.estimate.status === 'estimated';
  const completedRefresh = state.status === 'research_queued' && (row.status === 'complete' || row.status === 'failed');
  return StaffInventoryResearchRecoverySnapshotSchema.parse({ schema_version: 1, job_id: row.id, unit_id: row.unitId, description_event_id: row.descriptionEventId, input_hash: row.inputHash,
    status: resolved ? 'resolved' : completedRefresh ? 'waiting_new_evidence' : state.status,
    reason: resolved ? 'Research now has supported sale evidence.' : completedRefresh ? 'This evidence has been researched. Waiting for meaningful new reviewed evidence.' : state.reason, checked_at: state.checked_at,
    next_check_at: resolved ? null : row.recoveryNextCheckAt?.toISOString() ?? null, photo_attempt_count: state.photo_attempts.length, automatic_refresh_count: state.refreshes.length,
    missing_fields: assessment?.missing_fields ?? [], need_codes: assessment?.need_codes ?? [], proposal: assessment?.proposed_description ?? null, added_fields: assessment?.added_fields ?? [], conflicts: assessment?.conflicts ?? [],
    ...(assessment?.source_discovery ? { source_discovery: { status: assessment.source_discovery.status, candidates: assessment.source_discovery.candidates } } : {}) });
}
/** Read only. No synthetic pending claim, provider work, or queue mutation. */
export async function readStaffInventoryResearchRecoveryV2(db: Reader, args: { jobIds: string[] }): Promise<StaffInventoryResearchRecoverySnapshot[]> {
  const ids = z.array(z.string().uuid()).max(50).refine(value => new Set(value).size === value.length).parse(args.jobIds);
  if (!ids.length) return [];
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`SELECT ${columns} FROM "StaffInventoryResearchJobV2" WHERE "id" IN (${Prisma.join(ids)}) AND "status" <> 'superseded' AND "recoveryState" IS NOT NULL`);
  return rows.map(snapshot);
}
export type StaffInventoryResearchRecoveryClaimV2 = { jobId: string; leaseToken: string; leaseExpiresAt: string; input: StaffInventoryResearchInput; inputHash: string; expectedResultHash: string | null;
  previousAssessment: StaffInventoryResearchRecoveryAssessment | null; allowRecognition: boolean; allowScopeResolution: boolean };

/** Existing cron's bounded maintenance phase. Derives current eligible stock
 * from the canonical journal, and uses the existing job queue for paid research. */
export async function claimStaffInventoryResearchRecoveryV2(tx: Tx, options: { leaseMs?: number; maxConcurrent?: number } = {}): Promise<StaffInventoryResearchRecoveryClaimV2 | null> {
  const leaseMs = z.number().int().min(1000).max(180000).parse(options.leaseMs ?? 90000), maxConcurrent = z.number().int().min(1).max(2).parse(options.maxConcurrent ?? 2);
  // Read-only cheap probes run before any inventory lock or full history replay.
  // False positives are harmless: only canonical replay can authorize a claim.
  const [due] = await tx.$queryRaw<{ due: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM "StaffInventoryResearchJobV2" j WHERE "status" IN ('queued','complete','failed')
    AND "recoveryNextCheckAt" <= clock_timestamp() AND ("recoveryLeaseExpiresAt" IS NULL OR "recoveryLeaseExpiresAt" <= clock_timestamp())
    AND ("status" <> 'queued' OR "attemptCount" = 0 AND COALESCE("recoveryState"::jsonb ->> 'status', '') <> 'research_queued')
    AND ("result" IS NULL OR "result"::jsonb -> 'estimate' ->> 'status' = 'unknown')
    AND NOT EXISTS (SELECT 1 FROM "StaffInventoryResearchReviewV2" r WHERE r."jobId" = j."id")) AS due`);
  if (!due.due) {
    const [missing] = await tx.$queryRaw<{ missing: boolean }[]>(Prisma.sql`SELECT EXISTS (
      SELECT 1 FROM "InventoryWorkflowEventV2" d, jsonb_array_elements_text(d."content"::jsonb #> '{event,data,unit_ids}') u
      WHERE d."content"::jsonb #>> '{event,event_kind}' = 'item_described'
      AND NOT EXISTS (SELECT 1 FROM "StaffInventoryResearchJobV2" j WHERE j."unitId" = u AND j."status" <> 'superseded')
      AND EXISTS (SELECT 1 FROM "InventoryWorkflowEventV2" receipt WHERE receipt."content"::jsonb #>> '{event,event_kind}' IN ('purchase_received','opening_stock_recorded')
        AND receipt."content"::jsonb #>> '{event,data,quantity}' = '1' AND (receipt."content"::jsonb #> '{event,data,unit_ids}') @> jsonb_build_array(u)
        AND NOT EXISTS (SELECT 1 FROM "InventoryWorkflowEventV2" cancelled WHERE cancelled."content"::jsonb #>> '{event,event_kind}' = 'purchase_cancelled'
          AND cancelled."content"::jsonb #>> '{event,data,lot_id}' = receipt."content"::jsonb #>> '{event,data,lot_id}')) LIMIT 1) AS missing`);
    if (!missing.missing) return null;
  }
  for (const [namespace, key] of [[20260907, 4201], [20260908, 4201], [20260911, 4202]]) {
    const [attempt] = await tx.$queryRaw<{ acquired: boolean }[]>(Prisma.sql`SELECT pg_try_advisory_xact_lock(${namespace}::integer, ${key}::integer) AS acquired`);
    if (!attempt.acquired) return null;
  }
  const at = await clock(tx);
  const [capacity] = await tx.$queryRaw<{ work: bigint; intake: bigint }[]>(Prisma.sql`SELECT
    (SELECT count(*) FROM "StaffInventoryResearchJobV2" WHERE ("status" = 'running' AND "leaseExpiresAt" > ${at}) OR "recoveryLeaseExpiresAt" > ${at}) AS work,
    (SELECT count(*) FROM "StaffInventoryIntakeLeaseV2" WHERE "expiresAt" > ${at}) AS intake`);
  if (capacity.work >= BigInt(maxConcurrent) || capacity.intake >= BigInt(STAFF_INVENTORY_RESEARCH_LIMITS_V2.intakePauseThreshold)) return null;
  const current = replayWorkflowEventsV2(await readWorkflowHistoryV2(tx));
  const ids = [...current.units.values()].filter(unit => unit.description && unit.description_event_id && eligible(current, { unitId: unit.unit_id, descriptionEventId: unit.description_event_id, descriptionHash: inventoryHash(unit.description) })).map(unit => unit.unit_id);
  if (!ids.length) return null;
  const missing = await tx.$queryRaw<{ unitId: string }[]>(Prisma.sql`SELECT candidate AS "unitId" FROM unnest(${ids}::text[]) AS candidate WHERE NOT EXISTS (SELECT 1 FROM "StaffInventoryResearchJobV2" j WHERE j."unitId" = candidate AND j."status" <> 'superseded') ORDER BY candidate LIMIT 5`);
  if (missing.length) await syncStaffInventoryResearchV2(tx, current, missing.map(row => row.unitId));
  const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${columns} FROM "StaffInventoryResearchJobV2" j WHERE "unitId" IN (${Prisma.join(ids)}) AND ("status" IN ('complete', 'failed') OR "status" = 'queued' AND "attemptCount" = 0)
    AND NOT ("status" = 'queued' AND COALESCE("recoveryState"::jsonb ->> 'status', '') = 'research_queued')
    AND "recoveryNextCheckAt" <= ${at} AND ("recoveryLeaseExpiresAt" IS NULL OR "recoveryLeaseExpiresAt" <= ${at})
    AND ("result" IS NULL OR "result"::jsonb -> 'estimate' ->> 'status' = 'unknown')
    AND NOT EXISTS (SELECT 1 FROM "StaffInventoryResearchReviewV2" r WHERE r."jobId" = j."id")
    ORDER BY "recoveryNextCheckAt", "createdAt", "id" LIMIT 20 FOR UPDATE SKIP LOCKED`);
  for (const row of rows) {
    if (!eligible(current, row)) continue;
    const { input, state } = verified(row);
    if (row.attemptCount >= 9 || state.refreshes.length >= LIMITS.automaticRefreshes) { state.status = 'limit_reached'; state.reason = 'Automatic recovery reached its bounded attempt limit. Staff can review the saved details and evidence.'; await save(tx, row, state, null); continue; }
    const token = randomUUID(), expires = new Date(at.getTime() + leaseMs);
    const needsFields = ['name', 'category', 'year', 'manufacturer', 'set_name', 'card_number'].some(field => input.description[field as keyof typeof input.description] === null);
    const allowRecognition = needsFields && !state.assessment?.recognition.evidence && !!input.front_photo_key && !!input.back_photo_key && state.photo_attempts.length < LIMITS.photoAttempts;
    if (allowRecognition) state.photo_attempts.push({ lease_token: token, started_at: at.toISOString() });
    state.status = 'checking_details'; state.reason = 'Checking the saved card details and reviewed catalog evidence.';
    await save(tx, row, state, expires, { token, expires });
    return { jobId: row.id, leaseToken: token, leaseExpiresAt: expires.toISOString(), input, inputHash: row.inputHash, expectedResultHash: row.resultHash, previousAssessment: state.assessment, allowRecognition, allowScopeResolution: state.scope_attempts.length < 2 };
  }
  return null;
}
async function owned(tx: Tx, claim: StaffInventoryResearchRecoveryClaimV2, at: Date) {
  z.string().uuid().parse(claim.jobId); z.string().uuid().parse(claim.leaseToken);
  const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${columns} FROM "StaffInventoryResearchJobV2" WHERE "id" = ${claim.jobId} AND ("status" IN ('complete', 'failed') OR "status" = 'queued' AND "attemptCount" = 0) AND "recoveryLeaseToken" = ${claim.leaseToken} AND "recoveryLeaseExpiresAt" > ${at} FOR UPDATE`);
  if (!row || row.inputHash !== claim.inputHash || row.resultHash !== claim.expectedResultHash) return null;
  const { result } = verified(row);
  if (result?.estimate.status === 'estimated') return null;
  const [review] = await tx.$queryRaw<{ present: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM "StaffInventoryResearchReviewV2" WHERE "jobId" = ${row.id}) AS present`);
  const current = replayWorkflowEventsV2(await readWorkflowHistoryV2(tx));
  if (review.present || !eligible(current, row)) return null;
  return row;
}
export async function completeStaffInventoryResearchRecoveryV2(tx: Tx, args: { claim: StaffInventoryResearchRecoveryClaimV2; assessment: unknown }): Promise<'queued' | 'waiting' | 'stale'> {
  const assessment = StaffInventoryResearchRecoveryAssessmentSchema.parse(args.assessment);
  if (Buffer.byteLength(canonical(assessment)) > LIMITS.maxSnapshotBytes) fail('Recovery assessment exceeds its evidence limit.');
  await lock(tx); const at = await clock(tx), row = await owned(tx, args.claim, at);
  if (!row) return 'stale';
  const { input, state } = verified(row); verifyAssessment(assessment, input, row.inputHash);
  if (state.assessment?.recognition.evidence && canonical(state.assessment.recognition.evidence) !== canonical(assessment.recognition.evidence)) fail('Saved photo recognition cannot be replaced during catalog rechecks.');
  if (!state.assessment?.recognition.evidence && assessment.recognition.evidence && !state.photo_attempts.some(attempt => attempt.lease_token === args.claim.leaseToken)) fail('Photo recovery was not authorized by this lease.');
  if (assessment.catalog_context?.scope_receipt && canonical(assessment.catalog_context.scope_receipt) !== canonical(state.assessment?.catalog_context?.scope_receipt ?? null)
    && !state.scope_attempts.some(attempt => attempt.lease_token === args.claim.leaseToken)) fail('Scope resolution was not authorized by this lease.');
  if (state.assessment?.source_discovery && canonical(state.assessment.source_discovery) !== canonical(assessment.source_discovery ?? null)) fail('Source discovery receipt cannot be replaced.');
  if (assessment.source_discovery && !state.assessment?.source_discovery) {
    const own = state.source_attempts.some(attempt => attempt.lease_token === args.claim.leaseToken && attempt.demand_sha256 === assessment.source_discovery!.demand_sha256);
    const prior = own ? null : await readStaffInventoryResearchRecoverySourcesV2(tx, { demandHash: assessment.source_discovery.demand_sha256 });
    if (!own && canonical(prior) !== canonical(assessment.source_discovery)) fail('Source discovery requires a reserved exact demand or its retained receipt.');
  }
  state.assessment = assessment; state.checked_at = at.toISOString();
  const digest = assessment.evidence_sha256;
  const fresh = assessment.ready_for_research && digest && !state.refreshes.some(refresh => refresh.evidence_sha256 === digest);
  if (fresh && row.attemptCount < 9 && state.refreshes.length < LIMITS.automaticRefreshes) {
    state.refreshes.push({ evidence_sha256: digest, at: at.toISOString(), attempt_count: row.attemptCount, result_hash: row.resultHash, assessment });
    state.status = 'research_queued'; state.reason = 'New supported identity evidence is ready. Automatic research is queued.';
    await save(tx, row, state, new Date(at.getTime() + LIMITS.recheckMs));
    // One attempt per evidence digest, including explicit-retry-exhausted inputs.
    // Original attempts, manual retry authority and result bytes remain intact.
    await tx.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "status" = 'queued', "maxAttempts" = GREATEST("maxAttempts", "attemptCount" + 1), "nextAttemptAt" = ${at}, "updatedAt" = ${at} WHERE "id" = ${row.id}`);
    return 'queued';
  }
  if (state.refreshes.length >= LIMITS.automaticRefreshes || row.attemptCount >= 9) { state.status = 'limit_reached'; state.reason = 'Automatic recovery reached its bounded attempt limit. Staff review is needed.'; }
  else if (assessment.conflicts.length || assessment.missing_fields.length) { state.status = 'needs_staff_review'; state.reason = 'Some saved details remain missing or conflict with the photos. Review the suggested details.'; }
  else if (!assessment.ready_for_research) { state.status = 'waiting_catalog_evidence'; state.reason = 'Waiting for useful reviewed catalog evidence for this exact card.'; }
  else { state.status = 'waiting_new_evidence'; state.reason = 'This evidence has already been researched. Waiting for meaningful new reviewed evidence.'; }
  const unavailable = assessment.need_codes.some(code => ['RECOGNITION_FAILED', 'RECOGNITION_UNAVAILABLE', 'CATALOG_UNAVAILABLE'].includes(code));
  if (unavailable && state.status !== 'limit_reached') { state.status = 'waiting_new_evidence'; state.reason = 'The evidence service was unavailable. Automatic recovery will check again later.'; }
  await save(tx, row, state, state.status === 'limit_reached' ? null : new Date(at.getTime() + (unavailable ? LIMITS.errorBackoffMs : LIMITS.recheckMs)));
  return 'waiting';
}
export async function failStaffInventoryResearchRecoveryV2(tx: Tx, args: { claim: StaffInventoryResearchRecoveryClaimV2 }): Promise<boolean> {
  await lock(tx); const at = await clock(tx), row = await owned(tx, args.claim, at); if (!row) return false;
  const { state } = verified(row); state.checked_at = at.toISOString(); state.status = 'waiting_new_evidence'; state.reason = 'The evidence check was unavailable. Automatic recovery will check again later.';
  await save(tx, row, state, new Date(at.getTime() + LIMITS.errorBackoffMs)); return true;
}

/** The worker reuses exactly the assessment that authorized this paid attempt. */
export async function readStaffInventoryResearchRecoveryAssessmentV2(db: Reader, args: { jobId: string; inputHash: string; attempt: number }): Promise<StaffInventoryResearchRecoveryAssessment | null> {
  const [row] = await db.$queryRaw<Row[]>(Prisma.sql`SELECT ${columns} FROM "StaffInventoryResearchJobV2" WHERE "id" = ${z.string().uuid().parse(args.jobId)} AND "inputHash" = ${sha.parse(args.inputHash)} AND "status" = 'running'`);
  if (!row || row.attemptCount !== args.attempt) return null;
  const { state } = verified(row); return state.refreshes.find(refresh => refresh.attempt_count + 1 === args.attempt)?.assessment ?? null;
}

/** Reserve one bounded paid scope resolution only after a cheap positive catalog lookup. */
export async function reserveStaffInventoryResearchRecoveryScopeV2(tx: Tx, args: { claim: StaffInventoryResearchRecoveryClaimV2 }): Promise<boolean> {
  await lock(tx); const at = await clock(tx), row = await owned(tx, args.claim, at); if (!row) return false;
  const { state } = verified(row);
  if (state.scope_attempts.length >= 2 || state.scope_attempts.some(attempt => attempt.lease_token === args.claim.leaseToken)) return false;
  state.scope_attempts.push({ lease_token: args.claim.leaseToken, started_at: at.toISOString() });
  await save(tx, row, state, row.recoveryNextCheckAt, { token: row.recoveryLeaseToken!, expires: row.recoveryLeaseExpiresAt! });
  return true;
}

/** One bounded source search per exact set demand across all jobs. The queue
 * lock serializes the indexed reservation; failed/crashed searches do not loop. */
export async function reserveStaffInventoryResearchRecoverySourcesV2(tx: Tx, args: { claim: StaffInventoryResearchRecoveryClaimV2; demandHash: string }): Promise<boolean> {
  const demand = sha.parse(args.demandHash);
  await lock(tx); const at = await clock(tx), row = await owned(tx, args.claim, at); if (!row) return false;
  const { state } = verified(row); if (state.source_attempts.length) return false;
  const [prior] = await tx.$queryRaw<{ present: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM "StaffInventoryResearchJobV2" WHERE ("recoveryState"::jsonb -> 'source_attempts') @> ${JSON.stringify([{ demand_sha256: demand }])}::jsonb) AS present`);
  if (prior.present) return false;
  state.source_attempts.push({ lease_token: args.claim.leaseToken, started_at: at.toISOString(), demand_sha256: demand });
  await save(tx, row, state, row.recoveryNextCheckAt, { token: row.recoveryLeaseToken!, expires: row.recoveryLeaseExpiresAt! }); return true;
}
export async function readStaffInventoryResearchRecoverySourcesV2(db: Reader, args: { demandHash: string }): Promise<StaffInventoryRecoverySourceDiscovery | null> {
  const demand = sha.parse(args.demandHash);
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`SELECT ${columns} FROM "StaffInventoryResearchJobV2" WHERE ("recoveryState"::jsonb -> 'source_attempts') @> ${JSON.stringify([{ demand_sha256: demand }])}::jsonb LIMIT 2`);
  if (rows.length > 1) fail('Source demand was reserved more than once.');
  const receipt = rows[0] ? verified(rows[0]).state.assessment?.source_discovery : null;
  return receipt?.demand_sha256 === demand ? receipt : null;
}
