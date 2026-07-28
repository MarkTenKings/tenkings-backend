const { parentPort, threadId, workerData } = require("node:worker_threads");
const { deserialize, serialize } = require("node:v8");

const protocolVersion =
  "ten-kings-fixed-rig-mathematical-station-worker-v1";
const operation = "build_fixed_rig_mathematical_station_package";

const input = deserialize(Buffer.from(workerData.payload));
const identity = {
  queueItemId: input.queueItemId,
  gradingSessionId: input.gradingSessionId,
  reportId: input.reportId,
};

const holdMs = Number.isInteger(input.fixtureHoldMs)
  ? input.fixtureHoldMs
  : input.reportId.includes("hold")
    ? input.reportId.includes("long") ? 2_000 : 300
    : 0;
if (holdMs > 0) {
  const deadline = Date.now() + holdMs;
  while (Date.now() < deadline) {
    // Deliberately monopolize only this worker's event loop.
  }
}

if (input.reportId.includes("error")) {
  parentPort.postMessage({
    protocolVersion,
    operation,
    ok: false,
    identity,
    error: {
      code: "processing_failed",
      message: "Fixture mathematical processing failed safely.",
    },
  });
} else {
  const responseIdentity = input.reportId.includes("mismatch-queue")
    ? { ...identity, queueItemId: "different-queue" }
    : input.reportId.includes("mismatch-session")
      ? { ...identity, gradingSessionId: "different-session" }
      : input.reportId.includes("mismatch-report")
        ? { ...identity, reportId: "different-report" }
        : identity;
  const payload = serialize({
    version: "fixed_rig_mathematical_calibration_orchestrator_v1",
    status: "insufficient_evidence",
    gradingContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    failedStage: "input_contract",
    reasons: [`fixture-worker-thread-${threadId}`],
    requiresRecapture: false,
    requiresApprovedDesignReference: false,
    requiresCalibration: false,
    requiresImplementationCorrection: true,
    reportPackage: null,
    stationInput: null,
  });
  parentPort.postMessage(
    {
      protocolVersion,
      operation,
      ok: true,
      identity: responseIdentity,
      payload,
    },
    [payload.buffer],
  );
}

parentPort.close();
