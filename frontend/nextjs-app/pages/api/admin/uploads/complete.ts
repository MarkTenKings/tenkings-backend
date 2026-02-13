import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import {
  CardAssetStatus,
  ProcessingJobType,
  Prisma,
  enqueueProcessingJob,
  prisma,
} from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { buildThumbnailKey, normalizeStorageUrl, readStorageBuffer, uploadBuffer } from "../../../../lib/server/storage";
import { createThumbnailPng } from "../../../../lib/server/images";
import { withAdminCors } from "../../../../lib/server/cors";

interface CompletePayload {
  assetId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  size?: unknown;
}

const handler: NextApiHandler<{ message: string }> = async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ message: string }>
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

    const updates: Prisma.CardAssetUpdateInput = {
      status: CardAssetStatus.OCR_PENDING,
      processingStartedAt: null,
      processingCompletedAt: null,
      errorMessage: null,
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

    await prisma.$transaction(async (tx) => {
      await tx.cardAsset.update({
        where: { id: asset.id },
        data: updates,
      });

      await enqueueProcessingJob({
        client: tx,
        cardAssetId: asset.id,
        type: ProcessingJobType.OCR,
      });
    });

    const thumbnailKey = buildThumbnailKey(asset.storageKey);
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

    try {
      const sourceBuffer = await readStorageBuffer(asset.storageKey);
      const thumbUrl = await ensureThumbnail(sourceBuffer);
      if (thumbUrl) {
        await prisma.cardAsset.update({
          where: { id: asset.id },
          data: { thumbnailUrl: thumbUrl },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.cardAsset.update({
        where: { id: asset.id },
        data: { errorMessage: `Thumbnail failed: ${message}` },
      });
    }

    return res.status(200).json({ message: "Upload recorded." });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
};

export default withAdminCors(handler);
