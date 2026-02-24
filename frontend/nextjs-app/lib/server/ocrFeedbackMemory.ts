import { Prisma, prisma } from "@tenkings/database";

export type OcrFeedbackMemoryContextInput = {
  setId?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  sport?: string | null;
  cardNumber?: string | null;
  numbered?: string | null;
};

export type OcrFeedbackMemoryContext = {
  setId: string | null;
  setIdKey: string;
  year: string | null;
  yearKey: string;
  manufacturer: string | null;
  manufacturerKey: string;
  sport: string | null;
  sportKey: string;
  cardNumber: string | null;
  cardNumberKey: string;
  numbered: string | null;
  numberedKey: string;
};

export type OcrFeedbackMemoryTokenRef = {
  text: string;
  imageId: string | null;
  weight?: number | null;
};

export type OcrFeedbackMemoryAggregateInput = {
  fieldName: string;
  modelValue?: string | null;
  humanValue?: string | null;
  wasCorrect: boolean;
  setId?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  sport?: string | null;
  cardNumber?: string | null;
  numbered?: string | null;
  tokenRefsJson?: unknown;
};

const TAXONOMY_ALIAS_FIELDS = new Set(["insertSet", "parallel"]);
const BOOLEAN_MEMORY_FIELDS = new Set(["autograph", "memorabilia", "graded"]);
const MEMORY_EXCLUDED_FIELDS = new Set(["numbered"]);
const TRUE_STRINGS = new Set(["true", "yes", "1"]);
const VARIANT_LABEL_STOP_WORDS = new Set(["the"]);

function coerceNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeTextKey(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeCodeKey(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeMemoryToken(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
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
  return TRUE_STRINGS.has(String(value || "").trim().toLowerCase());
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, 64);
}

export function parseOcrFeedbackTokenRefs(raw: unknown): OcrFeedbackMemoryTokenRef[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const text = coerceNullableString(record.text);
      if (!text) {
        return null;
      }
      const rawWeight = typeof record.weight === "number" && Number.isFinite(record.weight) ? record.weight : null;
      return {
        text,
        imageId: coerceNullableString(record.imageId),
        weight: rawWeight != null && rawWeight > 0 ? rawWeight : null,
      } as OcrFeedbackMemoryTokenRef;
    })
    .filter((entry): entry is OcrFeedbackMemoryTokenRef => Boolean(entry));
}

function buildTokenAnchors(
  existingRaw: unknown,
  incomingRefs: OcrFeedbackMemoryTokenRef[]
): Array<{ text: string; imageId: string | null; weight: number }> {
  const byKey = new Map<string, { text: string; imageId: string | null; weight: number }>();
  const upsert = (ref: OcrFeedbackMemoryTokenRef) => {
    const normalizedToken = normalizeMemoryToken(ref.text);
    if (!normalizedToken) {
      return;
    }
    const normalizedImage = normalizeImageLabel(ref.imageId);
    const key = `${normalizedImage}::${normalizedToken}`;
    const weight = typeof ref.weight === "number" && Number.isFinite(ref.weight) && ref.weight > 0 ? ref.weight : 1;
    const current = byKey.get(key);
    if (current) {
      current.weight += weight;
      return;
    }
    byKey.set(key, {
      text: normalizedToken,
      imageId: normalizedImage,
      weight,
    });
  };

  parseOcrFeedbackTokenRefs(existingRaw).forEach(upsert);
  incomingRefs.forEach(upsert);

  return Array.from(byKey.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 24);
}

function buildAliasValues(
  fieldName: string,
  existingRaw: unknown,
  incomingValues: Array<string | null | undefined>
): string[] {
  const byKey = new Map<string, string>();
  const add = (value: string | null | undefined) => {
    const cleaned = coerceNullableString(value);
    if (!cleaned) {
      return;
    }
    const aliasKey = buildOcrFeedbackMemoryValueKey(fieldName, cleaned);
    if (!aliasKey || byKey.has(aliasKey)) {
      return;
    }
    byKey.set(aliasKey, cleaned);
  };

  incomingValues.forEach(add);
  parseStringArray(existingRaw).forEach(add);

  return Array.from(byKey.values()).slice(0, 24);
}

function roundPrior(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

export function buildOcrFeedbackMemoryValueKey(fieldName: string, value: string | null | undefined): string {
  const cleaned = coerceNullableString(value);
  if (!cleaned) {
    return "";
  }
  const normalized = normalizeTextKey(cleaned);
  if (!normalized) {
    return "";
  }
  if (!TAXONOMY_ALIAS_FIELDS.has(fieldName)) {
    return normalized;
  }
  const tokenized = normalized
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token && !VARIANT_LABEL_STOP_WORDS.has(token));
  const withoutStopWords = tokenized.join(" ").trim();
  return withoutStopWords || normalized;
}

