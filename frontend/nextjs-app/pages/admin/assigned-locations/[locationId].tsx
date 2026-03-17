import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../../../components/AppShell";
import {
  ADMIN_PAGE_FRAME_CLASS,
  AdminPageHeader,
  adminInputClass,
  adminPanelClass,
  adminSelectClass,
  adminStatCardClass,
} from "../../../components/admin/AdminPrimitives";
import { CardGrid } from "../../../components/admin/CardGrid";
import { FilterBar } from "../../../components/admin/FilterBar";
import { PaginationBar } from "../../../components/admin/PaginationBar";
import { RecipeCard } from "../../../components/admin/RecipeCard";
import {
  RecipeForm,
  type RecipeFormItemValue,
  type RecipeFormValue,
} from "../../../components/admin/RecipeForm";
import { SelectionBar } from "../../../components/admin/SelectionBar";
import {
  COLLECTIBLE_CATEGORY_VALUES,
  PACK_TIER_OPTIONS,
  buildPackDefinitionName,
  buildInventoryQueryState,
  formatCategoryLabel,
  formatCurrencyFromMinor,
  formatPackTierLabel,
  parseInventoryQueryState,
  type CollectibleCategoryValue,
  type PackTierValue,
  type AssignedLocationBatchSummary,
  type AssignedLocationDetailResponse,
  type InventoryCardSummary,
  type InventoryCardsResponse,
  type InventoryFilterOptionsResponse,
  type InventoryQueryState,
  type InventorySelectionSummary,
} from "../../../lib/adminInventory";
import type {
  LocationRecipeSummary,
  LocationRecipesResponse,
} from "../../../lib/adminPackRecipes";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import { useSession } from "../../../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";

type SelectedCardMeta = {
  valuationMinor: number | null;
  category: string | null;
  frontPhotoUrl: string | null;
};

type DetailTab = "cards" | "recipes";

type DuplicateRecipeState = {
  source: LocationRecipeSummary;
  locationId: string;
  tier: PackTierValue | "";
  name: string;
};

function sameSelection(selection: InventorySelectionSummary | null, selectedIds: Set<string>) {
  if (!selection || selection.ids.length !== selectedIds.size) {
    return false;
  }
  return selection.ids.every((id) => selectedIds.has(id));
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatMinorToCurrencyInput(value: number) {
  return (value / 100).toFixed(2);
}

function parseCurrencyInputToMinor(value: string) {
  const normalized = value.replace(/[^0-9.]/g, "").trim();
  if (!normalized) {
    return 0;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Number.NaN;
  }

  return Math.round(parsed * 100);
}

function buildEmptyRecipeForm(): RecipeFormValue {
  return {
    name: "",
    category: "",
    tier: "",
    isActive: true,
    slabCardsPerPack: 1,
    bonusCardsPerPack: 2,
    bonusCardMaxValueInput: "3.00",
    notes: "",
    items: [],
  };
}

function buildPrefilledRecipeForm(
  category: CollectibleCategoryValue | "",
  tier: PackTierValue | ""
): RecipeFormValue {
  const next = buildEmptyRecipeForm();
  next.category = category;
  next.tier = tier;
  next.name = category && tier ? buildPackDefinitionName(category, tier) : "";
  return next;
}

function buildRecipeFormItem(item: LocationRecipeSummary["items"][number]): RecipeFormItemValue {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? "",
    itemType: item.itemType,
    quantity: item.quantity,
    costPerUnitInput: formatMinorToCurrencyInput(item.costPerUnit),
    isSeasonal: item.isSeasonal,
    seasonStart: item.seasonStart ? item.seasonStart.slice(0, 10) : "",
    seasonEnd: item.seasonEnd ? item.seasonEnd.slice(0, 10) : "",
    isActive: item.isActive,
  };
}

function buildRecipeEditForm(recipe: LocationRecipeSummary): RecipeFormValue {
  return {
    name: recipe.name,
    category: recipe.category as CollectibleCategoryValue,
    tier: recipe.tier as PackTierValue,
    isActive: recipe.isActive,
    slabCardsPerPack: recipe.slabCardsPerPack,
    bonusCardsPerPack: recipe.bonusCardsPerPack,
    bonusCardMaxValueInput: formatMinorToCurrencyInput(recipe.bonusCardMaxValue),
    notes: recipe.notes ?? "",
    items: recipe.items.map(buildRecipeFormItem),
  };
}

