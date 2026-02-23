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

type InventoryCardDetail = {
  id: string;
  fileName: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  customTitle: string | null;
  customDetails: string | null;
  ocrText: string | null;
  valuationMinor: number | null;
  valuationCurrency: string;
  classificationNormalized?: { [key: string]: unknown } | null;
  classification?: { [key: string]: unknown } | null;
  photos?: Array<{ id: string; kind: string; imageUrl: string }>;
};

type EvidenceItem = {
  id: string;
  title: string | null;
  url: string;
  screenshotUrl: string | null;
  price: string | null;
  soldDate: string | null;
};

type LocationSummary = {
  id: string;
  name: string;
  slug: string;
};

type JobResultComp = {
  title: string | null;
  url: string;
  price: string | null;
  soldDate: string | null;
  screenshotUrl: string | null;
  listingImageUrl: string | null;
};

const formatMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);

const formatMinorToDollarInput = (minor: number | null | undefined): string => {
  if (minor == null || !Number.isFinite(minor)) {
    return "";
  }
  return (minor / 100).toFixed(2);
};

const parseDollarInputToMinor = (input: string): number | null | undefined => {
  const normalized = input.replace(/[$,\s]/g, "").trim();
  if (!normalized) {
    return null;
  }
  if (!/^\d*(?:\.\d{0,2})?$/.test(normalized) || normalized === ".") {
    return undefined;
  }
  const [dollarsRaw, centsRaw = ""] = normalized.split(".");
  const dollars = dollarsRaw ? Number(dollarsRaw) : 0;
  if (!Number.isFinite(dollars)) {
    return undefined;
  }
  const cents = Number((centsRaw + "00").slice(0, 2));
  if (!Number.isFinite(cents)) {
    return undefined;
  }
  return Math.round(dollars * 100 + cents);
};

