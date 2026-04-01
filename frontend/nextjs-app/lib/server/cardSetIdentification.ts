import { prisma, SetIngestionJobStatus, type Prisma } from "@tenkings/database";
import {
  normalizeCardIdentityPlayerName,
  normalizeCardIdentityPlayerNameBase,
} from "@tenkings/shared";
import { loadVariantOptionPool, normalizeVariantLabelKey, sanitizeText } from "./variantOptionPool";
import { normalizeTaxonomyCardNumber } from "./taxonomyV2Utils";

export type IdentifySetConfidence = "exact" | "fuzzy" | "none";
export type IdentifySetMatchType = Exclude<IdentifySetConfidence, "none">;
export type IdentifySetTiebreaker = "chrome" | "optic" | "default" | "none";
export type IdentifySetTextSource = "front" | "combined" | "none";

export type IdentifySetCandidate = {
  setId: string;
  setName: string;
  programId: string | null;
  programLabel: string | null;
  cardNumber: string;
  playerName: string | null;
  teamName: string | null;
  matchType: IdentifySetMatchType;
  score: number;
  tieBreakRank: number;
};

export type IdentifySetResult = {
  setId: string | null;
  setName: string | null;
  programId: string | null;
  programLabel: string | null;
  cardNumber: string | null;
  playerName: string | null;
  teamName: string | null;
  confidence: IdentifySetConfidence;
  reason: string;
  candidateSetIds: string[];
  candidateCount: number;
  scopedSetCount: number;
  candidates: IdentifySetCandidate[];
  tiebreaker: IdentifySetTiebreaker;
  textSource: IdentifySetTextSource;
};

type IdentifySetParams = {
  year: string | null | undefined;
  manufacturer: string | null | undefined;
  sport: string | null | undefined;
  cardNumber: string | null | undefined;
  playerName: string | null | undefined;
  teamName?: string | null | undefined;
  insertSet?: string | null | undefined;
  frontCardText?: string | null | undefined;
  combinedText?: string | null | undefined;
};

type NameMatchResult = {
  matched: boolean;
  matchType: IdentifySetMatchType | null;
  score: number;
};

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

