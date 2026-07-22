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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, candidate]) => candidate !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, candidate]) => [key, canonical(candidate)]));
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
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
  const requests = options.requestRegistry ?? new Map();
  const normalizationInputs = [];
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
    ...(options.protectedSettings ?? {}),
  };
  const producer = new FixedRigMathematicalCalibrationCaptureProducerV1({
    outputRoot: path.join(root, "calibration-sessions"),
    targetPath,
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256: sha256(targetBytes),
    ...(options.now ? { now: options.now } : {}),
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
    ...(options.deriveAnalyzerAuthorityRebindRequests
      ? { deriveAnalyzerAuthorityRebindRequests: options.deriveAnalyzerAuthorityRebindRequests }
      : {}),
    capture: async (request) => {
      captureCounter += 1;
      requests.set(request.operationId, request);
      const defaultCapturedAt = new Date(Date.UTC(2026, 6, 18, 20, 0, 0, captureCounter)).toISOString();
      const capturedAt = options.capturedAtForRequest
        ? options.capturedAtForRequest({ request, captureCounter, defaultCapturedAt })
        : defaultCapturedAt;
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
      normalizationInputs.push({
        sourceImageId: input.sourceImageId,
        reusableGeometry: input.reusableGeometry ? structuredClone(input.reusableGeometry) : undefined,
      });
      const request = requests.get(input.sourceImageId.replace(/-raw$/, "").split("-").slice(-1)[0])
        ?? [...requests.values()]
          .filter((candidate) => input.sourceImageId.includes(candidate.operationId))
          .sort((left, right) => right.operationId.length - left.operationId.length)[0];
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
        detectionPolicy: "captured_evidence_full",
        side: "front",
        placementState: "ready",
        adjustmentReason: null,
        geometrySource: "detected",
        captureMode: "automatic_detection",
        confidenceBasis: "automatic_detection",
        detectionUsed: true,
        manualOverrideUsed: false,
        corners,
        detectedCorners: corners,
        boundingBox: { x: centerX - 300, y: centerY - 450, width: 600, height: 900 },
        rotationDegrees: rotation,
        skewDegrees: 0,
        confidence: 1,
        sourceImageId: input.sourceImageId,
        sourceFrameId: input.sourceImageId,
        timestamp: options.geometryTimestampForRequest
          ? options.geometryTimestampForRequest({ request, capturedAt: input.capturedAt })
          : input.capturedAt,
        image: { width: 1000, height: 1400, coordinateFrame: "source_image_pixels" },
        semanticOrientation: {
          canonicalOrientation: "portrait",
          basis: "operator_top_toward_preview_top",
          contentUprightVerified: false,
        },
        placement: {},
        detection: { backgroundLuma: 0 },
        warnings: [],
      };
      const serverReusableGeometry = !options.v11 && ["dark_control", "flat_field", "illumination_pattern"].includes(request.role)
        ? input.reusableGeometry
        : undefined;
      const geometry = serverReusableGeometry ?? (options.geometryForRequest
        ? options.geometryForRequest({ request, sample, defaultGeometry })
        : options.assertCaptureTimeGeometry && request.role === "checkerboard_placement"
          ? input.reusableGeometry
        : defaultGeometry);
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
      const rawArtifact = {
        fileName: path.basename(input.sourceImagePath),
        sha256: rawHash,
        byteSize: rawBytes.length,
        mimeType: "image/png",
        imageWidth: 1000,
        imageHeight: 1400,
      };
      if (options.normalizationFailureOperationIds?.has(request.operationId)) {
        return { geometry, rawArtifact, rawEvidencePreserved: true };
      }
      return {
        geometry,
        rawArtifact,
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
    normalizationInputs,
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

async function auditedFalseStopFixture(root) {
  const requestRegistry = new Map();
  const fixture = await producerFixture(root, {
    requestRegistry,
    capturedAtForRequest: ({ request, defaultCapturedAt }) => request.operationId === "dark-control-1-1-accepted"
      ? "2026-07-22T10:55:23.4175556Z"
      : defaultCapturedAt,
    geometryTimestampForRequest: ({ capturedAt }) => new Date(capturedAt).toISOString(),
  });
  const sessionId = "math-cal-v1-20260722-false-stop-fixture";
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
  for (const role of ["lens_geometry", "normalization_registration", "repeated_placement"]) {
    for (let sampleIndex = 1; sampleIndex <= 10; sampleIndex += 1) {
      await fixture.producer.captureStep({
        sessionId,
        operationId: `${role}-accepted-${sampleIndex}`,
        role,
        sampleIndex,
        targetFace: "checkerboard",
        ...(role === "repeated_placement" ? { removeReseatCycleId: `preserved-reseat-${sampleIndex}` } : {}),
      });
    }
  }
  for (const sampleIndex of [1, 2]) {
    await fixture.producer.captureStep({
      sessionId,
      operationId: `dark-control-1-${sampleIndex}-accepted`,
      role: "dark_control",
      channelIndex: 1,
      sampleIndex,
      targetFace: "blank_reverse",
    });
  }
  const statePath = path.join(started.sessionDir, "capture-session.json");
  const state = JSON.parse(await fsp.readFile(statePath, "utf8"));
  const operationId = "cal-capture-false-stop-fixture";
  const reason = "Accepted blank-reverse geometry record does not reproduce its immutable accepted pose and detection authority.";
  const failedAt = "2026-07-22T11:00:00.000Z";
  state.failedOperations.push({
    operationId,
    failedAt,
    error: reason,
    role: "dark_control",
    sampleIndex: 3,
    channelIndex: 1,
    targetFace: "blank_reverse",
    slotKey: "dark_control:1:3",
  });
  state.hardStop = { operationId, stoppedAt: failedAt, reason };
  state.updatedAt = failedAt;
  await fsp.writeFile(statePath, canonicalBytes(state));
  const preStateSha256 = sha256(canonicalBytes(state));
  const recoveryContract = {
    recoveryId: "blank-reverse-geometry-timestamp-false-stop-20260722-v1",
    sessionId,
    expectedPreStateSha256: preStateSha256,
    operationId,
    reason,
    pendingSlotKey: "dark_control:1:3",
    acceptedCaptureCount: 32,
    acceptedArtifactCount: 64,
  };
  fixture.producer.blankReverseTimestampFalseStopRecovery = recoveryContract;
  return { fixture, requestRegistry, sessionId, started, statePath, preStateSha256, recoveryContract };
}

function countManifestReferences(value) {
  let count = 0;
  const visit = (candidate) => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== "object") return;
    if (typeof candidate.path === "string" && typeof candidate.sha256 === "string") count += 1;
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return count;
}

async function sealedAnalyzerRebindFixture(root) {
  const oldAnalyzerSha256 = "8cee9c2d3a9829fe196982616dcdb33b3872ce5dd2f15dd2e99cf9d08e21384b";
  const correctedAnalyzerSha256 = "4387cfacd2193e326f06e5cb461d478d293cb1c9e62449ec1c8c28b1c17eb201";
  let derivedRequests = [];
  const fixture = await producerFixture(root, {
    deriveAnalyzerAuthorityRebindRequests: async () => structuredClone(derivedRequests),
    now: () => new Date("2026-07-22T12:00:00.000Z"),
  });
  const sessionId = "synthetic-analyzer-rebind-session";
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
  for (const role of ["lens_geometry", "normalization_registration", "repeated_placement"]) {
    for (let sampleIndex = 1; sampleIndex <= 10; sampleIndex += 1) {
      await fixture.producer.captureStep({
        sessionId, operationId: `${role}-operation-${sampleIndex}`, role, sampleIndex,
        targetFace: "checkerboard",
        ...(role === "repeated_placement" ? { removeReseatCycleId: `rebind-reseat-${sampleIndex}` } : {}),
      });
    }
  }
  for (const role of ["dark_control", "flat_field", "illumination_pattern"]) {
    for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
      for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
        await fixture.producer.captureStep({
          sessionId, operationId: `${role}-${channelIndex}-${sampleIndex}`, role,
          sampleIndex, channelIndex, targetFace: "blank_reverse",
        });
      }
    }
  }
  const targetInstrument = {
    instrumentId: "protected-calibration-target-geometry-v1",
    kind: "protected_target_geometry",
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256: fixture.targetSha256,
    authorityStatement: "product_owner_confirmed_exact_target_geometry_v1",
  };
  const requests = [];
  for (const axis of ["x", "y"]) {
    requests.push({
      sessionId, operationId: `target-authority-print-${axis}`, measurementType: "print_scale", axis,
      protectedSpanMm: axis === "x" ? 100 : 200, authorityBasis: "protected_checkerboard_geometry",
      measurementMethod: "protected_checkerboard_geometry_authority_v1",
      sourceTargetEvidenceId: "print-verified-calibration-target", instrument: targetInstrument,
    });
    requests.push({
      sessionId, operationId: `target-authority-cut-${axis}`, measurementType: "target_cut_dimension", axis,
      protectedDimensionMm: axis === "x" ? 63.5 : 88.9, authorityBasis: "protected_checkerboard_geometry",
      measurementMethod: "protected_checkerboard_geometry_authority_v1",
      sourceTargetEvidenceId: "print-verified-calibration-target", instrument: targetInstrument,
    });
  }
  const captureState = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "capture-session.json"), "utf8"));
  for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
    for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
      const operationId = `illumination_pattern-${channelIndex}-${sampleIndex}`;
      const capture = captureState.captures.find((entry) => entry.operationId === operationId);
      const artifact = captureState.artifacts.find((entry) => entry.evidenceId === capture.normalizedEvidenceId);
      requests.push({
        sessionId, operationId: `direction-derived-${channelIndex}-${sampleIndex}`,
        measurementType: "direction_geometry", channelIndex, sampleIndex,
        sourcePointMm: { x: 20 + channelIndex + sampleIndex / 100, y: 30 + channelIndex + sampleIndex / 100 },
        cardCenterPointMm: { x: 31.75, y: 44.45 }, pointU95Mm: 0.02 + sampleIndex / 1000,
        sourceCaptureOperationId: operationId, sourceEvidenceId: artifact.evidenceId, sourceSha256: artifact.sha256,
        measurementAlgorithmVersion: "opencv_illumination_centroid_checkerboard_v1",
        measurementMethod: "illumination_centroid_checkerboard_repeatability_v1",
        instrument: {
          instrumentId: "ten-kings-illumination-centroid-direction-analyzer-v1", kind: "fixed_rig_geometry",
          calibrationVersion: "opencv_illumination_centroid_checkerboard_v1", calibrationSha256: oldAnalyzerSha256,
        },
      });
    }
  }
  for (const measurementClass of ["linear_mm", "area_mm2", "relief_index", "roughness_index", "color_delta_e"]) {
    for (let sampleIndex = 1; sampleIndex <= 10; sampleIndex += 1) {
      requests.push({
        sessionId, operationId: `repeatability-derived-${measurementClass}-${String(sampleIndex).padStart(2, "0")}`,
        measurementType: "measurement_repeatability", measurementClass, sampleIndex,
        referenceFeatureId: `checkerboard-repeatability-${measurementClass}-v1`,
        measuredValue: 1 + sampleIndex / 1000,
        sourceCaptureOperationId: `repeated_placement-operation-${sampleIndex}`,
        measurementAlgorithmVersion: "opencv_checkerboard_repeatability_measurement_v1",
        measurementMethod: "fixed_reference_repeatability_v1",
        instrument: {
          instrumentId: "ten-kings-fixed-rig-repeatability-analyzer-v1", kind: "fixed_rig_geometry",
          calibrationVersion: "opencv_checkerboard_repeatability_measurement_v1", calibrationSha256: oldAnalyzerSha256,
        },
      });
    }
  }
  assert.equal(requests.length, 78);
  for (const request of requests) await fixture.producer.recordMeasurement(request);
  const sealed = await fixture.producer.seal({
    sessionId, operationId: "synthetic-old-seal", profileId: "synthetic-profile-v1",
    calibrationVersion: "synthetic-calibration-v1", artifactId: "synthetic-artifact-v1",
  });
  const statePath = path.join(started.sessionDir, "capture-session.json");
  const state = JSON.parse(await fsp.readFile(statePath, "utf8"));
  state.failedOperations.push(
    { operationId: "historical-failure-1", failedAt: "2026-07-22T01:00:00.000Z", error: "ordinary rejected pose", slotKey: "lens_geometry:none:1" },
    { operationId: "historical-failure-2", failedAt: "2026-07-22T02:00:00.000Z", error: "ordinary rejected blank", slotKey: "dark_control:1:3" },
  );
  await fsp.writeFile(statePath, canonicalBytes(state));
  derivedRequests = requests.map((request) => {
    const value = structuredClone(request);
    if (value.instrument.kind === "fixed_rig_geometry") value.instrument.calibrationSha256 = correctedAnalyzerSha256;
    return value;
  });
  const manifestBytes = await fsp.readFile(sealed.captureManifest.path);
  const packageBytes = await fsp.readFile(sealed.sourceCapturePackage.path);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const incident = {
    rebindId: "sealed-analyzer-authority-rebind-20260722-v1",
    sessionId,
    expectedPreStateSha256: sha256(canonicalBytes(state)),
    oldAnalyzerSha256,
    correctedAnalyzerSha256,
    oldCaptureManifestSha256: sha256(manifestBytes),
    oldSourcePackageSha256: sha256(packageBytes),
    captureCount: 102,
    captureArtifactCount: 204,
    authorityCount: 78,
    analyzerAuthorityCount: 74,
    protectedTargetAuthorityCount: 4,
    failureCount: 2,
    manifestReferenceCount: countManifestReferences(manifest),
  };
  fixture.producer.analyzerAuthorityRebindIncident = incident;
  return {
    fixture, sessionId, started, statePath, incident, requests,
    get derivedRequests() { return derivedRequests; },
    set derivedRequests(value) { derivedRequests = value; },
    preState: structuredClone(state),
    preStateBytes: canonicalBytes(state),
  };
}

