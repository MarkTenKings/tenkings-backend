import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import AppShell from "../../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import type {
  CardAttributes,
  ClassificationCategory,
  NormalizedClassification,
  NormalizedClassificationSport,
  NormalizedClassificationTcg,
  NormalizedClassificationComics,
} from "@tenkings/shared";

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
  classificationNormalized: NormalizedClassification | null;
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

type AttributeFormState = {
  playerName: string;
  teamName: string;
  year: string;
  brand: string;
  setName: string;
  variantKeywords: string;
  serialNumber: string;
  rookie: boolean;
  autograph: boolean;
  memorabilia: boolean;
  gradeCompany: string;
  gradeValue: string;
};

type TriState = "unknown" | "yes" | "no";

type NormalizedSportFormState = {
  playerName: string;
  teamName: string;
  league: string;
  sport: string;
  cardType: string;
  subcategory: string;
  autograph: TriState;
  foil: TriState;
  graded: TriState;
  gradeCompany: string;
  grade: string;
};

type NormalizedTcgFormState = {
  cardName: string;
  game: string;
  series: string;
  color: string;
  type: string;
  language: string;
  foil: TriState;
  rarity: string;
  outOf: string;
  subcategory: string;
};

type NormalizedComicsFormState = {
  title: string;
  issueNumber: string;
  date: string;
  originDate: string;
  storyArc: string;
  graded: TriState;
  gradeCompany: string;
  grade: string;
};

type NormalizedLinkEntry = {
  id: string;
  key: string;
  value: string;
};

type NormalizedFormState = {
  enabled: boolean;
  categoryType: ClassificationCategory;
  displayName: string;
  cardNumber: string;
  setName: string;
  setCode: string;
  year: string;
  company: string;
  rarity: string;
  links: NormalizedLinkEntry[];
  sport: NormalizedSportFormState;
  tcg: NormalizedTcgFormState;
  comics: NormalizedComicsFormState;
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
  ebaySoldUrlVariant: string;
  ebaySoldUrlHighGrade: string;
  ebaySoldUrlPlayerComp: string;
  ebaySoldUrlAiGrade: string;
  humanReviewed: boolean;
  aiGradeFinal: string;
  aiGradeLabel: string;
  aiGradePsaEquivalent: string;
  aiGradeRangeLow: string;
  aiGradeRangeHigh: string;
  attributes: AttributeFormState;
  normalized: NormalizedFormState;
};

const triStateFromBoolean = (value: boolean | null | undefined): TriState => {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
};

const triStateToBoolean = (value: TriState): boolean | null => {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
};

