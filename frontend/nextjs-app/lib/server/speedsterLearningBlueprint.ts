import type { Prisma } from "@tenkings/database";

import {
  harvestSpeedsterLearningSessionV2,
} from "../ai-grader-v2/learning-harvest-v2";
import { speedsterHistoryFingerprintVersion } from "../ai-grader-v2/learning-articuno-dry-run-v2";
import {
  type SpeedsterCardSide,
  type SpeedsterReviewFinding,
} from "../ai-grader-v2/contracts";
import { sanitizeSpeedsterUnitQuad } from "../ai-grader-v2/geometry";
import { parseSpeedsterInspectionFrame } from "../ai-grader-v2/inspection-frame";
import {
  parsePersistedSpeedsterReviewFindings,
  speedsterFindingRegions,
} from "../ai-grader-v2/review-findings";
import { parseSpeedsterTraceRleV1, type SpeedsterTraceRleV1 } from "../ai-grader-v2/trace-codec";
import {
  isAuthorizedSpeedsterOriginalStorageKey,
  isAuthorizedSpeedsterPreparedStorageKeys,
} from "./aiGraderV2IphoneCapture";
import {
  SPEEDSTER_MEMORY_LESSON_REASON,
  SPEEDSTER_MEMORY_LESSON_SCAN_LEDGER_VERSION,
  speedsterMemoryLessonKey,
} from "./aiGraderV2Instrumentation";
import {
  SPEEDSTER_PHYSICAL_GEOMETRY_LEARNING_VERSION,
  SPEEDSTER_PHYSICAL_GEOMETRY_LEDGER_VERSION,
  SPEEDSTER_PHYSICAL_GEOMETRY_REASON,
  speedsterPhysicalGeometryLessonKey,
  type SpeedsterPhysicalGeometryLessonRow,
} from "./speedsterPhysicalGeometryLessons";

export const SPEEDSTER_LEARNING_BLUEPRINT_VERSION = "speedster-learning-blueprint-v1" as const;
export const SPEEDSTER_LEARNING_BLUEPRINT_PAGE_SIZE = 50;
export const SPEEDSTER_LEARNING_BLUEPRINT_MAX_EVENTS = 4_096;
export const SPEEDSTER_LEARNING_BLUEPRINT_MAX_FILTERED_FINDINGS = 1_024;
export const SPEEDSTER_LEARNING_BLUEPRINT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

type JsonValue = Prisma.JsonValue | unknown;

export type LearningBlueprintCompletionLabel = Readonly<{
  sourceSessionId: string | null;
  certificateSequence: number;
  createdAt: Date;
}>;

export type LearningBlueprintGeometryRow = Readonly<{
  id: string;
  sessionId: string;
  createdByUserId: string;
  side: string;
  mode: string;
  matColor: string;
  outcome: string;
  engineVersion: string;
  policyProvenance: string;
  sourceImageSha256: string;
  proposal: JsonValue;
  confirmedQuad: JsonValue;
  diagnostics: JsonValue;
  proposalChanged: boolean | null;
  createdAt: Date;
}>;

export type LearningBlueprintSessionRow = Readonly<{
  id: string;
  createdByUserId: string;
  cardProfile: string;
  workflowState: string;
  identity: JsonValue;
  capture: JsonValue;
  reviewedDefects: JsonValue;
  gradeReport: JsonValue;
  mapRevisionId: string | null;
  mapRevision: { mapId: string } | null;
  createdAt: Date;
  geometry?: readonly LearningBlueprintGeometryRow[];
}>;

export type LearningBlueprintEventRow = Readonly<{
  eventKey: string;
  sessionId: string;
  createdByUserId: string;
  category: string;
  eventType: string;
  findingId: string | null;
  details: JsonValue;
  createdAt: Date;
}>;

export type LearningBlueprintMapFilterRow = Readonly<{
  sessionId: string;
  findingId: string;
  side: string;
  findingSnapshot: JsonValue;
  restoreEvent: { outcome: string } | null;
}>;

export type LearningBlueprintCardSummary = Readonly<{
  sessionId: string;
  completionOrder: number;
  completedAt: string;
  cardProfile: string;
  title: string;
  details: readonly string[];
  grade: number | null;
  corrections: Readonly<{
    defects: number;
    physicalGeometry: number;
    printedFrame: number;
  }>;
  warnings: readonly string[];
}>;

export type LearningBlueprintImageSet = Readonly<{
  original: string | null;
  rectified: string | null;
  inspection: string | null;
  inspectionFrame: ReturnType<typeof parseSpeedsterInspectionFrame>;
}>;

