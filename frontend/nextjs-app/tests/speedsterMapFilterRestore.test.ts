import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { NextApiRequest, NextApiResponse } from "next";

import { SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION } from "../lib/ai-grader-v2/learning-calibration-v2";
import { calculateSpeedsterReview } from "../lib/ai-grader-v2/review";
import {
  remeasureSpeedsterFilteredFindingRestore,
  type SpeedsterReviewActionSession,
} from "../lib/server/aiGraderV2ReviewAction";
import {
  assertSpeedsterCompletedRestoreSnapshotUnchanged,
  restoreSpeedsterMapFilterDecision,
  SPEEDSTER_FILTER_CALIBRATION_MISTAKE_VERSION,
  type SpeedsterMapFilterRestoreDecision,
  type SpeedsterMapFilterRestoreEvent,
} from "../lib/server/aiGraderV2MapFilterRestore";
import { createSpeedsterMapFilterRestoreHandler } from "../pages/api/admin/ai-grader-v2/removed-findings/[decisionId]/restore";

const sessionId = "session-12345678901234567890";
const decisionId = "decision-123456789012345678";
const finding = {
  id: "FRONT:filtered:SURFACE",
  side: "FRONT" as const,
  zone: "SURFACE" as const,
  defectType: "LIGHT_SCRATCH_SCUFF" as const,
  detectedDefectType: "LIGHT_SCRATCH_SCUFF" as const,
  origin: "DETECTOR" as const,
  confidence: 0.9,
  canonicalContour: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }],
  sourceViewId: "FRONT:ORIGINAL",
  supportingViewIds: [] as string[],
  reviewResult: "UNREVIEWED" as const,
  measurement: {
    widthMm: 1,
    heightMm: 1,
    areaMm2: 1,
    zonePercent: 0.2,
    multiplier: 1,
    weightedAreaMm2: 1,
    subgradeEffect: 0.1,
  },
};
const capture = {
  cornerShape: "SQUARE",
  front: {
    originalStorageKey: `ai-grader-v2/admin-1/${sessionId}/original/front.jpg`,
    rectifiedStorageKey: `ai-grader-v2/admin-1/${sessionId}/prepared/front/rectified.webp`,
    inspectionStorageKey: `ai-grader-v2/admin-1/${sessionId}/prepared/front/inspection.webp`,
    inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
    viewStorageKeys: {
      NORMALIZED: `ai-grader-v2/admin-1/${sessionId}/prepared/front/normalized.webp`,
      MICRO_DEFECT: `ai-grader-v2/admin-1/${sessionId}/prepared/front/micro_defect.webp`,
      DIRECTIONAL: `ai-grader-v2/admin-1/${sessionId}/prepared/front/directional.webp`,
    },
    centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 },
  },
  back: {
    originalStorageKey: `ai-grader-v2/admin-1/${sessionId}/original/back.jpg`,
    rectifiedStorageKey: `ai-grader-v2/admin-1/${sessionId}/prepared/back/rectified.webp`,
    inspectionStorageKey: `ai-grader-v2/admin-1/${sessionId}/prepared/back/inspection.webp`,
    inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
    viewStorageKeys: {
      NORMALIZED: `ai-grader-v2/admin-1/${sessionId}/prepared/back/normalized.webp`,
      MICRO_DEFECT: `ai-grader-v2/admin-1/${sessionId}/prepared/back/micro_defect.webp`,
      DIRECTIONAL: `ai-grader-v2/admin-1/${sessionId}/prepared/back/directional.webp`,
    },
    centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 },
  },
};

function reviewSession(workflowState = "CAPTURED"): SpeedsterReviewActionSession {
  return {
    id: sessionId,
    createdByUserId: "admin-1",
    cardProfile: "POKEMON",
    workflowState,
    identity: { cardName: "Cubone", year: "1999", productSet: "Jungle", parallel: null, cardNumber: "50/64" },
    capture,
    reviewedDefects: [],
    gradeReport: { detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION },
    mapRevisionId: "map-revision-1234567890123",
    mapFilterPolicyVersion: "speedster-map-filter-containment-v1",
    mapRegistration: {},
    updatedAt: new Date("2026-08-10T00:00:00.000Z"),
  };
}

function decision(workflowState = "CAPTURED"): SpeedsterMapFilterRestoreDecision {
  return {
    id: decisionId,
    sessionId,
    findingId: finding.id,
    side: finding.side,
    originalOrigin: finding.origin,
    proposedDefectType: finding.defectType,
    findingSnapshot: finding,
    mapId: "map-12345678901234567890",
    mapRevisionId: "map-revision-1234567890123",
    zoneId: "FRONT-print-zone",
    zoneType: "PRINT_ARTWORK",
    zoneOverlap: { coveredVertices: 3, totalVertices: 3, ratio: 1 },
    filterPolicyVersion: "speedster-map-filter-containment-v1",
    ruleId: "human-zone-full-contour-containment-v1",
    ruleInputs: { findingOrigin: "DETECTOR", requiredCoverageRatio: 1 },
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    filteredAt: new Date("2026-08-10T00:01:00.000Z"),
    restoreEvent: null,
    session: reviewSession(workflowState),
  };
}

