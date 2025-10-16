
import type { NextApiRequest, NextApiResponse } from "next";
import { CardAssetStatus, prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type AssignResponse = {
  updated: Array<{
    id: string;
    status: string;
    assignedDefinitionId: string | null;
    assignedAt: string | null;
  }>;
};

const assignSchema = z.object({
  cardIds: z
    .array(z.string().min(1))
    .min(1, { message: "At least one card id is required" }),
  packDefinitionId: z.string().min(1),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AssignResponse | { message: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { cardIds, packDefinitionId } = assignSchema.parse(req.body ?? {});

    const ownedCards = await prisma.cardAsset.findMany({
      where: {
        id: { in: cardIds },
        batch: { uploadedById: admin.user.id },
      },
      select: { id: true, batchId: true },
    });

    if (ownedCards.length !== cardIds.length) {
      return res.status(404).json({ message: "One or more cards not found" });
    }

    const now = new Date();

    await prisma.cardAsset.updateMany({
      where: { id: { in: cardIds } },
      data: {
        assignedDefinitionId: packDefinitionId,
        assignedAt: now,
        status: CardAssetStatus.ASSIGNED,
      },
    });

    const batchIds = Array.from(new Set(ownedCards.map((card) => card.batchId)));

    if (batchIds.length > 0) {
      const assignedCounts = await prisma.cardAsset.groupBy({
        by: ["batchId"],
        where: {
          batchId: { in: batchIds },
          status: CardAssetStatus.ASSIGNED,
        },
        _count: { _all: true },
      });

      const assignedMap = new Map(
        assignedCounts.map((entry) => [entry.batchId, entry._count._all])
      );

      await Promise.all(
        batchIds.map((batchId) =>
          prisma.cardBatch.update({
            where: { id: batchId },
            data: {
              processedCount: assignedMap.get(batchId) ?? 0,
              status: assignedMap.get(batchId) ? "ASSIGNED" : undefined,
            },
          })
        )
      );
    }

    const updated = await prisma.cardAsset.findMany({
      where: { id: { in: cardIds } },
      select: {
        id: true,
        status: true,
        assignedDefinitionId: true,
        assignedAt: true,
      },
    });

    return res.status(200).json({
      updated: updated.map((card) => ({
        id: card.id,
        status: card.status,
        assignedDefinitionId: card.assignedDefinitionId ?? null,
        assignedAt: card.assignedAt ? card.assignedAt.toISOString() : null,
      })),
    });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
