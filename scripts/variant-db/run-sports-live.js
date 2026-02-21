#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
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

function nowStamp() {
  const iso = new Date().toISOString();
  return iso.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  const normalized = normalize(value).replace(/\s+/g, "-");
  return normalized || "set";
}

function runNode(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    cwd: options.cwd || process.cwd(),
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status || 0;
}

function runNodeOrThrow(script, args, options = {}) {
  const status = runNode(script, args, options);
  if (status !== 0) {
    throw new Error(`${path.basename(script)} exited with code ${status}`);
  }
}

function runNodeCaptureOrThrow(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8",
    cwd: options.cwd || process.cwd(),
    env: process.env,
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    throw result.error;
  }
  const status = result.status || 0;
  if (status !== 0) {
    const parsed = tryParseLastJsonObject(String(result.stdout || ""));
    if (parsed && parsed.reasonCode) {
      throw new Error(`${parsed.reasonCode}: ${parsed.message || `${path.basename(script)} exited with code ${status}`}`);
    }
    throw new Error(`${path.basename(script)} exited with code ${status}`);
  }
  return String(result.stdout || "");
}

function classifyFailureReason(error) {
  const message = String(error instanceof Error ? error.message : error || "");
  const normalized = normalize(message);
  if (normalized.includes("missing required env")) return "env_missing";
  if (normalized.includes("serpapi key is required")) return "env_missing";
  if (normalized.includes("environment variable not found database url")) return "env_missing";
  if (normalized.includes("set_timeout") || normalized.includes("set timeout")) return "set_timeout";
  if (normalized.includes("player_timeout") || normalized.includes("player timeout")) return "player_timeout";
  if (normalized.includes("request_timeout") || normalized.includes("request timeout")) return "request_timeout";
  if (normalized.includes("player_map_coverage_low")) return "player_map_coverage_low";
  if (normalized.includes("validation failed")) return "validation_failed";
  if (normalized.includes("validation warning blocked")) return "validation_warn_blocked";
  if (normalized.includes("timed out")) return "process_timeout";
  return "seed_failed";
}

function ensureRequiredEnv(keys) {
  const missing = keys.filter((key) => !String(process.env[key] || "").trim());
  if (missing.length === 0) return;
  throw new Error(`missing required env: ${missing.join(", ")}`);
}

