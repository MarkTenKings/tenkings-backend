const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} = require("../../shared/dist");
const {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_ANALYSIS_ALGORITHM_V1,
  loadFixedRigMathematicalCalibrationBundleV1,
} = require("../dist/drivers/fixedRigMathematicalCalibrationBundleV1");
const {
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_ALGORITHM,
  buildFastCalibrationAnalysisV1_2,
  finalizeFastMathematicalCalibrationBundleV1_2,
} = require("../dist/drivers/fixedRigFastMathematicalCalibrationBundleV1_2");
const {
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PACKAGE_SCHEMA,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PROFILE,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_AUTHORITY_SCHEMA,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA,
  FixedRigFastMathematicalCalibrationCoreV1_2,
  hashFastCalibrationCanonicalV1_2,
  verifyFastCalibrationRigCharacterizationSourceV1_2,
} = require("../dist/drivers/fixedRigFastMathematicalCalibrationV1_2");

const HASH_POLICY = "sha256-canonical-json-with-artifactSha256-omitted";
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const exactHash = (seed) => digest(Buffer.from(seed));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(canonical(value), null, 2)}\n`, "utf8");
}

const compactCanonicalBytes = (value) => Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");

function parentStaticPhysicalDirectionTransform(vector, matrix) {
  if (matrix.some((value) => !Number.isFinite(value))) {
    throw new Error("Physical-to-normalized direction matrix is non-finite.");
  }
  const transformed = {
    x: matrix[0] * vector.x + matrix[1] * vector.y,
    y: matrix[2] * vector.x + matrix[3] * vector.y,
  };
  const magnitude = Math.hypot(transformed.x, transformed.y);
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    throw new Error("Physical light direction transform is degenerate.");
  }
  return { x: transformed.x / magnitude, y: transformed.y / magnitude };
}

function assertSameTransformOutcome(actualTransform, vector, matrix) {
  let expected;
  let expectedError;
  try {
    expected = parentStaticPhysicalDirectionTransform(vector, matrix);
  } catch (error) {
    expectedError = error;
  }
  if (expectedError) {
    assert.throws(
      () => actualTransform(vector, matrix),
      (error) => error instanceof Error && error.message === expectedError.message,
    );
    return;
  }
  assert.deepEqual(compactCanonicalBytes(actualTransform(vector, matrix)), compactCanonicalBytes(expected));
}
function runtimeContext() {
  return {
    schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA,
    stationId: "dell-station-1",
    rigId: "fixed-rig-dell-v1",
    camera: {
      serialNumber: "camera-serial-1",
      modelName: "Basler-model-1",
      lensAuthorityId: "lens-authority-1",
      exposureUs: 45000,
      gain: 0,
      pixelFormat: "Mono12",
      widthPx: 2448,
      heightPx: 2048,
    },
    controller: {
      identity: "leimac-controller-1",
      unit: 1,
      channelWiring: Array.from({ length: 8 }, (_, index) => ({
        channelIndex: index + 1,
        controllerOutput: `output-${index + 1}`,
        componentId: `light-component-${index + 1}`,
        physicalDirectionId: `physical-direction-${index + 1}`,
      })),
    },
    dutyPercent: 1.2,
    target: { version: "target-v1", sha256: exactHash("target") },
    componentConfigurationId: "component-configuration-1",
    algorithmHashes: {
      geometry: exactHash("geometry"),
      photometric: exactHash("photometric"),
      finalizer: exactHash("finalizer"),
      thresholdManifest: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    },
    locationLabel: "dell-calibration-bench",
    lightingConfigurationId: "lighting-room-state-1",
  };
}

function rigAuthority(context) {
  return {
    schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_AUTHORITY_SCHEMA,
    characterizedAt: "2026-07-21T12:00:00.000Z",
    rigId: context.rigId,
    sourceBundleManifestSha256: exactHash("source-bundle"),
    sourceCaptureManifestSha256: exactHash("source-capture"),
    sourceEvidenceManifestSha256: exactHash("source-evidence"),
    sourceMemberLedgerSha256: exactHash("source-members"),
    targetMetrologyAuthoritySha256: exactHash("target-metrology"),
    cameraLensAuthoritySha256: exactHash("camera-lens"),
    physicalLightDirectionAuthoritySha256: exactHash("directions"),
    componentIdentityAuthoritySha256: exactHash("components"),
    repeatabilityAuthoritySha256: exactHash("repeatability"),
    cameraSerialNumber: context.camera.serialNumber,
    cameraModelName: context.camera.modelName,
    lensAuthorityId: context.camera.lensAuthorityId,
    controllerIdentity: context.controller.identity,
    channelWiring: structuredClone(context.controller.channelWiring),
    targetVersion: context.target.version,
    targetSha256: context.target.sha256,
    componentConfigurationId: context.componentConfigurationId,
    algorithmHashes: structuredClone(context.algorithmHashes),
  };
}

function rigSource(builder, context) {
  const members = [
    {
      role: "target_metrology",
      fileName: "target-metrology-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-target-metrology-authority-v1",
        rigId: context.rigId,
        targetVersion: builder.targetVersion,
        targetSha256: builder.targetSha256,
        scaleSamples: builder.scaleSamples,
        targetPrintScaleSamples: builder.targetPrintScaleSamples,
        targetCutDimensionSamples: builder.targetCutDimensionSamples,
        targetEvidence: builder.targetEvidence,
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
        normalizedWidthPx: builder.normalizedWidthPx,
        normalizedHeightPx: builder.normalizedHeightPx,
        lensResidualSamples: builder.lensResidualSamples,
        lensModel: builder.lensModel,
        normalizationModel: builder.normalizationModel,
      },
    },
    {
      role: "physical_light_directions",
      fileName: "physical-light-directions-authority-v1.json",
      value: {
        schemaVersion: "ten-kings-physical-light-directions-authority-v1",
        rigId: context.rigId,
        stageToUndistortedSensorMatrix: [1, 0, 0, 1],
        channels: builder.channels.map(({ channelIndex, directionMeasurementSamples }) => ({
          channelIndex,
          directionMeasurementSamples,
        })),
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
        repeatedPlacementSamples: builder.repeatedPlacementSamples,
        measurementRepeatabilitySamples: builder.measurementRepeatabilitySamples,
      },
    },
  ].map((member) => ({ ...member, bytes: compactCanonicalBytes(member.value) }));
  const memberLedger = members.map(({ role, fileName, bytes }) => ({ role, fileName, sha256: digest(bytes) }));
  return {
    bundleBytes: compactCanonicalBytes({
      schemaVersion: "ten-kings-mathematical-rig-characterization-source-v1.2",
      characterizedAt: "2026-07-21T12:00:00.000Z",
      rigId: context.rigId,
      sourceCaptureManifestSha256: exactHash("verified-one-time-source-capture"),
      sourceEvidenceManifestSha256: exactHash("verified-one-time-source-evidence"),
      members: memberLedger,
    }),
    members: members.map(({ fileName, bytes }) => ({ fileName, bytes })),
  };
}

function artifactBytes() {
  const flatFields = Array.from({ length: 8 }, (_, index) => {
    const channelIndex = index + 1;
    const artifact = {
      schemaVersion: "ten-kings-flat-field-artifact-v1",
      algorithmVersion: FIXED_RIG_MATHEMATICAL_CALIBRATION_ANALYSIS_ALGORITHM_V1,
      hashPolicy: HASH_POLICY,
      artifactSha256: exactHash(`flat-declared-${channelIndex}`),
      channelIndex,
      response: [1, 1, 1, 1],
    };
    const bytes = jsonBytes(artifact);
    return { channelIndex, fileName: `flat-field-channel-${channelIndex}-v1.json`, sha256: digest(bytes), bytes };
  });
  const illumination = {
    schemaVersion: "ten-kings-illumination-pattern-artifact-v1",
    algorithmVersion: FIXED_RIG_MATHEMATICAL_CALIBRATION_ANALYSIS_ALGORITHM_V1,
    hashPolicy: HASH_POLICY,
    artifactSha256: exactHash("illumination-declared"),
    coordinateFrame: "normalized_card_portrait_pixels",
    channels: Array.from({ length: 8 }, (_, index) => ({ channelIndex: index + 1, residual: [0, 0, 0, 0] })),
  };
  const illuminationBytes = jsonBytes(illumination);
  return {
    flatFields,
    illumination: {
      fileName: "illumination-pattern-v1.json",
      sha256: digest(illuminationBytes),
      bytes: illuminationBytes,
    },
  };
}

function evidence(role, suffix) {
  return { evidenceId: `calibration-${suffix}`, sha256: exactHash(`evidence-${suffix}`), role };
}

function builderInput(artifacts, context) {
  return {
    profileId: "calibration-profile-v1",
    calibrationVersion: "calibration-v1.2.0",
    rigId: context.rigId,
    artifactId: "calibration-artifact-v1",
    finalizedAt: "2026-07-21T12:10:00.000Z",
    normalizedWidthPx: 1000,
    normalizedHeightPx: 1400,
    scaleSamples: [
      ...Array.from({ length: 10 }, (_, index) => ({ ...evidence("scale_x", `scale-x-${index}`), axis: "x", physicalSpanMm: 100, physicalSpanU95Mm: 0.1, pixelSpan: 1000 })),
      ...Array.from({ length: 10 }, (_, index) => ({ ...evidence("scale_y", `scale-y-${index}`), axis: "y", physicalSpanMm: 100, physicalSpanU95Mm: 0.1, pixelSpan: 1000 })),
    ],
    targetPrintScaleSamples: [
      { ...evidence("print_scale", "print-scale-x"), axis: "x", nominalSpanMm: 100, measuredSpanMm: 100, measurementU95Mm: 0.1 },
      { ...evidence("print_scale", "print-scale-y"), axis: "y", nominalSpanMm: 200, measuredSpanMm: 200, measurementU95Mm: 0.1 },
    ],
    targetCutDimensionSamples: [
      { ...evidence("target_cut", "target-cut-x"), axis: "x", nominalDimensionMm: 63.5, measuredDimensionMm: 63.5, measurementU95Mm: 0.1 },
      { ...evidence("target_cut", "target-cut-y"), axis: "y", nominalDimensionMm: 88.9, measuredDimensionMm: 88.9, measurementU95Mm: 0.1 },
    ],
    lensResidualSamples: Array.from({ length: 10 }, (_, index) => ({ ...evidence("lens_view", `lens-${index}`), residualPx: 0.1 })),
    normalizationResidualSamples: Array.from({ length: 10 }, (_, index) => ({ ...evidence("normalization", `normalization-${index}`), residualPx: 0.2 })),
    repeatedPlacementSamples: Array.from({ length: 10 }, (_, index) => ({ ...evidence("placement", `placement-${index}`), displacementXMm: index % 2 ? 0.005 : -0.005, displacementYMm: index % 2 ? -0.004 : 0.004 })),
    segmentationBoundarySamples: Array.from({ length: 10 }, (_, index) => ({ ...evidence("boundary", `boundary-${index}`), outerContourFitResidualPx: index % 2 ? 0.12 : 0.1 })),
    measurementRepeatabilitySamples: [
      ["linear_mm", 2, 0.002], ["area_mm2", 1, 0.004], ["relief_index", 0.4, 0.001],
      ["roughness_index", 0.2, 0.001], ["color_delta_e", 2, 0.005],
    ].flatMap(([measurementClass, baseline, step]) => Array.from({ length: 10 }, (_, index) => ({
      ...evidence("measurement_repeatability", `${measurementClass}-${index}`),
      measurementClass,
      referenceFeatureId: `fixture-${measurementClass}`,
      measuredValue: baseline + (index - 4.5) * step,
    }))),
    lensModel: {
      model: "opencv_brown_conrady_v1", sourceWidthPx: 4096, sourceHeightPx: 3000,
      cameraMatrix: [3000, 0, 2048, 0, 3000, 1500, 0, 0, 1],
      distortionCoefficients: [0.01, -0.005, 0, 0, 0], calibrationRmsPx: 0.1, perViewResidualPx: Array(10).fill(0.1),
    },
    normalizationModel: { model: "undistort_outer_cut_homography_with_fixed_holdout_repeatability_v1", sampleResidualPx: Array(10).fill(0.2) },
    channels: Array.from({ length: 8 }, (_, index) => {
      const channelIndex = index + 1;
      const angle = index * Math.PI / 4;
      return {
        channelIndex,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        directionConfidence: 1,
        directionMeasurementSamples: Array.from({ length: 3 }, (_, sample) => ({
          ...evidence("direction_measurement", `direction-${channelIndex}-${sample}`),
          measurementMethod: "fixed_ring_segment_geometry_with_ruler_v1",
          sourcePointMm: { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) },
          cardCenterPointMm: { x: 0, y: 0 }, pointU95Mm: 0.1,
        })),
        directionValidationAngularErrorsDegrees: [0.1, 0.1, 0.1],
        relativeResponse: new Float32Array([1, 1, 1, 1]), responseScale: 1,
        flatFieldArtifactId: `flat-field-${channelIndex}`,
        flatFieldArtifactSha256: artifacts.flatFields[index].sha256,
        flatFieldFrames: Array.from({ length: 3 }, (_, frame) => ({
          ...evidence("flat_field", "flat-" + channelIndex + "-" + frame),
          sha256: exactHash("flat_field-" + channelIndex + "-" + (frame + 1)),
        })),
        darkControlFrames: Array.from({ length: 3 }, (_, frame) => ({
          ...evidence("dark_control", "dark-" + channelIndex + "-" + frame),
          sha256: exactHash("dark_control-" + channelIndex + "-" + (frame + 1)),
        })),
        illuminationPatternArtifactId: "illumination-pattern-v1",
        illuminationPatternArtifactSha256: artifacts.illumination.sha256,
        illuminationPatternFrames: Array.from({ length: 3 }, (_, frame) => ({
          ...evidence("illumination_pattern", "pattern-" + channelIndex + "-" + frame),
          sha256: exactHash("illumination_pattern-" + channelIndex + "-" + (frame + 1)),
        })),
        illuminationPatternGridWidth: 2, illuminationPatternGridHeight: 2,
        expectedDirectionalResidual: new Float32Array([0, 0, 0, 0]),
      };
    }),
    targetEvidence: [evidence("target", "target")],
    operatorId: "calibration-operator",
    targetVersion: context.target.version,
    targetSha256: context.target.sha256,
  };
}

function sourceLedger(context = runtimeContext()) {
  const centers = [
    [0.35, 0.35, 0],
    [0.43, 0.38, 1],
    [0.39, 0.44, 2],
    [0.42, 0.40, 3],
  ];
  const side = Math.sqrt(0.30);
  const ledger = Array.from({ length: 4 }, (_, index) => ({
    operationId: `pose-operation-${index + 1}`, role: "checkerboard_placement", slot: index + 1,
    channelIndex: null, sampleIndex: index + 1, sha256: exactHash(`pose-${index + 1}`), byteSize: 100, active: true,
    pose: {
      sourceFrameSha256: exactHash(`pose-${index + 1}`),
      centerXFraction: centers[index][0], centerYFraction: centers[index][1],
      coverageFraction: 0.30, rotationDegrees: centers[index][2],
      safetyMarginFraction: Math.min(
        centers[index][0] - side / 2, 1 - centers[index][0] - side / 2,
        centers[index][1] - side / 2, 1 - centers[index][1] - side / 2,
      ),
      authorityReprojectionResidualPx: 0.4,
      outerCorners: [
        { x: (centers[index][0] - side / 2) * context.camera.widthPx, y: (centers[index][1] - side / 2) * context.camera.heightPx },
        { x: (centers[index][0] + side / 2) * context.camera.widthPx, y: (centers[index][1] - side / 2) * context.camera.heightPx },
        { x: (centers[index][0] + side / 2) * context.camera.widthPx, y: (centers[index][1] + side / 2) * context.camera.heightPx },
        { x: (centers[index][0] - side / 2) * context.camera.widthPx, y: (centers[index][1] + side / 2) * context.camera.heightPx },
      ],
    },
  }));
  let slot = 1;
  for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
    for (const role of ["dark_control", "flat_field", "illumination_pattern"]) {
      for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
        ledger.push({
          operationId: `${role}-${channelIndex}-${sampleIndex}`, role, slot: slot++, channelIndex, sampleIndex,
          sha256: exactHash(`${role}-${channelIndex}-${sampleIndex}`), byteSize: 100, active: true,
        });
      }
    }
  }
  return ledger;
}

function analysisInput() {
  const context = runtimeContext();
  const ledger = sourceLedger(context);
  const sourceManifestSha256 = exactHash("fast-source-manifest");
  const artifacts = artifactBytes();
  const builder = builderInput(artifacts, context);
  const poseHashes = ledger.slice(0, 4).map((entry) => entry.sha256);
  builder.normalizationResidualSamples.forEach((sample, index) => {
    sample.sha256 = poseHashes[index % poseHashes.length];
    sample.role = "checkerboard_placement";
  });
  builder.segmentationBoundarySamples.forEach((sample, index) => {
    sample.sha256 = poseHashes[index % poseHashes.length];
    sample.role = "checkerboard_placement";
  });
  const rig = verifyFastCalibrationRigCharacterizationSourceV1_2(rigSource(builder, context), context).authority;
  const sourceCapturePackage = {
    schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PACKAGE_SCHEMA,
    contractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
    packageId: "fast-calibration-package-1",
    manifestSha256: sourceManifestSha256,
    rigId: context.rigId,
    captureProfileVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PROFILE,
    purpose: "mathematical_calibration_v1.2",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    captureEvidenceAcceptance: {
      exactCheckerboardPlacements: 4, exactPhotometricFrames: 72, exactTotalImageCaptures: 76,
      exactBlankReverseFlipCount: 1, poseFourRequiresFinalAggregateDiversity: true,
      acceptedPoseSupersessionPreservesEvidence: true, failedAttemptLeavesSlotPending: true,
      persistentBatchRequired: true, automaticFallbackAllowed: false,
    },
    stationAuthority: {
      stationId: context.stationId, sessionId: "fast-session-1", operatorId: "calibration-operator",
      createdAt: "2026-07-21T12:00:00.000Z", finalizedAt: "2026-07-21T12:10:00.000Z",
      noProductionMutation: true, protectedSettings: structuredClone(context),
    },
    subject: { designation: "calibration_target", productionCard: false, targetVersion: context.target.version, targetSha256: context.target.sha256 },
    rigCharacterizationAuthority: rig,
    rigCharacterizationSha256: hashFastCalibrationCanonicalV1_2(rig),
    runtimeContext: context,
    runtimeContextSha256: hashFastCalibrationCanonicalV1_2(context),
    captureCounts: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS,
    sourceArtifactLedgerSha256: hashFastCalibrationCanonicalV1_2(ledger),
  };
  const result = {
    sourceManifestSha256,
    sourceCapturePackage,
    sourceArtifactLedger: ledger,
    builderInput: builder,
    flatFieldArtifacts: artifacts.flatFields,
    illuminationPatternArtifact: artifacts.illumination,
  };
  Object.defineProperty(result, "context", { value: context });
  return result;
}

function captureMetadata(context) {
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

function captureFrame(context, label) {
  return {
    bytes: Buffer.from(`exact-capture-${label}`),
    mediaType: "image/tiff",
    metadata: captureMetadata(context),
  };
}

function capturePose(context, frame, centerX, centerY, rotationDegrees) {
  const side = Math.sqrt(0.30);
  const left = centerX - side / 2;
  const right = centerX + side / 2;
  const top = centerY - side / 2;
  const bottom = centerY + side / 2;
  return {
    sourceFrameSha256: digest(frame.bytes),
    centerXFraction: centerX,
    centerYFraction: centerY,
    coverageFraction: 0.30,
    rotationDegrees,
    safetyMarginFraction: Math.min(left, 1 - right, top, 1 - bottom),
    authorityReprojectionResidualPx: 0.1,
    outerCorners: [
      { x: left * context.camera.widthPx, y: top * context.camera.heightPx },
      { x: right * context.camera.widthPx, y: top * context.camera.heightPx },
      { x: right * context.camera.widthPx, y: bottom * context.camera.heightPx },
      { x: left * context.camera.widthPx, y: bottom * context.camera.heightPx },
    ],
  };
}

function trustedEvidenceAnalyzer(context) {
  const grid = (value) => Array(64).fill(value);
  return {
    geometryAlgorithmSha256: context.algorithmHashes.geometry,
    photometricAlgorithmSha256: context.algorithmHashes.photometric,
    async derivePose() {
      throw new Error("direct core test does not use the authority capture adapter");
    },
    async analyze(input) {
      for (const entry of input.activeSourceArtifactLedger) {
        assert.equal(digest(await input.readFrame(entry)), entry.sha256);
      }
      const poses = input.activeSourceArtifactLedger
        .filter((entry) => entry.active && entry.role === "checkerboard_placement")
        .sort((left, right) => left.slot - right.slot)
        .map((entry) => ({
          sourceFrameSha256: entry.sha256,
          pose: structuredClone(entry.pose),
          normalizationResidualPx: Array(10).fill(entry.pose.authorityReprojectionResidualPx),
          segmentationBoundaryResidualPx: Array(10).fill(entry.pose.authorityReprojectionResidualPx),
        }));
      const channels = Array.from({ length: 8 }, (_, index) => {
        const channelIndex = index + 1;
        const angle = index * Math.PI / 4;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const directional = Array.from({ length: 64 }, (_, cell) => {
          const x = cell % 8 - 3.5;
          const y = Math.floor(cell / 8) - 3.5;
          return 210 + 3 * (dx * x + dy * y);
        });
        return {
          channelIndex,
          darkControlGrids: [grid(10), grid(10), grid(10)],
          flatFieldGrids: [grid(110), grid(110), grid(110)],
          illuminationPatternGrids: [directional, directional, directional],
        };
      });
      return {
        geometryAlgorithmSha256: context.algorithmHashes.geometry,
        photometricAlgorithmSha256: context.algorithmHashes.photometric,
        physicalToNormalizedDirectionMatrix: [1, 0, 0, 1],
        gridWidth: 8,
        gridHeight: 8,
        poses,
        channels,
      };
    },
  };
}

test("core derives analysis, canonical finalization, and durable ready-for-activation state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-core-finalization-"));
  try {
    const fixture = analysisInput();
    let operationIndex = 0;
    const config = {
      outputRoot: root,
      now: () => new Date("2026-07-21T12:10:00.000Z"),
      operationId: () => `core-operation-${++operationIndex}`,
      evidenceAnalyzer: trustedEvidenceAnalyzer(fixture.context),
    };
    const core = await FixedRigFastMathematicalCalibrationCoreV1_2.open(config, {
      sessionId: "fast-session-1",
      operatorId: "calibration-operator",
      runtimeContext: fixture.context,
      rigCharacterizationSource: rigSource(fixture.builderInput, fixture.context),
    });
    for (const [index, [x, y, rotation]] of [
      [0.30, 0.30, -4],
      [0.40, 0.43, 1],
      [0.48, 0.50, 5],
      [0.56, 0.60, 9],
    ].entries()) {
      const frame = captureFrame(fixture.context, `pose-${index + 1}`);
      await core.captureCheckerboard({
        frame,
        pose: capturePose(fixture.context, frame, x, y, rotation),
      });
    }
    await core.confirmBlankReverseFlip(true);
    let captureIndex = 0;
    await core.runPhotometricBatch({
      async open() {
        return structuredClone(fixture.context);
      },
      async capture(request) {
        captureIndex += 1;
        return captureFrame(
          fixture.context,
          `${request.role}-${request.channelIndex}-${request.sampleIndex}-${captureIndex}`,
        );
      },
      async safeOff() {
        return {
          controllerIdentity: fixture.context.controller.identity,
          confirmed: true,
          responseKinds: ["ack"],
        };
      },
      async close() {},
    });
    assert.equal(core.status().phase, "analyze");
    const activeLedger = core.getSourceArtifactLedger();
    const activePoseHashes = activeLedger
      .filter((entry) => entry.active && entry.role === "checkerboard_placement")
      .map((entry) => entry.sha256);
    fixture.builderInput.normalizationResidualSamples.forEach((sample, index) => {
      sample.sha256 = activePoseHashes[index % activePoseHashes.length];
      sample.role = "checkerboard_placement";
    });
    fixture.builderInput.segmentationBoundarySamples.forEach((sample, index) => {
      sample.sha256 = activePoseHashes[index % activePoseHashes.length];
      sample.role = "checkerboard_placement";
    });
    for (const channel of fixture.builderInput.channels) {
      for (const [role, frames] of [
        ["dark_control", channel.darkControlFrames],
        ["flat_field", channel.flatFieldFrames],
        ["illumination_pattern", channel.illuminationPatternFrames],
      ]) frames.forEach((frame, index) => {
        frame.sha256 = activeLedger.find((entry) => entry.active && entry.role === role &&
          entry.channelIndex === channel.channelIndex && entry.sampleIndex === index + 1).sha256;
        frame.role = role;
      });
    }
    const callerPayload = {
      builderInput: structuredClone(fixture.builderInput),
      flatFieldArtifacts: structuredClone(fixture.flatFieldArtifacts),
      illuminationPatternArtifact: structuredClone(fixture.illuminationPatternArtifact),
    };
    const numericMutations = [
      (value) => { value.builderInput.normalizationResidualSamples[0].residualPx = 0.001; },
      (value) => { value.builderInput.segmentationBoundarySamples[0].outerContourFitResidualPx = 0.001; },
      (value) => { value.builderInput.channels[0].directionValidationAngularErrorsDegrees[0] = 0.001; },
      (value) => { value.builderInput.channels[0].relativeResponse[0] = 0.999; },
      (value) => { value.builderInput.channels[0].responseScale = 999; },
      (value) => { value.builderInput.channels[0].expectedDirectionalResidual[0] = 0.999; },
    ];
    for (const mutate of numericMutations) {
      const changed = structuredClone(callerPayload);
      mutate(changed);
      await assert.rejects(core.analyze(changed), /accepts no caller-authored values/);
    }
    const mathModulePath = require.resolve("../dist/drivers/fixedRigFastCalibrationMathV1_2");
    assert.equal(require.cache[mathModulePath], undefined, "Dell analysis math must remain lazy before analyze");
    const originalLoad = Module._load;
    let lazyModuleLoadCount = 0;
    let dellTransformCallCount = 0;
    let boundaryProbeCount = 0;
    Module._load = function(request, parent, isMain) {
      const resolved = Module._resolveFilename(request, parent, isMain);
      const loaded = originalLoad.call(this, request, parent, isMain);
      if (resolved !== mathModulePath) return loaded;
      lazyModuleLoadCount += 1;
      for (const [vector, matrix] of [
        [{ x: 1, y: 0 }, [1, 0, 0, 1]],
        [{ x: 0.6, y: -0.8 }, [0, -1, 1, 0]],
        [{ x: -1, y: 1 }, [2, 0.5, -0.25, 3]],
        [{ x: 1, y: 0 }, [Number.EPSILON, 0, 0, Number.EPSILON]],
        [{ x: 1, y: 0 }, [0, 0, 0, 0]],
        [{ x: 1, y: 0 }, [Number.NaN, 0, 0, 1]],
      ]) {
        assertSameTransformOutcome(loaded.transformFastCalibrationPhysicalDirectionV1_2, vector, matrix);
        boundaryProbeCount += 1;
      }
      return {
        ...loaded,
        transformFastCalibrationPhysicalDirectionV1_2(vector, matrix) {
          const actual = loaded.transformFastCalibrationPhysicalDirectionV1_2(vector, matrix);
          const expected = parentStaticPhysicalDirectionTransform(vector, matrix);
          assert.deepEqual(compactCanonicalBytes(actual), compactCanonicalBytes(expected));
          dellTransformCallCount += 1;
          return actual;
        },
      };
    };
    try {
      await core.analyze();
    } finally {
      Module._load = originalLoad;
    }
    assert.equal(lazyModuleLoadCount, 1);
    assert.equal(boundaryProbeCount, 6);
    assert.equal(dellTransformCallCount, 8);
    assert.equal(core.status().phase, "finalize");
    await core.finalize();
    assert.equal(core.status().phase, "ready_for_explicit_activation");
    assert.doesNotThrow(() => core.assertReadyForExplicitActivation(fixture.context));
    assert.throws(() => core.assertReadyForStartNewCard(fixture.context), /Agent 4 activation receipt/);

    const resumed = await FixedRigFastMathematicalCalibrationCoreV1_2.open({
      ...config,
      operationId: () => `resume-operation-${++operationIndex}`,
    }, {
      sessionId: "fast-session-1",
      operatorId: "calibration-operator",
      runtimeContext: fixture.context,
      resume: true,
    });
    assert.equal(resumed.status().phase, "ready_for_explicit_activation");

    const eventsDir = path.join(root, "fast-session-1", "events");
    const finalizationEvent = (await Promise.all((await fs.readdir(eventsDir)).map(async (name) =>
      JSON.parse(await fs.readFile(path.join(eventsDir, name), "utf8")))))
      .find((event) => event.type === "finalization_completed");
    const corruptMemberPath = path.join(root, "fast-session-1", ...finalizationEvent.members[0].relativePath.split("/"));
    await fs.writeFile(corruptMemberPath, Buffer.from("{}"));
    await assert.rejects(
      FixedRigFastMathematicalCalibrationCoreV1_2.open(config, {
        sessionId: "fast-session-1",
        operatorId: "calibration-operator",
        runtimeContext: fixture.context,
        resume: true,
      }),
      /missing or corrupt/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("V1.2 analysis and complete 12-member finalization are deterministic", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-bundle-determinism-"));
  try {
    const input = analysisInput();
    const firstAnalysis = buildFastCalibrationAnalysisV1_2(input);
    const secondAnalysis = buildFastCalibrationAnalysisV1_2(analysisInput());
    assert.equal(firstAnalysis.algorithmVersion, FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_ALGORITHM);
    assert.equal(firstAnalysis.analysisSha256, secondAnalysis.analysisSha256);
    const first = await finalizeFastMathematicalCalibrationBundleV1_2({ analysis: firstAnalysis, outputDir: path.join(root, "first") });
    const second = await finalizeFastMathematicalCalibrationBundleV1_2({ analysis: secondAnalysis, outputDir: path.join(root, "second") });
    assert.equal(first.bundleSha256, second.bundleSha256);
    assert.equal(first.authority.members.length, 12);
    assert.equal(first.authority.captureContractVersion, "1.2.0");
    const loaded = loadFixedRigMathematicalCalibrationBundleV1({
      bundlePath: first.bundlePath, bundleSha256: first.bundleSha256,
      expectedRigId: input.context.rigId, expectedRuntimeContext: input.context,
    });
    assert.equal(loaded.authority.members.length, 12);
    assert.equal(loaded.authority.runtimeContextSha256, input.sourceCapturePackage.runtimeContextSha256);
    assert.equal(loaded.authority.memberLedgerSha256, first.authority.memberLedgerSha256);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("canonical V1.2 loader rejects absent live context, context mismatch, missing member, and corrupt member", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-fast-bundle-rejection-"));
  try {
    const input = analysisInput();
    const finalized = await finalizeFastMathematicalCalibrationBundleV1_2({
      analysis: buildFastCalibrationAnalysisV1_2(input), outputDir: path.join(root, "bundle"),
    });
    const load = (context) => loadFixedRigMathematicalCalibrationBundleV1({
      bundlePath: finalized.bundlePath, bundleSha256: finalized.bundleSha256,
      expectedRigId: input.context.rigId, ...(context ? { expectedRuntimeContext: context } : {}),
    });
    assert.throws(() => load(), /requires the exact live runtime context/);
    const mismatch = structuredClone(input.context);
    mismatch.camera.exposureUs += 1;
    assert.throws(() => load(mismatch), /Live camera, rig, controller/);
    const flatPath = path.join(path.dirname(finalized.bundlePath), "flat-field-channel-8-v1.json");
    const original = await fs.readFile(flatPath);
    await fs.rm(flatPath);
    assert.throws(() => load(input.context), /ENOENT/);
    await fs.writeFile(flatPath, Buffer.from(`${original.toString("utf8")} `));
    assert.throws(() => load(input.context), /exact file SHA-256 mismatch/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("analysis rejects duplicated or relabelled source evidence", () => {
  const input = analysisInput();
  input.sourceArtifactLedger[1].sha256 = input.sourceArtifactLedger[0].sha256;
  input.sourceCapturePackage.sourceArtifactLedgerSha256 = hashFastCalibrationCanonicalV1_2(input.sourceArtifactLedger);
  assert.throws(() => buildFastCalibrationAnalysisV1_2(input), /Duplicate or relabelled/);
});

test("analysis rejects a photometric builder frame relabelled away from its source artifact", () => {
  const input = analysisInput();
  input.builderInput.channels[0].darkControlFrames[0].sha256 = "f".repeat(64);
  assert.throws(() => buildFastCalibrationAnalysisV1_2(input), /is not bound to its exact source artifact/);
});

test("analysis rejects caller-authored geometry acceptance and mutated one-time authority", () => {
  const callerGeometry = analysisInput();
  callerGeometry.geometryVerification = {
    accepted: true,
    poseCount: 4,
    minimumCoverageFraction: 1,
    minimumSafetyMarginFraction: 1,
    spans: { x: 1, y: 1, rotationDegrees: 180 },
    maximumAuthorityReprojectionResidualPx: 0,
    authorityReprojectionU95Px: 0,
  };
  assert.throws(() => buildFastCalibrationAnalysisV1_2(callerGeometry), /server-derived V1.2 contract/);
  const mutatedOneTime = analysisInput();
  mutatedOneTime.builderInput.scaleSamples[0].pixelSpan += 1;
  assert.throws(() => buildFastCalibrationAnalysisV1_2(mutatedOneTime), /do not reconstruct/);
});
