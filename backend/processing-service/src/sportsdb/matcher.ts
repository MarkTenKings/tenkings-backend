// @ts-nocheck
import { prisma, Prisma } from "@tenkings/database";
import { CardAttributes, inferPlayerNameFromText } from "@tenkings/shared";
import { config } from "../config";

interface ClassificationHints {
  bestMatch: Record<string, unknown> | null;
  labels: string[];
  tags: string[];
}

interface MatchContext {
  ocrText: string | null | undefined;
  attributes: CardAttributes;
  classificationHints?: ClassificationHints;
}

interface PlayerMatchResult {
  playerId: string | null;
  confidence: number;
  resolvedName: string | null;
  resolvedTeam: string | null;
  snapshot: Prisma.InputJsonValue | null;
}

type PlayerWithRelations = Prisma.SportsDbPlayerGetPayload<{
  include: {
    team: true;
    seasons: true;
  };
}>;

const playerInclude: Prisma.SportsDbPlayerInclude = {
  team: true,
  seasons: {
    orderBy: { season: "desc" },
    take: 5,
  },
};

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function extractNamesFromBestMatch(bestMatch: Record<string, unknown> | null | undefined): string[] {
  if (!bestMatch) {
    return [];
  }
  const keys = [
    "full_name",
    "name",
    "title",
    "player",
    "player_name",
    "card_name",
  ];
  const names = new Set<string>();
  for (const key of keys) {
    const value = (bestMatch as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim().length > 0) {
      names.add(titleCase(value.trim()));
    }
  }
  return Array.from(names);
}

function extractNamesFromLabels(labels: string[] | undefined): string[] {
  if (!labels) {
    return [];
  }
  const names = new Set<string>();
  for (const label of labels) {
    if (!label || typeof label !== "string") {
      continue;
    }
    const trimmed = label.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const words = trimmed.split(/\s+/);
    if (words.length >= 2 && words.length <= 4) {
      names.add(titleCase(trimmed));
    }
  }
  return Array.from(names);
}

function extractNamesFromTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }
  const names = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") {
      continue;
    }
    const cleaned = tag.trim();
    if (!cleaned || cleaned.length < 5) {
      continue;
    }
    const words = cleaned.split(/\s+/);
    if (words.length >= 2 && words.length <= 4) {
      names.add(titleCase(cleaned));
    }
  }
  return Array.from(names);
}

function collectCandidateNames(context: MatchContext, fallbackName: string | null): string[] {
  const candidates = new Set<string>();
  if (context.attributes.playerName) {
    candidates.add(context.attributes.playerName);
  }
  if (fallbackName) {
    candidates.add(fallbackName);
  }

  const hints = context.classificationHints;
  if (hints) {
    for (const name of extractNamesFromBestMatch(hints.bestMatch)) {
      candidates.add(name);
    }
    for (const name of extractNamesFromLabels(hints.labels)) {
      candidates.add(name);
    }
    for (const name of extractNamesFromTags(hints.tags)) {
      candidates.add(name);
    }
  }

  return Array.from(candidates).filter((name) => tokenize(name).length >= 2);
}

function extractTeamHint(bestMatch: Record<string, unknown> | null | undefined): string | null {
  if (!bestMatch) {
    return null;
  }
  const keys = [
    "team",
    "club",
    "team_name",
    "full_team_name",
  ];
  for (const key of keys) {
    const value = (bestMatch as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return titleCase(value.trim());
    }
  }
  return null;
}

function computeNameScore(targetTokens: string[], candidateTokens: string[]): number {
  const targetSet = new Set(targetTokens);
  const candidateSet = new Set(candidateTokens);
  let overlap = 0;
  for (const token of candidateSet) {
    if (targetSet.has(token)) {
      overlap += 1;
    }
  }
  if (overlap === 0) {
    return 0;
  }
  const precision = overlap / candidateTokens.length;
  const recall = overlap / targetTokens.length;
  const fScore = (2 * precision * recall) / (precision + recall);
  return Math.round(fScore * 70); // up to 70 points from name similarity
}

