import type { NextApiRequest, NextApiResponse } from "next";
import {
  buildComparableEbayUrls,
  extractCardAttributes,
} from "@tenkings/shared";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { cardId } = req.query;

    if (typeof cardId !== "string" || !cardId.trim()) {
      return res.status(400).json({ message: "cardId is required" });
    }

    const card = await prisma.cardAsset.findFirst({
      where: { id: cardId, batch: { uploadedById: admin.user.id } },
      select: {
        id: true,
        status: true,
        ocrText: true,
        classificationJson: true,
        aiGradePsaEquivalent: true,
        aiGradingJson: true,
        ebaySoldUrl: true,
        ebaySoldUrlVariant: true,
        ebaySoldUrlHighGrade: true,
        ebaySoldUrlPlayerComp: true,
        ebaySoldUrlAiGrade: true,
        classificationSourcesJson: true,
      },
    });

    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    const sources = card.classificationSourcesJson as Record<string, unknown> | null;
    const classification = card.classificationJson as ReturnType<typeof extractCardAttributes> | null;
    const bestMatch = sources && typeof sources === "object" ? (sources as any).bestMatchData ?? null : null;

    const attributes = classification ?? extractCardAttributes(card.ocrText, { bestMatch });
    const isGraded = sources && (sources as any).graded === "yes";

    const urls = buildComparableEbayUrls({
      ocrText: card.ocrText,
      attributes,
      bestMatch,
      aiGradePsa: isGraded ? undefined : card.aiGradePsaEquivalent ?? undefined,
      isGraded,
    });

    await prisma.cardAsset.update({
      where: { id: card.id },
      data: {
        ebaySoldUrl: urls.exact ?? null,
        ebaySoldUrlVariant: urls.variant ?? null,
        ebaySoldUrlHighGrade: urls.premiumHighGrade ?? null,
        ebaySoldUrlPlayerComp: urls.playerComp ?? null,
        ebaySoldUrlAiGrade: urls.aiGradeComp ?? null,
      },
    });

    return res.status(200).json({ message: "eBay comps regenerated" });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
