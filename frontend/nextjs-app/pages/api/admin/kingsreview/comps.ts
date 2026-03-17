import { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";
import { fetchKingsreviewEbaySoldCompPage } from "../../../../lib/server/kingsreviewEbayComps";

const DEFAULT_LIMIT = 20;
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);

    if (req.method !== "GET") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const source = typeof req.query.source === "string" ? req.query.source.trim() : "ebay_sold";
    if (source !== "ebay_sold") {
      return res.status(400).json({ message: "Only ebay_sold supports KingsReview load more right now" });
    }

    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query) {
      return res.status(400).json({ message: "query is required" });
    }

    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(MAX_LIMIT, parsePositiveInt(req.query.limit, DEFAULT_LIMIT));
    const result = await fetchKingsreviewEbaySoldCompPage({ query, page, limit });

    return res.status(200).json(result);
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}

export default withAdminCors(handler);
