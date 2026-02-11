import { chromium } from "playwright";
import {
  fetchNextQueuedBytebotLiteJob,
  markBytebotLiteJobStatus,
  BytebotLiteJobStatus,
  prisma,
} from "@tenkings/database";
import { createSpacesUploader } from "./storage/spaces";
import { fetchEbaySoldComps } from "./sources/ebay";
import { fetchTcgplayerComps } from "./sources/tcgplayer";
import { fetchPriceChartingComps } from "./sources/pricecharting";
import { sleep } from "./utils";
import { startTeachServer } from "./teachServer";
import { compareImageSignatures, computeImageSignature, ImageSignature } from "./pattern";
import { processPendingReferences } from "./reference/queue";

type PlaybookRule = {
  id: string;
  source: string;
  action: string;
  selector: string;
  urlContains: string | null;
  label: string | null;
  priority: number;
  enabled: boolean;
};

type JobResult = {
  jobId: string;
  cardAssetId: string | null;
  searchQuery: string;
  generatedAt: string;
  sources: Array<{
    source: string;
    searchUrl: string;
    searchScreenshotUrl: string;
    comps: Array<{
      source: string;
      title: string | null;
      url: string;
      price: string | null;
      soldDate: string | null;
      screenshotUrl: string;
      listingImageUrl?: string | null;
      notes?: string | null;
      patternMatch?: {
        score: number;
        distance: number;
        colorDistance: number;
        tier: "verified" | "likely" | "weak" | "none";
      };
    }>;
    error?: string | null;
  }>;
};

const POLL_INTERVAL_MS = Number(process.env.BYTEBOT_LITE_POLL_INTERVAL_MS ?? 3000);
const CONCURRENCY = Math.max(1, Number(process.env.BYTEBOT_LITE_CONCURRENCY ?? 1));
const HEADLESS = (process.env.BYTEBOT_LITE_HEADLESS ?? "true").toLowerCase() !== "false";
const VIEWPORT_WIDTH = Number(process.env.BYTEBOT_LITE_VIEWPORT_WIDTH ?? 1280);
const VIEWPORT_HEIGHT = Number(process.env.BYTEBOT_LITE_VIEWPORT_HEIGHT ?? 720);
const PATTERN_ENABLED = (process.env.BYTEBOT_PATTERN_ENABLED ?? "false").toLowerCase() === "true";
const PATTERN_MIN_SCORE = Number(process.env.BYTEBOT_PATTERN_MIN_SCORE ?? 0.7);
const REFERENCE_POLL_INTERVAL_MS = Number(process.env.BYTEBOT_REFERENCE_POLL_INTERVAL_MS ?? 15000);

function classifyPatternTier(score: number) {
  if (score >= 0.9) {
    return "verified" as const;
  }
  if (score >= 0.8) {
    return "likely" as const;
  }
  if (score >= PATTERN_MIN_SCORE) {
    return "weak" as const;
  }
  return "none" as const;
}

async function resolveCardPatternSignature(cardAssetId: string | null) {
  if (!PATTERN_ENABLED || !cardAssetId) {
    return null;
  }
  const asset = await prisma.cardAsset.findUnique({
    where: { id: cardAssetId },
    select: {
      id: true,
      patternSignatureJson: true,
      photos: { select: { kind: true, imageUrl: true } },
    },
  });
  if (!asset) {
    return null;
  }
  if (asset.patternSignatureJson) {
    return asset.patternSignatureJson as ImageSignature;
  }
  const front = asset.photos.find((photo) => photo.kind === "FRONT")?.imageUrl;
  if (!front) {
    return null;
  }
  const signature = await computeImageSignature(front);
  if (!signature) {
    return null;
  }
  await prisma.cardAsset.update({
    where: { id: asset.id },
    data: {
      patternSignatureJson: signature as any,
      patternSignatureUpdatedAt: new Date(),
    },
  });
  return signature;
}

