import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { prisma } from "@tenkings/database";
import { toUserErrorResponse } from "../../../lib/server/session";

const publicLiveRipSelect = Prisma.validator<Prisma.LiveRipSelect>()({
  id: true,
  slug: true,
  title: true,
  description: true,
  videoUrl: true,
  thumbnailUrl: true,
  locationId: true,
  status: true,
  featured: true,
  viewCount: true,
  muxAssetId: true,
  muxPlaybackId: true,
  isGoldenTicket: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  updatedAt: true,
  location: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
});

type PublicLiveRip = Prisma.LiveRipGetPayload<{ select: typeof publicLiveRipSelect }>;

const isReplayReady = (liveRip: PublicLiveRip) =>
  liveRip.status === "COMPLETE" &&
  !liveRip.isGoldenTicket &&
  Boolean(
    (liveRip.muxAssetId && liveRip.muxPlaybackId) ||
      /\.mp4(?:$|\?)/i.test(liveRip.videoUrl)
  );

const toPublicLiveRip = (liveRip: PublicLiveRip) => ({
  id: liveRip.id,
  slug: liveRip.slug,
  title: liveRip.title,
  description: liveRip.description,
  videoUrl: liveRip.videoUrl,
  thumbnailUrl: liveRip.thumbnailUrl,
  locationId: liveRip.locationId,
  status: liveRip.status,
  featured: liveRip.featured,
  viewCount: liveRip.viewCount,
  muxPlaybackId: liveRip.muxPlaybackId,
  isGoldenTicket: liveRip.isGoldenTicket,
  replayReady: isReplayReady(liveRip),
  startedAt: liveRip.startedAt,
  endedAt: liveRip.endedAt,
  createdAt: liveRip.createdAt,
  updatedAt: liveRip.updatedAt,
  location: liveRip.location
    ? {
        id: liveRip.location.id,
        name: liveRip.location.name,
        slug: liveRip.location.slug,
      }
    : null,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const locationId = Array.isArray(req.query.locationId) ? req.query.locationId[0] : req.query.locationId;
    const featured = Array.isArray(req.query.featured) ? req.query.featured[0] : req.query.featured;
    const slug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
    const replayReady = Array.isArray(req.query.replayReady) ? req.query.replayReady[0] : req.query.replayReady;
    const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : null;
    const limit =
      parsedLimit && Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : undefined;

    const liveRips = await prisma.liveRip.findMany({
      where: {
        locationId: locationId ? locationId : undefined,
        featured: featured ? featured === "true" : undefined,
        slug: slug ? slug : undefined,
        status: replayReady === "true" ? "COMPLETE" : undefined,
        isGoldenTicket: replayReady === "true" ? false : undefined,
        AND: [
          {
            OR: [
              {
                kioskSession: {
                  is: null,
                },
              },
              {
                kioskSession: {
                  is: {
                    status: {
                      not: "CANCELLED",
                    },
                  },
                },
              },
            ],
          },
          ...(replayReady === "true"
            ? [
                {
                  OR: [
                    {
                      muxAssetId: { not: null },
                      muxPlaybackId: { not: null },
                    },
                    {
                      videoUrl: { contains: ".mp4" },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      select: publicLiveRipSelect,
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: slug ? 1 : limit,
    });

    const publicLiveRips = liveRips.map(toPublicLiveRip).filter((liveRip) => {
      if (replayReady !== "true") {
        return true;
      }
      return liveRip.replayReady;
    });

    if (slug) {
      const liveRip = publicLiveRips[0];
      if (!liveRip) {
        return res.status(404).json({ message: "Live rip not found" });
      }
      return res.status(200).json({ liveRip });
    }

    return res.status(200).json({ liveRips: publicLiveRips });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return res.status(200).json({ liveRips: [] });
    }
    const result = toUserErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