function computeTeamScore(teamName: string | null, candidateTeam: string | null): number {
  if (!teamName || !candidateTeam) {
    return 0;
  }
  const target = tokenize(teamName);
  const candidate = tokenize(candidateTeam);
  if (target.length === 0 || candidate.length === 0) {
    return 0;
  }
  const overlap = target.filter((token) => candidate.includes(token)).length;
  return overlap > 0 ? 20 : 0;
}

function computeSportBonus(attributes: CardAttributes, candidateSport: string | null): number {
  if (!candidateSport) {
    return 0;
  }
  const sport = candidateSport.toLowerCase();
  if (attributes.brand && attributes.brand.toLowerCase().includes("baseball") && sport.includes("baseball")) {
    return 5;
  }
  if (attributes.brand && attributes.brand.toLowerCase().includes("basketball") && sport.includes("basketball")) {
    return 5;
  }
  return 0;
}

function buildSnapshot(player: PlayerWithRelations | null): Prisma.InputJsonValue | null {
  if (!player) {
    return null;
  }
  const seasons = player.seasons
    .map((season) => ({
      season: season.season,
      league: season.league,
      stats: season.statsJson,
    }))
    .sort((a, b) => (b.season ?? "").localeCompare(a.season ?? ""));

  return {
    playerId: player.id,
    fullName: player.fullName,
    sport: player.sport,
    league: player.league,
    team: player.team
      ? {
          id: player.team.id,
          name: player.team.name,
          logoUrl: player.team.logoUrl,
        }
      : null,
    seasons,
  } satisfies Prisma.InputJsonValue;
}

async function loadRosterPlayers(teamName: string | null): Promise<PlayerWithRelations[]> {
  if (!teamName) {
    return [];
  }
  const trimmed = teamName.trim();
  if (!trimmed) {
    return [];
  }

  const teamFilters: Prisma.SportsDbTeamWhereInput[] = [
    { name: { equals: trimmed, mode: "insensitive" } },
    { name: { contains: trimmed, mode: "insensitive" } },
    { alternateNames: { has: trimmed } },
    { alternateNames: { has: trimmed.toUpperCase() } },
  ];

  const tokens = tokenize(trimmed).filter((token) => token.length >= 3);
  for (const token of tokens) {
    teamFilters.push({ name: { contains: token, mode: "insensitive" } });
    teamFilters.push({ alternateNames: { has: token } });
    teamFilters.push({ alternateNames: { has: token.toUpperCase() } });
  }

  const teams = await prisma.sportsDbTeam.findMany({
    where: { OR: teamFilters },
    select: { id: true },
    take: 5,
  });

  if (teams.length === 0) {
    return [];
  }

  const teamIds = teams.map((team) => team.id);

  return prisma.sportsDbPlayer.findMany({
    where: {
      teamId: { in: teamIds },
    },
    include: playerInclude,
    orderBy: { updatedAt: "desc" },
    take: 150,
  });
}

function evaluateCandidates(
  players: PlayerWithRelations[],
  nameTokens: string[],
  context: MatchContext,
  rosterIds: Set<string>
): { player: PlayerWithRelations; score: number } | null {
  if (players.length === 0) {
    return null;
  }

  let best: { player: PlayerWithRelations; score: number } | null = null;

  for (const player of players) {
    const candidateTokens = tokenize(player.fullName);
    const nameScore = computeNameScore(nameTokens, candidateTokens);
    const teamScore = computeTeamScore(context.attributes.teamName, player.team?.name ?? null);
    const aliases = player.alternateNames ?? [];
    const aliasTokens = aliases.flatMap((alias) => tokenize(alias));
    const aliasOverlap = aliasTokens.filter((token) => nameTokens.includes(token)).length;
    const aliasScore = aliasOverlap > 0 ? 10 : 0;
    const sportBonus = computeSportBonus(context.attributes, player.sport);
    const rosterBonus = rosterIds.has(player.id) && context.attributes.teamName ? 10 : 0;
    const totalScore = Math.min(100, nameScore + teamScore + aliasScore + sportBonus + rosterBonus);

    if (!best || totalScore > best.score) {
      best = { player, score: totalScore };
    }
  }

  return best;
}

