import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import AppShell from "../../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import type { CardAttributes } from "@tenkings/shared";

type BatchAsset = {
  id: string;
  status: string;
  fileName: string;
  fileSize: number;
  imageUrl: string;
  thumbnailUrl: string | null;
  mimeType: string;
  uploadedAt: string;
  ocrText: string | null;
  classification: CardAttributes | null;
  customTitle: string | null;
  customDetails: string | null;
  valuationMinor: number | null;
  valuationCurrency: string | null;
  valuationSource: string | null;
  marketplaceUrl: string | null;
  ebaySoldUrl: string | null;
  ebaySoldUrlVariant: string | null;
  ebaySoldUrlHighGrade: string | null;
  ebaySoldUrlPlayerComp: string | null;
  ebaySoldUrlAiGrade: string | null;
  aiGrade: {
    final: number | null;
    label: string | null;
    psaEquivalent: number | null;
    rangeLow: number | null;
    rangeHigh: number | null;
    generatedAt: string | null;
  } | null;
  assignedDefinitionId: string | null;
  humanReviewedAt: string | null;
  humanReviewerName: string | null;
  sportsDb: {
    playerId: string | null;
    matchConfidence: number;
    playerName: string | null;
    teamName: string | null;
    teamLogoUrl: string | null;
    sport: string | null;
    league: string | null;
    snapshot: Record<string, unknown> | null;
  };
};

const STAT_LABELS: Record<string, string> = {
  intGamesPlayed: "Games",
  intPoints: "Points",
  intGoals: "Goals",
  intAssists: "Assists",
  intWins: "Wins",
  intLosses: "Losses",
  intHomeRuns: "Home runs",
  intRBIs: "RBIs",
};

const pickStatEntries = (stats: Record<string, unknown> | null | undefined) => {
  if (!stats || typeof stats !== "object") {
    return [] as Array<{ label: string; value: string }>;
  }
  const entries: Array<{ label: string; value: string }> = [];
  for (const [key, label] of Object.entries(STAT_LABELS)) {
    if (Object.prototype.hasOwnProperty.call(stats, key)) {
      const raw = stats[key];
      if (raw !== null && raw !== undefined && String(raw).trim().length > 0) {
        entries.push({ label, value: String(raw) });
      }
    }
  }
  return entries;
};

const buildSportsSummary = (sportsDb: BatchAsset["sportsDb"]) => {
  const snapshot = sportsDb.snapshot as Record<string, unknown> | null | undefined;
  const seasons = Array.isArray((snapshot as any)?.seasons)
    ? ((snapshot as any).seasons as Array<Record<string, unknown>>)
    : [];
  const latestSeason = seasons[0] ?? null;
  const stats = latestSeason && typeof latestSeason === "object" && "stats" in latestSeason
    ? (latestSeason.stats as Record<string, unknown> | null | undefined)
    : null;
  const rawSeason =
    latestSeason && typeof latestSeason === "object" && "season" in latestSeason
      ? (latestSeason as Record<string, unknown>).season
      : null;
  const seasonLabel =
    typeof rawSeason === "string"
      ? rawSeason
      : typeof rawSeason === "number"
      ? String(rawSeason)
      : null;

  return {
    playerName: sportsDb.playerName,
    teamName: sportsDb.teamName,
    teamLogoUrl: sportsDb.teamLogoUrl,
    matchConfidence: sportsDb.matchConfidence,
    sport: sportsDb.sport,
    league: sportsDb.league,
    seasonLabel,
    statEntries: pickStatEntries(stats),
  };
};

type BatchDetail = {
  id: string;
  label: string | null;
  status: string;
  totalCount: number;
  processedCount: number;
  createdAt: string;
  updatedAt: string;
  assets: BatchAsset[];
};

const buildTitleFromAttributes = (attributes: CardAttributes | null, fallback: string) => {
  if (!attributes) {
    return fallback;
  }
  const parts = [
    attributes.year,
    attributes.brand ?? attributes.setName,
    attributes.playerName,
    attributes.variantKeywords[0],
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));

  return parts.length > 0 ? parts.join(" ") : fallback;
};

const buildAttributeTags = (attributes: CardAttributes | null): string[] => {
  if (!attributes) {
    return [];
  }

  const raw = [
    attributes.playerName,
    attributes.teamName,
    ...attributes.variantKeywords.slice(0, 2),
    attributes.serialNumber,
    attributes.autograph ? "Autograph" : null,
    attributes.memorabilia ? "Patch" : null,
    attributes.rookie ? "Rookie" : null,
    attributes.gradeValue
      ? attributes.gradeCompany
        ? `${attributes.gradeCompany} ${attributes.gradeValue}`
        : attributes.gradeValue
      : null,
  ];

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(trimmed);
    }
  }
  return tags;
};

type CardEditForm = {
  customTitle: string;
  customDetails: string;
  ocrText: string;
  valuation: string;
  valuationCurrency: string;
  valuationSource: string;
  marketplaceUrl: string;
  ebaySoldUrl: string;
  humanReviewed: boolean;
};

