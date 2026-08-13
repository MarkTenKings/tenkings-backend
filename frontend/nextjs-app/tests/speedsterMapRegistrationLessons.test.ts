import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ensureSpeedsterRegistrationLessonEvidenceSnapshot,
  loadVerifiedSpeedsterRegistrationLessonCandidates,
  persistSpeedsterRegistrationLesson,
  speedsterRegistrationLessonHash,
  type SpeedsterRegistrationLessonTransactionRunner,
} from "../lib/server/speedsterMapRegistrationLessons";
import type {
  SpeedsterMapRegistration,
  SpeedsterMapRegistrationFailure,
} from "../lib/ai-grader-v2/card-type-map-contracts";
import { speedsterPhysicalQuadHash } from "../lib/server/speedsterCardTypeMaps";

const evidenceSha = "a".repeat(64);
const quad = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
] as const;
const anchors = [
  { id: "a1", point: { x: 0.1, y: 0.1 } },
  { id: "a2", point: { x: 0.9, y: 0.1 } },
  { id: "a3", point: { x: 0.9, y: 0.9 } },
  { id: "a4", point: { x: 0.1, y: 0.9 } },
] as const;
const corrected = anchors.map(({ id, point }) => ({ anchorId: id, point }));
const automaticFailure: SpeedsterMapRegistrationFailure = {
  algorithmVersion: "opencv-redundant-ransac-registration-v2",
  policyVersion: "speedster-map-registration-acceptance-v2",
  accepted: false,
  failureCode: "LOW_ANCHOR_CONFIDENCE",
  message: "One anchor was low confidence.",
  candidateCount: 1,
  candidateIds: ["original-reference"],
  binding: {
    side: "BACK",
    mapRevisionId: "revision-8",
    currentInspectionSha256: evidenceSha,
    currentPhysicalQuadSha256: speedsterPhysicalQuadHash(quad),
    candidates: [{ candidateId: "original-reference", referenceInspectionSha256: "b".repeat(64) }],
  },
  bestCandidate: {
    candidateId: "original-reference",
    provenance: "ORIGINAL_REFERENCE",
    accepted: false,
    failureCode: "LOW_ANCHOR_CONFIDENCE",
    message: "One anchor was low confidence.",
    anchors: anchors.map(({ id, point }, index) => ({
      anchorId: id,
      expectedPoint: point,
      trackedPoint: index === 0 ? { x: -0.13, y: 0.06 } : point,
      locatedPoint: index === 0 ? { x: -0.13, y: 0.06 } : point,
      score: index === 0 ? 0 : 0.9,
      status: index === 0 ? "OUT_OF_CARD" : "TRACKED",
    })),
    featureCount: 40,
    usableFeatureCount: 30,
    inlierCount: 20,
    inlierFraction: 2 / 3,
    perAnchorFeatureCounts: [4, 8, 9, 9],
    perAnchorInlierCounts: [1, 6, 7, 6],
    medianReprojectionErrorPx: 0.8,
    maxReprojectionErrorPx: 2.1,
  },
};

function persistenceInput(
  rescueAttemptId: string,
  transaction: SpeedsterRegistrationLessonTransactionRunner,
) {
  return {
    operatorAdminId: "admin-1",
    mapRevisionId: "revision-8",
    side: "BACK" as const,
    evidenceSessionId: "session-1",
    currentInspectionKey: "immutable-lesson.webp",
    currentInspectionSha256: evidenceSha,
    currentPhysicalQuad: quad,
    originalExpectedAnchors: anchors,
    automaticDiagnostics: automaticFailure,
    humanCorrectedAnchors: corrected,
    validatedRegistration: registration,
    rescueAttemptId,
    hashEvidence: async () => evidenceSha,
    transaction,
  };
}
const registration: SpeedsterMapRegistration = {
  version: "opencv-redundant-ransac-registration-v2",
  side: "BACK",
  mapRevisionId: "revision-8",
  currentPhysicalQuadSha256: speedsterPhysicalQuadHash(quad),
  currentInspectionSha256: evidenceSha,
  homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  anchors: anchors.map(({ id, point }) => ({ anchorId: id, expectedPoint: point, locatedPoint: point, score: 1 })),
  projectedDesignBoundary: { kind: "FULL_BLEED" },
  projectedZones: [{
    id: "zone", label: "Text", semanticType: "PRINT_TEXT",
    polygon: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }],
  }],
  candidateProvenance: { candidateId: "human-confirmed", source: "HUMAN_CORRECTION" },
  acceptance: {
    policyVersion: "speedster-map-registration-acceptance-v2",
    mode: "HUMAN_CONFIRMED",
    featureCount: 4,
    usableFeatureCount: 4,
    inlierCount: 4,
    inlierFraction: 1,
    perAnchorFeatureCounts: [1, 1, 1, 1],
    perAnchorInlierCounts: [1, 1, 1, 1],
    medianReprojectionErrorPx: 0,
    maxReprojectionErrorPx: 0,
  },
};

