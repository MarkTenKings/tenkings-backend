import type { Prisma } from "@tenkings/database";

import {
  incrementSpeedsterLearningBankFromHistoryV2,
  type SpeedsterLearningReviewHistoryV2,
} from "../ai-grader-v2/learning-harvest-v2";
import {
  SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  parseSpeedsterLearningBankV2,
  type SpeedsterLearningBankV2,
} from "../ai-grader-v2/learning-v2";
import {
  cleanSpeedsterLearningBank,
  type SpeedsterLearningBank,
} from "../ai-grader-v2/learning";
import { speedsterHistoryFingerprintVersion } from "../ai-grader-v2/learning-articuno-dry-run-v2";

export const SPEEDSTER_LEARNING_BANK_ID = "GLOBAL";
export const SPEEDSTER_LEARNING_BANK_LOCK = "ten-kings-human-grade-label-slots";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export type SpeedsterLearningBankDispatch =
  | { kind: "V1"; bank: SpeedsterLearningBank }
  | { kind: "V2"; bank: SpeedsterLearningBankV2; raw: unknown }
  | { kind: "INVALID"; bank: null };

/**
 * One explicit version dispatch prevents calibrated V2 memory from ever being
 * cleaned into an empty V1 bank. A missing row retains the existing empty-V1
 * bootstrap; a declared V1 row still uses the unchanged V1 cleaner.
 */
export function dispatchSpeedsterLearningBank(value: unknown): SpeedsterLearningBankDispatch {
  if (value == null) return { kind: "V1", bank: cleanSpeedsterLearningBank(value) };
  if (!isRecord(value)) return { kind: "INVALID", bank: null };
  if (value.version === 1) return { kind: "V1", bank: cleanSpeedsterLearningBank(value) };
  if (value.version === 2) {
    const bank = parseSpeedsterLearningBankV2(value);
    return bank ? { kind: "V2", bank, raw: value } : { kind: "INVALID", bank: null };
  }
  return { kind: "INVALID", bank: null };
}

export function speedsterLearningBankForDetect(value: unknown): unknown {
  const dispatch = dispatchSpeedsterLearningBank(value);
  if (dispatch.kind === "V1") return dispatch.bank;
  // Validation is exact, but the calibrated JSON payload itself is forwarded
  // unchanged so TypeScript never rewrites calibrated floats or exemplar order.
  if (dispatch.kind === "V2") return dispatch.raw;
  return null;
}

type LearningLabelRow = {
  sourceSessionId: string | null;
  certificateSequence: number;
  createdAt: Date;
};

type LearningSessionRow = {
  id: string;
  workflowState: string;
  reviewedDefects: unknown;
  capture: unknown;
  gradeReport: unknown;
};

export type SpeedsterLearningCatchUpTransaction = {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  aiGraderV2LearningBank: {
    findUnique: (args: unknown) => Promise<{ state: unknown } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  humanGradeLabel: {
    findMany: (args: unknown) => Promise<LearningLabelRow[]>;
  };
  aiGraderV2Session: {
    findMany: (args: unknown) => Promise<LearningSessionRow[]>;
  };
};

export type SpeedsterLearningCatchUpClient = {
  $transaction: <T>(work: (tx: SpeedsterLearningCatchUpTransaction) => Promise<T>) => Promise<T>;
};

export type SpeedsterLearningCatchUpResult = {
  status: "V1_ACTIVE" | "INVALID_ACTIVE_BANK" | "V2_CURRENT" | "V2_UPDATED";
  appliedSessions: number;
  lastCompletionOrder: number | null;
};

export async function catchUpSpeedsterLearningBankV2InTransaction(
  tx: SpeedsterLearningCatchUpTransaction,
): Promise<SpeedsterLearningCatchUpResult> {
  await tx.$queryRaw`
    SELECT 1 AS "lockAcquired"
    FROM pg_advisory_xact_lock(hashtext('ten-kings-human-grade-label-slots'))
  `;
  const stored = await tx.aiGraderV2LearningBank.findUnique({
    where: { id: SPEEDSTER_LEARNING_BANK_ID },
    select: { state: true },
  });
  const dispatch = dispatchSpeedsterLearningBank(stored?.state);
  if (dispatch.kind === "V1") {
    return { status: "V1_ACTIVE", appliedSessions: 0, lastCompletionOrder: null };
  }
  if (dispatch.kind === "INVALID") {
    return { status: "INVALID_ACTIVE_BANK", appliedSessions: 0, lastCompletionOrder: null };
  }

  const after = dispatch.bank.replayCursor?.completionOrder ?? 0;
  const labels = await tx.humanGradeLabel.findMany({
    where: {
      source: "SPEEDSTER",
      sourceSessionId: { not: null },
      certificateSequence: { gt: after },
    },
    orderBy: { certificateSequence: "asc" },
    select: { sourceSessionId: true, certificateSequence: true, createdAt: true },
  });
  if (labels.length === 0) {
    return {
      status: "V2_CURRENT",
      appliedSessions: 0,
      lastCompletionOrder: dispatch.bank.replayCursor?.completionOrder ?? null,
    };
  }

  const sessionIds = labels.map((label) => label.sourceSessionId).filter((id): id is string => Boolean(id));
  const sessions = await tx.aiGraderV2Session.findMany({
    where: { id: { in: sessionIds }, workflowState: "COMPLETED" },
    select: { id: true, workflowState: true, reviewedDefects: true, capture: true, gradeReport: true },
  });
  const byId = new Map(sessions.map((session) => [session.id, session]));
  let nextBank = dispatch.bank;
  for (const label of labels) {
    const sessionId = label.sourceSessionId;
    if (!sessionId) throw new Error("SAM Memory V2 catch-up found a Speedster label without a session ID");
    const session = byId.get(sessionId);
    if (!session || session.workflowState !== "COMPLETED" || !Array.isArray(session.reviewedDefects)) {
      throw new Error(`SAM Memory V2 catch-up is missing completed session ${sessionId ?? "unknown"}`);
    }
    if (speedsterHistoryFingerprintVersion(session.capture, session.gradeReport)
      !== SPEEDSTER_LEARNING_FINGERPRINT_VERSION) {
      throw new Error(`SAM Memory V2 catch-up found incompatible evidence for ${sessionId}`);
    }
    const history = {
      sessionId,
      completedAt: label.createdAt,
      completionOrder: label.certificateSequence,
      fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
      reviewedDefects: session.reviewedDefects,
    } satisfies SpeedsterLearningReviewHistoryV2;
    nextBank = incrementSpeedsterLearningBankFromHistoryV2(nextBank, history).bank;
  }

  await tx.aiGraderV2LearningBank.update({
    where: { id: SPEEDSTER_LEARNING_BANK_ID },
    data: { state: nextBank as unknown as Prisma.InputJsonValue },
  });
  return {
    status: "V2_UPDATED",
    appliedSessions: labels.length,
    lastCompletionOrder: nextBank.replayCursor?.completionOrder ?? null,
  };
}

export function catchUpSpeedsterLearningBankV2(client: SpeedsterLearningCatchUpClient) {
  return client.$transaction((tx) => catchUpSpeedsterLearningBankV2InTransaction(tx));
}

export async function afterDurableSpeedsterCompletion<T>(
  complete: () => Promise<T>,
  catchUp: () => Promise<unknown>,
  onLearningFailure: (error: unknown) => void = () => undefined,
): Promise<T> {
  const result = await complete();
  try {
    await catchUp();
  } catch (error) {
    onLearningFailure(error);
  }
  return result;
}
