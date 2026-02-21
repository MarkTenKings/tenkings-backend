#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

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
  const minRefs = Math.max(1, Number(args["min-refs"] ?? 4) || 4);
  const limit = Math.max(1, Number(args.limit ?? 20000) || 20000);
  const setId = args["set-id"] ? String(args["set-id"]).trim() : "";
  const outPath = path.resolve(
    process.cwd(),
    String(args.out || "data/variants/sports/coverage-gaps.json")
  );

  const prisma = new PrismaClient();
  try {
    const variants = await prisma.cardVariant.findMany({
      where: {
        ...(setId ? { setId } : {}),
      },
      take: limit,
      orderBy: [{ updatedAt: "desc" }],
      select: {
        setId: true,
        cardNumber: true,
        parallelId: true,
      },
    });

    const counts = await prisma.cardVariantReferenceImage.groupBy({
      by: ["setId", "cardNumber", "parallelId"],
      where: {
        OR: variants.map((v) => ({
          setId: v.setId,
          cardNumber: v.cardNumber,
          parallelId: v.parallelId,
        })),
      },
      _count: { _all: true },
    });
    const map = new Map(
      counts.map((c) => [`${c.setId}::${String(c.cardNumber || "ALL")}::${c.parallelId}`, c._count._all])
    );
    const gaps = variants
      .map((v) => ({
        setId: v.setId,
        cardNumber: v.cardNumber,
        parallelId: v.parallelId,
        refs: map.get(`${v.setId}::${v.cardNumber}::${v.parallelId}`) ?? 0,
      }))
      .filter((v) => v.refs < minRefs)
      .sort((a, b) => a.refs - b.refs);

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(
      outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          minRefs,
          setId: setId || null,
          scannedVariants: variants.length,
          gapCount: gaps.length,
          rows: gaps,
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
          scannedVariants: variants.length,
          gapCount: gaps.length,
          minRefs,
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