type BlueprintShape =
  | Readonly<{
      kind: "TRACE_RLE";
      trace: Readonly<{
        width: number;
        height: number;
        runs: readonly number[];
      }>;
    }>
  | Readonly<{ kind: "CONTOURS"; contours: readonly (readonly { x: number; y: number }[])[] }>;

export type LearningBlueprintDefectOverlay = Readonly<{
  findingId: string;
  side: SpeedsterCardSide;
  coordinateSpace: "CANONICAL_CARD";
  origin: string;
  detectedDefectType: string | null;
  finalDefectType: string | null;
  reviewResult: string;
  aiShapes: readonly BlueprintShape[];
  correctionShape: BlueprintShape | null;
  filteredByMap: boolean;
  shapeUnavailableReason: string | null;
}>;

export type LearningBlueprintGeometryOverlay = Readonly<{
  evidenceId: string;
  side: SpeedsterCardSide;
  mode: "PHYSICAL_OUTER" | "PRINTED_FRAME";
  coordinateSpace: "ORIGINAL_UNIT" | "RECTIFIED_UNIT";
  outcome: string;
  aiProposal: ReturnType<typeof sanitizeSpeedsterUnitQuad>;
  humanConfirmed: ReturnType<typeof sanitizeSpeedsterUnitQuad>;
  corrected: boolean;
}>;

export type LearningBlueprintTrail = Readonly<{
  id: string;
  kind: "MEMORY" | "PHYSICAL_GEOMETRY" | "PRINTED_FRAME";
  side: SpeedsterCardSide;
  title: string;
  sourceAnchor: Readonly<{
    kind: "FINDING" | "GEOMETRY";
    evidenceId: string;
    side: SpeedsterCardSide;
  }>;
  corrected: "PROVEN";
  savedToRecord: "PROVEN";
  learningBank: "PROVEN_FOR_SELECTED_SCAN" | "ELIGIBLE_RECORD" | "UNPROVEN";
  nextScan: Readonly<{
    status: "USED" | "REJECTED" | "SKIPPED" | "UNPROVEN" | "NOT_TESTABLE";
    reasonCodes: readonly string[];
    reasons: readonly string[];
    finalCaptureLinked: boolean | null;
    lessonDraftChangedByOperator: boolean | null;
    targetAnchors: readonly Readonly<{
      kind: "FINDING" | "GEOMETRY";
      evidenceId: string;
      side: SpeedsterCardSide;
    }>[];
  }>;
  repeatedMistake: "UNPROVEN_NO_EXPLICIT_REPEAT_EVIDENCE";
}>;

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

function parsedFindings(value: unknown): { findings: SpeedsterReviewFinding[]; warning: string | null } {
  try {
    return { findings: parsePersistedSpeedsterReviewFindings(value), warning: null };
  } catch {
    return { findings: [], warning: "Saved defect evidence is malformed and was not drawn." };
  }
}

function explicitCorrection(finding: SpeedsterReviewFinding) {
  return Boolean(finding.finalTrace)
    || finding.reviewResult === "REMOVED"
    || finding.reviewResult === "TYPE_CORRECTED"
    || finding.reviewResult === "SMART_MARKED";
}

function cardIdentity(session: LearningBlueprintSessionRow) {
  const identity = record(session.identity) ?? {};
  const pokemon = session.cardProfile === "POKEMON";
  const title = text(pokemon ? identity.cardName : identity.playerName) ?? "Ten Kings card";
  const details = [
    identity.year,
    identity.manufacturer,
    identity.productSet,
    identity.parallel,
    identity.cardNumber,
  ].map(text).filter((value): value is string => Boolean(value));
  const grade = finite(record(record(session.gradeReport)?.overall)?.displayGrade);
  return { title, details, grade };
}

export function projectLearningBlueprintCard(
  session: LearningBlueprintSessionRow,
  label: LearningBlueprintCompletionLabel,
): LearningBlueprintCardSummary {
  const reviewed = parsedFindings(session.reviewedDefects);
  const geometry = (session.geometry ?? []).filter((row) => (
    row.sessionId === session.id && row.createdByUserId === session.createdByUserId
  ));
  const identity = cardIdentity(session);
  return {
    sessionId: session.id,
    completionOrder: label.certificateSequence,
    completedAt: label.createdAt.toISOString(),
    cardProfile: session.cardProfile,
    ...identity,
    corrections: {
      defects: reviewed.findings.filter(explicitCorrection).length,
      physicalGeometry: geometry.filter((row) => row.mode === "PHYSICAL_OUTER" && row.proposalChanged === true).length,
      printedFrame: geometry.filter((row) => row.mode === "PRINTED_FRAME" && row.proposalChanged === true).length,
    },
    warnings: reviewed.warning ? [reviewed.warning] : [],
  };
}

