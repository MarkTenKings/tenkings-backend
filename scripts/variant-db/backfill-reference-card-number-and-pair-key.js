#!/usr/bin/env node
"use strict";

const path = require("node:path");

function loadPrismaClient() {
  try {
    return require("@prisma/client").PrismaClient;
  } catch {
    const fallback = path.resolve(__dirname, "../../packages/database/node_modules/@prisma/client");
    return require(fallback).PrismaClient;
  }
}

const PrismaClient = loadPrismaClient();

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

function normalizeCardNumberFromPlayerSeed(playerSeed) {
  const seed = String(playerSeed || "").trim();
  if (!seed) return null;
  const parts = seed.split("::");
  if (parts.length < 2) return null;
  const cardNumber = String(parts[1] || "").trim();
  if (!cardNumber || cardNumber.toUpperCase() === "NA") return null;
  return cardNumber;
}

function isLegacyPairKey(pairKey) {
  const value = String(pairKey || "").trim();
  if (!value) return false;
  return value.split("::").length === 3;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const setId = String(args["set-id"] || "").trim();
  const parallelId = String(args["parallel-id"] || "").trim();
  const take = Math.max(1, Number(args.limit || 5000) || 5000);

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.cardVariantReferenceImage.findMany({
      where: {
        ...(setId ? { setId } : {}),
        ...(parallelId ? { parallelId } : {}),
        OR: [{ cardNumber: null }, { pairKey: { not: null } }],
      },
      take,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        setId: true,
        parallelId: true,
        cardNumber: true,
        pairKey: true,
        sourceListingId: true,
        playerSeed: true,
      },
    });

    let scanned = 0;
    let updated = 0;
    let cardNumberUpdated = 0;
    let pairKeyUpdated = 0;

    for (const row of rows) {
      scanned += 1;
      const desiredCardNumber = row.cardNumber || normalizeCardNumberFromPlayerSeed(row.playerSeed);
      const hasListing = String(row.sourceListingId || "").trim();
      const desiredPairKey =
        hasListing && row.playerSeed
          ? `${row.setId}::${row.parallelId}::${String(row.playerSeed).trim()}::${hasListing}`
          : row.pairKey;

      const patch = {};
      if (!row.cardNumber && desiredCardNumber) {
        patch.cardNumber = desiredCardNumber;
        cardNumberUpdated += 1;
      }
      if (isLegacyPairKey(row.pairKey) && desiredPairKey && desiredPairKey !== row.pairKey) {
        patch.pairKey = desiredPairKey;
        pairKeyUpdated += 1;
      }
      if (Object.keys(patch).length === 0) continue;

      updated += 1;
      if (!dryRun) {
        await prisma.cardVariantReferenceImage.update({
          where: { id: row.id },
          data: patch,
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          setId: setId || null,
          parallelId: parallelId || null,
          scanned,
          updated,
          cardNumberUpdated,
          pairKeyUpdated,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

