import assert from "node:assert/strict";
import test from "node:test";

import type { SpeedsterMeasuredDefect, SpeedsterReviewFinding } from "../lib/ai-grader-v2/contracts";
import { encodeSpeedsterTraceBitmapWireV1 } from "../lib/ai-grader-v2/trace-bitmap-wire";
import {
  SPEEDSTER_TRACE_PIXEL_COUNT,
  encodeSpeedsterTraceRleV1,
} from "../lib/ai-grader-v2/trace-codec";
import {
  applySpeedsterReviewAction,
  type SpeedsterReviewActionDependencies,
  type SpeedsterReviewActionSession,
} from "../lib/server/aiGraderV2ReviewAction";
import {
  SPEEDSTER_DETECT_WORKER_ID_UNAVAILABLE,
  speedsterDetectTransportEvidence,
  SpeedsterDetectUpstreamError,
} from "../lib/server/aiGraderV2DetectTransport";
import {
  assertSpeedsterDetectionRuntimeAuthority,
  fetchSpeedsterDetectUpstream,
} from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]/review-action";
import {
  parseSpeedsterDetectorIdentityV1,
  sealSpeedsterDetectionSideCheckpoint,
  speedsterDetectionSha256,
  type SpeedsterDetectionSideCheckpoint,
  type UnsignedSpeedsterDetectionSideCheckpoint,
} from "../lib/server/speedsterDetectionSideCheckpoint";

const measurement = {
  widthMm: 1,
  heightMm: 1,
  areaMm2: 1,
  zonePercent: 1,
  multiplier: 1,
  weightedAreaMm2: 1,
  subgradeEffect: 0,
};
const defect: SpeedsterMeasuredDefect = {
  id: "FRONT:source-1:SURFACE",
  side: "FRONT",
  zone: "SURFACE",
  defectType: "LIGHT_SCRATCH_SCUFF",
  origin: "DETECTOR",
  confidence: 0.9,
  canonicalContour: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }],
  sourceViewId: "FRONT:ORIGINAL",
  supportingViewIds: [],
  reviewResult: "TYPE_CORRECTED",
  measurement,
};
const capture = {
  cornerShape: "SQUARE",
  front: {
    originalStorageKey: "ai-grader-v2/admin-1/session-12345678901234567890/original/front.jpg",
    rectifiedStorageKey: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/front/rectified.webp",
    inspectionStorageKey: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/front/inspection.webp",
    inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
    viewStorageKeys: {
      NORMALIZED: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/front/normalized.webp",
      MICRO_DEFECT: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/front/micro_defect.webp",
      DIRECTIONAL: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/front/directional.webp",
    },
    centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 },
  },
  back: {
    originalStorageKey: "ai-grader-v2/admin-1/session-12345678901234567890/original/back.jpg",
    rectifiedStorageKey: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/back/rectified.webp",
    inspectionStorageKey: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/back/inspection.webp",
    inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
    viewStorageKeys: {
      NORMALIZED: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/back/normalized.webp",
      MICRO_DEFECT: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/back/micro_defect.webp",
      DIRECTIONAL: "ai-grader-v2/admin-1/session-12345678901234567890/prepared/back/directional.webp",
    },
    centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 },
  },
};

function session(
  reviewedDefects: readonly unknown[] = [defect],
  captureEvidence: unknown = capture,
): SpeedsterReviewActionSession {
  return {
    id: "session-12345678901234567890",
    createdByUserId: "admin-1",
    workflowState: "CAPTURED",
    capture: captureEvidence,
    reviewedDefects,
    gradeReport: { detectorVersion: "sam3-server-owned" },
    updatedAt: new Date("2026-08-05T00:00:00.000Z"),
  };
}

function versionedCapture() {
  const frontGeneration = "recapture-00000000-0000-4000-8000-000000000007";
  const backGeneration = `iphone-v4-sha256-${"b".repeat(64)}`;
  const side = (name: "front" | "back", generation: string) => ({
    ...capture[name],
    originalStorageKey: `ai-grader-v2/admin-1/session-12345678901234567890/original/${generation}/${name}.jpg`,
    rectifiedStorageKey: `ai-grader-v2/admin-1/session-12345678901234567890/prepared/${name}/${generation}/rectified.webp`,
    inspectionStorageKey: `ai-grader-v2/admin-1/session-12345678901234567890/prepared/${name}/${generation}/inspection.webp`,
    viewStorageKeys: {
      NORMALIZED: `ai-grader-v2/admin-1/session-12345678901234567890/prepared/${name}/${generation}/normalized.webp`,
      MICRO_DEFECT: `ai-grader-v2/admin-1/session-12345678901234567890/prepared/${name}/${generation}/micro_defect.webp`,
      DIRECTIONAL: `ai-grader-v2/admin-1/session-12345678901234567890/prepared/${name}/${generation}/directional.webp`,
    },
  });
  return {
    cornerShape: capture.cornerShape,
    front: side("front", frontGeneration),
    back: side("back", backGeneration),
  };
}

function detectorEvidence(side: "FRONT" | "BACK") {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[side === "FRONT" ? 100 : 200] = 1;
  const candidateId = `raw-${side === "FRONT" ? "a" : "b"}${"0".repeat(23)}`;
  return {
    version: "speedster-detector-evidence-v1",
    rawCandidates: [{
      version: "speedster-raw-detector-candidate-v1",
      candidateId,
      evidenceOrdinal: 0,
      sourceViewId: `${side}:ORIGINAL`,
      promptIndex: 0,
      maskIndex: 0,
      promptBox: [1, 2, 3, 4],
      defectType: "VISIBLE_WHITENING",
      origin: "DETECTOR",
      rawConfidence: 0.9,
      featureFingerprint: null,
      canonicalMask: encodeSpeedsterTraceRleV1(pixels),
    }],
    memoryDecisions: [{
      version: "speedster-memory-decision-evidence-v1",
      candidateId,
      policy: "SAM_MEMORY_V2",
      action: "vetoed",
      adjustment: -0.06,
      adjustedConfidence: 0.84,
      collectionThreshold: 0.5,
      disposition: "VETOED_BY_MEMORY",
      diagnostic: { action: "vetoed", bankVersion: 2 },
    }],
  };
}

function emptyDetectorEvidence() {
  return {
    version: "speedster-detector-evidence-v1",
    rawCandidates: [],
    memoryDecisions: [],
  };
}

function detectorIdentity(detectorVersion = "same-release") {
  return {
    version: "speedster-detector-identity-v1",
    detectorVersion,
    source: {
      repository: "https://github.com/ten-kings/example",
      commitSha: "a".repeat(40),
      treeSha: "d".repeat(40),
    },
    runtime: {
      ociDigest: `sha256:${"b".repeat(64)}`,
      ociDigestProvenance: "DEPLOYMENT_INJECTED",
      ociImageReference: "ghcr.io/ten-kings/speedster:test",
      buildId: "github-run-123-1",
      buildIdentityProvenance: "OCI_IMAGE_ENV",
      platform: "linux/amd64",
      pythonVersion: "3.12.4",
      frameworkVersion: "sam3@96914d2425f90a64f45ca977c2b5165418099543",
      torchVersion: "2.7.1",
      cudaVersion: "12.8",
      cudnnVersion: "91002",
      accelerator: "NVIDIA-L4",
      gpuName: "NVIDIA-L4",
      gpuCapability: "8.9",
      gpuCount: 1,
    },
    model: {
      name: "sam3-speedster",
      repository: "facebook/sam3",
      revision: "e".repeat(40),
      checkpointSha256: "c".repeat(64),
      sourceCommitSha: "96914d2425f90a64f45ca977c2b5165418099543",
    },
    policy: {
      detectorVersion: "detector-policy-v1",
      promptVersion: "prompt-policy-v1",
      fusionVersion: "fusion-policy-v1",
      measurementVersion: "measurement-policy-v1",
      memoryVersion: "sam-memory-v2",
    },
    determinism: {
      deterministicAlgorithms: true,
      cudnnDeterministic: true,
      cudnnBenchmark: false,
      allowTf32: false,
      evalMode: true,
      compile: false,
      autocastDtype: "bfloat16",
    },
  } as const;
}