test("incident-bound analyzer authority rebind is exact, adversarial, crash-safe, and idempotent", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-analyzer-rebind-"));
  const fx = await sealedAnalyzerRebindFixture(root);
  const producer = fx.fixture.producer;
  const originalIncident = structuredClone(fx.incident);
  const originalRequests = structuredClone(fx.derivedRequests);
  const analyzerPath = path.resolve(__dirname, "../../../scripts/ai-grader/analyze-mathematical-calibration-v1.py");
  assert.equal(sha256(await fsp.readFile(analyzerPath)), originalIncident.correctedAnalyzerSha256);

  for (const [field, replacement, pattern] of [
    ["sessionId", "wrong-session", /pre-state|ENOENT|session/i],
    ["expectedPreStateSha256", "1".repeat(64), /pre-state/i],
    ["oldCaptureManifestSha256", "2".repeat(64), /manifest/i],
    ["oldSourcePackageSha256", "3".repeat(64), /source package/i],
    ["oldAnalyzerSha256", "4".repeat(64), /old analyzer/i],
    ["correctedAnalyzerSha256", "5".repeat(64), /portable corrected analyzer/i],
  ]) {
    producer.analyzerAuthorityRebindIncident = { ...originalIncident, [field]: replacement };
    await assert.rejects(producer.rebindKnownSealedAnalyzerAuthority(), pattern);
    assert.deepEqual(await fsp.readFile(fx.statePath), fx.preStateBytes);
  }
  producer.analyzerAuthorityRebindIncident = originalIncident;

  const state = JSON.parse(fx.preStateBytes.toString("utf8"));
  const captureArtifact = state.artifacts.find((artifact) => artifact.artifactClass === "raw_capture");
  const captureArtifactPath = path.join(fx.started.sessionDir, ...captureArtifact.path.split("/"));
  const captureArtifactBytes = await fsp.readFile(captureArtifactPath);
  await fsp.writeFile(captureArtifactPath, Buffer.concat([captureArtifactBytes, Buffer.from("tamper")]));
  await assert.rejects(producer.rebindKnownSealedAnalyzerAuthority(), /changed artifact/i);
  await fsp.writeFile(captureArtifactPath, captureArtifactBytes);

  const analyzerRecord = state.measurements.find((record) => record.measurementType === "direction_geometry");
  const analyzerArtifact = state.artifacts.find((artifact) => artifact.evidenceId === analyzerRecord.evidenceId);
  const analyzerArtifactPath = path.join(fx.started.sessionDir, ...analyzerArtifact.path.split("/"));
  const analyzerArtifactBytes = await fsp.readFile(analyzerArtifactPath);
  await fsp.writeFile(analyzerArtifactPath, Buffer.from("{}\n"));
  await assert.rejects(producer.rebindKnownSealedAnalyzerAuthority(), /changed artifact/i);
  await fsp.writeFile(analyzerArtifactPath, analyzerArtifactBytes);
  const analyzerEventPath = path.join(fx.started.sessionDir, "events", `${analyzerRecord.operationId}.json`);
  const analyzerEventBytes = await fsp.readFile(analyzerEventPath);
  const alteredAnalyzerEvent = JSON.parse(analyzerEventBytes.toString("utf8"));
  alteredAnalyzerEvent.request.pointU95Mm += 0.001;
  await fsp.writeFile(analyzerEventPath, canonicalBytes(alteredAnalyzerEvent));
  await assert.rejects(producer.rebindKnownSealedAnalyzerAuthority(), /authority event/i);
  await fsp.writeFile(analyzerEventPath, analyzerEventBytes);
  const targetRecord = state.measurements.find((record) => record.payload.instrument.kind === "protected_target_geometry");
  const targetAuthorityArtifact = state.artifacts.find((artifact) => artifact.evidenceId === targetRecord.evidenceId);
  const targetAuthorityPath = path.join(fx.started.sessionDir, ...targetAuthorityArtifact.path.split("/"));
  const targetAuthorityBytes = await fsp.readFile(targetAuthorityPath);
  await fsp.writeFile(targetAuthorityPath, Buffer.from("{}\n"));
  await assert.rejects(producer.rebindKnownSealedAnalyzerAuthority(), /changed artifact/i);
  await fsp.writeFile(targetAuthorityPath, targetAuthorityBytes);

  for (const [name, pattern] of [
    ["capture-manifest.json", /manifest/i],
    ["source-capture-package.json", /source package/i],
  ]) {
    const filePath = path.join(fx.started.sessionDir, name);
    const bytes = await fsp.readFile(filePath);
    await fsp.writeFile(filePath, Buffer.concat([bytes, Buffer.from(" ")]));
    await assert.rejects(producer.rebindKnownSealedAnalyzerAuthority(), pattern);
    await fsp.writeFile(filePath, bytes);
  }

  const alteredState = structuredClone(state);
  alteredState.failedOperations[0].error = "tampered failure";
  await fsp.writeFile(fx.statePath, canonicalBytes(alteredState));
  await assert.rejects(producer.rebindKnownSealedAnalyzerAuthority(), /pre-state/i);
  await fsp.writeFile(fx.statePath, fx.preStateBytes);

  const mutations = [
    (requests) => { requests.find((request) => request.measurementType === "direction_geometry").pointU95Mm += 0.001; },
    (requests) => { requests.find((request) => request.measurementType === "measurement_repeatability").measuredValue += 0.001; },
    (requests) => { requests.find((request) => request.measurementType === "direction_geometry").sourceSha256 = "6".repeat(64); },
    (requests) => { requests.find((request) => request.measurementType === "direction_geometry").measurementMethod = "fabricated_method"; },
    (requests) => { requests.find((request) => request.measurementType === "measurement_repeatability").measurementAlgorithmVersion = "fabricated_algorithm"; },
    (requests) => { requests.find((request) => request.measurementType === "measurement_repeatability").instrument.instrumentId = "manual-authority"; },
    (requests) => { requests.pop(); },
    (requests) => { requests.push(structuredClone(requests[0])); },
    (requests) => { requests[1] = structuredClone(requests[0]); },
    (requests) => { requests.find((request) => request.measurementType === "print_scale").protectedSpanMm += 1; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(originalRequests);
    mutate(changed);
    fx.derivedRequests = changed;
    await assert.rejects(
      producer.rebindKnownSealedAnalyzerAuthority(),
      /78 authority|duplicate|missing|changed|unchanged|non-analyzer field|identity/i,
    );
    assert.deepEqual(await fsp.readFile(fx.statePath), fx.preStateBytes);
  }
  fx.derivedRequests = originalRequests;

  producer.analyzerAuthorityRebindTestFailpoint = "after-stage";
  await assert.rejects(producer.rebindKnownSealedAnalyzerAuthority(), /FAILPOINT_AFTER_STAGE/);
  assert.deepEqual(await fsp.readFile(fx.statePath), fx.preStateBytes);
  producer.analyzerAuthorityRebindTestFailpoint = "after-backup-rename";
  await assert.rejects(producer.rebindKnownSealedAnalyzerAuthority(), /FAILPOINT_AFTER_BACKUP_RENAME/);
  assert.equal(fs.existsSync(fx.started.sessionDir), false);
  producer.analyzerAuthorityRebindTestFailpoint = undefined;

  const result = await producer.rebindKnownSealedAnalyzerAuthority();
  assert.equal(result.idempotent, false);
  assert.equal(result.status.sealed, true);
  assert.equal(result.status.captureCount, 102);
  assert.equal(result.status.measurementCount, 78);
  assert.equal(result.status.failedOperationCount, 2);
  assert.equal(result.receipt.correctedAuthority.count, 74);
  assert.equal(result.receipt.correctedAnalyzerSha256, originalIncident.correctedAnalyzerSha256);
  const finalState = JSON.parse(await fsp.readFile(fx.statePath, "utf8"));
  assert.equal(sha256(canonicalBytes(finalState.captures)), sha256(canonicalBytes(state.captures)));
  assert.equal(sha256(canonicalBytes(finalState.failedOperations)), sha256(canonicalBytes(state.failedOperations)));
  assert.equal(
    sha256(canonicalBytes(finalState.artifacts.filter((artifact) => ["raw_capture", "normalized_derivative"].includes(artifact.artifactClass)))),
    sha256(canonicalBytes(state.artifacts.filter((artifact) => ["raw_capture", "normalized_derivative"].includes(artifact.artifactClass)))),
  );
  const oldTargetRecords = state.measurements.filter((record) => record.payload.instrument.kind === "protected_target_geometry");
  const newTargetRecords = finalState.measurements.filter((record) => record.payload.instrument.kind === "protected_target_geometry");
  assert.deepEqual(newTargetRecords, oldTargetRecords);
  assert.ok(finalState.measurements.filter((record) => record.payload.instrument.kind === "fixed_rig_geometry")
    .every((record) => record.payload.instrument.calibrationSha256 === originalIncident.correctedAnalyzerSha256));
  const ledgerPath = path.join(fx.started.sessionDir, ...result.receipt.supersededAuthorityLedgerPath.split("/"));
  const ledgerBytes = await fsp.readFile(ledgerPath);
  assert.equal(sha256(ledgerBytes), result.receipt.supersededAuthorityLedgerSha256);
  const ledger = JSON.parse(ledgerBytes);
  assert.equal(ledger.authorityCount, 74);
  for (const entry of ledger.entries) {
    const authorityCopy = await fsp.readFile(path.join(fx.started.sessionDir, ...entry.authorityFile.preservedPath.split("/")));
    const eventCopy = await fsp.readFile(path.join(fx.started.sessionDir, ...entry.eventFile.preservedPath.split("/")));
    assert.equal(sha256(authorityCopy), entry.authorityFile.sha256);
    assert.equal(sha256(eventCopy), entry.eventFile.sha256);
  }
  const replay = await producer.rebindKnownSealedAnalyzerAuthority();
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.receipt, result.receipt);
  assert.equal(replay.status.sessionStateSha256, result.status.sessionStateSha256);
  console.log(`synthetic analyzer-rebind evidence ${JSON.stringify({
    oldStateSha256: originalIncident.expectedPreStateSha256,
    oldManifestSha256: originalIncident.oldCaptureManifestSha256,
    oldSourcePackageSha256: originalIncident.oldSourcePackageSha256,
    newStateSha256: result.status.sessionStateSha256,
    newManifestSha256: result.receipt.newCaptureManifestSha256,
    newSourcePackageSha256: result.receipt.newSourcePackageSha256,
    supersededAuthorityLedgerSha256: result.receipt.supersededAuthorityLedgerSha256,
    receiptSha256: finalState.analyzerAuthorityRebind.receiptSha256,
  })}`);
});

