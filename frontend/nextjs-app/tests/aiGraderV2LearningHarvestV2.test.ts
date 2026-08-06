import assert from "node:assert/strict";
import test from "node:test";

import {
  SPEEDSTER_LEARNING_SAME_CARD_DUPLICATE_COSINE,
  SPEEDSTER_LEARNING_UNTOUCHED_CAP_PER_TYPE,
  deriveSpeedsterLearningBankFromHistoryV2,
  harvestSpeedsterLearningSessionV2,
  incrementSpeedsterLearningBankFromHistoryV2,
  speedsterLearningHarvestReceiptV2,
  type SpeedsterLearningReviewHistoryV2,
} from "../lib/ai-grader-v2/learning-harvest-v2";
import {
  SPEEDSTER_LEARNING_FINGERPRINT_SIZE,
  SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
} from "../lib/ai-grader-v2/learning-v2";

const fingerprintAt = (index: number) => Array.from(
  { length: SPEEDSTER_LEARNING_FINGERPRINT_SIZE },
  (_, part) => part === index % SPEEDSTER_LEARNING_FINGERPRINT_SIZE ? 1 : 0,
);

const denseFingerprint = (seed: number) => Array.from(
  { length: SPEEDSTER_LEARNING_FINGERPRINT_SIZE },
  (_, index) => seed + ((index + 1) / 41),
);

const finding = (input: Partial<Record<string, unknown>> = {}) => ({
  id: "finding",
  origin: "DETECTOR",
  detectedDefectType: "VISIBLE_WHITENING",
  defectType: "VISIBLE_WHITENING",
  reviewResult: "ACCEPTED",
  featureFingerprint: fingerprintAt(0),
  sourceViewId: "ORIGINAL",
  confidence: 0.5,
  ...input,
});

const session = (
  sessionId: string,
  completionOrder: number,
  reviewedDefects: readonly unknown[],
): SpeedsterLearningReviewHistoryV2 => ({
  sessionId,
  completedAt: new Date(Date.UTC(2026, 7, 2, 0, completionOrder)).toISOString(),
  completionOrder,
  fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  reviewedDefects,
});

test("harvests remove and relabel into exact original/final provenance", () => {
  const sharedFingerprint = denseFingerprint(4);
  const harvested = harvestSpeedsterLearningSessionV2(session("explicit", 1, [
    finding({
      reviewResult: "REMOVED",
      detectedDefectType: "VISIBLE_WHITENING",
      defectType: "VISIBLE_WHITENING",
      featureFingerprint: sharedFingerprint,
    }),
    finding({
      reviewResult: "TYPE_CORRECTED",
      detectedDefectType: "FAINT_COLOR_VARIATION",
      defectType: "FRAYING",
      featureFingerprint: sharedFingerprint,
      sourceViewId: "FRONT:ORIGINAL",
    }),
  ]));

  assert.deepEqual(
    harvested.history.lessons.map(({ defectType, polarity, provenance, proposalOrder, lessonOrder }) => ({
      defectType,
      polarity,
      provenance,
      proposalOrder,
      lessonOrder,
    })),
    [
      {
        defectType: "VISIBLE_WHITENING",
        polarity: "NEGATIVE",
        provenance: "DETECTOR_REMOVED",
        proposalOrder: 0,
        lessonOrder: undefined,
      },
      {
        defectType: "FAINT_COLOR_VARIATION",
        polarity: "NEGATIVE",
        provenance: "DETECTOR_RELABELED_NEGATIVE",
        proposalOrder: 1,
        lessonOrder: 0,
      },
      {
        defectType: "FRAYING",
        polarity: "POSITIVE",
        provenance: "DETECTOR_RELABELED_POSITIVE",
        proposalOrder: 1,
        lessonOrder: 1,
      },
    ],
  );
  assert.deepEqual(
    harvested.history.lessons[1].fingerprint,
    harvested.history.lessons[2].fingerprint,
  );
  assert.equal(harvested.diagnostics.explicitFindings, 2);
});

test("origin-first harvesting keeps a relabeled Smart-Mark positive only", () => {
  const harvested = harvestSpeedsterLearningSessionV2(session("smart-mark", 2, [
    finding({
      origin: "SMART_MARK",
      reviewResult: "TYPE_CORRECTED",
      detectedDefectType: "FAINT_COLOR_VARIATION",
      defectType: "CHIPPING_EXPOSED_STOCK",
      sourceViewId: "BACK:ORIGINAL",
      smartMarkLearning: {
        fingerprintProvenance: "HUMAN_BOX_POOL",
        traceAttempts: 1,
        proposalOverlapIouGt03: false,
        proposalMaxIou: 0,
      },
    }),
  ]));

  assert.equal(harvested.history.lessons.length, 1);
  assert.deepEqual(harvested.history.lessons[0], {
    defectType: "CHIPPING_EXPOSED_STOCK",
    polarity: "POSITIVE",
    fingerprint: fingerprintAt(0),
    provenance: "SMART_MARK_POSITIVE",
    sourceViewId: "ORIGINAL",
    proposalOrder: 0,
  });
});

