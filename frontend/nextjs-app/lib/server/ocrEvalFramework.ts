import { Prisma, prisma } from "@tenkings/database";
import { normalizeVariantLabelKey, sanitizeText } from "./variantOptionPool";

export type OcrEvalThresholds = {
  minCases: number;
  setTop1Min: number;
  insertParallelTop1Min: number;
  insertParallelTop3Min: number;
  casePassRateMin: number;
  unknownRateMax: number;
  wrongSetRateMax: number;
  crossSetMemoryDriftMax: number;
};

export type OcrEvalExpected = {
  setName?: string | null;
  insertSet?: string | null;
  parallel?: string | null;
};

export type OcrEvalHints = {
  year?: string | null;
  manufacturer?: string | null;
  sport?: string | null;
  productLine?: string | null;
  setId?: string | null;
  layoutClass?: string | null;
};

export type OcrEvalCaseInput = {
  slug: string;
  title: string;
  description?: string | null;
  cardAssetId: string;
  enabled?: boolean;
  tags?: string[];
  expected: OcrEvalExpected;
  hints?: OcrEvalHints;
};

export type OcrEvalCaseRecord = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  cardAssetId: string;
  enabled: boolean;
  tags: string[];
  expected: OcrEvalExpected;
  hints: OcrEvalHints;
  updatedAt: string;
};

export type OcrEvalCaseResult = {
  caseId: string;
  slug: string;
  title: string;
  cardAssetId: string;
  passed: boolean;
  expected: OcrEvalExpected;
  predicted: OcrEvalExpected;
  fieldScores: {
    setName?: "correct" | "wrong" | "unknown";
    insertSet?: "correct" | "wrong" | "unknown";
    parallel?: "correct" | "wrong" | "unknown";
  };
  notes: string[];
};

export type OcrEvalTopCandidates = Partial<Record<keyof OcrEvalExpected, string[]>>;

export type OcrEvalCaseMeta = {
  memoryApplied?: boolean | null;
};

export type OcrEvalSummary = {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  casePassRatePct: number | null;
  opportunities: {
    set: number;
    insertParallel: number;
    insertParallelTop3: number;
    memoryDrift: number;
  };
  metrics: {
    setTop1AccuracyPct: number | null;
    insertParallelTop1AccuracyPct: number | null;
    insertParallelTop3AccuracyPct: number | null;
    unknownRatePct: number | null;
    wrongSetRatePct: number | null;
    crossSetMemoryDriftPct: number | null;
  };
  gate: {
    pass: boolean;
    failedChecks: string[];
    thresholds: OcrEvalThresholds;
  };
};

const DEFAULT_THRESHOLDS: OcrEvalThresholds = {
  minCases: 12,
  setTop1Min: 0.8,
  insertParallelTop1Min: 0.75,
  insertParallelTop3Min: 0.9,
  casePassRateMin: 0.75,
  unknownRateMax: 0.45,
  wrongSetRateMax: 0.12,
  crossSetMemoryDriftMax: 0.08,
};

function coerceNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return fallback;
}

function clampRate(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return Number(value.toFixed(4));
}

function clampInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeExpectedField(value: string | null | undefined): string | null {
  const cleaned = sanitizeText(value);
  if (!cleaned) {
    return null;
  }
  return cleaned;
}

function normalizeComparableValue(value: string | null | undefined): string {
  const cleaned = normalizeExpectedField(value);
  if (!cleaned) {
    return "";
  }
  return normalizeVariantLabelKey(cleaned);
}

function toPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function hasOwn(expected: OcrEvalExpected, key: keyof OcrEvalExpected): boolean {
  return Object.prototype.hasOwnProperty.call(expected, key);
}

function normalizeExpected(raw: unknown): OcrEvalExpected {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const expected: OcrEvalExpected = {};
  if (Object.prototype.hasOwnProperty.call(record, "setName")) {
    expected.setName = normalizeExpectedField(coerceNullableString(record.setName));
  }
  if (Object.prototype.hasOwnProperty.call(record, "insertSet")) {
    expected.insertSet = normalizeExpectedField(coerceNullableString(record.insertSet));
  }
  if (Object.prototype.hasOwnProperty.call(record, "parallel")) {
    expected.parallel = normalizeExpectedField(coerceNullableString(record.parallel));
  }
  return expected;
}

