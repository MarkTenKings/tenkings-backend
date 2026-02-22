import { SetDatasetType, SetIngestionJobStatus, prisma, type Prisma } from "@tenkings/database";
import { decodeHtmlEntities, normalizeSetLabel } from "@tenkings/shared";
import { inflateSync } from "node:zlib";

export type SetOpsDiscoveryQuery = {
  year?: number | null;
  manufacturer?: string | null;
  sport?: string | null;
  query?: string | null;
  limit?: number | null;
};

export type SetOpsDiscoveryResult = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  provider: string;
  domain: string;
  setIdGuess: string;
  score: number;
  discoveredAt: string;
};

type SourceFetchResult = {
  rows: Array<Record<string, unknown>>;
  parserName: string;
  contentType: string | null;
  fetchedAt: string;
  attempts: number;
};

type NormalizedDiscoveryQuery = {
  year: number | null;
  manufacturer: string;
  sport: string;
  query: string;
  limit: number;
};

type DiscoverySearchVariant = {
  name: string;
  searchText: string;
  requiredDomainSuffixes?: string[];
};

const hostLastRequestAt = new Map<string, number>();
const nowYear = new Date().getFullYear();
const preferredDiscoveryDomains = [
  "tcdb.com",
  "tradingcarddb.com",
  "cardboardconnection.com",
  "beckett.com",
  "sportscardspro.com",
  "breakninja.com",
  "baseballcardpedia.com",
];
const blockedDiscoveryDomains = [
  "weforum.org",
  "wikipedia.org",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "reddit.com",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactWhitespace(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeTitle(value: string) {
  return compactWhitespace(decodeHtmlEntities(value))
    .replace(/\s*[-|]\s*Trading Card Database.*$/i, "")
    .replace(/\s*[-|]\s*Checklist.*$/i, "")
    .replace(/\s*Checklist\s*$/i, "")
    .replace(/\s*Trading Cards?\s*$/i, "")
    .trim();
}

function parsePositiveInt(input: unknown, fallback: number, min: number, max: number) {
  const value = Number(input);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function decodeSearchResultUrl(rawUrl: string) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const target = parsed.searchParams.get("uddg");
      if (target) {
        return decodeURIComponent(target);
      }
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function providerFromDomain(domain: string) {
  if (!domain) return "unknown";
  if (domain.includes("tcdb.com")) return "TCDB";
  if (domain.includes("beckett.com")) return "Beckett";
  if (domain.includes("cardboardconnection.com")) return "Cardboard Connection";
  if (domain.includes("sportscollectorsdaily.com")) return "Sports Collectors Daily";
  if (domain.includes("ebay.com")) return "eBay";
  return domain;
}

function domainMatchesSuffix(domain: string, suffix: string) {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

function includesAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value.toLowerCase()));
}

function sportTokens(sport: string) {
  const normalized = sport.toLowerCase().trim();
  const aliases: Record<string, string[]> = {
    basketball: ["basketball", "nba", "wnba", "hoops"],
    baseball: ["baseball", "mlb"],
    football: ["football", "nfl"],
    hockey: ["hockey", "nhl"],
    soccer: ["soccer", "futbol", "fifa"],
  };
  return aliases[normalized] ?? (normalized ? [normalized] : []);
}

function hasTradingCardSignal(text: string) {
  return /checklist|trading card|card set|set list|parallel|base set|rookie/i.test(text);
}

function hasChecklistSignal(text: string) {
  return /checklist|set list|complete set|variation guide|parallels/i.test(text);
}

function isLikelySearchResultsUrl(url: string) {
  const lower = String(url || "").toLowerCase();
  return (
    lower.includes("searchtext=") ||
    lower.includes("?s=") ||
    lower.includes("&s=") ||
    lower.includes("/search?") ||
    lower.includes("/search.cfm") ||
    lower.includes("/search/")
  );
}

function buildDiscoverySearchVariants(query: NormalizedDiscoveryQuery) {
  const baseText = buildDiscoverySearchText(query);
  const variants: DiscoverySearchVariant[] = [
    {
      name: "tcdb-site",
      searchText: `site:tcdb.com ${baseText}`,
      requiredDomainSuffixes: ["tcdb.com", "tradingcarddb.com"],
    },
    {
      name: "cardboardconnection-site",
      searchText: `site:cardboardconnection.com ${baseText}`,
      requiredDomainSuffixes: ["cardboardconnection.com"],
    },
    {
      name: "beckett-site",
      searchText: `site:beckett.com ${baseText}`,
      requiredDomainSuffixes: ["beckett.com"],
    },
    {
      name: "sportscardspro-site",
      searchText: `site:sportscardspro.com ${baseText}`,
      requiredDomainSuffixes: ["sportscardspro.com"],
    },
    {
      name: "broad-web",
      searchText: baseText,
    },
  ];
  return variants;
}

function isRelevantDiscoveryResult(params: {
  result: SetOpsDiscoveryResult;
  query: NormalizedDiscoveryQuery;
  requiredDomainSuffixes?: string[];
}) {
  const domain = params.result.domain.toLowerCase();
  const text = `${params.result.title} ${params.result.snippet}`.toLowerCase();
  const manufacturer = params.query.manufacturer.toLowerCase().trim();
  const year = params.query.year ? String(params.query.year) : "";
  const sportWords = sportTokens(params.query.sport);

  if (!domain) return false;
  if (blockedDiscoveryDomains.some((suffix) => domainMatchesSuffix(domain, suffix))) return false;

  if (params.requiredDomainSuffixes && params.requiredDomainSuffixes.length > 0) {
    const matchesRequiredDomain = params.requiredDomainSuffixes.some((suffix) => domainMatchesSuffix(domain, suffix));
    if (!matchesRequiredDomain) return false;
  }

  const trustedDomain = preferredDiscoveryDomains.some((suffix) => domainMatchesSuffix(domain, suffix));
  const hasManufacturer = !manufacturer || text.includes(manufacturer);
  const hasYear = !year || text.includes(year);
  const hasSport = sportWords.length === 0 || includesAny(text, sportWords);
  const checklistSignal = hasTradingCardSignal(text);
  const strictChecklistSignal = hasChecklistSignal(text);

  if (trustedDomain) {
    if (!checklistSignal && !hasManufacturer && !hasYear) return false;
    if (!strictChecklistSignal && !hasManufacturer && !hasYear) return false;
    if (!hasManufacturer && manufacturer) return false;
    if (!hasSport && sportWords.length > 0 && !checklistSignal) return false;
    return true;
  }

  if (!strictChecklistSignal) return false;
  if (!hasManufacturer && manufacturer) return false;
  if (!hasYear && year) return false;
  if (!hasSport && sportWords.length > 0) return false;

  return true;
}

function filterDiscoveryResults(params: {
  results: SetOpsDiscoveryResult[];
  query: NormalizedDiscoveryQuery;
  requiredDomainSuffixes?: string[];
}) {
  return params.results.filter((result) =>
    isRelevantDiscoveryResult({
      result,
      query: params.query,
      requiredDomainSuffixes: params.requiredDomainSuffixes,
    })
  );
}

function stripCdata(value: string) {
  const match = String(value || "").match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  return match ? match[1] : value;
}

function extractXmlTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return compactWhitespace(decodeHtmlEntities(stripCdata(match?.[1] || "")));
}

function parseStatusCodeFromError(error: unknown) {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/status\s+(\d{3})/i);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

