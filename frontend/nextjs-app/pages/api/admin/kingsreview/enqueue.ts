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
    const rawQuery = typeof body.query === "string" ? body.query.trim() : "";
    const useManual = Boolean(body.useManual);
    const cardAssetId = typeof body.cardAssetId === "string" ? body.cardAssetId : undefined;
    const sources = ["ebay_sold"];
    const categoryType = typeof body.categoryType === "string" ? body.categoryType : null;

    let query = rawQuery;
    if (cardAssetId && !useManual) {
      const card = await prisma.cardAsset.findFirst({
        where: { id: cardAssetId, batch: { uploadedById: admin.user.id } },
        select: {
          customTitle: true,
          ocrText: true,
          resolvedPlayerName: true,
          resolvedTeamName: true,
          classificationJson: true,
          classificationSourcesJson: true,
          variantId: true,
        },
      });
      if (card) {
        const normalized =
          typeof card.classificationJson === "object" && card.classificationJson
            ? ((card.classificationJson as any).normalized ?? null)
            : null;
        const attributes =
          typeof card.classificationJson === "object" && card.classificationJson
            ? ((card.classificationJson as any).attributes ?? null)
            : null;
        const textPool = `${card.customTitle ?? ""} ${card.ocrText ?? ""}`;
        const serialMatch = textPool.match(/\/\s*\d{1,3}/);
        const serial = serialMatch ? serialMatch[0].replace(/\s+/g, "") : null;
        const gradeMatch = textPool.match(/\b(PSA|BGS|SGC|CGC)\s*\d{1,2}\b/i);
        const grade = gradeMatch ? gradeMatch[0].toUpperCase().replace(/\s+/g, " ") : null;
        const flags = [];
        if (/\b(auto|autograph)\b/i.test(textPool)) flags.push("Auto");
        if (/\b(patch|relic|rpa)\b/i.test(textPool)) flags.push("Patch");
        if (/\b(rookie|rc)\b/i.test(textPool)) flags.push("Rookie");

        const candidateTokens = [
          normalized?.year ?? attributes?.year,
          attributes?.brand ?? normalized?.company,
          normalized?.setName,
          normalized?.setCode ?? attributes?.setName,
          card.resolvedPlayerName ?? attributes?.playerName,
          attributes?.teamName,
          normalized?.cardNumber ?? attributes?.cardNumber,
          attributes?.numbered,
          normalized?.parallelName ?? attributes?.parallel,
          ...(Array.isArray(attributes?.variantKeywords) ? attributes?.variantKeywords : []),
          card.variantId,
          serial,
          grade,
          attributes?.gradeCompany,
          attributes?.gradeValue,
          ...flags,
        ];
        const tokenSet = new Set<string>();
        candidateTokens.forEach((entry) => {
          if (typeof entry !== "string") return;
          const trimmed = entry.trim();
          if (!trimmed) return;
          tokenSet.add(trimmed);
        });
        const tokens = Array.from(tokenSet);
        if (tokens.length) {
          query = tokens.join(" ");
        }
      }
    }

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
      maxComps: 20,
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
