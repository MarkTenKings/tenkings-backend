const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  mathematicalCalibrationProfileV1Schema,
} = require("@tenkings/shared");

const {
  buildFixedRigPhotometricEvidenceV1,
} = require("../dist/drivers/fixedRigPhotometricEvidenceV1");
const {
  buildFixedRigConditionPlanesV1,
  buildFixedRigExpectedOuterCardMaskV1,
  hashFixedRigIntendedOuterBoundaryV1,
} = require("../dist/drivers/fixedRigConditionPlaneProducerV1");
const {
  CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1,
  detectFixedRigRawBoundObservedOuterCutV1,
  verifyFixedRigRawBoundObservedOuterCutArtifactV1,
} = require("../dist/drivers");

const WIDTH = 64;
const HEIGHT = 96;
const SHA = "a".repeat(64);

function scalar(valueOrFactory = 0) {
  const data = new Float32Array(WIDTH * HEIGHT);
  for (let index = 0; index < data.length; index += 1) {
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    data[index] = typeof valueOrFactory === "function"
      ? valueOrFactory(x, y, index)
      : valueOrFactory;
  }
  return { width: WIDTH, height: HEIGHT, data };
}

function rgb(mutator) {
  const data = new Float32Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const base = 0.25 + 0.2 * x / (WIDTH - 1) + 0.1 * y / (HEIGHT - 1);
      for (let channel = 0; channel < 3; channel += 1) {
        const index = (y * WIDTH + x) * 3 + channel;
        data[index] = mutator
          ? mutator({ x, y, channel, base, index })
          : base;
      }
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}

