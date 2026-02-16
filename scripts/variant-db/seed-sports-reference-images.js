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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(input, size) {
  const chunks = [];
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size));
  }
  return chunks;
}

function buildVariantQuery(variant) {
  const setPart = variant.setId;
  const cardPart = variant.cardNumber === "ALL" ? "" : `#${variant.cardNumber}`;
  const parallelPart = variant.parallelId;
  const keywordPart = Array.isArray(variant.keywords) ? variant.keywords.slice(0, 3).join(" ") : "";
  return [setPart, cardPart, parallelPart, keywordPart, "trading card"].filter(Boolean).join(" ");
}

function isLikelyPlaceholderImage(url) {
  return /\/s_1x2\.gif(?:$|\?)/i.test(url);
}

async function fetchSerpEbayImages(apiKey, query, count) {
  const params = new URLSearchParams({
    engine: "ebay",
    _nkw: query,
    ebay_domain: "ebay.com",
    api_key: apiKey,
  });
  const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`SerpApi eBay error ${response.status}${text ? ` - ${text.slice(0, 200)}` : ""}`);
  }
  const payload = await response.json();
  const results = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
  const rows = [];
  const seen = new Set();
  for (const item of results) {
    const rawImageUrl =
      typeof item?.thumbnail === "string"
        ? item.thumbnail.trim()
        : typeof item?.image === "string"
        ? item.image.trim()
        : "";
    if (!rawImageUrl || isLikelyPlaceholderImage(rawImageUrl) || seen.has(rawImageUrl)) continue;
    seen.add(rawImageUrl);
    rows.push({
      rawImageUrl,
      sourceUrl: typeof item?.link === "string" ? item.link.trim() : null,
      listingTitle: typeof item?.title === "string" ? item.title.trim() : null,
    });
    if (rows.length >= count) break;
  }
  return rows;
}

async function fetchSerpImages(apiKey, query, count) {
  return await fetchSerpEbayImages(apiKey, query, count);
}

async function loadExistingRefCounts(prisma, variants) {
  const unique = [];
  const seen = new Set();
  for (const variant of variants) {
    const key = `${variant.setId}::${variant.parallelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ setId: variant.setId, parallelId: variant.parallelId });
  }

  const countByKey = new Map();
  const chunks = chunkArray(unique, 300);
  for (const pairs of chunks) {
    const rows = await prisma.cardVariantReferenceImage.groupBy({
      by: ["setId", "parallelId"],
      where: {
        OR: pairs.map((pair) => ({
          setId: pair.setId,
          parallelId: pair.parallelId,
        })),
      },
      _count: { _all: true },
    });
    for (const row of rows) {
      const key = `${row.setId}::${row.parallelId}`;
      countByKey.set(key, row._count._all);
    }
  }
  return countByKey;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const allowWeak = Boolean(args["allow-weak"]);
  const limitVariants = Math.max(1, Number(args["limit-variants"] ?? 50) || 50);
  const imagesPerVariant = Math.max(1, Number(args["images-per-variant"] ?? 3) || 3);
  const delayMs = Math.max(0, Number(args["delay-ms"] ?? 700) || 700);
  const setFilter = args["set-id"] ? String(args["set-id"]).trim() : "";
  const apiKey = process.env.SERPAPI_KEY ?? "";

  if (!apiKey) {
    throw new Error("SERPAPI_KEY is required for sports image seeding.");
  }

  const prisma = new PrismaClient();
  try {
    const variants = await prisma.cardVariant.findMany({
      where: {
        ...(setFilter ? { setId: setFilter } : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limitVariants,
      select: {
        setId: true,
        cardNumber: true,
        parallelId: true,
        keywords: true,
      },
    });
    const existingCountByKey = await loadExistingRefCounts(prisma, variants);

    let variantsChecked = 0;
    let variantsSeeded = 0;
    let referencesInserted = 0;
    let referencesSkipped = 0;

    for (const variant of variants) {
      variantsChecked += 1;
      const variantKey = `${variant.setId}::${variant.parallelId}`;
      const existingCount = existingCountByKey.get(variantKey) ?? 0;
      if (existingCount >= imagesPerVariant) {
        referencesSkipped += imagesPerVariant;
        continue;
      }
      const remainingSlots = Math.max(1, imagesPerVariant - existingCount);
      const existing = await prisma.cardVariantReferenceImage.findMany({
        where: {
          setId: variant.setId,
          parallelId: variant.parallelId,
        },
        select: {
          rawImageUrl: true,
        },
      });
      const existingUrls = new Set(
        existing
          .map((row) => (typeof row.rawImageUrl === "string" ? row.rawImageUrl.trim() : ""))
          .filter(Boolean)
      );

      const query = buildVariantQuery(variant);
      const images = await fetchSerpImages(apiKey, query, remainingSlots);
      if (images.length > 0) {
        variantsSeeded += 1;
      }
      const toInsert = [];
      for (const image of images) {
        if (existingUrls.has(image.rawImageUrl)) {
          referencesSkipped += 1;
          continue;
        }
        const gate = scoreReferenceCandidate({
          setId: variant.setId,
          parallelId: variant.parallelId,
          keywords: variant.keywords,
          oddsInfo: null,
          listingTitle: image.listingTitle,
          sourceUrl: image.sourceUrl,
        });
        if (!(gate.status === "approved" || (allowWeak && gate.status === "weak"))) {
          referencesSkipped += 1;
          continue;
        }
        existingUrls.add(image.rawImageUrl);
        toInsert.push({
          ...image,
        });
      }

      if (!dryRun && toInsert.length > 0) {
        await prisma.cardVariantReferenceImage.createMany({
          data: toInsert.map((image) => ({
            setId: variant.setId,
            parallelId: variant.parallelId,
            rawImageUrl: image.rawImageUrl,
            sourceUrl: image.sourceUrl,
            cropUrls: [],
            cropEmbeddings: null,
            qualityScore: null,
          })),
        });
      }
      referencesInserted += toInsert.length;

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          setFilter: setFilter || null,
          variantsChecked,
          variantsSeeded,
          referencesInserted,
          referencesSkipped,
          imagesPerVariant,
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
