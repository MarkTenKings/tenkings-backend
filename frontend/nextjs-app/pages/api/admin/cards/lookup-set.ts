import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, SetIngestionJobStatus, type Prisma } from "@tenkings/database";
import { normalizeCardNumber } from "@tenkings/shared";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";

type LookupSetParallelOption = {
  parallelId: string;
  label: string;
  serialDenominator: number | null;
  serialText: string | null;
  finishFamily: string | null;
};

type LookupSetCandidate = {
  setId: string;
  insertLabel: string;
  programId: string;
  parallels: LookupSetParallelOption[];
};

type LookupSetResponse =
  | {
      match: "exact" | "multiple" | "none";
      setId: string | null;
      insertLabel: string | null;
      programId: string | null;
      parallels: LookupSetParallelOption[];
      candidates: LookupSetCandidate[];
    }
  | { message: string };

const lookupSetSchema = z.object({
  year: z.string().trim().min(1),
  manufacturer: z.string().trim().min(1),
  sport: z.string().trim().min(1),
  playerName: z.string().trim().min(1),
  cardNumber: z.string().trim().min(1),
});

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildYearPrefix(year: string, sport: string): string | null {
  const yearNum = Number.parseInt(year, 10);
  if (!Number.isFinite(yearNum)) {
    return null;
  }
  const sportKey = collapseWhitespace(sport).toLowerCase();
  const isSeasonSport = sportKey === "basketball" || sportKey === "football";
  return isSeasonSport ? `${yearNum}-${String(yearNum + 1).slice(-2)}` : `${yearNum}`;
}

function publishedSetCardWhereInput(): Prisma.SetCardWhereInput {
  return {
    OR: [
      { sourceId: null },
      {
        source: {
          is: {
            OR: [
              { ingestionJobId: null },
              { ingestionJob: { status: SetIngestionJobStatus.APPROVED } },
            ],
          },
        },
      },
    ],
  };
}

function publishedSetParallelScopeWhereInput(): Prisma.SetParallelScopeWhereInput {
  return {
    OR: [
      { sourceId: null },
      {
        source: {
          is: {
            OR: [
              { ingestionJobId: null },
              { ingestionJob: { status: SetIngestionJobStatus.APPROVED } },
            ],
          },
        },
      },
    ],
  };
}

async function loadScopedParallels(setId: string, programId: string): Promise<LookupSetParallelOption[]> {
  const rows = await prisma.setParallelScope.findMany({
    where: {
      setId,
      programId,
      ...publishedSetParallelScopeWhereInput(),
    },
    select: {
      parallelId: true,
      parallel: {
        select: {
          parallelId: true,
          label: true,
          serialDenominator: true,
          serialText: true,
          finishFamily: true,
        },
      },
    },
    orderBy: [{ parallelId: "asc" }],
    take: 1000,
  });

  const deduped = new Map<string, LookupSetParallelOption>();
  for (const row of rows) {
    const label = collapseWhitespace(row.parallel?.label ?? "");
    const parallelId = collapseWhitespace(row.parallel?.parallelId ?? row.parallelId ?? "");
    if (!label || !parallelId || deduped.has(parallelId)) {
      continue;
    }
    deduped.set(parallelId, {
      parallelId,
      label,
      serialDenominator: typeof row.parallel?.serialDenominator === "number" ? row.parallel.serialDenominator : null,
      serialText: collapseWhitespace(row.parallel?.serialText ?? "") || null,
      finishFamily: collapseWhitespace(row.parallel?.finishFamily ?? "") || null,
    });
  }

  return Array.from(deduped.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

async function handler(req: NextApiRequest, res: NextApiResponse<LookupSetResponse>) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const payload = lookupSetSchema.parse(req.body ?? {});

    const normalizedCardNumber = normalizeCardNumber(payload.cardNumber);
    if (!normalizedCardNumber) {
      return res.status(400).json({ message: "Card number is required." });
    }

    const yearPrefix = buildYearPrefix(payload.year, payload.sport);
    if (!yearPrefix) {
      return res.status(400).json({ message: "Year must be a valid four-digit year." });
    }

    const normalizedManufacturer = collapseWhitespace(payload.manufacturer);
    const normalizedSport = collapseWhitespace(payload.sport);
    const normalizedPlayerName = collapseWhitespace(payload.playerName);

    const rows = await prisma.setCard.findMany({
      where: {
        setId: {
          contains: yearPrefix,
          mode: "insensitive",
        },
        AND: [
          {
            setId: {
              contains: normalizedManufacturer,
              mode: "insensitive",
            },
          },
          {
            setId: {
              contains: normalizedSport,
              mode: "insensitive",
            },
          },
        ],
        playerName: {
          contains: normalizedPlayerName,
          mode: "insensitive",
        },
        ...publishedSetCardWhereInput(),
      },
      include: {
        program: {
          select: {
            label: true,
          },
        },
      },
      orderBy: [{ setId: "asc" }, { programId: "asc" }],
      take: 250,
    });

    const matchedRows = rows
      .filter((row) => normalizeCardNumber(row.cardNumber) === normalizedCardNumber)
      .slice(0, 10);

    if (matchedRows.length < 1) {
      return res.status(200).json({
        match: "none",
        setId: null,
        insertLabel: null,
        programId: null,
        parallels: [],
        candidates: [],
      });
    }

    const candidates = await Promise.all(
      matchedRows.map(async (row) => ({
        setId: row.setId,
        insertLabel: collapseWhitespace(row.program.label),
        programId: row.programId,
        parallels: await loadScopedParallels(row.setId, row.programId),
      }))
    );

    const primary = candidates[0] ?? null;
    return res.status(200).json({
      match: candidates.length === 1 ? "exact" : "multiple",
      setId: primary?.setId ?? null,
      insertLabel: primary?.insertLabel ?? null,
      programId: primary?.programId ?? null,
      parallels: primary?.parallels ?? [],
      candidates: candidates.length > 1 ? candidates : [],
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