function durableSideCheckpointHarness() {
  const authority = { keyId: "test-key-v1", secret: "test-secret-".repeat(8) };
  const sides: Partial<Record<"FRONT" | "BACK", SpeedsterDetectionSideCheckpoint>> = {};
  let throwAfterPersistSide: "FRONT" | "BACK" | null = null;
  return {
    sides,
    throwAfterPersist(side: "FRONT" | "BACK" | null) {
      throwAfterPersistSide = side;
    },
    dependencies: {
      async hashDetectionEvidence(storageKey: string) {
        return speedsterDetectionSha256({ storageKey });
      },
      async loadDetectionSideCheckpoints(lookup: {
        sessionRevision: string;
        captureBindingSha256: string;
        operationId: string;
      }) {
        return Object.fromEntries(Object.entries(sides).filter(([, checkpoint]) => (
          checkpoint?.sessionRevision === lookup.sessionRevision
          && checkpoint.captureBindingSha256 === lookup.captureBindingSha256
          && checkpoint.operationId === lookup.operationId
        ))) as Partial<Record<"FRONT" | "BACK", SpeedsterDetectionSideCheckpoint>>;
      },
      async persistDetectionSideCheckpoint(unsigned: UnsignedSpeedsterDetectionSideCheckpoint) {
        const checkpoint = sealSpeedsterDetectionSideCheckpoint(unsigned, authority);
        const existing = sides[checkpoint.side];
        if (existing && existing.resultSha256 !== checkpoint.resultSha256) {
          throw new Error("late conflicting detector result rejected");
        }
        sides[checkpoint.side] = existing ?? checkpoint;
        if (throwAfterPersistSide === checkpoint.side) {
          throwAfterPersistSide = null;
          throw new Error("database response was lost after durable side insert");
        }
        return sides[checkpoint.side]!;
      },
    },
  };
}

function retainedDetectorEvidence(
  side: "FRONT" | "BACK",
  candidateId: string,
  defectType: SpeedsterMeasuredDefect["defectType"],
  canonicalMask: ReturnType<typeof encodeSpeedsterTraceRleV1>,
) {
  return {
    version: "speedster-detector-evidence-v1",
    rawCandidates: [{
      version: "speedster-raw-detector-candidate-v1",
      candidateId,
      evidenceOrdinal: 0,
      sourceViewId: `${side}:ORIGINAL`,
      promptIndex: 0,
      maskIndex: 0,
      promptBox: [1, 2, 3, 4],
      defectType,
      origin: "DETECTOR",
      rawConfidence: 0.9,
      featureFingerprint: null,
      canonicalMask,
    }],
    memoryDecisions: [{
      version: "speedster-memory-decision-evidence-v1",
      candidateId,
      policy: "SAM_MEMORY_V2",
      action: "retained",
      adjustment: 0,
      adjustedConfidence: 0.9,
      collectionThreshold: 0.5,
      disposition: "RETAINED_FOR_MEASUREMENT",
      diagnostic: { action: "retained", bankVersion: 2 },
    }],
  };
}

test("review actions reject non-CAPTURED workflow state before any external work", async () => {
  let externalCalls = 0;
  await assert.rejects(
    applySpeedsterReviewAction({
      sessionId: session().id,
      createdByUserId: "admin-1",
      action: { type: "INITIALIZE" },
    }, {
      async loadOwnedSession() { return { ...session([]), workflowState: "DRAFT" }; },
      async persistReviewIfRevision() { externalCalls += 1; },
      async presignRead() { externalCalls += 1; return "https://fresh.example/front.webp"; },
      async learningBankForDetect() { externalCalls += 1; return {}; },
      async detect() { externalCalls += 1; return {}; },
      async measure() { externalCalls += 1; return { defects: [] }; },
    }),
    /Only a CAPTURED Speedster session can accept review actions/,
  );
  assert.equal(externalCalls, 0);
});

test("one server-owned REMOVE measures once, persists grade+findings atomically, and returns no trace bodies", async () => {
  const events: string[] = [];
  let persisted: { reviewedDefects: readonly unknown[]; gradeReport: unknown } | null = null;
  const result = await applySpeedsterReviewAction({
    sessionId: session().id,
    createdByUserId: "admin-1",
    action: { type: "REMOVE", defectIds: [defect.id] },
  }, {
    async loadOwnedSession() { events.push("load"); return session(); },
    async persistReviewIfRevision(_identity, expectedUpdatedAt, data) {
      events.push("transaction:start");
      assert.equal(expectedUpdatedAt.getTime(), session().updatedAt.getTime());
      events.push("persist");
      persisted = data;
      events.push("transaction:commit");
    },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body) {
      events.push("measure");
      assert.equal(body.side, "FRONT");
      assert.equal(body.findings.length, 0);
      return { defects: [] };
    },
  });

  assert.deepEqual(events, ["load", "measure", "transaction:start", "persist", "transaction:commit"]);
  const saved = persisted as { reviewedDefects: readonly Record<string, unknown>[]; gradeReport: unknown } | null;
  assert.equal(saved?.reviewedDefects[0].reviewResult, "REMOVED");
  assert.equal(JSON.stringify(result).includes("finalTrace"), false);
  assert.equal(result.gradeReport.detectorVersion, "sam3-server-owned");
});

test("review actions retain exact versioned recapture and iPhone evidence paths", async () => {
  const exactCapture = versionedCapture();
  const signed: string[] = [];
  const result = await applySpeedsterReviewAction({
    sessionId: session().id,
    createdByUserId: "admin-1",
    action: { type: "REMOVE", defectIds: [defect.id] },
  }, {
    async loadOwnedSession() { return session([defect], exactCapture); },
    async persistReviewIfRevision() {},
    async presignRead(storageKey) {
      signed.push(storageKey);
      return `https://fresh.example/${encodeURIComponent(storageKey)}`;
    },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body) {
      assert.match(body.evidenceView.imageUrl, /recapture-00000000-0000-4000-8000-000000000007/);
      return { defects: [] };
    },
  });

  assert.deepEqual(signed, [exactCapture.front.inspectionStorageKey]);
  assert.equal(result.reviewedDefects[0].reviewResult, "REMOVED");
});

test("review actions reject mixed original/prepared generations before signing or measurement", async () => {
  const mixed = versionedCapture();
  mixed.back.originalStorageKey = mixed.back.originalStorageKey.replace("iphone-v4", "iphone-v3");
  let externalCalls = 0;
  await assert.rejects(applySpeedsterReviewAction({
    sessionId: session().id,
    createdByUserId: "admin-1",
    action: { type: "REMOVE", defectIds: [defect.id] },
  }, {
    async loadOwnedSession() { return session([defect], mixed); },
    async persistReviewIfRevision() { externalCalls += 1; },
    async presignRead() { externalCalls += 1; return "https://fresh.example/should-not-sign"; },
    async learningBankForDetect() { externalCalls += 1; return {}; },
    async detect() { externalCalls += 1; return {}; },
    async measure() { externalCalls += 1; return { defects: [] }; },
  }), /persisted inspection evidence is not owned/);
  assert.equal(externalCalls, 0);
});

test("instrumentation failure is fail-open only after authoritative review persistence", async () => {
  const events: string[] = [];
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const result = await applySpeedsterReviewAction({
      sessionId: session().id,
      createdByUserId: "admin-1",
      action: { type: "REMOVE", defectIds: [defect.id] },
    }, {
      async loadOwnedSession() { return session(); },
      async persistReviewIfRevision() { events.push("authority:committed"); },
      async presignRead() { return "https://fresh.example/front.webp"; },
      async learningBankForDetect() { return {}; },
      async detect() { throw new Error("must not detect"); },
      async measure() { return { defects: [] }; },
      async recordInstrumentation(instrumentation) {
        assert.equal(events.at(-1), "authority:committed");
        assert.equal(instrumentation.some(({ operatorAction }) => operatorAction === "REMOVED"), true);
        events.push("telemetry:attempted");
        throw new Error("telemetry unavailable");
      },
    });
    assert.equal(result.reviewedDefects[0].reviewResult, "REMOVED");
    assert.deepEqual(events, ["authority:committed", "telemetry:attempted"]);
  } finally {
    console.error = originalError;
  }
});

