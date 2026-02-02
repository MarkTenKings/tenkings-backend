import { BrowserContext } from "playwright";
import { safeScreenshot, toSafeKeyPart } from "../utils";

import type { Comp, SourceResult } from "./ebay";

type UploadFn = (buffer: Buffer, key: string, contentType: string) => Promise<{ url: string }>;

export function buildPriceChartingSearchUrl(query: string) {
  const params = new URLSearchParams({ q: query });
  return `https://www.pricecharting.com/search-products?${params.toString()}`;
}

export async function fetchPriceChartingComps(options: {
  context: BrowserContext;
  query: string;
  maxComps: number;
  jobId: string;
  upload: UploadFn;
}) {
  const { context, query, maxComps, jobId, upload } = options;
  const searchUrl = buildPriceChartingSearchUrl(query);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const searchShot = await safeScreenshot(page, { fullPage: false, type: "jpeg", quality: 70 });
  let searchShotUrl = "";
  if (searchShot) {
    const searchShotKey = `${jobId}/pricecharting-search-${toSafeKeyPart(query)}.jpg`;
    searchShotUrl = (await upload(searchShot, searchShotKey, "image/jpeg")).url;
  }

  const rawItems = await page.$$eval("a", (nodes) =>
    nodes
      .map((node) => ({
        title: node.textContent?.trim() ?? "",
        url: (node as HTMLAnchorElement).href ?? "",
      }))
      .filter((item) => item.title && item.url && item.url.includes("pricecharting.com/game"))
  );

  const items = rawItems.slice(0, maxComps);
  const comps: Comp[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const detail = await context.newPage();
    detail.setDefaultTimeout(20000);
    await detail.goto(item.url, { waitUntil: "domcontentloaded" });
    await detail.waitForTimeout(1200);

    const detailShot = await safeScreenshot(detail, { fullPage: false, type: "jpeg", quality: 70 });
    let detailUrl = "";
    if (detailShot) {
      const detailKey = `${jobId}/pricecharting-comp-${index + 1}-${toSafeKeyPart(item.title)}.jpg`;
      detailUrl = (await upload(detailShot, detailKey, "image/jpeg")).url;
    }

    comps.push({
      source: "pricecharting",
      title: item.title || null,
      url: item.url,
      price: null,
      soldDate: null,
      screenshotUrl: detailUrl || "",
      notes: "PriceCharting comp screenshot.",
    });

    await detail.close();
  }

  await page.close();

  const result: SourceResult = {
    source: "pricecharting",
    searchUrl,
    searchScreenshotUrl: searchShotUrl,
    comps,
  };

  return result;
}
