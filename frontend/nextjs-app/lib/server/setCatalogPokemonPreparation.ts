import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AdminSession } from './admin';
import { HttpError } from './adminSessionAuthority';
import { assertCatalogHuman, requireCatalogEnabled } from './setCatalogEvidenceAuth';
import { readSetCatalogArtifact, type CatalogArtifactReader } from './setCatalogEvidenceMedia';
import plan from './setCatalogPokemonPreparationPlan.json';

const ACTION = 'set_ops.catalog.pokemon_preparation';
// Local receipt encoding accepts existing quality-score fractions. It does not
// change legacy draft hashes or the catalog manifest's integer-only contract.
function json(value: unknown, depth = 0): string {
  if (depth > 48) throw new Error('Preparation metadata is too deeply nested.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value) && Object.keys(value).length === value.length) return `[${value.map(v => json(v, depth + 1)).join(',')}]`;
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid preparation metadata.');
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${json(object[k], depth + 1)}`).join(',')}}`;
}
const hash = (value: unknown) => createHash('sha256').update(json(value)).digest('hex');
const proposalSha256 = hash(plan);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(256);
const bindingSchema = z.object({ draftId: id, draftVersionId: id, ingestionJobId: id, sourceId: id, programRowId: id }).strict();
const requestSchema = z.object({ schemaVersion: z.literal('setops-pokemon-additive-preparation-request/v1'),
  idempotencyKey: z.string().uuid(), expectedSnapshotSha256: sha, proposalSha256: z.literal(proposalSha256), binding: bindingSchema,
  acknowledgement: z.literal('PREPARE PENDING POKEMON CATALOG MAPPINGS') }).strict();
const idsSchema = z.object({ parallels: z.array(z.string().uuid()).length(2), scopes: z.array(z.string().uuid()).length(2) }).strict()
  .refine(value => new Set([...value.parallels, ...value.scopes]).size === 4, 'Created IDs must be distinct.');
const receiptSchema = z.object({ schemaVersion: z.literal('setops-pokemon-additive-preparation-receipt/v1'),
  idempotencyKey: z.string().uuid(), requestSha256: sha, baselineSha256: sha, proposalSha256: z.literal(proposalSha256),
  binding: bindingSchema, ids: idsSchema, createdRowsSha256: sha, sourceSha256: z.literal(plan.source.sha256),
  preservedCards: z.literal(138), applicability: z.literal('unknown'), approved: z.literal(false), publication: z.null() }).strict();
type Tx = Prisma.TransactionClient;
type Binding = z.infer<typeof bindingSchema>;
type Ids = z.infer<typeof idsSchema>;
function conflict(message: string): never { throw new HttpError(409, message); }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export class StalePokemonPreparationSnapshotError extends HttpError {
  constructor(readonly idempotencyKey: string, readonly expectedSnapshotSha256: string) {
    super(409, 'Preparation snapshot changed; preview again.');
  }
}

async function snapshot(tx: Tx) {
  const where = { setId: plan.setId }, take = 501, orderBy = { id: 'asc' as const };
  const draft = await tx.setDraft.findUnique({ where, select: { id: true, setId: true, status: true, archivedAt: true, currentCatalogPublicationId: true } });
  if (!draft || draft.status !== 'REVIEW_REQUIRED' || draft.archivedAt || draft.currentCatalogPublicationId) conflict('The unapproved, unarchived Pokémon review draft is required.');
  const [cards, programs, versions, jobs, sources, parallels, scopes, counts, blockers] = await Promise.all([
    tx.setCard.findMany({ where, take, orderBy, select: { id: true, setId: true, programId: true, cardNumber: true, playerName: true, team: true, isRookie: true, metadataJson: true, sourceId: true } }),
    tx.setProgram.findMany({ where, take, orderBy, select: { id: true, setId: true, programId: true, label: true, codePrefix: true, programClass: true, sourceId: true } }),
    tx.setDraftVersion.findMany({ where: { draftId: draft.id }, take, orderBy, select: { id: true, draftId: true, version: true, versionHash: true, rowCount: true, blockingErrorCount: true, dataJson: true, sourceLinksJson: true } }),
    tx.setIngestionJob.findMany({ where, take, orderBy, select: { id: true, setId: true, draftId: true, datasetType: true, status: true, sourceUrl: true, parserVersion: true, rawPayload: true, parseSummaryJson: true } }),
    tx.setTaxonomySource.findMany({ where, take, orderBy, select: { id: true, setId: true, ingestionJobId: true, sourceKind: true, artifactType: true, sourceLabel: true, sourceUrl: true, parserVersion: true, metadataJson: true } }),
    tx.setParallel.findMany({ where, take, orderBy, select: { id: true, setId: true, parallelId: true, label: true, serialDenominator: true, serialText: true, finishFamily: true, visualCuesJson: true, sourceId: true } }),
    tx.setParallelScope.findMany({ where, take, orderBy, select: { id: true, setId: true, scopeKey: true, programId: true, parallelId: true, variationId: true, formatKey: true, channelKey: true, sourceId: true } }),
    Promise.all([tx.setCard.count({ where }), tx.setProgram.count({ where }), tx.setDraftVersion.count({ where: { draftId: draft.id } }),
      tx.setIngestionJob.count({ where }), tx.setTaxonomySource.count({ where }), tx.setParallel.count({ where }), tx.setParallelScope.count({ where })]),
    Promise.all([tx.setVariation.count({ where }), tx.setOddsByFormat.count({ where }), tx.setTaxonomyConflict.count({ where }), tx.setTaxonomyAmbiguityQueue.count({ where }),
      tx.cardVariantTaxonomyMap.count({ where }), tx.setApproval.count({ where: { draftId: draft.id } }),
      tx.setSeedJob.count({ where: { draftId: draft.id, status: { in: ['QUEUED', 'IN_PROGRESS'] } } }),
      tx.setReplaceJob.count({ where: { setId: plan.setId, status: { notIn: ['COMPLETE', 'FAILED', 'CANCELLED'] } } }),
      tx.setCatalogEvidencePublication.count({ where: { draftId: draft.id } })]),
  ]);
  const rosters = { cards, programs, versions, jobs, sources, parallels, scopes };
  Object.values(rosters).forEach((rows, index) => {
    if (rows.length >= take || rows.length !== counts[index] || new Set(rows.map(row => row.id)).size !== rows.length) conflict('Incomplete count-accounted Pokémon snapshot.');
  });
  if (blockers.some(Boolean) || cards.length !== 138 || programs.length !== 1 || jobs.length !== 1 || sources.length !== 1 || !versions.length) conflict('Expected one pending checklist source/job/program and exactly 138 cards, without approval or conflicting work.');
  const job = jobs[0], source = sources[0], program = programs[0];
  const latest = [...versions].sort((a, b) => b.version - a.version)[0];
  // The original content is pinned independently of its build-time timestamp.
  // The complete live dataJson (including generatedAt) stays in the snapshot,
  // so changing even that timestamp after preview invalidates the request.
  const { generatedAt, ...worksheetContent } = record(latest.dataJson);
  const summary = record(job.parseSummaryJson), applied = record(summary.taxonomyIngest), metadata = record(source.metadataJson);
  if (job.draftId !== draft.id || job.status !== 'REVIEW_REQUIRED' || job.datasetType !== 'PLAYER_WORKSHEET'
    || job.sourceUrl !== plan.source.url || job.parserVersion !== plan.source.parserVersion || hash(job.rawPayload) !== plan.source.rawPayloadSha256
    || summary.sourceProvider !== 'Pokémon' || hash(summary.sourceFetchMeta) !== plan.source.sourceFetchMetaSha256
    || applied.applied !== true || applied.adapter !== 'pinned-pilot-checklist-v1' || applied.sourceId !== source.id
    || hash(applied.counts) !== hash({ programs: 1, cards: 138, variations: 0, parallels: 0, scopes: 0, oddsRows: 0, conflicts: 0, ambiguities: 0, bridges: 0 })) conflict('Exact successful Pokémon checklist ingestion is required.');
  if (source.ingestionJobId !== job.id || source.sourceKind !== 'OFFICIAL_CHECKLIST' || source.artifactType !== 'CHECKLIST'
    || source.sourceUrl !== plan.source.url || source.parserVersion !== plan.source.parserVersion || source.sourceLabel !== 'pinned_pilot_checklist_v1'
    || metadata.authority !== 'unreviewed_source_transcription' || metadata.adapter !== 'pinned-pilot-checklist-v1'
    || metadata.humanReviewed !== false || metadata.rightsVerified !== false || metadata.sourcePinMatched !== true
    || hash(metadata.sourceFetchMeta) !== plan.source.sourceFetchMetaSha256) conflict('The exact pending official checklist source binding changed.');
  if (program.programId !== plan.programId || program.label !== plan.programLabel || program.sourceId !== source.id || program.codePrefix !== null || program.programClass !== null) conflict('The source-backed parent program changed.');
  if (latest.rowCount !== 138 || latest.blockingErrorCount || latest.versionHash !== plan.worksheet.versionHash
    || typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))
    || hash(worksheetContent) !== plan.worksheet.contentSha256 || summary.draftVersionId !== latest.id
    || record(latest.sourceLinksJson).ingestionJobId !== job.id || record(latest.sourceLinksJson).sourceUrl !== plan.source.url) conflict('The exact original latest clean 138-row worksheet is required; reconcile edited or rebuilt versions first.');
  for (const expected of plan.cards) {
    const card = cards.find(c => c.cardNumber === expected.number);
    if (!card || card.programId !== plan.programId || card.playerName !== expected.name || card.sourceId !== source.id
      || card.team !== null || card.isRookie !== null || hash(card.metadataJson) !== expected.metadataSha256) conflict('A Pokémon card identity or original source observation changed.');
  }
  if (json(rosters).length > 2 * 1024 * 1024) conflict('Pokémon preparation snapshot exceeds its bound.');
  const binding: Binding = { draftId: draft.id, draftVersionId: latest.id, ingestionJobId: job.id, sourceId: source.id, programRowId: program.id };
  return { draft, binding, ...rosters };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function assertFreeTargets(value: Snapshot) {
  // This is the new, single-source pilot only; existing printings need explicit
  // reconciliation instead of silent coexistence or replacement.
  if (value.parallels.length || value.scopes.length) conflict('Pokémon printing or scope mappings already exist. Reconcile the existing rows.');
}
function creationRows(ids: Ids, binding: Binding) {
  const parallels = plan.printings.map((p, index) => ({ id: ids.parallels[index], setId: plan.setId, parallelId: p.parallelId,
    label: p.label, serialDenominator: null, serialText: null, finishFamily: null, visualCuesJson: null, sourceId: binding.sourceId }));
  const scopes = plan.printings.map((p, index) => ({ id: ids.scopes[index], setId: plan.setId,
    scopeKey: [plan.programId, p.parallelId, 'none', 'any', 'any'].join('::'), programId: plan.programId,
    parallelId: p.parallelId, variationId: null, formatKey: null, channelKey: null, sourceId: binding.sourceId }));
  return { parallels, scopes };
}
function withoutCreated(value: Snapshot, ids: Ids): Snapshot {
  return { ...value, parallels: value.parallels.filter(p => !ids.parallels.includes(p.id)), scopes: value.scopes.filter(s => !ids.scopes.includes(s.id)) };
}
function verifiedCreated(value: Snapshot, ids: Ids, binding: Binding) {
  const expected = creationRows(ids, binding);
  for (const name of ['parallels', 'scopes'] as const) {
    for (const row of expected[name]) if (json(value[name].find(actual => actual.id === row.id) ?? null) !== json(row)) conflict('Prepared Pokémon mappings changed or are missing; replay cannot repair them.');
  }
  return expected;
}

