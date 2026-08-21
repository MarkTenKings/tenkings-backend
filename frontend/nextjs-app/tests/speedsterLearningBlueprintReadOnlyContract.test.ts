import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createLearningBlueprintCardsHandler } from "../pages/api/admin/ai-grader-v2/learning-blueprint/cards";
import { createLearningBlueprintCompareHandler } from "../pages/api/admin/ai-grader-v2/learning-blueprint/compare";

const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
  "utf8",
);

const backend = () => source("lib/server/speedsterLearningBlueprint.ts");
const cardsRoute = () => source("pages/api/admin/ai-grader-v2/learning-blueprint/cards.ts");
const compareRoute = () => source("pages/api/admin/ai-grader-v2/learning-blueprint/compare.ts");
const page = () => source("pages/admin/ai-grader-v2/learning-blueprint.tsx");

function responseHarness() {
  const headers = new Map<string, unknown>();
  const state: { statusCode: number; body: unknown } = { statusCode: 200, body: null };
  const response = {
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
      return response;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
  };
  return { response, headers, state };
}

const sessionRow = (id: string) => ({
  id,
  createdByUserId: "admin-1",
  cardProfile: "POKEMON",
  workflowState: "COMPLETED",
  identity: { cardName: id },
  capture: {},
  reviewedDefects: [],
  gradeReport: { overall: { displayGrade: 8.5 } },
  mapRevisionId: null,
  mapRevision: null,
  createdAt: new Date("2026-08-20T12:00:00.000Z"),
  geometry: [],
});

