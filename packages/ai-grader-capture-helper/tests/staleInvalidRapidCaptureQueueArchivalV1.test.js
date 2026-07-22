const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722,
  archiveStaleInvalidRapidCaptureQueueItemsForTestV1,
  archivedRapidCaptureQueueTriplesForTestV1,
  evaluateRapidCaptureQueueMaintenanceGateV1,
} = require("../dist/drivers/staleInvalidRapidCaptureQueueArchivalV1");
const { assertNoUnqueuedRapidSessionManifest } = require("../dist/drivers/aiGraderLocalStationBridge");

const NOW = "2026-07-22T18:00:00.000Z";
const roles = ["dark_control", "all_on", "accepted_profile", ...Array.from({ length: 8 }, (_, index) => `channel_${index + 1}`)];

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeIdleStatus(root) {
  const statusPath = path.join(root, "authenticated-idle-status.json");
  const status = {
    ok: true,
    localOnly: true,
    updatedAt: "2026-07-22T17:59:30.000Z",
    currentStep: "start_new_card",
    previewStatus: {
      status: "stopped",
      cameraOwnership: "released",
      intentionalTransition: { active: false },
    },
    warmRunnerStatus: {
      status: "idle",
      captureLock: { held: false },
      queues: { capture: [], processing: [], report: [] },
    },
    liveLighting: {
      status: "safe_off",
      physicalState: { state: "safe_off_verified", complete: true },
    },
  };
  writeJson(statusPath, status);
  return { statusPath, statusSha256: hash(fs.readFileSync(statusPath)) };
}

const safeOffFrameExpectations = [
  {
    name: "lightingOutput",
    commandNumber: "86",
    description: "Lighting output ON/OFF; channel enable or safe off",
    request: "W8601010000020000030000040000050000060000070000080000",
    response: "W86ACK0",
    meaning: "Lighting output OFF",
  },
  {
    name: "asynchronousOutput",
    commandNumber: "85",
    description: "Asynchronous output ON/OFF; OFF for trigger-only profile",
    request: "W8501010000020000030000040000050000060000070000080000",
    response: "W85ACK0",
    meaning: "Asynchronous output OFF",
  },
  {
    name: "lightingOutputValue",
    commandNumber: "11",
    description: "Lighting output value; PWM duty cycle in 1000 steps",
    request: "W1101010000020000030000040000050000060000070000080000",
    response: "W11ACK0",
    meaning: "PWM duty 0 steps for safe-off",
  },
];

function safeOffReceipt(incident, startMs = Date.parse("2026-07-22T17:59:40.000Z")) {
  const durations = [100, 600, 600];
  const interWriteGaps = [0, 2, 3];
  let cursor = startMs;
  const frames = safeOffFrameExpectations.map((expected) => ({
    name: expected.name,
    commandNumber: expected.commandNumber,
    description: expected.description,
    targetDesignation: "01",
    channelValues: Array.from({ length: 8 }, (_, index) => ({ channel: index + 1, value: "0000", meaning: expected.meaning })),
    requestAscii: expected.request,
    requestFrame: expected.request,
    terminator: "",
    allowlisted: true,
  }));
  const writes = safeOffFrameExpectations.map((expected, index) => {
    cursor += interWriteGaps[index];
    const startedAt = new Date(cursor).toISOString();
    cursor += durations[index];
    return {
      ok: true,
      host: "169.254.191.156",
      port: 1000,
      timeoutMs: 1500,
      startedAt,
      finishedAt: new Date(cursor).toISOString(),
      durationMs: durations[index],
      frame: structuredClone(frames[index]),
      rawResponse: expected.response,
      responseKind: "ack",
    };
  });
  const operation = {
    ok: true,
    service: "ai-grader-capture-helper",
    command: "leimac-idmu-safe-off",
    result: {
      ok: true,
      host: "169.254.191.156",
      port: 1000,
      timeoutMs: 1500,
      startedAt: new Date(startMs).toISOString(),
      finishedAt: new Date(cursor).toISOString(),
      durationMs: cursor - startMs,
      applied: true,
      frames,
      writes,
      safety: {
        writesApplied: true,
        lightsCommanded: false,
        outputSettingsChanged: true,
        triggerSettingsChanged: false,
        persistentSaved: false,
        arbitraryWritesAllowed: false,
      },
    },
  };
  return {
    schemaVersion: "ten-kings-ai-grader-stale-invalid-review-external-safe-off-receipt-v1",
    incidentId: incident.incidentId,
    purpose: "stale_invalid_review_archive_preflight",
    authorization: { owner: incident.owner, source: incident.authorizationSource },
    operation,
  };
}

