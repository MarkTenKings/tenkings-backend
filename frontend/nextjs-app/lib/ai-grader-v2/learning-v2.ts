import { createHash } from "node:crypto";

import type { SpeedsterDefectType, SpeedsterViewType } from "./contracts";

export const SPEEDSTER_LEARNING_BANK_V2_VERSION = 2 as const;
export const SPEEDSTER_LEARNING_FINGERPRINT_SIZE = 32;
export const SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY = 50;
export const SPEEDSTER_LEARNING_SERIALIZED_BANK_BUDGET_BYTES = 1_500_000;
export const SPEEDSTER_LEARNING_FINGERPRINT_VERSION =
  "sam3-fpn32-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543" as const;
export const SPEEDSTER_LEARNING_POLICY_V2 = { tau: 0.8, margin: 0.1 } as const;
export const SPEEDSTER_LEARNING_POLICY_BOUNDS_V2 = {
  tau: { min: 0.7, max: 0.95 },
  margin: { min: 0.03, max: 0.2 },
} as const;

export const SPEEDSTER_LEARNING_DEFECT_TYPES = [
  "FAINT_COLOR_VARIATION",
  "VISIBLE_WHITENING",
  "FRAYING",
  "CHIPPING_EXPOSED_STOCK",
  "LIFTING_DEFORMATION",
  "LIGHT_SCRATCH_SCUFF",
  "VISIBLE_SCRATCH_PRINT_COATING_LOSS",
  "DENT_MATERIAL_DAMAGE",
  "PEELING_HEAVY_DAMAGE",
] as const satisfies readonly SpeedsterDefectType[];

export const SPEEDSTER_LEARNING_SOURCE_VIEWS = [
  "ORIGINAL",
  "NORMALIZED",
  "MICRO_DEFECT",
  "DIRECTIONAL",
] as const satisfies readonly SpeedsterViewType[];

export type SpeedsterLearningPolarityV2 = "POSITIVE" | "NEGATIVE";
export type SpeedsterLearningProvenanceV2 =
  | "DETECTOR_REMOVED"
  | "DETECTOR_RELABELED_NEGATIVE"
  | "DETECTOR_RELABELED_POSITIVE"
  | "SMART_MARK_POSITIVE"
  | "UNTOUCHED_ACCEPTED_POSITIVE";

export type SpeedsterLearningCalibrationV2 =
  | { status: "UNCALIBRATED"; tau: null; margin: null }
  | { status: "CALIBRATED"; tau: number; margin: number };

export type SpeedsterLearningLessonCandidateV2 = {
  defectType: SpeedsterDefectType;
  polarity: SpeedsterLearningPolarityV2;
  fingerprint: readonly number[];
  provenance: SpeedsterLearningProvenanceV2;
  sourceViewId: SpeedsterViewType;
  proposalOrder: number;
  lessonOrder?: number;
};

export type SpeedsterLearningHistoryLessonsV2 = {
  sessionId: string;
  completedAt: string | Date;
  completionOrder: number;
  fingerprintVersion: string;
  lessons: readonly SpeedsterLearningLessonCandidateV2[];
};

export type SpeedsterLearningExemplarV2 = {
  defectType: SpeedsterDefectType;
  polarity: SpeedsterLearningPolarityV2;
  sessionId: string;
  completedAt: string;
  completionOrder: number;
  proposalOrder: number;
  lessonOrder: number;
  fingerprint: number[];
  provenance: SpeedsterLearningProvenanceV2;
  sourceViewId: SpeedsterViewType;
};

export type SpeedsterLearningBankV2 = {
  version: typeof SPEEDSTER_LEARNING_BANK_V2_VERSION;
  fingerprintVersion: typeof SPEEDSTER_LEARNING_FINGERPRINT_VERSION;
  capacityPerTypePolarity: typeof SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY;
  calibration: SpeedsterLearningCalibrationV2;
  replayCursor: {
    completionOrder: number;
    sessionId: string;
    sessionDigest: string;
  } | null;
  exemplars: SpeedsterLearningExemplarV2[];
};

