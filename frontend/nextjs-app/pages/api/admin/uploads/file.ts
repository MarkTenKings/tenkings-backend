import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { getStorageMode, writeLocalFile } from "../../../../lib/server/storage";
import { MAX_UPLOAD_BYTES } from "../../../../lib/server/uploads";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: `${Math.ceil(MAX_UPLOAD_BYTES / (1024 * 1024))}mb`,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ message: string }>) {
  if (req.method !== "PUT") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { assetId } = req.query;

    if (typeof assetId !== "string" || !assetId.trim()) {
      return res.status(400).json({ message: "assetId query param is required" });
    }

    const mode = getStorageMode();
    if (mode === "s3") {
      return res.status(400).json({ message: "Direct uploads are only supported in local or mock storage modes" });
    }

    const asset = await prisma.cardAsset.findUnique({
      where: { id: assetId },
      include: { batch: true },
    });

    if (!asset || !asset.batch) {
      return res.status(404).json({ message: "Asset not found" });
    }

    if (asset.batch.uploadedById !== admin.user.id) {
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
      await writeLocalFile(asset.storageKey, buffer);
    }

    const mimeType = (req.headers["content-type"] as string | undefined) ?? asset.mimeType ?? "application/octet-stream";
    const base64 = buffer.toString("base64");

    await prisma.cardAsset.update({
      where: { id: assetId },
      data: {
        imageUrl: `data:${mimeType};base64,${base64}`,
      },
    });

    return res.status(200).json({ message: "File stored" });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
