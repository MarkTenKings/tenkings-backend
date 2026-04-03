import { estimateWalkingTimeMin, metersToFeet } from "../../lib/geo";

type StatsBarProps = {
  distanceM: number | null;
  etaMin?: number | null;
  accuracyM?: number | null;
  className?: string;
};

export default function StatsBar({ distanceM, etaMin, accuracyM, className }: StatsBarProps) {
  const walkingEta = etaMin ?? (distanceM ? estimateWalkingTimeMin(distanceM) : null);

  return (
    <div className={`grid grid-cols-2 gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[#d8d8dc] ${className ?? ""}`.trim()}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-[#8a8a92]">
          @
        </span>
        <span>{distanceM != null ? `${metersToFeet(distanceM)} ft remaining` : "Machine distance unavailable"}</span>
      </div>
      <div className="flex items-center gap-2 justify-self-end">
        <span aria-hidden className="text-[#8a8a92]">
          O
        </span>
        <span>{walkingEta != null ? `ETA: ${walkingEta} min` : "ETA unavailable"}</span>
      </div>
      {accuracyM != null ? (
        <div className="col-span-2 text-[11px] uppercase tracking-[0.18em] text-[#7c7c84]">
          GPS accuracy: ±{Math.round(accuracyM)}m
        </div>
      ) : null}
    </div>
  );
}
