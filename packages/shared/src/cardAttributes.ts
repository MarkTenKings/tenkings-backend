export interface CardAttributes {
  playerName: string | null;
  teamName: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  variantKeywords: string[];
  serialNumber: string | null;
  rookie: boolean;
  autograph: boolean;
  memorabilia: boolean;
  gradeCompany: string | null;
  gradeValue: string | null;
}

export interface AttributeExtractionOptions {
  bestMatch?: Record<string, unknown> | null | undefined;
}

export const VARIANT_KEYWORDS = [
  "NEON",
  "ORANGE",
  "GOLD",
  "GREEN",
  "BLUE",
  "PURPLE",
  "SILVER",
  "HOLO",
  "HOLOFOIL",
  "REFRACTOR",
  "PRIZM",
  "PRISM",
  "PULSAR",
  "CRACKED",
  "ICE",
  "PATCH",
  "AUTO",
  "AUTOGRAPH",
  "SIGNATURE",
  "NUMBERED",
  "KABOOM",
  "DOWNTOWN",
  "CHECKERBOARD",
  "MOJO",
  "SCOPE",
  "VELOCITY",
  "LASER",
  "SHIMMER",
  "WAVE",
  "HYPER",
  "FLASH",
  "PINK",
  "RED",
  "BLACK",
  "WHITE",
  "YELLOW",
  "TEAL",
  "BRONZE",
  "TIGER",
  "ELEPHANT",
  "CAMO",
  "RAINBOW",
  "FIREWORKS",
  "COLOR BLAST",
  "SNAKESKIN",
  "RATED ROOKIE",
  "FIELD LEVEL",
  "COURTSIDE",
  "CONCOURSE",
];

const PLAYER_SUFFIX_ALLOW = new Set(["JR", "SR", "II", "III", "IV", "V"]);

const PLAYER_STOPWORDS = new Set(
  [
    "SELECT",
    "PANINI",
    "PRIZM",
    "PRISM",
    "BOWMAN",
    "TOPPS",
    "HOOPS",
    "CHRONICLES",
    "MOSAIC",
    "OPTIC",
    "DONRUSS",
    "UPPER",
    "DECK",
    "STADIUM",
    "CLUB",
    "FLEER",
    "ROOKIE",
    "CARD",
    "RC",
    "AUTHENTIC",
    "MEMORABILIA",
    "PATCH",
    "AUTO",
    "AUTOGRAPH",
    "SIGNATURE",
    "SILVER",
    "GREEN",
    "BLUE",
    "RED",
    "GOLD",
    "PURPLE",
    "ORANGE",
    "BLACK",
    "WHITE",
    "YELLOW",
    "PINK",
    "TEAL",
    "BRONZE",
    "RAINBOW",
    "ICE",
    "CRACKED",
    "SCOPE",
    "VELOCITY",
    "LASER",
    "SHIMMER",
    "WAVE",
    "HYPER",
    "FLASH",
    "MOJO",
    "SNAKESKIN",
    "SELECT",
    "PRIZM",
    "PRISM",
    "MOSAIC",
    "CHROME",
    "REFRACTOR",
    "CRUSADE",
    "OBSIDIAN",
    "REVOLUTION",
    "NATIONAL",
    "TREASURES",
    "COURT",
    "KINGS",
    "GALA",
    "NOIR",
    "ORIGINS",
    "FINEST",
    "ELITE",
    "CERTIFIED",
    "IMMACULATE",
    "IMPECCABLE",
    "CONTENDERS",
    "FLAWLESS",
    "SPECTRA",
    "ZENITH",
    "SIGNATURES",
    "ILLUSIONS",
    "STATUS",
    "DOMINION",
    "BLACK",
    "LEGACY",
    "LEGENDS",
    "BASKETBALL",
    "FOOTBALL",
    "BASEBALL",
    "HOCKEY",
    "SOCCER",
    "WILSON",
    "BASE",
    "INSERT",
    "SERIES",
    "EDITION",
    "TICKET",
    "SEASON",
    "GAME",
    "USED",
    "PLAYER",
    "TEAM",
  ].map((word) => word.toUpperCase())
);

