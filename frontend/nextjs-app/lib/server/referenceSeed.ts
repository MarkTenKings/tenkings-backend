import { prisma } from "@tenkings/database";
import { normalizeCardNumber, normalizeParallelLabel, normalizePlayerSeed, normalizeSetLabel } from "@tenkings/shared";
import { normalizeProgramId } from "./taxonomyV2Utils";

type SeedListingCandidate = {
  sourceUrl: string | null;
  sourceListingId: string | null;
  sourceProductId: string | null;
  listingTitle: string | null;
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

function bestUrl(value: unknown): string {
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
    const candidate = bestUrl(mediaEntry?.image);
    if (candidate) return candidate;
  }
  return "";
}

function firstProductImageUrl(payload: any) {
  const productResults = payload?.product_results ?? payload ?? {};
  return (
    firstProductMediaImageUrl(payload) ||
    bestUrl(productResults?.image) ||
    bestUrl(productResults?.images) ||
    bestUrl(productResults?.product?.image) ||
    bestUrl(productResults?.product?.images) ||
    ""
  );
}

function extractListings(data: any) {
  if (Array.isArray(data?.organic_results)) return data.organic_results;
  if (Array.isArray(data?.search_results)) return data.search_results;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items_results)) return data.items_results;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function normalizeQueries(values: string[], maxCount: number) {
  return values
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter((value) => value.length > 0)
    .slice(0, maxCount);
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

  const strict = normalizeQueries([
    baseQuery,
    mk(player, setClean, cardHash, parallel),
    mk(player, setClean, cardCompact, parallel),
    mk(player, setClean, cardSpaced, parallel),
    mk(setClean, cardHash, parallel),
    mk(setClean, cardCompact, parallel),
  ], 6);

  const medium = normalizeQueries([
    mk(player, setClean, parallel),
    mk(player, setClean, cardHash),
    mk(player, setClean, cardCompact),
    mk(setClean, parallel),
  ], 5);

  const loose = normalizeQueries([
    // Final fallback when set labels are noisy in source data.
    mk(player, cardHash, parallel),
    mk(player, cardCompact, parallel),
    mk(player, cardSpaced, parallel),
    mk(player, parallel),
    mk(cardHash, parallel),
  ], 5);

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
        if (!listing || typeof listing !== "object") continue;
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
      const sourceListingId =
        parseEbayListingId(
          result?.link ||
            result?.product_link ||
            result?.url ||
            result?.item_url ||
            result?.view_item_url ||
            result?.item_web_url ||
            result?.product?.link ||
            rawSourceUrl ||
            null
        ) ||
        sourceProductId;
      const sourceUrl = rawSourceUrl || (sourceListingId ? canonicalEbayListingUrl(sourceListingId) : null);
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
        listingTitle,
        score,
      } satisfies SeedListingCandidate;
    })
    .sort((a: SeedListingCandidate, b: SeedListingCandidate) => b.score - a.score);

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

  for (const row of mappedCandidates) {
    if (rows.length >= safeLimit) break;

    let rawImageUrl = "";
    const productLookupId = row.sourceProductId || row.sourceListingId;
    const canLookupProduct = Boolean(productLookupId) && productLookupCount < maxProductLookups;
    if (canLookupProduct && productLookupId) {
      productLookupCount += 1;
      const productParams = new URLSearchParams({
        engine: EBAY_PRODUCT_ENGINE,
        product_id: productLookupId,
        api_key: apiKey,
      });
      try {
        const { payload } = await fetchSerpApiPayload(productParams, { allowNoResults: true });
        rawImageUrl = firstProductImageUrl(payload);
      } catch {
        rawImageUrl = "";
      }
    }

    if (!rawImageUrl) {
      noMediaCandidates += 1;
      continue;
    }
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
    reasonCounts[noMediaCandidates > 0 ? "no_media" : "no_hits"] = safeLimit;
    return { inserted: 0, skipped: safeLimit, reasonCounts };
  }

  const createResult = await prisma.cardVariantReferenceImage.createMany({ data: rows });

  const reasonCounts = emptyReasonCounts();
  const missingSlots = Math.max(0, safeLimit - rows.length);
  if (missingSlots > 0) {
    if (aggregatedListings.length < safeLimit) {
      reasonCounts.no_hits += missingSlots;
    } else if (noMediaCandidates > 0) {
      reasonCounts.no_media += missingSlots;
    } else {
      reasonCounts.no_hits += missingSlots;
    }
  }
  return {
    inserted: Number(createResult.count ?? 0),
    skipped: Math.max(0, safeLimit - rows.length),
    reasonCounts,
  };
}
