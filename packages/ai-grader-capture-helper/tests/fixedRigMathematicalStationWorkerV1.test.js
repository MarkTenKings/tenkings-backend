const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  buildFixedRigMathematicalCalibrationStationPackageInWorkerV1,
  FixedRigMathematicalStationWorkerErrorV1,
  FixedRigMathematicalStationWorkerPoolV1,
} = require("../dist/drivers/fixedRigMathematicalStationWorkerV1");

const workerPath = path.resolve(
  __dirname,
  "fixtures",
  "fixedRigMathematicalStationWorkerFixture.js",
);

function fixtureInput(reportId, index = 1) {
  return {
    authority: {},
    gradingSessionId: `worker-session-${index}`,
    generatedAt: "2026-07-28T00:00:00.000Z",
    reportId,
    outputDir: path.resolve(__dirname, "worker-output", reportId),
    captureProfileVersion: "ten-kings-fixed-rig-production-fast-v1",
    calibration: {},
    warmSides: {},
    queueItemId: `worker-queue-${index}`,
  };
}

test("CPU-heavy Mathematical V1 work leaves the parent event loop responsive", async () => {
  let parentTimerFired = false;
  const timer = setTimeout(() => {
    parentTimerFired = true;
  }, 40);
  const pending =
    buildFixedRigMathematicalCalibrationStationPackageInWorkerV1(
      fixtureInput("worker-report-hold"),
      { workerPath, timeoutMs: 2_000 },
    );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    parentTimerFired,
    true,
    "An unrelated helper request/timer must advance while report computation is held.",
  );
  const result = await pending;
  clearTimeout(timer);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.gradingContract, "mathematical_calibration_v1");
  assert.equal(result.v0FallbackUsed, false);
});

test("the compiled default worker executes the real fail-closed adapter entry", async () => {
  const result =
    await buildFixedRigMathematicalCalibrationStationPackageInWorkerV1(
      fixtureInput("worker-real-adapter"),
      { timeoutMs: 5_000 },
    );
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.failedStage, "input_contract");
  assert.equal(result.requiresImplementationCorrection, true);
  assert.equal(result.gradingContract, "mathematical_calibration_v1");
  assert.equal(result.v0FallbackUsed, false);
});

test("the worker pool admits 25 exact cards but runs only two CPU workers", async () => {
  const pool = new FixedRigMathematicalStationWorkerPoolV1({
    workerPath,
    timeoutMs: 10_000,
    maxConcurrency: 2,
    maxAdmitted: 25,
  });
  const pending = Array.from({ length: 25 }, (_, index) =>
    pool.run(
      fixtureInput(`worker-report-hold-${index + 1}`, index + 1),
    ));
  assert.deepEqual(pool.status(), {
    limit: 2,
    active: 2,
    queued: 23,
    admitted: 25,
    admittedLimit: 25,
  });
  await assert.rejects(
    pool.run(fixtureInput("worker-report-overflow", 26)),
    (error) =>
      error instanceof FixedRigMathematicalStationWorkerErrorV1 &&
      error.code === "queue_full",
  );
  await assert.rejects(
    pool.run(fixtureInput("worker-report-hold-1", 1)),
    (error) =>
      error instanceof FixedRigMathematicalStationWorkerErrorV1 &&
      error.code === "duplicate",
  );
  const results = await Promise.all(pending);
  assert.equal(results.length, 25);
  assert.equal(
    results.every((result) =>
      result.gradingContract === "mathematical_calibration_v1" &&
      result.v0FallbackUsed === false),
    true,
  );
  assert.deepEqual(pool.status(), {
    limit: 2,
    active: 0,
    queued: 0,
    admitted: 0,
    admittedLimit: 25,
  });
});

test("a worker failure releases only its slot while another exact card continues", async () => {
  const pool = new FixedRigMathematicalStationWorkerPoolV1({
    workerPath,
    timeoutMs: 2_000,
    maxConcurrency: 2,
    maxAdmitted: 4,
  });
  const failed = pool.run(fixtureInput("worker-report-error", 1));
  const continuing = pool.run(fixtureInput("worker-report-hold", 2));
  const next = pool.run(fixtureInput("worker-report-next", 3));
  await assert.rejects(
    failed,
    (error) =>
      error instanceof FixedRigMathematicalStationWorkerErrorV1 &&
      error.code === "processing_failed",
  );
  const nextResult = await next;
  assert.equal(nextResult.status, "insufficient_evidence");
  assert.equal(
    pool.status().admitted >= 1,
    true,
    "The independent held card must remain admitted after the other card fails.",
  );
  const continuingResult = await continuing;
  assert.equal(continuingResult.status, "insufficient_evidence");
  assert.equal(pool.status().admitted, 0);
});

test("the worker boundary rejects cross-card results without applying them and enforces timeouts", async () => {
  const parentAppliedResults = [];
  for (const mismatch of ["queue", "session", "report"]) {
    await assert.rejects(
      buildFixedRigMathematicalCalibrationStationPackageInWorkerV1(
        fixtureInput(`worker-report-mismatch-${mismatch}`),
        { workerPath, timeoutMs: 2_000 },
      ).then((result) => {
        parentAppliedResults.push(result);
      }),
      (error) =>
        error instanceof FixedRigMathematicalStationWorkerErrorV1 &&
        error.code === "identity_mismatch",
    );
  }
  assert.deepEqual(parentAppliedResults, []);
  await assert.rejects(
    buildFixedRigMathematicalCalibrationStationPackageInWorkerV1(
      fixtureInput("worker-report-hold-timeout"),
      { workerPath, timeoutMs: 100 },
    ),
    (error) =>
      error instanceof FixedRigMathematicalStationWorkerErrorV1 &&
      error.code === "timeout",
  );
});

test("worker-pool shutdown cancels active CPU work and releases its exact slot", async () => {
  const pool = new FixedRigMathematicalStationWorkerPoolV1({
    workerPath,
    timeoutMs: 5_000,
    maxConcurrency: 1,
    maxAdmitted: 2,
  });
  const running = pool.run(fixtureInput("worker-report-hold-long", 1));
  assert.equal(pool.status().active, 1);
  pool.shutdown();
  await assert.rejects(
    running,
    (error) =>
      error instanceof FixedRigMathematicalStationWorkerErrorV1 &&
      error.code === "shutdown",
  );
  assert.equal(pool.status().active, 0);
  assert.equal(pool.status().admitted, 0);
});