const TEAM_WORDS = new Set(
  [
    "WARRIORS",
    "LAKERS",
    "CLIPPERS",
    "SUNS",
    "KINGS",
    "BULLS",
    "CELTICS",
    "KNICKS",
    "NETS",
    "HEAT",
    "BUCKS",
    "PISTONS",
    "PACERS",
    "CAVALIERS",
    "HAWKS",
    "HORNETS",
    "MAGIC",
    "SPURS",
    "ROCKETS",
    "MAVERICKS",
    "NUGGETS",
    "TIMBERWOLVES",
    "THUNDER",
    "BLAZERS",
    "JAZZ",
    "GRIZZLIES",
    "RAPTORS",
    "SIXERS",
    "76ERS",
    "WIZARDS",
    "YANKEES",
    "DODGERS",
    "GIANTS",
    "METS",
    "CARDINALS",
    "BRAVES",
    "PADRES",
    "MARINERS",
    "PHILLIES",
    "REDS",
    "PIRATES",
    "CUBS",
    "TIGERS",
    "ASTROS",
    "ANGELS",
    "ROYALS",
    "RAIDERS",
    "PACKERS",
    "BRONCOS",
    "SEAHAWKS",
    "PATRIOTS",
    "STEELERS",
    "COWBOYS",
    "CHIEFS",
    "BENGALS",
    "BROWNS",
    "RAVENS",
    "JETS",
    "JAGUARS",
    "TITANS",
    "VIKINGS",
    "SAINTS",
    "FALCONS",
    "PANTHERS",
    "BUCS",
    "BUCCANEERS",
    "OILERS",
    "FLAMES",
    "CANUCKS",
    "SENATORS",
    "SHARKS",
    "BLUES",
    "COYOTES",
    "SABRES",
    "DEVILS",
    "CAPITALS",
    "LIGHTNING",
    "RANGERS",
    "AVALANCHE",
    "PREDATORS",
    "FLYERS",
    "BRUINS",
    "MAPLE",
    "LEAFS",
    "UNITED",
    "CITY",
    "REAL",
    "BAYERN",
    "BARCELONA",
    "MADRID",
  ].map((word) => word.toUpperCase())
);

const BRAND_KEYWORDS = [
  { keyword: "PANINI", label: "Panini" },
  { keyword: "TOPPS", label: "Topps" },
  { keyword: "BOWMAN", label: "Bowman" },
  { keyword: "UPPER DECK", label: "Upper Deck" },
  { keyword: "LEAF", label: "Leaf" },
  { keyword: "FLEER", label: "Fleer" },
  { keyword: "DONRUSS", label: "Donruss" },
  { keyword: "SKYBOX", label: "SkyBox" },
  { keyword: "PLAYOFF", label: "Playoff" },
  { keyword: "SAGE", label: "SAGE" },
  { keyword: "PRESS PASS", label: "Press Pass" },
  { keyword: "IMMACULATE", label: "Panini" },
  { keyword: "NATIONAL TREASURES", label: "Panini" },
  { keyword: "PRIZM", label: "Panini" },
  { keyword: "SELECT", label: "Panini" },
  { keyword: "MOSAIC", label: "Panini" },
  { keyword: "OPTIC", label: "Donruss" },
  { keyword: "CHRONICLES", label: "Panini" },
  { keyword: "SPECTRA", label: "Panini" },
  { keyword: "REVOLUTION", label: "Panini" },
  { keyword: "FLAWLESS", label: "Panini" },
  { keyword: "IMPECCABLE", label: "Panini" },
  { keyword: "ORIGINS", label: "Panini" },
  { keyword: "COURT KINGS", label: "Panini" },
  { keyword: "NOIR", label: "Panini" },
  { keyword: "ZENITH", label: "Panini" },
  { keyword: "CERTIFIED", label: "Panini" },
  { keyword: "ELITE", label: "Panini" },
  { keyword: "BLACK", label: "Panini" },
];

