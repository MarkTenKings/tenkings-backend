import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

import type { SpeedsterMeasuredDefect } from "../lib/ai-grader-v2/contracts";
import {
  SPEEDSTER_TRACE_PIXEL_COUNT,
  encodeSpeedsterTraceRleV1,
} from "../lib/ai-grader-v2/trace-codec";
import {
  speedsterCardMapApplicationEvent,
  speedsterFilterRemovedEvents,
  speedsterFilterRestoredEvent,
  speedsterFindingActionEvents,
  speedsterFindingFinalEvents,
  speedsterFindingProposalEvents,
  speedsterMapRegistrationAttemptEvent,
  speedsterMemoryLessonKey,
  speedsterMemoryLessonScanVerdictsEvent,
  SPEEDSTER_MEMORY_LESSON_SCAN_LEDGER_MAX_BYTES,
  insertSpeedsterInstrumentationEventWithConflictDetection,
  SpeedsterInstrumentationConflictError,
  type SpeedsterInstrumentationEvent,
} from "../lib/server/aiGraderV2Instrumentation";
import { createSpeedsterInstrumentationHandler } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]/instrumentation";

const memoryFinding = {
  id: "FRONT:memory-1:SURFACE",
  side: "FRONT",
  zone: "SURFACE",
  defectType: "LIGHT_SCRATCH_SCUFF",
  detectedDefectType: "FAINT_COLOR_VARIATION",
  origin: "MEMORY",
  confidence: 0.91,
  canonicalContour: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.3 }],
  sourceViewId: "FRONT:ORIGINAL",
  supportingViewIds: ["FRONT:DIRECTIONAL"],
  reviewResult: "UNREVIEWED",
  measurement: {
    widthMm: 1,
    heightMm: 2,
    areaMm2: 2,
    zonePercent: 0.2,
    multiplier: 1,
    weightedAreaMm2: 2,
    subgradeEffect: 0.1,
  },
  memoryProposal: {
    lessonSessionId: "lesson-session-1",
    lessonCompletionOrder: 42,
    lessonProposalOrder: 3,
    lessonOrder: 1,
    lessonSourceViewId: "ORIGINAL",
    similarity: 0.947,
  },
  findingProvenance: {
    version: "speedster-finding-provenance-v1",
    primaryProposalId: "FRONT:4",
    contributors: [{
      proposalId: "FRONT:4",
      origin: "MEMORY",
      sourceViewId: "FRONT:ORIGINAL",
      defectType: "LIGHT_SCRATCH_SCUFF",
      confidence: 0.91,
      rankingConfidence: 0.947,
      memoryProposal: {
        lessonSessionId: "lesson-session-1",
        lessonCompletionOrder: 42,
        lessonProposalOrder: 3,
        lessonOrder: 1,
        lessonSourceViewId: "ORIGINAL",
        similarity: 0.947,
      },
    }],
  },
} as SpeedsterMeasuredDefect;

test("proposal telemetry preserves exact Memory provenance and measurement", () => {
  const [event] = speedsterFindingProposalEvents({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    findings: [memoryFinding],
    startedAt: new Date("2026-08-09T12:00:00.000Z"),
    endedAt: new Date("2026-08-09T12:00:02.000Z"),
  });

  assert.equal(event.origin, "MEMORY");
  assert.equal(event.similarity, 0.947);
  assert.deepEqual(event.generatingExemplar, {
    lessonSessionId: "lesson-session-1",
    lessonCompletionOrder: 42,
    lessonProposalOrder: 3,
    lessonOrder: 1,
    lessonSourceViewId: "ORIGINAL",
  });
  const details = event.details as { after: { contributors: unknown[]; regions: unknown[] } };
  assert.equal(details.after.contributors.length, 1);
  assert.equal(details.after.regions.length, 1);
  assert.equal(event.durationMs, 2_000);
});

