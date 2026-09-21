import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AdminSession } from './admin';
import { assertCatalogHuman, requireCatalogEnabled } from './setCatalogEvidenceAuth';
import { readSetCatalogArtifact, type CatalogArtifactReader } from './setCatalogEvidenceMedia';
import { HttpError } from './adminSessionAuthority';
import plan from './setCatalogSportsPreparationPlan.json';

// One-pilot service. No generic import/upsert or approval operation.
const ACTION = 'set_ops.catalog.sports_preparation';
const PARSER = 'catalog-sports-additive-preparation/v1';
// Source metadata includes literal fractional PDF coordinates. This local receipt
// encoding permits finite JSON numbers; it is NOT the integer-only catalog
// manifest canonicalizer and never changes existing manifest/version hashes.
function metadataJson(value: unknown, depth = 0): string {
  if (depth > 48) throw new Error('Preparation metadata is too deeply nested.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('Preparation metadata contains a sparse array.');
    return `[${value.map(item => metadataJson(item, depth + 1)).join(',')}]`;
  }
  if (typeof value !== 'object' || !value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid preparation JSON metadata.');
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${metadataJson(object[key], depth + 1)}`).join(',')}}`;
}
const hash = (value: unknown) => createHash('sha256').update(metadataJson(value)).digest('hex');
const byteHash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.object({ schemaVersion: z.literal('setops-sports-additive-preparation-request/v1'),
  idempotencyKey: z.string().uuid(), expectedSnapshotSha256: sha, proposalSha256: z.literal(plan.proposalSha256),
  acknowledgement: z.literal('PREPARE PENDING SPORTS CATALOG MAPPINGS') }).strict();
const idsSchema = z.object({ jobs: z.array(z.string().uuid()).length(2), sources: z.array(z.string().uuid()).length(2),
  parallels: z.array(z.string().uuid()).length(3), scopes: z.array(z.string().uuid()).length(3) }).strict()
  .refine(ids => new Set(Object.values(ids).flat()).size === 10, 'Created IDs must be distinct.');
const receiptSchema = z.object({ schemaVersion: z.literal('setops-sports-additive-preparation-receipt/v1'), requestSha256: sha,
  baselineSha256: sha, proposalSha256: z.literal(plan.proposalSha256), ids: idsSchema, createdRowsSha256: sha,
  applicability: z.array(z.object({ cardId: z.string(), printingKey: z.string(), status: z.literal('unknown') }).strict()).length(9),
}).strict();
type Tx = Prisma.TransactionClient;
type Ids = z.infer<typeof idsSchema>;
function conflict(message: string): never { throw new HttpError(409, message); }
// Only an authenticated transaction that found no prior receipt and free target
// keys can issue this authoritative, write-free stale rejection. Other failures
// must preserve the caller's pending bytes and retry key.
export class StaleSportsPreparationSnapshotError extends HttpError {
  readonly idempotencyKey: string;
  readonly expectedSnapshotSha256: string;
  constructor(idempotencyKey: string, expectedSnapshotSha256: string) {
    super(409, 'Preparation snapshot changed; preview again.');
    this.idempotencyKey = idempotencyKey;
    this.expectedSnapshotSha256 = expectedSnapshotSha256;
  }
}
const take = 1001;
const unknownApplicability = () => plan.applicability.map(a => ({ cardId: a.cardId, printingKey: a.printingKey, status: 'unknown' as const }));

async function snapshot(tx: Tx) {
  const where = { setId: plan.setId }, orderBy = { id: 'asc' as const };
  const draft = await tx.setDraft.findUnique({ where, select: { id: true, setId: true, status: true, archivedAt: true, currentCatalogPublicationId: true } });
  if (!draft) conflict('The exact existing sports draft is required.');
  const [cards, programs, versions, sources, parallels, scopes, jobs, counts, work] = await Promise.all([
    tx.setCard.findMany({ where, take, orderBy, select: { id: true, setId: true, programId: true, cardNumber: true, playerName: true, team: true, isRookie: true, sourceId: true } }),
    tx.setProgram.findMany({ where, take, orderBy, select: { id: true, setId: true, programId: true, label: true, sourceId: true } }),
    tx.setDraftVersion.findMany({ where: { draftId: draft.id }, take, orderBy, select: { id: true, draftId: true, version: true, versionHash: true, rowCount: true, blockingErrorCount: true } }),
    tx.setTaxonomySource.findMany({ where, take, orderBy, select: { id: true, setId: true, ingestionJobId: true, sourceKind: true, artifactType: true, sourceUrl: true } }),
    tx.setParallel.findMany({ where, take, orderBy, select: { id: true, setId: true, parallelId: true, label: true, serialDenominator: true, sourceId: true } }),
    tx.setParallelScope.findMany({ where, take, orderBy, select: { id: true, setId: true, scopeKey: true, programId: true, parallelId: true, variationId: true, formatKey: true, channelKey: true, sourceId: true } }),
    tx.setIngestionJob.findMany({ where, take, orderBy, select: { id: true, setId: true, draftId: true, status: true, sourceUrl: true, parserVersion: true } }),
    Promise.all([tx.setCard.count({ where }), tx.setProgram.count({ where }), tx.setDraftVersion.count({ where: { draftId: draft.id } }),
      tx.setTaxonomySource.count({ where }), tx.setParallel.count({ where }), tx.setParallelScope.count({ where }), tx.setIngestionJob.count({ where })]),
    Promise.all([tx.setSeedJob.count({ where: { draftId: draft.id, status: { in: ['QUEUED', 'IN_PROGRESS'] } } }),
      tx.setReplaceJob.count({ where: { setId: plan.setId, status: { notIn: ['COMPLETE', 'FAILED', 'CANCELLED'] } } }),
      tx.setCatalogEvidencePublication.count({ where: { draftId: draft.id } })]),
  ]);
  const rosters = { cards, programs, versions, sources, parallels, scopes, jobs };
  Object.values(rosters).forEach((rows, i) => {
    if (rows.length >= take || rows.length !== counts[i] || new Set(rows.map(r => r.id)).size !== rows.length) conflict('Incomplete or changing count-accounted taxonomy snapshot.');
  });
  if (draft.id !== plan.existingBinding.draftId || draft.status !== 'APPROVED' || draft.archivedAt || draft.currentCatalogPublicationId || work.some(Boolean)) conflict('Sports draft/version/publication or active work is no longer eligible for this preparation.');
  for (const name of ['cards', 'programs', 'versions'] as const) {
    if (rosters[name].length !== plan.baseline[name].count || hash(rosters[name].map(row => row.id).sort()) !== plan.baseline[name].idsSha256) conflict('The 379-card, ten-program, six-version identity roster changed. Reconcile before preparation.');
  }
  const latest = [...versions].sort((a, b) => b.version - a.version)[0];
  if (latest.id !== plan.existingBinding.draftVersionId || latest.versionHash !== plan.existingBinding.versionHash || latest.blockingErrorCount) conflict('The exact latest clean version changed.');
  if (!programs.some(p => p.id === plan.existingBinding.programRowId && p.programId === plan.existingBinding.programId && p.label === 'THE BIG KAHUNA')) conflict('Big Kahuna program binding changed.');
  for (const selected of plan.existingBinding.cards) if (!cards.some(c => c.id === selected.cardId && c.programId === plan.existingBinding.programId && c.cardNumber === selected.number && c.playerName === selected.name)) conflict('Selected card identity changed.');
  return { draft, ...rosters };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function assertFreeTargets(value: Snapshot) {
  for (const source of plan.sources) if (value.sources.some(s => s.sourceUrl === source.data.sourceUrl)) conflict('An exact official source URL is already occupied. No duplicate or reclassification is allowed.');
  for (const parallel of plan.parallels) if (value.parallels.some(p => p.parallelId === parallel.data.parallelId || p.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') === parallel.data.parallelId)) conflict('A proposed parallel key or label is occupied.');
  for (const scope of plan.scopes) if (value.scopes.some(s => s.scopeKey === scope.data.scopeKey || (s.programId === scope.data.programId && s.parallelId === scope.data.parallelId && s.variationId === null && s.formatKey === null && s.channelKey === null))) conflict('A proposed scope is occupied.');
}
function creationRows(ids: Ids, requestSha256: string, actorId: string) {
  const jobs = plan.sources.map((source, i) => ({ id: ids.jobs[i], setId: plan.setId, draftId: null,
    datasetType: (i === 0 ? 'PLAYER_WORKSHEET' : 'PARALLEL_DB') as 'PLAYER_WORKSHEET' | 'PARALLEL_DB', sourceUrl: source.data.sourceUrl,
    parserVersion: PARSER, status: 'REVIEW_REQUIRED' as const, createdById: actorId, parsedAt: null, reviewedAt: null,
    // This is deliberately not a rows/programs/odds legacy draft payload.
    rawPayload: { schemaVersion: PARSER, sourceId: source.key, sourceSha256: source.data.metadataJson.sourceSha256, requestSha256 },
    // This marker is descriptive. The Build Draft handler must explicitly reject
    // PARSER before this service is wired; metadata alone is not a lifecycle guard.
    parseSummaryJson: { preparationOnly: true, genericDraftBuildAllowed: false, intendedDraftId: plan.existingBinding.draftId,
      proposalSha256: plan.proposalSha256, sourceRef: source.data.metadataJson.sourceRef, sourceByteSize: source.data.metadataJson.sourceByteSize,
      rightsVerified: false, humanReviewed: false } }));
  const sources = plan.sources.map((source, i) => ({ ...source.data, id: ids.sources[i], ingestionJobId: ids.jobs[i],
    artifactType: source.data.artifactType as 'CHECKLIST' | 'ODDS', sourceKind: source.data.sourceKind as 'OFFICIAL_CHECKLIST' | 'OFFICIAL_ODDS',
    metadataJson: { ...source.data.metadataJson, sourceBytesVerifiedAtServer: true, preparationRequestSha256: requestSha256 } }));
  const parallels = plan.parallels.map((parallel, i) => ({ ...parallel.data, id: ids.parallels[i], sourceId: ids.sources[1] }));
  const scopes = plan.scopes.map((scope, i) => ({ ...scope.data, id: ids.scopes[i], sourceId: ids.sources[1] }));
  return { jobs, sources, parallels, scopes };
}
async function persistedRows(tx: Tx, rows: ReturnType<typeof creationRows>) {
  // Exact owned IDs only; the broad snapshot never reads existing raw payloads.
  const result = { jobs: [] as unknown[], sources: [] as unknown[], parallels: [] as unknown[], scopes: [] as unknown[] };
  for (const name of ['jobs', 'sources', 'parallels', 'scopes'] as const) {
    for (const expected of rows[name]) {
      const select = Object.fromEntries(Object.keys(expected).map(key => [key, true]));
      const args = { where: { id: expected.id }, select };
      const actual = name === 'jobs' ? await tx.setIngestionJob.findUnique(args) : name === 'sources' ? await tx.setTaxonomySource.findUnique(args)
        : name === 'parallels' ? await tx.setParallel.findUnique(args) : await tx.setParallelScope.findUnique(args);
      if (!actual || metadataJson(actual) !== metadataJson(expected)) conflict('Prepared mapping rows are missing or changed; replay cannot rewrite them.');
      result[name].push(actual);
    }
  }
  return result;
}
function withoutCreated(after: Snapshot, ids: Ids): Snapshot {
  return { ...after, jobs: after.jobs.filter(r => !ids.jobs.includes(r.id)), sources: after.sources.filter(r => !ids.sources.includes(r.id)),
    parallels: after.parallels.filter(r => !ids.parallels.includes(r.id)), scopes: after.scopes.filter(r => !ids.scopes.includes(r.id)) };
}

/** Server-owned composition only. Source reads finish before locks.
 * The three target-table locks cover ordinary taxonomy writers,
 * including writers that do not honor advisory locks. Direct maintenance of
 * card/program tables still requires an exclusive operator window; see the note. */
export function createSportsCatalogPreparationService(dependencies: { db: PrismaClient; readArtifact?: CatalogArtifactReader }) {
  const { db } = dependencies, read = dependencies.readArtifact ?? readSetCatalogArtifact;
  async function sourceBytes() {
    for (const source of plan.sources) {
      const pin = source.data.metadataJson, bytes = await read(pin.sourceRef);
      if (bytes.length !== pin.sourceByteSize || byteHash(bytes) !== pin.sourceSha256) throw new HttpError(409, 'Pinned official source bytes differ.');
    }
  }
  function authorize(actor: AdminSession) { requireCatalogEnabled(); assertCatalogHuman(actor, 'reviewer'); }
  async function preview(actor: AdminSession) {
    authorize(actor); await sourceBytes();
    return db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`;
      const current = await snapshot(tx); assertFreeTargets(current);
      return { schemaVersion: 'setops-sports-additive-preparation-preview/v1', authority: 'unreviewed_preparation' as const,
        setId: plan.setId, proposalSha256: plan.proposalSha256, snapshotSha256: hash(current),
        creates: { pendingJobs: 2, sources: 2, parallels: 3, scopes: 3 },
        preserved: structuredClone(plan.baseline), applicability: structuredClone(plan.applicability), approved: false, publication: null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 1000, timeout: 8000 });
  }
  async function stage(input: unknown, actor: AdminSession) {
    authorize(actor); const request = requestSchema.parse(input);
    const requestSha256 = hash({ request, actorId: actor.user.id });
    const auditId = `sports-catalog-preparation:${request.idempotencyKey}`;
    await sourceBytes(); // Never keep source/storage/network reads under a lock.
    return db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '750ms'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`;
      // Source -> parallel -> scope matches the ordinary ingestion write order.
      // A reverse-order maintenance transaction can time out; never auto-retry.
      await tx.$executeRaw`LOCK TABLE "SetTaxonomySource", "SetParallel", "SetParallelScope" IN SHARE ROW EXCLUSIVE MODE`;
      await tx.$queryRaw`SELECT id FROM "SetDraft" WHERE id = ${plan.existingBinding.draftId} FOR UPDATE`;
      const prior = await tx.setAuditEvent.findUnique({ where: { id: auditId } });
      if (prior) {
        const stored = z.object({ receipt: receiptSchema, receiptSha256: sha }).strict().parse(prior.metadataJson);
        if (prior.action !== ACTION || prior.status !== 'SUCCESS' || prior.actorId !== actor.user.id
          || prior.setId !== plan.setId || prior.draftId !== plan.existingBinding.draftId || prior.draftVersionId !== plan.existingBinding.draftVersionId
          || prior.requestId !== request.idempotencyKey || stored.receipt.baselineSha256 !== request.expectedSnapshotSha256
          || metadataJson(stored.receipt.applicability) !== metadataJson(unknownApplicability())
          || stored.receipt.requestSha256 !== requestSha256 || hash(stored.receipt) !== stored.receiptSha256) conflict('Preparation key already belongs to different evidence or actor.');
        const rows = creationRows(stored.receipt.ids, requestSha256, actor.user.id);
        if (hash(await persistedRows(tx, rows)) !== stored.receipt.createdRowsSha256) conflict('Prepared mapping receipt no longer matches its rows.');
        return { outcome: 'replay' as const, receipt: stored.receipt, receiptSha256: stored.receiptSha256 };
      }
      const before = await snapshot(tx); assertFreeTargets(before);
      if (hash(before) !== request.expectedSnapshotSha256) throw new StaleSportsPreparationSnapshotError(request.idempotencyKey, request.expectedSnapshotSha256);
      assertCatalogHuman(actor, 'reviewer');
      const ids: Ids = { jobs: [randomUUID(), randomUUID()], sources: [randomUUID(), randomUUID()],
        parallels: [randomUUID(), randomUUID(), randomUUID()], scopes: [randomUUID(), randomUUID(), randomUUID()] };
      const rows = creationRows(ids, requestSha256, actor.user.id);
      for (const data of rows.jobs) await tx.setIngestionJob.create({ data });
      for (const data of rows.sources) await tx.setTaxonomySource.create({ data: { ...data, metadataJson: data.metadataJson as Prisma.InputJsonValue } });
      for (const data of rows.parallels) await tx.setParallel.create({ data: { ...data, visualCuesJson: Prisma.DbNull } });
      for (const data of rows.scopes) await tx.setParallelScope.create({ data });
      const created = await persistedRows(tx, rows), after = await snapshot(tx);
      if (hash(withoutCreated(after, ids)) !== hash(before)) conflict('Existing catalog metadata changed during preparation.');
      const receipt = receiptSchema.parse({ schemaVersion: 'setops-sports-additive-preparation-receipt/v1', requestSha256,
        baselineSha256: request.expectedSnapshotSha256, proposalSha256: plan.proposalSha256, ids, createdRowsSha256: hash(created),
        applicability: unknownApplicability() });
      const receiptSha256 = hash(receipt);
      await tx.setAuditEvent.create({ data: { id: auditId, setId: plan.setId, draftId: plan.existingBinding.draftId,
        draftVersionId: plan.existingBinding.draftVersionId, actorId: actor.user.id, action: ACTION, status: 'SUCCESS',
        requestId: request.idempotencyKey, reason: 'Prepared pending source/printing mappings; no approval or publication.',
        metadataJson: { receipt, receiptSha256 } } });
      return { outcome: 'recorded' as const, receipt, receiptSha256 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 1000, timeout: 8000 });
  }
  return { preview, stage };
}