export type SpeedsterLearningDerivationDiagnosticsV2 = {
  historySessions: number;
  excludedSessions: number;
  invalidSessions: number;
  candidateLessons: number;
  skippedInvalidLessons: number;
  prunedByCapacity: number;
  admittedExemplars: number;
};

export type SpeedsterLearningDerivationV2 = {
  bank: SpeedsterLearningBankV2;
  diagnostics: SpeedsterLearningDerivationDiagnosticsV2;
};

const POLARITIES: readonly SpeedsterLearningPolarityV2[] = ["POSITIVE", "NEGATIVE"];
const PROVENANCE: readonly SpeedsterLearningProvenanceV2[] = [
  "DETECTOR_REMOVED",
  "DETECTOR_RELABELED_NEGATIVE",
  "DETECTOR_RELABELED_POSITIVE",
  "SMART_MARK_POSITIVE",
  "UNTOUCHED_ACCEPTED_POSITIVE",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const isSpeedsterLearningDefectTypeV2 = (value: unknown): value is SpeedsterDefectType =>
  typeof value === "string" && SPEEDSTER_LEARNING_DEFECT_TYPES.includes(value as SpeedsterDefectType);

export function normalizeSpeedsterLearningFingerprintV2(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== SPEEDSTER_LEARNING_FINGERPRINT_SIZE) return null;
  if (value.some((part) => typeof part !== "number" || !Number.isFinite(part))) return null;
  const vector = value as number[];
  const norm = Math.hypot(...vector);
  return Number.isFinite(norm) && norm > 0 ? vector.map((part) => part / norm) : null;
}

const normalizedCompletedAt = (value: string | Date): string | null => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const sessionDigest = (session: SpeedsterLearningHistoryLessonsV2, completedAt: string) => {
  const lessons = session.lessons.map((entry, inputOrder) => ({
    defectType: entry.defectType,
    polarity: entry.polarity,
    fingerprint: normalizeSpeedsterLearningFingerprintV2(entry.fingerprint),
    provenance: entry.provenance,
    sourceViewId: entry.sourceViewId,
    proposalOrder: entry.proposalOrder,
    lessonOrder: entry.lessonOrder ?? inputOrder,
  })).sort((left, right) => left.proposalOrder - right.proposalOrder
    || left.lessonOrder - right.lessonOrder
    || left.defectType.localeCompare(right.defectType)
    || left.polarity.localeCompare(right.polarity));
  return createHash("sha256").update(JSON.stringify({
    sessionId: session.sessionId.trim(),
    completedAt,
    completionOrder: session.completionOrder,
    fingerprintVersion: session.fingerprintVersion,
    lessons,
  })).digest("hex");
};

const validCalibration = (value: unknown): value is SpeedsterLearningCalibrationV2 => {
  if (!isRecord(value)) return false;
  if (value.status === "UNCALIBRATED") return value.tau === null && value.margin === null;
  return value.status === "CALIBRATED"
    && typeof value.tau === "number" && Number.isFinite(value.tau)
    && value.tau >= SPEEDSTER_LEARNING_POLICY_BOUNDS_V2.tau.min
    && value.tau <= SPEEDSTER_LEARNING_POLICY_BOUNDS_V2.tau.max
    && typeof value.margin === "number" && Number.isFinite(value.margin)
    && value.margin >= SPEEDSTER_LEARNING_POLICY_BOUNDS_V2.margin.min
    && value.margin <= SPEEDSTER_LEARNING_POLICY_BOUNDS_V2.margin.max;
};

const compareExemplars = (left: SpeedsterLearningExemplarV2, right: SpeedsterLearningExemplarV2) =>
  left.completionOrder - right.completionOrder
  || left.completedAt.localeCompare(right.completedAt)
  || left.sessionId.localeCompare(right.sessionId)
  || left.proposalOrder - right.proposalOrder
  || left.lessonOrder - right.lessonOrder
  || left.defectType.localeCompare(right.defectType)
  || left.polarity.localeCompare(right.polarity);

