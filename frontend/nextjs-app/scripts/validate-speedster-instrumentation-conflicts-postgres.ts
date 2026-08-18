import assert from "node:assert/strict";

import { PrismaClient } from "@prisma/client";

import {
  insertSpeedsterInstrumentationEventWithConflictDetection,
  SpeedsterInstrumentationConflictError,
  type SpeedsterInstrumentationEvent,
} from "../lib/server/aiGraderV2Instrumentation";

const EXPECTED_DATABASE = "tenkings_ai_grader_nfc_validation";
const EXPECTED_USER = "tenkings_nfc_validation";

function requireDisposableDatabase() {
  assert.equal(process.env.AI_GRADER_NFC_DISPOSABLE_VALIDATION, "1");
  assert.equal(process.env.TEN_KINGS_V2_DISPOSABLE_VALIDATION, "1");
  assert.ok(process.env.DATABASE_URL);
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(databaseUrl.hostname));
  assert.equal(decodeURIComponent(databaseUrl.username), EXPECTED_USER);
  assert.equal(decodeURIComponent(databaseUrl.pathname.slice(1)), EXPECTED_DATABASE);
}

type RowIdentity = Readonly<{
  id: string;
  ctid: string;
  xmin: string;
  rowHash: string;
}>;

async function main() {
  requireDisposableDatabase();
  const prisma = new PrismaClient();
  const marker = `${process.pid}-${Date.now()}`;
  const sessionId = `instrumentation-live-${marker}`;
  const eventKey = `${sessionId}:map-registration:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:front:1`;
  const concurrentEventKey = `${sessionId}:map-registration:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:back:1`;
  const event: SpeedsterInstrumentationEvent = {
    eventKey,
    sessionId,
    createdByUserId: "instrumentation-live-admin",
    category: "SERVER_TIMING",
    eventType: "MAP_REGISTRATION_ATTEMPT",
    findingId: null,
    origin: null,
    similarity: null,
    generatingExemplar: { validator: "real-postgres", sequence: 1 },
    operatorAction: null,
    clientStartedAt: new Date("2026-08-15T20:00:00.000Z"),
    clientEndedAt: new Date("2026-08-15T20:00:00.125Z"),
    durationMs: 125,
    details: { side: "FRONT", outcome: "SUCCEEDED" },
  };
  const identity = async (key: string) => {
    const rows = await prisma.$queryRaw<RowIdentity[]>`
      SELECT
        "id",
        ctid::text AS "ctid",
        xmin::text AS "xmin",
        md5(to_jsonb("AiGraderV2InstrumentationEvent")::text) AS "rowHash"
      FROM "AiGraderV2InstrumentationEvent"
      WHERE "eventKey" = ${key}
    `;
    assert.equal(rows.length, 1);
    return rows[0];
  };

  try {
    await prisma.aiGraderV2Session.create({
      data: {
        id: sessionId,
        createdByUserId: event.createdByUserId,
        cardProfile: "POKEMON",
        workflowState: "DRAFT",
        ruleVersion: "speedster-instrumentation-live-validation",
        identity: {},
        capture: {},
        reviewedDefects: [],
        gradeReport: {},
      },
    });

    assert.equal(await insertSpeedsterInstrumentationEventWithConflictDetection(prisma, event), 1);
    const insertedIdentity = await identity(eventKey);

    assert.equal(await insertSpeedsterInstrumentationEventWithConflictDetection(prisma, event), 0);
    assert.deepEqual(
      await identity(eventKey),
      insertedIdentity,
      "an exact duplicate must not change id, ctid, xmin, or row content",
    );

    await assert.rejects(
      insertSpeedsterInstrumentationEventWithConflictDetection(prisma, { ...event, durationMs: 126 }),
      (error) => error instanceof SpeedsterInstrumentationConflictError
        && error.reason === "CONFLICTING_PAYLOAD",
    );
    assert.deepEqual(
      await identity(eventKey),
      insertedIdentity,
      "a conflicting duplicate must leave the immutable row byte-equivalent and MVCC-identical",
    );

    const concurrentEvent = { ...event, eventKey: concurrentEventKey, details: { side: "BACK", outcome: "SUCCEEDED" } };
    const concurrentResults = await Promise.all([
      insertSpeedsterInstrumentationEventWithConflictDetection(prisma, concurrentEvent),
      insertSpeedsterInstrumentationEventWithConflictDetection(prisma, concurrentEvent),
    ]);
    assert.deepEqual([...concurrentResults].sort(), [0, 1]);
    assert.equal(await prisma.aiGraderV2InstrumentationEvent.count({ where: { eventKey: concurrentEventKey } }), 1);
  } finally {
    // This validator is permitted only against the uniquely named disposable
    // database checked above. Append-only evidence is intentionally not
    // deleted; the enclosing disposable-database teardown removes the volume.
    await prisma.$disconnect();
  }

  console.log("SPEEDSTER_INSTRUMENTATION_CONFLICT_REAL_POSTGRES_VALIDATION_PASS");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
