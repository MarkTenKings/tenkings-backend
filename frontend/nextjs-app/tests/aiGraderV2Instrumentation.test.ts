import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { NextApiRequest, NextApiResponse } from "next";

import type { SpeedsterMeasuredDefect } from "../lib/ai-grader-v2/contracts";
import {
  speedsterCardMapApplicationEvent,
  speedsterFilterRemovedEvents,
  speedsterFilterRestoredEvent,
  speedsterFindingActionEvents,
  speedsterFindingFinalEvents,
  speedsterFindingProposalEvents,
  type SpeedsterInstrumentationEvent,
} from "../lib/server/aiGraderV2Instrumentation";
import { createSpeedsterInstrumentationHandler } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]/instrumentation";

const memoryFinding = {
  id: "FRONT:memory-1:SURFACE",
  side: "FRONT",
  zone: "SURFACE",
  defectType: "LIGHT_SCRATCH_SCUFF",
  detectedDefectType: "FAINT_COLOR_VARIATION",
  origin: "MEMORY",
  confidence: 0.91,
  canonicalContour: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.3 }],
  sourceViewId: "FRONT:ORIGINAL",
  supportingViewIds: ["FRONT:DIRECTIONAL"],
  reviewResult: "UNREVIEWED",
  measurement: {
    widthMm: 1,
    heightMm: 2,
    areaMm2: 2,
    zonePercent: 0.2,
    multiplier: 1,
    weightedAreaMm2: 2,
    subgradeEffect: 0.1,
  },
  memoryProposal: {
    lessonSessionId: "lesson-session-1",
    lessonCompletionOrder: 42,
    lessonProposalOrder: 3,
    lessonOrder: 1,
    lessonSourceViewId: "ORIGINAL",
    similarity: 0.947,
  },
  findingProvenance: {
    version: "speedster-finding-provenance-v1",
    primaryProposalId: "FRONT:4",
    contributors: [{
      proposalId: "FRONT:4",
      origin: "MEMORY",
      sourceViewId: "FRONT:ORIGINAL",
      defectType: "LIGHT_SCRATCH_SCUFF",
      confidence: 0.91,
      rankingConfidence: 0.947,
      memoryProposal: {
        lessonSessionId: "lesson-session-1",
        lessonCompletionOrder: 42,
        lessonProposalOrder: 3,
        lessonOrder: 1,
        lessonSourceViewId: "ORIGINAL",
        similarity: 0.947,
      },
    }],
  },
} as SpeedsterMeasuredDefect;

test("proposal telemetry preserves exact Memory provenance and measurement", () => {
  const [event] = speedsterFindingProposalEvents({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    findings: [memoryFinding],
    startedAt: new Date("2026-08-09T12:00:00.000Z"),
    endedAt: new Date("2026-08-09T12:00:02.000Z"),
  });

  assert.equal(event.origin, "MEMORY");
  assert.equal(event.similarity, 0.947);
  assert.deepEqual(event.generatingExemplar, {
    lessonSessionId: "lesson-session-1",
    lessonCompletionOrder: 42,
    lessonProposalOrder: 3,
    lessonOrder: 1,
    lessonSourceViewId: "ORIGINAL",
  });
  const details = event.details as { after: { contributors: unknown[]; regions: unknown[] } };
  assert.equal(details.after.contributors.length, 1);
  assert.equal(details.after.regions.length, 1);
  assert.equal(event.durationMs, 2_000);
});

test("review telemetry retains append-only operator history and final disposition", () => {
  const removed = { ...memoryFinding, reviewResult: "REMOVED" as const };
  const remove = speedsterFindingActionEvents({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    actionId: "remove-1",
    operatorAction: "REMOVED",
    before: [memoryFinding],
    after: [removed],
    findingIds: [memoryFinding.id],
    startedAt: new Date("2026-08-09T12:00:00.000Z"),
    endedAt: new Date("2026-08-09T12:00:01.000Z"),
  });
  const restored = speedsterFindingActionEvents({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    actionId: "undo-1",
    operatorAction: "KEPT",
    before: [removed],
    after: [memoryFinding],
    findingIds: [memoryFinding.id],
    startedAt: new Date("2026-08-09T12:00:02.000Z"),
    endedAt: new Date("2026-08-09T12:00:03.000Z"),
  });

  assert.deepEqual([...remove, ...restored].map(({ operatorAction }) => operatorAction), ["REMOVED", "KEPT"]);
  assert.notEqual(remove[0].eventKey, restored[0].eventKey);
  assert.equal(speedsterFindingFinalEvents({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    findings: [removed],
  })[0].operatorAction, "REMOVED");
});