function inferSetId(title: string, query: SetOpsDiscoveryQuery) {
  const cleaned = sanitizeTitle(title);
  if (!cleaned) return "";

  const year = query.year ? String(query.year) : "";
  const manufacturer = compactWhitespace(String(query.manufacturer || ""));
  if (!year && !manufacturer) return cleaned;

  const prefix = compactWhitespace(`${year} ${manufacturer}`.trim());
  if (!prefix) return cleaned;
  if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) return cleaned;
  return compactWhitespace(`${prefix} ${cleaned}`);
}

function rankResult(input: { title: string; snippet: string; domain: string; query: SetOpsDiscoveryQuery }) {
  const title = input.title.toLowerCase();
  const snippet = input.snippet.toLowerCase();
  const domain = input.domain.toLowerCase();
  const year = input.query.year ? String(input.query.year) : "";
  const manufacturer = String(input.query.manufacturer || "").toLowerCase().trim();
  const sport = String(input.query.sport || "").toLowerCase().trim();
  const freeQuery = String(input.query.query || "").toLowerCase().trim();

  let score = 0;
  if (preferredDiscoveryDomains.some((suffix) => domainMatchesSuffix(domain, suffix))) score += 30;
  if (blockedDiscoveryDomains.some((suffix) => domainMatchesSuffix(domain, suffix))) score -= 100;
  if (title.includes("checklist")) score += 25;
  if (snippet.includes("checklist")) score += 10;
  if (title.includes("trading card")) score += 8;
  if (hasTradingCardSignal(`${title} ${snippet}`)) score += 10;
  if (year && (title.includes(year) || snippet.includes(year))) score += 12;
  if (manufacturer && (title.includes(manufacturer) || snippet.includes(manufacturer))) score += 12;
  if (sport && (title.includes(sport) || snippet.includes(sport))) score += 8;
  if (freeQuery && (title.includes(freeQuery) || snippet.includes(freeQuery))) score += 8;
  if (domain.includes("tcdb.com")) score += 14;
  if (domain.includes("cardboardconnection.com")) score += 8;
  if (manufacturer && !title.includes(manufacturer) && !snippet.includes(manufacturer)) score -= 12;
  if (sport && !title.includes(sport) && !snippet.includes(sport)) score -= 8;
  return score;
}

async function respectHostRateLimit(url: string, minIntervalMs = 1200) {
  const domain = extractDomain(url);
  if (!domain) return;
  const now = Date.now();
  const previous = hostLastRequestAt.get(domain) ?? 0;
  const waitMs = minIntervalMs - (now - previous);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  hostLastRequestAt.set(domain, Date.now());
}

async function fetchWithRetry(url: string, attempts = 3): Promise<{ response: Response; attemptsUsed: number }> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await respectHostRateLimit(url, 1200);
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TenKingsSetOps/1.0; +https://collect.tenkings.co)",
          Accept: "application/pdf,text/markdown,application/json,text/csv,text/html;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`Source request failed with status ${response.status}`);
        }
        throw new Error(`Source request failed with status ${response.status}`);
      }

      return { response, attemptsUsed: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await sleep(Math.min(3000, 300 * Math.pow(2, attempt - 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Source request failed");
}

function parseCsvRows(csvText: string): Array<Record<string, unknown>> {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (text[i + 1] === "\n") {
        i += 1;
      }
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const normalizedRows = rows.filter((entry) => entry.some((value) => compactWhitespace(value) !== ""));
  if (normalizedRows.length <= 1) return [];

  const headers = normalizedRows[0].map((header, index) => compactWhitespace(header) || `column_${index + 1}`);
  return normalizedRows
    .slice(1)
    .map((values) => {
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        record[header] = compactWhitespace(values[index] ?? "");
      });
      return record;
    })
    .filter((record) => Object.values(record).some((value) => compactWhitespace(String(value)) !== ""));
}

function splitMarkdownRow(row: string) {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => compactWhitespace(cell));
}

function parseMarkdownTableRows(markdown: string): Array<Record<string, unknown>> {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const records: Array<Record<string, unknown>> = [];

  for (let index = 0; index < lines.length - 2; index += 1) {
    const headerLine = lines[index] || "";
    const separatorLine = lines[index + 1] || "";
    if (!headerLine.includes("|")) continue;
    if (!/^\s*\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(separatorLine)) continue;

    const headers = splitMarkdownRow(headerLine).map((header, headerIndex) => header || `column_${headerIndex + 1}`);
    let rowIndex = index + 2;
    let addedRows = 0;
    for (; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex] || "";
      if (!line.includes("|")) break;
      if (/^\s*\|?\s*:?-{2,}/.test(line)) break;
      const values = splitMarkdownRow(line);
      if (!values.some((value) => value !== "")) continue;
      const record: Record<string, unknown> = {};
      headers.forEach((header, headerPosition) => {
        record[header] = compactWhitespace(values[headerPosition] ?? "");
      });
      records.push(record);
      addedRows += 1;
    }
    if (addedRows > 0) {
      index = rowIndex - 1;
    }
  }

  return records;
}

