import { parseClassificationPayload } from "./classification";
import { normalizeCardIdentityPlayerName, normalizeCardIdentityPlayerNameBase } from "./cardIdentity";
import { normalizeCardNumber } from "./setOpsNormalizer";

export type KingsreviewCompMatchQuality = "exact" | "close" | "weak";

export type KingsreviewCompMatchContext = {
  playerName: string | null;
  setName: string | null;
  cardNumber: string | null;
  year: string | null;
  parallel: string | null;
  insertSet: string | null;
  autograph: boolean;
  memorabilia: boolean;
  numbered: string | null;
  graded: boolean;
  gradingCompany: string | null;
  gradeScore: string | null;
};

export type KingsreviewCompMatchResult = {
  score: number;
  matchQuality: KingsreviewCompMatchQuality;
  matchedFields: string[];
  penalties: string[];
};

export type KingsreviewCompCandidate = {
  title: string | null;
  condition?: string | null;
  itemSpecifics?: Record<string, string[]> | null;
  matchScore?: number | null;
  matchQuality?: KingsreviewCompMatchQuality | null;
};

const BASE_PARALLEL_TOKENS = new Set(["", "base", "none", "no parallel", "standard", "regular"]);
const GENERIC_INSERT_TOKENS = new Set(["base", "base set", "base card", "trading card"]);
const GRADER_RE = /\b(PSA|BGS|SGC|CGC|CSG|HGA|BVG|TAG)\b/i;
const GRADE_RE =
  /\b(PSA|BGS|SGC|CGC|CSG|HGA|BVG|TAG)\s*(?:GEM\s*MT|GEM\s*MINT|MINT|PRISTINE|BLACK LABEL)?\s*([0-9]{1,2}(?:\.[0-9])?)\b/i;
const AUTO_RE = /\b(auto|autograph|autographs|signed|signature|signatures)\b/i;
const MEMORABILIA_RE = /\b(patch|relic|jersey|memorabilia|swatch|rpa|game used|game-used|player worn|player-worn)\b/i;
const NON_BASE_PARALLEL_RE =
  /\b(gold|silver|green|blue|purple|orange|red|black|white|yellow|pink|teal|bronze|rainbow|refractor|ref|prizm|prism|shimmer|wave|hyper|pulsar|scope|laser|mojo|checkerboard|cracked|ice|snake|tiger|elephant|velocity|flash)\b/i;
const YEAR_RE = /\b((?:19|20)\d{2})(?:-(\d{2,4}))?\b/g;

const PLAYER_KEYS = ["player athlete", "athlete", "player", "name"];
const SET_KEYS = ["set", "card set", "series"];
const CARD_NUMBER_KEYS = ["card number", "card no", "number"];
const YEAR_KEYS = ["season", "year", "year manufactured"];
const PARALLEL_KEYS = ["parallel variety", "parallel", "variety variation", "variation", "variety"];
const FEATURES_KEYS = ["features", "card attributes"];
const INSERT_KEYS = ["insert set", "insert", "subset", "card type", "program"];
const CONDITION_KEYS = ["condition"];
const GRADER_KEYS = ["professional grader", "grader", "grading company"];
const GRADE_KEYS = ["grade"];

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeCompMatchText(value: string | null | undefined): string {
  return compactWhitespace(
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[’'`]/g, "")
      .replace(/[^a-z0-9/]+/g, " ")
  );
}

function compactComparableText(value: string | null | undefined): string {
  return normalizeCompMatchText(value).replace(/[^a-z0-9]+/g, "");
}

export function tokenizeCompMatchText(value: string | null | undefined): string[] {
  return normalizeCompMatchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeSpecificsKey(value: string | null | undefined): string {
  return normalizeCompMatchText(value).replace(/\s+/g, " ").trim();
}

function coerceStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const text = compactWhitespace(value);
    return text ? [text] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => coerceStringArray(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      ...coerceStringArray(record.value),
      ...coerceStringArray(record.values),
      ...coerceStringArray(record.text),
      ...coerceStringArray(record.name),
      ...coerceStringArray(record.label),
    ];
  }
  return [];
}

