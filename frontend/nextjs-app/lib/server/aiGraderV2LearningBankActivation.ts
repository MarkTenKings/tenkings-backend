import type { Prisma } from "@tenkings/database";

import {
  SPEEDSTER_ARTICUNO_POISONED_SESSION_ID,
  SPEEDSTER_V1_AUDIT_ABSOLUTE_TOLERANCE,
  runLockedSpeedsterArticunoDryRun,
  speedsterLearningDeterministicHashV2,
  speedsterHistoryFingerprintVersion,
} from "../ai-grader-v2/learning-articuno-dry-run-v2";
import {
  replaySpeedsterLearningCalibrationV2,
  speedsterLearningCardKeyV2,
} from "../ai-grader-v2/learning-calibration-v2";
import {
  deriveSpeedsterLearningBankFromHistoryV2,
  type SpeedsterLearningReviewHistoryV2,
} from "../ai-grader-v2/learning-harvest-v2";
import {
  parseSpeedsterLearningBankV2,
  type SpeedsterLearningBankV2,
} from "../ai-grader-v2/learning-v2";
import {
  SPEEDSTER_LEARNING_BANK_ID,
  dispatchSpeedsterLearningBank,
} from "./aiGraderV2LearningBank";

export const SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID = SPEEDSTER_ARTICUNO_POISONED_SESSION_ID;
export const SPEEDSTER_LEARNING_BANK_BACKUP_ID = "GLOBAL_PRE_V2_ACTIVATION_BACKUP";
export const SPEEDSTER_LEARNING_ACTIVATION_DRY_RUN_STATUS = "SAFE_TO_REQUEST_APPROVAL" as const;
export const SPEEDSTER_LEARNING_BANK_BACKUP_VERSION =
  "SAM_MEMORY_V2_PREACTIVATION_BACKUP_V2" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const FLOAT_TOLERANCE = SPEEDSTER_V1_AUDIT_ABSOLUTE_TOLERANCE;

export const hashSpeedsterLearningBankState = speedsterLearningDeterministicHashV2;

export function speedsterLearningBankTolerantEqual(
  left: unknown,
  right: unknown,
  tolerance = FLOAT_TOLERANCE,
): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return left === right;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((entry, index) => speedsterLearningBankTolerantEqual(entry, right[index], tolerance));
  }
  const leftEntries = Object.entries(left as Record<string, unknown>)
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right as Record<string, unknown>)
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b));
  return leftEntries.length === rightEntries.length && leftEntries.every(([key, value], index) =>
    key === rightEntries[index]?.[0]
    && speedsterLearningBankTolerantEqual(value, rightEntries[index]?.[1], tolerance));
}

export function buildSpeedsterLearningActivationConfirmation(input: {
  expectedCurrentRowHash: string;
  calibratedBankHash: string;
  calibrationEvidenceHash: string;
  dryRunEvidenceHash: string;
}) {
  return `ACTIVATE SPEEDSTER SAM MEMORY V2 ${input.calibratedBankHash} FROM CALIBRATION ${input.calibrationEvidenceHash} AND DRY RUN ${input.dryRunEvidenceHash} REPLACING ${input.expectedCurrentRowHash}`;
}

export function buildSpeedsterLearningRollbackConfirmation(input: {
  expectedActiveRowHash: string;
  savedPreimageHash: string;
}) {
  return `ROLL BACK SPEEDSTER SAM MEMORY V2 ${input.expectedActiveRowHash} TO SAVED PREIMAGE ${input.savedPreimageHash}`;
}

export type SpeedsterLearningActivationInput = {
  mode?: "DRY_RUN" | "ACTIVATE";
  typedConfirmation?: string;
  expectedCurrentRowHash: string;
  calibrationEvidenceHash?: string;
  dryRunStatus?: typeof SPEEDSTER_LEARNING_ACTIVATION_DRY_RUN_STATUS;
  dryRunEvidenceHash?: string;
  actorUserId: string;
};

export type SpeedsterLearningRollbackInput = {
  typedConfirmation: string;
  expectedActiveRowHash: string;
  actorUserId: string;
};

