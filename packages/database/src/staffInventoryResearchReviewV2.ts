import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { StaffInventoryResearchInputSchema, StaffInventoryResearchResultSchema, StaffInventoryResearchReviewCommandSchema, StaffInventoryResearchReviewSnapshotSchema,
  type StaffInventoryResearchReviewCommand, type StaffInventoryResearchReviewSnapshot } from '@tenkings/shared';
import { canonical, inventoryHash, CardInventoryErrorV2 } from './cardInventoryV2';
import { readWorkflowHistoryV2 } from './inventoryWorkflowV2Read';
import { replayWorkflowEventsV2 } from './inventoryWorkflowV2State';

type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
type Job = { id: string; unitId: string; descriptionEventId: string; descriptionHash: string; inputHash: string; input: string; status: string; result: string | null; resultHash: string | null };
type ReviewRow = { requestId: string; jobId: string; unitId: string; descriptionEventId: string; inputHash: string; resultHash: string; expectedRevision: number; revision: number;
  candidateId: string; decision: 'confirmed' | 'excluded'; actorId: string; reviewedAt: Date; request: string; requestHash: string; content: string; contentHash: string };
const columns = Prisma.raw('"id", "unitId", "descriptionEventId", "descriptionHash", "inputHash", "input", "status", "result", "resultHash"');
const identity = z.string().min(1).max(200).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const error = (code: 'INVALID_INPUT' | 'CONFLICT' | 'INTEGRITY', message: string): never => { throw new CardInventoryErrorV2(code, message); };
function verifiedJob(job: Job) {
  try {
    const input = StaffInventoryResearchInputSchema.parse(JSON.parse(job.input));
    const result = job.result && StaffInventoryResearchResultSchema.parse(JSON.parse(job.result));
    if (canonical(input) !== job.input || inventoryHash(input) !== job.inputHash || input.unit_id !== job.unitId || input.description_event_id !== job.descriptionEventId || input.description_hash !== job.descriptionHash
      || !result || canonical(result) !== job.result || inventoryHash(result) !== job.resultHash || result.unit_id !== job.unitId || result.description_event_id !== job.descriptionEventId || result.description_hash !== job.descriptionHash) throw Error();
    return { input, result };
  } catch { return error('INTEGRITY', 'Saved research evidence failed verification.'); }
}
function verifiedReview(row: ReviewRow, job: Job) {
  try {
    const command = StaffInventoryResearchReviewCommandSchema.parse({ requestId: row.requestId, jobId: row.jobId, unitId: row.unitId, descriptionEventId: row.descriptionEventId,
      inputHash: row.inputHash, resultHash: row.resultHash, expectedRevision: row.expectedRevision, candidateId: row.candidateId, decision: row.decision });
    const actor = identity.parse(row.actorId), request = { command, actor };
    const content = { request_hash: row.requestHash, revision: row.revision, reviewed_at: row.reviewedAt.toISOString() };
    if (row.jobId !== job.id || row.unitId !== job.unitId || row.descriptionEventId !== job.descriptionEventId || row.inputHash !== job.inputHash || row.resultHash !== job.resultHash
      || row.revision !== row.expectedRevision + 1 || canonical(request) !== row.request || inventoryHash(request) !== row.requestHash
      || canonical(content) !== row.content || inventoryHash(content) !== row.contentHash) throw Error();
    return { command, actor };
  } catch { return error('INTEGRITY', 'Saved staff review failed verification.'); }
}
async function snapshots(db: Reader, jobs: Job[]): Promise<StaffInventoryResearchReviewSnapshot[]> {
  if (!jobs.length) return [];
  const ids = jobs.map(job => job.id);
  // Latest per candidate is at most 24 rows per job, regardless of audit length.
  // Revision counts detect gaps; immutable SQL constraints protect prior events.
  const rows = await db.$queryRaw<(ReviewRow & { headRevision: number; historyCount: bigint })[]>(Prisma.sql`WITH heads AS (
    SELECT "jobId", MAX("revision") AS "headRevision", COUNT(*)::bigint AS "historyCount" FROM "StaffInventoryResearchReviewV2" WHERE "jobId" IN (${Prisma.join(ids)}) GROUP BY "jobId"
  ), latest AS (
    SELECT DISTINCT ON ("jobId", "candidateId") * FROM "StaffInventoryResearchReviewV2" WHERE "jobId" IN (${Prisma.join(ids)}) ORDER BY "jobId", "candidateId", "revision" DESC
  ) SELECT latest.*, heads."headRevision", heads."historyCount" FROM latest JOIN heads USING ("jobId") ORDER BY latest."jobId", latest."candidateId"`);
  return jobs.map(job => {
    const { result } = verifiedJob(job), selected = rows.filter(row => row.jobId === job.id), head = selected[0];
    if (head && BigInt(head.headRevision) !== head.historyCount || selected.length > 24) return error('INTEGRITY', 'Staff review history is not contiguous.');
    const decisions = selected.map(row => {
      verifiedReview(row, job);
      if (!result.selected_candidate_ids.includes(row.candidateId)) return error('INTEGRITY', 'Staff review cannot promote an unselected comparison.');
      return { candidate_id: row.candidateId, decision: row.decision, actor_id: row.actorId, reviewed_at: row.reviewedAt.toISOString(), revision: row.revision, request_id: row.requestId };
    });
    return StaffInventoryResearchReviewSnapshotSchema.parse({ schema_version: 1, job_id: job.id, unit_id: job.unitId, description_event_id: job.descriptionEventId,
      input_hash: job.inputHash, result_hash: job.resultHash, revision: head?.headRevision ?? 0, decisions,
      updated_at: selected.find(row => row.revision === head?.headRevision)?.reviewedAt.toISOString() ?? null });
  });
}
export async function readStaffInventoryResearchReviewsV2(db: Reader, args: { jobIds: string[] }): Promise<StaffInventoryResearchReviewSnapshot[]> {
  const parsed = z.array(z.string().uuid()).max(50).refine(ids => new Set(ids).size === ids.length).safeParse(args.jobIds);
  if (!parsed.success) return error('INVALID_INPUT', 'Choose up to fifty distinct research jobs.');
  if (!parsed.data.length) return [];
  const jobs = await db.$queryRaw<Job[]>(Prisma.sql`SELECT ${columns} FROM "StaffInventoryResearchJobV2" WHERE "id" IN (${Prisma.join(parsed.data)}) AND "status" = 'complete'`);
  return snapshots(db, jobs);
}

