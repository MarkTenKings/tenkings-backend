import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@tenkings/database';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CatalogContractError, canonicalJson, createPublishedCatalogReader, hashManifest, prepareObservationProposal, validateManifest,
  type CatalogManifest, type CatalogQuery, type DeepReadonly, type PublicationPin } from '@tenkings/card-catalog-evidence';
import type { AdminSession } from './admin';
import { HttpError } from './adminSessionAuthority';
import { assertCatalogHuman, catalogEvidenceEnabled, requireCatalogEnabled } from './setCatalogEvidenceAuth';
import { assertCatalogGrants, hashCatalogVerification, parseCatalogVerification, prepareCatalogVerification,
  readSetCatalogArtifact, verifyCatalogImageBytes, type CatalogArtifactReader, type CatalogConsumer, type CatalogVerification } from './setCatalogEvidenceMedia';

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(256);
export const catalogPublicationPinSchema = z.object({ publicationId: id, setId: id, revision: z.number().int().positive(), manifestSha256: sha }).strict();
export const catalogPublishSchema = z.object({ manifest: z.unknown(), reviewEvidence: z.unknown(), manifestSha256: sha, verificationSha256: sha,
  expectedCurrent: catalogPublicationPinSchema.nullable(), expectedHistory: catalogPublicationPinSchema.nullable(),
  acknowledgement: z.literal('PUBLISH REVIEWED CATALOG EVIDENCE') }).strict();
export const catalogRevokeSchema = z.object({ publication: catalogPublicationPinSchema, reason: z.string().trim().min(1).max(1000) }).strict();
type Tx = Prisma.TransactionClient;
type PublicationRow = Awaited<ReturnType<PrismaClient['setCatalogEvidencePublication']['findFirstOrThrow']>>;
const pinFor = (row: PublicationRow, setId: string): PublicationPin => ({ publicationId: row.id, setId, revision: row.revision, manifestSha256: row.manifestSha256 });
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function conflict(message: string): never { throw new HttpError(409, message); }
const normalize = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

async function assertTaxonomy(tx: Tx, manifest: DeepReadonly<CatalogManifest>, verification: CatalogVerification) {
  const setId = manifest.set.setId;
  const [programs, cards, parallels, variations, scopes, sources] = await Promise.all([
    tx.setProgram.findMany({ where: { id: { in: manifest.programs.map(p => p.rowId) }, setId } }),
    tx.setCard.findMany({ where: { id: { in: manifest.cards.map(c => c.cardId) }, setId } }),
    tx.setParallel.findMany({ where: { id: { in: manifest.printings.map(p => p.parallelRowId) }, setId } }),
    tx.setVariation.findMany({ where: { id: { in: manifest.printings.flatMap(p => p.variationRowId ? [p.variationRowId] : []) }, setId } }),
    tx.setParallelScope.findMany({ where: { id: { in: manifest.printings.map(p => p.scopeRowId) }, setId } }),
    tx.setTaxonomySource.findMany({ where: { id: { in: verification.sources.flatMap(s => s.taxonomySourceId ? [s.taxonomySourceId] : []) }, setId } }),
  ]);
  for (const program of manifest.programs) if (!programs.some(p => p.id === program.rowId && p.programId === program.programId && p.label === program.label)) conflict('Catalog program identity differs from SetOps.');
  for (const card of manifest.cards) if (!cards.some(c => c.id === card.cardId && c.programId === card.programId && c.cardNumber === card.number && c.playerName === card.name)) conflict('Catalog card identity differs from SetOps.');
  for (const printing of manifest.printings) {
    if (!parallels.some(p => p.id === printing.parallelRowId && p.parallelId === printing.parallelId)) conflict('Catalog parallel identity differs from SetOps.');
    if (printing.variationId && !variations.some(v => v.id === printing.variationRowId && v.programId === printing.programId && v.variationId === printing.variationId)) conflict('Catalog variation identity differs from SetOps.');
    const scope = scopes.find(s => s.id === printing.scopeRowId);
    if (!scope || scope.programId !== printing.programId || scope.parallelId !== printing.parallelId || scope.variationId !== printing.variationId
      || (scope.formatKey !== null && scope.formatKey !== printing.format) || (scope.channelKey !== null && scope.channelKey !== printing.channel)) conflict('Catalog printing scope differs from SetOps.');
  }
  for (const source of manifest.sources) {
    const reviewed = verification.sources.find(s => s.sourceId === source.sourceId)!;
    const row = sources.find(s => s.id === reviewed.taxonomySourceId);
    const allowed = ({ OFFICIAL_CHECKLIST: ['OFFICIAL_CHECKLIST'], OFFICIAL_PRODUCT: ['OFFICIAL_CHECKLIST', 'OFFICIAL_ODDS'], APPROVED_SECONDARY: ['TRUSTED_SECONDARY'] } as Record<string, string[]>)[source.kind];
    if (allowed && (!row || !allowed.includes(row.sourceKind) || row.sourceUrl !== source.sourceUrl)) conflict('Canonical source classification and URL must match its exact SetOps source.');
    if (reviewed.taxonomySourceId && !row) conflict('Catalog taxonomy source belongs to another set or is missing.');
  }
}