function transactionHarness(readBack = true) {
  let row: Record<string, unknown> | null = null;
  let creates = 0;
  const transaction: SpeedsterRegistrationLessonTransactionRunner = async (operation) => operation({
    aiGraderV2MapRegistrationLesson: {
      create: async ({ data }: any) => {
        creates += 1;
        row = { id: "lesson-1", ...data };
        return row;
      },
      findUnique: async () => readBack ? row : null,
    } as any,
  });
  return { transaction, row: () => row, creates: () => creates };
}

test("human rescue persists one immutable hash-verified lesson before returning registration", async () => {
  const harness = transactionHarness();
  const result = await persistSpeedsterRegistrationLesson({
    operatorAdminId: "admin-1",
    mapRevisionId: "revision-8",
    side: "BACK",
    evidenceSessionId: "session-1",
    currentInspectionKey: "ai-grader-v2/admin-1/session-1/prepared/back/inspection.webp",
    currentInspectionSha256: evidenceSha,
    currentPhysicalQuad: quad,
    originalExpectedAnchors: anchors,
    automaticDiagnostics: automaticFailure,
    humanCorrectedAnchors: corrected,
    validatedRegistration: registration,
    rescueAttemptId: "rescue-attempt-1",
    hashEvidence: async () => evidenceSha,
    transaction: harness.transaction,
  });
  assert.equal(result.lessonId, "lesson-1");
  assert.deepEqual(result.registration, registration);
  const row = harness.row() as any;
  assert.equal(row.lessonHash, result.lessonHash);
  assert.equal(speedsterRegistrationLessonHash(row), row.lessonHash);
  assert.equal(row.automaticDiagnostics.bestCandidate.anchors[0].trackedPoint.x, -0.13, "stored diagnostics retain the off-card proposal");
  const retry = await persistSpeedsterRegistrationLesson({
    operatorAdminId: "admin-1",
    mapRevisionId: "revision-8",
    side: "BACK",
    evidenceSessionId: "session-1",
    currentInspectionKey: "ai-grader-v2/admin-1/session-1/prepared/back/inspection.webp",
    currentInspectionSha256: evidenceSha,
    currentPhysicalQuad: quad,
    originalExpectedAnchors: anchors,
    automaticDiagnostics: automaticFailure,
    humanCorrectedAnchors: corrected,
    validatedRegistration: registration,
    rescueAttemptId: "rescue-attempt-1",
    hashEvidence: async () => evidenceSha,
    transaction: harness.transaction,
  });
  assert.deepEqual(retry, result, "lost-response retry returns the exact existing immutable lesson");
  assert.equal(harness.creates(), 1);
});

test("hash read-back failure rolls back the lesson result and returns no rescued registration", async () => {
  const harness = transactionHarness(false);
  await assert.rejects(() => persistSpeedsterRegistrationLesson({
    operatorAdminId: "admin-1",
    mapRevisionId: "revision-8",
    side: "BACK",
    evidenceSessionId: "session-1",
    currentInspectionKey: "ai-grader-v2/admin-1/session-1/prepared/back/inspection.webp",
    currentInspectionSha256: evidenceSha,
    currentPhysicalQuad: quad,
    originalExpectedAnchors: anchors,
    automaticDiagnostics: automaticFailure,
    humanCorrectedAnchors: corrected,
    validatedRegistration: registration,
    rescueAttemptId: "rescue-attempt-2",
    hashEvidence: async () => evidenceSha,
    transaction: harness.transaction,
  }), /hash verification failed/);
});

test("rescue freezes attempt-specific evidence and later prepared-image overwrite cannot alter it", async () => {
  const original = Buffer.from("exact-current-inspection-v1");
  const overwritten = Buffer.from("later-session-inspection-v2");
  const originalSha = createHash("sha256").update(original).digest("hex");
  const objects = new Map<string, Buffer>([["prepared.webp", original]]);
  const hashEvidence = async (key: string) => {
    const value = objects.get(key);
    if (!value) throw new Error("not found");
    return createHash("sha256").update(value).digest("hex");
  };
  const first = await ensureSpeedsterRegistrationLessonEvidenceSnapshot({
    operatorAdminId: "admin-1", evidenceSessionId: "session-1", mapRevisionId: "revision-8",
    side: "BACK", rescueAttemptId: "snapshot-attempt-1", sourceStorageKey: "prepared.webp",
    expectedSha256: originalSha, hashEvidence,
    readEvidence: async (key) => Buffer.from(objects.get(key)!),
    writeIfAbsent: async (key, buffer) => {
      if (objects.has(key)) return { storageKey: key, created: false as const };
      objects.set(key, Buffer.from(buffer));
      return { storageKey: key, created: true as const };
    },
  });
  objects.set("prepared.webp", overwritten);
  assert.equal(await hashEvidence(first.storageKey), originalSha);
  assert.notEqual(await hashEvidence("prepared.webp"), originalSha);
  const retry = await ensureSpeedsterRegistrationLessonEvidenceSnapshot({
    operatorAdminId: "admin-1", evidenceSessionId: "session-1", mapRevisionId: "revision-8",
    side: "BACK", rescueAttemptId: "snapshot-attempt-1", sourceStorageKey: "prepared.webp",
    expectedSha256: originalSha, hashEvidence,
    readEvidence: async () => { throw new Error("immutable retry must not read mutable prepared evidence"); },
    writeIfAbsent: async () => { throw new Error("immutable retry must not overwrite evidence"); },
  });
  assert.equal(retry.storageKey, first.storageKey);
  assert.equal(retry.created, false);
});

