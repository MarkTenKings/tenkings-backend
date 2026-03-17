const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const MAX_PAGE_SIZE = 50;

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
  limit: number;
  hasMore: boolean;
  comps: KingsreviewEbayComp[];
};

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
  const normalizedLimit = Math.min(MAX_PAGE_SIZE, normalizePositiveInt(limit, 20));
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

export async function fetchKingsreviewEbaySoldCompPage(options: {
  query: string;
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

  const page = normalizePositiveInt(options.page ?? 1, 1);
  const limit = Math.min(MAX_PAGE_SIZE, normalizePositiveInt(options.limit ?? 20, 20));

  const params = new URLSearchParams({
    engine: "ebay",
    _nkw: query,
    ebay_domain: "ebay.com",
    show_only: "Sold,Complete",
    _ipg: String(limit),
    api_key: apiKey,
  });
  if (page > 1) {
    params.set("_pgn", String(page));
  }

  const response = await fetch(`${SERPAPI_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `SerpApi eBay request failed (${response.status})${body ? `: ${body.slice(0, 500)}` : ""}`
    );
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const searchMetadata =
    payload?.search_metadata && typeof payload.search_metadata === "object"
      ? (payload.search_metadata as Record<string, unknown>)
      : null;
  const pagination =
    payload?.serpapi_pagination && typeof payload.serpapi_pagination === "object"
      ? (payload.serpapi_pagination as Record<string, unknown>)
      : null;
  const metadataStatus = normalizeText(searchMetadata?.status);
  if (metadataStatus && metadataStatus !== "Success") {
    throw new Error(
      normalizeText(searchMetadata?.error) ??
        normalizeText(payload?.error) ??
        "SerpApi eBay returned an error"
    );
  }

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
  const targetItems = (organicItems.length ? organicItems : items).slice(0, limit);

  return {
    source: "ebay_sold",
    searchUrl:
      normalizeText(searchMetadata?.ebay_url) ??
      buildKingsreviewEbaySoldUrl(query, page, limit),
    page,
    limit,
    hasMore: Boolean(normalizeText(pagination?.next)) || targetItems.length === limit,
    comps: targetItems.map((item) => ({
      source: "ebay_sold",
      title: item.title,
      url: item.url,
      price: item.price,
      soldDate: item.soldDate,
      screenshotUrl: item.thumbnail,
      listingImageUrl: item.thumbnail || null,
      thumbnail: item.thumbnail || null,
      notes: page > 1 ? `SerpApi eBay sold results (page ${page})` : "SerpApi eBay sold results",
    })),
  };
}
