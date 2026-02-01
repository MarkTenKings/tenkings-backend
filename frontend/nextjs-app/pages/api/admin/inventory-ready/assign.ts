import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const assignSchema = z.object({
  cardIds: z.array(z.string().min(1)).min(1),
  locationId: z.string().uuid(),
  label: z.string().trim().min(1).optional().nullable(),
});

type ResponseBody =
  | {
      batchId: string;
      updatedCount: number;
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { cardIds, locationId, label } = assignSchema.parse(req.body ?? {});

    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true },
    });

    if (!location) {
      return res.status(404).json({ message: "Location not found" });
    }

    const cards = await prisma.cardAsset.findMany({
      where: { id: { in: cardIds } },
      select: { id: true, reviewStage: true },
    });

    if (cards.length !== cardIds.length) {
      return res.status(404).json({ message: "One or more cards not found" });
    }

    const invalidStage = cards.find((card) => card.reviewStage !== "INVENTORY_READY_FOR_SALE");
    if (invalidStage) {
      return res.status(409).json({ message: "One or more cards are not in Inventory Ready stage" });
    }

    const now = new Date();
    const batch = await prisma.inventoryBatch.create({
      data: {
        locationId: locationId,
        label: label ?? null,
        createdById: admin.user.id,
      },
      select: { id: true },
    });

    const updated = await prisma.cardAsset.updateMany({
      where: { id: { in: cardIds } },
      data: {
        inventoryBatchId: batch.id,
        inventoryAssignedAt: now,
      },
    });

    return res.status(200).json({ batchId: batch.id, updatedCount: updated.count });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
