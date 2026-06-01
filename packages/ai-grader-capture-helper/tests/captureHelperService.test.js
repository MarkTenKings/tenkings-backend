const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CAPTURE_HELPER_HARDWARE_ACCESS,
  SUPPORTED_CAPTURE_HELPER_DRIVER_SETS,
  SUPPORTED_CAPTURE_HELPER_BACKENDS,
  createCaptureHelperService,
  loadCaptureHelperConfig,
  parseCaptureHelperManifestMode,
} = require("../dist");
const { runCaptureHelperCli } = require("../dist/cli");
const {
  validateCaptureManifestForMode,
  validateDeviceCapabilityManifest,
} = require("../../shared/dist");

const BASE_CONFIG = {
  simulator: {
    tenantId: "tenant-helper",
    captureSessionId: "session-helper",
    rigId: "rig-helper",
    locationId: "location-helper",
    operatorId: "operator-helper",
    helperInstanceId: "helper-instance",
    seed: "helper-seed",
    calibrationSnapshotIds: [
      "cal-helper-macro",
      "cal-helper-led",
      "cal-helper-microscope",
      "cal-helper-stage",
      "cal-helper-arm",
    ],
    standardSurfaceSuspectRegionIds: [
      "macro-suspect:session-helper:FRONT:SURFACE:1:threshold-helper",
      "macro-suspect:session-helper:FRONT:SURFACE:2:threshold-helper",
      "macro-suspect:session-helper:FRONT:SURFACE:3:threshold-helper",
    ],
  },
};

function assertValid(result) {
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
}

async function runCli(argv) {
  let stdout = "";
  let stderr = "";
  const code = await runCaptureHelperCli(argv, {
    env: {},
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });
  return {
    code,
    stdout: stdout ? JSON.parse(stdout) : null,
    stderr: stderr ? JSON.parse(stderr) : null,
  };
}

test("health returns simulator offline status without hardware access", () => {
  const service = createCaptureHelperService(BASE_CONFIG, {});
  const health = service.health();

  assert.equal(health.ok, true);
  assert.equal(health.service, "ai-grader-capture-helper");
  assert.equal(health.mode, "simulator");
  assert.equal(health.driverSet, "mock");
  assert.equal(health.status, "simulator_offline");
  assert.equal(health.hardwareAccess, "disabled");
  assert.equal(health.networkListener, "disabled");
  assert.equal(health.deviceAccess, "none");
  assert.equal(health.helperInstanceId, "helper-instance");
});

test("capabilities pass shared validation", () => {
  const service = createCaptureHelperService(BASE_CONFIG, {});
  const result = service.capabilities();

  assert.equal(result.simulator, true);
  assert.equal(result.driverSet, "mock");
  assert.equal(result.hardwareAccess, "disabled");
  assert.equal(result.deviceCapabilityManifests.length, 5);
  assertValid(result.validation);
  for (const manifest of result.deviceCapabilityManifests) {
    assertValid(validateDeviceCapabilityManifest(manifest));
  }
});

test("manifest commands produce valid QUICK STANDARD and AUTH_ONLY manifests", () => {
  const service = createCaptureHelperService(BASE_CONFIG, {});

  const quick = service.manifest("QUICK");
  assert.equal(quick.captureMode, "QUICK");
  assertValid(quick.validation);
  assertValid(validateCaptureManifestForMode(quick.captureManifest, "QUICK"));

  const standard = service.manifest("STANDARD");
  assert.equal(standard.captureMode, "STANDARD");
  assert.equal(standard.microSpotPackages.length, 11);
  assert.equal(standard.evidenceArtifacts.length, 110);
  assertValid(standard.validation);
  assertValid(validateCaptureManifestForMode(standard.captureManifest, "STANDARD", { side: "FRONT" }));

  const authOnly = service.manifest("AUTH_ONLY");
  assert.equal(authOnly.captureMode, "AUTH_ONLY");
  assertValid(authOnly.validation);
  assertValid(validateCaptureManifestForMode(authOnly.captureManifest, "AUTH_ONLY", { side: "FRONT" }));
});

test("CLI prints JSON for health capabilities and manifest commands", async () => {
  const health = await runCli(["health", "--session-id", "cli-session"]);
  assert.equal(health.code, 0);
  assert.equal(health.stdout.captureSessionId, "cli-session");
  assert.equal(health.stderr, null);

  const capabilities = await runCli(["capabilities"]);
  assert.equal(capabilities.code, 0);
  assert.equal(capabilities.stdout.deviceCapabilityManifests.length, 5);
  assert.equal(capabilities.stdout.validation.valid, true);

  const standard = await runCli(["manifest", "--mode", "STANDARD", "--session-id", "cli-standard"]);
  assert.equal(standard.code, 0);
  assert.equal(standard.stdout.captureMode, "STANDARD");
  assert.equal(standard.stdout.captureManifest.captureSessionId, "cli-standard");
  assert.equal(standard.stdout.microSpotPackages.length, 11);

  const help = await runCli(["--help"]);
  assert.equal(help.code, 0);
  assert.equal(help.stdout.commands.includes("readiness"), true);
  assert.equal(help.stdout.commands.includes("serve --host 127.0.0.1 --port 47650"), true);
});

test("invalid mode and config reject", async () => {
  assert.throws(
    () => loadCaptureHelperConfig({ mode: "hardware" }, {}),
    /supports only simulator mode/
  );
  assert.throws(
    () => loadCaptureHelperConfig({ driverSet: "real" }, {}),
    /real drivers are not implemented; use readiness for validation only/
  );
  assert.throws(
    () => createCaptureHelperService({ simulator: { helperInstanceId: "" } }, {}),
    /helperInstanceId must be a non-empty string/
  );
  assert.throws(
    () => parseCaptureHelperManifestMode("FORENSIC"),
    /Manifest mode must be QUICK, STANDARD, or AUTH_ONLY/
  );

  const cli = await runCli(["manifest", "--mode", "FORENSIC"]);
  assert.equal(cli.code, 1);
  assert.match(cli.stderr.error, /Manifest mode must be QUICK, STANDARD, or AUTH_ONLY/);

  const serve = await runCli(["serve", "--host", "0.0.0.0"]);
  assert.equal(serve.code, 1);
  assert.match(serve.stderr.error, /only supports loopback hosts/);
});

test("no real hardware backend path exists", () => {
  assert.deepEqual(SUPPORTED_CAPTURE_HELPER_BACKENDS, ["simulator"]);
  assert.deepEqual(SUPPORTED_CAPTURE_HELPER_DRIVER_SETS, ["mock", "real"]);
  assert.equal(CAPTURE_HELPER_HARDWARE_ACCESS, "disabled");
  const config = loadCaptureHelperConfig({}, {});
  assert.equal(config.mode, "simulator");
  assert.equal(config.driverSet, "mock");
  assert.equal(config.hardwareAccess, "disabled");
  assert.equal(config.networkListener, "disabled");
});
