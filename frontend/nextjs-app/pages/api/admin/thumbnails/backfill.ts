import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";
import {
  buildThumbnailKey,
  normalizeStorageUrl,
  readStorageBuffer,
  uploadBuffer,
} from "../../../../lib/server/storage";
import { createThumbnailPng } from "../../../../lib/server/images";

type BackfillResponse = {
  processed: number;
  updated: number;
  errors: number;
  assetProcessed: number;
  photoProcessed: number;
};

const DEFAULT_LIMIT = 20;

async function backfillAssets(limit: number) {
  const assets = await prisma.cardAsset.findMany({
    where: { thumbnailUrl: null },
    select: { id: true, storageKey: true },
    take: limit,
  });

  let updated = 0;
  let errors = 0;
  for (const asset of assets) {
    try {
      const buffer = await readStorageBuffer(asset.storageKey);
      const thumb = await createThumbnailPng(buffer);
      const key = buildThumbnailKey(asset.storageKey);
      const url = await uploadBuffer(key, thumb, "image/png");
      const normalized = normalizeStorageUrl(url) ?? url;
      await prisma.cardAsset.update({
        where: { id: asset.id },
        data: { thumbnailUrl: normalized },
      });
      updated += 1;
    } catch {
      errors += 1;
    }
  }
  return { processed: assets.length, updated, errors };
}

async function backfillPhotos(limit: number) {
  const photos = await prisma.cardPhoto.findMany({
    where: { thumbnailUrl: null },
    select: { id: true, storageKey: true },
    take: limit,
  });

  let updated = 0;
  let errors = 0;
  for (const photo of photos) {
    try {
      const buffer = await readStorageBuffer(photo.storageKey);
      const thumb = await createThumbnailPng(buffer);
      const key = buildThumbnailKey(photo.storageKey);
      const url = await uploadBuffer(key, thumb, "image/png");
      const normalized = normalizeStorageUrl(url) ?? url;
      await prisma.cardPhoto.update({
        where: { id: photo.id },
        data: { thumbnailUrl: normalized },
      });
      updated += 1;
    } catch {
      errors += 1;
    }
  }
  return { processed: photos.length, updated, errors };
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse<BackfillResponse | { message: string }>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const { limit, target } = (req.body ?? {}) as {
      limit?: unknown;
      target?: "cardAsset" | "cardPhoto" | "both";
    };

    const cap = typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : DEFAULT_LIMIT;
    const selection = target ?? "both";

    let assetResult = { processed: 0, updated: 0, errors: 0 };
    let photoResult = { processed: 0, updated: 0, errors: 0 };

    if (selection === "cardAsset" || selection === "both") {
      assetResult = await backfillAssets(cap);
    }
    if (selection === "cardPhoto" || selection === "both") {
      photoResult = await backfillPhotos(cap);
    }

    return res.status(200).json({
      processed: assetResult.processed + photoResult.processed,
      updated: assetResult.updated + photoResult.updated,
      errors: assetResult.errors + photoResult.errors,
      assetProcessed: assetResult.processed,
      photoProcessed: photoResult.processed,
    });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
};

export default withAdminCors(handler);