function serializeRecipeForm(value: RecipeFormValue) {
  return {
    name: value.name.trim(),
    category: value.category,
    tier: value.tier,
    isActive: value.isActive,
    slabCardsPerPack: value.slabCardsPerPack,
    bonusCardsPerPack: value.bonusCardsPerPack,
    bonusCardMaxValue: parseCurrencyInputToMinor(value.bonusCardMaxValueInput),
    notes: value.notes.trim() || undefined,
    items: value.items.map((item, index) => ({
      ...(item.id ? { id: item.id } : {}),
      name: item.name.trim(),
      description: item.description.trim() || undefined,
      itemType: item.itemType,
      quantity: item.quantity,
      costPerUnit: parseCurrencyInputToMinor(item.costPerUnitInput),
      isSeasonal: item.isSeasonal,
      seasonStart: item.isSeasonal && item.seasonStart ? item.seasonStart : undefined,
      seasonEnd: item.isSeasonal && item.seasonEnd ? item.seasonEnd : undefined,
      isActive: item.isActive,
      sortOrder: index,
    })),
  };
}

function resolveDefaultDuplicateTier(
  source: LocationRecipeSummary,
  recipes: LocationRecipeSummary[],
  locationId: string
): PackTierValue | "" {
  const usedTiers = new Set(
    recipes
      .filter((recipe) => recipe.locationId === locationId && recipe.category === source.category)
      .map((recipe) => recipe.tier as PackTierValue)
  );

  return (
    PACK_TIER_OPTIONS.find((option) => !usedTiers.has(option.value))?.value ??
    (source.tier as PackTierValue) ??
    ""
  );
}

