import Link from "next/link";

type CatalogOpsCompatibilityTone = "gold" | "emerald" | "sky" | "violet";

type CatalogOpsCompatibilityAction = {
  label: string;
  href: string;
  detail: string;
  tone?: CatalogOpsCompatibilityTone;
};

type CatalogOpsCompatibilityNoticeProps = {
  eyebrow: string;
  title: string;
  description: string;
  rationale: string;
  actions: CatalogOpsCompatibilityAction[];
  notes?: string[];
};

function actionCardClass(tone: CatalogOpsCompatibilityTone = "gold") {
  switch (tone) {
    case "emerald":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/60 hover:bg-emerald-500/15";
    case "sky":
      return "border-sky-400/30 bg-sky-500/10 text-sky-100 hover:border-sky-300/60 hover:bg-sky-500/15";
    case "violet":
      return "border-violet-400/30 bg-violet-500/10 text-violet-100 hover:border-violet-300/60 hover:bg-violet-500/15";
    default:
      return "border-gold-500/35 bg-gold-500/10 text-gold-100 hover:border-gold-400/60 hover:bg-gold-500/15";
  }
}

export default function CatalogOpsCompatibilityNotice({
  eyebrow,
  title,
  description,
  rationale,
  actions,
  notes = [],
}: CatalogOpsCompatibilityNoticeProps) {
  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-amber-400/30 bg-amber-500/10 p-5 shadow-card">
        <p className="text-[10px] uppercase tracking-[0.32em] text-amber-200">{eyebrow}</p>
        <h2 className="mt-2 font-heading text-3xl uppercase tracking-[0.14em] text-white">{title}</h2>
        <p className="mt-3 max-w-4xl text-sm text-amber-100/90">{description}</p>
        <p className="mt-3 max-w-4xl text-sm text-slate-300">{rationale}</p>
      </section>

      <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5 shadow-card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Where To Work Now</p>
            <p className="mt-1 text-sm text-slate-300">These standalone pages are the canonical admin surfaces.</p>
          </div>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {actions.map((action) => (
            <Link
              key={`${action.label}-${action.href}`}
              href={action.href}
              className={`group rounded-2xl border p-4 shadow-card transition ${actionCardClass(action.tone)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em]">{action.label}</p>
                  <p className="mt-2 text-sm text-slate-200">{action.detail}</p>
                </div>
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/70 transition group-hover:text-white">
                  Open
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {notes.length > 0 ? (
        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5 shadow-card">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Compatibility Notes</p>
          <div className="mt-3 space-y-2 text-sm text-slate-300">
            {notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
