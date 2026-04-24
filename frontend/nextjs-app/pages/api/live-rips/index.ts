import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { prisma } from "@tenkings/database";
import { toUserErrorResponse } from "../../../lib/server/session";

const withLocation = (liveRip: any) => ({
  ...liveRip,
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

    const liveRips = await prisma.liveRip.findMany({
      where: {
        locationId: locationId ? locationId : undefined,
        featured: featured ? featured === "true" : undefined,
        slug: slug ? slug : undefined,
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
      include: {
        location: true,
      },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: slug ? 1 : undefined,
    });

    if (slug) {
      const liveRip = liveRips[0];
      if (!liveRip) {
        return res.status(404).json({ message: "Live rip not found" });
      }
      return res.status(200).json({ liveRip: withLocation(liveRip) });
    }

    return res.status(200).json({ liveRips: liveRips.map(withLocation) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return res.status(200).json({ liveRips: [] });
    }
    const result = toUserErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
