import type { NextApiRequest } from "next";
import { prisma } from "@tenkings/database";
import type { GoldenTicketStatus, Prisma } from "@prisma/client";
import { GoldenTicketConsentStatus, ItemStatus, KioskClaimStatus, ShippingStatus } from "@prisma/client";
import { z } from "zod";
import {
  buildGoldenTicketShareCardPath,
  buildGoldenTicketWinnerPath,
  buildGoldenTicketWinnerUrl,
  parseGoldenTicketPrizeDetails,
} from "./goldenTicket";
import { completeKioskSessionTransaction } from "./kioskCompletion";
import { buildSiteUrl } from "./urls";
import { requireUserSession, toUserErrorResponse } from "./session";

export const GOLDEN_TICKET_CONSENT_TEXT_VERSION =
  process.env.GOLDEN_TICKET_CONSENT_TEXT_VERSION?.trim() || "v1.0-2026-04-21";
export const GOLDEN_TICKET_MIN_AGE = Number(process.env.GOLDEN_TICKET_MIN_AGE ?? 18);
export const GOLDEN_TICKET_COUNTDOWN_SECONDS = 5;
export const GOLDEN_TICKET_LIVE_SECONDS = 60;
export const GOLDEN_TICKET_CONSENT_TEXT = `Golden Ticket Reveal - Consent to Record & Publish

By tapping "Unlock My Reveal" below, I confirm that:

- I am 18 years of age or older.
- I grant Ten Kings, LLC permission to access my device's camera and microphone for the duration of this reveal.
- I understand my reveal - including my face, voice, and reaction - will be recorded and livestreamed in real time to the Ten Kings platform at tenkings.co/live.
- I grant Ten Kings, LLC a perpetual, royalty-free license to use, edit, publish, and share the recorded reveal on Ten Kings websites, social media accounts, and marketing materials.
- I understand that once the reveal begins, the recording cannot be stopped or deleted by me. If I want my reveal removed from public display after the fact, I can email support@tenkings.co.
- I agree to the Ten Kings Terms of Service (https://tenkings.co/terms) and Privacy Policy (https://tenkings.co/privacy).`;

const dateInputSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must use YYYY-MM-DD format");

export const goldenTicketConsentSchema = z.object({
  goldenTicketCode: z.string().trim().min(4, "Golden ticket code is required"),
  consentTextVersion: z.string().trim().min(1, "Consent text version is required"),
  consentText: z.string().trim().min(1, "Consent text is required").optional(),
  dateOfBirth: dateInputSchema.optional(),
});

export const goldenTicketClaimSchema = z.object({
  shippingAddress: z.object({
    fullName: z.string().trim().min(1, "Full name is required"),
    street1: z.string().trim().min(1, "Street address is required"),
    street2: z.string().trim().optional(),
    city: z.string().trim().min(1, "City is required"),
    state: z.string().trim().min(2, "State is required").max(2, "Use a 2-letter state code"),
    postalCode: z.string().trim().min(1, "Postal code is required"),
    country: z.string().trim().min(2, "Country is required").default("US"),
  }),
  phone: z.string().trim().min(8, "Phone is required"),
  email: z.string().trim().email("Email must be valid").optional().or(z.literal("")),
  sourceLocationId: z.string().uuid("Choose where you got the pack"),
  size: z.string().trim().optional(),
  socialHandle: z.string().trim().max(120).optional(),
  sessionId: z.string().uuid("sessionId is required"),
});

export type GoldenTicketClaimInput = z.infer<typeof goldenTicketClaimSchema>;

export interface GoldenTicketViewer {
  id: string;
  phone: string | null;
  email: string | null;
  displayName: string | null;
  dateOfBirth: string | null;
}