test("product-owner-confirmed target geometry is derived from and bound to the active target", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-protected-target-metrology-"));
  const fixture = await producerFixture(root);
  const sessionId = "calibration-protected-target-metrology";
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
  const instrument = {
    instrumentId: "protected-calibration-target-geometry-v1",
    kind: "protected_target_geometry",
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256: fixture.targetSha256,
    authorityStatement: "product_owner_confirmed_exact_target_geometry_v1",
  };
  const request = {
    sessionId,
    operationId: "protected-target-print-y",
    measurementType: "print_scale",
    axis: "y",
    protectedSpanMm: 200,
    authorityBasis: "protected_checkerboard_geometry",
    measurementMethod: "protected_checkerboard_geometry_authority_v1",
    sourceTargetEvidenceId: "print-verified-calibration-target",
    instrument,
  };
  await assert.rejects(
    fixture.producer.recordMeasurement({
      ...request,
      operationId: "protected-target-wrong-hash",
      instrument: { ...instrument, targetSha256: "d".repeat(64) },
    }),
    /does not match the active session target identity/i,
  );
  const accepted = await fixture.producer.recordMeasurement(request);
  assert.equal(accepted.measurementCount, 1);
  const state = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "capture-session.json"), "utf8"));
  const measurementArtifact = state.artifacts.find((artifact) => artifact.role === "print_scale_verification_y");
  const measurement = JSON.parse(await fsp.readFile(path.join(started.sessionDir, ...measurementArtifact.path.split("/")), "utf8"));
  assert.deepEqual(measurement.instrument, instrument);
  assert.equal(measurement.schemaVersion, "ten-kings-calibration-print-scale-authority-v1");
  assert.equal(measurement.protectedSpanMm, 200);
  assert.equal(measurement.authorityBasis, "protected_checkerboard_geometry");
  assert.equal(measurement.sourceTargetEvidenceId, "print-verified-calibration-target");
  assert.equal(measurement.sourceTargetSha256, fixture.targetSha256);
  assert.equal("nominalSpanMm" in measurement, false);
  assert.equal("measuredSpanMm" in measurement, false);
  assert.equal("measurementU95Mm" in measurement, false);
  assert.equal("manufacturer" in measurement.instrument, false);
  assert.equal("serialNumber" in measurement.instrument, false);
  assert.equal("calibrationSha256" in measurement.instrument, false);
});

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

