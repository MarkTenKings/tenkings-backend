import { createHash } from "node:crypto";

export const AI_GRADER_EYES_SCHEMA_VERSION = "ai_grader_eyes_semantic_observer_v1" as const;
export const AI_GRADER_EYES_MODEL_ENV = "AI_GRADER_EYES_MODEL";
export const DEFAULT_AI_GRADER_EYES_MODEL = "gpt-5.6-sol";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 20_000;
const ELEMENTS = ["centering", "corners", "edges", "surface"] as const;
const SEMANTIC_STATES = [
  "printed_border_supported",
  "artwork_or_layout_not_border",
  "no_coherent_printed_border",
  "no_visible_physical_concern",
  "visible_physical_concern",
  "unclear",
] as const;

export type AiGraderEyesElement = (typeof ELEMENTS)[number];
export type AiGraderEyesSemanticState = (typeof SEMANTIC_STATES)[number];

export type AiGraderEyesSourceImage = {
  side: "front" | "back";
  url: string;
  checksumSha256: string;
};

export type AiGraderEyesElementObservation = {
  element: AiGraderEyesElement;
  semanticState: AiGraderEyesSemanticState;
  challengeDeterministicInterpretation: boolean;
  requiresOperatorReview: boolean;
  confidence: number;
  evidenceRefs: Array<"image.front" | "image.back">;
  rationale: string;
};

export type AiGraderEyesSemanticReceipt = {
  schemaVersion: typeof AI_GRADER_EYES_SCHEMA_VERSION;
  status: "observed";
  requestedModel: string;
  actualModel: string;
  requestSha256: string;
  imageBindings: Array<{
    side: "front" | "back";
    checksumSha256: string;
    evidenceRef: "image.front" | "image.back";
  }>;
  observations: AiGraderEyesElementObservation[];
  reviewElements: AiGraderEyesElement[];
  metricAuthority: "deterministic_calibrated_pixels_only";
  wholeCardFailureAuthority: false;
  providerElapsedMs: number;
};

export type AiGraderEyesUnavailableReceipt = {
  schemaVersion: typeof AI_GRADER_EYES_SCHEMA_VERSION;
  status: "unavailable";
  requestSha256: string;
  imageBindings: AiGraderEyesSemanticReceipt["imageBindings"];
  observations: [];
  reviewElements: [];
  metricAuthority: "deterministic_calibrated_pixels_only";
  wholeCardFailureAuthority: false;
  reason: "not_configured" | "timeout" | "provider_unavailable" | "invalid_response";
};

export type AiGraderEyesReceipt = AiGraderEyesSemanticReceipt | AiGraderEyesUnavailableReceipt;

export type AiGraderEyesErrorCode =
  | "missing_config"
  | "invalid_config"
  | "invalid_input"
  | "timeout"
  | "network"
  | "non_2xx"
  | "refusal"
  | "malformed_response";

export class AiGraderEyesError extends Error {
  readonly code: AiGraderEyesErrorCode;

  constructor(code: AiGraderEyesErrorCode) {
    super(`AI Grader EYES ${code}.`);
    this.name = "AiGraderEyesError";
    this.code = code;
  }
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["observations"],
  properties: {
    observations: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "element",
          "semanticState",
          "challengeDeterministicInterpretation",
          "requiresOperatorReview",
          "confidence",
          "evidenceRefs",
          "rationale",
        ],
        properties: {
          element: { type: "string", enum: [...ELEMENTS] },
          semanticState: { type: "string", enum: [...SEMANTIC_STATES] },
          challengeDeterministicInterpretation: { type: "boolean" },
          requiresOperatorReview: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidenceRefs: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            uniqueItems: true,
            items: { type: "string", enum: ["image.front", "image.back"] },
          },
          rationale: { type: "string", minLength: 1, maxLength: 240 },
        },
      },
    },
  },
} as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function safeModel(value: unknown) {
  const model = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(model) ? model : null;
}

function normalizeImages(images: AiGraderEyesSourceImage[]) {
  const ordered = [...images].sort((left, right) => left.side === "front" ? -1 : 1);
  if (
    ordered.length !== 2 ||
    ordered[0]?.side !== "front" ||
    ordered[1]?.side !== "back" ||
    ordered.some((image) =>
      !/^https:\/\//i.test(image.url) ||
      !/^[a-f0-9]{64}$/.test(image.checksumSha256)
    )
  ) {
    throw new AiGraderEyesError("invalid_input");
  }
  return ordered;
}

function imageBindings(images: AiGraderEyesSourceImage[]) {
  return images.map((image) => ({
    side: image.side,
    checksumSha256: image.checksumSha256,
    evidenceRef: `image.${image.side}` as const,
  }));
}

