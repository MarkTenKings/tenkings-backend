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
import { sleep } from "./utils";

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
      notes?: string | null;
    }>;
  }>;
};

const POLL_INTERVAL_MS = Number(process.env.BYTEBOT_LITE_POLL_INTERVAL_MS ?? 3000);
const CONCURRENCY = Math.max(1, Number(process.env.BYTEBOT_LITE_CONCURRENCY ?? 1));
const HEADLESS = (process.env.BYTEBOT_LITE_HEADLESS ?? "true").toLowerCase() !== "false";
const VIEWPORT_WIDTH = Number(process.env.BYTEBOT_LITE_VIEWPORT_WIDTH ?? 1280);
const VIEWPORT_HEIGHT = Number(process.env.BYTEBOT_LITE_VIEWPORT_HEIGHT ?? 720);

async function processJob(
  workerId: number,
  job: {
    id: string;
    cardAssetId: string | null;
    searchQuery: string;
    sources: string[];
    maxComps: number;
  },
  browserType = chromium
) {
  const upload = createSpacesUploader();
  const browser = await browserType.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });

    const sources = job.sources ?? [];
    if (sources.length === 0) {
      throw new Error("No sources provided.");
    }

    const results = [];
    for (const source of sources) {
      if (source === "ebay_sold") {
        results.push(
          await fetchEbaySoldComps({
            context,
            query: job.searchQuery,
            maxComps: job.maxComps,
            jobId: job.id,
            upload,
          })
        );
        continue;
      }

      if (source === "tcgplayer") {
        results.push(
          await fetchTcgplayerComps({
            context,
            query: job.searchQuery,
            maxComps: job.maxComps,
            jobId: job.id,
            upload,
          })
        );
        continue;
      }
    }

    await context.close();

    const payload: JobResult = {
      jobId: job.id,
      cardAssetId: job.cardAssetId ?? null,
      searchQuery: job.searchQuery,
      generatedAt: new Date().toISOString(),
      sources: results,
    };

    await markBytebotLiteJobStatus(job.id, BytebotLiteJobStatus.COMPLETE, undefined, payload);
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
    await browser.close();
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
    });
  }
}

async function runWorkers() {
  const workers = Array.from({ length: CONCURRENCY }, (_, index) => workerLoop(index + 1));
  await Promise.all(workers);
}

runWorkers().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`[bytebot-lite] worker boot failed: ${message}`);
  process.exit(1);
});
