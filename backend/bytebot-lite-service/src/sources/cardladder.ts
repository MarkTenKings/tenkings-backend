import { BrowserContext } from "playwright";
import { safeScreenshot, toSafeKeyPart } from "../utils";

import type { Comp, SourceResult } from "./ebay";

type UploadFn = (buffer: Buffer, key: string, contentType: string) => Promise<{ url: string }>;

export function buildCardLadderSearchUrl(query: string) {
  const params = new URLSearchParams({ query });
  return `https://www.cardladder.com/search?${params.toString()}`;
}

export async function fetchCardLadderComps(options: {
  context: BrowserContext;
  query: string;
  maxComps: number;
  jobId: string;
  upload: UploadFn;
  categoryType?: string | null;
}) {
  const { context, query, maxComps, jobId, upload } = options;
  const searchUrl = buildCardLadderSearchUrl(query);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  const bearerToken = process.env.CARDLADDER_BEARER_TOKEN;
  const appCheckToken = process.env.CARDLADDER_APPCHECK_TOKEN;
  if (bearerToken) {
    await page.setExtraHTTPHeaders({
      Authorization: `Bearer ${bearerToken}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    });
  }

  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const currentUrl = page.url();
  if (currentUrl.includes("login") || currentUrl.includes("signin")) {
    await page.close();
    return {
      source: "cardladder",
      searchUrl,
      searchScreenshotUrl: "",
      comps: [],
      error: "Card Ladder login required. Set CARDLADDER_COOKIES_JSON.",
    } as SourceResult;
  }

  const searchShot = await safeScreenshot(page, { fullPage: false, type: "jpeg", quality: 70 });
  let searchShotUrl = "";
  if (searchShot) {
    const searchShotKey = `${jobId}/cardladder-search-${toSafeKeyPart(query)}.jpg`;
    searchShotUrl = (await upload(searchShot, searchShotKey, "image/jpeg")).url;
  }

  const rawItems = await page.$$eval("a", (nodes) =>
    nodes
      .map((node) => ({
        title: node.textContent?.trim() ?? "",
        url: (node as HTMLAnchorElement).href ?? "",
      }))
      .filter((item) => item.title && item.url && item.url.includes("cardladder.com"))
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
      const detailKey = `${jobId}/cardladder-comp-${index + 1}-${toSafeKeyPart(item.title)}.jpg`;
      detailUrl = (await upload(detailShot, detailKey, "image/jpeg")).url;
    }

    comps.push({
      source: "cardladder",
      title: item.title || null,
      url: item.url,
      price: null,
      soldDate: null,
      screenshotUrl: detailUrl || "",
      notes: "CardLadder comp screenshot.",
    });

    await detail.close();
  }

  await page.close();

  const result: SourceResult = {
    source: "cardladder",
    searchUrl,
    searchScreenshotUrl: searchShotUrl,
    comps,
  };

  return result;
}