function sideCapture(session: LearningBlueprintSessionRow, side: SpeedsterCardSide) {
  const capture = record(session.capture);
  return capture ? record(capture[side.toLowerCase()]) : null;
}

export async function signLearningBlueprintImages(input: Readonly<{
  session: LearningBlueprintSessionRow;
  side: SpeedsterCardSide;
  presignRead: (storageKey: string, expiresInSeconds: number) => Promise<string>;
}>): Promise<{ images: LearningBlueprintImageSet; warnings: string[] }> {
  const value = sideCapture(input.session, input.side);
  const imageWarnings: string[] = [];
  const frame = parseSpeedsterInspectionFrame(value?.inspectionFrame);
  let original: string | null = null;
  let rectified: string | null = null;
  let inspection: string | null = null;
  const originalKey = text(value?.originalStorageKey);
  if (originalKey && isAuthorizedSpeedsterOriginalStorageKey({
    storageKey: originalKey,
    userId: input.session.createdByUserId,
    sessionId: input.session.id,
    side: input.side,
  })) {
    try {
      original = await input.presignRead(originalKey, 600);
    } catch {
      imageWarnings.push(`${input.side} original image could not be signed.`);
    }
  } else {
    imageWarnings.push(`${input.side} original image authority is unavailable.`);
  }
  const rectifiedKey = text(value?.rectifiedStorageKey);
  const inspectionKey = text(value?.inspectionStorageKey);
  const viewKeys = record(value?.viewStorageKeys);
  if (rectifiedKey && inspectionKey && viewKeys
    && text(viewKeys.NORMALIZED) && text(viewKeys.MICRO_DEFECT) && text(viewKeys.DIRECTIONAL)
    && isAuthorizedSpeedsterPreparedStorageKeys({
      userId: input.session.createdByUserId,
      sessionId: input.session.id,
      side: input.side,
      rectifiedStorageKey: rectifiedKey,
      inspectionStorageKey: inspectionKey,
      viewStorageKeys: {
        NORMALIZED: text(viewKeys.NORMALIZED)!,
        MICRO_DEFECT: text(viewKeys.MICRO_DEFECT)!,
        DIRECTIONAL: text(viewKeys.DIRECTIONAL)!,
      },
    })) {
    try {
      [rectified, inspection] = await Promise.all([
        input.presignRead(rectifiedKey, 600),
        input.presignRead(inspectionKey, 600),
      ]);
    } catch {
      rectified = null;
      inspection = null;
      imageWarnings.push(`${input.side} prepared images could not be signed.`);
    }
  } else {
    imageWarnings.push(`${input.side} prepared image authority is unavailable.`);
  }
  return { images: { original, rectified, inspection, inspectionFrame: frame }, warnings: imageWarnings };
}

export function projectLearningBlueprintGeometryOverlays(rows: readonly LearningBlueprintGeometryRow[]) {
  return rows.flatMap((row): LearningBlueprintGeometryOverlay[] => {
    if ((row.side !== "FRONT" && row.side !== "BACK")
      || (row.mode !== "PHYSICAL_OUTER" && row.mode !== "PRINTED_FRAME")) return [];
    const confirmed = sanitizeSpeedsterUnitQuad(row.confirmedQuad);
    if (!confirmed) return [];
    return [{
      evidenceId: row.id,
      side: row.side,
      mode: row.mode,
      coordinateSpace: row.mode === "PHYSICAL_OUTER" ? "ORIGINAL_UNIT" : "RECTIFIED_UNIT",
      outcome: row.outcome,
      aiProposal: sanitizeSpeedsterUnitQuad(row.proposal),
      humanConfirmed: confirmed,
      corrected: row.proposalChanged === true,
    }];
  });
}

function safeTrace(value: unknown): SpeedsterTraceRleV1 | null {
  try {
    return parseSpeedsterTraceRleV1(value);
  } catch {
    return null;
  }
}

