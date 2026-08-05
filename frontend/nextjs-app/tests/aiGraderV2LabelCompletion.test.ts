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
const completionOrder = 207;
const harvestReceipt = {
  findings: 4,
  admittedLessons: 2,
  skippedLessons: 2,
  skipped: {
    invalidFindings: 0,
    missingFingerprints: 1,
    invalidFingerprints: 0,
    unboundTraceFingerprints: 0,
    versionMismatch: 0,
    untouchedMemory: 1,
    untouchedCap: 0,
    sameCardDuplicate: 0,
  },
};
const readyLearning = {
  catchUpStatus: "V2_UPDATED" as const,
  ready: true,
  completionOrder,
  lastCompletionOrder: completionOrder,
  completionReflected: true,
  appliedSessions: 1,
  bankCursor: {
    completionOrder,
    sessionId,
    sessionDigest: "d".repeat(64),
  },
  harvest: harvestReceipt,
};
const currentLearning = {
  ...readyLearning,
  catchUpStatus: "V2_CURRENT" as const,
  appliedSessions: 0,
};
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

function request(body: unknown = {}): NextApiRequest {
  return {
    method: "POST",
    query: { sessionId },
    body,
    headers: {},
  } as unknown as NextApiRequest;
}

test("completion rejects client-owned findings and grade authority", async () => {
  let completed = false;
  const handler = createAiGraderV2CompleteLabelHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async completeSession() { completed = true; throw new Error("must not run"); },
    async completePresentation() { return undefined; },
  });
  const rejected = response();

  await handler(request({ reviewedDefects: [], gradeReport }), rejected.res);

  assert.equal(rejected.state.status, 400);
  assert.equal(completed, false);
});

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
  let saved: {
    label: { id: string; sheetId: string; slot: number; certificateNumber: string; completionOrder: number };
    publicReportSlug: string;
  } | null = null;
  let creations = 0;
  const handler = createAiGraderV2CompleteLabelHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async completeSession(input) {
      assert.equal(input.createdByUserId, "admin-1");
      assert.deepEqual(Object.keys(input).sort(), ["createdByUserId", "sessionId"]);
      if (saved) return { outcome: "EXISTING" as const, ...saved, learning: currentLearning };
      creations += 1;
      saved = {
        label: {
          id: "label-1",
          sheetId: "sheet-1",
          slot: 7,
          certificateNumber: "TKH-000207",
          completionOrder,
        },
        publicReportSlug: speedsterReportSlug(sessionId),
      };
      return { outcome: "CREATED" as const, ...saved, learning: readyLearning };
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
  assert.deepEqual((first.state.body as { learning: unknown }).learning, readyLearning);
  assert.deepEqual((retry.state.body as { learning: unknown }).learning, currentLearning);
});

test("a learning catch-up failure is exposed as not ready without blocking the durable completion response", async () => {
  const learning = {
    catchUpStatus: "FAILED" as const,
    ready: false,
    completionOrder,
    lastCompletionOrder: null,
    completionReflected: false,
    appliedSessions: 0,
    bankCursor: null,
    harvest: harvestReceipt,
  };
  const handler = createAiGraderV2CompleteLabelHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async completeSession() {
      return {
        outcome: "CREATED",
        label: {
          id: "label-1",
          sheetId: "sheet-1",
          slot: 7,
          certificateNumber: "TKH-000207",
          completionOrder,
        },
        publicReportSlug: speedsterReportSlug(sessionId),
        learning,
      };
    },
    async completePresentation() { return undefined; },
  });
  const completed = response();

  await handler(request(), completed.res);

  assert.equal(completed.state.status, 201);
  assert.deepEqual((completed.state.body as { learning: unknown }).learning, learning);
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
          label: {
            id: "label-1",
            sheetId: "sheet-1",
            slot: 7,
            certificateNumber: "TKH-000207",
            completionOrder,
          },
          publicReportSlug: speedsterReportSlug(sessionId),
          learning: readyLearning,
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
  assert.match(endpoint, /if \(session\.workflowState !== "CAPTURED"\)/);
  assert.match(endpoint, /workflowState: "CAPTURED"/);
  const completionLock = endpoint.indexOf("FROM \"AiGraderV2Session\"");
  const authoritativeRead = endpoint.indexOf("const session = await tx.aiGraderV2Session.findFirst");
  assert.ok(completionLock >= 0 && completionLock < authoritativeRead, "completion must lock before its authoritative read");
  assert.match(endpoint.slice(completionLock, authoritativeRead), /FOR UPDATE/);
  assert.match(endpoint, /where: \{ sourceSessionId: session\.id \}/);
  assert.match(endpoint, /createdByUserId: input\.createdByUserId/);
  assert.equal((endpoint.match(/pg_advisory_xact_lock/g) ?? []).length, 1);
  assert.equal((humanGradeEndpoint.match(/pg_advisory_xact_lock/g) ?? []).length, 2);
  assert.equal((`${endpoint}\n${humanGradeEndpoint}`.match(/SELECT 1 AS "lockAcquired"/g) ?? []).length, 3);
  assert.doesNotMatch(`${endpoint}\n${humanGradeEndpoint}`, /SELECT\s+pg_advisory_xact_lock/);
});

test("the completed-card panel shows the read-only Memory receipt without gating the workflow", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const page = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");

  assert.match(page, /completion\.learning\.ready/);
  assert.match(page, /completion\.learning\.harvest\.admittedLessons/);
  assert.match(page, /completion\.learning\.harvest\.skippedLessons/);
  assert.match(page, /completion\.learning\.bankCursor\?\.completionOrder/);
  assert.doesNotMatch(page, /disabled=\{[^}]*completion\.learning/);
});