test("concurrent identical rescue attempt resolves unique-insert race to one immutable winner", async () => {
  let row: Record<string, any> | null = null;
  let creates = 0;
  let initialFinds = 0;
  let release!: () => void;
  const bothAtCreate = new Promise<void>((resolve) => { release = resolve; });
  const transaction: SpeedsterRegistrationLessonTransactionRunner = async (operation) => operation({
    aiGraderV2MapRegistrationLesson: {
      findUnique: async ({ where }: any) => {
        if (row) return row;
        if (where.rescueAttemptId) {
          initialFinds += 1;
          if (initialFinds === 2) release();
          await bothAtCreate;
        }
        return row;
      },
      create: async ({ data }: any) => {
        creates += 1;
        if (row) throw Object.assign(new Error("unique conflict"), { code: "P2002" });
        row = { id: "lesson-concurrent", ...data };
        return row;
      },
    } as any,
  });
  const [left, right] = await Promise.all([
    persistSpeedsterRegistrationLesson(persistenceInput("concurrent-attempt-1", transaction)),
    persistSpeedsterRegistrationLesson(persistenceInput("concurrent-attempt-1", transaction)),
  ]);
  assert.equal(creates, 2, "one create wins while the racing create observes a unique conflict");
  assert.deepEqual(left, right, "both requests return the same verified immutable winner");
  assert.equal(left.lessonId, "lesson-concurrent");
});

test("future candidate uses exact lesson evidence and fails closed on revision, side, hash, or object drift", async () => {
  const harness = transactionHarness();
  await persistSpeedsterRegistrationLesson({
    operatorAdminId: "admin-1", mapRevisionId: "revision-8", side: "BACK", evidenceSessionId: "session-1",
    currentInspectionKey: "lesson.webp", currentInspectionSha256: evidenceSha, currentPhysicalQuad: quad,
    originalExpectedAnchors: anchors, automaticDiagnostics: automaticFailure, humanCorrectedAnchors: corrected,
    validatedRegistration: registration, rescueAttemptId: "rescue-attempt-3", hashEvidence: async () => evidenceSha,
    transaction: harness.transaction,
  });
  const row = harness.row() as any;
  const candidates = await loadVerifiedSpeedsterRegistrationLessonCandidates({
    mapRevisionId: "revision-8", side: "BACK", expectedAnchors: anchors,
    findLessons: async () => [row], hashEvidence: async (key) => key === "lesson.webp" ? evidenceSha : "0".repeat(64),
  });
  assert.deepEqual(candidates, [{
    lessonId: "lesson-1",
    currentInspectionKey: "lesson.webp",
    currentInspectionSha256: evidenceSha,
    anchors: corrected.map(({ anchorId, point }) => ({ id: anchorId, point })),
    sourceHomography: registration.homography,
  }]);
  assert.deepEqual(await loadVerifiedSpeedsterRegistrationLessonCandidates({
    mapRevisionId: "revision-8", side: "FRONT", expectedAnchors: anchors,
    findLessons: async () => [row], hashEvidence: async () => evidenceSha,
  }), []);
  assert.deepEqual(await loadVerifiedSpeedsterRegistrationLessonCandidates({
    mapRevisionId: "revision-8", side: "BACK", expectedAnchors: anchors,
    findLessons: async () => [{ ...row, lessonHash: "0".repeat(64) }], hashEvidence: async () => evidenceSha,
  }), []);
  const incoherent = {
    ...row,
    validatedRegistration: {
      ...row.validatedRegistration,
      anchors: row.validatedRegistration.anchors.map((anchor: any, index: number) => (
        index === 0 ? { ...anchor, locatedPoint: { x: 0.12, y: 0.1 } } : anchor
      )),
    },
  };
  incoherent.lessonHash = speedsterRegistrationLessonHash(incoherent);
  assert.deepEqual(await loadVerifiedSpeedsterRegistrationLessonCandidates({
    mapRevisionId: "revision-8", side: "BACK", expectedAnchors: anchors,
    findLessons: async () => [incoherent], hashEvidence: async () => evidenceSha,
  }), [], "A hash-valid lesson with internally incoherent anchors must still fail closed");
  assert.deepEqual(await loadVerifiedSpeedsterRegistrationLessonCandidates({
    mapRevisionId: "revision-8", side: "BACK", expectedAnchors: anchors,
    findLessons: async () => [row], hashEvidence: async () => "0".repeat(64),
  }), []);
});
