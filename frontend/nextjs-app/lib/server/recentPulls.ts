import { prisma, PackStatus } from "@tenkings/database";

export interface RecentPullRecord {
  slotId: string;
  packId: string | null;
  packDefinitionId: string | null;
  packDefinition: {
    id: string;
    name: string;
    category: string | null;
    tier: string | null;
  } | null;
  openedAt: string;
  item: {
    id: string;
    name: string;
    set: string;
    number: string | null;
    language: string | null;
    foil: boolean;
    estimatedValue: number | null;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    detailsJson: unknown;
  };
  owner: {
    id: string;
    displayName: string | null;
    phone: string | null;
    avatarUrl: string | null;
  } | null;
}

const OWNER_SELECTION = {
  select: {
    id: true,
    displayName: true,
    phone: true,
    avatarUrl: true,
  },
} as const;

export async function loadRecentPulls(limit = 12): Promise<RecentPullRecord[]> {
  const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? limit : 12, 1), 48);

  const slots = await prisma.packSlot.findMany({
    where: {
      packInstance: {
        status: PackStatus.OPENED,
        openedAt: { not: null },
      },
    },
    include: {
      item: {
        include: {
          owner: OWNER_SELECTION,
        },
      },
      packInstance: {
        include: {
          owner: OWNER_SELECTION,
          packDefinition: {
            select: {
              id: true,
              name: true,
              category: true,
              tier: true,
            },
          },
        },
      },
    },
    orderBy: [
      {
        packInstance: {
          openedAt: "desc",
        },
      },
      {
        packInstance: {
          createdAt: "desc",
        },
      },
    ],
    take: safeLimit,
  });

  return slots.map((slot) => {
    const pack = slot.packInstance;
    const item = slot.item;
    const packOwner = pack?.owner ?? null;
    const itemOwner = item?.owner ?? null;
    const owner = packOwner ?? itemOwner ?? null;

    const openedAt = pack?.openedAt ?? pack?.createdAt ?? new Date();

    return {
      slotId: slot.id,
      packId: pack?.id ?? null,
      packDefinitionId: pack?.packDefinitionId ?? null,
      packDefinition: pack?.packDefinition
        ? {
            id: pack.packDefinition.id,
            name: pack.packDefinition.name,
            category: pack.packDefinition.category,
            tier: pack.packDefinition.tier,
          }
        : null,
      openedAt: openedAt.toISOString(),
      item: {
        id: item.id,
        name: item.name,
        set: item.set,
        number: item.number,
        language: item.language,
        foil: item.foil,
        estimatedValue: item.estimatedValue,
        imageUrl: item.imageUrl,
        thumbnailUrl: item.thumbnailUrl,
        detailsJson: item.detailsJson,
      },
      owner: owner
        ? {
            id: owner.id,
            displayName: owner.displayName,
            phone: owner.phone,
            avatarUrl: owner.avatarUrl,
          }
        : null,
    };
  });
}