test("V1.0.1 ordinary low-coverage rejection preserves accepted hashes and resumes the same slot with a new operation ID", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-retry-resume-"));
  const geometryForRequest = ({ request, defaultGeometry }) => request.operationId === "lens-low-coverage-attempt"
    ? {
        ...defaultGeometry,
        corners: {
          topLeft: { x: 300, y: 450 }, topRight: { x: 700, y: 450 },
          bottomRight: { x: 700, y: 950 }, bottomLeft: { x: 300, y: 950 },
        },
        boundingBox: { x: 300, y: 450, width: 400, height: 500 },
      }
    : defaultGeometry;
  const fixture = await producerFixture(root, { geometryForRequest });
  const sessionId = "calibration-v1-retry-resume";
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
  await fixture.producer.captureStep({
    sessionId, operationId: "lens-accepted-1", role: "lens_geometry", sampleIndex: 1, targetFace: "checkerboard",
  });
  const before = await fixture.producer.status(sessionId);
  const acceptedBefore = structuredClone(before.acceptedCaptureHistory);
  await assert.rejects(
    fixture.producer.captureStep({
      sessionId, operationId: "lens-prior-geometry-reuse", role: "lens_geometry", sampleIndex: 2,
      targetFace: "checkerboard", normalizationSourceOperationId: "lens-accepted-1",
    }),
    /server-owned.*may not be supplied/i,
  );
  await assert.rejects(
    fixture.producer.captureStep({
      sessionId, operationId: "lens-low-coverage-attempt", role: "lens_geometry", sampleIndex: 2, targetFace: "checkerboard",
    }),
    /coverage .* below centralized minimum/i,
  );
  const failed = await fixture.producer.status(sessionId);
  assert.equal(failed.captureCount, 1);
  assert.equal(failed.nextCaptureSlot.slotKey, "lens_geometry:none:2");
  assert.equal(failed.retryAllowed, true);
  assert.equal(failed.failedAttempts.at(-1).operationId, "lens-low-coverage-attempt");
  assert.match(failed.failedAttempts.at(-1).candidateRawSha256, /^[a-f0-9]{64}$/);
  assert.match(failed.failedAttempts.at(-1).candidateCapturedAt, /^2026-07-18T20:00:00/);
  assert.equal(failed.failedAttempts.at(-1).candidatePose.coverageFraction, 0.142857);
  assert.deepEqual(failed.acceptedCaptureHistory, acceptedBefore);
  await assert.rejects(
    fixture.producer.captureStep({
      sessionId, operationId: "lens-low-coverage-attempt", role: "lens_geometry", sampleIndex: 2, targetFace: "checkerboard",
    }),
    /operationId cannot be reused/i,
  );

  const restarted = await producerFixture(root, { geometryForRequest });
  const resumed = await restarted.producer.start({ ...startRequest(restarted.targetSha256, sessionId), resume: true });
  assert.equal(resumed.retryAllowed, true);
  assert.deepEqual(resumed.acceptedCaptureHistory, acceptedBefore);
  const retried = await restarted.producer.captureStep({
    sessionId, operationId: "lens-retry-new-operation", role: "lens_geometry", sampleIndex: 2, targetFace: "checkerboard",
  });
  assert.equal(retried.captureCount, 2);
  assert.equal(retried.retryAllowed, false);
  assert.deepEqual(retried.acceptedCaptureHistory.slice(0, 1), acceptedBefore);
  assert.equal(fs.existsSync(path.join(started.sessionDir, "evidence", "raw", "lens_geometry-all-02-lens-low-coverage-attempt.png")), false);
  assert.equal(fs.existsSync(path.join(started.sessionDir, "evidence", "normalized", "lens_geometry-all-02-lens-low-coverage-attempt.png")), false);
});

test("V1.0.1 restart resume hard-stops immutable accepted-artifact corruption", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-resume-integrity-"));
  const fixture = await producerFixture(root);
  const sessionId = "calibration-v1-resume-integrity";
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
  const accepted = await fixture.producer.captureStep({
    sessionId, operationId: "resume-integrity-accepted", role: "lens_geometry", sampleIndex: 1, targetFace: "checkerboard",
  });
  const raw = accepted.acceptedCaptureHistory[0];
  await fsp.writeFile(path.join(started.sessionDir, "evidence", "raw", raw.rawEvidenceId.replace(/-raw$/, "") + ".png"), Buffer.from("tampered"));
  const restarted = await producerFixture(root);
  await assert.rejects(
    restarted.producer.start({ ...startRequest(restarted.targetSha256, sessionId), resume: true }),
    /immutable SHA-256\/size verification/i,
  );
  const stopped = await restarted.producer.status(sessionId);
  assert.equal(stopped.hardStop.operationId, "session-resume");
  assert.match(stopped.hardStop.reason, /immutable SHA-256\/size verification/i);
});