const groupKey = (exemplar: Pick<SpeedsterLearningExemplarV2, "defectType" | "polarity">) =>
  `${exemplar.defectType}:${exemplar.polarity}`;

function cleanExemplar(value: unknown): SpeedsterLearningExemplarV2 | null {
  if (!isRecord(value)
    || !isSpeedsterLearningDefectTypeV2(value.defectType)
    || !POLARITIES.includes(value.polarity as SpeedsterLearningPolarityV2)
    || !PROVENANCE.includes(value.provenance as SpeedsterLearningProvenanceV2)
    || typeof value.sessionId !== "string" || !value.sessionId.trim()
    || typeof value.completedAt !== "string" || !normalizedCompletedAt(value.completedAt)
    || !Number.isInteger(value.completionOrder) || Number(value.completionOrder) < 1
    || !SPEEDSTER_LEARNING_SOURCE_VIEWS.includes(value.sourceViewId as SpeedsterViewType)
    || !Number.isInteger(value.proposalOrder) || Number(value.proposalOrder) < 0
    || !Number.isInteger(value.lessonOrder) || Number(value.lessonOrder) < 0) return null;
  const fingerprint = normalizeSpeedsterLearningFingerprintV2(value.fingerprint);
  const rawNorm = Array.isArray(value.fingerprint) ? Math.hypot(...value.fingerprint.map(Number)) : Number.NaN;
  if (!fingerprint || !Number.isFinite(rawNorm) || Math.abs(rawNorm - 1) > 0.0001) return null;
  return {
    defectType: value.defectType,
    polarity: value.polarity as SpeedsterLearningPolarityV2,
    sessionId: value.sessionId.trim(),
    completedAt: normalizedCompletedAt(value.completedAt)!,
    completionOrder: Number(value.completionOrder),
    proposalOrder: Number(value.proposalOrder),
    lessonOrder: Number(value.lessonOrder),
    fingerprint,
    provenance: value.provenance as SpeedsterLearningProvenanceV2,
    sourceViewId: value.sourceViewId as SpeedsterViewType,
  };
}

export function parseSpeedsterLearningBankV2(value: unknown): SpeedsterLearningBankV2 | null {
  if (!isRecord(value)
    || value.version !== SPEEDSTER_LEARNING_BANK_V2_VERSION
    || value.fingerprintVersion !== SPEEDSTER_LEARNING_FINGERPRINT_VERSION
    || value.capacityPerTypePolarity !== SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY
    || !validCalibration(value.calibration)
    || !(value.replayCursor === null || (isRecord(value.replayCursor)
      && Number.isInteger(value.replayCursor.completionOrder)
      && Number(value.replayCursor.completionOrder) >= 1
      && typeof value.replayCursor.sessionId === "string"
      && Boolean(value.replayCursor.sessionId.trim())
      && typeof value.replayCursor.sessionDigest === "string"
      && /^[a-f0-9]{64}$/.test(value.replayCursor.sessionDigest)))
    || !Array.isArray(value.exemplars)) return null;
  const exemplars = value.exemplars.map(cleanExemplar);
  if (exemplars.some((entry) => !entry)) return null;
  const bank = {
    version: SPEEDSTER_LEARNING_BANK_V2_VERSION,
    fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
    capacityPerTypePolarity: SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY,
    calibration: value.calibration,
    replayCursor: value.replayCursor === null ? null : {
      completionOrder: Number(value.replayCursor.completionOrder),
      sessionId: String(value.replayCursor.sessionId).trim(),
      sessionDigest: String(value.replayCursor.sessionDigest),
    },
    exemplars: (exemplars as SpeedsterLearningExemplarV2[]).sort(compareExemplars),
  } satisfies SpeedsterLearningBankV2;
  if ((bank.exemplars.length > 0 && !bank.replayCursor)
    || bank.exemplars.some((entry) =>
      !bank.replayCursor || entry.completionOrder > bank.replayCursor.completionOrder)) return null;
  const counts = new Map<string, number>();
  for (const exemplar of bank.exemplars) {
    const key = groupKey(exemplar);
    const next = (counts.get(key) ?? 0) + 1;
    if (next > SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY) return null;
    counts.set(key, next);
  }
  return bank;
}

