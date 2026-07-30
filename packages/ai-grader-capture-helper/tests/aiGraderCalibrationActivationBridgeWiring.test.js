const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  AiGraderLocalStationBridgeService,
  buildAiGraderLocalStationBridgeConfig,
  createAiGraderLocalStationBridgeHttpServer,
} = require("../dist/drivers/aiGraderLocalStationBridge");

function realInput() {
  return {
    enabled: true,
    mode: "real",
    host: "127.0.0.1",
    port: 47652,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: "C:\\TenKings\\capture-data\\ai-grader-station",
    apply: true,
    markPresent: true,
    wiringConfirmed: true,
    leimacStatusGreen: true,
    leimacHost: "10.0.0.7",
  };
}

test("real helper rejects editable live-context JSON as activation authority before opening hardware", () => {
  assert.throws(
    () => createAiGraderLocalStationBridgeHttpServer(
      realInput(),
      {
        AI_GRADER_CALIBRATION_LIVE_OPERATING_CONTEXT_PATH:
          "C:\\TenKings\\capture-data\\editable-operating-context.json",
      },
    ),
    /editable JSON is not live device authority/,
  );
});

test("partial real activation wiring fails closed instead of falling back to loose bundle configuration", () => {
  assert.throws(
    () => createAiGraderLocalStationBridgeHttpServer(
      realInput(),
      {
        AI_GRADER_CALIBRATION_WORKSTATION_KEY_ID: "d".repeat(64),
      },
    ),
    /requires the workstation key, key ID, SHA-pinned rig inventory, trusted finalizer staging root, and pinned hosted authority public keys/,
  );
});


test("real helper requires pinned hosted authority verification keys before reading local key or inventory files", () => {
  assert.throws(
    () => createAiGraderLocalStationBridgeHttpServer(
      realInput(),
      {
        AI_GRADER_CALIBRATION_WORKSTATION_PRIVATE_KEY_PATH: "C:\\trusted\\workstation-key.pem",
        AI_GRADER_CALIBRATION_WORKSTATION_KEY_ID: "d".repeat(64),
        AI_GRADER_CALIBRATION_RIG_INVENTORY_PATH: "C:\\trusted\\rig-inventory.json",
        AI_GRADER_CALIBRATION_RIG_INVENTORY_SHA256: "e".repeat(64),
        AI_GRADER_CALIBRATION_FINALIZER_STAGING_ROOT: "C:\\trusted\\finalizer-staging",
      },
    ),
    /pinned hosted authority public keys/,
  );
});

test("activation evidence collision fails before any real hardware boundary", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ten-kings-activation-collision-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, "helper-output");
  const evidenceDirectory = path.join(root, "registry-staging");
  await fs.mkdir(evidenceDirectory, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDirectory, "activation-runtime-evidence.png"),
    "pre-existing immutable evidence",
    { flag: "wx" },
  );
  const config = buildAiGraderLocalStationBridgeConfig({
    ...realInput(),
    outputDir,
  });
  let realHardwareBoundaryCount = 0;
  let lightingWriteCount = 0;
  const service = new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    onRealHardwareBoundary: () => { realHardwareBoundaryCount += 1; },
    writeLightingFrames: async () => {
      lightingWriteCount += 1;
      return [];
    },
  });

  await assert.rejects(
    service.observeMathematicalCalibrationActivationRuntime(
      {},
      "local-dell-ai-grader-station",
      "ai-grader-local-station-bridge-v0.11",
      evidenceDirectory,
    ),
    /create-new target already exists/,
  );
  assert.equal(realHardwareBoundaryCount, 0);
  assert.equal(lightingWriteCount, 0);
  assert.equal(service.status().warmRunnerStatus.captureLock.held, false);
});

test("real Start New Card binds the verified ACTIVE bundle to live contour calibration", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ten-kings-live-contour-calibration-"));
  const bundleManifestSha256 = "a".repeat(64);
  const calibrationArtifactSha256 = "b".repeat(64);
  const activatedBundlePath = path.join(root, "activated-bundle.json");
  const activationAuthority = {
    bundleManifestSha256,
  };
  let assertedAuthority;
  let loadedInput;
  let freshSessionRequest;
  const config = buildAiGraderLocalStationBridgeConfig({
    ...realInput(),
    outputDir: path.join(root, "helper-output"),
    mathematicalCalibrationRigId: "fixed-rig-dell-v1",
  });
  const service = new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    writeLightingFrames: async () => [],
    calibrationActivationRegistry: {
      assertStartAuthority: async (value) => {
        assertedAuthority = value;
        return { bundlePath: activatedBundlePath };
      },
    },
    loadMathematicalCalibrationBundle: (input) => {
      loadedInput = input;
      return {
        authority: { bundleManifestSha256 },
        profile: {
          profileId: "active-preview-profile",
          calibrationVersion: "active-preview-v1",
          artifactSha256: calibrationArtifactSha256,
          mmPerPixelX: 0.043,
          mmPerPixelY: 0.044,
          scaleRelativeU95: 0.002,
          segmentationBoundaryU95Px: 1.5,
          measurementRepeatability: {
            linearMm: { u95: 0.08 },
          },
        },
        physicalArtifact: {
          inputs: {
            lensModel: {
              sourceWidthPx: 2048,
              sourceHeightPx: 3072,
            },
          },
        },
      };
    },
  });
  t.after(async () => fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50,
  }));
  service.createFreshSession = async (request) => {
    freshSessionRequest = request;
  };

  await service.action("start-session", {
    reportId: "active-preview-calibration-report",
    captureProfile: "production_fast",
    gradingContract: "mathematical_calibration_v1",
    calibrationActivationAuthority: activationAuthority,
    mathematicalGradingAuthority: {},
  });

  assert.equal(assertedAuthority, activationAuthority);
  assert.equal(loadedInput.bundlePath, activatedBundlePath);
  assert.equal(loadedInput.bundleSha256, bundleManifestSha256);
  assert.equal(loadedInput.expectedRigId, "fixed-rig-dell-v1");
  assert.deepEqual(freshSessionRequest.previewSensorPlaneCalibration, {
    schemaVersion: "ten-kings-card-geometry-sensor-plane-calibration-v1",
    profileId: "active-preview-profile",
    calibrationVersion: "active-preview-v1",
    calibrationArtifactSha256,
    bundleManifestSha256,
    sourceWidthPx: 2048,
    sourceHeightPx: 3072,
    mmPerPixelX: 0.043,
    mmPerPixelY: 0.044,
    scaleRelativeU95: 0.002,
    segmentationBoundaryU95Px: 1.5,
    linearMeasurementU95Mm: 0.08,
  });
});
