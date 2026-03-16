import {
  CATEGORY_OPTIONS,
  PACK_TIER_OPTIONS,
  buildPackDefinitionName,
  formatCurrencyFromMinor,
  formatCategoryLabel,
  type CollectibleCategoryValue,
  type PackTierValue,
} from "../../lib/adminInventory";
import { adminInputClass, adminSelectClass, adminTextareaClass } from "./AdminPrimitives";

type AssignToLocationModalProps = {
  selectedCount: number;
  totalValue: number;
  selectedCategories: Array<{ category: string | null; count: number }>;
  locations: Array<{ id: string; name: string }>;
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

  const canAssign = Boolean(values.packCategory && values.packTier && values.locationId && !busy);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[30px] border border-white/10 bg-night-900 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
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

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Pack Category</span>
            <select
              value={values.packCategory}
              onChange={(event) => onChange({ packCategory: event.currentTarget.value as CollectibleCategoryValue })}
              className={adminSelectClass()}
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
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Pack Price</span>
            <select
              value={values.packTier}
              onChange={(event) => onChange({ packTier: event.currentTarget.value as PackTierValue })}
              className={adminSelectClass()}
            >
              <option value="">Select price</option>
              {PACK_TIER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200 md:col-span-2">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Location</span>
            <select
              value={values.locationId}
              onChange={(event) => onChange({ locationId: event.currentTarget.value })}
              className={adminSelectClass()}
            >
              <option value="">Select location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 rounded-[24px] border border-white/10 bg-black/45 p-4">
          <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-2">
            <p>Card Count: {selectedCount}</p>
            <p>Total Value: {formatCurrencyFromMinor(totalValue)}</p>
            <p>Avg Value / Card: {formatCurrencyFromMinor(averageValue)}</p>
            <p>
              Pack Definition:{" "}
              {values.packCategory && values.packTier
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
