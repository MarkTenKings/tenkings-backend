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
