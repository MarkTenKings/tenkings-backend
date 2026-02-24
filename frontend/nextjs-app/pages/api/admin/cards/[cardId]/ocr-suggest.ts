import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { normalizeStorageUrl } from "../../../../../lib/server/storage";
import { runGoogleVisionOcr } from "../../../../../lib/server/googleVisionOcr";
import { extractCardAttributes, resolveOcrLlmAttempt } from "@tenkings/shared";
import { runVariantMatch } from "../../../../../lib/server/variantMatcher";
import {
  loadVariantOptionPool,
  resolveCanonicalOption,
  sanitizeText,
} from "../../../../../lib/server/variantOptionPool";
import {
  buildOcrFeedbackMemoryContext,
  parseOcrFeedbackTokenRefs,
  upsertOcrFeedbackMemoryAggregates,
} from "../../../../../lib/server/ocrFeedbackMemory";
import {
  listOcrRegionTemplates,
  type OcrRegionPhotoSide,
  type OcrRegionRect,
} from "../../../../../lib/server/ocrRegionTemplates";

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
const OCR_LLM_MODEL = (process.env.OCR_LLM_MODEL ?? "gpt-5").trim();
const OCR_LLM_FALLBACK_MODEL = (process.env.OCR_LLM_FALLBACK_MODEL ?? "gpt-5-mini").trim();
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

