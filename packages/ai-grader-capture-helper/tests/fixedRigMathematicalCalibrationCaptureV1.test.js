const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1_1,
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

async function producerFixture(root, options = {}) {
  const targetBytes = Buffer.from("%PDF-1.4\n% immutable non-production target\n", "utf8");
  const targetPath = path.join(root, "protected-target.pdf");
  await fsp.writeFile(targetPath, targetBytes);
  const requests = new Map();
  let captureCounter = 0;
  const protectedSettings = {
    stationId: "local-dell-ai-grader-station",
    rigId: "fixed-rig-test-v1",
    captureProfileVersion: options.v11 ? FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1_1 : FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
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
    ...(options.v11 ? { contractVersion: "v1.1" } : {}),
    ...(options.v11 ? {
      detectCheckerboard: options.detectCheckerboard ?? (async () => ({
        imageWidth: 1000,
        imageHeight: 1400,
        internalCorners: Array.from({ length: 176 }, (_, index) => ({ x: 100 + (index % 11) * 70, y: 385 + Math.floor(index / 11) * 42 })),
        outerCorners: [
          { x: 50, y: 382 },
          { x: 950, y: 382 },
          { x: 950, y: 1018 },
          { x: 50, y: 1018 },
        ],
        rotationDegrees: 0,
      })),
    } : {}),
    protectedSettings,
    capture: async (request) => {
      captureCounter += 1;
      requests.set(request.operationId, request);
      const capturedAt = new Date(Date.UTC(2026, 6, 18, 20, 0, 0, captureCounter)).toISOString();
      return {
        rawBytes: options.rawBytes ?? Buffer.from(`raw:${request.operationId}:${captureCounter}`),
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
    normalize: options.useDefaultNormalizer ? undefined : async (input) => {
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
      const defaultGeometry = {
        version: "ten-kings-card-geometry-v1",
        corners,
        boundingBox: { x: centerX - 300, y: centerY - 450, width: 600, height: 900 },
        rotationDegrees: rotation,
        image: { width: 1000, height: 1400 },
      };
      const geometry = options.geometryForRequest
        ? options.geometryForRequest({ request, sample, defaultGeometry })
        : options.assertCaptureTimeGeometry && request.role === "checkerboard_placement"
          ? input.reusableGeometry
        : defaultGeometry;
      if (options.assertCaptureTimeGeometry && request.role === "checkerboard_placement") {
        assert.ok(input.reusableGeometry, "checkerboard placement must receive capture-time geometry");
        assert.equal(input.reusableGeometry.detection.method, "opencv_find_chessboard_corners_sb_v1");
        for (const point of [
          input.reusableGeometry.corners.topLeft,
          input.reusableGeometry.corners.topRight,
          input.reusableGeometry.corners.bottomRight,
          input.reusableGeometry.corners.bottomLeft,
        ]) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
          assert.ok(point.x > 0 && point.x < input.reusableGeometry.image.width);
          assert.ok(point.y > 0 && point.y < input.reusableGeometry.image.height);
        }
      }
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

test("calibration producer derives pose coverage from the in-frame outer quadrilateral", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-polygon-coverage-"));
  const fixture = await producerFixture(root, {
    geometryForRequest: () => ({
      version: "ten-kings-card-geometry-v1",
      corners: {
        topLeft: { x: 500, y: 100 },
        topRight: { x: 900, y: 700 },
        bottomRight: { x: 500, y: 1300 },
        bottomLeft: { x: 100, y: 700 },
      },
      boundingBox: { x: 100, y: 100, width: 800, height: 1200 },
      rotationDegrees: 0,
      image: { width: 1000, height: 1400 },
    }),
  });
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, "calibration-polygon-coverage"));
  await fixture.producer.captureStep({
    sessionId: started.sessionId,
    operationId: "polygon-coverage-operation",
    role: "lens_geometry",
    sampleIndex: 1,
    targetFace: "checkerboard",
  });
  const state = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "capture-session.json"), "utf8"));
  const raw = state.artifacts.find((artifact) => artifact.artifactClass === "raw_capture");
  assert.equal(raw.pose.coverageFraction, 0.342857);
  assert.notEqual(raw.pose.coverageFraction, 0.685714, "axis-aligned bounding-box area is not target coverage");
});

