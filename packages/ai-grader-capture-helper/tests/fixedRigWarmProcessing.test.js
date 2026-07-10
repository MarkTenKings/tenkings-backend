const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { processFixedRigWarmSideBatch } = require("../dist/drivers/baslerFixedRigV1");

async function makeCardTiff(filePath) {
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="500" height="700">
      <rect width="500" height="700" fill="#16191d"/>
      <g transform="translate(260 345) rotate(7)">
        <rect x="-150" y="-210" width="300" height="420" rx="5" fill="#f1efe8"/>
        <rect x="-125" y="-175" width="250" height="350" fill="#8b6b35"/>
      </g>
    </svg>
  `);
  await sharp(svg).tiff({ compression: "none" }).toFile(filePath);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function capture(filePath, label, timestamp, index) {
  const bytes = fs.statSync(filePath).size;
  return {
    outputFilePath: filePath,
    sha256: sha256(filePath),
    byteSize: bytes,
    mimeType: "image/tiff",
    timestamp,
    camera: { modelName: "synthetic-basler" },
    imageWidth: 500,
    imageHeight: 700,
    sourcePixelFormat: "Mono8",
    savedImageFormat: "TIFF",
    exposureTime: 45000,
    gain: 0,
    transport: "GigE",
    pylon: {},
    calibration: {
      isCalibrated: false,
      calibrationProfileId: null,
      cameraRole: "macro_overview",
      evidenceClass: "macro_raw_smoke",
      coordinateFrame: "basler_sensor_pixels",
    },
    timing: {
      grab: { durationMs: 110 + index },
      save: { durationMs: 75 + index },
      hash: { durationMs: 3 },
    },
    note: label,
  };
}

test("production_fast warm processing preserves all forensic roles and writes geometry, normalized, and timing artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-fast-warm-processing-"));
  const packageDir = path.join(root, "package-front");
  const sideDir = path.join(packageDir, "front");
  fs.mkdirSync(sideDir, { recursive: true });
  const rawPath = path.join(sideDir, "front-all-roles.tiff");
  await makeCardTiff(rawPath);
  const rawBefore = fs.readFileSync(rawPath);
  const timestamp = "2026-07-09T20:00:00.000Z";
  const roles = Array.from({ length: 11 }, (_, index) => capture(rawPath, `role-${index}`, timestamp, index));
  const role = (name, label, captureValue, channel) => ({ role: name, label, ...(channel !== undefined ? { channel } : {}), capture: captureValue });

  const result = await processFixedRigWarmSideBatch({
    executionPath: "warm_full_forensic_runner",
    fallbackUsed: false,
    packageId: "synthetic-fast-front",
    packageDir,
    sideDir,
    side: "front",
    captureProfile: "production_fast",
    rawEvidenceFormat: "tiff",
    hardwareMeasurement: false,
    activeLightingProfile: {
      profileId: "synthetic-profile",
      profileVersion: "fixed-rig-active-lighting-profile-v0.1",
      selectedDutyPercent: 1.2,
      actualLeimacPwmStep: 12,
      selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
      profileSource: "default",
      acceptedAt: timestamp,
      resetToDefault: false,
      selectedLightingProfileId: "line2-inverter-level-low-v0",
      selectedPolarity: { baslerLineInverter: true, leimacTriggerActivation: "LevelLow" },
      persistentLeimacSaved: false,
      note: "synthetic",
    },
    batch: {
      executionPath: "warm_full_forensic_runner",
      fallbackUsed: false,
      side: "front",
      outputDir: sideDir,
      cameraIndex: 0,
      openedAt: "2026-07-09T20:00:00.000Z",
      finishedAt: "2026-07-09T20:00:06.000Z",
      persistentBaslerSession: true,
      persistentLeimacSession: true,
      selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
      dutyTenthsPercent: 12,
      capturesStarted: true,
      leimac: { triggerSetup: { writes: [] } },
      captures: {
        darkControl: role("dark_control", "front-dark", roles[0]),
        allOn: role("all_on", "front-all-on", roles[1], "all"),
        acceptedProfile: role("accepted_profile", "front-profile", roles[2], [1, 2, 3, 4, 5, 6, 7, 8]),
        channels: roles.slice(3).map((captureValue, index) => role(`channel_${index + 1}`, `front-channel-${index + 1}`, captureValue, index + 1)),
      },
      timing: { warmCameraOpenConfigure: { durationMs: 450 } },
      safety: { safeOffBefore: true, safeOffAfter: true },
      note: "synthetic",
    },
    exposureUs: 45000,
    gain: 0,
  });

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.captureProfile, "production_fast");
  assert.equal(manifest.captureProfilePlan.rawEvidenceFormat, "tiff");
  assert.equal(manifest.captureProfilePlan.evidenceRoles, "full_forensic");
  assert.equal(manifest.front.channels.length, 8);
  assert.equal(manifest.front.normalizedCard.geometry.side, "front");
  assert.equal(manifest.front.normalizedCard.geometry.detectionUsed, true);
  assert.equal(manifest.front.normalizedCard.rawEvidencePreserved, true);
  assert.equal(fs.existsSync(manifest.front.normalizedCard.normalizedArtifact.localOutputPath), true);
  assert.equal(manifest.captureTiming.frameCaptureMs > 0, true);
  assert.equal(manifest.captureTiming.fileWritesMs > 0, true);
  assert.equal(manifest.captureTiming.totalSideMs, 6000);
  assert.equal(manifest.captureTiming.targetProven, false);
  assert.equal(manifest.captureTiming.hardwareMeasurement, false);
  assert.equal(manifest.captureTiming.hardwareMeasurementRequired, true);
  assert.equal(manifest.processingTiming.frontProcessingMayOverlapFlip, true);
  assert.deepEqual(fs.readFileSync(rawPath), rawBefore);
});