export function normalizeEbayItemSpecifics(value: unknown): Record<string, string[]> | null {
  const next: Record<string, string[]> = {};

  const append = (key: string | null | undefined, raw: unknown) => {
    const normalizedKey = normalizeSpecificsKey(key);
    if (!normalizedKey) {
      return;
    }
    const values = coerceStringArray(raw);
    if (values.length < 1) {
      return;
    }
    const current = next[normalizedKey] ?? [];
    values.forEach((entry) => {
      if (!current.includes(entry)) {
        current.push(entry);
      }
    });
    next[normalizedKey] = current;
  };

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const record = entry as Record<string, unknown>;
      append(
        typeof record.name === "string"
          ? record.name
          : typeof record.label === "string"
            ? record.label
            : typeof record.key === "string"
              ? record.key
              : null,
        record.value ?? record.values ?? record.text
      );
    });
  } else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => append(key, raw));
  }

  return Object.keys(next).length > 0 ? next : null;
}

function getSpecificsValues(
  specifics: Record<string, string[]> | null | undefined,
  keys: string[]
): string[] {
  if (!specifics) {
    return [];
  }
  const results: string[] = [];
  keys.forEach((key) => {
    const normalizedKey = normalizeSpecificsKey(key);
    const values = specifics[normalizedKey] ?? [];
    values.forEach((value) => {
      if (!results.includes(value)) {
        results.push(value);
      }
    });
  });
  return results;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return right.length;
  }
  if (!right) {
    return left.length;
  }

  const prev = new Array(right.length + 1).fill(0);
  const next = new Array(right.length + 1).fill(0);

  for (let index = 0; index <= right.length; index += 1) {
    prev[index] = index;
  }

  for (let row = 0; row < left.length; row += 1) {
    next[0] = row + 1;
    for (let column = 0; column < right.length; column += 1) {
      const cost = left[row] === right[column] ? 0 : 1;
      next[column + 1] = Math.min(
        next[column] + 1,
        prev[column + 1] + 1,
        prev[column] + cost
      );
    }
    for (let column = 0; column <= right.length; column += 1) {
      prev[column] = next[column];
    }
  }

  return prev[right.length];
}

function tokensEquivalent(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (left.length > 1 && right.length > 1 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  const distance = levenshteinDistance(left, right);
  if (Math.max(left.length, right.length) >= 8) {
    return distance <= 2;
  }
  if (Math.max(left.length, right.length) >= 5) {
    return distance <= 1;
  }
  return false;
}

export function tokenOverlapScore(left: string | null | undefined, right: string | null | undefined): number {
  const leftTokens = tokenizeCompMatchText(left);
  const rightTokens = tokenizeCompMatchText(right);
  if (leftTokens.length < 1 || rightTokens.length < 1) {
    return 0;
  }
  let matched = 0;
  leftTokens.forEach((leftToken) => {
    if (rightTokens.some((rightToken) => tokensEquivalent(leftToken, rightToken))) {
      matched += 1;
    }
  });
  return matched / leftTokens.length;
}

export function fuzzyPlayerMatch(expected: string | null | undefined, actual: string | null | undefined): boolean {
  const expectedFull = normalizeCardIdentityPlayerName(expected);
  const actualFull = normalizeCardIdentityPlayerName(actual);
  const expectedBase = normalizeCardIdentityPlayerNameBase(expected);
  const actualBase = normalizeCardIdentityPlayerNameBase(actual);

  if (!expectedBase || !actualBase) {
    return false;
  }
  if (expectedFull && actualFull && expectedFull === actualFull) {
    return true;
  }
  if (expectedBase === actualBase) {
    return true;
  }
  if (tokenOverlapScore(expectedBase, actualBase) >= 0.8) {
    return true;
  }

  const expectedTokens = expectedBase.split(" ").filter(Boolean);
  const actualTokens = actualBase.split(" ").filter(Boolean);
  const expectedLast = expectedTokens[expectedTokens.length - 1] ?? "";
  const actualLast = actualTokens[actualTokens.length - 1] ?? "";
  if (!expectedLast || !actualLast) {
    return false;
  }
  if (expectedLast === actualLast) {
    return true;
  }
  return levenshteinDistance(expectedLast, actualLast) <= 2;
}

export function fuzzySetMatch(expected: string | null | undefined, actual: string | null | undefined): boolean {
  return tokenOverlapScore(expected, actual) >= 0.7;
}

function normalizeParallelBase(value: string | null | undefined): string {
  const normalized = normalizeCompMatchText(value).replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g, "").replace(/#\s*\/\s*\d{1,4}\b/g, "");
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token !== "parallel" && token !== "variety" && token !== "variation");
  return tokens.join(" ").trim();
}

