import { createHash } from 'node:crypto';
import { prisma, inventoryHash, STAFF_INVENTORY_RESEARCH_LIMITS_V2 } from '@tenkings/database';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { canonicalJson, prepareObservationProposal, PROPOSAL_VERSION, type ObservationProposal } from '@tenkings/card-catalog-evidence';
import { StaffInventoryResearchInputSchema, StaffInventoryResearchResultSchema } from '../staffInventoryResearch';
import { createSetCatalogEvidenceService, type submitSetCatalogObservationProposal } from './setCatalogEvidence';
import { assertCatalogHuman, requireCatalogEnabled } from './setCatalogEvidenceAuth';
import { HttpError, type AdminSession } from './adminSessionAuthority';

export const INVENTORY_CATALOG_OBSERVATION_PRINCIPAL = 'inventory:catalog-observations:v1';
export const INVENTORY_CATALOG_SCAN_ACTION = 'set_ops.catalog.inventory_observation.scan';
export const INVENTORY_CATALOG_OBSERVATION_LIMITS = { pageSize: 8, budgetMs: 8_000, minimumRemainingMs: 20_000,
  inputBytes: 32 * 1024, proposalBytes: 512 * 1024, inboxPageSize: 10, responseBytes: 1024 * 1024 } as const;
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const revision = (inputHash: string, resultHash: string) => `inventory-observation:v1:${inputHash}:${resultHash}`;
const skipKey = (row: Pick<CompletedInventoryCatalogSource, 'id' | 'inputHash' | 'resultHash'>) =>
  createHash('sha256').update(`v1:${row.id}:${row.inputHash}:${row.resultHash}`).digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const opaque = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/);
const cursorSchema = z.object({ version: z.literal(1), afterJobId: z.string().uuid().nullable() }).strict();
const checkpointSchema = z.object({ schemaVersion: z.literal('inventory-catalog-scan/v1'), actorKind: z.literal('service'),
  actorRef: z.literal(INVENTORY_CATALOG_OBSERVATION_PRINCIPAL), cursor: cursorSchema }).strict();
const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 1000, timeout: 3000 };
type Tx = Prisma.TransactionClient;
type SourceErrorCode = 'INVALID_COMPLETED_REVISION' | 'SOURCE_TOO_LARGE' | 'UNSUPPORTED_CATEGORY' | 'UNREPRESENTABLE_LINEAGE';
class SourceError extends Error { constructor(readonly code: SourceErrorCode) { super(code); } }

export type CompletedInventoryCatalogSource = {
  id: string; unitId: string; descriptionEventId: string; descriptionHash: string; inputHash: string; input: string | null;
  resultHash: string; result: string | null; completedAttempt: unknown;
};
const observationText = (value: string | null) => value && value.length <= 500 && value === value.trim()
  && !/[\u0000-\u001f\u007f]|https?:\/\/|(?:^|\s)(?:\/[\w.-]+){2,}|\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}/.test(value) ? value : null;

/** Metadata only. The stored input/result and immutable completed attempt must
 * agree. A transmitted JPEG hash never asserts original-capture lineage. */