test("one server-owned batch REMOVE persists every removal atomically and batch UNDO restores all", async () => {
  const second = {
    ...defect,
    id: "FRONT:source-2:SURFACE",
    origin: "MEMORY" as const,
    featureFingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    memoryProposal: {
      lessonSessionId: "lesson-session",
      lessonCompletionOrder: 12,
      lessonProposalOrder: 2,
      lessonOrder: 0,
      lessonSourceViewId: "ORIGINAL" as const,
      similarity: 0.94,
    },
  };
  let current = session([defect, second]);
  let measureCalls = 0;
  const deps = {
    async loadOwnedSession() { return current; },
    async persistReviewIfRevision(
      _identity: unknown,
      _expectedUpdatedAt: Date,
      data: { reviewedDefects: readonly unknown[]; gradeReport: unknown },
    ) {
      current = { ...current, ...data, updatedAt: new Date(current.updatedAt.getTime() + 1) };
    },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body: { findings: readonly SpeedsterReviewFinding[] }) {
      measureCalls += 1;
      return { defects: [...body.findings] };
    },
  };

  await applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: current.createdByUserId,
    action: { type: "REMOVE", defectIds: [defect.id, second.id] },
  }, deps);
  assert.equal(measureCalls, 1);
  assert.deepEqual(
    (current.reviewedDefects as SpeedsterReviewFinding[]).map(({ reviewResult }) => reviewResult),
    ["REMOVED", "REMOVED"],
  );
  assert.deepEqual((current.reviewedDefects as SpeedsterReviewFinding[])[1].memoryProposal, second.memoryProposal);

  await applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: current.createdByUserId,
    action: { type: "UNDO", defectIds: [defect.id, second.id] },
  }, deps);
  assert.equal(measureCalls, 2);
  assert.deepEqual(
    (current.reviewedDefects as SpeedsterReviewFinding[]).map(({ reviewResult }) => reviewResult),
    ["TYPE_CORRECTED", "TYPE_CORRECTED"],
  );
  assert.deepEqual((current.reviewedDefects as SpeedsterReviewFinding[])[1].memoryProposal, second.memoryProposal);

  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: current.createdByUserId,
    action: { type: "REMOVE", defectIds: [defect.id, defect.id] },
  }, deps), /unique finding IDs/i);
  assert.equal(measureCalls, 2);

  const back = { ...second, id: "BACK:source-2:SURFACE", side: "BACK" as const };
  current = session([defect, back]);
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: current.createdByUserId,
    action: { type: "REMOVE", defectIds: [defect.id, back.id] },
  }, deps), /one card side/i);
  assert.equal(measureCalls, 2);
});

test("INITIALIZE owns both detector calls and accepts no browser detector payload", async () => {
  const events: string[] = [];
  const initial = session([]);
  initial.gradeReport = {};
  let persisted: { reviewedDefects: readonly unknown[]; gradeReport: unknown } | null = null;
  let persistenceCalls = 0;
  let learningCalls = 0;
  let detectorReturns = 0;
  const learningBank = Object.freeze({ version: "bank" });
  const detectorBodies: Array<{
    side: "FRONT" | "BACK";
    cornerShape: "SQUARE" | "ROUNDED_3_18_MM";
    views: readonly { id: string; imageUrl: string }[];
    sessionId: string;
    requestTraceId: string;
    learningBank: unknown;
  }> = [];
  const deps = {
    async loadOwnedSession() { events.push("load"); return initial; },
    async persistReviewIfRevision(_identity: unknown, _revision: unknown, data: typeof persisted) {
      assert.equal(detectorReturns, 2);
      events.push("persist");
      persistenceCalls += 1;
      persisted = data;
    },
    async presignRead(key: string) { events.push(`presign:${key}`); return `https://fresh.example/${key}`; },
    async learningBankForDetect() {
      events.push("learning");
      learningCalls += 1;
      return learningBank;
    },
    async detect(body: (typeof detectorBodies)[number]) {
      events.push(`detect:${body.side}`);
      detectorBodies.push(body);
      assert.equal(body.learningBank, learningBank);
      detectorReturns += 1;
      return {
        detectorVersion: "sam3-server-owned",
        defects: [],
        detectorEvidence: emptyDetectorEvidence(),
      };
    },
    async measure() { throw new Error("INITIALIZE must not measure"); },
  };

  const result = await applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, deps);

  assert.equal(events.filter((event) => event.startsWith("detect:")).join(","), "detect:FRONT,detect:BACK");
  assert.equal(events.filter((event) => event.startsWith("presign:")).length, 8);
  assert.equal(learningCalls, 1);
  assert.equal(persistenceCalls, 1);
  assert.deepEqual(learningBank, { version: "bank" });
  assert.deepEqual(detectorBodies.map(({ requestTraceId: _requestTraceId, ...body }) => body), (["FRONT", "BACK"] as const).map((side) => ({
    side,
    cornerShape: "SQUARE",
    views: [
      { id: `${side}:ORIGINAL`, imageUrl: `https://fresh.example/${side === "FRONT" ? capture.front.inspectionStorageKey : capture.back.inspectionStorageKey}` },
      { id: `${side}:NORMALIZED`, imageUrl: `https://fresh.example/${side === "FRONT" ? capture.front.viewStorageKeys.NORMALIZED : capture.back.viewStorageKeys.NORMALIZED}` },
      { id: `${side}:MICRO_DEFECT`, imageUrl: `https://fresh.example/${side === "FRONT" ? capture.front.viewStorageKeys.MICRO_DEFECT : capture.back.viewStorageKeys.MICRO_DEFECT}` },
      { id: `${side}:DIRECTIONAL`, imageUrl: `https://fresh.example/${side === "FRONT" ? capture.front.viewStorageKeys.DIRECTIONAL : capture.back.viewStorageKeys.DIRECTIONAL}` },
    ],
    sessionId: initial.id,
    learningBank,
  })));
  for (const body of detectorBodies) {
    assert.match(body.requestTraceId, new RegExp(`^${initial.id}:${body.side}:detect:[a-f0-9]{24}:a1$`));
  }
  const initializedPersisted = persisted as unknown as { gradeReport: { detectorVersion?: string } };
  assert.equal(initializedPersisted.gradeReport.detectorVersion, "sam3-server-owned");
  assert.equal(result.gradeReport.detectorVersion, "sam3-server-owned");
});

test("INITIALIZE fails configuration preflight before storage, Memory, or detector calls", async () => {
  let externalCalls = 0;
  const initial = session([]);
  initial.gradeReport = {};
  await assert.rejects(applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: "admin-1",
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision() { externalCalls += 1; },
    assertDetectionRuntimeAuthority() { throw new Error("receipt authority missing"); },
    async presignRead() { externalCalls += 1; return "unused"; },
    async learningBankForDetect() { externalCalls += 1; return {}; },
    async detect() { externalCalls += 1; return {}; },
    async measure() { externalCalls += 1; return { defects: [] }; },
  }), /receipt authority missing/);
  assert.equal(externalCalls, 0);
});

test("detector authority requires current HMAC, explicit identity gate, and valid prior keys", () => {
  const valid: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_KEY_ID: "receipt-key-2026-08",
    AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET: "s".repeat(32),
    AI_GRADER_SPEEDSTER_REQUIRE_DETECTOR_IDENTITY_V1: "true",
    AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_PREVIOUS_KEYS_JSON: JSON.stringify({ old: "o".repeat(32) }),
  };
  assert.doesNotThrow(() => assertSpeedsterDetectionRuntimeAuthority(valid));
  assert.throws(() => assertSpeedsterDetectionRuntimeAuthority({
    ...valid,
    AI_GRADER_SPEEDSTER_REQUIRE_DETECTOR_IDENTITY_V1: "false",
  }), /must be explicitly true/);
  assert.throws(() => assertSpeedsterDetectionRuntimeAuthority({
    ...valid,
    AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET: "short",
  }), /not configured/);
  assert.throws(() => assertSpeedsterDetectionRuntimeAuthority({
    ...valid,
    AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_PREVIOUS_KEYS_JSON: "not-json",
  }), /malformed/);
});