async function attachPatternMatches(
  sources: JobResult["sources"],
  signature: ImageSignature | null
) {
  if (!PATTERN_ENABLED || !signature) {
    return sources;
  }
  const updatedSources = [];
  for (const source of sources) {
    const updatedComps = [];
    for (const comp of source.comps) {
      const patternUrl = comp.listingImageUrl ?? comp.screenshotUrl;
      if (!patternUrl || !patternUrl.startsWith("http")) {
        updatedComps.push(comp);
        continue;
      }
      const compSignature = await computeImageSignature(patternUrl);
      if (!compSignature) {
        updatedComps.push(comp);
        continue;
      }
      const comparison = compareImageSignatures(signature, compSignature);
      const tier = classifyPatternTier(comparison.score);
      updatedComps.push({
        ...comp,
        patternMatch: {
          score: Number(comparison.score.toFixed(3)),
          distance: comparison.distance,
          colorDistance: Number(comparison.colorDistance.toFixed(2)),
          tier,
        },
      });
    }
    updatedSources.push({ ...source, comps: updatedComps });
  }
  return updatedSources;
}

async function processJob(
  workerId: number,
  job: {
    id: string;
    cardAssetId: string | null;
    searchQuery: string;
    sources: string[];
    maxComps: number;
    payload?: { categoryType?: string | null };
  },
  browserType = chromium
) {
  const upload = createSpacesUploader();
  try {
    const sources = job.sources ?? [];
    if (sources.length === 0) {
      throw new Error("No sources provided.");
    }

    const results = [];
    const cardPatternSignature = await resolveCardPatternSignature(job.cardAssetId ?? null);
    const playbookRules = await prisma.bytebotPlaybookRule.findMany({
      where: {
        source: { in: sources },
        enabled: true,
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });
    const rulesBySource = playbookRules.reduce<Record<string, PlaybookRule[]>>((acc, rule) => {
      const list = acc[rule.source] ?? [];
      list.push(rule as PlaybookRule);
      acc[rule.source] = list;
      return acc;
    }, {});
    const runSource = async (source: string) => {
      let browser: any = null;
      let context: any = null;
      try {
        if (source !== "ebay_sold") {
          browser = await browserType.launch({
            headless: HEADLESS,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-gpu",
              "--disable-dev-shm-usage",
              "--single-process",
              "--no-zygote",
            ],
          });
          context = await browser.newContext({
            viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          });
        }

        if (source === "ebay_sold") {
          return await fetchEbaySoldComps({
            context,
            query: job.searchQuery,
            maxComps: job.maxComps,
            jobId: job.id,
            upload,
            rules: rulesBySource[source] ?? [],
            patternSignature: cardPatternSignature,
            patternMinScore: PATTERN_MIN_SCORE,
          });
        }

        if (source === "tcgplayer") {
          return await fetchTcgplayerComps({
            context,
            query: job.searchQuery,
            maxComps: job.maxComps,
            jobId: job.id,
            upload,
            rules: rulesBySource[source] ?? [],
          });
        }

        if (source === "pricecharting") {
          return await fetchPriceChartingComps({
            context,
            query: job.searchQuery,
            maxComps: job.maxComps,
            jobId: job.id,
            upload,
            categoryType: job.payload?.categoryType ?? null,
            rules: rulesBySource[source] ?? [],
          });
        }

        throw new Error("Unknown source");
      } finally {
        try {
          if (context) {
            await context.close();
          }
        } catch {
          // ignore
        }
        try {
          if (browser) {
            await browser.close();
          }
        } catch {
          // ignore
        }
      }
    };

    for (const source of sources) {
      let lastError: string | null = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const result = await runSource(source);
          results.push(result);
          lastError = null;
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Source failed";
          lastError = message;
          const isRetryable =
            message.includes("Target page") ||
            message.includes("browser has been closed") ||
            message.includes("Target crashed") ||
            message.includes("Execution context was destroyed");
          if (!isRetryable || attempt === 2) {
            results.push({
              source,
              searchUrl: "",
              searchScreenshotUrl: "",
              comps: [],
              error: message,
            } as any);
          }
        }
      }
      if (lastError) {
        // nothing else to do
      }
    }

    const payload: JobResult = {
      jobId: job.id,
      cardAssetId: job.cardAssetId ?? null,
      searchQuery: job.searchQuery,
      generatedAt: new Date().toISOString(),
      sources: await attachPatternMatches(results as JobResult["sources"], cardPatternSignature),
    };

    await markBytebotLiteJobStatus(job.id, BytebotLiteJobStatus.COMPLETE, undefined, payload);
    if (job.cardAssetId) {
      await autoAttachEbayComps({
        id: job.id,
        cardAssetId: job.cardAssetId,
        sources: payload.sources,
      });
    }
    if (job.cardAssetId) {
      await prisma.cardAsset.update({
        where: { id: job.cardAssetId },
        data: {
          reviewStage: "READY_FOR_HUMAN_REVIEW",
          reviewStageUpdatedAt: new Date(),
        },
      });
    }
    console.log(`[bytebot-lite] worker ${workerId} completed job ${job.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const details =
      error instanceof Error
        ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`
        : JSON.stringify(error, null, 2);
    await markBytebotLiteJobStatus(job.id, BytebotLiteJobStatus.FAILED, message);
    console.error(`[bytebot-lite] worker ${workerId} job ${job.id} failed: ${details}`);
  } finally {
    // browser handled per-source
  }
}