function writeQuarantine(logDir, slug, payload) {
  const quarantineDir = path.join(logDir, "quarantine");
  fs.mkdirSync(quarantineDir, { recursive: true });
  const file = path.join(quarantineDir, `${slug}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

function tryParseLastJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const start = raw.lastIndexOf("\n{");
  const candidate = start >= 0 ? raw.slice(start + 1).trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function loadProvenanceBySetId() {
  const target = path.resolve(process.cwd(), "data/variants/checklists/checklist-source-provenance.csv");
  if (!fs.existsSync(target)) return new Map();
  const raw = fs.readFileSync(target, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return new Map();
  const headers = parseCsvRow(lines[0]).map((h) => normalize(h));
  const setIdIndex = headers.findIndex((h) => h === "setid");
  const urlIndex = headers.findIndex((h) => h === "sourceurl");
  if (setIdIndex < 0 || urlIndex < 0) return new Map();
  const bySet = new Map();
  for (const line of lines.slice(1)) {
    const cells = parseCsvRow(line);
    const setId = String(cells[setIdIndex] || "").trim();
    const url = String(cells[urlIndex] || "").trim();
    if (!setId || !url) continue;
    const key = normalize(setId);
    const existing = bySet.get(key) || [];
    if (!existing.includes(url)) existing.push(url);
    bySet.set(key, existing);
  }
  return bySet;
}

function computePlayerMapCoverage(setId, validation, playerMapJson) {
  const setKey = normalize(setId);
  const entries = playerMapJson?.setParallelEntries?.[setKey] || {};
  let mappedRows = 0;
  const mappedPlayers = new Set();
  for (const list of Object.values(entries)) {
    if (!Array.isArray(list)) continue;
    mappedRows += list.length;
    for (const row of list) {
      const name = normalize(row?.playerName || "");
      if (name) mappedPlayers.add(name);
    }
  }
  const totalRows = Number(validation?.metrics?.totalRows || 0);
  const distinctPlayers = Number(validation?.metrics?.distinctPlayers || 0);
  const rowCoveragePct = totalRows > 0 ? (mappedRows / totalRows) * 100 : 0;
  const playerCoveragePct = distinctPlayers > 0 ? (mappedPlayers.size / distinctPlayers) * 100 : 0;
  return {
    totalRows,
    distinctPlayers,
    mappedRows,
    mappedDistinctPlayers: mappedPlayers.size,
    rowCoveragePct: Number(rowCoveragePct.toFixed(2)),
    playerCoveragePct: Number(playerCoveragePct.toFixed(2)),
  };
}

function sourceFormatHintFromUrl(url) {
  const text = String(url || "").toLowerCase();
  if (text.includes(".pdf")) return "pdf";
  if (text.includes(".csv")) return "csv";
  if (text.includes(".txt")) return "txt";
  return "";
}

function uniqueStrings(values) {
  const out = [];
  for (const value of values || []) {
    const next = String(value || "").trim();
    if (!next) continue;
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

function buildSourceCandidates(entry, setId, provenanceBySetId) {
  const fromEntry = uniqueStrings([
    entry?.sourceUrl,
    entry?.setUrl,
    ...(Array.isArray(entry?.sourceUrls) ? entry.sourceUrls : []),
  ]);
  const fromProvenance = uniqueStrings(provenanceBySetId.get(normalize(setId)) || []);
  return uniqueStrings([...fromEntry, ...fromProvenance]);
}

function boolFromArg(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return defaultValue;
}

function getLogDir(args) {
  const explicit = String(args["batch-log-dir"] || "").trim();
  const out = explicit || path.join("logs", "seed-batch", nowStamp());
  const target = path.resolve(process.cwd(), out);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function resolveManifestSets(manifest) {
  if (Array.isArray(manifest)) return manifest;
  if (manifest && Array.isArray(manifest.sets)) return manifest.sets;
  throw new Error("Manifest must be an array or an object with a sets array");
}

function runManifestBatch(args) {
  const manifestPath = String(args.manifest || "").trim();
  if (!manifestPath) throw new Error("Missing --manifest path");

  const manifestFile = path.resolve(process.cwd(), manifestPath);
  const manifest = loadJson(manifestFile);
  const manifestSets = resolveManifestSets(manifest);
  const setIdFilter = String(args["set-id"] || "").trim();
  const sets = setIdFilter
    ? manifestSets.filter((entry) => normalize(entry?.setId) === normalize(setIdFilter))
    : manifestSets;
  if (setIdFilter && sets.length === 0) {
    throw new Error(`No manifest set matched --set-id "${setIdFilter}"`);
  }
  const allowWarnGlobal = boolFromArg(args["allow-warn"], boolFromArg(manifest.allowWarn, false));
  const continueOnError = boolFromArg(
    args["continue-on-error"],
    !Boolean(args["stop-on-error"]) && boolFromArg(manifest.continueOnError, true)
  );
  const dryRun = Boolean(args["dry-run"]);
  const logDir = getLogDir(args);
  const provenanceBySetId = loadProvenanceBySetId();
  const defaultImagesPerVariant = String(args["images-per-variant"] || manifest.imagesPerVariant || "2");
  const defaultDelayMs = String(args["delay-ms"] || manifest.delayMs || "100");
  const defaultMinRefs = String(args["min-refs"] || manifest.minRefs || defaultImagesPerVariant);
  const defaultRefSide = String(args["ref-side"] || manifest.refSide || "front");
  const seedSetTimeoutMs = Math.max(10_000, Number(args["seed-set-timeout-ms"] || manifest.seedSetTimeoutMs || 900_000) || 900_000);
  const defaultMinMapRowCoveragePct = Number(
    args["min-player-map-row-coverage-pct"] ?? manifest.minPlayerMapRowCoveragePct ?? 90
  );
  const defaultMinMapPlayerCoveragePct = Number(
    args["min-player-map-player-coverage-pct"] ?? manifest.minPlayerMapPlayerCoveragePct ?? 90
  );
  const globalLimitVariants = args["limit-variants"];

  const validateScript = path.resolve(process.cwd(), "scripts/variant-db/validate-checklist-output.js");
  const mapScript = path.resolve(process.cwd(), "scripts/variant-db/build-checklist-player-map.js");
  const parseChecklistScript = path.resolve(process.cwd(), "scripts/variant-db/parse-checklist-players.js");
  const seedScript = path.resolve(process.cwd(), "scripts/variant-db/seed-sports-reference-images.js");
  const queueScript = path.resolve(process.cwd(), "scripts/variant-db/build-qa-gap-queue.js");

  const summary = {
    generatedAt: new Date().toISOString(),
    manifest: manifestPath,
    setIdFilter: setIdFilter || null,
    logDir: path.relative(process.cwd(), logDir),
    allowWarn: allowWarnGlobal,
    continueOnError,
    dryRun,
    totals: {
      sets: sets.length,
      passed: 0,
      warned: 0,
      failed: 0,
    },
    sets: [],
  };

  for (const entry of sets) {
    const setId = String(entry?.setId || "").trim();
    const playersCsv = String(entry?.playersCsv || "").trim();
    if (!setId || !playersCsv) {
      const invalid = {
        setId: setId || null,
        slug: String(entry?.slug || "").trim() || null,
        status: "failed",
        reason: "manifest entry missing setId or playersCsv",
      };
      summary.totals.failed += 1;
      summary.sets.push(invalid);
      if (!continueOnError) break;
      continue;
    }

    const slug = String(entry.slug || "").trim() || slugify(setId);
    const imagesPerVariant = String(entry.imagesPerVariant || defaultImagesPerVariant);
    const delayMs = String(entry.delayMs || defaultDelayMs);
    const minRefs = String(entry.minRefs || defaultMinRefs);
    const refSide = String(entry.refSide || defaultRefSide);
    const allowWarnSet = boolFromArg(entry.allowWarn, allowWarnGlobal);
    const limitVariantsValue = entry["limitVariants"] ?? entry["limit-variants"] ?? globalLimitVariants;

    const validateOut = path.join(logDir, `${slug}.validate.json`);
    const playerMapOut = path.resolve(process.cwd(), "data", "variants", "checklists", `${slug}.player-map.json`);
    const queueOut = path.join(logDir, `${slug}.qa-gap-queue.json`);

    const setSummary = {
      setId,
      slug,
      playersCsv,
      status: "pending",
      validation: null,
      queueCount: null,
      refsInserted: null,
      seedDiagnostics: null,
      playerMapCoverage: null,
      failedReason: null,
      reason: null,
    };

    try {
      const validateArgs = [
        "--csv",
        playersCsv,
        "--set-id",
        setId,
        "--out",
        validateOut,
      ];
      const minRows = entry.minRows ?? manifest.minRows ?? args["min-rows"];
      const maxMissingCardPct = entry.maxMissingCardPct ?? manifest.maxMissingCardPct ?? args["max-missing-card-pct"];
      const maxUnknownParallelPct =
        entry.maxUnknownParallelPct ?? manifest.maxUnknownParallelPct ?? args["max-unknown-parallel-pct"];
      if (minRows !== undefined) validateArgs.push("--min-rows", String(minRows));
      if (maxMissingCardPct !== undefined) validateArgs.push("--max-missing-card-pct", String(maxMissingCardPct));
      if (maxUnknownParallelPct !== undefined)
        validateArgs.push("--max-unknown-parallel-pct", String(maxUnknownParallelPct));

      runNodeOrThrow(validateScript, validateArgs);
      const validation = loadJson(validateOut);
      setSummary.validation = validation.status;
      if (validation.status === "fail") {
        throw new Error(`validation failed: ${validation.issues.join("; ") || "unknown reason"}`);
      }
      if (validation.status === "warn" && !allowWarnSet) {
        throw new Error(`validation warning blocked: ${validation.issues.join("; ") || "warn status"}`);
      }

      const minMapRowCoveragePct = Number(
        entry.minPlayerMapRowCoveragePct ??
          entry["min-player-map-row-coverage-pct"] ??
          defaultMinMapRowCoveragePct
      );
      const minMapPlayerCoveragePct = Number(
        entry.minPlayerMapPlayerCoveragePct ??
          entry["min-player-map-player-coverage-pct"] ??
          defaultMinMapPlayerCoveragePct
      );
      const sourceFallbackEnabled = boolFromArg(
        entry.sourceFallback ?? entry["source-fallback"] ?? args["source-fallback"] ?? manifest.sourceFallback,
        true
      );
      const sourceCandidates = buildSourceCandidates(entry, setId, provenanceBySetId);

      let activePlayersCsv = playersCsv;
      let activePlayerMapOut = playerMapOut;
      runNodeOrThrow(mapScript, ["--csv", activePlayersCsv, "--out", path.relative(process.cwd(), activePlayerMapOut)]);
      let activePlayerMapJson = loadJson(activePlayerMapOut);
      let coverage = computePlayerMapCoverage(setId, validation, activePlayerMapJson);
      setSummary.playerMapCoverage = coverage;

      if (coverage.rowCoveragePct < minMapRowCoveragePct || coverage.playerCoveragePct < minMapPlayerCoveragePct) {
        const fallbackResults = [];
        if (sourceFallbackEnabled && sourceCandidates.length > 0) {
          const fallbackDir = path.join(logDir, "fallback");
          fs.mkdirSync(fallbackDir, { recursive: true });
          for (let i = 0; i < sourceCandidates.length; i += 1) {
            const sourceUrl = sourceCandidates[i];
            const fallbackCsvOut = path.join(fallbackDir, `${slug}.fallback-${i + 1}.players.csv`);
            const fallbackValidateOut = path.join(fallbackDir, `${slug}.fallback-${i + 1}.validate.json`);
            const fallbackMapOut = path.join(fallbackDir, `${slug}.fallback-${i + 1}.player-map.json`);
            const parseArgs = [
              "--set-id",
              setId,
              "--in",
              sourceUrl,
              "--out",
              path.relative(process.cwd(), fallbackCsvOut),
            ];
            const hintedFormat = sourceFormatHintFromUrl(sourceUrl);
            if (hintedFormat) {
              parseArgs.push("--format", hintedFormat);
            }
            const parseResult = runNode(parseChecklistScript, parseArgs);
            if (parseResult !== 0) {
              fallbackResults.push({
                sourceUrl,
                status: "parse_failed",
              });
              continue;
            }
            const fallbackValidateArgs = [
              "--csv",
              path.relative(process.cwd(), fallbackCsvOut),
              "--set-id",
              setId,
              "--out",
              path.relative(process.cwd(), fallbackValidateOut),
            ];
            if (minRows !== undefined) fallbackValidateArgs.push("--min-rows", String(minRows));
            if (maxMissingCardPct !== undefined)
              fallbackValidateArgs.push("--max-missing-card-pct", String(maxMissingCardPct));
            if (maxUnknownParallelPct !== undefined)
              fallbackValidateArgs.push("--max-unknown-parallel-pct", String(maxUnknownParallelPct));
            runNodeOrThrow(validateScript, fallbackValidateArgs);
            const fallbackValidation = loadJson(fallbackValidateOut);
            runNodeOrThrow(mapScript, [
              "--csv",
              path.relative(process.cwd(), fallbackCsvOut),
              "--out",
              path.relative(process.cwd(), fallbackMapOut),
            ]);
            const fallbackMapJson = loadJson(fallbackMapOut);
            const fallbackCoverage = computePlayerMapCoverage(setId, fallbackValidation, fallbackMapJson);
            fallbackResults.push({
              sourceUrl,
              status: "ok",
              validation: fallbackValidation.status,
              coverage: fallbackCoverage,
              playersCsv: path.relative(process.cwd(), fallbackCsvOut),
            });
            const meetsThreshold =
              fallbackCoverage.rowCoveragePct >= minMapRowCoveragePct &&
              fallbackCoverage.playerCoveragePct >= minMapPlayerCoveragePct &&
              (fallbackValidation.status === "pass" || (fallbackValidation.status === "warn" && allowWarnSet));
            if (!meetsThreshold) continue;
            activePlayersCsv = path.relative(process.cwd(), fallbackCsvOut);
            activePlayerMapOut = fallbackMapOut;
            activePlayerMapJson = fallbackMapJson;
            coverage = fallbackCoverage;
            setSummary.validation = fallbackValidation.status;
            setSummary.playerMapCoverage = coverage;
            setSummary.fallback = {
              used: true,
              sourceUrl,
              playersCsv: activePlayersCsv,
              attempts: fallbackResults,
            };
            break;
          }
        }
        const stillLow = coverage.rowCoveragePct < minMapRowCoveragePct || coverage.playerCoveragePct < minMapPlayerCoveragePct;
        if (stillLow) {
          const details = {
            reasonCode: "player_map_coverage_low",
            coverage,
            thresholds: {
              minMapRowCoveragePct,
              minMapPlayerCoveragePct,
            },
            sourceUrls: sourceCandidates,
            sourceFallbackEnabled,
            fallbackAttempts: setSummary.fallback?.attempts || [],
            decisionHint: sourceCandidates.length > 0
              ? "coverage_low_after_fallback_review_parser_rules_or_add_better_source"
              : "coverage_low_source_unknown_add_source_then_reparse",
          };
          throw new Error(`player_map_coverage_low: ${JSON.stringify(details)}`);
        }
      }

      if (!Boolean(entry.skipSeed) && !Boolean(args["skip-seed"])) {
        ensureRequiredEnv(["SERPAPI_KEY", "DATABASE_URL"]);
        const seedArgs = [
          "--set-id",
          setId,
          "--images-per-variant",
          imagesPerVariant,
          "--delay-ms",
          delayMs,
          "--ref-side",
          refSide,
          "--checklist-player-map",
          path.relative(process.cwd(), activePlayerMapOut),
          "--set-timeout-ms",
          String(seedSetTimeoutMs),
        ];
        if (limitVariantsValue !== undefined && String(limitVariantsValue).trim() !== "") {
          seedArgs.push("--limit-variants", String(limitVariantsValue));
        }
        if (dryRun) seedArgs.push("--dry-run");
        const seedStdout = runNodeCaptureOrThrow(seedScript, seedArgs, { timeoutMs: seedSetTimeoutMs + 30_000 });
        const seedSummary = tryParseLastJsonObject(seedStdout);
        if (seedSummary && Number.isFinite(Number(seedSummary.referencesInserted))) {
          setSummary.refsInserted = Number(seedSummary.referencesInserted);
        }
        if (seedSummary && typeof seedSummary === "object") {
          setSummary.seedDiagnostics = {
            requestTimeouts: Number(seedSummary.requestTimeouts || 0),
            requestFailures: Number(seedSummary.requestFailures || 0),
            playerTimeouts: Number(seedSummary.playerTimeouts || 0),
            playerFailures: Number(seedSummary.playerFailures || 0),
          };
        }
      }

      runNodeOrThrow(queueScript, [
        "--set-id",
        setId,
        "--min-refs",
        minRefs,
        "--out",
        path.relative(process.cwd(), queueOut),
      ]);

      const queueJson = loadJson(queueOut);
      setSummary.queueCount = Number(queueJson.queueCount || 0);
      setSummary.status = validation.status === "warn" ? "warned" : "passed";
      if (setSummary.status === "warned") summary.totals.warned += 1;
      else summary.totals.passed += 1;
    } catch (error) {
      setSummary.status = "failed";
      setSummary.reason = error instanceof Error ? error.message : String(error);
      setSummary.failedReason = classifyFailureReason(error);
      const quarantinePath = writeQuarantine(logDir, slug, {
        generatedAt: new Date().toISOString(),
        setId,
        slug,
        playersCsv,
        failedReason: setSummary.failedReason,
        reason: setSummary.reason,
      });
      setSummary.quarantine = path.relative(process.cwd(), quarantinePath);
      summary.totals.failed += 1;
      summary.sets.push(setSummary);
      if (!continueOnError) break;
      continue;
    }

    summary.sets.push(setSummary);
  }

  const summaryPath = path.join(logDir, "batch-summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
  if (summary.totals.failed > 0) {
    process.exit(1);
  }
}

function runLegacyPipeline(args) {
  const dryRun = Boolean(args["dry-run"]);
  const skipSeed = Boolean(args["skip-seed"]);
  const config = String(args.config || "scripts/variant-db/sports-sources.example.json");
  const out = String(args.out || "data/variants/sports.auto.csv");
  const imagesPerVariant = String(args["images-per-variant"] || "3");
  const delayMs = String(args["delay-ms"] || "700");
  const setId = args["set-id"] ? String(args["set-id"]) : "";
  const checklistPlayerMap = String(args["checklist-player-map"] || "data/variants/checklists/player-map.json");
  const gapQueueOut = String(args["gap-queue-out"] || "data/variants/qa-gap-queue.json");
  const minRefs = String(args["min-refs"] || imagesPerVariant);
  const limitVariants = args["limit-variants"];

  const collectScript = path.resolve(process.cwd(), "scripts/variant-db/collect-sports-variants.js");
  const syncScript = path.resolve(process.cwd(), "scripts/variant-db/sync-variant-db.js");
  const seedScript = path.resolve(process.cwd(), "scripts/variant-db/seed-sports-reference-images.js");
  const queueScript = path.resolve(process.cwd(), "scripts/variant-db/build-qa-gap-queue.js");

  const collectArgs = ["--config", config, "--out", out];
  runNodeOrThrow(collectScript, collectArgs);

  const syncArgs = ["--source", "csv", "--csv", out, "--with-references"];
  if (dryRun) syncArgs.push("--dry-run");
  runNodeOrThrow(syncScript, syncArgs);

  if (!skipSeed) {
    const seedArgs = ["--images-per-variant", imagesPerVariant, "--delay-ms", delayMs];
    if (limitVariants !== undefined && String(limitVariants).trim() !== "") {
      seedArgs.push("--limit-variants", String(limitVariants));
    }
    if (checklistPlayerMap) seedArgs.push("--checklist-player-map", checklistPlayerMap);
    if (setId) seedArgs.push("--set-id", setId);
    if (dryRun) seedArgs.push("--dry-run");
    runNodeOrThrow(seedScript, seedArgs);
  }

  const queueArgs = ["--min-refs", minRefs, "--out", gapQueueOut];
  if (setId) queueArgs.push("--set-id", setId);
  runNodeOrThrow(queueScript, queueArgs);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.manifest) {
    runManifestBatch(args);
    return;
  }
  runLegacyPipeline(args);
}

main();
