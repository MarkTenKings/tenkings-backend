import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { deleteInventoryArtifactsForCardIds } from "../../../../lib/server/inventoryReadyPurge";

const TARGET_STAGE = "INVENTORY_READY_FOR_SALE";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const requestedIds = Array.isArray(req.body?.cardIds) ? req.body.cardIds.filter(Boolean) : [];
    if (requestedIds.length === 0) {
      return res.status(400).json({ message: "cardIds is required" });
    }

    const cards = await prisma.cardAsset.findMany({
      where: { id: { in: requestedIds }, reviewStage: TARGET_STAGE },
      select: { id: true },
    });
    const cardIds = cards.map((card) => card.id);
    if (cardIds.length === 0) {
      return res.status(200).json({ deleted: 0 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.bytebotLiteJob.deleteMany({ where: { cardAssetId: { in: cardIds } } });
      await tx.cardEvidenceItem.deleteMany({ where: { cardAssetId: { in: cardIds } } });
      await tx.cardPhoto.deleteMany({ where: { cardAssetId: { in: cardIds } } });
      await tx.cardNote.deleteMany({ where: { cardId: { in: cardIds } } });
      await tx.processingJob.deleteMany({ where: { cardAssetId: { in: cardIds } } });
      await deleteInventoryArtifactsForCardIds(tx, cardIds);
      await tx.cardAsset.deleteMany({ where: { id: { in: cardIds } } });
    });

    return res.status(200).json({ deleted: cardIds.length });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
