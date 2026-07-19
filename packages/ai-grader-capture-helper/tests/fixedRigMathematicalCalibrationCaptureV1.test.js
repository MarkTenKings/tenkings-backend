const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
  FixedRigMathematicalCalibrationCaptureProducerV1,
} = require("../dist/drivers/fixedRigMathematicalCalibrationCaptureV1");
const {
  AiGraderLocalStationBridgeService,
  buildAiGraderLocalStationBridgeConfig,
  requireAppliedMathematicalCalibrationCameraSettings,
} = require("../dist/drivers/aiGraderLocalStationBridge");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("real calibration camera evidence requires exact applied exposure and gain telemetry", () => {
  assert.deepEqual(
    requireAppliedMathematicalCalibrationCameraSettings({ exposureTime: 6200, gain: 0 }),
    { exposureUs: 6200, gain: 0 },
  );
  for (const telemetry of [
    { gain: 0 },
    { exposureTime: undefined, gain: 0 },
    { exposureTime: null, gain: 0 },
    { exposureTime: Number.NaN, gain: 0 },
    { exposureTime: 6200 },
    { exposureTime: 6200, gain: undefined },
    { exposureTime: 6200, gain: null },
    { exposureTime: 6200, gain: Number.NaN },
  ]) {
    assert.throws(
      () => requireAppliedMathematicalCalibrationCameraSettings(telemetry),
      /requested settings cannot substitute for missing camera evidence/,
    );
  }
});

