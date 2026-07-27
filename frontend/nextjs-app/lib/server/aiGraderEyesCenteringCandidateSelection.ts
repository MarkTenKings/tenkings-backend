import { createHash } from "node:crypto";
import {
  AI_GRADER_EYES_MODEL_ENV,
  AiGraderEyesError,
  DEFAULT_AI_GRADER_EYES_MODEL,
  type AiGraderEyesSourceImage,
} from "./aiGraderEyesSemanticObserver";

export const AI_GRADER_EYES_CENTERING_SELECTION_SCHEMA_VERSION =
  "ai_grader_eyes_centering_edge_candidate_selection_v1" as const;

const SIDES = ["front", "back"] as const;
const EDGES = ["left", "right", "top", "bottom"] as const;
const DECISIONS = ["select_candidate", "reject_all", "unclear"] as const;
const MAXIMUM_CANDIDATES_PER_EDGE = 3;
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 11_000;

export type AiGraderEyesCenteringSide = (typeof SIDES)[number];
export type AiGraderEyesCenteringEdge = (typeof EDGES)[number];
export type AiGraderEyesCenteringDecision = (typeof DECISIONS)[number];

export type AiGraderEyesCenteringCandidateOverlay = {
  side: AiGraderEyesCenteringSide;
  edge: AiGraderEyesCenteringEdge;
  candidateId: string;
  url: string;
  checksumSha256: string;
  deterministicInputSha256: string;
};

export type AiGraderEyesCenteringCandidateDecision = {
  side: AiGraderEyesCenteringSide;
  edge: AiGraderEyesCenteringEdge;
  decision: AiGraderEyesCenteringDecision;
  candidateId: string | null;
  confidence: number;
  rationale: string;
};