export interface GoldenTicketLookupRecord {
  id: string;
  ticketNumber: number;
  code: string;
  status: GoldenTicketStatus;
  revealVideoAssetUrl: string | null;
  revealVideoPoster: string | null;
  scannedByUserId: string | null;
  claimedAt: string | null;
  claimUrl: string;
  winnerProfileUrl: string;
  shareCardUrl: string;
  prize: {
    itemId: string;
    name: string;
    description: string | null;
    category: string | null;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    estimatedValue: number | null;
    requiresSize: boolean;
    sizeOptions: string[];
  };
  sourceLocation: {
    id: string;
    name: string;
    slug: string;
  } | null;
  winnerProfile: {
    displayName: string;
    displayHandle: string | null;
    caption: string | null;
    publishedAt: string;
  } | null;
  liveRip: {
    slug: string;
    title: string;
    videoUrl: string;
    thumbnailUrl: string | null;
    muxPlaybackId: string | null;
  } | null;
}

export interface GoldenTicketWinnerDetail {
  ticketNumber: number;
  winnerProfileUrl: string;
  shareCardUrl: string;
  displayName: string;
  displayHandle: string | null;
  caption: string | null;
  publishedAt: string;
  claimedAt: string | null;
  winnerPhotoUrl: string | null;
  prize: {
    name: string;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    estimatedValue: number | null;
    description: string | null;
  };
  sourceLocation: {
    id: string;
    name: string;
    slug: string;
  } | null;
  liveRip: {
    slug: string;
    title: string;
    videoUrl: string;
    thumbnailUrl: string | null;
    muxPlaybackId: string | null;
  } | null;
}

export interface GoldenTicketWinnerListItem {
  id: string;
  ticketNumber: number;
  winnerProfileUrl: string;
  shareCardUrl: string;
  displayName: string;
  displayHandle: string | null;
  caption: string | null;
  featured: boolean;
  publishedAt: string;
  claimedAt: string | null;
  winnerPhotoUrl: string | null;
  prize: {
    name: string;
    imageUrl: string | null;
    thumbnailUrl: string | null;
  };
  sourceLocation: {
    id: string;
    name: string;
    slug: string;
  } | null;
  liveRip: {
    slug: string;
    title: string;
    videoUrl: string;
    thumbnailUrl: string | null;
    muxPlaybackId: string | null;
  } | null;
}

export interface GoldenTicketWinnerListResult {
  winners: GoldenTicketWinnerListItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface GoldenTicketHallStats {
  claimedCount: number;
  placedCount: number;
  totalMinted: number;
  featuredTicketIds: string[];
}

const PUBLIC_GOLDEN_TICKET_STATUSES: GoldenTicketStatus[] = ["CLAIMED", "FULFILLED"];

function resolveFirstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" ? value : null;
}

export function extractClientIp(req: NextApiRequest) {
  const forwardedFor = resolveFirstHeaderValue(req.headers["x-forwarded-for"]);
  if (forwardedFor) {
    return forwardedFor
      .split(",")
      .map((entry) => entry.trim())
      .find(Boolean) ?? "";
  }
  return resolveFirstHeaderValue(req.socket.remoteAddress) ?? "";
}

export function parseDateOnlyInput(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error("Date of birth is invalid");
  }
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function hasReachedMinimumAge(dateOfBirth: Date, minimumAge = GOLDEN_TICKET_MIN_AGE, today = new Date()) {
  const birthYear = dateOfBirth.getUTCFullYear();
  const birthMonth = dateOfBirth.getUTCMonth();
  const birthDay = dateOfBirth.getUTCDate();

  let age = today.getUTCFullYear() - birthYear;
  const currentMonth = today.getUTCMonth();
  const currentDay = today.getUTCDate();
  if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) {
    age -= 1;
  }
  return age >= minimumAge;
}

function buildWinnerProfileSummary(
  ticketNumber: number,
  winnerProfile: {
    displayName: string;
    displayHandle: string | null;
    caption: string | null;
    publishedAt: Date | null;
  } | null
) {
  if (!winnerProfile?.publishedAt) {
    return null;
  }

  return {
    displayName: winnerProfile.displayName,
    displayHandle: winnerProfile.displayHandle,
    caption: winnerProfile.caption,
    publishedAt: winnerProfile.publishedAt.toISOString(),
  };
}