test("Learning Blueprint APIs are authenticated GET-only, private, and no-store", () => {
  for (const route of [cardsRoute(), compareRoute()]) {
    assert.match(route, /requireAdminSession\s*\(/);
    assert.match(route, /req\.method\s*!==\s*["']GET["']/);
    assert.match(route, /setHeader\(\s*["']Allow["']\s*,\s*["']GET["']\s*\)/);
    assert.match(route, /setHeader\(\s*["']Cache-Control["']\s*,\s*["'][^"']*no-store[^"']*["']\s*\)/);
    assert.doesNotMatch(route, /req\.method\s*===\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    assert.doesNotMatch(route, /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
  }
});

test("Learning Blueprint handlers set no-store before rejecting methods or authentication", async () => {
  for (const createHandler of [createLearningBlueprintCardsHandler, createLearningBlueprintCompareHandler]) {
    let authCalls = 0;
    const handler = createHandler({
      requireAdminSession: async () => { authCalls += 1; },
    } as never);
    const methodResponse = responseHarness();
    await handler({ method: "POST", query: {} } as never, methodResponse.response as never);
    assert.equal(methodResponse.state.statusCode, 405);
    assert.equal(methodResponse.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(authCalls, 0);
  }

  const authResponse = responseHarness();
  const handler = createLearningBlueprintCardsHandler({
    requireAdminSession: async () => { throw new Error("signed out"); },
  } as never);
  await handler({ method: "GET", query: {} } as never, authResponse.response as never);
  assert.equal(authResponse.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.notEqual(authResponse.state.statusCode, 200);
});

test("card-list response preserves newest completion order independently of session query order", async () => {
  const newer = sessionRow("session-newer-12345");
  const older = sessionRow("session-older-12345");
  const response = responseHarness();
  const handler = createLearningBlueprintCardsHandler({
    requireAdminSession: async () => undefined,
    listLabels: async () => [
      { sourceSessionId: newer.id, certificateSequence: 20, createdAt: new Date("2026-08-20T12:00:00.000Z") },
      { sourceSessionId: older.id, certificateSequence: 10, createdAt: new Date("2026-08-19T12:00:00.000Z") },
    ],
    listSessions: async () => [older, newer],
  } as never);
  await handler({ method: "GET", query: {} } as never, response.response as never);
  assert.equal(response.state.statusCode, 200);
  assert.deepEqual(
    (response.state.body as { cards: Array<{ completionOrder: number }> }).cards.map(({ completionOrder }) => completionOrder),
    [20, 10],
  );
});

test("comparison rejects duplicate cards and an over-budget event roster before projection", async () => {
  let dataCalls = 0;
  const duplicateResponse = responseHarness();
  const duplicateHandler = createLearningBlueprintCompareHandler({
    requireAdminSession: async () => undefined,
    findSessions: async () => { dataCalls += 1; return []; },
  } as never);
  await duplicateHandler({
    method: "GET",
    query: { firstSessionId: "session-same-12345", secondSessionId: "session-same-12345" },
  } as never, duplicateResponse.response as never);
  assert.equal(duplicateResponse.state.statusCode, 400);
  assert.equal(dataCalls, 0);

  const first = sessionRow("session-first-12345");
  const second = sessionRow("session-second-1234");
  const overflowResponse = responseHarness();
  const overflowHandler = createLearningBlueprintCompareHandler({
    requireAdminSession: async () => undefined,
    findSessions: async () => [first, second],
    findLabels: async () => [
      { sourceSessionId: first.id, certificateSequence: 1, createdAt: first.createdAt },
      { sourceSessionId: second.id, certificateSequence: 2, createdAt: second.createdAt },
    ],
    findGeometry: async () => [],
    findEvents: async () => Array.from({ length: 4_097 }, (_, index) => ({
      eventKey: `event-${index}`,
      sessionId: first.id,
      createdByUserId: "admin-1",
      category: "MEMORY_DECISION",
      eventType: "MEMORY_LESSON_SCAN_VERDICTS_RECORDED",
      findingId: null,
      details: {},
      createdAt: first.createdAt,
    })),
    findFiltered: async () => [],
    presignRead: async () => { throw new Error("projection must not sign images after overflow"); },
  } as never);
  await overflowHandler({
    method: "GET",
    query: { firstSessionId: first.id, secondSessionId: second.id },
  } as never, overflowResponse.response as never);
  assert.equal(overflowResponse.state.statusCode, 422);
});

test("Learning Blueprint browser code performs no mutation fetch", () => {
  const ui = page();
  assert.match(ui, /fetch\s*\(/);
  assert.doesNotMatch(ui, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(ui, /(?:save|delete|remove|update|mutate)LearningBlueprint/i);
});

test("browser comparison data is validated and failures have an explicit retry state", () => {
  const ui = page();
  assert.match(ui, /const raw: unknown = await response\.json\(\)\.catch/);
  assert.match(ui, /parseCardsPayload\(raw\)/);
  assert.match(ui, /parseComparison\(raw\)/);
  assert.match(ui, /setComparePhase\(["']ERROR["']\)/);
  assert.match(ui, />Try again<\/button>/);
  assert.match(ui, /if \(current\.includes\(card\.sessionId\)\) return current;/);
  assert.match(ui, /row\.x\s*>=\s*0\s*&&\s*row\.x\s*<=\s*1/);
  assert.match(ui, /contour\.length\s*>=\s*3/);
  assert.match(ui, /trace\.runs\.reduce[\s\S]*?===\s*expectedPixels/);
  assert.match(ui, /bounds\.x\s*\+\s*bounds\.width\s*<=\s*row\.width/);
  assert.match(ui, /geometry\?\.mode\s*===\s*["']PHYSICAL_OUTER["'][\s\S]*?geometry\.coordinateSpace\s*===\s*["']ORIGINAL_UNIT["']/);
  assert.match(ui, /quad\.length\s*===\s*4/);
  assert.match(ui, /defect\.coordinateSpace\s*===\s*["']CANONICAL_CARD["']/);
});

test("later-card markers require exact evidence anchors and missing shapes stay visible", () => {
  const contract = backend();
  const ui = page();
  assert.match(contract, /targetAnchors:\s*verdict\.status\s*===\s*["']USED["']\s*&&\s*finalLearning/);
  assert.match(contract, /FINDING_PROPOSED[\s\S]*?rawCandidateId[\s\S]*?targetAnchors/);
  assert.match(ui, /anchorCenter\(anchor, side, layer/);
  assert.match(ui, /drawOutcomeMarker\(context, point, status/);
  assert.match(ui, /shapeUnavailableReason/);
  assert.match(ui, /saved evidence has no exact on-card target to mark/);
  assert.match(ui, /Saved target[\s\S]*?is missing from this card/);
  assert.match(ui, /Saved target[\s\S]*?has no exact shape to draw/);
  assert.match(ui, /anchorLayer\(anchor, sideEvidence\)\s*===\s*layer/);
});

test("the amber summary names recorded rejected and skipped verdicts honestly", () => {
  const ui = page();
  assert.match(ui, /pairSummary\.rejected\s*\+\s*comparison\.pairSummary\.skipped\s*\+\s*comparison\.pairSummary\.unproven/);
  assert.match(ui, /Rejected \/ skipped \/ unproven \?/);
  assert.doesNotMatch(ui, /<i className=\{styles\.amberDot\} \/>Unproven \?/);
});

test("only an exact linked USED verdict can become green; every other telemetry state stays unproven", () => {
  const contract = backend();
  const ui = page();
  assert.match(contract, /status\s*!==\s*["']USED["']\s*&&\s*status\s*!==\s*["']REJECTED["']\s*&&\s*status\s*!==\s*["']SKIPPED["']/);
  assert.match(contract, /status:\s*["']UNPROVEN["']/);
  assert.match(contract, /FINAL_CAPTURE_LEARNING_LINK_MISSING/);
  assert.match(contract, /UNPROVEN_LEGACY_NO_LESSON_VERDICT/);
  assert.match(contract, /NO_SELECTED_SCAN_GEOMETRY_VERDICT/);
  assert.match(contract, /finalCaptureLinked:\s*verdict\.status\s*===\s*["']USED["']\s*\?\s*true\s*:\s*null/);
  assert.match(contract, /verdict\?\.status\s*!==\s*["']USED["']\s*\|\|\s*Boolean\(finalLearning\)/);
  assert.match(contract, /learningBank:\s*verdict\s*\?\s*["']PROVEN_FOR_SELECTED_SCAN["']\s*:\s*["']UNPROVEN["']/);
  assert.doesNotMatch(contract, /learningBank:\s*["']CURRENT["']/);
  assert.doesNotMatch(compareRoute(), /loadBankState|aiGraderV2LearningBank|["']GLOBAL["']/);
  assert.match(ui, /status\s*===\s*["']USED["'][\s\S]{0,140}tone:\s*styles\.used/);
  assert.match(ui, /symbol:\s*["']\?["'][\s\S]{0,180}tone:\s*styles\.unproven/);
  assert.doesNotMatch(ui, /status\s*===\s*["'](?:REJECTED|SKIPPED|UNPROVEN)["'][\s\S]{0,180}styles\.used/);
});

test("a repeated mistake is never inferred and the red count remains zero", () => {
  const contract = backend();
  const ui = page();
  assert.match(contract, /repeatedMistake:\s*["']UNPROVEN_NO_EXPLICIT_REPEAT_EVIDENCE["']/);
  assert.match(contract, /repeatedMistakesProven:\s*0/);
  assert.doesNotMatch(contract, /repeatedMistakesProven\s*\+=|repeatedMistakesProven\+\+|repeatedMistake:\s*["']PROVEN["']/);
  assert.match(ui, /pairSummary\.repeatedMistakesProven\s*\?\?\s*0/);
});

test("printed-frame corrections stop at the saved-record boundary", () => {
  const contract = backend();
  const ui = page();
  assert.match(contract, /kind:\s*["']PRINTED_FRAME["'][\s\S]*?savedToRecord:\s*["']PROVEN["']/);
  assert.match(contract, /kind:\s*["']PRINTED_FRAME["'][\s\S]*?learningBank:\s*["']UNPROVEN["']/);
  assert.match(contract, /kind:\s*["']PRINTED_FRAME["'][\s\S]*?status:\s*["']NOT_TESTABLE["']/);
  assert.match(contract, /NO_PRINTED_FRAME_LEARNING_CONTRACT/);
  assert.match(ui, /trail\.kind\s*===\s*["']PRINTED_FRAME["']\s*\?\s*["']No learning path yet["']/);
});

test("card lists are newest-first while comparisons order cards by immutable completion order", () => {
  const list = cardsRoute();
  const comparison = backend();
  assert.match(list, /certificateSequence["']?\s+DESC/);
  assert.match(list, /workflowState["']?\s*=\s*["']COMPLETED["']/);
  assert.match(list, /lifecycleState["']?::text\s*<>\s*["']VOID["']/);
  assert.ok(list.indexOf("lifecycleState") < list.indexOf("LIMIT ${take}"));
  assert.match(compareRoute(), /nonVoidSpeedsterCardFilter/);
  assert.match(comparison, /firstLabel\.certificateSequence\s*<=\s*input\.secondLabel\.certificateSequence/);
  assert.doesNotMatch(comparison, /createdAt\s*<=\s*input\.secondLabel\.createdAt/);
  assert.match(page(), /sort\(\(left, right\)\s*=>\s*left\.completionOrder\s*-\s*right\.completionOrder\)/);
});

test("defect, physical-outline, and printed-frame coordinates remain separate", () => {
  const contract = backend();
  const ui = page();
  assert.match(contract, /coordinateSpace:\s*["']CANONICAL_CARD["']/);
  assert.match(contract, /row\.mode\s*===\s*["']PHYSICAL_OUTER["']\s*\?\s*["']ORIGINAL_UNIT["']\s*:\s*["']RECTIFIED_UNIT["']/);
  assert.doesNotMatch(contract, /coordinateSpace:\s*["'](?:ORIGINAL_UNIT|RECTIFIED_UNIT)["'][\s\S]{0,180}findingId/);
  assert.match(ui, /layer\s*===\s*["']DEFECTS["']\s*\?\s*side\.images\.inspection[\s\S]*?layer\s*===\s*["']PHYSICAL_OUTER["']\s*\?\s*side\.images\.original[\s\S]*?side\.images\.rectified/);
  assert.match(ui, /frame\.width\s*-\s*1/);
  assert.match(ui, /shape\.trace\.width\s*-\s*1/);
  assert.match(ui, /width\s*-\s*1/);
});
