import type { SpeedsterDefectType, SpeedsterViewType } from "./contracts";
import {
  SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  deriveSpeedsterLearningBankV2,
  incrementSpeedsterLearningBankV2,
  isSpeedsterLearningDefectTypeV2,
  normalizeSpeedsterLearningFingerprintV2,
  type SpeedsterLearningBankV2,
  type SpeedsterLearningCalibrationV2,
  type SpeedsterLearningDerivationV2,
  type SpeedsterLearningHistoryLessonsV2,
  type SpeedsterLearningLessonCandidateV2,
  type SpeedsterLearningProvenanceV2,
} from "./learning-v2";

export const SPEEDSTER_LEARNING_UNTOUCHED_CAP_PER_TYPE = 3;
export const SPEEDSTER_LEARNING_SAME_CARD_DUPLICATE_COSINE = 0.999999;

export type SpeedsterLearningReviewHistoryV2 = {
  sessionId: string;
  completedAt: string | Date;
  completionOrder: number;
  fingerprintVersion: string;
  reviewedDefects: readonly unknown[];
};

export type SpeedsterLearningHarvestDiagnosticsV2 = {
  findings: number;
  explicitFindings: number;
  untouchedFindings: number;
  admittedLessons: number;
  skippedInvalidFindings: number;
  skippedMissingFingerprints: number;
  skippedInvalidFingerprints: number;
  skippedVersionMismatch: number;
  skippedUntouchedCap: number;
  skippedSameCardDuplicate: number;
};