test("calibration producer rejects non-finite or out-of-frame target corners before slot occupancy", async () => {
  const invalidCases = [
    ["negative", { x: -1, y: 100 }],
    ["zero-x", { x: 0, y: 100 }],
    ["zero-y", { x: 200, y: 0 }],
    ["boundary-equal", { x: 1000, y: 100 }],
    ["non-finite", { x: Number.NaN, y: 100 }],
  ];
  for (const [label, invalidTopLeft] of invalidCases) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), `tk-calibration-invalid-corner-${label}-`));
    const fixture = await producerFixture(root, {
      geometryForRequest: () => ({
        version: "ten-kings-card-geometry-v1",
        corners: {
          topLeft: invalidTopLeft,
          topRight: { x: 800, y: 100 },
          bottomRight: { x: 800, y: 1300 },
          bottomLeft: { x: 200, y: 1300 },
        },
        boundingBox: { x: 200, y: 100, width: 600, height: 1200 },
        rotationDegrees: 0,
        image: { width: 1000, height: 1400 },
      }),
    });
    const sessionId = `calibration-invalid-corner-${label}`;
    const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
    await assert.rejects(
      fixture.producer.captureStep({
        sessionId,
        operationId: `invalid-corner-operation-${label}`,
        role: "lens_geometry",
        sampleIndex: 1,
        targetFace: "checkerboard",
      }),
      /outer corners must be finite and fully inside the source frame/,
    );
    const status = await fixture.producer.status(sessionId);
    assert.equal(status.captureCount, 0, `${label} must leave the slot unoccupied`);
    assert.equal(status.failedOperationCount, 1);
    const state = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "capture-session.json"), "utf8"));
    assert.equal(state.captures.length, 0);
    assert.equal(
      state.artifacts.filter((artifact) =>
        artifact.artifactClass === "raw_capture" || artifact.artifactClass === "normalized_derivative").length,
      0,
    );
  }
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
      captureProfile: "production_fast",
      gradingContract: "mathematical_calibration_v1",
    }),
    /not ready.*No V0 fallback/i,
  );
});

test("V1.1 enforces four placement slots and records one reverse flip without role duplication", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v11-"));
  const fixture = await producerFixture(root, { v11: true });
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, "calibration-v11-session-001"));
  await assert.rejects(
    fixture.producer.captureStep({
      sessionId: started.sessionId,
      operationId: "old-v1-geometry-operation",
      role: "lens_geometry",
      sampleIndex: 1,
      targetFace: "checkerboard",
    }),
    /V1\.1 accepts exactly four/,
  );
  for (let sampleIndex = 1; sampleIndex <= 4; sampleIndex += 1) {
    await fixture.producer.captureStep({
      sessionId: started.sessionId,
      operationId: `placement-operation-${sampleIndex}`,
      role: "checkerboard_placement",
      sampleIndex,
      targetFace: "checkerboard",
    });
  }
  await fixture.producer.captureStep({
    sessionId: started.sessionId,
    operationId: "blank-reverse-flat-1",
    role: "flat_field",
    sampleIndex: 1,
    channelIndex: 1,
    targetFace: "blank_reverse",
  });
  const state = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "capture-session.json"), "utf8"));
  assert.equal(state.schemaVersion, "ten-kings-mathematical-calibration-capture-session-v1.1");
  assert.equal(state.captures.filter((capture) => capture.role === "checkerboard_placement").length, 4);
  assert.equal(state.blankReverseFlipRecorded, true);
  assert.equal(state.captures.filter((capture) => capture.role === "lens_geometry").length, 0);
});

