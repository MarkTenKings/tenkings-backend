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
  categoryType?: string | null;
}) {
  const { context, query, maxComps, jobId, upload, categoryType } = options;
  const searchUrl = buildPriceChartingSearchUrl(query);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("crash", () => {
    console.warn("[bytebot-lite] PriceCharting page crashed");
  });

  const captureWithRetry = async () => {
    let shot = await safeScreenshot(page, { fullPage: false, type: "jpeg", quality: 70 });
    if (shot) {
      return shot;
    }
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
    } catch {
      return null;
    }
    return await safeScreenshot(page, { fullPage: false, type: "jpeg", quality: 70 });
  };

  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const openMoreMenu = async () => {
    const selectors = ["text=More", "[aria-label='More']", "button:has-text('More')", "a:has-text('More')"];
    for (const selector of selectors) {
      const locator = page.locator(selector);
      if (await locator.count()) {
        await locator.first().click().catch(() => undefined);
        await page.waitForTimeout(400);
        return true;
      }
    }
    return false;
  };

  const clickCategory = async (labels: string[]) => {
    for (const label of labels) {
      const link = page.getByRole("link", { name: label });
      if (await link.count()) {
        await link.first().click().catch(() => undefined);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await page.waitForTimeout(600);
        return true;
      }
      const button = page.getByRole("button", { name: label });
      if (await button.count()) {
        await button.first().click().catch(() => undefined);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await page.waitForTimeout(600);
        return true;
      }
      const any = page.locator("a,button,li,div", { hasText: label });
      if (await any.count()) {
        await any.first().click().catch(() => undefined);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await page.waitForTimeout(600);
        return true;
      }
    }
    return false;
  };

  if (categoryType === "sport" || categoryType === "tcg") {
    await openMoreMenu();
  }

  if (categoryType === "sport") {
    await clickCategory(["Sports", "Sports Cards", "Baseball", "Basketball", "Football"]);
  }
  if (categoryType === "tcg") {
    await clickCategory(["Pokemon", "Pokémon", "TCG", "Trading Card Game"]);
  }

  const searchShot = await captureWithRetry();
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
    detail.on("crash", () => {
      console.warn("[bytebot-lite] PriceCharting detail page crashed");
    });
    await detail.goto(item.url, { waitUntil: "domcontentloaded" });
    await detail.waitForTimeout(1200);

    let detailShot = await safeScreenshot(detail, { fullPage: false, type: "jpeg", quality: 70 });
    if (!detailShot) {
      try {
        await detail.reload({ waitUntil: "domcontentloaded" });
        await detail.waitForTimeout(900);
        detailShot = await safeScreenshot(detail, { fullPage: false, type: "jpeg", quality: 70 });
      } catch {
        detailShot = null;
      }
    }
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
