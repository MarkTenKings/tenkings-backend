import type { OcrResponse, OcrToken } from "./googleVisionOcr";

export const AI_GRADER_OCR_MODEL_ENV = "AI_GRADER_OCR_MODEL";
export const DEFAULT_AI_GRADER_OCR_MODEL = "gpt-5.6-sol";

export const AI_GRADER_OCR_FIELD_NAMES = [
  "category",
  "playerName",
  "cardName",
  "year",
  "manufacturer",
  "sport",
  "game",
  "productSet",
  "cardNumber",
  "insert",
  "parallel",
  "numbered",
  "autograph",
  "memorabilia",
] as const;

export type AiGraderOcrFieldName = (typeof AI_GRADER_OCR_FIELD_NAMES)[number];
export type AiGraderOcrExtractionState = "supported" | "unknown" | "disagreement";
export type AiGraderOcrStructuredValue = string | boolean | null;

export type AiGraderOcrStructuredField<T extends AiGraderOcrStructuredValue = AiGraderOcrStructuredValue> = {
  state: AiGraderOcrExtractionState;
  value: T;
  confidence: number;
  evidenceRefs: string[];
};

export type AiGraderOcrStructuredFields = {
  category: AiGraderOcrStructuredField<string | null>;
  playerName: AiGraderOcrStructuredField<string | null>;
  cardName: AiGraderOcrStructuredField<string | null>;
  year: AiGraderOcrStructuredField<string | null>;
  manufacturer: AiGraderOcrStructuredField<string | null>;
  sport: AiGraderOcrStructuredField<string | null>;
  game: AiGraderOcrStructuredField<string | null>;
  productSet: AiGraderOcrStructuredField<string | null>;
  cardNumber: AiGraderOcrStructuredField<string | null>;
  insert: AiGraderOcrStructuredField<string | null>;
  parallel: AiGraderOcrStructuredField<string | null>;
  numbered: AiGraderOcrStructuredField<string | null>;
  autograph: AiGraderOcrStructuredField<boolean | null>;
  memorabilia: AiGraderOcrStructuredField<boolean | null>;
};

export type AiGraderOcrStructuredExtraction = {
  fields: AiGraderOcrStructuredFields;
};

export type AiGraderOcrStructuredImage = {
  side: "front" | "back";
  url: string;
};

export type AiGraderOcrBoundedToken = {
  evidenceRef: string;
  text: string;
  confidence: number;
  side: "front" | "back";
  boundingBox: Array<{ x: number; y: number }>;
};

export type AiGraderOcrBoundedEvidence = {
  sides: Array<{
    side: "front" | "back";
    textEvidenceRef: string;
    text: string;
    confidence: number;
    tokens: AiGraderOcrBoundedToken[];
  }>;
  heuristicHints: Record<string, string | boolean | null>;
};

export type AiGraderOcrStructuredExtractionErrorCode =
  | "missing_config"
  | "invalid_config"
  | "invalid_input"
  | "timeout"
  | "network"
  | "non_2xx"
  | "refusal"
  | "malformed_response";

const ERROR_MESSAGES: Record<AiGraderOcrStructuredExtractionErrorCode, string> = {
  missing_config: "OpenAI is not configured for AI Grader OCR.",
  invalid_config: "The AI Grader OCR model setting is invalid.",
  invalid_input: "AI Grader OCR structured extraction received invalid image or OCR evidence.",
  timeout: "AI Grader OCR structured extraction timed out.",
  network: "AI Grader OCR structured extraction could not reach OpenAI.",
  non_2xx: "OpenAI rejected the AI Grader OCR structured extraction request.",
  refusal: "OpenAI declined the AI Grader OCR structured extraction request.",
  malformed_response: "OpenAI returned an invalid AI Grader OCR structured extraction response.",
};

export class AiGraderOcrStructuredExtractionError extends Error {
  readonly code: AiGraderOcrStructuredExtractionErrorCode;

  constructor(code: AiGraderOcrStructuredExtractionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "AiGraderOcrStructuredExtractionError";
    this.code = code;
  }
}

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_SIDE_TEXT_CHARS = 8_000;
const MAX_TOKENS_PER_SIDE = 250;
const MAX_TOKEN_TEXT_CHARS = 80;
const MAX_FIELD_TEXT_CHARS = 180;
const DEFAULT_TIMEOUT_MS = 45_000;

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  if (!normalized) return null;
  if (/^data:/i.test(normalized) || /https?:\/\//i.test(normalized) || /^[a-z]:\\/i.test(normalized)) return null;
  return normalized;
}

function safeBoundingBox(token: OcrToken) {
  return (Array.isArray(token.bbox) ? token.bbox : [])
    .slice(0, 8)
    .map((point) => ({
      x: Math.max(0, Math.min(100_000, Math.round(Number(point?.x) || 0))),
      y: Math.max(0, Math.min(100_000, Math.round(Number(point?.y) || 0))),
    }));
}

