import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { NextApiRequest, NextApiResponse } from "next";

import {
  SPEEDSTER_ARTICUNO_POISONED_SESSION_ID,
  SPEEDSTER_INCOMPATIBLE_FINGERPRINT_VERSION,
  SPEEDSTER_INSPECTION_DETECTOR_VERSION,
  SPEEDSTER_V1_AUDIT_ABSOLUTE_TOLERANCE,
  analyzeSpeedsterArticunoDryRun,
  runLockedSpeedsterArticunoDryRun,
  speedsterHistoryFingerprintVersion,
  type SpeedsterArticunoDryRunHistoryRow,
} from "../lib/ai-grader-v2/learning-articuno-dry-run-v2";
import {
  SPEEDSTER_LEARNING_FINGERPRINT_SIZE,
  SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
} from "../lib/ai-grader-v2/learning-v2";
import { updateSpeedsterLearningBank, type SpeedsterLearningBank } from "../lib/ai-grader-v2/learning";
import { createSpeedsterArticunoDryRunHandler } from "../pages/api/admin/ai-grader-v2/learning-articuno-dry-run";

const fingerprint = (seed: number) => Array.from(
  { length: SPEEDSTER_LEARNING_FINGERPRINT_SIZE },
  (_, index) => seed + (index + 1) / 43,
);

const finding = (seed: number, input: Record<string, unknown> = {}) => ({
  id: `finding-${seed}`,
  origin: "DETECTOR",
  detectedDefectType: "VISIBLE_WHITENING",
  defectType: "VISIBLE_WHITENING",
  reviewResult: "REMOVED",
  featureFingerprint: fingerprint(seed),
  sourceViewId: "ORIGINAL",
  ...input,
});

const positiveFinding = (seed: number) => finding(seed, {
  origin: "SMART_MARK",
  detectedDefectType: undefined,
  reviewResult: "SMART_MARKED",
});

const inspectionCapture = () => ({
  front: {
    inspectionStorageKey: "speedster/front/inspection.webp",
    inspectionFrame: {
      width: 1350,
      height: 1858,
      cardBounds: { x: 40, y: 40, width: 1270, height: 1778 },
    },
  },
  back: {
    inspectionStorageKey: "speedster/back/inspection.webp",
    inspectionFrame: {
      width: 1350,
      height: 1858,
      cardBounds: { x: 40, y: 40, width: 1270, height: 1778 },
    },
  },
});

const historyRow = (
  sessionId: string,
  completionOrder: number,
  reviewedDefects: unknown[] = [finding(completionOrder)],
  compatible = true,
): SpeedsterArticunoDryRunHistoryRow => ({
  sessionId,
  completionOrder,
  completedAt: new Date(Date.UTC(2026, 7, 2, 0, completionOrder)).toISOString(),
  reviewedDefects,
  capture: compatible ? inspectionCapture() : {},
  gradeReport: compatible ? { detectorVersion: SPEEDSTER_INSPECTION_DETECTOR_VERSION } : {
    detectorVersion: "sam3-local-box@96914d2425f90a64f45ca977c2b5165418099543",
  },
});

function v1Bank(history: readonly SpeedsterArticunoDryRunHistoryRow[]): SpeedsterLearningBank {
  let bank: SpeedsterLearningBank = { version: 1, types: {} };
  for (const row of history) {
    bank = updateSpeedsterLearningBank(
      bank,
      Array.isArray(row.reviewedDefects) ? row.reviewedDefects : [],
    );
  }
  return bank;
}

const liveRow = (history: readonly SpeedsterArticunoDryRunHistoryRow[]) => ({
  state: v1Bank(history),
  updatedAt: new Date("2026-08-02T12:00:00.000Z"),
});

test("pins compatibility to the exact inspection frame and detector feature space", () => {
  assert.equal(
    speedsterHistoryFingerprintVersion(
      inspectionCapture(),
      { detectorVersion: SPEEDSTER_INSPECTION_DETECTOR_VERSION },
    ),
    SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  );
  assert.equal(
    speedsterHistoryFingerprintVersion(
      inspectionCapture(),
      { detectorVersion: "sam3-local-box@96914d2425f90a64f45ca977c2b5165418099543" },
    ),
    SPEEDSTER_INCOMPATIBLE_FINGERPRINT_VERSION,
  );
  const wrongFrame = inspectionCapture();
  wrongFrame.front.inspectionFrame.width = 1349;
  assert.equal(
    speedsterHistoryFingerprintVersion(
      wrongFrame,
      { detectorVersion: SPEEDSTER_INSPECTION_DETECTOR_VERSION },
    ),
    SPEEDSTER_INCOMPATIBLE_FINGERPRINT_VERSION,
  );
});

