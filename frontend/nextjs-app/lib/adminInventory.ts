export const COLLECTIBLE_CATEGORY_VALUES = [
  "SPORTS",
  "POKEMON",
  "ONE_PIECE",
  "COMICS",
  "GOLDEN_TICKET_PRIZE",
] as const;
export type CollectibleCategoryValue = (typeof COLLECTIBLE_CATEGORY_VALUES)[number];

export const PACK_TIER_VALUES = ["TIER_25", "TIER_50", "TIER_100", "TIER_250", "TIER_500"] as const;
export type PackTierValue = (typeof PACK_TIER_VALUES)[number];

export const INVENTORY_SORT_VALUES = [
  "price_desc",
  "price_asc",
  "date_desc",
  "date_asc",
  "player_asc",
  "player_desc",
] as const;
export type InventorySortValue = (typeof INVENTORY_SORT_VALUES)[number];

export const DEFAULT_INVENTORY_PAGE_SIZE = 48;
export const MAX_INVENTORY_PAGE_SIZE = 100;

export const ONLINE_LOCATION_SLUG = "online-collect-tenkings-co";
export const ONLINE_LOCATION_NAME = "Online (collect.tenkings.co)";

export const CATEGORY_LABELS: Record<CollectibleCategoryValue, string> = {
  SPORTS: "Sports",
  POKEMON: "Pokemon",
  ONE_PIECE: "One Piece",
  COMICS: "Comics",
  GOLDEN_TICKET_PRIZE: "Golden Ticket Prize",
};

export const PACK_TIER_PRICE_MINOR: Record<PackTierValue, number> = {
  TIER_25: 2500,
  TIER_50: 5000,
  TIER_100: 10000,
  TIER_250: 25000,
  TIER_500: 50000,
};

export const PACK_TIER_LABELS: Record<PackTierValue, string> = {
  TIER_25: "$25",
  TIER_50: "$50",
  TIER_100: "$100",
  TIER_250: "$250",
  TIER_500: "$500",
};

export const CATEGORY_OPTIONS = COLLECTIBLE_CATEGORY_VALUES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export const PACK_TIER_OPTIONS = PACK_TIER_VALUES.map((value) => ({
  value,
  label: `${PACK_TIER_LABELS[value]} Pack`,
  priceMinor: PACK_TIER_PRICE_MINOR[value],
}));

export const INVENTORY_SORT_OPTIONS: Array<{ value: InventorySortValue; label: string }> = [
  { value: "price_desc", label: "Price High to Low" },
  { value: "price_asc", label: "Price Low to High" },
  { value: "date_desc", label: "Date Added" },
  { value: "date_asc", label: "Date Added (Oldest)" },
  { value: "player_asc", label: "Player Name A-Z" },
  { value: "player_desc", label: "Player Name Z-A" },
];

export const PRICE_PRESET_OPTIONS = [
  { id: "0-10", label: "$0-10", min: 0, max: 1000 },
  { id: "10-25", label: "$10-25", min: 1000, max: 2500 },
  { id: "25-50", label: "$25-50", min: 2500, max: 5000 },
  { id: "50-100", label: "$50-100", min: 5000, max: 10000 },
  { id: "100-250", label: "$100-250", min: 10000, max: 25000 },
  { id: "250+", label: "$250+", min: 25000, max: null },
] as const;

export type InventoryQueryState = {
  page: number;
  pageSize: number;
  category: string[];
  subCategory: string[];
  minPrice: string;
  maxPrice: string;
  year: string[];
  brand: string[];
  parallel: string[];
  search: string;
  sort: InventorySortValue;
  batchId: string | null;
};

export type InventoryCardSummary = {
  id: string;
  playerName: string | null;
  setName: string | null;
  year: string | null;
  brand: string | null;
  cardNumber: string | null;
  parallel: string | null;
  valuationMinor: number | null;
  category: string | null;
  subCategory: string | null;
  sport: string | null;
  frontPhotoUrl: string | null;
  backPhotoUrl: string | null;
  createdAt: string;
  inventoryBatch: {
    id: string;
    label: string | null;
    stage: string;
    locationId: string;
    locationName: string;
    category: string | null;
    tier: string | null;
  } | null;
};

export type InventorySelectionSummary = {
  ids: string[];
  totalValue: number;
  categories: Array<{ category: string | null; count: number }>;
};

export type InventoryCardsResponse = {
  cards: InventoryCardSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
  aggregations: {
    totalValue: number;
    categories: Array<{ category: string; count: number }>;
    priceRange: { min: number; max: number };
  };
  selection?: InventorySelectionSummary;
};

export type InventoryFilterOptionsResponse = {
  categories: string[];
  subCategories: string[];
  years: string[];
  brands: string[];
  parallels: string[];
  locations: Array<{ id: string; name: string }>;
};

export type AssignedLocationSummary = {
  id: string;
  name: string;
  slug: string;
  cardCount: number;
  totalValue: number;
  categories: Array<{ category: string; count: number }>;
  tiers: Array<{ tier: string; count: number }>;
  stageSummary: Array<{ stage: string; count: number }>;
  primaryStage: string | null;
  packingProgress: {
    packedCount: number;
    totalCount: number;
  };
};

