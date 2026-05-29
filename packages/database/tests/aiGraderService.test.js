const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AiGraderServiceValidationError,
  createAiGraderService,
  createGradeRunDraft,
  finalizeGradeRun,
  linkEvidenceArtifact,
  createCaptureSessionDraft,
  markCaptureSessionAborted,
  markCaptureSessionComplete,
  markCaptureSessionMicroIncompleteRequiresReview,
  markCaptureSessionPausedForOperatorTimeout,
  markCaptureSessionPhysicalGateReview,
  persistMacroSuspectRegions,
  persistOrchestratorTransition,
  readCaptureSessionState,
  recordAuditEvent,
  recordCaptureManifest,
  recordEvidenceArtifact,
  recordMacroPipelineCompletion,
  persistMicroSpotPackage,
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

function baseGradeRun(overrides = {}) {
  return {
    id: "grade-run-1",
    captureSessionId: "session-1",
    captureManifestId: "manifest-1",
    algorithmVersionId: "algorithm-1",
    thresholdSetVersionId: "threshold-1",
    runtimeEnvironmentId: "runtime-1",
    status: "RUNNING",
    mode: "STANDARD",
    inputChecksum: SHA_256,
    outputChecksum: null,
    macroMeasurements: { surface: 8 },
    microMeasurements: { inspectedSpotCount: 1 },
    fusionActions: [],
    finalGrades: null,
    confidence: null,
    warnings: null,
    errorCode: null,
    startedAt: new Date(ISO_TIME),
    finishedAt: null,
    ...overrides,
  };
}

