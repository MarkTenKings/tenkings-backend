import Link from "next/link";
import { useState } from "react";

type CatalogOpsLegacyFrameProps = {
  title: string;
  description: string;
  legacyHref: string;
};

export default function CatalogOpsLegacyFrame({ title, description, legacyHref }: CatalogOpsLegacyFrameProps) {
  const [frameKey, setFrameKey] = useState(0);

  return (
    <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.32em] text-violet-300">Phase 0 Wrapper</p>
          <h2 className="font-heading text-2xl uppercase tracking-[0.14em] text-white">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={legacyHref}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-night-900 transition hover:bg-gold-400"
          >
            Open Legacy
          </Link>
          <button
            type="button"
            onClick={() => setFrameKey((prev) => prev + 1)}
            className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.24em] text-slate-200 transition hover:border-white/40 hover:text-white"
          >
            Reload Frame
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-night-950/60">
        <iframe
          key={frameKey}
          title={title}
          src={legacyHref}
          className="h-[74vh] w-full bg-night-950"
          loading="lazy"
        />
      </div>
    </section>
  );
}
