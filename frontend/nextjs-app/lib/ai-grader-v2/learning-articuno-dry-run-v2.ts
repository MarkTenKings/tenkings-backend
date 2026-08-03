import { createHash } from "node:crypto";

import {
  deriveSpeedsterLearningBankFromHistoryV2,
  type SpeedsterLearningReviewHistoryV2,
} from "./learning-harvest-v2";
import {
  SPEEDSTER_LEARNING_DEFECT_TYPES,
  SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  type SpeedsterLearningBankV2,
  type SpeedsterLearningCalibrationV2,
  type SpeedsterLearningPolarityV2,
} from "./learning-v2";
import {
  SPEEDSTER_FINGERPRINT_SIZE,
  cleanSpeedsterLearningBank,
  updateSpeedsterLearningBank,
  type SpeedsterLearningBank,
} from "./learning";

export const SPEEDSTER_ARTICUNO_POISONED_SESSION_ID = "cmscem6960006accgpc69tgwp";
export const SPEEDSTER_V1_AUDIT_ABSOLUTE_TOLERANCE = 1e-10;
export const SPEEDSTER_V1_AUDIT_RELATIVE_TOLERANCE = 1e-10;
export const SPEEDSTER_INSPECTION_DETECTOR_VERSION =
  "sam3-local-box-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543";
export const SPEEDSTER_INCOMPATIBLE_FINGERPRINT_VERSION = "INCOMPATIBLE_PRE_INSPECTION_2MM";

type JsonRecord = Record<string, unknown>;
type V1Prototype = { count: number; sum: number[] };
type V1TypeBank = { positive?: V1Prototype; negative?: V1Prototype };
type CanonicalV1Bank = { version: 1; types: Record<string, V1TypeBank> };

export type SpeedsterArticunoDryRunStatus =
  | "SAFE_TO_REQUEST_APPROVAL"
  | "INSUFFICIENT_EVIDENCE"
  | "ABORTED";

export type SpeedsterArticunoDryRunHistoryRow = {
  sessionId: string;
  completionOrder: number;
  completedAt: string | Date;
  reviewedDefects: unknown;
  capture: unknown;
  gradeReport: unknown;
};

export type SpeedsterArticunoDryRunLabel = {
  sourceSessionId: string | null;
  certificateSequence: number;
  createdAt: Date;
};

export type SpeedsterArticunoDryRunSession = {
  id: string;
  reviewedDefects: unknown;
  capture: unknown;
  gradeReport: unknown;
};

export type SpeedsterArticunoDryRunBankRow = {
  state: unknown;
  updatedAt: Date;
} | null;

export type SpeedsterArticunoDryRunLockedDependencies = {
  acquireCompletionAdvisoryLock: () => Promise<void>;
  listCompletionLabels: () => Promise<SpeedsterArticunoDryRunLabel[]>;
  listCompletedSessions: () => Promise<SpeedsterArticunoDryRunSession[]>;
  readGlobalLearningBank: () => Promise<SpeedsterArticunoDryRunBankRow>;
};

export type SpeedsterV1NumericMismatch = {
  path: string;
  expected: number | null;
  actual: number | null;
  absoluteDelta: number | null;
  allowedDelta: number | null;
};

type V1Comparison = {
  equal: boolean;
  mismatchCount: number;
  structuralMismatchCount: number;
  maximumAbsoluteDelta: number;
  mismatches: SpeedsterV1NumericMismatch[];
};

type V1Boundary = {
  startCompletionOrder: number | null;
  startSessionId: string | null;
  sessions: number;
  exactHash: string;
  comparison: V1Comparison;
};

type TypePolarityCounts = Record<string, { POSITIVE: number; NEGATIVE: number }>;

