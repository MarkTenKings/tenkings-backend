import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import type {
  SpeedsterDefectOrigin,
  SpeedsterReviewFinding,
} from "../ai-grader-v2/contracts";
import type { SpeedsterFilterDecisionEvidence } from "../ai-grader-v2/card-type-map-contracts";
import {
  parseSpeedsterDetectorEvidence,
  type SpeedsterDetectorEvidenceV1,
  type SpeedsterMemoryLessonReferenceV1,
  type SpeedsterMemoryLessonSideVerdictV1,
} from "../ai-grader-v2/detector-evidence";
import {
  parseSpeedsterLearningBankV2,
  type SpeedsterLearningExemplarV2,
} from "../ai-grader-v2/learning-v2";
import { speedsterFindingRegions } from "../ai-grader-v2/review-findings";
import type { SpeedsterAppliedMapRevision } from "./speedsterCardTypeMaps";

export type SpeedsterOperatorInstrumentationAction =
  | "KEPT"
  | "REMOVED"
  | "EDITED"
  | "RETYPED"
  | "FILTER_REMOVED"
  | "FILTER_RESTORED";

export type SpeedsterInstrumentationEvent = Readonly<{
  eventKey: string;
  sessionId: string;
  createdByUserId: string;
  category:
    | "CLIENT_TIMING"
    | "SERVER_TIMING"
    | "FINDING_PROVENANCE"
    | "FINDING_ACTION"
    | "FILTER_ACTION"
    | "MAP_APPLICATION"
    | "DETECTOR_EVIDENCE"
    | "MEMORY_DECISION"
    | "DETECTOR_CHECKPOINT";
  eventType: string;
  findingId?: string | null;
  origin?: SpeedsterDefectOrigin | null;
  similarity?: number | null;
  generatingExemplar?: Prisma.InputJsonValue | null;
  operatorAction?: SpeedsterOperatorInstrumentationAction | null;
  clientStartedAt?: Date | null;
  clientEndedAt?: Date | null;
  durationMs?: number | null;
  details?: Prisma.InputJsonValue | null;
}>;

export type SpeedsterInstrumentationWriter = {
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
};

export type SpeedsterConflictDetectingInstrumentationWriter = SpeedsterInstrumentationWriter & {
  $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T>;
};

export function speedsterCardMapApplicationEvent(input: {
  sessionId: string;
  createdByUserId: string;
  applied: SpeedsterAppliedMapRevision | null;
  selected: SpeedsterAppliedMapRevision | null;
  failureCode?: "MAP_LOOKUP_INTEGRITY_FAILED" | "MAP_REGISTRATION_NOT_APPLIED" | "MAP_AUTHORITY_HUMAN_REVIEW" | null;
}): SpeedsterInstrumentationEvent {
  const map = input.applied ?? input.selected;
  return {
    eventKey: `${input.sessionId}:card-map:${input.applied ? "applied" : "normal-review"}:${map?.revision.revisionId ?? "none"}`,
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    category: "MAP_APPLICATION",
    eventType: input.applied ? "CARD_MAP_APPLIED" : "CARD_MAP_NOT_APPLIED",
    details: {
      outcome: input.applied ? "APPLIED" : "NORMAL_HUMAN_REVIEW",
      appliedScope: input.applied?.appliedScope ?? "NONE",
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(map ? {
        selectedScope: map.appliedScope,
        mapName: map.appliedMapName,
        mapId: map.revision.mapId,
        mapRevisionId: map.revision.revisionId,
        matchKeyHash: map.revision.matchKeyHash,
        matchKey: map.revision.matchKey,
        sourceSessionId: map.sourceProvenance.sourceSessionId,
        sourceIdentity: map.sourceProvenance.sourceIdentity,
      } : {}),
    },
  };
}

