#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
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

function isUrl(input) {
  return /^https?:\/\//i.test(String(input || ""));
}

async function fetchToFile(url, suffix) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to download checklist (${response.status}) ${text.slice(0, 160)}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const filePath = path.join(os.tmpdir(), `checklist-${Date.now()}-${Math.random().toString(16).slice(2)}${suffix}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function hasPdfToText() {
  const check = spawnSync("pdftotext", ["-v"], { stdio: "ignore" });
  return check.status === 0 || check.status === 1;
}

function extractPdfText(pdfPath) {
  if (!hasPdfToText()) {
    throw new Error(
      "pdftotext is required for PDF parsing. Install poppler-utils (Ubuntu: apt install poppler-utils)."
    );
  }
  const result = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`pdftotext failed (exit ${result.status || 1})`);
  }
  return String(result.stdout || "");
}

function looksLikeSectionHeader(line) {
  if (!line) return false;
  if (line.length < 3 || line.length > 100) return false;
  if (/\d{3,}/.test(line)) return false;
  if (/^page\s+\d+/i.test(line)) return false;
  const hasKeyword = /(insert|parallel|autograph|autos|relic|patch|variation|fo[i1]l|holo|mojo|ballers|topps|rookie|court|gems|kings|school|limit|chrome|rainbow|base)/i.test(
    line
  );
  if (!hasKeyword) return false;
  // Prefer headers with low punctuation and no obvious card code at start.
  if (/^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+/.test(line)) return false;
  return true;
}

function parseCardCodeAndPlayer(line) {
  // Typical checklist row starts with card code then player name.
  const compact = line.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  const bits = compact.split(" ");
  const maybeCode = bits[0] || "";
  const isCode = /^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+[A-Z0-9-]*$/i.test(maybeCode);
  if (!isCode) return null;
  const rest = bits.slice(1).join(" ").trim();
  if (!rest) return null;
  // Drop obvious non-player tails.
  const playerName = rest.replace(/\s+(RC|Rookie Card|SP|SSP)$/i, "").trim();
  if (!/[a-zA-Z]/.test(playerName)) return null;
  return { cardNumber: maybeCode, playerName };
}

function normalizeSectionName(raw) {
  const value = String(raw || "").trim();
  if (!value) return "Unknown";
  return value
    .replace(/\s{2,}/g, " ")
    .replace(/^\d+\.\s*/, "")
    .replace(/\s*checklist$/i, "")
    .trim();
}

function parseToppsChecklistText(text, setId, options = {}) {
  const sectionMap = options.sectionMap || {};
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00A0/g, " ").trim())
    .filter(Boolean);

  const rows = [];
  const dedupe = new Set();
  let currentSection = "Unknown";

  for (const line of lines) {
    if (looksLikeSectionHeader(line)) {
      const normalizedHeader = normalize(line);
      const mapped = sectionMap[normalizedHeader];
      currentSection = normalizeSectionName(mapped || line);
      continue;
    }
    const parsed = parseCardCodeAndPlayer(line);
    if (!parsed) continue;
    const parallelId = currentSection;
    const key = `${normalize(setId)}::${normalize(parallelId)}::${normalize(parsed.playerName)}::${normalize(parsed.cardNumber)}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    rows.push({
      setId,
      parallelId,
      playerName: parsed.playerName,
      cardNumber: parsed.cardNumber,
    });
  }
  return rows;
}

function parseChecklistCsv(csvText, setIdOverride = "") {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]).map((h) => normalize(h));
  const setIdIndex = headers.findIndex((h) => h === "setid" || h === "set");
  const parallelIndex = headers.findIndex((h) => h === "parallelid" || h === "parallel" || h === "insertset");
  const playerIndex = headers.findIndex(
    (h) => h === "playername" || h === "player" || h === "name" || h === "athlete"
  );
  const cardNumberIndex = headers.findIndex((h) => h === "cardnumber" || h === "card" || h === "cardno");
  if (parallelIndex < 0 || playerIndex < 0) {
    throw new Error("CSV requires at least parallelId and playerName columns");
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvRow(line);
    const setId = setIdOverride || String(cells[setIdIndex] || "").trim();
    const parallelId = String(cells[parallelIndex] || "").trim();
    const playerName = String(cells[playerIndex] || "").trim();
    const cardNumber = cardNumberIndex >= 0 ? String(cells[cardNumberIndex] || "").trim() : "";
    if (!setId || !parallelId || !playerName) continue;
    rows.push({ setId, parallelId, playerName, cardNumber });
  }
  return rows;
}

function writePlayersCsv(rows, outPath) {
  const headers = ["setId", "parallelId", "playerName", "cardNumber"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.setId),
        csvEscape(row.parallelId),
        csvEscape(row.playerName),
        csvEscape(row.cardNumber || ""),
      ].join(",")
    );
  }
  const target = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${lines.join("\n")}\n`, "utf8");
}

function loadSectionMap(mapPath) {
  if (!mapPath) return {};
  const target = path.resolve(process.cwd(), String(mapPath));
  if (!fs.existsSync(target)) return {};
  try {
    const raw = fs.readFileSync(target, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const setId = String(args["set-id"] || "").trim();
  if (!setId) throw new Error("Missing --set-id");
  const input = String(args.in || args.input || "").trim();
  if (!input) throw new Error("Missing --in input path or URL");
  const out = String(args.out || "data/variants/checklists/players.csv").trim();
  const format = String(args.format || "auto").trim().toLowerCase();
  const sectionMap = loadSectionMap(args["section-map"]);

  let localPath = "";
  let temporary = false;
  try {
    if (isUrl(input)) {
      const suffix = /\.pdf(?:$|\?)/i.test(input)
        ? ".pdf"
        : /\.csv(?:$|\?)/i.test(input)
        ? ".csv"
        : /\.txt(?:$|\?)/i.test(input)
        ? ".txt"
        : ".bin";
      localPath = await fetchToFile(input, suffix);
      temporary = true;
    } else {
      localPath = path.resolve(process.cwd(), input);
    }

    if (!fs.existsSync(localPath)) {
      throw new Error(`Input file not found: ${localPath}`);
    }

    const ext = path.extname(localPath).toLowerCase();
    let rows = [];
    if (format === "csv" || ext === ".csv") {
      rows = parseChecklistCsv(fs.readFileSync(localPath, "utf8"), setId);
    } else if (format === "txt" || ext === ".txt") {
      rows = parseToppsChecklistText(fs.readFileSync(localPath, "utf8"), setId, { sectionMap });
    } else if (format === "pdf" || ext === ".pdf" || format === "auto") {
      const text = ext === ".pdf" ? extractPdfText(localPath) : fs.readFileSync(localPath, "utf8");
      rows = parseToppsChecklistText(text, setId, { sectionMap });
      if (rows.length === 0 && ext !== ".pdf") {
        // fallback if auto was pointed at csv-ish text file
        rows = parseChecklistCsv(text, setId);
      }
    } else {
      throw new Error(`Unsupported format for input: ${ext || "unknown"}`);
    }

    if (!rows.length) {
      throw new Error(
        "No checklist player rows parsed. Try --format csv/txt/pdf explicitly or provide --section-map."
      );
    }

    writePlayersCsv(rows, out);
    const uniquePrograms = new Set(rows.map((row) => normalize(row.parallelId)));
    console.log(
      JSON.stringify(
        {
          setId,
          input,
          out,
          rows: rows.length,
          programs: uniquePrograms.size,
        },
        null,
        2
      )
    );
  } finally {
    if (temporary && localPath) {
      try {
        fs.unlinkSync(localPath);
      } catch {}
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
