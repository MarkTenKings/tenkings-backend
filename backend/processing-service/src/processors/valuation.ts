import { config } from "../config";

interface EstimateValueOptions {
  query: string;
}

interface EstimateValueResult {
  amountMinor: number;
  currency: string;
  source: string;
  marketplaceUrl: string | null;
}

function fallbackResult(): EstimateValueResult {
  return {
    amountMinor: 0,
    currency: "USD",
    source: "valuation_stub",
    marketplaceUrl: null,
  };
}

export async function estimateValue({ query }: EstimateValueOptions): Promise<EstimateValueResult> {
  if (!config.ebayBearerToken) {
    return fallbackResult();
  }

  try {
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");
    url.searchParams.set("sort", "price");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${config.ebayBearerToken}`,
        "X-EBAY-C-MARKETPLACE-ID": config.ebayMarketplaceId,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay valuation failed: ${response.status} ${errorText}`);
    }

    const payload = (await response.json()) as any;
    const items = Array.isArray(payload?.itemSummaries) ? payload.itemSummaries : [];

    if (items.length === 0) {
      return fallbackResult();
    }

    const pricesMinor: number[] = [];
    let currency = "USD";
    let marketplaceUrl: string | null = null;

    for (const item of items) {
      const priceValue = Number.parseFloat(item?.price?.value ?? "0");
      const priceCurrency = typeof item?.price?.currency === "string" ? item.price.currency : null;
      if (!Number.isFinite(priceValue) || priceValue <= 0) {
        continue;
      }
      if (priceCurrency) {
        currency = priceCurrency;
      }
      if (!marketplaceUrl && typeof item?.itemWebUrl === "string") {
        marketplaceUrl = item.itemWebUrl;
      }
      pricesMinor.push(Math.round(priceValue * 100));
    }

    if (pricesMinor.length === 0) {
      return fallbackResult();
    }

    // Use the median price to avoid outliers skewing the valuation.
    pricesMinor.sort((a, b) => a - b);
    const mid = Math.floor(pricesMinor.length / 2);
    const amountMinor = pricesMinor.length % 2 === 0
      ? Math.round((pricesMinor[mid - 1] + pricesMinor[mid]) / 2)
      : pricesMinor[mid];

    return {
      amountMinor,
      currency,
      source: "ebay_search",
      marketplaceUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[processing-service] valuation fallback: ${message}`);
    return fallbackResult();
  }
}
