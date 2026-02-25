import { prisma } from "@tenkings/database";

export type VariantCatalogRow = {
  setId: string;
  cardNumber: string;
  parallelId: string;
  parallelFamily: string | null;
};

export type SetOptionRow = {
  setId: string;
  count: number;
  score: number;
};

export type VariantOptionKind = "insert" | "parallel";

export type VariantOptionRow = {
  label: string;
  kind: VariantOptionKind;
  count: number;
  setIds: string[];
  primarySetId: string | null;
};

export type VariantOptionPool = {
  variants: VariantCatalogRow[];
  sets: SetOptionRow[];
  insertOptions: VariantOptionRow[];
  parallelOptions: VariantOptionRow[];
  scopedSetIds: string[];
  approvedSetCount: number;
  variantCount: number;
  selectedSetId: string | null;
};

type SetScopeRule = {
  requireYear: boolean;
  requireManufacturer: boolean;
  requireSport: boolean;
};

const MANUFACTURER_STOP_WORDS = new Set(["trading", "card", "cards", "company", "co", "inc", "the"]);

const SPORT_ALIASES: Record<string, string[]> = {
  basketball: ["basketball", "nba"],
  nba: ["basketball", "nba"],
  football: ["football", "nfl"],
  nfl: ["football", "nfl"],
  baseball: ["baseball", "mlb"],
  mlb: ["baseball", "mlb"],
  hockey: ["hockey", "nhl"],
  nhl: ["hockey", "nhl"],
  soccer: ["soccer", "futbol", "fifa"],
  futbol: ["soccer", "futbol", "fifa"],
  fifa: ["soccer", "futbol", "fifa"],
};

const VARIANT_LABEL_STOP_WORDS = new Set(["the"]);

const INSERT_MARKERS = ["insert", "autograph", "auto", "relic", "patch", "memorabilia", "mem"];
const PARALLEL_MARKERS = [
  "parallel",
  "refractor",
  "x-fractor",
  "fractor",
  "holo",
  "foil",
  "prizm",
  "mojo",
  "cracked",
  "wave",
  "shimmer",
  "sparkle",
  "atomic",
  "superfractor",
  "gold",
  "silver",
  "red",
  "blue",
  "green",
  "purple",
  "orange",
  "black",
  "white",
  "pink",
  "aqua",
  "teal",
  "sepia",
  "base",
];

export const sanitizeText = (value: unknown): string => String(value ?? "").trim();

export const tokenize = (value: string): string[] =>
  String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

export const normalizeVariantLabelKey = (value: string): string => {
  const normalized = tokenize(value)
    .filter((token) => !VARIANT_LABEL_STOP_WORDS.has(token))
    .join(" ")
    .trim();
  if (normalized) {
    return normalized;
  }
  return sanitizeText(value).toLowerCase();
};

const scoreOption = (option: string, hints: string[]): number => {
  const cleanedOption = sanitizeText(option);
  if (!cleanedOption || hints.length === 0) {
    return 0;
  }
  const optionTokens = new Set(tokenize(cleanedOption));
  if (optionTokens.size === 0) {
    return 0;
  }
  const optionLower = cleanedOption.toLowerCase();
  const optionKey = normalizeVariantLabelKey(cleanedOption);
  let score = 0;
  hints.forEach((hint) => {
    const cleanedHint = sanitizeText(hint);
    if (!cleanedHint) {
      return;
    }
    const hintLower = cleanedHint.toLowerCase();
    const hintKey = normalizeVariantLabelKey(cleanedHint);
    if (hintLower === optionLower) {
      score += 1.5;
    } else if (optionKey && hintKey && optionKey === hintKey) {
      score += 1.2;
    } else if (optionLower.includes(hintLower) || hintLower.includes(optionLower)) {
      score += 0.9;
    }
    tokenize(cleanedHint).forEach((token) => {
      if (optionTokens.has(token)) {
        score += 0.25;
      }
    });
  });
  return score;
};

