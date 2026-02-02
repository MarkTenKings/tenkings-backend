import { BrowserContext } from "playwright";
import { safeScreenshot, toSafeKeyPart } from "../utils";

export type Comp = {
  source: string;
  title: string | null;
  url: string;
  price: string | null;
  soldDate: string | null;
  screenshotUrl: string;
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
}) {
  const { context, query, maxComps, jobId, upload } = options;
  const searchUrl = buildEbaySoldUrl(query);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("li.s-item", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  const searchShot = await safeScreenshot(page, { fullPage: false, type: "jpeg", quality: 70 });
  let searchShotUrl = "";
  if (searchShot) {
    const searchShotKey = `${jobId}/ebay-search-${toSafeKeyPart(query)}.jpg`;
    searchShotUrl = (await upload(searchShot, searchShotKey, "image/jpeg")).url;
  }

  const rawItems = await page.$$eval("li.s-item", (nodes) =>
    nodes.map((node) => {
      const title = node.querySelector(".s-item__title")?.textContent?.trim() ?? "";
      const link = node.querySelector("a.s-item__link")?.getAttribute("href") ?? "";
      const price = node.querySelector(".s-item__price")?.textContent?.trim() ?? "";
      const soldDate = node.querySelector(".s-item__ended-date")?.textContent?.trim() ?? "";
      return { title, link, price, soldDate };
    })
  );

  const items = rawItems
    .filter((item) => item.link && item.title && !item.title.includes("Shop on eBay"))
    .slice(0, maxComps);

  const comps: Comp[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const detail = await context.newPage();
    detail.setDefaultTimeout(20000);
    await detail.goto(item.link, { waitUntil: "domcontentloaded" });
    await detail.waitForTimeout(1200);

    const detailShot = await safeScreenshot(detail, { fullPage: false, type: "jpeg", quality: 70 });
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
    });

    await detail.close();
  }

  await page.close();

  const result: SourceResult = {
    source: "ebay_sold",
    searchUrl,
    searchScreenshotUrl: searchShotUrl,
    comps,
  };

  return result;
}