function normalizeHints(raw: unknown): OcrEvalHints {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const record = raw as Record<string, unknown>;
  return {
    year: coerceNullableString(record.year),
    manufacturer: coerceNullableString(record.manufacturer),
    sport: coerceNullableString(record.sport),
    productLine: coerceNullableString(record.productLine),
    setId: coerceNullableString(record.setId),
    layoutClass: coerceNullableString(record.layoutClass),
  };
}

export function buildOcrEvalThresholdsFromEnv(): OcrEvalThresholds {
  return {
    minCases: clampInt(Number(process.env.OCR_EVAL_MIN_CASES ?? DEFAULT_THRESHOLDS.minCases), DEFAULT_THRESHOLDS.minCases),
    setTop1Min: clampRate(Number(process.env.OCR_EVAL_SET_TOP1_MIN ?? DEFAULT_THRESHOLDS.setTop1Min), DEFAULT_THRESHOLDS.setTop1Min),
    insertParallelTop1Min: clampRate(
      Number(process.env.OCR_EVAL_INSERT_PARALLEL_TOP1_MIN ?? DEFAULT_THRESHOLDS.insertParallelTop1Min),
      DEFAULT_THRESHOLDS.insertParallelTop1Min
    ),
    insertParallelTop3Min: clampRate(
      Number(process.env.OCR_EVAL_INSERT_PARALLEL_TOP3_MIN ?? DEFAULT_THRESHOLDS.insertParallelTop3Min),
      DEFAULT_THRESHOLDS.insertParallelTop3Min
    ),
    casePassRateMin: clampRate(
      Number(process.env.OCR_EVAL_CASE_PASS_RATE_MIN ?? DEFAULT_THRESHOLDS.casePassRateMin),
      DEFAULT_THRESHOLDS.casePassRateMin
    ),
    unknownRateMax: clampRate(
      Number(process.env.OCR_EVAL_UNKNOWN_RATE_MAX ?? DEFAULT_THRESHOLDS.unknownRateMax),
      DEFAULT_THRESHOLDS.unknownRateMax
    ),
    wrongSetRateMax: clampRate(
      Number(process.env.OCR_EVAL_WRONG_SET_RATE_MAX ?? DEFAULT_THRESHOLDS.wrongSetRateMax),
      DEFAULT_THRESHOLDS.wrongSetRateMax
    ),
    crossSetMemoryDriftMax: clampRate(
      Number(process.env.OCR_EVAL_CROSS_SET_MEMORY_DRIFT_MAX ?? DEFAULT_THRESHOLDS.crossSetMemoryDriftMax),
      DEFAULT_THRESHOLDS.crossSetMemoryDriftMax
    ),
  };
}

function pickTopCandidateKeys(values: string[] | null | undefined, limit = 3): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((entry) => {
    if (out.length >= limit || typeof entry !== "string") {
      return;
    }
    const key = normalizeComparableValue(entry);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(key);
  });
  return out;
}

export async function listOcrEvalCases(): Promise<OcrEvalCaseRecord[]> {
  const rows = await (prisma as any).ocrEvalCase.findMany({
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      cardAssetId: true,
      enabled: true,
      tags: true,
      hintsJson: true,
      expectedJson: true,
      updatedAt: true,
    },
  });

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: coerceNullableString(row.description),
    cardAssetId: String(row.cardAssetId),
    enabled: Boolean(row.enabled),
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
    expected: normalizeExpected(row.expectedJson),
    hints: normalizeHints(row.hintsJson),
    updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
  }));
}

export async function listEnabledOcrEvalCases(): Promise<OcrEvalCaseRecord[]> {
  const all = await listOcrEvalCases();
  return all.filter((entry) => entry.enabled);
}

