import { useEffect, useMemo, useState } from "react";
import { adminInputClass, adminSelectClass, adminTextareaClass } from "./AdminPrimitives";
import {
  PACK_RECIPE_ITEM_TYPE_VALUES,
  formatPackRecipeItemTypeLabel,
  type PackRecipeItemTypeValue,
} from "../../lib/adminPackRecipes";
import {
  CATEGORY_OPTIONS,
  PACK_TIER_OPTIONS,
  formatCurrencyFromMinor,
  type CollectibleCategoryValue,
  type PackTierValue,
} from "../../lib/adminInventory";

export type RecipeFormItemValue = {
  id?: string;
  name: string;
  description: string;
  itemType: PackRecipeItemTypeValue;
  quantity: number;
  costPerUnitInput: string;
  isSeasonal: boolean;
  seasonStart: string;
  seasonEnd: string;
  isActive: boolean;
};

export type RecipeFormValue = {
  name: string;
  category: CollectibleCategoryValue | "";
  tier: PackTierValue | "";
  isActive: boolean;
  slabCardsPerPack: number;
  bonusCardsPerPack: number;
  bonusCardMaxValueInput: string;
  notes: string;
  items: RecipeFormItemValue[];
};

type RecipeFormProps = {
  mode: "create" | "edit";
  locationName: string;
  initialValue: RecipeFormValue;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (value: RecipeFormValue) => void;
};

function createEmptyItem(): RecipeFormItemValue {
  return {
    name: "",
    description: "",
    itemType: "PROMOTIONAL",
    quantity: 1,
    costPerUnitInput: "0.00",
    isSeasonal: false,
    seasonStart: "",
    seasonEnd: "",
    isActive: true,
  };
}

