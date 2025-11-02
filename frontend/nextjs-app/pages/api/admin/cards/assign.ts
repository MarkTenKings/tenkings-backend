
import type { NextApiRequest, NextApiResponse } from "next";
import { CardAssetStatus, mintAssignedCardAssets, prisma, type MintResult } from "@tenkings/database";
import { reserveLabelsForPacks } from "../../../../lib/server/qrCodes";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type AssignResponse = {
  updated: Array<{
    id: string;
    status: string;
    assignedDefinitionId: string | null;
    assignedAt: string | null;
  }>;
  mint?: MintResult;
};

const assignSchema = z.object({
  cardIds: z
    .array(z.string().min(1))
    .min(1, { message: "At least one card id is required" }),
  packDefinitionId: z.string().min(1),
  locationId: z.string().min(1).optional().nullable(),
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
    const { cardIds, packDefinitionId, locationId } = assignSchema.parse(req.body ?? {});

    let location: { id: string } | null = null;
    if (locationId) {
      location = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } });
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
    }

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

    const mintResult = await mintAssignedCardAssets({
      packDefinitionId,
      cardIds,
      prismaClient: prisma,
      locationId: location?.id ?? null,
      createdById: admin.user.id,
    });

    if (mintResult.packAssignments.length > 0) {
      await reserveLabelsForPacks({
        assignments: mintResult.packAssignments.map((assignment) => ({
          packInstanceId: assignment.packInstanceId,
          itemId: assignment.itemId,
          cardAssetId: assignment.cardAssetId,
          batchId: assignment.batchId,
          locationId: assignment.locationId,
        })),
        createdById: admin.user.id,
      });
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
      mint: mintResult,
    });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
