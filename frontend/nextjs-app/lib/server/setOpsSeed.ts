import { prisma, SetSeedJobStatus } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { extractDraftRows } from "./setOpsDrafts";

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
  const variants = await prisma.cardVariant.findMany({
    where: { setId },
    select: { cardNumber: true, parallelId: true },
  });

  const grouped = await prisma.cardVariantReferenceImage.groupBy({
    by: ["cardNumber", "parallelId"],
    where: { setId },
    _count: { _all: true },
  });

  const refCounts = new Map<string, number>();
  for (const row of grouped) {
    const card = row.cardNumber ?? "ALL";
    refCounts.set(`${card}::${row.parallelId}`, row._count._all);
  }

  let queueCount = 0;
  for (const variant of variants) {
    const count = refCounts.get(`${variant.cardNumber}::${variant.parallelId}`) ?? 0;
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
      progressJson: { processed: 0, total, inserted: 0, updated: 0, failed: 0, skipped: 0 },
      logsJson: logs,
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
      const cardNumber = row.cardNumber ?? "ALL";
      const existing = await prisma.cardVariant.findUnique({
        where: {
          setId_cardNumber_parallelId: {
            setId,
            cardNumber,
            parallelId: row.parallel,
          },
        },
        select: { id: true },
      });

      if (existing) {
        updated += 1;
      } else {
        await prisma.cardVariant.create({
          data: {
            setId,
            cardNumber,
            parallelId: row.parallel,
            keywords: [],
          },
        });
        inserted += 1;
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
          },
          logsJson: logs.slice(-200),
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
      },
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
      },
      logsJson: logs.slice(-500),
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
