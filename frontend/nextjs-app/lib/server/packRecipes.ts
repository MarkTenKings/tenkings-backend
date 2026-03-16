import { prisma } from "@tenkings/database";
import {
  CollectibleCategory,
  PackRecipeItemType,
  PackTier,
  Prisma,
} from "@prisma/client";
import { parseClassificationPayload } from "@tenkings/shared";
import { z } from "zod";
import type {
  LocationRecipeSummary,
  PackRecipeResolveResponse,
  PackingSlipsResponse,
  RecipeConfigurationSource,
  ResolvedRecipeItemSummary,
} from "../adminPackRecipes";

const packRecipeItemInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Extra item name is required").max(120),
    description: z.string().trim().max(500).optional().nullable(),
    itemType: z.nativeEnum(PackRecipeItemType),
    quantity: z.coerce.number().int().min(1).default(1),
    costPerUnit: z.coerce.number().int().min(0),
    isSeasonal: z.boolean().optional().default(false),
    seasonStart: z.string().trim().optional().nullable(),
    seasonEnd: z.string().trim().optional().nullable(),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .superRefine((value, ctx) => {
    const hasSeasonStart = Boolean(value.seasonStart?.trim());
    const hasSeasonEnd = Boolean(value.seasonEnd?.trim());
    const parsedStart = value.seasonStart ? new Date(value.seasonStart) : null;
    const parsedEnd = value.seasonEnd ? new Date(value.seasonEnd) : null;

    if (value.seasonStart && parsedStart && Number.isNaN(parsedStart.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seasonStart"],
        message: "Season start must be a valid date.",
      });
    }

    if (value.seasonEnd && parsedEnd && Number.isNaN(parsedEnd.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seasonEnd"],
        message: "Season end must be a valid date.",
      });
    }

    if (value.isSeasonal && (!hasSeasonStart || !hasSeasonEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seasonStart"],
        message: "Seasonal items must include both a start and end date.",
      });
    }

    if (value.isSeasonal && parsedStart && parsedEnd && parsedStart > parsedEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seasonEnd"],
        message: "Season end must be on or after the season start date.",
      });
    }
  });

export const createPackRecipeSchema = z.object({
  category: z.nativeEnum(CollectibleCategory),
  tier: z.nativeEnum(PackTier),
  name: z.string().trim().min(1, "Recipe name is required").max(120),
  slabCardsPerPack: z.coerce.number().int().min(1).optional().default(1),
  bonusCardsPerPack: z.coerce.number().int().min(0).optional().default(2),
  bonusCardMaxValue: z.coerce.number().int().min(0).optional().default(300),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(packRecipeItemInputSchema).optional().default([]),
});

export const updatePackRecipeSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
    slabCardsPerPack: z.coerce.number().int().min(1).optional(),
    bonusCardsPerPack: z.coerce.number().int().min(0).optional(),
    bonusCardMaxValue: z.coerce.number().int().min(0).optional(),
    notes: z.string().trim().max(2000).optional().nullable(),
    items: z.array(packRecipeItemInputSchema).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one recipe field must be provided.",
  });

