import type { NextApiRequest, NextApiResponse } from "next";
import {
  prisma,
  PackFulfillmentStatus,
  BatchStage,
} from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type PackCounts = {
  total: number;
  ready: number;
  packed: number;
  loaded: number;
};

type LocationCounts = PackCounts;

interface StageBatchSummary {
  id: string;
  label: string | null;
  stage: BatchStage;
  notes: string | null;
  tags: string[];
  stageChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: PackCounts;
  locations: Array<{
    id: string | null;
    name: string;
    counts: LocationCounts;
  }>;
  latestEvents: Array<{
    id: string;
    stage: BatchStage;
    createdAt: string;
    note: string | null;
    actor: { id: string; label: string } | null;
  }>;
}

interface StageColumnSummary {
  id: BatchStage;
  label: string;
  description: string;
  totals: {
    batches: number;
    packs: number;
  };
  batches: StageBatchSummary[];
}

interface TimelineEvent {
  id: string;
  batchId: string;
  batchLabel: string | null;
  stage: BatchStage;
  createdAt: string;
  note: string | null;
  actor: { id: string; label: string } | null;
}

const emptyPackCounts = (): PackCounts => ({ total: 0, ready: 0, packed: 0, loaded: 0 });

const stageMeta: Record<BatchStage, { label: string; description: string }> = {
  [BatchStage.INVENTORY_READY]: {
    label: "Inventory Ready",
    description: "Packs minted and waiting to be labeled or handed to packing ops.",
  },
  [BatchStage.PACKING]: {
    label: "Packing",
    description: "Packing team is binding cards, applying labels, or sealing packs.",
  },
  [BatchStage.PACKED]: {
    label: "Packed",
    description: "Packs sealed and awaiting shipping or kiosk delivery.",
  },
  [BatchStage.SHIPPING_READY]: {
    label: "Shipping Ready",
    description: "Batches queued for outbound shipment to field operators.",
  },
  [BatchStage.SHIPPING_SHIPPED]: {
    label: "Shipped",
    description: "In transit to the venue or operator.",
  },
  [BatchStage.SHIPPING_RECEIVED]: {
    label: "Received",
    description: "Operator confirmed the shipment arrived on site.",
  },
  [BatchStage.LOADED]: {
    label: "Loaded",
    description: "Inventory confirmed inside kiosk with counts and photo proof.",
  },
};