test("one immutable scan ledger accounts for every frozen-bank lesson without fingerprints", () => {
  const exemplar = {
    defectType: "VISIBLE_WHITENING" as const,
    polarity: "POSITIVE" as const,
    sessionId: "source-session-1",
    completedAt: "2026-08-20T12:00:00.000Z",
    completionOrder: 7,
    proposalOrder: 2,
    lessonOrder: 0,
    fingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    provenance: "SMART_MARK_POSITIVE" as const,
    sourceViewId: "ORIGINAL" as const,
  };
  const lessonKey = speedsterMemoryLessonKey(exemplar);
  assert.equal(
    lessonKey,
    "7b97f37dd9968fbee11bb4bb53008e3b3d6679723e546d7dfce5e89904c7dc74",
  );
  const lesson = {
    lessonKey,
    sourceSessionId: exemplar.sessionId,
    sourceCompletionOrder: exemplar.completionOrder,
    proposalOrder: exemplar.proposalOrder,
    lessonOrder: exemplar.lessonOrder,
    defectType: exemplar.defectType,
    polarity: exemplar.polarity,
    provenance: exemplar.provenance,
    sourceViewId: exemplar.sourceViewId,
  };
  const sideEvidence = (side: "FRONT" | "BACK", reasonCode: string) => ({
    version: "speedster-detector-evidence-v1" as const,
    rawCandidates: [],
    memoryDecisions: [],
    lessonVerdicts: {
      version: "speedster-memory-lesson-side-verdicts-v1" as const,
      side,
      loadedLessonCount: 1,
      verdicts: [{
        lesson,
        status: reasonCode === "NO_ELIGIBLE_RAW_CANDIDATE" ? "SKIPPED" as const : "REJECTED" as const,
        reasonCode,
        reasonCodes: [reasonCode],
        observationCount: 1,
        maxSimilarity: reasonCode === "NO_ELIGIBLE_RAW_CANDIDATE" ? null : 0.71,
        candidateIds: [],
      }],
    },
  });
  const event = speedsterMemoryLessonScanVerdictsEvent({
    sessionId: "target-session-1",
    createdByUserId: "admin-1",
    operationId: "a".repeat(24),
    memorySnapshotSha256: "b".repeat(64),
    detectorMemoryVersion: "sam-memory-v2-lesson-verdict-v1",
    memoryBank: {
      version: 2,
      fingerprintVersion: "sam3-fpn32-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543",
      capacityPerTypePolarity: 50,
      calibration: { status: "CALIBRATED", tau: 0.8, margin: 0.1 },
      replayCursor: {
        completionOrder: 7,
        sessionId: exemplar.sessionId,
        sessionDigest: "c".repeat(64),
      },
      exemplars: [exemplar],
    },
    sides: {
      FRONT: {
        requestTraceId: "target-session-1:FRONT:detect:operation:a1",
        evidence: sideEvidence("FRONT", "SMART_MARK_SIMILARITY_BELOW_THRESHOLD"),
      },
      BACK: {
        requestTraceId: "target-session-1:BACK:detect:operation:a1",
        evidence: sideEvidence("BACK", "NO_ELIGIBLE_RAW_CANDIDATE"),
      },
    },
  });

  assert.equal(event.eventType, "MEMORY_LESSON_SCAN_VERDICTS_RECORDED");
  const details = event.details as unknown as {
    loadedLessonCount: number;
    totals: Record<string, number>;
    reasonCatalog: Record<string, string>;
    lessons: Array<{ overallStatus: string; overallReasonCodes: string[] }>;
  };
  assert.equal(details.loadedLessonCount, 1);
  assert.deepEqual(details.totals, { USED: 0, REJECTED: 1, SKIPPED: 0 });
  assert.equal(details.lessons[0].overallStatus, "REJECTED");
  assert.match(
    details.reasonCatalog[details.lessons[0].overallReasonCodes[0]],
    /threshold/,
  );
  assert.equal(JSON.stringify(details).includes('"fingerprint":'), false);

  assert.throws(() => speedsterMemoryLessonScanVerdictsEvent({
    sessionId: "target-session-1",
    createdByUserId: "admin-1",
    operationId: "a".repeat(24),
    memorySnapshotSha256: "b".repeat(64),
    detectorMemoryVersion: "sam-memory-v2-lesson-verdict-v1",
    memoryBank: { version: 2 },
    sides: {
      FRONT: { requestTraceId: "front", evidence: sideEvidence("FRONT", "NO_ELIGIBLE_RAW_CANDIDATE") },
      BACK: { requestTraceId: "back", evidence: sideEvidence("BACK", "NO_ELIGIBLE_RAW_CANDIDATE") },
    },
  }), /valid frozen Memory V2 bank/);
});

test("scan ledger binds Smart Mark reuse to the exact retained Memory proposal", () => {
  const exemplar = {
    defectType: "VISIBLE_WHITENING" as const,
    polarity: "POSITIVE" as const,
    sessionId: "smart-mark-source",
    completedAt: "2026-08-20T12:00:00.000Z",
    completionOrder: 8,
    proposalOrder: 3,
    lessonOrder: 1,
    fingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    provenance: "SMART_MARK_POSITIVE" as const,
    sourceViewId: "ORIGINAL" as const,
  };
  const lessonKey = speedsterMemoryLessonKey(exemplar);
  const lesson = {
    lessonKey,
    sourceSessionId: exemplar.sessionId,
    sourceCompletionOrder: exemplar.completionOrder,
    proposalOrder: exemplar.proposalOrder,
    lessonOrder: exemplar.lessonOrder,
    defectType: exemplar.defectType,
    polarity: exemplar.polarity,
    provenance: exemplar.provenance,
    sourceViewId: exemplar.sourceViewId,
  };
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[100] = 1;
  const memoryBank = {
    version: 2,
    fingerprintVersion: "sam3-fpn32-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543",
    capacityPerTypePolarity: 50,
    calibration: { status: "CALIBRATED", tau: 0.8, margin: 0.1 },
    replayCursor: {
      completionOrder: 8,
      sessionId: exemplar.sessionId,
      sessionDigest: "c".repeat(64),
    },
    exemplars: [exemplar],
  };
  const sideEvidence = (side: "FRONT" | "BACK") => {
    const candidateId = `raw-${side === "FRONT" ? "a" : "b"}${"0".repeat(23)}`;
    return {
      version: "speedster-detector-evidence-v1" as const,
      rawCandidates: [{
        version: "speedster-raw-detector-candidate-v1" as const,
        candidateId,
        evidenceOrdinal: 0,
        sourceViewId: `${side}:ORIGINAL`,
        promptIndex: 0,
        maskIndex: 0,
        promptBox: [1, 2, 3, 4] as [number, number, number, number],
        defectType: exemplar.defectType,
        origin: "MEMORY" as const,
        rawConfidence: 0.91,
        featureFingerprint: exemplar.fingerprint,
        canonicalMask: encodeSpeedsterTraceRleV1(pixels),
        memoryProposal: {
          lessonKey,
          lessonSessionId: exemplar.sessionId,
          lessonCompletionOrder: exemplar.completionOrder,
          lessonProposalOrder: exemplar.proposalOrder,
          lessonOrder: exemplar.lessonOrder,
          lessonSourceViewId: exemplar.sourceViewId,
          similarity: 0.95,
        },
      }],
      memoryDecisions: [{
        version: "speedster-memory-decision-evidence-v1" as const,
        candidateId,
        policy: "SAM_MEMORY_V2" as const,
        action: "retained" as const,
        adjustment: 0,
        adjustedConfidence: 0.91,
        collectionThreshold: 0.5 as const,
        disposition: "RETAINED_FOR_MEASUREMENT" as const,
        diagnostic: { action: "retained", bankVersion: 2 },
      }],
      lessonVerdicts: {
        version: "speedster-memory-lesson-side-verdicts-v1" as const,
        side,
        loadedLessonCount: 1,
        verdicts: [{
          lesson,
          status: "USED" as const,
          reasonCode: "SMART_MARK_PROPOSAL_RETAINED_FOR_MEASUREMENT",
          reasonCodes: ["SMART_MARK_PROPOSAL_RETAINED_FOR_MEASUREMENT"],
          observationCount: 1,
          maxSimilarity: 0.95,
          candidateIds: [candidateId],
        }],
      },
    };
  };
  const build = (front = sideEvidence("FRONT"), back = sideEvidence("BACK")) =>
    speedsterMemoryLessonScanVerdictsEvent({
      sessionId: "target-session-2",
      createdByUserId: "admin-1",
      operationId: "d".repeat(24),
      memorySnapshotSha256: "e".repeat(64),
      detectorMemoryVersion: "sam-memory-v2-lesson-verdict-v1",
      memoryBank,
      sides: {
        FRONT: { requestTraceId: "front", evidence: front },
        BACK: { requestTraceId: "back", evidence: back },
      },
    });

  assert.equal(build().eventType, "MEMORY_LESSON_SCAN_VERDICTS_RECORDED");

  const wrongKey = structuredClone(sideEvidence("FRONT"));
  wrongKey.rawCandidates[0].memoryProposal.lessonKey = "f".repeat(64);
  assert.throws(() => build(wrongKey), /frozen Smart Mark lesson/);

  const wrongTuple = structuredClone(sideEvidence("FRONT"));
  wrongTuple.rawCandidates[0].memoryProposal.lessonSessionId = "other-source";
  assert.throws(() => build(wrongTuple), /frozen Smart Mark lesson/);

  const wrongSide = structuredClone(sideEvidence("FRONT"));
  wrongSide.rawCandidates[0].sourceViewId = "BACK:ORIGINAL";
  assert.throws(() => build(wrongSide), /frozen Smart Mark lesson/);

  const wrongOrigin = structuredClone(sideEvidence("FRONT"));
  wrongOrigin.rawCandidates[0].origin = "DETECTOR" as never;
  delete (wrongOrigin.rawCandidates[0] as { memoryProposal?: unknown }).memoryProposal;
  assert.throws(() => build(wrongOrigin), /exact retained proposal evidence/);

  const wrongDisposition = structuredClone(sideEvidence("FRONT"));
  wrongDisposition.memoryDecisions[0].disposition =
    "NOT_SELECTED_LOWER_ADJUSTED_CONFIDENCE" as never;
  assert.throws(() => build(wrongDisposition), /exact retained proposal evidence/);

  const rejectedWithCandidateReferences = structuredClone(sideEvidence("FRONT"));
  rejectedWithCandidateReferences.lessonVerdicts.verdicts[0].status = "REJECTED" as never;
  rejectedWithCandidateReferences.lessonVerdicts.verdicts[0].reasonCode =
    "SMART_MARK_PROMPT_VETOED";
  rejectedWithCandidateReferences.lessonVerdicts.verdicts[0].reasonCodes =
    ["SMART_MARK_PROMPT_VETOED"];
  assert.throws(
    () => build(rejectedWithCandidateReferences),
    /lesson verdict is malformed/,
  );
});