type CardApiResponse = {
  id: string;
  status: string;
  fileName: string;
  fileSize: number;
  imageUrl: string;
  thumbnailUrl: string | null;
  mimeType: string;
  ocrText: string | null;
  classification: CardAttributes | null;
  customTitle: string | null;
  customDetails: string | null;
  valuationMinor: number | null;
  valuationCurrency: string | null;
  valuationSource: string | null;
  marketplaceUrl: string | null;
  ebaySoldUrl: string | null;
  ebaySoldUrlVariant: string | null;
  ebaySoldUrlHighGrade: string | null;
  ebaySoldUrlPlayerComp: string | null;
  ebaySoldUrlAiGrade: string | null;
  aiGrade: {
    final: number | null;
    label: string | null;
    psaEquivalent: number | null;
    rangeLow: number | null;
    rangeHigh: number | null;
    generatedAt: string | null;
  } | null;
  assignedDefinitionId: string | null;
  assignedAt: string | null;
  humanReviewedAt: string | null;
  humanReviewerName: string | null;
};

type PackDefinitionSummary = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  inventoryCount: number;
  category: CollectibleCategory;
  tier: PackTier;
};

type CollectibleCategory = "SPORTS" | "POKEMON" | "COMICS";
type PackTier = "TIER_25" | "TIER_50" | "TIER_100" | "TIER_500";

const CATEGORY_OPTIONS: Array<{ value: CollectibleCategory; label: string }> = [
  { value: "SPORTS", label: "Sports" },
  { value: "POKEMON", label: "Pokémon" },
  { value: "COMICS", label: "Comics" },
];

const TIER_OPTIONS: Array<{ value: PackTier; label: string }> = [
  { value: "TIER_25", label: "$25 Pack" },
  { value: "TIER_50", label: "$50 Pack" },
  { value: "TIER_100", label: "$100 Pack" },
  { value: "TIER_500", label: "$500 Pack" },
];

const formatCategory = (value: CollectibleCategory) => {
  const option = CATEGORY_OPTIONS.find((entry) => entry.value === value);
  return option ? option.label : value;
};

const formatTier = (value: PackTier) => {
  const option = TIER_OPTIONS.find((entry) => entry.value === value);
  return option ? option.label : value;
};

