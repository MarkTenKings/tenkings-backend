import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { buildSiteUrl } from "../../../../../lib/server/urls";
import { publicUrlFor, uploadBuffer } from "../../../../../lib/server/storage";
import { withAdminCors } from "../../../../../lib/server/cors";

type ProcessResponse = {
  message: string;
  imageUrl?: string;
};

const PHOTOROOM_ENDPOINT = "https://image-api.photoroom.com/v2/edit";

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

const handler = async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { photoId } = (req.body ?? {}) as { photoId?: unknown };

    if (typeof photoId !== "string" || !photoId.trim()) {
      return res.status(400).json({ message: "photoId is required" });
    }

    const photo = await prisma.cardPhoto.findUnique({
      where: { id: photoId },
      include: { cardAsset: { include: { batch: true } } },
    });

    if (!photo || !photo.cardAsset?.batch) {
      return res.status(404).json({ message: "Photo not found" });
    }

    if (photo.cardAsset.batch.uploadedById !== admin.user.id) {
      return res.status(403).json({ message: "You do not own this batch" });
    }

    const apiKey = (process.env.PHOTOROOM_API_KEY ?? "").trim();
    if (!apiKey) {
      return res.status(200).json({ message: "PhotoRoom not configured" });
    }

    const rawPublicUrl = publicUrlFor(photo.storageKey);
    const publicUrl = /^https?:\/\//i.test(rawPublicUrl) ? rawPublicUrl : buildSiteUrl(rawPublicUrl);
    const downloadRes = await fetch(publicUrl);
    if (!downloadRes.ok) {
      throw new Error(`Failed to load photo source (${downloadRes.status})`);
    }
    const sourceBuffer = Buffer.from(await downloadRes.arrayBuffer());

    const processedBuffer = await runPhotoroom(sourceBuffer, apiKey);
    const updatedUrl = await uploadBuffer(photo.storageKey, processedBuffer, "image/png");
    const normalizedUrl = /^https?:\/\//i.test(updatedUrl) ? updatedUrl : buildSiteUrl(updatedUrl);

    await prisma.cardPhoto.update({
      where: { id: photo.id },
      data: { imageUrl: normalizedUrl },
    });

    return res.status(200).json({ message: "Processed", imageUrl: normalizedUrl });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
};

export default withAdminCors(handler);