function enableExternalSafeOffEvidence(fixture, { mutateReceipt, mutateStatus, startMs } = {}) {
  const status = JSON.parse(fs.readFileSync(fixture.options.idleStatusPath, "utf8"));
  status.liveLighting = {
    status: "unavailable",
    profile: { enabled: false },
    applied: {
      dutyPercent: 0,
      actualLeimacPwmStep: 0,
      channels: [],
      verificationState: "unknown",
      expectedWriteCount: 0,
      acknowledgedWriteCount: 0,
      verificationComplete: false,
    },
    physicalState: {
      state: "unverified",
      changedAt: "2026-07-22T17:59:30.000Z",
      expectedWriteCount: 0,
      acknowledgedWriteCount: 0,
      complete: false,
    },
    connection: { state: "idle", persistentLeimacSession: false },
    safetyEvents: [],
  };
  status.previewStatus.safety = { lightingCommanded: false };
  mutateStatus?.(status);
  writeJson(fixture.options.idleStatusPath, status);
  const statusCapturedAt = new Date("2026-07-22T17:59:50.000Z");
  fs.utimesSync(fixture.options.idleStatusPath, statusCapturedAt, statusCapturedAt);
  fixture.options.idleStatusSha256 = hash(fs.readFileSync(fixture.options.idleStatusPath));

  const receiptPath = path.join(fixture.root, "external-safe-off-receipt.json");
  const receipt = safeOffReceipt(fixture.incident, startMs);
  mutateReceipt?.(receipt);
  fs.writeFileSync(receiptPath, canonicalBytes(receipt));
  fixture.options.externalSafeOffReceiptPath = receiptPath;
  fixture.options.externalSafeOffReceiptSha256 = hash(fs.readFileSync(receiptPath));
  return { receiptPath, receipt, statusCapturedAt };
}

function makeTarget(root, timestamp, overrides = {}) {
  const prefix = `ai-grader-browser-station-session-${timestamp}`;
  const sessionId = `${prefix}-session`;
  const reportId = `${prefix}-report`;
  const queueItemId = `${sessionId}-rapid-card`;
  const sessionDir = path.join(root, sessionId);
  const artifactDir = path.join(sessionDir, "evidence");
  fs.mkdirSync(artifactDir, { recursive: true });
  const sides = ["front", "back"].map((side) => ({
    side,
    packageId: `${sessionId}-${side}-package`,
    roles: roles.map((role) => {
      const filePath = path.join(artifactDir, `${side}-${role}.tiff`);
      const bytes = Buffer.from(`${queueItemId}:${side}:${role}`);
      fs.writeFileSync(filePath, bytes);
      return { role, sha256: hash(bytes), byteSize: bytes.length, mimeType: "image/tiff" };
    }),
  }));
  const images = ["front", "back"].map((side) => {
    const localPath = path.join(artifactDir, `${side}-normalized-card.png`);
    const bytes = Buffer.from(`${queueItemId}:${side}:normalized`);
    fs.writeFileSync(localPath, bytes);
    return {
      side,
      artifactRole: "normalized_card",
      fileName: `${side}-normalized-card.png`,
      mimeType: "image/png",
      checksumSha256: hash(bytes),
      byteSize: bytes.length,
      widthPx: 1200,
      heightPx: 1680,
      localPath,
    };
  });
  const reportBundlePath = path.join(sessionDir, "report-bundle.json");
  const productionReleasePath = path.join(sessionDir, "production-release.json");
  const manifestPath = path.join(sessionDir, "station-session.json");
  const bundle = {
    schemaVersion: "ai-grader-report-bundle-v0.1",
    gradingSessionId: sessionId,
    reportId,
    cardIdentity: overrides.linked ? { sideCount: 2, cardAssetId: "published-card", itemId: "published-item" } : { sideCount: 2 },
    visionLab: {
      defectFindings: [],
      findingValidation: {
        status: "invalid",
        sourceCandidateCount: 16,
        publishedFindingCount: 0,
        issues: Array.from({ length: 32 }, (_, index) => ({ path: `candidate.${index}`, message: "fingerprint mismatch" })),
      },
    },
    assets: images.map((image) => ({ id: image.side, localPath: image.localPath, sha256: image.checksumSha256, byteSize: image.byteSize })),
  };
  const release = {
    gradingSessionId: sessionId,
    reportId,
    publication: { status: overrides.uploaded ? "published" : "local_bundle_ready", uploadPerformed: overrides.uploaded === true },
    storageIntegration: { uploadPerformed: overrides.uploaded === true },
    databaseIntegration: { productionDbWritesPerformed: false },
    cardInventoryLinkage: overrides.linked
      ? { status: "contract_ready_not_persisted", cardAssetId: "published-card", itemId: "published-item" }
      : { status: "contract_ready_not_persisted" },
  };
  writeJson(reportBundlePath, bundle);
  writeJson(productionReleasePath, release);
  const manifest = {
    schemaVersion: "ai-grader-local-station-bridge-v0.10",
    sessionId,
    reportId,
    currentStep: "label_data_ready",
    outputs: { sessionDir, manifestPath, reportBundlePath, productionReleasePath },
    rapidCapture: { queueItemId, workflowState: overrides.state ?? "report_ready_needs_confirm" },
  };
  writeJson(manifestPath, manifest);
  const item = {
    queueItemId,
    sessionId,
    reportId,
    state: overrides.state ?? "report_ready_needs_confirm",
    queuedAt: NOW,
    updatedAt: NOW,
    history: [{ state: overrides.state ?? "report_ready_needs_confirm", at: NOW, detail: "fixture" }],
    humanConfirmationRequired: true,
    autoConfirmed: false,
    autoPublished: false,
    rawEvidence: { format: "tiff", sides },
    sideProcessingJobs: {
      front: { requestId: `${sessionId}-front-request`, sessionId, side: "front", packageId: sides[0].packageId, acceptedAt: NOW },
      back: { requestId: `${sessionId}-back-request`, sessionId, side: "back", packageId: sides[1].packageId, acceptedAt: NOW },
    },
    ocr: {
      state: "succeeded",
      updatedAt: NOW,
      attemptCount: 1,
      attemptOwnerId: `${sessionId}-ocr-owner`,
      eligibleAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
      images,
      result: { fields: {} },
    },
    manifestPath,
  };
  return { item, target: { queueItemId, sessionId, reportId }, manifestPath, reportBundlePath, productionReleasePath, sessionDir };
}

function makeFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-stale-review-archive-"));
  const outputDir = path.join(root, "station");
  const archiveRoot = path.join(root, "archive");
  fs.mkdirSync(outputDir, { recursive: true });
  const first = makeTarget(outputDir, "2026-07-21T042424764Z", overrides.first);
  const second = makeTarget(outputDir, "2026-07-21T035440224Z", overrides.second);
  const terminals = Array.from({ length: 3 }, (_, index) => ({
    queueItemId: `terminal-${index}`,
    sessionId: `terminal-session-${index}`,
    reportId: `terminal-report-${index}`,
    state: "failed",
    immutablePayload: { index, reason: "pre-existing terminal failure" },
  }));
  const queue = {
    schemaVersion: "ten-kings-ai-grader-rapid-capture-queue-v2",
    updatedAt: "2026-07-22T17:59:00.000Z",
    rapidCaptureEnabled: true,
    items: [first.item, second.item, ...terminals],
  };
  const queuePath = path.join(outputDir, "rapid-capture-queue.json");
  writeJson(queuePath, queue);
  const beforeBytes = fs.readFileSync(queuePath);
  const incident = {
    incidentId: "synthetic-stale-invalid-review-removal-v1",
    expectedBeforeQueueSha256: hash(beforeBytes),
    targetItems: [first.target, second.target],
    owner: "Mark / Ten Kings",
    reason: "owner_removed_stale_invalid_finding_review_v1",
    authorizationSource: "synthetic_test_authority",
    safeOffController: {
      identity: "leimac-idmu-tcp:169.254.191.156:1000",
      host: "169.254.191.156",
      port: 1000,
    },
  };
  const idle = makeIdleStatus(root);
  const options = {
    outputDir,
    archiveRoot,
    idleStatusPath: idle.statusPath,
    idleStatusSha256: idle.statusSha256,
    now: NOW,
    requireHelperPortReleased: async () => {},
  };
  return { root, outputDir, archiveRoot, queuePath, queue, beforeBytes, first, second, terminals, incident, options };
}

function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

test("fixed production incident exposes only the exact two owner-authorized queue/session/report triples and before SHA", () => {
  assert.equal(STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.expectedBeforeQueueSha256, "3bdb4118245ee92406280f74bb45ed43c56e279f5d2cad37c2c6b444d256e05f");
  assert.deepEqual(STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.targetItems.map((entry) => entry.queueItemId), [
    "ai-grader-browser-station-session-2026-07-21T042424764Z-session-rapid-card",
    "ai-grader-browser-station-session-2026-07-21T035440224Z-session-rapid-card",
  ]);
  assert.equal(STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.reason, "owner_removed_stale_invalid_finding_review_v1");
  assert.deepEqual(STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.safeOffController, {
    identity: "leimac-idmu-tcp:169.254.191.156:1000",
    host: "169.254.191.156",
    port: 1000,
  });
});

