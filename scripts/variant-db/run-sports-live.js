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
  if (normalized.includes("set_timeout")) return "set_timeout";
  if (normalized.includes("player_timeout")) return "player_timeout";
  if (normalized.includes("request_timeout")) return "request_timeout";
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
  const defaultImagesPerVariant = String(args["images-per-variant"] || manifest.imagesPerVariant || "2");
  const defaultDelayMs = String(args["delay-ms"] || manifest.delayMs || "100");
  const defaultMinRefs = String(args["min-refs"] || manifest.minRefs || defaultImagesPerVariant);
  const defaultRefSide = String(args["ref-side"] || manifest.refSide || "front");
  const seedSetTimeoutMs = Math.max(10_000, Number(args["seed-set-timeout-ms"] || manifest.seedSetTimeoutMs || 900_000) || 900_000);
  const globalLimitVariants = args["limit-variants"];

  const validateScript = path.resolve(process.cwd(), "scripts/variant-db/validate-checklist-output.js");
  const mapScript = path.resolve(process.cwd(), "scripts/variant-db/build-checklist-player-map.js");
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

      runNodeOrThrow(mapScript, ["--csv", playersCsv, "--out", path.relative(process.cwd(), playerMapOut)]);

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
          path.relative(process.cwd(), playerMapOut),
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