test("scan ledger accepts the bounded 256-candidate classifier-use ceiling", () => {
  const exemplar = {
    defectType: "VISIBLE_WHITENING" as const,
    polarity: "POSITIVE" as const,
    sessionId: "classifier-source",
    completedAt: "2026-08-20T12:00:00.000Z",
    completionOrder: 10,
    proposalOrder: 0,
    lessonOrder: 0,
    fingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
    provenance: "SMART_MARK_POSITIVE" as const,
    sourceViewId: "ORIGINAL" as const,
  };
  const lessonKey = speedsterMemoryLessonKey(exemplar);
  const lesson = {
    lessonKey,
    sourceSessionId: exemplar.sessionId,
    sourceCompletionOrder: exemplar.completionOrder,
    proposalOrder: exemplar.proposalOrder,
    lessonOrder: exemplar.lessonOrder,
    defectType: exemplar.defectType,
    polarity: exemplar.polarity,
    provenance: exemplar.provenance,
    sourceViewId: exemplar.sourceViewId,
  };
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[101] = 1;
  const canonicalMask = encodeSpeedsterTraceRleV1(pixels);
  const candidateIds = Array.from(
    { length: 256 },
    (_, index) => `raw-${index.toString(16).padStart(24, "0")}`,
  );
  const evidence = (side: "FRONT" | "BACK") => ({
    version: "speedster-detector-evidence-v1" as const,
    rawCandidates: candidateIds.map((candidateId, evidenceOrdinal) => ({
      version: "speedster-raw-detector-candidate-v1" as const,
      candidateId,
      evidenceOrdinal,
      sourceViewId: `${side}:ORIGINAL`,
      promptIndex: evidenceOrdinal,
      maskIndex: 0,
      promptBox: [1, 2, 3, 4] as [number, number, number, number],
      defectType: exemplar.defectType,
      origin: "DETECTOR" as const,
      rawConfidence: 0.91,
      featureFingerprint: exemplar.fingerprint,
      canonicalMask,
    })),
    memoryDecisions: candidateIds.map((candidateId) => ({
      version: "speedster-memory-decision-evidence-v1" as const,
      candidateId,
      policy: "SAM_MEMORY_V2" as const,
      action: "retained" as const,
      adjustment: 0,
      adjustedConfidence: 0.91,
      collectionThreshold: 0.5 as const,
      disposition: "NOT_SELECTED_LOWER_ADJUSTED_CONFIDENCE" as const,
      diagnostic: {
        action: "retained",
        gentlePositiveMatchLessonKey: lessonKey,
      },
    })),
    lessonVerdicts: {
      version: "speedster-memory-lesson-side-verdicts-v1" as const,
      side,
      loadedLessonCount: 1,
      verdicts: [{
        lesson,
        status: "USED" as const,
        reasonCode: "CLASSIFIER_GENTLE_POSITIVE_MAX",
        reasonCodes: ["CLASSIFIER_GENTLE_POSITIVE_MAX"],
        observationCount: 256,
        maxSimilarity: 0.91,
        candidateIds,
      }],
    },
  });
  const event = speedsterMemoryLessonScanVerdictsEvent({
    sessionId: "target-session-used-cap",
    createdByUserId: "admin-1",
    operationId: "1".repeat(24),
    memorySnapshotSha256: "2".repeat(64),
    detectorMemoryVersion: "sam-memory-v2-lesson-verdict-v1",
    memoryBank: {
      version: 2,
      fingerprintVersion: "sam3-fpn32-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543",
      capacityPerTypePolarity: 50,
      calibration: { status: "CALIBRATED", tau: 0.8, margin: 0.1 },
      replayCursor: {
        completionOrder: 10,
        sessionId: exemplar.sessionId,
        sessionDigest: "3".repeat(64),
      },
      exemplars: [exemplar],
    },
    sides: {
      FRONT: { requestTraceId: "front", evidence: evidence("FRONT") },
      BACK: { requestTraceId: "back", evidence: evidence("BACK") },
    },
  });

  assert.equal(
    (event.details as unknown as { totals: { USED: number } }).totals.USED,
    1,
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(event.details), "utf8") <
      SPEEDSTER_MEMORY_LESSON_SCAN_LEDGER_MAX_BYTES,
  );
});

