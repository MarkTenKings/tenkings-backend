export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toSafeKeyPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/g, "")}/${path.replace(/^\/+/g, "")}`;
}

export async function safeScreenshot(
  page: { screenshot: (options: any) => Promise<Buffer> },
  options: { fullPage?: boolean; quality?: number; type?: "jpeg" | "png" }
) {
  try {
    return await page.screenshot({
      fullPage: options.fullPage ?? false,
      type: options.type ?? "jpeg",
      quality: options.type === "jpeg" ? options.quality ?? 70 : undefined,
    });
  } catch {
    try {
      return await page.screenshot({
        fullPage: false,
        type: "jpeg",
        quality: 60,
      });
    } catch {
      return null;
    }
  }
}

export async function safeWaitForTimeout(
  page: { waitForTimeout: (ms: number) => Promise<void>; isClosed?: () => boolean },
  ms: number
) {
  try {
    if (page.isClosed?.()) {
      return false;
    }
    await page.waitForTimeout(ms);
    return true;
  } catch {
    return false;
  }
}

export type PlaybookRule = {
  action: string;
  selector: string;
  urlContains?: string | null;
};

export async function applyPlaybookRules(
  page: {
    locator: (selector: string) => any;
    url: () => string;
    waitForLoadState: (
      state?: "networkidle" | "load" | "domcontentloaded",
      options?: { timeout?: number }
    ) => Promise<void>;
  },
  rules: PlaybookRule[]
) {
  let applied = 0;
  for (const rule of rules) {
    if (rule.action !== "click" || !rule.selector) {
      continue;
    }
    const url = page.url?.() ?? "";
    if (rule.urlContains && !url.includes(rule.urlContains)) {
      continue;
    }
    try {
      const locator = page.locator(rule.selector);
      if ((await locator.count?.()) > 0) {
        await locator.first().click().catch(() => undefined);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        applied += 1;
      }
    } catch {
      // ignore
    }
  }
  return applied;
}