function parseMarkdownChecklistRows(markdown: string): Array<Record<string, unknown>> {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const records: Array<Record<string, unknown>> = [];
  let currentHeading = "";

  for (const line of lines) {
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    if (headingMatch) {
      currentHeading = compactWhitespace(headingMatch[1] || "");
      continue;
    }

    const listMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (!listMatch) continue;
    const item = compactWhitespace(listMatch[1] || "");
    if (!item) continue;
    if (isLikelySearchResultsUrl(item)) continue;
    if (isLikelyNoiseCellValue(item)) continue;
    if ((item.match(/https?:\/\//gi) ?? []).length >= 1) continue;

    const section = currentHeading.toLowerCase();
    const sectionLooksRelevant = /checklist|parallel|variation|base set|insert/i.test(section);
    const itemLooksRelevant = TABLE_POSITIVE_TOKEN_RE.test(item.toLowerCase());
    if (!sectionLooksRelevant && !itemLooksRelevant) continue;

    const cardMatch = item.match(/^#?([A-Za-z0-9]+(?:[-./][A-Za-z0-9]+){0,2})\s+(.+)$/);
    if (cardMatch && looksLikeCardNumberValue(cardMatch[1] || "") && looksLikeLabelValue(cardMatch[2] || "")) {
      records.push({
        cardNumber: cardMatch[1],
        player: compactWhitespace(cardMatch[2] || ""),
      });
      continue;
    }

    const parallelMatch = item.match(/^([^:]{2,90}):\s*(.+)$/);
    if (parallelMatch && looksLikeLabelValue(parallelMatch[1] || "")) {
      records.push({
        parallel: compactWhitespace(parallelMatch[1] || ""),
        detail: compactWhitespace(parallelMatch[2] || ""),
      });
      continue;
    }
  }

  return records;
}

function parseMarkdownRows(markdown: string): Array<Record<string, unknown>> {
  const tableRows = parseMarkdownTableRows(markdown);
  if (tableRows.length > 0) return tableRows;
  return parseMarkdownChecklistRows(markdown);
}

function normalizeChecklistSectionName(raw: string) {
  const value = compactWhitespace(raw);
  if (!value) return "Base Set";
  return value
    .replace(/^\d+\.\s*/, "")
    .replace(/\s*checklist$/i, "")
    .trim();
}

function looksLikeChecklistSectionHeader(line: string) {
  const value = compactWhitespace(line);
  if (!value) return false;
  if (value.length < 3 || value.length > 100) return false;
  if (/^\d+$/.test(value)) return false;
  if (/^page\s+\d+/i.test(value)) return false;
  if (/^[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,8})+\s+[A-Za-z]/.test(value)) return false;
  const hasKeyword =
    /(insert|parallel|autograph|autos|relic|patch|variation|fo[i1]l|holo|mojo|ballers|topps|rookie|court|gems|kings|school|limit|chrome|rainbow|base|dribble|stardom|mvp)/i.test(
      value
    );
  if (!hasKeyword) return false;
  if (TABLE_NEGATIVE_TOKEN_RE.test(value.toLowerCase())) return false;
  return true;
}

type ChecklistCardEntry = {
  cardNumber: string;
  playerSeed: string;
};

function parseCardEntriesFromChecklistLine(line: string): ChecklistCardEntry[] {
  const compact = line.replace(/\s+/g, " ").trim();
  if (!compact) return [];

  const entries: ChecklistCardEntry[] = [];
  const pattern =
    /(?:^|\s)#?([A-Za-z0-9]+(?:[-./][A-Za-z0-9]+){0,2})\s+([A-Za-z][A-Za-z'.\- ]{1,90}?)(?=(?:\s+#?[A-Za-z0-9]+(?:[-./][A-Za-z0-9]+){0,2}\s+[A-Za-z])|$)/g;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(compact))) {
    const cardNumber = compactWhitespace(match[1] || "");
    const playerSeed = compactWhitespace((match[2] || "").replace(/\s+(RC|Rookie Card|SP|SSP)$/i, ""));
    if (!looksLikeCardNumberValue(cardNumber)) continue;
    if (!looksLikeLabelValue(playerSeed)) continue;
    entries.push({ cardNumber, playerSeed });
  }

  if (entries.length > 0) return entries;

  const bits = compact.split(" ");
  const maybeCard = compactWhitespace(bits[0] || "");
  if (!looksLikeCardNumberValue(maybeCard)) return [];
  const maybePlayer = compactWhitespace(bits.slice(1).join(" "));
  if (!looksLikeLabelValue(maybePlayer)) return [];
  return [{ cardNumber: maybeCard, playerSeed: maybePlayer }];
}

function parseChecklistRowsFromText(text: string): Array<Record<string, unknown>> {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line.replace(/\u00A0/g, " ")))
    .filter(Boolean);

  const rows: Array<Record<string, unknown>> = [];
  const dedupe = new Set<string>();
  let currentSection = "Base Set";

  for (const line of lines) {
    if (looksLikeChecklistSectionHeader(line)) {
      currentSection = normalizeChecklistSectionName(line);
      continue;
    }

    const entries = parseCardEntriesFromChecklistLine(line);
    if (entries.length === 0) continue;

    for (const entry of entries) {
      const duplicateKey = `${normalizeFieldKey(entry.cardNumber)}::${normalizeFieldKey(currentSection)}::${normalizeFieldKey(
        entry.playerSeed
      )}`;
      if (dedupe.has(duplicateKey)) continue;
      dedupe.add(duplicateKey);
      rows.push({
        cardNumber: entry.cardNumber,
        parallel: currentSection,
        playerSeed: entry.playerSeed,
        player: entry.playerSeed,
      });
    }
  }

  return rows;
}

function parsePdfLiteralString(content: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex + 1;
  let depth = 0;
  let output = "";

  while (index < content.length) {
    const char = content[index]!;

    if (char === "\\") {
      const next = content[index + 1];
      if (!next) {
        index += 1;
        continue;
      }

      if (/[0-7]/.test(next)) {
        let octal = next;
        if (/[0-7]/.test(content[index + 2] || "")) octal += content[index + 2];
        if (/[0-7]/.test(content[index + 3] || "")) octal += content[index + 3];
        output += String.fromCharCode(parseInt(octal, 8));
        index += octal.length + 1;
        continue;
      }

      if (next === "\r" || next === "\n") {
        index += 2;
        if (next === "\r" && content[index] === "\n") index += 1;
        continue;
      }

      const escapeMap: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        "\\": "\\",
        "(": "(",
        ")": ")",
      };
      output += escapeMap[next] ?? next;
      index += 2;
      continue;
    }

    if (char === "(") {
      depth += 1;
      output += char;
      index += 1;
      continue;
    }

    if (char === ")") {
      if (depth === 0) {
        return { value: output, nextIndex: index + 1 };
      }
      depth -= 1;
      output += char;
      index += 1;
      continue;
    }

    output += char;
    index += 1;
  }

  return { value: output, nextIndex: index };
}

function parsePdfHexString(content: string, startIndex: number): { value: string; nextIndex: number } {
  const end = content.indexOf(">", startIndex + 1);
  if (end < 0) return { value: "", nextIndex: content.length };
  const hex = content
    .slice(startIndex + 1, end)
    .replace(/[^0-9a-f]/gi, "");
  const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
  let output = "";
  for (let index = 0; index < padded.length; index += 2) {
    const code = Number.parseInt(padded.slice(index, index + 2), 16);
    if (!Number.isNaN(code)) output += String.fromCharCode(code);
  }
  return { value: output, nextIndex: end + 1 };
}

function parsePdfArrayString(content: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex + 1;
  let depth = 1;
  const chunks: string[] = [];

  while (index < content.length && depth > 0) {
    const char = content[index]!;
    if (char === "(") {
      const parsed = parsePdfLiteralString(content, index);
      const value = compactWhitespace(parsed.value);
      if (value) chunks.push(value);
      index = parsed.nextIndex;
      continue;
    }
    if (char === "<" && content[index + 1] !== "<") {
      const parsed = parsePdfHexString(content, index);
      const value = compactWhitespace(parsed.value);
      if (value) chunks.push(value);
      index = parsed.nextIndex;
      continue;
    }
    if (char === "[") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      index += 1;
      continue;
    }
    index += 1;
  }

  return { value: chunks.join(" "), nextIndex: index };
}

function readPdfOperator(content: string, startIndex: number): { operator: string; nextIndex: number } {
  const first = content[startIndex]!;
  if (first === "'" || first === '"') {
    return { operator: first, nextIndex: startIndex + 1 };
  }
  let index = startIndex;
  while (index < content.length && /[A-Za-z*]/.test(content[index]!)) {
    index += 1;
  }
  return {
    operator: content.slice(startIndex, index),
    nextIndex: index,
  };
}

function appendPdfLineValue(currentLine: string, value: string) {
  const cleaned = compactWhitespace(value);
  if (!cleaned) return currentLine;
  return currentLine ? `${currentLine} ${cleaned}` : cleaned;
}