test("V1.0.1 blank-reverse normalization establishes one exact source, then reuses only server-selected same-session geometry", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-blank-geometry-reuse-"));
  const fixture = await producerFixture(root, {
    normalizationFailureOperationIds: new Set(["blank-first-detection-failed"]),
  });
  const sessionId = "calibration-v1-blank-geometry-reuse";
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
  await assert.rejects(
    fixture.producer.captureStep({
      sessionId,
      operationId: "blank-first-detection-failed",
      role: "dark_control",
      channelIndex: 1,
      sampleIndex: 1,
      targetFace: "blank_reverse",
    }),
    /must preserve raw bytes and produce a normalized derivative/i,
  );
  assert.equal(fixture.normalizationInputs.at(-1).reusableGeometry, undefined, "the first blank must use exact-frame detection");
  const first = await fixture.producer.captureStep({
    sessionId,
    operationId: "blank-first-accepted",
    role: "dark_control",
    channelIndex: 1,
    sampleIndex: 1,
    targetFace: "blank_reverse",
  });
  assert.equal(first.captureCount, 1);
  assert.equal(fixture.normalizationInputs.at(-1).reusableGeometry, undefined, "no source exists until the first blank is accepted");
  const stateBefore = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "capture-session.json"), "utf8"));
  const sourceRecord = stateBefore.captures[0];
  const sourceArtifactsBefore = stateBefore.artifacts
    .filter((artifact) => artifact.operationId === sourceRecord.operationId)
    .map((artifact) => structuredClone(artifact));
  const sourceBytesBefore = await Promise.all(sourceArtifactsBefore.map(async (artifact) => ({
    evidenceId: artifact.evidenceId,
    bytes: await fsp.readFile(path.join(started.sessionDir, ...artifact.path.split("/"))),
  })));

  const second = await fixture.producer.captureStep({
    sessionId,
    operationId: "blank-second-accepted",
    role: "dark_control",
    channelIndex: 1,
    sampleIndex: 2,
    targetFace: "blank_reverse",
  });
  assert.equal(second.captureCount, 2);
  const secondInput = fixture.normalizationInputs.find((input) => input.sourceImageId.includes("blank-second-accepted"));
  assert.ok(secondInput?.reusableGeometry, "the later blank must receive verified server-owned geometry");
  assert.equal(secondInput.reusableGeometry.sourceImageId, sourceRecord.rawEvidenceId);
  const stateAfter = JSON.parse(await fsp.readFile(path.join(started.sessionDir, "capture-session.json"), "utf8"));
  assert.deepEqual(
    stateAfter.artifacts.filter((artifact) => artifact.operationId === sourceRecord.operationId),
    sourceArtifactsBefore,
    "accepted source metadata must remain byte-for-byte immutable",
  );
  for (const snapshot of sourceBytesBefore) {
    assert.deepEqual(
      await fsp.readFile(path.join(started.sessionDir, ...stateAfter.artifacts.find((artifact) => artifact.evidenceId === snapshot.evidenceId).path.split("/"))),
      snapshot.bytes,
    );
  }
  const secondNormalized = stateAfter.artifacts.find(
    (artifact) => artifact.operationId === "blank-second-accepted" && artifact.artifactClass === "normalized_derivative",
  );
  assert.deepEqual(secondNormalized.normalization.geometryAuthority, {
    kind: "same_session_accepted_blank_reverse_v1",
    sourceSessionId: sessionId,
    sourceOperationId: sourceRecord.operationId,
    sourceRawEvidenceId: sourceRecord.rawEvidenceId,
    sourceRawSha256: stateAfter.artifacts.find((artifact) => artifact.evidenceId === sourceRecord.rawEvidenceId).sha256,
    sourceNormalizedEvidenceId: sourceRecord.normalizedEvidenceId,
    sourceNormalizedSha256: stateAfter.artifacts.find((artifact) => artifact.evidenceId === sourceRecord.normalizedEvidenceId).sha256,
    sourceGeometrySha256: sha256(await fsp.readFile(path.join(started.sessionDir, "working", `${sourceRecord.normalizedEvidenceId}-geometry.json`))),
  });

  const capturesBeforeCheckerboard = fixture.captureCount;
  await fixture.producer.captureStep({
    sessionId,
    operationId: "checkerboard-after-blank-source",
    role: "repeated_placement",
    sampleIndex: 1,
    targetFace: "checkerboard",
    removeReseatCycleId: "checkerboard-after-blank-source-cycle",
  });
  assert.equal(fixture.captureCount, capturesBeforeCheckerboard + 1);
  assert.equal(
    fixture.normalizationInputs.find((input) => input.sourceImageId.includes("checkerboard-after-blank-source")).reusableGeometry,
    undefined,
    "checkerboard roles must continue exact-still redetection",
  );
});

test("V1.0.1 blank authority preserves high-precision capturedAt while requiring exact ECMAScript-millisecond geometry time", async (t) => {
  const acceptedRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-blank-time-canonical-"));
  const acceptedFixture = await producerFixture(acceptedRoot, {
    capturedAtForRequest: ({ request, defaultCapturedAt }) => request.operationId === "blank-time-source"
      ? "2026-07-22T10:55:23.4175556Z"
      : defaultCapturedAt,
    geometryTimestampForRequest: ({ capturedAt }) => new Date(capturedAt).toISOString(),
  });
  const acceptedSessionId = "calibration-v1-blank-time-canonical";
  const acceptedStarted = await acceptedFixture.producer.start(startRequest(acceptedFixture.targetSha256, acceptedSessionId));
  await acceptedFixture.producer.captureStep({
    sessionId: acceptedSessionId,
    operationId: "blank-time-source",
    role: "dark_control",
    channelIndex: 1,
    sampleIndex: 1,
    targetFace: "blank_reverse",
  });
  const accepted = await acceptedFixture.producer.captureStep({
    sessionId: acceptedSessionId,
    operationId: "blank-time-reuse",
    role: "dark_control",
    channelIndex: 1,
    sampleIndex: 2,
    targetFace: "blank_reverse",
  });
  assert.equal(accepted.captureCount, 2);
  const acceptedState = JSON.parse(await fsp.readFile(path.join(acceptedStarted.sessionDir, "capture-session.json"), "utf8"));
  const source = acceptedState.captures[0];
  assert.equal(source.capturedAt, "2026-07-22T10:55:23.4175556Z");
  assert.equal(acceptedState.artifacts.find((artifact) => artifact.evidenceId === source.rawEvidenceId).capturedAt, source.capturedAt);
  assert.equal(acceptedState.artifacts.find((artifact) => artifact.evidenceId === source.normalizedEvidenceId).capturedAt, source.capturedAt);
  const acceptedGeometry = JSON.parse(await fsp.readFile(
    path.join(acceptedStarted.sessionDir, "working", `${source.normalizedEvidenceId}-geometry.json`),
    "utf8",
  ));
  assert.equal(acceptedGeometry.timestamp, "2026-07-22T10:55:23.417Z");

  const rejectionCases = [
    ["one-millisecond mismatch", async ({ geometryPath }) => {
      const geometry = JSON.parse(await fsp.readFile(geometryPath, "utf8"));
      geometry.timestamp = "2026-07-22T10:55:23.418Z";
      await fsp.writeFile(geometryPath, `${JSON.stringify(geometry)}\n`);
    }],
    ["noncanonical equivalent geometry time", async ({ geometryPath }) => {
      const geometry = JSON.parse(await fsp.readFile(geometryPath, "utf8"));
      geometry.timestamp = "2026-07-22T10:55:23.4170Z";
      await fsp.writeFile(geometryPath, `${JSON.stringify(geometry)}\n`);
    }],
    ["invalid source time", async ({ state, statePath }) => {
      state.captures[0].capturedAt = "2026-02-30T10:55:23.4175556Z";
      for (const artifact of state.artifacts.filter((candidate) => candidate.operationId === state.captures[0].operationId)) {
        artifact.capturedAt = state.captures[0].capturedAt;
      }
      await fsp.writeFile(statePath, `${JSON.stringify(state)}\n`);
    }],
  ];
  for (const [label, tamper] of rejectionCases) {
    await t.test(label, async () => {
      const root = await fsp.mkdtemp(path.join(os.tmpdir(), `tk-calibration-v1-blank-time-${label.replaceAll(" ", "-")}-`));
      const fixture = await producerFixture(root, {
        capturedAtForRequest: ({ request, defaultCapturedAt }) => request.operationId === "blank-time-source"
          ? "2026-07-22T10:55:23.4175556Z"
          : defaultCapturedAt,
        geometryTimestampForRequest: ({ capturedAt }) => new Date(capturedAt).toISOString(),
      });
      const sessionId = `calibration-v1-blank-time-${crypto.randomUUID()}`;
      const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
      await fixture.producer.captureStep({
        sessionId,
        operationId: "blank-time-source",
        role: "dark_control",
        channelIndex: 1,
        sampleIndex: 1,
        targetFace: "blank_reverse",
      });
      const statePath = path.join(started.sessionDir, "capture-session.json");
      const state = JSON.parse(await fsp.readFile(statePath, "utf8"));
      const geometryPath = path.join(started.sessionDir, "working", `${state.captures[0].normalizedEvidenceId}-geometry.json`);
      await tamper({ state, statePath, geometryPath });
      await assert.rejects(
        fixture.producer.captureStep({
          sessionId,
          operationId: "blank-time-rejected-reuse",
          role: "dark_control",
          channelIndex: 1,
          sampleIndex: 2,
          targetFace: "blank_reverse",
        }),
        /blank-reverse.*timestamp|capturedAt.*valid UTC timestamp/i,
      );
      assert.equal(fixture.captureCount, 1, "timestamp rejection must occur before capture lifecycle work");
      assert.ok((await fixture.producer.status(sessionId)).hardStop);
    });
  }
});

