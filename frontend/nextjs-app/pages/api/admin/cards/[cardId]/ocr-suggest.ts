import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { prisma, SetIngestionJobStatus, type Prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { normalizeStorageUrl } from "../../../../../lib/server/storage";
import { runGoogleVisionOcr } from "../../../../../lib/server/googleVisionOcr";
import { extractCardAttributes, resolveOcrLlmAttempt } from "@tenkings/shared";
import { runVariantMatch } from "../../../../../lib/server/variantMatcher";
import {
  loadVariantOptionPool,
  normalizeVariantLabelKey,
  resolveCanonicalOption,
  sanitizeText,
  tokenize,
} from "../../../../../lib/server/variantOptionPool";
import {
  buildOcrFeedbackMemoryContext,
  isOcrFeedbackMemoryStoredValueEmpty,
  parseOcrFeedbackTokenRefs,
  upsertOcrFeedbackMemoryAggregates,
} from "../../../../../lib/server/ocrFeedbackMemory";
import {
  listOcrRegionTemplates,
  type OcrRegionPhotoSide,
  type OcrRegionRect,
} from "../../../../../lib/server/ocrRegionTemplates";
import { normalizeProgramId, normalizeTaxonomyCardNumber } from "../../../../../lib/server/taxonomyV2Utils";

type SuggestResponse =
  | {
      suggestions: Record<string, string>;
      threshold: number;
      audit: Record<string, unknown>;
      status?: "pending" | "ok";
    }
  | { message: string };

type SuggestionFields = {
  playerName: string | null;
  teamName: string | null;
  year: string | null;
  manufacturer: string | null;
  sport: string | null;
  game: string | null;
  cardName: string | null;
  setName: string | null;
  insertSet: string | null;
  parallel: string | null;
  cardNumber: string | null;
  numbered: string | null;
  autograph: string | null;
  memorabilia: string | null;
  graded: string | null;
  gradeCompany: string | null;
  gradeValue: string | null;
};

type SuggestionConfidence = Record<keyof SuggestionFields, number | null>;

const DEFAULT_THRESHOLD = 0.7;
const OCR_LLM_MODEL_RAW = (process.env.OCR_LLM_MODEL ?? "").trim();
const OCR_LLM_MODEL = OCR_LLM_MODEL_RAW && OCR_LLM_MODEL_RAW !== "gpt-5" ? OCR_LLM_MODEL_RAW : "gpt-5.2";
const OCR_LLM_FALLBACK_MODEL = (process.env.OCR_LLM_FALLBACK_MODEL ?? "gpt-5-mini").trim();
const OCR_LLM_REASONING_VALUES = new Set<OcrLlmReasoningEffort>(["none", "low", "medium", "high", "xhigh"]);
const OCR_LLM_REASONING_EFFORT = parseOcrReasoningEffort(process.env.OCR_LLM_REASONING_EFFORT);
const TCG_KEYWORDS = [
  "pokemon",
  "magic",
  "yugioh",
  "yu-gi-oh",
  "lorcana",
  "one piece",
  "digimon",
  "tcg",
  "trading card",
];

const FIELD_KEYS: (keyof SuggestionFields)[] = [
  "playerName",
  "teamName",
  "year",
  "manufacturer",
  "sport",
  "game",
  "cardName",
  "setName",
  "insertSet",
  "parallel",
  "cardNumber",
  "numbered",
  "autograph",
  "memorabilia",
  "graded",
  "gradeCompany",
  "gradeValue",
];

const TAXONOMY_FIELD_THRESHOLD: Record<"setName" | "insertSet" | "parallel", number> = {
  setName: 0.8,
  insertSet: 0.8,
  parallel: 0.8,
};

type LlmParseResponse = {
  meta: LlmParseMeta;
  fields: SuggestionFields;
  confidence: SuggestionConfidence;
};

type LlmParseMeta = {
  endpoint: "responses";
  model: string;
  format: "json_schema" | "json_object";
  fallbackUsed: boolean;
  mode: "text" | "multimodal";
  detail: "low" | "high" | null;
  requestId: string | null;
  clientRequestId: string | null;
  reasoningEffort: OcrLlmReasoningEffort | null;
  imageUrlMode: "string" | "object" | null;
  reasoningRetried: boolean;
};

type LlmParsedPayload = {
  fields: SuggestionFields;
  confidence: SuggestionConfidence;
};

type LlmImageInput = {
  id: OcrPhotoId;
  url: string;
};

type MultimodalDecision = {
  useMultimodal: boolean;
  detail: "low" | "high";
  reasons: string[];
};

type OcrImageSection = {
  id: OcrPhotoId;
  text: string;
};

type OcrPhotoId = "FRONT" | "BACK" | "TILT";
type OcrLlmReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

type PhotoOcrState = {
  id: OcrPhotoId;
  hasImage: boolean;
  status: "missing_image" | "empty_text" | "ok";
  ocrText: string;
  tokenCount: number;
  sourceImageId: string | null;
};

type MemoryContext = {
  setId: string | null;
  year: string | null;
  manufacturer: string | null;
  sport: string | null;
  cardNumber: string | null;
  numbered: string | null;
};

type MemoryApplyEntry = {
  field: keyof SuggestionFields;
  value: string;
  confidence: number;
  support: number;
};

type MemoryTokenRef = {
  text: string;
  imageId: string | null;
  weight?: number | null;
};

type OcrTokenPoint = {
  x: number;
  y: number;
};

type OcrTokenEntry = {
  text: string;
  imageId: string | null;
  bbox: OcrTokenPoint[];
};

type MemoryTokenLookup = {
  global: Set<string>;
  byImage: Map<string, Set<string>>;
};

type RegionTemplateMap = Record<OcrRegionPhotoSide, OcrRegionRect[]>;

type RegionTokenLookup = {
  global: Set<string>;
  byImage: Map<string, Set<string>>;
  byFieldGlobal: Map<keyof SuggestionFields, Set<string>>;
  byFieldImage: Map<keyof SuggestionFields, Map<string, Set<string>>>;
};

type TokenRefSupport = {
  support: number;
  regionOverlap: number;
};

type TaxonomyPromptCandidates = {
  setOptions: string[];
  insertOptions: string[];
  parallelOptions: string[];
};

type TaxonomyConstraintAudit = {
  selectedSetId: string | null;
  queryHints: {
    year: string | null;
    manufacturer: string | null;
    sport: string | null;
    productLine: string | null;
    setId: string | null;
    layoutClass: string | null;
  };
  pool: {
    approvedSetCount: number;
    scopedSetCount: number;
    selectedSetId: string | null;
    setOptions: string[];
    insertOptions: string[];
    parallelOptions: string[];
  };
  fieldStatus: Record<string, "kept" | "cleared_low_confidence" | "cleared_out_of_pool" | "cleared_no_set_scope">;
};

type SetCardResolutionAudit = {
  matched: boolean;
  reason: string;
  source?: "set_card" | "legacy_variant";
  candidateSetIds: string[];
  candidateCount: number;
  setId: string | null;
  programId: string | null;
  programLabel: string | null;
  cardNumber: string | null;
  playerName: string | null;
  teamName: string | null;
  score?: number;
  runnerUpScore?: number | null;
};

type CardNumberGroundingMatchType = "pattern" | "compact";
type CardNumberGroundingSourceSide = OcrPhotoId | "COMBINED";

type CardNumberGroundingAudit = {
  matched: boolean;
  reason: string;
  candidateSetIds: string[];
  scannedRowCount: number;
  candidateCount: number;
  cardNumber: string | null;
  setId: string | null;
  programId: string | null;
  programLabel: string | null;
  playerName: string | null;
  teamName: string | null;
  sourceSide: CardNumberGroundingSourceSide | null;
  matchType: CardNumberGroundingMatchType | null;
  evidenceText: string | null;
  score?: number;
  runnerUpScore?: number | null;
  topCandidates?: Array<{
    cardNumber: string;
    setId: string;
    programId: string;
    programLabel: string | null;
    sourceSide: CardNumberGroundingSourceSide;
    matchType: CardNumberGroundingMatchType;
    score: number;
  }>;
};

const OCR_PHOTO_IDS: OcrPhotoId[] = ["FRONT", "BACK", "TILT"];
const REQUIRED_OCR_PHOTO_IDS: OcrPhotoId[] = ["FRONT", "BACK", "TILT"];
const TRUE_STRINGS = new Set(["true", "yes", "1"]);
const BOOLEAN_MEMORY_FIELDS = new Set<keyof SuggestionFields>(["autograph", "memorabilia", "graded"]);
const MEMORY_EXCLUDED_FIELDS = new Set<keyof SuggestionFields>(["numbered"]);
const MEMORY_FIELD_KEYS = FIELD_KEYS.filter((field) => !MEMORY_EXCLUDED_FIELDS.has(field));

function coerceNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function coerceConfidence(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  if (value < 0 || value > 1) {
    return null;
  }
  return value;
}

function fieldThreshold(field: keyof SuggestionFields): number {
  if (field === "setName" || field === "insertSet" || field === "parallel") {
    return TAXONOMY_FIELD_THRESHOLD[field];
  }
  return DEFAULT_THRESHOLD;
}

function publishedTaxonomyWhereInput(): Prisma.SetCardWhereInput {
  return {
    OR: [
      { sourceId: null },
      {
        source: {
          is: {
            OR: [
              { ingestionJobId: null },
              { ingestionJob: { status: SetIngestionJobStatus.APPROVED } },
            ],
          },
        },
      },
    ],
  };
}

function publishedSetProgramWhereInput(): Prisma.SetProgramWhereInput {
  return {
    OR: [
      { sourceId: null },
      {
        source: {
          is: {
            OR: [
              { ingestionJobId: null },
              { ingestionJob: { status: SetIngestionJobStatus.APPROVED } },
            ],
          },
        },
      },
    ],
  };
}

function normalizeLooseLookupKey(value: string | null | undefined) {
  return tokenize(String(value || "")).join(" ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeOcrCodeText(value: string | null | undefined) {
  return String(value || "")
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/(?<=\d)[O]/g, "0")
    .replace(/[O](?=\d)/g, "0")
    .replace(/(?<=\d)[IL]/g, "1")
    .replace(/[IL](?=\d)/g, "1")
    .replace(/(?<=\d)S/g, "5")
    .replace(/S(?=\d)/g, "5");
}

function compactAlphaNumeric(value: string | null | undefined) {
  return normalizeOcrCodeText(value).replace(/[^A-Z0-9]/g, "");
}

function buildCardNumberSearchRegex(cardNumber: string): RegExp | null {
  const normalized = normalizeTaxonomyCardNumber(cardNumber);
  if (!normalized || normalized === "ALL") {
    return null;
  }
  const chunks = normalized
    .split(/[^A-Z0-9]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => escapeRegExp(part));
  if (chunks.length < 1) {
    return null;
  }
  return new RegExp(`(?:^|[^A-Z0-9])(${chunks.join("[\\s\\-_/]*")})(?=$|[^A-Z0-9])`, "i");
}

function findCardNumberTextEvidence(
  cardNumber: string,
  textSources: Array<{ side: CardNumberGroundingSourceSide; text: string }>
): {
  sourceSide: CardNumberGroundingSourceSide;
  matchType: CardNumberGroundingMatchType;
  evidenceText: string;
  baseScore: number;
} | null {
  const normalizedCardNumber = normalizeTaxonomyCardNumber(cardNumber);
  if (!normalizedCardNumber || normalizedCardNumber === "ALL") {
    return null;
  }
  const pattern = buildCardNumberSearchRegex(normalizedCardNumber);
  const compactKey = compactAlphaNumeric(normalizedCardNumber);
  const sideWeights: Record<CardNumberGroundingSourceSide, number> = {
    BACK: 4,
    FRONT: 2.5,
    TILT: 1.5,
    COMBINED: 0.5,
  };
  const matches: Array<{
    sourceSide: CardNumberGroundingSourceSide;
    matchType: CardNumberGroundingMatchType;
    evidenceText: string;
    baseScore: number;
  }> = [];

  textSources.forEach(({ side, text }) => {
    const normalizedText = normalizeOcrCodeText(text);
    if (!normalizedText) {
      return;
    }
    if (pattern) {
      const patternMatch = normalizedText.match(pattern);
      if (patternMatch?.[1]) {
        matches.push({
          sourceSide: side,
          matchType: "pattern",
          evidenceText: patternMatch[1],
          baseScore: sideWeights[side] + 4,
        });
      }
    }
    if (compactKey.length >= 4) {
      const compactText = compactAlphaNumeric(normalizedText);
      if (compactText.includes(compactKey)) {
        matches.push({
          sourceSide: side,
          matchType: "compact",
          evidenceText: compactKey,
          baseScore: sideWeights[side] + 2.5,
        });
      }
    }
  });

  return (
    matches.sort((a, b) => {
      if (b.baseScore !== a.baseScore) {
        return b.baseScore - a.baseScore;
      }
      if (a.matchType !== b.matchType) {
        return a.matchType === "pattern" ? -1 : 1;
      }
      return a.sourceSide.localeCompare(b.sourceSide);
    })[0] ?? null
  );
}

async function groundScopedCardNumberFromOcr(params: {
  fields: SuggestionFields;
  queryHints: {
    year: string | null;
    manufacturer: string | null;
    sport: string | null;
    productLine: string | null;
    setId: string | null;
  };
  photoTexts: Record<OcrPhotoId, string>;
  combinedText: string;
}): Promise<CardNumberGroundingAudit> {
  const year = sanitizeText(params.queryHints.year || params.fields.year || "");
  const manufacturer = sanitizeText(params.queryHints.manufacturer || params.fields.manufacturer || "");
  const sport = sanitizeText(params.queryHints.sport || params.fields.sport || "") || null;
  if (!year || !manufacturer) {
    return {
      matched: false,
      reason: "missing_scope_hints",
      candidateSetIds: [],
      scannedRowCount: 0,
      candidateCount: 0,
      cardNumber: null,
      setId: null,
      programId: null,
      programLabel: null,
      playerName: null,
      teamName: null,
      sourceSide: null,
      matchType: null,
      evidenceText: null,
    };
  }

  const pool = await loadVariantOptionPool({
    year,
    manufacturer,
    sport,
    productLine: sanitizeText(params.queryHints.productLine || "") || null,
    setId: sanitizeText(params.queryHints.setId || "") || null,
  });
  const candidateSetIds = (pool.selectedSetId ? [pool.selectedSetId] : pool.scopedSetIds).filter(Boolean);
  if (candidateSetIds.length < 1) {
    return {
      matched: false,
      reason: "no_scoped_sets",
      candidateSetIds: [],
      scannedRowCount: 0,
      candidateCount: 0,
      cardNumber: null,
      setId: null,
      programId: null,
      programLabel: null,
      playerName: null,
      teamName: null,
      sourceSide: null,
      matchType: null,
      evidenceText: null,
    };
  }

  const rows = await prisma.setCard.findMany({
    where: {
      setId: { in: candidateSetIds },
      ...publishedTaxonomyWhereInput(),
    },
    select: {
      setId: true,
      programId: true,
      cardNumber: true,
      playerName: true,
      team: true,
    },
    take: 4000,
  });
  if (rows.length < 1) {
    return {
      matched: false,
      reason: "no_scoped_set_cards",
      candidateSetIds,
      scannedRowCount: 0,
      candidateCount: 0,
      cardNumber: null,
      setId: null,
      programId: null,
      programLabel: null,
      playerName: null,
      teamName: null,
      sourceSide: null,
      matchType: null,
      evidenceText: null,
    };
  }

  const programKeys = Array.from(new Set(rows.map((row) => `${row.setId}::${row.programId}`)));
  const programs = programKeys.length
    ? await prisma.setProgram.findMany({
        where: {
          OR: programKeys.map((entry) => {
            const [setId, programId] = entry.split("::");
            return { setId, programId };
          }),
          ...publishedSetProgramWhereInput(),
        },
        select: {
          setId: true,
          programId: true,
          label: true,
        },
      })
    : [];
  const programLabelByKey = new Map(programs.map((program) => [`${program.setId}::${program.programId}`, program.label]));

  const textSources: Array<{ side: CardNumberGroundingSourceSide; text: string }> = [
    { side: "BACK", text: params.photoTexts.BACK || "" },
    { side: "FRONT", text: params.photoTexts.FRONT || "" },
    { side: "TILT", text: params.photoTexts.TILT || "" },
    { side: "COMBINED", text: params.combinedText || "" },
  ];
  const playerKey = normalizeLooseLookupKey(params.fields.playerName);
  const teamKey = normalizeLooseLookupKey(params.fields.teamName);
  const insertKey = normalizeVariantLabelKey(params.fields.insertSet || "");
  const setKey = normalizeLooseLookupKey(params.fields.setName);

  const grouped = new Map<
    string,
    {
      cardNumber: string;
      score: number;
      supportCount: number;
      bestRow: {
        setId: string;
        programId: string;
        cardNumber: string;
        playerName: string | null;
        team: string | null;
      };
      programLabel: string | null;
      sourceSide: CardNumberGroundingSourceSide;
      matchType: CardNumberGroundingMatchType;
      evidenceText: string;
    }
  >();

  rows.forEach((row) => {
    const normalizedCardNumber = normalizeTaxonomyCardNumber(row.cardNumber);
    if (!normalizedCardNumber || normalizedCardNumber === "ALL") {
      return;
    }
    const evidence = findCardNumberTextEvidence(normalizedCardNumber, textSources);
    if (!evidence) {
      return;
    }

    const rowProgramLabel = programLabelByKey.get(`${row.setId}::${row.programId}`) ?? null;
    const rowPlayerKey = normalizeLooseLookupKey(row.playerName);
    const rowTeamKey = normalizeLooseLookupKey(row.team);
    const rowProgramKey = normalizeVariantLabelKey(rowProgramLabel || row.programId || "");
    const rowSetKey = normalizeLooseLookupKey(row.setId);
    let score = evidence.baseScore;
    if (pool.selectedSetId && row.setId === pool.selectedSetId) {
      score += 2;
    }
    if (playerKey && rowPlayerKey) {
      if (rowPlayerKey === playerKey) {
        score += 4.5;
      } else if (rowPlayerKey.includes(playerKey) || playerKey.includes(rowPlayerKey)) {
        score += 2.25;
      }
    }
    if (teamKey && rowTeamKey && rowTeamKey === teamKey) {
      score += 1.5;
    }
    if (insertKey && rowProgramKey && rowProgramKey === insertKey) {
      score += 3;
    }
    if (setKey && rowSetKey && rowSetKey === setKey) {
      score += 1.5;
    }

    const digitCount = normalizedCardNumber.replace(/[^0-9]/g, "").length;
    const hasAlpha = /[A-Z]/.test(normalizedCardNumber);
    if (!hasAlpha && digitCount <= 2 && !playerKey && !insertKey) {
      score -= 2.5;
    }
    if (!hasAlpha && evidence.matchType === "compact") {
      score -= 1.5;
    }
    if (score < 5.5) {
      return;
    }

    const existing = grouped.get(normalizedCardNumber);
    if (!existing) {
      grouped.set(normalizedCardNumber, {
        cardNumber: normalizedCardNumber,
        score,
        supportCount: 1,
        bestRow: row,
        programLabel: rowProgramLabel,
        sourceSide: evidence.sourceSide,
        matchType: evidence.matchType,
        evidenceText: evidence.evidenceText,
      });
      return;
    }
    existing.supportCount += 1;
    if (score > existing.score) {
      existing.score = score;
      existing.bestRow = row;
      existing.programLabel = rowProgramLabel;
      existing.sourceSide = evidence.sourceSide;
      existing.matchType = evidence.matchType;
      existing.evidenceText = evidence.evidenceText;
    }
  });

  const candidates = Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      score: Number((entry.score + Math.min(1.2, Math.max(0, entry.supportCount - 1) * 0.25)).toFixed(3)),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.supportCount - a.supportCount ||
        a.cardNumber.localeCompare(b.cardNumber)
    );

  const best = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;
  if (!best) {
    return {
      matched: false,
      reason: "no_card_number_evidence_in_scope",
      candidateSetIds,
      scannedRowCount: rows.length,
      candidateCount: 0,
      cardNumber: null,
      setId: null,
      programId: null,
      programLabel: null,
      playerName: null,
      teamName: null,
      sourceSide: null,
      matchType: null,
      evidenceText: null,
    };
  }

  const bestHasAlpha = /[A-Z]/.test(best.cardNumber);
  const scoreFloor = bestHasAlpha ? 6 : playerKey || insertKey ? 6.2 : 7;
  const strongLead = !runnerUp || best.score - runnerUp.score >= 1.2;
  if (best.score < scoreFloor || !strongLead) {
    return {
      matched: false,
      reason: best.score < scoreFloor ? "weak_card_number_evidence" : "ambiguous_card_number_evidence",
      candidateSetIds,
      scannedRowCount: rows.length,
      candidateCount: candidates.length,
      cardNumber: best.cardNumber,
      setId: best.bestRow.setId,
      programId: best.bestRow.programId,
      programLabel: best.programLabel,
      playerName: best.bestRow.playerName ?? null,
      teamName: best.bestRow.team ?? null,
      sourceSide: best.sourceSide,
      matchType: best.matchType,
      evidenceText: best.evidenceText,
      score: best.score,
      runnerUpScore: runnerUp?.score ?? null,
      topCandidates: candidates.slice(0, 3).map((candidate) => ({
        cardNumber: candidate.cardNumber,
        setId: candidate.bestRow.setId,
        programId: candidate.bestRow.programId,
        programLabel: candidate.programLabel,
        sourceSide: candidate.sourceSide,
        matchType: candidate.matchType,
        score: candidate.score,
      })),
    };
  }

  return {
    matched: true,
    reason: "scoped_ocr_card_number_match",
    candidateSetIds,
    scannedRowCount: rows.length,
    candidateCount: candidates.length,
    cardNumber: best.cardNumber,
    setId: best.bestRow.setId,
    programId: best.bestRow.programId,
    programLabel: best.programLabel,
    playerName: best.bestRow.playerName ?? null,
    teamName: best.bestRow.team ?? null,
    sourceSide: best.sourceSide,
    matchType: best.matchType,
    evidenceText: best.evidenceText,
    score: best.score,
    runnerUpScore: runnerUp?.score ?? null,
    topCandidates: candidates.slice(0, 3).map((candidate) => ({
      cardNumber: candidate.cardNumber,
      setId: candidate.bestRow.setId,
      programId: candidate.bestRow.programId,
      programLabel: candidate.programLabel,
      sourceSide: candidate.sourceSide,
      matchType: candidate.matchType,
      score: candidate.score,
    })),
  };
}

