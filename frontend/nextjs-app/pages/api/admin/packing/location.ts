import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, PackFulfillmentStatus, BatchStage, QrCodeState, type Prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { reserveLabelsForPacks, syncPackAssetsLocation } from "../../../../lib/server/qrCodes";

const ONLINE_OPTION = "ONLINE";

const querySchema = z.object({
  locationId: z.string().min(1),
  batchId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  batchId: z.string().uuid(),
  locationId: z.union([z.string().uuid(), z.literal(ONLINE_OPTION)]).nullable().optional(),
});

type PackRow = {
  id: string;
  createdAt: string;
  fulfillmentStatus: PackFulfillmentStatus;
  packQrCodeId: string | null;
  packDefinition: {
    id: string;
    name: string;
    tier: string;
  } | null;
  item: {
    id: string;
    name: string | null;
    imageUrl: string | null;
    cardQrCodeId: string | null;
  } | null;
  label: {
    id: string;
    status: string;
    pairId: string;
    card: {
      id: string;
      code: string;
      serial: string | null;
      payloadUrl: string | null;
      state: QrCodeState;
    };
    pack: {
      id: string;
      code: string;
      serial: string | null;
      payloadUrl: string | null;
      state: QrCodeState;
    };
  } | null;
};

type BatchDetail = {
  id: string;
  label: string | null;
  notes: string | null;
  tags: string[];
  stage: BatchStage;
  stageChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    total: number;
    ready: number;
    packed: number;
    loaded: number;
  };
  latestEvents: Array<{
    id: string;
    stage: BatchStage;
    createdAt: string;
    note: string | null;
    actor: { id: string; label: string } | null;
  }>;
  packs: PackRow[];
};

type ResponseBody = { batches: BatchDetail[] } | { message: string } | { updated: number };

const toQrSummary = (
  record: Prisma.QrCodeGetPayload<{ select: { id: true; code: true; serial: true; payloadUrl: true; state: true } }>
) => ({
  id: record.id,
  code: record.code,
  serial: record.serial,
  payloadUrl: record.payloadUrl,
  state: record.state,
});