export async function upsertOcrEvalCase(input: OcrEvalCaseInput): Promise<OcrEvalCaseRecord> {
  const slug = sanitizeText(input.slug).toLowerCase();
  const title = sanitizeText(input.title);
  const cardAssetId = sanitizeText(input.cardAssetId);
  if (!slug || !title || !cardAssetId) {
    throw new Error("slug, title, and cardAssetId are required");
  }
  const expected = normalizeExpected(input.expected);
  if (!hasOwn(expected, "setName") && !hasOwn(expected, "insertSet") && !hasOwn(expected, "parallel")) {
    throw new Error("expected must include at least one taxonomy field");
  }
  const hints = normalizeHints(input.hints ?? {});
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => sanitizeText(tag)).filter(Boolean).slice(0, 24)
    : [];
  await (prisma as any).ocrEvalCase.upsert({
    where: { slug },
    update: {
      title,
      description: coerceNullableString(input.description),
      cardAssetId,
      enabled: coerceBoolean(input.enabled, true),
      tags,
      hintsJson: hints as Prisma.InputJsonValue,
      expectedJson: expected as Prisma.InputJsonValue,
    },
    create: {
      slug,
      title,
      description: coerceNullableString(input.description),
      cardAssetId,
      enabled: coerceBoolean(input.enabled, true),
      tags,
      hintsJson: hints as Prisma.InputJsonValue,
      expectedJson: expected as Prisma.InputJsonValue,
    },
  });

  const rows = await (prisma as any).ocrEvalCase.findMany({
    where: { slug },
    take: 1,
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      cardAssetId: true,
      enabled: true,
      tags: true,
      hintsJson: true,
      expectedJson: true,
      updatedAt: true,
    },
  });
  const [row] = rows as Array<Record<string, unknown>>;
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: coerceNullableString(row.description),
    cardAssetId: String(row.cardAssetId),
    enabled: Boolean(row.enabled),
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
    expected: normalizeExpected(row.expectedJson),
    hints: normalizeHints(row.hintsJson),
    updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
  };
}

function evaluateSingleField(
  expectedValue: string | null | undefined,
  predictedValue: string | null | undefined
): "correct" | "wrong" | "unknown" {
  const expectedKey = normalizeComparableValue(expectedValue);
  const predictedKey = normalizeComparableValue(predictedValue);
  if (!predictedKey) {
    return expectedKey ? "unknown" : "correct";
  }
  if (!expectedKey) {
    return "wrong";
  }
  return expectedKey === predictedKey ? "correct" : "wrong";
}

