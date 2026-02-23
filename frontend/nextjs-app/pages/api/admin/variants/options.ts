import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type VariantCatalogRow = {
  setId: string;
  cardNumber: string;
  parallelId: string;
  parallelFamily: string | null;
};

type SetOptionRow = {
  setId: string;
  count: number;
  score: number;
};

type VariantOptionRow = {
  label: string;
  kind: "insert" | "parallel";
  count: number;
  setIds: string[];
  primarySetId: string | null;
};

type ResponseBody =
  | {
      variants: VariantCatalogRow[];
      sets: SetOptionRow[];
      insertOptions: VariantOptionRow[];
      parallelOptions: VariantOptionRow[];
      scope: {
        year: string;
        manufacturer: string;
        sport: string | null;
        productLine: string | null;
        approvedSetCount: number;
        variantCount: number;
      };
    }
  | { message: string };

type SetScopeRule = {
  requireYear: boolean;
  requireManufacturer: boolean;
  requireSport: boolean;
};

const sanitize = (value: unknown): string => String(value ?? "").trim();

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

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

function buildYearHints(value: string): string[] {
  const normalized = sanitize(value).toLowerCase();
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
  tokenize(sanitize(value)).forEach((token) => {
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

  return approvedSetIds;
}

const scoreSet = (setId: string, hints: string[]) => {
  if (!setId.trim() || hints.length === 0) {
    return 0;
  }
  const setTokens = new Set(tokenize(setId));
  if (setTokens.size === 0) {
    return 0;
  }
  const lowerSet = setId.toLowerCase();
  let score = 0;
  hints.forEach((hint) => {
    const cleaned = sanitize(hint);
    if (!cleaned) {
      return;
    }
    const lowerHint = cleaned.toLowerCase();
    if (lowerSet === lowerHint) {
      score += 1.5;
    } else if (lowerSet.includes(lowerHint) || lowerHint.includes(lowerSet)) {
      score += 0.9;
    }
    tokenize(cleaned).forEach((token) => {
      if (setTokens.has(token)) {
        score += 0.25;
      }
    });
  });
  return score;
};

const isInsertLikeRow = (row: VariantCatalogRow): boolean => {
  const marker = `${sanitize(row.parallelFamily)} ${sanitize(row.parallelId)}`.toLowerCase();
  if (!marker) {
    return false;
  }
  return (
    marker.includes("insert") ||
    marker.includes("autograph") ||
    marker.includes("auto") ||
    marker.includes("relic") ||
    marker.includes("patch") ||
    marker.includes("memorabilia")
  );
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const year = sanitize(req.query.year);
    const manufacturer = sanitize(req.query.manufacturer);
    const sport = sanitize(req.query.sport) || null;
    const productLine = sanitize(req.query.productLine) || null;

    if (!year || !manufacturer) {
      return res.status(200).json({
        variants: [],
        sets: [],
        insertOptions: [],
        parallelOptions: [],
        scope: {
          year,
          manufacturer,
          sport,
          productLine,
          approvedSetCount: 0,
          variantCount: 0,
        },
      });
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

    const approvedSetIds = Array.from(new Set(approvedRows.map((row) => sanitize(row.setId)).filter(Boolean)));

    if (approvedSetIds.length < 1) {
      return res.status(200).json({
        variants: [],
        sets: [],
        insertOptions: [],
        parallelOptions: [],
        scope: {
          year,
          manufacturer,
          sport,
          productLine,
          approvedSetCount: 0,
          variantCount: 0,
        },
      });
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

    const groupedRows = await prisma.cardVariant.groupBy({
      by: ["setId", "parallelId", "parallelFamily"],
      where: {
        setId: {
          in: scopedSetIds,
        },
      },
      _count: {
        _all: true,
      },
      orderBy: [{ setId: "asc" }, { parallelId: "asc" }],
    });

    const dedupedVariants: VariantCatalogRow[] = groupedRows
      .map((row) => ({
        setId: sanitize(row.setId),
        cardNumber: "ALL",
        parallelId: sanitize(row.parallelId),
        parallelFamily: sanitize(row.parallelFamily) || null,
      }))
      .filter((row) => Boolean(row.setId && row.parallelId));

    const variantCount = groupedRows.reduce((sum, row) => sum + (row._count?._all ?? 0), 0);

    const setCounts = new Map<string, number>();
    groupedRows.forEach((row) => {
      const setId = sanitize(row.setId);
      if (!setId) {
        return;
      }
      setCounts.set(setId, (setCounts.get(setId) ?? 0) + (row._count?._all ?? 0));
    });

    const setHints = [
      productLine,
      [year, manufacturer, sport].filter(Boolean).join(" "),
      [year, manufacturer].filter(Boolean).join(" "),
    ].filter((entry): entry is string => Boolean(entry && entry.trim()));

    const sets: SetOptionRow[] = Array.from(setCounts.entries())
      .map(([setId, count]) => ({
        setId,
        count,
        score: Number(scoreSet(setId, setHints).toFixed(3)),
      }))
      .sort((a, b) => b.score - a.score || b.count - a.count || a.setId.localeCompare(b.setId));

    const setScoreMap = new Map<string, number>(sets.map((entry) => [entry.setId, entry.score]));

    type OptionAccumulator = {
      label: string;
      kind: "insert" | "parallel";
      count: number;
      setIds: Set<string>;
    };

    const optionMap = new Map<string, OptionAccumulator>();
    groupedRows.forEach((row) => {
      const setId = sanitize(row.setId);
      const label = sanitize(row.parallelId);
      if (!setId || !label) {
        return;
      }
      const variantLike: VariantCatalogRow = {
        setId,
        cardNumber: "ALL",
        parallelId: label,
        parallelFamily: sanitize(row.parallelFamily) || null,
      };
      const kind: "insert" | "parallel" = isInsertLikeRow(variantLike) ? "insert" : "parallel";
      const key = `${kind}::${label.toLowerCase()}`;
      const existing = optionMap.get(key);
      if (existing) {
        existing.count += row._count?._all ?? 0;
        existing.setIds.add(setId);
      } else {
        optionMap.set(key, {
          label,
          kind,
          count: row._count?._all ?? 0,
          setIds: new Set([setId]),
        });
      }
    });

    const optionRows: VariantOptionRow[] = Array.from(optionMap.values())
      .map((entry) => {
        const setIds = Array.from(entry.setIds).sort((a, b) => {
          const scoreDiff = (setScoreMap.get(b) ?? 0) - (setScoreMap.get(a) ?? 0);
          if (scoreDiff !== 0) {
            return scoreDiff;
          }
          return a.localeCompare(b);
        });
        return {
          label: entry.label,
          kind: entry.kind,
          count: entry.count,
          setIds,
          primarySetId: setIds[0] ?? null,
        };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const insertOptions = optionRows.filter((entry) => entry.kind === "insert");
    const parallelOptions = optionRows.filter((entry) => entry.kind === "parallel");

    return res.status(200).json({
      variants: dedupedVariants,
      sets,
      insertOptions,
      parallelOptions,
      scope: {
        year,
        manufacturer,
        sport,
        productLine,
        approvedSetCount: approvedSetIds.length,
        variantCount,
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
