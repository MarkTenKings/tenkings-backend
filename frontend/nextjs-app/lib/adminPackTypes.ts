import {
  COLLECTIBLE_CATEGORY_VALUES,
  PACK_TIER_VALUES,
  buildPackDefinitionName,
  formatCategoryLabel,
  formatPackTierLabel,
  type CollectibleCategoryValue,
  type PackTierValue,
} from "./adminInventory";

export const PACK_TYPE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PACK_TYPE_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

export const PACK_TYPE_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

export type PackTypeStatusValue = (typeof PACK_TYPE_STATUS_OPTIONS)[number]["value"];

export type AdminPackType = {
  id: string;
  name: string;
  description: string | null;
  category: CollectibleCategoryValue;
  tier: PackTierValue;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PackTypeUpsertPayload = {
  name: string;
  category: CollectibleCategoryValue;
  tier: PackTierValue;
  description?: string | null;
  isActive: boolean;
};

const CATEGORY_ORDER = new Map(COLLECTIBLE_CATEGORY_VALUES.map((value, index) => [value, index]));
const TIER_ORDER = new Map(PACK_TIER_VALUES.map((value, index) => [value, index]));

export function comparePackTypes(left: Pick<AdminPackType, "category" | "tier" | "name">, right: Pick<AdminPackType, "category" | "tier" | "name">) {
  const categoryDiff = (CATEGORY_ORDER.get(left.category) ?? 999) - (CATEGORY_ORDER.get(right.category) ?? 999);
  if (categoryDiff !== 0) {
    return categoryDiff;
  }

  const tierDiff = (TIER_ORDER.get(left.tier) ?? 999) - (TIER_ORDER.get(right.tier) ?? 999);
  if (tierDiff !== 0) {
    return tierDiff;
  }

  return left.name.localeCompare(right.name);
}

export function buildPackTypeGridLabel(category: string | null | undefined, tier: string | null | undefined) {
  return `${formatCategoryLabel(category).toUpperCase()} ${formatPackTierLabel(tier)}`;
}

export function buildPackTypeDisplayName(packType: Pick<AdminPackType, "name" | "category" | "tier">) {
  const fallbackName = buildPackDefinitionName(packType.category, packType.tier);
  return packType.name.trim() || fallbackName;
}

export function buildPackTypePreviewName(category: CollectibleCategoryValue, tier: PackTierValue) {
  return buildPackDefinitionName(category, tier);
}

export function packTypeMatchesSelection(
  packType: Pick<AdminPackType, "category" | "tier">,
  selection: { packCategory: CollectibleCategoryValue | ""; packTier: PackTierValue | "" }
) {
  return packType.category === selection.packCategory && packType.tier === selection.packTier;
}