export function prepareInventoryCatalogObservation(row: CompletedInventoryCatalogSource) {
  try {
    z.string().uuid().parse(row.id); sha.parse(row.inputHash); sha.parse(row.resultHash); sha.parse(row.descriptionHash);
    if (!row.input || !row.result || Buffer.byteLength(row.input) > INVENTORY_CATALOG_OBSERVATION_LIMITS.inputBytes
      || Buffer.byteLength(row.result) > STAFF_INVENTORY_RESEARCH_LIMITS_V2.maxResultBytes) throw new SourceError('SOURCE_TOO_LARGE');
    const input = StaffInventoryResearchInputSchema.parse(JSON.parse(row.input));
    const result = StaffInventoryResearchResultSchema.parse(JSON.parse(row.result));
    const attempt = z.object({ attempt: z.number().int().min(1).max(9), completed_at: z.string().datetime(),
      outcome: z.literal('complete'), result: z.unknown() }).passthrough().parse(row.completedAttempt);
    const retained = StaffInventoryResearchResultSchema.parse(attempt.result);
    // descriptionHash binds the original saved description (including notes,
    // photos and nested card_details), not the flattened research projection.
    if (inventoryHash(input) !== row.inputHash || inventoryHash(result) !== row.resultHash || inventoryHash(retained) !== row.resultHash
      || input.unit_id !== row.unitId || input.description_event_id !== row.descriptionEventId || input.description_hash !== row.descriptionHash
      || result.unit_id !== row.unitId || result.description_event_id !== row.descriptionEventId || result.description_hash !== row.descriptionHash
      || Date.parse(result.researched_at) > Date.parse(attempt.completed_at) + 1000) throw new SourceError('INVALID_COMPLETED_REVISION');
    for (const side of ['front', 'back'] as const) if (result.photos[side] && result.photos[side]!.key !== input[`${side}_photo_key`]) throw new SourceError('INVALID_COMPLETED_REVISION');
    const unitOrigin = `inventory-unit:${row.unitId}`;
    if (!opaque.safeParse(unitOrigin).success) throw new SourceError('UNREPRESENTABLE_LINEAGE');
    const category = input.description.category?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const family = category === 'pokemon' ? 'POKEMON' : category === 'sports' || category === 'sports cards' ? 'SPORTS' : null;
    if (!family) throw new SourceError('UNSUPPORTED_CATEGORY');
    const physicalCardRef = `inventory-card:${digest(row.unitId)}`, observationId = `inventory:research:${row.id}`;
    const roots = [unitOrigin, `inventory-input:${row.inputHash}`, `inventory-result:${row.resultHash}`];
    const sources: ObservationProposal['sources'] = [{ sourceId: 'inventory-machine-observation', kind: 'PHYSICAL_OBSERVATION',
      sourceRef: `inventory-result:${row.resultHash}`, sourceUrl: null, sha256: row.resultHash, parentSourceIds: [], originKeys: roots }];
    for (const side of ['front', 'back'] as const) {
      const photo = result.photos[side];
      if (photo) sources.push({ sourceId: `inventory-transmitted-${side}`, kind: 'PHYSICAL_OBSERVATION', sourceRef: `inventory-jpeg:${photo.sha256}`,
        sourceUrl: null, sha256: photo.sha256, parentSourceIds: [], originKeys: [...roots, `inventory-transmitted-jpeg:${photo.sha256}`] });
    }
    const d = input.description;
    const prepared = prepareObservationProposal({ schemaVersion: PROPOSAL_VERSION, producer: 'inventory', observationId,
      inputRevision: revision(row.inputHash, row.resultHash), physicalCardRef, observedAt: result.researched_at, basedOnPublication: null,
      identity: { category: family, setId: null, programId: null, cardId: null, printingId: null, year: observationText(d.year),
        manufacturer: family === 'SPORTS' ? observationText(d.manufacturer) : null, publisher: family === 'POKEMON' ? observationText(d.manufacturer) : null,
        setLabel: observationText(d.set_name), name: observationText(d.name), cardNumber: observationText(d.card_number), language: null, edition: null, format: null, channel: null },
      sources, images: [], note: `Unreviewed machine observation; saved identity is unconfirmed. Research outcome: ${result.identity.status}. ${observationText(result.identity.reason)?.slice(0, 120) ?? ''} JPEG hashes describe transmitted Inventory bytes; original-capture lineage and dimensions are unknown. No image transfer, reuse grant, grade or publication approval is included.` });
    return { proposal: prepared.proposal, authority: { producer: 'inventory' as const, actorKind: 'service' as const,
      actorRef: INVENTORY_CATALOG_OBSERVATION_PRINCIPAL, userId: null,
      binding: { physicalCardRef, observationId, inputRevision: prepared.proposal.inputRevision, evidenceSha256: prepared.proposalSha256 } } };
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('INVALID_COMPLETED_REVISION');
  }
}