function createMockDb(options = {}) {
  const calls = [];
  let session = options.session ?? baseSession();
  let gradeRun = options.gradeRun ?? baseGradeRun();
  let authRun = options.authRun ?? { id: "auth-run-1", tenantId: "tenant-1", captureSessionId: "session-1" };
  let certificate = options.certificate ?? {
    id: "certificate-1",
    tenantId: "tenant-1",
    gradeRunId: "grade-run-1",
    authRunId: null,
  };

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
    gradeRun: {
      async create(args) {
        calls.push({ delegate: "gradeRun", method: "create", args });
        gradeRun = {
          id: args.data.id ?? "grade-run-1",
          outputChecksum: null,
          finalGrades: null,
          confidence: null,
          warnings: null,
          errorCode: null,
          finishedAt: null,
          ...args.data,
          startedAt: args.data.startedAt ?? new Date(ISO_TIME),
        };
        return { id: gradeRun.id, status: gradeRun.status };
      },
      async findFirst(args) {
        calls.push({ delegate: "gradeRun", method: "findFirst", args });
        if (
          !gradeRun ||
          gradeRun.id !== args.where.id ||
          args.where.captureSession.tenantId !== "tenant-1"
        ) {
          return null;
        }
        return { ...gradeRun };
      },
      async updateMany(args) {
        calls.push({ delegate: "gradeRun", method: "updateMany", args });
        if (
          !gradeRun ||
          gradeRun.id !== args.where.id ||
          args.where.captureSession.tenantId !== "tenant-1"
        ) {
          return { count: 0 };
        }
        gradeRun = {
          ...gradeRun,
          ...args.data,
        };
        return { count: 1 };
      },
    },
    authRun: {
      async findFirst(args) {
        calls.push({ delegate: "authRun", method: "findFirst", args });
        if (!authRun || authRun.id !== args.where.id || authRun.tenantId !== args.where.tenantId) {
          return null;
        }
        return { ...authRun };
      },
    },
    gradeCertificate: {
      async findFirst(args) {
        calls.push({ delegate: "gradeCertificate", method: "findFirst", args });
        if (!certificate || certificate.id !== args.where.id || certificate.tenantId !== args.where.tenantId) {
          return null;
        }
        return { ...certificate };
      },
    },
    gradingSuspectRegion: {
      async createMany(args) {
        calls.push({ delegate: "gradingSuspectRegion", method: "createMany", args });
        return { count: args.data.length };
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
    getGradeRun: () => gradeRun,
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

function macroSuspect(overrides = {}) {
  const rank = overrides.rank ?? 1;
  return {
    id: `macro-suspect:session-1:FRONT:SURFACE:${rank}:threshold-1`,
    sessionId: "session-1",
    side: "FRONT",
    element: "SURFACE",
    rank,
    score: 0.88,
    threshold: 0.72,
    reasonCodes: ["SURFACE_ANOMALY"],
    cardMm: { x: 10, y: 12, w: 4, h: 5 },
    warpedPx: { x: 100, y: 120, w: 40, h: 50 },
    sourcePx: { x: 98, y: 118, w: 44, h: 54 },
    heatmapStorageKey: "macro/session-1/front/surface-1.png",
    macroCaptureIds: ["frame-1"],
    thresholdSetId: "threshold-1",
    ...overrides,
  };
}

function macroPipelineOutput(overrides = {}) {
  return {
    sessionId: "session-1",
    side: "FRONT",
    captureManifestId: "manifest-1",
    algorithmVersionId: "macro-algorithm-1",
    thresholdSetVersionId: "threshold-version-1",
    centeringMeasurement: { horizontalPercent: 50, verticalPercent: 51 },
    provisionalGrades: {
      centering: 9,
      corners: 9,
      edges: 8.5,
      surface: 8,
    },
    macroMeasurements: { surfaceAnomalyCount: 1 },
    suspectRegions: [macroSuspect()],
    physicalGateResults: [{ gate: "EXCESSIVE_DUST", status: "PASS" }],
    evidenceArtifacts: [
      {
        id: "evidence-1",
        evidenceClass: "ORIGINAL",
        kind: "MACRO_RAW_FRAME",
        storageKey: "original/session-1/front-diffuse.tiff",
        checksumSha256: SHA_256,
      },
    ],
    ...overrides,
  };
}

function evidenceRef(frameKey, overrides = {}) {
  return {
    id: `micro-frame-${frameKey}`,
    storageKey: `micro/session-1/${frameKey}.tiff`,
    checksumSha256: SHA_256,
    mimeType: "image/tiff",
    byteSize: 4096,
    widthPx: 2048,
    heightPx: 2048,
    ...overrides,
  };
}

function microSpotFrames(overrides = {}) {
  return {
    edrBase: evidenceRef("edrBase"),
    polarizedAllOn: evidenceRef("polarizedAllOn"),
    flcLed0: evidenceRef("flcLed0"),
    flcLed1: evidenceRef("flcLed1"),
    flcLed2: evidenceRef("flcLed2"),
    flcLed3: evidenceRef("flcLed3"),
    flcLed4: evidenceRef("flcLed4"),
    flcLed5: evidenceRef("flcLed5"),
    flcLed6: evidenceRef("flcLed6"),
    flcLed7: evidenceRef("flcLed7"),
    ...overrides,
  };
}

function microSpotPackage(overrides = {}) {
  const element = overrides.element ?? "SURFACE";
  const side = overrides.side ?? "FRONT";
  const spotIndex = overrides.spotIndex ?? 1;
  const sourceSuspectRegionId =
    Object.prototype.hasOwnProperty.call(overrides, "sourceSuspectRegionId")
      ? overrides.sourceSuspectRegionId
      : element === "SURFACE"
        ? "macro-suspect:session-1:FRONT:SURFACE:1:threshold-1"
        : undefined;
  const base = {
    id: `micro-spot:session-1:${side}:${element}:${spotIndex}:${sourceSuspectRegionId ?? "standard"}`,
    sessionId: "session-1",
    captureManifestId: "manifest-1",
    side,
    element,
    spotIndex,
    totalSpots: element === "SURFACE" ? 1 : 4,
    stageXMicrons: 1000,
    stageYMicrons: 2000,
    microMagnification: 220,
    amrReading: 0.12,
    focusScore: 0.91,
    frames: microSpotFrames(),
    capturedAt: ISO_TIME,
    validForClassification: true,
  };
  if (sourceSuspectRegionId !== undefined) {
    base.sourceSuspectRegionId = sourceSuspectRegionId;
  }
  return {
    ...base,
    ...overrides,
  };
}

function fusionAction(overrides = {}) {
  return {
    action: "LOWER",
    element: "SURFACE",
    side: "FRONT",
    regionId: "macro-suspect:session-1:FRONT:SURFACE:1:threshold-1",
    spotPackageId: microSpotPackage().id,
    macroMeasurement: { provisionalGrade: 9 },
    microMeasurement: { finding: "REAL_DEFECT" },
    gradeBefore: 9,
    gradeAfter: 8,
    algorithmVersionId: "algorithm-1",
    thresholdSetVersionId: "threshold-1",
    reasonCodes: ["MICRO_CONFIRMED_DEFECT"],
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

test("persistMacroSuspectRegions validates scoped regions and persists GradingSuspectRegion records", async () => {
  const { db, calls } = createMockDb();

  const result = await persistMacroSuspectRegions(db, {
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    side: "FRONT",
    regions: [
      macroSuspect({ rank: 1, score: 0.91 }),
      macroSuspect({
        id: "macro-suspect:session-1:FRONT:SURFACE:2:threshold-1",
        rank: 2,
        score: 0.83,
        sourcePx: undefined,
        heatmapStorageKey: undefined,
      }),
    ],
  });

  assert.equal(result.count, 2);
  assert.equal(result.side, "FRONT");
  assert.equal(result.session.id, "session-1");
  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "captureSession.findFirst", "gradingSuspectRegion.createMany"]
  );
  assert.deepEqual(calls[1].args.where, {
    id: "session-1",
    tenantId: "tenant-1",
  });
  assert.equal(calls[2].args.data.length, 2);
  assert.equal(calls[2].args.data[0].sessionId, "session-1");
  assert.equal(calls[2].args.data[0].side, "FRONT");
  assert.equal(calls[2].args.data[0].element, "SURFACE");
  assert.equal(calls[2].args.data[0].rank, 1);
  assert.deepEqual(calls[2].args.data[0].reasonCodes, ["SURFACE_ANOMALY"]);
  assert.deepEqual(calls[2].args.data[0].cardMm, { x: 10, y: 12, w: 4, h: 5 });
  assert.deepEqual(calls[2].args.data[0].macroCaptureIds, ["frame-1"]);
  assert.equal(calls[2].args.data[0].thresholdSetId, "threshold-1");
});

test("persistMacroSuspectRegions rejects invalid suspect regions before DB writes", async () => {
  const { db, calls } = createMockDb();

  await expectValidationRejects(
    () =>
      persistMacroSuspectRegions(db, {
        tenantId: "tenant-1",
        captureSessionId: "session-1",
        side: "FRONT",
        regions: [
          macroSuspect({
            score: 1.2,
            element: "CORNERS",
            cardMm: { x: 0, y: 0, w: 0, h: 1 },
          }),
        ],
      }),
    "INVALID_SCORE"
  );

  assert.equal(calls.length, 0);
});

test("persistMacroSuspectRegions enforces tenant and session scoping", async () => {
  const { db, calls } = createMockDb();

  await expectValidationRejects(
    () =>
      persistMacroSuspectRegions(db, {
        tenantId: "tenant-2",
        captureSessionId: "session-1",
        side: "FRONT",
        regions: [macroSuspect()],
      }),
    "INVALID_RECORD"
  );

  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "captureSession.findFirst"]
  );
  assert.deepEqual(calls[1].args.where, {
    id: "session-1",
    tenantId: "tenant-2",
  });
});

test("persistMacroSuspectRegions rejects duplicate ranks before DB writes", async () => {
  const { db, calls } = createMockDb();

  await expectValidationRejects(
    () =>
      persistMacroSuspectRegions(db, {
        tenantId: "tenant-1",
        captureSessionId: "session-1",
        side: "FRONT",
        regions: [
          macroSuspect({ id: "suspect-1", rank: 1 }),
          macroSuspect({ id: "suspect-2", rank: 1 }),
        ],
      }),
    "INVALID_RANK"
  );

  assert.equal(calls.length, 0);
});

test("recordMacroPipelineCompletion writes audit event without direct session update", async () => {
  const { db, calls } = createMockDb({ session: baseSession({ currentState: "MACRO_PIPELINE", status: "RUNNING" }) });

  const result = await recordMacroPipelineCompletion(db, {
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    output: macroPipelineOutput(),
    actorOperatorId: "operator-1",
    actorUserId: "user-1",
    occurredAt: ISO_TIME,
  });

  assert.deepEqual(result.auditEvent, {
    id: "audit-1",
    action: "ai_grader.macro_pipeline.completed",
  });
  assert.equal(result.orchestratorTransition, undefined);
  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "captureSession.findFirst", "auditEvent.create"]
  );
  assert.equal(calls[2].args.data.action, "ai_grader.macro_pipeline.completed");
  assert.equal(calls[2].args.data.outcome, "SUCCESS");
  assert.equal(calls[2].args.data.entityId, "session-1");
  assert.equal(calls[2].args.data.after.side, "FRONT");
  assert.equal(calls[2].args.data.after.captureManifestId, "manifest-1");
  assert.equal(calls[2].args.data.after.suspectRegionCount, 1);
  assert.equal(calls[2].args.data.after.advanceOrchestrator, false);
  assert.match(calls[2].args.data.checksum, /^[a-f0-9]{64}$/);
});