export function aiGraderEyesRequestSha256(images: AiGraderEyesSourceImage[]) {
  const bindings = imageBindings(normalizeImages(images));
  return createHash("sha256").update(canonicalJson({
    schemaVersion: AI_GRADER_EYES_SCHEMA_VERSION,
    imageBindings: bindings,
    semanticElements: ELEMENTS,
    metricAuthority: "deterministic_calibrated_pixels_only",
  }), "utf8").digest("hex");
}

export function buildAiGraderEyesRequest(input: {
  model: string;
  images: AiGraderEyesSourceImage[];
}) {
  const model = safeModel(input.model);
  if (!model) throw new AiGraderEyesError("invalid_config");
  const images = normalizeImages(input.images);
  const requestSha256 = aiGraderEyesRequestSha256(images);
  return {
    model,
    store: false,
    reasoning: { effort: "medium" },
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            `You are the non-metric semantic EYES challenger for a calibrated trading-card grader. ` +
            `The request receipt is ${requestSha256}. Inspect the exact front and back images. ` +
            `For centering, decide whether a coherent printed border is genuinely visible, or whether an apparent line is artwork/layout. ` +
            `For corners, edges, and surface, report only visible physical-condition concerns versus artwork, printing, lighting, or uncertainty. ` +
            `Do not estimate dimensions, radius, centering ratios, defect sizes, scores, or grades. ` +
            `Do not create or move boundaries. Deterministic calibrated pixels remain the only measurement authority. ` +
            `Use unclear when the image does not support a semantic conclusion. ` +
            `challengeDeterministicInterpretation must be true only for artwork/layout mistaken as border or a visible physical concern that deterministic interpretation should re-check. ` +
            `requiresOperatorReview must equal challengeDeterministicInterpretation or semanticState=unclear. ` +
            `Return exactly one observation in this order: centering, corners, edges, surface.`,
        },
        { type: "input_text", text: `Front image. Exact SHA-256 ${images[0]!.checksumSha256}. Evidence reference image.front.` },
        { type: "input_image", image_url: images[0]!.url, detail: "original" },
        { type: "input_text", text: `Back image. Exact SHA-256 ${images[1]!.checksumSha256}. Evidence reference image.back.` },
        { type: "input_image", image_url: images[1]!.url, detail: "original" },
      ],
    }],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "ai_grader_eyes_semantic_observer",
        strict: true,
        schema: OUTPUT_SCHEMA,
      },
    },
  };
}

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const response = payload as Record<string, unknown>;
  if (response.status === "incomplete") return null;
  for (const item of Array.isArray(response.output) ? response.output : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const entry of Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : []) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      if (row.type === "refusal" || typeof row.refusal === "string") throw new AiGraderEyesError("refusal");
      if (row.type === "output_text" && typeof row.text === "string" && row.text.trim()) return row.text.trim();
    }
  }
  return typeof response.output_text === "string" && response.output_text.trim()
    ? response.output_text.trim()
    : null;
}

function safeRationale(value: unknown) {
  const rationale = String(value ?? "").trim();
  if (
    !rationale ||
    rationale.length > 240 ||
    /[\u0000-\u001f\u007f]/.test(rationale) ||
    /https?:\/\/|^data:|^[a-z]:\\|^\\\\/i.test(rationale)
  ) {
    throw new AiGraderEyesError("malformed_response");
  }
  return rationale;
}

