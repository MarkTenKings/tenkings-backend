import { prisma } from "@tenkings/database";
import { normalizeCardNumber, normalizeParallelLabel, normalizePlayerSeed, normalizeSetLabel } from "@tenkings/shared";
import { normalizeProgramId } from "./taxonomyV2Utils";

type SeedListingCandidate = {
  sourceUrl: string | null;
  sourceListingId: string | null;
  sourceProductId: string | null;
  listingTitle: string | null;
  fallbackImageUrl: string;
  score: number;
};

export type SeedReferenceInput = {
  setId: string;
  programId?: string | null;
  cardNumber?: string | null;
  parallelId: string;
  playerSeed?: string | null;
  query: string;
  limit?: number | null;
  tbs?: string | null;
  gl?: string | null;
  hl?: string | null;
};

export type SeedReferenceResult = {
  inserted: number;
  skipped: number;
  reasonCounts: SeedReferenceReasonCounts;
};

export type SeedReferenceReasonCounts = {
  no_hits: number;
  no_media: number;
  filtered_out: number;
  network: number;
};

export class ReferenceSeedError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ReferenceSeedError";
    this.status = status;
  }
}

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const EBAY_ENGINE = "ebay";
const EBAY_PRODUCT_ENGINE = "ebay_product";
const MIN_ACCEPTABLE_IMAGE_SIZE = 300;
const PRODUCT_IMAGE_CACHE_MAX = 20_000;
const PRODUCT_IMAGE_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const NOISE_TITLE_TOKENS = [
  "box",
  "blaster",
  "hobby",
  "case",
  "break",
  "pack",
  "lot",
  "mega box",
  "hanger",
];
const PARALLEL_ALIAS_TO_CANONICAL: Record<string, string> = {
  SI: "SUDDEN IMPACT",
  FS: "FILM STUDY",
  RR: "ROUNDBALL ROYALTY",
  FSA: "FUTURE STARS AUTOGRAPHS",
  CA: "CERTIFIED AUTOGRAPHS",
  PB: "POWER BOOSTERS",
  DNA: "DNA",
};
const CARD_PREFIX_PARALLEL_MAP: Record<string, string> = {
  SI: "SUDDEN IMPACT",
  FS: "FILM STUDY",
  RR: "ROUNDBALL ROYALTY",
  FSA: "FUTURE STARS AUTOGRAPHS",
  CA: "CERTIFIED AUTOGRAPHS",
  PB: "POWER BOOSTERS",
  DNA: "DNA",
};
const ROOKIE_PARALLEL_RE = /^(rookie|rc)(?:\s+cards?)?$/i;

type CachedProductImage = {
  imageUrl: string | null;
  cachedAt: number;
};

const productImageCache = new Map<string, CachedProductImage>();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function serpRetryDelayMs(attempt: number, statusCode: number | null, reason: "http" | "rate" | "server") {
  const base =
    statusCode === 429 || reason === "rate"
      ? 900
      : reason === "server"
        ? 600
        : 350;
  const jitter = Math.floor(Math.random() * 250);
  const exponential = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(6000, exponential + jitter);
}

function emptyReasonCounts(): SeedReferenceReasonCounts {
  return {
    no_hits: 0,
    no_media: 0,
    filtered_out: 0,
    network: 0,
  };
}

