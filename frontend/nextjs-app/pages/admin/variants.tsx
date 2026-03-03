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
      <div className="flex flex-1 flex-col gap-6 px-6 py-10">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-violet-300">Variants</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Workflow Moved</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            Variant ingestion, bulk import, and seeding now run through Set Ops Review. Reference image cleanup and
            manual curation run through Variant Ref QA.
          </p>
        </div>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <Link
              href={{ pathname: "/admin/set-ops-review", query: nextQuery }}
              className="inline-flex items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-night-900 transition hover:bg-gold-400"
            >
              Go to Set Ops Review
            </Link>
            <Link
              href={{ pathname: "/admin/variant-ref-qa", query: nextQuery }}
              className="inline-flex items-center justify-center rounded-full border border-sky-400/60 bg-sky-500/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-sky-100 transition hover:bg-sky-500/30"
            >
              Go to Variant Ref QA
            </Link>
          </div>
          <div className="mt-4 text-xs text-slate-400">
            <p>
              This page remains available as a compatibility route only. Primary operations should use Set Ops Review
              and Variant Ref QA.
            </p>
            <p className="mt-2">
              <Link href="/admin" className="text-slate-300 hover:text-white">
                Return to Admin Home
              </Link>
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