type BankRow = { id: string; state: unknown; updatedAt: Date };

export type SpeedsterLearningActivationTransaction = {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  aiGraderV2LearningBank: {
    findUnique: (args: unknown) => Promise<BankRow | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  humanGradeLabel: {
    findMany: (args: unknown) => Promise<Array<{
      sourceSessionId: string | null;
      certificateSequence: number;
      createdAt: Date;
    }>>;
  };
  aiGraderV2Session: {
    findMany: (args: unknown) => Promise<Array<{
      id: string;
      reviewedDefects: unknown;
      capture: unknown;
      gradeReport: unknown;
      cardProfile: string;
      identity: unknown;
    }>>;
  };
};

export type SpeedsterLearningActivationClient = {
  $transaction: <T>(work: (tx: SpeedsterLearningActivationTransaction) => Promise<T>) => Promise<T>;
};

type BackupState = {
  version: typeof SPEEDSTER_LEARNING_BANK_BACKUP_VERSION;
  originalState: unknown;
  originalStateHash: string;
  activationBankHash: string;
  calibrationEvidenceHash: string;
  dryRunEvidenceHash: string;
  createdByUserId: string;
  createdAt: string;
};

const parseBackup = (value: unknown): BackupState | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const backup = value as Partial<BackupState>;
  if (backup.version !== SPEEDSTER_LEARNING_BANK_BACKUP_VERSION
    || !SHA256.test(String(backup.originalStateHash))
    || !SHA256.test(String(backup.activationBankHash))
    || !SHA256.test(String(backup.calibrationEvidenceHash))
    || !SHA256.test(String(backup.dryRunEvidenceHash))
    || typeof backup.createdByUserId !== "string" || !backup.createdByUserId
    || typeof backup.createdAt !== "string" || !Number.isFinite(new Date(backup.createdAt).getTime())
    || hashSpeedsterLearningBankState(backup.originalState) !== backup.originalStateHash) return null;
  return backup as BackupState;
};

const acquireLearningLock = (tx: SpeedsterLearningActivationTransaction) => tx.$queryRaw`
  SELECT 1 AS "lockAcquired"
  FROM pg_advisory_xact_lock(hashtext('ten-kings-human-grade-label-slots'))
`;

const validateActivationPreimage = (
  input: SpeedsterLearningActivationInput,
  current: BankRow | null,
  backup: BankRow | null,
) => {
  if (!current) throw new Error("SAM Memory activation requires the existing GLOBAL bank row");
  if (backup) throw new Error("SAM Memory pre-activation backup already exists");
  if (!SHA256.test(input.expectedCurrentRowHash)
    || hashSpeedsterLearningBankState(current.state) !== input.expectedCurrentRowHash) {
    throw new Error("SAM Memory activation current-row hash mismatch");
  }
  if (dispatchSpeedsterLearningBank(current.state).kind !== "V1") {
    throw new Error("SAM Memory activation requires the current GLOBAL row to be valid V1");
  }
};

