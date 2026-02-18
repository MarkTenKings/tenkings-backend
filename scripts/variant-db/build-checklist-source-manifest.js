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

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return normalize(value).replace(/\s+/g, "-");
}

function htmlDecode(input) {
  return String(input || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(input) {
  return htmlDecode(String(input || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gis;
  let m;
  while ((m = re.exec(html))) {
    const hrefRaw = String(m[1] || "").trim();
    if (!hrefRaw) continue;
    try {
      const url = new URL(hrefRaw, baseUrl).toString();
      const text = cleanText(String(m[2] || "").replace(/<[^>]+>/g, " "));
      links.push({ href: url, text });
    } catch {
      // ignore malformed URLs
    }
  }
  return links;
}

function guessFormat(url) {
  const low = String(url || "").toLowerCase();
  if (low.includes(".csv")) return "csv";
  if (low.includes(".xlsx") || low.includes(".xls")) return "csv";
  if (low.includes(".pdf")) return "pdf";
  if (low.includes(".txt")) return "txt";
  return "txt";
}

function scoreChecklistLink(link) {
  const haystack = `${link.href} ${link.text}`.toLowerCase();
  let score = 0;
  if (/\bchecklist\b/.test(haystack)) score += 20;
  if (/\b(download|xlsx|xls|spreadsheet|csv)\b/.test(haystack)) score += 20;
  if (/\b(pdf)\b/.test(haystack) || /\.pdf(?:$|\?)/.test(link.href)) score += 10;
  if (/topps\.com|beckett\.com|cardboardconnection\.com|shopify\.com/.test(haystack)) score += 5;
  if (/baseball|basketball|football|nfl|nba|mlb/.test(haystack)) score += 4;
  if (/\/news\//.test(link.href)) score -= 3;
  if (/\/tag\//.test(link.href)) score -= 5;
  if (/\/shop\//.test(link.href)) score -= 6;
  if (/video|youtube|instagram|twitter|facebook/.test(haystack)) score -= 8;
  return score;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url} (${res.status})`);
  return res.text();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(
    process.cwd(),
    String(args.manifest || "data/variants/sports/2020-2026/sports-sets.manifest.json")
  );
  const outPath = path.resolve(
    process.cwd(),
    String(args.out || "data/variants/checklists/checklist-sources.manifest.json")
  );
  const fromYear = Number(args["from-year"] || 2020);
  const toYear = Number(args["to-year"] || 2026);
  const sports = String(args.sports || "baseball,football,basketball")
    .split(",")
    .map((s) => normalize(s))
    .filter(Boolean);
  const manufacturers = String(args.manufacturers || "topps,panini,bowman,upper deck")
    .split(",")
    .map((s) => normalize(s))
    .filter(Boolean);
  const delayMs = Math.max(0, Number(args["delay-ms"] || 120));
  const limit = Math.max(0, Number(args.limit || 0));

  const raw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const rows = Array.isArray(raw?.rows) ? raw.rows : [];
  const filtered = rows.filter((row) => {
    if (!row || row.status !== "ok" || !row.setUrl || !row.setTitle) return false;
    if (Number(row.year || 0) < fromYear || Number(row.year || 0) > toYear) return false;
    if (sports.length && !sports.includes(normalize(row.sport))) return false;
    if (manufacturers.length && !manufacturers.includes(normalize(row.manufacturer))) return false;
    return true;
  });

  const work = limit > 0 ? filtered.slice(0, limit) : filtered;
  const outputRows = [];
  for (const row of work) {
    let sourceUrl = row.setUrl;
    let sourceFormat = "txt";
    let bestScore = -999;
    let candidateCount = 0;
    try {
      const html = await fetchText(row.setUrl);
      const links = extractLinks(html, row.setUrl);
      const candidates = links
        .filter((link) => {
          const hay = `${link.href} ${link.text}`.toLowerCase();
          if (!/\bchecklist\b|xlsx|xls|csv|pdf/.test(hay)) return false;
          return true;
        })
        .map((link) => ({ ...link, score: scoreChecklistLink(link) }))
        .sort((a, b) => b.score - a.score);
      candidateCount = candidates.length;
      if (candidates.length > 0 && candidates[0].score >= 8) {
        sourceUrl = candidates[0].href;
        sourceFormat = guessFormat(candidates[0].href);
        bestScore = candidates[0].score;
      } else {
        sourceUrl = row.setUrl;
        sourceFormat = "txt";
      }
    } catch (error) {
      sourceUrl = row.setUrl;
      sourceFormat = "txt";
      bestScore = -1;
      candidateCount = 0;
    }

    outputRows.push({
      setId: row.setTitle,
      slug: slugify(row.setTitle),
      sport: row.sport || null,
      year: row.year || null,
      manufacturer: row.manufacturer || null,
      setUrl: row.setUrl,
      sourceUrl,
      sourceFormat,
      candidateCount,
      sourceScore: bestScore,
    });
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        manifest: path.relative(process.cwd(), manifestPath),
        filters: {
          fromYear,
          toYear,
          sports,
          manufacturers,
          limit: limit || null,
        },
        total: outputRows.length,
        rows: outputRows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        out: path.relative(process.cwd(), outPath),
        total: outputRows.length,
        pickedExternalChecklistLink: outputRows.filter((r) => r.sourceUrl !== r.setUrl).length,
        fellBackToSetPageText: outputRows.filter((r) => r.sourceUrl === r.setUrl).length,
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
