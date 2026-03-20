import Link from "next/link";
import {
  buildPackDefinitionName,
  formatCurrencyFromMinor,
  formatCategoryLabel,
  formatPackTierLabel,
  type CollectibleCategoryValue,
  type PackTierValue,
} from "../../lib/adminInventory";
import { buildPackTypeDisplayName, packTypeMatchesSelection, type AdminPackType } from "../../lib/adminPackTypes";
import { adminTextareaClass } from "./AdminPrimitives";
import { PackTypeCard } from "./PackTypeCard";

type AssignToLocationModalProps = {
  selectedCount: number;
  totalValue: number;
  selectedCategories: Array<{ category: string | null; count: number }>;
  locations: Array<{ id: string; name: string }>;
  packTypes: AdminPackType[];
  packTypesLoading?: boolean;
  packTypesError?: string | null;
  values: {
    packCategory: CollectibleCategoryValue | "";
    packTier: PackTierValue | "";
    locationId: string;
    notes: string;
  };
  busy?: boolean;
  error?: string | null;
  onChange: (next: Partial<AssignToLocationModalProps["values"]>) => void;
  onClose: () => void;
  onAssign: () => void;
};

export function AssignToLocationModal({
  selectedCount,
  totalValue,
  selectedCategories,
  locations,
  packTypes,
  packTypesLoading,
  packTypesError,
  values,
  busy,
  error,
  onChange,
  onClose,
  onAssign,
}: AssignToLocationModalProps) {
  const averageValue = selectedCount > 0 ? Math.round(totalValue / selectedCount) : 0;
  const mismatchWarning =
    values.packCategory &&
    selectedCategories.some((entry) => entry.category && entry.category !== values.packCategory);
  const selectedPackType = packTypes.find((packType) => packTypeMatchesSelection(packType, values)) ?? null;

  const canAssign = Boolean(values.packCategory && values.packTier && values.locationId && !busy);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-5xl rounded-[30px] border border-white/10 bg-night-900 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Inventory Assignment</p>
            <h2 className="font-heading text-2xl uppercase tracking-[0.12em] text-white">
              Assign {selectedCount} Cards to Location
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/25 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Select Pack Type *</span>
              <Link
                href="/admin/pack-types"
                className="text-[11px] uppercase tracking-[0.22em] text-gold-200 transition hover:text-white"
              >
                Manage Pack Types →
              </Link>
            </div>

            {packTypesLoading ? (
              <div className="rounded-[24px] border border-white/10 bg-black/40 px-4 py-10 text-center text-sm text-slate-400">
                Loading pack types...
              </div>
            ) : packTypes.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-white/12 bg-black/35 px-4 py-10 text-center">
                <p className="font-heading text-xl uppercase tracking-[0.14em] text-white">No active pack types found</p>
                <p className="mt-2 text-sm text-slate-400">
                  Create or activate a pack type before assigning inventory to a location.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {packTypes.map((packType) => {
                  const selected = packTypeMatchesSelection(packType, values);
                  return (
                    <PackTypeCard
                      key={packType.id}
                      packType={packType}
                      mode="selector"
                      selected={selected}
                      onClick={() =>
                        onChange(
                          selected
                            ? { packCategory: "", packTier: "" }
                            : {
                                packCategory: packType.category,
                                packTier: packType.tier,
                              }
                        )
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>

          {selectedPackType ? (
            <div className="rounded-[24px] border border-gold-300/25 bg-gold-500/10 px-4 py-4">
              <p className="text-sm font-medium text-gold-50">Selected: {buildPackTypeDisplayName(selectedPackType)}</p>
              <p className="mt-2 text-sm text-slate-200">
                Pack Category: {formatCategoryLabel(selectedPackType.category)}{" "}
                <span className="text-slate-500">•</span> Pack Price: {formatPackTierLabel(selectedPackType.tier)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Auto-filled from the selected pack type above and sent to the existing assignment API unchanged.
              </p>
            </div>
          ) : (
            <div className="rounded-[24px] border border-white/10 bg-black/35 px-4 py-4 text-sm text-slate-400">
              Select a pack type to auto-fill the category and price for this assignment.
            </div>
          )}

          {packTypesError ? (
            <p className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {packTypesError}
            </p>
          ) : null}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Location</span>
            <select
              value={values.locationId}
              onChange={(event) => onChange({ locationId: event.currentTarget.value })}
              className="h-11 rounded-xl border border-white/12 bg-black px-3 text-sm text-white outline-none transition focus:border-white/40"
            >
              <option value="">Select location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-[24px] border border-white/10 bg-black/45 p-4">
            <div className="grid gap-3 text-sm text-slate-300">
            <p>Card Count: {selectedCount}</p>
            <p>Total Value: {formatCurrencyFromMinor(totalValue)}</p>
            <p>Avg Value / Card: {formatCurrencyFromMinor(averageValue)}</p>
            <p>
              Pack Definition:{" "}
              {selectedPackType
                ? buildPackTypeDisplayName(selectedPackType)
                : values.packCategory && values.packTier
                  ? buildPackDefinitionName(values.packCategory, values.packTier)
                : "Select category and tier"}
            </p>
          </div>
          {selectedCategories.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
              {selectedCategories.map((entry) => (
                <span key={`${entry.category ?? "unknown"}-${entry.count}`} className="rounded-full border border-white/10 px-2.5 py-1">
                  {formatCategoryLabel(entry.category)} · {entry.count}
                </span>
              ))}
            </div>
          ) : null}
          </div>
        </div>

        {mismatchWarning ? (
          <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Selected cards span multiple categories. Double-check the chosen pack category before assigning.
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <label className="mt-5 flex flex-col gap-2 text-sm text-slate-200">
          <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Notes</span>
          <textarea
            value={values.notes}
            onChange={(event) => onChange({ notes: event.currentTarget.value })}
            rows={4}
            className={adminTextareaClass("min-h-[112px] resize-y")}
            placeholder="Optional operator notes for this inventory batch"
          />
        </label>

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
            onClick={onAssign}
            disabled={!canAssign}
            className="rounded-full border border-gold-400/60 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Assigning..." : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}
