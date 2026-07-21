const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  aiGraderCalibrationWorkstationReceiptStatementV1,
  canonicalAiGraderOperatingContextV1,
  canonicalAiGraderRuntimeContextV1,
} = require("@tenkings/shared");
const {
  createAiGraderCalibrationActivationService,
} = require("../dist/database/src/aiGraderCalibrationActivationService");

const NOW = new Date("2026-07-21T18:30:00.000Z");
const RIG_ID = "ten-kings-fixed-rig-v1";
const TENANT_ID = "tenant-1";
const KEY_ID = "d".repeat(64);

function sha(value) {
  return require("node:crypto").createHash("sha256").update(value).digest("hex");
}

function members(seed) {
  return [
    ["calibration_profile", undefined, "mathematical-calibration-profile-v1.json"],
    ["physical_calibration_artifact", undefined, "mathematical-calibration-artifact-v1.json"],
    ["calibration_acceptance", undefined, "mathematical-calibration-acceptance-v1.json"],
    ...Array.from({ length: 8 }, (_, index) => ["flat_field", index + 1, `flat-field-channel-${index + 1}-v1.json`]),
    ["illumination_pattern", undefined, "illumination-pattern-v1.json"],
  ].map(([role, channelIndex, fileName], index) => ({
    role,
    ...(channelIndex ? { channelIndex } : {}),
    fileName,
    sha256: sha(`${seed}:${index}`),
  }));
}

function context(seed) {
  const ledger = members(seed);
  return {
    schemaVersion: "ten-kings-ai-grader-operating-context-v1",
    rig: {
      tenantId: TENANT_ID,
      rigId: RIG_ID,
      rigVersion: "fixed-rig-v1",
      locationId: "calibration-bench",
      locationIdentity: "Ten Kings calibration bench",
    },
    camera: { serial: "basler-1", model: "Basler-test" },
    optics: { lensIdentity: "lens-1", mountIdentity: "mount-1" },
    controller: {
      controllerIdentity: "leimac-1",
      channelWiringMapIdentity: "wiring-map-v1",
      channelMap: Array.from({ length: 8 }, (_, index) => ({
        channelIndex: index + 1,
        controllerOutput: `output-${index + 1}`,
        lightingRole: `direction-${index + 1}`,
      })),
    },
    lighting: {
      configurationIdentity: "lighting-v1",
      selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
      dutyPercent: 20,
    },
    capture: { exposureUs: 10000, gain: 0, pixelFormat: "Mono8", widthPx: 1200, heightPx: 1680 },
    calibration: {
      targetSha256: sha(`target:${seed}`),
      rigCharacterizationSha256: sha(`rig:${seed}`),
      bundleSchemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
      bundleManifestSha256: sha(`bundle:${seed}`),
      sourceCaptureManifestSha256: sha(`capture:${seed}`),
      memberLedgerSha256: sha(JSON.stringify(ledger)),
      members: ledger,
    },
    software: {
      captureProfileVersion: "fixed-rig-capture-v1",
      calibrationAlgorithmVersion: "fixed-rig-physical-calibration-v1.0.0",
      analysisAlgorithmVersion: "opencv-physical-calibration-analysis-v1",
      thresholdSetId: "mathematical-grading-v1",
      thresholdSetHash: sha("threshold"),
      helperInstanceId: "helper-1",
      helperVersion: "helper-v1",
    },
  };
}

function snapshot(id, seed) {
  const operatingContext = context(seed);
  return {
    id,
    rigId: RIG_ID,
    calibrationType: "MATHEMATICAL_GRADING_V1",
    trustStatus: "TRUSTED",
    trustedAt: new Date("2026-07-21T17:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-07-21T16:00:00.000Z"),
    mathematicalProfileId: `profile-${seed}`,
    mathematicalCalibrationVersion: `calibration-${seed}`,
    mathematicalArtifactSha256: sha(`artifact:${seed}`),
    mathematicalBundleManifestSha256: operatingContext.calibration.bundleManifestSha256,
    mathematicalMemberLedgerSha256: operatingContext.calibration.memberLedgerSha256,
    mathematicalRigCharacterizationSha256: operatingContext.calibration.rigCharacterizationSha256,
    mathematicalOperatingContextV1: operatingContext,
    mathematicalOperatingContextHash: sha(canonicalAiGraderOperatingContextV1(operatingContext)),
    mathematicalRuntimeContextHash: sha(canonicalAiGraderRuntimeContextV1(operatingContext)),
    rig: { id: RIG_ID, status: "ACTIVE", tenant: { id: TENANT_ID } },
  };
}

