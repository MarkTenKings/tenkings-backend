interface ChaseCarouselProps {
  labels: string[];
}

export function ChaseCarousel({ labels }: ChaseCarouselProps) {
  const marqueeItems = [...labels, ...labels];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-night-900/70">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-night-900 via-night-900/70 to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-night-900 via-night-900/70 to-transparent"
        aria-hidden
      />
      <div className="flex min-w-full gap-3 py-3 pl-4 pr-16 motion-safe:animate-marquee">
        {marqueeItems.map((label, index) => (
          <div
            key={`${label}-${index}`}
            className="flex h-60 w-36 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-night-800 text-xs uppercase tracking-[0.3em] text-slate-200"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
