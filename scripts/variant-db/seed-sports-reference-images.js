#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { scoreReferenceCandidate } = require("./quality-gate");

function loadPrismaClient() {
  try {
    return require("@prisma/client").PrismaClient;
  } catch {
    const fallback = path.resolve(
      __dirname,
      "../../packages/database/node_modules/@prisma/client"
    );
    return require(fallback).PrismaClient;
  }
}

const PrismaClient = loadPrismaClient();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadQueryAliasesConfig(configPath) {
  const fallback = path.resolve(__dirname, "query-aliases.json");
  const target = configPath ? path.resolve(process.cwd(), String(configPath)) : fallback;
  try {
    const raw = fs.readFileSync(target, "utf8");
    const parsed = JSON.parse(raw);
    return {
      setAliases: parsed?.setAliases && typeof parsed.setAliases === "object" ? parsed.setAliases : {},
      setPlayers: parsed?.setPlayers && typeof parsed.setPlayers === "object" ? parsed.setPlayers : {},
      setParallelPlayers:
        parsed?.setParallelPlayers && typeof parsed.setParallelPlayers === "object"
          ? parsed.setParallelPlayers
          : {},
      parallelAliases:
        parsed?.parallelAliases && typeof parsed.parallelAliases === "object" ? parsed.parallelAliases : {},
    };
  } catch {
    return { setAliases: {}, setPlayers: {}, setParallelPlayers: {}, parallelAliases: {} };
  }
}

function parseCsvRow(line) {
  const out = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(value.trim());
      value = "";
      continue;
    }
    value += ch;
  }
  out.push(value.trim());
  return out;
}

function loadChecklistPlayerMap(inputPath) {
  if (!inputPath) return { setParallelPlayers: {}, setParallelEntries: {} };
  const target = path.resolve(process.cwd(), String(inputPath));
  if (!fs.existsSync(target)) return { setParallelPlayers: {}, setParallelEntries: {} };
  if (target.toLowerCase().endsWith(".json")) {
    try {
      const raw = fs.readFileSync(target, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (parsed.setParallelPlayers || parsed.setParallelEntries) {
          return {
            setParallelPlayers:
              parsed.setParallelPlayers && typeof parsed.setParallelPlayers === "object"
                ? parsed.setParallelPlayers
                : {},
            setParallelEntries:
              parsed.setParallelEntries && typeof parsed.setParallelEntries === "object"
                ? parsed.setParallelEntries
                : {},
          };
        }
        return { setParallelPlayers: parsed, setParallelEntries: {} };
      }
      return { setParallelPlayers: {}, setParallelEntries: {} };
    } catch {
      return { setParallelPlayers: {}, setParallelEntries: {} };
    }
  }
  const raw = fs.readFileSync(target, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return {};
  const headers = parseCsvRow(lines[0]).map((h) => normalize(h));
  const setIdIndex = headers.findIndex((h) => h === "setid" || h === "set");
  const parallelIndex = headers.findIndex((h) => h === "parallelid" || h === "parallel");
  const playerIndex = headers.findIndex(
    (h) => h === "playername" || h === "player" || h === "name" || h === "athlete"
  );
  const cardNumberIndex = headers.findIndex((h) => h === "cardnumber" || h === "card" || h === "cardno");
  if (setIdIndex < 0 || parallelIndex < 0 || playerIndex < 0) {
    return { setParallelPlayers: {}, setParallelEntries: {} };
  }

  const map = {};
  const entries = {};
  for (const line of lines.slice(1)) {
    const cells = parseCsvRow(line);
    const setId = String(cells[setIdIndex] || "").trim();
    const parallelId = String(cells[parallelIndex] || "").trim();
    const playerName = String(cells[playerIndex] || "").trim();
    const cardNumber = cardNumberIndex >= 0 ? String(cells[cardNumberIndex] || "").trim() : "";
    if (!setId || !parallelId || !playerName) continue;
    const setKey = normalize(setId);
    const parallelKey = normalize(parallelId);
    if (!map[setKey]) map[setKey] = {};
    if (!entries[setKey]) entries[setKey] = {};
    if (!Array.isArray(map[setKey][parallelKey])) map[setKey][parallelKey] = [];
    if (!Array.isArray(entries[setKey][parallelKey])) entries[setKey][parallelKey] = [];
    if (!map[setKey][parallelKey].some((existing) => existing.toLowerCase() === playerName.toLowerCase())) {
      map[setKey][parallelKey].push(playerName);
    }
    if (
      !entries[setKey][parallelKey].some(
        (entry) =>
          String(entry?.playerName || "").toLowerCase() === playerName.toLowerCase() &&
          String(entry?.cardNumber || "").toLowerCase() === cardNumber.toLowerCase()
      )
    ) {
      entries[setKey][parallelKey].push({ playerName, cardNumber });
    }
  }
  return { setParallelPlayers: map, setParallelEntries: entries };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(input, size) {
  const chunks = [];
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size));
  }
  return chunks;
}