type InstrumentedFinding = SpeedsterReviewFinding & {
  findingProvenance?: {
    primaryProposalId?: string;
    contributors?: readonly unknown[];
  };
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const SPEEDSTER_MEMORY_LESSON_SCAN_LEDGER_VERSION =
  "speedster-memory-lesson-scan-ledger-v1" as const;
export const SPEEDSTER_MEMORY_LESSON_SCAN_LEDGER_MAX_BYTES = 1_000_000;

export const SPEEDSTER_MEMORY_LESSON_REASON: Readonly<Record<string, string>> = {
  CLASSIFIER_GENTLE_POSITIVE_MAX: "This lesson was the closest positive example used in the confidence adjustment.",
  CLASSIFIER_EXPLICIT_POSITIVE_MARGIN_CHECK: "This approved positive lesson was used in the strong-negative margin check.",
  CLASSIFIER_EXPLICIT_POSITIVE_PROTECTION: "This approved positive lesson protected a candidate from a strong negative match.",
  CLASSIFIER_NEGATIVE_MAX: "This negative lesson was the closest example used in the Memory decision.",
  SMART_MARK_PROPOSAL_RETAINED_FOR_MEASUREMENT: "This Smart Mark lesson generated a proposal that reached final measurement.",
  NOT_SELECTED_AS_MAX_EXEMPLAR: "The lesson was compared, but another lesson was a closer match.",
  SELECTED_BUT_POLICY_BRANCH_INACTIVE: "The lesson was the closest match, but the policy branch that could use it was not active.",
  SMART_MARK_SIMILARITY_BELOW_THRESHOLD: "No material cell reached the Smart Mark lesson's proposal threshold.",
  SMART_MARK_COMPONENT_INVALID_GEOMETRY: "A matching component existed, but it did not form valid proposal geometry.",
  SMART_MARK_COMPONENT_IOU_DEDUP: "A stronger overlapping Smart Mark proposal represented the same area.",
  SMART_MARK_COMPONENT_TYPE_SIDE_CAP: "A stronger proposal used the bounded slot for this defect type and side.",
  SMART_MARK_PROMPT_NO_VALID_MASK: "The Smart Mark proposal produced no valid SAM mask inside the material area.",
  SMART_MARK_PROMPT_VETOED: "Memory vetoed the Smart Mark proposal after SAM produced a candidate mask.",
  SMART_MARK_PROMPT_BELOW_COLLECTION_THRESHOLD: "The adjusted Smart Mark proposal confidence stayed below the collection threshold.",
  SMART_MARK_PROMPT_LOWER_CONFIDENCE: "A stronger SAM mask won for the same Smart Mark prompt.",
  SMART_MARK_PROMPT_SIDE_CAP: "A stronger measured proposal used the bounded slot for this defect type and side.",
  SOURCE_VIEW_NOT_SCANNED: "The lesson's source view was not present in this side scan.",
  NO_ELIGIBLE_RAW_CANDIDATE: "This side had no candidate with the lesson's defect type and source view.",
  NO_ALLOWED_MATERIAL_CELLS: "The source view contained no allowed card-material cells for comparison.",
  FEATURE_MAP_UNAVAILABLE: "The detector could not form the feature map required to compare this lesson.",
  CANDIDATE_FINGERPRINT_UNAVAILABLE: "A matching candidate existed, but it had no valid fingerprint for lesson comparison.",
};

export function speedsterMemoryLessonKey(
  lesson: Pick<SpeedsterLearningExemplarV2,
    "sessionId" | "completionOrder" | "proposalOrder" | "lessonOrder" |
    "defectType" | "polarity" | "provenance" | "sourceViewId">,
): string {
  return createHash("sha256").update([
    "speedster-memory-lesson-v1",
    lesson.sessionId,
    String(lesson.completionOrder),
    String(lesson.proposalOrder),
    String(lesson.lessonOrder),
    lesson.defectType,
    lesson.polarity,
    lesson.provenance,
    lesson.sourceViewId,
  ].join("\0")).digest("hex");
}

function expectedLessonReference(exemplar: SpeedsterLearningExemplarV2): SpeedsterMemoryLessonReferenceV1 {
  return {
    lessonKey: speedsterMemoryLessonKey(exemplar),
    sourceSessionId: exemplar.sessionId,
    sourceCompletionOrder: exemplar.completionOrder,
    proposalOrder: exemplar.proposalOrder,
    lessonOrder: exemplar.lessonOrder,
    defectType: exemplar.defectType,
    polarity: exemplar.polarity,
    provenance: exemplar.provenance,
    sourceViewId: exemplar.sourceViewId,
  };
}

function sameLessonReference(
  actual: SpeedsterMemoryLessonReferenceV1,
  expected: SpeedsterMemoryLessonReferenceV1,
) {
  return actual.lessonKey === expected.lessonKey
    && actual.sourceSessionId === expected.sourceSessionId
    && actual.sourceCompletionOrder === expected.sourceCompletionOrder
    && actual.proposalOrder === expected.proposalOrder
    && actual.lessonOrder === expected.lessonOrder
    && actual.defectType === expected.defectType
    && actual.polarity === expected.polarity
    && actual.provenance === expected.provenance
    && actual.sourceViewId === expected.sourceViewId;
}

function findingOrigin(finding: SpeedsterReviewFinding): SpeedsterDefectOrigin {
  return finding.origin ?? "DETECTOR";
}

function generatingExemplar(finding: SpeedsterReviewFinding): Prisma.InputJsonValue | null {
  const proposal = finding.memoryProposal;
  if (!proposal) return null;
  return {
    lessonSessionId: proposal.lessonSessionId,
    lessonCompletionOrder: proposal.lessonCompletionOrder,
    lessonProposalOrder: proposal.lessonProposalOrder,
    lessonOrder: proposal.lessonOrder,
    lessonSourceViewId: proposal.lessonSourceViewId,
  };
}

function geometryBounds(points: readonly { x: number; y: number }[]) {
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
  };
}