export function evaluateOcrEvalCases(params: {
  cases: OcrEvalCaseRecord[];
  predictionsByCaseId: Record<string, OcrEvalExpected>;
  topCandidatesByCaseId?: Record<string, OcrEvalTopCandidates>;
  metaByCaseId?: Record<string, OcrEvalCaseMeta>;
}): { results: OcrEvalCaseResult[]; summary: OcrEvalSummary } {
  const thresholds = buildOcrEvalThresholdsFromEnv();
  let setOpportunities = 0;
  let setCorrect = 0;
  let setUnknown = 0;
  let setWrong = 0;

  let insertParallelOpportunities = 0;
  let insertParallelCorrect = 0;
  let insertParallelUnknown = 0;
  let insertParallelTop3Opportunities = 0;
  let insertParallelTop3Correct = 0;
  let memoryDriftOpportunities = 0;
  let memoryDriftEvents = 0;

  const results: OcrEvalCaseResult[] = params.cases.map((testCase) => {
    const expected = normalizeExpected(testCase.expected);
    const predicted = normalizeExpected(params.predictionsByCaseId[testCase.id] ?? {});
    const topCandidates = params.topCandidatesByCaseId?.[testCase.id] ?? {};
    const meta = params.metaByCaseId?.[testCase.id] ?? {};
    const fieldScores: OcrEvalCaseResult["fieldScores"] = {};
    const notes: string[] = [];
    let passed = true;

    (["setName", "insertSet", "parallel"] as Array<keyof OcrEvalExpected>).forEach((field) => {
      if (!hasOwn(expected, field)) {
        return;
      }
      const score = evaluateSingleField(expected[field], predicted[field]);
      fieldScores[field] = score;
      if (score !== "correct") {
        passed = false;
      }

      const expectedKey = normalizeComparableValue(expected[field]);
      if (field === "setName" && expectedKey) {
        setOpportunities += 1;
        if (score === "correct") setCorrect += 1;
        if (score === "unknown") setUnknown += 1;
        if (score === "wrong") setWrong += 1;
      }
      if ((field === "insertSet" || field === "parallel") && expectedKey) {
        insertParallelOpportunities += 1;
        if (score === "correct") insertParallelCorrect += 1;
        if (score === "unknown") insertParallelUnknown += 1;
        insertParallelTop3Opportunities += 1;
        if (score === "correct") {
          insertParallelTop3Correct += 1;
        } else {
          const top3Keys = pickTopCandidateKeys(topCandidates[field], 3);
          if (top3Keys.includes(expectedKey)) {
            insertParallelTop3Correct += 1;
          }
        }
      }
      if (score === "wrong") {
        notes.push(`${field}: expected "${expected[field] ?? ""}" got "${predicted[field] ?? ""}"`);
      }
      if (score === "unknown") {
        notes.push(`${field}: unknown`);
      }
    });

    if (meta.memoryApplied && hasOwn(expected, "setName") && normalizeComparableValue(expected.setName)) {
      memoryDriftOpportunities += 1;
      if (fieldScores.setName === "wrong") {
        memoryDriftEvents += 1;
      }
    }

    return {
      caseId: testCase.id,
      slug: testCase.slug,
      title: testCase.title,
      cardAssetId: testCase.cardAssetId,
      passed,
      expected,
      predicted,
      fieldScores,
      notes,
    };
  });

  const totalCases = results.length;
  const passedCases = results.filter((entry) => entry.passed).length;
  const failedCases = totalCases - passedCases;
  const casePassRate = totalCases > 0 ? passedCases / totalCases : 0;
  const unknownRate = setOpportunities + insertParallelOpportunities > 0
    ? (setUnknown + insertParallelUnknown) / (setOpportunities + insertParallelOpportunities)
    : 0;
  const wrongSetRate = setOpportunities > 0 ? setWrong / setOpportunities : 0;
  const setTop1 = setOpportunities > 0 ? setCorrect / setOpportunities : 0;
  const insertParallelTop1 =
    insertParallelOpportunities > 0 ? insertParallelCorrect / insertParallelOpportunities : 0;
  const insertParallelTop3 =
    insertParallelTop3Opportunities > 0 ? insertParallelTop3Correct / insertParallelTop3Opportunities : 0;
  const crossSetMemoryDrift = memoryDriftOpportunities > 0 ? memoryDriftEvents / memoryDriftOpportunities : 0;

  const failedChecks: string[] = [];
  if (totalCases < thresholds.minCases) failedChecks.push("min_cases");
  if (setOpportunities < 1 || setTop1 < thresholds.setTop1Min) failedChecks.push("set_top1");
  if (insertParallelOpportunities < 1 || insertParallelTop1 < thresholds.insertParallelTop1Min) {
    failedChecks.push("insert_parallel_top1");
  }
  if (insertParallelTop3Opportunities < 1 || insertParallelTop3 < thresholds.insertParallelTop3Min) {
    failedChecks.push("insert_parallel_top3");
  }
  if (casePassRate < thresholds.casePassRateMin) failedChecks.push("case_pass_rate");
  if (unknownRate > thresholds.unknownRateMax) failedChecks.push("unknown_rate");
  if (wrongSetRate > thresholds.wrongSetRateMax) failedChecks.push("wrong_set_rate");
  if (memoryDriftOpportunities > 0 && crossSetMemoryDrift > thresholds.crossSetMemoryDriftMax) {
    failedChecks.push("cross_set_memory_drift");
  }

  const summary: OcrEvalSummary = {
    totalCases,
    passedCases,
    failedCases,
    casePassRatePct: toPercent(passedCases, Math.max(totalCases, 1)),
    opportunities: {
      set: setOpportunities,
      insertParallel: insertParallelOpportunities,
      insertParallelTop3: insertParallelTop3Opportunities,
      memoryDrift: memoryDriftOpportunities,
    },
    metrics: {
      setTop1AccuracyPct: toPercent(setCorrect, Math.max(setOpportunities, 1)),
      insertParallelTop1AccuracyPct: toPercent(insertParallelCorrect, Math.max(insertParallelOpportunities, 1)),
      insertParallelTop3AccuracyPct: toPercent(insertParallelTop3Correct, Math.max(insertParallelTop3Opportunities, 1)),
      unknownRatePct:
        setOpportunities + insertParallelOpportunities > 0
          ? Number((unknownRate * 100).toFixed(1))
          : null,
      wrongSetRatePct: setOpportunities > 0 ? Number((wrongSetRate * 100).toFixed(1)) : null,
      crossSetMemoryDriftPct: memoryDriftOpportunities > 0 ? Number((crossSetMemoryDrift * 100).toFixed(1)) : null,
    },
    gate: {
      pass: failedChecks.length < 1,
      failedChecks,
      thresholds,
    },
  };

  return { results, summary };
}