async function resolveScopedLegacyVariantCard(params: {
  candidateSetIds: string[];
  selectedSetId: string | null;
  fields: SuggestionFields;
  normalizedCardNumber: string;
}): Promise<SetCardResolutionAudit> {
  const { candidateSetIds, selectedSetId, fields, normalizedCardNumber } = params;
  if (candidateSetIds.length < 1) {
    return {
      matched: false,
      source: "legacy_variant",
      reason: "no_scoped_sets",
      candidateSetIds: [],
      candidateCount: 0,
      setId: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
    };
  }

  const normalizedProgram = sanitizeText(fields.insertSet || "") ? normalizeProgramId(fields.insertSet) : null;
  type LegacyVariantGroupRow = {
    setId: string;
    programId: string;
    cardNumber: string;
    _count: {
      _all: number;
    };
  };
  const findLegacyRows = async (programId: string | null): Promise<LegacyVariantGroupRow[]> => {
    const result = await prisma.cardVariant.groupBy({
      by: ["setId", "programId", "cardNumber"],
      where: {
        setId: { in: candidateSetIds },
        cardNumber: normalizedCardNumber,
        ...(programId ? { programId } : {}),
      },
      _count: {
        _all: true,
      },
      orderBy: [{ setId: "asc" }, { programId: "asc" }, { cardNumber: "asc" }],
      take: 60,
    });
    return result as LegacyVariantGroupRow[];
  };

  let rows: LegacyVariantGroupRow[] = await findLegacyRows(normalizedProgram);
  if (rows.length < 1 && normalizedProgram) {
    rows = await findLegacyRows(null);
  }
  if (rows.length < 1) {
    return {
      matched: false,
      source: "legacy_variant",
      reason: "legacy_card_number_not_found_in_scope",
      candidateSetIds,
      candidateCount: 0,
      setId: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
    };
  }

  const programKeys = Array.from(new Set(rows.map((row) => `${row.setId}::${row.programId}`)));
  const programs = programKeys.length
    ? await prisma.setProgram.findMany({
        where: {
          OR: programKeys.map((entry) => {
            const [setId, programId] = entry.split("::");
            return { setId, programId };
          }),
        },
        select: {
          setId: true,
          programId: true,
          label: true,
        },
      })
    : [];
  const programLabelByKey = new Map(programs.map((program) => [`${program.setId}::${program.programId}`, program.label]));

  const insertKey = normalizeVariantLabelKey(fields.insertSet || "");
  const setKey = normalizeLooseLookupKey(fields.setName);
  const scored = rows
    .map((row) => {
      const rowProgramLabel = programLabelByKey.get(`${row.setId}::${row.programId}`) ?? null;
      const rowProgramKey = normalizeVariantLabelKey(rowProgramLabel || row.programId || "");
      const rowSetKey = normalizeLooseLookupKey(row.setId);
      let score = selectedSetId && row.setId === selectedSetId ? 3 : 1;
      if (insertKey && rowProgramKey) {
        if (rowProgramKey === insertKey) {
          score += 4;
        } else if (rowProgramKey.includes(insertKey) || insertKey.includes(rowProgramKey)) {
          score += 2;
        }
      }
      if (setKey && rowSetKey && rowSetKey === setKey) {
        score += 1.5;
      }
      score += Math.min(1.2, Math.max(0, Number(row._count?._all ?? 0) - 1) * 0.15);
      return {
        row,
        programLabel: rowProgramLabel,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.row.setId.localeCompare(b.row.setId) || a.row.programId.localeCompare(b.row.programId));

  const best = scored[0] ?? null;
  const runnerUp = scored[1] ?? null;
  const uniqueSetIds = Array.from(new Set(rows.map((row) => row.setId)));
  const hasUniqueSet = uniqueSetIds.length === 1;
  const strongBest = Boolean(best && (!runnerUp || best.score - runnerUp.score >= 1.2));
  if (!best || (!hasUniqueSet && !strongBest)) {
    return {
      matched: false,
      source: "legacy_variant",
      reason: hasUniqueSet ? "legacy_unresolved_best_candidate" : "legacy_ambiguous_card_number_scope",
      candidateSetIds,
      candidateCount: rows.length,
      setId: best?.row.setId ?? null,
      programId: best?.row.programId ?? null,
      programLabel: best?.programLabel ?? null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
      score: best?.score,
      runnerUpScore: runnerUp?.score ?? null,
    };
  }

  return {
    matched: true,
    source: "legacy_variant",
    reason: hasUniqueSet ? "legacy_single_set_card_match" : "legacy_scored_card_match",
    candidateSetIds,
    candidateCount: rows.length,
    setId: best.row.setId,
    programId: best.row.programId,
    programLabel: best.programLabel ?? null,
    cardNumber: normalizedCardNumber,
    playerName: null,
    teamName: null,
    score: best.score,
    runnerUpScore: runnerUp?.score ?? null,
  };
}

async function resolveScopedSetCard(params: {
  fields: SuggestionFields;
  queryHints: {
    year: string | null;
    manufacturer: string | null;
    sport: string | null;
    game: string | null;
    productLine: string | null;
    setId: string | null;
    layoutClass: string | null;
  };
}): Promise<SetCardResolutionAudit> {
  const year = sanitizeText(params.queryHints.year || params.fields.year || "");
  const manufacturer = sanitizeText(params.queryHints.manufacturer || params.fields.manufacturer || "");
  const sport = sanitizeText(params.queryHints.sport || params.fields.sport || "") || null;
  const normalizedCardNumber = normalizeTaxonomyCardNumber(params.fields.cardNumber);
  if (!year || !manufacturer) {
    return {
      matched: false,
      source: "set_card",
      reason: "missing_scope_hints",
      candidateSetIds: [],
      candidateCount: 0,
      setId: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
    };
  }
  if (!normalizedCardNumber || normalizedCardNumber === "ALL") {
    return {
      matched: false,
      source: "set_card",
      reason: "missing_card_number",
      candidateSetIds: [],
      candidateCount: 0,
      setId: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
    };
  }

  const pool = await loadVariantOptionPool({
    year,
    manufacturer,
    sport,
    productLine: sanitizeText(params.queryHints.productLine || "") || null,
    setId: sanitizeText(params.queryHints.setId || "") || null,
  });
  const candidateSetIds = (pool.selectedSetId ? [pool.selectedSetId] : pool.scopedSetIds).filter(Boolean);
  if (candidateSetIds.length < 1) {
    return {
      matched: false,
      source: "set_card",
      reason: "no_scoped_sets",
      candidateSetIds: [],
      candidateCount: 0,
      setId: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
    };
  }

  const rows = await prisma.setCard.findMany({
    where: {
      setId: { in: candidateSetIds },
      cardNumber: normalizedCardNumber,
      ...publishedTaxonomyWhereInput(),
    },
    select: {
      setId: true,
      programId: true,
      cardNumber: true,
      playerName: true,
      team: true,
    },
    take: 50,
  });

  if (rows.length < 1) {
    const legacyFallback = await resolveScopedLegacyVariantCard({
      candidateSetIds,
      selectedSetId: pool.selectedSetId ?? null,
      fields: params.fields,
      normalizedCardNumber,
    });
    if (legacyFallback.matched) {
      return legacyFallback;
    }
    return {
      matched: false,
      source: "set_card",
      reason: legacyFallback.reason === "legacy_card_number_not_found_in_scope" ? "card_number_not_found_in_scope" : legacyFallback.reason,
      candidateSetIds,
      candidateCount: legacyFallback.candidateCount,
      setId: legacyFallback.setId,
      programId: legacyFallback.programId,
      programLabel: legacyFallback.programLabel,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
      score: legacyFallback.score,
      runnerUpScore: legacyFallback.runnerUpScore ?? null,
    };
  }

  const programKeys = Array.from(new Set(rows.map((row) => `${row.setId}::${row.programId}`)));
  const programs = programKeys.length
    ? await prisma.setProgram.findMany({
        where: {
          OR: programKeys.map((entry) => {
            const [setId, programId] = entry.split("::");
            return { setId, programId };
          }),
          ...publishedSetProgramWhereInput(),
        },
        select: {
          setId: true,
          programId: true,
          label: true,
        },
      })
    : [];
  const programLabelByKey = new Map(programs.map((program) => [`${program.setId}::${program.programId}`, program.label]));

  const playerKey = normalizeLooseLookupKey(params.fields.playerName);
  const teamKey = normalizeLooseLookupKey(params.fields.teamName);
  const insertKey = normalizeVariantLabelKey(params.fields.insertSet || "");
  const setKey = normalizeLooseLookupKey(params.fields.setName);

  const scored = rows
    .map((row) => {
      const rowPlayerKey = normalizeLooseLookupKey(row.playerName);
      const rowTeamKey = normalizeLooseLookupKey(row.team);
      const rowProgramLabel = programLabelByKey.get(`${row.setId}::${row.programId}`) ?? null;
      const rowProgramKey = normalizeVariantLabelKey(rowProgramLabel || row.programId || "");
      let score = pool.selectedSetId && row.setId === pool.selectedSetId ? 3 : 1;
      if (playerKey && rowPlayerKey) {
        if (rowPlayerKey === playerKey) {
          score += 5;
        } else if (rowPlayerKey.includes(playerKey) || playerKey.includes(rowPlayerKey)) {
          score += 2.5;
        }
      }
      if (teamKey && rowTeamKey && rowTeamKey === teamKey) {
        score += 2;
      }
      if (insertKey && rowProgramKey && rowProgramKey === insertKey) {
        score += 3.5;
      }
      if (setKey) {
        const rowSetKey = normalizeLooseLookupKey(row.setId);
        if (rowSetKey && rowSetKey === setKey) {
          score += 2;
        }
      }
      return {
        row,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.row.setId.localeCompare(b.row.setId) || a.row.programId.localeCompare(b.row.programId));

  const best = scored[0] ?? null;
  const runnerUp = scored[1] ?? null;
  const uniqueSetIds = Array.from(new Set(rows.map((row) => row.setId)));
  const hasUniqueSet = uniqueSetIds.length === 1;
  const strongBest = Boolean(best && (!runnerUp || best.score - runnerUp.score >= 1.5));
  if (!best || (!hasUniqueSet && !strongBest)) {
    const legacyFallback = await resolveScopedLegacyVariantCard({
      candidateSetIds,
      selectedSetId: pool.selectedSetId ?? null,
      fields: params.fields,
      normalizedCardNumber,
    });
    if (legacyFallback.matched) {
      return legacyFallback;
    }
    return {
      matched: false,
      source: "set_card",
      reason: legacyFallback.reason.startsWith("legacy_")
        ? legacyFallback.reason
        : hasUniqueSet
        ? "unresolved_best_candidate"
        : "ambiguous_card_number_scope",
      candidateSetIds,
      candidateCount: rows.length,
      setId: best?.row.setId ?? null,
      programId: best?.row.programId ?? null,
      programLabel: best ? (programLabelByKey.get(`${best.row.setId}::${best.row.programId}`) ?? null) : null,
      cardNumber: best?.row.cardNumber ?? normalizedCardNumber,
      playerName: best?.row.playerName ?? null,
      teamName: best?.row.team ?? null,
      score: best?.score,
      runnerUpScore: runnerUp?.score ?? null,
    };
  }

  return {
    matched: true,
    source: "set_card",
    reason: hasUniqueSet ? "single_set_card_match" : "scored_card_match",
    candidateSetIds,
    candidateCount: rows.length,
    setId: best.row.setId,
    programId: best.row.programId,
    programLabel: programLabelByKey.get(`${best.row.setId}::${best.row.programId}`) ?? null,
    cardNumber: best.row.cardNumber,
    playerName: best.row.playerName ?? null,
    teamName: best.row.team ?? null,
    score: best.score,
    runnerUpScore: runnerUp?.score ?? null,
  };
}

function parseOcrReasoningEffort(rawValue: string | undefined): OcrLlmReasoningEffort {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (!normalized) {
    return "none";
  }
  if (normalized === "minimal") {
    return "low";
  }
  if (OCR_LLM_REASONING_VALUES.has(normalized as OcrLlmReasoningEffort)) {
    return normalized as OcrLlmReasoningEffort;
  }
  return "none";
}

function isReasoningEffortRejected(status: number, bodyText: string): boolean {
  if (status !== 400) {
    return false;
  }
  const normalized = String(bodyText || "").toLowerCase();
  if (!normalized.includes("reasoning")) {
    return false;
  }
  return (
    normalized.includes("effort") ||
    normalized.includes("unsupported") ||
    normalized.includes("invalid") ||
    normalized.includes("must be")
  );
}

function limitCandidateList(values: string[], limit: number): string[] {
  return Array.from(new Set(values.map((entry) => sanitizeText(entry)).filter(Boolean))).slice(0, limit);
}

function buildTaxonomyPromptCandidates(params: {
  setOptions: string[];
  insertOptions: string[];
  parallelOptions: string[];
}): TaxonomyPromptCandidates {
  return {
    setOptions: limitCandidateList(params.setOptions, 80),
    insertOptions: limitCandidateList(params.insertOptions, 140),
    parallelOptions: limitCandidateList(params.parallelOptions, 160),
  };
}

function parseLlmJsonPayload(raw: string): LlmParsedPayload | null {
  const candidates = [raw.trim()];
  const unwrappedFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (unwrappedFence && unwrappedFence !== candidates[0]) {
    candidates.push(unwrappedFence);
  }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = raw.slice(firstBrace, lastBrace + 1).trim();
    if (sliced && !candidates.includes(sliced)) {
      candidates.push(sliced);
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        fields?: Record<string, unknown>;
        confidence?: Record<string, unknown>;
      };
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      const fields = {} as SuggestionFields;
      const confidence = {} as SuggestionConfidence;

      FIELD_KEYS.forEach((key) => {
        fields[key] = coerceNullableString(parsed.fields?.[key]);
        confidence[key] = coerceConfidence(parsed.confidence?.[key]);
      });

      return { fields, confidence };
    } catch {
      continue;
    }
  }

  return null;
}

function extractResponsesOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const typed = payload as {
    output_text?: unknown;
    output?: Array<{ content?: unknown }>;
  };
  if (typeof typed.output_text === "string" && typed.output_text.trim()) {
    return typed.output_text.trim();
  }
  if (Array.isArray(typed.output_text)) {
    const direct = typed.output_text
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (direct) {
      return direct;
    }
  }
  if (!Array.isArray(typed.output)) {
    return null;
  }
  const chunks: string[] = [];
  typed.output.forEach((entry) => {
    const content = Array.isArray(entry?.content) ? entry.content : [];
    content.forEach((part: any) => {
      if (typeof part?.text === "string" && part.text.trim()) {
        chunks.push(part.text.trim());
      }
      if (typeof part?.output_text === "string" && part.output_text.trim()) {
        chunks.push(part.output_text.trim());
      }
    });
  });
  if (!chunks.length) {
    return null;
  }
  return chunks.join("\n").trim();
}

async function parseWithLlm(
  params: {
    ocrText: string;
    imageSections: OcrImageSection[];
    taxonomyCandidates: TaxonomyPromptCandidates;
    mode: "text" | "multimodal";
    detail: "low" | "high" | null;
    images?: LlmImageInput[];
  }
): Promise<LlmParseResponse | null> {
  const { ocrText, imageSections, taxonomyCandidates, mode, detail } = params;
  const images = Array.isArray(params.images) ? params.images : [];
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }
  if (!ocrText.trim()) {
    return null;
  }
  if (mode === "multimodal" && images.length < 1) {
    return null;
  }

  const schemaProperties: Record<string, unknown> = {};
  FIELD_KEYS.forEach((key) => {
    schemaProperties[key] = { type: ["string", "null"] };
  });
  const confidenceProperties: Record<string, unknown> = {};
  FIELD_KEYS.forEach((key) => {
    confidenceProperties[key] = { type: ["number", "null"], minimum: 0, maximum: 1 };
  });

  const labeledSections =
    imageSections.length > 0
      ? imageSections.map((section) => `[${section.id}]\n${section.text}`).join("\n\n")
      : "No per-image OCR sections provided.";

  const taxonomyRules = [
    "Taxonomy constraints:",
    `- setName must be one of the provided set options or null.`,
    `- insertSet must be one of the provided insert options or null.`,
    `- parallel must be one of the provided parallel options or null.`,
    `- Never invent taxonomy labels outside the candidate lists.`,
  ].join("\n");

  const taxonomyCandidateBlock = [
    "Candidate set options:",
    taxonomyCandidates.setOptions.length > 0 ? taxonomyCandidates.setOptions.join(" | ") : "(none)",
    "",
    "Candidate insert options:",
    taxonomyCandidates.insertOptions.length > 0 ? taxonomyCandidates.insertOptions.join(" | ") : "(none)",
    "",
    "Candidate parallel options:",
    taxonomyCandidates.parallelOptions.length > 0 ? taxonomyCandidates.parallelOptions.join(" | ") : "(none)",
  ].join("\n");

  const imageAttachmentContext =
    mode === "multimodal" && images.length > 0
      ? `Attached images (in order): ${images.map((entry) => entry.id).join(", ")}.`
      : "No images attached to this request.";

  const systemInstruction = [
    "Extract card metadata from OCR text.",
    "Return only JSON that matches the schema.",
    "Use null for unknown fields.",
    mode === "multimodal"
      ? "Use the attached card images together with OCR text when OCR is ambiguous."
      : "Use OCR text only.",
    taxonomyRules,
  ].join("\n");
  const userPrompt = `OCR combined text:\n${ocrText}\n\nOCR by photo:\n${labeledSections}\n\n${imageAttachmentContext}\n\n${taxonomyCandidateBlock}`;
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["fields", "confidence"],
    properties: {
      fields: {
        type: "object",
        additionalProperties: false,
        required: FIELD_KEYS,
        properties: schemaProperties,
      },
      confidence: {
        type: "object",
        additionalProperties: false,
        required: FIELD_KEYS,
        properties: confidenceProperties,
      },
    },
  };

  const lastAttemptMetaRef: {
    current: {
      requestId: string | null;
      clientRequestId: string | null;
      reasoningEffort: OcrLlmReasoningEffort | null;
      imageUrlMode: "string" | "object" | null;
      reasoningRetried: boolean;
    } | null;
  } = { current: null };

  const callResponses = async (params: {
    model: string;
    format: "json_schema" | "json_object";
  }): Promise<{
    ok: boolean;
    status: number;
    bodyText: string;
    parsed: LlmParsedPayload | null;
  }> => {
    const buildUserContent = (
      imageUrlMode: "string" | "object"
    ): Array<Record<string, unknown>> => {
      const userContent: Array<Record<string, unknown>> = [{ type: "input_text", text: userPrompt }];
      if (mode === "multimodal" && images.length > 0) {
        images.forEach((image) => {
          userContent.push({ type: "input_text", text: `Attached card image side: ${image.id}` });
          if (imageUrlMode === "object") {
            userContent.push({
              type: "input_image",
              image_url: {
                url: image.url,
                detail: detail ?? "low",
              },
            });
          } else {
            userContent.push({
              type: "input_image",
              image_url: image.url,
              detail: detail ?? "low",
            });
          }
        });
      }
      return userContent;
    };

    type HttpAttemptResult = {
      ok: boolean;
      status: number;
      bodyText: string;
      requestId: string | null;
      clientRequestId: string;
      reasoningEffort: OcrLlmReasoningEffort | null;
      imageUrlMode: "string" | "object";
      reasoningRetried: boolean;
    };

    const executeRequest = async (
      imageUrlMode: "string" | "object",
      includeReasoning: boolean
    ): Promise<HttpAttemptResult> => {
      const userContent = buildUserContent(imageUrlMode);
      const controller = new AbortController();
      const timeoutMs = mode === "multimodal" ? 22000 : 15000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const clientRequestId = `ocr-${crypto.randomUUID()}`;
      const requestBody: Record<string, unknown> = {
        model: params.model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemInstruction }],
          },
          {
            role: "user",
            content: userContent,
          },
        ],
        text:
          params.format === "json_schema"
            ? {
                format: {
                  type: "json_schema",
                  name: "card_ocr_parse",
                  strict: true,
                  schema,
                },
              }
            : {
                format: {
                  type: "json_object",
                },
              },
      };
      if (includeReasoning) {
        requestBody.reasoning = { effort: OCR_LLM_REASONING_EFFORT };
      }
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "X-Client-Request-Id": clientRequestId,
          },
          signal: controller.signal,
          body: JSON.stringify(requestBody),
        });
        const bodyText = await response.text().catch(() => "");
        return {
          ok: response.ok,
          status: response.status,
          bodyText,
          requestId: response.headers.get("x-request-id"),
          clientRequestId,
          reasoningEffort: includeReasoning ? OCR_LLM_REASONING_EFFORT : null,
          imageUrlMode,
          reasoningRetried: false,
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          bodyText: error instanceof Error ? error.message : "responses_call_failed",
          requestId: null,
          clientRequestId,
          reasoningEffort: includeReasoning ? OCR_LLM_REASONING_EFFORT : null,
          imageUrlMode,
          reasoningRetried: false,
        };
      } finally {
        clearTimeout(timeout);
      }
    };

    const executeCompatibleRequest = async (imageUrlMode: "string" | "object"): Promise<HttpAttemptResult> => {
      const firstAttempt = await executeRequest(imageUrlMode, true);
      if (firstAttempt.ok || !isReasoningEffortRejected(firstAttempt.status, firstAttempt.bodyText)) {
        return firstAttempt;
      }
      const retryAttempt = await executeRequest(imageUrlMode, false);
      return {
        ...retryAttempt,
        reasoningRetried: true,
      };
    };

    let httpResult = await executeCompatibleRequest("string");
    if (!httpResult.ok && mode === "multimodal" && httpResult.status === 400) {
      httpResult = await executeCompatibleRequest("object");
    }
    lastAttemptMetaRef.current = {
      requestId: httpResult.requestId,
      clientRequestId: httpResult.clientRequestId,
      reasoningEffort: httpResult.reasoningEffort,
      imageUrlMode: httpResult.imageUrlMode,
      reasoningRetried: httpResult.reasoningRetried,
    };

    if (!httpResult.ok) {
      return {
        ok: false,
        status: httpResult.status,
        bodyText: httpResult.bodyText,
        parsed: null,
      };
    }

    let payload: unknown = null;
    try {
      payload = httpResult.bodyText ? JSON.parse(httpResult.bodyText) : null;
    } catch {
      payload = null;
    }
    const content = extractResponsesOutputText(payload);
    if (!content) {
      return {
        ok: true,
        status: httpResult.status,
        bodyText: httpResult.bodyText,
        parsed: null,
      };
    }
    return {
      ok: true,
      status: httpResult.status,
      bodyText: httpResult.bodyText,
      parsed: parseLlmJsonPayload(content),
    };
  };

  const resolved = await resolveOcrLlmAttempt<LlmParsedPayload>({
    primaryModel: OCR_LLM_MODEL,
    fallbackModel: OCR_LLM_FALLBACK_MODEL,
    execute: callResponses,
  });

  if (!resolved) {
    console.warn("OCR LLM parse returned no usable JSON", {
      primaryModel: OCR_LLM_MODEL,
      fallbackModel: OCR_LLM_FALLBACK_MODEL,
    });
    return null;
  }

  return {
    ...resolved.parsed,
    meta: {
      endpoint: "responses",
      model: resolved.attempt.model,
      format: resolved.attempt.format,
      fallbackUsed: resolved.fallbackUsed,
      mode,
      detail: mode === "multimodal" ? detail ?? "low" : null,
      requestId: lastAttemptMetaRef.current?.requestId ?? null,
      clientRequestId: lastAttemptMetaRef.current?.clientRequestId ?? null,
      reasoningEffort: lastAttemptMetaRef.current?.reasoningEffort ?? null,
      imageUrlMode: lastAttemptMetaRef.current?.imageUrlMode ?? null,
      reasoningRetried: lastAttemptMetaRef.current?.reasoningRetried ?? false,
    },
  };
}

