import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { StaffInventoryResearchInputSchema, StaffInventoryResearchResultSchema, type StaffInventoryResearchInput, type StaffInventoryResearchResult } from '@tenkings/shared';
import { CardInventoryErrorV2, canonical, inventoryHash } from './cardInventoryV2';
import type { WorkflowStateV2 } from './inventoryWorkflowV2State';

/** The only writer for private staff research proposals and their bounded jobs.
 * It never writes inventory, prices, costs, catalog authority or grading data.
 * Every mutation accepts the caller's READ COMMITTED transaction. */
type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, '$queryRaw'>;
export const STAFF_INVENTORY_RESEARCH_LIMITS_V2 = Object.freeze({
  attemptsPerRun: 3, lifetimeAttempts: 9, explicitRetries: 2, maxConcurrent: 2,
  defaultLeaseMs: 180000, maxLeaseMs: 300000, intakeLeaseMs: 90000,
  intakePauseThreshold: 3, maxReadUnits: 50, maxResultBytes: 524288,
});
const identity = z.string().min(1).max(200).refine(v => v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const StaffInventoryResearchRetryV2 = z.object({
  requestId: z.string().uuid(), jobId: z.string().uuid(), unitId: identity,
  descriptionEventId: identity, inputHash: hash, expectedAttemptCount: z.number().int().min(1).max(9),
}).strict();
export type StaffInventoryResearchRetry = z.infer<typeof StaffInventoryResearchRetryV2>;
export const StaffInventoryResearchStartV2 = z.object({
  action: z.literal('start'), requestId: z.string().uuid(), unitId: identity, descriptionEventId: identity,
}).strict();
type Status = 'queued' | 'running' | 'complete' | 'failed' | 'superseded';
type Attempt = { attempt: number; lease_token: string; started_at: string; completed_at: string; outcome: 'complete' | 'failed' | 'expired' | 'superseded'; error: { code: string; message: string } | null; result: StaffInventoryResearchResult | null };
type Retry = { request_id: string; actor: string; at: string; expected_attempt_count: number };
type Row = {
  id: string; unitId: string; descriptionEventId: string; descriptionHash: string; inputHash: string; input: string;
  status: Status; attemptCount: number; maxAttempts: number; leaseToken: string | null; leaseExpiresAt: Date | null;
  nextAttemptAt: Date; createdAt: Date; updatedAt: Date; startedAt: Date | null; completedAt: Date | null;
  errorCode: string | null; errorMessage: string | null; result: string | null; resultHash: string | null;
  retries: Retry[];
};
// Attempt evidence can be much larger than a current result. Workers and staff
// reads fetch the bounded current envelope only; history stays private in SQL.
const JOB_COLUMNS = Prisma.raw('"id", "unitId", "descriptionEventId", "descriptionHash", "inputHash", "input", "status", "attemptCount", "maxAttempts", "leaseToken", "leaseExpiresAt", "nextAttemptAt", "createdAt", "updatedAt", "startedAt", "completedAt", "errorCode", "errorMessage", "result", "resultHash", "retries"');
const invalid = (message: string): never => { throw new CardInventoryErrorV2('INVALID_INPUT', message); };
const conflict = (message: string): never => { throw new CardInventoryErrorV2('CONFLICT', message); };
const integrity = (message: string): never => { throw new CardInventoryErrorV2('INTEGRITY', message); };
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) return invalid(result.error.issues[0]?.message ?? 'Invalid research request');
  return result.data;
}
async function queueLock(tx: Tx) {
  await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(20260911, 4202)`);
}
async function now(tx: Reader) {
  const [row] = await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS now`);
  return row.now;
}
function verified(row: Row) {
  const input = StaffInventoryResearchInputSchema.parse(JSON.parse(row.input));
  if (inventoryHash(input) !== row.inputHash || input.unit_id !== row.unitId || input.description_event_id !== row.descriptionEventId || input.description_hash !== row.descriptionHash) integrity('Research input does not match its exact inventory revision');
  const result = row.result === null ? null : StaffInventoryResearchResultSchema.parse(JSON.parse(row.result));
  if (result && (inventoryHash(result) !== row.resultHash || result.unit_id !== row.unitId || result.description_event_id !== row.descriptionEventId || result.description_hash !== row.descriptionHash)) integrity('Research evidence does not match its exact inventory revision');
  return { input, result };
}
function canRetry(row: Row) {
  return (row.status === 'failed' || row.status === 'complete' && verified(row).result?.estimate.status === 'unknown') && row.retries.length < STAFF_INVENTORY_RESEARCH_LIMITS_V2.explicitRetries && row.attemptCount < STAFF_INVENTORY_RESEARCH_LIMITS_V2.lifetimeAttempts;
}
function status(row: Row) {
  const { result } = verified(row);
  return {
    job_id: row.id, unit_id: row.unitId, description_event_id: row.descriptionEventId,
    description_hash: row.descriptionHash, input_hash: row.inputHash, status: row.status,
    attempt_count: row.attemptCount, max_attempts: row.maxAttempts, can_retry: canRetry(row),
    queued_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
    started_at: row.startedAt?.toISOString() ?? null, completed_at: row.completedAt?.toISOString() ?? null,
    next_attempt_at: row.status === 'queued' ? row.nextAttemptAt.toISOString() : null,
    error: row.errorCode ? { code: row.errorCode, message: row.errorMessage! } : null, result,
  };
}
export type StaffInventoryResearchStatusV2 = ReturnType<typeof status>;

