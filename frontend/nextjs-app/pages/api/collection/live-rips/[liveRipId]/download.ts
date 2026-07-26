import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import {
  buildMuxStaticRenditionUrl,
  ensureMuxHighestStaticRendition,
} from "../../../../../lib/server/mux";
import { requireUserSession, toUserErrorResponse } from "../../../../../lib/server/session";
import { buildSiteUrl } from "../../../../../lib/server/urls";

function safeDownloadName(slug: string) {
  return slug.replace(/[^a-z0-9_-]+/gi, "-") || "ten-kings-live-rip";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const liveRipId = Array.isArray(req.query.liveRipId) ? req.query.liveRipId[0] : req.query.liveRipId;
  if (!liveRipId) {
    return res.status(400).json({ message: "Live Rip id is required" });
  }

  try {
    const session = await requireUserSession(req);
    const liveRip = await prisma.liveRip.findFirst({
      where: {
        id: liveRipId,
        userId: session.user.id,
        isGoldenTicket: false,
      },
      select: {
        slug: true,
        status: true,
        videoUrl: true,
        muxAssetId: true,
        muxPlaybackId: true,
      },
    });

    if (!liveRip) {
      return res.status(404).json({ message: "Live Rip not found" });
    }
    if (liveRip.status !== "COMPLETE") {
      return res.status(409).json({ message: "This Live Rip is still processing" });
    }

    const downloadName = safeDownloadName(liveRip.slug);
    if (liveRip.muxAssetId && liveRip.muxPlaybackId) {
      const rendition = await ensureMuxHighestStaticRendition(liveRip.muxAssetId);
      if (rendition.status === "preparing") {
        return res.status(202).json({
          ready: false,
          message: "The download is being prepared. Try again shortly.",
        });
      }
      if (rendition.status !== "ready") {
        return res.status(409).json({
          ready: false,
          message: "The downloadable video could not be prepared",
        });
      }

      return res.status(200).json({
        ready: true,
        downloadUrl: buildMuxStaticRenditionUrl(
          liveRip.muxPlaybackId,
          rendition.name,
          downloadName
        ),
      });
    }

    if (/\.mp4(?:$|\?)/i.test(liveRip.videoUrl)) {
      return res.status(200).json({
        ready: true,
        downloadUrl: liveRip.videoUrl.startsWith("/") ? buildSiteUrl(liveRip.videoUrl) : liveRip.videoUrl,
      });
    }

    return res.status(409).json({ message: "A downloadable recording is not available for this Live Rip" });
  } catch (error) {
    const result = toUserErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
