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
  SPEEDSTER_LEARNING_ARTICUNO_ATTESTED_COHORT,
  replaySpeedsterLearningCalibrationV2,
  speedsterLearningCardKeyV2,
} from "../lib/ai-grader-v2/learning-calibration-v2";
import {
  SPEEDSTER_LEARNING_FINGERPRINT_SIZE,
  SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  type SpeedsterLearningBankV2,
} from "../lib/ai-grader-v2/learning-v2";
import { updateSpeedsterLearningBank, type SpeedsterLearningBank } from "../lib/ai-grader-v2/learning";

const fingerprint = (index: number) => Array.from(
  { length: SPEEDSTER_LEARNING_FINGERPRINT_SIZE },
  (_, part) => part === index % SPEEDSTER_LEARNING_FINGERPRINT_SIZE ? 1 : 0,
);

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

const smartMarkFinding = (index: number) => ({
  origin: "SMART_MARK",
  reviewResult: "SMART_MARKED",
  defectType: "VISIBLE_WHITENING",
  featureFingerprint: fingerprint(index),
  sourceViewId: "ORIGINAL",
});

const authoritativeHistory = () => [{
  sessionId: SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID,
  completedAt: authoritativeCompletedAt(225),
  completionOrder: 225,
  fingerprintVersion: "INCOMPATIBLE_PRE_INSPECTION_2MM",
  reviewedDefects: [removedFinding(5)],
  capture: {},
  gradeReport: { detectorVersion: "pre-inspection-detector" },
  cardProfile: "POKEMON",
  identity: { cardName: "Articuno", testRun: "poison" },
}, {
  sessionId: SPEEDSTER_LEARNING_ARTICUNO_ATTESTED_COHORT[0].sessionId,
  completedAt: authoritativeCompletedAt(SPEEDSTER_LEARNING_ARTICUNO_ATTESTED_COHORT[0].completionOrder),
  completionOrder: SPEEDSTER_LEARNING_ARTICUNO_ATTESTED_COHORT[0].completionOrder,
  fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  reviewedDefects: [removedFinding(0)],
  capture: compatibleCapture,
  gradeReport: compatibleGradeReport,
  cardProfile: "POKEMON",
  identity: { cardName: "Articuno", testRun: "first" },
}, {
  sessionId: SPEEDSTER_LEARNING_ARTICUNO_ATTESTED_COHORT[1].sessionId,
  completedAt: authoritativeCompletedAt(SPEEDSTER_LEARNING_ARTICUNO_ATTESTED_COHORT[1].completionOrder),
  completionOrder: SPEEDSTER_LEARNING_ARTICUNO_ATTESTED_COHORT[1].completionOrder,
  fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  reviewedDefects: [removedFinding(0)],
  capture: compatibleCapture,
  gradeReport: compatibleGradeReport,
  cardProfile: "POKEMON",
  identity: { cardName: "Articuno", testRun: "repeat" },
}, {
  sessionId: "positive-unrelated-control",
  completedAt: authoritativeCompletedAt(228),
  completionOrder: 228,
  fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
  reviewedDefects: [smartMarkFinding(1)],
  capture: compatibleCapture,
  gradeReport: compatibleGradeReport,
  cardProfile: "POKEMON",
  identity: { cardName: "Unrelated control" },
}];

const authoritativeCalibration = () => replaySpeedsterLearningCalibrationV2(
  authoritativeHistory().map((entry) => ({
    ...entry,
    cardKey: speedsterLearningCardKeyV2(entry.cardProfile, entry.identity),
  })),
  { now: () => 0 },
);

const calibratedBank = (): SpeedsterLearningBankV2 => {
  const recommendation = authoritativeCalibration().recommendation;
  if (!recommendation) throw new Error("Activation test history must have an authoritative recommendation");
  return deriveSpeedsterLearningBankFromHistoryV2(
    authoritativeHistory(),
    new Set([SPEEDSTER_LEARNING_V2_EXCLUDED_SESSION_ID]),
    { status: "CALIBRATED", ...recommendation },
  ).bank;
};

