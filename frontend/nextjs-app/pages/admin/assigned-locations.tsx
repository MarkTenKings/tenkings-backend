import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { AddLocationModal, type CreateLocationInput } from "../../components/admin/AddLocationModal";
import {
  ADMIN_PAGE_FRAME_CLASS,
  AdminPageHeader,
  adminPanelClass,
  adminStatCardClass,
} from "../../components/admin/AdminPrimitives";
import {
  formatCategoryLabel,
  formatCurrencyFromMinor,
  formatPackTierLabel,
  type AssignedLocationsResponse,
} from "../../lib/adminInventory";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import { useSession } from "../../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";

function ProgressBar({ packedCount, totalCount }: { packedCount: number; totalCount: number }) {
  const percent = totalCount > 0 ? Math.round((packedCount / totalCount) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-slate-500">
        <span>Packing Progress</span>
        <span>
          {packedCount}/{totalCount} packed
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/8">
        <div className="h-2 rounded-full bg-gold-400 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function AssignedLocationsPage() {
  const { session, loading, ensureSession, logout } = useSession();
  const [payload, setPayload] = useState<AssignedLocationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);
  const [locationCreateBusy, setLocationCreateBusy] = useState(false);
  const [locationCreateError, setLocationCreateError] = useState<string | null>(null);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const loadAssignedLocations = useCallback(
    async (options?: { signal?: AbortSignal; quiet?: boolean }) => {
      if (!options?.quiet) {
        setLoadingData(true);
      }

      try {
        const response = await fetch("/api/admin/assigned-locations", {
          headers: adminHeaders,
          signal: options?.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to load assigned locations");
        }
        const nextPayload = (await response.json()) as AssignedLocationsResponse;
        setPayload(nextPayload);
        setError(null);
      } catch (fetchError: unknown) {
        if ((fetchError as Error).name === "AbortError") {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load locations");
      } finally {
        if (!options?.quiet) {
          setLoadingData(false);
        }
      }
    },
    [adminHeaders]
  );

  useEffect(() => {
    if (!session?.token || !isAdmin) {
      return;
    }

    const controller = new AbortController();
    void loadAssignedLocations({ signal: controller.signal });

    return () => controller.abort();
  }, [isAdmin, loadAssignedLocations, session?.token]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const handleCreateLocation = async (value: CreateLocationInput) => {
    setLocationCreateBusy(true);
    setLocationCreateError(null);

    try {
      const response = await fetch("/api/admin/locations", {
        method: "POST",
        headers: buildAdminHeaders(session?.token, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(value),
      });
      const responseJson = (await response.json().catch(() => ({}))) as {
        message?: string;
        location?: { name?: string };
      };

      if (!response.ok) {
        throw new Error(responseJson.message ?? "Failed to create location");
      }

      setShowAddLocationModal(false);
      setNotice(`Location '${responseJson.location?.name ?? value.name}' created`);
      await loadAssignedLocations({ quiet: true });
    } catch (createError: unknown) {
      setLocationCreateError(createError instanceof Error ? createError.message : "Failed to create location");
    } finally {
      setLocationCreateBusy(false);
    }
  };

  const gate = (() => {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-500">Checking access...</p>
        </div>
      );
    }
    if (!session) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
        </div>
      );
    }
    if (!isAdmin) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
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
    return null;
  })();

  if (gate) {
    return (
      <AppShell>
        <Head>
          <title>Ten Kings · Assigned Locations</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Assigned Locations</title>
        <meta name="robots" content="noindex" />
      </Head>

      {notice ? (
        <div className="fixed right-4 top-4 z-50 max-w-md rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
          {notice}
        </div>
      ) : null}

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/admin"
          backLabel="← Admin Home"
          eyebrow="Inventory Routing"
          title="Assigned Locations"
          description="Create locations, prepare pack recipes before inventory arrives, and track assigned-card progress by location once batches start flowing."
          actions={
            <>
              <Link
                href="/admin/inventory"
                className="rounded-full border border-white/12 px-5 py-3 text-[11px] uppercase tracking-[0.24em] text-slate-200 transition hover:border-white/25 hover:text-white"
              >
                Go to Inventory
              </Link>
              <button
                type="button"
                onClick={() => {
                  setLocationCreateError(null);
                  setShowAddLocationModal(true);
                }}
                className="rounded-full border border-gold-400/45 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.24em] text-night-950 transition hover:bg-gold-400"
              >
                + Add Location
              </button>
            </>
          }
        />

        {error ? (
          <section className={adminPanelClass("border-rose-400/25 bg-rose-500/10 p-4")}>
            <p className="text-sm text-rose-200">{error}</p>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-4">
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Total Cards</p>
            <p className="mt-3 text-3xl font-semibold text-white">{payload?.summary.totalCards ?? 0}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Cards Today</p>
            <p className="mt-3 text-3xl font-semibold text-white">{payload?.summary.cardsToday ?? 0}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Cards This Week</p>
            <p className="mt-3 text-3xl font-semibold text-white">{payload?.summary.cardsThisWeek ?? 0}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Total Value</p>
            <p className="mt-3 text-3xl font-semibold text-emerald-300">
              {formatCurrencyFromMinor(payload?.summary.totalValue ?? 0)}
            </p>
          </article>
        </section>

        <section className={adminPanelClass("p-4 md:p-5")}>
          {loadingData ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="h-56 animate-pulse rounded-[24px] border border-white/10 bg-white/[0.03]" />
              ))}
            </div>
          ) : payload?.locations.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {payload.locations.map((location) => (
                <article
                  key={location.id}
                  className="relative rounded-[24px] border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.28)] transition hover:border-gold-400/25 hover:bg-white/[0.05]"
                >
                  <Link
                    href={`/admin/assigned-locations/${location.id}`}
                    aria-label={`View ${location.name}`}
                    className="absolute inset-0 rounded-[24px] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70"
                  />

                  <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                        {location.cardCount > 0 ? location.primaryStage ?? "In Routing" : "Recipe Planning Ready"}
                      </p>
                      <h2 className="font-heading text-2xl uppercase tracking-[0.12em] text-white">{location.name}</h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/admin/assigned-locations/${location.id}`}
                        className="relative z-10 rounded-full border border-white/15 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-slate-100 transition hover:border-white/35 hover:text-white"
                      >
                        View Location →
                      </Link>
                      <Link
                        href={`/admin/assigned-locations/${location.id}?tab=recipes`}
                        className="relative z-10 rounded-full border border-gold-400/45 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-gold-100 transition hover:border-gold-300 hover:text-white"
                      >
                        Pack Recipes
                      </Link>
                    </div>
                  </div>

                  <div className="relative z-10 mt-5 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Cards</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{location.cardCount}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Value</p>
                      <p className="mt-2 text-2xl font-semibold text-emerald-300">
                        {formatCurrencyFromMinor(location.totalValue)}
                      </p>
                    </div>
                  </div>

                  {location.cardCount > 0 ? (
                    <>
                      <div className="relative z-10 mt-5 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em]">
                        {location.categories.map((entry) => (
                          <span
                            key={`${entry.category}-${entry.count}`}
                            className="rounded-full border border-white/10 px-2.5 py-1 text-slate-300"
                          >
                            {formatCategoryLabel(entry.category)} · {entry.count}
                          </span>
                        ))}
                        {location.tiers.map((entry) => (
                          <span
                            key={`${entry.tier}-${entry.count}`}
                            className="rounded-full border border-white/10 px-2.5 py-1 text-slate-300"
                          >
                            {formatPackTierLabel(entry.tier)} · {entry.count}
                          </span>
                        ))}
                      </div>

                      <div className="relative z-10 mt-5 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                        {location.stageSummary.map((entry) => (
                          <span key={`${entry.stage}-${entry.count}`} className="rounded-full border border-white/10 px-2.5 py-1">
                            {entry.stage} · {entry.count}
                          </span>
                        ))}
                      </div>

                      <div className="relative z-10 mt-6">
                        <ProgressBar
                          packedCount={location.packingProgress.packedCount}
                          totalCount={location.packingProgress.totalCount}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="relative z-10 mt-6 rounded-[22px] border border-dashed border-white/12 bg-black/35 px-4 py-5">
                      <p className="text-sm text-white">No batches assigned yet</p>
                      <p className="mt-2 text-sm text-slate-400">
                        Create recipes now so this location is ready when cards arrive from Inventory.
                      </p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
              <h2 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">No locations yet</h2>
              <p className="max-w-xl text-sm text-slate-400">
                Create your first location to start managing inventory and pack recipes.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setLocationCreateError(null);
                    setShowAddLocationModal(true);
                  }}
                  className="rounded-full border border-gold-400/45 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.24em] text-night-950 transition hover:bg-gold-400"
                >
                  + Add Location
                </button>
                <Link
                  href="/admin/inventory"
                  className="rounded-full border border-white/12 px-5 py-3 text-[11px] uppercase tracking-[0.24em] text-slate-200 transition hover:border-white/25 hover:text-white"
                >
                  Go to Inventory
                </Link>
              </div>
            </div>
          )}
        </section>
      </div>

      {showAddLocationModal ? (
        <AddLocationModal
          busy={locationCreateBusy}
          error={locationCreateError}
          onClose={() => {
            if (locationCreateBusy) {
              return;
            }
            setLocationCreateError(null);
            setShowAddLocationModal(false);
          }}
          onCreate={(value) => void handleCreateLocation(value)}
        />
      ) : null}
    </AppShell>
  );
}