function publishedSetProgramWhereInput(): Prisma.SetProgramWhereInput {
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

function normalizeIdentityText(value: string | null | undefined) {
  return normalizeCardIdentityPlayerName(value);
}

function normalizeIdentityTextBase(value: string | null | undefined) {
  return normalizeCardIdentityPlayerNameBase(value);
}

function tokenizeIdentity(value: string) {
  return value.split(" ").map((token) => token.trim()).filter(Boolean);
}

function countTokenOverlap(left: Set<string>, right: Set<string>) {
  let overlap = 0;
  left.forEach((token) => {
    if (right.has(token)) {
      overlap += 1;
    }
  });
  return overlap;
}

function comparePlayerNames(inputName: string | null | undefined, rowName: string | null | undefined): NameMatchResult {
  const inputFull = normalizeIdentityText(inputName);
  const rowFull = normalizeIdentityText(rowName);
  const inputBase = normalizeIdentityTextBase(inputName);
  const rowBase = normalizeIdentityTextBase(rowName);

  if (!inputBase || !rowBase) {
    return { matched: false, matchType: null, score: 0 };
  }

  if (inputFull && rowFull && inputFull === rowFull) {
    return { matched: true, matchType: "exact", score: 100 };
  }

  if (inputBase === rowBase) {
    return { matched: true, matchType: "exact", score: 98 };
  }

  const inputTokens = tokenizeIdentity(inputBase);
  const rowTokens = tokenizeIdentity(rowBase);
  if (inputTokens.length < 2 || rowTokens.length < 2) {
    return { matched: false, matchType: null, score: 0 };
  }

  const inputLast = inputTokens[inputTokens.length - 1] ?? "";
  const rowLast = rowTokens[rowTokens.length - 1] ?? "";
  if (!inputLast || inputLast !== rowLast) {
    return { matched: false, matchType: null, score: 0 };
  }

  const overlap = countTokenOverlap(new Set(inputTokens), new Set(rowTokens));
  const minTokenCount = Math.min(inputTokens.length, rowTokens.length);
  if (inputBase.includes(rowBase) || rowBase.includes(inputBase)) {
    return { matched: true, matchType: "fuzzy", score: 84 + overlap };
  }
  if (overlap >= Math.max(2, minTokenCount - 1)) {
    return { matched: true, matchType: "fuzzy", score: 80 + overlap };
  }
  if (overlap >= 2) {
    return { matched: true, matchType: "fuzzy", score: 74 + overlap };
  }

  return { matched: false, matchType: null, score: 0 };
}

function detectTiebreakSignal(
  frontCardText: string | null | undefined,
  combinedText: string | null | undefined,
  hasMultipleCandidates: boolean
): { tiebreaker: IdentifySetTiebreaker; textSource: IdentifySetTextSource } {
  if (!hasMultipleCandidates) {
    return { tiebreaker: "none", textSource: "none" };
  }

  const front = normalizeIdentityText(frontCardText);
  if (front.includes("chrome")) {
    return { tiebreaker: "chrome", textSource: "front" };
  }
  if (front.includes("optic")) {
    return { tiebreaker: "optic", textSource: "front" };
  }

  const combined = normalizeIdentityText(combinedText);
  if (combined.includes("chrome")) {
    return { tiebreaker: "chrome", textSource: "combined" };
  }
  if (combined.includes("optic")) {
    return { tiebreaker: "optic", textSource: "combined" };
  }

  return { tiebreaker: "default", textSource: "none" };
}

function rankCandidateByTiebreak(setId: string, tiebreaker: IdentifySetTiebreaker) {
  const normalizedSetId = normalizeIdentityText(setId);
  const hasChrome = normalizedSetId.includes("chrome");
  const hasOptic = normalizedSetId.includes("optic");

  switch (tiebreaker) {
    case "chrome":
      return hasChrome ? 3 : hasOptic ? 0 : 1;
    case "optic":
      return hasOptic ? 3 : hasChrome ? 0 : 1;
    case "default":
      return !hasChrome && !hasOptic ? 2 : 1;
    default:
      return 0;
  }
}

export async function identifySetByCardIdentity(params: IdentifySetParams): Promise<IdentifySetResult> {
  const year = sanitizeText(params.year || "");
  const manufacturer = sanitizeText(params.manufacturer || "");
  const sport = sanitizeText(params.sport || "") || null;
  const normalizedCardNumber = normalizeTaxonomyCardNumber(params.cardNumber);
  const normalizedPlayerName = normalizeIdentityTextBase(params.playerName);

  if (!year || !manufacturer) {
    return {
      setId: null,
      setName: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
      confidence: "none",
      reason: "missing_scope_hints",
      candidateSetIds: [],
      candidateCount: 0,
      scopedSetCount: 0,
      candidates: [],
      tiebreaker: "none",
      textSource: "none",
    };
  }

  if (!normalizedCardNumber || normalizedCardNumber === "ALL") {
    return {
      setId: null,
      setName: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
      confidence: "none",
      reason: "missing_card_number",
      candidateSetIds: [],
      candidateCount: 0,
      scopedSetCount: 0,
      candidates: [],
      tiebreaker: "none",
      textSource: "none",
    };
  }

  if (!normalizedPlayerName) {
    return {
      setId: null,
      setName: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
      confidence: "none",
      reason: "missing_player_name",
      candidateSetIds: [],
      candidateCount: 0,
      scopedSetCount: 0,
      candidates: [],
      tiebreaker: "none",
      textSource: "none",
    };
  }

  const pool = await loadVariantOptionPool({
    year,
    manufacturer,
    sport,
    productLine: null,
    setId: null,
  });

  const candidateSetIds = Array.from(new Set(pool.scopedSetIds.filter(Boolean)));
  if (candidateSetIds.length < 1) {
    return {
      setId: null,
      setName: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
      confidence: "none",
      reason: "no_scoped_sets",
      candidateSetIds: [],
      candidateCount: 0,
      scopedSetCount: 0,
      candidates: [],
      tiebreaker: "none",
      textSource: "none",
    };
  }

  const rows = await prisma.setCard.findMany({
    where: {
      setId: { in: candidateSetIds },
      cardNumber: normalizedCardNumber,
      ...publishedSetCardWhereInput(),
    },
    select: {
      setId: true,
      programId: true,
      cardNumber: true,
      playerName: true,
      team: true,
    },
    take: 200,
  });

  if (rows.length < 1) {
    return {
      setId: null,
      setName: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
      confidence: "none",
      reason: "card_number_not_found_in_scope",
      candidateSetIds,
      candidateCount: 0,
      scopedSetCount: candidateSetIds.length,
      candidates: [],
      tiebreaker: "none",
      textSource: "none",
    };
  }

  const programKeyValues = Array.from(new Set(rows.map((row) => `${row.setId}::${row.programId}`)));
  const programs = await prisma.setProgram.findMany({
    where: {
      OR: programKeyValues.map((entry) => {
        const [setId, programId] = entry.split("::");
        return { setId, programId };
      }),
      ...publishedSetProgramWhereInput(),
    },
    select: {
      setId: true,
      programId: true,
      label: true,
    },
  });
  const programLabelByKey = new Map(programs.map((program) => [`${program.setId}::${program.programId}`, program.label]));

  const normalizedTeamName = normalizeIdentityTextBase(params.teamName);
  const normalizedInsertSet = normalizeVariantLabelKey(params.insertSet || "");
  const bestCandidateBySet = new Map<string, IdentifySetCandidate>();

  rows.forEach((row) => {
    const playerMatch = comparePlayerNames(params.playerName, row.playerName);
    if (!playerMatch.matched || !playerMatch.matchType) {
      return;
    }

    let score = playerMatch.score;
    const rowTeamName = normalizeIdentityTextBase(row.team);
    if (normalizedTeamName && rowTeamName && normalizedTeamName === rowTeamName) {
      score += 4;
    }

    const programLabel = programLabelByKey.get(`${row.setId}::${row.programId}`) ?? null;
    const rowProgramKey = normalizeVariantLabelKey(programLabel || row.programId || "");
    if (normalizedInsertSet && rowProgramKey && normalizedInsertSet === rowProgramKey) {
      score += 3;
    }

    const nextCandidate: IdentifySetCandidate = {
      setId: row.setId,
      setName: row.setId,
      programId: row.programId,
      programLabel,
      cardNumber: row.cardNumber,
      playerName: row.playerName ?? null,
      teamName: row.team ?? null,
      matchType: playerMatch.matchType,
      score,
      tieBreakRank: 0,
    };

    const previous = bestCandidateBySet.get(row.setId);
    if (!previous || nextCandidate.score > previous.score) {
      bestCandidateBySet.set(row.setId, nextCandidate);
    }
  });

  const candidates = Array.from(bestCandidateBySet.values());
  if (candidates.length < 1) {
    return {
      setId: null,
      setName: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
      confidence: "none",
      reason: "player_name_not_found_for_card_number",
      candidateSetIds,
      candidateCount: 0,
      scopedSetCount: candidateSetIds.length,
      candidates: [],
      tiebreaker: "none",
      textSource: "none",
    };
  }

  const { tiebreaker, textSource } = detectTiebreakSignal(
    params.frontCardText,
    params.combinedText,
    candidates.length > 1
  );

  const rankedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      tieBreakRank: rankCandidateByTiebreak(candidate.setId, tiebreaker),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.tieBreakRank - left.tieBreakRank ||
        left.setId.localeCompare(right.setId) ||
        (left.programId ?? "").localeCompare(right.programId ?? "")
    );

  const best = rankedCandidates[0] ?? null;
  const runnerUp = rankedCandidates[1] ?? null;
  if (!best) {
    return {
      setId: null,
      setName: null,
      programId: null,
      programLabel: null,
      cardNumber: normalizedCardNumber,
      playerName: null,
      teamName: null,
      confidence: "none",
      reason: "identify_set_failed",
      candidateSetIds,
      candidateCount: rankedCandidates.length,
      scopedSetCount: candidateSetIds.length,
      candidates: rankedCandidates,
      tiebreaker,
      textSource,
    };
  }

  const ambiguousAfterTiebreak = Boolean(
    runnerUp &&
      runnerUp.setId !== best.setId &&
      runnerUp.score === best.score &&
      runnerUp.tieBreakRank === best.tieBreakRank
  );

  return {
    setId: best.setId,
    setName: best.setName,
    programId: best.programId,
    programLabel: best.programLabel,
    cardNumber: best.cardNumber,
    playerName: best.playerName,
    teamName: best.teamName,
    confidence: best.matchType,
    reason: ambiguousAfterTiebreak
      ? "ambiguous_post_tiebreak_first_candidate"
      : best.matchType === "exact"
      ? rankedCandidates.length > 1
        ? "exact_card_player_tiebreak"
        : "exact_card_player_match"
      : rankedCandidates.length > 1
      ? "fuzzy_card_player_tiebreak"
      : "fuzzy_card_player_match",
    candidateSetIds,
    candidateCount: rankedCandidates.length,
    scopedSetCount: candidateSetIds.length,
    candidates: rankedCandidates,
    tiebreaker,
    textSource,
  };
}
