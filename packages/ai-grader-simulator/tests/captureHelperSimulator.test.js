const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createCaptureHelperSimulator,
  generateAuthOnlyCaptureManifest,
  generateDeviceCapabilityManifests,
  generateQuickCaptureManifest,
  generateStandardCaptureSimulation,
} = require("../dist");
const {
  validateCaptureManifestForMode,
  validateDeviceCapabilityManifest,
  validateMicroSpotCapturePackage,
} = require("../../shared/dist");

const BASE_CONFIG = {
  tenantId: "tenant-a",
  captureSessionId: "session-a",
  rigId: "rig-a",
  locationId: "location-a",
  operatorId: "operator-a",
  helperInstanceId: "helper-a",
  seed: "seed-a",
  calibrationSnapshotIds: [
    "calibration-a-macro",
    "calibration-a-led",
    "calibration-a-micro",
    "calibration-a-stage",
    "calibration-a-arm",
  ],
  standardSurfaceSuspectRegionIds: [
    "macro-suspect:session-a:FRONT:SURFACE:1:threshold-a",
    "macro-suspect:session-a:FRONT:SURFACE:2:threshold-a",
    "macro-suspect:session-a:FRONT:SURFACE:3:threshold-a",
  ],
};

const REQUIRED_MICRO_FRAME_KEYS = [
  "edrBase",
  "polarizedAllOn",
  "flcLed0",
  "flcLed1",
  "flcLed2",
  "flcLed3",
  "flcLed4",
  "flcLed5",
  "flcLed6",
  "flcLed7",
];

function assertValid(result) {
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
}

function frameCount(manifest, kind) {
  return manifest.frameList.filter((frame) => frame.kind === kind).length;
}

test("simulator device capability manifests validate", () => {
  const manifests = generateDeviceCapabilityManifests(BASE_CONFIG);
  assert.deepEqual(
    manifests.map((manifest) => manifest.deviceType).sort(),
    ["ARM_INTERLOCK", "LED_CONTROLLER", "MACRO_CAMERA", "MICROSCOPE", "XY_STAGE"].sort()
  );
  for (const manifest of manifests) {
    assert.equal(manifest.helperInstanceId, BASE_CONFIG.helperInstanceId);
    assert.match(manifest.checksum, /^[a-f0-9]{64}$/);
    assertValid(validateDeviceCapabilityManifest(manifest));
  }
});

test("QUICK manifest validates", () => {
  const manifest = generateQuickCaptureManifest(BASE_CONFIG);
  assert.equal(manifest.helperInstanceId, BASE_CONFIG.helperInstanceId);
  assert.ok(manifest.calibrationSnapshotIds.length >= 1);
  assert.equal(frameCount(manifest, "FRONT_DIFFUSE"), 1);
  assert.equal(frameCount(manifest, "BACK_DIFFUSE"), 1);
  assertValid(validateCaptureManifestForMode(manifest, "QUICK"));
});

test("STANDARD manifest validates and has expected spot and frame counts", () => {
  const simulation = generateStandardCaptureSimulation(BASE_CONFIG);
  const manifest = simulation.captureManifest;

  assertValid(validateCaptureManifestForMode(manifest, "STANDARD", { side: "FRONT" }));
  assert.equal(frameCount(manifest, "MICRO_CORNER_SPOT"), 4);
  assert.equal(frameCount(manifest, "MICRO_EDGE_SPOT"), 4);
  assert.equal(frameCount(manifest, "MICRO_SURFACE_SPOT"), 3);
  assert.equal(simulation.microSpotPackages.length, 11);
  assert.equal(simulation.evidenceArtifacts.length, 110);

  for (const microPackage of simulation.microSpotPackages) {
    assertValid(validateMicroSpotCapturePackage(microPackage));
    assert.deepEqual(Object.keys(microPackage.frames).sort(), [...REQUIRED_MICRO_FRAME_KEYS].sort());
    for (const frame of Object.values(microPackage.frames)) {
      assert.match(frame.checksumSha256, /^[a-f0-9]{64}$/);
      assert.match(frame.storageKey, /^simulated-captures\/tenant-a\/session-a\/seed-a\/standard\//);
    }
  }
});

test("AUTH_ONLY manifest validates", () => {
  const manifest = generateAuthOnlyCaptureManifest(BASE_CONFIG);
  assert.equal(frameCount(manifest, "MICRO_AUTH_PATCH"), 5);
  assertValid(validateCaptureManifestForMode(manifest, "AUTH_ONLY", { side: "FRONT" }));
});

test("simulator output is deterministic for the same seed and session id", () => {
  const first = createCaptureHelperSimulator(BASE_CONFIG).generateStandardCaptureSimulation();
  const second = createCaptureHelperSimulator(BASE_CONFIG).generateStandardCaptureSimulation();
  assert.deepEqual(second, first);

  const changed = createCaptureHelperSimulator({ ...BASE_CONFIG, seed: "seed-b" }).generateStandardCaptureSimulation();
  assert.notEqual(changed.captureManifest.checksumSha256, first.captureManifest.checksumSha256);
});

test("invalid simulator config rejects", () => {
  assert.throws(
    () => generateQuickCaptureManifest({ ...BASE_CONFIG, helperInstanceId: "" }),
    /helperInstanceId must be a non-empty string/
  );
  assert.throws(
    () => generateStandardCaptureSimulation({ ...BASE_CONFIG, calibrationSnapshotIds: [] }),
    /calibrationSnapshotIds must include at least one calibration id/
  );
  assert.throws(
    () => generateStandardCaptureSimulation({ ...BASE_CONFIG, standardSurfaceSuspectRegionIds: [] }),
    /standardSurfaceSuspectRegionIds must include 1 to 3 region ids/
  );
});
