import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import { useSession } from "../../hooks/useSession";

const STAGES = [
  { id: "BYTEBOT_RUNNING", label: "AI Running" },
  { id: "READY_FOR_HUMAN_REVIEW", label: "Ready" },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  ebay_sold: "eBay Sold",
};

const AI_STATUS_MESSAGES = [
  "Searching sold listings",
  "Collecting comps",
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
  ocrText?: string | null;
  classification?: Record<string, unknown> | null;
  customDetails: string | null;
  classificationNormalized?: { categoryType?: string | null } | null;
  photos?: Array<{ id: string; kind: string; imageUrl: string; thumbnailUrl?: string | null }>;
  variantId?: string | null;
  variantConfidence?: number | null;
  variantDecision?: {
    selectedParallelId: string | null;
    confidence: number | null;
    humanOverride: boolean;
    humanNotes: string | null;
    candidates: Array<{
      parallelId: string;
      confidence: number | null;
      reason: string | null;
    }>;
  } | null;
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
  listingImageUrl?: string | null;
  notes?: string | null;
  patternMatch?: {
    score: number;
    distance: number;
    colorDistance: number;
    tier: "verified" | "likely" | "weak" | "none";
  };
};

type VariantCandidate = {
  parallelId: string;
  confidence: number | null;
  reason: string | null;
};

type VariantReference = {
  id: string;
  setId: string;
  parallelId: string;
  rawImageUrl: string;
  cropUrls: string[];
  qualityScore: number | null;
};

type PatternTier = "verified" | "likely" | "weak" | "none";

type VariantReasonParts = {
  mode: string;
  foilScore: number | null;
};

const parseVariantReason = (reason: string | null | undefined): VariantReasonParts => {
  if (!reason) {
    return { mode: "unknown", foilScore: null };
  }
  const parts = reason.split("|").map((part) => part.trim());
  const mode = parts[0] || "unknown";
  const foilPart = parts.find((part) => part.startsWith("foil="));
  const foilScore = foilPart ? Number(foilPart.replace("foil=", "")) : null;
  return { mode, foilScore: Number.isFinite(foilScore) ? foilScore : null };
};

const patternBadgeClass = (tier: PatternTier) => {
  switch (tier) {
    case "verified":
      return "border-emerald-400/60 bg-emerald-500/20 text-emerald-200";
    case "likely":
      return "border-sky-400/60 bg-sky-500/20 text-sky-200";
    case "weak":
      return "border-amber-400/60 bg-amber-500/20 text-amber-200";
    default:
      return "border-white/10 text-slate-400";
  }
};