const stageOrder: BatchStage[] = [
  BatchStage.INVENTORY_READY,
  BatchStage.PACKING,
  BatchStage.PACKED,
  BatchStage.SHIPPING_READY,
  BatchStage.SHIPPING_SHIPPED,
  BatchStage.SHIPPING_RECEIVED,
  BatchStage.LOADED,
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const packGroups = await prisma.packInstance.groupBy({
      by: ["sourceBatchId", "fulfillmentStatus", "locationId"],
      where: {
        sourceBatchId: {
          not: null,
        },
      },
      _count: { _all: true },
    });

    const batchIds = Array.from(
      new Set(
        packGroups
          .map((group) => group.sourceBatchId)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );

    if (batchIds.length === 0) {
      const emptyStages: StageColumnSummary[] = stageOrder.map((stage) => ({
        id: stage,
        label: stageMeta[stage].label,
        description: stageMeta[stage].description,
        totals: { batches: 0, packs: 0 },
        batches: [],
      }));

      return res.status(200).json({
        stages: emptyStages,
        stageOrder,
        timeline: [] as TimelineEvent[],
      });
    }

    const locationIds = Array.from(
      new Set(
        packGroups
          .map((group) => group.locationId)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );

    const locationRecords = await prisma.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true, name: true },
    });

    const locationNameMap = new Map<string, string>();
    locationRecords.forEach((location) => {
      locationNameMap.set(location.id, location.name);
    });

    const batchCounts = new Map<
      string,
      {
        totals: PackCounts;
        locations: Map<string | null, PackCounts>;
      }
    >();

    for (const group of packGroups) {
      const batchId = group.sourceBatchId as string;
      if (!batchCounts.has(batchId)) {
        batchCounts.set(batchId, {
          totals: emptyPackCounts(),
          locations: new Map<string | null, PackCounts>(),
        });
      }
      const entry = batchCounts.get(batchId)!;
      const totals = entry.totals;
      totals.total += group._count._all;

      const status = group.fulfillmentStatus as PackFulfillmentStatus;
      if (status === PackFulfillmentStatus.READY_FOR_PACKING) {
        totals.ready += group._count._all;
      } else if (status === PackFulfillmentStatus.PACKED) {
        totals.packed += group._count._all;
      } else if (status === PackFulfillmentStatus.LOADED) {
        totals.loaded += group._count._all;
      }

      const locKey = group.locationId ?? null;
      if (!entry.locations.has(locKey)) {
        entry.locations.set(locKey, emptyPackCounts());
      }
      const locCounts = entry.locations.get(locKey)!;
      locCounts.total += group._count._all;
      if (status === PackFulfillmentStatus.READY_FOR_PACKING) {
        locCounts.ready += group._count._all;
      } else if (status === PackFulfillmentStatus.PACKED) {
        locCounts.packed += group._count._all;
      } else if (status === PackFulfillmentStatus.LOADED) {
        locCounts.loaded += group._count._all;
      }
    }

    const batches = await prisma.cardBatch.findMany({
      where: { id: { in: batchIds } },
      select: {
        id: true,
        label: true,
        notes: true,
        stage: true,
        tags: true,
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

    const timeline: TimelineEvent[] = [];

    const columnMap = new Map<BatchStage, StageColumnSummary>(
      stageOrder.map((stage) => [
        stage,
        {
          id: stage,
          label: stageMeta[stage].label,
          description: stageMeta[stage].description,
          totals: { batches: 0, packs: 0 },
          batches: [],
        },
      ])
    );

    for (const batch of batches) {
      const counts = batchCounts.get(batch.id) ?? {
        totals: emptyPackCounts(),
        locations: new Map<string | null, PackCounts>(),
      };

      const locationSummaries = Array.from(counts.locations.entries()).map(([locId, locCounts]) => {
        const name = locId ? locationNameMap.get(locId) ?? "Assigned Location" : "Unassigned";
        return {
          id: locId,
          name,
          counts: locCounts,
        };
      });

      locationSummaries.sort((a, b) => {
        if (a.id === b.id) {
          return 0;
        }
        if (a.id === null) {
          return 1;
        }
        if (b.id === null) {
          return -1;
        }
        return a.name.localeCompare(b.name);
      });

      const latestEvents = batch.stageEvents.map((event) => {
        timeline.push({
          id: event.id,
          batchId: batch.id,
          batchLabel: batch.label,
          stage: event.stage,
          createdAt: event.createdAt.toISOString(),
          note: event.note,
          actor: event.actor
            ? {
                id: event.actor.id,
                label: event.actor.displayName ?? event.actor.phone ?? event.actor.email ?? event.actor.id,
              }
            : null,
        });

        return {
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
        };
      });

      const summary: StageBatchSummary = {
        id: batch.id,
        label: batch.label,
        stage: batch.stage,
        notes: batch.notes,
        tags: batch.tags,
        stageChangedAt: batch.stageChangedAt ? batch.stageChangedAt.toISOString() : null,
        createdAt: batch.createdAt.toISOString(),
        updatedAt: batch.updatedAt.toISOString(),
        counts: counts.totals,
        locations: locationSummaries,
        latestEvents,
      };

      const column = columnMap.get(batch.stage) ?? columnMap.get(BatchStage.INVENTORY_READY)!;
      column.batches.push(summary);
      column.totals.batches += 1;
      column.totals.packs += counts.totals.total;
    }

    const stages = stageOrder.map((stage) => {
      const column = columnMap.get(stage)!;
      column.batches.sort((a, b) => {
        const timeA = a.stageChangedAt ?? a.updatedAt;
        const timeB = b.stageChangedAt ?? b.updatedAt;
        return timeB.localeCompare(timeA);
      });
      return column;
    });

    timeline.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return res.status(200).json({
      stageOrder,
      stages,
      timeline,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
