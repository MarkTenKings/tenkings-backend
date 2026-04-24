import type { Prisma } from "@prisma/client";
import { KioskSessionStatus, prisma } from "@tenkings/database";
import { formatGoldenTicketLabel } from "../goldenTicketLabel";
import type { AdminGoldenQueueSession } from "../goldenQueue";
import { getAdminGoldenQueueWatchHref } from "../goldenQueue";
import { parseGoldenTicketPrizeDetails } from "./goldenTicket";
import { kioskSessionInclude } from "./kioskSession";
import { ensureFreshKioskSession } from "./kioskSessionLifecycle";

const ACTIVE_GOLDEN_QUEUE_STATUSES: KioskSessionStatus[] = [
  KioskSessionStatus.COUNTDOWN,
  KioskSessionStatus.LIVE,
  KioskSessionStatus.REVEAL,
];

const ACTIVE_GOLDEN_QUEUE_STATUS_SET = new Set<KioskSessionStatus>(ACTIVE_GOLDEN_QUEUE_STATUSES);

const goldenQueueSessionSelect = {
  id: true,
  code: true,
  status: true,
  countdownStartedAt: true,
  liveStartedAt: true,
  revealStartedAt: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  muxPlaybackId: true,
  videoUrl: true,
  thumbnailUrl: true,
  user: {
    select: {
      id: true,
      displayName: true,
      phone: true,
    },
  },
  claimedBy: {
    select: {
      id: true,
      displayName: true,
      phone: true,
    },
  },
  goldenTicket: {
    select: {
      id: true,
      code: true,
      status: true,
      ticketNumber: true,
      prizeItem: {
        select: {
          id: true,
          name: true,
          estimatedValue: true,
          imageUrl: true,
          thumbnailUrl: true,
          detailsJson: true,
        },
      },
      winnerProfile: {
        select: {
          displayName: true,
        },
      },
    },
  },
} satisfies Prisma.KioskSessionSelect;

type GoldenQueueSessionRow = Prisma.KioskSessionGetPayload<{
  select: typeof goldenQueueSessionSelect;
}>;

function isActiveGoldenQueueStatus(status: KioskSessionStatus): status is AdminGoldenQueueSession["status"] {
  return ACTIVE_GOLDEN_QUEUE_STATUS_SET.has(status);
}

function getStageEnteredAt(session: {
  status: KioskSessionStatus;
  countdownStartedAt: Date;
  liveStartedAt: Date | null;
  revealStartedAt: Date | null;
  updatedAt: Date;
}) {
  if (session.status === KioskSessionStatus.REVEAL && session.revealStartedAt) {
    return session.revealStartedAt;
  }

  if (session.status === KioskSessionStatus.LIVE && session.liveStartedAt) {
    return session.liveStartedAt;
  }

  return session.countdownStartedAt ?? session.updatedAt;
}

function pickWinnerName(session: GoldenQueueSessionRow) {
  const candidates = [
    session.goldenTicket?.winnerProfile?.displayName,
    session.claimedBy?.displayName,
    session.user?.displayName,
    session.claimedBy?.phone,
    session.user?.phone,
  ];

  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized) {
      return normalized;
    }
  }

  return "Awaiting claim";
}

function mapGoldenQueueSession(session: GoldenQueueSessionRow): AdminGoldenQueueSession | null {
  if (!session.goldenTicket) {
    return null;
  }

  const prizeDetails = parseGoldenTicketPrizeDetails(session.goldenTicket.prizeItem.detailsJson);
  const stageEnteredAt = getStageEnteredAt(session);

  return {
    id: session.id,
    code: session.code,
    status: session.status as AdminGoldenQueueSession["status"],
    stageEnteredAt: stageEnteredAt.toISOString(),
    countdownStartedAt: session.countdownStartedAt.toISOString(),
    liveStartedAt: session.liveStartedAt ? session.liveStartedAt.toISOString() : null,
    revealStartedAt: session.revealStartedAt ? session.revealStartedAt.toISOString() : null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    completedAt: session.completedAt ? session.completedAt.toISOString() : null,
    muxPlaybackId: session.muxPlaybackId ?? null,
    videoUrl: session.videoUrl ?? null,
    thumbnailUrl: session.thumbnailUrl ?? null,
    watchHref: getAdminGoldenQueueWatchHref(session.id),
    winnerName: pickWinnerName(session),
    ticket: {
      id: session.goldenTicket.id,
      code: session.goldenTicket.code,
      status: session.goldenTicket.status,
      ticketNumber: session.goldenTicket.ticketNumber,
      ticketLabel: formatGoldenTicketLabel(session.goldenTicket.ticketNumber),
    },
    prize: {
      itemId: session.goldenTicket.prizeItem.id,
      name: session.goldenTicket.prizeItem.name,
      description: prizeDetails.description,
      estimatedValue: session.goldenTicket.prizeItem.estimatedValue ?? null,
      imageUrl: session.goldenTicket.prizeItem.imageUrl ?? prizeDetails.photoGallery[0] ?? null,
      thumbnailUrl:
        session.goldenTicket.prizeItem.thumbnailUrl ??
        session.goldenTicket.prizeItem.imageUrl ??
        prizeDetails.photoGallery[0] ??
        null,
    },
  };
}

async function resolveFreshActiveSessionIds(sessionId?: string) {
  const sessions = await prisma.kioskSession.findMany({
    where: {
      isGoldenTicket: true,
      ...(sessionId
        ? {
            id: sessionId,
          }
        : {
            status: {
              in: ACTIVE_GOLDEN_QUEUE_STATUSES,
            },
          }),
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: sessionId ? 1 : 25,
    include: kioskSessionInclude,
  });

  if (sessions.length === 0) {
    return [];
  }

  const freshSessions = await Promise.all(sessions.map((session) => ensureFreshKioskSession(session)));
  return freshSessions.filter((session) => isActiveGoldenQueueStatus(session.status)).map((session) => session.id);
}

export async function listAdminGoldenQueueSessions(sessionId?: string) {
  const activeSessionIds = await resolveFreshActiveSessionIds(sessionId);
  if (activeSessionIds.length === 0) {
    return [];
  }

  const sessions = await prisma.kioskSession.findMany({
    where: sessionId
      ? {
          id: activeSessionIds[0],
        }
      : {
          id: {
            in: activeSessionIds,
          },
        },
    select: goldenQueueSessionSelect,
  });

  return sessions
    .map((session) => mapGoldenQueueSession(session))
    .filter((session): session is AdminGoldenQueueSession => Boolean(session))
    .sort((left, right) => Date.parse(right.stageEnteredAt) - Date.parse(left.stageEnteredAt));
}

export async function getAdminGoldenQueueSessionById(sessionId: string) {
  const sessions = await listAdminGoldenQueueSessions(sessionId);
  return sessions[0] ?? null;
}