/** Caller owns one READ COMMITTED transaction and supplies the authenticated
 * human actor. Lock order matches the canonical Inventory/research writers. */
export async function recordStaffInventoryResearchReviewV2(tx: Prisma.TransactionClient, input: unknown, adminId: string) {
  const parsed = StaffInventoryResearchReviewCommandSchema.safeParse(input), actor = identity.safeParse(adminId);
  if (!parsed.success || !actor.success) return error('INVALID_INPUT', 'Review requires one exact saved comparison and authenticated staff actor.');
  const command: StaffInventoryResearchReviewCommand = parsed.data;
  await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(20260907, 4201)`);
  await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(20260908, 4201)`);
  await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(20260911, 4202)`);
  const [job] = await tx.$queryRaw<Job[]>(Prisma.sql`SELECT ${columns} FROM "StaffInventoryResearchJobV2" WHERE "id" = ${command.jobId} FOR UPDATE`);
  if (!job || job.status !== 'complete' || job.unitId !== command.unitId || job.descriptionEventId !== command.descriptionEventId || job.inputHash !== command.inputHash || job.resultHash !== command.resultHash) return error('CONFLICT', 'Research changed. Reload the current card before reviewing.');
  const { input: storedInput, result } = verifiedJob(job);
  const state = replayWorkflowEventsV2(await readWorkflowHistoryV2(tx)), unit = state.units.get(command.unitId);
  if (!unit?.description || unit.description_event_id !== command.descriptionEventId || inventoryHash(unit.description) !== job.descriptionHash
    || state.lots.get(unit.lot_id)?.data.quantity !== 1 || state.cancellations.has(unit.lot_id)) return error('CONFLICT', 'This card or its description changed. Reload before reviewing.');
  const details = unit.description.card_details;
  const currentInput = StaffInventoryResearchInputSchema.parse({ schema_version: 1, unit_id: unit.unit_id, description_event_id: unit.description_event_id,
    description_hash: inventoryHash(unit.description), description: { name: unit.description.name, category: unit.description.category,
      manufacturer: details?.manufacturer ?? null, card_number: details?.card_number ?? null, year: details?.year ?? null, set_name: details?.set_name ?? null, variant: details?.variant ?? null, card_type: details?.card_type ?? null },
    front_photo_key: unit.description.photo_key, back_photo_key: unit.description.back_photo_key ?? null });
  if (canonical(currentInput) !== canonical(storedInput)) return error('CONFLICT', 'The research input no longer matches this card.');
  if (result.estimate.status !== 'estimated' || !result.selected_candidate_ids.includes(command.candidateId)) return error('INVALID_INPUT', 'Only originally selected eligible comparisons can be confirmed or excluded.');
  const request = { command, actor: actor.data }, requestHash = inventoryHash(request);
  const [prior] = await tx.$queryRaw<ReviewRow[]>(Prisma.sql`SELECT * FROM "StaffInventoryResearchReviewV2" WHERE "requestId" = ${command.requestId}`);
  if (prior) {
    if (prior.jobId !== job.id || prior.requestHash !== requestHash || prior.request !== canonical(request)) return error('CONFLICT', 'This review request was already used for a different decision or reviewer.');
    verifiedReview(prior, job);
    return { version: 1 as const, outcome: 'REPLAY' as const, request_id: command.requestId, recorded_revision: prior.revision, review: (await snapshots(tx, [job]))[0] };
  }
  const [before] = await snapshots(tx, [job]);
  if (before.revision !== command.expectedRevision) return error('CONFLICT', 'Another staff review was saved. Reload before applying this decision.');
  const revision = before.revision + 1;
  if (revision > 2_147_483_646) return error('CONFLICT', 'This research review has reached its revision limit.');
  const [clock] = await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS now`);
  const reviewedAt = new Date(Math.max(clock.now.getTime(), before.updated_at ? Date.parse(before.updated_at) : 0));
  const content = { request_hash: requestHash, revision, reviewed_at: reviewedAt.toISOString() };
  await tx.$executeRaw(Prisma.sql`INSERT INTO "StaffInventoryResearchReviewV2" ("requestId", "jobId", "unitId", "descriptionEventId", "inputHash", "resultHash", "expectedRevision", "revision", "candidateId", "decision", "actorId", "reviewedAt", "request", "requestHash", "content", "contentHash")
    VALUES (${command.requestId}, ${job.id}, ${job.unitId}, ${job.descriptionEventId}, ${job.inputHash}, ${job.resultHash}, ${command.expectedRevision}, ${revision}, ${command.candidateId}, ${command.decision}, ${actor.data}, ${reviewedAt}, ${canonical(request)}, ${requestHash}, ${canonical(content)}, ${inventoryHash(content)})`);
  return { version: 1 as const, outcome: 'RECORDED' as const, request_id: command.requestId, recorded_revision: revision, review: (await snapshots(tx, [job]))[0] };
}