test("maximum-capacity lesson ledger stays below its one-megabyte storage budget", () => {
  const defectTypes = [
    "FAINT_COLOR_VARIATION",
    "VISIBLE_WHITENING",
    "FRAYING",
    "CHIPPING_EXPOSED_STOCK",
    "LIFTING_DEFORMATION",
    "LIGHT_SCRATCH_SCUFF",
    "VISIBLE_SCRATCH_PRINT_COATING_LOSS",
    "DENT_MATERIAL_DAMAGE",
    "PEELING_HEAVY_DAMAGE",
  ] as const;
  let completionOrder = 0;
  const exemplars = defectTypes.flatMap((defectType) =>
    (["POSITIVE", "NEGATIVE"] as const).flatMap((polarity) =>
      Array.from({ length: 50 }, () => {
        completionOrder += 1;
        return {
          defectType,
          polarity,
          sessionId: `source-${String(completionOrder).padStart(4, "0")}`,
          completedAt: "2026-08-20T12:00:00.000Z",
          completionOrder,
          proposalOrder: 0,
          lessonOrder: 0,
          fingerprint: [1, ...Array.from({ length: 31 }, () => 0)],
          provenance: polarity === "POSITIVE"
            ? "SMART_MARK_POSITIVE" as const
            : "DETECTOR_REMOVED" as const,
          sourceViewId: "ORIGINAL" as const,
        };
      }),
    ),
  );
  const verdicts = exemplars.map((exemplar) => ({
    lesson: {
      lessonKey: speedsterMemoryLessonKey(exemplar),
      sourceSessionId: exemplar.sessionId,
      sourceCompletionOrder: exemplar.completionOrder,
      proposalOrder: exemplar.proposalOrder,
      lessonOrder: exemplar.lessonOrder,
      defectType: exemplar.defectType,
      polarity: exemplar.polarity,
      provenance: exemplar.provenance,
      sourceViewId: exemplar.sourceViewId,
    },
    status: "SKIPPED" as const,
    reasonCode: "NO_ELIGIBLE_RAW_CANDIDATE",
    reasonCodes: ["NO_ELIGIBLE_RAW_CANDIDATE"],
    observationCount: 1,
    maxSimilarity: null,
    candidateIds: [],
  }));
  const evidence = (side: "FRONT" | "BACK") => ({
    version: "speedster-detector-evidence-v1" as const,
    rawCandidates: [],
    memoryDecisions: [],
    lessonVerdicts: {
      version: "speedster-memory-lesson-side-verdicts-v1" as const,
      side,
      loadedLessonCount: verdicts.length,
      verdicts,
    },
  });
  const event = speedsterMemoryLessonScanVerdictsEvent({
    sessionId: "target-session-at-capacity",
    createdByUserId: "admin-1",
    operationId: "f".repeat(24),
    memorySnapshotSha256: "a".repeat(64),
    detectorMemoryVersion: "sam-memory-v2-lesson-verdict-v1",
    memoryBank: {
      version: 2,
      fingerprintVersion: "sam3-fpn32-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543",
      capacityPerTypePolarity: 50,
      calibration: { status: "CALIBRATED", tau: 0.8, margin: 0.1 },
      replayCursor: {
        completionOrder,
        sessionId: exemplars.at(-1)!.sessionId,
        sessionDigest: "b".repeat(64),
      },
      exemplars,
    },
    sides: {
      FRONT: { requestTraceId: "front", evidence: evidence("FRONT") },
      BACK: { requestTraceId: "back", evidence: evidence("BACK") },
    },
  });

  assert.equal(verdicts.length, 900);
  assert.ok(
    Buffer.byteLength(JSON.stringify(event.details), "utf8") <
      SPEEDSTER_MEMORY_LESSON_SCAN_LEDGER_MAX_BYTES,
  );
});

test("review telemetry retains append-only operator history and final disposition", () => {
  const removed = { ...memoryFinding, reviewResult: "REMOVED" as const };
  const remove = speedsterFindingActionEvents({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    actionId: "remove-1",
    operatorAction: "REMOVED",
    before: [memoryFinding],
    after: [removed],
    findingIds: [memoryFinding.id],
    startedAt: new Date("2026-08-09T12:00:00.000Z"),
    endedAt: new Date("2026-08-09T12:00:01.000Z"),
  });
  const restored = speedsterFindingActionEvents({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    actionId: "undo-1",
    operatorAction: "KEPT",
    before: [removed],
    after: [memoryFinding],
    findingIds: [memoryFinding.id],
    startedAt: new Date("2026-08-09T12:00:02.000Z"),
    endedAt: new Date("2026-08-09T12:00:03.000Z"),
  });

  assert.deepEqual([...remove, ...restored].map(({ operatorAction }) => operatorAction), ["REMOVED", "KEPT"]);
  assert.notEqual(remove[0].eventKey, restored[0].eventKey);
  assert.equal(speedsterFindingFinalEvents({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    findings: [removed],
  })[0].operatorAction, "REMOVED");
});

