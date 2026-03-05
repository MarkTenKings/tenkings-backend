import sharp from "sharp";
import { prisma } from "@tenkings/database";
import { readTaxonomyV2Flags } from "./taxonomyV2Flags";
import { resolveTaxonomyScopeForMatcher } from "./taxonomyV2Core";
import { filterSetIdsByScopeIdentity, loadVariantScopeSetIds } from "./variantSetScope";
import { normalizeProgramId } from "./taxonomyV2Utils";

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
const MAX_CANDIDATES = 5;

type VariantRow = {
  setId: string;
  programId: string;
  parallelId: string;
  cardNumber: string;
  keywords: string[];
  oddsInfo: string | null;
};

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

async function filterScopeSetCandidates(setIds: string[], includeLegacyReviewRequired: boolean) {
  const uniqueSetIds = Array.from(new Set(setIds.map((entry) => String(entry || "").trim()).filter(Boolean)));
  if (uniqueSetIds.length < 1) return [];

  const scopeSetIds = await loadVariantScopeSetIds({
    includeLegacyReviewRequired,
  });
  if (scopeSetIds.scopeSetIds.length < 1) return [];
  return filterSetIdsByScopeIdentity(uniqueSetIds, scopeSetIds.scopeSetIds);
}

async function findVariants(params: { setId: string; cardNumber?: string | null; programId?: string | null }) {
  const setId = params.setId.trim();
  const cardNumber = params.cardNumber?.trim() || "";
  const normalizedProgramId = params.programId ? normalizeProgramId(params.programId) : "";
  const whereExact = {
    setId,
    ...(normalizedProgramId ? { programId: normalizedProgramId } : {}),
    ...(cardNumber ? { cardNumber } : {}),
  };
  let variants = await prisma.cardVariant.findMany({
    where: whereExact,
    orderBy: [{ parallelId: "asc" }],
    take: 25,
    select: {
      setId: true,
      programId: true,
      cardNumber: true,
      parallelId: true,
      keywords: true,
      oddsInfo: true,
    },
  });
  if (variants.length === 0) {
    variants = await prisma.cardVariant.findMany({
      where: { setId, ...(normalizedProgramId ? { programId: normalizedProgramId } : {}), cardNumber: "ALL" },
      orderBy: [{ parallelId: "asc" }],
      take: 25,
      select: {
        setId: true,
        programId: true,
        cardNumber: true,
        parallelId: true,
        keywords: true,
        oddsInfo: true,
      },
    });
  }
  if (variants.length === 0 && normalizedProgramId) {
    variants = await prisma.cardVariant.findMany({
      where: {
        setId,
        ...(cardNumber ? { cardNumber } : {}),
      },
      orderBy: [{ parallelId: "asc" }],
      take: 25,
      select: {
        setId: true,
        programId: true,
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

function sanitizeMatcherText(value: unknown): string {
  return String(value ?? "").trim();
}

function tokenizeMatcherText(value: string): string[] {
  return sanitizeMatcherText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeMatcherKey(value: string): string {
  return tokenizeMatcherText(value).join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractDenominator(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\/\s*(\d{1,4})\b/);
  return match?.[1] ?? null;
}

function sortCandidates(candidates: VariantCandidate[]): VariantCandidate[] {
  return [...candidates].sort((a, b) => b.confidence - a.confidence || a.parallelId.localeCompare(b.parallelId));
}

function buildVariantSearchableText(variant: VariantRow): string {
  return [variant.programId, variant.parallelId, variant.oddsInfo ?? "", ...variant.keywords].join(" ");
}

function scoreHintText(params: {
  hint: string | null | undefined;
  searchableLower: string;
  searchableKey: string;
  searchableTokens: Set<string>;
  reasonPrefix: string;
  exactBoost: number;
  partialBoost: number;
  tokenBoost: number;
  tokenBoostCap: number;
}): { boost: number; reasons: string[] } {
  const hint = sanitizeMatcherText(params.hint);
  if (!hint) {
    return { boost: 0, reasons: [] };
  }
  const hintLower = hint.toLowerCase();
  const hintKey = normalizeMatcherKey(hint);
  let boost = 0;
  const reasons: string[] = [];

  if (hintKey && params.searchableKey === hintKey) {
    boost += params.exactBoost;
    reasons.push(`${params.reasonPrefix}-exact`);
  } else if (
    hintLower.length >= 3 &&
    (params.searchableLower.includes(hintLower) ||
      hintLower.includes(params.searchableLower) ||
      (hintKey &&
        (params.searchableKey.includes(hintKey) ||
          hintKey.includes(params.searchableKey))))
  ) {
    boost += params.partialBoost;
    reasons.push(`${params.reasonPrefix}-partial`);
  }

  const hintTokens = Array.from(new Set(tokenizeMatcherText(hint).filter((token) => token.length >= 2)));
  if (hintTokens.length > 0) {
    let overlap = 0;
    for (const token of hintTokens) {
      if (params.searchableTokens.has(token)) {
        overlap += 1;
      }
    }
    if (overlap > 0) {
      boost += Math.min(params.tokenBoostCap, overlap * params.tokenBoost);
      reasons.push(`${params.reasonPrefix}-token`);
    }
  }

  return { boost, reasons };
}

function buildMetadataFallbackCandidates(params: {
  variants: VariantRow[];
  cardNumber: string;
  programHint?: string | null;
  variationHint?: string | null;
  targetDenominator: string | null;
  taxonomyScoped: boolean;
  fallbackReason: string;
}): VariantCandidate[] {
  if (params.variants.length < 1) {
    return [];
  }
  const normalizedCardNumber = sanitizeMatcherText(params.cardNumber).toUpperCase();
  const denominatorRegex = params.targetDenominator
    ? new RegExp(`/\\s*${escapeRegExp(params.targetDenominator)}\\b`, "i")
    : null;
  const hasAnyDenominator = /\/\s*\d{1,4}\b/i;
  const singleCandidate = params.variants.length === 1;

  const candidates = params.variants.map((variant) => {
    const searchableText = buildVariantSearchableText(variant);
    const searchableLower = searchableText.toLowerCase();
    const searchableKey = normalizeMatcherKey(searchableText);
    const searchableTokens = new Set(tokenizeMatcherText(searchableText));
    const variantCardNumber = sanitizeMatcherText(variant.cardNumber).toUpperCase();
    let confidence = 0.34;
    const reasonParts = ["metadata", params.fallbackReason];

    if (params.taxonomyScoped) {
      reasonParts.push("taxonomy-scope");
    }
    if (singleCandidate) {
      confidence += 0.54;
      reasonParts.push("single-candidate");
    }
    if (normalizedCardNumber && normalizedCardNumber !== "ALL") {
      if (variantCardNumber === normalizedCardNumber) {
        confidence += 0.07;
        reasonParts.push("card-exact");
      } else if (variantCardNumber === "ALL") {
        confidence += 0.02;
        reasonParts.push("card-all");
      }
    }

    const programScore = scoreHintText({
      hint: params.programHint,
      searchableLower,
      searchableKey,
      searchableTokens,
      reasonPrefix: "program",
      exactBoost: 0.2,
      partialBoost: 0.14,
      tokenBoost: 0.03,
      tokenBoostCap: 0.12,
    });
    confidence += programScore.boost;
    reasonParts.push(...programScore.reasons);

    const variationScore = scoreHintText({
      hint: params.variationHint,
      searchableLower,
      searchableKey,
      searchableTokens,
      reasonPrefix: "parallel",
      exactBoost: 0.25,
      partialBoost: 0.18,
      tokenBoost: 0.035,
      tokenBoostCap: 0.15,
    });
    confidence += variationScore.boost;
    reasonParts.push(...variationScore.reasons);

    if (denominatorRegex) {
      if (denominatorRegex.test(searchableText)) {
        confidence += 0.22;
        reasonParts.push("numbered-denominator");
      } else if (hasAnyDenominator.test(searchableText)) {
        confidence -= 0.05;
        reasonParts.push("numbered-mismatch");
      }
    }

    confidence = Math.min(0.97, Math.max(0.05, confidence));

    return {
      parallelId: variant.parallelId,
      confidence: Number(confidence.toFixed(3)),
      reason: Array.from(new Set(reasonParts)).join("|"),
    };
  });

  return sortCandidates(candidates).slice(0, MAX_CANDIDATES);
}

async function buildEmbeddingCandidates(params: {
  variants: VariantRow[];
  cardVectors: number[][];
  targetDenominator: string | null;
  taxonomyScoped: boolean;
}): Promise<VariantCandidate[]> {
  if (params.variants.length < 1) {
    return [];
  }

  const denominatorRegex = params.targetDenominator
    ? new RegExp(`/\\s*${escapeRegExp(params.targetDenominator)}\\b`, "i")
    : null;
  const candidates: VariantCandidate[] = [];

  for (const variant of params.variants) {
    const variantCardNumber = sanitizeMatcherText(variant.cardNumber) || "ALL";
    const referenceWhere: any =
      variantCardNumber.toUpperCase() === "ALL"
        ? { setId: variant.setId, programId: variant.programId, parallelId: variant.parallelId }
        : {
            setId: variant.setId,
            programId: variant.programId,
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
        for (const cardVec of params.cardVectors) {
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
    const reasonParts = params.taxonomyScoped ? ["cosine", "taxonomy-scope"] : ["cosine"];
    if (denominatorRegex && denominatorRegex.test(buildVariantSearchableText(variant))) {
      confidence = Math.min(1, confidence + 0.03);
      reasonParts.push("numbered-denominator-boost");
    }

    candidates.push({
      parallelId: variant.parallelId,
      confidence: Number(confidence.toFixed(3)),
      reason: reasonParts.join("|"),
    });
  }

  return sortCandidates(candidates).slice(0, MAX_CANDIDATES);
}

export async function runVariantMatch(params: {
  cardAssetId: string;
  setId: string;
  cardNumber?: string | null;
  numbered?: string | null;
  program?: string | null;
  variation?: string | null;
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

  const taxonomyFlags = readTaxonomyV2Flags();
  const setCandidates = await resolveSetIdCandidates(setInput);
  if (setCandidates.length === 0) {
    return { ok: false, message: "No variant set found for supplied set name" };
  }
  const scopedSetCandidates = await filterScopeSetCandidates(setCandidates, taxonomyFlags.allowLegacyFallback);
  if (scopedSetCandidates.length === 0) {
    return { ok: false, message: "No in-scope variant set found for supplied set name" };
  }

  let matchedSetId = "";
  let variants: VariantRow[] = [];
  for (const setId of scopedSetCandidates) {
    const rows = await findVariants({
      setId,
      programId: params.program,
      cardNumber: cardNumberInput === "ALL" ? "" : cardNumberInput,
    });
    if (rows.length > 0) {
      matchedSetId = setId;
      variants = rows.map((row) => ({
        setId: row.setId,
        programId: row.programId,
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

  let taxonomyScoped = false;
  if (taxonomyFlags.matcher) {
    const scope = await resolveTaxonomyScopeForMatcher({
      setId: matchedSetId,
      program: params.program,
      variation: params.variation,
      cardNumber: cardNumberInput,
    });
    if (!scope.hasTaxonomy && !taxonomyFlags.allowLegacyFallback) {
      return {
        ok: false,
        message: "Taxonomy V2 scope is required for matcher cutover; no taxonomy scope found for set",
        matchedSetId,
        matchedCardNumber: cardNumberInput,
      };
    }
    if (scope.hasTaxonomy) {
      const allowedParallelKeys = new Set(scope.scopedParallelLabels.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean));
      if (allowedParallelKeys.size > 0) {
        variants = variants.filter((variant) => allowedParallelKeys.has(String(variant.parallelId || "").trim().toLowerCase()));
        taxonomyScoped = true;
      } else {
        if (taxonomyFlags.allowLegacyFallback) {
          taxonomyScoped = false;
        } else {
          return {
            ok: false,
            message: "No in-scope taxonomy candidates for resolved set/program/card",
            matchedSetId,
            matchedCardNumber: cardNumberInput,
          };
        }
      }
    }
  }

  if (!variants.length) {
    return {
      ok: false,
      message: "No variants left after taxonomy scope filtering",
      matchedSetId,
      matchedCardNumber: cardNumberInput,
    };
  }

  const tiltPhoto = cardAsset.photos?.find((photo) => photo.kind === "TILT")?.imageUrl ?? null;
  const foilSourceUrl = tiltPhoto || cardAsset.imageUrl;
  const foilScore = await computeFoilScore(foilSourceUrl);
  const targetDenominator = extractDenominator(numberedInput);
  const embeddingService = sanitizeMatcherText(process.env.VARIANT_EMBEDDING_URL);
  let candidates: VariantCandidate[] = [];

  if (!embeddingService) {
    candidates = buildMetadataFallbackCandidates({
      variants,
      cardNumber: cardNumberInput,
      programHint: params.program,
      variationHint: params.variation,
      targetDenominator,
      taxonomyScoped,
      fallbackReason: "embedding-missing",
    });
  } else {
    try {
      const embedRes = await fetch(embeddingService, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: cardAsset.imageUrl, mode: "card" }),
      });
      const embedPayload = await embedRes.json().catch(() => null);
      const cardVectors: number[][] = Array.isArray(embedPayload?.embeddings)
        ? embedPayload.embeddings.map((entry: any) => entry.vector).filter((vec: any) => Array.isArray(vec))
        : [];

      if (cardVectors.length > 0) {
        candidates = await buildEmbeddingCandidates({
          variants,
          cardVectors,
          targetDenominator,
          taxonomyScoped,
        });
      } else {
        candidates = buildMetadataFallbackCandidates({
          variants,
          cardNumber: cardNumberInput,
          programHint: params.program,
          variationHint: params.variation,
          targetDenominator,
          taxonomyScoped,
          fallbackReason: embedRes.ok ? "embedding-empty" : "embedding-unavailable",
        });
      }
    } catch {
      candidates = buildMetadataFallbackCandidates({
        variants,
        cardNumber: cardNumberInput,
        programHint: params.program,
        variationHint: params.variation,
        targetDenominator,
        taxonomyScoped,
        fallbackReason: "embedding-unavailable",
      });
    }
  }

  if (candidates.length < 1) {
    return {
      ok: false,
      message: "No variant candidates could be ranked",
      matchedSetId,
      matchedCardNumber: cardNumberInput,
    };
  }

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
