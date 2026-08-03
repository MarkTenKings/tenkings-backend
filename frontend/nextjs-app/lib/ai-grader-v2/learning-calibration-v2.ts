import { createHash } from "node:crypto";

import type { SpeedsterViewType } from "./contracts";
import {
  deriveSpeedsterLearningBankFromHistoryV2,
  harvestSpeedsterLearningSessionV2,
  type SpeedsterLearningReviewHistoryV2,
} from "./learning-harvest-v2";
import {
  SPEEDSTER_LEARNING_FINGERPRINT_SIZE,
  SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  normalizeSpeedsterLearningFingerprintV2,
  type SpeedsterLearningBankV2,
  type SpeedsterLearningExemplarV2,
  type SpeedsterLearningLessonCandidateV2,
} from "./learning-v2";

export const SPEEDSTER_LEARNING_POISONED_ARTICUNO_SESSION_ID =
  "cmscem6960006accgpc69tgwp" as const;
export const SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION =
  "sam3-local-box-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543" as const;
export const SPEEDSTER_LEARNING_CALIBRATION_SCHEMA =
  "ten-kings-speedster-sam-memory-v2-calibration-replay-v1" as const;

const LEARNING_SCALE = 0.06;
const MAX_DECISION_BOUNDARIES = 64;

type EvidenceStatus = "PASS" | "FAIL" | "INSUFFICIENT_EVIDENCE";
type ExpectedAction = "VETO" | "RETAIN";
type DecisionAction = "vetoed" | "protected" | "retained";

export type SpeedsterLearningCalibrationHistoryRowV2 = SpeedsterLearningReviewHistoryV2 & {
  cardKey: string | null;
};

export type SpeedsterLearningCalibrationThresholdsV2 = {
  tau: number;
  margin: number;
};

export type SpeedsterLearningCalibrationDecisionV2 = {
  positiveMax: number | null;
  positiveMatchSessionId: string | null;
  negativeMax: number | null;
  negativeMatchSessionId: string | null;
  gentleAdjustment: number;
  action: DecisionAction;
};

type ReplayCase = {
  caseId: string;
  sessionId: string;
  completionOrder: number;
  cardKey: string | null;
  proposalOrder: number;
  lessonOrder: number;
  provenance: SpeedsterLearningLessonCandidateV2["provenance"];
  defectType: SpeedsterLearningLessonCandidateV2["defectType"];
  sourceViewId: SpeedsterViewType;
  expectedAction: ExpectedAction;
  positiveMax: number | null;
  positiveMatchSessionId: string | null;
  negativeMax: number | null;
  negativeMatchSessionId: string | null;
};

type SensitivityRow = SpeedsterLearningCalibrationThresholdsV2 & {
  trueVetoes: number;
  falseVetoes: number;
  retainedExplicitPositives: number;
  protectedExplicitPositives: number;
};