test("acquires the completion advisory lock before every history and bank read", async () => {
  const events: string[] = [];
  const target = historyRow(SPEEDSTER_ARTICUNO_POISONED_SESSION_ID, 2);
  const first = historyRow("earlier-compatible-session", 1);
  const result = await runLockedSpeedsterArticunoDryRun({
    async acquireCompletionAdvisoryLock() { events.push("lock"); },
    async listCompletionLabels() {
      events.push("labels");
      return [first, target].map((row) => ({
        sourceSessionId: row.sessionId,
        certificateSequence: row.completionOrder,
        createdAt: new Date(row.completedAt),
      }));
    },
    async listCompletedSessions() {
      events.push("sessions");
      return [first, target].map((row) => ({
        id: row.sessionId,
        reviewedDefects: row.reviewedDefects,
        capture: row.capture,
        gradeReport: row.gradeReport,
      }));
    },
    async readGlobalLearningBank() {
      events.push("bank");
      return liveRow([first, target]);
    },
  }, { tau: 0.9, margin: 0.05 });

  assert.deepEqual(events, ["lock", "labels", "sessions", "bank"]);
  assert.equal(result.lock.acquiredBeforeAudit, true);
  assert.equal(result.liveV1Audit.status, "PASS");
});

test("an unexplained V1 mismatch aborts and reports exact numeric paths", () => {
  const rows = [
    historyRow("earlier-compatible-session", 1),
    historyRow(SPEEDSTER_ARTICUNO_POISONED_SESSION_ID, 2),
  ];
  const live = liveRow(rows);
  const state = structuredClone(live.state) as {
    types: { VISIBLE_WHITENING: { negative: { count: number; sum: number[] } } };
  };
  state.types.VISIBLE_WHITENING.negative.sum[0] += 0.01;
  const result = analyzeSpeedsterArticunoDryRun({
    history: rows,
    liveBank: { ...live, state },
    calibration: { tau: 0.9, margin: 0.05 },
  });

  assert.equal(result.status, "ABORTED");
  assert.equal(result.liveV1Audit.status, "FAIL");
  assert.match(result.reasons.join(" "), /No chronological V1 history suffix matches/);
  assert.ok(result.liveV1Audit.closestComparison);
  assert.ok(result.liveV1Audit.closestComparison.comparison.mismatches.some(({ path }) =>
    path === "types.VISIBLE_WHITENING.negative.sum[0]"));
});

test("V1 audit applies the documented absolute/relative float tolerance", () => {
  const rows = [
    historyRow("earlier-compatible-session", 1),
    historyRow(SPEEDSTER_ARTICUNO_POISONED_SESSION_ID, 2),
  ];
  const live = liveRow(rows);
  const within = structuredClone(live.state) as {
    types: { VISIBLE_WHITENING: { negative: { sum: number[] } } };
  };
  within.types.VISIBLE_WHITENING.negative.sum[0] += SPEEDSTER_V1_AUDIT_ABSOLUTE_TOLERANCE / 2;
  const accepted = analyzeSpeedsterArticunoDryRun({
    history: rows,
    liveBank: { ...live, state: within },
    calibration: { tau: 0.9, margin: 0.05 },
  });
  assert.equal(accepted.liveV1Audit.status, "PASS");

  const outside = structuredClone(live.state) as {
    types: { VISIBLE_WHITENING: { negative: { sum: number[] } } };
  };
  outside.types.VISIBLE_WHITENING.negative.sum[0] += 1e-6;
  const rejected = analyzeSpeedsterArticunoDryRun({
    history: rows,
    liveBank: { ...live, state: outside },
    calibration: { tau: 0.9, margin: 0.05 },
  });
  assert.equal(rejected.liveV1Audit.status, "FAIL");
  assert.equal(rejected.status, "ABORTED");
});

