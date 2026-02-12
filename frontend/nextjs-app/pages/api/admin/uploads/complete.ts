import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import {
  CardAssetStatus,
  ProcessingJobType,
  Prisma,
  enqueueProcessingJob,
  prisma,
} from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { buildSiteUrl } from "../../../../lib/server/urls";
import { readStorageBuffer, uploadBuffer } from "../../../../lib/server/storage";
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

    const photoroomKey = (process.env.PHOTOROOM_API_KEY ?? "").trim();
    const photoroomEnabled = Boolean(photoroomKey);

    const updates: Prisma.CardAssetUpdateInput = {
      status: photoroomEnabled ? CardAssetStatus.UPLOADED : CardAssetStatus.OCR_PENDING,
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

      if (!photoroomEnabled) {
        await enqueueProcessingJob({
          client: tx,
          cardAssetId: asset.id,
          type: ProcessingJobType.OCR,
        });
      }
    });

    if (photoroomEnabled) {
      try {
        const sourceBuffer = await readStorageBuffer(asset.storageKey);
        const form = new FormData();
        const blob = new Blob([sourceBuffer], { type: "image/png" });
        form.append("imageFile", blob, "capture.png");
        form.append("removeBackground", "true");
        form.append("padding", "0.05");
        form.append("scaling", "fit");
        form.append("outputSize", "croppedSubject");
        form.append("export.format", "png");
        form.append("background.color", "transparent");

        const response = await fetch("https://image-api.photoroom.com/v2/edit", {
          method: "POST",
          headers: {
            "x-api-key": photoroomKey,
            Accept: "image/png, application/json",
          },
          body: form,
        });

        if (!response.ok) {
          const message = await response.text().catch(() => "");
          throw new Error(`PhotoRoom request failed (${response.status}): ${message}`);
        }

        const processedBuffer = Buffer.from(await response.arrayBuffer());
        const updatedUrl = await uploadBuffer(asset.storageKey, processedBuffer, "image/png");
        const normalizedUrl = /^https?:\/\//i.test(updatedUrl) ? updatedUrl : buildSiteUrl(updatedUrl);

        await prisma.cardAsset.update({
          where: { id: asset.id },
          data: {
            imageUrl: normalizedUrl,
            status: CardAssetStatus.OCR_PENDING,
            processingStartedAt: null,
            processingCompletedAt: null,
            errorMessage: null,
            fileSize: processedBuffer.length,
            mimeType: "image/png",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.cardAsset.update({
          where: { id: asset.id },
          data: {
            status: CardAssetStatus.OCR_PENDING,
            errorMessage: `PhotoRoom failed: ${message}`,
          },
        });
      } finally {
        await enqueueProcessingJob({
          cardAssetId: asset.id,
          type: ProcessingJobType.OCR,
        });
      }
    }

    return res.status(200).json({ message: "Upload recorded." });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
};

export default withAdminCors(handler);