test("a removed Smart-Mark teaches nothing because no detector proposal was rejected", () => {
  const harvested = harvestSpeedsterLearningSessionV2(session("removed-smart-mark", 3, [
    finding({
      origin: "SMART_MARK",
      reviewResult: "REMOVED",
      defectType: "FRAYING",
    }),
  ]));

  assert.equal(harvested.history.lessons.length, 0);
  assert.equal(harvested.diagnostics.explicitFindings, 0);
});

test("an untouched memory proposal is a counted skipped write and never self-replicates", () => {
  const harvested = harvestSpeedsterLearningSessionV2(session("memory-untouched", 4, [
    finding({
      origin: "MEMORY",
      reviewResult: "ACCEPTED",
      featureFingerprint: undefined,
    }),
  ]));

  assert.equal(harvested.history.lessons.length, 0);
  assert.equal(harvested.diagnostics.untouchedFindings, 1);
  assert.equal(harvested.diagnostics.skippedUntouchedMemory, 1);
  assert.equal(harvested.diagnostics.skippedMissingFingerprints, 0);
  assert.equal(harvested.diagnostics.skippedInvalidFindings, 0);
});

test("an accepted Memory finding with a human-saved exact trace teaches one trace-bound correction", () => {
  const finalTraceSha256 = "a".repeat(64);
  const harvested = harvestSpeedsterLearningSessionV2(session("memory-trace-corrected", 5, [
    finding({
      origin: "MEMORY",
      reviewResult: "ACCEPTED",
      finalTrace: { sha256: finalTraceSha256 },
      traceProvenance: { finalTraceSha256 },
      featureFingerprintTraceSha256: finalTraceSha256,
    }),
  ]));

  assert.deepEqual(harvested.history.lessons.map(({ defectType, polarity, provenance }) => ({
    defectType,
    polarity,
    provenance,
  })), [{
    defectType: "VISIBLE_WHITENING",
    polarity: "POSITIVE",
    provenance: "HUMAN_TRACE_CORRECTION_POSITIVE",
  }]);
  assert.equal(harvested.diagnostics.explicitFindings, 1);
  assert.equal(harvested.diagnostics.skippedUntouchedMemory, 0);
});

test("a Memory trace without a fingerprint bound to its final hash remains non-teaching", () => {
  const finalTraceSha256 = "b".repeat(64);
  const harvested = harvestSpeedsterLearningSessionV2(session("memory-stale-fingerprint", 6, [
    finding({
      origin: "MEMORY",
      reviewResult: "ACCEPTED",
      finalTrace: { sha256: finalTraceSha256 },
      traceProvenance: { finalTraceSha256 },
      featureFingerprintTraceSha256: "c".repeat(64),
    }),
  ]));

  assert.equal(harvested.history.lessons.length, 0);
  assert.equal(harvested.diagnostics.skippedUntouchedMemory, 0);
  assert.equal(harvested.diagnostics.skippedUnboundTraceFingerprints, 1);
});

test("completion receipt reports admitted and skipped learning without changing admission", () => {
  const harvested = harvestSpeedsterLearningSessionV2(session("receipt", 7, [
    finding({ reviewResult: "REMOVED" }),
    finding({ origin: "MEMORY", reviewResult: "ACCEPTED" }),
  ]));

  assert.deepEqual(speedsterLearningHarvestReceiptV2(harvested.diagnostics), {
    findings: 2,
    admittedLessons: 1,
    skippedLessons: 1,
    skipped: {
      invalidFindings: 0,
      missingFingerprints: 0,
      invalidFingerprints: 0,
      unboundTraceFingerprints: 0,
      versionMismatch: 0,
      untouchedMemory: 1,
      untouchedCap: 0,
      sameCardDuplicate: 0,
    },
  });
});

