import { CardAttributes, extractCardAttributes } from "./cardAttributes";

export type ClassificationCategory = "sport" | "tcg" | "comics" | "unknown";

export interface NormalizedClassificationLinks {
  [provider: string]: string;
}

export interface NormalizedPricingEntry {
  itemId: string | null;
  itemLink: string | null;
  name: string | null;
  price: number | null;
  currency: string | null;
  countryCode: string | null;
  source: string | null;
  dateOfCreation: string | null;
  dateOfSale: string | null;
  gradeCompany: string | null;
  grade: string | number | null;
  variation: string | null;
  version: string | null;
}

export interface NormalizedClassificationSport {
  playerName: string | null;
  teamName: string | null;
  league: string | null;
  sport: string | null;
  cardType: string | null;
  subcategory: string | null;
  autograph: boolean | null;
  foil: boolean | null;
  graded: boolean | null;
  gradeCompany: string | null;
  grade: string | null;
}

export interface NormalizedClassificationTcg {
  cardName: string | null;
  game: string | null;
  series: string | null;
  color: string | null;
  type: string | null;
  language: string | null;
  foil: boolean | null;
  rarity: string | null;
  outOf: string | null;
  subcategory: string | null;
}

export interface NormalizedClassificationComics {
  title: string | null;
  issueNumber: string | null;
  date: string | null;
  originDate: string | null;
  storyArc: string | null;
  graded: boolean | null;
  gradeCompany: string | null;
  grade: string | null;
}

export interface NormalizedClassification {
  categoryType: ClassificationCategory;
  displayName: string | null;
  cardNumber: string | null;
  setName: string | null;
  setCode: string | null;
  year: string | null;
  company: string | null;
  rarity: string | null;
  links: NormalizedClassificationLinks;
  pricing: NormalizedPricingEntry[];
  sport?: NormalizedClassificationSport;
  tcg?: NormalizedClassificationTcg;
  comics?: NormalizedClassificationComics;
}

export interface CardClassificationPayload {
  attributes: CardAttributes;
  normalized: NormalizedClassification | null;
}

export interface ClassificationSnapshotSummaryLike {
  playerName: string | null;
  teamName: string | null;
  year: string | null;
  setName: string | null;
}

export interface ClassificationSnapshotLike {
  categoryType: ClassificationCategory;
  category?: string | null;
  subcategory?: string | null;
  graded?: "yes" | "no" | null;
  summary?: ClassificationSnapshotSummaryLike | null;
  slabMatch?: Record<string, unknown> | null;
  bestMatchData?: Record<string, unknown> | null;
}

export function buildClassificationPayload(options: {
  ocrText: string | null | undefined;
  normalized: NormalizedClassification | null;
  bestMatch?: Record<string, unknown> | null;
}): CardClassificationPayload {
  const attributes = extractCardAttributes(options.ocrText, {
    bestMatch: options.bestMatch,
  });

  return {
    attributes,
    normalized: options.normalized ?? null,
  };
}

export function createClassificationPayloadFromAttributes(
  attributes: CardAttributes,
  normalized: NormalizedClassification | null = null
): CardClassificationPayload {
  return {
    attributes,
    normalized,
  };
}

