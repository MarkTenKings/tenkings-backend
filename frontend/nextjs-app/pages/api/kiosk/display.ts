import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, KioskSessionStatus } from "@tenkings/database";
import { z } from "zod";
import { kioskSessionInclude, serializeKioskSession } from "../../../lib/server/kioskSession";

const querySchema = z.object({
  locationId: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
});

const ACTIVE_STATUSES: KioskSessionStatus[] = [
  KioskSessionStatus.COUNTDOWN,
  KioskSessionStatus.LIVE,
  KioskSessionStatus.REVEAL,
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { locationId, slug } = querySchema.parse(req.query ?? {});
    if (!locationId && !slug) {
      return res.status(400).json({ message: "locationId or slug is required" });
    }

    const location = await prisma.location.findFirst({
      where: locationId ? { id: locationId } : { slug: slug! },
      select: { id: true, name: true, slug: true },
    });

    if (!location) {
      return res.status(404).json({ message: "Location not found" });
    }

    const session = await prisma.kioskSession.findFirst({
      where: {
        locationId: location.id,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: { countdownStartedAt: "desc" },
      include: kioskSessionInclude,
    });

    return res.status(200).json({
      location,
      session: session ? serializeKioskSession(session) : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load display status";
    return res.status(500).json({ message });
  }
}
