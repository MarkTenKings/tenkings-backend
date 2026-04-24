import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { buildMuxPlaybackUrl, buildMuxWhipUploadUrl, getMuxWhipBaseUrl } from "../../../../lib/server/mux";
import { requireUserSession, toUserErrorResponse } from "../../../../lib/server/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { sessionId } = req.query;
  if (typeof sessionId !== "string") {
    return res.status(400).json({ message: "sessionId is required" });
  }

  const session = await prisma.kioskSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      ingestMode: true,
      muxStreamKey: true,
      muxPlaybackId: true,
      whipUploadUrl: true,
    },
  });

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (session.ingestMode !== "BROWSER") {
    return res.status(404).json({ message: "WHIP is only available for browser ingest sessions" });
  }

  const userAuth = await (async () => {
    try {
      return await requireUserSession(req);
    } catch (error) {
      return toUserErrorResponse(error);
    }
  })();

  const isSessionOwner = "user" in userAuth ? userAuth.user.id === session.userId : false;

  if (!isSessionOwner) {
    try {
      await requireAdminSession(req);
    } catch (error) {
      if ("user" in userAuth) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  }

  if (!session.muxStreamKey) {
    return res.status(409).json({ message: "Mux WHIP stream has not been initialized for this session" });
  }

  const whipBaseUrl = getMuxWhipBaseUrl();
  const whipUploadUrl = session.whipUploadUrl ?? buildMuxWhipUploadUrl(session.muxStreamKey);

  return res.status(200).json({
    whipUrl: whipBaseUrl,
    whipUploadUrl,
    streamKey: session.muxStreamKey,
    playbackId: session.muxPlaybackId ?? null,
    playbackUrl: session.muxPlaybackId ? buildMuxPlaybackUrl(session.muxPlaybackId) : null,
  });
}