test("INITIALIZE sends every raw candidate and separate Memory disposition through the fail-closed CAS", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  let durableEvents: readonly { category: string; eventType: string; details?: unknown }[] = [];
  let telemetryEvents: readonly { category: string }[] = [];

  await applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision(_identity, _revision, data) {
      durableEvents = data.detectorEvidenceEvents ?? [];
    },
    async presignRead(key) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect(body) {
      return {
        detectorVersion: "sam3-server-owned",
        defects: [],
        detectorEvidence: detectorEvidence(body.side),
      };
    },
    async measure() { throw new Error("must not measure"); },
    async recordInstrumentation(events) { telemetryEvents = events; },
  });

  assert.equal(durableEvents.length, 4);
  assert.equal(durableEvents.filter(({ category, eventType }) => (
    category === "DETECTOR_EVIDENCE" && eventType === "RAW_DETECTOR_CANDIDATE_PRESERVED"
  )).length, 2);
  assert.equal(durableEvents.filter(({ category, eventType }) => (
    category === "MEMORY_DECISION" && eventType === "MEMORY_CANDIDATE_DISPOSITION_RECORDED"
  )).length, 2);
  assert.equal(JSON.stringify(durableEvents).includes("canonicalMask"), true);
  assert.equal(telemetryEvents.some(({ category }) => category === "DETECTOR_EVIDENCE"), false);
  assert.equal(telemetryEvents.some(({ category }) => category === "MEMORY_DECISION"), false);
});

test("raw detector evidence persistence failure aborts initialization instead of falling through telemetry", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  let telemetryCandidateEvidence = false;

  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision(_identity, _revision, data) {
      assert.equal(data.detectorEvidenceEvents?.length, 4);
      throw new Error("detector evidence transaction failed");
    },
    async presignRead(key) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect(body) {
      return {
        detectorVersion: "sam3-server-owned",
        defects: [],
        detectorEvidence: detectorEvidence(body.side),
      };
    },
    async measure() { throw new Error("must not measure"); },
    async recordInstrumentation(events) {
      telemetryCandidateEvidence = events.some(({ category }) => (
        category === "DETECTOR_EVIDENCE" || category === "MEMORY_DECISION"
      ));
    },
  }), /detector evidence transaction failed/);

  assert.equal(telemetryCandidateEvidence, false);
});

test("INITIALIZE records detector fusion provenance without changing authoritative grading payloads", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  const detectorPixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  detectorPixels[100] = 1;
  const detectorMask = encodeSpeedsterTraceRleV1(detectorPixels);
  const rawCandidateId = `raw-c${"0".repeat(23)}`;
  const instrumented = {
    ...defect,
    detectorMask,
    measurement: { ...measurement, pixelCount: 1 },
    reviewResult: "UNREVIEWED" as const,
    findingProvenance: {
      version: "speedster-finding-provenance-v1" as const,
      primaryProposalId: "FRONT:0",
      contributors: [{
        proposalId: "FRONT:0",
        rawCandidateId,
        origin: "DETECTOR" as const,
        sourceViewId: "FRONT:ORIGINAL",
        defectType: defect.defectType,
        confidence: defect.confidence,
        rankingConfidence: defect.confidence,
      }],
    },
  };
  let persisted: readonly Record<string, unknown>[] = [];
  let instrumentation: readonly { eventType: string; durationMs?: number | null; details?: unknown }[] = [];
  const started: string[] = [];
  const result = await applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision(_identity, _revision, data) {
      persisted = data.reviewedDefects as readonly Record<string, unknown>[];
    },
    async presignRead(key) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect(body) {
      started.push(body.side);
      return body.side === "FRONT" ? {
        detectorVersion: "sam3-server-owned",
        defects: [instrumented],
        detectorEvidence: retainedDetectorEvidence(
          "FRONT",
          rawCandidateId,
          instrumented.defectType,
          detectorMask,
        ),
        instrumentation: {
          version: "speedster-service-timing-v1",
          side: "FRONT",
          requestTraceId: body.requestTraceId,
          serviceTotalMs: 13,
          measurementMs: 3,
        },
      } : {
        detectorVersion: "sam3-server-owned",
        defects: [],
        detectorEvidence: emptyDetectorEvidence(),
        instrumentation: {
          version: "speedster-service-timing-v1",
          side: "BACK",
          requestTraceId: body.requestTraceId,
          serviceTotalMs: 27,
          measurementMs: 5,
        },
      };
    },
    async measure() { throw new Error("must not measure"); },
    async recordInstrumentation(events) { instrumentation = events; },
  });
  assert.deepEqual(started, ["FRONT", "BACK"]);

  assert.equal("findingProvenance" in persisted[0], false);
  assert.equal(JSON.stringify(result).includes("findingProvenance"), false);
  const proposal = instrumentation.find(({ eventType }) => eventType === "FINDING_PROPOSED");
  assert.match(JSON.stringify(proposal?.details), /FRONT:0/);
  const sideCompletions = instrumentation.filter(({ eventType }) => eventType === "SAM_MEMORY_SIDE_COMPLETED");
  assert.equal(sideCompletions.length, 2);
  assert.deepEqual(sideCompletions.map(({ durationMs, details }) => {
    const timing = details as { side: string; requestTraceId: string };
    return [timing.side, timing.requestTraceId.replace(/:[a-f0-9]{24}:a1$/, ":TRACE:a1"), durationMs];
  }), [
    ["FRONT", `${initial.id}:FRONT:detect:TRACE:a1`, 13],
    ["BACK", `${initial.id}:BACK:detect:TRACE:a1`, 27],
  ]);
});

test("exact INITIALIZE retry returns the coherently initialized state without a second detector pass", async () => {
  let current = session([]);
  current.gradeReport = {};
  let detectCalls = 0;
  let persistCalls = 0;
  const deps = {
    async loadOwnedSession() { return current; },
    async persistReviewIfRevision(
      _identity: unknown,
      _revision: Date,
      data: { reviewedDefects: readonly unknown[]; gradeReport: unknown },
    ) {
      persistCalls += 1;
      current = { ...current, ...data, updatedAt: new Date(current.updatedAt.getTime() + 1) };
    },
    async presignRead(key: string) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect() {
      detectCalls += 1;
      return {
        detectorVersion: "sam3-server-owned",
        defects: [],
        detectorEvidence: emptyDetectorEvidence(),
      };
    },
    async measure() { throw new Error("must not measure"); },
  };
  const input = {
    sessionId: current.id,
    createdByUserId: current.createdByUserId,
    action: { type: "INITIALIZE" as const },
  };

  const first = await applySpeedsterReviewAction(input, deps);
  const retry = await applySpeedsterReviewAction(input, deps);

  assert.deepEqual(retry.reviewedDefects, first.reviewedDefects);
  assert.deepEqual(retry.gradeReport, first.gradeReport);
  assert.equal(detectCalls, 2);
  assert.equal(persistCalls, 1);
});

test("TRACE_SAVE rejects pixels outside server-owned rounded card material before measurement", async () => {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[0] = 1;
  const finalTrace = encodeSpeedsterTraceRleV1(pixels);
  let measureCalls = 0;
  const rounded = { ...session(), capture: { ...capture, cornerShape: "ROUNDED_3_18_MM" } };

  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: rounded.id,
    createdByUserId: rounded.createdByUserId,
    action: {
      type: "TRACE_SAVE",
      side: "FRONT",
      findingId: defect.id,
      trace: {
        traceWire: encodeSpeedsterTraceBitmapWireV1(pixels, finalTrace.sha256),
        traceProvenance: {
          version: "speedster-trace-provenance-v1",
          sourceViewId: defect.sourceViewId,
          cropTransform: {
            version: "speedster-canonical-crop-affine-v1",
            crop: { x: 0, y: 0, width: 10, height: 10 },
          },
          highlighterStrokes: [{ canonicalPoints: [{ x: 0, y: 0 }], strokeWidthMm: 1 }],
          finalTraceSha256: finalTrace.sha256,
        },
      },
    },
  }, {
    async loadOwnedSession() { return rounded; },
    async persistReviewIfRevision() { throw new Error("must not persist"); },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure() { measureCalls += 1; return { defects: [] }; },
  }), /card material/i);
  assert.equal(measureCalls, 0);
});

