import type { Checkpoint } from "../../lib/kingsHunt";

type CheckpointProgressProps = {
  checkpoints: Checkpoint[];
  reachedIds: number[];
  className?: string;
};

export default function CheckpointProgress({ checkpoints, reachedIds, className }: CheckpointProgressProps) {
  if (checkpoints.length === 0) {
    return null;
  }

  const reachedSet = new Set(reachedIds);
  const activeId = checkpoints.find((checkpoint) => !reachedSet.has(checkpoint.id))?.id ?? null;

  return (
    <div className={`space-y-3 ${className ?? ""}`.trim()}>
      <p className="text-center text-[11px] uppercase tracking-[0.24em] text-[#8f8f96]">
        {checkpoints.length} checkpoints to Ten Kings
      </p>
      <div className="relative flex items-start justify-between gap-2">
        <div className="absolute left-[9%] right-[9%] top-4 h-[2px] bg-white/10" aria-hidden />
        <div
          className="absolute left-[9%] top-4 h-[2px] bg-[#d4a843] transition-all duration-500"
          style={{
            width:
              checkpoints.length > 1
                ? `${((checkpoints.filter((checkpoint) => reachedSet.has(checkpoint.id)).length - 1) / (checkpoints.length - 1)) * 82}%`
                : "82%",
          }}
          aria-hidden
        />
        {checkpoints.map((checkpoint) => {
          const state = reachedSet.has(checkpoint.id) ? "completed" : checkpoint.id === activeId ? "current" : "upcoming";

          return (
            <div key={checkpoint.id} className="relative z-10 flex max-w-[96px] flex-1 flex-col items-center gap-2 text-center">
              <span
                className={[
                  "inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold",
                  state === "completed"
                    ? "border-emerald-400 bg-emerald-500 text-[#04110a]"
                    : state === "current"
                      ? "border-[#d4a843] bg-[#d4a843] text-[#121212] tk-checkpoint-current"
                      : "border-white/10 bg-white/5 text-[#787881]",
                ].join(" ")}
              >
                {state === "completed" ? "✓" : checkpoint.id}
              </span>
              <span className="text-[11px] font-medium text-[#d7d7dc]">{checkpoint.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