/** A bulk receipt supplies bookkeeping IDs, not individual card identity. Only
 * an explicit one-unit description with its own photo pair identifies a card. */
export function isIndividuallyDescribedStaffInventoryUnitV2(state: WorkflowStateV2, unitId: string): boolean {
  const unit = state.units.get(unitId);
  if (!unit) return false;
  if (state.lots.get(unit.lot_id)?.data.quantity === 1) return true;
  const event = unit.description_event_id && state.events.get(unit.description_event_id);
  if (!unit.description?.photo_key || !unit.description.back_photo_key
    || unit.description.photo_key.slice(-68) === unit.description.back_photo_key.slice(-68)
    || !event || event.event_kind !== 'item_described' || event.data.unit_ids.length !== 1 || event.data.unit_ids[0] !== unitId) return false;
  // A one-unit edit can inherit a batch's photo defaults. Its target alone must
  // not promote a known shared picture into evidence of that physical card.
  const originals = new Set([unit.description.photo_key.slice(-68), unit.description.back_photo_key.slice(-68)]);
  for (const prior of state.events.values()) {
    if (prior.event_kind !== 'item_described' || prior.data.unit_ids.length < 2) continue;
    const sharedPhoto = [prior.data.description.photo_key, prior.data.description.back_photo_key].some(key => key && originals.has(key.slice(-68)));
    if (sharedPhoto && prior.data.unit_ids.some(id => state.units.get(id)?.lot_id === unit.lot_id)) return false;
  }
  return true;
}

/** Called only from the inventory sole writer with its fully replayed state.
 * A description mutation, including an advanced/backdated edit, supersedes old
 * work in this same transaction. Bulk identity requires a one-card description. */
