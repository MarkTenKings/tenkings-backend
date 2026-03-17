import { prisma, type Prisma } from "@tenkings/database";
import { CollectibleCategory, PackFulfillmentStatus } from "@prisma/client";
import { parseClassificationPayload } from "@tenkings/shared";
import {
  COLLECTIBLE_CATEGORY_VALUES,
  DEFAULT_INVENTORY_PAGE_SIZE,
  MAX_INVENTORY_PAGE_SIZE,
  ONLINE_LOCATION_NAME,
  ONLINE_LOCATION_SLUG,
  type AssignedLocationBatchSummary,
  type AssignedLocationDetailResponse,
  type AssignedLocationSummary,
  type InventoryCardSummary,
  type InventoryCardsResponse,
  type InventoryFilterOptionsResponse,
  type InventoryQueryState,
  type InventorySelectionSummary,
  type InventorySortValue,
} from "../adminInventory";

const SPORT_SUBCATEGORY_MAP = new Map<string, string>([
  ["baseball", "Baseball"],
  ["basketball", "Basketball"],
  ["football", "Football"],
  ["hockey", "Hockey"],
  ["soccer", "Soccer"],
]);

const CARD_ASSET_SELECT = {
  id: true,
  fileName: true,
  imageUrl: true,
  thumbnailUrl: true,
  cdnHdUrl: true,
  cdnThumbUrl: true,
  valuationMinor: true,
  classificationJson: true,
  customTitle: true,
  resolvedPlayerName: true,
  resolvedTeamName: true,
  category: true,
  subCategory: true,
  reviewStage: true,
  createdAt: true,
  updatedAt: true,
  inventoryBatchId: true,
  inventoryAssignedAt: true,
  assignedDefinitionId: true,
  photos: {
    orderBy: [{ createdAt: "asc" as const }],
    select: {
      id: true,
      kind: true,
      imageUrl: true,
      thumbnailUrl: true,
      cdnHdUrl: true,
      cdnThumbUrl: true,
      createdAt: true,
    },
  },
  inventoryBatch: {
    select: {
      id: true,
      label: true,
      stage: true,
      category: true,
      tier: true,
      locationId: true,
      location: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },
} satisfies Prisma.CardAssetSelect;

type CardAssetListRow = Prisma.CardAssetGetPayload<{ select: typeof CARD_ASSET_SELECT }>;

type InventoryCardMetadata = {
  playerName: string | null;
  setName: string | null;
  year: string | null;
  brand: string | null;
  cardNumber: string | null;
  parallel: string | null;
  category: string | null;
  subCategory: string | null;
  sport: string | null;
  frontPhotoUrl: string | null;
  searchText: string;
};

type InventoryListScope = {
  locationId?: string;
  batchId?: string | null;
};

type ListInventoryCardsOptions = {
  query: InventoryQueryState;
  scope?: InventoryListScope;
  includeSelection?: boolean;
};

type BatchCardSummary = {
  id: string;
  valuationMinor: number | null;
  inventoryAssignedAt: Date | null;
  category: string | null;
};

const normalizeText = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const normalized = value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return normalized || null;
};

const pickFirstString = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const FRONT_PHOTO_KIND = "FRONT";

function resolvePhotoPreviewUrl(photo: CardAssetListRow["photos"][number] | null | undefined) {
  if (!photo) {
    return null;
  }
  return pickFirstString(photo.cdnThumbUrl, photo.thumbnailUrl, photo.cdnHdUrl, photo.imageUrl);
}

function resolveFrontInventoryPhotoUrl(card: CardAssetListRow) {
  const frontPhoto =
    card.photos.find((photo) => (typeof photo.kind === "string" ? photo.kind.toUpperCase() : photo.kind) === FRONT_PHOTO_KIND) ?? null;
  const fallbackPhoto = frontPhoto ?? card.photos[0] ?? null;

  // KingsReview treats the CardAsset image/CDN fields as the canonical front image, with CardPhoto rows used for supplemental angles.
  return pickFirstString(
    card.cdnThumbUrl,
    card.thumbnailUrl,
    card.cdnHdUrl,
    card.imageUrl,
    resolvePhotoPreviewUrl(frontPhoto),
    resolvePhotoPreviewUrl(fallbackPhoto)
  );
}

const compareStrings = (left: string | null | undefined, right: string | null | undefined) =>
  (left ?? "").localeCompare(right ?? "", "en", { numeric: true, sensitivity: "base" });

