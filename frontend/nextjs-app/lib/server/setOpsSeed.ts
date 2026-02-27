import { randomUUID } from "node:crypto";
import { prisma, SetSeedJobStatus, type Prisma } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { extractDraftRows } from "./setOpsDrafts";
import {
  buildCanonicalVariantIdentityLookupKey,
  buildPreferredSetOpsVariantIdentityLookupKey,
  loadSetOpsVariantIdentityContext,
  resolveSetOpsVariantIdentity,
} from "./setOpsVariantIdentity";

export type SeedExecutionSummary = {
  status: SetSeedJobStatus;
  processed: number;
  inserted: number;
  updated: number;
  failed: number;
  skipped: number;
  queueCount: number;
  logs: string[];
  durationMs: number;
};

function blockingErrorCount(row: { errors: Array<{ blocking: boolean }> }) {
  return row.errors.filter((issue) => issue.blocking).length;
}

async function computeQueueCount(setId: string) {
  const identityContext = await loadSetOpsVariantIdentityContext({
    setId,
    setIdCandidates: [setId],
  });

  const variants = await prisma.cardVariant.findMany({
    where: { setId },
    select: {
      id: true,
      cardNumber: true,
      parallelId: true,
    },
  });

  const grouped = await prisma.cardVariantReferenceImage.groupBy({
    by: ["cardNumber", "parallelId"],
    where: { setId },
    _count: { _all: true },
  });

  const refCounts = new Map<string, number>();
  for (const row of grouped) {
    const identity = resolveSetOpsVariantIdentity({
      context: identityContext,
      cardNumber: row.cardNumber,
      parallelId: row.parallelId,
    });
    const identityKey = buildPreferredSetOpsVariantIdentityLookupKey(identity);
    refCounts.set(identityKey, (refCounts.get(identityKey) ?? 0) + row._count._all);
  }

  let queueCount = 0;
  for (const variant of variants) {
    const identity = resolveSetOpsVariantIdentity({
      context: identityContext,
      cardNumber: variant.cardNumber,
      parallelId: variant.parallelId,
    });
    const canonicalKey = identityContext.preferredCanonicalKeyByVariantId.get(variant.id) ?? null;
    const canonicalIdentityKey = canonicalKey ? buildCanonicalVariantIdentityLookupKey(canonicalKey) : null;
    const identityKey = canonicalIdentityKey || buildPreferredSetOpsVariantIdentityLookupKey(identity);
    const count = refCounts.get(identityKey) ?? 0;
    if (count < 2) queueCount += 1;
  }
  return queueCount;
}