export function buildNormalizedClassificationFromXimilar(
  bestMatch: Record<string, unknown> | null | undefined,
  snapshot: ClassificationSnapshotLike | null | undefined
): NormalizedClassification | null {
  if (!bestMatch && !snapshot) {
    return null;
  }

  const matchRecord = isRecord(bestMatch) ? bestMatch : {};
  const summary = snapshot?.summary ?? null;
  const slabMatch = isRecord(snapshot?.slabMatch) ? (snapshot!.slabMatch as Record<string, unknown>) : null;

  const categoryType = resolveCategoryType(snapshot?.categoryType, matchRecord, snapshot?.subcategory);

  const links = mergeLinkSources(
    matchRecord.links,
    snapshot?.bestMatchData && isRecord(snapshot.bestMatchData) ? snapshot.bestMatchData.links : null,
    slabMatch?.links
  );

  const pricingSource = extractPricingSource(matchRecord);
  const pricing = normalizePricing(pricingSource);

  const displayName =
    pickString(matchRecord, ["full_name", "name", "title"]) ??
    summary?.playerName ??
    summary?.setName ??
    null;

  const cardNumber = pickString(matchRecord, ["card_number", "card_no", "number"]);
  const setName =
    pickString(matchRecord, ["set_name", "set", "sub_set", "series"]) ??
    summary?.setName ??
    null;
  const setCode = pickString(matchRecord, ["set_code", "series_code"]);
  const year =
    pickString(matchRecord, ["year", "date", "origin_date"]) ??
    summary?.year ??
    null;
  const company =
    pickString(matchRecord, ["company", "publisher", "brand"]) ??
    pickString(slabMatch, ["brand", "company"]) ??
    null;
  const rarity = pickString(matchRecord, ["rarity", "card_type", "tier"]);

  const raw: Record<string, unknown> = {
    categoryType,
    displayName,
    cardNumber,
    setName,
    setCode,
    year,
    company,
    rarity,
    links,
    pricing,
  };

  if (categoryType === "sport") {
    const graded = resolveGradedFlag(snapshot?.graded, matchRecord, slabMatch);
    const sport: Record<string, unknown> = {
      playerName:
        pickString(matchRecord, ["player", "name", "full_name"]) ??
        summary?.playerName ??
        null,
      teamName:
        pickString(matchRecord, ["team", "club"]) ??
        summary?.teamName ??
        null,
      league: pickString(matchRecord, ["league"]),
      sport: pickString(matchRecord, ["sport"]),
      cardType: pickString(matchRecord, ["card_type", "cardType"]),
      subcategory:
        pickString(matchRecord, ["subcategory"]) ??
        snapshot?.subcategory ??
        null,
      autograph: pickBoolean(matchRecord, ["autograph"]) ?? pickBoolean(slabMatch, ["autograph"]),
      foil: pickBoolean(matchRecord, ["foil", "Foil/Holo", "isFoil"]),
      graded,
      gradeCompany:
        pickString(matchRecord, ["grade_company", "grading_company"]) ??
        pickString(slabMatch, ["brand", "company"]),
      grade:
        pickString(matchRecord, ["grade"]) ??
        pickString(slabMatch, ["grade", "verbal_grade"]),
    };
    raw.sport = sport;
  }

  if (categoryType === "tcg") {
    const tcg: Record<string, unknown> = {
      cardName: pickString(matchRecord, ["full_name", "name", "title"]),
      game: pickString(matchRecord, ["game", "subcategory"]),
      series: pickString(matchRecord, ["series"]),
      color: pickString(matchRecord, ["color"]),
      type: pickString(matchRecord, ["type"]),
      language: pickString(matchRecord, ["language", "lang"]),
      foil:
        pickBoolean(matchRecord, ["foil"]) ??
        pickBooleanValueFromText(pickString(matchRecord, ["version", "variation"])),
      rarity: pickString(matchRecord, ["rarity"]),
      outOf: pickString(matchRecord, ["out_of", "outOf"]),
      subcategory: pickString(matchRecord, ["subcategory"]),
    };
    raw.tcg = tcg;
  }

  if (categoryType === "comics") {
    const comics: Record<string, unknown> = {
      title: pickString(matchRecord, ["title", "name"]),
      issueNumber:
        pickString(matchRecord, ["issue_number", "number", "card_no"]) ??
        pickString(slabMatch, ["card_no", "number"]),
      date:
        pickString(matchRecord, ["date"]) ??
        pickString(slabMatch, ["date"]),
      originDate: pickString(matchRecord, ["origin_date"]),
      storyArc: pickString(matchRecord, ["story_arc"]),
      graded: resolveGradedFlag(snapshot?.graded, matchRecord, slabMatch),
      gradeCompany:
        pickString(matchRecord, ["grade_company"]) ??
        pickString(slabMatch, ["brand", "company"]),
      grade:
        pickString(matchRecord, ["grade"]) ??
        pickString(slabMatch, ["grade", "verbal_grade"]),
    };
    raw.comics = comics;
  }

  return coerceNormalizedClassification(raw) ?? null;
}

export function parseClassificationPayload(value: unknown): CardClassificationPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as CardClassificationPayload & Record<string, unknown>;
  if (payload.attributes && typeof payload.attributes === "object") {
    const attributes = coerceCardAttributes(payload.attributes);
    const normalized = payload.normalized && typeof payload.normalized === "object"
      ? coerceNormalizedClassification(payload.normalized)
      : null;
    return {
      attributes,
      normalized,
    };
  }

  // Legacy format: value is the raw CardAttributes blob.
  const attributes = coerceCardAttributes(value as Record<string, unknown>);
  if (!attributes) {
    return null;
  }
  return {
    attributes,
    normalized: null,
  };
}

export function getCardAttributesFromClassification(value: unknown): CardAttributes | null {
  const parsed = parseClassificationPayload(value);
  return parsed?.attributes ?? null;
}

export function getNormalizedClassification(value: unknown): NormalizedClassification | null {
  const parsed = parseClassificationPayload(value);
  return parsed?.normalized ?? null;
}

