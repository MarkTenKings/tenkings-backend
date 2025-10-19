import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import AppShell from "../../components/AppShell";
import { useSession } from "../../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { buildAdminHeaders } from "../../lib/adminHeaders";

interface DefinitionSummary {
  id: string;
  name: string;
  description: string | null;
  price: number;
  inventoryCount: number;
  category: string;
  tier: string;
  createdAt: string;
  updatedAt: string;
  totalPacks: number;
  unopenedPacks: number;
  openedPacks: number;
}

interface SlotPreview {
  id: string;
  itemId: string;
  itemName: string | null;
  itemSet: string;
  estimatedValue: number | null;
  status: string;
}

interface PackPreview {
  id: string;
  status: string;
  ownerId: string | null;
  createdAt: string;
  openedAt: string | null;
  slots: SlotPreview[];
}

export default function AdminPacks() {
  const { session, loading, ensureSession, logout } = useSession();
  const [definitions, setDefinitions] = useState<DefinitionSummary[]>([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [definitionsError, setDefinitionsError] = useState<string | null>(null);
  const [activeDefinitionId, setActiveDefinitionId] = useState<string | null>(null);
  const [packs, setPacks] = useState<PackPreview[] | null>(null);
  const [packsLoading, setPacksLoading] = useState(false);
  const [packsError, setPacksError] = useState<string | null>(null);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  useEffect(() => {
    if (!session?.token || !isAdmin) {
      return;
    }
    setDefinitionsLoading(true);
    setDefinitionsError(null);
    fetch("/api/admin/packs/definitions", {
      headers: buildAdminHeaders(session.token),
    })
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load pack definitions");
        }
        const payload = (await res.json()) as { definitions: DefinitionSummary[] };
        setDefinitions(payload.definitions);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load pack definitions";
        setDefinitionsError(message);
      })
      .finally(() => setDefinitionsLoading(false));
  }, [session?.token, isAdmin]);

  useEffect(() => {
    if (!session?.token || !isAdmin || !activeDefinitionId) {
      return;
    }
    setPacks(null);
    setPacksLoading(true);
    setPacksError(null);
    const controller = new AbortController();
    fetch(`/api/admin/packs/${activeDefinitionId}`, {
      headers: buildAdminHeaders(session.token),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load pack inventory");
        }
        const payload = (await res.json()) as { packs: PackPreview[] };
        setPacks(payload.packs);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load pack inventory";
        setPacksError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPacksLoading(false);
        }
      });
    return () => controller.abort();
  }, [session?.token, isAdmin, activeDefinitionId]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Checking access…</p>
        </div>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin access required</p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign in
          </button>
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access denied</p>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-8 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Pack Inventory</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-[0.32em] text-violet-300">Inventory</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">Pack Definitions</h1>
          <p className="text-sm text-slate-400">
            Review live inventory for each category and tier. Select a definition to inspect the current pack contents.
          </p>
        </header>

        {definitionsError && (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">
            {definitionsError}
          </div>
        )}

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-night-900/60">
          <table className="min-w-full divide-y divide-white/10 text-sm text-slate-200">
            <thead className="bg-white/5 text-xs uppercase tracking-[0.26em] text-slate-400">
              <tr>
                <th className="px-6 py-4 text-left">Definition</th>
                <th className="px-4 py-4 text-left">Category</th>
                <th className="px-4 py-4 text-left">Tier</th>
                <th className="px-4 py-4 text-right">Inventory</th>
                <th className="px-4 py-4 text-right">Opened</th>
                <th className="px-4 py-4 text-right">Total</th>
                <th className="px-6 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {definitionsLoading && definitions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-5 text-center text-slate-400">
                    Loading definitions…
                  </td>
                </tr>
              ) : definitions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-5 text-center text-slate-400">
                    No pack definitions found.
                  </td>
                </tr>
              ) : (
                definitions.map((definition) => (
                  <tr key={definition.id} className={activeDefinitionId === definition.id ? "bg-white/5" : undefined}>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-white">{definition.name}</div>
                      {definition.description && <div className="text-xs text-slate-400">{definition.description}</div>}
                    </td>
                    <td className="px-4 py-4">{definition.category}</td>
                    <td className="px-4 py-4">{definition.tier}</td>
                    <td className="px-4 py-4 text-right font-semibold text-gold-300">{definition.inventoryCount}</td>
                    <td className="px-4 py-4 text-right">{definition.openedPacks}</td>
                    <td className="px-4 py-4 text-right">{definition.totalPacks}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setActiveDefinitionId(definition.id === activeDefinitionId ? null : definition.id)}
                        className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.28em] text-slate-200 transition hover:border-white/40 hover:text-white"
                      >
                        {activeDefinitionId === definition.id ? "Hide" : "View"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {activeDefinitionId && (
          <section className="space-y-4">
            <header className="flex items-center justify-between">
              <h2 className="font-heading text-2xl uppercase tracking-[0.24em] text-white">Pack Contents</h2>
              {packsError && <p className="text-sm text-rose-200">{packsError}</p>}
            </header>
            {packsLoading ? (
              <div className="rounded-2xl border border-white/10 bg-night-900/60 px-6 py-10 text-center text-sm text-slate-400">
                Loading pack details…
              </div>
            ) : !packs || packs.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-night-900/60 px-6 py-10 text-center text-sm text-slate-400">
                No packs currently minted for this definition.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {packs.map((pack) => (
                  <div key={pack.id} className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.26em] text-slate-400">
                      <span>{pack.status}</span>
                      <span>{new Date(pack.createdAt).toLocaleString()}</span>
                    </div>
                    {pack.openedAt && (
                      <p className="mt-2 text-xs text-slate-400">Opened {new Date(pack.openedAt).toLocaleString()}</p>
                    )}
                    <div className="mt-4 grid gap-3">
                      {pack.slots.map((slot) => (
                        <div key={slot.id} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>Item ID {slot.itemId}</span>
                            <span>{slot.status}</span>
                          </div>
                          <h3 className="mt-1 text-sm text-white">{slot.itemName ?? "Vaulted Item"}</h3>
                          <p className="text-xs text-slate-400">{slot.itemSet}</p>
                          <p className="mt-1 text-xs text-slate-300">
                            Estimated Value: {slot.estimatedValue ? `${(slot.estimatedValue / 100).toFixed(2)} TKD` : "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
