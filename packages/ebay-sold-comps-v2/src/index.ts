export const EBAY_SOLD_COMPS_V2_ENGINE_VERSION = "ebay-sold-comps-v2.3.0";
export const EBAY_SOLD_COMPS_V2_SOURCE = "EBAY_SOLD" as const;
export const EBAY_SOLD_COMPS_V2_REQUEST_COUNT = 240;
export const EBAY_SOLD_COMPS_V2_RESULT_LIMIT = 60;
export const EBAY_SOLD_COMPS_V2_MAX_CENTS = 2_147_483_647;

export type EbaySoldCompsV2Category = "SPORTS" | "POKEMON";
export type EbaySoldCompsV2Group = "PSA_TARGET" | "PSA_OTHER" | "OTHER_GRADED" | "RAW";
export type EbaySoldCompsV2ParallelMatch = "MATCH" | "CONTRADICTORY" | "UNKNOWN";

export type EbaySoldCompsV2SearchInput = {
  category: EbaySoldCompsV2Category;
  playerName?: string | null;
  cardName?: string | null;
  year: string;
  manufacturer?: string | null;
  productSet: string;
  parallel?: string | null;
  insert?: string | null;
  cardNumber?: string | null;
  targetGrade?: number | null;
  queryOverride?: string | null;
};

export type EbaySoldCompV2Candidate = {
  id: string;
  source: typeof EBAY_SOLD_COMPS_V2_SOURCE;
  productId: string | null;
  title: string;
  listingUrl: string;
  imageUrl: string | null;
  soldPriceCents: number | null;
  soldPriceDisplay: string | null;
  soldDate: string | null;
  condition: string | null;
  grader: "PSA" | "BGS" | "SGC" | "CGC" | null;
  numericGrade: number | null;
  raw: boolean;
  group: EbaySoldCompsV2Group;
  parallelMatch: EbaySoldCompsV2ParallelMatch;
  matchScore: number;
  matchReason: string;
};

export type EbaySoldCompsV2SearchResult = {
  source: typeof EBAY_SOLD_COMPS_V2_SOURCE;
  engineVersion: typeof EBAY_SOLD_COMPS_V2_ENGINE_VERSION;
  query: string;
  retrievedAt: string;
  offset: number;
  nextOffset: number;
  requestedResultCount: number;
  hasMore: boolean;
  candidates: EbaySoldCompV2Candidate[];
};

export type EbaySoldCompsV2SelectionSummary = {
  includedCandidateIds: string[];
  includedCount: number;
  averageSoldPriceCents: number | null;
  lowestSoldPriceCents: number | null;
  highestSoldPriceCents: number | null;
};

export type EbaySoldCompsV2FetchResponse = {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel?(): Promise<void> } } | null;
  text(): Promise<string>;
};

export type EbaySoldCompsV2Fetch = (
  url: string,
  init: { method: "GET"; signal: AbortSignal; headers: { Authorization: string } },
) => Promise<EbaySoldCompsV2FetchResponse>;

export type EbaySoldCompsV2Runtime = {
  apiKey: string;
  fetch?: EbaySoldCompsV2Fetch;
  timeoutMs?: number;
  now?: () => Date;
};

export type EbaySoldCompsV2ErrorCode =
  | "INVALID_INPUT"
  | "SOLDCOMPS_CREDENTIAL_MISSING"
  | "SOLDCOMPS_CONFIGURATION_ERROR"
  | "SOLDCOMPS_QUOTA_REACHED"
  | "SOLDCOMPS_TEMPORARY_UNAVAILABLE"
  | "SOLDCOMPS_HTTP_ERROR"
  | "SOLDCOMPS_NETWORK_ERROR"
  | "SOLDCOMPS_TIMEOUT"
  | "SOLDCOMPS_INVALID_RESPONSE";

export class EbaySoldCompsV2Error extends Error {
  readonly code: EbaySoldCompsV2ErrorCode;
  readonly statusCode: number | null;
  readonly retryable: boolean;

