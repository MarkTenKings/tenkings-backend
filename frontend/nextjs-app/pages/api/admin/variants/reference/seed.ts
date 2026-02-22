import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

type ResponseBody =
  | { inserted: number; skipped: number }
  | { message: string };

type SeedImageRow = {
  rawImageUrl: string;
  sourceUrl: string | null;
};

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const { setId, cardNumber, parallelId, query, limit, tbs, gl, hl } = req.body ?? {};
    if (!setId || !parallelId || !query) {
      return res.status(400).json({ message: "setId, parallelId, and query are required." });
    }

    const apiKey = process.env.SERPAPI_KEY ?? "";
    if (!apiKey) {
      return res.status(500).json({ message: "SERPAPI_KEY is not configured on the server." });
    }

    const safeLimit = Math.min(50, Math.max(1, Number(limit ?? 20) || 20));
    const params = new URLSearchParams({
      engine: "google_images",
      q: String(query).trim(),
      api_key: apiKey,
    });
    if (tbs) params.set("tbs", String(tbs).trim());
    if (gl) params.set("gl", String(gl).trim());
    if (hl) params.set("hl", String(hl).trim());

    const response = await fetch(`${SERPAPI_ENDPOINT}?${params.toString()}`);
    if (!response.ok) {
      return res.status(502).json({ message: `SerpApi request failed (${response.status}).` });
    }
    const data = await response.json();
    if (data?.search_metadata?.status && data.search_metadata.status !== "Success") {
      return res.status(502).json({ message: data?.search_metadata?.error ?? "SerpApi returned error." });
    }

    const images = Array.isArray(data?.images_results) ? data.images_results : [];
    const seen = new Set<string>();
    const rows = images
      .map((image: any) => ({
        rawImageUrl:
          typeof image?.original === "string"
            ? image.original.trim()
            : typeof image?.thumbnail === "string"
            ? image.thumbnail.trim()
            : "",
        sourceUrl: typeof image?.link === "string" ? image.link.trim() : null,
      }))
      .filter((row: SeedImageRow) => row.rawImageUrl)
      .filter((row: SeedImageRow) => {
        if (seen.has(row.rawImageUrl)) return false;
        seen.add(row.rawImageUrl);
        return true;
      })
      .slice(0, safeLimit)
      .map((row: SeedImageRow) => ({
        setId: String(setId).trim(),
        cardNumber: cardNumber ? String(cardNumber).trim() : "ALL",
        parallelId: String(parallelId).trim(),
        rawImageUrl: row.rawImageUrl,
        sourceUrl: row.sourceUrl,
      }));

    if (rows.length === 0) {
      return res.status(200).json({ inserted: 0, skipped: 0 });
    }

    const normalizedSetId = String(setId).trim();
    const normalizedCardNumber = cardNumber ? String(cardNumber).trim() : "ALL";
    const normalizedParallelId = String(parallelId).trim();

    const existingRows = await prisma.cardVariantReferenceImage.findMany({
      where: {
        setId: normalizedSetId,
        cardNumber: normalizedCardNumber,
        parallelId: normalizedParallelId,
        rawImageUrl: {
          in: rows.map((row: { rawImageUrl: string }) => row.rawImageUrl),
        },
      },
      select: {
        rawImageUrl: true,
      },
    });
    const existingUrls = new Set(existingRows.map((row) => row.rawImageUrl));
    const rowsToInsert = rows.filter((row) => !existingUrls.has(row.rawImageUrl));

    if (rowsToInsert.length > 0) {
      await prisma.cardVariantReferenceImage.createMany({ data: rowsToInsert });
    }

    const duplicateSkips = rows.length - rowsToInsert.length;
    return res
      .status(200)
      .json({ inserted: rowsToInsert.length, skipped: Math.max(0, safeLimit - rows.length) + duplicateSkips });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