async function recomputeActivationEvidence(
  tx: SpeedsterLearningActivationTransaction,
  current: BankRow,
) {
  const labels = await tx.humanGradeLabel.findMany({
    where: { source: "SPEEDSTER" },
    orderBy: { certificateSequence: "asc" },
    select: { sourceSessionId: true, certificateSequence: true, createdAt: true },
  });
  const sessions = await tx.aiGraderV2Session.findMany({
    where: { workflowState: "COMPLETED" },
    select: {
      id: true,
      reviewedDefects: true,
      capture: true,
      gradeReport: true,
      cardProfile: true,
      identity: true,
    },
  });
  const completionBySession = new Map(labels.flatMap((label) => label.sourceSessionId
    ? [[label.sourceSessionId, label] as const]
    : []));
  const calibrationHistory = sessions.flatMap((session) => {
    const completion = completionBySession.get(session.id);
    return completion ? [{
      sessionId: session.id,
      completedAt: completion.createdAt,
      completionOrder: completion.certificateSequence,
      fingerprintVersion: speedsterHistoryFingerprintVersion(session.capture, session.gradeReport),
      reviewedDefects: Array.isArray(session.reviewedDefects) ? session.reviewedDefects : [],
      cardKey: speedsterLearningCardKeyV2(session.cardProfile, session.identity),
    }] : [];
  });
  const calibration = replaySpeedsterLearningCalibrationV2(calibrationHistory, { now: () => 0 });
  if (calibration.status !== "CANDIDATE_READY_FOR_MARK_REVIEW"
    || !calibration.recommendation
    || calibration.counts.positiveCases === 0
    || calibration.counts.negativeCases === 0) {
    throw new Error("SAM Memory activation authoritative calibration recommendation did not pass");
  }
  const bank = deriveSpeedsterLearningBankFromHistoryV2(
    calibrationHistory as readonly SpeedsterLearningReviewHistoryV2[],
    new Set([SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID]),
    { status: "CALIBRATED", ...calibration.recommendation },
  ).bank;
  const positiveExemplars = bank.exemplars.filter(({ polarity }) => polarity === "POSITIVE").length;
  const negativeExemplars = bank.exemplars.filter(({ polarity }) => polarity === "NEGATIVE").length;
  if (positiveExemplars === 0 || negativeExemplars === 0) {
    throw new Error("SAM Memory activation requires both positive and negative Bank V2 exemplars");
  }
  if (bank.exemplars.some((entry) => entry.sessionId === SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID)) {
    throw new Error("SAM Memory activation canonical bank still contains the excluded session");
  }
  const dryRun = await runLockedSpeedsterArticunoDryRun({
    acquireCompletionAdvisoryLock: async () => undefined,
    listCompletionLabels: async () => labels,
    listCompletedSessions: async () => sessions,
    readGlobalLearningBank: async () => ({ state: current.state, updatedAt: current.updatedAt }),
  }, calibration.recommendation);
  const dryRunEvidenceHash = speedsterLearningDeterministicHashV2(dryRun);
  const calibrationEvidenceHash = speedsterLearningDeterministicHashV2(calibration);
  const calibratedBankHash = hashSpeedsterLearningBankState(bank);
  const latestCompletionOrder = labels.at(-1)?.certificateSequence ?? null;
  if (dryRun.status !== SPEEDSTER_LEARNING_ACTIVATION_DRY_RUN_STATUS
    || dryRun.liveV1Audit.status !== "PASS"
    || dryRun.liveV1Audit.liveExactHash !== hashSpeedsterLearningBankState(current.state)
    || dryRun.target.requestedExcludedSessionIds.length !== 1
    || dryRun.target.requestedExcludedSessionIds[0] !== SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID
    || (dryRun.target.exclusionDisposition !== "EXPLICIT_EXEMPLAR_REMOVAL"
      && dryRun.target.exclusionDisposition !== "ALREADY_INELIGIBLE_FINGERPRINT")
    || dryRun.v2.excluded.deterministicHash !== calibratedBankHash
    || bank.replayCursor?.completionOrder !== latestCompletionOrder) {
    throw new Error("SAM Memory activation authoritative Articuno dry-run did not pass");
  }
  return {
    dryRun,
    dryRunEvidenceHash,
    calibration,
    calibrationEvidenceHash,
    bank,
    calibratedBankHash,
  };
}

const verifiedActivationReadback = (
  value: unknown,
  expected: SpeedsterLearningBankV2,
  expectedPersistedHash?: string,
) => {
  const parsed = parseSpeedsterLearningBankV2(value);
  const persistedHash = hashSpeedsterLearningBankState(value);
  if (!parsed || parsed.calibration.status !== "CALIBRATED"
    || parsed.exemplars.length !== expected.exemplars.length
    || (expectedPersistedHash !== undefined && persistedHash !== expectedPersistedHash)
    || !speedsterLearningBankTolerantEqual(value, expected)) {
    throw new Error("SAM Memory activation readback verification failed");
  }
  return { parsed, persistedHash };
};

