#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
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

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (!value) return [];
  return String(value)
    .split(/\s*[|;]\s*|\s*,\s*/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRow(row) {
  const setId = String(row.setId ?? "").trim();
  const rawCardNumber = String(row.cardNumber ?? "").trim();
  const cardNumber = rawCardNumber || "ALL";
  const parallelId = String(row.parallelId ?? "").trim();
  if (!setId || !cardNumber || !parallelId) return null;

  return {
    setId,
    cardNumber,
    parallelId,
    parallelFamily: row.parallelFamily ? String(row.parallelFamily).trim() : null,
    keywords: [...new Set(normalizeKeywords(row.keywords))],
    oddsInfo:
      row.oddsInfo != null && String(row.oddsInfo).trim()
        ? String(row.oddsInfo).trim()
        : row.odds != null && String(row.odds).trim()
        ? String(row.odds).trim()
        : null,
    sourceUrl: row.sourceUrl ? String(row.sourceUrl).trim() : null,
    rawImageUrl: row.rawImageUrl
      ? String(row.rawImageUrl).trim()
      : row.imageUrl
      ? String(row.imageUrl).trim()
      : null,
  };
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;

  const pushValue = () => {
    current.push(value);
    value = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if (char === '"' && text[i + 1] === '"') {
      value += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      pushValue();
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      pushValue();
      if (current.length > 1 || current[0]) {
        rows.push(current.map((entry) => entry.trim()));
      }
      current = [];
      continue;
    }
    value += char;
  }
  pushValue();
  if (current.length > 1 || current[0]) {
    rows.push(current.map((entry) => entry.trim()));
  }

  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] ?? "";
    });
    return obj;
  });
}

async function readCsvSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to download CSV from ${source} (${response.status})`);
    }
    return response.text();
  }
  const full = path.resolve(process.cwd(), source);
  return fs.readFile(full, "utf8");
}

async function collectCsvRows(sources) {
  const rows = [];
  for (const source of sources) {
    const csvText = await readCsvSource(source);
    const parsed = parseCsv(csvText);
    rows.push(...parsed);
  }
  return rows;
}

function extractPokemonVariantKeys(card) {
  const tcgPrices =
    card && card.tcgplayer && card.tcgplayer.prices && typeof card.tcgplayer.prices === "object"
      ? Object.keys(card.tcgplayer.prices)
      : [];
  if (tcgPrices.length > 0) return tcgPrices;
  return ["standard"];
}

async function collectPokemonRows(options) {
  const query = options.pokemonQuery ?? "supertype:pokemon";
  const pageSize = Math.min(250, Math.max(1, Number(options.pageSize ?? 250) || 250));
  const limit = Math.max(1, Number(options.limit ?? 1000) || 1000);
  const apiBase = options.apiBase ?? "https://api.pokemontcg.io/v2/cards";
  const apiKey = process.env.POKEMONTCG_API_KEY ?? "";

  const rows = [];
  let page = 1;
  const maxRetries = Math.max(0, Number(options.maxRetries ?? 4) || 4);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? 20000) || 20000);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const fetchJsonWithRetry = async (url, init) => {
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (response.ok) {
          return response.json();
        }
        const responseText = await response.text().catch(() => "");
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= maxRetries) {
          const details = responseText ? ` - ${responseText.slice(0, 220)}` : "";
          throw new Error(`Pokemon API request failed (${response.status})${details}`);
        }
      } catch (error) {
        const aborted = error && typeof error === "object" && error.name === "AbortError";
        const networkish = aborted || (error instanceof Error && /fetch|network|timed|socket|EAI_AGAIN/i.test(error.message));
        if (!networkish || attempt >= maxRetries) {
          throw error;
        }
      } finally {
        clearTimeout(timer);
      }

      const backoffMs = Math.min(8000, 500 * Math.pow(2, attempt));
      await sleep(backoffMs);
      attempt += 1;
    }
  };

  while (rows.length < limit) {
    const buildParams = (withSelect) => {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (withSelect) {
        params.set("select", "id,name,number,rarity,subtypes,set,images,tcgplayer");
      }
      return params;
    };

    const headers = apiKey ? { "X-Api-Key": apiKey } : undefined;
    let data;
    try {
      const params = buildParams(true);
      data = await fetchJsonWithRetry(`${apiBase}?${params.toString()}`, { headers });
    } catch (error) {
      if (!(error instanceof Error) || !/failed \(404\)/i.test(error.message)) {
        throw error;
      }
      // Some upstream paths reject select projection with 404; retry plain query.
      const params = buildParams(false);
      data = await fetchJsonWithRetry(`${apiBase}?${params.toString()}`, { headers });
    }

    const cards = Array.isArray(data?.data) ? data.data : [];
    if (cards.length === 0) break;

    for (const card of cards) {
      const setId = card?.set?.name || card?.set?.id || "Pokemon Unknown Set";
      const cardNumber = card?.number ? String(card.number) : "ALL";
      const variantKeys = extractPokemonVariantKeys(card);
      const imageUrl = card?.images?.large || card?.images?.small || null;
      const rarity = card?.rarity ? String(card.rarity) : null;
      const subtypes = Array.isArray(card?.subtypes) ? card.subtypes : [];
      const sourceUrl = card?.id ? `https://www.pokemontcg.io/cards/${card.id}` : null;

      for (const variantKey of variantKeys) {
        rows.push({
          setId,
          cardNumber,
          parallelId: variantKey,
          parallelFamily: "Pokemon Print Variant",
          keywords: [variantKey, rarity, ...subtypes].filter(Boolean),
          oddsInfo: null,
          sourceUrl,
          rawImageUrl: imageUrl,
        });
        if (rows.length >= limit) break;
      }
      if (rows.length >= limit) break;
    }

    if (cards.length < pageSize) break;
    page += 1;
  }

  return rows;
}

