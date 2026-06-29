const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
  AI_GRADER_FULL_RIG_LOCAL_SMOKE_CONFIRMATION,
  BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION,
  buildBaslerLeimacMacroPackageManifest,
  buildFullRigLocalSmokeManifest,
  renderFullRigReport,
  renderMacroPackageReport,
} = require("../dist/drivers/baslerLeimacFullRig");
const {
  AI_GRADER_FIXED_RIG_V1_CONFIRMATION,
  BASLER_FIXED_RIG_FOCUS_ASSIST_CONFIRMATION,
  BASLER_FIXED_RIG_OPERATOR_PREVIEW_CONFIRMATION,
  LEIMAC_CHANNEL_CHARACTERIZATION_CONFIRMATION,
  buildFixedRigCalibrationProfile,
  buildFixedRigFocusAssistManifest,
  buildFixedRigLightingProfilePlan,
  buildFixedRigOperatorPreviewManifest,
  buildFixedRigSideCapture,
  buildFixedRigV1LocalManifest,
  buildLeimacChannelCharacterizationManifest,
  buildLeimacCharacterizationFrames,
  renderFixedRigFocusAssistReport,
  renderFixedRigOperatorPreviewReport,
  renderFixedRigV1Report,
  renderLeimacChannelCharacterizationReport,
} = require("../dist/drivers/baslerFixedRigV1");
const {
  BASLER_LEIMAC_POLARITY_SMOKE_CONFIRMATION,
  BASLER_LEIMAC_IMAGE_STAT_SYNC_SMOKE_CONFIRMATION,
  BASLER_LEIMAC_SYNC_SMOKE_CONFIRMATION,
  assertBaslerLeimacSyncSmokeOutputDirAllowed,
  buildBaslerLeimacImageStatSyncSmokeManifest,
  buildBaslerLeimacPolaritySmokeManifest,
  buildBaslerLeimacPolaritySmokePlan,
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

function fakeLine2Status() {
  return {
    applied: false,
    baslerSettingsChanged: false,
    cameraIndex: 0,
    lineSelector: "Line2",
    persistentSaved: false,
    hardwareAccess: "explicit_pylon_line2_status_read",
    readback: {
      lineSelector: "Line2",
      lineMode: "Output",
      lineSource: "ExposureActive",
      lineInverter: false,
      lineStatus: { supported: true, value: false, raw: "False" },
      lineStatusAll: { supported: true, value: 2, raw: "2" },
    },
    safety: {
      dryRun: false,
      writesApplied: false,
      baslerSettingsChanged: false,
      persistentSaved: false,
      capturesImages: false,
      controlsLighting: false,
    },
    note: "Read-only Basler Line 2 status query; no User Set was saved and no image was captured.",
  };
}

function fakeFixedRigQuality(overrides = {}) {
  return {
    filePath: path.join(os.tmpdir(), "fixed-rig-v1", "synced.png"),
    width: 2448,
    height: 2048,
    channels: 1,
    min: 0,
    max: 255,
    mean: 73.6,
    nonZeroFraction: 1,
    brightFraction: 0.46,
    histogram: [],
    clippedPixelFraction: 0.01,
    darkPixelFraction: 0.03,
    sharpnessScore: 42,
    cardBoundary: {
      status: "detected",
      x: 200,
      y: 150,
      width: 2000,
      height: 1700,
      coverage: 0.678,
      confidence: 0.65,
    },
    framing: {
      status: "acceptable_for_smoke",
      cardCoverageEstimate: 0.678,
      warnings: [],
    },
    focus: {
      status: "manual_review",
      sharpnessScore: 42,
      recommendation: "Manual focus assist only.",
    },
    warnings: [],
    ...overrides,
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
  assert.doesNotMatch(JSON.stringify(manifest).toLowerCase(), /certified grade|certified macro evidence|calibrated macro evidence/);
});

test("Basler/Leimac polarity smoke plan defaults to 1 percent and orders candidates safely", async () => {
  const plan = buildBaslerLeimacPolaritySmokePlan();

  assert.equal(plan.dryRun, true);
  assert.equal(plan.dutyPercent, 1);
  assert.deepEqual(plan.candidates.map((candidate) => candidate.id), [
    "line2-no-inverter-level-high",
    "line2-inverter-level-low",
    "line2-no-inverter-level-low",
    "line2-inverter-level-high",
  ]);
  assert.equal(plan.candidates[0].baslerLineInverter, false);
  assert.equal(plan.candidates[0].leimacTriggerActivation, "LevelHigh");
  assert.equal(plan.safety.safeOffBeforeEachCandidate, true);
  assert.equal(plan.safety.safeOffAfterIdleOnCandidate, true);
  assert.equal(plan.safety.safeOffAfterCapture, true);
  assert.equal(plan.safety.persistentSaved, false);

  const cli = await runCli([
    "basler-leimac-polarity-smoke",
    "--leimac-host",
    "169.254.191.156",
    "--candidate",
    "line2-no-inverter-level-high",
  ]);
  assert.equal(cli.code, 0);
  assert.equal(cli.stdout.dryRun, true);
  assert.equal(cli.stdout.plan.dutyPercent, 1);
  assert.equal(cli.stdout.selectedCandidate.id, "line2-no-inverter-level-high");
  assert.equal(cli.stdout.manifest.safety.writesApplied, false);
});

test("Basler/Leimac polarity smoke manifest records selected polarity and safety flags", () => {
  const plan = buildBaslerLeimacPolaritySmokePlan({
    candidateId: "line2-no-inverter-level-high",
    dutyPercent: 1,
    exposureUs: 5000,
  });
  const candidate = plan.selectedCandidate;
  const profilePlan = buildLeimacIdmuTriggerProfilePlan({
    dutyPercent: 1,
    triggerActivation: candidate.leimacTriggerActivation,
  });

  const manifest = buildBaslerLeimacPolaritySmokeManifest({
    status: "captured",
    candidate,
    candidateResult: "accepted",
    leimacHost: "169.254.191.156",
    leimacPort: 1000,
    leimacProfilePlan: profilePlan,
    baslerLine2Status: fakeLine2Status(),
    requestedExposureUs: 5000,
    capture: fakeCapture(),
    supervised: true,
    safeOffBefore: true,
    safeOffAfter: true,
    finalLightOffConfirmedByMark: true,
  });

  assert.equal(manifest.selectedCandidate.id, "line2-no-inverter-level-high");
  assert.equal(manifest.selectedCandidate.baslerLineInverter, false);
  assert.equal(manifest.selectedCandidate.leimacTriggerActivation, "LevelHigh");
  assert.equal(manifest.candidateResult, "accepted");
  assert.equal(manifest.basler.line2.lineInverter, false);
  assert.equal(manifest.basler.line2.readback.lineStatus.value, false);
  assert.equal(manifest.leimac.triggerActivation, "LevelHigh");
  assert.equal(manifest.leimac.dutyPercent, 1);
  assert.equal(manifest.leimac.dutySteps, 10);
  assert.equal(manifest.leimac.frames.includes("W0901010000020000030000040000050000060000070000080000"), true);
  assert.equal(manifest.safety.safeOffBefore, true);
  assert.equal(manifest.safety.safeOffAfter, true);
  assert.equal(manifest.safety.finalLightOffConfirmedByMark, true);
  assert.equal(manifest.calibration.isCalibrated, false);
  assert.equal(manifest.calibration.evidenceClass, "macro_sync_smoke_uncalibrated");
  assert.doesNotMatch(JSON.stringify(manifest).toLowerCase(), /certified grade|certified macro evidence|calibrated macro evidence/);
});

test("Basler/Leimac image-stat sync manifest records dark-vs-sync stats", () => {
  const plan = buildBaslerLeimacPolaritySmokePlan({
    candidateId: "line2-inverter-level-low",
    dutyPercent: 3,
    exposureUs: 50000,
  });
  const candidate = plan.selectedCandidate;
  const profilePlan = buildLeimacIdmuTriggerProfilePlan({
    dutyPercent: 3,
    triggerActivation: candidate.leimacTriggerActivation,
  });
  const darkCapture = fakeCapture();
  const syncedCapture = {
    ...fakeCapture(),
    outputFilePath: path.join(os.tmpdir(), "basler-leimac-sync", "synced.png"),
    byteSize: 4096,
    exposureTime: 50000,
  };

  const manifest = buildBaslerLeimacImageStatSyncSmokeManifest({
    status: "captured",
    candidate,
    leimacHost: "169.254.191.156",
    leimacPort: 1000,
    leimacProfilePlan: profilePlan,
    baslerLine2Status: fakeLine2Status(),
    requestedExposureUs: 50000,
    dutyPercent: 3,
    darkControl: {
      capture: darkCapture,
      stats: {
        filePath: darkCapture.outputFilePath,
        width: 2448,
        height: 2048,
        channels: 1,
        min: 0,
        max: 10,
        mean: 2,
        nonZeroFraction: 0.2,
        brightFraction: 0,
      },
    },
    synced: {
      capture: syncedCapture,
      stats: {
        filePath: syncedCapture.outputFilePath,
        width: 2448,
        height: 2048,
        channels: 1,
        min: 0,
        max: 80,
        mean: 8,
        nonZeroFraction: 0.8,
        brightFraction: 0.08,
      },
    },
    supervised: true,
    safeOffBefore: true,
    safeOffAfter: true,
    finalLightOffConfirmedByMark: true,
  });

  assert.equal(manifest.selectedCandidate.id, "line2-inverter-level-low");
  assert.equal(manifest.darkControl.stats.mean, 2);
  assert.equal(manifest.synced.stats.mean, 8);
  assert.equal(manifest.comparison.meanDelta, 6);
  assert.equal(manifest.comparison.materiallyBrighter, true);
  assert.equal(manifest.leimac.dutyPercent, 3);
  assert.equal(manifest.requestedExposureUs, 50000);
  assert.equal(manifest.safety.safeOffBefore, true);
  assert.equal(manifest.safety.safeOffAfter, true);
  assert.equal(manifest.safety.finalLightOffConfirmedByMark, true);
  assert.equal(manifest.calibration.isCalibrated, false);
  assert.equal(manifest.calibration.evidenceClass, "macro_sync_smoke_uncalibrated");
  assert.doesNotMatch(JSON.stringify(manifest).toLowerCase(), /certified grade|certified macro evidence|calibrated macro evidence/);
});

test("Basler/Leimac macro package manifest records accepted profile and artifacts", () => {
  const darkCapture = fakeCapture();
  const syncedCapture = {
    ...fakeCapture(),
    outputFilePath: path.join(os.tmpdir(), "full-rig-smoke", "synced.png"),
    byteSize: 4096,
    exposureTime: 50000,
  };
  const profilePlan = buildLeimacIdmuTriggerProfilePlan({
    dutyPercent: 5,
    triggerActivation: "LevelLow",
  });
  const manifest = buildBaslerLeimacMacroPackageManifest({
    status: "captured",
    packageId: "basler-leimac-macro-package-test",
    packageDir: path.join(os.tmpdir(), "full-rig-smoke", "macro"),
    leimacHost: "169.254.191.156",
    leimacPort: 1000,
    leimacProfilePlan: profilePlan,
    requestedExposureUs: 50000,
    dutyPercent: 5,
    darkControl: {
      capture: darkCapture,
      stats: {
        filePath: darkCapture.outputFilePath,
        width: 2448,
        height: 2048,
        channels: 1,
        min: 0,
        max: 8,
        mean: 0.2,
        nonZeroFraction: 0.08,
        brightFraction: 0,
      },
    },
    synced: {
      capture: syncedCapture,
      stats: {
        filePath: syncedCapture.outputFilePath,
        width: 2448,
        height: 2048,
        channels: 1,
        min: 0,
        max: 255,
        mean: 27.6,
        nonZeroFraction: 0.99,
        brightFraction: 0.18,
      },
    },
    supervised: true,
    safeOffBefore: true,
    safeOffAfter: true,
    finalLightOffConfirmedByMark: true,
  });

  assert.equal(manifest.lightingProfileId, ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID);
  assert.equal(manifest.selectedCandidate.id, "line2-inverter-level-low");
  assert.equal(manifest.basler.line2.lineInverter, true);
  assert.equal(manifest.leimac.triggerActivation, "LevelLow");
  assert.equal(manifest.leimac.dutyPercent, 5);
  assert.equal(manifest.darkControl.capture.outputFilePath, darkCapture.outputFilePath);
  assert.equal(manifest.synced.capture.outputFilePath, syncedCapture.outputFilePath);
  assert.equal(manifest.comparison.materiallyBrighter, true);
  assert.equal(manifest.macroEvidence.role, "macro_overview");
  assert.equal(manifest.calibration.isCalibrated, false);
  assert.equal(manifest.calibration.evidenceClass, "macro_sync_smoke_uncalibrated");
  assert.match(renderMacroPackageReport(manifest), /not calibrated production macro evidence/i);
  assert.doesNotMatch(JSON.stringify(manifest).toLowerCase(), /"iscalibrated":true|certificateid|certifiedgrading":true/);
});

test("Full-rig local smoke manifest separates Basler macro and Dino-Lite detail evidence", () => {
  const macroManifest = buildBaslerLeimacMacroPackageManifest({
    status: "planned",
    packageId: "macro",
    packageDir: path.join(os.tmpdir(), "full-rig-smoke", "macro"),
    leimacHost: "169.254.191.156",
    leimacPort: 1000,
    leimacProfilePlan: buildLeimacIdmuTriggerProfilePlan({ dutyPercent: 5, triggerActivation: "LevelLow" }),
    requestedExposureUs: 50000,
    dutyPercent: 5,
    supervised: false,
    safeOffBefore: false,
    safeOffAfter: false,
  });
  const fullRig = buildFullRigLocalSmokeManifest({
    packageId: "full-rig",
    packageDir: path.join(os.tmpdir(), "full-rig-smoke", "full-rig"),
    status: "completed",
    baslerMacro: macroManifest,
    dinoliteWorkflow: {
      adapter: "dnvideox",
      comActiveXInstantiated: true,
      sessionId: "session-1",
      label: "full-rig",
      plan: "experimental-card-grading",
      sessionDir: path.join(os.tmpdir(), "full-rig-smoke", "dinolite"),
      manifestPath: path.join(os.tmpdir(), "full-rig-smoke", "dinolite", "manifest.json"),
      previewReportPath: path.join(os.tmpdir(), "full-rig-smoke", "dinolite", "preview-report.html"),
      timestamp: "2026-06-29T05:00:00.000Z",
      status: "completed",
      device: { index: 0, name: "Dino-Lite" },
      connectedDuringCommand: true,
      previewDuringCommand: true,
      targets: [],
      forbiddenOperationsInvoked: false,
    },
    dinoliteAnalysis: { score: { status: "not_computed" } },
    finalLightOffConfirmedByMark: true,
  });

  assert.equal(fullRig.baslerMacro.manifest.lightingProfileId, "line2-inverter-level-low-v0");
  assert.equal(fullRig.dinoliteDetail.plan, "experimental-card-grading");
  assert.equal(fullRig.dinoliteDetail.evidenceRole, "detail_corners_edges_surface");
  assert.equal(fullRig.analysisRouting.macroOverviewSource, "basler_leimac");
  assert.equal(fullRig.analysisRouting.centeringInput, "basler_preferred_not_routed_to_score_v0");
  assert.equal(fullRig.safety.productionUpload, false);
  assert.equal(fullRig.safety.databaseWrites, false);
  assert.equal(fullRig.calibration.isCalibrated, false);
  assert.match(renderFullRigReport(fullRig), /Local\/offline uncalibrated evidence package only/i);
  assert.doesNotMatch(JSON.stringify(fullRig).toLowerCase(), /"iscalibrated":true|certificateid|certifiedgrading":true/);
});

test("Basler/Leimac polarity smoke CLI rejects unsafe diagnostic inputs before hardware", async () => {
  const tooHighDuty = await runCli(["basler-leimac-polarity-smoke", "--duty", "6"]);
  assert.equal(tooHighDuty.code, 1);
  assert.match(tooHighDuty.stderr.error, /capped at 5%/);

  const repoOutput = await runCli([
    "basler-leimac-polarity-smoke",
    "--capture-confirmed",
    "--output-dir",
    process.cwd(),
  ]);
  assert.equal(repoOutput.code, 1);
  assert.match(repoOutput.stderr.error, /outside the git repo/);

  const missingSupervision = await runCli([
    "basler-leimac-polarity-smoke",
    "--leimac-host",
    "169.254.191.156",
    "--apply",
    "--confirm",
    BASLER_LEIMAC_POLARITY_SMOKE_CONFIRMATION,
  ]);
  assert.equal(missingSupervision.code, 1);
  assert.match(missingSupervision.stderr.error, /--mark-present/);
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

test("Basler Line2 pulse and image-stat sync CLIs reject unsafe inputs before hardware", async () => {
  const pulseMissingMark = await runCli([
    "basler-line2-user-output-pulse",
    "--leimac-host",
    "169.254.191.156",
    "--apply",
    "--confirm",
    "RUN BASLER LINE2 USER OUTPUT PULSE",
  ]);
  assert.equal(pulseMissingMark.code, 1);
  assert.match(pulseMissingMark.stderr.error, /--mark-present/);

  const pulseInvalidMs = await runCli([
    "basler-line2-user-output-pulse",
    "--pulse-ms",
    "100",
  ]);
  assert.equal(pulseInvalidMs.code, 1);
  assert.match(pulseInvalidMs.stderr.error, /250 to 500/);

  const repoOutput = await runCli([
    "basler-leimac-image-stat-sync-smoke",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    process.cwd(),
    "--apply",
    "--confirm",
    BASLER_LEIMAC_IMAGE_STAT_SYNC_SMOKE_CONFIRMATION,
    "--mark-present",
    "--wiring-confirmed",
    "--leimac-status-green",
    "--operator-confirmed-light-idle-off",
  ]);
  assert.equal(repoOutput.code, 1);
  assert.match(repoOutput.stderr.error, /outside the git repo/);

  const missingSupervision = await runCli([
    "basler-leimac-image-stat-sync-smoke",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    path.join(os.tmpdir(), "basler-leimac-sync"),
    "--apply",
    "--confirm",
    BASLER_LEIMAC_IMAGE_STAT_SYNC_SMOKE_CONFIRMATION,
  ]);
  assert.equal(missingSupervision.code, 1);
  assert.match(missingSupervision.stderr.error, /--mark-present/);

  const highDuty = await runCli(["basler-leimac-image-stat-sync-smoke", "--duty", "6"]);
  assert.equal(highDuty.code, 1);
  assert.match(highDuty.stderr.error, /capped at 5%/);
});

test("Basler macro package and full-rig CLIs reject unsafe inputs before hardware", async () => {
  const macroDryRun = await runCli([
    "basler-leimac-macro-package",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    path.join(os.tmpdir(), "full-rig-smoke"),
  ]);
  assert.equal(macroDryRun.code, 0);
  assert.equal(macroDryRun.stdout.dryRun, true);
  assert.equal(macroDryRun.stdout.manifest.lightingProfileId, "line2-inverter-level-low-v0");

  const macroRepoOutput = await runCli([
    "basler-leimac-macro-package",
    "--output-dir",
    process.cwd(),
  ]);
  assert.equal(macroRepoOutput.code, 1);
  assert.match(macroRepoOutput.stderr.error, /outside the git repo/);

  const macroMissingConfirmation = await runCli([
    "basler-leimac-macro-package",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    path.join(os.tmpdir(), "full-rig-smoke"),
    "--apply",
    "--mark-present",
    "--wiring-confirmed",
    "--leimac-status-green",
    "--operator-confirmed-light-idle-off",
  ]);
  assert.equal(macroMissingConfirmation.code, 1);
  assert.match(macroMissingConfirmation.stderr.error, new RegExp(BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION));

  const highDuty = await runCli(["basler-leimac-macro-package", "--duty", "6"]);
  assert.equal(highDuty.code, 1);
  assert.match(highDuty.stderr.error, /capped at 5%/);

  const fullRigDryRun = await runCli([
    "ai-grader-full-rig-local-smoke",
    "--output-dir",
    path.join(os.tmpdir(), "full-rig-smoke"),
    "--basler-duty",
    "5",
    "--basler-exposure-us",
    "50000",
    "--dinolite-plan",
    "experimental-card-grading",
  ]);
  assert.equal(fullRigDryRun.code, 0);
  assert.equal(fullRigDryRun.stdout.dryRun, true);
  assert.equal(fullRigDryRun.stdout.manifest.baslerMacro.manifest.lightingProfileId, "line2-inverter-level-low-v0");
  assert.equal(fullRigDryRun.stdout.manifest.safety.productionUpload, false);

  const fullRigRepoOutput = await runCli([
    "ai-grader-full-rig-local-smoke",
    "--output-dir",
    process.cwd(),
  ]);
  assert.equal(fullRigRepoOutput.code, 1);
  assert.match(fullRigRepoOutput.stderr.error, /outside the git repo/);

  const fullRigMissingConfirmation = await runCli([
    "ai-grader-full-rig-local-smoke",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    path.join(os.tmpdir(), "full-rig-smoke"),
    "--apply",
    "--mark-present",
    "--wiring-confirmed",
    "--leimac-status-green",
    "--operator-confirmed-light-idle-off",
  ]);
  assert.equal(fullRigMissingConfirmation.code, 1);
  assert.match(fullRigMissingConfirmation.stderr.error, new RegExp(AI_GRADER_FULL_RIG_LOCAL_SMOKE_CONFIRMATION));
});

test("Fixed-rig lighting profile plan is dry-run and does not invent channel mapping", async () => {
  const plan = buildFixedRigLightingProfilePlan();
  assert.equal(plan.dryRun, true);
  assert.equal(plan.selectedLightingProfile, "line2-inverter-level-low-v0");
  assert.equal(plan.channelMappingStatus, "unknown");
  assert.equal(plan.safety.writesApplied, false);
  assert.equal(plan.safety.lightsCommanded, false);
  assert.equal(plan.safety.channelPhysicalMappingInvented, false);
  assert.equal(plan.profiles.some((profile) => profile.id === "surface-scratch-low-angle-candidate-v0"), true);

  const cli = await runCli(["fixed-rig-lighting-profile-plan"]);
  assert.equal(cli.code, 0);
  assert.equal(cli.stdout.plan.dryRun, true);
  assert.equal(cli.stdout.plan.channelMappingStatus, "unknown");
});

test("Fixed-rig focus assist manifest reports manual focus metrics without autofocus claims", () => {
  const macroManifest = buildBaslerLeimacMacroPackageManifest({
    status: "captured",
    packageId: "macro",
    packageDir: path.join(os.tmpdir(), "fixed-rig-v1", "macro"),
    leimacHost: "169.254.191.156",
    leimacPort: 1000,
    leimacProfilePlan: buildLeimacIdmuTriggerProfilePlan({ dutyPercent: 5, triggerActivation: "LevelLow" }),
    requestedExposureUs: 50000,
    dutyPercent: 5,
    synced: {
      capture: fakeCapture(),
      stats: fakeFixedRigQuality(),
    },
    supervised: true,
    safeOffBefore: true,
    safeOffAfter: true,
  });
  const manifest = buildFixedRigFocusAssistManifest({
    packageId: "focus",
    packageDir: path.join(os.tmpdir(), "fixed-rig-v1", "focus"),
    status: "captured",
    macroPackage: macroManifest,
    quality: fakeFixedRigQuality(),
    safeOffBefore: true,
    safeOffAfter: true,
  });

  assert.equal(manifest.operatorGuidance.manualFocusOnly, true);
  assert.equal(manifest.operatorGuidance.autofocusClaimed, false);
  assert.equal(manifest.calibrationProfile.isCalibrated, false);
  assert.equal(manifest.calibrationProfile.calibrationStatus, "framing_assisted");
  assert.equal(manifest.calibrationProfile.pixelToMmEstimateStatus, "estimated_uncalibrated");
  assert.equal(manifest.calibrationProfile.focusLockedByOperator, false);
  assert.equal(manifest.roiDefinitions.some((roi) => roi.id === "full-card" && roi.status === "computed"), true);
  assert.equal(manifest.suggestedDinoLiteTargets.status, "not_computed");
  assert.equal(manifest.quality.sharpnessScore, 42);
  assert.equal(manifest.quality.cardBoundary.status, "detected");
  assert.equal(manifest.safety.persistentBaslerSaved, false);
  assert.equal(manifest.safety.persistentLeimacSaved, false);
  assert.match(renderFixedRigFocusAssistReport(manifest), /Manual focus assist only/i);
  assert.doesNotMatch(JSON.stringify(manifest).toLowerCase(), /autofocusclaimed":true|"iscalibrated":true|certifiedgrading":true/);
});

test("Fixed-rig calibration profile defaults are uncalibrated and estimate pixel scale only with boundary", () => {
  const withoutBoundary = buildFixedRigCalibrationProfile({
    profileId: "profile-no-boundary",
    imageWidth: 2448,
    imageHeight: 2048,
  });
  assert.equal(withoutBoundary.isCalibrated, false);
  assert.equal(withoutBoundary.lensDistortionCalibrated, false);
  assert.equal(withoutBoundary.lightingCalibrated, false);
  assert.equal(withoutBoundary.focusLockedByOperator, false);
  assert.equal(withoutBoundary.pixelToMmEstimateStatus, "not_computed");
  assert.equal(withoutBoundary.cameraSerialRedacted, true);

  const withBoundary = buildFixedRigCalibrationProfile({
    profileId: "profile-boundary",
    cardBoundary: fakeFixedRigQuality().cardBoundary,
    focusLockedByOperator: true,
    calibrationStatus: "focus_assisted",
  });
  assert.equal(withBoundary.isCalibrated, false);
  assert.equal(withBoundary.focusLockedByOperator, true);
  assert.equal(withBoundary.calibrationStatus, "focus_assisted");
  assert.equal(withBoundary.pixelToMmEstimateStatus, "estimated_uncalibrated");
  assert.equal(withBoundary.pixelToMmEstimateX, 0.03175);
  assert.equal(withBoundary.pixelToMmEstimateY, 0.052294);
});

test("Fixed-rig operator preview manifest is snapshot/manual and keeps overlays out of raw evidence", async () => {
  const preview = buildFixedRigOperatorPreviewManifest({
    packageId: "preview",
    packageDir: path.join(os.tmpdir(), "fixed-rig-calibration", "preview"),
    status: "preview_captured",
    previewCapture: fakeCapture(),
    quality: fakeFixedRigQuality(),
    focusLockedByOperator: true,
    overlayPreview: {
      kind: "preview_overlay",
      outputFilePath: path.join(os.tmpdir(), "fixed-rig-calibration", "preview", "operator-preview-overlay.png"),
      sha256: "a".repeat(64),
      byteSize: 1234,
      mimeType: "image/png",
      imageWidth: 2448,
      imageHeight: 2048,
      rawEvidenceUnmodified: true,
      overlaysBakedIntoRawEvidence: false,
      note: "Overlay only.",
    },
  });
  assert.equal(preview.mode, "snapshot_preview");
  assert.equal(preview.startAiGradingAutomatically, false);
  assert.equal(preview.safety.leimacRequired, false);
  assert.equal(preview.safety.leimacEngaged, false);
  assert.equal(preview.safety.overlaysBakedIntoRawEvidence, false);
  assert.equal(preview.calibrationProfile.focusLockedByOperator, true);
  assert.match(preview.readiness.uncalibratedGridWarning, /uncalibrated/i);
  assert.match(renderFixedRigOperatorPreviewReport(preview), /Start AI-Grading \/ Continue/i);

  const dryRun = await runCli([
    "basler-fixed-rig-operator-preview",
    "--output-dir",
    path.join(os.tmpdir(), "fixed-rig-calibration"),
    "--exposure-us",
    "45000",
    "--gain",
    "0",
  ]);
  assert.equal(dryRun.code, 0);
  assert.equal(dryRun.stdout.dryRun, true);
  assert.equal(dryRun.stdout.manifest.safety.leimacRequired, false);

  const missingOperatorMode = await runCli([
    "basler-fixed-rig-operator-preview",
    "--output-dir",
    path.join(os.tmpdir(), "fixed-rig-calibration"),
    "--apply",
    "--confirm",
    BASLER_FIXED_RIG_OPERATOR_PREVIEW_CONFIRMATION,
    "--mark-present",
  ]);
  assert.equal(missingOperatorMode.code, 1);
  assert.match(missingOperatorMode.stderr.error, /--operator-mode/);
});

test("Leimac channel characterization plan defaults to eight numeric channels and unknown mapping", async () => {
  const manifest = buildLeimacChannelCharacterizationManifest({
    packageId: "channels",
    packageDir: path.join(os.tmpdir(), "fixed-rig-calibration", "channels"),
    status: "planned",
  });
  assert.equal(manifest.dutyPercent, 1);
  assert.equal(manifest.dutySteps, 10);
  assert.equal(manifest.channels.length, 8);
  assert.equal(manifest.channels[0].label, "channel 1");
  assert.equal(manifest.channelToPhysicalMappingStatus, "unknown");
  assert.equal(manifest.safety.safeOffBeforeEachChannel, true);
  assert.equal(manifest.safety.safeOffAfterEachChannel, true);
  assert.equal(manifest.safety.channelPhysicalMappingInvented, false);
  assert.equal(manifest.calibrationProfile.isCalibrated, false);
  assert.match(renderLeimacChannelCharacterizationReport(manifest), /physical mapping is unknown/i);

  const channelOneFrames = buildLeimacCharacterizationFrames({ channel: 1, dutyPercent: 1 });
  const outputValue = channelOneFrames.filter((frame) => frame.name === "lightingOutputValue").at(-1);
  assert.equal(outputValue.channelValues[0].value, "0010");
  assert.equal(outputValue.channelValues.slice(1).every((entry) => entry.value === "0000"), true);

  const dryRun = await runCli([
    "leimac-channel-characterization",
    "--output-dir",
    path.join(os.tmpdir(), "fixed-rig-calibration"),
  ]);
  assert.equal(dryRun.code, 0);
  assert.equal(dryRun.stdout.dryRun, true);
  assert.equal(dryRun.stdout.manifest.channels.length, 8);
  assert.equal(dryRun.stdout.manifest.dutyPercent, 1);
});

test("Fixed-rig V1 manifest routes Basler first and reports not_computed on boundary failure", () => {
  const macroManifest = buildBaslerLeimacMacroPackageManifest({
    status: "captured",
    packageId: "macro",
    packageDir: path.join(os.tmpdir(), "fixed-rig-v1", "macro"),
    leimacHost: "169.254.191.156",
    leimacPort: 1000,
    leimacProfilePlan: buildLeimacIdmuTriggerProfilePlan({ dutyPercent: 5, triggerActivation: "LevelLow" }),
    requestedExposureUs: 50000,
    dutyPercent: 5,
    darkControl: {
      capture: fakeCapture(),
      stats: fakeFixedRigQuality({ mean: 0.3, max: 8 }),
    },
    synced: {
      capture: { ...fakeCapture(), outputFilePath: path.join(os.tmpdir(), "fixed-rig-v1", "front.png") },
      stats: fakeFixedRigQuality(),
    },
    supervised: true,
    safeOffBefore: true,
    safeOffAfter: true,
  });
  const failedBoundaryQuality = fakeFixedRigQuality({
    cardBoundary: {
      status: "not_computed",
      confidence: 0,
      reason: "No reliable bright foreground boundary found.",
    },
    warnings: ["Card boundary was not computed; ROI screening remains not_computed."],
  });
  const side = buildFixedRigSideCapture({
    side: "front",
    macroPackage: macroManifest,
    quality: failedBoundaryQuality,
  });
  const manifest = buildFixedRigV1LocalManifest({
    packageId: "fixed-rig",
    packageDir: path.join(os.tmpdir(), "fixed-rig-v1", "run"),
    status: "completed",
    front: side,
    back: side,
  });

  assert.equal(manifest.workflow.mode, "fixed_overhead_basler_v1");
  assert.equal(manifest.workflow.baslerRole, "primary_macro_overview_measurement_screening");
  assert.equal(manifest.workflow.dinoliteRole, "optional_manual_detail_confirmation");
  assert.equal(manifest.workflow.automationNotRequiredForV1.includes("dobot"), true);
  assert.equal(manifest.front.analysis.status, "not_computed");
  assert.match(manifest.front.analysis.notComputedReason, /boundary was not computed/);
  assert.equal(manifest.front.roiDefinitions.every((roi) => roi.status === "not_computed"), true);
  assert.equal(manifest.followUpPlan.status, "not_computed");
  assert.equal(manifest.calibration.evidenceClass, "macro_fixed_rig_v1_uncalibrated");
  assert.equal(manifest.safety.productionUpload, false);
  assert.equal(manifest.safety.databaseWrites, false);
  assert.match(renderFixedRigV1Report(manifest), /Basler is primary macro measurement\/screening evidence/i);
  assert.doesNotMatch(JSON.stringify(manifest).toLowerCase(), /"iscalibrated":true|certificateid|certifiedgrading":true/);
});

test("Fixed-rig V1 CLIs reject unsafe inputs before hardware", async () => {
  const outputDir = path.join(os.tmpdir(), "fixed-rig-v1");

  const focusDryRun = await runCli([
    "basler-fixed-rig-focus-assist",
    "--output-dir",
    outputDir,
    "--duty",
    "5",
  ]);
  assert.equal(focusDryRun.code, 0);
  assert.equal(focusDryRun.stdout.dryRun, true);
  assert.equal(focusDryRun.stdout.manifest.operatorGuidance.manualFocusOnly, true);

  const focusRepoOutput = await runCli([
    "basler-fixed-rig-focus-assist",
    "--output-dir",
    process.cwd(),
  ]);
  assert.equal(focusRepoOutput.code, 1);
  assert.match(focusRepoOutput.stderr.error, /outside the git repo/);

  const focusMissingConfirmation = await runCli([
    "basler-fixed-rig-focus-assist",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    outputDir,
    "--apply",
    "--mark-present",
    "--wiring-confirmed",
    "--leimac-status-green",
    "--operator-confirmed-light-idle-off",
  ]);
  assert.equal(focusMissingConfirmation.code, 1);
  assert.match(focusMissingConfirmation.stderr.error, new RegExp(BASLER_FIXED_RIG_FOCUS_ASSIST_CONFIRMATION));

  const focusHighDuty = await runCli(["basler-fixed-rig-focus-assist", "--duty", "6"]);
  assert.equal(focusHighDuty.code, 1);
  assert.match(focusHighDuty.stderr.error, /capped at 5%/);

  const fixedRigDryRun = await runCli([
    "ai-grader-fixed-rig-v1-local",
    "--output-dir",
    outputDir,
  ]);
  assert.equal(fixedRigDryRun.code, 0);
  assert.equal(fixedRigDryRun.stdout.dryRun, true);
  assert.equal(fixedRigDryRun.stdout.manifest.workflow.mode, "fixed_overhead_basler_v1");

  const fixedRigRepoOutput = await runCli([
    "ai-grader-fixed-rig-v1-local",
    "--output-dir",
    process.cwd(),
  ]);
  assert.equal(fixedRigRepoOutput.code, 1);
  assert.match(fixedRigRepoOutput.stderr.error, /outside the git repo/);

  const fixedRigMissingConfirmation = await runCli([
    "ai-grader-fixed-rig-v1-local",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    outputDir,
    "--apply",
    "--mark-present",
    "--wiring-confirmed",
    "--leimac-status-green",
    "--operator-confirmed-light-idle-off",
    "--operator-flip-confirmed",
  ]);
  assert.equal(fixedRigMissingConfirmation.code, 1);
  assert.match(fixedRigMissingConfirmation.stderr.error, new RegExp(AI_GRADER_FIXED_RIG_V1_CONFIRMATION));

  const fixedRigMissingFlip = await runCli([
    "ai-grader-fixed-rig-v1-local",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    outputDir,
    "--apply",
    "--confirm",
    AI_GRADER_FIXED_RIG_V1_CONFIRMATION,
    "--mark-present",
    "--wiring-confirmed",
    "--leimac-status-green",
    "--operator-confirmed-light-idle-off",
  ]);
  assert.equal(fixedRigMissingFlip.code, 1);
  assert.match(fixedRigMissingFlip.stderr.error, /--operator-flip-confirmed/);

  const fixedRigInvalidFlipDelay = await runCli([
    "ai-grader-fixed-rig-v1-local",
    "--operator-flip-delay-ms",
    "300001",
  ]);
  assert.equal(fixedRigInvalidFlipDelay.code, 1);
  assert.match(fixedRigInvalidFlipDelay.stderr.error, /--operator-flip-delay-ms/);

  const fixedRigHighDuty = await runCli(["ai-grader-fixed-rig-v1-local", "--duty", "6"]);
  assert.equal(fixedRigHighDuty.code, 1);
  assert.match(fixedRigHighDuty.stderr.error, /capped at 5%/);

  const channelRepoOutput = await runCli([
    "leimac-channel-characterization",
    "--output-dir",
    process.cwd(),
  ]);
  assert.equal(channelRepoOutput.code, 1);
  assert.match(channelRepoOutput.stderr.error, /outside the git repo/);

  const channelHighDuty = await runCli([
    "leimac-channel-characterization",
    "--duty",
    "6",
  ]);
  assert.equal(channelHighDuty.code, 1);
  assert.match(channelHighDuty.stderr.error, /0 to 5|capped at 5%/);

  const channelMissingConfirmation = await runCli([
    "leimac-channel-characterization",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    outputDir,
    "--apply",
    "--mark-present",
    "--wiring-confirmed",
    "--leimac-status-green",
    "--operator-confirmed-light-idle-off",
  ]);
  assert.equal(channelMissingConfirmation.code, 1);
  assert.match(channelMissingConfirmation.stderr.error, new RegExp(LEIMAC_CHANNEL_CHARACTERIZATION_CONFIRMATION));

  const channelMissingMark = await runCli([
    "leimac-channel-characterization",
    "--leimac-host",
    "169.254.191.156",
    "--output-dir",
    outputDir,
    "--apply",
    "--confirm",
    LEIMAC_CHANNEL_CHARACTERIZATION_CONFIRMATION,
  ]);
  assert.equal(channelMissingMark.code, 1);
  assert.match(channelMissingMark.stderr.error, /--mark-present/);
});
