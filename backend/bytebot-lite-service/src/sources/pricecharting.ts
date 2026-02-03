import { BrowserContext } from "playwright";
import { safeScreenshot, safeWaitForTimeout, toSafeKeyPart } from "../utils";

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
      await safeWaitForTimeout(page, 1200);
    } catch {
      return null;
    }
    return await safeScreenshot(page, { fullPage: false, type: "jpeg", quality: 70 });
  };

  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
  await safeWaitForTimeout(page, 1500);

  const openMoreMenu = async () => {
    const selectors = ["text=More", "[aria-label='More']", "button:has-text('More')", "a:has-text('More')"];
    for (const selector of selectors) {
      const locator = page.locator(selector);
      if (await locator.count()) {
        await locator.first().click().catch(() => undefined);
        await safeWaitForTimeout(page, 400);
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
        await safeWaitForTimeout(page, 600);
        return true;
      }
      const button = page.getByRole("button", { name: label });
      if (await button.count()) {
        await button.first().click().catch(() => undefined);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await safeWaitForTimeout(page, 600);
        return true;
      }
      const any = page.locator("a,button,li,div", { hasText: label });
      if (await any.count()) {
        await any.first().click().catch(() => undefined);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await safeWaitForTimeout(page, 600);
        return true;
      }
    }
    return false;
  };

  if (categoryType === "sport" || categoryType === "tcg") {
    await openMoreMenu();
  }

  const selectFromDropdown = async (labels: string[]) => {
    const selects = await page.locator("select").all();
    for (const select of selects) {
      const options = await select.locator("option").all();
      for (const option of options) {
        const text = (await option.textContent())?.trim() ?? "";
        if (!text) continue;
        if (labels.some((label) => text.toLowerCase().includes(label.toLowerCase()))) {
          const value = await option.getAttribute("value");
          if (value) {
            await select.selectOption(value).catch(() => undefined);
            await page.waitForLoadState("networkidle").catch(() => undefined);
            await safeWaitForTimeout(page, 600);
            return true;
          }
        }
      }
    }
    return false;
  };

  if (categoryType === "sport") {
    const clicked = await clickCategory(["Sports", "Sports Cards", "Baseball", "Basketball", "Football"]);
    if (!clicked) {
      await selectFromDropdown(["sports", "baseball", "basketball", "football"]);
    }
    if (!page.url().toLowerCase().includes("sports")) {
      const sportsLink = page.locator("a[href*='sports'], a[href*='sports-cards']").first();
      if (await sportsLink.count()) {
        await sportsLink.click().catch(() => undefined);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await safeWaitForTimeout(page, 600);
      }
    }
  }
  if (categoryType === "tcg") {
    const clicked = await clickCategory(["Pokemon", "Pokémon", "TCG", "Trading Card Game"]);
    if (!clicked) {
      await selectFromDropdown(["pokemon", "tcg", "trading card"]);
    }
    if (!page.url().toLowerCase().includes("pokemon") && !page.url().toLowerCase().includes("tcg")) {
      const tcgLink = page.locator("a[href*='pokemon'], a[href*='tcg']").first();
      if (await tcgLink.count()) {
        await tcgLink.click().catch(() => undefined);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await safeWaitForTimeout(page, 600);
      }
    }
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
      .filter((item) => {
        if (!item.title || !item.url) return false;
        if (!item.url.includes("pricecharting.com/")) return false;
        if (item.url.includes("/search-products")) return false;
        if (item.url.endsWith("pricecharting.com/")) return false;
        return true;
      })
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
    await safeWaitForTimeout(detail, 1200);

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