function createMemoryDb(snapshots) {
  const state = {
    snapshots,
    activations: [],
    activePointers: new Map(),
    pendingPointers: new Map(),
  };
  let transactionTail = Promise.resolve();

  function matches(row, where = {}) {
    return Object.entries(where).every(([key, value]) => value === undefined || row[key] === value);
  }

  const db = {
    $transaction(callback) {
      const run = transactionTail.then(() => callback(db));
      transactionTail = run.catch(() => undefined);
      return run;
    },
    calibrationSnapshot: {
      async findMany({ where }) {
        return state.snapshots.filter((row) => matches(row, where));
      },
      async findFirst({ where }) {
        return state.snapshots.find((row) => matches(row, where)) ?? null;
      },
    },
    mathematicalCalibrationActivation: {
      async findMany({ where }) {
        return state.activations.filter((row) => matches(row, where))
          .sort((left, right) => right.requestedAt - left.requestedAt);
      },
      async findFirst({ where, orderBy }) {
        const matchesRows = state.activations.filter((row) => matches(row, where));
        if (orderBy) matchesRows.sort((left, right) => right.requestedAt - left.requestedAt);
        const row = matchesRows[0];
        if (!row) return null;
        row.calibrationSnapshot = state.snapshots.find((entry) => entry.id === row.calibrationSnapshotId);
        return row;
      },
      async create({ data }) {
        const row = { ...data, events: [], createdAt: data.createdAt ?? NOW };
        state.activations.push(row);
        return row;
      },
    },
    mathematicalCalibrationActivationEvent: {
      async create({ data }) {
        const activation = state.activations.find((row) => row.id === data.activationId);
        assert.ok(activation, "event activation exists");
        const event = { id: `event-${data.activationId}-${data.sequence}`, ...data, createdAt: data.occurredAt };
        activation.events.push(event);
        return event;
      },
    },
    mathematicalCalibrationActivePointer: {
      async findUnique({ where }) {
        return state.activePointers.get(where.rigId) ?? null;
      },
      async create({ data }) {
        if (state.activePointers.has(data.rigId)) throw new Error("duplicate active rig");
        const pointer = { ...data };
        state.activePointers.set(data.rigId, pointer);
        return pointer;
      },
      async delete({ where }) {
        const pointer = state.activePointers.get(where.rigId);
        state.activePointers.delete(where.rigId);
        return pointer;
      },
    },
    mathematicalCalibrationPendingPointer: {
      async findUnique({ where }) {
        return state.pendingPointers.get(where.rigId) ?? null;
      },
      async create({ data }) {
        if (state.pendingPointers.has(data.rigId)) throw new Error("duplicate pending rig");
        const pointer = { ...data };
        state.pendingPointers.set(data.rigId, pointer);
        return pointer;
      },
      async delete({ where }) {
        const pointer = state.pendingPointers.get(where.rigId);
        state.pendingPointers.delete(where.rigId);
        return pointer;
      },
    },
  };
  return { db, state };
}

function activationRequest(snapshotId, revision, idempotencyKey, action = "activate", priorActivationId) {
  return {
    action,
    rigId: RIG_ID,
    snapshotId,
    expectedRegistryRevision: revision,
    idempotencyKey,
    reason: action === "reactivate" ? "explicit historical calibration reactivation" : "explicit calibrated profile selection",
    ...(priorActivationId ? { priorActivationId } : {}),
  };
}