async function autoAttachEbayComps(job: {
  id: string;
  cardAssetId: string;
  sources: JobResult["sources"];
}) {
  const ebaySource = job.sources.find((source) => source.source === "ebay_sold");
  if (!ebaySource || !ebaySource.comps.length) {
    return;
  }

  const desired = ebaySource.comps
    .filter((comp) => comp.url)
    .slice(0, 10);
  const unique = new Map<string, (typeof desired)[number]>();
  for (const comp of desired) {
    if (!unique.has(comp.url)) {
      unique.set(comp.url, comp);
    }
  }
  const topFive = Array.from(unique.values()).slice(0, 5);
  if (topFive.length === 0) {
    return;
  }

  const existing = await prisma.cardEvidenceItem.findMany({
    where: {
      cardAssetId: job.cardAssetId,
      url: { in: topFive.map((comp) => comp.url) },
    },
    select: { url: true },
  });
  const existingUrls = new Set(existing.map((item) => item.url));
  const rows = topFive
    .filter((comp) => !existingUrls.has(comp.url))
    .map((comp) => ({
      cardAssetId: job.cardAssetId,
      kind: "SOLD_COMP" as const,
      source: "ebay_sold",
      title: comp.title ?? null,
      url: comp.url,
      screenshotUrl: comp.screenshotUrl || null,
      price: comp.price ?? null,
      soldDate: comp.soldDate ?? null,
      note: comp.notes ?? "Auto-attached from SerpApi",
    }));

  if (rows.length) {
    await prisma.cardEvidenceItem.createMany({ data: rows });
  }
}

async function workerLoop(workerId: number) {
  console.log(`[bytebot-lite] worker ${workerId} online`);
  while (true) {
    const job = await fetchNextQueuedBytebotLiteJob();
    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    console.log(`[bytebot-lite] worker ${workerId} picked job ${job.id}`);
    await processJob(workerId, {
      id: job.id,
      cardAssetId: job.cardAssetId ?? null,
      searchQuery: job.searchQuery,
      sources: job.sources,
      maxComps: job.maxComps,
      payload: (job as { payload?: { categoryType?: string | null } }).payload,
    });
  }
}

async function referenceLoop() {
  console.log("[bytebot-lite] reference worker online");
  while (true) {
    try {
      const count = await processPendingReferences(8);
      if (count === 0) {
        await sleep(REFERENCE_POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error("[bytebot-lite] reference worker error", error);
      await sleep(REFERENCE_POLL_INTERVAL_MS);
    }
  }
}

async function runWorkers() {
  const workers = Array.from({ length: CONCURRENCY }, (_, index) => workerLoop(index + 1));
  await Promise.all(workers);
}

startTeachServer();
referenceLoop().catch((error) => {
  console.error("[bytebot-lite] reference worker boot failed", error);
});
runWorkers().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`[bytebot-lite] worker boot failed: ${message}`);
  process.exit(1);
});
