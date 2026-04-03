import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  annotateAndSortKingsreviewComps,
  buildKingsreviewCompMatchContext,
  KingsreviewCompMatchQuality,
  type KingsreviewCompKeyComparison,
  normalizeEbayItemSpecifics,
} from "@tenkings/shared";
import AppShell from "../../components/AppShell";
import { CardImage } from "../../components/CardImage";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import { useSession } from "../../hooks/useSession";

const REVIEW_STAGES = [
  { id: "BYTEBOT_RUNNING", label: "AI Running" },
  { id: "READY_FOR_HUMAN_REVIEW", label: "Ready" },
  { id: "ESCALATED_REVIEW", label: "Escalated" },
  { id: "REVIEW_COMPLETE", label: "Complete" },
] as const;

const QUEUE_FILTERS = [
  { id: "IN_REVIEW", label: "In Review" },
  { id: "ESCALATED_REVIEW", label: "Escalated" },
  { id: "REVIEW_COMPLETE", label: "Complete" },
] as const;
const MOBILE_TABS = [
  { id: "queue", label: "QUEUE" },
  { id: "evidence", label: "EVIDENCE" },
  { id: "comps", label: "COMPS" },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  ebay_sold: "eBay Sold",
};

const AI_STATUS_MESSAGES = [
  "Searching sold listings",
  "Collecting comps",
  "Organizing results",
] as const;
const PHOTO_CAROUSEL_ORDER = ["FRONT", "BACK", "TILT"] as const;
const LOAD_MORE_COMPS_PAGE_SIZE = 10;
const PRICE_REQUIRED_MESSAGE = "Price valuation field must be complete before moving a card to inventory ready.";
type QueueFilterStage = (typeof QUEUE_FILTERS)[number]["id"];
type MobileTab = (typeof MOBILE_TABS)[number]["id"];

type CardSummary = {
  id: string;
  fileName: string;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  cdnHdUrl: string | null;
  cdnThumbUrl: string | null;
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
  classificationNormalized?:
    | {
        categoryType?: string | null;
        setName?: string | null;
        setCode?: string | null;
        cardNumber?: string | null;
        [key: string]: unknown;
      }
    | null;
  photos?: Array<{
    id: string;
    kind: string;
    imageUrl: string;
    thumbnailUrl?: string | null;
    cdnHdUrl?: string | null;
    cdnThumbUrl?: string | null;
  }>;
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
  thumbnail?: string | null;
  condition?: string | null;
  itemSpecifics?: Record<string, string[]> | null;
  matchScore?: number | null;
  matchQuality?: KingsreviewCompMatchQuality | null;
  keyComparison?: KingsreviewCompKeyComparison | null;
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

const normalizeNullableText = (value: string | null | undefined): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
};

const isJobResultSource = (value: JobResultSource | null): value is JobResultSource => Boolean(value);

const getCompPreviewUrls = (comp: JobResultComp) => {
  const screenshotUrl = normalizeNullableText(comp.screenshotUrl);
  const listingImageUrl = normalizeNullableText(comp.listingImageUrl);
  const thumbnailUrl = normalizeNullableText(comp.thumbnail);
  return {
    primary: listingImageUrl ?? screenshotUrl ?? thumbnailUrl,
    fallback:
      listingImageUrl && screenshotUrl && listingImageUrl !== screenshotUrl
        ? screenshotUrl
        : (listingImageUrl ?? screenshotUrl) && thumbnailUrl && (listingImageUrl ?? screenshotUrl) !== thumbnailUrl
          ? thumbnailUrl
        : null,
  };
};

const normalizePatternMatch = (value: unknown): JobResultComp["patternMatch"] => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const tier = raw.tier;
  if (
    typeof raw.score !== "number" ||
    typeof raw.distance !== "number" ||
    typeof raw.colorDistance !== "number" ||
    (tier !== "verified" && tier !== "likely" && tier !== "weak" && tier !== "none")
  ) {
    return undefined;
  }
  return {
    score: raw.score,
    distance: raw.distance,
    colorDistance: raw.colorDistance,
    tier,
  };
};

const normalizeMatchQuality = (value: unknown): KingsreviewCompMatchQuality | undefined => {
  if (value === "exact" || value === "close" || value === "weak") {
    return value;
  }
  return undefined;
};

const normalizeKeyComparisonField = (value: unknown): KingsreviewCompKeyComparison[keyof KingsreviewCompKeyComparison] => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.matched !== "boolean") {
    return null;
  }
  return {
    expected: normalizeNullableText(typeof raw.expected === "string" ? raw.expected : null),
    actual: normalizeNullableText(typeof raw.actual === "string" ? raw.actual : null),
    matched: raw.matched,
  };
};

const normalizeKeyComparison = (value: unknown): KingsreviewCompKeyComparison | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const numbered = normalizeKeyComparisonField(raw.numbered);
  const parallel = normalizeKeyComparisonField(raw.parallel);
  const graded = normalizeKeyComparisonField(raw.graded);
  if (!numbered && !parallel && !graded) {
    return null;
  }
  return {
    numbered,
    parallel,
    graded,
  };
};

const normalizeJobResultComp = (value: unknown): JobResultComp | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const url = normalizeNullableText(typeof raw.url === "string" ? raw.url : null);
  if (!url) {
    return null;
  }
  const screenshotUrl =
    normalizeNullableText(typeof raw.screenshotUrl === "string" ? raw.screenshotUrl : null) ??
    normalizeNullableText(typeof raw.thumbnail === "string" ? raw.thumbnail : null) ??
    normalizeNullableText(typeof raw.imageUrl === "string" ? raw.imageUrl : null) ??
    "";
  const listingImageUrl =
    normalizeNullableText(typeof raw.listingImageUrl === "string" ? raw.listingImageUrl : null) ??
    normalizeNullableText(typeof raw.thumbnail === "string" ? raw.thumbnail : null) ??
    normalizeNullableText(typeof raw.imageUrl === "string" ? raw.imageUrl : null);

  return {
    source: normalizeNullableText(typeof raw.source === "string" ? raw.source : null) ?? "ebay_sold",
    title: normalizeNullableText(typeof raw.title === "string" ? raw.title : null),
    url,
    price: normalizeNullableText(typeof raw.price === "string" ? raw.price : null),
    soldDate: normalizeNullableText(typeof raw.soldDate === "string" ? raw.soldDate : null),
    screenshotUrl,
    listingImageUrl,
    thumbnail: normalizeNullableText(typeof raw.thumbnail === "string" ? raw.thumbnail : null),
    condition: normalizeNullableText(typeof raw.condition === "string" ? raw.condition : null),
    itemSpecifics: normalizeEbayItemSpecifics(raw.itemSpecifics),
    matchScore:
      typeof raw.matchScore === "number" && Number.isFinite(raw.matchScore)
        ? Math.max(0, Math.min(100, Math.round(raw.matchScore)))
        : undefined,
    matchQuality: normalizeMatchQuality(raw.matchQuality),
    keyComparison: normalizeKeyComparison(raw.keyComparison),
    notes: normalizeNullableText(typeof raw.notes === "string" ? raw.notes : null),
    patternMatch: normalizePatternMatch(raw.patternMatch),
  };
};

const normalizeBytebotJob = (value: unknown): BytebotJob | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = normalizeNullableText(typeof raw.id === "string" ? raw.id : null);
  const status = normalizeNullableText(typeof raw.status === "string" ? raw.status : null);
  const searchQuery = normalizeNullableText(typeof raw.searchQuery === "string" ? raw.searchQuery : null);
  if (!id || !status || !searchQuery) {
    return null;
  }

  const rawSources =
    raw.result && typeof raw.result === "object" && Array.isArray((raw.result as Record<string, unknown>).sources)
      ? ((raw.result as Record<string, unknown>).sources as unknown[])
      : [];

  const sources = rawSources
    .map((source) => {
      if (!source || typeof source !== "object") {
        return null;
      }
      const record = source as Record<string, unknown>;
      const sourceId = normalizeNullableText(typeof record.source === "string" ? record.source : null);
      if (!sourceId) {
        return null;
      }
      const normalizedSource: JobResultSource = {
        source: sourceId,
        searchUrl: normalizeNullableText(typeof record.searchUrl === "string" ? record.searchUrl : null) ?? "",
        searchScreenshotUrl:
          normalizeNullableText(typeof record.searchScreenshotUrl === "string" ? record.searchScreenshotUrl : null) ??
          "",
        comps: Array.isArray(record.comps)
          ? record.comps.map(normalizeJobResultComp).filter((comp): comp is JobResultComp => Boolean(comp))
          : [],
        error: normalizeNullableText(typeof record.error === "string" ? record.error : null) ?? undefined,
      };
      return normalizedSource;
    })
    .filter(isJobResultSource);

  return {
    id,
    status,
    searchQuery,
    result: {
      sources,
    },
  };
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

