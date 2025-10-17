import { config } from "../config";
import {
  SportsDbPlayerListResponse,
  SportsDbPlayerRecord,
  SportsDbPlayerResponse,
  SportsDbPlayerResultRecord,
  SportsDbPlayerResultResponse,
  SportsDbTeamRecord,
  SportsDbTeamResponse,
} from "./types";

function buildUrl(endpoint: string, params?: Record<string, string | number | undefined>): string {
  const trimmedBase = (config.sportsDbBaseUrl ?? "https://www.thesportsdb.com/api/v2/json").replace(/\/$/, "");
  const normalizedEndpoint = endpoint.replace(/^\/+/, "");
  const url = new URL(`${trimmedBase}/${normalizedEndpoint}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function sportsDbFetch<T>(endpoint: string, params?: Record<string, string | number | undefined>): Promise<T | null> {
  if (!config.sportsDbApiKey) {
    console.warn("[sportsdb] API key not configured; skipping request", endpoint);
    return null;
  }

  const url = buildUrl(endpoint, params);
  const headers: Record<string, string> = {
    "User-Agent": "tenkings-processing-service/1.0",
    "X-API-KEY": config.sportsDbApiKey,
  };

  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    const body = await response.text();
    console.warn(`[sportsdb] request failed ${response.status} ${response.statusText}: ${body}`);
    return null;
  }
  const json = (await response.json()) as T;
  return json;
}

export async function fetchTeamsByLeague(leagueId: string): Promise<SportsDbTeamRecord[]> {
  const data = await sportsDbFetch<SportsDbTeamResponse>(`list/teams/${leagueId}`);
  if (!data?.teams) {
    return [];
  }
  return data.teams.filter((team): team is SportsDbTeamRecord => Boolean(team?.idTeam && team?.strTeam));
}

export async function fetchTeamPlayers(teamId: string): Promise<SportsDbPlayerRecord[]> {
  const data = await sportsDbFetch<SportsDbPlayerListResponse>(`list/players/${teamId}`);
  if (!data?.players) {
    return [];
  }
  return data.players.filter((player): player is SportsDbPlayerRecord => Boolean(player?.idPlayer && player?.strPlayer));
}

function toPlayerSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

export async function searchPlayerByName(name: string): Promise<SportsDbPlayerRecord[]> {
  const slug = toPlayerSlug(name);
  if (!slug) {
    return [];
  }
  const data = await sportsDbFetch<SportsDbPlayerListResponse>(`search/player/${encodeURIComponent(slug)}`);
  if (!data?.players) {
    return [];
  }
  return data.players.filter((player): player is SportsDbPlayerRecord => Boolean(player?.idPlayer && player?.strPlayer));
}

export async function fetchPlayerDetails(playerId: string): Promise<SportsDbPlayerRecord | null> {
  const data = await sportsDbFetch<SportsDbPlayerResponse>(`lookup/player/${playerId}`);
  const player = data?.players?.[0];
  if (!player?.idPlayer) {
    return null;
  }
  return player;
}

export async function fetchPlayerSeasonStats(playerId: string): Promise<SportsDbPlayerResultRecord[]> {
  const data = await sportsDbFetch<SportsDbPlayerResultResponse>(`lookup/player_results/${playerId}`);
  if (!data?.results) {
    return [];
  }
  return data.results.slice(0, 50);
}
