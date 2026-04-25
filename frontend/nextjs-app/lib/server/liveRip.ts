import { KioskSessionStatus, LiveRipStatus, prisma } from "@tenkings/database";
import type { LiveRip, Prisma } from "@prisma/client";
import {
  LIVE_RIP_CONSENT_TEXT as DEFAULT_LIVE_RIP_CONSENT_TEXT,
  LIVE_RIP_CONSENT_TEXT_VERSION as DEFAULT_LIVE_RIP_CONSENT_TEXT_VERSION,
  LIVE_RIP_MIN_AGE as DEFAULT_LIVE_RIP_MIN_AGE,
} from "../liveRipConsent";
import { slugify } from "../slugify";
import { buildMuxPlaybackUrl } from "./mux";
import { kioskSessionInclude, serializeKioskSession } from "./kioskSession";
import { ensureFreshKioskSession } from "./kioskSessionLifecycle";

export const LIVE_RIP_CONSENT_TEXT_VERSION =
  process.env.LIVE_RIP_CONSENT_TEXT_VERSION?.trim() || DEFAULT_LIVE_RIP_CONSENT_TEXT_VERSION;
export const LIVE_RIP_MIN_AGE = Number(process.env.LIVE_RIP_MIN_AGE ?? DEFAULT_LIVE_RIP_MIN_AGE);
export const LIVE_RIP_CONSENT_TEXT =
  process.env.LIVE_RIP_CONSENT_TEXT && process.env.LIVE_RIP_CONSENT_TEXT.length > 0
    ? process.env.LIVE_RIP_CONSENT_TEXT
    : DEFAULT_LIVE_RIP_CONSENT_TEXT;

const ACTIVE_GOLDEN_TICKET_STATUSES: KioskSessionStatus[] = [
  KioskSessionStatus.LIVE,
  KioskSessionStatus.REVEAL,
];

export type LiveRipSummary = {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  muxPlaybackId: string | null;
  isGoldenTicket: boolean;
  status: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  watchUrl: string | null;
  location: {
    id: string;
    name: string;
    slug: string;
  } | null;
  ticketNumber: number | null;
};

export type LiveStatePayload = {
  goldenTicketActive: LiveRipSummary | null;
  regularActive: LiveRipSummary[];
  goldenTicketReveals: LiveRipSummary[];
  pastRips: LiveRipSummary[];
};

type LiveRipWithRelations = Prisma.LiveRipGetPayload<{
  include: {
    location: {
      select: {
        id: true;
        name: true;
        slug: true;
      };
    };
    goldenTicket: {
      select: {
        ticketNumber: true;
      };
    };
  };
}>;

export function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isAtLeastAge(date: Date, minAge = LIVE_RIP_MIN_AGE) {
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - date.getUTCMonth();
  const dayDiff = now.getUTCDate() - date.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return age >= minAge;
}

export async function reserveLiveRipSlug(tx: Prisma.TransactionClient, baseInput: string, fallbackSeed: string) {
  let slugBase = slugify(baseInput);
  if (!slugBase) {
    slugBase = slugify(fallbackSeed) || `rip-${Date.now()}`;
  }

  let candidateSlug = slugBase;
  let attempt = 1;
  while (await tx.liveRip.findUnique({ where: { slug: candidateSlug } })) {
    candidateSlug = `${slugBase}-${attempt++}`;
  }
  return candidateSlug;
}

function liveRipWatchUrl(slug: string | null) {
  return slug ? `/live/${slug}` : null;
}

function serializeLiveRip(liveRip: LiveRipWithRelations): LiveRipSummary {
  return {
    id: liveRip.id,
    slug: liveRip.slug,
    title: liveRip.title,
    description: liveRip.description ?? null,
    videoUrl: liveRip.videoUrl ?? null,
    thumbnailUrl: liveRip.thumbnailUrl ?? null,
    muxPlaybackId: liveRip.muxPlaybackId ?? null,
    isGoldenTicket: liveRip.isGoldenTicket,
    status: liveRip.status,
    createdAt: liveRip.createdAt.toISOString(),
    startedAt: liveRip.startedAt ? liveRip.startedAt.toISOString() : null,
    endedAt: liveRip.endedAt ? liveRip.endedAt.toISOString() : null,
    watchUrl: liveRipWatchUrl(liveRip.slug),
    location: liveRip.location,
    ticketNumber: liveRip.goldenTicket?.ticketNumber ?? null,
  };
}