const compareNullableNumbers = (left: number | null | undefined, right: number | null | undefined, direction: "asc" | "desc") => {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return 1;
  }
  if (right == null) {
    return -1;
  }
  return direction === "asc" ? left - right : right - left;
};

const getUtcStartOfToday = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const getUtcStartOfWeek = (now = new Date()) => {
  const today = getUtcStartOfToday(now);
  const day = today.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  today.setUTCDate(today.getUTCDate() - diff);
  return today;
};

function resolveSportSubCategory(candidates: Array<string | null | undefined>) {
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

function inferCategory(card: CardAssetListRow): CollectibleCategory | null {
  if (card.category) {
    return card.category;
  }

  const payload = parseClassificationPayload(card.classificationJson);
  const normalized = payload?.normalized;
  const attributes = payload?.attributes;
  const textCandidates = [
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
  ]
    .map((value) => normalizeText(value))
    .filter((value): value is string => Boolean(value));

  if (normalized?.categoryType === "sport") {
    return CollectibleCategory.SPORTS;
  }
  if (normalized?.categoryType === "comics") {
    return CollectibleCategory.COMICS;
  }
  if (normalized?.categoryType === "tcg") {
    if (textCandidates.some((value) => value.includes("one piece") || value.includes("onepiece"))) {
      return CollectibleCategory.ONE_PIECE;
    }
    if (textCandidates.some((value) => value.includes("pokemon"))) {
      return CollectibleCategory.POKEMON;
    }
  }

  if (resolveSportSubCategory(textCandidates)) {
    return CollectibleCategory.SPORTS;
  }
  if (textCandidates.some((value) => value.includes("one piece") || value.includes("onepiece"))) {
    return CollectibleCategory.ONE_PIECE;
  }
  if (textCandidates.some((value) => value.includes("pokemon"))) {
    return CollectibleCategory.POKEMON;
  }
  if (textCandidates.some((value) => value.includes("comic"))) {
    return CollectibleCategory.COMICS;
  }

  return null;
}

function deriveInventoryCardMetadata(card: CardAssetListRow): InventoryCardMetadata {
  const payload = parseClassificationPayload(card.classificationJson);
  const attributes = payload?.attributes;
  const normalized = payload?.normalized;
  const category = inferCategory(card);
  const subCategory =
    card.subCategory ??
    resolveSportSubCategory([
      normalized?.sport?.subcategory,
      normalized?.sport?.sport,
      attributes?.setName,
      normalized?.tcg?.game,
      normalized?.tcg?.subcategory,
      card.customTitle,
      card.fileName,
    ]);
  const playerName = pickFirstString(
    card.resolvedPlayerName,
    normalized?.sport?.playerName,
    normalized?.tcg?.cardName,
    normalized?.comics?.title,
    normalized?.displayName,
    card.customTitle
  );
  const setName = pickFirstString(normalized?.setName, attributes?.setName);
  const year = pickFirstString(normalized?.year, attributes?.year);
  const brand = pickFirstString(normalized?.company, attributes?.brand);
  const cardNumber = pickFirstString(normalized?.cardNumber);
  const parallel = pickFirstString(attributes?.variantKeywords?.[0] ?? null);
  const sport = pickFirstString(normalized?.sport?.sport, normalized?.sport?.subcategory, subCategory);
  const frontPhotoUrl = resolveFrontInventoryPhotoUrl(card);

  const searchText = [
    playerName,
    setName,
    year,
    brand,
    cardNumber,
    parallel,
    sport,
    card.resolvedTeamName,
    card.customTitle,
    card.fileName,
  ]
    .map((value) => normalizeText(value))
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    playerName,
    setName,
    year,
    brand,
    cardNumber,
    parallel,
    category,
    subCategory,
    sport,
    frontPhotoUrl,
    searchText,
  };
}

function toInventoryCardSummary(card: CardAssetListRow): InventoryCardSummary {
  const metadata = deriveInventoryCardMetadata(card);
  return {
    id: card.id,
    playerName: metadata.playerName,
    setName: metadata.setName,
    year: metadata.year,
    brand: metadata.brand,
    cardNumber: metadata.cardNumber,
    parallel: metadata.parallel,
    valuationMinor: card.valuationMinor ?? null,
    category: metadata.category,
    subCategory: metadata.subCategory,
    sport: metadata.sport,
    frontPhotoUrl: metadata.frontPhotoUrl,
    createdAt: card.createdAt.toISOString(),
    inventoryBatch:
      card.inventoryBatch && card.inventoryBatch.location
        ? {
            id: card.inventoryBatch.id,
            label: card.inventoryBatch.label ?? null,
            stage: card.inventoryBatch.stage,
            locationId: card.inventoryBatch.locationId,
            locationName: card.inventoryBatch.location.name,
            category: card.inventoryBatch.category ?? null,
            tier: card.inventoryBatch.tier ?? null,
          }
        : null,
  };
}