test("V1.1 checkerboard placement binds normalization to dedicated capture-time geometry", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v11-checkerboard-geometry-"));
  let detectorInput;
  const fixture = await producerFixture(root, {
    v11: true,
    assertCaptureTimeGeometry: true,
    detectCheckerboard: async (bytes) => {
      detectorInput = Buffer.from(bytes);
      return {
        imageWidth: 1000,
        imageHeight: 1400,
        internalCorners: Array.from({ length: 176 }, (_, index) => ({ x: 100 + (index % 11) * 70, y: 385 + Math.floor(index / 11) * 42 })),
        outerCorners: [
          { x: 50, y: 382 },
          { x: 950, y: 382 },
          { x: 950, y: 1018 },
          { x: 50, y: 1018 },
        ],
        rotationDegrees: 0,
      };
    },
  });
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, "calibration-v11-capture-geometry"));
  await fixture.producer.captureStep({
    sessionId: started.sessionId,
    operationId: "placement-capture-geometry-1",
    role: "checkerboard_placement",
    sampleIndex: 1,
    targetFace: "checkerboard",
  });
  assert.equal(detectorInput?.toString("utf8"), "raw:placement-capture-geometry-1:1");
  const state = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "capture-session.json"), "utf8"));
  const normalized = state.artifacts.find((artifact) => artifact.artifactClass === "normalized_derivative");
  const geometry = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "working", `${normalized.evidenceId}-geometry.json`), "utf8"));
  assert.equal(geometry.detection.method, "opencv_find_chessboard_corners_sb_v1");
  assert.equal(geometry.image.width, 1000);
  assert.equal(geometry.image.height, 1400);
  assert.ok(state.artifacts.find((artifact) => artifact.artifactClass === "raw_capture").pose.coverageFraction > 0.3);
});

test("V1.1 checkerboard placement default normalization does not invoke the generic card detector", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v11-default-normalizer-"));
  const rawBytes = await sharp({
    create: { width: 1000, height: 1400, channels: 3, background: { r: 127, g: 127, b: 127 } },
  }).png().toBuffer();
  let detectorInput;
  const fixture = await producerFixture(root, {
    v11: true,
    useDefaultNormalizer: true,
    rawBytes,
    detectCheckerboard: async (bytes) => {
      detectorInput = Buffer.from(bytes);
      return {
        imageWidth: 1000,
        imageHeight: 1400,
        internalCorners: Array.from({ length: 176 }, (_, index) => ({ x: 100 + (index % 11) * 70, y: 385 + Math.floor(index / 11) * 42 })),
        outerCorners: [
          { x: 50, y: 382 },
          { x: 950, y: 382 },
          { x: 950, y: 1018 },
          { x: 50, y: 1018 },
        ],
        rotationDegrees: 0,
      };
    },
  });
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, "calibration-v11-default-normalizer"));
  const status = await fixture.producer.captureStep({
    sessionId: started.sessionId,
    operationId: "placement-default-normalizer-1",
    role: "checkerboard_placement",
    sampleIndex: 1,
    targetFace: "checkerboard",
  });
  assert.equal(status.captureCount, 1);
  assert.deepEqual(detectorInput, rawBytes);
  const state = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "capture-session.json"), "utf8"));
  const normalized = state.artifacts.find((artifact) => artifact.artifactClass === "normalized_derivative");
  const geometry = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "working", `${normalized.evidenceId}-geometry.json`), "utf8"));
  assert.equal(geometry.detection.method, "opencv_find_chessboard_corners_sb_v1");
});

