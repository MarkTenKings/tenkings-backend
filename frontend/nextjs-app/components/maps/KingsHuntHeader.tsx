import TKDCounter from "./TKDCounter";

type KingsHuntHeaderProps = {
  title: string;
  subtitle?: string;
  tkdEarned?: number;
};

export default function KingsHuntHeader({ title, subtitle, tkdEarned }: KingsHuntHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/8 px-5 py-5">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(212,168,67,0.24)] bg-[rgba(212,168,67,0.08)] text-[#d4a843]">
            <svg viewBox="0 0 32 32" className="h-4 w-4" aria-hidden="true">
              <path d="M6 24L10 10L16 16L22 8L26 24H6Z" fill="currentColor" />
            </svg>
          </span>
          <h1 className="text-[1.7rem] font-semibold leading-none tracking-[-0.02em] text-[#f7f7f8]">{title}</h1>
        </div>
        {subtitle ? <p className="text-sm text-[#8f8f98]">{subtitle}</p> : null}
      </div>
      {typeof tkdEarned === "number" ? <TKDCounter value={tkdEarned} /> : null}
    </div>
  );
}
