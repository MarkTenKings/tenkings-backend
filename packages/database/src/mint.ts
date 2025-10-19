import { prisma as defaultPrisma } from "./client";
import type { Prisma, PrismaClient } from "@prisma/client";

type Nullable<T> = T | null | undefined;

interface MintOptions {
  packDefinitionId: string;
  cardIds?: string[];
  sellerEmail?: string | null;
  prismaClient?: PrismaClient;
}

export interface MintResult {
  mintedItems: number;
  createdPacks: number;
  skippedCards: number;
}

const DEFAULT_SELLER_EMAIL =
  process.env.PACK_INVENTORY_SELLER_EMAIL ??
  process.env.HOUSE_USER_EMAIL ??
  "pack-seller@example.com";

const toSentence = (value: Nullable<string>) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\s+/g, " ");
};

type CardRecord = Prisma.CardAssetGetPayload<{}>;

const resolveCardName = (card: CardRecord) => {
  const classification = (card.classificationJson as Record<string, unknown> | null) ?? null;

  const nameParts: string[] = [];
  const year = typeof classification?.year === "string" ? classification.year.trim() : "";
  const brand = typeof classification?.brand === "string" ? classification.brand.trim() : "";
  const player = typeof classification?.playerName === "string" ? classification.playerName.trim() : "";

  if (year) nameParts.push(year);
  if (brand) nameParts.push(brand);
  if (player) nameParts.push(player);

  const firstLine = typeof card.ocrText === "string" ? card.ocrText.split(/\n+/)[0]?.slice(0, 140) ?? null : null;

  return toSentence(card.customTitle) ||
    (nameParts.length ? nameParts.join(" ") : null) ||
    toSentence(firstLine) ||
    `Card ${card.id}`;
};

const resolveSetName = (card: CardRecord) => {
  const classification = (card.classificationJson as Record<string, unknown> | null) ?? null;

  const setName = typeof classification?.setName === "string" ? classification.setName.trim() : "";
  if (setName) {
    return setName;
  }

  const brand = typeof classification?.brand === "string" ? classification.brand.trim() : "";
  if (brand) {
    return brand;
  }

  return "Uncategorized";
};

const resolveFoil = (card: CardRecord) => {
  const classification = (card.classificationJson as Record<string, unknown> | null) ?? null;
  const variants = Array.isArray(classification?.variantKeywords)
    ? classification.variantKeywords
    : [];
  return variants.some((entry) => typeof entry === "string" && /foil/i.test(entry));
};

export async function mintAssignedCardAssets({
  packDefinitionId,
  cardIds,
  sellerEmail = DEFAULT_SELLER_EMAIL,
  prismaClient,
}: MintOptions): Promise<MintResult> {
  const db = prismaClient ?? defaultPrisma;

  const email = sellerEmail ?? DEFAULT_SELLER_EMAIL;

  const seller = await db.user.findUnique({ where: { email } });
  if (!seller) {
    throw new Error(`Seller account with email ${email} not found`);
  }

  const cards = await db.cardAsset.findMany({
    where: {
      assignedDefinitionId: packDefinitionId,
      ...(cardIds ? { id: { in: cardIds } } : {}),
    },
    orderBy: [{ assignedAt: "asc" }, { createdAt: "asc" }],
  });

  if (!cards.length) {
    return { mintedItems: 0, createdPacks: 0, skippedCards: 0 };
  }

  let mintedItems = 0;
  let createdPacks = 0;
  let skippedCards = 0;

  for (const card of cards) {
    const result = await db.$transaction(async (tx) => {
      let item = await tx.item.findFirst({ where: { number: card.id } });
      let itemCreated = false;

      if (!item) {
        const name = resolveCardName(card);
        const set = resolveSetName(card);
        const foil = resolveFoil(card);

        item = await tx.item.create({
          data: {
            name,
            set,
            number: card.id,
            language: null,
            foil,
            estimatedValue: card.valuationMinor ?? null,
            ownerId: seller.id,
          },
        });
        itemCreated = true;

        const ownershipExists = await tx.itemOwnership.findFirst({
          where: { itemId: item.id, ownerId: seller.id },
        });
        if (!ownershipExists) {
          await tx.itemOwnership.create({
            data: {
              itemId: item.id,
              ownerId: seller.id,
              note: `Minted from card asset ${card.id}`,
            },
          });
        }
      }

      const existingSlot = await tx.packSlot.findFirst({
        where: {
          itemId: item.id,
          packInstance: { packDefinitionId },
        },
        select: { id: true },
      });

      if (existingSlot) {
        return { minted: itemCreated ? 1 : 0, packed: false };
      }

      await tx.packInstance.create({
        data: {
          packDefinitionId,
          slots: { create: [{ itemId: item.id }] },
        },
      });

      await tx.packDefinition.update({
        where: { id: packDefinitionId },
        data: { inventoryCount: { increment: 1 } },
      });

      return { minted: itemCreated ? 1 : 0, packed: true };
    });

    mintedItems += result.minted;
    if (result.packed) {
      createdPacks += 1;
    } else {
      skippedCards += 1;
    }
  }

  return { mintedItems, createdPacks, skippedCards };
}