test("persistMicroSpotPackage persists package metadata and required frame evidence", async () => {
  const { db, calls } = createMockDb({ session: baseSession({ currentState: "MICRO_SPOTS", status: "RUNNING" }) });
  const pkg = microSpotPackage();

  const result = await persistMicroSpotPackage(db, {
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    microSpotPackage: pkg,
  });

  assert.equal(result.session.id, "session-1");
  assert.equal(result.microSpotPackage.id, pkg.id);
  assert.equal(result.evidenceArtifacts.length, 11);
  assert.deepEqual(
    calls.slice(0, 3).map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "captureSession.findFirst", "evidenceArtifact.create"]
  );
  assert.equal(calls.length, 13);
  assert.equal(calls[2].args.data.kind, "MICRO_SPOT_PACKAGE_METADATA");
  assert.equal(calls[2].args.data.captureSessionId, "session-1");
  assert.equal(calls[2].args.data.evidenceClass, "DERIVED");
  assert.match(calls[2].args.data.checksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(calls[2].args.data.metadata.microSpotPackage.id, pkg.id);
  const frameWrite = calls.find((call) => call.args?.data?.metadata?.frameKey === "flcLed7");
  assert.equal(frameWrite.delegate, "evidenceArtifact");
  assert.equal(frameWrite.args.data.kind, "MICRO_SPOT_FRAME");
  assert.equal(frameWrite.args.data.storageKey, "micro/session-1/flcLed7.tiff");
  assert.equal(frameWrite.args.data.metadata.captureManifestId, "manifest-1");
});

