import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { Prisma, PrismaClient } from "@prisma/client";

import { PHASE_A_WRITER_VALIDATION } from "./correctApprovedSpeedsterIdentities.mjs";

const require = createRequire(import.meta.url);
const {
  createCardsFromSpeedster,
  validateSpeedsterCardCreationSources,
  verifySpeedsterCardMaterializations,
} = require("../dist/database/src/cardPlatformV2.js");

export const CONFIRMATION = "APPLY_APPROVED_TEN_KINGS_V2_CARD_BACKFILL_EXACT_27";
// Fresh apply executes at most 23 bounded DB statements and locked replay at
// most 20 after set-based source/card/event reads and batched inserts. Ten
// minutes provides explicit Production-latency headroom without returning to
// the former 400+ per-row-query risk or an unbounded interactive transaction.
export const BACKFILL_TRANSACTION_TIMEOUT_MS = 600_000;
export const APPROVED_BACKFILL = PHASE_A_WRITER_VALIDATION;
export const OWNER_REVIEW_FLAGS = Object.freeze({
  nonblocking: true,
  flags: [
    "TKH-000219 year 2019 vs TKH-000220/221 year 2021",
    "TKH-000226 card #036/195 vs TKH-000227 #035/195",
  ],
});

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export function parseArgs(argv) {
  const result = { apply: false, confirmation: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      result.apply = true;
      continue;
    }
    if (arg === "--confirm") {
      result.confirmation = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      result.confirmation = arg.slice("--confirm=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") return { ...result, help: true };
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!result.apply && result.confirmation) {
    throw new Error("--confirm is accepted only with --apply");
  }
  if (result.apply && result.confirmation !== CONFIRMATION) {
    throw new Error(`--apply requires --confirm ${CONFIRMATION}`);
  }
  return result;
}

function usage() {
  console.log(`Usage:
  pnpm --filter @tenkings/database backfill:v2:cards
  pnpm --filter @tenkings/database backfill:v2:cards --apply \\
    --confirm ${CONFIRMATION}

Default mode is a zero-write dry run of exactly Mark's 27 approved session IDs.
Apply mode cannot accept caller-selected IDs: it locks and writes that exact manifest,
verifies every certificate binding/card/creation event/token, proves CardAsset and Item
counts unchanged inside the transaction, and performs an exact idempotency replay.`);
}

async function loadExactTargets(db, { fullValidation = true } = {}) {
  const ids = APPROVED_BACKFILL.map(({ sessionId }) => sessionId);
  if (APPROVED_BACKFILL.length !== 27 || new Set(ids).size !== 27) {
    throw new Error("Approved Phase B manifest must contain exactly 27 unique sessions");
  }
  const [sessions, labels] = await Promise.all([
    db.aiGraderV2Session.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        workflowState: true,
        publicReportSlug: true,
        collectibleCardV2: { select: { id: true, publicToken: true } },
      },
    }),
    db.humanGradeLabel.findMany({
      where: { sourceSessionId: { in: ids } },
      select: {
        id: true,
        source: true,
        sourceSessionId: true,
        certificateNumber: true,
      },
    }),
  ]);
  const sessionsById = new Map(sessions.map((row) => [row.id, row]));
  const labelsBySession = new Map(labels.map((row) => [row.sourceSessionId, row]));
  const exactRows = [];
  for (const expected of APPROVED_BACKFILL) {
    const session = sessionsById.get(expected.sessionId);
    const label = labelsBySession.get(expected.sessionId);
    if (!session) throw new Error(`Approved Phase B session is missing: ${expected.sessionId}`);
    if (session.workflowState !== "COMPLETED" || !session.publicReportSlug) {
      throw new Error(`Approved Phase B session is not a completed permanent report: ${expected.sessionId}`);
    }
    if (
      !label ||
      label.source !== "SPEEDSTER" ||
      label.sourceSessionId !== session.id ||
      label.certificateNumber !== expected.certificateNumber
    ) {
      throw new Error(`${expected.sessionId} is not bound to exact label ${expected.certificateNumber}`);
    }
    exactRows.push({
      session,
      label,
      sessionId: session.id,
      certificateNumber: expected.certificateNumber,
      humanGradeLabelId: label.id,
    });
  }
  if (!fullValidation) {
    return exactRows.map((row) => ({
      sessionId: row.sessionId,
      certificateNumber: row.certificateNumber,
      humanGradeLabelId: row.humanGradeLabelId,
      publicReportSlug: row.session.publicReportSlug,
      status: row.session.collectibleCardV2 ? "EXISTING_LOCKED" : "READY_TO_CREATE",
    }));
  }
  const bindings = exactRows.map(({ sessionId, humanGradeLabelId }) => ({
    sessionId,
    humanGradeLabelId,
  }));
  const sources = await validateSpeedsterCardCreationSources(db, bindings);
  const existingBindings = exactRows
    .filter(({ session }) => session.collectibleCardV2)
    .map(({ sessionId, humanGradeLabelId }) => ({ sessionId, humanGradeLabelId }));
  const existingVerified = existingBindings.length
    ? await verifySpeedsterCardMaterializations(db, existingBindings)
    : [];
  const existingBySession = new Map(existingVerified.map((row) => [row.sessionId, row]));
  return exactRows.map((row, index) => {
    const source = sources[index];
    if (!source) throw new Error(`Approved Phase B source disappeared: ${row.sessionId}`);
    const existingVerification = existingBySession.get(row.sessionId) ?? null;
    return {
      sessionId: row.sessionId,
      certificateNumber: row.certificateNumber,
      humanGradeLabelId: row.humanGradeLabelId,
      publicReportSlug: source.session.publicReportSlug,
      category: source.session.cardProfile,
      identity: source.identity,
      status: existingVerification ? "EXISTING_VERIFIED" : "READY_TO_CREATE",
      existingVerification,
    };
  });
}

