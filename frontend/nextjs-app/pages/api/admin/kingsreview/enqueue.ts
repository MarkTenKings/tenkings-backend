import { NextApiRequest, NextApiResponse } from "next";
import { enqueueBytebotLiteJob } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const body = req.body ?? {};
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const cardAssetId = typeof body.cardAssetId === "string" ? body.cardAssetId : undefined;
    const sources = Array.isArray(body.sources) ? body.sources : ["ebay_sold", "tcgplayer"];

    if (!query) {
      return res.status(400).json({ message: "query is required" });
    }

    const job = await enqueueBytebotLiteJob({
      searchQuery: query,
      sources,
      cardAssetId,
      payload: {
        query,
        sources,
      },
    });

    return res.status(200).json({ job });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