export async function matchPlayerFromOcr(context: MatchContext): Promise<PlayerMatchResult> {
  if (!config.sportsDbApiKey) {
    return {
      playerId: null,
      confidence: 0,
      resolvedName: inferPlayerNameFromText(context.ocrText),
      resolvedTeam: context.attributes.teamName,
      snapshot: null,
    };
  }

  const candidateName = inferPlayerNameFromText(context.ocrText);

  const teamHint =
    context.attributes.teamName ?? extractTeamHint(context.classificationHints?.bestMatch);

  const contextForScoring = teamHint
    ? {
        ...context,
        attributes: {
          ...context.attributes,
          teamName: teamHint,
        },
      }
    : context;

  const rosterPlayers = await loadRosterPlayers(teamHint);
  const rosterIds = new Set(rosterPlayers.map((player) => player.id));

  const candidateNames = collectCandidateNames(context, candidateName);

  if (candidateNames.length === 0) {
    return {
      playerId: null,
      confidence: 0,
      resolvedName: null,
      resolvedTeam: teamHint ?? context.attributes.teamName,
      snapshot: null,
    };
  }

  let overallBest: { player: PlayerWithRelations; score: number; resolvedName: string } | null = null;

  const rosterMap = new Map<string, PlayerWithRelations>();
  for (const player of rosterPlayers) {
    rosterMap.set(player.id, player);
  }

  for (const nameCandidate of candidateNames) {
    const nameTokens = tokenize(nameCandidate);
    if (nameTokens.length === 0) {
      continue;
    }

    const directPlayers: PlayerWithRelations[] = await prisma.sportsDbPlayer.findMany({
      where: {
        OR: [
          { fullName: { equals: nameCandidate, mode: "insensitive" } },
          { displayName: { equals: nameCandidate, mode: "insensitive" } },
          {
            AND: nameTokens.map((token) => ({ fullName: { contains: token, mode: "insensitive" } })),
          },
          { alternateNames: { has: nameCandidate } },
          { alternateNames: { has: nameCandidate.toUpperCase() } },
          { alternateNames: { hasSome: nameTokens.map((token) => token.toUpperCase()) } },
        ],
      },
      include: playerInclude,
      take: 50,
    });

    const candidateMap = new Map<string, PlayerWithRelations>(rosterMap);
    for (const player of directPlayers) {
      if (!candidateMap.has(player.id)) {
        candidateMap.set(player.id, player);
      }
    }

    const candidates = Array.from(candidateMap.values());
    if (candidates.length === 0) {
      continue;
    }

    const best = evaluateCandidates(candidates, nameTokens, contextForScoring, rosterIds);
    if (best && (!overallBest || best.score > overallBest.score)) {
      overallBest = { player: best.player, score: best.score, resolvedName: nameCandidate };
    }
  }

  if (!overallBest) {
    return {
      playerId: null,
      confidence: 0,
      resolvedName: candidateName,
      resolvedTeam: teamHint ?? context.attributes.teamName,
      snapshot: null,
    };
  }

  const matched = overallBest.score >= 40;
  const confidence = Math.round((overallBest.score / 100) * 100) / 100;
  const snapshot = matched ? buildSnapshot(overallBest.player) : null;

  return {
    playerId: matched ? overallBest.player.id : null,
    confidence: matched ? confidence : 0,
    resolvedName: matched ? overallBest.player.fullName : overallBest.resolvedName,
    resolvedTeam: matched
      ? overallBest.player.team?.name ?? teamHint ?? context.attributes.teamName
      : teamHint ?? context.attributes.teamName,
    snapshot,
  };
}
