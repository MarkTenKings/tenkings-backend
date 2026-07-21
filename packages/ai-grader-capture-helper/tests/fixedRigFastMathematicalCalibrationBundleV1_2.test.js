const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
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
  hashFastCalibrationCanonicalV1_2,
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

function sourceLedger() {
  const ledger = Array.from({ length: 4 }, (_, index) => ({
    operationId: `pose-operation-${index + 1}`, role: "checkerboard_placement", slot: index + 1,
    channelIndex: null, sampleIndex: index + 1, sha256: exactHash(`pose-${index + 1}`), byteSize: 100, active: true,
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
  const rig = rigAuthority(context);
  const ledger = sourceLedger();
  const sourceManifestSha256 = exactHash("fast-source-manifest");
  const artifacts = artifactBytes();
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
  return {
    context,
    sourceManifestSha256,
    sourceCapturePackage,
    sourceArtifactLedger: ledger,
    geometryVerification: {
      accepted: true, poseCount: 4, minimumCoverageFraction: 0.30, minimumSafetyMarginFraction: 0.01,
      spans: { x: 0.08, y: 0.09, rotationDegrees: 3 },
      maximumAuthorityReprojectionResidualPx: 0.4, authorityReprojectionU95Px: 0.4,
    },
    builderInput: builderInput(artifacts, context),
    flatFieldArtifacts: artifacts.flatFields,
    illuminationPatternArtifact: artifacts.illumination,
  };
}

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