async function producerFixture(root) {
  const targetBytes = Buffer.from("%PDF-1.4\n% immutable non-production target\n", "utf8");
  const targetPath = path.join(root, "protected-target.pdf");
  await fsp.writeFile(targetPath, targetBytes);
  const requests = new Map();
  let captureCounter = 0;
  const protectedSettings = {
    stationId: "local-dell-ai-grader-station",
    rigId: "fixed-rig-test-v1",
    captureProfileVersion: FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
    cameraIndex: 0,
    exposureUs: 6200,
    gain: 0,
    dutyPercent: 1.2,
    leimacUnit: 1,
    selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
    normalizedWidthPx: 1200,
    normalizedHeightPx: 1680,
    checkerboard: { internalColumns: 11, internalRows: 16, cellMm: 5 },
  };
  const producer = new FixedRigMathematicalCalibrationCaptureProducerV1({
    outputRoot: path.join(root, "calibration-sessions"),
    targetPath,
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256: sha256(targetBytes),
    protectedSettings,
    capture: async (request) => {
      captureCounter += 1;
      requests.set(request.operationId, request);
      const capturedAt = new Date(Date.UTC(2026, 6, 18, 20, 0, 0, captureCounter)).toISOString();
      return {
        rawBytes: Buffer.from(`raw:${request.operationId}:${captureCounter}`),
        mimeType: "image/png",
        imageWidth: 1000,
        imageHeight: 1400,
        capturedAt,
        camera: {
          serialNumber: "TEST-SERIAL",
          modelName: "Basler-test",
          transport: "GigE",
          sourcePixelFormat: "Mono8",
          savedImageFormat: "PNG",
          exposureUs: protectedSettings.exposureUs,
          gain: protectedSettings.gain,
        },
        pylon: { version: "7.5.0-test", bridgeVersion: "basler-pylon-bridge-test" },
        leimac: {
          unit: protectedSettings.leimacUnit,
          dutyPercent: request.lighting.dutyPercent,
          enabledChannels: request.lighting.enabledChannels,
          expectedWriteCount: 3,
          acknowledgedWriteCount: 3,
          responseKinds: ["ack", "ack", "ack"],
          complete: true,
        },
        safeOff: {
          beforeCaptureConfirmed: true,
          afterCaptureConfirmed: true,
          confirmedAt: capturedAt,
        },
      };
    },
    normalize: async (input) => {
      const request = requests.get(input.sourceImageId.replace(/-raw$/, "").split("-").slice(-1)[0])
        ?? [...requests.values()].find((candidate) => input.sourceImageId.includes(candidate.operationId));
      assert.ok(request, `missing capture request for ${input.sourceImageId}`);
      const rawBytes = await fsp.readFile(input.sourceImagePath);
      const rawHash = sha256(rawBytes);
      const normalizedBytes = Buffer.from(`normalized:${request.operationId}:${sha256(rawBytes)}`);
      await fsp.mkdir(path.dirname(input.workingOutputPath), { recursive: true });
      await fsp.writeFile(input.workingOutputPath, normalizedBytes);
      const sample = request.sampleIndex;
      const xOffset = (((sample - 1) % 5) / 4) * 0.12 - 0.06;
      const yOffset = (Math.floor((sample - 1) / 5)) * 0.12 - 0.06;
      const rotation = -2 + ((sample - 1) / 9) * 4;
      const centerX = 500 + xOffset * 1000;
      const centerY = 700 + yOffset * 1400;
      const corners = {
        topLeft: { x: centerX - 300, y: centerY - 450 },
        topRight: { x: centerX + 300, y: centerY - 450 },
        bottomRight: { x: centerX + 300, y: centerY + 450 },
        bottomLeft: { x: centerX - 300, y: centerY + 450 },
      };
      const geometry = {
        version: "ten-kings-card-geometry-v1",
        corners,
        boundingBox: { x: centerX - 300, y: centerY - 450, width: 600, height: 900 },
        rotationDegrees: rotation,
        image: { width: 1000, height: 1400 },
      };
      return {
        geometry,
        rawArtifact: {
          fileName: path.basename(input.sourceImagePath),
          sha256: rawHash,
          byteSize: rawBytes.length,
          mimeType: "image/png",
          imageWidth: 1000,
          imageHeight: 1400,
        },
        normalizedArtifact: {
          localOutputPath: input.workingOutputPath,
          fileName: path.basename(input.workingOutputPath),
          sha256: sha256(normalizedBytes),
          byteSize: normalizedBytes.length,
          mimeType: "image/png",
          imageWidth: 1200,
          imageHeight: 1680,
          lossless: true,
          encodingLossless: true,
          geometricResamplingApplied: true,
          upscaled: false,
          sourceCropWidth: 600,
          sourceCropHeight: 900,
          scaleX: 2,
          scaleY: 1.866667,
          coordinateFrame: "normalized_card_portrait_pixels",
          sourceSha256: rawHash,
          deskewAppliedDegrees: -rotation,
        },
        rawEvidencePreserved: true,
      };
    },
  });
  return {
    producer,
    requests,
    targetSha256: sha256(targetBytes),
    get captureCount() { return captureCounter; },
  };
}

function startRequest(targetSha256, sessionId = "calibration-session-001") {
  return {
    sessionId,
    operatorId: "mark-supervised",
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256,
  };
}

test("calibration producer binds the protected target, resumes explicitly, and rejects slot overwrite", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-producer-"));
  const fixture = await producerFixture(root);
  await assert.rejects(
    fixture.producer.start(startRequest("0".repeat(64))),
    /protected target artifact/i,
  );
  const started = await fixture.producer.start(startRequest(fixture.targetSha256));
  assert.equal(started.captureCount, 0);
  await assert.rejects(
    fixture.producer.start(startRequest(fixture.targetSha256)),
    /explicit resume/i,
  );
  const resumed = await fixture.producer.start({ ...startRequest(fixture.targetSha256), resume: true });
  assert.equal(resumed.sessionId, started.sessionId);

  const step = {
    sessionId: started.sessionId,
    operationId: "geometry-operation-0001",
    role: "lens_geometry",
    sampleIndex: 1,
    targetFace: "checkerboard",
    exposureUs: 999999,
    enabledChannels: [8],
  };
  await fixture.producer.captureStep(step);
  assert.equal(fixture.captureCount, 1);
  const boundary = fixture.requests.get(step.operationId);
  assert.equal(boundary.protectedSettings.exposureUs, 6200);
  assert.deepEqual(boundary.lighting.enabledChannels, [1, 2, 3, 4, 5, 6, 7, 8]);
  await fixture.producer.captureStep(step);
  assert.equal(fixture.captureCount, 1, "same operation ID must be idempotent");
  await assert.rejects(
    fixture.producer.captureStep({ ...step, operationId: "geometry-operation-relabel" }),
    /already occupied/i,
  );
  await assert.rejects(
    fixture.producer.captureStep({ ...step, operationId: "wrong-face", role: "flat_field", channelIndex: 1 }),
    /blank_reverse/i,
  );
  const state = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "capture-session.json"), "utf8"));
  const raw = state.artifacts.find((artifact) => artifact.artifactClass === "raw_capture");
  const normalized = state.artifacts.find((artifact) => artifact.artifactClass === "normalized_derivative");
  assert.equal(raw.role, "lens_geometry");
  assert.equal(raw.camera.exposureUs, 6200);
  assert.equal(raw.safeOff.afterCaptureConfirmed, true);
  assert.equal(normalized.role, "lens_geometry_normalized");
  assert.equal(normalized.parentSha256, raw.sha256);
  assert.equal(normalized.normalization.sourceSha256, raw.sha256);
});