const normalizeNullableText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export default function InventoryReady() {
  const { session, loading, ensureSession, logout } = useSession();
  const [cards, setCards] = useState<InventoryCard[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeCardDetail, setActiveCardDetail] = useState<InventoryCardDetail | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [jobComps, setJobComps] = useState<JobResultComp[]>([]);
  const [jobSearchUrl, setJobSearchUrl] = useState<string | null>(null);
  const [valuationInput, setValuationInput] = useState("");
  const [valuationSaving, setValuationSaving] = useState(false);
  const [valuationError, setValuationError] = useState<string | null>(null);
  const [valuationNotice, setValuationNotice] = useState<string | null>(null);
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
  const [deleting, setDeleting] = useState(false);

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

  useEffect(() => {
    if (!activeCardId || !session || !isAdmin) {
      setActiveCardDetail(null);
      setEvidenceItems([]);
      setJobComps([]);
      setJobSearchUrl(null);
      setValuationInput("");
      setValuationError(null);
      setValuationNotice(null);
      return;
    }

    const loadDetails = async () => {
      try {
        const [cardRes, evidenceRes, jobRes] = await Promise.all([
          fetch(`/api/admin/cards/${activeCardId}`, { headers: adminHeaders() }),
          fetch(`/api/admin/kingsreview/evidence?cardAssetId=${activeCardId}`, { headers: adminHeaders() }),
          fetch(`/api/admin/kingsreview/jobs?cardAssetId=${activeCardId}`, { headers: adminHeaders() }),
        ]);
        if (cardRes.ok) {
          const data = await cardRes.json();
          const card = data.card ?? data;
          const nextValuationMinor = typeof card.valuationMinor === "number" ? card.valuationMinor : null;
          const nextValuationCurrency =
            typeof card.valuationCurrency === "string" && card.valuationCurrency.trim()
              ? card.valuationCurrency
              : "USD";
          setActiveCardDetail({
            id: card.id,
            fileName: card.fileName,
            imageUrl: card.imageUrl,
            thumbnailUrl: card.thumbnailUrl ?? null,
            customTitle: card.customTitle ?? null,
            customDetails: card.customDetails ?? null,
            ocrText: card.ocrText ?? null,
            valuationMinor: nextValuationMinor,
            valuationCurrency: nextValuationCurrency,
            classificationNormalized: card.classificationNormalized ?? null,
            classification: card.classification ?? null,
            photos: Array.isArray(card.photos) ? card.photos : [],
          });
          setValuationInput(formatMinorToDollarInput(nextValuationMinor));
          setValuationError(null);
          setValuationNotice(null);
        }
        if (evidenceRes.ok) {
          const data = await evidenceRes.json();
          setEvidenceItems(data.items ?? []);
        } else {
          setEvidenceItems([]);
        }
        if (jobRes.ok) {
          const data = await jobRes.json().catch(() => null);
          const sources = Array.isArray(data?.job?.result?.sources) ? data.job.result.sources : [];
          const ebaySource =
            sources.find((source: any) => String(source?.source ?? "").toLowerCase() === "ebay_sold") ??
            sources[0] ??
            null;
          const compsRaw = Array.isArray(ebaySource?.comps) ? ebaySource.comps : [];
          const parsedComps = compsRaw
            .map((comp: any) => {
              const url = normalizeNullableText(comp?.url);
              if (!url) {
                return null;
              }
              return {
                title: normalizeNullableText(comp?.title),
                url,
                price: normalizeNullableText(comp?.price),
                soldDate: normalizeNullableText(comp?.soldDate),
                screenshotUrl: normalizeNullableText(comp?.screenshotUrl),
                listingImageUrl: normalizeNullableText(comp?.listingImageUrl),
              } as JobResultComp;
            })
            .filter((comp: JobResultComp | null): comp is JobResultComp => Boolean(comp));
          setJobComps(parsedComps);
          setJobSearchUrl(normalizeNullableText(ebaySource?.searchUrl));
        } else {
          setJobComps([]);
          setJobSearchUrl(null);
        }
      } catch {
        // ignore
      }
    };

    loadDetails();
  }, [activeCardId, adminHeaders, isAdmin, session]);

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
    setActiveCardId(id);
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

  const saveActiveValuation = useCallback(async () => {
    if (!activeCardDetail) {
      return;
    }
    const parsed = parseDollarInputToMinor(valuationInput);
    if (parsed === undefined) {
      setValuationError("Enter a valid dollar value (example: 13.00).");
      return;
    }
    setValuationSaving(true);
    setValuationError(null);
    setValuationNotice(null);
    try {
      const res = await fetch(`/api/admin/cards/${activeCardDetail.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({ valuationMinor: parsed }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to save valuation");
      }
      const nextCurrency = activeCardDetail.valuationCurrency || "USD";
      setActiveCardDetail((prev) => (prev ? { ...prev, valuationMinor: parsed } : prev));
      setCards((prev) =>
        prev.map((card) =>
          card.id === activeCardDetail.id
            ? {
                ...card,
                valuationMinor: parsed,
                valuationCurrency: nextCurrency,
              }
            : card
        )
      );
      setValuationInput(formatMinorToDollarInput(parsed));
      setValuationNotice("Price valuation saved.");
    } catch (err) {
      setValuationError(err instanceof Error ? err.message : "Failed to save valuation");
    } finally {
      setValuationSaving(false);
    }
  }, [activeCardDetail, adminHeaders, valuationInput]);

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

  const handleDelete = async () => {
    if (selectedIds.size === 0) {
      return;
    }
    const confirmed = window.confirm(
      `Delete ${selectedIds.size} inventory-ready cards? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    setDeleting(true);
    setAssignStatus(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/inventory-ready/purge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({ cardIds: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to delete cards");
      }
      const payload = await res.json().catch(() => ({}));
      setCards((prev) => prev.filter((card) => !selectedIds.has(card.id)));
      setSelectedIds(new Set());
      setAssignStatus(`Deleted ${payload?.deleted ?? 0} cards.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete cards");
    } finally {
      setDeleting(false);
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
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || selectedIds.size === 0}
              className="w-full rounded-2xl border border-rose-400/60 bg-rose-500/20 px-4 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-rose-200 transition hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? "Deleting..." : "Delete Selected"}
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
                  onClick={() => setActiveCardId(card.id)}
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

          {activeCardDetail && (
            <div className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Selected Card Details</p>
              <div className="mt-4 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
                <div className="grid gap-3 md:grid-cols-3">
                  {(() => {
                    const photoMap = (activeCardDetail.photos ?? []).reduce<Record<string, string>>(
                      (acc, photo) => {
                        acc[photo.kind] = photo.imageUrl;
                        return acc;
                      },
                      {}
                    );
                    const photos = [
                      { label: "Front", url: photoMap.FRONT ?? activeCardDetail.imageUrl },
                      { label: "Back", url: photoMap.BACK },
                      { label: "Tilt", url: photoMap.TILT },
                    ];
                    return photos.map((photo) => (
                      <div key={photo.label} className="rounded-2xl border border-white/10 bg-night-800/70 p-2">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">{photo.label}</p>
                        <div className="mt-2 aspect-[4/5] overflow-hidden rounded-xl border border-white/10 bg-night-900">
                          {photo.url ? (
                            <img
                              src={photo.url}
                              alt={`${photo.label} image`}
                              className="h-full w-full object-contain"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.3em] text-slate-500">
                              Missing
                            </div>
                          )}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
                <div className="space-y-4 text-xs text-slate-300">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Title</p>
                    <p className="text-sm text-white">
                      {activeCardDetail.customTitle ?? activeCardDetail.fileName}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-200">Price Valuation (USD)</p>
                    <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-night-950/60 px-3 py-2">
                      <span className="text-sm text-emerald-200">$</span>
                      <input
                        inputMode="decimal"
                        value={valuationInput}
                        onChange={(event) => {
                          setValuationInput(event.target.value);
                          setValuationError(null);
                          setValuationNotice(null);
                        }}
                        onBlur={() => void saveActiveValuation()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void saveActiveValuation();
                          }
                        }}
                        placeholder="13.00"
                        className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                      />
                      <button
                        type="button"
                        onClick={() => void saveActiveValuation()}
                        disabled={valuationSaving}
                        className="rounded-full border border-emerald-400/50 bg-emerald-500/20 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-60"
                      >
                        {valuationSaving ? "Saving" : "Save"}
                      </button>
                    </div>
                    <p className={`mt-2 text-[10px] ${valuationError ? "text-rose-300" : "text-slate-400"}`}>
                      {valuationError ??
                        (valuationNotice
                          ? valuationNotice
                          : "Edit value here to update this card directly in Inventory Ready.")}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">OCR Text</p>
                    <div className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-[11px] text-slate-200">
                      {activeCardDetail.ocrText ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-night-950/60 px-3 py-3 text-[11px] uppercase tracking-[0.28em] text-slate-400">
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-500">Set</span>
                        <span className="text-slate-200">
                          {(activeCardDetail.classificationNormalized as any)?.setName ??
                            (activeCardDetail.classificationNormalized as any)?.setCode ??
                            "—"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-500">Card #</span>
                        <span className="text-slate-200">
                          {(activeCardDetail.classificationNormalized as any)?.cardNumber ??
                            (activeCardDetail.classification as any)?.cardNumber ??
                            "—"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-500">Year</span>
                        <span className="text-slate-200">
                          {(activeCardDetail.classificationNormalized as any)?.year ??
                            (activeCardDetail.classification as any)?.year ??
                            "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Attached Evidence</p>
                    <div className="mt-2 space-y-2">
                      {evidenceItems.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-night-900/60 px-3 py-2">
                          <div className="h-10 w-8 overflow-hidden rounded-lg border border-white/10 bg-night-900">
                            {item.screenshotUrl ? (
                              <img
                                src={item.screenshotUrl}
                                alt={item.title ?? "Evidence"}
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="flex-1">
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-sky-300 hover:text-sky-200"
                            >
                              {item.title ?? item.url}
                            </a>
                            <div className="text-[10px] text-slate-500">
                              {item.price ?? ""} {item.soldDate ?? ""}
                            </div>
                          </div>
                        </div>
                      ))}
                      {evidenceItems.length === 0 && (
                        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">No evidence attached.</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">eBay Sold Comps</p>
                      {jobSearchUrl && (
                        <a
                          href={jobSearchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center rounded-full border border-sky-400/70 bg-sky-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-100 transition hover:bg-sky-500/30"
                        >
                          Open eBay Search
                        </a>
                      )}
                    </div>
                    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                      {jobComps.map((comp, index) => (
                        <div
                          key={`${comp.url}-${index}`}
                          className="rounded-2xl border border-white/10 bg-night-900/60 p-2"
                        >
                          <div className="flex items-start gap-3">
                            <div className="h-20 w-16 overflow-hidden rounded-lg border border-white/10 bg-night-900">
                              {(comp.listingImageUrl || comp.screenshotUrl) ? (
                                <img
                                  src={comp.listingImageUrl ?? comp.screenshotUrl ?? ""}
                                  alt={comp.title ?? "Comp"}
                                  className="h-full w-full object-contain"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="text-xs font-semibold text-emerald-200">
                                {comp.price ?? "—"}{" "}
                                {comp.soldDate ? (
                                  <span className="font-normal text-slate-400">· Sold {comp.soldDate}</span>
                                ) : null}
                              </div>
                              <p className="line-clamp-2 text-xs text-slate-200">{comp.title ?? comp.url}</p>
                              <a
                                href={comp.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-slate-200 transition hover:border-white/40 hover:text-white"
                              >
                                Open Listing
                              </a>
                            </div>
                          </div>
                        </div>
                      ))}
                      {jobComps.length === 0 && (
                        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                          No comps found from latest KingsReview job.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
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
