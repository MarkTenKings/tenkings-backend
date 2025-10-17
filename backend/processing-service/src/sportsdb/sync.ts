import { prisma, Prisma } from "@tenkings/database";
import { config } from "../config";
import {
  fetchPlayerDetails,
  fetchPlayerSeasonStats,
  fetchTeamPlayers,
  fetchTeamsByLeague,
  searchPlayerByName,
} from "./client";
import {
  SportsDbLeaguesConfig,
  SportsDbPlayerRecord,
  SportsDbPlayerResultRecord,
  SportsDbTeamRecord,
} from "./types";

const DEFAULT_LEAGUES: SportsDbLeaguesConfig = [
  { code: "NBA", sport: "Basketball", leagueIds: ["4387"] },
  { code: "NFL", sport: "American Football", leagueIds: ["4391"] },
  { code: "MLB", sport: "Baseball", leagueIds: ["4424"] },
  { code: "NHL", sport: "Ice Hockey", leagueIds: ["4380"] },
];

function normalizeList(value?: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[;|,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function toTitleCase(input: string): string {
  return input
    .split(/\s+/)
    .map((segment) =>
      segment.length === 0
        ? segment
        : segment[0].toUpperCase() + segment.slice(1).toLowerCase()
    )
    .join(" ");
}

function collectAlternateNames(record: SportsDbTeamRecord): string[] {
  const names = new Set<string>();
  const direct = [
    record.strTeamShort,
    record.strKeywords,
    record.strAlternate,
  ];
  for (const entry of direct) {
    for (const candidate of normalizeList(entry)) {
      names.add(toTitleCase(candidate));
    }
  }
  return Array.from(names);
}

function collectPlayerAliases(record: SportsDbPlayerRecord): string[] {
  const names = new Set<string>();
  const sources = [record.strPlayerAlternate, record.strPlayer];
  for (const source of sources) {
    for (const candidate of normalizeList(source)) {
      names.add(toTitleCase(candidate));
    }
  }
  return Array.from(names);
}

function pickPlayerImage(record: SportsDbPlayerRecord): string | null {
  return record.strCutout ?? record.strThumb ?? record.strRender ?? null;
}

function toDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deriveSeasonIdentifier(record: SportsDbPlayerResultRecord, fallback: string): string {
  if (record.intSeason && record.intSeason.trim().length > 0) {
    return record.intSeason.trim();
  }
  if (record.strSeason && record.strSeason.trim().length > 0) {
    return record.strSeason.trim();
  }
  return fallback;
}

export interface SyncSportsDbOptions {
  leagues?: SportsDbLeaguesConfig;
  enableStats?: boolean;
  onStatus?: (message: string) => void;
}

function logStatus(message: string, onStatus?: (msg: string) => void) {
  if (onStatus) {
    onStatus(message);
  }
  console.log(`[sportsdb] ${message}`);
}

async function syncTeam(record: SportsDbTeamRecord, context: { leagueCode: string; sportName: string; onStatus?: (msg: string) => void }) {
  const alternateNames = collectAlternateNames(record);
  await prisma.sportsDbTeam.upsert({
    where: { id: record.idTeam },
    create: {
      id: record.idTeam,
      name: record.strTeam,
      alternateNames,
      sport: record.strSport ?? context.sportName,
      league: record.strLeague ?? context.leagueCode,
      city: record.strCountry ?? null,
      abbreviation: record.strTeamShort ?? null,
      logoUrl: record.strTeamBadge ?? record.strTeamLogo ?? null,
      lastSyncedAt: new Date(),
    },
    update: {
      name: record.strTeam,
      alternateNames,
      sport: record.strSport ?? context.sportName,
      league: record.strLeague ?? context.leagueCode,
      city: record.strCountry ?? null,
      abbreviation: record.strTeamShort ?? null,
      logoUrl: record.strTeamBadge ?? record.strTeamLogo ?? null,
      lastSyncedAt: new Date(),
    },
  });
  logStatus(`team synced ${record.strTeam} (${record.idTeam})`, context.onStatus);
}

async function syncPlayer(record: SportsDbPlayerRecord, metadata: { leagueCode: string; sportName: string; teamId?: string | null; enableStats: boolean; onStatus?: (msg: string) => void }) {
  const aliases = collectPlayerAliases(record);
  const birthDate = toDate(record.dateBorn);
  const image = pickPlayerImage(record);

  await prisma.sportsDbPlayer.upsert({
    where: { id: record.idPlayer },
    create: {
      id: record.idPlayer,
      fullName: toTitleCase(record.strPlayer),
      displayName: toTitleCase(record.strPlayer),
      alternateNames: aliases,
      sport: record.strSport ?? metadata.sportName,
      league: record.strTeam ?? metadata.leagueCode,
      nationality: record.strNationality ?? null,
      position: record.strPosition ?? null,
      birthDate,
      teamId: metadata.teamId ?? record.idTeam ?? null,
      headshotUrl: image,
      lastSyncedAt: new Date(),
    },
    update: {
      fullName: toTitleCase(record.strPlayer),
      displayName: toTitleCase(record.strPlayer),
      alternateNames: aliases,
      sport: record.strSport ?? metadata.sportName,
      league: record.strTeam ?? metadata.leagueCode,
      nationality: record.strNationality ?? null,
      position: record.strPosition ?? null,
      birthDate,
      teamId: metadata.teamId ?? record.idTeam ?? null,
      headshotUrl: image,
      lastSyncedAt: new Date(),
    },
  });

  logStatus(`player synced ${record.strPlayer} (${record.idPlayer})`, metadata.onStatus);

  if (!metadata.enableStats) {
    return;
  }

  const stats = await fetchPlayerSeasonStats(record.idPlayer);
  if (stats.length === 0) {
    return;
  }

  const syncTimestamp = new Date();
  const limitedStats = stats.slice(0, 20);
  for (let index = 0; index < limitedStats.length; index += 1) {
    const season = limitedStats[index];
    const seasonId = deriveSeasonIdentifier(
      season,
      `${metadata.leagueCode || "UNKNOWN"}-result-${index}`
    );
    try {
      await prisma.sportsDbPlayerSeason.upsert({
        where: {
          playerId_season_league: {
            playerId: record.idPlayer,
            season: seasonId,
            league: season.strLeague ?? metadata.leagueCode,
          },
        },
        create: {
          playerId: record.idPlayer,
          season: seasonId,
          league: season.strLeague ?? metadata.leagueCode,
          statsJson: season as unknown as Prisma.InputJsonValue,
          lastSyncedAt: syncTimestamp,
        },
        update: {
          statsJson: season as unknown as Prisma.InputJsonValue,
          lastSyncedAt: syncTimestamp,
        },
      });
    } catch (error) {
      console.warn(`[sportsdb] failed to upsert stats for ${record.idPlayer} season ${seasonId}`, error);
    }
  }
}

export async function syncSportsDb(options: SyncSportsDbOptions = {}): Promise<void> {
  if (!config.sportsDbApiKey) {
    console.warn("[sportsdb] Skipping sync because SPORTSDB_API_KEY is not configured.");
    return;
  }

  const leagues = options.leagues ?? DEFAULT_LEAGUES;
  const enableStats = options.enableStats ?? true;
  for (const league of leagues) {
    for (const leagueId of league.leagueIds) {
      logStatus(`syncing league ${league.code} (${leagueId})`, options.onStatus);
      const teams = await fetchTeamsByLeague(leagueId);
      for (const team of teams) {
        await syncTeam(team, {
          leagueCode: league.code,
          sportName: league.sport,
          onStatus: options.onStatus,
        });
      }

      for (const team of teams) {
        const players = await fetchTeamPlayers(team.idTeam);
        for (const player of players) {
          await syncPlayer(player, {
            leagueCode: league.code,
            sportName: league.sport,
            teamId: team.idTeam,
            enableStats,
            onStatus: options.onStatus,
          });
        }
      }
    }
  }
}

export async function upsertPlayerOnDemand(name: string): Promise<void> {
  if (!config.sportsDbApiKey) {
    console.warn("[sportsdb] Cannot search player without API key");
    return;
  }
  const matches = await searchPlayerByName(name);
  for (const match of matches) {
    const details = await fetchPlayerDetails(match.idPlayer);
    if (!details) {
      continue;
    }
    await syncPlayer(details, {
      leagueCode: details.strTeam ?? details.strSport ?? "UNKNOWN",
      sportName: details.strSport ?? "UNKNOWN",
      teamId: details.idTeam ?? null,
      enableStats: false,
      onStatus: undefined,
    });
  }
}
