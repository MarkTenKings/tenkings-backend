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

function htmlDecode(input) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(input) {
  return htmlDecode(String(input || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
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
    lines.push(headers.map((h) => csvEscape(row[h] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url} (${res.status})`);
  return res.text();
}

function extractSetTitle(html, fallback) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!h1) return fallback;
  const title = cleanText(h1[1]);
  return title || fallback;
}

function splitParallelTokens(raw) {
  return String(raw || "")
    .split(/,|•|\||;|\n/g)
    .map((s) => cleanText(s))
    .map((s) => s.replace(/\s*\([^)]*?\)\s*/g, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 2 && s.length <= 80)
    .filter((s) => !/^(none|n\/a)$/i.test(s));
}

function extractParallels(html) {
  const found = [];

  const inlineStrong = /PARALLEL CARDS?:<\/strong>\s*([^<]{2,1200})/gi;
  let m;
  while ((m = inlineStrong.exec(html))) {
    found.push(...splitParallelTokens(m[1]));
  }

  const headingSection = /PARALLEL CARDS?[\s\S]{0,5000}?(?:<\/ul>|<\/p>|<\/div>)/gi;
  let s;
  while ((s = headingSection.exec(html))) {
    const segment = s[0]
      .replace(/<li[^>]*>/gi, "\n")
      .replace(/<\/li>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n");
    found.push(...splitParallelTokens(cleanText(segment).replace(/\s-\s/g, ",")));
  }

  const unique = [];
  const seen = new Set();
  for (const item of found) {
    const normalized = item
      .toLowerCase()
      .replace(/[^a-z0-9/#+\-\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized || normalized.length < 2) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(item);
  }

  return unique.slice(0, 160);
}

function inferKeywords(setTitle, sport, manufacturer, parallel) {
  return [sport, manufacturer, setTitle, parallel]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("|");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(
    process.cwd(),
    String(args.manifest || "data/variants/sports/2020-2026/sports-sets.manifest.json")
  );
  const outPath = path.resolve(
    process.cwd(),
    String(args.out || "data/variants/sports/2020-2026/sports-variants.auto.csv")
  );
  const delayMs = Math.max(0, Number(args["delay-ms"] || 300));
  const maxSets = Math.max(1, Number(args["max-sets"] || 1000));

  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const rows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const sets = rows.slice(0, maxSets);

  const csvRows = [];
  let setsScanned = 0;
  let setsWithParallels = 0;
  for (const entry of sets) {
    const setUrl = String(entry.setUrl || "").trim();
    if (!setUrl) continue;
    setsScanned += 1;
    try {
      const html = await fetchText(setUrl);
      const setTitle = extractSetTitle(html, String(entry.setTitle || "").trim() || "Unknown Set");
      const parallels = extractParallels(html);
      if (parallels.length > 0) setsWithParallels += 1;
      for (const parallelId of parallels) {
        csvRows.push({
          setId: setTitle,
          cardNumber: "ALL",
          parallelId,
          parallelFamily: "",
          keywords: inferKeywords(setTitle, entry.sport, entry.manufacturer, parallelId),
          oddsInfo: "",
          sourceUrl: setUrl,
          rawImageUrl: "",
        });
      }
    } catch {
      // skip noisy set pages
    }
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const dedupMap = new Map();
  for (const row of csvRows) {
    const key = `${row.setId}::${row.cardNumber}::${row.parallelId}`;
    if (!dedupMap.has(key)) dedupMap.set(key, row);
  }
  const deduped = Array.from(dedupMap.values()).sort(
    (a, b) => a.setId.localeCompare(b.setId) || a.parallelId.localeCompare(b.parallelId)
  );

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, writeCsv(deduped), "utf8");

  console.log(
    JSON.stringify(
      {
        manifest: path.relative(process.cwd(), manifestPath),
        out: path.relative(process.cwd(), outPath),
        setsScanned,
        setsWithParallels,
        variantsExtracted: deduped.length,
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
