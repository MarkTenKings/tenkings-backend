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
const corrupted = (marker, expected, replacement) =>
  input.reportId.includes(marker) ? replacement : expected;

function operatorResolutionRequest(prefix) {
  return {
    schemaVersion: "operator_resolution_request_v1",
    generatedAt: input.generatedAt,
    binding: {
      queueItemId: corrupted(
        `${prefix}-queue`,
        identity.queueItemId,
        "different-inner-queue",
      ),
      gradingSessionId: corrupted(
        `${prefix}-session`,
        identity.gradingSessionId,
        "different-inner-session",
      ),
      reportId: corrupted(
        `${prefix}-report`,
        identity.reportId,
        "different-inner-report",
      ),
    },
    originalElements: {},
    hashPolicy: "sha256-canonical-json-with-requestSha256-omitted",
    requestSha256: "a".repeat(64),
  };
}

function productionReportBundle(prefix) {
  return {
    schemaVersion: "ai-grader-report-bundle-v0.3",
    reportId: corrupted(
      `${prefix}-bundle-report`,
      identity.reportId,
      "different-inner-report",
    ),
    calibrationProfile: {
      profileId: "owner-authorized-profile-v1",
      calibrationVersion: "owner-authorized-calibration-v1",
      operationalAuthorization: {
        schemaVersion:
          "ai-grader-calibration-operational-authorization-public-v1",
        status: "authorized",
        authorityId: "owner-authority-v1",
        authoritySha256: "1".repeat(64),
        authorityFileSha256: "2".repeat(64),
        authorizedAt: "2026-07-28T00:00:00.000Z",
        subject: {
          sessionId: "calibration-session-distinct-from-card-session",
          sessionStateSha256: "3".repeat(64),
          sourceCaptureManifestSha256: "4".repeat(64),
          sourceCapturePackageSha256: "5".repeat(64),
          analysisSha256: "6".repeat(64),
          analysisFileSha256: "7".repeat(64),
          thresholdSetHash: "8".repeat(64),
          physicalArtifactSha256: "9".repeat(64),
          mathematicalAcceptanceFileSha256: "a".repeat(64),
          mathematicalAcceptanceStatus: "rejected",
          mathematicalIsCalibrated: false,
          rigId: "fixed-rig-1",
          profileId: "owner-authorized-profile-v1",
          calibrationVersion: "owner-authorized-calibration-v1",
          finalizedAt: "2026-07-28T00:00:00.000Z",
          artifactId: "owner-authorized-artifact-v1",
        },
        issueCount: 1,
        issueLedgerSha256: "b".repeat(64),
      },
    },
    pokemonStandardCornerAuthority: {
      productionMeasurementAuthority: {
        artifact: {
          gradingSessionId: corrupted(
            `${prefix}-pokemon-session`,
            identity.gradingSessionId,
            "different-inner-session",
          ),
          reportId: corrupted(
            `${prefix}-pokemon-report`,
            identity.reportId,
            "different-inner-report",
          ),
        },
      },
    },
  };
}

function completedResult() {
  return {
    version: "fixed_rig_mathematical_calibration_orchestrator_v1",
    status: "completed",
    gradingContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    reportArtifact: {
      bundle: productionReportBundle("artifact"),
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
        gradingSessionId: corrupted(
          "envelope-session",
          identity.gradingSessionId,
          "different-inner-session",
        ),
        reportBundle: productionReportBundle("envelope"),
      },
      assetManifest: {
        gradingSessionId: corrupted(
          "manifest-session",
          identity.gradingSessionId,
          "different-inner-session",
        ),
        reportId: corrupted(
          "manifest-report",
          identity.reportId,
          "different-inner-report",
        ),
        reportBundleFile: "report-bundle-v0.3.json",
        reportEnvelopeFile: "report-envelope-v1.json",
        assets: [{
          relativePath: input.reportId.includes("inner-output-relative-path")
            ? "../escaped/evidence.png"
            : "assets/evidence.png",
        }],
      },
      checksums: {
        gradingSessionId: corrupted(
          "checksums-session",
          identity.gradingSessionId,
          "different-inner-session",
        ),
        reportId: corrupted(
          "checksums-report",
          identity.reportId,
          "different-inner-report",
        ),
        files: [{ relativePath: "report-bundle-v0.3.json" }],
      },
    },
    stationInput: {
      gradingContract: "mathematical_calibration_v1",
      mathematicalReportPackagePath:
        input.reportId.includes("inner-output-station-path")
          ? path.resolve(input.outputDir, "..", "wrong-report")
          : input.outputDir,
    },
    grade: {},
    orchestrationTraceSha256: "a".repeat(64),
    summary: {},
    operatorResolutionRequest:
      operatorResolutionRequest("completed-operator"),
    ...(input.reportId.includes("checkpoint-")
      ? {
          analysisCheckpoint: {
            queueItemId: corrupted(
              "checkpoint-queue",
              identity.queueItemId,
              "different-inner-queue",
            ),
            gradingSessionId: corrupted(
              "checkpoint-session",
              identity.gradingSessionId,
              "different-inner-session",
            ),
            reportId: corrupted(
              "checkpoint-report",
              identity.reportId,
              "different-inner-report",
            ),
          },
        }
      : {}),
  };
}

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
  const result = input.reportId.includes("inner-output") ||
      input.reportId.includes("inner-card-identity")
    ? completedResult()
    : input.reportId.includes("finding-review")
      ? {
          version: "fixed_rig_mathematical_calibration_orchestrator_v1",
          status: "finding_review_required",
          gradingContract: "mathematical_calibration_v1",
          v0FallbackUsed: false,
          failedStage: "finding_review",
          reviewRequest: {
            gradingSessionId: corrupted(
              "finding-review-session",
              identity.gradingSessionId,
              "different-inner-session",
            ),
            reportId: corrupted(
              "finding-review-report",
              identity.reportId,
              "different-inner-report",
            ),
          },
          reviewAssets: [],
          reviewIssues: [],
          grade: {},
          summary: {},
          reportPackage: null,
          stationInput: null,
          operatorResolutionRequest:
            operatorResolutionRequest("finding-operator"),
        }
      : input.reportId.includes("operator-required")
        ? {
            version: "fixed_rig_mathematical_calibration_orchestrator_v1",
            status: "operator_resolution_required",
            gradingContract: "mathematical_calibration_v1",
            v0FallbackUsed: false,
            failedStage: "operator_resolution",
            request: operatorResolutionRequest("required-operator"),
            workspace: {},
            workspaceAssets: [],
            unresolvedElements: [],
            reportPackage: null,
            stationInput: null,
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