export async function syncStaffInventoryResearchV2(tx: Tx, state: WorkflowStateV2, unitIds: string[], requested?: { requestId: string; actor: string }) {
  if (requested) { parse(z.string().uuid(), requested.requestId); parse(identity, requested.actor); }
  const affected = new Set(unitIds);
  // A newly shared batch picture also invalidates any same-lot individual job
  // that used that exact picture. Its physical unit may not be an edit target.
  const sharedByLot = new Map<string, Set<string>>();
  for (const id of affected) {
    const unit = state.units.get(id), event = unit?.description_event_id && state.events.get(unit.description_event_id);
    if (!unit || !event || event.event_kind !== 'item_described' || event.data.unit_ids.length < 2) continue;
    const photos = sharedByLot.get(unit.lot_id) ?? new Set<string>();
    for (const key of [event.data.description.photo_key, event.data.description.back_photo_key]) if (key) photos.add(key.slice(-68));
    sharedByLot.set(unit.lot_id, photos);
  }
  for (const [lotId, photos] of sharedByLot) {
    for (const id of state.lots.get(lotId)?.data.unit_ids ?? []) {
      const description = state.units.get(id)?.description;
      if ([description?.photo_key, description?.back_photo_key].some(key => key && photos.has(key.slice(-68)))) affected.add(id);
    }
  }
  const ids = [...affected];
  const describedIds = ids.filter(id => isIndividuallyDescribedStaffInventoryUnitV2(state, id));
  // One bounded query also finds removed or re-grouped units whose previous
  // individual research must be superseded, without N queries for a bulk save.
  const otherIds = ids.filter(id => !describedIds.includes(id));
  const previousIds = otherIds.length ? (await tx.$queryRaw<{ unitId: string }[]>(Prisma.sql`SELECT "unitId" FROM "StaffInventoryResearchJobV2" WHERE "unitId" IN (${Prisma.join(otherIds)}) AND "status" <> 'superseded'`)).map(row => row.unitId) : [];
  const eligibleIds = [...describedIds, ...previousIds];
  if (!eligibleIds.length) return;
  await queueLock(tx);
  const at = await now(tx);
  for (const unitId of eligibleIds) {
    const unit = state.units.get(unitId);
    const description = unit?.description;
    let input: StaffInventoryResearchInput | null = null;
    if (unit && isIndividuallyDescribedStaffInventoryUnitV2(state, unitId) && description && unit.description_event_id) {
      const details = description.card_details;
      input = StaffInventoryResearchInputSchema.parse({ schema_version: 1, unit_id: unitId,
        description_event_id: unit.description_event_id, description_hash: inventoryHash(description),
        description: { name: description.name, category: description.category,
          manufacturer: details?.manufacturer ?? null, card_number: details?.card_number ?? null,
          year: details?.year ?? null, set_name: details?.set_name ?? null,
          variant: details?.variant ?? null, card_type: details?.card_type ?? null },
        front_photo_key: description.photo_key, back_photo_key: description.back_photo_key ?? null });
    }
    const inputHash = input ? inventoryHash(input) : null;
    if (requested) {
      const [prior] = await tx.$queryRaw<{ unitId: string; inputHash: string; requestedBy: string }[]>(Prisma.sql`SELECT "unitId", "inputHash", "requestedBy" FROM "StaffInventoryResearchJobV2" WHERE "startRequestId" = ${requested.requestId}`);
      if (prior && (prior.unitId !== unitId || prior.inputHash !== inputHash || prior.requestedBy !== requested.actor)) conflict('This research request belongs to a different inventory revision or recording actor');
    }
    const abandoned = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${JOB_COLUMNS} FROM "StaffInventoryResearchJobV2" WHERE "unitId" = ${unitId} AND "status" = 'running' AND (${inputHash}::text IS NULL OR "inputHash" <> ${inputHash}) FOR UPDATE`);
    for (const row of abandoned) await appendAttempt(tx, row, at, 'superseded', { code: 'STALE_INPUT', message: 'Staff changed the inventory description or removed this receipt.' }, null);
    await tx.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "status" = 'superseded', "leaseToken" = NULL, "leaseExpiresAt" = NULL, "recoveryLeaseToken" = NULL, "recoveryLeaseExpiresAt" = NULL, "updatedAt" = ${at}
      WHERE "unitId" = ${unitId} AND "status" <> 'superseded' AND (${inputHash}::text IS NULL OR "inputHash" <> ${inputHash})`);
    if (!input) continue;
    await tx.$executeRaw(Prisma.sql`INSERT INTO "StaffInventoryResearchJobV2"
      ("id", "unitId", "descriptionEventId", "descriptionHash", "inputHash", "input", "createdAt", "updatedAt", "nextAttemptAt", "startRequestId", "requestedBy")
      VALUES (${randomUUID()}, ${unitId}, ${input.description_event_id}, ${input.description_hash}, ${inputHash}, ${canonical(input)}, ${at}, ${at}, ${at}, ${requested?.requestId ?? null}, ${requested?.actor ?? null})
      ON CONFLICT ("unitId", "descriptionEventId", "inputHash") DO UPDATE SET
        "status" = CASE WHEN "StaffInventoryResearchJobV2"."result" IS NOT NULL THEN 'complete'
          WHEN "StaffInventoryResearchJobV2"."attemptCount" < "StaffInventoryResearchJobV2"."maxAttempts" THEN 'queued' ELSE 'failed' END,
        "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = ${at}, "nextAttemptAt" = ${at},
        "errorCode" = CASE WHEN "StaffInventoryResearchJobV2"."result" IS NOT NULL THEN NULL
          WHEN "StaffInventoryResearchJobV2"."attemptCount" >= "StaffInventoryResearchJobV2"."maxAttempts" THEN COALESCE("StaffInventoryResearchJobV2"."errorCode", 'ATTEMPT_LIMIT') ELSE "StaffInventoryResearchJobV2"."errorCode" END,
        "errorMessage" = CASE WHEN "StaffInventoryResearchJobV2"."result" IS NOT NULL THEN NULL
          WHEN "StaffInventoryResearchJobV2"."attemptCount" >= "StaffInventoryResearchJobV2"."maxAttempts" THEN COALESCE("StaffInventoryResearchJobV2"."errorMessage", 'This exact research input has reached its automatic attempt limit.') ELSE "StaffInventoryResearchJobV2"."errorMessage" END
      WHERE "StaffInventoryResearchJobV2"."status" = 'superseded'`);
    // Backdated edits can restore an identical later description's inherited
    // fields. Reuse that exact input's existing evidence/budget; never restore
    // an old worker token or create a second job for the same input.
  }
}