export type SpeedsterArticunoDryRunResult = {
  readOnly: true;
  mutationPerformed: false;
  status: SpeedsterArticunoDryRunStatus;
  reasons: string[];
  lock: {
    acquiredBeforeAudit: true;
    identity: "ten-kings-human-grade-label-slots";
  };
  target: {
    requestedExcludedSessionIds: [typeof SPEEDSTER_ARTICUNO_POISONED_SESSION_ID];
    targetPresent: boolean;
    targetFingerprintCompatible: boolean;
  };
  history: {
    authoritativeOrder: "HumanGradeLabel.certificateSequence";
    completedSessions: number;
    compatibleSessions: number;
    incompatibleSessions: number;
    compatibleFindings: number;
    incompatibleFindings: number;
    incompatibleSessionIds: string[];
    integrityErrors: string[];
  };
  liveV1Audit: {
    status: "PASS" | "FAIL";
    eligibilityModel: "CONTIGUOUS_CERTIFICATE_SEQUENCE_SUFFIX";
    liveRowUpdatedAt: string | null;
    absoluteTolerance: typeof SPEEDSTER_V1_AUDIT_ABSOLUTE_TOLERANCE;
    relativeTolerance: typeof SPEEDSTER_V1_AUDIT_RELATIVE_TOLERANCE;
    liveExactHash: string | null;
    matchingBoundaries: V1Boundary[];
    closestComparison: V1Boundary | null;
  };
  calibration: SpeedsterLearningCalibrationV2 & { source: "EXTERNAL_READ_ONLY" | "NOT_SUPPLIED" };
  v2: {
    fingerprintVersion: typeof SPEEDSTER_LEARNING_FINGERPRINT_VERSION;
    unexcluded: {
      counts: TypePolarityCounts;
      exemplars: number;
      serializedBytes: number;
      deterministicHash: string;
    };
    excluded: {
      counts: TypePolarityCounts;
      exemplars: number;
      serializedBytes: number;
      deterministicHash: string;
    };
    countDeltas: TypePolarityCounts;
    exemplarSessionDeltas: Array<{
      sessionId: string;
      before: number;
      after: number;
      delta: number;
    }>;
    affectedSessionIds: string[];
  };
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
};

const stableJson = (value: unknown) => JSON.stringify(stableValue(value));
const sha256 = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");
export const speedsterLearningDeterministicHashV2 = (value: unknown) => sha256(value);

const exactInspectionFrame = (value: unknown) => {
  if (!isRecord(value) || !isRecord(value.cardBounds)) return false;
  return value.width === 1350
    && value.height === 1858
    && value.cardBounds.x === 40
    && value.cardBounds.y === 40
    && value.cardBounds.width === 1270
    && value.cardBounds.height === 1778;
};

export function speedsterHistoryFingerprintVersion(capture: unknown, gradeReport: unknown): string {
  if (!isRecord(capture) || !isRecord(capture.front) || !isRecord(capture.back)
    || !isRecord(gradeReport)
    || gradeReport.detectorVersion !== SPEEDSTER_INSPECTION_DETECTOR_VERSION) {
    return SPEEDSTER_INCOMPATIBLE_FINGERPRINT_VERSION;
  }
  return [capture.front, capture.back].every((side) =>
    typeof side.inspectionStorageKey === "string"
    && Boolean(side.inspectionStorageKey.trim())
    && exactInspectionFrame(side.inspectionFrame))
    ? SPEEDSTER_LEARNING_FINGERPRINT_VERSION
    : SPEEDSTER_INCOMPATIBLE_FINGERPRINT_VERSION;
}

function strictV1Bank(value: unknown): CanonicalV1Bank | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.types)) return null;
  const allowedTypes = new Set<string>(SPEEDSTER_LEARNING_DEFECT_TYPES);
  const types: Record<string, V1TypeBank> = {};
  for (const [defectType, rawType] of Object.entries(value.types)) {
    if (!allowedTypes.has(defectType) || !isRecord(rawType)) return null;
    if (Object.keys(rawType).some((key) => key !== "positive" && key !== "negative")) return null;
    const next: V1TypeBank = {};
    for (const polarity of ["positive", "negative"] as const) {
      const raw = rawType[polarity];
      if (raw === undefined) continue;
      if (!isRecord(raw)
        || Object.keys(raw).some((key) => key !== "count" && key !== "sum")
        || !Number.isInteger(raw.count) || Number(raw.count) < 1
        || !Array.isArray(raw.sum) || raw.sum.length !== SPEEDSTER_FINGERPRINT_SIZE
        || raw.sum.some((part) => typeof part !== "number" || !Number.isFinite(part))) return null;
      next[polarity] = { count: Number(raw.count), sum: [...raw.sum] as number[] };
    }
    if (!next.positive && !next.negative) return null;
    types[defectType] = next;
  }
  return { version: 1, types };
}

