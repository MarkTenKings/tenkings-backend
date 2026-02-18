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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = String(args.csv || "").trim();
  if (!input) {
    throw new Error("Missing --csv path");
  }
  const outPath = String(args.out || "data/variants/checklists/player-map.json").trim();
  const targetIn = path.resolve(process.cwd(), input);
  const targetOut = path.resolve(process.cwd(), outPath);
  const raw = fs.readFileSync(targetIn, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV must include header and at least one row");
  }

  const headers = parseCsvRow(lines[0]).map((h) => normalize(h));
  const setIdIndex = headers.findIndex((h) => h === "setid" || h === "set");
  const parallelIdIndex = headers.findIndex((h) => h === "parallelid" || h === "parallel" || h === "insertset");
  const playerNameIndex = headers.findIndex(
    (h) => h === "playername" || h === "player" || h === "name" || h === "athlete"
  );
  if (setIdIndex < 0 || parallelIdIndex < 0 || playerNameIndex < 0) {
    throw new Error("CSV needs columns for setId, parallelId, playerName");
  }

  const setParallelPlayers = {};
  let rowsAccepted = 0;
  for (const line of lines.slice(1)) {
    const cells = parseCsvRow(line);
    const setId = String(cells[setIdIndex] || "").trim();
    const parallelId = String(cells[parallelIdIndex] || "").trim();
    const playerName = String(cells[playerNameIndex] || "").trim();
    if (!setId || !parallelId || !playerName) continue;
    const setKey = normalize(setId);
    const parallelKey = normalize(parallelId);
    if (!setParallelPlayers[setKey]) setParallelPlayers[setKey] = {};
    if (!Array.isArray(setParallelPlayers[setKey][parallelKey])) setParallelPlayers[setKey][parallelKey] = [];
    if (
      !setParallelPlayers[setKey][parallelKey].some(
        (existing) => existing.toLowerCase() === playerName.toLowerCase()
      )
    ) {
      setParallelPlayers[setKey][parallelKey].push(playerName);
      rowsAccepted += 1;
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceCsv: input,
    setParallelPlayers,
  };
  fs.mkdirSync(path.dirname(targetOut), { recursive: true });
  fs.writeFileSync(targetOut, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        out: outPath,
        sets: Object.keys(setParallelPlayers).length,
        rowsAccepted,
      },
      null,
      2
    )
  );
}

main();
