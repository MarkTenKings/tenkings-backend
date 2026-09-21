import { createHash } from 'node:crypto';
import { prisma } from '@tenkings/database';
import { Prisma, type PrismaClient } from '@prisma/client';
import { canonicalJson } from '@tenkings/card-catalog-evidence';
import { z } from 'zod';
import type { AdminSession } from './admin';
import { HttpError } from './adminSessionAuthority';
import { assertCatalogHuman, requireCatalogEnabled } from './setCatalogEvidenceAuth';

export const CATALOG_TAXONOMY_EXPORT_LIMIT = 5000;
const requestSchema = z.object({ setId: z.string().min(1).max(256).refine(s => s === s.trim()) }).strict();
function exportSourceUrl(sourceUrl: string | null) {
  if (!sourceUrl) return { sourceUrl: null, sourceUrlStatus: 'missing' as const };
  try {
    const url = new URL(sourceUrl);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return { sourceUrl, sourceUrlStatus: 'canonical_https' as const };
  } catch { /* Preserve no credential-bearing or noncanonical URL in the download. */ }
  return { sourceUrl: null, sourceUrlStatus: 'withheld_noncanonical' as const };
}

/** Read-only preparation snapshot. It carries neither publication authority nor
 * usage grants. Explicit selects exclude raw payloads, private media and actors. */
export function createCatalogTaxonomyExporter(db: PrismaClient = prisma) {
  return async (input: unknown, actor: AdminSession) => {
    requireCatalogEnabled(); assertCatalogHuman(actor, 'reviewer');
    const { setId } = requestSchema.parse(input);
    return db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const draft = await tx.setDraft.findUnique({ where: { setId }, select: {
        id: true, setId: true, normalizedLabel: true, status: true, archivedAt: true, currentCatalogPublicationId: true,
      } });
      if (!draft) throw new HttpError(404, 'No existing SetOps draft for this exact set. Prepare it through the normal clean import workflow.');
      const where = { setId }, take = CATALOG_TAXONOMY_EXPORT_LIMIT + 1, orderBy = { id: 'asc' as const };
      const [version, latestPublication, sources, programs, cards, parallels, variations, scopes, seedJobs, replaceJobs] = await Promise.all([
        tx.setDraftVersion.findFirst({ where: { draftId: draft.id }, orderBy: { version: 'desc' }, select: {
          id: true, draftId: true, version: true, versionHash: true, rowCount: true, blockingErrorCount: true,
        } }),
        tx.setCatalogEvidencePublication.findFirst({ where: { draftId: draft.id }, orderBy: { revision: 'desc' }, select: {
          id: true, revision: true, manifestSha256: true,
        } }),
        tx.setTaxonomySource.findMany({ where, take, orderBy, select: {
          id: true, setId: true, sourceKind: true, artifactType: true, sourceLabel: true, sourceUrl: true,
        } }),
        tx.setProgram.findMany({ where, take, orderBy, select: { id: true, setId: true, programId: true, label: true, sourceId: true } }),
        tx.setCard.findMany({ where, take, orderBy, select: { id: true, setId: true, programId: true, cardNumber: true, playerName: true, sourceId: true } }),
        tx.setParallel.findMany({ where, take, orderBy, select: { id: true, setId: true, parallelId: true, label: true, serialDenominator: true, sourceId: true } }),
        tx.setVariation.findMany({ where, take, orderBy, select: { id: true, setId: true, programId: true, variationId: true, label: true, sourceId: true } }),
        tx.setParallelScope.findMany({ where, take, orderBy, select: { id: true, setId: true, programId: true, parallelId: true, variationId: true, formatKey: true, channelKey: true, sourceId: true } }),
        tx.setSeedJob.count({ where: { draftId: draft.id, status: { in: ['QUEUED', 'IN_PROGRESS'] } } }),
        tx.setReplaceJob.count({ where: { setId, status: { notIn: ['COMPLETE', 'FAILED', 'CANCELLED'] } } }),
      ]);
      const rows = { sources: sources.map(source => ({ ...source, ...exportSourceUrl(source.sourceUrl) })), programs, cards, parallels, variations, scopes };
      if (Object.values(rows).some(a => a.length > CATALOG_TAXONOMY_EXPORT_LIMIT)) throw new HttpError(413, 'This set exceeds the 5,000-row preparation limit. No partial taxonomy export was produced.');
      const blockers = [
        ...(draft.archivedAt ? ['set_archived'] : []), ...(draft.status !== 'APPROVED' ? ['draft_not_approved'] : []),
        ...(!version ? ['draft_version_missing'] : version.blockingErrorCount ? ['draft_has_blocking_errors'] : []),
        ...(seedJobs ? ['seed_work_active'] : []), ...(replaceJobs ? ['replacement_active'] : []),
      ];
      const snapshot = { exportedAt: new Date().toISOString(), setId, draft: { ...draft, archivedAt: draft.archivedAt?.toISOString() ?? null },
        latestVersion: version, latestPublication, blockers, ...rows };
      // This checksum detects file damage. The publication writer independently
      // revalidates every ID/source against its database and actual human session.
      const raw = JSON.stringify(snapshot);
      if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new HttpError(413, 'Taxonomy preparation exceeds 2 MiB. No partial export was produced.');
      const snapshotSha256 = createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
      return { schemaVersion: 'setops-catalog-taxonomy-export/v1' as const, authority: 'unreviewed_taxonomy_snapshot' as const, snapshot, snapshotSha256 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 });
  };
}

export const exportCatalogTaxonomy = createCatalogTaxonomyExporter();