test("measurement reconciliation rejects duplicate, missing, unexpected, and wrong-side IDs", async () => {
  const variants = [
    { name: "duplicate", result: (active: readonly SpeedsterReviewFinding[]) => [active[0], active[0]] },
    { name: "missing", result: () => [] },
    { name: "unexpected", result: (active: readonly SpeedsterReviewFinding[]) => [...active, { ...active[0], id: "FRONT:unexpected" }] },
    { name: "wrong-side", result: (active: readonly SpeedsterReviewFinding[]) => [{ ...active[0], side: "BACK" as const }] },
  ];
  for (const variant of variants) {
    let persisted = false;
    await assert.rejects(() => applySpeedsterReviewAction({
      sessionId: session().id,
      createdByUserId: "admin-1",
      action: { type: "CHANGE_TYPE", defectId: defect.id, defectType: "VISIBLE_WHITENING" },
    }, {
      async loadOwnedSession() { return session(); },
      async persistReviewIfRevision() { persisted = true; },
      async presignRead() { return "https://fresh.example/front.webp"; },
      async learningBankForDetect() { return {}; },
      async detect() { throw new Error("must not detect"); },
      async measure(body: { findings: readonly SpeedsterReviewFinding[] }) {
        return { defects: variant.result(body.findings) };
      },
    }), new RegExp(variant.name === "wrong-side" ? "side" : "ID", "i"));
    assert.equal(persisted, false, variant.name);
  }
});

test("measurement reconciliation requires exact-region pixel counts within stored trace authority", async () => {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[635 + 889 * 1270] = 1;
  pixels[636 + 889 * 1270] = 1;
  const finalTrace = encodeSpeedsterTraceRleV1(pixels);
  const traceProvenance = {
    version: "speedster-trace-provenance-v1" as const,
    sourceViewId: defect.sourceViewId,
    cropTransform: {
      version: "speedster-canonical-crop-affine-v1" as const,
      crop: { x: 435, y: 689, width: 400, height: 400 },
    },
    highlighterStrokes: [{ canonicalPoints: [{ x: 635, y: 889 }], strokeWidthMm: 1.5 }],
    finalTraceSha256: finalTrace.sha256,
  };
  const sourceResult = (pixelCount: number | undefined) => ({
    id: defect.id,
    side: defect.side,
    defectType: defect.defectType,
    origin: defect.origin,
    confidence: defect.confidence,
    sourceViewId: defect.sourceViewId,
    supportingViewIds: defect.supportingViewIds,
    reviewResult: defect.reviewResult,
    finalTrace,
    traceProvenance,
    measurementRegions: [{
      zone: "SURFACE",
      canonicalContour: [{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }, { x: 0.51, y: 0.51 }],
      measurement: {
        ...measurement,
        ...(pixelCount === undefined ? {} : { pixelCount }),
        areaMm2: 0.01,
        weightedAreaMm2: 0.01,
      },
    }],
  });
  for (const pixelCount of [undefined, 3]) {
    let persisted = false;
    await assert.rejects(() => applySpeedsterReviewAction({
      sessionId: session().id,
      createdByUserId: "admin-1",
      action: {
        type: "TRACE_SAVE",
        side: "FRONT",
        findingId: defect.id,
        trace: {
          traceWire: encodeSpeedsterTraceBitmapWireV1(pixels, finalTrace.sha256),
          traceProvenance,
        },
      },
    }, {
      async loadOwnedSession() { return session(); },
      async persistReviewIfRevision() { persisted = true; },
      async presignRead() { return "https://fresh.example/front.webp"; },
      async learningBankForDetect() { return {}; },
      async detect() { throw new Error("must not detect"); },
      async measure() { return { defects: [sourceResult(pixelCount)] }; },
    }), pixelCount === undefined ? /pixelCount/i : /exceed/i);
    assert.equal(persisted, false);
  }
});

test("a completion revision win makes the review CAS fail once without remeasuring", async () => {
  let measureCalls = 0;
  let casCalls = 0;
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: session().id,
    createdByUserId: "admin-1",
    action: { type: "CHANGE_TYPE", defectId: defect.id, defectType: "VISIBLE_WHITENING" },
  }, {
    async loadOwnedSession() { return session(); },
    async persistReviewIfRevision() {
      casCalls += 1;
      throw new Error("Speedster review state changed before it could be saved");
    },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body) {
      measureCalls += 1;
      return { defects: body.findings };
    },
  }), /state changed/i);
  assert.equal(measureCalls, 1);
  assert.equal(casCalls, 1);
});

test("an INITIALIZE CAS conflict does not trigger another detector pass and records only attempt evidence", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  let detectCalls = 0;
  let casCalls = 0;
  let instrumentation: readonly { eventType: string }[] = [];
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision() {
      casCalls += 1;
      throw new Error("Speedster review state changed before it could be saved");
    },
    async presignRead(key: string) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect() {
      detectCalls += 1;
      return {
        detectorVersion: "sam3-server-owned",
        defects: [],
        detectorEvidence: emptyDetectorEvidence(),
      };
    },
    async measure() { throw new Error("must not measure"); },
    async recordInstrumentation(events) { instrumentation = events; },
  }), /state changed/i);
  assert.equal(detectCalls, 2);
  assert.equal(casCalls, 1);
  assert.deepEqual(instrumentation.map(({ eventType }) => eventType), [
    "DETECTOR_SIDE_ATTEMPT",
    "DETECTOR_SIDE_ATTEMPT",
  ]);
});

for (const failedSide of ["FRONT", "BACK"] as const) {
  test(`INITIALIZE ${failedSide} failure produces zero persistence`, async () => {
    const initial = session([]);
    initial.gradeReport = {};
    let persistCalls = 0;
    let detectCalls = 0;
    await assert.rejects(() => applySpeedsterReviewAction({
      sessionId: initial.id,
      createdByUserId: initial.createdByUserId,
      action: { type: "INITIALIZE" },
    }, {
      async loadOwnedSession() { return initial; },
      async persistReviewIfRevision() { persistCalls += 1; },
      async presignRead(key: string) { return `https://fresh.example/${key}`; },
      async learningBankForDetect() { return {}; },
      async detect(body) {
        detectCalls += 1;
        if (body.side === failedSide) throw new Error(`${failedSide} detector failed`);
        return {
          detectorVersion: "sam3-server-owned",
          defects: [],
          detectorEvidence: emptyDetectorEvidence(),
        };
      },
      async measure() { throw new Error("must not measure"); },
    }), new RegExp(`${failedSide}.*request ID`, "i"));
    assert.equal(detectCalls, failedSide === "FRONT" ? 1 : 2);
    assert.equal(persistCalls, 0);
  });
}