async function lockExactTargets(tx) {
  const ids = [...APPROVED_BACKFILL.map(({ sessionId }) => sessionId)].sort();
  const sessions = await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "AiGraderV2Session"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `);
  if (stable(sessions.map(({ id }) => id).sort()) !== stable(ids)) {
    throw new Error("Phase B could not lock the exact 27 approved sessions");
  }
  const labels = await tx.$queryRaw(Prisma.sql`
    SELECT "id", "sourceSessionId"
    FROM "HumanGradeLabel"
    WHERE "sourceSessionId" IN (${Prisma.join(ids)})
    ORDER BY "sourceSessionId", "id"
    FOR UPDATE
  `);
  if (stable(labels.map(({ sourceSessionId }) => sourceSessionId).sort()) !== stable(ids)) {
    throw new Error("Phase B could not lock the exact 27 approved labels");
  }
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "CollectibleCardV2"
    WHERE "speedsterSessionId" IN (${Prisma.join(ids)})
    ORDER BY "speedsterSessionId", "id"
    FOR UPDATE
  `);
  const references = ids.map((id) => `speedster:${id}`);
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "CardOwnershipEventV2"
    WHERE "referenceType" = 'SYSTEM_CREATION'
      AND "referenceId" IN (${Prisma.join(references)})
    ORDER BY "referenceId", "id"
    FOR UPDATE
  `);
}

async function legacyCounts(db) {
  const [cardAssetCount, itemCount] = await Promise.all([
    db.cardAsset.count(),
    db.item.count(),
  ]);
  return { cardAssetCount, itemCount };
}

async function verifyAll(db, targets) {
  return verifySpeedsterCardMaterializations(db, targets.map((target) => ({
    sessionId: target.sessionId,
    humanGradeLabelId: target.humanGradeLabelId,
  })));
}

async function exactMaterializationCounts(db) {
  const ids = APPROVED_BACKFILL.map(({ sessionId }) => sessionId);
  const references = ids.map((id) => `speedster:${id}`);
  const [cardCount, creationEventCount] = await Promise.all([
    db.collectibleCardV2.count({ where: { speedsterSessionId: { in: ids } } }),
    db.cardOwnershipEventV2.count({
      where: { referenceType: "SYSTEM_CREATION", referenceId: { in: references } },
    }),
  ]);
  return { cardCount, creationEventCount };
}

async function applyExactManifest(prisma) {
  return prisma.$transaction(async (tx) => {
    await lockExactTargets(tx);
    const targets = await loadExactTargets(tx, { fullValidation: false });
    const legacyBefore = await legacyCounts(tx);
    const materializationBefore = await exactMaterializationCounts(tx);
    const materialized = await createCardsFromSpeedster(tx, targets.map((target) => ({
      sessionId: target.sessionId,
      humanGradeLabelId: target.humanGradeLabelId,
    })));
    const { cards, verified } = materialized;
    const materializationAfter = await exactMaterializationCounts(tx);
    const legacyAfter = await legacyCounts(tx);
    if (materializationAfter.cardCount !== 27 || materializationAfter.creationEventCount !== 27) {
      throw new Error("Phase B did not create exactly 27 cards and 27 creation events");
    }
    if (stable(legacyBefore) !== stable(legacyAfter)) {
      throw new Error("Phase B changed CardAsset or Item row counts");
    }
    return {
      cardsBefore: materializationBefore.cardCount,
      creationEventsBefore: materializationBefore.creationEventCount,
      cardsCreated: materializationAfter.cardCount - materializationBefore.cardCount,
      creationEventsCreated: materializationAfter.creationEventCount - materializationBefore.creationEventCount,
      legacyBefore,
      legacyAfter,
      cards: cards.map(({ id, speedsterSessionId, publicToken }) => ({ id, speedsterSessionId, publicToken })),
      verified,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: BACKFILL_TRANSACTION_TIMEOUT_MS,
  });
}

async function verifyIdempotentReplay(prisma, expected) {
  return prisma.$transaction(async (tx) => {
    await lockExactTargets(tx);
    const targets = await loadExactTargets(tx, { fullValidation: false });
    const before = await exactMaterializationCounts(tx);
    const legacyBefore = await legacyCounts(tx);
    const tokensBefore = new Map(expected.map((row) => [row.sessionId, row.publicToken]));
    const materialized = await createCardsFromSpeedster(tx, targets.map((target) => ({
      sessionId: target.sessionId,
      humanGradeLabelId: target.humanGradeLabelId,
    })));
    const { cards, verified } = materialized;
    for (const card of cards) {
      if (card.publicToken !== tokensBefore.get(card.speedsterSessionId)) {
        throw new Error(`Idempotency replay changed token for ${card.speedsterSessionId}`);
      }
    }
    const after = await exactMaterializationCounts(tx);
    const legacyAfter = await legacyCounts(tx);
    if (stable(before) !== stable(after) || stable(legacyBefore) !== stable(legacyAfter)) {
      throw new Error("Idempotency replay changed V2, CardAsset, or Item row counts");
    }
    return { before, after, legacyBefore, legacyAfter, verified };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: BACKFILL_TRANSACTION_TIMEOUT_MS,
  });
}

export async function run(args, prisma) {
  const targets = await loadExactTargets(prisma);
  const dryRun = {
    mode: args.apply ? "pre-apply" : "dry-run",
    exactApprovedCount: targets.length,
    readyToCreateCount: targets.filter(({ status }) => status === "READY_TO_CREATE").length,
    existingVerifiedCount: targets.filter(({ status }) => status === "EXISTING_VERIFIED").length,
    targets,
    writes: 0,
    transactionTimeoutMs: BACKFILL_TRANSACTION_TIMEOUT_MS,
    ownerReviewFlags: OWNER_REVIEW_FLAGS,
    httpVerification: {
      requiredAfterCommit: true,
      performedByThisDatabaseScript: false,
      instruction: "After commit, GET every emitted publicPath on the deployed site and record all 27 HTTP results.",
    },
  };
  console.log(JSON.stringify(dryRun, null, 2));
  if (!args.apply) return dryRun;

  const applied = await applyExactManifest(prisma);
  let postCommitVerified;
  let idempotency;
  try {
    const postCommitTargets = await loadExactTargets(prisma, { fullValidation: false });
    postCommitVerified = await verifyAll(prisma, postCommitTargets);
    if (stable(postCommitVerified) !== stable(applied.verified)) {
      throw new Error("post-commit materialization evidence changed unexpectedly");
    }
    idempotency = await verifyIdempotentReplay(prisma, postCommitVerified);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown verification failure";
    throw new Error(
      `Phase B may already be committed even though post-commit/idempotency verification failed: ${detail}. ` +
      "Do not assume rollback. Inspect the emitted/preflight evidence and rerun this exact-27 command safely; its writer is idempotent.",
    );
  }
  const result = {
    mode: "apply-complete",
    exactApprovedCount: 27,
    transactionTimeoutMs: BACKFILL_TRANSACTION_TIMEOUT_MS,
    cardsCreated: applied.cardsCreated,
    creationEventsCreated: applied.creationEventsCreated,
    cardAssetRowsCreated: applied.legacyAfter.cardAssetCount - applied.legacyBefore.cardAssetCount,
    itemRowsCreated: applied.legacyAfter.itemCount - applied.legacyBefore.itemCount,
    idempotencyReplay: {
      cardCountBefore: idempotency.before.cardCount,
      cardCountAfter: idempotency.after.cardCount,
      creationEventCountBefore: idempotency.before.creationEventCount,
      creationEventCountAfter: idempotency.after.creationEventCount,
      tokenMappingUnchanged: true,
    },
    cards: postCommitVerified,
    ownerReviewFlags: OWNER_REVIEW_FLAGS,
    httpVerification: {
      required: true,
      performedByThisDatabaseScript: false,
      expectedCount: 27,
      paths: postCommitVerified.map(({ sessionId, certificateNumber, publicToken, publicPath }) => ({
        sessionId,
        certificateNumber,
        publicToken,
        publicPath,
      })),
      instruction: "GET every publicPath on the deployed Ten Kings site; record status and resolved card evidence for all 27.",
    },
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient();
  try {
    return await run(args, prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown V2 card backfill failure");
    process.exitCode = 1;
  });
}
