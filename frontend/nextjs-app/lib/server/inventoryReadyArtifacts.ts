import { prisma, type Prisma } from "@tenkings/database";
import { parseClassificationPayload } from "@tenkings/shared";
import { ensureLabelPairForItem } from "./qrCodes";

export const PRICE_REQUIRED_MESSAGE =
  "Price valuation field must be complete before moving a card to inventory ready.";

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mergeJsonObject(existing: unknown, patch: unknown): Prisma.InputJsonValue | undefined {
  const patchRecord = jsonObject(patch);
  if (Object.keys(patchRecord).length === 0) return undefined;
  return {
    ...jsonObject(existing),
    ...patchRecord,
  } as Prisma.InputJsonValue;
}

const resolveItemName = (card: {
  id: string;
  customTitle: string | null;
  resolvedPlayerName: string | null;
  fileName: string;
  classificationJson: unknown;
}) => {
  if (card.customTitle?.trim()) {
    return card.customTitle.trim();
  }
  const classification = parseClassificationPayload(card.classificationJson);
  if (classification?.normalized?.displayName?.trim()) {
    return classification.normalized.displayName.trim();
  }
  if (card.resolvedPlayerName?.trim()) {
    return card.resolvedPlayerName.trim();
  }
  return card.fileName || `Card ${card.id}`;
};

const resolveItemSet = (card: { classificationJson: unknown }) => {
  const classification = parseClassificationPayload(card.classificationJson);
  return (
    classification?.normalized?.setName?.trim() ??
    classification?.attributes?.setName?.trim() ??
    "Unknown Set"
  );
};

const resolveInventoryReadyOwner = async () => {
  const sellerEmail = process.env.PACK_INVENTORY_SELLER_EMAIL ?? process.env.HOUSE_USER_EMAIL;
  const normalizedSellerEmail = sellerEmail?.trim();

  if (!normalizedSellerEmail) {
    throw new Error("PACK_INVENTORY_SELLER_EMAIL or HOUSE_USER_EMAIL must be configured");
  }

  const sellerUser = await prisma.user.findUnique({ where: { email: normalizedSellerEmail } });
  if (!sellerUser) {
    throw new Error(`House account not found for email: ${normalizedSellerEmail}`);
  }

  return sellerUser;
};

export const ensureInventoryReadyArtifacts = async (cardId: string, createdById: string) => {
  const card = await prisma.cardAsset.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      fileName: true,
      imageUrl: true,
      thumbnailUrl: true,
      cdnHdUrl: true,
      cdnThumbUrl: true,
      customTitle: true,
      resolvedPlayerName: true,
      classificationJson: true,
      ocrJson: true,
      valuationMinor: true,
    },
  });

  if (!card) {
    throw new Error("Card not found");
  }

  const owner = await resolveInventoryReadyOwner();

  let item = await prisma.item.findFirst({ where: { number: card.id } });
  if (!item) {
    const name = resolveItemName(card);
    const set = resolveItemSet(card);
    const detailsJson =
      (card.classificationJson as Prisma.InputJsonValue | null) ??
      (card.ocrJson as Prisma.InputJsonValue | null) ??
      undefined;

    item = await prisma.item.create({
      data: {
        name,
        set,
        number: card.id,
        language: null,
        foil: false,
        estimatedValue: card.valuationMinor ?? null,
        ownerId: owner.id,
        imageUrl: card.imageUrl,
        thumbnailUrl: card.thumbnailUrl ?? null,
        cdnHdUrl: card.cdnHdUrl ?? null,
        cdnThumbUrl: card.cdnThumbUrl ?? null,
        detailsJson,
      },
    });

    await prisma.itemOwnership.create({
      data: {
        itemId: item.id,
        ownerId: owner.id,
        note: `Minted from card asset ${card.id} (Inventory Ready)`,
      },
    });
  } else {
    const updates: Prisma.ItemUpdateInput = {};

    if (!item.imageUrl && card.imageUrl) {
      updates.imageUrl = card.imageUrl;
    }
    if (!item.thumbnailUrl && card.thumbnailUrl) {
      updates.thumbnailUrl = card.thumbnailUrl;
    }
    if (card.cdnHdUrl && item.cdnHdUrl !== card.cdnHdUrl) {
      updates.cdnHdUrl = card.cdnHdUrl;
    }
    if (card.cdnThumbUrl && item.cdnThumbUrl !== card.cdnThumbUrl) {
      updates.cdnThumbUrl = card.cdnThumbUrl;
    }

    const mergedDetails = mergeJsonObject(item.detailsJson, card.classificationJson ?? card.ocrJson);
    if (mergedDetails) {
      updates.detailsJson = mergedDetails;
    }

    if (Object.keys(updates).length > 0) {
      item = await prisma.item.update({
        where: { id: item.id },
        data: updates,
      });
    }
  }

  const labelPair = await ensureLabelPairForItem({
    itemId: item.id,
    createdById,
    locationId: null,
  });

  return {
    cardAssetId: card.id,
    itemId: item.id,
    labelPair,
  };
};