function extractLinesFromPdfContentStream(content: string): string[] {
  const lines: string[] = [];
  let currentLine = "";
  let pendingText = "";
  let index = 0;

  const flushLine = () => {
    const cleaned = compactWhitespace(currentLine);
    if (cleaned) lines.push(cleaned);
    currentLine = "";
  };

  while (index < content.length) {
    const char = content[index]!;

    if (char === "%") {
      while (index < content.length && content[index] !== "\n") index += 1;
      continue;
    }

    if (char === "(") {
      const parsed = parsePdfLiteralString(content, index);
      pendingText = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (char === "<" && content[index + 1] !== "<") {
      const parsed = parsePdfHexString(content, index);
      pendingText = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (char === "[") {
      const parsed = parsePdfArrayString(content, index);
      pendingText = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (char === "'" || char === '"' || /[A-Za-z]/.test(char)) {
      const parsed = readPdfOperator(content, index);
      const operator = parsed.operator;

      if (operator === "Tj" || operator === "TJ" || operator === "'" || operator === '"') {
        currentLine = appendPdfLineValue(currentLine, pendingText);
        pendingText = "";
        if (operator === "'" || operator === '"') flushLine();
      } else if (operator === "T*" || operator === "Td" || operator === "TD" || operator === "ET") {
        flushLine();
      }

      index = parsed.nextIndex;
      continue;
    }

    index += 1;
  }

  flushLine();
  return lines;
}

function extractChecklistTextFromPdfBuffer(buffer: Buffer): string {
  const pdf = buffer.toString("latin1");
  const lines: string[] = [];
  let cursor = 0;

  while (cursor < pdf.length) {
    const streamIndex = pdf.indexOf("stream", cursor);
    if (streamIndex < 0) break;

    let dataStart = streamIndex + 6;
    if (pdf[dataStart] === "\r" && pdf[dataStart + 1] === "\n") {
      dataStart += 2;
    } else if (pdf[dataStart] === "\n" || pdf[dataStart] === "\r") {
      dataStart += 1;
    }

    const streamEnd = pdf.indexOf("endstream", dataStart);
    if (streamEnd < 0) break;

    const dictionaryStart = pdf.lastIndexOf("<<", streamIndex);
    const dictionaryEnd = dictionaryStart >= 0 ? pdf.indexOf(">>", dictionaryStart) : -1;
    const dictionary =
      dictionaryStart >= 0 && dictionaryEnd >= 0 && dictionaryEnd < streamIndex
        ? pdf.slice(dictionaryStart, dictionaryEnd + 2)
        : pdf.slice(Math.max(0, streamIndex - 220), streamIndex);

    let chunk = buffer.subarray(dataStart, streamEnd);
    while (chunk.length > 0 && (chunk[chunk.length - 1] === 0x0a || chunk[chunk.length - 1] === 0x0d)) {
      chunk = chunk.subarray(0, chunk.length - 1);
    }

    let decoded: Buffer | null = chunk;
    if (/\/FlateDecode/i.test(dictionary)) {
      try {
        decoded = inflateSync(chunk);
      } catch {
        decoded = null;
      }
    }

    if (decoded && decoded.length > 0) {
      const streamLines = extractLinesFromPdfContentStream(decoded.toString("latin1"));
      lines.push(...streamLines);
    }

    cursor = streamEnd + "endstream".length;
  }

  return lines
    .map((line) => compactWhitespace(line))
    .filter((line) => line && !/^\d+$/.test(line))
    .join("\n");
}

function stripHtml(html: string) {
  return compactWhitespace(
    decodeHtmlEntities(
      String(html || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

const TABLE_HEADER_TOKEN_RE = /\b(card(?:\s*#| number)?|player|parallel|variation|set|checklist|team|name|no\.?)\b/i;
const TABLE_POSITIVE_TOKEN_RE = /\b(checklist|parallel|variation|refractor|rookie|auto(?:graph)?|insert)\b/i;
const TABLE_NEGATIVE_TOKEN_RE =
  /\b(ebay|buy now|auction|shipping|affiliate|sponsor|advertis|navbar|menu-item|dropdown|paszone|wppas)\b/i;
const HTML_NOISE_TOKEN_RE =
  /\b(googletagmanager|gtm\.js|dataLayer|menu-item|navbar|dropdown|paszone|wppas|cookie|min\.js)\b/i;
const HTML_ATTR_RE = /\b(class|href|src|style|data-[a-z-]+)\s*=/i;

function sanitizeHtmlForExtraction(html: string) {
  let sanitized = String(html || "");
  sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, " ");
  sanitized = sanitized.replace(/<(script|style|noscript|template|svg|iframe|canvas|object)\b[\s\S]*?<\/\1>/gi, " ");
  sanitized = sanitized.replace(/<(header|footer|nav|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  return sanitized;
}

function extractLikelyContentHtml(html: string) {
  const sanitized = sanitizeHtmlForExtraction(html);
  const bodyMatch = sanitized.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : sanitized;

  const candidates: string[] = [];
  candidates.push(...(body.match(/<article\b[\s\S]*?<\/article>/gi) ?? []));
  candidates.push(...(body.match(/<main\b[\s\S]*?<\/main>/gi) ?? []));
  candidates.push(
    ...(body.match(
      /<(div|section)\b[^>]*class=["'][^"']*(entry-content|post-content|article-content|single-content|content-area)[^"']*["'][\s\S]*?<\/\1>/gi
    ) ?? [])
  );

  if (candidates.length === 0) {
    return body;
  }

  let selected = candidates[0]!;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const text = stripHtml(candidate).toLowerCase();
    let score = Math.min(40, Math.floor(text.length / 500));
    if (TABLE_POSITIVE_TOKEN_RE.test(text)) score += 25;
    if (text.includes("checklist")) score += 20;
    if (text.includes("<table")) score += 8;
    if (TABLE_NEGATIVE_TOKEN_RE.test(text)) score -= 20;
    if (score > bestScore) {
      bestScore = score;
      selected = candidate;
    }
  }

  return selected;
}

function extractChecklistTextFromHtml(html: string) {
  const contentHtml = extractLikelyContentHtml(html);
  return decodeHtmlEntities(
    String(contentHtml || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\u00A0/g, " ")
      .replace(/\r/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

function isLikelyNoiseCellValue(value: string) {
  const text = compactWhitespace(value);
  if (!text) return false;
  if (text.length > 260) return true;
  const lower = text.toLowerCase();
  if (text.includes("<") || text.includes(">")) return true;
  if (HTML_NOISE_TOKEN_RE.test(lower)) return true;
  if (HTML_ATTR_RE.test(lower)) return true;
  if ((text.match(/https?:\/\//gi) ?? []).length >= 2) return true;
  return false;
}

function looksLikeCardNumberValue(value: string) {
  const text = compactWhitespace(value).replace(/^#/, "");
  if (!text || text.length > 16) return false;
  if (!/[0-9]/.test(text)) return false;
  return /^[A-Za-z0-9]+(?:[-./][A-Za-z0-9]+){0,2}$/.test(text);
}

function looksLikeLabelValue(value: string) {
  const text = compactWhitespace(value);
  if (!text || text.length > 120) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 16) return false;
  if (TABLE_NEGATIVE_TOKEN_RE.test(text.toLowerCase())) return false;
  if (isLikelyNoiseCellValue(text)) return false;
  return true;
}

function tokenizeHeaderStrength(cells: string[]) {
  let score = 0;
  for (const cell of cells) {
    const cleaned = compactWhitespace(cell).toLowerCase();
    if (!cleaned) continue;
    if (/card\s*#|card number|card no|number|no\.?/.test(cleaned)) score += 3;
    if (/player|athlete|name/.test(cleaned)) score += 2;
    if (/parallel|variation|variant|refractor/.test(cleaned)) score += 3;
    if (/set|checklist|team/.test(cleaned)) score += 1;
  }
  return score;
}

type ParsedTableCandidate = {
  headers: string[];
  dataRows: string[][];
  score: number;
};

function parseTableCandidate(tableHtml: string): ParsedTableCandidate | null {
  const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  if (rowMatches.length === 0) return null;

  const rawRows = rowMatches
    .map((rowHtml) => {
      const cells = rowHtml.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? [];
      const parsed = cells.map((cellHtml) => stripHtml(cellHtml));
      return parsed.filter((cell) => compactWhitespace(cell) !== "");
    })
    .filter((cells) => cells.length > 0);

  if (rawRows.length === 0) return null;

  let headerIndex = -1;
  let headerStrength = 0;
  for (let index = 0; index < Math.min(3, rawRows.length); index += 1) {
    const score = tokenizeHeaderStrength(rawRows[index] ?? []);
    if (score > headerStrength) {
      headerStrength = score;
      headerIndex = index;
    }
  }
  if (headerStrength < 2) {
    headerIndex = -1;
  }

  const headerRow = headerIndex >= 0 ? rawRows[headerIndex] ?? [] : [];
  const widestRowLength = rawRows.reduce((max, row) => Math.max(max, row.length), 0);
  const headers =
    headerRow.length > 0
      ? headerRow.map((value, index) => {
          const header = compactWhitespace(value);
          return header || `column_${index + 1}`;
        })
      : Array.from({ length: Math.max(1, widestRowLength) }, (_, index) => `column_${index + 1}`);
  const dataRows =
    headerIndex >= 0
      ? rawRows.filter((_, index) => index !== headerIndex)
      : rawRows;

  if (dataRows.length === 0) return null;

  let rowPatternHits = 0;
  let parallelKeywordHits = 0;
  let noiseCells = 0;
  let totalCells = 0;
  let urlCells = 0;

  for (const row of dataRows.slice(0, 80)) {
    const hasCardNumber = row.some((cell) => looksLikeCardNumberValue(cell));
    const hasLabel = row.some((cell) => looksLikeLabelValue(cell));
    if (hasCardNumber && hasLabel) {
      rowPatternHits += 1;
    }

    if (row.some((cell) => TABLE_POSITIVE_TOKEN_RE.test(cell.toLowerCase()))) {
      parallelKeywordHits += 1;
    }

    for (const cell of row) {
      totalCells += 1;
      if (isLikelyNoiseCellValue(cell)) noiseCells += 1;
      if (/https?:\/\//i.test(cell)) urlCells += 1;
    }
  }

  const tableText = stripHtml(tableHtml).toLowerCase();
  const rowCount = dataRows.length;
  const rowPatternRatio = rowPatternHits / Math.max(1, Math.min(80, rowCount));
  const parallelRatio = parallelKeywordHits / Math.max(1, Math.min(80, rowCount));
  const noiseRatio = noiseCells / Math.max(1, totalCells);

  let score = 0;
  score += Math.min(20, rowCount * 1.5);
  score += headerStrength * 6;
  score += rowPatternRatio >= 0.25 ? 24 : rowPatternRatio >= 0.12 ? 12 : 0;
  score += parallelRatio >= 0.2 ? 12 : parallelRatio >= 0.1 ? 6 : 0;
  if (TABLE_HEADER_TOKEN_RE.test(headers.join(" "))) score += 8;
  if (TABLE_NEGATIVE_TOKEN_RE.test(tableText)) score -= 55;
  if (HTML_NOISE_TOKEN_RE.test(tableText)) score -= 35;
  if (noiseRatio > 0.3) score -= 45;
  if (noiseRatio > 0.15) score -= 20;
  if (urlCells > rowCount * 2) score -= 15;

  return {
    headers,
    dataRows,
    score,
  };
}

function parseHtmlTableRows(html: string): Array<Record<string, unknown>> {
  const contentHtml = extractLikelyContentHtml(html);
  const tables = String(contentHtml || "").match(/<table[\s\S]*?<\/table>/gi) ?? [];
  if (tables.length === 0) return [];

  const candidates = tables
    .map((tableHtml) => parseTableCandidate(tableHtml))
    .filter((candidate): candidate is ParsedTableCandidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return [];

  const selected = candidates[0]!;
  if (selected.score < 20) {
    return [];
  }

  return selected.dataRows
    .map((values) => {
      const record: Record<string, unknown> = {};
      selected.headers.forEach((header, index) => {
        record[header] = compactWhitespace(values[index] ?? "");
      });
      return record;
    })
    .filter((record) => Object.values(record).some((value) => compactWhitespace(String(value)) !== ""));
}

function normalizeObjectRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nested =
      (Array.isArray(record.rows) ? record.rows : null) ??
      (Array.isArray(record.data) ? record.data : null) ??
      (Array.isArray(record.items) ? record.items : null);
    if (nested) {
      return nested.filter(
        (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      );
    }
    return [record];
  }

  return [];
}

function guessSetIdFromRows(rows: Array<Record<string, unknown>>, fallback = "") {
  for (const row of rows) {
    const candidate = compactWhitespace(String(row.setId ?? row.set ?? row.setName ?? row.set_name ?? ""));
    if (candidate) return normalizeSetLabel(candidate);
  }
  return normalizeSetLabel(fallback);
}

function normalizeFieldKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isSafeFieldName(field: string) {
  const trimmed = compactWhitespace(field);
  if (!trimmed) return false;
  if (trimmed.length > 80) return false;
  if (/[<>=]/.test(trimmed)) return false;
  return true;
}

function fieldMatchesKey(field: string, key: string) {
  const normalizedField = normalizeFieldKey(field);
  const normalizedKey = normalizeFieldKey(key);
  if (!normalizedField || !normalizedKey) return false;
  if (normalizedField === normalizedKey) return true;
  if (normalizedKey.length < 4) return false;
  return normalizedField.startsWith(normalizedKey) || normalizedField.endsWith(normalizedKey);
}

function findField(row: Record<string, unknown>, keys: string[]) {
  const entries = Object.entries(row);
  for (const key of keys) {
    const direct = row[key];
    if (direct != null && compactWhitespace(String(direct))) return compactWhitespace(String(direct));
  }

  for (const [field, value] of entries) {
    if (!isSafeFieldName(field)) continue;
    const normalized = normalizeFieldKey(field);
    if (keys.some((key) => normalized === normalizeFieldKey(key)) && value != null && compactWhitespace(String(value))) {
      return compactWhitespace(String(value));
    }
  }

  for (const [field, value] of entries) {
    if (!isSafeFieldName(field)) continue;
    if (keys.some((key) => fieldMatchesKey(field, key)) && value != null && compactWhitespace(String(value))) {
      return compactWhitespace(String(value));
    }
  }
  return "";
}

function normalizeRowsForIngestion(params: {
  rows: Array<Record<string, unknown>>;
  setId: string;
  sourceUrl: string;
  datasetType: SetDatasetType;
}) {
  return params.rows.map((row, index) => {
    const setId = normalizeSetLabel(findField(row, ["setId", "set", "setName", "set_name"]) || params.setId);
    const cardNumber = findField(row, ["cardNumber", "card_number", "cardNo", "number", "card"]) || null;
    const parallel =
      findField(row, ["parallel", "parallelId", "parallel_id", "parallelName", "variation", "variant", "refractor"]) ||
      (params.datasetType === SetDatasetType.PARALLEL_DB ? "" : "");
    const playerSeed =
      findField(row, ["playerSeed", "playerName", "player", "athlete", "subject"]) ||
      (params.datasetType === SetDatasetType.PLAYER_WORKSHEET ? "" : "");
    const listingId = findField(row, ["listingId", "sourceListingId", "listing", "itemId", "itemNumber"]) || null;
    const sourceUrl = findField(row, ["sourceUrl", "url", "source"]) || params.sourceUrl;

    return {
      index,
      setId,
      cardNumber,
      parallel,
      playerSeed,
      listingId,
      sourceUrl,
      ...row,
    } as Record<string, unknown>;
  });
}

function isLikelyHttpUrl(value: string) {
  return /^https?:\/\/[^\s]+$/i.test(compactWhitespace(value));
}

function isLikelyRowNoiseValue(value: unknown) {
  const text = compactWhitespace(String(value ?? ""));
  if (!text) return false;
  if (text.length > 180) return true;
  if (isLikelyNoiseCellValue(text)) return true;
  const lower = text.toLowerCase();
  if (TABLE_NEGATIVE_TOKEN_RE.test(lower)) return true;
  if (lower.includes("buy this product now on ebay")) return true;
  if (lower.includes("when you click on links to various merchants")) return true;
  return false;
}

function countWords(value: string) {
  return compactWhitespace(value).split(/\s+/).filter(Boolean).length;
}

function filterRowsForIngestion(rows: Array<Record<string, unknown>>, datasetType: SetDatasetType) {
  const accepted: Array<Record<string, unknown>> = [];
  const rejectionReasons: Record<string, number> = {};

  const addReason = (reason: string) => {
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  };

  for (const row of rows) {
    const cardNumber = compactWhitespace(String(row.cardNumber ?? ""));
    const parallel = compactWhitespace(String(row.parallel ?? ""));
    const playerSeed = compactWhitespace(String(row.playerSeed ?? ""));
    const sourceUrl = compactWhitespace(String(row.sourceUrl ?? ""));

    if ([cardNumber, parallel, playerSeed].some((value) => isLikelyRowNoiseValue(value))) {
      addReason("html_or_navigation_noise");
      continue;
    }

    if (datasetType === SetDatasetType.PARALLEL_DB) {
      if (!parallel) {
        addReason("missing_parallel");
        continue;
      }
      if (countWords(parallel) > 18) {
        addReason("parallel_too_long");
        continue;
      }
      if (/^\$?\d+(?:\.\d+)?$/.test(parallel)) {
        addReason("parallel_looks_like_price");
        continue;
      }
    }

    if (datasetType === SetDatasetType.PLAYER_WORKSHEET) {
      if (!playerSeed) {
        addReason("missing_player");
        continue;
      }
      if (countWords(playerSeed) > 12) {
        addReason("player_name_too_long");
        continue;
      }
    }

    if (sourceUrl && !isLikelyHttpUrl(sourceUrl)) {
      addReason("invalid_source_url");
      continue;
    }

    accepted.push(row);
  }

  return {
    accepted,
    rejected: rows.length - accepted.length,
    rejectionReasons,
  };
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function resolveRelativeUrl(baseUrl: string, candidate: string) {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return "";
  }
}

function baseDomainGroup(url: string) {
  const domain = extractDomain(url);
  const segments = domain.split(".").filter(Boolean);
  if (segments.length < 2) return domain;
  return segments.slice(-2).join(".");
}

function extractChecklistCandidateUrls(html: string, baseUrl: string) {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const baseGroup = baseDomainGroup(baseUrl);

  const anchorPattern = /<a\b[^>]*href=(["']?)([^"'>\s]+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = null;

  while ((match = anchorPattern.exec(String(html || "")))) {
    const href = compactWhitespace(decodeHtmlEntities(match[2] || ""));
    const text = stripHtml(match[3] || "").toLowerCase();
    const hrefLower = href.toLowerCase();
    const looksLikePdf = /\.pdf(?:$|\?)/i.test(hrefLower);
    const hasChecklistSignal = /(checklist|set-list|setlist|full-list|parallel)/i.test(`${text} ${hrefLower}`);
    if (!href || hrefLower.startsWith("#")) continue;
    if (hrefLower.startsWith("javascript:") || hrefLower.startsWith("mailto:")) continue;
    if (!hasChecklistSignal && !looksLikePdf) continue;
    if (/(ebay|affiliate|forum|search|signin|signup|login|register)/i.test(hrefLower)) continue;

    const resolved = resolveRelativeUrl(baseUrl, href);
    if (!resolved) continue;
    if (isLikelySearchResultsUrl(resolved)) continue;
    const resolvedGroup = baseDomainGroup(resolved);
    if (baseGroup && resolvedGroup && baseGroup !== resolvedGroup && !looksLikePdf) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    candidates.push(resolved);
  }

  return candidates.slice(0, 5);
}

async function fetchRowsFromSource(
  url: string,
  context: { depth: number; visited: Set<string> } = { depth: 0, visited: new Set<string>() }
): Promise<SourceFetchResult> {
  const normalizedUrl = compactWhitespace(url);
  if (!normalizedUrl) {
    throw new Error("Source URL is empty.");
  }
  if (context.visited.has(normalizedUrl)) {
    throw new Error("Checklist source loop detected.");
  }
  context.visited.add(normalizedUrl);

  const { response, attemptsUsed } = await fetchWithRetry(normalizedUrl, 3);
  const contentType = response.headers.get("content-type");
  const lowerContentType = String(contentType || "").toLowerCase();
  const lowerUrl = normalizedUrl.toLowerCase();
  const isPdfSource = lowerContentType.includes("application/pdf") || /\.pdf(?:$|\?)/i.test(lowerUrl);

  if (isPdfSource) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const checklistText = extractChecklistTextFromPdfBuffer(buffer);
    const rows = parseChecklistRowsFromText(checklistText);
    return {
      rows,
      parserName: "pdf-checklist-v1",
      contentType,
      fetchedAt: new Date().toISOString(),
      attempts: attemptsUsed,
    };
  }

  const content = await response.text();
  const trimmed = content.trim();

  if (lowerContentType.includes("application/json") || lowerUrl.endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed || "[]");
    const rows = normalizeObjectRows(parsed);
    return {
      rows,
      parserName: "json-v1",
      contentType,
      fetchedAt: new Date().toISOString(),
      attempts: attemptsUsed,
    };
  }

  if (lowerContentType.includes("text/csv") || lowerUrl.endsWith(".csv")) {
    return {
      rows: parseCsvRows(content),
      parserName: "csv-v1",
      contentType,
      fetchedAt: new Date().toISOString(),
      attempts: attemptsUsed,
    };
  }

  if (lowerContentType.includes("text/markdown") || lowerContentType.includes("text/x-markdown") || lowerUrl.endsWith(".md")) {
    const markdownRows = parseMarkdownRows(content);
    if (markdownRows.length > 0) {
      return {
        rows: markdownRows,
        parserName: "markdown-v1",
        contentType,
        fetchedAt: new Date().toISOString(),
        attempts: attemptsUsed,
      };
    }
  }

  const htmlRows = parseHtmlTableRows(content);
  if (htmlRows.length > 0) {
    return {
      rows: htmlRows,
      parserName: "html-table-v1",
      contentType,
      fetchedAt: new Date().toISOString(),
      attempts: attemptsUsed,
    };
  }

  const htmlChecklistRows = parseChecklistRowsFromText(extractChecklistTextFromHtml(content));
  if (htmlChecklistRows.length > 0) {
    return {
      rows: htmlChecklistRows,
      parserName: "html-checklist-text-v1",
      contentType,
      fetchedAt: new Date().toISOString(),
      attempts: attemptsUsed,
    };
  }

  if (context.depth < 1) {
    const checklistUrls = extractChecklistCandidateUrls(content, normalizedUrl);
    for (const checklistUrl of checklistUrls) {
      try {
        const nested = await fetchRowsFromSource(checklistUrl, {
          depth: context.depth + 1,
          visited: context.visited,
        });
        return {
          rows: nested.rows,
          parserName: `${nested.parserName}+checklist-link-v1`,
          contentType: nested.contentType || contentType,
          fetchedAt: nested.fetchedAt,
          attempts: nested.attempts,
        };
      } catch {
        // Continue trying candidate checklist links until one parses.
      }
    }
  }

  const csvRows = parseCsvRows(content);
  if (csvRows.length > 0) {
    return {
      rows: csvRows,
      parserName: "csv-fallback-v1",
      contentType,
      fetchedAt: new Date().toISOString(),
      attempts: attemptsUsed,
    };
  }

  throw new Error("Could not parse rows from source URL. Supported sources: JSON, CSV, PDF checklists, or checklist tables.");
}

export function parseUploadedSourceFile(params: {
  fileName: string;
  fileBuffer: Buffer;
  contentType?: string | null;
}): { rows: Array<Record<string, unknown>>; parserName: string } {
  const fileName = compactWhitespace(params.fileName);
  if (!fileName) {
    throw new Error("Upload file name is required.");
  }
  if (!params.fileBuffer || params.fileBuffer.length < 1) {
    throw new Error("Uploaded file is empty.");
  }

  const lowerName = fileName.toLowerCase();
  const lowerContentType = String(params.contentType || "").toLowerCase();
  const isPdf = lowerContentType.includes("application/pdf") || lowerName.endsWith(".pdf");

  if (isPdf) {
    const checklistText = extractChecklistTextFromPdfBuffer(params.fileBuffer);
    const rows = parseChecklistRowsFromText(checklistText);
    if (rows.length < 1) {
      throw new Error(
        "No checklist rows were detected from this PDF. Use an official text-based checklist PDF (not a scanned image PDF)."
      );
    }
    return { rows, parserName: "upload-pdf-checklist-v1" };
  }

  const text = params.fileBuffer.toString("utf8");
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Uploaded file is empty.");
  }

  if (lowerName.endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const rows = normalizeObjectRows(parsed);
      if (rows.length > 0) {
        return { rows, parserName: "upload-json-v1" };
      }
    } catch {
      if (lowerName.endsWith(".json")) {
        throw new Error("JSON file could not be parsed.");
      }
    }
  }

  if (lowerName.endsWith(".csv") || lowerContentType.includes("text/csv")) {
    const rows = parseCsvRows(text);
    if (rows.length > 0) {
      return { rows, parserName: "upload-csv-v1" };
    }
  }

  const markdownRows = parseMarkdownRows(text);
  if (markdownRows.length > 0) {
    return { rows: markdownRows, parserName: "upload-markdown-v1" };
  }

  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm") || /<table|<html|<body|<article/i.test(text)) {
    const htmlTableRows = parseHtmlTableRows(text);
    if (htmlTableRows.length > 0) {
      return { rows: htmlTableRows, parserName: "upload-html-table-v1" };
    }
    const htmlChecklistRows = parseChecklistRowsFromText(extractChecklistTextFromHtml(text));
    if (htmlChecklistRows.length > 0) {
      return { rows: htmlChecklistRows, parserName: "upload-html-checklist-v1" };
    }
  }

  const checklistRows = parseChecklistRowsFromText(text);
  if (checklistRows.length > 0) {
    return { rows: checklistRows, parserName: "upload-text-checklist-v1" };
  }

  throw new Error("No usable checklist rows found. Upload CSV/JSON/PDF checklist sources.");
}

function buildDiscoverySearchText(query: NormalizedDiscoveryQuery) {
  return [query.year ? String(query.year) : "", query.manufacturer, query.sport, query.query, "trading card checklist"]
    .filter(Boolean)
    .join(" ");
}

function buildDiscoveryResult(params: {
  title: string;
  url: string;
  snippet: string;
  query: NormalizedDiscoveryQuery;
}) {
  const resolvedUrl = compactWhitespace(params.url);
  if (!resolvedUrl.startsWith("http://") && !resolvedUrl.startsWith("https://")) return null;
  const title = sanitizeTitle(params.title);
  if (!title) return null;
  const domain = extractDomain(resolvedUrl);
  const snippet = compactWhitespace(params.snippet);
  const provider = providerFromDomain(domain);
  const setIdGuess = inferSetId(title, {
    year: params.query.year,
    manufacturer: params.query.manufacturer,
    sport: params.query.sport,
    query: params.query.query,
    limit: params.query.limit,
  });
  const score = rankResult({
    title,
    snippet,
    domain,
    query: {
      year: params.query.year,
      manufacturer: params.query.manufacturer,
      sport: params.query.sport,
      query: params.query.query,
      limit: params.query.limit,
    },
  });

  return {
    id: `${domain}::${Buffer.from(resolvedUrl).toString("base64").slice(0, 18)}`,
    title,
    url: resolvedUrl,
    snippet,
    provider,
    domain,
    setIdGuess,
    score,
    discoveredAt: new Date().toISOString(),
  } satisfies SetOpsDiscoveryResult;
}

async function searchDuckDuckGo(query: NormalizedDiscoveryQuery, searchText: string) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchText)}`;
  const { response } = await fetchWithRetry(url, 3);
  const html = await response.text();

  const linkPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const results: SetOpsDiscoveryResult[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = linkPattern.exec(html)) && results.length < query.limit * 3) {
    const rawUrl = compactWhitespace(match[1] || "");
    const resolvedUrl = decodeSearchResultUrl(rawUrl);
    const mapped = buildDiscoveryResult({
      title: match[2] || "",
      url: resolvedUrl,
      snippet: "",
      query,
    });
    if (mapped) {
      results.push(mapped);
    }
  }

  return results;
}

async function searchBingRss(query: NormalizedDiscoveryQuery, searchText: string) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(searchText)}&format=rss`;
  const { response } = await fetchWithRetry(url, 3);
  const xml = await response.text();

  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  const results: SetOpsDiscoveryResult[] = [];
  let itemMatch: RegExpExecArray | null = null;

  while ((itemMatch = itemPattern.exec(xml)) && results.length < query.limit * 3) {
    const item = itemMatch[1] || "";
    const mapped = buildDiscoveryResult({
      title: extractXmlTag(item, "title"),
      url: extractXmlTag(item, "link"),
      snippet: extractXmlTag(item, "description"),
      query,
    });
    if (mapped) {
      results.push(mapped);
    }
  }

  return results;
}

function buildFallbackDiscoveryResults(query: NormalizedDiscoveryQuery, searchText: string) {
  const encoded = encodeURIComponent(searchText);
  const candidates = [
    {
      title: `${searchText} - TCDB Search`,
      url: `https://www.tcdb.com/Search.cfm?SearchText=${encoded}&s=All`,
      snippet: "Fallback provider search (TCDB) because live web discovery endpoint blocked this request.",
    },
    {
      title: `${searchText} - Cardboard Connection Search`,
      url: `https://www.cardboardconnection.com/?s=${encoded}`,
      snippet: "Fallback provider search (Cardboard Connection).",
    },
    {
      title: `${searchText} - Beckett Search`,
      url: `https://www.beckett.com/news/?s=${encoded}`,
      snippet: "Fallback provider search (Beckett).",
    },
  ];

  return candidates
    .map((candidate) =>
      buildDiscoveryResult({
        title: candidate.title,
        url: candidate.url,
        snippet: candidate.snippet,
        query,
      })
    )
    .filter((entry): entry is SetOpsDiscoveryResult => Boolean(entry))
    .slice(0, query.limit);
}

function dedupeDiscoveryResults(results: SetOpsDiscoveryResult[], limit: number) {
  const deduped = new Map<string, SetOpsDiscoveryResult>();
  for (const result of results) {
    if (!deduped.has(result.url)) {
      deduped.set(result.url, result);
    }
  }
  return Array.from(deduped.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function searchSetSources(query: SetOpsDiscoveryQuery): Promise<SetOpsDiscoveryResult[]> {
  const normalized: NormalizedDiscoveryQuery = {
    year: query.year ? parsePositiveInt(query.year, nowYear, 1900, nowYear + 1) : null,
    manufacturer: compactWhitespace(String(query.manufacturer || "")),
    sport: compactWhitespace(String(query.sport || "")),
    query: compactWhitespace(String(query.query || "")),
    limit: parsePositiveInt(query.limit, 12, 1, 30),
  };

  const searchText = buildDiscoverySearchText(normalized);
  if (!searchText) {
    throw new Error("Provide at least one search input (year, manufacturer, sport, or query).");
  }

  const variants = buildDiscoverySearchVariants(normalized);
  const attempts: Array<{ provider: string; error: string }> = [];
  const collected: SetOpsDiscoveryResult[] = [];
  const providers: Array<{
    name: string;
    run: (nextQuery: NormalizedDiscoveryQuery, nextSearchText: string) => Promise<SetOpsDiscoveryResult[]>;
  }> = [
    { name: "duckduckgo-html", run: searchDuckDuckGo },
    { name: "bing-rss", run: searchBingRss },
  ];

  for (const variant of variants) {
    for (const provider of providers) {
      try {
        const results = await provider.run(normalized, variant.searchText);
        const filtered = filterDiscoveryResults({
          results,
          query: normalized,
          requiredDomainSuffixes: variant.requiredDomainSuffixes,
        });
        if (filtered.length > 0) {
          collected.push(...filtered);
          const deduped = dedupeDiscoveryResults(collected, normalized.limit);
          if (deduped.length >= normalized.limit) {
            return deduped;
          }
        } else {
          attempts.push({ provider: `${provider.name}:${variant.name}`, error: "empty/filtered result set" });
        }
      } catch (error) {
        const status = parseStatusCodeFromError(error);
        const reason = error instanceof Error ? error.message : "Unknown error";
        attempts.push({
          provider: `${provider.name}:${variant.name}`,
          error: status ? `HTTP ${status}` : reason,
        });
      }
    }
  }

  const dedupedCollected = dedupeDiscoveryResults(collected, normalized.limit);
  if (dedupedCollected.length > 0) {
    return dedupedCollected;
  }

  const fallbackResults = dedupeDiscoveryResults(buildFallbackDiscoveryResults(normalized, searchText), normalized.limit);
  if (fallbackResults.length > 0) {
    return fallbackResults;
  }

  const details = attempts.map((attempt) => `${attempt.provider}: ${attempt.error}`).join("; ");
  throw new Error(`Discovery search failed. ${details || "No providers returned results."}`);
}

export async function importDiscoveredSource(params: {
  setId?: string | null;
  datasetType: SetDatasetType;
  sourceUrl: string;
  sourceProvider?: string | null;
  sourceTitle?: string | null;
  parserVersion?: string | null;
  discoveryQuery?: Record<string, unknown> | null;
  createdById?: string | null;
}) {
  const sourceUrl = compactWhitespace(params.sourceUrl);
  if (!sourceUrl.startsWith("http://") && !sourceUrl.startsWith("https://")) {
    throw new Error("sourceUrl must be an absolute http(s) URL");
  }
  if (isLikelySearchResultsUrl(sourceUrl)) {
    throw new Error(
      "This URL looks like a search-results page. Open the exact checklist/set page and paste that direct URL before import."
    );
  }

  let fetched: SourceFetchResult;
  try {
    fetched = await fetchRowsFromSource(sourceUrl);
  } catch (error) {
    const status = parseStatusCodeFromError(error);
    if (status === 401 || status === 403) {
      throw new Error(
        "Source blocked automated fetch (HTTP 403/401). Open source in browser and use CSV/JSON/PDF upload in Step 1 as fallback."
      );
    }
    throw error;
  }
  const fallbackSetId = normalizeSetLabel(params.setId || inferSetId(params.sourceTitle || "", {}));
  const inferredSetId = guessSetIdFromRows(fetched.rows, fallbackSetId);
  if (!inferredSetId) {
    throw new Error("Could not infer setId from source rows. Enter a setId before import.");
  }

  const normalizedRows = normalizeRowsForIngestion({
    rows: fetched.rows,
    setId: inferredSetId,
    sourceUrl,
    datasetType: params.datasetType,
  });

  if (normalizedRows.length < 1) {
    throw new Error("Source parser returned zero rows.");
  }

  const rowQuality = filterRowsForIngestion(normalizedRows, params.datasetType);
  if (rowQuality.accepted.length < 1) {
    throw new Error(
      "No checklist rows were detected from this source URL. The page appears to be navigation/article/ads content, not a structured checklist table."
    );
  }
  if (normalizedRows.length >= 20 && rowQuality.accepted.length < Math.max(3, Math.floor(normalizedRows.length * 0.1))) {
    throw new Error(
      "Parsed rows are mostly non-checklist content. Use the exact checklist URL (or CSV/JSON upload) instead of an article/search page."
    );
  }

  const draft = await prisma.setDraft.upsert({
    where: { setId: inferredSetId },
    update: {
      normalizedLabel: inferredSetId,
      status: "DRAFT",
    },
    create: {
      setId: inferredSetId,
      normalizedLabel: inferredSetId,
      status: "DRAFT",
      createdById: params.createdById ?? null,
    },
    select: { id: true },
  });

  const parserVersion = compactWhitespace(params.parserVersion || `source-discovery:${fetched.parserName}`) || "source-discovery:unknown";
  const provider = compactWhitespace(params.sourceProvider || providerFromDomain(extractDomain(sourceUrl)) || "UNKNOWN");

  const job = await prisma.setIngestionJob.create({
    data: {
      setId: inferredSetId,
      draftId: draft.id,
      datasetType: params.datasetType,
      sourceUrl,
      rawPayload: toJsonInput(rowQuality.accepted),
      parserVersion,
      status: SetIngestionJobStatus.QUEUED,
      parseSummaryJson: toJsonInput({
        sourceProvider: provider,
        sourceTitle: params.sourceTitle || null,
        discoveryQuery: params.discoveryQuery || null,
        parserName: fetched.parserName,
        contentType: fetched.contentType,
        fetchedAt: fetched.fetchedAt,
        fetchAttempts: fetched.attempts,
        rowCount: rowQuality.accepted.length,
        droppedRowCount: rowQuality.rejected,
        rejectionReasons: rowQuality.rejectionReasons,
      }),
      createdById: params.createdById ?? null,
    },
    select: {
      id: true,
      setId: true,
      draftId: true,
      datasetType: true,
      sourceUrl: true,
      parserVersion: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      parsedAt: true,
      reviewedAt: true,
      parseSummaryJson: true,
    },
  });

  return {
    job,
    preview: {
      setId: inferredSetId,
      rowCount: rowQuality.accepted.length,
      parserName: fetched.parserName,
      sourceProvider: provider,
      sourceUrl,
      fetchedAt: fetched.fetchedAt,
      fetchAttempts: fetched.attempts,
      sampleRows: rowQuality.accepted.slice(0, 5),
    },
  };
}
