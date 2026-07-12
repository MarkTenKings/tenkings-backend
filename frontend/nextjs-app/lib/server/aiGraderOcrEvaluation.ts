export const AI_GRADER_OCR_EVALUATION_FIELDS = [
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

export type AiGraderOcrEvaluationFieldName = (typeof AI_GRADER_OCR_EVALUATION_FIELDS)[number];
export type AiGraderOcrEvaluationValue = string | boolean | null;

export type AiGraderOcrGroundTruthRecord = {
  fields: Record<AiGraderOcrEvaluationFieldName, AiGraderOcrEvaluationValue>;
};

export type AiGraderOcrEvaluationResultRecord = {
  latencyMs: number;
  fields: Record<AiGraderOcrEvaluationFieldName, {
    state: "supported" | "unknown" | "disagreement";
    value: AiGraderOcrEvaluationValue;
  }>;
};

export type AiGraderOcrEvaluationCase = {
  groundTruth: AiGraderOcrGroundTruthRecord;
  result: AiGraderOcrEvaluationResultRecord;
};

export type AiGraderOcrEvaluationMetric = {
  caseCount: number;
  supportedPredictions: number;
  expectedValues: number;
  correctSupported: number;
  precision: number | null;
  recall: number | null;
  supportedCoverage: number | null;
  unknownRate: number;
  disagreementRate: number;
};

export type AiGraderOcrEvaluationSummary = {
  schemaVersion: "ai-grader-ocr-evaluation-summary-v1";
  caseCount: number;
  fields: Record<AiGraderOcrEvaluationFieldName, AiGraderOcrEvaluationMetric>;
  latency: {
    sampleCount: number;
    meanMs: number | null;
    p95Ms: number | null;
  };
  note: string;
};

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function normalizedValue(value: AiGraderOcrEvaluationValue) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : value;
}

function validGroundTruth(value: unknown): value is AiGraderOcrGroundTruthRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = (value as Record<string, unknown>).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return false;
  return AI_GRADER_OCR_EVALUATION_FIELDS.every((name) => {
    const field = (fields as Record<string, unknown>)[name];
    return field === null || typeof field === "string" || typeof field === "boolean";
  });
}

function validResult(value: unknown): value is AiGraderOcrEvaluationResultRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.latencyMs !== "number" || !Number.isFinite(row.latencyMs) || row.latencyMs < 0) return false;
  if (!row.fields || typeof row.fields !== "object" || Array.isArray(row.fields)) return false;
  return AI_GRADER_OCR_EVALUATION_FIELDS.every((name) => {
    const field = (row.fields as Record<string, unknown>)[name];
    if (!field || typeof field !== "object" || Array.isArray(field)) return false;
    const typed = field as Record<string, unknown>;
    if (!["supported", "unknown", "disagreement"].includes(String(typed.state))) return false;
    const validValue = typed.value === null || typeof typed.value === "string" || typeof typed.value === "boolean";
    if (!validValue) return false;
    return typed.state === "supported" ? typed.value !== null : typed.value === null;
  });
}

export function parseAiGraderOcrEvaluationCase(input: {
  groundTruth: unknown;
  result: unknown;
}): AiGraderOcrEvaluationCase {
  if (!validGroundTruth(input.groundTruth) || !validResult(input.result)) {
    throw new Error("AI Grader OCR evaluation input does not match the aggregate evaluator contract.");
  }
  return { groundTruth: input.groundTruth, result: input.result };
}

export function evaluateAiGraderOcrCases(cases: AiGraderOcrEvaluationCase[]): AiGraderOcrEvaluationSummary {
  if (!Array.isArray(cases) || cases.length < 1) {
    throw new Error("At least one AI Grader OCR evaluation case is required.");
  }
  const fields = Object.fromEntries(AI_GRADER_OCR_EVALUATION_FIELDS.map((name) => {
    let supportedPredictions = 0;
    let expectedValues = 0;
    let correctSupported = 0;
    let supportedExpected = 0;
    let unknownCount = 0;
    let disagreementCount = 0;
    for (const entry of cases) {
      const expected = entry.groundTruth.fields[name];
      const actual = entry.result.fields[name];
      if (expected !== null) expectedValues += 1;
      if (actual.state === "supported") {
        supportedPredictions += 1;
        if (expected !== null) supportedExpected += 1;
        if (expected !== null && normalizedValue(expected) === normalizedValue(actual.value)) correctSupported += 1;
      } else if (actual.state === "unknown") {
        unknownCount += 1;
      } else {
        disagreementCount += 1;
      }
    }
    return [name, {
      caseCount: cases.length,
      supportedPredictions,
      expectedValues,
      correctSupported,
      precision: ratio(correctSupported, supportedPredictions),
      recall: ratio(correctSupported, expectedValues),
      supportedCoverage: ratio(supportedExpected, expectedValues),
      unknownRate: ratio(unknownCount, cases.length) ?? 0,
      disagreementRate: ratio(disagreementCount, cases.length) ?? 0,
    }];
  })) as Record<AiGraderOcrEvaluationFieldName, AiGraderOcrEvaluationMetric>;
  const latencies = cases.map((entry) => entry.result.latencyMs).sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
  return {
    schemaVersion: "ai-grader-ocr-evaluation-summary-v1",
    caseCount: cases.length,
    fields,
    latency: {
      sampleCount: latencies.length,
      meanMs: latencies.length
        ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(3))
        : null,
      p95Ms: latencies[p95Index] ?? null,
    },
    note: "Aggregate evaluator output only; unit or synthetic fixtures do not establish production accuracy.",
  };
}
