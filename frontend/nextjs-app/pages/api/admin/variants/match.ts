import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import sharp from "sharp";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type ResponseBody =
  | {
      ok: true;
      candidates: Array<{ parallelId: string; confidence: number; reason: string }>;
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
    if (!cardAssetId || !setId || !cardNumber) {
      return res.status(400).json({ message: "cardAssetId, setId, and cardNumber are required" });
    }

    const cardAsset = await prisma.cardAsset.findUnique({
      where: { id: String(cardAssetId) },
      select: { imageUrl: true, photos: { select: { kind: true, imageUrl: true } } },
    });
    if (!cardAsset?.imageUrl) {
      return res.status(404).json({ message: "Card image not found" });
    }

    const tiltPhoto = cardAsset.photos?.find((photo) => photo.kind === "TILT")?.imageUrl ?? null;
    const foilSourceUrl = tiltPhoto || cardAsset.imageUrl;

    const computeFoilScore = async (imageUrl: string) => {
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        const { data, info } = await sharp(buffer)
          .rotate()
          .resize(160, 160, { fit: "inside" })
          .raw()
          .toBuffer({ resolveWithObject: true });
        if (!info.width || !info.height) return null;

        let brightCount = 0;
        let total = 0;
        let sumV = 0;
        let sumV2 = 0;
        for (let i = 0; i < data.length; i += info.channels) {
          const r = (data[i] ?? 0) / 255;
          const g = (data[i + 1] ?? 0) / 255;
          const b = (data[i + 2] ?? 0) / 255;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const v = max;
          const s = max === 0 ? 0 : (max - min) / max;
          if (v > 0.85 && s > 0.2) brightCount += 1;
          sumV += v;
          sumV2 += v * v;
          total += 1;
        }
        if (!total) return null;
        const brightFrac = brightCount / total;
        const meanV = sumV / total;
        const variance = sumV2 / total - meanV * meanV;
        const stdV = Math.sqrt(Math.max(0, variance));
        const score = Math.min(1, Math.max(0, 0.6 * brightFrac + 0.4 * stdV));
        return Number(score.toFixed(3));
      } catch {
        return null;
      }
    };

    const foilScore = await computeFoilScore(foilSourceUrl);

    const normalizedSetId = String(setId).trim();
    const normalizedCardNumber = String(cardNumber).trim();
    let variants = await prisma.cardVariant.findMany({
      where: {
        setId: normalizedSetId,
        cardNumber: normalizedCardNumber,
      },
      orderBy: [{ parallelId: "asc" }],
      take: 25,
    });

    if (variants.length === 0) {
      variants = await prisma.cardVariant.findMany({
        where: {
          setId: normalizedSetId,
          cardNumber: "ALL",
        },
        orderBy: [{ parallelId: "asc" }],
        take: 25,
      });
    }

    if (variants.length === 0) {
      return res.status(404).json({ message: "No variants found for this set/card" });
    }

    const embeddingService = process.env.VARIANT_EMBEDDING_URL ?? "";
    let candidates: Array<{ parallelId: string; confidence: number; reason: string }> = [];

    if (embeddingService) {
      const embedRes = await fetch(embeddingService, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: cardAsset.imageUrl, mode: "card" }),
      });
      const embedPayload = await embedRes.json().catch(() => null);
      const cardVectors: number[][] = Array.isArray(embedPayload?.embeddings)
        ? embedPayload.embeddings.map((entry: any) => entry.vector).filter((vec: any) => Array.isArray(vec))
        : [];

      const cosine = (a: number[], b: number[]) => {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
          dot += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }
        if (!normA || !normB) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
      };

      for (const variant of variants) {
        const refs = await prisma.cardVariantReferenceImage.findMany({
          where: { setId: String(setId).trim(), parallelId: variant.parallelId },
          take: 5,
          orderBy: [{ qualityScore: "desc" }, { createdAt: "desc" }],
        });

        let bestScore = 0;
        for (const ref of refs) {
          const embeddings = Array.isArray(ref.cropEmbeddings) ? (ref.cropEmbeddings as any[]) : [];
          let refScore = 0;
          let refCount = 0;
          for (const emb of embeddings) {
            const vec = emb?.vector;
            if (!Array.isArray(vec) || vec.length === 0) continue;
            let best = 0;
            for (const cardVec of cardVectors) {
              const score = cosine(cardVec, vec);
              if (score > best) best = score;
            }
            refScore += best;
            refCount += 1;
          }
          if (refCount > 0) {
            const avg = refScore / refCount;
            if (avg > bestScore) bestScore = avg;
          }
        }

        candidates.push({
          parallelId: variant.parallelId,
          confidence: Number(bestScore.toFixed(3)),
          reason: "cosine",
        });
      }

      candidates = candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    } else {
      const confidences = [0.9, 0.82, 0.74, 0.66, 0.58];
      candidates = variants.map((variant, index) => ({
        parallelId: variant.parallelId,
        confidence: confidences[index] ?? 0.5,
        reason: `stub${foilScore != null ? `|foil=${foilScore}` : ""}`,
      }));
    }

    if (foilScore != null) {
      candidates = candidates.map((candidate) => ({
        ...candidate,
        reason: candidate.reason.includes("foil=") ? candidate.reason : `${candidate.reason}|foil=${foilScore}`,
      }));
    }

    const top = candidates[0];

    await prisma.cardVariantDecision.create({
      data: {
        cardAssetId: String(cardAssetId),
        candidatesJson: candidates,
        selectedParallelId: top?.parallelId ?? null,
        confidence: top?.confidence ?? null,
        humanOverride: false,
        humanNotes: null,
      },
    });

    if (top) {
      await prisma.cardAsset.update({
        where: { id: String(cardAssetId) },
        data: {
          variantId: top.parallelId,
          variantConfidence: top.confidence,
        },
      });
    }

    return res.status(200).json({ ok: true, candidates });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
