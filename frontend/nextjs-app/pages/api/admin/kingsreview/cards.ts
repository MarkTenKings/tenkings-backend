import { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const DEFAULT_LIMIT = 50;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);

    if (req.method !== "GET") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const stage = typeof req.query.stage === "string" ? req.query.stage : "READY_FOR_HUMAN_REVIEW";
    const includeUnstaged = req.query.includeUnstaged === "1";
    const limit = Math.min(Number(req.query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 200);
    const offset = Number(req.query.offset ?? 0) || 0;

    const cards = await prisma.cardAsset.findMany({
      where:
        stage === "IN_REVIEW"
          ? {
              OR: [
                { reviewStage: "BYTEBOT_RUNNING" as any },
                { reviewStage: "READY_FOR_HUMAN_REVIEW" as any },
                ...(includeUnstaged ? [{ reviewStage: null }] : []),
              ],
            }
          : includeUnstaged && stage === "READY_FOR_HUMAN_REVIEW"
            ? { OR: [{ reviewStage: stage as any }, { reviewStage: null }] }
            : { reviewStage: stage as any },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        fileName: true,
        imageUrl: true,
        thumbnailUrl: true,
        customTitle: true,
        resolvedPlayerName: true,
        resolvedTeamName: true,
        valuationMinor: true,
        valuationCurrency: true,
        status: true,
        reviewStage: true,
        reviewStageUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({ cards });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
