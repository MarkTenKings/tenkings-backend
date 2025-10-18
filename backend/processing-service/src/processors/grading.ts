import { config } from "../config";

export interface CardGradingResult {
  finalGrade: number | null;
  conditionLabel: string | null;
  components: {
    corners: number | null;
    edges: number | null;
    surface: number | null;
    centering: number | null;
  };
  side: string | null;
  autograph: boolean | null;
  category: string | null;
  resources: {
    fullVisualizationUrl: string | null;
    exactVisualizationUrl: string | null;
  };
  raw: unknown;
}

const CARD_GRADER_BASE_URL = "https://api.ximilar.com/card-grader";

interface GradePayloadRecord {
  _status?: { code?: number; text?: string };
  _tags?: Record<string, Array<{ name?: string; label?: string; prob?: number }>>;
  grades?: Record<string, unknown>;
  card?: Array<{
    _tags?: Record<string, Array<{ name?: string; label?: string; prob?: number }>>;
  }>;
  _full_url_card?: string;
  _exact_url_card?: string;
}

interface GradeResponsePayload {
  records?: GradePayloadRecord[];
}

function parseGradeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function readTag(record: GradePayloadRecord, key: string): string | null {
  const tagEntry = record._tags?.[key] ?? record.card?.[0]?._tags?.[key];
  if (!Array.isArray(tagEntry) || tagEntry.length === 0) {
    return null;
  }
  const first = tagEntry[0];
  return (first?.label ?? first?.name ?? null) ?? null;
}

export async function gradeCard(options: {
  imageBase64: string;
  approximateBytes: number;
  maxBytes?: number;
}): Promise<CardGradingResult | null> {
  if (!config.ximilarApiKey) {
    return null;
  }

  const limit = options.maxBytes ?? config.ximilarMaxImageBytes ?? 2_500_000;
  if (options.approximateBytes > limit) {
    console.warn(
      `[processing-service] Ximilar grading skipped (image too large: ${options.approximateBytes} bytes, limit ${limit} bytes)`
    );
    return null;
  }

  const body = {
    records: [
      {
        _base64: options.imageBase64,
      },
    ],
  };

  const response = await fetch(`${CARD_GRADER_BASE_URL}/v2/grade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${config.ximilarApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 413) {
      console.warn(
        `[processing-service] Ximilar grading rejected payload (${options.approximateBytes} bytes, limit ${limit})`
      );
      return null;
    }
    console.warn(
      `[processing-service] Ximilar grading failed ${response.status}: ${errorText.slice(0, 160)}`
    );
    return null;
  }

  const payload = (await response.json()) as GradeResponsePayload;
  const record = payload.records?.[0];
  if (!record) {
    return null;
  }

  if (record._status && record._status.code && record._status.code >= 400) {
    console.warn(
      `[processing-service] Ximilar grading status ${record._status.code}: ${record._status.text ?? ""}`
    );
    return null;
  }

  const grades = record.grades ?? {};
  const finalGrade = parseGradeNumber((grades as Record<string, unknown>).final);
  const conditionLabel = typeof (grades as Record<string, unknown>).condition === "string"
    ? ((grades as Record<string, unknown>).condition as string)
    : readTag(record, "Condition");

  const components = {
    corners: parseGradeNumber((grades as Record<string, unknown>).corners),
    edges: parseGradeNumber((grades as Record<string, unknown>).edges),
    surface: parseGradeNumber((grades as Record<string, unknown>).surface),
    centering: parseGradeNumber((grades as Record<string, unknown>).centering),
  };

  const side = readTag(record, "Side");
  const autographTag = readTag(record, "Autograph");
  const category = readTag(record, "Category");

  return {
    finalGrade,
    conditionLabel,
    components,
    side,
    autograph: autographTag ? autographTag.toLowerCase() === "yes" : null,
    category,
    resources: {
      fullVisualizationUrl: typeof record._full_url_card === "string" ? record._full_url_card : null,
      exactVisualizationUrl: typeof record._exact_url_card === "string" ? record._exact_url_card : null,
    },
    raw: payload,
  };
}