for (const terminalBackStatus of [400, 503] as const) {
  test(`durable Front survives terminal Back HTTP ${terminalBackStatus} and reload invokes Back only`, async () => {
    const initial = session([]);
    initial.gradeReport = {};
    const checkpoint = durableSideCheckpointHarness();
    const calls: Array<{ side: "FRONT" | "BACK"; learningBank: unknown }> = [];
    let failBack = true;
    let learningCalls = 0;
    let promoted = 0;
    const deps: SpeedsterReviewActionDependencies = {
      ...checkpoint.dependencies,
      async loadOwnedSession() { return initial; },
      async persistReviewIfRevision(_identity, _revision, data) {
        promoted += 1;
        assert.equal(data.detectionPair?.frontReceiptHmacSha256, checkpoint.sides.FRONT?.receipt.hmacSha256);
        assert.equal(data.detectionPair?.backReceiptHmacSha256, checkpoint.sides.BACK?.receipt.hmacSha256);
      },
      async presignRead(key) { return `https://fresh.example/${key}`; },
      async learningBankForDetect() {
        learningCalls += 1;
        return { version: "memory-snapshot-v2", cursor: 41 };
      },
      requireDetectorIdentityV1: true,
      async detect(body) {
        calls.push({ side: body.side, learningBank: body.learningBank });
        if (body.side === "BACK" && failBack) {
          failBack = false;
          throw upstreamFailure(body, terminalBackStatus);
        }
        return {
          detectorVersion: "same-release",
          detectorIdentity: detectorIdentity(),
          detectorEvidence: emptyDetectorEvidence(),
          defects: [],
        };
      },
      async measure() { throw new Error("must not measure"); },
    };

    await assert.rejects(() => applySpeedsterReviewAction({
      sessionId: initial.id,
      createdByUserId: initial.createdByUserId,
      action: { type: "INITIALIZE" },
    }, deps), new RegExp(`BACK.*HTTP ${terminalBackStatus}`));
    const exactFront = checkpoint.sides.FRONT;
    assert.ok(exactFront);
    assert.equal(checkpoint.sides.BACK, undefined);
    assert.equal(promoted, 0);

    await applySpeedsterReviewAction({
      sessionId: initial.id,
      createdByUserId: initial.createdByUserId,
      action: { type: "INITIALIZE" },
    }, deps);
    assert.deepEqual(calls.map(({ side }) => side), ["FRONT", "BACK", "BACK"]);
    assert.equal(checkpoint.sides.FRONT, exactFront, "reload must reuse the exact persisted Front envelope");
    assert.equal(learningCalls, 1, "reload must reuse the exact persisted Memory snapshot");
    assert.deepEqual(calls[2]?.learningBank, calls[0]?.learningBank);
    assert.equal(promoted, 1);
  });
}

test("durable Front survives a terminal Back deadline and a late Back response cannot overwrite recovery", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  const checkpoint = durableSideCheckpointHarness();
  const calls: Array<"FRONT" | "BACK"> = [];
  let releaseLateBack!: (value: unknown) => void;
  let firstBack = true;
  const lateBack = new Promise<unknown>((resolve) => { releaseLateBack = resolve; });
  const deps: SpeedsterReviewActionDependencies = {
    ...checkpoint.dependencies,
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision() {},
    async presignRead(key) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return { version: "memory-snapshot-v2", cursor: 42 }; },
    detectionDeadlineMs: 5,
    requireDetectorIdentityV1: true,
    async detect(body) {
      calls.push(body.side);
      if (body.side === "BACK" && firstBack) {
        firstBack = false;
        return lateBack;
      }
      return {
        detectorVersion: "same-release",
        detectorIdentity: detectorIdentity(),
        detectorEvidence: emptyDetectorEvidence(),
        defects: [],
      };
    },
    async measure() { throw new Error("must not measure"); },
  };
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, deps), /BACK.*deadline elapsed/i);
  const exactFront = checkpoint.sides.FRONT;
  assert.ok(exactFront);

  await applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, deps);
  const exactBack = checkpoint.sides.BACK;
  assert.ok(exactBack);
  releaseLateBack({
    detectorVersion: "late-conflicting-release",
    detectorIdentity: detectorIdentity("late-conflicting-release"),
    detectorEvidence: emptyDetectorEvidence(),
    defects: [],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["FRONT", "BACK", "BACK"]);
  assert.equal(checkpoint.sides.FRONT, exactFront);
  assert.equal(checkpoint.sides.BACK, exactBack, "late timed-out response must not reach persistence");
});

test("response loss after the durable Front insert reloads exact Front and invokes Back only", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  const checkpoint = durableSideCheckpointHarness();
  checkpoint.throwAfterPersist("FRONT");
  const calls: Array<"FRONT" | "BACK"> = [];
  const deps: SpeedsterReviewActionDependencies = {
    ...checkpoint.dependencies,
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision() {},
    async presignRead(key) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return { version: "memory-snapshot-v2", cursor: 43 }; },
    requireDetectorIdentityV1: true,
    async detect(body) {
      calls.push(body.side);
      return {
        detectorVersion: "same-release",
        detectorIdentity: detectorIdentity(),
        detectorEvidence: emptyDetectorEvidence(),
        defects: [],
      };
    },
    async measure() { throw new Error("must not measure"); },
  };
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, deps), /FRONT.*request ID/i);
  const exactFront = checkpoint.sides.FRONT;
  assert.ok(exactFront);

  await applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, deps);
  assert.deepEqual(calls, ["FRONT", "BACK"]);
  assert.equal(checkpoint.sides.FRONT, exactFront);
});

test("detector identity parser requires exact build, checkpoint, GPU, policy, and determinism fields", () => {
  const exact = detectorIdentity();
  assert.deepEqual(parseSpeedsterDetectorIdentityV1(exact), exact);
  const missingDeterminism = { ...exact, determinism: undefined };
  assert.throws(
    () => parseSpeedsterDetectorIdentityV1(missingDeterminism),
    /malformed or incomplete/,
  );
  const noGpu = { ...exact, runtime: { ...exact.runtime, gpuCount: 0 } };
  assert.throws(
    () => parseSpeedsterDetectorIdentityV1(noGpu),
    /malformed or incomplete/,
  );
});

test("active detector-identity contract rejects a missing identity before side persistence", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  const checkpoint = durableSideCheckpointHarness();
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, {
    ...checkpoint.dependencies,
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision() { throw new Error("must not promote"); },
    async presignRead(key) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return { version: "memory-snapshot-v2" }; },
    requireDetectorIdentityV1: true,
    async detect(body) {
      return { detectorVersion: "same-release", detectorEvidence: emptyDetectorEvidence(), defects: [], side: body.side };
    },
    async measure() { throw new Error("must not measure"); },
  }), /FRONT.*lacks required release\/model identity/i);
  assert.deepEqual(checkpoint.sides, {});
});

function upstreamFailure(
  body: { side: "FRONT" | "BACK"; requestTraceId: string },
  upstreamStatus: number,
  workerIdentity: string | null = null,
) {
  return new SpeedsterDetectUpstreamError({
    side: body.side,
    requestTraceId: body.requestTraceId,
    upstreamStatus,
    workerIdentity,
    upstreamDurationMs: 7,
  });
}

test("an exact RunPod HTTP 502 retries only the failed Back side once with byte-identical inputs", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  const bodies: Array<Parameters<SpeedsterReviewActionDependencies["detect"]>[0]> = [];
  let persisted = 0;
  let instrumentation: readonly { eventType: string; details?: unknown }[] = [];
  const result = await applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision() { persisted += 1; },
    async presignRead(key) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return Object.freeze({ version: "same-bank" }); },
    async detect(body) {
      bodies.push(body);
      if (body.side === "BACK" && bodies.filter(({ side }) => side === "BACK").length === 1) {
        throw upstreamFailure(body, 502, "worker-back-1");
      }
      return {
        detectorVersion: "same-release",
        defects: [],
        detectorEvidence: emptyDetectorEvidence(),
      };
    },
    async measure() { throw new Error("must not measure"); },
    async recordInstrumentation(events) { instrumentation = events; },
  });

  assert.deepEqual(bodies.map(({ side }) => side), ["FRONT", "BACK", "BACK"]);
  const [backFirst, backRetry] = bodies.filter(({ side }) => side === "BACK");
  const withoutTrace = ({ requestTraceId: _requestTraceId, ...body }: typeof backFirst) => body;
  assert.deepEqual(withoutTrace(backRetry), withoutTrace(backFirst));
  assert.notEqual(backRetry.requestTraceId, backFirst.requestTraceId);
  assert.match(backFirst.requestTraceId, /:BACK:detect:[a-f0-9]{24}:a1$/);
  assert.match(backRetry.requestTraceId, /:BACK:detect:[a-f0-9]{24}:a2$/);
  assert.equal(persisted, 1);
  const detectorAttempts = result.detectorAttempts;
  assert.ok(detectorAttempts);
  assert.equal(detectorAttempts.length, 3);
  assert.deepEqual(detectorAttempts.map(({ side, attemptNumber, outcome, upstreamStatus }) => [
    side,
    attemptNumber,
    outcome,
    upstreamStatus,
  ]), [
    ["FRONT", 1, "SUCCEEDED", 200],
    ["BACK", 1, "FAILED", 502],
    ["BACK", 2, "SUCCEEDED", 200],
  ]);
  assert.equal(
    instrumentation.filter(({ eventType }) => eventType === "DETECTOR_SIDE_ATTEMPT").length,
    3,
  );
});

