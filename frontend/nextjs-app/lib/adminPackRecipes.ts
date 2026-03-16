import type { CollectibleCategoryValue, PackTierValue } from "./adminInventory";

export const PACK_RECIPE_ITEM_TYPE_VALUES = ["PROMOTIONAL", "MERCH", "COUPON", "OTHER"] as const;
export type PackRecipeItemTypeValue = (typeof PACK_RECIPE_ITEM_TYPE_VALUES)[number];

export type RecipeConfigurationSource = "recipe" | "calculator-config" | "default";
export type PackingSlipLayout = "receipt" | "letter";

export const PACK_RECIPE_ITEM_TYPE_LABELS: Record<PackRecipeItemTypeValue, string> = {
  PROMOTIONAL: "Promotional",
  MERCH: "Merch",
  COUPON: "Coupon",
  OTHER: "Other",
};

export type LocationRecipeItemSummary = {
  id: string;
  name: string;
  description: string | null;
  itemType: PackRecipeItemTypeValue;
  quantity: number;
  costPerUnit: number;
  isSeasonal: boolean;
  seasonStart: string | null;
  seasonEnd: string | null;
  isActive: boolean;
  sortOrder: number;
  isCurrentlyActive: boolean;
};

export type LocationRecipeSummary = {
  id: string;
  locationId: string;
  category: CollectibleCategoryValue | string;
  tier: PackTierValue | string;
  name: string;
  isActive: boolean;
  slabCardsPerPack: number;
  bonusCardsPerPack: number;
  bonusCardMaxValue: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  items: LocationRecipeItemSummary[];
  extraCostPerPack: number;
  activeExtraItemCount: number;
};

export type LocationRecipesResponse = {
  recipes: LocationRecipeSummary[];
};

export type ResolvedRecipeItemSummary = {
  id: string;
  name: string;
  description: string | null;
  itemType: PackRecipeItemTypeValue;
  quantity: number;
  costPerUnit: number;
};

export type PackRecipeResolveResponse = {
  recipe: {
    id: string;
    name: string;
    locationId: string;
    category: CollectibleCategoryValue | string;
    tier: PackTierValue | string;
    isActive: boolean;
    slabCardsPerPack: number;
    bonusCardsPerPack: number;
    bonusCardMaxValue: number;
    activeItems: ResolvedRecipeItemSummary[];
    extraCostPerPack: number;
  };
};

export type PackingSlipCardSummary = {
  id: string;
  playerName: string | null;
  setName: string | null;
  year: string | null;
  brand: string | null;
  parallel: string | null;
  valuationMinor: number | null;
  cardNumber: string | null;
};

export type PackingSlipExtraItem = {
  name: string;
  description: string | null;
  quantity: number;
  itemType: PackRecipeItemTypeValue;
};

export type PackingSlipSummary = {
  packNumber: number;
  mainCard: PackingSlipCardSummary;
  bonusCardCount: number;
  bonusCardMaxValue: number;
  extraItems: PackingSlipExtraItem[];
};

export type PackingSlipsResponse = {
  batch: {
    id: string;
    label: string | null;
    location: {
      id: string;
      name: string;
      address: string;
    };
    category: CollectibleCategoryValue | string | null;
    tier: PackTierValue | string | null;
    packCount: number;
    createdAt: string;
  };
  recipe: {
    id: string | null;
    name: string;
    source: RecipeConfigurationSource;
    slabCardsPerPack: number;
    bonusCardsPerPack: number;
    bonusCardMaxValue: number;
    activeItems: PackingSlipExtraItem[];
    extraCostPerPack: number;
  } | null;
  slips: PackingSlipSummary[];
};

export function formatPackRecipeItemTypeLabel(value: string | null | undefined) {
  if (!value) {
    return "Other";
  }
  if (value in PACK_RECIPE_ITEM_TYPE_LABELS) {
    return PACK_RECIPE_ITEM_TYPE_LABELS[value as PackRecipeItemTypeValue];
  }
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatRecipeSeasonLabel(start: string | null, end: string | null) {
  if (!start && !end) {
    return "Seasonal";
  }

  const formatDate = (value: string | null) => {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const startLabel = formatDate(start);
  const endLabel = formatDate(end);

  if (startLabel && endLabel) {
    return `${startLabel} - ${endLabel}`;
  }
  return startLabel ?? endLabel ?? "Seasonal";
}