export function speedsterFindingInstrumentationSnapshot(
  finding: SpeedsterReviewFinding,
): Prisma.InputJsonValue {
  const instrumented = finding as InstrumentedFinding;
  return {
    side: finding.side,
    sourceViewId: finding.sourceViewId,
    supportingViewIds: [...finding.supportingViewIds],
    proposedDefectType: finding.detectedDefectType ?? finding.defectType,
    finalDefectType: finding.reviewResult === "REMOVED" ? null : finding.defectType,
    reviewResult: finding.reviewResult,
    proposalOrder: typeof instrumented.findingProvenance?.primaryProposalId === "string"
      ? Number(instrumented.findingProvenance.primaryProposalId.split(":").at(-1))
      : null,
    regions: speedsterFindingRegions(finding).map((region) => ({
      zone: region.zone,
      geometryBounds: geometryBounds(region.canonicalContour),
      measurement: {
        ...(region.measurement.pixelCount !== undefined
          ? { pixelCount: region.measurement.pixelCount }
          : {}),
        widthMm: region.measurement.widthMm,
        heightMm: region.measurement.heightMm,
        areaMm2: region.measurement.areaMm2,
        zonePercent: region.measurement.zonePercent,
        multiplier: region.measurement.multiplier,
        weightedAreaMm2: region.measurement.weightedAreaMm2,
        subgradeEffect: region.measurement.subgradeEffect,
      },
    })),
    contributors: Array.isArray(instrumented.findingProvenance?.contributors)
      ? [...instrumented.findingProvenance.contributors] as Prisma.InputJsonValue
      : [],
  } as Prisma.InputJsonValue;
}

function findingEvent(input: {
  eventKey: string;
  sessionId: string;
  createdByUserId: string;
  eventType: string;
  finding: SpeedsterReviewFinding;
  operatorAction?: SpeedsterOperatorInstrumentationAction | null;
  startedAt?: Date;
  endedAt?: Date;
  before?: SpeedsterReviewFinding | null;
}): SpeedsterInstrumentationEvent {
  return {
    eventKey: input.eventKey,
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    category: input.operatorAction ? "FINDING_ACTION" : "FINDING_PROVENANCE",
    eventType: input.eventType,
    findingId: input.finding.id,
    origin: findingOrigin(input.finding),
    similarity: finite(input.finding.memoryProposal?.similarity)
      ? input.finding.memoryProposal.similarity
      : null,
    generatingExemplar: generatingExemplar(input.finding),
    operatorAction: input.operatorAction ?? null,
    clientStartedAt: null,
    clientEndedAt: null,
    durationMs: input.startedAt && input.endedAt
      ? Math.max(0, input.endedAt.getTime() - input.startedAt.getTime())
      : null,
    details: {
      after: speedsterFindingInstrumentationSnapshot(input.finding),
      ...(input.before ? { before: speedsterFindingInstrumentationSnapshot(input.before) } : {}),
    },
  };
}

export function speedsterFindingProposalEvents(input: {
  sessionId: string;
  createdByUserId: string;
  findings: readonly SpeedsterReviewFinding[];
  startedAt: Date;
  endedAt: Date;
}): SpeedsterInstrumentationEvent[] {
  return input.findings.map((finding) => findingEvent({
    eventKey: `${input.sessionId}:finding-proposed:${finding.id}`,
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    eventType: "FINDING_PROPOSED",
    finding,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  }));
}

export function speedsterDetectorEvidenceEvents(input: {
  sessionId: string;
  createdByUserId: string;
  operationId: string;
  requestTraceId: string;
  detectorVersion: string;
  evidence: SpeedsterDetectorEvidenceV1;
}): SpeedsterInstrumentationEvent[] {
  const rawById = new Map(input.evidence.rawCandidates.map((candidate) => [candidate.candidateId, candidate]));
  return [
    ...input.evidence.rawCandidates.map((candidate): SpeedsterInstrumentationEvent => ({
      eventKey: `${input.sessionId}:raw-detector-candidate:${input.operationId}:${candidate.candidateId}`,
      sessionId: input.sessionId,
      createdByUserId: input.createdByUserId,
      category: "DETECTOR_EVIDENCE",
      eventType: "RAW_DETECTOR_CANDIDATE_PRESERVED",
      origin: candidate.origin,
      similarity: candidate.memoryProposal?.similarity ?? null,
      generatingExemplar: candidate.memoryProposal
        ? candidate.memoryProposal as Prisma.InputJsonValue
        : null,
      details: {
        requestTraceId: input.requestTraceId,
        detectorVersion: input.detectorVersion,
        candidate: candidate as unknown as Prisma.InputJsonValue,
      },
    })),
    ...input.evidence.memoryDecisions.map((decision): SpeedsterInstrumentationEvent => {
      const candidate = rawById.get(decision.candidateId);
      if (!candidate) throw new Error("Speedster Memory decision lost its raw candidate authority.");
      return {
        eventKey: `${input.sessionId}:memory-decision:${input.operationId}:${decision.candidateId}`,
        sessionId: input.sessionId,
        createdByUserId: input.createdByUserId,
        category: "MEMORY_DECISION",
        eventType: "MEMORY_CANDIDATE_DISPOSITION_RECORDED",
        origin: candidate.origin,
        similarity: candidate.memoryProposal?.similarity ?? null,
        generatingExemplar: candidate.memoryProposal
          ? candidate.memoryProposal as Prisma.InputJsonValue
          : null,
        details: {
          requestTraceId: input.requestTraceId,
          detectorVersion: input.detectorVersion,
          rawCandidateId: decision.candidateId,
          rawMaskSha256: candidate.canonicalMask.sha256,
          decision: decision as unknown as Prisma.InputJsonValue,
        },
      };
    }),
  ];
}