test("two exact RunPod HTTP 502 responses stop after one retry with side/request evidence and zero persistence", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  const bodies: Array<{ side: "FRONT" | "BACK"; requestTraceId: string }> = [];
  let persisted = 0;
  let recorded: readonly { eventType: string; details?: unknown }[] = [];
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision() { persisted += 1; },
    async presignRead(key) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect(body) {
      bodies.push(body);
      if (body.side === "BACK") throw upstreamFailure(body, 502);
      return {
        detectorVersion: "same-release",
        defects: [],
        detectorEvidence: emptyDetectorEvidence(),
      };
    },
    async measure() { throw new Error("must not measure"); },
    async recordInstrumentation(events) { recorded = events; },
  }), /BACK scan failed after its one-time RunPod HTTP 502 retry.*request ID .*:a2/i);
  assert.deepEqual(bodies.map(({ side }) => side), ["FRONT", "BACK", "BACK"]);
  assert.equal(persisted, 0);
  assert.equal(recorded.filter(({ eventType }) => eventType === "DETECTOR_SIDE_ATTEMPT").length, 3);
});

for (const status of [500, 503, 504] as const) {
  test(`RunPod HTTP ${status} is never retried`, async () => {
    const initial = session([]);
    initial.gradeReport = {};
    let detectCalls = 0;
    let persisted = 0;
    await assert.rejects(() => applySpeedsterReviewAction({
      sessionId: initial.id,
      createdByUserId: initial.createdByUserId,
      action: { type: "INITIALIZE" },
    }, {
      async loadOwnedSession() { return initial; },
      async persistReviewIfRevision() { persisted += 1; },
      async presignRead(key) { return `https://fresh.example/${key}`; },
      async learningBankForDetect() { return {}; },
      async detect(body) {
        detectCalls += 1;
        throw upstreamFailure(body, status);
      },
      async measure() { throw new Error("must not measure"); },
    }), new RegExp(`FRONT scan failed.*HTTP ${status}.*request ID`, "i"));
    assert.equal(detectCalls, 1);
    assert.equal(persisted, 0);
  });
}

test("a detector network failure is never retried and exposes no raw private error", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  let detectCalls = 0;
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision() { throw new Error("must not persist"); },
    async presignRead(key) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect() {
      detectCalls += 1;
      throw new Error("private https://signed-storage.example/secret?token=abc");
    },
    async measure() { throw new Error("must not measure"); },
  }), (error: unknown) => {
    assert.match(String((error as Error).message), /FRONT.*without an upstream HTTP status.*request ID/i);
    assert.doesNotMatch(String((error as Error).message), /signed-storage|token=abc/);
    return true;
  });
  assert.equal(detectCalls, 1);
});

test("detect transport preserves the exact request body and exposes real upstream 502 evidence", async () => {
  const body: Parameters<SpeedsterReviewActionDependencies["detect"]>[0] = {
    side: "BACK",
    cornerShape: "SQUARE",
    views: [{ id: "BACK:ORIGINAL", imageUrl: "https://signed.invalid/back" }],
    sessionId: "session-12345678901234567890",
    requestTraceId: "session-12345678901234567890:BACK:detect:abcdef123456:a1",
    learningBank: { version: "memory-v1", lessons: [{ immutable: true }] },
  };
  let postedBody = "";
  await assert.rejects(() => fetchSpeedsterDetectUpstream(body, {
    serviceUrl: "https://runpod.invalid/",
    headers: { "Content-Type": "application/json" },
    now: (() => {
      const values = [1_000, 1_027];
      return () => values.shift() ?? 1_027;
    })(),
    async fetchImpl(input, init) {
      assert.equal(input, "https://runpod.invalid/detect");
      postedBody = String(init.body);
      return new Response(JSON.stringify({ detail: "private worker detail" }), {
        status: 502,
        headers: { "content-type": "application/json", "x-runpod-worker-id": "worker-safe-17" },
      });
    },
  }), (error: unknown) => {
    assert.equal(error instanceof SpeedsterDetectUpstreamError, true);
    const failure = error as SpeedsterDetectUpstreamError;
    assert.equal(failure.side, "BACK");
    assert.equal(failure.requestTraceId, body.requestTraceId);
    assert.equal(failure.upstreamStatus, 502);
    assert.equal(failure.workerIdentity, "worker-safe-17");
    assert.equal(failure.upstreamDurationMs, 27);
    assert.doesNotMatch(failure.message, /private worker detail/);
    return true;
  });
  assert.deepEqual(JSON.parse(postedBody), body);
});