export function effectiveAiGraderOcrModel(env: Record<string, string | undefined> = process.env) {
  const configured = String(env[AI_GRADER_OCR_MODEL_ENV] ?? "").trim();
  const model = configured || DEFAULT_AI_GRADER_OCR_MODEL;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(model)) {
    throw new AiGraderOcrStructuredExtractionError("invalid_config");
  }
  return model;
}

export function buildAiGraderOcrBoundedEvidence(input: {
  ocr: OcrResponse;
  heuristicHints?: Record<string, string | boolean | null | undefined>;
}): AiGraderOcrBoundedEvidence {
  const bySide = new Map(input.ocr.results.map((result) => [result.id, result]));
  const sides = (["front", "back"] as const).map((side) => {
    const result = bySide.get(side);
    const text = String(result?.text ?? "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
      .slice(0, MAX_SIDE_TEXT_CHARS);
    const tokens = (Array.isArray(result?.tokens) ? result.tokens : [])
      .slice(0, MAX_TOKENS_PER_SIDE)
      .flatMap((token, index) => {
        const tokenText = safeText(token.text, MAX_TOKEN_TEXT_CHARS);
        if (!tokenText) return [];
        return [{
          evidenceRef: `google.${side}.token.${index}`,
          text: tokenText,
          confidence: clampConfidence(token.confidence),
          side,
          boundingBox: safeBoundingBox(token),
        }];
      });
    return {
      side,
      textEvidenceRef: `google.${side}.text`,
      text,
      confidence: clampConfidence(result?.confidence),
      tokens,
    };
  });
  const heuristicHints: Record<string, string | boolean | null> = {};
  for (const [key, value] of Object.entries(input.heuristicHints ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key)) continue;
    if (typeof value === "boolean" || value === null) {
      heuristicHints[key] = value;
      continue;
    }
    const normalized = safeText(value, MAX_FIELD_TEXT_CHARS);
    if (normalized) heuristicHints[key] = normalized;
  }
  return { sides, heuristicHints };
}

const stringFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "value", "confidence", "evidenceRefs"],
  properties: {
    state: { type: "string", enum: ["supported", "unknown", "disagreement"] },
    value: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidenceRefs: { type: "array", items: { type: "string" }, maxItems: 24 },
  },
} as const;

const booleanFieldSchema = {
  ...stringFieldSchema,
  properties: {
    ...stringFieldSchema.properties,
    value: { type: ["boolean", "null"] },
  },
} as const;

const categoryFieldSchema = {
  ...stringFieldSchema,
  properties: {
    ...stringFieldSchema.properties,
    value: { enum: ["sport", "tcg", "comics", null] },
  },
} as const;

export const AI_GRADER_OCR_STRUCTURED_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fields"],
  properties: {
    fields: {
      type: "object",
      additionalProperties: false,
      required: [...AI_GRADER_OCR_FIELD_NAMES],
      properties: {
        category: categoryFieldSchema,
        playerName: stringFieldSchema,
        cardName: stringFieldSchema,
        year: stringFieldSchema,
        manufacturer: stringFieldSchema,
        sport: stringFieldSchema,
        game: stringFieldSchema,
        productSet: stringFieldSchema,
        cardNumber: stringFieldSchema,
        insert: stringFieldSchema,
        parallel: stringFieldSchema,
        numbered: stringFieldSchema,
        autograph: booleanFieldSchema,
        memorabilia: booleanFieldSchema,
      },
    },
  },
} as const;

function assertImageUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("unsafe");
    }
  } catch {
    throw new AiGraderOcrStructuredExtractionError("invalid_input");
  }
}

function knownEvidenceRefs(evidence: AiGraderOcrBoundedEvidence) {
  return new Set([
    "image.front",
    "image.back",
    ...evidence.sides.flatMap((side) => [side.textEvidenceRef, ...side.tokens.map((token) => token.evidenceRef)]),
  ]);
}

function extractionInstructions() {
  return [
    "Extract card identity fields for a human-operated grading workflow.",
    "Treat the two normalized images as primary evidence and Google Vision evidence as supporting evidence.",
    "For every field return exactly one state: supported, unknown, or disagreement.",
    "Use supported only when evidence clearly supports the value. Use unknown when evidence is absent or unreadable.",
    "Use disagreement when the images, OCR text, tokens, or heuristic hints materially conflict. Never guess.",
    "For supported fields cite only supplied evidence references, including image.front or image.back for visual evidence.",
    "For unknown or disagreement fields return null value. Confidence must describe support for the emitted state.",
    "numbered is the exact serial inscription such as 23/99, not a card number or a print-run guess.",
    "autograph and memorabilia are tri-state: supported true, supported false, or null with unknown/disagreement.",
    "Do not output teamName. Do not invent catalog spellings, sets, inserts, parallels, players, characters, or card numbers.",
  ].join(" ");
}

