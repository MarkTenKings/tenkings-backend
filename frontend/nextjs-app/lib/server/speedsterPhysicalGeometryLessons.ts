import { createHash } from "node:crypto";

import type { Prisma } from "@tenkings/database";

import {
  parseSpeedsterPhysicalGeometryLearning,
  SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION,
  type SpeedsterColorGeometryPolicyProvenance,
  type SpeedsterColorGeometryProposal,
  type SpeedsterMatColor,
  type SpeedsterPhysicalGeometryLearning,
} from "../ai-grader-v2/color-geometry";
import type { SpeedsterCardSide, SpeedsterQuad } from "../ai-grader-v2/contracts";
import { sanitizeSpeedsterUnitQuad } from "../ai-grader-v2/geometry";
import {
  insertSpeedsterInstrumentationEventWithConflictDetection,
  type SpeedsterConflictDetectingInstrumentationWriter,
  type SpeedsterInstrumentationEvent,
} from "./aiGraderV2Instrumentation";
import { speedsterPhysicalQuadHash } from "./speedsterCardTypeMaps";

export const SPEEDSTER_PHYSICAL_GEOMETRY_LEARNING_VERSION =
  "speedster-physical-geometry-learning-v1" as const;
export const SPEEDSTER_PHYSICAL_GEOMETRY_LEDGER_VERSION =
  "speedster-physical-geometry-lesson-scan-ledger-v1" as const;
export const SPEEDSTER_PHYSICAL_GEOMETRY_MAX_LESSONS = 200;
export const SPEEDSTER_PHYSICAL_GEOMETRY_LEDGER_MAX_BYTES = 256 * 1024;

export const SPEEDSTER_PHYSICAL_GEOMETRY_REASON = {
  EXACT_SOURCE_AND_BASE_PROPOSAL_MATCH: "Newest approved correction exactly matched the image, map, mat, and engine outline.",
  NOT_APPROVED_CORRECTION: "This evidence row is not an approved changed physical-outline correction.",
  ACTIVE_MAP_REVISION_MISMATCH: "The correction belongs to an older map revision.",
  MAT_COLOR_MISMATCH: "The correction was made against a different mat color.",
  SOURCE_IMAGE_SHA256_MISMATCH: "The correction belongs to different source image bytes.",
  SUPERSEDED_BY_NEWER_MATCH: "A newer exact correction was selected instead.",
  MALFORMED_PROPOSAL: "The saved original engine outline is malformed.",
  MALFORMED_CONFIRMED_QUAD: "The saved approved outline is malformed.",
  ENGINE_OR_POLICY_MISMATCH: "The correction was made by a different engine or policy version.",
  MALFORMED_LESSON_BINDING: "The saved lesson identity or immutable binding is malformed.",
  CORRECTION_NOT_CHANGED: "The saved approved outline does not differ from the original engine outline.",
  CURRENT_ENGINE_PROPOSAL_UNAVAILABLE: "The current engine did not return an accepted outline to compare.",
  BASE_PROPOSAL_MISMATCH: "The current engine outline differs from the outline that was corrected.",
} as const;

export type SpeedsterPhysicalGeometryReasonCode = keyof typeof SPEEDSTER_PHYSICAL_GEOMETRY_REASON;
export type SpeedsterPhysicalGeometryVerdictStatus = "USED" | "REJECTED" | "SKIPPED";

export type SpeedsterPhysicalGeometryLessonRow = Readonly<{
  id: string;
  sessionId: string;
  mapId: string;
  mapRevisionId: string | null;
  side: string;
  mode: string;
  matColor: string;
  outcome: string;
  engineVersion: string;
  policyProvenance: string;
  sourceImageSha256: string;
  proposal: unknown;
  confirmedQuad: unknown;
  proposalChanged: boolean | null;
  createdAt: Date;
}>;

export type SpeedsterPhysicalGeometryLessonVerdict = Readonly<{
  lessonKey: string;
  evidenceId: string;
  sourceSessionId: string;
  mapId: string;
  mapRevisionId: string | null;
  status: SpeedsterPhysicalGeometryVerdictStatus;
  reasonCode: SpeedsterPhysicalGeometryReasonCode;
  sourceImageSha256: string;
  baseProposalSha256: string | null;
  confirmedQuadSha256: string | null;
}>;