test("calibration producer seals the complete unique capture and metrology ledger without overwrite", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-seal-"));
  const fixture = await producerFixture(root);
  const sessionId = "calibration-session-complete";
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
  for (const role of ["lens_geometry", "normalization_registration", "repeated_placement"]) {
    for (let sampleIndex = 1; sampleIndex <= 10; sampleIndex += 1) {
      await fixture.producer.captureStep({
        sessionId,
        operationId: `${role}-operation-${sampleIndex}`,
        role,
        sampleIndex,
        targetFace: "checkerboard",
        ...(role === "repeated_placement" ? { removeReseatCycleId: `remove-reseat-cycle-${sampleIndex}` } : {}),
      });
    }
  }
  for (const role of ["flat_field", "dark_control", "illumination_pattern"]) {
    for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
      for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
        await fixture.producer.captureStep({
          sessionId,
          operationId: `${role}-${channelIndex}-${sampleIndex}`,
          role,
          sampleIndex,
          channelIndex,
          targetFace: "blank_reverse",
        });
      }
    }
  }
  const instrument = {
    instrumentId: "traceable-ruler-test",
    kind: "traceable_ruler",
    calibrationVersion: "ruler-calibration-v1",
    calibrationSha256: "a".repeat(64),
  };
  const sourceMetrologyArtifactSha256 = "b".repeat(64);
  for (const axis of ["x", "y"]) {
    await fixture.producer.recordMeasurement({
      sessionId,
      operationId: `print-scale-${axis}`,
      measurementType: "print_scale",
      axis,
      nominalSpanMm: axis === "x" ? 100 : 200,
      measuredSpanMm: axis === "x" ? 100 : 200,
      measurementU95Mm: 0.05,
      measurementMethod: "traceable_ruler_direct_v1",
      sourceMetrologyArtifactSha256,
      instrument,
    });
    await fixture.producer.recordMeasurement({
      sessionId,
      operationId: `cut-dimension-${axis}`,
      measurementType: "target_cut_dimension",
      axis,
      nominalDimensionMm: axis === "x" ? 63.5 : 88.9,
      measuredDimensionMm: axis === "x" ? 63.5 : 88.9,
      measurementU95Mm: 0.05,
      measurementMethod: "traceable_ruler_direct_v1",
      sourceMetrologyArtifactSha256,
      instrument,
    });
  }
  for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
    const angle = ((channelIndex - 1) * Math.PI) / 4;
    for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
      await fixture.producer.recordMeasurement({
        sessionId,
        operationId: `direction-${channelIndex}-${sampleIndex}`,
        measurementType: "direction_geometry",
        channelIndex,
        sampleIndex,
        sourcePointMm: { x: 31.75 + 30 * Math.cos(angle), y: 44.45 + 30 * Math.sin(angle) },
        cardCenterPointMm: { x: 31.75, y: 44.45 },
        pointU95Mm: 0.05,
        measurementMethod: "fixed_ring_segment_geometry_with_ruler_v1",
        sourceMetrologyArtifactSha256,
        instrument,
      });
    }
  }
  for (const measurementClass of ["linear_mm", "area_mm2", "relief_index", "roughness_index", "color_delta_e"]) {
    for (let sampleIndex = 1; sampleIndex <= 10; sampleIndex += 1) {
      await fixture.producer.recordMeasurement({
        sessionId,
        operationId: `repeat-${measurementClass}-${sampleIndex}`,
        measurementType: "measurement_repeatability",
        measurementClass,
        sampleIndex,
        referenceFeatureId: `checkerboard-repeatability-${measurementClass}-v1`,
        measuredValue: 1 + sampleIndex / 1000,
        sourceCaptureOperationId: `repeated_placement-operation-${sampleIndex}`,
        measurementAlgorithmVersion: "opencv_checkerboard_repeatability_measurement_v1",
        measurementMethod: "fixed_reference_repeatability_v1",
        instrument,
      });
    }
  }
  const sealed = await fixture.producer.seal({
    sessionId,
    operationId: "seal-operation-0001",
    profileId: "fixed-rig-test-profile-v1",
    calibrationVersion: "fixed-rig-test-calibration-v1",
    artifactId: "fixed-rig-test-artifact-v1",
  });
  assert.equal(sealed.status.sealed, true);
  assert.equal(sealed.status.captureCount, 102);
  assert.equal(sealed.status.measurementCount, 78);
  const captureManifest = JSON.parse(await fsp.readFile(sealed.captureManifest.path, "utf8"));
  const sourcePackage = JSON.parse(await fsp.readFile(sealed.sourceCapturePackage.path, "utf8"));
  assert.equal(captureManifest.sourceCapturePackage.sha256, sealed.sourceCapturePackage.sha256);
  assert.equal(captureManifest.geometryViews.length, 10);
  assert.equal(captureManifest.flatFieldChannels.length, 8);
  assert.equal(captureManifest.measurementRepeatabilitySamples.length, 50);
  assert.equal(sourcePackage.stationAuthority.noProductionMutation, true);
  assert.ok(sourcePackage.artifacts.every((artifact) => artifact.productionCard === false));
  assert.equal(new Set(sourcePackage.artifacts.map((artifact) => artifact.path)).size, sourcePackage.artifacts.length);
  assert.equal(new Set(sourcePackage.artifacts.map((artifact) => artifact.sha256)).size, sourcePackage.artifacts.length);
  const sealedAgain = await fixture.producer.seal({
    sessionId,
    operationId: "seal-operation-0001",
    profileId: "fixed-rig-test-profile-v1",
    calibrationVersion: "fixed-rig-test-calibration-v1",
    artifactId: "fixed-rig-test-artifact-v1",
  });
  assert.equal(sealedAgain.sourceCapturePackage.sha256, sealed.sourceCapturePackage.sha256);
  await assert.rejects(
    fixture.producer.captureStep({
      sessionId,
      operationId: "post-seal-capture",
      role: "lens_geometry",
      sampleIndex: 1,
      targetFace: "checkerboard",
    }),
    /sealed.*immutable/i,
  );
  assert.equal(fs.existsSync(started.sessionDir), true);
});

test("station bridge advertises calibration readiness and never falls back to V0", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-bridge-"));
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: path.join(root, "station-output"),
  });
  const service = new AiGraderLocalStationBridgeService(config);
  const status = service.status();
  assert.equal(status.mathematicalCalibration.ready, false);
  assert.match(status.mathematicalCalibration.reason, /no exact finalized/i);
  assert.ok(status.bridgeContract.endpoints.some((endpoint) =>
    endpoint.path === "/calibration/mathematical-v1/capture" && endpoint.hardwareAccess === true));
  await assert.rejects(
    service.action("start-session", {
      captureProfile: "full_forensic",
      gradingContract: "mathematical_calibration_v1",
    }),
    /not ready.*No V0 fallback/i,
  );
});