function isBaseParallel(value: string | null | undefined): boolean {
  return BASE_PARALLEL_TOKENS.has(normalizeParallelBase(value));
}

export function fuzzyParallelMatch(expected: string | null | undefined, actual: string | null | undefined): boolean {
  const expectedIsBase = isBaseParallel(expected);
  const actualIsBase = isBaseParallel(actual);

  if (expectedIsBase && actualIsBase) {
    return true;
  }
  if (expectedIsBase !== actualIsBase) {
    return false;
  }

  return tokenOverlapScore(normalizeParallelBase(expected), normalizeParallelBase(actual)) >= 0.8;
}

function parseYearFromText(text: string | null | undefined): string | null {
  const normalized = String(text ?? "");
  const match = YEAR_RE.exec(normalized);
  YEAR_RE.lastIndex = 0;
  return match?.[1] ?? null;
}

function parseYearVariants(value: string | null | undefined): string[] {
  const year = String(value ?? "").trim();
  if (!year) {
    return [];
  }
  if (/^\d{4}$/.test(year)) {
    return [year, year.slice(2)];
  }
  const parsed = parseYearFromText(year);
  if (parsed) {
    return [parsed, parsed.slice(2)];
  }
  return [year];
}

function yearMatches(expected: string | null | undefined, actualValues: string[]): boolean {
  const candidates = parseYearVariants(expected);
  if (candidates.length < 1) {
    return false;
  }
  const normalizedValues = actualValues.flatMap((value) => parseYearVariants(value));
  return candidates.some((candidate) => normalizedValues.includes(candidate));
}