export const duplicatePackRecipeSchema = z.object({
  locationId: z.string().uuid().optional(),
  tier: z.nativeEnum(PackTier).optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

type PackRecipeWithItems = Prisma.PackRecipeGetPayload<{
  include: {
    items: true;
  };
}>;

type NormalizedRecipeItemInput = Omit<
  z.infer<typeof packRecipeItemInputSchema>,
  "seasonStart" | "seasonEnd" | "description"
> & {
  description: string | null;
  seasonStart: Date | null;
  seasonEnd: Date | null;
};

type ResolvedPackConfiguration = {
  source: RecipeConfigurationSource;
  recipeId: string | null;
  recipeName: string | null;
  slabCardsPerPack: number;
  bonusCardsPerPack: number;
  bonusCardMaxValue: number;
  activeItems: ResolvedRecipeItemSummary[];
  extraCostPerPack: number;
};

type RecipeResolutionClient = Pick<Prisma.TransactionClient, "packRecipe" | "packCalculatorConfig">;

const packRecipeInclude = {
  items: {
    orderBy: {
      sortOrder: "asc",
    },
  },
} satisfies Prisma.PackRecipeInclude;

function parseDateOrNull(value: string | null | undefined) {
  if (!value || !value.trim()) {
    return null;
  }
  return new Date(value);
}

function pickFirstString(...values: Array<string | null | undefined>) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null;
}

function derivePackingSlipCard(
  card: {
    id: string;
    classificationJson: Prisma.JsonValue | null;
    customTitle: string | null;
    resolvedPlayerName: string | null;
    valuationMinor: number | null;
  }
) {
  const classification = parseClassificationPayload(card.classificationJson);
  const attributes = classification?.attributes;
  const normalized = classification?.normalized;

  return {
    id: card.id,
    playerName: pickFirstString(
      card.resolvedPlayerName,
      normalized?.sport?.playerName,
      normalized?.tcg?.cardName,
      normalized?.comics?.title,
      normalized?.displayName,
      card.customTitle
    ),
    setName: pickFirstString(normalized?.setName, attributes?.setName),
    year: pickFirstString(normalized?.year, attributes?.year),
    brand: pickFirstString(normalized?.company, attributes?.brand),
    parallel: pickFirstString(attributes?.variantKeywords?.[0] ?? null),
    valuationMinor: card.valuationMinor ?? null,
    cardNumber: pickFirstString(normalized?.cardNumber),
  };
}

export function normalizeRecipeItemInputs(
  items: z.infer<typeof packRecipeItemInputSchema>[]
): NormalizedRecipeItemInput[] {
  return items.map((item, index) => ({
    ...item,
    description: item.description?.trim() || null,
    seasonStart: parseDateOrNull(item.seasonStart),
    seasonEnd: parseDateOrNull(item.seasonEnd),
    sortOrder: item.sortOrder ?? index,
  }));
}

export function isPackRecipeItemCurrentlyActive(
  item: Pick<
    PackRecipeWithItems["items"][number],
    "isActive" | "isSeasonal" | "seasonStart" | "seasonEnd"
  >,
  now = new Date()
) {
  if (!item.isActive) {
    return false;
  }
  if (!item.isSeasonal) {
    return true;
  }
  if (item.seasonStart && now < item.seasonStart) {
    return false;
  }
  if (item.seasonEnd && now > item.seasonEnd) {
    return false;
  }
  return true;
}

function toResolvedRecipeItem(item: PackRecipeWithItems["items"][number]): ResolvedRecipeItemSummary {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? null,
    itemType: item.itemType,
    quantity: item.quantity,
    costPerUnit: item.costPerUnit,
  };
}

export function serializeLocationRecipe(
  recipe: PackRecipeWithItems,
  now = new Date()
): LocationRecipeSummary {
  const items = recipe.items.map((item) => {
    const isCurrentlyActive = recipe.isActive && isPackRecipeItemCurrentlyActive(item, now);

    return {
      id: item.id,
      name: item.name,
      description: item.description ?? null,
      itemType: item.itemType,
      quantity: item.quantity,
      costPerUnit: item.costPerUnit,
      isSeasonal: item.isSeasonal,
      seasonStart: item.seasonStart ? item.seasonStart.toISOString() : null,
      seasonEnd: item.seasonEnd ? item.seasonEnd.toISOString() : null,
      isActive: item.isActive,
      sortOrder: item.sortOrder,
      isCurrentlyActive,
    };
  });

  return {
    id: recipe.id,
    locationId: recipe.locationId,
    category: recipe.category,
    tier: recipe.tier,
    name: recipe.name,
    isActive: recipe.isActive,
    slabCardsPerPack: recipe.slabCardsPerPack,
    bonusCardsPerPack: recipe.bonusCardsPerPack,
    bonusCardMaxValue: recipe.bonusCardMaxValue,
    notes: recipe.notes ?? null,
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
    createdById: recipe.createdById ?? null,
    items,
    extraCostPerPack: items.reduce((sum, item) => {
      return item.isCurrentlyActive ? sum + item.costPerUnit * item.quantity : sum;
    }, 0),
    activeExtraItemCount: items.filter((item) => item.isCurrentlyActive).length,
  };
}