export async function resolveOptionalGoldenTicketViewer(req: NextApiRequest): Promise<GoldenTicketViewer | null> {
  const userSession = await (async () => {
    try {
      return await requireUserSession(req);
    } catch (error) {
      return null;
    }
  })();

  if (!userSession) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userSession.user.id },
    select: {
      id: true,
      phone: true,
      email: true,
      displayName: true,
      dateOfBirth: true,
    },
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    phone: user.phone ?? null,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString() : null,
  };
}

export async function getGoldenTicketLookupRecord(code: string) {
  const ticket = await prisma.goldenTicket.findUnique({
    where: { code },
    include: {
      prizeItem: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          thumbnailUrl: true,
          estimatedValue: true,
          detailsJson: true,
        },
      },
      sourceLocation: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      winnerProfile: true,
      liveRip: {
        select: {
          slug: true,
          title: true,
          videoUrl: true,
          thumbnailUrl: true,
          muxPlaybackId: true,
        },
      },
    },
  });

  if (!ticket) {
    return null;
  }

  const prizeDetails = parseGoldenTicketPrizeDetails(ticket.prizeItem.detailsJson);

  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    code: ticket.code,
    status: ticket.status,
    revealVideoAssetUrl: ticket.revealVideoAssetUrl ?? null,
    revealVideoPoster: ticket.revealVideoPoster ?? null,
    scannedByUserId: ticket.scannedByUserId ?? null,
    claimedAt: ticket.claimedAt ? ticket.claimedAt.toISOString() : null,
    claimUrl: `/golden/claim/${ticket.code}`,
    winnerProfileUrl: buildGoldenTicketWinnerPath(ticket.ticketNumber),
    shareCardUrl: buildGoldenTicketShareCardPath(ticket.ticketNumber),
    prize: {
      itemId: ticket.prizeItem.id,
      name: ticket.prizeItem.name,
      description: prizeDetails.description,
      category: prizeDetails.category,
      imageUrl: ticket.prizeItem.imageUrl ?? prizeDetails.photoGallery[0] ?? null,
      thumbnailUrl: ticket.prizeItem.thumbnailUrl ?? ticket.prizeItem.imageUrl ?? prizeDetails.photoGallery[0] ?? null,
      estimatedValue: ticket.prizeItem.estimatedValue ?? null,
      requiresSize: prizeDetails.requiresSize,
      sizeOptions: prizeDetails.sizeOptions,
    },
    sourceLocation: ticket.sourceLocation
      ? {
          id: ticket.sourceLocation.id,
          name: ticket.sourceLocation.name,
          slug: ticket.sourceLocation.slug,
        }
      : null,
    winnerProfile: buildWinnerProfileSummary(ticket.ticketNumber, ticket.winnerProfile),
    liveRip: ticket.liveRip
      ? {
          slug: ticket.liveRip.slug,
          title: ticket.liveRip.title,
          videoUrl: ticket.liveRip.videoUrl,
          thumbnailUrl: ticket.liveRip.thumbnailUrl ?? null,
          muxPlaybackId: ticket.liveRip.muxPlaybackId ?? null,
        }
      : null,
  } satisfies GoldenTicketLookupRecord;
}

