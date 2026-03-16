import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

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
    const locationId = typeof req.query.locationId === "string" ? req.query.locationId : null;
    if (!locationId) {
      return res.status(400).json({ message: "locationId is required" });
    }

    const { cardIds } = returnSchema.parse(req.body ?? {});
    const cards = await prisma.cardAsset.findMany({
      where: {
        id: { in: cardIds },
        inventoryBatch: {
          locationId,
        },
      },
      select: { id: true },
    });

    if (cards.length !== cardIds.length) {
      return res.status(409).json({ message: "One or more cards are not assigned to this location" });
    }

    const result = await prisma.cardAsset.updateMany({
      where: {
        id: { in: cardIds },
        inventoryBatch: {
          locationId,
        },
      },
      data: {
        inventoryBatchId: null,
        inventoryAssignedAt: null,
        assignedDefinitionId: null,
        reviewStage: "INVENTORY_READY_FOR_SALE",
      },
    });

    return res.status(200).json({ returnedCount: result.count });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
