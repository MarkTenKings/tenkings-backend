import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useMemo } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";

function readQueryValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

export default function AdminVariantsLegacyPage() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const setId = useMemo(() => readQueryValue(router.query.setId), [router.query.setId]);
  const nextQuery = useMemo(() => (setId ? { setId } : {}), [setId]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm uppercase tracking-[0.3em] text-slate-400">
          Checking access…
        </div>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Admin Access Only</p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow"
          >
            Sign In
          </button>
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-rose-300">Access Denied</p>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.28em] text-slate-200"
          >
            Sign Out
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Variants (Moved)</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 lg:px-6">
        <section className="rounded-3xl border border-amber-400/30 bg-amber-500/10 p-6 shadow-card">
          <p className="text-[10px] uppercase tracking-[0.32em] text-amber-200">Compatibility Route</p>
          <h1 className="mt-2 font-heading text-3xl uppercase tracking-[0.16em] text-white">Variants Workflow Retired</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-300">
            This route no longer hosts active work. Variant ingestion, bulk import, and seeding now run through Set Ops Review. Reference image cleanup and manual curation now run through Variant Ref QA.
          </p>
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5 shadow-card">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Open The Canonical Pages</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Link
              href={{ pathname: "/admin/set-ops-review", query: nextQuery }}
              className="inline-flex items-center justify-center rounded-2xl border border-gold-500/60 bg-gold-500 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-night-900 transition hover:bg-gold-400"
            >
              Go to Set Ops Review
            </Link>
            <Link
              href={{ pathname: "/admin/variant-ref-qa", query: nextQuery }}
              className="inline-flex items-center justify-center rounded-2xl border border-sky-400/60 bg-sky-500/20 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-100 transition hover:bg-sky-500/30"
            >
              Go to Variant Ref QA
            </Link>
          </div>
          <div className="mt-4 space-y-2 text-sm text-slate-300">
            <p>This page remains live for old bookmarks only.</p>
            <p>
              <Link href="/admin" className="text-slate-200 underline hover:text-white">
                Return to Admin Home
              </Link>
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