export async function acquireStaffInventoryIntakeLeaseV2(tx: Tx, options: { leaseMs?: number } = {}) {
  const leaseMs = parse(z.number().int().min(1000).max(120000), options.leaseMs ?? STAFF_INVENTORY_RESEARCH_LIMITS_V2.intakeLeaseMs);
  await queueLock(tx);
  const at = await now(tx), leaseId = randomUUID(), expiresAt = new Date(at.getTime() + leaseMs);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "StaffInventoryIntakeLeaseV2" WHERE "expiresAt" <= ${at}`);
  await tx.$executeRaw(Prisma.sql`INSERT INTO "StaffInventoryIntakeLeaseV2" ("id", "createdAt", "expiresAt") VALUES (${leaseId}, ${at}, ${expiresAt})`);
  return { leaseId, expiresAt: expiresAt.toISOString() };
}
export async function releaseStaffInventoryIntakeLeaseV2(tx: Tx, leaseId: string) {
  parse(z.string().uuid(), leaseId);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "StaffInventoryIntakeLeaseV2" WHERE "id" = ${leaseId}`);
}

async function appendAttempt(tx: Tx, row: Row, at: Date, outcome: Attempt['outcome'], error: Attempt['error'], result: Attempt['result']) {
  const entry: Attempt = { attempt: row.attemptCount, lease_token: row.leaseToken!, started_at: row.startedAt!.toISOString(), completed_at: at.toISOString(), outcome, error, result };
  await tx.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "attempts" = "attempts" || ${JSON.stringify([entry])}::jsonb WHERE "id" = ${row.id}`);
}
export type StaffInventoryResearchClaimV2 = { jobId: string; leaseToken: string; leaseExpiresAt: string; attempt: number; inputHash: string; input: StaffInventoryResearchInput; recoveryEvidenceHash?: string | null };
export async function claimStaffInventoryResearchV2(tx: Tx, options: { leaseMs?: number; maxConcurrent?: number; requireRecovery?: boolean } = {}): Promise<StaffInventoryResearchClaimV2 | null> {
  const leaseMs = parse(z.number().int().min(1000).max(STAFF_INVENTORY_RESEARCH_LIMITS_V2.maxLeaseMs), options.leaseMs ?? STAFF_INVENTORY_RESEARCH_LIMITS_V2.defaultLeaseMs);
  const maxConcurrent = parse(z.number().int().min(1).max(STAFF_INVENTORY_RESEARCH_LIMITS_V2.maxConcurrent), options.maxConcurrent ?? 1);
  await queueLock(tx);
  const at = await now(tx);
  // Expiry closes only the abandoned exact attempt. A later completion carrying
  // its old owner token cannot alter the reclaimed job or its recorded result.
  const expired = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${JOB_COLUMNS} FROM "StaffInventoryResearchJobV2" WHERE "status" = 'running' AND "leaseExpiresAt" <= ${at} ORDER BY "leaseExpiresAt" LIMIT 20 FOR UPDATE`);
  for (const row of expired) {
    verified(row);
    const [automatic] = await tx.$queryRaw<{ active: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE("recoveryState"::jsonb -> 'refreshes', '[]'::jsonb)) entry WHERE (entry ->> 'attempt_count')::integer + 1 = "attemptCount") AS active FROM "StaffInventoryResearchJobV2" WHERE "id" = ${row.id}`);
    const error = { code: 'LEASE_EXPIRED', message: 'The research worker stopped before recording a result.' };
    await appendAttempt(tx, row, at, 'expired', error, null);
    await tx.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "status" = ${!automatic.active && row.attemptCount < row.maxAttempts ? 'queued' : 'failed'}, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = ${at}, "completedAt" = ${at}, "nextAttemptAt" = ${at}, "errorCode" = ${error.code}, "errorMessage" = ${error.message} WHERE "id" = ${row.id}`);
  }
  const [capacity] = await tx.$queryRaw<{ research: bigint; intake: bigint }[]>(Prisma.sql`SELECT
    (SELECT count(*) FROM "StaffInventoryResearchJobV2" WHERE ("status" = 'running' AND "leaseExpiresAt" > ${at}) OR "recoveryLeaseExpiresAt" > ${at}) AS research,
    (SELECT count(*) FROM "StaffInventoryIntakeLeaseV2" WHERE "expiresAt" > ${at}) AS intake`);
  if (capacity.research >= BigInt(maxConcurrent) || capacity.intake >= BigInt(STAFF_INVENTORY_RESEARCH_LIMITS_V2.intakePauseThreshold)) return null;
  const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${JOB_COLUMNS} FROM "StaffInventoryResearchJobV2" WHERE "status" = 'queued' AND "nextAttemptAt" <= ${at} AND "attemptCount" < "maxAttempts" AND ("recoveryLeaseExpiresAt" IS NULL OR "recoveryLeaseExpiresAt" <= ${at})
    AND (${options.requireRecovery !== true} OR "attemptCount" > 0 OR "recoveryState"::jsonb ->> 'status' = 'research_queued')
    AND (${options.requireRecovery === true} OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE("recoveryState"::jsonb -> 'refreshes', '[]'::jsonb)) entry WHERE (entry ->> 'attempt_count')::integer = "attemptCount"))
    ORDER BY "nextAttemptAt", "createdAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED`);
  if (!row) return null;
  const { input } = verified(row), leaseToken = randomUUID(), leaseExpiresAt = new Date(at.getTime() + leaseMs);
  // Capture automatic authority while the exact job is locked. A later stale
  // assessment read must not turn this paid recovery attempt into a manual run.
  const recovery = await tx.$queryRaw<{ evidenceHash: string }[]>(Prisma.sql`SELECT entry ->> 'evidence_sha256' AS "evidenceHash"
    FROM "StaffInventoryResearchJobV2", jsonb_array_elements(COALESCE("recoveryState"::jsonb -> 'refreshes', '[]'::jsonb)) entry
    WHERE "id" = ${row.id} AND (entry ->> 'attempt_count')::integer = ${row.attemptCount} LIMIT 2`);
  if (recovery.length > 1 || recovery[0] && !/^[a-f0-9]{64}$/.test(recovery[0].evidenceHash)) integrity('Research recovery authority is ambiguous or invalid.');
  await tx.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "status" = 'running', "recoveryLeaseToken" = NULL, "recoveryLeaseExpiresAt" = NULL, "attemptCount" = "attemptCount" + 1, "leaseToken" = ${leaseToken}, "leaseExpiresAt" = ${leaseExpiresAt}, "startedAt" = ${at}, "completedAt" = NULL, "updatedAt" = ${at} WHERE "id" = ${row.id}`);
  return { jobId: row.id, leaseToken, leaseExpiresAt: leaseExpiresAt.toISOString(), attempt: row.attemptCount + 1, inputHash: row.inputHash, input, recoveryEvidenceHash: recovery[0]?.evidenceHash ?? null };
}
async function owned(tx: Tx, jobId: string, leaseToken: string, at: Date) {
  parse(z.string().uuid(), jobId); parse(z.string().uuid(), leaseToken);
  const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${JOB_COLUMNS} FROM "StaffInventoryResearchJobV2" WHERE "id" = ${jobId} AND "status" = 'running' AND "leaseToken" = ${leaseToken} AND "leaseExpiresAt" > ${at} FOR UPDATE`);
  if (row) verified(row);
  return row ?? null;
}
export async function completeStaffInventoryResearchV2(tx: Tx, args: { jobId: string; leaseToken: string; result: unknown }): Promise<boolean> {
  const result = parse(StaffInventoryResearchResultSchema, args.result), encoded = canonical(result);
  if (Buffer.byteLength(encoded) > STAFF_INVENTORY_RESEARCH_LIMITS_V2.maxResultBytes) invalid('Research evidence exceeds its byte limit');
  await queueLock(tx);
  const at = await now(tx), row = await owned(tx, args.jobId, args.leaseToken, at);
  if (!row) return false;
  if (result.unit_id !== row.unitId || result.description_event_id !== row.descriptionEventId || result.description_hash !== row.descriptionHash) conflict('Research result belongs to a different inventory revision');
  const { input } = verified(row);
  for (const side of ['front', 'back'] as const) {
    const key = input[side === 'front' ? 'front_photo_key' : 'back_photo_key'];
    const photo = result.photos[side];
    if (photo && photo.key !== key) conflict('Research result claims a photo from a different inventory input');
  }
  if (Date.parse(result.researched_at) < row.startedAt!.getTime() - 1000 || Date.parse(result.researched_at) > at.getTime() + 1000) conflict('Research result timestamp is outside its owned attempt');
  await appendAttempt(tx, row, at, 'complete', null, result);
  await tx.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "status" = 'complete', "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = ${at}, "completedAt" = ${at}, "result" = ${encoded}, "resultHash" = ${inventoryHash(result)}, "errorCode" = NULL, "errorMessage" = NULL WHERE "id" = ${row.id}`);
  return true;
}
export async function failStaffInventoryResearchV2(tx: Tx, args: { jobId: string; leaseToken: string; errorCode: string; errorMessage: string; retryable: boolean }): Promise<boolean> {
  // These are caller-owned safe public messages, never raw provider exceptions.
  const code = parse(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), args.errorCode);
  const message = parse(z.string().min(1).max(400).refine(v => !/[\u0000-\u001f\u007f]/.test(v)), args.errorMessage);
  parse(z.boolean(), args.retryable);
  await queueLock(tx);
  const at = await now(tx), row = await owned(tx, args.jobId, args.leaseToken, at);
  if (!row) return false;
  const [automatic] = await tx.$queryRaw<{ active: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE("recoveryState"::jsonb -> 'refreshes', '[]'::jsonb)) entry WHERE (entry ->> 'attempt_count')::integer + 1 = "attemptCount") AS active FROM "StaffInventoryResearchJobV2" WHERE "id" = ${row.id}`);
  const retry = args.retryable && !automatic.active && row.attemptCount < row.maxAttempts;
  const next = new Date(at.getTime() + Math.min(300000, 30000 * 2 ** (row.attemptCount - 1)));
  await appendAttempt(tx, row, at, 'failed', { code, message }, null);
  await tx.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "status" = ${retry ? 'queued' : 'failed'}, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = ${at}, "completedAt" = ${at}, "nextAttemptAt" = ${next}, "errorCode" = ${code}, "errorMessage" = ${message} WHERE "id" = ${row.id}`);
  return true;
}
export async function readStaffInventoryResearchV2(db: Reader, args: { unitIds: string[] }): Promise<StaffInventoryResearchStatusV2[]> {
  const ids = parse(z.array(identity).min(1).max(STAFF_INVENTORY_RESEARCH_LIMITS_V2.maxReadUnits).refine(v => new Set(v).size === v.length), args.unitIds);
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`SELECT ${JOB_COLUMNS} FROM "StaffInventoryResearchJobV2" WHERE "unitId" IN (${Prisma.join(ids)}) AND "status" <> 'superseded' ORDER BY "createdAt", "id" LIMIT ${STAFF_INVENTORY_RESEARCH_LIMITS_V2.maxReadUnits}`);
  return rows.map(status);
}
export async function retryStaffInventoryResearchV2(tx: Tx, input: unknown, adminId: string) {
  const d = parse(StaffInventoryResearchRetryV2, input), actor = parse(identity, adminId);
  await queueLock(tx);
  const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${JOB_COLUMNS} FROM "StaffInventoryResearchJobV2" WHERE "id" = ${d.jobId} FOR UPDATE`);
  if (!row || row.unitId !== d.unitId || row.descriptionEventId !== d.descriptionEventId || row.inputHash !== d.inputHash || row.status === 'superseded') conflict('This inventory description changed. Refresh before requesting research.');
  verified(row);
  const previous = row.retries.find(r => r.request_id === d.requestId);
  if (previous) {
    if (previous.actor !== actor || previous.expected_attempt_count !== d.expectedAttemptCount) conflict('Research retry differs from the accepted request');
    return { outcome: 'REPLAY' as const, request_id: d.requestId, job: status(row) };
  }
  if (row.attemptCount !== d.expectedAttemptCount) conflict('Research changed since this retry was prepared. Refresh its status.');
  if (!canRetry(row)) conflict('Research is already active, has an estimate, or has reached its retry limit.');
  const at = await now(tx), retry: Retry = { request_id: d.requestId, actor, at: at.toISOString(), expected_attempt_count: d.expectedAttemptCount };
  const max = Math.min(STAFF_INVENTORY_RESEARCH_LIMITS_V2.lifetimeAttempts, row.attemptCount + STAFF_INVENTORY_RESEARCH_LIMITS_V2.attemptsPerRun);
  await tx.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "status" = 'queued', "recoveryLeaseToken" = NULL, "recoveryLeaseExpiresAt" = NULL, "maxAttempts" = ${max}, "nextAttemptAt" = ${at}, "updatedAt" = ${at}, "retries" = "retries" || ${JSON.stringify([retry])}::jsonb WHERE "id" = ${row.id}`);
  const [updated] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${JOB_COLUMNS} FROM "StaffInventoryResearchJobV2" WHERE "id" = ${row.id}`);
  return { outcome: 'QUEUED' as const, request_id: d.requestId, job: status(updated) };
}
