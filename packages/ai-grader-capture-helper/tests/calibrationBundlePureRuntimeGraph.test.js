const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("the exact calibration-bundle package export loads and validates without native or hardware modules", () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const frontendRoot = path.join(repositoryRoot, "frontend", "nextjs-app");
  const child = spawnSync(process.execPath, ["-e", String.raw`
    const assert = require("node:assert/strict");
    const Module = require("node:module");
    const path = require("node:path");
    const originalResolve = Module._resolveFilename;
    const resolvedModules = new Set();
    const bannedRequestNames = new Set(["sharp", "serialport"]);
    const bannedModuleNames = [
      "cardgeometry.",
      "fixedrigmathematicalcalibrationcapturev1.",
      "fixedrigfastcalibrationmathv1_2.",
      "fixedrigfastcalibrationevidenceanalyzerv1_2.",
      "aigraderlocalstationbridge.",
      "baslerfixedrigv1.",
      "baslerleimacfullrig.",
      "baslerleimacmathematicalcalibrationsessionv1_2.",
      "baslerleimacsync.",
      "baslerpylonclient.",
      "fixedriglightdirectioncalibration.",
      "leimacidmuclient.",
      "serialtransport.",
    ];
    Module._resolveFilename = function(request, parent, isMain, options) {
      const resolved = originalResolve.call(this, request, parent, isMain, options);
      const normalizedRequest = String(request).toLowerCase();
      const normalizedResolved = String(resolved).replaceAll("\\", "/").toLowerCase();
      if (bannedRequestNames.has(normalizedRequest) ||
          bannedModuleNames.some((name) => normalizedResolved.includes("/" + name))) {
        throw new Error("BANNED_CALIBRATION_BUNDLE_RUNTIME_MODULE:" + request + ":" + resolved);
      }
      resolvedModules.add(normalizedResolved);
      return resolved;
    };

    const calibrationBundle = require("@tenkings/ai-grader-capture-helper/calibration-bundle");
    assert.equal(typeof calibrationBundle.loadFixedRigMathematicalCalibrationBundleV1, "function");
    assert.throws(
      () => calibrationBundle.loadFixedRigMathematicalCalibrationBundleV1({
        bundlePath: path.join(
          process.cwd(),
          "intentionally-absent-calibration-bundle",
          "mathematical-calibration-bundle-v1.json",
        ),
        bundleSha256: "0".repeat(64),
        expectedRigId: "fixed-rig-dell-v1",
      }),
      (error) => error && error.code === "ENOENT",
    );
    process.stdout.write(JSON.stringify({ loadedModuleCount: resolvedModules.size }));
  `], {
    cwd: frontendRoot,
    encoding: "utf8",
    windowsHide: true,
  });

  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.signal, null);
  const result = JSON.parse(child.stdout);
  assert.ok(result.loadedModuleCount > 0);
});

test("the capture implementation preserves the exact package and profile compatibility exports", () => {
  const contract = require("../dist/drivers/fixedRigMathematicalCalibrationCaptureContractV1");
  const capture = require("../dist/drivers/fixedRigMathematicalCalibrationCaptureV1");
  assert.equal(
    contract.FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PACKAGE_V1,
    "ten-kings-mathematical-calibration-capture-package-v1",
  );
  assert.equal(
    contract.FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
    "ten-kings-fixed-rig-mathematical-calibration-v1",
  );
  assert.equal(
    capture.FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PACKAGE_V1,
    contract.FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PACKAGE_V1,
  );
  assert.equal(
    capture.FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
    contract.FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
  );
});