const activationV1Bank = authoritativeHistory().reduce<SpeedsterLearningBank>(
  (bank, entry) => updateSpeedsterLearningBank(bank, entry.reviewedDefects),
  { version: 1, types: {} },
);

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
  sessions: Array<{
    id: string;
    reviewedDefects: unknown[];
    capture: unknown;
    gradeReport: unknown;
    cardProfile: string;
    identity: unknown;
  }> = authoritativeHistory().map((entry) => ({
    id: entry.sessionId,
    reviewedDefects: entry.reviewedDefects,
    capture: entry.capture,
    gradeReport: entry.gradeReport,
    cardProfile: entry.cardProfile,
    identity: entry.identity,
  }));
  persistGlobalState: (value: unknown) => unknown;
  hidePersistedBackup = false;
  driftFinalGlobalReadback = false;
  globalReadbacksAfterWrite = 0;

  constructor(active: unknown, persistGlobalState: (value: unknown) => unknown = structuredClone) {
    this.persistGlobalState = persistGlobalState;
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
          if (writes > 0 && args.where.id === "GLOBAL") {
            this.globalReadbacksAfterWrite += 1;
          }
          if (writes > 0 && args.where.id === SPEEDSTER_LEARNING_BANK_BACKUP_ID
            && this.hidePersistedBackup) return null;
          const row = structuredClone(draft.get(args.where.id) ?? null);
          if (row && args.where.id === "GLOBAL" && this.driftFinalGlobalReadback
            && this.globalReadbacksAfterWrite >= 2) {
            const state = row.state as SpeedsterLearningBankV2;
            if (state.version === 2 && state.exemplars[0]) {
              state.exemplars[0].fingerprint[0] += 5e-15;
            }
          }
          return row;
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
            state: args.where.id === "GLOBAL"
              ? this.persistGlobalState(structuredClone(args.data.state))
              : structuredClone(args.data.state),
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

const activationInput = (): SpeedsterLearningActivationInput => {
  const expectedCurrentRowHash = hashSpeedsterLearningBankState(activationV1Bank);
  return {
    mode: "DRY_RUN",
    expectedCurrentRowHash,
    actorUserId: "admin-user",
  };
};

test("activation dry-run derives the canonical bank from locked authoritative evidence and performs zero writes", async () => {
  const store = new ActivationStore(activationV1Bank);
  const input = activationInput();
  const result = await runSpeedsterLearningActivation(store, input);
  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.writes, 0);
  assert.equal(store.writes, 0);
  assert.equal(store.rows.has(SPEEDSTER_LEARNING_BANK_BACKUP_ID), false);
  assert.equal(result.requiredConfirmation, buildSpeedsterLearningActivationConfirmation({
    expectedCurrentRowHash: input.expectedCurrentRowHash,
    calibratedBankHash: result.calibratedBankHash,
    calibrationEvidenceHash: result.calibrationEvidenceHash,
    dryRunEvidenceHash: result.dryRunEvidenceHash,
  }));
  assert.equal(result.calibratedBankHash, hashSpeedsterLearningBankState(calibratedBank()));
  assert.deepEqual(result.calibrationRecommendation, authoritativeCalibration().recommendation);
});

test("activation aborts on wrong preimage/evidence or confirmation", async () => {
  await assert.rejects(
    runSpeedsterLearningActivation(new ActivationStore(activationV1Bank), {
      ...activationInput(), expectedCurrentRowHash: "0".repeat(64),
    }),
    /current-row hash mismatch/,
  );
  await assert.rejects(
    runSpeedsterLearningActivation(new ActivationStore(activationV1Bank), {
      ...activationInput(), dryRunEvidenceHash: "e".repeat(64),
    }),
    /dry-run evidence hash mismatch/,
  );
  await assert.rejects(
    runSpeedsterLearningActivation(new ActivationStore(activationV1Bank), {
      ...activationInput(), calibrationEvidenceHash: "d".repeat(64),
    }),
    /calibration evidence hash mismatch/,
  );
  const wrongConfirmationStore = new ActivationStore(activationV1Bank);
  const preflight = await runSpeedsterLearningActivation(wrongConfirmationStore, activationInput());
  await assert.rejects(
    runSpeedsterLearningActivation(wrongConfirmationStore, {
      ...activationInput(),
      mode: "ACTIVATE",
      typedConfirmation: preflight.requiredConfirmation,
    }),
    /requires the exact authoritative calibration and dry-run evidence hashes/,
  );
  await assert.rejects(
    runSpeedsterLearningActivation(wrongConfirmationStore, {
      ...activationInput(),
      mode: "ACTIVATE",
      calibrationEvidenceHash: preflight.calibrationEvidenceHash,
      dryRunStatus: preflight.dryRunStatus,
      dryRunEvidenceHash: preflight.dryRunEvidenceHash,
      typedConfirmation: "wrong",
    }),
    /typed confirmation mismatch/,
  );
});

