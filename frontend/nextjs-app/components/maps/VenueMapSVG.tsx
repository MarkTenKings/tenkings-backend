import { useId, type ReactNode } from "react";

type VenueMapSVGProps = {
  viewBox?: string;
  className?: string;
  children: ReactNode;
};

export default function VenueMapSVG({ viewBox = "0 0 800 600", className, children }: VenueMapSVGProps) {
  const patternId = useId();
  const glowId = useId();

  return (
    <div className={`overflow-hidden rounded-[30px] border border-white/10 bg-[#101010] shadow-[0_28px_80px_rgba(0,0,0,0.42)] ${className ?? ""}`.trim()}>
      <svg viewBox={viewBox} className="h-full w-full" role="img" aria-label="Venue map">
        <defs>
          <pattern id={patternId} width="56" height="56" patternUnits="userSpaceOnUse">
            <path d="M56 0H0V56" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          </pattern>
          <filter id={glowId}>
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="0" y="0" width="800" height="600" fill="#0f0f10" />
        <rect x="0" y="0" width="800" height="600" fill={`url(#${patternId})`} />
        <g filter={`url(#${glowId})`} opacity="0.18">
          <circle cx="146" cy="110" r="130" fill="#d4a843" />
          <circle cx="665" cy="480" r="160" fill="#1f4ed8" />
        </g>
        {children}
      </svg>
    </div>
  );
}
