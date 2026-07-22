const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  createMathematicalCalibrationOperatingContextRuntimeV1,
} = require("../dist/drivers/mathematicalCalibrationOperatingContextRuntimeV1");

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function operatingContext() {
  return {
    schemaVersion: "ten-kings-ai-grader-operating-context-v1",
    rig: {
      tenantId: "tenant-1",
      rigId: "ten-kings-fixed-rig-v1",
      rigVersion: "fixed-rig-v1",
      locationId: "calibration-bench",
      locationIdentity: "Ten Kings calibration bench",
    },
    camera: { serial: "basler-1", model: "Basler-test" },
    optics: { lensIdentity: "lens-1", mountIdentity: "mount-1" },
    controller: {
      controllerIdentity: "leimac-1",
      channelWiringMapIdentity: "wiring-map-v1",
      channelMap: Array.from({ length: 8 }, (_, index) => ({
        channelIndex: index + 1,
        controllerOutput: `output-${index + 1}`,
        lightingRole: `direction-${index + 1}`,
      })),
    },
    lighting: {
      configurationIdentity: "lighting-v1",
      selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
      dutyPercent: 20,
    },
    capture: {
      exposureUs: 10000,
      gain: 0,
      pixelFormat: "Mono8",
      widthPx: 1200,
      heightPx: 1680,
    },
    calibration: {
      targetSha256: sha("target"),
      rigCharacterizationSha256: sha("rig"),
      bundleSchemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
      bundleManifestSha256: sha("bundle"),
      sourceCaptureManifestSha256: sha("capture"),
      memberLedgerSha256: sha("ledger"),
      members: [
        ["calibration_profile", undefined, "mathematical-calibration-profile-v1.json"],
        ["physical_calibration_artifact", undefined, "mathematical-calibration-artifact-v1.json"],
        ["calibration_acceptance", undefined, "mathematical-calibration-acceptance-v1.json"],
        ...Array.from({ length: 8 }, (_, index) => [
          "flat_field",
          index + 1,
          `flat-field-channel-${index + 1}-v1.json`,
        ]),
        ["illumination_pattern", undefined, "illumination-pattern-v1.json"],
      ].map(([role, channelIndex, fileName], index) => ({
        role,
        ...(channelIndex ? { channelIndex } : {}),
        fileName,
        sha256: sha(`member:${index}`),
      })),
    },
    software: {
      captureProfileVersion: "fixed-rig-capture-v1",
      calibrationAlgorithmVersion: "fixed-rig-physical-calibration-v1.0.0",
      analysisAlgorithmVersion: "opencv-physical-calibration-analysis-v1",
      thresholdSetId: "mathematical-grading-v1",
      thresholdSetHash: sha("threshold"),
      helperInstanceId: "helper-1",
      helperVersion: "helper-v1",
    },
  };
}

function protectedInventory(context) {
  return {
    schemaVersion: "ten-kings-mathematical-calibration-rig-inventory-v1",
    rig: structuredClone(context.rig),
    camera: structuredClone(context.camera),
    optics: structuredClone(context.optics),
    controller: {
      ...structuredClone(context.controller),
      controllerTransportIdentity: "leimac-idmu-tcp:10.0.0.7:502:unit:1",
    },
    lighting: { configurationIdentity: context.lighting.configurationIdentity },
    capture: {
      pixelFormat: context.capture.pixelFormat,
      widthPx: context.capture.widthPx,
      heightPx: context.capture.heightPx,
    },
    software: {
      helperInstanceId: context.software.helperInstanceId,
      helperVersion: context.software.helperVersion,
    },
  };
}

function runtimeObservation(context) {
  return {
    schemaVersion: "ten-kings-mathematical-calibration-runtime-observation-v1",
    source: "opened-basler-pylon-and-leimac-acknowledgement-v1",
    camera: structuredClone(context.camera),
    capture: structuredClone(context.capture),
    controller: {
      controllerTransportIdentity: "leimac-idmu-tcp:10.0.0.7:502:unit:1",
      selectedChannels: [...context.lighting.selectedChannels],
      dutyPercent: context.lighting.dutyPercent,
      expectedWriteCount: 4,
      acknowledgedWriteCount: 4,
      allWritesAcknowledged: true,
    },
    software: {
      helperInstanceId: context.software.helperInstanceId,
      helperVersion: context.software.helperVersion,
    },
  };
}

function providerFor(context, observation, inventoryOverride) {
  const inventory = inventoryOverride ?? protectedInventory(context);
  const bytes = Buffer.from(JSON.stringify(inventory));
  return createMathematicalCalibrationOperatingContextRuntimeV1({
    protectedInventoryBytes: bytes,
    protectedInventorySha256: sha(bytes),
    helperInstanceId: "helper-1",
    helperVersion: "helper-v1",
    observeRuntime: async () => observation,
  });
}

test("SHA-pinned inventory and opened-device telemetry are the only live operating-context authority", async () => {
  const context = operatingContext();
  const inventory = protectedInventory(context);
  const inventoryBytes = Buffer.from(JSON.stringify(inventory));
  const provider = providerFor(context, runtimeObservation(context));
  assert.deepEqual(await provider(context), context);

  const editedInventoryBytes = Buffer.from(JSON.stringify({
    ...inventory,
    camera: { ...inventory.camera, serial: "file-forged-camera" },
  }));
  assert.throws(
    () => createMathematicalCalibrationOperatingContextRuntimeV1({
      protectedInventoryBytes: editedInventoryBytes,
      protectedInventorySha256: sha(inventoryBytes),
      helperInstanceId: "helper-1",
      helperVersion: "helper-v1",
      observeRuntime: async () => runtimeObservation(context),
    }),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_RUNTIME_CONTEXT_UNTRUSTED",
  );

  let observationCalls = 0;
  const inventoryBoundProvider = createMathematicalCalibrationOperatingContextRuntimeV1({
    protectedInventoryBytes: inventoryBytes,
    protectedInventorySha256: sha(inventoryBytes),
    helperInstanceId: "helper-1",
    helperVersion: "helper-v1",
    observeRuntime: async () => {
      observationCalls += 1;
      return runtimeObservation(context);
    },
  });
  await assert.rejects(
    inventoryBoundProvider({
      ...context,
      camera: { ...context.camera, serial: "browser-or-file-declared-camera" },
    }),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_RUNTIME_CONTEXT_UNTRUSTED",
  );
  assert.equal(observationCalls, 0, "untrusted hosted/file identity is rejected before opened-device observation");
});

test("camera, exposure, gain, and controller runtime mismatches fail before receipt or Start authority", async () => {
  const context = operatingContext();
  const cases = [
    ["camera", (value) => { value.camera.serial = "different-camera"; }],
    ["exposure", (value) => { value.capture.exposureUs += 1; }],
    ["gain", (value) => { value.capture.gain += 1; }],
    ["controller", (value) => { value.controller.controllerTransportIdentity = "different-controller"; }],
    ["controller-ack", (value) => {
      value.controller.acknowledgedWriteCount = 3;
      value.controller.allWritesAcknowledged = false;
    }],
  ];
  for (const [name, mutate] of cases) {
    const observation = runtimeObservation(context);
    mutate(observation);
    await assert.rejects(
      providerFor(context, observation)(context),
      (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_RUNTIME_CONTEXT_UNTRUSTED",
      name,
    );
  }
});