export function buildMuxThumbnailUrl(playbackId: string) {
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?time=3&width=540&height=960&fit_mode=smartcrop`;
}

export async function getActiveGoldenTicketStream(): Promise<LiveRipSummary | null> {
  const session = await prisma.kioskSession.findFirst({
    where: {
      isGoldenTicket: true,
      status: {
        in: ACTIVE_GOLDEN_TICKET_STATUSES,
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
  if (!ACTIVE_GOLDEN_TICKET_STATUSES.includes(freshSession.status)) {
    return null;
  }

  const serialized = serializeKioskSession(freshSession);
  const playbackUrl = serialized.muxPlaybackId ? buildMuxPlaybackUrl(serialized.muxPlaybackId) : serialized.videoUrl;

  return {
    id: serialized.liveRip?.id ?? serialized.id,
    slug: serialized.liveRip?.slug ?? null,
    title: "GOLDEN TICKET LIVE REVEAL",
    description: "A Ten Kings Golden Ticket reveal is live now.",
    videoUrl: playbackUrl ?? null,
    thumbnailUrl: serialized.thumbnailUrl ?? null,
    muxPlaybackId: serialized.muxPlaybackId ?? null,
    isGoldenTicket: true,
    status: serialized.status,
    createdAt: serialized.countdownStartedAt,
    startedAt: serialized.liveStartedAt ?? serialized.countdownStartedAt,
    endedAt: null,
    watchUrl: liveRipWatchUrl(serialized.liveRip?.slug ?? null),
    location: serialized.location,
    ticketNumber: null,
  };
}

const liveRipInclude = {
  location: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  goldenTicket: {
    select: {
      ticketNumber: true,
    },
  },
} satisfies Prisma.LiveRipInclude;

const publicNotCancelledWhere = {
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
} satisfies Prisma.LiveRipWhereInput;

export async function getActiveRegularLiveRips(): Promise<LiveRipSummary[]> {
  const liveRips = await prisma.liveRip.findMany({
    where: {
      ...publicNotCancelledWhere,
      isGoldenTicket: false,
      status: LiveRipStatus.LIVE,
    },
    include: liveRipInclude,
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    take: 20,
  });

  return liveRips.map(serializeLiveRip);
}

export async function getGoldenTicketReveals(limit = 12): Promise<LiveRipSummary[]> {
  const liveRips = await prisma.liveRip.findMany({
    where: {
      ...publicNotCancelledWhere,
      isGoldenTicket: true,
      status: LiveRipStatus.COMPLETE,
    },
    include: liveRipInclude,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return liveRips.map(serializeLiveRip);
}

export async function getPastRips(limit = 36): Promise<LiveRipSummary[]> {
  const liveRips = await prisma.liveRip.findMany({
    where: {
      ...publicNotCancelledWhere,
      status: LiveRipStatus.COMPLETE,
    },
    include: liveRipInclude,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return liveRips.map(serializeLiveRip);
}

export async function getLiveState(limit = { goldenTicketReveals: 12, pastRips: 36 }): Promise<LiveStatePayload> {
  const [goldenTicketActive, regularActive, goldenTicketReveals, pastRips] = await Promise.all([
    getActiveGoldenTicketStream(),
    getActiveRegularLiveRips(),
    getGoldenTicketReveals(limit.goldenTicketReveals),
    getPastRips(limit.pastRips),
  ]);

  return {
    goldenTicketActive,
    regularActive,
    goldenTicketReveals,
    pastRips,
  };
}

export function buildBuyerLiveRipTitle(packName: string, displayName?: string | null) {
  const buyer = displayName?.trim() || "Ten Kings Collector";
  return `${buyer} rips ${packName}`;
}

export function isLiveRipCurrentlyLive(liveRip: Pick<LiveRip, "status">) {
  return liveRip.status === LiveRipStatus.LIVE;
}