async function upsertRows(prisma, rows, options) {
  const dryRun = Boolean(options.dryRun);
  const createOnly = Boolean(options.createOnly);
  const withReferences = Boolean(options.withReferences);

  let variantsUpserted = 0;
  let variantsSkipped = 0;
  let referencesInserted = 0;
  let referencesSkipped = 0;

  for (const row of rows) {
    if (!row) {
      variantsSkipped += 1;
      continue;
    }

    if (dryRun) {
      variantsUpserted += 1;
      if (withReferences && row.rawImageUrl) referencesInserted += 1;
      continue;
    }

    try {
      if (createOnly) {
        await prisma.cardVariant.create({
          data: {
            setId: row.setId,
            cardNumber: row.cardNumber,
            parallelId: row.parallelId,
            parallelFamily: row.parallelFamily,
            keywords: row.keywords,
            oddsInfo: row.oddsInfo,
          },
        });
      } else {
        await prisma.cardVariant.upsert({
          where: {
            setId_cardNumber_parallelId: {
              setId: row.setId,
              cardNumber: row.cardNumber,
              parallelId: row.parallelId,
            },
          },
          update: {
            parallelFamily: row.parallelFamily,
            keywords: row.keywords,
            oddsInfo: row.oddsInfo,
          },
          create: {
            setId: row.setId,
            cardNumber: row.cardNumber,
            parallelId: row.parallelId,
            parallelFamily: row.parallelFamily,
            keywords: row.keywords,
            oddsInfo: row.oddsInfo,
          },
        });
      }
      variantsUpserted += 1;
    } catch {
      variantsSkipped += 1;
      continue;
    }

    if (withReferences && row.rawImageUrl) {
      const existing = await prisma.cardVariantReferenceImage.findFirst({
        where: {
          setId: row.setId,
          cardNumber: row.cardNumber,
          parallelId: row.parallelId,
          rawImageUrl: row.rawImageUrl,
        },
        select: { id: true },
      });
      if (existing) {
        referencesSkipped += 1;
      } else {
        await prisma.cardVariantReferenceImage.create({
          data: {
            setId: row.setId,
            cardNumber: row.cardNumber,
            parallelId: row.parallelId,
            rawImageUrl: row.rawImageUrl,
            sourceUrl: row.sourceUrl ?? null,
            cropUrls: [],
            cropEmbeddings: null,
            qualityScore: null,
          },
        });
        referencesInserted += 1;
      }
    }
  }

  return {
    variantsUpserted,
    variantsSkipped,
    referencesInserted,
    referencesSkipped,
  };
}

