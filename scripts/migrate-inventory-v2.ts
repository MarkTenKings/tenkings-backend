import { CollectibleCategory, PrismaClient } from "@prisma/client";
import { parseClassificationPayload } from "@tenkings/shared";

type CategoryAssignment = {
  category: CollectibleCategory;
  subCategory: string | null;
};

type CardMigrationCandidate = {
  id: string;
  fileName: string;
  customTitle: string | null;
  resolvedPlayerName: string | null;
  classificationJson: unknown;
};

type UnmappedSample = {
  id: string;
  fileName: string;
  customTitle: string | null;
  resolvedPlayerName: string | null;
  classificationCategoryType: string | null;
  sportHint: string | null;
  gameHint: string | null;
};

const prisma = new PrismaClient();

const ONLINE_LOCATION_SLUG = "online-collect-tenkings-co";
const ONLINE_LOCATION_NAME = "Online (collect.tenkings.co)";

const SPORT_SUBCATEGORY_MAP = new Map<string, string>([
  ["baseball", "Baseball"],
  ["basketball", "Basketball"],
  ["football", "Football"],
  ["hockey", "Hockey"],
  ["soccer", "Soccer"],
]);

function normalizeText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return normalized || null;
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isPokemonText(value: string | null): boolean {
  return Boolean(value && value.includes("pokemon"));
}

function isOnePieceText(value: string | null): boolean {
  return Boolean(value && (value.includes("one piece") || value.includes("onepiece")));
}

function isComicsText(value: string | null): boolean {
  return Boolean(value && value.includes("comic"));
}

function resolveSportSubCategory(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (!normalized) {
      continue;
    }

    const exact = SPORT_SUBCATEGORY_MAP.get(normalized);
    if (exact) {
      return exact;
    }

    for (const [keyword, label] of SPORT_SUBCATEGORY_MAP.entries()) {
      if (normalized.includes(keyword)) {
        return label;
      }
    }
  }

  return null;
}

function buildTextCandidates(card: CardMigrationCandidate) {
  const payload = parseClassificationPayload(card.classificationJson);
  const normalized = payload?.normalized;
  const attributes = payload?.attributes;

  const candidates = [
    normalized?.sport?.sport,
    normalized?.sport?.subcategory,
    normalized?.tcg?.game,
    normalized?.tcg?.subcategory,
    normalized?.displayName,
    normalized?.setName,
    normalized?.company,
    attributes?.brand,
    attributes?.setName,
    card.customTitle,
    card.resolvedPlayerName,
    card.fileName,
  ];

  return {
    payload,
    normalized,
    candidates: candidates.map((value) => normalizeText(value)).filter((value): value is string => Boolean(value)),
  };
}

function resolveCategoryAssignment(card: CardMigrationCandidate): CategoryAssignment | null {
  const { payload, normalized, candidates } = buildTextCandidates(card);

  if (normalized?.categoryType === "sport") {
    return {
      category: CollectibleCategory.SPORTS,
      subCategory: resolveSportSubCategory([
        normalized.sport?.sport,
        normalized.sport?.subcategory,
        payload?.attributes?.setName,
        card.fileName,
      ]),
    };
  }

  if (normalized?.categoryType === "comics") {
    return { category: CollectibleCategory.COMICS, subCategory: null };
  }

  if (normalized?.categoryType === "tcg") {
    if (candidates.some((candidate) => isOnePieceText(candidate))) {
      return { category: CollectibleCategory.ONE_PIECE, subCategory: null };
    }
    if (candidates.some((candidate) => isPokemonText(candidate))) {
      return { category: CollectibleCategory.POKEMON, subCategory: null };
    }
  }

  const sportSubCategory = resolveSportSubCategory(candidates);
  if (sportSubCategory) {
    return { category: CollectibleCategory.SPORTS, subCategory: sportSubCategory };
  }

  if (candidates.some((candidate) => isOnePieceText(candidate))) {
    return { category: CollectibleCategory.ONE_PIECE, subCategory: null };
  }

  if (candidates.some((candidate) => isPokemonText(candidate))) {
    return { category: CollectibleCategory.POKEMON, subCategory: null };
  }

  if (candidates.some((candidate) => isComicsText(candidate))) {
    return { category: CollectibleCategory.COMICS, subCategory: null };
  }

  return null;
}

function buildUnmappedSample(card: CardMigrationCandidate): UnmappedSample {
  const payload = parseClassificationPayload(card.classificationJson);
  const normalized = payload?.normalized;

  return {
    id: card.id,
    fileName: card.fileName,
    customTitle: card.customTitle,
    resolvedPlayerName: card.resolvedPlayerName,
    classificationCategoryType: normalized?.categoryType ?? null,
    sportHint: normalized?.sport?.sport ?? normalized?.sport?.subcategory ?? null,
    gameHint: normalized?.tcg?.game ?? normalized?.tcg?.subcategory ?? null,
  };
}