test("exact transaction archives full entries and evidence identities, removes only two, and replays read-only", async () => {
  const fixture = makeFixture();
  try {
    const terminalBefore = fixture.terminals.map(canonicalBytes).map(hash);
    const evidenceBefore = fs.readFileSync(fixture.first.reportBundlePath);
    const first = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
    assert.equal(first.idempotent, false);
    assert.equal(first.beforeCount, 5);
    assert.equal(first.afterCount, 3);
    assert.equal(first.unfinishedAfterCount, 0);
    const after = JSON.parse(fs.readFileSync(fixture.queuePath, "utf8"));
    assert.deepEqual(after.items.map((item) => item.queueItemId), fixture.terminals.map((item) => item.queueItemId));
    assert.deepEqual(after.items.map(canonicalBytes).map(hash), terminalBefore);
    assert.equal(fs.existsSync(first.archivePointerPath), true);
    assert.equal(hash(fs.readFileSync(first.archivePointerPath)), first.archivePointerSha256);
    const archivedTriples = archivedRapidCaptureQueueTriplesForTestV1(fixture.outputDir, fixture.incident);
    assert.deepEqual(
      [...archivedTriples].sort(),
      fixture.incident.targetItems.map((entry) => `${entry.queueItemId}|${entry.sessionId}|${entry.reportId}`).sort(),
    );
    assert.throws(
      () => assertNoUnqueuedRapidSessionManifest({ outputDir: fixture.outputDir }, after, new Set()),
      /absent from the authoritative queue/,
    );
    assert.doesNotThrow(() => assertNoUnqueuedRapidSessionManifest({ outputDir: fixture.outputDir }, after, archivedTriples));
    assert.deepEqual(fs.readFileSync(fixture.first.reportBundlePath), evidenceBefore);
    assert.deepEqual(fs.readFileSync(path.join(first.archiveDir, "before-rapid-capture-queue.json")), fixture.beforeBytes);
    const ledger = JSON.parse(fs.readFileSync(path.join(first.archiveDir, "archive-ledger.json"), "utf8"));
    const receipt = JSON.parse(fs.readFileSync(first.receiptPath, "utf8"));
    assert.deepEqual(ledger.safeOffEvidence, { source: "bridge_status", bridgePhysicalState: "safe_off_verified", physicalComplete: true });
    assert.deepEqual(receipt.safeOffEvidence, ledger.safeOffEvidence);
    assert.equal(ledger.removedEntries.length, 2);
    assert.equal(ledger.removedEntries.every((entry) => entry.findingValidation.status === "invalid" && entry.findingValidation.sourceCandidateCount === 16 && entry.findingValidation.publishedFindingCount === 0 && entry.findingValidation.issueCount === 32), true);
    assert.equal(ledger.removedEntries.every((entry) => entry.publication.storageUpload === "pending_not_uploaded" && entry.publication.cardLinkage === "not_linked"), true);
    const treeBeforeReplay = hash(Buffer.from(fs.readdirSync(first.archiveDir).sort().map((name) => `${name}:${hash(fs.readFileSync(path.join(first.archiveDir, name)))}`).join("\n")));
    fs.rmSync(fixture.options.idleStatusPath);
    const replay = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.receiptSha256, first.receiptSha256);
    const treeAfterReplay = hash(Buffer.from(fs.readdirSync(first.archiveDir).sort().map((name) => `${name}:${hash(fs.readFileSync(path.join(first.archiveDir, name)))}`).join("\n")));
    assert.equal(treeAfterReplay, treeBeforeReplay);
    const refreshed = JSON.parse(fs.readFileSync(fixture.queuePath, "utf8"));
    refreshed.updatedAt = "2026-07-22T18:01:00.000Z";
    writeJson(fixture.queuePath, refreshed);
    assert.equal(archivedRapidCaptureQueueTriplesForTestV1(fixture.outputDir, fixture.incident).size, 2);
  } finally { cleanup(fixture); }
});

test("wrong queue hash or wrong exact target identity refuses before archive or mutation", async () => {
  for (const mode of ["hash", "identity"]) {
    const fixture = makeFixture();
    try {
      const incident = structuredClone(fixture.incident);
      if (mode === "hash") incident.expectedBeforeQueueSha256 = "f".repeat(64);
      else incident.targetItems[0].reportId = "wrong-report";
      await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, incident), /SHA-256 changed|linkage is absent/);
      assert.deepEqual(fs.readFileSync(fixture.queuePath), fixture.beforeBytes);
      assert.equal(fs.readdirSync(fixture.archiveRoot).length, 0);
    } finally { cleanup(fixture); }
  }
});