function initialMasks(events: readonly LearningBlueprintEventRow[]) {
  const maskByCandidate = new Map<string, SpeedsterTraceRleV1>();
  const candidateIdsByFinding = new Map<string, string[]>();
  for (const event of events) {
    const details = record(event.details);
    if (event.eventType === "RAW_DETECTOR_CANDIDATE_PRESERVED") {
      const candidate = record(details?.candidate);
      const id = text(candidate?.candidateId);
      const mask = safeTrace(candidate?.canonicalMask);
      if (id && mask) maskByCandidate.set(id, mask);
    }
    if (event.eventType === "FINDING_PROPOSED" && event.findingId) {
      const after = record(details?.after);
      const contributors = Array.isArray(after?.contributors) ? after.contributors : [];
      candidateIdsByFinding.set(event.findingId, contributors.flatMap((entry) => {
        const id = text(record(entry)?.rawCandidateId);
        return id ? [id] : [];
      }));
    }
  }
  return { maskByCandidate, candidateIdsByFinding };
}

function contourShape(finding: SpeedsterReviewFinding): BlueprintShape {
  return {
    kind: "CONTOURS",
    contours: speedsterFindingRegions(finding).map(({ canonicalContour }) => canonicalContour),
  };
}

function traceShape(trace: SpeedsterTraceRleV1): BlueprintShape {
  return {
    kind: "TRACE_RLE",
    trace: {
      width: trace.width,
      height: trace.height,
      runs: [...trace.runs],
    },
  };
}

function correctionShape(finding: SpeedsterReviewFinding): BlueprintShape | null {
  if (finding.finalTrace) return traceShape(finding.finalTrace);
  return explicitCorrection(finding) ? contourShape(finding) : null;
}

export function projectLearningBlueprintDefectOverlays(input: Readonly<{
  session: LearningBlueprintSessionRow;
  events: readonly LearningBlueprintEventRow[];
  filtered: readonly LearningBlueprintMapFilterRow[];
}>): { overlays: LearningBlueprintDefectOverlay[]; warnings: string[] } {
  const overlayWarnings: string[] = [];
  const parsed = parsedFindings(input.session.reviewedDefects);
  if (parsed.warning) overlayWarnings.push(parsed.warning);
  const filteredIds = new Set(input.filtered.map(({ findingId }) => findingId));
  const findings = [...parsed.findings];
  for (const row of input.filtered) {
    if (findings.some(({ id }) => id === row.findingId)) continue;
    try {
      const [finding] = parsePersistedSpeedsterReviewFindings([row.findingSnapshot]);
      if (finding) findings.push(finding);
    } catch {
      overlayWarnings.push(`Filtered finding ${row.findingId} is malformed and was not drawn.`);
    }
  }
  const initial = initialMasks(input.events);
  return {
    overlays: findings.map((finding): LearningBlueprintDefectOverlay => {
      const candidateMasks = (initial.candidateIdsByFinding.get(finding.id) ?? [])
        .flatMap((candidateId) => {
          const mask = initial.maskByCandidate.get(candidateId);
          return mask ? [traceShape(mask)] : [];
        });
      const persistedMask = finding.detectorMask
        ? [traceShape(finding.detectorMask)]
        : [];
      const aiShapes = candidateMasks.length ? candidateMasks
        : persistedMask.length ? persistedMask
          : finding.origin !== "SMART_MARK" && !finding.finalTrace ? [contourShape(finding)] : [];
      return {
        findingId: finding.id,
        side: finding.side,
        coordinateSpace: "CANONICAL_CARD",
        origin: finding.origin ?? "DETECTOR",
        detectedDefectType: finding.detectedDefectType ?? null,
        finalDefectType: finding.reviewResult === "REMOVED" ? null : finding.defectType,
        reviewResult: finding.reviewResult,
        aiShapes,
        correctionShape: correctionShape(finding),
        filteredByMap: filteredIds.has(finding.id),
        shapeUnavailableReason: aiShapes.length || correctionShape(finding)
          ? null
          : "No exact drawable shape was preserved for this finding.",
      };
    }),
    warnings: overlayWarnings,
  };
}

function eventDetails(event: LearningBlueprintEventRow) {
  return record(event.details);
}