type EvaluatedRow = Readonly<{
  row: SpeedsterPhysicalGeometryLessonRow;
  lessonKey: string;
  proposal: SpeedsterQuad | null;
  confirmedQuad: SpeedsterQuad | null;
  proposalSha256: string | null;
  confirmedQuadSha256: string | null;
  preliminaryStatus: SpeedsterPhysicalGeometryVerdictStatus;
  preliminaryReason: SpeedsterPhysicalGeometryReasonCode;
  exactMatch: boolean;
}>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function safeQuadHash(value: SpeedsterQuad | null): string | null {
  return value ? speedsterPhysicalQuadHash(value) : null;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const boundedIdentity = (value: string, maximum = 100) => value.length >= 1 && value.length <= maximum;

export function speedsterPhysicalGeometryLessonKey(row: SpeedsterPhysicalGeometryLessonRow): string {
  return sha256([
    SPEEDSTER_PHYSICAL_GEOMETRY_LEARNING_VERSION,
    row.id,
    row.sessionId,
    row.mapId,
    row.mapRevisionId,
    row.side,
    row.matColor,
    row.sourceImageSha256,
    sha256(row.proposal),
    sha256(row.confirmedQuad),
    row.engineVersion,
    row.policyProvenance,
  ]);
}

function evaluateRow(input: Readonly<{
  row: SpeedsterPhysicalGeometryLessonRow;
  side: SpeedsterCardSide;
  mapId: string;
  activeMapRevisionId: string;
  matColor: SpeedsterMatColor;
  sourceImageSha256: string;
  currentProposal: SpeedsterQuad | null;
  currentProposalSha256: string | null;
  engineVersion: string;
  policyProvenance: SpeedsterColorGeometryPolicyProvenance;
}>): EvaluatedRow {
  const { row } = input;
  const proposal = sanitizeSpeedsterUnitQuad(row.proposal) ?? null;
  const confirmedQuad = sanitizeSpeedsterUnitQuad(row.confirmedQuad) ?? null;
  const proposalSha256 = safeQuadHash(proposal);
  const confirmedQuadSha256 = safeQuadHash(confirmedQuad);
  const base = { row, lessonKey: speedsterPhysicalGeometryLessonKey(row), proposal, confirmedQuad, proposalSha256, confirmedQuadSha256 };
  if (!boundedIdentity(row.id) || !boundedIdentity(row.sessionId)
    || !boundedIdentity(row.mapId) || row.mapRevisionId !== null && !boundedIdentity(row.mapRevisionId)
    || !SHA256_HEX.test(row.sourceImageSha256)
    || !Number.isFinite(row.createdAt.getTime()) || row.mapId !== input.mapId) {
    return { ...base, preliminaryStatus: "REJECTED", preliminaryReason: "MALFORMED_LESSON_BINDING", exactMatch: false };
  }
  if (row.mode !== "PHYSICAL_OUTER" || row.outcome !== "ACCEPTED" || row.proposalChanged !== true || row.side !== input.side) {
    return { ...base, preliminaryStatus: "SKIPPED", preliminaryReason: "NOT_APPROVED_CORRECTION", exactMatch: false };
  }
  if (!proposal) {
    return { ...base, preliminaryStatus: "REJECTED", preliminaryReason: "MALFORMED_PROPOSAL", exactMatch: false };
  }
  if (!confirmedQuad) {
    return { ...base, preliminaryStatus: "REJECTED", preliminaryReason: "MALFORMED_CONFIRMED_QUAD", exactMatch: false };
  }
  if (proposalSha256 === confirmedQuadSha256) {
    return { ...base, preliminaryStatus: "REJECTED", preliminaryReason: "CORRECTION_NOT_CHANGED", exactMatch: false };
  }
  if (row.mapRevisionId !== input.activeMapRevisionId) {
    return { ...base, preliminaryStatus: "SKIPPED", preliminaryReason: "ACTIVE_MAP_REVISION_MISMATCH", exactMatch: false };
  }
  if (row.matColor !== input.matColor) {
    return { ...base, preliminaryStatus: "SKIPPED", preliminaryReason: "MAT_COLOR_MISMATCH", exactMatch: false };
  }
  if (row.sourceImageSha256 !== input.sourceImageSha256) {
    return { ...base, preliminaryStatus: "SKIPPED", preliminaryReason: "SOURCE_IMAGE_SHA256_MISMATCH", exactMatch: false };
  }
  if (row.engineVersion !== input.engineVersion || row.policyProvenance !== input.policyProvenance) {
    return { ...base, preliminaryStatus: "REJECTED", preliminaryReason: "ENGINE_OR_POLICY_MISMATCH", exactMatch: false };
  }
  if (!input.currentProposal || !input.currentProposalSha256) {
    return { ...base, preliminaryStatus: "REJECTED", preliminaryReason: "CURRENT_ENGINE_PROPOSAL_UNAVAILABLE", exactMatch: false };
  }
  if (proposalSha256 !== input.currentProposalSha256) {
    return { ...base, preliminaryStatus: "REJECTED", preliminaryReason: "BASE_PROPOSAL_MISMATCH", exactMatch: false };
  }
  return {
    ...base,
    preliminaryStatus: "USED",
    preliminaryReason: "EXACT_SOURCE_AND_BASE_PROPOSAL_MATCH",
    exactMatch: true,
  };
}

export function evaluateSpeedsterPhysicalGeometryLessons(input: Readonly<{
  targetSessionId: string;
  createdByUserId: string;
  side: SpeedsterCardSide;
  mapId: string;
  activeMapRevisionId: string;
  matColor: SpeedsterMatColor;
  sourceImageSha256: string;
  currentProposal: SpeedsterColorGeometryProposal;
  rows: readonly SpeedsterPhysicalGeometryLessonRow[];
}>): Readonly<{
  learning: SpeedsterPhysicalGeometryLearning;
  verdicts: readonly SpeedsterPhysicalGeometryLessonVerdict[];
  event: SpeedsterInstrumentationEvent;
}> {
  if (input.rows.length > SPEEDSTER_PHYSICAL_GEOMETRY_MAX_LESSONS) {
    throw new Error("Speedster physical geometry lesson roster exceeds its bounded size.");
  }
  const currentProposal = input.currentProposal.outcome === "ACCEPTED"
    ? sanitizeSpeedsterUnitQuad(input.currentProposal.proposal)
    : null;
  const currentProposalSha256 = safeQuadHash(currentProposal);
  const evaluated = input.rows.map((row) => evaluateRow({
    row,
    side: input.side,
    mapId: input.mapId,
    activeMapRevisionId: input.activeMapRevisionId,
    matColor: input.matColor,
    sourceImageSha256: input.sourceImageSha256,
    currentProposal,
    currentProposalSha256,
    engineVersion: input.currentProposal.engineVersion,
    policyProvenance: input.currentProposal.policyProvenance,
  }));
  const selected = evaluated
    .filter(({ exactMatch }) => exactMatch)
    .sort((left, right) => {
      const byDate = right.row.createdAt.getTime() - left.row.createdAt.getTime();
      return byDate || right.row.id.localeCompare(left.row.id);
    })[0] ?? null;
  const verdicts = evaluated.map((lesson): SpeedsterPhysicalGeometryLessonVerdict => {
    const superseded = lesson.exactMatch && selected && lesson.lessonKey !== selected.lessonKey;
    return {
      lessonKey: lesson.lessonKey,
      evidenceId: lesson.row.id,
      sourceSessionId: lesson.row.sessionId,
      mapId: lesson.row.mapId,
      mapRevisionId: lesson.row.mapRevisionId,
      status: superseded ? "SKIPPED" : lesson.preliminaryStatus,
      reasonCode: superseded ? "SUPERSEDED_BY_NEWER_MATCH" : lesson.preliminaryReason,
      sourceImageSha256: lesson.row.sourceImageSha256,
      baseProposalSha256: lesson.proposalSha256,
      confirmedQuadSha256: lesson.confirmedQuadSha256,
    };
  });
  const rosterHash = sha256(verdicts.map(({ lessonKey }) => lessonKey).sort());
  const eventKey = `${input.targetSessionId}:physical-geometry-lessons:${sha256({
    version: SPEEDSTER_PHYSICAL_GEOMETRY_LEDGER_VERSION,
    targetSessionId: input.targetSessionId,
    side: input.side,
    mapId: input.mapId,
    activeMapRevisionId: input.activeMapRevisionId,
    matColor: input.matColor,
    sourceImageSha256: input.sourceImageSha256,
    currentProposalSha256,
    rosterHash,
  })}`;
  const totals = verdicts.reduce((accumulator, verdict) => {
    accumulator[verdict.status] += 1;
    return accumulator;
  }, { USED: 0, REJECTED: 0, SKIPPED: 0 });
  const details = {
    version: SPEEDSTER_PHYSICAL_GEOMETRY_LEDGER_VERSION,
    targetSessionId: input.targetSessionId,
    side: input.side,
    mapId: input.mapId,
    activeMapRevisionId: input.activeMapRevisionId,
    matColor: input.matColor,
    sourceImageSha256: input.sourceImageSha256,
    engineVersion: SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION,
    policyProvenance: input.currentProposal.policyProvenance,
    currentProposalSha256,
    rosterHash,
    loadedLessonCount: verdicts.length,
    totals,
    reasonCatalog: SPEEDSTER_PHYSICAL_GEOMETRY_REASON,
    verdicts,
  };
  if (Buffer.byteLength(JSON.stringify(details), "utf8") > SPEEDSTER_PHYSICAL_GEOMETRY_LEDGER_MAX_BYTES) {
    throw new Error("Speedster physical geometry lesson ledger exceeds its storage budget.");
  }
  const learning: SpeedsterPhysicalGeometryLearning = {
    version: SPEEDSTER_PHYSICAL_GEOMETRY_LEARNING_VERSION,
    scanEventKey: eventKey,
    targetSessionId: input.targetSessionId,
    side: input.side,
    mapId: input.mapId,
    activeMapRevisionId: input.activeMapRevisionId,
    sourceImageSha256: input.sourceImageSha256,
    baseProposalSha256: currentProposalSha256,
    usedLesson: selected?.confirmedQuad && selected.row.mapRevisionId ? {
      lessonKey: selected.lessonKey,
      evidenceId: selected.row.id,
      sourceSessionId: selected.row.sessionId,
      mapId: selected.row.mapId,
      mapRevisionId: selected.row.mapRevisionId,
      reasonCode: "EXACT_SOURCE_AND_BASE_PROPOSAL_MATCH",
      suggestedQuad: selected.confirmedQuad,
    } : null,
  };
  return {
    learning,
    verdicts,
    event: {
      eventKey,
      sessionId: input.targetSessionId,
      createdByUserId: input.createdByUserId,
      category: "GEOMETRY_LEARNING",
      eventType: "PHYSICAL_GEOMETRY_LESSON_SCAN_VERDICTS_RECORDED",
      details: details as unknown as Prisma.InputJsonValue,
    },
  };
}

export async function recordSpeedsterPhysicalGeometryLessonScan(
  writer: SpeedsterConflictDetectingInstrumentationWriter,
  input: Parameters<typeof evaluateSpeedsterPhysicalGeometryLessons>[0],
): Promise<ReturnType<typeof evaluateSpeedsterPhysicalGeometryLessons>> {
  const evaluated = evaluateSpeedsterPhysicalGeometryLessons(input);
  await insertSpeedsterInstrumentationEventWithConflictDetection(writer, evaluated.event);
  return evaluated;
}

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

export async function verifySpeedsterPhysicalGeometryLearningCapture(input: Readonly<{
  learning: unknown;
  targetSessionId: string;
  createdByUserId: string;
  side: SpeedsterCardSide;
  finalMapRevisionId: string | null;
  sourceImageSha256: string;
  currentProposal: SpeedsterColorGeometryProposal;
  confirmedQuad: SpeedsterQuad;
  loadEvent: (eventKey: string) => Promise<Readonly<{
    eventKey: string;
    sessionId: string;
    createdByUserId: string;
    category: string;
    eventType: string;
    details: unknown;
  }> | null>;
  loadEvidence: (evidenceId: string) => Promise<(SpeedsterPhysicalGeometryLessonRow & Readonly<{
    createdByUserId: string;
    workflowState: string;
  }>) | null>;
}>): Promise<Readonly<{
  version: typeof SPEEDSTER_PHYSICAL_GEOMETRY_LEARNING_VERSION;
  scanEventKey: string;
  lessonKey: string;
  sourceEvidenceId: string;
  sourceSessionId: string;
  mapId: string;
  mapRevisionId: string;
  reasonCode: "EXACT_SOURCE_AND_BASE_PROPOSAL_MATCH";
  suggestedQuadSha256: string;
  lessonDraftChangedByOperator: boolean;
}>> {
  const learning = parseSpeedsterPhysicalGeometryLearning(input.learning, {
    targetSessionId: input.targetSessionId,
    side: input.side,
  });
  const used = learning?.usedLesson;
  const currentQuad = input.currentProposal.outcome === "ACCEPTED"
    ? sanitizeSpeedsterUnitQuad(input.currentProposal.proposal)
    : null;
  const currentProposalSha256 = safeQuadHash(currentQuad);
  if (!learning || !used || !currentProposalSha256
    || learning.sourceImageSha256 !== input.sourceImageSha256
    || learning.baseProposalSha256 !== currentProposalSha256
    || learning.activeMapRevisionId !== input.finalMapRevisionId) {
    throw new Error("Physical geometry learning reference does not match the final capture authority.");
  }
  const [event, source] = await Promise.all([
    input.loadEvent(learning.scanEventKey),
    input.loadEvidence(used.evidenceId),
  ]);
  const details = record(event?.details);
  const verdicts = Array.isArray(details?.verdicts) ? details.verdicts : null;
  const matchingVerdicts = verdicts?.filter((value) => {
    const verdict = record(value);
    return verdict?.lessonKey === used.lessonKey
      && verdict.evidenceId === used.evidenceId
      && verdict.sourceSessionId === used.sourceSessionId
      && verdict.mapId === used.mapId
      && verdict.mapRevisionId === used.mapRevisionId
      && verdict.sourceImageSha256 === learning.sourceImageSha256
      && verdict.baseProposalSha256 === learning.baseProposalSha256
      && verdict.status === "USED"
      && verdict.reasonCode === "EXACT_SOURCE_AND_BASE_PROPOSAL_MATCH";
  }) ?? [];
  if (!event || event.eventKey !== learning.scanEventKey
    || event.sessionId !== input.targetSessionId
    || event.createdByUserId !== input.createdByUserId
    || event.category !== "GEOMETRY_LEARNING"
    || event.eventType !== "PHYSICAL_GEOMETRY_LESSON_SCAN_VERDICTS_RECORDED"
    || !details || details.version !== SPEEDSTER_PHYSICAL_GEOMETRY_LEDGER_VERSION
    || details.targetSessionId !== input.targetSessionId
    || details.side !== input.side
    || details.mapId !== learning.mapId
    || details.activeMapRevisionId !== learning.activeMapRevisionId
    || details.sourceImageSha256 !== learning.sourceImageSha256
    || details.currentProposalSha256 !== learning.baseProposalSha256
    || matchingVerdicts.length !== 1) {
    throw new Error("Physical geometry learning scan ledger is missing or inconsistent.");
  }
  if (!source || source.id !== used.evidenceId
    || source.sessionId !== used.sourceSessionId
    || source.createdByUserId !== input.createdByUserId
    || source.workflowState !== "COMPLETED"
    || source.mapId !== learning.mapId
    || source.mapRevisionId !== learning.activeMapRevisionId
    || source.side !== input.side
    || source.mode !== "PHYSICAL_OUTER"
    || source.outcome !== "ACCEPTED"
    || source.proposalChanged !== true
    || source.matColor !== input.currentProposal.matColor
    || source.engineVersion !== input.currentProposal.engineVersion
    || source.policyProvenance !== input.currentProposal.policyProvenance
    || source.sourceImageSha256 !== input.sourceImageSha256
    || speedsterPhysicalGeometryLessonKey(source) !== used.lessonKey) {
    throw new Error("Physical geometry learning source evidence is missing or inconsistent.");
  }
  const sourceProposal = sanitizeSpeedsterUnitQuad(source.proposal);
  const sourceConfirmed = sanitizeSpeedsterUnitQuad(source.confirmedQuad);
  const matchingVerdict = record(matchingVerdicts[0]);
  if (!sourceProposal || !sourceConfirmed
    || safeQuadHash(sourceProposal) !== currentProposalSha256
    || safeQuadHash(sourceConfirmed) !== safeQuadHash(used.suggestedQuad)
    || matchingVerdict?.confirmedQuadSha256 !== safeQuadHash(sourceConfirmed)
    || safeQuadHash(sourceProposal) === safeQuadHash(sourceConfirmed)) {
    throw new Error("Physical geometry learning source quads are inconsistent.");
  }
  return {
    version: SPEEDSTER_PHYSICAL_GEOMETRY_LEARNING_VERSION,
    scanEventKey: learning.scanEventKey,
    lessonKey: used.lessonKey,
    sourceEvidenceId: used.evidenceId,
    sourceSessionId: used.sourceSessionId,
    mapId: used.mapId,
    mapRevisionId: used.mapRevisionId,
    reasonCode: used.reasonCode,
    suggestedQuadSha256: safeQuadHash(sourceConfirmed)!,
    lessonDraftChangedByOperator: safeQuadHash(input.confirmedQuad) !== safeQuadHash(sourceConfirmed),
  };
}
