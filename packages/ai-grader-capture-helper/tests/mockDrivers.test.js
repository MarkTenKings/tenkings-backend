const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MockMacroCameraDriver,
  MockMicroscopeDriver,
  createCaptureHelperService,
  createMockDriverSet,
  loadCaptureHelperConfig,
  mockDriverCapabilities,
} = require("../dist");
const {
  validateCaptureManifestFrame,
  validateDeviceCapabilityManifest,
} = require("../../shared/dist");
const packageJson = require("../package.json");

const BASE_CONFIG = {
  simulator: {
    tenantId: "tenant-drivers",
    captureSessionId: "session-drivers",
    rigId: "rig-drivers",
    locationId: "location-drivers",
    operatorId: "operator-drivers",
    helperInstanceId: "helper-drivers",
    seed: "driver-seed",
    calibrationSnapshotIds: [
      "cal-driver-macro",
      "cal-driver-led",
      "cal-driver-microscope",
      "cal-driver-stage",
      "cal-driver-arm",
    ],
    standardSurfaceSuspectRegionIds: [
      "macro-suspect:session-drivers:FRONT:SURFACE:1:threshold-driver",
    ],
  },
};

function assertValid(result) {
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
}

function buildDriverConfig() {
  return loadCaptureHelperConfig(BASE_CONFIG, {}).simulator;
}

test("every mock driver opens health-checks emits capabilities and closes", () => {
  const drivers = createMockDriverSet(buildDriverConfig());

  for (const driver of Object.values(drivers)) {
    assert.equal(driver.state, "closed");
    driver.open();
    assert.equal(driver.state, "open");
    const health = driver.health_check();
    assert.equal(health.status, "PASS");
    assert.match(health.detail, /mock driver open/);
    assertValid(validateDeviceCapabilityManifest(driver.getCapabilityManifest()));
    driver.close();
    assert.equal(driver.state, "closed");
  }
});

test("mock drivers return deterministic fake frame and evidence metadata", () => {
  const config = buildDriverConfig();
  const macro = new MockMacroCameraDriver(config);
  const micro = new MockMicroscopeDriver(config);

  const frame = macro.captureFrame({
    kind: "FRONT_DIFFUSE",
    side: "FRONT",
    ordinal: 1,
  });
  assertValid(validateCaptureManifestFrame(frame));
  assert.match(frame.checksumSha256, /^[0-9a-f]{64}$/);
  assert.equal(frame.storageKey.includes("mock-driver/macro"), true);
  assert.deepEqual(frame, macro.captureFrame({ kind: "FRONT_DIFFUSE", side: "FRONT", ordinal: 1 }));

  const evidence = micro.captureEvidence({
    packageId: "micro-package:session-drivers:front:corners:1",
    label: "edr-base",
    ordinal: 1,
  });
  assert.match(evidence.checksumSha256, /^[0-9a-f]{64}$/);
  assert.equal(evidence.mimeType, "image/tiff");
  assert.equal(evidence.storageKey.includes("mock-driver/micro"), true);
  assert.deepEqual(
    evidence,
    micro.captureEvidence({
      packageId: "micro-package:session-drivers:front:corners:1",
      label: "edr-base",
      ordinal: 1,
    })
  );
});

test("failure injection returns expected errors", () => {
  const config = buildDriverConfig();
  const macro = new MockMacroCameraDriver(config, {
    failures: {
      open: "macro open failure",
      capture: "macro capture failure",
    },
  });
  assert.throws(() => macro.open(), /macro open failure/);
  assert.throws(
    () => macro.captureFrame({ kind: "FRONT_DIFFUSE", side: "FRONT", ordinal: 1 }),
    /macro capture failure/
  );

  const healthFailure = new MockMicroscopeDriver(config, {
    failures: {
      health_check: "microscope health failure",
    },
  });
  const health = healthFailure.health_check();
  assert.equal(health.status, "FAIL");
  assert.equal(health.detail, "microscope health failure");
});

test("unsupported real driverSet rejects", () => {
  assert.throws(
    () => loadCaptureHelperConfig({ ...BASE_CONFIG, driverSet: "real" }, {}),
    /real drivers are not implemented; use readiness for validation only/
  );
  assert.throws(
    () => loadCaptureHelperConfig(BASE_CONFIG, { AI_GRADER_CAPTURE_HELPER_DRIVER_SET: "basler" }),
    /driverSet must be mock or real/
  );
});

test("service assembles mock driver capabilities", () => {
  const service = createCaptureHelperService(BASE_CONFIG, {});
  const result = service.capabilities();

  assert.equal(service.config.driverSet, "mock");
  assert.equal(result.driverSet, "mock");
  assert.equal(result.deviceCapabilityManifests.length, 5);
  assert.deepEqual(
    result.deviceCapabilityManifests.map((manifest) => manifest.driverName).sort(),
    [
      "mock-arm-interlock",
      "mock-led-controller",
      "mock-macro-camera",
      "mock-microscope",
      "mock-xy-stage",
    ]
  );
  assertValid(result.validation);
  assert.equal(mockDriverCapabilities(service.drivers).length, 5);
});

test("no hardware modules are dependencies or imported", () => {
  const forbidden = ["serialport", "node-hid", "usb", "basler", "dino", "grbl", "opencv"];
  const dependencyNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  });
  for (const dependency of dependencyNames) {
    assert.equal(
      forbidden.some((name) => dependency.toLowerCase().includes(name)),
      false,
      `unexpected hardware dependency ${dependency}`
    );
  }

  for (const moduleId of Object.keys(require.cache)) {
    assert.equal(
      forbidden.some((name) => moduleId.toLowerCase().includes(name)),
      false,
      `unexpected hardware module import ${moduleId}`
    );
  }
});