export function parseAiGraderEyesResponse(input: {
  payload: unknown;
  images: AiGraderEyesSourceImage[];
  requestedModel: string;
  providerElapsedMs: number;
}): AiGraderEyesSemanticReceipt {
  const images = normalizeImages(input.images);
  const text = outputText(input.payload);
  if (!text) throw new AiGraderEyesError("malformed_response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiGraderEyesError("malformed_response");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AiGraderEyesError("malformed_response");
  const root = parsed as Record<string, unknown>;
  if (Object.keys(root).join(",") !== "observations" || !Array.isArray(root.observations) || root.observations.length !== 4) {
    throw new AiGraderEyesError("malformed_response");
  }
  const observations = root.observations.map((value, index): AiGraderEyesElementObservation => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiGraderEyesError("malformed_response");
    const row = value as Record<string, unknown>;
    const element = row.element;
    const semanticState = row.semanticState;
    if (element !== ELEMENTS[index] || !SEMANTIC_STATES.includes(semanticState as AiGraderEyesSemanticState)) {
      throw new AiGraderEyesError("malformed_response");
    }
    const centeringState = semanticState === "printed_border_supported" ||
      semanticState === "artwork_or_layout_not_border" ||
      semanticState === "no_coherent_printed_border" ||
      semanticState === "unclear";
    const conditionState = semanticState === "no_visible_physical_concern" ||
      semanticState === "visible_physical_concern" ||
      semanticState === "unclear";
    if ((element === "centering" && !centeringState) || (element !== "centering" && !conditionState)) {
      throw new AiGraderEyesError("malformed_response");
    }
    if (
      typeof row.challengeDeterministicInterpretation !== "boolean" ||
      typeof row.requiresOperatorReview !== "boolean" ||
      row.requiresOperatorReview !== (row.challengeDeterministicInterpretation || semanticState === "unclear") ||
      typeof row.confidence !== "number" ||
      !Number.isFinite(row.confidence) ||
      row.confidence < 0 ||
      row.confidence > 1 ||
      !Array.isArray(row.evidenceRefs) ||
      row.evidenceRefs.length < 1 ||
      row.evidenceRefs.length > 2
    ) {
      throw new AiGraderEyesError("malformed_response");
    }
    const refs = row.evidenceRefs.map(String);
    if (
      new Set(refs).size !== refs.length ||
      refs.some((ref) => ref !== "image.front" && ref !== "image.back")
    ) {
      throw new AiGraderEyesError("malformed_response");
    }
    return {
      element: element as AiGraderEyesElement,
      semanticState: semanticState as AiGraderEyesSemanticState,
      challengeDeterministicInterpretation: row.challengeDeterministicInterpretation,
      requiresOperatorReview: row.requiresOperatorReview,
      confidence: Number(row.confidence.toFixed(3)),
      evidenceRefs: refs as Array<"image.front" | "image.back">,
      rationale: safeRationale(row.rationale),
    };
  });
  const actualModel = safeModel(
    input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? (input.payload as Record<string, unknown>).model
      : null,
  );
  if (!actualModel) throw new AiGraderEyesError("malformed_response");
  return {
    schemaVersion: AI_GRADER_EYES_SCHEMA_VERSION,
    status: "observed",
    requestedModel: input.requestedModel,
    actualModel,
    requestSha256: aiGraderEyesRequestSha256(images),
    imageBindings: imageBindings(images),
    observations,
    reviewElements: observations.filter((entry) => entry.requiresOperatorReview).map((entry) => entry.element),
    metricAuthority: "deterministic_calibrated_pixels_only",
    wholeCardFailureAuthority: false,
    providerElapsedMs: Math.max(0, Math.min(60_000, Math.round(input.providerElapsedMs))),
  };
}

function boundedTimeout(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1, Math.min(30_000, Math.round(value!)));
}

export async function runAiGraderEyesSemanticObservation(
  input: { images: AiGraderEyesSourceImage[] },
  dependencies: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<AiGraderEyesSemanticReceipt> {
  const env = dependencies.env ?? process.env;
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) throw new AiGraderEyesError("missing_config");
  const requestedModel = safeModel(env[AI_GRADER_EYES_MODEL_ENV] ?? DEFAULT_AI_GRADER_EYES_MODEL);
  if (!requestedModel) throw new AiGraderEyesError("invalid_config");
  const request = buildAiGraderEyesRequest({ model: requestedModel, images: input.images });
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeout(dependencies.timeoutMs));
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
      throw new AiGraderEyesError("timeout");
    }
    throw new AiGraderEyesError("network");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new AiGraderEyesError("non_2xx");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiGraderEyesError("malformed_response");
  }
  return parseAiGraderEyesResponse({
    payload,
    images: input.images,
    requestedModel,
    providerElapsedMs: now() - startedAt,
  });
}

export function unavailableAiGraderEyesReceipt(
  images: AiGraderEyesSourceImage[],
  error: unknown,
): AiGraderEyesUnavailableReceipt {
  const normalized = normalizeImages(images);
  const code = error instanceof AiGraderEyesError ? error.code : "malformed_response";
  const reason: AiGraderEyesUnavailableReceipt["reason"] =
    code === "missing_config" || code === "invalid_config"
      ? "not_configured"
      : code === "timeout"
        ? "timeout"
        : code === "malformed_response" || code === "refusal"
          ? "invalid_response"
          : "provider_unavailable";
  return {
    schemaVersion: AI_GRADER_EYES_SCHEMA_VERSION,
    status: "unavailable",
    requestSha256: aiGraderEyesRequestSha256(normalized),
    imageBindings: imageBindings(normalized),
    observations: [],
    reviewElements: [],
    metricAuthority: "deterministic_calibrated_pixels_only",
    wholeCardFailureAuthority: false,
    reason,
  };
}