function buildVariantQuery(
  variant,
  parallelOverride = "",
  querySetOverride = "",
  includeKeywords = true,
  includeTradingCardToken = true
) {
  const setPart = querySetOverride || variant.setId;
  const cardPart = variant.cardNumber === "ALL" ? "" : `#${variant.cardNumber}`;
  const parallelPart = parallelOverride || variant.parallelId;
  const keywordPart =
    includeKeywords && Array.isArray(variant.keywords) ? variant.keywords.slice(0, 3).join(" ") : "";
  return [
    setPart,
    cardPart,
    parallelPart,
    keywordPart,
    includeTradingCardToken ? "trading card" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function deriveParallelSearchTerms(parallelId, config) {
  const text = String(parallelId || "").trim();
  if (!text) return [];
  const normalized = text.toLowerCase();
  const terms = [];
  const push = (value) => {
    const next = String(value || "").trim();
    if (!next) return;
    if (!terms.some((item) => item.toLowerCase() === next.toLowerCase())) {
      terms.push(next);
    }
  };

  // Product-specific aliasing for hard insert/autograph/relic subsets.
  if (normalized.includes("redemption")) push("Redemption");
  if (normalized.includes("patch")) push("Patch");
  if (normalized.includes("relic")) push("Relic");
  if (normalized.includes("auto")) push("Auto Autograph");
  if (normalized.includes("dual")) push("Rookie Dual Auto");
  if (normalized.includes("triple")) push("Triple Auto");
  if (normalized.includes("mojo")) push("Mojo Silver Pack");
  if (normalized.includes("holo foil")) push("Holo Foil");
  if (normalized.includes("home court")) push("Home Court");
  if (normalized.includes("new school")) push("New School");
  if (normalized.includes("hidden gems")) push("Hidden Gems");
  if (normalized.includes("all kings")) push("All Kings");
  if (normalized.includes("class of")) push("Class");
  if (normalized.includes("notch")) push("Topps Notch Auto");
  if (normalized.includes("follow back")) push("Social Media Redemption");
  if (normalized.includes("photo shoot")) push("Rookie Auto");

  const explicitAliases = config?.parallelAliases?.[normalized];
  if (Array.isArray(explicitAliases)) {
    for (const alias of explicitAliases) push(alias);
  }

  // Generic simplification: try meaningful individual words as fallbacks.
  const words = text.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  for (const word of words) {
    if (word.length >= 4) push(word);
  }
  return terms;
}

function deriveSetSearchTerms(setId, querySetOverride, config) {
  const base = String(querySetOverride || setId || "").trim();
  const key = normalize(base);
  const out = [];
  const push = (value) => {
    const next = String(value || "").trim();
    if (!next) return;
    if (!out.some((item) => item.toLowerCase() === next.toLowerCase())) {
      out.push(next);
    }
  };
  push(base);

  if (key.includes("topps basketball")) {
    push(base.replace("Topps Basketball", "Topps"));
    push(base.replace("2025-26", "2025"));
    push(base.replace("2025-26", "2026"));
    push("Topps Chrome Basketball");
  }

  const configured = config?.setAliases?.[key];
  if (Array.isArray(configured)) {
    for (const alias of configured) push(alias);
  }
  return out;
}

function derivePlayerSeeds(setId, parallelId, querySetOverride, config, checklistPlayersMap, maxPlayers) {
  const key = normalize(querySetOverride || setId);
  const parallelKey = normalize(parallelId);
  const perParallelChecklist = checklistPlayersMap?.setParallelPlayers?.[key]?.[parallelKey];
  if (Array.isArray(perParallelChecklist) && perParallelChecklist.length > 0) {
    return perParallelChecklist
      .map((name) => String(name || "").trim())
      .filter(Boolean)
      .slice(0, Math.max(0, maxPlayers));
  }
  const perParallelConfig = config?.setParallelPlayers?.[key]?.[parallelKey];
  if (Array.isArray(perParallelConfig) && perParallelConfig.length > 0) {
    return perParallelConfig
      .map((name) => String(name || "").trim())
      .filter(Boolean)
      .slice(0, Math.max(0, maxPlayers));
  }
  const list = config?.setPlayers?.[key];
  if (!Array.isArray(list)) return [];
  return list.map((name) => String(name || "").trim()).filter(Boolean).slice(0, Math.max(0, maxPlayers));
}

function deriveChecklistEntries(setId, parallelId, querySetOverride, checklistPlayersMap) {
  const key = normalize(querySetOverride || setId);
  const parallelKey = normalize(parallelId);
  const rows = checklistPlayersMap?.setParallelEntries?.[key]?.[parallelKey];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      playerName: String(row?.playerName || "").trim(),
      cardNumber: String(row?.cardNumber || "").trim(),
    }))
    .filter((row) => row.playerName);
}

