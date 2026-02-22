import { SetDatasetType, SetIngestionJobStatus, prisma, type Prisma } from "@tenkings/database";
import { decodeHtmlEntities, normalizeSetLabel } from "@tenkings/shared";

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

const hostLastRequestAt = new Map<string, number>();
const nowYear = new Date().getFullYear();

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
  if (title.includes("checklist")) score += 25;
  if (snippet.includes("checklist")) score += 10;
  if (title.includes("trading card")) score += 8;
  if (year && (title.includes(year) || snippet.includes(year))) score += 12;
  if (manufacturer && (title.includes(manufacturer) || snippet.includes(manufacturer))) score += 12;
  if (sport && (title.includes(sport) || snippet.includes(sport))) score += 8;
  if (freeQuery && (title.includes(freeQuery) || snippet.includes(freeQuery))) score += 8;
  if (domain.includes("tcdb.com")) score += 14;
  if (domain.includes("cardboardconnection.com")) score += 8;
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
          Accept: "text/html,application/json,text/csv;q=0.9,*/*;q=0.8",
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

function stripHtml(html: string) {
  return compactWhitespace(
    decodeHtmlEntities(
      String(html || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function parseHtmlTableRows(html: string): Array<Record<string, unknown>> {
  const tables = String(html || "").match(/<table[\s\S]*?<\/table>/gi) ?? [];
  if (tables.length === 0) return [];

  let selectedTable = tables[0]!;
  let selectedRowCount = 0;

  for (const table of tables) {
    const rowCount = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).length;
    if (rowCount > selectedRowCount) {
      selectedTable = table;
      selectedRowCount = rowCount;
    }
  }

  const rowMatches = selectedTable.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  if (rowMatches.length <= 1) return [];

  const rows = rowMatches.map((rowHtml) => {
    const cells = rowHtml.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? [];
    return cells.map((cellHtml) => stripHtml(cellHtml));
  });

  const headerRow = rows[0] ?? [];
  const hasHeader = headerRow.some((header) => /card|player|parallel|number|name|variation/i.test(header));
  const headers = (hasHeader ? headerRow : headerRow.map((_, index) => `column_${index + 1}`)).map((header, index) =>
    compactWhitespace(header) || `column_${index + 1}`
  );
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((values) => {
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => {
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

function findField(row: Record<string, unknown>, keys: string[]) {
  const entries = Object.entries(row);
  for (const key of keys) {
    const direct = row[key];
    if (direct != null && compactWhitespace(String(direct))) return compactWhitespace(String(direct));
  }

  for (const [field, value] of entries) {
    const lower = field.toLowerCase();
    if (keys.some((key) => lower === key.toLowerCase()) && value != null && compactWhitespace(String(value))) {
      return compactWhitespace(String(value));
    }
  }

  for (const [field, value] of entries) {
    const lower = field.toLowerCase();
    if (keys.some((key) => lower.includes(key.toLowerCase())) && value != null && compactWhitespace(String(value))) {
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
      findField(row, ["parallel", "parallelId", "parallel_id", "variation", "variant", "name"]) ||
      (params.datasetType === SetDatasetType.PARALLEL_DB ? "" : "");
    const playerSeed =
      findField(row, ["playerSeed", "playerName", "player", "name"]) ||
      (params.datasetType === SetDatasetType.PLAYER_WORKSHEET ? "" : "");
    const listingId = findField(row, ["listingId", "sourceListingId", "listing", "itemId", "item"]) || null;
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

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function fetchRowsFromSource(url: string): Promise<SourceFetchResult> {
  const { response, attemptsUsed } = await fetchWithRetry(url, 3);
  const contentType = response.headers.get("content-type");
  const content = await response.text();
  const trimmed = content.trim();
  const lowerContentType = String(contentType || "").toLowerCase();
  const lowerUrl = url.toLowerCase();

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

  throw new Error("Could not parse rows from source URL. Supported sources: JSON, CSV, or HTML tables.");
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

  const attempts: Array<{ provider: string; error: string }> = [];
  const providers: Array<{
    name: string;
    run: (nextQuery: NormalizedDiscoveryQuery, nextSearchText: string) => Promise<SetOpsDiscoveryResult[]>;
  }> = [
    { name: "duckduckgo-html", run: searchDuckDuckGo },
    { name: "bing-rss", run: searchBingRss },
  ];

  for (const provider of providers) {
    try {
      const results = dedupeDiscoveryResults(await provider.run(normalized, searchText), normalized.limit);
      if (results.length > 0) return results;
      attempts.push({ provider: provider.name, error: "empty result set" });
    } catch (error) {
      const status = parseStatusCodeFromError(error);
      const reason = error instanceof Error ? error.message : "Unknown error";
      attempts.push({
        provider: provider.name,
        error: status ? `HTTP ${status}` : reason,
      });
    }
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

  let fetched: SourceFetchResult;
  try {
    fetched = await fetchRowsFromSource(sourceUrl);
  } catch (error) {
    const status = parseStatusCodeFromError(error);
    if (status === 401 || status === 403) {
      throw new Error(
        "Source blocked automated fetch (HTTP 403/401). Open source in browser and use CSV/JSON upload in Step 1 as fallback."
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
      rawPayload: toJsonInput(normalizedRows),
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
        rowCount: normalizedRows.length,
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
      rowCount: normalizedRows.length,
      parserName: fetched.parserName,
      sourceProvider: provider,
      sourceUrl,
      fetchedAt: fetched.fetchedAt,
      fetchAttempts: fetched.attempts,
      sampleRows: normalizedRows.slice(0, 5),
    },
  };
}
