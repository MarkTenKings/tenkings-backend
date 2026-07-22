const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722,
  archiveAuthorizedStaleInvalidRapidCaptureQueueItemsV1,
  archivedRapidCaptureQueueTriplesForMaintenanceV1,
  buildExternalSafeOffReceiptBytesV1,
} = require("../dist/drivers/staleInvalidRapidCaptureQueueArchivalV1");

const ENABLED = process.env.TEN_KINGS_RUN_EXACT_STALE_REVIEW_LIVE_REPLAY === "1";
const LIVE_QUEUE = "C:\\TenKings\\capture-data\\ai-grader-station\\rapid-capture-queue.json";
const LIVE_ARCHIVE_ROOT = "C:\\TenKings\\capture-data\\ai-grader-queue-quarantine\\owner-removed-stale-invalid-review-20260722-v1";
const LIVE_RECEIPT_ROOT = "C:\\TenKings\\acceptance-evidence\\ai-grader-queue-maintenance\\external-safe-off-receipt-capture-v1";
const EXPECTED_QUEUE_SHA256 = "3bdb4118245ee92406280f74bb45ed43c56e279f5d2cad37c2c6b444d256e05f";
const NOW = "2026-07-22T22:10:00.000Z";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function identity(filePath) {
  const bytes = fs.readFileSync(filePath);
  return { path: filePath, sha256: sha256(bytes), byteSize: bytes.length };
}

function exactLiveIdentitySnapshot(queue) {
  const paths = [LIVE_QUEUE];
  for (const target of STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.targetItems) {
    const item = queue.items.find((candidate) => candidate.queueItemId === target.queueItemId);
    assert.ok(item, target.queueItemId);
    const manifest = JSON.parse(fs.readFileSync(item.manifestPath, "utf8"));
    paths.push(item.manifestPath, manifest.outputs.reportBundlePath, manifest.outputs.productionReleasePath);
  }
  for (const name of [
    "safe-off-child.stdout.json",
    "safe-off-child.stderr.txt",
    "safe-off-child-execution.json",
    "external-safe-off-receipt.json",
    "external-safe-off-receipt.sha256",
  ]) paths.push(path.join(LIVE_RECEIPT_ROOT, name));
  return paths.map(identity);
}