/** A fixed pilot only. Reads source bytes before locks and reuses the original
 * pending source FK. No jobs, source/card/program/version rows or approvals are
 * created or rewritten. Table locks are short, fail-fast and admin-only. */
export function createPokemonCatalogPreparationService(dependencies: { db: PrismaClient; readArtifact?: CatalogArtifactReader }) {
  const { db } = dependencies, read = dependencies.readArtifact ?? readSetCatalogArtifact;
  function authorize(actor: AdminSession) { requireCatalogEnabled(); assertCatalogHuman(actor, 'reviewer'); }
  async function sourceBytes() {
    const bytes = await read(plan.source.ref);
    if (bytes.length !== plan.source.byteSize || createHash('sha256').update(bytes).digest('hex') !== plan.source.sha256) conflict('Pinned Pokémon source bytes differ.');
  }
  async function preview(actor: AdminSession) {
    authorize(actor); await sourceBytes();
    return db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`;
      const current = await snapshot(tx); assertFreeTargets(current);
      return { schemaVersion: 'setops-pokemon-additive-preparation-preview/v1', authority: 'unreviewed_preparation',
        setId: plan.setId, proposalSha256, snapshotSha256: hash(current), binding: current.binding,
        creates: { parallels: 2, scopes: 2 }, preservedCards: 138, applicability: 'unknown', approved: false, publication: null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 1000, timeout: 8000 });
  }
  async function stage(input: unknown, actor: AdminSession) {
    authorize(actor); const request = requestSchema.parse(input), requestSha256 = hash({ request, actorId: actor.user.id });
    const auditId = `pokemon-catalog-preparation:${request.idempotencyKey}`;
    await sourceBytes();
    return db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '750ms'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`;
      // Existing generic build/approval paths do not all lock SetDraft before
      // creating versions/jobs. Lock their actual tables too, preventing
      // phantoms and direct card-only maintenance inside the short transaction.
      // Reverse-order work fails through lock_timeout; never retry automatically.
      await tx.$executeRaw`LOCK TABLE "SetTaxonomySource", "SetProgram", "SetCard", "SetParallel", "SetParallelScope", "SetDraft", "SetDraftVersion", "SetIngestionJob", "SetApproval", "SetSeedJob", "SetReplaceJob", "SetCatalogEvidencePublication", "SetVariation", "SetOddsByFormat", "SetTaxonomyConflict", "SetTaxonomyAmbiguityQueue", "CardVariantTaxonomyMap" IN SHARE ROW EXCLUSIVE MODE`;
      const prior = await tx.setAuditEvent.findUnique({ where: { id: auditId } });
      if (prior) {
        const stored = z.object({ receipt: receiptSchema, receiptSha256: sha }).strict().parse(prior.metadataJson);
        if (prior.action !== ACTION || prior.status !== 'SUCCESS' || prior.actorId !== actor.user.id || prior.setId !== plan.setId
          || prior.draftId !== request.binding.draftId || prior.draftVersionId !== request.binding.draftVersionId
          || prior.ingestionJobId !== request.binding.ingestionJobId || prior.requestId !== request.idempotencyKey
          || stored.receipt.idempotencyKey !== request.idempotencyKey
          || stored.receipt.requestSha256 !== requestSha256 || stored.receipt.baselineSha256 !== request.expectedSnapshotSha256
          || json(stored.receipt.binding) !== json(request.binding) || hash(stored.receipt) !== stored.receiptSha256) conflict('Preparation key belongs to different evidence or reviewer.');
        const current = await snapshot(tx), created = verifiedCreated(current, stored.receipt.ids, request.binding);
        if (hash(created) !== stored.receipt.createdRowsSha256 || hash(withoutCreated(current, stored.receipt.ids)) !== stored.receipt.baselineSha256) conflict('Original Pokémon evidence changed; inspect the retained receipt before proceeding.');
        return { outcome: 'replay' as const, receipt: stored.receipt, receiptSha256: stored.receiptSha256 };
      }
      const before = await snapshot(tx); assertFreeTargets(before);
      if (hash(before) !== request.expectedSnapshotSha256 || json(before.binding) !== json(request.binding)) throw new StalePokemonPreparationSnapshotError(request.idempotencyKey, request.expectedSnapshotSha256);
      assertCatalogHuman(actor, 'reviewer');
      const ids: Ids = { parallels: [randomUUID(), randomUUID()], scopes: [randomUUID(), randomUUID()] };
      const rows = creationRows(ids, before.binding);
      for (const row of rows.parallels) await tx.setParallel.create({ data: { ...row, visualCuesJson: Prisma.DbNull } });
      for (const row of rows.scopes) await tx.setParallelScope.create({ data: row });
      const after = await snapshot(tx), created = verifiedCreated(after, ids, before.binding);
      if (hash(withoutCreated(after, ids)) !== request.expectedSnapshotSha256) conflict('Original Pokémon evidence changed during preparation.');
      const receipt = receiptSchema.parse({ schemaVersion: 'setops-pokemon-additive-preparation-receipt/v1', idempotencyKey: request.idempotencyKey,
        requestSha256, baselineSha256: request.expectedSnapshotSha256, proposalSha256, binding: before.binding, ids,
        createdRowsSha256: hash(created), sourceSha256: plan.source.sha256, preservedCards: 138, applicability: 'unknown', approved: false, publication: null });
      const receiptSha256 = hash(receipt);
      await tx.setAuditEvent.create({ data: { id: auditId, setId: plan.setId, draftId: before.binding.draftId, draftVersionId: before.binding.draftVersionId,
        ingestionJobId: before.binding.ingestionJobId, actorId: actor.user.id, action: ACTION, status: 'SUCCESS', requestId: request.idempotencyKey,
        reason: 'Prepared two literal checklist marker definitions/scopes; no applicability, approval or publication.', metadataJson: { receipt, receiptSha256 } } });
      return { outcome: 'recorded' as const, receipt, receiptSha256 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 1000, timeout: 8000 });
  }
  return { preview, stage };
}
