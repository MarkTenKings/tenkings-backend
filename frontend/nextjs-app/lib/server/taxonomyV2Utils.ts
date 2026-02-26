import { decodeHtmlEntities, normalizeCardNumber, normalizeParallelLabel, normalizeSetLabel } from "@tenkings/shared";

export function sanitizeTaxonomyText(value: unknown): string {
  return decodeHtmlEntities(String(value ?? "")).replace(/\s+/g, " ").trim();
}

export function normalizeTaxonomyKey(value: unknown): string {
  return sanitizeTaxonomyText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function tokenizeTaxonomy(value: unknown): string[] {
  return sanitizeTaxonomyText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function parseSerialDenominator(value: unknown): number | null {
  const text = sanitizeTaxonomyText(value);
  if (!text) return null;
  const match = text.match(/\/\s*(\d{1,4})\b/);
  if (!match?.[1]) return null;
  const denominator = Number.parseInt(match[1], 10);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return denominator;
}

export function normalizeProgramId(value: unknown): string {
  const normalized = normalizeTaxonomyKey(value);
  return normalized || "base";
}

export function normalizeVariationId(value: unknown): string {
  return normalizeTaxonomyKey(value) || "variation";
}

export function normalizeParallelId(value: unknown): string {
  const normalized = normalizeTaxonomyKey(normalizeParallelLabel(String(value ?? "")));
  return normalized || "parallel";
}

export function normalizeFormatKey(value: unknown): string | null {
  const normalized = normalizeTaxonomyKey(value);
  return normalized || null;
}

export function normalizeChannelKey(value: unknown): string | null {
  const normalized = normalizeTaxonomyKey(value);
  return normalized || null;
}

export function normalizeSetId(value: unknown): string {
  return normalizeSetLabel(String(value ?? ""));
}

export function normalizeTaxonomyCardNumber(value: unknown): string | null {
  return normalizeCardNumber(String(value ?? ""));
}

export function buildTaxonomyCanonicalKey(input: {
  setId: string;
  programId: string;
  cardNumber: string | null;
  variationId?: string | null;
  parallelId?: string | null;
}): string {
  const setId = normalizeSetId(input.setId).toLowerCase();
  const programId = normalizeProgramId(input.programId).toLowerCase();
  const cardNumber = (normalizeTaxonomyCardNumber(input.cardNumber) ?? "NULL").toLowerCase();
  const variationId = input.variationId ? normalizeVariationId(input.variationId).toLowerCase() : "none";
  const parallelId = input.parallelId ? normalizeParallelId(input.parallelId).toLowerCase() : "none";
  return [setId, programId, cardNumber, variationId, parallelId].join("::");
}
