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
import { buildComparableEbayUrls, buildEbaySoldUrlFromText, extractCardAttributes } from "@tenkings/shared";
import { extractTextFromImage } from "./processors/vision";
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



function extractMockBase64(asset: { id: string; imageUrl: string | null }) {
  if (!asset.imageUrl) {
    throw new Error(`[processing-service] asset ${asset.id} missing image data for mock storage`);
  }
  const match = asset.imageUrl.match(/^data:(?:[^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error(`[processing-service] asset ${asset.id} imageUrl is not a base64 data URI`);
  }
  return match[1];
}

async function loadAssetBuffer(asset: { id: string; storageKey: string; imageUrl: string | null }) {
  if (config.storageMode === "mock") {
    const base64 = extractMockBase64(asset);
    return Buffer.from(base64, "base64");
  }
  if (config.storageMode === "local") {
    const filePath = path.join(config.localStorageRoot, asset.storageKey);
    return fs.readFile(filePath);
  }
  throw new Error(`Storage mode ${config.storageMode} not yet supported`);
}

async function loadAssetBase64(asset: { id: string; storageKey: string; imageUrl: string | null }) {
  if (config.storageMode === "mock") {
    return extractMockBase64(asset);
  }
  const buffer = await loadAssetBuffer(asset);
  return buffer.toString("base64");
}

async function handleOcrJob(job: ProcessingJob) {
  const asset = await prisma.cardAsset.findUnique({ where: { id: job.cardAssetId } });
  if (!asset) {
    throw new Error(`Card asset ${job.cardAssetId} missing`);
  }

  const existingEbayUrl = (asset as unknown as { ebaySoldUrl?: string | null }).ebaySoldUrl ?? null;
  const startedAt = asset.processingStartedAt ?? new Date();
  const buffer = await loadAssetBuffer(asset);
  const base64 = buffer.toString("base64");
  console.log(
    `[processing-service] OCR begin asset=${asset.id} visionKey=${Boolean(config.googleVisionApiKey)} storageMode=${config.storageMode}`
  );

  const vision = await extractTextFromImage(base64);
  const ocrJson =
    vision.raw === null || vision.raw === undefined ? JSON_NULL : toInputJson(vision.raw);
  const normalizedOcr = vision.text ?? asset.ocrText ?? undefined;
  const attributes = extractCardAttributes(normalizedOcr);
  const generatedEbayUrl = buildEbaySoldUrlFromText(normalizedOcr);
  const comparableUrls = buildComparableEbayUrls({
    ocrText: normalizedOcr,
    attributes,
  });

  let thumbnailDataUrl: string | null = null;
  try {
    const thumbnailBuffer = await sharp(buffer)
      .rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    thumbnailDataUrl = `data:image/webp;base64,${thumbnailBuffer.toString("base64")}`;
  } catch (thumbnailError) {
    const message = thumbnailError instanceof Error ? thumbnailError.message : String(thumbnailError);
    console.warn(`[processing-service] failed to generate thumbnail for asset ${asset.id}: ${message}`);
  }

  await prisma.$transaction(
    async (tx) => {
      const updateData: Prisma.CardAssetUpdateInput = {
        processingStartedAt: startedAt,
        status: CardAssetStatus.OCR_COMPLETE,
        ocrText: vision.text,
        ocrJson,
        classificationJson: toInputJson(attributes),
        errorMessage: null,
      };
      if (thumbnailDataUrl) {
        (updateData as any).thumbnailUrl = thumbnailDataUrl;
      }
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

async function handleClassifyJob(job: ProcessingJob) {
  const asset = await prisma.cardAsset.findUnique({ where: { id: job.cardAssetId } });
  if (!asset) {
    throw new Error(`Card asset ${job.cardAssetId} missing`);
  }

  console.log(`[processing-service] CLASSIFY skipped for asset=${asset.id} (Ximilar disabled)`);

  await prisma.$transaction(
    async (tx) => {
      await tx.cardAsset.update({
        where: { id: asset.id },
        data: {
          status: CardAssetStatus.VALUATION_PENDING,
          errorMessage: null,
        },
      });

      await enqueueProcessingJob({
        client: tx,
        cardAssetId: asset.id,
        type: ProcessingJobType.VALUATION,
        payload: { sourceJobId: job.id, note: "classification_skipped" },
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

async function workerLoop(workerId: number) {
  console.log(
    `[processing-service] worker ${workerId} online (poll interval ${config.pollIntervalMs}ms)`
  );
  while (true) {
    const job = await fetchNextQueuedJob();
    if (!job) {
      await sleep(config.pollIntervalMs);
      continue;
    }

    console.log(
      `[processing-service] worker ${workerId} picked job ${job.id} (${job.type})`
    );

    try {
      await runWithRetries(() => processJob(job), job.id, config.maxRetries);
      await markJobStatus(job.id, ProcessingJobStatus.COMPLETE);
      console.log(`[processing-service] worker ${workerId} completed job ${job.id}`);
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
      console.error(
        `[processing-service] worker ${workerId} job ${job.id} failed: ${message}`
      );
    }
  }
}

async function runWorkers() {
  const workerCount = Math.max(1, config.concurrency);
  console.log(`[processing-service] starting ${workerCount} worker(s)`);
  await Promise.all(
    Array.from({ length: workerCount }, (_, index) => workerLoop(index + 1))
  );
}

runWorkers().catch((error) => {
  console.error("[processing-service] fatal error", error);
  process.exit(1);
});
