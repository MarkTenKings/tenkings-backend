import { formatCurrencyFromMinor } from "../../lib/adminInventory";

type SelectionAction = {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
};

type SelectionBarProps = {
  selectedCount: number;
  totalValue: number;
  selectAllLabel?: string;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  actions: SelectionAction[];
};

function buttonClass(variant: SelectionAction["variant"]) {
  if (variant === "primary") {
    return "border-gold-400/60 bg-gold-500 px-4 text-night-950 hover:bg-gold-400";
  }
  if (variant === "danger") {
    return "border-rose-400/35 bg-rose-500/10 px-4 text-rose-200 hover:border-rose-300/50 hover:bg-rose-500/15";
  }
  return "border-white/12 bg-white/[0.04] px-4 text-slate-200 hover:border-white/25 hover:text-white";
}

export function SelectionBar({
  selectedCount,
  totalValue,
  selectAllLabel,
  onSelectAll,
  onClearSelection,
  actions,
}: SelectionBarProps) {
  return (
    <section className="sticky top-[86px] z-10 rounded-[24px] border border-gold-400/20 bg-black/90 p-4 shadow-[0_22px_70px_rgba(0,0,0,0.45)] backdrop-blur">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-200">
          <span className="rounded-full border border-gold-400/30 bg-gold-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-gold-100">
            {selectedCount} selected
          </span>
          <span className="text-sm text-slate-300">Total Value: {formatCurrencyFromMinor(totalValue)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onSelectAll ? (
            <button
              type="button"
              onClick={onSelectAll}
              className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white"
            >
              {selectAllLabel ?? "Select All"}
            </button>
          ) : null}
          {onClearSelection ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white"
            >
              Clear
            </button>
          ) : null}
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={`rounded-full border py-2 text-[11px] uppercase tracking-[0.22em] transition disabled:cursor-not-allowed disabled:opacity-45 ${buttonClass(action.variant)}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