function validatedLessonVerdicts(
  side: "FRONT" | "BACK",
  evidence: SpeedsterDetectorEvidenceV1,
  expected: readonly SpeedsterMemoryLessonReferenceV1[],
) {
  const ledger = evidence.lessonVerdicts;
  if (!ledger || ledger.side !== side || ledger.loadedLessonCount !== expected.length) {
    throw new Error(`Speedster ${side} lesson verdict coverage is incomplete.`);
  }
  const byKey = new Map(ledger.verdicts.map((verdict) => [verdict.lesson.lessonKey, verdict]));
  if (byKey.size !== expected.length) {
    throw new Error(`Speedster ${side} lesson verdict coverage is duplicated.`);
  }
  for (const lesson of expected) {
    const verdict = byKey.get(lesson.lessonKey);
    if (!verdict || !sameLessonReference(verdict.lesson, lesson)) {
      throw new Error(`Speedster ${side} lesson verdict does not match the frozen bank snapshot.`);
    }
  }
  return byKey;
}

function validateLessonCandidateLinkage(
  side: "FRONT" | "BACK",
  evidence: SpeedsterDetectorEvidenceV1,
  expectedByKey: ReadonlyMap<string, SpeedsterMemoryLessonReferenceV1>,
  verdictByKey: ReadonlyMap<string, SpeedsterMemoryLessonSideVerdictV1>,
) {
  const rawById = new Map(evidence.rawCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const decisionById = new Map(evidence.memoryDecisions.map((decision) => [decision.candidateId, decision]));
  for (const candidate of evidence.rawCandidates) {
    if (candidate.origin !== "MEMORY") continue;
    const proposal = candidate.memoryProposal;
    const lesson = proposal?.lessonKey ? expectedByKey.get(proposal.lessonKey) : undefined;
    if (
      !proposal?.lessonKey || !lesson || lesson.polarity !== "POSITIVE" ||
      lesson.provenance !== "SMART_MARK_POSITIVE" ||
      proposal.lessonSessionId !== lesson.sourceSessionId ||
      proposal.lessonCompletionOrder !== lesson.sourceCompletionOrder ||
      proposal.lessonProposalOrder !== lesson.proposalOrder ||
      proposal.lessonOrder !== lesson.lessonOrder ||
      proposal.lessonSourceViewId !== lesson.sourceViewId ||
      candidate.defectType !== lesson.defectType ||
      candidate.sourceViewId !== `${side}:${lesson.sourceViewId}`
    ) throw new Error("Speedster Memory proposal does not match its frozen Smart Mark lesson.");
    const decision = decisionById.get(candidate.candidateId);
    if (decision?.disposition === "RETAINED_FOR_MEASUREMENT") {
      const verdict = verdictByKey.get(lesson.lessonKey);
      if (
        verdict?.status !== "USED" ||
        !verdict.reasonCodes.includes("SMART_MARK_PROPOSAL_RETAINED_FOR_MEASUREMENT") ||
        !verdict.candidateIds.includes(candidate.candidateId)
      ) throw new Error("Retained Speedster Memory proposal is not bound to its lesson verdict.");
    }
  }

  const classifierDiagnosticKey = new Map([
    ["CLASSIFIER_GENTLE_POSITIVE_MAX", "gentlePositiveMatchLessonKey"],
    ["CLASSIFIER_EXPLICIT_POSITIVE_MARGIN_CHECK", "positiveMatchLessonKey"],
    ["CLASSIFIER_EXPLICIT_POSITIVE_PROTECTION", "positiveMatchLessonKey"],
    ["CLASSIFIER_NEGATIVE_MAX", "negativeMatchLessonKey"],
  ]);
  for (const [lessonKey, verdict] of verdictByKey) {
    const lesson = expectedByKey.get(lessonKey)!;
    const linked = verdict.candidateIds.flatMap((candidateId) => {
      const candidate = rawById.get(candidateId);
      const decision = decisionById.get(candidateId);
      return candidate && decision ? [{ candidate, decision }] : [];
    });
    for (const reasonCode of verdict.reasonCodes) {
      if (reasonCode === "SMART_MARK_PROPOSAL_RETAINED_FOR_MEASUREMENT") {
        if (!linked.some(({ candidate, decision }) =>
          candidate.origin === "MEMORY" &&
          candidate.memoryProposal?.lessonKey === lessonKey &&
          decision.disposition === "RETAINED_FOR_MEASUREMENT")) {
          throw new Error("Speedster Smart Mark reuse verdict lacks exact retained proposal evidence.");
        }
        continue;
      }
      const diagnosticKey = classifierDiagnosticKey.get(reasonCode);
      if (!diagnosticKey) continue;
      const validLessonKind = reasonCode === "CLASSIFIER_NEGATIVE_MAX"
        ? lesson.polarity === "NEGATIVE"
        : lesson.polarity === "POSITIVE" && (
          reasonCode === "CLASSIFIER_GENTLE_POSITIVE_MAX" ||
          lesson.provenance !== "UNTOUCHED_ACCEPTED_POSITIVE"
        );
      if (!validLessonKind || !linked.some(({ candidate, decision }) =>
        candidate.featureFingerprint !== null &&
        candidate.defectType === lesson.defectType &&
        candidate.sourceViewId === `${side}:${lesson.sourceViewId}` &&
        decision.policy === "SAM_MEMORY_V2" &&
        decision.diagnostic?.[diagnosticKey] === lessonKey &&
        (reasonCode !== "CLASSIFIER_EXPLICIT_POSITIVE_PROTECTION" || decision.action === "protected") &&
        (reasonCode !== "CLASSIFIER_EXPLICIT_POSITIVE_MARGIN_CHECK" ||
          decision.action === "protected" || decision.action === "vetoed")
      )) throw new Error("Speedster classifier lesson verdict lacks exact decision evidence.");
    }
  }
}

function lessonVerdictProjection(verdict: SpeedsterMemoryLessonSideVerdictV1) {
  if (!SPEEDSTER_MEMORY_LESSON_REASON[verdict.reasonCode]) {
    throw new Error("Speedster Memory lesson verdict has an unknown reason.");
  }
  return {
    status: verdict.status,
    reasonCode: verdict.reasonCode,
    reasonCodes: [...verdict.reasonCodes],
    observationCount: verdict.observationCount,
    maxSimilarity: verdict.maxSimilarity,
    candidateIds: [...verdict.candidateIds],
  };
}

export function speedsterMemoryLessonScanVerdictsEvent(input: {
  sessionId: string;
  createdByUserId: string;
  operationId: string;
  memorySnapshotSha256: string;
  detectorMemoryVersion: string;
  memoryBank: unknown;
  sides: Readonly<Record<"FRONT" | "BACK", Readonly<{
    requestTraceId: string;
    evidence: SpeedsterDetectorEvidenceV1;
  }>>>;
}): SpeedsterInstrumentationEvent {
  if (!/^[a-f0-9]{64}$/.test(input.memorySnapshotSha256)) {
    throw new Error("Speedster Memory snapshot hash is malformed.");
  }
  const bank = parseSpeedsterLearningBankV2(input.memoryBank);
  if (!bank) throw new Error("Speedster lesson verdicts require one valid frozen Memory V2 bank.");
  const expected = bank.exemplars.map(expectedLessonReference);
  if (new Set(expected.map(({ lessonKey }) => lessonKey)).size !== expected.length) {
    throw new Error("Speedster frozen Memory bank contains duplicate lesson identities.");
  }
  const frontEvidence = parseSpeedsterDetectorEvidence(input.sides.FRONT.evidence);
  const backEvidence = parseSpeedsterDetectorEvidence(input.sides.BACK.evidence);
  const front = validatedLessonVerdicts("FRONT", frontEvidence, expected);
  const back = validatedLessonVerdicts("BACK", backEvidence, expected);
  const expectedByKey = new Map(expected.map((lesson) => [lesson.lessonKey, lesson]));
  validateLessonCandidateLinkage("FRONT", frontEvidence, expectedByKey, front);
  validateLessonCandidateLinkage("BACK", backEvidence, expectedByKey, back);
  const statusPriority = { SKIPPED: 0, REJECTED: 1, USED: 2 } as const;
  const totals = { USED: 0, REJECTED: 0, SKIPPED: 0 };
  const lessons = expected.map((lesson) => {
    const frontVerdict = front.get(lesson.lessonKey)!;
    const backVerdict = back.get(lesson.lessonKey)!;
    const overallStatus = statusPriority[frontVerdict.status] >= statusPriority[backVerdict.status]
      ? frontVerdict.status
      : backVerdict.status;
    totals[overallStatus] += 1;
    const overallReasonCodes = [...new Set(
      [frontVerdict, backVerdict]
        .filter(({ status }) => status === overallStatus)
        .flatMap(({ reasonCodes }) => reasonCodes),
    )].sort();
    if (overallReasonCodes.some((reasonCode) => !SPEEDSTER_MEMORY_LESSON_REASON[reasonCode])) {
      throw new Error("Speedster Memory lesson verdict has an unknown reason.");
    }
    return {
      lesson,
      sideVerdicts: {
        FRONT: lessonVerdictProjection(frontVerdict),
        BACK: lessonVerdictProjection(backVerdict),
      },
      overallStatus,
      overallReasonCodes,
    };
  });
  const details = {
    version: SPEEDSTER_MEMORY_LESSON_SCAN_LEDGER_VERSION,
    targetSessionId: input.sessionId,
    operationId: input.operationId,
    memorySnapshotSha256: input.memorySnapshotSha256,
    bankReplayCursor: bank.replayCursor,
    detectorMemoryVersion: input.detectorMemoryVersion,
    requestTraceIds: {
      FRONT: input.sides.FRONT.requestTraceId,
      BACK: input.sides.BACK.requestTraceId,
    },
    loadedLessonCount: expected.length,
    totals,
    reasonCatalog: SPEEDSTER_MEMORY_LESSON_REASON,
    lessons,
  };
  if (Buffer.byteLength(JSON.stringify(details), "utf8") >
    SPEEDSTER_MEMORY_LESSON_SCAN_LEDGER_MAX_BYTES) {
    throw new Error("Speedster Memory lesson scan ledger exceeds its storage budget.");
  }
  return {
    eventKey: `${input.sessionId}:memory-lesson-scan-verdicts:${input.operationId}`,
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    category: "MEMORY_DECISION",
    eventType: "MEMORY_LESSON_SCAN_VERDICTS_RECORDED",
    details: details as unknown as Prisma.InputJsonValue,
  };
}

export function speedsterFindingActionEvents(input: {
  sessionId: string;
  createdByUserId: string;
  actionId?: string;
  operatorAction: Exclude<SpeedsterOperatorInstrumentationAction, "FILTER_REMOVED" | "FILTER_RESTORED">;
  before: readonly SpeedsterReviewFinding[];
  after: readonly SpeedsterReviewFinding[];
  findingIds: readonly string[];
  startedAt: Date;
  endedAt: Date;
}): SpeedsterInstrumentationEvent[] {
  const actionId = input.actionId ?? randomUUID();
  return input.findingIds.flatMap((findingId) => {
    const finding = input.after.find(({ id }) => id === findingId)
      ?? input.before.find(({ id }) => id === findingId);
    if (!finding) return [];
    return [findingEvent({
      eventKey: `${input.sessionId}:finding-action:${actionId}:${findingId}`,
      sessionId: input.sessionId,
      createdByUserId: input.createdByUserId,
      eventType: "FINDING_REVIEWED",
      finding,
      before: input.before.find(({ id }) => id === findingId) ?? null,
      operatorAction: input.operatorAction,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    })];
  });
}

function terminalOperatorAction(
  finding: SpeedsterReviewFinding,
): Exclude<SpeedsterOperatorInstrumentationAction, "FILTER_REMOVED" | "FILTER_RESTORED"> {
  if (finding.reviewResult === "REMOVED") return "REMOVED";
  if (finding.reviewResult === "TYPE_CORRECTED") return "RETYPED";
  if (finding.reviewResult === "SMART_MARKED") return "EDITED";
  return "KEPT";
}

export function speedsterFindingFinalEvents(input: {
  sessionId: string;
  createdByUserId: string;
  findings: readonly SpeedsterReviewFinding[];
}): SpeedsterInstrumentationEvent[] {
  return input.findings.map((finding) => findingEvent({
    eventKey: `${input.sessionId}:finding-finalized:${finding.id}`,
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    eventType: "FINDING_FINALIZED",
    finding,
    operatorAction: terminalOperatorAction(finding),
  }));
}

export function speedsterFilterRemovedEvents(input: {
  sessionId: string;
  createdByUserId: string;
  decisions: readonly SpeedsterFilterDecisionEvidence[];
  startedAt: Date;
  endedAt: Date;
}): SpeedsterInstrumentationEvent[] {
  return input.decisions.map((decision) => ({
    eventKey: `${input.sessionId}:filter-removed:${decision.mapRevisionId}:${decision.finding.id}`,
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    category: "FILTER_ACTION",
    eventType: "MAP_FILTER_REMOVED",
    findingId: decision.finding.id,
    origin: findingOrigin(decision.finding),
    similarity: finite(decision.finding.memoryProposal?.similarity)
      ? decision.finding.memoryProposal.similarity
      : null,
    generatingExemplar: generatingExemplar(decision.finding),
    operatorAction: "FILTER_REMOVED",
    durationMs: Math.max(0, input.endedAt.getTime() - input.startedAt.getTime()),
    details: {
      finding: speedsterFindingInstrumentationSnapshot(decision.finding),
      mapId: decision.mapId,
      mapRevisionId: decision.mapRevisionId,
      zoneId: decision.zoneId,
      zoneType: decision.zoneType,
      zoneOverlap: decision.zoneOverlap,
      filterPolicyVersion: decision.filterPolicyVersion,
      ruleId: decision.ruleId,
      ruleInputs: decision.ruleInputs,
      detectorVersion: decision.detectorVersion,
    },
  }));
}

export function speedsterFilterRestoredEvent(input: {
  sessionId: string;
  createdByUserId: string;
  decisionId: string;
  finding: SpeedsterReviewFinding;
  mapId: string;
  mapRevisionId: string;
  zoneId: string;
  zoneType: string;
  filterPolicyVersion: string;
  ruleId: string;
  outcome: "ACTIVE_REINTRODUCED" | "COMPLETED_CALIBRATION_ONLY";
  sessionLifecycleState: string;
}): SpeedsterInstrumentationEvent {
  return {
    eventKey: `${input.sessionId}:filter-restored:${input.decisionId}`,
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    category: "FILTER_ACTION",
    eventType: "MAP_FILTER_RESTORED",
    findingId: input.finding.id,
    origin: findingOrigin(input.finding),
    similarity: finite(input.finding.memoryProposal?.similarity)
      ? input.finding.memoryProposal.similarity
      : null,
    generatingExemplar: generatingExemplar(input.finding),
    operatorAction: "FILTER_RESTORED",
    details: {
      finding: speedsterFindingInstrumentationSnapshot(input.finding),
      decisionId: input.decisionId,
      mapId: input.mapId,
      mapRevisionId: input.mapRevisionId,
      zoneId: input.zoneId,
      zoneType: input.zoneType,
      filterPolicyVersion: input.filterPolicyVersion,
      ruleId: input.ruleId,
      outcome: input.outcome,
      sessionLifecycleState: input.sessionLifecycleState,
    },
  };
}

export function speedsterServerTimingEvent(input: {
  eventKey: string;
  sessionId: string;
  createdByUserId: string;
  eventType: string;
  durationMs: number;
  details?: Prisma.InputJsonValue;
}): SpeedsterInstrumentationEvent {
  return {
    eventKey: input.eventKey,
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    category: "SERVER_TIMING",
    eventType: input.eventType,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    details: input.details ?? {},
  };
}

export type SpeedsterMapRegistrationAttemptOutcome =
  | Readonly<{
      outcome: "SUCCEEDED";
      mapRevisionId: string;
    }>
  | Readonly<{
      outcome: "HUMAN_CORRECTION_REQUIRED" | "FAILED";
      source: "PROVIDER_GATEWAY" | "PROVIDER" | "PROVIDER_NETWORK" | "TEN_KINGS_API";
      code: string;
      httpStatus: number | null;
      retryEligible: boolean;
    }>;

export function speedsterMapRegistrationAttemptEvent(input: Readonly<{
  sessionId: string;
  createdByUserId: string;
  requestId: string;
  operationId: string;
  attemptNumber: number;
  trigger: "INITIAL" | "AUTOMATIC_RETRY" | "MANUAL_RETRY" | "HUMAN_RESCUE";
  orchestrationMetadataSource: "CLIENT_REPORTED" | "SERVER_STALE_CLIENT_COMPATIBILITY";
  mapRevisionId: string;
  currentInspectionSha256: string;
  currentPhysicalQuadSha256: string;
  successfulSiblingPreservedAtAttemptStart: boolean;
  side: "FRONT" | "BACK";
  mode: "AUTOMATIC" | "HUMAN_RESCUE";
  durationMs: number;
  result: SpeedsterMapRegistrationAttemptOutcome;
}>): SpeedsterInstrumentationEvent {
  return speedsterServerTimingEvent({
    eventKey: `${input.sessionId}:map-registration:${input.operationId}:${input.side.toLowerCase()}:${input.attemptNumber}`,
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    eventType: "MAP_REGISTRATION_ATTEMPT",
    durationMs: input.durationMs,
    details: {
      side: input.side,
      mode: input.mode,
      ...(input.orchestrationMetadataSource === "CLIENT_REPORTED" ? {
        clientReportedOrchestration: {
          operationId: input.operationId,
          attemptNumber: input.attemptNumber,
          trigger: input.trigger,
          successfulSiblingPreservedAtAttemptStart: input.successfulSiblingPreservedAtAttemptStart,
        },
      } : {
        serverStaleClientCompatibilityOrchestration: {
          operationId: input.operationId,
          attemptNumber: input.attemptNumber,
          trigger: input.trigger,
          successfulSiblingPreservedAtAttemptStart: input.successfulSiblingPreservedAtAttemptStart,
        },
      }),
      requestId: input.requestId,
      mapRevisionId: input.mapRevisionId,
      currentInspectionSha256: input.currentInspectionSha256,
      currentPhysicalQuadSha256: input.currentPhysicalQuadSha256,
      outcome: input.result.outcome,
      ...(input.result.outcome === "SUCCEEDED"
        ? { observedMapRevisionId: input.result.mapRevisionId }
        : {
            errorSource: input.result.source,
            errorCode: input.result.code,
            httpStatus: input.result.httpStatus,
            retryEligible: input.result.retryEligible,
          }),
    },
  });
}

export class SpeedsterInstrumentationConflictError extends Error {
  constructor(
    readonly eventKey: string,
    readonly reason: "CONFLICTING_PAYLOAD" | "MISSING_AFTER_CONFLICT",
  ) {
    super(`Immutable Speedster instrumentation conflict (${reason}) for event ${eventKey}.`);
    this.name = "SpeedsterInstrumentationConflictError";
  }
}

/**
 * Registration attempts and decisions use a conflict-detecting append-only insert.
 * The first statement never updates an existing row. After an insert conflict, a
 * separate READ COMMITTED statement verifies an exact duplicate without mutation.
 */
export async function insertSpeedsterInstrumentationEventWithConflictDetection(
  writer: SpeedsterConflictDetectingInstrumentationWriter,
  event: SpeedsterInstrumentationEvent,
) {
  const generatingExemplar = event.generatingExemplar === null || event.generatingExemplar === undefined
    ? null
    : JSON.stringify(event.generatingExemplar);
  const details = event.details === null || event.details === undefined
    ? null
    : JSON.stringify(event.details);
  const inserted = await writer.$executeRaw(Prisma.sql`
    INSERT INTO "AiGraderV2InstrumentationEvent" (
      "id", "eventKey", "sessionId", "cycleId", "createdByUserId", "category", "eventType",
      "findingId", "origin", "similarity", "generatingExemplar", "operatorAction",
      "clientStartedAt", "clientEndedAt", "durationMs", "details"
    ) VALUES (
      ${randomUUID()}, ${event.eventKey}, ${event.sessionId}, ${event.sessionId},
      ${event.createdByUserId}, ${event.category}, ${event.eventType},
      ${event.findingId ?? null}, ${event.origin ?? null}, ${event.similarity ?? null},
      ${generatingExemplar}::jsonb, ${event.operatorAction ?? null},
      ${event.clientStartedAt ?? null}, ${event.clientEndedAt ?? null}, ${event.durationMs ?? null},
      ${details}::jsonb
    )
    ON CONFLICT ("eventKey") DO NOTHING
  `);
  if (inserted === 1) return 1;
  if (inserted !== 0) {
    throw new SpeedsterInstrumentationConflictError(event.eventKey, "CONFLICTING_PAYLOAD");
  }

  const existing = await writer.$queryRaw<Array<{ exactMatch: boolean }>>(Prisma.sql`
    SELECT (
      "eventKey" IS NOT DISTINCT FROM ${event.eventKey}
      AND "sessionId" IS NOT DISTINCT FROM ${event.sessionId}
      AND "cycleId" IS NOT DISTINCT FROM ${event.sessionId}
      AND "createdByUserId" IS NOT DISTINCT FROM ${event.createdByUserId}
      AND "category" IS NOT DISTINCT FROM ${event.category}
      AND "eventType" IS NOT DISTINCT FROM ${event.eventType}
      AND "findingId" IS NOT DISTINCT FROM ${event.findingId ?? null}
      AND "origin" IS NOT DISTINCT FROM ${event.origin ?? null}
      AND "similarity" IS NOT DISTINCT FROM ${event.similarity ?? null}
      AND "generatingExemplar" IS NOT DISTINCT FROM ${generatingExemplar}::jsonb
      AND "operatorAction" IS NOT DISTINCT FROM ${event.operatorAction ?? null}
      AND "clientStartedAt" IS NOT DISTINCT FROM ${event.clientStartedAt ?? null}
      AND "clientEndedAt" IS NOT DISTINCT FROM ${event.clientEndedAt ?? null}
      AND "durationMs" IS NOT DISTINCT FROM ${event.durationMs ?? null}
      AND "details" IS NOT DISTINCT FROM ${details}::jsonb
    ) AS "exactMatch"
    FROM "AiGraderV2InstrumentationEvent"
    WHERE "eventKey" = ${event.eventKey}
    LIMIT 1
  `);
  if (existing.length === 0) {
    throw new SpeedsterInstrumentationConflictError(event.eventKey, "MISSING_AFTER_CONFLICT");
  }
  if (existing.length !== 1 || existing[0].exactMatch !== true) {
    throw new SpeedsterInstrumentationConflictError(event.eventKey, "CONFLICTING_PAYLOAD");
  }
  return 0;
}

export async function insertSpeedsterInstrumentationEvents(
  writer: SpeedsterInstrumentationWriter,
  events: readonly SpeedsterInstrumentationEvent[],
) {
  if (events.length === 0) return 0;
  const rows = events.map((event) => Prisma.sql`(
    ${randomUUID()},
    ${event.eventKey},
    ${event.sessionId},
    ${event.sessionId},
    ${event.createdByUserId},
    ${event.category},
    ${event.eventType},
    ${event.findingId ?? null},
    ${event.origin ?? null},
    ${event.similarity ?? null},
    ${event.generatingExemplar === null || event.generatingExemplar === undefined
      ? null
      : JSON.stringify(event.generatingExemplar)}::jsonb,
    ${event.operatorAction ?? null},
    ${event.clientStartedAt ?? null},
    ${event.clientEndedAt ?? null},
    ${event.durationMs ?? null},
    ${event.details === null || event.details === undefined ? null : JSON.stringify(event.details)}::jsonb
  )`);
  return writer.$executeRaw(Prisma.sql`
    INSERT INTO "AiGraderV2InstrumentationEvent" (
      "id", "eventKey", "sessionId", "cycleId", "createdByUserId", "category", "eventType",
      "findingId", "origin", "similarity", "generatingExemplar", "operatorAction",
      "clientStartedAt", "clientEndedAt", "durationMs", "details"
    ) VALUES ${Prisma.join(rows)}
    ON CONFLICT ("eventKey") DO NOTHING
  `);
}
