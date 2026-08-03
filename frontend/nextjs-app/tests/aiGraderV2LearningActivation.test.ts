import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  catchUpSpeedsterLearningBankV2,
  dispatchSpeedsterLearningBank,
  speedsterLearningBankForDetect,
  afterDurableSpeedsterCompletion,
  type SpeedsterLearningCatchUpClient,
  type SpeedsterLearningCatchUpTransaction,
} from "../lib/server/aiGraderV2LearningBank";
import {
  SPEEDSTER_LEARNING_BANK_BACKUP_ID,
  SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID,
  buildSpeedsterLearningActivationConfirmation,
  buildSpeedsterLearningRollbackConfirmation,
  hashSpeedsterLearningBankState,
  runSpeedsterLearningActivation,
  runSpeedsterLearningRollback,
  type SpeedsterLearningActivationClient,
  type SpeedsterLearningActivationInput,
  type SpeedsterLearningActivationTransaction,
} from "../lib/server/aiGraderV2LearningBankActivation";
import { deriveSpeedsterLearningBankFromHistoryV2 } from "../lib/ai-grader-v2/learning-harvest-v2";
import {
  SPEEDSTER_LEARNING_FINGERPRINT_SIZE,
  SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  type SpeedsterLearningBankV2,
} from "../lib/ai-grader-v2/learning-v2";

const fingerprint = (index: number) => Array.from(
  { length: SPEEDSTER_LEARNING_FINGERPRINT_SIZE },
  (_, part) => part === index % SPEEDSTER_LEARNING_FINGERPRINT_SIZE ? 1 : 0,
);

const calibrationSessionId = "calibration-session";
const authoritativeCompletedAt = (sequence: number) => new Date(Date.UTC(2026, 7, 2, 12, sequence));
const inspectionFrame = {
  width: 1350,
  height: 1858,
  cardBounds: { x: 40, y: 40, width: 1270, height: 1778 },
};
const compatibleCapture = {
  front: { inspectionStorageKey: "front-inspection.webp", inspectionFrame },
  back: { inspectionStorageKey: "back-inspection.webp", inspectionFrame },
};
const compatibleGradeReport = {
  detectorVersion: "sam3-local-box-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543",
};

const v1Bank = {
  version: 1,
  types: {
    VISIBLE_WHITENING: {
      negative: { count: 1, sum: fingerprint(0) },
    },
  },
} as const;

test("dispatch preserves V1 and forwards a valid calibrated V2 payload unchanged", () => {
  const v1 = dispatchSpeedsterLearningBank(v1Bank);
  assert.equal(v1.kind, "V1");
  assert.deepEqual(speedsterLearningBankForDetect(v1Bank), v1.bank);

  const v2 = calibratedBank();
  assert.equal(dispatchSpeedsterLearningBank(v2).kind, "V2");
  assert.equal(speedsterLearningBankForDetect(v2), v2);
  assert.equal(speedsterLearningBankForDetect({ ...v2, fingerprintVersion: "wrong" }), null);
  assert.equal(speedsterLearningBankForDetect({ version: 77, types: {} }), null);
});

type CatchUpLabel = { sourceSessionId: string; certificateSequence: number; createdAt: Date };
type CatchUpSession = {
  id: string;
  workflowState: string;
  reviewedDefects: unknown[];
  capture: unknown;
  gradeReport: unknown;
};

class CatchUpStore implements SpeedsterLearningCatchUpClient {
  bank: unknown;
  labels: CatchUpLabel[] = [];
  sessions: CatchUpSession[] = [];
  failNextUpdate = false;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(bank: unknown) {
    this.bank = bank;
  }