const compMatchRibbonColor = (quality: KingsreviewCompMatchQuality) => {
  switch (quality) {
    case "exact":
      return "#22c55e";
    case "close":
      return "#eab308";
    default:
      return "#ef4444";
  }
};

const queueStatusMeta = (card: CardSummary) => {
  const rawStatus = (card.status ?? "").toLowerCase().trim();
  const rawStage = (card.reviewStage ?? "").toLowerCase().trim();
  const errorStates = new Set(["error", "failed", "failure", "ocr_failed", "bytebot_failed"]);

  if (errorStates.has(rawStatus) || rawStatus.endsWith("_error") || rawStatus.endsWith("_failed")) {
    return { label: "ERROR", className: "border-rose-400/50 bg-rose-500/20 text-rose-200" };
  }
  if (rawStage === "escalated_review") {
    return { label: "ESCALATED", className: "border-amber-400/50 bg-amber-500/20 text-amber-200" };
  }
  if (rawStage === "review_complete") {
    return { label: "COMPLETE", className: "border-emerald-400/50 bg-emerald-500/20 text-emerald-200" };
  }
  if (rawStage === "inventory_ready_for_sale") {
    return { label: "INVENTORY", className: "border-gold-400/50 bg-gold-500/20 text-gold-200" };
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

const normalizeQueueFilterStage = (value: string | null | undefined): QueueFilterStage | null => {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized === "IN_REVIEW" ||
    normalized === "BYTEBOT_RUNNING" ||
    normalized === "READY_FOR_HUMAN_REVIEW"
  ) {
    return "IN_REVIEW";
  }
  if (normalized === "ESCALATED_REVIEW") {
    return "ESCALATED_REVIEW";
  }
  if (normalized === "REVIEW_COMPLETE") {
    return "REVIEW_COMPLETE";
  }
  return null;
};

const areCardSummariesEqual = (left: CardSummary[], right: CardSummary[]) =>
  left.length === right.length &&
  left.every((card, index) => {
    const other = right[index];
    return (
      other &&
      card.id === other.id &&
      card.fileName === other.fileName &&
      card.customTitle === other.customTitle &&
      card.resolvedPlayerName === other.resolvedPlayerName &&
      card.resolvedTeamName === other.resolvedTeamName &&
      card.status === other.status &&
      card.reviewStage === other.reviewStage &&
      card.reviewStageUpdatedAt === other.reviewStageUpdatedAt &&
      card.updatedAt === other.updatedAt &&
      card.valuationMinor === other.valuationMinor &&
      card.valuationCurrency === other.valuationCurrency
    );
  });

function formatMinorToDollarInput(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor)) {
    return "";
  }
  return (minor / 100).toFixed(2);
}

function parseDollarInputToMinor(input: string): number | null | undefined {
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
}

type ReviewDraftSnapshot = {
  query: string;
  variantNotes: string;
  variantSetId: string;
  variantCardNumber: string;
};

const normalizeDraftSnapshot = (snapshot: ReviewDraftSnapshot): ReviewDraftSnapshot => ({
  query: snapshot.query.trim(),
  variantNotes: snapshot.variantNotes.trim(),
  variantSetId: snapshot.variantSetId.trim(),
  variantCardNumber: snapshot.variantCardNumber.trim(),
});

const areDraftSnapshotsEqual = (a: ReviewDraftSnapshot | null | undefined, b: ReviewDraftSnapshot) =>
  Boolean(
    a &&
      a.query === b.query &&
      a.variantNotes === b.variantNotes &&
      a.variantSetId === b.variantSetId &&
      a.variantCardNumber === b.variantCardNumber
  );

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

type CompCardProps = {
  comp: JobResultComp;
  index: number;
  isExpanded: boolean;
  attached: boolean;
  showConfirmVariantLabel: boolean;
  onToggle: (index: number) => void;
  onAttach: (comp: JobResultComp) => void;
  onUnattach: (compUrl: string) => void;
};

type CompComparisonStripItem = {
  id: "numbered" | "parallel" | "graded";
  expected: string;
  actual: string;
  matched: boolean;
  title: string;
};

const truncateComparisonValue = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

const buildCompComparisonStripItems = (
  keyComparison: KingsreviewCompKeyComparison | null | undefined
): CompComparisonStripItem[] => {
  if (!keyComparison) {
    return [];
  }

  const rows: CompComparisonStripItem[] = [];
  ([
    { id: "numbered", label: "Numbered", field: keyComparison.numbered },
    { id: "parallel", label: "Parallel", field: keyComparison.parallel },
    { id: "graded", label: "Graded", field: keyComparison.graded },
  ] as const).forEach((entry) => {
    if (!entry.field) {
      return;
    }
    rows.push({
      id: entry.id,
      expected: entry.field.expected ?? "—",
      actual: entry.field.actual ?? "—",
      matched: entry.field.matched,
      title: `${entry.label}: ${entry.field.expected ?? "—"} vs ${entry.field.actual ?? "—"}`,
    });
  });
  return rows;
};