export const pickBestCandidate = (options: string[], hints: string[], minScore = 0.8): string | null => {
  const candidateOptions = Array.from(new Set(options.map((entry) => sanitizeText(entry)).filter(Boolean)));
  const candidateHints = hints.map((entry) => sanitizeText(entry)).filter(Boolean);
  if (candidateOptions.length < 1 || candidateHints.length < 1) {
    return null;
  }
  let best: string | null = null;
  let bestScore = 0;
  candidateOptions.forEach((option) => {
    const score = scoreOption(option, candidateHints);
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  });
  return bestScore >= minScore ? best : null;
};

export const resolveCanonicalOption = (options: string[], value: string, minScore = 0.8): string | null => {
  const cleaned = sanitizeText(value);
  if (!cleaned) {
    return null;
  }
  const optionList = Array.from(new Set(options.map((entry) => sanitizeText(entry)).filter(Boolean)));
  if (optionList.length < 1) {
    return null;
  }
  const key = normalizeVariantLabelKey(cleaned);
  const direct = optionList.find((entry) => normalizeVariantLabelKey(entry) === key);
  if (direct) {
    return direct;
  }
  return pickBestCandidate(optionList, [cleaned], minScore);
};

function buildYearHints(value: string): string[] {
  const normalized = sanitizeText(value).toLowerCase();
  if (!normalized) {
    return [];
  }
  const hints = new Set<string>();
  const compact = normalized.replace(/\s+/g, "");
  const season = compact.match(/(19|20)\d{2}(?:[-/](\d{2,4}))?/);
  if (season?.[0]) {
    const full = season[0];
    hints.add(full);
    hints.add(full.replace("/", "-"));
    hints.add(full.slice(0, 4));
  }
  tokenize(normalized).forEach((token) => {
    if (/^(19|20)\d{2}$/.test(token) || /^(19|20)\d{2}[-/]\d{2,4}$/.test(token)) {
      hints.add(token);
      hints.add(token.replace("/", "-"));
      hints.add(token.slice(0, 4));
    }
  });
  return Array.from(hints).filter(Boolean);
}

function buildManufacturerHints(value: string): string[] {
  return tokenize(value).filter((token) => token.length >= 3 && !MANUFACTURER_STOP_WORDS.has(token));
}

function buildSportHints(value: string | null): string[] {
  const hints = new Set<string>();
  tokenize(sanitizeText(value)).forEach((token) => {
    hints.add(token);
    (SPORT_ALIASES[token] ?? []).forEach((alias) => hints.add(alias));
  });
  return Array.from(hints).filter(Boolean);
}

function setMatchesYear(setId: string, yearHints: string[], required: boolean): boolean {
  if (!required) {
    return true;
  }
  if (yearHints.length < 1) {
    return false;
  }
  const lowerSet = setId.toLowerCase();
  return yearHints.some((hint) => {
    const normalizedHint = hint.toLowerCase();
    if (!normalizedHint) {
      return false;
    }
    if (lowerSet.includes(normalizedHint)) {
      return true;
    }
    if (/^(19|20)\d{2}$/.test(normalizedHint)) {
      return new RegExp(`${normalizedHint}\\s*[-/]\\s*\\d{2,4}`).test(lowerSet);
    }
    return false;
  });
}

function setMatchesAnyToken(setId: string, hints: string[], required: boolean): boolean {
  if (!required) {
    return true;
  }
  if (hints.length < 1) {
    return false;
  }
  const setTokens = new Set(tokenize(setId));
  return hints.some((hint) => setTokens.has(hint));
}