function ProgressBar({ packedCount, totalCount }: { packedCount: number; totalCount: number }) {
  const percent = totalCount > 0 ? Math.round((packedCount / totalCount) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-slate-500">
        <span>Packing Progress</span>
        <span>
          {packedCount}/{totalCount} packed
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/8">
        <div className="h-2 rounded-full bg-gold-400 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function AssignedLocationDetailPage() {
  const router = useRouter();
  const { locationId } = router.query;
  const { session, loading, ensureSession, logout } = useSession();
  const [activeTab, setActiveTab] = useState<DetailTab>("cards");
  const [detail, setDetail] = useState<AssignedLocationDetailResponse | null>(null);
  const [filterOptions, setFilterOptions] = useState<InventoryFilterOptionsResponse | null>(null);
  const [recipes, setRecipes] = useState<LocationRecipeSummary[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [recipesNonce, setRecipesNonce] = useState(0);
  const [recipeFormMode, setRecipeFormMode] = useState<"create" | "edit" | null>(null);
  const [recipeFormInitial, setRecipeFormInitial] = useState<RecipeFormValue>(buildEmptyRecipeForm);
  const [recipeEditing, setRecipeEditing] = useState<LocationRecipeSummary | null>(null);
  const [recipeSubmitBusy, setRecipeSubmitBusy] = useState(false);
  const [recipeSubmitError, setRecipeSubmitError] = useState<string | null>(null);
  const [recipeActionBusy, setRecipeActionBusy] = useState<{
    recipeId: string;
    action: "toggle" | "duplicate" | "delete";
  } | null>(null);
  const [duplicateState, setDuplicateState] = useState<DuplicateRecipeState | null>(null);
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedMeta, setSelectedMeta] = useState<Record<string, SelectedCardMeta>>({});
  const [bulkSelection, setBulkSelection] = useState<InventorySelectionSummary | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [transitionBusy, setTransitionBusy] = useState<string | null>(null);
  const [returnBusy, setReturnBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);
  const queryState = useMemo(
    () => parseInventoryQueryState(router.query as Record<string, string | string[] | undefined>),
    [router.query]
  );
  const selectionScopeKey = useMemo(
    () =>
      JSON.stringify({
        batchId: queryState.batchId,
        category: queryState.category,
        subCategory: queryState.subCategory,
        minPrice: queryState.minPrice,
        maxPrice: queryState.maxPrice,
        year: queryState.year,
        brand: queryState.brand,
        parallel: queryState.parallel,
        search: queryState.search,
      }),
    [
      queryState.batchId,
      queryState.brand,
      queryState.category,
      queryState.maxPrice,
      queryState.minPrice,
      queryState.parallel,
      queryState.search,
      queryState.subCategory,
      queryState.year,
    ]
  );

  const syncQuery = async (patch: Partial<InventoryQueryState>) => {
    if (!locationId || typeof locationId !== "string") {
      return;
    }
    const next: InventoryQueryState = {
      ...queryState,
      ...patch,
    };
    await router.push(
      {
        pathname: `/admin/assigned-locations/${locationId}`,
        query: buildInventoryQueryState(next),
      },
      undefined,
      { shallow: true }
    );
  };

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkSelection(null);
  }, [selectionScopeKey]);

  useEffect(() => {
    const tab = typeof router.query.tab === "string" ? router.query.tab : null;
    if (tab === "recipes") {
      setActiveTab("recipes");
      return;
    }
    if (tab === "cards") {
      setActiveTab("cards");
    }
  }, [router.query.tab]);

  useEffect(() => {
    if (!session?.token || !isAdmin || typeof locationId !== "string") {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set("locationId", locationId);
    if (queryState.batchId) {
      params.set("batchId", queryState.batchId);
    }

    setLoadingData(true);
    Promise.all([
      fetch(`/api/admin/assigned-locations/${locationId}?${new URLSearchParams(buildInventoryQueryState(queryState)).toString()}`, {
        headers: adminHeaders,
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(response.status === 404 ? "Location not found" : "Failed to load assigned location");
        }
        return (await response.json()) as AssignedLocationDetailResponse;
      }),
      fetch(`/api/admin/inventory/filter-options?${params.toString()}`, {
        headers: adminHeaders,
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load filter options");
        }
        return (await response.json()) as InventoryFilterOptionsResponse;
      }),
    ])
      .then(([detailPayload, optionsPayload]) => {
        setDetail(detailPayload);
        setFilterOptions(optionsPayload);
        setSelectedMeta((current) => {
          const next = { ...current };
          detailPayload.cards.forEach((card) => {
            next[card.id] = {
              valuationMinor: card.valuationMinor,
              category: card.category,
              frontPhotoUrl: card.frontPhotoUrl,
            };
          });
          return next;
        });
        setError(null);
      })
      .catch((fetchError: unknown) => {
        if ((fetchError as Error).name === "AbortError") {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load location");
      })
      .finally(() => setLoadingData(false));

    return () => controller.abort();
  }, [adminHeaders, isAdmin, locationId, queryState, refreshNonce, session?.token]);

  useEffect(() => {
    if (!session?.token || !isAdmin || typeof locationId !== "string") {
      return;
    }

    const controller = new AbortController();
    setRecipesLoading(true);

    fetch(`/api/admin/locations/${locationId}/recipes`, {
      headers: adminHeaders,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { message?: string };
          throw new Error(payload.message ?? "Failed to load recipes");
        }
        return (await response.json()) as LocationRecipesResponse;
      })
      .then((payload) => {
        setRecipes(payload.recipes);
        setRecipesError(null);
      })
      .catch((fetchError: unknown) => {
        if ((fetchError as Error).name === "AbortError") {
          return;
        }
        setRecipesError(fetchError instanceof Error ? fetchError.message : "Failed to load recipes");
      })
      .finally(() => setRecipesLoading(false));

    return () => controller.abort();
  }, [adminHeaders, isAdmin, locationId, recipesNonce, session?.token]);

  const bulkSelectionActive = useMemo(() => sameSelection(bulkSelection, selectedIds), [bulkSelection, selectedIds]);
  const selectedTotalValue = useMemo(() => {
    if (bulkSelectionActive && bulkSelection) {
      return bulkSelection.totalValue;
    }
    let total = 0;
    selectedIds.forEach((id) => {
      total += selectedMeta[id]?.valuationMinor ?? 0;
    });
    return total;
  }, [bulkSelection, bulkSelectionActive, selectedIds, selectedMeta]);

  const activeBatch = useMemo(
    () => detail?.batches.find((batch) => batch.id === detail.activeBatchId) ?? null,
    [detail]
  );
  const availableDuplicateLocations = useMemo(
    () => filterOptions?.locations ?? (detail ? [{ id: detail.location.id, name: detail.location.name }] : []),
    [detail, filterOptions]
  );
  const selectedPhotoUrl = useMemo(() => {
    for (const id of selectedIds) {
      const url = selectedMeta[id]?.frontPhotoUrl;
      if (url) {
        return url;
      }
    }
    return null;
  }, [selectedIds, selectedMeta]);

  const openCreateRecipe = () => {
    setRecipeFormMode("create");
    setRecipeEditing(null);
    setRecipeFormInitial(buildEmptyRecipeForm());
    setRecipeSubmitError(null);
  };

  useEffect(() => {
    if (!router.isReady || typeof locationId !== "string") {
      return;
    }

    if (router.query.createRecipe !== "1") {
      return;
    }

    const categoryQuery = typeof router.query.category === "string" ? router.query.category : "";
    const tierQuery = typeof router.query.tier === "string" ? router.query.tier : "";
    const category = COLLECTIBLE_CATEGORY_VALUES.includes(categoryQuery as CollectibleCategoryValue)
      ? (categoryQuery as CollectibleCategoryValue)
      : "";
    const tier = PACK_TIER_OPTIONS.some((option) => option.value === tierQuery)
      ? (tierQuery as PackTierValue)
      : "";

    setActiveTab("recipes");
    setRecipeFormMode("create");
    setRecipeEditing(null);
    setRecipeFormInitial(buildPrefilledRecipeForm(category, tier));
    setRecipeSubmitError(null);

    const nextQuery = { ...router.query };
    delete nextQuery.locationId;
    delete nextQuery.createRecipe;
    delete nextQuery.category;
    delete nextQuery.tier;
    nextQuery.tab = "recipes";

    void router.replace(
      {
        pathname: `/admin/assigned-locations/${locationId}`,
        query: nextQuery,
      },
      undefined,
      { shallow: true }
    );
  }, [locationId, router]);

  const openEditRecipe = (recipe: LocationRecipeSummary) => {
    setRecipeFormMode("edit");
    setRecipeEditing(recipe);
    setRecipeFormInitial(buildRecipeEditForm(recipe));
    setRecipeSubmitError(null);
  };

  const closeRecipeForm = () => {
    setRecipeFormMode(null);
    setRecipeEditing(null);
    setRecipeSubmitBusy(false);
    setRecipeSubmitError(null);
  };

  const handleRecipeSubmit = async (value: RecipeFormValue) => {
    if (typeof locationId !== "string") {
      return;
    }

    const body = serializeRecipeForm(value);
    if (Number.isNaN(body.bonusCardMaxValue) || body.items.some((item) => Number.isNaN(item.costPerUnit))) {
      setRecipeSubmitError("Currency values must be valid positive amounts.");
      return;
    }

    setRecipeSubmitBusy(true);
    setRecipeSubmitError(null);

    try {
      const isEdit = recipeFormMode === "edit" && recipeEditing;
      const response = await fetch(
        isEdit ? `/api/admin/recipes/${recipeEditing.id}` : `/api/admin/locations/${locationId}/recipes`,
        {
          method: isEdit ? "PUT" : "POST",
          headers: {
            ...adminHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to save recipe");
      }

      closeRecipeForm();
      setNotice(isEdit ? "Recipe updated" : "Recipe created");
      setRecipesNonce((value) => value + 1);
    } catch (fetchError) {
      setRecipeSubmitError(fetchError instanceof Error ? fetchError.message : "Failed to save recipe");
    } finally {
      setRecipeSubmitBusy(false);
    }
  };

  const handleToggleRecipe = async (recipe: LocationRecipeSummary) => {
    setRecipeActionBusy({ recipeId: recipe.id, action: "toggle" });
    try {
      const response = await fetch(`/api/admin/recipes/${recipe.id}`, {
        method: "PUT",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isActive: !recipe.isActive }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to update recipe");
      }

      setNotice(recipe.isActive ? "Recipe deactivated" : "Recipe activated");
      setRecipesNonce((value) => value + 1);
    } catch (fetchError) {
      setRecipesError(fetchError instanceof Error ? fetchError.message : "Failed to update recipe");
    } finally {
      setRecipeActionBusy(null);
    }
  };

  const handleDeleteRecipe = async (recipe: LocationRecipeSummary) => {
    if (!window.confirm(`Delete recipe "${recipe.name}"? This cannot be undone.`)) {
      return;
    }

    setRecipeActionBusy({ recipeId: recipe.id, action: "delete" });
    try {
      const response = await fetch(`/api/admin/recipes/${recipe.id}`, {
        method: "DELETE",
        headers: adminHeaders,
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to delete recipe");
      }

      setNotice("Recipe deleted");
      setRecipesNonce((value) => value + 1);
    } catch (fetchError) {
      setRecipesError(fetchError instanceof Error ? fetchError.message : "Failed to delete recipe");
    } finally {
      setRecipeActionBusy(null);
    }
  };

  const openDuplicateRecipe = (recipe: LocationRecipeSummary) => {
    setDuplicateState({
      source: recipe,
      locationId: recipe.locationId,
      tier: resolveDefaultDuplicateTier(recipe, recipes, recipe.locationId),
      name: `${recipe.name} (Copy)`,
    });
    setDuplicateError(null);
  };

  const closeDuplicateRecipe = () => {
    setDuplicateState(null);
    setDuplicateBusy(false);
    setDuplicateError(null);
  };

  const handleDuplicateRecipe = async () => {
    if (!duplicateState) {
      return;
    }

    if (!duplicateState.locationId || !duplicateState.tier || !duplicateState.name.trim()) {
      setDuplicateError("Target location, tier, and name are required.");
      return;
    }

    setDuplicateBusy(true);
    setDuplicateError(null);
    setRecipeActionBusy({ recipeId: duplicateState.source.id, action: "duplicate" });

    try {
      const response = await fetch(`/api/admin/recipes/${duplicateState.source.id}/duplicate`, {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId: duplicateState.locationId,
          tier: duplicateState.tier,
          name: duplicateState.name.trim(),
        }),
      });

      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to duplicate recipe");
      }

      closeDuplicateRecipe();
      setNotice("Recipe duplicated");
      setRecipesNonce((value) => value + 1);
    } catch (fetchError) {
      setDuplicateError(fetchError instanceof Error ? fetchError.message : "Failed to duplicate recipe");
    } finally {
      setDuplicateBusy(false);
      setRecipeActionBusy(null);
    }
  };

  const toggleCard = (cardId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
    setBulkSelection(null);
  };

  const handleSelectAll = async () => {
    if (!locationId || typeof locationId !== "string") {
      return;
    }

    if (bulkSelectionActive) {
      setSelectedIds(new Set());
      setBulkSelection(null);
      return;
    }

    const params = new URLSearchParams(buildInventoryQueryState(queryState));
    params.set("includeSelection", "1");

    try {
      const response = await fetch(`/api/admin/assigned-locations/${locationId}?${params.toString()}`, {
        headers: adminHeaders,
      });
      if (!response.ok) {
        throw new Error("Failed to load selection");
      }
      const payload = (await response.json()) as AssignedLocationDetailResponse;
      if (!payload.selection) {
        throw new Error("Selection payload missing from response");
      }
      setSelectedIds(new Set(payload.selection.ids));
      setBulkSelection(payload.selection);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to select cards");
    }
  };

  const handleTransition = async (newStage: "SHIPPED" | "LOADED") => {
    if (!locationId || typeof locationId !== "string" || !activeBatch) {
      return;
    }

    setTransitionBusy(newStage);
    try {
      const response = await fetch(`/api/admin/assigned-locations/${locationId}/transition`, {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          batchId: activeBatch.id,
          newStage,
        }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to update batch stage");
      }
      setNotice(`Batch moved to ${newStage}`);
      setRefreshNonce((value) => value + 1);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to update batch");
    } finally {
      setTransitionBusy(null);
    }
  };

  const handleReturnToInventory = async () => {
    if (!locationId || typeof locationId !== "string" || selectedIds.size === 0) {
      return;
    }
    if (!window.confirm(`Return ${selectedIds.size} cards to inventory?`)) {
      return;
    }

    setReturnBusy(true);
    try {
      const response = await fetch(`/api/admin/assigned-locations/${locationId}/return`, {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cardIds: [...selectedIds] }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to return cards");
      }
      setSelectedIds(new Set());
      setBulkSelection(null);
      setNotice(`${selectedIds.size} cards returned to inventory`);
      setRefreshNonce((value) => value + 1);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to return cards");
    } finally {
      setReturnBusy(false);
    }
  };

  const handleExportCsv = async () => {
    if (!locationId || typeof locationId !== "string") {
      return;
    }

    setExportBusy(true);
    try {
      let page = 1;
      const pageSize = 100;
      const rows: InventoryCardSummary[] = [];
      let totalPages = 1;

      while (page <= totalPages) {
        const params = new URLSearchParams(
          buildInventoryQueryState({
            ...queryState,
            page,
            pageSize,
          })
        );
        const response = await fetch(`/api/admin/assigned-locations/${locationId}?${params.toString()}`, {
          headers: adminHeaders,
        });
        if (!response.ok) {
          throw new Error("Failed to export cards");
        }
        const payload = (await response.json()) as AssignedLocationDetailResponse;
        rows.push(...payload.cards);
        totalPages = payload.pagination.totalPages;
        page += 1;
      }

      downloadCsv(
        `${detail?.location.slug ?? "assigned-location"}-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          ["Card ID", "Player", "Set", "Year", "Brand", "Card Number", "Parallel", "Category", "Sub-Category", "Value", "Batch"],
          ...rows.map((card) => [
            card.id,
            card.playerName ?? "",
            card.setName ?? "",
            card.year ?? "",
            card.brand ?? "",
            card.cardNumber ?? "",
            card.parallel ?? "base",
            card.category ?? "",
            card.subCategory ?? "",
            String(card.valuationMinor ?? ""),
            card.inventoryBatch?.label ?? "",
          ]),
        ]
      );
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to export CSV");
    } finally {
      setExportBusy(false);
    }
  };

  const gate = (() => {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-500">Checking access...</p>
        </div>
      );
    }
    if (!session) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
        </div>
      );
    }
    if (!isAdmin) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-8 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
          >
            Sign Out
          </button>
        </div>
      );
    }
    return null;
  })();

  if (gate) {
    return (
      <AppShell>
        <Head>
          <title>Ten Kings · Assigned Location</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  const canMarkShipped = Boolean(activeBatch && activeBatch.stage === "ASSIGNED" && !detail?.location.isOnline);
  const canMarkLoaded = Boolean(
    activeBatch &&
      ((activeBatch.stage === "ASSIGNED" && detail?.location.isOnline) || activeBatch.stage === "SHIPPED")
  );

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Assigned Location</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/admin/assigned-locations"
          backLabel="← Assigned Locations"
          eyebrow="Inventory Routing"
          title={detail?.location.name ?? "Assigned Location"}
          description={
            detail ? (
              <>
                {detail.location.address} · {detail.location.isOnline ? "Online distribution flow" : "Physical location flow"}
              </>
            ) : (
              "Loading location details..."
            )
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => handleTransition("SHIPPED")}
                disabled={!canMarkShipped || transitionBusy !== null}
                className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {transitionBusy === "SHIPPED" ? "Marking..." : "Mark as Shipped"}
              </button>
              <button
                type="button"
                onClick={() => handleTransition("LOADED")}
                disabled={!canMarkLoaded || transitionBusy !== null}
                className="rounded-full border border-gold-400/45 bg-gold-500 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {transitionBusy === "LOADED" ? "Marking..." : "Mark as Loaded"}
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={exportBusy}
                className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {exportBusy ? "Exporting..." : "Export CSV"}
              </button>
            </>
          }
        />

        {notice ? (
          <section className={adminPanelClass("border-emerald-400/25 bg-emerald-500/10 p-4")}>
            <p className="text-sm text-emerald-100">{notice}</p>
          </section>
        ) : null}

        {error ? (
          <section className={adminPanelClass("border-rose-400/25 bg-rose-500/10 p-4")}>
            <p className="text-sm text-rose-200">{error}</p>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-4">
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Cards</p>
            <p className="mt-3 text-3xl font-semibold text-white">{detail?.stats.cardCount ?? 0}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Value</p>
            <p className="mt-3 text-3xl font-semibold text-emerald-300">
              {formatCurrencyFromMinor(detail?.stats.totalValue ?? 0)}
            </p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Stage</p>
            <p className="mt-3 text-3xl font-semibold text-white">{detail?.stats.primaryStage ?? "N/A"}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <ProgressBar
              packedCount={detail?.stats.packingProgress.packedCount ?? 0}
              totalCount={detail?.stats.packingProgress.totalCount ?? 0}
            />
          </article>
        </section>

        <section className={adminPanelClass("p-4 md:p-5")}>
          <div className="flex flex-col gap-5">
            <nav className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-500">
              <Link href="/admin/inventory" className="transition hover:text-white">
                Inventory
              </Link>
              <span>-&gt;</span>
              <Link href="/admin/assigned-locations" className="transition hover:text-white">
                Assigned Locations
              </Link>
              <span>-&gt;</span>
              <span className="text-white">{detail?.location.name ?? "Location"}</span>
            </nav>

            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Pack Flow</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("cards")}
                      className={[
                        "rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition",
                        activeTab === "cards"
                          ? "border-gold-400/45 bg-gold-500/15 text-gold-100"
                          : "border-white/12 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-white",
                      ].join(" ")}
                    >
                      Cards
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("recipes")}
                      className={[
                        "rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition",
                        activeTab === "recipes"
                          ? "border-gold-400/45 bg-gold-500/15 text-gold-100"
                          : "border-white/12 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-white",
                      ].join(" ")}
                    >
                      Recipes
                    </button>
                    {activeBatch ? (
                      <Link
                        href={`/admin/batches/${activeBatch.id}/print-slips`}
                        className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/25 hover:text-white"
                      >
                        Packing Slips
                      </Link>
                    ) : (
                      <span className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        Packing Slips
                      </span>
                    )}
                  </div>
                </div>

                <details className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                  <summary className="cursor-pointer list-none text-[11px] uppercase tracking-[0.24em] text-white">
                    How Packing Works
                  </summary>
                  <ol className="mt-3 space-y-2 text-sm text-slate-300">
                    <li>1. Configure pack recipes here in the Recipes tab so this location is ready before cards arrive.</li>
                    <li>2. Assign cards to a location on the Inventory page when inventory is ready.</li>
                    <li>3. Open Packing Slips to print the instructions your packers follow once a batch exists.</li>
                    <li>
                      4. Pack and ship through the existing{" "}
                      <Link href="/admin/packing" className="text-gold-200 transition hover:text-white">
                        packing flow
                      </Link>
                      .
                    </li>
                  </ol>
                </details>
              </div>

              <div className="flex flex-col gap-3 xl:items-end">
                {activeBatch ? (
                  <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                    <span className="rounded-full border border-white/10 px-3 py-2">{activeBatch.stage}</span>
                    {activeBatch.category ? (
                      <span className="rounded-full border border-white/10 px-3 py-2">
                        {formatCategoryLabel(activeBatch.category)}
                      </span>
                    ) : null}
                    {activeBatch.tier ? (
                      <span className="rounded-full border border-white/10 px-3 py-2">
                        {formatPackTierLabel(activeBatch.tier)}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-white/10 px-3 py-2">
                      {activeBatch.cardCount} Cards
                    </span>
                  </div>
                ) : (
                  <p className="max-w-sm text-sm text-slate-400">
                    Create recipes now, then assign cards from Inventory when stock arrives to unlock packing slips.
                  </p>
                )}
                {activeBatch ? (
                  <Link
                    href={`/admin/batches/${activeBatch.id}/print-slips`}
                    className="rounded-full border border-gold-400/45 bg-gold-500 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400"
                  >
                    Print Packing Slips
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {activeTab === "cards" ? (
          <>
            <section className={adminPanelClass("p-4 md:p-5")}>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void syncQuery({ batchId: null, page: 1 })}
                  className={[
                    "rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition",
                    detail?.activeBatchId == null
                      ? "border-gold-400/45 bg-gold-500/15 text-gold-100"
                      : "border-white/12 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-white",
                  ].join(" ")}
                >
                  All Batches
                </button>
                {detail?.batches.map((batch) => (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => void syncQuery({ batchId: batch.id, page: 1 })}
                    className={[
                      "rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition",
                      detail.activeBatchId === batch.id
                        ? "border-gold-400/45 bg-gold-500/15 text-gold-100"
                        : "border-white/12 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-white",
                    ].join(" ")}
                  >
                    {(batch.label ?? "Unnamed Batch").slice(0, 36)}
                  </button>
                ))}
              </div>
            </section>

            <FilterBar
              filters={queryState}
              filterOptions={filterOptions}
              loading={loadingData}
              onChange={(patch) => {
                void syncQuery({
                  ...patch,
                  page: patch.page ?? 1,
                });
              }}
            />

            {selectedIds.size > 0 ? (
              <SelectionBar
                selectedCount={selectedIds.size}
                totalValue={selectedTotalValue}
                selectAllLabel={
                  bulkSelectionActive
                    ? `All ${selectedIds.size} matching selected`
                    : `Select All ${detail?.pagination.totalCount ?? 0} Matching`
                }
                onSelectAll={handleSelectAll}
                onClearSelection={() => {
                  setSelectedIds(new Set());
                  setBulkSelection(null);
                }}
                actions={[
                  {
                    id: "return",
                    label: returnBusy ? "Returning..." : "Return to Inventory",
                    onClick: handleReturnToInventory,
                    disabled: returnBusy,
                  },
                  {
                    id: "details",
                    label: "View Details",
                    onClick: () => {
                      if (selectedPhotoUrl) {
                        window.open(selectedPhotoUrl, "_blank", "noopener,noreferrer");
                      }
                    },
                    disabled: !selectedPhotoUrl,
                  },
                ]}
              />
            ) : null}

            <CardGrid
              cards={detail?.cards ?? []}
              selectedIds={selectedIds}
              loading={loadingData}
              onToggleCard={toggleCard}
              emptyState={
                <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                  <h2 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">
                    No cards match this view
                  </h2>
                  <p className="max-w-xl text-sm text-slate-400">
                    Adjust the batch tabs or filters to find cards assigned to this location.
                  </p>
                  <Link
                    href="/admin/inventory"
                    className="rounded-full border border-gold-400/45 px-5 py-3 text-[11px] uppercase tracking-[0.24em] text-gold-100 transition hover:border-gold-300 hover:text-white"
                  >
                    Back to Inventory
                  </Link>
                </div>
              }
            />

            {detail ? (
              <PaginationBar
                page={detail.pagination.page}
                pageSize={detail.pagination.pageSize}
                totalCount={detail.pagination.totalCount}
                totalPages={detail.pagination.totalPages}
                onChange={(page) => void syncQuery({ page })}
              />
            ) : null}
          </>
        ) : (
          <section className={adminPanelClass("p-5 md:p-6")}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Per-Location Recipes</p>
                <h2 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">
                  Configure pack contents for this location
                </h2>
                <p className="max-w-3xl text-sm text-slate-300">
                  Recipes define the per-pack slab and bonus card expectations plus any dynamic extras for this
                  location. Packing slips and future pack-calculator flows read from this configuration.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateRecipe}
                className="rounded-full border border-gold-400/45 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400"
              >
                + Create Recipe
              </button>
            </div>

            {recipesError ? (
              <div className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {recipesError}
              </div>
            ) : null}

            {recipesLoading ? (
              <div className="mt-6 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-4 py-8 text-sm text-slate-400">
                Loading recipes...
              </div>
            ) : recipes.length > 0 ? (
              <div className="mt-6 space-y-5">
                {recipes.map((recipe) => (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    matchingBatchCount={
                      detail?.batches.filter(
                        (batch) => batch.category === recipe.category && batch.tier === recipe.tier
                      ).length ?? 0
                    }
                    busyAction={
                      recipeActionBusy?.recipeId === recipe.id ? recipeActionBusy.action : null
                    }
                    onEdit={() => openEditRecipe(recipe)}
                    onDuplicate={() => openDuplicateRecipe(recipe)}
                    onToggleActive={() => void handleToggleRecipe(recipe)}
                    onDelete={() => void handleDeleteRecipe(recipe)}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-[28px] border border-amber-400/25 bg-amber-500/10 px-6 py-10">
                <p className="text-[11px] uppercase tracking-[0.24em] text-amber-100">Recipe Setup Needed</p>
                <h2 className="mt-3 font-heading text-3xl uppercase tracking-[0.12em] text-white">
                  No pack recipe configured for this location
                </h2>
                <p className="mt-3 max-w-2xl text-sm text-slate-200">
                  Pack recipes define what goes into each pack, including card counts, bonus cards, and extra items
                  like promo tickets or merch. Create one here before your team starts printing packing slips.
                </p>
                {detail?.batches.length ? (
                  <p className="mt-3 text-sm text-amber-100">
                    This location already has {detail.batches.length} batch{detail.batches.length === 1 ? "" : "es"} waiting on recipe guidance.
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-amber-100">
                    This location has no cards assigned yet, but you can build recipes now so operators are ready before the first batch lands.
                  </p>
                )}
                <button
                  type="button"
                  onClick={openCreateRecipe}
                  className="mt-6 rounded-full border border-gold-400/45 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.24em] text-night-950 transition hover:bg-gold-400"
                >
                  + Create Recipe
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {recipeFormMode ? (
        <RecipeForm
          mode={recipeFormMode}
          locationName={detail?.location.name ?? "Assigned Location"}
          initialValue={recipeFormInitial}
          busy={recipeSubmitBusy}
          error={recipeSubmitError}
          onClose={closeRecipeForm}
          onSubmit={(value) => void handleRecipeSubmit(value)}
        />
      ) : null}

      {duplicateState ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[30px] border border-white/10 bg-night-900 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Duplicate Recipe</p>
                <h2 className="font-heading text-2xl uppercase tracking-[0.12em] text-white">
                  Duplicate {duplicateState.source.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDuplicateRecipe}
                className="rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/25 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4">
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Recipe Name</span>
                <input
                  value={duplicateState.name}
                  onChange={(event) =>
                    setDuplicateState((current) =>
                      current ? { ...current, name: event.currentTarget.value } : current
                    )
                  }
                  className={adminInputClass()}
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Target Location</span>
                <select
                  value={duplicateState.locationId}
                  onChange={(event) =>
                    setDuplicateState((current) =>
                      current
                        ? {
                            ...current,
                            locationId: event.currentTarget.value,
                            tier: resolveDefaultDuplicateTier(
                              current.source,
                              recipes,
                              event.currentTarget.value
                            ),
                          }
                        : current
                    )
                  }
                  className={adminSelectClass()}
                >
                  <option value="">Select location</option>
                  {availableDuplicateLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Target Tier</span>
                <select
                  value={duplicateState.tier}
                  onChange={(event) =>
                    setDuplicateState((current) =>
                      current
                        ? { ...current, tier: event.currentTarget.value as PackTierValue }
                        : current
                    )
                  }
                  className={adminSelectClass()}
                >
                  <option value="">Select tier</option>
                  {PACK_TIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {duplicateError ? (
              <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {duplicateError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeDuplicateRecipe}
                className="rounded-full border border-white/12 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDuplicateRecipe()}
                disabled={duplicateBusy}
                className="rounded-full border border-gold-400/60 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {duplicateBusy ? "Duplicating..." : "Duplicate Recipe"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