export function buildAiGraderOcrStructuredRequest(input: {
  model: string;
  images: AiGraderOcrStructuredImage[];
  evidence: AiGraderOcrBoundedEvidence;
}) {
  const images = [...input.images].sort((left, right) => (left.side === right.side ? 0 : left.side === "front" ? -1 : 1));
  if (images.length !== 2 || images[0]?.side !== "front" || images[1]?.side !== "back") {
    throw new AiGraderOcrStructuredExtractionError("invalid_input");
  }
  images.forEach((image) => assertImageUrl(image.url));
  return {
    model: input.model,
    reasoning: { effort: "medium" },
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: extractionInstructions() }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: `Bounded OCR evidence:\n${JSON.stringify(input.evidence)}` },
          { type: "input_text", text: "Normalized image side: front (evidence reference image.front)" },
          { type: "input_image", image_url: images[0].url, detail: "original" },
          { type: "input_text", text: "Normalized image side: back (evidence reference image.back)" },
          { type: "input_image", image_url: images[1].url, detail: "original" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ai_grader_ocr_structured_extraction",
        strict: true,
        schema: AI_GRADER_OCR_STRUCTURED_OUTPUT_SCHEMA,
      },
    },
  };
}

function responseOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const response = payload as Record<string, unknown>;
  if (response.status === "incomplete") return null;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const entry of content) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      if (row.type === "refusal" || typeof row.refusal === "string") {
        throw new AiGraderOcrStructuredExtractionError("refusal");
      }
      if (row.type === "output_text" && typeof row.text === "string" && row.text.trim()) return row.text.trim();
    }
  }
  return typeof response.output_text === "string" && response.output_text.trim() ? response.output_text.trim() : null;
}

function parseField(
  name: AiGraderOcrFieldName,
  value: unknown,
  allowedEvidenceRefs: ReadonlySet<string>
): AiGraderOcrStructuredField {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (keys.join(",") !== ["confidence", "evidenceRefs", "state", "value"].sort().join(",")) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  const state = row.state;
  if (state !== "supported" && state !== "unknown" && state !== "disagreement") {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  const booleanField = name === "autograph" || name === "memorabilia";
  let normalizedValue: string | boolean | null = null;
  if (booleanField) {
    if (typeof row.value === "boolean") normalizedValue = row.value;
    else if (row.value !== null) throw new AiGraderOcrStructuredExtractionError("malformed_response");
  } else if (typeof row.value === "string") {
    normalizedValue = safeText(row.value, MAX_FIELD_TEXT_CHARS);
    if (!normalizedValue) throw new AiGraderOcrStructuredExtractionError("malformed_response");
  } else if (row.value !== null) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  if (name === "category" && normalizedValue !== null && !["sport", "tcg", "comics"].includes(String(normalizedValue))) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  if ((state === "supported") !== (normalizedValue !== null)) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  if (typeof row.confidence !== "number" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  if (!Array.isArray(row.evidenceRefs) || row.evidenceRefs.length > 24) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  const evidenceRefs = Array.from(new Set(row.evidenceRefs.map((entry) => String(entry))));
  if (evidenceRefs.some((entry) => !allowedEvidenceRefs.has(entry)) || (state === "supported" && evidenceRefs.length < 1)) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  return { state, value: normalizedValue, confidence: clampConfidence(row.confidence), evidenceRefs };
}

export function parseAiGraderOcrStructuredResponse(
  payload: unknown,
  evidence: AiGraderOcrBoundedEvidence
): AiGraderOcrStructuredExtraction {
  const outputText = responseOutputText(payload);
  if (!outputText) throw new AiGraderOcrStructuredExtractionError("malformed_response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  const root = parsed as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !root.fields || typeof root.fields !== "object" || Array.isArray(root.fields)) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  const fields = root.fields as Record<string, unknown>;
  if (Object.keys(fields).sort().join(",") !== [...AI_GRADER_OCR_FIELD_NAMES].sort().join(",")) {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  const refs = knownEvidenceRefs(evidence);
  return {
    fields: Object.fromEntries(
      AI_GRADER_OCR_FIELD_NAMES.map((name) => [name, parseField(name, fields[name], refs)])
    ) as AiGraderOcrStructuredFields,
  };
}

export async function runAiGraderOcrStructuredExtraction(
  input: {
    images: AiGraderOcrStructuredImage[];
    ocr: OcrResponse;
    heuristicHints?: Record<string, string | boolean | null | undefined>;
  },
  dependencies: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {}
): Promise<AiGraderOcrStructuredExtraction & { model: string; evidence: AiGraderOcrBoundedEvidence }> {
  const env = dependencies.env ?? process.env;
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) throw new AiGraderOcrStructuredExtractionError("missing_config");
  const model = effectiveAiGraderOcrModel(env);
  const evidence = buildAiGraderOcrBoundedEvidence({ ocr: input.ocr, heuristicHints: input.heuristicHints });
  const request = buildAiGraderOcrStructuredRequest({ model, images: input.images, evidence });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new AiGraderOcrStructuredExtractionError("timeout");
    }
    throw new AiGraderOcrStructuredExtractionError("network");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new AiGraderOcrStructuredExtractionError("non_2xx");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiGraderOcrStructuredExtractionError("malformed_response");
  }
  return { ...parseAiGraderOcrStructuredResponse(payload, evidence), model, evidence };
}