function pruneProductImageCache() {
  if (productImageCache.size <= PRODUCT_IMAGE_CACHE_MAX) return;
  const overflow = productImageCache.size - PRODUCT_IMAGE_CACHE_MAX;
  let removed = 0;
  for (const key of productImageCache.keys()) {
    productImageCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function getCachedProductImage(productId: string) {
  const key = String(productId || "").trim();
  if (!key) return undefined;
  const cached = productImageCache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.cachedAt > PRODUCT_IMAGE_CACHE_TTL_MS) {
    productImageCache.delete(key);
    return undefined;
  }
  return cached.imageUrl;
}

function setCachedProductImage(productId: string, imageUrl: string | null) {
  const key = String(productId || "").trim();
  if (!key) return;
  productImageCache.set(key, {
    imageUrl: imageUrl ? String(imageUrl).trim() : null,
    cachedAt: Date.now(),
  });
  pruneProductImageCache();
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9#/\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string | null | undefined) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function parseEbayListingId(url: string | null | undefined) {
  const value = String(url || "").trim();
  if (!value) return null;
  const pathMatch = value.match(/\/itm\/(?:[^/?#]+\/)?(\d{8,20})(?:[/?#]|$)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const queryMatch = value.match(/[?&](?:item|itemId|itm|itm_id)=(\d{8,20})(?:[&#]|$)/i);
  if (queryMatch?.[1]) return queryMatch[1];
  return null;
}

function parseSerpProductId(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{8,20}$/.test(raw)) return raw;
  const queryMatch = raw.match(/[?&]product_id=(\d{8,20})(?:[&#]|$)/i);
  if (queryMatch?.[1]) return queryMatch[1];
  return null;
}

function canonicalEbayListingUrl(url: string | null | undefined) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  const listingId = /^\d{8,20}$/.test(raw) ? raw : parseEbayListingId(raw);
  if (!listingId) return null;
  return `https://www.ebay.com/itm/${listingId}`;
}

function upgradeEbayImageUrl(url: string) {
  const normalized = String(url || "").trim();
  if (!normalized) return "";
  // eBay CDN image paths often include an s-l### token that can be upgraded to larger sizes.
  if (/i\.ebayimg\.com/i.test(normalized)) {
    return normalized.replace(/s-l\d{2,4}/gi, "s-l1600");
  }
  return normalized;
}

function isThumbnailLike(url: string) {
  const lower = String(url || "").trim().toLowerCase();
  if (!lower) return false;
  const sizeToken = lower.match(/s-l(\d{2,4})/i);
  if (sizeToken?.[1]) {
    const size = Number(sizeToken[1]);
    // eBay image urls frequently include "thumbs" in the path even for usable listing media.
    // Treat explicit medium/large sizes as usable regardless of path tokens.
    if (Number.isFinite(size) && size >= MIN_ACCEPTABLE_IMAGE_SIZE) return false;
    if (Number.isFinite(size) && size > 0 && size < MIN_ACCEPTABLE_IMAGE_SIZE) return true;
  }
  if (/(^|[/?._-])(thumb|thumbnail|small|tiny)($|[/?._-])/.test(lower)) return true;
  return false;
}

function dedupeUrls(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function flattenUrlValues(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenUrlValues(entry));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((entry) => flattenUrlValues(entry));
  }
  return [];
}

function extractImageSizeToken(url: string) {
  const sizeToken = String(url || "").trim().match(/s-l(\d{2,4})/i);
  if (!sizeToken?.[1]) return 0;
  const parsed = Number(sizeToken[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractProductMediaUrls(payload: any) {
  const productResults = payload?.product_results ?? payload ?? {};
  const mediaEntries = Array.isArray(productResults?.media) ? productResults.media : [];
  const urls: Array<{ url: string; sizeHint: number }> = [];

  for (const mediaEntry of mediaEntries) {
    const imageEntries = Array.isArray(mediaEntry?.image)
      ? mediaEntry.image
      : mediaEntry?.image
        ? [mediaEntry.image]
        : [];
    for (const imageEntry of imageEntries) {
      if (typeof imageEntry === "string") {
        urls.push({ url: imageEntry, sizeHint: extractImageSizeToken(imageEntry) });
        continue;
      }
      const link = String(imageEntry?.link || "").trim();
      if (!link) continue;
      const width = Number(imageEntry?.size?.width ?? 0);
      const height = Number(imageEntry?.size?.height ?? 0);
      const sizeHint = Math.max(
        Number.isFinite(width) ? width : 0,
        Number.isFinite(height) ? height : 0,
        extractImageSizeToken(link)
      );
      urls.push({ url: link, sizeHint });
    }
  }

  return urls;
}

function pickProductImageUrl(payload: any) {
  const productResults = payload?.product_results ?? payload ?? {};
  const mediaUrls = extractProductMediaUrls(payload);
  const candidateUrls = dedupeUrls([
    ...mediaUrls.map((entry) => entry.url),
    ...flattenUrlValues(productResults?.image),
    ...flattenUrlValues(productResults?.images),
    ...flattenUrlValues(productResults?.product?.image),
    ...flattenUrlValues(productResults?.product?.images),
    ...flattenUrlValues(productResults?.thumbnail),
    ...flattenUrlValues(productResults?.thumbnail_images),
  ]);

  const mediaSizeHints = new Map<string, number>();
  for (const entry of mediaUrls) {
    const key = String(entry.url || "").trim().toLowerCase();
    if (!key) continue;
    const previous = mediaSizeHints.get(key) ?? 0;
    mediaSizeHints.set(key, Math.max(previous, Number(entry.sizeHint) || 0));
  }

  const ranked = candidateUrls
    .map((value) => {
      const rawUrl = String(value || "").trim();
      if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return null;
      const upgraded = upgradeEbayImageUrl(rawUrl);
      if (isThumbnailLike(upgraded)) return null;
      const mediaSizeHint = mediaSizeHints.get(rawUrl.toLowerCase()) ?? 0;
      const sizeToken = extractImageSizeToken(rawUrl);
      return {
        upgraded,
        size: Math.max(mediaSizeHint, sizeToken),
      };
    })
    .filter((entry): entry is { upgraded: string; size: number } => Boolean(entry))
    .sort((a, b) => b.size - a.size);

  return ranked[0]?.upgraded || "";
}

function pickImageUrl(result: any) {
  // Hard requirement: use only main/high-res listing images for reference seeding.
  // Thumbnail-origin fields are allowed only when they can be upgraded to high-res.
  const candidates = [
    result?.original_image,
    result?.main_image,
    result?.image,
    result?.image_url,
    result?.product?.image,
    result?.img,
    result?.gallery_url,
    result?.thumbnail,
    Array.isArray(result?.thumbnails) ? result.thumbnails[0] : null,
    Array.isArray(result?.thumbnail_images) ? result.thumbnail_images[0] : null,
    Array.isArray(result?.images) ? result.images[0] : null,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    const upgraded = upgradeEbayImageUrl(value);
    if (!isThumbnailLike(upgraded)) return upgraded;
  }
  return "";
}

function extractListings(data: any) {
  if (Array.isArray(data?.organic_results)) return data.organic_results;
  if (Array.isArray(data?.search_results)) return data.search_results;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items_results)) return data.items_results;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function dedupeQueries(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

type SearchQueryStage = {
  stage: "strict" | "medium" | "loose";
  queries: string[];
};

async function fetchSerpApiPayload(
  queryParams: URLSearchParams,
  options: {
    allowNoResults?: boolean;
  } = {}
) {
  const allowNoResults = options.allowNoResults === true;
  let requestError = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${SERPAPI_ENDPOINT}?${queryParams.toString()}`);
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        requestError = `SerpApi request failed (${response.status})${bodyText ? `: ${bodyText.slice(0, 180)}` : ""}`;
        if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
          await wait(
            serpRetryDelayMs(
              attempt,
              response.status,
              response.status === 429 ? "rate" : "server"
            )
          );
          continue;
        }
        throw new ReferenceSeedError(502, requestError);
      }

      const payload = await response.json();
      const topLevelError = String(
        payload?.error ||
          payload?.message ||
          payload?.errors?.[0]?.message ||
          payload?.errors?.[0] ||
          ""
      ).trim();
      if (topLevelError) {
        const noResults = /hasn'?t returned any results|no results/i.test(topLevelError);
        if (allowNoResults && noResults) {
          return { payload: { organic_results: [] }, noResults: true };
        }
        requestError = topLevelError;
        const retryable = /rate|limit|timeout|temporar|try again|busy|thrott|quota|capacity/i.test(requestError);
        if (attempt < 3 && retryable) {
          await wait(serpRetryDelayMs(attempt, null, "rate"));
          continue;
        }
        throw new ReferenceSeedError(502, requestError);
      }

      const metadataStatus = String(payload?.search_metadata?.status || "").trim();
      if (metadataStatus && metadataStatus !== "Success") {
        requestError = String(payload?.search_metadata?.error || "SerpApi returned error.").trim();
        const retryable = /rate|limit|timeout|temporar|try again|busy|thrott/i.test(requestError);
        if (attempt < 3 && retryable) {
          await wait(serpRetryDelayMs(attempt, null, "rate"));
          continue;
        }
        throw new ReferenceSeedError(502, requestError || "SerpApi returned error.");
      }

      return { payload, noResults: false };
    } catch (error) {
      if (error instanceof ReferenceSeedError) {
        throw error;
      }
      requestError = error instanceof Error ? error.message : "SerpApi request failed.";
      if (attempt < 3) {
        await wait(serpRetryDelayMs(attempt, null, "http"));
        continue;
      }
      throw new ReferenceSeedError(502, requestError);
    }
  }

  throw new ReferenceSeedError(502, requestError || "SerpApi request failed.");
}

export function primarySeedPlayerLabel(value: string | null | undefined) {
  const raw = String(value || "").split("::")[0]?.trim() || "";
  if (!raw) return "";
  const slashSplit = raw.split("/")[0]?.trim() || raw;
  return slashSplit.replace(/\s+/g, " ").trim();
}

function inferParallelFromCardNumber(cardNumber: string | null | undefined) {
  const raw = String(cardNumber || "").trim().toUpperCase();
  if (!raw || raw === "ALL") return "";
  const compact = raw.replace(/\s+/g, "");
  const prefix = compact.split("-")[0] || "";
  return CARD_PREFIX_PARALLEL_MAP[prefix] || "";
}

export function canonicalSeedParallel(parallelValue: string | null | undefined, cardNumber: string | null | undefined) {
  const normalized = normalizeParallelLabel(parallelValue);
  const inferred = inferParallelFromCardNumber(cardNumber);
  if (!normalized || ROOKIE_PARALLEL_RE.test(normalized)) {
    return inferred || "";
  }
  const alias = PARALLEL_ALIAS_TO_CANONICAL[normalized.toUpperCase()];
  return alias || normalized;
}

export function buildReferenceSeedQuery(params: {
  setId: string;
  cardNumber: string | null | undefined;
  cardType?: string | null | undefined;
  parallelId: string;
  playerSeed: string | null | undefined;
}) {
  const cleanedSetId = String(params.setId || "")
    .replace(/\bretail\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const cleanedPlayer = primarySeedPlayerLabel(params.playerSeed);
  const cleanedCardType = String(params.cardType || "").replace(/\s+/g, " ").trim();
  const normalizedCardNumber = normalizeCardNumber(String(params.cardNumber ?? "")) || "ALL";
  const cardToken = normalizedCardNumber !== "ALL" ? `#${normalizedCardNumber}` : "";
  const cleanedParallel = String(params.parallelId || "").trim();
  const parallelToken = /^base$/i.test(cleanedParallel) ? "" : cleanedParallel;
  return [cleanedPlayer, cleanedSetId, cleanedCardType, cardToken, parallelToken]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchQueryStages(params: {
  query: string;
  setId: string;
  cardNumber: string;
  parallelId: string;
  playerSeed: string;
}) {
  const baseQuery = String(params.query || "").replace(/\s+/g, " ").trim();
  const setClean = String(params.setId || "")
    .replace(/\bretail\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const player = primarySeedPlayerLabel(params.playerSeed);
  const parallel = String(params.parallelId || "").trim();
  const card = String(params.cardNumber || "").trim().toUpperCase();
  const cardCompact = card ? card.replace(/[^A-Z0-9]/g, "") : "";
  const cardSpaced = card ? card.replace(/[-_]+/g, " ") : "";
  const cardHash = card && card !== "ALL" ? `#${card}` : "";
  const mk = (...parts: Array<string | null | undefined>) =>
    parts
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  const strict = dedupeQueries([
    baseQuery,
    mk(player, setClean, cardHash, parallel),
    mk(player, setClean, cardCompact, parallel),
    mk(player, setClean, cardSpaced, parallel),
    mk(setClean, cardHash, parallel),
    mk(setClean, cardCompact, parallel),
  ]).slice(0, 6);

  const medium = dedupeQueries([
    mk(player, setClean, parallel),
    mk(player, setClean, cardHash),
    mk(player, setClean, cardCompact),
    mk(setClean, parallel),
  ]).slice(0, 5);

  const loose = dedupeQueries([
    // Final fallback when set labels are noisy in source data.
    mk(player, cardHash, parallel),
    mk(player, cardCompact, parallel),
    mk(player, cardSpaced, parallel),
    mk(player, parallel),
    mk(cardHash, parallel),
  ]).slice(0, 5);

  const stages: SearchQueryStage[] = [];
  if (strict.length) stages.push({ stage: "strict", queries: strict });
  if (medium.length) stages.push({ stage: "medium", queries: medium });
  if (loose.length) stages.push({ stage: "loose", queries: loose });
  return stages;
}

function selectEbayPageSize(limit: number) {
  const target = Math.max(1, Math.trunc(limit));
  if (target <= 25) return 25;
  if (target <= 50) return 50;
  if (target <= 100) return 100;
  return 200;
}

function scoreListing(params: {
  title: string;
  setId: string;
  parallelId: string;
  cardNumber: string;
  playerSeed: string;
}) {
  const title = normalizeText(params.title);
  if (!title) return -100;
  let score = 0;

  const player = normalizeText(params.playerSeed);
  if (player) {
    if (title.includes(player)) {
      score += 10;
    } else {
      const lastName = player.split(" ").filter(Boolean).slice(-1)[0] || "";
      if (lastName && title.includes(lastName)) {
        score += 5;
      } else {
        score -= 3;
      }
    }
  }

  const parallelTokens = tokenize(params.parallelId).slice(0, 5);
  for (const token of parallelTokens) {
    if (title.includes(token)) score += 2;
  }

  const setTokens = tokenize(params.setId).filter((token) =>
    /topps|chrome|prizm|optic|select|basketball|football|baseball|hockey|soccer|wrestling|rookie|\d{2,4}/.test(token)
  );
  for (const token of setTokens.slice(0, 6)) {
    if (title.includes(token)) score += 1;
  }

  const cardNumber = String(params.cardNumber || "").trim();
  if (cardNumber && cardNumber.toUpperCase() !== "ALL") {
    if (title.includes(`#${cardNumber.toLowerCase()}`)) {
      score += 3;
    } else if (new RegExp(`(^|\\s)${cardNumber.toLowerCase()}(\\s|$)`).test(title)) {
      score += 2;
    }
  }

  for (const token of NOISE_TITLE_TOKENS) {
    if (title.includes(token)) score -= 4;
  }

  return score;
}

export async function seedVariantReferenceImages(params: SeedReferenceInput): Promise<SeedReferenceResult> {
  const { setId, programId, cardNumber, parallelId, playerSeed, query, limit, tbs, gl, hl } = params;
  if (!setId || !parallelId || !query) {
    throw new ReferenceSeedError(400, "setId, parallelId, and query are required.");
  }

  const apiKey = process.env.SERPAPI_KEY ?? "";
  if (!apiKey) {
    throw new ReferenceSeedError(500, "SERPAPI_KEY is not configured on the server.");
  }

  const safeLimit = Math.min(50, Math.max(1, Number(limit ?? 20) || 20));
  const normalizedSetId = normalizeSetLabel(String(setId || "").trim());
  const normalizedProgramId = normalizeProgramId(String(programId || "").trim() || "base");
  const normalizedCardNumber = normalizeCardNumber(String(cardNumber ?? "")) || "ALL";
  const normalizedParallelId = canonicalSeedParallel(String(parallelId || "").trim(), normalizedCardNumber);
  const normalizedPlayerSeed = normalizePlayerSeed(String(playerSeed || "").trim());
  const normalizedQuery = String(query || "").trim();

  if (!normalizedQuery) {
    throw new ReferenceSeedError(400, "query is required.");
  }

  if (!normalizedSetId || !normalizedParallelId) {
    throw new ReferenceSeedError(400, "setId and parallelId must normalize to non-empty values.");
  }

  const aggregatedListings: any[] = [];
  const aggregatedListingKeys = new Set<string>();
  const maxAggregatedListings = Math.max(80, safeLimit * 20);
  const desiredListingCount = Math.min(maxAggregatedListings, Math.max(40, safeLimit * 8));
  const searchQueryStages = buildSearchQueryStages({
    query: normalizedQuery,
    setId: normalizedSetId,
    cardNumber: normalizedCardNumber,
    parallelId: normalizedParallelId,
    playerSeed: normalizedPlayerSeed,
  });

  for (const stage of searchQueryStages) {
    for (const searchQuery of stage.queries) {
      const queryParams = new URLSearchParams({
        engine: EBAY_ENGINE,
        _nkw: searchQuery,
        q: searchQuery,
        _sop: "12",
        _ipg: String(selectEbayPageSize(Math.max(200, safeLimit * 20))),
        api_key: apiKey,
      });
      if (tbs) queryParams.set("tbs", String(tbs).trim());
      if (gl) queryParams.set("gl", String(gl).trim());
      if (hl) queryParams.set("hl", String(hl).trim());

      const { payload: queryData } = await fetchSerpApiPayload(queryParams, {
        allowNoResults: true,
      });
      const queryListings = extractListings(queryData);
      for (const listing of queryListings) {
        const listingId =
          parseEbayListingId(
            listing?.link ||
              listing?.product_link ||
              listing?.url ||
              listing?.item_url ||
              listing?.view_item_url ||
              listing?.item_web_url ||
              listing?.product?.link ||
              null
          ) ||
          parseSerpProductId(listing?.product_id || null) ||
          parseSerpProductId(listing?.serpapi_link || null) ||
          null;
        const key =
          (listingId && `id:${listingId}`) ||
          (typeof listing?.link === "string" && listing.link.trim() ? `url:${listing.link.trim()}` : "") ||
          "";
        if (!key || aggregatedListingKeys.has(key)) continue;
        aggregatedListingKeys.add(key);
        aggregatedListings.push(listing);
        if (aggregatedListings.length >= maxAggregatedListings) break;
      }
      if (aggregatedListings.length >= maxAggregatedListings) break;
    }
    if (aggregatedListings.length >= desiredListingCount || aggregatedListings.length >= maxAggregatedListings) {
      break;
    }
    // Continue to broader query stage only if strict/medium stages did not return enough coverage.
    if (stage.stage === "loose") break;
  }

  if (aggregatedListings.length === 0) {
    return {
      inserted: 0,
      skipped: safeLimit,
      reasonCounts: {
        ...emptyReasonCounts(),
        no_hits: safeLimit,
      },
    };
  }

  const mappedCandidates = aggregatedListings
    .map((result: any) => {
      const rawSourceUrl = canonicalEbayListingUrl(
        result?.link ||
          result?.product_link ||
          result?.url ||
          result?.item_url ||
          result?.view_item_url ||
          result?.item_web_url ||
          result?.product?.link ||
          null
      );
      const sourceProductId =
        parseSerpProductId(result?.product_id || null) ||
        parseSerpProductId(result?.serpapi_link || null) ||
        parseSerpProductId(result?.link || null) ||
        null;
      const sourceListingId = parseEbayListingId(rawSourceUrl) || sourceProductId;
      const sourceUrl = rawSourceUrl || (sourceListingId ? canonicalEbayListingUrl(sourceListingId) : null);
      const fallbackImageUrl = pickImageUrl(result);
      const listingTitle = typeof result?.title === "string" ? String(result.title).trim() : null;
      const score = scoreListing({
        title: listingTitle || "",
        setId: normalizedSetId,
        parallelId: normalizedParallelId,
        cardNumber: normalizedCardNumber,
        playerSeed: normalizedPlayerSeed,
      });
      return {
        sourceUrl,
        sourceListingId,
        sourceProductId,
        fallbackImageUrl,
        listingTitle,
        score,
      } satisfies SeedListingCandidate;
    })
    .sort((a: SeedListingCandidate, b: SeedListingCandidate) => b.score - a.score);
  const listingCandidates = mappedCandidates.filter((row: SeedListingCandidate) => row.sourceUrl && row.sourceListingId);
  let filteredOutCandidates = Math.max(0, mappedCandidates.length - listingCandidates.length);

  const seenListing = new Set<string>();
  const seenImage = new Set<string>();
  const lookedUpProductIds = new Set<string>();
  const rows: Array<{
    setId: string;
    programId: string;
    cardNumber: string;
    parallelId: string;
    sourceListingId: string | null;
    playerSeed: string | null;
    listingTitle: string | null;
    rawImageUrl: string;
    sourceUrl: string | null;
  }> = [];
  let noMediaCandidates = 0;
  const maxProductLookups = Math.max(8, Math.min(24, safeLimit * 4));
  let productLookupCount = 0;

  for (const row of listingCandidates) {
    if (rows.length >= safeLimit) break;
    if (!row.sourceUrl || !row.sourceListingId) continue;
    if (seenListing.has(row.sourceListingId)) {
      filteredOutCandidates += 1;
      continue;
    }

    let rawImageUrl = "";
    const canLookupProduct = Boolean(row.sourceProductId) && productLookupCount < maxProductLookups;
    if (canLookupProduct && row.sourceProductId) {
      const cached = getCachedProductImage(row.sourceProductId);
      if (cached !== undefined) {
        rawImageUrl = cached || "";
      } else if (!lookedUpProductIds.has(row.sourceProductId)) {
        lookedUpProductIds.add(row.sourceProductId);
        productLookupCount += 1;
        const productParams = new URLSearchParams({
          engine: EBAY_PRODUCT_ENGINE,
          product_id: row.sourceProductId,
          api_key: apiKey,
        });
        try {
          const { payload } = await fetchSerpApiPayload(productParams, { allowNoResults: true });
          rawImageUrl = pickProductImageUrl(payload);
          setCachedProductImage(row.sourceProductId, rawImageUrl || null);
        } catch {
          rawImageUrl = "";
        }
      } else {
        rawImageUrl = "";
      }
    }

    if (!rawImageUrl) {
      rawImageUrl = row.fallbackImageUrl;
    }
    if (!rawImageUrl) {
      noMediaCandidates += 1;
      continue;
    }
    if (seenImage.has(rawImageUrl)) {
      filteredOutCandidates += 1;
      continue;
    }

    seenListing.add(row.sourceListingId);
    seenImage.add(rawImageUrl);
    rows.push({
      setId: normalizedSetId,
      programId: normalizedProgramId,
      cardNumber: normalizedCardNumber,
      parallelId: normalizedParallelId,
      sourceListingId: row.sourceListingId,
      playerSeed: normalizedPlayerSeed || null,
      listingTitle: row.listingTitle,
      rawImageUrl,
      sourceUrl: row.sourceUrl,
    });
  }

  if (rows.length === 0) {
    const reasonCounts = emptyReasonCounts();
    reasonCounts[noMediaCandidates > 0 ? "no_media" : "filtered_out"] = safeLimit;
    return { inserted: 0, skipped: safeLimit, reasonCounts };
  }

  const existingRows = await prisma.cardVariantReferenceImage.findMany({
    where: {
      setId: normalizedSetId,
      programId: normalizedProgramId,
      cardNumber: normalizedCardNumber,
      parallelId: normalizedParallelId,
      OR: [
        {
          sourceListingId: {
            in: rows
              .map((row: { sourceListingId: string | null }) => String(row.sourceListingId || "").trim())
              .filter(Boolean),
          },
        },
        {
          rawImageUrl: {
            in: rows.map((row: { rawImageUrl: string }) => row.rawImageUrl),
          },
        },
      ],
    },
    select: {
      sourceListingId: true,
      rawImageUrl: true,
    },
  });
  const existingUrls = new Set(existingRows.map((row: { rawImageUrl: string }) => row.rawImageUrl));
  const existingListingIds = new Set(
    existingRows
      .map((row: { sourceListingId?: string | null }) => String(row.sourceListingId || "").trim())
      .filter(Boolean)
  );
  const rowsToInsert = rows.filter((row: { rawImageUrl: string; sourceListingId: string | null }) => {
    if (existingUrls.has(row.rawImageUrl)) return false;
    const listingId = String(row.sourceListingId || "").trim();
    if (listingId && existingListingIds.has(listingId)) return false;
    return true;
  });

  if (rowsToInsert.length > 0) {
    await prisma.cardVariantReferenceImage.createMany({ data: rowsToInsert });
  }

  const reasonCounts = emptyReasonCounts();
  const duplicateSkips = rows.length - rowsToInsert.length;
  if (duplicateSkips > 0) {
    reasonCounts.filtered_out += duplicateSkips;
  }
  const missingSlots = Math.max(0, safeLimit - rows.length);
  if (missingSlots > 0) {
    if (aggregatedListings.length < safeLimit) {
      reasonCounts.no_hits += missingSlots;
    } else if (noMediaCandidates > 0) {
      reasonCounts.no_media += missingSlots;
    } else if (filteredOutCandidates > 0) {
      reasonCounts.filtered_out += missingSlots;
    } else {
      reasonCounts.no_hits += missingSlots;
    }
  }
  return {
    inserted: rowsToInsert.length,
    skipped: Math.max(0, safeLimit - rows.length) + duplicateSkips,
    reasonCounts,
  };
}
