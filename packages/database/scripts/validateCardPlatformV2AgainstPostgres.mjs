#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { PrismaClient } from "@prisma/client";

const SENTINEL = "TEN_KINGS_V2_DISPOSABLE_VALIDATION";
const EXPECTED_DATABASE = "tenkings_ai_grader_nfc_validation";
const require = createRequire(import.meta.url);
const { createCardFromSpeedster } = require("../dist/database/src/cardPlatformV2.js");

function fail(message) {
  throw new Error(message);
}

if (process.env[SENTINEL] !== "1") {
  fail(`Refusing to run without ${SENTINEL}=1.`);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("Disposable DATABASE_URL is required.");
const parsedDatabaseUrl = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(parsedDatabaseUrl.hostname) ||
  decodeURIComponent(parsedDatabaseUrl.pathname.slice(1)) !== EXPECTED_DATABASE
) {
  fail("Card Platform V2 validation requires the exact loopback disposable database.");
}

const prisma = new PrismaClient();
const marker = `${process.pid}-${Date.now()}`;

async function createSheet() {
  return prisma.humanGradeLabelSheet.create({ data: {} });
}

async function createCompletedFixture(suffix, sheetId, slot = 1) {
  const sessionId = `v2-live-${marker}-${suffix}`;
  const publicReportSlug = `speedster-v2-live-${marker}-${suffix}`.toLowerCase();
  const session = await prisma.aiGraderV2Session.create({
    data: {
      id: sessionId,
      createdByUserId: `session-admin-${suffix}`,
      cardProfile: "POKEMON",
      workflowState: "COMPLETED",
      ruleVersion: "speedster-v2-live-validation",
      publicReportSlug,
      identity: {
        playerName: null,
        cardName: "Pikachu",
        year: "2024",
        manufacturer: null,
        productSet: "Scarlet & Violet 151",
        parallel: "Cosmos Holo",
        insert: null,
        cardNumber: "025",
      },
      capture: {},
      reviewedDefects: [],
      gradeReport: {},
    },
  });
  const label = await prisma.humanGradeLabel.create({
    data: {
      sheetId,
      slot,
      cardType: "POKEMON",
      playerName: null,
      cardName: "Pikachu",
      year: "2024",
      manufacturer: null,
      productSet: "Scarlet & Violet 151",
      parallel: "Cosmos Holo",
      insert: null,
      cardNumber: "025",
      source: "SPEEDSTER",
      sourceSessionId: session.id,
      gradingFormulaVersion: "EQUAL_25",
      centeringGrade: "9.5",
      cornersGrade: "9.0",
      edgesGrade: "8.5",
      surfaceGrade: "9.0",
      grade: "9.0",
      certificateNumber: `TKV2-${marker}-${suffix}`,
      createdByUserId: `label-admin-${suffix}`,
    },
  });
  return { session, label };
}

