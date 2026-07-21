const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const { MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH } = require("../../shared/dist");
const {
  startAiGraderLocalStationBridgeHttpServer,
} = require("../dist/drivers/aiGraderLocalStationBridge");
const {
  FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2_SHA256,
  FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2_SHA256,
  FixedRigFastCalibrationEvidenceAnalyzerV1_2,
} = require("../dist/drivers/fixedRigFastCalibrationEvidenceAnalyzerV1_2");
const {
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA,
} = require("../dist/drivers/fixedRigFastMathematicalCalibrationV1_2");
const {
  MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS,
} = require("../dist/drivers/mathematicalCalibrationV1_2Contract");

const token = "V1-2-Hardware-Free-Route-Test-Token";
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hashSeed = (value) => digest(Buffer.from(value));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(canonical(value))}\n`);

function evidence(role, suffix) {
  return { evidenceId: `one-time-${suffix}`, sha256: hashSeed(`one-time-${suffix}`), role };
}

function runtimeContext() {
  return {
    schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA,
    stationId: "route-test-station",
    rigId: "route-test-rig",
    camera: {
      serialNumber: "route-test-camera",
      modelName: "fake-basler",
      lensAuthorityId: "route-test-lens",
      exposureUs: 45000,
      gain: 0,
      pixelFormat: "Mono8",
      widthPx: 64,
      heightPx: 64,
    },
    controller: {
      identity: "fake-leimac-controller",
      unit: 1,
      channelWiring: Array.from({ length: 8 }, (_, index) => ({
        channelIndex: index + 1,
        controllerOutput: `output-${index + 1}`,
        componentId: `component-${index + 1}`,
        physicalDirectionId: `direction-${index + 1}`,
      })),
    },
    dutyPercent: 1.2,
    target: { version: "route-target-v1", sha256: hashSeed("route-target") },
    componentConfigurationId: "route-components-v1",
    algorithmHashes: {
      geometry: FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2_SHA256,
      photometric: FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2_SHA256,
      finalizer: hashSeed("route-finalizer"),
      thresholdManifest: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    },
    locationLabel: "hardware-free-route-test",
    lightingConfigurationId: "fake-room-lighting-v1",
  };
}

function oneTimeAuthority(context) {
  const scaleSamples = ["x", "y"].flatMap((axis) => Array.from({ length: 10 }, (_, index) => ({
    ...evidence(`scale_${axis}`, `scale-${axis}-${index}`),
    axis,
    physicalSpanMm: 100,
    physicalSpanU95Mm: 0.1,
    pixelSpan: 1000,
  })));
  const repeatedPlacementSamples = Array.from({ length: 10 }, (_, index) => ({
    ...evidence("placement", `placement-${index}`),
    displacementXMm: index % 2 ? 0.005 : -0.005,
    displacementYMm: index % 2 ? -0.004 : 0.004,
  }));
  const measurementRepeatabilitySamples = [
    ["linear_mm", 2, 0.002], ["area_mm2", 1, 0.004], ["relief_index", 0.4, 0.001],
    ["roughness_index", 0.2, 0.001], ["color_delta_e", 2, 0.005],
  ].flatMap(([measurementClass, baseline, step]) => Array.from({ length: 10 }, (_, index) => ({
    ...evidence("measurement_repeatability", `${measurementClass}-${index}`),
    measurementClass,
    referenceFeatureId: `route-${measurementClass}`,
    measuredValue: baseline + (index - 4.5) * step,
  })));
  const members = [
    {
      role: "target_metrology",
      fileName: "target-metrology-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-target-metrology-authority-v1",
        rigId: context.rigId,
        targetVersion: context.target.version,
        targetSha256: context.target.sha256,
        scaleSamples,
        targetPrintScaleSamples: [
          { ...evidence("print_scale", "print-x"), axis: "x", nominalSpanMm: 100, measuredSpanMm: 100, measurementU95Mm: 0.1 },
          { ...evidence("print_scale", "print-y"), axis: "y", nominalSpanMm: 200, measuredSpanMm: 200, measurementU95Mm: 0.1 },
        ],
        targetCutDimensionSamples: [
          { ...evidence("target_cut", "cut-x"), axis: "x", nominalDimensionMm: 63.5, measuredDimensionMm: 63.5, measurementU95Mm: 0.1 },
          { ...evidence("target_cut", "cut-y"), axis: "y", nominalDimensionMm: 88.9, measuredDimensionMm: 88.9, measurementU95Mm: 0.1 },
        ],
        targetEvidence: [evidence("target", "target")],
      },
    },
    {
      role: "camera_lens",
      fileName: "camera-lens-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-camera-lens-authority-v1",
        rigId: context.rigId,
        cameraSerialNumber: context.camera.serialNumber,
        cameraModelName: context.camera.modelName,
        lensAuthorityId: context.camera.lensAuthorityId,
        normalizedWidthPx: 1000,
        normalizedHeightPx: 1400,
        lensResidualSamples: Array.from({ length: 10 }, (_, index) => ({
          ...evidence("lens_view", `lens-${index}`), residualPx: 0.1,
        })),
        lensModel: {
          model: "opencv_brown_conrady_v1",
          sourceWidthPx: context.camera.widthPx,
          sourceHeightPx: context.camera.heightPx,
          cameraMatrix: [64, 0, 32, 0, 64, 32, 0, 0, 1],
          distortionCoefficients: [0, 0, 0, 0, 0],
          calibrationRmsPx: 0.1,
          perViewResidualPx: Array(10).fill(0.1),
        },
        normalizationModel: {
          model: "undistort_outer_cut_homography_with_fixed_holdout_repeatability_v1",
          sampleResidualPx: [],
        },
      },
    },
    {
      role: "physical_light_directions",
      fileName: "physical-light-directions-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-physical-light-directions-authority-v1",
        rigId: context.rigId,
        channels: Array.from({ length: 8 }, (_, index) => {
          const channelIndex = index + 1;
          const angle = index * Math.PI / 4;
          return {
            channelIndex,
            directionMeasurementSamples: Array.from({ length: 3 }, (_, sample) => ({
              ...evidence("direction_measurement", `direction-${channelIndex}-${sample}`),
              measurementMethod: "fixed_ring_segment_geometry_with_ruler_v1",
              sourcePointMm: { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) },
              cardCenterPointMm: { x: 0, y: 0 },
              pointU95Mm: 0.1,
            })),
          };
        }),
      },
    },
    {
      role: "component_identities",
      fileName: "component-identities-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-component-identities-authority-v1",
        rigId: context.rigId,
        controllerIdentity: context.controller.identity,
        componentConfigurationId: context.componentConfigurationId,
        channelWiring: structuredClone(context.controller.channelWiring),
        algorithmHashes: structuredClone(context.algorithmHashes),
      },
    },
    {
      role: "repeatability",
      fileName: "repeatability-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-repeatability-authority-v1",
        rigId: context.rigId,
        repeatedPlacementSamples,
        measurementRepeatabilitySamples,
      },
    },
  ].map((member) => ({ ...member, bytes: canonicalBytes(member.value) }));
  return {
    bundleBytes: canonicalBytes({
      schemaVersion: "ten-kings-mathematical-rig-characterization-source-v1.2",
      characterizedAt: "2026-07-21T12:00:00.000Z",
      rigId: context.rigId,
      sourceCaptureManifestSha256: hashSeed("route-one-time-capture"),
      members: members.map(({ role, fileName, bytes }) => ({ role, fileName, sha256: digest(bytes) })),
    }),
    members: members.map(({ fileName, bytes }) => ({ fileName, bytes })),
  };
}

function metadata(context) {
  return {
    capturedAt: "2026-07-21T12:05:00.000Z",
    camera: structuredClone(context.camera),
    controller: {
      controllerIdentity: context.controller.identity,
      expectedWriteCount: 5,
      acknowledgedWriteCount: 5,
      responseKinds: ["ack", "ack", "ack", "ack", "ack"],
      complete: true,
    },
    safeOffBeforeConfirmed: true,
    safeOffAfterConfirmed: true,
  };
}

function detectorResult(centerX, centerY, rotationDegrees) {
  const width = 64;
  const height = 64;
  const side = Math.sqrt(0.30) * width;
  const angle = rotationDegrees * Math.PI / 180;
  const rotate = (x, y) => ({
    x: centerX * width + x * Math.cos(angle) - y * Math.sin(angle),
    y: centerY * height + x * Math.sin(angle) + y * Math.cos(angle),
  });
  const outerCorners = [
    rotate(-side / 2, -side / 2), rotate(side / 2, -side / 2),
    rotate(side / 2, side / 2), rotate(-side / 2, side / 2),
  ];
  const internalCorners = [];
  for (let row = 0; row < 16; row += 1) {
    for (let column = 0; column < 11; column += 1) {
      internalCorners.push(rotate(
        -side / 2 + (column + 0.5) * side / 11,
        -side / 2 + (row + 0.5) * side / 16,
      ));
    }
  }
  return { imageWidth: width, imageHeight: height, internalCorners, outerCorners, rotationDegrees };
}

async function imageBuffer(pixels) {
  return sharp(pixels, { raw: { width: 64, height: 64, channels: 1 } }).png().toBuffer();
}

async function photometricBytes(role, channelIndex, sampleIndex) {
  const pixels = Buffer.alloc(64 * 64);
  const angle = (channelIndex - 1) * Math.PI / 4;
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      let value;
      if (role === "dark_control") value = 5 + channelIndex * 3 + sampleIndex;
      else if (role === "flat_field") value = 100 + channelIndex * 3 + sampleIndex;
      else value = 180 + sampleIndex + 0.14 * ((x - 31.5) * Math.cos(angle) + (y - 31.5) * Math.sin(angle));
      pixels[y * 64 + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return imageBuffer(pixels);
}

async function adapters(context) {
  const detections = new Map();
  const placements = [
    [0.32, 0.32, -4], [0.40, 0.43, 1], [0.48, 0.50, 5], [0.56, 0.60, 9],
  ];
  let poseIndex = 0;
  let failSweepOnce = true;
  const calls = { batchOpen: 0, batchClose: 0, safeOff: 0 };
  const analyzer = new FixedRigFastCalibrationEvidenceAnalyzerV1_2({
    detectCheckerboard: async (bytes) => {
      const found = detections.get(digest(bytes));
      if (!found) throw new Error("fake detector has no exact capture-time still binding");
      return structuredClone(found);
    },
  });
  return {
    analyzer,
    calls,
    checkerboardCapture: {
      async captureCheckerboard({ slot }) {
        const pixels = Buffer.alloc(64 * 64, 20 + slot + poseIndex);
        pixels[0] = 100 + poseIndex;
        const bytes = await imageBuffer(pixels);
        const placement = placements[poseIndex++] ?? placements[slot - 1];
        detections.set(digest(bytes), detectorResult(...placement));
        return { bytes, mediaType: "image/png", metadata: metadata(context) };
      },
      async confirmBlankReverseFlip() { return { confirmed: true }; },
    },
    persistentBatchControllers: {
      create() {
        return {
          async open() { calls.batchOpen += 1; return structuredClone(context); },
          async capture(request) {
            if (failSweepOnce && request.role === "flat_field" && request.channelIndex === 3 && request.sampleIndex === 2) {
              failSweepOnce = false;
              throw new Error("injected resumable camera batch interruption");
            }
            return {
              bytes: await photometricBytes(request.role, request.channelIndex, request.sampleIndex),
              mediaType: "image/png",
              metadata: metadata(context),
            };
          },
          async safeOff() {
            calls.safeOff += 1;
            return { controllerIdentity: context.controller.identity, confirmed: true, responseKinds: ["ack"] };
          },
          async close() { calls.batchClose += 1; },
        };
      },
    },
  };
}

async function request(started, pathname, method = "GET", body) {
  const response = await fetch(`${started.url}${pathname}`, {
    method,
    headers: {
      "x-ai-grader-station-token": token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("actual V1.2 route family uses durable local authority through resumable evidence-derived finalization", async () => {
  const outputDir = path.join(os.tmpdir(), `mathematical-v1-2-route-${crypto.randomUUID()}`);
  const context = runtimeContext();
  const boundaries = await adapters(context);
  let operation = 0;
  const input = {
    enabled: true, host: "127.0.0.1", port: 0, mode: "real", stationToken: token,
    outputDir, mathematicalCalibrationOutputDir: path.join(outputDir, "calibration"),
    apply: true, markPresent: true, wiringConfirmed: true, leimacStatusGreen: true,
    leimacHost: "127.0.0.1",
    mathematicalCalibrationV1_2LocalAuthorityConfig: {
      operatorId: "route-test-operator",
      loadRuntimeContext: async () => structuredClone(context),
      loadRigCharacterizationSource: async () => oneTimeAuthority(context),
      checkerboardCapture: boundaries.checkerboardCapture,
      persistentBatchControllers: boundaries.persistentBatchControllers,
      evidenceAnalyzer: boundaries.analyzer,
      now: () => new Date("2026-07-21T12:10:00.000Z"),
      operationId: () => `route-operation-${++operation}`,
      sessionId: () => "route-session-v1.2",
    },
  };
  const runner = { run: async (step) => ({ stepId: step.id, ok: true, exitCode: 0 }) };
  const dependencies = {
    writeLightingFrames: async (frames) => frames.map(() => ({ responseKind: "ack", ok: true })),
    stopOrphanedPreviewStreamsUntilReleased: async () => 0,
  };
  let started;
  try {
    started = await startAiGraderLocalStationBridgeHttpServer(input, {}, runner, undefined, dependencies);
    let response = await request(started, MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.start, "POST", {});
    assert.equal(response.status, 200, JSON.stringify(response.body));
    let status = response.body.result;
    assert.equal(status.expectedAction.action, "capture_checkerboard");
    for (let slot = 1; slot <= 4; slot += 1) {
      response = await request(started, MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.capture, "POST", {
        sessionId: status.sessionId, expectedRevision: status.revision,
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      status = response.body.result;
    }
    response = await request(started, MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.capture, "POST", {
      sessionId: status.sessionId, expectedRevision: status.revision,
    });
    assert.equal(response.status, 200);
    status = response.body.result;
    assert.equal(status.expectedAction.action, "capture_photometric");

    response = await request(started, MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.capture, "POST", {
      sessionId: status.sessionId, expectedRevision: status.revision,
    });
    assert.equal(response.status, 400);
    response = await request(started, `${MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.status}?sessionId=${status.sessionId}`);
    status = response.body.result;
    assert.equal(status.automaticSweep.acceptedFrames, 22);
    assert.equal(status.failedAttempts.at(-1).issue, "injected resumable camera batch interruption");
    response = await request(started, MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.retry, "POST", {
      sessionId: status.sessionId, expectedRevision: status.revision,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    status = response.body.result;
    assert.equal(status.automaticSweep.acceptedFrames, 72);
    assert.equal(status.expectedAction.action, "analyze");
    assert.equal(boundaries.calls.batchOpen, 2);

    await new Promise((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
    started = await startAiGraderLocalStationBridgeHttpServer(input, {}, runner, undefined, dependencies);
    response = await request(started, MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.start, "POST", {
      resumeSessionId: status.sessionId, expectedRevision: status.revision,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    status = response.body.result;
    response = await request(started, MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.analyze, "POST", {
      sessionId: status.sessionId, expectedRevision: status.revision,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    status = response.body.result;
    assert.equal(status.analysis.state, "accepted");
    response = await request(started, MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.finalize, "POST", {
      sessionId: status.sessionId, expectedRevision: status.revision,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    status = response.body.result;
    assert.equal(status.phase, "ready_for_explicit_activation");
    assert.equal(status.activationEligible, true);
    assert.equal(status.finalization.memberCount, 12);
    assert.equal(status.acceptedPoses.filter((pose) => pose.active).length, 4);
    response = await request(started, MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.sessions);
    assert.equal(response.status, 200);
    assert.equal(response.body.result.sessions[0].acceptedImageCount, 76);
    response = await request(started, "/calibration/mathematical-v1.2/activate", "POST", {
      sessionId: status.sessionId, expectedRevision: status.revision,
    });
    assert.equal(response.status, 404);
  } finally {
    if (started?.server.listening) {
      await new Promise((resolve) => started.server.close(() => resolve()));
    }
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});
