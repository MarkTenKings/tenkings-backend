import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { inventorySpeedsterLearningHistory } from "../lib/ai-grader-v2/learning-history";
import {
  SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY,
  SPEEDSTER_LEARNING_DEFECT_TYPES,
  SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  SPEEDSTER_LEARNING_FINGERPRINT_SIZE,
  SPEEDSTER_LEARNING_SERIALIZED_BANK_BUDGET_BYTES,
  deriveSpeedsterLearningBankV2,
  normalizeSpeedsterLearningFingerprintV2,
  parseSpeedsterLearningBankV2,
  type SpeedsterLearningHistoryLessonsV2,
} from "../lib/ai-grader-v2/learning-v2";

const fingerprint = (first = 1) => [
  first,
  1,
  ...Array.from({ length: SPEEDSTER_LEARNING_FINGERPRINT_SIZE - 2 }, () => 0),
];

const denseFingerprint = (seed: number) => Array.from(
  { length: SPEEDSTER_LEARNING_FINGERPRINT_SIZE },
  (_, index) => seed + ((index + 1) / 37),
);

const historySession = (index: number): SpeedsterLearningHistoryLessonsV2 => ({
  sessionId: `session-${index.toString().padStart(3, "0")}`,
  completedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  completionOrder: index + 1,
  fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  lessons: [{
    defectType: "VISIBLE_WHITENING",
    polarity: "NEGATIVE",
    fingerprint: fingerprint(index + 1),
    provenance: "DETECTOR_REMOVED",
    sourceViewId: "ORIGINAL",
    proposalOrder: 0,
  }],
});

test("normalizes only finite 32-value SAM fingerprints", () => {
  const normalized = normalizeSpeedsterLearningFingerprintV2(fingerprint());
  assert.ok(normalized);
  assert.equal(normalized.length, SPEEDSTER_LEARNING_FINGERPRINT_SIZE);
  assert.ok(Math.abs(Math.hypot(...normalized) - 1) < 1e-12);
  assert.equal(normalizeSpeedsterLearningFingerprintV2([1, 2]), null);
  assert.equal(normalizeSpeedsterLearningFingerprintV2([Number.NaN, ...fingerprint().slice(1)]), null);
  assert.equal(normalizeSpeedsterLearningFingerprintV2(["1", ...fingerprint().slice(1)]), null);
});

test("never silently treats V1 or an incompatible fingerprint space as Bank V2", () => {
  assert.equal(parseSpeedsterLearningBankV2({ version: 1, types: {} }), null);
  const derived = deriveSpeedsterLearningBankV2([historySession(1)]).bank;
  assert.deepEqual(parseSpeedsterLearningBankV2(derived), derived);
  assert.equal(parseSpeedsterLearningBankV2({ ...derived, fingerprintVersion: "different" }), null);
});

test("keeps the newest exact 50 exemplars per type and polarity deterministically", () => {
  const history = Array.from(
    { length: SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY + 1 },
    (_, index) => historySession(index),
  ).reverse();
  const result = deriveSpeedsterLearningBankV2(history);

  assert.equal(result.bank.exemplars.length, SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY);
  assert.equal(result.bank.exemplars[0].sessionId, "session-001");
  assert.equal(result.bank.exemplars.at(-1)?.sessionId, "session-050");
  assert.equal(result.diagnostics.prunedByCapacity, 1);
  assert.equal(result.diagnostics.skippedInvalidLessons, 0);
});

test("uses the unique certificate sequence as completion order when timestamps conflict", () => {
  const history = Array.from(
    { length: SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY + 1 },
    (_, index) => ({
      ...historySession(index),
      completedAt: new Date(Date.UTC(2026, 0, 2, 0, -index)).toISOString(),
    }),
  );
  const result = deriveSpeedsterLearningBankV2(history);

  assert.equal(result.bank.exemplars[0].sessionId, "session-001");
  assert.equal(result.bank.exemplars.at(-1)?.sessionId, "session-050");
});

test("full exclusion rebuild can restore an older exemplar hidden by prior pruning", () => {
  const history = Array.from(
    { length: SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY + 1 },
    (_, index) => historySession(index),
  );
  const original = deriveSpeedsterLearningBankV2(history).bank;
  const rebuilt = deriveSpeedsterLearningBankV2(
    history,
    new Set([`session-${SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY.toString().padStart(3, "0")}`]),
  ).bank;

  assert.equal(original.exemplars.some(({ sessionId }) => sessionId === "session-000"), false);
  assert.equal(rebuilt.exemplars.some(({ sessionId }) => sessionId === "session-000"), true);
  assert.equal(rebuilt.exemplars.some(({ sessionId }) => sessionId === "session-050"), false);
});