async function activeIntake(tx: Tx) {
  const [state] = await tx.$queryRaw<{ active: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM "StaffInventoryIntakeLeaseV2" WHERE "expiresAt" > clock_timestamp()) AS active`);
  return state.active;
}
async function pendingSources(tx: Tx, after: string | null) {
  // CASE bounds broken/oversized rows without removing them from the keyset:
  // they can be recorded as invalid instead of repeatedly blocking later cards.
  return tx.$queryRaw<CompletedInventoryCatalogSource[]>(Prisma.sql`
    SELECT j.id, j."unitId", j."descriptionEventId", j."descriptionHash", j."inputHash", j."resultHash",
      CASE WHEN octet_length(j.input) <= ${INVENTORY_CATALOG_OBSERVATION_LIMITS.inputBytes} THEN j.input ELSE NULL END AS input,
      CASE WHEN octet_length(j.result) <= ${STAFF_INVENTORY_RESEARCH_LIMITS_V2.maxResultBytes} THEN j.result ELSE NULL END AS result,
      CASE WHEN octet_length(a.value::text) <= ${2 * STAFF_INVENTORY_RESEARCH_LIMITS_V2.maxResultBytes} THEN a.value ELSE NULL END AS "completedAttempt"
    FROM "StaffInventoryResearchJobV2" j
    LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(j.attempts) WITH ORDINALITY AS history(value, ordinal)
      WHERE value->>'outcome' = 'complete' ORDER BY ordinal DESC LIMIT 1) a ON true
    WHERE j.status = 'complete' AND j.result IS NOT NULL AND j."resultHash" IS NOT NULL
      AND j.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (${after}::text IS NULL OR j.id > ${after})
      AND NOT EXISTS (SELECT 1 FROM "SetCatalogObservationProposal" p WHERE p.producer = 'inventory'
        AND p."observationId" = 'inventory:research:' || j.id
        AND p."inputRevision" = 'inventory-observation:v1:' || j."inputHash" || ':' || j."resultHash")
      AND NOT EXISTS (SELECT 1 FROM "SetAuditEvent" e WHERE e.action = ${INVENTORY_CATALOG_SCAN_ACTION} AND e.reason = 'invalid_revision'
        AND e."requestId" = encode(sha256(convert_to('v1:' || j.id || ':' || j."inputHash" || ':' || j."resultHash", 'UTF8')), 'hex'))
    ORDER BY j.id LIMIT ${INVENTORY_CATALOG_OBSERVATION_LIMITS.pageSize}`);
}

export type InventoryCatalogReconcileResult = { status: 'disabled' | 'budget' | 'intake' | 'busy' | 'idle' | 'scanned' | 'wrapped';
  scanned: number; recorded: number; replayed: number; invalid: number; failed: number; deferred: number; cursor: string | null };
export function createStaffInventoryCatalogReconciler(dependencies: { db?: PrismaClient; submit?: typeof submitSetCatalogObservationProposal;
  env?: Record<string, string | undefined>; now?: () => number } = {}) {
  const db = dependencies.db ?? prisma;
  // Reuse the immutable writer with shorter transaction bounds for this optional
  // stage. Do not race an uncancelled database write against a JS timeout.
  const boundedDb = Object.create(db) as PrismaClient;
  Object.defineProperty(boundedDb, '$transaction', { value: (fn: (tx: Tx) => Promise<unknown>) => db.$transaction(fn, transactionOptions) });
  const submit = dependencies.submit ?? createSetCatalogEvidenceService({ db: boundedDb }).submitSetCatalogObservationProposal;
  const now = dependencies.now ?? Date.now;
  return async function reconcile(input: { remainingBudgetMs: number; signal?: AbortSignal }): Promise<InventoryCatalogReconcileResult> {
    const empty = (status: InventoryCatalogReconcileResult['status']): InventoryCatalogReconcileResult => ({ status, scanned: 0, recorded: 0, replayed: 0, invalid: 0, failed: 0, deferred: 0, cursor: null });
    const enabled = () => { const env = dependencies.env ?? process.env; return env.SET_CATALOG_EVIDENCE_ENABLED === 'true' && env.STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED === 'true'; };
    if (!enabled()) return empty('disabled');
    if (input.signal?.aborted || !Number.isFinite(input.remainingBudgetMs) || input.remainingBudgetMs < INVENTORY_CATALOG_OBSERVATION_LIMITS.minimumRemainingMs) return empty('budget');
    const until = now() + INVENTORY_CATALOG_OBSERVATION_LIMITS.budgetMs;
    const canContinue = () => enabled() && !input.signal?.aborted && now() < until - 3000;
    const scan = await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(20260916, 4203) AS locked`;
      if (!lock.locked) return { result: empty('busy'), rows: [] };
      if (await activeIntake(tx)) return { result: empty('intake'), rows: [] };
      if (!canContinue()) return { result: empty('budget'), rows: [] };
      const checkpoint = await tx.setAuditEvent.findFirst({ where: { action: INVENTORY_CATALOG_SCAN_ACTION, reason: 'checkpoint', status: 'SUCCESS' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { metadataJson: true } });
      const after = checkpoint ? checkpointSchema.parse(checkpoint.metadataJson).cursor.afterJobId : null;
      const rows = await pendingSources(tx, after);
      const next = rows.at(-1)?.id ?? null;
      const result = empty(rows.length ? 'scanned' : after ? 'wrapped' : 'idle'); result.scanned = rows.length; result.cursor = after;
      // The reservation advances before processing. Crashes/failures remain
      // pending and are revisited after exhaustion; accepted proposals dedupe.
      if (next !== after && canContinue()) {
        if (await activeIntake(tx)) return { result: empty('intake'), rows: [] };
        await tx.setAuditEvent.create({ data: { action: INVENTORY_CATALOG_SCAN_ACTION, status: 'SUCCESS', reason: 'checkpoint', actorId: null,
          metadataJson: { schemaVersion: 'inventory-catalog-scan/v1', actorKind: 'service', actorRef: INVENTORY_CATALOG_OBSERVATION_PRINCIPAL, cursor: { version: 1, afterJobId: next } } } });
        result.cursor = next;
      }
      return { result, rows };
    }, transactionOptions);
    for (const [index, row] of scan.rows.entries()) {
      if (!canContinue()) { scan.result.deferred += scan.rows.length - index; break; }
      const intake = await db.$transaction(tx => activeIntake(tx), transactionOptions);
      if (intake || !canContinue()) { scan.result.deferred += scan.rows.length - index; break; }
      let prepared: ReturnType<typeof prepareInventoryCatalogObservation>;
      try { prepared = prepareInventoryCatalogObservation(row); }
      catch (error) {
        if (!(error instanceof SourceError)) throw error;
        scan.result.invalid++;
        if (canContinue()) await db.$transaction(async tx => {
          if (await activeIntake(tx)) return;
          const requestId = skipKey(row);
          if (await tx.setAuditEvent.findFirst({ where: { action: INVENTORY_CATALOG_SCAN_ACTION, reason: 'invalid_revision', requestId }, select: { id: true } })) return;
          await tx.setAuditEvent.create({ data: { action: INVENTORY_CATALOG_SCAN_ACTION, status: 'FAILURE', reason: 'invalid_revision', requestId, actorId: null,
            metadataJson: { schemaVersion: 'inventory-catalog-scan-skip/v1', actorKind: 'service', actorRef: INVENTORY_CATALOG_OBSERVATION_PRINCIPAL, revisionSha256: requestId, errorCode: error.code } } });
        }, transactionOptions);
        continue;
      }
      if (!canContinue()) { scan.result.deferred += scan.rows.length - index; break; }
      try {
        const receipt = await submit(prepared);
        if (receipt.proposalSha256 !== prepared.authority.binding.evidenceSha256 || !['recorded', 'replay'].includes(receipt.outcome)) throw Error('Invalid immutable writer receipt.');
        if (receipt.outcome === 'recorded') scan.result.recorded++; else scan.result.replayed++;
      }
      catch { scan.result.failed++; /* Transient/unknown writes stay pending. No provider or research retry is requested. */ }
    }
    return scan.result;
  };
}
export const reconcileStaffInventoryCatalogObservations = createStaffInventoryCatalogReconciler();