test("filter telemetry keeps immutable map rationale distinct from human review actions", () => {
  const [removed] = speedsterFilterRemovedEvents({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    decisions: [{
      finding: memoryFinding,
      cardIdentity: {
        cardName: "Cubone",
        year: "1999",
        productSet: "Jungle",
        parallel: null,
        cardNumber: "50",
      },
      mapId: "map-12345678901234567890",
      mapRevisionId: "revision-123456789012345",
      zoneId: "front-artwork",
      zoneType: "PRINT_ARTWORK",
      zoneOverlap: {
        method: "candidate-contour-segment-containment-v1",
        coveredVertices: 3,
        totalVertices: 3,
        ratio: 1,
        fullyContained: true,
      },
      filterPolicyVersion: "speedster-map-filter-containment-v1",
      ruleId: "human-zone-full-contour-containment-v1",
      ruleInputs: { findingOrigin: "MEMORY", requiredCoverageRatio: 1 },
      detectorVersion: "sam3-speedster-v1",
    }],
    startedAt: new Date("2026-08-09T12:00:00.000Z"),
    endedAt: new Date("2026-08-09T12:00:01.000Z"),
  });
  const restored = speedsterFilterRestoredEvent({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    decisionId: "decision-123456789012345",
    finding: memoryFinding,
    mapId: "map-12345678901234567890",
    mapRevisionId: "revision-123456789012345",
    zoneId: "front-artwork",
    zoneType: "PRINT_ARTWORK",
    filterPolicyVersion: "speedster-map-filter-containment-v1",
    ruleId: "human-zone-full-contour-containment-v1",
    outcome: "ACTIVE_REINTRODUCED",
    sessionLifecycleState: "CAPTURED",
  });

  assert.equal(removed.category, "FILTER_ACTION");
  assert.equal(removed.operatorAction, "FILTER_REMOVED");
  assert.equal(removed.similarity, 0.947);
  assert.match(JSON.stringify(removed.details), /human-zone-full-contour-containment-v1/);
  assert.equal(restored.category, "FILTER_ACTION");
  assert.equal(restored.operatorAction, "FILTER_RESTORED");
  assert.match(JSON.stringify(restored.details), /ACTIVE_REINTRODUCED/);
});

test("card-map telemetry records trusted family scope, key, revision, and provenance without image evidence", () => {
  const applied = {
    appliedScope: "FAMILY",
    appliedMapName: "2022 Pokemon · Lost Origin · Holo",
    revision: {
      mapId: "map-12345678901234567890",
      revisionId: "revision-123456789012345",
      matchKeyHash: "a".repeat(64),
      matchKey: {
        scope: "FAMILY",
        category: "POKEMON",
        year: "2022",
        productSet: "lost origin",
        parallel: "holo",
      },
    },
    sourceProvenance: {
      sourceSessionId: "source-session-1234567890",
      sourceIdentity: {
        cardName: "Snorlax",
        year: "2022",
        productSet: "Lost Origin",
        parallel: "Holo",
        cardNumber: "143/196",
      },
    },
  } as never;
  const event = speedsterCardMapApplicationEvent({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    applied,
    selected: applied,
  });

  assert.equal(event.category, "MAP_APPLICATION");
  assert.equal(event.eventType, "CARD_MAP_APPLIED");
  assert.match(JSON.stringify(event.details), /"appliedScope":"FAMILY"/);
  assert.match(JSON.stringify(event.details), /"cardName":"Snorlax"/);
  assert.doesNotMatch(JSON.stringify(event.details), /storageKey|imageUrl|imageBase64/);
});

test("server-authored registration attempt telemetry keeps successful and failed sides truthful", () => {
  const succeeded = speedsterMapRegistrationAttemptEvent({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    requestId: "11111111-1111-4111-8111-111111111111",
    operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    attemptNumber: 1,
    trigger: "INITIAL",
    orchestrationMetadataSource: "CLIENT_REPORTED",
    mapRevisionId: "revision-123456789012345",
    currentInspectionSha256: "b".repeat(64),
    currentPhysicalQuadSha256: "c".repeat(64),
    successfulSiblingPreservedAtAttemptStart: false,
    side: "FRONT",
    mode: "AUTOMATIC",
    durationMs: 451.4,
    result: { outcome: "SUCCEEDED", mapRevisionId: "revision-123456789012345" },
  });
  const failed = speedsterMapRegistrationAttemptEvent({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    requestId: "22222222-2222-4222-8222-222222222222",
    operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    attemptNumber: 1,
    trigger: "INITIAL",
    orchestrationMetadataSource: "CLIENT_REPORTED",
    mapRevisionId: "revision-123456789012345",
    currentInspectionSha256: "d".repeat(64),
    currentPhysicalQuadSha256: "e".repeat(64),
    successfulSiblingPreservedAtAttemptStart: false,
    side: "BACK",
    mode: "AUTOMATIC",
    durationMs: 1334.2,
    result: {
      outcome: "FAILED",
      source: "PROVIDER",
      code: "PROVIDER_HTTP_402",
      httpStatus: 402,
      retryEligible: false,
    },
  });

  assert.equal(succeeded.eventKey, "session-12345678901234567890:map-registration:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:front:1");
  assert.equal(failed.eventKey, "session-12345678901234567890:map-registration:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:back:1");
  assert.deepEqual(succeeded.details, {
    side: "FRONT",
    mode: "AUTOMATIC",
    clientReportedOrchestration: {
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      attemptNumber: 1,
      trigger: "INITIAL",
      successfulSiblingPreservedAtAttemptStart: false,
    },
    requestId: "11111111-1111-4111-8111-111111111111",
    mapRevisionId: "revision-123456789012345",
    currentInspectionSha256: "b".repeat(64),
    currentPhysicalQuadSha256: "c".repeat(64),
    outcome: "SUCCEEDED",
    observedMapRevisionId: "revision-123456789012345",
  });
  assert.doesNotMatch(JSON.stringify(succeeded.details), /FAILED|errorCode|REGISTRATION_FAILED/);
  assert.deepEqual(failed.details, {
    side: "BACK",
    mode: "AUTOMATIC",
    clientReportedOrchestration: {
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      attemptNumber: 1,
      trigger: "INITIAL",
      successfulSiblingPreservedAtAttemptStart: false,
    },
    requestId: "22222222-2222-4222-8222-222222222222",
    mapRevisionId: "revision-123456789012345",
    currentInspectionSha256: "d".repeat(64),
    currentPhysicalQuadSha256: "e".repeat(64),
    outcome: "FAILED",
    errorSource: "PROVIDER",
    errorCode: "PROVIDER_HTTP_402",
    httpStatus: 402,
    retryEligible: false,
  });
});

