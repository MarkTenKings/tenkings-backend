import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
  SpeedsterReviewFinding,
  SpeedsterTraceProvenance,
} from "../ai-grader-v2/contracts";
import { isSpeedsterSourceMeasuredDefect } from "../ai-grader-v2/contracts";
import type { SpeedsterInspectionFrame } from "../ai-grader-v2/inspection-frame";
import {
  parseSpeedsterReviewFindings,
  speedsterFindingRegions,
  speedsterTraceHashes,
  stripSpeedsterFindingPrivateFields,
  stripSpeedsterTraceBodies,
} from "../ai-grader-v2/review-findings";
import {
  calculateSpeedsterReview,
  remeasureSpeedsterReviewAction,
  scanSpeedsterCapture,
  type SpeedsterReviewMeasurementAction,
} from "../ai-grader-v2/review";
import type { SpeedsterCenteringBorders } from "../ai-grader-v2/scoring";
import {
  decodeSpeedsterTraceBitmapWireV1,
  type SpeedsterTraceBitmapWireV1,
} from "../ai-grader-v2/trace-bitmap-wire";
import { encodeSpeedsterTraceRleV1, type SpeedsterTraceRleV1 } from "../ai-grader-v2/trace-codec";
import { clipSpeedsterTraceToMaterial } from "../ai-grader-v2/trace-editor";
import { HttpError } from "./adminSessionAuthority";

type PersistedCaptureSide = {
  inspectionStorageKey: string;
  inspectionFrame: SpeedsterInspectionFrame;
  centeringBorders: SpeedsterCenteringBorders;
  viewStorageKeys: Readonly<Record<"NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
};

type PersistedCapture = {
  cornerShape: "ROUNDED_3_18_MM" | "SQUARE";
  front: PersistedCaptureSide;
  back: PersistedCaptureSide;
};

export type SpeedsterReviewActionSession = {
  id: string;
  createdByUserId: string;
  workflowState: string;
  capture: unknown;
  reviewedDefects: unknown;
  gradeReport: unknown;
  updatedAt: Date;
};

type TraceWireEdit = {
  traceWire: SpeedsterTraceBitmapWireV1;
  traceProvenance: SpeedsterTraceProvenance;
};

export type SpeedsterReviewAction =
  | { type: "INITIALIZE" }
  | { type: "TRACE_SAVE"; side: SpeedsterCardSide; findingId: string; trace: TraceWireEdit }
  | {
      type: "TRACE_SAVE";
      side: SpeedsterCardSide;
      findingId: null;
      trace: TraceWireEdit & { id: string; defectType: SpeedsterDefectType; sourceViewId: string };
    }
  | { type: "REMOVE"; defectId: string }
  | { type: "UNDO"; defectId: string }
  | { type: "CHANGE_TYPE"; defectId: string; defectType: SpeedsterDefectType };

export type SpeedsterReviewActionInput = {
  sessionId: string;
  createdByUserId: string;
  action: SpeedsterReviewAction;
};

type MeasureBody = {
  side: SpeedsterCardSide;
  cornerShape: PersistedCapture["cornerShape"];
  evidenceView: {
    id: string;
    imageUrl: string;
    inspectionFrame: SpeedsterInspectionFrame;
  };
  findings: readonly SpeedsterReviewFinding[];
  marks: readonly unknown[];
};

type DetectBody = {
  side: SpeedsterCardSide;
  cornerShape: PersistedCapture["cornerShape"];
  views: readonly { id: string; imageUrl: string }[];
  sessionId: string;
  requestTraceId: string;
  learningBank: unknown;
};

