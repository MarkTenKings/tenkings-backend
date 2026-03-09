import { prisma, type Prisma } from "@tenkings/database";
import { parseClassificationPayload } from "@tenkings/shared";
import { normalizeProgramId } from "./taxonomyV2Utils";

const SET_REFERENCE_PARALLEL_ID = "__SET_REFERENCE__";
const TRUSTED_QA_STATUS = "keep";
const SKIP_PARALLEL_IDS = new Set(["", "none", "unknown", "base"]);

type ReviewCompImage = {
  sourceUrl: string;
  rawImageUrl: string;
  title: string | null;
  sourceListingId: string | null;
};

function normalizeText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text ? text : null;
}

function normalizeCompUrl(value: string | null | undefined): string {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return text.toLowerCase();
  }
}

function parseListingId(value: string | null | undefined): string | null {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const pathMatch = text.match(/\/itm\/(?:[^/?#]+\/)?(\d{8,20})(?:[/?#]|$)/i);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }
  const queryMatch = text.match(/[?&](?:item|itemId|itm|itm_id)=(\d{8,20})(?:[&#]|$)/i);
  return queryMatch?.[1] ?? null;
}

function normalizeReviewParallelId(value: string | null | undefined): string | null {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  return SKIP_PARALLEL_IDS.has(text.toLowerCase()) ? null : text;
}

function buildPairKey(params: {
  setId: string;
  programId: string;
  parallelId: string;
  cardNumber: string | null;
  sourceListingId: string | null;
  sourceUrl: string;
}) {
  const sourceIdentity = params.sourceListingId || normalizeCompUrl(params.sourceUrl) || params.sourceUrl;
  return [
    "review",
    params.setId,
    params.programId,
    params.parallelId,
    params.cardNumber || "ALL",
    sourceIdentity,
  ].join("::");
}

async function loadReviewCompImages(cardAssetId: string): Promise<ReviewCompImage[]> {
  const [evidenceItems, jobs] = await Promise.all([
    prisma.cardEvidenceItem.findMany({
      where: {
        cardAssetId,
        kind: "SOLD_COMP",
      },
      orderBy: { createdAt: "asc" },
      select: {
        title: true,
        url: true,
        screenshotUrl: true,
      },
    }),
    prisma.bytebotLiteJob.findMany({
      where: { cardAssetId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        result: true,
      },
    }),
  ]);

  const jobCompByKey = new Map<
    string,
    {
      title: string | null;
      url: string;
      screenshotUrl: string | null;
      listingImageUrl: string | null;
    }
  >();

  jobs.forEach((job) => {
    const result = job.result as
      | {
          sources?: Array<{
            comps?: Array<{
              title?: string | null;
              url?: string | null;
              screenshotUrl?: string | null;
              listingImageUrl?: string | null;
            }>;
          }>;
        }
      | null;
    result?.sources?.forEach((source) => {
      source.comps?.forEach((comp) => {
        const url = normalizeText(comp.url);
        if (!url) {
          return;
        }
        const key = normalizeCompUrl(url);
        if (!key || jobCompByKey.has(key)) {
          return;
        }
        jobCompByKey.set(key, {
          title: normalizeText(comp.title),
          url,
          screenshotUrl: normalizeText(comp.screenshotUrl),
          listingImageUrl: normalizeText(comp.listingImageUrl),
        });
      });
    });
  });

  const images: ReviewCompImage[] = [];
  const seen = new Set<string>();

  evidenceItems.forEach((item) => {
    const sourceUrl = normalizeText(item.url);
    if (!sourceUrl) {
      return;
    }
    const key = normalizeCompUrl(sourceUrl);
    const matchedJobComp = key ? jobCompByKey.get(key) ?? null : null;
    const rawImageUrl =
      normalizeText(matchedJobComp?.listingImageUrl) ||
      normalizeText(matchedJobComp?.screenshotUrl) ||
      normalizeText(item.screenshotUrl);
    if (!rawImageUrl) {
      return;
    }
    const dedupeKey = `${key || sourceUrl}::${rawImageUrl}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    images.push({
      sourceUrl,
      rawImageUrl,
      title: normalizeText(matchedJobComp?.title) || normalizeText(item.title),
      sourceListingId: parseListingId(matchedJobComp?.url || sourceUrl),
    });
  });

  return images;
}

export async function seedTrustedReferencesFromInventoryReady(params: { cardAssetId: string }) {
  const card = await prisma.cardAsset.findUnique({
    where: { id: params.cardAssetId },
    select: {
      id: true,
      variantId: true,
      customTitle: true,
      resolvedPlayerName: true,
      classificationJson: true,
    },
  });

  if (!card) {
    return { created: 0, skipped: 0, reason: "card_not_found" as const };
  }

  const classification = parseClassificationPayload(card.classificationJson);
  const attributes = classification?.attributes ?? null;
  const normalized = classification?.normalized ?? null;

  const setId = normalizeText(normalized?.setName || attributes?.setName);
  if (!setId) {
    return { created: 0, skipped: 0, reason: "missing_set" as const };
  }

  const programId = normalizeProgramId(normalizeText(normalized?.setCode) || "base");
  const cardNumber = normalizeText(normalized?.cardNumber) || "ALL";
  const playerSeed =
    normalizeText(normalized?.sport?.playerName) ||
    normalizeText(attributes?.playerName) ||
    normalizeText(normalized?.displayName) ||
    normalizeText(card.resolvedPlayerName) ||
    normalizeText(card.customTitle);
  const parallelId =
    normalizeReviewParallelId(card.variantId) ||
    normalizeReviewParallelId(Array.isArray(attributes?.variantKeywords) ? attributes?.variantKeywords[0] : null);

  const compImages = await loadReviewCompImages(card.id);
  if (compImages.length < 1) {
    return { created: 0, skipped: 0, reason: "no_comp_images" as const };
  }

  const candidateRows: Prisma.CardVariantReferenceImageCreateManyInput[] = [];
  compImages.forEach((comp) => {
    candidateRows.push({
      setId,
      programId,
      cardNumber: "ALL",
      parallelId: SET_REFERENCE_PARALLEL_ID,
      refType: "front",
      pairKey: buildPairKey({
        setId,
        programId,
        parallelId: SET_REFERENCE_PARALLEL_ID,
        cardNumber: "ALL",
        sourceListingId: comp.sourceListingId,
        sourceUrl: comp.sourceUrl,
      }),
      sourceListingId: comp.sourceListingId,
      playerSeed,
      qaStatus: TRUSTED_QA_STATUS,
      ownedStatus: "external",
      sourceUrl: comp.sourceUrl,
      listingTitle: comp.title,
      rawImageUrl: comp.rawImageUrl,
      cropUrls: [],
      qualityScore: null,
    });

    if (!parallelId) {
      return;
    }

    candidateRows.push({
      setId,
      programId,
      cardNumber,
      parallelId,
      refType: "front",
      pairKey: buildPairKey({
        setId,
        programId,
        parallelId,
        cardNumber,
        sourceListingId: comp.sourceListingId,
        sourceUrl: comp.sourceUrl,
      }),
      sourceListingId: comp.sourceListingId,
      playerSeed,
      qaStatus: TRUSTED_QA_STATUS,
      ownedStatus: "external",
      sourceUrl: comp.sourceUrl,
      listingTitle: comp.title,
      rawImageUrl: comp.rawImageUrl,
      cropUrls: [],
      qualityScore: null,
    });
  });

  const pairKeys = candidateRows.map((row) => String(row.pairKey || "").trim()).filter(Boolean);
  if (pairKeys.length < 1) {
    return { created: 0, skipped: candidateRows.length, reason: "no_pair_keys" as const };
  }

  const existing = await prisma.cardVariantReferenceImage.findMany({
    where: {
      pairKey: {
        in: pairKeys,
      },
    },
    select: {
      pairKey: true,
    },
  });
  const existingKeys = new Set(
    existing.map((row) => String(row.pairKey || "").trim()).filter(Boolean)
  );
  const rowsToCreate = candidateRows.filter((row) => !existingKeys.has(String(row.pairKey || "").trim()));
  if (rowsToCreate.length < 1) {
    return { created: 0, skipped: candidateRows.length, reason: "already_seeded" as const };
  }

  const result = await prisma.cardVariantReferenceImage.createMany({
    data: rowsToCreate,
  });

  return {
    created: Number(result.count ?? 0),
    skipped: Math.max(0, candidateRows.length - Number(result.count ?? 0)),
    reason: null,
  };
}

export { SET_REFERENCE_PARALLEL_ID };
