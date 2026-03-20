import { prisma } from "@tenkings/database";
import { CollectibleCategory, PackTier, Prisma } from "@prisma/client";
import { z } from "zod";
import { PACK_TIER_PRICE_MINOR, type PackTierValue } from "../adminInventory";
import { comparePackTypes, type AdminPackType } from "../adminPackTypes";

const packTypeSelect = {
  id: true,
  name: true,
  description: true,
  category: true,
  tier: true,
  imageUrl: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PackDefinitionSelect;

type PackTypeRecord = Prisma.PackDefinitionGetPayload<{ select: typeof packTypeSelect }>;

export const packTypeUpsertSchema = z.object({
  name: z.string().trim().min(1, "Pack name is required").max(120, "Pack name must be 120 characters or fewer"),
  category: z.nativeEnum(CollectibleCategory),
  tier: z.nativeEnum(PackTier),
  description: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value !== "string") {
        return null;
      }
      const trimmed = value.trim();
      return trimmed ? trimmed.slice(0, 500) : null;
    }),
  isActive: z.boolean().default(true),
});

export function serializePackType(record: PackTypeRecord): AdminPackType {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? null,
    category: record.category,
    tier: record.tier,
    imageUrl: record.imageUrl ?? null,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function listPackTypes() {
  const packTypes = await prisma.packDefinition.findMany({
    select: packTypeSelect,
  });

  return packTypes.map(serializePackType).sort(comparePackTypes);
}

export async function getPackTypeById(id: string) {
  const packType = await prisma.packDefinition.findUnique({
    where: { id },
    select: packTypeSelect,
  });

  return packType ? serializePackType(packType) : null;
}

export async function findPackTypeConflict(category: CollectibleCategory, tier: PackTier, excludeId?: string) {
  return prisma.packDefinition.findFirst({
    where: {
      category,
      tier,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: {
      id: true,
      name: true,
    },
  });
}

export function resolvePackTypePrice(tier: PackTier) {
  return PACK_TIER_PRICE_MINOR[tier as PackTierValue];
}