const SET_KEYWORDS = [
  { keyword: "NATIONAL TREASURES", label: "National Treasures" },
  { keyword: "IMMACULATE", label: "Immaculate" },
  { keyword: "IMPECCABLE", label: "Impeccable" },
  { keyword: "PRIZM", label: "Prizm" },
  { keyword: "PRISM", label: "Prism" },
  { keyword: "SELECT", label: "Select" },
  { keyword: "MOSAIC", label: "Mosaic" },
  { keyword: "CHRONICLES", label: "Chronicles" },
  { keyword: "OPTIC", label: "Optic" },
  { keyword: "DONRUSS OPTIC", label: "Donruss Optic" },
  { keyword: "COURT KINGS", label: "Court Kings" },
  { keyword: "ORIGINS", label: "Origins" },
  { keyword: "NOIR", label: "Noir" },
  { keyword: "SPECTRA", label: "Spectra" },
  { keyword: "REVOLUTION", label: "Revolution" },
  { keyword: "FLAWLESS", label: "Flawless" },
  { keyword: "ZENITH", label: "Zenith" },
  { keyword: "CERTIFIED", label: "Certified" },
  { keyword: "ELITE", label: "Elite" },
  { keyword: "BLACK", label: "Black" },
  { keyword: "CONTENDERS", label: "Contenders" },
  { keyword: "TICKET", label: "Contenders" },
  { keyword: "FINEST", label: "Finest" },
  { keyword: "TOPPS CHROME", label: "Topps Chrome" },
  { keyword: "BOWMAN CHROME", label: "Bowman Chrome" },
  { keyword: "SP AUTHENTIC", label: "SP Authentic" },
  { keyword: "EXQUISITE", label: "Exquisite" },
  { keyword: "ILLUSIONS", label: "Illusions" },
  { keyword: "STATUS", label: "Status" },
  { keyword: "DONRUSS", label: "Donruss" },
];

