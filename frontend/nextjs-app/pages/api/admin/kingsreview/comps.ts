import { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { buildKingsreviewCompMatchContext } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";
import { fetchKingsreviewEbaySoldCompPage } from "../../../../lib/server/kingsreviewEbayComps";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const parsePositiveInt = (value: string | string[] | undefined, fallback: number) => {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number(candidate);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const next = Math.trunc(parsed);
  return next >= 1 ? next : fallback;
};

const parseNonNegativeInt = (value: string | string[] | undefined, fallback: number) => {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number(candidate);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const next = Math.trunc(parsed);
  return next >= 0 ? next : fallback;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const source = typeof req.query.source === "string" ? req.query.source.trim() : "ebay_sold";
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  const cardAssetId = typeof req.query.cardAssetId === "string" ? req.query.cardAssetId.trim() : "";
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(MAX_LIMIT, parsePositiveInt(req.query.limit, DEFAULT_LIMIT));
  const hasExplicitOffset = req.query.offset !== undefined;
  const offset = hasExplicitOffset ? parseNonNegativeInt(req.query.offset, 0) : Math.max(0, (page - 1) * limit);

  try {
    const admin = await requireAdminSession(req);

    if (req.method !== "GET") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    if (source !== "ebay_sold") {
      return res.status(400).json({ message: "Only ebay_sold supports KingsReview load more right now" });
    }

    if (!query) {
      return res.status(400).json({ message: "query is required" });
    }

    let matchContext = null;
    if (cardAssetId) {
      const card = await prisma.cardAsset.findFirst({
        where: { id: cardAssetId, batch: { uploadedById: admin.user.id } },
        select: {
          classificationJson: true,
          resolvedPlayerName: true,
          customTitle: true,
          variantId: true,
        },
      });
      if (!card) {
        return res.status(404).json({ message: "Card asset not found" });
      }
      matchContext = buildKingsreviewCompMatchContext({
        resolvedPlayerName: card.resolvedPlayerName,
        classification: card.classificationJson,
        customTitle: card.customTitle,
        variantId: card.variantId,
      });
    }

    const result = await fetchKingsreviewEbaySoldCompPage({ query, page, offset, limit, matchContext });

    return res.status(200).json(result);
  } catch (error) {
    console.error("[kingsreview/comps] load-more request failed", {
      source,
      query,
      page,
      offset,
      limit,
      message: error instanceof Error ? error.message : String(error || ""),
    });
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}

export default withAdminCors(handler);
