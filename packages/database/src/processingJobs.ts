import { Prisma, PrismaClient, ProcessingJobStatus, ProcessingJobType } from "@prisma/client";
import { prisma } from "./client";

export async function enqueueProcessingJob(options: {
  cardAssetId: string;
  type: ProcessingJobType;
  payload?: Prisma.InputJsonValue;
  client?: PrismaClient | Prisma.TransactionClient;
}) {
  const db = options.client ?? prisma;
  return db.processingJob.create({
    data: {
      cardAssetId: options.cardAssetId,
      type: options.type,
      payload: options.payload,
    },
  });
}

export async function markJobStatus(
  jobId: string,
  status: ProcessingJobStatus,
  errorMessage?: string,
  client?: PrismaClient | Prisma.TransactionClient
) {
  const db = client ?? prisma;
  return db.processingJob.update({
    where: { id: jobId },
    data: {
      status,
      errorMessage: errorMessage ?? null,
      completedAt: status === ProcessingJobStatus.COMPLETE ? new Date() : undefined,
    },
  });
}

const DEFAULT_MAX_WAIT_MS = Number(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS ?? 10000);
const DEFAULT_TIMEOUT_MS = Number(process.env.PRISMA_TRANSACTION_TIMEOUT_MS ?? 60000);

export async function fetchNextQueuedJob(
  types?: ProcessingJobType[],
  options?: { maxWaitMs?: number; timeoutMs?: number }
) {
  const maxWait = options?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return prisma.$transaction(async (tx) => {
    const job = await tx.processingJob.findFirst({
      where: {
        status: ProcessingJobStatus.QUEUED,
        type: types ? { in: types } : undefined,
      },
      orderBy: { createdAt: "asc" },
    });

    if (!job) {
      return null;
    }

    const claimed = await tx.processingJob.updateMany({
      where: {
        id: job.id,
        status: ProcessingJobStatus.QUEUED,
      },
      data: {
        status: ProcessingJobStatus.IN_PROGRESS,
        attempts: { increment: 1 },
        lockedAt: new Date(),
      },
    });

    if (claimed.count === 0) {
      return null;
    }

    return tx.processingJob.findUnique({ where: { id: job.id } });
  }, { maxWait, timeout });
}

export async function resetJob(jobId: string, client?: PrismaClient | Prisma.TransactionClient) {
  const db = client ?? prisma;
  return db.processingJob.update({
    where: { id: jobId },
    data: {
      status: ProcessingJobStatus.QUEUED,
      errorMessage: null,
      lockedAt: null,
      completedAt: null,
    },
  });
}