function toTitleCaseWord(word: string): string {
  const lower = word.toLowerCase();
  return lower.replace(/(^|[' -])(\p{L})/gu, (_, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

function formatTitle(tokens: string[]): string {
  return tokens.map(toTitleCaseWord).join(" ");
}

function isLikelyNameToken(token: string): boolean {
  const upper = token.toUpperCase();
  if (PLAYER_STOPWORDS.has(upper) || TEAM_WORDS.has(upper)) {
    return false;
  }
  if (!/^[A-Z][A-Z' -]*$/.test(upper)) {
    return false;
  }
  if (upper.length <= 2 && !PLAYER_SUFFIX_ALLOW.has(upper)) {
    return false;
  }
  return true;
}

function extractPlayerName(lines: string[]): string | null {
  const tokens: Array<{ original: string; upper: string }> = [];
  for (const line of lines) {
    const pieces = line.split(/[^A-Za-z']+/).filter((piece) => piece.length > 0);
    for (const piece of pieces) {
      tokens.push({ original: piece, upper: piece.toUpperCase() });
    }
  }

  if (tokens.length === 0) {
    return null;
  }

  let best: string[] | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const sequence: string[] = [];
    let consumed = 0;
    for (let j = i; j < tokens.length && consumed < 3; j += 1) {
      const token = tokens[j];
      const isSuffix = PLAYER_SUFFIX_ALLOW.has(token.upper);
      if (!isSuffix && !isLikelyNameToken(token.original)) {
        break;
      }
      sequence.push(token.original);
      consumed += 1;
      if (!isSuffix && sequence.length >= 2) {
        break;
      }
    }

    const meaningfulTokens = sequence.filter((token) => !PLAYER_SUFFIX_ALLOW.has(token.toUpperCase()));
    if (meaningfulTokens.length >= 2) {
      if (!best || meaningfulTokens.length > best.length) {
        best = sequence;
      }
    }
  }

  if (best) {
    return formatTitle(best);
  }
  return null;
}

function extractTeamName(lines: string[]): string | null {
  for (const line of lines) {
    const tokens = line.split(/[^A-Za-z']+/).filter((piece) => piece.length > 0);
    const matches = tokens.filter((token) => TEAM_WORDS.has(token.toUpperCase()));
    if (matches.length > 0) {
      return formatTitle(matches);
    }
  }
  return null;
}

function deriveBestMatchValue(match: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!match) {
    return null;
  }
  const value = match[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function extractYear(text: string): string | null {
  const match = /(19|20)\d{2}/.exec(text);
  return match ? match[0] : null;
}

function extractBrand(lines: string[]): string | null {
  for (const { keyword, label } of BRAND_KEYWORDS) {
    const target = keyword.toUpperCase();
    if (lines.some((line) => line.toUpperCase().includes(target))) {
      return label;
    }
  }
  return null;
}

function extractSet(lines: string[]): string | null {
  for (const { keyword, label } of SET_KEYWORDS) {
    const target = keyword.toUpperCase();
    if (lines.some((line) => line.toUpperCase().includes(target))) {
      return label;
    }
  }
  return null;
}

function extractVariantKeywords(lines: string[]): string[] {
  const found = new Set<string>();
  for (const line of lines) {
    const upper = line.toUpperCase();
    for (const keyword of VARIANT_KEYWORDS) {
      if (upper.includes(keyword)) {
        found.add(keyword);
      }
    }
  }
  return Array.from(found).map((keyword) => formatTitle(keyword.split(" ")));
}

function extractSerial(text: string): string | null {
  const match = /#?\s*(\d{1,3})\s*\/\s*(\d{1,4})/i.exec(text);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  const ofMatch = /(\d{1,3})\s+OF\s+(\d{1,4})/i.exec(text);
  if (ofMatch) {
    return `${ofMatch[1]}/${ofMatch[2]}`;
  }
  return null;
}

function extractGrade(text: string | null | undefined): { company: string | null; value: string | null } {
  if (!text) {
    return { company: null, value: null };
  }
  const match = /(PSA|BGS|SGC)\s*-?\s*(10|9\.5|9|8\.5|8|7\.5|7|6|5|4|3|2|1)/i.exec(text);
  if (!match) {
    return { company: null, value: null };
  }
  const company = match[1].toUpperCase();
  const value = match[2];
  return { company, value: value.toUpperCase() };
}

function hasToken(lines: string[], token: string): boolean {
  const target = token.toUpperCase();
  return lines.some((line) => line.toUpperCase().includes(target));
}

function hasRookieIndicator(lines: string[]): boolean {
  if (hasToken(lines, "ROOKIE")) {
    return true;
  }
  for (const line of lines) {
    const parts = line.split(/[^A-Za-z0-9]+/);
    if (parts.some((part) => part.toUpperCase() === "RC")) {
      return true;
    }
  }
  return false;
}

function hasAutographIndicator(lines: string[]): boolean {
  return hasToken(lines, "AUTOGRAPH") || hasToken(lines, "AUTO") || hasToken(lines, "SIGNATURE");
}

function hasMemorabiliaIndicator(lines: string[]): boolean {
  return (
    hasToken(lines, "PATCH") ||
    hasToken(lines, "JERSEY") ||
    hasToken(lines, "RELIC") ||
    hasToken(lines, "MEM") ||
    hasToken(lines, "SWATCH") ||
    hasToken(lines, "NAPKIN") ||
    hasToken(lines, "GAME USED")
  );
}

export function extractCardAttributes(
  ocrText: string | null | undefined,
  options: AttributeExtractionOptions = {}
): CardAttributes {
  const rawText = (ocrText ?? "").trim();
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const bestMatch = options.bestMatch ?? null;

  const playerFromMatch =
    deriveBestMatchValue(bestMatch, "full_name") ?? deriveBestMatchValue(bestMatch, "name");
  const playerName = playerFromMatch ?? extractPlayerName(lines);

  const teamFromMatch =
    deriveBestMatchValue(bestMatch, "team") ?? deriveBestMatchValue(bestMatch, "club");
  const teamName = teamFromMatch ?? extractTeamName(lines);

  const brand = extractBrand(lines);
  const setName = extractSet(lines);
  const variantKeywords = extractVariantKeywords(lines);
  const serialNumber = extractSerial(rawText);
  const { company: gradeCompany, value: gradeValue } = extractGrade(rawText);

  return {
    playerName,
    teamName,
    year: extractYear(rawText),
    brand,
    setName,
    variantKeywords,
    serialNumber,
    rookie: hasRookieIndicator(lines),
    autograph: hasAutographIndicator(lines),
    memorabilia: hasMemorabiliaIndicator(lines),
    gradeCompany,
    gradeValue,
  };
}
