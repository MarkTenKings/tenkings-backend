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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(input) {
  return htmlDecode(String(input || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function inferManufacturer(title) {
  const upper = title.toUpperCase();
  const checks = ["PANINI", "TOPPS", "BOWMAN", "UPPER DECK", "LEAF", "ONYX", "WILD CARD", "PRO SET"];
  for (const name of checks) {
    if (upper.includes(name)) return name;
  }
  return "UNKNOWN";
}

function inferYearFromTitle(title, fallbackYear) {
  const m = String(title).match(/\b(20\d{2})(?:[-/](\d{2,4}))?\b/);
  if (!m) return fallbackYear;
  if (!m[2]) return Number(m[1]);
  const second = m[2].length === 2 ? Number(`20${m[2]}`) : Number(m[2]);
  return Math.min(Number(m[1]), second);
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url} (${res.status})`);
  return res.text();
}

function extractLinks(html) {
  const links = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gis;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = cleanText(m[2].replace(/<[^>]+>/g, " "));
    links.push({ href, text });
  }
  return links;
}

function buildArchiveCandidates(sport, year) {
  if (sport === "baseball") {
    return [
      `https://www.cardboardconnection.com/sports-cards-sets/mlb-baseball-cards/${year}-baseball-cards`,
      `https://www.cardboardconnection.com/sports-cards-sets/mlb-baseball-cards/${year}-baseball`,
    ];
  }
  if (sport === "football") {
    return [
      `https://www.cardboardconnection.com/sports-cards-sets/nfl-football-cards/${year}-football-cards`,
      `https://www.cardboardconnection.com/sports-cards-sets/nfl-football-cards/${year}-football`,
    ];
  }
  const next = year + 1;
  return [
    `https://www.cardboardconnection.com/sports-cards-sets/nba-basketball-cards/${year}-${next}-basketball-cards`,
    `https://www.cardboardconnection.com/sports-cards-sets/nba-basketball-cards/${year}-${next}-basketball`,
    `https://www.cardboardconnection.com/sports-cards-sets/nba-basketball-cards/${year}-${String(next).slice(2)}-basketball-cards`,
    `https://www.cardboardconnection.com/sports-cards-sets/nba-basketball-cards/${year}-${String(next).slice(2)}-basketball`,
  ];
}

function isSetChecklistLink(url, text, sport, year) {
  if (!/^https:\/\/www\.cardboardconnection\.com\//i.test(url)) return false;
  if (!/checklist|set review|cards/i.test(text)) return false;
  const low = `${url} ${text}`.toLowerCase();
  const sportWords =
    sport === "baseball"
      ? ["baseball", "mlb"]
      : sport === "football"
      ? ["football", "nfl"]
      : ["basketball", "nba"];
  if (!sportWords.some((w) => low.includes(w))) return false;
  if (!low.includes(String(year))) return false;
  if (/advent|throwback thursday|now|living set|daily|weekly/i.test(low)) return false;
  return true;
}

async function resolveArchive(sport, year) {
  const candidates = buildArchiveCandidates(sport, year);
  for (const url of candidates) {
    try {
      const html = await fetchText(url);
      return { url, html };
    } catch {
      // try next
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fromYear = Number(args["from-year"] || 2020);
  const toYear = Number(args["to-year"] || 2026);
  const outPath = path.resolve(
    process.cwd(),
    String(args.out || "data/variants/sports/2020-2026/sports-sets.manifest.json")
  );
  const sports = String(args.sports || "baseball,football,basketball")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const delayMs = Math.max(0, Number(args["delay-ms"] || 250));

  const rows = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    for (const sport of sports) {
      const archive = await resolveArchive(sport, year);
      if (!archive) {
        rows.push({
          sport,
          year,
          archiveUrl: null,
          setTitle: null,
          setUrl: null,
          manufacturer: null,
          status: "archive_not_found",
        });
        continue;
      }
      const links = extractLinks(archive.html);
      const dedup = new Map();
      for (const link of links) {
        const href = link.href.startsWith("http") ? link.href : `https://www.cardboardconnection.com${link.href}`;
        if (!isSetChecklistLink(href, link.text, sport, year)) continue;
        if (!dedup.has(href)) dedup.set(href, link.text);
      }
      const urls = Array.from(dedup.entries());
      if (urls.length === 0) {
        rows.push({
          sport,
          year,
          archiveUrl: archive.url,
          setTitle: null,
          setUrl: null,
          manufacturer: null,
          status: "no_sets_found",
        });
      } else {
        for (const [setUrl, setTitleRaw] of urls) {
          const setTitle = cleanText(setTitleRaw);
          rows.push({
            sport,
            year: inferYearFromTitle(setTitle, year),
            archiveUrl: archive.url,
            setTitle,
            setUrl,
            manufacturer: inferManufacturer(setTitle),
            status: "ok",
          });
        }
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  const filtered = rows.filter((row) => row.status === "ok");
  const unique = [];
  const seen = new Set();
  for (const row of filtered) {
    const key = `${row.sport}::${row.year}::${row.setUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  unique.sort((a, b) => a.sport.localeCompare(b.sport) || a.year - b.year || a.setTitle.localeCompare(b.setTitle));

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        fromYear,
        toYear,
        sports,
        discoveredAt: new Date().toISOString(),
        totalDiscovered: unique.length,
        rows: unique,
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
        totalDiscovered: unique.length,
        bySport: sports.reduce((acc, sport) => {
          acc[sport] = unique.filter((row) => row.sport === sport).length;
          return acc;
        }, {}),
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