function event(outcome: SpeedsterMapFilterRestoreEvent["outcome"], lifecycle: string): SpeedsterMapFilterRestoreEvent {
  return {
    id: "restore-12345678901234567890",
    decisionId,
    restoredByAdminId: "admin-2",
    sessionLifecycleState: lifecycle,
    outcome,
    calibrationMistake: {},
    restoredAt: new Date("2026-08-10T00:02:00.000Z"),
  };
}

test("active restore reintroduces original provenance and remeasures/regrades through existing authority", async () => {
  const changedMeasurement = {
    ...finding.measurement,
    widthMm: 4,
    heightMm: 5,
    areaMm2: 20,
    zonePercent: 80,
    weightedAreaMm2: 20,
    subgradeEffect: 2,
  };
  const result = await remeasureSpeedsterFilteredFindingRestore({
    session: reviewSession(),
    findingSnapshot: finding,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
  }, {
    async presignRead() { return "https://local.invalid/front.webp"; },
    async measure(body) {
      assert.equal(body.side, "FRONT");
      assert.equal(body.findings.length, 1);
      assert.equal(body.findings[0].id, finding.id);
      assert.equal(body.findings[0].origin, "DETECTOR");
      return { defects: [{ ...body.findings[0], measurement: changedMeasurement }] };
    },
  });
  assert.equal(result.reviewedDefects.length, 1);
  const restored = result.reviewedDefects[0] as typeof finding;
  assert.equal(restored.origin, "DETECTOR");
  assert.equal(restored.reviewResult, "UNREVIEWED");
  assert.equal(restored.sourceViewId, finding.sourceViewId);
  assert.deepEqual(restored.supportingViewIds, finding.supportingViewIds);
  assert.equal(restored.detectedDefectType, finding.detectedDefectType);
  const expectedReview = calculateSpeedsterReview(capture, [{ ...finding, measurement: changedMeasurement }]);
  assert.equal(restored.measurement.areaMm2, changedMeasurement.areaMm2);
  assert.equal(restored.measurement.weightedAreaMm2, changedMeasurement.weightedAreaMm2);
  assert.deepEqual(restored.measurement, expectedReview.defects[0].measurement);
  assert.equal((result.gradeReport as { detectorVersion: string }).detectorVersion, SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION);
  assert.deepEqual(result.gradeReport, {
    ...expectedReview.grade,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
  });
  assert.notDeepEqual(result.gradeReport, {
    ...calculateSpeedsterReview(capture, []).grade,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
  });
});

test("one-click active restore appends the exact calibration mistake in the same persistence call", async () => {
  let remeasureCalls = 0;
  let persistedMistake: Record<string, unknown> | null = null;
  const restored = await restoreSpeedsterMapFilterDecision({
    decisionId,
    restoredByAdminId: "admin-2",
  }, {
    async loadDecision() { return decision(); },
    async remeasureActive() {
      remeasureCalls += 1;
      return { reviewedDefects: [finding], gradeReport: { detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION } };
    },
    async persistActive(input) {
      persistedMistake = input.calibrationMistake as Record<string, unknown>;
      assert.equal(input.reviewedDefects[0], finding);
      return { event: event("ACTIVE_REINTRODUCED", "CAPTURED"), created: true };
    },
    async persistCompleted() { throw new Error("must not persist completed"); },
  });
  assert.equal(remeasureCalls, 1);
  assert.equal(restored.outcome, "ACTIVE_REINTRODUCED");
  const mistake = persistedMistake as unknown as Record<string, unknown>;
  assert.equal(mistake.version, SPEEDSTER_FILTER_CALIBRATION_MISTAKE_VERSION);
  assert.equal(mistake.mapRevisionId, decision().mapRevisionId);
  assert.equal(mistake.ruleId, decision().ruleId);
});

test("restore instrumentation is fail-open and runs only after the authoritative restore event commits", async () => {
  const order: string[] = [];
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const restored = await restoreSpeedsterMapFilterDecision({
      decisionId,
      restoredByAdminId: "admin-2",
    }, {
      async loadDecision() { return decision(); },
      async remeasureActive() { return { reviewedDefects: [finding], gradeReport: {} }; },
      async persistActive() {
        order.push("authority:committed");
        return { event: event("ACTIVE_REINTRODUCED", "CAPTURED"), created: true };
      },
      async persistCompleted() { throw new Error("must not persist completed"); },
      async recordInstrumentation(input) {
        assert.equal(order.at(-1), "authority:committed");
        assert.equal(input.outcome, "ACTIVE_REINTRODUCED");
        order.push("telemetry:attempted");
        throw new Error("telemetry unavailable");
      },
    });
    assert.equal(restored.outcome, "ACTIVE_REINTRODUCED");
    assert.deepEqual(order, ["authority:committed", "telemetry:attempted"]);
  } finally {
    console.error = originalError;
  }
});