function matchesListFilter(value: string | null | undefined, selected: string[]) {
  if (selected.length === 0) {
    return true;
  }
  const normalizedValue = normalizeText(value);
  return selected.some((entry) => normalizeText(entry) === normalizedValue);
}

function matchesParallelFilter(parallel: string | null | undefined, selected: string[]) {
  if (selected.length === 0) {
    return true;
  }
  const normalizedParallel = normalizeText(parallel);
  return selected.some((entry) => {
    const normalizedEntry = normalizeText(entry);
    if (normalizedEntry === "base") {
      return normalizedParallel == null;
    }
    return normalizedEntry === normalizedParallel;
  });
}

function filterCards(rows: CardAssetListRow[], query: InventoryQueryState) {
  const search = normalizeText(query.search);
  return rows.filter((card) => {
    const metadata = deriveInventoryCardMetadata(card);

    if (query.category.length > 0 && (!metadata.category || !query.category.includes(metadata.category))) {
      return false;
    }
    if (!matchesListFilter(metadata.subCategory, query.subCategory)) {
      return false;
    }
    if (!matchesListFilter(metadata.year, query.year)) {
      return false;
    }
    if (!matchesListFilter(metadata.brand, query.brand)) {
      return false;
    }
    if (!matchesParallelFilter(metadata.parallel, query.parallel)) {
      return false;
    }
    if (search && !metadata.searchText.includes(search)) {
      return false;
    }
    return true;
  });
}

function sortCards(rows: CardAssetListRow[], sort: InventorySortValue) {
  return [...rows].sort((left, right) => {
    const leftMetadata = deriveInventoryCardMetadata(left);
    const rightMetadata = deriveInventoryCardMetadata(right);

    switch (sort) {
      case "price_asc":
        return compareNullableNumbers(left.valuationMinor, right.valuationMinor, "asc");
      case "price_desc":
        return compareNullableNumbers(left.valuationMinor, right.valuationMinor, "desc");
      case "date_asc":
        return left.createdAt.getTime() - right.createdAt.getTime();
      case "date_desc":
        return right.createdAt.getTime() - left.createdAt.getTime();
      case "player_asc":
        return compareStrings(leftMetadata.playerName ?? leftMetadata.setName, rightMetadata.playerName ?? rightMetadata.setName);
      case "player_desc":
        return compareStrings(rightMetadata.playerName ?? rightMetadata.setName, leftMetadata.playerName ?? leftMetadata.setName);
      default:
        return 0;
    }
  });
}

function buildSelectionSummary(rows: CardAssetListRow[]): InventorySelectionSummary {
  const categoryCounts = new Map<string | null, number>();
  let totalValue = 0;

  for (const row of rows) {
    const metadata = deriveInventoryCardMetadata(row);
    categoryCounts.set(metadata.category ?? null, (categoryCounts.get(metadata.category ?? null) ?? 0) + 1);
    totalValue += row.valuationMinor ?? 0;
  }

  return {
    ids: rows.map((row) => row.id),
    totalValue,
    categories: [...categoryCounts.entries()].map(([category, count]) => ({ category, count })),
  };
}

function buildAggregations(rows: CardAssetListRow[]): InventoryCardsResponse["aggregations"] {
  const categoryCounts = new Map<string, number>();
  const valuations = rows.map((row) => row.valuationMinor).filter((value): value is number => value != null);
  let totalValue = 0;

  for (const row of rows) {
    const metadata = deriveInventoryCardMetadata(row);
    if (metadata.category) {
      categoryCounts.set(metadata.category, (categoryCounts.get(metadata.category) ?? 0) + 1);
    }
    totalValue += row.valuationMinor ?? 0;
  }

  return {
    totalValue,
    categories: [...categoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count || compareStrings(left.category, right.category)),
    priceRange: {
      min: valuations.length > 0 ? Math.min(...valuations) : 0,
      max: valuations.length > 0 ? Math.max(...valuations) : 0,
    },
  };
}

