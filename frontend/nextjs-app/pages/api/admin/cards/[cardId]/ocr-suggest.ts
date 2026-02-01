import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { extractCardAttributes, parseClassificationPayload } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

type SuggestResponse =
  | {
      suggestions: {
        playerName?: string | null;
        year?: string | null;
        manufacturer?: string | null;
      };
      source: "ocr";
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<SuggestResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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
      select: { ocrText: true, classificationJson: true },
    });

    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    const extracted = extractCardAttributes(card.ocrText);
    const normalized = parseClassificationPayload(card.classificationJson)?.normalized;

    return res.status(200).json({
      suggestions: {
        playerName: extracted.playerName ?? null,
        year: extracted.year ?? normalized?.year ?? null,
        manufacturer: extracted.brand ?? normalized?.company ?? null,
      },
      source: "ocr",
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
