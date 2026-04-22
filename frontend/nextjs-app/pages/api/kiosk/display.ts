import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, KioskSessionStatus } from "@tenkings/database";
import { z } from "zod";
import {
  kioskSessionInclude,
  serializeKioskSession,
} from "../../../lib/server/kioskSession";
import { ensureFreshKioskSession } from "../../../lib/server/kioskSessionLifecycle";

const querySchema = z.object({
  locationId: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
});

const ACTIVE_STATUSES: KioskSessionStatus[] = [
  KioskSessionStatus.COUNTDOWN,
  KioskSessionStatus.LIVE,
  KioskSessionStatus.REVEAL,
];
const DISPLAY_DB_MAX_RETRIES = Number(process.env.KIOSK_DISPLAY_DB_RETRIES ?? 2);
const DISPLAY_DB_RETRY_DELAY_MS = Number(process.env.KIOSK_DISPLAY_DB_RETRY_DELAY_MS ?? 750);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { locationId, slug } = querySchema.parse(req.query ?? {});
  if (!locationId && !slug) {
    return res.status(400).json({ message: "locationId or slug is required" });
  }

  for (let attempt = 0; attempt < DISPLAY_DB_MAX_RETRIES; attempt++) {
    try {
      const location = await prisma.location.findFirst({
        where: locationId ? { id: locationId } : { slug: slug! },
        select: { id: true, name: true, slug: true },
      });

      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      let session = await prisma.kioskSession.findFirst({
        where: {
          locationId: location.id,
          status: { in: ACTIVE_STATUSES },
        },
        orderBy: { countdownStartedAt: "desc" },
        include: kioskSessionInclude,
      });

      if (session) {
        session = await ensureFreshKioskSession(session);
      }

      return res.status(200).json({
        location,
        session: session ? serializeKioskSession(session) : null,
      });
    } catch (error) {
      if (attempt < DISPLAY_DB_MAX_RETRIES - 1 && isTransientDbError(error)) {
        await delay(DISPLAY_DB_RETRY_DELAY_MS);
        continue;
      }
      const message = error instanceof Error ? error.message : "Failed to load display status";
      return res.status(500).json({ message });
    }
  }
}

function isTransientDbError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("Can't reach database server");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