test("completed restore writes calibration only and returns immutable grade/report/label/card/updatedAt evidence", async () => {
  const immutable = {
    sessionSha256: "e".repeat(64),
    reviewedDefectsSha256: "a".repeat(64),
    gradeReportSha256: "b".repeat(64),
    publicReportSlug: `speedster-${sessionId}`,
    labelSha256: "c".repeat(64),
    permanentCardSha256: "d".repeat(64),
    sessionUpdatedAt: "2026-08-10T00:00:00.000Z",
  };
  let completedWrites = 0;
  const restored = await restoreSpeedsterMapFilterDecision({ decisionId, restoredByAdminId: "admin-2" }, {
    async loadDecision() { return decision("COMPLETED"); },
    async remeasureActive() { throw new Error("completed history must not remeasure"); },
    async persistActive() { throw new Error("completed history must not update review"); },
    async persistCompleted(input) {
      completedWrites += 1;
      assert.equal((input.calibrationMistake as { sessionLifecycleState: string }).sessionLifecycleState, "COMPLETED");
      return { event: event("COMPLETED_CALIBRATION_ONLY", "COMPLETED"), created: true, immutableEvidence: immutable };
    },
  });
  assert.equal(completedWrites, 1);
  assert.equal(restored.outcome, "COMPLETED_CALIBRATION_ONLY");
  assert.deepEqual(restored.immutableEvidence, immutable);
});

test("completed restore rejects any changed full-row snapshot and production loads full session, label, and card rows", () => {
  assert.doesNotThrow(() => assertSpeedsterCompletedRestoreSnapshotUnchanged(
    { session: { identity: { cardName: "Cubone" }, nfcDone: false }, label: { certificateNumber: "TKH-1" }, card: null },
    { session: { identity: { cardName: "Cubone" }, nfcDone: false }, label: { certificateNumber: "TKH-1" }, card: null },
  ));
  assert.throws(() => assertSpeedsterCompletedRestoreSnapshotUnchanged(
    { session: { identity: { cardName: "Cubone" }, nfcDone: false }, label: { certificateNumber: "TKH-1" }, card: null },
    { session: { identity: { cardName: "Cubone" }, nfcDone: true }, label: { certificateNumber: "TKH-1" }, card: null },
  ), /completed Speedster history changed/i);

  const testRoot = fileURLToPath(new URL("..", import.meta.url));
  const source = readFileSync(`${testRoot}/pages/api/admin/ai-grader-v2/removed-findings/[decisionId]/restore.ts`, "utf8");
  const snapshotSource = source.slice(
    source.indexOf("async function completedSnapshot"),
    source.indexOf("function immutableEvidence"),
  );
  assert.match(snapshotSource, /aiGraderV2Session\.findUniqueOrThrow/);
  assert.match(snapshotSource, /humanGradeLabel\.findUnique/);
  assert.match(snapshotSource, /collectibleCardV2\.findUnique/);
  assert.doesNotMatch(snapshotSource, /select:/);
});

test("repeated restore is idempotent before measurement or persistence", async () => {
  const restoredDecision = { ...decision(), restoreEvent: event("ACTIVE_REINTRODUCED", "CAPTURED") };
  let writes = 0;
  const result = await restoreSpeedsterMapFilterDecision({ decisionId, restoredByAdminId: "admin-3" }, {
    async loadDecision() { return restoredDecision; },
    async remeasureActive() { writes += 1; throw new Error("must not run"); },
    async persistActive() { writes += 1; throw new Error("must not run"); },
    async persistCompleted() { writes += 1; throw new Error("must not run"); },
  });
  assert.equal(writes, 0);
  assert.equal(result.idempotent, true);
  assert.equal(result.outcome, "ACTIVE_REINTRODUCED");
});

function request(method = "POST") {
  return { method, query: { decisionId }, headers: {} } as unknown as NextApiRequest;
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

test("restore API is admin-owned and POST-only", async () => {
  let restoringAdmin = "";
  const deps = {
    async requireAdminSession() { return { user: { id: "admin-authenticated" } }; },
    async loadDecision() { return decision(); },
    async remeasureActive() { return { reviewedDefects: [finding], gradeReport: {} }; },
    async persistActive(input: { restoredByAdminId: string }) {
      restoringAdmin = input.restoredByAdminId;
      return { event: event("ACTIVE_REINTRODUCED", "CAPTURED"), created: true };
    },
    async persistCompleted() { throw new Error("must not run"); },
  };
  const handler = createSpeedsterMapFilterRestoreHandler(deps as never);
  const disallowed = response();
  await handler(request("GET"), disallowed.res);
  assert.equal(disallowed.state.status, 405);
  const allowed = response();
  await handler(request(), allowed.res);
  assert.equal(allowed.state.status, 200);
  assert.equal(restoringAdmin, "admin-authenticated");
});
