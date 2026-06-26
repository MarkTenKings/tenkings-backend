const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
  BaslerPylonClient,
  assertBaslerCaptureOutputDirAllowed,
  buildBaslerLine2ExposureActivePlan,
  normalizeBaslerSavedImageFormat,
} = require("../dist/drivers/baslerPylonClient");
const { runCaptureHelperCli } = require("../dist/cli");

const BRIDGE_SCRIPT = __filename;

function fakeCamera() {
  return {
    index: 0,
    friendlyName: "Basler a2A GigE mono",
    modelName: "a2A2590-22gmBAS",
    vendorName: "Basler",
    serialNumber: "12345678",
    deviceType: "BaslerGigE",
    transport: "GigE",
    deviceIpAddress: "192.168.1.50",
    deviceMacAddress: "001122334455",
    subnetMask: "255.255.255.0",
    defaultGateway: "0.0.0.0",
    networkInterfaceIpAddress: "192.168.1.10",
    userDefinedName: null,
    fullName: "mock-basler-gige-full-name",
  };
}

function fakePylon() {
  return {
    installed: true,
    root: "C:\\Program Files\\Basler\\pylon",
    version: "26.05.0.18278",
    assemblyPath: "C:\\Program Files\\Basler\\pylon\\Development\\Assemblies\\Basler.Pylon\\x64\\Basler.Pylon.dll",
    runtimePath: "C:\\Program Files\\Basler\\pylon\\Runtime\\x64",
    status: "installed",
  };
}

function fakeReadiness() {
  return {
    pylon: fakePylon(),
    transport: "GigE",
    cameraCount: 1,
    cameras: [fakeCamera()],
    networkAdapters: [
      {
        interfaceAlias: "Ethernet",
        description: "USB Gigabit Ethernet",
        status: "Up",
        linkSpeed: "1 Gbps",
        macAddress: "AA-BB-CC-DD-EE-FF",
        ipAddress: "192.168.1.10",
      },
    ],
    status: "reachable",
    hardwareAccess: "explicit_pylon_gige_enumeration",
    note: "Manual Basler readiness only; this command enumerates GigE cameras and does not capture images or control lighting, Arduino, stage, or network settings.",
  };
}

function fakeCapture() {
  return {
    outputFilePath: "C:\\TenKings\\capture-data\\basler-smoke\\basler-macro-smoke-20260616T120000000Z.png",
    sha256: "575b00ae2fefbbacf7b92d1fd8b839ecfb2979661cc2202b9b08052fb1e48a68",
    byteSize: 1024,
    mimeType: "image/png",
    timestamp: "2026-06-16T12:00:00.0000000Z",
    camera: fakeCamera(),
    imageWidth: 2590,
    imageHeight: 1942,
    sourcePixelFormat: "Mono8",
    savedImageFormat: "PNG",
    exposureTime: 12000,
    gain: 0,
    transport: "GigE",
    pylon: fakePylon(),
    calibration: {
      isCalibrated: false,
      calibrationProfileId: null,
      lensModel: "Computar macro lens",
      cameraRole: "macro_overview",
      evidenceClass: "macro_raw_smoke",
      coordinateFrame: "basler_sensor_pixels",
    },
    note: "Uncalibrated macro smoke capture only; not production macro evidence and not a final AI grade.",
  };
}

function fakeLine2ExposureActive() {
  return {
    applied: true,
    baslerSettingsChanged: true,
    cameraIndex: 0,
    lineSelector: "Line2",
    lineMode: "Output",
    lineSource: "ExposureActive",
    lineInverter: false,
    persistentSaved: false,
    hardwareAccess: "explicit_pylon_line2_configuration",
    readback: {
      lineSelector: "Line2",
      lineMode: "Output",
      lineSource: "ExposureActive",
      lineInverter: false,
    },
    safety: {
      dryRun: false,
      writesApplied: true,
      baslerSettingsChanged: true,
      persistentSaved: false,
      capturesImages: false,
      controlsLighting: false,
    },
    note: "Transient Basler Line 2 ExposureActive configuration only; no User Set was saved and no image was captured.",
  };
}

