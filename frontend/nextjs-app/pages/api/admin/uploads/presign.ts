import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { CardAssetStatus, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import {
  buildStorageKey,
  ensureLocalRoot,
  getStorageMode,
  publicUrlFor,
} from "../../../../lib/server/storage";
import { MAX_UPLOAD_BYTES } from "../../../../lib/server/uploads";

interface PresignResponse {
  uploadUrl: string;
  assetId: string;
  batchId: string;
  fields: Record<string, string>;
  publicUrl: string;
  storageMode: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PresignResponse | { message: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);

    const { fileName, size, mimeType, batchId } = (req.body ?? {}) as {
      fileName?: unknown;
      size?: unknown;
      mimeType?: unknown;
      batchId?: unknown;
    };

    if (typeof fileName !== "string" || !fileName.trim()) {
      return res.status(400).json({ message: "fileName is required" });
    }

    if (typeof size !== "number" || Number.isNaN(size) || size <= 0) {
      return res.status(400).json({ message: "size must be a positive number" });
    }

    if (size > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ message: "File exceeds upload size limit" });
    }

    if (typeof mimeType !== "string" || !mimeType.trim()) {
      return res.status(400).json({ message: "mimeType is required" });
    }

    if (typeof batchId !== "string" && typeof batchId !== "undefined") {
      return res.status(400).json({ message: "batchId must be a string when provided" });
    }

    const assetId = randomUUID().replace(/-/g, "");
    const storageKey = buildStorageKey(admin.user.id, assetId, fileName);
    const mode = getStorageMode();

    if (mode === "s3") {
      throw new Error("S3 storage mode is not configured yet. Set CARD_STORAGE_MODE=local or mock.");
    }

    if (mode === "local") {
      await ensureLocalRoot();
    }

    const batch = await prisma.$transaction(async (tx) => {
      let activeBatchId = batchId ?? null;

      if (activeBatchId) {
        const existing = await tx.cardBatch.findUnique({ where: { id: activeBatchId } });
        if (!existing || existing.uploadedById !== admin.user.id) {
          throw new Error("Invalid batchId");
        }
        return existing;
      }

      return tx.cardBatch.create({
        data: {
          uploadedById: admin.user.id,
          label: `Batch ${new Date().toISOString()}`,
        },
      });
    });

    await prisma.$transaction(async (tx) => {
      await tx.cardAsset.create({
        data: {
          id: assetId,
          batchId: batch.id,
          storageKey,
          fileName,
          fileSize: Math.round(size),
          mimeType,
          imageUrl: publicUrlFor(storageKey),
          status: CardAssetStatus.UPLOADING,
        },
      });

      await tx.cardBatch.update({
        where: { id: batch.id },
        data: { totalCount: { increment: 1 } },
      });
    });

    const uploadUrl = mode === "local" || mode === "mock"
      ? `/api/admin/uploads/file?assetId=${assetId}`
      : "https://example-upload-configure-s3";

    const responseMode = mode === "mock" ? "local" : mode;

    return res.status(200).json({
      uploadUrl,
      assetId,
      batchId: batch.id,
      fields: {},
      publicUrl: publicUrlFor(storageKey),
      storageMode: responseMode,
    });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
