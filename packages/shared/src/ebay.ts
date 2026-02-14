import {
  extractCardAttributes,
  inferPlayerNameFromText,
  type CardAttributes,
} from "./cardAttributes";

export interface EbayComparableUrls {
  exact?: string | null;
  variant?: string | null;
  premiumHighGrade?: string | null;
  playerComp?: string | null;
  memorabiliaComp?: string | null;
  autoComp?: string | null;
  aiGradeComp?: string | null;
}

interface ComparableOptions {
  ocrText?: string | null;
  bestMatch?: Record<string, unknown> | null | undefined;
  attributes?: CardAttributes;
  aiGradePsa?: number | undefined;
  isGraded?: boolean | undefined;
}

const POSITION_STOPWORDS = new Set(
  [
    "QB",
    "RB",
    "WR",
    "TE",
    "LB",
    "CB",
    "DB",
    "FS",
    "SS",
    "C",
    "PF",
    "SF",
    "SG",
    "PG",
    "G",
    "F",
    "CENTER",
    "FORWARD",
    "GUARD",
    "PITCHER",
    "CATCHER",
    "SHORTSTOP",
    "SECOND",
    "BASE",
    "THIRD",
    "BASEMAN",
    "OUTFIELD",
    "DEFENSE",
    "OFFENSE",
  ].map((word) => word.toUpperCase())
);

function sanitizeTerm(term: string | null | undefined): string | null {
  if (!term) {
    return null;
  }
  const tokens = term
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !/^\d{5,}$/.test(token))
    .filter((token) => !token.includes("#"))
    .filter((token) => !POSITION_STOPWORDS.has(token.toUpperCase()));

  if (tokens.length === 0) {
    return null;
  }

  return tokens.join(" ");
}

function normalizeForQuery(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const cleaned = raw
    .replace(/[_,]/g, " ")
    .replace(/[^\w\s#/+.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0) {
    return null;
  }

  return cleaned.length > 160 ? cleaned.slice(0, 160) : cleaned;
}

function toEbayUrl(query: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=16`;
}

export function buildEbaySoldUrlFromText(raw: string | null | undefined): string | null {
  const normalized = normalizeForQuery(raw);
  return normalized ? toEbayUrl(normalized) : null;
}

export function buildEbaySoldUrlFromQuery(raw: string | null | undefined): string | null {
  const normalized = normalizeForQuery(raw);
  return normalized ? toEbayUrl(normalized) : null;
}

function uniqueQuery(terms: Array<string | null | undefined>): string | null {
  const filtered = terms
    .map((term) => sanitizeTerm(term))
    .filter((term): term is string => Boolean(term && term.trim().length > 0));

  if (filtered.length === 0) {
    return null;
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  filtered.forEach((term) => {
    const normalized = term.toUpperCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      deduped.push(term);
    }
  });

  if (deduped.length === 0) {
    return null;
  }

  return deduped.join(" ");
}

function extractNumberedDenominator(numbered: string | null | undefined): string | null {
  if (!numbered) return null;
  const match = numbered.match(/\/\s*(\d{1,4})\b/);
  return match?.[1] ? `/${match[1]}` : null;
}

function buildVariantQuery(attributes: CardAttributes, playerName: string | null): string | null {
  const numberedDenominator = extractNumberedDenominator(attributes.numbered);
  return uniqueQuery([
    playerName,
    attributes.brand ?? attributes.setName,
    ...attributes.variantKeywords,
    numberedDenominator,
    attributes.numbered,
    attributes.autograph ? "autograph" : null,
    attributes.memorabilia ? "patch" : null,
    attributes.rookie ? "rookie" : null,
  ]);
}

function buildPremiumQuery(attributes: CardAttributes, playerName: string | null): string | null {
  const gradePhrase = attributes.gradeValue
    ? attributes.gradeCompany
      ? `${attributes.gradeCompany} ${attributes.gradeValue}`
      : attributes.gradeValue
    : "PSA 10";

  return uniqueQuery([
    playerName,
    attributes.brand ?? attributes.setName,
    attributes.variantKeywords[0],
    gradePhrase,
  ]);
}

function buildPlayerCompQuery(attributes: CardAttributes, playerName: string | null): string | null {
  return uniqueQuery([
    playerName,
    attributes.teamName ?? attributes.brand,
    attributes.rookie ? "rookie card" : "trading card",
  ]);
}

function buildMemorabiliaQuery(attributes: CardAttributes, playerName: string | null): string | null {
  if (!attributes.memorabilia) {
    return null;
  }
  const numberedDenominator = extractNumberedDenominator(attributes.numbered);
  return uniqueQuery([
    playerName,
    attributes.brand ?? attributes.setName,
    "patch",
    numberedDenominator,
    attributes.numbered,
  ]);
}

function buildAutoQuery(attributes: CardAttributes, playerName: string | null): string | null {
  if (!attributes.autograph) {
    return null;
  }
  const numberedDenominator = extractNumberedDenominator(attributes.numbered);
  return uniqueQuery([
    playerName,
    attributes.brand ?? attributes.setName,
    "autograph",
    numberedDenominator,
    attributes.numbered,
  ]);
}

function buildAiGradeQuery(
  exactQuery: string | null,
  psaGrade: number | undefined
): string | null {
  if (!psaGrade || !exactQuery) {
    return null;
  }
  const gradePhrase = `PSA ${psaGrade}`;
  return `${gradePhrase} ${exactQuery}`.trim();
}

function buildExactQuery(
  attributes: CardAttributes,
  playerName: string | null,
  original: string | null | undefined
): string | null {
  const numberedDenominator = extractNumberedDenominator(attributes.numbered);
  const gradePhrase = attributes.gradeValue
    ? attributes.gradeCompany
      ? `${attributes.gradeCompany} ${attributes.gradeValue}`
      : attributes.gradeValue
    : null;

  return uniqueQuery([
    playerName,
    attributes.year,
    attributes.brand ?? attributes.setName,
    ...attributes.variantKeywords,
    attributes.rookie ? "rookie" : null,
    attributes.autograph ? "autograph" : null,
    attributes.memorabilia ? "patch" : null,
    gradePhrase,
    numberedDenominator,
    attributes.numbered,
    original,
  ]);
}

export function buildComparableEbayUrls(options: ComparableOptions): EbayComparableUrls {
  const ocrText = options.ocrText ?? "";
  const attributes =
    options.attributes ??
    extractCardAttributes(ocrText, {
      bestMatch: options.bestMatch,
    });

  const playerName = attributes.playerName ?? inferPlayerNameFromText(ocrText);
  const exactQuery = buildExactQuery(attributes, playerName, ocrText);
  const exact = buildEbaySoldUrlFromQuery(exactQuery);
  const variant = buildEbaySoldUrlFromQuery(buildVariantQuery(attributes, playerName));
  const premium = buildEbaySoldUrlFromQuery(buildPremiumQuery(attributes, playerName));
  const player = buildEbaySoldUrlFromQuery(buildPlayerCompQuery(attributes, playerName));
  const memorabilia = buildEbaySoldUrlFromQuery(buildMemorabiliaQuery(attributes, playerName));
  const autograph = buildEbaySoldUrlFromQuery(buildAutoQuery(attributes, playerName));
  const aiGrade = options.isGraded
    ? null
    : buildEbaySoldUrlFromQuery(buildAiGradeQuery(exactQuery, options.aiGradePsa));

  return {
    exact,
    variant,
    premiumHighGrade: premium,
    playerComp: player,
    memorabiliaComp: memorabilia,
    autoComp: autograph,
    aiGradeComp: aiGrade,
  };
}