export function serializeResolvedPackRecipe(
  recipe: PackRecipeWithItems,
  now = new Date()
): PackRecipeResolveResponse["recipe"] {
  const activeItems =
    recipe.isActive
      ? recipe.items.filter((item) => isPackRecipeItemCurrentlyActive(item, now)).map(toResolvedRecipeItem)
      : [];

  return {
    id: recipe.id,
    name: recipe.name,
    locationId: recipe.locationId,
    category: recipe.category,
    tier: recipe.tier,
    isActive: recipe.isActive,
    slabCardsPerPack: recipe.slabCardsPerPack,
    bonusCardsPerPack: recipe.bonusCardsPerPack,
    bonusCardMaxValue: recipe.bonusCardMaxValue,
    activeItems,
    extraCostPerPack: activeItems.reduce((sum, item) => sum + item.costPerUnit * item.quantity, 0),
  };
}

export async function listLocationRecipes(locationId: string) {
  const recipes = await prisma.packRecipe.findMany({
    where: { locationId },
    include: packRecipeInclude,
    orderBy: [{ category: "asc" }, { tier: "asc" }],
  });

  const now = new Date();
  return recipes.map((recipe) => serializeLocationRecipe(recipe, now));
}

export async function getPackRecipeById(recipeId: string) {
  return prisma.packRecipe.findUnique({
    where: { id: recipeId },
    include: packRecipeInclude,
  });
}

export async function getLocationRecipeByKey(locationId: string, category: CollectibleCategory, tier: PackTier) {
  return prisma.packRecipe.findUnique({
    where: {
      locationId_category_tier: {
        locationId,
        category,
        tier,
      },
    },
    include: packRecipeInclude,
  });
}

export async function resolvePackConfigurationWithClient(
  client: RecipeResolutionClient,
  locationId: string,
  category: CollectibleCategory,
  tier: PackTier
): Promise<ResolvedPackConfiguration> {
  const recipe = await client.packRecipe.findUnique({
    where: {
      locationId_category_tier: {
        locationId,
        category,
        tier,
      },
    },
    include: packRecipeInclude,
  });

  if (recipe && recipe.isActive) {
    const resolved = serializeResolvedPackRecipe(recipe);
    return {
      source: "recipe",
      recipeId: resolved.id,
      recipeName: resolved.name,
      slabCardsPerPack: resolved.slabCardsPerPack,
      bonusCardsPerPack: resolved.bonusCardsPerPack,
      bonusCardMaxValue: resolved.bonusCardMaxValue,
      activeItems: resolved.activeItems,
      extraCostPerPack: resolved.extraCostPerPack,
    };
  }

  const calculatorConfig =
    (await client.packCalculatorConfig.findUnique({
      where: { category },
    })) ??
    (await client.packCalculatorConfig.findFirst({
      where: { category: null },
      orderBy: { createdAt: "asc" },
    }));

  if (calculatorConfig) {
    return {
      source: "calculator-config",
      recipeId: null,
      recipeName: null,
      slabCardsPerPack: 1,
      bonusCardsPerPack: calculatorConfig.bonusCardsPerPack,
      // PackCalculatorConfig stores average bonus-card cost, so use it as the best available fallback cap/value target.
      bonusCardMaxValue: calculatorConfig.bonusCardAvgCost,
      activeItems: [],
      extraCostPerPack: 0,
    };
  }

  return {
    source: "default",
    recipeId: null,
    recipeName: null,
    slabCardsPerPack: 1,
    bonusCardsPerPack: 3,
    bonusCardMaxValue: 300,
    activeItems: [],
    extraCostPerPack: 0,
  };
}

