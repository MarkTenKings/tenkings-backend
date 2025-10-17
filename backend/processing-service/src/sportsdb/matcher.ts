import { prisma, Prisma } from "@tenkings/database";
import { CardAttributes, inferPlayerNameFromText } from "@tenkings/shared";
import { config } from "../config";

interface MatchContext {
  ocrText: string | null | undefined;
  attributes: CardAttributes;
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

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
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
  if (!candidateName) {
    return {
      playerId: null,
      confidence: 0,
      resolvedName: null,
      resolvedTeam: context.attributes.teamName,
      snapshot: null,
    };
  }

  const nameTokens = tokenize(candidateName);
  if (nameTokens.length === 0) {
    return {
      playerId: null,
      confidence: 0,
      resolvedName: candidateName,
      resolvedTeam: context.attributes.teamName,
      snapshot: null,
    };
  }

  const [firstToken] = nameTokens;
  const lastToken = nameTokens[nameTokens.length - 1];

  const players: PlayerWithRelations[] = await prisma.sportsDbPlayer.findMany({
    where: {
      OR: [
        { fullName: { equals: candidateName, mode: "insensitive" } },
        {
          AND: [
            { fullName: { contains: firstToken, mode: "insensitive" } },
            { fullName: { contains: lastToken, mode: "insensitive" } },
          ],
        },
        { alternateNames: { has: candidateName } },
        { alternateNames: { has: candidateName.toUpperCase() } },
      ],
    },
    include: {
      team: true,
      seasons: {
        orderBy: { season: "desc" },
        take: 5,
      },
    },
    take: 25,
  });

  if (players.length === 0) {
    return {
      playerId: null,
      confidence: 0,
      resolvedName: candidateName,
      resolvedTeam: context.attributes.teamName,
      snapshot: null,
    };
  }

  let best = { player: players[0], score: 0 };
  for (const player of players) {
    const candidateTokens = tokenize(player.fullName);
    const nameScore = computeNameScore(nameTokens, candidateTokens);
    const teamScore = computeTeamScore(context.attributes.teamName, player.team?.name ?? null);
    const aliases = player.alternateNames ?? [];
    const aliasTokens = aliases.flatMap((alias) => tokenize(alias));
    const aliasOverlap = aliasTokens.filter((token) => nameTokens.includes(token)).length;
    const aliasScore = aliasOverlap > 0 ? 10 : 0;
    const sportBonus = computeSportBonus(context.attributes, player.sport);
    const totalScore = Math.min(100, nameScore + teamScore + aliasScore + sportBonus);

    if (totalScore > best.score) {
      best = { player, score: totalScore };
    }
  }

  const matched = best.score >= 40;
  const confidence = Math.round((best.score / 100) * 100) / 100;
  const snapshot = matched ? buildSnapshot(best.player) : null;

  return {
    playerId: matched ? best.player.id : null,
    confidence: matched ? confidence : 0,
    resolvedName: matched ? best.player.fullName : candidateName,
    resolvedTeam: matched ? best.player.team?.name ?? context.attributes.teamName : context.attributes.teamName,
    snapshot,
  };
}