function memoryVerdict(
  lessonKey: string,
  targetSessionId: string,
  events: readonly LearningBlueprintEventRow[],
) {
  for (const event of events) {
    if (event.eventType !== "MEMORY_LESSON_SCAN_VERDICTS_RECORDED"
      || event.category !== "MEMORY_DECISION"
      || event.sessionId !== targetSessionId) continue;
    const details = eventDetails(event);
    if (details?.version !== SPEEDSTER_MEMORY_LESSON_SCAN_LEDGER_VERSION
      || details.targetSessionId !== targetSessionId) continue;
    const lessons = Array.isArray(details?.lessons) ? details.lessons : [];
    const matchingLessons = lessons.map(record).filter((entry) => record(entry?.lesson)?.lessonKey === lessonKey);
    if (matchingLessons.length !== 1) continue;
    const matching = matchingLessons[0]!;
    const status = matching.overallStatus;
    if (status !== "USED" && status !== "REJECTED" && status !== "SKIPPED") continue;
    const reasonCodes = Array.isArray(matching.overallReasonCodes)
      ? matching.overallReasonCodes.filter((value): value is string => typeof value === "string")
      : [];
    const reasonCatalog = record(details.reasonCatalog);
    if (!reasonCatalog || reasonCodes.length === 0 || reasonCodes.some((code) => (
      !SPEEDSTER_MEMORY_LESSON_REASON[code]
      || reasonCatalog[code] !== SPEEDSTER_MEMORY_LESSON_REASON[code]
    ))) continue;
    const candidateIds = new Set<string>();
    const sideVerdicts = record(matching.sideVerdicts);
    for (const side of ["FRONT", "BACK"] as const) {
      const sideVerdict = record(sideVerdicts?.[side]);
      if (sideVerdict?.status !== status || !Array.isArray(sideVerdict.candidateIds)) continue;
      sideVerdict.candidateIds.forEach((candidateId) => {
        if (typeof candidateId === "string" && candidateId) candidateIds.add(candidateId);
      });
    }
    const targetAnchors = events.flatMap((candidateEvent) => {
      if (candidateEvent.eventType !== "FINDING_PROPOSED" || !candidateEvent.findingId) return [];
      const after = record(eventDetails(candidateEvent)?.after);
      const side = after?.side;
      const contributors = Array.isArray(after?.contributors) ? after.contributors : [];
      if (side !== "FRONT" && side !== "BACK") return [];
      const targetSide: SpeedsterCardSide = side;
      return contributors.some((contributor) => {
        const candidateId = text(record(contributor)?.rawCandidateId);
        return candidateId ? candidateIds.has(candidateId) : false;
      }) ? [{ kind: "FINDING" as const, evidenceId: candidateEvent.findingId!, side: targetSide }] : [];
    });
    return {
      status,
      reasonCodes,
      reasons: reasonCodes.map((code) => String(reasonCatalog[code])),
      targetAnchors: [...new Map(targetAnchors.map((anchor) => [
        `${anchor.side}:${anchor.evidenceId}`,
        anchor,
      ])).values()],
    } as const;
  }
  return null;
}

function findingTitle(finding: SpeedsterReviewFinding | undefined, defectType: string) {
  if (!finding) return defectType.replaceAll("_", " ").toLowerCase();
  if (finding.origin === "SMART_MARK") return `Smart Mark — ${finding.defectType.replaceAll("_", " ").toLowerCase()}`;
  if (finding.reviewResult === "REMOVED") return `Removed AI finding — ${defectType.replaceAll("_", " ").toLowerCase()}`;
  if (finding.reviewResult === "TYPE_CORRECTED") return `Retyped AI finding — ${defectType.replaceAll("_", " ").toLowerCase()}`;
  return `Corrected AI finding — ${defectType.replaceAll("_", " ").toLowerCase()}`;
}

