import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import type {
  SpeedsterDefectOrigin,
  SpeedsterReviewFinding,
} from "../ai-grader-v2/contracts";
import type { SpeedsterFilterDecisionEvidence } from "../ai-grader-v2/card-type-map-contracts";
import { speedsterFindingRegions } from "../ai-grader-v2/review-findings";

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
  category: "CLIENT_TIMING" | "SERVER_TIMING" | "FINDING_PROVENANCE" | "FINDING_ACTION" | "FILTER_ACTION";
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

type InstrumentedFinding = SpeedsterReviewFinding & {
  findingProvenance?: {
    primaryProposalId?: string;
    contributors?: readonly unknown[];
  };
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

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
