import Head from "next/head";
import Link from "next/link";
import { useMemo } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";

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
      <div className="flex flex-1 flex-col gap-10 px-6 py-12">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-violet-300">Ten Kings · Ops</p>
          <h1 className="font-heading text-5xl uppercase tracking-[0.18em] text-white">Processing Console</h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Intake → Review → Inventory → Locations.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-6">
            <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">Getting Started</h2>
            <p className="mt-3 text-sm text-slate-400">
              Upload cards and enter intake details.
            </p>
            <Link
              href="/admin/uploads"
              className="inline-flex w-fit items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400"
            >
              Open Uploads
            </Link>
          </div>
          <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-6">
            <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">Location Packing</h2>
            <p className="mt-3 text-sm text-slate-400">
              Build packs and sync to kiosks.
            </p>
            <Link
              href="/admin/packing"
              className="inline-flex w-fit items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400"
            >
              Packing Console
            </Link>
          </div>
          <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-6">
            <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">KingsReview</h2>
            <p className="mt-3 text-sm text-slate-400">
              Review comps and lock value.
            </p>
            <Link
              href="/admin/kingsreview"
              className="inline-flex w-fit items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400"
            >
              Open KingsReview
            </Link>
          </div>
          <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-6">
            <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">Inventory Ready</h2>
            <p className="mt-3 text-sm text-slate-400">
              Select cards and assign to locations.
            </p>
            <Link
              href="/admin/inventory-ready"
              className="inline-flex w-fit items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400"
            >
              Open Inventory
            </Link>
          </div>
        </section>
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
