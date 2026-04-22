import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { LIVE_MAX_UPLOAD_BYTES, getLiveStorageMode, storeLiveAsset } from "../../../../lib/server/liveStorage";
import { requireUserSession, toUserErrorResponse } from "../../../../lib/server/session";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "150mb",
  },
};

function resolveParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await requireUserSession(req);
    const sessionId = resolveParam(req.query.sessionId);
    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    const kioskSession = await prisma.kioskSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        ingestMode: true,
        isGoldenTicket: true,
      },
    });

    if (!kioskSession) {
      return res.status(404).json({ message: "Reveal session not found" });
    }

    if (kioskSession.userId !== session.user.id || kioskSession.ingestMode !== "BROWSER" || !kioskSession.isGoldenTicket) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const fileName = resolveParam(req.query.fileName)?.trim() || `golden-ticket-reaction-${sessionId}.webm`;
    const contentType =
      resolveParam(req.query.contentType)?.trim() ||
      (typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : "") ||
      "video/webm";

    if (!contentType.startsWith("video/")) {
      return res.status(400).json({ message: "Reaction upload must be a video file" });
    }

    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    for await (const chunk of req) {
      const bufferChunk = Buffer.from(chunk as Buffer);
      receivedBytes += bufferChunk.length;
      if (receivedBytes > LIVE_MAX_UPLOAD_BYTES) {
        return res.status(413).json({
          message: `Upload exceeds ${(LIVE_MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)}MB limit`,
        });
      }
      chunks.push(bufferChunk);
    }

    if (chunks.length === 0) {
      return res.status(400).json({ message: "Upload payload was empty" });
    }

    const stored = await storeLiveAsset({
      userId: session.user.id,
      fileName,
      buffer: Buffer.concat(chunks),
      contentType,
    });

    await prisma.kioskSession.update({
      where: { id: kioskSession.id },
      data: {
        reactionVideoUrl: stored.publicUrl,
      },
    });

    return res.status(200).json({
      url: stored.publicUrl,
      storageKey: stored.storageKey,
      contentType: stored.contentType,
      mode: getLiveStorageMode(),
    });
  } catch (error) {
    const result = toUserErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