  $transaction<T>(work: (tx: SpeedsterLearningCatchUpTransaction) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const before = structuredClone(this.bank);
      const tx: SpeedsterLearningCatchUpTransaction = {
        $queryRaw: async () => [{ lockAcquired: 1 }],
        aiGraderV2LearningBank: {
          findUnique: async () => ({ state: structuredClone(this.bank) }),
          update: async (raw) => {
            if (this.failNextUpdate) {
              this.failNextUpdate = false;
              throw new Error("simulated bank write failure");
            }
            const args = raw as { data: { state: unknown } };
            this.bank = structuredClone(args.data.state);
            return { state: this.bank };
          },
        },
        humanGradeLabel: {
          findMany: async (raw) => {
            const args = raw as { where: { certificateSequence: { gt: number } } };
            return this.labels
              .filter((label) => label.certificateSequence > args.where.certificateSequence.gt)
              .sort((a, b) => a.certificateSequence - b.certificateSequence);
          },
        },
        aiGraderV2Session: {
          findMany: async (raw) => {
            const args = raw as { where: { id: { in: string[] }; workflowState: string } };
            return this.sessions.filter((session) =>
              args.where.id.in.includes(session.id) && session.workflowState === args.where.workflowState);
          },
        },
      };
      try {
        return await work(tx);
      } catch (error) {
        this.bank = before;
        throw error;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}

const removedFinding = (index: number) => ({
  origin: "DETECTOR",
  reviewResult: "REMOVED",
  detectedDefectType: "VISIBLE_WHITENING",
  defectType: "VISIBLE_WHITENING",
  featureFingerprint: fingerprint(index),
  sourceViewId: "ORIGINAL",
});

const authoritativeHistory = (targetFindings: unknown[] = []) => [{
  sessionId: SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID,
  completedAt: authoritativeCompletedAt(1),
  completionOrder: 1,
  fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  reviewedDefects: targetFindings,
}, {
  sessionId: calibrationSessionId,
  completedAt: authoritativeCompletedAt(2),
  completionOrder: 2,
  fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  reviewedDefects: [removedFinding(0)],
}];

const calibratedBank = (): SpeedsterLearningBankV2 => deriveSpeedsterLearningBankFromHistoryV2(
  authoritativeHistory(),
  new Set([SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID]),
  { status: "CALIBRATED", tau: 0.91, margin: 0.08 },
).bank;

const addCompleted = (store: CatchUpStore, sequence: number, findingIndex = sequence) => {
  const sessionId = `completed-session-${sequence.toString().padStart(3, "0")}`;
  store.labels.push({
    sourceSessionId: sessionId,
    certificateSequence: sequence,
    createdAt: new Date(Date.UTC(2026, 7, 2, 12, sequence)),
  });
  store.sessions.push({
    id: sessionId,
    workflowState: "COMPLETED",
    reviewedDefects: [removedFinding(findingIndex)],
    capture: compatibleCapture,
    gradeReport: compatibleGradeReport,
  });
};

const emptyCalibratedBank = () => deriveSpeedsterLearningBankFromHistoryV2(
  [], new Set(), { status: "CALIBRATED", tau: 0.91, margin: 0.08 },
).bank;

test("two out-of-order catch-up attempts serialize and preserve every completion lesson", async () => {
  const store = new CatchUpStore(emptyCalibratedBank());
  addCompleted(store, 1, 1);
  addCompleted(store, 2, 2);

  const [first, second] = await Promise.all([
    catchUpSpeedsterLearningBankV2(store),
    catchUpSpeedsterLearningBankV2(store),
  ]);
  const bank = dispatchSpeedsterLearningBank(store.bank);
  assert.equal(bank.kind, "V2");
  if (bank.kind !== "V2") return;
  assert.deepEqual([first.appliedSessions, second.appliedSessions].sort(), [0, 2]);
  assert.equal(bank.bank.replayCursor?.completionOrder, 2);
  assert.deepEqual(bank.bank.exemplars.map(({ completionOrder }) => completionOrder), [1, 2]);
});

test("a failed best-effort V2 write cannot undo completion and the next catch-up heals the gap", async () => {
  let completed = false;
  let failureObserved = false;
  const result = await afterDurableSpeedsterCompletion(async () => {
    completed = true;
    return "durable-grade";
  }, async () => {
    throw new Error("learning unavailable");
  }, () => {
    failureObserved = true;
  });
  assert.equal(result, "durable-grade");
  assert.equal(completed, true);
  assert.equal(failureObserved, true);

  const store = new CatchUpStore(emptyCalibratedBank());
  addCompleted(store, 1);
  store.failNextUpdate = true;
  await assert.rejects(catchUpSpeedsterLearningBankV2(store), /simulated bank write failure/);
  assert.equal((dispatchSpeedsterLearningBank(store.bank) as { bank: SpeedsterLearningBankV2 }).bank.replayCursor, null);
  const healed = await catchUpSpeedsterLearningBankV2(store);
  assert.equal(healed.appliedSessions, 1);
  assert.equal((dispatchSpeedsterLearningBank(store.bank) as { bank: SpeedsterLearningBankV2 }).bank.replayCursor?.completionOrder, 1);
});

test("catch-up uses certificate order, exact retry is inert, and capacity remains 50", async () => {
  const store = new CatchUpStore(emptyCalibratedBank());
  for (let sequence = 51; sequence >= 1; sequence -= 1) addCompleted(store, sequence, sequence);
  const applied = await catchUpSpeedsterLearningBankV2(store);
  const bank = dispatchSpeedsterLearningBank(store.bank);
  assert.equal(applied.appliedSessions, 51);
  assert.equal(bank.kind, "V2");
  if (bank.kind !== "V2") return;
  assert.equal(bank.bank.exemplars.length, 50);
  assert.equal(bank.bank.exemplars[0].completionOrder, 2);
  assert.equal(bank.bank.exemplars.at(-1)?.completionOrder, 51);
  const retry = await catchUpSpeedsterLearningBankV2(store);
  assert.equal(retry.status, "V2_CURRENT");
  assert.equal(retry.appliedSessions, 0);
});

type ActivationRow = { id: string; state: unknown; updatedAt: Date };

class ActivationStore implements SpeedsterLearningActivationClient {
  rows = new Map<string, ActivationRow>();
  writes = 0;
  unrelated = { sessions: 12, labels: 12, reports: 12, images: 24 };
  labels = authoritativeHistory().map((entry) => ({
    sourceSessionId: entry.sessionId,
    certificateSequence: entry.completionOrder,
    createdAt: authoritativeCompletedAt(entry.completionOrder),
  }));
  sessions = authoritativeHistory().map((entry) => ({
    id: entry.sessionId,
    reviewedDefects: entry.reviewedDefects,
    capture: compatibleCapture,
    gradeReport: compatibleGradeReport,
  }));

  constructor(active: unknown) {
    this.rows.set("GLOBAL", {
      id: "GLOBAL",
      state: structuredClone(active),
      updatedAt: new Date("2026-08-02T19:00:00.000Z"),
    });
  }

  async $transaction<T>(work: (tx: SpeedsterLearningActivationTransaction) => Promise<T>): Promise<T> {
    const draft = new Map([...this.rows].map(([id, row]) => [id, structuredClone(row)]));
    let writes = 0;
    const tx: SpeedsterLearningActivationTransaction = {
      $queryRaw: async () => [{ lockAcquired: 1 }],
      aiGraderV2LearningBank: {
        findUnique: async (raw) => {
          const args = raw as { where: { id: string } };
          return structuredClone(draft.get(args.where.id) ?? null);
        },
        create: async (raw) => {
          const args = raw as { data: Omit<ActivationRow, "updatedAt"> };
          if (draft.has(args.data.id)) throw new Error("duplicate row");
          draft.set(args.data.id, {
            ...structuredClone(args.data),
            updatedAt: new Date("2026-08-02T20:00:00.000Z"),
          });
          writes += 1;
          return args.data;
        },
        update: async (raw) => {
          const args = raw as { where: { id: string }; data: { state: unknown } };
          if (!draft.has(args.where.id)) throw new Error("missing row");
          draft.set(args.where.id, {
            id: args.where.id,
            state: structuredClone(args.data.state),
            updatedAt: new Date("2026-08-02T20:00:00.000Z"),
          });
          writes += 1;
          return draft.get(args.where.id)!;
        },
      },
      humanGradeLabel: {
        findMany: async () => structuredClone(this.labels),
      },
      aiGraderV2Session: {
        findMany: async () => structuredClone(this.sessions),
      },
    };
    const result = await work(tx);
    this.rows = draft;
    this.writes += writes;
    return result;
  }
}

const activationInput = (bank: unknown = calibratedBank()): SpeedsterLearningActivationInput => {
  const expectedCurrentRowHash = hashSpeedsterLearningBankState(v1Bank);
  const calibratedBankHash = hashSpeedsterLearningBankState(bank);
  return {
    mode: "DRY_RUN",
    expectedCurrentRowHash,
    calibratedBankHash,
    calibratedBank: bank,
    targetExcludedSessionId: SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID,
    actorUserId: "admin-user",
  };
};

test("activation dry-run validates exact evidence and performs zero writes", async () => {
  const store = new ActivationStore(v1Bank);
  const input = activationInput();
  const result = await runSpeedsterLearningActivation(store, input);
  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.writes, 0);
  assert.equal(store.writes, 0);
  assert.equal(store.rows.has(SPEEDSTER_LEARNING_BANK_BACKUP_ID), false);
  assert.equal(result.requiredConfirmation, buildSpeedsterLearningActivationConfirmation({
    calibratedBankHash: input.calibratedBankHash,
    dryRunEvidenceHash: result.dryRunEvidenceHash,
    targetExcludedSessionId: input.targetExcludedSessionId,
  }));
});

test("activation aborts on wrong hash, evidence, calibration, exclusion, or confirmation", async () => {
  await assert.rejects(
    runSpeedsterLearningActivation(new ActivationStore(v1Bank), {
      ...activationInput(), expectedCurrentRowHash: "0".repeat(64),
    }),
    /current-row hash mismatch/,
  );
  await assert.rejects(
    runSpeedsterLearningActivation(new ActivationStore(v1Bank), {
      ...activationInput(), calibratedBankHash: "0".repeat(64),
    }),
    /calibrated-bank hash mismatch/,
  );
  await assert.rejects(
    runSpeedsterLearningActivation(new ActivationStore(v1Bank), {
      ...activationInput(), dryRunEvidenceHash: "e".repeat(64),
    }),
    /dry-run evidence hash mismatch/,
  );
  const uncalibrated = deriveSpeedsterLearningBankFromHistoryV2([]).bank;
  await assert.rejects(
    runSpeedsterLearningActivation(new ActivationStore(v1Bank), activationInput(uncalibrated)),
    /externally calibrated/,
  );
  await assert.rejects(
    runSpeedsterLearningActivation(
      new ActivationStore(v1Bank),
      activationInput(deriveSpeedsterLearningBankFromHistoryV2(
        authoritativeHistory([removedFinding(4)]),
        new Set(),
        { status: "CALIBRATED", tau: 0.91, margin: 0.08 },
      ).bank),
    ),
    /still contains the excluded session/,
  );
  const wrongConfirmationStore = new ActivationStore(v1Bank);
  const preflight = await runSpeedsterLearningActivation(wrongConfirmationStore, activationInput());
  await assert.rejects(
    runSpeedsterLearningActivation(wrongConfirmationStore, {
      ...activationInput(),
      mode: "ACTIVATE",
      typedConfirmation: preflight.requiredConfirmation,
    }),
    /requires the exact authoritative dry-run status and evidence hash/,
  );
  await assert.rejects(
    runSpeedsterLearningActivation(wrongConfirmationStore, {
      ...activationInput(),
      mode: "ACTIVATE",
      dryRunStatus: preflight.dryRunStatus,
      dryRunEvidenceHash: preflight.dryRunEvidenceHash,
      typedConfirmation: "wrong",
    }),
    /typed confirmation mismatch/,
  );
});

test("activation endpoint is admin-authenticated and defaults to zero-write dry-run", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/learning-bank-activation.ts`,
    "utf8",
  );
  assert.match(source, /requireAdminSession/);
  assert.match(source, /z\.enum\(\["DRY_RUN", "ACTIVATE"\]\)\.default\("DRY_RUN"\)/);
  assert.match(source, /runSpeedsterLearningActivation/);
  assert.match(source, /runSpeedsterLearningRollback/);
  assert.doesNotMatch(source, /delete|deleteMany|updateMany/);
});

test("activation transaction saves one inert backup, swaps only GLOBAL, verifies, and rolls back", async () => {
  const store = new ActivationStore(v1Bank);
  const unrelatedBefore = structuredClone(store.unrelated);
  const input = activationInput();
  const preflight = await runSpeedsterLearningActivation(store, input);
  input.mode = "ACTIVATE";
  input.dryRunStatus = preflight.dryRunStatus;
  input.dryRunEvidenceHash = preflight.dryRunEvidenceHash;
  input.typedConfirmation = preflight.requiredConfirmation;
  const activated = await runSpeedsterLearningActivation(
    store,
    input,
    () => new Date("2026-08-02T20:00:00.000Z"),
  );
  assert.equal(activated.mode, "ACTIVATE");
  assert.equal(store.writes, 2);
  assert.equal(hashSpeedsterLearningBankState(store.rows.get("GLOBAL")?.state), input.calibratedBankHash);
  assert.equal(dispatchSpeedsterLearningBank(store.rows.get(SPEEDSTER_LEARNING_BANK_BACKUP_ID)?.state).kind, "INVALID");
  assert.deepEqual(store.unrelated, unrelatedBefore);

  const rollbackConfirmation = buildSpeedsterLearningRollbackConfirmation({
    expectedActiveRowHash: input.calibratedBankHash,
    savedPreimageHash: input.expectedCurrentRowHash,
  });
  const rolledBack = await runSpeedsterLearningRollback(store, {
    typedConfirmation: rollbackConfirmation,
    expectedActiveRowHash: input.calibratedBankHash,
    actorUserId: "admin-user",
  });
  assert.equal(rolledBack.mode, "ROLLBACK");
  assert.equal(hashSpeedsterLearningBankState(store.rows.get("GLOBAL")?.state), input.expectedCurrentRowHash);
  assert.equal(store.rows.has(SPEEDSTER_LEARNING_BANK_BACKUP_ID), true);
  assert.deepEqual(store.unrelated, unrelatedBefore);
});

test("rollback requires exact active hash and typed confirmation", async () => {
  const store = new ActivationStore(v1Bank);
  const input = activationInput();
  const preflight = await runSpeedsterLearningActivation(store, input);
  input.mode = "ACTIVATE";
  input.dryRunStatus = preflight.dryRunStatus;
  input.dryRunEvidenceHash = preflight.dryRunEvidenceHash;
  input.typedConfirmation = preflight.requiredConfirmation;
  await runSpeedsterLearningActivation(store, input);
  await assert.rejects(runSpeedsterLearningRollback(store, {
    typedConfirmation: "wrong",
    expectedActiveRowHash: input.calibratedBankHash,
    actorUserId: "admin-user",
  }), /typed confirmation mismatch/);
  await assert.rejects(runSpeedsterLearningRollback(store, {
    typedConfirmation: buildSpeedsterLearningRollbackConfirmation({
      expectedActiveRowHash: "0".repeat(64),
      savedPreimageHash: input.expectedCurrentRowHash,
    }),
    expectedActiveRowHash: "0".repeat(64),
    actorUserId: "admin-user",
  }), /active-row hash mismatch/);
});
