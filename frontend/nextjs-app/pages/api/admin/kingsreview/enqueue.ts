import { NextApiRequest, NextApiResponse } from "next";
import { CardPhotoKind, CardReviewStage, enqueueBytebotLiteJob, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const admin = await requireAdminSession(req);

    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const body = req.body ?? {};
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const cardAssetId = typeof body.cardAssetId === "string" ? body.cardAssetId : undefined;
    const sources = Array.isArray(body.sources)
      ? body.sources
      : ["ebay_sold", "tcgplayer", "pricecharting"];
    const categoryType = typeof body.categoryType === "string" ? body.categoryType : null;

    if (!query) {
      return res.status(400).json({ message: "query is required" });
    }

    if (cardAssetId) {
      const card = await prisma.cardAsset.findFirst({
        where: { id: cardAssetId, batch: { uploadedById: admin.user.id } },
        include: { photos: true, batch: true },
      });
      if (!card || !card.batch) {
        return res.status(404).json({ message: "Card asset not found" });
      }
      const hasBack = card.photos.some((photo) => photo.kind === CardPhotoKind.BACK);
      if (!hasBack) {
        return res.status(400).json({ message: "Back photo is required before sending to KingsReview AI." });
      }
      await prisma.cardAsset.update({
        where: { id: card.id },
        data: {
          reviewStage: CardReviewStage.BYTEBOT_RUNNING,
          reviewStageUpdatedAt: new Date(),
        },
      });
    }

    const job = await enqueueBytebotLiteJob({
      searchQuery: query,
      sources,
      cardAssetId,
      payload: {
        query,
        sources,
        categoryType,
      },
    });

    return res.status(200).json({ job });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