async function migrateCardCategories() {
  const cards = await prisma.cardAsset.findMany({
    where: { category: null },
    select: {
      id: true,
      fileName: true,
      customTitle: true,
      resolvedPlayerName: true,
      classificationJson: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${cards.length} card assets without category`);

  const groups = new Map<string, { assignment: CategoryAssignment; ids: string[] }>();
  const unmappedSamples: UnmappedSample[] = [];

  for (const card of cards) {
    const assignment = resolveCategoryAssignment(card);
    if (!assignment) {
      if (unmappedSamples.length < 10) {
        unmappedSamples.push(buildUnmappedSample(card));
      }
      continue;
    }

    const key = `${assignment.category}::${assignment.subCategory ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(card.id);
      continue;
    }

    groups.set(key, {
      assignment,
      ids: [card.id],
    });
  }

  let migratedCount = 0;

  for (const group of groups.values()) {
    let updatedForGroup = 0;
    for (const ids of chunk(group.ids, 250)) {
      const result = await prisma.cardAsset.updateMany({
        where: {
          id: { in: ids },
          category: null,
        },
        data: {
          category: group.assignment.category,
          subCategory: group.assignment.subCategory,
        },
      });
      updatedForGroup += result.count;
    }

    migratedCount += updatedForGroup;
    console.log(
      `✓ Migrated ${updatedForGroup} cards -> category=${group.assignment.category}, subCategory=${group.assignment.subCategory ?? "null"}`
    );
  }

  const unmappedCount = await prisma.cardAsset.count({
    where: { category: null },
  });

  if (unmappedCount > 0) {
    console.warn(`⚠ ${unmappedCount} cards have no category assigned. Manual review needed.`);
    console.warn("Sample unmapped cards:", JSON.stringify(unmappedSamples, null, 2));
  } else {
    console.log("✓ All cards have category assigned");
  }

  return migratedCount;
}

async function seedGlobalPackCalculatorConfig() {
  const existing = await prisma.packCalculatorConfig.findFirst({
    where: { category: null },
    select: { id: true },
  });

  if (existing) {
    console.log("✓ Global PackCalculatorConfig already exists");
    return;
  }

  await prisma.packCalculatorConfig.create({
    data: {
      category: null,
      discountRate: 0.80,
      packCost: 60,
      slabCost: 50,
      laborPackPerCard: 25,
      laborStockPerPack: 15,
      locationRevenueShare: 0.10,
      merchantProcessingFee: 0.06,
      lossRate: 0.04,
      bonusCardsPerPack: 3,
      bonusCardAvgCost: 200,
    },
  });

  console.log("✓ Seeded global PackCalculatorConfig");
}

async function seedGlobalAutoFillProfile() {
  const existing = await prisma.autoFillProfile.findFirst({
    where: { category: null },
    select: { id: true },
  });

  if (existing) {
    console.log("✓ Global AutoFillProfile already exists");
    return;
  }

  await prisma.autoFillProfile.create({
    data: {
      name: "Default",
      category: null,
      hitRate: 0.12,
      solidRate: 0.25,
      standardRate: 0.63,
      hitMultiplierMin: 1.5,
      hitMultiplierMax: 4.0,
      solidRangeMin: 0.6,
      solidRangeMax: 1.0,
      standardRangeMin: 0.3,
      standardRangeMax: 0.6,
      bonusCardsPerPack: 3,
      bonusCardMaxValue: 300,
      isActive: true,
    },
  });

  console.log("✓ Seeded global AutoFillProfile");
}

async function ensureOnlineLocation() {
  const existing = await prisma.location.findFirst({
    where: {
      OR: [
        { slug: ONLINE_LOCATION_SLUG },
        { name: { contains: "Online", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, slug: true },
  });

  if (existing) {
    console.log(`✓ Online location already exists: "${existing.name}" (${existing.slug})`);
    return;
  }

  await prisma.location.create({
    data: {
      slug: ONLINE_LOCATION_SLUG,
      name: ONLINE_LOCATION_NAME,
      description: "System location for online inventory",
      address: "Online",
      recentRips: [],
    },
  });

  console.log(`✓ Created "${ONLINE_LOCATION_NAME}" location`);
}

async function main() {
  console.log("Starting Inventory System v2 migration...");

  await migrateCardCategories();

  const batchCount = await prisma.inventoryBatch.count({
    where: { stage: "ASSIGNED" },
  });
  console.log(`✓ InventoryBatch stage defaults available; ${batchCount} batches currently read as ASSIGNED`);

  await seedGlobalPackCalculatorConfig();
  await seedGlobalAutoFillProfile();
  await ensureOnlineLocation();

  console.log("\n✅ Inventory System v2 migration complete!");
}

main()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