function applyLlmParsedPayload(params: {
  targetFields: SuggestionFields;
  targetConfidence: SuggestionConfidence;
  parsed: LlmParseResponse;
}) {
  const { targetFields, targetConfidence, parsed } = params;
  FIELD_KEYS.forEach((key) => {
    const nextValue = parsed.fields[key];
    if (!nextValue) {
      return;
    }
    const nextConfidence = parsed.confidence[key] ?? 0.85;
    const currentValue = targetFields[key];
    const currentConfidence = targetConfidence[key] ?? 0;
    const sameValue =
      !!currentValue && currentValue.trim().toLowerCase() === nextValue.trim().toLowerCase();
    if (!currentValue || sameValue || nextConfidence >= currentConfidence) {
      targetFields[key] = nextValue;
      targetConfidence[key] = Math.max(currentConfidence, nextConfidence);
    }
  });
}

function buildMultimodalDecision(params: {
  fields: SuggestionFields;
  confidence: SuggestionConfidence;
  taxonomyCandidates: TaxonomyPromptCandidates;
  images: LlmImageInput[];
  llmTextParsed: boolean;
}): MultimodalDecision {
  const { fields, confidence, taxonomyCandidates, images, llmTextParsed } = params;
  const reasons: string[] = [];
  if (images.length < 1) {
    return { useMultimodal: false, detail: "low", reasons };
  }

  const setThreshold = TAXONOMY_FIELD_THRESHOLD.setName;
  const insertThreshold = TAXONOMY_FIELD_THRESHOLD.insertSet;
  const parallelThreshold = TAXONOMY_FIELD_THRESHOLD.parallel;
  const setReady = Boolean(fields.setName && (confidence.setName ?? 0) >= setThreshold);
  const insertReady = Boolean(fields.insertSet && (confidence.insertSet ?? 0) >= insertThreshold);
  const parallelReady = Boolean(fields.parallel && (confidence.parallel ?? 0) >= parallelThreshold);

  const setCandidates = taxonomyCandidates.setOptions.length;
  const insertCandidates = taxonomyCandidates.insertOptions.length;
  const parallelCandidates = taxonomyCandidates.parallelOptions.length;
  const hasTaxonomyPool = setCandidates > 0 || insertCandidates > 0 || parallelCandidates > 0;

  if (!llmTextParsed) {
    reasons.push("text_parse_failed");
  }
  if (setCandidates > 0 && !setReady) {
    reasons.push("set_uncertain");
  }
  if (insertCandidates > 0 && !insertReady) {
    reasons.push("insert_uncertain");
  }
  if (parallelCandidates > 0 && !parallelReady) {
    reasons.push("parallel_uncertain");
  }
  const playerConfidence = confidence.playerName ?? 0;
  const cardNumberConfidence = confidence.cardNumber ?? 0;
  if ((!fields.playerName || playerConfidence < 0.68) && (!fields.cardNumber || cardNumberConfidence < 0.68)) {
    reasons.push("core_fields_uncertain");
  }

  if (!hasTaxonomyPool && !reasons.includes("text_parse_failed")) {
    return { useMultimodal: false, detail: "low", reasons: [] };
  }
  if (reasons.length < 1) {
    return { useMultimodal: false, detail: "low", reasons };
  }

  const severeReason =
    reasons.includes("text_parse_failed") || reasons.includes("core_fields_uncertain");
  const taxonomyUncertainCount = ["set_uncertain", "insert_uncertain", "parallel_uncertain"].filter((key) =>
    reasons.includes(key)
  ).length;

  // Avoid expensive multimodal retries when only one taxonomy field is uncertain.
  if (!severeReason && taxonomyUncertainCount < 2) {
    return {
      useMultimodal: false,
      detail: "low",
      reasons,
    };
  }

  const detail: "low" | "high" =
    severeReason ||
    (reasons.includes("set_uncertain") && setCandidates >= 4) ||
    taxonomyUncertainCount >= 2
      ? "high"
      : "low";

  return {
    useMultimodal: true,
    detail,
    reasons,
  };
}

