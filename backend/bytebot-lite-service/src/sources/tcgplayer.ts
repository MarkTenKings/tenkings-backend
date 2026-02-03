import { BrowserContext } from "playwright";
import { safeScreenshot, safeWaitForTimeout, toSafeKeyPart } from "../utils";

import type { Comp, SourceResult } from "./ebay";

type UploadFn = (buffer: Buffer, key: string, contentType: string) => Promise<{ url: string }>;

export function buildTcgplayerSearchUrl(query: string) {
  const params = new URLSearchParams({
    q: query,
    view: "grid",
  });
  return `https://www.tcgplayer.com/search/all/product?${params.toString()}`;
}

function uniqueUrls(items: Array<{ title: string; url: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) {
      return false;
    }
    seen.add(item.url);
    return true;
  });
}

export async function fetchTcgplayerComps(options: {
  context: BrowserContext;
  query: string;
  maxComps: number;
  jobId: string;
  upload: UploadFn;
}) {
  const { context, query, maxComps, jobId, upload } = options;
  const searchUrl = buildTcgplayerSearchUrl(query);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("crash", () => {
    console.warn("[bytebot-lite] TCGplayer page crashed");
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

  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("a[href*='/product/']", { timeout: 15000 }).catch(() => undefined);
  await safeWaitForTimeout(page, 1500);

  const searchShot = await captureWithRetry();
  let searchShotUrl = "";
  if (searchShot) {
    const searchShotKey = `${jobId}/tcgplayer-search-${toSafeKeyPart(query)}.jpg`;
    searchShotUrl = (await upload(searchShot, searchShotKey, "image/jpeg")).url;
  }

  const rawItems = await page.$$eval("a[href*='/product/']", (nodes) =>
    nodes
      .map((node) => ({
        title: node.textContent?.trim() ?? "",
        url: (node as HTMLAnchorElement).href ?? "",
      }))
      .filter((item) => item.title && item.url)
  );

  const items = uniqueUrls(rawItems).slice(0, maxComps);
  const comps: Comp[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const detail = await context.newPage();
    detail.setDefaultTimeout(20000);
    detail.on("crash", () => {
      console.warn("[bytebot-lite] TCGplayer detail page crashed");
    });
    await detail.goto(item.url, { waitUntil: "domcontentloaded" });
    await safeWaitForTimeout(detail, 1500);

    let detailShot = await safeScreenshot(detail, { fullPage: false, type: "jpeg", quality: 70 });
    if (!detailShot) {
      try {
        await detail.reload({ waitUntil: "domcontentloaded" });
        await safeWaitForTimeout(detail, 1000);
        detailShot = await safeScreenshot(detail, { fullPage: false, type: "jpeg", quality: 70 });
      } catch {
        detailShot = null;
      }
    }
    let detailUrl = "";
    if (detailShot) {
      const detailKey = `${jobId}/tcgplayer-comp-${index + 1}-${toSafeKeyPart(item.title)}.jpg`;
      detailUrl = (await upload(detailShot, detailKey, "image/jpeg")).url;
    }

    const price = await detail.evaluate(() => {
      const selectors = [
        "span[data-testid='product-price']",
        "span.price",
        "span.product-details__price",
        "span[data-testid='pricing-price']",
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent?.trim()) {
          return el.textContent.trim();
        }
      }
      const spans = Array.from(document.querySelectorAll("span"))
        .map((span) => span.textContent?.trim())
        .filter((text) => text && text.includes("$"));
      return spans[0] ?? null;
    });

    comps.push({
      source: "tcgplayer",
      title: item.title || null,
      url: item.url,
      price: price || null,
      soldDate: null,
      screenshotUrl: detailUrl || "",
      notes: "TCGplayer price is market/recent sales when available.",
    });

    await detail.close();
  }

  await page.close();

  const result: SourceResult = {
    source: "tcgplayer",
    searchUrl,
    searchScreenshotUrl: searchShotUrl,
    comps,
  };

  return result;
}