test("activation remains fail-closed when authoritative history lacks either exemplar polarity", async () => {
  const noPositive = new ActivationStore(activationV1Bank);
  noPositive.sessions = noPositive.sessions.map((session) => session.id === "positive-unrelated-control"
    ? { ...session, reviewedDefects: [] }
    : session);
  await assert.rejects(
    runSpeedsterLearningActivation(noPositive, activationInput()),
    /authoritative calibration recommendation did not pass/,
  );
  assert.equal(noPositive.writes, 0);

  const noNegative = new ActivationStore(activationV1Bank);
  noNegative.sessions = noNegative.sessions.map((session) => ({
    ...session,
    reviewedDefects: session.reviewedDefects.map((finding) => ({
      ...(finding as Record<string, unknown>),
      origin: "SMART_MARK",
      reviewResult: "SMART_MARKED",
      detectedDefectType: undefined,
    })),
  }));
  await assert.rejects(
    runSpeedsterLearningActivation(noNegative, activationInput()),
    /authoritative calibration recommendation did not pass/,
  );
  assert.equal(noNegative.writes, 0);
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
  assert.doesNotMatch(source, /calibratedBank(?:Hash)?/);
  assert.doesNotMatch(source, /delete|deleteMany|updateMany/);
});

test("activation transaction saves one inert backup, swaps only GLOBAL, verifies, and rolls back", async () => {
  const store = new ActivationStore(activationV1Bank);
  const unrelatedBefore = structuredClone(store.unrelated);
  const input = activationInput();
  const preflight = await runSpeedsterLearningActivation(store, input);
  assert.equal(preflight.mode, "DRY_RUN");
  if (preflight.mode !== "DRY_RUN") return;
  input.mode = "ACTIVATE";
  input.calibrationEvidenceHash = preflight.calibrationEvidenceHash;
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
  assert.equal(activated.calibratedBankHash, preflight.calibratedBankHash);
  assert.equal(hashSpeedsterLearningBankState(store.rows.get("GLOBAL")?.state), activated.activeRowHash);
  assert.equal(dispatchSpeedsterLearningBank(store.rows.get(SPEEDSTER_LEARNING_BANK_BACKUP_ID)?.state).kind, "INVALID");
  assert.deepEqual(store.unrelated, unrelatedBefore);

  const rollbackConfirmation = buildSpeedsterLearningRollbackConfirmation({
    expectedActiveRowHash: activated.activeRowHash,
    savedPreimageHash: input.expectedCurrentRowHash,
  });
  const rolledBack = await runSpeedsterLearningRollback(store, {
    typedConfirmation: rollbackConfirmation,
    expectedActiveRowHash: activated.activeRowHash,
    actorUserId: "admin-user",
  });
  assert.equal(rolledBack.mode, "ROLLBACK");
  assert.equal(hashSpeedsterLearningBankState(store.rows.get("GLOBAL")?.state), input.expectedCurrentRowHash);
  assert.equal(store.rows.has(SPEEDSTER_LEARNING_BANK_BACKUP_ID), true);
  assert.deepEqual(store.unrelated, unrelatedBefore);
});

