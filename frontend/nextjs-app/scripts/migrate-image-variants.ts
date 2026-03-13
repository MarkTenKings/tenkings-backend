import { PrismaClient } from "@prisma/client";
import { generateAndUploadVariants } from "../lib/server/imageVariants";
import { readStorageBuffer } from "../lib/server/storage";

type CliOptions = {
  batchSize: number;
  dryRun: boolean;
  skipPhotos: boolean;
  skipItems: boolean;
  help: boolean;
};

type SectionStats = {
  total: number;
  processed: number;
  failed: number;
  skipped: number;
};

type CardAssetSource = {
  id: string;
  storageKey: string;
  imageUrl: string;
  cdnHdUrl: string | null;
  cdnThumbUrl: string | null;
};

type MigrationSummary = {
  assets: SectionStats;
  photos: SectionStats;
  items: SectionStats;
};

const prisma = new PrismaClient();
const BATCH_DELAY_MS = 500;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    batchSize: 25,
    dryRun: false,
    skipPhotos: false,
    skipItems: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--") {
      continue;
    }
    if (arg === "--skip-photos") {
      options.skipPhotos = true;
      continue;
    }
    if (arg === "--skip-items") {
      options.skipItems = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--batch-size") {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--batch-size requires a positive integer");
      }
      options.batchSize = parsed;
      index += 1;
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      const parsed = Number(arg.slice("--batch-size=".length));
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--batch-size requires a positive integer");
      }
      options.batchSize = parsed;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsage() {
  console.log(`Backfill CDN image variants for existing CardAsset, CardPhoto, and Item records.

Usage:
  ts-node --project tsconfig.scripts.json scripts/migrate-image-variants.ts [options]

Options:
  --dry-run         Log what would be updated without writing database rows or uploading variants
  --batch-size=N    Process N records per batch (default: 25)
  --skip-photos     Skip CardPhoto migration
  --skip-items      Skip Item migration
  --help, -h        Show this help output`);
}