function memoryTrails(input: Readonly<{
  earlier: LearningBlueprintSessionRow;
  earlierLabel: LearningBlueprintCompletionLabel;
  laterSessionId: string;
  laterEvents: readonly LearningBlueprintEventRow[];
}>): LearningBlueprintTrail[] {
  const parsed = parsedFindings(input.earlier.reviewedDefects);
  if (parsed.warning) return [];
  const harvest = harvestSpeedsterLearningSessionV2({
    sessionId: input.earlier.id,
    completedAt: input.earlierLabel.createdAt,
    completionOrder: input.earlierLabel.certificateSequence,
    fingerprintVersion: speedsterHistoryFingerprintVersion(input.earlier.capture, input.earlier.gradeReport),
    reviewedDefects: Array.isArray(input.earlier.reviewedDefects) ? input.earlier.reviewedDefects : [],
  });
  return harvest.history.lessons.flatMap((lesson, lessonInputOrder): LearningBlueprintTrail[] => {
    if (lesson.provenance === "UNTOUCHED_ACCEPTED_POSITIVE") return [];
    const finding = parsed.findings[lesson.proposalOrder];
    if (!finding || !explicitCorrection(finding)) return [];
    const lessonOrder = lesson.lessonOrder ?? lessonInputOrder;
    const lessonKey = speedsterMemoryLessonKey({
      sessionId: input.earlier.id,
      completionOrder: input.earlierLabel.certificateSequence,
      proposalOrder: lesson.proposalOrder,
      lessonOrder,
      defectType: lesson.defectType,
      polarity: lesson.polarity,
      provenance: lesson.provenance,
      sourceViewId: lesson.sourceViewId,
    });
    const verdict = memoryVerdict(lessonKey, input.laterSessionId, input.laterEvents);
    return [{
      id: `memory:${lessonKey}`,
      kind: "MEMORY",
      side: finding.side,
      title: findingTitle(finding, lesson.defectType),
      sourceAnchor: { kind: "FINDING", evidenceId: finding.id, side: finding.side },
      corrected: "PROVEN",
      savedToRecord: "PROVEN",
      learningBank: verdict
        ? "PROVEN_FOR_SELECTED_SCAN"
        : "UNPROVEN",
      nextScan: verdict ? {
        ...verdict,
        finalCaptureLinked: null,
        lessonDraftChangedByOperator: null,
      } : {
        status: "UNPROVEN",
        reasonCodes: ["UNPROVEN_LEGACY_NO_LESSON_VERDICT"],
        reasons: ["The selected later card has no immutable verdict for this exact lesson."],
        finalCaptureLinked: null,
        lessonDraftChangedByOperator: null,
        targetAnchors: [],
      },
      repeatedMistake: "UNPROVEN_NO_EXPLICIT_REPEAT_EVIDENCE",
    }];
  });
}

function geometryVerdict(
  input: Readonly<{
    lessonKey: string;
    evidenceId: string;
    sourceSessionId: string;
    targetSessionId: string;
    side: SpeedsterCardSide;
    mapId: string;
    mapRevisionId: string;
  }>,
  events: readonly LearningBlueprintEventRow[],
) {
  for (const event of events) {
    if (event.eventType !== "PHYSICAL_GEOMETRY_LESSON_SCAN_VERDICTS_RECORDED") continue;
    const details = eventDetails(event);
    if (!details
      || event.category !== "GEOMETRY_LEARNING"
      || event.sessionId !== input.targetSessionId
      || details.version !== SPEEDSTER_PHYSICAL_GEOMETRY_LEDGER_VERSION
      || details.targetSessionId !== input.targetSessionId
      || details.side !== input.side
      || details.mapId !== input.mapId
      || details.activeMapRevisionId !== input.mapRevisionId) continue;
    const verdicts = Array.isArray(details?.verdicts) ? details.verdicts : [];
    const matching = verdicts.map(record).find((entry) => (
      entry?.lessonKey === input.lessonKey
      && entry.evidenceId === input.evidenceId
      && entry.sourceSessionId === input.sourceSessionId
      && entry.mapId === input.mapId
      && entry.mapRevisionId === input.mapRevisionId
    ));
    if (!matching) continue;
    const status = matching.status;
    const code = text(matching.reasonCode);
    const catalog = record(details.reasonCatalog);
    if (!code || !catalog || catalog[code] !== SPEEDSTER_PHYSICAL_GEOMETRY_REASON[code as keyof typeof SPEEDSTER_PHYSICAL_GEOMETRY_REASON]
      || (status !== "USED" && status !== "REJECTED" && status !== "SKIPPED")) continue;
    return { eventKey: event.eventKey, status, reasonCodes: [code], reasons: [String(catalog[code])] } as const;
  }
  return null;
}