function buildCardWhere(query: InventoryQueryState, scope?: InventoryListScope): Prisma.CardAssetWhereInput {
  const minPrice = query.minPrice.trim() ? Number.parseInt(query.minPrice, 10) : Number.NaN;
  const maxPrice = query.maxPrice.trim() ? Number.parseInt(query.maxPrice, 10) : Number.NaN;
  const valuationMinor =
    Number.isFinite(minPrice) || Number.isFinite(maxPrice)
      ? {
          ...(Number.isFinite(minPrice) ? { gte: minPrice } : {}),
          ...(Number.isFinite(maxPrice) ? { lte: maxPrice } : {}),
        }
      : undefined;

  return {
    reviewStage: "INVENTORY_READY_FOR_SALE",
    ...(scope?.locationId
      ? {
          inventoryBatch: {
            locationId: scope.locationId,
          },
        }
      : {
          inventoryBatchId: null,
        }),
    ...(scope?.batchId ? { inventoryBatchId: scope.batchId } : {}),
    ...(query.category.length > 0
      ? {
          OR: [
            { category: { in: query.category as CollectibleCategory[] } },
            { category: null },
          ],
        }
      : {}),
    ...(query.subCategory.length > 0
      ? {
          OR: [
            { subCategory: { in: query.subCategory } },
            { subCategory: null },
          ],
        }
      : {}),
    ...(valuationMinor ? { valuationMinor } : {}),
  };
}

async function loadInventoryCardRows(query: InventoryQueryState, scope?: InventoryListScope) {
  return prisma.cardAsset.findMany({
    where: buildCardWhere(query, scope),
    select: CARD_ASSET_SELECT,
  });
}

export async function listInventoryCards(options: ListInventoryCardsOptions): Promise<InventoryCardsResponse> {
  const query: InventoryQueryState = {
    ...options.query,
    page: Math.max(options.query.page, 1),
    pageSize: Math.min(Math.max(options.query.pageSize, 1), MAX_INVENTORY_PAGE_SIZE),
  };

  const rows = await loadInventoryCardRows(query, options.scope);
  const filtered = filterCards(rows, query);
  const sorted = sortCards(filtered, query.sort);
  const totalCount = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const start = (page - 1) * query.pageSize;
  const cards = sorted.slice(start, start + query.pageSize).map(toInventoryCardSummary);

  return {
    cards,
    pagination: {
      page,
      pageSize: query.pageSize,
      totalCount,
      totalPages,
    },
    aggregations: buildAggregations(sorted),
    ...(options.includeSelection ? { selection: buildSelectionSummary(sorted) } : {}),
  };
}

export async function getInventoryFilterOptions(scope?: InventoryListScope): Promise<InventoryFilterOptionsResponse> {
  const rows = await prisma.cardAsset.findMany({
    where: buildCardWhere(
      {
        page: 1,
        pageSize: DEFAULT_INVENTORY_PAGE_SIZE,
        category: [],
        subCategory: [],
        minPrice: "",
        maxPrice: "",
        year: [],
        brand: [],
        parallel: [],
        search: "",
        sort: "price_desc",
        batchId: scope?.batchId ?? null,
      },
      scope
    ),
    select: {
      id: true,
      fileName: true,
      imageUrl: true,
      thumbnailUrl: true,
      valuationMinor: true,
      classificationJson: true,
      customTitle: true,
      resolvedPlayerName: true,
      resolvedTeamName: true,
      category: true,
      subCategory: true,
      reviewStage: true,
      createdAt: true,
      updatedAt: true,
      inventoryBatchId: true,
      inventoryAssignedAt: true,
      assignedDefinitionId: true,
      photos: {
        select: {
          id: true,
          kind: true,
          imageUrl: true,
          thumbnailUrl: true,
          createdAt: true,
        },
      },
      inventoryBatch: {
        select: {
          id: true,
          label: true,
          stage: true,
          category: true,
          tier: true,
          locationId: true,
          location: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      },
    },
  });

  const subCategories = new Set<string>();
  const years = new Set<string>();
  const brands = new Set<string>();
  const parallels = new Set<string>();

  for (const row of rows) {
    const metadata = deriveInventoryCardMetadata(row as CardAssetListRow);
    if (metadata.subCategory) {
      subCategories.add(metadata.subCategory);
    }
    if (metadata.year) {
      years.add(metadata.year);
    }
    if (metadata.brand) {
      brands.add(metadata.brand);
    }
    if (metadata.parallel) {
      parallels.add(metadata.parallel);
    } else {
      parallels.add("base");
    }
  }

  const locations = await prisma.location.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
    },
  });

  return {
    categories: [...COLLECTIBLE_CATEGORY_VALUES],
    subCategories: [...subCategories].sort(compareStrings),
    years: [...years].sort(compareStrings),
    brands: [...brands].sort(compareStrings),
    parallels: [...parallels].sort(compareStrings),
    locations,
  };
}

