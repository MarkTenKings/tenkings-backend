import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ensureSpeedsterRegistrationLessonEvidenceSnapshot,
  loadVerifiedSpeedsterRegistrationLessonCandidates,
  persistSpeedsterRegistrationLesson,
  speedsterRegistrationLessonHash,
  verifySpeedsterRegistrationLessonCaptureAuthority,
  verifySpeedsterRegistrationLessonReferenceAuthority,
  type SpeedsterRegistrationLessonTransactionRunner,
} from "../lib/server/speedsterMapRegistrationLessons";
import type {
  SpeedsterMapRegistration,
  SpeedsterMapRegistrationFailure,
} from "../lib/ai-grader-v2/card-type-map-contracts";
import { speedsterPhysicalQuadHash } from "../lib/server/speedsterCardTypeMaps";
import {
  privateChecksumPutObjectCommand,
  readStorageBufferBounded,
  uploadPrivateChecksumBuffer,
} from "../lib/server/storage";

const evidenceSha = "a".repeat(64);
const exactMatchKeyHash = "c".repeat(64);
const expectedMapId = "map-12345678";
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
    expectedMapId,
    expectedMatchKeyHash: exactMatchKeyHash,
    expectedScope: "EXACT" as const,
    expectedExactMatchKeyHash: exactMatchKeyHash,
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
    $queryRaw: async () => [{
      id: expectedMapId,
      matchKeyHash: exactMatchKeyHash,
      currentRevisionId: "revision-8",
    }],
    aiGraderV2MapRegistrationLesson: {
      create: async ({ data }: any) => {
        creates += 1;
        row = { id: "lesson-1", ...data };
        return row;
      },
      findUnique: async () => readBack ? row : null,
    } as any,
  } as any);
  return { transaction, row: () => row, creates: () => creates };
}

