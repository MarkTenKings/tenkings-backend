import {
  type PackingSlipLayout,
  type PackingSlipsResponse,
} from "../../lib/adminPackRecipes";
import {
  formatCategoryLabel,
  formatCurrencyFromMinor,
  formatPackTierLabel,
} from "../../lib/adminInventory";

type PackingSlipPrintProps = {
  data: PackingSlipsResponse;
  layout: PackingSlipLayout;
};

export function PackingSlipPrint({ data, layout }: PackingSlipPrintProps) {
  return (
    <div className={layout === "receipt" ? "mx-auto max-w-[80mm]" : "mx-auto max-w-[8in]"}>
      <style jsx global>{`
        @media print {
          html,
          body {
            background: #ffffff !important;
          }

          .no-print {
            display: none !important;
          }

          .packing-slip-sheet {
            break-after: page;
            page-break-after: always;
            box-shadow: none !important;
          }
        }
      `}</style>

      <div className="space-y-4">
        {data.slips.map((slip) => (
          <section
            key={`packing-slip-${slip.packNumber}`}
            className="packing-slip-sheet rounded-[20px] border border-black/10 bg-white px-5 py-5 text-black shadow-[0_18px_60px_rgba(0,0,0,0.18)]"
          >
            <header className="border-b border-dashed border-black/30 pb-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em]">Ten Kings Packing Slip</p>
              <h1 className="mt-2 text-xl font-bold uppercase tracking-[0.08em]">{data.batch.location.name}</h1>
              <div className="mt-2 space-y-1 text-xs text-black/70">
                <p>{data.batch.label ?? "Unlabeled Batch"}</p>
                <p>
                  {data.batch.category ? formatCategoryLabel(data.batch.category) : "Unknown Category"} ·{" "}
                  {data.batch.tier ? formatPackTierLabel(data.batch.tier) : "Unknown Tier"}
                </p>
                <p>
                  Pack {slip.packNumber} of {data.slips.length}
                </p>
              </div>
            </header>

            <div className="mt-4 space-y-4">
              <section>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-black/70">Cards</p>
                <div className="mt-2 space-y-2 text-sm">
                  <p>
                    [ ] Main slab card:{" "}
                    <span className="font-semibold">
                      {slip.mainCard.playerName || "Unknown Player"} · {slip.mainCard.year || "Unknown Year"}{" "}
                      {slip.mainCard.setName || "Unknown Set"}
                    </span>
                  </p>
                  <p className="pl-5 text-black/70">
                    {slip.mainCard.parallel || "Base"} · Card #{slip.mainCard.cardNumber || "N/A"} ·{" "}
                    {formatCurrencyFromMinor(slip.mainCard.valuationMinor)}
                  </p>
                  <p>[ ] Bonus cards: {slip.bonusCardCount} cards from bonus bin</p>
                  <p className="pl-5 text-black/70">
                    Max target value {formatCurrencyFromMinor(slip.bonusCardMaxValue)} each
                  </p>
                </div>
              </section>

              <section>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-black/70">Extras</p>
                {slip.extraItems.length > 0 ? (
                  <div className="mt-2 space-y-2 text-sm">
                    {slip.extraItems.map((item) => (
                      <div key={`${slip.packNumber}-${item.itemType}-${item.name}`}>
                        <p>
                          [ ] {item.quantity}x {item.name}
                        </p>
                        {item.description ? <p className="pl-5 text-black/70">{item.description}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-black/70">No extra items for this pack.</p>
                )}
              </section>

              <section className="border-t border-dashed border-black/30 pt-3 text-sm">
                <div className="space-y-3">
                  <p>Packed by: ________________________________</p>
                  <p>Time: ____________________________________</p>
                  <p>QC: ______________________________________</p>
                </div>
              </section>
            </div>

            {data.recipe ? (
              <footer className="mt-4 border-t border-dashed border-black/30 pt-3 text-[10px] uppercase tracking-[0.18em] text-black/65">
                Recipe: {data.recipe.name} · {data.recipe.source}
              </footer>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
