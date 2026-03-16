import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { CollectibleCategory, InventoryBatchStage, PackTier } from "@prisma/client";
import { z } from "zod";
import {
  PACK_TIER_PRICE_MINOR,
  buildInventoryBatchLabel,
  buildPackDefinitionName,
} from "../../../../lib/adminInventory";
import { resolvePackConfigurationWithClient } from "../../../../lib/server/packRecipes";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const assignSchema = z.object({
  cardIds: z.array(z.string().min(1)).min(1),
  locationId: z.string().uuid(),
  packCategory: z.nativeEnum(CollectibleCategory),
  packTier: z.nativeEnum(PackTier),
  notes: z.string().trim().max(500).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { cardIds, locationId, packCategory, packTier, notes } = assignSchema.parse(req.body ?? {});

    const payload = await prisma.$transaction(async (tx) => {
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { id: true, name: true },
      });

      if (!location) {
        return { status: 404 as const, body: { message: "Location not found" } };
      }

      const cards = await tx.cardAsset.findMany({
        where: { id: { in: cardIds } },
        select: { id: true, reviewStage: true, inventoryBatchId: true },
      });

      const foundIds = new Set(cards.map((card) => card.id));
      const problemIds = [
        ...cardIds.filter((cardId) => !foundIds.has(cardId)),
        ...cards
          .filter(
            (card) =>
              card.reviewStage !== "INVENTORY_READY_FOR_SALE" || card.inventoryBatchId !== null
          )
          .map((card) => card.id),
      ];

      if (problemIds.length > 0) {
        return {
          status: 409 as const,
          body: {
            message: "One or more cards are missing or already assigned",
            problemIds: [...new Set(problemIds)],
          },
        };
      }

      const packConfiguration = await resolvePackConfigurationWithClient(
        tx,
        location.id,
        packCategory,
        packTier
      );

      let packDefinition = await tx.packDefinition.findFirst({
        where: {
          category: packCategory,
          tier: packTier,
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      if (!packDefinition) {
        packDefinition = await tx.packDefinition.create({
          data: {
            name: buildPackDefinitionName(packCategory, packTier),
            description: `Auto-created inventory assignment definition for ${location.name}`,
            category: packCategory,
            tier: packTier,
            price: PACK_TIER_PRICE_MINOR[packTier],
          },
          select: { id: true },
        });
      }

      const now = new Date();
      const batch = await tx.inventoryBatch.create({
        data: {
          locationId: location.id,
          label: buildInventoryBatchLabel(packCategory, packTier, location.name, now),
          notes: notes?.trim() || null,
          createdById: admin.user.id,
          stage: InventoryBatchStage.ASSIGNED,
          stageChangedAt: now,
          category: packCategory,
          tier: packTier,
        },
        select: {
          id: true,
          label: true,
        },
      });

      const updated = await tx.cardAsset.updateMany({
        where: {
          id: { in: cardIds },
          reviewStage: "INVENTORY_READY_FOR_SALE",
          inventoryBatchId: null,
        },
        data: {
          inventoryBatchId: batch.id,
          inventoryAssignedAt: now,
          assignedDefinitionId: packDefinition.id,
        },
      });

      if (updated.count !== cardIds.length) {
        return {
          status: 409 as const,
          body: {
            message: "One or more cards changed state before assignment completed",
            problemIds: cardIds,
          },
        };
      }

      return {
        status: 200 as const,
        body: {
          batchId: batch.id,
          batchLabel: batch.label,
          cardsAssigned: updated.count,
          locationName: location.name,
          packConfiguration,
        },
      };
    });

    return res.status(payload.status).json(payload.body);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
