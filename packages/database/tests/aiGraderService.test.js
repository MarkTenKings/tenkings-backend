const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AiGraderServiceValidationError,
  createAiGraderService,
  createCaptureSessionDraft,
  markCaptureSessionAborted,
  markCaptureSessionComplete,
  markCaptureSessionMicroIncompleteRequiresReview,
  markCaptureSessionPausedForOperatorTimeout,
  markCaptureSessionPhysicalGateReview,
  persistOrchestratorTransition,
  readCaptureSessionState,
  recordAuditEvent,
  recordCaptureManifest,
  recordEvidenceArtifact,
} = require("../dist/database/src/aiGraderService");

const SHA_256 = "a".repeat(64);
const ISO_TIME = "2026-05-28T12:00:00.000Z";

function baseSession(overrides = {}) {
  return {
    id: "session-1",
    tenantId: "tenant-1",
    rigId: "rig-1",
    locationId: "location-1",
    operatorId: "operator-1",
    helperInstanceId: "helper-1",
    gradingMode: "STANDARD",
    status: "CREATED",
    currentState: "INIT",
    errorCode: null,
    rawCardOnly: true,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(ISO_TIME),
    updatedAt: new Date(ISO_TIME),
    ...overrides,
  };
}

function createMockDb(options = {}) {
  const calls = [];
  let session = options.session ?? baseSession();

  const tx = {
    captureSession: {
      async create(args) {
        calls.push({ delegate: "captureSession", method: "create", args });
        return {
          id: args.data.id ?? "session-1",
          ...args.data,
          createdAt: new Date(ISO_TIME),
          updatedAt: new Date(ISO_TIME),
        };
      },
      async findFirst(args) {
        calls.push({ delegate: "captureSession", method: "findFirst", args });
        if (!session || session.id !== args.where.id || session.tenantId !== args.where.tenantId) {
          return null;
        }
        return { ...session };
      },
      async updateMany(args) {
        calls.push({ delegate: "captureSession", method: "updateMany", args });
        if (!session || session.id !== args.where.id || session.tenantId !== args.where.tenantId) {
          return { count: 0 };
        }
        session = {
          ...session,
          ...args.data,
          updatedAt: new Date(ISO_TIME),
        };
        return { count: 1 };
      },
    },
    captureManifest: {
      async create(args) {
        calls.push({ delegate: "captureManifest", method: "create", args });
        return { id: args.data.id, checksum: args.data.checksum };
      },
    },
    evidenceArtifact: {
      async create(args) {
        calls.push({ delegate: "evidenceArtifact", method: "create", args });
        return { id: args.data.id, storageKey: args.data.storageKey };
      },
    },
    auditEvent: {
      async create(args) {
        calls.push({ delegate: "auditEvent", method: "create", args });
        return { id: args.data.id ?? "audit-1", action: args.data.action };
      },
    },
  };

  const db = options.withoutTransaction
    ? tx
    : {
        ...tx,
        async $transaction(callback) {
          calls.push({ delegate: "$transaction", method: "$transaction" });
          return callback(tx);
        },
      };

  return {
    db,
    calls,
    getSession: () => session,
  };
}

function frame(overrides = {}) {
  return {
    frameId: "frame-1",
    kind: "FRONT_DIFFUSE",
    side: "FRONT",
    storageKey: "captures/session-1/front-diffuse.tiff",
    checksumSha256: SHA_256,
    capturedAt: ISO_TIME,
    widthPx: 4096,
    heightPx: 4096,
    ...overrides,
  };
}

function captureManifest(overrides = {}) {
  return {
    id: "manifest-1",
    captureSessionId: "session-1",
    tenantId: "tenant-1",
    rigId: "rig-1",
    locationId: "location-1",
    operatorId: "operator-1",
    helperInstanceId: "helper-1",
    helperVersion: "1.0.0",
    driverVersions: { macro: "1.0.0" },
    componentSerials: { macroCamera: "BASLER-123" },
    calibrationSnapshotIds: ["calibration-1"],
    frameList: [frame()],
    operatorPrompts: [{ prompt: "Confirm arm out", shownAt: ISO_TIME, confirmedAt: ISO_TIME }],
    deviceHealth: [{ check: "camera-open", status: "PASS" }],
    checksumSha256: SHA_256,
    createdAt: ISO_TIME,
    ...overrides,
  };
}

