import Head from "next/head";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import { useSession } from "../../hooks/useSession";

type InventoryCard = {
  id: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  valuationMinor: number | null;
  valuationCurrency: string;
  category: string;
  subcategory: string | null;
  updatedAt: string;
  inventoryBatchId: string | null;
};

type LocationSummary = {
  id: string;
  name: string;
  slug: string;
};

const formatMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);

export default function InventoryReady() {
  const { session, loading, ensureSession, logout } = useSession();
  const [cards, setCards] = useState<InventoryCard[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const dragModeRef = useRef<"select" | "deselect" | null>(null);
  const draggingRef = useRef(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const [loadingCards, setLoadingCards] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string>("");
  const [batchLabel, setBatchLabel] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignStatus, setAssignStatus] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const adminHeaders = useCallback(() => buildAdminHeaders(session?.token), [session?.token]);

  const selectedCards = useMemo(
    () => cards.filter((card) => selectedIds.has(card.id)),
    [cards, selectedIds]
  );

  const selectedValue = useMemo(() => {
    return selectedCards.reduce((total, card) => total + (card.valuationMinor ?? 0), 0);
  }, [selectedCards]);

  const missingValueCount = useMemo(
    () => selectedCards.filter((card) => card.valuationMinor === null).length,
    [selectedCards]
  );

  const averageValue = useMemo(() => {
    if (selectedCards.length === 0) {
      return 0;
    }
    return Math.round(selectedValue / selectedCards.length);
  }, [selectedCards.length, selectedValue]);

  useEffect(() => {
    if (!session || !isAdmin) {
      return;
    }

    const loadLocations = async () => {
      try {
        const res = await fetch("/api/admin/locations", { headers: adminHeaders() });
        if (!res.ok) {
          throw new Error("Failed to load locations");
        }
        const data = await res.json();
        setLocations(data.locations ?? []);
        if (!locationId && data.locations?.[0]?.id) {
          setLocationId(data.locations[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load locations");
      }
    };

    loadLocations();
  }, [adminHeaders, isAdmin, locationId, session]);

  useEffect(() => {
    if (!session || !isAdmin) {
      return;
    }

    const controller = new AbortController();
    setLoadingCards(true);
    setError(null);

    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        if (category) params.set("category", category);
        if (subcategory.trim()) params.set("subcategory", subcategory.trim());
        if (minValue.trim()) params.set("minValue", minValue.trim());
        if (maxValue.trim()) params.set("maxValue", maxValue.trim());
        if (sort) params.set("sort", sort);

        const res = await fetch(`/api/admin/inventory-ready/cards?${params.toString()}`, {
          headers: adminHeaders(),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error("Failed to load inventory-ready cards");
        }
        const data = await res.json();
        setCards(data.cards ?? []);
        setSelectedIds(new Set());
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load cards");
      } finally {
        setLoadingCards(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [adminHeaders, category, isAdmin, maxValue, minValue, search, session, sort, subcategory]);

  useEffect(() => {
    const stopDragging = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        dragModeRef.current = null;
        setDragging(false);
      }
    };
    window.addEventListener("mouseup", stopDragging);
    return () => window.removeEventListener("mouseup", stopDragging);
  }, []);

  const updateSelection = useCallback((id: string, mode?: "select" | "deselect") => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelect = mode === "select" ? true : mode === "deselect" ? false : !next.has(id);
      if (shouldSelect) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleCardMouseDown = (id: string) => (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const shouldSelect = !selectedIds.has(id);
    dragModeRef.current = shouldSelect ? "select" : "deselect";
    draggingRef.current = true;
    setDragging(true);
    updateSelection(id, dragModeRef.current);
  };

  const handleCardMouseEnter = (id: string) => {
    if (!draggingRef.current || !dragModeRef.current) {
      return;
    }
    updateSelection(id, dragModeRef.current);
  };

  const handleAssign = async () => {
    if (!locationId || selectedIds.size === 0) {
      return;
    }
    setAssigning(true);
    setAssignStatus(null);
    try {
      const res = await fetch("/api/admin/inventory-ready/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          cardIds: Array.from(selectedIds),
          locationId,
          label: batchLabel.trim() ? batchLabel.trim() : null,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to assign cards");
      }
      const payload = await res.json();
      setAssignStatus(`Assigned ${payload.updatedCount ?? 0} cards to location.`);
      setSelectedIds(new Set());
      setBatchLabel("");
      const refreshed = cards.filter((card) => !selectedIds.has(card.id));
      setCards(refreshed);
    } catch (err) {
      setAssignStatus(err instanceof Error ? err.message : "Failed to assign cards");
    } finally {
      setAssigning(false);
    }
  };

  const handleReturn = async () => {
    if (selectedIds.size === 0) {
      return;
    }
    setReturning(true);
    setAssignStatus(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/inventory-ready/return", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({ cardIds: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to return cards");
      }
      setCards((prev) => prev.filter((card) => !selectedIds.has(card.id)));
      setSelectedIds(new Set());
      setAssignStatus("Returned selected cards to KingsReview.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to return cards");
    } finally {
      setReturning(false);
    }
  };

  const content = () => {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Checking access…</p>
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

    return (
      <div className="flex flex-1 flex-col gap-6 px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.3em] text-violet-300">Inventory Ready for Sale</p>
            <h1 className="font-heading text-3xl uppercase tracking-[0.18em] text-white">Pick & Assign Inventory</h1>
            <p className="max-w-2xl text-sm text-slate-300">
              Filter the ready-for-sale pool, drag-select cards, and assign them to a live location batch.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
            <span className="rounded-full border border-white/10 px-3 py-1">
              Selected {selectedCards.length} card{selectedCards.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1">
              Total {formatMoney(selectedValue, "USD")}
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1">
              Avg {formatMoney(averageValue, "USD")}
            </span>
            {missingValueCount > 0 && (
              <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-amber-200">
                {missingValueCount} missing value
              </span>
            )}
          </div>
        </header>

        <section className="grid gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Search</label>
            <input
              className="w-full rounded-2xl border border-white/10 bg-night-800/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-400/60"
              placeholder="Player, team, or card name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Category</label>
            <select
              className="w-full rounded-2xl border border-white/10 bg-night-800/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-400/60"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">All</option>
              <option value="sport">Sports</option>
              <option value="tcg">TCG</option>
              <option value="comics">Comics</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Sub-category</label>
            <input
              className="w-full rounded-2xl border border-white/10 bg-night-800/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-400/60"
              placeholder="Basketball, Football, Pokémon..."
              value={subcategory}
              onChange={(event) => setSubcategory(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Sort</label>
            <select
              className="w-full rounded-2xl border border-white/10 bg-night-800/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-400/60"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="updated_desc">Newest updated</option>
              <option value="updated_asc">Oldest updated</option>
              <option value="value_desc">Highest value</option>
              <option value="value_asc">Lowest value</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Min Value</label>
            <input
              className="w-full rounded-2xl border border-white/10 bg-night-800/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-400/60"
              placeholder="25"
              value={minValue}
              onChange={(event) => setMinValue(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Max Value</label>
            <input
              className="w-full rounded-2xl border border-white/10 bg-night-800/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-400/60"
              placeholder="100"
              value={maxValue}
              onChange={(event) => setMaxValue(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Assign Location</label>
            <select
              className="w-full rounded-2xl border border-white/10 bg-night-800/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-400/60"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Batch Label (optional)</label>
            <input
              className="w-full rounded-2xl border border-white/10 bg-night-800/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-400/60"
              placeholder="Sacramento · $100 Sports run"
              value={batchLabel}
              onChange={(event) => setBatchLabel(event.target.value)}
            />
          </div>
          <div className="flex items-end gap-3">
            <button
              type="button"
              onClick={handleAssign}
              disabled={assigning || selectedIds.size === 0 || !locationId}
              className="w-full rounded-2xl border border-gold-500/60 bg-gold-500 px-4 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {assigning ? "Assigning..." : "Assign to Location"}
            </button>
            <button
              type="button"
              onClick={handleReturn}
              disabled={returning || selectedIds.size === 0}
              className="w-full rounded-2xl border border-white/20 bg-night-800/70 px-4 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-slate-200 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {returning ? "Returning..." : "Return to KingsReview"}
            </button>
          </div>
        </section>

        {assignStatus && (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {assignStatus}
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        <section className="flex flex-1 flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              {loadingCards ? "Loading cards..." : `${cards.length} cards ready`}
            </p>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs uppercase tracking-[0.3em] text-slate-300 hover:text-white"
            >
              Clear selection
            </button>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {cards.map((card) => {
              const selected = selectedIds.has(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  onMouseDown={handleCardMouseDown(card.id)}
                  onMouseEnter={() => handleCardMouseEnter(card.id)}
                  className={`group flex select-none flex-col gap-3 rounded-3xl border p-3 text-left transition ${
                    selected
                      ? "border-gold-400/80 bg-gold-500/10 shadow-glow"
                      : "border-white/10 bg-night-900/80 hover:border-white/30"
                  }`}
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-night-800">
                    <img
                      src={card.thumbnailUrl ?? card.imageUrl}
                      alt={card.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {selected && (
                      <span className="absolute right-2 top-2 rounded-full bg-gold-500 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-night-900">
                        Selected
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                      {card.category === "sport" ? "Sports" : card.category === "tcg" ? "TCG" : card.category === "comics" ? "Comics" : "Unknown"}
                      {card.subcategory ? ` · ${card.subcategory}` : ""}
                    </p>
                    <h3 className="text-sm font-semibold text-slate-100 line-clamp-2">{card.title}</h3>
                    <p className="text-sm text-emerald-200">
                      {card.valuationMinor !== null
                        ? formatMoney(card.valuationMinor, card.valuationCurrency)
                        : "No value yet"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    );
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Inventory Ready</title>
        <meta name="robots" content="noindex" />
      </Head>
      {content()}
    </AppShell>
  );
}
