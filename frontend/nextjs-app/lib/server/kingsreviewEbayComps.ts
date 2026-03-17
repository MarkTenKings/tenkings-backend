const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const MAX_RETURN_SIZE = 50;
const DEFAULT_RETURN_SIZE = 10;
const SERPAPI_MAX_RETRIES = 3;
const EBAY_SUPPORTED_PAGE_SIZES = [25, 50, 100, 200] as const;
const DEFAULT_EBAY_PAGE_SIZE = EBAY_SUPPORTED_PAGE_SIZES[0];

export type KingsreviewEbayComp = {
  source: "ebay_sold";
  title: string | null;
  url: string;
  price: string | null;
  soldDate: string | null;
  screenshotUrl: string;
  listingImageUrl: string | null;
  thumbnail: string | null;
  notes: string;
};

export type KingsreviewEbayCompPage = {
  source: "ebay_sold";
  searchUrl: string;
  page: number;
  offset: number;
  nextOffset: number;
  limit: number;
  hasMore: boolean;
  comps: KingsreviewEbayComp[];
};

class KingsreviewSerpApiError extends Error {
  readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = "KingsreviewSerpApiError";
    this.statusCode = statusCode;
  }
}

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const next = value.trim();
  return next ? next : null;
};

const normalizePositiveInt = (value: number, fallback: number) => {
  const next = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return next >= 1 ? next : fallback;
};

const normalizeNonNegativeInt = (value: number, fallback: number) => {
  const next = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return next >= 0 ? next : fallback;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const retryDelayMs = (attempt: number, statusCode: number | null) => {
  const base = statusCode === 429 ? 900 : statusCode != null && statusCode >= 500 ? 600 : 350;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(6000, base * Math.pow(2, Math.max(0, attempt - 1)) + jitter);
};

const normalizeEbayPageSize = (value: number) => {
  const requested = normalizePositiveInt(value, DEFAULT_EBAY_PAGE_SIZE);
  return (
    EBAY_SUPPORTED_PAGE_SIZES.find((pageSize) => requested <= pageSize) ??
    EBAY_SUPPORTED_PAGE_SIZES[EBAY_SUPPORTED_PAGE_SIZES.length - 1]
  );
};

const normalizePrice = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.raw === "string") {
    return normalizeText(record.raw);
  }
  if (typeof record.extracted === "number") {
    return String(record.extracted);
  }
  const from = record.from && typeof record.from === "object" ? normalizeText((record.from as Record<string, unknown>).raw) : null;
  const to = record.to && typeof record.to === "object" ? normalizeText((record.to as Record<string, unknown>).raw) : null;
  return [from, to].filter((entry): entry is string => Boolean(entry)).join(" - ") || null;
};