export type SpeedsterReviewActionDependencies = {
  loadOwnedSession: (
    identity: { sessionId: string; createdByUserId: string },
  ) => Promise<SpeedsterReviewActionSession | null>;
  persistReviewIfRevision: (
    identity: { sessionId: string; createdByUserId: string },
    expectedUpdatedAt: Date,
    data: { reviewedDefects: readonly unknown[]; gradeReport: unknown },
  ) => Promise<void>;
  presignRead: (storageKey: string, expiresInSeconds: number) => Promise<string>;
  learningBankForDetect: () => Promise<unknown>;
  detect: (body: DetectBody) => Promise<unknown>;
  measure: (body: MeasureBody) => Promise<{ defects: unknown }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function captureAuthority(value: unknown, sessionId: string, createdByUserId: string): PersistedCapture {
  if (!isRecord(value) || (value.cornerShape !== "SQUARE" && value.cornerShape !== "ROUNDED_3_18_MM")) {
    throw new Error("Speedster persisted capture is incomplete.");
  }
  const side = (name: SpeedsterCardSide): PersistedCaptureSide => {
    const candidate = value[name.toLowerCase()];
    if (
      !isRecord(candidate) || !isRecord(candidate.inspectionFrame) ||
      !isRecord(candidate.centeringBorders) || !isRecord(candidate.viewStorageKeys)
    ) {
      throw new Error("Speedster persisted capture is incomplete.");
    }
    const prefix = `ai-grader-v2/${createdByUserId}/${sessionId}/prepared/${name.toLowerCase()}`;
    const expected = {
      inspectionStorageKey: `${prefix}/inspection.webp`,
      NORMALIZED: `${prefix}/normalized.webp`,
      MICRO_DEFECT: `${prefix}/micro_defect.webp`,
      DIRECTIONAL: `${prefix}/directional.webp`,
    } as const;
    if (
      candidate.inspectionStorageKey !== expected.inspectionStorageKey ||
      candidate.viewStorageKeys.NORMALIZED !== expected.NORMALIZED ||
      candidate.viewStorageKeys.MICRO_DEFECT !== expected.MICRO_DEFECT ||
      candidate.viewStorageKeys.DIRECTIONAL !== expected.DIRECTIONAL
    ) {
      throw new Error("Speedster persisted inspection evidence is not owned by this session.");
    }
    return candidate as unknown as PersistedCaptureSide;
  };
  return { cornerShape: value.cornerShape, front: side("FRONT"), back: side("BACK") };
}

function detectorVersion(value: unknown): string {
  if (!isRecord(value) || typeof value.detectorVersion !== "string" || !value.detectorVersion.trim()) {
    throw new Error("Speedster detector version is missing from server-owned review state.");
  }
  return value.detectorVersion;
}

function measurementHash(finding: SpeedsterReviewFinding | undefined): string | null {
  if (!finding) return null;
  return createHash("sha256")
    .update(JSON.stringify(speedsterFindingRegions(finding)))
    .digest("hex");
}

function measurementDeltas(
  before: readonly SpeedsterReviewFinding[],
  after: readonly SpeedsterReviewFinding[],
) {
  const ids = new Set([...before.map(({ id }) => id), ...after.map(({ id }) => id)]);
  return [...ids].flatMap((findingId) => {
    const beforeSha256 = measurementHash(before.find(({ id }) => id === findingId));
    const afterSha256 = measurementHash(after.find(({ id }) => id === findingId));
    return beforeSha256 === afterSha256 ? [] : [{ findingId, beforeSha256, afterSha256 }];
  });
}

function validateTransition(findings: readonly SpeedsterReviewFinding[], action: SpeedsterReviewAction) {
  if (action.type === "INITIALIZE") return;
  if (action.type === "TRACE_SAVE") {
    if (action.findingId === null) {
      if (
        !action.trace.id.startsWith(`${action.side}:`) ||
        action.trace.sourceViewId !== `${action.side}:ORIGINAL` ||
        action.trace.traceProvenance.sourceViewId !== action.trace.sourceViewId
      ) {
        throw new HttpError(409, "A new Speedster trace must use its server-owned ORIGINAL source view.");
      }
      if (findings.some(({ id }) => id === action.trace.id)) {
        throw new HttpError(409, "Speedster trace finding ID is already in use.");
      }
      return;
    }
    const traceTarget = findings.find(({ id }) => id === action.findingId);
    if (!traceTarget) throw new HttpError(404, "Speedster review finding was not found.");
    if (traceTarget.reviewResult === "REMOVED") {
      throw new HttpError(409, "A removed Speedster finding cannot save a trace.");
    }
    if (traceTarget.side !== action.side) {
      throw new HttpError(409, "Speedster trace side does not match its finding.");
    }
    if (action.trace.traceProvenance.sourceViewId !== traceTarget.sourceViewId) {
      throw new HttpError(409, "Speedster trace source view does not match its finding.");
    }
    return;
  }
  const target = findings.find(({ id }) => id === action.defectId) as
    | (SpeedsterReviewFinding & { reviewResultBeforeRemoval?: unknown })
    | undefined;
  if (!target) throw new HttpError(404, "Speedster review finding was not found.");
  if (action.type === "REMOVE") {
    if (target.reviewResult === "REMOVED" || target.reviewResultBeforeRemoval !== undefined) {
      throw new HttpError(409, "Speedster review finding is already removed.");
    }
    return;
  }
  if (action.type === "UNDO") {
    if (target.reviewResult !== "REMOVED" || typeof target.reviewResultBeforeRemoval !== "string") {
      throw new HttpError(409, "Speedster review finding is not removed.");
    }
    return;
  }
  if (target.reviewResult === "REMOVED") {
    throw new HttpError(409, "A removed Speedster finding cannot change type.");
  }
}

function equalPixels(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function internalAction(
  action: Exclude<SpeedsterReviewAction, { type: "INITIALIZE" }>,
  cornerShape: PersistedCapture["cornerShape"],
): SpeedsterReviewMeasurementAction {
  if (action.type !== "TRACE_SAVE") return action;
  let pixels: Uint8Array;
  try {
    pixels = decodeSpeedsterTraceBitmapWireV1(action.trace.traceWire);
  } catch {
    throw new HttpError(400, "Speedster trace bitmap wire is invalid or empty.");
  }
  const clipped = clipSpeedsterTraceToMaterial(pixels, cornerShape);
  if (!equalPixels(pixels, clipped)) {
    throw new HttpError(400, "Speedster trace must already be clipped to the server-owned card material.");
  }
  const finalTrace = encodeSpeedsterTraceRleV1(pixels);
  const { traceWire: _wire, ...trace } = action.trace;
  return { ...action, trace: { ...trace, finalTrace } } as SpeedsterReviewMeasurementAction;
}

function foregroundPixelCount(trace: SpeedsterTraceRleV1) {
  return trace.runs.reduce((total, run, index) => total + (index % 2 === 1 ? run : 0), 0);
}

function reconcileMeasurementResponse(input: {
  side: SpeedsterCardSide;
  activeInputs: readonly SpeedsterReviewFinding[];
  rawDefects: unknown;
  newTrace: null | {
    id: string;
    sourceViewId: string;
    defectType: SpeedsterDefectType;
    finalTrace: SpeedsterTraceRleV1;
  };
}) {
  let measured: SpeedsterReviewFinding[];
  try {
    measured = parseSpeedsterReviewFindings(input.rawDefects);
  } catch {
    throw new HttpError(502, "Speedster measurement response is malformed.");
  }
  const measuredIds = measured.map(({ id }) => id);
  if (new Set(measuredIds).size !== measuredIds.length) {
    throw new HttpError(502, "Speedster measurement response contains a duplicate finding ID.");
  }
  if (measured.some(({ side }) => side !== input.side)) {
    throw new HttpError(502, "Speedster measurement response contains a finding on the wrong side.");
  }
  const expectedIds = new Set(input.activeInputs.map(({ id }) => id));
  const permittedIds = new Set(expectedIds);
  if (input.newTrace) permittedIds.add(input.newTrace.id);
  if (measuredIds.some((id) => !permittedIds.has(id))) {
    throw new HttpError(502, "Speedster measurement response contains an unexpected finding ID.");
  }
  if ([...expectedIds].some((id) => !measuredIds.includes(id))) {
    throw new HttpError(502, "Speedster measurement response is missing an active finding ID.");
  }

  const authorityById = new Map(input.activeInputs.map((finding) => [finding.id, finding] as const));
  for (const finding of measured) {
    if (!isSpeedsterSourceMeasuredDefect(finding)) {
      if (authorityById.get(finding.id)?.finalTrace || finding.id === input.newTrace?.id) {
        throw new HttpError(502, "Speedster measurement response dropped exact source-region authority.");
      }
      continue;
    }
    const prior = authorityById.get(finding.id);
    const authorityTrace = prior?.finalTrace ?? (finding.id === input.newTrace?.id ? input.newTrace.finalTrace : null);
    if (!authorityTrace || finding.finalTrace?.sha256 !== authorityTrace.sha256) {
      throw new HttpError(502, "Speedster measurement response trace does not match its stored source authority.");
    }
    if (finding.id === input.newTrace?.id) {
      if (
        finding.sourceViewId !== input.newTrace.sourceViewId ||
        finding.defectType !== input.newTrace.defectType
      ) {
        throw new HttpError(502, "Speedster measurement response changed the new trace source identity.");
      }
      if (finding.measurementRegions.length === 0) {
        throw new HttpError(502, "A new non-redundant trace must contain a measured source region.");
      }
    }
    let ownedPixels = 0;
    for (const region of finding.measurementRegions) {
      if (!Number.isSafeInteger(region.measurement.pixelCount) || Number(region.measurement.pixelCount) < 0) {
        throw new HttpError(502, "Speedster exact source region is missing its integer pixelCount.");
      }
      ownedPixels += Number(region.measurement.pixelCount);
    }
    if (ownedPixels > foregroundPixelCount(authorityTrace)) {
      throw new HttpError(502, "Speedster exact source regions exceed their stored trace pixel authority.");
    }
  }
  return measured;
}

async function serverOwnedInitialization(
  input: SpeedsterReviewActionInput,
  capture: PersistedCapture,
  deps: SpeedsterReviewActionDependencies,
) {
  const preparedSide = async (side: SpeedsterCardSide) => {
    const persisted = side === "FRONT" ? capture.front : capture.back;
    const entries = [
      ["ORIGINAL", persisted.inspectionStorageKey],
      ["NORMALIZED", persisted.viewStorageKeys.NORMALIZED],
      ["MICRO_DEFECT", persisted.viewStorageKeys.MICRO_DEFECT],
      ["DIRECTIONAL", persisted.viewStorageKeys.DIRECTIONAL],
    ] as const;
    const views = await Promise.all(entries.map(async ([view, storageKey]) => ({
      id: `${side}:${view}`,
      imageUrl: await deps.presignRead(storageKey, 60 * 10),
    })));
    return {
      side,
      rectifiedUrl: views[0].imageUrl,
      inspectionUrl: views[0].imageUrl,
      views: {
        NORMALIZED: views[1].imageUrl,
        MICRO_DEFECT: views[2].imageUrl,
        DIRECTIONAL: views[3].imageUrl,
      },
    };
  };
  const [front, back, learningBank] = await Promise.all([
    preparedSide("FRONT"),
    preparedSide("BACK"),
    deps.learningBankForDetect(),
  ]);
  let exactDetectorVersion: string | null = null;
  const scanned = await scanSpeedsterCapture({
    capture: { cornerShape: capture.cornerShape, front, back },
    detect: async (request) => {
      const rawResult = await deps.detect({
        ...request,
        sessionId: input.sessionId,
        requestTraceId: `${input.sessionId}:${request.side}:detect`,
        learningBank,
      });
      if (
        !isRecord(rawResult) || typeof rawResult.detectorVersion !== "string" ||
        !rawResult.detectorVersion.trim() || !Array.isArray(rawResult.defects)
      ) {
        throw new HttpError(502, "Speedster detector response is missing its version.");
      }
      if (rawResult.defects.some((finding) => !isRecord(finding) || finding.side !== request.side)) {
        throw new HttpError(502, "Speedster detector response contains a finding on the wrong side.");
      }
      const result = rawResult as { detectorVersion: string; defects: SpeedsterMeasuredDefect[] };
      if (exactDetectorVersion !== null && exactDetectorVersion !== result.detectorVersion) {
        throw new HttpError(502, "Front and Back Speedster detector versions do not match.");
      }
      exactDetectorVersion = result.detectorVersion;
      return result;
    },
  });
  if (!exactDetectorVersion || scanned.detectorVersion !== exactDetectorVersion) {
    throw new HttpError(502, "Speedster detector version could not be established.");
  }
  let initialized: SpeedsterReviewFinding[];
  try {
    initialized = parseSpeedsterReviewFindings(scanned.defects);
  } catch {
    throw new HttpError(502, "Speedster detector response is malformed.");
  }
  if (new Set(initialized.map(({ id }) => id)).size !== initialized.length) {
    throw new HttpError(502, "Speedster detector response contains a duplicate finding ID.");
  }
  if (initialized.some((finding) => finding.finalTrace || finding.reviewResult !== "UNREVIEWED")) {
    throw new HttpError(502, "Initial Speedster detector state contains reviewed trace authority.");
  }
  return { initialized, detectorVersion: exactDetectorVersion };
}

function resultPayload(
  before: readonly SpeedsterReviewFinding[],
  after: readonly SpeedsterReviewFinding[],
  gradeReport: Record<string, unknown>,
) {
  return {
    reviewedDefects: stripSpeedsterTraceBodies(after),
    gradeReport,
    measurementDeltas: measurementDeltas(before, after),
    traceHashes: speedsterTraceHashes(after),
  };
}

export async function applySpeedsterReviewAction(
  input: SpeedsterReviewActionInput,
  deps: SpeedsterReviewActionDependencies,
) {
  const identity = { sessionId: input.sessionId, createdByUserId: input.createdByUserId };
  const session = await deps.loadOwnedSession(identity);
  if (!session) throw new HttpError(404, "Speedster session not found.");
  if (session.id !== input.sessionId || session.createdByUserId !== input.createdByUserId) {
    throw new HttpError(403, "Speedster session ownership does not match the review action.");
  }
  if (session.workflowState !== "CAPTURED") {
    throw new HttpError(409, "Only a CAPTURED Speedster session can accept review actions.");
  }
  if (!(session.updatedAt instanceof Date) || !Number.isFinite(session.updatedAt.getTime())) {
    throw new Error("Speedster persisted review revision is invalid.");
  }
  const capture = captureAuthority(session.capture, session.id, session.createdByUserId);
  const before = parseSpeedsterReviewFindings(session.reviewedDefects);

  if (input.action.type === "INITIALIZE") {
    const hasGradeReport = isRecord(session.gradeReport) && Object.keys(session.gradeReport).length !== 0;
    if (before.length !== 0 || hasGradeReport) {
      if (!hasGradeReport || before.some((finding) => finding.finalTrace || finding.reviewResult !== "UNREVIEWED")) {
        throw new HttpError(409, "Speedster detector review state is not coherently initialized.");
      }
      const version = detectorVersion(session.gradeReport);
      const review = calculateSpeedsterReview(capture, before);
      const gradeReport = { ...review.grade, detectorVersion: version };
      if (!isDeepStrictEqual(session.gradeReport, gradeReport)) {
        throw new HttpError(409, "Speedster detector review state is not coherently initialized.");
      }
      return resultPayload(before, review.defects, gradeReport);
    }
    const detected = await serverOwnedInitialization(input, capture, deps);
    const review = calculateSpeedsterReview(capture, detected.initialized);
    const gradeReport = { ...review.grade, detectorVersion: detected.detectorVersion };
    await deps.persistReviewIfRevision(identity, session.updatedAt, {
      reviewedDefects: review.defects,
      gradeReport,
    });
    return resultPayload(before, review.defects, gradeReport);
  }

  validateTransition(before, input.action);
  const version = detectorVersion(session.gradeReport);
  const authoritativeAction = internalAction(input.action, capture.cornerShape);
  const measuredDefects = await remeasureSpeedsterReviewAction({
    defects: before,
    action: authoritativeAction,
    measure: async ({ side, findings, marks }) => {
      const captureSide = side === "FRONT" ? capture.front : capture.back;
      const result = await deps.measure({
        side,
        cornerShape: capture.cornerShape,
        evidenceView: {
          id: `${side}:ORIGINAL`,
          imageUrl: await deps.presignRead(captureSide.inspectionStorageKey, 60 * 10),
          inspectionFrame: captureSide.inspectionFrame,
        },
        findings: findings.map(stripSpeedsterFindingPrivateFields),
        marks,
      });
      const newTrace = authoritativeAction.type === "TRACE_SAVE" && authoritativeAction.findingId === null
        ? {
            id: authoritativeAction.trace.id,
            sourceViewId: authoritativeAction.trace.sourceViewId,
            defectType: authoritativeAction.trace.defectType,
            finalTrace: authoritativeAction.trace.finalTrace,
          }
        : null;
      return {
        defects: reconcileMeasurementResponse({
          side,
          activeInputs: findings,
          rawDefects: result.defects,
          newTrace,
        }),
      };
    },
  });
  const review = calculateSpeedsterReview(capture, measuredDefects);
  const gradeReport = { ...review.grade, detectorVersion: version };
  await deps.persistReviewIfRevision(identity, session.updatedAt, {
    reviewedDefects: review.defects,
    gradeReport,
  });
  return resultPayload(before, review.defects, gradeReport);
}