const CompComparisonStrip = ({ keyComparison }: { keyComparison: KingsreviewCompKeyComparison | null | undefined }) => {
  const rows = buildCompComparisonStripItems(keyComparison);
  if (rows.length < 1) {
    return null;
  }

  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
      {rows.map((row) => {
        const expectedLabel = row.id === "parallel" ? truncateComparisonValue(row.expected, 12) : row.expected;
        const actualLabel = row.id === "parallel" ? truncateComparisonValue(row.actual, 12) : row.actual;
        return (
          <div key={row.id} title={row.title} style={{ display: "flex", gap: "2px" }}>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: "3px",
                backgroundColor: "rgba(34,197,94,0.2)",
                color: "#22c55e",
                whiteSpace: "nowrap",
              }}
            >
              {expectedLabel}
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: "3px",
                backgroundColor: row.matched ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
                color: row.matched ? "#22c55e" : "#ef4444",
                whiteSpace: "nowrap",
              }}
            >
              {actualLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const CompCard = memo(function CompCard({
  comp,
  index,
  isExpanded,
  attached,
  showConfirmVariantLabel,
  onToggle,
  onAttach,
  onUnattach,
}: CompCardProps) {
  const compPreview = getCompPreviewUrls(comp);
  const matchLabel = comp.matchQuality ? comp.matchQuality.toUpperCase() : null;
  const matchRibbonColor = comp.matchQuality ? compMatchRibbonColor(comp.matchQuality) : null;

  return (
    <button
      type="button"
      onClick={() => onToggle(index)}
      className={`relative w-full overflow-hidden rounded-2xl border p-2.5 text-left transition md:p-3 ${
        isExpanded
          ? "h-[360px] border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(52,211,153,0.2)]"
          : "h-[150px] border-white/20 bg-black/90 hover:-translate-y-0.5 hover:border-white/40"
      }`}
    >
      {attached && (
        <div className={`absolute z-10 flex flex-col items-center ${matchLabel ? "right-2 top-12" : "right-2 top-2"}`}>
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-400/80 bg-emerald-500/20 text-[13px] font-bold text-emerald-300">
            ✓
          </span>
          <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.26em] text-emerald-300">
            Comp
          </span>
        </div>
      )}
      {matchLabel && matchRibbonColor && (
        <div
          className="pointer-events-none absolute z-20 text-white"
          style={{
            top: 0,
            right: "12px",
            width: "44px",
            padding: "6px 0 8px 0",
            textAlign: "center",
            color: "#ffffff",
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            lineHeight: 1.2,
            backgroundColor: matchRibbonColor,
            clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 6px), 50% 100%, 0 calc(100% - 6px))",
          }}
        >
          <div style={{ fontSize: "9px", fontWeight: 700 }}>{matchLabel}</div>
          <div style={{ fontSize: "7px", fontWeight: 400, opacity: 0.85, textTransform: "lowercase" }}>match</div>
        </div>
      )}
      {isExpanded ? (
        <div className="grid h-full grid-rows-[1fr_auto] gap-3 text-white">
          <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-xl border border-white/20 bg-black">
            {compPreview.primary && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={compPreview.primary}
                alt={comp.title ?? "Comp"}
                className="h-full w-full object-contain p-2"
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                data-fallback-src={compPreview.fallback ?? ""}
                onError={(event) => {
                  const fallbackSrc = event.currentTarget.dataset.fallbackSrc ?? "";
                  if (fallbackSrc && event.currentTarget.src !== fallbackSrc) {
                    event.currentTarget.src = fallbackSrc;
                    event.currentTarget.dataset.fallbackSrc = "";
                    return;
                  }
                  event.currentTarget.style.display = "none";
                }}
              />
            )}
          </div>
          <div className="space-y-2">
            <div>
              <div className="text-lg font-bold text-emerald-400 md:text-xl">{comp.price ?? "—"}</div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300 md:text-sm">
                {comp.soldDate ? `Sold ${comp.soldDate}` : ""}
              </div>
            </div>
            <div className="line-clamp-2 text-xs">{comp.title ?? comp.url}</div>
            <CompComparisonStrip keyComparison={comp.keyComparison} />
            <div className="flex flex-wrap gap-2">
              <a
                href={comp.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/20 px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] text-slate-300"
                onClick={(event) => event.stopPropagation()}
              >
                Open Listing
              </a>
              {attached ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUnattach(comp.url);
                  }}
                  className="rounded-full border border-rose-400/60 bg-rose-500/20 px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] text-rose-200"
                >
                  Unselect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAttach(comp);
                  }}
                  className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] text-emerald-200"
                >
                  {showConfirmVariantLabel ? "Mark Comp + Confirm Variant" : "Mark Comp"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid h-full grid-cols-[96px_1fr] gap-3 sm:grid-cols-[120px_1fr]">
          <div className="mx-auto h-full w-full max-w-[96px] overflow-hidden rounded-xl border border-white/20 bg-black sm:max-w-[120px]">
            {compPreview.primary && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={compPreview.primary}
                alt={comp.title ?? "Comp"}
                className="h-full w-full object-contain p-3"
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                data-fallback-src={compPreview.fallback ?? ""}
                onError={(event) => {
                  const fallbackSrc = event.currentTarget.dataset.fallbackSrc ?? "";
                  if (fallbackSrc && event.currentTarget.src !== fallbackSrc) {
                    event.currentTarget.src = fallbackSrc;
                    event.currentTarget.dataset.fallbackSrc = "";
                    return;
                  }
                  event.currentTarget.style.display = "none";
                }}
              />
            )}
          </div>
          <div className="flex flex-col justify-between gap-2 text-white">
            <div>
              <div className="text-lg font-bold text-emerald-400 md:text-xl">{comp.price ?? "—"}</div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300 md:text-sm">
                {comp.soldDate ? `Sold ${comp.soldDate}` : ""}
              </div>
            </div>
            <div className="line-clamp-2 text-xs">{comp.title ?? comp.url}</div>
            <CompComparisonStrip keyComparison={comp.keyComparison} />
            <div className="flex flex-wrap gap-2">
              {comp.patternMatch && (
                <span className="text-[10px] uppercase tracking-[0.3em] text-slate-300">
                  Pattern {comp.patternMatch.tier}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {attached ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUnattach(comp.url);
                  }}
                  className="rounded-full border border-rose-400/60 bg-rose-500/20 px-3 py-1 text-[9px] uppercase tracking-[0.26em] text-rose-200"
                >
                  Unselect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAttach(comp);
                  }}
                  className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-3 py-1 text-[9px] uppercase tracking-[0.26em] text-emerald-200"
                >
                  {showConfirmVariantLabel ? "Mark + Confirm" : "Mark Comp"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </button>
  );
});