const canonicalV1 = (value: SpeedsterLearningBank): CanonicalV1Bank => {
  const cleaned = cleanSpeedsterLearningBank(value) as SpeedsterLearningBank & {
    types: Record<string, V1TypeBank | undefined>;
  };
  return {
    version: 1,
    types: Object.fromEntries(SPEEDSTER_LEARNING_DEFECT_TYPES.flatMap((defectType) => {
      const entry = cleaned.types[defectType];
      return entry ? [[defectType, entry] as const] : [];
    })),
  };
};

function addV1Bank(target: CanonicalV1Bank, addition: CanonicalV1Bank) {
  for (const defectType of SPEEDSTER_LEARNING_DEFECT_TYPES) {
    const source = addition.types[defectType];
    if (!source) continue;
    const destination = target.types[defectType] ?? {};
    for (const polarity of ["positive", "negative"] as const) {
      const incoming = source[polarity];
      if (!incoming) continue;
      const current = destination[polarity] ?? {
        count: 0,
        sum: Array.from({ length: SPEEDSTER_FINGERPRINT_SIZE }, () => 0),
      };
      destination[polarity] = {
        count: current.count + incoming.count,
        sum: current.sum.map((part, index) => part + incoming.sum[index]),
      };
    }
    target.types[defectType] = destination;
  }
}

const emptyV1 = (): CanonicalV1Bank => ({ version: 1, types: {} });

function compareV1(expected: CanonicalV1Bank, actual: CanonicalV1Bank): V1Comparison {
  const mismatches: SpeedsterV1NumericMismatch[] = [];
  let structuralMismatchCount = 0;
  let maximumAbsoluteDelta = 0;
  for (const defectType of SPEEDSTER_LEARNING_DEFECT_TYPES) {
    for (const polarity of ["positive", "negative"] as const) {
      const left = expected.types[defectType]?.[polarity];
      const right = actual.types[defectType]?.[polarity];
      const prefix = `types.${defectType}.${polarity}`;
      if (!left || !right) {
        if (left || right) {
          structuralMismatchCount += 1;
          mismatches.push({
            path: prefix,
            expected: left?.count ?? null,
            actual: right?.count ?? null,
            absoluteDelta: null,
            allowedDelta: null,
          });
        }
        continue;
      }
      if (left.count !== right.count) {
        structuralMismatchCount += 1;
        mismatches.push({
          path: `${prefix}.count`,
          expected: left.count,
          actual: right.count,
          absoluteDelta: Math.abs(left.count - right.count),
          allowedDelta: 0,
        });
      }
      for (let index = 0; index < SPEEDSTER_FINGERPRINT_SIZE; index += 1) {
        const delta = Math.abs(left.sum[index] - right.sum[index]);
        const allowed = SPEEDSTER_V1_AUDIT_ABSOLUTE_TOLERANCE
          + SPEEDSTER_V1_AUDIT_RELATIVE_TOLERANCE
          * Math.max(Math.abs(left.sum[index]), Math.abs(right.sum[index]));
        maximumAbsoluteDelta = Math.max(maximumAbsoluteDelta, delta);
        if (delta > allowed) mismatches.push({
          path: `${prefix}.sum[${index}]`,
          expected: left.sum[index],
          actual: right.sum[index],
          absoluteDelta: delta,
          allowedDelta: allowed,
        });
      }
    }
  }
  return {
    equal: mismatches.length === 0,
    mismatchCount: mismatches.length,
    structuralMismatchCount,
    maximumAbsoluteDelta,
    mismatches,
  };
}