test("persistMicroSpotPackage rejects missing FLC frames before DB writes", async () => {
  const { db, calls } = createMockDb();
  const frames = microSpotFrames();
  delete frames.flcLed7;

  await expectValidationRejects(
    () =>
      persistMicroSpotPackage(db, {
        tenantId: "tenant-1",
        captureSessionId: "session-1",
        microSpotPackage: microSpotPackage({ frames }),
      }),
    "MISSING_FRAME"
  );

  assert.equal(calls.length, 0);
});

test("createGradeRunDraft creates expected pending/running GradeRun data", async () => {
  const { db, calls } = createMockDb({ session: baseSession({ currentState: "FUSION", status: "RUNNING" }) });

  const result = await createGradeRunDraft(db, {
    id: "grade-run-2",
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    captureManifestId: "manifest-1",
    algorithmVersionId: "algorithm-1",
    thresholdSetVersionId: "threshold-1",
    runtimeEnvironmentId: "runtime-1",
    inputChecksum: SHA_256,
    macroMeasurements: { surface: 8 },
    microMeasurements: { inspectedSpotCount: 1 },
    startedAt: ISO_TIME,
  });

  assert.deepEqual(result.gradeRun, { id: "grade-run-2", status: "RUNNING" });
  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "captureSession.findFirst", "gradeRun.create"]
  );
  assert.deepEqual(calls[1].args.where, {
    id: "session-1",
    tenantId: "tenant-1",
  });
  assert.equal(calls[2].args.data.captureSessionId, "session-1");
  assert.equal(calls[2].args.data.captureManifestId, "manifest-1");
  assert.equal(calls[2].args.data.status, "RUNNING");
  assert.equal(calls[2].args.data.mode, "STANDARD");
  assert.equal(calls[2].args.data.inputChecksum, SHA_256);
  assert.deepEqual(calls[2].args.data.fusionActions, []);
});

test("finalizeGradeRun writes COMPLETE payload with fusion actions", async () => {
  const { db, calls, getGradeRun } = createMockDb({
    gradeRun: baseGradeRun({ id: "grade-run-1", status: "RUNNING", mode: "STANDARD" }),
  });
  const outputChecksum = "b".repeat(64);

  const result = await finalizeGradeRun(db, {
    tenantId: "tenant-1",
    gradeRunId: "grade-run-1",
    outputChecksum,
    finalGrades: { corners: 8, edges: 9, surface: 8 },
    fusionActions: [fusionAction()],
    confidence: { overall: 0.93 },
    warnings: ["MICRO_CONFIRMED_DEFECT"],
    finishedAt: ISO_TIME,
  });

  assert.equal(result.updatedCount, 1);
  assert.equal(getGradeRun().status, "COMPLETE");
  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "gradeRun.findFirst", "gradeRun.updateMany"]
  );
  assert.deepEqual(calls[1].args.where, {
    id: "grade-run-1",
    captureSession: { tenantId: "tenant-1" },
  });
  assert.equal(calls[2].args.data.status, "COMPLETE");
  assert.equal(calls[2].args.data.outputChecksum, outputChecksum);
  assert.deepEqual(calls[2].args.data.finalGrades, { corners: 8, edges: 9, surface: 8 });
  assert.equal(calls[2].args.data.fusionActions.length, 1);
  assert.deepEqual(calls[2].args.data.confidence, { overall: 0.93 });
  assert.deepEqual(calls[2].args.data.warnings, ["MICRO_CONFIRMED_DEFECT"]);
  assert.ok(calls[2].args.data.finishedAt instanceof Date);
});

