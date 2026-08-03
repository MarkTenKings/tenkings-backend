import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
  SPEEDSTER_LEARNING_POISONED_ARTICUNO_SESSION_ID,
  evaluateSpeedsterLearningDecisionV2,
  replaySpeedsterLearningCalibrationV2,
  speedsterLearningCardKeyV2,
  speedsterLearningFingerprintVersionForDetectorV2,
  type SpeedsterLearningCalibrationHistoryRowV2,
} from "../lib/ai-grader-v2/learning-calibration-v2";
import { deriveSpeedsterLearningBankV2 } from "../lib/ai-grader-v2/learning-v2";
import {
  SPEEDSTER_LEARNING_FINGERPRINT_SIZE,
  SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
} from "../lib/ai-grader-v2/learning-v2";

const axis = (index: number) => Array.from(
  { length: SPEEDSTER_LEARNING_FINGERPRINT_SIZE },
  (_, part) => part === index ? 1 : 0,
);

const unitWithFirst = (first: number) => [
  first,
  Math.sqrt(1 - first * first),
  ...Array.from({ length: SPEEDSTER_LEARNING_FINGERPRINT_SIZE - 2 }, () => 0),
];

const finding = (input: Partial<Record<string, unknown>> = {}) => ({
  origin: "DETECTOR",
  detectedDefectType: "VISIBLE_WHITENING",
  defectType: "VISIBLE_WHITENING",
  reviewResult: "REMOVED",
  featureFingerprint: axis(0),
  sourceViewId: "ORIGINAL",
  ...input,
});

const session = (
  sessionId: string,
  completionOrder: number,
  reviewedDefects: readonly unknown[],
  input: Partial<SpeedsterLearningCalibrationHistoryRowV2> = {},
): SpeedsterLearningCalibrationHistoryRowV2 => ({
  sessionId,
  completionOrder,
  completedAt: new Date(Date.UTC(2026, 7, 2, 0, completionOrder)).toISOString(),
  fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  reviewedDefects,
  cardKey: `card-${sessionId}`,
  ...input,
});

test("mirrors the frozen Python max, null, adjustment, veto, and protection semantics", () => {
  const bank = deriveSpeedsterLearningBankV2([{
    sessionId: "earlier",
    completionOrder: 1,
    completedAt: "2026-08-02T00:00:00.000Z",
    fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
    lessons: [
      {
        defectType: "VISIBLE_WHITENING",
        polarity: "NEGATIVE",
        fingerprint: unitWithFirst(0.95),
        provenance: "DETECTOR_REMOVED",
        sourceViewId: "ORIGINAL",
        proposalOrder: 0,
      },
      {
        defectType: "VISIBLE_WHITENING",
        polarity: "POSITIVE",
        fingerprint: unitWithFirst(0.9),
        provenance: "SMART_MARK_POSITIVE",
        sourceViewId: "ORIGINAL",
        proposalOrder: 1,
      },
    ],
  }], new Set(), { status: "CALIBRATED", tau: 0.9, margin: 0.1 }).bank;

  const protectedDecision = evaluateSpeedsterLearningDecisionV2({
    bank,
    lesson: { defectType: "VISIBLE_WHITENING", fingerprint: axis(0), sourceViewId: "ORIGINAL" },
    thresholds: { tau: 0.9, margin: 0.1 },
  });
  assert.equal(protectedDecision.positiveMax, 0.9);
  assert.ok(Math.abs((protectedDecision.negativeMax ?? 0) - 0.95) < 1e-12);
  assert.equal(protectedDecision.gentleAdjustment, -0.003);
  assert.equal(protectedDecision.action, "protected");

  const vetoed = evaluateSpeedsterLearningDecisionV2({
    bank,
    lesson: { defectType: "VISIBLE_WHITENING", fingerprint: axis(0), sourceViewId: "ORIGINAL" },
    thresholds: { tau: 0.9, margin: 0.05 },
  });
  assert.equal(vetoed.action, "vetoed");

  const noEvidence = evaluateSpeedsterLearningDecisionV2({
    bank,
    lesson: { defectType: "FRAYING", fingerprint: axis(0), sourceViewId: "ORIGINAL" },
    thresholds: { tau: 0.9, margin: 0.1 },
  });
  assert.equal(noEvidence.positiveMax, null);
  assert.equal(noEvidence.negativeMax, null);
  assert.equal(noEvidence.gentleAdjustment, 0);
  assert.equal(noEvidence.action, "retained");
});

test("uses certificate sequence chronology and never leaks future lessons", () => {
  const report = replaySpeedsterLearningCalibrationV2([
    session("second", 2, [finding()], { completedAt: "2026-01-01T00:00:00.000Z" }),
    session("first", 1, [finding()], { completedAt: "2026-12-31T00:00:00.000Z" }),
    session("future", 3, [finding({ featureFingerprint: axis(1) })]),
  ]);

  const first = report.cases.find(({ sessionId }) => sessionId === "first");
  const second = report.cases.find(({ sessionId }) => sessionId === "second");
  assert.equal(first?.negativeMax, null);
  assert.equal(second?.negativeMax, 1);
  assert.equal(second?.negativeMatchSessionId, "first");
});

