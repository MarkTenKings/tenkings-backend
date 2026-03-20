import Image from "next/image";
import { buildPackTypeDisplayName, buildPackTypeGridLabel, type AdminPackType } from "../../lib/adminPackTypes";
import { formatCategoryLabel, formatPackTierLabel } from "../../lib/adminInventory";
import { adminCx } from "./AdminPrimitives";

type PackTypeCardProps = {
  packType: AdminPackType;
  mode?: "management" | "selector";
  selected?: boolean;
  onClick?: () => void;
  onEdit?: () => void;
};

function PackTypeArtwork({ imageUrl, label }: { imageUrl: string | null; label: string }) {
  if (imageUrl) {
    return (
      <div className="relative aspect-[4/5] overflow-hidden rounded-[22px] border border-white/12 bg-black/70">
        <Image src={imageUrl} alt={label} fill unoptimized className="object-cover" sizes="(min-width: 1280px) 20vw, (min-width: 768px) 35vw, 90vw" />
      </div>
    );
  }

  return (
    <div className="flex aspect-[4/5] items-center justify-center rounded-[22px] border border-dashed border-white/14 bg-[radial-gradient(circle_at_top,rgba(212,175,55,0.18),transparent_62%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] px-5 text-center">
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Pack Image</p>
        <p className="font-heading text-lg uppercase tracking-[0.12em] text-slate-200">{label}</p>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Placeholder</p>
      </div>
    </div>
  );
}

export function PackTypeCard({
  packType,
  mode = "management",
  selected = false,
  onClick,
  onEdit,
}: PackTypeCardProps) {
  const label = buildPackTypeGridLabel(packType.category, packType.tier);
  const displayName = buildPackTypeDisplayName(packType);
  const selectorMode = mode === "selector";
  const cardClassName = adminCx(
    "group flex h-full flex-col gap-4 rounded-[28px] border bg-black/80 p-4 text-left transition",
    selectorMode ? "min-h-[290px]" : "min-h-[420px]",
    selected
      ? "border-gold-300 shadow-[0_0_0_1px_rgba(212,175,55,0.55),0_18px_60px_rgba(0,0,0,0.38)]"
      : "border-white/12 shadow-[0_18px_60px_rgba(0,0,0,0.32)]",
    onClick ? "hover:-translate-y-0.5 hover:border-gold-300/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/70" : ""
  );
  const content = (
    <>
      <div className="relative">
        <PackTypeArtwork imageUrl={packType.imageUrl} label={displayName} />
        {selectorMode && selected ? (
          <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-gold-200/70 bg-gold-500 text-xs font-semibold text-night-950">
            ✓
          </span>
        ) : null}
      </div>

      {selectorMode ? (
        <div className="space-y-1">
          <p className="font-heading text-lg uppercase tracking-[0.12em] text-white">{formatCategoryLabel(packType.category).toUpperCase()}</p>
          <p className="text-sm uppercase tracking-[0.24em] text-gold-200">{formatPackTierLabel(packType.tier)}</p>
          <p className="text-xs text-slate-400">{displayName}</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className="font-heading text-[1.45rem] uppercase tracking-[0.12em] text-white">{label}</p>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em]">
              <span className={adminCx("inline-flex h-2.5 w-2.5 rounded-full", packType.isActive ? "bg-emerald-300" : "bg-slate-500")} />
              <span className={packType.isActive ? "text-emerald-100" : "text-slate-400"}>
                {packType.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            {packType.description ? <p className="text-sm text-slate-400">{packType.description}</p> : null}
          </div>

          <div className="mt-auto flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{displayName}</p>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{formatCategoryLabel(packType.category)} · {formatPackTierLabel(packType.tier)}</p>
            </div>
            {onEdit ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit();
                }}
                className="rounded-full border border-white/14 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-100 transition hover:border-gold-300/60 hover:text-white"
              >
                Edit
              </button>
            ) : null}
          </div>
        </>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cardClassName}>
        {content}
      </button>
    );
  }

  return <div className={cardClassName}>{content}</div>;
}