export function deriveSpeedsterLearningBankV2(
  history: readonly SpeedsterLearningHistoryLessonsV2[],
  excludedSessionIds: ReadonlySet<string> = new Set(),
  calibration: SpeedsterLearningCalibrationV2 = { status: "UNCALIBRATED", tau: null, margin: null },
): SpeedsterLearningDerivationV2 {
  if (!validCalibration(calibration)) throw new Error("Invalid SAM Memory V2 calibration state");
  const diagnostics: SpeedsterLearningDerivationDiagnosticsV2 = {
    historySessions: history.length,
    excludedSessions: 0,
    invalidSessions: 0,
    candidateLessons: 0,
    skippedInvalidLessons: 0,
    prunedByCapacity: 0,
    admittedExemplars: 0,
  };
  const admitted: SpeedsterLearningExemplarV2[] = [];
  let replayCursor: SpeedsterLearningBankV2["replayCursor"] = null;
  const chronological = history.map((session, inputOrder) => ({ session, inputOrder })).sort((left, right) => {
    const leftAt = normalizedCompletedAt(left.session.completedAt) ?? "";
    const rightAt = normalizedCompletedAt(right.session.completedAt) ?? "";
    return left.session.completionOrder - right.session.completionOrder
      || leftAt.localeCompare(rightAt)
      || left.session.sessionId.localeCompare(right.session.sessionId)
      || left.inputOrder - right.inputOrder;
  });

  for (const { session } of chronological) {
    if (excludedSessionIds.has(session.sessionId)) {
      diagnostics.excludedSessions += 1;
      continue;
    }
    const completedAt = normalizedCompletedAt(session.completedAt);
    if (!session.sessionId.trim() || !completedAt
      || !Number.isInteger(session.completionOrder) || session.completionOrder < 1
      || session.fingerprintVersion !== SPEEDSTER_LEARNING_FINGERPRINT_VERSION
      || !Array.isArray(session.lessons)) {
      diagnostics.invalidSessions += 1;
      continue;
    }
    replayCursor = {
      completionOrder: session.completionOrder,
      sessionId: session.sessionId.trim(),
      sessionDigest: sessionDigest(session, completedAt),
    };
    const orderedLessons = session.lessons
      .map((lesson, inputOrder) => ({ lesson, inputOrder }))
      .sort((left, right) => left.lesson.proposalOrder - right.lesson.proposalOrder
        || (left.lesson.lessonOrder ?? left.inputOrder) - (right.lesson.lessonOrder ?? right.inputOrder)
        || left.inputOrder - right.inputOrder);
    diagnostics.candidateLessons += orderedLessons.length;
    for (const { lesson, inputOrder } of orderedLessons) {
      const fingerprint = normalizeSpeedsterLearningFingerprintV2(lesson.fingerprint);
      if (!isSpeedsterLearningDefectTypeV2(lesson.defectType)
        || !POLARITIES.includes(lesson.polarity)
        || !PROVENANCE.includes(lesson.provenance)
        || !fingerprint
        || !SPEEDSTER_LEARNING_SOURCE_VIEWS.includes(lesson.sourceViewId)
        || !Number.isInteger(lesson.proposalOrder) || lesson.proposalOrder < 0
        || !Number.isInteger(lesson.lessonOrder ?? inputOrder) || (lesson.lessonOrder ?? inputOrder) < 0) {
        diagnostics.skippedInvalidLessons += 1;
        continue;
      }
      admitted.push({
        defectType: lesson.defectType,
        polarity: lesson.polarity,
        sessionId: session.sessionId.trim(),
        completedAt,
        completionOrder: session.completionOrder,
        proposalOrder: lesson.proposalOrder,
        lessonOrder: lesson.lessonOrder ?? inputOrder,
        fingerprint,
        provenance: lesson.provenance,
        sourceViewId: lesson.sourceViewId,
      });
    }
  }

  admitted.sort(compareExemplars);
  const groups = new Map<string, SpeedsterLearningExemplarV2[]>();
  for (const exemplar of admitted) {
    const key = groupKey(exemplar);
    const entries = groups.get(key);
    if (entries) entries.push(exemplar);
    else groups.set(key, [exemplar]);
  }
  const exemplars = [...groups.values()].flatMap((entries) => {
    const overflow = Math.max(0, entries.length - SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY);
    diagnostics.prunedByCapacity += overflow;
    return entries.slice(overflow);
  }).sort(compareExemplars);
  diagnostics.admittedExemplars = exemplars.length;

  return {
    bank: {
      version: SPEEDSTER_LEARNING_BANK_V2_VERSION,
      fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
      capacityPerTypePolarity: SPEEDSTER_LEARNING_CAPACITY_PER_TYPE_POLARITY,
      calibration,
      replayCursor,
      exemplars,
    },
    diagnostics,
  };
}

