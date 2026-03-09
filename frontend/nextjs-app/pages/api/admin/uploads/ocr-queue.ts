import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { CardPhotoKind, CardReviewStage, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";

type QueueCard = {
  id: string;
  status: string;
  reviewStage: string | null;
  createdAt: string;
  updatedAt: string;
};

type QueueResponse = {
  cards: QueueCard[];
};

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 500;

const handler: NextApiHandler<QueueResponse | { message: string }> = async function handler(
  req: NextApiRequest,
  res: NextApiResponse<QueueResponse | { message: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const limit = Math.min(Number(req.query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, MAX_LIMIT);

    const cards = await prisma.cardAsset.findMany({
      where: {
        batch: { uploadedById: admin.user.id },
        reviewStage: CardReviewStage.READY_FOR_HUMAN_REVIEW,
        bytebotLiteJobs: { none: {} },
        AND: [
          { photos: { some: { kind: CardPhotoKind.BACK } } },
          { photos: { some: { kind: CardPhotoKind.TILT } } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        status: true,
        reviewStage: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      cards: cards.map((card) => ({
        id: card.id,
        status: String(card.status),
        reviewStage: card.reviewStage ?? null,
        createdAt: card.createdAt.toISOString(),
        updatedAt: card.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
};

export default withAdminCors(handler);
