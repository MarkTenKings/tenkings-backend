import Image from "next/image";
import { PlaceholderImage } from "../PlaceholderImage";
import { formatCategoryLabel, formatCurrencyFromMinor, type InventoryCardSummary } from "../../lib/adminInventory";

const CATEGORY_BADGE_CLASSES: Record<string, string> = {
  SPORTS: "border-sky-400/40 bg-sky-500/15 text-sky-200",
  POKEMON: "border-amber-300/40 bg-amber-400/15 text-amber-100",
  ONE_PIECE: "border-rose-400/40 bg-rose-500/15 text-rose-200",
  COMICS: "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-200",
};

type CardTileProps = {
  card: InventoryCardSummary;
  isSelected: boolean;
  onToggle: (cardId: string) => void;
};

export function CardTile({ card, isSelected, onToggle }: CardTileProps) {
  const categoryClass = card.category ? CATEGORY_BADGE_CLASSES[card.category] ?? "border-white/10 bg-white/5 text-slate-200" : "border-white/10 bg-white/5 text-slate-200";

  return (
    <article
      className={[
        "group flex h-full flex-col overflow-hidden rounded-[24px] border bg-black/85 shadow-[0_20px_60px_rgba(0,0,0,0.38)] transition",
        isSelected ? "border-gold-400/60 ring-2 ring-gold-400/30" : "border-white/10 hover:border-white/20",
      ].join(" ")}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-night-900">
        {card.frontPhotoUrl ? (
          <Image
            src={card.frontPhotoUrl}
            alt={card.playerName ?? card.setName ?? "Inventory card"}
            fill
            sizes="(min-width: 1536px) 15vw, (min-width: 1280px) 18vw, (min-width: 768px) 24vw, 46vw"
            className="object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <PlaceholderImage label="No Image" />
        )}
        <label className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full border border-black/30 bg-black/70 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-white backdrop-blur">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggle(card.id)}
            className="h-4 w-4 rounded border-white/30 bg-black text-gold-400 focus:ring-gold-400"
          />
          Select
        </label>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-1">
          <h3 className="truncate text-base font-semibold text-white">
            {card.playerName ?? card.setName ?? "Untitled Card"}
          </h3>
          <p className="truncate text-sm text-slate-300">
            {[card.year, card.brand ?? card.setName].filter(Boolean).join(" • ") || "Classification pending"}
          </p>
          <p className="truncate text-xs uppercase tracking-[0.24em] text-slate-500">
            {card.cardNumber ? `#${card.cardNumber}` : "No card number"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {card.parallel ? (
            <span className="rounded-full border border-gold-400/35 bg-gold-500/12 px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] text-gold-100">
              {card.parallel}
            </span>
          ) : null}
          <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] ${categoryClass}`}>
            {formatCategoryLabel(card.category)}
          </span>
        </div>

        {card.subCategory ? <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{card.subCategory}</p> : null}

        <div className="mt-auto flex flex-col gap-2 pt-2">
          <p className="text-lg font-semibold text-emerald-300">{formatCurrencyFromMinor(card.valuationMinor)}</p>
          {card.inventoryBatch?.label ? (
            <p className="truncate text-xs uppercase tracking-[0.18em] text-slate-500">
              {card.inventoryBatch.label}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