async function getPackedCardIds(cardIds: string[]) {
  const uniqueCardIds = [...new Set(cardIds)];
  if (uniqueCardIds.length === 0) {
    return new Set<string>();
  }

  const rows = await prisma.packSlot.findMany({
    where: {
      item: {
        number: {
          in: uniqueCardIds,
        },
      },
      packInstance: {
        fulfillmentStatus: {
          in: [PackFulfillmentStatus.PACKED, PackFulfillmentStatus.LOADED],
        },
      },
    },
    select: {
      item: {
        select: {
          number: true,
        },
      },
    },
  });

  return new Set(
    rows
      .map((row) => row.item.number)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
}

function resolvePrimaryStage(stageSummary: Array<{ stage: string; count: number }>) {
  if (stageSummary.length === 0) {
    return null;
  }
  if (stageSummary.length === 1) {
    return stageSummary[0].stage;
  }
  return "MIXED";
}

function buildStageSummary(batchStages: string[]) {
  const counts = new Map<string, number>();
  for (const stage of batchStages) {
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([stage, count]) => ({ stage, count }))
    .sort((left, right) => right.count - left.count || compareStrings(left.stage, right.stage));
}

function addCategoryCount(target: Map<string, number>, category: string | null) {
  if (!category) {
    return;
  }
  target.set(category, (target.get(category) ?? 0) + 1);
}

async function loadLocationBatches(locationId?: string) {
  return prisma.inventoryBatch.findMany({
    where: {
      ...(locationId ? { locationId } : {}),
      cards: {
        some: {},
      },
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      label: true,
      stage: true,
      category: true,
      tier: true,
      createdAt: true,
      stageChangedAt: true,
      shippedAt: true,
      loadedAt: true,
      location: {
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
        },
      },
      cards: {
        select: {
          id: true,
          valuationMinor: true,
          inventoryAssignedAt: true,
          category: true,
        },
      },
    },
  });
}

export async function getAssignedLocationsSummary(): Promise<{
  summary: {
    totalCards: number;
    cardsToday: number;
    cardsThisWeek: number;
    totalValue: number;
  };
  locations: AssignedLocationSummary[];
}> {
  const batches = await loadLocationBatches();
  const allCardIds = batches.flatMap((batch) => batch.cards.map((card) => card.id));
  const packedCardIds = await getPackedCardIds(allCardIds);
  const today = getUtcStartOfToday();
  const week = getUtcStartOfWeek();

  let totalCards = 0;
  let cardsToday = 0;
  let cardsThisWeek = 0;
  let totalValue = 0;

  const byLocation = new Map<string, AssignedLocationSummary>();

  for (const batch of batches) {
    const location = batch.location;
    const existing =
      byLocation.get(location.id) ??
      ({
        id: location.id,
        name: location.name,
        slug: location.slug,
        cardCount: 0,
        totalValue: 0,
        categories: [],
        tiers: [],
        stageSummary: [],
        primaryStage: null,
        packingProgress: {
          packedCount: 0,
          totalCount: 0,
        },
      } satisfies AssignedLocationSummary);

    const categoryCounts = new Map(existing.categories.map((entry) => [entry.category, entry.count]));
    const tierCounts = new Map(existing.tiers.map((entry) => [entry.tier, entry.count]));
    const stageSummary = new Map(existing.stageSummary.map((entry) => [entry.stage, entry.count]));

    existing.cardCount += batch.cards.length;
    existing.totalValue += batch.cards.reduce((sum, card) => sum + (card.valuationMinor ?? 0), 0);
    existing.packingProgress.totalCount += batch.cards.length;
    existing.packingProgress.packedCount += batch.cards.filter((card) => packedCardIds.has(card.id)).length;

    for (const card of batch.cards) {
      totalCards += 1;
      totalValue += card.valuationMinor ?? 0;
      if (card.inventoryAssignedAt && card.inventoryAssignedAt >= today) {
        cardsToday += 1;
      }
      if (card.inventoryAssignedAt && card.inventoryAssignedAt >= week) {
        cardsThisWeek += 1;
      }
      addCategoryCount(categoryCounts, card.category);
      if (batch.tier) {
        tierCounts.set(batch.tier, (tierCounts.get(batch.tier) ?? 0) + 1);
      }
    }

    stageSummary.set(batch.stage, (stageSummary.get(batch.stage) ?? 0) + 1);
    existing.categories = [...categoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count || compareStrings(left.category, right.category));
    existing.tiers = [...tierCounts.entries()]
      .map(([tier, count]) => ({ tier, count }))
      .sort((left, right) => right.count - left.count || compareStrings(left.tier, right.tier));
    existing.stageSummary = [...stageSummary.entries()]
      .map(([stage, count]) => ({ stage, count }))
      .sort((left, right) => right.count - left.count || compareStrings(left.stage, right.stage));
    existing.primaryStage = resolvePrimaryStage(existing.stageSummary);

    byLocation.set(location.id, existing);
  }

  return {
    summary: {
      totalCards,
      cardsToday,
      cardsThisWeek,
      totalValue,
    },
    locations: [...byLocation.values()].sort(
      (left, right) => right.totalValue - left.totalValue || compareStrings(left.name, right.name)
    ),
  };
}

