import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";

import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
  SpeedsterReviewFinding,
  SpeedsterTraceProvenance,
} from "../ai-grader-v2/contracts";
import { isSpeedsterSourceMeasuredDefect } from "../ai-grader-v2/contracts";
import {
  assertSpeedsterDetectorEvidenceBindsFindings,
  parseSpeedsterDetectorEvidence,
  type SpeedsterDetectorEvidenceV1,
} from "../ai-grader-v2/detector-evidence";
import type { SpeedsterInspectionFrame } from "../ai-grader-v2/inspection-frame";
import {
  canonicalizeSpeedsterSessionIdentity,
  type SpeedsterSessionIdentity,
} from "../ai-grader-v2/identity";
import { SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION } from "../ai-grader-v2/learning-calibration-v2";
import {
  splitSpeedsterMapFilteredCandidates,
  type SpeedsterPinnedMapFilterInput,
  validateSpeedsterPinnedMapFilterInput,
} from "../ai-grader-v2/map-filter";
import {
  type SpeedsterFilterDecisionEvidence,
} from "../ai-grader-v2/card-type-map-contracts";
import {
  parseSpeedsterReviewFindings,
  speedsterFindingRegions,
  speedsterTraceHashes,
  stripSpeedsterFindingInstrumentation,
  stripSpeedsterFindingPrivateFields,
  stripSpeedsterTraceBodies,
} from "../ai-grader-v2/review-findings";
import {
  calculateSpeedsterReview,
  remeasureSpeedsterReviewAction,
  scanSpeedsterCapture,
  speedsterCanonicalDetectorFindingId,
  type SpeedsterReviewMeasurementAction,
} from "../ai-grader-v2/review";
import type { SpeedsterCenteringBorders } from "../ai-grader-v2/scoring";
import {
  decodeSpeedsterTraceBitmapWireV1,
  type SpeedsterTraceBitmapWireV1,
} from "../ai-grader-v2/trace-bitmap-wire";
import { encodeSpeedsterTraceRleV1, type SpeedsterTraceRleV1 } from "../ai-grader-v2/trace-codec";
import { clipSpeedsterTraceToMaterial } from "../ai-grader-v2/trace-editor";
import {
  speedsterFilterRemovedEvents,
  speedsterDetectorEvidenceEvents,
  speedsterFindingActionEvents,
  speedsterFindingProposalEvents,
  speedsterServerTimingEvent,
  type SpeedsterInstrumentationEvent,
  type SpeedsterOperatorInstrumentationAction,
} from "./aiGraderV2Instrumentation";
import {
  boundedDuration,
  SPEEDSTER_DETECT_WORKER_ID_UNAVAILABLE,
  speedsterDetectTransportEvidence,
  SpeedsterDetectUpstreamError,
  type SpeedsterDetectWorkerIdentity,
} from "./aiGraderV2DetectTransport";
import {
  SPEEDSTER_DETECTION_SIDE_CHECKPOINT_VERSION,
  parseSpeedsterDetectorIdentityV1,
  speedsterDetectionOperationId,
  speedsterDetectionSha256,
  type SpeedsterDetectionAssetBinding,
  type SpeedsterDetectionSideBinding,
  type SpeedsterDetectionSideCheckpoint,
  type SpeedsterDetectorIdentityV1,
  type UnsignedSpeedsterDetectionSideCheckpoint,
} from "./speedsterDetectionSideCheckpoint";
import { HttpError } from "./adminSessionAuthority";
import { assertSpeedsterMapRevisionAppliesToIdentity } from "./speedsterCardTypeMaps";
import {
  isAuthorizedSpeedsterOriginalStorageKey,
  isAuthorizedSpeedsterPreparedStorageKeys,
  speedsterOriginalStorageGeneration,
  speedsterPreparedStorageGenerationForRectified,
} from "./aiGraderV2IphoneCapture";

