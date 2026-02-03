import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { getStorageMode, publicUrlFor, writeLocalFile } from "../../../../../lib/server/storage";
import { MAX_UPLOAD_BYTES } from "../../../../../lib/server/uploads";
import { withAdminCors } from "../../../../../lib/server/cors";
import { buildSiteUrl } from "../../../../../lib/server/urls";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "25mb",
  },
};

const handler = async function handler(req: NextApiRequest, res: NextApiResponse<{ message: string }>) {
  if (req.method !== "PUT") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { photoId } = req.query;

    if (typeof photoId !== "string" || !photoId.trim()) {
      return res.status(400).json({ message: "photoId query param is required" });
    }

    const mode = getStorageMode();
    if (mode === "s3") {
      return res.status(400).json({ message: "Direct uploads are only supported in local or mock storage modes" });
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

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    if (buffer.length === 0) {
      return res.status(400).json({ message: "Upload payload was empty" });
    }

    if (buffer.length > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ message: "Uploaded file exceeds limit" });
    }

    if (mode === "local") {
      await writeLocalFile(photo.storageKey, buffer);
    }

    const rawPublicUrl = publicUrlFor(photo.storageKey);
    const publicUrl = /^https?:\/\//i.test(rawPublicUrl) ? rawPublicUrl : buildSiteUrl(rawPublicUrl);

    await prisma.cardPhoto.update({
      where: { id: photoId },
      data: {
        imageUrl: publicUrl,
      },
    });

    return res.status(200).json({ message: "File stored" });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
};

export default withAdminCors(handler);