export async function getAssignedLocationDetail(options: {
  locationId: string;
  query: InventoryQueryState;
  includeSelection?: boolean;
}): Promise<AssignedLocationDetailResponse | null> {
  const location = await prisma.location.findUnique({
    where: { id: options.locationId },
    select: {
      id: true,
      name: true,
      slug: true,
      address: true,
    },
  });

  if (!location) {
    return null;
  }

  const batches = await loadLocationBatches(options.locationId);
  const batchIds = new Set(batches.map((batch) => batch.id));
  const activeBatchId = options.query.batchId && batchIds.has(options.query.batchId) ? options.query.batchId : null;
  const relevantBatches = activeBatchId ? batches.filter((batch) => batch.id === activeBatchId) : batches;
  const packedCardIds = await getPackedCardIds(batches.flatMap((batch) => batch.cards.map((card) => card.id)));

  const batchSummaries: AssignedLocationBatchSummary[] = batches.map((batch) => ({
    id: batch.id,
    label: batch.label ?? null,
    stage: batch.stage,
    category: batch.category ?? null,
    tier: batch.tier ?? null,
    cardCount: batch.cards.length,
    totalValue: batch.cards.reduce((sum, card) => sum + (card.valuationMinor ?? 0), 0),
    createdAt: batch.createdAt.toISOString(),
    stageChangedAt: batch.stageChangedAt ? batch.stageChangedAt.toISOString() : null,
    shippedAt: batch.shippedAt ? batch.shippedAt.toISOString() : null,
    loadedAt: batch.loadedAt ? batch.loadedAt.toISOString() : null,
    packingProgress: {
      packedCount: batch.cards.filter((card) => packedCardIds.has(card.id)).length,
      totalCount: batch.cards.length,
    },
  }));

  const stageSummary = buildStageSummary(relevantBatches.map((batch) => batch.stage));
  const cardCount = relevantBatches.reduce((sum, batch) => sum + batch.cards.length, 0);
  const totalValue = relevantBatches.reduce(
    (sum, batch) => sum + batch.cards.reduce((batchTotal, card) => batchTotal + (card.valuationMinor ?? 0), 0),
    0
  );
  const packedCount = relevantBatches.reduce(
    (sum, batch) => sum + batch.cards.filter((card) => packedCardIds.has(card.id)).length,
    0
  );
  const cardsResponse = await listInventoryCards({
    query: {
      ...options.query,
      batchId: activeBatchId,
      pageSize: Math.min(options.query.pageSize, MAX_INVENTORY_PAGE_SIZE),
    },
    scope: {
      locationId: options.locationId,
      batchId: activeBatchId,
    },
    includeSelection: options.includeSelection,
  });

  return {
    location: {
      id: location.id,
      name: location.name,
      slug: location.slug,
      address: location.address,
      isOnline: location.slug === ONLINE_LOCATION_SLUG || location.name === ONLINE_LOCATION_NAME,
    },
    batches: batchSummaries,
    activeBatchId,
    stats: {
      cardCount,
      totalValue,
      stageSummary,
      primaryStage: resolvePrimaryStage(stageSummary),
      packingProgress: {
        packedCount,
        totalCount: cardCount,
      },
    },
    cards: cardsResponse.cards,
    pagination: cardsResponse.pagination,
    aggregations: cardsResponse.aggregations,
    ...(cardsResponse.selection ? { selection: cardsResponse.selection } : {}),
  };
}
