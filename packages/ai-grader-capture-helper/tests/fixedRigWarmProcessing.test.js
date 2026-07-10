const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const {
  buildFixedRigSurfaceAnalysis,
  createUnifiedFixedRigDiagnosticCardReport,
  processFixedRigWarmSideBatch,
} = require("../dist/drivers/baslerFixedRigV1");
const { buildAiGraderReportBundle } = require("../dist/drivers/aiGraderReportBundle");
const { buildAiGraderProductionRelease } = require("../dist/drivers/aiGraderProductionRelease");
const { buildFixedRigProvisionalGradeStory } = require("../dist/drivers/fixedRigProvisionalGradeStory");

async function makeCardTiff(filePath, options = {}) {
  const centerX = 700 + (options.offsetX ?? 10);
  const centerY = 980 + (options.offsetY ?? -5);
  const angle = options.angle ?? 7;
  const directionalPatch = Number.isInteger(options.directionalChannel)
    ? `<rect x="-410" y="-600" width="240" height="260" fill="rgb(${35 + options.directionalChannel * 27}, ${35 + options.directionalChannel * 27}, ${35 + options.directionalChannel * 27})"/>`
    : "";
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1960">
      <rect width="1400" height="1960" fill="#16191d"/>
      <g transform="translate(${centerX} ${centerY}) rotate(${angle})">
        <rect x="-525" y="-735" width="1050" height="1470" rx="8" fill="#f1efe8"/>
        <rect x="-440" y="-620" width="880" height="1240" fill="#8b6b35"/>
        ${directionalPatch}
      </g>
    </svg>
  `);
  await sharp(svg).tiff({ compression: "none" }).toFile(filePath);
}

async function makeBlankTiff(filePath) {
  await sharp({ create: { width: 1400, height: 1960, channels: 3, background: "#202226" } })
    .tiff({ compression: "none" })
    .toFile(filePath);
}

async function makeSmallCardTiff(filePath) {
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="500" height="700">
      <rect width="500" height="700" fill="#16191d"/>
      <rect x="100" y="140" width="300" height="420" rx="5" fill="#f1efe8"/>
      <rect x="125" y="175" width="250" height="350" fill="#8b6b35"/>
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
    imageWidth: 1400,
    imageHeight: 1960,
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

function warmBatchInput({ packageId, packageDir, sideDir, rawPath, rolePaths, side = "front", cardBoundaryRect, manualGeometryOverride }) {
  const timestamp = "2026-07-09T20:00:00.000Z";
  const roles = Array.from(
    { length: 11 },
    (_, index) => capture(rolePaths?.[index] ?? rawPath, `role-${index}`, timestamp, index),
  );
  const role = (name, label, captureValue, channel) => ({
    role: name,
    label,
    ...(channel !== undefined ? { channel } : {}),
    capture: captureValue,
  });
  return {
    executionPath: "warm_full_forensic_runner",
    packageId,
    packageDir,
    sideDir,
    side,
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
      side,
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
        darkControl: role("dark_control", `${side}-dark`, roles[0]),
        allOn: role("all_on", `${side}-all-on`, roles[1], "all"),
        acceptedProfile: role("accepted_profile", `${side}-profile`, roles[2], [1, 2, 3, 4, 5, 6, 7, 8]),
        channels: roles.slice(3).map((captureValue, index) =>
          role(`channel_${index + 1}`, `${side}-channel-${index + 1}`, captureValue, index + 1)
        ),
      },
      timing: { warmCameraOpenConfigure: { durationMs: 450 } },
      safety: { safeOffBefore: true, safeOffAfter: true },
      note: "synthetic",
    },
    exposureUs: 45000,
    gain: 0,
    ...(cardBoundaryRect ? { cardBoundaryRect } : {}),
    ...(manualGeometryOverride ? { manualGeometryOverride } : {}),
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
  const result = await processFixedRigWarmSideBatch(warmBatchInput({
    packageId: "synthetic-fast-front",
    packageDir,
    sideDir,
    rawPath,
    // A configured fixture rectangle is not permission to override automatic
    // geometry. It must be ignored unless manualGeometryOverride is explicit.
    cardBoundaryRect: { x: 10, y: 10, width: 100, height: 140 },
  }));

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.captureProfile, "production_fast");
  assert.equal(manifest.captureProfilePlan.rawEvidenceFormat, "tiff");
  assert.equal(manifest.captureProfilePlan.evidenceRoles, "full_forensic");
  assert.deepEqual(manifest.captureProfilePlan.availableCaptureProfiles, ["full_forensic", "production_fast"]);
  assert.equal(manifest.captureProfilePlan.previousStableProfile, "full_forensic");
  assert.equal(manifest.captureProfilePlan.productionFastOptIn, true);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.captureProfilePlan, "fullForensicFallback"), false);
  assert.equal(manifest.front.channels.length, 8);
  assert.equal(manifest.front.normalizedCard.geometry.side, "front");
  assert.equal(manifest.front.normalizedCard.geometry.geometrySource, "detected");
  assert.equal(manifest.front.normalizedCard.geometry.captureMode, "automatic_detection");
  assert.equal(manifest.front.normalizedCard.geometry.detectionUsed, true);
  assert.equal(manifest.front.normalizedCard.geometry.manualOverrideUsed, false);
  assert.equal(manifest.geometryPolicy.legacyCardBoundaryRectIgnored, true);
  assert.equal(manifest.geometryPolicy.normalizedArtifactCreated, true);
  assert.equal(manifest.front.normalizedCard.rawEvidencePreserved, true);
  assert.equal(fs.existsSync(manifest.front.normalizedCard.normalizedArtifact.localOutputPath), true);
  assert.equal(manifest.analysisCoordinateSystem.coordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(manifest.analysisCoordinateSystem.authoritativeGeometryRole, "all_on");
  assert.equal(manifest.analysisCoordinateSystem.acquisitionPlacementExcludedFromGrade, true);
  assert.equal(
    manifest.analysisCoordinateSystem.sourceGeometry.confidence,
    manifest.front.normalizedCard.geometry.confidence,
  );
  assert.equal(manifest.analysisCoordinateSystem.sourceGeometry.confidenceBasis, "automatic_detection");
  assert.equal(manifest.analysisCoordinateSystem.sourceGeometry.detectionUsed, true);
  assert.deepEqual(
    manifest.analysisCoordinateSystem.sourceGeometry.warnings,
    manifest.front.normalizedCard.geometry.warnings,
  );
  assert.equal(
    manifest.analysisCoordinateSystem.semanticOrientation.status,
    "not_resolved_from_rectangle_geometry",
  );
  assert.match(manifest.analysisCoordinateSystem.semanticOrientation.limitation, /cannot determine printed top/i);
  assert.equal(manifest.analysisCoordinateSystem.normalizedCoordinateOutcome.framingStatus, "pass");
  assert.match(
    manifest.analysisCoordinateSystem.normalizedCoordinateOutcome.note,
    /does not replace or upgrade source geometry confidence/i,
  );
  assert.equal(manifest.analysisCoordinateSystem.transform.method, "authoritative_all_on_geometry_rotation_crop_canonical_resize_v1");
  assert.deepEqual(manifest.analysisCoordinateSystem.transform.outputImage, { width: 1200, height: 1680 });
  assert.equal(manifest.analysisCoordinateSystem.transform.sourceResolutionGate.status, "pass");
  assert.equal(manifest.analysisCoordinateSystem.transform.sourceResolutionGate.minimumSourceWidthPixels, 1000);
  assert.equal(manifest.analysisCoordinateSystem.transform.sourceResolutionGate.minimumSourceHeightPixels, 1400);
  assert.equal(manifest.analysisCoordinateSystem.transform.sourceResolutionGate.maximumUpscale, 1.2);
  assert.equal(typeof manifest.analysisCoordinateSystem.transform.geometricResamplingApplied, "boolean");
  assert.deepEqual(manifest.analysisCoordinateSystem.transformReusedForRoles, [
    "accepted_profile",
    "channel_1",
    "channel_2",
    "channel_3",
    "channel_4",
    "channel_5",
    "channel_6",
    "channel_7",
    "channel_8",
  ]);
  assert.equal(manifest.rawEvidenceIntegrity.verified, true);
  assert.equal(manifest.rawEvidenceIntegrity.roles.length, 11);
  assert.equal(manifest.rawEvidenceIntegrity.roles.every((role) => role.preserved === true), true);
  assert.equal(manifest.front.acquisitionPlacementDiagnostics.excludedFromGrade, true);
  assert.equal(manifest.front.allOn.analysisCoordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(
    manifest.front.allOn.stats.cardBoundary.confidence,
    manifest.front.normalizedCard.geometry.confidence,
  );
  assert.equal(manifest.front.allOn.stats.cardBoundary.confidenceBasis, "automatic_detection");
  assert.equal(manifest.front.allOn.stats.cardBoundary.source, "normalized_from_detected_geometry");
  assert.equal(manifest.front.allOn.stats.cardBoundary.detectionUsed, true);
  assert.equal(manifest.front.allOn.stats.cardBoundary.manualOverrideUsed, false);
  assert.match(manifest.front.allOn.stats.cardBoundary.reason, /not recomputed as perfect detection/i);
  assert.match(
    manifest.front.allOn.stats.cardBoundary.sourceWarnings.join(" "),
    /cannot determine printed top/i,
  );
  assert.equal(manifest.front.acceptedProfile.analysisCoordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(manifest.front.channels.every((channel) => channel.analysisCoordinateFrame === "normalized_card_portrait_pixels"), true);
  assert.equal(manifest.front.surfaceAnalysis.registration.status, "normalized_geometry_transform");
  assert.match(manifest.front.surfaceAnalysis.registration.note, /authoritative full-resolution all-on card transform/i);
  assert.equal(manifest.front.roiDefinitions.every((roi) => roi.analysisCoordinateFrame === "normalized_card_portrait_pixels"), true);
  const candidateChannels = manifest.front.channels.map((channel, index) => ({
    channel: channel.channel,
    stats: {
      ...channel.stats,
      sharpnessScore: index === 0 ? channel.stats.sharpnessScore * 2 : channel.stats.sharpnessScore,
    },
  }));
  const normalizedSurfaceCandidate = buildFixedRigSurfaceAnalysis({
    side: "front",
    channels: candidateChannels,
    roiDefinitions: manifest.front.roiDefinitions,
    registrationStatus: "normalized_geometry_transform",
  }).candidates[0];
  assert.ok(normalizedSurfaceCandidate);
  assert.equal(normalizedSurfaceCandidate.rawRect, undefined);
  assert.deepEqual(
    normalizedSurfaceCandidate.analysisRect,
    manifest.front.roiDefinitions.find((roi) => roi.id === "center-surface").rect,
  );
  assert.equal(normalizedSurfaceCandidate.analysisCoordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(manifest.front.fixtureCalibrationProfile.rawCoordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(manifest.front.fixtureCalibrationProfile.referenceType, "card_dimensions");
  assert.equal(
    manifest.front.fixtureCalibrationProfile.sourceGeometry.confidence,
    manifest.front.normalizedCard.geometry.confidence,
  );
  assert.equal(manifest.front.fixtureCalibrationProfile.sourceGeometry.placementState, "ready");
  assert.equal(
    manifest.front.fixtureCalibrationProfile.semanticOrientation.status,
    "not_resolved_from_rectangle_geometry",
  );
  assert.equal(
    manifest.front.fixtureCalibrationProfile.normalizedCoordinateOutcome.sourceGeometryQualityPreservedSeparately,
    true,
  );
  assert.match(
    manifest.front.fixtureCalibrationProfile.framingGate.warnings.join(" "),
    /derived-coordinate outcome, not source detection perfection/i,
  );
  assert.equal(manifest.front.fixtureCalibrationProfile.horizontalStartPx, undefined);
  assert.equal(manifest.front.fixtureCalibrationProfile.horizontalEndPx, undefined);
  assert.equal(manifest.front.fixtureCalibrationProfile.verticalStartPx, undefined);
  assert.equal(manifest.front.fixtureCalibrationProfile.verticalEndPx, undefined);
  assert.equal(manifest.front.acquisitionFixtureCalibrationProfile.rawCoordinateFrame, "basler_sensor_pixels");
  assert.equal(manifest.front.diagnosticGrading.centering.status, "not_computed");
  assert.match(manifest.front.diagnosticGrading.centering.warnings.join(" "), /camera-frame placement offset is intentionally excluded/i);
  assert.equal(manifest.captureTiming.frameCaptureMs > 0, true);
  assert.equal(manifest.captureTiming.fileWritesMs > 0, true);
  assert.equal(manifest.captureTiming.totalSideMs, 6000);
  assert.equal(manifest.captureTiming.targetProven, false);
  assert.equal(manifest.captureTiming.hardwareMeasurement, false);
  assert.equal(manifest.captureTiming.hardwareMeasurementRequired, true);
  assert.equal(manifest.processingTiming.frontProcessingMayOverlapFlip, true);
  assert.deepEqual(manifest.processingTiming.concurrencyLimits, {
    normalizedRoleNormalization: 2,
    normalizedImageAnalysis: 2,
  });
  assert.equal(manifest.analysisCoordinateSystem.processingConcurrency.normalizedRoleNormalization, 2);
  assert.equal(manifest.analysisCoordinateSystem.processingConcurrency.normalizedImageAnalysis, 2);
  assert.match(manifest.analysisCoordinateSystem.processingConcurrency.note, /bounded/i);
  assert.deepEqual(fs.readFileSync(rawPath), rawBefore);
  const previewHtml = fs.readFileSync(result.previewReportPath, "utf8");
  assert.match(previewHtml, /front-normalized-card\.png/);
});

test("full-resolution processing rejects grading-unsafe upscaling even when a small card-shaped region is detected", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-resolution-gate-"));
  const packageDir = path.join(root, "package-front");
  const sideDir = path.join(packageDir, "front");
  fs.mkdirSync(sideDir, { recursive: true });
  const rawPath = path.join(sideDir, "small-card-all-roles.tiff");
  await makeSmallCardTiff(rawPath);

  await assert.rejects(
    processFixedRigWarmSideBatch(warmBatchInput({
      packageId: "synthetic-small-card-front",
      packageDir,
      sideDir,
      rawPath,
    })),
    /failed the grading-resolution gate.*requires at least 1000x1400.*no more than 1\.2x upscaling/i,
  );
});

test("legacy fixture boundary cannot silently normalize an undetected card and full-resolution processing stops explicitly", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-no-manual-fallback-"));
  const packageDir = path.join(root, "package-front");
  const sideDir = path.join(packageDir, "front");
  fs.mkdirSync(sideDir, { recursive: true });
  const rawPath = path.join(sideDir, "blank-all-roles.tiff");
  await makeBlankTiff(rawPath);

  await assert.rejects(
    processFixedRigWarmSideBatch(warmBatchInput({
      packageId: "synthetic-undetected-front",
      packageDir,
      sideDir,
      rawPath,
      cardBoundaryRect: { x: 100, y: 140, width: 300, height: 420 },
    })),
    /full-resolution geometry did not produce a normalized card artifact; reposition the card and retry/i,
  );
  assert.equal(fs.existsSync(path.join(sideDir, "normalized", "front-normalized-card.png")), false);
});

test("explicit operator-confirmed manual capture is visibly recorded and never claims Ready or detection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-explicit-manual-capture-"));
  const packageDir = path.join(root, "package-front");
  const sideDir = path.join(packageDir, "front");
  fs.mkdirSync(sideDir, { recursive: true });
  const rawPath = path.join(sideDir, "blank-manual-all-roles.tiff");
  await makeBlankTiff(rawPath);

  const result = await processFixedRigWarmSideBatch(warmBatchInput({
    packageId: "synthetic-manual-front",
    packageDir,
    sideDir,
    rawPath,
    manualGeometryOverride: {
      action: "manual_capture",
      confirmed: true,
      rect: { x: 175, y: 245, width: 1050, height: 1470 },
    },
  }));
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  const normalized = manifest.front.normalizedCard;

  assert.equal(normalized.geometry.placementState, "not_detected");
  assert.equal(normalized.geometry.geometrySource, "manual_override");
  assert.equal(normalized.geometry.captureMode, "manual_capture");
  assert.equal(normalized.geometry.confidenceBasis, "operator_confirmation");
  assert.equal(normalized.geometry.confidence, 0);
  assert.equal(normalized.geometry.detectionUsed, false);
  assert.equal(normalized.geometry.manualOverrideUsed, true);
  assert.equal(normalized.geometry.detectedCorners, null);
  assert.equal(manifest.geometryPolicy.mode, "manual_capture");
  assert.equal(manifest.geometryPolicy.manualOverrideUsed, true);
  assert.equal(manifest.geometryPolicy.normalizedArtifactCreated, true);
  assert.equal(fs.existsSync(normalized.normalizedArtifact.localOutputPath), true);
  assert.equal(manifest.front.allOn.stats.cardBoundary.confidence, 0);
  assert.equal(manifest.front.allOn.stats.cardBoundary.confidenceBasis, "operator_confirmation");
  assert.equal(manifest.front.allOn.stats.cardBoundary.source, "normalized_from_manual_geometry");
  assert.equal(manifest.front.allOn.stats.cardBoundary.detectionUsed, false);
  assert.equal(manifest.front.allOn.stats.cardBoundary.manualOverrideUsed, true);
  assert.match(manifest.front.allOn.stats.cardBoundary.reason, /explicit operator-confirmed manual geometry/i);
  assert.equal(manifest.front.fixtureCalibrationProfile.sourceGeometry.confidence, 0);
  assert.equal(manifest.front.fixtureCalibrationProfile.sourceGeometry.detectionUsed, false);
  assert.equal(manifest.front.fixtureCalibrationProfile.sourceGeometry.manualOverrideUsed, true);
  assert.match(
    manifest.front.fixtureCalibrationProfile.framingGate.warnings.join(" "),
    /source confidence remains 0 \(operator_confirmation\)/i,
  );
  assert.equal(manifest.analysisCoordinateSystem.sourceGeometry.confidence, 0);
  assert.equal(manifest.analysisCoordinateSystem.sourceGeometry.confidenceBasis, "operator_confirmation");
  assert.match(
    manifest.front.fixtureCalibrationProfile.productionReadiness.blockers.join(" "),
    /automatic card geometry was not used/i,
  );
  assert.match(manifest.analysisCoordinateSystem.semanticOrientation.limitation, /180-degree reversal/i);
});

test("normalized grading coordinates are invariant to close-enough translation and rotation while every raw role is preserved", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-normalized-analysis-invariance-"));
  const run = async (label, options) => {
    const packageDir = path.join(root, `package-${label}`);
    const sideDir = path.join(packageDir, "front");
    fs.mkdirSync(sideDir, { recursive: true });
    const rawPath = path.join(sideDir, `${label}-all-roles.tiff`);
    await makeCardTiff(rawPath, options);
    const rawBefore = fs.readFileSync(rawPath);
    const result = await processFixedRigWarmSideBatch(warmBatchInput({
      packageId: `synthetic-${label}`,
      packageDir,
      sideDir,
      rawPath,
    }));
    assert.deepEqual(fs.readFileSync(rawPath), rawBefore);
    return JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  };

  const centered = await run("centered", { angle: 0, offsetX: 0, offsetY: 0 });
  const closeEnough = await run("shifted-rotated", { angle: 8, offsetX: 40, offsetY: -25 });
  const centeredSide = centered.front;
  const closeEnoughSide = closeEnough.front;

  assert.equal(centeredSide.normalizedCard.geometry.placementState, "ready");
  assert.equal(closeEnoughSide.normalizedCard.geometry.placementState, "ready");
  assert.ok(Math.abs(closeEnoughSide.normalizedCard.geometry.rotationDegrees - 8) < 1.5);
  assert.deepEqual(
    {
      width: closeEnoughSide.normalizedCard.normalizedArtifact.imageWidth,
      height: closeEnoughSide.normalizedCard.normalizedArtifact.imageHeight,
    },
    {
      width: centeredSide.normalizedCard.normalizedArtifact.imageWidth,
      height: centeredSide.normalizedCard.normalizedArtifact.imageHeight,
    },
  );
  assert.deepEqual(
    closeEnoughSide.roiDefinitions.map(({ id, rect, displayRect, source, analysisCoordinateFrame }) => ({ id, rect, displayRect, source, analysisCoordinateFrame })),
    centeredSide.roiDefinitions.map(({ id, rect, displayRect, source, analysisCoordinateFrame }) => ({ id, rect, displayRect, source, analysisCoordinateFrame })),
  );
  assert.equal(centeredSide.diagnosticGrading.centering.status, "not_computed");
  assert.equal(closeEnoughSide.diagnosticGrading.centering.status, "not_computed");
  for (const section of ["corners", "edges"]) {
    for (const element of Object.keys(centeredSide.diagnosticGrading[section])) {
      assert.equal(closeEnoughSide.diagnosticGrading[section][element].status, centeredSide.diagnosticGrading[section][element].status);
      const baselineScore = centeredSide.diagnosticGrading[section][element].score;
      const transformedScore = closeEnoughSide.diagnosticGrading[section][element].score;
      assert.ok(Math.abs(transformedScore - baselineScore) <= 0.35, `${section}.${element} score changed by more than the normalized-analysis tolerance`);
    }
  }
  assert.equal(centered.rawEvidenceIntegrity.roles.length, 11);
  assert.equal(closeEnough.rawEvidenceIntegrity.roles.length, 11);
  assert.equal(centered.rawEvidenceIntegrity.roles.every((role) => role.preserved), true);
  assert.equal(closeEnough.rawEvidenceIntegrity.roles.every((role) => role.preserved), true);
  assert.notDeepEqual(
    closeEnoughSide.acquisitionPlacementDiagnostics.geometry.boundingBox,
    centeredSide.acquisitionPlacementDiagnostics.geometry.boundingBox,
  );
});

test("front and back warm normalized evidence produces a capped unified provisional grade without using camera placement as centering", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-normalized-unified-grade-"));
  const processSide = async (side, options) => {
    const packageDir = path.join(root, `package-${side}`);
    const sideDir = path.join(packageDir, side);
    fs.mkdirSync(sideDir, { recursive: true });
    const rawPath = path.join(sideDir, `${side}-all-roles.tiff`);
    await makeCardTiff(rawPath, options);
    const channelPaths = [];
    for (let channel = 1; channel <= 8; channel += 1) {
      const channelPath = path.join(sideDir, `${side}-directional-channel-${channel}.tiff`);
      await makeCardTiff(channelPath, { ...options, directionalChannel: channel });
      channelPaths.push(channelPath);
    }
    return processFixedRigWarmSideBatch(warmBatchInput({
      packageId: `synthetic-normalized-${side}`,
      packageDir,
      sideDir,
      rawPath,
      rolePaths: [rawPath, rawPath, rawPath, ...channelPaths],
      side,
    }));
  };

  const front = await processSide("front", { angle: 8, offsetX: 36, offsetY: -22 });
  const back = await processSide("back", { angle: -6, offsetX: -31, offsetY: 27 });
  const unified = await createUnifiedFixedRigDiagnosticCardReport({
    frontPackageDir: front.packageDir,
    backPackageDir: back.packageDir,
    outputDir: path.join(root, "unified"),
  });

  const frontManifest = JSON.parse(fs.readFileSync(front.manifestPath, "utf8"));
  const backManifest = JSON.parse(fs.readFileSync(back.manifestPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(unified.manifestPath, "utf8"));
  const analysis = JSON.parse(fs.readFileSync(unified.analysisPath, "utf8"));
  const html = fs.readFileSync(unified.reportPath, "utf8");
  const story = analysis.provisionalGradeStory;
  const frontLightDirection = analysis.front.surfaceAnalysis.lightDirection;
  const backLightDirection = analysis.back.surfaceAnalysis.lightDirection;
  const frontFindings = analysis.surfaceIntelligence.front.candidates;
  const backFindings = analysis.surfaceIntelligence.back.candidates;

  assert.equal(unified.status, "computed_diagnostic");
  assert.equal(manifest.reportContains.provisionalDiagnosticGrade, true);
  assert.equal(story.status, "provisional_diagnostic_grade");
  assert.equal(story.provisionalGradeComputed, true);
  assert.equal(typeof story.provisionalOverallGrade, "number");
  assert.ok(story.provisionalOverallGrade > 0 && story.provisionalOverallGrade <= 9);
  assert.equal(story.elementScores.centering.status, "insufficient_evidence");
  assert.equal(story.elementScores.centering.score, undefined);
  assert.match(story.elementScores.centering.explanation, /camera-frame placement margins are intentionally excluded/i);
  assert.equal(story.elementScores.centering.primaryMetrics.leftPx, undefined);
  assert.equal(story.elementScores.centering.primaryMetrics.rightPx, undefined);
  assert.equal(story.elementScores.corners.status, "provisional_diagnostic");
  assert.equal(story.elementScores.edges.status, "provisional_diagnostic");
  assert.equal(story.elementScores.surface.status, "provisional_diagnostic");
  assert.equal(story.gates.results.find((gate) => gate.gate === "normalized_coordinate_basis")?.status, "pass");
  assert.equal(story.gates.results.find((gate) => gate.gate === "normalized_geometry_provenance")?.status, "pass");
  assert.equal(story.gates.results.find((gate) => gate.gate === "element_score_coverage")?.status, "pass");
  assert.equal(story.gates.results.some((gate) => gate.gate === "ruler_calibration"), false);
  assert.equal(story.formulas.appliedWeights.centering, 0);
  assert.ok(frontFindings.length > 0);
  assert.ok(backFindings.length > 0);
  for (const [side, sideManifest, findings] of [
    ["front", frontManifest.front, frontFindings],
    ["back", backManifest.back, backFindings],
  ]) {
    assert.equal(findings.every((finding) => finding.side === side), true);
    assert.equal(findings.every((finding) => finding.analysisCoordinateFrame === "normalized_card_portrait_pixels"), true);
    assert.equal(findings.every((finding) => finding.displayCoordinateFrame === "normalized_card_portrait_pixels"), true);
    assert.equal(findings.every((finding) => finding.analysisGeometry?.coordinateFrame === "normalized_card"), true);
    assert.equal(
      findings.every((finding) => finding.analysisGeometry?.sourceSha256 === sideManifest.normalizedCard.normalizedArtifact.sourceSha256),
      true,
    );
    assert.equal(
      findings.every((finding) => finding.analysisGeometry?.normalizedArtifactSha256 === sideManifest.normalizedCard.normalizedArtifact.sha256),
      true,
    );
  }
  assert.ok(Math.abs(
    story.formulas.appliedWeights.corners +
      story.formulas.appliedWeights.edges +
      story.formulas.appliedWeights.surface -
      1,
  ) < 0.00001);
  assert.match(story.formulas.missingElementPolicy, /camera placement margins are excluded/i);
  assert.match(story.confidence.warnings.join(" "), /centering is unavailable.*confidence was reduced.*capped at 9/i);
  assert.equal(
    story.gradeImpactCandidates.some((candidate) => candidate.id === "centering-not-computed-normalized-card"),
    true,
  );
  assert.equal(frontManifest.front.diagnosticGrading.centering.status, "not_computed");
  assert.equal(backManifest.back.diagnosticGrading.centering.status, "not_computed");
  assert.equal(frontManifest.front.acquisitionPlacementDiagnostics.excludedFromGrade, true);
  assert.equal(backManifest.back.acquisitionPlacementDiagnostics.excludedFromGrade, true);
  assert.equal(frontLightDirection.profile.lightVectorCoordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(backLightDirection.profile.lightVectorCoordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(
    frontLightDirection.profile.lightVectorCoordinateTransform.status,
    "applied_authoritative_card_deskew",
  );
  assert.equal(
    backLightDirection.profile.lightVectorCoordinateTransform.status,
    "applied_authoritative_card_deskew",
  );
  assert.equal(
    frontLightDirection.profile.lightVectorCoordinateTransform.clockwiseRotationDegrees,
    frontManifest.front.normalizedCard.normalizedArtifact.deskewAppliedDegrees,
  );
  assert.equal(
    backLightDirection.profile.lightVectorCoordinateTransform.clockwiseRotationDegrees,
    backManifest.back.normalizedCard.normalizedArtifact.deskewAppliedDegrees,
  );
  assert.equal(frontLightDirection.normalization.coordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(backLightDirection.normalization.coordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(frontLightDirection.normalization.darkSubtraction, false);
  assert.equal(backLightDirection.normalization.darkSubtraction, false);
  assert.notEqual(
    frontLightDirection.normalization.darkControlRegistration.status,
    "registered_same_coordinate_frame",
  );
  assert.notEqual(
    backLightDirection.normalization.darkControlRegistration.status,
    "registered_same_coordinate_frame",
  );
  assert.notDeepEqual(
    frontManifest.front.acquisitionPlacementDiagnostics.geometry.boundingBox,
    backManifest.back.acquisitionPlacementDiagnostics.geometry.boundingBox,
  );
  assert.match(html, /Provisional diagnostic grade/i);
  assert.match(html, /insufficient_evidence/i);
  assert.equal(fs.existsSync(unified.reportPath), true);
  const bundle = await buildAiGraderReportBundle({
    reportDir: unified.packageDir,
    outputDir: unified.packageDir,
    reportId: "synthetic-normalized-production-continuity",
  });
  const release = buildAiGraderProductionRelease({ bundle, warningsAccepted: true });
  assert.equal(typeof bundle.provisionalGrade?.overall, "number");
  assert.ok(bundle.visionLab.defectFindings.length > 0);
  assert.equal(bundle.visionLab.defectFindings.some((finding) => finding.side === "front"), true);
  assert.equal(bundle.visionLab.defectFindings.some((finding) => finding.side === "back"), true);
  assert.equal(
    bundle.visionLab.defectFindings.every((finding) => finding.evidence.trueViewAssetId?.includes(`${finding.side}-normalized-card.png`)),
    true,
  );
  assert.equal(bundle.provisionalGrade?.elementScores?.centering?.score, undefined);
  assert.equal(release.finalGradeComputed, true);
  assert.equal(release.finalGrade.overall, bundle.provisionalGrade.overall);
  assert.equal(release.finalGrade.elements.centering, undefined);
  assert.equal(release.label.status, "label_data_ready");
});

test("unified normalized grading inspects both side geometry provenances and penalizes an explicit manual back", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-normalized-mixed-provenance-"));
  const runSide = async (side, { imageOptions, manualGeometryOverride } = {}) => {
    const packageDir = path.join(root, `package-${side}`);
    const sideDir = path.join(packageDir, side);
    fs.mkdirSync(sideDir, { recursive: true });
    const rawPath = path.join(sideDir, `${side}-all-roles.tiff`);
    await makeCardTiff(rawPath, imageOptions);
    return processFixedRigWarmSideBatch(warmBatchInput({
      packageId: `synthetic-mixed-${side}`,
      packageDir,
      sideDir,
      rawPath,
      side,
      manualGeometryOverride,
    }));
  };

  const front = await runSide("front", { imageOptions: { angle: 5, offsetX: 24, offsetY: -18 } });
  const back = await runSide("back", {
    imageOptions: { angle: 0, offsetX: 0, offsetY: 0 },
    manualGeometryOverride: {
      action: "manual_capture",
      confirmed: true,
      rect: { x: 175, y: 245, width: 1050, height: 1470 },
    },
  });
  const unified = await createUnifiedFixedRigDiagnosticCardReport({
    frontPackageDir: front.packageDir,
    backPackageDir: back.packageDir,
    outputDir: path.join(root, "unified"),
  });
  const frontManifest = JSON.parse(fs.readFileSync(front.manifestPath, "utf8"));
  const backManifest = JSON.parse(fs.readFileSync(back.manifestPath, "utf8"));
  const analysis = JSON.parse(fs.readFileSync(unified.analysisPath, "utf8"));
  const story = analysis.provisionalGradeStory;
  const provenanceGate = story.gates.results.find((gate) => gate.gate === "normalized_geometry_provenance");

  assert.equal(story.status, "provisional_diagnostic_grade");
  assert.equal(story.provisionalGradeComputed, true);
  assert.equal(typeof story.provisionalOverallGrade, "number");
  assert.equal(provenanceGate?.status, "accepted_warning");
  assert.match(provenanceGate?.summary ?? "", /manual capture on back/i);
  assert.match(story.gates.acceptedWarnings.join(" "), /normalized_geometry_provenance.*manual capture on back/i);
  assert.match(story.confidence.warnings.join(" "), /manual geometry on back.*reduces confidence by 0\.08/i);
  assert.equal(frontManifest.front.fixtureCalibrationProfile.sourceGeometry.detectionUsed, true);
  assert.equal(frontManifest.front.fixtureCalibrationProfile.sourceGeometry.manualOverrideUsed, false);
  assert.equal(backManifest.back.fixtureCalibrationProfile.sourceGeometry.detectionUsed, false);
  assert.equal(backManifest.back.fixtureCalibrationProfile.sourceGeometry.manualOverrideUsed, true);
  assert.equal(backManifest.back.fixtureCalibrationProfile.sourceGeometry.confidence, 0);

  const incoherentBackProfile = {
    ...backManifest.back.fixtureCalibrationProfile,
    sourceGeometry: {
      ...backManifest.back.fixtureCalibrationProfile.sourceGeometry,
      detectionUsed: true,
    },
  };
  const incoherent = buildFixedRigProvisionalGradeStory({
    frontDiagnostic: frontManifest.front.diagnosticGrading,
    backDiagnostic: backManifest.back.diagnosticGrading,
    frontSurface: frontManifest.front.surfaceAnalysis,
    backSurface: backManifest.back.surfaceAnalysis,
    frontStats: frontManifest.front.allOn.stats,
    backStats: backManifest.back.allOn.stats,
    fixtureProfile: frontManifest.front.fixtureCalibrationProfile,
    frontFixtureProfile: frontManifest.front.fixtureCalibrationProfile,
    backFixtureProfile: incoherentBackProfile,
    allowAcceptedWarnings: true,
  });
  assert.equal(incoherent.status, "insufficient_evidence");
  assert.equal(incoherent.provisionalGradeComputed, false);
  assert.equal(
    incoherent.gates.results.find((gate) => gate.gate === "normalized_geometry_provenance")?.status,
    "fail",
  );
});
