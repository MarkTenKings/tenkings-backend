import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { buildHumanGradeLabelContent } from "../lib/humanGrade";
import {
  buildSpeedsterLabelData,
  createAiGraderV2CompleteLabelHandler,
  speedsterReportSlug,
} from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]/complete-label";

const sessionId = "clabelsession1234567890";
const gradeReport = {
  front: {
    centering: {
      leftRightBalance: [50, 50] as [number, number],
      topBottomBalance: [50, 50] as [number, number],
      score: 10,
    },
    corners: { weightedDamagePercent: 0, score: 10 },
    edges: { weightedDamagePercent: 0, score: 10 },
    surface: { weightedDamagePercent: 0, score: 10 },
  },
  back: {
    centering: {
      leftRightBalance: [50, 50] as [number, number],
      topBottomBalance: [50, 50] as [number, number],
      score: 10,
    },
    corners: { weightedDamagePercent: 0, score: 10 },
    edges: { weightedDamagePercent: 0, score: 10 },
    surface: { weightedDamagePercent: 0, score: 10 },
  },
  subgrades: { centering: 10, corners: 9.89, edges: 7.3, surface: 8.6 },
  overall: { rawGrade: 8.9475, displayGrade: 8.9 },
};

const speedsterSession = {
  id: sessionId,
  cardProfile: "POKEMON",
  workflowState: "REVIEWED",
  publicReportSlug: null,
  identity: {
    cardName: "Charizard ex",
    year: "2025",
    productSet: "Journey Together",
    parallel: "Special Illustration Rare",
    cardNumber: "190/159",
  },
};

function request(): NextApiRequest {
  return {
    method: "POST",
    query: { sessionId },
    body: { reviewedDefects: [], gradeReport },
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

test("Speedster label data keeps the authoritative full-precision overall while displaying one-decimal subgrades", () => {
  const label = buildSpeedsterLabelData(speedsterSession, gradeReport);
  assert.equal(label.source, "SPEEDSTER");
  assert.equal(label.sourceSessionId, sessionId);
  assert.equal(label.gradingFormulaVersion, "EQUAL_25");
  assert.equal(label.cornersGrade, "9.9");
  assert.equal(label.grade, "8.9");

  const printable = buildHumanGradeLabelContent({
    ...label,
    certificateNumber: "TKH-000001",
  });
  assert.equal(printable.grade, "8.9");
  assert.equal(printable.subgrades[1].grade, "9.9");
});

test("Human labels retain their existing weighted-grade validation", () => {
  assert.throws(
    () => buildHumanGradeLabelContent({
      ...buildSpeedsterLabelData(speedsterSession, gradeReport),
      source: "HUMAN",
      certificateNumber: "TKH-000001",
    }),
    /Human grade does not match its EQUAL_25 weighted subgrades/,
  );
});

test("completion retry returns the original label without consuming another slot", async () => {
  let saved: { label: { id: string; sheetId: string; slot: number; certificateNumber: string }; publicReportSlug: string } | null = null;
  let creations = 0;
  const handler = createAiGraderV2CompleteLabelHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async completeSession(input) {
      assert.equal(input.createdByUserId, "admin-1");
      if (saved) return { outcome: "EXISTING" as const, ...saved };
      creations += 1;
      saved = {
        label: { id: "label-1", sheetId: "sheet-1", slot: 7, certificateNumber: "TKH-000207" },
        publicReportSlug: speedsterReportSlug(sessionId),
      };
      return { outcome: "CREATED" as const, ...saved };
    },
    async completePresentation(input) {
      assert.equal(input.sessionId, sessionId);
      assert.equal(input.createdByUserId, "admin-1");
    },
  });
  const first = response();
  const retry = response();

  await handler(request(), first.res);
  await handler(request(), retry.res);

  assert.equal(first.state.status, 201);
  assert.equal(retry.state.status, 200);
  assert.equal(creations, 1);
  assert.deepEqual((retry.state.body as { label: unknown }).label, (first.state.body as { label: unknown }).label);
});

test("PhotoRoom starts only after durable completion and can fail without rolling the grade back", async () => {
  let completed = false;
  const events: string[] = [];
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const handler = createAiGraderV2CompleteLabelHandler({
      async requireAdminSession() { return { user: { id: "admin-1" } }; },
      async completeSession() {
        events.push("grade-complete");
        completed = true;
        return {
          outcome: "CREATED",
          label: { id: "label-1", sheetId: "sheet-1", slot: 7, certificateNumber: "TKH-000207" },
          publicReportSlug: speedsterReportSlug(sessionId),
        };
      },
      async completePresentation() {
        assert.equal(completed, true);
        events.push("photoroom");
        throw new Error("PhotoRoom unavailable");
      },
    });
    const failed = response();

    await handler(request(), failed.res);

    assert.deepEqual(events, ["grade-complete", "photoroom"]);
    assert.equal(failed.state.status, 502);
    assert.match(
      (failed.state.body as { message: string }).message,
      /grade and label are safely complete/i,
    );
    assert.equal(completed, true);
  } finally {
    console.error = originalConsoleError;
  }
});

test("additive schema seam defaults existing labels to HUMAN and uniquely links one Speedster session", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const schema = readFileSync(`${root}/../../packages/database/prisma/schema.prisma`, "utf8");
  const migration = readFileSync(
    `${root}/../../packages/database/prisma/migrations/20260731223000_ai_grader_v2_label_source/migration.sql`,
    "utf8",
  );
  const endpoint = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/sessions/[sessionId]/complete-label.ts`,
    "utf8",
  );
  const humanGradeEndpoint = readFileSync(`${root}/pages/api/admin/human-grade/index.ts`, "utf8");

  assert.match(schema, /source\s+HumanGradeLabelSource\s+@default\(HUMAN\)/);
  assert.match(schema, /sourceSessionId\s+String\?\s+@unique/);
  assert.match(migration, /ADD COLUMN "source"[^\n]+NOT NULL DEFAULT 'HUMAN'/);
  assert.doesNotMatch(migration, /\bUPDATE\s+"HumanGradeLabel"/i);
  assert.match(endpoint, /workflowState: \{ not: "COMPLETED" \}/);
  assert.match(endpoint, /where: \{ sourceSessionId: session\.id \}/);
  assert.match(endpoint, /createdByUserId: input\.createdByUserId/);
  assert.equal((endpoint.match(/pg_advisory_xact_lock/g) ?? []).length, 1);
  assert.equal((humanGradeEndpoint.match(/pg_advisory_xact_lock/g) ?? []).length, 2);
  assert.equal((`${endpoint}\n${humanGradeEndpoint}`.match(/SELECT 1 AS "lockAcquired"/g) ?? []).length, 3);
  assert.doesNotMatch(`${endpoint}\n${humanGradeEndpoint}`, /SELECT\s+pg_advisory_xact_lock/);
});
