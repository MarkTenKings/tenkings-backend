#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { scoreReferenceCandidate } = require("./quality-gate");

function loadPrismaClient() {
  try {
    return require("@prisma/client").PrismaClient;
  } catch {
    const fallback = path.resolve(
      __dirname,
      "../../packages/database/node_modules/@prisma/client"
    );
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const deleteRejects = Boolean(args["delete-rejects"]);
  const limit = Math.max(1, Number(args.limit ?? 10000) || 10000);
  const pageSize = Math.max(10, Number(args["page-size"] ?? 500) || 500);
  const setId = args["set-id"] ? String(args["set-id"]).trim() : "";

  const prisma = new PrismaClient();
  try {
    let cursor = undefined;
    let scanned = 0;
    let updated = 0;
    let deleted = 0;
    const statusCounts = {
      approved: 0,
      weak: 0,
      reject: 0,
      unscored: 0,
    };

    while (scanned < limit) {
      const refs = await prisma.cardVariantReferenceImage.findMany({
        where: {
          ...(setId ? { setId } : {}),
        },
        take: Math.min(pageSize, limit - scanned),
        ...(cursor
          ? {
              skip: 1,
              cursor: { id: cursor },
            }
          : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          setId: true,
          parallelId: true,
          sourceUrl: true,
        },
      });
      if (refs.length === 0) break;

      const variants = await prisma.cardVariant.findMany({
        where: {
          OR: refs.map((r) => ({
            setId: r.setId,
            parallelId: r.parallelId,
          })),
        },
        select: {
          setId: true,
          parallelId: true,
          keywords: true,
          oddsInfo: true,
        },
      });
      const variantMap = new Map(
        variants.map((v) => [`${v.setId}::${v.parallelId}`, v])
      );

      for (const ref of refs) {
        scanned += 1;
        const variant = variantMap.get(`${ref.setId}::${ref.parallelId}`);
        const gate = scoreReferenceCandidate({
          setId: ref.setId,
          parallelId: ref.parallelId,
          keywords: variant?.keywords ?? [],
          oddsInfo: variant?.oddsInfo ?? null,
          listingTitle: null,
          sourceUrl: ref.sourceUrl ?? null,
        });
        if (statusCounts[gate.status] != null) {
          statusCounts[gate.status] += 1;
        }
        if (!dryRun && deleteRejects && gate.status === "reject") {
          await prisma.cardVariantReferenceImage.delete({ where: { id: ref.id } });
          deleted += 1;
        }
        updated += 1;
      }

      cursor = refs[refs.length - 1]?.id;
      if (!cursor) break;
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          setId: setId || null,
          scanned,
          updated,
          deleted,
          deleteRejects,
          statusCounts,
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
