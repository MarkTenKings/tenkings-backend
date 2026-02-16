#!/usr/bin/env node
"use strict";

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

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const skipSeed = Boolean(args["skip-seed"]);
  const config = String(args.config || "scripts/variant-db/sports-sources.example.json");
  const out = String(args.out || "data/variants/sports.auto.csv");
  const limitVariants = String(args["limit-variants"] || "50");
  const imagesPerVariant = String(args["images-per-variant"] || "3");
  const delayMs = String(args["delay-ms"] || "700");
  const setId = args["set-id"] ? String(args["set-id"]) : "";

  const collectScript = path.resolve(process.cwd(), "scripts/variant-db/collect-sports-variants.js");
  const syncScript = path.resolve(process.cwd(), "scripts/variant-db/sync-variant-db.js");
  const seedScript = path.resolve(process.cwd(), "scripts/variant-db/seed-sports-reference-images.js");

  const collectArgs = ["--config", config, "--out", out];
  runNode(collectScript, collectArgs);

  const syncArgs = ["--source", "csv", "--csv", out, "--with-references"];
  if (dryRun) syncArgs.push("--dry-run");
  runNode(syncScript, syncArgs);

  if (!skipSeed) {
    const seedArgs = [
      "--limit-variants",
      limitVariants,
      "--images-per-variant",
      imagesPerVariant,
      "--delay-ms",
      delayMs,
    ];
    if (setId) seedArgs.push("--set-id", setId);
    if (dryRun) seedArgs.push("--dry-run");
    runNode(seedScript, seedArgs);
  }
}

main();