type PersistedCaptureSide = {
  originalStorageKey: string;
  rectifiedStorageKey: string;
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
  cardProfile?: string;
  workflowState: string;
  identity?: unknown;
  capture: unknown;
  reviewedDefects: unknown;
  gradeReport: unknown;
  mapRevisionId?: string | null;
  mapFilterPolicyVersion?: string | null;
  mapRegistration?: unknown;
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
  | { type: "REMOVE"; defectIds: readonly string[] }
  | { type: "UNDO"; defectIds: readonly string[] }
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

export type SpeedsterDetectionCheckpointLookup = Readonly<{
  sessionId: string;
  createdByUserId: string;
  sessionRevision: string;
  captureBindingSha256: string;
  operationId: string;
}>;

export type SpeedsterDetectorAttemptEvidence = Readonly<{
  side: SpeedsterCardSide;
  requestTraceId: string;
  attemptNumber: 1 | 2;
  retryReason: "RUNPOD_HTTP_502" | null;
  outcome: "SUCCEEDED" | "FAILED";
  upstreamStatus: number | null;
  workerIdentity: SpeedsterDetectWorkerIdentity;
  clientDurationMs: number;
  serverDurationMs: number;
  serviceDurationMs: number | null;
}>;

export type SpeedsterReviewActionDependencies = {
  assertDetectionRuntimeAuthority?: () => void;
  loadOwnedSession: (
    identity: { sessionId: string; createdByUserId: string },
  ) => Promise<SpeedsterReviewActionSession | null>;
  persistReviewIfRevision: (
    identity: { sessionId: string; createdByUserId: string },
    expectedUpdatedAt: Date,
    data: {
      reviewedDefects: readonly unknown[];
      gradeReport: unknown;
      filterDecisions?: readonly SpeedsterFilterDecisionEvidence[];
      detectorEvidenceEvents?: readonly SpeedsterInstrumentationEvent[];
      detectionPair?: Readonly<{
        operationId: string;
        captureBindingSha256: string;
        memorySnapshotSha256: string;
        frontReceiptHmacSha256: string;
        backReceiptHmacSha256: string;
      }>;
    },
  ) => Promise<void>;
  loadPinnedMapFilter?: (
    session: SpeedsterReviewActionSession & { mapRevisionId: string },
  ) => Promise<SpeedsterPinnedMapFilterInput>;
  presignRead: (storageKey: string, expiresInSeconds: number) => Promise<string>;
  learningBankForDetect: () => Promise<unknown>;
  detect: (
    body: DetectBody,
    request?: Readonly<{ signal: AbortSignal; deadlineMs: number }>,
  ) => Promise<unknown>;
  measure: (body: MeasureBody) => Promise<{ defects: unknown }>;
  recordInstrumentation?: (events: readonly SpeedsterInstrumentationEvent[]) => Promise<unknown>;
  hashDetectionEvidence?: (storageKey: string) => Promise<string>;
  loadDetectionSideCheckpoints?: (
    lookup: SpeedsterDetectionCheckpointLookup,
  ) => Promise<Partial<Record<SpeedsterCardSide, SpeedsterDetectionSideCheckpoint>>>;
  persistDetectionSideCheckpoint?: (
    checkpoint: UnsignedSpeedsterDetectionSideCheckpoint,
  ) => Promise<SpeedsterDetectionSideCheckpoint>;
  detectionDeadlineMs?: number;
  requireDetectorIdentityV1?: boolean;
  now?: () => number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const safeTimingNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function safeDetectorTiming(value: unknown): Prisma.InputJsonObject | null {
  if (!isRecord(value) || value.version !== "speedster-service-timing-v1") return null;
  const numbers = [
    "imageLoadTotalMs",
    "detectorDurationMs",
    "serviceTotalMs",
    "localizedCandidateCount",
    "scannedCandidateCount",
    "cappedCandidateCount",
    "measuredRegionCount",
    "samMemoryMs",
    "measurementMs",
    "detectViewsTotalMs",
  ] as const;
  const output: Record<string, Prisma.InputJsonValue> = {
    version: "speedster-service-timing-v1",
    ...(typeof value.side === "string" ? { side: value.side.slice(0, 16) } : {}),
    ...(typeof value.requestTraceId === "string"
      ? { requestTraceId: value.requestTraceId.slice(0, 180) }
      : {}),
  };
  for (const key of numbers) {
    const number = safeTimingNumber(value[key]);
    if (number !== null) output[key] = number;
  }
  const compactViews = (candidate: unknown, includeDimensions: boolean) => Array.isArray(candidate)
    ? candidate.slice(0, 8).flatMap((entry): Prisma.InputJsonObject[] => {
        if (!isRecord(entry) || typeof entry.viewId !== "string") return [];
        const durationMs = safeTimingNumber(entry.durationMs ?? entry.localizationMs);
        const count = safeTimingNumber(entry.candidateCount);
        const width = safeTimingNumber(entry.width);
        const height = safeTimingNumber(entry.height);
        return [{
          viewId: entry.viewId.slice(0, 180),
          ...(durationMs !== null ? { durationMs } : {}),
          ...(count !== null ? { candidateCount: count } : {}),
          ...(includeDimensions && width !== null ? { width } : {}),
          ...(includeDimensions && height !== null ? { height } : {}),
        }];
      })
    : [];
  output.imageLoads = compactViews(value.imageLoads, true);
  output.views = compactViews(value.views, false);
  return output as Prisma.InputJsonObject;
}

async function recordInstrumentationFailOpen(
  deps: SpeedsterReviewActionDependencies,
  sessionId: string,
  events: readonly SpeedsterInstrumentationEvent[],
) {
  try {
    await deps.recordInstrumentation?.(events);
  } catch (error) {
    console.error(`[Speedster] Review instrumentation failed for ${sessionId}:`, error);
  }
}

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
    if (typeof candidate.originalStorageKey !== "string"
      || typeof candidate.rectifiedStorageKey !== "string"
      || typeof candidate.inspectionStorageKey !== "string"
      || typeof candidate.viewStorageKeys.NORMALIZED !== "string"
      || typeof candidate.viewStorageKeys.MICRO_DEFECT !== "string"
      || typeof candidate.viewStorageKeys.DIRECTIONAL !== "string"
      || !isAuthorizedSpeedsterOriginalStorageKey({
        storageKey: candidate.originalStorageKey,
        userId: createdByUserId,
        sessionId,
        side: name,
      })
      || !isAuthorizedSpeedsterPreparedStorageKeys({
        userId: createdByUserId,
        sessionId,
        side: name,
        rectifiedStorageKey: candidate.rectifiedStorageKey,
        inspectionStorageKey: candidate.inspectionStorageKey,
        viewStorageKeys: {
          NORMALIZED: candidate.viewStorageKeys.NORMALIZED,
          MICRO_DEFECT: candidate.viewStorageKeys.MICRO_DEFECT,
          DIRECTIONAL: candidate.viewStorageKeys.DIRECTIONAL,
        },
      })
      || speedsterOriginalStorageGeneration({
        storageKey: candidate.originalStorageKey,
        userId: createdByUserId,
        sessionId,
        side: name,
      }) !== speedsterPreparedStorageGenerationForRectified({
        storageKey: candidate.rectifiedStorageKey,
        userId: createdByUserId,
        sessionId,
        side: name,
      })) {
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
  if (action.type === "REMOVE" || action.type === "UNDO") {
    if (action.defectIds.length === 0 || new Set(action.defectIds).size !== action.defectIds.length) {
      throw new HttpError(409, "Speedster batch review action requires unique finding IDs.");
    }
    const targets = action.defectIds.flatMap((defectId) => {
      const target = findings.find(({ id }) => id === defectId) as
        | (SpeedsterReviewFinding & { reviewResultBeforeRemoval?: unknown })
        | undefined;
      return target ? [target] : [];
    });
    if (targets.length !== action.defectIds.length) {
      throw new HttpError(404, "Speedster review finding was not found.");
    }
    if (targets.some(({ side }) => side !== targets[0].side)) {
      throw new HttpError(409, "Speedster batch review action must stay on one card side.");
    }
    for (const target of targets) {
      if (action.type === "REMOVE" && (
        target.reviewResult === "REMOVED" || target.reviewResultBeforeRemoval !== undefined
      )) {
        throw new HttpError(409, "Speedster review finding is already removed.");
      }
      if (action.type === "UNDO" && (
        target.reviewResult !== "REMOVED" || typeof target.reviewResultBeforeRemoval !== "string"
      )) {
        throw new HttpError(409, "Speedster review finding is not removed.");
      }
    }
    return;
  }
  const target = findings.find(({ id }) => id === action.defectId);
  if (!target) throw new HttpError(404, "Speedster review finding was not found.");
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

function validatedDetectorSideResult(
  side: SpeedsterCardSide,
  rawResult: unknown,
  requireDetectorIdentityV1: boolean,
) {
  if (
    !isRecord(rawResult) || typeof rawResult.detectorVersion !== "string" ||
    !rawResult.detectorVersion.trim() || !Array.isArray(rawResult.defects)
  ) {
    throw new HttpError(502, "Speedster detector response is missing its version.");
  }
  let defects: SpeedsterReviewFinding[];
  let detectorEvidence: SpeedsterDetectorEvidenceV1;
  let detectorIdentity: SpeedsterDetectorIdentityV1 | null = null;
  try {
    defects = parseSpeedsterReviewFindings(rawResult.defects);
    detectorEvidence = parseSpeedsterDetectorEvidence(rawResult.detectorEvidence);
    assertSpeedsterDetectorEvidenceBindsFindings(detectorEvidence, defects);
    if (detectorEvidence.memoryDecisions.some(({ policy }) => policy === "LEGACY_MEMORY_V1")) {
      throw new Error("Legacy Memory evidence cannot enter a current grade.");
    }
    if (rawResult.detectorIdentity !== undefined && rawResult.detectorIdentity !== null) {
      detectorIdentity = parseSpeedsterDetectorIdentityV1(rawResult.detectorIdentity);
    }
  } catch {
    throw new HttpError(502, `Speedster ${side} detector response or evidence is malformed.`);
  }
  if (requireDetectorIdentityV1 && detectorIdentity === null) {
    throw new HttpError(502, `Speedster ${side} detector response lacks required release/model identity.`);
  }
  if (detectorIdentity && detectorIdentity.detectorVersion !== rawResult.detectorVersion) {
    throw new HttpError(502, `Speedster ${side} detector response has mismatched release/model identity.`);
  }
  if (defects.some((finding) => finding.side !== side)) {
    throw new HttpError(502, "Speedster detector response contains a finding on the wrong side.");
  }
  if (defects.some((finding) => finding.finalTrace || finding.reviewResult !== "UNREVIEWED")) {
    throw new HttpError(502, `Speedster ${side} detector response contains reviewed trace authority.`);
  }
  const measuredDefects = defects as SpeedsterMeasuredDefect[];
  if (
    new Set(measuredDefects.map((finding) =>
      speedsterCanonicalDetectorFindingId(side, finding))).size !== measuredDefects.length
  ) {
    throw new HttpError(502, `Speedster ${side} detector response contains a duplicate finding ID.`);
  }
  return {
    detectorVersion: rawResult.detectorVersion,
    detectorIdentity,
    detectorEvidence,
    defects: measuredDefects,
    instrumentation: safeDetectorTiming(rawResult.instrumentation),
  };
}

async function serverOwnedInitialization(
  input: SpeedsterReviewActionInput,
  capture: PersistedCapture,
  sessionRevision: Date,
  deps: SpeedsterReviewActionDependencies,
) {
  deps.assertDetectionRuntimeAuthority?.();
  const recoveryDependencies = [
    deps.hashDetectionEvidence,
    deps.loadDetectionSideCheckpoints,
    deps.persistDetectionSideCheckpoint,
  ];
  const recoveryEnabled = recoveryDependencies.every(Boolean);
  if (!recoveryEnabled && recoveryDependencies.some(Boolean)) {
    throw new Error("Speedster per-side detection recovery dependencies are incomplete.");
  }
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
    let binding: SpeedsterDetectionSideBinding | null = null;
    if (recoveryEnabled) {
      const assetInputs: readonly Omit<SpeedsterDetectionAssetBinding, "sha256">[] = [
        { role: "SOURCE_ORIGINAL", storageKey: persisted.originalStorageKey },
        { role: "RECTIFIED", storageKey: persisted.rectifiedStorageKey },
        { role: "INSPECTION", storageKey: persisted.inspectionStorageKey },
        { role: "NORMALIZED", storageKey: persisted.viewStorageKeys.NORMALIZED },
        { role: "MICRO_DEFECT", storageKey: persisted.viewStorageKeys.MICRO_DEFECT },
        { role: "DIRECTIONAL", storageKey: persisted.viewStorageKeys.DIRECTIONAL },
      ];
      const assets = await Promise.all(assetInputs.map(async (asset) => ({
        ...asset,
        sha256: await deps.hashDetectionEvidence!(asset.storageKey),
      })));
      if (assets.some(({ sha256 }) => !/^[a-f0-9]{64}$/.test(sha256))) {
        throw new Error(`Speedster ${side} detection source hash is invalid.`);
      }
      binding = {
        side,
        assets,
        bindingSha256: speedsterDetectionSha256({ side, assets }),
      };
    }
    return {
      side,
      rectifiedUrl: views[0].imageUrl,
      inspectionUrl: views[0].imageUrl,
      views: {
        NORMALIZED: views[1].imageUrl,
        MICRO_DEFECT: views[2].imageUrl,
        DIRECTIONAL: views[3].imageUrl,
      },
      binding,
    };
  };
  const now = deps.now ?? Date.now;
  const [front, back] = await Promise.all([
    preparedSide("FRONT"),
    preparedSide("BACK"),
  ]);
  const sessionRevisionIso = sessionRevision.toISOString();
  const captureBindingSha256 = speedsterDetectionSha256({
    cornerShape: capture.cornerShape,
    front: front.binding,
    back: back.binding,
  });
  const operationId = recoveryEnabled
    ? speedsterDetectionOperationId({
        sessionId: input.sessionId,
        sessionRevision: sessionRevisionIso,
        captureBindingSha256,
      })
    : randomUUID().replaceAll("-", "").slice(0, 24);
  const checkpointLookup: SpeedsterDetectionCheckpointLookup = {
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    sessionRevision: sessionRevisionIso,
    captureBindingSha256,
    operationId,
  };
  const recoveredSides = recoveryEnabled
    ? await deps.loadDetectionSideCheckpoints!(checkpointLookup)
    : {};
  const recoveredSnapshots = Object.values(recoveredSides).map((checkpoint) => checkpoint?.memorySnapshot);
  const recoveredMemoryHashes = new Set(Object.values(recoveredSides)
    .map((checkpoint) => checkpoint?.memorySnapshotSha256)
    .filter((value): value is string => Boolean(value)));
  if (recoveredMemoryHashes.size > 1) {
    throw new HttpError(409, "Speedster saved Front/Back detector work has incompatible Memory authority.");
  }
  const learningStartedAt = now();
  const learningBank = recoveredSnapshots[0] ?? await deps.learningBankForDetect();
  const learning = {
    bank: learningBank,
    durationMs: recoveredSnapshots.length > 0 ? 0 : boundedDuration(now() - learningStartedAt),
  };
  const memorySnapshotSha256 = speedsterDetectionSha256(learningBank);
  if (recoveredMemoryHashes.size === 1 && !recoveredMemoryHashes.has(memorySnapshotSha256)) {
    throw new HttpError(409, "Speedster saved detector work does not match its Memory snapshot.");
  }
  const detectorTimings: Partial<Record<SpeedsterCardSide, Prisma.InputJsonObject>> = {};
  const detectorIdentities: Partial<Record<SpeedsterCardSide, SpeedsterDetectorIdentityV1 | null>> = {};
  const attemptEvidence: SpeedsterDetectorAttemptEvidence[] = [];
  const durableDetectorEvidenceEvents: SpeedsterInstrumentationEvent[] = [];
  const attemptEvents = () => attemptEvidence.map((attempt) => speedsterServerTimingEvent({
    eventKey: `${input.sessionId}:server:detect-attempt:${attempt.requestTraceId}`,
    sessionId: input.sessionId,
    createdByUserId: input.createdByUserId,
    eventType: "DETECTOR_SIDE_ATTEMPT",
    durationMs: attempt.serverDurationMs,
    details: attempt as unknown as Prisma.InputJsonValue,
  }));
  const deadlineMs = deps.detectionDeadlineMs ?? 55_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120_000) {
    throw new Error("Speedster detector deadline must be between 1 millisecond and 120 seconds.");
  }
  const detectBeforeDeadline = async (body: DetectBody) => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new HttpError(
            504,
            `Speedster ${body.side} detector deadline elapsed before a response was accepted.`,
          ));
        }, deadlineMs);
      });
      return await Promise.race([
        deps.detect(body, { signal: controller.signal, deadlineMs }),
        deadline,
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      controller.abort();
    }
  };

  const terminalFailure = (
    side: SpeedsterCardSide,
    requestTraceId: string,
    attemptNumber: 1 | 2,
    error: unknown,
  ) => {
    if (error instanceof SpeedsterDetectUpstreamError) {
      const priorRetry = attemptNumber === 2 ? " after its one-time RunPod HTTP 502 retry" : "";
      return new HttpError(
        error.upstreamStatus >= 500 ? 502 : 400,
        `Speedster ${side} scan failed${priorRetry}: RunPod returned HTTP ${error.upstreamStatus} (request ID ${requestTraceId}).`,
      );
    }
    if (error instanceof HttpError) {
      return new HttpError(
        error.statusCode,
        `Speedster ${side} scan failed (request ID ${requestTraceId}): ${error.message}`,
      );
    }
    const priorRetry = attemptNumber === 2 ? " after its one-time RunPod HTTP 502 retry" : "";
    return new HttpError(
      502,
      `Speedster ${side} detector request failed${priorRetry} without an upstream HTTP status (request ID ${requestTraceId}); no further automatic retry is permitted.`,
    );
  };

  let scanned: Awaited<ReturnType<typeof scanSpeedsterCapture>>;
  let initialized: SpeedsterReviewFinding[];
  try {
    scanned = await scanSpeedsterCapture({
      capture: { cornerShape: capture.cornerShape, front, back },
      detect: async (request) => {
        const baseBody = {
          ...request,
          sessionId: input.sessionId,
          learningBank,
        };
        const prepared = request.side === "FRONT" ? front : back;
        const recovered = recoveredSides[request.side];
        if (recovered) {
          if (
            recovered.sessionId !== input.sessionId
            || recovered.createdByUserId !== input.createdByUserId
            || recovered.sessionRevision !== sessionRevisionIso
            || recovered.operationId !== operationId
            || recovered.captureBindingSha256 !== captureBindingSha256
            || recovered.side !== request.side
            || !prepared.binding
            || !isDeepStrictEqual(recovered.sideBinding, prepared.binding)
            || recovered.memorySnapshotSha256 !== memorySnapshotSha256
            || !isDeepStrictEqual(recovered.memorySnapshot, learningBank)
            || recovered.resultSha256 !== speedsterDetectionSha256(recovered.result)
          ) {
            throw new HttpError(409, `Speedster saved ${request.side} detector work does not match current authority.`);
          }
          const restored = validatedDetectorSideResult(
            request.side,
            recovered.result,
            deps.requireDetectorIdentityV1 === true,
          );
          if (
            recovered.detectorVersion !== restored.detectorVersion
            || !isDeepStrictEqual(recovered.detectorIdentity, restored.detectorIdentity)
          ) {
            throw new HttpError(409, `Speedster saved ${request.side} detector release identity changed.`);
          }
          if (restored.instrumentation) detectorTimings[request.side] = restored.instrumentation;
          detectorIdentities[request.side] = restored.detectorIdentity;
          durableDetectorEvidenceEvents.push(...speedsterDetectorEvidenceEvents({
            sessionId: input.sessionId,
            createdByUserId: input.createdByUserId,
            operationId,
            requestTraceId: recovered.requestTraceId,
            detectorVersion: restored.detectorVersion,
            evidence: restored.detectorEvidence,
          }));
          return { detectorVersion: restored.detectorVersion, defects: restored.defects };
        }
        const requestNonce = randomUUID().replaceAll("-", "").slice(0, 12);
        for (const attemptNumber of [1, 2] as const) {
          const requestOperation = recoveryEnabled ? `${operationId}:${requestNonce}` : operationId;
          const requestTraceId = `${input.sessionId}:${request.side}:detect:${requestOperation}:a${attemptNumber}`;
          const attemptStartedAt = now();
          let rawResult: unknown;
          let rawResolved = false;
          try {
            rawResult = await detectBeforeDeadline({ ...baseBody, requestTraceId });
            rawResolved = true;
            const accepted = validatedDetectorSideResult(
              request.side,
              rawResult,
              deps.requireDetectorIdentityV1 === true,
            );
            const timing = accepted.instrumentation;
            const transport = speedsterDetectTransportEvidence(rawResult);
            const serverDurationMs = boundedDuration(now() - attemptStartedAt);
            attemptEvidence.push({
              side: request.side,
              requestTraceId,
              attemptNumber,
              retryReason: attemptNumber === 2 ? "RUNPOD_HTTP_502" : null,
              outcome: "SUCCEEDED",
              upstreamStatus: transport?.upstreamStatus ?? 200,
              workerIdentity: transport?.workerIdentity ?? SPEEDSTER_DETECT_WORKER_ID_UNAVAILABLE,
              clientDurationMs: transport?.upstreamDurationMs ?? serverDurationMs,
              serverDurationMs,
              serviceDurationMs: typeof timing?.serviceTotalMs === "number"
                ? timing.serviceTotalMs
                : null,
            });
            if (timing) detectorTimings[request.side] = timing;
            detectorIdentities[request.side] = accepted.detectorIdentity;
            const durableResult = {
              detectorVersion: accepted.detectorVersion,
              defects: accepted.defects,
              detectorEvidence: accepted.detectorEvidence,
              ...(accepted.detectorIdentity ? { detectorIdentity: accepted.detectorIdentity } : {}),
              ...(timing ? { instrumentation: timing } : {}),
            };
            if (recoveryEnabled) {
              if (!prepared.binding) throw new Error("Speedster detection side binding is unavailable.");
              const unsigned: UnsignedSpeedsterDetectionSideCheckpoint = {
                version: SPEEDSTER_DETECTION_SIDE_CHECKPOINT_VERSION,
                sessionId: input.sessionId,
                createdByUserId: input.createdByUserId,
                sessionRevision: sessionRevisionIso,
                operationId,
                captureBindingSha256,
                side: request.side,
                sideBinding: prepared.binding,
                memorySnapshot: learningBank,
                memorySnapshotSha256,
                detectorVersion: accepted.detectorVersion,
                detectorIdentity: accepted.detectorIdentity,
                detectorIdentitySha256: accepted.detectorIdentity
                  ? speedsterDetectionSha256(accepted.detectorIdentity)
                  : null,
                requestTraceId,
                result: durableResult,
                resultSha256: speedsterDetectionSha256(durableResult),
                createdAt: new Date(now()).toISOString(),
              };
              const persisted = await deps.persistDetectionSideCheckpoint!(unsigned);
              if (
                persisted.operationId !== operationId || persisted.side !== request.side
                || persisted.resultSha256 !== unsigned.resultSha256
                || persisted.captureBindingSha256 !== captureBindingSha256
                || persisted.memorySnapshotSha256 !== memorySnapshotSha256
              ) {
                throw new HttpError(409, `Speedster ${request.side} detector checkpoint did not preserve exact authority.`);
              }
              recoveredSides[request.side] = persisted;
            }
            durableDetectorEvidenceEvents.push(...speedsterDetectorEvidenceEvents({
              sessionId: input.sessionId,
              createdByUserId: input.createdByUserId,
              operationId,
              requestTraceId,
              detectorVersion: accepted.detectorVersion,
              evidence: accepted.detectorEvidence,
            }));
            return {
              detectorVersion: accepted.detectorVersion,
              defects: accepted.defects,
            };
          } catch (error) {
            const serverDurationMs = boundedDuration(now() - attemptStartedAt);
            const transport = rawResolved ? speedsterDetectTransportEvidence(rawResult) : null;
            const upstreamFailure = error instanceof SpeedsterDetectUpstreamError ? error : null;
            const timing = rawResolved && isRecord(rawResult)
              ? safeDetectorTiming(rawResult.instrumentation)
              : null;
            attemptEvidence.push({
              side: request.side,
              requestTraceId,
              attemptNumber,
              retryReason: attemptNumber === 2 ? "RUNPOD_HTTP_502" : null,
              outcome: "FAILED",
              upstreamStatus: upstreamFailure?.upstreamStatus
                ?? transport?.upstreamStatus
                ?? (rawResolved ? 200 : null),
              workerIdentity: upstreamFailure?.workerIdentity
                ?? transport?.workerIdentity
                ?? SPEEDSTER_DETECT_WORKER_ID_UNAVAILABLE,
              clientDurationMs: upstreamFailure?.upstreamDurationMs
                ?? transport?.upstreamDurationMs
                ?? serverDurationMs,
              serverDurationMs,
              serviceDurationMs: typeof timing?.serviceTotalMs === "number"
                ? timing.serviceTotalMs
                : null,
            });
            if (
              attemptNumber === 1
              && error instanceof SpeedsterDetectUpstreamError
              && error.upstreamStatus === 502
            ) {
              continue;
            }
            throw terminalFailure(request.side, requestTraceId, attemptNumber, error);
          }
        }
        throw new Error("Speedster detector retry boundary was exhausted.");
      },
    });
    if (!scanned.detectorVersion.trim()) {
      throw new HttpError(502, "Speedster detector version could not be established.");
    }
    if (
      (detectorIdentities.FRONT === null) !== (detectorIdentities.BACK === null)
      || (detectorIdentities.FRONT && detectorIdentities.BACK
        && !isDeepStrictEqual(detectorIdentities.FRONT, detectorIdentities.BACK))
    ) {
      throw new HttpError(409, "Front and Back Speedster detector release/model identities do not match.");
    }
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
  } catch (error) {
    await recordInstrumentationFailOpen(deps, input.sessionId, attemptEvents());
    throw error;
  }

  const instrumentationEvents: SpeedsterInstrumentationEvent[] = [
    ...attemptEvents(),
    speedsterServerTimingEvent({
      eventKey: `${input.sessionId}:server:memory-bank-loaded`,
      sessionId: input.sessionId,
      createdByUserId: input.createdByUserId,
      eventType: "MEMORY_BANK_LOADED",
      durationMs: learning.durationMs,
    }),
    ...(["FRONT", "BACK"] as const).flatMap((side) => {
      const timing = detectorTimings[side];
      if (!timing) return [];
      return [speedsterServerTimingEvent({
        eventKey: `${input.sessionId}:server:scan:${side}`,
        sessionId: input.sessionId,
        createdByUserId: input.createdByUserId,
        eventType: "SAM_MEMORY_SIDE_COMPLETED",
        durationMs: typeof timing.serviceTotalMs === "number" ? timing.serviceTotalMs : 0,
        details: timing,
      })];
    }),
  ];
  return {
    initialized,
    detectorVersion: scanned.detectorVersion,
    detectorEvidenceEvents: durableDetectorEvidenceEvents,
    instrumentationEvents,
    attemptEvidence,
    detectionPair: recoveryEnabled ? {
      operationId,
      captureBindingSha256,
      memorySnapshotSha256,
      frontReceiptHmacSha256: recoveredSides.FRONT!.receipt.hmacSha256,
      backReceiptHmacSha256: recoveredSides.BACK!.receipt.hmacSha256,
    } : undefined,
  };
}

