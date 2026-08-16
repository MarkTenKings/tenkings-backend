import type {
  SpeedsterCardSide,
} from "./contracts";
import type {
  SpeedsterColorGeometryMode,
  SpeedsterColorGeometryOutcome,
  SpeedsterMatColor,
} from "./color-geometry";

export type SpeedsterColorGeometryScore = Readonly<{
  version: "speedster-color-geometry-score-v1";
  totalResults: number;
  acceptedResults: number;
  acceptedUnchanged: number;
  correctedAccepted: number;
  manualFallbacks: number;
  proposalAgreementRate: number | null;
  firstDraftYieldRate: number | null;
  proposalCoverageRate: number | null;
  outcomes: Readonly<Record<SpeedsterColorGeometryOutcome, number>>;
  breakdown: readonly Readonly<{
    side: SpeedsterCardSide;
    matColor: SpeedsterMatColor;
    total: number;
    accepted: number;
    acceptedUnchanged: number;
    manualFallbacks: number;
    proposalAgreementRate: number | null;
    proposalCoverageRate: number;
  }>[];
  recentCards: readonly Readonly<{
    sessionId: string;
    cardProfile: string;
    identity: unknown;
    createdAt: string;
    results: readonly Readonly<{
      side: SpeedsterCardSide;
      mode: SpeedsterColorGeometryMode;
      matColor: SpeedsterMatColor;
      outcome: SpeedsterColorGeometryOutcome;
      proposalChanged: boolean | null;
    }>[];
  }>[];
}>;

export type SpeedsterColorGeometryScoreRow = Readonly<{
  sessionId: string;
  side: SpeedsterCardSide;
  mode: SpeedsterColorGeometryMode;
  matColor: SpeedsterMatColor;
  outcome: SpeedsterColorGeometryOutcome;
  proposalChanged: boolean | null;
  createdAt: Date;
  session: Readonly<{ cardProfile: string; identity: unknown }>;
}>;

export type SpeedsterColorGeometryScoreAggregateRow = Readonly<{
  side: SpeedsterCardSide;
  matColor: SpeedsterMatColor;
  outcome: SpeedsterColorGeometryOutcome;
  proposalChanged: boolean | null;
  count: number;
}>;

function summarizeSpeedsterColorGeometryRows(
  rows: readonly SpeedsterColorGeometryScoreAggregateRow[],
) {
  const outcomes: Record<SpeedsterColorGeometryOutcome, number> = {
    ACCEPTED: 0,
    INSUFFICIENT_EVIDENCE: 0,
    NOT_APPLICABLE: 0,
    ABSTAIN: 0,
  };
  const breakdown = new Map<string, {
    side: SpeedsterCardSide;
    matColor: SpeedsterMatColor;
    total: number;
    accepted: number;
    acceptedUnchanged: number;
    manualFallbacks: number;
  }>();
  let totalResults = 0;
  let acceptedUnchanged = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.count) || row.count < 0) {
      throw new Error("Color geometry score aggregate count is malformed.");
    }
    totalResults += row.count;
    outcomes[row.outcome] += row.count;
    const key = `${row.side}:${row.matColor}`;
    const cell = breakdown.get(key) ?? {
      side: row.side,
      matColor: row.matColor,
      total: 0,
      accepted: 0,
      acceptedUnchanged: 0,
      manualFallbacks: 0,
    };
    cell.total += row.count;
    if (row.outcome === "ACCEPTED") {
      cell.accepted += row.count;
      if (row.proposalChanged === false) {
        cell.acceptedUnchanged += row.count;
        acceptedUnchanged += row.count;
      }
    } else {
      cell.manualFallbacks += row.count;
    }
    breakdown.set(key, cell);
  }
  return { outcomes, breakdown, totalResults, acceptedUnchanged };
}

export function buildSpeedsterColorGeometryScoreFromAggregates(
  aggregateRows: readonly SpeedsterColorGeometryScoreAggregateRow[],
  recentRows: readonly SpeedsterColorGeometryScoreRow[],
  recentLimit = 20,
): SpeedsterColorGeometryScore {
  const { outcomes, breakdown, totalResults, acceptedUnchanged } = summarizeSpeedsterColorGeometryRows(aggregateRows);
  const cards = new Map<string, SpeedsterColorGeometryScore["recentCards"][number]>();
  for (const row of recentRows) {
    const existing = cards.get(row.sessionId);
    const result = {
      side: row.side,
      mode: row.mode,
      matColor: row.matColor,
      outcome: row.outcome,
      proposalChanged: row.proposalChanged,
    };
    cards.set(row.sessionId, existing ? {
      ...existing,
      results: [...existing.results, result],
    } : {
      sessionId: row.sessionId,
      cardProfile: row.session.cardProfile,
      identity: row.session.identity,
      createdAt: row.createdAt.toISOString(),
      results: [result],
    });
  }
  const acceptedResults = outcomes.ACCEPTED;
  return {
    version: "speedster-color-geometry-score-v1",
    totalResults,
    acceptedResults,
    acceptedUnchanged,
    correctedAccepted: acceptedResults - acceptedUnchanged,
    manualFallbacks: totalResults - acceptedResults,
    proposalAgreementRate: acceptedResults ? acceptedUnchanged / acceptedResults : null,
    firstDraftYieldRate: totalResults ? acceptedUnchanged / totalResults : null,
    proposalCoverageRate: totalResults ? acceptedResults / totalResults : null,
    outcomes,
    breakdown: [...breakdown.values()].map((row) => ({
      ...row,
      proposalAgreementRate: row.accepted ? row.acceptedUnchanged / row.accepted : null,
      proposalCoverageRate: row.accepted / row.total,
    })).sort((a, b) => `${a.side}:${a.matColor}`.localeCompare(`${b.side}:${b.matColor}`)),
    recentCards: [...cards.values()].slice(0, recentLimit),
  };
}

export function buildSpeedsterColorGeometryScore(
  allRows: readonly SpeedsterColorGeometryScoreRow[],
  recentLimit = 20,
): SpeedsterColorGeometryScore {
  const aggregateRows = new Map<string, SpeedsterColorGeometryScoreAggregateRow>();
  for (const row of allRows) {
    const key = `${row.side}:${row.matColor}:${row.outcome}:${String(row.proposalChanged)}`;
    const current = aggregateRows.get(key);
    aggregateRows.set(key, current ? { ...current, count: current.count + 1 } : {
      side: row.side,
      matColor: row.matColor,
      outcome: row.outcome,
      proposalChanged: row.proposalChanged,
      count: 1,
    });
  }
  return buildSpeedsterColorGeometryScoreFromAggregates([...aggregateRows.values()], allRows, recentLimit);
}
