const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BASLER_LEIMAC_SYNC_SMOKE_CONFIRMATION,
  assertBaslerLeimacSyncSmokeOutputDirAllowed,
  buildBaslerLeimacSyncSmokeManifest,
} = require("../dist/drivers/baslerLeimacSync");
const { buildBaslerLine2ExposureActivePlan } = require("../dist/drivers/baslerPylonClient");
const { buildLeimacIdmuTriggerProfilePlan } = require("../dist/drivers/leimacIdmuClient");
const { runCaptureHelperCli } = require("../dist/cli");

function fakeLeimacProfile() {
  return {
    ok: true,
    host: "169.254.191.156",
    port: 1000,
    timeoutMs: 1500,
    applied: false,
    unitInfo: {
      ok: true,
      host: "169.254.191.156",
      port: 1000,
      timeoutMs: 1500,
      command: {
        name: "unitInfo",
        commandNumber: "83",
        header: "R",
        targetKind: "none",
        description: "Unit information",
        readOnly: true,
      },
      requestAscii: "R830000",
      requestFrame: "R830000",
      rawResponse: "R83000100000008",
      parsed: {
        responseKind: "data",
        unitInformation: {
          totalUnits: 1,
          units: [{ index: 1, dimmingMethodCode: "0000", lightingOutputChannels: 8 }],
        },
        parseConfidence: "partial",
      },
      durationMs: 1,
      safety: {
        readOnly: true,
        writesAllowed: false,
        lightsCommanded: false,
        outputSettingsChanged: false,
        triggerSettingsChanged: false,
      },
    },
    plan: buildLeimacIdmuTriggerProfilePlan({ dutyPercent: 5, unit: 1 }),
    writes: [],
    safeOffBeforeProfile: [],
  };
}

function fakeCapture() {
  return {
    outputFilePath: path.join(os.tmpdir(), "basler-leimac-sync", "basler-leimac-sync-smoke.png"),
    sha256: "575b00ae2fefbbacf7b92d1fd8b839ecfb2979661cc2202b9b08052fb1e48a68",
    byteSize: 2048,
    mimeType: "image/png",
    timestamp: "2026-06-26T12:00:00.0000000Z",
    camera: { index: 0, modelName: "a2A2448-23gmBAS", transport: "GigE" },
    imageWidth: 2448,
    imageHeight: 2048,
    sourcePixelFormat: "Mono8",
    savedImageFormat: "PNG",
    exposureTime: 5000,
    gain: 0,
    transport: "GigE",
    pylon: {
      installed: true,
      root: "C:\\Program Files\\Basler\\pylon",
      version: "26.05.0.18278",
      status: "installed",
    },
    calibration: {
      isCalibrated: false,
      calibrationProfileId: null,
      cameraRole: "macro_overview",
      evidenceClass: "macro_raw_smoke",
      coordinateFrame: "basler_sensor_pixels",
    },
    note: "Uncalibrated macro smoke capture only; not production macro evidence and not a final AI grade.",
  };
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

test("Basler/Leimac sync smoke output guard rejects repo paths", () => {
  assert.throws(() => assertBaslerLeimacSyncSmokeOutputDirAllowed(""), /requires --output-dir/);
  assert.throws(
    () => assertBaslerLeimacSyncSmokeOutputDirAllowed(process.cwd(), process.cwd()),
    /outside the git repo/
  );
  assert.equal(
    assertBaslerLeimacSyncSmokeOutputDirAllowed(path.join(os.tmpdir(), "basler-leimac-sync"), process.cwd()),
    path.resolve(os.tmpdir(), "basler-leimac-sync")
  );
});

test("Basler/Leimac sync smoke manifest records uncalibrated sync metadata", () => {
  const manifest = buildBaslerLeimacSyncSmokeManifest({
    status: "captured",
    leimacHost: "169.254.191.156",
    leimacPort: 1000,
    leimacProfile: fakeLeimacProfile(),
    baslerLine2: buildBaslerLine2ExposureActivePlan(0),
    requestedExposureUs: 5000,
    capture: fakeCapture(),
    supervised: true,
  });

  assert.equal(manifest.status, "captured");
  assert.equal(manifest.imagePath.endsWith("basler-leimac-sync-smoke.png"), true);
  assert.equal(manifest.sha256, "575b00ae2fefbbacf7b92d1fd8b839ecfb2979661cc2202b9b08052fb1e48a68");
  assert.equal(manifest.byteSize, 2048);
  assert.deepEqual(manifest.dimensions, { width: 2448, height: 2048 });
  assert.equal(manifest.requestedExposureUs, 5000);
  assert.equal(manifest.exposureUs, 5000);
  assert.equal(manifest.gain, 0);
  assert.equal(manifest.basler.line2.lineSelector, "Line2");
  assert.equal(manifest.basler.line2.lineSource, "ExposureActive");
  assert.equal(manifest.basler.line2.persistentSaved, false);
  assert.equal(manifest.leimac.host, "169.254.191.156");
  assert.equal(manifest.leimac.dutyPercent, 5);
  assert.equal(manifest.leimac.dutySteps, 50);
  assert.equal(manifest.leimac.persistentSaved, false);
  assert.equal(manifest.leimac.frames.includes("W1101010050020050030050040050050050060050070050080050"), true);
  assert.equal(manifest.calibration.isCalibrated, false);
  assert.equal(manifest.calibration.evidenceClass, "macro_sync_smoke_uncalibrated");
  assert.equal(manifest.safety.supervised, true);
  assert.equal(manifest.safety.persistentSaved, false);
  assert.equal(manifest.safety.calibratedEvidence, false);
  assert.doesNotMatch(JSON.stringify(manifest).toLowerCase(), /final ai grade|calibrated macro evidence|certified macro evidence/);
});

test("Basler/Leimac sync smoke CLI requires apply and supervised safety flags", async () => {
  const outputDir = path.join(os.tmpdir(), "basler-leimac-sync");
  const missingApply = await runCli([
    "basler-leimac-sync-smoke",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    outputDir,
  ]);
  assert.equal(missingApply.code, 1);
  assert.match(missingApply.stderr.error, /requires --apply/);

  const repoOutput = await runCli([
    "basler-leimac-sync-smoke",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    process.cwd(),
    "--apply",
    "--confirm",
    BASLER_LEIMAC_SYNC_SMOKE_CONFIRMATION,
  ]);
  assert.equal(repoOutput.code, 1);
  assert.match(repoOutput.stderr.error, /outside the git repo/);

  const missingSupervision = await runCli([
    "basler-leimac-sync-smoke",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    outputDir,
    "--apply",
    "--confirm",
    BASLER_LEIMAC_SYNC_SMOKE_CONFIRMATION,
  ]);
  assert.equal(missingSupervision.code, 1);
  assert.match(missingSupervision.stderr.error, /--mark-present/);
});