export type InventoryCardUpdatePayload = {
  playerName?: string;
  setName?: string;
  year?: string;
  cardNumber?: string;
  parallel?: string | null;
  valuationMinor?: number;
  category?: CollectibleCategoryValue;
  subCategory?: string;
  brand?: string;
};

export type AssignedLocationsResponse = {
  summary: {
    totalCards: number;
    cardsToday: number;
    cardsThisWeek: number;
    totalValue: number;
  };
  locations: AssignedLocationSummary[];
};

export type AssignedLocationBatchSummary = {
  id: string;
  label: string | null;
  stage: string;
  category: string | null;
  tier: string | null;
  cardCount: number;
  totalValue: number;
  createdAt: string;
  stageChangedAt: string | null;
  shippedAt: string | null;
  loadedAt: string | null;
  packingProgress: {
    packedCount: number;
    totalCount: number;
  };
};

export type AssignedLocationDetailResponse = {
  location: {
    id: string;
    name: string;
    slug: string;
    address: string;
    isOnline: boolean;
  };
  batches: AssignedLocationBatchSummary[];
  activeBatchId: string | null;
  stats: {
    cardCount: number;
    totalValue: number;
    stageSummary: Array<{ stage: string; count: number }>;
    primaryStage: string | null;
    packingProgress: {
      packedCount: number;
      totalCount: number;
    };
  };
  cards: InventoryCardSummary[];
  pagination: InventoryCardsResponse["pagination"];
  aggregations: InventoryCardsResponse["aggregations"];
  selection?: InventorySelectionSummary;
};

export function parseListParam(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(raw.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean))];
}

export function parsePositiveInteger(value: string | string[] | undefined, fallback: number) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = candidate ? Number.parseInt(candidate, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseInventoryQueryState(
  query: Record<string, string | string[] | undefined>
): InventoryQueryState {
  const sortCandidate = Array.isArray(query.sort) ? query.sort[0] : query.sort;
  const sort = INVENTORY_SORT_VALUES.includes(sortCandidate as InventorySortValue)
    ? (sortCandidate as InventorySortValue)
    : "price_desc";

  return {
    page: parsePositiveInteger(query.page, 1),
    pageSize: Math.min(parsePositiveInteger(query.pageSize, DEFAULT_INVENTORY_PAGE_SIZE), MAX_INVENTORY_PAGE_SIZE),
    category: parseListParam(query.category),
    subCategory: parseListParam(query.subCategory),
    minPrice: typeof query.minPrice === "string" ? query.minPrice : "",
    maxPrice: typeof query.maxPrice === "string" ? query.maxPrice : "",
    year: parseListParam(query.year),
    brand: parseListParam(query.brand),
    parallel: parseListParam(query.parallel),
    search: typeof query.search === "string" ? query.search : "",
    sort,
    batchId: typeof query.batchId === "string" && query.batchId.trim() ? query.batchId : null,
  };
}

export function buildInventoryQueryState(next: InventoryQueryState) {
  const query: Record<string, string> = {
    page: String(next.page),
    pageSize: String(next.pageSize),
    sort: next.sort,
  };

  if (next.category.length > 0) {
    query.category = next.category.join(",");
  }
  if (next.subCategory.length > 0) {
    query.subCategory = next.subCategory.join(",");
  }
  if (next.minPrice.trim()) {
    query.minPrice = next.minPrice.trim();
  }
  if (next.maxPrice.trim()) {
    query.maxPrice = next.maxPrice.trim();
  }
  if (next.year.length > 0) {
    query.year = next.year.join(",");
  }
  if (next.brand.length > 0) {
    query.brand = next.brand.join(",");
  }
  if (next.parallel.length > 0) {
    query.parallel = next.parallel.join(",");
  }
  if (next.search.trim()) {
    query.search = next.search.trim();
  }
  if (next.batchId) {
    query.batchId = next.batchId;
  }

  return query;
}

export function formatCurrencyFromMinor(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function formatCategoryLabel(category: string | null | undefined) {
  if (!category) {
    return "Unknown";
  }
  if (category in CATEGORY_LABELS) {
    return CATEGORY_LABELS[category as CollectibleCategoryValue];
  }
  return category
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatPackTierLabel(tier: string | null | undefined) {
  if (!tier) {
    return "Unknown";
  }
  if (tier in PACK_TIER_LABELS) {
    return PACK_TIER_LABELS[tier as PackTierValue];
  }
  return tier;
}

export function buildPackDefinitionName(category: CollectibleCategoryValue, tier: PackTierValue) {
  return `${formatCategoryLabel(category)} ${formatPackTierLabel(tier)} Pack`;
}

export function buildInventoryBatchLabel(category: CollectibleCategoryValue, tier: PackTierValue, locationName: string, date = new Date()) {
  const isoDate = date.toISOString().slice(0, 10);
  return `${formatCategoryLabel(category)} ${formatPackTierLabel(tier)} — ${locationName} — ${isoDate}`;
}

export function isOnlineLocation(location: { slug?: string | null; name?: string | null } | null | undefined) {
  return Boolean(
    location &&
      ((typeof location.slug === "string" && location.slug === ONLINE_LOCATION_SLUG) ||
        (typeof location.name === "string" && location.name === ONLINE_LOCATION_NAME))
  );
}

export function findPricePreset(min: string, max: string) {
  return (
    PRICE_PRESET_OPTIONS.find((preset) => String(preset.min) === min && String(preset.max ?? "") === max) ?? null
  );
}