test("exact canonical external guarded safe-off receipt composes with unverified idle bridge status and is archived immutably", async () => {
  const fixture = makeFixture();
  try {
    const external = enableExternalSafeOffEvidence(fixture);
    const result = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
    const ledger = JSON.parse(fs.readFileSync(path.join(result.archiveDir, "archive-ledger.json"), "utf8"));
    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8"));
    assert.equal(ledger.safeOffEvidence.source, "external_guarded_leimac_safe_off");
    assert.equal(ledger.safeOffEvidence.bridgePhysicalState, "unverified");
    assert.equal(ledger.safeOffEvidence.receipt.sha256, fixture.options.externalSafeOffReceiptSha256);
    assert.equal(ledger.safeOffEvidence.controllerIdentity, "leimac-idmu-tcp:169.254.191.156:1000");
    assert.deepEqual(ledger.safeOffEvidence.ackResponses, ["W86ACK0", "W85ACK0", "W11ACK0"]);
    assert.deepEqual(ledger.safeOffEvidence.zeroedChannels, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(ledger.safeOffEvidence.lightsCommanded, false);
    assert.equal(ledger.safeOffEvidence.persistentSaved, false);
    assert.deepEqual(receipt.safeOffEvidence, ledger.safeOffEvidence);
    assert.deepEqual(
      fs.readFileSync(path.join(result.archiveDir, "external-safe-off-receipt.json")),
      fs.readFileSync(external.receiptPath),
    );
    fs.rmSync(external.receiptPath);
    fs.rmSync(fixture.options.idleStatusPath);
    const replay = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.archiveId, result.archiveId);
  } finally { cleanup(fixture); }
});

test("external safe-off receipt exception rejects missing, tampered, stale, future, wrong-controller, wrong-ACK, nonzero, or unsafe evidence before mutation", async () => {
  const modes = [
    "missing", "partial_path", "partial_hash", "missing_file", "tampered", "wrong_hash", "noncanonical", "stale", "future",
    "wrong_incident", "wrong_purpose", "wrong_owner", "wrong_source", "wrong_controller", "wrong_ack", "nonzero_output",
    "lights_commanded", "persistent_save", "post_command_conflict",
  ];
  for (const mode of modes) {
    const fixture = makeFixture();
    try {
      const startMs = mode === "stale"
        ? Date.parse("2026-07-22T17:50:00.000Z")
        : mode === "future"
          ? Date.parse("2026-07-22T17:59:55.000Z")
          : undefined;
      const external = enableExternalSafeOffEvidence(fixture, {
        startMs,
        mutateReceipt(receipt) {
          if (mode === "wrong_incident") receipt.incidentId = "unrelated-maintenance-incident";
          if (mode === "wrong_purpose") receipt.purpose = "general_queue_override";
          if (mode === "wrong_owner") receipt.authorization.owner = "Unrelated operator";
          if (mode === "wrong_source") receipt.authorization.source = "unrelated_authorization";
          if (mode === "wrong_controller") {
            receipt.operation.result.host = "169.254.191.157";
            receipt.operation.result.writes.forEach((write) => { write.host = "169.254.191.157"; });
          }
          if (mode === "wrong_ack") receipt.operation.result.writes[1].rawResponse = "W85NACK0";
          if (mode === "nonzero_output") {
            receipt.operation.result.frames[0].channelValues[0].value = "0001";
            receipt.operation.result.writes[0].frame.channelValues[0].value = "0001";
          }
          if (mode === "lights_commanded") receipt.operation.result.safety.lightsCommanded = true;
          if (mode === "persistent_save") receipt.operation.result.safety.persistentSaved = true;
        },
        mutateStatus(status) {
          if (mode === "post_command_conflict") {
            status.liveLighting.status = "on";
            status.liveLighting.physicalState.state = "positioning_light_verified";
            status.liveLighting.physicalState.complete = true;
          }
        },
      });
      if (mode === "missing") {
        delete fixture.options.externalSafeOffReceiptPath;
        delete fixture.options.externalSafeOffReceiptSha256;
      }
      if (mode === "partial_path") delete fixture.options.externalSafeOffReceiptSha256;
      if (mode === "partial_hash") delete fixture.options.externalSafeOffReceiptPath;
      if (mode === "missing_file") fs.rmSync(external.receiptPath);
      if (mode === "tampered") fs.appendFileSync(external.receiptPath, "tamper");
      if (mode === "wrong_hash") fixture.options.externalSafeOffReceiptSha256 = "f".repeat(64);
      if (mode === "noncanonical") {
        fs.writeFileSync(external.receiptPath, `${JSON.stringify(external.receipt, null, 2)}\n`);
        fixture.options.externalSafeOffReceiptSha256 = hash(fs.readFileSync(external.receiptPath));
      }
      await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident));
      assert.deepEqual(fs.readFileSync(fixture.queuePath), fixture.beforeBytes, mode);
      assert.equal(fs.readdirSync(fixture.archiveRoot).length, 0, mode);
    } finally { cleanup(fixture); }
  }
});

test("external safe-off receipt survives authenticated crash recovery and archived-receipt tamper fails replay", async () => {
  const fixture = makeFixture();
  try {
    enableExternalSafeOffEvidence(fixture);
    await assert.rejects(
      archiveStaleInvalidRapidCaptureQueueItemsForTestV1({ ...fixture.options, failpoint: "after_backup_rename" }, fixture.incident),
      /Injected failure/,
    );
    const recovered = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
    const archivedReceipt = path.join(recovered.archiveDir, "external-safe-off-receipt.json");
    assert.equal(fs.existsSync(archivedReceipt), true);
    fs.appendFileSync(archivedReceipt, "tamper");
    await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident), /archive|canonical|safe-off/i);
  } finally { cleanup(fixture); }
});