function coerceCardAttributes(value: Record<string, unknown> | null | undefined): CardAttributes | null {
  if (!value) {
    return null;
  }
  const safeBoolean = (input: unknown) => (typeof input === "boolean" ? input : Boolean(input));
  return {
    playerName: typeof value.playerName === "string" ? value.playerName : null,
    teamName: typeof value.teamName === "string" ? value.teamName : null,
    year: typeof value.year === "string" ? value.year : null,
    brand: typeof value.brand === "string" ? value.brand : null,
    setName: typeof value.setName === "string" ? value.setName : null,
    variantKeywords: Array.isArray(value.variantKeywords)
      ? value.variantKeywords.filter((entry): entry is string => typeof entry === "string")
      : [],
    serialNumber: typeof value.serialNumber === "string" ? value.serialNumber : null,
    rookie: value.rookie == null ? false : safeBoolean(value.rookie),
    autograph: value.autograph == null ? false : safeBoolean(value.autograph),
    memorabilia: value.memorabilia == null ? false : safeBoolean(value.memorabilia),
    gradeCompany: typeof value.gradeCompany === "string" ? value.gradeCompany : null,
    gradeValue: typeof value.gradeValue === "string" ? value.gradeValue : null,
  };
}

function coerceNormalizedClassification(value: Record<string, unknown>): NormalizedClassification | null {
  const categoryType = normalizeCategory(value.categoryType);
  const links = normalizeLinks(value.links);
  const pricing = normalizePricing(value.pricing);

  const base: NormalizedClassification = {
    categoryType,
    displayName: asString(value.displayName),
    cardNumber: asString(value.cardNumber),
    setName: asString(value.setName),
    setCode: asString(value.setCode),
    year: asString(value.year),
    company: asString(value.company) ?? asString(value.publisher),
    rarity: asString(value.rarity),
    links,
    pricing,
  };

  const sport = normalizeSportClassification(value.sport ?? value.sports);
  if (sport) {
    base.sport = sport;
  }

  const tcg = normalizeTcgClassification(value.tcg);
  if (tcg) {
    base.tcg = tcg;
  }

  const comics = normalizeComicsClassification(value.comics);
  if (comics) {
    base.comics = comics;
  }

  return base;
}