test("explicit memory removal teaches one negative for its original proposed type", () => {
  const harvested = harvestSpeedsterLearningSessionV2(session("memory-removed", 5, [
    finding({
      origin: "MEMORY",
      detectedDefectType: "VISIBLE_WHITENING",
      defectType: "VISIBLE_WHITENING",
      reviewResult: "REMOVED",
    }),
  ]));

  assert.deepEqual(harvested.history.lessons.map(({ defectType, polarity, provenance }) => ({
    defectType,
    polarity,
    provenance,
  })), [{
    defectType: "VISIBLE_WHITENING",
    polarity: "NEGATIVE",
    provenance: "DETECTOR_REMOVED",
  }]);
  assert.equal(harvested.diagnostics.explicitFindings, 1);
  assert.equal(harvested.diagnostics.skippedUntouchedMemory, 0);
});

test("seven batch-equivalent Memory removals harvest seven separate negative lessons", () => {
  const harvested = harvestSpeedsterLearningSessionV2(session(
    "batch-memory-removals",
    8,
    Array.from({ length: 7 }, (_, index) => finding({
      id: `memory-false-positive-${index}`,
      origin: "MEMORY",
      detectedDefectType: "VISIBLE_WHITENING",
      defectType: "VISIBLE_WHITENING",
      reviewResult: "REMOVED",
      featureFingerprint: fingerprintAt(index),
    })),
  ));

  assert.equal(harvested.history.lessons.length, 7);
  assert.deepEqual(
    harvested.history.lessons.map(({ polarity, provenance, proposalOrder }) => ({
      polarity,
      provenance,
      proposalOrder,
    })),
    Array.from({ length: 7 }, (_, proposalOrder) => ({
      polarity: "NEGATIVE",
      provenance: "DETECTOR_REMOVED",
      proposalOrder,
    })),
  );
});

test("explicit memory relabel teaches negative-old and positive-new only", () => {
  const harvested = harvestSpeedsterLearningSessionV2(session("memory-relabeled", 6, [
    finding({
      origin: "MEMORY",
      detectedDefectType: "FAINT_COLOR_VARIATION",
      defectType: "FRAYING",
      reviewResult: "TYPE_CORRECTED",
    }),
  ]));

  assert.deepEqual(harvested.history.lessons.map(({
    defectType, polarity, provenance, lessonOrder,
  }) => ({ defectType, polarity, provenance, lessonOrder })), [
    {
      defectType: "FAINT_COLOR_VARIATION",
      polarity: "NEGATIVE",
      provenance: "DETECTOR_RELABELED_NEGATIVE",
      lessonOrder: 0,
    },
    {
      defectType: "FRAYING",
      polarity: "POSITIVE",
      provenance: "DETECTOR_RELABELED_POSITIVE",
      lessonOrder: 1,
    },
  ]);
  assert.equal(harvested.diagnostics.explicitFindings, 1);
  assert.equal(harvested.diagnostics.admittedLessons, 2);
});

test("a 43-finding lazy finalize admits at most three per final type", () => {
  const reviewedDefects = Array.from({ length: 43 }, (_, index) => finding({
    id: `lazy-${index}`,
    featureFingerprint: fingerprintAt(index),
    confidence: 0.99 - index / 100,
  }));
  const harvested = harvestSpeedsterLearningSessionV2(session("lazy-43", 4, reviewedDefects));

  assert.equal(harvested.history.lessons.length, SPEEDSTER_LEARNING_UNTOUCHED_CAP_PER_TYPE);
  assert.deepEqual(harvested.history.lessons.map(({ proposalOrder }) => proposalOrder), [0, 1, 2]);
  assert.equal(harvested.diagnostics.untouchedFindings, 43);
  assert.equal(
    harvested.diagnostics.skippedUntouchedCap + harvested.diagnostics.skippedSameCardDuplicate,
    40,
  );
});

test("explicit human actions are uncapped at session admission", () => {
  const harvested = harvestSpeedsterLearningSessionV2(session(
    "explicit-uncapped",
    5,
    Array.from({ length: 43 }, (_, index) => finding({
      id: `removed-${index}`,
      reviewResult: "REMOVED",
      featureFingerprint: fingerprintAt(index),
    })),
  ));

  assert.equal(harvested.history.lessons.length, 43);
  assert.equal(harvested.diagnostics.explicitFindings, 43);
  assert.equal(harvested.diagnostics.skippedUntouchedCap, 0);
  assert.equal(harvested.diagnostics.skippedSameCardDuplicate, 0);
});

test("untouched admission uses stable proposal order, not confidence", () => {
  const harvested = harvestSpeedsterLearningSessionV2(session("stable-order", 6, [
    finding({ id: "first", featureFingerprint: fingerprintAt(0), confidence: 0.01 }),
    finding({ id: "second", featureFingerprint: fingerprintAt(1), confidence: 0.02 }),
    finding({ id: "third", featureFingerprint: fingerprintAt(2), confidence: 0.03 }),
    finding({ id: "highest", featureFingerprint: fingerprintAt(3), confidence: 0.99 }),
  ]));

  assert.deepEqual(harvested.history.lessons.map(({ proposalOrder }) => proposalOrder), [0, 1, 2]);
});

