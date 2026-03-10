import { prisma, type Prisma } from "@tenkings/database";
import { parseClassificationPayload } from "@tenkings/shared";
import { normalizeProgramId } from "./taxonomyV2Utils";

const SET_REFERENCE_PARALLEL_ID = "__SET_REFERENCE__";
const TRUSTED_QA_STATUS = "keep";
const SKIP_PARALLEL_IDS = new Set(["", "none", "unknown", "base"]);
const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const EBAY_PRODUCT_ENGINE = "ebay_product";

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

function sourceHostFromUrl(value: string | null | undefined): string {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  try {
    return new URL(text).hostname.trim().toLowerCase();
  } catch {
    return "";
  }
}

function isEbaySourceUrl(value: string | null | undefined): boolean {
  const host = sourceHostFromUrl(value);
  return host === "ebay.com" || host.endsWith(".ebay.com");
}

function collectHttpUrls(value: unknown, urls: string[], visited: Set<unknown>) {
  if (!value) return;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^https?:\/\//i.test(normalized)) {
      urls.push(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectHttpUrls(entry, urls, visited);
    }
    return;
  }
  if (typeof value === "object") {
    if (visited.has(value)) return;
    visited.add(value);
    const record = value as Record<string, unknown>;
    collectHttpUrls(record.link, urls, visited);
    collectHttpUrls(record.url, urls, visited);
    collectHttpUrls(record.src, urls, visited);
    collectHttpUrls(record.image, urls, visited);
    collectHttpUrls(record.images, urls, visited);
    collectHttpUrls(record.image_url, urls, visited);
    collectHttpUrls(record.imageUrl, urls, visited);
    for (const nested of Object.values(record)) {
      collectHttpUrls(nested, urls, visited);
    }
  }
}

function parseEbayImageSize(url: string) {
  const match = url.match(/(?:^|[/?._-])s-l(\d{2,5})(?:[._/?-]|$)/i);
  if (!match?.[1]) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function upscaleEbayImageUrl(url: string) {
  const size = parseEbayImageSize(url);
  if (size <= 0 || size >= 1600) return url;
  return url.replace(/s-l\d{2,5}/gi, "s-l1600");
}

function bestImageUrl(value: unknown): string {
  if (!value) return "";
  const urls: string[] = [];
  collectHttpUrls(value, urls, new Set<unknown>());
  if (urls.length === 0) return "";
  let best = "";
  let bestScore = -1;
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const score = parseEbayImageSize(url);
    if (score > bestScore) {
      best = url;
      bestScore = score;
    }
  }
  return best ? upscaleEbayImageUrl(best) : "";
}

function firstProductMediaImageUrl(payload: any) {
  const productResults = payload?.product_results ?? payload ?? {};
  const mediaEntries = Array.isArray(productResults?.media) ? productResults.media : [];
  for (const mediaEntry of mediaEntries) {
    const candidate = bestImageUrl(mediaEntry?.image ?? mediaEntry);
    if (candidate) {
      return candidate;
    }
  }
  return "";
}

function firstProductImageUrl(payload: any) {
  const productResults = payload?.product_results ?? payload ?? {};
  return (
    firstProductMediaImageUrl(payload) ||
    bestImageUrl(productResults?.image) ||
    bestImageUrl(productResults?.images) ||
    bestImageUrl(productResults?.product?.image) ||
    bestImageUrl(productResults?.product?.images) ||
    ""
  );
}

function serpApiErrorMessage(payload: any) {
  return String(
    payload?.error ||
      payload?.message ||
      payload?.errors?.[0]?.message ||
      payload?.errors?.[0] ||
      ""
  ).trim();
}

async function fetchEbayProductImageUrl(options: {
  apiKey: string;
  productId: string;
}) {
  const params = new URLSearchParams({
    engine: EBAY_PRODUCT_ENGINE,
    product_id: options.productId,
    api_key: options.apiKey,
  });
  const response = await fetch(`${SERPAPI_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    return "";
  }
  const payload = await response.json().catch(() => null);
  const errorMessage = serpApiErrorMessage(payload);
  if (errorMessage && !/hasn'?t returned any results|no results/i.test(errorMessage)) {
    return "";
  }
  const metadataStatus = String(payload?.search_metadata?.status || "").trim();
  if (metadataStatus && metadataStatus !== "Success") {
    return "";
  }
  return firstProductImageUrl(payload);
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

async function upgradeReviewCompImagesToHd(images: ReviewCompImage[]): Promise<ReviewCompImage[]> {
  const apiKey = process.env.SERPAPI_KEY ?? "";
  if (!apiKey || images.length < 1) {
    return images;
  }

  const productImageCache = new Map<string, string>();
  const upgradedImages: ReviewCompImage[] = [];

  // Keep KingsReview on fast thumbnails; only upgrade selected eBay comps during Inventory Ready seeding.
  for (const image of images) {
    if (!image.sourceListingId || !isEbaySourceUrl(image.sourceUrl)) {
      upgradedImages.push(image);
      continue;
    }

    let upgradedImageUrl = productImageCache.get(image.sourceListingId);
    if (upgradedImageUrl === undefined) {
      upgradedImageUrl = await fetchEbayProductImageUrl({
        apiKey,
        productId: image.sourceListingId,
      }).catch(() => "");
      productImageCache.set(image.sourceListingId, upgradedImageUrl);
    }

    upgradedImages.push(
      upgradedImageUrl
        ? {
            ...image,
            rawImageUrl: upgradedImageUrl,
          }
        : image
    );
  }

  return upgradedImages;
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

  const compImages = await upgradeReviewCompImagesToHd(await loadReviewCompImages(card.id));
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
