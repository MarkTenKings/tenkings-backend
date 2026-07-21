const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  buildFixedRigPhysicalCalibrationV1,
} = require("../dist/drivers/fixedRigPhysicalCalibrationV1");
const {
  buildFixedRigPhotometricCalibrationProfileV1,
} = require("../dist/drivers/fixedRigPhotometricCalibrationV1");
const {
  buildFixedRigCenteringSideV1,
  fuseFixedRigCenteringFrontBackV1,
} = require("../dist/drivers/fixedRigCenteringV1");
const {
  projectApprovedFixedRigDesignReferenceV1,
} = require("../dist/drivers/fixedRigDesignReferenceV1");
const {
  aggregateFixedRigCornersV1,
  aggregateFixedRigEdgesV1,
  measureFixedRigCornerObservationV1,
  measureFixedRigEdgeObservationV1,
} = require("../dist/drivers/fixedRigCornerEdgeV1");

const SHA = "a".repeat(64);

function plane(width, height, valueOrFactory = 0) {
  const data = new Float32Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    data[index] = typeof valueOrFactory === "function"
      ? valueOrFactory(x, y, index)
      : valueOrFactory;
  }
  return { width, height, data };
}

function evidence(role, suffix = role) {
  return { evidenceId: `calibration-${suffix}`, sha256: SHA, role };
}

function measurementEvidence(side, regionId) {
  return [{
    assetId: `${side}-normalized-card`,
    sha256: SHA,
    side,
    role: "normalized_card",
    regionId,
  }];
}

function buildAcceptedCalibration(mutator) {
  const input = {
    profileId: "calibration-profile-v1",
    calibrationVersion: "calibration-v1.0.0",
    rigId: "ten-kings-fixed-rig-v1",
    artifactId: "calibration-artifact-v1",
    finalizedAt: "2026-07-18T12:00:00.000Z",
    normalizedWidthPx: 1000,
    normalizedHeightPx: 1400,
    scaleSamples: [
      ...Array.from({ length: 10 }, (_, index) => ({
        ...evidence("scale_x", `scale-x-${index}`), axis: "x", physicalSpanMm: 100,
        physicalSpanU95Mm: 0.1, pixelSpan: 1000,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        ...evidence("scale_y", `scale-y-${index}`), axis: "y", physicalSpanMm: 100,
        physicalSpanU95Mm: 0.1, pixelSpan: 1000,
      })),
    ],
    targetPrintScaleSamples: [
      { ...evidence("print_scale", "print-scale-x"), axis: "x", nominalSpanMm: 100,
        measuredSpanMm: 100, measurementU95Mm: 0.1 },
      { ...evidence("print_scale", "print-scale-y"), axis: "y", nominalSpanMm: 200,
        measuredSpanMm: 200, measurementU95Mm: 0.1 },
    ],
    targetCutDimensionSamples: [
      { ...evidence("target_cut", "target-cut-x"), axis: "x", nominalDimensionMm: 63.5,
        measuredDimensionMm: 63.5, measurementU95Mm: 0.1 },
      { ...evidence("target_cut", "target-cut-y"), axis: "y", nominalDimensionMm: 88.9,
        measuredDimensionMm: 88.9, measurementU95Mm: 0.1 },
    ],
    lensResidualSamples: Array.from({ length: 10 }, (_, index) => ({
      ...evidence("lens_view", `lens-${index}`), residualPx: 0.1,
    })),
    normalizationResidualSamples: Array.from({ length: 10 }, (_, index) => ({
      ...evidence("normalization", `normalization-${index}`), residualPx: 0.2,
    })),
    repeatedPlacementSamples: Array.from({ length: 10 }, (_, index) => ({
      ...evidence("placement", `placement-${index}`),
      displacementXMm: index % 2 ? 0.005 : -0.005,
      displacementYMm: index % 2 ? -0.004 : 0.004,
    })),
    segmentationBoundarySamples: Array.from({ length: 10 }, (_, index) => ({
      ...evidence("boundary", `boundary-${index}`),
      outerContourFitResidualPx: index % 2 ? 0.12 : 0.1,
    })),
    measurementRepeatabilitySamples: [
      ["linear_mm", 2, 0.002],
      ["area_mm2", 1, 0.004],
      ["relief_index", 0.4, 0.001],
      ["roughness_index", 0.2, 0.001],
      ["color_delta_e", 2, 0.005],
    ].flatMap(([measurementClass, baseline, step]) =>
      Array.from({ length: 10 }, (_, index) => ({
        ...evidence("measurement_repeatability", `${measurementClass}-${index}`),
        measurementClass,
        referenceFeatureId: `fixture-${measurementClass}`,
        measuredValue: baseline + (index - 4.5) * step,
      }))),
    lensModel: {
      model: "opencv_brown_conrady_v1",
      sourceWidthPx: 4096,
      sourceHeightPx: 3000,
      cameraMatrix: [3000, 0, 2048, 0, 3000, 1500, 0, 0, 1],
      distortionCoefficients: [0.01, -0.005, 0, 0, 0],
      calibrationRmsPx: 0.1,
      perViewResidualPx: Array(10).fill(0.1),
    },
    normalizationModel: {
      model: "undistort_outer_cut_homography_with_fixed_holdout_repeatability_v1",
      sampleResidualPx: Array(10).fill(0.2),
    },
    channels: Array.from({ length: 8 }, (_, index) => {
      const angle = index * Math.PI / 4;
      return {
        channelIndex: index + 1,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        directionConfidence: 1,
        directionMeasurementSamples: Array.from({ length: 3 }, (_, sample) => ({
          ...evidence("direction_measurement", `direction-${index + 1}-${sample}`),
          measurementMethod: "fixed_ring_segment_geometry_with_ruler_v1",
          sourcePointMm: { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) },
          cardCenterPointMm: { x: 0, y: 0 },
          pointU95Mm: 0.1,
        })),
        directionValidationAngularErrorsDegrees: [0.1, 0.1, 0.1],
        relativeResponse: new Float32Array([1, 1, 1, 1]),
        responseScale: 1,
        flatFieldArtifactId: `flat-field-${index + 1}`,
        flatFieldArtifactSha256: SHA,
        flatFieldFrames: Array.from({ length: 3 }, (_, frame) => ({
          ...evidence("flat_field", `flat-${index + 1}-${frame}`),
        })),
        darkControlFrames: Array.from({ length: 3 }, (_, frame) => ({
          ...evidence("dark_control", `dark-${index + 1}-${frame}`),
        })),
        illuminationPatternArtifactId: "illumination-pattern-v1",
        illuminationPatternArtifactSha256: SHA,
        illuminationPatternFrames: Array.from({ length: 3 }, (_, frame) => ({
          ...evidence("illumination_pattern", `pattern-${index + 1}-${frame}`),
        })),
        illuminationPatternGridWidth: 2,
        illuminationPatternGridHeight: 2,
        expectedDirectionalResidual: new Float32Array([0, 0, 0, 0]),
      };
    }),
    targetEvidence: [evidence("target", "target")],
    operatorId: "calibration-operator",
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256: SHA,
  };
  if (mutator) mutator(input);
  return buildFixedRigPhysicalCalibrationV1(input);
}

