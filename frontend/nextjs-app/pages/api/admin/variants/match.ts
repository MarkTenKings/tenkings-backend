import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { runVariantMatch } from "../../../../lib/server/variantMatcher";

type ResponseBody =
  | {
      ok: true;
      candidates: Array<{ parallelId: string; confidence: number; reason: string }>;
      matchedSetId: string;
      matchedCardNumber: string;
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const { cardAssetId, setId, cardNumber } = req.body ?? {};
    if (!cardAssetId || !setId) {
      return res.status(400).json({ message: "cardAssetId and setId are required" });
    }

    const result = await runVariantMatch({
      cardAssetId: String(cardAssetId),
      setId: String(setId),
      cardNumber: cardNumber ? String(cardNumber) : null,
    });
    if (!result.ok) {
      return res.status(404).json({ message: result.message });
    }

    return res.status(200).json({
      ok: true,
      candidates: result.candidates,
      matchedSetId: result.matchedSetId,
      matchedCardNumber: result.matchedCardNumber,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