export async function runSpeedsterLearningActivation(
  client: SpeedsterLearningActivationClient,
  input: SpeedsterLearningActivationInput,
  now: () => Date = () => new Date(),
) {
  return client.$transaction(async (tx) => {
    await acquireLearningLock(tx);
    const [current, backup] = await Promise.all([
      tx.aiGraderV2LearningBank.findUnique({ where: { id: SPEEDSTER_LEARNING_BANK_ID } }),
      tx.aiGraderV2LearningBank.findUnique({ where: { id: SPEEDSTER_LEARNING_BANK_BACKUP_ID } }),
    ]);
    validateActivationPreimage(input, current, backup);
    const authoritative = await recomputeActivationEvidence(tx, current!);
    if (input.dryRunStatus && input.dryRunStatus !== authoritative.dryRun.status) {
      throw new Error("SAM Memory activation dry-run status mismatch");
    }
    if (input.dryRunEvidenceHash && input.dryRunEvidenceHash !== authoritative.dryRunEvidenceHash) {
      throw new Error("SAM Memory activation dry-run evidence hash mismatch");
    }
    if (input.calibrationEvidenceHash
      && input.calibrationEvidenceHash !== authoritative.calibrationEvidenceHash) {
      throw new Error("SAM Memory activation calibration evidence hash mismatch");
    }
    const confirmationInput = {
      expectedCurrentRowHash: input.expectedCurrentRowHash,
      calibratedBankHash: authoritative.calibratedBankHash,
      calibrationEvidenceHash: authoritative.calibrationEvidenceHash,
      dryRunEvidenceHash: authoritative.dryRunEvidenceHash,
    };
    const requiredConfirmation = buildSpeedsterLearningActivationConfirmation(confirmationInput);
    if ((input.mode ?? "DRY_RUN") !== "ACTIVATE") {
      return {
        mode: "DRY_RUN" as const,
        writes: 0 as const,
        ready: true as const,
        requiredConfirmation,
        currentRowHash: input.expectedCurrentRowHash,
        calibratedBankHash: authoritative.calibratedBankHash,
        calibrationStatus: authoritative.calibration.status,
        calibrationRecommendation: authoritative.calibration.recommendation,
        calibrationEvidenceHash: authoritative.calibrationEvidenceHash,
        dryRunStatus: SPEEDSTER_LEARNING_ACTIVATION_DRY_RUN_STATUS,
        dryRunEvidenceHash: authoritative.dryRunEvidenceHash,
        exemplarCount: authoritative.bank.exemplars.length,
      };
    }
    if (input.dryRunStatus !== authoritative.dryRun.status
      || input.dryRunEvidenceHash !== authoritative.dryRunEvidenceHash
      || input.calibrationEvidenceHash !== authoritative.calibrationEvidenceHash) {
      throw new Error("SAM Memory activation requires the exact authoritative calibration and dry-run evidence hashes");
    }
    if (input.typedConfirmation !== requiredConfirmation) {
      throw new Error("SAM Memory activation typed confirmation mismatch");
    }

    await tx.aiGraderV2LearningBank.update({
      where: { id: SPEEDSTER_LEARNING_BANK_ID },
      data: { state: authoritative.bank as unknown as Prisma.InputJsonValue },
    });
    const firstReadback = await tx.aiGraderV2LearningBank.findUnique({
      where: { id: SPEEDSTER_LEARNING_BANK_ID },
    });
    if (!firstReadback) throw new Error("SAM Memory activation GLOBAL readback is missing");
    const firstVerified = verifiedActivationReadback(firstReadback.state, authoritative.bank);
    const backupState = {
      version: SPEEDSTER_LEARNING_BANK_BACKUP_VERSION,
      originalState: current!.state,
      originalStateHash: input.expectedCurrentRowHash,
      activationBankHash: firstVerified.persistedHash,
      calibrationEvidenceHash: authoritative.calibrationEvidenceHash,
      dryRunEvidenceHash: authoritative.dryRunEvidenceHash,
      createdByUserId: input.actorUserId,
      createdAt: now().toISOString(),
    } satisfies BackupState;
    await tx.aiGraderV2LearningBank.create({
      data: {
        id: SPEEDSTER_LEARNING_BANK_BACKUP_ID,
        state: backupState as unknown as Prisma.InputJsonValue,
      },
    });
    const [finalReadback, backupReadback] = await Promise.all([
      tx.aiGraderV2LearningBank.findUnique({ where: { id: SPEEDSTER_LEARNING_BANK_ID } }),
      tx.aiGraderV2LearningBank.findUnique({ where: { id: SPEEDSTER_LEARNING_BANK_BACKUP_ID } }),
    ]);
    if (!finalReadback) throw new Error("SAM Memory activation final GLOBAL readback is missing");
    const verifiedBackup = parseBackup(backupReadback?.state);
    if (!verifiedBackup
      || verifiedBackup.originalStateHash !== input.expectedCurrentRowHash
      || verifiedBackup.activationBankHash !== firstVerified.persistedHash) {
      throw new Error("SAM Memory activation backup readback verification failed");
    }
    const verified = verifiedActivationReadback(
      finalReadback.state,
      authoritative.bank,
      firstVerified.persistedHash,
    );
    return {
      mode: "ACTIVATE" as const,
      writes: 2 as const,
      activated: true as const,
      activeRowHash: verified.persistedHash,
      calibratedBankHash: authoritative.calibratedBankHash,
      savedPreimageHash: input.expectedCurrentRowHash,
      calibrationEvidenceHash: authoritative.calibrationEvidenceHash,
      dryRunEvidenceHash: authoritative.dryRunEvidenceHash,
      exemplarCount: verified.parsed.exemplars.length,
      version: verified.parsed.version,
    };
  });
}

