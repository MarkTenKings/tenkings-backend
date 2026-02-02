import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import { useSession } from "../../hooks/useSession";

const STAGES = [
  { id: "BYTEBOT_RUNNING", label: "AI Running" },
  { id: "READY_FOR_HUMAN_REVIEW", label: "Ready" },
  { id: "ESCALATED_REVIEW", label: "Escalated" },
  { id: "REVIEW_COMPLETE", label: "Complete" },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  ebay_sold: "eBay Sold",
  tcgplayer: "TCGplayer",
  pricecharting: "PriceCharting",
  cardladder: "Card Ladder",
};

const AI_STATUS_MESSAGES = [
  "Searching sold listings",
  "Capturing evidence screenshots",
  "Checking TCGplayer comps",
  "Organizing results",
] as const;

type CardSummary = {
  id: string;
  fileName: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  customTitle: string | null;
  resolvedPlayerName: string | null;
  resolvedTeamName: string | null;
  valuationMinor: number | null;
  valuationCurrency: string | null;
  status: string;
  reviewStage: string | null;
  reviewStageUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CardDetail = CardSummary & {
  customDetails: string | null;
  classificationNormalized?: { categoryType?: string | null } | null;
};

type EvidenceItem = {
  id: string;
  kind: string;
  source: string;
  title: string | null;
  url: string;
  screenshotUrl: string | null;
  price: string | null;
  soldDate: string | null;
  note: string | null;
};

type JobResultComp = {
  source: string;
  title: string | null;
  url: string;
  price: string | null;
  soldDate: string | null;
  screenshotUrl: string;
  notes?: string | null;
};

type JobResultSource = {
  source: string;
  searchUrl: string;
  searchScreenshotUrl: string;
  comps: JobResultComp[];
  error?: string | null;
};

type BytebotJob = {
  id: string;
  status: string;
  searchQuery: string;
  result?: {
    sources: JobResultSource[];
  } | null;
};

export default function KingsReview() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const [stage, setStage] = useState<string>("BYTEBOT_RUNNING");
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<CardDetail | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [job, setJob] = useState<BytebotJob | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [activeCompIndex, setActiveCompIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [query, setQuery] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [enqueueing, setEnqueueing] = useState(false);
  const [aiMessageIndex, setAiMessageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [includeUnstaged, setIncludeUnstaged] = useState<boolean>(true);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const adminHeaders = useCallback(
    () => buildAdminHeaders(session?.token),
    [session?.token]
  );

  const sources = job?.result?.sources ?? [];
  const activeSourceData = sources.find((source) => source.source === activeSource) ?? sources[0] ?? null;
  const comps = activeSourceData?.comps ?? [];
  const activeComp = activeCompIndex !== null ? comps[activeCompIndex] : comps[0] ?? null;
  const aiStatus =
    job?.status === "IN_PROGRESS"
      ? "AI running"
      : job?.status === "QUEUED"
        ? "Queued"
        : job?.status === "COMPLETE"
          ? "AI complete"
          : job?.status === "FAILED"
            ? "AI failed"
            : null;
  const aiMessage = job?.status === "IN_PROGRESS" ? AI_STATUS_MESSAGES[aiMessageIndex] : null;

  useEffect(() => {
    if (!session || !isAdmin) {
      return;
    }

    const loadCards = async () => {
      setError(null);
      try {
        const queryString =
          stage === "READY_FOR_HUMAN_REVIEW" && includeUnstaged ? `?stage=${stage}&includeUnstaged=1` : `?stage=${stage}`;
        const res = await fetch(`/api/admin/kingsreview/cards${queryString}`, {
          headers: adminHeaders(),
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("Failed to load cards");
        }
        const data = await res.json();
        setCards(data.cards ?? []);
        const nextId = data.cards?.[0]?.id ?? null;
        setActiveCardId((prev) => prev ?? nextId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load cards");
      }
    };

    loadCards();
  }, [adminHeaders, includeUnstaged, isAdmin, session, stage]);

  useEffect(() => {
    if (!session || !isAdmin) {
      return;
    }
    const interval = setInterval(() => {
      const queryString =
        stage === "READY_FOR_HUMAN_REVIEW" && includeUnstaged ? `?stage=${stage}&includeUnstaged=1` : `?stage=${stage}`;
      fetch(`/api/admin/kingsreview/cards${queryString}`, {
        headers: adminHeaders(),
        cache: "no-store",
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data?.cards) {
            return;
          }
          setCards(data.cards);
          setActiveCardId((prev) => prev ?? data.cards?.[0]?.id ?? null);
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(interval);
  }, [adminHeaders, includeUnstaged, isAdmin, session, stage]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    const requestedStage = typeof router.query.stage === "string" ? router.query.stage : null;
    if (requestedStage && STAGES.some((entry) => entry.id === requestedStage)) {
      setStage(requestedStage);
    }
    const requestedCardId = typeof router.query.cardId === "string" ? router.query.cardId : null;
    if (requestedCardId) {
      setActiveCardId(requestedCardId);
    }
  }, [router.isReady, router.query.cardId, router.query.stage]);

  useEffect(() => {
    if (!activeCardId || !session || !isAdmin) {
      return;
    }

    const loadCard = async () => {
      setError(null);
      try {
        const res = await fetch(`/api/admin/cards/${activeCardId}`, {
          headers: adminHeaders(),
        });
        if (!res.ok) {
          throw new Error("Failed to load card");
        }
        const data = await res.json();
        const card = data.card ?? data;
        setActiveCard({
          id: card.id,
          fileName: card.fileName,
          imageUrl: card.imageUrl,
          thumbnailUrl: card.thumbnailUrl,
          customTitle: card.customTitle ?? null,
          customDetails: card.customDetails ?? null,
          resolvedPlayerName: card.sportsDb?.playerName ?? card.resolvedPlayerName ?? null,
          resolvedTeamName: card.sportsDb?.teamName ?? card.resolvedTeamName ?? null,
          valuationMinor: card.valuationMinor ?? null,
          valuationCurrency: card.valuationCurrency ?? "USD",
          status: card.status,
          reviewStage: card.reviewStage ?? null,
          reviewStageUpdatedAt: card.reviewStageUpdatedAt ?? null,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          classificationNormalized: card.classificationNormalized ?? null,
        });
        setQuery(card.customTitle ?? card.fileName ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load card");
      }
    };

    const loadJob = async () => {
      try {
        const res = await fetch(`/api/admin/kingsreview/jobs?cardAssetId=${activeCardId}`, {
          headers: adminHeaders(),
        });
        if (!res.ok) {
          setJob(null);
          return;
        }
        const data = await res.json();
        setJob(data.job ?? null);
        const nextSource = data.job?.result?.sources?.[0]?.source ?? null;
        setActiveSource((prev) => prev ?? nextSource);
        setActiveCompIndex(null);
      } catch (err) {
        setJob(null);
      }
    };

    const loadEvidence = async () => {
      try {
        const res = await fetch(`/api/admin/kingsreview/evidence?cardAssetId=${activeCardId}`, {
          headers: adminHeaders(),
        });
        if (!res.ok) {
          setEvidenceItems([]);
          return;
        }
        const data = await res.json();
        setEvidenceItems(data.items ?? []);
      } catch (err) {
        setEvidenceItems([]);
      }
    };

    loadCard();
    loadJob();
    loadEvidence();
  }, [activeCardId, adminHeaders, isAdmin, session]);

  useEffect(() => {
    if (!activeCardId || !session || !isAdmin) {
      return;
    }

    if (job?.status !== "IN_PROGRESS" && job?.status !== "QUEUED") {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/kingsreview/jobs?cardAssetId=${activeCardId}`, {
          headers: adminHeaders(),
        });
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        setJob(data.job ?? null);
      } catch (err) {
        // ignore polling errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeCardId, adminHeaders, isAdmin, job?.status, session]);

  useEffect(() => {
    if (job?.status !== "IN_PROGRESS") {
      setAiMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setAiMessageIndex((prev) => (prev + 1) % AI_STATUS_MESSAGES.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [job?.status]);

  const handleSave = async () => {
    if (!activeCard) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cards/${activeCard.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          customTitle: activeCard.customTitle,
          customDetails: activeCard.customDetails,
          valuationMinor: activeCard.valuationMinor,
          valuationCurrency: activeCard.valuationCurrency,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to save changes");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const handleStageUpdate = async (nextStage: string) => {
    if (!activeCard) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cards/${activeCard.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({ reviewStage: nextStage }),
      });
      if (!res.ok) {
        throw new Error("Failed to update stage");
      }
      setStage(nextStage);
      setActiveCardId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update stage");
    } finally {
      setSaving(false);
    }
  };

  const handleEnqueue = async () => {
    if (!activeCardId || !query.trim()) {
      return;
    }
    setEnqueueing(true);
    setError(null);
    try {
      const categoryType = activeCard?.classificationNormalized?.categoryType ?? null;
      const sourceList =
        categoryType === "tcg"
          ? ["ebay_sold", "tcgplayer", "pricecharting", "cardladder"]
          : ["ebay_sold", "pricecharting", "cardladder"];
      const res = await fetch("/api/admin/kingsreview/enqueue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          query,
          cardAssetId: activeCardId,
          sources: sourceList,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to enqueue job");
      }
      const data = await res.json();
      setJob(data.job ?? null);
      setActiveSource(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enqueue job");
    } finally {
      setEnqueueing(false);
    }
  };

  const handleAttachComp = async (comp: JobResultComp, kind: string) => {
    if (!activeCardId) {
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/admin/kingsreview/evidence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          cardAssetId: activeCardId,
          kind,
          source: comp.source,
          title: comp.title,
          url: comp.url,
          screenshotUrl: comp.screenshotUrl,
          price: comp.price,
          soldDate: comp.soldDate,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to attach comp");
      }
      const data = await res.json();
      setEvidenceItems((prev) => [data.item, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to attach comp");
    }
  };

  const handleAttachSearch = async () => {
    if (!activeCardId || !activeSourceData) {
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/admin/kingsreview/evidence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          cardAssetId: activeCardId,
          kind: "SEARCH_PAGE",
          source: activeSourceData.source,
          title: `${SOURCE_LABELS[activeSourceData.source] ?? activeSourceData.source} Search`,
          url: activeSourceData.searchUrl,
          screenshotUrl: activeSourceData.searchScreenshotUrl,
          note: "Search results overview",
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to attach search evidence");
      }
      const data = await res.json();
      setEvidenceItems((prev) => [data.item, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to attach search evidence");
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Checking access…</p>
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
      <div className="flex h-full flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gold-300">Ten Kings · KingsReview</p>
            <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">KingsReview</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/admin/uploads"
              className="rounded-full border border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/40 hover:text-white"
            >
              Add Cards
            </Link>
            <Link
              href="/admin/inventory-ready"
              className="rounded-full border border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/40 hover:text-white"
            >
              Inventory Ready
            </Link>
            <Link
              href="/admin/location-batches"
              className="rounded-full border border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/40 hover:text-white"
            >
              Location Batches
            </Link>
            <Link
              href="/admin"
              className="rounded-full border border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/40 hover:text-white"
            >
              Back to Admin
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {STAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setStage(item.id);
                  setActiveCardId(null);
                  setCards([]);
                }}
                className={`rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.3em] transition ${
                  stage === item.id
                    ? "border-gold-400 bg-gold-500/20 text-gold-200"
                    : "border-white/20 text-slate-300 hover:border-white/40 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
            {stage === "READY_FOR_HUMAN_REVIEW" && (
              <button
                type="button"
                onClick={() => setIncludeUnstaged((prev) => !prev)}
                className={`rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.3em] transition ${
                  includeUnstaged
                    ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                    : "border-white/20 text-slate-300 hover:border-white/40 hover:text-white"
                }`}
              >
                {includeUnstaged ? "Including Unstaged" : "Hide Unstaged"}
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="grid flex-1 min-h-0 gap-6 lg:grid-cols-[1.1fr_1.4fr_1.1fr]">
          <section className="flex h-full min-h-0 flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Card Queue</p>
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">{cards.length} cards</p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pr-2">
              <div className="max-h-40 overflow-auto rounded-2xl border border-white/10 bg-night-950/50 p-2">
                {cards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setActiveCardId(card.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-xs transition ${
                      activeCardId === card.id
                        ? "bg-gold-500/15 text-gold-200"
                        : "text-slate-300 hover:bg-white/5"
                    }`}
                  >
                    <span className="line-clamp-1 flex-1">
                      {card.customTitle ?? card.resolvedPlayerName ?? card.fileName}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                      {new Date(card.updatedAt).toLocaleTimeString()}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">{card.status}</span>
                  </button>
                ))}
                {cards.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs uppercase tracking-[0.3em] text-slate-500">
                    No cards in this stage
                  </p>
                )}
              </div>

              {aiStatus && (
                <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-night-950/60 px-3 py-2">
                  <span className="inline-flex h-4 w-4 items-center justify-center">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                  </span>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-slate-300">{aiStatus}</div>
                  {aiMessage && <div className="text-xs text-slate-500">{aiMessage}</div>}
                </div>
              )}

              {activeCard ? (
                <div className="mt-4 flex flex-col gap-4">
                  <div className="grid gap-4">
                    <div className="aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-night-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeCard.thumbnailUrl ?? activeCard.imageUrl}
                        alt={activeCard.fileName}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="space-y-3 text-xs text-slate-300">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Custom Title</span>
                        <input
                          value={activeCard.customTitle ?? ""}
                          onChange={(event) =>
                            setActiveCard((prev) => (prev ? { ...prev, customTitle: event.target.value } : prev))
                          }
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none focus:border-gold-400/60"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Notes</span>
                        <textarea
                          value={activeCard.customDetails ?? ""}
                          onChange={(event) =>
                            setActiveCard((prev) => (prev ? { ...prev, customDetails: event.target.value } : prev))
                          }
                          rows={4}
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none focus:border-gold-400/60"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Valuation</span>
                          <input
                            value={activeCard.valuationMinor ?? ""}
                            onChange={(event) =>
                              setActiveCard((prev) =>
                                prev ? { ...prev, valuationMinor: Number(event.target.value) || null } : prev
                              )
                            }
                            className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none focus:border-gold-400/60"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Currency</span>
                          <input
                            value={activeCard.valuationCurrency ?? "USD"}
                            onChange={(event) =>
                              setActiveCard((prev) =>
                                prev ? { ...prev, valuationCurrency: event.target.value } : prev
                              )
                            }
                            className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none focus:border-gold-400/60"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500">
                        <span>{activeCard.resolvedPlayerName ?? "Unknown player"}</span>
                        <span>•</span>
                        <span>{activeCard.resolvedTeamName ?? "Unknown team"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="rounded-full border border-gold-400/60 bg-gold-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-gold-200 transition hover:border-gold-300 disabled:opacity-60"
                    >
                      {saving ? "Saving…" : "Save Card"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStageUpdate("INVENTORY_READY_FOR_SALE")}
                      disabled={saving}
                      className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-300 disabled:opacity-60"
                    >
                      Move to Inventory Ready
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStageUpdate("ESCALATED_REVIEW")}
                      disabled={saving}
                      className="rounded-full border border-rose-400/60 bg-rose-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-rose-200 transition hover:border-rose-300 disabled:opacity-60"
                    >
                      Escalate Review
                    </button>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Research Query</p>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        className="flex-1 rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none focus:border-gold-400/60"
                      />
                      <button
                        type="button"
                        onClick={handleEnqueue}
                        disabled={enqueueing}
                        className="rounded-full border border-sky-400/60 bg-sky-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-sky-200 transition hover:border-sky-300 disabled:opacity-60"
                      >
                        {enqueueing ? "Running…" : "Run"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Attached Evidence</p>
                    <div className="mt-2 space-y-2">
                      {evidenceItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 text-xs text-slate-300">
                          <span className="line-clamp-1">{item.title ?? item.url}</span>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] uppercase tracking-[0.3em] text-sky-300"
                          >
                            Open
                          </a>
                        </div>
                      ))}
                      {evidenceItems.length === 0 && (
                        <p className="text-xs text-slate-500">No evidence attached yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs uppercase tracking-[0.3em] text-slate-500">
                  Select a card to review
                </div>
              )}
            </div>
          </section>

          <section className="flex h-full min-h-0 flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Evidence Scroll</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.max(0.5, prev - 0.1))}
                className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-300"
                >
                  -
                </button>
                <span className="text-xs text-slate-400">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((prev) => Math.min(2, prev + 0.1))}
                  className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-300"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {sources.map((source) => (
                <button
                  key={source.source}
                  type="button"
                  onClick={() => {
                    setActiveSource(source.source);
                    setActiveCompIndex(null);
                  }}
                  className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em] transition ${
                    activeSourceData?.source === source.source
                      ? "border-sky-400/60 bg-sky-500/20 text-sky-200"
                      : "border-white/10 text-slate-400"
                  }`}
                >
                  {SOURCE_LABELS[source.source] ?? source.source}
                </button>
              ))}
            </div>
            {activeSourceData && (
              <div className="flex flex-wrap items-center gap-2">
                {activeSourceData.searchScreenshotUrl && (
                  <a
                    href={activeSourceData.searchScreenshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-300"
                  >
                    Open Image
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleAttachSearch}
                  className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-emerald-200"
                >
                  Attach Search
                </button>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-night-950/60 p-3">
              {activeSourceData ? (
                <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                  {activeSourceData.error && (
                    <div className="mb-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                      {activeSourceData.error}
                    </div>
                  )}
                  {activeSourceData.searchScreenshotUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeSourceData.searchScreenshotUrl}
                        alt={`${activeSourceData.source} search screenshot`}
                        className="w-full"
                      />
                    </>
                  ) : (
                    <div className="text-xs text-slate-500">
                      No search screenshot captured yet. Use “Open Search” to verify results.
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.3em] text-slate-500">
                  No evidence captured yet
                </div>
              )}
            </div>
          </section>

          <section className="flex h-full min-h-0 flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Comp Detail</p>
              {activeSourceData?.searchUrl && (
                <a
                  href={activeSourceData.searchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] uppercase tracking-[0.3em] text-sky-300"
                >
                  Open Search
                </a>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-night-950/60 p-3">
              {comps.length === 0 && (
                <p className="text-xs text-slate-500">No comps captured yet. Try re-running research.</p>
              )}
              <div className="space-y-3">
                {comps.map((comp, index) => (
                  <button
                    key={`${comp.url}-${index}`}
                    type="button"
                    onClick={() => setActiveCompIndex(index)}
                    className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left text-xs transition ${
                      activeCompIndex === index
                        ? "border-sky-400/60 bg-sky-500/10 text-sky-200"
                        : "border-white/10 text-slate-300 hover:border-white/30"
                    }`}
                  >
                    <span className="line-clamp-1 flex-1">{comp.title ?? comp.url}</span>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                      {comp.price ?? ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {activeComp && (
              <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-night-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={activeComp.screenshotUrl} alt={activeComp.title ?? "Comp"} className="h-full w-full object-cover" />
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-300">
                  <p className="text-sm text-white">{activeComp.title ?? "Untitled comp"}</p>
                  <p>{activeComp.price ?? ""}</p>
                  <p className="text-slate-500">{activeComp.soldDate ?? ""}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={activeComp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-white/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-slate-300"
                  >
                    Open Listing
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      handleAttachComp(activeComp, activeComp.source === "tcgplayer" ? "MARKET_COMP" : "SOLD_COMP")
                    }
                    className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-emerald-200"
                  >
                    Attach to Card
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
        )
      </div>
    );
  };

  return (
    <AppShell>
      <Head>
        <title>KingsReview · Ten Kings</title>
      </Head>
      {renderContent()}
    </AppShell>
  );
}
