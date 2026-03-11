import { prisma, type Prisma, QrCodeType } from "@tenkings/database";

type DbClient = Prisma.TransactionClient | typeof prisma;

const CARD_MINT_NOTE_PREFIX = "Minted from card asset ";

export type InventoryArtifactItem = {
  id: string;
  number: string | null;
  cardQrCodeId: string | null;
};

export type InventoryArtifactOwnership = {
  id: string;
  itemId: string;
  ownerId: string;
  note: string | null;
};

export type InventoryArtifactPackLabel = {
  id: string;
  pairId: string;
  itemId: string | null;
  cardQrCodeId: string;
  packQrCodeId: string;
};

export type InventoryArtifactQrCode = {
  id: string;
  code: string;
  serial: string | null;
  type: QrCodeType;
};

export type InventoryArtifactsReport = {
  cardIds: string[];
  items: InventoryArtifactItem[];
  itemOwnerships: InventoryArtifactOwnership[];
  packLabels: InventoryArtifactPackLabel[];
  qrCodes: InventoryArtifactQrCode[];
};

export type InventoryArtifactDeleteCounts = {
  cardIds: string[];
  itemCount: number;
  itemOwnershipCount: number;
  packLabelCount: number;
  qrCodeCount: number;
  deletedItems: number;
  deletedItemOwnerships: number;
  deletedPackLabels: number;
  deletedQrCodes: number;
};

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function emptyReport(cardIds: string[] = []): InventoryArtifactsReport {
  return {
    cardIds,
    items: [],
    itemOwnerships: [],
    packLabels: [],
    qrCodes: [],
  };
}

