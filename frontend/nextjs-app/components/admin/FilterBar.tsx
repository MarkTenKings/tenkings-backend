import { useEffect, useState } from "react";
import {
  INVENTORY_SORT_OPTIONS,
  findPricePreset,
  type InventoryFilterOptionsResponse,
  type InventoryQueryState,
} from "../../lib/adminInventory";
import { adminInputClass, adminPanelClass, adminSelectClass } from "./AdminPrimitives";

type FilterBarProps = {
  filters: InventoryQueryState;
  filterOptions: InventoryFilterOptionsResponse | null;
  loading?: boolean;
  onChange: (patch: Partial<InventoryQueryState>) => void;
};

type MultiSelectMenuProps = {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
};

const minorToDollarInput = (value: string) => {
  if (!value) {
    return "";
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return (parsed / 100).toString();
};

const dollarInputToMinor = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "";
  }
  return String(Math.round(parsed * 100));
};

function MultiSelectMenu({ label, options, selected, onToggle }: MultiSelectMenuProps) {
  const summary = selected.length > 0 ? `${label}: ${selected.length}` : label;

  return (
    <details className="group relative min-w-[170px]">
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between rounded-xl border border-white/12 bg-black px-3 text-sm text-white outline-none transition hover:border-white/25">
        <span className="truncate">{summary}</span>
        <span className="text-slate-500 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="absolute left-0 top-[calc(100%+8px)] z-20 max-h-72 w-full overflow-auto rounded-2xl border border-white/12 bg-night-950/95 p-2 shadow-[0_18px_55px_rgba(0,0,0,0.5)] backdrop-blur">
        {options.length === 0 ? (
          <p className="px-3 py-2 text-sm text-slate-500">No options</p>
        ) : (
          options.map((option) => {
            const active = selected.includes(option);
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-200 transition hover:bg-white/[0.04]"
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => onToggle(option)}
                  className="h-4 w-4 rounded border-white/20 bg-black text-gold-400 focus:ring-gold-400"
                />
                <span className="truncate">{option}</span>
              </label>
            );
          })
        )}
      </div>
    </details>
  );
}

export function FilterBar({ filters, filterOptions, loading, onChange }: FilterBarProps) {
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [minDraft, setMinDraft] = useState(minorToDollarInput(filters.minPrice));
  const [maxDraft, setMaxDraft] = useState(minorToDollarInput(filters.maxPrice));

  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  useEffect(() => {
    setMinDraft(minorToDollarInput(filters.minPrice));
    setMaxDraft(minorToDollarInput(filters.maxPrice));
  }, [filters.minPrice, filters.maxPrice]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (searchDraft !== filters.search) {
        onChange({ search: searchDraft, page: 1 });
      }
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [filters.search, onChange, searchDraft]);

  const activePreset = findPricePreset(filters.minPrice, filters.maxPrice);
  const showSubCategory = filters.category.includes("SPORTS");

  const toggleValue = (key: "category" | "subCategory" | "year" | "brand" | "parallel", value: string) => {
    const current = filters[key];
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
    const patch: Partial<InventoryQueryState> = { [key]: next, page: 1 };
    if (key === "category" && !next.includes("SPORTS")) {
      patch.subCategory = [];
    }
    onChange(patch);
  };

  return (
    <section className={adminPanelClass("p-4 md:p-5")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid gap-3 md:grid-cols-2 xl:flex xl:flex-wrap">
            <MultiSelectMenu
              label="Category"
              options={filterOptions?.categories ?? []}
              selected={filters.category}
              onToggle={(value) => toggleValue("category", value)}
            />
            {showSubCategory ? (
              <MultiSelectMenu
                label="Sub-Category"
                options={filterOptions?.subCategories ?? []}
                selected={filters.subCategory}
                onToggle={(value) => toggleValue("subCategory", value)}
              />
            ) : null}
            <MultiSelectMenu
              label="Year"
              options={filterOptions?.years ?? []}
              selected={filters.year}
              onToggle={(value) => toggleValue("year", value)}
            />
            <MultiSelectMenu
              label="Brand"
              options={filterOptions?.brands ?? []}
              selected={filters.brand}
              onToggle={(value) => toggleValue("brand", value)}
            />
            <MultiSelectMenu
              label="Parallel"
              options={filterOptions?.parallels ?? []}
              selected={filters.parallel}
              onToggle={(value) => toggleValue("parallel", value)}
            />
            <select
              value={filters.sort}
              onChange={(event) => onChange({ sort: event.currentTarget.value as InventoryQueryState["sort"], page: 1 })}
              className={adminSelectClass("min-w-[210px]")}
            >
              {INVENTORY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-[280px] flex-1 items-center gap-3 xl:max-w-md">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.currentTarget.value)}
              placeholder="Search player, set, card number, brand"
              className={adminInputClass("w-full")}
            />
            {loading ? <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Loading</span> : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              { label: "$0-10", min: "0", max: "1000" },
              { label: "$10-25", min: "1000", max: "2500" },
              { label: "$25-50", min: "2500", max: "5000" },
              { label: "$50-100", min: "5000", max: "10000" },
              { label: "$100-250", min: "10000", max: "25000" },
              { label: "$250+", min: "25000", max: "" },
            ].map((preset) => {
              const active = activePreset?.label === preset.label;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onChange({ minPrice: preset.min, maxPrice: preset.max, page: 1 })}
                  className={[
                    "rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] transition",
                    active
                      ? "border-gold-400/50 bg-gold-500/15 text-gold-100"
                      : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white",
                  ].join(" ")}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={minDraft}
              onChange={(event) => setMinDraft(event.currentTarget.value)}
              onBlur={() => onChange({ minPrice: dollarInputToMinor(minDraft), page: 1 })}
              className={adminInputClass("w-[120px]")}
              placeholder="Min $"
              inputMode="decimal"
            />
            <input
              value={maxDraft}
              onChange={(event) => setMaxDraft(event.currentTarget.value)}
              onBlur={() => onChange({ maxPrice: dollarInputToMinor(maxDraft), page: 1 })}
              className={adminInputClass("w-[120px]")}
              placeholder="Max $"
              inputMode="decimal"
            />
            <button
              type="button"
              onClick={() => onChange({ minPrice: "", maxPrice: "", page: 1 })}
              className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white"
            >
              Reset Price
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