test("filter telemetry keeps immutable map rationale distinct from human review actions", () => {
  const [removed] = speedsterFilterRemovedEvents({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    decisions: [{
      finding: memoryFinding,
      cardIdentity: {
        cardName: "Cubone",
        year: "1999",
        productSet: "Jungle",
        parallel: null,
        cardNumber: "50",
      },
      mapId: "map-12345678901234567890",
      mapRevisionId: "revision-123456789012345",
      zoneId: "front-artwork",
      zoneType: "PRINT_ARTWORK",
      zoneOverlap: {
        method: "candidate-contour-segment-containment-v1",
        coveredVertices: 3,
        totalVertices: 3,
        ratio: 1,
        fullyContained: true,
      },
      filterPolicyVersion: "speedster-map-filter-containment-v1",
      ruleId: "human-zone-full-contour-containment-v1",
      ruleInputs: { findingOrigin: "MEMORY", requiredCoverageRatio: 1 },
      detectorVersion: "sam3-speedster-v1",
    }],
    startedAt: new Date("2026-08-09T12:00:00.000Z"),
    endedAt: new Date("2026-08-09T12:00:01.000Z"),
  });
  const restored = speedsterFilterRestoredEvent({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    decisionId: "decision-123456789012345",
    finding: memoryFinding,
    mapId: "map-12345678901234567890",
    mapRevisionId: "revision-123456789012345",
    zoneId: "front-artwork",
    zoneType: "PRINT_ARTWORK",
    filterPolicyVersion: "speedster-map-filter-containment-v1",
    ruleId: "human-zone-full-contour-containment-v1",
    outcome: "ACTIVE_REINTRODUCED",
    sessionLifecycleState: "CAPTURED",
  });

  assert.equal(removed.category, "FILTER_ACTION");
  assert.equal(removed.operatorAction, "FILTER_REMOVED");
  assert.equal(removed.similarity, 0.947);
  assert.match(JSON.stringify(removed.details), /human-zone-full-contour-containment-v1/);
  assert.equal(restored.category, "FILTER_ACTION");
  assert.equal(restored.operatorAction, "FILTER_RESTORED");
  assert.match(JSON.stringify(restored.details), /ACTIVE_REINTRODUCED/);
});

test("card-map telemetry records trusted family scope, key, revision, and provenance without image evidence", () => {
  const applied = {
    appliedScope: "FAMILY",
    appliedMapName: "2022 Pokemon · Lost Origin · Holo",
    revision: {
      mapId: "map-12345678901234567890",
      revisionId: "revision-123456789012345",
      matchKeyHash: "a".repeat(64),
      matchKey: {
        scope: "FAMILY",
        category: "POKEMON",
        year: "2022",
        productSet: "lost origin",
        parallel: "holo",
      },
    },
    sourceProvenance: {
      sourceSessionId: "source-session-1234567890",
      sourceIdentity: {
        cardName: "Snorlax",
        year: "2022",
        productSet: "Lost Origin",
        parallel: "Holo",
        cardNumber: "143/196",
      },
    },
  } as never;
  const event = speedsterCardMapApplicationEvent({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    applied,
    selected: applied,
  });

  assert.equal(event.category, "MAP_APPLICATION");
  assert.equal(event.eventType, "CARD_MAP_APPLIED");
  assert.match(JSON.stringify(event.details), /"appliedScope":"FAMILY"/);
  assert.match(JSON.stringify(event.details), /"cardName":"Snorlax"/);
  assert.doesNotMatch(JSON.stringify(event.details), /storageKey|imageUrl|imageBase64/);
});