const makeLinkEntryId = () => `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const buildAttributeFormState = (attributes: CardAttributes | null): AttributeFormState => ({
  playerName: attributes?.playerName ?? "",
  teamName: attributes?.teamName ?? "",
  year: attributes?.year ?? "",
  brand: attributes?.brand ?? "",
  setName: attributes?.setName ?? "",
  variantKeywords: (attributes?.variantKeywords ?? []).join(", "),
  serialNumber: attributes?.serialNumber ?? "",
  rookie: attributes?.rookie ?? false,
  autograph: attributes?.autograph ?? false,
  memorabilia: attributes?.memorabilia ?? false,
  gradeCompany: attributes?.gradeCompany ?? "",
  gradeValue: attributes?.gradeValue ?? "",
});

const buildNormalizedFormState = (
  normalized: NormalizedClassification | null
): NormalizedFormState => {
  const rawLinks = normalized?.links ?? {};
  const links: NormalizedLinkEntry[] = Object.entries(rawLinks).map(([key, value]) => ({
    id: makeLinkEntryId(),
    key,
    value,
  }));

  const sport = normalized?.sport ?? ({} as NormalizedClassificationSport | undefined);
  const tcg = normalized?.tcg ?? ({} as NormalizedClassificationTcg | undefined);
  const comics = normalized?.comics ?? ({} as NormalizedClassificationComics | undefined);

  return {
    enabled: Boolean(normalized),
    categoryType: normalized?.categoryType ?? "unknown",
    displayName: normalized?.displayName ?? "",
    cardNumber: normalized?.cardNumber ?? "",
    setName: normalized?.setName ?? "",
    setCode: normalized?.setCode ?? "",
    year: normalized?.year ?? "",
    company: normalized?.company ?? "",
    rarity: normalized?.rarity ?? "",
    links,
    sport: {
      playerName: sport?.playerName ?? "",
      teamName: sport?.teamName ?? "",
      league: sport?.league ?? "",
      sport: sport?.sport ?? "",
      cardType: sport?.cardType ?? "",
      subcategory: sport?.subcategory ?? "",
      autograph: triStateFromBoolean(sport?.autograph ?? null),
      foil: triStateFromBoolean(sport?.foil ?? null),
      graded: triStateFromBoolean(sport?.graded ?? null),
      gradeCompany: sport?.gradeCompany ?? "",
      grade: sport?.grade ?? "",
    },
    tcg: {
      cardName: tcg?.cardName ?? "",
      game: tcg?.game ?? "",
      series: tcg?.series ?? "",
      color: tcg?.color ?? "",
      type: tcg?.type ?? "",
      language: tcg?.language ?? "",
      foil: triStateFromBoolean(tcg?.foil ?? null),
      rarity: tcg?.rarity ?? "",
      outOf: tcg?.outOf ?? "",
      subcategory: tcg?.subcategory ?? "",
    },
    comics: {
      title: comics?.title ?? "",
      issueNumber: comics?.issueNumber ?? "",
      date: comics?.date ?? "",
      originDate: comics?.originDate ?? "",
      storyArc: comics?.storyArc ?? "",
      graded: triStateFromBoolean(comics?.graded ?? null),
      gradeCompany: comics?.gradeCompany ?? "",
      grade: comics?.grade ?? "",
    },
  };
};

const parseVariantKeywords = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const emptyToNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  classificationNormalized: NormalizedClassification | null;
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
  const [regeneratingCards, setRegeneratingCards] = useState<Record<string, boolean>>({});
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
        const json = (await res.json().catch(() => ({}))) as {
            definitions?: PackDefinitionSummary[];
            message?: string;
          };

          if (!Array.isArray(json.definitions)) {
            throw new Error(json.message ?? "Unable to load pack definitions");
          }

          if (!cancelled) {
            setDefinitions(json.definitions);
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
      const attributeState = buildAttributeFormState(asset.classification);
      const normalizedState = buildNormalizedFormState(asset.classificationNormalized ?? null);
      next[asset.id] = {
        customTitle: asset.customTitle ?? '',
        customDetails: asset.customDetails ?? '',
        ocrText: asset.ocrText ?? '',
        valuation: asset.valuationMinor !== null ? (asset.valuationMinor / 100).toFixed(2) : '',
        valuationCurrency: asset.valuationCurrency ?? 'USD',
        valuationSource: asset.valuationSource ?? '',
        marketplaceUrl: asset.marketplaceUrl ?? '',
        ebaySoldUrl: asset.ebaySoldUrl ?? '',
        ebaySoldUrlVariant: asset.ebaySoldUrlVariant ?? '',
        ebaySoldUrlHighGrade: asset.ebaySoldUrlHighGrade ?? '',
        ebaySoldUrlPlayerComp: asset.ebaySoldUrlPlayerComp ?? '',
        ebaySoldUrlAiGrade: asset.ebaySoldUrlAiGrade ?? '',
        humanReviewed: asset.humanReviewedAt !== null,
        aiGradeFinal: asset.aiGrade?.final != null ? String(asset.aiGrade.final) : '',
        aiGradeLabel: asset.aiGrade?.label ?? '',
        aiGradePsaEquivalent:
          asset.aiGrade?.psaEquivalent != null ? String(asset.aiGrade.psaEquivalent) : '',
        aiGradeRangeLow: asset.aiGrade?.rangeLow != null ? String(asset.aiGrade.rangeLow) : '',
        aiGradeRangeHigh: asset.aiGrade?.rangeHigh != null ? String(asset.aiGrade.rangeHigh) : '',
        attributes: attributeState,
        normalized: normalizedState,
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

const handleAttributeFieldChange = (
  cardId: string,
  field: keyof AttributeFormState
) =>
  (event: ChangeEvent<HTMLInputElement>) => {
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
          attributes: {
            ...current.attributes,
            [field]: value,
          },
        },
      };
    });
  };

const handleAttributeCheckboxChange = (cardId: string, field: "rookie" | "autograph" | "memorabilia") =>
  (event: ChangeEvent<HTMLInputElement>) => {
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
          attributes: {
            ...current.attributes,
            [field]: checked,
          },
        },
      };
    });
  };

const handleNormalizedEnabledToggle = (cardId: string) => (event: ChangeEvent<HTMLInputElement>) => {
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
        normalized: {
          ...current.normalized,
          enabled: checked,
        },
      },
    };
  });
};

const handleNormalizedFieldChange = (
  cardId: string,
  field: keyof Omit<NormalizedFormState, "enabled" | "links" | "sport" | "tcg" | "comics">
) =>
  (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const raw = event.currentTarget.value;
    setForms((prev) => {
      const current = prev[cardId];
      if (!current) {
        return prev;
      }
      if (field === "categoryType") {
        return {
          ...prev,
          [cardId]: {
            ...current,
            normalized: {
              ...current.normalized,
              categoryType: raw as ClassificationCategory,
            },
          },
        };
      }
      return {
        ...prev,
        [cardId]: {
          ...current,
          normalized: {
            ...current.normalized,
            [field]: raw,
          },
        },
      };
    });
  };

const handleNormalizedSportChange = (
  cardId: string,
  field: keyof NormalizedSportFormState
) =>
  (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const raw = event.currentTarget.value;
    setForms((prev) => {
      const current = prev[cardId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [cardId]: {
          ...current,
          normalized: {
            ...current.normalized,
            sport: {
              ...current.normalized.sport,
              [field]: field === "autograph" || field === "foil" || field === "graded" ? (raw as TriState) : raw,
            },
          },
        },
      };
    });
  };

const handleNormalizedTcgChange = (
  cardId: string,
  field: keyof NormalizedTcgFormState
) =>
  (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const raw = event.currentTarget.value;
    setForms((prev) => {
      const current = prev[cardId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [cardId]: {
          ...current,
          normalized: {
            ...current.normalized,
            tcg: {
              ...current.normalized.tcg,
              [field]: field === "foil" ? (raw as TriState) : raw,
            },
          },
        },
      };
    });
  };

const handleNormalizedComicsChange = (
  cardId: string,
  field: keyof NormalizedComicsFormState
) =>
  (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const raw = event.currentTarget.value;
    setForms((prev) => {
      const current = prev[cardId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [cardId]: {
          ...current,
          normalized: {
            ...current.normalized,
            comics: {
              ...current.normalized.comics,
              [field]: field === "graded" ? (raw as TriState) : raw,
            },
          },
        },
      };
    });
  };

const handleNormalizedLinkFieldChange = (
  cardId: string,
  linkId: string,
  field: "key" | "value",
  value: string
) => {
  setForms((prev) => {
    const current = prev[cardId];
    if (!current) {
      return prev;
    }
    return {
      ...prev,
      [cardId]: {
        ...current,
        normalized: {
          ...current.normalized,
          links: current.normalized.links.map((entry) =>
            entry.id === linkId ? { ...entry, [field]: value } : entry
          ),
        },
      },
    };
  });
};

const handleAddNormalizedLink = (cardId: string) => () => {
  setForms((prev) => {
    const current = prev[cardId];
    if (!current) {
      return prev;
    }
    return {
      ...prev,
      [cardId]: {
        ...current,
        normalized: {
          ...current.normalized,
          links: [...current.normalized.links, { id: makeLinkEntryId(), key: "", value: "" }],
        },
      },
    };
  });
};

const handleRemoveNormalizedLink = (cardId: string, linkId: string) => () => {
  setForms((prev) => {
    const current = prev[cardId];
    if (!current) {
      return prev;
    }
    return {
      ...prev,
      [cardId]: {
        ...current,
        normalized: {
          ...current.normalized,
          links: current.normalized.links.filter((entry) => entry.id !== linkId),
        },
      },
    };
  });
};

const applyCardUpdate = (cardId: string, updated: CardApiResponse, message: string) => {
  setBatch((current) => {
    if (!current) return current;
    const updatedAssets = current.assets.map((asset) =>
      asset.id === cardId
        ? {
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
            classification: updated.classification,
            classificationNormalized: updated.classificationNormalized,
            humanReviewedAt: updated.humanReviewedAt,
            humanReviewerName: updated.humanReviewerName,
          }
        : asset
    );
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
      ebaySoldUrlVariant: updated.ebaySoldUrlVariant ?? "",
      ebaySoldUrlHighGrade: updated.ebaySoldUrlHighGrade ?? "",
      ebaySoldUrlPlayerComp: updated.ebaySoldUrlPlayerComp ?? "",
      ebaySoldUrlAiGrade: updated.ebaySoldUrlAiGrade ?? "",
      humanReviewed: updated.humanReviewedAt !== null,
      aiGradeFinal: updated.aiGrade?.final != null ? String(updated.aiGrade.final) : "",
      aiGradeLabel: updated.aiGrade?.label ?? "",
      aiGradePsaEquivalent:
        updated.aiGrade?.psaEquivalent != null ? String(updated.aiGrade.psaEquivalent) : "",
      aiGradeRangeLow: updated.aiGrade?.rangeLow != null ? String(updated.aiGrade.rangeLow) : "",
      aiGradeRangeHigh: updated.aiGrade?.rangeHigh != null ? String(updated.aiGrade.rangeHigh) : "",
      attributes: buildAttributeFormState(updated.classification ?? null),
      normalized: buildNormalizedFormState(updated.classificationNormalized ?? null),
    },
  }));

  setCardMessages((prev) => ({ ...prev, [cardId]: message }));
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
    const parseOptionalNumber = (value: string, label: string, opts?: { integer?: boolean }) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        setCardErrors((prev) => ({ ...prev, [cardId]: `${label} must be a number` }));
        setSavingCards((prev) => ({ ...prev, [cardId]: false }));
        return undefined;
      }
      return opts?.integer ? Math.round(parsed) : parsed;
    };

    const aiGradeFinalValue = parseOptionalNumber(formState.aiGradeFinal, "AI grade final");
    if (aiGradeFinalValue === undefined) {
      return;
    }
    const aiGradePsaValue = parseOptionalNumber(formState.aiGradePsaEquivalent, "PSA equivalent", {
      integer: true,
    });
    if (aiGradePsaValue === undefined) {
      return;
    }
    const aiGradeRangeLowValue = parseOptionalNumber(formState.aiGradeRangeLow, "AI grade range (low)", {
      integer: true,
    });
    if (aiGradeRangeLowValue === undefined) {
      return;
    }
    const aiGradeRangeHighValue = parseOptionalNumber(
      formState.aiGradeRangeHigh,
      "AI grade range (high)",
      { integer: true }
    );
    if (aiGradeRangeHighValue === undefined) {
      return;
    }

    const originalAsset = batch.assets.find((asset) => asset.id === cardId) ?? null;

    let classificationUpdates: Record<string, unknown> | null = null;

    const attributePayload = {
      playerName: emptyToNull(formState.attributes.playerName),
      teamName: emptyToNull(formState.attributes.teamName),
      year: emptyToNull(formState.attributes.year),
      brand: emptyToNull(formState.attributes.brand),
      setName: emptyToNull(formState.attributes.setName),
      variantKeywords: parseVariantKeywords(formState.attributes.variantKeywords),
      serialNumber: emptyToNull(formState.attributes.serialNumber),
      rookie: formState.attributes.rookie,
      autograph: formState.attributes.autograph,
      memorabilia: formState.attributes.memorabilia,
      gradeCompany: emptyToNull(formState.attributes.gradeCompany),
      gradeValue: emptyToNull(formState.attributes.gradeValue),
    };

    classificationUpdates = { attributes: attributePayload };

    if (!formState.normalized.enabled) {
      (classificationUpdates as Record<string, unknown>).normalized = null;
    } else {
      const normalizedLinks: Record<string, string | null> = {};
      const seenKeys = new Set<string>();
      formState.normalized.links.forEach((entry) => {
        const key = entry.key.trim();
        if (!key) {
          return;
        }
        seenKeys.add(key);
        const value = entry.value.trim();
        normalizedLinks[key] = value.length > 0 ? value : null;
      });

      const existingLinkKeys = Object.keys(originalAsset?.classificationNormalized?.links ?? {});
      existingLinkKeys.forEach((key) => {
        if (!seenKeys.has(key)) {
          normalizedLinks[key] = null;
        }
      });

      const sportPayload = {
        playerName: emptyToNull(formState.normalized.sport.playerName),
        teamName: emptyToNull(formState.normalized.sport.teamName),
        league: emptyToNull(formState.normalized.sport.league),
        sport: emptyToNull(formState.normalized.sport.sport),
        cardType: emptyToNull(formState.normalized.sport.cardType),
        subcategory: emptyToNull(formState.normalized.sport.subcategory),
        autograph: triStateToBoolean(formState.normalized.sport.autograph),
        foil: triStateToBoolean(formState.normalized.sport.foil),
        graded: triStateToBoolean(formState.normalized.sport.graded),
        gradeCompany: emptyToNull(formState.normalized.sport.gradeCompany),
        grade: emptyToNull(formState.normalized.sport.grade),
      } as Partial<NormalizedClassificationSport>;

      const tcgPayload = {
        cardName: emptyToNull(formState.normalized.tcg.cardName),
        game: emptyToNull(formState.normalized.tcg.game),
        series: emptyToNull(formState.normalized.tcg.series),
        color: emptyToNull(formState.normalized.tcg.color),
        type: emptyToNull(formState.normalized.tcg.type),
        language: emptyToNull(formState.normalized.tcg.language),
        foil: triStateToBoolean(formState.normalized.tcg.foil),
        rarity: emptyToNull(formState.normalized.tcg.rarity),
        outOf: emptyToNull(formState.normalized.tcg.outOf),
        subcategory: emptyToNull(formState.normalized.tcg.subcategory),
      } as Partial<NormalizedClassificationTcg>;

      const comicsPayload = {
        title: emptyToNull(formState.normalized.comics.title),
        issueNumber: emptyToNull(formState.normalized.comics.issueNumber),
        date: emptyToNull(formState.normalized.comics.date),
        originDate: emptyToNull(formState.normalized.comics.originDate),
        storyArc: emptyToNull(formState.normalized.comics.storyArc),
        graded: triStateToBoolean(formState.normalized.comics.graded),
        gradeCompany: emptyToNull(formState.normalized.comics.gradeCompany),
        grade: emptyToNull(formState.normalized.comics.grade),
      } as Partial<NormalizedClassificationComics>;

      (classificationUpdates as Record<string, unknown>).normalized = {
        categoryType: formState.normalized.categoryType,
        displayName: emptyToNull(formState.normalized.displayName),
        cardNumber: emptyToNull(formState.normalized.cardNumber),
        setName: emptyToNull(formState.normalized.setName),
        setCode: emptyToNull(formState.normalized.setCode),
        year: emptyToNull(formState.normalized.year),
        company: emptyToNull(formState.normalized.company),
        rarity: emptyToNull(formState.normalized.rarity),
        links: normalizedLinks,
        sport: sportPayload,
        tcg: tcgPayload,
        comics: comicsPayload,
      };
    }

    const payload: Record<string, unknown> = {
      customTitle: formState.customTitle.trim() || null,
      customDetails: formState.customDetails.trim() || null,
      ocrText: formState.ocrText.trim() || null,
      valuationMinor,
      valuationCurrency: formState.valuationCurrency.trim() || null,
      valuationSource: formState.valuationSource.trim() || null,
      marketplaceUrl: formState.marketplaceUrl.trim() || null,
      ebaySoldUrl: formState.ebaySoldUrl.trim() || null,
      ebaySoldUrlVariant: formState.ebaySoldUrlVariant.trim() || null,
      ebaySoldUrlHighGrade: formState.ebaySoldUrlHighGrade.trim() || null,
      ebaySoldUrlPlayerComp: formState.ebaySoldUrlPlayerComp.trim() || null,
      ebaySoldUrlAiGrade: formState.ebaySoldUrlAiGrade.trim() || null,
      humanReviewed: formState.humanReviewed,
      aiGradeFinal: aiGradeFinalValue,
      aiGradeLabel: emptyToNull(formState.aiGradeLabel) ?? null,
      aiGradePsaEquivalent: aiGradePsaValue,
      aiGradeRangeLow: aiGradeRangeLowValue,
      aiGradeRangeHigh: aiGradeRangeHighValue,
    };

    if (classificationUpdates) {
      payload.classificationUpdates = classificationUpdates;
    }

    const res = await fetch(`/api/admin/cards/${cardId}`, {
      method: "PATCH",
      headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.message ?? "Failed to update card");
    }

    const updated = (await res.json()) as CardApiResponse;

    applyCardUpdate(cardId, updated, "Saved");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update card";
    setCardErrors((prev) => ({ ...prev, [cardId]: message }));
  } finally {
    setSavingCards((prev) => ({ ...prev, [cardId]: false }));
  }
};

const handleBulkRegenerate = async (cardId: string) => {
  if (!session?.token) {
    return;
  }

  setRegeneratingCards((prev) => ({ ...prev, [cardId]: true }));
  setCardErrors((prev) => ({ ...prev, [cardId]: null }));
  setCardMessages((prev) => ({ ...prev, [cardId]: null }));

  try {
    const res = await fetch(`/api/admin/cards/${cardId}/regenerate-comps`, {
      method: "POST",
      headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.message ?? "Failed to regenerate comps");
    }

    const refreshed = await fetch(`/api/admin/cards/${cardId}`, {
      headers: buildAdminHeaders(session.token),
    });

    if (!refreshed.ok) {
      const payload = await refreshed.json().catch(() => ({}));
      throw new Error(payload?.message ?? "Failed to refresh card");
    }

    const updated = (await refreshed.json()) as CardApiResponse;
    applyCardUpdate(cardId, updated, "eBay comps regenerated");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to regenerate comps";
    setCardErrors((prev) => ({ ...prev, [cardId]: message }));
  } finally {
    setRegeneratingCards((prev) => ({ ...prev, [cardId]: false }));
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
                  const isRegenerating = Boolean(regeneratingCards[asset.id]);

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

                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                  <span>Variant eBay URL</span>
                                  <input
                                    value={formState.ebaySoldUrlVariant}
                                    onChange={handleFormFieldChange(asset.id, "ebaySoldUrlVariant")}
                                    placeholder="Variant comps search"
                                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                  />
                                </label>
                                <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                  <span>High Grade URL</span>
                                  <input
                                    value={formState.ebaySoldUrlHighGrade}
                                    onChange={handleFormFieldChange(asset.id, "ebaySoldUrlHighGrade")}
                                    placeholder="High grade comps"
                                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                  />
                                </label>
                              </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                  <span>Player Comp URL</span>
                                  <input
                                    value={formState.ebaySoldUrlPlayerComp}
                                    onChange={handleFormFieldChange(asset.id, "ebaySoldUrlPlayerComp")}
                                    placeholder="Player comp search"
                                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                  />
                                </label>
                                <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                                  <span>AI Grade URL</span>
                                  <input
                                    value={formState.ebaySoldUrlAiGrade}
                                    onChange={handleFormFieldChange(asset.id, "ebaySoldUrlAiGrade")}
                                    placeholder="AI grade comps"
                                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                  />
                                </label>
                              </div>

                              <details className="rounded-2xl border border-white/10 bg-night-900/60 p-3">
                                <summary className="cursor-pointer text-[11px] uppercase tracking-[0.25em] text-emerald-300">Card Attributes</summary>
                                <div className="mt-3 grid gap-2 text-xs text-slate-300">
                                  <div className="grid gap-2">
                                    <input
                                      value={formState.attributes.playerName}
                                      onChange={handleAttributeFieldChange(asset.id, "playerName")}
                                      placeholder="Player name"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                    />
                                    <input
                                      value={formState.attributes.teamName}
                                      onChange={handleAttributeFieldChange(asset.id, "teamName")}
                                      placeholder="Team"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                      <input
                                        value={formState.attributes.year}
                                        onChange={handleAttributeFieldChange(asset.id, "year")}
                                        placeholder="Year"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                      />
                                      <input
                                        value={formState.attributes.serialNumber}
                                        onChange={handleAttributeFieldChange(asset.id, "serialNumber")}
                                        placeholder="Serial"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                      />
                                    </div>
                                    <input
                                      value={formState.attributes.brand}
                                      onChange={handleAttributeFieldChange(asset.id, "brand")}
                                      placeholder="Brand"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                    />
                                    <input
                                      value={formState.attributes.setName}
                                      onChange={handleAttributeFieldChange(asset.id, "setName")}
                                      placeholder="Set name"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                    />
                                    <input
                                      value={formState.attributes.variantKeywords}
                                      onChange={handleAttributeFieldChange(asset.id, "variantKeywords")}
                                      placeholder="Variants (comma separated)"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                      <input
                                        value={formState.attributes.gradeCompany}
                                        onChange={handleAttributeFieldChange(asset.id, "gradeCompany")}
                                        placeholder="Grade company"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                      />
                                      <input
                                        value={formState.attributes.gradeValue}
                                        onChange={handleAttributeFieldChange(asset.id, "gradeValue")}
                                        placeholder="Grade value"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                                      />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-[0.28em] text-slate-400">
                                    <label className="inline-flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 accent-emerald-400"
                                        checked={formState.attributes.rookie}
                                        onChange={handleAttributeCheckboxChange(asset.id, "rookie")}
                                      />
                                      Rookie
                                    </label>
                                    <label className="inline-flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 accent-emerald-400"
                                        checked={formState.attributes.autograph}
                                        onChange={handleAttributeCheckboxChange(asset.id, "autograph")}
                                      />
                                      Autograph
                                    </label>
                                    <label className="inline-flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 accent-emerald-400"
                                        checked={formState.attributes.memorabilia}
                                        onChange={handleAttributeCheckboxChange(asset.id, "memorabilia")}
                                      />
                                      Memorabilia
                                    </label>
                                  </div>
                                </div>
                              </details>

                              <details className="rounded-2xl border border-white/10 bg-night-900/60 p-3">
                                <summary className="cursor-pointer text-[11px] uppercase tracking-[0.25em] text-sky-300">Normalized Classification</summary>
                                <div className="mt-3 flex flex-col gap-3 text-[11px] text-slate-300">
                                  <label className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-slate-400">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 accent-sky-400"
                                      checked={formState.normalized.enabled}
                                      onChange={handleNormalizedEnabledToggle(asset.id)}
                                    />
                                    Enabled
                                  </label>
                                  <div className="grid gap-2">
                                    <select
                                      value={formState.normalized.categoryType}
                                      onChange={handleNormalizedFieldChange(asset.id, "categoryType")}
                                      disabled={!formState.normalized.enabled}
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      <option value="unknown">Unknown</option>
                                      <option value="sport">Sport</option>
                                      <option value="tcg">TCG</option>
                                      <option value="comics">Comics</option>
                                    </select>
                                    <input
                                      value={formState.normalized.displayName}
                                      onChange={handleNormalizedFieldChange(asset.id, "displayName")}
                                      disabled={!formState.normalized.enabled}
                                      placeholder="Display name"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                      <input
                                        value={formState.normalized.cardNumber}
                                        onChange={handleNormalizedFieldChange(asset.id, "cardNumber")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Card number"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.setCode}
                                        onChange={handleNormalizedFieldChange(asset.id, "setCode")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Set code"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <input
                                        value={formState.normalized.setName}
                                        onChange={handleNormalizedFieldChange(asset.id, "setName")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Set name"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.year}
                                        onChange={handleNormalizedFieldChange(asset.id, "year")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Year"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                    </div>
                                    <input
                                      value={formState.normalized.company}
                                      onChange={handleNormalizedFieldChange(asset.id, "company")}
                                      disabled={!formState.normalized.enabled}
                                      placeholder="Company / Publisher"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                    <input
                                      value={formState.normalized.rarity}
                                      onChange={handleNormalizedFieldChange(asset.id, "rarity")}
                                      disabled={!formState.normalized.enabled}
                                      placeholder="Rarity"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3">
                                    <div className="flex items-center justify-between">
                                      <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Reference Links</p>
                                      <button
                                        type="button"
                                        onClick={handleAddNormalizedLink(asset.id)}
                                        disabled={!formState.normalized.enabled}
                                        className="rounded-full border border-sky-400/40 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-sky-300 transition hover:border-sky-300 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Add Link
                                      </button>
                                    </div>
                                    <div className="mt-2 flex flex-col gap-2">
                                      {formState.normalized.links.length === 0 && (
                                        <p className="text-[11px] text-slate-500">No links captured.</p>
                                      )}
                                      {formState.normalized.links.map((entry) => (
                                        <div key={entry.id} className="flex flex-col gap-2 md:flex-row">
                                          <input
                                            value={entry.key}
                                            onChange={(event) =>
                                              handleNormalizedLinkFieldChange(asset.id, entry.id, "key", event.currentTarget.value)
                                            }
                                            disabled={!formState.normalized.enabled}
                                            placeholder="Provider"
                                            className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50 md:w-32"
                                          />
                                          <div className="flex flex-1 gap-2">
                                            <input
                                              value={entry.value}
                                              onChange={(event) =>
                                                handleNormalizedLinkFieldChange(asset.id, entry.id, "value", event.currentTarget.value)
                                              }
                                              disabled={!formState.normalized.enabled}
                                              placeholder="https://..."
                                              className="flex-1 rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                            />
                                            <button
                                              type="button"
                                              onClick={handleRemoveNormalizedLink(asset.id, entry.id)}
                                              disabled={!formState.normalized.enabled}
                                              className="rounded-full border border-rose-400/40 px-3 py-2 text-[10px] uppercase tracking-[0.25em] text-rose-300 transition hover:border-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                              Remove
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3">
                                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Sport Fields</p>
                                    <div className="mt-2 grid gap-2 text-xs">
                                      <input
                                        value={formState.normalized.sport.playerName}
                                        onChange={handleNormalizedSportChange(asset.id, "playerName")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Player name"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.sport.teamName}
                                        onChange={handleNormalizedSportChange(asset.id, "teamName")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Team"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.sport.league}
                                        onChange={handleNormalizedSportChange(asset.id, "league")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="League"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.sport.sport}
                                        onChange={handleNormalizedSportChange(asset.id, "sport")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Sport"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.sport.cardType}
                                        onChange={handleNormalizedSportChange(asset.id, "cardType")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Card type"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.sport.subcategory}
                                        onChange={handleNormalizedSportChange(asset.id, "subcategory")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Subcategory"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-[0.25em] text-slate-400">
                                        <select
                                          value={formState.normalized.sport.autograph}
                                          onChange={handleNormalizedSportChange(asset.id, "autograph")}
                                          disabled={!formState.normalized.enabled}
                                          className="rounded-2xl border border-white/10 bg-night-800 px-2 py-2 text-xs text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <option value="unknown">Autograph?</option>
                                          <option value="yes">Yes</option>
                                          <option value="no">No</option>
                                        </select>
                                        <select
                                          value={formState.normalized.sport.foil}
                                          onChange={handleNormalizedSportChange(asset.id, "foil")}
                                          disabled={!formState.normalized.enabled}
                                          className="rounded-2xl border border-white/10 bg-night-800 px-2 py-2 text-xs text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <option value="unknown">Foil?</option>
                                          <option value="yes">Yes</option>
                                          <option value="no">No</option>
                                        </select>
                                        <select
                                          value={formState.normalized.sport.graded}
                                          onChange={handleNormalizedSportChange(asset.id, "graded")}
                                          disabled={!formState.normalized.enabled}
                                          className="rounded-2xl border border-white/10 bg-night-800 px-2 py-2 text-xs text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <option value="unknown">Graded?</option>
                                          <option value="yes">Yes</option>
                                          <option value="no">No</option>
                                        </select>
                                      </div>
                                      <input
                                        value={formState.normalized.sport.gradeCompany}
                                        onChange={handleNormalizedSportChange(asset.id, "gradeCompany")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Grade company"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.sport.grade}
                                        onChange={handleNormalizedSportChange(asset.id, "grade")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Grade value"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                    </div>
                                  </div>

                                  <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3">
                                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">TCG Fields</p>
                                    <div className="mt-2 grid gap-2 text-xs">
                                      <input
                                        value={formState.normalized.tcg.cardName}
                                        onChange={handleNormalizedTcgChange(asset.id, "cardName")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Card name"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.tcg.game}
                                        onChange={handleNormalizedTcgChange(asset.id, "game")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Game"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.tcg.series}
                                        onChange={handleNormalizedTcgChange(asset.id, "series")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Series"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.tcg.color}
                                        onChange={handleNormalizedTcgChange(asset.id, "color")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Color"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.tcg.type}
                                        onChange={handleNormalizedTcgChange(asset.id, "type")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Type"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.tcg.language}
                                        onChange={handleNormalizedTcgChange(asset.id, "language")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Language"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <select
                                        value={formState.normalized.tcg.foil}
                                        onChange={handleNormalizedTcgChange(asset.id, "foil")}
                                        disabled={!formState.normalized.enabled}
                                        className="rounded-2xl border border-white/10 bg-night-800 px-2 py-2 text-xs text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        <option value="unknown">Foil?</option>
                                        <option value="yes">Yes</option>
                                        <option value="no">No</option>
                                      </select>
                                      <input
                                        value={formState.normalized.tcg.rarity}
                                        onChange={handleNormalizedTcgChange(asset.id, "rarity")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Rarity"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.tcg.outOf}
                                        onChange={handleNormalizedTcgChange(asset.id, "outOf")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Out of"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.tcg.subcategory}
                                        onChange={handleNormalizedTcgChange(asset.id, "subcategory")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Subcategory"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                    </div>
                                  </div>

                                  <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3">
                                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Comics Fields</p>
                                    <div className="mt-2 grid gap-2 text-xs">
                                      <input
                                        value={formState.normalized.comics.title}
                                        onChange={handleNormalizedComicsChange(asset.id, "title")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Title"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <input
                                        value={formState.normalized.comics.issueNumber}
                                        onChange={handleNormalizedComicsChange(asset.id, "issueNumber")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Issue number"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <div className="grid grid-cols-2 gap-2">
                                        <input
                                          value={formState.normalized.comics.date}
                                          onChange={handleNormalizedComicsChange(asset.id, "date")}
                                          disabled={!formState.normalized.enabled}
                                          placeholder="Release date"
                                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                        />
                                        <input
                                          value={formState.normalized.comics.originDate}
                                          onChange={handleNormalizedComicsChange(asset.id, "originDate")}
                                          disabled={!formState.normalized.enabled}
                                          placeholder="Origin date"
                                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                        />
                                      </div>
                                      <input
                                        value={formState.normalized.comics.storyArc}
                                        onChange={handleNormalizedComicsChange(asset.id, "storyArc")}
                                        disabled={!formState.normalized.enabled}
                                        placeholder="Story arc"
                                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                      <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-[0.25em] text-slate-400">
                                        <select
                                          value={formState.normalized.comics.graded}
                                          onChange={handleNormalizedComicsChange(asset.id, "graded")}
                                          disabled={!formState.normalized.enabled}
                                          className="rounded-2xl border border-white/10 bg-night-800 px-2 py-2 text-xs text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <option value="unknown">Graded?</option>
                                          <option value="yes">Yes</option>
                                          <option value="no">No</option>
                                        </select>
                                        <input
                                          value={formState.normalized.comics.gradeCompany}
                                          onChange={handleNormalizedComicsChange(asset.id, "gradeCompany")}
                                          disabled={!formState.normalized.enabled}
                                          placeholder="Grade company"
                                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                        />
                                        <input
                                          value={formState.normalized.comics.grade}
                                          onChange={handleNormalizedComicsChange(asset.id, "grade")}
                                          disabled={!formState.normalized.enabled}
                                          placeholder="Grade"
                                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </details>

                              <details className="rounded-2xl border border-white/10 bg-night-900/60 p-3">
                                <summary className="cursor-pointer text-[11px] uppercase tracking-[0.25em] text-indigo-300">AI Grade Overrides</summary>
                                <div className="mt-3 grid gap-2 text-xs text-slate-300">
                                  <div className="grid grid-cols-2 gap-2">
                                    <input
                                      value={formState.aiGradeFinal}
                                      onChange={handleFormFieldChange(asset.id, "aiGradeFinal")}
                                      placeholder="AI final"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400/60"
                                    />
                                    <input
                                      value={formState.aiGradePsaEquivalent}
                                      onChange={handleFormFieldChange(asset.id, "aiGradePsaEquivalent")}
                                      placeholder="PSA equivalent"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400/60"
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <input
                                      value={formState.aiGradeRangeLow}
                                      onChange={handleFormFieldChange(asset.id, "aiGradeRangeLow")}
                                      placeholder="Range low"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400/60"
                                    />
                                    <input
                                      value={formState.aiGradeRangeHigh}
                                      onChange={handleFormFieldChange(asset.id, "aiGradeRangeHigh")}
                                      placeholder="Range high"
                                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400/60"
                                    />
                                  </div>
                                  <input
                                    value={formState.aiGradeLabel}
                                    onChange={handleFormFieldChange(asset.id, "aiGradeLabel")}
                                    placeholder="Grade label"
                                    className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400/60"
                                  />
                                </div>
                              </details>

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

                              <div className="flex justify-end gap-2 pt-2">
                                <button
                                  type="button"
                                  onClick={() => handleBulkRegenerate(asset.id)}
                                  disabled={isSaving || isRegenerating}
                                  className="rounded-full border border-sky-400/40 bg-sky-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-sky-200 transition hover:border-sky-300 hover:text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isRegenerating ? "Regenerating…" : "Regenerate eBay comps"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleBulkSave(asset.id)}
                                  disabled={isSaving || isRegenerating}
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