test("activation binds rollback to the exact persisted hash after tolerance-safe JSON numeric drift", async () => {
  const persistWithTinyNumericDrift = (value: unknown) => {
    const persisted = structuredClone(value) as SpeedsterLearningBankV2;
    if (persisted.version === 2 && persisted.exemplars[0]) {
      persisted.exemplars[0].fingerprint[0] += 5e-15;
    }
    return persisted;
  };
  const store = new ActivationStore(activationV1Bank, persistWithTinyNumericDrift);
  const input = activationInput();
  const preflight = await runSpeedsterLearningActivation(store, input);
  assert.equal(preflight.mode, "DRY_RUN");
  if (preflight.mode !== "DRY_RUN") return;
  const activated = await runSpeedsterLearningActivation(store, {
    ...input,
    mode: "ACTIVATE",
    calibrationEvidenceHash: preflight.calibrationEvidenceHash,
    dryRunStatus: preflight.dryRunStatus,
    dryRunEvidenceHash: preflight.dryRunEvidenceHash,
    typedConfirmation: preflight.requiredConfirmation,
  });
  assert.equal(activated.mode, "ACTIVATE");
  assert.notEqual(activated.activeRowHash, activated.calibratedBankHash);
  assert.equal(hashSpeedsterLearningBankState(store.rows.get("GLOBAL")?.state), activated.activeRowHash);
  assert.equal(
    (store.rows.get(SPEEDSTER_LEARNING_BANK_BACKUP_ID)?.state as { activationBankHash?: string })
      .activationBankHash,
    activated.activeRowHash,
  );
  const rolledBack = await runSpeedsterLearningRollback(store, {
    typedConfirmation: buildSpeedsterLearningRollbackConfirmation({
      expectedActiveRowHash: activated.activeRowHash,
      savedPreimageHash: input.expectedCurrentRowHash,
    }),
    expectedActiveRowHash: activated.activeRowHash,
    actorUserId: "admin-user",
  });
  assert.equal(rolledBack.restoredRowHash, input.expectedCurrentRowHash);
});

test("activation rolls back when the persisted backup cannot be verified", async () => {
  const store = new ActivationStore(activationV1Bank);
  const input = activationInput();
  const preflight = await runSpeedsterLearningActivation(store, input);
  assert.equal(preflight.mode, "DRY_RUN");
  if (preflight.mode !== "DRY_RUN") return;
  store.hidePersistedBackup = true;
  await assert.rejects(runSpeedsterLearningActivation(store, {
    ...input,
    mode: "ACTIVATE",
    calibrationEvidenceHash: preflight.calibrationEvidenceHash,
    dryRunStatus: preflight.dryRunStatus,
    dryRunEvidenceHash: preflight.dryRunEvidenceHash,
    typedConfirmation: preflight.requiredConfirmation,
  }), /backup readback verification failed/);
  assert.equal(store.writes, 0);
  assert.equal(hashSpeedsterLearningBankState(store.rows.get("GLOBAL")?.state), input.expectedCurrentRowHash);
  assert.equal(store.rows.has(SPEEDSTER_LEARNING_BANK_BACKUP_ID), false);
});

test("activation rolls back when the final GLOBAL hash changes after its persisted identity is captured", async () => {
  const store = new ActivationStore(activationV1Bank);
  const input = activationInput();
  const preflight = await runSpeedsterLearningActivation(store, input);
  assert.equal(preflight.mode, "DRY_RUN");
  if (preflight.mode !== "DRY_RUN") return;
  store.driftFinalGlobalReadback = true;
  await assert.rejects(runSpeedsterLearningActivation(store, {
    ...input,
    mode: "ACTIVATE",
    calibrationEvidenceHash: preflight.calibrationEvidenceHash,
    dryRunStatus: preflight.dryRunStatus,
    dryRunEvidenceHash: preflight.dryRunEvidenceHash,
    typedConfirmation: preflight.requiredConfirmation,
  }), /activation readback verification failed/);
  assert.equal(store.writes, 0);
  assert.equal(hashSpeedsterLearningBankState(store.rows.get("GLOBAL")?.state), input.expectedCurrentRowHash);
  assert.equal(store.rows.has(SPEEDSTER_LEARNING_BANK_BACKUP_ID), false);
});

test("rollback requires exact active hash and typed confirmation", async () => {
  const store = new ActivationStore(activationV1Bank);
  const input = activationInput();
  const preflight = await runSpeedsterLearningActivation(store, input);
  assert.equal(preflight.mode, "DRY_RUN");
  if (preflight.mode !== "DRY_RUN") return;
  input.mode = "ACTIVATE";
  input.calibrationEvidenceHash = preflight.calibrationEvidenceHash;
  input.dryRunStatus = preflight.dryRunStatus;
  input.dryRunEvidenceHash = preflight.dryRunEvidenceHash;
  input.typedConfirmation = preflight.requiredConfirmation;
  const activated = await runSpeedsterLearningActivation(store, input);
  await assert.rejects(runSpeedsterLearningRollback(store, {
    typedConfirmation: "wrong",
    expectedActiveRowHash: activated.activeRowHash,
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