test("V1.0.1 rejects blank-geometry tamper and browser-selected, cross-session, or wrong-settings authority before capture", async (t) => {
  const tamperCases = [
    ["geometry-file", async ({ state, sessionDir }) => {
      const source = state.captures[0];
      const geometryPath = path.join(sessionDir, "working", `${source.normalizedEvidenceId}-geometry.json`);
      const geometry = JSON.parse(await fsp.readFile(geometryPath, "utf8"));
      geometry.warnings = ["tampered"];
      await fsp.writeFile(geometryPath, `${JSON.stringify(geometry)}\n`);
    }],
    ["pose", async ({ state, statePath }) => {
      state.artifacts.find((artifact) => artifact.evidenceId === state.captures[0].rawEvidenceId).pose.rotationDegrees += 0.25;
      await fsp.writeFile(statePath, `${JSON.stringify(state)}\n`);
    }],
    ["artifact-link", async ({ state, statePath }) => {
      state.artifacts.find((artifact) => artifact.evidenceId === state.captures[0].normalizedEvidenceId).parentEvidenceId = "fabricated-parent";
      await fsp.writeFile(statePath, `${JSON.stringify(state)}\n`);
    }],
    ["artifact-hash", async ({ state, statePath }) => {
      state.artifacts.find((artifact) => artifact.evidenceId === state.captures[0].rawEvidenceId).sha256 = "f".repeat(64);
      await fsp.writeFile(statePath, `${JSON.stringify(state)}\n`);
    }],
  ];
  for (const [label, tamper] of tamperCases) {
    await t.test(`${label} tamper`, async () => {
      const root = await fsp.mkdtemp(path.join(os.tmpdir(), `tk-calibration-v1-blank-tamper-${label}-`));
      const fixture = await producerFixture(root);
      const sessionId = `calibration-v1-blank-tamper-${label}`;
      const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
      await fixture.producer.captureStep({
        sessionId, operationId: `blank-source-${label}`, role: "dark_control", channelIndex: 1, sampleIndex: 1, targetFace: "blank_reverse",
      });
      const statePath = path.join(started.sessionDir, "capture-session.json");
      const state = JSON.parse(await fsp.readFile(statePath, "utf8"));
      const acceptedBefore = structuredClone(state.captures);
      await tamper({ state, statePath, sessionDir: started.sessionDir });
      await assert.rejects(
        fixture.producer.captureStep({
          sessionId, operationId: `blank-after-${label}-tamper`, role: "dark_control", channelIndex: 1, sampleIndex: 2, targetFace: "blank_reverse",
        }),
        /blank-reverse geometry|immutable SHA-256|authority/i,
      );
      assert.equal(fixture.captureCount, 1, "authority tamper must be rejected before the capture boundary");
      const stopped = await fixture.producer.status(sessionId);
      assert.ok(stopped.hardStop, "accepted authority corruption is a durable hard stop");
      const after = JSON.parse(await fsp.readFile(statePath, "utf8"));
      assert.deepEqual(after.captures, acceptedBefore, "tamper rejection must not supersede accepted capture records");
    });
  }

  await t.test("manual cross-session source and wrong settings", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-blank-cross-session-"));
    const fixture = await producerFixture(root);
    const sessionA = "calibration-v1-blank-source-session-a";
    const startedA = await fixture.producer.start(startRequest(fixture.targetSha256, sessionA));
    await fixture.producer.captureStep({
      sessionId: sessionA, operationId: "blank-source-session-a", role: "dark_control", channelIndex: 1, sampleIndex: 1, targetFace: "blank_reverse",
    });
    const sessionB = "calibration-v1-blank-source-session-b";
    await fixture.producer.start(startRequest(fixture.targetSha256, sessionB));
    const captureCountBefore = fixture.captureCount;
    await assert.rejects(
      fixture.producer.captureStep({
        sessionId: sessionB,
        operationId: "manual-cross-session-source",
        role: "dark_control",
        channelIndex: 1,
        sampleIndex: 1,
        targetFace: "blank_reverse",
        normalizationSourceOperationId: "blank-source-session-a",
      }),
      /server-owned.*may not be supplied/i,
    );
    assert.equal(fixture.captureCount, captureCountBefore);
    assert.equal((await fixture.producer.status(sessionB)).hardStop, null, "manual preflight rejection must not brick a healthy session");

    const wrongSettings = await producerFixture(root, {
      requestRegistry: fixture.requests,
      protectedSettings: { exposureUs: 6300 },
    });
    await assert.rejects(
      wrongSettings.producer.start({ ...startRequest(wrongSettings.targetSha256, sessionA), resume: true }),
      /identity\/settings mismatch/i,
    );
    assert.equal(wrongSettings.captureCount, 0);
    const stoppedA = JSON.parse(await fsp.readFile(path.join(startedA.sessionDir, "capture-session.json"), "utf8"));
    assert.equal(stoppedA.captures.length, 1);
  });
});

test("V1.0.1 resumes the preserved 32-capture blank failure at the exact pending slot with a new operation ID", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-existing-32-resume-"));
  const requestRegistry = new Map();
  const fixture = await producerFixture(root, {
    requestRegistry,
    normalizationFailureOperationIds: new Set(["dark-control-1-3-old-failure"]),
  });
  const sessionId = "math-cal-v1-20260722-4cfa410c-01-fixture";
  const started = await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
  for (const role of ["lens_geometry", "normalization_registration", "repeated_placement"]) {
    for (let sampleIndex = 1; sampleIndex <= 10; sampleIndex += 1) {
      await fixture.producer.captureStep({
        sessionId,
        operationId: `${role}-accepted-${sampleIndex}`,
        role,
        sampleIndex,
        targetFace: "checkerboard",
        ...(role === "repeated_placement" ? { removeReseatCycleId: `preserved-reseat-${sampleIndex}` } : {}),
      });
    }
  }
  for (const sampleIndex of [1, 2]) {
    await fixture.producer.captureStep({
      sessionId,
      operationId: `dark-control-1-${sampleIndex}-accepted`,
      role: "dark_control",
      channelIndex: 1,
      sampleIndex,
      targetFace: "blank_reverse",
    });
  }
  await assert.rejects(
    fixture.producer.captureStep({
      sessionId,
      operationId: "dark-control-1-3-old-failure",
      role: "dark_control",
      channelIndex: 1,
      sampleIndex: 3,
      targetFace: "blank_reverse",
    }),
    /must preserve raw bytes and produce a normalized derivative/i,
  );
  const failed = await fixture.producer.status(sessionId);
  assert.equal(failed.captureCount, 32);
  assert.equal(failed.nextCaptureSlot.slotKey, "dark_control:1:3");
  assert.equal(failed.retryAllowed, true);
  assert.equal(failed.failedAttempts.at(-1).operationId, "dark-control-1-3-old-failure");
  assert.equal(
    fs.existsSync(path.join(started.sessionDir, "working", "dark-control-1-3-old-failure", "dark_control-1-03-dark-control-1-3-old-failure-raw-working.png")),
    true,
    "the rejected exact raw remains preserved as failed-attempt evidence",
  );
  const statePath = path.join(started.sessionDir, "capture-session.json");
  const stateBefore = JSON.parse(await fsp.readFile(statePath, "utf8"));
  const acceptedArtifactsBefore = stateBefore.artifacts
    .filter((artifact) => artifact.artifactClass === "raw_capture" || artifact.artifactClass === "normalized_derivative")
    .map((artifact) => structuredClone(artifact));
  const acceptedBytesBefore = new Map(await Promise.all(acceptedArtifactsBefore.map(async (artifact) => [
    artifact.evidenceId,
    await fsp.readFile(path.join(started.sessionDir, ...artifact.path.split("/"))),
  ])));

  const restarted = await producerFixture(root, { requestRegistry });
  const resumed = await restarted.producer.start({ ...startRequest(restarted.targetSha256, sessionId), resume: true });
  assert.equal(resumed.captureCount, 32);
  assert.equal(resumed.nextCaptureSlot.slotKey, "dark_control:1:3");
  const retried = await restarted.producer.captureStep({
    sessionId,
    operationId: "dark-control-1-3-new-retry",
    role: "dark_control",
    channelIndex: 1,
    sampleIndex: 3,
    targetFace: "blank_reverse",
  });
  assert.equal(retried.captureCount, 33);
  assert.equal(retried.failedAttempts.at(-1).operationId, "dark-control-1-3-old-failure");
  assert.notEqual(retried.acceptedCaptureHistory.at(-1).operationId, "dark-control-1-3-old-failure");
  assert.equal(retried.acceptedCaptureHistory.at(-1).operationId, "dark-control-1-3-new-retry");
  assert.equal(restarted.captureCount, 1, "hardware-free restart fixture executes only the requested new capture boundary");
  const stateAfter = JSON.parse(await fsp.readFile(statePath, "utf8"));
  const retryNormalized = stateAfter.artifacts.find(
    (artifact) => artifact.operationId === "dark-control-1-3-new-retry" && artifact.artifactClass === "normalized_derivative",
  );
  assert.equal(
    retryNormalized.normalization.geometryAuthority.sourceOperationId,
    "dark-control-1-1-accepted",
    "resume must keep the first accepted blank as authority rather than selecting the newest capture",
  );
  assert.deepEqual(
    stateAfter.artifacts
      .filter((artifact) => acceptedBytesBefore.has(artifact.evidenceId))
      .map((artifact) => artifact),
    acceptedArtifactsBefore,
    "all 32 previously accepted capture artifacts remain immutable",
  );
  for (const [evidenceId, bytes] of acceptedBytesBefore) {
    const artifact = stateAfter.artifacts.find((candidate) => candidate.evidenceId === evidenceId);
    assert.deepEqual(await fsp.readFile(path.join(started.sessionDir, ...artifact.path.split("/"))), bytes);
  }
});

