import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { ensureKioskSecret, hasKioskControl } from "../../../../lib/server/kioskAuth";
import { buildMuxPlaybackUrl } from "../../../../lib/server/mux";

const MUX_RTMP_URL = "rtmps://global-live.mux.com:443/app";

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
      controlTokenHash: true,
      muxStreamKey: true,
      muxStreamId: true,
      muxPlaybackId: true,
    },
  });

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  const authorized = ensureKioskSecret(req) || hasKioskControl(req, session.controlTokenHash);
  if (!authorized) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!session.muxStreamKey || !session.muxStreamId) {
    return res.status(409).json({ message: "Mux stream has not been initialized for this session" });
  }

  return res.status(200).json({
    ingestUrl: MUX_RTMP_URL,
    streamKey: session.muxStreamKey,
    muxStreamId: session.muxStreamId,
    playbackUrl: session.muxPlaybackId ? buildMuxPlaybackUrl(session.muxPlaybackId) : null,
    playbackId: session.muxPlaybackId ?? null,
  });
}
