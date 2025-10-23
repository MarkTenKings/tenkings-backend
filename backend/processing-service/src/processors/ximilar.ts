// @ts-nocheck
import sharp from "sharp";
import { config } from "../config";

const COLLECTIBLES_BASE_URL = "https://api.ximilar.com/collectibles";
const TEXT_BASE_URL = `${COLLECTIBLES_BASE_URL}/text`;

const MAX_RECORDS = 5;
const MIN_TOKEN_MATCH = 2;
const MIN_SCORE_THRESHOLD = 0.55;
const SECONDARY_SCORE_THRESHOLD = 0.4;
const IMAGE_SIZE_LIMIT = config.ximilarMaxImageBytes ?? 2_500_000;

async function prepareImageForXimilar(base64: string): Promise<string | null> {
  let buffer = Buffer.from(base64, "base64");
  if (buffer.length <= IMAGE_SIZE_LIMIT) {
    return base64;
  }

  const attempts: Array<() => Promise<Buffer>> = [
    () =>
      sharp(buffer)
        .rotate()
        .jpeg({ quality: 90 })
        .toBuffer(),
    () =>
      sharp(buffer)
        .rotate()
        .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer(),
    () =>
      sharp(buffer)
        .rotate()
        .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer(),
    () =>
      sharp(buffer)
        .rotate()
        .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer(),
  ];

  for (const attempt of attempts) {
    try {
      const resized = await attempt();
      if (resized.length <= IMAGE_SIZE_LIMIT) {
        return resized.toString("base64");
      }
      buffer = resized;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[processing-service] classification image compression failed: ${message}`);
    }
  }

  if (buffer.length <= IMAGE_SIZE_LIMIT) {
    return buffer.toString("base64");
  }

  console.warn(
    `[processing-service] Ximilar classification skipped after compression attempts (size ${buffer.length} bytes, limit ${IMAGE_SIZE_LIMIT})`
  );
  return null;
}

interface RawAnalyzeRecord {
  _tags?: Record<string, Array<{ name?: string; prob?: number; label?: string }>>;
  _tags_simple?: string[];
  _objects?: Array<Record<string, any>>;
  Category?: string;
}

interface RawIdentifyRecord {
  records?: Array<Record<string, any>>;
}

interface RawTextSearchResponse {
  answer_records?: Array<Record<string, any>>;
}

interface MatchScore {
  score: number;
  matchedTokens: string[];
  totalTokens: number;
  matchedName?: string | null;
}

export interface ClassificationSnapshot {
  category: string | null;
  categoryType: "sport" | "tcg" | "comics" | "unknown";
  subcategory: string | null;
  graded: "yes" | "no" | null;
  bestMatchSource: string | null;
  bestMatchScore: number;
  bestMatchData?: Record<string, unknown> | null;
  candidates: Array<{ source: string; score: number; name?: string | null }>;
  analyzePayload?: unknown;
  identificationPayload?: unknown;
  textSearchPayload?: unknown;
  slabMatch?: Record<string, unknown> | null;
  summary?: {
    playerName: string | null;
    teamName: string | null;
    year: string | null;
    setName: string | null;
  };
}

export interface ClassificationResult {
  endpoint: string | null;
  bestMatch: Record<string, unknown> | null;
  summary: {
    playerName: string | null;
    teamName: string | null;
    year: string | null;
    setName: string | null;
  };
  labels: Array<{ label: string; score: number }>;
  tags: string[];
  snapshot: ClassificationSnapshot | null;
}

interface ClassificationCandidate {
  source: string;
  match: Record<string, unknown> | null;
  score: number;
  matchedName?: string | null;
  matchedTokens?: string[];
}

function buildUrl(base: string, path: string) {
  const trimmed = base.replace(/\/$/, "");
  return `${trimmed}/${path.replace(/^\/+/, "")}`;
}

function tokenizeText(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9'\-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, ""))
    .filter((token) => token.length >= 2);
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      output.push(token);
    }
  }
  return output;
}

function scoreNameAgainstText(name: string | null | undefined, ocrTokens: Set<string>): MatchScore {
  if (!name) {
    return { score: 0, matchedTokens: [], totalTokens: 0, matchedName: null };
  }
  const tokens = uniqueTokens(tokenizeText(name));
  if (tokens.length === 0) {
    return { score: 0, matchedTokens: [], totalTokens: 0, matchedName: name };
  }
  const matched: string[] = [];
  for (const token of tokens) {
    if (ocrTokens.has(token)) {
      matched.push(token);
    }
  }
  const score = matched.length / tokens.length;
  return {
    score,
    matchedTokens: matched,
    totalTokens: tokens.length,
    matchedName: name,
  };
}

function scoreAuxiliaryField(value: string | null | undefined, ocrTokens: Set<string>): number {
  if (!value) {
    return 0;
  }
  const tokens = uniqueTokens(tokenizeText(value));
  if (tokens.length === 0) {
    return 0;
  }
  let matched = 0;
  for (const token of tokens) {
    if (ocrTokens.has(token)) {
      matched += 1;
    }
  }
  if (matched === 0) {
    return 0;
  }
  return Math.min(0.25, matched / tokens.length / 4);
}

function bestScoreFromMatch(match: Record<string, unknown> | null, ocrTokens: Set<string>): ClassificationCandidate {
  if (!match) {
    return { source: "unknown", match: null, score: 0 };
  }

  const nameCandidates: string[] = [];
  const preferredKeys = ["full_name", "name", "title", "player", "card_name", "card" ];
  for (const key of preferredKeys) {
    const value = match[key];
    if (typeof value === "string" && value.trim().length > 0) {
      nameCandidates.push(value.trim());
    }
  }

  let bestScore: MatchScore = { score: 0, matchedTokens: [], totalTokens: 0, matchedName: null };
  for (const candidate of nameCandidates) {
    const result = scoreNameAgainstText(candidate, ocrTokens);
    if (result.score > bestScore.score) {
      bestScore = result;
    }
  }

  if (bestScore.score === 0 && nameCandidates.length === 0) {
    // Try deriving a name from set + card number.
    const fallback = [match["card_number"], match["set"], match["series"]]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ");
    if (fallback) {
      bestScore = scoreNameAgainstText(fallback, ocrTokens);
    }
  }

  const auxiliaryScore =
    scoreAuxiliaryField(match["team"] as string | undefined, ocrTokens) +
    scoreAuxiliaryField(match["club"] as string | undefined, ocrTokens) +
    scoreAuxiliaryField(match["set_name"] as string | undefined, ocrTokens);

  const totalScore = Math.min(1, bestScore.score + auxiliaryScore);

  return {
    source: "candidate",
    match,
    score: totalScore,
    matchedName: bestScore.matchedName,
    matchedTokens: bestScore.matchedTokens,
  };
}

function extractTag(tags: Record<string, Array<{ name?: string; label?: string }>> | undefined, key: string): string | null {
  if (!tags) {
    return null;
  }
  const entry = tags[key];
  if (!entry || entry.length === 0) {
    return null;
  }
  return (entry[0]?.name ?? entry[0]?.label ?? null) ?? null;
}

function detectCategory(record: RawAnalyzeRecord | null): {
  category: string | null;
  subcategory: string | null;
  graded: "yes" | "no" | null;
  categoryType: "sport" | "tcg" | "comics" | "unknown";
} {
  if (!record) {
    return { category: null, subcategory: null, graded: null, categoryType: "unknown" };
  }

  const tags = record._tags ?? {};
  const category = extractTag(tags, "Category") ?? record.Category ?? null;
  const subcategory = extractTag(tags, "Subcategory") ?? null;
  const graded = extractTag(tags, "Graded") as "yes" | "no" | null;

  let categoryType: "sport" | "tcg" | "comics" | "unknown" = "unknown";
  const normalizedCategory = (category ?? "").toLowerCase();
  const normalizedSubcategory = (subcategory ?? "").toLowerCase();

  if (normalizedCategory.includes("trading card game") || ["pokemon", "magic", "yugioh", "one piece", "tcg"].some((keyword) => normalizedSubcategory.includes(keyword))) {
    categoryType = "tcg";
  } else if (normalizedCategory.includes("sport")) {
    categoryType = "sport";
  } else if (normalizedCategory.includes("comic") || normalizedSubcategory.includes("comic")) {
    categoryType = "comics";
  }

  return {
    category,
    subcategory,
    graded,
    categoryType,
  };
}

async function ximilarFetch(path: string, payload: Record<string, unknown>) {
  if (!config.ximilarApiKey) {
    return null;
  }

  const url = buildUrl(COLLECTIBLES_BASE_URL, path);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${config.ximilarApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`[sportsdb] Ximilar call ${path} failed ${response.status}: ${errorText.slice(0, 160)}`);
    return null;
  }

  return response.json();
}

async function ximilarTextFetch(path: string, payload: Record<string, unknown>) {
  if (!config.ximilarApiKey) {
    return null;
  }

  const url = buildUrl(TEXT_BASE_URL, path);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${config.ximilarApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`[sportsdb] Ximilar text call ${path} failed ${response.status}: ${errorText.slice(0, 160)}`);
    return null;
  }

  return response.json();
}

function buildRecordExtras(record: RawAnalyzeRecord | null): Record<string, unknown> {
  if (!record) {
    return {};
  }
  const tags = record._tags ?? {};
  const extras: Record<string, unknown> = {};
  const potentialKeys = ["Top Category", "Category", "Subcategory", "Side", "Foil/Holo", "Alphabet", "Rotation", "Graded"];
  for (const key of potentialKeys) {
    const value = extractTag(tags, key);
    if (value) {
      extras[key] = value;
    }
  }
  return extras;
}

function pickEndpoint(categoryType: "sport" | "tcg" | "comics" | "unknown"): { path: string; defaultName: string } | null {
  switch (categoryType) {
    case "sport":
      return { path: "v2/sport_id", defaultName: "sport_id" };
    case "tcg":
      return { path: "v2/tcg_id", defaultName: "tcg_id" };
    case "comics":
      return { path: "v2/comics_id", defaultName: "comics_id" };
    default:
      return null;
  }
}

async function identifyCollectible(
  imageBase64: string,
  ocrText: string | null,
  analyzeRecord: RawAnalyzeRecord | null,
  categoryType: "sport" | "tcg" | "comics" | "unknown",
  graded: "yes" | "no" | null
) {
  const endpoint = pickEndpoint(categoryType);
  if (!endpoint) {
    return null;
  }

  const preparedImage = await prepareImageForXimilar(imageBase64);
  if (!preparedImage) {
    return null;
  }

  const record: Record<string, unknown> = {
    _base64: preparedImage,
    ...buildRecordExtras(analyzeRecord),
  };

  if (ocrText) {
    record._text = ocrText.slice(0, 8000);
  }

  const body: Record<string, unknown> = {
    records: [record],
  };

  if (graded === "yes") {
    body.slab_id = true;
    body.slab_grade = true;
  }

  const payload = await ximilarFetch(`v2/${endpoint.defaultName}`, body);
  if (!payload) {
    return null;
  }
  return payload as RawIdentifyRecord;
}

function extractBestMatch(records: RawIdentifyRecord | null): Record<string, unknown> | null {
  const match = records?.records?.[0]?._identification?.best_match;
  if (match && typeof match === "object") {
    return match as Record<string, unknown>;
  }
  const alternatives = records?.records?.[0]?._identification?.alternatives;
  if (Array.isArray(alternatives) && alternatives.length > 0 && typeof alternatives[0] === "object") {
    return alternatives[0] as Record<string, unknown>;
  }
  return null;
}

function gatherCandidates(
  identifyPayload: RawIdentifyRecord | null,
  analyzeRecord: RawAnalyzeRecord | null,
  textSearch: RawTextSearchResponse | null,
  ocrTokens: Set<string>
): ClassificationCandidate[] {
  const candidates: ClassificationCandidate[] = [];

  const bestMatch = identifyPayload?.records?.[0]?._identification?.best_match ?? null;
  if (bestMatch) {
    const scored = bestScoreFromMatch(bestMatch as Record<string, unknown>, ocrTokens);
    scored.source = "ximilar-image";
    candidates.push(scored);
  }

  const alternatives = identifyPayload?.records?.[0]?._identification?.alternatives ?? [];
  if (Array.isArray(alternatives)) {
    for (const entry of alternatives) {
      if (entry && typeof entry === "object") {
        const scored = bestScoreFromMatch(entry as Record<string, unknown>, ocrTokens);
        scored.source = "ximilar-alternative";
        candidates.push(scored);
      }
    }
  }

  const slabObject = analyzeRecord?._objects?.find((object) => object?.name === "Slab Label");
  const slabMatch = slabObject?._identification?.best_match ?? null;
  if (slabMatch && typeof slabMatch === "object") {
    const scored = bestScoreFromMatch(slabMatch as Record<string, unknown>, ocrTokens);
    scored.source = "slab-label";
    candidates.push(scored);
  }

  if (textSearch?.answer_records && Array.isArray(textSearch.answer_records)) {
    for (const record of textSearch.answer_records.slice(0, MAX_RECORDS)) {
      if (record && typeof record === "object") {
        const scored = bestScoreFromMatch(record as Record<string, unknown>, ocrTokens);
        scored.source = "text-search";
        candidates.push(scored);
      }
    }
  }

  return candidates;
}

async function textSearchCollectible(
  categoryType: "sport" | "tcg" | "comics" | "unknown",
  ocrText: string | null
): Promise<RawTextSearchResponse | null> {
  if (!ocrText) {
    return null;
  }

  const trimmed = ocrText.trim();
  if (!trimmed) {
    return null;
  }

  const payload: Record<string, any> = {
    query_record: {
      _text_data: trimmed.slice(0, 400),
    },
    size: Math.min(5, MAX_RECORDS),
  };

  let path: string | null = null;
  switch (categoryType) {
    case "tcg":
      path = "v2/tcg/list";
      break;
    case "comics":
      path = "v2/comics/pricing";
      break;
    case "sport":
      path = "v2/sport/pricing";
      break;
    default:
      path = null;
  }

  if (!path) {
    return null;
  }

  return ximilarTextFetch(path, payload) as Promise<RawTextSearchResponse | null>;
}

function summariseMatch(match: Record<string, unknown> | null): {
  playerName: string | null;
  teamName: string | null;
  year: string | null;
  setName: string | null;
} {
  if (!match) {
    return {
      playerName: null,
      teamName: null,
      year: null,
      setName: null,
    };
  }

  const extract = (key: string) => {
    const value = match[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return null;
  };

  const preferredName = extract("full_name") ?? extract("name") ?? extract("title") ?? null;
  const teamName = extract("team") ?? extract("club") ?? null;
  const yearValue = extract("year") ?? extract("date") ?? null;
  const setName = extract("set_name") ?? extract("set") ?? null;

  return {
    playerName: preferredName,
    teamName,
    year: yearValue,
    setName,
  };
}

function buildSnapshot(
  categoryInfo: { category: string | null; subcategory: string | null; graded: "yes" | "no" | null; categoryType: "sport" | "tcg" | "comics" | "unknown" },
  bestCandidate: ClassificationCandidate | null,
  candidates: ClassificationCandidate[],
  analyzePayload: unknown,
  identifyPayload: unknown,
  textSearchPayload: unknown,
  slabMatch: Record<string, unknown> | null
): ClassificationSnapshot {
  return {
    category: categoryInfo.category,
    categoryType: categoryInfo.categoryType,
    subcategory: categoryInfo.subcategory,
    graded: categoryInfo.graded,
    bestMatchSource: bestCandidate?.source ?? null,
    bestMatchScore: bestCandidate?.score ?? 0,
    bestMatchData: bestCandidate?.match ?? null,
    candidates: candidates
      .filter((candidate) => candidate.match)
      .map((candidate) => ({
        source: candidate.source,
        score: candidate.score,
        name: candidate.matchedName ?? null,
      })),
    analyzePayload,
    identificationPayload: identifyPayload,
    textSearchPayload,
    slabMatch,
    summary: summariseMatch(bestCandidate?.match ?? null),
  };
}

export async function classifyAsset(options: {
  imageBase64: string;
  ocrText: string | null;
}): Promise<ClassificationResult> {
  if (!config.ximilarApiKey) {
    return {
      endpoint: null,
      bestMatch: null,
      summary: {
        playerName: null,
        teamName: null,
        year: null,
        setName: null,
      },
      labels: [{ label: "classification_stub", score: 1 }],
      tags: [],
      snapshot: null,
    };
  }

  const preparedImage = await prepareImageForXimilar(options.imageBase64);

  const analyzePayload = preparedImage
    ? await ximilarFetch("v2/analyze", {
        records: [
          {
            _base64: preparedImage,
          },
        ],
      })
    : null;

  const analyzeRecord: RawAnalyzeRecord | null = Array.isArray(analyzePayload?.records)
    ? (analyzePayload.records[0] as RawAnalyzeRecord)
    : null;

  const categoryInfo = detectCategory(analyzeRecord);

  const identifyPayload = preparedImage
    ? await identifyCollectible(
        preparedImage,
        options.ocrText,
        analyzeRecord,
        categoryInfo.categoryType,
        categoryInfo.graded
      )
    : null;

  const slabObject = analyzeRecord?._objects?.find((object) => object?.name === "Slab Label") ?? null;
  const slabMatch = slabObject?._identification?.best_match && typeof slabObject._identification.best_match === "object"
    ? (slabObject._identification.best_match as Record<string, unknown>)
    : null;

  const ocrTokens = new Set(tokenizeText(options.ocrText));

  const textSearchPayload = await textSearchCollectible(categoryInfo.categoryType, options.ocrText);

  const candidates = gatherCandidates(
    identifyPayload as RawIdentifyRecord | null,
    analyzeRecord,
    textSearchPayload as RawTextSearchResponse | null,
    ocrTokens
  );

  candidates.sort((a, b) => b.score - a.score);

  let bestCandidate: ClassificationCandidate | null = candidates.length > 0 ? candidates[0] : null;

  if (bestCandidate && bestCandidate.match && bestCandidate.score < MIN_SCORE_THRESHOLD) {
    const better = candidates.find((candidate) => candidate.score >= MIN_SCORE_THRESHOLD && candidate.match);
    if (better) {
      bestCandidate = better;
    }
  }

  if (!bestCandidate || !bestCandidate.match) {
    const fallback = candidates.find((candidate) => candidate.score >= SECONDARY_SCORE_THRESHOLD && candidate.match);
    if (fallback) {
      bestCandidate = fallback;
    }
  }

  if (!bestCandidate || !bestCandidate.match) {
    bestCandidate = candidates.length > 0 ? candidates[0] : null;
  }

  const snapshot = buildSnapshot(
    categoryInfo,
    bestCandidate,
    candidates,
    analyzePayload,
    identifyPayload,
    textSearchPayload,
    slabMatch
  );

  const bestMatchRecord = bestCandidate?.match ?? null;
  const summary = summariseMatch(bestMatchRecord);

  const tags = Array.isArray(analyzeRecord?._tags_simple) ? analyzeRecord!._tags_simple : [];
  const labels = bestMatchRecord
    ? uniqueTokens(tokenizeText(bestCandidate?.matchedName ?? summary.playerName ?? "")).map((label) => ({
        label,
        score: bestCandidate?.score ?? 0,
      }))
    : [];

  return {
    endpoint: snapshot.categoryType === "unknown" ? null : snapshot.categoryType,
    bestMatch: bestMatchRecord,
    summary,
    labels,
    tags,
    snapshot,
  };
}
