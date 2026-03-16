import type { ReactNode } from "react";
import type { InventoryCardSummary } from "../../lib/adminInventory";
import { adminPanelClass } from "./AdminPrimitives";
import { CardTile } from "./CardTile";

type CardGridProps = {
  cards: InventoryCardSummary[];
  selectedIds: Set<string>;
  loading?: boolean;
  onToggleCard: (cardId: string) => void;
  emptyState: ReactNode;
};

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/80">
      <div className="aspect-[3/4] animate-pulse bg-white/5" />
      <div className="space-y-3 p-4">
        <div className="h-4 animate-pulse rounded bg-white/5" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-white/5" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
      </div>
    </div>
  );
}

export function CardGrid({ cards, selectedIds, loading, onToggleCard, emptyState }: CardGridProps) {
  if (loading) {
    return (
      <section className={adminPanelClass("p-4 md:p-5")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 8 }, (_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      </section>
    );
  }

  if (cards.length === 0) {
    return <section className={adminPanelClass("p-8")}>{emptyState}</section>;
  }

  return (
    <section className={adminPanelClass("p-4 md:p-5")}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {cards.map((card) => (
          <CardTile key={card.id} card={card} isSelected={selectedIds.has(card.id)} onToggle={onToggleCard} />
        ))}
      </div>
    </section>
  );
}
