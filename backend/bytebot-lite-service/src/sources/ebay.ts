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

export function buildEbaySoldUrl(query: string) {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Sold: "1",
    LH_Complete: "1",
    _sop: "13",
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

export async function fetchEbaySoldComps(options: {
  context: BrowserContext;
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
              const imageUrl = img?.getAttribute("src") ?? "";
              return { title, link, price, soldDate, imageUrl };
            })
          )
          .catch(() => []);

      const rawItems = await collectTiles();
      const items = rawItems.filter((item) => item.link && item.title && !item.title.includes("Shop on eBay"));

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