  constructor(
    code: EbaySoldCompsV2ErrorCode,
    message: string,
    options: { statusCode?: number | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "EbaySoldCompsV2Error";
    this.code = code;
    this.statusCode = options.statusCode ?? null;
    this.retryable = options.retryable ?? false;
  }
}

type JsonRecord = Record<string, unknown>;

const SOLDCOMPS_ENDPOINT = "https://api.sold-comps.com/v1/scrape";
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_TITLE_LENGTH = 500;
const MAX_CONDITION_LENGTH = 200;
const GROUP_ORDER: Record<EbaySoldCompsV2Group, number> = {
  PSA_TARGET: 0,
  PSA_OTHER: 1,
  OTHER_GRADED: 2,
  RAW: 3,
};
const BASE_PARALLELS = new Set(["", "base", "base card", "none", "regular", "standard"]);
const VARIANT_SIGNAL_RE = /\b(?:aqua|atomic|black|blue|bronze|camo|checkerboard|cosmos|cosmic|cracked ice|crystal|diamond|disco|elephant|emerald|fluorescent|galactic|genesis|gold|green|holo|holographic|hyper|lava|laser|magma|marble|mojo|nebula|negative|neon|nova|orange|photon|pink|platinum|prism|prizm|pulsar|purple|rainbow|red|refractor|reverse holo|ruby|sapphire|scope|sepia|shimmer|silver|snake|speckle|stellar|superfractor|teal|tiger|velocity|wave|white|xfractor|yellow)\b/gi;
const GRADER_RE = /\b(PSA|BGS|SGC|CGC)\s*(?:(?:GEM|MINT|PRISTINE|BLACK|LABEL|NM|MT)\s*)*([1-9]|10)(?:\.([05]))?\b/i;
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const cleanText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
};

export function normalizeEbaySoldCompsV2Text(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bprofessional sports authenticator\b/g, "psa")
    .replace(/\bbeckett grading services?\b/g, "bgs")
    .replace(/\bsportscard guaranty(?: corporation)?\b/g, "sgc")
    .replace(/\bcertified guaranty company\b/g, "cgc")
    .replace(/\bupper deck\b|\bu d\b/g, "ud")
    .replace(/\bpanini america\b/g, "panini")
    .replace(/\bthe topps company\b/g, "topps")
    .replace(/\bthe pokemon company\b|\bpokemon tcg\b/g, "pokemon")
    .replace(/\s+/g, " ")
    .trim();
}

const normalizedTokens = (value: unknown) => normalizeEbaySoldCompsV2Text(value).split(" ").filter(Boolean);

const tokenOverlap = (expected: unknown, actual: unknown): number => {
  const expectedTokens = [...new Set(normalizedTokens(expected))];
  const actualTokens = new Set(normalizedTokens(actual));
  if (!expectedTokens.length || !actualTokens.size) return 0;
  return expectedTokens.filter((token) => actualTokens.has(token)).length / expectedTokens.length;
};

const includesTokenSequence = (expected: unknown, actual: unknown): boolean => {
  const expectedTokens = normalizedTokens(expected);
  const actualTokens = normalizedTokens(actual);
  if (!expectedTokens.length || expectedTokens.length > actualTokens.length) return false;
  return actualTokens.some((token, start) => (
    token === expectedTokens[0] &&
    expectedTokens.every((expectedToken, offset) => actualTokens[start + offset] === expectedToken)
  ));
};

const phraseMatches = (expected: unknown, actual: unknown, minimumOverlap = 0.8): boolean => {
  const expectedText = normalizeEbaySoldCompsV2Text(expected);
  const actualText = normalizeEbaySoldCompsV2Text(actual);
  return Boolean(
    expectedText &&
    actualText &&
    (includesTokenSequence(expectedText, actualText) || tokenOverlap(expectedText, actualText) >= minimumOverlap),
  );
};

function invalidInput(message: string): never {
  throw new EbaySoldCompsV2Error("INVALID_INPUT", message);
}

function validatedSearchInput(input: EbaySoldCompsV2SearchInput) {
  if (input.category !== "SPORTS" && input.category !== "POKEMON") invalidInput("Category must be SPORTS or POKEMON.");
  const queryOverride = cleanText(input.queryOverride);
  const identityName = cleanText(input.category === "SPORTS" ? input.playerName : input.cardName);
  const year = cleanText(input.year);
  const productSet = cleanText(input.productSet);
  if (!queryOverride && !identityName) invalidInput(`A ${input.category === "SPORTS" ? "player" : "card"} name is required.`);
  if (!queryOverride && !year) invalidInput("Year is required.");
  if (!queryOverride && !productSet) invalidInput("Product set is required.");
  if (queryOverride && queryOverride.length > 400) invalidInput("Query override must be 400 characters or fewer.");
  const targetGrade = input.targetGrade == null ? null : input.targetGrade;
  if (targetGrade != null && (!Number.isFinite(targetGrade) || targetGrade < 1 || targetGrade > 10)) {
    invalidInput("Target grade must be between 1 and 10.");
  }
  return { queryOverride, identityName, year, productSet, targetGrade };
}

