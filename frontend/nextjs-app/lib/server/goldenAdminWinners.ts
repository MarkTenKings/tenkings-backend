import { prisma } from "@tenkings/database";
import type { Prisma } from "@prisma/client";
import { formatGoldenTicketLabel } from "../goldenTicketLabel";
import { buildGoldenTicketShareCardPath, buildGoldenTicketWinnerPath, parseGoldenTicketPrizeDetails } from "./goldenTicket";

export type AdminGoldenTicketWinnerSort = "recent" | "oldest";

export interface AdminGoldenTicketWinnerListItem {
  id: string;
  goldenTicketId: string;
  ticketNumber: number;
  ticketLabel: string;
  winnerProfileUrl: string;
  shareCardUrl: string;
  displayName: string;
  displayHandle: string | null;
  caption: string | null;
  featured: boolean;
  publishedAt: string | null;
  claimedAt: string | null;
  winnerPhotoUrl: string | null;
  winnerPhotoApproved: boolean;
  prize: {
    name: string;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    estimatedValue: number | null;
  };
  sourceLocation: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface AdminGoldenTicketWinnerListResult {
  winners: AdminGoldenTicketWinnerListItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
  };
  stats: {
    totalCount: number;
    publishedCount: number;
    unpublishedCount: number;
    featuredCount: number;
    photoSubmittedCount: number;
    photoApprovedCount: number;
    photoPendingCount: number;
  };
}

export interface UpdateAdminGoldenTicketWinnerInput {
  caption?: string | null;
  featured?: boolean;
  winnerPhotoApproved?: boolean;
  publishedAt?: Date | null;
  unpublished?: boolean;
}

const adminGoldenTicketWinnerSelect = {
  id: true,
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
    },
  },
} as const;

type AdminGoldenTicketWinnerRow = Prisma.GoldenTicketWinnerProfileGetPayload<{
  select: typeof adminGoldenTicketWinnerSelect;
}>;

function buildAdminGoldenTicketWinnerListItem(row: AdminGoldenTicketWinnerRow): AdminGoldenTicketWinnerListItem {
  const prizeDetails = parseGoldenTicketPrizeDetails(row.goldenTicket.prizeItem.detailsJson);
  const prizeImageUrl = row.goldenTicket.prizeItem.imageUrl ?? prizeDetails.photoGallery[0] ?? null;
  const prizeThumbnailUrl = row.goldenTicket.prizeItem.thumbnailUrl ?? prizeImageUrl;

  return {
    id: row.id,
    goldenTicketId: row.goldenTicket.id,
    ticketNumber: row.goldenTicket.ticketNumber,
    ticketLabel: formatGoldenTicketLabel(row.goldenTicket.ticketNumber),
    winnerProfileUrl: buildGoldenTicketWinnerPath(row.goldenTicket.ticketNumber),
    shareCardUrl: buildGoldenTicketShareCardPath(row.goldenTicket.ticketNumber),
    displayName: row.displayName,
    displayHandle: row.displayHandle,
    caption: row.caption,
    featured: row.featured,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    claimedAt: row.goldenTicket.claimedAt ? row.goldenTicket.claimedAt.toISOString() : null,
    winnerPhotoUrl: row.winnerPhotoUrl ?? null,
    winnerPhotoApproved: row.winnerPhotoApproved,
    prize: {
      name: row.goldenTicket.prizeItem.name,
      imageUrl: prizeImageUrl,
      thumbnailUrl: prizeThumbnailUrl,
      estimatedValue: row.goldenTicket.prizeItem.estimatedValue ?? null,
    },
    sourceLocation: row.goldenTicket.sourceLocation
      ? {
          id: row.goldenTicket.sourceLocation.id,
          name: row.goldenTicket.sourceLocation.name,
          slug: row.goldenTicket.sourceLocation.slug,
        }
      : null,
  };
}