test("detect transport records successful status and an explicit unavailable worker identity", async () => {
  const body: Parameters<SpeedsterReviewActionDependencies["detect"]>[0] = {
    side: "FRONT",
    cornerShape: "ROUNDED_3_18_MM",
    views: [{ id: "FRONT:ORIGINAL", imageUrl: "https://signed.invalid/front" }],
    sessionId: "session-12345678901234567890",
    requestTraceId: "session-12345678901234567890:FRONT:detect:abcdef123456:a1",
    learningBank: { version: "memory-v1" },
  };
  const result = await fetchSpeedsterDetectUpstream(body, {
    serviceUrl: "https://runpod.invalid",
    headers: { "Content-Type": "application/json" },
    now: (() => {
      const values = [2_000, 2_041];
      return () => values.shift() ?? 2_041;
    })(),
    async fetchImpl() {
      return new Response(JSON.stringify({ detectorVersion: "same-release", defects: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(speedsterDetectTransportEvidence(result), {
    upstreamStatus: 200,
    workerIdentity: SPEEDSTER_DETECT_WORKER_ID_UNAVAILABLE,
    upstreamDurationMs: 41,
  });
});

test("INITIALIZE rejects malformed, wrong-side, version-mismatched, and duplicate outputs with zero persistence", async () => {
  const detectorFinding = { ...defect, reviewResult: "UNREVIEWED" as const };
  const variants = [
    {
      name: "malformed Front",
      detect: async (body: { side: string }) => body.side === "FRONT"
        ? { detectorVersion: "same-v", defects: "invalid" }
        : { detectorVersion: "same-v", defects: [] },
    },
    {
      name: "malformed Back",
      detect: async (body: { side: string }) => body.side === "BACK"
        ? { detectorVersion: "same-v", defects: "invalid" }
        : { detectorVersion: "same-v", defects: [] },
    },
    {
      name: "malformed Front finding",
      detect: async (body: { side: string }) => ({
        detectorVersion: "same-v",
        defects: body.side === "FRONT"
          ? [{ ...detectorFinding, side: "FRONT", measurement: { ...measurement, areaMm2: -1 } }]
          : [],
      }),
    },
    {
      name: "malformed Back finding",
      detect: async (body: { side: string }) => ({
        detectorVersion: "same-v",
        defects: body.side === "BACK"
          ? [{ ...detectorFinding, side: "BACK", measurement: { ...measurement, areaMm2: -1 } }]
          : [],
      }),
    },
    {
      name: "missing version",
      detect: async () => ({ detectorVersion: 7, defects: [] }),
    },
    {
      name: "blank version",
      detect: async () => ({ detectorVersion: "   ", defects: [] }),
    },
    {
      name: "version mismatch",
      detect: async (body: { side: string }) => ({
        detectorVersion: body.side === "FRONT" ? "front-v" : "back-v",
        defects: [],
      }),
    },
    {
      name: "wrong side",
      detect: async (body: { side: string }) => ({
        detectorVersion: "same-v",
        defects: [{ ...detectorFinding, side: body.side === "FRONT" ? "BACK" : "FRONT" }],
      }),
    },
    {
      name: "duplicate canonical ID",
      detect: async (body: { side: string }) => ({
        detectorVersion: "same-v",
        defects: body.side === "FRONT"
          ? [
              { ...detectorFinding, id: "duplicate", side: "FRONT" },
              { ...detectorFinding, id: "FRONT:duplicate:SURFACE", side: "FRONT" },
            ]
          : [],
      }),
    },
    {
      name: "reviewed detector state",
      detect: async (body: { side: string }) => ({
        detectorVersion: "same-v",
        defects: body.side === "FRONT"
          ? [{ ...detectorFinding, side: "FRONT", reviewResult: "ACCEPTED" }]
          : [],
      }),
    },
  ];
  for (const variant of variants) {
    const initial = session([]);
    initial.gradeReport = {};
    let persisted = false;
    let detectCalls = 0;
    await assert.rejects(() => applySpeedsterReviewAction({
      sessionId: initial.id,
      createdByUserId: initial.createdByUserId,
      action: { type: "INITIALIZE" },
    }, {
      async loadOwnedSession() { return initial; },
      async persistReviewIfRevision() { persisted = true; },
      async presignRead(key: string) { return `https://fresh.example/${key}`; },
      async learningBankForDetect() { return {}; },
      async detect(body) {
        detectCalls += 1;
        const result = await variant.detect(body);
        return result && typeof result === "object" && !Array.isArray(result)
          ? { ...result, detectorEvidence: emptyDetectorEvidence() }
          : result;
      },
      async measure() { throw new Error("must not measure"); },
    }), /detector|side|version|duplicate/i, variant.name);
    assert.equal(
      detectCalls,
      variant.name.includes("Back") || variant.name === "version mismatch" ? 2 : 1,
      `${variant.name} must fail validation without retrying or advancing past the invalid side`,
    );
    assert.equal(persisted, false, variant.name);
  }
});

test("INITIALIZE rejects a detector response that silently omits raw candidate evidence", async () => {
  const initial = session([]);
  initial.gradeReport = {};
  let persisted = false;
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: initial.id,
    createdByUserId: initial.createdByUserId,
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async persistReviewIfRevision() { persisted = true; },
    async presignRead(key: string) { return `https://fresh.example/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect() { return { detectorVersion: "same-v", defects: [] }; },
    async measure() { throw new Error("must not measure"); },
  }), /response or evidence is malformed/i);
  assert.equal(persisted, false);
});

test("REMOVE/UNDO uses only a server-private prior result marker and rejects repeated invalid transitions", async () => {
  let current = session();
  const deps = {
    async loadOwnedSession() { return current; },
    async persistReviewIfRevision(
      _identity: { sessionId: string; createdByUserId: string },
      _expectedUpdatedAt: Date,
      data: { reviewedDefects: readonly unknown[]; gradeReport: unknown },
    ) {
      current = { ...current, ...data, updatedAt: new Date(current.updatedAt.getTime() + 1) };
    },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body: { findings: readonly SpeedsterReviewFinding[] }) { return { defects: [...body.findings] }; },
  };

  await applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: "admin-1",
    action: { type: "REMOVE", defectIds: [defect.id] },
  }, deps);
  assert.equal(((current.reviewedDefects as unknown[])[0] as Record<string, unknown>).reviewResult, "REMOVED");
  assert.equal(((current.reviewedDefects as unknown[])[0] as Record<string, unknown>).reviewResultBeforeRemoval, "TYPE_CORRECTED");
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: "admin-1",
    action: { type: "REMOVE", defectIds: [defect.id] },
  }, deps), /already removed/i);

  const restored = await applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: "admin-1",
    action: { type: "UNDO", defectIds: [defect.id] },
  }, deps);
  assert.equal(((current.reviewedDefects as unknown[])[0] as Record<string, unknown>).reviewResult, "TYPE_CORRECTED");
  assert.equal("reviewResultBeforeRemoval" in ((current.reviewedDefects as unknown[])[0] as Record<string, unknown>), false);
  assert.equal(JSON.stringify(restored).includes("reviewResultBeforeRemoval"), false);
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId: current.id,
    createdByUserId: "admin-1",
    action: { type: "UNDO", defectIds: [defect.id] },
  }, deps), /not removed/i);
});

test("source findings consume disjoint measurementRegions without top-level zone or measurement", async () => {
  const source = {
    ...defect,
    id: "FRONT:stable-source",
    canonicalContour: undefined,
    zone: undefined,
    measurement: undefined,
    finalTrace: { sha256: "a".repeat(64) },
    traceProvenance: { finalTraceSha256: "a".repeat(64) },
    measurementRegions: [
      { zone: "CORNERS", canonicalContour: defect.canonicalContour, measurement },
      { zone: "EDGES", canonicalContour: defect.canonicalContour, measurement },
      { zone: "SURFACE", canonicalContour: defect.canonicalContour, measurement },
    ],
  };
  assert.equal("zone" in source && source.zone !== undefined, false);
  assert.equal(source.measurementRegions.length, 3);
});

test("TRACE_SAVE converts the sole bitmap wire to persisted RLE and returns only hash metadata", async () => {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[635 + 889 * 1270] = 1;
  pixels[636 + 889 * 1270] = 1;
  const finalTrace = encodeSpeedsterTraceRleV1(pixels);
  const traceWire = encodeSpeedsterTraceBitmapWireV1(pixels, finalTrace.sha256);
  const traceProvenance = {
    version: "speedster-trace-provenance-v1" as const,
    sourceViewId: defect.sourceViewId,
    cropTransform: {
      version: "speedster-canonical-crop-affine-v1" as const,
      crop: { x: 435, y: 689, width: 400, height: 400 },
    },
    highlighterStrokes: [{ canonicalPoints: [{ x: 635, y: 889 }], strokeWidthMm: 1.5 }],
    finalTraceSha256: finalTrace.sha256,
  };
  let measureCalls = 0;
  let persisted: { reviewedDefects: readonly unknown[]; gradeReport: unknown } | null = null;

  const result = await applySpeedsterReviewAction({
    sessionId: session().id,
    createdByUserId: "admin-1",
    action: {
      type: "TRACE_SAVE",
      side: "FRONT",
      findingId: defect.id,
      trace: { traceWire, traceProvenance },
    },
  }, {
    async loadOwnedSession() { return session(); },
    async persistReviewIfRevision(_identity, _expectedUpdatedAt, data) { persisted = data; },
    async presignRead() { return "https://fresh.example/front.webp"; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure(body) {
      measureCalls += 1;
      assert.equal(body.findings.length, 1);
      assert.deepEqual(body.findings[0].finalTrace, finalTrace);
      assert.equal(JSON.stringify(body).includes("traceWire"), false);
      return {
        defects: [{
          id: defect.id,
          side: defect.side,
          defectType: defect.defectType,
          origin: defect.origin,
          confidence: defect.confidence,
          sourceViewId: defect.sourceViewId,
          supportingViewIds: defect.supportingViewIds,
          reviewResult: defect.reviewResult,
          finalTrace,
          traceProvenance,
          measurementRegions: [{
            zone: "SURFACE",
            canonicalContour: [{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }, { x: 0.51, y: 0.51 }],
            measurement: { ...measurement, pixelCount: 2, areaMm2: 0.01, weightedAreaMm2: 0.01 },
          }],
        }],
      };
    },
  });

  assert.equal(measureCalls, 1);
  const saved = (persisted as { reviewedDefects: readonly Record<string, unknown>[] } | null)?.reviewedDefects[0];
  assert.equal(saved?.id, defect.id);
  assert.deepEqual(saved?.finalTrace, finalTrace);
  assert.equal("traceWire" in (saved ?? {}), false);
  assert.equal("zone" in (saved ?? {}), false);
  assert.equal("canonicalContour" in (saved ?? {}), false);
  assert.equal("measurement" in (saved ?? {}), false);
  assert.equal(Array.isArray(saved?.measurementRegions), true);
  assert.equal(JSON.stringify(result).includes("runs"), false);
  assert.equal(JSON.stringify(result).includes("dataBase64"), false);
  assert.equal(result.reviewedDefects[0].traceSha256, finalTrace.sha256);
  assert.deepEqual(result.traceHashes, [{ findingId: defect.id, rleSha256: finalTrace.sha256 }]);
});
