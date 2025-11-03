import type { NextApiRequest, NextApiResponse } from "next";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { requireUserSession, toUserErrorResponse } from "../../../lib/server/session";
import { LIVE_MAX_UPLOAD_BYTES, getLiveStorageMode, storeLiveAsset } from "../../../lib/server/liveStorage";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "150mb",
  },
};

type UploadResponse = {
  url: string;
  storageKey: string;
  contentType: string;
  size: number;
  kind: "video" | "thumbnail";
  mode: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<UploadResponse | { message: string }>) {
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await requireUserSession(req);
    const isAdmin = hasAdminAccess(session.user.id) || hasAdminPhoneAccess(session.user.phone);
    if (!isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const resolveParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

    const kindParam = resolveParam(req.query.kind);
    const kind: "video" | "thumbnail" = kindParam === "thumbnail" ? "thumbnail" : "video";

    const fileNameParam = resolveParam(req.query.fileName);
    const fileName = typeof fileNameParam === "string" && fileNameParam.trim() ? fileNameParam.trim() : `${kind}-${Date.now()}`;

    const contentTypeParam = resolveParam(req.query.contentType);
    const headerContentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined;
    const contentType = contentTypeParam?.trim() || headerContentType || "";

    if (!contentType) {
      return res.status(400).json({ message: "Missing content type" });
    }

    const isVideoUpload = kind === "video";
    if (isVideoUpload && !contentType.startsWith("video/")) {
      return res.status(400).json({ message: "Upload must be a video file" });
    }
    if (!isVideoUpload && !contentType.startsWith("image/")) {
      return res.status(400).json({ message: "Thumbnail must be an image" });
    }

    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    for await (const chunk of req) {
      const bufferChunk = Buffer.from(chunk as Buffer);
      receivedBytes += bufferChunk.length;
      if (receivedBytes > LIVE_MAX_UPLOAD_BYTES) {
        res.status(413).json({
          message: `Upload exceeds ${(LIVE_MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)}MB limit`,
        });
        return;
      }
      chunks.push(bufferChunk);
    }

    if (chunks.length === 0) {
      return res.status(400).json({ message: "Upload payload was empty" });
    }

    const buffer = Buffer.concat(chunks);

    const stored = await storeLiveAsset({
      userId: session.user.id,
      fileName,
      buffer,
      contentType,
    });

    return res.status(200).json({
      url: stored.publicUrl,
      storageKey: stored.storageKey,
      contentType: stored.contentType,
      size: buffer.length,
      kind,
      mode: getLiveStorageMode(),
    });
  } catch (error) {
    const result = toUserErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