export async function recordGoldenTicketConsent(
  req: NextApiRequest,
  input: z.infer<typeof goldenTicketConsentSchema>
) {
  const session = await requireUserSession(req);
  const viewer = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      dateOfBirth: true,
    },
  });

  if (!viewer) {
    throw new Error("User not found");
  }

  const normalizedCode = input.goldenTicketCode.trim();
  const ticket = await prisma.goldenTicket.findUnique({
    where: { code: normalizedCode },
    select: {
      id: true,
      status: true,
      scannedByUserId: true,
    },
  });

  if (!ticket) {
    throw Object.assign(new Error("Golden ticket not found"), { statusCode: 404 });
  }

  if (ticket.scannedByUserId && ticket.scannedByUserId !== session.user.id) {
    throw Object.assign(new Error("This ticket is already being claimed by another user"), { statusCode: 409 });
  }

  let dateOfBirth = viewer.dateOfBirth;
  if (!dateOfBirth && input.dateOfBirth) {
    dateOfBirth = parseDateOnlyInput(input.dateOfBirth);
  }

  if (!dateOfBirth) {
    throw Object.assign(new Error("Date of birth is required"), { statusCode: 400 });
  }

  if (!hasReachedMinimumAge(dateOfBirth)) {
    throw Object.assign(new Error("Golden Ticket claims are for Kings 18 and over."), { statusCode: 403 });
  }

  const ipAddress = extractClientIp(req);
  const userAgent = resolveFirstHeaderValue(req.headers["user-agent"]) ?? "";
  const consentText = input.consentText?.trim() || GOLDEN_TICKET_CONSENT_TEXT;

  const consent = await prisma.$transaction(async (tx) => {
    if (!viewer.dateOfBirth) {
      await tx.user.update({
        where: { id: viewer.id },
        data: {
          dateOfBirth,
        },
      });
    }

    return tx.goldenTicketConsent.upsert({
      where: { goldenTicketId: ticket.id },
      update: {
        userId: session.user.id,
        status: GoldenTicketConsentStatus.GRANTED,
        consentText,
        consentTextVersion: input.consentTextVersion,
        userAgent,
        ipAddress,
      },
      create: {
        goldenTicketId: ticket.id,
        userId: session.user.id,
        status: GoldenTicketConsentStatus.GRANTED,
        consentText,
        consentTextVersion: input.consentTextVersion,
        userAgent,
        ipAddress,
      },
    });
  });

  return {
    consentId: consent.id,
    userId: session.user.id,
    dateOfBirth: dateOfBirth.toISOString(),
  };
}

function buildWinnerProfilePayload(
  ticketNumber: number,
  winnerProfile: {
    displayName: string;
    displayHandle: string | null;
    caption: string | null;
    publishedAt: Date;
    winnerPhotoUrl: string | null;
    winnerPhotoApproved: boolean;
  },
  liveRip: { slug: string; title: string; videoUrl: string; thumbnailUrl: string | null; muxPlaybackId: string | null } | null,
  prize: {
    name: string;
    imageUrl: string | null;
    thumbnailUrl?: string | null;
    estimatedValue: number | null;
    detailsJson: Prisma.JsonValue | null;
  },
  sourceLocation: { id: string; name: string; slug: string } | null,
  claimedAt: Date | null
) {
  const prizeDetails = parseGoldenTicketPrizeDetails(prize.detailsJson);
  const prizeImageUrl = prize.imageUrl ?? prizeDetails.photoGallery[0] ?? null;
  const prizeThumbnailUrl = prize.thumbnailUrl ?? prizeImageUrl;
  return {
    ticketNumber,
    winnerProfileUrl: buildGoldenTicketWinnerPath(ticketNumber),
    shareCardUrl: buildGoldenTicketShareCardPath(ticketNumber),
    displayName: winnerProfile.displayName,
    displayHandle: winnerProfile.displayHandle,
    caption: winnerProfile.caption,
    publishedAt: winnerProfile.publishedAt.toISOString(),
    claimedAt: claimedAt ? claimedAt.toISOString() : null,
    winnerPhotoUrl: winnerProfile.winnerPhotoApproved ? winnerProfile.winnerPhotoUrl ?? null : null,
    prize: {
      name: prize.name,
      imageUrl: prizeImageUrl,
      thumbnailUrl: prizeThumbnailUrl,
      estimatedValue: prize.estimatedValue ?? null,
      description: prizeDetails.description,
    },
    sourceLocation,
    liveRip,
  } satisfies GoldenTicketWinnerDetail;
}