test("same-card near-duplicate suppression is deterministic and does not consume the cap", () => {
  const almostSame = fingerprintAt(0).map((part, index) => part + (index === 1 ? 0.0001 : 0));
  const harvested = harvestSpeedsterLearningSessionV2(session("dedup", 7, [
    finding({ id: "first", featureFingerprint: fingerprintAt(0) }),
    finding({ id: "duplicate", featureFingerprint: almostSame }),
    finding({ id: "second", featureFingerprint: fingerprintAt(1) }),
    finding({ id: "third", featureFingerprint: fingerprintAt(2) }),
  ]));

  assert.equal(SPEEDSTER_LEARNING_SAME_CARD_DUPLICATE_COSINE, 0.999999);
  assert.deepEqual(harvested.history.lessons.map(({ proposalOrder }) => proposalOrder), [0, 2, 3]);
  assert.equal(harvested.diagnostics.skippedSameCardDuplicate, 1);
  assert.equal(harvested.diagnostics.skippedUntouchedCap, 0);
});

test("invalid fingerprints and incompatible feature versions are skipped without blocking", () => {
  const invalid = harvestSpeedsterLearningSessionV2(session("invalid", 8, [
    finding({ id: "missing", reviewResult: "REMOVED", featureFingerprint: undefined }),
    finding({ id: "short", reviewResult: "REMOVED", featureFingerprint: [1, 2] }),
    finding({ id: "valid", reviewResult: "REMOVED", featureFingerprint: fingerprintAt(2) }),
  ]));
  assert.equal(invalid.history.lessons.length, 1);
  assert.equal(invalid.diagnostics.skippedMissingFingerprints, 1);
  assert.equal(invalid.diagnostics.skippedInvalidFingerprints, 1);

  const incompatible = harvestSpeedsterLearningSessionV2({
    ...session("wrong-version", 9, [finding({ reviewResult: "REMOVED" })]),
    fingerprintVersion: "different-feature-space",
  });
  assert.equal(incompatible.history.lessons.length, 0);
  assert.equal(incompatible.diagnostics.skippedVersionMismatch, 1);
});

test("sequential incremental application equals full chronological rebuild", () => {
  const history = Array.from({ length: 55 }, (_, index) => session(
    `capacity-${index.toString().padStart(2, "0")}`,
    index + 1,
    [finding({
      reviewResult: "REMOVED",
      featureFingerprint: denseFingerprint(index + 1),
    })],
  ));
  const excludedSessionId = "capacity-54";
  const excluded = new Set([excludedSessionId]);
  const full = deriveSpeedsterLearningBankFromHistoryV2(history, excluded).bank;
  let incremental = deriveSpeedsterLearningBankFromHistoryV2([]).bank;
  for (const entry of history) {
    if (excluded.has(entry.sessionId)) continue;
    incremental = incrementSpeedsterLearningBankFromHistoryV2(incremental, entry).bank;
  }

  assert.deepEqual(incremental, full);
  assert.equal(full.exemplars.length, 50);
  assert.equal(full.exemplars[0].sessionId, "capacity-04");
  assert.equal(full.exemplars.at(-1)?.sessionId, "capacity-53");

  const unexcluded = deriveSpeedsterLearningBankFromHistoryV2(history).bank;
  assert.equal(unexcluded.exemplars[0].sessionId, "capacity-05");
  assert.equal(unexcluded.exemplars.at(-1)?.sessionId, excludedSessionId);
});

test("incremental application is idempotent for exact retry and rejects stale conflicts", () => {
  const first = session("retry", 10, [finding({ reviewResult: "REMOVED" })]);
  const initial = deriveSpeedsterLearningBankFromHistoryV2([first]).bank;
  const retry = incrementSpeedsterLearningBankFromHistoryV2(initial, first).bank;
  assert.deepEqual(retry, initial);

  assert.throws(
    () => incrementSpeedsterLearningBankFromHistoryV2(initial, {
      ...first,
      reviewedDefects: [finding({
        reviewResult: "REMOVED",
        featureFingerprint: fingerprintAt(1),
      })],
    }),
    /Conflicting duplicate or stale/,
  );
  assert.throws(
    () => incrementSpeedsterLearningBankFromHistoryV2(initial, session(
      "older",
      9,
      [finding({ reviewResult: "REMOVED" })],
    )),
    /Conflicting duplicate or stale/,
  );
});