function signedReceipt(pendingAuthority, privateKey) {
  const receipt = {
    schemaVersion: "ten-kings-ai-grader-calibration-workstation-receipt-v1",
    activationId: pendingAuthority.activationId,
    activationHash: pendingAuthority.activationHash,
    activationRevision: pendingAuthority.activationRevision,
    snapshotId: pendingAuthority.snapshotId,
    rigId: pendingAuthority.rigId,
    bundleManifestSha256: pendingAuthority.bundleManifestSha256,
    memberLedgerSha256: pendingAuthority.memberLedgerSha256,
    runtimeContextHash: pendingAuthority.runtimeContextHash,
    rigCharacterizationSha256: pendingAuthority.rigCharacterizationSha256,
    expectedOperatingContextHash: pendingAuthority.operatingContextHash,
    observedOperatingContextHash: pendingAuthority.operatingContextHash,
    helperInstanceId: "helper-1",
    helperVersion: "helper-v1",
    workstationKeyId: KEY_ID,
    signatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
    verifiedAt: NOW.toISOString(),
    expiresAt: pendingAuthority.pendingExpiresAt,
    signature: "A".repeat(86),
  };
  receipt.signature = sign(
    "sha256",
    Buffer.from(aiGraderCalibrationWorkstationReceiptStatementV1(receipt), "utf8"),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");
  return receipt;
}

async function errorCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

test("two-phase activation is exact, fail-closed, explicitly reactivatable, and single-active under concurrency", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const first = snapshot("snapshot-1", "v1");
  const second = snapshot("snapshot-2", "v2");
  const { db, state } = createMemoryDb([first, second]);
  let nextId = 0;
  const service = createAiGraderCalibrationActivationService(db, {
    now: () => new Date(NOW),
    randomId: () => `activation-${++nextId}`,
    acquireRigLock: async () => undefined,
    verifySnapshotStorage: async (row) => {
      assert.equal(row.trustStatus, "TRUSTED");
      assert.equal(row.revokedAt, null);
    },
    workstationPublicKeys: new Map([[KEY_ID, { keyId: KEY_ID, tenantId: TENANT_ID, publicKey }]]),
  });

  let registry = await service.list(RIG_ID, true);
  const initial = await service.requestActivation(
    activationRequest(first.id, registry.registryRevision, "activate-v1"),
    "admin-1",
  );
  assert.equal(initial.activation.state, "PENDING");
  assert.ok(initial.pendingAuthority);
  assert.equal(state.activePointers.size, 0);
  assert.equal(state.pendingPointers.size, 1);

  const completed = await service.completeActivation({
    activationId: initial.activation.activationId,
    expectedActivationRevision: initial.activation.activationRevision,
    idempotencyKey: "complete-v1",
    workstationReceipt: signedReceipt(initial.pendingAuthority, privateKey),
  }, "admin-1");
  assert.equal(completed.activation.state, "ACTIVE");
  assert.equal(state.activePointers.size, 1);
  assert.equal(state.pendingPointers.size, 0);
  assert.equal((await service.readStartAuthority(TENANT_ID, RIG_ID)).authority.activationId, completed.activation.activationId);

  registry = await service.list(RIG_ID, true);
  const replacement = await service.requestActivation(
    activationRequest(second.id, registry.registryRevision, "activate-v2"),
    "admin-1",
  );
  assert.equal(replacement.activation.state, "PENDING");
  assert.equal(state.activePointers.size, 0, "selecting a new exact profile immediately removes old active authority");
  await errorCode(
    service.readStartAuthority(TENANT_ID, RIG_ID),
    "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
  );

  const failed = await service.failActivation({
    activationId: replacement.activation.activationId,
    expectedActivationRevision: replacement.activation.activationRevision,
    idempotencyKey: "fail-v2",
    failureCode: "LIVE_OPERATING_CONTEXT_MISMATCH",
  }, "admin-1");
  assert.equal(failed.activation.state, "FAILED");
  assert.equal(state.activePointers.size, 0);
  assert.equal(state.pendingPointers.size, 0);
  await errorCode(
    service.readStartAuthority(TENANT_ID, RIG_ID),
    "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
  );

  registry = await service.list(RIG_ID, true);
  await errorCode(
    service.requestActivation(
      activationRequest(first.id, registry.registryRevision, "ordinary-reuse"),
      "admin-1",
    ),
    "AI_GRADER_CALIBRATION_ACTIVATION_EXPLICIT_REACTIVATION_REQUIRED",
  );
  const reactivatedPending = await service.requestActivation(
    activationRequest(first.id, registry.registryRevision, "reactivate-v1", "reactivate", completed.activation.activationId),
    "admin-1",
  );
  assert.equal(reactivatedPending.activation.priorActivationId, completed.activation.activationId);

  const receipt = signedReceipt(reactivatedPending.pendingAuthority, privateKey);
  const concurrentResults = await Promise.allSettled([
    service.completeActivation({
      activationId: reactivatedPending.activation.activationId,
      expectedActivationRevision: reactivatedPending.activation.activationRevision,
      idempotencyKey: "complete-reactivation",
      workstationReceipt: receipt,
    }, "admin-1"),
    service.completeActivation({
      activationId: reactivatedPending.activation.activationId,
      expectedActivationRevision: reactivatedPending.activation.activationRevision,
      idempotencyKey: "conflicting-concurrent-completion",
      workstationReceipt: receipt,
    }, "admin-2"),
  ]);
  assert.equal(concurrentResults.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(state.activePointers.size, 1, "the rig can have only one hosted ACTIVE pointer");
  assert.equal(state.pendingPointers.size, 0);

  first.trustStatus = "REVOKED";
  first.revokedAt = new Date(NOW);
  const revocationAudit = await service.recordSnapshotRevoked(first.id, "admin-1", "calibration evidence revoked");
  assert.equal(revocationAudit.revokedActivationEventsRecorded, 2);
  assert.equal(state.activePointers.size, 0);
  await errorCode(
    service.readStartAuthority(TENANT_ID, RIG_ID),
    "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
  );
  assert.equal(state.activations[0].calibrationSnapshotId, first.id, "historical activation remains bound to its immutable snapshot");
});

test("operating-context mismatch and stale optimistic revision cannot create activation authority", async () => {
  const selected = snapshot("snapshot-1", "v1");
  const { db, state } = createMemoryDb([selected]);
  const service = createAiGraderCalibrationActivationService(db, {
    now: () => new Date(NOW),
    randomId: () => "activation-1",
    acquireRigLock: async () => undefined,
    verifySnapshotStorage: async () => undefined,
  });
  const registry = await service.list(RIG_ID, true);
  selected.mathematicalOperatingContextHash = "f".repeat(64);
  await errorCode(
    service.requestActivation(
      activationRequest(selected.id, registry.registryRevision, "context-mismatch"),
      "admin-1",
    ),
    "AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY",
  );
  assert.equal(state.activations.length, 0);
  selected.mathematicalOperatingContextHash = sha(canonicalAiGraderOperatingContextV1(selected.mathematicalOperatingContextV1));
  await errorCode(
    service.requestActivation(
      activationRequest(selected.id, "0".repeat(64), "stale-revision"),
      "admin-1",
    ),
    "AI_GRADER_CALIBRATION_ACTIVATION_REVISION_CONFLICT",
  );
  assert.equal(state.activations.length, 0);
});

test("migration source enforces append-only evidence, immutable historical bindings, and no automatic rollback", () => {
  const migration = readFileSync(join(
    __dirname,
    "..",
    "prisma",
    "migrations",
    "20260721183000_ai_grader_calibration_activation_registry",
    "migration.sql",
  ), "utf8");
  const validator = readFileSync(join(
    __dirname,
    "..",
    "scripts",
    "validateAiGraderCalibrationActivationRegistry.sql",
  ), "utf8");

  for (const requiredGuard of [
    "MathematicalCalibrationActivation_reject_update",
    "MathematicalCalibrationActivation_reject_delete",
    "MathematicalCalibrationActivationEvent_reject_update",
    "MathematicalCalibrationActivationEvent_reject_delete",
    "CalibrationSnapshot_guard_activation_context_update",
    "AiGraderSession_guard_calibration_activation_binding",
    "AiGraderReport_guard_calibration_activation_binding",
    "AiGraderReport_validate_calibration_activation_binding",
    "validate_mathematical_calibration_active_pointer",
    "validate_mathematical_calibration_pending_pointer",
  ]) {
    assert.match(migration, new RegExp(requiredGuard));
  }
  assert.match(migration, /PRIMARY KEY \("rigId"\)/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /\b(?:DROP TABLE|TRUNCATE)\b/i);

  assert.match(validator, /Expected activation update rejection/);
  assert.match(validator, /Expected activation delete rejection/);
  assert.match(validator, /Expected activation event update rejection/);
  assert.match(validator, /Expected activation event delete rejection/);
  assert.match(validator, /Expected report activation binding update rejection/);
  assert.ok(validator.includes("Historical report lost its original snapshot/activation binding"));
  assert.match(validator, /Failed activation restored a prior active pointer/);
});