const inboxCursor = z.object({ version: z.literal(1), submittedAt: z.string().datetime(), id: z.string().uuid() }).strict();
const cursorText = z.string().max(512).regex(/^[A-Za-z0-9_-]+$/);
const encodeCursor = (value: z.infer<typeof inboxCursor>) => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeCursor(value: string) {
  try { const parsed = inboxCursor.parse(JSON.parse(Buffer.from(cursorText.parse(value), 'base64url').toString('utf8'))); if (encodeCursor(parsed) !== value) throw Error(); return parsed; }
  catch { throw new HttpError(400, 'Invalid proposal page cursor.'); }
}
const bindingSchema = z.object({ producer: z.enum(['inventory', 'atlas']), actorKind: z.enum(['human', 'service']), actorRef: z.string().min(1).max(256), userId: z.string().min(1).max(256).nullable(),
  binding: z.object({ physicalCardRef: opaque, observationId: opaque, inputRevision: opaque, evidenceSha256: sha }).strict() }).strict();
type ProposalRow = Awaited<ReturnType<PrismaClient['setCatalogObservationProposal']['findUniqueOrThrow']>>;
const reviewColumns = Prisma.sql`id, producer, "observationId", "inputRevision", "physicalCardRef", "proposalSha256",
  "actorKind", "actorRef", "bindingSha256", "submittedById", "submittedAt",
  CASE WHEN octet_length("proposalJson"::text) <= ${INVENTORY_CATALOG_OBSERVATION_LIMITS.proposalBytes} THEN "proposalJson" ELSE NULL END AS "proposalJson",
  CASE WHEN octet_length("bindingJson"::text) <= 16384 THEN "bindingJson" ELSE NULL END AS "bindingJson"`;