export async function resolvePackConfiguration(
  locationId: string,
  category: CollectibleCategory,
  tier: PackTier
) {
  return resolvePackConfigurationWithClient(prisma, locationId, category, tier);
}

export async function buildPackingSlips(batchId: string): Promise<PackingSlipsResponse | null> {
  const batch = await prisma.inventoryBatch.findUnique({
    where: { id: batchId },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
      cards: {
        where: { reviewStage: "INVENTORY_READY_FOR_SALE" },
        orderBy: [{ valuationMinor: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          classificationJson: true,
          customTitle: true,
          resolvedPlayerName: true,
          valuationMinor: true,
        },
      },
    },
  });

  if (!batch) {
    return null;
  }

  const recipe =
    batch.category && batch.tier
      ? await resolvePackConfiguration(batch.locationId, batch.category, batch.tier)
      : null;

  const slips = batch.cards.map((card, index) => {
    const mainCard = derivePackingSlipCard(card);

    return {
      packNumber: index + 1,
      mainCard,
      bonusCardCount: recipe?.bonusCardsPerPack ?? 3,
      bonusCardMaxValue: recipe?.bonusCardMaxValue ?? 300,
      extraItems:
        recipe?.activeItems.map((item) => ({
          name: item.name,
          description: item.description ?? null,
          quantity: item.quantity,
          itemType: item.itemType,
        })) ?? [],
    };
  });

  return {
    batch: {
      id: batch.id,
      label: batch.label ?? null,
      location: {
        id: batch.location.id,
        name: batch.location.name,
        address: batch.location.address,
      },
      category: batch.category ?? null,
      tier: batch.tier ?? null,
      packCount: batch.cards.length,
      createdAt: batch.createdAt.toISOString(),
    },
    recipe: recipe
      ? {
          id: recipe.recipeId,
          name: recipe.recipeName ?? (recipe.source === "recipe" ? "Location Recipe" : "Pack Calculator Default"),
          source: recipe.source,
          slabCardsPerPack: recipe.slabCardsPerPack,
          bonusCardsPerPack: recipe.bonusCardsPerPack,
          bonusCardMaxValue: recipe.bonusCardMaxValue,
          activeItems: recipe.activeItems.map((item) => ({
            name: item.name,
            description: item.description ?? null,
            quantity: item.quantity,
            itemType: item.itemType,
          })),
          extraCostPerPack: recipe.extraCostPerPack,
        }
      : null,
    slips,
  };
}

export async function createLocationRecipe(
  locationId: string,
  createdById: string,
  input: z.infer<typeof createPackRecipeSchema>
) {
  const items = normalizeRecipeItemInputs(input.items);

  const recipe = await prisma.packRecipe.create({
    data: {
      locationId,
      category: input.category,
      tier: input.tier,
      name: input.name.trim(),
      slabCardsPerPack: input.slabCardsPerPack,
      bonusCardsPerPack: input.bonusCardsPerPack,
      bonusCardMaxValue: input.bonusCardMaxValue,
      notes: input.notes?.trim() || null,
      createdById,
      items:
        items.length > 0
          ? {
              create: items.map((item) => ({
                name: item.name.trim(),
                description: item.description,
                itemType: item.itemType,
                quantity: item.quantity,
                costPerUnit: item.costPerUnit,
                isSeasonal: item.isSeasonal,
                seasonStart: item.seasonStart,
                seasonEnd: item.seasonEnd,
                isActive: item.isActive,
                sortOrder: item.sortOrder,
              })),
            }
          : undefined,
    },
    include: packRecipeInclude,
  });

  return serializeLocationRecipe(recipe);
}