test("enforces exact fingerprint and view boundaries", () => {
  const report = replaySpeedsterLearningCalibrationV2([
    session("wrong-version", 1, [finding()], { fingerprintVersion: "pre-inspection-space" }),
    session("wrong-view", 2, [finding({ sourceViewId: "DIRECTIONAL" })]),
    session("candidate", 3, [finding({ sourceViewId: "ORIGINAL" })]),
  ]);
  const candidate = report.cases.find(({ sessionId }) => sessionId === "candidate");

  assert.equal(candidate?.negativeMax, null);
  assert.equal(report.counts.incompatibleSessions, 1);
  assert.equal(report.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.recommendation, null);
});

test("excludes the poisoned Articuno session from both trusted truth and the simulated bank", () => {
  const report = replaySpeedsterLearningCalibrationV2([
    session(SPEEDSTER_LEARNING_POISONED_ARTICUNO_SESSION_ID, 1, [finding()], { cardKey: "articuno" }),
    session("later-articuno", 2, [finding()], { cardKey: "articuno" }),
  ]);

  assert.equal(report.counts.trustedExplicitCases, 1);
  assert.equal(report.cases[0].sessionId, "later-articuno");
  assert.equal(report.cases[0].negativeMax, null);
  assert.deepEqual(report.excludedSessionIds, [SPEEDSTER_LEARNING_POISONED_ARTICUNO_SESSION_ID]);
});

test("models maximum similarity over the actual retained 50-example bank", () => {
  const earlier = [
    session("pruned-oldest", 1, [finding({ featureFingerprint: axis(0) })]),
    ...Array.from({ length: 50 }, (_, index) => session(
      `retained-${index.toString().padStart(2, "0")}`,
      index + 2,
      [finding({ featureFingerprint: axis(1) })],
    )),
  ];
  const report = replaySpeedsterLearningCalibrationV2([
    ...earlier,
    session("evaluate-after-capacity", 52, [finding({ featureFingerprint: axis(0) })]),
  ]);
  const evaluated = report.cases.find(({ sessionId }) => sessionId === "evaluate-after-capacity");

  assert.equal(evaluated?.negativeMax, 0);
  assert.notEqual(evaluated?.negativeMatchSessionId, "pruned-oldest");
  assert.equal(report.capacity.finalExemplars, 50);
  assert.equal(report.capacity.peakEarlierBankExemplars, 50);
});

test("uses untouched accepts only in earlier banks and never as trusted evaluation truth", () => {
  const report = replaySpeedsterLearningCalibrationV2([
    session("lazy", 1, [finding({ reviewResult: "ACCEPTED" })]),
    session("explicit", 2, [finding()]),
  ]);

  assert.equal(report.counts.untouchedLessonsUsedOnlyInEarlierBanks, 1);
  assert.equal(report.counts.trustedExplicitCases, 1);
  assert.equal(report.cases[0].positiveMax, 1);
});

test("reports compact adjacent sensitivity, bank size, measured latency, and honest insufficiency", () => {
  const clock = [0, 0.2, 1, 1.3, 2, 2.4];
  const report = replaySpeedsterLearningCalibrationV2([
    session("negative-first", 1, [finding()], { cardKey: "same" }),
    session("negative-repeat", 2, [finding()], { cardKey: "same" }),
    session("positive-control", 3, [finding({
      origin: "SMART_MARK",
      reviewResult: "SMART_MARKED",
      detectedDefectType: undefined,
      defectType: "VISIBLE_WHITENING",
      featureFingerprint: axis(1),
    })], { cardKey: "control" }),
  ], { now: () => clock.shift() ?? 3 });

  assert.ok(report.evidenceCandidate);
  assert.equal(report.evidenceCandidate.falseVetoes, 0);
  assert.ok(report.adjacentSensitivity.length > 0);
  assert.ok(report.capacity.finalSerializedBytes > 0);
  assert.equal(report.latency.decisions, 3);
  assert.equal(report.latency.totalDecisionMs, 0.9);
  assert.equal(report.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.recommendation, null);
  assert.match(report.insufficientReasons.join(" "), /Damage-on-text/);
});

test("bounds machine-readable case output without changing full replay counts", () => {
  const report = replaySpeedsterLearningCalibrationV2([
    session("many-explicit-actions", 1, Array.from({ length: 201 }, () => finding())),
  ], { now: () => 0 });

  assert.equal(report.counts.trustedExplicitCases, 201);
  assert.equal(report.reporting.totalCaseRecords, 201);
  assert.equal(report.reporting.maxCaseRecords, 200);
  assert.equal(report.reporting.casesTruncated, true);
  assert.equal(report.cases.length, 200);
});

test("maps only the exact inspection detector version and hashes card identity stably", () => {
  assert.equal(
    speedsterLearningFingerprintVersionForDetectorV2(SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION),
    SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  );
  assert.match(speedsterLearningFingerprintVersionForDetectorV2("older"), /^INCOMPATIBLE:/);
  assert.equal(
    speedsterLearningCardKeyV2("POKEMON", { cardName: " Articuno ", year: "2022", productSet: "Set" }),
    speedsterLearningCardKeyV2("pokemon", { cardName: "articuno", year: "2022", productSet: "set" }),
  );
});

test("authenticated history/calibration endpoint has a static zero-write guard", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/learning-history.ts`,
    "utf8",
  );

  assert.match(source, /requireAdminSession/);
  assert.match(source, /replaySpeedsterLearningCalibrationV2/);
  assert.match(source, /certificateSequence/);
  assert.match(source, /gradeReport/);
  assert.doesNotMatch(source, /\.(?:create|update|upsert|delete|deleteMany|updateMany)\(/);
  assert.doesNotMatch(source, /\$(?:executeRaw|queryRaw)/);
});
