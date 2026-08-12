import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { NextApiRequest, NextApiResponse } from "next";

import { createRemovedFindingsAuditHandler } from "../pages/api/admin/ai-grader-v2/removed-findings";

const sessionId = "session-12345678901234567890";
const createdByUserId = "admin-1";
const measurement = {
  widthMm: 1,
  heightMm: 2,
  areaMm2: 2,
  zonePercent: 0.2,
  multiplier: 1,
  weightedAreaMm2: 2,
  subgradeEffect: 0.1,
};
const contour = [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.3 }];
const detectorRemoved = {
  id: "FRONT:detector-1:SURFACE",
  side: "FRONT",
  zone: "SURFACE",
  defectType: "FAINT_COLOR_VARIATION",
  origin: "DETECTOR",
  confidence: 0.82,
  canonicalContour: contour,
  sourceViewId: "FRONT:ORIGINAL",
  supportingViewIds: [],
  reviewResult: "REMOVED",
  reviewResultBeforeRemoval: "UNREVIEWED",
  featureFingerprint: Array.from({ length: 32 }, () => 0),
  measurement,
};
const memoryRemoved = {
  ...detectorRemoved,
  id: "BACK:memory-1:EDGES",
  side: "BACK",
  zone: "EDGES",
  defectType: "CHIPPING_EXPOSED_STOCK",
  detectedDefectType: "VISIBLE_WHITENING",
  origin: "MEMORY",
  sourceViewId: "BACK:DIRECTIONAL",
  memoryProposal: {
    lessonSessionId: "lesson-session-7",
    lessonCompletionOrder: 17,
    lessonProposalOrder: 3,
    lessonOrder: 1,
    lessonSourceViewId: "DIRECTIONAL",
    similarity: 0.947,
    secret: "must-not-leave-the-server",
  },
};
const { reviewResultBeforeRemoval: _removedState, ...detectorFinding } = detectorRemoved;
const accepted = { ...detectorFinding, id: "FRONT:kept-1:SURFACE", reviewResult: "ACCEPTED" };
const filterDecision = {
  id: "decision-123456789012345678",
  findingId: accepted.id,
  findingSnapshot: { ...accepted, reviewResult: "UNREVIEWED" },
  originalOrigin: "DETECTOR",
  proposedDefectType: accepted.defectType,
  confidence: accepted.confidence,
  similarity: null,
  generatingExemplar: null,
  sourceViewId: accepted.sourceViewId,
  supportingViewIds: accepted.supportingViewIds,
  mapId: "map-12345678901234567890",
  mapRevisionId: "map-revision-1234567890123",
  zoneId: "FRONT-print-zone",
  zoneType: "PRINT_ARTWORK",
  zoneOverlap: { coveredVertices: 3, totalVertices: 3, ratio: 1 },
  filterPolicyVersion: "speedster-map-filter-containment-v1",
  ruleId: "human-zone-full-contour-containment-v1",
  ruleInputs: { findingOrigin: "DETECTOR", requiredCoverageRatio: 1 },
  detectorVersion: "sam3-local-box-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543",
  filteredAt: new Date("2026-08-05T12:01:00.000Z"),
  restoreEvent: null,
  mapRevision: {
    frontMap: { zones: [{ id: "FRONT-print-zone", label: "Printed artwork" }] },
    backMap: { zones: [] },
  },
};

function expectedKeys(side: "FRONT" | "BACK") {
  const prefix = `ai-grader-v2/${createdByUserId}/${sessionId}/prepared/${side.toLowerCase()}`;
  return {
    inspectionStorageKey: `${prefix}/inspection.webp`,
    viewStorageKeys: {
      NORMALIZED: `${prefix}/normalized.webp`,
      MICRO_DEFECT: `${prefix}/micro_defect.webp`,
      DIRECTIONAL: `${prefix}/directional.webp`,
    },
    inspectionFrame: {
      width: 1290,
      height: 1798,
      cardBounds: { x: 10, y: 10, width: 1270, height: 1778 },
    },
  };
}