test("V1.1 seals 76 image captures and 48 measurements with one four-pose evidence identity", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v11-seal-"));
  const fixture = await producerFixture(root, {
    v11: true,
    geometryForRequest: ({ request, defaultGeometry }) => {
      if (request.role !== "checkerboard_placement") return defaultGeometry;
      const centers = [
        [350, 450],
        [450, 600],
        [550, 750],
        [650, 900],
      ];
      const [centerX, centerY] = centers[request.sampleIndex - 1];
      const width = 600;
      const height = 800;
      const corners = {
        topLeft: { x: centerX - width / 2, y: centerY - height / 2 },
        topRight: { x: centerX + width / 2, y: centerY - height / 2 },
        bottomRight: { x: centerX + width / 2, y: centerY + height / 2 },
        bottomLeft: { x: centerX - width / 2, y: centerY + height / 2 },
      };
      return {
        ...defaultGeometry,
        corners,
        boundingBox: { x: corners.topLeft.x, y: corners.topLeft.y, width, height },
        rotationDegrees: [-4, -1, 2, 4][request.sampleIndex - 1],
      };
    },
  });
  const sessionId = "calibration-v11-seal-session";
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
  for (let sampleIndex = 1; sampleIndex <= 4; sampleIndex += 1) {
    await fixture.producer.captureStep({ sessionId, operationId: `placement-operation-${sampleIndex}`, role: "checkerboard_placement", sampleIndex, targetFace: "checkerboard" });
  }
  for (const role of ["flat_field", "dark_control", "illumination_pattern"]) {
    for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
      for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
        await fixture.producer.captureStep({ sessionId, operationId: `${role}-${channelIndex}-${sampleIndex}`, role, channelIndex, sampleIndex, targetFace: "blank_reverse" });
      }
    }
  }
  const instrument = {
    instrumentId: "traceable-ruler-v11",
    kind: "traceable_ruler",
    calibrationVersion: "2026.07",
    calibrationSha256: "a".repeat(64),
  };
  const physical = [
    { measurementType: "print_scale", axis: "x", nominalSpanMm: 100, measuredSpanMm: 100, measurementU95Mm: 0.01 },
    { measurementType: "print_scale", axis: "y", nominalSpanMm: 200, measuredSpanMm: 200, measurementU95Mm: 0.01 },
    { measurementType: "target_cut_dimension", axis: "x", nominalDimensionMm: 63.5, measuredDimensionMm: 63.5, measurementU95Mm: 0.01 },
    { measurementType: "target_cut_dimension", axis: "y", nominalDimensionMm: 88.9, measuredDimensionMm: 88.9, measurementU95Mm: 0.01 },
  ];
  for (const [index, measurement] of physical.entries()) {
    await fixture.producer.recordMeasurement({ sessionId, operationId: `physical-${index}`, ...measurement, measurementMethod: "traceable_measurement_v1", sourceMetrologyArtifactSha256: "b".repeat(64), instrument });
  }
  for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
    for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
      await fixture.producer.recordMeasurement({ sessionId, operationId: `direction-${channelIndex}-${sampleIndex}`, measurementType: "direction_geometry", channelIndex, sampleIndex, sourcePointMm: { x: channelIndex, y: sampleIndex }, cardCenterPointMm: { x: 0, y: 0 }, pointU95Mm: 0.01, measurementMethod: "fixed_ring_segment_geometry_with_ruler_v1", sourceMetrologyArtifactSha256: "c".repeat(64), instrument });
    }
  }
  for (const measurementClass of ["linear_mm", "area_mm2", "relief_index", "roughness_index", "color_delta_e"]) {
    for (let sampleIndex = 1; sampleIndex <= 4; sampleIndex += 1) {
      await fixture.producer.recordMeasurement({ sessionId, operationId: `repeat-${measurementClass}-${sampleIndex}`, measurementType: "measurement_repeatability", measurementClass, sampleIndex, referenceFeatureId: `checkerboard-repeatability-${measurementClass}-v1.1`, measuredValue: 1 + sampleIndex / 1000, sourceCaptureOperationId: `placement-operation-${sampleIndex}`, measurementAlgorithmVersion: "opencv_checkerboard_repeatability_measurement_v1.1", measurementMethod: "fixed_reference_repeatability_v1.1", instrument });
    }
  }
  const sealed = await fixture.producer.seal({ sessionId, operationId: "seal-v11", profileId: "fixed-rig-test-profile-v1.1", calibrationVersion: "fixed-rig-test-calibration-v1.1", artifactId: "fixed-rig-test-artifact-v1.1" });
  assert.equal(sealed.status.captureCount, 76);
  assert.equal(sealed.status.measurementCount, 48);
  const manifest = JSON.parse(await fsp.readFile(sealed.captureManifest.path, "utf8"));
  assert.equal(manifest.geometryViews.length, 4);
  assert.equal(manifest.normalizationHoldoutViews.length, 4);
  assert.equal(manifest.segmentationBoundaryViews.length, 4);
  assert.equal(manifest.repeatedPlacementDerivations.length, 4);
  assert.equal(manifest.blankReverseFlip.count, 1);
  assert.equal(manifest.measurementRepeatabilitySamples.length, 20);
  assert.equal(new Set(manifest.placementEvidenceIdentity.map((entry) => entry.evidenceId)).size, 4);
});