function safeOffOperation() {
  const expected = [
    ["lightingOutput", "86", "Lighting output ON/OFF; channel enable or safe off", "W8601010000020000030000040000050000060000070000080000", "W86ACK0", "Lighting output OFF", 100],
    ["asynchronousOutput", "85", "Asynchronous output ON/OFF; OFF for trigger-only profile", "W8501010000020000030000040000050000060000070000080000", "W85ACK0", "Asynchronous output OFF", 600],
    ["lightingOutputValue", "11", "Lighting output value; PWM duty cycle in 1000 steps", "W1101010000020000030000040000050000060000070000080000", "W11ACK0", "PWM duty 0 steps for safe-off", 600],
  ];
  const startMs = Date.parse("2026-07-22T22:09:40.000Z");
  let cursor = startMs;
  const frames = expected.map(([name, commandNumber, description, request, , meaning]) => ({
    name,
    commandNumber,
    description,
    targetDesignation: "01",
    channelValues: Array.from({ length: 8 }, (_, index) => ({ channel: index + 1, value: "0000", meaning })),
    requestAscii: request,
    requestFrame: request,
    terminator: "",
    allowlisted: true,
  }));
  const writes = expected.map((entry, index) => {
    const [, , , , response, , durationMs] = entry;
    cursor += index === 0 ? 0 : index + 1;
    const startedAt = new Date(cursor).toISOString();
    cursor += durationMs;
    return {
      ok: true,
      host: "169.254.191.156",
      port: 1000,
      timeoutMs: 1500,
      startedAt,
      finishedAt: new Date(cursor).toISOString(),
      durationMs,
      frame: structuredClone(frames[index]),
      rawResponse: response,
      responseKind: "ack",
    };
  });
  return {
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
}

test("exact live legacy payload completes a disposable archive, pointer, and replay from a pre-existing empty archive root", { skip: !ENABLED }, async () => {
  const liveQueueBytes = fs.readFileSync(LIVE_QUEUE);
  assert.equal(sha256(liveQueueBytes), EXPECTED_QUEUE_SHA256);
  assert.equal(fs.existsSync(LIVE_ARCHIVE_ROOT), true);
  assert.deepEqual(fs.readdirSync(LIVE_ARCHIVE_ROOT), []);
  const original = JSON.parse(liveQueueBytes.toString("utf8"));
  const liveBefore = exactLiveIdentitySnapshot(original);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-exact-live-stale-review-replay-"));
  try {
    const outputDir = path.join(root, "station");
    const archiveRoot = path.join(root, "archive-already-exists-empty");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(archiveRoot);
    assert.deepEqual(fs.readdirSync(archiveRoot), []);
    const queuePath = path.join(outputDir, "rapid-capture-queue.json");
    fs.writeFileSync(queuePath, liveQueueBytes);

    const statusPath = path.join(root, "authenticated-idle-status.json");
    const status = {
      ok: true,
      localOnly: true,
      updatedAt: "2026-07-22T18:57:22.870Z",
      currentStep: "start_new_card",
      previewStatus: {
        status: "not_started",
        cameraOwnership: "idle",
        intentionalTransition: { active: false },
        safety: { lightingCommanded: false },
      },
      warmRunnerStatus: {
        status: "idle",
        captureLock: { held: false },
        queues: { capture: [], processing: [], report: [] },
      },
      liveLighting: {
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
          changedAt: "2026-07-22T18:57:22.871Z",
          expectedWriteCount: 0,
          acknowledgedWriteCount: 0,
          complete: false,
        },
        connection: { state: "idle", persistentLeimacSession: false },
        safetyEvents: [],
      },
    };
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
    const statusCapturedAt = new Date("2026-07-22T22:09:50.000Z");
    fs.utimesSync(statusPath, statusCapturedAt, statusCapturedAt);

    const receiptPath = path.join(root, "external-safe-off-receipt.json");
    const receiptBytes = buildExternalSafeOffReceiptBytesV1(safeOffOperation());
    fs.writeFileSync(receiptPath, receiptBytes);
    const options = {
      outputDir,
      archiveRoot,
      idleStatusPath: statusPath,
      idleStatusSha256: sha256(fs.readFileSync(statusPath)),
      externalSafeOffReceiptPath: receiptPath,
      externalSafeOffReceiptSha256: sha256(receiptBytes),
      now: NOW,
      requireHelperPortReleased: async () => {},
    };
    const result = await archiveAuthorizedStaleInvalidRapidCaptureQueueItemsV1(options);
    assert.equal(result.beforeQueueSha256, EXPECTED_QUEUE_SHA256);
    assert.equal(result.beforeCount, 5);
    assert.equal(result.removedCount, 2);
    assert.equal(result.afterCount, 3);
    assert.equal(result.unfinishedAfterCount, 0);
    assert.deepEqual(fs.readFileSync(path.join(result.archiveDir, "before-rapid-capture-queue.json")), liveQueueBytes);
    const after = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    const retained = original.items.filter((item) => item.state === "failed");
    assert.deepEqual(after.items, retained);
    assert.deepEqual(fs.readdirSync(outputDir).sort(), [
      "rapid-capture-queue.json",
      "rapid-capture-queue.owner-removal-v1.archive-pointer.json",
    ]);
    assert.deepEqual(fs.readdirSync(archiveRoot), [result.archiveId]);
    assert.deepEqual(fs.readdirSync(result.archiveDir).sort(), [
      "after-rapid-capture-queue.json",
      "archive-ledger.json",
      "before-rapid-capture-queue.json",
      "external-safe-off-receipt.json",
      "idle-status-evidence.json",
      "receipt.json",
      "removed-entries.json",
    ]);
    const ledger = JSON.parse(fs.readFileSync(path.join(result.archiveDir, "archive-ledger.json"), "utf8"));
    assert.deepEqual(ledger.removedEntries.map((entry) => entry.findingValidation.defectFindingsRepresentation), ["absent", "absent"]);
    const transactionReceipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8"));
    assert.deepEqual(transactionReceipt.removedDefectFindingsRepresentations, ledger.removedEntries.map((entry) => ({
      queueItemId: entry.queueItemId,
      representation: "absent",
    })));
    assert.deepEqual(ledger.removedEntries.map((entry) => ({
      manifestSha256: entry.manifestSha256,
      reportBundleSha256: entry.reportBundleSha256,
      productionReleaseSha256: entry.productionReleaseSha256,
    })), STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.targetItems.map((entry) => ({
      manifestSha256: entry.evidence.manifestSha256,
      reportBundleSha256: entry.evidence.reportBundleSha256,
      productionReleaseSha256: entry.evidence.productionReleaseSha256,
    })));
    const triples = archivedRapidCaptureQueueTriplesForMaintenanceV1(outputDir);
    assert.equal(triples.size, 2);
    fs.rmSync(statusPath);
    fs.rmSync(receiptPath);
    const replay = await archiveAuthorizedStaleInvalidRapidCaptureQueueItemsV1(options);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.archiveId, result.archiveId);
    assert.deepEqual(fs.readdirSync(outputDir).sort(), [
      "rapid-capture-queue.json",
      "rapid-capture-queue.owner-removal-v1.archive-pointer.json",
    ]);
    assert.deepEqual(exactLiveIdentitySnapshot(original), liveBefore);
    assert.equal(fs.existsSync(LIVE_ARCHIVE_ROOT), true);
    assert.deepEqual(fs.readdirSync(LIVE_ARCHIVE_ROOT), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
