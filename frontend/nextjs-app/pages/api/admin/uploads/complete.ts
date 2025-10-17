import type { NextApiRequest, NextApiResponse } from "next";
import {
  CardAssetStatus,
  ProcessingJobType,
  Prisma,
  enqueueProcessingJob,
  prisma,
} from "@tenkings/database";
import { getStorageMode } from "../../../../lib/server/storage";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

interface CompletePayload {
  assetId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  size?: unknown;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ message: string }>) {
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

    const storageMode = getStorageMode();
    const mockMode = storageMode === "mock";

    const updates: Prisma.CardAssetUpdateInput = {
      status: mockMode ? CardAssetStatus.READY : CardAssetStatus.OCR_PENDING,
      processingStartedAt: mockMode ? new Date() : null,
      processingCompletedAt: mockMode ? new Date() : null,
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

      if (mockMode) {
        await tx.cardBatch.update({
          where: { id: asset.batchId },
          data: {
            processedCount: { increment: 1 },
          },
        });
      } else {
        await enqueueProcessingJob({
          client: tx,
          cardAssetId: asset.id,
          type: ProcessingJobType.OCR,
        });
      }
    });

    return res.status(200).json({ message: "Upload recorded." });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