test("uploaded or linked target refuses without changing queue or referenced evidence", async () => {
  for (const mode of ["uploaded", "linked"]) {
    const fixture = makeFixture({ first: { [mode]: true } });
    try {
      await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident), /published, uploaded, linked/);
      assert.deepEqual(fs.readFileSync(fixture.queuePath), fixture.beforeBytes);
    } finally { cleanup(fixture); }
  }
});

test("tampered referenced artifact refuses before queue mutation", async () => {
  const fixture = makeFixture();
  try {
    fs.appendFileSync(fixture.first.item.ocr.images[0].localPath, "tamper");
    await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident), /Raw evidence|normalized evidence/);
    assert.deepEqual(fs.readFileSync(fixture.queuePath), fixture.beforeBytes);
  } finally { cleanup(fixture); }
});

test("stale or unsafe helper status refuses before archive or queue mutation", async () => {
  for (const mode of ["stale", "active_preview", "lighting_not_safe"]) {
    const fixture = makeFixture();
    try {
      const status = JSON.parse(fs.readFileSync(fixture.options.idleStatusPath, "utf8"));
      if (mode === "stale") status.updatedAt = "2026-07-22T17:40:00.000Z";
      if (mode === "active_preview") {
        status.previewStatus.status = "live";
        status.previewStatus.cameraOwnership = "preview_stream";
      }
      if (mode === "lighting_not_safe") status.liveLighting.physicalState.state = "positioning_light_verified";
      writeJson(fixture.options.idleStatusPath, status);
      fixture.options.idleStatusSha256 = hash(fs.readFileSync(fixture.options.idleStatusPath));
      await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident), /does not prove idle|safe-off status is stale|required/);
      assert.deepEqual(fs.readFileSync(fixture.queuePath), fixture.beforeBytes);
    } finally { cleanup(fixture); }
  }
});

test("crash after original backup rename resumes from authenticated journal and preserves evidence", async () => {
  const fixture = makeFixture();
  try {
    await assert.rejects(
      archiveStaleInvalidRapidCaptureQueueItemsForTestV1({ ...fixture.options, failpoint: "after_backup_rename" }, fixture.incident),
      /Injected failure/,
    );
    assert.equal(fs.existsSync(fixture.queuePath), false);
    assert.equal(fs.existsSync(`${fixture.queuePath}.owner-removal-v1.backup`), true);
    const recovered = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
    assert.equal(recovered.afterCount, 3);
    assert.equal(fs.existsSync(`${fixture.queuePath}.owner-removal-v1.backup`), false);
    assert.equal(fs.existsSync(`${fixture.queuePath}.owner-removal-v1.journal.json`), false);
    assert.equal(fs.existsSync(fixture.first.manifestPath), true);
  } finally { cleanup(fixture); }
});

test("crash after backup cleanup but before journal cleanup safely finalizes and then replays idempotently", async () => {
  const fixture = makeFixture();
  try {
    const evidenceBefore = fs.readFileSync(fixture.first.reportBundlePath);
    await assert.rejects(
      archiveStaleInvalidRapidCaptureQueueItemsForTestV1({ ...fixture.options, failpoint: "after_backup_cleanup_before_journal_cleanup" }, fixture.incident),
      /Injected failure/,
    );
    assert.equal(fs.existsSync(fixture.queuePath), true);
    assert.equal(fs.existsSync(`${fixture.queuePath}.owner-removal-v1.backup`), false);
    assert.equal(fs.existsSync(`${fixture.queuePath}.owner-removal-v1.journal.json`), true);
    const liveBeforeRecovery = fs.readFileSync(fixture.queuePath);
    const recovered = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
    assert.equal(recovered.idempotent, false);
    assert.deepEqual(fs.readFileSync(fixture.queuePath), liveBeforeRecovery);
    assert.deepEqual(fs.readFileSync(fixture.first.reportBundlePath), evidenceBefore);
    assert.equal(fs.existsSync(`${fixture.queuePath}.owner-removal-v1.journal.json`), false);
    fs.rmSync(fixture.options.idleStatusPath);
    const replayed = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
    assert.equal(replayed.idempotent, true);
    assert.equal(replayed.receiptSha256, recovered.receiptSha256);
    assert.deepEqual(fs.readFileSync(fixture.queuePath), liveBeforeRecovery);
  } finally { cleanup(fixture); }
});

