const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCaptureHelperReadinessReport,
  runCaptureHelperDiscoveryStubs,
} = require("../dist");
const { runCaptureHelperCli } = require("../dist/cli");
const packageJson = require("../package.json");

const BASE_CONFIG = {
  simulator: {
    tenantId: "tenant-readiness",
    captureSessionId: "session-readiness",
    rigId: "rig-readiness",
    locationId: "location-readiness",
    operatorId: "operator-readiness",
    helperInstanceId: "helper-readiness",
    seed: "readiness-seed",
  },
};

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

test("mock config readiness passes without hardware probing", () => {
  const report = buildCaptureHelperReadinessReport(BASE_CONFIG, {}, { pathExists: () => false });

  assert.equal(report.ok, true);
  assert.equal(report.mode, "readiness");
  assert.equal(report.overallStatus, "PASS");
  assert.equal(report.driverSet, "mock");
  assert.equal(report.hardwareAccess, "not_probed");
  assert.equal(report.configValidation.status, "PASS");
  assert.equal(report.expectedDevices.length, 5);
  assert.deepEqual(
    report.discovery.map((result) => result.status),
    ["NOT_PROBED", "NOT_PROBED", "NOT_PROBED", "NOT_PROBED", "NOT_PROBED"]
  );
  assert.equal(report.unsupportedRealDriverNotices.length, 0);
});

test("real driverSet fails closed for readiness only", async () => {
  const report = buildCaptureHelperReadinessReport(
    { ...BASE_CONFIG, driverSet: "real", rigMode: "readiness" },
    {},
    { pathExists: () => false }
  );

  assert.equal(report.overallStatus, "FAIL");
  assert.equal(report.driverSet, "real");
  assert.equal(report.configValidation.status, "FAIL");
  assert.equal(report.unsupportedRealDriverNotices.length, 3);
  assert.deepEqual(
    report.discovery.map((result) => result.status),
    ["NOT_IMPLEMENTED", "NOT_IMPLEMENTED", "NOT_IMPLEMENTED", "NOT_IMPLEMENTED", "NOT_IMPLEMENTED"]
  );

  const cli = await runCli([
    "readiness",
    "--driver-set",
    "real",
    "--rig-mode",
    "readiness",
    "--tenant-id",
    "tenant-cli",
    "--rig-id",
    "rig-cli",
    "--location-id",
    "location-cli",
    "--operator-id",
    "operator-cli",
    "--helper-instance-id",
    "helper-cli",
  ]);
  assert.equal(cli.code, 0);
  assert.equal(cli.stdout.overallStatus, "FAIL");
  assert.equal(cli.stdout.driverSet, "real");
  assert.equal(cli.stdout.discovery.every((result) => result.status === "NOT_IMPLEMENTED"), true);
});

test("missing helper and rig identity fails validation", () => {
  const report = buildCaptureHelperReadinessReport({}, {}, { pathExists: () => false });

  assert.equal(report.overallStatus, "FAIL");
  assert.equal(report.configValidation.status, "FAIL");
  const failedNames = report.configValidation.checks
    .filter((check) => check.status === "FAIL")
    .map((check) => check.name);
  assert.deepEqual(failedNames, [
    "identity.helperInstanceId",
    "identity.rigId",
    "identity.tenantId",
    "identity.locationId",
    "identity.operatorId",
  ]);
});

test("missing calibration path warns or fails based on safety flag", () => {
  const warnReport = buildCaptureHelperReadinessReport(
    {
      ...BASE_CONFIG,
      calibrationPaths: { macroCamera: "/tmp/missing-ai-grader-macro-calibration.json" },
    },
    {},
    { pathExists: () => false }
  );
  assert.equal(warnReport.overallStatus, "WARN");
  assert.equal(warnReport.calibrationChecks[0].status, "WARN");

  const failReport = buildCaptureHelperReadinessReport(
    {
      ...BASE_CONFIG,
      calibrationPaths: { macroCamera: "/tmp/missing-ai-grader-macro-calibration.json" },
      safety: { requireCalibrationArtifacts: true },
    },
    {},
    { pathExists: () => false }
  );
  assert.equal(failReport.overallStatus, "FAIL");
  assert.equal(failReport.calibrationChecks[0].status, "FAIL");
});

test("discovery stubs do not probe real devices", () => {
  const mockDiscovery = runCaptureHelperDiscoveryStubs("mock");
  assert.equal(mockDiscovery.length, 5);
  assert.equal(mockDiscovery.every((result) => result.devices.length === 0), true);
  assert.equal(mockDiscovery.every((result) => result.status === "NOT_PROBED"), true);

  const realDiscovery = runCaptureHelperDiscoveryStubs("real");
  assert.equal(realDiscovery.length, 5);
  assert.equal(realDiscovery.every((result) => result.devices.length === 0), true);
  assert.equal(realDiscovery.every((result) => result.status === "NOT_IMPLEMENTED"), true);
});

test("manual Dino-Lite enumeration command rejects missing bridge executable path", async () => {
  const cli = await runCli(["dinolite-enumerate", "--adapter", "dnvideox"]);

  assert.equal(cli.code, 1);
  assert.match(cli.stderr.error, /requires --bridge-exe/);
});

test("readiness package path imports no hardware modules", () => {
  const forbiddenDependencies = ["node-hid", "usb", "basler", "dino", "grbl", "opencv"];
  const forbiddenImports = [
    "node_modules/serialport",
    "node_modules/@serialport",
    "node-hid",
    "usb",
    "basler",
    "node_modules/dino",
    "dnvideox.ocx",
    "node_modules/grbl",
    "opencv",
  ];
  const dependencyNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  });
  for (const dependency of dependencyNames) {
    assert.equal(
      forbiddenDependencies.some((name) => dependency.toLowerCase().includes(name)),
      false,
      `unexpected hardware dependency ${dependency}`
    );
  }

  for (const moduleId of Object.keys(require.cache)) {
    assert.equal(
      forbiddenImports.some((name) => moduleId.toLowerCase().includes(name)),
      false,
      `unexpected hardware module import ${moduleId}`
    );
  }
});

test("default CLI health and readiness do not load Basler pylon client", async () => {
  const before = Object.keys(require.cache).filter((moduleId) => moduleId.includes("baslerPylonClient"));
  assert.equal(before.length, 0);

  const health = await runCli(["health"]);
  const readiness = await runCli([
    "readiness",
    "--tenant-id",
    "tenant-cli",
    "--rig-id",
    "rig-cli",
    "--location-id",
    "location-cli",
    "--operator-id",
    "operator-cli",
    "--helper-instance-id",
    "helper-cli",
  ]);

  assert.equal(health.code, 0);
  assert.equal(readiness.code, 0);
  const after = Object.keys(require.cache).filter((moduleId) => moduleId.includes("baslerPylonClient"));
  assert.equal(after.length, 0);
});
