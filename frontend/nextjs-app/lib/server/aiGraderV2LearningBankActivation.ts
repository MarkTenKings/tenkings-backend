import type { Prisma } from "@tenkings/database";

import {
  SPEEDSTER_ARTICUNO_POISONED_SESSION_ID,
  SPEEDSTER_V1_AUDIT_ABSOLUTE_TOLERANCE,
  runLockedSpeedsterArticunoDryRun,
  speedsterLearningDeterministicHashV2,
} from "../ai-grader-v2/learning-articuno-dry-run-v2";
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
  "SAM_MEMORY_V2_PREACTIVATION_BACKUP_V1" as const;

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
  calibratedBankHash: string;
  dryRunEvidenceHash: string;
  targetExcludedSessionId: string;
}) {
  return `ACTIVATE SPEEDSTER SAM MEMORY V2 ${input.calibratedBankHash} FROM DRY RUN ${input.dryRunEvidenceHash} EXCLUDING ${input.targetExcludedSessionId}`;
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
  calibratedBankHash: string;
  calibratedBank: unknown;
  dryRunStatus?: typeof SPEEDSTER_LEARNING_ACTIVATION_DRY_RUN_STATUS;
  dryRunEvidenceHash?: string;
  targetExcludedSessionId: typeof SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID;
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
  dryRunEvidenceHash: string;
  targetExcludedSessionId: typeof SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID;
  createdByUserId: string;
  createdAt: string;
};

const parseBackup = (value: unknown): BackupState | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const backup = value as Partial<BackupState>;
  if (backup.version !== SPEEDSTER_LEARNING_BANK_BACKUP_VERSION
    || !SHA256.test(String(backup.originalStateHash))
    || !SHA256.test(String(backup.activationBankHash))
    || !SHA256.test(String(backup.dryRunEvidenceHash))
    || backup.targetExcludedSessionId !== SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID
    || typeof backup.createdByUserId !== "string" || !backup.createdByUserId
    || typeof backup.createdAt !== "string" || !Number.isFinite(new Date(backup.createdAt).getTime())
    || hashSpeedsterLearningBankState(backup.originalState) !== backup.originalStateHash) return null;
  return backup as BackupState;
};

const acquireLearningLock = (tx: SpeedsterLearningActivationTransaction) => tx.$queryRaw`
  SELECT 1 AS "lockAcquired"
  FROM pg_advisory_xact_lock(hashtext('ten-kings-human-grade-label-slots'))
`;

const validateActivation = (
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
  if (input.targetExcludedSessionId !== SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID) {
    throw new Error("SAM Memory activation excluded-session identity mismatch");
  }
  if (!SHA256.test(input.calibratedBankHash)
    || hashSpeedsterLearningBankState(input.calibratedBank) !== input.calibratedBankHash) {
    throw new Error("SAM Memory activation calibrated-bank hash mismatch");
  }
  const bank = parseSpeedsterLearningBankV2(input.calibratedBank);
  if (!bank || bank.calibration.status !== "CALIBRATED") {
    throw new Error("SAM Memory activation requires one externally calibrated Bank V2 payload");
  }
  if (hashSpeedsterLearningBankState(bank) !== input.calibratedBankHash
    || !speedsterLearningBankTolerantEqual(input.calibratedBank, bank)) {
    throw new Error("SAM Memory activation requires canonical calibrated Bank V2 bytes");
  }
  if (bank.exemplars.some((entry) => entry.sessionId === input.targetExcludedSessionId)) {
    throw new Error("SAM Memory activation payload still contains the excluded session");
  }
  return bank;
};

async function recomputeActivationDryRun(
  tx: SpeedsterLearningActivationTransaction,
  current: BankRow,
  bank: SpeedsterLearningBankV2,
) {
  if (bank.calibration.status !== "CALIBRATED") {
    throw new Error("SAM Memory activation requires calibrated tau and margin");
  }
  const labels = await tx.humanGradeLabel.findMany({
    where: { source: "SPEEDSTER" },
    orderBy: { certificateSequence: "asc" },
    select: { sourceSessionId: true, certificateSequence: true, createdAt: true },
  });
  const sessions = await tx.aiGraderV2Session.findMany({
    where: { workflowState: "COMPLETED" },
    select: { id: true, reviewedDefects: true, capture: true, gradeReport: true },
  });
  const report = await runLockedSpeedsterArticunoDryRun({
    acquireCompletionAdvisoryLock: async () => undefined,
    listCompletionLabels: async () => labels,
    listCompletedSessions: async () => sessions,
    readGlobalLearningBank: async () => ({ state: current.state, updatedAt: current.updatedAt }),
  }, { tau: bank.calibration.tau, margin: bank.calibration.margin });
  const evidenceHash = speedsterLearningDeterministicHashV2(report);
  const latestCompletionOrder = labels.at(-1)?.certificateSequence ?? null;
  if (report.status !== SPEEDSTER_LEARNING_ACTIVATION_DRY_RUN_STATUS
    || report.liveV1Audit.status !== "PASS"
    || report.liveV1Audit.liveExactHash !== hashSpeedsterLearningBankState(current.state)
    || report.target.requestedExcludedSessionIds.length !== 1
    || report.target.requestedExcludedSessionIds[0] !== SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID
    || report.v2.excluded.deterministicHash !== hashSpeedsterLearningBankState(bank)
    || bank.replayCursor?.completionOrder !== latestCompletionOrder) {
    throw new Error("SAM Memory activation authoritative Articuno dry-run did not pass");
  }
  return { report, evidenceHash };
}

