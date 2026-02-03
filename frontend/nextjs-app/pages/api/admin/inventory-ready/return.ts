import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const cardIds = Array.isArray(body?.cardIds) ? body.cardIds.filter(Boolean) : [];
    if (cardIds.length === 0) {
      return res.status(400).json({ message: "cardIds is required" });
    }

    await prisma.cardAsset.updateMany({
      where: { id: { in: cardIds } },
      data: {
        inventoryBatchId: null,
        inventoryAssignedAt: null,
        reviewStage: "READY_FOR_HUMAN_REVIEW",
        reviewStageUpdatedAt: new Date(),
      },
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