export function incrementSpeedsterLearningBankV2(
  currentBank: SpeedsterLearningBankV2,
  session: SpeedsterLearningHistoryLessonsV2,
): SpeedsterLearningDerivationV2 {
  const cleanBank = parseSpeedsterLearningBankV2(currentBank);
  if (!cleanBank) throw new Error("Invalid SAM Memory V2 bank");
  const completedAt = normalizedCompletedAt(session.completedAt);
  if (!session.sessionId.trim() || !completedAt
    || !Number.isInteger(session.completionOrder) || session.completionOrder < 1
    || session.fingerprintVersion !== SPEEDSTER_LEARNING_FINGERPRINT_VERSION
    || !Array.isArray(session.lessons)) {
    throw new Error("Invalid SAM Memory V2 incremental session");
  }
  const nextDigest = sessionDigest(session, completedAt);
  if (cleanBank.replayCursor && session.completionOrder <= cleanBank.replayCursor.completionOrder) {
    if (session.completionOrder === cleanBank.replayCursor.completionOrder
      && session.sessionId.trim() === cleanBank.replayCursor.sessionId
      && nextDigest === cleanBank.replayCursor.sessionDigest) {
      return {
        bank: cleanBank,
        diagnostics: {
          historySessions: 1,
          excludedSessions: 0,
          invalidSessions: 0,
          candidateLessons: session.lessons.length,
          skippedInvalidLessons: 0,
          prunedByCapacity: 0,
          admittedExemplars: cleanBank.exemplars.length,
        },
      };
    }
    throw new Error("Conflicting duplicate or stale SAM Memory V2 incremental session");
  }
  const bySession = new Map<string, Omit<SpeedsterLearningHistoryLessonsV2, "lessons"> & {
    lessons: SpeedsterLearningLessonCandidateV2[];
  }>();
  for (const exemplar of cleanBank.exemplars) {
    const key = `${exemplar.completionOrder}:${exemplar.sessionId}`;
    const existing = bySession.get(key);
    const lesson = {
      defectType: exemplar.defectType,
      polarity: exemplar.polarity,
      fingerprint: exemplar.fingerprint,
      provenance: exemplar.provenance,
      sourceViewId: exemplar.sourceViewId,
      proposalOrder: exemplar.proposalOrder,
      lessonOrder: exemplar.lessonOrder,
    } satisfies SpeedsterLearningLessonCandidateV2;
    if (existing) existing.lessons.push(lesson);
    else {
      bySession.set(key, {
        sessionId: exemplar.sessionId,
        completedAt: exemplar.completedAt,
        completionOrder: exemplar.completionOrder,
        fingerprintVersion: cleanBank.fingerprintVersion,
        lessons: [lesson],
      });
    }
  }
  return deriveSpeedsterLearningBankV2(
    [...bySession.values(), session],
    new Set(),
    cleanBank.calibration,
  );
}
