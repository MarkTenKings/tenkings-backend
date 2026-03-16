import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const returnSchema = z.object({
  cardIds: z.array(z.string().min(1)).min(1),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const { cardIds } = returnSchema.parse(req.body ?? {});

    const cards = await prisma.cardAsset.findMany({
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
      return res.status(409).json({
        message: "One or more cards can no longer be returned to review",
        problemIds: [...new Set(problemIds)],
      });
    }

    const result = await prisma.cardAsset.updateMany({
      where: {
        id: { in: cardIds },
        reviewStage: "INVENTORY_READY_FOR_SALE",
        inventoryBatchId: null,
      },
      data: {
        inventoryBatchId: null,
        inventoryAssignedAt: null,
        assignedDefinitionId: null,
        reviewStage: "READY_FOR_HUMAN_REVIEW",
        reviewStageUpdatedAt: new Date(),
      },
    });

    return res.status(200).json({ returnedCount: result.count });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