/** Server composition seam. Tests may supply their own disposable DB and byte reader;
 * no HTTP request can supply this object or replace the authorized loader. */
export function createSetCatalogEvidenceService(dependencies: { db?: PrismaClient; readArtifact?: CatalogArtifactReader } = {}) {
  const db = dependencies.db ?? prisma;
  const readArtifact = dependencies.readArtifact ?? readSetCatalogArtifact;
  const transaction = <T>(fn: (tx: Tx) => Promise<T>) => db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });

  async function state(tx: Tx, draftId: string, lock = false) {
    if (lock) await tx.$queryRaw(Prisma.sql`SELECT id FROM "SetDraft" WHERE id = ${draftId} FOR UPDATE`);
    const draft = await tx.setDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new HttpError(404, 'SetOps draft not found.');
    const latest = await tx.setCatalogEvidencePublication.findFirst({ where: { draftId }, orderBy: { revision: 'desc' } });
    const current = draft.currentCatalogPublicationId ? await tx.setCatalogEvidencePublication.findUnique({ where: { id: draft.currentCatalogPublicationId } }) : null;
    return { draft, latest, current, expectedCurrent: current ? pinFor(current, draft.setId) : null, expectedHistory: latest ? pinFor(latest, draft.setId) : null };
  }
  async function eligible(tx: Tx, manifest: DeepReadonly<CatalogManifest>, verification: CatalogVerification) {
    const version = await tx.setDraftVersion.findUnique({ where: { id: manifest.setOps.draftVersionId } });
    const latestVersion = await tx.setDraftVersion.findFirst({ where: { draftId: manifest.setOps.draftId }, orderBy: { version: 'desc' } });
    if (!version || version.draftId !== manifest.setOps.draftId || version.versionHash !== manifest.setOps.legacyVersionHash || version.blockingErrorCount || latestVersion?.id !== version.id) conflict('The exact latest clean SetOps draft version is required.');
    if (await tx.setSeedJob.count({ where: { draftId: manifest.setOps.draftId, status: { in: ['QUEUED', 'IN_PROGRESS'] } } })) conflict('Wait for the existing SetOps seed operation to finish.');
    if (await tx.setReplaceJob.count({ where: { setId: manifest.set.setId, status: { notIn: ['COMPLETE', 'FAILED', 'CANCELLED'] } } })) conflict('A SetOps replacement is active.');
    await assertTaxonomy(tx, manifest, verification);
    return version;
  }
  async function currentEligibility(tx: Tx, row: PublicationRow, setId: string) {
    const [version, seedJobs, replacements, laterApproval] = await Promise.all([
      tx.setDraftVersion.findFirst({ where: { draftId: row.draftId }, orderBy: { version: 'desc' } }),
      tx.setSeedJob.count({ where: { draftId: row.draftId, status: { in: ['QUEUED', 'IN_PROGRESS'] } } }),
      tx.setReplaceJob.count({ where: { setId, status: { notIn: ['COMPLETE', 'FAILED', 'CANCELLED'] } } }),
      // Ordinary approval/rejection cannot renew a full-manifest review. Treat
      // an ambiguous timestamp tie conservatively until a fresh catalog review.
      tx.setApproval.findFirst({ where: { draftId: row.draftId, id: { not: row.setApprovalId }, createdAt: { gte: row.reviewedAt } }, select: { id: true } }),
    ]);
    return version?.id === row.draftVersionId && version.draftId === row.draftId && !version.blockingErrorCount
      && !seedJobs && !replacements && !laterApproval ? version : null;
  }
  async function load(tx: Tx, pin: PublicationPin, consumer: CatalogConsumer) {
    const row = await tx.setCatalogEvidencePublication.findUnique({ where: { id: pin.publicationId } });
    if (!row) return null;
    const s = await state(tx, row.draftId);
    if (!s.current || s.current.id !== row.id || s.latest?.id !== row.id || s.draft.archivedAt || s.draft.status !== 'APPROVED' || !equal(pinFor(row, s.draft.setId), pin)) return null;
    const version = await currentEligibility(tx, row, s.draft.setId);
    if (!version) return null;
    let manifest: DeepReadonly<CatalogManifest>, verification: CatalogVerification;
    try { manifest = validateManifest(row.manifestJson); verification = parseCatalogVerification(row.verificationJson); }
    catch { throw new HttpError(503, 'Stored catalog integrity check failed.'); }
    if (hashManifest(manifest) !== row.manifestSha256 || hashCatalogVerification(verification) !== row.verificationSha256
      || manifest.setOps.draftId !== row.draftId || manifest.setOps.draftVersionId !== row.draftVersionId) throw new HttpError(503, 'Stored catalog integrity check failed.');
    try { assertCatalogGrants(manifest, verification, consumer); }
    catch (error) { if (error instanceof HttpError && error.statusCode === 403) throw error; throw new HttpError(503, 'Stored catalog grants are inconsistent.'); }
    const approval = await tx.setApproval.findUnique({ where: { id: row.setApprovalId } });
    const review = approval?.diffSummaryJson as { catalogPublicationId?: string; manifestSha256?: string; verificationSha256?: string } | null;
    if (!approval || !version || approval.decision !== 'APPROVED' || approval.draftId !== row.draftId || approval.draftVersionId !== row.draftVersionId
      || approval.approvedById !== row.reviewedById || approval.versionHash !== manifest.setOps.legacyVersionHash || version.versionHash !== approval.versionHash
      || review?.catalogPublicationId !== row.id || review.manifestSha256 !== row.manifestSha256 || review.verificationSha256 !== row.verificationSha256) throw new HttpError(503, 'Stored catalog review binding failed.');
    const prior = row.supersedesPublicationId ? await tx.setCatalogEvidencePublication.findUnique({ where: { id: row.supersedesPublicationId } }) : null;
    if (row.revision !== (prior?.revision ?? 0) + 1 || !equal(manifest.supersedes, prior ? pinFor(prior, pin.setId) : null)) throw new HttpError(503, 'Stored catalog predecessor failed.');
    try { await assertTaxonomy(tx, manifest, verification); }
    catch { throw new HttpError(503, 'Reviewed catalog taxonomy binding has changed.'); }
    return { row, manifest, verification, authority: { ...pin, state: 'current' as const, draftId: row.draftId, draftVersionId: row.draftVersionId,
      setApprovalId: row.setApprovalId, reviewedById: row.reviewedById, reviewedAt: row.reviewedAt.toISOString() } };
  }
  async function loadCurrentSetCatalogPublication(input: { setId: string; consumer?: CatalogConsumer }): Promise<PublicationPin | null> {
    if (!catalogEvidenceEnabled()) return null;
    return transaction(async tx => {
      const draft = await tx.setDraft.findUnique({ where: { setId: id.parse(input.setId) } });
      if (!draft?.currentCatalogPublicationId) return null;
      const row = await tx.setCatalogEvidencePublication.findUnique({ where: { id: draft.currentCatalogPublicationId } });
      if (!row) return null;
      const pin = pinFor(row, draft.setId);
      return await load(tx, pin, input.consumer ?? 'inventory') ? pin : null;
    });
  }
  async function isSetCatalogPublicationCurrent(publication: PublicationPin, consumer: CatalogConsumer = 'inventory') {
    if (!catalogEvidenceEnabled()) return false;
    return transaction(async tx => Boolean(await load(tx, catalogPublicationPinSchema.parse(publication), consumer)));
  }
  async function lookupPublishedSetCatalogEvidence(input: { publication: PublicationPin; query: CatalogQuery; consumer?: CatalogConsumer }) {
    requireCatalogEnabled();
    try {
      return await transaction(tx => createPublishedCatalogReader({ loadAuthorizedPublication: async pin => {
        const loaded = await load(tx, { ...pin }, input.consumer ?? 'inventory');
        return loaded ? { manifest: loaded.manifest, authority: loaded.authority } : null;
      } }).lookup({ publication: input.publication, query: input.query }));
    } catch (error) {
      if (error instanceof CatalogContractError && error.code === 'PUBLICATION_UNAVAILABLE') throw new HttpError(404, 'Current catalog publication unavailable.');
      if (error instanceof CatalogContractError && !error.path.startsWith('request') && !error.path.startsWith('query')) throw new HttpError(503, 'Stored catalog integrity check failed.');
      throw error;
    }
  }
  async function findCurrentSetCatalogPublications(input: { query: CatalogQuery; consumer?: CatalogConsumer }): Promise<PublicationPin[]> {
    if (!catalogEvidenceEnabled()) return [];
    const q = input.query;
    if (!['SPORTS', 'POKEMON'].includes(q.category) || (!q.setId && (!q.setLabel || !q.year))) return [];
    // Find only bounded pins in SQL; never materialize a year's complete
    // manifests merely to identify an exact set/alias.
    return transaction(async tx => {
      const candidates = await tx.$queryRaw<PublicationPin[]>(Prisma.sql`
        SELECT p.id AS "publicationId", d."setId", p.revision, p."manifestSha256"
        FROM "SetCatalogEvidencePublication" p JOIN "SetDraft" d ON d."currentCatalogPublicationId"=p.id
        WHERE d."archivedAt" IS NULL AND d.status='APPROVED'
          AND p."manifestJson"#>>'{set,category}'=${q.category}
          AND (${q.setId ?? null}::text IS NULL OR d."setId"=${q.setId ?? null})
          AND (${q.year ?? null}::text IS NULL OR lower(regexp_replace(btrim(normalize(p."manifestJson"#>>'{set,year}', NFC)), '[[:space:]]+', ' ', 'g'))=${q.year ? normalize(q.year) : null})
          AND (${q.manufacturer ?? null}::text IS NULL OR lower(regexp_replace(btrim(normalize(p."manifestJson"#>>'{set,manufacturer}', NFC)), '[[:space:]]+', ' ', 'g'))=${q.manufacturer ? normalize(q.manufacturer) : null})
          AND (${q.publisher ?? null}::text IS NULL OR lower(regexp_replace(btrim(normalize(p."manifestJson"#>>'{set,publisher}', NFC)), '[[:space:]]+', ' ', 'g'))=${q.publisher ? normalize(q.publisher) : null})
          AND (${q.setLabel ?? null}::text IS NULL
            OR lower(regexp_replace(btrim(normalize(p."manifestJson"#>>'{set,label}', NFC)), '[[:space:]]+', ' ', 'g'))=${q.setLabel ? normalize(q.setLabel) : null}
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(p."manifestJson"->'aliases') a
              WHERE a->>'kind'='set_label' AND a->>'targetId'=d."setId" AND a#>>'{scope,category}'=${q.category}
                AND a#>>'{scope,setId}'=d."setId" AND a#>>'{scope,programId}' IS NULL
                AND (a#>>'{scope,language}' IS NULL OR a#>>'{scope,language}'=${q.language ?? null})
                AND lower(regexp_replace(btrim(normalize(a->>'value', NFC)), '[[:space:]]+', ' ', 'g'))=${q.setLabel ? normalize(q.setLabel) : null}))
        ORDER BY p.id LIMIT 9`);
      if (candidates.length > 8) throw new HttpError(409, 'Catalog discovery is truncated; select the exact SetOps set.');
      const found: PublicationPin[] = [];
      for (const pin of candidates) {
        const loaded = await load(tx, pin, input.consumer ?? 'inventory');
        if (!loaded) continue;
        const m = loaded.manifest;
        if (m.set.category !== q.category || (q.year && normalize(m.set.year) !== normalize(q.year))
          || (q.manufacturer && normalize(m.set.manufacturer ?? '') !== normalize(q.manufacturer)) || (q.publisher && normalize(m.set.publisher ?? '') !== normalize(q.publisher))) continue;
        const aliasMatches = m.aliases.some(a => a.kind === 'set_label' && normalize(a.value) === normalize(q.setLabel ?? '')
          && a.scope.category === q.category && a.scope.setId === m.set.setId && a.scope.programId === null && (a.scope.language === null || a.scope.language === q.language));
        if (q.setLabel && normalize(m.set.label) !== normalize(q.setLabel) && !aliasMatches) continue;
        found.push(pin);
      }
      return found;
    });
  }
  async function previewSetCatalogEvidence(input: { manifest: unknown; reviewEvidence: unknown }, actor: AdminSession) {
    requireCatalogEnabled(); assertCatalogHuman(actor, 'reviewer');
    const manifest = validateManifest(input.manifest), prepared = await prepareCatalogVerification(manifest, input.reviewEvidence, readArtifact);
    return transaction(async tx => {
      const s = await state(tx, manifest.setOps.draftId);
      if (s.draft.setId !== manifest.set.setId || s.draft.archivedAt || s.draft.status !== 'APPROVED') conflict('Approve the clean SetOps draft before reviewing catalog evidence.');
      await eligible(tx, manifest, prepared.verification);
      if (manifest.revision !== (s.latest?.revision ?? 0) + 1 || !equal(manifest.supersedes, s.expectedHistory)) conflict('Manifest revision/predecessor must match the latest catalog history.');
      return { manifest, manifestSha256: hashManifest(manifest), ...prepared, expectedCurrent: s.expectedCurrent, expectedHistory: s.expectedHistory,
        previousManifest: s.latest?.manifestJson ?? null };
    });
  }
  async function publishSetCatalogEvidence(input: unknown, actor: AdminSession) {
    requireCatalogEnabled(); assertCatalogHuman(actor, 'approver');
    const request = catalogPublishSchema.parse(input), manifest = validateManifest(request.manifest);
    const prepared = await prepareCatalogVerification(manifest, request.reviewEvidence, readArtifact);
    if (hashManifest(manifest) !== request.manifestSha256 || prepared.verificationSha256 !== request.verificationSha256) conflict('Reviewed evidence changed; preview and review again.');
    return db.$transaction(async tx => {
      const s = await state(tx, manifest.setOps.draftId, true);
      const existing = await tx.setCatalogEvidencePublication.findUnique({ where: { draftId_revision: { draftId: s.draft.id, revision: manifest.revision } } });
      if (existing) {
        if (existing.manifestSha256 !== request.manifestSha256 || existing.verificationSha256 !== request.verificationSha256 || existing.reviewedById !== actor.user.id) conflict('This revision already contains different reviewed evidence.');
        const current = s.current?.id === existing.id && s.latest?.id === existing.id && !s.draft.archivedAt && s.draft.status === 'APPROVED'
          && Boolean(await currentEligibility(tx, existing, s.draft.setId));
        return { publication: pinFor(existing, s.draft.setId), outcome: 'replay' as const, current };
      }
      if (s.draft.setId !== manifest.set.setId || s.draft.archivedAt || s.draft.status !== 'APPROVED') conflict('Catalog draft is unavailable.');
      if (!equal(s.expectedCurrent, request.expectedCurrent) || !equal(s.expectedHistory, request.expectedHistory) || !equal(manifest.supersedes, s.expectedHistory)
        || manifest.revision !== (s.latest?.revision ?? 0) + 1) conflict('Current or historical catalog pin changed.');
      const version = await eligible(tx, manifest, prepared.verification);
      assertCatalogHuman(actor, 'approver');
      const reviewedAt = new Date(), publicationId = randomUUID();
      const approval = await tx.setApproval.create({ data: { draftId: s.draft.id, draftVersionId: version.id, decision: 'APPROVED', versionHash: version.versionHash,
        approvedById: actor.user.id, reason: 'Explicit complete catalog evidence review', createdAt: reviewedAt,
        diffSummaryJson: { catalogPublicationId: publicationId, manifestSha256: request.manifestSha256, verificationSha256: request.verificationSha256 } } });
      const row = await tx.setCatalogEvidencePublication.create({ data: { id: publicationId, draftId: s.draft.id, draftVersionId: version.id, setApprovalId: approval.id,
        schemaVersion: manifest.schemaVersion, revision: manifest.revision, manifestJson: JSON.parse(canonicalJson(manifest)), manifestSha256: request.manifestSha256,
        verificationJson: JSON.parse(canonicalJson(prepared.verification)), verificationSha256: request.verificationSha256,
        supersedesPublicationId: s.latest?.id ?? null, reviewedById: actor.user.id, reviewedAt } });
      const persisted = await tx.setCatalogEvidencePublication.findUniqueOrThrow({ where: { id: row.id } });
      if (hashManifest(persisted.manifestJson) !== request.manifestSha256 || hashCatalogVerification(persisted.verificationJson) !== request.verificationSha256) conflict('Persisted catalog hash mismatch.');
      await tx.setAuditEvent.create({ data: { draftId: s.draft.id, setId: s.draft.setId, draftVersionId: version.id, approvalId: approval.id, actorId: actor.user.id,
        action: 'set_ops.catalog.publish', status: 'SUCCESS', metadataJson: { publicationId: row.id, manifestSha256: row.manifestSha256, verificationSha256: row.verificationSha256, supersedesPublicationId: row.supersedesPublicationId } } });
      await tx.setDraft.update({ where: { id: s.draft.id }, data: { currentCatalogPublicationId: row.id } });
      return { publication: pinFor(row, s.draft.setId), outcome: 'recorded' as const, current: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  }
  async function revokeSetCatalogEvidence(input: unknown, actor: AdminSession) {
    requireCatalogEnabled(); assertCatalogHuman(actor, 'approver');
    const request = catalogRevokeSchema.parse(input);
    return db.$transaction(async tx => {
      const row = await tx.setCatalogEvidencePublication.findUnique({ where: { id: request.publication.publicationId } });
      if (!row) throw new HttpError(404, 'Catalog publication not found.');
      const s = await state(tx, row.draftId, true);
      if (!equal(pinFor(row, s.draft.setId), request.publication)) conflict('Revocation pin mismatch.');
      const recorded = await tx.setAuditEvent.findFirst({ where: { draftId: row.draftId, action: 'set_ops.catalog.revoke', status: 'SUCCESS', metadataJson: { path: ['publicationId'], equals: row.id } } });
      if (recorded) return { publication: request.publication, outcome: 'replay' as const, current: false };
      if (s.current?.id !== row.id) conflict('A different catalog publication is current.');
      await tx.setAuditEvent.create({ data: { draftId: row.draftId, setId: s.draft.setId, draftVersionId: row.draftVersionId, approvalId: row.setApprovalId, actorId: actor.user.id,
        action: 'set_ops.catalog.revoke', status: 'SUCCESS', reason: request.reason, metadataJson: { publicationId: row.id, manifestSha256: row.manifestSha256 } } });
      await tx.setDraft.update({ where: { id: row.draftId }, data: { currentCatalogPublicationId: null } });
      return { publication: request.publication, outcome: 'recorded' as const, current: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  }
  async function readPublishedSetCatalogImage(input: { publication: PublicationPin; imageId: string; consumer?: CatalogConsumer }) {
    requireCatalogEnabled();
    const found = await transaction(tx => load(tx, catalogPublicationPinSchema.parse(input.publication), input.consumer ?? 'inventory'));
    if (!found) throw new HttpError(404, 'Current catalog publication unavailable.');
    const image = found.manifest.images.find(i => i.imageId === input.imageId);
    if (!image) throw new HttpError(404, 'Image is not in this reviewed publication.');
    const bytes = await readArtifact(image.mediaRef);
    await verifyCatalogImageBytes(bytes, image);
    if (!await isSetCatalogPublicationCurrent(input.publication, input.consumer)) conflict('Catalog permission changed while reading the image.');
    return { bytes, mimeType: image.mimeType, sha256: image.sha256, width: image.width, height: image.height };
  }
  async function submitSetCatalogObservationProposal(input: { proposal: unknown; authority: CatalogProposalAuthority }) {
    requireCatalogEnabled();
    const authority = proposalAuthoritySchema.parse(input.authority), prepared = prepareObservationProposal(input.proposal);
    const p = prepared.proposal;
    if (p.producer !== authority.producer || p.physicalCardRef !== authority.binding.physicalCardRef || p.observationId !== authority.binding.observationId || p.inputRevision !== authority.binding.inputRevision) throw new HttpError(403, 'Proposal does not match its authenticated physical-record binding.');
    const bindingSha256 = hash(authority), proposalId = randomUUID();
    // INSERT ON CONFLICT keeps the transaction usable under concurrent retries.
    return db.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "SetCatalogObservationProposal" (id, producer, "observationId", "inputRevision", "physicalCardRef", "proposalJson", "proposalSha256", "actorKind", "actorRef", "bindingJson", "bindingSha256", "submittedById") VALUES (${proposalId}, ${p.producer}, ${p.observationId}, ${p.inputRevision}, ${p.physicalCardRef}, ${canonicalJson(p)}::jsonb, ${prepared.proposalSha256}, ${authority.actorKind}, ${authority.actorRef}, ${canonicalJson(authority)}::jsonb, ${bindingSha256}, ${authority.userId}) ON CONFLICT (producer, "observationId", "inputRevision") DO NOTHING`);
      const row = await tx.setCatalogObservationProposal.findUniqueOrThrow({ where: { producer_observationId_inputRevision: { producer: p.producer, observationId: p.observationId, inputRevision: p.inputRevision } } });
      if (row.proposalSha256 !== prepared.proposalSha256 || row.bindingSha256 !== bindingSha256 || hash(row.proposalJson) !== prepared.proposalSha256 || hash(row.bindingJson) !== bindingSha256) conflict('Observation replay conflicts with its original payload or authority.');
      return { proposalId: row.id, proposalSha256: row.proposalSha256, idempotencyKey: prepared.idempotencyKey, outcome: row.id === proposalId ? 'recorded' as const : 'replay' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  return { loadCurrentSetCatalogPublication, findCurrentSetCatalogPublications, lookupPublishedSetCatalogEvidence, isSetCatalogPublicationCurrent,
    previewSetCatalogEvidence, publishSetCatalogEvidence, revokeSetCatalogEvidence, readPublishedSetCatalogImage, submitSetCatalogObservationProposal };
}

const proposalAuthoritySchema = z.object({ producer: z.enum(['inventory', 'atlas']), actorKind: z.enum(['human', 'service']), actorRef: id, userId: id.nullable(),
  binding: z.object({ physicalCardRef: id, observationId: id, inputRevision: id, evidenceSha256: sha }).strict() }).strict()
  .refine(v => v.actorKind === 'human' ? v.userId !== null : v.userId === null, 'Human principals need a real user; service principals do not use a fabricated user.');
export type CatalogProposalAuthority = z.infer<typeof proposalAuthoritySchema>;
export const { loadCurrentSetCatalogPublication, findCurrentSetCatalogPublications, lookupPublishedSetCatalogEvidence, isSetCatalogPublicationCurrent,
  previewSetCatalogEvidence, publishSetCatalogEvidence, revokeSetCatalogEvidence, readPublishedSetCatalogImage, submitSetCatalogObservationProposal } = createSetCatalogEvidenceService();
