export const AI_GRADER_OCR_FAILURE_CODES = [
  "AI_GRADER_OCR_GOOGLE_CONFIG_MISSING",
  "AI_GRADER_OCR_GOOGLE_PROVIDER_FAILED",
  "AI_GRADER_OCR_GOOGLE_FRONT_FAILED",
  "AI_GRADER_OCR_GOOGLE_BACK_FAILED",
  "AI_GRADER_OCR_OPENAI_CONFIG_MISSING",
  "AI_GRADER_OCR_OPENAI_TIMEOUT",
  "AI_GRADER_OCR_OPENAI_NETWORK",
  "AI_GRADER_OCR_OPENAI_NON_2XX",
  "AI_GRADER_OCR_OPENAI_REFUSAL",
  "AI_GRADER_OCR_OPENAI_SCHEMA_FAILED",
  "AI_GRADER_OCR_CATALOG_FAILED",
  "AI_GRADER_OCR_INTERNAL_FAILED",
] as const;

export type AiGraderOcrFailureCode = (typeof AI_GRADER_OCR_FAILURE_CODES)[number];
export type AiGraderOcrFailureCategory =
  | "google_configuration"
  | "google_provider"
  | "openai_configuration"
  | "openai_timeout"
  | "openai_network"
  | "openai_non_2xx"
  | "openai_refusal"
  | "openai_schema"
  | "catalog"
  | "internal";

export type AiGraderOcrFailurePresentation = {
  category: AiGraderOcrFailureCategory;
  label: string;
  message: string;
  statusCode: number;
};

const FAILURE_PRESENTATIONS: Record<AiGraderOcrFailureCode, AiGraderOcrFailurePresentation> = {
  AI_GRADER_OCR_GOOGLE_CONFIG_MISSING: {
    category: "google_configuration",
    label: "Google Vision setup",
    message: "Google Vision is not configured, so queued OCR ended in one terminal failure for this exact item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 503,
  },
  AI_GRADER_OCR_GOOGLE_PROVIDER_FAILED: {
    category: "google_provider",
    label: "Google Vision",
    message: "Google Vision could not read the exact normalized card images, so queued OCR ended in one terminal failure for this item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 502,
  },
  AI_GRADER_OCR_GOOGLE_FRONT_FAILED: {
    category: "google_provider",
    label: "Google Vision - front",
    message: "Google Vision could not read the exact normalized front image, so queued OCR ended in one terminal failure for this item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 502,
  },
  AI_GRADER_OCR_GOOGLE_BACK_FAILED: {
    category: "google_provider",
    label: "Google Vision - back",
    message: "Google Vision could not read the exact normalized back image, so queued OCR ended in one terminal failure for this item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 502,
  },
  AI_GRADER_OCR_OPENAI_CONFIG_MISSING: {
    category: "openai_configuration",
    label: "OpenAI setup",
    message: "OpenAI structured extraction is not configured, so queued OCR ended in one terminal failure for this exact item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 503,
  },
  AI_GRADER_OCR_OPENAI_TIMEOUT: {
    category: "openai_timeout",
    label: "OpenAI timeout",
    message: "OpenAI structured extraction timed out, so queued OCR ended in one terminal failure for this exact item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 504,
  },
  AI_GRADER_OCR_OPENAI_NETWORK: {
    category: "openai_network",
    label: "OpenAI connection",
    message: "OpenAI structured extraction could not be reached, so queued OCR ended in one terminal failure for this exact item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 502,
  },
  AI_GRADER_OCR_OPENAI_NON_2XX: {
    category: "openai_non_2xx",
    label: "OpenAI provider",
    message: "OpenAI rejected the structured extraction request, so queued OCR ended in one terminal failure for this exact item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 502,
  },
  AI_GRADER_OCR_OPENAI_REFUSAL: {
    category: "openai_refusal",
    label: "OpenAI refusal",
    message: "OpenAI declined the structured extraction request, so queued OCR ended in one terminal failure for this exact item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 422,
  },
  AI_GRADER_OCR_OPENAI_SCHEMA_FAILED: {
    category: "openai_schema",
    label: "OpenAI structured result",
    message: "OpenAI returned an invalid structured result, so queued OCR ended in one terminal failure for this exact item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 502,
  },
  AI_GRADER_OCR_CATALOG_FAILED: {
    category: "catalog",
    label: "Ten Kings catalog",
    message: "Ten Kings catalog validation could not complete, so queued OCR ended in one terminal failure for this exact item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 503,
  },
  AI_GRADER_OCR_INTERNAL_FAILED: {
    category: "internal",
    label: "OCR Prefill",
    message: "OCR Prefill could not complete safely, so queued OCR ended in one terminal failure for this exact item. This failed item cannot be reviewed or published in the station, and OCR will not rerun.",
    statusCode: 502,
  },
};

export function isAiGraderOcrFailureCode(value: unknown): value is AiGraderOcrFailureCode {
  return typeof value === "string" && (AI_GRADER_OCR_FAILURE_CODES as readonly string[]).includes(value);
}

export function aiGraderOcrFailurePresentation(code: AiGraderOcrFailureCode) {
  return FAILURE_PRESENTATIONS[code];
}

export class AiGraderOcrFailure extends Error {
  readonly code: AiGraderOcrFailureCode;
  readonly category: AiGraderOcrFailureCategory;
  readonly statusCode: number;

  constructor(code: AiGraderOcrFailureCode) {
    const presentation = aiGraderOcrFailurePresentation(code);
    super(presentation.message);
    this.name = "AiGraderOcrFailure";
    this.code = code;
    this.category = presentation.category;
    this.statusCode = presentation.statusCode;
  }
}