function normalizeCategory(value: unknown): ClassificationCategory {
  if (value === "sport" || value === "tcg" || value === "comics" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

const SPORT_KEYWORDS = [
  "baseball",
  "basketball",
  "football",
  "soccer",
  "hockey",
  "mma",
  "ufc",
  "golf",
  "wwe",
  "f1",
  "formula",
  "nascar",
];

const TCG_KEYWORDS = [
  "pokemon",
  "magic",
  "yugioh",
  "yu-gi-oh",
  "lorcana",
  "one piece",
  "digimon",
  "tcg",
  "trading card",
];

function resolveCategoryType(
  initial: ClassificationCategory | null | undefined,
  matchRecord: Record<string, unknown>,
  snapshotSubcategory: string | null | undefined
): ClassificationCategory {
  if (initial && initial !== "unknown") {
    return initial;
  }

  const categoryCandidate = pickString(matchRecord, ["Category", "category"]);
  if (categoryCandidate) {
    const normalized = categoryCandidate.toLowerCase();
    if (normalized.includes("sport")) {
      return "sport";
    }
    if (normalized.includes("comic")) {
      return "comics";
    }
    if (normalized.includes("trading card") || normalized.includes("tcg")) {
      return "tcg";
    }
  }

  const subcategoryCandidate = snapshotSubcategory ?? pickString(matchRecord, ["subcategory"]);
  if (subcategoryCandidate) {
    const normalized = subcategoryCandidate.toLowerCase();
    if (SPORT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      return "sport";
    }
    if (TCG_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      return "tcg";
    }
  }

  const publisherCandidate = pickString(matchRecord, ["publisher"]);
  if (publisherCandidate) {
    return "comics";
  }

  return "unknown";
}

function mergeLinkSources(...sources: Array<unknown>): NormalizedClassificationLinks {
  return sources.reduce<NormalizedClassificationLinks>((acc, source) => {
    const normalized = normalizeLinks(source);
    for (const [key, value] of Object.entries(normalized)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function extractPricingSource(matchRecord: Record<string, unknown>): unknown[] {
  const pricing = (matchRecord as any).pricing;
  if (pricing && typeof pricing === "object") {
    const list = (pricing as any).list;
    if (Array.isArray(list)) {
      return list as unknown[];
    }
  }
  if (Array.isArray(pricing)) {
    return pricing as unknown[];
  }
  return [];
}

function pickString(
  source: Record<string, unknown> | null | undefined,
  keys: string[]
): string | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = asString((source as any)[key]);
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function pickBoolean(
  source: Record<string, unknown> | null | undefined,
  keys: string[]
): boolean | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = asBoolean((source as any)[key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function resolveGradedFlag(
  graded: "yes" | "no" | null | undefined,
  matchRecord: Record<string, unknown>,
  slabMatch: Record<string, unknown> | null
): boolean | null {
  if (graded === "yes") {
    return true;
  }
  if (graded === "no") {
    return false;
  }
  const matchValue = pickBoolean(matchRecord, ["graded"]);
  if (matchValue !== null) {
    return matchValue;
  }
  const slabValue = pickBoolean(slabMatch, ["graded"]);
  if (slabValue !== null) {
    return slabValue;
  }
  return null;
}

function pickBooleanValueFromText(value: string | null): boolean | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("foil")) {
    if (normalized.includes("non")) {
      return false;
    }
    return true;
  }
  if (normalized.includes("signed") || normalized.includes("autograph")) {
    if (normalized.includes("not")) {
      return false;
    }
    return true;
  }
  return null;
}

function normalizeLinks(value: unknown): NormalizedClassificationLinks {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result: NormalizedClassificationLinks = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && raw.trim().length > 0) {
      result[key] = raw;
    }
  }
  return result;
}

function normalizePricing(value: unknown): NormalizedPricingEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizePricingEntry(entry))
    .filter((entry): entry is NormalizedPricingEntry => Boolean(entry));
}

function normalizePricingEntry(value: unknown): NormalizedPricingEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    itemId: asString(record.itemId) ?? asString(record.item_id),
    itemLink: asString(record.itemLink) ?? asString(record.item_link),
    name: asString(record.name),
    price: asNumber(record.price),
    currency: asString(record.currency),
    countryCode: asString(record.countryCode) ?? asString(record.country_code),
    source: asString(record.source),
    dateOfCreation: asString(record.dateOfCreation) ?? asString(record.date_of_creation),
    dateOfSale: asString(record.dateOfSale) ?? asString(record.date_of_sale),
    gradeCompany: asString(record.gradeCompany) ?? asString(record.grade_company),
    grade: record.grade != null && typeof record.grade !== "object" ? (record.grade as string | number) : null,
    variation: asString(record.variation),
    version: asString(record.version),
  };
}

function normalizeSportClassification(value: unknown): NormalizedClassificationSport | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    playerName: asString(record.playerName) ?? asString(record.player),
    teamName: asString(record.teamName) ?? asString(record.team),
    league: asString(record.league),
    sport: asString(record.sport),
    cardType: asString(record.cardType) ?? asString(record.card_type),
    subcategory: asString(record.subcategory),
    autograph: asBoolean(record.autograph),
    foil: asBoolean(record.foil),
    graded: asBoolean(record.graded),
    gradeCompany: asString(record.gradeCompany) ?? asString(record.grade_company),
    grade: asString(record.grade),
  };
}

function normalizeTcgClassification(value: unknown): NormalizedClassificationTcg | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    cardName: asString(record.cardName) ?? asString(record.name),
    game: asString(record.game) ?? asString(record.subcategory),
    series: asString(record.series),
    color: asString(record.color),
    type: asString(record.type),
    language: asString(record.language) ?? asString(record.lang),
    foil: asBoolean(record.foil),
    rarity: asString(record.rarity),
    outOf: asString(record.outOf) ?? asString(record.out_of),
    subcategory: asString(record.subcategory),
  };
}

function normalizeComicsClassification(value: unknown): NormalizedClassificationComics | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    title: asString(record.title) ?? asString(record.name),
    issueNumber: asString(record.issueNumber) ?? asString(record.number) ?? asString(record.card_no),
    date: asString(record.date),
    originDate: asString(record.originDate) ?? asString(record.origin_date),
    storyArc: asString(record.storyArc),
    graded: asBoolean(record.graded),
    gradeCompany: asString(record.gradeCompany) ?? asString(record.grade_company),
    grade: asString(record.grade),
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (["true", "yes", "y", "1"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "n", "0"].includes(normalized)) {
      return false;
    }
    if (normalized.includes("foil/holo") || normalized === "foil" || normalized === "holo") {
      return true;
    }
    if (normalized.includes("non-foil") || normalized === "nonfoil") {
      return false;
    }
    if (normalized.includes("signed") || normalized.includes("autograph")) {
      if (normalized.includes("not")) {
        return false;
      }
      return true;
    }
  }
  return null;
}