function filterScopedSetIds(params: {
  approvedSetIds: string[];
  yearHints: string[];
  manufacturerHints: string[];
  sportHints: string[];
}): string[] {
  const { approvedSetIds, yearHints, manufacturerHints, sportHints } = params;
  const rules: SetScopeRule[] = [
    { requireYear: true, requireManufacturer: true, requireSport: sportHints.length > 0 },
    { requireYear: true, requireManufacturer: true, requireSport: false },
    { requireYear: true, requireManufacturer: false, requireSport: sportHints.length > 0 },
    { requireYear: true, requireManufacturer: false, requireSport: false },
    { requireYear: false, requireManufacturer: true, requireSport: sportHints.length > 0 },
    { requireYear: false, requireManufacturer: true, requireSport: false },
  ];

  for (const rule of rules) {
    const matched = approvedSetIds.filter((setId) => {
      if (!setMatchesYear(setId, yearHints, rule.requireYear)) {
        return false;
      }
      if (!setMatchesAnyToken(setId, manufacturerHints, rule.requireManufacturer)) {
        return false;
      }
      if (!setMatchesAnyToken(setId, sportHints, rule.requireSport)) {
        return false;
      }
      return true;
    });
    if (matched.length > 0) {
      return matched;
    }
  }

  return [];
}

const scoreSet = (setId: string, hints: string[]) => scoreOption(setId, hints);

function classifyOptionKinds(params: { parallelId: string; parallelFamily: string | null }): Set<VariantOptionKind> {
  const marker = `${sanitizeText(params.parallelFamily)} ${sanitizeText(params.parallelId)}`.toLowerCase();
  const kinds = new Set<VariantOptionKind>();
  if (!marker) {
    kinds.add("insert");
    kinds.add("parallel");
    return kinds;
  }
  const insertLike = INSERT_MARKERS.some((entry) => marker.includes(entry));
  const parallelLike = PARALLEL_MARKERS.some((entry) => marker.includes(entry));
  if (insertLike) {
    kinds.add("insert");
  }
  if (parallelLike) {
    kinds.add("parallel");
  }
  if (kinds.size < 1) {
    // Unknown labels (e.g. No Limit, Daily Dribble) should still be visible for operators.
    kinds.add("insert");
    kinds.add("parallel");
  }
  return kinds;
}

