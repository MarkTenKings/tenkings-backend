import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  type Prisma,
  CardAssetStatus,
  ProcessingJobStatus,
  ProcessingJobType,
  enqueueProcessingJob,
  fetchNextQueuedJob,
  markJobStatus,
  prisma,
  type ProcessingJob,
} from "@tenkings/database";
import { config } from "./config";
import { buildComparableEbayUrls, buildEbaySoldUrlFromText } from "@tenkings/shared";
import { extractTextFromImage } from "./processors/vision";
import { classifyAsset } from "./processors/ximilar";
import { estimateValue } from "./processors/valuation";

const JSON_NULL = null as unknown as Prisma.NullableJsonNullValueInput;
const TRANSACTION_TIMEOUT_MS =
  Number.isFinite(config.transactionTimeoutMs) && config.transactionTimeoutMs > 0
    ? config.transactionTimeoutMs
    : 15_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetries<T>(fn: () => Promise<T>, jobId: string, retries: number) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > retries) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[processing-service] job ${jobId} attempt ${attempt} failed: ${message}`);
      await sleep(500 * attempt);
    }
  }
  throw new Error("retry loop exhausted");
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}



async function loadAssetBuffer(storageKey: string) {
  if (config.storageMode !== "local") {
    throw new Error(`Storage mode ${config.storageMode} not yet supported`);
  }
  const filePath = path.join(config.localStorageRoot, storageKey);
  return fs.readFile(filePath);
}

async function loadAssetBase64(storageKey: string) {
  const buffer = await loadAssetBuffer(storageKey);
  return buffer.toString("base64");
}

async function prepareXimilarBase64(buffer: Buffer) {
  const maxBytes = Number.isFinite(config.ximilarMaxImageBytes) && config.ximilarMaxImageBytes > 0
    ? config.ximilarMaxImageBytes
    : null;

  if (!maxBytes || buffer.byteLength <= maxBytes) {
    return buffer.toString("base64");
  }

  const resizeOptions = {
    width: 1600,
    height: 1600,
    fit: "inside" as const,
    withoutEnlargement: true,
  };

  let quality = 85;
  let attempt = 0;
  let output = buffer;

  while (quality >= 40) {
    const pipeline = sharp(buffer)
      .resize(resizeOptions)
      .jpeg({ quality, mozjpeg: true });

    output = await pipeline.toBuffer();

    if (output.byteLength <= maxBytes) {
      break;
    }

    quality -= 10;
    attempt += 1;
  }

  if (output.byteLength > maxBytes) {
    console.warn(
      `[processing-service] Ximilar payload still above limit after resizing (size=${output.byteLength} limit=${maxBytes})`
    );
  } else {
    console.log(
      `[processing-service] compressed asset for Ximilar (${buffer.byteLength} -> ${output.byteLength} bytes, quality ${quality}, attempts ${attempt})`
    );
  }

  return output.toString("base64");
}

async function handleOcrJob(job: ProcessingJob) {
  const asset = await prisma.cardAsset.findUnique({ where: { id: job.cardAssetId } });
  if (!asset) {
    throw new Error(`Card asset ${job.cardAssetId} missing`);
  }

  const existingEbayUrl = (asset as unknown as { ebaySoldUrl?: string | null }).ebaySoldUrl ?? null;
  const startedAt = asset.processingStartedAt ?? new Date();
  const base64 = await loadAssetBase64(asset.storageKey);
  console.log(
    `[processing-service] OCR begin asset=${asset.id} visionKey=${Boolean(config.googleVisionApiKey)} storageMode=${config.storageMode}`
  );

  const vision = await extractTextFromImage(base64);
  const ocrJson =
    vision.raw === null || vision.raw === undefined ? JSON_NULL : toInputJson(vision.raw);
  const generatedEbayUrl = buildEbaySoldUrlFromText(vision.text ?? asset.ocrText ?? undefined);
  const comparableUrls = buildComparableEbayUrls({ ocrText: vision.text ?? asset.ocrText ?? undefined });

  await prisma.$transaction(
    async (tx) => {
      const updateData: Prisma.CardAssetUpdateInput = {
        processingStartedAt: startedAt,
        status: CardAssetStatus.OCR_COMPLETE,
        ocrText: vision.text,
        ocrJson,
        errorMessage: null,
      };
      if (!existingEbayUrl && generatedEbayUrl) {
        (updateData as any).ebaySoldUrl = generatedEbayUrl;
      }
      if ((asset as any).ebaySoldUrlVariant == null && comparableUrls.variant) {
        (updateData as any).ebaySoldUrlVariant = comparableUrls.variant;
      }
      if ((asset as any).ebaySoldUrlHighGrade == null && comparableUrls.premiumHighGrade) {
        (updateData as any).ebaySoldUrlHighGrade = comparableUrls.premiumHighGrade;
      }
      if ((asset as any).ebaySoldUrlPlayerComp == null && comparableUrls.playerComp) {
        (updateData as any).ebaySoldUrlPlayerComp = comparableUrls.playerComp;
      }
      await tx.cardAsset.update({
        where: { id: asset.id },
        data: updateData,
      });

      await enqueueProcessingJob({
        client: tx,
        cardAssetId: asset.id,
        type: ProcessingJobType.CLASSIFY,
        payload: { sourceJobId: job.id },
      });

      await tx.cardAsset.update({
        where: { id: asset.id },
        data: { status: CardAssetStatus.CLASSIFY_PENDING },
      });
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );
}

async function handleClassifyJob(job: ProcessingJob) {
  const asset = await prisma.cardAsset.findUnique({ where: { id: job.cardAssetId } });
  if (!asset) {
    throw new Error(`Card asset ${job.cardAssetId} missing`);
  }

  const originalBuffer = await loadAssetBuffer(asset.storageKey);
  const base64 = await prepareXimilarBase64(originalBuffer);
  console.log(
    `[processing-service] CLASSIFY begin asset=${asset.id} ximilarKey=${Boolean(config.ximilarApiKey)}`
  );

  const classification = await classifyAsset({ imageBase64: base64, ocrText: asset.ocrText ?? null });
  const classificationJson = toInputJson({
    endpoint: classification.endpoint,
    labels: classification.labels,
    tags: classification.tags,
    bestMatch: classification.bestMatch,
    raw: classification.raw ?? null,
  });

  await prisma.$transaction(
    async (tx) => {
      const classificationUpdate: Prisma.CardAssetUpdateInput = {
        status: CardAssetStatus.CLASSIFIED,
        classificationJson,
        errorMessage: null,
      };

      const comparables = buildComparableEbayUrls({
        ocrText: asset.ocrText ?? undefined,
        bestMatch: classification.bestMatch ?? undefined,
      });
      if (comparables.variant && asset.ebaySoldUrlVariant !== comparables.variant) {
        (classificationUpdate as any).ebaySoldUrlVariant = comparables.variant;
      }
      if (comparables.premiumHighGrade && asset.ebaySoldUrlHighGrade !== comparables.premiumHighGrade) {
        (classificationUpdate as any).ebaySoldUrlHighGrade = comparables.premiumHighGrade;
      }
      if (comparables.playerComp && asset.ebaySoldUrlPlayerComp !== comparables.playerComp) {
        (classificationUpdate as any).ebaySoldUrlPlayerComp = comparables.playerComp;
      }

      await tx.cardAsset.update({
        where: { id: asset.id },
        data: classificationUpdate,
      });

      await enqueueProcessingJob({
        client: tx,
        cardAssetId: asset.id,
        type: ProcessingJobType.VALUATION,
        payload: { sourceJobId: job.id },
      });

      await tx.cardAsset.update({
        where: { id: asset.id },
        data: { status: CardAssetStatus.VALUATION_PENDING },
      });
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );
}
async function handleValuationJob(job: ProcessingJob) {
  const asset = await prisma.cardAsset.findUnique({ where: { id: job.cardAssetId } });
  if (!asset) {
    throw new Error(`Card asset ${job.cardAssetId} missing`);
  }

  const now = new Date();
  const query = asset.ocrText?.split(/\n+/)[0]?.slice(0, 120) ?? asset.fileName;
  console.log(
    `[processing-service] VALUATION begin asset=${asset.id} query="${query}" ebayToken=${Boolean(config.ebayBearerToken)}`
  );

  const valuation = await estimateValue({ query });

  await prisma.$transaction(
    async (tx) => {
      await tx.cardAsset.update({
        where: { id: asset.id },
        data: {
          status: CardAssetStatus.READY,
          valuationMinor: valuation.amountMinor,
          valuationCurrency: valuation.currency,
          valuationSource: valuation.source,
          marketplaceUrl: valuation.marketplaceUrl,
          processingCompletedAt: now,
          errorMessage: null,
        },
      });

      const readyCount = await tx.cardAsset.count({
        where: { batchId: asset.batchId, status: CardAssetStatus.READY },
      });
      const batch = await tx.cardBatch.findUnique({ where: { id: asset.batchId } });
      if (batch) {
        const status = readyCount >= batch.totalCount && batch.totalCount > 0 ? "READY" : "PROCESSING";
        await tx.cardBatch.update({
          where: { id: batch.id },
          data: {
            processedCount: readyCount,
            status,
          },
        });
      }
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );
}

async function processJob(job: ProcessingJob) {
  switch (job.type) {
    case ProcessingJobType.OCR:
      await handleOcrJob(job);
      break;
    case ProcessingJobType.CLASSIFY:
      await handleClassifyJob(job);
      break;
    case ProcessingJobType.VALUATION:
      await handleValuationJob(job);
      break;
    default:
      throw new Error(`Unsupported job type: ${job.type}`);
  }
}

async function runLoop() {
  console.log("[processing-service] worker online, polling interval", config.pollIntervalMs, "ms");
  while (true) {
    const job = await fetchNextQueuedJob();
    if (!job) {
      await sleep(config.pollIntervalMs);
      continue;
    }

    console.log("[processing-service] picked job", job.id, job.type);

    try {
      await runWithRetries(() => processJob(job), job.id, config.maxRetries);
      await markJobStatus(job.id, ProcessingJobStatus.COMPLETE);
      console.log("[processing-service] job", job.id, "completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown failure";
      await prisma.cardAsset.update({
        where: { id: job.cardAssetId },
        data: {
          status: CardAssetStatus.ERROR,
          errorMessage: message,
        },
      });
      await markJobStatus(job.id, ProcessingJobStatus.FAILED, message);
      console.error("[processing-service] job", job.id, "failed:", message);
    }
  }
}

runLoop().catch((error) => {
  console.error("[processing-service] fatal error", error);
  process.exit(1);
});