const queueStatusMeta = (card: CardSummary) => {
  const rawStatus = (card.status ?? "").toLowerCase().trim();
  const rawStage = (card.reviewStage ?? "").toLowerCase().trim();
  const errorStates = new Set(["error", "failed", "failure", "ocr_failed", "bytebot_failed"]);

  if (errorStates.has(rawStatus) || rawStatus.endsWith("_error") || rawStatus.endsWith("_failed")) {
    return { label: "ERROR", className: "border-rose-400/50 bg-rose-500/20 text-rose-200" };
  }
  if (rawStatus.includes("process") || rawStatus.includes("running") || rawStage === "bytebot_running") {
    return { label: "PROCESSING", className: "border-sky-400/50 bg-sky-500/20 text-sky-200" };
  }
  if (rawStatus.includes("ready") || rawStage === "ready_for_human_review") {
    return { label: "READY", className: "border-emerald-400/50 bg-emerald-500/20 text-emerald-200" };
  }
  if (rawStatus.includes("queue") || rawStatus.includes("pend") || !rawStatus) {
    return { label: "QUEUED", className: "border-amber-400/40 bg-amber-500/15 text-amber-200" };
  }
  return { label: "", className: "" };
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

type PlaybookRule = {
  id: string;
  source: string;
  action: string;
  selector: string;
  urlContains: string | null;
  label: string | null;
  priority: number;
  enabled: boolean;
};

export default function KingsReview() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const [stage, setStage] = useState<string>("READY_FOR_HUMAN_REVIEW");
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsOffset, setCardsOffset] = useState(0);
  const [cardsHasMore, setCardsHasMore] = useState(true);
  const [cardsLoadingMore, setCardsLoadingMore] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<CardDetail | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [job, setJob] = useState<BytebotJob | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [activeCompIndex, setActiveCompIndex] = useState<number | null>(null);
  const [activePhotoKind, setActivePhotoKind] = useState<"FRONT" | "BACK" | "TILT">("FRONT");
  const [activeCardImageUrl, setActiveCardImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [query, setQuery] = useState<string>("");
  const [queryTouched, setQueryTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [variantNotes, setVariantNotes] = useState("");
  const [variantSetId, setVariantSetId] = useState("");
  const [variantCardNumber, setVariantCardNumber] = useState("");
  const [variantInspectOpen, setVariantInspectOpen] = useState(false);
  const [variantInspectCandidate, setVariantInspectCandidate] = useState<VariantCandidate | null>(null);
  const [variantInspectRefs, setVariantInspectRefs] = useState<VariantReference[]>([]);
  const [variantInspectLoading, setVariantInspectLoading] = useState(false);
  const [enqueueing, setEnqueueing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [aiMessageIndex, setAiMessageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [showTeach, setShowTeach] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteSelection, setDeleteSelection] = useState<string[]>([]);
  const [playbookRules, setPlaybookRules] = useState<PlaybookRule[]>([]);
  const lastJobIdRef = useRef<string | null>(null);
  const cardDetailCacheRef = useRef<Map<string, CardDetail>>(new Map());
  const inflightCardRef = useRef<Map<string, Promise<CardDetail | null>>>(new Map());
  const imagePreloadRef = useRef<Set<string>>(new Set());
  const [teachForm, setTeachForm] = useState({
    source: "ebay_sold",
    action: "click",
    selector: "",
    urlContains: "",
    label: "",
    priority: 0,
    enabled: true,
  });

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const adminHeaders = useCallback(
    () => buildAdminHeaders(session?.token),
    [session?.token]
  );
  const toggleDeleteSelection = useCallback((cardId: string) => {
    setDeleteSelection((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    );
  }, []);
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setDeleteSelection(checked ? cards.map((card) => card.id) : []);
    },
    [cards]
  );
  const handleDeleteSelected = useCallback(async () => {
    if (deleteSelection.length === 0) {
      return;
    }
    setPurging(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/kingsreview/purge", {
        method: "POST",
        headers: { ...adminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ cardIds: deleteSelection }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to delete cards");
      }
      const payload = await res.json().catch(() => ({}));
      const remainingCards = cards.filter((card) => !deleteSelection.includes(card.id));
      setCards(remainingCards);
      setActiveCardId((prev) => {
        if (!prev || !deleteSelection.includes(prev)) {
          return prev;
        }
        return remainingCards[0]?.id ?? null;
      });
      setError(`Deleted ${payload?.deleted ?? deleteSelection.length} cards from KingsReview.`);
      setShowDeleteConfirm(false);
      setShowDeleteDialog(false);
      setDeleteSelection([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete cards");
    } finally {
      setPurging(false);
    }
  }, [adminHeaders, cards, deleteSelection]);

  const sources = job?.result?.sources ?? [];
  const activeSourceData = sources.find((source) => source.source === activeSource) ?? sources[0] ?? null;
  const comps = activeSourceData?.comps ?? [];
  const activeComp = activeCompIndex !== null ? comps[activeCompIndex] : comps[0] ?? null;
  const normalizeCompUrl = useCallback((value: string | null | undefined) => {
    if (!value) {
      return "";
    }
    try {
      const parsed = new URL(value);
      return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "").toLowerCase()}`;
    } catch {
      return value.trim().toLowerCase();
    }
  }, []);
  const attachedCompKeys = useMemo(() => {
    return new Set(
      evidenceItems
        .filter((item) => item.kind === "SOLD_COMP")
        .map((item) => normalizeCompUrl(item.url))
        .filter(Boolean)
    );
  }, [evidenceItems, normalizeCompUrl]);
  const rulesForActiveSource = playbookRules.filter(
    (rule) => rule.source === (activeSourceData?.source ?? teachForm.source)
  );
  const activePhotos = useMemo(() => {
    if (!activeCard?.photos?.length) {
      return {};
    }
    return activeCard.photos.reduce<Record<string, string>>((acc, photo) => {
      const key = typeof photo.kind === "string" ? photo.kind.toUpperCase() : photo.kind;
      acc[key] = photo.imageUrl;
      if (typeof key === "string") {
        acc[key.toLowerCase()] = photo.imageUrl;
      }
      return acc;
    }, {});
  }, [activeCard?.photos]);
  const activePhotoThumbs = useMemo(() => {
    if (!activeCard?.photos?.length) {
      return {};
    }
    return activeCard.photos.reduce<Record<string, string>>((acc, photo) => {
      if (!photo.thumbnailUrl) {
        return acc;
      }
      const key = typeof photo.kind === "string" ? photo.kind.toUpperCase() : photo.kind;
      acc[key] = photo.thumbnailUrl;
      if (typeof key === "string") {
        acc[key.toLowerCase()] = photo.thumbnailUrl;
      }
      return acc;
    }, {});
  }, [activeCard?.photos]);
  const activeAttributes = useMemo(() => {
    if (!activeCard?.classification || typeof activeCard.classification !== "object") {
      return null;
    }
    const raw = activeCard.classification as Record<string, unknown>;
    const attributes = raw.attributes;
    if (attributes && typeof attributes === "object") {
      return attributes as Record<string, unknown>;
    }
    return raw;
  }, [activeCard?.classification]);
  const isRunningStage =
    (activeCard?.reviewStage ?? stage) === "BYTEBOT_RUNNING";
  const aiStatus =
    isRunningStage && job?.status === "IN_PROGRESS"
      ? "AI running"
      : isRunningStage && job?.status === "QUEUED"
        ? "Queued"
        : null;
  const aiMessage = job?.status === "IN_PROGRESS" ? AI_STATUS_MESSAGES[aiMessageIndex] : null;

  useEffect(() => {
    if (!session || !isAdmin) {
      return;
    }

    const loadCards = async () => {
      setError(null);
      setCardsLoading(true);
      setCardsOffset(0);
      setCardsHasMore(true);
      try {
        const queryString = `?stage=${stage}&limit=10&offset=0`;
        const res = await fetch(`/api/admin/kingsreview/cards${queryString}`, {
          headers: adminHeaders(),
          cache: "no-store",
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed to load cards (${res.status})${text ? `: ${text}` : ""}`);
        }
        const data = await res.json();
        const nextCards = data.cards ?? [];
        setCards(nextCards);
        setCardsHasMore(nextCards.length === 10);
        setCardsOffset(nextCards.length);
        setActiveCardId((prev) => {
          if (!nextCards.length) {
            return null;
          }
          if (prev && nextCards.some((card: CardSummary) => card.id === prev)) {
            return prev;
          }
          return nextCards[0].id;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load cards");
      } finally {
        setCardsLoading(false);
      }
    };

    loadCards();
  }, [adminHeaders, isAdmin, session, stage]);

  const fetchCardDetail = useCallback(
    async (cardId: string) => {
      const cached = cardDetailCacheRef.current.get(cardId) ?? null;
      if (cached) {
        return cached;
      }
      const inflight = inflightCardRef.current.get(cardId);
      if (inflight) {
        return inflight;
      }
      const promise = (async () => {
        try {
          const res = await fetch(`/api/admin/cards/${cardId}`, {
            headers: adminHeaders(),
            cache: "no-store",
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Failed to load card (${res.status})${text ? `: ${text}` : ""}`);
          }
          const payload = await res.json();
          const card = (payload?.card ?? payload) as any;
          if (!card || !card.id) {
            throw new Error("Failed to load card (empty response)");
          }
          const detail: CardDetail = {
            id: card.id,
            fileName: card.fileName,
            imageUrl: card.imageUrl,
            thumbnailUrl: card.thumbnailUrl,
            ocrText: card.ocrText ?? null,
            classification: card.classification ?? null,
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
            variantId: card.variantId ?? null,
            variantConfidence: card.variantConfidence ?? null,
            variantDecision: card.variantDecision ?? null,
            photos: Array.isArray(card.photos) ? card.photos : [],
          };
          cardDetailCacheRef.current.set(cardId, detail);
          return detail;
        } finally {
          inflightCardRef.current.delete(cardId);
        }
      })();
      inflightCardRef.current.set(cardId, promise);
      return promise;
    },
    [adminHeaders]
  );

  const preloadImage = useCallback((url: string | null | undefined) => {
    if (!url) {
      return;
    }
    if (imagePreloadRef.current.has(url)) {
      return;
    }
    imagePreloadRef.current.add(url);
    const img = new Image();
    img.src = url;
  }, []);

  const preloadCardAssets = useCallback(
    async (cardId: string) => {
      const detail = await fetchCardDetail(cardId);
      if (!detail) {
        return;
      }
      preloadImage(detail.thumbnailUrl);
      preloadImage(detail.imageUrl);
      (detail.photos ?? []).forEach((photo) => {
        preloadImage(photo.thumbnailUrl ?? null);
        preloadImage(photo.imageUrl);
      });
    },
    [fetchCardDetail, preloadImage]
  );

  const loadMoreCards = useCallback(async () => {
    if (cardsLoadingMore || !cardsHasMore) {
      return;
    }
    setCardsLoadingMore(true);
    try {
      const queryString = `?stage=${stage}&limit=10&offset=${cardsOffset}`;
      const res = await fetch(`/api/admin/kingsreview/cards${queryString}`, {
        headers: adminHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Failed to load more cards");
      }
      const data = await res.json();
      const nextCards = data.cards ?? [];
      setCards((prev) => [...prev, ...nextCards]);
      setCardsHasMore(nextCards.length === 10);
      setCardsOffset((prev) => prev + nextCards.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more cards");
    } finally {
      setCardsLoadingMore(false);
    }
  }, [adminHeaders, cardsHasMore, cardsLoadingMore, cardsOffset, stage]);

  useEffect(() => {
    if (!session || !isAdmin) {
      return;
    }
    const interval = setInterval(() => {
      const limit = Math.max(cardsOffset, 10);
      const queryString = `?stage=${stage}&limit=${limit}&offset=0`;
      fetch(`/api/admin/kingsreview/cards${queryString}`, {
        headers: adminHeaders(),
        cache: "no-store",
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data?.cards) {
            return;
          }
          const nextCards = data.cards ?? [];
          setCards(nextCards);
          setCardsOffset(nextCards.length);
          setCardsHasMore(nextCards.length === limit);
          setActiveCardId((prev) => {
            if (!nextCards.length) {
              return null;
            }
            if (prev && nextCards.some((card: CardSummary) => card.id === prev)) {
              return prev;
            }
            return nextCards[0].id;
          });
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(interval);
  }, [adminHeaders, cardsOffset, isAdmin, session, stage]);

  useEffect(() => {
    if (!cards.length) {
      return;
    }
    const preloadTargets = cards.slice(0, 10);
    preloadTargets.forEach((card) => {
      void preloadCardAssets(card.id);
    });
  }, [cards, preloadCardAssets]);

  useEffect(() => {
    if (!activeCardId || !cards.length) {
      return;
    }
    const index = cards.findIndex((card) => card.id === activeCardId);
    if (index === -1) {
      return;
    }
    const start = Math.max(0, index - 10);
    const end = Math.min(cards.length, index + 21);
    cards.slice(start, end).forEach((card) => {
      void preloadCardAssets(card.id);
    });
  }, [activeCardId, cards, preloadCardAssets]);

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
    if (!session || !isAdmin) {
      return;
    }
    const loadRules = async () => {
      try {
        const res = await fetch(`/api/admin/bytebot/playbooks`, {
          headers: adminHeaders(),
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        setPlaybookRules(data.rules ?? []);
      } catch {
        // ignore
      }
    };
    loadRules();
  }, [adminHeaders, isAdmin, session]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "t") {
        setShowTeach((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (!activeCardId || !session || !isAdmin) {
      return;
    }

    const loadCard = async () => {
      setError(null);
      try {
        const cached = cardDetailCacheRef.current.get(activeCardId) ?? null;
        if (cached) {
          setActiveCard(cached);
        }

        const fresh = await fetchCardDetail(activeCardId);
        if (!fresh && !cached) {
          throw new Error("Failed to load card");
        }
        if (fresh) {
          setActiveCard(fresh);
        }

        const nextCard = fresh ?? cached;
        if (nextCard) {
          setActivePhotoKind("FRONT");
          setVariantSetId(
            (nextCard.classificationNormalized as any)?.setName ??
              (nextCard.classificationNormalized as any)?.setCode ??
              ""
          );
          setVariantCardNumber((nextCard.classificationNormalized as any)?.cardNumber ?? "");
          if (!queryTouched) {
            setQuery(nextCard.customTitle ?? nextCard.fileName ?? "");
          }
        }
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
          return;
        }
        const data = await res.json();
        const nextJob = data.job ?? null;
        setJob(nextJob);
        if (nextJob?.searchQuery) {
          setQuery(nextJob.searchQuery);
          setQueryTouched(false);
        }
        const nextSource = nextJob?.result?.sources?.[0]?.source ?? null;
        setActiveSource((prev) => prev ?? nextSource);
        if (nextJob?.id && nextJob.id !== lastJobIdRef.current) {
          lastJobIdRef.current = nextJob.id;
          setActiveCompIndex(null);
        }
      } catch (err) {
        // ignore transient failures to avoid clearing comps
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
        const nextJob = data.job ?? null;
        if (nextJob) {
          setJob(nextJob);
          if (nextJob.id !== lastJobIdRef.current) {
            lastJobIdRef.current = nextJob.id;
            setActiveCompIndex(null);
          }
        }
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

  useEffect(() => {
    if (!activeCard) {
      setActiveCardImageUrl(null);
      return;
    }

    const isFront = activePhotoKind === "FRONT";
    const thumb = isFront ? activeCard.thumbnailUrl : activePhotoThumbs[activePhotoKind];
    const full = isFront ? activeCard.imageUrl : activePhotos[activePhotoKind];

    const fallback = thumb ?? full ?? null;
    setActiveCardImageUrl(fallback);

    if (full && full !== fallback) {
      const img = new Image();
      img.onload = () => setActiveCardImageUrl(full);
      img.src = full;
    }
  }, [activeCard, activePhotoKind, activePhotoThumbs, activePhotos]);

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
      if (STAGES.some((entry) => entry.id === nextStage)) {
        setStage(nextStage);
      }
      setActiveCardId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update stage");
    } finally {
      setSaving(false);
    }
  };

  const handleVariantDecision = async (
    parallelId: string,
    confidence?: number | null,
    override?: boolean
  ) => {
    if (!activeCard) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/variants/decision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          cardAssetId: activeCard.id,
          selectedParallelId: parallelId,
          confidence: confidence ?? activeCard.variantDecision?.confidence ?? activeCard.variantConfidence ?? null,
          candidates: [],
          humanOverride: Boolean(override),
          humanNotes: variantNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to save variant decision");
      }
      setActiveCard((prev) =>
        prev
          ? {
              ...prev,
              variantId: parallelId,
              variantConfidence:
                confidence ?? prev.variantDecision?.confidence ?? prev.variantConfidence ?? null,
              variantDecision: {
                selectedParallelId: parallelId,
                confidence:
                  confidence ?? prev.variantDecision?.confidence ?? prev.variantConfidence ?? null,
                humanOverride: Boolean(override),
                humanNotes: variantNotes.trim() || null,
                candidates: prev.variantDecision?.candidates ?? [],
              },
            }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save variant decision");
    } finally {
      setSaving(false);
    }
  };

  const handleVariantMatch = async () => {
    if (!activeCard) {
      return;
    }
    if (!variantSetId.trim() || !variantCardNumber.trim()) {
      setError("Set ID and Card # are required to run the matcher.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/variants/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          cardAssetId: activeCard.id,
          setId: variantSetId.trim(),
          cardNumber: variantCardNumber.trim(),
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to run matcher");
      }
      if (payload?.candidates?.length) {
        const top = payload.candidates[0];
        setActiveCard((prev) =>
          prev
            ? {
                ...prev,
                variantId: top.parallelId,
                variantConfidence: top.confidence,
                variantDecision: {
                  selectedParallelId: top.parallelId,
                  confidence: top.confidence,
                  humanOverride: false,
                  humanNotes: prev.variantDecision?.humanNotes ?? null,
                  candidates: payload.candidates,
                },
              }
            : prev
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run matcher");
    } finally {
      setSaving(false);
    }
  };

  const openVariantInspect = async (candidate: VariantCandidate) => {
    if (!variantSetId.trim()) {
      setError("Set ID is required to load reference images.");
      return;
    }
    setVariantInspectCandidate(candidate);
    setVariantInspectRefs([]);
    setVariantInspectOpen(true);
    setVariantInspectLoading(true);
    try {
      const res = await fetch(
        `/api/admin/variants/reference?setId=${encodeURIComponent(variantSetId.trim())}&parallelId=${encodeURIComponent(
          candidate.parallelId
        )}&limit=20`,
        { headers: adminHeaders() }
      );
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to load reference images");
      }
      setVariantInspectRefs(payload.references ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reference images");
    } finally {
      setVariantInspectLoading(false);
    }
  };

  const closeVariantInspect = () => {
    setVariantInspectOpen(false);
    setVariantInspectCandidate(null);
    setVariantInspectRefs([]);
  };

  const handleCreateRule = async () => {
    if (!teachForm.selector.trim()) {
      setError("Selector is required.");
      return;
    }
    try {
      setError(null);
      const res = await fetch(`/api/admin/bytebot/playbooks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          source: teachForm.source,
          action: teachForm.action,
          selector: teachForm.selector.trim(),
          urlContains: teachForm.urlContains.trim() || null,
          label: teachForm.label.trim() || null,
          priority: Number(teachForm.priority) || 0,
          enabled: teachForm.enabled,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to save playbook rule.");
      }
      const data = await res.json();
      setPlaybookRules((prev) => [data.rule, ...prev]);
      setTeachForm((prev) => ({ ...prev, selector: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save playbook rule.");
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/bytebot/playbooks?id=${id}`, {
        method: "DELETE",
        headers: adminHeaders(),
      });
      if (!res.ok) {
        throw new Error("Failed to delete rule.");
      }
      setPlaybookRules((prev) => prev.filter((rule) => rule.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rule.");
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
      const sourceList = ["ebay_sold"];
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
          categoryType,
          useManual: true,
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

  const handleRegenerateComps = async () => {
    if (!activeCardId || regenerating) {
      return;
    }
    setRegenerating(true);
    setError(null);
    try {
      const categoryType = activeCard?.classificationNormalized?.categoryType ?? null;
      const sourceList = ["ebay_sold"];
      const nextQuery = job?.searchQuery ?? query.trim();
      if (!nextQuery) {
        throw new Error("Search query is required to regenerate comps");
      }
      const res = await fetch("/api/admin/kingsreview/enqueue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          query: nextQuery,
          cardAssetId: activeCardId,
          sources: sourceList,
          categoryType,
          useManual: false,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to regenerate comps");
      }
      const data = await res.json();
      setJob(data.job ?? null);
      setActiveSource(null);
      setError("Comps regeneration queued.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate comps");
    } finally {
      setRegenerating(false);
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

  const handleDeleteEvidence = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/kingsreview/evidence?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: adminHeaders(),
      });
      if (!res.ok) {
        throw new Error("Failed to remove evidence");
      }
      setEvidenceItems((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove evidence");
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
      <div className="flex min-h-screen flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6 lg:gap-6 lg:overflow-hidden">
        <header className="shrink-0 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/admin/uploads"
              className="inline-flex text-[10px] uppercase tracking-[0.28em] text-slate-400 transition hover:text-white"
            >
              ← Add Cards
            </Link>
            <Link
              href="/admin/inventory-ready"
              className="inline-flex text-[10px] uppercase tracking-[0.28em] text-slate-400 transition hover:text-white"
            >
              Inventory Ready →
            </Link>
          </div>
          <h1 className="text-center font-heading text-4xl uppercase tracking-[0.2em] text-white">KingsReview</h1>
          <div className="flex flex-wrap items-center gap-2">
            {STAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setStage(item.id);
                  setActiveCardId(null);
                  setCardsLoading(true);
                }}
                className={`rounded-full border px-3 py-1.5 text-[9px] uppercase tracking-[0.3em] transition sm:px-4 sm:py-2 sm:text-[11px] ${
                  stage === item.id
                    ? "border-gold-400 bg-gold-500/20 text-gold-200"
                    : "border-white/20 text-slate-300 hover:border-white/40 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowTeach((prev) => !prev)}
              className="rounded-full border border-sky-400/60 bg-sky-500/10 px-3 py-1.5 text-[9px] uppercase tracking-[0.3em] text-sky-200 transition hover:border-sky-300 sm:px-4 sm:py-2 sm:text-[11px]"
            >
              {showTeach ? "Hide Teach" : "Teach"}
            </button>
            <div className="flex min-w-[320px] flex-1 flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-night-950/50 p-2">
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setQueryTouched(true);
                }}
                placeholder="Search query"
                className="min-w-[180px] flex-1 rounded-xl border border-white/10 bg-night-800 px-3 py-2 text-xs text-slate-200"
              />
              <button
                type="button"
                onClick={handleEnqueue}
                disabled={enqueueing}
                className="rounded-full border border-sky-400/60 bg-sky-500/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-sky-200 disabled:opacity-60"
              >
                {enqueueing ? "Running…" : "Generate Comps"}
              </button>
              {(sources.length ? sources : [{ source: "ebay_sold" } as { source: string }]).map((source) => (
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
              {activeSourceData && (
                <button
                  type="button"
                  onClick={handleAttachSearch}
                  className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-emerald-200"
                >
                  Attach Search
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setDeleteSelection([]);
                setShowDeleteDialog(true);
              }}
              className="ml-auto inline-flex items-center justify-center rounded-full border border-rose-400/60 bg-rose-500/20 px-3 py-1.5 text-[9px] uppercase tracking-[0.3em] text-rose-200 transition hover:border-rose-300 disabled:opacity-60 sm:px-4 sm:py-2 sm:text-[11px]"
              disabled={purging}
              aria-label="Delete cards"
              title="Delete cards"
            >
              <svg aria-hidden="true" className="h-3 w-3 sm:h-4 sm:w-4" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 7h12M9 7v11m6-11v11M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1zM5 7h14l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </header>

        {showDeleteDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-night-950 p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h2 className="font-heading text-xl uppercase tracking-[0.18em] text-white">Delete Cards</h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setShowDeleteDialog(false);
                    setDeleteSelection([]);
                  }}
                  className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
                >
                  X
                </button>
              </div>

              {showDeleteConfirm ? (
                <div className="mt-6 space-y-6 text-sm text-slate-300">
                  <p>Are you sure you want to delete these cards? It will remove them permanently from the Ten Kings system.</p>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.28em] text-slate-200 transition hover:border-white/40 hover:text-white"
                    >
                      No, don’t delete
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      disabled={purging}
                      className="rounded-full border border-rose-400/60 bg-rose-500/20 px-4 py-2 text-xs uppercase tracking-[0.28em] text-rose-200 transition hover:border-rose-300 disabled:opacity-60"
                    >
                      {purging ? "Deleting…" : "Yes, delete"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  <label className="flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-slate-300">
                    <input
                      type="checkbox"
                      checked={cards.length > 0 && deleteSelection.length === cards.length}
                      onChange={(event) => handleSelectAll(event.currentTarget.checked)}
                      className="h-4 w-4 accent-rose-400"
                    />
                    Select all
                  </label>

                  <div className="max-h-80 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-night-900/60 p-3">
                    {cards.length === 0 && (
                      <p className="text-sm text-slate-400">No cards available to delete.</p>
                    )}
                    {cards.map((card) => (
                      <label
                        key={`delete-${card.id}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-night-900/80 px-3 py-2 text-sm text-slate-200"
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={deleteSelection.includes(card.id)}
                            onChange={() => toggleDeleteSelection(card.id)}
                            className="h-4 w-4 accent-rose-400"
                          />
                          <span className="truncate">
                            {card.customTitle ?? card.resolvedPlayerName ?? card.fileName}
                          </span>
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                          {new Date(card.updatedAt).toLocaleDateString()}
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={deleteSelection.length === 0}
                      className="rounded-full border border-rose-400/60 bg-rose-500/20 px-5 py-2 text-xs uppercase tracking-[0.28em] text-rose-200 transition hover:border-rose-300 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="grid flex-1 min-h-0 overflow-hidden gap-4 md:gap-5 xl:gap-6 lg:grid-cols-[1fr_2fr_2fr]">
          <section
            className="flex h-full min-h-[320px] flex-col gap-3 rounded-2xl border border-white/10 bg-night-900/70 p-3 md:gap-4 md:rounded-3xl md:p-4 lg:h-[2700px] lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain"
            onScroll={(event) => {
              const target = event.currentTarget;
              if (target.scrollTop + target.clientHeight >= target.scrollHeight - 40) {
                loadMoreCards().catch(() => undefined);
              }
            }}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Card Queue</p>
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">{cards.length} cards</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-night-950/50 p-2 pr-1 md:pr-2">
              {cards.map((card) => {
                const status = queueStatusMeta(card);
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setActiveCardId(card.id)}
                    onMouseEnter={() => {
                      void preloadCardAssets(card.id);
                    }}
                    title={card.customTitle ?? card.resolvedPlayerName ?? card.fileName}
                    className={`group w-full rounded-xl px-3 py-3 text-left transition ${
                      activeCardId === card.id
                        ? "border border-gold-400/40 bg-gold-500/15 text-gold-200"
                        : "border border-transparent text-slate-300 hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 text-sm font-semibold leading-tight">
                        {card.customTitle ?? card.resolvedPlayerName ?? card.fileName}
                      </span>
                      {status.label && (
                        <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.2em] ${status.className}`}>
                          {status.label}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.24em] text-slate-500">
                      {new Date(card.updatedAt).toLocaleString()}
                    </div>
                  </button>
                );
              })}
              {cards.length === 0 && !cardsLoading && (
                <p className="px-3 py-6 text-center text-xs uppercase tracking-[0.3em] text-slate-500">
                  No cards in this stage
                </p>
              )}
              {cards.length === 0 && cardsLoading && (
                <p className="px-3 py-6 text-center text-xs uppercase tracking-[0.3em] text-slate-500">
                  Loading cards…
                </p>
              )}
              {cardsLoadingMore && (
                <p className="px-3 py-2 text-center text-[10px] uppercase tracking-[0.3em] text-slate-500">
                  Loading more…
                </p>
              )}
            </div>
          </section>

          <section className="flex h-full min-h-[320px] flex-col gap-3 rounded-2xl border border-white/10 bg-night-900/70 p-3 md:gap-4 md:rounded-3xl md:p-4 lg:h-[2700px] lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-night-900/95 pb-2 backdrop-blur">
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
            <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
              {aiStatus && (
                <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-night-950/60 px-3 py-2">
                  <span className="inline-flex h-4 w-4 items-center justify-center">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                  </span>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-slate-300">{aiStatus}</div>
                  {aiMessage && <div className="text-xs text-slate-500">{aiMessage}</div>}
                </div>
              )}
              {sources.some((source) => source.error) && (
                <div className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {sources
                    .filter((source) => source.error)
                    .map((source) => (
                      <div key={source.source}>
                        <span className="uppercase tracking-[0.3em]">{SOURCE_LABELS[source.source] ?? source.source}</span>
                        {": "}
                        {source.error}
                      </div>
                    ))}
                </div>
              )}

              {activeCard ? (
                <div className="mt-4 flex flex-col gap-4">
                  <div className="mx-auto w-[78%] aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-night-950 lg:w-[68%]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        activeCardImageUrl ??
                        activePhotoThumbs[activePhotoKind] ??
                        activePhotos[activePhotoKind] ??
                        activeCard.imageUrl
                      }
                      alt={activeCard.fileName}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="mx-auto grid w-[78%] gap-2 md:grid-cols-3 lg:w-[68%]">
                    {[
                      {
                        label: "Front",
                        kind: "FRONT" as const,
                        url: activeCard.thumbnailUrl ?? activeCard.imageUrl,
                        full: activeCard.imageUrl,
                      },
                      {
                        label: "Back",
                        kind: "BACK" as const,
                        url: activePhotoThumbs.BACK ?? activePhotos.BACK,
                        full: activePhotos.BACK,
                      },
                      {
                        label: "Tilt",
                        kind: "TILT" as const,
                        url: activePhotoThumbs.TILT ?? activePhotos.TILT,
                        full: activePhotos.TILT,
                      },
                    ].map((photo) => (
                      <button
                        key={photo.label}
                        type="button"
                        onClick={() => setActivePhotoKind(photo.kind)}
                        className={`rounded-2xl border p-2 text-left ${
                          activePhotoKind === photo.kind
                            ? "border-sky-400/60 bg-sky-500/10"
                            : "border-white/10 bg-night-800/70"
                        }`}
                      >
                        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">{photo.label}</p>
                        <div className="mt-2 aspect-[3/2] overflow-hidden rounded-xl border border-white/10 bg-night-900">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {photo.url ? (
                            <img
                              src={photo.url}
                              alt={`${photo.label} image`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.3em] text-slate-500">
                              Missing
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-2">
                    <input
                      value={
                        activeCard.resolvedPlayerName ??
                        (activeAttributes?.playerName as string | undefined) ??
                        ""
                      }
                      readOnly
                      placeholder="Player name"
                      className="w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                    />
                    <input
                      value={
                        (activeAttributes?.sport as string | undefined) ??
                        (activeCard.classificationNormalized as any)?.sport?.sport ??
                        ""
                      }
                      readOnly
                      placeholder="Sport"
                      className="w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                    />
                    <input
                      value={
                        (activeAttributes?.brand as string | undefined) ??
                        (activeCard.classificationNormalized as any)?.company ??
                        ""
                      }
                      readOnly
                      placeholder="Manufacturer"
                      className="w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                    />
                    <input
                      value={
                        (activeCard.classificationNormalized as any)?.year ??
                        (activeAttributes?.year as string | undefined) ??
                        ""
                      }
                      readOnly
                      placeholder="Year"
                      className="w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                    />
                    <input
                      value={
                        activeCard.resolvedTeamName ??
                        (activeAttributes?.teamName as string | undefined) ??
                        ""
                      }
                      readOnly
                      placeholder="Team name"
                      className="w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                    />
                    <input
                      value={
                        (activeCard.classificationNormalized as any)?.setName ??
                        (activeCard.classificationNormalized as any)?.setCode ??
                        (activeAttributes?.setName as string | undefined) ??
                        ""
                      }
                      readOnly
                      placeholder="Set"
                      className="w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                    />
                    <input
                      value={
                        (activeCard.classificationNormalized as any)?.cardNumber ??
                        (activeCard.classification as any)?.cardNumber ??
                        ""
                      }
                      readOnly
                      placeholder="Card number"
                      className="w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                    />
                    <input
                      value={(activeAttributes?.numbered as string | undefined) ?? ""}
                      readOnly
                      placeholder="Numbered (e.g. 3/10)"
                      className="w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                    />
                    <div className="flex flex-wrap gap-4 text-xs uppercase tracking-[0.24em] text-slate-400">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(activeAttributes?.autograph)}
                          readOnly
                          className="h-4 w-4 accent-sky-400"
                        />
                        Autograph
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(activeAttributes?.memorabilia)}
                          readOnly
                          className="h-4 w-4 accent-sky-400"
                        />
                        Patch
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(activeAttributes?.graded)}
                          readOnly
                          className="h-4 w-4 accent-sky-400"
                        />
                        Graded
                      </label>
                    </div>
                    {Boolean(activeAttributes?.graded) && (
                      <div className="grid gap-2 md:grid-cols-2">
                        <input
                          value={(activeAttributes?.gradeCompany as string | undefined) ?? ""}
                          readOnly
                          placeholder="Grade company"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                        />
                        <input
                          value={(activeAttributes?.gradeValue as string | undefined) ?? ""}
                          readOnly
                          placeholder="Grade value"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                        />
                      </div>
                    )}
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Price Valuation</span>
                      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-night-800 px-3 py-2">
                        <span className="text-sm text-slate-400">$</span>
                        <input
                          value={activeCard.valuationMinor ?? ""}
                          onChange={(event) =>
                            setActiveCard((prev) =>
                              prev ? { ...prev, valuationMinor: Number(event.target.value) || null } : prev
                            )
                          }
                          className="flex-1 bg-transparent text-sm text-white outline-none"
                        />
                      </div>
                    </label>
                    <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Attached Evidence</p>
                      <div className="mt-3 space-y-2">
                        {evidenceItems.map((item) => (
                          <div
                            key={item.id}
                            className="grid h-[150px] grid-cols-[96px_1fr] gap-3 rounded-2xl border border-white/20 bg-black/90 p-2.5 text-xs text-white sm:grid-cols-[120px_1fr]"
                          >
                            <div className="mx-auto h-full w-full max-w-[96px] overflow-hidden rounded-xl border border-white/20 bg-black sm:max-w-[120px]">
                              {item.screenshotUrl ? (
                                <img
                                  src={item.screenshotUrl}
                                  alt={item.title ?? "Evidence"}
                                  className="h-full w-full object-contain p-2"
                                  referrerPolicy="no-referrer"
                                />
                              ) : null}
                            </div>
                            <div className="flex min-h-[120px] flex-col justify-between gap-2">
                              <div>
                                <div className="text-lg font-bold text-emerald-400">
                                  {item.price ?? "—"}
                                </div>
                                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                                  {item.soldDate ? `Sold ${item.soldDate}` : ""}
                                </div>
                              </div>
                              <div className="line-clamp-2 text-xs text-white">
                                {item.title ?? item.url}
                              </div>
                              <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.3em]">
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-white underline"
                                >
                                  Open
                                </a>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteEvidence(item.id)}
                                  className="text-rose-700"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {evidenceItems.length === 0 && (
                          <p className="text-xs text-slate-500">No evidence attached yet.</p>
                        )}
                      </div>
                    </div>
                    <details className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                      <summary className="cursor-pointer text-[10px] uppercase tracking-[0.3em] text-slate-400">
                        Advanced Controls
                      </summary>
                      <div className="mt-3 space-y-3 text-xs text-slate-300">
                        <div className="rounded-2xl border border-white/10 bg-night-900/60 px-3 py-3 text-[11px] uppercase tracking-[0.28em] text-slate-400">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-slate-500">Variant</span>
                            <span className="text-slate-200">
                              {activeCard.variantDecision?.selectedParallelId ??
                                activeCard.variantId ??
                                "Not set"}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-slate-500">
                            <span>
                              Confidence{" "}
                              {activeCard.variantDecision?.confidence ??
                                activeCard.variantConfidence ??
                                "—"}
                            </span>
                            {activeCard.variantDecision?.humanOverride && (
                              <span className="rounded-full border border-amber-400/60 bg-amber-500/20 px-2 py-1 text-[9px] text-amber-200">
                                Human Override
                              </span>
                            )}
                          </div>
                          <div className="mt-3 grid gap-2">
                            <input
                              value={variantNotes}
                              onChange={(event) => setVariantNotes(event.target.value)}
                              placeholder="Variant notes / reason"
                              className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-white"
                            />
                            <div className="grid gap-2 md:grid-cols-2">
                              <input
                                value={variantSetId}
                                onChange={(event) => setVariantSetId(event.target.value)}
                                placeholder="Set ID"
                                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-white"
                              />
                              <input
                                value={variantCardNumber}
                                onChange={(event) => setVariantCardNumber(event.target.value)}
                                placeholder="Card #"
                                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-white"
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={handleVariantMatch}
                                disabled={saving}
                                className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-3 py-2 text-[10px] uppercase tracking-[0.28em] text-emerald-200 disabled:opacity-60"
                              >
                                Run Matcher
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleVariantDecision(
                                    activeCard.variantDecision?.selectedParallelId ?? activeCard.variantId ?? "",
                                    activeCard.variantDecision?.confidence ?? activeCard.variantConfidence ?? null,
                                    true
                                  )
                                }
                                disabled={saving}
                                className="rounded-full border border-sky-400/60 bg-sky-500/20 px-3 py-2 text-[10px] uppercase tracking-[0.28em] text-sky-200 disabled:opacity-60"
                              >
                                Confirm Variant
                              </button>
                              <button
                                type="button"
                                onClick={() => handleVariantDecision("Unknown", null, true)}
                                disabled={saving}
                                className="rounded-full border border-rose-400/60 bg-rose-500/20 px-3 py-2 text-[10px] uppercase tracking-[0.28em] text-rose-200 disabled:opacity-60"
                              >
                                Mark Unknown
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                            Stage override
                            <select
                              value={activeCard.reviewStage ?? "READY_FOR_HUMAN_REVIEW"}
                              onChange={(event) => handleStageUpdate(event.target.value)}
                              className="rounded-full border border-white/10 bg-night-800 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-slate-200 outline-none transition focus:border-gold-400/60"
                            >
                              <option value="BYTEBOT_RUNNING">AI Running</option>
                              <option value="READY_FOR_HUMAN_REVIEW">Ready for Review</option>
                              <option value="INVENTORY_READY_FOR_SALE">Inventory Ready</option>
                            </select>
                          </label>
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
                          <div className="mt-2 flex flex-wrap gap-2">
                            <input
                              value={query}
                              onChange={(event) => {
                                setQuery(event.target.value);
                                setQueryTouched(true);
                              }}
                              className="flex-1 rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-xs text-white"
                            />
                            <button
                              type="button"
                              onClick={handleEnqueue}
                              disabled={enqueueing}
                              className="rounded-full border border-sky-400/60 bg-sky-500/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-sky-200 disabled:opacity-60"
                            >
                              {enqueueing ? "Running…" : "Run"}
                            </button>
                            <button
                              type="button"
                              onClick={handleRegenerateComps}
                              disabled={regenerating}
                              className="rounded-full border border-white/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-slate-200 disabled:opacity-60"
                            >
                              {regenerating ? "Regenerating…" : "Regenerate Comps"}
                            </button>
                          </div>
                        </div>
                        {showTeach && (
                          <div className="rounded-2xl border border-sky-400/30 bg-sky-500/5 p-3">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] uppercase tracking-[0.3em] text-sky-300">Teach Bytebot</p>
                              <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                                Space = Pause · T = Toggle
                              </span>
                            </div>
                            <div className="mt-2">
                              <Link
                                href="/admin/bytebot/teach"
                                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-400 transition hover:border-white/40 hover:text-white"
                              >
                                Open Live Teach Session →
                              </Link>
                            </div>
                            <div className="mt-3 grid gap-2">
                              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                                Source
                                <select
                                  value={teachForm.source}
                                  onChange={(event) =>
                                    setTeachForm((prev) => ({ ...prev, source: event.target.value }))
                                  }
                                  className="rounded-full border border-white/10 bg-night-800 px-3 py-2 text-[11px] uppercase tracking-[0.3em] text-slate-200"
                                >
                                  <option value="ebay_sold">eBay Sold</option>
                                </select>
                              </label>
                              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                                Selector (Playwright)
                                <input
                                  value={teachForm.selector}
                                  onChange={(event) =>
                                    setTeachForm((prev) => ({ ...prev, selector: event.target.value }))
                                  }
                                  placeholder="text=Sports or a[href*='sports']"
                                  className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-xs text-white"
                                />
                              </label>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                                  URL Contains (optional)
                                  <input
                                    value={teachForm.urlContains}
                                    onChange={(event) =>
                                      setTeachForm((prev) => ({ ...prev, urlContains: event.target.value }))
                                    }
                                    placeholder="e.g. ebay.com/sch"
                                    className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-xs text-white"
                                  />
                                </label>
                                <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                                  Priority
                                  <input
                                    type="number"
                                    value={teachForm.priority}
                                    onChange={(event) =>
                                      setTeachForm((prev) => ({
                                        ...prev,
                                        priority: Number(event.target.value) || 0,
                                      }))
                                    }
                                    className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-xs text-white"
                                  />
                                </label>
                              </div>
                              <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                                <input
                                  type="checkbox"
                                  checked={teachForm.enabled}
                                  onChange={(event) =>
                                    setTeachForm((prev) => ({ ...prev, enabled: event.target.checked }))
                                  }
                                  className="h-4 w-4 accent-sky-400"
                                />
                                Enabled
                              </label>
                            </div>
                            <button
                              type="button"
                              onClick={handleCreateRule}
                              className="mt-3 rounded-full border border-sky-400/60 bg-sky-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-sky-200"
                            >
                              Save Rule
                            </button>
                            <div className="mt-4 space-y-2">
                              {rulesForActiveSource.length === 0 && (
                                <p className="text-xs text-slate-500">No rules for this source yet.</p>
                              )}
                              {rulesForActiveSource.map((rule) => (
                                <div
                                  key={rule.id}
                                  className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-night-950/60 px-3 py-2 text-xs text-slate-300"
                                >
                                  <div className="flex-1">
                                    <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                                      {rule.action} · {rule.source}
                                    </div>
                                    <div className="line-clamp-1">{rule.selector}</div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteRule(rule.id)}
                                    className="text-[10px] uppercase tracking-[0.3em] text-rose-300"
                                  >
                                    Delete
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs uppercase tracking-[0.3em] text-slate-500">
                  Select a card to review
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-white/10 bg-night-950/40 px-3 py-2 text-[10px] uppercase tracking-[0.28em] text-slate-500">
              Evidence captured in real time. Use Comp Detail to review and attach comps.
            </div>
          </section>

          <section className="flex h-full min-h-[320px] flex-col gap-3 rounded-2xl border border-white/10 bg-night-900/70 p-3 md:gap-4 md:rounded-3xl md:p-4 lg:h-[2700px] lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
            <div className="z-20 space-y-3 border-b border-white/10 pb-3 lg:sticky lg:top-0 lg:rounded-2xl lg:border lg:border-white/10 lg:bg-night-900/95 lg:p-3 lg:shadow-[0_8px_20px_rgba(0,0,0,0.35)] lg:backdrop-blur">
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
              <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Selected Comp</p>
                {activeComp ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-3">
                      <div className="mx-auto w-[78%] aspect-[4/5] overflow-hidden rounded-xl border border-white/20 bg-black lg:w-[68%]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {activeComp.listingImageUrl || activeComp.screenshotUrl ? (
                          <img
                            src={activeComp.listingImageUrl ?? activeComp.screenshotUrl}
                            alt={activeComp.title ?? "Selected comp"}
                            className="h-full w-full object-contain"
                            referrerPolicy="no-referrer"
                          />
                        ) : null}
                      </div>
                      <div className="flex flex-col justify-between gap-2 text-white">
                        <div>
                          <div className="text-lg font-bold text-emerald-400 md:text-xl">{activeComp.price ?? "—"}</div>
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300 md:text-sm">
                            {activeComp.soldDate ? `Sold ${activeComp.soldDate}` : ""}
                          </div>
                        </div>
                        <div className="line-clamp-2 text-xs">{activeComp.title ?? activeComp.url}</div>
                        {activeComp.patternMatch && (
                          <div className="text-[10px] uppercase tracking-[0.3em] text-slate-300">
                            Pattern {activeComp.patternMatch.tier}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <a
                        href={activeComp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full rounded-full border border-white/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-slate-300 sm:w-auto"
                      >
                        Open Listing
                      </a>
                      <button
                        type="button"
                        onClick={() => handleAttachComp(activeComp, "SOLD_COMP")}
                        className="w-full rounded-full border border-emerald-400/60 bg-emerald-500/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-emerald-200 sm:w-auto"
                      >
                        Attach to Card
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-slate-500">Select a comp to preview.</div>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 rounded-2xl border border-white/10 bg-night-950/60 p-2 sm:p-3">
              {comps.length === 0 && (
                <p className="text-xs text-slate-500">No comps captured yet. Try re-running research.</p>
              )}
              <div className="space-y-2">
                {comps.map((comp, index) => {
                  const compAttached = attachedCompKeys.has(normalizeCompUrl(comp.url));
                  return (
                    <button
                      key={`${comp.url}-${index}`}
                      type="button"
                      onClick={() => setActiveCompIndex(index)}
                      className={`relative h-[150px] w-full overflow-hidden rounded-2xl border p-2.5 text-left transition md:p-3 ${
                        activeCompIndex === index
                          ? "border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(52,211,153,0.2)]"
                          : "border-white/20 bg-black/90 hover:-translate-y-0.5 hover:border-white/40"
                      }`}
                    >
                      {compAttached && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 bg-emerald-600/40 backdrop-blur-[1px]">
                          <span className="text-3xl leading-none text-emerald-100">✓</span>
                          <span className="text-lg font-semibold uppercase tracking-[0.32em] text-emerald-100">
                            Evidence
                          </span>
                        </div>
                      )}
                      <div className="grid h-full grid-cols-[96px_1fr] gap-3 sm:grid-cols-[120px_1fr]">
                        <div className="mx-auto h-full w-full max-w-[96px] overflow-hidden rounded-xl border border-white/20 bg-black sm:max-w-[120px]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {comp.listingImageUrl || comp.screenshotUrl ? (
                            <img
                              src={comp.listingImageUrl ?? comp.screenshotUrl}
                              alt={comp.title ?? "Comp"}
                              className="h-full w-full object-contain p-3"
                              referrerPolicy="no-referrer"
                            />
                          ) : null}
                        </div>
                        <div className="flex flex-col justify-between gap-2 text-white">
                          <div>
                            <div className="text-lg font-bold text-emerald-400 md:text-xl">{comp.price ?? "—"}</div>
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300 md:text-sm">
                              {comp.soldDate ? `Sold ${comp.soldDate}` : ""}
                            </div>
                          </div>
                          <div className="line-clamp-2 text-xs">{comp.title ?? comp.url}</div>
                          {comp.patternMatch && (
                            <div className="text-[10px] uppercase tracking-[0.3em] text-slate-300">
                              Pattern {comp.patternMatch.tier}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
        {variantInspectOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-10">
            <div className="w-full max-w-5xl rounded-3xl border border-white/10 bg-night-900 p-6 text-slate-200 shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Variant Inspect</p>
                  <h2 className="font-heading text-2xl uppercase tracking-[0.18em] text-white">
                    {variantInspectCandidate?.parallelId ?? "Variant"}
                  </h2>
                {variantInspectCandidate && (
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                    Confidence {variantInspectCandidate.confidence ?? "—"} ·{" "}
                    {parseVariantReason(variantInspectCandidate.reason).mode}
                    {parseVariantReason(variantInspectCandidate.reason).foilScore != null && (
                      <> · Foil {parseVariantReason(variantInspectCandidate.reason).foilScore?.toFixed(2)}</>
                    )}
                  </p>
                )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      variantInspectCandidate &&
                      handleVariantDecision(
                        variantInspectCandidate.parallelId,
                        variantInspectCandidate.confidence ?? null,
                        true
                      )
                    }
                    className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-emerald-200"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleVariantDecision("Unknown", null, true);
                      closeVariantInspect();
                    }}
                    className="rounded-full border border-rose-400/60 bg-rose-500/20 px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-rose-200"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={closeVariantInspect}
                    className="rounded-full border border-white/20 px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-slate-200"
                  >
                    Close
                  </button>
                </div>
              </div>

              {variantInspectLoading ? (
                <div className="mt-6 text-xs uppercase tracking-[0.3em] text-slate-500">
                  Loading references…
                </div>
              ) : (
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {variantInspectRefs.map((ref) => (
                    <div key={ref.id} className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                          {ref.parallelId}
                        </p>
                        <span className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                          Quality {ref.qualityScore != null ? ref.qualityScore.toFixed(2) : "—"}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ref.rawImageUrl}
                          alt={ref.parallelId}
                          className="h-48 w-full rounded-xl object-cover"
                        />
                        {ref.cropUrls?.length ? (
                          <div className="grid grid-cols-3 gap-2">
                            {ref.cropUrls.slice(0, 6).map((url) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={url} src={url} alt="crop" className="h-20 w-full rounded-lg object-cover" />
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                            Crops pending
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  {variantInspectRefs.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-night-950/60 p-4 text-xs uppercase tracking-[0.3em] text-slate-500">
                      No reference images found for this variant yet.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        )
      </div>
    );
  };

  return (
    <AppShell hideFooter>
      <Head>
        <title>KingsReview · Ten Kings</title>
      </Head>
      {renderContent()}
    </AppShell>
  );
}
