const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  FAST_CALIBRATION_RIG_MATERIALIZATION_CONFIRMATION_V1_2,
  FAST_CALIBRATION_RIG_SOURCE_BUNDLE_FILE_V1_2,
  FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2,
  materializeFastCalibrationRigAuthorityV1_2,
} = require("../../dist/drivers/fixedRigFastMathematicalCalibrationRigMaterializerV1_2");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}
const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

async function write(root, fileName, bytes) {
  const filePath = path.join(root, ...fileName.split("/"));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
  return { fileName, sha256: digest(bytes) };
}

function evidenceReference(artifact) {
  return { evidenceId: artifact.evidenceId, sha256: artifact.sha256, role: artifact.role };
}

async function prepareFastCalibrationRigMaterializationFixtureV1_2(root, options = {}) {
  const sourceRoot = path.join(root, "source");
  const acceptanceRoot = path.join(root, "acceptance");
  await fs.mkdir(sourceRoot, { recursive: true });
  const analyzerScriptPath = path.resolve(__dirname, "../../../../scripts/ai-grader/analyze-mathematical-calibration-v1.py");
  const analyzerScriptSha256 = digest(await fs.readFile(analyzerScriptPath));
  const ownerAttested = options.ownerAttested === true;
  const ownerInstrumentFields = {
    instrumentId: "owner-device-250mm-1", kind: "product_owner_attested_device",
    manufacturer: "owner_verified_manufacturer", model: "owner_verified_250mm_device", serialNumber: "owner-device-serial-1",
    maximumRangeMm: 250, accuracyMm: 0.05, resolutionMm: 0.01, statedU95Mm: 0.1,
    ownerAttestationId: "mark-owner-attestation-1", authorityStatement: "product_owner_attested_non_traceable_measurement_v1",
  };
  const instrument = await write(
    sourceRoot,
    ownerAttested ? "references/product-owner-attestation.json" : "references/instrument-calibration.bin",
    ownerAttested
      ? canonicalBytes({
        accuracyMm: ownerInstrumentFields.accuracyMm, attestedAt: "2026-07-22T12:00:00.000Z",
        authorityStatement: ownerInstrumentFields.authorityStatement, instrumentId: ownerInstrumentFields.instrumentId,
        manufacturer: ownerInstrumentFields.manufacturer, maximumRangeMm: ownerInstrumentFields.maximumRangeMm,
        model: options.ownerAttestationMismatch === true ? "different_owner_verified_device" : ownerInstrumentFields.model,
        ownerAttestationId: ownerInstrumentFields.ownerAttestationId,
        productOwnerId: "mark", resolutionMm: ownerInstrumentFields.resolutionMm,
        schemaVersion: "ten-kings-product-owner-metrology-attestation-v1", serialNumber: ownerInstrumentFields.serialNumber,
        statedU95Mm: ownerInstrumentFields.statedU95Mm, traceabilityStatement: "not_traceably_calibrated",
      })
      : Buffer.from("traceable-instrument-calibration-v1"),
  );
  const physicalInstrument = ownerAttested ? {
    ...ownerInstrumentFields, ownerAttestationVersion: "1", ownerAttestationSha256: instrument.sha256,
  } : { instrumentId: "instrument-1", kind: "caliper", calibrationVersion: "cert-v1", calibrationSha256: instrument.sha256 };
  const physicalMeasurementMethod = ownerAttested ? "product_owner_attested_measurement_v1" : "traceable-physical-metrology-v1";
  const metrology = await write(sourceRoot, "references/metrology-source.bin", Buffer.from("supervised-metrology-worksheet-v1"));
  const lensEvidence = await write(sourceRoot, "references/lens-authority.bin", Buffer.from("lens-asset-and-mount-authority-v1"));
  const wiringEvidence = await write(sourceRoot, "references/component-wiring.bin", Buffer.from("supervised-eight-channel-wiring-v1"));
  const stageEvidence = await Promise.all(Array.from({ length: 3 }, (_, index) =>
    write(sourceRoot, `references/stage-transform-${index + 1}.bin`, Buffer.from(`stage-transform-measurement-${index + 1}`))));
  const targetBytes = Buffer.from("verified-non-production-target-pdf-bytes");
  const targetSha256 = digest(targetBytes);
  const liveProbe = {
    schemaVersion: "ten-kings-mathematical-calibration-v1.2-protected-live-probe-evidence-v1",
    observedAt: "2026-07-21T12:00:00.000Z",
    probeAuthority: "protected-basler-leimac-live-probe-v1",
    stationId: "dell-station-1", rigId: "fixed-rig-dell-v1",
    camera: {
      serialNumber: "camera-serial-1", modelName: "Basler-model-1", transport: "GigE",
      exposureUs: 45000, gain: 0, pixelFormat: "Mono8", widthPx: 2448, heightPx: 2048,
    },
    controller: { identity: "leimac-controller-1", unit: 1, responseKinds: ["ack"] },
    dutyPercent: 1.2, locationLabel: "dell-calibration-bench", lightingConfigurationId: "lighting-room-state-1",
  };
  const channelWiring = Array.from({ length: 8 }, (_, index) => ({
    channelIndex: index + 1, controllerOutput: `output-${index + 1}`,
    componentId: `light-component-${index + 1}`, physicalDirectionId: `physical-direction-${index + 1}`,
  }));
  const componentEvidence = {
    schemaVersion: "ten-kings-mathematical-calibration-v1.2-component-supervision-evidence-v1",
    recordedAt: "2026-07-21T12:05:00.000Z", operatorId: "calibration-operator", rigId: liveProbe.rigId,
    controllerIdentity: liveProbe.controller.identity, componentConfigurationId: "component-configuration-1",
    lensAuthorityId: "lens-authority-1", lensAuthorityEvidenceSha256: lensEvidence.sha256,
    wiringEvidenceSha256: wiringEvidence.sha256, channelWiring,
    targetVersion: "target-v1", targetSha256,
  };
  const stageTransformEvidence = {
    schemaVersion: "ten-kings-mathematical-calibration-v1.2-stage-transform-evidence-v1",
    recordedAt: "2026-07-21T12:06:00.000Z", operatorId: componentEvidence.operatorId, rigId: liveProbe.rigId,
    cameraSerialNumber: liveProbe.camera.serialNumber, cameraModelName: liveProbe.camera.modelName,
    lensAuthorityId: componentEvidence.lensAuthorityId,
    method: "supervised-stage-to-undistorted-sensor-matrix-v1",
    stageToUndistortedSensorMatrix: [1, 0, 0, 1], measurementEvidenceSha256: stageEvidence.map((entry) => entry.sha256),
  };
  const liveRef = await write(sourceRoot, "live-probe-v1.json", canonicalBytes(liveProbe));
  const componentRef = await write(sourceRoot, "component-supervision-v1.json", canonicalBytes(componentEvidence));
  const stageRef = await write(sourceRoot, "stage-transform-v1.json", canonicalBytes(stageTransformEvidence));

  const artifacts = [];
  let sequence = 0;
  const addArtifact = async (input) => {
    sequence += 1;
    const evidenceId = input.evidenceId ?? `evidence-${sequence}`;
    const relative = input.artifactClass === "measurement"
      ? `evidence/measurements/${evidenceId}.json`
      : input.artifactClass === "target"
        ? `evidence/target/${evidenceId}.pdf`
        : `evidence/${input.artifactClass}/${evidenceId}.bin`;
    const bytes = input.bytes ?? Buffer.from(`exact-${input.artifactClass}-${evidenceId}`);
    await write(sourceRoot, relative, bytes);
    const artifact = {
      evidenceId, path: relative, sha256: digest(bytes), role: input.role, artifactClass: input.artifactClass,
      rigId: liveProbe.rigId, captureProfileVersion: "ten-kings-fixed-rig-mathematical-calibration-v1",
      subjectDesignation: "calibration_target", productionCard: false, operationId: `operation-${sequence}`,
      capturedAt: `2026-07-21T12:${String(10 + Math.floor(sequence / 60)).padStart(2, "0")}:${String(sequence % 60).padStart(2, "0")}.000Z`,
      channelIndex: input.channelIndex ?? null, byteSize: bytes.length,
      mediaType: input.artifactClass === "measurement" ? "application/json" : input.artifactClass === "target" ? "application/pdf" : "image/tiff",
      ...(input.artifactClass === "raw_capture" ? {
        camera: {
          serialNumber: liveProbe.camera.serialNumber, modelName: liveProbe.camera.modelName, transport: "GigE",
          sourcePixelFormat: liveProbe.camera.pixelFormat, savedImageFormat: "TIFF",
          exposureUs: liveProbe.camera.exposureUs, gain: liveProbe.camera.gain,
        },
        pylon: { version: "7.5.0", bridgeVersion: "basler-pylon-bridge-v1" },
        leimac: {
          unit: liveProbe.controller.unit, dutyPercent: input.role.includes("dark_control") ? 0 : liveProbe.dutyPercent,
          enabledChannels: [], expectedWriteCount: 1, acknowledgedWriteCount: 1, responseKinds: ["ack"], complete: true,
        },
        safeOff: { beforeCaptureConfirmed: true, afterCaptureConfirmed: true, confirmedAt: "2026-07-21T12:59:00.000Z" },
      } : {}),
    };
    artifacts.push(artifact);
    return artifact;
  };

  const raw = { lens: [], normalization: [], placement: [], flat: [], dark: [], pattern: [] };
  const normalized = { lens: [], normalization: [], placement: [], flat: [], dark: [], pattern: [] };
  for (const [key, role] of [["lens", "lens_geometry"], ["normalization", "normalization_registration"], ["placement", "repeated_placement"]]) {
    for (let sample = 1; sample <= 10; sample += 1) {
      raw[key].push(await addArtifact({ artifactClass: "raw_capture", role, evidenceId: `${role}-${sample}-raw` }));
      normalized[key].push(await addArtifact({ artifactClass: "normalized_derivative", role: `${role}_normalized`, evidenceId: `${role}-${sample}-normalized` }));
    }
  }
  for (let channel = 1; channel <= 8; channel += 1) {
    for (const [key, role] of [["flat", "flat_field"], ["dark", "dark_control"], ["pattern", "illumination_pattern"]]) {
      for (let sample = 1; sample <= 3; sample += 1) {
        raw[key].push(await addArtifact({ artifactClass: "raw_capture", role: `${role}_channel_${channel}_raw`, channelIndex: channel, evidenceId: `${role}-${channel}-${sample}-raw` }));
        normalized[key].push(await addArtifact({ artifactClass: "normalized_derivative", role: `${role}_channel_${channel}`, channelIndex: channel, evidenceId: `${role}-${channel}-${sample}` }));
      }
    }
  }
  const measurementArtifacts = { print: [], cut: [], direction: [], repeatability: [] };
  const measurement = async (role, body, evidenceId, channelIndex) => {
    const artifact = await addArtifact({ artifactClass: "measurement", role, evidenceId, channelIndex, bytes: canonicalBytes(body) });
    return artifact;
  };
  for (const axis of ["x", "y"]) {
    measurementArtifacts.print.push(await measurement(`print_scale_verification_${axis}`, {
      schemaVersion: "ten-kings-calibration-print-scale-measurement-v1", operatorId: componentEvidence.operatorId,
      recordedAt: "2026-07-21T13:00:00.000Z", measurementMethod: physicalMeasurementMethod,
      instrument: physicalInstrument,
      axis, nominalSpanMm: axis === "x" ? 100 : 200, measuredSpanMm: axis === "x" ? 100 : 200,
      measurementU95Mm: 0.1, sourceMetrologyArtifactSha256: metrology.sha256,
    }, `print-scale-${axis}`));
    measurementArtifacts.cut.push(await measurement(`target_cut_dimension_${axis}`, {
      schemaVersion: "ten-kings-calibration-target-cut-dimension-measurement-v1", operatorId: componentEvidence.operatorId,
      recordedAt: "2026-07-21T13:01:00.000Z", measurementMethod: physicalMeasurementMethod,
      instrument: physicalInstrument,
      axis, nominalDimensionMm: axis === "x" ? 63.5 : 88.9, measuredDimensionMm: axis === "x" ? 63.5 : 88.9,
      measurementU95Mm: 0.1, sourceMetrologyArtifactSha256: metrology.sha256,
    }, `target-cut-${axis}`));
  }
  for (let channel = 1; channel <= 8; channel += 1) {
    const angle = (channel - 1) * Math.PI / 4;
    for (let sample = 1; sample <= 3; sample += 1) {
      measurementArtifacts.direction.push(await measurement(`direction_geometry_channel_${channel}`, {
        schemaVersion: "ten-kings-calibration-direction-measurement-v1", operatorId: componentEvidence.operatorId,
        recordedAt: "2026-07-21T13:02:00.000Z", measurementMethod: physicalMeasurementMethod,
        instrument: physicalInstrument,
        channelIndex: channel, sampleIndex: sample,
        sourcePointMm: { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) }, cardCenterPointMm: { x: 0, y: 0 },
        pointU95Mm: 0.1, sourceMetrologyArtifactSha256: metrology.sha256,
      }, `direction-${channel}-${sample}`, channel));
    }
  }
  const repeatabilityDefinitions = [
    ["linear_mm", 2, 0.002], ["area_mm2", 1, 0.004], ["relief_index", 0.4, 0.001],
    ["roughness_index", 0.2, 0.001], ["color_delta_e", 2, 0.005],
  ];
  for (const [measurementClass, baseline, step] of repeatabilityDefinitions) {
    for (let index = 0; index < 10; index += 1) {
      measurementArtifacts.repeatability.push(await measurement("measurement_repeatability", {
        schemaVersion: "ten-kings-calibration-repeatability-measurement-v1", operatorId: componentEvidence.operatorId,
        recordedAt: "2026-07-21T13:03:00.000Z", measurementMethod: "fixed_reference_repeatability_v1",
        instrument: { instrumentId: "opencv-calibration-analyzer-v1", kind: "fixed_rig_geometry", calibrationVersion: "opencv_checkerboard_repeatability_measurement_v1", calibrationSha256: analyzerScriptSha256 },
        measurementClass, sampleIndex: index + 1, referenceFeatureId: `checkerboard-repeatability-${measurementClass}-v1`,
        measuredValue: baseline + (index - 4.5) * step, sourceCaptureOperationId: `placement-${index + 1}`,
        sourceEvidenceId: raw.placement[index].evidenceId, sourceSha256: raw.placement[index].sha256,
        sourceRole: "repeated_placement", measurementAlgorithmVersion: "opencv_checkerboard_repeatability_measurement_v1",
        fixedRoiDefinition: "registered_checkerboard_center_cell_and_grid_spacing_v1",
      }, `repeatability-${measurementClass}-${index + 1}`));
    }
  }
  const target = await addArtifact({ artifactClass: "target", role: "print_verified_calibration_target", evidenceId: "verified-target", bytes: targetBytes });
  if (artifacts.length !== 283) throw new Error(`fixture artifact count ${artifacts.length} is not 283`);
  const capturePackage = {
    schemaVersion: "ten-kings-mathematical-calibration-capture-package-v1", packageId: "physical-capture-package-1",
    rigId: liveProbe.rigId, captureProfileVersion: "ten-kings-fixed-rig-mathematical-calibration-v1",
    purpose: "mathematical_calibration_v1", thresholdSetId: "ten-kings-mathematical-grading-v1.0.1",
    thresholdSetHash: require("../../../shared/dist").MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    captureEvidenceAcceptance: {},
    stationAuthority: {
      stationId: liveProbe.stationId, sessionId: "physical-session-1", operatorId: componentEvidence.operatorId,
      createdAt: "2026-07-21T11:00:00.000Z", finalizedAt: "2026-07-21T14:00:00.000Z", noProductionMutation: true,
      protectedSettings: {
        stationId: liveProbe.stationId, rigId: liveProbe.rigId,
        captureProfileVersion: "ten-kings-fixed-rig-mathematical-calibration-v1", cameraIndex: 0,
        exposureUs: liveProbe.camera.exposureUs, gain: liveProbe.camera.gain, dutyPercent: liveProbe.dutyPercent,
        leimacUnit: liveProbe.controller.unit, selectedChannels: [1,2,3,4,5,6,7,8],
        normalizedWidthPx: 1000, normalizedHeightPx: 1400, checkerboard: { internalColumns: 11, internalRows: 16, cellMm: 5 },
      },
    },
    subject: { designation: "calibration_target", productionCard: false, targetVersion: componentEvidence.targetVersion, targetSha256 },
    artifacts,
  };
  const packageRef = await write(sourceRoot, "source-capture-package.json", canonicalBytes(capturePackage));
  const captureManifest = {
    schemaVersion: "ten-kings-mathematical-calibration-capture-manifest-v1", evidenceRoot: ".",
    profileId: "calibration-profile-v1", calibrationVersion: "calibration-v1.2.0", rigId: liveProbe.rigId,
    captureProfileVersion: "ten-kings-fixed-rig-mathematical-calibration-v1",
    sourceCapturePackage: { packageId: capturePackage.packageId, path: packageRef.fileName, sha256: packageRef.sha256 },
    artifactId: "calibration-artifact-v1", operatorId: componentEvidence.operatorId,
    finalizedAt: capturePackage.stationAuthority.finalizedAt,
  };
  const captureManifestRef = await write(sourceRoot, "capture-manifest.json", canonicalBytes(captureManifest));
  const derivedFlat = Array.from({ length: 8 }, (_, index) => canonicalBytes({ schemaVersion: "test-flat-field-v1", channelIndex: index + 1 }));
  const derivedIllumination = canonicalBytes({ schemaVersion: "test-illumination-v1", channels: [1,2,3,4,5,6,7,8] });
  const artifactAt = (list, channel, sample) => list[(channel - 1) * 3 + (sample - 1)];
  const builderInput = {
    profileId: captureManifest.profileId, calibrationVersion: captureManifest.calibrationVersion, rigId: liveProbe.rigId,
    artifactId: captureManifest.artifactId, finalizedAt: captureManifest.finalizedAt,
    normalizedWidthPx: 1000, normalizedHeightPx: 1400,
    scaleSamples: [
      ...raw.lens.map((entry) => ({ ...evidenceReference(entry), axis: "x", physicalSpanMm: 100, physicalSpanU95Mm: 0.1, pixelSpan: 1000 })),
      ...raw.lens.map((entry) => ({ ...evidenceReference(entry), axis: "y", physicalSpanMm: 100, physicalSpanU95Mm: 0.1, pixelSpan: 1000 })),
    ],
    targetPrintScaleSamples: measurementArtifacts.print.map((entry, index) => ({ ...evidenceReference(entry), axis: index ? "y" : "x", nominalSpanMm: index ? 200 : 100, measuredSpanMm: index ? 200 : 100, measurementU95Mm: 0.1 })),
    targetCutDimensionSamples: measurementArtifacts.cut.map((entry, index) => ({ ...evidenceReference(entry), axis: index ? "y" : "x", nominalDimensionMm: index ? 88.9 : 63.5, measuredDimensionMm: index ? 88.9 : 63.5, measurementU95Mm: 0.1 })),
    lensResidualSamples: raw.lens.map((entry) => ({ ...evidenceReference(entry), residualPx: 0.1 })),
    normalizationResidualSamples: raw.normalization.map((entry) => ({ ...evidenceReference(entry), residualPx: 0.2 })),
    repeatedPlacementSamples: raw.placement.map((entry, index) => ({ ...evidenceReference(entry), displacementXMm: index % 2 ? 0.005 : -0.005, displacementYMm: index % 2 ? -0.004 : 0.004 })),
    segmentationBoundarySamples: raw.placement.map((entry, index) => ({ ...evidenceReference(entry), outerContourFitResidualPx: index % 2 ? 0.12 : 0.1 })),
    measurementRepeatabilitySamples: measurementArtifacts.repeatability.map((entry, index) => {
      const [measurementClass, baseline, step] = repeatabilityDefinitions[Math.floor(index / 10)];
      return { ...evidenceReference(entry), measurementClass, referenceFeatureId: `checkerboard-repeatability-${measurementClass}-v1`, measuredValue: baseline + (index % 10 - 4.5) * step };
    }),
    channels: Array.from({ length: 8 }, (_, index) => {
      const channel = index + 1; const angle = index * Math.PI / 4;
      return {
        channelIndex: channel,
        directionMeasurementSamples: measurementArtifacts.direction.slice(index * 3, index * 3 + 3).map((entry) => ({
          ...evidenceReference(entry), measurementMethod: "fixed_ring_segment_geometry_with_ruler_v1",
          sourcePointMm: { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) }, cardCenterPointMm: { x: 0, y: 0 }, pointU95Mm: 0.1,
        })),
        directionValidationAngularErrorsDegrees: [0.1, 0.1, 0.1], relativeResponse: [1,1,1,1], responseScale: 1,
        flatFieldArtifactId: `flat-field-${channel}`, flatFieldArtifactSha256: digest(derivedFlat[index]),
        flatFieldFrames: [1,2,3].map((sample) => evidenceReference(artifactAt(normalized.flat, channel, sample))),
        darkControlFrames: [1,2,3].map((sample) => evidenceReference(artifactAt(normalized.dark, channel, sample))),
        illuminationPatternArtifactId: "illumination-pattern-v1", illuminationPatternArtifactSha256: digest(derivedIllumination),
        illuminationPatternFrames: [1,2,3].map((sample) => evidenceReference(artifactAt(normalized.pattern, channel, sample))),
        illuminationPatternGridWidth: 2, illuminationPatternGridHeight: 2, expectedDirectionalResidual: [0,0,0,0],
      };
    }),
    targetEvidence: [evidenceReference(target)], operatorId: componentEvidence.operatorId,
    targetVersion: componentEvidence.targetVersion, targetSha256,
    lensModel: {
      model: "opencv_brown_conrady_v1", sourceWidthPx: liveProbe.camera.widthPx, sourceHeightPx: liveProbe.camera.heightPx,
      cameraMatrix: [1800,0,1224,0,1800,1024,0,0,1], distortionCoefficients: [0.01,-0.005,0,0,0],
      calibrationRmsPx: 0.1, perViewResidualPx: Array(10).fill(0.1),
    },
    normalizationModel: { model: "undistort_outer_cut_homography_with_fixed_holdout_repeatability_v1", sampleResidualPx: Array(10).fill(0.2) },
  };
  const inputManifest = {
    schemaVersion: "ten-kings-mathematical-calibration-v1.2-rig-materialization-input-v1",
    captureManifest: captureManifestRef, liveProbe: liveRef, componentEvidence: componentRef, stageTransformEvidence: stageRef,
    referencedEvidence: [
      { role: ownerAttested ? "product_owner_attestation" : "instrument_calibration", ...instrument }, { role: "metrology_source", ...metrology },
      { role: "lens_authority", ...lensEvidence }, { role: "component_wiring", ...wiringEvidence },
      ...stageEvidence.map((entry) => ({ role: "stage_transform_measurement", ...entry })),
    ],
  };
  const inputManifestRef = await write(sourceRoot, "rig-materialization-input-v1.json", canonicalBytes(inputManifest));
  const analyzePhysicalEvidence = async () => ({
    builderInput: structuredClone(builderInput),
    derivedArtifacts: [
      ...derivedFlat.map((bytes, index) => ({ kind: "derived_flat_field", sourceRole: `flat-field-channel-${index + 1}-v1`, bytes })),
      { kind: "derived_illumination_pattern", sourceRole: "illumination-pattern-v1", bytes: derivedIllumination },
    ],
  });
  return {
    sourceRoot, acceptanceRoot, inputManifest, inputManifestRef, captureManifestRef, liveRef, componentRef, stageRef,
    builderInput, analyzePhysicalEvidence,
    materializerInput: {
      inputManifestPath: path.join(sourceRoot, inputManifestRef.fileName), inputManifestSha256: inputManifestRef.sha256,
      acceptanceRoot, confirmation: FAST_CALIBRATION_RIG_MATERIALIZATION_CONFIRMATION_V1_2, analyzePhysicalEvidence,
    },
  };
}

async function materializeFastCalibrationRigFixtureV1_2(root) {
  const prepared = await prepareFastCalibrationRigMaterializationFixtureV1_2(root);
  const result = await materializeFastCalibrationRigAuthorityV1_2(prepared.materializerInput);
  const directory = path.join(prepared.acceptanceRoot, result.directoryName);
  return {
    ...prepared, result, directory,
    env: {
      AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_PATH: path.join(directory, FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2),
      AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SHA256: result.runtimeContextSha256,
      AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_BUNDLE_PATH: path.join(directory, FAST_CALIBRATION_RIG_SOURCE_BUNDLE_FILE_V1_2),
      AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_BUNDLE_SHA256: result.rigSourceBundleSha256,
      AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_MEMBER_DIR: directory,
      AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_FINALIZER_STAGING_ROOT: path.join(root, "trusted-finalizer-staging"),
      AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_OPERATOR_ID: prepared.builderInput.operatorId,
    },
  };
}

module.exports = {
  canonicalBytes, digest, prepareFastCalibrationRigMaterializationFixtureV1_2,
  materializeFastCalibrationRigFixtureV1_2,
};
