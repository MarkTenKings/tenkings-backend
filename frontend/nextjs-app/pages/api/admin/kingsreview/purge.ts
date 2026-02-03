import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const TARGET_STAGES = ["BYTEBOT_RUNNING", "READY_FOR_HUMAN_REVIEW", "ESCALATED_REVIEW", "REVIEW_COMPLETE"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const cards = await prisma.cardAsset.findMany({
      where: { reviewStage: { in: TARGET_STAGES as any } },
      select: { id: true },
    });
    const cardIds = cards.map((card) => card.id);
    if (cardIds.length === 0) {
      return res.status(200).json({ deleted: 0 });
    }

    await prisma.$transaction([
      prisma.bytebotLiteJob.deleteMany({ where: { cardAssetId: { in: cardIds } } }),
      prisma.cardEvidenceItem.deleteMany({ where: { cardAssetId: { in: cardIds } } }),
      prisma.cardPhoto.deleteMany({ where: { cardAssetId: { in: cardIds } } }),
      prisma.cardNote.deleteMany({ where: { cardId: { in: cardIds } } }),
      prisma.processingJob.deleteMany({ where: { cardAssetId: { in: cardIds } } }),
      prisma.cardAsset.deleteMany({ where: { id: { in: cardIds } } }),
    ]);

    return res.status(200).json({ deleted: cardIds.length });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
