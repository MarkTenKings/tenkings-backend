import type { NextApiRequest, NextApiResponse } from "next";
import { CardAssetStatus, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

interface BatchAssignmentSummary {
  packDefinitionId: string;
  name: string;
  category: string;
  tier: string;
  price: number;
  count: number;
}

interface BatchSummary {
  id: string;
  label: string | null;
  status: string;
  totalCount: number;
  processedCount: number;
  createdAt: string;
  updatedAt: string;
  latestAssetAt: string | null;
  assignments: BatchAssignmentSummary[];
}

interface BatchListResponse {
  batches: BatchSummary[];
  nextCursor: string | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<BatchListResponse | { message: string }>) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const takeParam = Number.parseInt(String(req.query.limit ?? "20"), 10);
    const take = Number.isFinite(takeParam) && takeParam > 0 && takeParam <= 100 ? takeParam : 20;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;

    const batches = await prisma.cardBatch.findMany({
      where: { uploadedById: admin.user.id },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      include: {
        cards: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    const nextCursor = batches.length > take ? batches[take].id : null;
    const sliced = batches.slice(0, take);

    const readyCounts = await Promise.all(
      sliced.map((batch) =>
        prisma.cardAsset.count({ where: { batchId: batch.id, status: CardAssetStatus.READY } })
      )
    );

    const batchIds = sliced.map((batch) => batch.id);

    const assignmentGroups = batchIds.length
      ? await prisma.cardAsset.groupBy({
          by: ["batchId", "assignedDefinitionId"],
          where: {
            batchId: { in: batchIds },
            assignedDefinitionId: { not: null },
          },
          _count: { _all: true },
        })
      : [];

    const definitionIds = Array.from(
      new Set(
        assignmentGroups
          .map((group) => group.assignedDefinitionId)
          .filter((value): value is string => Boolean(value))
      )
    );

    const definitions = definitionIds.length
      ? await prisma.packDefinition.findMany({
          where: { id: { in: definitionIds } },
          select: { id: true, name: true, category: true, tier: true, price: true },
        })
      : [];

    const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));

    const assignmentsByBatch = new Map<string, BatchAssignmentSummary[]>();
    const assignedCountByBatch = new Map<string, number>();

    assignmentGroups.forEach((group) => {
      if (!group.assignedDefinitionId) {
        return;
      }
      const definition = definitionMap.get(group.assignedDefinitionId);
      if (!definition) {
        return;
      }

      const summary: BatchAssignmentSummary = {
        packDefinitionId: definition.id,
        name: definition.name,
        category: definition.category,
        tier: definition.tier,
        price: definition.price,
        count: group._count._all,
      };

      const existing = assignmentsByBatch.get(group.batchId) ?? [];
      existing.push(summary);
      assignmentsByBatch.set(group.batchId, existing);

      assignedCountByBatch.set(
        group.batchId,
        (assignedCountByBatch.get(group.batchId) ?? 0) + group._count._all
      );
    });

    const payload: BatchSummary[] = sliced.map((batch, index) => {
      const ready = readyCounts[index];
      const assigned = assignedCountByBatch.get(batch.id) ?? 0;

      let derivedStatus = "UPLOADING";
      if (assigned > 0) {
        derivedStatus = "ASSIGNED";
      } else if (ready >= batch.totalCount && batch.totalCount > 0) {
        derivedStatus = "READY";
      } else if (ready > 0) {
        derivedStatus = "PROCESSING";
      }

      return {
        id: batch.id,
        label: batch.label,
        status: derivedStatus,
        totalCount: batch.totalCount,
        processedCount: assigned > 0 ? assigned : ready,
        createdAt: batch.createdAt.toISOString(),
        updatedAt: batch.updatedAt.toISOString(),
        latestAssetAt: batch.cards[0]?.createdAt?.toISOString() ?? null,
        assignments: assignmentsByBatch.get(batch.id)?.sort((a, b) => b.count - a.count) ?? [],
      };
    });

    return res.status(200).json({ batches: payload, nextCursor });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