function fakeRunnerFor(result, calls) {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    return { ok: true, result };
  };
}

test("mocked Basler readiness reports pylon install and GigE camera metadata", async () => {
  const calls = [];
  const client = new BaslerPylonClient(
    { bridgeScriptPath: BRIDGE_SCRIPT, pylonRoot: "C:\\Program Files\\Basler\\pylon", timeoutMs: 5000 },
    fakeRunnerFor(fakeReadiness(), calls)
  );

  const readiness = await client.readiness();

  assert.equal(readiness.pylon.installed, true);
  assert.equal(readiness.pylon.version, "26.05.0.18278");
  assert.equal(readiness.transport, "GigE");
  assert.equal(readiness.cameraCount, 1);
  assert.equal(readiness.cameras[0].modelName, "a2A2590-22gmBAS");
  assert.equal(readiness.cameras[0].transport, "GigE");
  assert.equal(readiness.status, "reachable");
  assert.deepEqual(calls[0].args.slice(0, 6), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", BRIDGE_SCRIPT, "-Action"]);
  assert.equal(calls[0].args.includes("readiness"), true);
});

test("mocked Basler camera list preserves camera and adapter metadata", async () => {
  const calls = [];
  const cameraList = { ...fakeReadiness(), command: "basler-list-cameras" };
  const client = new BaslerPylonClient(
    { bridgeScriptPath: BRIDGE_SCRIPT },
    fakeRunnerFor(cameraList, calls)
  );

  const result = await client.listCameras();

  assert.equal(result.command, "basler-list-cameras");
  assert.equal(result.cameras[0].deviceIpAddress, "192.168.1.50");
  assert.equal(result.networkAdapters[0].description, "USB Gigabit Ethernet");
  assert.equal(calls[0].args.includes("list-cameras"), true);
});

test("mocked Basler capture returns checksum, mono pixel format, and calibration smoke metadata", async () => {
  const calls = [];
  const client = new BaslerPylonClient(
    { bridgeScriptPath: BRIDGE_SCRIPT },
    fakeRunnerFor(fakeCapture(), calls)
  );

  const capture = await client.captureStill({
    outputDir: path.join(os.tmpdir(), "basler-smoke"),
    label: "macro-smoke",
    savedFormat: "png",
    lensModel: "Computar macro lens",
  });

  assert.match(capture.outputFilePath, /basler-macro-smoke-.*\.png$/);
  assert.equal(capture.sha256, "575b00ae2fefbbacf7b92d1fd8b839ecfb2979661cc2202b9b08052fb1e48a68");
  assert.equal(capture.byteSize, 1024);
  assert.equal(capture.mimeType, "image/png");
  assert.equal(capture.imageWidth, 2590);
  assert.equal(capture.imageHeight, 1942);
  assert.equal(capture.sourcePixelFormat, "Mono8");
  assert.equal(capture.savedImageFormat, "PNG");
  assert.equal(capture.exposureTime, 12000);
  assert.equal(capture.gain, 0);
  assert.equal(capture.calibration.isCalibrated, false);
  assert.equal(capture.calibration.calibrationProfileId, null);
  assert.equal(capture.calibration.cameraRole, "macro_overview");
  assert.equal(capture.calibration.evidenceClass, "macro_raw_smoke");
  assert.equal(capture.calibration.coordinateFrame, "basler_sensor_pixels");
  assert.match(capture.note, /Uncalibrated macro smoke/);
  assert.doesNotMatch(JSON.stringify(capture).toLowerCase(), /certificate|certified grade|certified grading/);
  assert.equal(calls[0].args.includes("-OutputDir"), true);
  assert.equal(calls[0].args.includes("-Label"), true);
  assert.equal(calls[0].args.includes("-Format"), true);
  assert.equal(calls[0].args.includes("png"), true);
});

test("Basler Line2 ExposureActive dry-run does not require bridge execution", async () => {
  const plan = buildBaslerLine2ExposureActivePlan(0);
  assert.equal(plan.applied, false);
  assert.equal(plan.baslerSettingsChanged, false);
  assert.equal(plan.lineSelector, "Line2");
  assert.equal(plan.lineMode, "Output");
  assert.equal(plan.lineSource, "ExposureActive");
  assert.equal(plan.lineInverter, false);
  assert.equal(plan.persistentSaved, false);
  assert.equal(plan.hardwareAccess, "dry_run_no_camera_opened");
  assert.equal(plan.safety.dryRun, true);
  assert.equal(plan.safety.capturesImages, false);
  assert.equal(plan.safety.controlsLighting, false);

  let stdout = "";
  const code = await runCaptureHelperCli(["basler-line2-exposure-active"], {
    env: {},
    stdout: (chunk) => {
      stdout += chunk;
    },
  });
  const cli = JSON.parse(stdout);
  assert.equal(code, 0);
  assert.equal(cli.line2.hardwareAccess, "dry_run_no_camera_opened");
  assert.equal(cli.line2.safety.writesApplied, false);
});

test("Basler Line2 apply requires explicit confirmation and calls bridge action only when confirmed", async () => {
  const calls = [];
  const client = new BaslerPylonClient(
    { bridgeScriptPath: BRIDGE_SCRIPT },
    fakeRunnerFor(fakeLine2ExposureActive(), calls)
  );

  await assert.rejects(
    () => client.configureLine2ExposureActive({ apply: true }),
    /requires --confirm/
  );

  const result = await client.configureLine2ExposureActive({
    apply: true,
    confirmation: BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
  });

  assert.equal(result.applied, true);
  assert.equal(result.baslerSettingsChanged, true);
  assert.equal(result.persistentSaved, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.includes("line2-exposure-active"), true);
  assert.equal(calls[0].args.includes("-Apply"), true);
});

test("Basler capture guard rejects output paths inside the repo", () => {
  assert.throws(() => assertBaslerCaptureOutputDirAllowed(""), /requires --output-dir/);
  assert.throws(
    () => assertBaslerCaptureOutputDirAllowed(process.cwd(), process.cwd()),
    /outside the git repo/
  );
  assert.equal(
    assertBaslerCaptureOutputDirAllowed(path.join(os.tmpdir(), "basler-smoke"), process.cwd()),
    path.resolve(os.tmpdir(), "basler-smoke")
  );
});

test("Basler format normalization is lossless by default and rejects unsupported formats", () => {
  assert.equal(normalizeBaslerSavedImageFormat(undefined), "png");
  assert.equal(normalizeBaslerSavedImageFormat("jpeg"), "jpg");
  assert.equal(normalizeBaslerSavedImageFormat("tiff"), "tiff");
  assert.throws(() => normalizeBaslerSavedImageFormat("gif"), /png, tiff, or jpg/);
});

test("CLI Basler capture rejects unsafe inputs before bridge execution", async () => {
  let stderr = "";
  const missingLabelCode = await runCaptureHelperCli(
    ["basler-capture-still", "--output-dir", path.join(os.tmpdir(), "basler-smoke")],
    {
      env: {},
      stderr: (chunk) => {
        stderr += chunk;
      },
    }
  );

  assert.equal(missingLabelCode, 1);
  assert.match(stderr, /requires --label/);

  stderr = "";
  const repoOutputCode = await runCaptureHelperCli(
    ["basler-capture-still", "--output-dir", process.cwd(), "--label", "repo-output"],
    {
      env: {},
      stderr: (chunk) => {
        stderr += chunk;
      },
    }
  );

  assert.equal(repoOutputCode, 1);
  assert.match(stderr, /outside the git repo/);
});