async function assertInsertFailureRollsBackCompletion() {
  const sheet = await createSheet();
  const sessionId = `v2-live-${marker}-rollback`;
  const labelId = `v2-live-${marker}-rollback-label`;
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "ten_kings_v2_validation_reject_card_insert"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'TEN_KINGS_V2_EXPECTED_CARD_INSERT_FAILURE';
    END;
    $$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "ten_kings_v2_validation_reject_card_insert"
    BEFORE INSERT ON "CollectibleCardV2"
    FOR EACH ROW
    EXECUTE FUNCTION "ten_kings_v2_validation_reject_card_insert"()
  `);
  let failure;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.aiGraderV2Session.create({
        data: {
          id: sessionId,
          createdByUserId: "session-admin-rollback",
          cardProfile: "POKEMON",
          workflowState: "COMPLETED",
          ruleVersion: "speedster-v2-live-validation",
          publicReportSlug: `speedster-${sessionId}`,
          identity: { cardName: "Mew", year: "2024", productSet: "151" },
          capture: {},
          reviewedDefects: [],
          gradeReport: {},
        },
      });
      await tx.humanGradeLabel.create({
        data: {
          id: labelId,
          sheetId: sheet.id,
          slot: 1,
          cardType: "POKEMON",
          playerName: null,
          cardName: "Mew",
          year: "2024",
          manufacturer: null,
          productSet: "151",
          parallel: null,
          insert: null,
          cardNumber: null,
          source: "SPEEDSTER",
          sourceSessionId: sessionId,
          gradingFormulaVersion: "EQUAL_25",
          centeringGrade: "9.0",
          cornersGrade: "9.0",
          edgesGrade: "9.0",
          surfaceGrade: "9.0",
          grade: "9.0",
          certificateNumber: `TKV2-${marker}-rollback`,
          createdByUserId: "label-admin-rollback",
        },
      });
      await createCardFromSpeedster(tx, sessionId, labelId);
    });
  } catch (error) {
    failure = error;
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS "ten_kings_v2_validation_reject_card_insert" ON "CollectibleCardV2"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS "ten_kings_v2_validation_reject_card_insert"()',
    );
  }
  assert.match(String(failure), /TEN_KINGS_V2_EXPECTED_CARD_INSERT_FAILURE/);
  assert.equal(await prisma.aiGraderV2Session.count({ where: { id: sessionId } }), 0);
  assert.equal(await prisma.humanGradeLabel.count({ where: { id: labelId } }), 0);
  assert.equal(await prisma.collectibleCardV2.count({ where: { speedsterSessionId: sessionId } }), 0);
  assert.equal(await prisma.cardOwnershipEventV2.count({
    where: { referenceType: "SYSTEM_CREATION", referenceId: `speedster:${sessionId}` },
  }), 0);
}

async function assertConcurrentIdempotencyAndConstraints() {
  const sheet = await createSheet();
  const { session, label } = await createCompletedFixture("concurrent", sheet.id);
  const complete = () => prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AiGraderV2Session" WHERE "id" = $1 FOR UPDATE',
      session.id,
    );
    return createCardFromSpeedster(tx, session.id, label.id);
  });
  const [first, second] = await Promise.all([complete(), complete()]);
  const retry = await complete();
  assert.equal(first.id, second.id);
  assert.equal(first.id, retry.id);
  assert.equal(first.publicToken, second.publicToken);
  assert.equal(first.publicToken, retry.publicToken);
  assert.match(first.publicToken, /^tk2c_[A-Za-z0-9_-]{32}$/);
  assert.equal(await prisma.collectibleCardV2.count({ where: { speedsterSessionId: session.id } }), 1);
  assert.equal(await prisma.cardOwnershipEventV2.count({
    where: { referenceType: "SYSTEM_CREATION", referenceId: `speedster:${session.id}` },
  }), 1);
  assert.equal(first.createdByAdminId, label.createdByUserId);

  const creationEvent = await prisma.cardOwnershipEventV2.findUniqueOrThrow({
    where: {
      referenceType_referenceId: {
        referenceType: "SYSTEM_CREATION",
        referenceId: `speedster:${session.id}`,
      },
    },
  });
  await assert.rejects(
    prisma.cardOwnershipEventV2.update({
      where: { id: creationEvent.id },
      data: { reason: "ADMIN_CORRECTION" },
    }),
    /CardOwnershipEventV2 is append-only/,
  );
  await assert.rejects(
    prisma.cardOwnershipEventV2.delete({ where: { id: creationEvent.id } }),
    /CardOwnershipEventV2 is append-only/,
  );

  const invalidSheet = await createSheet();
  const invalid = await createCompletedFixture("invalid-shape", invalidSheet.id);
  await assert.rejects(prisma.collectibleCardV2.create({
    data: {
      speedsterSessionId: invalid.session.id,
      humanGradeLabelId: invalid.label.id,
      publicReportSlug: invalid.session.publicReportSlug,
      publicToken: `tk2c_${"Z".repeat(32)}`,
      category: "POKEMON",
      playerName: "Pikachu",
      cardName: null,
      year: "2024",
      manufacturer: null,
      productSet: "Scarlet & Violet 151",
      parallel: null,
      insert: null,
      cardNumber: "025",
      gradeSnapshot: {},
      createdByAdminId: "label-admin-invalid-shape",
    },
  }));
  await assert.rejects(prisma.collectibleCardV2.create({
    data: {
      speedsterSessionId: invalid.session.id,
      humanGradeLabelId: invalid.label.id,
      publicReportSlug: invalid.session.publicReportSlug,
      publicToken: `tk2c_${"Y".repeat(32)}`,
      category: "POKEMON",
      playerName: null,
      cardName: null,
      year: "2024",
      manufacturer: null,
      productSet: "Scarlet & Violet 151",
      parallel: null,
      insert: null,
      cardNumber: "025",
      gradeSnapshot: {},
      createdByAdminId: "label-admin-invalid-shape",
    },
  }));
}

try {
  await assertInsertFailureRollsBackCompletion();
  await assertConcurrentIdempotencyAndConstraints();
  console.log("TEN_KINGS_V2_CARD_PLATFORM_REAL_POSTGRES_VALIDATION_PASS");
} finally {
  await prisma.$disconnect();
}