function normalizeComparableCardNumber(value: string | null | undefined): string | null {
  const normalized = normalizeCardNumber(value ?? "");
  if (!normalized) {
    return null;
  }
  return normalized.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function cardNumberMatches(expected: string | null | undefined, actualValues: string[]): boolean {
  const normalizedExpected = normalizeComparableCardNumber(expected);
  if (!normalizedExpected) {
    return false;
  }
  return actualValues.some((value) => {
    const normalizedActual = normalizeComparableCardNumber(value);
    if (!normalizedActual) {
      return false;
    }
    return normalizedActual === normalizedExpected || compactComparableText(value).includes(normalizedExpected);
  });
}

function extractSerialDenominator(value: string | null | undefined): string | null {
  const raw = String(value ?? "");
  if (!raw.trim()) {
    return null;
  }
  const directMatch =
    raw.match(/\b\d{1,4}\s*\/\s*(\d{1,4})\b/i) ??
    raw.match(/#?\s*\/\s*(\d{1,4})\b/i) ??
    raw.match(/\bout of\s+(\d{1,4})\b/i);
  if (!directMatch?.[1]) {
    return null;
  }
  const normalized = String(Number(directMatch[1]));
  return normalized && normalized !== "0" ? normalized : null;
}

function detectGradedState(
  title: string | null | undefined,
  condition: string | null | undefined,
  specifics: Record<string, string[]> | null | undefined
) {
  const titleText = String(title ?? "");
  const conditionValues = [
    condition ?? "",
    ...getSpecificsValues(specifics, CONDITION_KEYS),
  ];
  const graderValues = getSpecificsValues(specifics, GRADER_KEYS);
  const gradeValues = getSpecificsValues(specifics, GRADE_KEYS);
  const titleGradeMatch = titleText.match(GRADE_RE);
  const titleGraderMatch = titleText.match(GRADER_RE);
  const explicitlyUngraded = conditionValues.some((value) => /\b(?:ungraded|raw)\b/i.test(value));
  const gradedByCondition = !explicitlyUngraded && conditionValues.some((value) => /\bgraded\b/i.test(value));
  const grader =
    graderValues.find(Boolean) ??
    titleGradeMatch?.[1] ??
    titleGraderMatch?.[1] ??
    null;
  const grade =
    gradeValues.find(Boolean) ??
    titleGradeMatch?.[2] ??
    null;
  const graded = Boolean(gradedByCondition || grader || grade);
  return {
    graded,
    grader: compactWhitespace(String(grader ?? "")) || null,
    grade: compactWhitespace(String(grade ?? "")) || null,
  };
}

function detectBooleanFeature(
  title: string | null | undefined,
  specifics: Record<string, string[]> | null | undefined,
  type: "autograph" | "memorabilia"
): boolean {
  const featureText = [
    title ?? "",
    ...getSpecificsValues(specifics, FEATURES_KEYS),
    ...getSpecificsValues(specifics, INSERT_KEYS),
    ...getSpecificsValues(specifics, PARALLEL_KEYS),
  ].join(" ");
  return type === "autograph" ? AUTO_RE.test(featureText) : MEMORABILIA_RE.test(featureText);
}

function hasExplicitNonBaseParallelSignal(title: string | null | undefined, specifics: Record<string, string[]> | null | undefined): boolean {
  const parallelTexts = [
    title ?? "",
    ...getSpecificsValues(specifics, PARALLEL_KEYS),
  ].join(" ");
  return NON_BASE_PARALLEL_RE.test(parallelTexts);
}

function buildCompValuePool(comp: KingsreviewCompCandidate) {
  const specifics = comp.itemSpecifics ?? null;
  const title = comp.title ?? "";
  return {
    playerValues: [...getSpecificsValues(specifics, PLAYER_KEYS), title],
    setValues: [...getSpecificsValues(specifics, SET_KEYS), title],
    cardNumberValues: [...getSpecificsValues(specifics, CARD_NUMBER_KEYS), title],
    yearValues: [...getSpecificsValues(specifics, YEAR_KEYS), title],
    parallelValues: [...getSpecificsValues(specifics, PARALLEL_KEYS), title],
    insertValues: [...getSpecificsValues(specifics, INSERT_KEYS), title],
    title,
    specifics,
  };
}

function isMeaningfulInsertSet(value: string | null | undefined): boolean {
  const normalized = normalizeCompMatchText(value);
  return Boolean(normalized && !GENERIC_INSERT_TOKENS.has(normalized));
}

function buildQuality(score: number): KingsreviewCompMatchQuality {
  if (score >= 80) {
    return "exact";
  }
  if (score >= 55) {
    return "close";
  }
  return "weak";
}

function coalesceBoolean(value: boolean | null | undefined, fallback: boolean): boolean {
  return value == null ? fallback : value;
}

function readLooseString(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const value = (record as Record<string, unknown>)[key];
  return compactWhitespace(String(value ?? "")) || null;
}

export function buildKingsreviewCompMatchContext(input: {
  resolvedPlayerName?: string | null;
  classification?: unknown;
  normalized?: unknown;
  customTitle?: string | null;
  variantId?: string | null;
}): KingsreviewCompMatchContext | null {
  const parsed = parseClassificationPayload(
    input.normalized !== undefined
      ? { attributes: input.classification, normalized: input.normalized }
      : input.classification
  );

  const attributes = parsed?.attributes ?? null;
  const normalized = parsed?.normalized ?? null;
  const normalizedRecord = normalized as Record<string, unknown> | null;
  const playerName =
    compactWhitespace(
      String(
        input.resolvedPlayerName ??
          normalized?.sport?.playerName ??
          attributes?.playerName ??
          ""
      )
    ) || null;
  const setName =
    compactWhitespace(
      String(normalized?.setName ?? attributes?.setName ?? "")
    ) || null;
  const cardNumber =
    compactWhitespace(String(normalized?.cardNumber ?? "")) || null;
  const year =
    compactWhitespace(
      String(normalized?.year ?? attributes?.year ?? parseYearFromText(input.customTitle ?? "") ?? "")
    ) || null;
  const parallel =
    compactWhitespace(
      String(
        attributes?.variantKeywords?.[0] ??
          readLooseString(normalizedRecord, "parallelName") ??
          input.variantId ??
          "Base"
      )
    ) || "Base";
  const insertSet =
    compactWhitespace(
      String(
        normalized?.setCode ??
          readLooseString(normalizedRecord, "insertSet") ??
          readLooseString(attributes as Record<string, unknown> | null, "insertSet") ??
          ""
      )
    ) || null;
  const gradingCompany =
    compactWhitespace(
      String(normalized?.sport?.gradeCompany ?? attributes?.gradeCompany ?? "")
    ) || null;
  const gradeScore =
    compactWhitespace(String(normalized?.sport?.grade ?? attributes?.gradeValue ?? "")) || null;
  const graded = coalesceBoolean(normalized?.sport?.graded ?? null, Boolean(gradingCompany || gradeScore));

  if (!playerName && !setName && !cardNumber) {
    return null;
  }

  return {
    playerName,
    setName,
    cardNumber,
    year,
    parallel,
    insertSet,
    autograph: Boolean(attributes?.autograph ?? normalized?.sport?.autograph ?? false),
    memorabilia: Boolean(attributes?.memorabilia ?? false),
    numbered: compactWhitespace(String(attributes?.numbered ?? "")) || null,
    graded,
    gradingCompany,
    gradeScore,
  };
}

export function scoreKingsreviewComp(
  context: KingsreviewCompMatchContext | null | undefined,
  comp: KingsreviewCompCandidate
): KingsreviewCompMatchResult | null {
  if (!context?.playerName) {
    return null;
  }

  const pool = buildCompValuePool(comp);
  const matchedFields: string[] = [];
  const penalties: string[] = [];
  let score = 0;

  const playerMatched = pool.playerValues.some((value) => fuzzyPlayerMatch(context.playerName, value));
  if (!playerMatched) {
    return {
      score: 0,
      matchQuality: "weak",
      matchedFields,
      penalties: ["player"],
    };
  }
  score += 20;
  matchedFields.push("player");

  if (context.setName) {
    const setMatched = pool.setValues.some((value) => fuzzySetMatch(context.setName, value));
    if (setMatched) {
      score += 20;
      matchedFields.push("set");
    }
  }

  if (context.cardNumber) {
    const cardNumberMatched = cardNumberMatches(context.cardNumber, pool.cardNumberValues);
    if (cardNumberMatched) {
      score += 15;
      matchedFields.push("cardNumber");
    }
  }

  if (context.year) {
    const yearMatched = yearMatches(context.year, pool.yearValues);
    if (yearMatched) {
      score += 10;
      matchedFields.push("year");
    }
  }

  if (context.parallel) {
    const parallelMatched = pool.parallelValues.some((value) => fuzzyParallelMatch(context.parallel, value));
    if (parallelMatched) {
      score += 15;
      matchedFields.push("parallel");
    } else if (isBaseParallel(context.parallel)) {
      if (hasExplicitNonBaseParallelSignal(pool.title, pool.specifics)) {
        score -= 30;
        penalties.push("parallel");
      }
    } else {
      score -= 30;
      penalties.push("parallel");
    }
  }

  const compGrading = detectGradedState(pool.title, comp.condition ?? null, pool.specifics);
  if (context.graded === compGrading.graded) {
    score += 10;
    matchedFields.push("graded");
  } else {
    score -= 35;
    penalties.push("graded");
  }

  if (context.graded && compGrading.graded) {
    if (
      context.gradingCompany &&
      compGrading.grader &&
      normalizeCompMatchText(context.gradingCompany) === normalizeCompMatchText(compGrading.grader)
    ) {
      score += 5;
      matchedFields.push("grader");
    }
    if (
      context.gradeScore &&
      compGrading.grade &&
      normalizeCompMatchText(context.gradeScore) === normalizeCompMatchText(compGrading.grade)
    ) {
      score += 5;
      matchedFields.push("grade");
    }
  }

  if (isMeaningfulInsertSet(context.insertSet)) {
    const insertMatched = pool.insertValues.some((value) => fuzzySetMatch(context.insertSet, value));
    if (insertMatched) {
      score += 8;
      matchedFields.push("insertSet");
    }
  }

  const compAutograph = detectBooleanFeature(pool.title, pool.specifics, "autograph");
  if (context.autograph === compAutograph) {
    score += 5;
    matchedFields.push("autograph");
  } else if (context.autograph || compAutograph) {
    score -= 6;
    penalties.push("autograph");
  }

  const compMemorabilia = detectBooleanFeature(pool.title, pool.specifics, "memorabilia");
  if (context.memorabilia === compMemorabilia) {
    score += 5;
    matchedFields.push("memorabilia");
  } else if (context.memorabilia || compMemorabilia) {
    score -= 6;
    penalties.push("memorabilia");
  }

  const expectedDenominator = extractSerialDenominator(context.numbered);
  const actualDenominator = extractSerialDenominator(
    [pool.title, ...getSpecificsValues(pool.specifics, PARALLEL_KEYS), ...getSpecificsValues(pool.specifics, FEATURES_KEYS)].join(" ")
  );
  if (expectedDenominator && actualDenominator) {
    if (expectedDenominator === actualDenominator) {
      score += 8;
      matchedFields.push("serialDenominator");
    } else {
      score -= 20;
      penalties.push("serialDenominator");
    }
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  return {
    score: normalizedScore,
    matchQuality: buildQuality(normalizedScore),
    matchedFields,
    penalties,
  };
}

export function annotateAndSortKingsreviewComps<T extends KingsreviewCompCandidate>(
  context: KingsreviewCompMatchContext | null | undefined,
  comps: T[]
): Array<T & { matchScore: number | null; matchQuality: KingsreviewCompMatchQuality | null }> {
  const annotated = comps.map((comp, index) => {
    const scored = scoreKingsreviewComp(context, comp);
    return {
      ...comp,
      matchScore: scored?.score ?? null,
      matchQuality: scored?.matchQuality ?? null,
      __sortIndex: index,
    };
  });

  if (!context?.playerName) {
    return annotated.map(({ __sortIndex, ...comp }) => comp as T & {
      matchScore: number | null;
      matchQuality: KingsreviewCompMatchQuality | null;
    });
  }

  annotated.sort((left, right) => {
    const leftScore = left.matchScore ?? -1;
    const rightScore = right.matchScore ?? -1;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return left.__sortIndex - right.__sortIndex;
  });

  return annotated.map(({ __sortIndex, ...comp }) => comp as T & {
    matchScore: number | null;
    matchQuality: KingsreviewCompMatchQuality | null;
  });
}
