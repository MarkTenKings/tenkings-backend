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

test("inner Mathematical result identities and output paths cannot escape the admitted snapshot", async () => {
  const parentAppliedResults = [];
  const contained = await
    buildFixedRigMathematicalCalibrationStationPackageInWorkerV1(
      fixtureInput("worker-report-inner-output-valid"),
      { workerPath, timeoutMs: 2_000 },
    );
  assert.equal(contained.status, "completed");
  assert.equal(
    contained.reportPackage.outputDir,
    fixtureInput("worker-report-inner-output-valid").outputDir,
  );
  for (const corruption of [
    "inner-identity-queue",
    "inner-identity-session",
    "inner-identity-report",
    "inner-output-station-session",
  ]) {
    await assert.rejects(
      buildFixedRigMathematicalCalibrationStationPackageInWorkerV1(
        fixtureInput(`worker-report-${corruption}`),
        { workerPath, timeoutMs: 2_000 },
      ).then((result) => {
        parentAppliedResults.push(result);
      }),
      (error) =>
        error instanceof FixedRigMathematicalStationWorkerErrorV1 &&
        error.code === "identity_mismatch",
    );
  }
  for (const corruption of [
    "inner-output-bundle-path",
    "inner-output-station-path",
    "inner-output-relative-path",
  ]) {
    await assert.rejects(
      buildFixedRigMathematicalCalibrationStationPackageInWorkerV1(
        fixtureInput(`worker-report-${corruption}`),
        { workerPath, timeoutMs: 2_000 },
      ).then((result) => {
        parentAppliedResults.push(result);
      }),
      (error) =>
        error instanceof FixedRigMathematicalStationWorkerErrorV1 &&
        error.code === "malformed_response",
    );
  }
  assert.deepEqual(parentAppliedResults, []);
});

test("worker-pool shutdown drains active workers, rejects pending work, and leaves no orphan slot", async () => {
  let liveWorkers = 0;
  let maximumLiveWorkers = 0;
  const pool = new FixedRigMathematicalStationWorkerPoolV1({
    workerPath,
    timeoutMs: 5_000,
    maxConcurrency: 2,
    maxAdmitted: 4,
    onWorkerLifecycle: (state) => {
      liveWorkers += state === "started" ? 1 : -1;
      maximumLiveWorkers = Math.max(maximumLiveWorkers, liveWorkers);
    },
  });
  const jobs = [
    pool.run(fixtureInput("worker-report-hold-long-a", 1)),
    pool.run(fixtureInput("worker-report-hold-long-b", 2)),
    pool.run(fixtureInput("worker-report-pending-a", 3)),
    pool.run(fixtureInput("worker-report-pending-b", 4)),
  ];
  assert.equal(pool.status().active, 2);
  assert.equal(pool.status().queued, 2);
  const allSettled = Promise.allSettled(jobs);
  await pool.shutdown();
  const settled = await allSettled;
  assert.equal(settled.every((entry) =>
    entry.status === "rejected" &&
    entry.reason instanceof FixedRigMathematicalStationWorkerErrorV1 &&
    entry.reason.code === "shutdown"), true);
  assert.equal(pool.status().active, 0);
  assert.equal(pool.status().queued, 0);
  assert.equal(pool.status().admitted, 0);
  assert.equal(maximumLiveWorkers, 2);
  assert.equal(liveWorkers, 0);
  await pool.shutdown();
});

test("timed-out workers fully exit before replacement and the live bound never exceeds two", async () => {
  let liveWorkers = 0;
  let maximumLiveWorkers = 0;
  const pool = new FixedRigMathematicalStationWorkerPoolV1({
    workerPath,
    timeoutMs: 100,
    maxConcurrency: 2,
    maxAdmitted: 4,
    onWorkerLifecycle: (state) => {
      liveWorkers += state === "started" ? 1 : -1;
      maximumLiveWorkers = Math.max(maximumLiveWorkers, liveWorkers);
    },
  });
  let observedMaximum = 0;
  const sampler = setInterval(() => {
    observedMaximum = Math.max(observedMaximum, pool.status().active);
  }, 2);
  const jobs = [
    pool.run(fixtureInput("worker-report-hold-long-timeout-a", 1)),
    pool.run(fixtureInput("worker-report-hold-long-timeout-b", 2)),
    pool.run(fixtureInput("worker-report-next-a", 3)),
    pool.run(fixtureInput("worker-report-next-b", 4)),
  ];
  const settled = await Promise.allSettled(jobs);
  clearInterval(sampler);
  assert.equal(observedMaximum <= 2, true);
  assert.equal(maximumLiveWorkers <= 2, true);
  assert.equal(liveWorkers, 0);
  assert.equal(settled.filter((entry) =>
    entry.status === "rejected" &&
    entry.reason instanceof FixedRigMathematicalStationWorkerErrorV1 &&
    entry.reason.code === "timeout").length, 2);
  assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 2);
  assert.equal(pool.status().active, 0);
  assert.equal(pool.status().admitted, 0);
});
