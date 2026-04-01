const PLAYER_NAME_SUFFIX_ALIASES: Record<string, string> = {
  jr: "jr",
  junior: "jr",
  sr: "sr",
  senior: "sr",
  ii: "ii",
  iii: "iii",
  iv: "iv",
  v: "v",
};

const PLAYER_NAME_SUFFIXES = new Set(Object.values(PLAYER_NAME_SUFFIX_ALIASES));

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeIdentityText(value: string | null | undefined) {
  return compactWhitespace(
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[’'`]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
  );
}

function normalizePlayerNameTokens(value: string | null | undefined) {
  return normalizeIdentityText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => PLAYER_NAME_SUFFIX_ALIASES[token] ?? token);
}

export function normalizeCardIdentityPlayerName(value: string | null | undefined): string {
  return normalizePlayerNameTokens(value).join(" ");
}

export function normalizeCardIdentityPlayerNameBase(value: string | null | undefined): string {
  const tokens = normalizePlayerNameTokens(value);
  while (tokens.length > 0 && PLAYER_NAME_SUFFIXES.has(tokens[tokens.length - 1] ?? "")) {
    tokens.pop();
  }
  return tokens.join(" ");
}
