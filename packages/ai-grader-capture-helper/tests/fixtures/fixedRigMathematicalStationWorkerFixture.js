const { parentPort, threadId, workerData } = require("node:worker_threads");
const { deserialize, serialize } = require("node:v8");
const path = require("node:path");

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
  const result = input.reportId.includes("inner-output")
    ? {
        version: "fixed_rig_mathematical_calibration_orchestrator_v1",
        status: "completed",
        gradingContract: "mathematical_calibration_v1",
        v0FallbackUsed: false,
        reportArtifact: {
          bundle: {
            gradingSessionId: identity.gradingSessionId,
            reportId: identity.reportId,
          },
          assetPayloads: [],
        },
        reportPackage: {
          outputDir: input.outputDir,
          bundlePath: input.reportId.includes("inner-output-bundle-path")
            ? path.resolve(input.outputDir, "..", "wrong-report", "report-bundle-v0.3.json")
            : path.resolve(input.outputDir, "report-bundle-v0.3.json"),
          envelopePath: path.resolve(input.outputDir, "report-envelope-v1.json"),
          assetManifestPath: path.resolve(input.outputDir, "asset-manifest-v0.3.json"),
          checksumsPath: path.resolve(input.outputDir, "checksums-v0.3.json"),
          envelope: {
            gradingSessionId: identity.gradingSessionId,
            reportBundle: { reportId: identity.reportId },
          },
          assetManifest: {
            gradingSessionId: identity.gradingSessionId,
            reportId: identity.reportId,
            reportBundleFile: "report-bundle-v0.3.json",
            reportEnvelopeFile: "report-envelope-v1.json",
            assets: [{
              relativePath: input.reportId.includes("inner-output-relative-path")
                ? "../escaped/evidence.png"
                : "assets/evidence.png",
            }],
          },
          checksums: {
            gradingSessionId: identity.gradingSessionId,
            reportId: identity.reportId,
            files: [{ relativePath: "report-bundle-v0.3.json" }],
          },
        },
        stationInput: {
          gradingContract: "mathematical_calibration_v1",
          mathematicalReportPackagePath:
            input.reportId.includes("inner-output-station-path")
              ? path.resolve(input.outputDir, "..", "wrong-report")
              : input.outputDir,
          ...(input.reportId.includes("inner-output-station-session")
            ? { sessionId: "different-inner-session" }
            : {}),
        },
        grade: {},
        orchestrationTraceSha256: "a".repeat(64),
        summary: {},
        operatorResolutionRequest: {},
      }
    : {
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
        ...(input.reportId.includes("inner-identity-queue")
          ? {
              analysisCheckpoint: {
                queueItemId: "different-inner-queue",
                gradingSessionId: identity.gradingSessionId,
                reportId: identity.reportId,
              },
            }
          : {}),
        ...(input.reportId.includes("inner-identity-session")
          ? {
              analysisCheckpoint: {
                queueItemId: identity.queueItemId,
                gradingSessionId: "different-inner-session",
                reportId: identity.reportId,
              },
            }
          : {}),
        ...(input.reportId.includes("inner-identity-report")
          ? {
              analysisCheckpoint: {
                queueItemId: identity.queueItemId,
                gradingSessionId: identity.gradingSessionId,
                reportId: "different-inner-report",
              },
            }
          : {}),
      };
  const payload = serialize(result);
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
