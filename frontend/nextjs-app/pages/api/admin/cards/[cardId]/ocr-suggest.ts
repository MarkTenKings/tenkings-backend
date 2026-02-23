import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { normalizeStorageUrl } from "../../../../../lib/server/storage";
import { runGoogleVisionOcr } from "../../../../../lib/server/googleVisionOcr";
import { extractCardAttributes, resolveOcrLlmAttempt } from "@tenkings/shared";
import { runVariantMatch } from "../../../../../lib/server/variantMatcher";

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
};

type LlmParsedPayload = {
  fields: SuggestionFields;
  confidence: SuggestionConfidence;
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
  ocrText: string,
  imageSections: OcrImageSection[]
): Promise<LlmParseResponse | null> {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }
  if (!ocrText.trim()) {
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

  const systemInstruction =
    "Extract card metadata from OCR text. Return only JSON that matches the schema. Use null for unknown fields.";
  const userPrompt = `OCR combined text:\n${ocrText}\n\nOCR by photo:\n${labeledSections}`;
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
    const response = await fetch("https://api.openai.com/v1/responses", {
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
            content: [{ type: "input_text", text: userPrompt }],
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

    const bodyText = await response.text().catch(() => "");
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
    },
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

function toMemoryToken(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function isTruthyString(value: string | null | undefined): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return TRUE_STRINGS.has(normalized);
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
}) {
  const { fields, confidence } = params;
  const context: MemoryContext = {
    setId: coerceNullableString(fields.setName),
    year: coerceNullableString(fields.year),
    manufacturer: coerceNullableString(fields.manufacturer),
    sport: coerceNullableString(fields.sport),
    cardNumber: coerceNullableString(fields.cardNumber),
    numbered: coerceNullableString(fields.numbered),
  };

  const orClauses: Record<string, string>[] = [];
  if (context.setId) orClauses.push({ setId: context.setId });
  if (context.cardNumber) orClauses.push({ cardNumber: context.cardNumber });
  if (context.year) orClauses.push({ year: context.year });
  if (context.manufacturer) orClauses.push({ manufacturer: context.manufacturer });
  if (context.sport) orClauses.push({ sport: context.sport });
  if (orClauses.length === 0) {
    return {
      context,
      consideredRows: 0,
      applied: [] as MemoryApplyEntry[],
    };
  }

  const rows = (await (prisma as any).ocrFeedbackEvent.findMany({
    where: {
      fieldName: { in: FIELD_KEYS },
      humanValue: { not: null },
      OR: orClauses,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 500,
    select: {
      fieldName: true,
      humanValue: true,
      wasCorrect: true,
      setId: true,
      year: true,
      manufacturer: true,
      sport: true,
      cardNumber: true,
      numbered: true,
      createdAt: true,
    },
  })) as Array<{
    fieldName: string;
    humanValue: string | null;
    wasCorrect: boolean;
    setId: string | null;
    year: string | null;
    manufacturer: string | null;
    sport: string | null;
    cardNumber: string | null;
    numbered: string | null;
    createdAt: Date;
  }>;

  type CandidateAggregate = {
    field: keyof SuggestionFields;
    value: string;
    score: number;
    support: number;
  };

  const aggregateByFieldValue = new Map<string, CandidateAggregate>();
  const nowMs = Date.now();
  rows.forEach((row) => {
    const field = row.fieldName as keyof SuggestionFields;
    if (!FIELD_KEYS.includes(field)) {
      return;
    }
    // Do not memory-overwrite set selection globally; this caused cross-card set drift.
    if (field === "setName") {
      return;
    }
    const humanValue = coerceNullableString(row.humanValue);
    if (!humanValue) {
      return;
    }
    if (BOOLEAN_MEMORY_FIELDS.has(field) && !isTruthyString(humanValue)) {
      return;
    }

    let score = 0.2;
    const rowSet = toMemoryToken(row.setId);
    const rowYear = toMemoryToken(row.year);
    const rowManufacturer = toMemoryToken(row.manufacturer);
    const rowSport = toMemoryToken(row.sport);
    const rowCardNumber = toMemoryToken(row.cardNumber);
    const rowNumbered = toMemoryToken(row.numbered);
    const ctxSet = toMemoryToken(context.setId);
    const ctxYear = toMemoryToken(context.year);
    const ctxManufacturer = toMemoryToken(context.manufacturer);
    const ctxSport = toMemoryToken(context.sport);
    const ctxCardNumber = toMemoryToken(context.cardNumber);
    const ctxNumbered = toMemoryToken(context.numbered);

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
    }

    if (ctxSet && rowSet === ctxSet) score += 2.2;
    if (ctxCardNumber && rowCardNumber === ctxCardNumber) score += 1.5;
    if (ctxYear && rowYear === ctxYear) score += 0.8;
    if (ctxManufacturer && rowManufacturer === ctxManufacturer) score += 0.9;
    if (ctxSport && rowSport === ctxSport) score += 0.9;
    if (ctxNumbered && rowNumbered === ctxNumbered) score += 0.6;
    score += row.wasCorrect ? 0.15 : 0.35;

    const ageDays = Math.max(0, (nowMs - new Date(row.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    const recencyMultiplier = Math.max(0.2, 1 - Math.min(1, ageDays / 180));
    score *= recencyMultiplier;

    const aggregateKey = `${field}::${humanValue.toLowerCase()}`;
    const current = aggregateByFieldValue.get(aggregateKey);
    if (current) {
      current.score += score;
      current.support += 1;
    } else {
      aggregateByFieldValue.set(aggregateKey, {
        field,
        value: humanValue,
        score,
        support: 1,
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
    if (!top || top.score < 1.2) {
      return;
    }
    const learnedConfidence = Math.min(0.98, 0.55 + Math.min(0.4, top.score / 5));
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
        "gold",
        "silver",
        "black",
        "green",
        "blue",
        "red",
        "purple",
        "orange",
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

    let llmMeta: LlmParseMeta | null = null;
    try {
      const llmResult = await parseWithLlm(combinedTextRaw, imageSections);
      if (llmResult) {
        llmMeta = llmResult.meta;
        FIELD_KEYS.forEach((key) => {
          if (llmResult.fields[key]) {
            fields[key] = llmResult.fields[key];
          }
          if (llmResult.confidence[key] != null) {
            confidence[key] = llmResult.confidence[key];
          } else if (fields[key]) {
            confidence[key] = 0.85;
          }
        });
      }
    } catch (error) {
      console.warn("LLM OCR parse failed; using heuristic suggestions", error);
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
      memoryAudit = await applyFeedbackMemoryHints({ fields, confidence });
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

    const suggestions: Record<string, string> = {};
    FIELD_KEYS.forEach((key) => {
      const value = fields[key];
      const score = confidence[key];
      if (value && score != null && score >= DEFAULT_THRESHOLD) {
        suggestions[key] = value;
      }
    });

    const audit = {
      source: "google-vision+llm",
      model: `google-vision|${llmMeta?.model ?? OCR_LLM_MODEL}`,
      threshold: DEFAULT_THRESHOLD,
      createdAt: new Date().toISOString(),
      fields,
      confidence,
      llm: llmMeta,
      tokens: ocrTokens,
      photoOcr: photoState.byId,
      readiness: photoState.readiness,
      memory: memoryAudit,
      variantMatch: variantMatchAudit,
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
