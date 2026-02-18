#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
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

function toPct(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const csv = String(args.csv || "").trim();
  if (!csv) throw new Error("Missing --csv path");

  const setIdFilter = String(args["set-id"] || "").trim();
  const outPath = String(args.out || "data/variants/checklists/validation-report.json").trim();
  const minRows = Math.max(0, Number(args["min-rows"] ?? 1) || 1);
  const maxMissingCardPct = Math.max(0, Number(args["max-missing-card-pct"] ?? 35) || 35);
  const maxUnknownParallelPct = Math.max(0, Number(args["max-unknown-parallel-pct"] ?? 25) || 25);
  const topN = Math.max(1, Number(args["top-n"] ?? 20) || 20);

  const targetCsv = path.resolve(process.cwd(), csv);
  const targetOut = path.resolve(process.cwd(), outPath);
  const raw = fs.readFileSync(targetCsv, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV must include header and at least one row");

  const headers = parseCsvRow(lines[0]).map((h) => normalize(h));
  const setIdIndex = headers.findIndex((h) => h === "setid" || h === "set");
  const parallelIndex = headers.findIndex((h) => h === "parallelid" || h === "parallel" || h === "insertset");
  const playerIndex = headers.findIndex((h) => h === "playername" || h === "player" || h === "name" || h === "athlete");
  const cardNumberIndex = headers.findIndex((h) => h === "cardnumber" || h === "card" || h === "cardno");
  if (setIdIndex < 0 || parallelIndex < 0 || playerIndex < 0) {
    throw new Error("CSV needs columns for setId, parallelId, playerName");
  }

  const genericParallelKeys = new Set(["unknown", "insert", "inserts", "parallel", "parallels", "base set"]);
  const allRows = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvRow(line);
    const setId = String(cells[setIdIndex] || "").trim();
    const parallelId = String(cells[parallelIndex] || "").trim();
    const playerName = String(cells[playerIndex] || "").trim();
    const cardNumber = cardNumberIndex >= 0 ? String(cells[cardNumberIndex] || "").trim() : "";
    if (!setId || !parallelId || !playerName) continue;
    if (setIdFilter && normalize(setId) !== normalize(setIdFilter)) continue;
    allRows.push({ setId, parallelId, playerName, cardNumber });
  }

  const parallelCounts = new Map();
  const uniquePlayers = new Set();
  let rowsMissingCardNumber = 0;
  let rowsUnknownParallel = 0;
  for (const row of allRows) {
    uniquePlayers.add(normalize(row.playerName));
    const key = row.parallelId;
    parallelCounts.set(key, (parallelCounts.get(key) || 0) + 1);
    if (!row.cardNumber) rowsMissingCardNumber += 1;
    if (genericParallelKeys.has(normalize(row.parallelId))) rowsUnknownParallel += 1;
  }

  const totalRows = allRows.length;
  const missingCardPct = toPct(rowsMissingCardNumber, totalRows);
  const unknownParallelPct = toPct(rowsUnknownParallel, totalRows);
  const distinctParallelIds = parallelCounts.size;

  const issues = [];
  let status = "pass";
  if (totalRows < minRows) {
    status = "fail";
    issues.push(`totalRows ${totalRows} is below minRows ${minRows}`);
  }
  if (missingCardPct > maxMissingCardPct) {
    status = status === "fail" ? "fail" : "warn";
    issues.push(`missingCardPct ${missingCardPct}% exceeds maxMissingCardPct ${maxMissingCardPct}%`);
  }
  if (unknownParallelPct > maxUnknownParallelPct) {
    status = status === "fail" ? "fail" : "warn";
    issues.push(`unknownParallelPct ${unknownParallelPct}% exceeds maxUnknownParallelPct ${maxUnknownParallelPct}%`);
  }

  const topParallels = [...parallelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([parallelId, rows]) => ({ parallelId, rows }));

  const report = {
    generatedAt: new Date().toISOString(),
    csv,
    setIdFilter: setIdFilter || null,
    status,
    issues,
    thresholds: {
      minRows,
      maxMissingCardPct,
      maxUnknownParallelPct,
    },
    metrics: {
      totalRows,
      distinctParallelIds,
      distinctPlayers: uniquePlayers.size,
      rowsMissingCardNumber,
      missingCardPct,
      rowsUnknownParallel,
      unknownParallelPct,
    },
    topParallels,
  };

  fs.mkdirSync(path.dirname(targetOut), { recursive: true });
  fs.writeFileSync(targetOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
