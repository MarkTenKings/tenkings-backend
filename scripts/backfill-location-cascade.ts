import { PrismaClient } from "@prisma/client";

type CliOptions = {
  apply: boolean;
  help: boolean;
  limit: number | null;
  cardIds: string[];
};

type TargetRecord = {
  targetLocationId: string;
};

const prisma = new PrismaClient();

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    help: false,
    limit: null,
    cardIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[index + 1];
      const parsed = raw ? Number(raw) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--limit requires a positive integer");
      }
      options.limit = parsed;
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--limit requires a positive integer");
      }
      options.limit = parsed;
      continue;
    }
    if (arg === "--card-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--card-id requires a value");
      }
      options.cardIds.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--card-id=")) {
      const value = arg.slice("--card-id=".length).trim();
      if (!value) {
        throw new Error("--card-id requires a value");
      }
      options.cardIds.push(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsage() {
  console.log(`Usage:
  TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' pnpm --filter @tenkings/kiosk-agent exec ts-node --skip-project --transpile-only scripts/backfill-location-cascade.ts [--apply] [--limit 100] [--card-id <uuid>]

Default mode is dry-run. The script reports how many assigned inventory records have location drift versus their assigned batch and only writes when --apply is supplied.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const assignedCards = await prisma.cardAsset.findMany({
    where: {
      inventoryBatchId: { not: null },
      ...(options.cardIds.length > 0 ? { id: { in: options.cardIds } } : {}),
    },
    orderBy: [{ inventoryAssignedAt: "asc" }, { id: "asc" }],
    ...(options.limit ? { take: options.limit } : {}),
    select: {
      id: true,
      inventoryBatch: {
        select: {
          id: true,
          locationId: true,
        },
      },
    },
  });

  const cardIds = assignedCards.map((card) => card.id);
  const items = cardIds.length
    ? await prisma.item.findMany({
        where: { number: { in: cardIds } },
        select: {
          id: true,
          number: true,
          locationId: true,
          cardQrCodeId: true,
        },
      })
    : [];

  const itemIds = items.map((item) => item.id);
  const cardQrCodeIds = items.flatMap((item) => (item.cardQrCodeId ? [item.cardQrCodeId] : []));
  const labels =
    itemIds.length > 0 || cardQrCodeIds.length > 0
      ? await prisma.packLabel.findMany({
          where: {
            OR: [
              ...(itemIds.length > 0 ? [{ itemId: { in: itemIds } }] : []),
              ...(cardQrCodeIds.length > 0 ? [{ cardQrCodeId: { in: cardQrCodeIds } }] : []),
            ],
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            itemId: true,
            locationId: true,
            cardQrCodeId: true,
            packQrCodeId: true,
            cardQrCode: {
              select: {
                id: true,
                locationId: true,
              },
            },
            packQrCode: {
              select: {
                id: true,
                locationId: true,
              },
            },
          },
        })
      : [];
  const directCardQrs = cardQrCodeIds.length
    ? await prisma.qrCode.findMany({
        where: { id: { in: cardQrCodeIds } },
        select: {
          id: true,
          locationId: true,
        },
      })
    : [];

  const itemsByCardId = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.number;
    if (!key) {
      continue;
    }
    const bucket = itemsByCardId.get(key) ?? [];
    bucket.push(item);
    itemsByCardId.set(key, bucket);
  }

  const labelsByItemId = new Map<string, (typeof labels)[number]>();
  const labelsByCardQrCodeId = new Map<string, (typeof labels)[number]>();
  const cardQrById = new Map(directCardQrs.map((record) => [record.id, record] as const));
  for (const label of labels) {
    if (label.itemId && !labelsByItemId.has(label.itemId)) {
      labelsByItemId.set(label.itemId, label);
    }
    if (!labelsByCardQrCodeId.has(label.cardQrCodeId)) {
      labelsByCardQrCodeId.set(label.cardQrCodeId, label);
    }
  }

  const itemTargets = new Map<string, TargetRecord>();
  const labelTargets = new Map<string, TargetRecord>();
  const qrTargets = new Map<string, TargetRecord>();

  let cardsWithLinkedItems = 0;
  let cardsWithLocationDrift = 0;
  let itemsWithLocationDrift = 0;
  let labelsWithLocationDrift = 0;
  let cardQrsWithLocationDrift = 0;
  let packQrsWithLocationDrift = 0;

  for (const card of assignedCards) {
    const targetLocationId = card.inventoryBatch?.locationId ?? null;
    if (!targetLocationId) {
      continue;
    }

    const linkedItems = itemsByCardId.get(card.id) ?? [];
    if (linkedItems.length === 0) {
      continue;
    }

    cardsWithLinkedItems += 1;
    let cardHasLocationDrift = false;

    for (const item of linkedItems) {
      itemTargets.set(item.id, { targetLocationId });
      if (item.locationId !== targetLocationId) {
        itemsWithLocationDrift += 1;
        cardHasLocationDrift = true;
      }

      const label =
        labelsByItemId.get(item.id) ??
        (item.cardQrCodeId ? labelsByCardQrCodeId.get(item.cardQrCodeId) : undefined);

      if (!label) {
        if (item.cardQrCodeId) {
          qrTargets.set(item.cardQrCodeId, { targetLocationId });
          if (cardQrById.get(item.cardQrCodeId)?.locationId !== targetLocationId) {
            cardQrsWithLocationDrift += 1;
            cardHasLocationDrift = true;
          }
        }
        continue;
      }

      labelTargets.set(label.id, { targetLocationId });
      qrTargets.set(label.cardQrCodeId, { targetLocationId });
      qrTargets.set(label.packQrCodeId, { targetLocationId });

      if (label.locationId !== targetLocationId) {
        labelsWithLocationDrift += 1;
        cardHasLocationDrift = true;
      }
      if (label.cardQrCode.locationId !== targetLocationId) {
        cardQrsWithLocationDrift += 1;
        cardHasLocationDrift = true;
      }
      if (label.packQrCode.locationId !== targetLocationId) {
        packQrsWithLocationDrift += 1;
        cardHasLocationDrift = true;
      }
    }

    if (cardHasLocationDrift) {
      cardsWithLocationDrift += 1;
    }
  }

  const summary = {
    mode: options.apply ? "apply" : "dry-run",
    assignedCards: assignedCards.length,
    cardsWithLinkedItems,
    cardsWithLocationDrift,
    itemsMatched: itemTargets.size,
    labelsMatched: labelTargets.size,
    qrCodesMatched: qrTargets.size,
    locationDriftCounts: {
      items: itemsWithLocationDrift,
      packLabels: labelsWithLocationDrift,
      cardQrCodes: cardQrsWithLocationDrift,
      packQrCodes: packQrsWithLocationDrift,
    },
    filters: {
      limit: options.limit,
      cardIds: options.cardIds,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!options.apply) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const [itemId, target] of itemTargets) {
      await tx.item.update({
        where: { id: itemId },
        data: {
          location: { connect: { id: target.targetLocationId } },
        },
      });
    }

    for (const [labelId, target] of labelTargets) {
      await tx.packLabel.update({
        where: { id: labelId },
        data: {
          locationId: target.targetLocationId,
        },
      });
    }

    for (const [qrId, target] of qrTargets) {
      await tx.qrCode.update({
        where: { id: qrId },
        data: {
          location: { connect: { id: target.targetLocationId } },
        },
      });
    }
  });

  console.log(
    JSON.stringify(
      {
        applied: true,
        itemUpdates: itemTargets.size,
        packLabelUpdates: labelTargets.size,
        qrCodeUpdates: qrTargets.size,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
