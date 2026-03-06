import Head from "next/head";
import Link from "next/link";
import { useMemo } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";

type AdminDestinationTone = "gold" | "emerald" | "sky" | "violet";

type AdminDestination = {
  label: string;
  href: string;
  description: string;
  tone?: AdminDestinationTone;
};

type AdminSection = {
  title: string;
  description: string;
  routes: AdminDestination[];
};

const ADMIN_SECTIONS: AdminSection[] = [
  {
    title: "Card Intake",
    description: "Move cards through intake, review, inventory-ready checks, and physical assignment.",
    routes: [
      {
        label: "Add Cards",
        href: "/admin/uploads",
        description: "Upload new cards, kick off OCR, and start the intake path.",
      },
      {
        label: "KingsReview",
        href: "/admin/kingsreview",
        description: "Handle downstream human review decisions and move cards through manual checkpoints.",
        tone: "sky",
      },
      {
        label: "Inventory Ready",
        href: "/admin/inventory-ready",
        description: "Review cards that are ready for inventory-facing operations.",
        tone: "emerald",
      },
      {
        label: "Assigned Locations",
        href: "/admin/location-batches",
        description: "Inspect and manage cards that already have assigned storage or operational locations.",
        tone: "violet",
      },
    ],
  },
  {
    title: "Set Workflows",
    description: "Use these standalone pages for ingest, draft approval, set administration, and reference-image QA.",
    routes: [
      {
        label: "Set Ops Review",
        href: "/admin/set-ops-review",
        description: "Queue source files, build and approve drafts, then monitor seed jobs in the guided stepper workflow.",
      },
      {
        label: "Variant Ref QA",
        href: "/admin/variant-ref-qa",
        description: "Filter seeded variant buckets, process and promote refs, and clean bad reference images.",
        tone: "sky",
      },
      {
        label: "Set Ops",
        href: "/admin/set-ops",
        description: "Search active sets, inspect footprint, and run archive, replace, or delete flows from the set control panel.",
        tone: "emerald",
      },
    ],
  },
  {
    title: "Monitoring",
    description: "Use the dedicated monitoring surface for OCR and LLM health, eval coverage, and attention queues.",
    routes: [
      {
        label: "AI Ops",
        href: "/admin/ai-ops",
        description: "Monitor AI pipeline health, manage eval cases, and retry cards that need intervention.",
        tone: "violet",
      },
    ],
  },
];

function destinationCardClass(tone: AdminDestinationTone = "gold") {
  switch (tone) {
    case "emerald":
      return "border-emerald-400/35 bg-emerald-500/10 hover:border-emerald-300/60 hover:bg-emerald-500/15";
    case "sky":
      return "border-sky-400/35 bg-sky-500/10 hover:border-sky-300/60 hover:bg-sky-500/15";
    case "violet":
      return "border-violet-400/35 bg-violet-500/10 hover:border-violet-300/60 hover:bg-violet-500/15";
    default:
      return "border-gold-500/35 bg-gold-500/10 hover:border-gold-400/60 hover:bg-gold-500/15";
  }
}

export default function AdminHome() {
  const { session, loading, ensureSession, logout } = useSession();

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const showMissingConfig =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_ADMIN_USER_IDS === undefined &&
    process.env.NEXT_PUBLIC_ADMIN_PHONES === undefined;

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Checking access…</p>
        </div>
      );
    }

    if (!session) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <p className="max-w-md text-sm text-slate-400">
            Use your Ten Kings phone number. Only approved operators will gain entry to the processing console.
          </p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
          {showMissingConfig && (
            <p className="mt-6 max-w-md text-xs text-rose-300/80">
              Set <code className="font-mono">NEXT_PUBLIC_ADMIN_USER_IDS</code> to a comma-separated list of admin user IDs to enable access control.
            </p>
          )}
        </div>
      );
    }

    if (!isAdmin) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
          <p className="max-w-md text-sm text-slate-400">
            This console is restricted to Ten Kings operators. Contact an administrator if you need elevated permissions.
          </p>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-8 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
          >
            Sign Out
          </button>
        </div>
      );
    }

    return (
      <div className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="rounded-3xl border border-white/10 bg-night-900/70 p-6 shadow-card">
          <p className="text-[10px] uppercase tracking-[0.34em] text-violet-300">Admin Launchpad</p>
          <h1 className="mt-2 font-heading text-3xl uppercase tracking-[0.16em] text-white">Canonical Operator Surfaces</h1>
          <p className="mt-3 max-w-4xl text-sm text-slate-300">
            Use the standalone admin pages below. Duplicate Catalog Ops and Variants compatibility routes have been removed from the launchpad to keep operators on the full-width working surfaces.
          </p>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.75fr)_320px]">
          <div className="space-y-6">
            {ADMIN_SECTIONS.map((section) => (
              <section key={section.title} className="rounded-3xl border border-white/10 bg-night-900/70 p-5 shadow-card">
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{section.title}</p>
                  <p className="mt-2 max-w-3xl text-sm text-slate-300">{section.description}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {section.routes.map((route) => (
                    <Link
                      key={route.href}
                      href={route.href}
                      className={`group rounded-2xl border p-4 shadow-card transition ${destinationCardClass(route.tone)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white">{route.label}</p>
                          <p className="mt-2 text-sm text-slate-200">{route.description}</p>
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.24em] text-white/70 transition group-hover:text-white">
                          Open
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <aside className="rounded-3xl border border-white/10 bg-night-900/70 p-5 shadow-card">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Routing Notes</p>
            <div className="mt-3 space-y-3 text-sm text-slate-300">
              <p>Set Ops Review is the intake, draft, and seed workspace.</p>
              <p>Variant Ref QA is the active home for reference cleanup and variants QA work.</p>
              <p>Set Ops remains the set-level control panel for archive, replace, delete, and footprint checks.</p>
              <p>AI Ops is the canonical monitoring surface for OCR, LLM, and eval health.</p>
            </div>
            <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100/90">
              Legacy Catalog Ops and Variants routes still resolve for old bookmarks, but they now hand off into the standalone pages instead of duplicating the work surfaces.
            </div>
          </aside>
        </div>
      </div>
    );
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Admin</title>
        <meta name="robots" content="noindex" />
      </Head>
      {renderContent()}
    </AppShell>
  );
}