test("changed-timestamp retry after archive-only crash replaces the proven incomplete attempt with one authoritative archive", async () => {
  const fixture = makeFixture();
  try {
    await assert.rejects(
      archiveStaleInvalidRapidCaptureQueueItemsForTestV1({ ...fixture.options, failpoint: "after_archive" }, fixture.incident),
      /Injected failure/,
    );
    const firstCandidates = fs.readdirSync(fixture.archiveRoot).filter((name) => /^[a-f0-9]{64}$/.test(name));
    assert.equal(firstCandidates.length, 1);
    assert.deepEqual(fs.readFileSync(fixture.queuePath), fixture.beforeBytes);
    const completed = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(
      { ...fixture.options, now: "2026-07-22T18:01:00.000Z" },
      fixture.incident,
    );
    const finalCandidates = fs.readdirSync(fixture.archiveRoot).filter((name) => /^[a-f0-9]{64}$/.test(name));
    assert.deepEqual(finalCandidates, [completed.archiveId]);
    assert.notEqual(completed.archiveId, firstCandidates[0]);
    const replay = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(
      { ...fixture.options, now: "2026-07-22T18:02:00.000Z" },
      fixture.incident,
    );
    assert.equal(replay.idempotent, true);
    assert.equal(replay.archiveId, completed.archiveId);
    assert.deepEqual(fs.readdirSync(fixture.archiveRoot).filter((name) => /^[a-f0-9]{64}$/.test(name)), [completed.archiveId]);
  } finally { cleanup(fixture); }
});

test("tampered archive-only attempt is preserved and rejects changed-timestamp retry", async () => {
  const fixture = makeFixture();
  try {
    await assert.rejects(
      archiveStaleInvalidRapidCaptureQueueItemsForTestV1({ ...fixture.options, failpoint: "after_archive" }, fixture.incident),
      /Injected failure/,
    );
    const [candidate] = fs.readdirSync(fixture.archiveRoot).filter((name) => /^[a-f0-9]{64}$/.test(name));
    const candidatePath = path.join(fixture.archiveRoot, candidate);
    fs.appendFileSync(path.join(candidatePath, "archive-ledger.json"), "tamper");
    await assert.rejects(
      archiveStaleInvalidRapidCaptureQueueItemsForTestV1({ ...fixture.options, now: "2026-07-22T18:01:00.000Z" }, fixture.incident),
      /canonical|archive/i,
    );
    assert.equal(fs.existsSync(candidatePath), true);
    assert.deepEqual(fs.readFileSync(fixture.queuePath), fixture.beforeBytes);
  } finally { cleanup(fixture); }
});

test("canonical but path-tampered journal is rejected before recovery action", async () => {
  const fixture = makeFixture();
  try {
    await assert.rejects(
      archiveStaleInvalidRapidCaptureQueueItemsForTestV1({ ...fixture.options, failpoint: "after_journal" }, fixture.incident),
      /Injected failure/,
    );
    const journalPath = `${fixture.queuePath}.owner-removal-v1.journal.json`;
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    journal.backupPath = path.join(fixture.root, "redirected-backup.json");
    fs.writeFileSync(journalPath, canonicalBytes(journal));
    await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident), /paths are not the exact/);
    assert.deepEqual(fs.readFileSync(fixture.queuePath), fixture.beforeBytes);
    assert.equal(fs.existsSync(journal.backupPath), false);
  } finally { cleanup(fixture); }
});

test("post-swap corruption restores the exact original and quarantines the failed replacement", async () => {
  const fixture = makeFixture();
  try {
    await assert.rejects(
      archiveStaleInvalidRapidCaptureQueueItemsForTestV1({ ...fixture.options, failpoint: "after_install" }, fixture.incident),
      /Injected failure/,
    );
    fs.appendFileSync(fixture.queuePath, "corrupt");
    await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident), /original queue was restored/);
    assert.deepEqual(fs.readFileSync(fixture.queuePath), fixture.beforeBytes);
    assert.equal(fs.existsSync(`${fixture.queuePath}.owner-removal-v1.quarantine`), true);
  } finally { cleanup(fixture); }
});

test("missing or corrupt staged replacement after backup rename restores exact original and permits a fresh retry", async () => {
  for (const mode of ["missing", "corrupt"]) {
    const fixture = makeFixture();
    try {
      await assert.rejects(
        archiveStaleInvalidRapidCaptureQueueItemsForTestV1({ ...fixture.options, failpoint: "after_backup_rename" }, fixture.incident),
        /Injected failure/,
      );
      const stagePath = `${fixture.queuePath}.owner-removal-v1.stage`;
      if (mode === "missing") fs.rmSync(stagePath);
      else fs.appendFileSync(stagePath, "corrupt");
      await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident), /original queue was restored/);
      assert.deepEqual(fs.readFileSync(fixture.queuePath), fixture.beforeBytes);
      if (mode === "corrupt") assert.equal(fs.existsSync(`${fixture.queuePath}.owner-removal-v1.quarantine`), true);
      if (mode === "corrupt") fs.rmSync(`${fixture.queuePath}.owner-removal-v1.quarantine`);
      const completed = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
      assert.equal(completed.afterCount, 3);
    } finally { cleanup(fixture); }
  }
});

