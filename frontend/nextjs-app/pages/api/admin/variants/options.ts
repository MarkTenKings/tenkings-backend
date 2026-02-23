import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
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

const sanitize = (value: unknown): string => String(value ?? "").trim();

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

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

function buildWhere(params: {
  approvedSetIds: string[];
  year?: string;
  manufacturer?: string;
  sport?: string;
}) {
  const andClauses: Prisma.CardVariantWhereInput[] = [
    {
      setId: {
        in: params.approvedSetIds,
      },
    },
  ];
  const year = sanitize(params.year);
  const manufacturer = sanitize(params.manufacturer);
  const sport = sanitize(params.sport);
  if (year) {
    andClauses.push({
      setId: {
        contains: year,
        mode: Prisma.QueryMode.insensitive,
      },
    });
  }
  if (manufacturer) {
    andClauses.push({
      setId: {
        contains: manufacturer,
        mode: Prisma.QueryMode.insensitive,
      },
    });
  }
  if (sport) {
    andClauses.push({
      setId: {
        contains: sport,
        mode: Prisma.QueryMode.insensitive,
      },
    });
  }
  if (andClauses.length === 1) {
    return andClauses[0];
  }
  return {
    AND: andClauses,
  };
}

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
    const take = Math.min(6000, Math.max(500, Number(req.query.limit ?? 4000) || 4000));

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
    const approvedSetIds = Array.from(
      new Set(
        approvedRows
          .map((row) => sanitize(row.setId))
          .filter(Boolean)
      )
    );

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

    const select = {
      setId: true,
      cardNumber: true,
      parallelId: true,
      parallelFamily: true,
    } as const;

    let variants = await prisma.cardVariant.findMany({
      where: buildWhere({ approvedSetIds, year, manufacturer, sport: sport ?? undefined }),
      select,
      orderBy: [{ setId: "asc" }, { cardNumber: "asc" }, { parallelId: "asc" }],
      take,
    });

    if (variants.length < 1 && sport) {
      variants = await prisma.cardVariant.findMany({
        where: buildWhere({ approvedSetIds, year, manufacturer }),
        select,
        orderBy: [{ setId: "asc" }, { cardNumber: "asc" }, { parallelId: "asc" }],
        take,
      });
    }

    const dedupedMap = new Map<string, VariantCatalogRow>();
    variants.forEach((row) => {
      const setId = sanitize(row.setId);
      const cardNumber = sanitize(row.cardNumber);
      const parallelId = sanitize(row.parallelId);
      if (!setId || !parallelId) {
        return;
      }
      const key = `${setId.toLowerCase()}::${cardNumber.toLowerCase()}::${parallelId.toLowerCase()}`;
      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, {
          setId,
          cardNumber,
          parallelId,
          parallelFamily: sanitize(row.parallelFamily) || null,
        });
      }
    });
    const dedupedVariants = Array.from(dedupedMap.values());

    const setCounts = new Map<string, number>();
    dedupedVariants.forEach((row) => {
      setCounts.set(row.setId, (setCounts.get(row.setId) ?? 0) + 1);
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
    dedupedVariants.forEach((row) => {
      const label = sanitize(row.parallelId);
      if (!label) {
        return;
      }
      const kind: "insert" | "parallel" = isInsertLikeRow(row) ? "insert" : "parallel";
      const key = `${kind}::${label.toLowerCase()}`;
      const existing = optionMap.get(key);
      if (existing) {
        existing.count += 1;
        existing.setIds.add(row.setId);
      } else {
        optionMap.set(key, {
          label,
          kind,
          count: 1,
          setIds: new Set([row.setId]),
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
        variantCount: dedupedVariants.length,
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
