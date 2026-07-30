import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { buildMuxThumbnailUrl } from "../../../../lib/server/liveRip";
import { resolveLiveRipCustomer } from "../../../../lib/server/liveRipCustomer";
import { requireUserSession, toUserErrorResponse } from "../../../../lib/server/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await requireUserSession(req);
    const customer = await resolveLiveRipCustomer(session.user);
    const liveRips = await prisma.liveRip.findMany({
      where: {
        userId: customer.id,
        isGoldenTicket: false,
      },
      select: {
        id: true,
        slug: true,
        title: true,
        thumbnailUrl: true,
        muxPlaybackId: true,
        muxAssetId: true,
        videoUrl: true,
        status: true,
        createdAt: true,
        startedAt: true,
        endedAt: true,
        location: {
          select: {
            name: true,
            slug: true,
          },
        },
      },
      orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }],
    });

    return res.status(200).json({
      liveRips: liveRips.map((liveRip) => {
        const watchReady =
          liveRip.status === "COMPLETE" && Boolean(liveRip.muxPlaybackId || liveRip.videoUrl);
        const directMp4 = /\.mp4(?:$|\?)/i.test(liveRip.videoUrl);
        return {
          id: liveRip.id,
          slug: liveRip.slug,
          title: liveRip.title,
          thumbnailUrl:
            liveRip.thumbnailUrl ??
            (liveRip.muxPlaybackId ? buildMuxThumbnailUrl(liveRip.muxPlaybackId) : null),
          status: liveRip.status,
          processingState: watchReady ? "ready" : "processing",
          recordedAt: (liveRip.endedAt ?? liveRip.startedAt ?? liveRip.createdAt).toISOString(),
          location: liveRip.location,
          watchUrl: watchReady ? `/live/${liveRip.slug}` : null,
          canDownload:
            watchReady &&
            Boolean((liveRip.muxPlaybackId && liveRip.muxAssetId) || directMp4),
          downloadEndpoint: `/api/collection/live-rips/${liveRip.id}/download`,
        };
      }),
    });
  } catch (error) {
    const result = toUserErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