export default function KingsReview() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const [stage, setStage] = useState<QueueFilterStage>("IN_REVIEW");
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("queue");
  const [leftPanelWidth, setLeftPanelWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(400);
  const [topChromeHeight, setTopChromeHeight] = useState(56);
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
  const [zoom, setZoom] = useState<number>(1);
  const [showWeakComps, setShowWeakComps] = useState(false);
  const [query, setQuery] = useState<string>("");
  const [queryTouched, setQueryTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autosavingValuation, setAutosavingValuation] = useState(false);
  const [autosavingDraft, setAutosavingDraft] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [valuationInput, setValuationInput] = useState("");
  const [valuationError, setValuationError] = useState<string | null>(null);
  const [variantNotes, setVariantNotes] = useState("");
  const [variantSetId, setVariantSetId] = useState("");
  const [variantCardNumber, setVariantCardNumber] = useState("");
  const [variantInspectOpen, setVariantInspectOpen] = useState(false);
  const [variantInspectCandidate, setVariantInspectCandidate] = useState<VariantCandidate | null>(null);
  const [variantInspectRefs, setVariantInspectRefs] = useState<VariantReference[]>([]);
  const [variantInspectLoading, setVariantInspectLoading] = useState(false);
  const [enqueueing, setEnqueueing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [extraCompsBySource, setExtraCompsBySource] = useState<Record<string, JobResultComp[]>>({});
  const [compNextOffsetBySource, setCompNextOffsetBySource] = useState<Record<string, number>>({});
  const [compHasMoreBySource, setCompHasMoreBySource] = useState<Record<string, boolean>>({});
  const [compLoadingBySource, setCompLoadingBySource] = useState<Record<string, boolean>>({});
  const [compErrorBySource, setCompErrorBySource] = useState<Record<string, string | null>>({});
  const [aiMessageIndex, setAiMessageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [showTeach, setShowTeach] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteSelection, setDeleteSelection] = useState<string[]>([]);
  const [playbookRules, setPlaybookRules] = useState<PlaybookRule[]>([]);
  const topChromeRef = useRef<HTMLDivElement | null>(null);
  const leftDragStartRef = useRef(280);
  const rightDragStartRef = useRef(400);
  const isDraggingRef = useRef(false);
  const lastJobIdRef = useRef<string | null>(null);
  const cardDetailCacheRef = useRef<Map<string, CardDetail>>(new Map());
  const inflightCardRef = useRef<Map<string, Promise<CardDetail | null>>>(new Map());
  const imagePreloadRef = useRef<Set<string>>(new Set());
  const lastSavedValuationRef = useRef<Map<string, number | null>>(new Map());
  const lastSavedDraftRef = useRef<Map<string, ReviewDraftSnapshot>>(new Map());
  const valuationInputRef = useRef<HTMLInputElement | null>(null);
  const valuationCardSyncRef = useRef<string | null>(null);
  const draftCardSyncRef = useRef<string | null>(null);
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
  const handleQueueFilterChange = useCallback((nextStage: QueueFilterStage) => {
    setStage(nextStage);
    setActiveCardId(null);
    setCardsLoading(true);
  }, []);
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
  const activeSourceKey = activeSourceData?.source ?? "ebay_sold";
  const sourceComps = useMemo(() => activeSourceData?.comps ?? [], [activeSourceData?.comps]);
  const appendedComps = useMemo(() => extraCompsBySource[activeSourceKey] ?? [], [activeSourceKey, extraCompsBySource]);
  const activeCompSearchQuery = useMemo(() => (job?.searchQuery ?? query).trim(), [job?.searchQuery, query]);
  const compMatchContext = useMemo(
    () =>
      activeCard
        ? buildKingsreviewCompMatchContext({
            resolvedPlayerName: activeCard.resolvedPlayerName,
            classification: activeCard.classification,
            normalized: activeCard.classificationNormalized,
            customTitle: activeCard.customTitle,
            variantId: activeCard.variantId ?? null,
          })
        : null,
    [activeCard]
  );
  const comps = useMemo(() => {
    const seen = new Set<string>();
    const merged: JobResultComp[] = [];
    [...sourceComps, ...appendedComps].forEach((comp) => {
      const fallbackKey = [comp.title ?? "", comp.price ?? "", comp.soldDate ?? ""].join("::");
      const key = normalizeCompUrl(comp.url) || fallbackKey;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(comp);
    });
    if (!compMatchContext) {
      return merged;
    }
    return annotateAndSortKingsreviewComps(compMatchContext, merged);
  }, [appendedComps, compMatchContext, normalizeCompUrl, sourceComps]);
  const compEntries = useMemo(() => comps.map((comp, index) => ({ comp, index })), [comps]);
  const strongCompEntries = useMemo(
    () => compEntries.filter(({ comp }) => comp.matchQuality === "exact" || comp.matchQuality === "close"),
    [compEntries]
  );
  const weakCompCount = useMemo(
    () => compEntries.filter(({ comp }) => comp.matchQuality === "weak").length,
    [compEntries]
  );
  const visibleCompEntries = useMemo(() => {
    if (showWeakComps || strongCompEntries.length < 1) {
      return compEntries;
    }
    return strongCompEntries;
  }, [compEntries, showWeakComps, strongCompEntries]);
  const hiddenWeakCount = useMemo(() => {
    if (showWeakComps || strongCompEntries.length < 1) {
      return 0;
    }
    return weakCompCount;
  }, [showWeakComps, strongCompEntries.length, weakCompCount]);
  const activeCompNextOffset = compNextOffsetBySource[activeSourceKey] ?? sourceComps.length;
  const activeCompLoadingMore = compLoadingBySource[activeSourceKey] ?? false;
  const activeCompHasMore =
    compHasMoreBySource[activeSourceKey] ?? (sourceComps.length >= LOAD_MORE_COMPS_PAGE_SIZE);
  const activeCompError = compErrorBySource[activeSourceKey] ?? null;
  const canLoadMoreComps =
    activeSourceKey === "ebay_sold" &&
    Boolean(activeCompSearchQuery) &&
    sourceComps.length > 0;
  const attachedCompKeys = useMemo(() => {
    return new Set(
      evidenceItems
        .filter((item) => item.kind === "SOLD_COMP")
        .map((item) => normalizeCompUrl(item.url))
        .filter(Boolean)
    );
  }, [evidenceItems, normalizeCompUrl]);
  const attachedCompItemByKey = useMemo(() => {
    const map = new Map<string, EvidenceItem>();
    evidenceItems
      .filter((item) => item.kind === "SOLD_COMP")
      .forEach((item) => {
        const key = normalizeCompUrl(item.url);
        if (!key || map.has(key)) {
          return;
        }
        map.set(key, item);
      });
    return map;
  }, [evidenceItems, normalizeCompUrl]);
  const rulesForActiveSource = playbookRules.filter(
    (rule) => rule.source === (activeSourceData?.source ?? teachForm.source)
  );
  const shouldConfirmVariantOnCompAttach = useMemo(() => {
    const selectedParallelId = (activeCard?.variantDecision?.selectedParallelId ?? activeCard?.variantId ?? "")
      .trim()
      .toLowerCase();
    return Boolean(
      activeCard && !activeCard.variantDecision?.humanOverride && selectedParallelId && selectedParallelId !== "unknown"
    );
  }, [activeCard]);
  const activePhotos = useMemo(() => {
    if (!activeCard?.photos?.length) {
      return {};
    }
    return activeCard.photos.reduce<Record<string, NonNullable<CardDetail["photos"]>[number]>>((acc, photo) => {
      const key = typeof photo.kind === "string" ? photo.kind.toUpperCase() : photo.kind;
      acc[key] = photo;
      if (typeof key === "string") {
        acc[key.toLowerCase()] = photo;
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
  const activePhotoIndex = Math.max(0, PHOTO_CAROUSEL_ORDER.indexOf(activePhotoKind));
  const draftAutosaveLabel = useMemo(() => {
    if (autosavingDraft) {
      return "Auto-saving review fields...";
    }
    if (draftSaveStatus === "error") {
      return "Auto-save failed. Changes stay local until retry.";
    }
    if (draftSaveStatus === "saved" && draftSavedAt) {
      return `Saved ${new Date(draftSavedAt).toLocaleTimeString()}`;
    }
    return null;
  }, [autosavingDraft, draftSaveStatus, draftSavedAt]);
  const panelViewportHeight = useMemo(() => `calc(100vh - ${Math.max(topChromeHeight, 0)}px)`, [topChromeHeight]);

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  useEffect(() => {
    const checkViewport = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkViewport();
    window.addEventListener("resize", checkViewport);

    return () => {
      window.removeEventListener("resize", checkViewport);
    };
  }, []);

  useEffect(() => {
    const measureTopChrome = () => {
      const nextHeight = topChromeRef.current?.getBoundingClientRect().height ?? 56;
      setTopChromeHeight(Math.max(0, Math.round(nextHeight)));
    };

    measureTopChrome();
    window.addEventListener("resize", measureTopChrome);

    let observer: ResizeObserver | null = null;
    if (topChromeRef.current && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        measureTopChrome();
      });
      observer.observe(topChromeRef.current);
    }

    return () => {
      window.removeEventListener("resize", measureTopChrome);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const handleLeftDividerMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    leftDragStartRef.current = leftPanelWidth;
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(200, Math.min(500, leftDragStartRef.current + delta));
      setLeftPanelWidth(nextWidth);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [leftPanelWidth]);

  const handleRightDividerMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    rightDragStartRef.current = rightPanelWidth;
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(280, Math.min(600, rightDragStartRef.current - delta));
      setRightPanelWidth(nextWidth);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [rightPanelWidth]);

  const DragDivider = ({ onMouseDown }: { onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void }) => (
    <div
      onMouseDown={onMouseDown}
      style={{
        width: "6px",
        flexShrink: 0,
        cursor: "col-resize",
        position: "relative",
        zIndex: 10,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "2px",
          width: "1px",
          backgroundColor: "rgba(255,255,255,0.1)",
          transition: "background-color 0.15s",
        }}
      />
    </div>
  );

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
            cdnHdUrl: card.cdnHdUrl ?? null,
            cdnThumbUrl: card.cdnThumbUrl ?? null,
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
      preloadImage(detail.cdnThumbUrl ?? detail.thumbnailUrl);
      preloadImage(detail.cdnHdUrl ?? detail.imageUrl);
      (detail.photos ?? []).forEach((photo) => {
        preloadImage(photo.cdnThumbUrl ?? photo.thumbnailUrl ?? null);
        preloadImage(photo.cdnHdUrl ?? photo.imageUrl);
      });
    },
    [fetchCardDetail, preloadImage]
  );
  const preloadCardSummary = useCallback(
    (card: CardSummary | CardDetail | null | undefined) => {
      if (!card) {
        return;
      }
      preloadImage(card.cdnThumbUrl ?? card.thumbnailUrl ?? card.imageUrl);
    },
    [preloadImage]
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
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
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
          setCards((prev) => (areCardSummariesEqual(prev, nextCards) ? prev : nextCards));
          setCardsOffset((prev) => (prev === nextCards.length ? prev : nextCards.length));
          setCardsHasMore((prev) => (prev === (nextCards.length === limit) ? prev : nextCards.length === limit));
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
    }, 5000);
    return () => clearInterval(interval);
  }, [adminHeaders, cardsOffset, isAdmin, session, stage]);

  useEffect(() => {
    if (!cards.length) {
      return;
    }
    cards.slice(0, 6).forEach((card) => preloadCardSummary(card));
  }, [cards, preloadCardSummary]);

  useEffect(() => {
    if (!activeCardId || !cards.length) {
      return;
    }
    const index = cards.findIndex((card) => card.id === activeCardId);
    if (index === -1) {
      return;
    }
    const start = Math.max(0, index - 2);
    const end = Math.min(cards.length, index + 3);
    cards.slice(start, end).forEach((card) => preloadCardSummary(card));
  }, [activeCardId, cards, preloadCardSummary]);

  useEffect(() => {
    if (!activeCard) {
      return;
    }
    preloadCardSummary(activeCard);
    (activeCard.photos ?? []).forEach((photo) => {
      preloadImage(photo.cdnThumbUrl ?? photo.thumbnailUrl ?? photo.imageUrl ?? null);
    });
  }, [activeCard, preloadCardSummary, preloadImage]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    const requestedStage = normalizeQueueFilterStage(typeof router.query.stage === "string" ? router.query.stage : null);
    if (requestedStage) {
      setStage(requestedStage);
    }
    const requestedCardId = typeof router.query.cardId === "string" ? router.query.cardId : null;
    if (requestedCardId) {
      setActiveCardId(requestedCardId);
    }
  }, [router.isReady, router.query.cardId, router.query.stage]);

  useEffect(() => {
    if (!activeCardId) {
      return;
    }
    const selectedCard = cards.find((card) => card.id === activeCardId);
    if (!selectedCard) {
      return;
    }
    // Render the newly selected card image immediately while detail fetch completes.
    setActiveCard((prev) => {
      if (prev?.id === selectedCard.id) {
        return prev;
      }
      return {
        ...selectedCard,
        customDetails: null,
        classification: null,
        classificationNormalized: null,
        photos: [],
      };
    });
    setActivePhotoKind((prev) => {
      const nextCard = selectedCard as CardSummary & {
        photos?: Array<{ kind?: string | null }>;
      };
      const available = new Set(
        (nextCard.photos ?? [])
          .map((photo) => (typeof photo?.kind === "string" ? photo.kind.toUpperCase() : ""))
          .filter(Boolean)
      );
      if (prev === "FRONT") {
        return "FRONT";
      }
      if (available.has(prev)) {
        return prev;
      }
      return "FRONT";
    });
  }, [activeCardId, cards]);

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
          setActivePhotoKind((prev) => {
            const available = new Set(
              (nextCard.photos ?? [])
                .map((photo) => (typeof photo?.kind === "string" ? photo.kind.toUpperCase() : ""))
                .filter(Boolean)
            );
            if (prev === "FRONT") {
              return "FRONT";
            }
            if (available.has(prev)) {
              return prev;
            }
            return "FRONT";
          });
          const nextVariantSetId =
            (nextCard.classificationNormalized as any)?.setName ??
            (nextCard.classificationNormalized as any)?.setCode ??
            "";
          const nextVariantCardNumber = (nextCard.classificationNormalized as any)?.cardNumber ?? "";
          const nextVariantNotes = nextCard.variantDecision?.humanNotes ?? nextCard.customDetails ?? "";
          const nextQuery = nextCard.customTitle ?? nextCard.fileName ?? "";
          setVariantSetId(nextVariantSetId);
          setVariantCardNumber(nextVariantCardNumber);
          setVariantNotes(nextVariantNotes);
          setQuery(nextQuery);
          setQueryTouched(false);
          draftCardSyncRef.current = nextCard.id;
          lastSavedDraftRef.current.set(
            nextCard.id,
            normalizeDraftSnapshot({
              query: nextQuery,
              variantNotes: nextVariantNotes,
              variantSetId: nextVariantSetId,
              variantCardNumber: nextVariantCardNumber,
            })
          );
          setDraftSaveStatus("idle");
          setDraftSavedAt(null);
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
        const nextJob = normalizeBytebotJob(data.job);
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
  }, [activeCardId, adminHeaders, fetchCardDetail, isAdmin, session]);

  useEffect(() => {
    setExtraCompsBySource({});
    setCompNextOffsetBySource({});
    setCompHasMoreBySource({});
    setCompLoadingBySource({});
    setCompErrorBySource({});
  }, [activeCardId, job?.id]);

  useEffect(() => {
    setShowWeakComps(false);
  }, [activeCardId, activeSourceKey, job?.id]);

  useEffect(() => {
    if (activeCompIndex == null) {
      return;
    }
    if (!visibleCompEntries.some((entry) => entry.index === activeCompIndex)) {
      setActiveCompIndex(null);
    }
  }, [activeCompIndex, visibleCompEntries]);

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
        const nextJob = normalizeBytebotJob(data.job);
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
    if (!activeCard?.id) {
      valuationCardSyncRef.current = null;
      setValuationInput("");
      setValuationError(null);
      return;
    }
    if (valuationCardSyncRef.current === activeCard.id) {
      return;
    }
    valuationCardSyncRef.current = activeCard.id;
    const savedMinor = activeCard.valuationMinor ?? null;
    lastSavedValuationRef.current.set(activeCard.id, savedMinor);
    setValuationInput(formatMinorToDollarInput(savedMinor));
    setValuationError(null);
  }, [activeCard?.id, activeCard?.valuationMinor]);

  useEffect(() => {
    if (activeCard?.id) {
      return;
    }
    draftCardSyncRef.current = null;
    setVariantNotes("");
    setVariantSetId("");
    setVariantCardNumber("");
    setQuery("");
    setQueryTouched(false);
    setDraftSaveStatus("idle");
    setDraftSavedAt(null);
  }, [activeCard?.id]);

  useEffect(() => {
    if (!activeCard?.id || saving) {
      return;
    }
    const cardId = activeCard.id;
    const parsedMinor = parseDollarInputToMinor(valuationInput);
    if (parsedMinor === undefined) {
      return;
    }
    const lastSavedMinor = lastSavedValuationRef.current.get(cardId);
    if (lastSavedMinor === parsedMinor) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setAutosavingValuation(true);
        try {
          const res = await fetch(`/api/admin/cards/${cardId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...adminHeaders(),
            },
            body: JSON.stringify({
              valuationMinor: parsedMinor,
              valuationCurrency: activeCard.valuationCurrency ?? "USD",
            }),
          });
          if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload?.message ?? "Failed to auto-save valuation");
          }
          const payload = await res.json().catch(() => null);
          const updated = (payload?.card ?? payload ?? {}) as Partial<CardDetail>;
          const nextMinor =
            typeof updated.valuationMinor === "number" || updated.valuationMinor === null
              ? updated.valuationMinor
              : parsedMinor;
          const nextCurrency =
            typeof updated.valuationCurrency === "string" && updated.valuationCurrency
              ? updated.valuationCurrency
              : activeCard.valuationCurrency ?? "USD";
          lastSavedValuationRef.current.set(cardId, nextMinor ?? null);
          if (!cancelled) {
            setCards((prev) =>
              prev.map((card) =>
                card.id === cardId
                  ? {
                      ...card,
                      valuationMinor: nextMinor ?? null,
                      valuationCurrency: nextCurrency,
                    }
                  : card
              )
            );
            setActiveCard((prev) =>
              prev && prev.id === cardId
                ? {
                    ...prev,
                    valuationMinor: nextMinor ?? null,
                    valuationCurrency: nextCurrency,
                  }
                : prev
            );
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to auto-save valuation");
          }
        } finally {
          if (!cancelled) {
            setAutosavingValuation(false);
          }
        }
      })();
    }, 650);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeCard?.id, activeCard?.valuationCurrency, adminHeaders, saving, valuationInput]);

  useEffect(() => {
    if (!activeCard?.id || saving) {
      return;
    }
    const cardId = activeCard.id;
    const nextSnapshot = normalizeDraftSnapshot({
      query,
      variantNotes,
      variantSetId,
      variantCardNumber,
    });
    const lastSavedSnapshot = lastSavedDraftRef.current.get(cardId);
    if (areDraftSnapshotsEqual(lastSavedSnapshot, nextSnapshot)) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setAutosavingDraft(true);
        setDraftSaveStatus("idle");
        try {
          const res = await fetch(`/api/admin/cards/${cardId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...adminHeaders(),
            },
            body: JSON.stringify({
              customTitle: nextSnapshot.query || null,
              customDetails: nextSnapshot.variantNotes || null,
              classificationUpdates: {
                normalized: {
                  setName: nextSnapshot.variantSetId || null,
                  cardNumber: nextSnapshot.variantCardNumber || null,
                },
              },
            }),
          });
          if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload?.message ?? "Failed to auto-save review fields");
          }
          const payload = await res.json().catch(() => null);
          const updated = (payload?.card ?? payload ?? {}) as Partial<CardDetail>;
          const resolvedTitle =
            typeof updated.customTitle === "string" || updated.customTitle === null
              ? updated.customTitle
              : nextSnapshot.query || null;
          const resolvedDetails =
            typeof updated.customDetails === "string" || updated.customDetails === null
              ? updated.customDetails
              : nextSnapshot.variantNotes || null;

          lastSavedDraftRef.current.set(cardId, nextSnapshot);
          if (cancelled) {
            return;
          }

          setCards((prev) =>
            prev.map((card) =>
              card.id === cardId
                ? {
                    ...card,
                    customTitle: resolvedTitle,
                  }
                : card
            )
          );
          setActiveCard((prev) =>
            prev && prev.id === cardId
              ? {
                  ...prev,
                  customTitle: resolvedTitle,
                  customDetails: resolvedDetails,
                  classificationNormalized:
                    prev.classificationNormalized && typeof prev.classificationNormalized === "object"
                      ? {
                          ...prev.classificationNormalized,
                          setName: nextSnapshot.variantSetId || null,
                          cardNumber: nextSnapshot.variantCardNumber || null,
                        }
                      : prev.classificationNormalized,
                }
              : prev
          );
          const cached = cardDetailCacheRef.current.get(cardId);
          if (cached) {
            cardDetailCacheRef.current.set(cardId, {
              ...cached,
              customTitle: resolvedTitle,
              customDetails: resolvedDetails,
              classificationNormalized:
                cached.classificationNormalized && typeof cached.classificationNormalized === "object"
                  ? {
                      ...cached.classificationNormalized,
                      setName: nextSnapshot.variantSetId || null,
                      cardNumber: nextSnapshot.variantCardNumber || null,
                    }
                  : cached.classificationNormalized,
            });
          }

          setDraftSaveStatus("saved");
          setDraftSavedAt(Date.now());
        } catch {
          if (!cancelled) {
            setDraftSaveStatus("error");
          }
        } finally {
          if (!cancelled) {
            setAutosavingDraft(false);
          }
        }
      })();
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeCard?.id, adminHeaders, query, saving, variantCardNumber, variantNotes, variantSetId]);

  const handleStageUpdate = async (nextStage: string) => {
    if (!activeCard) {
      return;
    }
    let valuationMinorForUpdate: number | null | undefined;
    if (nextStage === "INVENTORY_READY_FOR_SALE") {
      const parsed = parseDollarInputToMinor(valuationInput);
      if (parsed == null || parsed <= 0) {
        setValuationError(PRICE_REQUIRED_MESSAGE);
        setTimeout(() => {
          valuationInputRef.current?.focus();
          valuationInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 0);
        return;
      }
      valuationMinorForUpdate = parsed;
      setValuationError(null);
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
          reviewStage: nextStage,
          ...(valuationMinorForUpdate !== undefined
            ? {
                valuationMinor: valuationMinorForUpdate,
                valuationCurrency: activeCard.valuationCurrency ?? "USD",
              }
            : {}),
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to update stage");
      }
      if (valuationMinorForUpdate !== undefined) {
        lastSavedValuationRef.current.set(activeCard.id, valuationMinorForUpdate);
      }
      const nextQueueFilter = normalizeQueueFilterStage(nextStage);
      if (nextQueueFilter) {
        setStage((current) => (current === "IN_REVIEW" ? current : nextQueueFilter));
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
    if (!variantSetId.trim()) {
      setError("Set ID is required to run the matcher.");
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
        // Send numbered denominator signal when available.
        body: JSON.stringify({
          cardAssetId: activeCard.id,
          setId: variantSetId.trim(),
          cardNumber: variantCardNumber.trim(),
          numbered:
            (typeof activeCard.classification?.numbered === "string" && activeCard.classification?.numbered) ||
            (activeCard.ocrText?.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/)?.[0] ?? null),
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to run matcher");
      }
      if (payload?.matchedSetId) {
        setVariantSetId(payload.matchedSetId);
      }
      if (payload?.matchedCardNumber) {
        setVariantCardNumber(payload.matchedCardNumber);
      }
      if (payload?.ok === false) {
        setActiveCard((prev) =>
          prev
            ? {
                ...prev,
                variantDecision: {
                  selectedParallelId: prev.variantDecision?.selectedParallelId ?? prev.variantId ?? null,
                  confidence: prev.variantDecision?.confidence ?? prev.variantConfidence ?? null,
                  humanOverride: prev.variantDecision?.humanOverride ?? false,
                  humanNotes: prev.variantDecision?.humanNotes ?? null,
                  candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
                },
              }
            : prev
        );
        setError(payload?.message ?? "No confident variant match");
        return;
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
      setJob(normalizeBytebotJob(data.job));
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
      setJob(normalizeBytebotJob(data.job));
      setActiveSource(null);
      setError("Comps regeneration queued.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate comps");
    } finally {
      setRegenerating(false);
    }
  };

  const handleLoadMoreComps = useCallback(async () => {
    if (!canLoadMoreComps || activeCompLoadingMore || !activeCompHasMore) {
      return;
    }
    const nextQuery = activeCompSearchQuery;
    if (!nextQuery) {
      setError("Search query is required to load more comps");
      return;
    }

    setCompLoadingBySource((prev) => ({ ...prev, [activeSourceKey]: true }));
    setCompErrorBySource((prev) => ({ ...prev, [activeSourceKey]: null }));
    setError(null);
    try {
      const params = new URLSearchParams({
        source: activeSourceKey,
        query: nextQuery,
        offset: String(activeCompNextOffset),
        limit: String(LOAD_MORE_COMPS_PAGE_SIZE),
      });
      if (activeCardId) {
        params.set("cardAssetId", activeCardId);
      }
      const res = await fetch(`/api/admin/kingsreview/comps?${params.toString()}`, {
        headers: adminHeaders(),
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof payload.message === "string" ? payload.message : "Failed to load more comps");
      }
      const rawNextComps = Array.isArray(payload.comps) ? payload.comps : [];
      const nextComps = rawNextComps
        .map(normalizeJobResultComp)
        .filter((comp): comp is JobResultComp => Boolean(comp));
      setExtraCompsBySource((prev) => {
        const existing = prev[activeSourceKey] ?? [];
        const seen = new Set(
          [...sourceComps, ...existing].map((comp) => normalizeCompUrl(comp.url)).filter(Boolean)
        );
        const uniqueNext = nextComps.filter((comp) => {
          const key = normalizeCompUrl(comp.url);
          if (key && seen.has(key)) {
            return false;
          }
          if (key) {
            seen.add(key);
          }
          return true;
        });
        return {
          ...prev,
          [activeSourceKey]: [...existing, ...uniqueNext],
        };
      });
      const nextOffset =
        typeof payload.nextOffset === "number" && Number.isFinite(payload.nextOffset)
          ? payload.nextOffset
          : activeCompNextOffset + nextComps.length;
      setCompNextOffsetBySource((prev) => ({ ...prev, [activeSourceKey]: nextOffset }));
      setCompHasMoreBySource((prev) => ({
        ...prev,
        [activeSourceKey]: Boolean(payload?.hasMore),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load more comps";
      setCompErrorBySource((prev) => ({ ...prev, [activeSourceKey]: message }));
      setError(message);
    } finally {
      setCompLoadingBySource((prev) => ({ ...prev, [activeSourceKey]: false }));
    }
  }, [
    activeCardId,
    activeCompHasMore,
    activeCompLoadingMore,
    activeCompNextOffset,
    activeCompSearchQuery,
    activeSourceKey,
    adminHeaders,
    canLoadMoreComps,
    normalizeCompUrl,
    sourceComps,
  ]);

  const handleAttachComp = useCallback(async (comp: JobResultComp, kind: string) => {
    if (!activeCardId || !activeCard) {
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
          screenshotUrl: getCompPreviewUrls(comp).primary,
          price: comp.price,
          soldDate: comp.soldDate,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to attach comp");
      }
      const data = await res.json();
      setEvidenceItems((prev) => [data.item, ...prev]);
      const selectedParallelId = (activeCard.variantDecision?.selectedParallelId ?? activeCard.variantId ?? "").trim();
      const shouldConfirmVariant =
        kind === "SOLD_COMP" &&
        selectedParallelId.length > 0 &&
        selectedParallelId.toLowerCase() !== "unknown" &&
        !activeCard.variantDecision?.humanOverride;
      if (shouldConfirmVariant) {
        const confirmRes = await fetch("/api/admin/variants/decision", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...adminHeaders(),
          },
          body: JSON.stringify({
            cardAssetId: activeCard.id,
            selectedParallelId,
            confidence: activeCard.variantDecision?.confidence ?? activeCard.variantConfidence ?? null,
            candidates: activeCard.variantDecision?.candidates ?? [],
            humanOverride: true,
            humanNotes: variantNotes.trim() || null,
          }),
        });
        if (!confirmRes.ok) {
          throw new Error("Comp attached, but variant confirmation failed");
        }
        setActiveCard((prev) =>
          prev && prev.id === activeCard.id
            ? {
                ...prev,
                variantId: selectedParallelId,
                variantDecision: {
                  selectedParallelId,
                  confidence: prev.variantDecision?.confidence ?? prev.variantConfidence ?? null,
                  humanOverride: true,
                  humanNotes: variantNotes.trim() || null,
                  candidates: prev.variantDecision?.candidates ?? [],
                },
              }
            : prev
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to attach comp");
    }
  }, [activeCard, activeCardId, adminHeaders, variantNotes]);

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

  const handleDeleteEvidence = useCallback(async (id: string) => {
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
  }, [adminHeaders]);

  const handleUnattachComp = useCallback(async (compUrl: string) => {
    const key = normalizeCompUrl(compUrl);
    const item = attachedCompItemByKey.get(key);
    if (!item) {
      return;
    }
    await handleDeleteEvidence(item.id);
  }, [attachedCompItemByKey, handleDeleteEvidence, normalizeCompUrl]);
  const handleToggleComp = useCallback((index: number) => {
    setActiveCompIndex((prev) => (prev === index ? null : index));
  }, []);
  const handleAttachSoldComp = useCallback((comp: JobResultComp) => {
    void handleAttachComp(comp, "SOLD_COMP");
  }, [handleAttachComp]);
  const handleSelectCard = useCallback((cardId: string) => {
    setActiveCardId(cardId);
    if (isMobile) {
      setMobileTab("evidence");
    }
  }, [isMobile]);
  const renderQueuePanel = (mobile = false) => (
    <section
      className={`flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-black p-3 md:gap-4 md:p-4${mobile ? " w-full" : ""}`}
      style={
        mobile
          ? { height: "100%" }
          : {
              width: leftPanelWidth,
              minWidth: 200,
              maxWidth: 500,
              height: panelViewportHeight,
              flexShrink: 0,
            }
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Card Queue</p>
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-slate-500">
            <span>View</span>
            <select
              value={stage}
              onChange={(event) => handleQueueFilterChange(event.target.value as QueueFilterStage)}
              className="rounded-full border border-white/10 bg-night-800 px-3 py-1.5 text-[10px] uppercase tracking-[0.28em] text-slate-200 outline-none transition focus:border-gold-400/60"
            >
              {QUEUE_FILTERS.map((filterOption) => (
                <option key={filterOption.id} value={filterOption.id}>
                  {filterOption.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">{cards.length} cards</p>
          <button
            type="button"
            onClick={() => {
              setDeleteSelection([]);
              setShowDeleteDialog(true);
            }}
            className="inline-flex items-center justify-center rounded-full border border-rose-400/60 bg-rose-500/20 px-3 py-1.5 text-[9px] uppercase tracking-[0.3em] text-rose-200 transition hover:border-rose-300 disabled:opacity-60"
            disabled={purging}
            aria-label="Delete cards"
            title="Delete cards"
          >
            <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 24 24" fill="none">
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
      </div>
      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-night-950/50 p-2 pr-1 md:pr-2"
        onScroll={(event) => {
          const target = event.currentTarget;
          if (target.scrollTop + target.clientHeight >= target.scrollHeight - 40) {
            loadMoreCards().catch(() => undefined);
          }
        }}
      >
        <div>
          {cards.map((card) => {
            const status = queueStatusMeta(card);
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => handleSelectCard(card.id)}
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
              No cards in this queue
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
      </div>
    </section>
  );
  const renderEvidencePanel = (mobile = false) => (
    <section
      className={`flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-black p-3 md:gap-4 md:p-4${mobile ? " w-full" : ""}`}
      style={mobile ? { height: "100%" } : { minWidth: 300, height: panelViewportHeight }}
    >
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
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
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
              <div className="mx-auto w-full max-w-[300px]">
                <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-night-950">
                  <div
                    className="flex h-full w-full transition-transform duration-300 ease-out"
                    style={{ transform: `translateX(-${activePhotoIndex * 100}%)` }}
                  >
                    {PHOTO_CAROUSEL_ORDER.map((kind) => {
                      const isFront = kind === "FRONT";
                      const photo = isFront ? null : activePhotos[kind];
                      const cdnHdUrl = isFront ? activeCard.cdnHdUrl : photo?.cdnHdUrl ?? null;
                      const cdnThumbUrl = isFront ? activeCard.cdnThumbUrl : photo?.cdnThumbUrl ?? null;
                      const imageUrl = isFront ? activeCard.imageUrl : photo?.imageUrl ?? null;
                      const thumbnailUrl = isFront ? activeCard.thumbnailUrl : photo?.thumbnailUrl ?? null;
                      return (
                        <div key={kind} className="relative h-full w-full shrink-0">
                          {cdnHdUrl || cdnThumbUrl || imageUrl || thumbnailUrl ? (
                            <CardImage
                              cdnHdUrl={cdnHdUrl}
                              cdnThumbUrl={cdnThumbUrl}
                              fallbackUrl={imageUrl ?? thumbnailUrl}
                              variant="hd"
                              alt={`${activeCard.fileName} ${kind.toLowerCase()}`}
                              fill
                              className="object-cover"
                              sizes="(min-width: 1024px) 400px, 80vw"
                              priority={activePhotoKind === kind}
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.3em] text-slate-500">
                              Missing
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setActivePhotoKind(
                        PHOTO_CAROUSEL_ORDER[
                          (activePhotoIndex - 1 + PHOTO_CAROUSEL_ORDER.length) % PHOTO_CAROUSEL_ORDER.length
                        ]
                      )
                    }
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-black/60 px-2 py-1 text-xs uppercase tracking-[0.2em] text-white"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActivePhotoKind(
                        PHOTO_CAROUSEL_ORDER[(activePhotoIndex + 1) % PHOTO_CAROUSEL_ORDER.length]
                      )
                    }
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-black/60 px-2 py-1 text-xs uppercase tracking-[0.2em] text-white"
                  >
                    →
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.28em] text-slate-400">
                  {PHOTO_CAROUSEL_ORDER.map((kind, index) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setActivePhotoKind(kind)}
                      className={`rounded-full border px-2 py-0.5 ${
                        activePhotoIndex === index
                          ? "border-sky-400/60 bg-sky-500/20 text-sky-200"
                          : "border-white/20 text-slate-400"
                      }`}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              </div>
              <details open className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                <summary className="cursor-pointer text-[10px] uppercase tracking-[0.3em] text-slate-400">
                  Card Details
                </summary>
                <div className="mt-3 grid gap-2">
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
                    <span className="text-[10px] uppercase tracking-[0.3em] text-rose-300">Price Valuation (USD)</span>
                    <div
                      className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${
                        valuationError || !valuationInput.trim()
                          ? "border-rose-400/70 bg-rose-500/10"
                          : "border-emerald-400/60 bg-emerald-500/10"
                      }`}
                    >
                      <span className="text-sm text-rose-200">$</span>
                      <input
                        ref={valuationInputRef}
                        inputMode="decimal"
                        placeholder="13.00"
                        value={valuationInput}
                        onChange={(event) => {
                          const nextInput = event.target.value;
                          setValuationInput(nextInput);
                          setValuationError(null);
                          const parsed = parseDollarInputToMinor(nextInput);
                          if (parsed !== undefined) {
                            setActiveCard((prev) => (prev ? { ...prev, valuationMinor: parsed } : prev));
                          }
                        }}
                        onBlur={() => {
                          const parsed = parseDollarInputToMinor(valuationInput);
                          if (parsed === undefined) {
                            setValuationError("Enter a valid dollar amount (example: 13.00).");
                          } else if (valuationError && parsed != null && parsed > 0) {
                            setValuationError(null);
                          }
                        }}
                        className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-rose-200/60"
                      />
                    </div>
                    <span className={`text-[10px] ${valuationError ? "text-rose-300" : "text-slate-500"}`}>
                      {valuationError
                        ? valuationError
                        : autosavingValuation
                          ? "Auto-saving valuation..."
                          : "Valuation auto-saves as you type."}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleStageUpdate("INVENTORY_READY_FOR_SALE")}
                    disabled={saving}
                    className="rounded-full border border-gold-500/80 bg-gold-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-night-900 transition hover:bg-gold-400 disabled:opacity-60"
                  >
                    Move To Inventory Ready
                  </button>
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
                                loading="lazy"
                                decoding="async"
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
                      <div className="rounded-2xl border border-white/10 bg-night-900/60 px-3 py-3 text-[11px] text-slate-300">
                        <div className="mb-2 text-[9px] tracking-[0.24em] text-slate-500">
                          {activeCard.variantDecision?.selectedParallelId || activeCard.variantId
                            ? "Status: Matched"
                            : activeCard.variantDecision?.candidates?.length
                              ? "Status: No confident match"
                              : "Status: Not attempted"}
                        </div>
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
                            className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-[11px] text-white"
                          />
                          {draftAutosaveLabel && (
                            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">{draftAutosaveLabel}</p>
                          )}
                          <div className="grid gap-2 md:grid-cols-2">
                            <input
                              value={variantSetId}
                              onChange={(event) => setVariantSetId(event.target.value)}
                              placeholder="Set ID"
                              className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-[11px] text-white"
                            />
                            <input
                              value={variantCardNumber}
                              onChange={(event) => setVariantCardNumber(event.target.value)}
                              placeholder="Card #"
                              className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-[11px] text-white"
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
                            {REVIEW_STAGES.map((reviewStage) => (
                              <option key={reviewStage.id} value={reviewStage.id}>
                                {reviewStage.label}
                              </option>
                            ))}
                            <option value="INVENTORY_READY_FOR_SALE">Inventory Ready</option>
                          </select>
                        </label>
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
                          <button
                            type="button"
                            onClick={() => setShowTeach((prev) => !prev)}
                            className="rounded-full border border-sky-400/40 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-sky-200 transition hover:border-sky-300"
                          >
                            {showTeach ? "Hide Bytebot Teach" : "Show Bytebot Teach"}
                          </button>
                        </div>
                      </div>
                      {showTeach && (
                        <div className="rounded-2xl border border-sky-400/30 bg-sky-500/5 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] uppercase tracking-[0.3em] text-sky-300">Bytebot Teach</p>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                              Space = Pause · T = Toggle
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-slate-400">
                            This panel saves Bytebot click-selector rules only. OCR teach-from-corrections lives in Add Cards.
                          </p>
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
                              <textarea
                                value={teachForm.selector}
                                onChange={(event) =>
                                  setTeachForm((prev) => ({ ...prev, selector: event.target.value }))
                                }
                                placeholder="text=Sports or a[href*='sports']"
                                rows={2}
                                className="resize-y rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-xs text-white"
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
                                  <div className="break-words whitespace-normal">{rule.selector}</div>
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
              </details>
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
      </div>
    </section>
  );
  const renderCompDetailPanel = (mobile = false) => (
    <section
      className={`flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-black p-3 md:gap-4 md:p-4${mobile ? " w-full" : ""}`}
      style={
        mobile
          ? { height: "100%" }
          : {
              width: rightPanelWidth,
              minWidth: 280,
              maxWidth: 600,
              height: panelViewportHeight,
              flexShrink: 0,
            }
      }
    >
      <div className="border-b border-white/10 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Comp Detail</p>
          <div className="flex flex-wrap items-center gap-2">
            {(sources.length ? sources : [{ source: "ebay_sold" } as { source: string }]).map((source) => (
              <button
                key={source.source}
                type="button"
                onClick={() => {
                  setActiveSource(source.source);
                  setActiveCompIndex(null);
                }}
                className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.28em] transition ${
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
                className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-emerald-200"
              >
                Attach Search
              </button>
            )}
            {activeSourceData?.searchUrl && (
              <a
                href={activeSourceData.searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full border border-sky-400/70 bg-sky-500/20 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-100 transition hover:bg-sky-500/30"
              >
                Open eBay Search
              </a>
            )}
          </div>
        </div>
        <div className="mt-3 rounded-2xl border border-white/10 bg-night-950/50 px-3 py-3">
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">eBay Query</p>
          <p className="mt-1 break-words text-xs text-slate-300">
            {activeCompSearchQuery ? `"${activeCompSearchQuery}"` : "No eBay query captured yet."}
          </p>
          {queryTouched && query.trim() && query.trim() !== activeCompSearchQuery && (
            <p className="mt-2 text-[10px] uppercase tracking-[0.24em] text-amber-300">
              Search field edited locally. Run or regenerate comps to refresh results.
            </p>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-night-950/60 p-2 sm:p-3">
        {activeCompError && (
          <div className="mb-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {activeCompError}
          </div>
        )}
        {comps.length === 0 && (
          <p className="text-xs text-slate-500">No comps captured yet. Try re-running research.</p>
        )}
        <div className="space-y-2">
          {visibleCompEntries.map(({ comp, index }) => {
            const compAttached = attachedCompKeys.has(normalizeCompUrl(comp.url));
            return (
              <CompCard
                key={`${comp.url}-${index}`}
                comp={comp}
                index={index}
                isExpanded={activeCompIndex === index}
                attached={compAttached}
                showConfirmVariantLabel={shouldConfirmVariantOnCompAttach}
                onToggle={handleToggleComp}
                onAttach={handleAttachSoldComp}
                onUnattach={handleUnattachComp}
              />
            );
          })}
        </div>
        {strongCompEntries.length > 0 && weakCompCount > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowWeakComps((prev) => !prev)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/10"
            >
              {showWeakComps ? "Hide weak matches" : `Show weak matches (${hiddenWeakCount})`}
            </button>
          </div>
        )}
        {canLoadMoreComps && activeCompHasMore && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => {
                void handleLoadMoreComps();
              }}
              disabled={activeCompLoadingMore}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-sky-400/70 bg-sky-500/20 px-4 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-sky-100 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {activeCompLoadingMore && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-100 border-t-transparent" />
              )}
              Load 10 More Comps
            </button>
          </div>
        )}
        {canLoadMoreComps && !activeCompHasMore && comps.length > 0 && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            No more comps available
          </div>
        )}
      </div>
    </section>
  );
  const renderDesktopWorkspace = () => (
    <div
      className="flex min-h-0 flex-1 overflow-hidden bg-black"
      style={{ height: panelViewportHeight, maxHeight: panelViewportHeight }}
    >
      {renderQueuePanel()}
      <DragDivider onMouseDown={handleLeftDividerMouseDown} />
      {renderEvidencePanel()}
      <DragDivider onMouseDown={handleRightDividerMouseDown} />
      {renderCompDetailPanel()}
    </div>
  );
  const renderMobileWorkspace = () => (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-black"
      style={{ height: panelViewportHeight, maxHeight: panelViewportHeight }}
    >
      <div className="sticky top-0 z-20 flex shrink-0 border-b border-white/10 bg-black">
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMobileTab(tab.id)}
            style={{
              flex: 1,
              padding: "12px 0",
              background: "none",
              border: "none",
              borderBottom: mobileTab === tab.id ? "2px solid #d4a843" : "2px solid transparent",
              color: mobileTab === tab.id ? "#ffffff" : "rgba(255,255,255,0.5)",
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "1px",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {mobileTab === "queue"
          ? renderQueuePanel(true)
          : mobileTab === "evidence"
            ? renderEvidencePanel(true)
            : renderCompDetailPanel(true)}
      </div>
    </div>
  );

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
      <div className="flex h-screen flex-1 flex-col overflow-hidden bg-night-950 text-white">
        <div ref={topChromeRef} className="shrink-0">
          <header className="px-4 pb-3 pt-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black p-2">
              <Link
                href="/admin/uploads"
                className="inline-flex rounded-full border border-white/20 px-3 py-1.5 text-[10px] uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                ← Add Cards
              </Link>
              <p className="px-2 font-heading text-sm uppercase tracking-[0.24em] text-gold-300">KingsReview</p>
              <Link
                href="/admin/inventory"
                className="inline-flex rounded-full border border-white/20 px-3 py-1.5 text-[10px] uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                Inventory →
              </Link>
            </div>
          </header>

          {error && (
            <div className="mx-4 mb-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200 sm:mx-6">
              {error}
            </div>
          )}
        </div>

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

        {isMobile ? renderMobileWorkspace() : renderDesktopWorkspace()}
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
    <AppShell hideHeader hideFooter>
      <Head>
        <title>KingsReview · Ten Kings</title>
      </Head>
      {renderContent()}
    </AppShell>
  );
}