test("an edge Smart-Mark lesson stores visual features rather than its clipped display outline", () => {
  const result = deriveSpeedsterLearningBankV2([{
    sessionId: "edge-smart-mark",
    completedAt: "2026-01-01T00:00:00.000Z",
    completionOrder: 1,
    fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
    lessons: [{
      defectType: "FRAYING",
      polarity: "POSITIVE",
      fingerprint: fingerprint(),
      provenance: "SMART_MARK_POSITIVE",
      sourceViewId: "ORIGINAL",
      proposalOrder: 0,
    }],
  }]);
  const exemplar = result.bank.exemplars[0];

  assert.equal(exemplar.provenance, "SMART_MARK_POSITIVE");
  assert.equal(exemplar.sourceViewId, "ORIGINAL");
  assert.ok(Math.abs(Math.hypot(...exemplar.fingerprint) - 1) < 1e-12);
  assert.equal("canonicalContour" in exemplar, false);
  assert.equal("box" in exemplar, false);
});

test("a completely full V2 bank stays inside its explicit serialized-size budget", () => {
  const history: SpeedsterLearningHistoryLessonsV2[] = Array.from(
    { length: SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY },
    (_, sessionIndex) => ({
      sessionId: `full-bank-${sessionIndex.toString().padStart(2, "0")}`,
      completedAt: new Date(Date.UTC(2026, 0, 1, 0, sessionIndex)).toISOString(),
      completionOrder: sessionIndex + 1,
      fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
      lessons: SPEEDSTER_LEARNING_DEFECT_TYPES.flatMap((defectType, typeIndex) => ([
        {
          defectType,
          polarity: "POSITIVE" as const,
          fingerprint: denseFingerprint((sessionIndex + 1) * (typeIndex + 1)),
          provenance: "UNTOUCHED_ACCEPTED_POSITIVE" as const,
          sourceViewId: "ORIGINAL",
          proposalOrder: typeIndex,
        },
        {
          defectType,
          polarity: "NEGATIVE" as const,
          fingerprint: denseFingerprint((sessionIndex + 1) * (typeIndex + 2)),
          provenance: "DETECTOR_REMOVED" as const,
          sourceViewId: "ORIGINAL",
          proposalOrder: typeIndex,
          lessonOrder: 1,
        },
      ])),
    }),
  );
  const bank = deriveSpeedsterLearningBankV2(history).bank;
  const bytes = Buffer.byteLength(JSON.stringify(bank));

  assert.equal(bank.exemplars.length, SPEEDSTER_LEARNING_DEFECT_TYPES.length * 2 * 50);
  assert.ok(bytes <= SPEEDSTER_LEARNING_SERIALIZED_BANK_BUDGET_BYTES, `${bytes} exceeds bank budget`);
});

test("read-only history inventory exposes Smart-Mark and fingerprint gaps without mutation", () => {
  const inventory = inventorySpeedsterLearningHistory([
    {
      id: "session-later",
      completedAt: "2026-01-02T00:00:00.000Z",
      completionOrder: 2,
      reviewedDefects: [{
        origin: "SMART_MARK",
        reviewResult: "SMART_MARKED",
        defectType: "FRAYING",
        sourceViewId: "ORIGINAL",
      }],
    },
    {
      id: "session-earlier",
      completedAt: "2026-01-01T00:00:00.000Z",
      completionOrder: 1,
      reviewedDefects: [
        {
          origin: "DETECTOR",
          reviewResult: "REMOVED",
          defectType: "VISIBLE_WHITENING",
          sourceViewId: "ORIGINAL",
          featureFingerprint: fingerprint(),
        },
        {
          origin: "DETECTOR",
          reviewResult: "ACCEPTED",
          defectType: "VISIBLE_WHITENING",
          sourceViewId: "DIRECTIONAL",
          featureFingerprint: [1, 2],
        },
        {
          origin: "MEMORY",
          reviewResult: "ACCEPTED",
          defectType: "VISIBLE_WHITENING",
          sourceViewId: "ORIGINAL",
          featureFingerprint: fingerprint(2),
        },
      ],
    },
  ]);

  assert.equal(inventory.readOnly, true);
  assert.equal(inventory.inputRows, 2);
  assert.equal(inventory.invalidHistoryRows, 0);
  assert.equal(inventory.completedSessions, 2);
  assert.equal(inventory.findings, 4);
  assert.equal(inventory.detectorFindings, 2);
  assert.equal(inventory.smartMarks, 1);
  assert.equal(inventory.memoryFindings, 1);
  assert.equal(inventory.usableFingerprints, 2);
  assert.equal(inventory.invalidFingerprints, 1);
  assert.equal(inventory.missingFingerprints, 1);
  assert.equal(inventory.sessions[0].memoryFindings, 1);
  assert.deepEqual(inventory.sessions.map(({ sessionId }) => sessionId), ["session-earlier", "session-later"]);
});

test("admin history inventory endpoint is authenticated and read-only", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/learning-history.ts`,
    "utf8",
  );

  assert.match(source, /requireAdminSession/);
  assert.match(source, /workflowState:\s*"COMPLETED"/);
  assert.match(source, /certificateSequence/);
  assert.match(source, /\.findMany\(/);
  assert.doesNotMatch(source, /\.(?:create|update|upsert|delete|deleteMany|updateMany)\(/);
  assert.doesNotMatch(source, /\$(?:executeRaw|queryRaw)/);
});