function resultPayload(
  before: readonly SpeedsterReviewFinding[],
  after: readonly SpeedsterReviewFinding[],
  gradeReport: Record<string, unknown>,
  detectorAttempts: readonly SpeedsterDetectorAttemptEvidence[] = [],
) {
  return {
    reviewedDefects: stripSpeedsterTraceBodies(after),
    gradeReport,
    measurementDeltas: measurementDeltas(before, after),
    traceHashes: speedsterTraceHashes(after),
    ...(detectorAttempts.length > 0 ? { detectorAttempts } : {}),
  };
}

export async function remeasureSpeedsterFilteredFindingRestore(input: {
  session: SpeedsterReviewActionSession;
  findingSnapshot: unknown;
  detectorVersion: string;
}, deps: Pick<SpeedsterReviewActionDependencies, "presignRead" | "measure">) {
  if (input.session.workflowState !== "CAPTURED") {
    throw new HttpError(409, "Only an active Speedster session can reintroduce a filtered finding.");
  }
  const capture = captureAuthority(
    input.session.capture,
    input.session.id,
    input.session.createdByUserId,
  );
  const before = parseSpeedsterReviewFindings(input.session.reviewedDefects);
  const [filteredFinding] = parseSpeedsterReviewFindings([input.findingSnapshot]);
  if (
    !filteredFinding
    || filteredFinding.reviewResult !== "UNREVIEWED"
    || (filteredFinding.origin !== "DETECTOR" && filteredFinding.origin !== "MEMORY")
  ) {
    throw new HttpError(409, "The saved filter decision does not contain an original detector candidate.");
  }
  if (before.some(({ id }) => id === filteredFinding.id)) {
    throw new HttpError(409, "The filtered finding is already present in active review.");
  }
  const version = detectorVersion(input.session.gradeReport);
  if (version !== input.detectorVersion) {
    throw new HttpError(409, "The filtered finding detector version does not match active review.");
  }
  const syntheticRemoved = {
    ...filteredFinding,
    reviewResult: "REMOVED" as const,
    reviewResultBeforeRemoval: filteredFinding.reviewResult,
  };
  const measuredDefects = await remeasureSpeedsterReviewAction({
    defects: [...before, syntheticRemoved],
    action: { type: "UNDO", defectIds: [filteredFinding.id] },
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
      return {
        defects: reconcileMeasurementResponse({
          side,
          activeInputs: findings,
          rawDefects: result.defects,
          newTrace: null,
        }),
      };
    },
  });
  const review = calculateSpeedsterReview(capture, measuredDefects);
  return {
    reviewedDefects: review.defects,
    gradeReport: { ...review.grade, detectorVersion: version },
  };
}