const OCR_PHOTO_IDS: OcrPhotoId[] = ["FRONT", "BACK", "TILT"];
const REQUIRED_OCR_PHOTO_IDS: OcrPhotoId[] = ["FRONT", "BACK", "TILT"];
const TRUE_STRINGS = new Set(["true", "yes", "1"]);
const BOOLEAN_MEMORY_FIELDS = new Set<keyof SuggestionFields>(["autograph", "memorabilia", "graded"]);

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

    const executeRequest = async (userContent: Array<Record<string, unknown>>) =>
      fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
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
        }),
      });

    let response = await executeRequest(buildUserContent("string"));
    let bodyText = await response.text().catch(() => "");

    if (!response.ok && mode === "multimodal" && response.status === 400) {
      const retryResponse = await executeRequest(buildUserContent("object"));
      const retryBodyText = await retryResponse.text().catch(() => "");
      response = retryResponse;
      bodyText = retryBodyText;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        bodyText,
        parsed: null,
      };
    }

    let payload: unknown = null;
    try {
      payload = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      payload = null;
    }
    const content = extractResponsesOutputText(payload);
    if (!content) {
      return {
        ok: true,
        status: response.status,
        bodyText,
        parsed: null,
      };
    }
    return {
      ok: true,
      status: response.status,
      bodyText,
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

  const taxonomyUncertainCount = ["set_uncertain", "insert_uncertain", "parallel_uncertain"].filter((key) =>
    reasons.includes(key)
  ).length;
  const detail: "low" | "high" =
    reasons.includes("text_parse_failed") ||
    reasons.includes("core_fields_uncertain") ||
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

function buildRegionTokenLookup(tokens: OcrTokenEntry[], templatesBySide: RegionTemplateMap): RegionTokenLookup {
  const global = new Set<string>();
  const byImage = new Map<string, Set<string>>();
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

  tokens.forEach((token) => {
    const normalized = normalizeMemoryToken(token.text);
    if (!normalized) {
      return;
    }
    const imageId = normalizeImageLabel(token.imageId);
    const side = imageId as OcrRegionPhotoSide;
    const regions = templatesBySide[side] ?? [];
    if (!regions.length) {
      return;
    }
    const points = Array.isArray(token.bbox) ? token.bbox : [];
    if (!points.length) {
      return;
    }
    const bounds = boundsByImage.get(imageId);
    if (!bounds || bounds.maxX <= 0 || bounds.maxY <= 0) {
      return;
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
      return;
    }
    const centerX = ((minX + maxX) / 2) / bounds.maxX;
    const centerY = ((minY + maxY) / 2) / bounds.maxY;
    const inRegion = regions.some(
      (region) =>
        centerX >= region.x &&
        centerX <= region.x + region.width &&
        centerY >= region.y &&
        centerY <= region.y + region.height
    );
    if (!inRegion) {
      return;
    }
    global.add(normalized);
    if (!byImage.has(imageId)) {
      byImage.set(imageId, new Set());
    }
    byImage.get(imageId)?.add(normalized);
  });

  return { global, byImage };
}

function scoreTokenRefSupport(
  refs: MemoryTokenRef[],
  lookup: MemoryTokenLookup,
  regionLookup: RegionTokenLookup
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
      const inRegionExpected = regionLookup.byImage.get(expectedImage)?.has(normalized) ?? false;
      const inRegionGlobal = regionLookup.global.has(normalized);
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
        fieldName: { in: FIELD_KEYS },
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
          fieldName: { in: FIELD_KEYS },
          humanValue: { not: null },
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
    value: string;
    score: number;
    support: number;
    prior: number;
  };

  const aggregateByFieldValue = new Map<string, CandidateAggregate>();
  const nowMs = Date.now();
  rows.forEach((row) => {
    const field = row.fieldName as keyof SuggestionFields;
    if (!FIELD_KEYS.includes(field)) {
      return;
    }
    const humanValue = coerceNullableString(row.value);
    if (!humanValue) {
      return;
    }
    if (BOOLEAN_MEMORY_FIELDS.has(field) && !isTruthyString(humanValue)) {
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
    const tokenSupport = scoreTokenRefSupport(tokenRefs, tokenLookup, regionTokenLookup);
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

    const aggregateKey = `${field}::${humanValue.toLowerCase()}`;
    const current = aggregateByFieldValue.get(aggregateKey);
    if (current) {
      current.score += score;
      current.support += Math.max(1, row.sampleCount);
      current.prior = Math.max(current.prior, row.confidencePrior ?? 0);
    } else {
      aggregateByFieldValue.set(aggregateKey, {
        field,
        value: humanValue,
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
  FIELD_KEYS.forEach((field) => {
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
    if (!currentValue || currentConfidence < learnedConfidence || currentValue.trim().toLowerCase() === top.value.toLowerCase()) {
      fields[field] = top.value;
      confidence[field] = Math.max(currentConfidence, learnedConfidence);
      applied.push({
        field,
        value: top.value,
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
    fields.setName = null;
    fields.insertSet = null;
    fields.parallel = null;
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
      fieldStatus: {
        setName: "cleared_no_set_scope",
        insertSet: "cleared_no_set_scope",
        parallel: "cleared_no_set_scope",
      },
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
    const resolvedSet = resolveCanonicalOption(setOptions, rawSetName, 1.05);
    if (resolvedSet) {
      fields.setName = resolvedSet;
      selectedSetId = resolvedSet;
      fieldStatus.setName = "kept";
    } else {
      fields.setName = null;
      fieldStatus.setName = "cleared_out_of_pool";
    }
  }

  const scopedInsertOptions = selectedSetId
    ? pool.insertOptions.filter((entry) => entry.setIds.includes(selectedSetId)).map((entry) => entry.label)
    : [];
  const scopedParallelOptions = selectedSetId
    ? pool.parallelOptions.filter((entry) => entry.setIds.includes(selectedSetId)).map((entry) => entry.label)
    : [];

  const applyScopedField = (
    field: "insertSet" | "parallel",
    options: string[]
  ) => {
    const rawValue = coerceNullableString(fields[field]);
    const score = confidence[field];
    if (!selectedSetId || options.length < 1) {
      fields[field] = null;
      fieldStatus[field] = "cleared_no_set_scope";
      return;
    }
    if (!rawValue || score == null || score < TAXONOMY_FIELD_THRESHOLD[field]) {
      fields[field] = null;
      fieldStatus[field] = "cleared_low_confidence";
      return;
    }
    const resolved = resolveCanonicalOption(options, rawValue, 0.9);
    if (resolved) {
      fields[field] = resolved;
      fieldStatus[field] = "kept";
      return;
    }
    fields[field] = null;
    fieldStatus[field] = "cleared_out_of_pool";
  };

  applyScopedField("insertSet", scopedInsertOptions);
  applyScopedField("parallel", scopedParallelOptions);

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

function buildProxyUrl(req: NextApiRequest, targetUrl: string): string | null {
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
  const payload = `${normalizedTarget}|${expires}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const encodedUrl = encodeURIComponent(normalizedTarget);
  return `${protocol}://${host}/api/public/ocr-image?url=${encodedUrl}&exp=${expires}&sig=${signature}`;
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

export default async function handler(req: NextApiRequest, res: NextApiResponse<SuggestResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const { cardId } = req.query;
    if (typeof cardId !== "string" || !cardId.trim()) {
      return res.status(400).json({ message: "cardId is required" });
    }
    const queryHints = {
      year: sanitizeText(req.query.year) || null,
      manufacturer: sanitizeText(req.query.manufacturer) || null,
      sport: sanitizeText(req.query.sport) || null,
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
      ...(frontProxyUrl ? [{ id: "FRONT" as const, url: frontProxyUrl }] : []),
      ...(backProxyUrl ? [{ id: "BACK" as const, url: backProxyUrl }] : []),
      ...(tiltProxyUrl ? [{ id: "TILT" as const, url: tiltProxyUrl }] : []),
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

    const ocrResponse = await runGoogleVisionOcr(images);
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

    const regionTemplateLayoutClass = sanitizeText(queryHints.layoutClass || "") || "base";
    const regionTemplateSetId = coerceNullableString(queryHints.setId || queryHints.productLine || fields.setName);
    let regionTemplatesBySide: RegionTemplateMap = {
      FRONT: [],
      BACK: [],
      TILT: [],
    };
    let regionTemplateAudit: {
      setId: string | null;
      layoutClass: string;
      loadedSides: OcrRegionPhotoSide[];
      regionCountBySide: Record<OcrRegionPhotoSide, number>;
      error?: string;
    } = {
      setId: regionTemplateSetId,
      layoutClass: regionTemplateLayoutClass,
      loadedSides: [],
      regionCountBySide: {
        FRONT: 0,
        BACK: 0,
        TILT: 0,
      },
    };
    try {
      if (regionTemplateSetId) {
        const templateState = await listOcrRegionTemplates({
          setId: regionTemplateSetId,
          layoutClass: regionTemplateLayoutClass,
        });
        regionTemplatesBySide = templateState.templatesBySide;
        regionTemplateAudit = {
          ...regionTemplateAudit,
          setId: templateState.setId,
          layoutClass: templateState.layoutClass,
          loadedSides: (["FRONT", "BACK", "TILT"] as OcrRegionPhotoSide[]).filter(
            (side) => (templateState.templatesBySide[side] ?? []).length > 0
          ),
          regionCountBySide: {
            FRONT: templateState.templatesBySide.FRONT.length,
            BACK: templateState.templatesBySide.BACK.length,
            TILT: templateState.templatesBySide.TILT.length,
          },
        };
      }
    } catch (error) {
      regionTemplateAudit = {
        ...regionTemplateAudit,
        error: error instanceof Error ? error.message : "region_template_load_failed",
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
      fields.setName = null;
      fields.insertSet = null;
      fields.parallel = null;
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
        fieldStatus: {
          setName: "cleared_no_set_scope",
          insertSet: "cleared_no_set_scope",
          parallel: "cleared_no_set_scope",
        },
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
      tokens: ocrTokens,
      photoOcr: photoState.byId,
      readiness: photoState.readiness,
      memory: memoryAudit,
      regionTemplates: regionTemplateAudit,
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
