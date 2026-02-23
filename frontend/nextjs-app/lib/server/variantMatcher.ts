import sharp from "sharp";
import { prisma } from "@tenkings/database";

export type VariantCandidate = {
  parallelId: string;
  confidence: number;
  reason: string;
};

export type VariantMatchResult =
  | {
      ok: true;
      candidates: VariantCandidate[];
      matchedSetId: string;
      matchedCardNumber: string;
    }
  | {
      ok: false;
      message: string;
      candidates?: VariantCandidate[];
      matchedSetId?: string;
      matchedCardNumber?: string;
    };

const MIN_MATCH_CONFIDENCE = 0.78;
const MIN_MATCH_MARGIN = 0.05;

async function computeFoilScore(imageUrl: string) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const { data, info } = await sharp(buffer).rotate().resize(160, 160, { fit: "inside" }).raw().toBuffer({
      resolveWithObject: true,
    });
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
}

async function resolveSetIdCandidates(inputSetId: string) {
  const normalized = inputSetId.trim();
  if (!normalized) return [];

  const exactCount = await prisma.cardVariant.count({ where: { setId: normalized } });
  if (exactCount > 0) return [normalized];

  const fuzzy = await prisma.cardVariant.findMany({
    where: {
      setId: { contains: normalized, mode: "insensitive" },
    },
    distinct: ["setId"],
    select: { setId: true },
    take: 10,
  });
  if (fuzzy.length > 0) return fuzzy.map((row) => row.setId);

  // Final fallback: split into words and try first meaningful token.
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  for (const token of tokens) {
    const tokenRows = await prisma.cardVariant.findMany({
      where: {
        setId: { contains: token, mode: "insensitive" },
      },
      distinct: ["setId"],
      select: { setId: true },
      take: 10,
    });
    if (tokenRows.length > 0) return tokenRows.map((row) => row.setId);
  }
  return [];
}

async function filterApprovedSetCandidates(setIds: string[]) {
  const uniqueSetIds = Array.from(new Set(setIds.map((entry) => String(entry || "").trim()).filter(Boolean)));
  if (uniqueSetIds.length < 1) return [];

  const approvedRows = await prisma.setDraft.findMany({
    where: {
      setId: { in: uniqueSetIds },
      status: "APPROVED",
      archivedAt: null,
    },
    select: {
      setId: true,
    },
  });
  const approvedSetIds = new Set(approvedRows.map((row) => String(row.setId || "").trim()).filter(Boolean));
  return uniqueSetIds.filter((setId) => approvedSetIds.has(setId));
}

async function findVariants(params: { setId: string; cardNumber?: string | null }) {
  const setId = params.setId.trim();
  const cardNumber = params.cardNumber?.trim() || "";
  const whereExact = {
    setId,
    ...(cardNumber ? { cardNumber } : {}),
  };
  let variants = await prisma.cardVariant.findMany({
    where: whereExact,
    orderBy: [{ parallelId: "asc" }],
    take: 25,
    select: {
      setId: true,
      cardNumber: true,
      parallelId: true,
      keywords: true,
      oddsInfo: true,
    },
  });
  if (variants.length === 0) {
    variants = await prisma.cardVariant.findMany({
      where: { setId, cardNumber: "ALL" },
      orderBy: [{ parallelId: "asc" }],
      take: 25,
      select: {
        setId: true,
        cardNumber: true,
        parallelId: true,
        keywords: true,
        oddsInfo: true,
      },
    });
  }
  return variants;
}

function cosine(a: number[], b: number[]) {
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
}