test("strict attempt insert uses zero-update insert-or-read conflict detection", async () => {
  let insertSql = "";
  let readCount = 0;
  const event = speedsterMapRegistrationAttemptEvent({
    sessionId: "session-12345678901234567890",
    createdByUserId: "admin-1",
    requestId: "11111111-1111-4111-8111-111111111111",
    operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    attemptNumber: 2,
    trigger: "MANUAL_RETRY",
    orchestrationMetadataSource: "CLIENT_REPORTED",
    mapRevisionId: "revision-123456789012345",
    currentInspectionSha256: "b".repeat(64),
    currentPhysicalQuadSha256: "c".repeat(64),
    successfulSiblingPreservedAtAttemptStart: true,
    side: "BACK",
    mode: "AUTOMATIC",
    durationMs: 451,
    result: { outcome: "SUCCEEDED", mapRevisionId: "revision-123456789012345" },
  });
  const inserted = await insertSpeedsterInstrumentationEventWithConflictDetection({
    async $executeRaw(query) {
      insertSql = query.sql;
      return 1;
    },
    async $queryRaw<T>() {
      readCount += 1;
      return [] as unknown as T;
    },
  }, event);
  assert.equal(inserted, 1);
  assert.equal(readCount, 0, "a successful insert needs no duplicate read");
  assert.match(insertSql, /ON CONFLICT \("eventKey"\) DO NOTHING/);
  assert.doesNotMatch(insertSql, /\bDO UPDATE\b|\bUPDATE\b|\bDELETE\b/i);

  let selectSql = "";
  const duplicate = await insertSpeedsterInstrumentationEventWithConflictDetection({
    async $executeRaw() { return 0; },
    async $queryRaw<T>(query: Prisma.Sql) {
      selectSql = query.sql;
      return [{ exactMatch: true }] as unknown as T;
    },
  }, event);
  assert.equal(duplicate, 0);
  assert.match(selectSql, /FROM "AiGraderV2InstrumentationEvent"[\s\S]*WHERE "eventKey" =/);
  assert.doesNotMatch(selectSql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  for (const column of [
    "eventKey", "sessionId", "cycleId", "createdByUserId", "category", "eventType", "findingId", "origin",
    "similarity", "generatingExemplar", "operatorAction", "clientStartedAt", "clientEndedAt", "durationMs", "details",
  ]) assert.match(selectSql, new RegExp(`"${column}" IS NOT DISTINCT FROM`));

  await assert.rejects(
    insertSpeedsterInstrumentationEventWithConflictDetection({
      async $executeRaw() { return 0; },
      async $queryRaw<T>() { return [{ exactMatch: false }] as unknown as T; },
    }, event),
    (error) => error instanceof SpeedsterInstrumentationConflictError
      && error.reason === "CONFLICTING_PAYLOAD",
  );
  await assert.rejects(
    insertSpeedsterInstrumentationEventWithConflictDetection({
      async $executeRaw() { return 0; },
      async $queryRaw<T>() { return [] as unknown as T; },
    }, event),
    (error) => error instanceof SpeedsterInstrumentationConflictError
      && error.reason === "MISSING_AFTER_CONFLICT",
  );

  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const endpointSource = readFileSync(
    `${appRoot}/pages/api/admin/ai-grader-v2/sessions/[sessionId]/instrumentation.ts`,
    "utf8",
  );
  assert.match(endpointSource, /MAP_REGISTRATION_OPERATOR_DECISION[\s\S]*insertSpeedsterInstrumentationEventWithConflictDetection/);
  const liveValidatorSource = readFileSync(
    `${appRoot}/scripts/validate-speedster-instrumentation-conflicts-postgres.ts`,
    "utf8",
  );
  assert.match(liveValidatorSource, /ctid::text[\s\S]*xmin::text[\s\S]*rowHash/);
  assert.match(liveValidatorSource, /Promise\.all[\s\S]*sort\(\), \[0, 1\]/);
  assert.doesNotMatch(liveValidatorSource, /aiGraderV2InstrumentationEvent\.delete/);
});

function request(body: unknown): NextApiRequest {
  return {
    method: "POST",
    query: { sessionId: "session-12345678901234567890" },
    body,
    headers: {},
  } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown } = {};
  const res = {
    setHeader() { return this; },
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

test("client timing endpoint authenticates ownership and accepts bounded cycle data", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId, createdByUserId) {
      assert.equal(createdByUserId, "admin-1");
      return { id: sessionId };
    },
    async insertEvents(input) { events = input; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7ee",
    eventType: "NEXT_READY_RENDERED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:45.000Z",
    details: { startBasis: "FIRST_SPEEDSTER_INTERACTION", lowerBound: true, outcome: "SUCCEEDED" },
  }), result.res);

  assert.equal(result.state.status, 201);
  assert.equal(events[0].durationMs, 45_000);
  assert.equal(events[0].category, "CLIENT_TIMING");
});

