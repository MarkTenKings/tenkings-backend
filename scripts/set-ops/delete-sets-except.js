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
    if (token === "--") continue;
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

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#0*38;/gi, "&")
    .replace(/&#x0*26;/gi, "&")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function normalizeSetLabel(value) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function normalizeSetKey(value) {
  return normalizeSetLabel(value).toLowerCase();
}

function buildConfirmPhrase(keepSet) {
  return `DELETE ALL SETS EXCEPT ${normalizeSetLabel(keepSet)}`;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/set-ops/delete-sets-except.js --keep-set "<set name>" [--execute --confirm "<phrase>"]

Examples:
  node scripts/set-ops/delete-sets-except.js --keep-set "2025-26 Topps Basketball"
  node scripts/set-ops/delete-sets-except.js --keep-set "2025-26 Topps Basketball" --execute --confirm "DELETE ALL SETS EXCEPT 2025-26 Topps Basketball"

Safety:
  - Default mode is dry-run only.
  - To execute deletes, both --execute and exact --confirm phrase are required.
`.trim());
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

async function collectDistinctSetIds(prisma) {
  const [
    drafts,
    ingestionJobs,
    replaceJobs,
    cardVariants,
    referenceImages,
    programs,
    parallels,
    taxonomySources,
    setAuditEvents,
    ocrFeedbackEvents,
    ocrMemoryRows,
    ocrRegionTemplates,
    ocrRegionTeachEvents,
  ] = await Promise.all([
    prisma.setDraft.findMany({ select: { setId: true }, distinct: ["setId"] }),
    prisma.setIngestionJob.findMany({ select: { setId: true }, distinct: ["setId"] }),
    prisma.setReplaceJob.findMany({ select: { setId: true }, distinct: ["setId"] }),
    prisma.cardVariant.findMany({ select: { setId: true }, distinct: ["setId"] }),
    prisma.cardVariantReferenceImage.findMany({ select: { setId: true }, distinct: ["setId"] }),
    prisma.setProgram.findMany({ select: { setId: true }, distinct: ["setId"] }),
    prisma.setParallel.findMany({ select: { setId: true }, distinct: ["setId"] }),
    prisma.setTaxonomySource.findMany({ select: { setId: true }, distinct: ["setId"] }),
    prisma.setAuditEvent.findMany({ where: { setId: { not: null } }, select: { setId: true }, distinct: ["setId"] }),
    prisma.ocrFeedbackEvent.findMany({ where: { setId: { not: null } }, select: { setId: true }, distinct: ["setId"] }),
    prisma.ocrFeedbackMemoryAggregate.findMany({ where: { setId: { not: null } }, select: { setId: true }, distinct: ["setId"] }),
    prisma.ocrRegionTemplate.findMany({ select: { setId: true }, distinct: ["setId"] }),
    prisma.ocrRegionTeachEvent.findMany({ where: { setId: { not: null } }, select: { setId: true }, distinct: ["setId"] }),
  ]);

  return uniqueSorted([
    ...drafts.map((row) => normalizeSetLabel(row.setId)),
    ...ingestionJobs.map((row) => normalizeSetLabel(row.setId)),
    ...replaceJobs.map((row) => normalizeSetLabel(row.setId)),
    ...cardVariants.map((row) => normalizeSetLabel(row.setId)),
    ...referenceImages.map((row) => normalizeSetLabel(row.setId)),
    ...programs.map((row) => normalizeSetLabel(row.setId)),
    ...parallels.map((row) => normalizeSetLabel(row.setId)),
    ...taxonomySources.map((row) => normalizeSetLabel(row.setId)),
    ...setAuditEvents.map((row) => normalizeSetLabel(row.setId)),
    ...ocrFeedbackEvents.map((row) => normalizeSetLabel(row.setId)),
    ...ocrMemoryRows.map((row) => normalizeSetLabel(row.setId)),
    ...ocrRegionTemplates.map((row) => normalizeSetLabel(row.setId)),
    ...ocrRegionTeachEvents.map((row) => normalizeSetLabel(row.setId)),
  ]);
}

async function computeImpact(prisma, targetSetIds, targetSetKeys) {
  if (targetSetIds.length < 1) {
    return {
      setCount: 0,
      setIds: [],
      tableCounts: {},
      totalRows: 0,
    };
  }

  const tableCounts = {};

  const counters = [
    ["cardVariantReferenceImage", prisma.cardVariantReferenceImage.count({ where: { setId: { in: targetSetIds } } })],
    ["cardVariantTaxonomyMap", prisma.cardVariantTaxonomyMap.count({ where: { setId: { in: targetSetIds } } })],
    ["cardVariant", prisma.cardVariant.count({ where: { setId: { in: targetSetIds } } })],
    ["setReplaceJob", prisma.setReplaceJob.count({ where: { setId: { in: targetSetIds } } })],
    ["setTaxonomyAmbiguityQueue", prisma.setTaxonomyAmbiguityQueue.count({ where: { setId: { in: targetSetIds } } })],
    ["setTaxonomyConflict", prisma.setTaxonomyConflict.count({ where: { setId: { in: targetSetIds } } })],
    ["setOddsByFormat", prisma.setOddsByFormat.count({ where: { setId: { in: targetSetIds } } })],
    ["setParallelScope", prisma.setParallelScope.count({ where: { setId: { in: targetSetIds } } })],
    ["setVariation", prisma.setVariation.count({ where: { setId: { in: targetSetIds } } })],
    ["setCard", prisma.setCard.count({ where: { setId: { in: targetSetIds } } })],
    ["setParallel", prisma.setParallel.count({ where: { setId: { in: targetSetIds } } })],
    ["setProgram", prisma.setProgram.count({ where: { setId: { in: targetSetIds } } })],
    ["setTaxonomySource", prisma.setTaxonomySource.count({ where: { setId: { in: targetSetIds } } })],
    ["setIngestionJob", prisma.setIngestionJob.count({ where: { setId: { in: targetSetIds } } })],
    ["setDraft", prisma.setDraft.count({ where: { setId: { in: targetSetIds } } })],
    ["setAuditEvent", prisma.setAuditEvent.count({ where: { setId: { in: targetSetIds } } })],
    ["ocrFeedbackEvent", prisma.ocrFeedbackEvent.count({ where: { setId: { in: targetSetIds } } })],
    [
      "ocrFeedbackMemoryAggregate",
      prisma.ocrFeedbackMemoryAggregate.count({
        where: {
          OR: [{ setId: { in: targetSetIds } }, { setIdKey: { in: targetSetKeys } }],
        },
      }),
    ],
    [
      "ocrRegionTemplate",
      prisma.ocrRegionTemplate.count({
        where: {
          OR: [{ setId: { in: targetSetIds } }, { setIdKey: { in: targetSetKeys } }],
        },
      }),
    ],
    [
      "ocrRegionTeachEvent",
      prisma.ocrRegionTeachEvent.count({
        where: {
          OR: [{ setId: { in: targetSetIds } }, { setIdKey: { in: targetSetKeys } }],
        },
      }),
    ],
  ];

  const values = await Promise.all(counters.map((entry) => entry[1]));
  for (let i = 0; i < counters.length; i += 1) {
    tableCounts[counters[i][0]] = values[i];
  }

  const totalRows = Object.values(tableCounts).reduce((sum, count) => sum + Number(count || 0), 0);

  return {
    setCount: targetSetIds.length,
    setIds: targetSetIds,
    tableCounts,
    totalRows,
  };
}

async function executeDelete(prisma, targetSetIds, targetSetKeys) {
  return prisma.$transaction(async (tx) => {
    const deleted = {};
    deleted.cardVariantReferenceImage = (
      await tx.cardVariantReferenceImage.deleteMany({ where: { setId: { in: targetSetIds } } })
    ).count;
    deleted.cardVariantTaxonomyMap = (await tx.cardVariantTaxonomyMap.deleteMany({ where: { setId: { in: targetSetIds } } }))
      .count;
    deleted.cardVariant = (await tx.cardVariant.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setReplaceJob = (await tx.setReplaceJob.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setTaxonomyAmbiguityQueue = (
      await tx.setTaxonomyAmbiguityQueue.deleteMany({ where: { setId: { in: targetSetIds } } })
    ).count;
    deleted.setTaxonomyConflict = (await tx.setTaxonomyConflict.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setOddsByFormat = (await tx.setOddsByFormat.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setParallelScope = (await tx.setParallelScope.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setVariation = (await tx.setVariation.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setCard = (await tx.setCard.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setParallel = (await tx.setParallel.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setProgram = (await tx.setProgram.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setTaxonomySource = (await tx.setTaxonomySource.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setIngestionJob = (await tx.setIngestionJob.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setDraft = (await tx.setDraft.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.setAuditEvent = (await tx.setAuditEvent.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.ocrFeedbackEvent = (await tx.ocrFeedbackEvent.deleteMany({ where: { setId: { in: targetSetIds } } })).count;
    deleted.ocrFeedbackMemoryAggregate = (
      await tx.ocrFeedbackMemoryAggregate.deleteMany({
        where: {
          OR: [{ setId: { in: targetSetIds } }, { setIdKey: { in: targetSetKeys } }],
        },
      })
    ).count;
    deleted.ocrRegionTemplate = (
      await tx.ocrRegionTemplate.deleteMany({
        where: {
          OR: [{ setId: { in: targetSetIds } }, { setIdKey: { in: targetSetKeys } }],
        },
      })
    ).count;
    deleted.ocrRegionTeachEvent = (
      await tx.ocrRegionTeachEvent.deleteMany({
        where: {
          OR: [{ setId: { in: targetSetIds } }, { setIdKey: { in: targetSetKeys } }],
        },
      })
    ).count;

    const totalRows = Object.values(deleted).reduce((sum, count) => sum + Number(count || 0), 0);
    return { deleted, totalRows };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const keepSet = normalizeSetLabel(String(args["keep-set"] || args.keep || ""));
  if (!keepSet) {
    printUsage();
    throw new Error("--keep-set is required");
  }

  const keepSetKey = normalizeSetKey(keepSet);
  const confirmPhrase = buildConfirmPhrase(keepSet);
  const requestedConfirm = String(args.confirm || "").trim();
  const execute = Boolean(args.execute);

  const prisma = new PrismaClient();
  try {
    const allSetIds = await collectDistinctSetIds(prisma);
    const targetSetIds = allSetIds.filter((setId) => normalizeSetKey(setId) !== keepSetKey);
    const targetSetKeys = uniqueSorted(targetSetIds.map((setId) => normalizeSetKey(setId)));

    const impact = await computeImpact(prisma, targetSetIds, targetSetKeys);
    console.log(
      JSON.stringify(
        {
          mode: execute ? "execute" : "dry-run",
          keepSet,
          keepSetKey,
          requiredConfirmPhrase: confirmPhrase,
          impact,
        },
        null,
        2
      )
    );

    if (!execute) {
      console.log("\nDry-run complete. Re-run with --execute and exact --confirm phrase to delete.\n");
      return;
    }

    if (!requestedConfirm || requestedConfirm !== confirmPhrase) {
      throw new Error(`Confirmation mismatch. Required exact phrase: ${confirmPhrase}`);
    }

    if (targetSetIds.length < 1) {
      console.log("No sets matched delete criteria. Nothing deleted.");
      return;
    }

    const result = await executeDelete(prisma, targetSetIds, targetSetKeys);
    console.log(
      JSON.stringify(
        {
          mode: "execute",
          keepSet,
          deletedSetCount: targetSetIds.length,
          deletedSetIds: targetSetIds,
          deletionResult: result,
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