test("excludes only the target Articuno session and reports exact per-session deltas", () => {
  const control = historyRow("unrelated-control-session", 1, [finding(1), positiveFinding(9)]);
  const target = historyRow(SPEEDSTER_ARTICUNO_POISONED_SESSION_ID, 2);
  const result = analyzeSpeedsterArticunoDryRun({
    history: [control, target],
    liveBank: liveRow([control, target]),
    calibration: { tau: 0.9, margin: 0.05 },
  });

  assert.equal(result.status, "SAFE_TO_REQUEST_APPROVAL");
  assert.equal(result.target.exclusionDisposition, "EXPLICIT_EXEMPLAR_REMOVAL");
  assert.deepEqual(result.target.requestedExcludedSessionIds, [SPEEDSTER_ARTICUNO_POISONED_SESSION_ID]);
  assert.deepEqual(result.v2.affectedSessionIds, [SPEEDSTER_ARTICUNO_POISONED_SESSION_ID]);
  assert.deepEqual(result.v2.exemplarSessionDeltas, [{
    sessionId: SPEEDSTER_ARTICUNO_POISONED_SESSION_ID,
    before: 1,
    after: 0,
    delta: -1,
  }]);
  assert.equal(result.v2.excluded.exemplars, 2);
  assert.equal(result.v2.countDeltas.VISIBLE_WHITENING.NEGATIVE, -1);
});

test("full exclusion rebuild restores an older exemplar hidden by capacity pruning", () => {
  const older = Array.from({ length: 50 }, (_, index) => historyRow(
    `eligible-${index.toString().padStart(2, "0")}`,
    index + 1,
  ));
  const target = historyRow(SPEEDSTER_ARTICUNO_POISONED_SESSION_ID, 51);
  const rows = [...older, target];
  const result = analyzeSpeedsterArticunoDryRun({
    history: rows,
    liveBank: liveRow(rows),
    calibration: { tau: 0.9, margin: 0.05 },
  });

  assert.equal(result.v2.unexcluded.exemplars, 50);
  assert.equal(result.v2.excluded.exemplars, 50);
  assert.ok(result.v2.exemplarSessionDeltas.some((entry) =>
    entry.sessionId === "eligible-00" && entry.before === 0 && entry.after === 1));
  assert.ok(result.v2.exemplarSessionDeltas.some((entry) =>
    entry.sessionId === SPEEDSTER_ARTICUNO_POISONED_SESSION_ID && entry.before === 1 && entry.after === 0));
});

test("counts and skips incompatible pre-inspection sessions without silent conversion", () => {
  const old = historyRow("pre-inspection-session", 1, [finding(1), finding(2)], false);
  const target = historyRow(SPEEDSTER_ARTICUNO_POISONED_SESSION_ID, 2, [finding(3)], false);
  const current = historyRow("inspection-compatible-session", 3);
  const result = analyzeSpeedsterArticunoDryRun({
    history: [old, target, current],
    liveBank: liveRow([old, target, current]),
    calibration: { tau: 0.9, margin: 0.05 },
  });

  assert.equal(result.history.compatibleSessions, 1);
  assert.equal(result.history.incompatibleSessions, 2);
  assert.equal(result.history.compatibleFindings, 1);
  assert.equal(result.history.incompatibleFindings, 3);
  assert.deepEqual(result.history.incompatibleSessionIds, [
    "pre-inspection-session",
    SPEEDSTER_ARTICUNO_POISONED_SESSION_ID,
  ]);
  assert.equal(result.target.targetFingerprintCompatible, false);
  assert.equal(result.target.exclusionDisposition, "ALREADY_INELIGIBLE_FINGERPRINT");
  assert.equal(result.v2.unexcluded.deterministicHash, result.v2.excluded.deterministicHash);
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.match(result.reasons.join(" "), /no positive exemplars/);
});

