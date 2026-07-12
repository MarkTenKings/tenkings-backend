import { prisma, type Prisma } from "@tenkings/database";
import { parseClassificationPayload } from "@tenkings/shared";
import { ensureLabelPairForItemTx } from "./qrCodes";

export const PRICE_REQUIRED_MESSAGE =
  "Price valuation field must be complete before moving a card to inventory ready.";
export const AI_GRADER_ITEM_OWNER_USER_ID_ENV = "OPERATOR_USER_ID";

type EnvLike = Record<string, string | undefined>;
type AiGraderItemOwner = { id: string };

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

export const resolveAiGraderItemOwner = async (
  db: Pick<Prisma.TransactionClient, "user">,
  env: EnvLike = process.env
): Promise<AiGraderItemOwner> => {
  const inventoryOwnerUserId = env[AI_GRADER_ITEM_OWNER_USER_ID_ENV]?.trim();

  if (!inventoryOwnerUserId) {
    throw new Error("OPERATOR_USER_ID must be configured for AI Grader item ownership.");
  }

  const inventoryOwner = await db.user.findUnique({ where: { id: inventoryOwnerUserId }, select: { id: true } });
  if (!inventoryOwner) {
    throw new Error("Configured OPERATOR_USER_ID user was not found.");
  }

  return inventoryOwner;
};

export const ensureCardItemOwnershipTx = async (
  db: Prisma.TransactionClient,
  cardId: string,
  options: { env?: EnvLike; owner?: AiGraderItemOwner; expectedItemId?: string } = {}
) => {
  const owner = options.owner ?? (await resolveAiGraderItemOwner(db, options.env ?? process.env));
  const card = await db.cardAsset.findUnique({
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

  let item = options.expectedItemId
    ? await db.item.findUnique({ where: { id: options.expectedItemId } })
    : await db.item.findFirst({ where: { number: card.id } });
  if (options.expectedItemId && !item) {
    throw new Error("The linked Item could not be resolved for the confirmed CardAsset.");
  }
  if (item && item.number !== card.id) {
    throw new Error("The linked Item does not match the confirmed CardAsset identity.");
  }
  if (!item) {
    const name = resolveItemName(card);
    const set = resolveItemSet(card);
    const detailsJson =
      (card.classificationJson as Prisma.InputJsonValue | null) ??
      (card.ocrJson as Prisma.InputJsonValue | null) ??
      undefined;

    item = await db.item.create({
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
      item = await db.item.update({
        where: { id: item.id },
        data: updates,
      });
    }
  }

  const existingOwnership = await db.itemOwnership.findFirst({
    where: {
      itemId: item.id,
      ownerId: owner.id,
    },
    select: { id: true },
  });
  if (!existingOwnership) {
    await db.itemOwnership.create({
      data: {
        itemId: item.id,
        ownerId: owner.id,
        note: `Linked from confirmed AI Grader card asset ${card.id}`,
      },
    });
  }

  return {
    cardAssetId: card.id,
    itemId: item.id,
  };
};

export const ensureInventoryReadyArtifactsTx = async (
  db: Prisma.TransactionClient,
  cardId: string,
  createdById: string,
  options: { env?: EnvLike; owner?: AiGraderItemOwner; expectedItemId?: string } = {}
) => {
  const linkage = await ensureCardItemOwnershipTx(db, cardId, options);

  const labelPair = await ensureLabelPairForItemTx(db, {
    itemId: linkage.itemId,
    createdById,
    locationId: null,
  });

  return {
    ...linkage,
    labelPair,
  };
};

export const ensureInventoryReadyArtifacts = async (cardId: string, createdById: string) =>
  prisma.$transaction((tx) => ensureInventoryReadyArtifactsTx(tx, cardId, createdById));