function buildGoldenTicketWinnerListItem(
  ticket: {
    id: string;
    ticketNumber: number;
    claimedAt: Date | null;
    sourceLocation: {
      id: string;
      name: string;
      slug: string;
    } | null;
    liveRip: {
      slug: string;
      title: string;
      videoUrl: string;
      thumbnailUrl: string | null;
      muxPlaybackId: string | null;
    } | null;
    prizeItem: {
      name: string;
      imageUrl: string | null;
      thumbnailUrl: string | null;
      detailsJson: Prisma.JsonValue | null;
    };
  },
  winnerProfile: {
    displayName: string;
    displayHandle: string | null;
    caption: string | null;
    featured: boolean;
    publishedAt: Date;
    winnerPhotoUrl: string | null;
    winnerPhotoApproved: boolean;
  }
) {
  const prizeDetails = parseGoldenTicketPrizeDetails(ticket.prizeItem.detailsJson);
  const imageUrl = ticket.prizeItem.imageUrl ?? prizeDetails.photoGallery[0] ?? null;
  const thumbnailUrl = ticket.prizeItem.thumbnailUrl ?? imageUrl;

  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    winnerProfileUrl: buildGoldenTicketWinnerPath(ticket.ticketNumber),
    shareCardUrl: buildGoldenTicketShareCardPath(ticket.ticketNumber),
    displayName: winnerProfile.displayName,
    displayHandle: winnerProfile.displayHandle,
    caption: winnerProfile.caption,
    featured: winnerProfile.featured,
    publishedAt: winnerProfile.publishedAt.toISOString(),
    claimedAt: ticket.claimedAt ? ticket.claimedAt.toISOString() : null,
    winnerPhotoUrl: winnerProfile.winnerPhotoApproved ? winnerProfile.winnerPhotoUrl ?? null : null,
    prize: {
      name: ticket.prizeItem.name,
      imageUrl,
      thumbnailUrl,
    },
    sourceLocation: ticket.sourceLocation,
    liveRip: ticket.liveRip,
  } satisfies GoldenTicketWinnerListItem;
}

export async function getGoldenTicketWinnerByTicketNumber(ticketNumber: number) {
  return getPublicGoldenTicketWinnerByTicketNumber(ticketNumber);
}

export async function getPublicGoldenTicketWinnerByTicketNumber(ticketNumber: number) {
  const ticket = await prisma.goldenTicket.findFirst({
    where: {
      ticketNumber,
      status: {
        in: PUBLIC_GOLDEN_TICKET_STATUSES,
      },
      winnerProfile: {
        is: {
          publishedAt: {
            not: null,
          },
        },
      },
    },
    include: {
      winnerProfile: true,
      prizeItem: {
        select: {
          name: true,
          imageUrl: true,
          thumbnailUrl: true,
          estimatedValue: true,
          detailsJson: true,
        },
      },
      sourceLocation: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      liveRip: {
        select: {
          slug: true,
          title: true,
          videoUrl: true,
          thumbnailUrl: true,
          muxPlaybackId: true,
        },
      },
    },
  });

  if (!ticket || !ticket.winnerProfile?.publishedAt) {
    return null;
  }

  return buildWinnerProfilePayload(
    ticket.ticketNumber,
    {
      ...ticket.winnerProfile,
      publishedAt: ticket.winnerProfile.publishedAt,
    },
    ticket.liveRip
      ? {
          slug: ticket.liveRip.slug,
          title: ticket.liveRip.title,
          videoUrl: ticket.liveRip.videoUrl,
          thumbnailUrl: ticket.liveRip.thumbnailUrl ?? null,
          muxPlaybackId: ticket.liveRip.muxPlaybackId ?? null,
        }
      : null,
    ticket.prizeItem,
    ticket.sourceLocation
      ? {
          id: ticket.sourceLocation.id,
          name: ticket.sourceLocation.name,
          slug: ticket.sourceLocation.slug,
        }
      : null,
    ticket.claimedAt
  );
}