export async function applySpeedsterReviewAction(
  input: SpeedsterReviewActionInput,
  deps: SpeedsterReviewActionDependencies,
) {
  const actionStartedAt = new Date();
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
    let pinnedMap: SpeedsterPinnedMapFilterInput | null = null;
    let pinnedCardIdentity: SpeedsterSessionIdentity | null = null;
    if (session.mapRevisionId) {
      if (!deps.loadPinnedMapFilter) {
        throw new HttpError(409, "Speedster map initialization is unavailable for this pinned session.");
      }
      try {
        pinnedMap = await deps.loadPinnedMapFilter({ ...session, mapRevisionId: session.mapRevisionId });
        validateSpeedsterPinnedMapFilterInput(pinnedMap);
        if (session.mapFilterPolicyVersion !== pinnedMap.revision.filterPolicyVersion) {
          throw new Error("The session filter policy does not match its pinned map revision.");
        }
        if (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON") {
          throw new Error("The pinned session card profile is invalid.");
        }
        pinnedCardIdentity = canonicalizeSpeedsterSessionIdentity(session.cardProfile, session.identity);
        assertSpeedsterMapRevisionAppliesToIdentity(pinnedMap.revision, {
          cardProfile: session.cardProfile,
          identity: pinnedCardIdentity,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown map-integrity error";
        throw new HttpError(409, `Speedster map initialization failed: ${reason}`);
      }
    }
    const hasGradeReport = isRecord(session.gradeReport) && Object.keys(session.gradeReport).length !== 0;
    if (before.length !== 0 || hasGradeReport) {
      if (!hasGradeReport || before.some((finding) => finding.finalTrace || finding.reviewResult !== "UNREVIEWED")) {
        throw new HttpError(409, "Speedster detector review state is not coherently initialized.");
      }
      const version = detectorVersion(session.gradeReport);
      if (pinnedMap && version !== SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION) {
        throw new HttpError(409, "Speedster map initialization has an incompatible detector version.");
      }
      const review = calculateSpeedsterReview(capture, before);
      const gradeReport = { ...review.grade, detectorVersion: version };
      if (!isDeepStrictEqual(session.gradeReport, gradeReport)) {
        throw new HttpError(409, "Speedster detector review state is not coherently initialized.");
      }
      return resultPayload(before, review.defects, gradeReport);
    }
    const detected = await serverOwnedInitialization(input, capture, session.updatedAt, deps);
    const detectorAttemptEvents = detected.instrumentationEvents.filter(
      ({ eventType }) => eventType === "DETECTOR_SIDE_ATTEMPT",
    );
    try {
      let activeFindings = detected.initialized;
      let filterDecisions: readonly SpeedsterFilterDecisionEvidence[] | undefined;
      if (pinnedMap) {
        try {
          if (!pinnedCardIdentity) throw new Error("The pinned session card identity is invalid.");
          const split = splitSpeedsterMapFilteredCandidates({
            findings: detected.initialized,
            cardIdentity: pinnedCardIdentity,
            detectorVersion: detected.detectorVersion,
            map: pinnedMap,
          });
          activeFindings = [...split.activeFindings];
          filterDecisions = split.filteredDecisions;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "unknown map-integrity error";
          throw new HttpError(409, `Speedster map initialization failed: ${reason}`);
        }
      }
      const gradeStartedAt = Date.now();
      const review = calculateSpeedsterReview(capture, activeFindings);
      const gradeDurationMs = Date.now() - gradeStartedAt;
      const gradeReport = { ...review.grade, detectorVersion: detected.detectorVersion };
      const actionEndedAt = new Date();
      const instrumentationEvents = [
        ...detected.instrumentationEvents,
        ...speedsterFindingProposalEvents({
          sessionId: session.id,
          createdByUserId: session.createdByUserId,
          findings: detected.initialized,
          startedAt: actionStartedAt,
          endedAt: actionEndedAt,
        }),
        ...speedsterFilterRemovedEvents({
          sessionId: session.id,
          createdByUserId: session.createdByUserId,
          decisions: filterDecisions ?? [],
          startedAt: actionStartedAt,
          endedAt: actionEndedAt,
        }),
        speedsterServerTimingEvent({
          eventKey: `${session.id}:server:initial-grade-calculated`,
          sessionId: session.id,
          createdByUserId: session.createdByUserId,
          eventType: "GRADE_CALCULATED",
          durationMs: gradeDurationMs,
          details: {
            activeFindingCount: review.defects.length,
            filteredFindingCount: filterDecisions?.length ?? 0,
          },
        }),
        speedsterServerTimingEvent({
          eventKey: `${session.id}:server:initial-review-ready`,
          sessionId: session.id,
          createdByUserId: session.createdByUserId,
          eventType: "INITIAL_REVIEW_READY",
          durationMs: actionEndedAt.getTime() - actionStartedAt.getTime(),
          details: {
            activeFindingCount: review.defects.length,
            filteredFindingCount: filterDecisions?.length ?? 0,
          },
        }),
      ];
      await deps.persistReviewIfRevision(identity, session.updatedAt, {
        reviewedDefects: review.defects.map(stripSpeedsterFindingInstrumentation),
        gradeReport,
        ...(filterDecisions ? { filterDecisions } : {}),
        ...(detected.detectorEvidenceEvents.length > 0
          ? { detectorEvidenceEvents: detected.detectorEvidenceEvents }
          : {}),
        ...(detected.detectionPair ? { detectionPair: detected.detectionPair } : {}),
      });
      await recordInstrumentationFailOpen(deps, session.id, instrumentationEvents);
      return resultPayload(before, review.defects, gradeReport, detected.attemptEvidence);
    } catch (error) {
      await recordInstrumentationFailOpen(deps, session.id, detectorAttemptEvents);
      throw error;
    }
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
  const gradeStartedAt = Date.now();
  const review = calculateSpeedsterReview(capture, measuredDefects);
  const gradeDurationMs = Date.now() - gradeStartedAt;
  const gradeReport = { ...review.grade, detectorVersion: version };
  const actionFindingIds = authoritativeAction.type === "REMOVE" || authoritativeAction.type === "UNDO"
    ? authoritativeAction.defectIds
    : authoritativeAction.type === "CHANGE_TYPE"
      ? [authoritativeAction.defectId]
      : authoritativeAction.type === "TRACE_SAVE"
        ? [authoritativeAction.findingId ?? authoritativeAction.trace.id]
        : [];
  const operatorAction: SpeedsterOperatorInstrumentationAction = authoritativeAction.type === "REMOVE"
    ? "REMOVED"
    : authoritativeAction.type === "UNDO"
      ? "KEPT"
      : authoritativeAction.type === "CHANGE_TYPE"
        ? "RETYPED"
        : "EDITED";
  const actionEndedAt = new Date();
  const instrumentationEvents = [
    ...speedsterFindingActionEvents({
      sessionId: session.id,
      createdByUserId: session.createdByUserId,
      operatorAction,
      before,
      after: review.defects,
      findingIds: actionFindingIds,
      startedAt: actionStartedAt,
      endedAt: actionEndedAt,
    }),
    speedsterServerTimingEvent({
      eventKey: `${session.id}:server:review-action:${actionStartedAt.getTime()}`,
      sessionId: session.id,
      createdByUserId: session.createdByUserId,
      eventType: "REVIEW_ACTION_COMPLETED",
      durationMs: actionEndedAt.getTime() - actionStartedAt.getTime(),
      details: { actionType: authoritativeAction.type, gradeCalculationDurationMs: gradeDurationMs },
    }),
  ];
  await deps.persistReviewIfRevision(identity, session.updatedAt, {
    reviewedDefects: review.defects.map(stripSpeedsterFindingInstrumentation),
    gradeReport,
  });
  await recordInstrumentationFailOpen(deps, session.id, instrumentationEvents);
  return resultPayload(before, review.defects, gradeReport);
}