test("V1.0.1 incident-bound recovery preserves all 32 accepted captures, writes one receipt, and resumes only dark_control:1:3", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-false-stop-recovery-"));
  const incident = await auditedFalseStopFixture(root);
  const stateBefore = JSON.parse(await fsp.readFile(incident.statePath, "utf8"));
  const acceptedCapturesBefore = structuredClone(stateBefore.captures);
  const acceptedArtifactsBefore = stateBefore.artifacts
    .filter((artifact) => artifact.artifactClass === "raw_capture" || artifact.artifactClass === "normalized_derivative")
    .map((artifact) => structuredClone(artifact));
  const acceptedBytesBefore = new Map(await Promise.all(acceptedArtifactsBefore.map(async (artifact) => [
    artifact.evidenceId,
    await fsp.readFile(path.join(incident.started.sessionDir, ...artifact.path.split("/"))),
  ])));
  const acceptedEventBytesBefore = new Map(await Promise.all(acceptedCapturesBefore.map(async (capture) => [
    capture.operationId,
    await fsp.readFile(path.join(incident.started.sessionDir, "events", `${capture.operationId}.json`)),
  ])));

  const recovered = await incident.fixture.producer.recoverKnownBlankReverseTimestampFalseStop(incident.sessionId);
  assert.equal(recovered.idempotent, false);
  assert.equal(recovered.status.captureCount, 32);
  assert.equal(recovered.status.hardStop, null);
  assert.equal(recovered.status.retryAllowed, true);
  assert.equal(recovered.status.nextCaptureSlot.slotKey, "dark_control:1:3");
  assert.equal(recovered.recovery.preRecoveryStateSha256, incident.preStateSha256);
  assert.match(recovered.recovery.receiptSha256, /^[a-f0-9]{64}$/);
  const receiptPath = path.join(incident.started.sessionDir, ...recovered.recovery.receiptPath.split("/"));
  const receiptBytes = await fsp.readFile(receiptPath);
  assert.equal(sha256(receiptBytes), recovered.recovery.receiptSha256);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert.equal(receipt.acceptedEvidence.captureCount, 32);
  assert.equal(receipt.acceptedEvidence.artifactCount, 64);
  assert.equal(receipt.verifiedBlankReverseAuthority.sourceOperationId, "dark-control-1-1-accepted");

  const recoveredState = JSON.parse(await fsp.readFile(incident.statePath, "utf8"));
  assert.equal(recoveredState.hardStop, undefined);
  assert.equal(recoveredState.failedOperations.at(-1).operationId, incident.recoveryContract.operationId);
  assert.equal(recoveredState.failedOperations.at(-1).error, incident.recoveryContract.reason);
  assert.deepEqual(recoveredState.captures, acceptedCapturesBefore);
  assert.deepEqual(
    recoveredState.artifacts.filter((artifact) => artifact.artifactClass === "raw_capture" || artifact.artifactClass === "normalized_derivative"),
    acceptedArtifactsBefore,
  );
  for (const [evidenceId, bytes] of acceptedBytesBefore) {
    const artifact = recoveredState.artifacts.find((candidate) => candidate.evidenceId === evidenceId);
    assert.deepEqual(await fsp.readFile(path.join(incident.started.sessionDir, ...artifact.path.split("/"))), bytes);
  }
  for (const [operationId, bytes] of acceptedEventBytesBefore) {
    assert.deepEqual(await fsp.readFile(path.join(incident.started.sessionDir, "events", `${operationId}.json`)), bytes);
  }

  const stateAfterFirstRecovery = await fsp.readFile(incident.statePath);
  const receiptAfterFirstRecovery = await fsp.readFile(receiptPath);
  const secondRecovery = await incident.fixture.producer.recoverKnownBlankReverseTimestampFalseStop(incident.sessionId);
  assert.equal(secondRecovery.idempotent, true);
  assert.deepEqual(await fsp.readFile(incident.statePath), stateAfterFirstRecovery);
  assert.deepEqual(await fsp.readFile(receiptPath), receiptAfterFirstRecovery);

  const restarted = await producerFixture(root, {
    requestRegistry: incident.requestRegistry,
    geometryTimestampForRequest: ({ capturedAt }) => new Date(capturedAt).toISOString(),
  });
  const resumed = await restarted.producer.start({ ...startRequest(restarted.targetSha256, incident.sessionId), resume: true });
  assert.equal(resumed.captureCount, 32);
  assert.equal(resumed.nextCaptureSlot.slotKey, "dark_control:1:3");
  const retried = await restarted.producer.captureStep({
    sessionId: incident.sessionId,
    operationId: "dark-control-1-3-after-audited-recovery",
    role: "dark_control",
    channelIndex: 1,
    sampleIndex: 3,
    targetFace: "blank_reverse",
  });
  assert.equal(retried.captureCount, 33);
  assert.equal(retried.acceptedCaptureHistory.at(-1).operationId, "dark-control-1-3-after-audited-recovery");
  assert.equal(retried.failedAttempts.at(-1).operationId, incident.recoveryContract.operationId);
  assert.equal(restarted.captureCount, 1, "recovery and restart must not execute hardware before the new exact retry");
});

