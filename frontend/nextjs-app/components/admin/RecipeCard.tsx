import { adminPanelClass, adminSubpanelClass } from "./AdminPrimitives";
import {
  formatPackRecipeItemTypeLabel,
  formatRecipeSeasonLabel,
  type LocationRecipeSummary,
} from "../../lib/adminPackRecipes";
import {
  formatCategoryLabel,
  formatCurrencyFromMinor,
  formatPackTierLabel,
} from "../../lib/adminInventory";

type RecipeCardProps = {
  recipe: LocationRecipeSummary;
  matchingBatchCount?: number;
  busyAction?: "toggle" | "duplicate" | "delete" | null;
  onEdit: () => void;
  onDuplicate: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
};

export function RecipeCard({
  recipe,
  matchingBatchCount = 0,
  busyAction = null,
  onEdit,
  onDuplicate,
  onToggleActive,
  onDelete,
}: RecipeCardProps) {
  const hasItems = recipe.items.length > 0;

  return (
    <article className={adminPanelClass("p-5")}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Pack Recipe</p>
            <h3 className="font-heading text-2xl uppercase tracking-[0.12em] text-white">{recipe.name}</h3>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em]">
            <span className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-slate-200">
              {formatCategoryLabel(recipe.category)}
            </span>
            <span className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-slate-200">
              {formatPackTierLabel(recipe.tier)}
            </span>
            <span
              className={[
                "rounded-full border px-3 py-1.5",
                recipe.isActive
                  ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                  : "border-white/12 bg-white/[0.04] text-slate-400",
              ].join(" ")}
            >
              {recipe.isActive ? "Active" : "Inactive"}
            </span>
            <span className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-slate-300">
              {recipe.activeExtraItemCount}/{recipe.items.length} active extras
            </span>
            {matchingBatchCount > 0 ? (
              <span className="rounded-full border border-amber-400/35 bg-amber-500/10 px-3 py-1.5 text-amber-100">
                {matchingBatchCount} matching batch{matchingBatchCount === 1 ? "" : "es"}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onEdit}
            disabled={busyAction !== null}
            className="rounded-full border border-white/12 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            disabled={busyAction !== null}
            className="rounded-full border border-white/12 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busyAction === "duplicate" ? "Duplicating..." : "Duplicate"}
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            disabled={busyAction !== null}
            className={[
              "rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition disabled:cursor-not-allowed disabled:opacity-45",
              recipe.isActive
                ? "border-amber-400/35 bg-amber-500/10 text-amber-100 hover:border-amber-300/60 hover:text-white"
                : "border-emerald-400/35 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/60 hover:text-white",
            ].join(" ")}
          >
            {busyAction === "toggle" ? "Updating..." : recipe.isActive ? "Deactivate" : "Activate"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busyAction !== null}
            className="rounded-full border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-rose-100 transition hover:border-rose-300/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busyAction === "delete" ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className={adminSubpanelClass("p-4")}>
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Slab Cards / Pack</p>
          <p className="mt-2 text-2xl font-semibold text-white">{recipe.slabCardsPerPack}</p>
        </div>
        <div className={adminSubpanelClass("p-4")}>
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Bonus Cards / Pack</p>
          <p className="mt-2 text-2xl font-semibold text-white">{recipe.bonusCardsPerPack}</p>
        </div>
        <div className={adminSubpanelClass("p-4")}>
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Bonus Card Cap</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-300">
            {formatCurrencyFromMinor(recipe.bonusCardMaxValue)}
          </p>
        </div>
        <div className={adminSubpanelClass("p-4")}>
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Active Extras Cost / Pack</p>
          <p className="mt-2 text-2xl font-semibold text-gold-200">
            {formatCurrencyFromMinor(recipe.extraCostPerPack)}
          </p>
        </div>
      </div>

      {recipe.notes ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Notes</p>
          <p className="mt-2 text-sm text-slate-300">{recipe.notes}</p>
        </div>
      ) : null}

      <div className="mt-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Extra Items</p>
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
            {hasItems ? `${recipe.items.length} configured` : "No extras"}
          </p>
        </div>

        {hasItems ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {recipe.items.map((item) => (
              <div key={item.id} className={adminSubpanelClass("p-4")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {item.quantity}x {item.name}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                      {formatPackRecipeItemTypeLabel(item.itemType)}
                    </p>
                  </div>
                  <span
                    className={[
                      "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]",
                      item.isCurrentlyActive
                        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                        : "border-white/12 bg-white/[0.04] text-slate-400",
                    ].join(" ")}
                  >
                    {item.isCurrentlyActive ? "Live" : item.isActive ? "Inactive by Date" : "Off"}
                  </span>
                </div>
                {item.description ? <p className="mt-3 text-sm text-slate-300">{item.description}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <span className="rounded-full border border-white/10 px-2.5 py-1">
                    {formatCurrencyFromMinor(item.costPerUnit)} each
                  </span>
                  <span className="rounded-full border border-white/10 px-2.5 py-1">
                    {formatCurrencyFromMinor(item.costPerUnit * item.quantity)} / pack
                  </span>
                  {item.isSeasonal ? (
                    <span className="rounded-full border border-white/10 px-2.5 py-1">
                      {formatRecipeSeasonLabel(item.seasonStart, item.seasonEnd)}
                    </span>
                  ) : (
                    <span className="rounded-full border border-white/10 px-2.5 py-1">Always On</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-4 py-6 text-sm text-slate-400">
            No extra items are configured for this recipe yet.
          </div>
        )}
      </div>
    </article>
  );
}
