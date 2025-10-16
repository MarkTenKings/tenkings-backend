import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (!key) {
      continue;
    }
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const localRootFallback = path.resolve(
  process.env.CARD_STORAGE_LOCAL_ROOT ??
    path.join(process.cwd(), "../../frontend/nextjs-app/public/uploads/cards")
);

export const config = {
  pollIntervalMs: Number(process.env.PROCESSING_POLL_INTERVAL_MS ?? 5000),
  maxRetries: Number(process.env.PROCESSING_JOB_RETRIES ?? 3),
  transactionTimeoutMs: Number(process.env.PROCESSING_TX_TIMEOUT_MS ?? 15000),
  storageMode: (process.env.CARD_STORAGE_MODE ?? "local").toLowerCase(),
  localStorageRoot: localRootFallback,
  googleVisionApiKey: process.env.GOOGLE_VISION_API_KEY ?? null,
  ximilarApiKey: process.env.XIMILAR_API_KEY ?? null,
  ximilarCollectionId: process.env.XIMILAR_COLLECTION_ID ?? null,
  ximilarMaxImageBytes: Number(process.env.XIMILAR_MAX_IMAGE_BYTES ?? 2_500_000),
  ebayBearerToken: process.env.EBAY_BEARER_TOKEN ?? null,
  ebayMarketplaceId: process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US",
};
