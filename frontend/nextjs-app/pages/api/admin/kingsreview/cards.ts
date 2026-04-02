import { NextApiRequest, NextApiResponse } from "next";
import { CardAssetStatus, CardPhotoKind, CardReviewStage, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { sanitizeListImageUrl } from "../../../../lib/server/storage";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);

    if (req.method !== "GET") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const stage = typeof req.query.stage === "string" ? req.query.stage : "READY_FOR_HUMAN_REVIEW";
    const includeUnstaged = req.query.includeUnstaged === "1";
    const limit = Math.min(Number(req.query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Number(req.query.offset ?? 0) || 0;
    const nonUploadingFilter = { status: { not: CardAssetStatus.UPLOADING } };
    const readyForHumanReviewFilter = {
      ...nonUploadingFilter,
      reviewStage: CardReviewStage.READY_FOR_HUMAN_REVIEW,
      AND: [
        { photos: { some: { kind: CardPhotoKind.BACK } } },
        { photos: { some: { kind: CardPhotoKind.TILT } } },
      ],
    };
    const bytebotRunningFilter = {
      ...nonUploadingFilter,
      reviewStage: CardReviewStage.BYTEBOT_RUNNING,
    };
    const unstagedFilter = {
      ...nonUploadingFilter,
      reviewStage: null,
    };
    const stageFilter =
      stage === "IN_REVIEW"
        ? {
            OR: [
              bytebotRunningFilter,
              readyForHumanReviewFilter,
              ...(includeUnstaged ? [unstagedFilter] : []),
            ],
          }
        : includeUnstaged && stage === "READY_FOR_HUMAN_REVIEW"
          ? { OR: [readyForHumanReviewFilter, unstagedFilter] }
          : stage === "READY_FOR_HUMAN_REVIEW"
            ? readyForHumanReviewFilter
            : {
                ...nonUploadingFilter,
                reviewStage: stage as any,
              };

    const cards = await prisma.cardAsset.findMany({
      where: stageFilter,
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        fileName: true,
        imageUrl: true,
        thumbnailUrl: true,
        cdnHdUrl: true,
        cdnThumbUrl: true,
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

    const normalized = cards.map((card) => ({
      ...card,
      imageUrl: sanitizeListImageUrl(card.imageUrl),
      thumbnailUrl: sanitizeListImageUrl(card.thumbnailUrl),
      cdnHdUrl: card.cdnHdUrl ?? null,
      cdnThumbUrl: card.cdnThumbUrl ?? null,
    }));

    return res.status(200).json({ cards: normalized });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