function isLikelyPlaceholderImage(url) {
  return /\/s_1x2\.gif(?:$|\?)/i.test(url);
}

function canonicalizeUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    // Dedup by stable resource path (drop volatile query params).
    parsed.search = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function parseListingId(url) {
  const value = String(url || "").trim();
  if (!value) return null;
  const pathMatch = value.match(/\/itm\/(?:[^/?#]+\/)?(\d{8,20})(?:[/?#]|$)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const queryMatch = value.match(/[?&](?:item|itemId|itm|itm_id)=(\d{8,20})(?:[&#]|$)/i);
  if (queryMatch?.[1]) return queryMatch[1];
  return null;
}

async function fetchSerpEbayImages(apiKey, query, count, options = {}) {
  const pages = Math.max(1, Number(options.pages ?? 1) || 1);
  const resultsPerPage = Math.max(10, Math.min(240, Number(options.resultsPerPage ?? 100) || 100));
  const disableDedupe = options.disableDedupe === true;
  const rows = [];
  const seen = new Set();
  for (let page = 1; page <= pages; page += 1) {
    const params = new URLSearchParams({
      engine: "ebay",
      _nkw: query,
      ebay_domain: "ebay.com",
      _pgn: String(page),
      _ipg: String(resultsPerPage),
      api_key: apiKey,
    });
    const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`SerpApi eBay error ${response.status}${text ? ` - ${text.slice(0, 200)}` : ""}`);
    }
    const payload = await response.json();
    const results = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
    for (const item of results) {
      const rawImageUrl =
        typeof item?.thumbnail === "string"
          ? item.thumbnail.trim()
          : typeof item?.image === "string"
          ? item.image.trim()
          : "";
      const sourceUrl = typeof item?.link === "string" ? item.link.trim() : "";
      const canonicalImageUrl = canonicalizeUrl(rawImageUrl);
      const canonicalSourceUrl = canonicalizeUrl(sourceUrl);
      const dedupeKey = canonicalSourceUrl || canonicalImageUrl;
      if (!rawImageUrl || isLikelyPlaceholderImage(rawImageUrl) || !dedupeKey) continue;
      if (!disableDedupe && seen.has(dedupeKey)) continue;
      if (!disableDedupe) seen.add(dedupeKey);
      rows.push({
        rawImageUrl,
        sourceUrl: sourceUrl || null,
        sourceListingId: parseListingId(sourceUrl),
        listingTitle: typeof item?.title === "string" ? item.title.trim() : null,
      });
      if (rows.length >= count) return rows;
    }
  }
  return rows;
}

async function fetchSerpImages(apiKey, query, count, options = {}) {
  return await fetchSerpEbayImages(apiKey, query, count, options);
}

function deriveVariantTypeTerms(parallelId) {
  const normalized = normalize(parallelId);
  const terms = [];
  const push = (value) => {
    const next = String(value || "").trim();
    if (!next) return;
    if (!terms.includes(next)) terms.push(next);
  };
  if (normalized.includes("auto")) {
    push("autograph");
    push("on card auto");
    push("real ones autograph");
  }
  if (normalized.includes("patch") || normalized.includes("relic")) {
    push("relic");
    push("patch");
    push("memorabilia");
    push("game worn");
  }
  if (normalized.includes("redemption")) {
    push("redemption");
    push("redemption card");
  }
  if (
    normalized.includes("hidden gems") ||
    normalized.includes("all kings") ||
    normalized.includes("class of") ||
    normalized.includes("home court") ||
    normalized.includes("new school")
  ) {
    push("insert");
    push("ssp");
    push("case hit");
  }
  return terms;
}

async function fetchVariantImages(apiKey, variant, count, options = {}) {
  const querySetOverride = options.querySetOverride || "";
  const queryAliases = options.queryAliases || {};
  const checklistPlayersMap = options.checklistPlayersMap || {};
  const maxPlayerSeeds = Math.max(0, Number(options.maxPlayerSeeds ?? 4) || 4);
  const maxQueries = Math.max(1, Number(options.maxQueries ?? 12) || 12);
  const pagesPerQuery = Math.max(1, Number(options.pagesPerQuery ?? 2) || 2);
  const resultsPerPage = Math.max(10, Math.min(240, Number(options.resultsPerPage ?? 100) || 100));
  const disableDedupe = options.disableDedupe === true;
  const includeKeywords = options.includeKeywords !== false;
  const exactQuery = options.exactQuery === true;
  const refSide = String(options.refSide || "front").toLowerCase() === "back" ? "back" : "front";
  const forcedPlayer = String(options.forcedPlayer || "").trim();
  const forcedCardNumber = String(options.forcedCardNumber || "").trim();
  const forcedCardToken = forcedCardNumber ? `#${forcedCardNumber.replace(/^#/, "")}` : "";
  const forcedPlayerSeedKey = String(options.forcedPlayerSeedKey || "").trim();
  const onQueries = typeof options.onQueries === "function" ? options.onQueries : null;

  const setTerms = deriveSetSearchTerms(variant.setId, querySetOverride, queryAliases);
  const parallelTerms = [variant.parallelId, ...deriveParallelSearchTerms(variant.parallelId, queryAliases)];
  const typeTerms = deriveVariantTypeTerms(variant.parallelId);
  const playerSeeds = derivePlayerSeeds(
    variant.setId,
    variant.parallelId,
    querySetOverride,
    queryAliases,
    checklistPlayersMap,
    maxPlayerSeeds
  );
  const effectivePlayerSeeds = forcedPlayer ? [forcedPlayer] : playerSeeds;

  const queries = [];
  const seenQueries = new Set();
  const addQuery = (query, playerSeed = null) => {
    const base = String(query || "").trim();
    const next = [base, forcedCardToken].filter(Boolean).join(" ").trim();
    if (!next) return;
    const key = next.toLowerCase();
    if (seenQueries.has(key)) return;
    seenQueries.add(key);
    queries.push({ text: next, playerSeed: playerSeed ? String(playerSeed) : null });
  };

  if (exactQuery) {
    const exactSet = querySetOverride || variant.setId;
    addQuery(`${exactSet} ${variant.parallelId}${refSide === "back" ? " back" : ""}`.trim());
    for (const parallelTerm of parallelTerms) {
      addQuery(`${exactSet} ${parallelTerm}${refSide === "back" ? " back" : ""}`.trim());
      for (const player of effectivePlayerSeeds) {
        addQuery(
          `${exactSet} ${parallelTerm} ${player}${refSide === "back" ? " back" : ""}`.trim(),
          forcedPlayerSeedKey || player
        );
      }
    }
  } else {
    for (const setTerm of setTerms) {
      const setVariant = { ...variant, setId: setTerm };
      addQuery(buildVariantQuery(setVariant, "", "", includeKeywords, true));
      for (const parallelTerm of parallelTerms) {
        addQuery(buildVariantQuery(setVariant, parallelTerm, "", includeKeywords, true));
        for (const typeTerm of typeTerms) {
          addQuery(`${buildVariantQuery(setVariant, parallelTerm, "", includeKeywords, true)} ${typeTerm}`);
        }
        for (const player of effectivePlayerSeeds) {
          addQuery(
            `${buildVariantQuery(setVariant, parallelTerm, "", includeKeywords, true)} ${player}`,
            forcedPlayerSeedKey || player
          );
          for (const typeTerm of typeTerms) {
            addQuery(
              `${buildVariantQuery(setVariant, parallelTerm, "", includeKeywords, true)} ${typeTerm} ${player}`
            );
          }
        }
      }
    }
    // Broad fallback without year-range set phrase for hard variants.
    for (const parallelTerm of parallelTerms) {
      addQuery(`Topps Basketball ${parallelTerm} trading card`);
      addQuery(`Topps Chrome Basketball ${parallelTerm} trading card`);
      if (refSide === "back") {
        addQuery(`Topps Basketball ${parallelTerm} trading card back`);
        addQuery(`Topps Chrome Basketball ${parallelTerm} trading card back`);
      }
      for (const typeTerm of typeTerms) {
        addQuery(`Topps Basketball ${parallelTerm} ${typeTerm} trading card`);
        if (refSide === "back") {
          addQuery(`Topps Basketball ${parallelTerm} ${typeTerm} trading card back`);
        }
      }
      for (const player of effectivePlayerSeeds) {
        addQuery(`Topps Basketball ${parallelTerm} ${player} trading card`);
        if (refSide === "back") {
          addQuery(`Topps Basketball ${parallelTerm} ${player} trading card back`);
        }
      }
    }
  }
  if (onQueries) {
    onQueries(queries.slice(0, maxQueries).map((entry) => entry.text));
  }

  const rows = [];
  const seen = new Set();
  for (const queryEntry of queries.slice(0, maxQueries)) {
    const batch = await fetchSerpImages(apiKey, queryEntry.text, Math.max(count, 8), {
      pages: pagesPerQuery,
      resultsPerPage,
      disableDedupe,
    });
    for (const image of batch) {
      if (seen.has(image.rawImageUrl)) continue;
      seen.add(image.rawImageUrl);
      rows.push({
        ...image,
        playerSeed: queryEntry.playerSeed || null,
      });
      if (rows.length >= Math.max(count * 4, 12)) return rows;
    }
  }
  return rows;
}

async function loadExistingRefCounts(prisma, variants) {
  const unique = [];
  const seen = new Set();
  for (const variant of variants) {
    const refType = String(variant.refType || "front");
    const key = `${variant.setId}::${variant.parallelId}::${refType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ setId: variant.setId, parallelId: variant.parallelId, refType });
  }

  const countByKey = new Map();
  const chunks = chunkArray(unique, 300);
  for (const pairs of chunks) {
    const rows = await prisma.cardVariantReferenceImage.groupBy({
      by: ["setId", "parallelId", "refType"],
      where: {
        OR: pairs.map((pair) => ({
          setId: pair.setId,
          parallelId: pair.parallelId,
          refType: pair.refType,
        })),
      },
      _count: { _all: true },
    });
    for (const row of rows) {
      const key = `${row.setId}::${row.parallelId}::${row.refType || "front"}`;
      countByKey.set(key, row._count._all);
    }
  }
  return countByKey;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const strictGate = Boolean(args["strict-gate"]);
  const allowWeak = !strictGate || Boolean(args["allow-weak"]);
  const noGate = Boolean(args["no-gate"]);
  const noDedupe = Boolean(args["no-dedupe"]);
  const limitVariants = Math.max(1, Number(args["limit-variants"] ?? 50) || 50);
  const imagesPerVariant = Math.max(1, Number(args["images-per-variant"] ?? 3) || 3);
  const delayMs = Math.max(0, Number(args["delay-ms"] ?? 700) || 700);
  const setFilter = args["set-id"] ? String(args["set-id"]).trim() : "";
  const querySetOverride = args["query-set"] ? String(args["query-set"]).trim() : "";
  const maxPlayerSeeds = Math.max(0, Number(args["max-player-seeds"] ?? 24) || 24);
  const maxQueries = Math.max(1, Number(args["max-queries"] ?? 80) || 80);
  const pagesPerQuery = Math.max(1, Number(args["pages-per-query"] ?? 1) || 1);
  const resultsPerPage = Math.max(10, Math.min(240, Number(args["results-per-page"] ?? 100) || 100));
  const mode = String(args.mode || "exhaustive-player").trim().toLowerCase();
  const exhaustivePlayerMode = mode === "exhaustive-player";
  const includeKeywords = false;
  const legacyBroadMode = Boolean(args["legacy-broad-mode"]);
  const exactQuery = !legacyBroadMode;
  const refType = String(args["ref-side"] || "front").trim().toLowerCase() === "back" ? "back" : "front";
  const debugQueries = Boolean(args["debug-queries"]);
  const debugLimit = Math.max(1, Number(args["debug-limit"] ?? 20) || 20);
  const debugMatch = args["debug-match"] ? normalize(String(args["debug-match"])) : "";
  const queryAliases = loadQueryAliasesConfig(args["query-aliases-config"]);
  const checklistPlayersMap = loadChecklistPlayerMap(args["checklist-player-map"] || args["checklist-player-csv"]);
  const apiKey = process.env.SERPAPI_KEY ?? "";

  if (!apiKey) {
    throw new Error("SERPAPI_KEY is required for sports image seeding.");
  }

  const prisma = new PrismaClient();
  try {
    const variants = await prisma.cardVariant.findMany({
      where: {
        ...(setFilter ? { setId: setFilter } : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limitVariants,
      select: {
        setId: true,
        cardNumber: true,
        parallelId: true,
        keywords: true,
        parallelFamily: true,
      },
    });
    const variantsWithRefType = variants.map((variant) => ({ ...variant, refType }));
    const existingCountByKey = exhaustivePlayerMode
      ? new Map()
      : await loadExistingRefCounts(prisma, variantsWithRefType);

    let variantsChecked = 0;
    let variantsSeeded = 0;
    let checklistEntriesChecked = 0;
    let checklistEntriesSeeded = 0;
    let referencesInserted = 0;
    let referencesSkipped = 0;
    let debugPrinted = 0;

    for (const variant of variants) {
      variantsChecked += 1;
      const variantKey = `${variant.setId}::${variant.parallelId}::${refType}`;
      const checklistEntries = exhaustivePlayerMode
        ? deriveChecklistEntries(variant.setId, variant.parallelId, querySetOverride, checklistPlayersMap)
        : [];
      const targets = exhaustivePlayerMode
        ? checklistEntries.length > 0
          ? checklistEntries
          : [{ playerName: "", cardNumber: "" }]
        : [{ playerName: "", cardNumber: "" }];

      const existing = await prisma.cardVariantReferenceImage.findMany({
        where: {
          setId: variant.setId,
          parallelId: variant.parallelId,
          refType,
        },
        select: {
          rawImageUrl: true,
          sourceUrl: true,
          sourceListingId: true,
          playerSeed: true,
        },
      });
      const existingUrls = new Set(
        existing
          .map((row) => canonicalizeUrl(row.rawImageUrl))
          .filter(Boolean)
      );
      const existingSourceUrls = new Set(
        existing
          .map((row) => canonicalizeUrl(row.sourceUrl))
          .filter(Boolean)
      );
      const existingListingIds = new Set(
        existing
          .map((row) => String(row.sourceListingId || "").trim())
          .filter(Boolean)
      );
      const existingByPlayerSeed = new Map();
      for (const row of existing) {
        const key = String(row.playerSeed || "").trim();
        if (!key) continue;
        existingByPlayerSeed.set(key, (existingByPlayerSeed.get(key) || 0) + 1);
      }

      let variantInsertedThisPass = 0;
      for (const target of targets) {
        const playerName = String(target.playerName || "").trim();
        const cardNumber = String(target.cardNumber || "").trim();
        const playerSeedKey = playerName ? `${playerName}::${cardNumber || "NA"}` : "";
        if (exhaustivePlayerMode) {
          checklistEntriesChecked += 1;
          const existingForSeed = existingByPlayerSeed.get(playerSeedKey) || 0;
          if (existingForSeed >= imagesPerVariant) {
            referencesSkipped += imagesPerVariant;
            continue;
          }
        } else {
          const existingCount = existingCountByKey.get(variantKey) ?? 0;
          if (existingCount >= imagesPerVariant) {
            referencesSkipped += imagesPerVariant;
            break;
          }
        }

        const remainingSlots = exhaustivePlayerMode
          ? Math.max(1, imagesPerVariant - (existingByPlayerSeed.get(playerSeedKey) || 0))
          : Math.max(1, imagesPerVariant - (existingCountByKey.get(variantKey) ?? 0));
        const images = await fetchVariantImages(apiKey, variant, remainingSlots, {
          querySetOverride,
          queryAliases,
          checklistPlayersMap,
          maxPlayerSeeds,
          maxQueries,
          pagesPerQuery,
          resultsPerPage,
          includeKeywords,
          exactQuery,
          refSide: refType,
          disableDedupe: noDedupe,
          forcedPlayer: playerName || undefined,
          forcedCardNumber: cardNumber || undefined,
          forcedPlayerSeedKey: playerSeedKey || undefined,
          onQueries: (queries) => {
            if (!debugQueries) return;
            if (debugPrinted >= debugLimit) return;
            const matchHaystack = normalize(`${variant.setId} ${variant.parallelId}`);
            if (debugMatch && !matchHaystack.includes(debugMatch)) return;
            debugPrinted += 1;
            console.log(
              JSON.stringify(
                {
                  debug: "queries",
                  setId: variant.setId,
                  parallelId: variant.parallelId,
                  playerName: playerName || null,
                  cardNumber: cardNumber || null,
                  queries,
                },
                null,
                2
              )
            );
          },
        });
        const toInsert = [];
        for (const image of images) {
          const imageKey = canonicalizeUrl(image.rawImageUrl);
          const sourceKey = canonicalizeUrl(image.sourceUrl);
          if (
            !noDedupe &&
            ((imageKey && existingUrls.has(imageKey)) ||
              (sourceKey && existingSourceUrls.has(sourceKey)) ||
              (image.sourceListingId && existingListingIds.has(image.sourceListingId)))
          ) {
            referencesSkipped += 1;
            continue;
          }
          const gate = scoreReferenceCandidate({
            setId: variant.setId,
            parallelId: variant.parallelId,
            keywords: variant.keywords,
            oddsInfo: null,
            listingTitle: image.listingTitle,
            sourceUrl: image.sourceUrl,
          });
          if (!noGate && !(gate.status === "approved" || (allowWeak && gate.status === "weak"))) {
            referencesSkipped += 1;
            continue;
          }
          if (!noDedupe) {
            if (imageKey) existingUrls.add(imageKey);
            if (sourceKey) existingSourceUrls.add(sourceKey);
            if (image.sourceListingId) existingListingIds.add(image.sourceListingId);
          }
          toInsert.push({
            ...image,
            playerSeed: playerSeedKey || image.playerSeed || null,
          });
        }

        if (!dryRun && toInsert.length > 0) {
          await prisma.cardVariantReferenceImage.createMany({
            data: toInsert.map((image) => ({
              setId: variant.setId,
              parallelId: variant.parallelId,
              refType,
              pairKey: image.sourceListingId
                ? `${variant.setId}::${variant.parallelId}::${image.sourceListingId}`
                : null,
              sourceListingId: image.sourceListingId ?? null,
              playerSeed: image.playerSeed ?? null,
              listingTitle: image.listingTitle ?? null,
              rawImageUrl: image.rawImageUrl,
              sourceUrl: image.sourceUrl,
              cropUrls: [],
              cropEmbeddings: null,
              qualityScore: null,
            })),
          });
        }
        referencesInserted += toInsert.length;
        variantInsertedThisPass += toInsert.length;
        if (exhaustivePlayerMode && toInsert.length > 0) {
          checklistEntriesSeeded += 1;
          existingByPlayerSeed.set(playerSeedKey, (existingByPlayerSeed.get(playerSeedKey) || 0) + toInsert.length);
        }
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
      if (variantInsertedThisPass > 0) variantsSeeded += 1;
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          setFilter: setFilter || null,
          variantsChecked,
          variantsSeeded,
          checklistEntriesChecked: exhaustivePlayerMode ? checklistEntriesChecked : null,
          checklistEntriesSeeded: exhaustivePlayerMode ? checklistEntriesSeeded : null,
          referencesInserted,
          referencesSkipped,
          imagesPerVariant,
          refType,
          noGate,
          noDedupe,
          mode: exhaustivePlayerMode
            ? "exhaustive-player"
            : exactQuery
            ? "sniper-coverage"
            : "legacy-broad",
          checklistPlayerMap: args["checklist-player-map"]
            ? String(args["checklist-player-map"])
            : args["checklist-player-csv"]
            ? String(args["checklist-player-csv"])
            : null,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