export type SpeedsterLearningCalibrationReplayV2 = {
  schemaVersion: typeof SPEEDSTER_LEARNING_CALIBRATION_SCHEMA;
  readOnly: true;
  status: "INSUFFICIENT_EVIDENCE" | "CANDIDATE_READY_FOR_MARK_REVIEW";
  fingerprintVersion: typeof SPEEDSTER_LEARNING_FINGERPRINT_VERSION;
  orderingAuthority: "HumanGradeLabel.certificateSequence";
  excludedSessionIds: readonly [typeof SPEEDSTER_LEARNING_POISONED_ARTICUNO_SESSION_ID];
  counts: {
    inputSessions: number;
    compatibleSessions: number;
    incompatibleSessions: number;
    trustedExplicitCases: number;
    negativeCases: number;
    positiveCases: number;
    untouchedLessonsUsedOnlyInEarlierBanks: number;
  };
  distributions: {
    positiveMax: number[];
    negativeMax: number[];
  };
  evidenceCandidate: (SensitivityRow & {
    falseVetoCaseIds: string[];
  }) | null;
  falseVetoRiskCaseIds: string[];
  recommendation: SpeedsterLearningCalibrationThresholdsV2 | null;
  adjacentSensitivity: SensitivityRow[];
  requiredEvidence: {
    articunoClassRemovalAfterEarlierLesson: { status: EvidenceStatus; caseIds: string[] };
    explicitPositiveRetention: { status: EvidenceStatus; caseIds: string[] };
    unrelatedControlSuppression: { status: EvidenceStatus; caseIds: string[] };
    damageOnTextPositiveProtection: {
      status: "INSUFFICIENT_EVIDENCE";
      comparableProtectionCaseIds: string[];
      limitation: string;
    };
  };
  cases: ReplayCase[];
  capacity: {
    finalExemplars: number;
    peakEarlierBankExemplars: number;
    finalSerializedBytes: number;
    peakEarlierBankSerializedBytes: number;
  };
  latency: {
    decisions: number;
    totalDecisionMs: number;
    meanDecisionMs: number;
    maxDecisionMs: number;
  };
  boundaryGrid: {
    tauValues: number;
    marginValues: number;
    truncated: boolean;
  };
  insufficientReasons: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizedText = (value: unknown) =>
  typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";

export function speedsterLearningCardKeyV2(cardProfile: unknown, identity: unknown): string | null {
  if (!isRecord(identity)) return null;
  const parts = [
    normalizedText(cardProfile),
    normalizedText(identity.playerName),
    normalizedText(identity.cardName),
    normalizedText(identity.year),
    normalizedText(identity.manufacturer),
    normalizedText(identity.productSet),
    normalizedText(identity.parallel),
    normalizedText(identity.insert),
    normalizedText(identity.cardNumber),
  ];
  return parts.some(Boolean)
    ? createHash("sha256").update(JSON.stringify(parts)).digest("hex")
    : null;
}

export function speedsterLearningFingerprintVersionForDetectorV2(detectorVersion: unknown): string {
  return detectorVersion === SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION
    ? SPEEDSTER_LEARNING_FINGERPRINT_VERSION
    : `INCOMPATIBLE:${typeof detectorVersion === "string" ? detectorVersion : "MISSING"}`;
}

const rounded = (value: number) => Number(value.toFixed(6));

const cosine = (left: readonly number[], right: readonly number[]) =>
  Math.max(0, left.reduce((total, part, index) => total + part * right[index], 0));

const cleanUnitFingerprint = (value: readonly number[]) => {
  const norm = value.length === SPEEDSTER_LEARNING_FINGERPRINT_SIZE
    && value.every((part) => Number.isFinite(part))
    ? Math.hypot(...value)
    : Number.NaN;
  return Number.isFinite(norm) && norm > 0 && Math.abs(norm - 1) <= 0.0001
    ? normalizeSpeedsterLearningFingerprintV2(value)
    : null;
};

function maximumSimilarity(
  fingerprint: readonly number[],
  exemplars: readonly SpeedsterLearningExemplarV2[],
): { similarity: number | null; sessionId: string | null } {
  let similarity: number | null = null;
  let sessionId: string | null = null;
  for (const exemplar of exemplars) {
    const candidate = cosine(fingerprint, exemplar.fingerprint);
    if (similarity === null || candidate > similarity) {
      similarity = candidate;
      sessionId = exemplar.sessionId;
    }
  }
  return { similarity, sessionId };
}

/** Exact TypeScript mirror of the frozen Python V2 max/margin equation. */
export function evaluateSpeedsterLearningDecisionV2(input: {
  bank: SpeedsterLearningBankV2;
  lesson: Pick<SpeedsterLearningLessonCandidateV2, "defectType" | "fingerprint" | "sourceViewId">;
  thresholds: SpeedsterLearningCalibrationThresholdsV2;
}): SpeedsterLearningCalibrationDecisionV2 {
  const fingerprint = cleanUnitFingerprint(input.lesson.fingerprint);
  if (!fingerprint) {
    return {
      positiveMax: null,
      positiveMatchSessionId: null,
      negativeMax: null,
      negativeMatchSessionId: null,
      gentleAdjustment: 0,
      action: "retained",
    };
  }
  const matching = input.bank.exemplars.filter((exemplar) =>
    exemplar.defectType === input.lesson.defectType
    && exemplar.sourceViewId === input.lesson.sourceViewId);
  const positive = maximumSimilarity(
    fingerprint,
    matching.filter(({ polarity }) => polarity === "POSITIVE"),
  );
  const negative = maximumSimilarity(
    fingerprint,
    matching.filter(({ polarity }) => polarity === "NEGATIVE"),
  );
  const positiveValue = positive.similarity ?? 0;
  const negativeValue = negative.similarity ?? 0;
  const gentleAdjustment = rounded(Math.max(
    -LEARNING_SCALE,
    Math.min(LEARNING_SCALE, LEARNING_SCALE * (positiveValue - negativeValue)),
  ));
  const strongNegative = negative.similarity !== null
    && negative.similarity >= input.thresholds.tau;
  const action = strongNegative
    ? negative.similarity! - positiveValue >= input.thresholds.margin
      ? "vetoed"
      : "protected"
    : "retained";
  return {
    positiveMax: positive.similarity,
    positiveMatchSessionId: positive.sessionId,
    negativeMax: negative.similarity,
    negativeMatchSessionId: negative.sessionId,
    gentleAdjustment,
    action,
  };
}

const chronological = (history: readonly SpeedsterLearningCalibrationHistoryRowV2[]) =>
  history.map((session, inputOrder) => ({ session, inputOrder })).sort((left, right) => {
    const leftAt = new Date(left.session.completedAt).toISOString();
    const rightAt = new Date(right.session.completedAt).toISOString();
    return left.session.completionOrder - right.session.completionOrder
      || leftAt.localeCompare(rightAt)
      || left.session.sessionId.localeCompare(right.session.sessionId)
      || left.inputOrder - right.inputOrder;
  }).map(({ session }) => session);

const sensitivity = (
  cases: readonly ReplayCase[],
  thresholds: SpeedsterLearningCalibrationThresholdsV2,
): SensitivityRow => {
  let trueVetoes = 0;
  let falseVetoes = 0;
  let retainedExplicitPositives = 0;
  let protectedExplicitPositives = 0;
  for (const entry of cases) {
    const strongNegative = entry.negativeMax !== null && entry.negativeMax >= thresholds.tau;
    const action: DecisionAction = strongNegative
      ? entry.negativeMax! - (entry.positiveMax ?? 0) >= thresholds.margin
        ? "vetoed"
        : "protected"
      : "retained";
    if (entry.expectedAction === "VETO") {
      if (action === "vetoed") trueVetoes += 1;
    } else if (action === "vetoed") {
      falseVetoes += 1;
    } else {
      retainedExplicitPositives += 1;
      if (action === "protected") protectedExplicitPositives += 1;
    }
  }
  return { ...thresholds, trueVetoes, falseVetoes, retainedExplicitPositives, protectedExplicitPositives };
};

const boundaries = (values: readonly number[]) => [...new Set(values.map(rounded))].sort((a, b) => a - b);

const adjacentValues = (values: readonly number[], selected: number) => {
  const index = values.indexOf(selected);
  return [...new Set([
    values[Math.max(0, index - 1)],
    selected,
    values[Math.min(values.length - 1, index + 1)],
  ].filter((value): value is number => typeof value === "number"))];
};

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

export function replaySpeedsterLearningCalibrationV2(
  inputHistory: readonly SpeedsterLearningCalibrationHistoryRowV2[],
  options: { now?: () => number } = {},
): SpeedsterLearningCalibrationReplayV2 {
  const now = options.now ?? (() => performance.now());
  const history = chronological(inputHistory);
  const poisoned = history.find(({ sessionId }) =>
    sessionId === SPEEDSTER_LEARNING_POISONED_ARTICUNO_SESSION_ID);
  const poisonedCardKey = poisoned?.cardKey ?? null;
  const eligible: SpeedsterLearningCalibrationHistoryRowV2[] = [];
  const cases: ReplayCase[] = [];
  const decisionLatencies: number[] = [];
  let peakEarlierBankExemplars = 0;
  let peakEarlierBankSerializedBytes = 0;
  let untouchedLessonsUsedOnlyInEarlierBanks = 0;

  for (const session of history) {
    if (session.sessionId === SPEEDSTER_LEARNING_POISONED_ARTICUNO_SESSION_ID) continue;
    const earlier = deriveSpeedsterLearningBankFromHistoryV2(eligible).bank;
    peakEarlierBankExemplars = Math.max(peakEarlierBankExemplars, earlier.exemplars.length);
    peakEarlierBankSerializedBytes = Math.max(peakEarlierBankSerializedBytes, bytes(earlier));
    const harvested = harvestSpeedsterLearningSessionV2(session);
    const explicit = harvested.history.lessons.filter(({ provenance }) =>
      provenance !== "UNTOUCHED_ACCEPTED_POSITIVE");
    for (const lesson of explicit) {
      const started = now();
      const decision = evaluateSpeedsterLearningDecisionV2({
        bank: earlier,
        lesson,
        thresholds: { tau: 1, margin: 1 },
      });
      decisionLatencies.push(Math.max(0, now() - started));
      const lessonOrder = lesson.lessonOrder ?? 0;
      cases.push({
        caseId: `${session.completionOrder}:${session.sessionId}:${lesson.proposalOrder}:${lessonOrder}:${lesson.polarity}`,
        sessionId: session.sessionId,
        completionOrder: session.completionOrder,
        cardKey: session.cardKey,
        proposalOrder: lesson.proposalOrder,
        lessonOrder,
        provenance: lesson.provenance,
        defectType: lesson.defectType,
        sourceViewId: lesson.sourceViewId,
        expectedAction: lesson.polarity === "NEGATIVE" ? "VETO" : "RETAIN",
        positiveMax: decision.positiveMax,
        positiveMatchSessionId: decision.positiveMatchSessionId,
        negativeMax: decision.negativeMax,
        negativeMatchSessionId: decision.negativeMatchSessionId,
      });
    }
    untouchedLessonsUsedOnlyInEarlierBanks += harvested.history.lessons.filter(({ provenance }) =>
      provenance === "UNTOUCHED_ACCEPTED_POSITIVE").length;
    eligible.push(session);
  }

  const finalBank = deriveSpeedsterLearningBankFromHistoryV2(eligible).bank;
  const tauBoundaries = boundaries(cases.flatMap(({ negativeMax }) =>
    negativeMax === null ? [] : [negativeMax]));
  const marginBoundaries = boundaries(cases.flatMap(({ negativeMax, positiveMax }) =>
    negativeMax === null ? [] : [Math.max(0, negativeMax - (positiveMax ?? 0))]));
  const gridTruncated = tauBoundaries.length > MAX_DECISION_BOUNDARIES
    || marginBoundaries.length > MAX_DECISION_BOUNDARIES;
  const tauValues = tauBoundaries.slice(0, MAX_DECISION_BOUNDARIES);
  const marginValues = marginBoundaries.slice(0, MAX_DECISION_BOUNDARIES);
  const grid = tauValues.flatMap((tau) => marginValues.map((margin) =>
    sensitivity(cases, { tau, margin })));
  const evidenceCandidate = grid
    .filter(({ falseVetoes, trueVetoes }) => falseVetoes === 0 && trueVetoes > 0)
    .sort((left, right) => right.trueVetoes - left.trueVetoes
      || right.tau - left.tau
      || right.margin - left.margin)[0] ?? null;
  const falseVetoCaseIds = evidenceCandidate
    ? cases.filter((entry) => entry.expectedAction === "RETAIN"
      && entry.negativeMax !== null
      && entry.negativeMax >= evidenceCandidate.tau
      && entry.negativeMax - (entry.positiveMax ?? 0) >= evidenceCandidate.margin)
      .map(({ caseId }) => caseId)
    : [];
  const sensitivityRows = evidenceCandidate
    ? adjacentValues(tauValues, evidenceCandidate.tau).flatMap((tau) =>
      adjacentValues(marginValues, evidenceCandidate.margin).map((margin) =>
        sensitivity(cases, { tau, margin })))
    : [];

  const matchedSessionCardKeys = new Map(history.map(({ sessionId, cardKey }) => [sessionId, cardKey]));
  const articunoCases = evidenceCandidate && poisonedCardKey
    ? cases.filter((entry) => entry.expectedAction === "VETO"
      && entry.cardKey === poisonedCardKey
      && entry.negativeMatchSessionId
      && entry.negativeMax! >= evidenceCandidate.tau
      && entry.negativeMax! - (entry.positiveMax ?? 0) >= evidenceCandidate.margin)
    : [];
  const evaluatedPositives = cases.filter((entry) => entry.expectedAction === "RETAIN"
    && (entry.positiveMax !== null || entry.negativeMax !== null));
  const retainedPositiveCases = evidenceCandidate
    ? evaluatedPositives.filter((entry) => !(entry.negativeMax !== null
      && entry.negativeMax >= evidenceCandidate.tau
      && entry.negativeMax - (entry.positiveMax ?? 0) >= evidenceCandidate.margin))
    : [];
  const unrelatedControls = evidenceCandidate
    ? evaluatedPositives.filter((entry) => {
      const matchedCardKey = entry.negativeMatchSessionId
        ? matchedSessionCardKeys.get(entry.negativeMatchSessionId)
        : null;
      return Boolean(entry.cardKey && matchedCardKey && entry.cardKey !== matchedCardKey);
    })
    : [];
  const unrelatedRetained = evidenceCandidate
    ? unrelatedControls.filter((entry) => !(entry.negativeMax !== null
      && entry.negativeMax >= evidenceCandidate.tau
      && entry.negativeMax - (entry.positiveMax ?? 0) >= evidenceCandidate.margin))
    : [];
  const comparableProtection = evidenceCandidate
    ? evaluatedPositives.filter((entry) => entry.positiveMax !== null
      && entry.negativeMax !== null
      && entry.negativeMax >= evidenceCandidate.tau
      && entry.negativeMax - entry.positiveMax < evidenceCandidate.margin)
    : [];
  const falseVetoRiskCaseIds = cases.filter((entry) => entry.expectedAction === "RETAIN"
    && entry.negativeMax !== null
    && entry.negativeMax > (entry.positiveMax ?? 0))
    .map(({ caseId }) => caseId);

  const evidence = {
    articunoClassRemovalAfterEarlierLesson: {
      status: (!poisonedCardKey || !cases.some((entry) => entry.expectedAction === "VETO"
        && entry.cardKey === poisonedCardKey && entry.negativeMatchSessionId))
        ? "INSUFFICIENT_EVIDENCE" as const
        : articunoCases.length > 0 ? "PASS" as const : "FAIL" as const,
      caseIds: articunoCases.map(({ caseId }) => caseId),
    },
    explicitPositiveRetention: {
      status: evaluatedPositives.length === 0
        ? "INSUFFICIENT_EVIDENCE" as const
        : retainedPositiveCases.length === evaluatedPositives.length ? "PASS" as const : "FAIL" as const,
      caseIds: retainedPositiveCases.map(({ caseId }) => caseId),
    },
    unrelatedControlSuppression: {
      status: unrelatedControls.length === 0
        ? "INSUFFICIENT_EVIDENCE" as const
        : unrelatedRetained.length === unrelatedControls.length ? "PASS" as const : "FAIL" as const,
      caseIds: unrelatedRetained.map(({ caseId }) => caseId),
    },
    damageOnTextPositiveProtection: {
      status: "INSUFFICIENT_EVIDENCE" as const,
      comparableProtectionCaseIds: comparableProtection.map(({ caseId }) => caseId),
      limitation: "Completed-session history has no authoritative damage-crossing-text label; similarity alone cannot prove that condition.",
    },
  };
  const incompatibleSessions = history.filter(({ fingerprintVersion }) =>
    fingerprintVersion !== SPEEDSTER_LEARNING_FINGERPRINT_VERSION).length;
  const compatibleEligibleSessions = history.filter(({ sessionId, fingerprintVersion }) =>
    sessionId !== SPEEDSTER_LEARNING_POISONED_ARTICUNO_SESSION_ID
    && fingerprintVersion === SPEEDSTER_LEARNING_FINGERPRINT_VERSION).length;
  const insufficientReasons = [
    compatibleEligibleSessions < 2
      ? `Only ${compatibleEligibleSessions} eligible completed sessions use the exact V2 fingerprint space; older sessions are not comparable.`
      : null,
    evidenceCandidate === null ? "No data-derived tau/margin pair vetoes an explicit negative without vetoing an explicit positive." : null,
    gridTruncated ? "Observed decision boundaries exceed the bounded calibration grid; no recommendation is allowed." : null,
    evidence.articunoClassRemovalAfterEarlierLesson.status !== "PASS"
      ? "No compatible later Articuno-class explicit removal proves an earlier negative lesson takes effect." : null,
    evidence.explicitPositiveRetention.status !== "PASS"
      ? "Compatible trusted explicit-positive retention evidence is incomplete or fails." : null,
    evidence.unrelatedControlSuppression.status !== "PASS"
      ? "Compatible unrelated-control suppression evidence is incomplete or fails." : null,
    "Damage-on-text protection is not authoritatively labeled in completed-session history.",
  ].filter((reason): reason is string => Boolean(reason));
  const status = insufficientReasons.length === 0
    ? "CANDIDATE_READY_FOR_MARK_REVIEW" as const
    : "INSUFFICIENT_EVIDENCE" as const;
  const totalDecisionMs = decisionLatencies.reduce((total, value) => total + value, 0);

  return {
    schemaVersion: SPEEDSTER_LEARNING_CALIBRATION_SCHEMA,
    readOnly: true,
    status,
    fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
    orderingAuthority: "HumanGradeLabel.certificateSequence",
    excludedSessionIds: [SPEEDSTER_LEARNING_POISONED_ARTICUNO_SESSION_ID],
    counts: {
      inputSessions: history.length,
      compatibleSessions: compatibleEligibleSessions,
      incompatibleSessions,
      trustedExplicitCases: cases.length,
      negativeCases: cases.filter(({ expectedAction }) => expectedAction === "VETO").length,
      positiveCases: cases.filter(({ expectedAction }) => expectedAction === "RETAIN").length,
      untouchedLessonsUsedOnlyInEarlierBanks,
    },
    distributions: {
      positiveMax: cases.flatMap(({ positiveMax }) => positiveMax === null ? [] : [rounded(positiveMax)]).sort((a, b) => a - b),
      negativeMax: cases.flatMap(({ negativeMax }) => negativeMax === null ? [] : [rounded(negativeMax)]).sort((a, b) => a - b),
    },
    evidenceCandidate: evidenceCandidate ? { ...evidenceCandidate, falseVetoCaseIds } : null,
    falseVetoRiskCaseIds,
    recommendation: status === "CANDIDATE_READY_FOR_MARK_REVIEW" && evidenceCandidate
      ? { tau: evidenceCandidate.tau, margin: evidenceCandidate.margin }
      : null,
    adjacentSensitivity: sensitivityRows,
    requiredEvidence: evidence,
    cases,
    capacity: {
      finalExemplars: finalBank.exemplars.length,
      peakEarlierBankExemplars,
      finalSerializedBytes: bytes(finalBank),
      peakEarlierBankSerializedBytes,
    },
    latency: {
      decisions: decisionLatencies.length,
      totalDecisionMs: rounded(totalDecisionMs),
      meanDecisionMs: rounded(decisionLatencies.length ? totalDecisionMs / decisionLatencies.length : 0),
      maxDecisionMs: rounded(decisionLatencies.length ? Math.max(...decisionLatencies) : 0),
    },
    boundaryGrid: {
      tauValues: tauValues.length,
      marginValues: marginValues.length,
      truncated: gridTruncated,
    },
    insufficientReasons,
  };
}
