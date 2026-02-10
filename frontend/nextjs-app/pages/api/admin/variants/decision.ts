import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type ResponseBody = { ok: true } | { message: string };

type Candidate = {
  parallelId: string;
  confidence?: number | null;
  reason?: string | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const { cardAssetId, selectedParallelId, confidence, candidates, humanOverride, humanNotes } = req.body ?? {};

    if (!cardAssetId) {
      return res.status(400).json({ message: "cardAssetId is required" });
    }

    const safeCandidates: Candidate[] = Array.isArray(candidates)
      ? candidates
          .filter((entry: any) => entry && entry.parallelId)
          .map((entry: any) => ({
            parallelId: String(entry.parallelId),
            confidence: entry.confidence != null ? Number(entry.confidence) : null,
            reason: entry.reason ? String(entry.reason) : null,
          }))
      : [];

    await prisma.cardVariantDecision.create({
      data: {
        cardAssetId: String(cardAssetId),
        candidatesJson: safeCandidates,
        selectedParallelId: selectedParallelId ? String(selectedParallelId) : null,
        confidence: confidence != null ? Number(confidence) : null,
        humanOverride: Boolean(humanOverride),
        humanNotes: humanNotes ? String(humanNotes) : null,
      },
    });

    if (selectedParallelId || confidence != null) {
      await prisma.cardAsset.update({
        where: { id: String(cardAssetId) },
        data: {
          variantId: selectedParallelId ? String(selectedParallelId) : undefined,
          variantConfidence: confidence != null ? Number(confidence) : undefined,
        },
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
