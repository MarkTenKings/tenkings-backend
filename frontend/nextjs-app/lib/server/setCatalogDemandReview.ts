import { createHash } from 'node:crypto';
import { prisma } from '@tenkings/database';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { canonicalJson, normalizeCatalogDemand, catalogDemandKey, validateCatalogDemandAcquisition, type CatalogDemandResult } from '@tenkings/card-catalog-evidence';
import { assertCatalogHuman, requireCatalogEnabled } from './setCatalogEvidenceAuth';
import { HttpError } from './adminSessionAuthority';
import type { AdminSession } from './admin';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const catalogDemandReviewQuery = z.union([z.object({}).strict(), z.object({ demandKey: sha, snapshotHash: sha, sourceId: sha.optional() }).strict()]);
export function createSetCatalogDemandReview(db: PrismaClient = prisma) {
  return async (input: unknown, actor: AdminSession) => {
    requireCatalogEnabled(); assertCatalogHuman(actor, 'reviewer');
    const request = catalogDemandReviewQuery.parse(input);
    if (!('demandKey' in request)) {
      const rows = await db.$queryRaw<{ demandKey: string; demandJson: unknown; state: string; attempt: number; resultHash: string | null; createdAt: Date }[]>`
        SELECT "demandKey","demandJson",state,attempt,"resultHash","createdAt" FROM "SetCatalogDemandJob" ORDER BY "createdAt" DESC,"demandKey" LIMIT 24`;
      const items = rows.map(row => {
        const demand = normalizeCatalogDemand(row.demandJson);
        if (catalogDemandKey(demand) !== row.demandKey) throw new HttpError(409, 'Demand identity integrity mismatch.');
        return { demandKey: row.demandKey, demand, state: row.state, attempt: row.attempt, snapshotHash: row.resultHash, createdAt: row.createdAt.toISOString() };
      });
      return { kind: 'json' as const, value: { schemaVersion: 'catalog-demand-review/v1', disposition: 'requires_authorized_review', items } };
    }
    const [row] = await db.$queryRaw<{ resultJson: CatalogDemandResult }[]>`SELECT "resultJson" FROM "SetCatalogDemandResult" WHERE "demandKey"=${request.demandKey} AND "snapshotHash"=${request.snapshotHash}`;
    if (!row) throw new HttpError(404, 'Demand preparation not found.');
    const result = validateCatalogDemandAcquisition(row.resultJson);
    if (result.demandKey !== request.demandKey || result.snapshotHash !== request.snapshotHash) throw new HttpError(409, 'Demand preparation integrity mismatch.');
    if (request.sourceId) {
      const source = result.sources.find(s => s.sourceId === request.sourceId);
      if (!source) throw new HttpError(404, 'Source is not in this preparation.');
      const [artifact] = await db.$queryRaw<{ bytes: Buffer; sha256: string }[]>`SELECT bytes,sha256 FROM "SetCatalogDemandSource" WHERE "demandKey"=${request.demandKey} AND "snapshotHash"=${request.snapshotHash} AND "sourceId"=${request.sourceId}`;
      if (!artifact || artifact.bytes.length !== source.byteSize || artifact.sha256 !== source.sha256 || createHash('sha256').update(artifact.bytes).digest('hex') !== source.sha256) throw new HttpError(409, 'Source artifact integrity mismatch.');
      return { kind: 'bytes' as const, bytes: artifact.bytes, sha256: source.sha256 };
    }
    const value = { schemaVersion: 'catalog-demand-review/v1', disposition: 'requires_authorized_review', result };
    if (Buffer.byteLength(canonicalJson(value)) > 4 * 1024 * 1024) throw new HttpError(413, 'Demand review exceeds its response bound.');
    return { kind: 'json' as const, value };
  };
}
export const reviewSetCatalogDemand = createSetCatalogDemandReview();
