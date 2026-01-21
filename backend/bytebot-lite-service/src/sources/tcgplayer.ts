import { BrowserContext } from "playwright";
import { toSafeKeyPart } from "../utils";

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

  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("a[href*='/product/']", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  const searchShot = await page.screenshot({ fullPage: true });
  const searchShotKey = `${jobId}/tcgplayer-search-${toSafeKeyPart(query)}.png`;
  const searchShotUrl = (await upload(searchShot, searchShotKey, "image/png")).url;

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
    await detail.goto(item.url, { waitUntil: "domcontentloaded" });
    await detail.waitForTimeout(1500);

    const detailShot = await detail.screenshot({ fullPage: false });
    const detailKey = `${jobId}/tcgplayer-comp-${index + 1}-${toSafeKeyPart(item.title)}.png`;
    const detailUrl = (await upload(detailShot, detailKey, "image/png")).url;

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
      screenshotUrl: detailUrl,
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
