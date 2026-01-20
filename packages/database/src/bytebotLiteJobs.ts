import { Prisma, PrismaClient, BytebotLiteJobStatus } from "@prisma/client";
import { prisma } from "./client";

export async function enqueueBytebotLiteJob(options: {
  searchQuery: string;
  sources: string[];
  cardAssetId?: string;
  maxComps?: number;
  maxAgeDays?: number;
  payload?: Prisma.InputJsonValue;
  client?: PrismaClient | Prisma.TransactionClient;
}) {
  const db = options.client ?? prisma;
  return db.bytebotLiteJob.create({
    data: {
      searchQuery: options.searchQuery,
      sources: options.sources,
      cardAssetId: options.cardAssetId,
      maxComps: options.maxComps ?? 5,
      maxAgeDays: options.maxAgeDays ?? 730,
      payload: options.payload,
    },
  });
}

export async function markBytebotLiteJobStatus(
  jobId: string,
  status: BytebotLiteJobStatus,
  errorMessage?: string,
  result?: Prisma.InputJsonValue,
  client?: PrismaClient | Prisma.TransactionClient
) {
  const db = client ?? prisma;
  return db.bytebotLiteJob.update({
    where: { id: jobId },
    data: {
      status,
      errorMessage: errorMessage ?? null,
      result: result ?? undefined,
      completedAt: status === BytebotLiteJobStatus.COMPLETE ? new Date() : undefined,
    },
  });
}

const DEFAULT_MAX_WAIT_MS = Number(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS ?? 10000);
const DEFAULT_TIMEOUT_MS = Number(process.env.PRISMA_TRANSACTION_TIMEOUT_MS ?? 60000);

export async function fetchNextQueuedBytebotLiteJob(options?: {
  maxWaitMs?: number;
  timeoutMs?: number;
}) {
  const maxWait = options?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return prisma.$transaction(async (tx) => {
    const job = await tx.bytebotLiteJob.findFirst({
      where: { status: BytebotLiteJobStatus.QUEUED },
      orderBy: { createdAt: "asc" },
    });

    if (!job) {
      return null;
    }

    const claimed = await tx.bytebotLiteJob.updateMany({
      where: {
        id: job.id,
        status: BytebotLiteJobStatus.QUEUED,
      },
      data: {
        status: BytebotLiteJobStatus.IN_PROGRESS,
        attempts: { increment: 1 },
        lockedAt: new Date(),
      },
    });

    if (claimed.count === 0) {
      return null;
    }

    return tx.bytebotLiteJob.findUnique({ where: { id: job.id } });
  }, { maxWait, timeout });
}

export async function resetBytebotLiteJob(
  jobId: string,
  client?: PrismaClient | Prisma.TransactionClient
) {
  const db = client ?? prisma;
  return db.bytebotLiteJob.update({
    where: { id: jobId },
    data: {
      status: BytebotLiteJobStatus.QUEUED,
      errorMessage: null,
      lockedAt: null,
      completedAt: null,
      result: Prisma.DbNull,
    },
  });
}
