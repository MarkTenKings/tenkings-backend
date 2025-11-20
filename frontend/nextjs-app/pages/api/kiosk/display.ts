import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, KioskSessionStatus } from "@tenkings/database";
import { z } from "zod";
import {
  kioskSessionInclude,
  serializeKioskSession,
  type KioskSessionWithRelations,
} from "../../../lib/server/kioskSession";

const querySchema = z.object({
  locationId: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
});

const ACTIVE_STATUSES: KioskSessionStatus[] = [
  KioskSessionStatus.COUNTDOWN,
  KioskSessionStatus.LIVE,
  KioskSessionStatus.REVEAL,
];
const DEFAULT_COUNTDOWN_SECONDS = Number(process.env.KIOSK_COUNTDOWN_SECONDS ?? 10);
const DEFAULT_LIVE_SECONDS = Number(process.env.KIOSK_LIVE_SECONDS ?? 30);
const DEFAULT_REVEAL_SECONDS = Number(process.env.KIOSK_REVEAL_SECONDS ?? 10);
const DISPLAY_DB_MAX_RETRIES = Number(process.env.KIOSK_DISPLAY_DB_RETRIES ?? 2);
const DISPLAY_DB_RETRY_DELAY_MS = Number(process.env.KIOSK_DISPLAY_DB_RETRY_DELAY_MS ?? 750);
const SESSION_AUTO_STAGE_GRACE_MS = Number(process.env.KIOSK_SESSION_AUTO_STAGE_GRACE_MS ?? 2000);

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
        session = await ensureFreshSession(session);
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

async function ensureFreshSession(session: KioskSessionWithRelations) {
  let current: KioskSessionWithRelations | null = session;

  for (let i = 0; i < 3 && current; i++) {
    const next = await autoAdvanceSession(current);
    if (!next) {
      break;
    }
    current = next;
  }

  return current ?? session;
}

async function autoAdvanceSession(session: KioskSessionWithRelations) {
  const now = Date.now();

  if (session.status === KioskSessionStatus.COUNTDOWN) {
    const countdownDurationMs = (session.countdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS) * 1000;
    const countdownEnds = session.countdownStartedAt.getTime() + countdownDurationMs + SESSION_AUTO_STAGE_GRACE_MS;
    if (now >= countdownEnds) {
      return prisma.kioskSession.update({
        where: { id: session.id },
        data: {
          status: KioskSessionStatus.LIVE,
          liveStartedAt: session.liveStartedAt ?? new Date(),
        },
        include: kioskSessionInclude,
      });
    }
  }

  if (session.status === KioskSessionStatus.LIVE) {
    if (!session.liveStartedAt) {
      return prisma.kioskSession.update({
        where: { id: session.id },
        data: {
          liveStartedAt: new Date(),
        },
        include: kioskSessionInclude,
      });
    }

    const liveDurationMs = (session.liveSeconds ?? DEFAULT_LIVE_SECONDS) * 1000;
    const liveEnds = session.liveStartedAt.getTime() + liveDurationMs + SESSION_AUTO_STAGE_GRACE_MS;
    if (now >= liveEnds && !session.revealStartedAt) {
      return prisma.kioskSession.update({
        where: { id: session.id },
        data: {
          status: KioskSessionStatus.CANCELLED,
          completedAt: new Date(),
        },
        include: kioskSessionInclude,
      });
    }
  }

  if (session.status === KioskSessionStatus.REVEAL && session.revealStartedAt) {
    const revealDurationMs = (session.revealSeconds ?? DEFAULT_REVEAL_SECONDS) * 1000;
    const revealEnds = session.revealStartedAt.getTime() + revealDurationMs + SESSION_AUTO_STAGE_GRACE_MS;
    if (now >= revealEnds) {
      return prisma.kioskSession.update({
        where: { id: session.id },
        data: {
          status: KioskSessionStatus.COMPLETE,
          completedAt: session.completedAt ?? new Date(),
        },
        include: kioskSessionInclude,
      });
    }
  }

  return null;
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
