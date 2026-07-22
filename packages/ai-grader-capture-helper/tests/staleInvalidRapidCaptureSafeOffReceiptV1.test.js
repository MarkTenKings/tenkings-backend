const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722,
  buildExternalSafeOffReceiptBytesV1,
  verifyExternalSafeOffReceiptOperationV1,
} = require("../dist/drivers/staleInvalidRapidCaptureQueueArchivalV1");
const {
  STALE_REVIEW_SAFE_OFF_CAPTURE_CONFIRMATION_V1,
  STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1,
  captureStaleReviewSafeOffReceiptV1,
  regenerateStaleReviewSafeOffReceiptV1,
} = require("../dist/drivers/staleInvalidRapidCaptureSafeOffReceiptV1");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

const frameExpectations = [
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

function validOperation() {
  const durations = [100, 600, 600];
  const gaps = [0, 2, 3];
  const startMs = Date.parse("2026-07-22T17:59:40.000Z");
  let cursor = startMs;
  const frames = frameExpectations.map((expected) => ({
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
  const writes = frameExpectations.map((expected, index) => {
    cursor += gaps[index];
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

function makeFixture(label = "ordinary") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ten kings safe off ${label} `));
  const outputDir = path.join(root, "receipt evidence with spaces");
  const cliDir = path.join(root, "reviewed helper build with spaces");
  const cliPath = path.join(cliDir, "cli.js");
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(cliPath, "// exact mocked reviewed CLI bytes\n");
  const operation = validOperation();
  const stdout = Buffer.from(`${JSON.stringify(operation, null, 2)}\n`);
  const childResult = {
    stdout,
    stderr: Buffer.alloc(0),
    exitCode: 0,
    signal: null,
    spawnError: null,
    startedAt: "2026-07-22T17:59:39.900Z",
    finishedAt: "2026-07-22T17:59:41.400Z",
    durationMs: 1500,
  };
  let childCalls = 0;
  const invocations = [];
  const childBoundary = {
    async run(invocation) {
      childCalls += 1;
      invocations.push(structuredClone(invocation));
      return { ...structuredClone(childResult), stdout: Buffer.from(childResult.stdout), stderr: Buffer.from(childResult.stderr) };
    },
  };
  const options = {
    outputDir,
    captureHelperCliPath: cliPath,
    controllerHost: "169.254.191.156",
    controllerPort: 1000,
    confirmation: STALE_REVIEW_SAFE_OFF_CAPTURE_CONFIRMATION_V1,
    executablePath: process.execPath,
    childBoundary,
  };
  return { root, outputDir, cliPath, operation, stdout, childResult, childBoundary, options, invocations, childCalls: () => childCalls };
}

function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

test("incident-only capture spawns exactly one mocked child and writes canonical receipt plus durable raw evidence", async () => {
  const fixture = makeFixture("canonical success");
  try {
    const result = await captureStaleReviewSafeOffReceiptV1(fixture.options);
    assert.equal(fixture.childCalls(), 1);
    assert.equal(result.childSpawnCount, 1);
    assert.equal(result.mode, "capture");
    assert.equal(result.incidentId, STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.incidentId);
    assert.equal(fixture.invocations.length, 1);
    assert.equal(fixture.invocations[0].argv[0], fixture.cliPath);
    assert.deepEqual(fixture.invocations[0].argv.slice(1), [
      "leimac-idmu-safe-off", "--host", "169.254.191.156", "--port", "1000", "--timeout-ms", "1500",
      "--unit", "1", "--apply", "--confirm", "APPLY LEIMAC SAFE OFF",
    ]);
    assert.deepEqual(fs.readFileSync(result.rawStdoutPath), fixture.stdout);
    assert.deepEqual(fs.readFileSync(result.rawStderrPath), Buffer.alloc(0));
    const execution = JSON.parse(fs.readFileSync(result.executionEvidencePath, "utf8"));
    assert.equal(execution.stdout.sha256, sha256(fixture.stdout));
    assert.equal(execution.stderr.byteSize, 0);
    assert.equal(execution.termination.exitCode, 0);
    const receiptBytes = fs.readFileSync(result.receiptPath);
    assert.deepEqual(receiptBytes, buildExternalSafeOffReceiptBytesV1(fixture.operation));
    assert.equal(result.receiptSha256, sha256(receiptBytes));
    assert.equal(fs.readFileSync(result.receiptSha256Path, "utf8"), `${result.receiptSha256}\n`);
    assert.deepEqual(verifyExternalSafeOffReceiptOperationV1(receiptBytes).ackResponses, ["W86ACK0", "W85ACK0", "W11ACK0"]);
  } finally { cleanup(fixture); }
});

test("spaces and shell-sensitive path characters remain one argv member without quoting or command composition", async () => {
  const fixture = makeFixture("spaces & [brackets] 'quotes'");
  try {
    const result = await captureStaleReviewSafeOffReceiptV1(fixture.options);
    assert.equal(fixture.childCalls(), 1);
    assert.equal(fixture.invocations[0].argv[0], fixture.cliPath);
    assert.equal(fixture.invocations[0].cwd, path.dirname(fixture.cliPath));
    assert.equal(result.outputDir, fixture.outputDir);
    assert.equal(fs.existsSync(result.receiptPath), true);
  } finally { cleanup(fixture); }
});

test("create-new preflight refuses existing output before spawning any child", async () => {
  for (const fileName of Object.values(STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1)) {
    const fixture = makeFixture(`existing ${fileName}`);
    try {
      fs.mkdirSync(fixture.outputDir, { recursive: true });
      fs.writeFileSync(path.join(fixture.outputDir, fileName), "pre-existing evidence");
      await assert.rejects(captureStaleReviewSafeOffReceiptV1(fixture.options), /create-new preflight/);
      assert.equal(fixture.childCalls(), 0, fileName);
    } finally { cleanup(fixture); }
  }
});

test("wrong configured endpoint or capture confirmation refuses before spawning any child", async () => {
  for (const override of [
    { controllerHost: "169.254.191.157" },
    { controllerPort: 1001 },
    { confirmation: "APPLY LEIMAC SAFE OFF" },
  ]) {
    const fixture = makeFixture("wrong capture authority");
    try {
      await assert.rejects(captureStaleReviewSafeOffReceiptV1({ ...fixture.options, ...override }), /fixed incident endpoint|confirmation/);
      assert.equal(fixture.childCalls(), 0);
      assert.equal(fs.existsSync(fixture.outputDir), false);
    } finally { cleanup(fixture); }
  }
});

test("malformed, nonzero, wrong-endpoint, wrong-ACK, nonzero-output, commanded-light, and persistent-save results preserve raw evidence", async () => {
  for (const mode of [
    "malformed", "nonzero", "wrong_endpoint", "wrong_ack", "nonzero_output", "lights_commanded", "persistent_save",
  ]) {
    const fixture = makeFixture(mode);
    try {
      if (mode === "malformed") fixture.childResult.stdout = Buffer.from("not-json\n");
      if (mode === "nonzero") {
        fixture.childResult.exitCode = 1;
        fixture.childResult.stderr = Buffer.from("guarded command failed\n");
      }
      if (mode === "wrong_endpoint") {
        fixture.operation.result.host = "169.254.191.157";
        fixture.operation.result.writes.forEach((write) => { write.host = "169.254.191.157"; });
        fixture.childResult.stdout = Buffer.from(`${JSON.stringify(fixture.operation)}\n`);
      }
      if (mode === "wrong_ack") {
        fixture.operation.result.writes[1].rawResponse = "W85NACK0";
        fixture.childResult.stdout = Buffer.from(`${JSON.stringify(fixture.operation)}\n`);
      }
      if (mode === "nonzero_output") {
        fixture.operation.result.frames[0].channelValues[0].value = "0001";
        fixture.operation.result.writes[0].frame.channelValues[0].value = "0001";
        fixture.childResult.stdout = Buffer.from(`${JSON.stringify(fixture.operation)}\n`);
      }
      if (mode === "lights_commanded") {
        fixture.operation.result.safety.lightsCommanded = true;
        fixture.childResult.stdout = Buffer.from(`${JSON.stringify(fixture.operation)}\n`);
      }
      if (mode === "persistent_save") {
        fixture.operation.result.safety.persistentSaved = true;
        fixture.childResult.stdout = Buffer.from(`${JSON.stringify(fixture.operation)}\n`);
      }
      await assert.rejects(captureStaleReviewSafeOffReceiptV1(fixture.options));
      assert.equal(fixture.childCalls(), 1, mode);
      assert.deepEqual(fs.readFileSync(path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.stdout)), fixture.childResult.stdout, mode);
      assert.deepEqual(fs.readFileSync(path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.stderr)), fixture.childResult.stderr, mode);
      assert.equal(fs.existsSync(path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.execution)), true, mode);
      assert.equal(fs.existsSync(path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.receipt)), false, mode);
    } finally { cleanup(fixture); }
  }
});

test("forced canonicalization or receipt-write failure preserves exact raw evidence for zero-child regeneration", async () => {
  for (const failpoint of ["before_receipt_canonicalization", "before_receipt_write"]) {
    const fixture = makeFixture(failpoint);
    try {
      await assert.rejects(captureStaleReviewSafeOffReceiptV1({ ...fixture.options, failpoint }), /Injected failure/);
      assert.equal(fixture.childCalls(), 1);
      const stdoutPath = path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.stdout);
      assert.deepEqual(fs.readFileSync(stdoutPath), fixture.stdout);
      assert.equal(fs.existsSync(path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.receipt)), false);
      const beforeRegenerateCalls = fixture.childCalls();
      const regenerated = regenerateStaleReviewSafeOffReceiptV1({ outputDir: fixture.outputDir });
      assert.equal(regenerated.mode, "regenerate");
      assert.equal(regenerated.childSpawnCount, 0);
      assert.equal(fixture.childCalls(), beforeRegenerateCalls, "regeneration must not invoke the child boundary");
      assert.deepEqual(fs.readFileSync(regenerated.receiptPath), buildExternalSafeOffReceiptBytesV1(fixture.operation));
    } finally { cleanup(fixture); }
  }
});

test("partial receipt install is completed hardware-free and differing existing receipt is never replaced", async () => {
  const fixture = makeFixture("partial install");
  try {
    await assert.rejects(
      captureStaleReviewSafeOffReceiptV1({ ...fixture.options, failpoint: "after_receipt_write" }),
      /Injected failure/,
    );
    assert.equal(fixture.childCalls(), 1);
    const receiptPath = path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.receipt);
    const originalReceipt = fs.readFileSync(receiptPath);
    assert.equal(fs.existsSync(path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.receiptSha256)), false);
    const regenerated = regenerateStaleReviewSafeOffReceiptV1({ outputDir: fixture.outputDir });
    assert.equal(regenerated.childSpawnCount, 0);
    assert.equal(fixture.childCalls(), 1);
    assert.deepEqual(fs.readFileSync(receiptPath), originalReceipt);

    fs.writeFileSync(receiptPath, "different existing receipt\n");
    const callsBeforeRefusal = fixture.childCalls();
    assert.throws(() => regenerateStaleReviewSafeOffReceiptV1({ outputDir: fixture.outputDir }), /differs|canonical|receipt/i);
    assert.equal(fixture.childCalls(), callsBeforeRefusal);
    assert.equal(fs.readFileSync(receiptPath, "utf8"), "different existing receipt\n");
  } finally { cleanup(fixture); }
});

test("tampered preserved raw bytes or execution identities fail regeneration with zero child spawns", async () => {
  for (const mode of ["stdout", "execution"]) {
    const fixture = makeFixture(`tamper ${mode}`);
    try {
      await assert.rejects(
        captureStaleReviewSafeOffReceiptV1({ ...fixture.options, failpoint: "before_receipt_canonicalization" }),
        /Injected failure/,
      );
      if (mode === "stdout") {
        fs.appendFileSync(path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.stdout), "tamper");
      } else {
        fs.appendFileSync(path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.execution), "tamper");
      }
      const callsBefore = fixture.childCalls();
      assert.throws(() => regenerateStaleReviewSafeOffReceiptV1({ outputDir: fixture.outputDir }));
      assert.equal(fixture.childCalls(), callsBefore);
      assert.equal(fs.existsSync(path.join(fixture.outputDir, STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.receipt)), false);
    } finally { cleanup(fixture); }
  }
});