test("geometry proposal timing accepts parallel side-pipeline stage durations", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async insertEvents(input) { events = input; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7ed",
    eventType: "GEOMETRY_PROPOSED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:07.000Z",
    details: {
      automaticGeometryCount: 2,
      geometryExecutionMode: "PARALLEL_SIDE_PIPELINES_V1",
      frontUploadDurationMs: 1_000,
      backUploadDurationMs: 1_500,
      frontGeometryDurationMs: 5_000,
      backGeometryDurationMs: 5_500,
    },
  }), result.res);

  assert.equal(result.state.status, 201);
  assert.equal(events[0].durationMs, 7_000);
  assert.deepEqual(events[0].details, {
    automaticGeometryCount: 2,
    geometryExecutionMode: "PARALLEL_SIDE_PIPELINES_V1",
    frontUploadDurationMs: 1_000,
    backUploadDurationMs: 1_500,
    frontGeometryDurationMs: 5_000,
    backGeometryDurationMs: 5_500,
  });
});

test("geometry timing records map-assisted scope and revision for before-vs-after reporting", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async insertEvents(input) { events = input; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7ef",
    eventType: "GEOMETRY_CONFIRMED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:12.000Z",
    details: {
      side: "FRONT",
      mapAppliedScope: "FAMILY",
      mapName: "2022 Pokemon · Lost Origin · Holo",
      mapRevisionId: "revision-123456789012345",
    },
  }), result.res);

  assert.equal(result.state.status, 201);
  assert.equal(events[0].durationMs, 12_000);
  assert.deepEqual(events[0].details, {
    side: "FRONT",
    mapAppliedScope: "FAMILY",
    mapName: "2022 Pokemon · Lost Origin · Holo",
    mapRevisionId: "revision-123456789012345",
  });
});

test("geometry timing retains a maximum-length valid exact map display name", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async insertEvents(input) { events = input; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();
  const mapName = "x".repeat(864);

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7f1",
    eventType: "GEOMETRY_CONFIRMED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:12.000Z",
    details: {
      side: "FRONT",
      mapAppliedScope: "EXACT",
      mapName,
      mapRevisionId: "revision-123456789012345",
    },
  }), result.res);

  assert.equal(result.state.status, 201);
  assert.equal((events[0].details as { mapName: string }).mapName, mapName);
});

test("geometry timing records a map registration failure as manual without private error text", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async insertEvents(input) { events = input; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7f0",
    eventType: "GEOMETRY_CONFIRMED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:18.000Z",
    details: {
      side: "FRONT",
      mapAppliedScope: "NONE",
      mapFailureCode: "REGISTRATION_FAILED",
    },
  }), result.res);

  assert.equal(result.state.status, 201);
  assert.equal(events[0].durationMs, 18_000);
  assert.deepEqual(events[0].details, {
    side: "FRONT",
    mapAppliedScope: "NONE",
    mapFailureCode: "REGISTRATION_FAILED",
  });
});

test("client timing endpoint accepts only sanitized explicit registration decisions", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  let insertResult = 1;
  let insertFailure: Error | null = null;
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async insertEvents(input) {
      if (insertFailure) throw insertFailure;
      events = input;
      return insertResult;
    },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7f2",
    eventType: "MAP_REGISTRATION_OPERATOR_DECISION",
    clientStartedAt: "2026-08-09T12:00:18.000Z",
    clientEndedAt: "2026-08-09T12:00:18.000Z",
    details: {
      side: "BACK",
      registrationDecision: "CONTINUE_WITHOUT_CARD_MAP",
      registrationOperationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      registrationDecisionId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7f2",
      registrationFailedSides: ["BACK"],
      registrationFailures: [{
        side: "BACK",
        source: "PROVIDER",
        code: "PROVIDER_HTTP_402",
        httpStatus: 402,
        requestId: "registration-request-402",
      }],
      registrationErrorSource: "PROVIDER",
      registrationErrorCode: "PROVIDER_HTTP_402",
      registrationHttpStatus: 402,
      registrationRequestId: "registration-request-402",
    },
  }), result.res);

  assert.equal(result.state.status, 201);
  assert.deepEqual(result.state.body, { ok: true, duplicate: false });
  assert.deepEqual(events[0].details, {
    side: "BACK",
    registrationDecision: "CONTINUE_WITHOUT_CARD_MAP",
    registrationOperationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    registrationDecisionId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7f2",
    registrationFailedSides: ["BACK"],
    registrationFailures: [{
      side: "BACK",
      source: "PROVIDER",
      code: "PROVIDER_HTTP_402",
      httpStatus: 402,
      requestId: "registration-request-402",
    }],
    registrationErrorSource: "PROVIDER",
    registrationErrorCode: "PROVIDER_HTTP_402",
    registrationHttpStatus: 402,
    registrationRequestId: "registration-request-402",
  });

  insertResult = 0;
  const duplicate = response();
  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7f2",
    eventType: "MAP_REGISTRATION_OPERATOR_DECISION",
    clientStartedAt: "2026-08-09T12:00:18.000Z",
    clientEndedAt: "2026-08-09T12:00:18.000Z",
    details: events[0].details,
  }), duplicate.res);
  assert.equal(duplicate.state.status, 200);
  assert.deepEqual(duplicate.state.body, { ok: true, duplicate: true });

  insertFailure = new SpeedsterInstrumentationConflictError(
    "session-12345678901234567890:client:1c027b52-f0e8-4a97-bd0c-556a4d57d7f2",
    "CONFLICTING_PAYLOAD",
  );
  const conflict = response();
  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7f2",
    eventType: "MAP_REGISTRATION_OPERATOR_DECISION",
    clientStartedAt: "2026-08-09T12:00:18.000Z",
    clientEndedAt: "2026-08-09T12:00:18.000Z",
    details: events[0].details,
  }), conflict.res);
  assert.equal(conflict.state.status, 500);
  assert.match(
    String((conflict.state.body as { message?: string }).message),
    /Immutable Speedster instrumentation conflict \(CONFLICTING_PAYLOAD\)/,
  );

  const mismatched = response();
  await handler(request({
    eventId: "2c027b52-f0e8-4a97-bd0c-556a4d57d7f2",
    eventType: "MAP_REGISTRATION_OPERATOR_DECISION",
    clientStartedAt: "2026-08-09T12:00:18.000Z",
    clientEndedAt: "2026-08-09T12:00:18.000Z",
    details: {
      registrationDecision: "CONTINUE_WITHOUT_CARD_MAP",
      registrationOperationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      registrationDecisionId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7f2",
      registrationFailedSides: ["BACK"],
      registrationFailures: [{ side: "BACK", source: "PROVIDER", code: "PROVIDER_HTTP_409", httpStatus: 409 }],
    },
  }), mismatched.res);
  assert.equal(mismatched.state.status, 400, "a retransmission cannot change the stable decision event identity");
});