function auditV1(history: readonly SpeedsterArticunoDryRunHistoryRow[], live: CanonicalV1Bank) {
  const accumulated = emptyV1();
  const boundaries: V1Boundary[] = [];
  let closest: V1Boundary | null = null;
  const consider = (index: number) => {
    const comparison = compareV1(accumulated, live);
    const boundary: V1Boundary = {
      startCompletionOrder: history[index]?.completionOrder ?? null,
      startSessionId: history[index]?.sessionId ?? null,
      sessions: history.length - index,
      exactHash: sha256(accumulated),
      comparison,
    };
    if (comparison.equal) boundaries.push(boundary);
    if (!closest
      || comparison.structuralMismatchCount < closest.comparison.structuralMismatchCount
      || (comparison.structuralMismatchCount === closest.comparison.structuralMismatchCount
        && comparison.mismatchCount < closest.comparison.mismatchCount)
      || (comparison.structuralMismatchCount === closest.comparison.structuralMismatchCount
        && comparison.mismatchCount === closest.comparison.mismatchCount
        && comparison.maximumAbsoluteDelta < closest.comparison.maximumAbsoluteDelta)) closest = boundary;
  };
  consider(history.length);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const reviewedDefects = Array.isArray(history[index].reviewedDefects)
      ? history[index].reviewedDefects as unknown[]
      : [];
    const contribution = canonicalV1(updateSpeedsterLearningBank(undefined, reviewedDefects));
    addV1Bank(accumulated, contribution);
    consider(index);
  }
  return { boundaries, closest };
}

const typePolarityCounts = (bank: SpeedsterLearningBankV2): TypePolarityCounts => {
  const counts = Object.fromEntries(SPEEDSTER_LEARNING_DEFECT_TYPES.map((defectType) => [
    defectType,
    { POSITIVE: 0, NEGATIVE: 0 },
  ])) as TypePolarityCounts;
  for (const exemplar of bank.exemplars) counts[exemplar.defectType][exemplar.polarity] += 1;
  return counts;
};

const countDeltas = (before: TypePolarityCounts, after: TypePolarityCounts): TypePolarityCounts =>
  Object.fromEntries(SPEEDSTER_LEARNING_DEFECT_TYPES.map((defectType) => [defectType, {
    POSITIVE: after[defectType].POSITIVE - before[defectType].POSITIVE,
    NEGATIVE: after[defectType].NEGATIVE - before[defectType].NEGATIVE,
  }])) as TypePolarityCounts;

const exemplarSessionCounts = (bank: SpeedsterLearningBankV2) => {
  const counts = new Map<string, number>();
  for (const exemplar of bank.exemplars) counts.set(exemplar.sessionId, (counts.get(exemplar.sessionId) ?? 0) + 1);
  return counts;
};

function sortedRows(
  labels: readonly SpeedsterArticunoDryRunLabel[],
  sessions: readonly SpeedsterArticunoDryRunSession[],
) {
  const errors: string[] = [];
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const seen = new Set<string>();
  const rows: SpeedsterArticunoDryRunHistoryRow[] = [];
  let previousOrder = 0;
  for (const label of labels) {
    const sessionId = label.sourceSessionId?.trim();
    if (!sessionId) {
      errors.push(`Speedster label ${label.certificateSequence} has no source session ID`);
      continue;
    }
    if (!Number.isInteger(label.certificateSequence) || label.certificateSequence <= previousOrder) {
      errors.push(`Invalid or non-ascending certificate sequence ${label.certificateSequence}`);
      continue;
    }
    previousOrder = label.certificateSequence;
    if (seen.has(sessionId)) {
      errors.push(`Duplicate Speedster label session ${sessionId}`);
      continue;
    }
    seen.add(sessionId);
    const session = sessionsById.get(sessionId);
    if (!session) {
      errors.push(`Speedster label ${label.certificateSequence} has no completed session ${sessionId}`);
      continue;
    }
    if (!Array.isArray(session.reviewedDefects)) {
      errors.push(`Completed Speedster session ${sessionId} has malformed reviewed defects`);
    }
    rows.push({
      sessionId,
      completionOrder: label.certificateSequence,
      completedAt: label.createdAt,
      reviewedDefects: session.reviewedDefects,
      capture: session.capture,
      gradeReport: session.gradeReport,
    });
  }
  for (const session of sessions) {
    if (!seen.has(session.id)) errors.push(`Completed Speedster session ${session.id} has no Speedster label`);
  }
  return { rows, errors };
}