function normalizeImageLabel(value: string | null | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "UNKNOWN";
  }
  if (normalized === "front" || normalized === "back" || normalized === "tilt") {
    return normalized.toUpperCase();
  }
  return normalized.toUpperCase();
}

function normalizeTeachTargetField(value: string | null | undefined): keyof SuggestionFields | null {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  const direct = normalized as keyof SuggestionFields;
  if (FIELD_KEYS.includes(direct)) {
    return direct;
  }
  const lower = normalized.toLowerCase();
  const matched = FIELD_KEYS.find((key) => key.toLowerCase() === lower);
  return matched ?? null;
}

function isTruthyString(value: string | null | undefined): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return TRUE_STRINGS.has(normalized);
}

function normalizeMemoryToken(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function parseMemoryTokenRefs(raw: unknown): MemoryTokenRef[] {
  return parseOcrFeedbackTokenRefs(raw);
}

function buildMemoryTokenLookup(tokens: OcrTokenEntry[]): MemoryTokenLookup {
  const global = new Set<string>();
  const byImage = new Map<string, Set<string>>();
  tokens.forEach((token) => {
    const normalized = normalizeMemoryToken(token.text);
    if (!normalized) {
      return;
    }
    global.add(normalized);
    const imageId = normalizeImageLabel(token.imageId);
    if (!byImage.has(imageId)) {
      byImage.set(imageId, new Set());
    }
    byImage.get(imageId)?.add(normalized);
  });
  return { global, byImage };
}

function emptyRegionTemplateMap(): RegionTemplateMap {
  return {
    FRONT: [],
    BACK: [],
    TILT: [],
  };
}

function emptyRegionCountBySide(): Record<OcrRegionPhotoSide, number> {
  return {
    FRONT: 0,
    BACK: 0,
    TILT: 0,
  };
}

function buildGlobalProductSetFallbackTemplates(): RegionTemplateMap {
  return {
    FRONT: [],
    BACK: [
      {
        x: 0.04,
        y: 0.84,
        width: 0.92,
        height: 0.14,
        label: "Global Product Set Fallback",
        targetField: "setName",
      },
    ],
    TILT: [],
  };
}

function mergeRegionTemplateMaps(...maps: RegionTemplateMap[]): RegionTemplateMap {
  const merged = emptyRegionTemplateMap();
  maps.forEach((map) => {
    (["FRONT", "BACK", "TILT"] as OcrRegionPhotoSide[]).forEach((side) => {
      const regions = Array.isArray(map[side]) ? map[side] : [];
      if (regions.length > 0) {
        merged[side] = [...merged[side], ...regions];
      }
    });
  });
  return merged;
}

function buildRegionBoundsByImage(tokens: OcrTokenEntry[]) {
  const boundsByImage = new Map<string, { maxX: number; maxY: number }>();
  tokens.forEach((token) => {
    const imageId = normalizeImageLabel(token.imageId);
    const points = Array.isArray(token.bbox) ? token.bbox : [];
    if (!points.length) {
      return;
    }
    let maxX = 0;
    let maxY = 0;
    points.forEach((point) => {
      if (typeof point?.x === "number" && Number.isFinite(point.x)) {
        maxX = Math.max(maxX, point.x);
      }
      if (typeof point?.y === "number" && Number.isFinite(point.y)) {
        maxY = Math.max(maxY, point.y);
      }
    });
    if (maxX <= 0 || maxY <= 0) {
      return;
    }
    const current = boundsByImage.get(imageId);
    if (!current) {
      boundsByImage.set(imageId, { maxX, maxY });
      return;
    }
    current.maxX = Math.max(current.maxX, maxX);
    current.maxY = Math.max(current.maxY, maxY);
  });
  return boundsByImage;
}

function matchTokenRegions(
  token: OcrTokenEntry,
  templatesBySide: RegionTemplateMap,
  boundsByImage: Map<string, { maxX: number; maxY: number }>
) {
  const imageId = normalizeImageLabel(token.imageId);
  const side = imageId as OcrRegionPhotoSide;
  const regions = templatesBySide[side] ?? [];
  if (!regions.length) {
    return {
      imageId,
      matchedRegions: [] as OcrRegionRect[],
    };
  }
  const points = Array.isArray(token.bbox) ? token.bbox : [];
  if (!points.length) {
    return {
      imageId,
      matchedRegions: [] as OcrRegionRect[],
    };
  }
  const bounds = boundsByImage.get(imageId);
  if (!bounds || bounds.maxX <= 0 || bounds.maxY <= 0) {
    return {
      imageId,
      matchedRegions: [] as OcrRegionRect[],
    };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = 0;
  points.forEach((point) => {
    if (typeof point?.x === "number" && Number.isFinite(point.x)) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
    }
    if (typeof point?.y === "number" && Number.isFinite(point.y)) {
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  });
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) {
    return {
      imageId,
      matchedRegions: [] as OcrRegionRect[],
    };
  }
  const centerX = ((minX + maxX) / 2) / bounds.maxX;
  const centerY = ((minY + maxY) / 2) / bounds.maxY;
  return {
    imageId,
    matchedRegions: regions.filter(
      (region) =>
        centerX >= region.x &&
        centerX <= region.x + region.width &&
        centerY >= region.y &&
        centerY <= region.y + region.height
    ),
  };
}

function applyRegionTemplateValueHints(params: {
  fields: SuggestionFields;
  confidence: SuggestionConfidence;
  tokens: OcrTokenEntry[];
  templatesBySide: RegionTemplateMap;
}) {
  const { fields, confidence, tokens, templatesBySide } = params;
  const boundsByImage = buildRegionBoundsByImage(tokens);
  const countsByFieldValue = new Map<string, { field: keyof SuggestionFields; value: string; hits: number }>();

  tokens.forEach((token) => {
    const { matchedRegions } = matchTokenRegions(token, templatesBySide, boundsByImage);
    if (!matchedRegions.length) {
      return;
    }
    matchedRegions.forEach((region) => {
      const targetField = normalizeTeachTargetField(region.targetField);
      const targetValue = coerceNullableString(region.targetValue);
      if (!targetField || !targetValue) {
        return;
      }
      const key = `${targetField}::${targetValue.toLowerCase()}`;
      const current = countsByFieldValue.get(key);
      if (current) {
        current.hits += 1;
      } else {
        countsByFieldValue.set(key, {
          field: targetField,
          value: targetValue,
          hits: 1,
        });
      }
    });
  });

  const bestByField = new Map<keyof SuggestionFields, { value: string; hits: number }>();
  countsByFieldValue.forEach((entry) => {
    const current = bestByField.get(entry.field);
    if (!current || entry.hits > current.hits) {
      bestByField.set(entry.field, { value: entry.value, hits: entry.hits });
    }
  });

  const applied: MemoryApplyEntry[] = [];
  bestByField.forEach((entry, field) => {
    const currentValue = coerceNullableString(fields[field]);
    const currentConfidence = confidence[field] ?? 0;
    if (currentValue && currentValue.toLowerCase() !== entry.value.toLowerCase() && currentConfidence >= 0.97) {
      return;
    }
    fields[field] = entry.value;
    confidence[field] = Math.max(currentConfidence, 0.97);
    applied.push({
      field,
      value: entry.value,
      confidence: 0.97,
      support: entry.hits,
    });
  });

  return applied;
}

function buildRegionTokenLookup(tokens: OcrTokenEntry[], templatesBySide: RegionTemplateMap): RegionTokenLookup {
  const global = new Set<string>();
  const byImage = new Map<string, Set<string>>();
  const byFieldGlobal = new Map<keyof SuggestionFields, Set<string>>();
  const byFieldImage = new Map<keyof SuggestionFields, Map<string, Set<string>>>();
  const boundsByImage = buildRegionBoundsByImage(tokens);

  tokens.forEach((token) => {
    const normalized = normalizeMemoryToken(token.text);
    if (!normalized) {
      return;
    }
    const { imageId, matchedRegions } = matchTokenRegions(token, templatesBySide, boundsByImage);
    if (!matchedRegions.length) {
      return;
    }
    global.add(normalized);
    if (!byImage.has(imageId)) {
      byImage.set(imageId, new Set());
    }
    byImage.get(imageId)?.add(normalized);
    matchedRegions.forEach((region) => {
      const targetField = normalizeTeachTargetField(region.targetField);
      if (!targetField) {
        return;
      }
      if (!byFieldGlobal.has(targetField)) {
        byFieldGlobal.set(targetField, new Set());
      }
      byFieldGlobal.get(targetField)?.add(normalized);
      if (!byFieldImage.has(targetField)) {
        byFieldImage.set(targetField, new Map());
      }
      const fieldImageMap = byFieldImage.get(targetField)!;
      if (!fieldImageMap.has(imageId)) {
        fieldImageMap.set(imageId, new Set());
      }
      fieldImageMap.get(imageId)?.add(normalized);
    });
  });

  return { global, byImage, byFieldGlobal, byFieldImage };
}

function scoreTokenRefSupport(
  refs: MemoryTokenRef[],
  lookup: MemoryTokenLookup,
  regionLookup: RegionTokenLookup,
  expectedField?: keyof SuggestionFields
): TokenRefSupport | null {
  if (!refs.length) {
    return null;
  }
  let matchedWeight = 0;
  let totalWeight = 0;
  let regionMatchedWeight = 0;
  refs.forEach((ref) => {
    const normalized = normalizeMemoryToken(ref.text);
    if (!normalized) {
      return;
    }
    const weight = typeof ref.weight === "number" && Number.isFinite(ref.weight) && ref.weight > 0 ? ref.weight : 1;
    totalWeight += weight;
    const expectedImage = normalizeImageLabel(ref.imageId);
    const inExpected = lookup.byImage.get(expectedImage)?.has(normalized) ?? false;
    const inGlobal = lookup.global.has(normalized);
    if (inExpected || inGlobal) {
      matchedWeight += weight;
      const fieldImageMap = expectedField ? regionLookup.byFieldImage.get(expectedField) : null;
      const inRegionExpectedField = fieldImageMap?.get(expectedImage)?.has(normalized) ?? false;
      const inRegionGlobalField = expectedField
        ? regionLookup.byFieldGlobal.get(expectedField)?.has(normalized) ?? false
        : false;
      const inRegionExpectedAny = regionLookup.byImage.get(expectedImage)?.has(normalized) ?? false;
      const inRegionGlobalAny = regionLookup.global.has(normalized);
      const inRegionExpected = inRegionExpectedField || inRegionExpectedAny;
      const inRegionGlobal = inRegionGlobalField || inRegionGlobalAny;
      if (inRegionExpected || inRegionGlobal) {
        regionMatchedWeight += weight;
      }
    }
  });
  if (totalWeight <= 0 || matchedWeight <= 0) {
    return { support: 0, regionOverlap: 0 };
  }
  const support = matchedWeight / totalWeight;
  const regionOverlap = regionMatchedWeight <= 0 ? 0 : Math.min(1, regionMatchedWeight / matchedWeight);
  return {
    support,
    regionOverlap,
  };
}

function buildPhotoOcrState(params: {
  frontImageUrl: string | null;
  backImageUrl: string | null;
  tiltImageUrl: string | null;
  results: Array<{ id: string | null; text: string; tokenCount: number }>;
}) {
  const resultById = new Map<OcrPhotoId, { text: string; tokenCount: number; sourceImageId: string | null }>();
  params.results.forEach((result) => {
    const normalizedId = normalizeImageLabel(result.id);
    if (normalizedId !== "FRONT" && normalizedId !== "BACK" && normalizedId !== "TILT") {
      return;
    }
    resultById.set(normalizedId, {
      text: result.text.trim(),
      tokenCount: result.tokenCount,
      sourceImageId: result.id,
    });
  });

  const byId = OCR_PHOTO_IDS.reduce<Record<OcrPhotoId, PhotoOcrState>>((acc, id) => {
    const hasImage =
      id === "FRONT"
        ? Boolean(params.frontImageUrl)
        : id === "BACK"
        ? Boolean(params.backImageUrl)
        : Boolean(params.tiltImageUrl);
    const result = resultById.get(id);
    const text = result?.text ?? "";
    acc[id] = {
      id,
      hasImage,
      status: !hasImage ? "missing_image" : text ? "ok" : "empty_text",
      ocrText: text,
      tokenCount: result?.tokenCount ?? 0,
      sourceImageId: result?.sourceImageId ?? null,
    };
    return acc;
  }, {} as Record<OcrPhotoId, PhotoOcrState>);

  const missingRequired = REQUIRED_OCR_PHOTO_IDS.filter((id) => !byId[id].hasImage);
  const readiness =
    missingRequired.length > 0
      ? "missing_required"
      : OCR_PHOTO_IDS.every((id) => byId[id].status === "ok")
      ? "ready"
      : "partial";

  return {
    byId,
    readiness: {
      status: readiness,
      required: REQUIRED_OCR_PHOTO_IDS,
      missingRequired,
      processedCount: OCR_PHOTO_IDS.filter((id) => byId[id].status === "ok").length,
      capturedCount: OCR_PHOTO_IDS.filter((id) => byId[id].hasImage).length,
    },
  };
}

async function applyFeedbackMemoryHints(params: {
  fields: SuggestionFields;
  confidence: SuggestionConfidence;
  tokens: OcrTokenEntry[];
  regionTemplatesBySide: RegionTemplateMap;
}) {
  const { fields, confidence, tokens, regionTemplatesBySide } = params;
  const contextInput: MemoryContext = {
    setId: coerceNullableString(fields.setName),
    year: coerceNullableString(fields.year),
    manufacturer: coerceNullableString(fields.manufacturer),
    sport: coerceNullableString(fields.sport),
    cardNumber: coerceNullableString(fields.cardNumber),
    numbered: coerceNullableString(fields.numbered),
  };
  const context = buildOcrFeedbackMemoryContext(contextInput);
  const tokenLookup = buildMemoryTokenLookup(tokens);
  const regionTokenLookup = buildRegionTokenLookup(tokens, regionTemplatesBySide);

  const orClauses: Record<string, string>[] = [];
  if (context.setIdKey) orClauses.push({ setIdKey: context.setIdKey });
  if (context.cardNumberKey) orClauses.push({ cardNumberKey: context.cardNumberKey });
  if (context.yearKey) orClauses.push({ yearKey: context.yearKey });
  if (context.manufacturerKey) orClauses.push({ manufacturerKey: context.manufacturerKey });
  if (context.sportKey) orClauses.push({ sportKey: context.sportKey });
  if (orClauses.length === 0) {
    return {
      context,
      consideredRows: 0,
      applied: [] as MemoryApplyEntry[],
    };
  }

  const readAggregateRows = async () =>
    ((await (prisma as any).ocrFeedbackMemoryAggregate.findMany({
      where: {
        fieldName: { in: MEMORY_FIELD_KEYS },
        OR: orClauses,
      },
      orderBy: [{ lastSeenAt: "desc" }],
      take: 500,
      select: {
        fieldName: true,
        value: true,
        sampleCount: true,
        confidencePrior: true,
        setIdKey: true,
        yearKey: true,
        manufacturerKey: true,
        sportKey: true,
        cardNumberKey: true,
        numberedKey: true,
        tokenAnchorsJson: true,
        lastSeenAt: true,
      },
    })) as Array<{
      fieldName: string;
      value: string;
      sampleCount: number;
      confidencePrior: number;
      setIdKey: string;
      yearKey: string;
      manufacturerKey: string;
      sportKey: string;
      cardNumberKey: string;
      numberedKey: string;
      tokenAnchorsJson: unknown;
      lastSeenAt: Date;
    }>);

  let rows = await readAggregateRows();
  if (rows.length < 1) {
    const seedOrClauses: Record<string, string>[] = [];
    if (context.setId) seedOrClauses.push({ setId: context.setId });
    if (context.cardNumber) seedOrClauses.push({ cardNumber: context.cardNumber });
    if (context.year) seedOrClauses.push({ year: context.year });
    if (context.manufacturer) seedOrClauses.push({ manufacturer: context.manufacturer });
    if (context.sport) seedOrClauses.push({ sport: context.sport });

    if (seedOrClauses.length > 0) {
      const seedRows = (await (prisma as any).ocrFeedbackEvent.findMany({
        where: {
          fieldName: { in: MEMORY_FIELD_KEYS },
          OR: seedOrClauses,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 800,
        select: {
          fieldName: true,
          modelValue: true,
          humanValue: true,
          wasCorrect: true,
          setId: true,
          year: true,
          manufacturer: true,
          sport: true,
          cardNumber: true,
          numbered: true,
          tokenRefsJson: true,
        },
      })) as Array<{
        fieldName: string;
        modelValue: string | null;
        humanValue: string | null;
        wasCorrect: boolean;
        setId: string | null;
        year: string | null;
        manufacturer: string | null;
        sport: string | null;
        cardNumber: string | null;
        numbered: string | null;
        tokenRefsJson: unknown;
      }>;

      if (seedRows.length > 0) {
        await upsertOcrFeedbackMemoryAggregates(seedRows);
        rows = await readAggregateRows();
      }
    }
  }

  rows = rows as Array<{
    fieldName: string;
    value: string;
    sampleCount: number;
    confidencePrior: number;
    setIdKey: string;
    yearKey: string;
    manufacturerKey: string;
    sportKey: string;
    cardNumberKey: string;
    numberedKey: string;
    tokenAnchorsJson: unknown;
    lastSeenAt: Date;
  }>;

  type CandidateAggregate = {
    field: keyof SuggestionFields;
    value: string | null;
    clearValue: boolean;
    score: number;
    support: number;
    prior: number;
  };

  const aggregateByFieldValue = new Map<string, CandidateAggregate>();
  const nowMs = Date.now();
  rows.forEach((row) => {
    const field = row.fieldName as keyof SuggestionFields;
    if (!MEMORY_FIELD_KEYS.includes(field)) {
      return;
    }
    const storedValue = coerceNullableString(row.value);
    const clearValue = isOcrFeedbackMemoryStoredValueEmpty(storedValue);
    const humanValue = clearValue ? null : storedValue;
    if (!humanValue && !clearValue) {
      return;
    }
    if (BOOLEAN_MEMORY_FIELDS.has(field) && humanValue && !isTruthyString(humanValue) && humanValue !== "false") {
      return;
    }

    let score = 0.2;
    const rowSet = row.setIdKey;
    const rowYear = row.yearKey;
    const rowManufacturer = row.manufacturerKey;
    const rowSport = row.sportKey;
    const rowCardNumber = row.cardNumberKey;
    const rowNumbered = row.numberedKey;
    const ctxSet = context.setIdKey;
    const ctxYear = context.yearKey;
    const ctxManufacturer = context.manufacturerKey;
    const ctxSport = context.sportKey;
    const ctxCardNumber = context.cardNumberKey;
    const ctxNumbered = context.numberedKey;
    const tokenRefs = parseMemoryTokenRefs(row.tokenAnchorsJson);
    const tokenSupport = scoreTokenRefSupport(tokenRefs, tokenLookup, regionTokenLookup, field);
    const tokenSupportScore = tokenSupport?.support ?? null;
    const regionOverlap = tokenSupport?.regionOverlap ?? 0;

    if (field === "setName") {
      // Set-level memory is only allowed when year+manufacturer context is strong.
      if (!ctxYear || !ctxManufacturer) {
        return;
      }
      if (!rowYear || rowYear !== ctxYear) {
        return;
      }
      if (!rowManufacturer || rowManufacturer !== ctxManufacturer) {
        return;
      }
      if (ctxSport && rowSport && rowSport !== ctxSport) {
        return;
      }
      // If we have token anchors from the taught card, require at least weak overlap.
      if (tokenSupportScore != null && tokenSupportScore < 0.35 && regionOverlap < 0.55) {
        return;
      }
    }

    if (field === "parallel" || field === "insertSet") {
      if (!ctxSet && !ctxCardNumber) {
        return;
      }
      if (ctxSet && rowSet && rowSet !== ctxSet) {
        return;
      }
      if (ctxCardNumber && rowCardNumber && rowCardNumber !== ctxCardNumber) {
        return;
      }
      // For taxonomy replay we require explicit token overlap support.
      if (tokenSupportScore == null || (tokenSupportScore < 0.25 && regionOverlap < 0.45)) {
        return;
      }
    }

    if (ctxSet && rowSet === ctxSet) score += 2.2;
    if (ctxCardNumber && rowCardNumber === ctxCardNumber) score += 1.5;
    if (ctxYear && rowYear === ctxYear) score += 0.8;
    if (ctxManufacturer && rowManufacturer === ctxManufacturer) score += 0.9;
    if (ctxSport && rowSport === ctxSport) score += 0.9;
    if (ctxNumbered && rowNumbered === ctxNumbered) score += 0.6;
    score += Math.min(2.5, Math.max(1, row.sampleCount) * 0.22);
    score += Math.min(1.5, Math.max(0, row.confidencePrior) * 1.4);
    if (tokenSupportScore != null) {
      if (tokenSupportScore >= 0.8) score += 1.2;
      else if (tokenSupportScore >= 0.5) score += 0.7;
      else if (tokenSupportScore >= 0.35) score += 0.35;
    }
    if (regionOverlap >= 0.7) score += 1;
    else if (regionOverlap >= 0.5) score += 0.65;
    else if (regionOverlap >= 0.3) score += 0.35;
    if (field === "setName" && regionOverlap >= 0.65) {
      score += 0.45;
    }

    const ageDays = Math.max(0, (nowMs - new Date(row.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));
    const recencyMultiplier = Math.max(0.2, 1 - Math.min(1, ageDays / 180));
    score *= recencyMultiplier;

    const aggregateKey = `${field}::${clearValue ? "[clear]" : humanValue!.toLowerCase()}`;
    const current = aggregateByFieldValue.get(aggregateKey);
    if (current) {
      current.score += score;
      current.support += Math.max(1, row.sampleCount);
      current.prior = Math.max(current.prior, row.confidencePrior ?? 0);
    } else {
      aggregateByFieldValue.set(aggregateKey, {
        field,
        value: humanValue,
        clearValue,
        score,
        support: Math.max(1, row.sampleCount),
        prior: Math.max(0, row.confidencePrior ?? 0),
      });
    }
  });

  const topByField = new Map<keyof SuggestionFields, CandidateAggregate>();
  aggregateByFieldValue.forEach((entry) => {
    const current = topByField.get(entry.field);
    if (!current || entry.score > current.score || (entry.score === current.score && entry.support > current.support)) {
      topByField.set(entry.field, entry);
    }
  });

  const applied: MemoryApplyEntry[] = [];
  MEMORY_FIELD_KEYS.forEach((field) => {
    const top = topByField.get(field);
    if (!top || top.score < 1.3) {
      return;
    }
    const learnedConfidence = Math.min(
      0.98,
      0.52 + Math.min(0.36, top.score / 6) + Math.min(0.12, Math.max(0, top.prior) * 0.12)
    );
    const currentConfidence = confidence[field] ?? 0;
    const currentValue = fields[field];
    if (top.clearValue) {
      if (!currentValue) {
        return;
      }
      if (currentConfidence > learnedConfidence && top.support < 2) {
        return;
      }
      fields[field] = null;
      confidence[field] = null;
      applied.push({
        field,
        value: "[clear]",
        confidence: Number(learnedConfidence.toFixed(3)),
        support: top.support,
      });
      return;
    }
    const topValue = top.value ?? "";
    if (!currentValue || currentConfidence < learnedConfidence || currentValue.trim().toLowerCase() === topValue.toLowerCase()) {
      fields[field] = topValue;
      confidence[field] = Math.max(currentConfidence, learnedConfidence);
      applied.push({
        field,
        value: topValue,
        confidence: Number(learnedConfidence.toFixed(3)),
        support: top.support,
      });
    }
  });

  return {
    context,
    consideredRows: rows.length,
    applied,
  };
}

async function constrainTaxonomyFields(params: {
  fields: SuggestionFields;
  confidence: SuggestionConfidence;
  queryHints: {
    year: string | null;
    manufacturer: string | null;
    sport: string | null;
    productLine: string | null;
    setId: string | null;
    layoutClass: string | null;
  };
}): Promise<TaxonomyConstraintAudit> {
  const { fields, confidence, queryHints } = params;
  const year = sanitizeText(queryHints.year || fields.year || "");
  const manufacturer = sanitizeText(queryHints.manufacturer || fields.manufacturer || "");
  const sport = sanitizeText(queryHints.sport || fields.sport || "") || null;
  const productLine = sanitizeText(queryHints.productLine || fields.setName || "") || null;
  const explicitSetId = sanitizeText(queryHints.setId || "") || null;

  const fieldStatus: TaxonomyConstraintAudit["fieldStatus"] = {
    setName: "cleared_out_of_pool",
    insertSet: "cleared_out_of_pool",
    parallel: "cleared_out_of_pool",
  };

  if (!year || !manufacturer) {
    fieldStatus.setName = fields.setName ? "kept" : "cleared_no_set_scope";
    fieldStatus.insertSet = fields.insertSet ? "kept" : "cleared_no_set_scope";
    fieldStatus.parallel = fields.parallel ? "kept" : "cleared_no_set_scope";
    return {
      selectedSetId: null,
      queryHints,
      pool: {
        approvedSetCount: 0,
        scopedSetCount: 0,
        selectedSetId: null,
        setOptions: [],
        insertOptions: [],
        parallelOptions: [],
      },
      fieldStatus,
    };
  }

  const pool = await loadVariantOptionPool({
    year,
    manufacturer,
    sport,
    productLine,
    setId: explicitSetId,
  });

  const setOptions = pool.sets.map((entry) => entry.setId);
  let selectedSetId = pool.selectedSetId ?? null;

  const setConfidence = confidence.setName;
  const rawSetName = coerceNullableString(fields.setName);
  if (selectedSetId) {
    fields.setName = selectedSetId;
    confidence.setName = Math.max(confidence.setName ?? 0, 0.99);
    fieldStatus.setName = "kept";
  } else if (!rawSetName || setConfidence == null || setConfidence < TAXONOMY_FIELD_THRESHOLD.setName) {
    fields.setName = null;
    fieldStatus.setName = setConfidence == null || setConfidence < TAXONOMY_FIELD_THRESHOLD.setName
      ? "cleared_low_confidence"
      : "cleared_no_set_scope";
  } else {
    if (setOptions.length < 1) {
      fields.setName = rawSetName;
      fieldStatus.setName = "cleared_no_set_scope";
    } else {
      const resolvedSet = resolveCanonicalOption(setOptions, rawSetName, 1.05);
      if (resolvedSet) {
        fields.setName = resolvedSet;
        selectedSetId = resolvedSet;
        fieldStatus.setName = "kept";
      } else {
        // Preserve confident raw set values when taxonomy cannot confidently map them.
        fields.setName = rawSetName;
        fieldStatus.setName = "cleared_out_of_pool";
      }
    }
  }

  const scopedInsertOptions = selectedSetId
    ? pool.insertOptions.filter((entry) => entry.setIds.includes(selectedSetId)).map((entry) => entry.label)
    : [];
  const scopedParallelOptions = selectedSetId
    ? pool.parallelOptions.filter((entry) => entry.setIds.includes(selectedSetId)).map((entry) => entry.label)
    : [];
  const globalInsertOptions = pool.insertOptions.map((entry) => entry.label);
  const globalParallelOptions = pool.parallelOptions.map((entry) => entry.label);

  const applyScopedField = (
    field: "insertSet" | "parallel",
    options: string[],
    globalOptions: string[]
  ) => {
    const rawValue = coerceNullableString(fields[field]);
    const score = confidence[field];
    if (!rawValue || score == null || score < TAXONOMY_FIELD_THRESHOLD[field]) {
      fields[field] = null;
      fieldStatus[field] = "cleared_low_confidence";
      return;
    }
    const candidateOptions = options.length > 0 ? options : globalOptions;
    if (candidateOptions.length < 1) {
      fields[field] = rawValue;
      fieldStatus[field] = "cleared_no_set_scope";
      return;
    }
    const resolved = resolveCanonicalOption(candidateOptions, rawValue, 0.9);
    if (resolved) {
      fields[field] = resolved;
      fieldStatus[field] = "kept";
      return;
    }
    // Preserve confident raw values when taxonomy cannot map.
    fields[field] = rawValue;
    fieldStatus[field] = "cleared_out_of_pool";
  };

  applyScopedField("insertSet", scopedInsertOptions, globalInsertOptions);
  applyScopedField("parallel", scopedParallelOptions, globalParallelOptions);

  return {
    selectedSetId,
    queryHints,
    pool: {
      approvedSetCount: pool.approvedSetCount,
      scopedSetCount: pool.scopedSetIds.length,
      selectedSetId: pool.selectedSetId,
      setOptions: setOptions.slice(0, 80),
      insertOptions: scopedInsertOptions.slice(0, 160),
      parallelOptions: scopedParallelOptions.slice(0, 160),
    },
    fieldStatus,
  };
}

function buildOcrProxySignaturePayload(params: {
  url: string;
  exp: number;
  format?: string | null;
  purpose?: string | null;
  imageId?: string | null;
}) {
  return [
    params.url,
    String(params.exp),
    params.format ?? "",
    params.purpose ?? "",
    params.imageId ?? "",
  ].join("|");
}

function buildProxyUrl(
  req: NextApiRequest,
  targetUrl: string,
  options?: {
    format?: "llm-supported";
    purpose?: string;
    imageId?: string;
  }
): string | null {
  const normalizedTarget = normalizeStorageUrl(targetUrl) ?? targetUrl;
  const secret = process.env.OCR_PROXY_SECRET ?? process.env.OPENAI_API_KEY;
  if (!secret) {
    return /^https?:\/\//i.test(normalizedTarget) ? normalizedTarget : null;
  }
  const host = req.headers.host;
  if (!host) {
    return null;
  }
  const protocol = (req.headers["x-forwarded-proto"] as string) || "https";
  const expires = Date.now() + 5 * 60 * 1000;
  const payload = buildOcrProxySignaturePayload({
    url: normalizedTarget,
    exp: expires,
    format: options?.format ?? null,
    purpose: options?.purpose ?? null,
    imageId: options?.imageId ?? null,
  });
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const params = new URLSearchParams({
    url: normalizedTarget,
    exp: String(expires),
    sig: signature,
  });
  if (options?.format) {
    params.set("format", options.format);
  }
  if (options?.purpose) {
    params.set("purpose", options.purpose);
  }
  if (options?.imageId) {
    params.set("imageId", options.imageId);
  }
  return `${protocol}://${host}/api/public/ocr-image?${params.toString()}`;
}

function pickImageUrl(primary?: string | null, thumbnail?: string | null): string | null {
  const candidate = primary ?? thumbnail ?? null;
  if (!candidate) {
    return null;
  }
  return /^https?:\/\//i.test(candidate) ? candidate : null;
}

function normalizeForNumbered(input: string): string {
  return input
    .toUpperCase()
    .replace(/(?<=\d)[O]/g, "0")
    .replace(/[O](?=\d)/g, "0")
    .replace(/(?<=\d)[IL]/g, "1")
    .replace(/[IL](?=\d)/g, "1")
    .replace(/(?<=\d)S/g, "5")
    .replace(/S(?=\d)/g, "5");
}

function readHeaderFirst(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }
  return String(value || "").trim();
}

function isEvalBypassAuthorized(req: NextApiRequest): boolean {
  const secret = (process.env.AI_EVAL_RUN_SECRET ?? "").trim();
  const provided = readHeaderFirst(req.headers["x-ai-eval-secret"]);
  if (!secret || !provided) {
    return false;
  }
  const secretBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  if (secretBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(secretBuffer, providedBuffer);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SuggestResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    if (!isEvalBypassAuthorized(req)) {
      await requireAdminSession(req);
    }
    const { cardId } = req.query;
    if (typeof cardId !== "string" || !cardId.trim()) {
      return res.status(400).json({ message: "cardId is required" });
    }
    const queryHints = {
      year: sanitizeText(req.query.year) || null,
      manufacturer: sanitizeText(req.query.manufacturer) || null,
      sport: sanitizeText(req.query.sport) || null,
      game: sanitizeText(req.query.game) || null,
      productLine: sanitizeText(req.query.productLine) || null,
      setId: sanitizeText(req.query.setId) || null,
      layoutClass: sanitizeText(req.query.layoutClass) || null,
    };

    const card = await prisma.cardAsset.findFirst({
      where: { id: cardId },
      select: {
        ocrText: true,
        imageUrl: true,
        thumbnailUrl: true,
        photos: {
          where: { kind: { in: ["BACK", "TILT"] } },
          select: { kind: true, imageUrl: true, thumbnailUrl: true },
        },
      },
    });

    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    const frontImageUrl = pickImageUrl(card.imageUrl, card.thumbnailUrl);
    const backPhoto = card.photos.find((photo) => photo.kind === "BACK");
    const tiltPhoto = card.photos.find((photo) => photo.kind === "TILT");
    const backImageUrl = pickImageUrl(backPhoto?.imageUrl, backPhoto?.thumbnailUrl);
    const tiltImageUrl = pickImageUrl(tiltPhoto?.imageUrl, tiltPhoto?.thumbnailUrl);

    const frontProxyUrl = frontImageUrl ? buildProxyUrl(req, frontImageUrl) : null;
    const backProxyUrl = backImageUrl ? buildProxyUrl(req, backImageUrl) : null;
    const tiltProxyUrl = tiltImageUrl ? buildProxyUrl(req, tiltImageUrl) : null;
    const frontLlmProxyUrl = frontImageUrl
      ? buildProxyUrl(req, frontImageUrl, {
          format: "llm-supported",
          purpose: "ocr-llm-multimodal",
          imageId: "FRONT",
        })
      : null;
    const backLlmProxyUrl = backImageUrl
      ? buildProxyUrl(req, backImageUrl, {
          format: "llm-supported",
          purpose: "ocr-llm-multimodal",
          imageId: "BACK",
        })
      : null;
    const tiltLlmProxyUrl = tiltImageUrl
      ? buildProxyUrl(req, tiltImageUrl, {
          format: "llm-supported",
          purpose: "ocr-llm-multimodal",
          imageId: "TILT",
        })
      : null;

    const pendingPhotoState = buildPhotoOcrState({
      frontImageUrl: frontImageUrl ?? null,
      backImageUrl: backImageUrl ?? null,
      tiltImageUrl: tiltImageUrl ?? null,
      results: [],
    });

    if ((!card.ocrText || !card.ocrText.trim()) && !frontProxyUrl && !backProxyUrl && !tiltProxyUrl) {
      return res.status(200).json({
        suggestions: {},
        threshold: DEFAULT_THRESHOLD,
        audit: {
          source: "google-vision",
          model: "google-vision",
          createdAt: new Date().toISOString(),
          fields: {},
          confidence: {},
          photoOcr: pendingPhotoState.byId,
          readiness: pendingPhotoState.readiness,
        },
        status: "pending",
      });
    }

    const images = [
      ...(frontProxyUrl ? [{ id: "front", url: frontProxyUrl }] : []),
      ...(backProxyUrl ? [{ id: "back", url: backProxyUrl }] : []),
      ...(tiltProxyUrl ? [{ id: "tilt", url: tiltProxyUrl }] : []),
    ];
    const llmImages: LlmImageInput[] = [
      ...(frontLlmProxyUrl ? [{ id: "FRONT" as const, url: frontLlmProxyUrl }] : []),
      ...(backLlmProxyUrl ? [{ id: "BACK" as const, url: backLlmProxyUrl }] : []),
      ...(tiltLlmProxyUrl ? [{ id: "TILT" as const, url: tiltLlmProxyUrl }] : []),
    ];

    if (images.length === 0) {
      return res.status(200).json({
        suggestions: {},
        threshold: DEFAULT_THRESHOLD,
        audit: {
          source: "google-vision",
          model: "google-vision",
          createdAt: new Date().toISOString(),
          fields: {},
          confidence: {},
          photoOcr: pendingPhotoState.byId,
          readiness: pendingPhotoState.readiness,
        },
        status: "pending",
      });
    }

    if (pendingPhotoState.readiness.status === "missing_required") {
      return res.status(200).json({
        suggestions: {},
        threshold: DEFAULT_THRESHOLD,
        audit: {
          source: "google-vision",
          model: "google-vision",
          createdAt: new Date().toISOString(),
          fields: {},
          confidence: {},
          photoOcr: pendingPhotoState.byId,
          readiness: pendingPhotoState.readiness,
          note: "Waiting for all required intake photos before OCR.",
        },
        status: "pending",
      });
    }

    const totalStartMs = Date.now();
    const ocrStartMs = Date.now();
    const ocrResponse = await runGoogleVisionOcr(images);
    const ocrElapsedMs = Date.now() - ocrStartMs;
    const photoState = buildPhotoOcrState({
      frontImageUrl: frontImageUrl ?? null,
      backImageUrl: backImageUrl ?? null,
      tiltImageUrl: tiltImageUrl ?? null,
      results: ocrResponse.results.map((result) => ({
        id: typeof result?.id === "string" ? result.id : null,
        text: typeof result?.text === "string" ? result.text : "",
        tokenCount: Array.isArray(result?.tokens) ? result.tokens.length : 0,
      })),
    });
    const ocrTokens = ocrResponse.results.flatMap((result) => {
      const tokens = Array.isArray(result.tokens) ? result.tokens : [];
      return tokens.map((token) => ({
        text: typeof token.text === "string" ? token.text : "",
        confidence:
          typeof token.confidence === "number" && Number.isFinite(token.confidence)
            ? token.confidence
            : 0,
        imageId: token.image_id ?? result.id ?? null,
        bbox: Array.isArray(token.bbox)
          ? token.bbox
              .map((point) => ({
                x: typeof point?.x === "number" && Number.isFinite(point.x) ? point.x : 0,
                y: typeof point?.y === "number" && Number.isFinite(point.y) ? point.y : 0,
              }))
              .slice(0, 8)
          : [],
        }));
    });
    const imageSections: OcrImageSection[] = OCR_PHOTO_IDS.map((photoId) => {
      const state = photoState.byId[photoId];
      if (!state?.ocrText) {
        return null;
      }
      return {
        id: photoId,
        text: state.ocrText,
      };
    }).filter((entry): entry is OcrImageSection => Boolean(entry));
    const combinedTextRaw =
      (typeof ocrResponse.combined_text === "string" ? ocrResponse.combined_text.trim() : "") ||
      imageSections.map((section) => section.text).join("\n\n");
    const combinedText = combinedTextRaw.toLowerCase();
    const normalizedNumberedText = normalizeForNumbered(combinedTextRaw);

    const attributes = extractCardAttributes(combinedTextRaw);
    const fields: SuggestionFields = {
      playerName: attributes.playerName ?? null,
      teamName: attributes.teamName ?? null,
      year: attributes.year ?? null,
      manufacturer: attributes.brand ?? null,
      sport: null,
      game: null,
      cardName: null,
      setName: attributes.setName ?? null,
      insertSet: null,
      parallel: null,
      cardNumber: null,
      numbered: attributes.numbered ?? null,
      autograph: attributes.autograph ? "true" : null,
      memorabilia: attributes.memorabilia ? "true" : null,
      graded: attributes.gradeCompany && attributes.gradeValue ? "true" : null,
      gradeCompany: attributes.gradeCompany ?? null,
      gradeValue: attributes.gradeValue ?? null,
    };

    const confidence: SuggestionConfidence = FIELD_KEYS.reduce((acc, key) => {
      acc[key] = fields[key] ? 0.9 : null;
      return acc;
    }, {} as SuggestionConfidence);
    if (!fields.sport) {
      const inferredSport =
        combinedText.includes("baseball") || combinedText.includes("mlb")
          ? "Baseball"
          : combinedText.includes("basketball") || combinedText.includes("nba")
          ? "Basketball"
          : combinedText.includes("football") || combinedText.includes("nfl")
          ? "Football"
          : combinedText.includes("hockey") || combinedText.includes("nhl")
          ? "Hockey"
          : combinedText.includes("soccer") || combinedText.includes("fifa")
          ? "Soccer"
          : null;
      if (inferredSport) {
        fields.sport = inferredSport;
        confidence.sport = 0.9;
      }
    }

    if (!fields.game) {
      const match = TCG_KEYWORDS.find((keyword) => combinedText.includes(keyword));
      if (match) {
        fields.game = match
          .replace("yu-gi-oh", "Yu-Gi-Oh!")
          .replace("yugioh", "Yu-Gi-Oh!")
          .replace("pokemon", "Pokemon")
          .replace("magic", "Magic")
          .replace("lorcana", "Lorcana")
          .replace("one piece", "One Piece")
          .replace("digimon", "Digimon");
        confidence.game = 0.8;
      }
    }

    if (!fields.year) {
      const yearMatch = combinedText.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        fields.year = yearMatch[0];
        confidence.year = 0.9;
      }
    }

    if (!fields.numbered) {
      const numberedMatch = normalizedNumberedText.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/);
      if (numberedMatch) {
        fields.numbered = numberedMatch[0].replace(/\s+/g, "");
        confidence.numbered = 0.9;
      }
    }

    if (!fields.parallel) {
      const parallelKeywords = [
        "refractor",
        "x-fractor",
        "gold refractor",
        "silver refractor",
        "holo",
        "prizm",
        "mojo",
        "cracked ice",
      ];
      const hit = parallelKeywords.find((keyword) => combinedText.includes(keyword));
      if (hit) {
        fields.parallel = hit
          .split(" ")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
        confidence.parallel = 0.75;
      }
    }

    if (!fields.autograph) {
      if (/\bauto(?:graph)?\b/i.test(combinedTextRaw) || /\bsignature\b/i.test(combinedTextRaw) || /\bsigned\b/i.test(combinedTextRaw)) {
        fields.autograph = "true";
        confidence.autograph = 0.9;
      }
    }

    if (!fields.memorabilia) {
      if (
        /\bpatch\b/i.test(combinedTextRaw) ||
        /\bjersey\b/i.test(combinedTextRaw) ||
        /\brelic\b/i.test(combinedTextRaw) ||
        /\bmemorabilia\b/i.test(combinedTextRaw) ||
        /\bgame[-\s]?worn\b/i.test(combinedTextRaw) ||
        /\bplayer[-\s]?worn\b/i.test(combinedTextRaw) ||
        /\b(event|event[-\s]?worn)\b/i.test(combinedTextRaw) ||
        /\bswatch\b/i.test(combinedTextRaw) ||
        /\bmem\b/i.test(combinedTextRaw)
      ) {
        fields.memorabilia = "true";
        confidence.memorabilia = 0.9;
      }
    }

    if (!fields.gradeCompany || !fields.gradeValue || !fields.graded) {
      const rawOcr = combinedTextRaw;
      const normalizedOcr = rawOcr
        .replace(/\bP\s*5\s*A\b/gi, "PSA")
        .replace(/\bP\s*S\s*A\b/gi, "PSA")
        .replace(/\bS\s*G\s*C\b/gi, "SGC")
        .replace(/\bC\s*G\s*C\b/gi, "CGC")
        .replace(/\bB\s*G\s*S\b/gi, "BGS");
      const directMatch = normalizedOcr.match(/\b(PSA|BGS|SGC|CGC)\b[\s:\-]*([0-9]{1,2}(?:\.[0-9])?)/i);
      const reversedMatch = normalizedOcr.match(/([0-9]{1,2}(?:\.[0-9])?)\s*(PSA|BGS|SGC|CGC)\b/i);
      const inlineMatch = normalizedOcr.match(/\b(PSA|BGS|SGC|CGC)\s*([0-9]{1,2}(?:\.[0-9])?)\b/i);
      const company = directMatch?.[1] ?? reversedMatch?.[2] ?? null;
      const value = directMatch?.[2] ?? reversedMatch?.[1] ?? inlineMatch?.[2] ?? null;
      if (company && value) {
        const normalizedCompany = company.toUpperCase();
        if (!fields.gradeCompany) {
          fields.gradeCompany = normalizedCompany;
          confidence.gradeCompany = 0.9;
        }
        if (!fields.gradeValue) {
          fields.gradeValue = value;
          confidence.gradeValue = 0.9;
        }
        if (!fields.graded) {
          fields.graded = "true";
          confidence.graded = 0.9;
        }
      }
    }

    let taxonomyPromptCandidates: TaxonomyPromptCandidates = {
      setOptions: [],
      insertOptions: [],
      parallelOptions: [],
    };
    let taxonomyPromptPoolError: string | null = null;
    try {
      const promptPool = await loadVariantOptionPool({
        year: sanitizeText(queryHints.year || fields.year || ""),
        manufacturer: sanitizeText(queryHints.manufacturer || fields.manufacturer || ""),
        sport: sanitizeText(queryHints.sport || fields.sport || "") || null,
        productLine: sanitizeText(queryHints.productLine || fields.setName || "") || null,
        setId: sanitizeText(queryHints.setId || "") || null,
      });
      taxonomyPromptCandidates = buildTaxonomyPromptCandidates({
        setOptions: promptPool.sets.map((entry) => entry.setId),
        insertOptions: promptPool.insertOptions.map((entry) => entry.label),
        parallelOptions: promptPool.parallelOptions.map((entry) => entry.label),
      });
    } catch (error) {
      taxonomyPromptPoolError = error instanceof Error ? error.message : "taxonomy_prompt_pool_failed";
      taxonomyPromptCandidates = {
        setOptions: [],
        insertOptions: [],
        parallelOptions: [],
      };
    }

    let llmMeta: LlmParseMeta | null = null;
    let llmTextMeta: LlmParseMeta | null = null;
    let llmMultimodalMeta: LlmParseMeta | null = null;
    let multimodalDecision: MultimodalDecision = {
      useMultimodal: false,
      detail: "low",
      reasons: [],
    };
    let llmTextParsed = false;
    const llmStartMs = Date.now();
    try {
      const llmTextResult = await parseWithLlm({
        ocrText: combinedTextRaw,
        imageSections,
        taxonomyCandidates: taxonomyPromptCandidates,
        mode: "text",
        detail: null,
      });
      if (llmTextResult) {
        llmTextParsed = true;
        llmTextMeta = llmTextResult.meta;
        applyLlmParsedPayload({
          targetFields: fields,
          targetConfidence: confidence,
          parsed: llmTextResult,
        });
        llmMeta = llmTextResult.meta;
      }
    } catch (error) {
      console.warn("LLM OCR text parse failed; using heuristics/multimodal fallback", error);
    }

    multimodalDecision = buildMultimodalDecision({
      fields,
      confidence,
      taxonomyCandidates: taxonomyPromptCandidates,
      images: llmImages,
      llmTextParsed,
    });
    if (multimodalDecision.useMultimodal) {
      try {
        const llmMultimodalResult = await parseWithLlm({
          ocrText: combinedTextRaw,
          imageSections,
          taxonomyCandidates: taxonomyPromptCandidates,
          mode: "multimodal",
          detail: multimodalDecision.detail,
          images: llmImages,
        });
        if (llmMultimodalResult) {
          llmMultimodalMeta = llmMultimodalResult.meta;
          applyLlmParsedPayload({
            targetFields: fields,
            targetConfidence: confidence,
            parsed: llmMultimodalResult,
          });
          llmMeta = llmMultimodalResult.meta;
        }
      } catch (error) {
        console.warn("LLM OCR multimodal parse failed; keeping text/heuristic suggestions", error);
      }
    }
    const llmElapsedMs = Date.now() - llmStartMs;

    const regionTemplateLayoutClass = sanitizeText(queryHints.layoutClass || "") || "base";
    const requestedRegionTemplateSetId = coerceNullableString(queryHints.setId || queryHints.productLine || fields.setName);
    const globalFallbackTemplates = buildGlobalProductSetFallbackTemplates();
    const dedupeMemoryApplyEntries = (entries: MemoryApplyEntry[]) => {
      const seen = new Set<string>();
      return entries.filter((entry) => {
        const key = `${entry.field}::${entry.value.toLowerCase()}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    };
    const loadSetScopedRegionTemplates = async (setId: string | null) => {
      if (!setId) {
        return null;
      }
      const templateState = await listOcrRegionTemplates({
        setId,
        layoutClass: regionTemplateLayoutClass,
      });
      return {
        setId: templateState.setId,
        layoutClass: templateState.layoutClass,
        templatesBySide: templateState.templatesBySide,
        loadedSides: (["FRONT", "BACK", "TILT"] as OcrRegionPhotoSide[]).filter(
          (side) => (templateState.templatesBySide[side] ?? []).length > 0
        ),
        regionCountBySide: {
          FRONT: templateState.templatesBySide.FRONT.length,
          BACK: templateState.templatesBySide.BACK.length,
          TILT: templateState.templatesBySide.TILT.length,
        },
      };
    };
    let regionTemplatesBySide: RegionTemplateMap = mergeRegionTemplateMaps(globalFallbackTemplates);
    let regionTemplateAudit: {
      setId: string | null;
      layoutClass: string;
      loadedSides: OcrRegionPhotoSide[];
      regionCountBySide: Record<OcrRegionPhotoSide, number>;
      globalFallbackLoadedSides: OcrRegionPhotoSide[];
      valueHintsApplied: MemoryApplyEntry[];
      resolvedAfterMemorySetId: string | null;
      error?: string;
    } = {
      setId: requestedRegionTemplateSetId,
      layoutClass: regionTemplateLayoutClass,
      loadedSides: [],
      regionCountBySide: emptyRegionCountBySide(),
      globalFallbackLoadedSides: ["BACK"],
      valueHintsApplied: [],
      resolvedAfterMemorySetId: null,
    };
    try {
      const initialTemplateState = await loadSetScopedRegionTemplates(requestedRegionTemplateSetId);
      if (initialTemplateState) {
        regionTemplatesBySide = mergeRegionTemplateMaps(globalFallbackTemplates, initialTemplateState.templatesBySide);
        regionTemplateAudit = {
          ...regionTemplateAudit,
          setId: initialTemplateState.setId,
          layoutClass: initialTemplateState.layoutClass,
          loadedSides: initialTemplateState.loadedSides,
          regionCountBySide: initialTemplateState.regionCountBySide,
        };
      }
    } catch (error) {
      regionTemplateAudit = {
        ...regionTemplateAudit,
        error: error instanceof Error ? error.message : "region_template_load_failed",
      };
    }
    const initialRegionValueHints = applyRegionTemplateValueHints({
      fields,
      confidence,
      tokens: ocrTokens,
      templatesBySide: regionTemplatesBySide,
    });
    if (initialRegionValueHints.length > 0) {
      regionTemplateAudit = {
        ...regionTemplateAudit,
        valueHintsApplied: dedupeMemoryApplyEntries(initialRegionValueHints),
      };
    }

    let memoryAudit: {
      context: MemoryContext;
      consideredRows: number;
      applied: MemoryApplyEntry[];
      error?: string;
    } = {
      context: {
        setId: coerceNullableString(fields.setName),
        year: coerceNullableString(fields.year),
        manufacturer: coerceNullableString(fields.manufacturer),
        sport: coerceNullableString(fields.sport),
        cardNumber: coerceNullableString(fields.cardNumber),
        numbered: coerceNullableString(fields.numbered),
      },
      consideredRows: 0,
      applied: [],
    };
    try {
      memoryAudit = await applyFeedbackMemoryHints({
        fields,
        confidence,
        tokens: ocrTokens,
        regionTemplatesBySide,
      });
    } catch (error) {
      console.warn("OCR feedback memory apply failed", error);
      memoryAudit = {
        ...memoryAudit,
        error: error instanceof Error ? error.message : "memory_apply_failed",
      };
    }

    const resolvedRegionTemplateSetId = coerceNullableString(fields.setName);
    const shouldReplaySpecificTemplates =
      resolvedRegionTemplateSetId &&
      normalizeVariantLabelKey(resolvedRegionTemplateSetId) !==
        normalizeVariantLabelKey(regionTemplateAudit.setId || "");
    if (shouldReplaySpecificTemplates) {
      try {
        const resolvedTemplateState = await loadSetScopedRegionTemplates(resolvedRegionTemplateSetId);
        if (resolvedTemplateState) {
          regionTemplatesBySide = mergeRegionTemplateMaps(globalFallbackTemplates, resolvedTemplateState.templatesBySide);
          const replayRegionValueHints = applyRegionTemplateValueHints({
            fields,
            confidence,
            tokens: ocrTokens,
            templatesBySide: regionTemplatesBySide,
          });
          const replayMemoryAudit = await applyFeedbackMemoryHints({
            fields,
            confidence,
            tokens: ocrTokens,
            regionTemplatesBySide,
          });
          regionTemplateAudit = {
            ...regionTemplateAudit,
            setId: resolvedTemplateState.setId,
            layoutClass: resolvedTemplateState.layoutClass,
            loadedSides: resolvedTemplateState.loadedSides,
            regionCountBySide: resolvedTemplateState.regionCountBySide,
            resolvedAfterMemorySetId: resolvedTemplateState.setId,
            valueHintsApplied: dedupeMemoryApplyEntries([
              ...regionTemplateAudit.valueHintsApplied,
              ...replayRegionValueHints,
            ]),
          };
          memoryAudit = {
            context: replayMemoryAudit.context,
            consideredRows: memoryAudit.consideredRows + replayMemoryAudit.consideredRows,
            applied: dedupeMemoryApplyEntries([...memoryAudit.applied, ...replayMemoryAudit.applied]),
          };
        }
      } catch (error) {
        const replayMessage = error instanceof Error ? error.message : "region_template_replay_failed";
        regionTemplateAudit = {
          ...regionTemplateAudit,
          error: regionTemplateAudit.error ? `${regionTemplateAudit.error}; ${replayMessage}` : replayMessage,
        };
      }
    }

    // Numbered serials must be grounded in OCR text; never keep hallucinated or memory-only values.
    const explicitNumberedMatch = normalizedNumberedText.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/);
    if (explicitNumberedMatch) {
      const canonical = explicitNumberedMatch[0].replace(/\s+/g, "");
      if (!fields.numbered || normalizeForNumbered(fields.numbered) !== normalizeForNumbered(canonical)) {
        fields.numbered = canonical;
        confidence.numbered = Math.max(confidence.numbered ?? 0, 0.86);
      }
    } else {
      fields.numbered = null;
      confidence.numbered = null;
    }

    let ocrCardNumberGroundingAudit: CardNumberGroundingAudit | null = null;
    try {
      ocrCardNumberGroundingAudit = await groundScopedCardNumberFromOcr({
        fields,
        queryHints,
        photoTexts: {
          FRONT: photoState.byId.FRONT?.ocrText ?? "",
          BACK: photoState.byId.BACK?.ocrText ?? "",
          TILT: photoState.byId.TILT?.ocrText ?? "",
        },
        combinedText: combinedTextRaw,
      });
      if (ocrCardNumberGroundingAudit.matched && ocrCardNumberGroundingAudit.cardNumber) {
        const shouldReplaceCardNumber =
          !fields.cardNumber ||
          fields.cardNumber.trim().toUpperCase() !== ocrCardNumberGroundingAudit.cardNumber.trim().toUpperCase() ||
          (confidence.cardNumber ?? 0) < 0.96;
        if (shouldReplaceCardNumber) {
          fields.cardNumber = ocrCardNumberGroundingAudit.cardNumber;
          confidence.cardNumber = Math.max(confidence.cardNumber ?? 0, 0.96);
        }
      }
    } catch (error) {
      console.warn("Scoped OCR card-number grounding failed", error);
      ocrCardNumberGroundingAudit = {
        matched: false,
        reason: error instanceof Error ? error.message : "ocr_card_number_grounding_failed",
        candidateSetIds: [],
        scannedRowCount: 0,
        candidateCount: 0,
        cardNumber: null,
        setId: null,
        programId: null,
        programLabel: null,
        playerName: null,
        teamName: null,
        sourceSide: null,
        matchType: null,
        evidenceText: null,
      };
    }

    let setCardResolutionAudit: SetCardResolutionAudit | null = null;
    try {
      setCardResolutionAudit = await resolveScopedSetCard({
        fields,
        queryHints,
      });
      if (setCardResolutionAudit.matched && setCardResolutionAudit.setId) {
        fields.setName = setCardResolutionAudit.setId;
        confidence.setName = Math.max(confidence.setName ?? 0, 0.99);
        if (setCardResolutionAudit.programLabel) {
          fields.insertSet = setCardResolutionAudit.programLabel;
          confidence.insertSet = Math.max(confidence.insertSet ?? 0, 0.98);
        }
        if (setCardResolutionAudit.cardNumber) {
          fields.cardNumber = setCardResolutionAudit.cardNumber;
          confidence.cardNumber = Math.max(confidence.cardNumber ?? 0, 0.98);
        }
        if (setCardResolutionAudit.playerName) {
          fields.playerName = setCardResolutionAudit.playerName;
          confidence.playerName = Math.max(confidence.playerName ?? 0, 0.94);
        }
        if (setCardResolutionAudit.teamName) {
          fields.teamName = setCardResolutionAudit.teamName;
          confidence.teamName = Math.max(confidence.teamName ?? 0, 0.94);
        }
      }
    } catch (error) {
      console.warn("Scoped set-card resolution failed", error);
      setCardResolutionAudit = {
        matched: false,
        reason: error instanceof Error ? error.message : "set_card_resolution_failed",
        candidateSetIds: [],
        candidateCount: 0,
        setId: null,
        programId: null,
        programLabel: null,
        cardNumber: null,
        playerName: null,
        teamName: null,
      };
    }

    let variantMatchAudit:
      | {
          ok: boolean;
          message?: string;
          matchedSetId?: string;
          matchedCardNumber?: string;
          candidates?: Array<{ parallelId: string; confidence: number; reason: string }>;
          topCandidate?: { parallelId: string; confidence: number; reason: string } | null;
        }
      | null = null;

    const suggestedSetId = fields.setName?.trim() || null;
    const suggestedCardNumber = fields.cardNumber?.trim() || null;
    const suggestedNumbered = fields.numbered?.trim() || null;
    if (suggestedSetId) {
      try {
        const matchResult = await runVariantMatch({
          cardAssetId: cardId,
          setId: suggestedSetId,
          cardNumber: suggestedCardNumber,
          numbered: suggestedNumbered,
          program: fields.insertSet,
        });
        if (matchResult.ok) {
          const topCandidate = matchResult.candidates[0] ?? null;
          variantMatchAudit = {
            ok: true,
            matchedSetId: matchResult.matchedSetId,
            matchedCardNumber: matchResult.matchedCardNumber,
            candidates: matchResult.candidates,
            topCandidate,
          };
          if (!fields.setName) {
            fields.setName = matchResult.matchedSetId;
            confidence.setName = Math.max(confidence.setName ?? 0, 0.86);
          }
          if (
            (!fields.cardNumber || fields.cardNumber.toUpperCase() === "ALL") &&
            matchResult.matchedCardNumber &&
            matchResult.matchedCardNumber.toUpperCase() !== "ALL"
          ) {
            fields.cardNumber = matchResult.matchedCardNumber;
            confidence.cardNumber = Math.max(confidence.cardNumber ?? 0, 0.82);
          }
          if (topCandidate) {
            const boostedConfidence = Math.min(0.95, Math.max(0.72, topCandidate.confidence));
            if (!fields.parallel || (confidence.parallel ?? 0) < boostedConfidence) {
              fields.parallel = topCandidate.parallelId;
              confidence.parallel = boostedConfidence;
            }
          }
        } else {
          variantMatchAudit = {
            ok: false,
            message: matchResult.message,
            matchedSetId: matchResult.matchedSetId,
            matchedCardNumber: matchResult.matchedCardNumber,
            candidates: matchResult.candidates,
            topCandidate: matchResult.candidates?.[0] ?? null,
          };
        }
      } catch (error) {
        console.warn("Auto variant match failed after OCR", error);
        variantMatchAudit = {
          ok: false,
          message: error instanceof Error ? error.message : "variant_match_failed",
        };
      }
    }

    let taxonomyConstraintAudit: TaxonomyConstraintAudit | null = null;
    try {
      taxonomyConstraintAudit = await constrainTaxonomyFields({
        fields,
        confidence,
        queryHints,
      });
    } catch (error) {
      console.warn("Failed to constrain taxonomy suggestions", error);
      const fallbackFieldStatus: TaxonomyConstraintAudit["fieldStatus"] = {
        setName: fields.setName ? "kept" : "cleared_no_set_scope",
        insertSet: fields.insertSet ? "kept" : "cleared_no_set_scope",
        parallel: fields.parallel ? "kept" : "cleared_no_set_scope",
      };
      taxonomyConstraintAudit = {
        selectedSetId: null,
        queryHints,
        pool: {
          approvedSetCount: 0,
          scopedSetCount: 0,
          selectedSetId: null,
          setOptions: [],
          insertOptions: [],
          parallelOptions: [],
        },
        fieldStatus: fallbackFieldStatus,
      };
    }

    const suggestions: Record<string, string> = {};
    FIELD_KEYS.forEach((key) => {
      const value = fields[key];
      const score = confidence[key];
      if (value && score != null && score >= fieldThreshold(key)) {
        suggestions[key] = value;
      }
    });

    const llmAudit = llmMeta
      ? {
          ...llmMeta,
          fallbackUsed:
            llmMeta.fallbackUsed || llmTextMeta?.fallbackUsed === true || llmMultimodalMeta?.fallbackUsed === true,
          attempts: {
            text: llmTextMeta,
            multimodal: llmMultimodalMeta,
          },
          multimodalDecision,
        }
      : null;

    const audit = {
      source: "google-vision+llm",
      model: `google-vision|${llmMeta?.model ?? OCR_LLM_MODEL}`,
      threshold: DEFAULT_THRESHOLD,
      fieldThresholds: {
        default: DEFAULT_THRESHOLD,
        taxonomy: TAXONOMY_FIELD_THRESHOLD,
      },
      createdAt: new Date().toISOString(),
      fields,
      confidence,
      llm: llmAudit,
      taxonomyPromptCandidates,
      taxonomyPromptPoolError,
      timings: {
        totalMs: Date.now() - totalStartMs,
        ocrMs: ocrElapsedMs,
        llmMs: llmElapsedMs,
      },
      tokens: ocrTokens,
      photoOcr: photoState.byId,
      readiness: photoState.readiness,
      memory: memoryAudit,
      regionTemplates: regionTemplateAudit,
      ocrCardNumberGrounding: ocrCardNumberGroundingAudit,
      setCardResolution: setCardResolutionAudit,
      variantMatch: variantMatchAudit,
      taxonomyConstraints: taxonomyConstraintAudit,
    };

    await prisma.cardAsset.update({
      where: { id: cardId },
      data: {
        ocrText: combinedTextRaw,
        ocrSuggestionJson: audit,
        ocrSuggestionUpdatedAt: new Date(),
      },
    });

    return res.status(200).json({
      suggestions,
      threshold: DEFAULT_THRESHOLD,
      audit,
      status: "ok",
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