export async function listGoldenTicketWinners({
  page = 1,
  limit = 12,
  order = "featured",
}: {
  page?: number;
  limit?: number;
  order?: "featured" | "recent";
} = {}): Promise<GoldenTicketWinnerListResult> {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(1, Math.trunc(limit)), 24) : 12;
  const skip = (safePage - 1) * safeLimit;
  const orderBy =
    order === "recent"
      ? [{ publishedAt: "desc" as const }]
      : [{ featured: "desc" as const }, { publishedAt: "desc" as const }];

  const [totalCount, rows] = await Promise.all([
    prisma.goldenTicketWinnerProfile.count({
      where: {
        publishedAt: {
          not: null,
        },
      },
    }),
    prisma.goldenTicketWinnerProfile.findMany({
      where: {
        publishedAt: {
          not: null,
        },
      },
      orderBy,
      skip,
      take: safeLimit,
      select: {
        displayName: true,
        displayHandle: true,
        caption: true,
        featured: true,
        publishedAt: true,
        winnerPhotoUrl: true,
        winnerPhotoApproved: true,
        goldenTicket: {
          select: {
            id: true,
            ticketNumber: true,
            claimedAt: true,
            prizeItem: {
              select: {
                name: true,
                imageUrl: true,
                thumbnailUrl: true,
                detailsJson: true,
              },
            },
            sourceLocation: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            liveRip: {
              select: {
                slug: true,
                title: true,
                videoUrl: true,
                thumbnailUrl: true,
                muxPlaybackId: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / safeLimit));
  return {
    winners: rows.flatMap((row) =>
      row.publishedAt
        ? [
            buildGoldenTicketWinnerListItem(
              {
                id: row.goldenTicket.id,
                ticketNumber: row.goldenTicket.ticketNumber,
                claimedAt: row.goldenTicket.claimedAt,
                prizeItem: row.goldenTicket.prizeItem,
                sourceLocation: row.goldenTicket.sourceLocation
                  ? {
                      id: row.goldenTicket.sourceLocation.id,
                      name: row.goldenTicket.sourceLocation.name,
                      slug: row.goldenTicket.sourceLocation.slug,
                    }
                  : null,
                liveRip: row.goldenTicket.liveRip
                  ? {
                      slug: row.goldenTicket.liveRip.slug,
                      title: row.goldenTicket.liveRip.title,
                      videoUrl: row.goldenTicket.liveRip.videoUrl,
                      thumbnailUrl: row.goldenTicket.liveRip.thumbnailUrl ?? null,
                      muxPlaybackId: row.goldenTicket.liveRip.muxPlaybackId ?? null,
                    }
                  : null,
              },
              {
                ...row,
                publishedAt: row.publishedAt,
              }
            ),
          ]
        : []
    ),
    pagination: {
      page: safePage,
      limit: safeLimit,
      totalCount,
      totalPages,
      hasMore: safePage < totalPages,
    },
  };
}

export async function getGoldenTicketHallStats(): Promise<GoldenTicketHallStats> {
  const [claimedCount, placedCount, totalMinted, featuredProfiles] = await Promise.all([
    prisma.goldenTicket.count({
      where: {
        status: "CLAIMED",
      },
    }),
    prisma.goldenTicket.count({
      where: {
        status: "PLACED",
      },
    }),
    prisma.goldenTicket.count(),
    prisma.goldenTicketWinnerProfile.findMany({
      where: {
        featured: true,
        publishedAt: {
          not: null,
        },
      },
      orderBy: {
        publishedAt: "desc",
      },
      select: {
        goldenTicketId: true,
      },
    }),
  ]);

  return {
    claimedCount,
    placedCount,
    totalMinted,
    featuredTicketIds: featuredProfiles.map((profile) => profile.goldenTicketId),
  };
}

function buildGoldenTicketNotes(size?: string, socialHandle?: string) {
  const notes: string[] = [];
  if (size?.trim()) {
    notes.push(`Preferred size: ${size.trim()}`);
  }
  if (socialHandle?.trim()) {
    notes.push(`Social handle: ${socialHandle.trim()}`);
  }
  return notes.length > 0 ? notes.join("\n") : null;
}

async function sendGoldenTicketClaimSms(to: string, profileUrl: string) {
  if (process.env.OUTBOUND_SMS_ENABLED !== "true") {
    console.info("[outbound-sms] skipped (gate disabled)");
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const fromNumber = process.env.TWILIO_SMS_FROM?.trim();

  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    throw new Error("Outbound SMS is enabled but Twilio messaging credentials are incomplete");
  }

  const template =
    process.env.GOLDEN_TICKET_CLAIM_SMS_TEMPLATE?.trim() ||
    "Welcome to the Hall, King. Your Golden Ticket reveal is live at {profileUrl}. Your prize ships within 3 business days.";

  const body = template.replaceAll("{profileUrl}", profileUrl);
  const payload = new URLSearchParams();
  payload.set("To", to);
  payload.set("Body", body);
  if (messagingServiceSid) {
    payload.set("MessagingServiceSid", messagingServiceSid);
  } else if (fromNumber) {
    payload.set("From", fromNumber);
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "Twilio request failed");
    throw new Error(message || "Twilio request failed");
  }
}

export async function finalizeGoldenTicketClaim(req: NextApiRequest, code: string, input: GoldenTicketClaimInput) {
  const session = await requireUserSession(req);
  const payload = goldenTicketClaimSchema.parse(input);
  const absoluteProfileUrl = (ticketNumber: number) => buildGoldenTicketWinnerUrl(ticketNumber);

  const result = await prisma.$transaction(async (tx) => {
    const ticket = await tx.goldenTicket.findUnique({
      where: { code },
      include: {
        prizeItem: {
          include: {
            shippingRequest: true,
          },
        },
        winnerProfile: true,
        liveRip: true,
        consent: true,
      },
    });

    if (!ticket) {
      throw Object.assign(new Error("Golden ticket not found"), { statusCode: 404 });
    }

    if (ticket.status === "CLAIMED" && ticket.scannedByUserId === session.user.id && ticket.winnerProfile) {
      return {
        ticketNumber: ticket.ticketNumber,
        winnerProfileUrl: buildGoldenTicketWinnerPath(ticket.ticketNumber),
        shareCardUrl: buildGoldenTicketShareCardPath(ticket.ticketNumber),
        phoneForSms: null,
      };
    }

    if (ticket.status !== "SCANNED") {
      throw Object.assign(new Error("Golden ticket is not ready to claim"), { statusCode: 409 });
    }

    if (ticket.scannedByUserId && ticket.scannedByUserId !== session.user.id) {
      throw Object.assign(new Error("This ticket is already being claimed by another user"), { statusCode: 409 });
    }

    if (!ticket.consent || ticket.consent.userId !== session.user.id) {
      throw Object.assign(new Error("Consent is required before you can claim this ticket"), { statusCode: 409 });
    }

    if (ticket.prizeItem.shippingRequest) {
      throw Object.assign(new Error("This prize already has a shipping request"), { statusCode: 409 });
    }

    const claimSession = await tx.kioskSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        liveRip: true,
      },
    });

    if (!claimSession) {
      throw Object.assign(new Error("Reveal session not found"), { statusCode: 404 });
    }

    if (claimSession.userId !== session.user.id || claimSession.goldenTicketId !== ticket.id) {
      throw Object.assign(new Error("Reveal session does not match this Golden Ticket"), { statusCode: 403 });
    }

    if (claimSession.revealItemId !== ticket.prizeItemId) {
      throw Object.assign(new Error("Reveal session has not completed the prize reveal"), { statusCode: 409 });
    }

    const sourceLocation = await tx.location.findUnique({
      where: { id: payload.sourceLocationId },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    if (!sourceLocation) {
      throw Object.assign(new Error("Selected source location was not found"), { statusCode: 404 });
    }

    const user = await tx.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        displayName: true,
        email: true,
        phone: true,
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const nextDisplayName = payload.shippingAddress.fullName.trim();
    const nextEmail = payload.email?.trim() || null;
    await tx.user.update({
      where: { id: user.id },
      data: {
        displayName: nextDisplayName,
        email: nextEmail ?? user.email ?? undefined,
      },
    });

    if (ticket.prizeItem.ownerId !== session.user.id) {
      await tx.item.update({
        where: { id: ticket.prizeItem.id },
        data: {
          ownerId: session.user.id,
          status: ItemStatus.IN_TRANSFER,
        },
      });
    }

    const ownership = await tx.itemOwnership.findFirst({
      where: {
        itemId: ticket.prizeItem.id,
        ownerId: session.user.id,
      },
      select: { id: true },
    });

    if (!ownership) {
      await tx.itemOwnership.create({
        data: {
          itemId: ticket.prizeItem.id,
          ownerId: session.user.id,
          note: "Golden Ticket prize claim",
        },
      });
    }

    const shippingRequest = await tx.shippingRequest.create({
      data: {
        itemId: ticket.prizeItem.id,
        userId: session.user.id,
        status: ShippingStatus.PENDING,
        recipientName: nextDisplayName,
        addressLine1: payload.shippingAddress.street1.trim(),
        addressLine2: payload.shippingAddress.street2?.trim() || null,
        city: payload.shippingAddress.city.trim(),
        state: payload.shippingAddress.state.trim(),
        postalCode: payload.shippingAddress.postalCode.trim(),
        country: payload.shippingAddress.country.trim() || "US",
        phone: payload.phone.trim(),
        email: nextEmail,
        processingFeeMinor: 0,
        shippingFeeMinor: 0,
        totalFeeMinor: 0,
        notes: buildGoldenTicketNotes(payload.size, payload.socialHandle),
        isGoldenTicket: true,
        goldenTicketId: ticket.id,
      },
    });

    await tx.kioskSession.update({
      where: { id: claimSession.id },
      data: {
        claimedById: session.user.id,
        claimStatus: KioskClaimStatus.CLAIMED,
      },
    });

    const completionTitle = `Golden Ticket ${ticket.ticketNumber} · ${nextDisplayName}`;
    await completeKioskSessionTransaction(tx, claimSession.id, {
      publish: true,
      title: completionTitle,
      description: `${nextDisplayName} claimed ${ticket.prizeItem.name}.`,
      thumbnailUrl: claimSession.thumbnailUrl ?? ticket.revealVideoPoster ?? ticket.prizeItem.imageUrl ?? undefined,
      featured: true,
    });

    const winnerProfile = await tx.goldenTicketWinnerProfile.create({
      data: {
        goldenTicketId: ticket.id,
        displayName: nextDisplayName,
        displayHandle: payload.socialHandle?.trim() || null,
        caption: null,
      },
    });

    await tx.goldenTicket.update({
      where: { id: ticket.id },
      data: {
        status: "CLAIMED",
        claimedAt: new Date(),
        claimedKioskSessionId: claimSession.id,
        sourceLocationId: sourceLocation.id,
      },
    });

    return {
      ticketNumber: ticket.ticketNumber,
      winnerProfileUrl: buildGoldenTicketWinnerPath(ticket.ticketNumber),
      shareCardUrl: buildGoldenTicketShareCardPath(ticket.ticketNumber),
      phoneForSms: payload.phone.trim() || user.phone || null,
    };
  });

  try {
    if (result.phoneForSms) {
      await sendGoldenTicketClaimSms(result.phoneForSms, absoluteProfileUrl(result.ticketNumber));
    } else if (process.env.OUTBOUND_SMS_ENABLED !== "true") {
      console.info("[outbound-sms] skipped (gate disabled)");
    }
  } catch (error) {
    console.error("[outbound-sms] failed", error);
  }

  return {
    success: true as const,
    ticketNumber: result.ticketNumber,
    winnerProfileUrl: result.winnerProfileUrl,
    shareCardUrl: result.shareCardUrl,
  };
}

export function toGoldenTicketError(error: unknown) {
  const response = toUserErrorResponse(error);
  const statusCode =
    typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode?: unknown }).statusCode) : response.status;

  return {
    status: Number.isFinite(statusCode) ? statusCode : response.status,
    message: response.message,
  } as const;
}

export function resolveGoldenTicketShareCardRedirect(winner: GoldenTicketWinnerDetail) {
  return winner.liveRip?.thumbnailUrl || winner.prize.imageUrl || buildSiteUrl(winner.winnerProfileUrl);
}