export function analyzeSpeedsterArticunoDryRun(input: {
  history: readonly SpeedsterArticunoDryRunHistoryRow[];
  liveBank: SpeedsterArticunoDryRunBankRow;
  calibration?: { tau: number; margin: number };
  integrityErrors?: readonly string[];
}): SpeedsterArticunoDryRunResult {
  const integrityErrors = [...(input.integrityErrors ?? [])];
  const ordered = [...input.history].sort((left, right) => left.completionOrder - right.completionOrder);
  const duplicateOrders = ordered.filter((row, index) => index > 0
    && row.completionOrder === ordered[index - 1].completionOrder);
  if (duplicateOrders.length) integrityErrors.push("Duplicate certificate sequence in authoritative history");
  const target = ordered.find((row) => row.sessionId === SPEEDSTER_ARTICUNO_POISONED_SESSION_ID);
  const calibration: SpeedsterLearningCalibrationV2 & {
    source: "EXTERNAL_READ_ONLY" | "NOT_SUPPLIED";
  } = input.calibration
    ? { status: "CALIBRATED", ...input.calibration, source: "EXTERNAL_READ_ONLY" }
    : { status: "UNCALIBRATED", tau: null, margin: null, source: "NOT_SUPPLIED" };
  const validCalibration = !input.calibration || (
    Number.isFinite(input.calibration.tau) && input.calibration.tau >= 0 && input.calibration.tau <= 1
    && Number.isFinite(input.calibration.margin) && input.calibration.margin >= 0 && input.calibration.margin <= 1
  );
  if (!validCalibration) integrityErrors.push("External calibration values are invalid");

  const v2History: SpeedsterLearningReviewHistoryV2[] = ordered.map((row) => ({
    sessionId: row.sessionId,
    completionOrder: row.completionOrder,
    completedAt: row.completedAt,
    fingerprintVersion: speedsterHistoryFingerprintVersion(row.capture, row.gradeReport),
    reviewedDefects: Array.isArray(row.reviewedDefects) ? row.reviewedDefects : [],
  }));
  const compatible = v2History.filter((row) => row.fingerprintVersion === SPEEDSTER_LEARNING_FINGERPRINT_VERSION);
  const incompatible = v2History.filter((row) => row.fingerprintVersion !== SPEEDSTER_LEARNING_FINGERPRINT_VERSION);
  const findings = (rows: readonly SpeedsterLearningReviewHistoryV2[]) => rows.reduce(
    (total, row) => total + row.reviewedDefects.length,
    0,
  );
  const derivationCalibration: SpeedsterLearningCalibrationV2 = validCalibration && input.calibration
    ? { status: "CALIBRATED", ...input.calibration }
    : { status: "UNCALIBRATED", tau: null, margin: null };
  const unexcluded = deriveSpeedsterLearningBankFromHistoryV2(v2History, new Set(), derivationCalibration).bank;
  const excluded = deriveSpeedsterLearningBankFromHistoryV2(
    v2History,
    new Set([SPEEDSTER_ARTICUNO_POISONED_SESSION_ID]),
    derivationCalibration,
  ).bank;
  const beforeCounts = typePolarityCounts(unexcluded);
  const afterCounts = typePolarityCounts(excluded);
  const beforeSessions = exemplarSessionCounts(unexcluded);
  const afterSessions = exemplarSessionCounts(excluded);
  const sessionIds = [...new Set([...beforeSessions.keys(), ...afterSessions.keys()])].sort();
  const exemplarSessionDeltas = sessionIds.map((sessionId) => ({
    sessionId,
    before: beforeSessions.get(sessionId) ?? 0,
    after: afterSessions.get(sessionId) ?? 0,
    delta: (afterSessions.get(sessionId) ?? 0) - (beforeSessions.get(sessionId) ?? 0),
  })).filter(({ delta }) => delta !== 0);

  const strictLive = strictV1Bank(input.liveBank?.state);
  const v1Audit = strictLive ? auditV1(ordered, strictLive) : { boundaries: [], closest: null };
  const reasons: string[] = [];
  if (integrityErrors.length) reasons.push("Authoritative history integrity failed");
  if (!strictLive) reasons.push("Live GLOBAL row is missing or is not a strict Bank V1 row");
  else if (!v1Audit.boundaries.length) reasons.push("No chronological V1 history suffix matches the live GLOBAL row");
  if (!target) reasons.push(`Target Articuno session ${SPEEDSTER_ARTICUNO_POISONED_SESSION_ID} is absent`);
  if (!input.calibration) reasons.push("Externally calibrated tau and margin were not supplied");
  if (!compatible.length || excluded.exemplars.length === 0) reasons.push("Compatible inspection-2mm history is insufficient");
  const aborted = integrityErrors.length > 0 || !strictLive || !v1Audit.boundaries.length || !target || !validCalibration;
  const status: SpeedsterArticunoDryRunStatus = aborted
    ? "ABORTED"
    : (!input.calibration || !compatible.length || excluded.exemplars.length === 0)
      ? "INSUFFICIENT_EVIDENCE"
      : "SAFE_TO_REQUEST_APPROVAL";

  return {
    readOnly: true,
    mutationPerformed: false,
    status,
    reasons,
    lock: { acquiredBeforeAudit: true, identity: "ten-kings-human-grade-label-slots" },
    target: {
      requestedExcludedSessionIds: [SPEEDSTER_ARTICUNO_POISONED_SESSION_ID],
      targetPresent: Boolean(target),
      targetFingerprintCompatible: target
        ? speedsterHistoryFingerprintVersion(target.capture, target.gradeReport) === SPEEDSTER_LEARNING_FINGERPRINT_VERSION
        : false,
    },
    history: {
      authoritativeOrder: "HumanGradeLabel.certificateSequence",
      completedSessions: ordered.length,
      compatibleSessions: compatible.length,
      incompatibleSessions: incompatible.length,
      compatibleFindings: findings(compatible),
      incompatibleFindings: findings(incompatible),
      incompatibleSessionIds: incompatible.map(({ sessionId }) => sessionId),
      integrityErrors,
    },
    liveV1Audit: {
      status: strictLive && v1Audit.boundaries.length ? "PASS" : "FAIL",
      eligibilityModel: "CONTIGUOUS_CERTIFICATE_SEQUENCE_SUFFIX",
      liveRowUpdatedAt: input.liveBank?.updatedAt.toISOString() ?? null,
      absoluteTolerance: SPEEDSTER_V1_AUDIT_ABSOLUTE_TOLERANCE,
      relativeTolerance: SPEEDSTER_V1_AUDIT_RELATIVE_TOLERANCE,
      liveExactHash: strictLive ? sha256(strictLive) : null,
      matchingBoundaries: v1Audit.boundaries,
      closestComparison: v1Audit.closest,
    },
    calibration,
    v2: {
      fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
      unexcluded: {
        counts: beforeCounts,
        exemplars: unexcluded.exemplars.length,
        serializedBytes: Buffer.byteLength(stableJson(unexcluded)),
        deterministicHash: sha256(unexcluded),
      },
      excluded: {
        counts: afterCounts,
        exemplars: excluded.exemplars.length,
        serializedBytes: Buffer.byteLength(stableJson(excluded)),
        deterministicHash: sha256(excluded),
      },
      countDeltas: countDeltas(beforeCounts, afterCounts),
      exemplarSessionDeltas,
      affectedSessionIds: exemplarSessionDeltas.map(({ sessionId }) => sessionId),
    },
  };
}

export async function runLockedSpeedsterArticunoDryRun(
  deps: SpeedsterArticunoDryRunLockedDependencies,
  calibration?: { tau: number; margin: number },
) {
  await deps.acquireCompletionAdvisoryLock();
  const labels = await deps.listCompletionLabels();
  const sessions = await deps.listCompletedSessions();
  const liveBank = await deps.readGlobalLearningBank();
  const history = sortedRows(labels, sessions);
  return analyzeSpeedsterArticunoDryRun({
    history: history.rows,
    liveBank,
    calibration,
    integrityErrors: history.errors,
  });
}