async function collectArtifactsForItems(
  db: DbClient,
  items: InventoryArtifactItem[],
  cardIds: string[]
): Promise<InventoryArtifactsReport> {
  if (items.length === 0) {
    return emptyReport(cardIds);
  }

  const itemIds = uniqueStrings(items.map((item) => item.id));
  const cardQrCodeIds = uniqueStrings(items.map((item) => item.cardQrCodeId));

  const itemOwnerships: InventoryArtifactOwnership[] = itemIds.length
    ? await db.itemOwnership.findMany({
        where: { itemId: { in: itemIds } },
        select: { id: true, itemId: true, ownerId: true, note: true },
        orderBy: [{ itemId: "asc" }, { acquiredAt: "asc" }],
      })
    : [];

  const packLabelWhere: Prisma.PackLabelWhereInput | undefined =
    itemIds.length > 0 || cardQrCodeIds.length > 0
      ? {
          OR: [
            ...(itemIds.length > 0 ? [{ itemId: { in: itemIds } }] : []),
            ...(cardQrCodeIds.length > 0 ? [{ cardQrCodeId: { in: cardQrCodeIds } }] : []),
          ],
        }
      : undefined;

  const packLabels: InventoryArtifactPackLabel[] =
    packLabelWhere == null
      ? []
      : await db.packLabel.findMany({
          where: packLabelWhere,
          select: {
            id: true,
            pairId: true,
            itemId: true,
            cardQrCodeId: true,
            packQrCodeId: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });

  const qrCodeIds = uniqueStrings([
    ...cardQrCodeIds,
    ...packLabels.map((label) => label.cardQrCodeId),
    ...packLabels.map((label) => label.packQrCodeId),
  ]);

  const qrCodes: InventoryArtifactQrCode[] = qrCodeIds.length
    ? await db.qrCode.findMany({
        where: { id: { in: qrCodeIds } },
        select: { id: true, code: true, serial: true, type: true },
        orderBy: [{ type: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      })
    : [];

  return {
    cardIds,
    items,
    itemOwnerships,
    packLabels,
    qrCodes,
  };
}

export async function collectInventoryArtifactsForCardIds(
  db: DbClient,
  cardIds: string[]
): Promise<InventoryArtifactsReport> {
  const normalizedCardIds = uniqueStrings(cardIds);
  if (normalizedCardIds.length === 0) {
    return emptyReport();
  }

  const items: InventoryArtifactItem[] = await db.item.findMany({
    where: { number: { in: normalizedCardIds } },
    select: {
      id: true,
      number: true,
      cardQrCodeId: true,
    },
    orderBy: [{ number: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  return collectArtifactsForItems(db, items, normalizedCardIds);
}

async function deleteInventoryArtifactsFromReport(
  db: DbClient,
  report: InventoryArtifactsReport
): Promise<InventoryArtifactDeleteCounts> {
  const packLabelIds = uniqueStrings(report.packLabels.map((label) => label.id));
  const qrCodeIds = uniqueStrings(report.qrCodes.map((qrCode) => qrCode.id));
  const itemOwnershipIds = uniqueStrings(report.itemOwnerships.map((ownership) => ownership.id));
  const itemIds = uniqueStrings(report.items.map((item) => item.id));

  const deletedItemOwnerships = itemOwnershipIds.length
    ? (
        await db.itemOwnership.deleteMany({
          where: { id: { in: itemOwnershipIds } },
        })
      ).count
    : 0;

  const deletedPackLabels = packLabelIds.length
    ? (
        await db.packLabel.deleteMany({
          where: { id: { in: packLabelIds } },
        })
      ).count
    : 0;

  const deletedItems = itemIds.length
    ? (
        await db.item.deleteMany({
          where: { id: { in: itemIds } },
        })
      ).count
    : 0;

  const deletedQrCodes = qrCodeIds.length
    ? (
        await db.qrCode.deleteMany({
          where: { id: { in: qrCodeIds } },
        })
      ).count
    : 0;

  return {
    cardIds: report.cardIds,
    itemCount: itemIds.length,
    itemOwnershipCount: itemOwnershipIds.length,
    packLabelCount: packLabelIds.length,
    qrCodeCount: qrCodeIds.length,
    deletedItems,
    deletedItemOwnerships,
    deletedPackLabels,
    deletedQrCodes,
  };
}

export async function deleteInventoryArtifactsForCardIds(
  db: DbClient,
  cardIds: string[]
): Promise<InventoryArtifactDeleteCounts> {
  const report = await collectInventoryArtifactsForCardIds(db, cardIds);
  return deleteInventoryArtifactsFromReport(db, report);
}

export async function collectOrphanedInventoryArtifacts(
  db: DbClient
): Promise<InventoryArtifactsReport> {
  const candidateItems: InventoryArtifactItem[] = await db.item.findMany({
    where: {
      number: { not: null },
      OR: [
        { cardQrCodeId: { not: null } },
        { packLabels: { some: {} } },
        { ownerships: { some: { note: { startsWith: CARD_MINT_NOTE_PREFIX } } } },
      ],
    },
    select: {
      id: true,
      number: true,
      cardQrCodeId: true,
    },
    orderBy: [{ number: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  if (candidateItems.length === 0) {
    return emptyReport();
  }

  const candidateCardIds = uniqueStrings(candidateItems.map((item) => item.number));
  const existingCardIds = new Set(
    (
      await db.cardAsset.findMany({
        where: { id: { in: candidateCardIds } },
        select: { id: true },
      })
    ).map((card: { id: string }) => card.id)
  );

  const orphanItems = candidateItems.filter(
    (item: InventoryArtifactItem) => item.number != null && !existingCardIds.has(item.number)
  );
  const orphanCardIds = uniqueStrings(orphanItems.map((item: InventoryArtifactItem) => item.number));

  return collectArtifactsForItems(db, orphanItems, orphanCardIds);
}

export async function deleteOrphanedInventoryArtifacts(
  db: DbClient
): Promise<InventoryArtifactDeleteCounts> {
  const report = await collectOrphanedInventoryArtifacts(db);
  return deleteInventoryArtifactsFromReport(db, report);
}