test("map-authority abandonment is append-only, stable, and cannot fabricate registration failure", async () => {
  let events: readonly SpeedsterInstrumentationEvent[] = [];
  let insertResult = 1;
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async insertEvents(input) { events = input; return insertResult; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const eventId = "3c027b52-f0e8-4a97-bd0c-556a4d57d7f2";
  const validDetails = {
    mapAuthorityDecision: "ABANDON_OBSOLETE_MAP_AUTHORITY",
    mapAuthorityOperationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    mapAuthorityDecisionId: eventId,
    mapAppliedScope: "NONE",
    obsoleteMapBindingStatus: "LOADED",
    obsoleteMapRevisionId: "obsolete-family-revision-r9",
    obsoleteMapScope: "FAMILY",
    obsoleteMapName: "2023 MEW EN Reverse Holo",
  };
  const post = async (details: Record<string, unknown>, id = eventId) => {
    const result = response();
    await handler(request({
      eventId: id,
      eventType: "MAP_AUTHORITY_OPERATOR_DECISION",
      clientStartedAt: "2026-08-09T12:00:18.000Z",
      clientEndedAt: "2026-08-09T12:00:18.000Z",
      details,
    }), result.res);
    return result.state;
  };

  const inserted = await post(validDetails);
  assert.equal(inserted.status, 201);
  assert.deepEqual(inserted.body, { ok: true, duplicate: false });
  assert.deepEqual(events[0].details, validDetails);
  assert.equal(events[0].eventKey, `session-12345678901234567890:client:${eventId}`);

  insertResult = 0;
  const duplicate = await post(validDetails);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.body, { ok: true, duplicate: true });

  for (const [name, details, id] of [
    ["fabricated failure", { ...validDetails, registrationFailedSides: ["BACK"], registrationFailures: [{ side: "BACK", source: "PROVIDER", code: "PROVIDER_HTTP_402", httpStatus: 402 }] }, eventId],
    ["mismatched identity", validDetails, "4c027b52-f0e8-4a97-bd0c-556a4d57d7f2"],
    ["loaded without revision", { ...validDetails, obsoleteMapRevisionId: undefined }, eventId],
    ["nonloaded with revision", { ...validDetails, obsoleteMapBindingStatus: "NO_MAP" }, eventId],
  ] as const) {
    const rejected = await post(details as Record<string, unknown>, id);
    assert.equal(rejected.status, 400, `${name} must fail closed`);
  }

  const noMapId = "5c027b52-f0e8-4a97-bd0c-556a4d57d7f2";
  insertResult = 1;
  const noMap = await post({
    mapAuthorityDecision: "ABANDON_OBSOLETE_MAP_AUTHORITY",
    mapAuthorityOperationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    mapAuthorityDecisionId: noMapId,
    mapAppliedScope: "NONE",
    obsoleteMapBindingStatus: "NO_MAP",
  }, noMapId);
  assert.equal(noMap.status, 201, "a factual nonloaded obsolete binding needs no invented revision");
});

test("client timing endpoint rejects secret-shaped payload fields", async () => {
  let inserts = 0;
  const handler = createSpeedsterInstrumentationHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession() { return { id: "session-12345678901234567890" }; },
    async insertEvents() { inserts += 1; return 1; },
    now: () => new Date("2026-08-09T12:01:00.000Z"),
  });
  const result = response();

  await handler(request({
    eventId: "1c027b52-f0e8-4a97-bd0c-556a4d57d7ee",
    eventType: "NEXT_READY_RENDERED",
    clientStartedAt: "2026-08-09T12:00:00.000Z",
    clientEndedAt: "2026-08-09T12:00:45.000Z",
    details: { token: "must-not-be-stored" },
  }), result.res);

  assert.equal(result.state.status, 400);
  assert.equal(inserts, 0);
});

test("instrumentation migration is additive, append-only, constrained, and session-bound", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const schema = readFileSync(`${root}/../../packages/database/prisma/schema.prisma`, "utf8");
  const migration = readFileSync(
    `${root}/../../packages/database/prisma/migrations/20260810210000_speedster_instrumentation_events/migration.sql`,
    "utf8",
  );

  assert.match(schema, /model AiGraderV2InstrumentationEvent/);
  assert.match(schema, /eventKey\s+String\s+@unique/);
  assert.match(schema, /onDelete: Restrict/);
  assert.match(migration, /'FILTER_REMOVED', 'FILTER_RESTORED'/);
  assert.match(migration, /CREATE UNIQUE INDEX/);
  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE\s+FROM)\b/im);
});