function request(body: unknown): NextApiRequest {
  return {
    method: "POST",
    query: { sessionId: "session-12345678901234567890" },
    body,
    headers: {},
  } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown } = {};
  const res = {
    setHeader() { return this; },
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

test("client timing endpoint authenticates ownership and accepts bounded cycle data", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId, createdByUserId) {
      assert.equal(createdByUserId, "admin-1");
      return { id: sessionId };
    },
    async insertEvents(input) { events = input; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7ee",
    eventType: "NEXT_READY_RENDERED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:45.000Z",
    details: { startBasis: "FIRST_SPEEDSTER_INTERACTION", lowerBound: true, outcome: "SUCCEEDED" },
  }), result.res);

  assert.equal(result.state.status, 201);
  assert.equal(events[0].durationMs, 45_000);
  assert.equal(events[0].category, "CLIENT_TIMING");
});

test("geometry timing records map-assisted scope and revision for before-vs-after reporting", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async insertEvents(input) { events = input; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7ef",
    eventType: "GEOMETRY_CONFIRMED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:12.000Z",
    details: {
      side: "FRONT",
      mapAppliedScope: "FAMILY",
      mapName: "2022 Pokemon · Lost Origin · Holo",
      mapRevisionId: "revision-123456789012345",
    },
  }), result.res);

  assert.equal(result.state.status, 201);
  assert.equal(events[0].durationMs, 12_000);
  assert.deepEqual(events[0].details, {
    side: "FRONT",
    mapAppliedScope: "FAMILY",
    mapName: "2022 Pokemon · Lost Origin · Holo",
    mapRevisionId: "revision-123456789012345",
  });
});

test("geometry timing retains a maximum-length valid exact map display name", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async insertEvents(input) { events = input; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();
  const mapName = "x".repeat(864);

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7f1",
    eventType: "GEOMETRY_CONFIRMED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:12.000Z",
    details: {
      side: "FRONT",
      mapAppliedScope: "EXACT",
      mapName,
      mapRevisionId: "revision-123456789012345",
    },
  }), result.res);

  assert.equal(result.state.status, 201);
  assert.equal((events[0].details as { mapName: string }).mapName, mapName);
});

test("geometry timing records a map registration failure as manual without private error text", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async insertEvents(input) { events = input; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7f0",
    eventType: "GEOMETRY_CONFIRMED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:18.000Z",
    details: {
      side: "FRONT",
      mapAppliedScope: "NONE",
      mapFailureCode: "REGISTRATION_FAILED",
    },
  }), result.res);

  assert.equal(result.state.status, 201);
  assert.equal(events[0].durationMs, 18_000);
  assert.deepEqual(events[0].details, {
    side: "FRONT",
    mapAppliedScope: "NONE",
    mapFailureCode: "REGISTRATION_FAILED",
  });
});

test("client timing endpoint rejects secret-shaped payload fields", async () => {
  let inserts = 0;
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession() { return { id: "session-12345678901234567890" }; },
    async insertEvents() { inserts += 1; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7ee",
    eventType: "NEXT_READY_RENDERED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:45.000Z",
    details: { token: "must-not-be-stored" },
  }), result.res);

  assert.equal(result.state.status, 400);
  assert.equal(inserts, 0);
});

test("instrumentation migration is additive, append-only, constrained, and session-bound", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const schema = readFileSync(`${root}/../../packages/database/prisma/schema.prisma`, "utf8");
  const migration = readFileSync(
    `${root}/../../packages/database/prisma/migrations/20260810210000_speedster_instrumentation_events/migration.sql`,
    "utf8",
  );

  assert.match(schema, /model AiGraderV2InstrumentationEvent/);
  assert.match(schema, /eventKey\s+String\s+@unique/);
  assert.match(schema, /onDelete: Restrict/);
  assert.match(migration, /'FILTER_REMOVED', 'FILTER_RESTORED'/);
  assert.match(migration, /CREATE UNIQUE INDEX/);
  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE\s+FROM)\b/im);
});
