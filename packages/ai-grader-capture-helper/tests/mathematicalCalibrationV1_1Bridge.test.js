const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1_1,
  FixedRigMathematicalCalibrationCaptureProducerV1,
} = require("../dist/drivers/fixedRigMathematicalCalibrationCaptureV1");
const {
  AiGraderLocalStationBridgeService,
  buildAiGraderLocalStationBridgeConfig,
} = require("../dist/drivers/aiGraderLocalStationBridge");
const { assessMathematicalCalibrationV1_1Preview } = require("../dist/drivers/fixedRigMathematicalCalibrationV1_1");

test("V1.1 binds only a calibration session, exposes overlay-gated capture, and never opens Production", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v11-bridge-"));
  const target = Buffer.from("%PDF-1.4\nV1.1 test target\n");
  const targetPath = path.join(root, "target.pdf");
  await fs.writeFile(targetPath, target);
  const targetSha256 = crypto.createHash("sha256").update(target).digest("hex");
  const producer = new FixedRigMathematicalCalibrationCaptureProducerV1({
    outputRoot: path.join(root, "calibration"),
    targetPath,
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256,
    contractVersion: "v1.1",
    protectedSettings: {
      stationId: "local-dell-ai-grader-station",
      rigId: "fixed-rig-test-v1",
      captureProfileVersion: FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1_1,
      cameraIndex: 0,
      exposureUs: 6200,
      gain: 0,
      dutyPercent: 1.2,
      leimacUnit: 1,
      selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
      normalizedWidthPx: 1200,
      normalizedHeightPx: 1680,
      checkerboard: { internalColumns: 11, internalRows: 16, cellMm: 5 },
    },
    capture: async () => { throw new Error("hardware boundary must not run in this test"); },
  });
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: path.join(root, "station"),
  });
  const service = new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    mathematicalCalibrationCaptureProducerV1_1: producer,
  });
  const started = await service.startMathematicalCalibrationV1_1Capture({
    sessionId: "calibration-v11-bridge-session",
    operatorId: "mark-supervised",
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256,
  });
  assert.equal(started.captureCount, 0);
  assert.equal(service.manifest.sessionId, undefined, "calibration must not create a station/Production session");
  assert.ok(service.status().bridgeContract.endpoints.some((endpoint) => endpoint.path === "/calibration/mathematical-v1.1/capture"));
  assert.throws(
    () => service.captureMathematicalCalibrationV1_1Step({
      sessionId: started.sessionId,
      operationId: "placement-1",
      role: "checkerboard_placement",
      sampleIndex: 1,
      targetFace: "checkerboard",
    }),
    /active token-bound preview.*valid and sufficiently distinct/i,
  );

  service.mathematicalCalibrationPreviewStatus = {
    contractVersion: "1.1.0",
    sessionId: started.sessionId,
    active: false,
    overlay: assessMathematicalCalibrationV1_1Preview({ acceptedPoses: [] }),
    cameraOwnership: "released",
    reconnectAllowed: true,
  };
  await assert.rejects(
    service.captureMathematicalCalibrationV1_1Step({
      sessionId: started.sessionId,
      operationId: "flat-field-1-1",
      role: "flat_field",
      sampleIndex: 1,
      channelIndex: 1,
      targetFace: "blank_reverse",
    }),
    /hardware boundary must not run in this test/,
  );
});
