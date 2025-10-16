export interface EbayComparableUrls {
  exact?: string | null;
  variant?: string | null;
  premiumHighGrade?: string | null;
  playerComp?: string | null;
}

interface ComparableOptions {
  ocrText?: string | null;
  bestMatch?: Record<string, unknown> | null | undefined;
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

const VARIANT_KEYWORDS = [
  "NEON",
  "ORANGE",
  "GOLD",
  "GREEN",
  "BLUE",
  "PURPLE",
  "SILVER",
  "HOLO",
  "HOLOFOIL",
  "REFRACTOR",
  "PRIZM",
  "PRISM",
  "PULSAR",
  "CRACKED",
  "ICE",
  "PATCH",
  "AUTO",
  "AUTOGRAPH",
  "NUMBERED",
  "KABOOM",
  "DOWNTOWN",
];

const TEAM_EXCLUDE = ["ROOKIE", "CARD", "RC", "PSA", "BGS", "SGC", "NM", "MT", "SELECT"];

function pickLine(
  lines: string[],
  predicate: (upper: string, original: string, index: number) => boolean
): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const original = lines[i];
    const upper = original.toUpperCase();
    if (predicate(upper, original, i)) {
      return original;
    }
  }
  return null;
}

function deriveBestMatchValue(match: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!match) {
    return null;
  }
  const value = match[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function extractGrade(ocr: string | null | undefined): { gradeText: string | null; company: string | null } {
  if (!ocr) {
    return { gradeText: null, company: null };
  }
  const match = /(PSA|BGS|SGC)\s*-?\s*(10|9\.5|9|8\.5|8|7\.5|7|6|5|4|3|2|1)/i.exec(ocr);
  if (!match) {
    return { gradeText: null, company: null };
  }
  const [full, companyRaw, gradeRaw] = match;
  return {
    gradeText: full.trim().toUpperCase().replace(/\s+/g, " "),
    company: companyRaw.toUpperCase(),
  };
}

function wasRookieMentioned(lines: string[]): boolean {
  return lines.some((line) => line.toUpperCase().includes("ROOKIE"));
}

function uniqueQuery(terms: Array<string | null | undefined>): string | null {
  const filtered = terms
    .map((term) => term?.trim())
    .filter((term): term is string => Boolean(term && term.length > 0));

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

export function buildComparableEbayUrls(options: ComparableOptions): EbayComparableUrls {
  const ocrText = options.ocrText ?? "";
  const lines = ocrText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const bestMatch = options.bestMatch ?? null;
  const playerFromMatch =
    deriveBestMatchValue(bestMatch, "full_name") ??
    deriveBestMatchValue(bestMatch, "name");

  const setFromMatch =
    deriveBestMatchValue(bestMatch, "set") ??
    deriveBestMatchValue(bestMatch, "series");

  const playerName =
    playerFromMatch ??
    pickLine(lines, (upper) =>
      /[A-Z]/.test(upper) &&
      !/[0-9#]/.test(upper) &&
      !TEAM_EXCLUDE.some((word) => upper.includes(word))
    );

  const setLine =
    setFromMatch ??
    pickLine(lines, (upper) => /\d{4}/.test(upper) && !upper.includes("#") && !upper.includes("PSA"));

  const variantLine = pickLine(lines, (upper) =>
    VARIANT_KEYWORDS.some((keyword) => upper.includes(keyword))
  );

  const teamLine = pickLine(lines.reverse(), (upper) => {
    if (/[0-9]/.test(upper)) {
      return false;
    }
    if (TEAM_EXCLUDE.some((word) => upper.includes(word))) {
      return false;
    }
    if (playerName && upper === playerName.toUpperCase()) {
      return false;
    }
    return /^[A-Z\s'-]+$/.test(upper);
  });
  // restore original order for future operations
  lines.reverse();

  const { gradeText, company } = extractGrade(ocrText);
  const sawRookie = wasRookieMentioned(lines);

  const exact = buildEbaySoldUrlFromText(ocrText);

  const variantQuery = uniqueQuery([
    playerName,
    variantLine,
    setLine,
    gradeText,
  ]);

  const premiumQuery = uniqueQuery([
    playerName,
    setLine,
    variantLine,
    company ? `${company} 10` : "PSA 10",
  ]);

  const playerCompQuery = uniqueQuery([
    playerName,
    teamLine,
    sawRookie ? "rookie card" : "trading card",
  ]);

  return {
    exact,
    variant: buildEbaySoldUrlFromQuery(variantQuery),
    premiumHighGrade: buildEbaySoldUrlFromQuery(premiumQuery),
    playerComp: buildEbaySoldUrlFromQuery(playerCompQuery),
  };
}
