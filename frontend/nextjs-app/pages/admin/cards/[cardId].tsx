import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  buildEbaySoldUrlFromText,
  type CardAttributes,
  type ClassificationCategory,
  type NormalizedClassification,
  type NormalizedClassificationSport,
  type NormalizedClassificationTcg,
  type NormalizedClassificationComics,
} from "@tenkings/shared";
import AppShell from "../../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import { buildAdminHeaders } from "../../../lib/adminHeaders";

type CardNote = {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
};

type CardDetail = {
  id: string;
  batchId: string;
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
  assignedDefinitionId: string | null;
  assignedAt: string | null;
  notes: CardNote[];
  createdAt: string;
  updatedAt: string;
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
  aiGrade: {
    final: number | null;
    label: string | null;
    psaEquivalent: number | null;
    rangeLow: number | null;
    rangeHigh: number | null;
    generatedAt: string | null;
    visualizationUrl: string | null;
    exactVisualizationUrl: string | null;
  } | null;
  classificationSources: Record<string, unknown> | null;
  label: {
    id: string;
    pairId: string;
    status: string;
    card: { id: string; code: string; serial: string | null; payloadUrl: string | null };
    pack: { id: string; code: string; serial: string | null; payloadUrl: string | null };
  } | null;
};

type CardFormState = {
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
  const linksEntries: NormalizedLinkEntry[] = [];
  const rawLinks = normalized?.links ?? {};
  for (const [key, value] of Object.entries(rawLinks)) {
    linksEntries.push({ id: makeLinkEntryId(), key, value });
  }

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
    links: linksEntries,
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

const STAT_LABELS: Record<string, string> = {
  intGamesPlayed: "Games",
  intPoints: "Points",
  intGoals: "Goals",
  intAssists: "Assists",
  intWins: "Wins",
  intLosses: "Losses",
  intHomeRuns: "Home runs",
  intRBIs: "RBIs",
  intHits: "Hits",
  intBattingAverage: "AVG",
};

function pickStatEntries(stats: Record<string, unknown> | null | undefined) {
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
}

export default function AdminCardDetail() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const [card, setCard] = useState<CardDetail | null>(null);
  const [form, setForm] = useState<CardFormState | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regeneratingComps, setRegeneratingComps] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attributeForm, setAttributeForm] = useState<AttributeFormState | null>(null);
  const [normalizedForm, setNormalizedForm] = useState<NormalizedFormState | null>(null);

  const comparables = useMemo(() => {
    if (!card) {
      return [] as Array<{ label: string; href: string }>;
    }
    return [
      card.ebaySoldUrl ? { label: "Exact match", href: card.ebaySoldUrl } : null,
      card.ebaySoldUrlVariant ? { label: "Variant search", href: card.ebaySoldUrlVariant } : null,
      card.ebaySoldUrlHighGrade ? { label: "High grade comps", href: card.ebaySoldUrlHighGrade } : null,
      card.ebaySoldUrlPlayerComp ? { label: "Player comps", href: card.ebaySoldUrlPlayerComp } : null,
      card.ebaySoldUrlAiGrade
        ? {
            label: card.aiGrade?.psaEquivalent
              ? `AI grade comps (PSA ${card.aiGrade.psaEquivalent})`
              : "AI grade comps",
            href: card.ebaySoldUrlAiGrade,
          }
        : null,
    ].filter((link): link is { label: string; href: string } => Boolean(link));
  }, [card]);

  const humanReviewSummary = useMemo(() => {
    if (!card?.humanReviewedAt) {
      return null;
    }
    const reviewedAt = new Date(card.humanReviewedAt).toLocaleString();
    return card.humanReviewerName ? `${reviewedAt} · ${card.humanReviewerName}` : reviewedAt;
  }, [card]);

  const attributeEntries = useMemo(() => {
    const attributes = card?.classification;
    if (!attributes) {
      return [] as Array<{ label: string; value: string }>;
    }

    const entries: Array<{ label: string; value: string }> = [];

    if (attributes.playerName) {
      entries.push({ label: "Player", value: attributes.playerName });
    }
    if (attributes.teamName) {
      entries.push({ label: "Team", value: attributes.teamName });
    }
    if (attributes.year) {
      entries.push({ label: "Year", value: attributes.year });
    }
    if (attributes.brand) {
      entries.push({ label: "Brand", value: attributes.brand });
    }
    if (attributes.setName) {
      entries.push({ label: "Set", value: attributes.setName });
    }
    if (attributes.variantKeywords.length > 0) {
      entries.push({ label: "Variants", value: attributes.variantKeywords.join(", ") });
    }
    if (attributes.serialNumber) {
      entries.push({ label: "Serial", value: attributes.serialNumber });
    }
    if (attributes.gradeValue) {
      const gradeLabel = attributes.gradeCompany
        ? `${attributes.gradeCompany} ${attributes.gradeValue}`
        : attributes.gradeValue;
      entries.push({ label: "Grade", value: gradeLabel });
    }
    entries.push({ label: "Rookie", value: attributes.rookie ? "Yes" : "No" });
    entries.push({ label: "Autograph", value: attributes.autograph ? "Yes" : "No" });
    entries.push({ label: "Memorabilia", value: attributes.memorabilia ? "Yes" : "No" });

    return entries.filter((entry) => entry.value.trim().length > 0);
  }, [card?.classification]);

  const sportsDbSummary = useMemo(() => {
    const summary = card?.sportsDb;
    if (!summary) {
      return null;
    }
    const rawSnapshot = summary.snapshot as Record<string, unknown> | null | undefined;
    const seasons = Array.isArray((rawSnapshot as any)?.seasons)
      ? ((rawSnapshot as any).seasons as Array<Record<string, unknown>>)
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
      playerName: summary.playerName,
      teamName: summary.teamName,
      teamLogoUrl: summary.teamLogoUrl,
      matchConfidence: summary.matchConfidence,
      sport: summary.sport,
      league: summary.league,
      seasonLabel,
      statEntries: pickStatEntries(stats ?? null),
    };
  }, [card?.sportsDb]);

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
    const cardId = router.query.cardId;
    if (typeof cardId !== "string" || !session?.token || !isAdmin) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setFetching(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/cards/${cardId}`, {
          headers: buildAdminHeaders(session.token),
          signal: controller.signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load card");
        }
        const data = (await res.json()) as CardDetail;
        if (!cancelled) {
          setCard(data);
          setForm({
            customTitle: data.customTitle ?? "",
            customDetails: data.customDetails ?? "",
            ocrText: data.ocrText ?? "",
            valuation: data.valuationMinor !== null ? (data.valuationMinor / 100).toFixed(2) : "",
            valuationCurrency: data.valuationCurrency ?? "USD",
            valuationSource: data.valuationSource ?? "",
            marketplaceUrl: data.marketplaceUrl ?? "",
            ebaySoldUrl: data.ebaySoldUrl ?? "",
            ebaySoldUrlVariant: data.ebaySoldUrlVariant ?? "",
            ebaySoldUrlHighGrade: data.ebaySoldUrlHighGrade ?? "",
            ebaySoldUrlPlayerComp: data.ebaySoldUrlPlayerComp ?? "",
            ebaySoldUrlAiGrade: data.ebaySoldUrlAiGrade ?? "",
            humanReviewed: data.humanReviewedAt !== null,
            aiGradeFinal: data.aiGrade?.final != null ? String(data.aiGrade.final) : "",
            aiGradeLabel: data.aiGrade?.label ?? "",
            aiGradePsaEquivalent:
              data.aiGrade?.psaEquivalent != null ? String(data.aiGrade.psaEquivalent) : "",
            aiGradeRangeLow: data.aiGrade?.rangeLow != null ? String(data.aiGrade.rangeLow) : "",
            aiGradeRangeHigh: data.aiGrade?.rangeHigh != null ? String(data.aiGrade.rangeHigh) : "",
          });
          setAttributeForm(buildAttributeFormState(data.classification));
          setNormalizedForm(buildNormalizedFormState(data.classificationNormalized));
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Failed to load card";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setFetching(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [router.isReady, router.query.cardId, session?.token, isAdmin]);

  const handleChange = (field: keyof CardFormState) => (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!form) return;
    setForm({ ...form, [field]: event.currentTarget.value });
  };

  const handleCheckboxChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!form) {
      return;
    }
    setForm({ ...form, humanReviewed: event.currentTarget.checked });
  };

  const handleAttributeInputChange = (
    field: keyof AttributeFormState
  ) => (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!attributeForm) {
      return;
    }
    setAttributeForm({ ...attributeForm, [field]: event.currentTarget.value });
  };

  const handleAttributeCheckboxChange = (field: "rookie" | "autograph" | "memorabilia") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!attributeForm) {
        return;
      }
      setAttributeForm({ ...attributeForm, [field]: event.currentTarget.checked });
    };

  const handleNormalizedEnabledToggle = (event: ChangeEvent<HTMLInputElement>) => {
    if (!normalizedForm) {
      return;
    }
    setNormalizedForm({ ...normalizedForm, enabled: event.currentTarget.checked });
  };

  const handleNormalizedFieldChange = (
    field: keyof Omit<NormalizedFormState, "enabled" | "links" | "sport" | "tcg" | "comics">
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!normalizedForm) {
      return;
    }
    const raw = event.currentTarget.value;
    if (field === "categoryType") {
      setNormalizedForm({ ...normalizedForm, categoryType: raw as ClassificationCategory });
    } else {
      setNormalizedForm({ ...normalizedForm, [field]: raw });
    }
  };

  const handleNormalizedSportChange = (
    field: keyof NormalizedSportFormState
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!normalizedForm) {
      return;
    }
    const value = field === "autograph" || field === "foil" || field === "graded"
      ? (event.currentTarget.value as TriState)
      : event.currentTarget.value;
    setNormalizedForm({
      ...normalizedForm,
      sport: { ...normalizedForm.sport, [field]: value },
    });
  };

  const handleNormalizedTcgChange = (
    field: keyof NormalizedTcgFormState
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!normalizedForm) {
      return;
    }
    const value = field === "foil" ? (event.currentTarget.value as TriState) : event.currentTarget.value;
    setNormalizedForm({
      ...normalizedForm,
      tcg: { ...normalizedForm.tcg, [field]: value },
    });
  };

  const handleNormalizedComicsChange = (
    field: keyof NormalizedComicsFormState
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!normalizedForm) {
      return;
    }
    const value = field === "graded" ? (event.currentTarget.value as TriState) : event.currentTarget.value;
    setNormalizedForm({
      ...normalizedForm,
      comics: { ...normalizedForm.comics, [field]: value },
    });
  };

  const handleAddNormalizedLink = () => {
    setNormalizedForm((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        links: [...current.links, { id: makeLinkEntryId(), key: "", value: "" }],
      };
    });
  };

  const handleRemoveNormalizedLink = (id: string) => {
    setNormalizedForm((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        links: current.links.filter((entry) => entry.id !== id),
      };
    });
  };

  const handleNormalizedLinkFieldChange = (
    id: string,
    field: "key" | "value",
    value: string
  ) => {
    setNormalizedForm((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        links: current.links.map((entry) =>
          entry.id === id ? { ...entry, [field]: value } : entry
        ),
      };
    });
  };

  const handleGenerateEbayUrl = () => {
    if (!form) return;
    const generated = buildEbaySoldUrlFromText(form.ocrText);
    setForm({ ...form, ebaySoldUrl: generated ?? "" });
    setMessage(generated ? "Generated eBay sold URL" : "Unable to generate eBay URL from OCR text");
  };

  const handleRegenerateComps = async () => {
    if (!card || !form || !session?.token) {
      return;
    }

    setRegeneratingComps(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/cards/${card.id}/regenerate-comps`, {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to regenerate comps");
      }

      const updatedRes = await fetch(`/api/admin/cards/${card.id}`, {
        headers: buildAdminHeaders(session.token),
      });
      if (!updatedRes.ok) {
        const payload = await updatedRes.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to refresh card");
      }

      const updated = (await updatedRes.json()) as CardDetail;
      setCard(updated);
      setForm({
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
      });
      setAttributeForm(buildAttributeFormState(updated.classification));
      setNormalizedForm(buildNormalizedFormState(updated.classificationNormalized));
      setMessage("eBay comps regenerated");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to regenerate comps";
      setError(message);
    } finally {
      setRegeneratingComps(false);
    }
  };

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

  const registerDownload = useCallback((pdfBase64: string, filename: string) => {
    const binary = typeof window !== "undefined" ? atob(pdfBase64) : "";
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    if (typeof window !== "undefined") {
      const tempLink = document.createElement("a");
      tempLink.href = url;
      tempLink.download = filename;
      tempLink.rel = "noopener";
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
    }
    URL.revokeObjectURL(url);
  }, []);

  const handlePrintLabels = useCallback(async () => {
    if (!card?.label?.id || !session?.token || !isAdmin) {
      return;
    }

    setPrinting(true);
    setPrintStatus(null);
    try {
      const res = await fetch("/api/admin/packing/labels/print", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ labelIds: [card.label.id], style: "generic" }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to generate label sheet");
      }
      const payload = await res.json();
      registerDownload(payload.pdf, payload.filename);
      setPrintStatus("Label ready. Downloading now.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to print label";
      setPrintStatus(message);
    } finally {
      setPrinting(false);
    }
  }, [card?.label?.id, isAdmin, registerDownload, session?.token]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || !card || !session?.token) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    let valuationMinor: number | null = null;
    if (form.valuation.trim().length > 0) {
      const parsed = Number.parseFloat(form.valuation);
      if (!Number.isFinite(parsed)) {
        setSaving(false);
        setError("Valuation must be a number (e.g. 125.00)");
        return;
      }
      valuationMinor = Math.round(parsed * 100);
    }

    const parseOptionalNumber = (value: string, label: string, opts?: { integer?: boolean }) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        setSaving(false);
        setError(`${label} must be a number`);
        return undefined;
      }
      if (opts?.integer) {
        return Math.round(parsed);
      }
      return parsed;
    };

    const aiGradeFinalValue = parseOptionalNumber(form.aiGradeFinal, "AI grade final");
    if (aiGradeFinalValue === undefined) {
      return;
    }
    const aiGradePsaValue = parseOptionalNumber(form.aiGradePsaEquivalent, "PSA equivalent", { integer: true });
    if (aiGradePsaValue === undefined) {
      return;
    }
    const aiGradeRangeLowValue = parseOptionalNumber(form.aiGradeRangeLow, "AI grade range (low)", {
      integer: true,
    });
    if (aiGradeRangeLowValue === undefined) {
      return;
    }
    const aiGradeRangeHighValue = parseOptionalNumber(form.aiGradeRangeHigh, "AI grade range (high)", {
      integer: true,
    });
    if (aiGradeRangeHighValue === undefined) {
      return;
    }

    let classificationUpdates: Record<string, unknown> | null = null;

    if (attributeForm) {
      classificationUpdates = classificationUpdates ?? {};
      (classificationUpdates as Record<string, unknown>).attributes = {
        playerName: emptyToNull(attributeForm.playerName),
        teamName: emptyToNull(attributeForm.teamName),
        year: emptyToNull(attributeForm.year),
        brand: emptyToNull(attributeForm.brand),
        setName: emptyToNull(attributeForm.setName),
        variantKeywords: parseVariantKeywords(attributeForm.variantKeywords),
        serialNumber: emptyToNull(attributeForm.serialNumber),
        rookie: attributeForm.rookie,
        autograph: attributeForm.autograph,
        memorabilia: attributeForm.memorabilia,
        gradeCompany: emptyToNull(attributeForm.gradeCompany),
        gradeValue: emptyToNull(attributeForm.gradeValue),
      };
    }

    if (normalizedForm) {
      classificationUpdates = classificationUpdates ?? {};
      if (!normalizedForm.enabled) {
        (classificationUpdates as Record<string, unknown>).normalized = null;
      } else {
        const normalizedLinks: Record<string, string | null> = {};
        const seenKeys = new Set<string>();
        normalizedForm.links.forEach((entry) => {
          const key = entry.key.trim();
          if (!key) {
            return;
          }
          seenKeys.add(key);
          const trimmedValue = entry.value.trim();
          normalizedLinks[key] = trimmedValue.length > 0 ? trimmedValue : null;
        });

        const existingLinkKeys = Object.keys(card?.classificationNormalized?.links ?? {});
        existingLinkKeys.forEach((key) => {
          if (!seenKeys.has(key)) {
            normalizedLinks[key] = null;
          }
        });

        const sportPayload = {
          playerName: emptyToNull(normalizedForm.sport.playerName),
          teamName: emptyToNull(normalizedForm.sport.teamName),
          league: emptyToNull(normalizedForm.sport.league),
          sport: emptyToNull(normalizedForm.sport.sport),
          cardType: emptyToNull(normalizedForm.sport.cardType),
          subcategory: emptyToNull(normalizedForm.sport.subcategory),
          autograph: triStateToBoolean(normalizedForm.sport.autograph),
          foil: triStateToBoolean(normalizedForm.sport.foil),
          graded: triStateToBoolean(normalizedForm.sport.graded),
          gradeCompany: emptyToNull(normalizedForm.sport.gradeCompany),
          grade: emptyToNull(normalizedForm.sport.grade),
        } as Partial<NormalizedClassificationSport>;

        const tcgPayload = {
          cardName: emptyToNull(normalizedForm.tcg.cardName),
          game: emptyToNull(normalizedForm.tcg.game),
          series: emptyToNull(normalizedForm.tcg.series),
          color: emptyToNull(normalizedForm.tcg.color),
          type: emptyToNull(normalizedForm.tcg.type),
          language: emptyToNull(normalizedForm.tcg.language),
          foil: triStateToBoolean(normalizedForm.tcg.foil),
          rarity: emptyToNull(normalizedForm.tcg.rarity),
          outOf: emptyToNull(normalizedForm.tcg.outOf),
          subcategory: emptyToNull(normalizedForm.tcg.subcategory),
        } as Partial<NormalizedClassificationTcg>;

        const comicsPayload = {
          title: emptyToNull(normalizedForm.comics.title),
          issueNumber: emptyToNull(normalizedForm.comics.issueNumber),
          date: emptyToNull(normalizedForm.comics.date),
          originDate: emptyToNull(normalizedForm.comics.originDate),
          storyArc: emptyToNull(normalizedForm.comics.storyArc),
          graded: triStateToBoolean(normalizedForm.comics.graded),
          gradeCompany: emptyToNull(normalizedForm.comics.gradeCompany),
          grade: emptyToNull(normalizedForm.comics.grade),
        } as Partial<NormalizedClassificationComics>;

        (classificationUpdates as Record<string, unknown>).normalized = {
          categoryType: normalizedForm.categoryType,
          displayName: emptyToNull(normalizedForm.displayName),
          cardNumber: emptyToNull(normalizedForm.cardNumber),
          setName: emptyToNull(normalizedForm.setName),
          setCode: emptyToNull(normalizedForm.setCode),
          year: emptyToNull(normalizedForm.year),
          company: emptyToNull(normalizedForm.company),
          rarity: emptyToNull(normalizedForm.rarity),
          links: normalizedLinks,
          sport: sportPayload,
          tcg: tcgPayload,
          comics: comicsPayload,
        };
      }
    }

    const payload: Record<string, unknown> = {
      customTitle: form.customTitle.trim() || null,
      customDetails: form.customDetails.trim() || null,
      ocrText: form.ocrText.trim() || null,
      valuationMinor,
      valuationCurrency: form.valuationCurrency.trim() || null,
      valuationSource: form.valuationSource.trim() || null,
      marketplaceUrl: form.marketplaceUrl.trim() || null,
      ebaySoldUrl: form.ebaySoldUrl.trim() || null,
      ebaySoldUrlVariant: form.ebaySoldUrlVariant.trim() || null,
      ebaySoldUrlHighGrade: form.ebaySoldUrlHighGrade.trim() || null,
      ebaySoldUrlPlayerComp: form.ebaySoldUrlPlayerComp.trim() || null,
      ebaySoldUrlAiGrade: form.ebaySoldUrlAiGrade.trim() || null,
      humanReviewed: form.humanReviewed,
      aiGradeFinal: aiGradeFinalValue,
      aiGradeLabel: emptyToNull(form.aiGradeLabel) ?? null,
      aiGradePsaEquivalent: aiGradePsaValue,
      aiGradeRangeLow: aiGradeRangeLowValue,
      aiGradeRangeHigh: aiGradeRangeHighValue,
    };

    if (classificationUpdates) {
      payload.classificationUpdates = classificationUpdates;
    }

    try {
      const res = await fetch(`/api/admin/cards/${card.id}`, {
        method: "PATCH",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to update card");
      }
      const updated = (await res.json()) as CardDetail;
      setCard(updated);
      setForm({
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
      });
      setAttributeForm(buildAttributeFormState(updated.classification));
      setNormalizedForm(buildNormalizedFormState(updated.classificationNormalized));
      setMessage("Card details saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update card";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const gate = renderGate();
  if (gate) {
    return (
      <AppShell>
        <Head>
          <title>Ten Kings · Card Detail</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Card Detail</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex flex-1 flex-col gap-8 px-6 py-12">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-violet-300">Processing Console</p>
            <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Card Detail</h1>
          </div>
          <div className="flex items-center gap-4 text-xs uppercase tracking-[0.28em] text-slate-400">
            <Link className="transition hover:text-white" href="/admin/uploads">
              ← Back to uploads
            </Link>
            <Link className="transition hover:text-white" href={`/admin/batches/${card?.batchId ?? ""}`}>
              ← Back to batch
            </Link>
          </div>
        </div>

        {fetching && <p className="text-sm text-slate-400">Loading card…</p>}
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {message && <p className="text-sm text-emerald-300">{message}</p>}

        {card && form && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-6">
              <h2 className="font-heading text-xl uppercase tracking-[0.18em] text-white">Edit Details</h2>

              <label className="flex flex-col gap-2 text-xs text-slate-300">
                <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Display Title</span>
                <input
                  value={form.customTitle}
                  onChange={handleChange("customTitle")}
                  placeholder="e.g. 2024 Select Neon Orange Braelon Allen PSA 8"
                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                />
              </label>

              <label className="flex flex-col gap-2 text-xs text-slate-300">
                <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Manual Notes</span>
                <textarea
                  value={form.customDetails}
                  onChange={handleChange("customDetails")}
                  rows={4}
                  placeholder="Add important details, variants, or corrections"
                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-xs text-slate-300">
                  <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Appraised Value</span>
                  <input
                    value={form.valuation}
                    onChange={handleChange("valuation")}
                    placeholder="e.g. 125.00"
                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                  />
                </label>
                <label className="flex flex-col gap-2 text-xs text-slate-300">
                  <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Currency</span>
                  <input
                    value={form.valuationCurrency}
                    onChange={handleChange("valuationCurrency")}
                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                  />
                </label>
              </div>

              <details className="rounded-3xl border border-white/10 bg-night-900/60 p-4">
                <summary className="cursor-pointer text-[11px] uppercase tracking-[0.3em] text-slate-300">
                  Advanced / Legacy Fields
                </summary>
                <div className="mt-4 flex flex-col gap-4">
                  <label className="flex flex-col gap-2 text-xs text-slate-300">
                    <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">OCR Text</span>
                    <textarea
                      value={form.ocrText}
                      onChange={handleChange("ocrText")}
                      rows={4}
                      className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-xs text-slate-300">
                    <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Valuation Source</span>
                    <input
                      value={form.valuationSource}
                      onChange={handleChange("valuationSource")}
                      placeholder="e.g. Manual review"
                      className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-xs text-slate-300">
                    <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Marketplace URL</span>
                    <input
                      value={form.marketplaceUrl}
                      onChange={handleChange("marketplaceUrl")}
                      placeholder="Link to comp or marketplace listing"
                      className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                    />
                  </label>

                  <div className="flex flex-col gap-2 text-xs text-slate-300">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">eBay Sold URL</span>
                      <button
                        type="button"
                        onClick={handleGenerateEbayUrl}
                        className="rounded-full border border-sky-400/40 px-4 py-1 text-[11px] uppercase tracking-[0.28em] text-sky-300 transition hover:border-sky-400 hover:text-sky-200"
                      >
                        Generate from OCR
                      </button>
                    </div>
                    <input
                      value={form.ebaySoldUrl}
                      onChange={handleChange("ebaySoldUrl")}
                      placeholder="https://www.ebay.com/sch/..."
                      className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="flex flex-col gap-2 text-xs text-slate-300">
                      <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Variant URL</span>
                      <input
                        value={form.ebaySoldUrlVariant}
                        onChange={handleChange("ebaySoldUrlVariant")}
                        placeholder="Variant comps search"
                        className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs text-slate-300">
                      <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">High Grade URL</span>
                      <input
                        value={form.ebaySoldUrlHighGrade}
                        onChange={handleChange("ebaySoldUrlHighGrade")}
                        placeholder="High grade comps"
                        className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="flex flex-col gap-2 text-xs text-slate-300">
                      <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Player Comp URL</span>
                      <input
                        value={form.ebaySoldUrlPlayerComp}
                        onChange={handleChange("ebaySoldUrlPlayerComp")}
                        placeholder="Player comp search"
                        className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs text-slate-300">
                      <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">AI Grade URL</span>
                      <input
                        value={form.ebaySoldUrlAiGrade}
                        onChange={handleChange("ebaySoldUrlAiGrade")}
                        placeholder="AI grade comps"
                        className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                  </div>

              {attributeForm && (
                <div className="rounded-3xl border border-white/10 bg-night-900/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300">Card Attributes</p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    These values feed our previews, My Collection details, and listing templates. Update them when OCR is inaccurate.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Player Name</span>
                      <input
                        value={attributeForm.playerName}
                        onChange={handleAttributeInputChange("playerName")}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Team Name</span>
                      <input
                        value={attributeForm.teamName}
                        onChange={handleAttributeInputChange("teamName")}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Year</span>
                      <input
                        value={attributeForm.year}
                        onChange={handleAttributeInputChange("year")}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Brand</span>
                      <input
                        value={attributeForm.brand}
                        onChange={handleAttributeInputChange("brand")}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300 md:col-span-2">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Set Name</span>
                      <input
                        value={attributeForm.setName}
                        onChange={handleAttributeInputChange("setName")}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300 md:col-span-2">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Variant Keywords</span>
                      <input
                        value={attributeForm.variantKeywords}
                        onChange={handleAttributeInputChange("variantKeywords")}
                        placeholder="Comma separated · e.g. Holo, Silver Prizm"
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Serial Number</span>
                      <input
                        value={attributeForm.serialNumber}
                        onChange={handleAttributeInputChange("serialNumber")}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Grade Company</span>
                      <input
                        value={attributeForm.gradeCompany}
                        onChange={handleAttributeInputChange("gradeCompany")}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Grade Value</span>
                      <input
                        value={attributeForm.gradeValue}
                        onChange={handleAttributeInputChange("gradeValue")}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-[11px] uppercase tracking-[0.28em] text-slate-400">
                    <label className="inline-flex items-center gap-2 text-[10px]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-400"
                        checked={attributeForm.rookie}
                        onChange={handleAttributeCheckboxChange("rookie")}
                      />
                      Rookie
                    </label>
                    <label className="inline-flex items-center gap-2 text-[10px]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-400"
                        checked={attributeForm.autograph}
                        onChange={handleAttributeCheckboxChange("autograph")}
                      />
                      Autograph
                    </label>
                    <label className="inline-flex items-center gap-2 text-[10px]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-400"
                        checked={attributeForm.memorabilia}
                        onChange={handleAttributeCheckboxChange("memorabilia")}
                      />
                      Memorabilia
                    </label>
                  </div>
                </div>
              )}

              {normalizedForm && (
                <div className="rounded-3xl border border-white/10 bg-night-900/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.3em] text-sky-300">Normalized Classification</p>
                      <p className="text-[11px] text-slate-400">
                        Unified metadata used across sports, TCG, and comics. Disable when you need to reset the record.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-slate-400">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-sky-400"
                        checked={normalizedForm.enabled}
                        onChange={handleNormalizedEnabledToggle}
                      />
                      Enabled
                    </label>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Category</span>
                      <select
                        value={normalizedForm.categoryType}
                        onChange={handleNormalizedFieldChange("categoryType")}
                        disabled={!normalizedForm.enabled}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="unknown">Unknown</option>
                        <option value="sport">Sport</option>
                        <option value="tcg">TCG</option>
                        <option value="comics">Comics</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Display Name</span>
                      <input
                        value={normalizedForm.displayName}
                        onChange={handleNormalizedFieldChange("displayName")}
                        disabled={!normalizedForm.enabled}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Card Number</span>
                      <input
                        value={normalizedForm.cardNumber}
                        onChange={handleNormalizedFieldChange("cardNumber")}
                        disabled={!normalizedForm.enabled}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Set Name</span>
                      <input
                        value={normalizedForm.setName}
                        onChange={handleNormalizedFieldChange("setName")}
                        disabled={!normalizedForm.enabled}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Set Code</span>
                      <input
                        value={normalizedForm.setCode}
                        onChange={handleNormalizedFieldChange("setCode")}
                        disabled={!normalizedForm.enabled}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Year</span>
                      <input
                        value={normalizedForm.year}
                        onChange={handleNormalizedFieldChange("year")}
                        disabled={!normalizedForm.enabled}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Company / Publisher</span>
                      <input
                        value={normalizedForm.company}
                        onChange={handleNormalizedFieldChange("company")}
                        disabled={!normalizedForm.enabled}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Rarity / Tier</span>
                      <input
                        value={normalizedForm.rarity}
                        onChange={handleNormalizedFieldChange("rarity")}
                        disabled={!normalizedForm.enabled}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                  </div>

                  <div className="mt-5 rounded-2xl border border-white/10 bg-night-900/50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Reference Links</p>
                      <button
                        type="button"
                        onClick={handleAddNormalizedLink}
                        disabled={!normalizedForm.enabled}
                        className="rounded-full border border-sky-400/40 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-sky-300 transition hover:border-sky-300 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Add Link
                      </button>
                    </div>
                    <div className="mt-3 flex flex-col gap-2">
                      {normalizedForm.links.length === 0 && (
                        <p className="text-[11px] text-slate-500">No links captured yet.</p>
                      )}
                      {normalizedForm.links.map((entry) => (
                        <div key={entry.id} className="flex flex-col gap-2 md:flex-row">
                          <input
                            value={entry.key}
                            onChange={(event) => handleNormalizedLinkFieldChange(entry.id, "key", event.currentTarget.value)}
                            disabled={!normalizedForm.enabled}
                            placeholder="Provider e.g. ebay.com"
                            className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50 md:w-40"
                          />
                          <div className="flex flex-1 gap-2">
                            <input
                              value={entry.value}
                              onChange={(event) => handleNormalizedLinkFieldChange(entry.id, "value", event.currentTarget.value)}
                              disabled={!normalizedForm.enabled}
                              placeholder="https://..."
                              className="flex-1 rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemoveNormalizedLink(entry.id)}
                              disabled={!normalizedForm.enabled}
                              className="rounded-full border border-rose-400/40 px-3 py-2 text-[10px] uppercase tracking-[0.28em] text-rose-300 transition hover:border-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-night-900/50 p-4">
                      <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Sport Metadata</p>
                      <div className="mt-2 grid gap-2">
                        <input
                          value={normalizedForm.sport.playerName}
                          onChange={handleNormalizedSportChange("playerName")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Player name"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.sport.teamName}
                          onChange={handleNormalizedSportChange("teamName")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Team"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.sport.league}
                          onChange={handleNormalizedSportChange("league")}
                          disabled={!normalizedForm.enabled}
                          placeholder="League"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.sport.sport}
                          onChange={handleNormalizedSportChange("sport")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Sport"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.sport.cardType}
                          onChange={handleNormalizedSportChange("cardType")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Card type"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.sport.subcategory}
                          onChange={handleNormalizedSportChange("subcategory")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Subcategory"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-[0.28em] text-slate-400">
                          <label className="flex flex-col gap-1">
                            <span>Autograph</span>
                            <select
                              value={normalizedForm.sport.autograph}
                              onChange={handleNormalizedSportChange("autograph")}
                              disabled={!normalizedForm.enabled}
                              className="rounded-2xl border border-white/10 bg-night-800 px-2 py-2 text-xs text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="unknown">Unknown</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span>Foil</span>
                            <select
                              value={normalizedForm.sport.foil}
                              onChange={handleNormalizedSportChange("foil")}
                              disabled={!normalizedForm.enabled}
                              className="rounded-2xl border border-white/10 bg-night-800 px-2 py-2 text-xs text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="unknown">Unknown</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span>Graded</span>
                            <select
                              value={normalizedForm.sport.graded}
                              onChange={handleNormalizedSportChange("graded")}
                              disabled={!normalizedForm.enabled}
                              className="rounded-2xl border border-white/10 bg-night-800 px-2 py-2 text-xs text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="unknown">Unknown</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </label>
                        </div>
                        <input
                          value={normalizedForm.sport.gradeCompany}
                          onChange={handleNormalizedSportChange("gradeCompany")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Grade company"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.sport.grade}
                          onChange={handleNormalizedSportChange("grade")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Grade value"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-night-900/50 p-4">
                      <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">TCG Metadata</p>
                      <div className="mt-2 grid gap-2">
                        <input
                          value={normalizedForm.tcg.cardName}
                          onChange={handleNormalizedTcgChange("cardName")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Card name"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.tcg.game}
                          onChange={handleNormalizedTcgChange("game")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Game"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.tcg.series}
                          onChange={handleNormalizedTcgChange("series")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Series"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.tcg.color}
                          onChange={handleNormalizedTcgChange("color")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Color / element"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.tcg.type}
                          onChange={handleNormalizedTcgChange("type")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Type"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.tcg.language}
                          onChange={handleNormalizedTcgChange("language")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Language"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.28em] text-slate-400">
                          Foil
                          <select
                            value={normalizedForm.tcg.foil}
                            onChange={handleNormalizedTcgChange("foil")}
                            disabled={!normalizedForm.enabled}
                            className="rounded-2xl border border-white/10 bg-night-800 px-2 py-2 text-xs text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="unknown">Unknown</option>
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        </label>
                        <input
                          value={normalizedForm.tcg.rarity}
                          onChange={handleNormalizedTcgChange("rarity")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Rarity"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.tcg.outOf}
                          onChange={handleNormalizedTcgChange("outOf")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Out of"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.tcg.subcategory}
                          onChange={handleNormalizedTcgChange("subcategory")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Subcategory"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-night-900/50 p-4 md:col-span-2">
                      <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Comics Metadata</p>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <input
                          value={normalizedForm.comics.title}
                          onChange={handleNormalizedComicsChange("title")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Title"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.comics.issueNumber}
                          onChange={handleNormalizedComicsChange("issueNumber")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Issue number"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.comics.date}
                          onChange={handleNormalizedComicsChange("date")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Release date"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.comics.originDate}
                          onChange={handleNormalizedComicsChange("originDate")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Origin date"
                          className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <input
                          value={normalizedForm.comics.storyArc}
                          onChange={handleNormalizedComicsChange("storyArc")}
                          disabled={!normalizedForm.enabled}
                          placeholder="Story arc"
                          className="md:col-span-2 rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-[0.28em] text-slate-400 md:col-span-2">
                          <label className="flex flex-col gap-1">
                            <span>Graded</span>
                            <select
                              value={normalizedForm.comics.graded}
                              onChange={handleNormalizedComicsChange("graded")}
                              disabled={!normalizedForm.enabled}
                              className="rounded-2xl border border-white/10 bg-night-800 px-2 py-2 text-xs text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="unknown">Unknown</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </label>
                          <input
                            value={normalizedForm.comics.gradeCompany}
                            onChange={handleNormalizedComicsChange("gradeCompany")}
                            disabled={!normalizedForm.enabled}
                            placeholder="Grade company"
                            className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                          <input
                            value={normalizedForm.comics.grade}
                            onChange={handleNormalizedComicsChange("grade")}
                            disabled={!normalizedForm.enabled}
                            placeholder="Grade value"
                            className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {card?.classificationNormalized?.pricing?.length ? (
                    <div className="mt-5 rounded-2xl border border-white/10 bg-night-900/50 p-4">
                      <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Pricing Snapshots</p>
                      <div className="mt-2 flex flex-col gap-2 text-[11px] text-slate-300">
                        {card.classificationNormalized.pricing.map((entry, index) => (
                          <div key={`${entry.itemId ?? index}-${entry.source ?? "pricing"}`} className="rounded-2xl border border-white/5 bg-night-900/60 px-3 py-2">
                            <p className="text-xs font-semibold text-white">
                              {entry.name ?? entry.itemLink ?? entry.itemId ?? "Listing"}
                            </p>
                            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
                              {entry.source ?? "Unknown"}
                              {entry.price != null && entry.currency ?
                                ` · ${entry.price} ${entry.currency}` : ""}
                              {entry.dateOfCreation ? ` · ${entry.dateOfCreation}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="rounded-3xl border border-white/10 bg-night-900/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.3em] text-indigo-300">AI Grade Overrides</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Use when Ximilar grading misses a card or you uploaded alternate images. Leave blank to keep the automated value.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-slate-300">
                    <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">AI Final Score</span>
                    <input
                      value={form.aiGradeFinal}
                      onChange={handleChange("aiGradeFinal")}
                      placeholder="e.g. 8.7"
                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400/60"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-300">
                    <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">PSA Equivalent</span>
                    <input
                      value={form.aiGradePsaEquivalent}
                      onChange={handleChange("aiGradePsaEquivalent")}
                      placeholder="Rounded PSA grade"
                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400/60"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-300">
                    <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Range Low</span>
                    <input
                      value={form.aiGradeRangeLow}
                      onChange={handleChange("aiGradeRangeLow")}
                      placeholder="Lower bound"
                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400/60"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-300">
                    <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Range High</span>
                    <input
                      value={form.aiGradeRangeHigh}
                      onChange={handleChange("aiGradeRangeHigh")}
                      placeholder="Upper bound"
                      className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400/60"
                    />
                  </label>
                </div>
                <label className="mt-3 flex flex-col gap-1 text-xs text-slate-300">
                  <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Grade Label</span>
                  <input
                    value={form.aiGradeLabel}
                    onChange={handleChange("aiGradeLabel")}
                    placeholder="e.g. Mint"
                    className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400/60"
                  />
                </label>
              </div>

              {comparables.length > 0 && (
                <div className="rounded-3xl border border-white/10 bg-night-900/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-sky-300">eBay Sold Comparables</p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Generated from OCR attributes. Use these quick links when you need broader comps.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {comparables.map(({ label, href }) => (
                      <Link
                        key={`${card.id}-${label}`}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-full border border-sky-400/40 px-4 py-1 text-[11px] uppercase tracking-[0.28em] text-sky-300 transition hover:border-sky-300 hover:text-sky-200"
                      >
                        {label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleRegenerateComps}
                disabled={regeneratingComps}
                className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {regeneratingComps ? "Regenerating…" : "Regenerate eBay comps"}
              </button>

              <label className="mt-2 flex items-center gap-3 text-xs text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-400"
                  checked={form.humanReviewed}
                  onChange={handleCheckboxChange}
                />
                <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Mark as human reviewed</span>
              </label>
              {humanReviewSummary && (
                <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                  Current review: {humanReviewSummary}
                </p>
              )}

                </div>
              </details>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-6 py-2 text-[11px] uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>

            <div className="flex flex-col gap-4">
              <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Card Preview</p>
                <div className="mt-3 aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-night-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.thumbnailUrl ?? card.imageUrl}
                    alt={card.fileName}
                    className="h-full w-full object-cover"
                  />
                </div>
                {humanReviewSummary ? (
                  <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                    <span>Human reviewed</span>
                    <span className="text-[9px] uppercase tracking-[0.2em] text-emerald-100/80">{humanReviewSummary}</span>
                  </div>
                ) : form.humanReviewed ? (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                    <span>Human review will be recorded on save</span>
                  </div>
                ) : null}
                <p className="mt-3 text-xs text-slate-400">{card.fileName}</p>
                <p className="text-xs text-slate-400">{(card.fileSize / 1024).toFixed(0)} KB · {card.mimeType}</p>
                {card.assignedDefinitionId && (
                  <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
                    Assigned to pack {card.assignedDefinitionId}
                  </p>
                )}

                {card.label && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-night-900/60 p-4">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Label Pair</p>
                    <p className="mt-2 text-xs text-slate-200">Pair {card.label.pairId}</p>
                    <div className="mt-2 grid gap-2 text-[11px] text-slate-300">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Card QR</p>
                        <p>{card.label.card.serial ?? card.label.card.code}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Pack QR</p>
                        <p>{card.label.pack.serial ?? card.label.pack.code}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handlePrintLabels}
                      disabled={printing}
                      className="mt-3 w-full rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {printing ? "Printing…" : "Print Labels"}
                    </button>
                    {printStatus && <p className="mt-2 text-[10px] uppercase tracking-[0.26em] text-slate-400">{printStatus}</p>}
                  </div>
                )}

              {comparables.length > 0 && (
                <div className="mt-4 rounded-2xl border border-white/5 bg-night-900/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-sky-300">Quick eBay Links</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                      {comparables.map(({ label, href }) => (
                        <Link
                          key={`${card.id}-preview-${label}`}
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
            </div>

            <details className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.3em] text-slate-300">
                Legacy Insights
              </summary>
              <div className="mt-4 flex flex-col gap-4">
                {card.aiGrade && (
                  <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-indigo-300">AI Grading Estimate</p>
                    <div className="mt-4 flex flex-col gap-2 text-sm text-slate-200">
                      <p className="text-lg font-semibold uppercase tracking-[0.25em] text-white">
                        {card.aiGrade.final !== null ? `Grade ${card.aiGrade.final.toFixed(1)}` : "Pending"}
                      </p>
                      {card.aiGrade.psaEquivalent !== null && (
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                          PSA Estimate · {card.aiGrade.psaEquivalent}
                        </p>
                      )}
                      {card.aiGrade.rangeLow !== null && card.aiGrade.rangeHigh !== null && (
                        <p className="text-xs text-slate-400">
                          Likely range: PSA {card.aiGrade.rangeLow} – PSA {card.aiGrade.rangeHigh}
                        </p>
                      )}
                      {card.aiGrade.label && (
                        <p className="text-xs uppercase tracking-[0.28em] text-emerald-300">Condition {card.aiGrade.label}</p>
                      )}
                      {card.aiGrade.generatedAt && (
                        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                          Generated {new Date(card.aiGrade.generatedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    {(card.aiGrade.visualizationUrl || card.aiGrade.exactVisualizationUrl) && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {card.aiGrade.visualizationUrl && (
                          <a
                            href={card.aiGrade.visualizationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-full border border-indigo-400/40 px-4 py-1 text-[11px] uppercase tracking-[0.28em] text-indigo-200 transition hover:border-indigo-300 hover:text-indigo-100"
                          >
                            View overlays
                          </a>
                        )}
                        {card.aiGrade.exactVisualizationUrl && (
                          <a
                            href={card.aiGrade.exactVisualizationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-full border border-indigo-400/40 px-4 py-1 text-[11px] uppercase tracking-[0.28em] text-indigo-200 transition hover:border-indigo-300 hover:text-indigo-100"
                          >
                            Centering view
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {sportsDbSummary && (
                  <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300">Ximilar Match</p>
                    <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-4">
                        {sportsDbSummary.teamLogoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={sportsDbSummary.teamLogoUrl}
                            alt={sportsDbSummary.teamName ?? "Team"}
                            className="h-14 w-14 rounded-full border border-white/10 bg-night-800 object-contain p-2"
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                            No Logo
                          </div>
                        )}
                        <div>
                          <p className="text-sm uppercase tracking-[0.25em] text-slate-200">
                            {sportsDbSummary.playerName ?? "No player matched"}
                          </p>
                          <p className="text-xs text-slate-400">
                            {sportsDbSummary.teamName ?? "Unknown team"}
                          </p>
                          <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300">
                            Confidence {(sportsDbSummary.matchConfidence * 100).toFixed(0)}%
                          </p>
                          {(sportsDbSummary.sport || sportsDbSummary.league) && (
                            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                              {[sportsDbSummary.sport, sportsDbSummary.league].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          {sportsDbSummary.seasonLabel && (
                            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                              Latest season {sportsDbSummary.seasonLabel}
                            </p>
                          )}
                        </div>
                      </div>
                      {sportsDbSummary.statEntries.length > 0 && (
                        <dl className="grid w-full grid-cols-2 gap-3 md:w-auto md:grid-cols-3">
                          {sportsDbSummary.statEntries.map((entry) => (
                            <div key={entry.label} className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-center">
                              <dt className="text-[10px] uppercase tracking-[0.25em] text-emerald-200">{entry.label}</dt>
                              <dd className="text-sm font-semibold text-emerald-100">{entry.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  </div>
                )}

                {attributeEntries.length > 0 && (
                  <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-amber-300">Detected Attributes</p>
                    <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-200">
                      {attributeEntries.map((entry) => (
                        <div key={entry.label} className="flex justify-between gap-4">
                          <dt className="uppercase tracking-[0.25em] text-slate-500">{entry.label}</dt>
                          <dd className="text-right text-slate-200">{entry.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {card.notes.length > 0 && (
                  <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Notes</p>
                    <ul className="mt-3 flex flex-col gap-3 text-xs text-slate-200">
                      {card.notes.map((note) => (
                        <li key={note.id} className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                            {note.authorName ?? note.authorId} · {new Date(note.createdAt).toLocaleString()}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-slate-200">{note.body}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