const completed = {
  id: sessionId,
  createdByUserId,
  cardProfile: "POKEMON",
  workflowState: "COMPLETED",
  identity: { cardName: "Cubone", year: "1999", productSet: "Jungle", cardNumber: "50/64" },
  capture: { cornerShape: "SQUARE", front: expectedKeys("FRONT"), back: expectedKeys("BACK") },
  reviewedDefects: [detectorRemoved, memoryRemoved, accepted],
  publicReportSlug: `speedster-${sessionId}`,
  collectibleCardV2: { lifecycleState: "GRADED" },
  mapFilterDecisions: [filterDecision],
  createdAt: new Date("2026-08-05T12:00:00.000Z"),
};
const unreadable = {
  ...completed,
  id: "session-98765432109876543210",
  reviewedDefects: { not: "an array" },
  capture: {},
  identity: { cardName: "Historical card" },
  collectibleCardV2: null,
  mapFilterDecisions: [],
};

function request(query: Record<string, string> = {}, method = "GET") {
  return { method, query, headers: {} } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, unknown> } = { headers: {} };
  const res = {
    setHeader(name: string, value: unknown) { state.headers[name] = value; return this; },
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

function dependencies() {
  return {
    async requireAdminSession() { return { user: { id: createdByUserId } }; },
    async listSessions() { return [completed, unreadable] as never; },
    async findSession(requestedSessionId: string) {
      return requestedSessionId === sessionId ? completed as never : null;
    },
    async listLabels() {
      return [{ sourceSessionId: sessionId, certificateNumber: "TKH-000641" }];
    },
    async presignRead(storageKey: string) { return `https://signed.example/${storageKey}`; },
  };
}

test("private audit counts every completed session and never silently drops unreadable history", async () => {
  const handler = createRemovedFindingsAuditHandler(dependencies());
  const result = response();

  await handler(request(), result.res);

  assert.equal(result.state.status, 200);
  assert.equal(result.state.headers["Cache-Control"], "private, no-store");
  const payload = result.state.body as {
    summary: {
      completedSessionsInspected: number;
      sessionsWithRemovedFindings: number;
      unreadableSessions: number;
      totalRemovedFindings: number;
      removedByOrigin: Record<string, number>;
    };
    cards: Array<{ id: string; dataStatus: string; removedCount: number; certificateNumber: string | null }>;
  };
  assert.equal(payload.summary.completedSessionsInspected, 2);
  assert.equal(payload.summary.sessionsWithRemovedFindings, 1);
  assert.equal(payload.summary.unreadableSessions, 1);
  assert.equal(payload.summary.totalRemovedFindings, 3);
  assert.deepEqual(payload.summary.removedByOrigin, { DETECTOR: 1, MEMORY: 1, SMART_MARK: 0 });
  assert.equal(payload.cards.find(({ id }) => id === sessionId)?.certificateNumber, "TKH-000641");
  assert.equal(payload.cards.find(({ id }) => id === unreadable.id)?.dataStatus, "UNREADABLE");
});
test("card detail exposes only saved removals with Memory provenance and signed owned evidence", async () => {
  const handler = createRemovedFindingsAuditHandler(dependencies());
  const result = response();

  await handler(request({ sessionId }), result.res);

  assert.equal(result.state.status, 200);
  const payload = result.state.body as {
    removedFindings: Array<Record<string, unknown>>;
    evidence: { status: string; sides: Record<string, { masterImageUrl: string }> };
  };
  assert.equal(payload.removedFindings.length, 3);
  assert.equal(payload.removedFindings.some(({ id, removalClass }) =>
    id === accepted.id && removalClass === "HUMAN_REMOVED"), false);
  const memory = payload.removedFindings.find(({ origin }) => origin === "MEMORY") as {
    memoryProposal: { similarity: number; lessonSessionId: string };
    detectedDefectType: string;
  };
  assert.equal(memory.memoryProposal.similarity, 0.947);
  assert.equal(memory.memoryProposal.lessonSessionId, "lesson-session-7");
  assert.equal(memory.detectedDefectType, "VISIBLE_WHITENING");
  const serialized = JSON.stringify(payload.removedFindings);
  assert.equal(serialized.includes("featureFingerprint"), false);
  assert.equal(serialized.includes("reviewResultBeforeRemoval"), false);
  assert.equal(serialized.includes("finalTrace"), false);
  assert.equal(serialized.includes("must-not-leave-the-server"), false);
  assert.equal(payload.evidence.status, "AVAILABLE");
  assert.match(payload.evidence.sides.FRONT.masterImageUrl, /prepared\/front\/inspection\.webp$/);
  assert.match(payload.evidence.sides.BACK.masterImageUrl, /prepared\/back\/inspection\.webp$/);
  const filtered = payload.removedFindings.find(({ removalClass }) => removalClass === "FILTER_REMOVED") as {
    decisionId: string;
    mapRevisionId: string;
    zoneLabel: string;
    restore: { restored: boolean };
  };
  assert.equal(filtered.decisionId, filterDecision.id);
  assert.equal(filtered.mapRevisionId, filterDecision.mapRevisionId);
  assert.equal(filtered.zoneLabel, "Printed artwork");
  assert.equal(filtered.restore.restored, false);
});

test("removed-findings inventory remains admin-only and GET-only while the screen exposes the separate restore route", async () => {
  let listed = 0;
  const deps = dependencies();
  const handler = createRemovedFindingsAuditHandler({
    ...deps,
    async listSessions() { listed += 1; return [] as never; },
  });
  const result = response();

  await handler(request({}, "POST"), result.res);

  assert.equal(result.state.status, 405);
  assert.equal(listed, 0);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const api = readFileSync(`${root}/pages/api/admin/ai-grader-v2/removed-findings.ts`, "utf8");
  const page = readFileSync(`${root}/pages/admin/ai-grader-v2/removed-findings.tsx`, "utf8");
  const reviewApi = readFileSync(`${root}/pages/api/admin/ai-grader-v2/sessions/[sessionId]/review-action.ts`, "utf8");
  const restoreApi = readFileSync(`${root}/pages/api/admin/ai-grader-v2/removed-findings/[decisionId]/restore.ts`, "utf8");
  const reviewWorkspace = readFileSync(`${root}/components/ai-grader-v2/ReviewWorkspace.tsx`, "utf8");
  const normalReviewPage = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");
  const normalReviewInvocation = normalReviewPage.slice(
    normalReviewPage.indexOf("<ReviewWorkspace"),
    normalReviewPage.indexOf("/>", normalReviewPage.indexOf("<ReviewWorkspace")) + 2,
  );
  assert.match(api, /requireAdminSession/);
  assert.match(api, /reviewResult === "REMOVED"/);
  assert.doesNotMatch(api, /prisma\.[a-zA-Z]+\.(create|update|updateMany|delete|deleteMany|upsert)\(/);
  assert.match(page, /method:\s*"POST"/);
  assert.match(page, /PRIVATE FILTER AUDIT/);
  assert.match(page, /lessonProposalOrder/);
  assert.match(page, /lessonSourceViewId/);
  for (const visibleField of [
    "removalClass", "mapId", "mapRevisionId", "zoneId", "cardProfile", "side",
    "sourceViewId", "origin", "defectType", "restored",
  ]) assert.match(page, new RegExp(visibleField));
  assert.match(page, /Session \{detail\.card\.id\}/);
  assert.match(page, /Confidence \{finding\.confidence/);
  assert.match(page, /supportingViewIds/);
  assert.match(page, /workflowState === "COMPLETED"/);
  assert.match(page, /Active Speedster session/);
  assert.match(page, /DefectEvidenceViewer/);
  assert.match(page, /zoneOverlap/);
  assert.match(page, /filterPolicyVersion/);
  assert.match(normalReviewInvocation, /mapRegistrations=/);
  assert.match(reviewApi, /prisma\.\$transaction/);
  assert.match(reviewApi, /loadPinnedSpeedsterMapRevision/);
  assert.match(reviewApi, /aiGraderV2Session\.updateMany/);
  assert.match(reviewApi, /aiGraderV2MapFilterDecision\.createMany/);
  assert.match(restoreApi, /assertSpeedsterCompletedRestoreSnapshotUnchanged\(before, after\)/);
  assert.match(restoreApi, /aiGraderV2MapFilterRestoreEvent\.create/);
  assert.doesNotMatch(restoreApi, /aiGraderV2CardTypeMap(?:Revision)?\.(?:update|updateMany|create|upsert|delete)/);
  assert.doesNotMatch(restoreApi, /LearningBank|learningBank/);
  for (const forbiddenNormalReviewSurface of [
    /FILTER_REMOVED/,
    /filteredCount/,
    /mapFilter/,
    /filterTray/,
  ]) {
    assert.doesNotMatch(reviewWorkspace, forbiddenNormalReviewSurface);
    assert.doesNotMatch(normalReviewInvocation, forbiddenNormalReviewSurface);
  }
});
