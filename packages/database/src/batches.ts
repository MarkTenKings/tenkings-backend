import type { Prisma } from "@prisma/client";
import { BatchStage, PackFulfillmentStatus } from "@prisma/client";

export type DbClient = Prisma.TransactionClient;

interface SetBatchStageOptions {
  batchId: string;
  stage: BatchStage;
  actorId?: string | null;
  note?: string | null;
  force?: boolean;
}

export async function setBatchStage(
  tx: DbClient,
  { batchId, stage, actorId, note, force }: SetBatchStageOptions
) {
  const batch = await tx.cardBatch.findUnique({
    where: { id: batchId },
    select: { stage: true },
  });

  if (!batch) {
    return;
  }

  const shouldWriteEvent = force || batch.stage !== stage || (note && note.trim().length > 0);

  if (!shouldWriteEvent) {
    return;
  }

  await tx.cardBatch.update({
    where: { id: batchId },
    data: {
      stage,
      stageChangedAt: new Date(),
    },
  });

  await tx.batchStageEvent.create({
    data: {
      batchId,
      stage,
      actorId: actorId ?? null,
      note: note?.trim() || null,
    },
  });
}

interface SyncStageOptions {
  tx: DbClient;
  batchId: string;
  actorId?: string | null;
  note?: string | null;
}

export async function syncBatchStageFromPackStatuses({ tx, batchId, actorId, note }: SyncStageOptions) {
  const groups = await tx.packInstance.groupBy({
    by: ["fulfillmentStatus"],
    where: {
      sourceBatchId: batchId,
    },
    _count: { _all: true },
  });

  if (groups.length === 0) {
    await setBatchStage(tx, {
      batchId,
      stage: BatchStage.INVENTORY_READY,
      actorId,
      note,
      force: false,
    });
    return;
  }

  const counts: Record<PackFulfillmentStatus, number> = {
    [PackFulfillmentStatus.ONLINE]: 0,
    [PackFulfillmentStatus.READY_FOR_PACKING]: 0,
    [PackFulfillmentStatus.PACKED]: 0,
    [PackFulfillmentStatus.LOADED]: 0,
  };

  let total = 0;
  for (const group of groups) {
    counts[group.fulfillmentStatus as PackFulfillmentStatus] = group._count._all;
    total += group._count._all;
  }

  const packed = counts[PackFulfillmentStatus.PACKED];
  const loaded = counts[PackFulfillmentStatus.LOADED];
  const ready = counts[PackFulfillmentStatus.READY_FOR_PACKING];
  const online = counts[PackFulfillmentStatus.ONLINE];

  let stage = BatchStage.INVENTORY_READY;

  if (total === 0) {
    stage = BatchStage.INVENTORY_READY;
  } else if (loaded === total) {
    stage = BatchStage.LOADED;
  } else if (packed === total && loaded === 0) {
    stage = BatchStage.PACKED;
  } else if (packed > 0 || loaded > 0) {
    stage = BatchStage.PACKING;
  } else if (ready > 0 || online > 0) {
    stage = BatchStage.INVENTORY_READY;
  }

  await setBatchStage(tx, {
    batchId,
    stage,
    actorId,
    note,
  });
}