function insidePolygon(x, y, contour) {
  let inside = false;
  for (let current = 0, previous = contour.length - 1; current < contour.length; previous = current++) {
    const a = contour[current];
    const b = contour[previous];
    if (((a.y > y) !== (b.y > y)) &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function capturedRgb(materialPredicate, artworkMutator) {
  return rgb((sample) => {
    if (!materialPredicate(sample.x + 0.5, sample.y + 0.5)) return 0.01;
    return artworkMutator ? artworkMutator(sample) : sample.base;
  });
}

function calibration() {
  return {
    calibrationProfileId: "producer-calibration-v1",
    calibrationVersion: "calibration-v1.0.0",
    calibrationSha256: SHA,
    coordinateFrame: "normalized_card_portrait_pixels",
    width: WIDTH,
    height: HEIGHT,
    sensorMaximumValue: 255,
    isFinalized: true,
    isCalibrated: true,
    flatFieldChannels: Array.from({ length: 8 }, (_, index) => ({
      channel: index + 1,
      relativeResponse: scalar(1),
      sourceEvidenceId: `flat-field-${index + 1}`,
      sourceSha256: SHA,
    })),
    illuminationPatternChannels: Array.from({ length: 8 }, (_, index) => ({
      channel: index + 1,
      expectedDirectionalResidual: scalar(0),
      sourceEvidenceId: `pattern-${index + 1}`,
      sourceSha256: SHA,
    })),
    sourceEvidenceIds: ["flat-field-set", "illumination-pattern-set"],
  };
}

function photometric(response, intendedContour = roundedRectangleContour()) {
  const gradeRelevantMask = buildFixedRigExpectedOuterCardMaskV1({
    width: WIDTH,
    height: HEIGHT,
    outerCutContour: intendedContour,
  });
  return buildFixedRigPhotometricEvidenceV1({
    calibration: calibration(),
    darkControl: scalar(0),
    gradeRelevantMask,
    gradeRelevantMaskSourceEvidenceId: "front-expected-outer-mask",
    gradeRelevantMaskSourceSha256: SHA,
    channels: Array.from({ length: 8 }, (_, offset) => ({
      channel: offset + 1,
      image: scalar((x, y) => 255 * response(offset + 1, x, y)),
      channelConfidence: 1,
      sourceEvidenceId: `front-channel-${offset + 1}`,
      sourceSha256: SHA,
    })),
  });
}

function measurementCalibration() {
  const angularU95 = 0.1;
  const directionConfidence = Math.round(
    Math.max(
      0,
      1 - angularU95 /
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance
          .channelDirectionConfidenceSectorScaleDegrees,
    ) * 1e6,
  ) / 1e6;
  const profile = mathematicalCalibrationProfileV1Schema.parse({
    schemaVersion: MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION,
    profileId: "producer-calibration-v1",
    calibrationVersion: "calibration-v1.0.0",
    rigId: "ten-kings-fixed-rig-v1",
    isCalibrated: true,
    status: "finalized",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: "producer-calibration-artifact-v1",
    artifactSha256: SHA,
    finalizedAt: "2026-07-18T20:00:00.000Z",
    normalizedWidthPx: WIDTH,
    normalizedHeightPx: HEIGHT,
    mmPerPixelX: 0.25,
    mmPerPixelY: 0.25,
    scaleRelativeU95: 0.001,
    scaleSampleCount: 20,
    lensCalibrationViewCount: 20,
    lensResidualPx: 0.1,
    normalizationRegistrationResidualPx: 0.1,
    normalizationRegistrationSampleCount: 20,
    repeatedPlacementCount: 20,
    repeatedPlacementU95Mm: 0.005,
    segmentationBoundaryU95Px: 0.1,
    segmentationBoundarySampleCount: 20,
    measurementRepeatability: {
      linearMm: { sampleCount: 20, u95: 0.001 },
      areaMm2: { sampleCount: 20, u95: 0.001 },
      reliefIndex: { sampleCount: 20, u95: 0.001 },
      roughnessIndex: { sampleCount: 20, u95: 0.001 },
      colorDeltaE: { sampleCount: 20, u95: 0.001 },
    },
    channels: Array.from({ length: 8 }, (_, offset) => {
      const angle = offset * Math.PI / 4;
      return {
        channelIndex: offset + 1,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        directionConfidence,
        directionMeasurementSampleCount: 3,
        directionAngularU95Degrees: angularU95,
        directionSourceRadiusMm: 100,
        directionPointU95Mm: 0.1,
        flatFieldArtifactId: `flat-field-${offset + 1}`,
        flatFieldArtifactSha256: SHA,
        flatFieldFrameCount: 3,
        darkControlFrameCount: 3,
        maxFlatFieldDeviationFraction: 0,
        illuminationPatternArtifactId: "illumination-pattern-v1",
        illuminationPatternArtifactSha256: SHA,
        illuminationPatternFrameCount: 3,
        responseScale: 1,
      };
    }),
  });
  return {
    profile,
    calibrationProfileId: profile.profileId,
    calibrationVersion: profile.calibrationVersion,
    calibrationSha256: profile.artifactSha256,
    pixelsPerMmX: 1 / profile.mmPerPixelX,
    pixelsPerMmY: 1 / profile.mmPerPixelY,
  };
}

function evidence() {
  return [
    {
      assetId: "front-all-on", sha256: SHA, side: "front",
      role: "all_on", regionId: "front-full-card",
    },
    {
      assetId: "front-normalized", sha256: SHA, side: "front",
      role: "normalized_card", regionId: "front-full-card",
    },
    {
      assetId: "front-design", sha256: SHA, side: "front",
      role: "design_reference", regionId: "front-full-card",
    },
    ...Array.from({ length: 8 }, (_, offset) => ({
      assetId: `front-channel-${offset + 1}`,
      sha256: SHA,
      side: "front",
      role: "directional_channel",
      regionId: "front-full-card",
      channelIndex: offset + 1,
    })),
  ];
}

function identityRawToNormalizedTransform() {
  const payload = {
    schemaVersion: CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1,
    sourceSha256: SHA,
    sourceCoordinateFrame: "auto_oriented_raw_image_pixels",
    sourceWidthPx: WIDTH,
    sourceHeightPx: HEIGHT,
    autoOrientApplied: true,
    deskewClockwiseDegrees: 0,
    rotatedWidthPx: WIDTH,
    rotatedHeightPx: HEIGHT,
    crop: { leftPx: 0, topPx: 0, widthPx: WIDTH, heightPx: HEIGHT },
    outputCoordinateFrame: "normalized_card_portrait_pixels",
    outputWidthPx: WIDTH,
    outputHeightPx: HEIGHT,
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };
  return {
    ...payload,
    transformSha256: createHash("sha256")
      .update(JSON.stringify(payload), "utf8")
      .digest("hex"),
  };
}

function detectRawOuterCut(rawAllOnRgb, intendedBoundary, measurement) {
  return detectFixedRigRawBoundObservedOuterCutV1({
    rawAllOnRgb,
    rawAllOnAssetId: "front-raw-all-on",
    rawAllOnAssetSha256: SHA,
    normalizedAllOnAssetId: "front-all-on",
    normalizedAllOnAssetSha256: SHA,
    rawToNormalizedTransform: identityRawToNormalizedTransform(),
    calibrationProfileId: measurement.calibrationProfileId,
    calibrationVersion: measurement.calibrationVersion,
    calibrationSha256: measurement.calibrationSha256,
    intendedBoundary,
    pixelsPerMmX: measurement.pixelsPerMmX,
    pixelsPerMmY: measurement.pixelsPerMmY,
    segmentationBoundaryU95Px: measurement.profile.segmentationBoundaryU95Px,
  });
}

function input(overrides = {}) {
  const {
    materialPredicate: materialPredicateOverride,
    ...inputOverrides
  } = overrides;
  const intendedContour = overrides.intendedOuterBoundary?.contour ??
    roundedRectangleContour();
  const intendedWithoutHash = {
    profileId: "standard-card-format-v1",
    profileVersion: "standard-card-format-v1.0.0",
    coordinateFrame: "normalized_card_portrait_pixels",
    contour: intendedContour,
  };
  const materialPredicate = materialPredicateOverride ??
    ((x, y) => insidePolygon(x, y, intendedContour));
  const allOn = overrides.normalizedAllOnRgb ?? capturedRgb(materialPredicate);
  const accepted = overrides.normalizedAcceptedProfileRgb ?? allOn;
  const approvedDesign = Object.prototype.hasOwnProperty.call(
    overrides,
    "approvedDesignReferenceRgb",
  ) ? overrides.approvedDesignReferenceRgb : accepted;
  const registration = Object.prototype.hasOwnProperty.call(overrides, "designRegistration")
    ? overrides.designRegistration
    : {
        designReferenceId: "front-design-v1",
        designReferenceSha256: SHA,
        transformType: "affine",
        transformMatrix: [1, 0, 0, 0, 1, 0],
        registrationResidualPx: 0.1,
        inlierCount: 40,
        inlierFraction: 0.95,
        confidence: 0.98,
      };
  const defaultIntendedOuterBoundary = {
    ...intendedWithoutHash,
    artifactSha256: hashFixedRigIntendedOuterBoundaryV1(intendedWithoutHash),
  };
  const intendedOuterBoundary = overrides.intendedOuterBoundary ??
    defaultIntendedOuterBoundary;
  const measurement = measurementCalibration();
  const detectedOuterCut = detectRawOuterCut(
    allOn,
    intendedOuterBoundary,
    measurement,
  );
  const rawBoundObservedOuterCut = Object.prototype.hasOwnProperty.call(
    overrides,
    "rawBoundObservedOuterCut",
  )
    ? overrides.rawBoundObservedOuterCut
    : detectedOuterCut.status === "computed"
      ? detectedOuterCut.artifact
      : undefined;
  return {
    side: "front",
    normalizedAllOnRgb: allOn,
    normalizedAcceptedProfileRgb: accepted,
    approvedDesignReferenceRgb: approvedDesign,
    designRegistration: registration,
    intendedOuterBoundary,
    rawBoundObservedOuterCut,
    photometricEvidence: photometric(() => 0.35, intendedContour),
    measurementCalibration: measurement,
    sourceEvidence: evidence(),
    ...inputOverrides,
  };
}

function maximum(plane) {
  return Math.max(...Array.from(plane.data));
}

function minimum(plane) {
  return Math.min(...Array.from(plane.data));
}

function roundedRectangleContour(radius = 5, samplesPerCorner = 8, inset = 6) {
  const left = inset;
  const top = inset;
  const right = WIDTH - inset;
  const bottom = HEIGHT - inset;
  const corners = [
    { cx: left + radius, cy: top + radius, start: Math.PI, end: 1.5 * Math.PI },
    { cx: right - radius, cy: top + radius, start: 1.5 * Math.PI, end: 2 * Math.PI },
    { cx: right - radius, cy: bottom - radius, start: 0, end: 0.5 * Math.PI },
    { cx: left + radius, cy: bottom - radius, start: 0.5 * Math.PI, end: Math.PI },
  ];
  return corners.flatMap(({ cx, cy, start, end }) =>
    Array.from({ length: samplesPerCorner + 1 }, (_, index) => {
      const angle = start + (end - start) * index / samplesPerCorner;
      return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    }));
}

test("producer derives clean physical planes from captures without caller detector-plane authority", () => {
  const first = buildFixedRigConditionPlanesV1(input());
  const second = buildFixedRigConditionPlanesV1(input());
  assert.equal(first.status, "computed");
  assert.equal(second.status, "computed");
  assert.equal(first.heatmapUsedAsInput, false);
  assert.equal(first.manualPlaneUsedAsInput, false);
  assert.equal(verifyFixedRigRawBoundObservedOuterCutArtifactV1(
    first.outerCutGeometryEvidence.observedArtifact,
  ), true);
  assert.equal(first.outerCutGeometryEvidence.normalizedAllOnAssetId, "front-all-on");
  assert.equal(first.outerCutGeometryEvidence.normalizedAllOnAssetSha256, SHA);
  assert.equal(
    first.outerCutGeometryEvidence.observedArtifact.calibrationProfileId,
    "producer-calibration-v1",
  );
  assert.equal(
    first.outerCutGeometryEvidence.observedArtifact.calibrationSha256,
    SHA,
  );
  assert.equal(first.outerCutGeometryEvidence.observedArtifact.u95Mm, 0.251246891);
  assert.equal(maximum(first.planes.scratchLineResponse), 0);
  assert.equal(maximum(first.planes.scuffTextureResponse), 0);
  assert.deepEqual(
    Array.from(first.planes.expectedOuterCardMask.data),
    Array.from(second.planes.expectedOuterCardMask.data),
  );
});

test("intended authority and raw-bound observed-cut evidence fail closed", () => {
  const missing = buildFixedRigConditionPlanesV1(input({
    intendedOuterBoundary: undefined,
  }));
  assert.equal(missing.status, "insufficient_evidence");
  assert.match(missing.reasons.join(" "), /hash-bound intended outer-boundary/i);

  const validInput = input();
  const tamperedIntended = buildFixedRigConditionPlanesV1({
    ...validInput,
    intendedOuterBoundary: {
      ...validInput.intendedOuterBoundary,
      contour: validInput.intendedOuterBoundary.contour.map((point, index) =>
        index === 0 ? { ...point, x: point.x + 0.25 } : point),
    },
  });
  assert.equal(tamperedIntended.status, "insufficient_evidence");
  assert.match(tamperedIntended.reasons.join(" "), /does not match its exact canonical artifact/i);

  const noBoundary = buildFixedRigConditionPlanesV1(input({
    normalizedAllOnRgb: rgb(() => 0.5),
  }));
  assert.equal(noBoundary.status, "insufficient_evidence");
  assert.match(noBoundary.reasons.join(" "), /raw-sensor outer-cut artifact is required/i);

  const computed = buildFixedRigConditionPlanesV1(validInput);
  assert.equal(computed.status, "computed");
  const forged = buildFixedRigConditionPlanesV1({
    ...validInput,
    outerCutContour: [{ x: 0, y: 0 }, { x: WIDTH, y: 0 }, { x: 0, y: HEIGHT }],
    outerCutContourArtifactSha256: "f".repeat(64),
    outerCutBoundaryConfidence: 1,
  });
  assert.equal(forged.status, "computed");
  assert.deepEqual(
    forged.outerCutGeometryEvidence.observedArtifact,
    computed.outerCutGeometryEvidence.observedArtifact,
  );

  const artifactTamper = structuredClone(computed.outerCutGeometryEvidence.observedArtifact);
  artifactTamper.normalizedContour[0].x += 1;
  assert.equal(verifyFixedRigRawBoundObservedOuterCutArtifactV1(artifactTamper), false);
});

test("two separated equal-gradient cut candidates are ambiguous and fail closed", () => {
  const contour = [
    { x: 10, y: 10 },
    { x: WIDTH - 10, y: 10 },
    { x: WIDTH - 10, y: HEIGHT - 10 },
    { x: 10, y: HEIGHT - 10 },
  ];
  const boundaryWithoutHash = {
    profileId: "square-format-ambiguity-fixture-v1",
    profileVersion: "square-format-ambiguity-fixture-v1.0.0",
    coordinateFrame: "normalized_card_portrait_pixels",
    contour,
  };
  const separatedEqualEdges = rgb(({ x, y }) => {
    const insideOuter = x >= 10 && x <= WIDTH - 10 && y >= 10 && y <= HEIGHT - 10;
    const insideInner = x >= 13 && x <= WIDTH - 13 && y >= 13 && y <= HEIGHT - 13;
    return insideOuter && !insideInner ? 0.7 : 0.01;
  });
  const intendedOuterBoundary = {
    ...boundaryWithoutHash,
    artifactSha256: hashFixedRigIntendedOuterBoundaryV1(boundaryWithoutHash),
  };
  const rawDetection = detectRawOuterCut(
    separatedEqualEdges,
    intendedOuterBoundary,
    measurementCalibration(),
  );
  assert.equal(rawDetection.status, "insufficient_evidence");
  assert.match(rawDetection.reasons.join(" "), /tied boundary peaks/i);
  const result = buildFixedRigConditionPlanesV1(input({
    intendedOuterBoundary,
    normalizedAllOnRgb: separatedEqualEdges,
  }));
  assert.equal(result.status, "insufficient_evidence");
  assert.match(result.reasons.join(" "), /raw-sensor outer-cut artifact is required/i);
  assert.equal(result.cardDefectDeduction, 0);
});

test("hash-bound rounded intended boundary is rasterized instead of treating the frame as card", () => {
  const contour = roundedRectangleContour();
  const boundaryWithoutHash = {
    profileId: "rounded-standard-card-v1",
    profileVersion: "rounded-standard-card-v1.0.0",
    coordinateFrame: "normalized_card_portrait_pixels",
    contour,
  };
  const result = buildFixedRigConditionPlanesV1(input({
    intendedOuterBoundary: {
      ...boundaryWithoutHash,
      artifactSha256: hashFixedRigIntendedOuterBoundaryV1(boundaryWithoutHash),
    },
  }));
  assert.equal(result.status, "computed", result.reasons?.join("; "));
  assert.equal(result.planes.expectedOuterCardMask.data[0], 0);
  assert.equal(result.planes.expectedOuterCardMask.data[12 * WIDTH + 12], 1);
  assert.ok(maximum(result.planes.boundaryDeviationMm) <= 0.5);
  assert.equal(
    result.outerCutGeometryEvidence.intendedContourSha256,
    hashFixedRigIntendedOuterBoundaryV1(boundaryWithoutHash),
  );
});

test("captured-frame corner chip contour produces signed missing material and calibrated chip depth", () => {
  const intended = roundedRectangleContour();
  const result = buildFixedRigConditionPlanesV1(input({
    materialPredicate: (x, y) =>
      insidePolygon(x, y, intended) && !(x < 10 && y < 10),
  }));
  assert.equal(result.status, "computed");
  const topLeft = 8 * WIDTH + 8;
  assert.equal(result.planes.expectedOuterCardMask.data[topLeft], 1);
  assert.equal(result.planes.materialPresenceConfidence.data[topLeft], 0);
  assert.ok(result.planes.chipDepthMm.data[topLeft] >= 0.25);
  assert.ok(minimum(result.planes.signedBoundaryDeviationMm) < 0);
  assert.ok(maximum(result.planes.boundaryDeviationMm) >= 0.25);
});

test("captured-frame edge notch produces depth and geometry-only roughness/fraying", () => {
  const intended = roundedRectangleContour();
  const baseline = buildFixedRigConditionPlanesV1(input());
  const result = buildFixedRigConditionPlanesV1(input({
    materialPredicate: (x, y) =>
      insidePolygon(x, y, intended) && !(x >= 22 && x <= 36 && y < 9),
  }));
  assert.equal(baseline.status, "computed");
  assert.equal(result.status, "computed");
  assert.ok(maximum(result.planes.chipDepthMm) >= 0.5);
  assert.ok(maximum(result.planes.edgeRoughnessIndex) >
    maximum(baseline.planes.edgeRoughnessIndex));
  assert.ok(maximum(result.planes.frayingResponse) >
    maximum(baseline.planes.frayingResponse));
});

test("high-contrast printed artwork cannot become edge fraying", () => {
  const intended = roundedRectangleContour();
  const baseline = buildFixedRigConditionPlanesV1(input());
  const artwork = capturedRgb(
    (x, y) => insidePolygon(x, y, intended),
    ({ x, y }) => ((x + y) % 4 < 2 ? 0.05 : 0.95),
  );
  const result = buildFixedRigConditionPlanesV1(input({
    normalizedAcceptedProfileRgb: artwork,
    approvedDesignReferenceRgb: artwork,
  }));
  assert.equal(baseline.status, "computed");
  assert.equal(result.status, "computed");
  assert.equal(
    maximum(result.planes.edgeRoughnessIndex),
    maximum(baseline.planes.edgeRoughnessIndex),
  );
  assert.equal(
    maximum(result.planes.frayingResponse),
    maximum(baseline.planes.frayingResponse),
  );
});

test("directional scratches and area-plus-relief dents remain measurable without inventing metric depth", () => {
  const scratchResiduals = [0.18, 0.14, 0.1, 0.06, -0.06, -0.1, -0.14, -0.18];
  const scratch = buildFixedRigConditionPlanesV1(input({
    photometricEvidence: photometric((channel, x, y) =>
      0.35 + (y === 48 && x >= 10 && x <= 53 ? scratchResiduals[channel - 1] : 0),
      roundedRectangleContour()),
  }));
  assert.equal(scratch.status, "computed");
  assert.ok(maximum(scratch.planes.scratchLineResponse) >= 0.6);
  assert.ok(maximum(scratch.planes.reliefIndex) > 0);
  assert.equal(maximum(scratch.planes.depthMm), 0);

  const broad = buildFixedRigConditionPlanesV1(input({
    photometricEvidence: photometric((channel, x, y) =>
      0.35 + (x >= 16 && x <= 47 && y >= 30 && y <= 65
        ? scratchResiduals[channel - 1]
        : 0), roundedRectangleContour()),
  }));
  assert.equal(broad.status, "computed");
  assert.ok(maximum(broad.planes.deformationResponse) >= 0.6);
  assert.ok(maximum(broad.planes.reliefIndex) > 0);
  assert.equal(maximum(broad.planes.depthMm), 0);
  assert.ok(broad.unavailableModalities.includes("metric_depth"));
});

test("missing approved design leaves design planes unavailable and unexplained color fails closed", () => {
  const cleanWithoutDesign = buildFixedRigConditionPlanesV1(input({
    approvedDesignReferenceRgb: undefined,
    designRegistration: undefined,
  }));
  assert.equal(cleanWithoutDesign.status, "computed");
  assert.equal(cleanWithoutDesign.designDependentEvidence, "unavailable_no_approved_reference");
  assert.deepEqual(cleanWithoutDesign.unavailableModalities, [
    "metric_depth",
    "polarized_residue",
    "design_relative_color",
  ]);
  assert.equal(maximum(cleanWithoutDesign.planes.registeredColorDeltaE), 0);

  const altered = rgb(({ x, y, channel, base }) =>
    x >= 24 && x <= 39 && y >= 40 && y <= 55 && channel === 0
      ? Math.min(1, base + 0.3)
      : base);
  const unexplained = buildFixedRigConditionPlanesV1(input({
    normalizedAcceptedProfileRgb: altered,
    approvedDesignReferenceRgb: undefined,
    designRegistration: undefined,
  }));
  assert.equal(unexplained.status, "insufficient_evidence");
  assert.equal(unexplained.requiresApprovedDesignReference, true);
  assert.match(unexplained.reasons.join(" "), /unexplained color/i);
});
