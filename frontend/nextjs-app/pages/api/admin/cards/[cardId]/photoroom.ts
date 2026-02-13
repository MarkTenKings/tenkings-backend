import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { buildSiteUrl } from "../../../../../lib/server/urls";
import {
  buildThumbnailKey,
  normalizeStorageUrl,
  readStorageBuffer,
  uploadBuffer,
} from "../../../../../lib/server/storage";
import { createThumbnailPng } from "../../../../../lib/server/images";
import { withAdminCors } from "../../../../../lib/server/cors";

const PHOTOROOM_ENDPOINT = "https://image-api.photoroom.com/v2/edit";

type PhotoroomResult = {
  processed: number;
  skipped: number;
  message: string;
};

async function runPhotoroom(buffer: Buffer, apiKey: string): Promise<Buffer> {
  const form = new FormData();
  const blob = new Blob([buffer], { type: "image/png" });
  form.append("imageFile", blob, "capture.png");
  form.append("removeBackground", "true");
  form.append("padding", "0.05");
  form.append("scaling", "fit");
  form.append("outputSize", "croppedSubject");
  form.append("export.format", "png");
  form.append("background.color", "transparent");

  const response = await fetch(PHOTOROOM_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      Accept: "image/png, application/json",
    },
    body: form,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`PhotoRoom request failed (${response.status}): ${message}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function createThumbnail(buffer: Buffer, storageKey: string) {
  const thumbKey = buildThumbnailKey(storageKey);
  const thumbBuffer = await createThumbnailPng(buffer);
  const thumbUploaded = await uploadBuffer(thumbKey, thumbBuffer, "image/png");
  return normalizeStorageUrl(thumbUploaded) ?? thumbUploaded;
}

async function processAsset(cardId: string, apiKey: string) {
  const asset = await prisma.cardAsset.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      storageKey: true,
      imageUrl: true,
      thumbnailUrl: true,
      mimeType: true,
      backgroundRemovedAt: true,
    },
  });

  if (!asset) {
    return { processed: 0, skipped: 0 };
  }

  if (asset.backgroundRemovedAt) {
    return { processed: 0, skipped: 1 };
  }

  const sourceBuffer = await readStorageBuffer(asset.storageKey);
  const processedBuffer = await runPhotoroom(sourceBuffer, apiKey);
  const updatedUrl = await uploadBuffer(asset.storageKey, processedBuffer, "image/png");
  const normalizedUrl = /^https?:\/\//i.test(updatedUrl) ? updatedUrl : buildSiteUrl(updatedUrl);
  const thumbnailUrl = await createThumbnail(processedBuffer, asset.storageKey).catch(() => null);

  await prisma.cardAsset.update({
    where: { id: asset.id },
    data: {
      imageUrl: normalizedUrl,
      thumbnailUrl: thumbnailUrl ?? asset.thumbnailUrl,
      mimeType: "image/png",
      fileSize: processedBuffer.length,
      backgroundRemovedAt: new Date(),
    },
  });

  return { processed: 1, skipped: 0 };
}

async function processPhoto(photoId: string, apiKey: string) {
  const photo = await prisma.cardPhoto.findUnique({
    where: { id: photoId },
    select: {
      id: true,
      storageKey: true,
      imageUrl: true,
      thumbnailUrl: true,
      mimeType: true,
      backgroundRemovedAt: true,
    },
  });

  if (!photo) {
    return { processed: 0, skipped: 0 };
  }

  if (photo.backgroundRemovedAt) {
    return { processed: 0, skipped: 1 };
  }

  const sourceBuffer = await readStorageBuffer(photo.storageKey);
  const processedBuffer = await runPhotoroom(sourceBuffer, apiKey);
  const updatedUrl = await uploadBuffer(photo.storageKey, processedBuffer, "image/png");
  const normalizedUrl = /^https?:\/\//i.test(updatedUrl) ? updatedUrl : buildSiteUrl(updatedUrl);
  const thumbnailUrl = await createThumbnail(processedBuffer, photo.storageKey).catch(() => null);

  await prisma.cardPhoto.update({
    where: { id: photo.id },
    data: {
      imageUrl: normalizedUrl,
      thumbnailUrl: thumbnailUrl ?? photo.thumbnailUrl,
      mimeType: "image/png",
      fileSize: processedBuffer.length,
      backgroundRemovedAt: new Date(),
    },
  });

  return { processed: 1, skipped: 0 };
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse<PhotoroomResult>) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed", processed: 0, skipped: 0 });
  }

  try {
    await requireAdminSession(req);
    const { cardId } = req.query;
    if (typeof cardId !== "string" || !cardId.trim()) {
      return res.status(400).json({ message: "cardId is required", processed: 0, skipped: 0 });
    }

    const apiKey = (process.env.PHOTOROOM_API_KEY ?? "").trim();
    if (!apiKey) {
      return res.status(200).json({ message: "PhotoRoom not configured", processed: 0, skipped: 0 });
    }

    const card = await prisma.cardAsset.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        photos: {
          where: { kind: { in: ["BACK", "TILT"] } },
          select: { id: true },
        },
      },
    });

    if (!card) {
      return res.status(404).json({ message: "Card not found", processed: 0, skipped: 0 });
    }

    let processed = 0;
    let skipped = 0;

    const assetResult = await processAsset(cardId, apiKey);
    processed += assetResult.processed;
    skipped += assetResult.skipped;

    for (const photo of card.photos) {
      const result = await processPhoto(photo.id, apiKey);
      processed += result.processed;
      skipped += result.skipped;
    }

    return res.status(200).json({ message: "PhotoRoom processed", processed, skipped });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message, processed: 0, skipped: 0 });
  }
};

export default withAdminCors(handler);