test("tampered immutable archive receipt makes idempotent replay fail closed", async () => {
  const fixture = makeFixture();
  try {
    const result = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
    fs.appendFileSync(result.receiptPath, "tamper");
    await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident), /SHA-256 changed|archive|canonical/i);
  } finally { cleanup(fixture); }
});

test("tampered archive pointer, ledger, queue copy, or in-place report evidence makes replay fail closed", async () => {
  for (const mode of ["pointer", "ledger", "queue_copy", "report_evidence"]) {
    const fixture = makeFixture();
    try {
      const result = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
      const target = mode === "pointer"
        ? result.archivePointerPath
        : mode === "ledger"
        ? path.join(result.archiveDir, "archive-ledger.json")
        : mode === "queue_copy"
          ? path.join(result.archiveDir, "before-rapid-capture-queue.json")
          : fixture.first.reportBundlePath;
      fs.appendFileSync(target, "tamper");
      await assert.rejects(archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident));
    } finally { cleanup(fixture); }
  }
});

test("verified archive pointer permits future queue evolution but rejects orphan claims and target reintroduction", async () => {
  const fixture = makeFixture();
  try {
    await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
    const future = makeTarget(fixture.outputDir, "2026-07-22T190000000Z");
    const evolved = JSON.parse(fs.readFileSync(fixture.queuePath, "utf8"));
    evolved.updatedAt = "2026-07-22T19:00:00.000Z";
    evolved.items.push(future.item);
    writeJson(fixture.queuePath, evolved);
    const archivedTriples = archivedRapidCaptureQueueTriplesForTestV1(fixture.outputDir, fixture.incident);
    assert.equal(archivedTriples.size, 2);
    assert.doesNotThrow(() => assertNoUnqueuedRapidSessionManifest({ outputDir: fixture.outputDir }, evolved, archivedTriples));

    const orphan = makeTarget(fixture.outputDir, "2026-07-22T191500000Z");
    assert.throws(
      () => assertNoUnqueuedRapidSessionManifest({ outputDir: fixture.outputDir }, evolved, archivedTriples),
      new RegExp(orphan.target.sessionId),
    );
    fs.rmSync(orphan.sessionDir, { recursive: true });

    evolved.items.push(structuredClone(fixture.first.item));
    writeJson(fixture.queuePath, evolved);
    assert.throws(
      () => archivedRapidCaptureQueueTriplesForTestV1(fixture.outputDir, fixture.incident),
      /reintroduced/,
    );
  } finally { cleanup(fixture); }
});

test("future queue evolution does not weaken pointer, archive, or referenced-evidence tamper rejection", async () => {
  for (const mode of ["pointer", "archive", "evidence"]) {
    const fixture = makeFixture();
    try {
      const result = await archiveStaleInvalidRapidCaptureQueueItemsForTestV1(fixture.options, fixture.incident);
      const future = makeTarget(fixture.outputDir, `2026-07-22T20${mode.length}0000000Z`);
      const evolved = JSON.parse(fs.readFileSync(fixture.queuePath, "utf8"));
      evolved.updatedAt = "2026-07-22T20:00:00.000Z";
      evolved.items.push(future.item);
      writeJson(fixture.queuePath, evolved);
      const tamperPath = mode === "pointer"
        ? result.archivePointerPath
        : mode === "archive"
          ? path.join(result.archiveDir, "archive-ledger.json")
          : fixture.first.reportBundlePath;
      fs.appendFileSync(tamperPath, "tamper");
      assert.throws(() => archivedRapidCaptureQueueTriplesForTestV1(fixture.outputDir, fixture.incident));
    } finally { cleanup(fixture); }
  }
});

test("maintenance gate blocks genuine unfinished work and permits only terminal active entries", () => {
  const before = {
    schemaVersion: "ten-kings-ai-grader-rapid-capture-queue-v2",
    items: [{ queueItemId: "review", state: "report_ready_needs_confirm" }, { queueItemId: "failed", state: "failed" }],
  };
  assert.deepEqual(evaluateRapidCaptureQueueMaintenanceGateV1(before), {
    ready: false,
    unfinishedQueueItemIds: ["review"],
    terminalQueueItemIds: ["failed"],
  });
  assert.deepEqual(evaluateRapidCaptureQueueMaintenanceGateV1({ ...before, items: [{ queueItemId: "failed", state: "failed" }] }), {
    ready: true,
    unfinishedQueueItemIds: [],
    terminalQueueItemIds: ["failed"],
  });
});