export function buildKingsreviewEbaySoldUrl(query: string, page = 1, limit = 20) {
  const normalizedPage = normalizePositiveInt(page, 1);
  const normalizedLimit = normalizeEbayPageSize(limit);
  const params = new URLSearchParams({
    _nkw: query,
    LH_Sold: "1",
    LH_Complete: "1",
    _sop: "13",
    _ipg: String(normalizedLimit),
  });
  if (normalizedPage > 1) {
    params.set("_pgn", String(normalizedPage));
  }
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

const isNoResultsMessage = (message: string | null) =>
  Boolean(message && /hasn'?t returned any results|no results/i.test(message));

const isRetryableSerpApiError = (error: unknown) => {
  const statusCode = error instanceof KingsreviewSerpApiError ? error.statusCode : null;
  if (statusCode === 429) {
    return true;
  }
  if (statusCode != null && statusCode >= 500) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error || "");
  return /network|timeout|fetch|econn|socket|temporar|thrott|quota|capacity|rate|limit/i.test(message);
};

const extractSerpApiErrorMessage = (payload: Record<string, unknown> | null) => {
  const searchMetadata =
    payload?.search_metadata && typeof payload.search_metadata === "object"
      ? (payload.search_metadata as Record<string, unknown>)
      : null;
  return (
    normalizeText(payload?.error) ??
    normalizeText(payload?.message) ??
    normalizeText(searchMetadata?.error) ??
    null
  );
};

async function fetchSerpApiPayload(params: URLSearchParams) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= SERPAPI_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${SERPAPI_ENDPOINT}?${params.toString()}`);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new KingsreviewSerpApiError(
          `SerpApi eBay request failed (${response.status})${body ? `: ${body.slice(0, 500)}` : ""}`,
          response.status
        );
      }

      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const errorMessage = extractSerpApiErrorMessage(payload);
      if (isNoResultsMessage(errorMessage)) {
        return { organic_results: [] } as Record<string, unknown>;
      }
      if (errorMessage) {
        throw new KingsreviewSerpApiError(errorMessage);
      }

      const searchMetadata =
        payload?.search_metadata && typeof payload.search_metadata === "object"
          ? (payload.search_metadata as Record<string, unknown>)
          : null;
      const metadataStatus = normalizeText(searchMetadata?.status);
      if (metadataStatus && metadataStatus !== "Success") {
        throw new KingsreviewSerpApiError(
          normalizeText(searchMetadata?.error) ?? "SerpApi eBay returned an error"
        );
      }

      return payload ?? ({} as Record<string, unknown>);
    } catch (error) {
      lastError = error;
      if (attempt < SERPAPI_MAX_RETRIES && isRetryableSerpApiError(error)) {
        const statusCode = error instanceof KingsreviewSerpApiError ? error.statusCode : null;
        console.warn("[kingsreview/comps] SerpApi request failed; retrying", {
          attempt,
          statusCode,
          message: error instanceof Error ? error.message : String(error || ""),
        });
        await wait(retryDelayMs(attempt, statusCode));
        continue;
      }
      break;
    }
  }

  console.error("[kingsreview/comps] SerpApi request failed", {
    message: lastError instanceof Error ? lastError.message : String(lastError || ""),
    statusCode: lastError instanceof KingsreviewSerpApiError ? lastError.statusCode : null,
  });
  throw lastError instanceof Error ? lastError : new Error("SerpApi eBay request failed");
}

async function fetchKingsreviewEbaySoldSerpPage(options: {
  apiKey: string;
  query: string;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams({
    engine: "ebay",
    _nkw: options.query,
    ebay_domain: "ebay.com",
    show_only: "Sold,Complete",
    _sop: "13",
    _ipg: String(options.pageSize),
    api_key: options.apiKey,
  });
  if (options.page > 1) {
    params.set("_pgn", String(options.page));
  }

  const payload = await fetchSerpApiPayload(params);
  const searchMetadata =
    payload?.search_metadata && typeof payload.search_metadata === "object"
      ? (payload.search_metadata as Record<string, unknown>)
      : null;
  const pagination =
    payload?.serpapi_pagination && typeof payload.serpapi_pagination === "object"
      ? (payload.serpapi_pagination as Record<string, unknown>)
      : null;
  const rawItems = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
  const items = rawItems
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const item = entry as Record<string, unknown>;
      const title = normalizeText(item.title);
      const url = normalizeText(item.link);
      if (!title || !url) {
        return null;
      }
      const thumbnail = normalizeText(item.thumbnail) ?? "";
      return {
        title,
        url,
        price: normalizePrice(item.price),
        soldDate: normalizeText(item.sold_date),
        thumbnail,
        sponsored: Boolean(item.sponsored),
      };
    })
    .filter(
      (
        entry
      ): entry is {
        title: string;
        url: string;
        price: string | null;
        soldDate: string | null;
        thumbnail: string;
        sponsored: boolean;
      } => Boolean(entry)
    );

  const organicItems = items.filter((item) => !item.sponsored);
  const targetItems = (organicItems.length ? organicItems : items).slice(0, options.pageSize);

  return {
    searchUrl:
      normalizeText(searchMetadata?.ebay_url) ??
      buildKingsreviewEbaySoldUrl(options.query, options.page, options.pageSize),
    hasNextPage: Boolean(normalizeText(pagination?.next)) || rawItems.length >= options.pageSize,
    comps: targetItems.map((item) => ({
      source: "ebay_sold" as const,
      title: item.title,
      url: item.url,
      price: item.price,
      soldDate: item.soldDate,
      screenshotUrl: item.thumbnail,
      listingImageUrl: item.thumbnail || null,
      thumbnail: item.thumbnail || null,
      notes:
        options.page > 1
          ? `SerpApi eBay sold results (page ${options.page})`
          : "SerpApi eBay sold results",
    })),
  };
}

export async function fetchKingsreviewEbaySoldCompPage(options: {
  query: string;
  offset?: number;
  page?: number;
  limit?: number;
}): Promise<KingsreviewEbayCompPage> {
  const apiKey = process.env.SERPAPI_KEY ?? "";
  if (!apiKey) {
    throw new Error("SERPAPI_KEY is required for KingsReview eBay comps.");
  }

  const query = options.query.trim();
  if (!query) {
    throw new Error("Search query is required for KingsReview eBay comps.");
  }

  const limit = Math.min(MAX_RETURN_SIZE, normalizePositiveInt(options.limit ?? DEFAULT_RETURN_SIZE, DEFAULT_RETURN_SIZE));
  const offset =
    typeof options.offset === "number"
      ? normalizeNonNegativeInt(options.offset, 0)
      : Math.max(0, (normalizePositiveInt(options.page ?? 1, 1) - 1) * limit);

  // SerpApi's eBay engine follows eBay `_ipg` page sizes (25/50/100/200), so 10-result
  // load-more batches are assembled by slicing supported pages instead of requesting `_ipg=10`.
  const serpPageSize = normalizeEbayPageSize(limit);
  const startingPage = Math.floor(offset / serpPageSize) + 1;
  let currentPage = startingPage;
  let currentOffsetWithinPage = offset % serpPageSize;
  let hasMore = false;
  let searchUrl = buildKingsreviewEbaySoldUrl(query, startingPage, serpPageSize);
  const comps: KingsreviewEbayComp[] = [];

  while (comps.length < limit) {
    const pageResult = await fetchKingsreviewEbaySoldSerpPage({
      apiKey,
      query,
      page: currentPage,
      pageSize: serpPageSize,
    });
    searchUrl = pageResult.searchUrl || searchUrl;

    const availableOnPage = pageResult.comps.slice(currentOffsetWithinPage);
    const takeCount = Math.min(limit - comps.length, availableOnPage.length);
    comps.push(...availableOnPage.slice(0, takeCount));

    const hasRemainingOnPage = availableOnPage.length > takeCount;
    if (comps.length >= limit) {
      hasMore = hasRemainingOnPage || pageResult.hasNextPage;
      break;
    }
    if (!pageResult.hasNextPage) {
      hasMore = hasRemainingOnPage;
      break;
    }

    currentPage += 1;
    currentOffsetWithinPage = 0;
  }

  const nextOffset = offset + comps.length;

  return {
    source: "ebay_sold",
    searchUrl,
    page: startingPage,
    offset,
    nextOffset,
    limit,
    hasMore,
    comps: comps.map((item) => ({
      ...item,
      notes:
        offset > 0
          ? `SerpApi eBay sold results (${offset + 1}-${nextOffset})`
          : item.notes,
    })),
  };
}
