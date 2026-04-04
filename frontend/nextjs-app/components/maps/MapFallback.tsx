import type { ReactNode } from "react";

export interface MapFallbackProps {
  eyebrow?: string;
  title: string;
  body?: string;
  className?: string;
  actions?: ReactNode;
}

export default function MapFallback({
  eyebrow = "Map unavailable",
  title,
  body,
  className,
  actions,
}: MapFallbackProps) {
  return (
    <div
      className={`flex w-full items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(212,168,67,0.18),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015)),#090909] px-6 py-8 text-center shadow-[0_24px_60px_rgba(0,0,0,0.32)] ${className ?? ""}`.trim()}
    >
      <div className="max-w-lg">
        <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.32em] text-[#d4a843]">{eyebrow}</p>
        <h3 className="font-kingshunt-display mt-4 text-[2rem] leading-none tracking-[0.04em] text-white md:text-[2.35rem]">
          {title}
        </h3>
        {body ? <p className="font-kingshunt-body mt-4 text-sm leading-6 text-[#c8c8c8] md:text-base">{body}</p> : null}
        {actions ? <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}