export default function AdminBatchDetail() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [definitions, setDefinitions] = useState<PackDefinitionSummary[]>([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [definitionsError, setDefinitionsError] = useState<string | null>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [bulkEdit, setBulkEdit] = useState(false);
  const [forms, setForms] = useState<Record<string, CardEditForm>>({});
  const [savingCards, setSavingCards] = useState<Record<string, boolean>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string | null>>({});
  const [cardMessages, setCardMessages] = useState<Record<string, string | null>>({});
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignCategory, setAssignCategory] = useState<CollectibleCategory>("SPORTS");
  const [assignTier, setAssignTier] = useState<PackTier>("TIER_50");
  const [assignPackId, setAssignPackId] = useState<string>("");
  const [assignError, setAssignError] = useState<string | null>(null);

  const matchingDefinitions = useMemo(
    () =>
      definitions.filter(
        (definition) =>
          definition.category === assignCategory && definition.tier === assignTier
      ),
    [definitions, assignCategory, assignTier]
  );

  useEffect(() => {
    if (matchingDefinitions.length === 1) {
      setAssignPackId(matchingDefinitions[0].id);
    } else {
      setAssignPackId("");
    }
  }, [matchingDefinitions]);

  const targetDefinitionId = assignPackId || matchingDefinitions[0]?.id || "";
  const hasValidSelection = Boolean(targetDefinitionId) && matchingDefinitions.length > 0;
  const canAssign = selectedCards.length > 0 && hasValidSelection;

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const missingConfig =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_ADMIN_USER_IDS === undefined &&
    process.env.NEXT_PUBLIC_ADMIN_PHONES === undefined;

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    const batchId = router.query.batchId;
    if (typeof batchId !== "string" || !session?.token || !isAdmin) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      setFetching(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/batches/${batchId}`, {
          headers: buildAdminHeaders(session.token),
          signal: controller.signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load batch");
        }
        const data = (await res.json()) as BatchDetail;
        if (!cancelled) {
          setBatch(data);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Failed to load batch";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setFetching(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [router.isReady, router.query.batchId, session?.token, isAdmin]);

  useEffect(() => {
    if (!session?.token || !isAdmin) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setDefinitionsLoading(true);
      setDefinitionsError(null);
      try {
        const res = await fetch('/api/admin/packs/definitions', {
          headers: buildAdminHeaders(session.token),
          signal: controller.signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? 'Unable to load pack definitions');
        }
        const data = (await res.json()) as PackDefinitionSummary[];
        if (!cancelled) {
          setDefinitions(data);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Unable to load pack definitions';
          setDefinitionsError(message);
        }
      } finally {
        if (!cancelled) {
          setDefinitionsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [session?.token, isAdmin]);

  useEffect(() => {
    if (definitions.length === 0) {
      setAssignPackId("");
      return;
    }

    const hasCategory = definitions.some((definition) => definition.category === assignCategory);
    if (!hasCategory) {
      setAssignCategory(definitions[0].category);
      setAssignTier(definitions[0].tier);
      return;
    }

    const hasExactMatch = definitions.some(
      (definition) =>
        definition.category === assignCategory && definition.tier === assignTier
    );
    if (!hasExactMatch) {
      const fallback = definitions.find((definition) => definition.category === assignCategory);
      if (fallback) {
        setAssignTier(fallback.tier);
      }
    }
  }, [definitions, assignCategory, assignTier]);

  useEffect(() => {
    if (!bulkEdit || !batch) {
      return;
    }
    const next: Record<string, CardEditForm> = {};
    batch.assets.forEach((asset) => {
      next[asset.id] = {
        customTitle: asset.customTitle ?? '',
        customDetails: asset.customDetails ?? '',
        ocrText: asset.ocrText ?? '',
        valuation: asset.valuationMinor !== null ? (asset.valuationMinor / 100).toFixed(2) : '',
        valuationCurrency: asset.valuationCurrency ?? 'USD',
        valuationSource: asset.valuationSource ?? '',
        marketplaceUrl: asset.marketplaceUrl ?? '',
        ebaySoldUrl: asset.ebaySoldUrl ?? '',
        humanReviewed: asset.humanReviewedAt !== null,
      };
    });
    setForms(next);
  }, [bulkEdit, batch]);

  const renderGate = () => {
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
            Use your Ten Kings phone number. Only approved operators can enter the processing console.
          </p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
          {missingConfig && (
            <p className="mt-6 max-w-md text-xs text-rose-300/80">
              Set <code className="font-mono">NEXT_PUBLIC_ADMIN_USER_IDS</code> or <code className="font-mono">NEXT_PUBLIC_ADMIN_PHONES</code> to authorize operators.
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

    return null;
  };


const toggleSelected = (cardId: string) => {
  setSelectedCards((prev) =>
    prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
  );
};

const clearSelection = () => setSelectedCards([]);

const selectAllReady = () => {
  if (!batch) return;
  const readyIds = batch.assets
    .filter((asset) => asset.status === "READY")
    .map((asset) => asset.id);
  setSelectedCards(readyIds);
};

const handleAssignToDefinition = async () => {
  if (!session?.token || selectedCards.length === 0) {
    return;
  }

  const definitionId = targetDefinitionId;
  if (!definitionId) {
    setAssignError('No pack definition matches the selected category and tier.');
    return;
  }

  setAssigning(true);
  setAssignError(null);
  setAssignMessage(null);
  setError(null);

  try {
    const res = await fetch('/api/admin/cards/assign', {
      method: 'POST',
      headers: buildAdminHeaders(session.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ cardIds: selectedCards, packDefinitionId: definitionId }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.message ?? 'Failed to assign cards');
    }
    const payload = (await res.json()) as {
      updated: Array<{ id: string; status: string; assignedDefinitionId: string | null; assignedAt: string | null }>;
      mint?: { mintedItems: number; createdPacks: number; skippedCards: number };
    };

    setBatch((current) => {
      if (!current) return current;
      const updatedAssets = current.assets.map((asset) => {
        const update = payload.updated.find((entry) => entry.id === asset.id);
        if (!update) {
          return asset;
        }
        return {
          ...asset,
          status: update.status,
          assignedDefinitionId: update.assignedDefinitionId,
        };
      });
      return { ...current, assets: updatedAssets };
    });

    const summary = `${formatCategory(assignCategory)} · ${formatTier(assignTier)}`;
    const mintedSummary = payload.mint
      ? ` Minted ${payload.mint.createdPacks} pack${payload.mint.createdPacks === 1 ? '' : 's'}${
          payload.mint.skippedCards ? ` (skipped ${payload.mint.skippedCards}).` : '.'
        }`
      : '.';
    setAssignMessage(
      `Assigned ${payload.updated.length} card${payload.updated.length === 1 ? '' : 's'} to ${summary}${mintedSummary}`
    );
    setSelectedCards([]);
    setAssignModalOpen(false);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to assign cards';
    setAssignError(message);
  } finally {
    setAssigning(false);
  }
};

const handleFormFieldChange = (
  cardId: string,
  field: keyof CardEditForm
) =>
  (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { value } = event.currentTarget;
    setForms((prev) => {
      const current = prev[cardId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [cardId]: {
          ...current,
          [field]: value,
        },
      };
    });
  };

const handleFormCheckboxChange = (cardId: string) => (event: ChangeEvent<HTMLInputElement>) => {
  const { checked } = event.currentTarget;
  setForms((prev) => {
    const current = prev[cardId];
    if (!current) {
      return prev;
    }
    return {
      ...prev,
      [cardId]: {
        ...current,
        humanReviewed: checked,
      },
    };
  });
};

const handleBulkSave = async (cardId: string) => {
  if (!session?.token || !batch) {
    return;
  }

  const formState = forms[cardId];
  if (!formState) {
    return;
  }

  const valuationInput = formState.valuation.trim();
  let valuationMinor: number | null = null;
  if (valuationInput.length > 0) {
    const parsed = Number.parseFloat(valuationInput);
    if (!Number.isFinite(parsed)) {
      setCardErrors((prev) => ({ ...prev, [cardId]: "Valuation must be a number (e.g. 125.00)" }));
      return;
    }
    valuationMinor = Math.round(parsed * 100);
  }

  setSavingCards((prev) => ({ ...prev, [cardId]: true }));
  setCardErrors((prev) => ({ ...prev, [cardId]: null }));
  setCardMessages((prev) => ({ ...prev, [cardId]: null }));

  try {
    const res = await fetch(`/api/admin/cards/${cardId}`, {
      method: "PATCH",
      headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        customTitle: formState.customTitle.trim() || null,
        customDetails: formState.customDetails.trim() || null,
        ocrText: formState.ocrText.trim() || null,
        valuationMinor,
        valuationCurrency: formState.valuationCurrency.trim() || null,
        valuationSource: formState.valuationSource.trim() || null,
        marketplaceUrl: formState.marketplaceUrl.trim() || null,
        ebaySoldUrl: formState.ebaySoldUrl.trim() || null,
        humanReviewed: formState.humanReviewed,
      }),
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.message ?? "Failed to update card");
    }

    const updated = (await res.json()) as CardApiResponse;

    setBatch((current) => {
      if (!current) return current;
      const updatedAssets = current.assets.map((asset) => {
        if (asset.id !== cardId) {
          return asset;
        }
        return {
          ...asset,
          status: updated.status,
          fileName: updated.fileName,
          fileSize: updated.fileSize,
          imageUrl: updated.imageUrl,
          mimeType: updated.mimeType,
          ocrText: updated.ocrText,
          customTitle: updated.customTitle,
          customDetails: updated.customDetails,
          valuationMinor: updated.valuationMinor,
          valuationCurrency: updated.valuationCurrency,
          valuationSource: updated.valuationSource,
          marketplaceUrl: updated.marketplaceUrl,
          ebaySoldUrl: updated.ebaySoldUrl,
          ebaySoldUrlVariant: updated.ebaySoldUrlVariant,
          ebaySoldUrlHighGrade: updated.ebaySoldUrlHighGrade,
          ebaySoldUrlPlayerComp: updated.ebaySoldUrlPlayerComp,
          ebaySoldUrlAiGrade: updated.ebaySoldUrlAiGrade,
          aiGrade: updated.aiGrade,
          humanReviewedAt: updated.humanReviewedAt,
          humanReviewerName: updated.humanReviewerName,
        };
      });
      return { ...current, assets: updatedAssets };
    });

    setForms((current) => ({
      ...current,
      [cardId]: {
        customTitle: updated.customTitle ?? "",
        customDetails: updated.customDetails ?? "",
        ocrText: updated.ocrText ?? "",
        valuation: updated.valuationMinor !== null ? (updated.valuationMinor / 100).toFixed(2) : "",
        valuationCurrency: updated.valuationCurrency ?? "USD",
        valuationSource: updated.valuationSource ?? "",
        marketplaceUrl: updated.marketplaceUrl ?? "",
        ebaySoldUrl: updated.ebaySoldUrl ?? "",
        humanReviewed: updated.humanReviewedAt !== null,
      },
    }));

    setCardMessages((prev) => ({ ...prev, [cardId]: "Saved" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update card";
    setCardErrors((prev) => ({ ...prev, [cardId]: message }));
  } finally {
    setSavingCards((prev) => ({ ...prev, [cardId]: false }));
  }
};

  const gate = renderGate();
  if (gate) {
    return (
      <AppShell>
        <Head>
          <title>Ten Kings · Batch Detail</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Batch Detail</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex flex-1 flex-col gap-8 px-6 py-12">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-violet-300">Processing Console</p>
            <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Batch Detail</h1>
          </div>
          <Link className="text-xs uppercase tracking-[0.28em] text-slate-400 transition hover:text-white" href="/admin/uploads">
            ← Back to uploads
          </Link>
        </div>

        {fetching && <p className="text-sm text-slate-400">Loading batch details…</p>}
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {assignMessage && <p className="text-sm text-emerald-300">{assignMessage}</p>}

        {!fetching && !error && batch && (

<div className="flex flex-col gap-6">
  <section className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{batch.label ?? "Untitled Batch"}</p>
                  <h2 className="font-heading text-2xl uppercase tracking-[0.18em] text-white">{batch.id}</h2>
                  <p className="text-xs text-slate-500">
                    Created {new Date(batch.createdAt).toLocaleString()} · Updated {new Date(batch.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-300">
                  <p>
                    Status: <span className={batch.status === "READY" ? "text-emerald-300" : "text-slate-100"}>{batch.status}</span>
                  </p>
                  <p>
                    Processed {batch.processedCount}/{batch.totalCount}
                  </p>
                </div>
              </div>

            </section>

            <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-slate-300">Selected {selectedCards.length} cards</p>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedCards.length === 0) {
                      return;
                    }
                    setAssignError(null);
                    setAssignModalOpen(true);
                  }}
                  disabled={assigning || definitions.length === 0 || selectedCards.length === 0}
                  className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {assigning ? 'Assigning…' : 'Assign to Pack'}
                </button>
                <button
                  type="button"
                  onClick={selectAllReady}
                  className="rounded-full border border-white/20 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-200 transition hover:border-white/40 hover:text-white"
                >
                  Select Ready
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded-full border border-white/20 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-200 transition hover:border-white/40 hover:text-white"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setBulkEdit((prev) => !prev)}
                  className="rounded-full border border-violet-400/40 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-violet-200 transition hover:border-violet-300 hover:text-violet-100"
                >
                  {bulkEdit ? 'Exit Bulk Edit' : 'Bulk Edit'}
                </button>
              </div>
              {definitionsLoading && <p className="mt-3 text-xs text-slate-400">Loading pack definitions…</p>}
              {definitionsError && <p className="mt-3 text-xs text-rose-300">{definitionsError}</p>}
              {!definitionsLoading && !definitionsError && definitions.length === 0 && (
                <p className="mt-3 text-xs text-amber-300">Create a pack definition to enable assignment.</p>
              )}
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-xl uppercase tracking-[0.18em] text-white">Assets</h3>
                <p className="text-xs text-slate-400">{batch.assets.length} files</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {batch.assets.map((asset) => {
                  const previewSrc = asset.thumbnailUrl ?? asset.imageUrl;
                  const attributes = asset.classification ?? null;
                  const sportsSummary = buildSportsSummary(asset.sportsDb);
                  const baseAttributeTags = buildAttributeTags(attributes);
                  const attributeTags = (() => {
                    const seen = new Set<string>();
                    const candidates = [
                      sportsSummary.playerName,
                      sportsSummary.teamName,
                      ...baseAttributeTags,
                    ].filter((value): value is string => Boolean(value && value.trim().length > 0));
                    const result: string[] = [];
                    for (const value of candidates) {
                      const key = value.toUpperCase();
                      if (!seen.has(key)) {
                        seen.add(key);
                        result.push(value);
                      }
                    }
                    return result;
                  })();
                  const displayTitle = asset.customTitle ?? buildTitleFromAttributes(attributes, asset.fileName);
                  const valuationText =
                    asset.valuationMinor !== null
                      ? `${asset.valuationCurrency ?? "USD"} ${(asset.valuationMinor / 100).toFixed(2)}`
                      : "Not available";
                  const isSelected = selectedCards.includes(asset.id);
                  const assignedDefinition = definitions.find(
                    (definition) => definition.id === asset.assignedDefinitionId
                  );
                  const comparables = [
                    asset.ebaySoldUrl ? { label: "Exact match", href: asset.ebaySoldUrl } : null,
                    asset.ebaySoldUrlVariant ? { label: "Variant search", href: asset.ebaySoldUrlVariant } : null,
                    asset.ebaySoldUrlHighGrade ? { label: "High grade comps", href: asset.ebaySoldUrlHighGrade } : null,
                    asset.ebaySoldUrlPlayerComp ? { label: "Player comps", href: asset.ebaySoldUrlPlayerComp } : null,
                    asset.ebaySoldUrlAiGrade
                      ? {
                          label: asset.aiGrade?.psaEquivalent
                            ? `AI grade comps (PSA ${asset.aiGrade.psaEquivalent})`
                            : "AI grade comps",
                          href: asset.ebaySoldUrlAiGrade,
                        }
                      : null,
                  ].filter((link): link is { label: string; href: string } => Boolean(link));
                  const humanReviewSummary = asset.humanReviewedAt
                    ? `Reviewed ${new Date(asset.humanReviewedAt).toLocaleString()}${
                        asset.humanReviewerName ? ` · ${asset.humanReviewerName}` : ""
                      }`
                    : null;
                  const isSaving = Boolean(savingCards[asset.id]);

                  if (bulkEdit) {
                    const formState = forms[asset.id];
                    return (
                      <article key={asset.id} className="relative flex flex-col gap-3 rounded-3xl border border-white/10 bg-night-900/70 p-4">
                        <label className="absolute left-4 top-4 z-10 flex items-center gap-2 text-[11px] uppercase tracking-[0.25em]">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-emerald-400"
                            checked={isSelected}
                            onChange={() => toggleSelected(asset.id)}
                          />
                          <span className="hidden text-slate-200 sm:inline">Select</span>
                        </label>
                        <div className="mt-6 aspect-[4/5] w-full overflow-hidden rounded-2xl border border-white/10 bg-night-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={previewSrc} alt={asset.fileName} className="h-full w-full object-cover" />
                        </div>
                        <div className="flex flex-col gap-3 text-xs text-slate-300">
                          <div className="flex items-center justify-between">
                            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">{asset.id}</p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${
                                asset.status === "READY"
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : "bg-slate-500/20 text-slate-200"
                              }`}
                            >
                              {asset.status}
                            </span>
                          </div>
                          {humanReviewSummary && (
                            <div className="inline-flex flex-wrap items-center gap-2 self-start rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                              <span>Human reviewed</span>
                              <span className="text-[9px] uppercase tracking-[0.2em] text-emerald-100/80">{humanReviewSummary}</span>
                            </div>
                          )}
                          {formState ? (
                            <>
                              <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                <span>Display Title</span>
                                <input
                                  value={formState.customTitle}
                                  onChange={handleFormFieldChange(asset.id, "customTitle")}
                                  placeholder="e.g. 2024 Select Neon Orange Braelon Allen"
                                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                />
                              </label>

                              <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                <span>Manual Notes</span>
                                <textarea
                                  value={formState.customDetails}
                                  onChange={handleFormFieldChange(asset.id, "customDetails")}
                                  rows={3}
                                  placeholder="Add important details, variants, or corrections"
                                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                />
                              </label>

                              <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                <span>OCR Text</span>
                                <textarea
                                  value={formState.ocrText}
                                  onChange={handleFormFieldChange(asset.id, "ocrText")}
                                  rows={3}
                                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                />
                              </label>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                  <span>Appraised Value</span>
                                  <input
                                    value={formState.valuation}
                                    onChange={handleFormFieldChange(asset.id, "valuation")}
                                    placeholder="e.g. 125.00"
                                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                  />
                                </label>
                                <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                  <span>Currency</span>
                                  <input
                                    value={formState.valuationCurrency}
                                    onChange={handleFormFieldChange(asset.id, "valuationCurrency")}
                                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                  />
                                </label>
                              </div>

                              <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                <span>Valuation Source</span>
                                <input
                                  value={formState.valuationSource}
                                  onChange={handleFormFieldChange(asset.id, "valuationSource")}
                                  placeholder="e.g. Manual review"
                                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                />
                              </label>

                              <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                <span>Marketplace URL</span>
                                <input
                                  value={formState.marketplaceUrl}
                                  onChange={handleFormFieldChange(asset.id, "marketplaceUrl")}
                                  placeholder="Link to comp or marketplace listing"
                                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                />
                              </label>

                              <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                <span>Primary eBay Sold URL</span>
                                <input
                                  value={formState.ebaySoldUrl}
                                  onChange={handleFormFieldChange(asset.id, "ebaySoldUrl")}
                                  placeholder="https://www.ebay.com/sch/..."
                                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                />
                              </label>

                              {comparables.length > 0 && (
                                <div className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                                  <p className="text-[11px] uppercase tracking-[0.25em] text-sky-300">eBay Sold Comparables</p>
                                  <div className="mt-1 flex flex-wrap gap-2">
                                    {comparables.map(({ label, href }) => (
                                      <Link
                                        key={`${asset.id}-${label}`}
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center rounded-full border border-sky-400/40 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-sky-300 transition hover:border-sky-300 hover:text-sky-200"
                                      >
                                        {label}
                                      </Link>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {sportsSummary.playerName && (
                                <div className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                                  <p className="text-[11px] uppercase tracking-[0.25em] text-emerald-300">SportsDB Match</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-200">
                                    {sportsSummary.teamLogoUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={sportsSummary.teamLogoUrl}
                                        alt={sportsSummary.teamName ?? "Team"}
                                        className="h-10 w-10 rounded-full border border-white/10 bg-night-800 object-contain p-1"
                                      />
                                    ) : null}
                                    <div className="flex flex-col gap-1">
                                      <span className="uppercase tracking-[0.25em] text-slate-100">{sportsSummary.playerName}</span>
                                      <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                                        {sportsSummary.teamName ?? "Unknown team"}
                                      </span>
                                      <span className="text-[10px] uppercase tracking-[0.3em] text-emerald-300">
                                        Confidence {(sportsSummary.matchConfidence * 100).toFixed(0)}%
                                      </span>
                                    </div>
                                  </div>
                                  {sportsSummary.statEntries.length > 0 && (
                                    <ul className="mt-2 flex flex-wrap gap-1 text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                                      {sportsSummary.statEntries.slice(0, 4).map((entry) => (
                                        <li key={`${asset.id}-${entry.label}`} className="rounded-full bg-emerald-500/15 px-2 py-0.5">
                                          {entry.label}: {entry.value}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}

                              {attributeTags.length > 0 && (
                                <div className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                                  <p className="text-[11px] uppercase tracking-[0.25em] text-amber-300">Attributes</p>
                                  <ul className="flex flex-wrap gap-1 text-[11px] text-slate-200">
                                    {attributeTags.slice(0, 6).map((tag) => (
                                      <li key={`${asset.id}-${tag}`} className="rounded-full bg-white/10 px-2 py-0.5">
                                        {tag}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-emerald-400"
                                  checked={formState.humanReviewed}
                                  onChange={handleFormCheckboxChange(asset.id)}
                                />
                                <span>Mark as human reviewed</span>
                              </label>

                              {cardErrors[asset.id] && (
                                <p className="text-[11px] uppercase tracking-[0.2em] text-rose-300">{cardErrors[asset.id]}</p>
                              )}
                              {cardMessages[asset.id] && (
                                <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">{cardMessages[asset.id]}</p>
                              )}

                              <div className="flex justify-end pt-2">
                                <button
                                  type="button"
                                  onClick={() => handleBulkSave(asset.id)}
                                  disabled={isSaving}
                                  className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isSaving ? "Saving…" : "Save Card"}
                                </button>
                              </div>
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">Preparing editor…</p>
                          )}

                          <div className="flex gap-2 pt-1">
                            <a
                              href={previewSrc}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center rounded-full border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                            >
                              View Full
                            </a>
                            <Link
                              href={`/admin/cards/${asset.id}`}
                              className="inline-flex items-center justify-center rounded-full border border-emerald-400/30 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200"
                            >
                              Open Card
                            </Link>
                          </div>
                        </div>
                      </article>
                    );
                  }

                  return (
                    <article key={asset.id} className="relative flex flex-col gap-3 rounded-3xl border border-white/10 bg-night-900/70 p-4">
                      <label className="absolute left-4 top-4 z-10 flex items-center gap-2 text-[11px] uppercase tracking-[0.25em]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-emerald-400"
                          checked={isSelected}
                          onChange={() => toggleSelected(asset.id)}
                        />
                        <span className="hidden text-slate-200 sm:inline">Select</span>
                      </label>
                      <div className="mt-6 aspect-[4/5] w-full overflow-hidden rounded-2xl border border-white/10 bg-night-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewSrc} alt={asset.fileName} className="h-full w-full object-cover" />
                      </div>
                      <div className="flex flex-col gap-2 text-xs text-slate-300">
                        <div className="flex items-center justify-between">
                          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">{asset.id}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${
                              asset.status === "READY"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-slate-500/20 text-slate-200"
                            }`}
                          >
                            {asset.status}
                          </span>
                        </div>
                        {humanReviewSummary && (
                          <div className="inline-flex flex-wrap items-center gap-2 self-start rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                            <span>Human reviewed</span>
                            <span className="text-[9px] uppercase tracking-[0.2em] text-emerald-100/80">{humanReviewSummary}</span>
                          </div>
                        )}
                        <p className="text-sm text-white">{displayTitle}</p>
                        <p className="text-[11px] text-slate-500">{asset.fileName}</p>
                        {asset.assignedDefinitionId && (
                          <p className="text-[11px] uppercase tracking-[0.25em] text-emerald-300">
                            Assigned to {assignedDefinition?.name ?? asset.assignedDefinitionId}
                          </p>
                        )}
                        <p>Uploaded {new Date(asset.uploadedAt).toLocaleString()}</p>
                        <p>{(asset.fileSize / 1024).toFixed(0)} KB · {asset.mimeType}</p>

                        {asset.customDetails && (
                          <div className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                            <p className="text-[11px] uppercase tracking-[0.25em] text-emerald-200">Manual Notes</p>
                            <p className="text-xs text-slate-200 whitespace-pre-wrap">{asset.customDetails}</p>
                          </div>
                        )}

                        {asset.ocrText && (
                          <div className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                            <p className="text-[11px] uppercase tracking-[0.25em] text-violet-300">OCR</p>
                            <p className="text-xs text-slate-200 line-clamp-3">{asset.ocrText}</p>
                          </div>
                        )}

                        {sportsSummary.playerName && (
                          <div className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                            <p className="text-[11px] uppercase tracking-[0.25em] text-emerald-300">SportsDB Match</p>
                            <div className="mt-2 flex items-center gap-3">
                              {sportsSummary.teamLogoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={sportsSummary.teamLogoUrl}
                                  alt={sportsSummary.teamName ?? "Team"}
                                  className="h-12 w-12 rounded-full border border-white/10 bg-night-800 object-contain p-2"
                                />
                              ) : null}
                              <div className="flex flex-col gap-1 text-[11px] text-slate-200">
                                <span className="uppercase tracking-[0.25em] text-slate-100">{sportsSummary.playerName}</span>
                                <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                                  {sportsSummary.teamName ?? "Unknown team"}
                                </span>
                                <span className="text-[10px] uppercase tracking-[0.3em] text-emerald-300">
                                  Confidence {(sportsSummary.matchConfidence * 100).toFixed(0)}%
                                </span>
                                {sportsSummary.seasonLabel && (
                                  <span className="text-[9px] uppercase tracking-[0.3em] text-slate-500">
                                    Latest season {sportsSummary.seasonLabel}
                                  </span>
                                )}
                              </div>
                            </div>
                            {sportsSummary.statEntries.length > 0 && (
                              <ul className="mt-2 flex flex-wrap gap-1 text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                                {sportsSummary.statEntries.slice(0, 4).map((entry) => (
                                  <li key={`${asset.id}-${entry.label}`} className="rounded-full bg-emerald-500/15 px-2 py-0.5">
                                    {entry.label}: {entry.value}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        {attributeTags.length > 0 && (
                          <div className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                            <p className="text-[11px] uppercase tracking-[0.25em] text-amber-300">Attributes</p>
                            <ul className="flex flex-wrap gap-1 text-[11px] text-slate-200">
                              {attributeTags.slice(0, 6).map((tag) => (
                                <li key={`${asset.id}-${tag}`} className="rounded-full bg-white/10 px-2 py-0.5">
                                  {tag}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {(asset.valuationMinor !== null || asset.marketplaceUrl) && (
                          <div className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                            <p className="text-[11px] uppercase tracking-[0.25em] text-emerald-300">Valuation</p>
                            <p className="text-xs text-slate-200">
                              {valuationText}
                              {asset.valuationSource ? ` · ${asset.valuationSource}` : ""}
                            </p>
                            {asset.marketplaceUrl && (
                              <Link
                                href={asset.marketplaceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex text-[11px] uppercase tracking-[0.25em] text-emerald-300 hover:text-emerald-200"
                              >
                                View comparable
                              </Link>
                            )}
                          </div>
                        )}

                        {asset.aiGrade && (
                          <div className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                            <p className="text-[11px] uppercase tracking-[0.25em] text-indigo-300">AI Grade</p>
                            <p className="text-xs text-slate-200">
                              {asset.aiGrade.final !== null
                                ? `Grade ${asset.aiGrade.final.toFixed(1)}`
                                : "Pending"}
                              {asset.aiGrade.psaEquivalent !== null
                                ? ` · PSA ${asset.aiGrade.psaEquivalent}`
                                : ""}
                            </p>
                            {asset.aiGrade.rangeLow !== null && asset.aiGrade.rangeHigh !== null && (
                              <p className="text-[11px] text-slate-400">
                                Range {asset.aiGrade.rangeLow} – {asset.aiGrade.rangeHigh}
                              </p>
                            )}
                            {asset.aiGrade.label && (
                              <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-300">
                                {asset.aiGrade.label}
                              </p>
                            )}
                          </div>
                        )}

                        {comparables.length > 0 && (
                          <div className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                            <p className="text-[11px] uppercase tracking-[0.25em] text-sky-300">eBay Sold</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {comparables.map(({ label, href }) => (
                                <Link
                                  key={`${asset.id}-${label}`}
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center justify-center rounded-full border border-sky-400/40 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-sky-300 transition hover:border-sky-300 hover:text-sky-200"
                                >
                                  {label}
                                </Link>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2 pt-1">
                          <Link
                            href={previewSrc}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-full border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                          >
                            View Full
                          </Link>
                          <Link
                            href={`/admin/cards/${asset.id}`}
                            className="inline-flex items-center justify-center rounded-full border border-emerald-400/30 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200"
                          >
                            Edit
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
      {assignModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-night-900/80 px-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-night-900 p-6 shadow-2xl">
            <h3 className="font-heading text-xl uppercase tracking-[0.18em] text-white">Assign Cards</h3>
            <p className="mt-2 text-xs text-slate-300">Choose the collectible category and pack tier to route these cards.</p>

            <div className="mt-4 flex flex-col gap-3 text-xs text-slate-200">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Category</span>
                <select
                  value={assignCategory}
                  onChange={(event) => setAssignCategory(event.currentTarget.value as CollectibleCategory)}
                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-white outline-none transition focus:border-emerald-400/60"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Pack Tier</span>
                <select
                  value={assignTier}
                  onChange={(event) => setAssignTier(event.currentTarget.value as PackTier)}
                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-white outline-none transition focus:border-emerald-400/60"
                >
                  {TIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {matchingDefinitions.length > 1 && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Pack</span>
                  <select
                    value={assignPackId}
                    onChange={(event) => setAssignPackId(event.currentTarget.value)}
                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-white outline-none transition focus:border-emerald-400/60"
                  >
                    <option value="">Select a pack…</option>
                    {matchingDefinitions.map((definition) => (
                      <option key={definition.id} value={definition.id}>
                        {definition.name} · {(definition.price / 100).toFixed(2)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {matchingDefinitions.length === 0 && (
                <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-rose-200">
                  No pack definitions match the selected category and tier.
                </p>
              )}

              {assignError && (
                <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-rose-200">
                  {assignError}
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3 text-xs uppercase tracking-[0.28em]">
              <button
                type="button"
                onClick={() => {
                  if (!assigning) {
                    setAssignModalOpen(false);
                  }
                }}
                className="rounded-full border border-white/20 px-4 py-2 text-slate-200 transition hover:border-white/40 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssignToDefinition}
                disabled={assigning || matchingDefinitions.length === 0 || !targetDefinitionId}
                className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-5 py-2 text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {assigning ? 'Assigning…' : 'Confirm Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