const packStatusFilter = [
  PackFulfillmentStatus.READY_FOR_PACKING,
  PackFulfillmentStatus.PACKED,
  PackFulfillmentStatus.LOADED,
];

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method === "POST") {
    try {
      const admin = await requireAdminSession(req);
      const { batchId, locationId } = updateSchema.parse(req.body ?? {});

      const targetLocationId = !locationId || locationId === ONLINE_OPTION ? null : locationId;

      if (targetLocationId) {
        const location = await prisma.location.findUnique({ where: { id: targetLocationId }, select: { id: true } });
        if (!location) {
          return res.status(404).json({ message: "Location not found" });
        }
      }

      const packs = await prisma.packInstance.findMany({
        where: {
          sourceBatchId: batchId,
          fulfillmentStatus: { in: packStatusFilter },
        },
        select: {
          id: true,
          sourceBatchId: true,
          packLabels: {
            include: {
              cardQrCode: {
                select: { id: true, code: true, serial: true, payloadUrl: true, state: true },
              },
              packQrCode: {
                select: { id: true, code: true, serial: true, payloadUrl: true, state: true },
              },
            },
          },
          slots: {
            take: 1,
            select: {
              item: {
                select: { id: true },
              },
            },
          },
        },
      });

      const assignments = packs
        .filter((pack) => pack.slots[0]?.item)
        .map((pack) => ({
          packInstanceId: pack.id,
          itemId: pack.slots[0]!.item!.id,
          cardAssetId: pack.slots[0]!.item!.id,
          batchId,
          locationId: targetLocationId,
        }));

      if (assignments.length === 0) {
        return res.status(200).json({ updated: 0 });
      }

      await reserveLabelsForPacks({
        assignments,
        createdById: admin.user.id,
        autoBind: targetLocationId !== null,
        forceUnbind: targetLocationId === null,
      });

      await prisma.$transaction(async (tx) => {
        for (const pack of packs) {
          const label = pack.packLabels[0] ?? null;
          await syncPackAssetsLocation(tx, {
            packInstanceId: pack.id,
            packLabelId: label?.id ?? null,
            cardQrCodeId: label?.cardQrCode.id ?? null,
            packQrCodeId: pack.packQrCodeId,
            locationId: targetLocationId,
          });
        }
      });

      return res.status(200).json({ updated: assignments.length });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { locationId, batchId } = querySchema.parse(req.query);

    if (locationId !== ONLINE_OPTION) {
      const location = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } });
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
    }

    const packsForLocation = async () =>
      prisma.packInstance.findMany({
        where: {
          sourceBatchId: { not: null },
          fulfillmentStatus: { in: packStatusFilter },
          ...(locationId === ONLINE_OPTION
            ? { locationId: null }
            : { locationId }),
          ...(batchId ? { sourceBatchId: batchId } : {}),
        },
        orderBy: [{ sourceBatchId: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          createdAt: true,
          fulfillmentStatus: true,
          packDefinition: {
            select: { id: true, name: true, tier: true },
          },
          sourceBatchId: true,
          packQrCodeId: true,
          packLabels: {
            include: {
              cardQrCode: {
                select: { id: true, code: true, serial: true, payloadUrl: true, state: true },
              },
              packQrCode: {
                select: { id: true, code: true, serial: true, payloadUrl: true, state: true },
              },
            },
          },
          slots: {
            take: 1,
            select: {
              item: {
                select: {
                  id: true,
                  name: true,
                  imageUrl: true,
                  cardQrCodeId: true,
                },
              },
            },
          },
        },
      });

    let packs = await packsForLocation();

    const assignments = packs
      .filter((pack) => pack.slots[0]?.item)
      .filter((pack) => {
        const slotItem = pack.slots[0]?.item;
        if (!slotItem) {
          return false;
        }
        const labelRecord = pack.packLabels[0] ?? null;
        if (!labelRecord) {
          return true;
        }
        const cardBound =
          !!slotItem.cardQrCodeId &&
          slotItem.cardQrCodeId === labelRecord.cardQrCode.id &&
          labelRecord.cardQrCode.state === QrCodeState.BOUND;
        const packBound =
          !!pack.packQrCodeId && pack.packQrCodeId === labelRecord.packQrCode.id && labelRecord.packQrCode.state === QrCodeState.BOUND;
        return !cardBound || !packBound;
      })
      .map((pack) => ({
        packInstanceId: pack.id,
        itemId: pack.slots[0]!.item!.id,
        cardAssetId: pack.slots[0]!.item!.id,
        batchId: pack.sourceBatchId,
        locationId: locationId === ONLINE_OPTION ? null : locationId,
      }));

    if (assignments.length > 0) {
      await reserveLabelsForPacks({
        assignments,
        createdById: admin.user.id,
        autoBind: locationId !== ONLINE_OPTION,
      });
      packs = await packsForLocation();
    }

    const batchIds = Array.from(
      new Set(
        packs
          .map((pack) => pack.sourceBatchId)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );

    if (batchIds.length === 0) {
      return res.status(200).json({ batches: [] });
    }

    const batchRecords = await prisma.cardBatch.findMany({
      where: {
        id: { in: batchIds },
        ...(batchId ? { id: batchId } : {}),
      },
      select: {
        id: true,
        label: true,
        notes: true,
        tags: true,
        stage: true,
        stageChangedAt: true,
        createdAt: true,
        updatedAt: true,
        stageEvents: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            stage: true,
            note: true,
            createdAt: true,
            actor: {
              select: {
                id: true,
                displayName: true,
                phone: true,
                email: true,
              },
            },
          },
        },
      },
    });

    const batchMap = new Map<string, BatchDetail>();

    batchRecords.forEach((batch) => {
      batchMap.set(batch.id, {
        id: batch.id,
        label: batch.label,
        notes: batch.notes,
        tags: batch.tags,
        stage: batch.stage,
        stageChangedAt: batch.stageChangedAt ? batch.stageChangedAt.toISOString() : null,
        createdAt: batch.createdAt.toISOString(),
        updatedAt: batch.updatedAt.toISOString(),
        counts: { total: 0, ready: 0, packed: 0, loaded: 0 },
        latestEvents: batch.stageEvents.map((event) => ({
          id: event.id,
          stage: event.stage,
          createdAt: event.createdAt.toISOString(),
          note: event.note,
          actor: event.actor
            ? {
                id: event.actor.id,
                label: event.actor.displayName ?? event.actor.phone ?? event.actor.email ?? event.actor.id,
              }
            : null,
        })),
        packs: [],
      });
    });

    for (const pack of packs) {
      const batchId = pack.sourceBatchId;
      if (!batchId) {
        continue;
      }
      const container = batchMap.get(batchId);
      if (!container) {
        continue;
      }

      const counts = container.counts;
      counts.total += 1;
      if (pack.fulfillmentStatus === PackFulfillmentStatus.READY_FOR_PACKING) {
        counts.ready += 1;
      } else if (pack.fulfillmentStatus === PackFulfillmentStatus.PACKED) {
        counts.packed += 1;
      } else if (pack.fulfillmentStatus === PackFulfillmentStatus.LOADED) {
        counts.loaded += 1;
      }

      const slotItem = pack.slots[0]?.item ?? null;
      const labelRecord = pack.packLabels[0] ?? null;

      const row: PackRow = {
        id: pack.id,
        createdAt: pack.createdAt.toISOString(),
        fulfillmentStatus: pack.fulfillmentStatus,
        packQrCodeId: pack.packQrCodeId,
        packDefinition: pack.packDefinition
          ? {
              id: pack.packDefinition.id,
              name: pack.packDefinition.name,
              tier: pack.packDefinition.tier,
            }
          : null,
        item: slotItem
          ? {
              id: slotItem.id,
              name: slotItem.name,
              imageUrl: slotItem.imageUrl,
              cardQrCodeId: slotItem.cardQrCodeId,
            }
          : null,
        label: labelRecord
          ? {
              id: labelRecord.id,
              status: labelRecord.status,
              pairId: labelRecord.pairId,
              card: toQrSummary(labelRecord.cardQrCode),
              pack: toQrSummary(labelRecord.packQrCode),
            }
          : null,
      };

      container.packs.push(row);
    }

    const batches = Array.from(batchMap.values())
      .map((batch) => ({
        ...batch,
        packs: batch.packs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      }))
      .sort((a, b) => {
        const timeA = a.stageChangedAt ?? a.updatedAt;
        const timeB = b.stageChangedAt ?? b.updatedAt;
        if (timeA === timeB) {
          return (a.label ?? a.id).localeCompare(b.label ?? b.id);
        }
        return timeB.localeCompare(timeA);
      });

    return res.status(200).json({ batches });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