function parseCurrencyInput(value: string) {
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

function formatAsDateInput(value: string) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function validateForm(value: RecipeFormValue) {
  if (!value.name.trim()) {
    return "Recipe name is required.";
  }
  if (!value.category) {
    return "Pack category is required.";
  }
  if (!value.tier) {
    return "Pack tier is required.";
  }
  if (!Number.isInteger(value.slabCardsPerPack) || value.slabCardsPerPack < 1) {
    return "Slab cards per pack must be at least 1.";
  }
  if (!Number.isInteger(value.bonusCardsPerPack) || value.bonusCardsPerPack < 0) {
    return "Bonus cards per pack cannot be negative.";
  }
  if (Number.isNaN(parseCurrencyInput(value.bonusCardMaxValueInput))) {
    return "Bonus card max value must be a valid currency amount.";
  }

  for (const item of value.items) {
    if (!item.name.trim()) {
      return "Each extra item must have a name.";
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return "Extra item quantity must be at least 1.";
    }
    if (Number.isNaN(parseCurrencyInput(item.costPerUnitInput))) {
      return `Cost per unit for "${item.name || "extra item"}" must be a valid currency amount.`;
    }
    if (item.isSeasonal && (!item.seasonStart || !item.seasonEnd)) {
      return `Seasonal item "${item.name || "extra item"}" must include both a start and end date.`;
    }
    if (item.isSeasonal && item.seasonStart && item.seasonEnd && item.seasonStart > item.seasonEnd) {
      return `Season end must be on or after the season start for "${item.name || "extra item"}".`;
    }
  }

  return null;
}

export function RecipeForm({
  mode,
  locationName,
  initialValue,
  busy = false,
  error,
  onClose,
  onSubmit,
}: RecipeFormProps) {
  const [value, setValue] = useState<RecipeFormValue>(initialValue);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    setValue(initialValue);
    setClientError(null);
  }, [initialValue]);

  const previewExtraCostPerPack = useMemo(() => {
    const now = new Date();

    return value.items.reduce((sum, item) => {
      if (!item.isActive) {
        return sum;
      }
      if (item.isSeasonal) {
        const start = item.seasonStart ? new Date(item.seasonStart) : null;
        const end = item.seasonEnd ? new Date(item.seasonEnd) : null;
        if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return sum;
        }
        if (now < start || now > end) {
          return sum;
        }
      }

      const costPerUnit = parseCurrencyInput(item.costPerUnitInput);
      if (Number.isNaN(costPerUnit)) {
        return sum;
      }
      return sum + costPerUnit * item.quantity;
    }, 0);
  }, [value.items]);

  const submit = () => {
    const validationError = validateForm(value);
    if (validationError) {
      setClientError(validationError);
      return;
    }

    setClientError(null);
    onSubmit(value);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[30px] border border-white/10 bg-night-900 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
              {mode === "create" ? "Create Recipe" : "Edit Recipe"}
            </p>
            <h2 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">
              {mode === "create" ? "New Pack Recipe" : value.name || "Update Pack Recipe"}
            </h2>
            <p className="max-w-2xl text-sm text-slate-300">
              Manage location-specific pack composition for <span className="text-white">{locationName}</span>.
              {mode === "edit" ? " Category and tier stay locked after creation; duplicate the recipe to branch it to another tier or location." : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/25 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Recipe Name</span>
            <input
              value={value.name}
              onChange={(event) => setValue((current) => ({ ...current, name: event.currentTarget.value }))}
              className={adminInputClass()}
              placeholder="Ex: Dallas Sports $50 Pack"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Status</span>
            <select
              value={value.isActive ? "active" : "inactive"}
              onChange={(event) =>
                setValue((current) => ({ ...current, isActive: event.currentTarget.value === "active" }))
              }
              className={adminSelectClass()}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Category</span>
            <select
              value={value.category}
              disabled={mode === "edit"}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  category: event.currentTarget.value as CollectibleCategoryValue,
                }))
              }
              className={adminSelectClass(mode === "edit" ? "opacity-70" : undefined)}
            >
              <option value="">Select category</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Pack Tier</span>
            <select
              value={value.tier}
              disabled={mode === "edit"}
              onChange={(event) =>
                setValue((current) => ({ ...current, tier: event.currentTarget.value as PackTierValue }))
              }
              className={adminSelectClass(mode === "edit" ? "opacity-70" : undefined)}
            >
              <option value="">Select tier</option>
              {PACK_TIER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Slab Cards / Pack</span>
            <input
              type="number"
              min={1}
              step={1}
              value={value.slabCardsPerPack}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  slabCardsPerPack: Number.parseInt(event.currentTarget.value || "1", 10) || 1,
                }))
              }
              className={adminInputClass()}
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Bonus Cards / Pack</span>
            <input
              type="number"
              min={0}
              step={1}
              value={value.bonusCardsPerPack}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  bonusCardsPerPack: Math.max(0, Number.parseInt(event.currentTarget.value || "0", 10) || 0),
                }))
              }
              className={adminInputClass()}
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200 lg:col-span-2">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Bonus Card Max Value</span>
            <input
              value={value.bonusCardMaxValueInput}
              onChange={(event) =>
                setValue((current) => ({ ...current, bonusCardMaxValueInput: event.currentTarget.value }))
              }
              className={adminInputClass()}
              placeholder="3.00"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200 lg:col-span-2">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Notes</span>
            <textarea
              value={value.notes}
              onChange={(event) => setValue((current) => ({ ...current, notes: event.currentTarget.value }))}
              rows={4}
              className={adminTextareaClass("min-h-[110px] resize-y")}
              placeholder="Optional packer notes, seasonal guidance, or handling instructions"
            />
          </label>
        </div>

        <div className="mt-8 rounded-[24px] border border-white/10 bg-black/45 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Extra Items</p>
              <p className="mt-1 text-sm text-slate-300">
                Add dynamic non-card items like promos, merch, and coupons. Seasonal windows and manual active toggles are respected at resolve time.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setValue((current) => ({
                  ...current,
                  items: [...current.items, createEmptyItem()],
                }))
              }
              className="rounded-full border border-gold-400/45 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-gold-100 transition hover:border-gold-300 hover:text-white"
            >
              Add Extra Item
            </button>
          </div>

          {value.items.length > 0 ? (
            <div className="mt-4 space-y-4">
              {value.items.map((item, index) => (
                <div key={`${item.id ?? "new"}-${index}`} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white">
                      Extra Item {index + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setValue((current) => ({
                          ...current,
                          items: current.items.filter((_, itemIndex) => itemIndex !== index),
                        }))
                      }
                      className="rounded-full border border-rose-400/30 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-rose-100 transition hover:border-rose-300/60 hover:text-white"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="flex flex-col gap-2 text-sm text-slate-200">
                      <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Name</span>
                      <input
                        value={item.name}
                        onChange={(event) =>
                          setValue((current) => ({
                            ...current,
                            items: current.items.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, name: event.currentTarget.value } : entry
                            ),
                          }))
                        }
                        className={adminInputClass()}
                        placeholder="Ex: Spring coupon insert"
                      />
                    </label>

                    <label className="flex flex-col gap-2 text-sm text-slate-200">
                      <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Type</span>
                      <select
                        value={item.itemType}
                        onChange={(event) =>
                          setValue((current) => ({
                            ...current,
                            items: current.items.map((entry, itemIndex) =>
                              itemIndex === index
                                ? { ...entry, itemType: event.currentTarget.value as PackRecipeItemTypeValue }
                                : entry
                            ),
                          }))
                        }
                        className={adminSelectClass()}
                      >
                        {PACK_RECIPE_ITEM_TYPE_VALUES.map((option) => (
                          <option key={option} value={option}>
                            {formatPackRecipeItemTypeLabel(option)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-2 text-sm text-slate-200">
                      <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Cost Per Unit</span>
                      <input
                        value={item.costPerUnitInput}
                        onChange={(event) =>
                          setValue((current) => ({
                            ...current,
                            items: current.items.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, costPerUnitInput: event.currentTarget.value } : entry
                            ),
                          }))
                        }
                        className={adminInputClass()}
                        placeholder="0.00"
                      />
                    </label>

                    <label className="flex flex-col gap-2 text-sm text-slate-200">
                      <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Quantity</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={item.quantity}
                        onChange={(event) =>
                          setValue((current) => ({
                            ...current,
                            items: current.items.map((entry, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...entry,
                                    quantity: Math.max(
                                      1,
                                      Number.parseInt(event.currentTarget.value || "1", 10) || 1
                                    ),
                                  }
                                : entry
                            ),
                          }))
                        }
                        className={adminInputClass()}
                      />
                    </label>

                    <label className="flex flex-col gap-2 text-sm text-slate-200 lg:col-span-2">
                      <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Description</span>
                      <input
                        value={item.description}
                        onChange={(event) =>
                          setValue((current) => ({
                            ...current,
                            items: current.items.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, description: event.currentTarget.value } : entry
                            ),
                          }))
                        }
                        className={adminInputClass()}
                        placeholder="Optional operator-facing description"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={item.isActive}
                        onChange={(event) =>
                          setValue((current) => ({
                            ...current,
                            items: current.items.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, isActive: event.currentTarget.checked } : entry
                            ),
                          }))
                        }
                        className="h-4 w-4 rounded border-white/20 bg-black text-gold-400"
                      />
                      Active item
                    </label>

                    <label className="flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={item.isSeasonal}
                        onChange={(event) =>
                          setValue((current) => ({
                            ...current,
                            items: current.items.map((entry, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...entry,
                                    isSeasonal: event.currentTarget.checked,
                                    seasonStart: event.currentTarget.checked ? entry.seasonStart : "",
                                    seasonEnd: event.currentTarget.checked ? entry.seasonEnd : "",
                                  }
                                : entry
                            ),
                          }))
                        }
                        className="h-4 w-4 rounded border-white/20 bg-black text-gold-400"
                      />
                      Seasonal window
                    </label>
                  </div>

                  {item.isSeasonal ? (
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <label className="flex flex-col gap-2 text-sm text-slate-200">
                        <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Season Start</span>
                        <input
                          type="date"
                          value={formatAsDateInput(item.seasonStart)}
                          onChange={(event) =>
                            setValue((current) => ({
                              ...current,
                              items: current.items.map((entry, itemIndex) =>
                                itemIndex === index ? { ...entry, seasonStart: event.currentTarget.value } : entry
                              ),
                            }))
                          }
                          className={adminInputClass()}
                        />
                      </label>

                      <label className="flex flex-col gap-2 text-sm text-slate-200">
                        <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Season End</span>
                        <input
                          type="date"
                          value={formatAsDateInput(item.seasonEnd)}
                          onChange={(event) =>
                            setValue((current) => ({
                              ...current,
                              items: current.items.map((entry, itemIndex) =>
                                itemIndex === index ? { ...entry, seasonEnd: event.currentTarget.value } : entry
                              ),
                            }))
                          }
                          className={adminInputClass()}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-4 py-6 text-sm text-slate-400">
              No extra items configured. Add one if this location includes promos, merch, or coupons in the pack.
            </div>
          )}
        </div>

        <div className="mt-6 rounded-[24px] border border-gold-400/20 bg-gold-500/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-gold-200">Cost Preview</p>
              <p className="mt-1 text-sm text-gold-50">
                Currently active extra items add {formatCurrencyFromMinor(previewExtraCostPerPack)} per pack.
              </p>
            </div>
            <p className="text-3xl font-semibold text-gold-100">
              {formatCurrencyFromMinor(previewExtraCostPerPack)}
            </p>
          </div>
        </div>

        {clientError || error ? (
          <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {clientError ?? error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/12 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-full border border-gold-400/60 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Saving..." : mode === "create" ? "Create Recipe" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