export function buildOcrFeedbackMemoryContext(input: OcrFeedbackMemoryContextInput): OcrFeedbackMemoryContext {
  const setId = coerceNullableString(input.setId);
  const year = coerceNullableString(input.year);
  const manufacturer = coerceNullableString(input.manufacturer);
  const sport = coerceNullableString(input.sport);
  const cardNumber = coerceNullableString(input.cardNumber);
  const numbered = coerceNullableString(input.numbered);
  return {
    setId,
    setIdKey: normalizeTextKey(setId),
    year,
    yearKey: normalizeTextKey(year),
    manufacturer,
    manufacturerKey: normalizeTextKey(manufacturer),
    sport,
    sportKey: normalizeTextKey(sport),
    cardNumber,
    cardNumberKey: normalizeCodeKey(cardNumber),
    numbered,
    numberedKey: normalizeCodeKey(numbered),
  };
}

export async function upsertOcrFeedbackMemoryAggregates(rows: OcrFeedbackMemoryAggregateInput[]) {
  const now = new Date();
  for (const row of rows) {
    const fieldName = coerceNullableString(row.fieldName);
    const humanValue = coerceNullableString(row.humanValue);
    if (!fieldName || !humanValue) {
      continue;
    }
    if (MEMORY_EXCLUDED_FIELDS.has(fieldName)) {
      continue;
    }
    if (BOOLEAN_MEMORY_FIELDS.has(fieldName) && !isTruthyString(humanValue)) {
      continue;
    }

    const valueKey = buildOcrFeedbackMemoryValueKey(fieldName, humanValue);
    if (!valueKey) {
      continue;
    }

    const context = buildOcrFeedbackMemoryContext({
      setId: row.setId,
      year: row.year,
      manufacturer: row.manufacturer,
      sport: row.sport,
      cardNumber: row.cardNumber,
      numbered: row.numbered,
    });
    const incomingTokenRefs = parseOcrFeedbackTokenRefs(row.tokenRefsJson);

    const existing = await (prisma as any).ocrFeedbackMemoryAggregate.findFirst({
      where: {
        fieldName,
        valueKey,
        setIdKey: context.setIdKey,
        yearKey: context.yearKey,
        manufacturerKey: context.manufacturerKey,
        sportKey: context.sportKey,
        cardNumberKey: context.cardNumberKey,
        numberedKey: context.numberedKey,
      },
      select: {
        id: true,
        sampleCount: true,
        correctCount: true,
        aliasValuesJson: true,
        tokenAnchorsJson: true,
      },
    });

    if (!existing) {
      const sampleCount = 1;
      const correctCount = row.wasCorrect ? 1 : 0;
      const aliases = buildAliasValues(fieldName, null, [humanValue, row.modelValue]);
      const tokenAnchors = buildTokenAnchors(null, incomingTokenRefs);
      await (prisma as any).ocrFeedbackMemoryAggregate.create({
        data: {
          fieldName,
          value: humanValue,
          valueKey,
          setId: context.setId,
          setIdKey: context.setIdKey,
          year: context.year,
          yearKey: context.yearKey,
          manufacturer: context.manufacturer,
          manufacturerKey: context.manufacturerKey,
          sport: context.sport,
          sportKey: context.sportKey,
          cardNumber: context.cardNumber,
          cardNumberKey: context.cardNumberKey,
          numbered: context.numbered,
          numberedKey: context.numberedKey,
          sampleCount,
          correctCount,
          confidencePrior: roundPrior(correctCount / sampleCount),
          aliasValuesJson: aliases as Prisma.InputJsonValue,
          tokenAnchorsJson: tokenAnchors as Prisma.InputJsonValue,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
      continue;
    }

    const sampleCount = Number(existing.sampleCount || 0) + 1;
    const correctCount = Number(existing.correctCount || 0) + (row.wasCorrect ? 1 : 0);
    const aliases = buildAliasValues(fieldName, existing.aliasValuesJson, [humanValue, row.modelValue]);
    const tokenAnchors = buildTokenAnchors(existing.tokenAnchorsJson, incomingTokenRefs);
    await (prisma as any).ocrFeedbackMemoryAggregate.update({
      where: { id: existing.id },
      data: {
        value: humanValue,
        sampleCount,
        correctCount,
        confidencePrior: roundPrior(correctCount / Math.max(sampleCount, 1)),
        aliasValuesJson: aliases as Prisma.InputJsonValue,
        tokenAnchorsJson: tokenAnchors as Prisma.InputJsonValue,
        lastSeenAt: now,
      },
    });
  }
}