function evidenceArtifact(overrides = {}) {
  return {
    id: "evidence-1",
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    evidenceClass: "ORIGINAL",
    kind: "MACRO_RAW_FRAME",
    storageKey: "original/session-1/front-diffuse.tiff",
    checksumSha256: SHA_256,
    mimeType: "image/tiff",
    byteSize: 2048,
    widthPx: 4096,
    heightPx: 4096,
    metadata: { side: "FRONT" },
    createdAt: ISO_TIME,
    ...overrides,
  };
}

async function expectValidationRejects(fn, expectedCode) {
  await assert.rejects(
    fn,
    (error) => {
      assert.ok(error instanceof AiGraderServiceValidationError);
      assert.ok(error.issues.some((issue) => issue.code === expectedCode));
      return true;
    }
  );
}

test("createCaptureSessionDraft creates a CREATED draft session through the injected client", async () => {
  const { db, calls } = createMockDb();

  const result = await createCaptureSessionDraft(db, {
    id: "session-1",
    tenantId: "tenant-1",
    rigId: "rig-1",
    locationId: "location-1",
    operatorId: "operator-1",
    helperInstanceId: "helper-1",
    gradingMode: "STANDARD",
    cardIdentity: { cardSet: "2026 Test", cardNumber: "1" },
  });

  assert.equal(result.id, "session-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delegate, "captureSession");
  assert.equal(calls[0].method, "create");
  assert.deepEqual(calls[0].args.data, {
    id: "session-1",
    tenantId: "tenant-1",
    rigId: "rig-1",
    locationId: "location-1",
    operatorId: "operator-1",
    helperInstanceId: "helper-1",
    gradingMode: "STANDARD",
    status: "CREATED",
    currentState: "INIT",
    rawCardOnly: true,
    cardIdentity: { cardSet: "2026 Test", cardNumber: "1" },
    physicalGateResults: undefined,
  });
});

test("recordCaptureManifest validates and maps checksumSha256 to Prisma checksum", async () => {
  const { db, calls } = createMockDb();

  const result = await recordCaptureManifest(db, captureManifest());

  assert.deepEqual(result, { id: "manifest-1", checksum: SHA_256 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delegate, "captureManifest");
  assert.equal(calls[0].args.data.checksum, SHA_256);
  assert.equal(calls[0].args.data.checksumSha256, undefined);
  assert.equal(calls[0].args.data.captureSessionId, "session-1");
  assert.deepEqual(calls[0].args.data.frameList, [frame()]);
  assert.ok(calls[0].args.data.createdAt instanceof Date);
});

test("recordCaptureManifest rejects invalid manifests before any Prisma call", async () => {
  const { db, calls } = createMockDb();

  await expectValidationRejects(
    () => recordCaptureManifest(db, captureManifest({ checksumSha256: "bad" })),
    "INVALID_CHECKSUM"
  );

  assert.equal(calls.length, 0);
});

test("recordEvidenceArtifact validates and persists evidence metadata through the injected client", async () => {
  const { db, calls } = createMockDb();

  const result = await recordEvidenceArtifact(db, evidenceArtifact());

  assert.deepEqual(result, {
    id: "evidence-1",
    storageKey: "original/session-1/front-diffuse.tiff",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delegate, "evidenceArtifact");
  assert.equal(calls[0].args.data.captureSessionId, "session-1");
  assert.equal(calls[0].args.data.evidenceClass, "ORIGINAL");
  assert.equal(calls[0].args.data.checksumSha256, SHA_256);
  assert.deepEqual(calls[0].args.data.metadata, { side: "FRONT" });
  assert.ok(calls[0].args.data.createdAt instanceof Date);
});

test("recordEvidenceArtifact rejects invalid evidence artifacts before any Prisma call", async () => {
  const { db, calls } = createMockDb();

  await expectValidationRejects(
    () =>
      recordEvidenceArtifact(
        db,
        evidenceArtifact({
          captureSessionId: undefined,
          gradeRunId: undefined,
          authRunId: undefined,
          certificateId: undefined,
          checksumSha256: "bad",
        })
      ),
    "INVALID_CHECKSUM"
  );

  assert.equal(calls.length, 0);
});

test("recordAuditEvent persists an audit event through the injected client", async () => {
  const { db, calls } = createMockDb();

  const result = await recordAuditEvent(db, {
    id: "audit-1",
    tenantId: "tenant-1",
    actorOperatorId: "operator-1",
    actorUserId: "user-1",
    entityType: "CaptureSession",
    entityId: "session-1",
    action: "capture_session.created",
    outcome: "SUCCESS",
    after: { status: "CREATED" },
    checksum: "b".repeat(64),
    createdAt: ISO_TIME,
  });

  assert.deepEqual(result, { id: "audit-1", action: "capture_session.created" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delegate, "auditEvent");
  assert.equal(calls[0].args.data.entityType, "CaptureSession");
  assert.equal(calls[0].args.data.entityId, "session-1");
  assert.equal(calls[0].args.data.outcome, "SUCCESS");
  assert.deepEqual(calls[0].args.data.after, { status: "CREATED" });
  assert.ok(calls[0].args.data.createdAt instanceof Date);
});

test("readCaptureSessionState reads state by tenant and session id", async () => {
  const { db, calls } = createMockDb();
  const service = createAiGraderService(db);

  const result = await service.readCaptureSessionState({
    tenantId: "tenant-1",
    captureSessionId: "session-1",
  });

  assert.equal(result.id, "session-1");
  assert.equal(result.status, "CREATED");
  assert.equal(result.currentState, "INIT");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delegate, "captureSession");
  assert.equal(calls[0].method, "findFirst");
  assert.deepEqual(calls[0].args.where, {
    id: "session-1",
    tenantId: "tenant-1",
  });
  assert.equal(calls[0].args.select.currentState, true);
  assert.equal(calls[0].args.select.status, true);
});

test("readCaptureSessionState exported function uses the same injected client path", async () => {
  const { db, calls } = createMockDb({ session: baseSession({ id: "session-2" }) });

  const result = await readCaptureSessionState(db, {
    tenantId: "tenant-1",
    captureSessionId: "session-2",
  });

  assert.equal(result.id, "session-2");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.where.id, "session-2");
});

test("persistOrchestratorTransition validates transition, updates session, and writes audit event", async () => {
  const { db, calls, getSession } = createMockDb();

  const result = await persistOrchestratorTransition(db, {
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    event: "SESSION_CREATED",
    guardResults: {
      sessionBelongsToTenant: true,
      rigActive: true,
      operatorAuthorized: true,
    },
    actorOperatorId: "operator-1",
    actorUserId: "user-1",
    occurredAt: ISO_TIME,
  });

  assert.equal(result.fromState, "INIT");
  assert.equal(result.toState, "MACRO_PREFLIGHT");
  assert.equal(result.status, "RUNNING");
  assert.equal(result.errorCode, null);
  assert.equal(getSession().currentState, "MACRO_PREFLIGHT");
  assert.equal(getSession().status, "RUNNING");
  assert.equal(getSession().errorCode, null);
  assert.ok(getSession().startedAt instanceof Date);

  assert.equal(calls[0].delegate, "$transaction");
  assert.equal(calls[1].delegate, "captureSession");
  assert.equal(calls[1].method, "findFirst");
  assert.deepEqual(calls[1].args.where, {
    id: "session-1",
    tenantId: "tenant-1",
  });
  assert.equal(calls[2].delegate, "captureSession");
  assert.equal(calls[2].method, "updateMany");
  assert.deepEqual(calls[2].args.where, {
    id: "session-1",
    tenantId: "tenant-1",
  });
  assert.equal(calls[2].args.data.currentState, "MACRO_PREFLIGHT");
  assert.equal(calls[2].args.data.status, "RUNNING");
  assert.equal(calls[3].delegate, "auditEvent");
  assert.equal(calls[3].method, "create");
  assert.equal(calls[3].args.data.action, "ai_grader.orchestrator.transition");
  assert.equal(calls[3].args.data.outcome, "SUCCESS");
  assert.equal(calls[3].args.data.entityId, "session-1");
  assert.equal(calls[3].args.data.after.currentState, "MACRO_PREFLIGHT");
  assert.match(calls[3].args.data.checksum, /^[a-f0-9]{64}$/);
});

test("persistOrchestratorTransition rejects invalid transitions before DB writes", async () => {
  const { db, calls } = createMockDb();

  await expectValidationRejects(
    () =>
      persistOrchestratorTransition(db, {
        tenantId: "tenant-1",
        captureSessionId: "session-1",
        event: "PREFLIGHT_PASS",
        guardResults: {
          armPosition: "ARM_OUT",
          noObstruction: true,
          cardStable: true,
        },
        occurredAt: ISO_TIME,
      }),
    "INVALID_TRANSFORM"
  );

  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "captureSession.findFirst"]
  );
});

