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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // eBay image urls frequently include "thumbs" in the path even for high-res assets.
    // Treat explicit large sizes as usable regardless of path tokens.
    if (Number.isFinite(size) && size >= 500) return false;
    if (Number.isFinite(size) && size > 0 && size < 500) return true;
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

function pickProductImageUrl(payload: any) {
  const candidateUrls = dedupeUrls([
    ...flattenUrlValues(payload?.media?.image),
    ...flattenUrlValues(payload?.media?.images),
    ...flattenUrlValues(payload?.image),
    ...flattenUrlValues(payload?.images),
    ...flattenUrlValues(payload?.product?.image),
    ...flattenUrlValues(payload?.product?.images),
    ...flattenUrlValues(payload?.thumbnail),
    ...flattenUrlValues(payload?.thumbnail_images),
  ]);

  const ranked = candidateUrls
    .map((value) => {
      const rawUrl = String(value || "").trim();
      if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return null;
      const upgraded = upgradeEbayImageUrl(rawUrl);
      if (isThumbnailLike(upgraded)) return null;
      return {
        upgraded,
        size: extractImageSizeToken(rawUrl),
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
          await wait(300 * attempt);
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
          await wait(300 * attempt);
          continue;
        }
        throw new ReferenceSeedError(502, requestError);
      }

      const metadataStatus = String(payload?.search_metadata?.status || "").trim();
      if (metadataStatus && metadataStatus !== "Success") {
        requestError = String(payload?.search_metadata?.error || "SerpApi returned error.").trim();
        const retryable = /rate|limit|timeout|temporar|try again|busy|thrott/i.test(requestError);
        if (attempt < 3 && retryable) {
          await wait(300 * attempt);
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

function buildSearchQueries(params: {
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

  const candidates = dedupeQueries([
    baseQuery,
    mk(player, setClean, cardHash, parallel),
    mk(player, setClean, cardCompact, parallel),
    mk(player, setClean, cardSpaced, parallel),
    mk(player, setClean, parallel),
    mk(setClean, cardHash, parallel),
    mk(setClean, cardCompact, parallel),
    // Fallback when set labels are noisy/typoed in source data.
    mk(player, cardHash, parallel),
    mk(player, cardCompact, parallel),
    mk(player, cardSpaced, parallel),
    mk(player, parallel),
  ]);

  return candidates.slice(0, 10);
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

  let data: any = null;
  const searchQueries = buildSearchQueries({
    query: normalizedQuery,
    setId: normalizedSetId,
    cardNumber: normalizedCardNumber,
    parallelId: normalizedParallelId,
    playerSeed: normalizedPlayerSeed,
  });

  for (const searchQuery of searchQueries) {
    const queryParams = new URLSearchParams({
      engine: EBAY_ENGINE,
      _nkw: searchQuery,
      q: searchQuery,
      _sop: "12",
      _ipg: String(selectEbayPageSize(safeLimit * 3)),
      api_key: apiKey,
    });
    if (tbs) queryParams.set("tbs", String(tbs).trim());
    if (gl) queryParams.set("gl", String(gl).trim());
    if (hl) queryParams.set("hl", String(hl).trim());

    const { payload: queryData, noResults: queryNoResults } = await fetchSerpApiPayload(queryParams, {
      allowNoResults: true,
    });
    const queryListings = extractListings(queryData);
    if (queryListings.length > 0) {
      data = queryData;
      break;
    }
    if (queryNoResults) {
      continue;
    }
  }

  if (!data) {
    return { inserted: 0, skipped: 1 };
  }

  const listings = extractListings(data);
  const listingCandidates = listings
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
    .filter((row: SeedListingCandidate) => row.sourceUrl && row.sourceListingId)
    .sort((a: SeedListingCandidate, b: SeedListingCandidate) => b.score - a.score);

  const seenListing = new Set<string>();
  const seenImage = new Set<string>();
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
  const maxProductLookups = Math.max(8, Math.min(40, safeLimit * 5));
  let productLookupCount = 0;

  for (const row of listingCandidates) {
    if (rows.length >= safeLimit) break;
    if (!row.sourceUrl || !row.sourceListingId) continue;
    if (seenListing.has(row.sourceListingId)) continue;

    let rawImageUrl = "";
    const canLookupProduct = Boolean(row.sourceProductId) && productLookupCount < maxProductLookups;
    if (canLookupProduct && row.sourceProductId) {
      productLookupCount += 1;
      const productParams = new URLSearchParams({
        engine: EBAY_PRODUCT_ENGINE,
        product_id: row.sourceProductId,
        api_key: apiKey,
      });
      try {
        const { payload } = await fetchSerpApiPayload(productParams, { allowNoResults: true });
        rawImageUrl = pickProductImageUrl(payload);
      } catch {
        rawImageUrl = "";
      }
    }

    if (!rawImageUrl) {
      rawImageUrl = row.fallbackImageUrl;
    }
    if (!rawImageUrl) continue;
    if (seenImage.has(rawImageUrl)) continue;

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
    return { inserted: 0, skipped: 1 };
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

  const duplicateSkips = rows.length - rowsToInsert.length;
  return {
    inserted: rowsToInsert.length,
    skipped: Math.max(0, safeLimit - rows.length) + duplicateSkips,
  };
}