function getAdminGoldenTicketWinnerOrderBy(sort: AdminGoldenTicketWinnerSort): Prisma.GoldenTicketWinnerProfileOrderByWithRelationInput[] {
  if (sort === "oldest") {
    return [{ goldenTicket: { claimedAt: "asc" } }, { goldenTicket: { ticketNumber: "asc" } }];
  }

  return [{ goldenTicket: { claimedAt: "desc" } }, { goldenTicket: { ticketNumber: "desc" } }];
}

export async function listAdminGoldenTicketWinners({
  page = 1,
  limit = 20,
  sort = "recent",
}: {
  page?: number;
  limit?: number;
  sort?: AdminGoldenTicketWinnerSort;
} = {}): Promise<AdminGoldenTicketWinnerListResult> {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(1, Math.trunc(limit)), 50) : 20;
  const skip = (safePage - 1) * safeLimit;
  const orderBy = getAdminGoldenTicketWinnerOrderBy(sort);

  const [totalCount, publishedCount, featuredCount, photoSubmittedCount, photoApprovedCount, rows] = await Promise.all([
    prisma.goldenTicketWinnerProfile.count(),
    prisma.goldenTicketWinnerProfile.count({
      where: {
        publishedAt: {
          not: null,
        },
      },
    }),
    prisma.goldenTicketWinnerProfile.count({
      where: {
        featured: true,
      },
    }),
    prisma.goldenTicketWinnerProfile.count({
      where: {
        winnerPhotoUrl: {
          not: null,
        },
      },
    }),
    prisma.goldenTicketWinnerProfile.count({
      where: {
        winnerPhotoUrl: {
          not: null,
        },
        winnerPhotoApproved: true,
      },
    }),
    prisma.goldenTicketWinnerProfile.findMany({
      orderBy,
      skip,
      take: safeLimit,
      select: adminGoldenTicketWinnerSelect,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / safeLimit));
  return {
    winners: rows.map(buildAdminGoldenTicketWinnerListItem),
    pagination: {
      page: safePage,
      limit: safeLimit,
      totalCount,
      totalPages,
      hasMore: safePage < totalPages,
    },
    stats: {
      totalCount,
      publishedCount,
      unpublishedCount: Math.max(totalCount - publishedCount, 0),
      featuredCount,
      photoSubmittedCount,
      photoApprovedCount,
      photoPendingCount: Math.max(photoSubmittedCount - photoApprovedCount, 0),
    },
  };
}

export async function updateAdminGoldenTicketWinner(
  id: string,
  input: UpdateAdminGoldenTicketWinnerInput
): Promise<AdminGoldenTicketWinnerListItem> {
  const existing = await prisma.goldenTicketWinnerProfile.findUnique({
    where: { id },
    select: adminGoldenTicketWinnerSelect,
  });

  if (!existing) {
    throw Object.assign(new Error("Golden Ticket winner profile not found"), { statusCode: 404 });
  }

  if (input.winnerPhotoApproved === true && !existing.winnerPhotoUrl) {
    throw Object.assign(new Error("No winner photo has been submitted for this profile"), { statusCode: 409 });
  }

  const data: Prisma.GoldenTicketWinnerProfileUpdateInput = {};

  if (input.caption !== undefined) {
    const normalizedCaption = input.caption?.trim() ? input.caption.trim() : null;
    data.caption = normalizedCaption;
  }

  if (input.featured !== undefined) {
    data.featured = input.featured;
  }

  if (input.winnerPhotoApproved !== undefined) {
    data.winnerPhotoApproved = input.winnerPhotoApproved;
  }

  if (input.publishedAt !== undefined) {
    data.publishedAt = input.publishedAt;
  } else if (input.unpublished !== undefined) {
    data.publishedAt = input.unpublished ? null : existing.publishedAt ?? new Date();
  }

  if (Object.keys(data).length === 0) {
    return buildAdminGoldenTicketWinnerListItem(existing);
  }

  const updated = await prisma.goldenTicketWinnerProfile.update({
    where: { id },
    data,
    select: adminGoldenTicketWinnerSelect,
  });

  return buildAdminGoldenTicketWinnerListItem(updated);
}