test("physical calibration finalizes only after every measured acceptance gate passes", () => {
  const first = buildAcceptedCalibration();
  const second = buildAcceptedCalibration();
  assert.equal(first.status, "finalized");
  assert.equal(first.isCalibrated, true);
  assert.equal(first.profile.mmPerPixelX, 0.1);
  assert.equal(first.profile.mmPerPixelY, 0.1);
  assert.equal(first.profile.scaleRelativeU95, 0.001);
  assert.equal(first.profile.normalizationRegistrationSampleCount, 10);
  assert.equal(first.profile.segmentationBoundarySampleCount, 10);
  assert.equal(first.artifact.artifactSha256, second.artifact.artifactSha256);
});

test("physical calibration never marks an incomplete profile calibrated", () => {
  const result = buildAcceptedCalibration((input) => {
    input.channels.pop();
    input.normalizationResidualSamples.pop();
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.isCalibrated, false);
  assert.equal(result.profile, null);
  assert.ok(result.issues.some((issue) => issue.path === "channels"));
  assert.ok(result.issues.some((issue) => issue.path === "normalizationRegistrationSampleCount"));
});

test("physical calibration rejects an absent or mismatched distortion model", () => {
  const result = buildAcceptedCalibration((input) => {
    input.lensModel.perViewResidualPx[3] = 0.3;
    input.lensModel.cameraMatrix.pop();
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.isCalibrated, false);
  assert.ok(result.issues.some((issue) => issue.path === "lensModel"));
});

test("physical calibration propagates ruler U95 and rejects target dimension errors", () => {
  const uncertain = buildAcceptedCalibration((input) => {
    input.scaleSamples.forEach((sample) => {
      sample.physicalSpanU95Mm = 0.4;
    });
  });
  assert.equal(uncertain.status, "finalized");
  assert.equal(uncertain.profile.scaleRelativeU95, 0.004);

  const badPrint = buildAcceptedCalibration((input) => {
    input.targetPrintScaleSamples[0].measuredSpanMm = 100.21;
  });
  assert.equal(badPrint.status, "rejected");
  assert.ok(badPrint.issues.some((issue) =>
    issue.path === "targetPrintScaleSamples"));

  const badCut = buildAcceptedCalibration((input) => {
    input.targetCutDimensionSamples[1].measuredDimensionMm = 89.01;
  });
  assert.equal(badCut.status, "rejected");
  assert.ok(badCut.issues.some((issue) =>
    issue.path === "targetCutDimensionSamples"));

  const missingCutAxis = buildAcceptedCalibration((input) => {
    input.targetCutDimensionSamples.pop();
  });
  assert.equal(missingCutAxis.status, "rejected");
  assert.ok(missingCutAxis.issues.some((issue) =>
    issue.path === "targetCutDimensionSamples"));
});

test("physical calibration rejects declared directions without physical point uncertainty", () => {
  const declared = buildAcceptedCalibration((input) => {
    input.channels[0].directionMeasurementSamples[0].measurementMethod =
      "operator_declared_direction_v1";
  });
  assert.equal(declared.status, "rejected");
  assert.ok(declared.issues.some((issue) =>
    issue.path === "channels.0.directionMeasurementSamples"));

  const missingU95 = buildAcceptedCalibration((input) => {
    delete input.channels[0].directionMeasurementSamples[0].pointU95Mm;
  });
  assert.equal(missingU95.status, "rejected");
  assert.ok(missingU95.issues.some((issue) =>
    issue.path === "channels.0.directionMeasurementSamples"));
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function contentHash(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function exactArtifactFile(artifact) {
  const fileBytes = Buffer.from(JSON.stringify(artifact, null, 2) + "\n", "utf8");
  return {
    fileBytes,
    fileSha256: crypto.createHash("sha256").update(fileBytes).digest("hex"),
  };
}

function buildPhotometricFixture(options = {}) {
  const flatFieldArtifactValues = Array.from({ length: 8 }, (_, channelOffset) => {
    const channelIndex = channelOffset + 1;
    const withoutHash = {
      schemaVersion: "ten-kings-flat-field-artifact-v1",
      algorithmVersion: "opencv_physical_calibration_analysis_v1",
      hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
      channelIndex,
      sourceEvidence: Array.from({ length: 3 }, (_, frame) => ({
        evidenceId: `calibration-flat-${channelIndex}-${frame}`,
        sha256: SHA,
        role: "flat_field",
      })),
      darkControlEvidence: Array.from({ length: 3 }, (_, frame) => ({
        evidenceId: `calibration-dark-${channelIndex}-${frame}`,
        sha256: SHA,
        role: "dark_control",
      })),
      sourceWidthPx: 10,
      sourceHeightPx: 14,
      gainGrid: { width: 2, height: 2, values: [1, 1.01, 0.99, 1] },
      correctedResidualSamples: [1, 1, 1, 1],
      responseScale: 1,
      correctedMaximumDeviationFraction: 0,
    };
    const artifact = {
      ...withoutHash,
      artifactSha256: contentHash(withoutHash),
    };
    return options.mutateFlatFieldArtifact
      ? options.mutateFlatFieldArtifact(artifact, channelOffset)
      : artifact;
  });
  const flatFieldArtifacts = flatFieldArtifactValues.map(exactArtifactFile);
  const patternWithoutHash = {
    schemaVersion: "ten-kings-illumination-pattern-artifact-v1",
    algorithmVersion: "opencv_physical_calibration_analysis_v1",
    hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
    coordinateFrame: "normalized_card_portrait_pixels",
    grid: { width: 2, height: 2 },
    channels: Array.from({ length: 8 }, (_, channelOffset) => ({
      channelIndex: channelOffset + 1,
      sourceEvidence: Array.from({ length: 3 }, (_, frame) => ({
        evidenceId: `calibration-pattern-${channelOffset + 1}-${frame}`,
        sha256: SHA,
        role: "illumination_pattern",
      })),
      expectedDirectionalResidual: [0, (channelOffset + 1) / 100, 0, 0],
    })),
  };
  const patternValue = {
    ...patternWithoutHash,
    artifactSha256: contentHash(patternWithoutHash),
  };
  const patternArtifactValue = options.mutatePatternArtifact
    ? options.mutatePatternArtifact(patternValue)
    : patternValue;
  const patternArtifact = exactArtifactFile(patternArtifactValue);
  const calibration = buildAcceptedCalibration((input) => {
    input.normalizedWidthPx = 10;
    input.normalizedHeightPx = 14;
    input.channels.forEach((channel, index) => {
      channel.flatFieldArtifactSha256 = flatFieldArtifacts[index].fileSha256;
      channel.illuminationPatternArtifactSha256 = patternArtifact.fileSha256;
      channel.expectedDirectionalResidual = new Float32Array(
        patternArtifactValue.channels[index].expectedDirectionalResidual,
      );
    });
    if (options.mutatePhysicalCalibrationInput) {
      options.mutatePhysicalCalibrationInput(input);
    }
  });
  return {
    calibration,
    flatFieldArtifactValues,
    flatFieldArtifacts,
    patternArtifactValue,
    patternArtifact,
    runtimeInput: calibration.status === "finalized" ? {
      calibrationProfile: calibration.profile,
      physicalArtifact: calibration.artifact,
      sensorMaximumValue: 255,
      flatFieldArtifacts: flatFieldArtifacts.map(({ fileBytes }) => ({ fileBytes })),
      illuminationPatternArtifact: { fileBytes: patternArtifact.fileBytes },
    } : null,
  };
}

test("photometric calibration loads only exact hash-bound flat-field and illumination artifacts", () => {
  const fixture = buildPhotometricFixture();
  assert.equal(fixture.calibration.status, "finalized");
  const profile = buildFixedRigPhotometricCalibrationProfileV1(
    fixture.runtimeInput,
  );
  assert.equal(profile.flatFieldChannels.length, 8);
  assert.equal(profile.illuminationPatternChannels.length, 8);
  assert.equal(profile.flatFieldChannels[0].relativeResponse.data.length, 140);
  assert.equal(
    profile.illuminationPatternChannels[7].expectedDirectionalResidual.data.length,
    140,
  );
});

test("photometric calibration rejects a stale inner canonical artifact SHA", () => {
  const fixture = buildPhotometricFixture({
    mutateFlatFieldArtifact: (artifact, index) => index === 0
      ? { ...artifact, responseScale: 1.01 }
      : artifact,
  });
  assert.equal(fixture.calibration.status, "finalized");
  assert.throws(
    () => buildFixedRigPhotometricCalibrationProfileV1(fixture.runtimeInput),
    /flat-field artifact 1 canonical content SHA-256 mismatch/,
  );
});

test("photometric calibration rejects residual acceptance or evidence that does not match physical calibration", () => {
  const residualMismatch = buildPhotometricFixture({
    mutateFlatFieldArtifact: (artifact, index) => {
      if (index !== 0) return artifact;
      const {
        artifactSha256: _artifactSha256,
        ...withoutHash
      } = artifact;
      const mismatched = {
        ...withoutHash,
        correctedResidualSamples: [1, 1.1, 1, 1],
        correctedMaximumDeviationFraction: 0,
      };
      return { ...mismatched, artifactSha256: contentHash(mismatched) };
    },
  });
  assert.equal(residualMismatch.calibration.status, "finalized");
  assert.throws(
    () => buildFixedRigPhotometricCalibrationProfileV1(
      residualMismatch.runtimeInput,
    ),
    /flat-field response, evidence, or acceptance statistic does not match/,
  );

  const evidenceMismatch = buildPhotometricFixture({
    mutateFlatFieldArtifact: (artifact, index) => {
      if (index !== 0) return artifact;
      const {
        artifactSha256: _artifactSha256,
        ...withoutHash
      } = artifact;
      const mismatched = {
        ...withoutHash,
        sourceEvidence: withoutHash.sourceEvidence.map((entry, evidenceIndex) =>
          evidenceIndex === 0
            ? { ...entry, sha256: "b".repeat(64) }
            : entry),
      };
      return { ...mismatched, artifactSha256: contentHash(mismatched) };
    },
  });
  assert.equal(evidenceMismatch.calibration.status, "finalized");
  assert.throws(
    () => buildFixedRigPhotometricCalibrationProfileV1(
      evidenceMismatch.runtimeInput,
    ),
    /flat-field response, evidence, or acceptance statistic does not match/,
  );
});

test("photometric calibration rejects stale inner illumination-pattern content", () => {
  const fixture = buildPhotometricFixture({
    mutatePatternArtifact: (artifact) => ({
      ...artifact,
      channels: artifact.channels.map((channel, index) => index === 0
        ? {
          ...channel,
          expectedDirectionalResidual: [0.5, ...channel.expectedDirectionalResidual.slice(1)],
        }
        : channel),
    }),
  });
  assert.equal(fixture.calibration.status, "finalized");
  assert.throws(
    () => buildFixedRigPhotometricCalibrationProfileV1(fixture.runtimeInput),
    /illumination-pattern artifact canonical content SHA-256 mismatch/,
  );
});

function lineSamples(axis, coordinate) {
  return Array.from({ length: 24 }, (_, index) => axis === "x"
    ? { x: coordinate, y: 50 + index * 50 }
    : { x: 50 + index * 35, y: coordinate });
}

function outerContour() {
  return [
    { x: 0, y: 0 }, { x: 1000, y: 0 },
    { x: 1000, y: 1400 }, { x: 0, y: 1400 },
  ];
}

function printedCenteringInput(side, boundaries) {
  const calibration = buildAcceptedCalibration().profile;
  return {
    side,
    calibration,
    outerCutContour: outerContour(),
    profileInput: {
      profile: "printed_border_v1",
      printBoundarySamples: {
        left: lineSamples("x", boundaries.left),
        right: lineSamples("x", boundaries.right),
        top: lineSamples("y", boundaries.top),
        bottom: lineSamples("y", boundaries.bottom),
      },
    },
    evidence: measurementEvidence(side, `${side}-centering`),
  };
}

test("printed-border centering measures known margins and uses the worse axis", () => {
  const front = buildFixedRigCenteringSideV1(printedCenteringInput("front", {
    left: 100, right: 800, top: 100, bottom: 1300,
  }));
  assert.equal(front.status, "computed");
  assert.equal(front.observedMargins.left.mm, 10);
  assert.equal(front.observedMargins.right.mm, 20);
  assert.equal(front.horizontal.balanceRatio, 50.078147);
  assert.equal(front.horizontal.differenceU95, 0.03121);
  assert.equal(front.horizontal.score, 3.86);
  assert.equal(front.vertical.score, 10);
  assert.equal(front.score, 3.86);
  assert.equal(front.centeringDeduction, 6.14);
  assert.equal(front.robustLineFits.left.sampleCount, 24);
  const back = buildFixedRigCenteringSideV1(printedCenteringInput("back", {
    left: 100, right: 900, top: 100, bottom: 1300,
  }));
  const fused = fuseFixedRigCenteringFrontBackV1(front, back);
  assert.equal(fused.status, "computed");
  assert.equal(fused.frontScore, 3.86);
  assert.equal(fused.backScore, 10);
  assert.equal(fused.score, 4.78);
});

test("printed-border centering robustly fits tilted 2-D sides, intersects them, and propagates fit U95", () => {
  const calibration = buildAcceptedCalibration().profile;
  const samples = (dependentAxis, slope, intercept) => {
    const points = Array.from({ length: 28 }, (_, index) => {
      const independent = 40 + index * 45;
      const jitter = index % 2 === 0 ? 0.15 : -0.15;
      return dependentAxis === "x"
        ? { x: slope * independent + intercept + jitter, y: independent }
        : { x: independent, y: slope * independent + intercept + jitter };
    });
    if (dependentAxis === "x") {
      points[0].x += 8;
      points[1].x -= 8;
    } else {
      points[0].y += 8;
      points[1].y -= 8;
    }
    return points;
  };
  const result = buildFixedRigCenteringSideV1({
    side: "front",
    calibration,
    outerCutContour: outerContour(),
    profileInput: {
      profile: "printed_border_v1",
      printBoundarySamples: {
        left: samples("x", 0.01, 93),
        right: samples("x", 0.01, 893),
        top: samples("y", -0.005, 102.5),
        bottom: samples("y", -0.005, 1302.5),
      },
    },
    evidence: measurementEvidence("front", "front-tilted-centering"),
  });
  assert.equal(result.status, "computed");
  assert.ok(Math.abs(result.robustLineFits.left.slope - 0.01) < 0.0001);
  assert.ok(Math.abs(result.robustLineFits.top.slope + 0.005) < 0.0001);
  assert.equal(result.robustLineFits.left.inlierCount, 26);
  assert.notEqual(result.printedDesignContour[0].x, result.printedDesignContour[3].x);
  assert.notEqual(result.printedDesignContour[0].y, result.printedDesignContour[1].y);
  assert.equal(result.registration.transformMatrix.length, 8);
  assert.ok(result.u95ComponentsMm.printedBoundaryFit.horizontal > 0);
  assert.ok(result.u95ComponentsMm.printedBoundaryFit.vertical > 0);
  assert.ok(result.u95Mm.horizontal > result.u95ComponentsMm.calibratedMarginDifference.horizontal);
  assert.ok(result.u95Mm.vertical > result.u95ComponentsMm.calibratedMarginDifference.vertical);
  assert.equal(result.score, 10);
});

test("registered-template centering preserves intentional asymmetry and scores only registration error", () => {
  const calibration = buildAcceptedCalibration().profile;
  const artifactBytes = Buffer.from("registered-centering-approved-reference");
  const sourceBytes = Buffer.from("registered-centering-normalized-source");
  const artifactSha256 = crypto.createHash("sha256").update(artifactBytes).digest("hex");
  const sourceSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");
  const identity = {
    tenantId: "tenant-one", setId: "set-one", programId: "program-one",
    cardNumber: "card-one", variantId: null, parallelId: null,
  };
  const approvedReference = {
    referenceId: "design-reference-one",
    profile: "registered_design_template_v1",
    status: "approved",
    ...identity,
    side: "front",
    artifactSha256,
    artifactWidthPx: 1000,
    artifactHeightPx: 1400,
    version: 1,
    intendedDesignBoundary: {
      schemaVersion: "ai-grader-intended-design-boundary-v1",
      coordinateFrame: "design_reference_pixels",
      contour: [[100, 140], [800, 140], [800, 1260], [100, 1260]],
    },
    approvedByUserId: "reference-approver",
    approvedAt: "2026-07-18T12:00:00.000Z",
  };
  const correspondences = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const point = { x: 50 + column * 180, y: 100 + row * 380 };
      correspondences.push({
        correspondenceId: `registered-control-${String(correspondences.length + 1).padStart(2, "0")}`,
        designReferencePointPx: point,
        normalizedSourcePointPx: { ...point },
      });
    }
  }
  const projected = projectApprovedFixedRigDesignReferenceV1({
    approvedReference,
    artifactEvidence: {
      assetId: "design-artifact-one",
      sha256: artifactSha256,
      bytes: artifactBytes,
    },
    normalizedSourceEvidence: {
      assetId: "front-registered-normalized-source",
      sha256: sourceSha256,
      bytes: sourceBytes,
      side: "front",
      coordinateFrame: "normalized_card_portrait_pixels",
      widthPx: 1000,
      heightPx: 1400,
    },
    transformType: "affine",
    correspondences,
  });
  const registeredCenteringInput = {
    side: "front",
    calibration,
    outerCutContour: outerContour(),
    profileInput: projected.centeringProfileInput,
    evidence: [{
      assetId: "front-registered-normalized-source",
      sha256: sourceSha256,
      side: "front",
      role: "normalized_card",
      regionId: "front-registered-centering",
    }],
  };
  const result = buildFixedRigCenteringSideV1(registeredCenteringInput);
  assert.equal(result.status, "computed");
  assert.equal(result.observedMargins.left.mm, 10);
  assert.equal(result.observedMargins.right.mm, 20);
  assert.equal(result.horizontal.axisError, 0);
  assert.equal(result.horizontal.balanceRatio, 100);
  assert.equal(result.score, 10);
  const mismatchedEvidence = buildFixedRigCenteringSideV1({
    ...registeredCenteringInput,
    evidence: measurementEvidence("front", "unrelated-normalized-source"),
  });
  assert.equal(mismatchedEvidence.status, "insufficient_evidence");
  assert.match(mismatchedEvidence.reasons.join(" "), /exact normalized source evidence/);
});

let cachedConditionCalibration;
function conditionCalibration() {
  if (cachedConditionCalibration) return cachedConditionCalibration;
  const accepted = buildAcceptedCalibration();
  assert.equal(accepted.status, "finalized");
  const profile = accepted.profile;
  cachedConditionCalibration = {
    profile,
    calibrationProfileId: profile.profileId,
    calibrationVersion: profile.calibrationVersion,
    calibrationSha256: profile.artifactSha256,
    pixelsPerMmX: 1 / profile.mmPerPixelX,
    pixelsPerMmY: 1 / profile.mmPerPixelY,
  };
  return cachedConditionCalibration;
}

function cornerObservation(side, location, options = {}) {
  const width = 10;
  const height = 10;
  const regionId = `${side}-${location}-corner`;
  return measureFixedRigCornerObservationV1({
    side,
    location,
    regionId,
    detectorId: "synthetic-corner-detector",
    detectorVersion: "corner-detector-v1.0.0",
    algorithmVersion: "corner-measurement-v1.0.0",
    calibration: conditionCalibration(),
    validEvidenceMask: options.validEvidenceMask ?? plane(width, height, 1),
    usableDirectionalChannelCount: 3,
    confidence: 0.95,
    evidence: measurementEvidence(side, regionId),
    whiteningMask: options.whiteningMask ?? plane(width, height, 0),
    missingMaterialMask: options.missingMaterialMask ?? plane(width, height, 0),
    shapeDeviationMask: plane(width, height, 0),
    shapeDeviationPx: plane(width, height, 0),
    deformationMask: plane(width, height, 0),
    delaminationMask: plane(width, height, 0),
    directionalReliefIndex: plane(width, height, 0),
    directionalReliefMask: plane(width, height, 0),
  });
}

test("each of eight corner observations measures its own pixels and aggregates worst plus average", () => {
  const locations = ["top_left", "top_right", "bottom_right", "bottom_left"];
  const observations = [];
  for (const side of ["front", "back"]) {
    for (const location of locations) {
      observations.push(cornerObservation(side, location, {
        whiteningMask: side === "front" && location === "top_left"
          ? plane(10, 10, (x, y) => x < 2 && y < 2 ? 1 : 0)
          : plane(10, 10, 0),
      }));
    }
  }
  assert.ok(observations.every((observation) => observation.status === "computed"));
  const damaged = observations[0];
  assert.equal(damaged.findings.length, 1);
  assert.equal(damaged.findings[0].finding.category, "corner_whitening");
  assert.equal(damaged.findings[0].measurements[0].measuredMeasurement, 0.04);
  assert.equal(damaged.findings[0].measurements[0].u95, 0.026092);
  assert.equal(damaged.findings[0].measurements[0].effectiveMeasurement, 0.013908);
  assert.equal(damaged.penalty, 0.03);
  assert.ok(observations.slice(1).every((observation) => observation.penalty === 0));
  const element = aggregateFixedRigCornersV1(observations);
  assert.equal(element.status, "computed");
  assert.equal(element.aggregation.worstPenalty, 0.03);
  assert.equal(element.aggregation.averagePenalty, 0.00375);
  assert.equal(element.score, 9.98);
});

test("an invalid clean-corner region cannot masquerade as a Grade 10", () => {
  const result = cornerObservation("front", "top_left", {
    validEvidenceMask: plane(10, 10, (x, y) => x === 0 && y === 0 ? 0 : 1),
  });
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.score, undefined);
  assert.equal(result.cardDefectDeduction, 0);
});

function edgeObservation(side, location, damaged = false, mirrorDamage = false) {
  const width = 20;
  const height = 5;
  const regionId = `${side}-${location}-edge`;
  const damageMinimumX = mirrorDamage ? 8 : 2;
  const damageMaximumX = mirrorDamage ? 18 : 12;
  const chipX = mirrorDamage ? 14 : 5;
  const damageMask = damaged
    ? plane(width, height, (x, y) => y === 1 && x >= damageMinimumX && x < damageMaximumX ? 1 : 0)
    : plane(width, height, 0);
  const chipMask = damaged
    ? plane(width, height, (x, y) => x === chipX && y === 1 ? 1 : 0)
    : plane(width, height, 0);
  return measureFixedRigEdgeObservationV1({
    side,
    location,
    regionId,
    detectorId: "synthetic-edge-detector",
    detectorVersion: "edge-detector-v1.0.0",
    algorithmVersion: "edge-measurement-v1.0.0",
    calibration: conditionCalibration(),
    validEvidenceMask: plane(width, height, 1),
    usableDirectionalChannelCount: 3,
    confidence: 0.95,
    evidence: measurementEvidence(side, regionId),
    damageMask,
    chipMask,
    chipDepthMm: plane(width, height, (x, y) => damaged && x === chipX && y === 1 ? 0.3 : 0),
    whiteningMask: plane(width, height, 0),
    roughnessMask: plane(width, height, 0),
    roughnessIndex: plane(width, height, 0),
    frayingMask: plane(width, height, 0),
    delaminationMask: plane(width, height, 0),
    deformationMask: plane(width, height, 0),
    directionalReliefIndex: plane(width, height, 0),
    directionalReliefMask: plane(width, height, 0),
  });
}

function eightEdgeObservations(
  damagedFrontTop = true,
  damagedBackTop = false,
  mirrorBackDamage = false,
) {
  const locations = ["top", "right", "bottom", "left"];
  return ["front", "back"].flatMap((side) => locations.map((location) => edgeObservation(
    side,
    location,
    (side === "front" && location === "top" && damagedFrontTop) ||
      (side === "back" && location === "top" && damagedBackTop),
    side === "back" && location === "top" && mirrorBackDamage,
  )));
}

test("edge components merge overlapping detections and deduct the strongest primary category once", () => {
  const observations = eightEdgeObservations();
  const damaged = observations[0];
  assert.equal(damaged.status, "computed");
  assert.equal(damaged.findings.length, 1);
  assert.equal(damaged.findings[0].finding.category, "edge_chip");
  assert.deepEqual(damaged.findings[0].secondaryCategoryEvidence, ["edge_damage"]);
  assert.equal(damaged.findings[0].deduction, 1.8);
  assert.equal(damaged.penalty, 1.8);
  const damageLength = damaged.findings[0].measurements.find(
    (measurement) => measurement.measurementId.includes("edge_damage"),
  );
  const longest = damaged.findings[0].measurements.find(
    (measurement) => measurement.measurementId.includes("longest-continuous"),
  );
  assert.equal(damageLength.measuredMeasurement, 1);
  assert.equal(longest.measuredMeasurement, 1);
  assert.equal(damaged.findings[0].measurements[0].u95, 0.029567);
  assert.equal(damaged.findings[0].measurements[0].effectiveMeasurement, 0.270433);
  const element = aggregateFixedRigEdgesV1(observations);
  assert.equal(element.status, "computed");
  assert.equal(element.aggregation.worstPenalty, 1.8);
  assert.equal(element.aggregation.averagePenalty, 0.225);
  assert.equal(element.score, 8.83);
});

test("calibrated mirrored geometry, category, and measurement agreement remove one cross-side duplicate", () => {
  const observations = eightEdgeObservations(true, true, true);
  const frontFindingId = observations[0].findings[0].finding.findingId;
  const backFindingId = observations[4].findings[0].finding.findingId;
  const element = aggregateFixedRigEdgesV1(observations);
  assert.equal(element.status, "computed");
  assert.equal(element.crossSideDeduplication.length, 1);
  assert.deepEqual(element.crossSideDeduplication[0].linkedFindingIds, [frontFindingId, backFindingId]);
  assert.equal(element.crossSideDeduplication[0].removedDuplicateDeduction, 1.8);
  assert.match(element.crossSideDeduplication[0].reason, /Deterministic calibrated front\/back physical match/);
  assert.equal(element.score, 8.83);
});

test("caller cross-side IDs cannot suppress geometrically distinct physical damage", () => {
  const observations = eightEdgeObservations(true, true, false);
  const frontFinding = observations[0].findings[0].finding;
  const backFinding = observations[4].findings[0].finding;
  backFinding.physicalDefectId = frontFinding.physicalDefectId;
  const element = aggregateFixedRigEdgesV1(observations, [{
    canonicalPhysicalDefectId: "forged-caller-link",
    findingIds: [frontFinding.findingId, backFinding.findingId],
    reason: "Caller assertion without calibrated geometry proof.",
  }]);
  assert.equal(element.status, "computed");
  assert.equal(element.crossSideDeduplication.length, 0);
  assert.equal(element.locationSubscores[0].deduplicatedPenalty, 1.8);
  assert.equal(element.locationSubscores[4].deduplicatedPenalty, 1.8);
  assert.equal(element.score, 8.74);
});

test("all eight physical edge observations are mandatory", () => {
  const observations = eightEdgeObservations().slice(0, 7);
  const element = aggregateFixedRigEdgesV1(observations);
  assert.equal(element.status, "insufficient_evidence");
  assert.equal(element.score, null);
  assert.equal(element.cardDefectDeduction, 0);
});
