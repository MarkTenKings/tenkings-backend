#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
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

function slugify(value) {
  return normalize(value).replace(/\s+/g, "-");
}

function runNode(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: "pipe",
    cwd,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status || 0,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function parseLastJsonBlock(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim().startsWith("{")) continue;
    const candidate = lines.slice(i).join("\n");
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }
  return null;
}

function boolArg(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const low = String(value).trim().toLowerCase();
  if (["1", "true", "yes"].includes(low)) return true;
  if (["0", "false", "no"].includes(low)) return false;
  return fallback;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(
    process.cwd(),
    String(args.manifest || "data/variants/checklists/checklist-sources.manifest.json")
  );
  const outDir = path.resolve(process.cwd(), String(args["out-dir"] || "data/variants/checklists"));
  const reportPath = path.resolve(
    process.cwd(),
    String(args.out || "data/variants/checklists/checklist-parse-batch-report.json")
  );
  const batchManifestOut = path.resolve(
    process.cwd(),
    String(args["batch-manifest-out"] || "data/variants/checklists/checklist-batch.generated.json")
  );
  const continueOnError = boolArg(args["continue-on-error"], true);
  const allowWarn = boolArg(args["allow-warn"], false);
  const limit = Math.max(0, Number(args.limit || 0));
  const minRows = String(args["min-rows"] || "300");
  const maxMissingCardPct = String(args["max-missing-card-pct"] || "35");
  const maxUnknownParallelPct = String(args["max-unknown-parallel-pct"] || "25");

  const parseScript = path.resolve(process.cwd(), "scripts/variant-db/parse-checklist-players.js");
  const validateScript = path.resolve(process.cwd(), "scripts/variant-db/validate-checklist-output.js");

  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const rows = Array.isArray(raw?.rows) ? raw.rows : [];
  const work = limit > 0 ? rows.slice(0, limit) : rows;

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(batchManifestOut), { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    manifest: path.relative(process.cwd(), manifestPath),
    totalInput: work.length,
    continueOnError,
    allowWarn,
    thresholds: {
      minRows: Number(minRows),
      maxMissingCardPct: Number(maxMissingCardPct),
      maxUnknownParallelPct: Number(maxUnknownParallelPct),
    },
    totals: {
      parsed: 0,
      validatedPass: 0,
      validatedWarn: 0,
      failed: 0,
    },
    rows: [],
  };

  const batchManifest = {
    continueOnError: true,
    allowWarn: false,
    imagesPerVariant: 2,
    delayMs: 100,
    minRefs: 2,
    minRows: Number(minRows),
    maxMissingCardPct: Number(maxMissingCardPct),
    maxUnknownParallelPct: Number(maxUnknownParallelPct),
    sets: [],
  };

  for (const row of work) {
    const setId = String(row?.setId || "").trim();
    const sourceUrl = String(row?.sourceUrl || "").trim();
    if (!setId || !sourceUrl) {
      report.totals.failed += 1;
      report.rows.push({
        setId: setId || null,
        sourceUrl: sourceUrl || null,
        status: "failed",
        reason: "missing setId or sourceUrl",
      });
      if (!continueOnError) break;
      continue;
    }

    const slug = String(row.slug || "").trim() || slugify(setId);
    const csvOut = path.join(outDir, `${slug}.players.csv`);
    const validationOut = path.join(outDir, `${slug}.validation.json`);

    const parseArgsList = ["--set-id", setId, "--in", sourceUrl, "--out", path.relative(process.cwd(), csvOut)];
    if (row.sourceFormat && row.sourceFormat !== "txt") {
      parseArgsList.push("--format", String(row.sourceFormat));
    }
    if (row.sport) {
      parseArgsList.push("--sport", String(row.sport));
    }

    const parseResult = runNode(parseScript, parseArgsList, process.cwd());
    if (parseResult.status !== 0) {
      report.totals.failed += 1;
      report.rows.push({
        setId,
        slug,
        sourceUrl,
        status: "failed",
        step: "parse",
        reason: parseResult.stderr.trim() || parseResult.stdout.trim() || `exit ${parseResult.status}`,
      });
      if (!continueOnError) break;
      continue;
    }

    report.totals.parsed += 1;
    const parseJson = parseLastJsonBlock(parseResult.stdout);

    const validateArgsList = [
      "--csv",
      path.relative(process.cwd(), csvOut),
      "--set-id",
      setId,
      "--min-rows",
      minRows,
      "--max-missing-card-pct",
      maxMissingCardPct,
      "--max-unknown-parallel-pct",
      maxUnknownParallelPct,
      "--out",
      path.relative(process.cwd(), validationOut),
    ];
    const validateResult = runNode(validateScript, validateArgsList, process.cwd());
    if (validateResult.status !== 0) {
      report.totals.failed += 1;
      report.rows.push({
        setId,
        slug,
        sourceUrl,
        csvOut: path.relative(process.cwd(), csvOut),
        status: "failed",
        step: "validate",
        reason: validateResult.stderr.trim() || validateResult.stdout.trim() || `exit ${validateResult.status}`,
      });
      if (!continueOnError) break;
      continue;
    }

    const validationJson = JSON.parse(fs.readFileSync(validationOut, "utf8"));
    if (validationJson.status === "pass") report.totals.validatedPass += 1;
    if (validationJson.status === "warn") report.totals.validatedWarn += 1;

    const acceptedForBatch = validationJson.status === "pass" || (validationJson.status === "warn" && allowWarn);
    if (acceptedForBatch) {
      batchManifest.sets.push({
        setId,
        slug,
        playersCsv: path.relative(process.cwd(), csvOut),
      });
    }

    report.rows.push({
      setId,
      slug,
      sourceUrl,
      sourceFormat: row.sourceFormat || null,
      csvOut: path.relative(process.cwd(), csvOut),
      validationOut: path.relative(process.cwd(), validationOut),
      parseRows: Number(parseJson?.rows || 0) || null,
      parsePrograms: Number(parseJson?.programs || 0) || null,
      validationStatus: validationJson.status,
      acceptedForBatch,
    });
  }

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(batchManifestOut, `${JSON.stringify(batchManifest, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        report: path.relative(process.cwd(), reportPath),
        batchManifest: path.relative(process.cwd(), batchManifestOut),
        totals: report.totals,
        acceptedSets: batchManifest.sets.length,
      },
      null,
      2
    )
  );

  if (report.totals.failed > 0) {
    process.exit(1);
  }
}

main();