test("V1.0.1 incident-bound recovery rejects wrong identity, state, failure, slot, candidate evidence, and accepted-authority tamper", async (t) => {
  const baselineRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "tk-calibration-v1-false-stop-adversarial-baseline-"));
  const baseline = await auditedFalseStopFixture(baselineRoot);

  async function isolatedCase(label) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), `tk-calibration-v1-false-stop-${label}-`));
    await fsp.cp(baselineRoot, root, { recursive: true });
    const fixture = await producerFixture(root, {
      requestRegistry: baseline.requestRegistry,
      geometryTimestampForRequest: ({ capturedAt }) => new Date(capturedAt).toISOString(),
    });
    const statePath = path.join(root, "calibration-sessions", baseline.sessionId, "capture-session.json");
    const sessionDir = path.dirname(statePath);
    const contract = structuredClone(baseline.recoveryContract);
    fixture.producer.blankReverseTimestampFalseStopRecovery = contract;
    return { fixture, statePath, sessionDir, contract };
  }

  await t.test("wrong bridge-bound session", async () => {
    const item = await isolatedCase("wrong-session");
    const before = await fsp.readFile(item.statePath);
    await assert.rejects(
      item.fixture.producer.recoverKnownBlankReverseTimestampFalseStop("wrong-session"),
      /bound only to its exact audited V1\.0\.1 session/i,
    );
    assert.deepEqual(await fsp.readFile(item.statePath), before);
  });

  const stateMutationCases = [
    ["wrong-state-sha", (state) => { state.updatedAt = "2026-07-22T11:00:00.001Z"; }, false, /pre-state SHA-256/i],
    ["wrong-operation", (state) => {
      state.hardStop.operationId = "wrong-hard-stop-operation";
      state.failedOperations.at(-1).operationId = "wrong-hard-stop-operation";
    }, true, /exact false-stop operation/i],
    ["wrong-reason", (state) => {
      state.hardStop.reason = "unrelated hard stop";
      state.failedOperations.at(-1).error = "unrelated hard stop";
    }, true, /exact false-stop operation/i],
    ["wrong-slot", (state) => { state.failedOperations.at(-1).slotKey = "dark_control:1:2"; }, true, /pending slot/i],
    ["candidate-evidence", (state) => { state.failedOperations.at(-1).candidateRawSha256 = "a".repeat(64); }, true, /preserved evidence counts/i],
  ];
  for (const [label, mutate, rebindStateSha, expectedError] of stateMutationCases) {
    await t.test(label, async () => {
      const item = await isolatedCase(label);
      const state = JSON.parse(await fsp.readFile(item.statePath, "utf8"));
      mutate(state);
      await fsp.writeFile(item.statePath, canonicalBytes(state));
      if (rebindStateSha) item.contract.expectedPreStateSha256 = sha256(canonicalBytes(state));
      const before = await fsp.readFile(item.statePath);
      await assert.rejects(
        item.fixture.producer.recoverKnownBlankReverseTimestampFalseStop(baseline.sessionId),
        expectedError,
      );
      assert.deepEqual(await fsp.readFile(item.statePath), before);
      assert.equal(fs.existsSync(path.join(item.sessionDir, "events", `${item.contract.recoveryId}.json`)), false);
    });
  }

  await t.test("accepted artifact byte tamper", async () => {
    const item = await isolatedCase("artifact-tamper");
    const state = JSON.parse(await fsp.readFile(item.statePath, "utf8"));
    const raw = state.artifacts.find((artifact) => artifact.artifactClass === "raw_capture");
    await fsp.writeFile(path.join(item.sessionDir, ...raw.path.split("/")), Buffer.from("tampered accepted bytes"));
    const before = await fsp.readFile(item.statePath);
    await assert.rejects(
      item.fixture.producer.recoverKnownBlankReverseTimestampFalseStop(baseline.sessionId),
      /immutable SHA-256\/size verification/i,
    );
    assert.deepEqual(await fsp.readFile(item.statePath), before);
  });

  await t.test("unreferenced candidate operation evidence", async () => {
    const item = await isolatedCase("candidate-file");
    const candidateDir = path.join(item.sessionDir, "working", item.contract.operationId);
    await fsp.mkdir(candidateDir, { recursive: true });
    await fsp.writeFile(path.join(candidateDir, "unexpected-raw.png"), Buffer.from("unexpected candidate"));
    const before = await fsp.readFile(item.statePath);
    await assert.rejects(
      item.fixture.producer.recoverKnownBlankReverseTimestampFalseStop(baseline.sessionId),
      /exact false-stop operation.*preserved evidence counts/i,
    );
    assert.deepEqual(await fsp.readFile(item.statePath), before);
  });

  await t.test("accepted capture event tamper", async () => {
    const item = await isolatedCase("event-tamper");
    const state = JSON.parse(await fsp.readFile(item.statePath, "utf8"));
    const capture = state.captures[0];
    const eventPath = path.join(item.sessionDir, "events", `${capture.operationId}.json`);
    const event = JSON.parse(await fsp.readFile(eventPath, "utf8"));
    event.request.targetFace = "blank_reverse";
    await fsp.writeFile(eventPath, canonicalBytes(event));
    const before = await fsp.readFile(item.statePath);
    await assert.rejects(
      item.fixture.producer.recoverKnownBlankReverseTimestampFalseStop(baseline.sessionId),
      /event does not reproduce its immutable request/i,
    );
    assert.deepEqual(await fsp.readFile(item.statePath), before);
  });

  await t.test("manually fabricated pre-existing recovery receipt", async () => {
    const item = await isolatedCase("fabricated-receipt");
    const receiptPath = path.join(item.sessionDir, "events", `${item.contract.recoveryId}.json`);
    await fsp.writeFile(receiptPath, canonicalBytes({
      schemaVersion: "manual-fabrication",
      recoveryId: item.contract.recoveryId,
      recoveredAt: "2026-07-22T11:00:00.000Z",
    }));
    const before = await fsp.readFile(item.statePath);
    await assert.rejects(
      item.fixture.producer.recoverKnownBlankReverseTimestampFalseStop(baseline.sessionId),
      /does not reproduce the exact audited pre-state evidence/i,
    );
    assert.deepEqual(await fsp.readFile(item.statePath), before);
  });

  await t.test("accepted blank geometry timestamp tamper", async () => {
    const item = await isolatedCase("geometry-tamper");
    const state = JSON.parse(await fsp.readFile(item.statePath, "utf8"));
    const source = state.captures.find((capture) => capture.operationId === "dark-control-1-1-accepted");
    const geometryPath = path.join(item.sessionDir, "working", `${source.normalizedEvidenceId}-geometry.json`);
    const geometry = JSON.parse(await fsp.readFile(geometryPath, "utf8"));
    geometry.timestamp = "2026-07-22T10:55:23.418Z";
    await fsp.writeFile(geometryPath, `${JSON.stringify(geometry)}\n`);
    const before = await fsp.readFile(item.statePath);
    await assert.rejects(
      item.fixture.producer.recoverKnownBlankReverseTimestampFalseStop(baseline.sessionId),
      /canonical millisecond timestamp/i,
    );
    assert.deepEqual(await fsp.readFile(item.statePath), before);
  });
});

test("V1.0.1 lens and normalization tenth-pose aggregate rejection leaves nine hashes unchanged and accepts a corrected retry", async (t) => {
  const poseGeometry = ({ request, defaultGeometry }) => {
    const testedRole = request.operationId.startsWith("lens-test-")
      ? "lens_geometry"
      : request.operationId.startsWith("normalization-test-")
        ? "normalization_registration"
        : undefined;
    if (!testedRole) return defaultGeometry;
    const goodRetry = request.operationId.endsWith("-good-retry");
    const sample = request.sampleIndex;
    const centerX = goodRetry ? 560 : 480 + ((sample - 1) % 3) * 20;
    const centerY = goodRetry ? 820 : 680 + (Math.floor((sample - 1) / 3) % 3) * 20;
    const rotationDegrees = goodRetry ? 3 : -0.5 + ((sample - 1) % 3) * 0.5;
    return {
      ...defaultGeometry,
      corners: {
        topLeft: { x: centerX - 300, y: centerY - 450 }, topRight: { x: centerX + 300, y: centerY - 450 },
        bottomRight: { x: centerX + 300, y: centerY + 450 }, bottomLeft: { x: centerX - 300, y: centerY + 450 },
      },
      boundingBox: { x: centerX - 300, y: centerY - 450, width: 600, height: 900 },
      rotationDegrees,
    };
  };
  for (const role of ["lens_geometry", "normalization_registration"]) {
    await t.test(role, async () => {
      const root = await fsp.mkdtemp(path.join(os.tmpdir(), `tk-calibration-v1-aggregate-${role}-`));
      const fixture = await producerFixture(root, { geometryForRequest: poseGeometry });
      const sessionId = `calibration-v1-aggregate-${role}`;
      await fixture.producer.start(startRequest(fixture.targetSha256, sessionId));
      if (role === "normalization_registration") {
        for (let sampleIndex = 1; sampleIndex <= 10; sampleIndex += 1) {
          await fixture.producer.captureStep({
            sessionId, operationId: `prerequisite-lens-${sampleIndex}`, role: "lens_geometry", sampleIndex, targetFace: "checkerboard",
          });
        }
      }
      for (let sampleIndex = 1; sampleIndex <= 9; sampleIndex += 1) {
        await fixture.producer.captureStep({
          sessionId, operationId: `${role === "lens_geometry" ? "lens" : "normalization"}-test-${sampleIndex}`,
          role, sampleIndex, targetFace: "checkerboard",
        });
      }
      const before = await fixture.producer.status(sessionId);
      const roleHistoryBefore = before.acceptedCaptureHistory.filter((entry) => entry.role === role);
      await assert.rejects(
        fixture.producer.captureStep({
          sessionId, operationId: `${role === "lens_geometry" ? "lens" : "normalization"}-test-10-bad`,
          role, sampleIndex: 10, targetFace: "checkerboard",
        }),
        /prospective tenth-pose aggregate does not meet centralized minima/i,
      );
      const failed = await fixture.producer.status(sessionId);
      assert.equal(failed.retryAllowed, true);
      assert.deepEqual(failed.acceptedCaptureHistory.filter((entry) => entry.role === role), roleHistoryBefore);
      assert.ok(failed.failedAttempts.at(-1).prospectiveAggregate.x < 0.07);
      assert.ok(failed.failedAttempts.at(-1).prospectiveAggregate.y < 0.08);
      assert.ok(failed.failedAttempts.at(-1).prospectiveAggregate.rotationDegrees < 2);
      const accepted = await fixture.producer.captureStep({
        sessionId, operationId: `${role === "lens_geometry" ? "lens" : "normalization"}-test-10-good-retry`,
        role, sampleIndex: 10, targetFace: "checkerboard",
      });
      assert.deepEqual(accepted.acceptedCaptureHistory.filter((entry) => entry.role === role).slice(0, 9), roleHistoryBefore);
      const progress = accepted.poseProgress.find((entry) => entry.role === role);
      assert.equal(progress.acceptedCount, 10);
      assert.equal(progress.aggregateSatisfied, true);
    });
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
