export interface SetOpsDuplicateKeyInput {
  setId: string | null | undefined;
  cardNumber: string | null | undefined;
  parallel: string | null | undefined;
  playerSeed?: string | null | undefined;
  listingId?: string | null | undefined;
}

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&apos;": "'",
  "&quot;": '"',
  "&nbsp;": " ",
  "&ndash;": "-",
  "&mdash;": "-",
};

function decodeNumericEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, numeric: string) => {
      const code = Number.parseInt(numeric, 10);
      if (!Number.isFinite(code)) return _;
      try {
        return String.fromCodePoint(code);
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code)) return _;
      try {
        return String.fromCodePoint(code);
      } catch {
        return _;
      }
    });
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function decodeHtmlEntities(value: string | null | undefined): string {
  if (value == null) return "";
  let decoded = String(value);
  decoded = decodeNumericEntities(decoded);
  for (const [entity, replacement] of Object.entries(NAMED_ENTITIES)) {
    decoded = decoded.replace(new RegExp(entity, "gi"), replacement);
  }
  decoded = decoded.replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[’]/g, "'");
  return collapseWhitespace(decoded);
}

function parseParallelNameObject(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => decodeHtmlEntities(String(entry ?? ""))).filter(Boolean);
    }
    if (!parsed || typeof parsed !== "object") {
      return [];
    }
    const named = (parsed as { name?: unknown }).name;
    if (Array.isArray(named)) {
      return named.map((entry) => decodeHtmlEntities(String(entry ?? ""))).filter(Boolean);
    }
    if (typeof named === "string") {
      const normalized = decodeHtmlEntities(named);
      return normalized ? [normalized] : [];
    }
    return [];
  } catch {
    return [];
  }
}

export function normalizeSetLabel(value: string | null | undefined): string {
  return decodeHtmlEntities(value);
}

export function normalizeParallelLabel(value: string | null | undefined): string {
  const decoded = decodeHtmlEntities(value);
  if (!decoded) return "";

  const parsedNames = parseParallelNameObject(decoded);
  if (parsedNames.length) {
    return parsedNames.join(" / ");
  }

  return decoded;
}

export function normalizeCardNumber(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const compact = raw.replace(/^#\s*/, "").replace(/\s+/g, "");
  const upper = compact.toUpperCase();
  if (!upper) return null;
  if (upper === "ALL") return "ALL";
  if (upper === "NULL" || upper === "N/A" || upper === "NA" || upper === "NONE" || upper === "-" || upper === "--") {
    return null;
  }
  return upper;
}

export function normalizePlayerSeed(value: string | null | undefined): string {
  return decodeHtmlEntities(value);
}

export function normalizeListingId(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const directDigits = raw.match(/^\d{8,20}$/);
  if (directDigits) return directDigits[0];

  const fromPath = raw.match(/\/itm\/(?:[^/?#]+\/)?(\d{8,20})(?:[/?#]|$)/i);
  if (fromPath?.[1]) return fromPath[1];

  const fromQuery = raw.match(/[?&](?:item|itemId|itm|itm_id)=(\d{8,20})(?:[&#]|$)/i);
  if (fromQuery?.[1]) return fromQuery[1];

  return raw;
}

export function buildSetOpsDuplicateKey(input: SetOpsDuplicateKeyInput): string {
  const setId = normalizeSetLabel(input.setId).toLowerCase();
  const cardNumber = (normalizeCardNumber(input.cardNumber) ?? "NULL").toLowerCase();
  const parallel = normalizeParallelLabel(input.parallel).toLowerCase();
  const playerSeed = normalizePlayerSeed(input.playerSeed ?? null).toLowerCase() || "none";
  const listingId = (normalizeListingId(input.listingId ?? null) ?? "none").toLowerCase();
  return [setId, cardNumber, parallel, playerSeed, listingId].join("::");
}
