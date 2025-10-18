// @ts-nocheck
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
import {
  buildComparableEbayUrls,
  buildEbaySoldUrlFromText,
  extractCardAttributes,
} from "@tenkings/shared";
import { extractTextFromImage } from "./processors/vision";
import { estimateValue } from "./processors/valuation";
import { matchPlayerFromOcr } from "./sportsdb/matcher";
import { classifyAsset } from "./processors/ximilar";
import { gradeCard } from "./processors/grading";

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

function normalizeStorageKey(storageKey: string) {
  return storageKey.replace(/\\/g, "/");
}

function deriveThumbnailKey(storageKey: string) {
  const normalized = normalizeStorageKey(storageKey);
  const ext = path.posix.extname(normalized);
  const baseName = path.posix.basename(normalized, ext);
  const dir = path.posix.dirname(normalized);
  const thumbName = `${baseName}-thumbnail.webp`;
  return dir === "." ? thumbName : `${dir}/${thumbName}`;
}

async function persistThumbnail(buffer: Buffer, storageKey: string): Promise<string | null> {
  if (config.storageMode === "mock") {
    return `data:image/webp;base64,${buffer.toString("base64")}`;
  }

  const thumbnailKey = deriveThumbnailKey(storageKey);

  if (config.storageMode === "local") {
    const filePath = path.join(config.localStorageRoot, thumbnailKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    const cleanedKey = thumbnailKey.replace(/^\/+/, "");
    return `${config.storagePublicPrefix}/${cleanedKey}`;
  }

  console.warn(`[processing-service] storage mode ${config.storageMode} not supported for thumbnails; using data URI fallback`);
  return `data:image/webp;base64,${buffer.toString("base64")}`;
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
  const playerMatch = await matchPlayerFromOcr({
    ocrText: normalizedOcr,
    attributes,
  });
  const enhancedAttributes = {
    ...attributes,
    playerName: playerMatch.resolvedName ?? attributes.playerName,
    teamName: playerMatch.resolvedTeam ?? attributes.teamName,
  };
  const generatedEbayUrl = buildEbaySoldUrlFromText(normalizedOcr);
  const comparableUrls = buildComparableEbayUrls({
    ocrText: normalizedOcr,
    attributes: enhancedAttributes,
  });

  let thumbnailUrl: string | null = null;
  try {
    const thumbnailBuffer = await sharp(buffer)
      .rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    thumbnailUrl = await persistThumbnail(thumbnailBuffer, asset.storageKey);
  } catch (thumbnailError) {
    const message = thumbnailError instanceof Error ? thumbnailError.message : String(thumbnailError);
    console.warn(`[processing-service] failed to generate thumbnail for asset ${asset.id}: ${message}`);
  }

  await prisma.$transaction(
    async (tx) => {
      const updateData: Prisma.CardAssetUpdateInput = {
        processingStartedAt: startedAt,
        status: CardAssetStatus.CLASSIFY_PENDING,
        ocrText: vision.text,
        ocrJson,
        classificationJson: toInputJson(enhancedAttributes),
        errorMessage: null,
      };
      if (thumbnailUrl) {
        (updateData as any).thumbnailUrl = thumbnailUrl;
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
      (updateData as any).sportsDbPlayerId = playerMatch.playerId;
      (updateData as any).sportsDbMatchConfidence = playerMatch.confidence;
      (updateData as any).resolvedPlayerName = playerMatch.resolvedName;
      (updateData as any).resolvedTeamName = playerMatch.resolvedTeam;
      (updateData as any).playerStatsSnapshot = playerMatch.snapshot ?? JSON_NULL;
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
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );
}

async function handleClassifyJob(job: ProcessingJob) {
  const asset = await prisma.cardAsset.findUnique({ where: { id: job.cardAssetId } });
  if (!asset) {
    throw new Error(`Card asset ${job.cardAssetId} missing`);
  }

  const buffer = await loadAssetBuffer(asset);
  const base64 = buffer.toString("base64");
  const approxBytes = Math.ceil((base64.length * 3) / 4);

  console.log(
    `[processing-service] CLASSIFY asset=${asset.id} ximilarKey=${Boolean(config.ximilarApiKey)}`
  );

  let ximilarClassification = null;
  try {
    ximilarClassification = await classifyAsset({
      imageBase64: base64,
      ocrText: asset.ocrText ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[processing-service] Ximilar classification failed for ${asset.id}: ${message}`);
  }

  const classificationSnapshot = ximilarClassification?.snapshot ?? null;
  const bestMatch = ximilarClassification?.bestMatch ?? null;
  const classificationSummary = classificationSnapshot?.summary ?? ximilarClassification?.summary ?? {
    playerName: null,
    teamName: null,
    year: null,
    setName: null,
  };

  const attributes = extractCardAttributes(asset.ocrText, {
    bestMatch,
  });

  const isGraded = classificationSnapshot?.graded === "yes";
  const shouldUseSportsDb = classificationSnapshot?.categoryType === "sport";

  const playerMatch = shouldUseSportsDb
    ? await matchPlayerFromOcr({
        ocrText: asset.ocrText,
        attributes,
        classificationHints: ximilarClassification
          ? {
              bestMatch,
              labels: ximilarClassification.labels.map((entry) => entry.label),
              tags: ximilarClassification.tags,
            }
          : undefined,
      })
    : {
        playerId: null,
        confidence: classificationSnapshot?.bestMatchScore ?? 0,
        resolvedName: attributes.playerName ?? classificationSummary.playerName ?? null,
        resolvedTeam: attributes.teamName ?? classificationSummary.teamName ?? null,
        snapshot: null,
      };

  let grading = null;
  if (!isGraded) {
    try {
      grading = await gradeCard({
        imageBase64: base64,
        approximateBytes: approxBytes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[processing-service] Ximilar grading failed for ${asset.id}: ${message}`);
    }
  }

  const aiGradeFinal = grading?.finalGrade ?? null;
  const aiGradePsaEquivalent = aiGradeFinal
    ? Math.min(10, Math.max(1, Math.round(aiGradeFinal)))
    : null;
  const aiGradeRangeLow = aiGradeFinal
    ? Math.max(1, Math.floor(aiGradeFinal - 0.5))
    : null;
  const aiGradeRangeHigh = aiGradeFinal
    ? Math.min(10, Math.ceil(aiGradeFinal + 0.5))
    : null;

  const comparableUrls = buildComparableEbayUrls({
    ocrText: asset.ocrText,
    bestMatch,
    attributes,
    aiGradePsa: aiGradePsaEquivalent ?? undefined,
    isGraded,
  });

  await prisma.$transaction(
    async (tx) => {
      const updateData: Prisma.CardAssetUpdateInput = {
        classificationJson: toInputJson(attributes),
        errorMessage: null,
        status: CardAssetStatus.VALUATION_PENDING,
      };

      const updateDataAny = updateData as any;

      if (classificationSnapshot) {
        updateDataAny.classificationSourcesJson = toInputJson(classificationSnapshot);
      }

      updateDataAny.sportsDbPlayerId = playerMatch.playerId;
      updateDataAny.sportsDbMatchConfidence = playerMatch.confidence;
      updateDataAny.resolvedPlayerName = playerMatch.resolvedName;
      updateDataAny.resolvedTeamName = playerMatch.resolvedTeam;
      updateDataAny.playerStatsSnapshot = playerMatch.snapshot ?? JSON_NULL;

      if (grading) {
        updateDataAny.aiGradingJson = toInputJson(grading.raw);
        updateDataAny.aiGradeFinal = aiGradeFinal;
        updateDataAny.aiGradeLabel = grading.conditionLabel;
        updateDataAny.aiGradePsaEquivalent = aiGradePsaEquivalent;
        updateDataAny.aiGradeRangeLow = aiGradeRangeLow;
        updateDataAny.aiGradeRangeHigh = aiGradeRangeHigh;
        updateDataAny.aiGradeGeneratedAt = new Date();
      }

      const existing = asset as unknown as {
        ebaySoldUrl?: string | null;
        ebaySoldUrlVariant?: string | null;
        ebaySoldUrlHighGrade?: string | null;
        ebaySoldUrlPlayerComp?: string | null;
        ebaySoldUrlAiGrade?: string | null;
      };

      if (!existing.ebaySoldUrl && comparableUrls.exact) {
        updateDataAny.ebaySoldUrl = comparableUrls.exact;
      }
      if (!existing.ebaySoldUrlVariant && comparableUrls.variant) {
        updateDataAny.ebaySoldUrlVariant = comparableUrls.variant;
      }
      if (!existing.ebaySoldUrlHighGrade && comparableUrls.premiumHighGrade) {
        updateDataAny.ebaySoldUrlHighGrade = comparableUrls.premiumHighGrade;
      }
      if (!existing.ebaySoldUrlPlayerComp && comparableUrls.playerComp) {
        updateDataAny.ebaySoldUrlPlayerComp = comparableUrls.playerComp;
      }
      if (!existing.ebaySoldUrlAiGrade && comparableUrls.aiGradeComp) {
        updateDataAny.ebaySoldUrlAiGrade = comparableUrls.aiGradeComp;
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