test("persistOrchestratorTransition enforces tenant and session scoping", async () => {
  const { db, calls } = createMockDb();

  await expectValidationRejects(
    () =>
      persistOrchestratorTransition(db, {
        tenantId: "tenant-2",
        captureSessionId: "session-1",
        event: "SESSION_CREATED",
        guardResults: {
          sessionBelongsToTenant: true,
          rigActive: true,
          operatorAuthorized: true,
        },
        occurredAt: ISO_TIME,
      }),
    "INVALID_RECORD"
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1].delegate, "captureSession");
  assert.equal(calls[1].method, "findFirst");
  assert.deepEqual(calls[1].args.where, {
    id: "session-1",
    tenantId: "tenant-2",
  });
});

test("named error state helpers persist expected statuses and error codes", async () => {
  const paused = createMockDb({ session: baseSession({ currentState: "ARM_IN_PROMPT", status: "RUNNING" }) });
  await markCaptureSessionPausedForOperatorTimeout(paused.db, {
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    occurredAt: ISO_TIME,
  });
  assert.equal(paused.getSession().currentState, "PAUSED_OPERATOR_TIMEOUT");
  assert.equal(paused.getSession().status, "PAUSED");
  assert.equal(paused.getSession().errorCode, "PAUSED_OPERATOR_TIMEOUT");

  const micro = createMockDb({ session: baseSession({ currentState: "MICRO_SPOTS", status: "RUNNING" }) });
  await markCaptureSessionMicroIncompleteRequiresReview(micro.db, {
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    occurredAt: ISO_TIME,
  });
  assert.equal(micro.getSession().currentState, "MICRO_INCOMPLETE_REQUIRES_REVIEW");
  assert.equal(micro.getSession().status, "MICRO_INCOMPLETE_REQUIRES_REVIEW");
  assert.equal(micro.getSession().errorCode, "MICRO_INCOMPLETE_REQUIRES_REVIEW");

  const physicalGate = createMockDb({ session: baseSession({ currentState: "MACRO_PREFLIGHT", status: "RUNNING" }) });
  await markCaptureSessionPhysicalGateReview(physicalGate.db, {
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    occurredAt: ISO_TIME,
  });
  assert.equal(physicalGate.getSession().currentState, "PHYSICAL_GATE_REVIEW");
  assert.equal(physicalGate.getSession().status, "PHYSICAL_GATE_REVIEW");
  assert.equal(physicalGate.getSession().errorCode, "PHYSICAL_GATE_REVIEW");

  const aborted = createMockDb({ session: baseSession({ currentState: "REVIEW", status: "REVIEW" }) });
  await markCaptureSessionAborted(aborted.db, {
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    reasonCode: "OPERATOR_REJECTED",
    occurredAt: ISO_TIME,
  });
  assert.equal(aborted.getSession().currentState, "ABORTED");
  assert.equal(aborted.getSession().status, "ABORTED");
  assert.equal(aborted.getSession().errorCode, "OPERATOR_REJECTED");
  assert.ok(aborted.getSession().finishedAt instanceof Date);
});

test("markCaptureSessionComplete accepts review state and blocks invalid states", async () => {
  const review = createMockDb({ session: baseSession({ currentState: "REVIEW", status: "REVIEW" }) });

  await markCaptureSessionComplete(review.db, {
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    occurredAt: ISO_TIME,
  });

  assert.equal(review.getSession().currentState, "COMPLETE");
  assert.equal(review.getSession().status, "COMPLETE");
  assert.equal(review.getSession().errorCode, null);
  assert.ok(review.getSession().finishedAt instanceof Date);

  const fusion = createMockDb({ session: baseSession({ currentState: "FUSION", status: "RUNNING" }) });
  await expectValidationRejects(
    () =>
      markCaptureSessionComplete(fusion.db, {
        tenantId: "tenant-1",
        captureSessionId: "session-1",
        occurredAt: ISO_TIME,
      }),
    "INVALID_TRANSFORM"
  );
  assert.deepEqual(
    fusion.calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "captureSession.findFirst"]
  );
});
