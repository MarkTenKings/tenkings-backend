import { BrowserContext } from "playwright";
import { applyPlaybookRules, safeScreenshot, safeWaitForTimeout, toSafeKeyPart } from "../utils";
import { compareImageSignatures, computeImageSignature, ImageSignature } from "../pattern";

export type Comp = {
  source: string;
  title: string | null;
  url: string;
  price: string | null;
  soldDate: string | null;
  screenshotUrl: string;
  listingImageUrl?: string | null;
  notes?: string | null;
};

export type SourceResult = {
  source: string;
  searchUrl: string;
  searchScreenshotUrl: string;
  comps: Comp[];
};

type UploadFn = (buffer: Buffer, key: string, contentType: string) => Promise<{ url: string }>;
const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

export function buildEbaySoldUrl(query: string) {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Sold: "1",
    LH_Complete: "1",
    _sop: "13",
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

function buildFallbackQuery(query: string) {
  let next = query;
  next = next.replace(/\b\d+\s*\/\s*\d+\b/g, "");
  next = next.replace(/\b(PSA|BGS|SGC|CGC)\s*\d{1,2}\b/gi, "");
  next = next.replace(/\s{2,}/g, " ").trim();
  return next || query;
}

export async function fetchEbaySoldComps(options: {
  context?: BrowserContext | null;
  query: string;
  maxComps: number;
  jobId: string;
  upload: UploadFn;
  rules?: { action: string; selector: string; urlContains?: string | null }[];
  patternSignature?: ImageSignature | null;
  patternMinScore?: number;
}) {
  const serpApiKey = process.env.SERPAPI_KEY ?? "";
  if (!serpApiKey) {
    throw new Error("SERPAPI_KEY is required for ebay_sold.");
  }
  return await fetchEbaySoldCompsSerpApi({ ...options, apiKey: serpApiKey });
}

async function fetchEbaySoldCompsSerpApi(options: {
  query: string;
  maxComps: number;
  apiKey: string;
}) {
  const params = new URLSearchParams({
    engine: "ebay",
    _nkw: options.query,
    ebay_domain: "ebay.com",
    show_only: "Sold,Complete",
    _sop: "13",
    _ipg: "50",
    api_key: options.apiKey,
  });

  const response = await fetch(`${SERPAPI_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`SerpApi eBay request failed (${response.status})`);
  }
  const data = await response.json();
  if (data?.search_metadata?.status && data.search_metadata.status !== "Success") {
    throw new Error(data?.search_metadata?.error ?? "SerpApi eBay returned error");
  }

  const rawItems = Array.isArray(data?.organic_results) ? data.organic_results : [];
  const normalizePrice = (price: any) => {
    if (!price) return null;
    if (typeof price === "string") return price.trim();
    if (typeof price?.raw === "string") return price.raw.trim();
    if (typeof price?.extracted === "number") return `${price.extracted}`;
    if (typeof price?.from?.raw === "string" || typeof price?.to?.raw === "string") {
      const from = price?.from?.raw ? String(price.from.raw).trim() : "";
      const to = price?.to?.raw ? String(price.to.raw).trim() : "";
      return [from, to].filter(Boolean).join(" - ") || null;
    }
    return null;
  };

  const items = rawItems
    .map((item: any) => ({
      title: typeof item.title === "string" ? item.title.trim() : "",
      link: typeof item.link === "string" ? item.link.trim() : "",
      price: normalizePrice(item.price),
      soldDate: typeof item.sold_date === "string" ? item.sold_date.trim() : null,
      thumbnail: typeof item.thumbnail === "string" ? item.thumbnail.trim() : "",
      sponsored: Boolean(item.sponsored),
    }))
    .filter((item: any) => item.link && item.title);

  const organicItems = items.filter((item: any) => !item.sponsored);
  const targetItems = (organicItems.length ? organicItems : items).slice(0, Math.max(1, options.maxComps));
  const searchScreenshotUrl =
    targetItems.find((item: any) => item.thumbnail)?.thumbnail ??
    (items[0]?.thumbnail ?? "");

  const comps: Comp[] = targetItems.map((item) => ({
    source: "ebay_sold",
    title: item.title || null,
    url: item.link,
    price: item.price ?? null,
    soldDate: item.soldDate,
    screenshotUrl: item.thumbnail || "",
    listingImageUrl: item.thumbnail || null,
    notes: "SerpApi eBay sold results",
  }));

  return {
    source: "ebay_sold",
    searchUrl: data?.search_metadata?.ebay_url ?? buildEbaySoldUrl(options.query),
    searchScreenshotUrl,
    comps,
  };
}

async function fetchEbaySoldCompsPlaywright(options: {
  context?: BrowserContext | null;
  query: string;
  maxComps: number;
  jobId: string;
  upload: UploadFn;
  rules?: { action: string; selector: string; urlContains?: string | null }[];
  patternSignature?: ImageSignature | null;
  patternMinScore?: number;
}) {
  const {
    context,
    query,
    maxComps,
    jobId,
    upload,
    rules = [],
    patternSignature,
    patternMinScore = 0.7,
  } = options;
  if (!context) {
    throw new Error("Playwright context is required when SerpApi is not configured.");
  }
  const searchUrl = buildEbaySoldUrl(query);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("crash", () => {
      console.warn("[bytebot-lite] eBay page crashed");
    });

    const captureWithRetry = async () => {
      let shot = await safeScreenshot(page, { fullPage: false, type: "jpeg", quality: 70 });
      if (shot) {
        return shot;
      }
      try {
        await page.reload({ waitUntil: "domcontentloaded" });
        await safeWaitForTimeout(page, 1200);
      } catch {
        return null;
      }
      return await safeScreenshot(page, { fullPage: false, type: "jpeg", quality: 70 });
    };

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      if (rules.length) {
        await applyPlaybookRules(page, rules);
      }
      await page.waitForSelector("li.s-item", { timeout: 15000 }).catch(() => undefined);
      await safeWaitForTimeout(page, 1500);

      const searchShot = await captureWithRetry();
      let searchShotUrl = "";
      if (searchShot) {
        const searchShotKey = `${jobId}/ebay-search-${toSafeKeyPart(query)}.jpg`;
        searchShotUrl = (await upload(searchShot, searchShotKey, "image/jpeg")).url;
      }

      const collectTiles = async () =>
        page
          .$$eval("li.s-item", (nodes) =>
            nodes.map((node) => {
              const title = node.querySelector(".s-item__title")?.textContent?.trim() ?? "";
              const link = node.querySelector("a.s-item__link")?.getAttribute("href") ?? "";
              const price = node.querySelector(".s-item__price")?.textContent?.trim() ?? "";
              const soldDate = node.querySelector(".s-item__ended-date")?.textContent?.trim() ?? "";
              const img = node.querySelector(".s-item__image-img") as HTMLImageElement | null;
              let imageUrl =
                img?.getAttribute("src") ??
                img?.getAttribute("data-src") ??
                img?.getAttribute("data-lazy-src") ??
                "";
              if (!imageUrl) {
                const srcset = img?.getAttribute("srcset") ?? "";
                imageUrl = srcset.split(",")[0]?.trim().split(" ")[0] ?? "";
              }
              return { title, link, price, soldDate, imageUrl };
            })
          )
          .catch(() => []);

      const normalizeItems = (rawItems: Array<any>) =>
        rawItems.filter((item) => item.link && item.title && !item.title.includes("Shop on eBay"));

      let rawItems = await collectTiles();
      let items = normalizeItems(rawItems);

      if (items.length === 0) {
        const fallbackQuery = buildFallbackQuery(query);
        if (fallbackQuery !== query) {
          const fallbackUrl = buildEbaySoldUrl(fallbackQuery);
          await page.goto(fallbackUrl, { waitUntil: "domcontentloaded" });
          if (rules.length) {
            await applyPlaybookRules(page, rules);
          }
          await page.waitForSelector("li.s-item", { timeout: 15000 }).catch(() => undefined);
          await safeWaitForTimeout(page, 1500);
          rawItems = await collectTiles();
          items = normalizeItems(rawItems);
        }
      }

      const comps: Comp[] = [];
      const matchedTiles: Array<
        { title: string; link: string; price: string; soldDate: string; imageUrl: string; score: number }
      > = [];

      if (patternSignature) {
        const seenLinks = new Set<string>();
        for (let scrollIndex = 0; scrollIndex < 6; scrollIndex += 1) {
          const tiles = await collectTiles();
          for (const tile of tiles) {
            if (!tile.link || !tile.title || tile.title.includes("Shop on eBay")) {
              continue;
            }
            if (seenLinks.has(tile.link)) {
              continue;
            }
            seenLinks.add(tile.link);
            if (!tile.imageUrl) {
              continue;
            }
            const sig = await computeImageSignature(tile.imageUrl);
            if (!sig) {
              continue;
            }
            const comparison = compareImageSignatures(patternSignature, sig);
            if (comparison.score >= patternMinScore) {
              matchedTiles.push({
                title: tile.title,
                link: tile.link,
                price: tile.price,
                soldDate: tile.soldDate,
                imageUrl: tile.imageUrl,
                score: comparison.score,
              });
            }
            if (matchedTiles.length >= maxComps) {
              break;
            }
          }
          if (matchedTiles.length >= maxComps) {
            break;
          }
          await page.mouse.wheel(0, 1200);
          await safeWaitForTimeout(page, 800);
        }
      }

      const targetItems =
        matchedTiles.length > 0
          ? matchedTiles.slice(0, maxComps)
          : items.slice(0, maxComps).map((item) => ({ ...item, score: 0 }));

      for (let index = 0; index < targetItems.length; index += 1) {
        const item = targetItems[index];
        const detail = await context.newPage();
        detail.setDefaultTimeout(20000);
        detail.on("crash", () => {
          console.warn("[bytebot-lite] eBay detail page crashed");
        });
        await detail.goto(item.link, { waitUntil: "domcontentloaded" });
        await safeWaitForTimeout(detail, 1200);

        const listingImageUrl = await detail
          .$$eval("meta[property='og:image']", (nodes) =>
            nodes[0]?.getAttribute("content") ?? ""
          )
          .catch(() => "")
          .then((value) => (value ? value : ""))
          .then(async (value) => {
            if (value) {
              return value;
            }
            return await detail
              .$eval("#icImg", (node) => (node as HTMLImageElement).src ?? "")
              .catch(() => "");
          });

        let detailShot = await safeScreenshot(detail, { fullPage: false, type: "jpeg", quality: 70 });
        if (!detailShot) {
          try {
            await detail.reload({ waitUntil: "domcontentloaded" });
            await safeWaitForTimeout(detail, 900);
            detailShot = await safeScreenshot(detail, { fullPage: false, type: "jpeg", quality: 70 });
          } catch {
            detailShot = null;
          }
        }
        let detailUrl = "";
        if (detailShot) {
          const detailKey = `${jobId}/ebay-comp-${index + 1}-${toSafeKeyPart(item.title)}.jpg`;
          detailUrl = (await upload(detailShot, detailKey, "image/jpeg")).url;
        }

        const detailPrice = await detail
          .$eval("span.ux-textspans", (node) => node.textContent?.trim() ?? "")
          .catch(() => "");

        comps.push({
          source: "ebay_sold",
          title: item.title || null,
          url: item.link,
          price: detailPrice || item.price || null,
          soldDate: item.soldDate ? item.soldDate.replace(/^Sold\s*/i, "").trim() : null,
          screenshotUrl: detailUrl || "",
          listingImageUrl: listingImageUrl || null,
          notes:
            matchedTiles.length > 0
              ? `Pattern match score ${item.score.toFixed(3)}`
              : "Listing selected without pattern match",
        });

        await detail.close();
      }

      await page.close();

      return {
        source: "ebay_sold",
        searchUrl,
        searchScreenshotUrl: searchShotUrl,
        comps,
      };
    } catch (error) {
      await page.close().catch(() => undefined);
      if (attempt === 2) {
        throw error;
      }
    }
  }

  return {
    source: "ebay_sold",
    searchUrl,
    searchScreenshotUrl: "",
    comps: [],
  };
}