export type CatalogProposalListItem = { proposalId: string; proposalSha256: string; producer: 'inventory' | 'atlas'; submittedAt: string;
  observedAt: string; physicalCardRef: string; inputRevision: string; identity: ObservationProposal['identity']; sourceCount: number; imageCount: number; note: string };
export type CatalogProposalDetail = { schemaVersion: 'catalog-proposal-review/v1'; disposition: 'requires_authorized_review'; item: CatalogProposalListItem;
  canonicalProposalJson: string; reviewLink: { proposalId: string; proposalSha256: string; sourceIds: string[]; reviewNote: string } };
export type CatalogProposalList = { schemaVersion: 'catalog-proposal-inbox/v1'; disposition: 'requires_authorized_review'; items: CatalogProposalListItem[]; unavailableCount: number; nextCursor: string | null };
function checkedProposal(row: ProposalRow) {
  try {
    if (row.proposalJson === null || row.bindingJson === null) throw new HttpError(413, 'Proposal exceeds the private review limit.');
    const canonical = canonicalJson(row.proposalJson);
    if (Buffer.byteLength(canonical) > INVENTORY_CATALOG_OBSERVATION_LIMITS.proposalBytes || Buffer.byteLength(canonicalJson(row.bindingJson)) > 16384) throw new HttpError(413, 'Proposal exceeds the private review limit.');
    const prepared = prepareObservationProposal(row.proposalJson), p = prepared.proposal, authority = bindingSchema.parse(row.bindingJson);
    if (prepared.proposalSha256 !== row.proposalSha256 || digest(authority) !== row.bindingSha256 || authority.producer !== row.producer
      || p.producer !== row.producer || p.observationId !== row.observationId || p.inputRevision !== row.inputRevision || p.physicalCardRef !== row.physicalCardRef
      || authority.actorKind !== row.actorKind || authority.actorRef !== row.actorRef || authority.userId !== row.submittedById
      || (authority.actorKind === 'human') !== Boolean(authority.userId) || authority.binding.evidenceSha256 !== prepared.proposalSha256
      || authority.binding.physicalCardRef !== p.physicalCardRef || authority.binding.observationId !== p.observationId || authority.binding.inputRevision !== p.inputRevision) throw Error();
    const item: CatalogProposalListItem = { proposalId: row.id, proposalSha256: row.proposalSha256, producer: p.producer, submittedAt: row.submittedAt.toISOString(),
      observedAt: p.observedAt, physicalCardRef: p.physicalCardRef, inputRevision: p.inputRevision, identity: { ...p.identity }, sourceCount: p.sources.length, imageCount: p.images.length, note: p.note };
    return { item, canonicalProposalJson: canonical };
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(503, 'Immutable proposal integrity could not be verified.'); }
}
function boundedResponse<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value)) > INVENTORY_CATALOG_OBSERVATION_LIMITS.responseBytes) throw new HttpError(413, 'Choose a smaller proposal page.');
  return value;
}
export function createCatalogProposalInbox(db: PrismaClient = prisma) {
  const authorize = (actor: AdminSession) => { assertCatalogHuman(actor, 'reviewer'); requireCatalogEnabled(); };
  return {
    async list(input: { cursor?: string; producer?: 'inventory' | 'atlas' }, actor: AdminSession): Promise<CatalogProposalList> {
      authorize(actor); const request = z.object({ cursor: cursorText.optional(), producer: z.enum(['inventory', 'atlas']).optional() }).strict().parse(input);
      const cursor = request.cursor ? decodeCursor(request.cursor) : null;
      const rows = await db.$queryRaw<ProposalRow[]>(Prisma.sql`SELECT ${reviewColumns} FROM "SetCatalogObservationProposal"
        WHERE (${request.producer ?? null}::text IS NULL OR producer = ${request.producer ?? null})
          AND (${cursor?.submittedAt ?? null}::timestamp IS NULL OR "submittedAt" < ${cursor?.submittedAt ?? null}::timestamp
            OR ("submittedAt" = ${cursor?.submittedAt ?? null}::timestamp AND id < ${cursor?.id ?? null}))
        ORDER BY "submittedAt" DESC, id DESC LIMIT ${INVENTORY_CATALOG_OBSERVATION_LIMITS.inboxPageSize + 1}`);
      const page = rows.slice(0, INVENTORY_CATALOG_OBSERVATION_LIMITS.inboxPageSize), items: CatalogProposalListItem[] = []; let unavailableCount = 0;
      for (const row of page) { try { items.push(checkedProposal(row).item); } catch { unavailableCount++; } }
      const last = page.at(-1);
      return boundedResponse({ schemaVersion: 'catalog-proposal-inbox/v1', disposition: 'requires_authorized_review', items, unavailableCount,
        nextCursor: rows.length > page.length && last ? encodeCursor({ version: 1, submittedAt: last.submittedAt.toISOString(), id: last.id }) : null });
    },
    async detail(input: { proposalId: string; proposalSha256: string }, actor: AdminSession): Promise<CatalogProposalDetail> {
      authorize(actor); const pin = z.object({ proposalId: z.string().uuid(), proposalSha256: sha }).strict().parse(input);
      const [row] = await db.$queryRaw<ProposalRow[]>(Prisma.sql`SELECT ${reviewColumns} FROM "SetCatalogObservationProposal" WHERE id = ${pin.proposalId} LIMIT 1`);
      if (!row) throw new HttpError(404, 'Proposal not found.');
      if (row.proposalSha256 !== pin.proposalSha256) throw new HttpError(409, 'Proposal hash differs from the selected immutable revision.');
      return boundedResponse({ schemaVersion: 'catalog-proposal-review/v1', disposition: 'requires_authorized_review', ...checkedProposal(row),
        reviewLink: { ...pin, sourceIds: [], reviewNote: '' } });
    },
  };
}
export const catalogProposalInbox = createCatalogProposalInbox();
