import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  buildStorageKey,
  ensureLocalRoot,
  getStorageMode,
  publicUrlFor,
} from "../../../../../lib/server/storage";
import { MAX_UPLOAD_BYTES } from "../../../../../lib/server/uploads";
import { withAdminCors } from "../../../../../lib/server/cors";

interface PresignResponse {
  uploadUrl: string;
  photoId: string;
  fields: Record<string, string>;
  publicUrl: string;
  storageMode: string;
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);

    const { fileName, size, mimeType, cardAssetId, kind } = (req.body ?? {}) as {
      fileName?: unknown;
      size?: unknown;
      mimeType?: unknown;
      cardAssetId?: unknown;
      kind?: unknown;
    };

    if (typeof cardAssetId !== "string" || !cardAssetId.trim()) {
      return res.status(400).json({ message: "cardAssetId is required" });
    }

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

    if (typeof kind !== "string" || !kind.trim()) {
      return res.status(400).json({ message: "kind is required" });
    }

    const asset = await prisma.cardAsset.findFirst({
      where: { id: cardAssetId, batch: { uploadedById: admin.user.id } },
      include: { batch: true },
    });

    if (!asset || !asset.batch) {
      return res.status(404).json({ message: "Card asset not found" });
    }

    const photoId = randomUUID().replace(/-/g, "");
    const storageKey = buildStorageKey(admin.user.id, photoId, fileName);
    const mode = getStorageMode();

    if (mode === "s3") {
      throw new Error("S3 storage mode is not configured yet. Set CARD_STORAGE_MODE=local or mock.");
    }

    if (mode === "local") {
      await ensureLocalRoot();
    }

    await prisma.cardPhoto.create({
      data: {
        id: photoId,
        cardAssetId: asset.id,
        kind: kind as any,
        storageKey,
        fileName,
        fileSize: Math.round(size),
        mimeType,
        imageUrl: publicUrlFor(storageKey),
        createdById: admin.user.id,
      },
    });

    const uploadUrl =
      mode === "local" || mode === "mock"
        ? `/api/admin/kingsreview/photos/file?photoId=${photoId}`
        : "https://example-upload-configure-s3";

    return res.status(200).json({
      uploadUrl,
      photoId,
      fields: {},
      publicUrl: publicUrlFor(storageKey),
      storageMode: mode,
    } as PresignResponse);
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
};

export default withAdminCors(handler);
