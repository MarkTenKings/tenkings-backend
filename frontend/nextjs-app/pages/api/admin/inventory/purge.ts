import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { deleteInventoryArtifactsForCardIds } from "../../../../lib/server/inventoryReadyPurge";

const purgeSchema = z.object({
  cardIds: z.array(z.string().min(1)).min(1),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const { cardIds } = purgeSchema.parse(req.body ?? {});

    const cards = await prisma.cardAsset.findMany({
      where: {
        id: { in: cardIds },
        reviewStage: "INVENTORY_READY_FOR_SALE",
        inventoryBatchId: null,
      },
      select: { id: true },
    });

    const deletableIds = cards.map((card) => card.id);
    if (deletableIds.length === 0) {
      return res.status(200).json({ deleted: 0 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.bytebotLiteJob.deleteMany({ where: { cardAssetId: { in: deletableIds } } });
      await tx.cardEvidenceItem.deleteMany({ where: { cardAssetId: { in: deletableIds } } });
      await tx.cardPhoto.deleteMany({ where: { cardAssetId: { in: deletableIds } } });
      await tx.cardNote.deleteMany({ where: { cardId: { in: deletableIds } } });
      await tx.processingJob.deleteMany({ where: { cardAssetId: { in: deletableIds } } });
      await deleteInventoryArtifactsForCardIds(tx, deletableIds);
      await tx.cardAsset.deleteMany({ where: { id: { in: deletableIds } } });
    });

    return res.status(200).json({ deleted: deletableIds.length });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
