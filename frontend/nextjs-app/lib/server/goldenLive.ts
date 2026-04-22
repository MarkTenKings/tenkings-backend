import { prisma, KioskSessionStatus } from "@tenkings/database";
import { parseGoldenTicketPrizeDetails } from "./goldenTicket";
import { kioskSessionInclude, serializeKioskSession, type SerializedKioskSession } from "./kioskSession";
import { ensureFreshKioskSession } from "./kioskSessionLifecycle";

const PUBLIC_LIVE_SESSION_STATUSES: KioskSessionStatus[] = [KioskSessionStatus.COUNTDOWN, KioskSessionStatus.LIVE];

export interface GoldenLiveIdleReveal {
  id: string;
  slug: string;
  title: string;
  ticketNumber: number | null;
  muxPlaybackId: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
  prizeImageUrl: string | null;
  winnerPhotoUrl: string | null;
  winnerDisplayName: string | null;
}

export interface GoldenLiveSnapshot {
  polledAt: string;
  viewerCount: number | null;
  currentSession: SerializedKioskSession | null;
  idleReveal: GoldenLiveIdleReveal | null;
}

export async function getGoldenLiveSnapshot(): Promise<GoldenLiveSnapshot> {
  const [session, idleReveal] = await Promise.all([getCurrentGoldenLiveSession(), getLatestGoldenTicketReveal()]);

  return {
    polledAt: new Date().toISOString(),
    viewerCount: null,
    currentSession: session,
    idleReveal,
  };
}

async function getCurrentGoldenLiveSession() {
  const session = await prisma.kioskSession.findFirst({
    where: {
      isGoldenTicket: true,
      status: {
        in: PUBLIC_LIVE_SESSION_STATUSES,
      },
    },
    orderBy: {
      countdownStartedAt: "desc",
    },
    include: kioskSessionInclude,
  });

  if (!session) {
    return null;
  }

  const freshSession = await ensureFreshKioskSession(session);
  if (!PUBLIC_LIVE_SESSION_STATUSES.includes(freshSession.status)) {
    return null;
  }

  return serializeKioskSession(freshSession);
}

async function getLatestGoldenTicketReveal(): Promise<GoldenLiveIdleReveal | null> {
  const liveRip = await prisma.liveRip.findFirst({
    where: {
      isGoldenTicket: true,
      goldenTicket: {
        is: {
          winnerProfile: {
            is: {
              publishedAt: {
                not: null,
              },
            },
          },
        },
      },
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
                not: KioskSessionStatus.CANCELLED,
              },
            },
          },
        },
      ],
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      slug: true,
      title: true,
      videoUrl: true,
      thumbnailUrl: true,
      muxPlaybackId: true,
      goldenTicket: {
        select: {
          ticketNumber: true,
          prizeItem: {
            select: {
              imageUrl: true,
              thumbnailUrl: true,
              detailsJson: true,
            },
          },
          winnerProfile: {
            select: {
              displayName: true,
              winnerPhotoUrl: true,
              winnerPhotoApproved: true,
            },
          },
        },
      },
    },
  });

  if (!liveRip) {
    return null;
  }

  const prizeDetails = liveRip.goldenTicket?.prizeItem
    ? parseGoldenTicketPrizeDetails(liveRip.goldenTicket.prizeItem.detailsJson)
    : null;

  return {
    id: liveRip.id,
    slug: liveRip.slug,
    title: liveRip.title,
    ticketNumber: liveRip.goldenTicket?.ticketNumber ?? null,
    muxPlaybackId: liveRip.muxPlaybackId ?? null,
    videoUrl: liveRip.videoUrl,
    thumbnailUrl: liveRip.thumbnailUrl ?? null,
    prizeImageUrl:
      liveRip.goldenTicket?.prizeItem.thumbnailUrl ??
      liveRip.goldenTicket?.prizeItem.imageUrl ??
      prizeDetails?.photoGallery[0] ??
      null,
    winnerPhotoUrl:
      liveRip.goldenTicket?.winnerProfile?.winnerPhotoApproved
        ? liveRip.goldenTicket.winnerProfile.winnerPhotoUrl ?? null
        : null,
    winnerDisplayName: liveRip.goldenTicket?.winnerProfile?.displayName ?? null,
  };
}
