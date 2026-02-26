import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { loadVariantOptionPool, sanitizeText } from "../../../../lib/server/variantOptionPool";

type ResponseBody =
  | {
      variants: Array<{
        setId: string;
        cardNumber: string;
        parallelId: string;
        parallelFamily: string | null;
      }>;
      sets: Array<{
        setId: string;
        count: number;
        score: number;
      }>;
      insertOptions: Array<{
        label: string;
        kind: "insert";
        count: number;
        setIds: string[];
        primarySetId: string | null;
      }>;
      parallelOptions: Array<{
        label: string;
        kind: "parallel";
        count: number;
        setIds: string[];
        primarySetId: string | null;
      }>;
      source: "legacy" | "taxonomy_v2";
      legacyFallbackUsed: boolean;
      scope: {
        year: string;
        manufacturer: string;
        sport: string | null;
        productLine: string | null;
        setId: string | null;
        approvedSetCount: number;
        scopedSetCount: number;
        selectedSetId: string | null;
        variantCount: number;
        source: "legacy" | "taxonomy_v2";
      };
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const year = sanitizeText(req.query.year);
    const manufacturer = sanitizeText(req.query.manufacturer);
    const sport = sanitizeText(req.query.sport) || null;
    const productLine = sanitizeText(req.query.productLine) || null;
    const setId = sanitizeText(req.query.setId) || null;

    const pool = await loadVariantOptionPool({
      year,
      manufacturer,
      sport,
      productLine,
      setId,
    });

    return res.status(200).json({
      variants: pool.variants,
      sets: pool.sets,
      insertOptions: pool.insertOptions.map((entry) => ({ ...entry, kind: "insert" as const })),
      parallelOptions: pool.parallelOptions.map((entry) => ({ ...entry, kind: "parallel" as const })),
      source: pool.source,
      scope: {
        year,
        manufacturer,
        sport,
        productLine,
        setId,
        approvedSetCount: pool.approvedSetCount,
        scopedSetCount: pool.scopedSetIds.length,
        selectedSetId: pool.selectedSetId,
        variantCount: pool.variantCount,
        source: pool.source,
      },
      legacyFallbackUsed: pool.legacyFallbackUsed,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