export async function runSeedJob(params: {
  jobId: string;
  setId: string;
  draftDataJson: unknown;
}) {
  const setId = normalizeSetLabel(params.setId);
  const startedAt = Date.now();
  const logs: string[] = [];

  const allRows = extractDraftRows(params.draftDataJson);
  const rows = allRows.filter((row) => normalizeSetLabel(row.setId) === setId);
  const total = rows.length;
  const identityContext = await loadSetOpsVariantIdentityContext({
    setId,
    setIdCandidates: [setId],
  });
  const variantIdByCanonicalKey = new Map(identityContext.variantIdByCanonicalKey);
  const variantIdByLegacyKey = new Map(identityContext.variantIdByLegacyKey);

  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  logs.push(`seed:start set=${setId} rows=${total}`);

  await prisma.setSeedJob.update({
    where: { id: params.jobId },
    data: {
      status: SetSeedJobStatus.IN_PROGRESS,
      startedAt: new Date(),
      progressJson: { processed: 0, total, inserted: 0, updated: 0, failed: 0, skipped: 0 } as Prisma.InputJsonValue,
      logsJson: logs as Prisma.InputJsonValue,
    },
  });

  let cancelled = false;

  for (const row of rows) {
    processed += 1;

    if (processed % 25 === 0) {
      const live = await prisma.setSeedJob.findUnique({
        where: { id: params.jobId },
        select: { status: true },
      });
      if (live?.status === SetSeedJobStatus.CANCELLED) {
        cancelled = true;
        logs.push("seed:cancelled");
        break;
      }
    }

    const blockingErrors = blockingErrorCount(row);
    if (blockingErrors > 0 || !row.parallel) {
      skipped += 1;
      logs.push(`seed:skip index=${row.index} reason=blocking_error_or_missing_parallel`);
      continue;
    }

    try {
      const identity = resolveSetOpsVariantIdentity({
        context: identityContext,
        cardNumber: row.cardNumber,
        parallelId: row.parallel,
      });
      const cardNumber = identity.cardNumber;
      const parallelId = identity.parallelLabel;

      let resolvedVariantId: string | null = null;
      for (const canonicalKey of identity.canonicalKeys) {
        const candidate = variantIdByCanonicalKey.get(canonicalKey);
        if (candidate) {
          resolvedVariantId = candidate;
          break;
        }
      }
      if (!resolvedVariantId) {
        resolvedVariantId = variantIdByLegacyKey.get(identity.legacyFallbackKey) ?? null;
      }
      if (!resolvedVariantId) {
        const existing = await prisma.cardVariant.findUnique({
          where: {
            setId_cardNumber_parallelId: {
              setId,
              cardNumber,
              parallelId,
            },
          },
          select: { id: true },
        });
        resolvedVariantId = existing?.id ?? null;
      }

      if (resolvedVariantId) {
        updated += 1;
      } else {
        const created = await prisma.cardVariant.create({
          data: {
            setId,
            cardNumber,
            parallelId,
            keywords: [],
          },
          select: { id: true },
        });
        resolvedVariantId = created.id;
        inserted += 1;
      }

      if (resolvedVariantId) {
        variantIdByLegacyKey.set(identity.legacyFallbackKey, resolvedVariantId);
        for (const canonicalKey of identity.canonicalKeys) {
          variantIdByCanonicalKey.set(canonicalKey, resolvedVariantId);
        }

        if (identity.preferredCanonicalKey) {
          try {
            const mapRowId = randomUUID();
            await prisma.$executeRawUnsafe(
              `insert into "CardVariantTaxonomyMap" (
                 "id",
                 "cardVariantId",
                 "setId",
                 "programId",
                 "cardNumber",
                 "variationId",
                 "parallelId",
                 "canonicalKey",
                 "createdAt",
                 "updatedAt"
               )
               values (
                 $1,
                 $2,
                 $3,
                 $4,
                 $5,
                 null,
                 $6,
                 $7,
                 now(),
                 now()
               )
               on conflict ("cardVariantId")
               do update set
                 "setId" = excluded."setId",
                 "programId" = excluded."programId",
                 "cardNumber" = excluded."cardNumber",
                 "variationId" = excluded."variationId",
                 "parallelId" = excluded."parallelId",
                 "canonicalKey" = excluded."canonicalKey",
                 "updatedAt" = now()`,
              mapRowId,
              resolvedVariantId,
              setId,
              identity.preferredProgramId,
              cardNumber,
              identity.parallelSlug,
              identity.preferredCanonicalKey
            );
            identityContext.preferredCanonicalKeyByVariantId.set(resolvedVariantId, identity.preferredCanonicalKey);
          } catch (mapError) {
            logs.push(
              `seed:map:warn index=${row.index} message=${
                mapError instanceof Error ? mapError.message : "unknown"
              }`
            );
          }
        }
      }
    } catch (error) {
      failed += 1;
      logs.push(`seed:failed index=${row.index} message=${error instanceof Error ? error.message : "unknown"}`);
    }

    if (processed % 20 === 0 || processed === total) {
      await prisma.setSeedJob.update({
        where: { id: params.jobId },
        data: {
          progressJson: {
            processed,
            total,
            inserted,
            updated,
            failed,
            skipped,
          } as Prisma.InputJsonValue,
          logsJson: logs.slice(-200) as Prisma.InputJsonValue,
        },
      });
    }
  }

  const queueCount = await computeQueueCount(setId);
  const durationMs = Date.now() - startedAt;

  const status = cancelled
    ? SetSeedJobStatus.CANCELLED
    : failed > 0
    ? SetSeedJobStatus.FAILED
    : SetSeedJobStatus.COMPLETE;

  logs.push(`seed:finish status=${status} processed=${processed} inserted=${inserted} updated=${updated} failed=${failed}`);

  await prisma.setSeedJob.update({
    where: { id: params.jobId },
    data: {
      status,
      queueCount,
      completedAt: new Date(),
      progressJson: {
        processed,
        total,
        inserted,
        updated,
        failed,
        skipped,
      } as Prisma.InputJsonValue,
      resultJson: {
        status,
        processed,
        total,
        inserted,
        updated,
        failed,
        skipped,
        queueCount,
        durationMs,
      } as Prisma.InputJsonValue,
      logsJson: logs.slice(-500) as Prisma.InputJsonValue,
      errorMessage: failed > 0 ? `${failed} rows failed during seed run` : null,
    },
  });

  return {
    status,
    processed,
    inserted,
    updated,
    failed,
    skipped,
    queueCount,
    logs,
    durationMs,
  } satisfies SeedExecutionSummary;
}
