import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import {
  CardAssetStatus,
  CardReviewStage,
  Prisma,
  prisma,
} from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import {
  buildThumbnailKey,
  getStorageMode,
  normalizeStorageUrl,
  publicUrlFor,
  readStorageBuffer,
  uploadBuffer,
} from "../../../../lib/server/storage";
import { createThumbnailPng } from "../../../../lib/server/images";
import { generateAndUploadVariants } from "../../../../lib/server/imageVariants";
import { withAdminCors } from "../../../../lib/server/cors";

interface CompletePayload {
  assetId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  size?: unknown;
  reviewStage?: unknown;
}

interface CompleteResponse {
  message: string;
  imageUrl?: string;
  thumbnailUrl?: string | null;
  cdnHdUrl?: string | null;
  cdnThumbUrl?: string | null;
}

const REVIEW_STAGE_VALUES = Object.values(CardReviewStage);
const REVIEW_STAGE_SET = new Set<string>(REVIEW_STAGE_VALUES);
const LEGACY_REVIEW_STAGE_ALIASES: Record<string, CardReviewStage> = {
  ADD_ITEMS: CardReviewStage.READY_FOR_HUMAN_REVIEW,
};

const handler: NextApiHandler<CompleteResponse> = async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CompleteResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const payload = req.body as CompletePayload;

    if (typeof payload?.assetId !== "string" || !payload.assetId.trim()) {
      return res.status(400).json({ message: "assetId is required" });
    }
    if (typeof payload.reviewStage !== "string" && typeof payload.reviewStage !== "undefined") {
      return res.status(400).json({ message: "reviewStage must be a string when provided" });
    }

    const asset = await prisma.cardAsset.findUnique({
      where: { id: payload.assetId },
      include: { batch: true },
    });

    if (!asset || !asset.batch) {
      return res.status(404).json({ message: "Asset not found" });
    }

    if (asset.batch.uploadedById !== admin.user.id) {
      return res.status(403).json({ message: "You do not own this batch" });
    }

    const reviewStageRaw = typeof payload.reviewStage === "string" ? payload.reviewStage.trim() : "";
    if (typeof payload.reviewStage === "string" && !reviewStageRaw) {
      return res.status(400).json({ message: "reviewStage cannot be empty when provided" });
    }
    const reviewStageAlias =
      reviewStageRaw && Object.prototype.hasOwnProperty.call(LEGACY_REVIEW_STAGE_ALIASES, reviewStageRaw)
        ? LEGACY_REVIEW_STAGE_ALIASES[reviewStageRaw]
        : undefined;
    if (reviewStageRaw && !REVIEW_STAGE_SET.has(reviewStageRaw) && !reviewStageAlias) {
      return res.status(400).json({
        message: `reviewStage must be one of: ${REVIEW_STAGE_VALUES.join(", ")}, ADD_ITEMS`,
      });
    }
    const resolvedReviewStage = reviewStageRaw
      ? REVIEW_STAGE_SET.has(reviewStageRaw)
        ? (reviewStageRaw as CardReviewStage)
        : reviewStageAlias
      : asset.reviewStage ?? null;
    const resolvedImageUrl = normalizeStorageUrl(publicUrlFor(asset.storageKey)) ?? publicUrlFor(asset.storageKey);

    const updates: Prisma.CardAssetUpdateInput = {
      processingStartedAt: null,
      processingCompletedAt: null,
      errorMessage: null,
      imageUrl: resolvedImageUrl,
    };

    if (typeof payload.fileName === "string" && payload.fileName.trim()) {
      updates.fileName = payload.fileName;
    }

    if (typeof payload.mimeType === "string" && payload.mimeType.trim()) {
      updates.mimeType = payload.mimeType;
    }

    if (typeof payload.size === "number" && Number.isFinite(payload.size) && payload.size > 0) {
      updates.fileSize = Math.round(payload.size);
    }

    await prisma.cardAsset.update({
      where: { id: asset.id },
      data: updates,
    });

    const thumbnailKey = buildThumbnailKey(asset.storageKey);
    let thumbnailUrl: string | null = asset.thumbnailUrl ?? null;
    let cdnHdUrl: string | null = asset.cdnHdUrl ?? null;
    let cdnThumbUrl: string | null = asset.cdnThumbUrl ?? null;
    const ensureThumbnail = async (sourceBuffer: Buffer) => {
      try {
        const thumbBuffer = await createThumbnailPng(sourceBuffer);
        const thumbUrl = await uploadBuffer(thumbnailKey, thumbBuffer, "image/png");
        return normalizeStorageUrl(thumbUrl) ?? thumbUrl;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.cardAsset.update({
          where: { id: asset.id },
          data: { errorMessage: `Thumbnail failed: ${message}` },
        });
        return null;
      }
    };

    let sourceBuffer: Buffer | null = null;
    try {
      sourceBuffer = await readStorageBuffer(asset.storageKey);
      thumbnailUrl = await ensureThumbnail(sourceBuffer);
      if (thumbnailUrl) {
        await prisma.cardAsset.update({
          where: { id: asset.id },
          data: { thumbnailUrl },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.cardAsset.update({
        where: { id: asset.id },
        data: {
          errorMessage: `Source image unavailable: ${message}`,
          status: CardAssetStatus.UPLOADING,
          reviewStage: null,
          reviewStageUpdatedAt: null,
        },
      });
      return res.status(409).json({
        message: "Uploaded file is not available in storage yet. Retry the upload once.",
      });
    }

    if (getStorageMode() === "s3" && sourceBuffer) {
      try {
        const variants = await generateAndUploadVariants(sourceBuffer, `cards/${asset.id}`);
        cdnHdUrl = normalizeStorageUrl(variants.hdUrl) ?? variants.hdUrl;
        cdnThumbUrl = normalizeStorageUrl(variants.thumbUrl) ?? variants.thumbUrl;
        await prisma.cardAsset.update({
          where: { id: asset.id },
          data: {
            cdnHdUrl,
            cdnThumbUrl,
          },
        });
      } catch (error) {
        console.error(`[imageVariants] Failed to generate variants for ${asset.id}:`, error);
      }
    }

    await prisma.cardAsset.update({
      where: { id: asset.id },
      data: {
        imageUrl: resolvedImageUrl,
        status: CardAssetStatus.READY,
        reviewStage: resolvedReviewStage,
        reviewStageUpdatedAt: resolvedReviewStage ? new Date() : null,
      },
    });

    return res.status(200).json({
      message: "Upload recorded.",
      imageUrl: resolvedImageUrl,
      thumbnailUrl,
      cdnHdUrl,
      cdnThumbUrl,
    });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
};

export default withAdminCors(handler);