export type AiGraderEyesCenteringCandidateSelectionReceipt = {
  schemaVersion: typeof AI_GRADER_EYES_CENTERING_SELECTION_SCHEMA_VERSION;
  status: "observed";
  requestedModel: string;
  actualModel: string;
  requestSha256: string;
  sourceImageBindings: Array<{
    side: AiGraderEyesCenteringSide;
    checksumSha256: string;
  }>;
  candidateBindings: Array<{
    side: AiGraderEyesCenteringSide;
    edge: AiGraderEyesCenteringEdge;
    candidateId: string;
    checksumSha256: string;
    deterministicInputSha256: string;
  }>;
  decisions: AiGraderEyesCenteringCandidateDecision[];
  metricAuthority: "deterministic_calibrated_pixels_only";
  coordinateAuthority: false;
  maximumRemeasurementPasses: 2;
  providerElapsedMs: number;
};

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decisions"],
  properties: {
    decisions: {
      type: "array",
      minItems: 8,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "side",
          "edge",
          "decision",
          "candidateId",
          "confidence",
          "rationale",
        ],
        properties: {
          side: { type: "string", enum: [...SIDES] },
          edge: { type: "string", enum: [...EDGES] },
          decision: { type: "string", enum: [...DECISIONS] },
          candidateId: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
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

function safeCandidateId(value: unknown) {
  const candidateId = String(value ?? "").trim();
  return /^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(candidateId)
    ? candidateId
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

function normalizedSources(images: AiGraderEyesSourceImage[]) {
  const ordered = [...images].sort((left, right) =>
    SIDES.indexOf(left.side) - SIDES.indexOf(right.side));
  if (
    ordered.length !== 2 ||
    ordered.some((image, index) =>
      image.side !== SIDES[index] ||
      !/^https:\/\//i.test(image.url) ||
      !/^[a-f0-9]{64}$/.test(image.checksumSha256))
  ) {
    throw new AiGraderEyesError("invalid_input");
  }
  return ordered;
}

function normalizedCandidates(
  candidates: AiGraderEyesCenteringCandidateOverlay[],
) {
  const ordered = [...candidates].sort((left, right) =>
    SIDES.indexOf(left.side) - SIDES.indexOf(right.side) ||
    EDGES.indexOf(left.edge) - EDGES.indexOf(right.edge) ||
    left.candidateId.localeCompare(right.candidateId));
  const seen = new Set<string>();
  for (const side of SIDES) {
    for (const edge of EDGES) {
      const edgeCandidates = ordered.filter((candidate) =>
        candidate.side === side && candidate.edge === edge);
      if (
        edgeCandidates.length < 1 ||
        edgeCandidates.length > MAXIMUM_CANDIDATES_PER_EDGE
      ) {
        throw new AiGraderEyesError("invalid_input");
      }
    }
  }
  for (const candidate of ordered) {
    const candidateId = safeCandidateId(candidate.candidateId);
    const identity = `${candidate.side}:${candidate.edge}:${candidateId}`;
    if (
      !SIDES.includes(candidate.side) ||
      !EDGES.includes(candidate.edge) ||
      !candidateId ||
      candidateId !== candidate.candidateId ||
      seen.has(identity) ||
      !/^https:\/\//i.test(candidate.url) ||
      !/^[a-f0-9]{64}$/.test(candidate.checksumSha256) ||
      !/^[a-f0-9]{64}$/.test(candidate.deterministicInputSha256)
    ) {
      throw new AiGraderEyesError("invalid_input");
    }
    seen.add(identity);
  }
  return ordered;
}

function sourceBindings(images: AiGraderEyesSourceImage[]) {
  return images.map((image) => ({
    side: image.side,
    checksumSha256: image.checksumSha256,
  }));
}

function candidateBindings(
  candidates: AiGraderEyesCenteringCandidateOverlay[],
) {
  return candidates.map((candidate) => ({
    side: candidate.side,
    edge: candidate.edge,
    candidateId: candidate.candidateId,
    checksumSha256: candidate.checksumSha256,
    deterministicInputSha256: candidate.deterministicInputSha256,
  }));
}

export function aiGraderEyesCenteringSelectionRequestSha256(input: {
  images: AiGraderEyesSourceImage[];
  candidates: AiGraderEyesCenteringCandidateOverlay[];
}) {
  const images = normalizedSources(input.images);
  const candidates = normalizedCandidates(input.candidates);
  return createHash("sha256").update(canonicalJson({
    schemaVersion: AI_GRADER_EYES_CENTERING_SELECTION_SCHEMA_VERSION,
    sourceImageBindings: sourceBindings(images),
    candidateBindings: candidateBindings(candidates),
    metricAuthority: "deterministic_calibrated_pixels_only",
    coordinateAuthority: false,
    maximumRemeasurementPasses: 2,
  }), "utf8").digest("hex");
}

export function buildAiGraderEyesCenteringSelectionRequest(input: {
  model: string;
  images: AiGraderEyesSourceImage[];
  candidates: AiGraderEyesCenteringCandidateOverlay[];
}) {
  const model = safeModel(input.model);
  if (!model) throw new AiGraderEyesError("invalid_config");
  const images = normalizedSources(input.images);
  const candidates = normalizedCandidates(input.candidates);
  const requestSha256 = aiGraderEyesCenteringSelectionRequestSha256({
    images,
    candidates,
  });
  const content: Array<Record<string, unknown>> = [{
    type: "input_text",
    text:
      `You are the non-metric EYES candidate selector for a calibrated trading-card grader. ` +
      `The exact request receipt is ${requestSha256}. ` +
      `For each side and each edge, inspect the source image and its labeled deterministic edge-candidate overlays. ` +
      `Select one candidate only when its labeled line follows that real printed border edge around the card. ` +
      `Reject all when every candidate follows artwork, layout, glare, shadow, the physical cut edge, ` +
      `or when the card has no coherent printed border. Use unclear when the images cannot support a decision. ` +
      `You may return only an exact supplied candidateId or null. Never create coordinates, move a boundary, ` +
      `estimate dimensions, calculate centering, score, grade, or perform remeasurement. ` +
      `Deterministic calibrated pixels remain the only metric authority. ` +
      `Return exactly eight decisions in this order: front left, front right, front top, front bottom, ` +
      `back left, back right, back top, back bottom.`,
  }];
  for (const side of SIDES) {
    const source = images.find((image) => image.side === side)!;
    content.push({
      type: "input_text",
      text: `${side} source image, exact SHA-256 ${source.checksumSha256}.`,
    });
    content.push({
      type: "input_image",
      image_url: source.url,
      detail: "original",
    });
    for (const candidate of candidates.filter((entry) => entry.side === side)) {
      content.push({
        type: "input_text",
        text:
          `${side} ${candidate.edge} deterministic edge candidate ${candidate.candidateId}; overlay SHA-256 ` +
          `${candidate.checksumSha256}; deterministic input SHA-256 ` +
          `${candidate.deterministicInputSha256}.`,
      });
      content.push({
        type: "input_image",
        image_url: candidate.url,
        detail: "original",
      });
    }
  }
  return {
    model,
    store: false,
    reasoning: { effort: "medium" },
    input: [{ role: "user", content }],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "ai_grader_eyes_centering_candidate_selection",
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
      if (row.type === "refusal" || typeof row.refusal === "string") {
        throw new AiGraderEyesError("refusal");
      }
      if (
        row.type === "output_text" &&
        typeof row.text === "string" &&
        row.text.trim()
      ) return row.text.trim();
    }
  }
  return typeof response.output_text === "string" && response.output_text.trim()
    ? response.output_text.trim()
    : null;
}

export function parseAiGraderEyesCenteringSelectionResponse(input: {
  payload: unknown;
  images: AiGraderEyesSourceImage[];
  candidates: AiGraderEyesCenteringCandidateOverlay[];
  requestedModel: string;
  providerElapsedMs: number;
}): AiGraderEyesCenteringCandidateSelectionReceipt {
  const images = normalizedSources(input.images);
  const candidates = normalizedCandidates(input.candidates);
  const text = outputText(input.payload);
  if (!text) throw new AiGraderEyesError("malformed_response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiGraderEyesError("malformed_response");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).join(",") !== "decisions" ||
    !Array.isArray((parsed as Record<string, unknown>).decisions) ||
    ((parsed as Record<string, unknown>).decisions as unknown[]).length !== 8
  ) {
    throw new AiGraderEyesError("malformed_response");
  }
  const decisions = ((parsed as Record<string, unknown>).decisions as unknown[])
    .map((value, index): AiGraderEyesCenteringCandidateDecision => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new AiGraderEyesError("malformed_response");
      }
      const row = value as Record<string, unknown>;
      if (
        Object.keys(row).join(",") !==
          "side,edge,decision,candidateId,confidence,rationale" ||
        row.side !== SIDES[Math.floor(index / EDGES.length)] ||
        row.edge !== EDGES[index % EDGES.length] ||
        !DECISIONS.includes(row.decision as AiGraderEyesCenteringDecision) ||
        typeof row.confidence !== "number" ||
        !Number.isFinite(row.confidence) ||
        row.confidence < 0 ||
        row.confidence > 1
      ) {
        throw new AiGraderEyesError("malformed_response");
      }
      const decision = row.decision as AiGraderEyesCenteringDecision;
      const candidateId = row.candidateId === null
        ? null
        : safeCandidateId(row.candidateId);
      if (
        (decision === "select_candidate" && (
          !candidateId ||
          !candidates.some((candidate) =>
            candidate.side === row.side &&
            candidate.edge === row.edge &&
            candidate.candidateId === candidateId)
        )) ||
        (decision !== "select_candidate" && candidateId !== null)
      ) {
        throw new AiGraderEyesError("malformed_response");
      }
      return {
        side: row.side as AiGraderEyesCenteringSide,
        edge: row.edge as AiGraderEyesCenteringEdge,
        decision,
        candidateId,
        confidence: Number(row.confidence.toFixed(3)),
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
    schemaVersion: AI_GRADER_EYES_CENTERING_SELECTION_SCHEMA_VERSION,
    status: "observed",
    requestedModel: input.requestedModel,
    actualModel,
    requestSha256: aiGraderEyesCenteringSelectionRequestSha256({
      images,
      candidates,
    }),
    sourceImageBindings: sourceBindings(images),
    candidateBindings: candidateBindings(candidates),
    decisions,
    metricAuthority: "deterministic_calibrated_pixels_only",
    coordinateAuthority: false,
    maximumRemeasurementPasses: 2,
    providerElapsedMs: Math.max(
      0,
      Math.min(60_000, Math.round(input.providerElapsedMs)),
    ),
  };
}

export function defaultAiGraderEyesCenteringSelectionModel(
  env: Record<string, string | undefined> = process.env,
) {
  const model = safeModel(
    env[AI_GRADER_EYES_MODEL_ENV] ?? DEFAULT_AI_GRADER_EYES_MODEL,
  );
  if (!model) throw new AiGraderEyesError("invalid_config");
  return model;
}

export async function runAiGraderEyesCenteringSelection(
  input: {
    images: AiGraderEyesSourceImage[];
    candidates: AiGraderEyesCenteringCandidateOverlay[];
  },
  dependencies: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<AiGraderEyesCenteringCandidateSelectionReceipt> {
  const env = dependencies.env ?? process.env;
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) throw new AiGraderEyesError("missing_config");
  const requestedModel = defaultAiGraderEyesCenteringSelectionModel(env);
  const request = buildAiGraderEyesCenteringSelectionRequest({
    model: requestedModel,
    images: input.images,
    candidates: input.candidates,
  });
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(dependencies.timeoutMs)
    ? Math.max(1, Math.min(20_000, Math.round(dependencies.timeoutMs!)))
    : DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(
      OPENAI_RESPONSES_ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
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
  return parseAiGraderEyesCenteringSelectionResponse({
    payload,
    images: input.images,
    candidates: input.candidates,
    requestedModel,
    providerElapsedMs: now() - startedAt,
  });
}