/** Nearest whole PSA grade; exact .5 ties round down (for example, TK 9.5 -> PSA 9). */
export function mapTenKingsGradeToPsaGrade(grade: number): number {
  if (!Number.isFinite(grade) || grade < 1 || grade > 10) invalidInput("Target grade must be between 1 and 10.");
  const lower = Math.floor(grade);
  const fraction = grade - lower;
  return Math.min(10, fraction > 0.5 ? lower + 1 : lower);
}

export function buildEbaySoldCompsV2Query(input: EbaySoldCompsV2SearchInput): string {
  const validated = validatedSearchInput(input);
  if (validated.queryOverride) return validated.queryOverride;

  const year = validated.year!;
  const manufacturer = cleanText(input.manufacturer);
  const productSet = validated.productSet!;
  const normalizedSet = normalizeEbaySoldCompsV2Text(productSet);
  const parts: string[] = [];
  if (!includesTokenSequence(year, normalizedSet)) parts.push(year);
  if (manufacturer && !includesTokenSequence(manufacturer, normalizedSet)) parts.push(manufacturer);
  parts.push(productSet, validated.identityName!);

  const qualifierParts = [year, manufacturer, productSet].filter((value): value is string => Boolean(value));
  const appendIfNew = (value: unknown) => {
    const text = cleanText(value);
    if (!text) return;
    if (!includesTokenSequence(text, qualifierParts.join(" "))) {
      parts.push(text);
      qualifierParts.push(text);
    }
  };
  appendIfNew(input.insert);
  if (!BASE_PARALLELS.has(normalizeEbaySoldCompsV2Text(input.parallel))) appendIfNew(input.parallel);
  const cardNumber = cleanText(input.cardNumber);
  if (cardNumber && !includesTokenSequence(cardNumber, productSet)) parts.push(cardNumber.startsWith("#") ? cardNumber : `#${cardNumber}`);
  if (validated.targetGrade != null) parts.push(`PSA ${mapTenKingsGradeToPsaGrade(validated.targetGrade)}`);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

const variantSignals = (value: unknown): string[] => {
  const normalized = normalizeEbaySoldCompsV2Text(value)
    .replace(/\b(?:bgs\s+(?:pristine\s+)?10\s+)?black label\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const matches = normalized.match(VARIANT_SIGNAL_RE) ?? [];
  VARIANT_SIGNAL_RE.lastIndex = 0;
  return [...new Set(matches.map(normalizeEbaySoldCompsV2Text).filter(Boolean))];
};

function parallelMatch(input: EbaySoldCompsV2SearchInput, title: string): EbaySoldCompsV2ParallelMatch {
  const expected = normalizeEbaySoldCompsV2Text(input.parallel);
  const expectedIsBase = BASE_PARALLELS.has(expected);
  const identityValues = [
    input.category === "SPORTS" ? input.playerName : input.cardName,
    input.productSet,
    input.manufacturer,
    input.year,
    input.insert,
    input.cardNumber,
  ].map(normalizedTokens).filter((tokens) => tokens.length).sort((left, right) => right.length - left.length);
  const evidenceTokens = normalizedTokens(title);
  for (const identityTokens of identityValues) {
    const start = evidenceTokens.findIndex((token, index) => (
      token === identityTokens[0] && identityTokens.every((identityToken, offset) => evidenceTokens[index + offset] === identityToken)
    ));
    if (start >= 0) evidenceTokens.splice(start, identityTokens.length);
  }
  const evidence = evidenceTokens.join(" ")
    .replace(/\bbgs\s+(?:pristine\s+)?10\s+black\s+label\b/g, " ")
    .replace(/\b(?:psa|bgs|sgc|cgc)\s*(?:(?:gem|mint|pristine|nm|mt)\s*)*(?:10|[1-9])(?:\s+(?:0|5))?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const actualSignals = variantSignals(evidence);
  if (expectedIsBase) return actualSignals.length ? "CONTRADICTORY" : "MATCH";
  if (phraseMatches(expected, evidence, 1)) return "MATCH";
  if (!actualSignals.length) return "UNKNOWN";
  const expectedTokens = new Set(normalizedTokens(expected));
  return actualSignals.some((signal) => normalizedTokens(signal).some((token) => expectedTokens.has(token)))
    ? "UNKNOWN"
    : "CONTRADICTORY";
}

function graderFromTitle(title: string) {
  const canonicalTitle = title
    .replace(/professional sports authenticator/gi, "PSA")
    .replace(/beckett grading services?/gi, "BGS")
    .replace(/sportscard guaranty(?: corporation)?/gi, "SGC")
    .replace(/certified guaranty company/gi, "CGC");
  const match = canonicalTitle.match(GRADER_RE);
  if (!match?.[1] || !match[2]) return { grader: null, numericGrade: null } as const;
  const integer = Number(match[2]);
  const decimal = match[3] ? Number(`0.${match[3]}`) : 0;
  return {
    grader: match[1].toUpperCase() as "PSA" | "BGS" | "SGC" | "CGC",
    numericGrade: integer + decimal,
  };
}

function groupFor(grader: "PSA" | "BGS" | "SGC" | "CGC" | null, numericGrade: number | null, targetGrade: number | null) {
  if (grader === "PSA") {
    return targetGrade != null && numericGrade != null && Math.abs(numericGrade - targetGrade) < 0.001
      ? "PSA_TARGET" as const
      : "PSA_OTHER" as const;
  }
  return grader ? "OTHER_GRADED" as const : "RAW" as const;
}

function scoreIdentity(input: EbaySoldCompsV2SearchInput, title: string, variant: EbaySoldCompsV2ParallelMatch) {
  const checks: Array<{ label: string; expected: unknown; weight: number; minimum?: number }> = [
    { label: input.category === "SPORTS" ? "player" : "card", expected: input.category === "SPORTS" ? input.playerName : input.cardName, weight: 30 },
    { label: "year", expected: input.year, weight: 10, minimum: 1 },
    { label: "manufacturer", expected: input.manufacturer, weight: 10 },
    { label: "set", expected: input.productSet, weight: 20, minimum: 0.65 },
    { label: "card number", expected: input.cardNumber, weight: 15, minimum: 1 },
    { label: "insert", expected: input.insert, weight: 10 },
  ];
  let score = 0;
  const reasons: string[] = [];
  for (const check of checks) {
    if (!cleanText(check.expected)) continue;
    if (phraseMatches(check.expected, title, check.minimum ?? 0.8)) {
      score += check.weight;
      reasons.push(`${check.label} match`);
    }
  }
  if (variant === "MATCH") {
    score += 40;
    reasons.push("parallel/variant match");
  } else if (variant === "CONTRADICTORY") {
    score -= 50;
    reasons.push("parallel/variant contradiction");
  } else {
    reasons.push("parallel/variant unconfirmed");
  }
  return {
    matchScore: Math.max(0, Math.min(100, score)),
    matchReason: reasons.join("; ") || "No confirmed identity tokens matched",
  };
}

export function rankEbaySoldCompsV2Candidates(
  candidates: readonly EbaySoldCompV2Candidate[],
): EbaySoldCompV2Candidate[] {
  return candidates.map((candidate) => ({ ...candidate })).sort((left, right) => {
    const groupDifference = GROUP_ORDER[left.group] - GROUP_ORDER[right.group];
    if (groupDifference) return groupDifference;
    if (left.group === "PSA_OTHER" && right.group === "PSA_OTHER") {
      const gradeDifference = (right.numericGrade ?? -1) - (left.numericGrade ?? -1);
      if (gradeDifference) return gradeDifference;
    }
    const variantDifference = Number(left.parallelMatch === "CONTRADICTORY") - Number(right.parallelMatch === "CONTRADICTORY");
    if (variantDifference) return variantDifference;
    const leftDate = left.soldDate ? Date.parse(`${left.soldDate}T00:00:00.000Z`) : Number.NEGATIVE_INFINITY;
    const rightDate = right.soldDate ? Date.parse(`${right.soldDate}T00:00:00.000Z`) : Number.NEGATIVE_INFINITY;
    if (rightDate !== leftDate) return rightDate - leftDate;
    if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
    return left.id.localeCompare(right.id);
  });
}

export function calculateEbaySoldCompsV2AverageCents(
  candidates: readonly EbaySoldCompV2Candidate[],
  includedCandidateIds: readonly string[],
): number | null {
  return summarizeEbaySoldCompsV2Selection(candidates, includedCandidateIds).averageSoldPriceCents;
}

export function summarizeEbaySoldCompsV2Selection(
  candidates: readonly EbaySoldCompV2Candidate[],
  includedCandidateIds: readonly string[],
): EbaySoldCompsV2SelectionSummary {
  const selectedIds = [...new Set(includedCandidateIds)];
  if (!selectedIds.length) {
    return {
      includedCandidateIds: [],
      includedCount: 0,
      averageSoldPriceCents: null,
      lowestSoldPriceCents: null,
      highestSoldPriceCents: null,
    };
  }
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const prices = selectedIds.map((id) => {
    const candidate = byId.get(id);
    if (!candidate) invalidInput(`Selected comp ${id} is not a returned candidate.`);
    if (!Number.isSafeInteger(candidate.soldPriceCents) || (candidate.soldPriceCents ?? 0) <= 0 || candidate.soldPriceCents! > EBAY_SOLD_COMPS_V2_MAX_CENTS) {
      invalidInput(`Selected comp ${id} does not have one positive sold price.`);
    }
    return candidate.soldPriceCents!;
  });
  const divisor = BigInt(prices.length);
  const total = prices.reduce((sum, price) => sum + BigInt(price), 0n);
  return {
    includedCandidateIds: selectedIds,
    includedCount: selectedIds.length,
    averageSoldPriceCents: Number((total + divisor / 2n) / divisor),
    lowestSoldPriceCents: Math.min(...prices),
    highestSoldPriceCents: Math.max(...prices),
  };
}

const safeHttpsUrl = (value: unknown, allowedHost: (hostname: string) => boolean): string | null => {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !allowedHost(hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

export const canonicalEbaySoldCompsV2ListingUrl = (value: unknown): string | null => {
  const safe = safeHttpsUrl(value, (hostname) => hostname === "ebay.com" || hostname.endsWith(".ebay.com"));
  if (!safe) return null;
  const match = new URL(safe).pathname.match(/\/itm\/(?:[^/]+\/)?(\d{6,20})(?:\/|$)/i);
  const itemId = match?.[1] ?? null;
  return itemId ? `https://www.ebay.com/itm/${itemId}` : null;
};

const safeEbaySourceUrl = (value: unknown) => safeHttpsUrl(
  value,
  (hostname) => hostname === "ebay.com" || hostname.endsWith(".ebay.com"),
);

const ebayItemIdFromSafeUrl = (safeUrl: string): string | null => {
  const match = new URL(safeUrl).pathname.match(/\/itm\/(?:[^/]+\/)?(\d{6,20})(?:\/|$)/i);
  return match?.[1] ?? null;
};

export const isApprovedEbaySoldCompsV2ImageUrl = (value: unknown): value is string => Boolean(
  safeHttpsUrl(value, (hostname) => (
    hostname === "ebayimg.com" || hostname.endsWith(".ebayimg.com") || hostname === "ebaystatic.com" || hostname.endsWith(".ebaystatic.com")
  )),
);

const ebayImageUrl = (value: unknown) => safeHttpsUrl(value, (hostname) => (
  hostname === "ebayimg.com" || hostname.endsWith(".ebayimg.com") || hostname === "ebaystatic.com" || hostname.endsWith(".ebaystatic.com")
));

const firstImageUrl = (item: JsonRecord): string | null => ebayImageUrl(item.thumbnailUrl);

const directProductIdFrom = (item: JsonRecord): string | null => {
  const direct = cleanText(item.itemId);
  return direct && /^\d{6,20}$/.test(direct) ? direct : null;
};

const listingIdentity = (listingUrl: string, productId: string | null) => {
  if (productId) return `ebay:${productId}`;
  const url = new URL(listingUrl);
  return `ebay-url:${url.origin}${url.pathname}`;
};

const decimalSoldPriceCents = (value: string): number | null => {
  const match = value.match(/^(\d{1,8})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return cents > 0n && cents <= BigInt(EBAY_SOLD_COMPS_V2_MAX_CENTS) ? Number(cents) : null;
};

const priceFrom = (item: JsonRecord) => {
  const soldPrice = cleanText(item.soldPrice);
  const soldCurrency = cleanText(item.soldCurrency);
  const soldPriceDisplay = soldPrice ? [soldCurrency, soldPrice].filter(Boolean).join(" ") : null;
  let soldPriceCents: number | null = null;
  let selectionNote: string | null = null;
  if (item.bestOfferAccepted === true) {
    selectionNote = soldPriceDisplay
      ? `Best Offer accepted; SoldComps reported ${soldPriceDisplay}, an upper bound because eBay does not disclose the accepted amount`
      : "Best Offer accepted; eBay does not disclose the accepted amount";
  } else if (soldCurrency !== "USD") {
    selectionNote = soldCurrency
      ? `Non-USD sold price${soldPriceDisplay ? ` ${soldPriceDisplay}` : ""} is not selectable`
      : "Sold currency is unavailable; price is not selectable";
  } else if (item.bestOfferAccepted !== false) {
    selectionNote = "Best Offer status is unavailable; price is not selectable";
  } else if (!soldPrice || (soldPriceCents = decimalSoldPriceCents(soldPrice)) == null) {
    selectionNote = "Sold price is missing or unsafe and is not selectable";
  }
  return { soldPriceCents, soldPriceDisplay, selectionNote };
};

export function normalizeEbaySoldCompsV2Date(value: unknown): string | null {
  const text = cleanText(value)?.replace(/^sold\s+/i, "");
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const named = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
  } else if (named) {
    const resolvedMonth = MONTHS[named[1].slice(0, 3).toLowerCase()];
    if (resolvedMonth == null) return null;
    year = Number(named[3]);
    month = resolvedMonth;
    day = Number(named[2]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function parseEbaySoldCompsV2Candidate(
  value: unknown,
  input: EbaySoldCompsV2SearchInput,
): EbaySoldCompV2Candidate | null {
  if (!isRecord(value)) return null;
  const titleValue = cleanText(value.title);
  const title = titleValue && titleValue.length <= MAX_TITLE_LENGTH ? titleValue : null;
  const safeSourceLink = safeEbaySourceUrl(value.url);
  if (!safeSourceLink) return null;
  const linkItemId = safeSourceLink ? ebayItemIdFromSafeUrl(safeSourceLink) : null;
  const directProductId = directProductIdFrom(value);
  if (!linkItemId || !directProductId || linkItemId !== directProductId) return null;
  const productId = directProductId;
  const listingUrl = productId ? `https://www.ebay.com/itm/${productId}` : null;
  if (!title || !listingUrl) return null;
  const { grader, numericGrade } = graderFromTitle(title);
  const targetGrade = input.targetGrade == null ? null : mapTenKingsGradeToPsaGrade(input.targetGrade);
  const variant = parallelMatch(input, title);
  const identity = scoreIdentity(input, title, variant);
  const price = priceFrom(value);
  return {
    id: listingIdentity(listingUrl, productId),
    source: EBAY_SOLD_COMPS_V2_SOURCE,
    productId,
    title,
    listingUrl,
    imageUrl: firstImageUrl(value),
    soldPriceCents: price.soldPriceCents,
    soldPriceDisplay: price.soldPriceDisplay,
    soldDate: normalizeEbaySoldCompsV2Date(value.endedAt),
    condition: cleanText(value.condition)?.slice(0, MAX_CONDITION_LENGTH) ?? null,
    grader,
    numericGrade,
    raw: grader === null,
    group: groupFor(grader, numericGrade, targetGrade),
    parallelMatch: variant,
    matchScore: identity.matchScore,
    matchReason: [identity.matchReason, price.selectionNote].filter(Boolean).join("; "),
  };
}

const defaultFetch: EbaySoldCompsV2Fetch = async (url, init) => {
  const response = await globalThis.fetch(url, init);
  return response;
};

async function readBoundedResponse(response: EbaySoldCompsV2FetchResponse): Promise<string> {
  const declaredLength = Number(response.headers?.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new EbaySoldCompsV2Error("SOLDCOMPS_INVALID_RESPONSE", "SoldComps response exceeded the safe size limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new EbaySoldCompsV2Error("SOLDCOMPS_INVALID_RESPONSE", "SoldComps response exceeded the safe size limit.");
    }
    return body;
  }
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    if (!part.value) continue;
    bytes += part.value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel?.().catch(() => undefined);
      throw new EbaySoldCompsV2Error("SOLDCOMPS_INVALID_RESPONSE", "SoldComps response exceeded the safe size limit.");
    }
    chunks.push(decoder.decode(part.value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

async function fetchPayload(
  url: string,
  apiKey: string,
  expectedQuery: string,
  fetcher: EbaySoldCompsV2Fetch,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      const code: EbaySoldCompsV2ErrorCode = response.status === 401
        ? "SOLDCOMPS_CONFIGURATION_ERROR"
        : response.status === 403
          ? "SOLDCOMPS_QUOTA_REACHED"
          : response.status === 429 || response.status === 502 || response.status === 503
            ? "SOLDCOMPS_TEMPORARY_UNAVAILABLE"
            : "SOLDCOMPS_HTTP_ERROR";
      throw new EbaySoldCompsV2Error(code, "SoldComps request failed.", {
        statusCode: response.status,
        retryable: code === "SOLDCOMPS_TEMPORARY_UNAVAILABLE",
      });
    }
    const contentType = response.headers?.get("content-type");
    if (contentType && !/^application\/json\b/i.test(contentType)) {
      throw new EbaySoldCompsV2Error("SOLDCOMPS_INVALID_RESPONSE", "SoldComps returned an invalid content type.");
    }
    const body = await readBoundedResponse(response);
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new EbaySoldCompsV2Error("SOLDCOMPS_INVALID_RESPONSE", "SoldComps returned invalid JSON.");
    }
    if (!isRecord(payload)) {
      throw new EbaySoldCompsV2Error("SOLDCOMPS_INVALID_RESPONSE", "SoldComps returned an invalid response shape.");
    }
    if (
      cleanText(payload.keyword) !== expectedQuery ||
      payload.page !== 1 ||
      !Number.isSafeInteger(payload.totalItems) ||
      (payload.totalItems as number) < 0 ||
      typeof payload.hasNextPage !== "boolean" ||
      !Array.isArray(payload.items)
    ) {
      throw new EbaySoldCompsV2Error("SOLDCOMPS_INVALID_RESPONSE", "SoldComps returned an invalid result shape.");
    }
    return payload;
  } catch (error) {
    if (error instanceof EbaySoldCompsV2Error) throw error;
    const aborted = timedOut || (error instanceof Error && error.name === "AbortError");
    throw new EbaySoldCompsV2Error(
      aborted ? "SOLDCOMPS_TIMEOUT" : "SOLDCOMPS_NETWORK_ERROR",
      aborted ? "SoldComps request timed out." : "SoldComps network request failed.",
      { retryable: false },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchEbaySoldCompsV2(
  input: EbaySoldCompsV2SearchInput,
  runtimeInput: EbaySoldCompsV2Runtime,
): Promise<EbaySoldCompsV2SearchResult> {
  validatedSearchInput(input);
  const apiKey = cleanText(runtimeInput.apiKey);
  if (!apiKey) throw new EbaySoldCompsV2Error("SOLDCOMPS_CREDENTIAL_MISSING", "A SoldComps credential is required.");
  const timeoutMs = runtimeInput.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) invalidInput("Timeout must be between 1 and 60000 milliseconds.");
  const query = buildEbaySoldCompsV2Query(input);
  const candidates = new Map<string, EbaySoldCompV2Candidate>();
  const params = new URLSearchParams({
    keyword: query,
    ebaySite: "ebay.com",
    count: String(EBAY_SOLD_COMPS_V2_REQUEST_COUNT),
    page: "1",
  });
  const payload = await fetchPayload(
    `${SOLDCOMPS_ENDPOINT}?${params.toString()}`,
    apiKey,
    query,
    runtimeInput.fetch ?? defaultFetch,
    timeoutMs,
  );
  const rawItems = (payload.items as unknown[]).slice(0, EBAY_SOLD_COMPS_V2_REQUEST_COUNT);
  for (const rawItem of rawItems) {
    const candidate = parseEbaySoldCompsV2Candidate(rawItem, input);
    if (candidate && !candidates.has(candidate.id)) candidates.set(candidate.id, candidate);
  }

  const ranked = rankEbaySoldCompsV2Candidates([...candidates.values()]).slice(0, EBAY_SOLD_COMPS_V2_RESULT_LIMIT);
  return {
    source: EBAY_SOLD_COMPS_V2_SOURCE,
    engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
    query,
    retrievedAt: (runtimeInput.now ?? (() => new Date()))().toISOString(),
    offset: 0,
    nextOffset: ranked.length,
    requestedResultCount: EBAY_SOLD_COMPS_V2_RESULT_LIMIT,
    hasMore: false,
    candidates: ranked,
  };
}
