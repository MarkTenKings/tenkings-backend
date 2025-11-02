import { prisma as defaultPrisma } from "./client";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PackFulfillmentStatus, BatchStage } from "@prisma/client";
import { parseClassificationPayload } from "@tenkings/shared";
import { setBatchStage } from "./batches";

type Nullable<T> = T | null | undefined;

interface MintOptions {
  packDefinitionId: string;
  cardIds?: string[];
  sellerEmail?: string | null;
  prismaClient?: PrismaClient;
  locationId?: string | null;
  fulfillmentStatus?: PackFulfillmentStatus;
  createdById?: string | null;
}

export interface MintResult {
  mintedItems: number;
  createdPacks: number;
  skippedCards: number;
  packAssignments: Array<{
    packInstanceId: string;
    itemId: string;
    cardAssetId: string;
    batchId: string | null;
    locationId: string | null;
  }>;
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

const extractClassification = (card: CardRecord) => {
  const payload = parseClassificationPayload(card.classificationJson);
  return {
    attributes: payload?.attributes ?? null,
    normalized: payload?.normalized ?? null,
  };
};

const resolveCardName = (card: CardRecord) => {
  const { attributes, normalized } = extractClassification(card);

  const customTitle = toSentence(card.customTitle);
  if (customTitle) {
    return customTitle;
  }

  const normalizedDisplay = toSentence(normalized?.displayName ?? undefined);
  if (normalizedDisplay) {
    return normalizedDisplay;
  }

  const nameParts: string[] = [];
  const primaryYear = toSentence(normalized?.year ?? attributes?.year ?? undefined);
  const primaryBrand = toSentence(
    normalized?.company ?? normalized?.setName ?? attributes?.brand ?? attributes?.setName ?? undefined
  );
  const primaryName = toSentence(
    attributes?.playerName ??
      normalized?.sport?.playerName ??
      normalized?.tcg?.cardName ??
      normalized?.comics?.title ??
      undefined
  );

  if (primaryYear) nameParts.push(primaryYear);
  if (primaryBrand) nameParts.push(primaryBrand);
  if (primaryName) nameParts.push(primaryName);

  if (nameParts.length) {
    return nameParts.join(" ");
  }

  const firstLine = typeof card.ocrText === "string" ? card.ocrText.split(/\n+/)[0]?.slice(0, 140) ?? null : null;
  const firstLineSentence = toSentence(firstLine);
  if (firstLineSentence) {
    return firstLineSentence;
  }

  return `Card ${card.id}`;
};

const resolveSetName = (card: CardRecord) => {
  const { attributes, normalized } = extractClassification(card);

  const normalizedSet = toSentence(
    normalized?.setName ?? normalized?.comics?.title ?? normalized?.tcg?.series ?? undefined
  );
  if (normalizedSet) {
    return normalizedSet;
  }

  const attributeSet = toSentence(attributes?.setName ?? undefined);
  if (attributeSet) {
    return attributeSet;
  }

  const brand = toSentence(attributes?.brand ?? normalized?.company ?? undefined);
  if (brand) {
    return brand;
  }

  return "Uncategorized";
};

const resolveFoil = (card: CardRecord) => {
  const { attributes, normalized } = extractClassification(card);

  const normalizedFoil =
    normalized?.sport?.foil ??
    normalized?.tcg?.foil ??
    (typeof normalized?.rarity === "string" && /foil/i.test(normalized.rarity) ? true : null);

  if (normalizedFoil != null) {
    return normalizedFoil;
  }

  const variants: string[] = Array.isArray(attributes?.variantKeywords)
    ? attributes.variantKeywords.filter((value: unknown): value is string => typeof value === "string")
    : [];
  return variants.some((entry) => /foil/i.test(entry));
};

export async function mintAssignedCardAssets({
  packDefinitionId,
  cardIds,
  sellerEmail = DEFAULT_SELLER_EMAIL,
  prismaClient,
  locationId,
  fulfillmentStatus,
  createdById,
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
    return { mintedItems: 0, createdPacks: 0, skippedCards: 0, packAssignments: [] };
  }

  let mintedItems = 0;
  let createdPacks = 0;
  let skippedCards = 0;
  const packAssignments: MintResult["packAssignments"] = [];
  const touchedBatchIds = new Set<string>();

  const resolvedStatus =
    fulfillmentStatus ?? (locationId ? PackFulfillmentStatus.READY_FOR_PACKING : PackFulfillmentStatus.ONLINE);

  for (const card of cards) {
    const result = await db.$transaction(async (tx) => {
      let item = await tx.item.findFirst({ where: { number: card.id } });
      let itemCreated = false;

      if (!item) {
        const name = resolveCardName(card);
        const set = resolveSetName(card);
        const foil = resolveFoil(card);
        const classificationDetails = (card.classificationJson as Prisma.InputJsonValue | null) ?? null;
        const ocrDetails = (card.ocrJson as Prisma.InputJsonValue | null) ?? null;

        item = await tx.item.create({
          data: {
            name,
            set,
            number: card.id,
            language: null,
            foil,
            estimatedValue: card.valuationMinor ?? null,
            ownerId: seller.id,
            imageUrl: card.imageUrl,
            thumbnailUrl: card.thumbnailUrl ?? null,
            detailsJson: classificationDetails ?? ocrDetails ?? undefined,
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
      } else {
        const updates: Prisma.ItemUpdateInput = {};
        if (!item.imageUrl && card.imageUrl) {
          updates.imageUrl = card.imageUrl;
        }
        if (!item.thumbnailUrl && card.thumbnailUrl) {
          updates.thumbnailUrl = card.thumbnailUrl;
        }
        if (!item.detailsJson) {
          const classificationDetails = (card.classificationJson as Prisma.InputJsonValue | null) ?? null;
          const ocrDetails = (card.ocrJson as Prisma.InputJsonValue | null) ?? null;
          const combined = classificationDetails ?? ocrDetails;
          if (combined) {
            updates.detailsJson = combined;
          }
        }
        if (Object.keys(updates).length > 0) {
          item = await tx.item.update({
            where: { id: item.id },
            data: updates,
          });
        }
      }

      touchedBatchIds.add(card.batchId);

      const existingSlot = await tx.packSlot.findFirst({
        where: {
          itemId: item.id,
          packInstance: { packDefinitionId },
        },
        select: { id: true, packInstanceId: true },
      });

      if (existingSlot) {
        if (locationId !== undefined || fulfillmentStatus !== undefined) {
          const data: Prisma.PackInstanceUpdateInput = {};
          if (locationId !== undefined) {
            data.location = locationId ? { connect: { id: locationId } } : { disconnect: true };
          }
          if (fulfillmentStatus !== undefined || locationId) {
            data.fulfillmentStatus = resolvedStatus;
          }
          if (Object.keys(data).length > 0) {
            await tx.packInstance.update({
              where: { id: existingSlot.packInstanceId },
              data,
            });
          }
        }

        const updateData: Prisma.PackInstanceUpdateInput = {};
        if (locationId !== undefined) {
          updateData.location = locationId ? { connect: { id: locationId } } : { disconnect: true };
          updateData.fulfillmentStatus = resolvedStatus;
        } else if (fulfillmentStatus !== undefined) {
          updateData.fulfillmentStatus = resolvedStatus;
        }
        if (card.batchId) {
          updateData.sourceBatch = { connect: { id: card.batchId } };
        }
        if (Object.keys(updateData).length > 0) {
          await tx.packInstance.update({
            where: { id: existingSlot.packInstanceId },
            data: updateData,
          });
        }

        packAssignments.push({
          packInstanceId: existingSlot.packInstanceId,
          itemId: item.id,
          cardAssetId: card.id,
          batchId: card.batchId ?? null,
          locationId: locationId ?? null,
        });

        return { minted: itemCreated ? 1 : 0, packed: false };
      }

      const pack = await tx.packInstance.create({
        data: {
          packDefinitionId,
          fulfillmentStatus: resolvedStatus,
          locationId: locationId ?? undefined,
          sourceBatchId: card.batchId ?? undefined,
          slots: { create: [{ itemId: item.id }] },
        },
      });

      await tx.packDefinition.update({
        where: { id: packDefinitionId },
        data: { inventoryCount: { increment: 1 } },
      });

      packAssignments.push({
        packInstanceId: pack.id,
        itemId: item.id,
        cardAssetId: card.id,
        batchId: card.batchId ?? null,
        locationId: locationId ?? null,
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

  if (touchedBatchIds.size > 0) {
    await db.$transaction(async (tx) => {
      for (const batchId of touchedBatchIds) {
        await setBatchStage(tx, {
          batchId,
          stage: BatchStage.INVENTORY_READY,
          actorId: createdById ?? null,
          note: null,
          force: false,
        });
      }
    });
  }

  return { mintedItems, createdPacks, skippedCards, packAssignments };
}
