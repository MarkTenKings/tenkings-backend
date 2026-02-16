#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

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
    headers.forEach((header, idx) => {
      obj[header] = row[idx] ?? "";
    });
    return obj;
  });
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(rows) {
  const headers = [
    "setId",
    "cardNumber",
    "parallelId",
    "parallelFamily",
    "keywords",
    "oddsInfo",
    "sourceUrl",
    "rawImageUrl",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((key) => csvEscape(row[key] ?? ""));
    lines.push(values.join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function readTextSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to download source: ${source} (${response.status})`);
    }
    return response.text();
  }
  const full = path.resolve(process.cwd(), source);
  return fs.readFile(full, "utf8");
}

function normalizeRow(row, sourceName, defaults) {
  const setId = String(row.setId ?? defaults.setId ?? "").trim();
  const cardNumber = String(row.cardNumber ?? defaults.cardNumber ?? "ALL").trim() || "ALL";
  const parallelId = String(row.parallelId ?? defaults.parallelId ?? "").trim();
  if (!setId || !parallelId) return null;

  const keywordRaw = row.keywords ?? defaults.keywords ?? "";
  const keywords = Array.isArray(keywordRaw)
    ? keywordRaw
    : String(keywordRaw || "")
        .split(/\s*[|;]\s*|\s*,\s*/g)
        .map((entry) => entry.trim())
        .filter(Boolean);

  return {
    setId,
    cardNumber,
    parallelId,
    parallelFamily: String(row.parallelFamily ?? defaults.parallelFamily ?? "").trim(),
    keywords: [...new Set(keywords)].join("|"),
    oddsInfo: String(row.oddsInfo ?? row.odds ?? defaults.oddsInfo ?? "").trim(),
    sourceUrl: String(row.sourceUrl ?? defaults.sourceUrl ?? "").trim(),
    rawImageUrl: String(row.rawImageUrl ?? row.imageUrl ?? defaults.rawImageUrl ?? "").trim(),
    _source: sourceName,
  };
}

async function collectFromSource(definition) {
  const name = definition.name || definition.path || definition.url || "source";
  const kind = String(definition.kind || "csv").toLowerCase();
  const defaults = definition.defaults || {};

  let rows = [];
  if (kind === "inline") {
    rows = Array.isArray(definition.rows) ? definition.rows : [];
  } else if (kind === "csv") {
    const source = definition.path || definition.url;
    if (!source) throw new Error(`Source "${name}" missing path/url.`);
    const text = await readTextSource(source);
    rows = parseCsv(text);
  } else if (kind === "json") {
    const source = definition.path || definition.url;
    if (!source) throw new Error(`Source "${name}" missing path/url.`);
    const text = await readTextSource(source);
    const payload = JSON.parse(text);
    rows = Array.isArray(payload) ? payload : Array.isArray(payload.rows) ? payload.rows : [];
  } else {
    throw new Error(`Unsupported source kind "${kind}" in ${name}`);
  }

  return rows.map((row) => normalizeRow(row, name, defaults)).filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(
    process.cwd(),
    String(args.config || "scripts/variant-db/sports-sources.example.json")
  );
  const outPath = path.resolve(
    process.cwd(),
    String(args.out || "data/variants/sports.auto.csv")
  );
  const dryRun = Boolean(args["dry-run"]);

  const raw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(raw);
  const sources = Array.isArray(config.sources) ? config.sources : [];
  if (sources.length === 0) {
    throw new Error(`No sources configured in ${configPath}`);
  }

  const collected = [];
  for (const source of sources) {
    const rows = await collectFromSource(source);
    collected.push(...rows);
  }

  const dedupedMap = new Map();
  for (const row of collected) {
    const key = `${row.setId}::${row.cardNumber}::${row.parallelId}`;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, row);
      continue;
    }
    const prev = dedupedMap.get(key);
    dedupedMap.set(key, {
      ...prev,
      parallelFamily: prev.parallelFamily || row.parallelFamily,
      keywords: prev.keywords || row.keywords,
      oddsInfo: prev.oddsInfo || row.oddsInfo,
      sourceUrl: prev.sourceUrl || row.sourceUrl,
      rawImageUrl: prev.rawImageUrl || row.rawImageUrl,
    });
  }
  const deduped = Array.from(dedupedMap.values())
    .sort((a, b) => {
      const bySet = a.setId.localeCompare(b.setId);
      if (bySet !== 0) return bySet;
      const byCard = a.cardNumber.localeCompare(b.cardNumber);
      if (byCard !== 0) return byCard;
      return a.parallelId.localeCompare(b.parallelId);
    });

  if (!dryRun) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, writeCsv(deduped), "utf8");
  }

  console.log(
    JSON.stringify(
      {
        config: path.relative(process.cwd(), configPath),
        out: path.relative(process.cwd(), outPath),
        dryRun,
        sources: sources.length,
        rowsCollected: collected.length,
        rowsDeduped: deduped.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
