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
    message: "Google Vision is not configured for AI Grader OCR. Check redacted readiness, then retry. Manual Confirm Card remains available.",
    statusCode: 503,
  },
  AI_GRADER_OCR_GOOGLE_PROVIDER_FAILED: {
    category: "google_provider",
    label: "Google Vision",
    message: "Google Vision could not read the normalized card images. Retry OCR or continue with manual Confirm Card.",
    statusCode: 502,
  },
  AI_GRADER_OCR_GOOGLE_FRONT_FAILED: {
    category: "google_provider",
    label: "Google Vision - front",
    message: "Google Vision could not read the normalized front image. Retry OCR or continue with manual Confirm Card.",
    statusCode: 502,
  },
  AI_GRADER_OCR_GOOGLE_BACK_FAILED: {
    category: "google_provider",
    label: "Google Vision - back",
    message: "Google Vision could not read the normalized back image. Retry OCR or continue with manual Confirm Card.",
    statusCode: 502,
  },
  AI_GRADER_OCR_OPENAI_CONFIG_MISSING: {
    category: "openai_configuration",
    label: "OpenAI setup",
    message: "OpenAI is not configured correctly for AI Grader OCR. Check redacted readiness, then retry. Manual Confirm Card remains available.",
    statusCode: 503,
  },
  AI_GRADER_OCR_OPENAI_TIMEOUT: {
    category: "openai_timeout",
    label: "OpenAI timeout",
    message: "OpenAI structured OCR extraction timed out. Retry OCR or continue with manual Confirm Card.",
    statusCode: 504,
  },
  AI_GRADER_OCR_OPENAI_NETWORK: {
    category: "openai_network",
    label: "OpenAI connection",
    message: "OpenAI structured OCR extraction could not be reached. Retry OCR or continue with manual Confirm Card.",
    statusCode: 502,
  },
  AI_GRADER_OCR_OPENAI_NON_2XX: {
    category: "openai_non_2xx",
    label: "OpenAI provider",
    message: "OpenAI rejected the structured OCR extraction request. Retry OCR or continue with manual Confirm Card.",
    statusCode: 502,
  },
  AI_GRADER_OCR_OPENAI_REFUSAL: {
    category: "openai_refusal",
    label: "OpenAI refusal",
    message: "OpenAI declined the structured OCR extraction request. Review the card manually or retry OCR.",
    statusCode: 422,
  },
  AI_GRADER_OCR_OPENAI_SCHEMA_FAILED: {
    category: "openai_schema",
    label: "OpenAI structured result",
    message: "OpenAI returned an invalid structured OCR result. Retry OCR or continue with manual Confirm Card.",
    statusCode: 502,
  },
  AI_GRADER_OCR_CATALOG_FAILED: {
    category: "catalog",
    label: "Ten Kings catalog",
    message: "Ten Kings catalog validation could not complete. Retry OCR or enter the identity manually before Confirm Card.",
    statusCode: 503,
  },
  AI_GRADER_OCR_INTERNAL_FAILED: {
    category: "internal",
    label: "OCR Prefill",
    message: "OCR Prefill could not complete safely. Retry OCR or continue with manual Confirm Card.",
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
