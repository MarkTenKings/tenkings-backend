import { prisma, SetIngestionJobStatus, type Prisma } from "@tenkings/database";
import { normalizeCardNumber } from "@tenkings/shared";

export type LookupSetParallelOption = {
  parallelId: string;
  label: string;
  serialDenominator: number | null;
  serialText: string | null;
  finishFamily: string | null;
};

export type LookupSetCandidate = {
  setId: string;
  insertLabel: string;
  programId: string;
  parallels: LookupSetParallelOption[];
};

export type LookupSetResult = {
  match: "exact" | "multiple" | "none";
  setId: string | null;
  insertLabel: string | null;
  programId: string | null;
  parallels: LookupSetParallelOption[];
  candidates: LookupSetCandidate[];
};

export type LookupSetByCardIdentityInput = {
  year: string;
  manufacturer: string;
  sport: string;
  playerName: string;
  cardNumber: string;
};

function emptyLookupSetResult(): LookupSetResult {
  return {
    match: "none",
    setId: null,
    insertLabel: null,
    programId: null,
    parallels: [],
    candidates: [],
  };
}

export function collapseLookupSetWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function buildLookupSetYearPrefix(year: string, sport: string): string | null {
  const yearNum = Number.parseInt(year, 10);
  if (!Number.isFinite(yearNum)) {
    return null;
  }
  const sportKey = collapseLookupSetWhitespace(sport).toLowerCase();
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

async function loadSetParallels(setId: string): Promise<LookupSetParallelOption[]> {
  const rows = await prisma.setParallelScope.findMany({
    where: {
      setId,
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
    const label = collapseLookupSetWhitespace(row.parallel?.label ?? "");
    const parallelId = collapseLookupSetWhitespace(row.parallel?.parallelId ?? row.parallelId ?? "");
    if (!label || !parallelId || deduped.has(parallelId)) {
      continue;
    }
    deduped.set(parallelId, {
      parallelId,
      label,
      serialDenominator: typeof row.parallel?.serialDenominator === "number" ? row.parallel.serialDenominator : null,
      serialText: collapseLookupSetWhitespace(row.parallel?.serialText ?? "") || null,
      finishFamily: collapseLookupSetWhitespace(row.parallel?.finishFamily ?? "") || null,
    });
  }

  return Array.from(deduped.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
  );
}

export async function lookupSetByCardIdentity(
  input: LookupSetByCardIdentityInput
): Promise<LookupSetResult> {
  const normalizedCardNumber = normalizeCardNumber(input.cardNumber);
  const yearPrefix = buildLookupSetYearPrefix(input.year, input.sport);
  const normalizedManufacturer = collapseLookupSetWhitespace(input.manufacturer);
  const normalizedSport = collapseLookupSetWhitespace(input.sport);
  const normalizedPlayerName = collapseLookupSetWhitespace(input.playerName);

  if (
    !normalizedCardNumber ||
    !yearPrefix ||
    !normalizedManufacturer ||
    !normalizedSport ||
    !normalizedPlayerName
  ) {
    return emptyLookupSetResult();
  }

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
    return emptyLookupSetResult();
  }

  const candidates = await Promise.all(
    matchedRows.map(async (row) => ({
      setId: row.setId,
      insertLabel: collapseLookupSetWhitespace(row.program.label),
      programId: row.programId,
      parallels: await loadSetParallels(row.setId),
    }))
  );

  const primary = candidates[0] ?? null;
  return {
    match: candidates.length === 1 ? "exact" : "multiple",
    setId: primary?.setId ?? null,
    insertLabel: primary?.insertLabel ?? null,
    programId: primary?.programId ?? null,
    parallels: primary?.parallels ?? [],
    candidates: candidates.length > 1 ? candidates : [],
  };
}
