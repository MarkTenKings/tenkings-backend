import { prisma, KioskSessionStatus } from "@tenkings/database";
import { kioskSessionInclude, type KioskSessionWithRelations } from "./kioskSession";

const DEFAULT_COUNTDOWN_SECONDS = Number(process.env.KIOSK_COUNTDOWN_SECONDS ?? 10);
const DEFAULT_LIVE_SECONDS = Number(process.env.KIOSK_LIVE_SECONDS ?? 30);
const DEFAULT_REVEAL_SECONDS = Number(process.env.KIOSK_REVEAL_SECONDS ?? 10);
const SESSION_AUTO_STAGE_GRACE_MS = Number(process.env.KIOSK_SESSION_AUTO_STAGE_GRACE_MS ?? 2000);

export async function ensureFreshKioskSession(session: KioskSessionWithRelations) {
  let current: KioskSessionWithRelations | null = session;

  for (let attempt = 0; attempt < 3 && current; attempt += 1) {
    const next = await autoAdvanceKioskSession(current);
    if (!next) {
      break;
    }
    current = next;
  }

  return current ?? session;
}

async function autoAdvanceKioskSession(session: KioskSessionWithRelations) {
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
