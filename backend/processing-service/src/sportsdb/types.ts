export interface SportsDbTeamRecord {
  idTeam: string;
  strTeam: string;
  strTeamShort?: string | null;
  strAlternate?: string | null;
  strKeywords?: string | null;
  strSport?: string | null;
  strLeague?: string | null;
  strDivision?: string | null;
  strCountry?: string | null;
  strStadium?: string | null;
  strTeamBadge?: string | null;
  strTeamLogo?: string | null;
}

export interface SportsDbPlayerRecord {
  idPlayer: string;
  idTeam?: string | null;
  strPlayer: string;
  strPlayerAlternate?: string | null;
  strSport?: string | null;
  strTeam?: string | null;
  strTeam2?: string | null;
  dateBorn?: string | null;
  strBirthLocation?: string | null;
  strNationality?: string | null;
  strPosition?: string | null;
  strStatus?: string | null;
  strHeight?: string | null;
  strWeight?: string | null;
  strThumb?: string | null;
  strCutout?: string | null;
  strRender?: string | null;
}

export interface SportsDbPlayerResultRecord {
  idPlayer?: string | null;
  idTeam?: string | null;
  intSeason?: string | null;
  strSeason?: string | null;
  strLeague?: string | null;
  strResult?: string | null;
  intPoints?: string | null;
  intGoals?: string | null;
  intAssists?: string | null;
  [key: string]: string | null | undefined;
}

export interface SportsDbErrorResponse {
  error?: {
    message?: string;
  } | null;
}

export interface SportsDbTeamResponse extends SportsDbErrorResponse {
  teams?: SportsDbTeamRecord[] | null;
}

export interface SportsDbPlayerResponse extends SportsDbErrorResponse {
  players?: SportsDbPlayerRecord[] | null;
}

export interface SportsDbPlayerListResponse extends SportsDbErrorResponse {
  players?: SportsDbPlayerRecord[] | null;
}

export interface SportsDbPlayerResultResponse extends SportsDbErrorResponse {
  results?: SportsDbPlayerResultRecord[] | null;
}

export type SportsDbLeaguesConfig = Array<{
  code: string;
  sport: string;
  leagueIds: string[];
}>;