test("human rescue persists one immutable hash-verified lesson before returning registration", async () => {
  const harness = transactionHarness();
  const result = await persistSpeedsterRegistrationLesson({
    operatorAdminId: "admin-1",
    expectedMapId,
    expectedMatchKeyHash: exactMatchKeyHash,
    expectedScope: "EXACT",
    expectedExactMatchKeyHash: exactMatchKeyHash,
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
    expectedMapId,
    expectedMatchKeyHash: exactMatchKeyHash,
    expectedScope: "EXACT",
    expectedExactMatchKeyHash: exactMatchKeyHash,
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
    expectedMapId,
    expectedMatchKeyHash: exactMatchKeyHash,
    expectedScope: "EXACT",
    expectedExactMatchKeyHash: exactMatchKeyHash,
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

test("lesson persistence locks and rechecks the exact active revision before any insert", async () => {
  let creates = 0;
  const transaction: SpeedsterRegistrationLessonTransactionRunner = async (operation) => operation({
    $queryRaw: async () => [{
      id: expectedMapId,
      matchKeyHash: exactMatchKeyHash,
      currentRevisionId: "revision-changed-in-flight",
    }],
    aiGraderV2MapRegistrationLesson: {
      findUnique: async () => null,
      create: async () => { creates += 1; throw new Error("must not insert"); },
    } as any,
  } as any);
  await assert.rejects(() => persistSpeedsterRegistrationLesson(
    persistenceInput("pointer-drift-1", transaction),
  ), /active map revision changed/);
  assert.equal(creates, 0);
});

test("family rescue rejects an exact map that became applicable in flight", async () => {
  const familyHash = "f".repeat(64);
  let queryCalls = 0;
  let creates = 0;
  const transaction: SpeedsterRegistrationLessonTransactionRunner = async (operation) => operation({
    $queryRaw: async () => {
      queryCalls += 1;
      return queryCalls === 1
        ? [{ id: expectedMapId, matchKeyHash: familyHash, currentRevisionId: "revision-8" }]
        : [{ id: "new-exact-map", matchKeyHash: exactMatchKeyHash, currentRevisionId: "new-exact-revision" }];
    },
    aiGraderV2MapRegistrationLesson: {
      findUnique: async () => null,
      create: async () => { creates += 1; throw new Error("must not insert"); },
    } as any,
  } as any);
  await assert.rejects(() => persistSpeedsterRegistrationLesson({
    ...persistenceInput("applicable-map-drift-1", transaction),
    expectedMatchKeyHash: familyHash,
    expectedScope: "FAMILY",
    expectedExactMatchKeyHash: exactMatchKeyHash,
  }), /applicable map changed/);
  assert.equal(creates, 0);
});

test("rescue freezes content-addressed evidence and later prepared-image overwrite cannot alter it", async () => {
  const original = Buffer.from("exact-current-inspection-v1");
  const overwritten = Buffer.from("later-session-inspection-v2");
  const originalSha = createHash("sha256").update(original).digest("hex");
  const objects = new Map<string, Buffer>([["prepared.webp", original]]);
  const hashEvidence = async (key: string) => {
    const value = objects.get(key);
    if (!value) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    return createHash("sha256").update(value).digest("hex");
  };
  const first = await ensureSpeedsterRegistrationLessonEvidenceSnapshot({
    operatorAdminId: "admin-1", evidenceSessionId: "session-1", mapRevisionId: "revision-8",
    side: "BACK", rescueAttemptId: "snapshot-attempt-1", sourceStorageKey: "prepared.webp",
    expectedSha256: originalSha, hashEvidence,
    readEvidence: async (key) => Buffer.from(objects.get(key)!),
    writeEvidence: async (key, buffer) => {
      objects.set(key, Buffer.from(buffer));
      return { storageKey: key };
    },
  });
  assert.match(first.storageKey, new RegExp(`inspection-${originalSha}\\.webp$`));
  objects.set("prepared.webp", overwritten);
  assert.equal(await hashEvidence(first.storageKey), originalSha);
  assert.notEqual(await hashEvidence("prepared.webp"), originalSha);
  const retry = await ensureSpeedsterRegistrationLessonEvidenceSnapshot({
    operatorAdminId: "admin-1", evidenceSessionId: "session-1", mapRevisionId: "revision-8",
    side: "BACK", rescueAttemptId: "snapshot-attempt-1", sourceStorageKey: "prepared.webp",
    expectedSha256: originalSha, hashEvidence,
    readEvidence: async () => { throw new Error("immutable retry must not read mutable prepared evidence"); },
    writeEvidence: async () => { throw new Error("immutable retry must not overwrite evidence"); },
  });
  assert.equal(retry.storageKey, first.storageKey);
  assert.equal(retry.created, false);
});

test("content-addressed snapshot rejects a conflicting existing object without reading or PUT", async () => {
  let reads = 0;
  let writes = 0;
  await assert.rejects(() => ensureSpeedsterRegistrationLessonEvidenceSnapshot({
    operatorAdminId: "admin-1", evidenceSessionId: "session-1", mapRevisionId: "revision-8",
    side: "FRONT", rescueAttemptId: "snapshot-conflict-1", sourceStorageKey: "prepared.webp",
    expectedSha256: "d".repeat(64),
    hashEvidence: async () => "e".repeat(64),
    readEvidence: async () => { reads += 1; return Buffer.from("must-not-read"); },
    writeEvidence: async (key) => { writes += 1; return { storageKey: key }; },
  }), /conflicts with this attempt ID/);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test("concurrent identical snapshot writers converge on byte-identical content", async () => {
  const bytes = Buffer.from("concurrent-identical-inspection");
  const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
  const objects = new Map<string, Buffer>();
  let initialChecks = 0;
  let release!: () => void;
  const bothChecked = new Promise<void>((resolve) => { release = resolve; });
  const hashEvidence = async (key: string) => {
    if (!objects.has(key)) {
      initialChecks += 1;
      if (initialChecks === 2) release();
      await bothChecked;
      throw Object.assign(new Error("not found"), { name: "NoSuchKey" });
    }
    return createHash("sha256").update(objects.get(key)!).digest("hex");
  };
  const writeEvidence = async (key: string, buffer: Buffer) => {
    objects.set(key, Buffer.from(buffer));
    return { storageKey: key };
  };
  const input = {
    operatorAdminId: "admin-1", evidenceSessionId: "session-1", mapRevisionId: "revision-8",
    side: "BACK" as const, rescueAttemptId: "snapshot-concurrent-1", sourceStorageKey: "prepared.webp",
    expectedSha256, hashEvidence, readEvidence: async () => Buffer.from(bytes), writeEvidence,
  };
  const [left, right] = await Promise.all([
    ensureSpeedsterRegistrationLessonEvidenceSnapshot(input),
    ensureSpeedsterRegistrationLessonEvidenceSnapshot(input),
  ]);
  assert.equal(left.storageKey, right.storageKey);
  assert.deepEqual(objects.get(left.storageKey), bytes);
  assert.equal(await hashEvidence(left.storageKey), expectedSha256);
});

test("bounded snapshot reads reject oversized declarations and streams before unbounded allocation", async () => {
  let destroyed = 0;
  const body = {
    async *[Symbol.asyncIterator]() { yield Buffer.alloc(9); },
    destroy() { destroyed += 1; },
  };
  await assert.rejects(() => readStorageBufferBounded("oversized.webp", 8, {
    openRead: async () => ({ storageKey: "oversized.webp", byteSize: 9, body }),
  }), /invalid bounded byte size/);
  assert.equal(destroyed, 1);
  await assert.rejects(() => readStorageBufferBounded("overrun.webp", 8, {
    openRead: async () => ({ storageKey: "overrun.webp", byteSize: 8, body }),
  }), /exceeded its bounded byte size/);
  assert.equal(destroyed, 2);
});

test("private checksum upload uses a provider-compatible unconditional private PUT and exact local bytes", async () => {
  const bytes = Buffer.from("private-content-addressed-object");
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const command = privateChecksumPutObjectCommand({
    bucket: "test-bucket", storageKey: "private/evidence.webp", buffer: bytes,
    contentType: "image/webp", cacheControl: "private, immutable", checksumSha256,
  });
  assert.equal(command.input.ACL, "private");
  assert.equal("IfNoneMatch" in command.input, false, "Spaces PutObject must not receive unsupported If-None-Match");
  assert.equal(command.input.ChecksumSHA256, Buffer.from(checksumSha256, "hex").toString("base64"));
  let localWrite: { key: string; bytes: Buffer } | undefined;
  await uploadPrivateChecksumBuffer("private/evidence.webp", bytes, "image/webp", { checksumSha256 }, {
    storageMode: "local",
    writeLocal: async (key, data) => { localWrite = { key, bytes: Buffer.from(data) }; return key; },
  });
  assert.equal(localWrite?.key, "private/evidence.webp");
  assert.deepEqual(localWrite?.bytes, bytes);
  await assert.rejects(() => uploadPrivateChecksumBuffer(
    "private/evidence.webp", Buffer.from("different"), "image/webp", { checksumSha256 }, {
      storageMode: "local", writeLocal: async () => { throw new Error("must not write"); },
    },
  ), /checksum does not match/);
});

test("concurrent identical rescue attempt resolves unique-insert race to one immutable winner", async () => {
  let row: Record<string, any> | null = null;
  let creates = 0;
  let initialFinds = 0;
  let release!: () => void;
  const bothAtCreate = new Promise<void>((resolve) => { release = resolve; });
  const transaction: SpeedsterRegistrationLessonTransactionRunner = async (operation) => operation({
    $queryRaw: async () => [{
      id: expectedMapId,
      matchKeyHash: exactMatchKeyHash,
      currentRevisionId: "revision-8",
    }],
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
  } as any);
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
    operatorAdminId: "admin-1", expectedMapId, expectedMatchKeyHash: exactMatchKeyHash,
    expectedScope: "EXACT", expectedExactMatchKeyHash: exactMatchKeyHash,
    mapRevisionId: "revision-8", side: "BACK", evidenceSessionId: "session-1",
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

test("capture authority accepts only the exact hash-verified human lesson result", async () => {
  const harness = transactionHarness();
  const persisted = await persistSpeedsterRegistrationLesson(
    persistenceInput("capture-authority-1", harness.transaction),
  );
  const claimed: SpeedsterMapRegistration = {
    ...persisted.registration,
    candidateProvenance: {
      candidateId: persisted.lessonId,
      source: "HUMAN_CORRECTION",
      lessonId: persisted.lessonId,
    },
  };
  const verify = (registrationClaim: SpeedsterMapRegistration) => (
    verifySpeedsterRegistrationLessonCaptureAuthority({
      lessonId: persisted.lessonId,
      mapRevisionId: "revision-8",
      side: "BACK",
      currentInspectionSha256: evidenceSha,
      currentPhysicalQuadSha256: speedsterPhysicalQuadHash(quad),
      registration: registrationClaim,
      hashEvidence: async () => evidenceSha,
      findLesson: async () => harness.row() as any,
    })
  );
  await verify(claimed);
  await assert.rejects(() => verify({
    ...claimed,
    homography: [1, 0, 0.01, 0, 1, 0, 0, 0, 1],
  }), /does not match the exact server-validated transform/);
  await assert.rejects(() => verifySpeedsterRegistrationLessonCaptureAuthority({
    lessonId: persisted.lessonId,
    mapRevisionId: "revision-8",
    side: "BACK",
    currentInspectionSha256: evidenceSha,
    currentPhysicalQuadSha256: speedsterPhysicalQuadHash(quad),
    registration: claimed,
    hashEvidence: async () => "0".repeat(64),
    findLesson: async () => harness.row() as any,
  }), /immutable evidence failed hash verification/);
});

test("automatic lesson-reference authority reloads exact tenant, revision, side, evidence, anchors, and transform", async () => {
  const harness = transactionHarness();
  const persisted = await persistSpeedsterRegistrationLesson(
    persistenceInput("reference-authority-1", harness.transaction),
  );
  const verified = await verifySpeedsterRegistrationLessonReferenceAuthority({
    lessonId: persisted.lessonId,
    mapRevisionId: "revision-8",
    side: "BACK",
    expectedAnchors: anchors,
    hashEvidence: async () => evidenceSha,
    findLesson: async () => harness.row() as any,
  });
  assert.equal(verified.lessonId, persisted.lessonId);
  assert.deepEqual(verified.sourceHomography, registration.homography);
  await assert.rejects(() => verifySpeedsterRegistrationLessonReferenceAuthority({
    lessonId: persisted.lessonId,
    mapRevisionId: "revision-8",
    side: "FRONT",
    expectedAnchors: anchors,
    hashEvidence: async () => evidenceSha,
    findLesson: async () => harness.row() as any,
  }), /does not match/);
  await assert.rejects(() => verifySpeedsterRegistrationLessonReferenceAuthority({
    lessonId: persisted.lessonId,
    mapRevisionId: "revision-8",
    side: "BACK",
    expectedAnchors: anchors,
    hashEvidence: async () => "0".repeat(64),
    findLesson: async () => harness.row() as any,
  }), /failed immutable hash and transform verification/);
});