export async function runSpeedsterLearningRollback(
  client: SpeedsterLearningActivationClient,
  input: SpeedsterLearningRollbackInput,
) {
  return client.$transaction(async (tx) => {
    await acquireLearningLock(tx);
    const [current, backupRow] = await Promise.all([
      tx.aiGraderV2LearningBank.findUnique({ where: { id: SPEEDSTER_LEARNING_BANK_ID } }),
      tx.aiGraderV2LearningBank.findUnique({ where: { id: SPEEDSTER_LEARNING_BANK_BACKUP_ID } }),
    ]);
    if (!current || !backupRow) throw new Error("SAM Memory rollback requires active and saved bank rows");
    const backup = parseBackup(backupRow.state);
    if (!backup) throw new Error("SAM Memory rollback backup is invalid");
    const activeHash = hashSpeedsterLearningBankState(current.state);
    if (!SHA256.test(input.expectedActiveRowHash)
      || activeHash !== input.expectedActiveRowHash
      || dispatchSpeedsterLearningBank(current.state).kind !== "V2") {
      throw new Error("SAM Memory rollback active-row hash mismatch");
    }
    const requiredConfirmation = buildSpeedsterLearningRollbackConfirmation({
      expectedActiveRowHash: input.expectedActiveRowHash,
      savedPreimageHash: backup.originalStateHash,
    });
    if (input.typedConfirmation !== requiredConfirmation) {
      throw new Error("SAM Memory rollback typed confirmation mismatch");
    }
    await tx.aiGraderV2LearningBank.update({
      where: { id: SPEEDSTER_LEARNING_BANK_ID },
      data: { state: backup.originalState as Prisma.InputJsonValue },
    });
    const readback = await tx.aiGraderV2LearningBank.findUnique({
      where: { id: SPEEDSTER_LEARNING_BANK_ID },
    });
    if (!readback
      || hashSpeedsterLearningBankState(readback.state) !== backup.originalStateHash
      || !speedsterLearningBankTolerantEqual(readback.state, backup.originalState)) {
      throw new Error("SAM Memory rollback readback verification failed");
    }
    return {
      mode: "ROLLBACK" as const,
      writes: 1 as const,
      restored: true as const,
      restoredRowHash: backup.originalStateHash,
      retainedBackupRow: SPEEDSTER_LEARNING_BANK_BACKUP_ID,
    };
  });
}