test("finalizeGradeRun rejects STANDARD completion without fusion actions before update writes", async () => {
  const { db, calls } = createMockDb({
    gradeRun: baseGradeRun({ id: "grade-run-1", status: "RUNNING", mode: "STANDARD" }),
  });

  await expectValidationRejects(
    () =>
      finalizeGradeRun(db, {
        tenantId: "tenant-1",
        gradeRunId: "grade-run-1",
        outputChecksum: "b".repeat(64),
        finalGrades: { surface: 8 },
        fusionActions: [],
      }),
    "EMPTY_ARRAY"
  );

  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "gradeRun.findFirst"]
  );
});

test("linkEvidenceArtifact attaches evidence only after scoped source validation", async () => {
  const { db, calls } = createMockDb();

  const result = await linkEvidenceArtifact(
    db,
    evidenceArtifact({
      id: "grade-evidence-1",
      captureSessionId: undefined,
      gradeRunId: "grade-run-1",
      kind: "GRADE_RUN_INPUT_BUNDLE",
      evidenceClass: "DERIVED",
      metadata: { gradeRunInput: true },
    })
  );

  assert.deepEqual(result.artifact, {
    id: "grade-evidence-1",
    storageKey: "original/session-1/front-diffuse.tiff",
  });
  assert.equal(result.scopes.gradeRun.id, "grade-run-1");
  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "gradeRun.findFirst", "evidenceArtifact.create"]
  );
  assert.deepEqual(calls[1].args.where, {
    id: "grade-run-1",
    captureSession: { tenantId: "tenant-1" },
  });
  assert.equal(calls[2].args.data.gradeRunId, "grade-run-1");
  assert.equal(calls[2].args.data.captureSessionId, null);
});

test("linkEvidenceArtifact rejects artifacts with no source linkage before DB calls", async () => {
  const { db, calls } = createMockDb();

  await expectValidationRejects(
    () =>
      linkEvidenceArtifact(
        db,
        evidenceArtifact({
          captureSessionId: undefined,
          gradeRunId: undefined,
          authRunId: undefined,
          certificateId: undefined,
          evidenceClass: "DERIVED",
        })
      ),
    "INVALID_EVIDENCE_ARTIFACT"
  );

  assert.equal(calls.length, 0);
});

test("linkEvidenceArtifact enforces tenant/source scope before writes", async () => {
  const { db, calls } = createMockDb();

  await expectValidationRejects(
    () =>
      linkEvidenceArtifact(
        db,
        evidenceArtifact({
          tenantId: "tenant-2",
          captureSessionId: undefined,
          gradeRunId: "grade-run-1",
          evidenceClass: "DERIVED",
        })
      ),
    "INVALID_RECORD"
  );

  assert.deepEqual(
    calls.map((call) => `${call.delegate}.${call.method}`),
    ["$transaction.$transaction", "gradeRun.findFirst"]
  );
});

test("macro persistence helpers are exposed through the injected service factory", async () => {
  const { db, calls } = createMockDb();
  const service = createAiGraderService(db);

  await service.persistMacroSuspectRegions({
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    side: "FRONT",
    regions: [macroSuspect()],
  });

  assert.ok(calls.some((call) => call.delegate === "gradingSuspectRegion" && call.method === "createMany"));
});

test("grade run helpers are exposed through the injected service factory without a singleton client", async () => {
  const { db, calls } = createMockDb();
  const service = createAiGraderService(db);

  await service.createGradeRunDraft({
    tenantId: "tenant-1",
    captureSessionId: "session-1",
    captureManifestId: "manifest-1",
    algorithmVersionId: "algorithm-1",
    thresholdSetVersionId: "threshold-1",
    runtimeEnvironmentId: "runtime-1",
    inputChecksum: SHA_256,
    macroMeasurements: { surface: 8 },
  });

  assert.ok(calls.some((call) => call.delegate === "gradeRun" && call.method === "create"));
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