export async function loadVariantOptionPool(params: {
  year: string;
  manufacturer: string;
  sport?: string | null;
  productLine?: string | null;
  setId?: string | null;
}): Promise<VariantOptionPool> {
  const year = sanitizeText(params.year);
  const manufacturer = sanitizeText(params.manufacturer);
  const sport = sanitizeText(params.sport) || null;
  const productLine = sanitizeText(params.productLine) || null;
  const explicitSetId = sanitizeText(params.setId) || null;

  if (!year || !manufacturer) {
    return {
      variants: [],
      sets: [],
      insertOptions: [],
      parallelOptions: [],
      scopedSetIds: [],
      approvedSetCount: 0,
      variantCount: 0,
      selectedSetId: null,
    };
  }

  const approvedRows = await prisma.setDraft.findMany({
    where: {
      status: "APPROVED",
      archivedAt: null,
    },
    select: {
      setId: true,
    },
  });

  const approvedSetIds = Array.from(new Set(approvedRows.map((row) => sanitizeText(row.setId)).filter(Boolean)));
  if (approvedSetIds.length < 1) {
    return {
      variants: [],
      sets: [],
      insertOptions: [],
      parallelOptions: [],
      scopedSetIds: [],
      approvedSetCount: 0,
      variantCount: 0,
      selectedSetId: null,
    };
  }

  const yearHints = buildYearHints(year);
  const manufacturerHints = buildManufacturerHints(manufacturer);
  const sportHints = buildSportHints(sport);
  const scopedSetIds = filterScopedSetIds({
    approvedSetIds,
    yearHints,
    manufacturerHints,
    sportHints,
  });

  if (scopedSetIds.length < 1) {
    return {
      variants: [],
      sets: [],
      insertOptions: [],
      parallelOptions: [],
      scopedSetIds: [],
      approvedSetCount: approvedSetIds.length,
      variantCount: 0,
      selectedSetId: null,
    };
  }

  const setHints = [
    explicitSetId,
    productLine,
    [year, manufacturer, sport].filter(Boolean).join(" "),
    [year, manufacturer].filter(Boolean).join(" "),
  ].filter((entry): entry is string => Boolean(entry && entry.trim()));

  let selectedSetId: string | null = null;
  const explicitSetCandidate = explicitSetId || productLine;
  if (explicitSetCandidate) {
    selectedSetId = resolveCanonicalOption(scopedSetIds, explicitSetCandidate, 1.1);
  }

  const querySetIds = selectedSetId ? [selectedSetId] : scopedSetIds;
  const groupedRows = await prisma.cardVariant.groupBy({
    by: ["setId", "parallelId", "parallelFamily"],
    where: {
      setId: {
        in: querySetIds,
      },
    },
    _count: {
      _all: true,
    },
    orderBy: [{ setId: "asc" }, { parallelId: "asc" }],
  });

  const variantCount = groupedRows.reduce((sum, row) => sum + (row._count?._all ?? 0), 0);
  const variants: VariantCatalogRow[] = groupedRows
    .map((row) => ({
      setId: sanitizeText(row.setId),
      cardNumber: "ALL",
      parallelId: sanitizeText(row.parallelId),
      parallelFamily: sanitizeText(row.parallelFamily) || null,
    }))
    .filter((row) => Boolean(row.setId && row.parallelId));

  const setCounts = new Map<string, number>();
  groupedRows.forEach((row) => {
    const setId = sanitizeText(row.setId);
    if (!setId) {
      return;
    }
    setCounts.set(setId, (setCounts.get(setId) ?? 0) + (row._count?._all ?? 0));
  });

  const sets: SetOptionRow[] = Array.from(setCounts.entries())
    .map(([setId, count]) => ({
      setId,
      count,
      score: Number(scoreSet(setId, setHints).toFixed(3)),
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.setId.localeCompare(b.setId));

  type OptionAccumulator = {
    label: string;
    kinds: Set<VariantOptionKind>;
    count: number;
    setIds: Set<string>;
  };

  const optionMap = new Map<string, OptionAccumulator>();
  groupedRows.forEach((row) => {
    const setId = sanitizeText(row.setId);
    const parallelId = sanitizeText(row.parallelId);
    const parallelFamily = sanitizeText(row.parallelFamily) || null;
    if (!setId || !parallelId) {
      return;
    }
    const kindsForRow = classifyOptionKinds({ parallelId, parallelFamily });
    const labelCandidates = [parallelId, parallelFamily].map((entry) => sanitizeText(entry)).filter(Boolean);
    const seenKeys = new Set<string>();

    labelCandidates.forEach((label) => {
      const key = normalizeVariantLabelKey(label);
      if (!key || seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      const existing = optionMap.get(key);
      if (existing) {
        existing.count += row._count?._all ?? 0;
        existing.setIds.add(setId);
        kindsForRow.forEach((kind) => existing.kinds.add(kind));
        return;
      }
      optionMap.set(key, {
        label,
        kinds: new Set(kindsForRow),
        count: row._count?._all ?? 0,
        setIds: new Set([setId]),
      });
    });
  });

  const optionRows: VariantOptionRow[] = [];
  Array.from(optionMap.values()).forEach((entry) => {
    const setIds = Array.from(entry.setIds).sort((a, b) => {
      const scoreDiff = (sets.find((set) => set.setId === b)?.score ?? 0) - (sets.find((set) => set.setId === a)?.score ?? 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return a.localeCompare(b);
    });
    entry.kinds.forEach((kind) => {
      optionRows.push({
        label: entry.label,
        kind,
        count: entry.count,
        setIds,
        primarySetId: setIds[0] ?? null,
      });
    });
  });

  const insertOptions = optionRows
    .filter((entry) => entry.kind === "insert")
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const parallelOptions = optionRows
    .filter((entry) => entry.kind === "parallel")
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    variants,
    sets,
    insertOptions,
    parallelOptions,
    scopedSetIds,
    approvedSetCount: approvedSetIds.length,
    variantCount,
    selectedSetId,
  };
}
