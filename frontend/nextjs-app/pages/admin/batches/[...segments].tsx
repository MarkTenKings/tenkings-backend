import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { PackingSlipPrint } from "../../../components/admin/PackingSlipPrint";
import {
  type PackingSlipLayout,
  type PackingSlipsResponse,
} from "../../../lib/adminPackRecipes";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import { useSession } from "../../../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";

export default function BatchNestedAdminPage() {
  const router = useRouter();
  const segments = Array.isArray(router.query.segments) ? router.query.segments : [];
  const batchId = segments.length === 2 && segments[1] === "print-slips" ? segments[0] : null;
  const layout: PackingSlipLayout = router.query.layout === "letter" ? "letter" : "receipt";
  const { session, loading, ensureSession, logout } = useSession();
  const [data, setData] = useState<PackingSlipsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printTriggered, setPrintTriggered] = useState(false);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  useEffect(() => {
    if (!session?.token || !isAdmin || !batchId) {
      return;
    }

    const controller = new AbortController();
    setError(null);

    fetch(`/api/admin/batches/${batchId}/packing-slips`, {
      headers: adminHeaders,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { message?: string };
          throw new Error(payload.message ?? "Failed to load packing slips");
        }
        return (await response.json()) as PackingSlipsResponse;
      })
      .then((payload) => {
        setData(payload);
        setPrintTriggered(false);
      })
      .catch((fetchError: unknown) => {
        if ((fetchError as Error).name === "AbortError") {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load packing slips");
      });

    return () => controller.abort();
  }, [adminHeaders, batchId, isAdmin, session?.token]);

  useEffect(() => {
    if (!data || printTriggered) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.print();
      setPrintTriggered(true);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [data, printTriggered]);

  if (loading) {
    return (
      <>
        <Head>
          <title>Ten Kings · Packing Slips</title>
          <meta name="robots" content="noindex" />
        </Head>
        <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Checking access...</p>
        </main>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <Head>
          <title>Ten Kings · Packing Slips</title>
          <meta name="robots" content="noindex" />
        </Head>
        <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-neutral-950 px-4 text-center text-white">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 transition hover:bg-gold-400"
          >
            Sign In
          </button>
        </main>
      </>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <Head>
          <title>Ten Kings · Packing Slips</title>
          <meta name="robots" content="noindex" />
        </Head>
        <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-neutral-950 px-4 text-center text-white">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-8 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
          >
            Sign Out
          </button>
        </main>
      </>
    );
  }

  if (!batchId) {
    return (
      <>
        <Head>
          <title>Ten Kings · Packing Slips</title>
          <meta name="robots" content="noindex" />
        </Head>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-100 px-4 text-center text-black">
          <p className="text-xs uppercase tracking-[0.28em] text-black/55">Not Found</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.14em]">Unsupported batch route</h1>
          <Link
            href="/admin/assigned-locations"
            className="rounded-full border border-black/15 px-5 py-3 text-[11px] uppercase tracking-[0.22em] transition hover:border-black/35"
          >
            Back to Assigned Locations
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Ten Kings · Packing Slips</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="min-h-screen bg-neutral-100 px-4 py-5 text-black">
        <div className="no-print mx-auto mb-5 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-[22px] border border-black/10 bg-white px-4 py-4 shadow-[0_16px_50px_rgba(0,0,0,0.08)]">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.28em] text-black/50">Packing Slips</p>
            <h1 className="text-xl font-semibold uppercase tracking-[0.1em]">
              {data?.batch.label ?? "Batch Packing Slips"}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {data ? (
              <Link
                href={`/admin/assigned-locations/${data.batch.location.id}`}
                className="rounded-full border border-black/15 px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition hover:border-black/30"
              >
                Back to Location
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-full border border-black/15 px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition hover:border-black/30"
            >
              Print
            </button>
            <button
              type="button"
              onClick={() =>
                void router.replace(
                  {
                    pathname: router.pathname,
                    query: {
                      segments,
                      layout: layout === "receipt" ? "letter" : "receipt",
                    },
                  },
                  undefined,
                  { shallow: true }
                )
              }
              className="rounded-full border border-black/15 px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition hover:border-black/30"
            >
              {layout === "receipt" ? "Letter Layout" : "Receipt Layout"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mx-auto max-w-4xl rounded-[22px] border border-rose-400/35 bg-rose-500/10 px-4 py-4 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {data ? (
          <PackingSlipPrint data={data} layout={layout} />
        ) : !error ? (
          <div className="mx-auto max-w-4xl rounded-[22px] border border-black/10 bg-white px-4 py-10 text-center text-sm text-black/60 shadow-[0_16px_50px_rgba(0,0,0,0.08)]">
            Loading packing slips...
          </div>
        ) : null}
      </main>
    </>
  );
}
