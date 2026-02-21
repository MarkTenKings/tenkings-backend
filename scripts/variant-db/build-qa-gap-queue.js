#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const minRefs = Math.max(1, Number(args["min-refs"] ?? 2) || 2);
  const take = Math.max(1, Number(args.limit ?? 2000) || 2000);
  const setId = args["set-id"] ? String(args["set-id"]).trim() : "";
  const refType = String(args["ref-side"] || "front").trim().toLowerCase() === "back" ? "back" : "front";
  const outPath = String(args.out || "data/variants/qa-gap-queue.json").trim();

  const prisma = new PrismaClient();
  try {
    const variants = await prisma.cardVariant.findMany({
      where: {
        ...(setId ? { setId } : {}),
      },
      orderBy: [{ setId: "asc" }, { parallelId: "asc" }],
      take,
      select: {
        setId: true,
        parallelId: true,
        cardNumber: true,
        parallelFamily: true,
        keywords: true,
      },
    });
    const pairs = variants.map((variant) => ({
      setId: variant.setId,
      cardNumber: variant.cardNumber,
      parallelId: variant.parallelId,
      refType,
    }));
    const counts =
      pairs.length > 0
        ? await prisma.cardVariantReferenceImage.groupBy({
            by: ["setId", "cardNumber", "parallelId", "refType"],
            where: {
              OR: pairs.map((pair) => ({
                setId: pair.setId,
                cardNumber: pair.cardNumber,
                parallelId: pair.parallelId,
                refType: pair.refType,
              })),
            },
            _count: { _all: true },
          })
        : [];
    const countByKey = new Map(
      counts.map((row) => [
        `${row.setId}::${String(row.cardNumber || "ALL")}::${row.parallelId}::${row.refType || "front"}`,
        row._count._all,
      ])
    );
    const queue = variants
      .map((variant) => {
        const refs = countByKey.get(`${variant.setId}::${variant.cardNumber}::${variant.parallelId}::${refType}`) ?? 0;
        return {
          setId: variant.setId,
          parallelId: variant.parallelId,
          cardNumber: variant.cardNumber,
          parallelFamily: variant.parallelFamily || null,
          refs,
          missing: Math.max(0, minRefs - refs),
          keywords: Array.isArray(variant.keywords) ? variant.keywords : [],
        };
      })
      .filter((row) => row.refs < minRefs)
      .sort((a, b) => a.refs - b.refs || a.setId.localeCompare(b.setId) || a.parallelId.localeCompare(b.parallelId));

    const output = {
      generatedAt: new Date().toISOString(),
      setId: setId || null,
      refType,
      minRefs,
      queueCount: queue.length,
      rows: queue,
    };
    const target = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify(
        {
          out: outPath,
          setId: setId || null,
          refType,
          minRefs,
          queueCount: queue.length,
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