function geometryTrails(input: Readonly<{
  earlier: LearningBlueprintSessionRow;
  later: LearningBlueprintSessionRow;
  earlierGeometry: readonly LearningBlueprintGeometryRow[];
  laterGeometry: readonly LearningBlueprintGeometryRow[];
  laterEvents: readonly LearningBlueprintEventRow[];
}>): LearningBlueprintTrail[] {
  return input.earlierGeometry.flatMap((row): LearningBlueprintTrail[] => {
    if (row.proposalChanged !== true || (row.side !== "FRONT" && row.side !== "BACK")) return [];
    if (row.mode === "PRINTED_FRAME") return [{
      id: `printed:${row.id}`,
      kind: "PRINTED_FRAME",
      side: row.side,
      title: `${row.side === "FRONT" ? "Front" : "Back"} printed-frame correction`,
      sourceAnchor: { kind: "GEOMETRY", evidenceId: row.id, side: row.side },
      corrected: "PROVEN",
      savedToRecord: "PROVEN",
      learningBank: "UNPROVEN",
      nextScan: {
        status: "NOT_TESTABLE",
        reasonCodes: ["NO_PRINTED_FRAME_LEARNING_CONTRACT"],
        reasons: ["Printed-frame corrections do not yet have a lesson or next-scan verdict contract."],
        finalCaptureLinked: null,
        lessonDraftChangedByOperator: null,
        targetAnchors: [],
      },
      repeatedMistake: "UNPROVEN_NO_EXPLICIT_REPEAT_EVIDENCE",
    }];
    if (row.mode !== "PHYSICAL_OUTER" || !input.earlier.mapRevisionId || !input.earlier.mapRevision) return [];
    const source: SpeedsterPhysicalGeometryLessonRow = {
      ...row,
      mapId: input.earlier.mapRevision.mapId,
      mapRevisionId: input.earlier.mapRevisionId,
    };
    const lessonKey = speedsterPhysicalGeometryLessonKey(source);
    const verdict = geometryVerdict({
      lessonKey,
      evidenceId: row.id,
      sourceSessionId: input.earlier.id,
      targetSessionId: input.later.id,
      side: row.side,
      mapId: input.earlier.mapRevision.mapId,
      mapRevisionId: input.earlier.mapRevisionId,
    }, input.laterEvents);
    const finalLearning = input.laterGeometry.flatMap((candidate) => {
      if (candidate.mode !== "PHYSICAL_OUTER" || candidate.side !== row.side) return [];
      const learning = record(record(candidate.diagnostics)?.learning);
      return learning?.version === SPEEDSTER_PHYSICAL_GEOMETRY_LEARNING_VERSION
        && learning.targetSessionId === input.later.id
        && learning.side === row.side
        && learning.reasonCode === "EXACT_SOURCE_AND_BASE_PROPOSAL_MATCH"
        && learning.lessonKey === lessonKey
        && learning.sourceEvidenceId === row.id
        && learning.sourceSessionId === input.earlier.id
        && learning.mapId === input.earlier.mapRevision?.mapId
        && learning.mapRevisionId === input.earlier.mapRevisionId
        && verdict?.eventKey === learning.scanEventKey
        ? [{ learning, evidenceId: candidate.id }]
        : [];
    })[0] ?? null;
    const verdictProven = verdict?.status !== "USED" || Boolean(finalLearning);
    return [{
      id: `physical:${lessonKey}`,
      kind: "PHYSICAL_GEOMETRY",
      side: row.side,
      title: `${row.side === "FRONT" ? "Front" : "Back"} physical card-edge correction`,
      sourceAnchor: { kind: "GEOMETRY", evidenceId: row.id, side: row.side },
      corrected: "PROVEN",
      savedToRecord: "PROVEN",
      learningBank: verdict ? "PROVEN_FOR_SELECTED_SCAN" : "ELIGIBLE_RECORD",
      nextScan: verdict && verdictProven ? {
        status: verdict.status,
        reasonCodes: verdict.reasonCodes,
        reasons: verdict.reasons,
        finalCaptureLinked: verdict.status === "USED" ? true : null,
        lessonDraftChangedByOperator: verdict.status === "USED"
          ? Boolean(finalLearning?.learning.lessonDraftChangedByOperator)
          : null,
        targetAnchors: verdict.status === "USED" && finalLearning
          ? [{ kind: "GEOMETRY", evidenceId: finalLearning.evidenceId, side: row.side }]
          : [],
      } : verdict?.status === "USED" ? {
        status: "UNPROVEN",
        reasonCodes: ["FINAL_CAPTURE_LEARNING_LINK_MISSING"],
        reasons: ["The scan emitted a learned draft, but the completed card did not retain its exact learning link."],
        finalCaptureLinked: false,
        lessonDraftChangedByOperator: null,
        targetAnchors: [],
      } : {
        status: "UNPROVEN",
        reasonCodes: ["NO_SELECTED_SCAN_GEOMETRY_VERDICT"],
        reasons: ["The selected later card has no immutable verdict for this exact physical correction."],
        finalCaptureLinked: null,
        lessonDraftChangedByOperator: null,
        targetAnchors: [],
      },
      repeatedMistake: "UNPROVEN_NO_EXPLICIT_REPEAT_EVIDENCE",
    }];
  });
}

