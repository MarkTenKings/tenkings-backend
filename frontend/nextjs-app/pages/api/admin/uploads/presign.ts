import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { CardAssetStatus, CardReviewStage, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import {
  buildStorageKey,
  ensureLocalRoot,
  getS3ObjectAcl,
  getStorageMode,
  presignUploadUrl,
  publicUrlFor,
} from "../../../../lib/server/storage";
import { MAX_UPLOAD_BYTES } from "../../../../lib/server/uploads";
import { withAdminCors } from "../../../../lib/server/cors";

interface PresignResponse {
  uploadUrl: string;
  assetId: string;
  batchId: string;
  fields: Record<string, string>;
  publicUrl: string;
  storageMode: string;
  acl?: string | null;
}

const REVIEW_STAGE_VALUES = Object.values(CardReviewStage);
const REVIEW_STAGE_SET = new Set<string>(REVIEW_STAGE_VALUES);
const LEGACY_REVIEW_STAGE_ALIASES: Record<string, CardReviewStage> = {
  ADD_ITEMS: CardReviewStage.READY_FOR_HUMAN_REVIEW,
};

const handler: NextApiHandler<PresignResponse | { message: string }> = async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PresignResponse | { message: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);

    const { fileName, size, mimeType, batchId, reviewStage } = (req.body ?? {}) as {
      fileName?: unknown;
      size?: unknown;
      mimeType?: unknown;
      batchId?: unknown;
      reviewStage?: unknown;
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
    if (typeof reviewStage !== "string" && typeof reviewStage !== "undefined") {
      return res.status(400).json({ message: "reviewStage must be a string when provided" });
    }

    const reviewStageRaw = typeof reviewStage === "string" ? reviewStage.trim() : "";
    if (typeof reviewStage === "string" && !reviewStageRaw) {
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
    const assetId = randomUUID().replace(/-/g, "");
    const storageKey = buildStorageKey(admin.user.id, assetId, fileName);
    const mode = getStorageMode();

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

    const uploadUrl =
      mode === "s3"
        ? await presignUploadUrl(storageKey, mimeType)
        : `/api/admin/uploads/file?assetId=${assetId}`;

    return res.status(200).json({
      uploadUrl,
      assetId,
      batchId: batch.id,
      fields: {},
      publicUrl: publicUrlFor(storageKey),
      storageMode: mode,
      acl: getS3ObjectAcl(),
    });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
};

export default withAdminCors(handler);