function printUsage() {
  console.log(`
Variant DB sync

Usage examples:
  node scripts/variant-db/sync-variant-db.js --source csv --csv frontend/nextjs-app/public/templates/variant-template.csv --dry-run
  node scripts/variant-db/sync-variant-db.js --source csv --csv data/sports.csv --with-references
  node scripts/variant-db/sync-variant-db.js --source pokemontcg --limit 500 --with-references --dry-run
  node scripts/variant-db/sync-variant-db.js --source all --csv data/sports.csv --limit 1500

Flags:
  --source <csv|pokemontcg|all>
  --csv <path-or-url[,path-or-url]>
  --dry-run
  --create-only
  --with-references
  --limit <n>                 (Pokemon only; default 1000)
  --page-size <n>             (Pokemon only; default 250)
  --pokemon-query <query>     (Pokemon only; default "supertype:pokemon")
  --pokemon-api-base <url>    (Pokemon only; default official cards endpoint)
  --max-retries <n>           (Pokemon only; default 4)
  --timeout-ms <n>            (Pokemon only; default 20000)
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    process.exit(0);
  }

  let config = {};
  if (args.config) {
    const configPath = path.resolve(process.cwd(), String(args.config));
    const raw = await fs.readFile(configPath, "utf8");
    config = JSON.parse(raw);
  }

  const merged = {
    source: args.source ?? config.source,
    csv: args.csv ?? (Array.isArray(config.csv) ? config.csv.join(",") : config.csv),
    dryRun: args["dry-run"] || Boolean(config.dryRun),
    createOnly: args["create-only"] || Boolean(config.createOnly),
    withReferences: args["with-references"] || Boolean(config.withReferences),
    limit: args.limit ?? config?.pokemon?.limit ?? config.limit,
    "page-size": args["page-size"] ?? config?.pokemon?.pageSize ?? config.pageSize,
    "pokemon-query": args["pokemon-query"] ?? config?.pokemon?.query ?? config.pokemonQuery,
    "pokemon-api-base": args["pokemon-api-base"] ?? config?.pokemon?.apiBase ?? config.pokemonApiBase,
    "max-retries": args["max-retries"] ?? config?.pokemon?.maxRetries ?? config.maxRetries,
    "timeout-ms": args["timeout-ms"] ?? config?.pokemon?.timeoutMs ?? config.timeoutMs,
  };

  if (!merged.source) {
    printUsage();
    process.exit(1);
  }

  const source = String(merged.source).trim().toLowerCase();
  const sources = source === "all" ? ["csv", "pokemontcg"] : [source];
  const csvSources = splitList(merged.csv);

  const collected = [];

  if (sources.includes("csv")) {
    if (csvSources.length === 0) {
      throw new Error("CSV source selected but no --csv files/URLs were provided.");
    }
    const csvRows = await collectCsvRows(csvSources);
    collected.push(...csvRows);
  }

  if (sources.includes("pokemontcg")) {
    const pokemonRows = await collectPokemonRows({
      limit: merged.limit,
      pageSize: merged["page-size"],
      pokemonQuery: merged["pokemon-query"],
      apiBase: merged["pokemon-api-base"],
      maxRetries: merged["max-retries"],
      timeoutMs: merged["timeout-ms"],
    });
    collected.push(...pokemonRows);
  }

  const normalized = collected.map(normalizeRow).filter(Boolean);

  const prisma = new PrismaClient();
  try {
    const result = await upsertRows(prisma, normalized, {
      dryRun: Boolean(merged.dryRun),
      createOnly: Boolean(merged.createOnly),
      withReferences: Boolean(merged.withReferences),
    });

    console.log(
      JSON.stringify(
        {
          source: merged.source,
          rowsCollected: collected.length,
          rowsNormalized: normalized.length,
          dryRun: Boolean(merged.dryRun),
          ...result,
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