test("refuses approval when the canonical V2 bank lacks either polarity", () => {
  const target = historyRow(SPEEDSTER_ARTICUNO_POISONED_SESSION_ID, 1, [], false);
  const negativeOnly = historyRow("negative-only", 2, [finding(2)]);
  const negativeResult = analyzeSpeedsterArticunoDryRun({
    history: [target, negativeOnly],
    liveBank: liveRow([target, negativeOnly]),
    calibration: { tau: 0.9, margin: 0.05 },
  });
  assert.equal(negativeResult.target.exclusionDisposition, "ALREADY_INELIGIBLE_FINGERPRINT");
  assert.equal(negativeResult.status, "INSUFFICIENT_EVIDENCE");
  assert.match(negativeResult.reasons.join(" "), /no positive exemplars/);

  const positiveOnly = historyRow("positive-only", 2, [positiveFinding(2)]);
  const positiveResult = analyzeSpeedsterArticunoDryRun({
    history: [target, positiveOnly],
    liveBank: liveRow([target, positiveOnly]),
    calibration: { tau: 0.9, margin: 0.05 },
  });
  assert.equal(positiveResult.status, "INSUFFICIENT_EVIDENCE");
  assert.match(positiveResult.reasons.join(" "), /no negative exemplars/);
});

test("output, hashes, sizes, and source inputs are deterministic and immutable", () => {
  const rows = [
    historyRow("earlier-compatible-session", 1, [finding(1), positiveFinding(9)]),
    historyRow(SPEEDSTER_ARTICUNO_POISONED_SESSION_ID, 2),
  ];
  const live = liveRow(rows);
  const originalRows = structuredClone(rows);
  const originalLive = structuredClone(live);
  const first = analyzeSpeedsterArticunoDryRun({
    history: rows,
    liveBank: live,
    calibration: { tau: 0.9, margin: 0.05 },
  });
  const second = analyzeSpeedsterArticunoDryRun({
    history: rows,
    liveBank: live,
    calibration: { tau: 0.9, margin: 0.05 },
  });

  assert.deepEqual(second, first);
  assert.equal(first.readOnly, true);
  assert.equal(first.mutationPerformed, false);
  assert.ok(first.v2.unexcluded.serializedBytes > first.v2.excluded.serializedBytes);
  assert.match(first.v2.unexcluded.deterministicHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(rows, originalRows);
  assert.deepEqual(live, originalLive);
});

test("missing calibration is insufficient and empty/missing-target history aborts honestly", () => {
  const target = historyRow(SPEEDSTER_ARTICUNO_POISONED_SESSION_ID, 1);
  const insufficient = analyzeSpeedsterArticunoDryRun({
    history: [target],
    liveBank: liveRow([target]),
  });
  assert.equal(insufficient.status, "INSUFFICIENT_EVIDENCE");
  assert.match(insufficient.reasons.join(" "), /tau and margin were not supplied/);

  const empty = analyzeSpeedsterArticunoDryRun({
    history: [],
    liveBank: { state: { version: 1, types: {} }, updatedAt: new Date() },
    calibration: { tau: 0.9, margin: 0.05 },
  });
  assert.equal(empty.status, "ABORTED");
  assert.match(empty.reasons.join(" "), /Target Articuno session/);
  assert.match(empty.reasons.join(" "), /history is insufficient/);
});

const request = (query: Record<string, string> = {}) => ({ method: "GET", query }) as NextApiRequest;
const response = () => {
  const state = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    setHeader(name: string, value: string) { state.headers[name] = value; },
    status(status: number) { state.status = status; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
};

test("admin endpoint authenticates, accepts external calibration, and exposes no write primitive", async () => {
  const events: string[] = [];
  const handler = createSpeedsterArticunoDryRunHandler({
    async requireAdminSession() { events.push("auth"); return {}; },
    async runDryRun(calibration) {
      events.push(`dry:${calibration?.tau}:${calibration?.margin}`);
      return { readOnly: true } as never;
    },
  });
  const output = response();
  await handler(request({ tau: "0.91", margin: "0.04" }), output.res);
  assert.deepEqual(events, ["auth", "dry:0.91:0.04"]);
  assert.equal(output.state.status, 200);
  assert.equal(output.state.headers["Cache-Control"], "private, no-store");

  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/learning-articuno-dry-run.ts`,
    "utf8",
  );
  assert.match(source, /requireAdminSession/);
  assert.match(source, /pg_advisory_xact_lock\(hashtext\('ten-kings-human-grade-label-slots'\)\)/);
  assert.match(source, /orderBy: \{ certificateSequence: "asc" \}/);
  assert.match(source, /where: \{ id: "GLOBAL" \}/);
  assert.doesNotMatch(source, /\.(?:create|update|upsert|delete|deleteMany|updateMany)\(/);
  assert.doesNotMatch(source, /\$executeRaw/);
});
