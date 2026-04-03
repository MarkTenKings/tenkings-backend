import type { WalkingDirection } from "../../lib/kingsHunt";

type WalkingDirectionsProps = {
  directions: WalkingDirection[];
  walkingTimeMin?: number | null;
  className?: string;
};

export default function WalkingDirections({ directions, walkingTimeMin, className }: WalkingDirectionsProps) {
  if (directions.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-4 ${className ?? ""}`.trim()}>
      <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(212,168,67,0.18)] bg-[rgba(212,168,67,0.08)] px-3 py-1 text-[11px] uppercase tracking-[0.26em] text-[#d4a843]">
        <span aria-hidden>O</span>
        {walkingTimeMin ? `${walkingTimeMin} min walk from main entrance` : "Walking directions"}
      </div>
      <ol className="space-y-3">
        {directions.map((direction) => (
          <li key={direction.step} className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-[#f2f2f5]">
              {direction.step}
            </span>
            <div className="space-y-1">
              <p className="text-sm text-[#f3f3f5]">{direction.instruction}</p>
              <p className="text-xs uppercase tracking-[0.2em] text-[#8a8a92]">
                {[direction.landmark, direction.distanceFt ? `${direction.distanceFt} ft` : null].filter(Boolean).join(" | ")}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