const verifiedActivationReadback = (value: unknown, expected: SpeedsterLearningBankV2, expectedHash: string) => {
  const parsed = parseSpeedsterLearningBankV2(value);
  if (!parsed || parsed.calibration.status !== "CALIBRATED"
    || parsed.exemplars.length !== expected.exemplars.length
    || hashSpeedsterLearningBankState(value) !== expectedHash
    || !speedsterLearningBankTolerantEqual(value, expected)) {
    throw new Error("SAM Memory activation readback verification failed");
  }
  return parsed;
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
    const bank = validateActivation(input, current, backup);
    const authoritative = await recomputeActivationDryRun(tx, current!, bank);
    if (input.dryRunStatus && input.dryRunStatus !== authoritative.report.status) {
      throw new Error("SAM Memory activation dry-run status mismatch");
    }
    if (input.dryRunEvidenceHash && input.dryRunEvidenceHash !== authoritative.evidenceHash) {
      throw new Error("SAM Memory activation dry-run evidence hash mismatch");
    }
    const confirmationInput = {
      calibratedBankHash: input.calibratedBankHash,
      dryRunEvidenceHash: authoritative.evidenceHash,
      targetExcludedSessionId: input.targetExcludedSessionId,
    };
    const requiredConfirmation = buildSpeedsterLearningActivationConfirmation(confirmationInput);
    if ((input.mode ?? "DRY_RUN") !== "ACTIVATE") {
      return {
        mode: "DRY_RUN" as const,
        writes: 0 as const,
        ready: true as const,
        requiredConfirmation,
        currentRowHash: input.expectedCurrentRowHash,
        calibratedBankHash: input.calibratedBankHash,
        dryRunStatus: SPEEDSTER_LEARNING_ACTIVATION_DRY_RUN_STATUS,
        dryRunEvidenceHash: authoritative.evidenceHash,
        exemplarCount: bank.exemplars.length,
      };
    }
    if (input.dryRunStatus !== authoritative.report.status
      || input.dryRunEvidenceHash !== authoritative.evidenceHash) {
      throw new Error("SAM Memory activation requires the exact authoritative dry-run status and evidence hash");
    }
    if (input.typedConfirmation !== requiredConfirmation) {
      throw new Error("SAM Memory activation typed confirmation mismatch");
    }

    const backupState = {
      version: SPEEDSTER_LEARNING_BANK_BACKUP_VERSION,
      originalState: current!.state,
      originalStateHash: input.expectedCurrentRowHash,
      activationBankHash: input.calibratedBankHash,
      dryRunEvidenceHash: authoritative.evidenceHash,
      targetExcludedSessionId: input.targetExcludedSessionId,
      createdByUserId: input.actorUserId,
      createdAt: now().toISOString(),
    } satisfies BackupState;
    await tx.aiGraderV2LearningBank.create({
      data: {
        id: SPEEDSTER_LEARNING_BANK_BACKUP_ID,
        state: backupState as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.aiGraderV2LearningBank.update({
      where: { id: SPEEDSTER_LEARNING_BANK_ID },
      data: { state: input.calibratedBank as Prisma.InputJsonValue },
    });
    const readback = await tx.aiGraderV2LearningBank.findUnique({
      where: { id: SPEEDSTER_LEARNING_BANK_ID },
    });
    if (!readback) throw new Error("SAM Memory activation GLOBAL readback is missing");
    const verified = verifiedActivationReadback(readback.state, bank, input.calibratedBankHash);
    return {
      mode: "ACTIVATE" as const,
      writes: 2 as const,
      activated: true as const,
      currentRowHash: input.calibratedBankHash,
      savedPreimageHash: input.expectedCurrentRowHash,
      dryRunEvidenceHash: authoritative.evidenceHash,
      exemplarCount: verified.exemplars.length,
      version: verified.version,
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