export type SpeedsterLearningHarvestV2 = {
  history: SpeedsterLearningHistoryLessonsV2;
  diagnostics: SpeedsterLearningHarvestDiagnosticsV2;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sourceView = (value: unknown): SpeedsterViewType | null => {
  if (typeof value !== "string") return null;
  const candidate = value.split(":").at(-1);
  return candidate === "ORIGINAL"
    || candidate === "NORMALIZED"
    || candidate === "MICRO_DEFECT"
    || candidate === "DIRECTIONAL"
    ? candidate
    : null;
};

const cosine = (left: readonly number[], right: readonly number[]) =>
  left.reduce((total, part, index) => total + part * right[index], 0);

const lesson = (input: {
  defectType: SpeedsterDefectType;
  polarity: "POSITIVE" | "NEGATIVE";
  fingerprint: readonly number[];
  provenance: SpeedsterLearningProvenanceV2;
  sourceViewId: SpeedsterViewType;
  proposalOrder: number;
  lessonOrder?: number;
}): SpeedsterLearningLessonCandidateV2 => input;

export function harvestSpeedsterLearningSessionV2(
  session: SpeedsterLearningReviewHistoryV2,
): SpeedsterLearningHarvestV2 {
  const diagnostics: SpeedsterLearningHarvestDiagnosticsV2 = {
    findings: session.reviewedDefects.length,
    explicitFindings: 0,
    untouchedFindings: 0,
    admittedLessons: 0,
    skippedInvalidFindings: 0,
    skippedMissingFingerprints: 0,
    skippedInvalidFingerprints: 0,
    skippedVersionMismatch: 0,
    skippedUntouchedCap: 0,
    skippedSameCardDuplicate: 0,
  };
  const lessons: SpeedsterLearningLessonCandidateV2[] = [];
  const untouchedCounts = new Map<SpeedsterDefectType, number>();
  const untouchedFingerprints = new Map<SpeedsterDefectType, number[][]>();

  if (session.fingerprintVersion !== SPEEDSTER_LEARNING_FINGERPRINT_VERSION) {
    diagnostics.skippedVersionMismatch = session.reviewedDefects.length;
    return {
      history: {
        sessionId: session.sessionId,
        completedAt: session.completedAt,
        completionOrder: session.completionOrder,
        fingerprintVersion: session.fingerprintVersion,
        lessons,
      },
      diagnostics,
    };
  }

  session.reviewedDefects.forEach((raw, proposalOrder) => {
    if (!isRecord(raw)
      || !isSpeedsterLearningDefectTypeV2(raw.defectType)
      || typeof raw.reviewResult !== "string") {
      diagnostics.skippedInvalidFindings += 1;
      return;
    }
    const view = sourceView(raw.sourceViewId);
    if (!view || (raw.origin !== "DETECTOR" && raw.origin !== "SMART_MARK")) {
      diagnostics.skippedInvalidFindings += 1;
      return;
    }
    if (raw.featureFingerprint == null) {
      diagnostics.skippedMissingFingerprints += 1;
      return;
    }
    const fingerprint = normalizeSpeedsterLearningFingerprintV2(raw.featureFingerprint);
    if (!fingerprint) {
      diagnostics.skippedInvalidFingerprints += 1;
      return;
    }

    // Origin is authoritative before reviewResult: a relabeled Smart-Mark is
    // positive teaching only, never a fabricated negative detector lesson.
    if (raw.origin === "SMART_MARK") {
      if (raw.reviewResult === "REMOVED") return;
      if (raw.reviewResult !== "SMART_MARKED" && raw.reviewResult !== "TYPE_CORRECTED") {
        diagnostics.skippedInvalidFindings += 1;
        return;
      }
      diagnostics.explicitFindings += 1;
      lessons.push(lesson({
        defectType: raw.defectType,
        polarity: "POSITIVE",
        fingerprint,
        provenance: "SMART_MARK_POSITIVE",
        sourceViewId: view,
        proposalOrder,
      }));
      return;
    }

    const detectedType = isSpeedsterLearningDefectTypeV2(raw.detectedDefectType)
      ? raw.detectedDefectType
      : null;
    if (raw.reviewResult === "REMOVED") {
      if (!detectedType) {
        diagnostics.skippedInvalidFindings += 1;
        return;
      }
      diagnostics.explicitFindings += 1;
      lessons.push(lesson({
        defectType: detectedType,
        polarity: "NEGATIVE",
        fingerprint,
        provenance: "DETECTOR_REMOVED",
        sourceViewId: view,
        proposalOrder,
      }));
      return;
    }
    if (raw.reviewResult === "TYPE_CORRECTED") {
      if (!detectedType) {
        diagnostics.skippedInvalidFindings += 1;
        return;
      }
      diagnostics.explicitFindings += 1;
      lessons.push(
        lesson({
          defectType: detectedType,
          polarity: "NEGATIVE",
          fingerprint,
          provenance: "DETECTOR_RELABELED_NEGATIVE",
          sourceViewId: view,
          proposalOrder,
          lessonOrder: 0,
        }),
        lesson({
          defectType: raw.defectType,
          polarity: "POSITIVE",
          fingerprint,
          provenance: "DETECTOR_RELABELED_POSITIVE",
          sourceViewId: view,
          proposalOrder,
          lessonOrder: 1,
        }),
      );
      return;
    }
    if (raw.reviewResult !== "ACCEPTED") {
      diagnostics.skippedInvalidFindings += 1;
      return;
    }

    diagnostics.untouchedFindings += 1;
    const acceptedForType = untouchedFingerprints.get(raw.defectType) ?? [];
    if (acceptedForType.some((admitted) =>
      cosine(admitted, fingerprint) >= SPEEDSTER_LEARNING_SAME_CARD_DUPLICATE_COSINE)) {
      diagnostics.skippedSameCardDuplicate += 1;
      return;
    }
    const admittedForType = untouchedCounts.get(raw.defectType) ?? 0;
    if (admittedForType >= SPEEDSTER_LEARNING_UNTOUCHED_CAP_PER_TYPE) {
      diagnostics.skippedUntouchedCap += 1;
      return;
    }
    untouchedCounts.set(raw.defectType, admittedForType + 1);
    untouchedFingerprints.set(raw.defectType, [...acceptedForType, fingerprint]);
    lessons.push(lesson({
      defectType: raw.defectType,
      polarity: "POSITIVE",
      fingerprint,
      provenance: "UNTOUCHED_ACCEPTED_POSITIVE",
      sourceViewId: view,
      proposalOrder,
    }));
  });
  diagnostics.admittedLessons = lessons.length;
  return {
    history: {
      sessionId: session.sessionId,
      completedAt: session.completedAt,
      completionOrder: session.completionOrder,
      fingerprintVersion: session.fingerprintVersion,
      lessons,
    },
    diagnostics,
  };
}

export function deriveSpeedsterLearningBankFromHistoryV2(
  history: readonly SpeedsterLearningReviewHistoryV2[],
  excludedSessionIds: ReadonlySet<string> = new Set(),
  calibration: SpeedsterLearningCalibrationV2 = { status: "UNCALIBRATED", tau: null, margin: null },
): SpeedsterLearningDerivationV2 {
  return deriveSpeedsterLearningBankV2(
    history.map((session) => harvestSpeedsterLearningSessionV2(session).history),
    excludedSessionIds,
    calibration,
  );
}

export function incrementSpeedsterLearningBankFromHistoryV2(
  currentBank: SpeedsterLearningBankV2,
  session: SpeedsterLearningReviewHistoryV2,
): SpeedsterLearningDerivationV2 {
  return incrementSpeedsterLearningBankV2(
    currentBank,
    harvestSpeedsterLearningSessionV2(session).history,
  );
}