export async function projectLearningBlueprintComparison(input: Readonly<{
  first: LearningBlueprintSessionRow;
  second: LearningBlueprintSessionRow;
  firstLabel: LearningBlueprintCompletionLabel;
  secondLabel: LearningBlueprintCompletionLabel;
  geometry: readonly LearningBlueprintGeometryRow[];
  events: readonly LearningBlueprintEventRow[];
  filtered: readonly LearningBlueprintMapFilterRow[];
  presignRead: (storageKey: string, expiresInSeconds: number) => Promise<string>;
}>) {
  const ordered = input.firstLabel.certificateSequence <= input.secondLabel.certificateSequence
    ? { earlier: input.first, earlierLabel: input.firstLabel, later: input.second, laterLabel: input.secondLabel }
    : { earlier: input.second, earlierLabel: input.secondLabel, later: input.first, laterLabel: input.firstLabel };
  const creatorBySession = new Map([
    [ordered.earlier.id, ordered.earlier.createdByUserId],
    [ordered.later.id, ordered.later.createdByUserId],
  ]);
  const bySession = (sessionId: string) => input.geometry.filter((row) => (
    row.sessionId === sessionId && row.createdByUserId === creatorBySession.get(sessionId)
  ));
  const eventsBySession = (sessionId: string) => input.events.filter((row) => (
    row.sessionId === sessionId && row.createdByUserId === creatorBySession.get(sessionId)
  ));
  const filteredBySession = (sessionId: string) => input.filtered.filter((row) => row.sessionId === sessionId);
  const earlierGeometry = bySession(ordered.earlier.id);
  const laterGeometry = bySession(ordered.later.id);
  const earlierWithGeometry = { ...ordered.earlier, geometry: earlierGeometry };
  const laterWithGeometry = { ...ordered.later, geometry: laterGeometry };
  const imageEntries = await Promise.all(
    [ordered.earlier, ordered.later].flatMap((session) => (["FRONT", "BACK"] as const).map(async (side) => ({
      sessionId: session.id,
      side,
      ...(await signLearningBlueprintImages({ session, side, presignRead: input.presignRead })),
    }))),
  );
  const images = new Map(imageEntries.map((entry) => [`${entry.sessionId}:${entry.side}`, entry]));
  const projectCard = (session: LearningBlueprintSessionRow) => {
    const defects = projectLearningBlueprintDefectOverlays({
      session,
      events: eventsBySession(session.id),
      filtered: filteredBySession(session.id),
    });
    return {
      summary: projectLearningBlueprintCard(
        session.id === ordered.earlier.id ? earlierWithGeometry : laterWithGeometry,
        session.id === ordered.earlier.id ? ordered.earlierLabel : ordered.laterLabel,
      ),
      sides: Object.fromEntries((["FRONT", "BACK"] as const).map((side) => {
        const image = images.get(`${session.id}:${side}`)!;
        return [side, {
          images: image.images,
          geometry: projectLearningBlueprintGeometryOverlays(bySession(session.id)).filter((row) => row.side === side),
          defects: defects.overlays.filter((row) => row.side === side),
          warnings: [...image.warnings, ...defects.warnings],
        }];
      })),
    };
  };
  const laterEvents = eventsBySession(ordered.later.id);
  const trails = [
    ...memoryTrails({
      earlier: ordered.earlier,
      earlierLabel: ordered.earlierLabel,
      laterSessionId: ordered.later.id,
      laterEvents,
    }),
    ...geometryTrails({
      earlier: ordered.earlier,
      later: ordered.later,
      earlierGeometry,
      laterGeometry,
      laterEvents,
    }),
  ];
  const counts = trails.reduce((result, trail) => {
    const status = trail.nextScan.status;
    if (status === "USED") result.used += 1;
    else if (status === "REJECTED") result.rejected += 1;
    else if (status === "SKIPPED") result.skipped += 1;
    else if (status === "NOT_TESTABLE") result.notTested += 1;
    else result.unproven += 1;
    return result;
  }, { used: 0, rejected: 0, skipped: 0, unproven: 0, notTested: 0 });
  const result = {
    version: SPEEDSTER_LEARNING_BLUEPRINT_VERSION,
    earlier: projectCard(ordered.earlier),
    later: projectCard(ordered.later),
    trails,
    pairSummary: { ...counts, repeatedMistakesProven: 0 },
  } as const;
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > SPEEDSTER_LEARNING_BLUEPRINT_MAX_RESPONSE_BYTES) {
    throw new Error("Learning Blueprint comparison exceeds its safe response budget.");
  }
  return result;
}