export async function runVariantMatch(params: {
  cardAssetId: string;
  setId: string;
  cardNumber?: string | null;
  numbered?: string | null;
}): Promise<VariantMatchResult> {
  const cardAssetId = params.cardAssetId.trim();
  const setInput = params.setId.trim();
  const cardNumberInput = params.cardNumber?.trim() || "ALL";
  const numberedInput = params.numbered?.trim() || null;
  if (!cardAssetId || !setInput) {
    return { ok: false, message: "cardAssetId and setId are required" };
  }

  const cardAsset = await prisma.cardAsset.findUnique({
    where: { id: cardAssetId },
    select: { imageUrl: true, photos: { select: { kind: true, imageUrl: true } } },
  });
  if (!cardAsset?.imageUrl) {
    return { ok: false, message: "Card image not found" };
  }

  const setCandidates = await resolveSetIdCandidates(setInput);
  if (setCandidates.length === 0) {
    return { ok: false, message: "No variant set found for supplied set name" };
  }
  const approvedSetCandidates = await filterApprovedSetCandidates(setCandidates);
  if (approvedSetCandidates.length === 0) {
    return { ok: false, message: "No approved variant set found for supplied set name" };
  }

  let matchedSetId = "";
  let variants: Array<{
    setId: string;
    parallelId: string;
    cardNumber: string;
    keywords: string[];
    oddsInfo: string | null;
  }> = [];
  for (const setId of approvedSetCandidates) {
    const rows = await findVariants({ setId, cardNumber: cardNumberInput === "ALL" ? "" : cardNumberInput });
    if (rows.length > 0) {
      matchedSetId = setId;
      variants = rows.map((row) => ({
        setId: row.setId,
        parallelId: row.parallelId,
        cardNumber: row.cardNumber,
        keywords: Array.isArray(row.keywords) ? row.keywords : [],
        oddsInfo: row.oddsInfo ?? null,
      }));
      break;
    }
  }
  if (!variants.length || !matchedSetId) {
    return { ok: false, message: "No variants found for resolved set/card" };
  }

  const tiltPhoto = cardAsset.photos?.find((photo) => photo.kind === "TILT")?.imageUrl ?? null;
  const foilSourceUrl = tiltPhoto || cardAsset.imageUrl;
  const foilScore = await computeFoilScore(foilSourceUrl);
  const embeddingService = process.env.VARIANT_EMBEDDING_URL ?? "";
  if (!embeddingService) {
    return { ok: false, message: "Variant embedding service is not configured" };
  }

  const extractDenominator = (value: string | null | undefined) => {
    if (!value) return null;
    const match = value.match(/\/\s*(\d{1,4})\b/);
    return match?.[1] ?? null;
  };

  const embedRes = await fetch(embeddingService, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl: cardAsset.imageUrl, mode: "card" }),
  });
  const embedPayload = await embedRes.json().catch(() => null);
  const cardVectors: number[][] = Array.isArray(embedPayload?.embeddings)
    ? embedPayload.embeddings.map((entry: any) => entry.vector).filter((vec: any) => Array.isArray(vec))
    : [];

  if (cardVectors.length === 0) {
    return { ok: false, message: "Card embedding could not be computed" };
  }

  const targetDenominator = extractDenominator(numberedInput);
  let candidates: VariantCandidate[] = [];
  for (const variant of variants) {
    const variantCardNumber = String(variant.cardNumber || "ALL").trim() || "ALL";
    const referenceWhere: any =
      variantCardNumber === "ALL"
        ? { setId: variant.setId, parallelId: variant.parallelId }
        : {
            setId: variant.setId,
            parallelId: variant.parallelId,
            OR: [{ cardNumber: variantCardNumber }, { cardNumber: "ALL" }, { cardNumber: null }],
          };
    const refs = await prisma.cardVariantReferenceImage.findMany({
      where: referenceWhere,
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

    let confidence = bestScore;
    let reason = "cosine";
    if (targetDenominator) {
      const searchable = [
        variant.parallelId,
        variant.oddsInfo ?? "",
        ...variant.keywords,
      ]
        .join(" ")
        .toLowerCase();
      if (searchable.includes(`/${targetDenominator}`)) {
        confidence = Math.min(1, confidence + 0.03);
        reason = "cosine|numbered-denominator-boost";
      }
    }

    candidates.push({
      parallelId: variant.parallelId,
      confidence: Number(confidence.toFixed(3)),
      reason,
    });
  }

  candidates = candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5);

  if (foilScore != null) {
    candidates = candidates.map((candidate) => ({
      ...candidate,
      reason: candidate.reason.includes("foil=") ? candidate.reason : `${candidate.reason}|foil=${foilScore}`,
    }));
  }

  const top = candidates[0];
  const second = candidates[1];
  const margin = top && second ? top.confidence - second.confidence : top ? top.confidence : 0;
  const passesThreshold = Boolean(top && top.confidence >= MIN_MATCH_CONFIDENCE && margin >= MIN_MATCH_MARGIN);
  await prisma.cardVariantDecision.create({
    data: {
      cardAssetId,
      candidatesJson: candidates,
      selectedParallelId: passesThreshold ? top?.parallelId ?? null : null,
      confidence: passesThreshold ? top?.confidence ?? null : null,
      humanOverride: false,
      humanNotes: null,
    },
  });

  if (passesThreshold && top) {
    await prisma.cardAsset.update({
      where: { id: cardAssetId },
      data: {
        variantId: top.parallelId,
        variantConfidence: top.confidence,
      },
    });
  } else {
    await prisma.cardAsset.update({
      where: { id: cardAssetId },
      data: {
        variantId: null,
        variantConfidence: null,
      },
    });
    return {
      ok: false,
      message: "No confident variant match",
      candidates,
      matchedSetId,
      matchedCardNumber: cardNumberInput,
    };
  }

  return {
    ok: true,
    candidates,
    matchedSetId,
    matchedCardNumber: cardNumberInput,
  };
}
