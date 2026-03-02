import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { ReferenceSeedError, seedVariantReferenceImages } from "../../../../../lib/server/referenceSeed";

type ResponseBody =
  | { inserted: number; skipped: number }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const { setId, cardNumber, parallelId, playerSeed, query, limit, tbs, gl, hl } = req.body ?? {};
    const result = await seedVariantReferenceImages({
      setId,
      cardNumber,
      parallelId,
      playerSeed,
      query,
      limit,
      tbs,
      gl,
      hl,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ReferenceSeedError) {
      return res.status(error.status).json({ message: error.message });
    }
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