function createStats(total: number): SectionStats {
  return {
    total,
    processed: 0,
    failed: 0,
    skipped: 0,
  };
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) {
    const commaIndex = url.indexOf(",");
    if (commaIndex === -1) {
      throw new Error("Invalid data URL");
    }
    return Buffer.from(url.slice(commaIndex + 1), "base64");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function loadImageBuffer(storageKey: string | null | undefined, imageUrl: string | null | undefined) {
  const resolvedUrl = typeof imageUrl === "string" ? imageUrl.trim() : "";
  if (!resolvedUrl) {
    throw new Error("imageUrl is required");
  }

  if (resolvedUrl.startsWith("data:")) {
    return fetchImageBuffer(resolvedUrl);
  }

  if (storageKey) {
    try {
      return await readStorageBuffer(storageKey);
    } catch (error) {
      console.warn(`[WARN] Failed to read storage key ${storageKey}; falling back to URL fetch: ${formatError(error)}`);
    }
  }

  return fetchImageBuffer(resolvedUrl);
}

async function ensureCardAssetVariants(
  asset: CardAssetSource,
  dryRun: boolean
): Promise<{ hdUrl: string; thumbUrl: string; hdSize?: number; thumbSize?: number } | null> {
  if (asset.cdnHdUrl && asset.cdnThumbUrl) {
    return {
      hdUrl: asset.cdnHdUrl,
      thumbUrl: asset.cdnThumbUrl,
    };
  }

  if (dryRun) {
    return {
      hdUrl: `[DRY RUN] cards/${asset.id}/hd.webp`,
      thumbUrl: `[DRY RUN] cards/${asset.id}/thumb.webp`,
    };
  }

  const buffer = await loadImageBuffer(asset.storageKey, asset.imageUrl);
  const variants = await generateAndUploadVariants(buffer, `cards/${asset.id}`);

  await prisma.cardAsset.update({
    where: { id: asset.id },
    data: {
      cdnHdUrl: variants.hdUrl,
      cdnThumbUrl: variants.thumbUrl,
    },
  });

  asset.cdnHdUrl = variants.hdUrl;
  asset.cdnThumbUrl = variants.thumbUrl;

  return variants;
}

async function migrateCardAssets(options: CliOptions): Promise<SectionStats> {
  console.log("\n=== Migrating CardAsset records ===\n");

  const total = await prisma.cardAsset.count({
    where: { cdnHdUrl: null },
  });
  const stats = createStats(total);

  console.log(`Found ${total} CardAsset records to migrate`);

  let cursor: string | undefined;

  while (true) {
    const batch = await prisma.cardAsset.findMany({
      where: { cdnHdUrl: null },
      select: { id: true, storageKey: true, imageUrl: true },
      take: options.batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });

    if (batch.length === 0) {
      break;
    }
    cursor = batch[batch.length - 1].id;

    for (const asset of batch) {
      try {
        if (options.dryRun) {
          stats.processed += 1;
          console.log(`[DRY RUN] Would migrate CardAsset ${asset.id}`);
          continue;
        }

        const buffer = await loadImageBuffer(asset.storageKey, asset.imageUrl);
        const variants = await generateAndUploadVariants(buffer, `cards/${asset.id}`);

        await prisma.cardAsset.update({
          where: { id: asset.id },
          data: {
            cdnHdUrl: variants.hdUrl,
            cdnThumbUrl: variants.thumbUrl,
          },
        });

        stats.processed += 1;
        console.log(
          `[${stats.processed}/${total}] Migrated CardAsset ${asset.id} (HD: ${variants.hdSize}B, Thumb: ${variants.thumbSize}B)`
        );
      } catch (error) {
        stats.failed += 1;
        console.error(`[FAIL] CardAsset ${asset.id}: ${formatError(error)}`);
      }
    }

    await pause(BATCH_DELAY_MS);
  }

  console.log(
    `\nCardAsset migration complete: ${stats.processed} processed, ${stats.failed} failed, ${stats.skipped} skipped out of ${total} total`
  );

  return stats;
}

async function migrateCardPhotos(options: CliOptions): Promise<SectionStats> {
  if (options.skipPhotos) {
    console.log("\nSkipping CardPhoto migration (--skip-photos)");
    return createStats(0);
  }

  console.log("\n=== Migrating CardPhoto records ===\n");

  const total = await prisma.cardPhoto.count({
    where: { cdnHdUrl: null },
  });
  const stats = createStats(total);

  console.log(`Found ${total} CardPhoto records to migrate`);

  let cursor: string | undefined;

  while (true) {
    const batch = await prisma.cardPhoto.findMany({
      where: { cdnHdUrl: null },
      select: { id: true, cardAssetId: true, storageKey: true, imageUrl: true },
      take: options.batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });

    if (batch.length === 0) {
      break;
    }
    cursor = batch[batch.length - 1].id;

    for (const photo of batch) {
      try {
        if (options.dryRun) {
          stats.processed += 1;
          console.log(`[DRY RUN] Would migrate CardPhoto ${photo.id}`);
          continue;
        }

        const buffer = await loadImageBuffer(photo.storageKey, photo.imageUrl);
        const variants = await generateAndUploadVariants(buffer, `cards/${photo.cardAssetId}/photos/${photo.id}`);

        await prisma.cardPhoto.update({
          where: { id: photo.id },
          data: {
            cdnHdUrl: variants.hdUrl,
            cdnThumbUrl: variants.thumbUrl,
          },
        });

        stats.processed += 1;
        console.log(
          `[${stats.processed}/${total}] Migrated CardPhoto ${photo.id} (HD: ${variants.hdSize}B, Thumb: ${variants.thumbSize}B)`
        );
      } catch (error) {
        stats.failed += 1;
        console.error(`[FAIL] CardPhoto ${photo.id}: ${formatError(error)}`);
      }
    }

    await pause(BATCH_DELAY_MS);
  }

  console.log(
    `\nCardPhoto migration complete: ${stats.processed} processed, ${stats.failed} failed, ${stats.skipped} skipped out of ${total} total`
  );

  return stats;
}

async function migrateItems(options: CliOptions): Promise<SectionStats> {
  if (options.skipItems) {
    console.log("\nSkipping Item migration (--skip-items)");
    return createStats(0);
  }

  console.log("\n=== Migrating Item records ===\n");

  const total = await prisma.item.count({
    where: { cdnHdUrl: null },
  });
  const stats = createStats(total);

  console.log(`Found ${total} Item records to evaluate`);

  let cursor: string | undefined;

  while (true) {
    const batch = await prisma.item.findMany({
      where: { cdnHdUrl: null },
      select: { id: true, number: true, imageUrl: true },
      take: options.batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });

    if (batch.length === 0) {
      break;
    }
    cursor = batch[batch.length - 1].id;

    const assetIds = batch
      .map((item) => item.number?.trim() ?? "")
      .filter((value): value is string => Boolean(value));

    const matchedAssets = assetIds.length
      ? await prisma.cardAsset.findMany({
          where: { id: { in: assetIds } },
          select: {
            id: true,
            storageKey: true,
            imageUrl: true,
            cdnHdUrl: true,
            cdnThumbUrl: true,
          },
        })
      : [];
    const matchedAssetsById = new Map(matchedAssets.map((asset) => [asset.id, asset] as const));

    for (const item of batch) {
      try {
        const cardAssetId = item.number?.trim() ?? "";
        const matchedAsset = cardAssetId ? matchedAssetsById.get(cardAssetId) ?? null : null;

        if (matchedAsset) {
          const resolvedVariants = await ensureCardAssetVariants(matchedAsset, options.dryRun);
          if (resolvedVariants) {
            if (options.dryRun) {
              stats.processed += 1;
              console.log(`[DRY RUN] Would update Item ${item.id} from CardAsset ${matchedAsset.id}`);
              continue;
            }

            await prisma.item.update({
              where: { id: item.id },
              data: {
                cdnHdUrl: resolvedVariants.hdUrl,
                cdnThumbUrl: resolvedVariants.thumbUrl,
              },
            });

            stats.processed += 1;
            console.log(`[${stats.processed}/${total}] Updated Item ${item.id} from CardAsset ${matchedAsset.id}`);
            continue;
          }
        }

        if (!item.imageUrl) {
          stats.skipped += 1;
          console.warn(`[SKIP] Item ${item.id} has no imageUrl and no usable CardAsset match`);
          continue;
        }

        if (options.dryRun) {
          stats.processed += 1;
          console.log(`[DRY RUN] Would generate variants for Item ${item.id} directly`);
          continue;
        }

        const buffer = await loadImageBuffer(null, item.imageUrl);
        const variants = await generateAndUploadVariants(buffer, `items/${item.id}`);

        await prisma.item.update({
          where: { id: item.id },
          data: {
            cdnHdUrl: variants.hdUrl,
            cdnThumbUrl: variants.thumbUrl,
          },
        });

        stats.processed += 1;
        console.log(
          `[${stats.processed}/${total}] Generated Item ${item.id} variants directly (HD: ${variants.hdSize}B, Thumb: ${variants.thumbSize}B)`
        );
      } catch (error) {
        stats.failed += 1;
        console.error(`[FAIL] Item ${item.id}: ${formatError(error)}`);
      }
    }

    await pause(BATCH_DELAY_MS);
  }

  console.log(
    `\nItem migration complete: ${stats.processed} processed, ${stats.failed} failed, ${stats.skipped} skipped out of ${total} total`
  );

  return stats;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  console.log("=== Image Variant Migration ===");
  console.log(`Batch size: ${options.batchSize}`);
  console.log(`Dry run: ${options.dryRun}`);
  console.log(`Skip photos: ${options.skipPhotos}`);
  console.log(`Skip items: ${options.skipItems}`);

  const summary: MigrationSummary = {
    assets: await migrateCardAssets(options),
    photos: await migrateCardPhotos(options),
    items: await migrateItems(options),
  };

  console.log("\n=== Migration Summary ===");
  console.log(
    `Processed: ${summary.assets.processed} CardAssets, ${summary.photos.processed} CardPhotos, ${summary.items.processed} Items`
  );
  console.log(
    `Failures: ${summary.assets.failed} CardAssets, ${summary.photos.failed} CardPhotos, ${summary.items.failed} Items`
  );
  console.log(
    `Skipped: ${summary.assets.skipped} CardAssets, ${summary.photos.skipped} CardPhotos, ${summary.items.skipped} Items`
  );

  const [remainingAssets, remainingPhotos, remainingItems] = await Promise.all([
    prisma.cardAsset.count({ where: { cdnHdUrl: null } }),
    prisma.cardPhoto.count({ where: { cdnHdUrl: null } }),
    prisma.item.count({ where: { cdnHdUrl: null } }),
  ]);

  console.log(
    `Remaining un-migrated: ${remainingAssets} CardAssets, ${remainingPhotos} CardPhotos, ${remainingItems} Items`
  );

  const totalFailures = summary.assets.failed + summary.photos.failed + summary.items.failed;
  if (totalFailures > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Migration failed:", formatError(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
